import { AppError } from '../../lib/errors.js';

export interface CiFailure {
  name: string;
  conclusion: string;
  logTail: string;
}

/** Susun prompt perbaikan CI dari kegagalan check + umpan balik review. */
export function buildCiFixPrompt(failures: CiFailure[], reviews: string[]): string {
  const parts = ['Perbaiki kegagalan CI berikut pada branch ini, lalu jalankan ulang test yang relevan.'];
  failures.forEach((failure, index) => {
    parts.push(`\n## ${index + 1}. ${failure.name} (${failure.conclusion})`);
    if (failure.logTail.trim()) parts.push('```\n' + failure.logTail.trim() + '\n```');
  });
  if (reviews.length > 0) {
    parts.push('\n## Umpan balik review');
    for (const review of reviews) parts.push(`- ${review}`);
  }
  return parts.join('\n').slice(0, 20000);
}

export function buildIssuePrompt(identifier: string, title: string, body: string): string {
  return `Kerjakan issue ${identifier}: ${title}\n\n${body.trim() || '(tanpa deskripsi)'}`.slice(0, 20000);
}

export function issueBranchName(identifier: string, title: string): string {
  const id = identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `fix/${id || 'issue'}${slug ? '-' + slug : ''}`.slice(0, 100);
}

export interface LinearIssue {
  title: string;
  description: string;
}

/** Ambil issue Linear lewat GraphQL `issueSearch`. */
export async function fetchLinearIssue(apiKey: string, identifier: string): Promise<LinearIssue> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: apiKey },
      body: JSON.stringify({
        query: 'query($term:String!){ issueSearch(query:$term, first:1){ nodes { title description } } }',
        variables: { term: identifier }
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let body: {
      data?: { issueSearch?: { nodes?: Array<{ title: string; description: string | null }> } };
      errors?: unknown;
    };
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new AppError(502, 'LINEAR_ERROR', 'Respons Linear tidak valid.');
    }
    if (!response.ok) {
      throw new AppError(502, 'LINEAR_ERROR', `Linear API mengembalikan HTTP ${response.status}.`);
    }
    const node = body.data?.issueSearch?.nodes?.[0];
    if (!node) throw new AppError(404, 'LINEAR_ISSUE_NOT_FOUND', `Issue Linear "${identifier}" tidak ditemukan.`);
    return { title: node.title, description: node.description ?? '' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as Error).name === 'AbortError') throw new AppError(504, 'LINEAR_TIMEOUT', 'Linear API timeout.');
    throw new AppError(502, 'LINEAR_ERROR', `Gagal menghubungi Linear: ${(error as Error).message.slice(0, 300)}`);
  } finally {
    clearTimeout(timer);
  }
}
