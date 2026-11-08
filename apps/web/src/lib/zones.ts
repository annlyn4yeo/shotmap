import type { Outcome } from '@shotmap/schema';

/**
 * Where a selection's shots came from and how often each place paid: the figures beside a quiet
 * map, and the sentence that says what the map shows. Every team attacks toward x = 120, and y runs
 * across the pitch (CLAUDE.md). The penalty area is the last 18 yards and y 18 to 62, the six-yard
 * box the last 6 and y 30 to 50.
 */
export interface Zoned {
  x: number;
  y: number;
  outcome: Outcome;
  shotType: string;
}

export const ZONES = [
  { key: 'penalty', label: 'Penalties' },
  { key: 'six', label: 'Six-yard box' },
  { key: 'box', label: 'Rest of the box' },
  { key: 'outside', label: 'Outside the box' },
] as const;

export type ZoneKey = (typeof ZONES)[number]['key'];

export interface ZoneRow {
  key: ZoneKey;
  label: string;
  shots: number;
  goals: number;
}

const isPenalty = (s: Pick<Zoned, 'shotType'>) => s.shotType === 'Penalty';

export function zoneOf(s: Zoned): ZoneKey {
  if (isPenalty(s)) return 'penalty';
  if (s.x >= 114 && s.y >= 30 && s.y <= 50) return 'six';
  if (s.x >= 102 && s.y >= 18 && s.y <= 62) return 'box';
  return 'outside';
}

export function zoneRows(shots: readonly Zoned[]): ZoneRow[] {
  const rows = ZONES.map((z) => ({ key: z.key, label: z.label, shots: 0, goals: 0 }));
  for (const s of shots) {
    const row = rows.find((r) => r.key === zoneOf(s));
    if (!row) continue;
    row.shots++;
    if (s.outcome === 'goal') row.goals++;
  }
  return rows;
}

/** How often a place paid, as a whole percentage; null where nobody shot from it. */
export const scored = (row: Pick<ZoneRow, 'shots' | 'goals'>): number | null =>
  row.shots === 0 ? null : Math.round((100 * row.goals) / row.shots);

/**
 * What the map shows, in a sentence: the shots from outside the box against the goals from there.
 * "But only" is said only where the goals' share really is the smaller one, so it holds for anyone.
 */
export function zoneClaim(rows: readonly ZoneRow[]): string {
  const shots = rows.reduce((n, r) => n + r.shots, 0);
  const goals = rows.reduce((n, r) => n + r.goals, 0);
  const outside = rows.find((r) => r.key === 'outside');
  if (!outside || shots === 0 || goals === 0 || outside.shots === 0)
    return `${shots} ${shots === 1 ? 'shot' : 'shots'}, ${goals} ${goals === 1 ? 'goal' : 'goals'}.`;
  const opening = `${outside.shots} of ${shots} shots came from outside the box`;
  if (outside.goals === 0) return `${opening}, and none of the ${goals} goals did.`;
  const fewer = outside.goals / goals < outside.shots / shots;
  return `${opening}, ${fewer ? 'but only' : 'and'} ${outside.goals} of ${goals} goals did.`;
}

/**
 * The label for the penalty spot on a quiet map ("7/10 pens"), or undefined when there are fewer
 * than two penalties, which the map has no pile of to explain.
 */
export function penaltyNote(
  shots: readonly Pick<Zoned, 'outcome' | 'shotType'>[],
): string | undefined {
  const penalties = shots.filter(isPenalty);
  if (penalties.length < 2) return undefined;
  const goals = penalties.filter((s) => s.outcome === 'goal').length;
  return `${goals}/${penalties.length} pens`;
}
