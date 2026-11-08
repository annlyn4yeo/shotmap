/**
 * Shots taken from the same spot. Every penalty is from the spot, and a few other shots share a
 * position, so their marks are drawn one on top of the other and a reader sees one where there are
 * two or three (France's three goals in the 2022 final show as two marks: two of them are Mbappé's
 * penalties). A map does not move a symbol off its true place to show it; it labels the place with
 * its count. So a spot with more than one mark is labelled "×2", each mark says it is one of
 * several, a pick on the spot opens them in turn, and the card says which of them it is.
 *
 * The penalty spot is one spot, however the data writes it: (108, 40), (108.1, 40.1) and a few
 * other tenths of a yard round it over a career. Every mark within `PENALTY_REACH` of either spot
 * (12 yards out from each goal line, as the pitch draws them) is on it. Anywhere else, the same
 * spot is within `SAME_SPOT` of a spot's first mark: a spot is anchored on its first mark, so marks
 * near each other in a crowded six-yard box never chain into one big "spot", and every mark of a
 * stack is within a fraction of its own width of where the count is drawn.
 */

import { isQuiet } from './geometry';

export interface Spotted {
  id: number;
  x: number;
  y: number;
}

/** Marks this close, in yards, to a spot's first mark are on that spot. */
export const SAME_SPOT = 0.15;
/** Marks this close, in yards, to a penalty spot are on it. */
export const PENALTY_REACH = 0.3;
const PENALTY_SPOTS = [
  { x: 108, y: 40 },
  { x: 12, y: 40 },
] as const;

/**
 * Below `QUIET_FROM` marks on a map every spot of two or more is labelled. A map of more (a season,
 * a career) has marks over each other everywhere, and its labels are for spots of three or more:
 * two shots a tenth of a yard apart among hundreds say nothing. A pick still goes through every
 * stack, and the card still says which of it a shot is.
 */
export const countsFrom = (marks: number): number => (isQuiet(marks) ? 3 : 2);

/** On one of the two penalty spots. */
export const onPenaltySpot = (m: Pick<Spotted, 'x' | 'y'>): boolean =>
  PENALTY_SPOTS.some((p) => Math.hypot(p.x - m.x, p.y - m.y) <= PENALTY_REACH);

/**
 * The marks that share a spot with at least one other, keyed by each one's id. Every mark of a
 * spot is given the same array, in the order the marks came (so the stack's order is the map's:
 * chronological where the map is), and the first of them is the spot's anchor. Marks alone on
 * their spot are not in the map. A grid of cells as wide as `SAME_SPOT` finds the anchors near a
 * mark, so a career of thousands is a few milliseconds.
 */
export function stacksOf<T extends Spotted>(
  marks: readonly T[],
): Map<number, readonly T[]> {
  const cell = (v: number) => Math.floor(v / SAME_SPOT);
  /** The anchors' spots, by the cell the anchor is in. */
  const grid = new Map<string, T[][]>();
  const spots: T[][] = [];
  const penalties = PENALTY_SPOTS.map((): T[] => []);
  for (const m of marks) {
    const pen = PENALTY_SPOTS.findIndex(
      (p) => Math.hypot(p.x - m.x, p.y - m.y) <= PENALTY_REACH,
    );
    const onPenalty = penalties[pen];
    if (onPenalty) {
      if (onPenalty.length === 0) spots.push(onPenalty);
      onPenalty.push(m);
      continue;
    }
    const cx = cell(m.x);
    const cy = cell(m.y);
    let best: T[] | undefined;
    let bestD = SAME_SPOT;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const spot of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const anchor = spot[0];
          if (!anchor) continue;
          const d = Math.hypot(anchor.x - m.x, anchor.y - m.y);
          if (d <= bestD) {
            bestD = d;
            best = spot;
          }
        }
    if (best) best.push(m);
    else {
      const spot = [m];
      spots.push(spot);
      const key = `${cx},${cy}`;
      const here = grid.get(key);
      if (here) here.push(spot);
      else grid.set(key, [spot]);
    }
  }
  const stacks = new Map<number, readonly T[]>();
  for (const spot of spots)
    if (spot.length > 1) for (const m of spot) stacks.set(m.id, spot);
  return stacks;
}

/**
 * Each stack once, for drawing its count: those of at least `from` marks. With `penalties`, the
 * penalty spot too however few it holds, because a map that labels it has a note to draw there.
 */
export const spotsOf = <T extends Spotted>(
  stacks: Map<number, readonly T[]>,
  from = 2,
  penalties = false,
): (readonly T[])[] =>
  [...new Set(stacks.values())].filter(
    (s) => s.length >= from || (penalties && s[0] !== undefined && onPenaltySpot(s[0])),
  );

/**
 * What a pick on the map opens, given the mark nearest to it and the one open now. On a spot of
 * one mark it is that mark, or nothing when it is already open (a second pick closes it, as
 * before). On a stack it is the stack's first mark, and then each next one in turn, and after the
 * last of them nothing: picking the same spot again goes through every shot taken from it.
 */
export function pickOnSpot(
  hitId: number | undefined,
  selectedId: number | null,
  stacks: Map<number, readonly Spotted[]>,
): number | null {
  if (hitId === undefined) return null;
  const stack = stacks.get(hitId);
  if (!stack) return hitId === selectedId ? null : hitId;
  const at = stack.findIndex((m) => m.id === selectedId);
  if (at < 0) return stack[0]?.id ?? null;
  return stack[at + 1]?.id ?? null;
}

/** Where a mark is in its stack, counting from one, or undefined for a mark alone on its spot. */
export function placeInStack(
  id: number,
  stacks: Map<number, readonly Spotted[]>,
): { at: number; of: number } | undefined {
  const stack = stacks.get(id);
  if (!stack) return undefined;
  return { at: stack.findIndex((m) => m.id === id) + 1, of: stack.length };
}

/** What a mark's label adds when it shares its spot. */
export const stackNote = (place: { at: number; of: number } | undefined): string =>
  place ? `, ${place.at} of ${place.of} shots from this spot` : '';
