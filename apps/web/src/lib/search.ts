import type { IndexFile } from '@shotmap/schema';

/** One match, flattened out of the index with everything the picker shows and searches. */
export interface MatchEntry {
  id: number;
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homePens: number | null;
  awayPens: number | null;
  stage: string;
  competition: string;
  season: string;
  /** Normalised text to search. */
  haystack: string;
}

export interface MatchGroup {
  key: string;
  title: string;
  entries: MatchEntry[];
}

/** Lower case, no accents: "Türkiye" matches "turkiye". */
export const normalise = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const flat = new WeakMap<IndexFile, MatchEntry[]>();

/** Every match in the index, in index order. Built once per index. */
export function entriesOf(index: IndexFile): MatchEntry[] {
  const known = flat.get(index);
  if (known) return known;
  const out: MatchEntry[] = [];
  for (const competition of index.competitions) {
    for (const season of competition.seasons) {
      for (const [
        id,
        date,
        home,
        away,
        homeScore,
        awayScore,
        stage,
        homePens,
        awayPens,
      ] of season.matches) {
        const stageName = index.stages[stage] ?? '';
        out.push({
          id,
          date,
          home,
          away,
          homeScore,
          awayScore,
          homePens,
          awayPens,
          stage: stageName,
          competition: competition.name,
          season: season.name,
          haystack: normalise(
            `${home} ${away} ${stageName} ${competition.name} ${season.name} ${date}`,
          ),
        });
      }
    }
  }
  flat.set(index, out);
  return out;
}

/**
 * Keep entries where every word of the query appears somewhere in the teams,
 * stage, competition, season or date. No ranking: the index order is already
 * chronological within a competition.
 */
export function searchEntries(
  entries: readonly MatchEntry[],
  query: string,
): MatchEntry[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => words.every((w) => e.haystack.includes(w)));
}

/** Group by competition and season, keeping order. */
export function groupEntries(entries: readonly MatchEntry[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (const entry of entries) {
    const key = `${entry.competition} ${entry.season}`;
    let group = groups[groups.length - 1];
    if (group?.key !== key) {
      group = { key, title: key, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function findEntry(index: IndexFile, id: number): MatchEntry | undefined {
  return entriesOf(index).find((e) => e.id === id);
}
