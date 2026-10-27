// Data releases: put one into D1, and put the one before it back.
//
//   pnpm --filter @shotmap/api release list
//   pnpm --filter @shotmap/api release plan     [--release <name>]
//   pnpm --filter @shotmap/api release publish  --env staging [--release <name>] [--yes] [--paid]
//   pnpm --filter @shotmap/api release rollback --env staging [--yes]
//   pnpm --filter @shotmap/api release verify   --env staging [--release <name>]
//
// A release is a folder in packages/ingest/out/releases/<date>.<hash>/: the dump D1 is loaded from
// (gzipped) and a manifest. `publish` loads the dump into the environment's D1 database, then asks
// the Worker which release it is serving until it says the new one. Before it loads anything it
// records D1's Time Travel bookmark, and the release that was live, in releases/state.json, so
// `rollback` is ONE command that puts the database back to that moment (a restore: seconds, no
// rows written, so it costs none of the Free plan's daily 100,000) and checks the Worker agrees.
// Without a bookmark (Time Travel keeps 7 days on Free, 30 on Paid) rollback loads the previous
// release's dump instead, which writes rows again.
//
// Every load is `wrangler d1 execute --remote`, which needs `wrangler login` or CLOUDFLARE_API_TOKEN.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const API = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASES = resolve(API, '..', '..', 'packages', 'ingest', 'out', 'releases');
const STATE = join(RELEASES, 'state.json');
// Which parts of a release have gone into which database, and how many rows were written each day.
const PARTS = join(RELEASES, 'parts.json');

// The D1 database and the Worker's address for each environment (wrangler.jsonc has the ids).
const ENVIRONMENTS = {
  staging: {
    database: 'shotmap-staging',
    url: process.env.API_URL ?? 'https://shotmap-api-staging.annlynanto.workers.dev',
  },
  production: { database: 'shotmap', url: process.env.API_URL ?? '' },
};
// Cloudflare's Free plan, per day, per account (developers.cloudflare.com/d1/platform/pricing).
const FREE_ROWS_WRITTEN_PER_DAY = 100_000;

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const option = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const readJson = (path, fallback) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;

function releases() {
  if (!existsSync(RELEASES)) return [];
  return readdirSync(RELEASES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(RELEASES, d.name, 'manifest.json')))
    .map((d) => readJson(join(RELEASES, d.name, 'manifest.json')))
    .sort((a, b) => String(a.builtAt).localeCompare(String(b.builtAt)));
}

function pick(name) {
  const all = releases();
  if (name) {
    const found = all.find((m) => m.release === name);
    if (!found)
      fail(
        `No release ${name} in ${RELEASES}. Have: ${all.map((m) => m.release).join(', ') || 'none'}`,
      );
    return found;
  }
  const catalogue = all.filter((m) => m.scope === 'catalogue');
  const latest = catalogue.at(-1) ?? all.at(-1);
  if (!latest)
    fail(
      `No release in ${RELEASES}: run \`pnpm --filter @shotmap/ingest catalogue\` first.`,
    );
  return latest;
}

function environment() {
  const name = option('env');
  const env = name && ENVIRONMENTS[name];
  if (!env) fail('Say which environment: --env staging or --env production');
  if (!env.url)
    fail(
      `Set API_URL to the ${name} Worker's address (or fill it in at the top of this file).`,
    );
  return { name, ...env };
}

function wrangler(args, { capture = true } = {}) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: API,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

async function liveRelease(env) {
  try {
    const res = await fetch(`${env.url}/v1/meta`, {
      headers: { 'cache-control': 'no-cache' },
    });
    if (!res.ok) return undefined;
    return (await res.json()).release;
  } catch {
    return undefined;
  }
}

/** Waits for the Worker to say it serves this release: it reads the release once a minute per isolate. */
async function waitFor(env, release, seconds = 150) {
  const until = Date.now() + seconds * 1000;
  let seen;
  while (Date.now() < until) {
    seen = await liveRelease(env);
    if (seen === release) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error(`The Worker still says ${seen ?? 'nothing'}, not ${release}.`);
  return false;
}

function bookmarkOf(env) {
  const info = wrangler([
    'd1',
    'time-travel',
    'info',
    env.database,
    '--env',
    env.name,
    '--json',
  ]);
  if (!info.ok) {
    console.warn(
      `Could not read a Time Travel bookmark (${info.out.trim().split('\n').at(-1)}).`,
    );
    return null;
  }
  try {
    const start = info.out.indexOf('{');
    return JSON.parse(info.out.slice(start)).bookmark ?? null;
  } catch {
    return null;
  }
}

function describe(m) {
  const w = m.rowsWritten;
  return `${m.release}  ${m.scope}  ${m.counts.matches} matches, ${m.counts.shots} shots; loading writes ${w.total.toLocaleString('en')} rows (${(m.dump.bytes / 1048576).toFixed(1)} MiB dump)`;
}

function plan(m, paid) {
  const w = m.rowsWritten;
  console.log(describe(m));
  const days = Math.ceil(w.total / FREE_ROWS_WRITTEN_PER_DAY);
  console.log(
    `  rows written: ${w.rows.toLocaleString('en')} in tables + ${w.indexEntries.toLocaleString('en')} in indexes = ${w.total.toLocaleString('en')}`,
  );
  for (const [table, v] of Object.entries(w.perTable)
    .sort((a, b) => b[1].written - a[1].written)
    .slice(0, 5))
    console.log(
      `    ${table.padEnd(14)} ${String(v.rows).padStart(8)} rows x ${v.indexes + 1} = ${v.written.toLocaleString('en')}`,
    );
  if (w.total > FREE_ROWS_WRITTEN_PER_DAY && !paid) {
    console.log(
      `  The Free plan allows ${FREE_ROWS_WRITTEN_PER_DAY.toLocaleString('en')} rows written a day, and past it every query, reads too, fails until 00:00 UTC. This load is ${days} days of it. Not in one go on Free.`,
    );
    return false;
  }
  return true;
}

async function publish(env, m, yes, paid) {
  if (!plan(m, paid))
    fail('Refusing: pass --paid only if the account is on the Workers Paid plan.');
  const dir = join(RELEASES, m.release);
  const before = await liveRelease(env);
  console.log(
    `\n${env.name} serves ${before ?? 'nothing I can read'} now; it will serve ${m.release}.`,
  );
  if (before === m.release) fail('It already does.');
  if (!yes) fail('Add --yes to load it.');

  const bookmark = bookmarkOf(env);
  console.log(`Time Travel bookmark before the load: ${bookmark ?? 'none'}`);
  const state = readJson(STATE, {});
  state[env.name] ??= [];
  state[env.name].push({
    release: m.release,
    previous: before ?? null,
    bookmark,
    startedAt: new Date().toISOString(),
    done: false,
  });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

  const file = join(dir, 'shotmap.sql');
  writeFileSync(file, gunzipSync(readFileSync(join(dir, m.dump.file))));
  console.log(`Loading ${file} into ${env.database} ...`);
  const loaded = wrangler(
    ['d1', 'execute', env.database, '--remote', '--env', env.name, `--file=${file}`],
    {
      capture: false,
    },
  );
  if (!loaded.ok)
    fail('The load failed. If it stopped part-way, `rollback` puts the database back.');

  const ok = await waitFor(env, m.release);
  const last = state[env.name].at(-1);
  last.done = ok;
  last.finishedAt = new Date().toISOString();
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(
    ok
      ? `\n${env.name} serves ${m.release}.`
      : '\nLoaded, but the Worker has not confirmed it yet.',
  );
  console.log(
    `To undo: pnpm --filter @shotmap/api release rollback --env ${env.name} --yes`,
  );
  process.exit(ok ? 0 : 1);
}

// The Free plan: a release too big for one day goes in a part a day, into a database nothing serves
// from yet (so what is live is never half a release), and the Worker is pointed at it afterwards.
// --local runs the same steps against wrangler dev's local D1, to try them out; there the day's
// budget is not enforced.
async function publishPart(env, m, { yes, paid, local, database }) {
  const target = local ? 'DB' : (database ?? env.database);
  const key = `${local ? 'local' : target}|${m.release}`;
  const all = readJson(PARTS, {});
  const progress = (all[key] ??= {
    release: m.release,
    database: target,
    done: [],
    writes: {},
  });
  const total = m.parts.length;
  const today = new Date().toISOString().slice(0, 10);
  const next = m.parts.findIndex((_, i) => !progress.done.includes(i));
  const rows = (list) => list.reduce((n, p) => n + p.rowsWritten, 0).toLocaleString('en');

  console.log(
    `${m.release} into ${target}: ${progress.done.length} of ${total} parts are in; ${rows(m.parts.filter((_, i) => !progress.done.includes(i)))} rows still to write`,
  );
  if (next < 0) return finishParts(env, m, target, local);

  const part = m.parts[next];
  const todays = progress.writes[today] ?? 0;
  console.log(
    `part ${next + 1} writes ${part.rowsWritten.toLocaleString('en')} rows; ${todays.toLocaleString('en')} written by this release today (UTC)`,
  );
  if (!local && !paid && todays + part.rowsWritten > FREE_ROWS_WRITTEN_PER_DAY) {
    const midnight = new Date(`${today}T00:00:00Z`).getTime() + 86_400_000;
    fail(
      `That would pass the Free plan's ${FREE_ROWS_WRITTEN_PER_DAY.toLocaleString('en')} rows written a day, and every query would then fail until 00:00 UTC (in ${((midnight - Date.now()) / 3_600_000).toFixed(1)} hours). Run this again after that.`,
    );
  }
  if (!yes) fail('Add --yes to load it.');

  const dir = join(RELEASES, m.release, 'parts');
  const file = join(dir, `${next + 1}.sql`);
  writeFileSync(file, gunzipSync(readFileSync(join(RELEASES, m.release, part.file))));
  const args = local
    ? ['d1', 'execute', 'DB', '--local', `--file=${file}`]
    : ['d1', 'execute', target, '--remote', '--env', env.name, `--file=${file}`];
  console.log(`Loading part ${next + 1} of ${total} ...`);
  if (!wrangler(args, { capture: false }).ok)
    fail(
      'The part did not load. It is safe to run again: every row is INSERT OR REPLACE.',
    );
  progress.done.push(next);
  progress.writes[today] = todays + part.rowsWritten;
  writeFileSync(PARTS, `${JSON.stringify(all, null, 2)}\n`);
  if (progress.done.length === total) return finishParts(env, m, target, local);
  console.log(
    `Part ${next + 1} is in; ${total - progress.done.length} to go. The next one: tomorrow (UTC), or today if the budget allows.`,
  );
}

/** The last part is in: check the database holds the whole release, then say how to switch to it. */
function finishParts(env, m, target, local) {
  const query = join(RELEASES, '.query.sql');
  const ask = (sql) => {
    // A file, not --command: a command with spaces in it does not survive the shell on Windows.
    writeFileSync(query, `${sql};\n`);
    const args = local
      ? ['d1', 'execute', 'DB', '--local', '--json', `--file=${query}`]
      : [
          'd1',
          'execute',
          target,
          '--remote',
          '--env',
          env.name,
          '--json',
          `--file=${query}`,
        ];
    const out = wrangler(args);
    try {
      return JSON.parse(out.out.slice(out.out.indexOf('[')))[0].results[0]?.v;
    } catch {
      return undefined;
    }
  };
  const release = ask("SELECT value AS v FROM meta WHERE key = 'release'");
  const shots = ask('SELECT COUNT(*) AS v FROM shots');
  const matches = ask('SELECT COUNT(*) AS v FROM matches');
  const ok =
    release === m.release && shots === m.counts.shots && matches === m.counts.matches;
  console.log(
    `${target} holds ${release}: ${matches} matches, ${shots} shots; expected ${m.release}: ${m.counts.matches}, ${m.counts.shots}: ${ok ? 'complete' : 'NOT COMPLETE'}`,
  );
  if (ok && !local) {
    console.log(`\nNothing serves ${target} yet. To switch ${env.name} to it:`);
    console.log(
      `  1. In apps/api/wrangler.jsonc, give env.${env.name}.d1_databases the name and id of ${target}.`,
    );
    console.log(`  2. pnpm exec wrangler deploy --env ${env.name}`);
    console.log(
      `  3. pnpm --filter @shotmap/api release verify --env ${env.name} --release ${m.release}`,
    );
    console.log(
      'To undo it, put the old database back in wrangler.jsonc and deploy again.',
    );
  }
  process.exit(ok ? 0 : 1);
}

async function rollback(env, yes) {
  const state = readJson(STATE, {});
  const history = state[env.name] ?? [];
  const last = history.at(-1);
  if (!last)
    fail(`Nothing recorded for ${env.name}: no publish has been made from here.`);
  const now = await liveRelease(env);
  console.log(
    `${env.name} serves ${now ?? 'nothing I can read'}; the last publish was ${last.release}, over ${last.previous ?? 'an unknown release'}.`,
  );
  if (!yes) fail('Add --yes to put it back.');

  let restored = false;
  if (last.bookmark) {
    console.log(
      `Restoring ${env.database} to its Time Travel bookmark ${last.bookmark} ...`,
    );
    restored = wrangler(
      [
        'd1',
        'time-travel',
        'restore',
        env.database,
        '--env',
        env.name,
        `--bookmark=${last.bookmark}`,
      ],
      {
        capture: false,
      },
    ).ok;
    if (!restored)
      console.warn(
        'The restore did not work (the bookmark may be older than Time Travel keeps).',
      );
  }
  if (!restored) {
    const previous = releases().find((m) => m.release === last.previous);
    if (!previous)
      fail(`No bookmark, and no archived release ${last.previous}: nothing to put back.`);
    console.log(`Loading the previous release's dump (this writes rows again) ...`);
    const dir = join(RELEASES, previous.release);
    const file = join(dir, 'shotmap.sql');
    writeFileSync(file, gunzipSync(readFileSync(join(dir, previous.dump.file))));
    restored = wrangler(
      ['d1', 'execute', env.database, '--remote', '--env', env.name, `--file=${file}`],
      {
        capture: false,
      },
    ).ok;
  }
  if (!restored) fail('Could not put the previous release back.');
  const ok = last.previous ? await waitFor(env, last.previous) : true;
  history.push({
    release: last.previous,
    previous: last.release,
    rolledBackAt: new Date().toISOString(),
    done: ok,
  });
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(
    ok
      ? `\n${env.name} serves ${last.previous} again.`
      : '\nRestored, but the Worker has not confirmed it yet.',
  );
  process.exit(ok ? 0 : 1);
}

switch (command) {
  case 'list': {
    const state = readJson(STATE, {});
    for (const m of releases()) console.log(describe(m));
    for (const [name, history] of Object.entries(state)) {
      const last = history.at(-1);
      console.log(
        `${name}: last recorded ${last?.release ?? 'nothing'} (${last?.done ? 'confirmed' : 'not confirmed'})`,
      );
    }
    for (const [name, env] of Object.entries(ENVIRONMENTS))
      if (env.url)
        console.log(
          `${name} serves ${(await liveRelease({ url: env.url })) ?? 'nothing I can read'} now`,
        );
    break;
  }
  case 'plan':
    process.exit(plan(pick(option('release')), flag('paid')) ? 0 : 2);
    break;
  case 'publish':
    if (flag('chunked') || flag('local'))
      await publishPart(environment(), pick(option('release')), {
        yes: flag('yes'),
        paid: flag('paid'),
        local: flag('local'),
        database: option('database'),
      });
    else await publish(environment(), pick(option('release')), flag('yes'), flag('paid'));
    break;
  case 'rollback':
    await rollback(environment(), flag('yes'));
    break;
  case 'verify': {
    const env = environment();
    const m = pick(option('release'));
    const now = await liveRelease(env);
    console.log(`${env.name} serves ${now}; expected ${m.release}`);
    process.exit(now === m.release ? 0 : 1);
    break;
  }
  default:
    fail(
      'Usage: release list | plan | publish --env <name> | rollback --env <name> | verify --env <name>',
    );
}
