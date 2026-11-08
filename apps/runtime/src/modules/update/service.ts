import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config, readBuildInfo } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { gitRaw } from '../../lib/git-raw.js';
import { appendUpdateHistory } from './history.js';

const execFileAsync = promisify(execFile);

export interface UpdateCommit {
  hash: string;
  subject: string;
}

export interface UpdateStatus {
  enabled: boolean;
  mode: string;
  repoRoot: string | null;
  branch: string;
  remote: string;
  currentVersion: string;
  currentCommit: string | null;
  currentSubject: string | null;
  currentTag: string | null;
  latestTag: string | null;
  upToDate: boolean;
  behindCount: number;
  commits: UpdateCommit[];
  dirty: boolean;
  restartCommand: string | null;
  error: string | null;
}

export interface UpdateStep {
  step: string;
  ok: boolean;
  output: string;
}

export interface UpdateResult {
  ok: boolean;
  steps: UpdateStep[];
  newCommit: string | null;
  restartRequired: boolean;
}

interface RunResult {
  code: number;
  output: string;
}

async function run(cmd: string, args: string[], cwd: string, timeoutMs = 600_000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', npm_config_audit: 'false', npm_config_fund: 'false' }
    });
    return { code: 0, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message || 'perintah gagal';
    return { code: typeof err.code === 'number' ? err.code : 1, output };
  }
}

/** Parsing `git log --pretty=%h\t%s` menjadi daftar commit. */
export function parseCommitLog(output: string): UpdateCommit[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split('\t');
      return { hash: hash ?? '', subject: subject ?? '' };
    });
}

export function updateAvailable(status: UpdateStatus): boolean {
  return status.enabled && !status.error && !status.upToDate && status.behindCount > 0;
}

function upstreamRef(): string {
  return `${config.updateRemote}/${config.updateBranch}`;
}

export async function getUpdateStatus(repoOverride?: string): Promise<UpdateStatus> {
  const repo = repoOverride ?? config.repoRoot;
  const status: UpdateStatus = {
    enabled: config.updateEnabled,
    mode: config.updateMode,
    repoRoot: repo,
    branch: config.updateBranch,
    remote: config.updateRemote,
    currentVersion: config.version,
    currentCommit: null,
    currentSubject: null,
    currentTag: null,
    latestTag: null,
    upToDate: false,
    behindCount: 0,
    commits: [],
    dirty: false,
    restartCommand: config.updateRestartCmd || null,
    error: null
  };

  if (!config.updateEnabled) {
    status.error = 'Pembaruan dinonaktifkan (UPDATE_ENABLED=false).';
    return status;
  }
  if (config.updateMode !== 'git') {
    status.error = 'Mode pembaruan bukan "git".';
    return status;
  }
  if (!repo) {
    status.error = 'Dorado bukan checkout git; pembaruan in-place tidak tersedia.';
    return status;
  }

  const head = await gitRaw(repo, ['rev-parse', 'HEAD']);
  status.currentCommit = head.code === 0 ? head.stdout.trim().slice(0, 12) : null;
  const subject = await gitRaw(repo, ['log', '-1', '--pretty=%s']);
  status.currentSubject = subject.code === 0 ? subject.stdout.trim() : null;
  const tag = await gitRaw(repo, ['describe', '--tags', '--abbrev=0']);
  status.currentTag = tag.code === 0 ? tag.stdout.trim() : null;
  const tags = await gitRaw(repo, ['tag', '--sort=-v:refname']);
  status.latestTag =
    tags.code === 0
      ? (tags.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)[0] ?? null)
      : null;
  const dirty = await gitRaw(repo, ['status', '--porcelain']);
  status.dirty = dirty.code === 0 && dirty.stdout.trim().length > 0;

  const fetch = await gitRaw(repo, ['fetch', config.updateRemote, config.updateBranch], 60_000);
  if (fetch.code !== 0) {
    status.error = `git fetch gagal: ${fetch.stderr.trim().slice(0, 300) || 'periksa remote/jaringan'}`;
    return status;
  }

  const log = await gitRaw(repo, ['log', '--pretty=%h\t%s', `HEAD..${upstreamRef()}`]);
  if (log.code === 0) {
    status.commits = parseCommitLog(log.stdout);
    status.behindCount = status.commits.length;
    status.upToDate = status.behindCount === 0;
  }
  return status;
}

/** Fast-forward saja (aman, tanpa histori lokal). Dipisah agar mudah diuji. */
export async function pullLatest(
  repoOverride?: string
): Promise<{ ok: boolean; output: string; newCommit: string | null }> {
  const repo = repoOverride ?? config.repoRoot;
  if (!repo) throw new AppError(422, 'NO_REPO', 'Dorado bukan checkout git.');
  await gitRaw(repo, ['fetch', config.updateRemote, config.updateBranch], 60_000);
  const merge = await run('git', ['merge', '--ff-only', upstreamRef()], repo, 60_000);
  const head = await gitRaw(repo, ['rev-parse', 'HEAD']);
  return {
    ok: merge.code === 0,
    output: merge.output,
    newCommit: head.code === 0 ? head.stdout.trim().slice(0, 12) : null
  };
}

export async function installAndBuild(): Promise<{ ok: boolean; steps: UpdateStep[] }> {
  const repo = config.repoRoot;
  if (!repo) throw new AppError(422, 'NO_REPO', 'Dorado bukan checkout git.');
  const steps: UpdateStep[] = [];
  const install = await run('npm', ['ci'], repo);
  steps.push({ step: 'npm ci', ok: install.code === 0, output: install.output.slice(-4000) });
  if (install.code !== 0) return { ok: false, steps };
  const build = await run('npm', ['run', 'build'], repo);
  steps.push({ step: 'npm run build', ok: build.code === 0, output: build.output.slice(-4000) });
  return { ok: build.code === 0, steps };
}

export async function applyUpdate(): Promise<UpdateResult> {
  if (!config.repoRoot) throw new AppError(422, 'NO_REPO', 'Dorado bukan checkout git.');
  const status = await getUpdateStatus();
  if (status.dirty) {
    throw new AppError(422, 'REPO_DIRTY', 'Working tree kotor. Commit/stash dulu sebelum update.');
  }
  const steps: UpdateStep[] = [];
  const from = { version: config.version, commit: status.currentCommit };
  const pull = await pullLatest();
  steps.push({ step: 'git merge --ff-only', ok: pull.ok, output: pull.output.slice(-4000) });
  if (!pull.ok) {
    appendUpdateHistory({
      at: new Date().toISOString(),
      from,
      to: { version: from.version, commit: pull.newCommit },
      ok: false
    });
    return { ok: false, steps, newCommit: pull.newCommit, restartRequired: false };
  }
  const build = await installAndBuild();
  steps.push(...build.steps);
  const toVersion = readBuildInfo()?.version ?? from.version;
  appendUpdateHistory({
    at: new Date().toISOString(),
    from,
    to: { version: toVersion, commit: pull.newCommit },
    ok: build.ok
  });
  return { ok: build.ok, steps, newCommit: pull.newCommit, restartRequired: build.ok };
}

export type RestartPlan =
  | { kind: 'command'; command: string; args: string[] }
  | { kind: 're-exec'; args: string[] }
  | { kind: 'none' };

/**
 * Tentukan cara restart: pakai `UPDATE_RESTART_CMD` bila ada, selain itu
 * spawn ulang proses runtime sendiri (argv saat ini). Tanpa shell.
 */
export function buildRestartPlan(restartCmd: string, argv: string[]): RestartPlan {
  const trimmed = restartCmd.trim();
  if (trimmed) {
    const [command, ...args] = trimmed.split(/\s+/);
    if (command) return { kind: 'command', command, args };
  }
  const scriptArgs = argv.filter((item) => typeof item === 'string' && item.length > 0);
  if (scriptArgs.length > 0) return { kind: 're-exec', args: scriptArgs };
  return { kind: 'none' };
}

/** Jalankan restart (detached) dan kembalikan rencananya. Pemanggil yang meng-exit. */
export function restartRuntime(): RestartPlan {
  const plan = buildRestartPlan(config.updateRestartCmd, process.argv.slice(1));
  if (plan.kind === 'command') {
    spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' }).unref();
  } else if (plan.kind === 're-exec') {
    spawn(process.execPath, plan.args, { detached: true, stdio: 'ignore', env: process.env }).unref();
  }
  return plan;
}
