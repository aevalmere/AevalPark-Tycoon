// Turns loose road polylines into a routable directed graph.
//
// Vector tiles simplify geometry, which drops the shared vertex at many real
// intersections: a T-junction's side street ends a fraction of a metre short
// of the main road, and a four-way crossing has no common point at all. So the
// builder (1) merges near-identical vertices, (2) snaps dangling ends onto the
// nearest road, and (3) splits roads where they cross on the same level.
// Bridges and tunnels only join roads at their own level. Finally the largest
// strongly connected component is kept so every route has an answer.

import { closestOnSegment, polylineLengths, segmentIntersection } from '../core/geo';
import { hashString } from '../core/rng';
import { GridIndex } from '../core/spatial';
import type { RawLine, RoadClass, RoadEdge, RoadLink } from './types';

const MERGE_TOL = 0.9;
const SNAP_TOL = 2.5;
const SEG_CELL = 32;

const KMH: Record<RoadClass, number> = {
  motorway: 90, trunk: 70, primary: 50, secondary: 45, tertiary: 40, minor: 30, service: 20,
};
const LANES: Record<RoadClass, number> = {
  motorway: 3, trunk: 2, primary: 2, secondary: 1, tertiary: 1, minor: 1, service: 1,
};

class VertexPool {
  xs: number[] = [];
  ys: number[] = [];
  private grid = new Map<number, number[]>();

  constructor(private tol: number) {}

  private static key(cx: number, cy: number) {
    return (cx + 1_000_000) * 2_000_003 + (cy + 1_000_000);
  }

  get(x: number, y: number): number {
    const cx = Math.floor(x / this.tol), cy = Math.floor(y / this.tol);
    const t2 = this.tol * this.tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.grid.get(VertexPool.key(cx + dx, cy + dy));
        if (!list) continue;
        for (const v of list) if ((this.xs[v] - x) ** 2 + (this.ys[v] - y) ** 2 <= t2) return v;
      }
    }
    const v = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    const k = VertexPool.key(cx, cy);
    const list = this.grid.get(k);
    if (list) list.push(v); else this.grid.set(k, [v]);
    return v;
  }
}

interface WorkLine {
  v: number[];
  src: RawLine;
}

export interface RoadGraph {
  nodeX: Float64Array;
  nodeY: Float64Array;
  nodeOut: number[][];
  links: RoadLink[];
  edges: RoadEdge[];
  linkEdges: number[][];
}

function compatible(a: RawLine, b: RawLine) {
  if (a.layer !== b.layer) return false;
  return a.brunnel === b.brunnel || (!a.brunnel && !b.brunnel);
}

export function buildRoadGraph(raw: RawLine[]): RoadGraph {
  const pool = new VertexPool(MERGE_TOL);

  // 1. polylines → vertex ids (merging coincident points)
  const lines: WorkLine[] = [];
  for (const src of raw) {
    const v: number[] = [];
    for (let i = 0; i < src.pts.length; i += 2) {
      const id = pool.get(src.pts[i], src.pts[i + 1]);
      if (v[v.length - 1] !== id) v.push(id);
    }
    if (v.length >= 2) lines.push({ v, src });
  }

  // 2. segment index
  const segLine: number[] = [], segI: number[] = [];
  const segStart: number[] = []; // first segment id of each line
  const grid = new GridIndex(SEG_CELL);
  lines.forEach((l, li) => {
    segStart.push(segLine.length);
    for (let i = 0; i < l.v.length - 1; i++) {
      const s = segLine.length;
      segLine.push(li);
      segI.push(i);
      const a = l.v[i], b = l.v[i + 1];
      grid.insertBox(
        s,
        Math.min(pool.xs[a], pool.xs[b]) - SNAP_TOL, Math.min(pool.ys[a], pool.ys[b]) - SNAP_TOL,
        Math.max(pool.xs[a], pool.xs[b]) + SNAP_TOL, Math.max(pool.ys[a], pool.ys[b]) + SNAP_TOL,
      );
    }
  });
  const segA = (s: number) => lines[segLine[s]].v[segI[s]];
  const segB = (s: number) => lines[segLine[s]].v[segI[s] + 1];

  const inserts = new Map<number, { t: number; v: number }[]>();
  const addInsert = (s: number, t: number, v: number) => {
    if (v === segA(s) || v === segB(s)) return;
    const list = inserts.get(s);
    if (list) list.push({ t, v }); else inserts.set(s, [{ t, v }]);
  };

  // alias table for vertices merged during snapping (union-find style)
  const alias = new Map<number, number>();
  const find = (v: number) => {
    let r = v;
    while (alias.has(r)) r = alias.get(r)!;
    return r;
  };

  // 3. snap dangling ends onto nearby roads (T-junctions with a dropped vertex)
  const use = new Map<number, number>();
  for (const l of lines) for (const v of l.v) use.set(v, (use.get(v) ?? 0) + 1);
  lines.forEach((l, li) => {
    for (const v of [l.v[0], l.v[l.v.length - 1]]) {
      if (use.get(v) !== 1) continue;
      const x = pool.xs[v], y = pool.ys[v];
      let best = -1, bestD2 = SNAP_TOL * SNAP_TOL, bestT = 0;
      for (const s of grid.queryRadius(x, y, SNAP_TOL)) {
        if (segLine[s] === li || !compatible(l.src, lines[segLine[s]].src)) continue;
        const a = segA(s), b = segB(s);
        const h = closestOnSegment(x, y, pool.xs[a], pool.ys[a], pool.xs[b], pool.ys[b]);
        if (h.d2 < bestD2) { bestD2 = h.d2; best = s; bestT = h.t; }
      }
      if (best < 0) continue;
      const a = segA(best), b = segB(best);
      const len = Math.hypot(pool.xs[b] - pool.xs[a], pool.ys[b] - pool.ys[a]);
      const near = bestT * len <= SNAP_TOL ? a : (1 - bestT) * len <= SNAP_TOL ? b : -1;
      if (near < 0) { addInsert(best, bestT, v); continue; }
      // two dangling ends can snap onto each other; resolve first so aliases never form a cycle
      const target = find(near);
      if (target !== find(v)) alias.set(find(v), target);
    }
  });

  // 4. split at same-level crossings that have no shared vertex
  const seen = new Set<number>();
  const nSeg = segLine.length;
  grid.forEachCell((ids) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        let s1 = ids[i], s2 = ids[j];
        if (segLine[s1] === segLine[s2]) continue;
        if (s1 > s2) [s1, s2] = [s2, s1];
        const key = s1 * nSeg + s2;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!compatible(lines[segLine[s1]].src, lines[segLine[s2]].src)) continue;
        const a1 = segA(s1), b1 = segB(s1), a2 = segA(s2), b2 = segB(s2);
        if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
        const hit = segmentIntersection(
          pool.xs[a1], pool.ys[a1], pool.xs[b1], pool.ys[b1],
          pool.xs[a2], pool.ys[a2], pool.xs[b2], pool.ys[b2],
        );
        if (!hit) continue;
        const px = pool.xs[a1] + (pool.xs[b1] - pool.xs[a1]) * hit.t;
        const py = pool.ys[a1] + (pool.ys[b1] - pool.ys[a1]) * hit.t;
        const v = pool.get(px, py);
        addInsert(s1, hit.t, v);
        addInsert(s2, hit.u, v);
      }
    }
  });

  // 5. rebuild each line with its insertions, resolving aliases
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    const out: number[] = [];
    const push = (v: number) => {
      const r = find(v);
      if (out[out.length - 1] !== r) out.push(r);
    };
    for (let i = 0; i < l.v.length - 1; i++) {
      push(l.v[i]);
      const ins = inserts.get(segStart[li] + i);
      if (ins) {
        ins.sort((p, q) => p.t - q.t);
        for (const p of ins) push(p.v);
      }
    }
    push(l.v[l.v.length - 1]);
    l.v = out;
  }

  // 6. junctions: vertices used more than once, plus every line end
  const use2 = new Map<number, number>();
  for (const l of lines) {
    if (l.v.length < 2) continue;
    for (const v of l.v) use2.set(v, (use2.get(v) ?? 0) + 1);
    use2.set(l.v[0], (use2.get(l.v[0]) ?? 0) + 1);
    use2.set(l.v[l.v.length - 1], (use2.get(l.v[l.v.length - 1]) ?? 0) + 1);
  }
  const isJunction = (v: number) => (use2.get(v) ?? 0) >= 2;

  // 7. split lines into links between junctions
  interface ProtoLink { verts: number[]; src: RawLine }
  const proto: ProtoLink[] = [];
  const dedupe = new Set<string>();
  for (const l of lines) {
    if (l.v.length < 2) continue;
    let start = 0;
    for (let i = 1; i < l.v.length; i++) {
      if (!isJunction(l.v[i]) && i !== l.v.length - 1) continue;
      const verts = l.v.slice(start, i + 1);
      start = i;
      let len = 0;
      for (let k = 1; k < verts.length; k++) len += Math.hypot(pool.xs[verts[k]] - pool.xs[verts[k - 1]], pool.ys[verts[k]] - pool.ys[verts[k - 1]]);
      if (len < 0.3) continue;
      const a = verts[0], b = verts[verts.length - 1];
      const key = `${Math.min(a, b)}-${Math.max(a, b)}-${Math.round(len)}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      proto.push({ verts, src: l.src });
    }
  }

  // 8. directed adjacency over junction vertices, then keep the largest SCC
  const nodeOf = new Map<number, number>();
  const nodeVert: number[] = [];
  const nodeFor = (v: number) => {
    let n = nodeOf.get(v);
    if (n === undefined) { n = nodeVert.length; nodeOf.set(v, n); nodeVert.push(v); }
    return n;
  };
  const pa: number[] = [], pb: number[] = [];
  for (const p of proto) { pa.push(nodeFor(p.verts[0])); pb.push(nodeFor(p.verts[p.verts.length - 1])); }
  const N = nodeVert.length;
  const out: number[][] = Array.from({ length: N }, () => []);
  proto.forEach((p, i) => {
    if (p.src.oneway !== -1) out[pa[i]].push(pb[i]);
    if (p.src.oneway !== 1) out[pb[i]].push(pa[i]);
  });
  const keep = largestScc(N, out);

  // 9. emit links, nodes and edges with compact indices
  const remap = new Int32Array(N).fill(-1);
  const nodeX: number[] = [], nodeY: number[] = [];
  for (let n = 0; n < N; n++) {
    if (!keep[n]) continue;
    remap[n] = nodeX.length;
    nodeX.push(pool.xs[nodeVert[n]]);
    nodeY.push(pool.ys[nodeVert[n]]);
  }
  const links: RoadLink[] = [];
  const edges: RoadEdge[] = [];
  const linkEdges: number[][] = [];
  const nodeOut: number[][] = nodeX.map(() => []);
  const usedIds = new Set<string>();
  proto.forEach((p, i) => {
    const a = remap[pa[i]], b = remap[pb[i]];
    if (a < 0 || b < 0) return;
    const pts = new Float64Array(p.verts.length * 2);
    p.verts.forEach((v, k) => { pts[k * 2] = pool.xs[v]; pts[k * 2 + 1] = pool.ys[v]; });
    const cum = polylineLengths(pts);
    const length = cum[cum.length - 1];
    const { cls, oneway } = p.src;
    let lanes = LANES[cls];
    if (oneway !== 0 && (cls === 'primary' || cls === 'secondary' || cls === 'tertiary')) lanes += 1;
    let id = hashString(`${Math.round(pts[0])},${Math.round(pts[1])},${Math.round(pts[pts.length - 2])},${Math.round(pts[pts.length - 1])},${Math.round(length)}`).toString(36);
    while (usedIds.has(id)) id += 'x';
    usedIds.add(id);
    const idx = links.length;
    links.push({ idx, id, a, b, pts, cum, length, cls, oneway, lanes, kmh: KMH[cls], name: '', bridge: p.src.brunnel });
    const le: number[] = [];
    if (oneway !== -1) {
      const e = edges.length;
      edges.push({ idx: e, link: idx, dir: 1, from: a, to: b, length });
      nodeOut[a].push(e);
      le.push(e);
    }
    if (oneway !== 1) {
      const e = edges.length;
      edges.push({ idx: e, link: idx, dir: -1, from: b, to: a, length });
      nodeOut[b].push(e);
      le.push(e);
    }
    linkEdges.push(le);
  });

  return { nodeX: Float64Array.from(nodeX), nodeY: Float64Array.from(nodeY), nodeOut, links, edges, linkEdges };
}

/** Iterative Tarjan; returns a membership mask for the largest component. */
function largestScc(n: number, out: number[][]): Uint8Array {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const sizes: number[] = [];
  let counter = 0;

  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const call: [number, number][] = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = 1;
    while (call.length) {
      const frame = call[call.length - 1];
      const v = frame[0];
      if (frame[1] < out[v].length) {
        const w = out[v][frame[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          call.push([w, 0]);
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], index[w]);
        }
      } else {
        call.pop();
        if (call.length) {
          const u = call[call.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === index[v]) {
          const c = sizes.length;
          let size = 0, w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp[w] = c;
            size++;
          } while (w !== v);
          sizes.push(size);
        }
      }
    }
  }

  let best = 0;
  for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[best]) best = c;
  const keep = new Uint8Array(n);
  for (let v = 0; v < n; v++) if (comp[v] === best) keep[v] = 1;
  return keep;
}
