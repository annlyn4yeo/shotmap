import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRESS, pageOf, staysInApp } from './router';

describe('which page a path is', () => {
  it('is the match page at / and at /match/:id', () => {
    for (const path of ['/', '/match/3869685', '/match/3869685/', '/match/1'])
      expect(pageOf(path), path).toEqual({ name: 'match' });
  });

  it('knows the browse page, the comparison and a player, with or without a trailing slash', () => {
    expect(pageOf('/matches')).toEqual({ name: 'matches' });
    expect(pageOf('/matches/')).toEqual({ name: 'matches' });
    expect(pageOf('/compare')).toEqual({ name: 'compare' });
    expect(pageOf('/players/5503')).toEqual({ name: 'player', id: 5503 });
    expect(pageOf('/players/5503/')).toEqual({ name: 'player', id: 5503 });
  });

  it('has the stress page only where STRESS is set, and a dev server (which tests run in) is one', () => {
    expect(STRESS).toBe(true);
    expect(pageOf('/dev/stress')).toEqual({ name: 'stress' });
    expect(pageOf('/dev/stress/')).toEqual({ name: 'stress' });
    expect(pageOf('/dev')).toEqual({ name: 'missing' });
  });

  it('calls everything else missing, and never mistakes the API for a page', () => {
    for (const path of [
      '/match',
      '/match/abc',
      '/match/12345678901',
      '/players',
      '/players/x',
      '/players/1/2',
      '/matches/5',
      '/index.html',
      '/v1/matches',
      '/v1',
      '/assets/x.js',
    ])
      expect(pageOf(path), path).toEqual({ name: 'missing' });
  });
});

describe('which clicks stay in the app', () => {
  afterEach(() => vi.unstubAllGlobals());

  const link = (path: string, extra: Partial<HTMLAnchorElement> = {}) =>
    ({
      origin: 'https://shotmap.test',
      pathname: path,
      target: '',
      hasAttribute: () => false,
      ...extra,
    }) as unknown as HTMLAnchorElement;
  const click = (extra: Partial<MouseEvent> = {}) =>
    ({ defaultPrevented: false, button: 0, ...extra }) as MouseEvent;
  const stays = (a: HTMLAnchorElement, e: MouseEvent = click()) => {
    vi.stubGlobal('location', { origin: 'https://shotmap.test' });
    return staysInApp(a, e);
  };

  it('is a plain left click on a link to one of the app’s pages', () => {
    expect(stays(link('/matches'))).toBe(true);
    expect(stays(link('/match/5'))).toBe(true);
    expect(stays(link('/players/5503'))).toBe(true);
    expect(stays(link('/'))).toBe(true);
  });

  it('leaves new-tab clicks, other buttons and handled clicks to the browser', () => {
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
      { defaultPrevented: true },
    ])
      expect(stays(link('/matches'), click(extra)), JSON.stringify(extra)).toBe(false);
  });

  it('leaves other sites, targets, downloads, the API and unknown paths to the browser', () => {
    expect(stays(link('/matches', { origin: 'https://example.com' }))).toBe(false);
    expect(stays(link('/matches', { target: '_blank' }))).toBe(false);
    expect(stays(link('/matches', { hasAttribute: () => true }))).toBe(false);
    expect(stays(link('/v1/matches'))).toBe(false);
    expect(stays(link('/favicon.svg'))).toBe(false);
    expect(stays(link('/matches', { target: '_self' }))).toBe(true);
  });
});
