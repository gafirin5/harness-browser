import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { parseGitHubRemote } from '../src/modules/github/routes.js';
import { getDashboardSummary } from '../src/modules/orchestrator/dashboard.js';
import { pump } from '../src/modules/orchestrator/dispatcher.js';
import { heartbeatOnce } from '../src/modules/orchestrator/heartbeat.js';
import { applyAgentResult, findAgentByToken } from '../src/modules/orchestrator/service.js';
import { terminalManager } from '../src/modules/terminals/manager.js';
import { clearRateLimits } from '../src/modules/auth/middleware.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-unit-repo-');
const bareDir = fs.mkdtempSync('/tmp/dorado-unit-bare-');
let api: ReturnType<typeof request.agent>;
let projectId = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });
  execFileSync('git', ['init', '--bare', '-q', bareDir]);
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: repoDir });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir, stdio: 'ignore' });

  api = request.agent(app);
  const login = await api.post('/api/auth/login').send({ password: 'test-password' });
  expect(login.status).toBe(200);
});

beforeEach(() => {
  clearRateLimits();
});

afterAll(() => {
  terminalManager.shutdown();
  terminalManager.killAllSessions();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.rmSync(bareDir, { recursive: true, force: true });
});

describe('auth', () => {
  it('menolak password salah dan menerima sesi valid', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ password: 'salah' });
    expect(wrong.status).toBe(401);
    const me = await api.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(1);
  });

  it('membuat pairing token dan memakainya untuk sesi baru', async () => {
    const created = await api.post('/api/pairing').send({ label: 'Test browser' });
    expect(created.status).toBe(201);
    expect(created.body.data.pairUrl).toContain('?pair=');

    const paired = request.agent(app);
    const pair = await paired.post('/api/auth/pair').send({ token: created.body.data.token });
    expect(pair.status).toBe(200);
    expect((await paired.get('/api/auth/me')).status).toBe(200);
  });
});

describe('info', () => {
  it('menyajikan versi, data dir, tmux, dan jumlah data', async () => {
    const response = await api.get('/api/info');
    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe('0.1.0');
    expect(typeof response.body.data.dataDir).toBe('string');
    expect(response.body.data.counts.projects).toBeGreaterThanOrEqual(0);
    expect(response.body.data.agents.some((agent: { id: string }) => agent.id === 'opencode')).toBe(true);
  });
});

describe('github remote parsing', () => {
  it('mengenali format SSH, git://, dan HTTPS', () => {
    expect(parseGitHubRemote('git@github.com:acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGitHubRemote('ssh://git@github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGitHubRemote('git://github.com/acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGitHubRemote('https://github.com/acme/widgets.git')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGitHubRemote('https://github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(parseGitHubRemote('https://github.com/acme/widgets/tree/main')).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('menolak remote non-GitHub dan format tidak valid', () => {
    expect(parseGitHubRemote('/tmp/dorado-unit-bare')).toBeNull();
    expect(parseGitHubRemote('https://gitlab.com/acme/widgets.git')).toBeNull();
    expect(parseGitHubRemote('https://github.com/acme')).toBeNull();
    expect(parseGitHubRemote('')).toBeNull();
  });
});

describe('projects & worktrees', () => {
  it('menambah project, membaca branch, membuat dan menghapus worktree', async () => {
    const project = await api.post('/api/projects').send({ name: 'Test Repo', path: repoDir });
    expect(project.status).toBe(201);
    projectId = project.body.data.id;

    const branches = await api.get(`/api/projects/${projectId}/branches`);
    expect(branches.status).toBe(200);
    expect(branches.body.data).toContain('main');

    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/test-01',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    expect(worktree.body.data.status).toBe('ready');
    expect(fs.existsSync(worktree.body.data.path)).toBe(true);

    const list = await api.get(`/api/worktrees?projectId=${projectId}`);
    expect(list.body.data).toHaveLength(1);

    const removed = await api.delete(`/api/worktrees/${worktree.body.data.id}`);
    expect(removed.status).toBe(204);
    expect(fs.existsSync(worktree.body.data.path)).toBe(false);
  });
});

describe('worktree checkpoints', () => {
  it('menyimpan status dan catatan checkpoint', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/checkpoint-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    expect(worktree.body.data.taskStatus).toBe('todo');
    expect(worktree.body.data.note).toBe('');
    const id = worktree.body.data.id;

    const patched = await api.patch(`/api/worktrees/${id}`).send({
      taskStatus: 'in-progress',
      note: 'Sedang dikerjakan agent'
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.taskStatus).toBe('in-progress');
    expect(patched.body.data.note).toBe('Sedang dikerjakan agent');

    const list = await api.get(`/api/worktrees?projectId=${projectId}`);
    const found = list.body.data.find((item: { id: string }) => item.id === id);
    expect(found.taskStatus).toBe('in-progress');
    expect(found.note).toBe('Sedang dikerjakan agent');

    const invalid = await api.patch(`/api/worktrees/${id}`).send({ taskStatus: 'ngawur' });
    expect(invalid.status).toBe(422);

    await api.delete(`/api/worktrees/${id}`);
  });
});

describe('github integration', () => {
  it('melaporkan connected:false untuk remote non-GitHub tanpa panggilan jaringan', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/github-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;

    const info = await api.get(`/api/github/info?worktreeId=${worktreeId}`);
    expect(info.status).toBe(200);
    expect(info.body.data.connected).toBe(false);
    expect(info.body.data.reason).toContain('bukan repository GitHub');

    const pulls = await api.get(`/api/github/pulls?worktreeId=${worktreeId}`);
    expect(pulls.status).toBe(422);
    expect(pulls.body.error.code).toBe('NOT_GITHUB');

    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('code search', () => {
  it('mencari teks, menghormati case sensitivity, dan menolak regex tidak valid', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/search-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;
    const worktreePath = worktree.body.data.path;
    fs.writeFileSync(path.join(worktreePath, 'search-a.txt'), 'Alpha beta\nsecond line\n');
    fs.writeFileSync(path.join(worktreePath, 'search-b.txt'), 'beta only\n');
    execFileSync('git', ['add', '-A'], { cwd: worktreePath });
    execFileSync('git', ['commit', '-qm', 'search fixtures'], { cwd: worktreePath });

    const found = await api.get(`/api/search?worktreeId=${worktreeId}&q=beta`);
    expect(found.status).toBe(200);
    expect(found.body.data.total).toBe(2);
    expect(found.body.data.files).toHaveLength(2);
    expect(found.body.data.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'search-a.txt',
      'search-b.txt'
    ]);
    expect(found.body.data.files[0].matches[0].line).toBeGreaterThan(0);
    expect(['ripgrep', 'git-grep']).toContain(found.body.meta.engine);

    const caseSensitive = await api.get(`/api/search?worktreeId=${worktreeId}&q=Alpha&caseSensitive=1`);
    expect(caseSensitive.body.data.total).toBe(1);
    const caseInsensitive = await api.get(`/api/search?worktreeId=${worktreeId}&q=alpha&caseSensitive=0`);
    expect(caseInsensitive.body.data.total).toBe(1);

    const limited = await api.get(`/api/search?worktreeId=${worktreeId}&q=beta&maxResults=1`);
    expect(limited.body.data.total).toBe(1);
    expect(limited.body.data.truncated).toBe(true);

    const invalid = await api.get(`/api/search?worktreeId=${worktreeId}&q=%5B&regex=1`);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('SEARCH_ERROR');

    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('files', () => {
  it('membaca tree, content, menulis file, dan menolak path traversal', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/files-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;
    fs.writeFileSync(path.join(worktree.body.data.path, 'hello.txt'), 'hello dorado\n');

    const tree = await api.get(`/api/files/tree?worktreeId=${worktreeId}`);
    expect(tree.status).toBe(200);
    expect(tree.body.data.some((entry: { name: string }) => entry.name === 'hello.txt')).toBe(true);

    const content = await api.get(`/api/files/content?worktreeId=${worktreeId}&path=hello.txt`);
    expect(content.status).toBe(200);
    expect(content.body.data.content).toBe('hello dorado\n');

    const saved = await api.put('/api/files/content').send({
      worktreeId,
      path: 'hello.txt',
      content: 'updated by test\n'
    });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(worktree.body.data.path, 'hello.txt'), 'utf8')).toBe('updated by test\n');

    const traversal = await api.get(`/api/files/content?worktreeId=${worktreeId}&path=..%2F..%2Fetc%2Fpasswd`);
    expect(traversal.status).toBe(422);

    const found = await api.get(`/api/files/find?worktreeId=${worktreeId}&q=hello`);
    expect(found.status).toBe(200);
    expect(found.body.data[0].path).toBe('hello.txt');
    expect(found.body.data[0].name).toBe('hello.txt');
    expect(found.body.data[0].dir).toBe('');

    const none = await api.get(`/api/files/find?worktreeId=${worktreeId}&q=zzz-tidak-ada`);
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);

    const status = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(status.status).toBe(200);
    expect(status.body.data.files.some((file: { path: string }) => file.path === 'hello.txt')).toBe(true);

    const diff = await api.get(`/api/git/diff?worktreeId=${worktreeId}&path=hello.txt`);
    expect(diff.status).toBe(200);
    expect(diff.body.data.diff).toContain('+updated by test');

    const staged = await api.post('/api/git/stage').send({ worktreeId, path: 'hello.txt' });
    expect(staged.status).toBe(200);
    const afterStage = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(afterStage.body.data.files.find((file: { path: string }) => file.path === 'hello.txt').staged).toBe(true);

    const unstaged = await api.post('/api/git/unstage').send({ worktreeId, path: 'hello.txt' });
    expect(unstaged.status).toBe(200);
    const afterUnstage = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(afterUnstage.body.data.files.find((file: { path: string }) => file.path === 'hello.txt').staged).toBe(false);

    await api.post('/api/git/stage').send({ worktreeId, path: 'hello.txt' });
    const commit = await api.post('/api/git/commit').send({ worktreeId, message: 'test: tambah hello' });
    expect(commit.status).toBe(200);
    expect(commit.body.data.hash).toMatch(/^[a-f0-9]{40}$/);
    const clean = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(clean.body.data.clean).toBe(true);

    const pushed = await api.post('/api/git/push').send({ worktreeId });
    expect(pushed.status).toBe(200);
    const bareHead = execFileSync('git', ['--git-dir', bareDir, 'rev-parse', '--verify', 'agent/files-test'], {
      encoding: 'utf8'
    }).trim();
    expect(bareHead).toMatch(/^[a-f0-9]{40}$/);

    const pulled = await api.post('/api/git/pull').send({ worktreeId });
    expect(pulled.status).toBe(200);

    const emptyCommit = await api.post('/api/git/commit').send({ worktreeId, message: 'ab' });
    expect(emptyCommit.status).toBe(422);

    const created = await api.post('/api/files/create').send({
      worktreeId,
      path: 'new-file.txt',
      type: 'file',
      content: 'new content\n'
    });
    expect(created.status).toBe(201);

    const renamed = await api.post('/api/files/rename').send({
      worktreeId,
      from: 'new-file.txt',
      to: 'renamed.txt'
    });
    expect(renamed.status).toBe(200);
    expect(fs.existsSync(path.join(worktree.body.data.path, 'renamed.txt'))).toBe(true);

    const folder = await api.post('/api/files/create').send({ worktreeId, path: 'empty-folder', type: 'dir' });
    expect(folder.status).toBe(201);

    const nonEmpty = await api.post('/api/files/create').send({
      worktreeId,
      path: 'empty-folder/nested.txt',
      type: 'file',
      content: 'nested'
    });
    expect(nonEmpty.status).toBe(201);
    const deleteNonEmpty = await api.delete(`/api/files?worktreeId=${worktreeId}&path=empty-folder`);
    expect(deleteNonEmpty.status).toBe(422);

    const deleteNested = await api.delete(`/api/files?worktreeId=${worktreeId}&path=empty-folder/nested.txt`);
    expect(deleteNested.status).toBe(204);
    const deleteEmptyFolder = await api.delete(`/api/files?worktreeId=${worktreeId}&path=empty-folder`);
    expect(deleteEmptyFolder.status).toBe(204);
    const deleteRenamed = await api.delete(`/api/files?worktreeId=${worktreeId}&path=renamed.txt`);
    expect(deleteRenamed.status).toBe(204);

    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('git graph', () => {
  it('menampilkan commit, lane, dan detail file', async () => {
    const graph = await api.get(`/api/git/graph?projectId=${projectId}`);
    expect(graph.status).toBe(200);
    expect(graph.body.data.commits.length).toBeGreaterThan(0);
    const first = graph.body.data.commits[0];
    expect(first.shortHash).toHaveLength(7);
    expect(typeof first.lane).toBe('number');
    expect(graph.body.data.maxLane).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(graph.body.data.edges)).toBe(true);

    const detail = await api.get(`/api/git/graph/commit?projectId=${projectId}&hash=${first.hash}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.hash).toBe(first.hash);
    expect(detail.body.data.files.length).toBeGreaterThan(0);

    const invalid = await api.get(`/api/git/graph/commit?projectId=${projectId}&hash=not-a-hash`);
    expect(invalid.status).toBe(422);
  });
});

describe('quick commands', () => {
  it('membuat, membaca, mengubah, dan menghapus command global/project', async () => {
    const global = await api.post('/api/quick-commands').send({ label: 'Test global', command: 'npm test' });
    expect(global.status).toBe(201);
    expect(global.body.data.scope).toBe('global');
    expect(global.body.data.projectId).toBeNull();

    const projectCommand = await api.post('/api/quick-commands').send({
      label: 'Test project',
      command: 'npm run build',
      scope: 'project',
      projectId
    });
    expect(projectCommand.status).toBe(201);
    expect(projectCommand.body.data.projectId).toBe(projectId);

    const list = await api.get(`/api/quick-commands?projectId=${projectId}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([global.body.data.id, projectCommand.body.data.id])
    );

    const globalOnly = await api.get('/api/quick-commands');
    expect(globalOnly.body.data.some((item: { id: string }) => item.id === global.body.data.id)).toBe(true);
    expect(globalOnly.body.data.some((item: { id: string }) => item.id === projectCommand.body.data.id)).toBe(false);

    const patched = await api.patch(`/api/quick-commands/${global.body.data.id}`).send({ label: 'Test global v2' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.label).toBe('Test global v2');

    const removed = await api.delete(`/api/quick-commands/${projectCommand.body.data.id}`);
    expect(removed.status).toBe(204);
    const missing = await api.delete(`/api/quick-commands/${projectCommand.body.data.id}`);
    expect(missing.status).toBe(404);
    await api.delete(`/api/quick-commands/${global.body.data.id}`);
  });

  it('menolak scope project tanpa project valid', async () => {
    const withoutProject = await api.post('/api/quick-commands').send({
      label: 'Tanpa project',
      command: 'echo x',
      scope: 'project'
    });
    expect(withoutProject.status).toBe(422);

    const unknownProject = await api.post('/api/quick-commands').send({
      label: 'Project asing',
      command: 'echo x',
      scope: 'project',
      projectId: 'tidak-ada'
    });
    expect(unknownProject.status).toBe(404);
  });
});

describe('diff comments', () => {
  it('membuat, membaca, mengubah, dan menghapus komentar diff', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/review-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;

    const created = await api.post('/api/review').send({
      worktreeId,
      path: 'src/app.ts',
      line: 12,
      body: 'Tolong pakai early return.'
    });
    expect(created.status).toBe(201);
    expect(created.body.data.line).toBe(12);
    expect(created.body.data.resolvedAt).toBeNull();

    const list = await api.get(`/api/review?worktreeId=${worktreeId}&path=src%2Fapp.ts`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const patched = await api.patch(`/api/review/${created.body.data.id}`).send({ resolved: true });
    expect(patched.status).toBe(200);
    expect(patched.body.data.resolvedAt).not.toBeNull();

    const removed = await api.delete(`/api/review/${created.body.data.id}`);
    expect(removed.status).toBe(204);
    const missing = await api.delete(`/api/review/${created.body.data.id}`);
    expect(missing.status).toBe(404);

    const invalid = await api.post('/api/review').send({ worktreeId, path: 'a.ts', line: 0, body: 'x' });
    expect(invalid.status).toBe(422);

    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('session history', () => {
  it('mencari sesi berdasarkan judul/prompt dan filter status', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/history-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, created_at, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'hist-1',
      worktreeId,
      'term-1',
      'opencode',
      'Deploy staging',
      'deploy the app to staging',
      'completed',
      now,
      now,
      now
    );
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('hist-2', worktreeId, 'term-2', 'opencode', 'Fix bug', 'fix the failing test', 'failed', now);

    const byQuery = await api.get('/api/sessions/history?q=deploy');
    expect(byQuery.status).toBe(200);
    expect(byQuery.body.data).toHaveLength(1);
    expect(byQuery.body.data[0].title).toBe('Deploy staging');
    expect(byQuery.body.data[0].projectName).toBe('Test Repo');
    expect(byQuery.body.data[0].worktreePath).toContain('agent-history-test');

    const byAgent = await api.get('/api/sessions/history?agent=opencode&projectId=' + projectId);
    expect(byAgent.body.data.length).toBeGreaterThanOrEqual(2);

    const byStatus = await api.get('/api/sessions/history?status=failed');
    expect(byStatus.body.data).toHaveLength(1);
    expect(byStatus.body.data[0].title).toBe('Fix bug');

    const none = await api.get('/api/sessions/history?q=tidak-ada');
    expect(none.body.data).toHaveLength(0);

    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('session resume', () => {
  it('membuat sesi mock dan melanjutkannya dengan args resume', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/resume-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;

    const session = await api.post('/api/sessions').send({
      worktreeId,
      agent: 'mock',
      title: 'Mock session',
      prompt: 'jalankan mock'
    });
    expect(session.status).toBe(201);
    expect(session.body.data.status).toBe('running');

    await api.post(`/api/sessions/${session.body.data.id}/stop`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const resumed = await api.post(`/api/sessions/${session.body.data.id}/resume`);
    expect(resumed.status).toBe(201);
    expect(resumed.body.data.id).not.toBe(session.body.data.id);
    expect(resumed.body.data.terminalId).not.toBe(session.body.data.terminalId);

    await api.post(`/api/sessions/${resumed.body.data.id}/stop`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('terminals', () => {
  it('membuat, membaca, dan menutup terminal shell', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/terminal-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);

    const terminal = await api.post('/api/terminals').send({
      worktreeId: worktree.body.data.id,
      title: 'Test Terminal',
      cols: 100,
      rows: 30
    });
    expect(terminal.status).toBe(201);
    expect(terminal.body.data.status).toBe('running');

    const list = await api.get(`/api/terminals?worktreeId=${worktree.body.data.id}`);
    expect(list.body.data).toHaveLength(1);

    const removed = await api.delete(`/api/terminals/${terminal.body.data.id}`);
    expect(removed.status).toBe(204);

    await api.delete(`/api/worktrees/${worktree.body.data.id}`);
  });

  it('mengirim input ke terminal yang berjalan', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/terminal-input-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const terminal = await api.post('/api/terminals').send({
      worktreeId: worktree.body.data.id,
      title: 'Input Terminal'
    });
    expect(terminal.status).toBe(201);

    const sent = await api.post(`/api/terminals/${terminal.body.data.id}/input`).send({ data: 'echo quick-command\r' });
    expect(sent.status).toBe(200);
    expect(sent.body.data.ok).toBe(true);

    const empty = await api.post(`/api/terminals/${terminal.body.data.id}/input`).send({ data: '' });
    expect(empty.status).toBe(422);

    const missing = await api.post('/api/terminals/tidak-ada/input').send({ data: 'echo x\r' });
    expect(missing.status).toBe(404);

    await api.delete(`/api/terminals/${terminal.body.data.id}`);
    await api.delete(`/api/worktrees/${worktree.body.data.id}`);
  });

  it('menolak agent yang tidak dikenal', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/unknown-test',
      baseRef: 'main'
    });
    const response = await api.post('/api/sessions').send({
      worktreeId: worktree.body.data.id,
      agent: 'tidak-ada',
      title: 'Unknown',
      prompt: 'test'
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNKNOWN_AGENT');
    await api.delete(`/api/worktrees/${worktree.body.data.id}`);
  });
});

describe('orchestrator', () => {
  let mockServer: http.Server;
  let providerId = 0;
  let agentId = 0;
  let agentToken = '';
  const requests: Array<{ method: string; url: string; body: unknown }> = [];

  function clearOrchestratorTables(): void {
    // Retry task mereferensikan task lain; nonaktifkan FK sebentar untuk cleanup test.
    db.exec(
      'PRAGMA foreign_keys = OFF; DELETE FROM task_logs; DELETE FROM tasks; DELETE FROM agents; DELETE FROM providers; DELETE FROM task_code_sequences; PRAGMA foreign_keys = ON;'
    );
  }

  beforeAll(async () => {
    clearOrchestratorTables();
    mockServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        let body: unknown = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }
        requests.push({ method: req.method ?? '', url: req.url ?? '', body });
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"status":"ok","version":"test"}');
          return;
        }
        if (req.method === 'POST' && req.url === '/tasks') {
          res.writeHead(202, { 'content-type': 'application/json' });
          res.end('{"accepted":true}');
          return;
        }
        if (req.method === 'POST' && req.url?.includes('/cancel')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"cancelled":true}');
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    clearOrchestratorTables();
  });

  function mockPort(): number {
    return (mockServer.address() as AddressInfo).port;
  }

  async function waitForTask(id: number, status: string, timeout = 4000): Promise<Record<string, unknown>> {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < timeout) {
      const response = await api.get(`/api/orchestrator/tasks/${id}`);
      last = response.body?.data?.status ?? '';
      if (last === status) return response.body.data as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Task ${id} tidak mencapai ${status}; status terakhir ${last}`);
  }

  it('mengelola provider tanpa membocorkan API key', async () => {
    const created = await api.post('/api/orchestrator/providers').send({
      name: 'Test Provider',
      providerType: 'LITELLM',
      baseUrl: 'http://127.0.0.1:9999/v1',
      apiKey: 'sk-test-12345678',
      defaultModel: 'gpt-4o-mini',
      costPer1kTokens: '0.0020'
    });
    expect(created.status).toBe(201);
    providerId = created.body.data.id;
    expect(created.body.data.apiKeyLast4).toBe('5678');
    expect(created.body.data.hasApiKey).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('sk-test-12345678');

    const list = await api.get('/api/orchestrator/providers?q=test');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('sk-test-12345678');
  });

  it('mendaftarkan agent, menyimpan token hash, dan heartbeat', async () => {
    const created = await api.post('/api/orchestrator/agents').send({
      code: 'AGT-TEST-01',
      name: 'Mock Agent',
      endpointUrl: `http://127.0.0.1:${mockPort()}`,
      providerId,
      maxConcurrency: 1
    });
    expect(created.status).toBe(201);
    agentId = created.body.data.id;
    agentToken = created.body.agentToken;
    expect(agentToken).toMatch(/^orca_agt_/);
    expect(created.body.data.status).toBe('IDLE');
    expect(findAgentByToken(agentToken)?.id).toBe(agentId);

    const list = await api.get('/api/orchestrator/agents');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(agentToken);

    await heartbeatOnce();
    const after = await api.get(`/api/orchestrator/agents/${agentId}`);
    expect(after.body.data.lastHeartbeatAt).toBeTruthy();
    expect(after.body.data.lastError).toBeNull();
  });

  it('mendispatch task, menerima callback, dan menghitung biaya half-up', async () => {
    const created = await api.post('/api/orchestrator/tasks').send({
      title: 'Task uji dispatch',
      agentId,
      providerId,
      priority: 2,
      prompt: 'jalankan task uji minimal sepuluh karakter'
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('QUEUED');
    const taskId = created.body.data.id as number;
    const taskCode = created.body.data.code as string;
    expect(taskCode).toMatch(/^TSK-\d{8}-\d{4}$/);

    await pump();
    const running = await waitForTask(taskId, 'RUNNING');
    expect(running.status).toBe('RUNNING');

    const dispatched = requests.find((item) => item.method === 'POST' && item.url === '/tasks') as
      | { body: { schema?: string; task?: { code?: string } } }
      | undefined;
    expect(dispatched?.body.schema).toBe('orca.task.v1');
    expect(dispatched?.body.task?.code).toBe(taskCode);

    const result = applyAgentResult(agentId, taskCode, {
      status: 'COMPLETED',
      tokenUsed: 2500,
      result: 'selesai'
    });
    expect(result.noop).toBe(false);

    const completed = await waitForTask(taskId, 'COMPLETED');
    expect(completed.tokenUsed).toBe(2500);
    expect(completed.costUsd).toBe('0.0050');
    expect(completed.result).toBe('selesai');

    const noop = applyAgentResult(agentId, taskCode, { status: 'COMPLETED', tokenUsed: 2500 });
    expect(noop.noop).toBe(true);

    const summary = getDashboardSummary();
    expect(summary.tasksRunning).toBe(0);
    expect(summary.costTodayUsd).toBe('0.0050');
  });

  it('idempoten membuat task dan menolak transisi yang salah', async () => {
    const key = '5d9c0a1e-6f5f-4f6f-9b0f-1a2b3c4d5e6f';
    const payload = {
      title: 'Task idempoten',
      agentId,
      providerId,
      priority: 1,
      prompt: 'prompt idempoten minimal sepuluh karakter'
    };
    const first = await api.post('/api/orchestrator/tasks').set('Idempotency-Key', key).send(payload);
    const second = await api.post('/api/orchestrator/tasks').set('Idempotency-Key', key).send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.idempotent).toBe(true);

    expect(() =>
      applyAgentResult(agentId, first.body.data.code as string, { status: 'COMPLETED', tokenUsed: 10 })
    ).toThrow();

    await api.post(`/api/orchestrator/tasks/${first.body.data.id}/cancel`).send({ reason: 'bersihkan task idempoten' });
  });

  it('membatalkan task RUNNING lalu retry menjadi QUEUED', async () => {
    const created = await api.post('/api/orchestrator/tasks').send({
      title: 'Task cancel',
      agentId,
      providerId,
      priority: 3,
      prompt: 'task untuk diuji pembatalan minimal sepuluh karakter'
    });
    expect(created.status).toBe(201);
    const taskId = created.body.data.id as number;
    await pump();
    await waitForTask(taskId, 'RUNNING');

    const cancelled = await api
      .post(`/api/orchestrator/tasks/${taskId}/cancel`)
      .send({ reason: 'batalkan untuk pengujian' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const retried = await api.post(`/api/orchestrator/tasks/${taskId}/retry`);
    expect(retried.status).toBe(201);
    expect(retried.body.data.status).toBe('QUEUED');
    expect(retried.body.data.retryOfTaskId).toBe(taskId);
    await api.post(`/api/orchestrator/tasks/${retried.body.data.id}/cancel`).send({ reason: 'bersihkan task retry' });
  });

  it('menandai task FAILED bila endpoint agent tidak dapat dihubungi', async () => {
    const updated = await api.patch(`/api/orchestrator/agents/${agentId}`).send({
      endpointUrl: 'http://127.0.0.1:1'
    });
    expect(updated.status).toBe(200);
    const created = await api.post('/api/orchestrator/tasks').send({
      title: 'Task gagal dispatch',
      agentId,
      providerId,
      priority: 2,
      prompt: 'task untuk menguji kegagalan dispatcher minimal sepuluh karakter'
    });
    expect(created.status).toBe(201);
    await pump();
    const failed = await waitForTask(created.body.data.id as number, 'FAILED');
    expect(failed.status).toBe('FAILED');
    expect(String(failed.errorMessage ?? '').length).toBeGreaterThan(0);

    const agent = await api.get(`/api/orchestrator/agents/${agentId}`);
    expect(agent.body.data.status).toBe('OFFLINE');
  });
});

describe('auth security', () => {
  it('health mengecek database dan mengirim header keamanan', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('mengganti password, mencabut sesi lain, dan mempertahankan sesi aktif', async () => {
    const second = request.agent(app);
    const secondLogin = await second.post('/api/auth/login').send({ password: 'test-password' });
    expect(secondLogin.status).toBe(200);

    const changed = await api
      .patch('/api/auth/password')
      .send({ currentPassword: 'test-password', newPassword: 'test-password-2' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.updated).toBe(true);

    const oldPassword = await request(app).post('/api/auth/login').send({ password: 'test-password' });
    expect(oldPassword.status).toBe(401);

    const third = request.agent(app);
    const thirdLogin = await third.post('/api/auth/login').send({ password: 'test-password-2' });
    expect(thirdLogin.status).toBe(200);

    expect((await api.get('/api/auth/me')).status).toBe(200);
    expect((await second.get('/api/auth/me')).status).toBe(401);

    const revoked = await api.post('/api/auth/sessions/revoke-others');
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.revoked).toBeGreaterThanOrEqual(1);
    expect((await third.get('/api/auth/me')).status).toBe(401);
    expect((await api.get('/api/auth/me')).status).toBe(200);

    const restored = await api
      .patch('/api/auth/password')
      .send({ currentPassword: 'test-password-2', newPassword: 'test-password' });
    expect(restored.status).toBe(200);
    const restoredLogin = await request(app).post('/api/auth/login').send({ password: 'test-password' });
    expect(restoredLogin.status).toBe(200);
  });

  it('logout mencabut sesi yang sedang dipakai', async () => {
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/login').send({ password: 'test-password' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('multi-user & role', () => {
  it('admin membuat viewer dan viewer hanya bisa membaca', async () => {
    const created = await api.post('/api/users').send({
      username: 'viewer-one',
      name: 'Viewer Satu',
      password: 'viewer-pass-123',
      role: 'VIEWER'
    });
    expect(created.status).toBe(201);
    expect(created.body.data.role).toBe('VIEWER');

    const viewer = request.agent(app);
    const login = await viewer.post('/api/auth/login').send({ username: 'viewer-one', password: 'viewer-pass-123' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('VIEWER');
    expect(login.body.data.user.username).toBe('viewer-one');
    expect((await viewer.get('/api/auth/me')).body.data.user.username).toBe('viewer-one');
    expect((await viewer.get('/api/projects')).status).toBe(200);
    expect((await viewer.get('/api/orchestrator/summary')).status).toBe(200);

    const blockedProject = await viewer.post('/api/projects').send({ name: 'Blocked', path: '/tmp' });
    expect(blockedProject.status).toBe(403);
    expect(blockedProject.body.error.code).toBe('FORBIDDEN');

    const blockedUser = await viewer.post('/api/users').send({
      username: 'viewer-two',
      name: 'Viewer Dua',
      password: 'viewer-pass-123',
      role: 'VIEWER'
    });
    expect(blockedUser.status).toBe(403);

    const blockedPairing = await viewer.post('/api/pairing').send({ label: 'Viewer' });
    expect(blockedPairing.status).toBe(403);
    expect((await viewer.get('/api/pairing')).status).toBe(403);
  });

  it('admin dapat menonaktifkan viewer dan mereset password', async () => {
    const created = await api.post('/api/users').send({
      username: 'viewer-two',
      name: 'Viewer Dua',
      password: 'viewer-pass-123',
      role: 'VIEWER'
    });
    expect(created.status).toBe(201);
    const userId = created.body.data.id as number;

    const viewer = request.agent(app);
    expect(
      (await viewer.post('/api/auth/login').send({ username: 'viewer-two', password: 'viewer-pass-123' })).status
    ).toBe(200);

    const disabled = await api.patch(`/api/users/${userId}`).send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.isActive).toBe(false);
    expect((await viewer.get('/api/auth/me')).status).toBe(401);

    const loginDisabled = await request(app)
      .post('/api/auth/login')
      .send({ username: 'viewer-two', password: 'viewer-pass-123' });
    expect(loginDisabled.status).toBe(401);

    const enabled = await api.patch(`/api/users/${userId}`).send({ isActive: true });
    expect(enabled.status).toBe(200);

    const reset = await api.post(`/api/users/${userId}/reset-password`).send({ newPassword: 'viewer-new-pass' });
    expect(reset.status).toBe(200);

    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ username: 'viewer-two', password: 'viewer-pass-123' });
    expect(loginOld.status).toBe(401);
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ username: 'viewer-two', password: 'viewer-new-pass' });
    expect(loginNew.status).toBe(200);
    expect(loginNew.body.data.user.role).toBe('VIEWER');
  });

  it('mencegah menonaktifkan atau menurunkan admin terakhir', async () => {
    const demote = await api.patch('/api/users/1').send({ role: 'VIEWER' });
    expect(demote.status).toBe(422);
    expect(demote.body.error.code).toBe('LAST_ADMIN');

    const disable = await api.patch('/api/users/1').send({ isActive: false });
    expect(disable.status).toBe(422);
    expect(disable.body.error.code).toBe('LAST_ADMIN');
  });
});

describe('audit log', () => {
  it('mencatat login, user, dan menolak viewer', async () => {
    const failed = await request(app)
      .post('/api/auth/login')
      .send({ username: 'viewer-one', password: 'password-salah' });
    expect(failed.status).toBe(401);

    const all = await api.get('/api/audit?limit=200');
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body.data)).toBe(true);
    expect(all.body.data.some((entry: { action: string }) => entry.action === 'LOGIN')).toBe(true);
    expect(all.body.data.some((entry: { action: string }) => entry.action === 'USER_CREATE')).toBe(true);
    expect(all.body.data.some((entry: { action: string }) => entry.action === 'LOGIN_FAILED')).toBe(true);

    const logins = await api.get('/api/audit?action=LOGIN');
    expect(logins.status).toBe(200);
    expect(logins.body.data.length).toBeGreaterThan(0);
    expect(logins.body.data.every((entry: { action: string }) => entry.action === 'LOGIN')).toBe(true);

    const searched = await api.get('/api/audit?q=viewer-one');
    expect(searched.status).toBe(200);
    expect(searched.body.data.some((entry: { username: string }) => entry.username === 'viewer-one')).toBe(true);

    const viewer = request.agent(app);
    expect(
      (await viewer.post('/api/auth/login').send({ username: 'viewer-one', password: 'viewer-pass-123' })).status
    ).toBe(200);
    expect((await viewer.get('/api/audit')).status).toBe(403);
  });
});

describe('two-factor authentication', () => {
  it('setup TOTP, login dengan kode, menolak replay, dan reset oleh admin', async () => {
    const created = await api.post('/api/users').send({
      username: 'totp-viewer',
      name: 'TOTP Viewer',
      password: 'totp-pass-123',
      role: 'VIEWER'
    });
    expect(created.status).toBe(201);
    const userId = created.body.data.id as number;

    const viewer = request.agent(app);
    expect(
      (await viewer.post('/api/auth/login').send({ username: 'totp-viewer', password: 'totp-pass-123' })).status
    ).toBe(200);
    expect((await viewer.get('/api/auth/me')).body.data.user.totpEnabled).toBe(false);

    const setup = await viewer.post('/api/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.data.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.body.data.qrDataUrl).toContain('data:image/png;base64,');
    const secret = setup.body.data.secret as string;

    const confirm = await viewer.post('/api/auth/2fa/confirm').send({ code: authenticator.generate(secret) });
    expect(confirm.status).toBe(200);
    expect((await viewer.get('/api/auth/me')).body.data.user.totpEnabled).toBe(true);

    const withoutCode = await request(app)
      .post('/api/auth/login')
      .send({ username: 'totp-viewer', password: 'totp-pass-123' });
    expect(withoutCode.status).toBe(401);
    expect(withoutCode.body.error.code).toBe('TOTP_REQUIRED');

    const code = authenticator.generate(secret);
    const withCode = await request(app)
      .post('/api/auth/login')
      .send({ username: 'totp-viewer', password: 'totp-pass-123', totpCode: code });
    expect(withCode.status).toBe(200);
    expect(withCode.body.data.user.totpEnabled).toBe(true);

    const replay = await request(app)
      .post('/api/auth/login')
      .send({ username: 'totp-viewer', password: 'totp-pass-123', totpCode: code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_TOTP');

    const reset = await api.post(`/api/users/${userId}/2fa-disable`);
    expect(reset.status).toBe(200);
    const afterReset = await request(app)
      .post('/api/auth/login')
      .send({ username: 'totp-viewer', password: 'totp-pass-123' });
    expect(afterReset.status).toBe(200);
    expect(afterReset.body.data.user.totpEnabled).toBe(false);
  });
});
