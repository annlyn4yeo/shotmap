/**
 * A tiny History API router: which page a path is, and which clicks stay in the app. The
 * pages keep their own state in the query string (see route.ts and browse.ts); this only
 * decides what to show. No library.
 */
export type Page =
  | { name: 'match' }
  | { name: 'matches' }
  | { name: 'player'; id: number }
  | { name: 'compare' }
  | { name: 'stress' }
  | { name: 'missing' };

/**
 * `/dev/stress` (thousands of synthetic shots, to be measured) exists in a dev server and in a
 * build made with `VITE_STRESS=1`, and nowhere else: `__STRESS__` is a constant, so a normal build
 * has neither the route nor the page's file.
 */
export const STRESS = __STRESS__;

/** `/` and `/match/:id` are the match page; a trailing slash changes nothing. */
export function pageOf(pathname: string): Page {
  if (pathname === '/' || /^\/match\/\d{1,9}\/?$/.test(pathname))
    return { name: 'match' };
  const path = pathname.replace(/\/+$/, '');
  if (path === '/matches') return { name: 'matches' };
  if (path === '/compare') return { name: 'compare' };
  if (STRESS && path === '/dev/stress') return { name: 'stress' };
  const player = /^\/players\/(\d{1,9})$/.exec(path)?.[1];
  return player === undefined
    ? { name: 'missing' }
    : { name: 'player', id: Number(player) };
}

/**
 * Should this click be handled in the page instead of by the browser? Only a plain left click
 * on a link to another page of this site. A modified click (open in a new tab), a link with a
 * target or a download, another origin, and `/v1` (the API) are all left to the browser.
 */
export function staysInApp(a: HTMLAnchorElement, e: MouseEvent): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) &&
    a.origin === location.origin &&
    !a.pathname.startsWith('/v1') &&
    (a.target === '' || a.target === '_self') &&
    !a.hasAttribute('download') &&
    pageOf(a.pathname).name !== 'missing'
  );
}
