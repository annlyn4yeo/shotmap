import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import { HALF } from '../lib/geometry';
import './pitch.css';

interface PitchProps {
  title: string;
  children?: ComponentChildren;
  /** Contours of constant shooting angle: circles through both goalposts. */
  isolines?: boolean;
}

const GOAL_HALF = 4; // the goal mouth is 8 yards wide
const CX = HALF.width / 2;
const ANGLES = [60, 40, 28, 18, 11] as const;
const DOWN = [0, 10, 20, 30, 40, 50, 60] as const;
const ACROSS = [0, 10, 20, 30, 40, 50, 60, 70, 80] as const;

/** Every point on a circle through both posts sees the goal mouth at the same angle. */
const contours = ANGLES.map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const r = GOAL_HALF / Math.sin(rad);
  const cy = r * Math.cos(rad);
  return {
    deg,
    r: Number(r.toFixed(2)),
    cy: Number(cy.toFixed(2)),
    ly: Number((cy + r + 1.8).toFixed(2)),
    labelled: deg <= 18,
  };
});

/** Attacking half, goal at the top. All vector: no raster, no texture files. */
export function Pitch({ title, children, isolines = false }: PitchProps) {
  const clip = useId();
  return (
    <svg
      class="pitch"
      viewBox="-6 -4.5 92 70"
      role="img"
      aria-label={title}
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <rect width={HALF.width} height={HALF.depth} />
        </clipPath>
      </defs>
      <rect class="pitch-surface" width={HALF.width} height={HALF.depth} />

      {isolines ? (
        <g clip-path={`url(#${clip})`} aria-hidden="true">
          {contours.map((c, i) => (
            <circle
              key={c.deg}
              class="pitch-isoline"
              style={`--k:${i}`}
              cx={CX}
              cy={c.cy}
              r={c.r}
            />
          ))}
          {contours
            .filter((c) => c.labelled)
            .map((c) => (
              <text
                key={c.deg}
                class="pitch-text pitch-isolabel"
                x={CX}
                y={c.ly}
                text-anchor="middle"
              >
                {c.deg}°
              </text>
            ))}
        </g>
      ) : null}

      <g aria-hidden="true">
        <path class="pitch-line" d={`M0 ${HALF.depth}V0H${HALF.width}V${HALF.depth}Z`} />
        <path class="pitch-line" d="M18 0V18H62V0" />
        <path class="pitch-line" d="M30 0V6H50V0" />
        <path class="pitch-line" d="M32 18A10 10 0 0 0 48 18" />
        <path class="pitch-line" d="M30 60A10 10 0 0 1 50 60" />
        <path class="pitch-line" d="M0 1A1 1 0 0 0 1 0M79 0A1 1 0 0 0 80 1" />
        <circle class="pitch-spot" cx={CX} cy="12" r="0.55" />

        <path class="pitch-goal" d="M36 0V-2H44V0" />
        <path class="pitch-net" d="M38.67 0V-2M41.33 0V-2" />

        {DOWN.map((t) => (
          <g key={`y${t}`}>
            <path class="pitch-tick" d={`M-1.3 ${t}H0`} />
            <text class="pitch-text" x="-2.2" y={t} text-anchor="end">
              {t}
            </text>
          </g>
        ))}
        {ACROSS.map((t) => (
          <g key={`x${t}`}>
            <path class="pitch-tick" d={`M${t} ${HALF.depth}v1.3`} />
            <text class="pitch-text" x={t} y="63.6" text-anchor="middle">
              {t}
            </text>
          </g>
        ))}
      </g>

      {children}
    </svg>
  );
}
