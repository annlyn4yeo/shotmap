// Subsets the self-hosted fonts into src/assets/fonts and prints fallback metrics.
// Sources are the Fontsource variable fonts (SIL OFL 1.1). Run: pnpm fonts
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import subsetFont from 'subset-font';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const src = (pkg, file) => readFileSync(require.resolve(`${pkg}/files/${file}`));
const OUT = 'src/assets/fonts';
mkdirSync(OUT, { recursive: true });

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const str = (cps) => String.fromCodePoint(...cps);

// Keep these in sync with the unicode-range lines in src/styles/fonts.css.
const LATIN = [
  ...range(0x20, 0x7e),
  ...range(0xa0, 0xff),
  0x131,
  0x141,
  0x142,
  0x152,
  0x153,
  0x160,
  0x161,
  0x178,
  0x17d,
  0x17e,
  0x2013,
  0x2018,
  0x2019,
  0x201c,
  0x201d,
  0x2022,
  0x2026,
  0x2032,
  0x2033,
  ...range(0x2190, 0x2193),
  0x2116,
  0x2212,
  0x2248,
  0x2264,
  0x2265,
];
const LATIN_EXT = [
  ...range(0x100, 0x130),
  ...range(0x132, 0x140),
  ...range(0x143, 0x151),
  ...range(0x154, 0x15f),
  ...range(0x162, 0x177),
  ...range(0x179, 0x17c),
  ...range(0x218, 0x21b),
];

const jobs = [
  {
    out: 'archivo-latin.woff2',
    pkg: '@fontsource-variable/archivo',
    file: 'archivo-latin-wdth-normal.woff2',
    cps: LATIN,
    axes: { wght: { min: 400, max: 800 }, wdth: 100 },
  },
  {
    out: 'archivo-latin-ext.woff2',
    pkg: '@fontsource-variable/archivo',
    file: 'archivo-latin-ext-wdth-normal.woff2',
    cps: LATIN_EXT,
    axes: { wght: { min: 400, max: 800 }, wdth: 100 },
  },
  {
    out: 'azeret-mono-latin.woff2',
    pkg: '@fontsource-variable/azeret-mono',
    file: 'azeret-mono-latin-wght-normal.woff2',
    cps: LATIN,
    axes: { wght: { min: 400, max: 600 } },
  },
];

for (const j of jobs) {
  const out = await subsetFont(src(j.pkg, j.file), str(j.cps), {
    targetFormat: 'woff2',
    variationAxes: j.axes,
  });
  writeFileSync(`${OUT}/${j.out}`, out);
  console.log(`${j.out.padEnd(28)} ${(out.length / 1024).toFixed(1)} KB (raw woff2)`);
}
for (const pkg of ['archivo', 'azeret-mono']) {
  copyFileSync(
    require.resolve(`@fontsource-variable/${pkg}/LICENSE`),
    `${OUT}/LICENSE-${pkg}.txt`,
  );
}

// Fallback metrics so the swap from the system font causes no layout shift.
const SAMPLE =
  'Goal from the left side of the box saved by the keeper. Off target. Blocked. Post. ' +
  'Expected goals 0.34 in minute 67 as the striker curls it past two defenders. ' +
  'Barcelona against Athletic Club, second half, attacking from the right.';
const toBuf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const avg = (font) => {
  let w = 0;
  for (const ch of SAMPLE) w += font.charToGlyph(ch).advanceWidth;
  return w / [...SAMPLE].length / font.unitsPerEm;
};
const metrics = async (name, ttf, systemTtf) => {
  const web = opentype.parse(toBuf(ttf));
  const sys = opentype.parse(toBuf(readFileSync(systemTtf)));
  const adjust = avg(web) / avg(sys);
  const upm = web.unitsPerEm;
  const pct = (v) => `${((Math.abs(v) / upm / adjust) * 100).toFixed(2)}%`;
  console.log(
    `${name}: size-adjust ${(adjust * 100).toFixed(2)}%  ascent ${pct(web.ascender)}  ` +
      `descent ${pct(web.descender)}  line-gap ${pct(web.tables.hhea.lineGap)}`,
  );
};
const ttf = (j) =>
  subsetFont(src(j.pkg, j.file), str(LATIN), {
    targetFormat: 'truetype',
    variationAxes: j.axes,
  });
await metrics('Archivo vs Arial', await ttf(jobs[0]), 'C:/Windows/Fonts/arial.ttf');
await metrics(
  'Azeret Mono vs Courier New',
  await ttf(jobs[2]),
  'C:/Windows/Fonts/cour.ttf',
);
