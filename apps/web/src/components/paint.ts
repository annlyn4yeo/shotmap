import type { Outcome } from '@shotmap/schema';
import { markPath } from '../lib/marks';
import type { Frame } from './frame';
import type { MapShot } from './ShotLayer';

/**
 * Painting a shot layer on a canvas. The marks are the SVG layer's own path strings (`markPath`),
 * as `Path2D`, in pitch units; one transform on the context puts the pitch where the SVG layer's
 * group would, so a mark is never converted by hand. The strokes and fills are those of
 * `shots.css`, read from the same tokens. Nothing here makes an image: it only paints, again,
 * whenever the marks or the size change.
 */

/** How one outcome is painted: shots.css, written for a context. */
export interface Ink {
  fill: string | null;
  stroke: string | null;
  /** Stroke width in CSS pixels. */
  width: number;
  evenodd: boolean;
  /**
   * The fill is opaque and plain, so any number of marks of this outcome can be filled in one
   * stroke of the brush: painting them over each other changes nothing. A tinted fill adds up
   * where marks overlap, and an even-odd fill cuts its holes mark by mark, so those go one by one.
   */
  solid: boolean;
}

export type Palette = Record<Outcome, Ink>;

/** `#1b5e92` and an opacity as a colour a context understands. */
export function tint(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${opacity})`;
}

/** The five outcomes' inks, from the tokens as the page has them (so no colour is written twice). */
export function readPalette(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): Palette {
  const token = (name: string) => {
    const value = style.getPropertyValue(`--${name}`).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  };
  const goal = token('goal');
  const saved = token('saved');
  const off = token('off');
  const blocked = token('blocked');
  const post = token('post');
  return {
    // Goal: solid, with the even-odd rule cutting its gap and its centre hole.
    goal: { fill: goal, stroke: null, width: 0, evenodd: true, solid: false },
    saved: {
      fill: tint(saved, 0.1),
      stroke: saved,
      width: 1.75,
      evenodd: false,
      solid: false,
    },
    off: { fill: null, stroke: off, width: 2.25, evenodd: false, solid: false },
    blocked: { fill: blocked, stroke: null, width: 0, evenodd: false, solid: true },
    post: {
      fill: tint(post, 0.14),
      stroke: post,
      width: 2.25,
      evenodd: false,
      solid: false,
    },
  };
}

/**
 * The context transform that draws pitch coordinates the way the SVG layer's group does: the
 * frame's own `place` gives where the pitch's axes go, the viewBox gives the scale. In device
 * pixels, for a canvas of `width` by `height` of them. Returned as setTransform's a, b, c, d, e, f.
 */
export function canvasTransform(
  frame: Pick<Frame, 'place' | 'x' | 'y' | 'w' | 'h'>,
  width: number,
  height: number,
): [number, number, number, number, number, number] {
  const sx = width / frame.w;
  const sy = height / frame.h;
  const o = frame.place(0, 0);
  const ex = frame.place(1, 0);
  const ey = frame.place(0, 1);
  return [
    sx * (ex.x - o.x),
    sy * (ex.y - o.y),
    sx * (ey.x - o.x),
    sy * (ey.y - o.y),
    sx * (o.x - frame.x),
    sy * (o.y - frame.y),
  ];
}

const PATHS = new WeakMap<MapShot, Path2D>();

/**
 * A mark's `Path2D`, made once from the same string the SVG layer draws and kept as long as the
 * mark is: filtering or selecting never builds a path again, and a new set of marks (a resize
 * changes their radii) lets the old ones go.
 */
export function pathOf(mark: MapShot): Path2D {
  let path = PATHS.get(mark);
  if (!path) {
    path = new Path2D(markPath(mark.outcome, mark.x, mark.y, mark.r));
    PATHS.set(mark, path);
  }
  return path;
}

/** The part of a 2D context painting needs, so a test can stand in for it. */
export interface Brush {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  fill(path: Path2D, rule?: CanvasFillRule): void;
  stroke(path: Path2D): void;
}

/** Many marks' paths as one path. */
export function joinPaths(paths: readonly Path2D[]): Path2D {
  const all = new Path2D();
  for (const p of paths) all.addPath(p);
  return all;
}

/**
 * Paints marks of one outcome, already in drawing order, as that outcome's `Ink` says. `unit` is
 * how many pitch units one CSS pixel is, which keeps a stroke the same width on screen however big
 * the pitch is drawn.
 *
 * What the eye sees is what the SVG layer draws, with fewer instructions for the browser to run:
 * every mark's stroke goes in one stroke of the brush (they are opaque, so painting them in one go
 * changes nothing) and so do the fills of a solid outcome. Tinted fills and goals, whose overlaps
 * and holes are mark by mark, are filled one at a time.
 */
export function paintOutcome(
  brush: Brush,
  marks: readonly MapShot[],
  ink: Ink,
  unit: number,
  path: (mark: MapShot) => Path2D = pathOf,
  join: (paths: readonly Path2D[]) => Path2D = joinPaths,
): void {
  if (marks.length === 0) return;
  brush.lineJoin = 'miter';
  const shapes = marks.map(path);
  if (ink.fill) {
    brush.fillStyle = ink.fill;
    if (ink.solid) brush.fill(join(shapes), 'nonzero');
    else
      for (const shape of shapes) brush.fill(shape, ink.evenodd ? 'evenodd' : 'nonzero');
  }
  if (ink.stroke) {
    brush.strokeStyle = ink.stroke;
    brush.lineWidth = ink.width * unit;
    brush.stroke(join(shapes));
  }
}
