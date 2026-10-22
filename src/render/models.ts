// Low-poly models assembled from boxes. Everything is in metres in the car's
// own frame (x forward, y left, z up) and scaled by `s` so cars stay legible
// when zoomed out.

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
