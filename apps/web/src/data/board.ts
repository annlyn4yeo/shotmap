import type { MatchDetail } from '@shotmap/schema';

export interface BoardTeam {
  name: string;
  score: number;
  pens: number | null;
}

/**
 * What the scoreboard needs, from a match.
 */
export interface BoardMeta {
  home: BoardTeam;
  away: BoardTeam;
  stage: string;
  competition: string;
  season: string;
  date: string;
}

export const boardFromDetail = (m: MatchDetail): BoardMeta => ({
  home: { name: m.teams[0].name, score: m.teams[0].score, pens: m.teams[0].pens },
  away: { name: m.teams[1].name, score: m.teams[1].score, pens: m.teams[1].pens },
  stage: m.stage.name,
  competition: m.competition.name,
  season: m.season.name,
  date: m.date,
});
