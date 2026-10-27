import { useEffect } from 'preact/hooks';

/**
 * While a page has nothing yet to show above the footer, the footer is not there at all (the
 * pages' stylesheets hide `.credit` under `:root[data-busy]` with `display: none`). Rows or a
 * map arriving would otherwise push a footer that is on screen down, which is a layout shift,
 * and a thing that comes into being is not a thing that moved.
 */
export function useFooterHidden(busy: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (busy) root.dataset.busy = '';
    else delete root.dataset.busy;
    return () => {
      delete root.dataset.busy;
    };
  }, [busy]);
}
