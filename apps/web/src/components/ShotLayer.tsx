import { useMemo, useRef, useState } from 'preact/hooks';
import type { Outcome } from '@shotmap/schema';
import { drawOrder } from '../lib/geometry';
import { HIT_PX } from '../lib/hit';
import { markPath } from '../lib/marks';
import { memo } from '../lib/memo';
import type { Frame } from './frame';
import './shots.css';

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
          d={markPath(active.outcome, active.x, active.y, active.r)}
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

interface MarkProps {
  s: MapShot;
  /** The one mark in the tab order. */
  tab: boolean;
  pressed: boolean;
}

/**
 * One mark. Memoised: selecting or focusing a shot changes two of them, so the other couple of
 * hundred a player's map has are not diffed (nor is their path computed again).
 */
const Mark = memo(function Mark({ s, tab, pressed }: MarkProps) {
  return (
    <path
      class={`shot shot--${s.outcome}`}
      d={markPath(s.outcome, s.x, s.y, s.r)}
      data-i={s.id}
      role="button"
      tabindex={tab ? 0 : -1}
      aria-pressed={pressed}
      aria-label={s.label}
      style={`--d:${s.delay}ms`}
    />
  );
});

export function ShotLayer(props: ShotLayerProps) {
  const { frame, shots, selectedId, intro, onSelect } = props;
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
      focusable="false"
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse')
          setHoverId(nearest(e.clientX, e.clientY)?.id ?? null);
      }}
      onPointerLeave={() => setHoverId(null)}
      onClick={(e) => {
        const hit = nearest(e.clientX, e.clientY);
        onSelect(hit && hit.id !== selectedId ? hit.id : null);
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
        <g class="marks">
          {drawn.map((s) => (
            <Mark key={s.id} s={s} tab={s.id === roving} pressed={s.id === selectedId} />
          ))}
        </g>
        <Emphasis active={active} selected={selected} />
      </g>
    </svg>
  );
}
