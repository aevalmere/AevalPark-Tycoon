// Low-poly models assembled from boxes. Everything is in metres in the model's
// own frame (x forward, y left, z up); cars are scaled by `s` so they stay
// legible when zoomed out.

import { INSTANCE_FLOATS } from './ModelLayer';

export class InstanceBuffer {
  data = new Float32Array(INSTANCE_FLOATS * 1024);
  n = 0;

  reset() { this.n = 0; }

  push(x: number, y: number, z: number, h: number, sx: number, sy: number, sz: number, rgb: number, a = 1, emit = 0) {
    if ((this.n + 1) * INSTANCE_FLOATS > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data, o = this.n * INSTANCE_FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = h;
    d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = sz;
    d[o + 7] = ((rgb >> 16) & 255) / 255; d[o + 8] = ((rgb >> 8) & 255) / 255; d[o + 9] = (rgb & 255) / 255;
    d[o + 10] = a; d[o + 11] = emit;
    this.n++;
  }
}

const GLASS = 0x26334a;
const TYRE = 0x1d2127;
const HEAD = 0xfff6d8;
const TAIL = 0xff3b3b;
const SIGN = 0xfff3c4;
const SKIN = 0xf0c7a0;

function darken(rgb: number, f: number) {
  const r = ((rgb >> 16) & 255) * f, g = ((rgb >> 8) & 255) * f, b = (rgb & 255) * f;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export interface CarOpts {
  taxi?: boolean;
  lights?: boolean;
  braking?: boolean;
}

/** A car centred at (x, y) on the ground, facing heading h, base at z. */
export function pushCar(out: InstanceBuffer, shadow: InstanceBuffer, x: number, y: number, z: number, h: number, s: number, color: number, opts: CarOpts = {}) {
  const c = Math.cos(h), sn = Math.sin(h);
  // offset along the car's own axes
  const at = (fx: number, fy: number): [number, number] => [x + (c * fx - sn * fy) * s, y + (sn * fx + c * fy) * s];
  shadow.push(x, y, z + 0.03, h, 4.9 * s, 2.3 * s, 0.02, 0x000000, 0.22);
  out.push(x, y, z, h, 4.1 * s, 1.92 * s, 0.42 * s, TYRE);
  out.push(x, y, z + 0.3 * s, h, 4.4 * s, 1.86 * s, 0.68 * s, color);
  const [cx, cy] = at(-0.3, 0);
  out.push(cx, cy, z + 0.98 * s, h, 2.3 * s, 1.62 * s, 0.56 * s, GLASS);
  out.push(cx, cy, z + 1.52 * s, h, 2.05 * s, 1.5 * s, 0.1 * s, color);
  if (opts.taxi) out.push(cx, cy, z + 1.62 * s, h, 0.55 * s, 0.95 * s, 0.24 * s, SIGN, 1, opts.lights ? 1 : 0.4);
  const lit = opts.lights ? 1 : 0.35;
  for (const side of [-0.62, 0.62]) {
    const [hx, hy] = at(2.18, side);
    out.push(hx, hy, z + 0.55 * s, h, 0.12 * s, 0.38 * s, 0.2 * s, HEAD, 1, lit);
    const [tx, ty] = at(-2.18, side);
    out.push(tx, ty, z + 0.6 * s, h, 0.12 * s, 0.38 * s, 0.18 * s, opts.braking ? TAIL : darken(TAIL, 0.75), 1, opts.lights || opts.braking ? 1 : 0.3);
  }
}

export function pushPerson(out: InstanceBuffer, shadow: InstanceBuffer, x: number, y: number, z: number, h: number, s: number, color: number) {
  shadow.push(x, y, z + 0.03, h, 0.9 * s, 0.9 * s, 0.02, 0x000000, 0.2);
  out.push(x, y, z, h, 0.42 * s, 0.55 * s, 1.15 * s, color);
  out.push(x, y, z + 1.18 * s, h, 0.36 * s, 0.36 * s, 0.36 * s, SKIN);
}

/** A flat glowing plate under a vehicle, so the ones tied to a selection stand out. */
export function pushHalo(decals: InstanceBuffer, x: number, y: number, z: number, h: number, s: number, color: number, pulse: number) {
  decals.push(x, y, z + 0.05, h, (6.4 + pulse * 1.2) * s, (3.4 + pulse * 0.8) * s, 0.02, color, 0.32 + 0.25 * (1 - pulse), 1);
  decals.push(x, y, z + 0.06, h, 5.4 * s, 2.6 * s, 0.02, color, 0.55, 1);
}

/** A painted stall divider on a lot deck. */
export function pushStallLine(out: InstanceBuffer, x: number, y: number, z: number, h: number, color: number) {
  out.push(x, y, z + 0.01, h, 4.6, 0.12, 0.02, color);
}

/** Box placed by its own centre and heading, sitting on z. */
export interface Footprint { x: number; y: number; h: number; len: number; wid: number }

/** A two-storey dispatch office with a lit TAXI sign on the roof. */
export function pushDepotOffice(out: InstanceBuffer, shadow: InstanceBuffer, f: Footprint, z: number, lights: boolean) {
  shadow.push(f.x, f.y, z + 0.02, f.h, f.len + 1.2, f.wid + 1.2, 0.02, 0x000000, 0.18);
  out.push(f.x, f.y, z, f.h, f.len, f.wid, 5.6, 0xece3cf);
  out.push(f.x, f.y, z + 5.6, f.h, f.len + 0.3, f.wid + 0.3, 0.35, 0x4b5160);
  // a band of windows on each storey
  for (const fz of [1.4, 4.1]) out.push(f.x, f.y, z + fz, f.h, f.len + 0.06, f.wid + 0.06, 0.9, 0x31405a, 1, lights ? 0.8 : 0);
  out.push(f.x, f.y, z + 5.95, f.h, Math.min(f.len * 0.7, 6), 0.35, 1.2, 0xf5b82e, 1, lights ? 1 : 0.25);
}

/** A glass showroom: frame and roof are solid, walls go to the glass pass so the cars inside show. */
export function pushShowroom(out: InstanceBuffer, glass: InstanceBuffer, shadow: InstanceBuffer, f: Footprint, z: number, lights: boolean) {
  const c = Math.cos(f.h), sn = Math.sin(f.h);
  const at = (fx: number, fy: number): [number, number] => [f.x + c * fx - sn * fy, f.y + sn * fx + c * fy];
  shadow.push(f.x, f.y, z + 0.02, f.h, f.len + 1.4, f.wid + 1.4, 0.02, 0x000000, 0.16);
  out.push(f.x, f.y, z, f.h, f.len, f.wid, 0.15, 0xdfe5ea);
  out.push(f.x, f.y, z + 5.2, f.h, f.len + 0.6, f.wid + 0.6, 0.45, 0xf4f6f8);
  out.push(f.x, f.y, z + 5.65, f.h, f.len * 0.9, 0.3, 0.7, 0x22c7a9, 1, lights ? 1 : 0.3);
  for (const [fx, fy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const [px, py] = at(fx * (f.len / 2 - 0.15), fy * (f.wid / 2 - 0.15));
    out.push(px, py, z, f.h, 0.3, 0.3, 5.2, 0x9aa5b1);
  }
  glass.push(f.x, f.y, z + 0.15, f.h, f.len - 0.1, f.wid - 0.1, 5.05, lights ? 0xffe6b0 : 0xbfe3f0, lights ? 0.42 : 0.3, lights ? 0.6 : 0);
}

/** A pay booth facing the street (heading h) with a barrier arm beside it, and a P sign on a pole. */
export function pushLotEntrance(out: InstanceBuffer, x: number, y: number, z: number, h: number, lights: boolean) {
  const c = Math.cos(h), sn = Math.sin(h);
  out.push(x, y, z, h, 1.8, 1.6, 2.5, 0xe5e7eb);
  out.push(x, y, z + 2.5, h, 2.1, 1.9, 0.18, 0x4f8cff);
  // the arm reaches across the entry lane on the booth's left
  out.push(x - sn * 2.6, y + c * 2.6, z + 1.0, h + Math.PI / 2, 3.4, 0.12, 0.12, 0xf8fafc);
  // the sign stands on its right
  const px = x + sn * 1.6, py = y - c * 1.6;
  out.push(px, py, z, h, 0.16, 0.16, 4.6, 0x6b7280);
  out.push(px, py, z + 4.2, h, 0.2, 1.4, 1.4, 0x4f8cff, 1, lights ? 1 : 0.15);
}
