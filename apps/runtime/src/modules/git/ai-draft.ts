export interface DraftResult {
  title: string;
  body: string;
  source: 'fallback';
}

interface ChangeSummary {
  files: string[];
  insertions: number;
  deletions: number;
}

/** Ringkas `git status --short` + `git diff --shortstat`. */
export function summarizeChanges(statusShort: string, diffStat: string): ChangeSummary {
  const files = statusShort
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\S+\s+/, ''));
  const insertions = /(\d+) insertions?/.exec(diffStat);
  const deletions = /(\d+) deletions?/.exec(diffStat);
  return {
    files,
    insertions: insertions ? Number(insertions[1]) : 0,
    deletions: deletions ? Number(deletions[1]) : 0
  };
}

function detectType(files: string[]): string {
  if (files.length === 0) return 'chore';
  if (files.some((file) => /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\./.test(file))) return 'test';
  if (files.some((file) => /\.(md|mdx)$/.test(file) || /(^|\/)docs\//.test(file))) return 'docs';
  if (files.some((file) => /\.(css|scss)$/.test(file))) return 'style';
  if (files.some((file) => /(^|\/)(package\.json|.*\.config\.|tsconfig)/.test(file) || /(^|\/)\.github\//.test(file))) {
    return 'chore';
  }
  return 'feat';
}

function shortPath(file: string): string {
  return file.length > 72 ? `...${file.slice(-69)}` : file;
}

export function buildCommitDraft(statusShort: string, diffStat: string, log: string): DraftResult {
  const summary = summarizeChanges(statusShort, diffStat);
  const type = detectType(summary.files);
  const scope = summary.files[0]?.split('/')[0] ?? '';
  const title =
    summary.files.length === 0
      ? 'chore: perubahan kecil'
      : `${type}${scope ? `(${scope})` : ''}: perbarui ${summary.files.length} file`;
  const bodyLines = [
    `Menyesuaikan ${summary.files.length} file (+${summary.insertions} / -${summary.deletions}).`,
    '',
    'File:',
    ...summary.files.slice(0, 20).map((file) => `- ${shortPath(file)}`)
  ];
  const commits = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (commits.length > 0) {
    bodyLines.push('', 'Commit terakhir:', ...commits.map((line) => `- ${line}`));
  }
  return { title, body: bodyLines.join('\n'), source: 'fallback' };
}

export function buildPrDraft(branch: string, statusShort: string, diffStat: string, log: string): DraftResult {
  const summary = summarizeChanges(statusShort, diffStat);
  const title = branch.replace(/[-_/]+/g, ' ').replace(/^\s+|\s+$/g, '') || 'Update';
  const commits = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const bodyLines = [
    '## Ringkasan',
    `Perubahan pada branch \`${branch}\` (${summary.files.length} file, +${summary.insertions} / -${summary.deletions}).`,
    '',
    '## Perubahan',
    ...(summary.files.length
      ? summary.files.slice(0, 20).map((file) => `- ${shortPath(file)}`)
      : ['- (belum ada perubahan terdeteksi)']),
    '',
    '## Commit',
    ...(commits.length ? commits.map((line) => `- ${line}`) : ['- -'])
  ];
  return { title, body: bodyLines.join('\n'), source: 'fallback' };
}
