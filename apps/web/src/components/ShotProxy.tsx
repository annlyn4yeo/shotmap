import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAfterPaint } from '../lib/hooks';
import { memo } from '../lib/memo';
import './proxy.css';

/** One thing a canvas draws that a keyboard or a screen reader must be able to reach. */
export interface ProxyItem {
  id: number;
  /** What assistive technology says for it. */
  label: string;
}

/** Items kept in the page on each side of the one with focus: a screenful, not a career. */
export const PROXY_RADIUS = 12;
/** How far Page Up and Page Down go. */
export const PROXY_PAGE = 10;

/**
 * The slice of a long list to keep in the page: `radius` either side of item `at`, and a full
 * window (2 * radius + 1 items) when the list is that long, even beside either end of it.
 */
export function windowAround(
  count: number,
  at: number,
  radius = PROXY_RADIUS,
): { start: number; end: number } {
  const size = 2 * radius + 1;
  const start = Math.max(0, Math.min(at - radius, count - size));
  return { start, end: Math.min(count, start + size) };
}

/** Where a key takes the roving focus from item `at` of `count`, or null for a key that is not a move. */
export function moveFor(key: string, at: number, count: number): number | null {
  const last = count - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(last, at + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'PageDown':
      return Math.min(last, at + PROXY_PAGE);
    case 'PageUp':
      return Math.max(0, at - PROXY_PAGE);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

interface ShotProxyProps {
  /** The list's accessible name. */
  label: string;
  /** The id of the paragraph that says, in words, what the map shows and how to use the list. */
  describedBy: string;
  /** In reading order. Each one is a button. */
  items: readonly ProxyItem[];
  selectedId: number | null;
  /** The sentence for the item opened, said politely when it changes; empty when none is open. */
  announce: string;
  onSelect: (id: number | null) => void;
  /** The item the keyboard has reached, or null once focus leaves the list. */
  onFocusItem: (id: number | null) => void;
}

/**
 * The keyboard and screen-reader proxy for a canvas: an ordered list with one button for each
 * thing drawn, visually hidden but in the page. One tab stop for the whole list (roving focus):
 * the arrow keys move one, Page Up and Page Down ten, Home and End to the ends, Enter or Space
 * opens, Escape closes. Only the items near the one with focus are in the page, with their true
 * place and the list's true size said (`aria-posinset`, `aria-setsize`), because thousands of
 * buttons are what the canvas is there to avoid. The focused item is drawn by the layer, as a ring
 * on the map; the button itself has nothing to show.
 */
export const ShotProxy = memo(function ShotProxy(props: ShotProxyProps) {
  const { label, describedBy, selectedId, announce, onSelect, onFocusItem } = props;
  // The list follows a filter one paint late: the frame that answers a tap is the map's, and a
  // few dozen buttons that nobody can see are rebuilt after it.
  const items = useAfterPaint(props.items);
  const list = useRef<HTMLOListElement>(null);
  const [roving, setRoving] = useState<number | null>(null);
  /** The item to give focus to once the list has been drawn around it. */
  const pending = useRef<number | null>(null);

  // The tab stop is the item last reached, else the one open, else the first. Found by a scan
  // of the list, once or twice a render: a map of thousands of ids costs more than that.
  const where = (id: number | null) =>
    id === null ? -1 : items.findIndex((item) => item.id === id);
  const at = Math.max(0, where(roving) >= 0 ? where(roving) : where(selectedId));
  const { start, end } = windowAround(items.length, at);

  useLayoutEffect(() => {
    if (pending.current === null) return;
    const id = pending.current;
    pending.current = null;
    // The page must not scroll to a button nobody can see: the map is what the eye is on.
    list.current
      ?.querySelector<HTMLElement>(`[data-i="${id}"]`)
      ?.focus({ preventScroll: true });
  }, [roving, items]);

  if (items.length === 0) return null;

  const go = (to: number) => {
    const item = items[to];
    if (!item) return;
    pending.current = item.id;
    setRoving(item.id);
  };

  return (
    <>
      <ol
        ref={list}
        class="proxy visually-hidden"
        start={start + 1}
        aria-label={label}
        aria-describedby={describedBy}
        onKeyDown={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if (e.key === 'Escape') {
            onSelect(null);
            return;
          }
          const to = moveFor(e.key, at, items.length);
          if (to === null) return;
          e.preventDefault();
          if (to !== at) go(to);
        }}
        onFocusIn={(e) => {
          const raw = (e.target as Element).getAttribute('data-i');
          if (raw === null) return;
          // Coming into the list from outside: the browser only scrolls to the button, which is a
          // pixel in the map's corner, and the ring that shows where focus is would stay below the
          // fold. Bring the whole map into view (WCAG 2.4.7: where focus is must be seen).
          if (!list.current?.contains(e.relatedTarget as Node | null))
            list.current?.closest('.map-frame')?.scrollIntoView({ block: 'nearest' });
          setRoving(Number(raw));
          onFocusItem(Number(raw));
        }}
        onFocusOut={() => onFocusItem(null)}
      >
        {items.slice(start, end).map((item, i) => (
          <li key={item.id} aria-posinset={start + i + 1} aria-setsize={items.length}>
            <button
              type="button"
              data-i={item.id}
              tabIndex={start + i === at ? 0 : -1}
              aria-pressed={item.id === selectedId}
              onClick={() => onSelect(item.id === selectedId ? null : item.id)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ol>
      {/* Always in the page, so that what it comes to say is announced: a live region that
          appears together with its words is often missed. */}
      <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
    </>
  );
});
