import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

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
 * Width of an element in CSS pixels, from one ResizeObserver, rounded to 8 px
 * so a drag-resize does not re-render on every pixel. 0 until first measured.
 */
export function useWidth(ref: RefObject<Element | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width / 8) * 8);
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
