import type { GitCommitDetail, GitCommitFile, GitGraph, GitGraphCommit, GitGraphEdge } from '@dorado/shared';
import { AppError } from '../../lib/errors.js';
import { gitRaw } from '../../lib/git-raw.js';

const FIELD = '\x1f';
const RECORD = '\x1e';

interface ParsedCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: string[];
}

export function parseGitLog(stdout: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  for (const record of stdout.split(RECORD)) {
    const line = record.replace(/^\n+/, '');
    if (!line.trim()) continue;
    const [hash, parents, author, email, timestamp, subject, decorations] = line.split(FIELD);
    if (!hash) continue;
    const refs = (decorations ?? '')
      .split(',')
      .map((ref) => ref.trim())
      .filter(Boolean)
      .map((ref) => ref.replace(/^HEAD -> /, ''))
      .filter((ref) => ref !== 'HEAD');
    commits.push({
      hash,
      parents: (parents ?? '').split(' ').filter(Boolean),
      author: author ?? '',
      email: email ?? '',
      timestamp: Number(timestamp ?? 0),
      subject: subject ?? '',
      refs
    });
  }
  return commits;
}

/**
 * Menyusun lane graph sederhana: setiap commit mendapat satu lane, parent
 * pertama melanjutkan lane yang sama, parent tambahan (merge) membuka lane
 * baru. Cukup untuk visualisasi riwayat tanpa library tambahan.
 */
export function layoutGitGraph(commits: ParsedCommit[], truncated = false): GitGraph {
  const lanes: Array<string | null> = [];
  const laidOut: GitGraphCommit[] = commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
      lanes[lane] = commit.hash;
    }

    lanes[lane] = null;
    commit.parents.forEach((parent, parentIndex) => {
      if (lanes.includes(parent)) return;
      if (parentIndex === 0 && lanes[lane] === null) {
        lanes[lane] = parent;
        return;
      }
      let target = lanes.indexOf(null);
      if (target === -1) {
        target = lanes.length;
        lanes.push(null);
      }
      lanes[target] = parent;
    });

    return {
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      parents: commit.parents,
      author: commit.author,
      email: commit.email,
      timestamp: commit.timestamp,
      subject: commit.subject,
      refs: commit.refs,
      lane
    };
  });

  const byHash = new Map<string, number>();
  laidOut.forEach((commit, index) => byHash.set(commit.hash, index));

  const edges: GitGraphEdge[] = [];
  laidOut.forEach((commit, index) => {
    for (const parent of commit.parents) {
      const parentIndex = byHash.get(parent);
      if (parentIndex === undefined) continue;
      const parentCommit = laidOut[parentIndex];
      if (!parentCommit) continue;
      edges.push({
        from: index,
        to: parentIndex,
        fromLane: commit.lane,
        toLane: parentCommit.lane
      });
    }
  });

  const maxLane = laidOut.reduce((max, commit) => Math.max(max, commit.lane), 0);
  return { commits: laidOut, edges, maxLane, truncated };
}

export async function readGitGraph(cwd: string, limit: number): Promise<GitGraph> {
  const result = await gitRaw(cwd, [
    'log',
    '--all',
    '--date-order',
    `--max-count=${limit + 1}`,
    `--pretty=format:%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s${FIELD}%D${RECORD}`
  ]);
  if (result.code !== 0) {
    // Repository tanpa commit (HEAD belum ada) bukan error fatal.
    if (/does not have any commits|unknown revision|bad default revision/i.test(result.stderr)) {
      return { commits: [], edges: [], maxLane: 0, truncated: false };
    }
    throw new AppError(422, 'GIT_ERROR', result.stderr.trim() || 'Gagal membaca git log.');
  }
  const parsed = parseGitLog(result.stdout);
  const truncated = parsed.length > limit;
  return layoutGitGraph(parsed.slice(0, limit), truncated);
}

export async function readCommitDetail(cwd: string, hash: string): Promise<GitCommitDetail> {
  const result = await gitRaw(cwd, [
    'show',
    '--no-color',
    '--name-status',
    `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s${FIELD}%b`,
    hash
  ]);
  if (result.code !== 0) throw new AppError(422, 'GIT_ERROR', result.stderr.trim() || 'Commit tidak ditemukan.');

  const lines = result.stdout.split('\n');
  const header = lines[0] ?? '';
  const [fullHash, author, email, timestamp, subject, ...bodyParts] = header.split(FIELD);
  const body = bodyParts.join(FIELD).trim();
  const files: GitCommitFile[] = [];

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [status, ...paths] = trimmed.split('\t');
    if (!status || paths.length === 0) continue;
    const filePath = paths[paths.length - 1];
    if (!filePath) continue;
    files.push({ status, path: filePath });
  }

  return {
    hash: fullHash || hash,
    shortHash: (fullHash || hash).slice(0, 7),
    author: author ?? '',
    email: email ?? '',
    timestamp: Number(timestamp ?? 0),
    subject: subject ?? '',
    body,
    files
  };
}
