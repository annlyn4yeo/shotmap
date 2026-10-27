import { writeFileSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { preview } from 'vite';

// Lighthouse on the built app (mobile preset: simulated slow 4G, 4x CPU), LH_RUNS times per page
// (3 by default), judged on the median. The budgets are CLAUDE.md's, tightened to the margins
// MIGRATION.md steps 9 and 11 asked to keep: a miss sets a non-zero exit code. /v1 is forwarded
// by the preview server, so a Worker must be running (see vite.config.ts).
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
  // A player page, the one with the most shots in the data (Lionel Messi, 203 shots in 41
  // matches, every one drawn): its own file, then the profile, then the shots and the map, so the
  // app's 2.0 s LCP, and CLAUDE.md's 95 since nothing here is allowed to be slow. (With the
  // per-mark intro it scored 90: the page does not play it.)
  {
    name: 'player',
    path: '/players/5503',
    budget: { performance: 95, accessibility: 100, lcpMs: 2000, cls: 0 },
    report: 'lh-report-player.html',
  },
];

// LH_ONLY=home (or matches, player, or several comma-separated) audits only those pages, for
// comparing one page between builds.
const only = process.env.LH_ONLY?.split(',');
const pages = only ? PAGES.filter((p) => only.includes(p.name)) : PAGES;

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const score = (category) => Math.round((category?.score ?? 0) * 100);

const server = await preview({
  logLevel: 'error',
  preview: { port: 4173, strictPort: false, open: false },
});

let chrome;
try {
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('preview server has no URL (run `pnpm build` first)');
  chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox'],
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
