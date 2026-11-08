import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { createWorktree, currentBranch, git } from '../../lib/git.js';
import { gitRaw } from '../../lib/git-raw.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { github, githubText, parseGitHubRemote, resolveGitHubRepo } from '../github/routes.js';
import { getProject } from '../projects/routes.js';
import { startAgentSession } from '../sessions/service.js';
import { getLinearKey } from '../settings/service.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { buildCiFixPrompt, buildIssuePrompt, fetchLinearIssue, issueBranchName, type CiFailure } from './service.js';

const fixCiSchema = z.object({
  agentId: z.string().min(1).max(60),
  title: z.string().trim().min(1).max(120).optional()
});

const fromIssueSchema = z.object({
  source: z.enum(['github', 'linear']),
  identifier: z.string().trim().min(1).max(80),
  title: z.string().trim().max(200).optional(),
  body: z.string().max(20000).optional(),
  agentId: z.string().min(1).max(60),
  baseBranch: z.string().trim().max(200).optional(),
  branch: z.string().trim().max(200).optional()
});

async function createWorktreeForBranch(
  projectPath: string,
  projectId: string,
  branch: string,
  baseBranch: string
): Promise<string> {
  const worktreeId = newId();
  const directory = path.join(
    config.worktreesDir,
    projectId,
    `${branch.replace(/[^a-z0-9]+/gi, '-')}-${worktreeId.slice(0, 6)}`
  );
  const relative = path.relative(config.worktreesDir, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(422, 'INVALID_PATH', 'Path worktree tidak valid.');
  }
  await createWorktree(projectPath, directory, branch, baseBranch);
  db.prepare(
    'INSERT INTO worktrees (id, project_id, branch, path, base_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(worktreeId, projectId, branch, directory, baseBranch, 'ready', nowIso());
  return worktreeId;
}

export const triageRouter = Router();
triageRouter.use(csrfGuard, requireAuth);

triageRouter.get(
  '/worktrees/:id/checks',
  asyncHandler(async (req, res) => {
    const worktreeId = String(req.params.id ?? '');
    const worktree = getWorktreeRow(worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const ref = await resolveGitHubRepo(worktreeId);
    const sha = (await git(worktree.path, ['rev-parse', 'HEAD'])).trim();
    const data = await github<{
      check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string }>;
    }>(`/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs`);
    res.json({
      data: {
        sha,
        checks: data.check_runs.map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          htmlUrl: check.html_url
        }))
      }
    });
  })
);

triageRouter.post(
  '/worktrees/:id/fix-ci',
  asyncHandler(async (req, res) => {
    const worktreeId = String(req.params.id ?? '');
    const worktree = getWorktreeRow(worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const body = parseWith(fixCiSchema, req.body);
    const ref = await resolveGitHubRepo(worktreeId);
    const sha = (await git(worktree.path, ['rev-parse', 'HEAD'])).trim();

    const runs = await github<{
      workflow_runs: Array<{ id: number; name: string; conclusion: string | null }>;
    }>(`/repos/${ref.owner}/${ref.repo}/actions/runs?head_sha=${sha}&per_page=10`);
    const failures: CiFailure[] = [];
    for (const run of runs.workflow_runs) {
      if (run.conclusion !== 'failure' && run.conclusion !== 'timed_out') continue;
      const jobs = await github<{ jobs: Array<{ id: number; name: string; conclusion: string | null }> }>(
        `/repos/${ref.owner}/${ref.repo}/actions/runs/${run.id}/jobs`
      );
      for (const job of jobs.jobs) {
        if (job.conclusion !== 'failure' && job.conclusion !== 'timed_out') continue;
        const log = await githubText(`/repos/${ref.owner}/${ref.repo}/actions/jobs/${job.id}/logs`).catch(() => '');
        failures.push({
          name: `${run.name} · ${job.name}`,
          conclusion: job.conclusion ?? 'failure',
          logTail: log.split('\n').slice(-80).join('\n')
        });
      }
    }
    if (failures.length === 0) {
      throw new AppError(422, 'NO_FAILURES', 'Tidak ada kegagalan CI pada commit HEAD.');
    }

    const reviews: string[] = [];
    const pulls = await github<Array<{ number: number }>>(`/repos/${ref.owner}/${ref.repo}/commits/${sha}/pulls`).catch(
      () => []
    );
    if (pulls[0]) {
      const prReviews = await github<Array<{ state: string; body: string | null }>>(
        `/repos/${ref.owner}/${ref.repo}/pulls/${pulls[0].number}/reviews`
      ).catch(() => []);
      for (const review of prReviews) {
        if (review.state === 'CHANGES_REQUESTED' && review.body) reviews.push(review.body);
      }
    }

    const prompt = buildCiFixPrompt(failures, reviews);
    const session = startAgentSession({
      worktreeId: worktree.id,
      agentId: body.agentId,
      title: body.title ?? 'Perbaiki CI',
      prompt,
      mode: 'run'
    });
    res.status(201).json({ data: { sessionId: session.id, failures: failures.length, reviews: reviews.length } });
  })
);

triageRouter.post(
  '/projects/:id/from-issue',
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id ?? '');
    const project = getProject(projectId);
    if (!project) throw notFound('Project tidak ditemukan.');
    const body = parseWith(fromIssueSchema, req.body);

    let title = body.title?.trim() ?? '';
    let description = body.body ?? '';
    if (!title) {
      if (body.source === 'github') {
        const remote = await gitRaw(project.path, ['remote', 'get-url', 'origin']);
        const ref = remote.code === 0 ? parseGitHubRemote(remote.stdout.trim()) : null;
        if (!ref) throw new AppError(422, 'NOT_GITHUB', 'Remote bukan repository GitHub.');
        const issue = await github<{ title: string; body: string | null }>(
          `/repos/${ref.owner}/${ref.repo}/issues/${encodeURIComponent(body.identifier)}`
        );
        title = issue.title;
        description = issue.body ?? '';
      } else {
        const apiKey = getLinearKey();
        if (!apiKey) throw new AppError(422, 'LINEAR_KEY_MISSING', 'LINEAR_API_KEY belum diatur.');
        const issue = await fetchLinearIssue(apiKey, body.identifier);
        title = issue.title;
        description = issue.description;
      }
    }

    const baseBranch = body.baseBranch ?? (await currentBranch(project.path)) ?? 'main';
    const branch = body.branch ?? issueBranchName(body.identifier, title);
    const worktreeId = await createWorktreeForBranch(project.path, project.id, branch, baseBranch);
    const session = startAgentSession({
      worktreeId,
      agentId: body.agentId,
      title: `Issue ${body.identifier}`,
      prompt: buildIssuePrompt(body.identifier, title, description),
      mode: 'run'
    });
    res.status(201).json({ data: { worktreeId, sessionId: session.id, branch } });
  })
);
