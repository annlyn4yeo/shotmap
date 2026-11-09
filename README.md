# Shotmap

**Every shot, mapped: a beautiful, instant way to see where games were won and lost.**

Shotmap is a design-led, mobile-first web app that draws football shots from StatsBomb's free open data, for fans and anyone curious about analytics.

## What it covers

1,205 matches and 30,337 shots from the Premier League, La Liga, the Champions League, the men's World Cup and the men's Euros, from 2014 on. Coverage is uneven in the source (most La Liga seasons are mainly Barcelona's matches), and the app says so.

## What you can do

- **Read a match:** both teams' shots on the pitch, filtered by side, player or result.
- **Follow a player:** their seasons in a table, and every shot as marks or a density map.
- **Compare two players:** figures side by side and a density map of each on one scale.
- **Browse and search:** every match, player and team, with every view shareable by URL.

## Design

The art direction is **Survey Sheet**: a match treated as a surveyed map. Vellum paper, double neatlines, one vermilion accent that means a goal, and marks coded by shape, with size showing how good the chance was (expected goals).

## Tech stack

| Layer         | Tools                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| Web app       | [Preact](https://preactjs.com/), TypeScript, [Vite](https://vite.dev/), plain CSS |
| API           | [Hono](https://hono.dev/) on Cloudflare Workers, read-only                        |
| Database      | Cloudflare D1 (SQLite)                                                            |
| Data pipeline | TypeScript and SQLite                                                             |
| Quality       | Vitest, ESLint, Prettier, Lighthouse, Puppeteer                                   |
| Repository    | pnpm workspace                                                                    |

No UI component library, animation library or third-party calls from the browser. Fonts are self-hosted.

## How it fits together

```
StatsBomb open data
        |
packages/ingest    builds and checks a release, then loads it into D1
        |
packages/queries   the SQL behind every API answer
        |
apps/api           read-only /v1 API on a Cloudflare Worker
        |
apps/web           the app people use

packages/schema    constants, types and schemas shared by all of them
```

## Built to be fast and accessible

Budgets for layout shift, LCP and INP on a throttled phone, Lighthouse Accessibility of 100, and a keyboard-only test of the maps and the comparison. Large maps switch from SVG to canvas, with a hidden list of buttons that keeps every shot reachable by keyboard and screen reader.

## Data and credit

All data comes from [StatsBomb's open data](https://github.com/statsbomb/open-data) and belongs to StatsBomb. Shotmap only draws it. This is a non-commercial portfolio project, not affiliated with StatsBomb.
