import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { HitGrid } from '../lib/hitgrid';
import {
  binKey,
  binLabel,
  binWhere,
  byBusiest,
  cellOf,
  classPaths,
  classRanges,
  type Bin,
} from '../lib/density';
import { memo } from '../lib/memo';
import type { Frame } from './frame';
import { ShotProxy, type ProxyItem } from './ShotProxy';
import './density.css';

/**
 * The density view (DESIGN.md section 9) is three pieces that ShotPanel puts in different
 * places: the squares, under the pitch's lines (`DensityCells`, handed to the Pitch); the layer
 * that finds the square under a pointer, rings the one in focus and carries the keyboard list
 * (`DensityLayer`, in the layer's place); and the key (`DensityLegend`).
 */

interface CellsProps {
  bins: readonly Bin[];
  step: number;
  /** The busiest bin's count: the top of the scale. */
  max: number;
}

/** Six paths, one for each tint, however many squares there are. In pitch coordinates. */
export const DensityCells = memo(function DensityCells({ bins, step, max }: CellsProps) {
  const paths = useMemo(() => classPaths(bins, step, max), [bins, step, max]);
  return (
    <g class="density" aria-hidden="true">
      {paths.map((d, i) =>
        d ? <path key={i} class={`bin bin--${i + 1}`} d={d} /> : null,
      )}
    </g>
  );
});

export interface DensityLayerProps {
  frame: Frame;
  bins: readonly Bin[];
  step: number;
  selectedKey: number | null;
  label: string;
  /** The id of the paragraph that says what the map shows and how to use the list. */
  describedBy: string;
  /** The sentence for the square opened, announced politely; empty when none is open. */
  announce: string;
  onSelect: (key: number | null) => void;
}

/** A two-tone ring round a square: paper underneath, so the colour above is seen on every tint. */
function Ring({
  bin,
  step,
  kind,
}: {
  bin: Bin;
  step: number;
  kind: 'active' | 'selected';
}) {
  const c = cellOf(bin, step);
  return (
    <>
      <rect class="bin-ring" data-tone="under" x={c.x} y={c.y} width={c.w} height={c.h} />
      <rect
        class="bin-ring"
        data-tone="over"
        data-kind={kind}
        x={c.x}
        y={c.y}
        width={c.w}
        height={c.h}
      />
    </>
  );
}

/**
 * What a pointer and a keyboard do on the density view: hover, tap, and the list of squares,
 * busiest first. A tap lands on the square it is in, or else the nearest square centre within the
 * same 24 px every other layer uses. Hover and focus are this layer's own state.
 */
export function DensityLayer(props: DensityLayerProps) {
  const { frame, bins, step, selectedKey, label, describedBy, announce, onSelect } =
    props;
  const svg = useRef<SVGSVGElement>(null);
  const group = useRef<SVGGElement>(null);
  const [hoverKey, setHoverKey] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const byKey = useMemo(() => new Map(bins.map((b) => [b.key, b])), [bins]);
  const active = byKey.get(hoverKey ?? focusKey ?? selectedKey ?? -1);
  const selected = byKey.get(selectedKey ?? -1);

  const grid = useRef<
    { key: [readonly Bin[], Frame, number, number]; grid: HitGrid } | undefined
  >(undefined);
  const hit = (clientX: number, clientY: number): Bin | undefined => {
    const box = svg.current?.getBoundingClientRect();
    const ctm = group.current?.getScreenCTM();
    if (!box || box.width === 0 || !ctm) return undefined;
    // The square the pointer is in, if it has shots.
    const at = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const inside = byKey.get(binKey(Math.floor(at.x / step), Math.floor(at.y / step)));
    if (inside) return inside;
    // Otherwise the nearest centre, as everywhere else.
    const known = grid.current;
    if (
      !known ||
      known.key[0] !== bins ||
      known.key[1] !== frame ||
      known.key[2] !== box.width ||
      known.key[3] !== box.height
    ) {
      grid.current = {
        key: [bins, frame, box.width, box.height],
        grid: new HitGrid(
          bins.map((b) => {
            const c = cellOf(b, step);
            const p = frame.place(c.x + c.w / 2, c.y + c.h / 2);
            return {
              id: b.key,
              x: ((p.x - frame.x) / frame.w) * box.width,
              y: ((p.y - frame.y) / frame.h) * box.height,
            };
          }),
        ),
      };
    }
    const found = grid.current?.grid.nearest(clientX - box.left, clientY - box.top);
    return found && byKey.get(found.id);
  };

  const items: ProxyItem[] = useMemo(
    () => byBusiest(bins).map((b) => ({ id: b.key, label: binLabel(b, step) })),
    [bins, step],
  );
  const focusItem = useCallback((key: number | null) => setFocusKey(key), []);

  return (
    <>
      <svg
        ref={svg}
        class="shot-layer density-layer"
        viewBox={frame.viewBox}
        aria-hidden="true"
        focusable="false"
        data-focus={active !== undefined}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse')
            setHoverKey(hit(e.clientX, e.clientY)?.key ?? null);
        }}
        onPointerLeave={() => setHoverKey(null)}
        onClick={(e) => {
          const found = hit(e.clientX, e.clientY);
          onSelect(found && found.key !== selectedKey ? found.key : null);
        }}
      >
        <g ref={group} transform={frame.transform}>
          {selected && selected !== active ? (
            <Ring bin={selected} step={step} kind="selected" />
          ) : null}
          {active ? <Ring bin={active} step={step} kind="active" /> : null}
        </g>
      </svg>
      <ShotProxy
        label={label}
        describedBy={describedBy}
        items={items}
        selectedId={selected ? selectedKey : null}
        announce={announce}
        onSelect={onSelect}
        onFocusItem={focusItem}
      />
    </>
  );
}

/** The key: each tint beside the counts it stands for. Only the tints in use are listed. */
export const DensityLegend = memo(function DensityLegend(props: {
  max: number;
  step: number;
}) {
  const ranges = useMemo(() => classRanges(props.max), [props.max]);
  return (
    <div class="density-key">
      <p class="label density-key-title">Shots in a {props.step}-yard square</p>
      <ol class="density-ranges">
        {ranges.map((r) => (
          <li key={r.cls}>
            <span class="density-swatch" data-class={r.cls} aria-hidden="true" />
            <span class="num">{r.from === r.to ? r.from : `${r.from} to ${r.to}`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
});

/** Where a square's centre is on the map, as percentages of its width and height: where its card points. */
export function binAnchor(
  frame: Frame,
  bin: Bin,
  step: number,
): { x: number; y: number } {
  const c = cellOf(bin, step);
  const at = frame.place(c.x + c.w / 2, c.y + c.h / 2);
  return {
    x: ((at.x - frame.x) / frame.w) * 100,
    y: ((at.y - frame.y) / frame.h) * 100,
  };
}

/** Title for a square: where it is, with a capital. */
export const binTitle = (bin: Pick<Bin, 'gx' | 'gy'>, step: number): string => {
  const text = binWhere(bin, step);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** What a screen reader is told when a square is opened: the same facts as its card. */
export const binAnnouncement = (bin: Bin, step: number, total: number): string =>
  `${binLabel(bin, step)}, ${share(bin.n, total)} of the shots shown.`;

const share = (n: number, total: number): string =>
  `${total > 0 ? Math.round((100 * n) / total) : 0}%`;

interface BinCardProps {
  bin: Bin;
  step: number;
  /** All the shots counted on the map, for the square's share of them. */
  total: number;
  /** Where the square is on the map, as percentages of its width and height (popover anchor). */
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * A square's details, in the shot card's own sheet and popover. It does not announce itself: the
 * list beside the map has a live region that already has, and two would say it twice.
 */
export function BinCard({ bin, step, total, anchor, onClose }: BinCardProps) {
  return (
    <section
      class="card"
      aria-label="Square details"
      data-side={anchor.x > 55 ? 'left' : 'right'}
      style={`--ax:${anchor.x.toFixed(1)}%;--ay:${anchor.y.toFixed(1)}%`}
    >
      <button
        type="button"
        class="card-close"
        aria-label="Close square details"
        onClick={onClose}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2 2L10 10M10 2L2 10" />
        </svg>
      </button>
      <h2 class="card-title">{binTitle(bin, step)}</h2>
      <dl class="card-facts">
        <div>
          <dt class="label">Shots</dt>
          <dd class="num">{bin.n}</dd>
        </div>
        <div>
          <dt class="label">Goals</dt>
          <dd class="num">{bin.goals}</dd>
        </div>
        <div>
          <dt class="label">xG</dt>
          <dd class="num">{bin.xg.toFixed(2)}</dd>
        </div>
        <div>
          <dt class="label">Of the shots shown</dt>
          <dd class="num">{share(bin.n, total)}</dd>
        </div>
      </dl>
    </section>
  );
}
