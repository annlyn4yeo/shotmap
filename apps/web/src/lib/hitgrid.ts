import { HIT_PX } from './hit';

/** Something a pointer can land on: an id and where its centre is, in CSS pixels. */
export interface Spot {
  id: number;
  x: number;
  y: number;
  /**
   * What kind of mark it is, 0 to 30. A lookup can be limited to some kinds (`kinds`), so one
   * grid serves every filter: hiding an outcome changes the question, not the grid.
   */
  kind?: number;
}

/**
 * The nearest-mark rule of the SVG layer, for a canvas: of the spots within `reach` pixels of
 * the pointer, the nearest one (a tie goes to the one later in the list, the one drawn on top).
 * The spots are sorted once into a uniform grid whose cells are as wide as the reach, so a
 * lookup reads nine cells and never the thousands of marks a career has. Built again whenever
 * the marks or the size they are drawn at change.
 */
export class HitGrid {
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  /** `items[start[c] .. start[c + 1]]` are the spots in cell `c`, in list order. */
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  constructor(
    private readonly spots: readonly Spot[],
    private readonly cell = HIT_PX,
  ) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of spots) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }
    if (spots.length === 0) minX = minY = maxX = maxY = 0;
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / cell) + 1;
    this.rows = Math.floor((maxY - minY) / cell) + 1;

    // A counting sort by cell keeps each cell's spots in list order without allocating per cell.
    const counts = new Int32Array(this.cols * this.rows + 1);
    const cellOf = new Int32Array(spots.length);
    spots.forEach((s, i) => {
      const c = this.column(s.x) + this.row(s.y) * this.cols;
      cellOf[i] = c;
      counts[c + 1] = (counts[c + 1] ?? 0) + 1;
    });
    for (let c = 0; c < this.cols * this.rows; c++)
      counts[c + 1] = (counts[c + 1] ?? 0) + (counts[c] ?? 0);
    this.start = counts;
    const fill = counts.slice(0, this.cols * this.rows);
    this.items = new Int32Array(spots.length);
    cellOf.forEach((c, i) => {
      const at = fill[c] ?? 0;
      this.items[at] = i;
      fill[c] = at + 1;
    });
  }

  private column(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)));
  }

  /**
   * The spot under (x, y), or undefined when none is within `reach` (at most the cell size).
   * `kinds` is a bit mask of the kinds that count (bit k for kind k): all of them by default.
   */
  nearest(x: number, y: number, reach = this.cell, kinds = -1): Spot | undefined {
    if (this.spots.length === 0) return undefined;
    const r = Math.min(reach, this.cell);
    // Outside the grid by more than the reach, nothing can be close enough.
    if (
      x < this.minX - r ||
      y < this.minY - r ||
      x > this.minX + this.cols * this.cell + r ||
      y > this.minY + this.rows * this.cell + r
    )
      return undefined;
    const c0 = this.column(x);
    const r0 = this.row(y);
    let best = -1;
    let bestD = r;
    for (let row = Math.max(0, r0 - 1); row <= Math.min(this.rows - 1, r0 + 1); row++) {
      for (let col = Math.max(0, c0 - 1); col <= Math.min(this.cols - 1, c0 + 1); col++) {
        const c = col + row * this.cols;
        for (let k = this.start[c] ?? 0; k < (this.start[c + 1] ?? 0); k++) {
          const i = this.items[k] ?? 0;
          const s = this.spots[i];
          if (!s || ((1 << (s.kind ?? 0)) & kinds) === 0) continue;
          const d = Math.hypot(s.x - x, s.y - y);
          if (d < bestD || (d === bestD && i > best)) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best < 0 ? undefined : this.spots[best];
  }
}
