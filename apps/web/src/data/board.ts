import type { MatchEntry } from '../lib/search';
import type { MatchDetail } from '@shotmap/schema';

export interface BoardTeam {
  name: string;
  score: number;
  pens: number | null;
}

/**
 * What the scoreboard needs. It can be built from a match or from a match-list
 * row alone, so the board can change the instant a match is chosen, before that
 * match's shots have loaded.
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

export const boardFromEntry = (e: MatchEntry): BoardMeta => ({
  home: { name: e.home, score: e.homeScore, pens: e.homePens },
  away: { name: e.away, score: e.awayScore, pens: e.awayPens },
  stage: e.stage,
  competition: e.competition,
  season: e.season,
  date: e.date,
});
