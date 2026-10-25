// Where things go inside a converted footprint: parking stalls and their paint,
// a depot's dispatch office and taxi bays, a dealership's showroom and display
// cars, a lot's entrance booth. Laid out once per structure and cached.

import { closestOnSegment, pointInRing } from '../core/geo';
import type { StructureKind } from '../sim/state';
import type { WorldBuilding } from '../world/types';
import type { Footprint } from './models';

export interface Slot { x: number; y: number; h: number }

export interface Layout {
  /** parking stalls, taxi bays or display spots, nearest the street first */
  slots: Slot[];
  /** painted stall dividers (lots only) */
  lines: Slot[];
  /** depot office or dealership showroom */
  building: Footprint | null;
  /** cars on the showroom floor */
  inside: Slot[];
  /** lot pay booth, facing the street */
  entrance: Slot | null;
}

/** The footprint's frame along its longest edge: u runs along it, v across. */
function frameOf(ring: ArrayLike<number>) {
  let best = 0, ang = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const dx = ring[j] - ring[i], dy = ring[j + 1] - ring[i + 1];
    const l = dx * dx + dy * dy;
    if (l > best) { best = l; ang = Math.atan2(dy, dx); }
  }
  const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const u = ring[i] * ux + ring[i + 1] * uy, v = ring[i] * vx + ring[i + 1] * vy;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const toXY = (u: number, v: number): [number, number] => [u * ux + v * vx, u * uy + v * vy];
  const toU = (x: number, y: number) => x * ux + y * uy;
  return { ang, u0, u1, v0, v1, toXY, toU };
}

type Site = Pick<WorldBuilding, 'ring' | 'holes' | 'cx' | 'cy' | 'access'>;
type Frame = ReturnType<typeof frameOf>;

/** on the footprint and not in one of its courtyards */
const solid = (b: Site, x: number, y: number) => pointInRing(x, y, b.ring) && !b.holes.some((h) => pointInRing(x, y, h));

/** Stall grid aligned to the frame, on solid ground and within a band of u. */
function stalls(b: Site, f: Frame, max: number, uMin: number, uMax: number): Slot[] {
  const out: Slot[] = [];
  const inside = (u: number, v: number) => { const [x, y] = f.toXY(u, v); return solid(b, x, y); };
  let v = f.v0 + 3.1, row = 0;
  while (v < f.v1 - 2.6 && out.length < max) {
    for (let u = uMin + 1.7; u < uMax - 1.2 && out.length < max; u += 2.75) {
      if (inside(u, v) && inside(u - 1.1, v - 2.2) && inside(u + 1.1, v + 2.2) && inside(u - 1.1, v + 2.2) && inside(u + 1.1, v - 2.2)) {
        const [x, y] = f.toXY(u, v);
        out.push({ x, y, h: f.ang + Math.PI / 2 + (row % 2 ? Math.PI : 0) });
      }
    }
    v += row % 2 ? 6.4 : 5.2;
    row++;
  }
  return out;
}

/**
 * The biggest box of up to len × wid that fits on the footprint, as close to
 * the street end as it can get: slides inward along the frame and across it
 * before shrinking.
 */
function endBox(b: Site, f: Frame, atStart: boolean, len: number, wid: number): Footprint | null {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]];
  const span = f.u1 - f.u0, mid = (f.v0 + f.v1) / 2, across = f.v1 - f.v0;
  for (let k = 1; k >= 0.55; k -= 0.15) {
    const l = len * k, w = wid * k;
    for (let du = 1; du <= span / 2; du += 3) {
      const u = atStart ? f.u0 + l / 2 + du : f.u1 - l / 2 - du;
      for (const v of [mid, mid - across / 4, mid + across / 4]) {
        if (!corners.every(([a, c]) => { const [x, y] = f.toXY(u + (a * l) / 2, v + (c * w) / 2); return solid(b, x, y); })) continue;
        const [x, y] = f.toXY(u, v);
        return { x, y, h: f.ang, len: l, wid: w };
      }
    }
  }
  return null;
}

/** Closest point on the ring to the street access, nudged inside and turned to face the street. */
function gate(ring: ArrayLike<number>, access: { x: number; y: number }, cx: number, cy: number): Slot {
  let best = { x: cx, y: cy, d2: Infinity };
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    const h = closestOnSegment(access.x, access.y, ring[i], ring[i + 1], ring[j], ring[j + 1]);
    if (h.d2 < best.d2) best = { x: h.x, y: h.y, d2: h.d2 };
  }
  const dx = cx - best.x, dy = cy - best.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.min(2.2, d * 0.5);
  return { x: best.x + (dx / d) * k, y: best.y + (dy / d) * k, h: Math.atan2(access.y - best.y, access.x - best.x) };
}

export function layoutFor(kind: StructureKind, b: Site, maxSlots: number): Layout {
  const out = layoutIn(kind, b, maxSlots);
  const a = b.access;
  if (a) out.slots.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
  return out;
}

function layoutIn(kind: StructureKind, b: Site, maxSlots: number): Layout {
  const f = frameOf(b.ring);
  const len = f.u1 - f.u0, wid = f.v1 - f.v0;
  const access = b.access;
  // the office or showroom goes at the end nearest the street
  const streetAtStart = access ? Math.abs(f.toU(access.x, access.y) - f.u0) < Math.abs(f.toU(access.x, access.y) - f.u1) : true;
  const out: Layout = { slots: [], lines: [], building: null, inside: [], entrance: null };

  if (kind === 'parking') {
    out.slots = stalls(b, f, maxSlots, f.u0, f.u1);
    if (access) {
      out.entrance = gate(b.ring, access, b.cx, b.cy);
      const e = out.entrance;
      out.slots = out.slots.filter((s) => Math.hypot(s.x - e.x, s.y - e.y) > 5);
    }
    // dividers either side of each stall, de-duplicated where neighbours share one
    const seen = new Set<string>();
    const ux = Math.cos(f.ang), uy = Math.sin(f.ang);
    for (const s of out.slots) {
      for (const side of [-1.375, 1.375]) {
        const x = s.x + ux * side, y = s.y + uy * side;
        const key = `${Math.round(x * 2)},${Math.round(y * 2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.lines.push({ x, y, h: s.h });
      }
    }
    return out;
  }

  const big = kind === 'taxi' ? { len: Math.min(12, Math.max(5, len * 0.32)), wid: Math.min(14, wid * 0.8) }
    : { len: Math.min(16, Math.max(6, len * 0.45)), wid: Math.min(12, wid * 0.8) };
  const block = endBox(b, f, streetAtStart, big.len, big.wid);
  if (block) {
    out.building = block;
    // bays on the far side of the block from the street
    const bu = f.toU(block.x, block.y);
    const lo = streetAtStart ? bu + block.len / 2 + 1.5 : f.u0;
    const hi = streetAtStart ? f.u1 : bu - block.len / 2 - 1.5;
    out.slots = stalls(b, f, maxSlots, lo, hi);
    if (kind === 'dealership' && block.len > 7) {
      const ux = Math.cos(f.ang), uy = Math.sin(f.ang);
      for (const k of [-0.25, 0.25]) out.inside.push({ x: block.x + ux * block.len * k, y: block.y + uy * block.len * k, h: f.ang + Math.PI / 2 + k * 2 });
    }
    return out;
  }
  // too odd a shape for a proper block: a kiosk on the stall nearest the street, cars all around it
  const all = stalls(b, f, maxSlots + 6, f.u0, f.u1);
  if (access) all.sort((p, q) => Math.hypot(p.x - access.x, p.y - access.y) - Math.hypot(q.x - access.x, q.y - access.y));
  const spot = all[0] ?? (solid(b, b.cx, b.cy) ? { x: b.cx, y: b.cy } : null);
  if (!spot) return out;
  out.building = { x: spot.x, y: spot.y, h: f.ang, len: Math.min(5, len * 0.5), wid: Math.min(5, wid * 0.5) };
  out.slots = all.filter((s) => Math.hypot(s.x - spot.x, s.y - spot.y) > 4.6).slice(0, maxSlots);
  return out;
}
