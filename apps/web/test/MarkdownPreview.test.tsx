import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownPreview } from '../src/components/MarkdownPreview';

const markdown = [
  '# Judul',
  '',
  '## Bagian',
  '',
  '**tebal** dan [link aman](https://example.com) serta [link jahat](javascript:alert(1)).',
  '',
  '- satu',
  '- dua',
  '',
  '| Kolom A | Kolom B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '![gambar](https://example.com/a.png)'
].join('\n');

describe('MarkdownPreview', () => {
  it('merender heading, TOC, inline, list, tabel, code, dan gambar', () => {
    render(<MarkdownPreview content={markdown} />);

    expect(screen.getByText('Daftar Isi')).toBeTruthy();
    expect(document.querySelectorAll('.md-toc-link')).toHaveLength(2);
    expect(document.querySelector('.md-content h1')?.textContent).toBe('Judul');
    expect(document.querySelector('.md-content h2')?.textContent).toBe('Bagian');
    expect(screen.getByText('tebal')).toBeTruthy();
    expect(screen.getByText('satu')).toBeTruthy();
    expect(screen.getByText('Kolom A')).toBeTruthy();
    expect(screen.getByText('const x = 1;')).toBeTruthy();
    expect(screen.getByAltText('gambar')).toBeTruthy();
  });

  it('menolak URL javascript dan hanya menyisakan teks link', () => {
    render(<MarkdownPreview content={markdown} />);
    const link = screen.getByText('link aman');
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('rel')).toContain('noopener');

    const anchors = Array.from(document.querySelectorAll('.md-content a'));
    expect(anchors.some((element) => element.textContent === 'link jahat')).toBe(false);
    expect(anchors.every((element) => !/javascript:/i.test(element.getAttribute('href') ?? ''))).toBe(true);
  });
});
