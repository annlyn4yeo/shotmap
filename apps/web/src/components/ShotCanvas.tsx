import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { OUTCOMES, type Outcome } from '@shotmap/schema';
import { drawOrder } from '../lib/geometry';
import { HitGrid } from '../lib/hitgrid';
import { useSize } from '../lib/hooks';
import type { Frame } from './frame';
import { canvasTransform, paintOutcome, pathOf, readPalette } from './paint';
import { Emphasis, Trajectory, type MapShot, type ShotLayerProps } from './ShotLayer';
import { ShotProxy } from './ShotProxy';
import { useDevicePixelRatio } from './useDevicePixelRatio';
import './canvas.css';
import './shots.css';

/** Writes a duration where the stress measurement can read it. Only called where __STRESS__ is. */
function timings(name: string, ms: number): void {
  const store = ((
    window as unknown as { __timings?: Record<string, number[]> }
  ).__timings ??= {});
  (store[name] ??= []).push(ms);
}

/**
 * The outcomes from the bottom layer up. Solid squares go under the rings and triangles, the
 * crosses (which are only strokes) over them, and goals last of all, as in the SVG layer; within
 * one outcome the big marks go first and the small ones on top.
 */
export const LAYER_ORDER: readonly Outcome[] = [
  'blocked',
  'saved',
  'post',
  'off',
  'goal',
];

const sameMarks = (a: readonly MapShot[] | undefined, b: readonly MapShot[]): boolean =>
  a !== undefined && a.length === b.length && a.every((m, i) => m === b[i]);

export interface ShotCanvasProps extends ShotLayerProps {
  /**
   * Every mark of the selection, hidden outcomes included. Given, the canvases are painted from
   * these once and a filter only shows or hides a canvas: no repaint, which is what keeps a tap on
   * a legend chip to a frame. `shots` is then what is showing (the pointer, the keyboard list and
   * the shot in focus use it). Without it, `shots` is painted, and a filter repaints.
   */
  all?: readonly MapShot[];
  /** The id of the paragraph that says what the map shows and how to use the list. */
  describedBy: string;
  /** The sentence for the shot opened, announced politely; empty when none is open. */
  announce: string;
}

/**
 * The shot layer for more marks than the DOM is good for (about 300): the same contract as
 * `ShotLayer`, the same marks, painted on <canvas> elements at the device's pixel ratio.
 *
 * - A path is made once for each mark (`Path2D` of the SVG layer's own string) and kept.
 * - There is one canvas for each outcome, stacked, and a pass paints only the outcomes whose marks
 *   changed. Given every mark (`all`), they are painted once and the legend hiding an outcome is
 *   `opacity: 0` on its canvas, which the compositor does on its own: a filter paints nothing.
 *   Without `all`, hiding "Goal" clears one canvas and showing it paints the goals again, not the
 *   thousands of marks that did not move.
 * - Hovering, focusing or selecting a shot paints nothing: the shot in focus is an overlay of a
 *   few SVG elements above canvases that step back to 28%.
 * - The mark under a pointer is found through a grid of 24 px cells (the SVG layer's 24 px rule,
 *   without a scan of every mark).
 * - The canvases are `aria-hidden`: a list of buttons beside them (`ShotProxy`) is what a keyboard
 *   and a screen reader use.
 *
 * See DESIGN.md section 9.
 */
export function ShotCanvas(props: ShotCanvasProps) {
  const { frame, shots, selectedId, onSelect, label, describedBy, announce } = props;
  const source = props.all ?? shots;
  // An outcome is showing when any of its marks is in `shots`: the legend hides them a kind at a time.
  const showing = useMemo(() => {
    const kinds = new Set<Outcome>();
    // Stops as soon as every outcome has been seen: usually a handful of marks, not thousands.
    for (const s of shots) if (kinds.add(s.outcome).size === OUTCOMES.length) break;
    return kinds;
  }, [shots]);
  const box = useRef<HTMLDivElement>(null);
  const overlay = useRef<SVGSVGElement>(null);
  const canvases = useRef<Partial<Record<Outcome, HTMLCanvasElement | null>>>({});
  /** What each canvas shows now, and at what size, so a pass can leave the ones that did not change. */
  const painted = useRef<
    Partial<Record<Outcome, { marks: readonly MapShot[]; key: string }>>
  >({});
  const paintedFor = useRef<{ source: readonly MapShot[]; key: string } | undefined>(
    undefined,
  );
  const size = useSize(box);
  const ratio = useDevicePixelRatio();
  const palette = useMemo(
    () => readPalette(getComputedStyle(document.documentElement)),
    [],
  );

  // Hover and focus change often, so they live here: nothing above re-renders for them.
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const idOf = hoverId ?? focusId ?? selectedId;
  // A scan, not a map of every mark: it is done once or twice a render, and a map is not free.
  const find = (id: number | null) =>
    id === null ? undefined : shots.find((s) => s.id === id);
  const active = find(idOf);
  const selected = find(selectedId);

  useLayoutEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const paint = () => {
      const began = __STRESS__ ? performance.now() : 0;
      const width = Math.round(size.w * ratio);
      const height = Math.round(size.h * ratio);
      const key = `${width}x${height}:${frame.viewBox}:${frame.w}`;
      // The same marks at the same size are on the canvases already: a filter changes which are
      // showing, which is a style, so this is all it costs.
      if (paintedFor.current?.source === source && paintedFor.current.key === key) return;
      const lists = Object.fromEntries(
        OUTCOMES.map((o) => [o, [] as MapShot[]]),
      ) as Record<Outcome, MapShot[]>;
      for (const s of source) lists[s.outcome].push(s);
      let repainted = 0;
      for (const outcome of LAYER_ORDER) {
        const el = canvases.current[outcome];
        const now = lists[outcome];
        const was = painted.current[outcome];
        if (!el || (was?.key === key && sameMarks(was.marks, now))) continue;
        // Setting a size clears the canvas, so it is only set when it differs.
        if (el.width !== width) el.width = width;
        if (el.height !== height) el.height = height;
        const ctx = el.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (now.length > 0) {
          ctx.setTransform(...canvasTransform(frame, width, height));
          paintOutcome(ctx, drawOrder(now), palette[outcome], frame.w / size.w, pathOf);
          repainted += now.length;
        }
        painted.current[outcome] = { marks: now, key };
      }
      paintedFor.current = { source, key };
      // On the stress page: how long a pass took and how many marks it painted again.
      if (__STRESS__) {
        timings('paint', performance.now() - began);
        timings('repainted', repainted);
      }
    };
    // The first time marks are painted (the layer has just been put on the page, as when the view
    // changes back from density) it is done a frame later, after the one that answers the tap, and
    // the canvases fade in (canvas.css): the thousands of marks are not part of the tap's cost.
    if (paintedFor.current === undefined) {
      let timer = 0;
      const frameId = requestAnimationFrame(() => {
        timer = window.setTimeout(paint, 0);
      });
      return () => {
        cancelAnimationFrame(frameId);
        clearTimeout(timer);
      };
    }
    paint();
  }, [source, frame, size.w, size.h, ratio, palette]);

  // One grid of every mark, in CSS pixels, whatever the legend shows: a filter changes the question
  // asked of it (which outcomes count), not the grid, so tapping a chip never builds one. It is made
  // when a pointer first needs it, or in the first idle moment after the marks or the size change,
  // so not in the frame of the first tap either.
  const grid = useRef<
    { key: [readonly MapShot[], Frame, number, number]; grid: HitGrid } | undefined
  >(undefined);
  const gridNow = (): HitGrid => {
    const known = grid.current;
    if (
      known &&
      known.key[0] === source &&
      known.key[1] === frame &&
      known.key[2] === size.w &&
      known.key[3] === size.h
    )
      return known.grid;
    const built = new HitGrid(
      source.map((s) => {
        const at = frame.place(s.x, s.y);
        return {
          id: s.id,
          x: ((at.x - frame.x) / frame.w) * size.w,
          y: ((at.y - frame.y) / frame.h) * size.h,
          kind: OUTCOMES.indexOf(s.outcome),
        };
      }),
    );
    grid.current = { key: [source, frame, size.w, size.h], grid: built };
    return built;
  };
  const gridRef = useRef(gridNow);
  gridRef.current = gridNow;
  useEffect(() => {
    if (size.w === 0) return;
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => gridRef.current())
        : window.setTimeout(() => gridRef.current(), 200);
    return () => {
      if (typeof requestIdleCallback === 'function') cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [source, frame, size.w, size.h]);
  const hit = (clientX: number, clientY: number): MapShot | undefined => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || size.w === 0) return undefined;
    const counting = OUTCOMES.reduce(
      (mask, o, k) => (showing.has(o) ? mask | (1 << k) : mask),
      0,
    );
    const found = gridNow().nearest(
      ((clientX - rect.left) / rect.width) * size.w,
      ((clientY - rect.top) / rect.height) * size.h,
      undefined,
      counting,
    );
    return found && shots.find((s) => s.id === found.id);
  };

  const focusItem = useCallback((id: number | null) => setFocusId(id), []);

  return (
    <>
      <div
        ref={box}
        class="shot-canvases"
        aria-hidden="true"
        data-focus={active !== undefined}
      >
        {LAYER_ORDER.map((outcome) => (
          <canvas
            key={outcome}
            class="shot-canvas"
            data-outcome={outcome}
            data-hidden={!showing.has(outcome)}
            ref={(el) => {
              canvases.current[outcome] = el;
            }}
          />
        ))}
      </div>
      <svg
        ref={overlay}
        class="shot-layer shot-overlay"
        viewBox={frame.viewBox}
        aria-hidden="true"
        focusable="false"
        data-focus={active !== undefined}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse')
            setHoverId(hit(e.clientX, e.clientY)?.id ?? null);
        }}
        onPointerLeave={() => setHoverId(null)}
        onClick={(e) => {
          const found = hit(e.clientX, e.clientY);
          onSelect(found && found.id !== selectedId ? found.id : null);
        }}
      >
        <g transform={frame.transform}>
          {active ? <Trajectory active={active} /> : null}
          <Emphasis active={active} selected={selected} />
        </g>
      </svg>
      <ShotProxy
        label={label}
        describedBy={describedBy}
        items={shots}
        selectedId={selected ? selectedId : null}
        announce={announce}
        onSelect={onSelect}
        onFocusItem={focusItem}
      />
    </>
  );
}
