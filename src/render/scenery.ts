// Set dressing that makes the district read as a place: street trees, street
// lamps with their pools of light, and lit windows after dark. All of it is
// derived from the world with a stable hash, so a street looks the same every
// time you come back to it, and none of it is saved or simulated.

import { pointInRing } from '../core/geo';
import type { World } from '../world/types';
import { InstanceBuffer } from './models';
import { visualHeight } from './style';

const TREE_GREENS = [0x5f9e4a, 0x6fae55, 0x4f8c44, 0x86b85a, 0x5a9a5c];
const TRUNK = 0x6b4a32;
const POLE = 0x596270;
const LAMP = 0xffe2a6;
const POOL = 0xffc070;
const WINDOW_COLORS = [0xffd98a, 0xffe7b0, 0xffc66e, 0xdce8ff, 0xffd98a, 0xfff0c8];

function hash(a: number, b: number, c = 0, d = 0): number {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(c + 13, 0xc2b2ae35) ^ Math.imul(d + 31, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

function insideBuilding(w: World, x: number, y: number): boolean {
  for (const i of w.buildingGrid.queryRadius(x, y, 1.5)) if (pointInRing(x, y, w.buildings[i].ring)) return true;
  return false;
}

export interface Props {
  solids: InstanceBuffer;
  lights: InstanceBuffer;
  pools: InstanceBuffer;
}

/** Trees and lamps along the kerbs of ordinary streets. Built once per world. */
export function buildProps(w: World): Props {
  const solids = new InstanceBuffer(), lights = new InstanceBuffer(), pools = new InstanceBuffer();
  let street = 0;
  const lined = w.links.filter((l) => !l.bridge && l.cls !== 'motorway' && l.cls !== 'trunk' && l.cls !== 'service' && l.length > 30);
  for (const l of lined) street += l.length;
  // keep the whole district to a few thousand instances however dense it is
  const gap = Math.max(24, street / 1500);

  for (const l of lined) {
    const half = (l.oneway ? l.lanes * 1.7 : l.lanes * 3.3) + 2.6;
    let side = hash(l.idx, 1) & 1 ? 1 : -1;
    let k = 0;
    for (let d = 14 + (hash(l.idx, 2) % 100) / 100 * gap; d < l.length - 14; d += gap / 2, k++) {
      // find the segment holding distance d
      let i = 1;
      while (i < l.cum.length - 1 && l.cum[i] < d) i++;
      const ax = l.pts[i * 2 - 2], ay = l.pts[i * 2 - 1], bx = l.pts[i * 2], by = l.pts[i * 2 + 1];
      const seg = l.cum[i] - l.cum[i - 1] || 1;
      const t = (d - l.cum[i - 1]) / seg;
      const dx = (bx - ax) / seg, dy = (by - ay) / seg;
      side = -side;
      const x = ax + (bx - ax) * t - dy * half * side, y = ay + (by - ay) * t + dx * half * side;
      if (insideBuilding(w, x, y)) continue;
      const h = hash(l.idx, k, 3);
      if (k % 4 === 1) {
        // lamp: pole, an arm over the road, the light and its pool
        const a = Math.atan2(dy, dx) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        pushLamp(solids, lights, pools, x, y, a);
      } else if ((h & 7) !== 0 && l.cls !== 'primary') {
        const s = 1.15 + ((h >>> 4) % 100) / 140;
        const rot = ((h >>> 12) % 628) / 100;
        const green = TREE_GREENS[(h >>> 20) % TREE_GREENS.length];
        solids.push(x, y, 0, rot, 0.38 * s, 0.38 * s, 2.4 * s, TRUNK);
        solids.push(x, y, 1.9 * s, rot, 3.4 * s, 3.4 * s, 2.5 * s, green);
        solids.push(x, y, 4.1 * s, rot + 0.7, 2.2 * s, 2.2 * s, 1.6 * s, green);
      }
    }
  }
  return { solids, lights, pools };
}

/**
 * Lit windows on one building's walls, between two heights. Which ones are lit
 * is fixed by `seed`; `p` (0..255) is the share that are. Returns false once
 * the buffer has reached `max`.
 */
export function pushWindows(r: ArrayLike<number>, base: number, top: number, seed: number, p: number, out: InstanceBuffer, max: number, perBuilding = 110, size = 1): boolean {
  if (top - base < 3.2) return true;
  // `size` > 1 draws fewer, larger windows: the same glow from further away for less work
  const cw = 4 * size, ch = 3.3 * size;
  const rows = Math.max(1, Math.floor((top - base - 1) / ch));
  const n = r.length / 2;
  // some buildings are asleep, a few are lit up floor to floor
  const mood = hash(seed, 99) % 10;
  // a tower has thousands of windows; cap each building's share so the whole view gets some
  let perim = 0;
  for (let e = 0; e < n; e++) perim += Math.hypot(r[((e + 1) % n) * 2] - r[e * 2], r[((e + 1) % n) * 2 + 1] - r[e * 2 + 1]);
  const cells = (perim / cw) * rows || 1;
  const want = (mood === 0 ? 0 : mood > 7 ? p * 2 : p) / 256 * cells;
  const lit = Math.round(Math.min(want, perBuilding) / cells * 256);
  for (let e = 0; e < n && lit; e++) {
    const ax = r[e * 2], ay = r[e * 2 + 1], bx = r[((e + 1) % n) * 2], by = r[((e + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < cw) continue;
    const cols = Math.floor(len / cw), head = Math.atan2(by - ay, bx - ax);
    for (let c = 0; c < cols; c++) {
      const t = (c + 0.5) / cols;
      for (let row = 0; row < rows; row++) {
        const h = hash(seed, e, c, row);
        if ((h & 255) >= lit) continue;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t, base + 1.4 + row * ch, head, Math.min(2.6 * size, len / cols - 1.1), 0.5, 1.5 * size,
          WINDOW_COLORS[(h >>> 8) % WINDOW_COLORS.length], 0.75 + ((h >>> 16) % 25) / 100, 1);
        if (out.n >= max) return false;
      }
    }
  }
  return true;
}

/** A street lamp at the kerb, its arm reaching along heading `a` over the road. */
export function pushLamp(solids: InstanceBuffer, lights: InstanceBuffer, pools: InstanceBuffer, x: number, y: number, a: number, glow = 0.3, spread = 21) {
  const ox = Math.cos(a), oy = Math.sin(a);
  solids.push(x, y, 0, a, 0.2, 0.2, 6.2, POLE);
  solids.push(x + ox * 0.9, y + oy * 0.9, 6.05, a, 2, 0.14, 0.14, POLE);
  lights.push(x + ox * 1.7, y + oy * 1.7, 5.88, a, 0.9, 0.42, 0.18, LAMP, 1, 1);
  pools.push(x + ox * 2.4, y + oy * 2.4, 0.12, 0, spread, spread, 0.02, POOL, glow, 1);
}

/**
 * Lit windows on the walls of buildings within `radius` of a point. The buffer
 * is rebuilt only when the camera has moved on.
 */
export function buildWindows(w: World, cx: number, cy: number, radius: number, out: InstanceBuffer, max: number, skip: (idx: number) => boolean) {
  out.reset();
  // fewer lit windows per wall as the view takes in more city
  const p = Math.round(Math.min(46, 46 * (380 / radius) ** 2));
  for (const idx of w.buildingGrid.queryRadius(cx, cy, radius)) {
    const b = w.buildings[idx];
    if (skip(idx) || Math.hypot(b.cx - cx, b.cy - cy) > radius) continue;
    if (!pushWindows(b.ring, visualHeight(b.minHeight), visualHeight(b.height), idx, p, out, max)) return;
  }
}
