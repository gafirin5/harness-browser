import type { ChatBlock } from '@dorado/shared';
import { stripAnsi } from '../../lib/ansi.js';

export type { ChatBlock };

const PROMPT_PATTERN =
  /(\(\s*y\/n\s*\)|\[\s*y\/n\s*\]|\(yes\/no\)|do you want to|would you like|allow .{0,40}\?|proceed\?|continue\?|confirm\?|press (any key|enter)|\bapprove\b|\b[yY]\/[nN]\b)/i;

/**
 * Ubah transkrip PTY (TUI) menjadi blok teks best-effort: buang ANSI, pecah per
 * paragraf, dan tandai blok terakhir sebagai prompt_wait bila menyerupai
 * pertanyaan konfirmasi. Ini pendekatan heuristik (bukan chat terstruktur).
 */
export function parseChatBlocks(text: string, maxBlocks = 40): ChatBlock[] {
  const clean = stripAnsi(text).replace(/\u0000/g, '');
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((part) =>
      part
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    )
    .filter((part) => part.replace(/\s/g, '').length > 0);

  const blocks: ChatBlock[] = paragraphs.map((part, index) => ({
    id: index,
    type: 'text',
    content: part.slice(0, 4000)
  }));

  const last = blocks[blocks.length - 1];
  if (last && PROMPT_PATTERN.test(last.content)) {
    const tail = last.content.split('\n').slice(-6).join('\n');
    blocks[blocks.length - 1] = { id: last.id, type: 'prompt_wait', content: tail };
  }

  return blocks.slice(-maxBlocks);
}
