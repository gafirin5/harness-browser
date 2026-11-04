import { describe, expect, it } from 'vitest';
import { layoutGitGraph, parseGitLog } from '../src/modules/git/graph.js';

const F = '\x1f';
const R = '\x1e';
const log = [
  ['aaaaaaaaaaaa', 'bbbbbbbbbbbb cccccccccccc', 'Ana', 'ana@example.com', '1700000300', 'Merge branch', 'HEAD -> main'],
  ['bbbbbbbbbbbb', 'dddddddddddd', 'Budi', 'budi@example.com', '1700000200', 'Main commit', ''],
  ['cccccccccccc', 'dddddddddddd', 'Cici', 'cici@example.com', '1700000100', 'Side commit', 'agent/side'],
  ['dddddddddddd', '', 'Dodi', 'dodi@example.com', '1700000000', 'Root', 'origin/main']
]
  .map((fields) => fields.join(F) + R)
  .join('\n');

describe('parseGitLog', () => {
  it('memecah field, parent, dan dekorasi ref', () => {
    const commits = parseGitLog(log);
    expect(commits).toHaveLength(4);
    expect(commits[0].parents).toEqual(['bbbbbbbbbbbb', 'cccccccccccc']);
    expect(commits[0].refs).toEqual(['main']);
    expect(commits[3].parents).toEqual([]);
    expect(commits[3].refs).toEqual(['origin/main']);
  });
});

describe('layoutGitGraph', () => {
  it('memberi lane berbeda untuk parent merge dan membuat edge', () => {
    const graph = layoutGitGraph(parseGitLog(log));
    expect(graph.commits[0].lane).toBe(0);
    expect(graph.commits[1].lane).toBe(0);
    expect(graph.commits[2].lane).toBe(1);
    expect(graph.edges.some((edge) => edge.from === 0 && edge.to === 2)).toBe(true);
    expect(graph.maxLane).toBe(1);
  });

  it('menandai hasil yang terpotong', () => {
    const graph = layoutGitGraph(parseGitLog(log).slice(0, 2), true);
    expect(graph.truncated).toBe(true);
    expect(graph.edges.every((edge) => edge.to < 2)).toBe(true);
  });
});
