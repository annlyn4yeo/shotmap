# Data

The browser never touches raw StatsBomb files (a single match is several MB). A build-time script turns the open data into tiny static JSON in `public/data/`, which is committed so deploys do not depend on the network.

```bash
pnpm data    # download (cached), normalise, write public/data, print the size table
pnpm test    # validate the schema and the final's score
```

Currently shipped: FIFA World Cup 2022 (64 matches, the final is the hero), UEFA Euro 2024 (51) and La Liga 2018/2019 (34, Barcelona matches). That is 149 matches, 150 files, about 150 KB gzip in total. The largest match file is 1.5 KB gzip against a 12 KB budget; the index is 2.6 KB against 30 KB.

## Attribution

StatsBomb's open-data terms ask that anything published from this data states **StatsBomb** as the source and uses their logo (their media pack: <https://statsbomb.com/media-pack/>). The repository's `LICENSE.pdf` has the full user agreement: <https://github.com/statsbomb/open-data>. Read it before publishing.

- The site footer carries the credit and a logo slot (`data-slot="statsbomb-logo"`). **The real logo is still to be dropped in.**
- These generated files are derived from StatsBomb data, so the credit should travel with them. Keep the attribution in the repository README as well.

## Pipeline

`scripts/build-data.ts`, configured by `scripts/data.config.ts`.

1. Reads `competitions.json` and resolves each configured `competition` + `season` **by name**; no numeric ids are hard-coded.
2. Downloads each season's match list, then every match's events and lineups. Four at a time, with exponential backoff and jitter on network errors, `429` and `5xx` (honouring `Retry-After`).
3. Caches every raw download, gzipped, in `.cache/statsbomb/` (git-ignored, about 44 MB for the current set). A re-run, or one that was interrupted, fetches only what is missing; a corrupt cache file is re-fetched.
4. Keeps events with `type.name === "Shot"`. Penalty shootout kicks (period 5) go in a separate `shootout` array. Own goals are not shots and are dropped.
5. Writes `public/data/index.json` and `public/data/matches/{match_id}.json`, removing any file that is no longer in the set. Output is deterministic (no timestamps), so a re-run produces no diff.
6. Prints a size table and the coordinate evidence, and **exits non-zero** if any file is over budget, if an outcome is not in the config's table, or if a final score is not explained by shot goals plus own goals.

To pin the source, set `source.ref` in the config to a commit SHA instead of `master`.

## Files

### `index.json`

```ts
{
  v: 1,
  hero: 3869685,                       // match id of the 2022 final
  pitch: { length: 120, width: 80, goalY: [36, 44] },
  enums: { outcome, bodyPart, shotType, technique },   // see below
  stages: ['Regular Season', 'Group Stage', ..., 'Final'],
  competitions: [{ id, name, seasons: [{ id, name, matches: MatchRow[] }] }],
}
// MatchRow = [id, date, home, away, homeScore, awayScore, stageIndex, homePens, awayPens]
```

Matches are chronological within a season. `stageIndex` points into `stages`. Pens are `null` unless there was a shootout. Types are in `src/data/types.ts`.

### `matches/{id}.json`

```ts
{
  v: 1,
  meta: { id, date, kickoff, competition: {id, name}, season: {id, name}, stage,
          teams: [{ id, name, score, pens }, ...] },   // home first, then away
  players: [[name, teamIdx, shirt | null], ...],       // only players who took a shot
  shots: { min: [], sec: [], per: [], team: [], player: [], x: [], y: [], ex: [], ey: [], ez: [],
           xg: [], out: [], body: [], type: [], tech: [] },
  shootout: { ...same columns } | null,
}
```

Shots are **struct-of-arrays**: shot `i` is column `k` at index `i`. All columns have the same length, in match order.

| Column                        | Meaning                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `min`, `sec`                  | Match clock. Minutes run on through extra time (a goal in the 107th minute is `107`).                                                                                                           |
| `per`                         | Period: 1, 2 normal time; 3, 4 extra time; 5 shootout (only in `shootout`).                                                                                                                     |
| `team`                        | `0` home, `1` away. Matches `meta.teams` order.                                                                                                                                                 |
| `player`                      | Index into `players`.                                                                                                                                                                           |
| `x`, `y`                      | Where the shot was taken. Yards, 1 decimal.                                                                                                                                                     |
| `ex`, `ey`                    | Where it ended: the keeper, the goal, the block. Always present.                                                                                                                                |
| `ez`                          | Height in yards where it crossed the goal line, or `null` when StatsBomb recorded none (blocked and most wide shots). The bar is 2.67 yards up. Present for some over-the-bar shots, up to 7.8. |
| `xg`                          | StatsBomb expected goals, 3 decimals.                                                                                                                                                           |
| `out`, `body`, `type`, `tech` | Enum ids (below).                                                                                                                                                                               |

`score` is the result before any shootout. Shot goals can fall short of it, because an own goal counts on the scoreboard but is not a shot: the pipeline checks that shot goals plus own goals equal the score in all 149 matches (16 own goals).

## Enum legend

Columns store **StatsBomb's own ids**, so ids never change when a competition is added. The names and labels are in `index.json` under `enums`, which also carries our `group` for outcomes: the one of five UI marks (`goal`, `saved`, `off`, `blocked`, `post`) an outcome is drawn as. That mapping is ours, set in `scripts/data.config.ts`.

| Outcome id | StatsBomb name   | Label                    | Drawn as |
| ---------- | ---------------- | ------------------------ | -------- |
| 96         | Blocked          | Blocked                  | blocked  |
| 97         | Goal             | Goal                     | goal     |
| 98         | Off T            | Off target               | off      |
| 99         | Post             | Hit the post             | post     |
| 100        | Saved            | Saved                    | saved    |
| 101        | Wayward          | Wayward                  | off      |
| 115        | Saved Off Target | Saved, would have missed | saved    |
| 116        | Saved to Post    | Saved onto the post      | saved    |

| Body part |            | Shot type |           | Technique |               |
| --------- | ---------- | --------- | --------- | --------- | ------------- |
| 37        | Head       | 61        | Corner    | 89        | Backheel      |
| 38        | Left Foot  | 62        | Free Kick | 90        | Diving Header |
| 40        | Right Foot | 87        | Open Play | 91        | Half Volley   |
| 70        | Other      | 88        | Penalty   | 92        | Lob           |
|           |            |           |           | 93        | Normal        |
|           |            |           |           | 94        | Overhead Kick |
|           |            |           |           | 95        | Volley        |

Only values that occur in the shipped data are listed. A new outcome name stops the build until it has an entry in the config.

## Coordinates

Confirmed against all 3,656 non-shootout shots (the script prints the evidence on every run, and the tests assert it):

- The pitch is **120 x 80** yards. Shot positions span x 48.1 to 120.1 and y 0.7 to 79.3; the 0.1 overshoot is in StatsBomb's data, so validators allow a small slack.
- **Every team attacks toward x = 120**, in both halves and in extra time: StatsBomb flips coordinates per team. All 386 goals were scored from x > 60 and end at x 119.9 to 120. Only 9 shots came from the own half.
- **y runs top-to-bottom** when the attack is toward +x: mean y of Right Wing events is 59.1 and Left Wing is 20.1, so the attacker's right is the larger y.
- **The posts are at y = 36 and y = 44.** Goals end between y 35.8 and 43.9, and 64 of 79 post hits end within a yard of a post line (the rest hit the bar). Goals end below 2.5 yards, under the 2.67 bar.

`project()` in `src/lib/geometry.ts` rotates these into the attacking-half view (goal at the top).

## Using it

```ts
import { loadIndex, loadMatch, prefetchNextMatch } from './data/load';

const index = await loadIndex();
const match = await loadMatch(index.hero);
prefetchNextMatch(index.hero); // on idle, fetches the next match in the season, nothing else
```

The loader keeps results in memory, shares one request between concurrent callers, forgets failures so a retry works, and skips prefetching when the user has Save-Data on. Safari has no `requestIdleCallback`, so a 1.5 s timer stands in.

## Adding a competition

1. Find the exact names in `data/competitions.json` of the open-data repo (`competition_name` and `season_name`).
2. Add `{ competition, season }` to `include` in `scripts/data.config.ts`.
3. `pnpm data`. If it stops on an unknown outcome, add it to `outcomes` in the config. If it reports an over-budget file or an unexplained score, look at that match before raising a limit.
4. `pnpm test`, then check the size table. Whole league seasons are large (380 matches): prefer tournaments or one club's matches.
