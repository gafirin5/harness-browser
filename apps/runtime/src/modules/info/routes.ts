import { execFileSync } from 'node:child_process';
import { Router } from 'express';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { requireAuth } from '../auth/middleware.js';
import { listAgents } from '../sessions/agents.js';

export const infoRouter = Router();

function count(table: string): number {
  const row = db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number } | undefined;
  return row?.total ?? 0;
}

function tmuxVersion(): string | null {
  try {
    return execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

infoRouter.get('/', requireAuth, (_req, res) => {
  res.json({
    data: {
      version: '0.1.0',
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      dataDir: config.dataDir,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tmux: tmuxVersion(),
      agents: listAgents(),
      counts: {
        projects: count('projects'),
        worktrees: count('worktrees'),
        terminals: count('terminals'),
        sessions: count('sessions'),
        providers: count('providers'),
        agents: count('agents'),
        tasks: count('tasks')
      }
    }
  });
});
