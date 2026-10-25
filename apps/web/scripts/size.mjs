import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const kb = (n) => (n / 1024).toFixed(2).padStart(8) + ' KB';
const totals = {};
const sizes = new Map();
const data = { files: 0, raw: 0, gzip: 0, max: 0 };
for (const file of walk('dist')) {
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  const ext = extname(file).slice(1);
  const path = file.split(String.fromCharCode(92)).join('/');
  if (path.startsWith('dist/data/')) {
    // Generated data: one summary line instead of 150.
    data.files++;
    data.raw += buf.length;
    data.gzip += gz;
    data.max = Math.max(data.max, gz);
    continue;
  }
  totals[ext] = (totals[ext] ?? 0) + gz;
  sizes.set(path, gz);
  console.log(`${path.padEnd(40)} raw ${kb(buf.length)}  gzip ${kb(gz)}`);
}
console.log(
  `${`dist/data/ (${data.files} files)`.padEnd(40)} raw ${kb(data.raw)}  gzip ${kb(data.gzip)}  largest ${kb(data.max)}`,
);
console.log('\nGzip totals by type (data is fetched on demand, not part of first load):');
for (const [ext, n] of Object.entries(totals)) console.log(`  ${ext.padEnd(6)} ${kb(n)}`);

// Hard gates, from the budgets in CLAUDE.md. "KB" is 1024 bytes here, as in every number
// above. Initial JS and CSS are the files index.html loads, so a lazy chunk added later
// does not count against the first load.
const KB = 1024;
const html = readFileSync('dist/index.html', 'utf8');
const initial = (re) => [...html.matchAll(re)].map((m) => `dist/${m[1]}`);
const sum = (files) => files.reduce((n, f) => n + (sizes.get(f) ?? 0), 0);
const js = initial(/(?:src|href)="\/(assets\/[^"]+\.js)"/g);
const css = initial(/href="\/(assets\/[^"]+\.css)"/g);
const fonts = [...sizes].filter(([f]) => f.endsWith('.woff2'));

console.log('\nBudget gates (gzip, the same KB as above):');
let failed = false;
const gate = (label, size, limit) => {
  const ok = size <= limit;
  failed ||= !ok;
  console.log(
    `  ${ok ? 'pass' : 'FAIL'}  ${label.padEnd(36)} ${kb(size)} of ${kb(limit)}`,
  );
};
if (js.length === 0 || css.length === 0) {
  failed = true;
  console.log('  FAIL  could not find the JS and CSS that dist/index.html loads');
}
gate(`initial JS (${js.length} file${js.length === 1 ? '' : 's'})`, sum(js), 90 * KB);
gate(`initial CSS (${css.length} file${css.length === 1 ? '' : 's'})`, sum(css), 20 * KB);
for (const [file, size] of fonts)
  gate(file.replace('dist/assets/', 'font '), size, 60 * KB);
if (failed) process.exitCode = 1;
