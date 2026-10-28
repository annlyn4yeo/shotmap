// Frame rate of the canvas layer under load: the stress page (/dev/stress, 5,000 synthetic shots),
// filtered and tapped on the throttled mobile profile, and swept with a mouse on the same
// throttle. A page that holds 60 frames a second draws a frame every 16.7 ms.
//
// What is measured is what the canvas adds. Tapping a legend chip re-renders and restyles the
// page, which on a 4x slower CPU costs frames whatever draws the marks, so every phase is also run
// on the same page with 100 shots (the control). The canvas holds 60 fps if its 95th percentile
// frame is within a few milliseconds of the control's, and no frame in any run is longer than the
// INP budget.
//
// The page only exists in a build made with VITE_STRESS=1, so this builds one itself, into
// dist-stress/ (git-ignored), and serves it. It needs no Worker: the page has no data.
//   FPS_N (shots, 5000), FPS_RUNS (3), FPS_COMPARE=1 (also the same marks in the SVG layer).
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import { build, preview } from 'vite';

const PORT = 4176;
const N = Number(process.env.FPS_N ?? 5000);
const RUNS = Number(process.env.FPS_RUNS ?? 3);
const COMPARE = process.env.FPS_COMPARE === '1';
/** A frame this long or shorter is a 60 fps frame with a little room (16.7 ms is the budget). */
const P95_MS = 20;
/** What the canvas may add to the 95th percentile frame of the same taps on 100 shots. */
const ADDED_MS = 4;
/** No frame, in any run, longer than the INP budget: a hitch is not an interaction that fails. */
const MAX_MS = 200;

const MOBILE = {
  width: 375,
  height: 812,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const CPU_SLOWDOWN = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

// One stamp per animation frame, in the page; `__frames` is emptied when a phase starts. A frame
// over 30 ms is also written down with the step that was under way, so a slow one can be traced.
const SAMPLER = `
window.__frames = [];
window.__long = [];
window.__slow = [];
window.__step = '';
let last = performance.now();
const tick = (now) => {
  window.__frames.push(now - last);
  if (now - last > 30) window.__slow.push(Math.round(now - last) + ' ms after ' + window.__step);
  last = now;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(e.duration); })
  .observe({ type: 'long-animation-frame', buffered: false });
`;

async function open(browser, view, url) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(view);
  if (view.isMobile) await page.setUserAgent(USER_AGENT);
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await page.evaluateOnNewDocument(SAMPLER);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.map');
  await sleep(1500);
  return { context, page };
}

/** Records the frames of whatever `action` does, and a second of quiet after it. */
async function phase(page, action) {
  await page.evaluate(
    'window.__frames.length = 0; window.__long.length = 0; window.__slow.length = 0;',
  );
  const start = Number(await page.evaluate('performance.now()'));
  await action();
  await sleep(600);
  const seconds = (Number(await page.evaluate('performance.now()')) - start) / 1000;
  const frames = await page.evaluate('window.__frames.slice()');
  const long = await page.evaluate('window.__long.slice()');
  const slow = await page.evaluate('window.__slow.slice()');
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    frames: frames.length,
    fps: frames.length / seconds,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
    over20: frames.filter((f) => f > 20).length,
    slow,
    longFrames: long.length,
    longest: Math.max(0, ...long),
  };
}

/** Toggle every outcome off, then every outcome on again, a finger at a time. */
const filtering = (page) => async () => {
  for (let round = 0; round < 2; round++)
    for (const [i, chip] of (await page.$$('.chip')).entries()) {
      await page.evaluate(`window.__step = "chip ${i}, round ${round}"`);
      await chip.tap();
      await sleep(180);
    }
};

/** Tap six places on the map, so a shot is picked and put down again. */
const picking = (page) => async () => {
  const map = await (await page.$('.map'))?.boundingBox();
  if (!map) throw new Error('no map');
  let n = 0;
  for (const [fx, fy] of [
    [0.5, 0.18],
    [0.45, 0.3],
    [0.55, 0.4],
    [0.4, 0.22],
    [0.6, 0.12],
    [0.5, 0.18],
  ]) {
    await page.evaluate(`window.__step = "tap ${n++}"`);
    await page.touchscreen.tap(map.x + map.width * fx, map.y + map.height * fy);
    await sleep(250);
  }
};

/** A mouse across the map in small steps: every step may change the shot in focus. */
const hovering = (page) => async () => {
  const map = await (await page.$('.map'))?.boundingBox();
  if (!map) throw new Error('no map');
  for (let i = 0; i <= 150; i++) {
    const t = i / 150;
    await page.mouse.move(
      map.x + map.width * (0.15 + 0.7 * t),
      map.y + map.height * (0.1 + 0.5 * Math.abs(Math.sin(t * 9))),
    );
    await sleep(16);
  }
};

// FPS_ONLY=hover (a word from a phase's name) runs just that phase.
const PHASES = [
  ['filtering (taps on the chips)', MOBILE, filtering],
  ['picking a shot (taps on the map)', MOBILE, picking],
  ['hovering (a mouse across the map)', DESKTOP, hovering],
].filter(([name]) => !process.env.FPS_ONLY || name.includes(process.env.FPS_ONLY));

const fmt = (r) =>
  `${r.fps.toFixed(1).padStart(5)} fps  median ${r.median.toFixed(1)}  p95 ${r.p95.toFixed(1)}  p99 ${r.p99.toFixed(1)}  max ${r.max.toFixed(1)} ms  (${r.over20} of ${r.frames} frames over 20 ms; ${r.longFrames} long, longest ${r.longest.toFixed(0)} ms)`;

process.env.VITE_STRESS = '1';
console.log('Building the stress page into dist-stress/ ...');
await build({ logLevel: 'error', build: { outDir: 'dist-stress', emptyOutDir: true } });
const server = await preview({
  logLevel: 'error',
  build: { outDir: 'dist-stress' },
  preview: { port: PORT, strictPort: true, host: '127.0.0.1', open: false },
});
// A window as big as the biggest page emulated in it: a headless window is 800x600, and what an
// emulated page draws below that is outside it and is never presented (see scripts/inp.mjs).
const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--window-size=1280,1000'],
});
const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${chrome.port}`,
  defaultViewport: null,
});

/** RUNS fresh pages, each with the phase; the run with the median p95 stands for the set. */
async function measure(url, [name, view, run], reference) {
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const { context, page } = await open(browser, view, url);
    if (i === 0 && reference)
      console.log(
        `  idle (reference)                    ${fmt(await phase(page, () => sleep(1500)))}`,
      );
    results.push(await phase(page, run(page)));
    await context.close();
  }
  const sorted = [...results].sort((a, b) => a.p95 - b.p95);
  const mid = sorted[Math.floor(sorted.length / 2)];
  console.log(
    `  ${name.padEnd(35)} ${fmt(mid)}   [${RUNS} runs, worst p95 ${sorted.at(-1).p95.toFixed(1)}]`,
  );
  for (const r of results)
    if (r.slow.length) console.log('      frames over 30 ms:', r.slow.join('; '));
  return { name, mid, worst: Math.max(...results.map((r) => r.max)) };
}

const stress = (n, layer) =>
  `http://127.0.0.1:${PORT}/dev/stress?n=${n}${layer === 'svg' ? '&renderer=svg' : ''}`;

try {
  console.log('\nCONTROL: the canvas layer, 100 shots');
  const control = [];
  for (const [i, def] of PHASES.entries())
    control.push(await measure(stress(100, 'canvas'), def, i === 0));

  console.log(`\nCANVAS layer, ${N} shots`);
  const canvas = [];
  for (const def of PHASES) canvas.push(await measure(stress(N, 'canvas'), def, false));

  if (COMPARE) {
    console.log(`\nSVG layer, ${N} shots (for comparison, not gated)`);
    for (const def of PHASES) await measure(stress(N, 'svg'), def, false);
  }

  console.log(
    `\nEmulation: ${CPU_SLOWDOWN}x CPU slowdown; touch phases on a 375x812 mobile profile, the hover phase on a 1280x900 window.`,
  );
  console.log(
    `Gate: p95 frame within ${ADDED_MS} ms of the 100-shot control's (or under ${P95_MS} ms), and no frame over ${MAX_MS} ms in any run.`,
  );
  for (const [i, got] of canvas.entries()) {
    const base = control[i];
    const limit = Math.max(P95_MS, base.mid.p95 + ADDED_MS);
    const ok = got.mid.p95 <= limit && got.worst <= MAX_MS;
    if (!ok) process.exitCode = 1;
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${got.name}: p95 ${got.mid.p95.toFixed(1)} ms against ${base.mid.p95.toFixed(1)} for 100 shots (limit ${limit.toFixed(1)}), ${got.mid.fps.toFixed(1)} fps, worst frame ${got.worst.toFixed(0)} ms`,
    );
  }
} finally {
  await browser.disconnect();
  await chrome.kill();
  await server.close();
}
