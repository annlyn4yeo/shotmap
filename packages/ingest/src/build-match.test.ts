import { describe, expect, it } from 'vitest';
import { stageName } from './build-match';
import { stageOrder } from './data.config';

const named = (name: string) => ({ competition_stage: { name } });

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
