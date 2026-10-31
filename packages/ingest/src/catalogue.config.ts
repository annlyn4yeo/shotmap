/**
 * The open catalogue the product keeps: which competitions and seasons the ingest takes, and what it
 * may and may not do with them.
 * The source commit is pinned in data.config.ts; this file is only for what the wider ingest
 * adds: the design ceiling, and the matches and goals that are known to break a rule.
 */

/**
 * What is kept of the catalogue, by the owner's decision of 2026-10-31: the Premier League, La Liga,
 * the Champions League, the men's World Cup and the men's Euros, from the 2014 seasons on. (The
 * source has 80 competition seasons; these are 17 of them, a third of the shots.) A competition is
 * matched by the name the source gives it, so the women's tournaments, which have names of their own,
 * are not in. `since` is the year a season starts: 2014 keeps 2014/2015, 2018 and 2022, not 2013/2014.
 * To keep more, add a line (or lower `since`); `catalogue --everything` takes the whole source.
 * The original 149 matches (World Cup 2022, Euro 2024, La Liga 2018/19) are all inside.
 */
export const scope: readonly { competition: string; since: number }[] = [
  { competition: 'Premier League', since: 2014 },
  { competition: 'La Liga', since: 2014 },
  { competition: 'Champions League', since: 2014 },
  { competition: 'FIFA World Cup', since: 2014 },
  { competition: 'UEFA Euro', since: 2014 },
];

/** The year a season starts: 2015 for '2015/2016', 2022 for '2022'. */
export const seasonYear = (season: string): number =>
  Number(/^\d{4}/.exec(season)?.[0] ?? Number.NaN);

export const inScope = (competition: string, season: string): boolean =>
  scope.some((s) => s.competition === competition && seasonYear(season) >= s.since);

/**
 * The design ceiling (MIGRATION.md, decision Q1): the schema, indexes and endpoint limits are
 * sized for this, and the ingest stops, before writing anything, when the real catalogue is
 * bigger. Raising it is a decision for the owner, not an edit.
 */
export const ceiling = { matches: 10_000, shots: 500_000 };

export interface Quirk {
  /** Why the match is out, with the evidence: what the source says and what the rule needs. */
  reason: string;
}

/**
 * Matches that are left out of the database, each with its reason. A match is in this list only
 * after the failing check was read and understood; the check itself is never relaxed. The ingest
 * prints this list on every run and stores it in the release manifest, so an exclusion is visible
 * and cannot grow silently: a match that fails and is not listed fails the run.
 */
export const excluded: Record<number, Quirk> = {
  3911630: {
    reason:
      'Liga F 2023/24: goal 3911630018 (Raiderlin Nazareth Carrasco Vargas, 67th minute) is shot from x = 43, 77 yards out, in the own half. The check says every team attacks toward x = 120, so a goal from there is either a very long one or a flipped coordinate. Its end point (120, 41.7, 0.2) and its xG (0.016) fit a long shot, but no match report could be found to say it happened. Left out until someone confirms it; then add its shot id to verifiedGoals and remove the match from this list.',
  },
  3911635: {
    reason:
      'Liga F 2023/24: goal 3911635000 (Eider Arana, 0th minute) is shot from x = 36, 84 yards out, in the first seconds. Same as match 3911630: the end point (120, 37.1, 1.6) and the xG (0.003) fit a goal from the kick-off, but no report could be found. Left out until confirmed.',
  },
};

/**
 * Goals shot from the own half (x <= 60) that are real. The coordinate check treats such a goal as
 * a possible flipped coordinate; one listed here, with its evidence, is not held to that one
 * condition. Every other condition (ends on the line, between the posts, under the bar) still
 * applies to it, and a goal is added only with a source that says it happened.
 */
export const verifiedGoals: Record<number, string> = {
  3817886022:
    "Indian Super League 2021/22, Kerala Blasters v NorthEast United, 4 February 2022: Alvaro Vazquez scores in the 82nd minute from behind the halfway line, the keeper off his line (ESPN match report https://www.espn.co.uk/football/report/_/gameId/625578, and the player's Wikipedia article).",
};
