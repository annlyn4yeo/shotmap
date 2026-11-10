# Shotmap

**Every shot, mapped: a beautiful, instant way to see where games were won and lost.**

Live: [shotmap-six.vercel.app](https://shotmap-six.vercel.app)

Shotmap is a design-led, mobile-first web app that draws football shots from StatsBomb's free open data, for fans and anyone curious about analytics.

## What it covers

1,205 matches and 30,337 shots from the Premier League, La Liga, the Champions League, the men's World Cup and the men's Euros, from 2014 on. Coverage is uneven in the source (most La Liga seasons are mainly Barcelona's matches), so the app does not rank what the data cannot support, and says so.

## What you can do

- **Read a match:** both teams' shots on the pitch, filtered by side, player or result.
- **Follow a player:** their seasons in a sortable table, and every shot as marks or a density map.
- **Compare two players:** ten figures side by side and a density map of each on one shared scale.
- **Browse and search:** every match, player and team, with every view shareable by URL.

## Design

The art direction is **Survey Sheet**: a match treated as a surveyed map. Vellum paper, double neatlines, one vermilion accent that means a goal, and marks coded by shape, with size showing how good the chance was (expected goals). No radius, shadows, blur or raster images; every colour and size is a design token, and a script checks every token pair for WCAG contrast.

## Tech stack

| Layer         | Tools                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------ |
| Web app       | [Preact](https://preactjs.com/), TypeScript (strict), [Vite](https://vite.dev/), plain CSS |
| API           | [Hono](https://hono.dev/) on Cloudflare Workers, read-only                                 |
| Database      | Cloudflare D1 (SQLite)                                                                     |
| Data pipeline | TypeScript and SQLite                                                                      |
| Hosting       | Vercel (static web app), Cloudflare Workers and D1 (API)                                   |
| Quality       | Vitest, ESLint (typescript-eslint, type-checked), Prettier, Lighthouse, Puppeteer          |
| Repository    | pnpm workspace                                                                             |

No UI component library, animation library or third-party calls from the browser. Fonts are self-hosted, subset woff2.

## How it fits together

```
StatsBomb open data (pinned to one commit)
        |
packages/ingest    builds, checks and dumps a release; loads it into D1
        |
packages/queries   the SQL and payloads behind every /v1 answer, over a two-method Db interface
        |
apps/api           read-only /v1 API: Hono on a Cloudflare Worker, D1 behind it
        |
apps/web           static Preact app, reads /v1 only

packages/schema    constants, wire types and zod schemas shared by all of them;
                   the OpenAPI document is generated from its route table
```

### Data

- **Releases.** Each build is a named release (`<date>.<hash of every row>`). The name is stored in the database, returned by `/v1/meta` and part of every cache key, so a new release never serves an old answer. Releases are loaded in parts to fit D1's free daily write limit, verified, and can be rolled back.
- **Checked, not trusted.** Coordinates are confirmed against the data (120 × 80 yards, every team attacking toward x = 120). Scores are rebuilt from shots plus own goals for every match. Quirks in the source are fixed in the open, in config files with reasons, and a check is never relaxed to make a build pass.
- **True appearances.** A player's match count comes from line-ups and substitutions, not only the matches they shot in.
- **Golden files.** The SHA-256 of the canonical JSON of the original 149 matches is committed, and the database must reproduce it exactly (parity tests).

### API

- Read-only `GET` endpoints for matches, shots, search, players and per-player density, described by a generated OpenAPI document.
- Shot lists are columnar (one array per field) with StatsBomb's own enum ids, so large careers stay small on the wire.
- Answers pinned to a release are cached at the edge and in the browser for a year; unpinned ones revalidate. Search folds accents on the server.

### Web app

- **Small and split.** One tiny store and a History API router, no libraries for either. Every page but the home page and the match page is its own lazy chunk. The browser never imports zod: a hand-written checker validates what the API returns.
- **Instant first paint.** The 2022 World Cup final is inlined into the HTML at build time from a committed fixture, so the home page and the hero match render without a request.
- **Two renderers.** Up to 300 shots are SVG marks, one element each. Above that the marks are painted on canvas, one layer per outcome, and a visually hidden, windowed list of buttons keeps every shot reachable by keyboard and screen reader.
- **Density.** Square bins are counted in the database and drawn as six tinted SVG paths, never one element per square.
- **Measured interactions.** Marks are memoised and not pointer targets (the layer finds the nearest one), and the detail card is built one paint after a tap. On a throttled phone a tap on a 200-shot map went from 424 ms to 128 ms.
- **Shareable state.** The URL holds everything a view needs; old hash links are redirected once.

## Built to be fast and accessible

Hard budgets for initial JS, CSS and fonts fail CI when exceeded. Before a release, Lighthouse runs on throttled mobile for every page and the search flow: zero layout shift, LCP and INP budgets, and Accessibility 100. A keyboard-only script walks the canvas maps and the comparison. CI runs the data build (the output must come out unchanged), typecheck, lint, tests, the contrast check and the size budgets on every pull request.

## Data and credit

All data comes from [StatsBomb's open data](https://github.com/statsbomb/open-data) and belongs to StatsBomb. Shotmap only draws it. This is a non-commercial portfolio project, not affiliated with StatsBomb.
