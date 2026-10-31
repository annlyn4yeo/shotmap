import { writeFileSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse, { startFlow } from 'lighthouse';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

// Lighthouse on the built app (mobile preset: simulated slow 4G, 4x CPU), LH_RUNS times per page
// (3 by default), judged on the median. The budgets are CLAUDE.md's, tightened to the margins
// MIGRATION.md steps 9 and 11 asked to keep: a miss sets a non-zero exit code. /v1 is forwarded
// by the preview server, so a Worker must be running (see vite.config.ts).
//
// Every kind of route is here: the match page, browse, a player (a career and a season), the
// comparison, and the search. Search is a dialog over a page, not an address, so it is measured
// as a user flow (see `SEARCH`).
//
// The preview server runs in this process, so there is no child to leak (on Windows a
// killed shell left `vite preview` running, and a later run quietly measured that old
// server). If port 4173 is taken, Vite takes the next free one and we use its URL.
const RUNS = Number(process.env.LH_RUNS ?? 3);
const PAGES = [
  // The match page: the hero is inlined, so nothing waits for the API.
  {
    name: 'home',
    path: '/',
    budget: { performance: 97, accessibility: 100, lcpMs: 1600, cls: 0 },
    report: 'lh-report.html',
  },
  // The browse page: its own file, then the API, so it is allowed the app's 2.0 s LCP.
  {
    name: 'matches',
    path: '/matches',
    budget: { performance: 90, accessibility: 100, lcpMs: 2000, cls: 0 },
    report: 'lh-report-matches.html',
  },
  // The player with the most shots in the data (Lionel Messi: 1,297 in 253 matches), his page as it
  // opens: the biggest profile there is and a table of seven seasons, and no marks, because a career
  // is far more than the page draws. Its own file, then the profile: the app's 2.0 s LCP, and
  // CLAUDE.md's 95, since nothing here is allowed to be slow.
  {
    name: 'player',
    path: '/players/5503',
    budget: { performance: 95, accessibility: 100, lcpMs: 2000, cls: 0 },
    report: 'lh-report-player.html',
  },
  // The busiest season anyone has (Cristiano Ronaldo, La Liga 2015/16: 228 shots, every one drawn,
  // and no season in the data has more than 300): the profile, then the shots, then the marks.
  // (With the per-mark intro this page scored 90: it plays none.)
  {
    name: 'player-season',
    path: '/players/5207?competition=11&season=27',
    budget: { performance: 95, accessibility: 100, lcpMs: 2000, cls: 0 },
    report: 'lh-report-player-season.html',
  },
  // The comparison of the two busiest careers in the data: its own file, then four requests at once
  // (two players and the squares of each), then two maps on one scale. The player page's budget:
  // the same route, asked for twice over.
  {
    name: 'compare',
    path: '/compare?a=5503&b=5207',
    budget: { performance: 95, accessibility: 100, lcpMs: 2000, cls: 0 },
    report: 'lh-report-compare.html',
  },
];

// The search: a reader opens the sheet over the match page and types a name. A timespan holds the
// layout shift, blocking time and the slowest interaction (INP) of doing that, and a snapshot taken
// with the results listed holds the accessibility of the sheet as it stands. No page load is judged
// here (the match page's own is `home`).
const SEARCH = {
  name: 'search',
  query: 'messi',
  budget: { accessibility: 100, inpMs: 200, cls: 0 },
  report: 'lh-report-search.html',
};

// LH_ONLY=home (or matches, player, compare, search, or several comma-separated) audits only those,
// for comparing one page between builds.
const only = process.env.LH_ONLY?.split(',');
const wanted = (name) => !only || only.includes(name);
const pages = PAGES.filter((p) => wanted(p.name));

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const score = (category) => Math.round((category?.score ?? 0) * 100);

const server = await preview({
  logLevel: 'error',
  preview: { port: 4173, strictPort: false, open: false },
});

/**
 * One pass over the search: load the match page, open the sheet and type, wait for the results,
 * then audit what is on screen. The interactions are real input events, so INP is the browser's own.
 */
async function searchPass(base, chrome) {
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${chrome.port}`,
    defaultViewport: null,
  });
  try {
    const page = await browser.newPage();
    const flow = await startFlow(page, { name: 'Search' });
    await flow.navigate(new URL('/', base).href, { name: 'The match page' });
    await flow.startTimespan({ name: 'Open the search and type a name' });
    await page.click('.pick-button');
    await page.waitForSelector('dialog.picker[open] .picker-input');
    await page.type('.picker-input', SEARCH.query, { delay: 80 });
    await page.waitForSelector('dialog.picker [role="option"]');
    // Let the list settle (and any shift in it show) before the timespan ends.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await flow.endTimespan();
    await flow.snapshot({ name: 'The results listed' });
    const { steps } = await flow.createFlowResult();
    const typing = steps[1]?.lhr.audits;
    const listed = steps[2]?.lhr.categories;
    if (!typing || !listed) throw new Error('the flow did not produce its steps');
    return {
      report: await flow.generateReport(),
      inpMs: typing['interaction-to-next-paint']?.numericValue ?? Number.NaN,
      cls: typing['cumulative-layout-shift']?.numericValue ?? Number.NaN,
      tbtMs: typing['total-blocking-time']?.numericValue ?? Number.NaN,
      accessibility: score(listed.accessibility),
    };
  } finally {
    await browser.disconnect();
  }
}

let chrome;
try {
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('preview server has no URL (run `pnpm build` first)');
  // The window is as big as the emulated phone (412 x 823): a headless window of the default 800 x
  // 600 does not present what is drawn below y = 600, which made the first interaction look slow.
  chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--window-size=412,823'],
  });

  const misses = [];
  for (const { path, budget, report } of pages) {
    const url = new URL(path, base).href;
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      // Defaults are mobile emulation with simulated slow 4G + 4x CPU throttle.
      const result = await lighthouse(url, {
        port: chrome.port,
        output: 'html',
        logLevel: 'error',
      });
      if (!result) throw new Error('Lighthouse returned no result');
      const { categories, audits } = result.lhr;
      const run = {
        report: result.report,
        performance: score(categories.performance),
        accessibility: score(categories.accessibility),
        bestPractices: score(categories['best-practices']),
        seo: score(categories.seo),
        lcpMs: audits['largest-contentful-paint']?.numericValue ?? Number.NaN,
        cls: audits['cumulative-layout-shift']?.numericValue ?? Number.NaN,
        tbtMs: audits['total-blocking-time']?.numericValue ?? Number.NaN,
        requests: audits['network-requests']?.details?.items?.length ?? 0,
      };
      runs.push(run);
      console.log(
        `${path} run ${i + 1}: Performance ${run.performance}, Accessibility ${run.accessibility}, LCP ${(run.lcpMs / 1000).toFixed(2)} s, CLS ${run.cls}, TBT ${Math.round(run.tbtMs)} ms, ${run.requests} requests`,
      );
    }

    const mid = [...runs].sort((a, b) => a.performance - b.performance)[
      Math.floor(runs.length / 2)
    ];
    writeFileSync(report, mid.report);
    const summary = {
      performance: median(runs.map((r) => r.performance)),
      accessibility: Math.min(...runs.map((r) => r.accessibility)),
      lcpMs: median(runs.map((r) => r.lcpMs)),
      cls: Math.max(...runs.map((r) => r.cls)),
    };
    console.log(
      `${path} median: Performance ${summary.performance}, LCP ${(summary.lcpMs / 1000).toFixed(2)} s, worst CLS ${summary.cls}, lowest Accessibility ${summary.accessibility}; best practices ${mid.bestPractices}, SEO ${mid.seo} (${report})`,
    );

    if (summary.performance < budget.performance)
      misses.push(`${path}: Performance ${summary.performance} < ${budget.performance}`);
    if (summary.accessibility < budget.accessibility)
      misses.push(
        `${path}: Accessibility ${summary.accessibility} < ${budget.accessibility}`,
      );
    if (summary.lcpMs > budget.lcpMs)
      misses.push(`${path}: LCP ${Math.round(summary.lcpMs)} ms > ${budget.lcpMs} ms`);
    if (summary.cls > budget.cls)
      misses.push(`${path}: CLS ${summary.cls} > ${budget.cls}`);
  }

  if (wanted(SEARCH.name)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const run = await searchPass(base, chrome);
      runs.push(run);
      console.log(
        `search run ${i + 1}: Accessibility ${run.accessibility}, INP ${Math.round(run.inpMs)} ms, CLS ${run.cls}, TBT ${Math.round(run.tbtMs)} ms`,
      );
    }
    const mid = [...runs].sort((a, b) => a.inpMs - b.inpMs)[Math.floor(runs.length / 2)];
    writeFileSync(SEARCH.report, mid.report);
    const summary = {
      accessibility: Math.min(...runs.map((r) => r.accessibility)),
      inpMs: median(runs.map((r) => r.inpMs)),
      cls: Math.max(...runs.map((r) => r.cls)),
    };
    console.log(
      `search median: INP ${Math.round(summary.inpMs)} ms, worst CLS ${summary.cls}, lowest Accessibility ${summary.accessibility} (${SEARCH.report})`,
    );
    const { budget } = SEARCH;
    if (summary.accessibility < budget.accessibility)
      misses.push(
        `search: Accessibility ${summary.accessibility} < ${budget.accessibility}`,
      );
    // NaN (no interaction was recorded) is a miss, not a pass.
    if (!(summary.inpMs <= budget.inpMs))
      misses.push(`search: INP ${Math.round(summary.inpMs)} ms > ${budget.inpMs} ms`);
    if (!(summary.cls <= budget.cls))
      misses.push(`search: CLS ${summary.cls} > ${budget.cls}`);
  }

  if (misses.length) {
    console.error(`Over budget: ${misses.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('Within budget.');
  }
} finally {
  await chrome?.kill();
  await server.close();
}
