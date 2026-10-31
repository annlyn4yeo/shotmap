// Checks WCAG contrast for every token pair we rely on.
// `pnpm contrast` fails on any miss; `pnpm contrast --md` prints a Markdown table.
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/tokens.css', 'utf8');
const t = {};
for (const m of css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) t[m[1]] = m[2];
t.goal = t.accent; // --goal aliases --accent

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const outcomes = ['saved', 'off', 'blocked', 'post'];
const papers = ['paper', 'paper-2', 'paper-3'];
const rules = [
  ['ink', papers, 7, 'body text (AAA)'],
  ['ink-2', papers, 7, 'secondary text (AAA)'],
  ['ink-3', papers, 4.5, 'captions, labels (AA)'],
  ['paper', ['ink'], 7, 'text on the ink scoreboard (AAA)'],
  ['on-ink-2', ['ink'], 4.5, 'secondary text on the scoreboard (AA)'],
  ['accent-on-ink', ['ink'], 4.5, 'accent text and goal mark on the scoreboard (AA)'],
  ['line', ['paper', 'paper-2'], 3, 'boundaries, pitch lines (non-text)'],
  ['accent', ['paper'], 4.5, 'accent text, goal mark (AA)'],
  ['accent', ['paper-2', 'paper-3'], 3, 'accent marks (non-text)'],
  ...outcomes.flatMap((o) => [
    [o, ['paper'], 4.5, 'mark and label (AA)'],
    [o, ['paper-2', 'paper-3'], 3, 'mark (non-text)'],
  ]),
];

// The density ramp (DESIGN.md section 9): every step is a mark that must be seen on every paper,
// neighbouring steps must be told apart, and lightness must fall step by step so it also reads in
// greyscale. The last step is --ink, not a copy of it that could drift.
const density = [1, 2, 3, 4, 5, 6].map((i) => `density-${i}`);
for (const d of density) rules.push([d, papers, 3, 'density bin (non-text)']);

const rows = [];
let failures = 0;
const check = (fg, bg, min, use) => {
  const r = ratio(t[fg], t[bg]);
  const ok = r >= min;
  if (!ok) failures++;
  rows.push({ fg, bg, min, r, ok, use, fgHex: t[fg], bgHex: t[bg] });
};
for (const [fg, bgs, min, use] of rules) for (const bg of bgs) check(fg, bg, min, use);
check('accent-ink', 'accent', 4.5, 'text on accent fill (AA)');

// A step is a different class from the next only if the two can be told apart: 1.2:1 is the
// least that separates neighbouring tints, and the ramp is darker at every step.
density.slice(1).forEach((d, i) => {
  const before = density[i];
  if (before === undefined) return;
  if (lum(t[d]) >= lum(t[before])) {
    failures++;
    console.log(`FAIL  ${d} is not darker than ${before}`);
  }
  check(before, d, 1.2, 'neighbouring density classes');
});
if (t['density-6'] !== t.ink) {
  failures++;
  console.log('FAIL  density-6 is not --ink');
}

if (process.argv.includes('--md')) {
  console.log('| Foreground | Background | Ratio | Need | Use |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const x of rows) {
    console.log(
      `| \`${x.fg}\` ${x.fgHex} | \`${x.bg}\` ${x.bgHex} | ${x.r.toFixed(2)}:1 | ${x.min}:1 | ${x.use} |`,
    );
  }
} else {
  for (const x of rows) {
    const flag = x.ok ? 'pass' : 'FAIL';
    console.log(
      `${flag}  ${x.fg.padEnd(10)} on ${x.bg.padEnd(8)} ${x.r.toFixed(2).padStart(6)}:1  (need ${x.min})  ${x.use}`,
    );
  }
}
console.log(`\n${rows.length - failures}/${rows.length} pairs pass`);
process.exit(failures ? 1 : 0);
