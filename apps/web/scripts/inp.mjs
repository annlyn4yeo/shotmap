// Records INP (Interaction to Next Paint) for a realistic session, under mobile throttling.
// Lighthouse's navigation run cannot measure INP, so this drives the real page. Two sessions:
//   match (the default): open the picker, search, pick a match, toggle a filter, select a shot.
//   player (INP_PAGE=player): the most prolific player's whole career, 203 marks drawn at once:
//     toggle a filter, select a shot, pick a season, sort the table, go back to every season.
// Run `pnpm build` first, then `pnpm inp` (INP_RUNS=5 by default).
//
// Method: Chrome's Event Timing API reports every interaction (pointer, keyboard) with
// its latency to the next paint. An interaction's latency is the longest of its events;
// INP is the worst interaction of the session (for fewer than 50 interactions, which
// is what web-vitals reports too). Event Timing only reports events of 16 ms or more
// and rounds to 8 ms, so a step with no entries was faster than 16 ms.
import { existsSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const PORT = 4174;
const RUNS = Number(process.env.INP_RUNS ?? 5);
const SEARCH = 'argentina';
const BUDGET_MS = 200;
const PAGE = process.env.INP_PAGE ?? 'match';
if (PAGE !== 'match' && PAGE !== 'player') {
  console.error('INP_PAGE must be match or player.');
  process.exit(1);
}
// Where each session starts: the hero match, or the player with the most shots in the data.
const START = { match: '/', player: '/players/5503' }[PAGE];

// Mobile: the design size (375 px), touch input, 4x CPU slowdown and Lighthouse's
// simulated slow 4G (150 ms RTT, 1638.4 Kbps down, 675 Kbps up).
const VIEWPORT = {
  width: 375,
  height: 812,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const CPU_SLOWDOWN = 4;
const NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1638.4 * 1024) / 8,
  uploadThroughput: (675 * 1024) / 8,
};

// The match page's intro animation lasts 3.2 s (INTRO_MS in useMapFrame.ts); let it finish first.
const SETTLE_MS = 3600;

const OBSERVER = `
window.__events = [];
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.interactionId > 0) {
      window.__events.push({ id: e.interactionId, name: e.name, start: e.startTime, duration: e.duration,
        delay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart });
    }
  }
}).observe({ type: 'event', durationThreshold: 16, buffered: true });
// Layout shifts that did not follow an input, summed: CLS over the whole session, not just the load.
window.__shift = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shift += e.value;
}).observe({ type: 'layout-shift', buffered: true });
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** One cold session: returns each step's slowest interaction and the run's INP. */
async function session(browser, url) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(USER_AGENT);
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', NETWORK);
  await page.evaluateOnNewDocument(OBSERVER);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.shot-layer');
  await sleep(SETTLE_MS);

  const marks = [];
  const step = async (name, action, wait) => {
    marks.push({ name, from: Number(await page.evaluate('performance.now()')) });
    await action();
    await sleep(wait);
  };
  const tap = async (selector, nth = 0) => {
    const handles = await page.$$(selector);
    if (!handles[nth]) throw new Error(`nothing to tap for ${selector}`);
    await handles[nth].tap();
  };

  // The first outcome chip that is not disabled and not "Goal": the usual legend filter.
  const toggleFilter = () => tap('.chip:not([disabled])', 1);
  if (PAGE === 'match') {
    await step('open the picker', () => tap('.pick-button'), 800);
    await step(
      `search "${SEARCH}"`,
      () => page.keyboard.type(SEARCH, { delay: 90 }),
      600,
    );
    // The results come from the API once typing pauses; wait for the matches before tapping one.
    await page.waitForSelector('[id^="opt-match-"]', { timeout: 15_000 });
    await step(
      'pick a match',
      async () => {
        await tap('[id^="opt-match-"]');
        await page.waitForFunction("!document.querySelector('dialog[open]')");
        await page.waitForSelector('.shot-layer');
      },
      SETTLE_MS,
    );
    await step('toggle a filter', toggleFilter, 1000);
    await step('select a shot', () => tap('path.shot'), 1000);
  } else {
    // The career: every shot at once, the heaviest the SVG layer is asked to draw.
    await step('toggle a filter', toggleFilter, 1000);
    await step('select a shot', () => tap('path.shot'), 1000);
    await step(
      'pick a season',
      async () => {
        await tap('.seasons-pick', 0);
        await page.waitForFunction("document.querySelectorAll('path.shot').length < 100");
      },
      1000,
    );
    await step('sort the table', () => tap('.seasons-sort', 2), 800);
    await step(
      'every season again',
      async () => {
        await tap('tfoot .seasons-pick');
        await page.waitForFunction("document.querySelectorAll('path.shot').length > 100");
      },
      1000,
    );
  }
  await sleep(500);

  const events = await page.evaluate('window.__events');
  const shift = Number(await page.evaluate('window.__shift'));
  await context.close();

  // One interaction = every event that shares an interactionId; its latency is the longest.
  const byId = new Map();
  for (const e of events) {
    const known = byId.get(e.id);
    if (!known || e.duration > known.duration) byId.set(e.id, e);
  }
  const interactions = [...byId.values()];
  const steps = marks.map((mark, i) => {
    const to = marks[i + 1]?.from ?? Infinity;
    const inside = interactions.filter((e) => e.start >= mark.from && e.start < to);
    const worst = inside.reduce((a, b) => (b.duration > a.duration ? b : a), {
      duration: 0,
    });
    return {
      name: mark.name,
      ms: worst.duration,
      count: inside.length,
      kind: worst.name,
    };
  });
  const inp = interactions.reduce((max, e) => Math.max(max, e.duration), 0);
  return { steps, inp, interactions: interactions.length, shift };
}

if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing: run `pnpm build` first.');
  process.exit(1);
}

const server = await preview({
  logLevel: 'error',
  preview: { port: PORT, strictPort: true, host: '127.0.0.1', open: false },
});
let chrome;
let browser;
try {
  chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox'],
  });
  browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${chrome.port}`,
    defaultViewport: null,
  });
  const url = `http://127.0.0.1:${PORT}${START}`;
  console.log(`INP_PAGE=${PAGE}: ${url}`);

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const run = await session(browser, url);
    runs.push(run);
    console.log(
      `run ${i + 1}: INP ${run.inp} ms, CLS ${run.shift.toFixed(4)} (${run.interactions} interactions)  ` +
        run.steps.map((s) => `${s.name}: ${s.ms || '<16'}`).join('  |  '),
    );
  }

  console.log(
    `\nEmulation: ${VIEWPORT.width}x${VIEWPORT.height} mobile, touch, ${CPU_SLOWDOWN}x CPU slowdown, slow 4G (150 ms RTT, 1.6 Mbps).`,
  );
  console.log('Per step, slowest interaction (median of runs, ms):');
  for (const [i, first] of runs[0].steps.entries()) {
    const values = runs.map((r) => r.steps[i].ms);
    console.log(
      `  ${first.name.padEnd(22)} ${median(values) || '<16'}  (max ${Math.max(...values) || '<16'})`,
    );
  }
  const inps = runs.map((r) => r.inp);
  console.log(
    `\nINP over ${runs.length} runs: median ${median(inps)} ms, worst ${Math.max(...inps)} ms, best ${Math.min(...inps)} ms (budget < ${BUDGET_MS} ms)`,
  );
  // Reported, not gated: Lighthouse gates CLS on the load, and a session's shifts are small and
  // can vary from run to run.
  const worstShift = Math.max(...runs.map((r) => r.shift));
  console.log(
    `Layout shift over the whole session, worst run: ${worstShift.toFixed(4)} (target 0)`,
  );
  if (median(inps) >= BUDGET_MS) process.exitCode = 1;
} finally {
  await browser?.disconnect();
  await chrome?.kill();
  await server.close();
}
