import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageOf } from './router';

// public/_redirects is what makes Cloudflare Pages answer the app's own paths with the app (and
// everything else, /v1/* included, with a real 404: see docs/adr/0008). It has to name exactly
// the paths the router knows, so these read it the way Pages does and compare.
const rules = readFileSync('public/_redirects', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => {
    const [from = '', to = '', status = ''] = line.split(/\s+/);
    return { from, to, status };
  });

/** Pages' matching: a path is exact, or ends in a splat that stands for the rest. */
const rewrites = (path: string): boolean =>
  rules.some(({ from }) =>
    from.endsWith('*') ? path.startsWith(from.slice(0, -1)) : path === from,
  );

describe('public/_redirects', () => {
  it('rewrites to / with a 200, never to /index.html (which Pages redirects to /)', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const { to, status } of rules) {
      expect(to).toBe('/');
      expect(status).toBe('200');
    }
  });

  it('answers every path the router knows with the app, with or without a trailing slash', () => {
    for (const path of [
      '/matches',
      '/matches/',
      '/match/3869685',
      '/match/3869685/',
      '/players/5503',
      '/players/5503/',
      '/compare',
      '/compare/',
    ]) {
      expect(pageOf(path).name, path).not.toBe('missing');
      expect(rewrites(path), path).toBe(true);
    }
  });

  it('leaves everything else to a real 404: the API, the home path, files and typos', () => {
    for (const path of [
      '/v1/meta',
      '/v1/matches/3869685',
      '/v1/search',
      '/matches/5',
      '/compare/x',
      '/nonsense',
      '/index.html',
      '/404.html',
      '/assets/index.js',
    ])
      expect(rewrites(path), path).toBe(false);
  });

  it('does not rewrite / itself: it is the app already', () => {
    expect(rewrites('/')).toBe(false);
    expect(pageOf('/').name).toBe('match');
  });
});
