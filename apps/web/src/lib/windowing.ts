import { useEffect, useRef, useState } from 'preact/hooks';

/** Which rows of `count` to draw, given how far the list is scrolled and how tall the window is. */
export function windowOf(
  count: number,
  rowHeight: number,
  scrolled: number,
  viewport: number,
  overscan = 8,
): { start: number; end: number } {
  if (rowHeight <= 0) return { start: 0, end: count };
  const start = Math.min(count, Math.max(0, Math.floor(scrolled / rowHeight) - overscan));
  const end = Math.min(count, Math.ceil((scrolled + viewport) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

/** Below this many rows, drawing them all is cheaper than watching the scroll. */
export const WINDOW_FROM = 60;

/**
 * Draw only the rows near the screen of a long list that scrolls with the page. The rows must
 * be one height (measured from the first one); padding stands in for the rows left out, so
 * the scrollbar and the anchor links stay right. Put `ref` on the list.
 */
export function useWindow<T extends HTMLElement>(count: number, guess = 64) {
  const ref = useRef<T>(null);
  const [view, setView] = useState({ row: guess, scrolled: 0, viewport: innerHeight });
  const on = count > WINDOW_FROM;

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const list = ref.current;
      if (!list) return;
      const first = list.firstElementChild as HTMLElement | null;
      setView({
        row: first?.offsetHeight || guess,
        scrolled: Math.max(0, -list.getBoundingClientRect().top),
        viewport: innerHeight,
      });
    };
    const later = () => {
      frame ||= requestAnimationFrame(measure);
    };
    measure();
    addEventListener('scroll', later, { passive: true });
    addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', later);
      removeEventListener('resize', later);
    };
  }, [on, count, guess]);

  if (!on) return { ref, start: 0, end: count, before: 0, after: 0 };
  const { start, end } = windowOf(count, view.row, view.scrolled, view.viewport);
  return { ref, start, end, before: start * view.row, after: (count - end) * view.row };
}
