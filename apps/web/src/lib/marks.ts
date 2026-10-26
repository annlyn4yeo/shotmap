import type { Outcome } from '@shotmap/schema';

const n = (v: number) => Number(v.toFixed(2));

const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

/**
 * One SVG path for a whole mark, centred on (x, y), so a shot is exactly one element.
 *
 * - goal: disc, a gap, then a ring, with a centre hole. Three nested circles filled
 *   with the even-odd rule make the gap and the hole without a second element.
 * - saved: a ring (stroke and a light fill from CSS).
 * - off: cross. blocked: solid square. post: open triangle.
 */
export function markPath(outcome: Outcome, x: number, y: number, r: number): string {
  switch (outcome) {
    case 'goal': {
      const gap = 0.12 * r + 0.2;
      const ring = 0.1 * r + 0.2;
      return (
        circle(x, y, r + gap + ring) +
        circle(x, y, r + gap) +
        circle(x, y, r) +
        circle(x, y, Math.max(0.4, 0.2 * r))
      );
    }
    case 'saved':
      return circle(x, y, r);
    case 'off': {
      const s = 0.78 * r;
      return `M${n(x - s)} ${n(y - s)}L${n(x + s)} ${n(y + s)}M${n(x - s)} ${n(y + s)}L${n(x + s)} ${n(y - s)}`;
    }
    case 'blocked': {
      const h = 0.82 * r;
      return `M${n(x - h)} ${n(y - h)}h${n(2 * h)}v${n(2 * h)}h${n(-2 * h)}Z`;
    }
    case 'post': {
      const t = 1.2 * r;
      const w = 0.866 * t;
      return `M${n(x)} ${n(y - t)}L${n(x + w)} ${n(y + t / 2)}L${n(x - w)} ${n(y + t / 2)}Z`;
    }
  }
}
