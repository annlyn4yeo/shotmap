import { writeFileSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { preview } from 'vite';

// The preview server runs in this process, so there is no child to leak (on Windows a
// killed shell left `vite preview` running, and a later run quietly measured that old
// server). If port 4173 is taken, Vite takes the next free one and we use its URL.
const server = await preview({
  logLevel: 'error',
  preview: { port: 4173, strictPort: false, open: false },
});

let chrome;
try {
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('preview server has no URL (run `pnpm build` first)');
  chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox'],
  });
  // Defaults are mobile emulation with simulated slow 4G + 4x CPU throttle.
  const result = await lighthouse(url, {
    port: chrome.port,
    output: 'html',
    logLevel: 'error',
  });
  if (!result) throw new Error('Lighthouse returned no result');
  writeFileSync('lh-report.html', result.report);
  const { categories, audits } = result.lhr;
  for (const c of Object.values(categories)) {
    console.log(`${c.title.padEnd(16)} ${Math.round((c.score ?? 0) * 100)}`);
  }
  for (const id of [
    'largest-contentful-paint',
    'cumulative-layout-shift',
    'total-blocking-time',
  ]) {
    console.log(`${audits[id]?.title ?? id}: ${audits[id]?.displayValue}`);
  }
  console.log(`Report: lh-report.html (${url})`);
} finally {
  await chrome?.kill();
  await server.close();
}
