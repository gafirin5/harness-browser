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

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_PATTERN).filter((part) => part !== '');
  return parts.map((part, index) => {
    const key = `${keyPrefix}:${index}`;
    if (part.startsWith('![')) {
      const match = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
      if (!match) return part;
      const url = safeUrl(match[2] ?? '', true);
      if (!url) return match[1] ?? '';
      return <img key={key} src={url} alt={match[1] ?? ''} loading="lazy" />;
    }
    if (part.startsWith('[')) {
      const match = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
      if (!match) return part;
      const url = safeUrl(match[2] ?? '');
      if (!url) return match[1] ?? '';
      return (
        <a key={key} href={url} target="_blank" rel="noopener noreferrer">
          {renderInline(match[1] ?? '', key)}
        </a>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>;
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>;
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

function renderBlocks(lines: string[], headings: Heading[]): ReactNode[] {
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
          {renderInline(text, `h-${index}`)}
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
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(quote.join(' '), `q-${index}`)}</blockquote>);
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
                  <th key={cellIndex}>{renderInline(cell, `th-${index}-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderInline(cell, `td-${index}-${rowIndex}-${cellIndex}`)}</td>
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
            <li key={itemIndex}>{renderInline(item, `li-${index}-${itemIndex}`)}</li>
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
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(' '), `p-${index}`)}</p>);
  }

  return blocks;
}

export function MarkdownPreview({ content }: { content: string }): JSX.Element {
  const headings = extractHeadings(content);
  const blocks = renderBlocks(content.split('\n'), headings);

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
