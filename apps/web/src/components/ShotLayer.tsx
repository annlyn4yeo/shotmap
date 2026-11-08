import { useMemo, useRef, useState } from 'preact/hooks';
import type { Outcome } from '@shotmap/schema';
import { drawOrder } from '../lib/geometry';
import { HIT_PX } from '../lib/hit';
import { useWidth } from '../lib/hooks';
import { markPath } from '../lib/marks';
import { memo } from '../lib/memo';
import {
  countsFrom,
  onPenaltySpot,
  pickOnSpot,
  placeInStack,
  spotsOf,
  stackNote,
  stacksOf,
} from '../lib/stacks';
import type { Frame } from './frame';
import './shots.css';

// Reached through this file on purpose. Two lazy pages importing ShotFigures directly make the
// bundler carve this file and shots.css out of the first file into a shared chunk: two more requests
// on every page, which took the compare page's LCP from 1.55 s to 1.66 s (docs/adr/0012).
export { ShotKey, ZoneTable } from './ShotFigures';

/**
 * A mark on the pitch being drawn. It carries only what the layer needs, not a shot, so any
 * source can feed it: one match's shots, one player's across many matches.
 */
export interface MapShot {
  /** Unique among the marks drawn: the layer's key, its selection and its tab stop. */
  id: number;
  outcome: Outcome;
  xg: number;
  /** What assistive technology says for this mark. */
  label: string;
  /** Where it was taken and where it ended, in the drawn pitch's own coordinates. */
  x: number;
  y: number;
  ex: number;
  ey: number;
  /** Mark radius in pitch units. */
  r: number;
  /** Intro animation delay in ms, from the match minute. */
  delay: number;
  /** Drawn on a quiet map: one ink for all but goals, a goal without its outer ring. */
  quiet?: boolean;
}

/**
 * The renderer contract. Everything a shot layer needs is in these props, and it reports back only
 * a selection (hover, focus and the tab stop are its own), so one layer can replace another
 * without the page changing: `ShotCanvas` takes the same props and paints the same marks into a
 * <canvas> above ~300 of them, with the same nearest-mark rule and the roving focus and arrow keys
 * kept on a list of buttons beside it. This version is SVG because up to a few hundred marks the
 * DOM is cheap and gives hit-testing, focus rings and zoom for free: one <path> each, no
 * wrappers, no filters.
 */
export interface ShotLayerProps {
  frame: Frame;
  /** Chronological. Already filtered to what should be on screen. */
  shots: readonly MapShot[];
  selectedId: number | null;
  /** True while the intro animation runs. */
  intro: boolean;
  label: string;
  onSelect: (id: number | null) => void;
  /** On a quiet map, the outcome whose colour is back: the rest step back behind it. */
  lit?: Outcome | null | undefined;
  /** On a quiet map, what the penalty spot's label says ("7/10 pens") instead of its count. */
  penaltyNote?: string | undefined;
}

/**
 * The shot's flight, from where it was taken to where it ended: a dashed line and a dot. Drawn
 * under the marks in the SVG layer and over the canvas in the canvas layer.
 */
export function Trajectory({ active }: { active: MapShot }) {
  return (
    <>
      <path class="traj" d={`M${active.x} ${active.y}L${active.ex} ${active.ey}`} />
      <circle class="traj-end" cx={active.ex} cy={active.ey} r={0.45} />
    </>
  );
}

/**
 * What marks the shot in focus and the one selected, drawn once above everything else: the active
 * mark again (the real one stays among the dimmed rest), and a ring round each. The same markup
 * in both layers, so they cannot look different.
 */
export function Emphasis(props: {
  active: MapShot | undefined;
  selected: MapShot | undefined;
}) {
  const { active, selected } = props;
  return (
    <>
      {active ? (
        <path
          class={`shot shot--${active.outcome}`}
          d={markPath(active.outcome, active.x, active.y, active.r, active.quiet)}
          aria-hidden="true"
        />
      ) : null}
      {selected ? (
        <circle
          class="ring"
          data-kind="selected"
          cx={selected.x}
          cy={selected.y}
          r={selected.r + 1.7}
        />
      ) : null}
      {active ? (
        <circle
          class="ring"
          data-kind="active"
          cx={active.x}
          cy={active.y}
          r={active.r + (active === selected ? 3.2 : 1.7)}
        />
      ) : null}
    </>
  );
}

/** How far a mark reaches from its centre, in pitch units: a goal's ring is outside its disc. */
const extentOf = (s: MapShot) =>
  s.outcome === 'goal' && !s.quiet ? 1.22 * s.r + 0.4 : s.r;

/** Where the penalty spot's leader ends: just outside the box, clear of the crowd in it. */
const LEADER_TO_Y = 63.2;

/**
 * The count of every spot with more than one mark on it ("×2"), up and to the right of the marks,
 * in the map's mono with a halo of pitch, as a map labels a point that stands for several. Placed
 * in the drawing's own coordinates outside the turned group, so the figures stay upright, and
 * sized from how many CSS pixels a yard is, so they are 11 px on any map. Both layers draw it. With
 * a `penaltyNote` the penalty spot's label goes out of the crowd along a leader, as a map labels a
 * point it cannot label in place.
 */
export function StackCounts(props: {
  frame: Frame;
  spots: readonly (readonly MapShot[])[];
  unitPx: number;
  penaltyNote?: string | undefined;
}) {
  const { frame, spots, unitPx, penaltyNote } = props;
  if (spots.length === 0 || unitPx <= 0) return null;
  const px = 1 / unitPx;
  return (
    <g class="stack-counts" aria-hidden="true">
      {spots.map((stack) => {
        const s = stack[0];
        if (!s) return null;
        const at = frame.place(s.x, s.y);
        if (penaltyNote && onPenaltySpot(s)) {
          const from = frame.place(s.x, s.y + Math.max(...stack.map(extentOf)));
          const to = frame.place(s.x, LEADER_TO_Y);
          return (
            <g key={s.id}>
              <path class="stack-leader" d={`M${from.x} ${from.y}L${to.x} ${to.y}`} />
              <text
                class="stack-count"
                x={to.x + 3 * px}
                y={to.y + 4 * px}
                font-size={11 * px}
                stroke-width={3 * px}
              >
                {penaltyNote}
              </text>
            </g>
          );
        }
        const d = Math.max(...stack.map(extentOf)) * 0.72 + 1.5 * px;
        // Shown once the last of the spot's marks has plotted in.
        const last = Math.max(...stack.map((m) => m.delay));
        return (
          <text
            key={s.id}
            class="stack-count"
            x={at.x + d}
            y={at.y - d}
            font-size={11 * px}
            stroke-width={3 * px}
            style={`--d:${last + 260}ms`}
          >
            &times;{stack.length}
          </text>
        );
      })}
    </g>
  );
}

interface MarkProps {
  s: MapShot;
  /** The one mark in the tab order. */
  tab: boolean;
  pressed: boolean;
  /** Said after the mark's label when it shares its spot: ", 2 of 3 shots from this spot". */
  note: string;
}

/**
 * One mark. Memoised: selecting or focusing a shot changes two of them, so the other couple of
 * hundred a player's map has are not diffed (nor is their path computed again).
 */
const Mark = memo(function Mark({ s, tab, pressed, note }: MarkProps) {
  return (
    <path
      class={`shot shot--${s.outcome}`}
      d={markPath(s.outcome, s.x, s.y, s.r, s.quiet)}
      data-i={s.id}
      role="button"
      tabindex={tab ? 0 : -1}
      aria-pressed={pressed}
      aria-label={s.label + note}
      style={`--d:${s.delay}ms`}
    />
  );
});

/**
 * One outcome in its own colour, above the dimmed marks: drawn again rather than restyled, so a
 * couple of hundred marks are not touched. The marks that can be joined are one path, one element;
 * goals are each their own, because an even-odd fill would cut holes where two of them overlap.
 */
const LitMarks = memo(function LitMarks(props: {
  shots: readonly MapShot[];
  lit: Outcome;
}) {
  const { shots, lit } = props;
  const own = shots.filter((s) => s.outcome === lit);
  const path = (s: MapShot) => markPath(s.outcome, s.x, s.y, s.r, s.quiet);
  return (
    <g class="lit" aria-hidden="true">
      {lit === 'goal' ? (
        drawOrder(own).map((s) => <path key={s.id} class="shot shot--goal" d={path(s)} />)
      ) : (
        <path class={`shot shot--${lit}`} d={own.map(path).join('')} />
      )}
    </g>
  );
});

export function ShotLayer(props: ShotLayerProps) {
  const { frame, shots, selectedId, intro, onSelect, lit, penaltyNote } = props;
  const quiet = shots[0]?.quiet === true;
  // Hover and focus change often, so they live here: the rest of the map never re-renders for them.
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  /** The shot whose trajectory is drawn: hovered, else keyboard-focused, else selected. */
  const activeId = [hoverId, focusId, selectedId].find(
    (id) => id !== null && shots.some((s) => s.id === id),
  );
  const svg = useRef<SVGSVGElement>(null);
  const group = useRef<SVGGElement>(null);
  // Marks on the same spot: their count is drawn beside them, and a pick there opens each in turn.
  const stacks = useMemo(() => stacksOf(shots), [shots]);
  const spots = useMemo(
    () => spotsOf(stacks, countsFrom(shots.length), penaltyNote !== undefined),
    [stacks, shots.length, penaltyNote],
  );
  // Measured after the first paint, not before it: a measure before it re-renders the layer ahead of
  // that paint, and on the home page and the match page that held the headline back (LCP). The
  // counts come a frame after the marks, which is when they fade in anyway.
  const width = useWidth(svg);

  /** One listener finds the nearest mark, so thirty paths need no handlers of their own. */
  const nearest = (clientX: number, clientY: number): MapShot | undefined => {
    const ctm = group.current?.getScreenCTM();
    if (!ctm) return undefined;
    const at = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    let reach = HIT_PX / Math.hypot(ctm.a, ctm.b);
    let best: MapShot | undefined;
    for (const s of shots) {
      const d = Math.hypot(s.x - at.x, s.y - at.y);
      if (d <= reach) {
        reach = d;
        best = s;
      }
    }
    return best;
  };

  const focusShot = (id: number | undefined) => {
    if (id !== undefined)
      svg.current?.querySelector<SVGElement>(`[data-i="${id}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const raw = (e.target as Element).getAttribute('data-i');
    if (raw === null) return;
    const id = Number(raw);
    const at = shots.findIndex((s) => s.id === id);
    if (at < 0) return;
    let to: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        to = at + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        to = at - 1;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = shots.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(id === selectedId ? null : id);
        break;
      case 'Escape':
        onSelect(null);
        break;
    }
    if (to !== null) {
      e.preventDefault();
      focusShot(shots[Math.min(shots.length - 1, Math.max(0, to))]?.id);
    }
  };

  const active = shots.find((s) => s.id === activeId);
  const selected = shots.find((s) => s.id === selectedId);
  const roving = shots.some((s) => s.id === tabId) ? tabId : (shots[0]?.id ?? null);
  const goals = useMemo(() => shots.filter((s) => s.outcome === 'goal'), [shots]);
  const drawn = useMemo(() => drawOrder(shots), [shots]);

  return (
    <svg
      ref={svg}
      class="shot-layer"
      viewBox={frame.viewBox}
      role="group"
      aria-label={props.label}
      data-focus={active !== undefined}
      data-lit={lit ?? undefined}
      focusable="false"
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse')
          setHoverId(nearest(e.clientX, e.clientY)?.id ?? null);
      }}
      onPointerLeave={() => setHoverId(null)}
      onClick={(e) => {
        onSelect(pickOnSpot(nearest(e.clientX, e.clientY)?.id, selectedId, stacks));
      }}
      onKeyDown={onKeyDown}
      onFocusIn={(e) => {
        const target = e.target as Element;
        const raw = target.getAttribute('data-i');
        if (raw !== null) {
          setTabId(Number(raw));
          setFocusId(target.matches(':focus-visible') ? Number(raw) : null);
        }
      }}
      onFocusOut={() => setFocusId(null)}
    >
      <g ref={group} transform={frame.transform}>
        {active ? <Trajectory active={active} /> : null}

        {intro
          ? goals.map((s) => (
              <circle
                key={s.id}
                class="ping"
                cx={s.x}
                cy={s.y}
                r={s.r}
                style={`--d:${s.delay}ms`}
              />
            ))
          : null}

        {/* Focus mode dims this one group, not every mark: a restyle of a couple of hundred
            elements was most of what a tap cost on a player's map. */}
        <g class="marks" data-quiet={quiet || undefined}>
          {drawn.map((s) => (
            <Mark
              key={s.id}
              s={s}
              tab={s.id === roving}
              pressed={s.id === selectedId}
              note={stackNote(placeInStack(s.id, stacks))}
            />
          ))}
        </g>
        {lit ? <LitMarks shots={shots} lit={lit} /> : null}
        <Emphasis active={active} selected={selected} />
      </g>
      <StackCounts
        frame={frame}
        spots={spots}
        unitPx={width / frame.w}
        penaltyNote={penaltyNote}
      />
    </svg>
  );
}
