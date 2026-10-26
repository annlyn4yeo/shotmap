import type { Enums, MatchFile, Outcome, ShotColumns } from '@shotmap/schema';

/** One shot, decoded from the column arrays into something a view can use. */
export interface Shot {
  /** Unique within the match: chronological for open play, then the shootout kicks. */
  id: number;
  team: 0 | 1;
  /** Index into the match's player list, which the player filter and the URL use. */
  playerIdx: number;
  player: string;
  shirt: number | null;
  min: number;
  sec: number;
  period: number;
  /** A penalty shootout kick (period 5). */
  shootout: boolean;
  x: number;
  y: number;
  ex: number;
  ey: number;
  ez: number | null;
  xg: number;
  /** The mark it is drawn as. */
  outcome: Outcome;
  /** StatsBomb's finer outcome, e.g. "Saved to Post". */
  outcomeLabel: string;
  bodyPart: string;
  shotType: string;
  technique: string;
}

/** "Left Foot" becomes "Left foot". */
export const sentence = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

export function decodeShots(match: MatchFile, enums: Enums): Shot[] {
  const outcome = new Map(enums.outcome.map((e) => [e.id, e]));
  const name = (list: { id: number; name: string }[]) =>
    new Map(list.map((e) => [e.id, e.name]));
  const bodyPart = name(enums.bodyPart);
  const shotType = name(enums.shotType);
  const technique = name(enums.technique);

  const decode = (c: ShotColumns, from: number, shootout: boolean): Shot[] =>
    c.x.map((x, i) => {
      const playerIdx = c.player[i] ?? -1;
      const player = match.players[playerIdx];
      const out = outcome.get(c.out[i] ?? -1);
      return {
        id: from + i,
        team: c.team[i] === 1 ? 1 : 0,
        playerIdx,
        player: player?.[0] ?? 'Unknown player',
        shirt: player?.[2] ?? null,
        min: c.min[i] ?? 0,
        sec: c.sec[i] ?? 0,
        period: c.per[i] ?? 1,
        shootout,
        x,
        y: c.y[i] ?? 0,
        ex: c.ex[i] ?? 0,
        ey: c.ey[i] ?? 0,
        ez: c.ez[i] ?? null,
        xg: c.xg[i] ?? 0,
        outcome: out?.group ?? 'off',
        outcomeLabel: out?.label ?? 'Unknown',
        bodyPart: bodyPart.get(c.body[i] ?? -1) ?? 'Other',
        shotType: shotType.get(c.type[i] ?? -1) ?? 'Open Play',
        technique: technique.get(c.tech[i] ?? -1) ?? 'Normal',
      };
    });

  const open = decode(match.shots, 0, false);
  return match.shootout ? [...open, ...decode(match.shootout, open.length, true)] : open;
}
