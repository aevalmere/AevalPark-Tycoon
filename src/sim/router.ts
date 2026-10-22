// A* over the directed road graph, weighted by live travel time.
// Heap and search shape come from ParkKing's router; this version starts and
// ends part-way along a link (a building's kerb), and reuses its scratch
// arrays between searches so routing hundreds of cars a minute stays cheap.

import type { LinkPos, World } from '../world/types';

export interface Route {
  edges: number[];
  /** distance into the first edge where the vehicle starts */
  startOffset: number;
  /** distance into the last edge where the vehicle stops */
  endOffset: number;
  length: number;
  cost: number;
}

/** Travel cost of a whole edge, in game minutes. Must never be below length / maxSpeed. */
export type EdgeCost = (edge: number) => number;

class MinHeap {
  private keys: number[] = [];
  private prio: number[] = [];
  get size() { return this.keys.length; }
  clear() { this.keys.length = 0; this.prio.length = 0; }
  push(key: number, p: number) {
    const k = this.keys, q = this.prio;
    k.push(key); q.push(p);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (q[par] <= q[i]) break;
      [k[par], k[i]] = [k[i], k[par]];
      [q[par], q[i]] = [q[i], q[par]];
      i = par;
    }
  }
  pop(): number {
    const k = this.keys, q = this.prio;
    const top = k[0];
    const lk = k.pop()!, lq = q.pop()!;
    if (k.length) {
      k[0] = lk; q[0] = lq;
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < n && q[l] < q[s]) s = l;
        if (r < n && q[r] < q[s]) s = r;
        if (s === i) break;
        [k[s], k[i]] = [k[i], k[s]];
        [q[s], q[i]] = [q[i], q[s]];
        i = s;
      }
    }
    return top;
  }
}

const MAX_EXPANSIONS = 40000;

export class Router {
  private g: Float64Array;
  private came: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private startMark: Int32Array;
  private run = 0;
  private heap = new MinHeap();

  constructor(private world: World, private maxSpeed: number) {
    const n = world.nodeX.length + 1; // +1 for the virtual goal
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.startMark = new Int32Array(n);
  }

  /** offset along a directed edge for a position given from the link's `a` end */
  offsetOn(edge: number, pos: LinkPos) {
    const e = this.world.edges[edge];
    return e.dir === 1 ? pos.offset : e.length - pos.offset;
  }

  route(from: LinkPos, to: LinkPos, cost: EdgeCost): Route | null {
    const w = this.world;
    const goal = w.nodeX.length;
    const run = ++this.run;
    const { g, came, stamp, closed, startMark, heap } = this;
    heap.clear();

    const tl = w.links[to.link];
    const tx = interp(tl.pts, tl.cum, to.offset);
    const h = (n: number) => Math.hypot(w.nodeX[n] - tx[0], w.nodeY[n] - tx[1]) / this.maxSpeed;

    // best direct route along a shared link
    let direct: Route | null = null;
    if (from.link === to.link) {
      for (const e of w.linkEdges[from.link]) {
        const s = this.offsetOn(e, from), t = this.offsetOn(e, to);
        if (t + 1e-6 < s) continue;
        const c = ((t - s) / Math.max(1e-6, w.edges[e].length)) * cost(e);
        if (!direct || c < direct.cost) direct = { edges: [e], startOffset: s, endOffset: t, length: t - s, cost: c };
      }
    }

    const setG = (n: number, v: number, via: number) => { stamp[n] = run; g[n] = v; came[n] = via; };
    const getG = (n: number) => (stamp[n] === run ? g[n] : Infinity);

    for (const e of w.linkEdges[from.link]) {
      const edge = w.edges[e];
      const s = this.offsetOn(e, from);
      const c = ((edge.length - s) / Math.max(1e-6, edge.length)) * cost(e);
      if (c < getG(edge.to)) {
        setG(edge.to, c, e);
        startMark[edge.to] = run;
        heap.push(edge.to, c + h(edge.to));
      }
    }

    const goalVia = new Map<number, { edge: number; extra: number }>();
    for (const e of w.linkEdges[to.link]) {
      const edge = w.edges[e];
      const t = this.offsetOn(e, to);
      const extra = (t / Math.max(1e-6, edge.length)) * cost(e);
      const prev = goalVia.get(edge.from);
      if (!prev || extra < prev.extra) goalVia.set(edge.from, { edge: e, extra });
    }

    let expansions = 0;
    let found = false;
    while (heap.size) {
      const n = heap.pop();
      if (n === goal) { found = true; break; }
      if (closed[n] === run) continue;
      closed[n] = run;
      if (++expansions > MAX_EXPANSIONS) break;
      const gn = g[n];
      if (direct && gn >= direct.cost) break;
      const gv = goalVia.get(n);
      if (gv) {
        const total = gn + gv.extra;
        if (total < getG(goal)) { setG(goal, total, gv.edge); heap.push(goal, total); }
      }
      for (const e of w.nodeOut[n]) {
        const to2 = w.edges[e].to;
        if (closed[to2] === run) continue;
        const ng = gn + cost(e);
        if (ng < getG(to2)) {
          setG(to2, ng, e);
          startMark[to2] = startMark[to2] === run ? -1 : startMark[to2]; // reached by a real edge now
          heap.push(to2, ng + h(to2));
        }
      }
    }

    if (!found) return direct;
    const total = g[goal];
    if (direct && direct.cost <= total) return direct;

    const lastEdge = came[goal];
    const edges = [lastEdge];
    let n = w.edges[lastEdge].from;
    for (let guard = 0; guard < 100000; guard++) {
      const e = came[n];
      edges.push(e);
      // still marked as a start node means it was reached straight off the origin link
      if (startMark[n] === run) break;
      n = w.edges[e].from;
    }
    edges.reverse();
    const startOffset = this.offsetOn(edges[0], from);
    const endOffset = this.offsetOn(lastEdge, to);
    let length = w.edges[edges[0]].length - startOffset + endOffset;
    for (let i = 1; i < edges.length - 1; i++) length += w.edges[edges[i]].length;
    return { edges, startOffset, endOffset, length, cost: total };
  }
}

function interp(pts: Float64Array, cum: Float64Array, d: number): [number, number] {
  const n = cum.length;
  if (d <= 0) return [pts[0], pts[1]];
  if (d >= cum[n - 1]) return [pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]];
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return [pts[(i - 1) * 2] + (pts[i * 2] - pts[(i - 1) * 2]) * t, pts[(i - 1) * 2 + 1] + (pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]) * t];
}
