import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { buildCommitDraft, buildPrDraft, summarizeChanges } from '../src/modules/git/ai-draft.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-aidraft-repo-');
let api: ReturnType<typeof request.agent>;
let worktreeId = '';
let worktreePath = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'a@e.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'A'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# a\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'Draft Project', path: repoDir });
  const worktree = await api
    .post('/api/worktrees')
    .send({ projectId: project.body.data.id, branch: 'feature/draft', baseRef: 'main' });
  worktreeId = worktree.body.data.id;
  worktreePath = worktree.body.data.path;
});

afterAll(() => {
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('ai-draft helpers', () => {
  it('meringkas perubahan dan mendeteksi tipe commit', () => {
    const summary = summarizeChanges(' M src/a.ts\n?? b.txt', '2 files changed, 5 insertions(+), 1 deletion(-)');
    expect(summary.files).toEqual(['src/a.ts', 'b.txt']);
    expect(summary.insertions).toBe(5);
    expect(summary.deletions).toBe(1);

    const draft = buildCommitDraft(' M src/a.ts', '1 file changed, 3 insertions(+)', 'abc123 init');
    expect(draft.title).toContain('feat');
    expect(draft.body).toContain('src/a.ts');
    expect(draft.source).toBe('fallback');
  });

  it('membuat draft PR dari branch', () => {
    const draft = buildPrDraft('feat-login-flow', ' M a.ts', '1 file changed, 2 insertions(+)', 'abc init');
    expect(draft.title).toBe('feat login flow');
    expect(draft.body).toContain('Ringkasan');
  });
});

describe('ai-draft endpoint', () => {
  it('mengembalikan draft commit untuk worktree', async () => {
    fs.writeFileSync(path.join(worktreePath, 'new-file.ts'), 'export const x = 1;\n');
    const res = await api.post('/api/git/ai-draft').send({ worktreeId, target: 'commit' });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.title).toBe('string');
    expect(res.body.data.title.length).toBeGreaterThan(3);
    expect(res.body.data.body).toContain('new-file.ts');
  });
});
