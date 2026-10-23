import type { JSX } from 'preact';
import { markRadius, type Outcome } from '../lib/geometry';
import './marks.css';

export interface ShotMarkProps {
  /** Position in half-pitch units (see project() in lib/geometry). */
  x: number;
  y: number;
  xg: number;
  outcome: Outcome;
  /** Plot order, used only to stagger the entrance. */
  index?: number;
  title?: string;
}

const n = (v: number) => Number(v.toFixed(2));

/** Diagonal hatch lines that end on the circle by construction, so no clipPath is needed. */
function hatchPath(r: number): string {
  const gap = 1.15;
  const reach = Math.floor((r - 0.35) / gap);
  const k = Math.SQRT1_2;
  let d = '';
  for (let i = -reach; i <= reach; i++) {
    const o = i * gap;
    const h = Math.sqrt(r * r - o * o);
    d += `M${n(o * k - h * k)} ${n(o * k + h * k)}L${n(o * k + h * k)} ${n(o * k - h * k)}`;
  }
  return d;
}

function glyph(outcome: Outcome, r: number): JSX.Element {
  switch (outcome) {
    case 'goal':
      return (
        <>
          <circle class="ping" r={n(r + 1.1)} />
          <circle class="halo" r={n(r + 1.1)} />
          <circle class="solid" r={n(r)} />
          <circle class="core" r={n(Math.max(0.5, r * 0.2))} />
        </>
      );
    case 'saved':
      return (
        <>
          <circle class="outline" r={n(r)} />
          <path class="hatch" d={hatchPath(r)} />
        </>
      );
    case 'off': {
      const s = n(r * 0.78);
      return <path class="cross" d={`M${-s} ${-s}L${s} ${s}M${-s} ${s}L${s} ${-s}`} />;
    }
    case 'blocked': {
      const side = n(r * 1.64);
      return (
        <rect class="solid" x={-side / 2} y={-side / 2} width={side} height={side} />
      );
    }
    case 'post': {
      const t = n(r * 1.2);
      const w = n(t * 0.866);
      return <path class="outline" d={`M0 ${-t}L${w} ${n(t / 2)}L${-w} ${n(t / 2)}Z`} />;
    }
  }
}

export function ShotMark({ x, y, xg, outcome, index = 0, title }: ShotMarkProps) {
  const r = markRadius(xg);
  return (
    <g transform={`translate(${n(x)} ${n(y)})`}>
      <g class={`mark mark--${outcome}`} style={`--i:${Math.min(index, 28)}`}>
        {title ? <title>{title}</title> : null}
        {glyph(outcome, r)}
      </g>
    </g>
  );
}
