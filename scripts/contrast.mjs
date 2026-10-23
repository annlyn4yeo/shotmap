// Checks WCAG contrast for every token pair we rely on, in both schemes.
// `pnpm contrast` fails on any miss; `pnpm contrast --md` prints a Markdown table.
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/tokens.css', 'utf8');
const tokens = { light: {}, dark: {} };
for (const m of css.matchAll(
  /--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi,
)) {
  tokens.light[m[1]] = m[2];
  tokens.dark[m[1]] = m[3];
}
for (const scheme of ['light', 'dark']) {
  tokens[scheme].goal = tokens[scheme].accent; // --goal aliases --accent
}

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const outcomes = ['goal', 'saved', 'off', 'blocked', 'post'];
const rules = [
  ['ink', ['paper', 'paper-2', 'paper-3'], 7, 'body text (AAA)'],
  ['ink-2', ['paper', 'paper-2', 'paper-3'], 7, 'secondary text (AAA)'],
  ['ink-3', ['paper', 'paper-2', 'paper-3'], 4.5, 'captions, labels (AA)'],
  ['line', ['paper', 'paper-2'], 3, 'boundaries, pitch lines (non-text)'],
  ['accent', ['paper'], 4.5, 'accent text (AA)'],
  ['accent', ['paper-2', 'paper-3'], 3, 'accent marks (non-text)'],
  ...outcomes
    .filter((o) => o !== 'goal')
    .flatMap((o) => [
      [o, ['paper'], 4.5, 'mark and label (AA)'],
      [o, ['paper-2', 'paper-3'], 3, 'mark (non-text)'],
    ]),
];
// Goal shares the accent value, so its marks are covered by the accent rows.

const rows = [];
let failures = 0;
for (const scheme of ['light', 'dark']) {
  const t = tokens[scheme];
  const check = (fg, bg, min, use) => {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failures++;
    rows.push({ scheme, fg, bg, min, r, ok, use, fgHex: t[fg], bgHex: t[bg] });
  };
  for (const [fg, bgs, min, use] of rules) for (const bg of bgs) check(fg, bg, min, use);
  check('accent-ink', 'accent', 4.5, 'text on accent fill (AA)');
}

if (process.argv.includes('--md')) {
  console.log('| Scheme | Foreground | Background | Ratio | Need | Use |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const x of rows) {
    console.log(
      `| ${x.scheme} | \`${x.fg}\` ${x.fgHex} | \`${x.bg}\` ${x.bgHex} | ${x.r.toFixed(2)}:1 | ${x.min}:1 | ${x.use} |`,
    );
  }
} else {
  for (const x of rows) {
    const flag = x.ok ? 'pass' : 'FAIL';
    console.log(
      `${flag}  ${x.scheme.padEnd(5)} ${x.fg.padEnd(10)} on ${x.bg.padEnd(8)} ${x.r.toFixed(2).padStart(6)}:1  (need ${x.min})  ${x.use}`,
    );
  }
}
console.log(`\n${rows.length - failures}/${rows.length} pairs pass`);
process.exit(failures ? 1 : 0);
