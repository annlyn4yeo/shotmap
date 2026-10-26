import { writeFileSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { preview } from 'vite';

// Lighthouse on the built app (mobile preset: simulated slow 4G, 4x CPU), LH_RUNS times
// (3 by default), judged on the median. The budgets are CLAUDE.md's, tightened to the
// margins MIGRATION.md step 9 asked to keep: a miss sets a non-zero exit code. /v1 is
// forwarded by the preview server, so a Worker must be running (see vite.config.ts).
//
// The preview server runs in this process, so there is no child to leak (on Windows a
// killed shell left `vite preview` running, and a later run quietly measured that old
// server). If port 4173 is taken, Vite takes the next free one and we use its URL.
const RUNS = Number(process.env.LH_RUNS ?? 3);
const BUDGET = { performance: 97, lcpMs: 1600, cls: 0 };

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

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
      performance: Math.round((categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((categories['best-practices']?.score ?? 0) * 100),
      seo: Math.round((categories.seo?.score ?? 0) * 100),
      lcpMs: audits['largest-contentful-paint']?.numericValue ?? Number.NaN,
      cls: audits['cumulative-layout-shift']?.numericValue ?? Number.NaN,
      tbtMs: audits['total-blocking-time']?.numericValue ?? Number.NaN,
      requests: audits['network-requests']?.details?.items?.length ?? 0,
    };
    runs.push(run);
    console.log(
      `run ${i + 1}: Performance ${run.performance}, LCP ${(run.lcpMs / 1000).toFixed(2)} s, CLS ${run.cls}, TBT ${Math.round(run.tbtMs)} ms, ${run.requests} requests`,
    );
  }

  const mid = [...runs].sort((a, b) => a.performance - b.performance)[
    Math.floor(runs.length / 2)
  ];
  writeFileSync('lh-report.html', mid.report);
  const summary = {
    performance: median(runs.map((r) => r.performance)),
    lcpMs: median(runs.map((r) => r.lcpMs)),
    cls: Math.max(...runs.map((r) => r.cls)),
  };
  console.log(
    `median: Performance ${summary.performance}, LCP ${(summary.lcpMs / 1000).toFixed(2)} s, worst CLS ${summary.cls}; accessibility ${mid.accessibility}, best practices ${mid.bestPractices}, SEO ${mid.seo}`,
  );
  console.log(`Report: lh-report.html (${url}, the median run of ${RUNS})`);

  const misses = [];
  if (summary.performance < BUDGET.performance)
    misses.push(`Performance ${summary.performance} < ${BUDGET.performance}`);
  if (summary.lcpMs > BUDGET.lcpMs)
    misses.push(`LCP ${Math.round(summary.lcpMs)} ms > ${BUDGET.lcpMs} ms`);
  if (summary.cls > BUDGET.cls) misses.push(`CLS ${summary.cls} > ${BUDGET.cls}`);
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
