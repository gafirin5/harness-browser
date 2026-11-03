#!/usr/bin/env node
/** Memeriksa kontras WCAG 2.1 AA (>= 4.5:1) untuk pasangan warna teks/latar. */
const pairs = [
  ['text/white', '#0F172A', '#FFFFFF'],
  ['text/canvas', '#0F172A', '#F1F5F9'],
  ['muted/white', '#475569', '#FFFFFF'],
  ['muted/canvas', '#475569', '#F1F5F9'],
  ['primary/white', '#1D4ED8', '#FFFFFF'],
  ['primary/soft', '#1D4ED8', '#DBEAFE'],
  ['success/white', '#166534', '#FFFFFF'],
  ['success/soft', '#166534', '#DCFCE7'],
  ['warning/soft', '#A16207', '#FEF9C3'],
  ['danger/white', '#B91C1C', '#FFFFFF'],
  ['danger/soft', '#B91C1C', '#FEE2E2'],
  ['white/primary', '#FFFFFF', '#1D4ED8'],
  ['white/danger', '#FFFFFF', '#B91C1C'],
  ['console/text', '#F8FAFC', '#0F172A'],
  ['console/muted', '#94A3B8', '#0F172A'],
  ['table/header', '#334155', '#F8FAFC']
];

function luminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

let failed = 0;
for (const [label, foreground, background] of pairs) {
  const ratio = contrast(foreground, background);
  const ok = ratio >= 4.5;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(16)} ${ratio.toFixed(2)}:1  ${foreground} on ${background}`);
}

if (failed > 0) {
  console.error(`[check-contrast] ${failed} pasangan gagal ambang 4.5:1.`);
  process.exit(1);
}
console.log('[check-contrast] OK');
