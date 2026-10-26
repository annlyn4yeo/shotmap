import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION, ENUMS, SHOT_ID_FACTOR, shotIdOf } from './index';
import {
  AttributionSchema,
  DensitySchema,
  MatchShotsSchema,
  PlayerShotsSchema,
  ROUTES,
  envelope,
  type MatchShots,
} from './api';
import { buildApiMarkdown, buildOpenApi } from './openapi';

const root = resolve(import.meta.dirname, '..', '..', '..');

/** A small valid match payload: two open-play shots and a shootout kick. */
const shots = (): MatchShots => ({
  n: 3,
  cols: {
    shot: [3869685000, 3869685001, 3869685002],
    seq: [0, 1, 2],
    side: [0, 1, 0],
    team: [779, 771, 779],
    player: [5503, 3961, 5503],
    period: [1, 2, 5],
    min: [4, 70, 120],
    sec: [40, 5, 0],
    x: [92.4, 99.2, 108],
    y: [30, 47.9, 40],
    ex: [117.3, 108.1, 120],
    ey: [38.3, 40.4, 39.6],
    ez: [0.8, null, 0.2],
    xg: [0.025, 0.063, 0.784],
    out: [100, 96, 97],
    body: [40, 40, 38],
    type: [87, 87, 88],
    tech: [93, 93, 93],
  },
});

describe('the shots payload', () => {
  it('accepts a match with open play and then a shootout kick', () => {
    expect(MatchShotsSchema.safeParse(shots()).success).toBe(true);
  });

  it('rejects columns of different lengths, and a wrong n', () => {
    const ragged = shots();
    ragged.cols.xg.pop();
    expect(MatchShotsSchema.safeParse(ragged).success).toBe(false);
    expect(MatchShotsSchema.safeParse({ ...shots(), n: 4 }).success).toBe(false);
  });

  it('rejects an unknown or missing column', () => {
    const extra = { ...shots(), cols: { ...shots().cols, speed: [1, 2, 3] } };
    expect(MatchShotsSchema.safeParse(extra).success).toBe(false);
    const missing = shots();
    Reflect.deleteProperty(missing.cols, 'tech');
    expect(MatchShotsSchema.safeParse(missing).success).toBe(false);
  });

  it('rejects a seq that is not 0 to n-1 in order', () => {
    const m = shots();
    m.cols.seq = [0, 2, 3];
    expect(MatchShotsSchema.safeParse(m).success).toBe(false);
  });

  it('rejects a shootout kick before open play, so seq stays stable', () => {
    const m = shots();
    m.cols.period = [5, 1, 2];
    expect(MatchShotsSchema.safeParse(m).success).toBe(false);
  });

  it('rejects coordinates past 1 decimal and xG past 3', () => {
    const xy = shots();
    xy.cols.x[0] = 92.45;
    expect(MatchShotsSchema.safeParse(xy).success).toBe(false);
    const xg = shots();
    xg.cols.xg[0] = 0.0251;
    expect(MatchShotsSchema.safeParse(xg).success).toBe(false);
  });

  it('rejects a side that is not 0 or 1, and a period that is not 1 to 5', () => {
    const side = shots();
    side.cols.side[0] = 2 as 0;
    expect(MatchShotsSchema.safeParse(side).success).toBe(false);
    const period = shots();
    period.cols.period[0] = 6;
    expect(MatchShotsSchema.safeParse(period).success).toBe(false);
  });

  it('needs match in a player payload, sorted, with seq increasing inside a match', () => {
    const base = shots();
    const cross = { n: 3, cols: { ...base.cols, match: [10, 10, 12] } };
    expect(PlayerShotsSchema.safeParse(cross).success).toBe(true);
    expect(
      PlayerShotsSchema.safeParse({ n: 3, cols: { ...base.cols, match: [12, 10, 10] } })
        .success,
    ).toBe(false);
    expect(PlayerShotsSchema.safeParse(base).success).toBe(false);
    const seq = { n: 3, cols: { ...base.cols, seq: [4, 2, 0], match: [10, 10, 10] } };
    expect(PlayerShotsSchema.safeParse(seq).success).toBe(false);
  });

  it('names a shot globally as match * 1000 + seq', () => {
    expect(SHOT_ID_FACTOR).toBe(1000);
    expect(shotIdOf(3869685, 2)).toBe(3869685002);
    expect(shots().cols.shot.every((s, i) => s === shotIdOf(3869685, i))).toBe(true);
  });
});

describe('the density payload', () => {
  it('is sparse columns of one length', () => {
    const ok = {
      step: 2,
      gx: [55, 56],
      gy: [20, 21],
      n: [3, 1],
      xg: [0.5, 0.1],
      goals: [1, 0],
    };
    expect(DensitySchema.safeParse(ok).success).toBe(true);
    expect(DensitySchema.safeParse({ ...ok, goals: [1] }).success).toBe(false);
    expect(DensitySchema.safeParse({ ...ok, step: 0 }).success).toBe(false);
  });
});

describe('the envelope', () => {
  const wrap = envelope(DensitySchema);
  const data = { step: 2, gx: [], gy: [], n: [], xg: [], goals: [] };
  const ok = { release: 'r9733bd358bf4', attribution: ATTRIBUTION, data };

  it('carries a release and the attribution on every response', () => {
    expect(wrap.safeParse(ok).success).toBe(true);
    expect(wrap.safeParse({ attribution: ATTRIBUTION, data }).success).toBe(false);
    expect(wrap.safeParse({ release: 'r9733bd358bf4', data }).success).toBe(false);
    expect(wrap.safeParse({ ...ok, release: 'v1' }).success).toBe(false);
  });

  it('attributes StatsBomb', () => {
    expect(AttributionSchema.safeParse(ATTRIBUTION).success).toBe(true);
    expect(AttributionSchema.safeParse({ ...ATTRIBUTION, source: 'Opta' }).success).toBe(
      false,
    );
  });
});

describe('the contract', () => {
  it('has a response schema for every route, wrapped in the envelope', () => {
    expect(ROUTES.map((r) => r.path)).toEqual([
      '/v1/competitions',
      '/v1/matches',
      '/v1/matches/{id}',
      '/v1/matches/{id}/shots',
      '/v1/search',
      '/v1/players/{id}',
      '/v1/players/{id}/shots',
      '/v1/players/{id}/density',
      '/v1/compare',
    ]);
    for (const route of ROUTES) {
      const bad = route.response.safeParse({ data: {} });
      expect(bad.success, route.id).toBe(false);
    }
  });

  it('has enums that match the legend of the static index.json, id for id', () => {
    const legend = JSON.parse(
      readFileSync(resolve(root, 'apps/web/public/data/index.json'), 'utf8'),
    ) as { enums: Record<'outcome' | 'bodyPart' | 'shotType' | 'technique', unknown[]> };
    for (const kind of ['outcome', 'bodyPart', 'shotType', 'technique'] as const)
      expect(ENUMS[kind], kind).toEqual(legend.enums[kind]);
  });

  it('keeps docs/openapi.json equal to what the route table generates', () => {
    // A Windows checkout may have turned the line endings into CRLF.
    const file = readFileSync(resolve(root, 'docs/openapi.json'), 'utf8');
    const committed = file.split('\r\n').join('\n');
    expect(committed).toBe(`${JSON.stringify(buildOpenApi(), null, 2)}\n`);
  });

  it('documents every route in the markdown', () => {
    const md = buildApiMarkdown();
    for (const route of ROUTES) expect(md).toContain(`GET ${route.path}`);
    expect(md).toContain('ETag');
    expect(md).toContain('Cache-Control');
    expect(md).toContain('attribution');
  });
});
