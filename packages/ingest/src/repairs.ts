/**
 * Quirks of the source that the ingest repairs, each one narrow, named, counted and reported.
 * A repair never touches a check: the check is run after it, on what it left, and fails if a
 * goal is still wrong. Applied by the catalogue ingest only; the static files (docs/golden) are
 * built without it and none of their matches needs it.
 */
import { ENUMS, PITCH } from '@shotmap/schema';
import type { MatchRecord } from './rich';

/**
 * Low-resolution matches: in about 200 matches (the 2018 World Cup and NWSL, most of the 2018/19
 * FA Women's Super League, single Champions League finals from 2009 to 2017) the source records
 * every shot's start point and end x as a whole number of yards. There, a goal's end x comes out
 * 120 (363 goals), 119 (147), 118 (25) or 117 (4): a goal crosses the line, so it ends at x = 120,
 * and the record is up to three yards short of it. In the 3,766 other matches no goal ends short.
 */
export const LOW_RESOLUTION = {
  /** Fewer shots than this and "every shot is a whole number" proves nothing. */
  minShots: 5,
  /** A goal ending at x in [from, to) is repaired; one ending further out is left, and fails the check. */
  from: 117,
  to: 119.5,
};

const GOAL = ENUMS.outcome.find((o) => o.name === 'Goal')?.id;
const [LEFT_POST, RIGHT_POST] = PITCH.goalY;
const SLACK = 0.5;
/** The bar: the check's own bound. */
const BAR = 2.67;

export interface Repair {
  match: number;
  seq: number;
  /** The end x as the source has it. */
  was: number;
}

/** Whether every shot in the match has a whole-yard start point and end x. */
export function isLowResolution(record: MatchRecord): boolean {
  const { shots, shootout } = record.file;
  const columns = [shots, ...(shootout ? [shootout] : [])];
  const count = columns.reduce((n, c) => n + c.x.length, 0);
  if (count < LOW_RESOLUTION.minShots) return false;
  return columns.every((c) =>
    c.x.every(
      (x, i) =>
        Number.isInteger(x) && Number.isInteger(c.y[i]) && Number.isInteger(c.ex[i]),
    ),
  );
}

/**
 * Sets the end x of a goal that stops short of the line to the line, in a low-resolution match,
 * when the goal is otherwise sound (between the posts, under the bar). Returns what it changed.
 */
export function repairGoalEnds(records: MatchRecord[]): Repair[] {
  if (GOAL === undefined) throw new Error('ENUMS has no Goal outcome');
  const repairs: Repair[] = [];
  for (const record of records) {
    if (!isLowResolution(record)) continue;
    const { shots } = record.file;
    shots.out.forEach((outcome, i) => {
      if (outcome !== GOAL) return;
      const ex = shots.ex[i] as number;
      const ey = shots.ey[i] as number;
      const ez = shots.ez[i];
      if (ex < LOW_RESOLUTION.from || ex >= LOW_RESOLUTION.to) return;
      if (ey < LEFT_POST - SLACK || ey > RIGHT_POST + SLACK) return;
      if (ez !== null && ez !== undefined && ez > BAR) return;
      repairs.push({ match: record.file.meta.id, seq: i, was: ex });
      shots.ex[i] = PITCH.length;
    });
  }
  return repairs;
}
