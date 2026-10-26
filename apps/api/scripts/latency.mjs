// Latency and size of the live endpoints, against any running API:
//
//   API_URL=http://127.0.0.1:8787 pnpm --filter @shotmap/api latency      (wrangler dev)
//   API_URL=https://<staging> pnpm --filter @shotmap/api latency          (staging)
//
// Each endpoint is asked for RUNS times in a row. The first answer after a cache miss comes
// from D1; the rest are cache hits or 304s. Prints p50 and p95 of the time to the full body,
// the bytes (raw and gzip) and the cache outcome, and fails when a budget is missed.
//
// CLAUDE.md sets budgets for the web app only. These are this API's, proposed with it:
//  - a payload stays small enough that fetching a match never dominates the 200 ms INP budget
//    on throttled mobile, and the first paint needs no API call at all (hero seed, ADR 0005);
//  - latency is checked on staging, because a local run says nothing about the edge.
import { gzipSync } from 'node:zlib';

const BASE = (process.env.API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const RUNS = Number(process.env.RUNS ?? 40);
const FINAL = 3869685;
// Set LOCAL=1 when measuring wrangler dev: latency budgets are only enforced against a real edge.
const LOCAL = process.env.LOCAL === '1' || /127\.0\.0\.1|localhost/.test(BASE);

const budgets = {
  gzipBytes: { meta: 3_000, matchesPage: 25_000, match: 3_000, shots: 6_000 },
  /** Server time to the last byte, p95, for a cache hit and for a D1-backed miss. */
  hitMs: 50,
  missMs: 150,
};

const timed = async (url, init) => {
  const t = performance.now();
  const res = await fetch(url, init);
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body, ms: performance.now() - t };
};
const pct = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.ceil((p / 100) * values.length) - 1)
  ];

const release = (await (await fetch(`${BASE}/v1/meta`)).json()).release;
const endpoints = [
  ['meta', `/v1/meta?v=${release}`, 'meta'],
  ['matches page (200)', `/v1/matches?limit=200&v=${release}`, 'matchesPage'],
  ['match (the final)', `/v1/matches/${FINAL}?v=${release}`, 'match'],
  ['shots (the final)', `/v1/matches/${FINAL}/shots?v=${release}`, 'shots'],
];

let failed = false;
console.log(
  `API ${BASE}, release ${release}, ${RUNS} runs each${LOCAL ? ' (local: latency budgets not enforced)' : ''}\n`,
);
console.log(
  'endpoint'.padEnd(22),
  'raw B'.padStart(8),
  'gzip B'.padStart(8),
  'cold ms'.padStart(8),
  'hit p50'.padStart(8),
  'hit p95'.padStart(8),
  '304 p50'.padStart(8),
  ' cache-control',
);
for (const [label, path, key] of endpoints) {
  const url = `${BASE}${path}`;
  const first = await timed(url);
  const raw = first.body.length;
  const gz = gzipSync(first.body, { level: 9 }).length;
  const etag = first.res.headers.get('etag') ?? '';
  const hits = [];
  const revalidations = [];
  for (let i = 0; i < RUNS; i++) {
    hits.push((await timed(url)).ms);
    revalidations.push((await timed(url, { headers: { 'if-none-match': etag } })).ms);
  }
  const ok =
    first.res.status === 200 &&
    gz <= budgets.gzipBytes[key] &&
    (LOCAL || pct(hits, 95) <= budgets.hitMs);
  if (!ok) failed = true;
  console.log(
    label.padEnd(22),
    String(raw).padStart(8),
    String(gz).padStart(8),
    first.ms.toFixed(0).padStart(8),
    pct(hits, 50).toFixed(1).padStart(8),
    pct(hits, 95).toFixed(1).padStart(8),
    pct(revalidations, 50).toFixed(1).padStart(8),
    ' ',
    first.res.headers.get('cache-control'),
    ok ? '' : '  <-- over budget',
  );
}
console.log(
  `\nBudgets: gzip meta <= ${budgets.gzipBytes.meta} B, matches page <= ${budgets.gzipBytes.matchesPage} B, match <= ${budgets.gzipBytes.match} B, shots <= ${budgets.gzipBytes.shots} B${LOCAL ? '' : `; hit p95 <= ${budgets.hitMs} ms, miss <= ${budgets.missMs} ms`}.`,
);
if (failed) process.exitCode = 1;
