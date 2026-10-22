// Uniform grid index over integer ids. Cheap to build, cheap to query, and
// good enough for the few thousand roads and buildings in a district.

export class GridIndex {
  private cells = new Map<number, number[]>();

  constructor(readonly cell: number) {}

  private static key(cx: number, cy: number) {
    return (cx + 1_000_000) * 2_000_003 + (cy + 1_000_000);
  }

  private add(cx: number, cy: number, id: number) {
    const k = GridIndex.key(cx, cy);
    const list = this.cells.get(k);
    if (list) list.push(id); else this.cells.set(k, [id]);
  }

  insertPoint(id: number, x: number, y: number) {
    this.add(Math.floor(x / this.cell), Math.floor(y / this.cell), id);
  }

  insertBox(id: number, minX: number, minY: number, maxX: number, maxY: number) {
    const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
    const y0 = Math.floor(minY / this.cell), y1 = Math.floor(maxY / this.cell);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) this.add(cx, cy, id);
  }

  /** Ids in cells overlapping the box, de-duplicated. */
  query(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const x0 = Math.floor(minX / this.cell), x1 = Math.floor(maxX / this.cell);
    const y0 = Math.floor(minY / this.cell), y1 = Math.floor(maxY / this.cell);
    const seen = new Set<number>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(GridIndex.key(cx, cy));
        if (list) for (const id of list) seen.add(id);
      }
    }
    return [...seen];
  }

  queryRadius(x: number, y: number, r: number): number[] {
    return this.query(x - r, y - r, x + r, y + r);
  }

  /** Iterate every non-empty cell's id list (used for pairwise checks). */
  forEachCell(fn: (ids: number[]) => void) {
    for (const list of this.cells.values()) fn(list);
  }
}
