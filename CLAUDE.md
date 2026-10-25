# Shotmap

Working title; may be renamed in Phase 1.

## Product

Shotmap is a design-led, mobile-first web app that visualizes football (soccer) shots from StatsBomb's free open data. It is for football fans and analytics-curious people.

**Pitch:** Every shot, mapped: a beautiful, instant way to see where games were won and lost.

Weekend portfolio project: small in scope, exceptional in craft. Static output only: no backend, no SSR.

## Stack

Vite + TypeScript (strict) + Preact. pnpm. ESLint (typescript-eslint strict, type-checked) + Prettier.
TypeScript is pinned to 6.x because typescript-eslint does not support TS 7 yet.

## Design

The art direction is **Survey Sheet** (cartography: vellum paper, one vermilion accent, shape-coded shot marks). Light mode only: there is no dark theme. Read `DESIGN.md` before any visual work. Tokens are in `src/styles/tokens.css` (one light set), never hard-code a colour or size. Shot marks are drawn by `src/lib/marks.ts` and `ShotLayer.tsx`; the pitch is `Pitch.tsx`. No radius, no shadows, no blur, no raster images.

## Data

The browser only ever loads the generated `public/data/*.json` (via `src/data/load.ts`, types in `src/data/types.ts`), never raw StatsBomb files. Regenerate with `pnpm data` (cached in `.cache/`, git-ignored); `pnpm test` validates the output. Competitions are listed in `scripts/data.config.ts` and resolved by name.

Coordinates, confirmed against the real data (not assumed): pitch 120 x 80 yards; **every team attacks toward x = 120** (StatsBomb flips per team); **y runs top-to-bottom** (attacker's right is larger y: Right Wing mean y 59.1, Left Wing 20.1); **posts at y = 36 and y = 44**; goals end at x 119.9 to 120, y 35.8 to 43.9, height under 2.5. Shot x reaches 120.1 in the data, so keep a small tolerance. Shot columns store StatsBomb's own enum ids; the legend is in `index.json`. Penalty shootouts (period 5) live in a separate `shootout` array, own goals are not shots (score = shot goals + own goals, verified for all 149 matches).

## State and navigation

One tiny store (`src/lib/store.ts`, no library). Components read a slice with `useStore(store, selector)`; high-frequency state (hover, focus) stays local to `ShotLayer`. The URL hash is the source of truth for everything shareable (`src/lib/route.ts`): `#m=<match>&team=both|home|away&p=<player idx>&hide=<outcomes>&so=1&shot=<id>`. A new match pushes a history entry (Back works); filters replace it. Filter changes run in a view transition (`src/lib/transition.ts`), which gives the FLIP-style panel morph with no measuring code. Static components that re-render on hover should be wrapped in `memo` (`src/lib/memo.ts`). The hero is inlined into index.html at build time, so it renders with no request; other matches show a skeleton only if they take over 150 ms. In dev, `window.__renders` counts renders per component.

## Principles

1. **Design is the product.** Craft, motion and typography matter as much as correctness.
2. **Performance is a hard constraint** and is never traded for aesthetics. Find the clever, cheap way to achieve the look.
3. **Mobile-first at 375px**, then scale up.
4. **Accessibility is not optional.**

## Performance budgets (enforce them)

- Initial JS <= 90 KB gzip
- CSS <= 20 KB gzip
- Max 2 font families, self-hosted as subset woff2 (<= 60 KB each), `font-display: swap`, preload only the critical one
- CLS 0
- LCP < 2.0 s and INP < 200 ms on throttled mobile
- Lighthouse mobile Performance >= 95
- Anything heavy (animation library, extra views) must be code-split and lazy-loaded

## Rules

- No runtime calls to third-party APIs or CDNs. All data and fonts are static and self-hosted.
- No UI component libraries.
- No CSS-in-JS runtime.
- Prefer CSS custom properties, CSS animations and the Web Animations API. Use JS animation only where it clearly earns its bytes.

## Data credit

The footer must say the data is by StatsBomb and show their logo, per their open-data terms. The logo is currently a placeholder slot (`[data-slot="statsbomb-logo"]` in `src/app.tsx`).

## Workflow

- Small commits with conventional messages (`feat:`, `fix:`, `chore:`, ...).
- Before finishing any task run `pnpm typecheck`, `pnpm lint`, `pnpm contrast` (if tokens changed) and `pnpm build`, and report gzip sizes of JS, CSS and fonts (`pnpm size`).

## Commands

| Command          | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`       | Dev server                                                                   |
| `pnpm build`     | Typecheck + production build to `dist/`                                      |
| `pnpm preview`   | Serve `dist/` locally                                                        |
| `pnpm typecheck` | `tsc --noEmit`                                                               |
| `pnpm lint`      | ESLint                                                                       |
| `pnpm format`    | Prettier write                                                               |
| `pnpm size`      | Build, then print raw + gzip size of every emitted asset                     |
| `pnpm lh`        | Lighthouse (mobile defaults) against `vite preview`; writes `lh-report.html` |
| `pnpm data`      | Build `public/data` from StatsBomb open data; fails if over budget           |
| `pnpm test`      | Vitest: data schema, the final's score, the loader                           |
| `pnpm contrast`  | WCAG contrast check of every token pair; fails on a miss                     |
| `pnpm fonts`     | Re-subset the self-hosted fonts and print fallback metrics                   |

`pnpm lh` needs Chrome/Chromium installed and a prior `pnpm build`; it starts the preview server itself.
