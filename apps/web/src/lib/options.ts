import type { SearchState } from './searcher';

/** One line the picker can offer: a result, a recent search, or the way to browse everything. */
export interface Option {
  /** Unique within the list; becomes the element id, so the combobox can point at it. */
  key: string;
  label: string;
  sub?: string;
  /** Where choosing it goes. */
  href?: string;
  /** For a match: the id, so choosing it can use the match transition. */
  match?: number;
  /** For a recent search: the words to put back in the field. */
  words?: string;
  /** For a player offered to a slot of the compare page: the id, which choosing it hands over. */
  player?: number;
}

export interface OptionGroup {
  key: string;
  title: string;
  options: Option[];
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const formatDate = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`));

const BROWSE: Option = { key: 'browse', label: 'Browse every match', href: '/matches' };

/**
 * What the picker lists: results grouped as players, teams and matches when there are some;
 * otherwise, with nothing typed, the searches made before and the way to browse everything.
 */
export function groupsOf(state: SearchState, recents: readonly string[]): OptionGroup[] {
  if (state.status === 'idle')
    return [
      ...(recents.length
        ? [
            {
              key: 'recent',
              title: 'Recent searches',
              options: recents.map((words, at) => ({
                key: `recent-${at}`,
                label: words,
                words,
              })),
            },
          ]
        : []),
      { key: 'browse', title: 'Or', options: [BROWSE] },
    ];
  if (state.status !== 'ready') return [];
  const { players, teams, matches } = state.result;
  const groups: OptionGroup[] = [
    {
      key: 'players',
      title: 'Players',
      options: players.map((p) => ({
        key: `player-${p.id}`,
        label: p.name,
        sub: 'Player',
        href: `/players/${p.id}`,
      })),
    },
    {
      key: 'teams',
      title: 'Teams',
      options: teams.map((t) => ({
        key: `team-${t.id}`,
        label: t.name,
        sub: 'Every match they played',
        href: `/matches?team=${t.id}`,
      })),
    },
    {
      key: 'matches',
      title: 'Matches',
      options: matches.map((m) => ({
        key: `match-${m.id}`,
        label: `${m.home} v ${m.away}`,
        sub: formatDate(m.date),
        href: `/match/${m.id}`,
        match: m.id,
      })),
    },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/**
 * What the picker lists when it is asked for a player to compare: the players found, and nothing
 * else. `taken` is the player already on the other side, who is not offered a second time.
 */
export function playerGroupsOf(state: SearchState, taken: number | null): OptionGroup[] {
  if (state.status !== 'ready') return [];
  const options = state.result.players
    .filter((p) => p.id !== taken)
    .map((p) => ({ key: `player-${p.id}`, label: p.name, player: p.id }));
  return options.length ? [{ key: 'players', title: 'Players', options }] : [];
}

/** Every option in the order the arrow keys walk them. */
export const flatten = (groups: readonly OptionGroup[]): Option[] =>
  groups.flatMap((g) => g.options);

/** What a screen reader hears when the list changes. */
export function announce(state: SearchState, count: number): string {
  switch (state.status) {
    case 'idle':
      return '';
    case 'loading':
      return 'Searching';
    case 'error':
      return 'The search did not work';
    case 'ready':
      return count === 0
        ? `No results for ${state.words}`
        : `${count} ${count === 1 ? 'result' : 'results'}`;
  }
}
