import { useId } from 'preact/hooks';
import { PITCH } from '@shotmap/schema';
import { memo } from '../lib/memo';
import { frameFor, type Orientation, type PitchMode } from './frame';
import './pitch.css';

interface PitchProps {
  /** The text alternative: say what the map shows, not what a pitch is. */
  title: string;
  mode?: PitchMode;
  orientation?: Orientation;
  /** Crop the pitch to start at this x (a close-up of the attacking end). */
  from?: number;
  /** Contours of constant shooting angle: circles through both goalposts. Off by default. */
  contours?: boolean;
}

const { length: L, width: W } = PITCH;
const GOAL_HALF = (PITCH.goalY[1] - PITCH.goalY[0]) / 2;
const MID_Y = W / 2;
const ANGLES = [60, 40, 28, 18, 11] as const;
const STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
/** How far, in yards, the surface takes to fade in from a cropped edge. */
const FADE = 9;

/** Every point on a circle through both posts sees the goal mouth at the same angle. */
const arcs = ANGLES.map((deg) => {
  const rad = (deg * Math.PI) / 180;
  const r = GOAL_HALF / Math.sin(rad);
  const toCentre = r * Math.cos(rad);
  return { deg, r: Number(r.toFixed(2)), toCentre: Number(toCentre.toFixed(2)) };
});

/** Markings round one goal, as path data. `d` is a distance from that goal's line. */
function endMarkings(right: boolean) {
  const X = (d: number) => (right ? L - d : d);
  const [post1, post2] = PITCH.goalY;
  return {
    boxes: `M${X(0)} 18H${X(18)}V62H${X(0)}M${X(0)} 30H${X(6)}V50H${X(0)}`,
    arc: `M${X(18)} 32A10 10 0 0 ${right ? 0 : 1} ${X(18)} 48`,
    corners: right
      ? 'M119 0A1 1 0 0 0 120 1M119 80A1 1 0 0 1 120 79'
      : 'M0 1A1 1 0 0 0 1 0M1 80A1 1 0 0 0 0 79',
    goal: `M${X(0)} ${post1}H${X(-2)}V${post2}H${X(0)}`,
    net: `M${X(0)} 38.67H${X(-2)}M${X(0)} 41.33H${X(-2)}`,
    spot: X(12),
  };
}

const distance = (x: number, mode: PitchMode) =>
  mode === 'half' ? L - x : Math.min(x, L - x);

/**
 * Pitch lines and one distance axis. Vector only. Shots are drawn by the layer on top.
 * A cropped pitch has no line where it is cut: the surface fades in instead, so it
 * reads as continuing.
 */
export const Pitch = memo(function Pitch({
  title,
  mode = 'half',
  orientation = 'vertical',
  from,
  contours = false,
}: PitchProps) {
  const id = useId();
  const frame = frameFor(mode, orientation, from);
  const { xMin, place } = frame;
  const cropped = xMin > L / 2;
  const goals = mode === 'full' ? [true, false] : [true];

  // Ticks and labels live outside the rotated group so the text stays upright.
  const vertical = orientation === 'vertical';
  const ticks = STEPS.filter((x) => x >= xMin).map((x) => {
    const at = place(x, W);
    const text = distance(x, mode);
    return vertical
      ? { key: x, tick: `M-1.3 ${at.y}H0`, tx: -2.2, ty: at.y, anchor: 'end', text }
      : { key: x, tick: `M${x} ${W}v1.3`, tx: x, ty: W + 3.6, anchor: 'middle', text };
  });

  return (
    <svg
      class="pitch"
      viewBox={frame.viewBox}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}c`}>
          <rect x={xMin} width={L - xMin} height={W} />
        </clipPath>
        {cropped ? (
          <linearGradient
            id={`${id}f`}
            gradientUnits="userSpaceOnUse"
            x1={xMin}
            y1="0"
            x2={xMin + FADE}
            y2="0"
          >
            <stop offset="0" class="pitch-fade-from" />
            <stop offset="1" class="pitch-fade-to" />
          </linearGradient>
        ) : null}
      </defs>

      <g transform={frame.transform}>
        <rect
          class="pitch-surface"
          x={xMin}
          width={L - xMin}
          height={W}
          style={cropped ? `fill:url(#${id}f)` : undefined}
        />

        {contours ? (
          <g clip-path={`url(#${id}c)`}>
            {goals.flatMap((right) =>
              arcs.map((a) => (
                <circle
                  key={`${right}${a.deg}`}
                  class="pitch-isoline"
                  cx={right ? L - a.toCentre : a.toCentre}
                  cy={MID_Y}
                  r={a.r}
                />
              )),
            )}
          </g>
        ) : null}

        <path
          class="pitch-line"
          d={`M${xMin} 0H${L}V${W}H${xMin}${cropped ? '' : 'Z'}`}
        />
        {mode === 'full' ? (
          <>
            <path class="pitch-line" d={`M${L / 2} 0V${W}`} />
            <circle class="pitch-line" cx={L / 2} cy={MID_Y} r="10" />
          </>
        ) : cropped ? null : (
          <path class="pitch-line" d={`M${L / 2} 30A10 10 0 0 1 ${L / 2} 50`} />
        )}
        {xMin <= L / 2 ? (
          <circle class="pitch-spot" cx={L / 2} cy={MID_Y} r="0.55" />
        ) : null}

        {goals.map((right) => {
          const m = endMarkings(right);
          return (
            <g key={String(right)}>
              <path class="pitch-line" d={`${m.boxes}${m.arc}${m.corners}`} />
              <circle class="pitch-spot" cx={m.spot} cy={MID_Y} r="0.55" />
              <path class="pitch-net" d={m.net} />
              <path class="pitch-goal" d={m.goal} />
            </g>
          );
        })}
      </g>

      <g class="pitch-axis" aria-hidden="true">
        {ticks.map((t) => (
          <g key={t.key}>
            <path class="pitch-tick" d={t.tick} />
            <text class="pitch-text" x={t.tx} y={t.ty} text-anchor={t.anchor}>
              {t.text}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
});
