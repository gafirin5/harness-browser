import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { gitRaw } from '../../lib/git-raw.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const querySchema = z.object({
  worktreeId: z.string().min(1),
  state: z.enum(['open', 'closed', 'all']).optional().default('open')
});
const numberSchema = z.object({
  worktreeId: z.string().min(1),
  number: z.coerce.number().int().positive()
});

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export function parseGitHubRemote(remote: string): GitHubRepoRef | null {
  const value = remote.trim();
  const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(value);
  if (sshMatch?.[1] && sshMatch[2]) return { owner: sshMatch[1], repo: sshMatch[2] };
  const gitMatch = /^git:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(value);
  if (gitMatch?.[1] && gitMatch[2]) return { owner: gitMatch[1], repo: gitMatch[2] };
  try {
    const url = new URL(value);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1]?.replace(/\.git$/, '');
    if (!owner || !repo) return null;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function remoteUrl(worktreeId: string): Promise<string | null> {
  const worktree = getWorktreeRow(worktreeId);
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  const direct = await gitRaw(worktree.path, ['remote', 'get-url', 'origin']);
  if (direct.code === 0 && direct.stdout.trim()) return direct.stdout.trim();
  const remotes = await gitRaw(worktree.path, ['remote']);
  const first = remotes.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];
  if (!first) return null;
  const result = await gitRaw(worktree.path, ['remote', 'get-url', first]);
  return result.code === 0 ? result.stdout.trim() : null;
}

interface CacheEntry {
  expiresAt: number;
  data: unknown;
}
const cache = new Map<string, CacheEntry>();

async function github<T>(path: string): Promise<T> {
  const key = path;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data as T;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dorado-orchestrator',
        ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {})
      },
      signal: controller.signal
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message =
        (body as { message?: string } | null)?.message ?? `GitHub API mengembalikan HTTP ${response.status}.`;
      throw new AppError(502, 'GITHUB_ERROR', message.slice(0, 500));
    }
    cache.set(key, { data: body, expiresAt: Date.now() + 60_000 });
    return body as T;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as Error).name === 'AbortError') throw new AppError(504, 'GITHUB_TIMEOUT', 'GitHub API timeout.');
    throw new AppError(502, 'GITHUB_ERROR', `Gagal menghubungi GitHub: ${(error as Error).message.slice(0, 300)}`);
  } finally {
    clearTimeout(timer);
  }
}

interface RepoResponse {
  full_name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  open_issues_count: number;
  stargazers_count: number;
  private: boolean;
}

interface PullResponse {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  html_url: string;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
  updated_at: string;
}

interface IssueResponse {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string } | null;
  labels: Array<{ name: string; color: string }>;
  pull_request?: unknown;
  updated_at: string;
}

export const githubRouter = Router();
githubRouter.use(csrfGuard, requireAuth);

githubRouter.get(
  '/info',
  asyncHandler(async (req, res) => {
    const query = parseWith(querySchema, req.query);
    const remote = await remoteUrl(query.worktreeId);
    if (!remote) {
      res.json({ data: { connected: false, reason: 'Repository belum memiliki remote.', remote: null } });
      return;
    }
    const ref = parseGitHubRemote(remote);
    if (!ref) {
      res.json({ data: { connected: false, reason: 'Remote bukan repository GitHub.', remote } });
      return;
    }
    const repo = await github<RepoResponse>(`/repos/${ref.owner}/${ref.repo}`);
    res.json({
      data: {
        connected: true,
        remote,
        ref,
        repo: {
          fullName: repo.full_name,
          description: repo.description,
          htmlUrl: repo.html_url,
          defaultBranch: repo.default_branch,
          openIssuesCount: repo.open_issues_count,
          stars: repo.stargazers_count,
          private: repo.private
        }
      }
    });
  })
);

githubRouter.get(
  '/pulls',
  asyncHandler(async (req, res) => {
    const query = parseWith(querySchema, req.query);
    const remote = await remoteUrl(query.worktreeId);
    const ref = remote ? parseGitHubRemote(remote) : null;
    if (!ref) throw new AppError(422, 'NOT_GITHUB', 'Remote bukan repository GitHub.');
    const pulls = await github<PullResponse[]>(
      `/repos/${ref.owner}/${ref.repo}/pulls?state=${query.state}&per_page=30&sort=updated&direction=desc`
    );
    res.json({
      data: pulls.map((pull) => ({
        number: pull.number,
        title: pull.title,
        state: pull.state,
        draft: pull.draft,
        htmlUrl: pull.html_url,
        author: pull.user?.login ?? 'ghost',
        head: pull.head.ref,
        base: pull.base.ref,
        updatedAt: pull.updated_at
      }))
    });
  })
);

githubRouter.get(
  '/issues',
  asyncHandler(async (req, res) => {
    const query = parseWith(querySchema, req.query);
    const remote = await remoteUrl(query.worktreeId);
    const ref = remote ? parseGitHubRemote(remote) : null;
    if (!ref) throw new AppError(422, 'NOT_GITHUB', 'Remote bukan repository GitHub.');
    const issues = await github<IssueResponse[]>(
      `/repos/${ref.owner}/${ref.repo}/issues?state=${query.state}&per_page=30&sort=updated&direction=desc`
    );
    res.json({
      data: issues
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          htmlUrl: issue.html_url,
          author: issue.user?.login ?? 'ghost',
          labels: issue.labels.map((label) => ({ name: label.name, color: label.color })),
          updatedAt: issue.updated_at
        }))
    });
  })
);

githubRouter.get(
  '/pull',
  asyncHandler(async (req, res) => {
    const query = parseWith(numberSchema, req.query);
    const remote = await remoteUrl(query.worktreeId);
    const ref = remote ? parseGitHubRemote(remote) : null;
    if (!ref) throw new AppError(422, 'NOT_GITHUB', 'Remote bukan repository GitHub.');
    const pull = await github<
      PullResponse & { body: string | null; additions: number; deletions: number; changed_files: number }
    >(`/repos/${ref.owner}/${ref.repo}/pulls/${query.number}`);
    res.json({
      data: {
        number: pull.number,
        title: pull.title,
        state: pull.state,
        draft: pull.draft,
        htmlUrl: pull.html_url,
        author: pull.user?.login ?? 'ghost',
        head: pull.head.ref,
        base: pull.base.ref,
        body: pull.body,
        additions: pull.additions,
        deletions: pull.deletions,
        changedFiles: pull.changed_files,
        updatedAt: pull.updated_at
      }
    });
  })
);
