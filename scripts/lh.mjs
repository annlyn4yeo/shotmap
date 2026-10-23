import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PORT = 4173;
const url = `http://localhost:${PORT}/`;
const server = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    shell: true,
  },
);

const ready = async () => {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start (run `pnpm build` first)');
};

let chrome;
try {
  await ready();
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
  console.log('Report: lh-report.html');
} finally {
  await chrome?.kill();
  server.kill();
}
