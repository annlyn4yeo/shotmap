import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

/**
 * True from the first time the element is at least `amount` in view, or within `margin` of it
 * (a root margin, such as '300px', to start something just before it is seen). Never false again.
 */
export function useSeen(
  ref: RefObject<Element | null>,
  amount = 0.25,
  margin = '0px',
): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: amount, rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

/** Tracks a media query. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Width of an element in CSS pixels, rounded to 8 px so a drag-resize does not re-render on every
 * pixel. 0 until first measured. Measured once after the first paint (an effect, so it never holds
 * that paint back) and then by one ResizeObserver; the first measure does not wait for the
 * observer, which a window the browser is not painting never hears from.
 */
export function useWidth(ref: RefObject<Element | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const round = (w: number) => Math.round(w / 8) * 8;
    setWidth(round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Width and height of an element in CSS pixels, measured before first paint and kept current. */
export function useSize(ref: RefObject<Element | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number, h: number) =>
      setSize((was) => {
        const next = { w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2 };
        return was.w === next.w && was.h === next.h ? was : next;
      });
    const box = el.getBoundingClientRect();
    measure(box.width, box.height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** From here, both teams default to side by side; below it, to the home team alone. */
export const WIDE = '(min-width: 52rem)';

/** From here there is room for two real panels, so both teams are the default. */
export const BOTH = '(min-width: 64rem)';

/**
 * True once `active` has been true for `ms` milliseconds. A load that finishes
 * sooner never shows a loading state at all, so fast loads do not flash.
 */
export function useDelayed(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && late;
}

/**
 * The value, one paint late. What is built from it comes after the frame that answered the input,
 * so a tap shows its first response (a ring, a dimmed map) before the heavier thing it also opens.
 */
export function useAfterPaint<T>(value: T): T {
  const [late, setLate] = useState(value);
  useEffect(() => {
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setLate(value), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [value]);
  return late;
}

/**
 * While a page has nothing yet to show above the footer, the footer is not there at all (the
 * pages' stylesheets hide `.credit` under `:root[data-busy]` with `display: none`). Rows or a
 * map arriving would otherwise push a footer that is on screen down, which is a layout shift,
 * and a thing that comes into being is not a thing that moved. (Here, and not in a file of its
 * own, so that the pages that use it share the first file's copy and not a request for one.)
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
