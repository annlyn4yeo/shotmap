import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@shotmap/schema';
import { announce, flatten, groupsOf, playerGroupsOf } from './options';
import type { SearchState } from './searcher';

const result: SearchResult = {
  q: 'arg',
  players: [{ id: 5503, name: 'Lionel Messi' }],
  teams: [{ id: 779, name: 'Argentina' }],
  matches: [
    { id: 3869685, date: '2022-12-18', home: 'Argentina', away: 'France' },
    { id: 3857300, date: '2022-11-22', home: 'Argentina', away: 'Saudi Arabia' },
  ],
};
const ready = (r: SearchResult): SearchState => ({
  status: 'ready',
  words: r.q,
  result: r,
});

describe('what the picker lists', () => {
  it('groups results as players, teams and matches, and sends each to its own page', () => {
    const groups = groupsOf(ready(result), []);
    expect(groups.map((g) => g.title)).toEqual(['Players', 'Teams', 'Matches']);
    const all = flatten(groups);
    expect(all.map((o) => o.href)).toEqual([
      '/players/5503',
      '/matches?team=779',
      '/match/3869685',
      '/match/3857300',
    ]);
    expect(all.at(-2)).toMatchObject({
      label: 'Argentina v France',
      sub: '18 Dec 2022',
      match: 3869685,
    });
  });

  it('leaves out a group with nothing in it, and has no groups for no results', () => {
    expect(
      groupsOf(ready({ ...result, players: [], matches: [] }), []).map((g) => g.title),
    ).toEqual(['Teams']);
    expect(
      groupsOf(ready({ q: 'zzz', players: [], teams: [], matches: [] }), []),
    ).toEqual([]);
  });

  it('gives every option a key that is safe in an element id', () => {
    const keys = flatten(groupsOf(ready(result), [])).map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[\w-]+$/);
  });

  it('with nothing typed offers the searches made before, then the way to browse everything', () => {
    const idle: SearchState = { status: 'idle' };
    expect(groupsOf(idle, []).map((g) => g.title)).toEqual(['Or']);
    const groups = groupsOf(idle, ['angel di maria', 'Mèssi']);
    expect(groups.map((g) => g.title)).toEqual(['Recent searches', 'Or']);
    const [first, second, browse] = flatten(groups);
    expect(first).toMatchObject({ label: 'angel di maria', words: 'angel di maria' });
    expect(second?.key).not.toBe(first?.key);
    expect(browse).toMatchObject({ label: 'Browse every match', href: '/matches' });
    for (const o of flatten(groups)) expect(o.key).toMatch(/^[\w-]+$/);
  });

  it('lists nothing while the first answer is on its way, and when it failed', () => {
    expect(groupsOf({ status: 'loading', words: 'mes' }, ['x y'])).toEqual([]);
    expect(groupsOf({ status: 'error', words: 'mes' }, [])).toEqual([]);
  });
});

describe('what the picker lists when asked for a player', () => {
  const players: SearchResult = {
    ...result,
    players: [
      { id: 5503, name: 'Lionel Messi' },
      { id: 5207, name: 'Cristiano Ronaldo' },
    ],
  };

  it('offers the players found and nothing else, each carrying its id and no address', () => {
    const groups = playerGroupsOf(ready(players), null);
    expect(groups.map((g) => g.title)).toEqual(['Players']);
    const [first, second] = flatten(groups);
    expect(first).toMatchObject({ label: 'Lionel Messi', player: 5503 });
    expect(second).toMatchObject({ label: 'Cristiano Ronaldo', player: 5207 });
    for (const o of flatten(groups)) {
      expect(o.href).toBeUndefined();
      expect(o.key).toMatch(/^[\w-]+$/);
    }
  });

  it('does not offer the player already on the other side', () => {
    expect(flatten(playerGroupsOf(ready(players), 5503)).map((o) => o.player)).toEqual([
      5207,
    ]);
  });

  it('lists nothing when nobody is left, nothing has been typed, or the answer is on its way', () => {
    expect(playerGroupsOf(ready({ ...players, players: [] }), null)).toEqual([]);
    expect(
      playerGroupsOf(
        ready({ ...players, players: [{ id: 5503, name: 'Lionel Messi' }] }),
        5503,
      ),
    ).toEqual([]);
    expect(playerGroupsOf({ status: 'idle' }, null)).toEqual([]);
    expect(playerGroupsOf({ status: 'loading', words: 'mes' }, null)).toEqual([]);
    expect(playerGroupsOf({ status: 'error', words: 'mes' }, null)).toEqual([]);
  });
});

describe('what a screen reader hears', () => {
  it('says how many results, or that there are none for the words', () => {
    expect(announce(ready(result), 4)).toBe('4 results');
    expect(announce(ready(result), 1)).toBe('1 result');
    expect(announce({ status: 'ready', words: 'zzz', result }, 0)).toBe(
      'No results for zzz',
    );
  });

  it('says when it is searching, when it failed, and nothing when idle', () => {
    expect(announce({ status: 'loading', words: 'x' }, 0)).toBe('Searching');
    expect(announce({ status: 'error', words: 'x' }, 0)).toBe('The search did not work');
    expect(announce({ status: 'idle' }, 3)).toBe('');
  });
});
