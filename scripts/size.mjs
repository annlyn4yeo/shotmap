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
  console.log(`${path.padEnd(40)} raw ${kb(buf.length)}  gzip ${kb(gz)}`);
}
console.log(
  `${`dist/data/ (${data.files} files)`.padEnd(40)} raw ${kb(data.raw)}  gzip ${kb(data.gzip)}  largest ${kb(data.max)}`,
);
console.log('\nGzip totals by type (data is fetched on demand, not part of first load):');
for (const [ext, n] of Object.entries(totals)) console.log(`  ${ext.padEnd(6)} ${kb(n)}`);
console.log(
  'Budgets: JS <= 90 KB, CSS <= 20 KB, each font <= 60 KB (woff2 is already compressed).',
);
