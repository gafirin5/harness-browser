import type { ReactNode } from 'react';

interface Heading {
  id: string;
  level: number;
  text: string;
}

function slugify(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
  let slug = base;
  let counter = 2;
  while (used.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  used.add(slug);
  return slug;
}

function extractHeadings(content: string): Heading[] {
  const used = new Set<string>();
  const headings: Heading[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2] ?? '';
    headings.push({ id: slugify(text, used), level: (match[1] ?? '').length, text });
  }
  return headings;
}

function safeUrl(url: string, image = false): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('#')) return trimmed;
  if (image && /^data:image\//i.test(trimmed)) return trimmed;
  if (!trimmed.includes(':')) return trimmed;
  return null;
}

const INLINE_PATTERN = /(!\[[^\]]*\]\([^)]+\)|\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

function renderInline(text: string, keyPrefix: string, resolveImage?: (src: string) => string | null): ReactNode[] {
  const parts = text.split(INLINE_PATTERN).filter((part) => part !== '');
  return parts.map((part, index) => {
    const key = `${keyPrefix}:${index}`;
    if (part.startsWith('![')) {
      const match = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
      if (!match) return part;
      const url = safeUrl(match[2] ?? '', true);
      if (!url) return match[1] ?? '';
      const resolved = /^(https?:|data:|#)/i.test(url) ? url : (resolveImage?.(url) ?? url);
      return <img key={key} src={resolved} alt={match[1] ?? ''} loading="lazy" />;
    }
    if (part.startsWith('[')) {
      const match = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
      if (!match) return part;
      const url = safeUrl(match[2] ?? '');
      if (!url) return match[1] ?? '';
      return (
        <a key={key} href={url} target="_blank" rel="noopener noreferrer">
          {renderInline(match[1] ?? '', key, resolveImage)}
        </a>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={key}>{renderInline(part.slice(2, -2), key, resolveImage)}</strong>;
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={key}>{renderInline(part.slice(1, -1), key, resolveImage)}</em>;
    }
    return part;
  });
}

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6})\s+/.test(line) ||
    /^\s*(```|~~~)/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*\|/.test(line)
  );
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

function renderMermaidDiagram(code: string, key: string): ReactNode | null {
  const lines = code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
  if (lines.length < 2) return null;
  const header = lines[0] ?? '';
  if (!/^(graph|flowchart)\s+(TD|TB|LR)/i.test(header)) return null;
  const dir = /LR/i.test(header) ? 'LR' : 'TD';

  const nodeLabels = new Map<string, string>();
  const edges: DiagramEdge[] = [];
  const nodeSet = new Set<string>();

  const regex =
    /^([A-Za-z0-9_-]+)(?:\[(.*?)\]|\((.*?)\))?\s*(-->|---|==>|-\.->)(?:\|(.*?)\|)?\s*([A-Za-z0-9_-]+)(?:\[(.*?)\]|\((.*?)\))?$/;

  for (const line of lines.slice(1)) {
    const match = regex.exec(line);
    if (!match) continue;
    const fromId = match[1] ?? '';
    const toId = match[6] ?? '';
    if (!fromId || !toId) continue;

    const fromLabel = match[2] || match[3] || fromId;
    const toLabel = match[7] || match[8] || toId;

    if (!nodeLabels.has(fromId) || match[2] || match[3]) nodeLabels.set(fromId, fromLabel);
    if (!nodeLabels.has(toId) || match[7] || match[8]) nodeLabels.set(toId, toLabel);

    nodeSet.add(fromId);
    nodeSet.add(toId);
    edges.push({ from: fromId, to: toId, label: match[5]?.trim() });
  }

  if (nodeSet.size === 0 || edges.length === 0) return null;

  const nodes = Array.from(nodeSet);
  const ranks = new Map<string, number>();
  nodes.forEach((id) => ranks.set(id, 0));

  for (let iter = 0; iter < nodes.length; iter += 1) {
    let changed = false;
    for (const edge of edges) {
      const fromRank = ranks.get(edge.from) ?? 0;
      const toRank = ranks.get(edge.to) ?? 0;
      if (toRank < fromRank + 1) {
        ranks.set(edge.to, Math.min(fromRank + 1, 10));
        changed = true;
      }
    }
    if (!changed) break;
  }

  const maxRank = Math.max(...Array.from(ranks.values()));
  const rankBuckets = new Map<number, string[]>();
  for (const id of nodes) {
    const r = ranks.get(id) ?? 0;
    const bucket = rankBuckets.get(r) ?? [];
    bucket.push(id);
    rankBuckets.set(r, bucket);
  }

  const maxNodesInRank = Math.max(...Array.from(rankBuckets.values()).map((b) => b.length));
  const nodeCoords = new Map<string, { x: number; y: number }>();

  let svgWidth = 360;
  let svgHeight = 200;

  if (dir === 'TD') {
    svgWidth = Math.max(360, maxNodesInRank * 130 + 40);
    svgHeight = (maxRank + 1) * 72 + 20;
    for (let r = 0; r <= maxRank; r += 1) {
      const bucket = rankBuckets.get(r) ?? [];
      bucket.forEach((id, index) => {
        const x = (svgWidth / (bucket.length + 1)) * (index + 1);
        const y = r * 72 + 36;
        nodeCoords.set(id, { x, y });
      });
    }
  } else {
    svgWidth = (maxRank + 1) * 150 + 50;
    svgHeight = Math.max(160, maxNodesInRank * 56 + 30);
    for (let r = 0; r <= maxRank; r += 1) {
      const bucket = rankBuckets.get(r) ?? [];
      bucket.forEach((id, index) => {
        const x = r * 150 + 65;
        const y = (svgHeight / (bucket.length + 1)) * (index + 1);
        nodeCoords.set(id, { x, y });
      });
    }
  }

  return (
    <div className="md-diagram-wrap" key={key}>
      <svg
        className="md-diagram"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: '100%', maxWidth: svgWidth, height: 'auto' }}
        role="img"
        aria-label="Diagram alir Mermaid"
      >
        <defs>
          <marker
            id={`arrow-${key}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--accent)" />
          </marker>
        </defs>
        {edges.map((edge, index) => {
          const from = nodeCoords.get(edge.from);
          const to = nodeCoords.get(edge.to);
          if (!from || !to) return null;
          let d = '';
          let midX = (from.x + to.x) / 2;
          let midY = (from.y + to.y) / 2;
          if (dir === 'TD') {
            const startY = from.y + 16;
            const endY = to.y - 16;
            if (Math.abs(from.x - to.x) < 4) {
              d = `M ${from.x} ${startY} L ${to.x} ${endY}`;
            } else {
              const cY = (startY + endY) / 2;
              d = `M ${from.x} ${startY} C ${from.x} ${cY}, ${to.x} ${cY}, ${to.x} ${endY}`;
            }
            midY = (startY + endY) / 2;
          } else {
            const startX = from.x + 46;
            const endX = to.x - 46;
            if (Math.abs(from.y - to.y) < 4) {
              d = `M ${startX} ${from.y} L ${endX} ${to.y}`;
            } else {
              const cX = (startX + endX) / 2;
              d = `M ${startX} ${from.y} C ${cX} ${from.y}, ${cX} ${to.y}, ${endX} ${to.y}`;
            }
            midX = (startX + endX) / 2;
          }
          return (
            <g key={`edge-${index}`}>
              <path
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.5}
                markerEnd={`url(#arrow-${key})`}
                opacity={0.8}
              />
              {edge.label ? (
                <text
                  x={midX}
                  y={midY - 4}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize={9.5}
                  fontFamily="var(--mono)"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {nodes.map((id) => {
          const pos = nodeCoords.get(id);
          if (!pos) return null;
          const label = nodeLabels.get(id) || id;
          return (
            <g className="md-diagram-node" key={`node-${id}`}>
              <rect
                x={pos.x - 46}
                y={pos.y - 15}
                width={92}
                height={30}
                rx={6}
                fill="var(--panel-2)"
                stroke="var(--border)"
                strokeWidth={1.2}
              />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fill="var(--text)"
                fontSize={11}
                fontFamily="var(--mono)"
              >
                {label.length > 13 ? `${label.slice(0, 12)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function renderBlocks(
  lines: string[],
  headings: Heading[],
  resolveImage?: (src: string) => string | null
): ReactNode[] {
  const blocks: ReactNode[] = [];
  let index = 0;
  let headingIndex = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const language = (fence[2] ?? '').trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith(marker)) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      if (language.toLowerCase() === 'mermaid') {
        const diagram = renderMermaidDiagram(code.join('\n'), `diag-${index}`);
        if (diagram) {
          blocks.push(diagram);
          continue;
        }
      }
      blocks.push(
        <pre className="md-code" key={`code-${index}`}>
          {language ? <span className="md-code-lang">{language}</span> : null}
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const text = heading[2] ?? '';
      const id = headings[headingIndex]?.id ?? `section-${headingIndex}`;
      headingIndex += 1;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(
        <Tag id={id} key={`heading-${index}`}>
          {renderInline(text, `h-${index}`, resolveImage)}
        </Tag>
      );
      index += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>{renderInline(quote.join(' '), `q-${index}`, resolveImage)}</blockquote>
      );
      continue;
    }

    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1] ?? '')) {
      const header = parseTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\s*\|/.test(lines[index] ?? '')) {
        rows.push(parseTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{renderInline(cell, `th-${index}-${cellIndex}`, resolveImage)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell, `td-${index}-${rowIndex}-${cellIndex}`, resolveImage)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2] ?? '');
      const items: string[] = [];
      const baseIndent = (listMatch[1] ?? '').length;
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(current);
        if (!match || (match[1] ?? '').length < baseIndent || /\d+\./.test(match[2] ?? '') !== ordered) break;
        items.push(match[3] ?? '');
        index += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `li-${index}-${itemIndex}`, resolveImage)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (!current.trim() || isBlockStart(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(' '), `p-${index}`, resolveImage)}</p>);
  }

  return blocks;
}

export function MarkdownPreview({
  content,
  resolveImage
}: {
  content: string;
  resolveImage?: (src: string) => string | null;
}): JSX.Element {
  const headings = extractHeadings(content);
  const blocks = renderBlocks(content.split('\n'), headings, resolveImage);

  return (
    <div className="markdown-preview">
      {headings.length > 1 ? (
        <nav className="md-toc" aria-label="Daftar isi">
          <div className="section-label">Daftar Isi</div>
          {headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              className="md-toc-link"
              style={{ paddingLeft: (heading.level - 1) * 10 }}
            >
              {heading.text}
            </a>
          ))}
        </nav>
      ) : null}
      <div className="md-content">{blocks}</div>
    </div>
  );
}

export default MarkdownPreview;
