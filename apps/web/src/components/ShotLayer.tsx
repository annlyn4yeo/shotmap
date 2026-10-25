import { useRef, useState } from 'preact/hooks';
import type { Shot } from '../data/shots';
import { drawOrder } from '../lib/geometry';
import { markPath } from '../lib/marks';
import type { Frame } from './frame';
import './shots.css';

/** A shot placed on the pitch being drawn (team 2 is mirrored on the full pitch). */
export interface MapShot {
  shot: Shot;
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
 * The renderer contract. Everything a shot layer needs is in these props, and
 * it reports back only a selection (hover, focus and the tab stop are its own), so a canvas renderer can replace
 * this SVG one for an aggregate view of thousands of shots without changing them:
 * it would draw `shots` into a <canvas>, hit-test with the same nearest-point
 * rule, and keep the roving-focus and arrow-key behaviour on a wrapper element.
 * This version is SVG because one match is about thirty shots: one <path> each,
 * no wrappers, no filters.
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

/** A tap or click counts if it lands within this many CSS pixels of a mark's centre. */
const HIT_PX = 24;

const shotLabel = (s: Shot) =>
  `${s.player}, ${s.shootout ? 'penalty shootout' : `minute ${s.min}`}, ${s.outcomeLabel.toLowerCase()}, ${s.xg.toFixed(2)} expected goals`;

export function ShotLayer(props: ShotLayerProps) {
  const { frame, shots, selectedId, intro, onSelect } = props;
  // Hover and focus change often, so they live here: the rest of the map never re-renders for them.
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  /** The shot whose trajectory is drawn: hovered, else keyboard-focused, else selected. */
  const activeId = [hoverId, focusId, selectedId].find(
    (id) => id !== null && shots.some((s) => s.shot.id === id),
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
    const at = shots.findIndex((s) => s.shot.id === id);
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
      focusShot(shots[Math.min(shots.length - 1, Math.max(0, to))]?.shot.id);
    }
  };

  const active = shots.find((s) => s.shot.id === activeId);
  const selected = shots.find((s) => s.shot.id === selectedId);
  const roving = shots.some((s) => s.shot.id === tabId)
    ? tabId
    : (shots[0]?.shot.id ?? null);
  const goals = shots.filter((s) => s.shot.outcome === 'goal');

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
          setHoverId(nearest(e.clientX, e.clientY)?.shot.id ?? null);
      }}
      onPointerLeave={() => setHoverId(null)}
      onClick={(e) => {
        const hit = nearest(e.clientX, e.clientY);
        onSelect(hit && hit.shot.id !== selectedId ? hit.shot.id : null);
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
        {active ? (
          <>
            <path class="traj" d={`M${active.x} ${active.y}L${active.ex} ${active.ey}`} />
            <circle class="traj-end" cx={active.ex} cy={active.ey} r={0.45} />
          </>
        ) : null}

        {intro
          ? goals.map((s) => (
              <circle
                key={s.shot.id}
                class="ping"
                cx={s.x}
                cy={s.y}
                r={s.r}
                style={`--d:${s.delay}ms`}
              />
            ))
          : null}

        {drawOrder(
          shots.map((s) => ({ ...s, xg: s.shot.xg, outcome: s.shot.outcome })),
        ).map((s) => (
          <path
            key={s.shot.id}
            class={`shot shot--${s.shot.outcome}`}
            d={markPath(s.shot.outcome, s.x, s.y, s.r)}
            data-i={s.shot.id}
            data-active={s.shot.id === active?.shot.id}
            role="button"
            tabindex={s.shot.id === roving ? 0 : -1}
            aria-pressed={s.shot.id === selectedId}
            aria-label={shotLabel(s.shot)}
            style={`--d:${s.delay}ms`}
          />
        ))}

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
      </g>
    </svg>
  );
}
