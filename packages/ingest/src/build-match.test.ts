import { describe, expect, it } from 'vitest';
import { buildMatch, stageName } from './build-match';
import { stageOrder } from './data.config';

const named = (name: string) => ({ competition_stage: { name } });

describe('who played in a match', () => {
  const raw = {
    match_id: 1,
    match_date: '2024-01-01',
    kick_off: '20:00:00.000',
    competition: { competition_id: 1, competition_name: 'C' },
    season: { season_id: 1, season_name: 'S' },
    home_team: { home_team_id: 10, home_team_name: 'Home' },
    away_team: { away_team_id: 20, away_team_name: 'Away' },
    home_score: 0,
    away_score: 0,
    competition_stage: { name: 'Final' },
  } as unknown as Parameters<typeof buildMatch>[0];
  const event = (name: string, extra: object) =>
    ({
      id: name,
      play_pattern: { id: 1, name: 'Regular Play' },
      period: 1,
      minute: 0,
      second: 0,
      type: { name },
      team: { id: 10, name: 'Home' },
      ...extra,
    }) as unknown as Parameters<typeof buildMatch>[1][number];

  it('is both starting elevens and whoever came on, whether or not they shot', () => {
    const { rich } = buildMatch(
      raw,
      [
        event('Starting XI', {
          tactics: { lineup: [{ player: { id: 1 } }, { player: { id: 2 } }] },
        }),
        event('Starting XI', { tactics: { lineup: [{ player: { id: 3 } }] } }),
        event('Substitution', {
          player: { id: 2, name: 'Off' },
          substitution: { replacement: { id: 4 } },
        }),
        event('Pass', { player: { id: 1, name: 'Starter' } }),
      ],
      null,
    );
    expect(rich.appeared.sort()).toEqual([1, 2, 3, 4]);
    expect(rich.roster).toEqual([]);
  });
});

describe('a stage name from the source', () => {
  it('loses stray whitespace, so "1st Round" and "1st Round " are one stage', () => {
    expect(stageName(named('1st Round '))).toBe('1st Round');
    expect(stageName(named('  1st Round'))).toBe('1st Round');
    expect(stageName(named('Play-offs  -   Semi-Finals'))).toBe(
      'Play-offs - Semi-Finals',
    );
  });

  it('changes nothing else, and in particular nothing the static files hold', () => {
    for (const name of [...stageOrder, 'Championship - Final', 'Apertura'])
      expect(stageName(named(name)), name).toBe(name);
  });
});
