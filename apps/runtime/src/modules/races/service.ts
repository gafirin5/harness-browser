import fs from 'node:fs/promises';
import path from 'node:path';
import type { Race, RaceEntry } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { createWorktree, currentBranch, git, removeWorktree, slugifyBranch } from '../../lib/git.js';
import { getProject } from '../projects/routes.js';
import { startAgentSession } from '../sessions/service.js';
import { terminalManager } from '../terminals/manager.js';
import { getWorktreeRow } from '../worktrees/routes.js';

interface RaceRow {
  id: string;
  project_id: string;
  base_branch: string;
  prompt: string;
  status: 'running' | 'completed';
  winner_worktree_id: string | null;
  created_at: string;
}

interface EntryRow {
  id: string;
  race_id: string;
  worktree_id: string;
  agent_id: string;
  session_id: string;
  status: 'running' | 'won' | 'lost';
  created_at: string;
}

export interface CreateRaceInput {
  prompt: string;
  baseBranch?: string;
  agentIds: string[];
}

interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

async function diffShortstat(worktreePath: string, baseRef: string): Promise<DiffStats> {
  try {
    const output = await git(worktreePath, ['diff', '--shortstat', baseRef]);
    const files = /(\d+) files? changed/.exec(output);
    const insertions = /(\d+) insertions?\(\+\)/.exec(output);
    const deletions = /(\d+) deletions?\(-\)/.exec(output);
    return {
      filesChanged: files ? Number(files[1]) : 0,
      insertions: insertions ? Number(insertions[1]) : 0,
      deletions: deletions ? Number(deletions[1]) : 0
    };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
}

async function buildRace(raceId: string, withStats: boolean): Promise<Race> {
  const race = db.prepare('SELECT * FROM agent_races WHERE id = ?').get(raceId) as RaceRow | undefined;
  if (!race) throw notFound('Race tidak ditemukan.');
  const entryRows = db
    .prepare('SELECT * FROM agent_race_entries WHERE race_id = ? ORDER BY created_at ASC')
    .all(raceId) as unknown as EntryRow[];

  const entries: RaceEntry[] = [];
  for (const entry of entryRows) {
    const worktree = getWorktreeRow(entry.worktree_id);
    const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get(entry.session_id) as
      | { status: string }
      | undefined;
    const stats =
      withStats && worktree
        ? await diffShortstat(worktree.path, race.base_branch)
        : { filesChanged: 0, insertions: 0, deletions: 0 };
    entries.push({
      id: entry.id,
      worktreeId: entry.worktree_id,
      agentId: entry.agent_id,
      sessionId: entry.session_id,
      branch: worktree?.branch ?? '',
      status: entry.status,
      sessionStatus: session?.status ?? 'stopped',
      ...stats
    });
  }

  return {
    id: race.id,
    projectId: race.project_id,
    baseBranch: race.base_branch,
    prompt: race.prompt,
    status: race.status,
    winnerWorktreeId: race.winner_worktree_id,
    createdAt: race.created_at,
    entries
  };
}

async function teardownEntry(projectPath: string, worktreeId: string, force: boolean): Promise<void> {
  const terminalRows = db.prepare('SELECT id FROM terminals WHERE worktree_id = ?').all(worktreeId) as Array<{
    id: string;
  }>;
  for (const terminal of terminalRows) {
    terminalManager.stop(terminal.id);
    terminalManager.remove(terminal.id);
  }
  const worktree = getWorktreeRow(worktreeId);
  if (worktree) {
    await removeWorktree(projectPath, worktree.path, force).catch(() => undefined);
    await fs.rm(worktree.path, { recursive: true, force: true }).catch(() => undefined);
    db.prepare('DELETE FROM worktrees WHERE id = ?').run(worktreeId);
  }
}

export async function createRace(projectId: string, input: CreateRaceInput): Promise<Race> {
  const project = getProject(projectId);
  if (!project) throw notFound('Project tidak ditemukan.');

  const baseBranch = input.baseBranch ?? (await currentBranch(project.path));
  if (!baseBranch) throw new AppError(422, 'NO_BASE_BRANCH', 'Tidak dapat menentukan base branch.');
  await git(project.path, ['rev-parse', '--verify', baseBranch]).catch(() => {
    throw new AppError(422, 'INVALID_BASE', `Base branch "${baseBranch}" tidak ditemukan.`);
  });

  const raceId = newId();
  const short = raceId.slice(0, 6);
  db.prepare(
    'INSERT INTO agent_races (id, project_id, base_branch, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(raceId, project.id, baseBranch, input.prompt, 'running', nowIso());

  const createdWorktrees: string[] = [];
  try {
    for (const agentId of input.agentIds) {
      const branch = `race-${short}-${slugifyBranch(agentId)}`;
      const worktreeId = newId();
      const directory = path.join(
        config.worktreesDir,
        project.id,
        `${slugifyBranch(branch)}-${worktreeId.slice(0, 6)}`
      );
      const relative = path.relative(config.worktreesDir, directory);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new AppError(422, 'INVALID_PATH', 'Path worktree tidak valid.');
      }
      await createWorktree(project.path, directory, branch, baseBranch);
      db.prepare(
        'INSERT INTO worktrees (id, project_id, branch, path, base_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(worktreeId, project.id, branch, directory, baseBranch, 'ready', nowIso());
      createdWorktrees.push(worktreeId);
      const session = startAgentSession({
        worktreeId,
        agentId,
        title: `Race ${short} · ${agentId}`,
        prompt: input.prompt,
        mode: 'run'
      });
      db.prepare(
        'INSERT INTO agent_race_entries (id, race_id, worktree_id, agent_id, session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), raceId, worktreeId, agentId, session.id, 'running', nowIso());
    }
  } catch (error) {
    for (const worktreeId of createdWorktrees) {
      await teardownEntry(project.path, worktreeId, true);
    }
    db.prepare('DELETE FROM agent_races WHERE id = ?').run(raceId);
    throw error;
  }

  return buildRace(raceId, false);
}

export function listRaces(projectId: string): Promise<Race[]> {
  const rows = db
    .prepare('SELECT id FROM agent_races WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as Array<{ id: string }>;
  return Promise.all(rows.map((row) => buildRace(row.id, false)));
}

export function getRace(raceId: string): Promise<Race> {
  return buildRace(raceId, true);
}

export async function applyWinner(raceId: string, winnerWorktreeId: string, cleanupLosers: boolean): Promise<Race> {
  const race = db.prepare('SELECT * FROM agent_races WHERE id = ?').get(raceId) as RaceRow | undefined;
  if (!race) throw notFound('Race tidak ditemukan.');
  if (race.status !== 'running') throw new AppError(422, 'RACE_FINISHED', 'Race sudah selesai.');
  const winnerEntry = db
    .prepare('SELECT * FROM agent_race_entries WHERE race_id = ? AND worktree_id = ?')
    .get(raceId, winnerWorktreeId) as EntryRow | undefined;
  if (!winnerEntry) throw notFound('Entri race tidak ditemukan.');
  const project = getProject(race.project_id);
  if (!project) throw notFound('Project tidak ditemukan.');
  const winnerWorktree = getWorktreeRow(winnerWorktreeId);
  if (!winnerWorktree) throw notFound('Worktree pemenang tidak ditemukan.');

  const dirty = (await git(project.path, ['status', '--porcelain'])).trim();
  if (dirty) {
    throw new AppError(422, 'REPO_DIRTY', 'Repository utama memiliki perubahan belum di-commit. Commit/stash dahulu.');
  }
  const head = (await git(project.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (head !== race.base_branch) {
    await git(project.path, ['checkout', race.base_branch]);
  }
  try {
    await git(project.path, [
      'merge',
      '--no-ff',
      winnerWorktree.branch,
      '-m',
      `Race ${race.id.slice(0, 6)}: terapkan ${winnerEntry.agent_id}`
    ]);
  } catch (error) {
    await git(project.path, ['merge', '--abort']).catch(() => '');
    throw error;
  }

  db.prepare('UPDATE agent_race_entries SET status = ? WHERE id = ?').run('won', winnerEntry.id);
  db.prepare('UPDATE agent_races SET status = ?, winner_worktree_id = ? WHERE id = ?').run(
    'completed',
    winnerWorktreeId,
    raceId
  );

  const losers = db
    .prepare('SELECT * FROM agent_race_entries WHERE race_id = ? AND worktree_id != ?')
    .all(raceId, winnerWorktreeId) as unknown as EntryRow[];
  for (const loser of losers) {
    db.prepare('UPDATE agent_race_entries SET status = ? WHERE id = ?').run('lost', loser.id);
    if (cleanupLosers) {
      await teardownEntry(project.path, loser.worktree_id, true);
    } else {
      const terminalRows = db
        .prepare('SELECT id FROM terminals WHERE worktree_id = ?')
        .all(loser.worktree_id) as Array<{ id: string }>;
      for (const terminal of terminalRows) terminalManager.stop(terminal.id);
    }
  }

  return buildRace(raceId, true);
}
