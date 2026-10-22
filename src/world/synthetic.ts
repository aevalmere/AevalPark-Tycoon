// Offline fallback: a believable street grid with blocks of buildings, used
// when map tiles can't be downloaded. Deterministic for a given origin.
// (Grid idea adapted from ParkKing's synthetic router graph.)

import type { LatLng } from '../core/geo';
import { createRng, hashString, rand, randInt, randRange } from '../core/rng';
import type { RawBuilding, RawLabel, RawLine, RawNamedLine, RawPoi, RawWorld } from './types';

const STREETS = ['Main St', 'Oak Ave', 'Market St', 'King St', 'Elm St', 'Park Ave', 'Church St', 'Bridge St', 'Maple Ave', 'Court St', 'Union St', 'Pine St', 'Cedar Ave', 'Harbor Rd', 'Mill St', 'Grove St'];
const AVENUES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave', '7th Ave', '8th Ave', '9th Ave', '10th Ave', '11th Ave', '12th Ave', '13th Ave', '14th Ave', '15th Ave', '16th Ave', '17th Ave', '18th Ave'];
const SHOPS = ['Corner Market', 'Blue Door Cafe', 'Hardware Co.', 'City Pharmacy', 'Noodle Bar', 'Book Nook', 'Bakery', 'Fresh Grocer'];

export function syntheticWorld(origin: LatLng, radius: number): RawWorld {
  const rng = createRng(hashString(`${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}`));
  const block = 120;
  const rot = randRange(rng, -0.35, 0.35);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const rp = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
  const half = Math.ceil((radius + 250) / block);

  const lines: RawLine[] = [];
  const names: RawNamedLine[] = [];
  for (let i = -half; i <= half; i++) {
    const major = i % 4 === 0;
    const oneway = !major && i % 2 !== 0 ? (i % 4 === 1 ? 1 : -1) : 0;
    const c = i * block;
    // east-west street
    const ew: number[] = [];
    const ns: number[] = [];
    for (let j = -half; j <= half; j++) {
      ew.push(...rp(j * block, c));
      ns.push(...rp(c, j * block));
    }
    lines.push({ pts: ew, cls: major ? 'secondary' : 'minor', oneway: oneway as -1 | 0 | 1, brunnel: false, layer: 0 });
    lines.push({ pts: ns, cls: major ? 'primary' : 'minor', oneway: 0, brunnel: false, layer: 0 });
    names.push({ pts: ew, name: STREETS[(i + half) % STREETS.length] });
    names.push({ pts: ns, name: AVENUES[(i + half) % AVENUES.length] });
  }

  const buildings: RawBuilding[] = [];
  const housenumbers: RawLabel[] = [];
  const pois: RawPoi[] = [];
  const setback = 9;
  for (let bx = -half; bx < half; bx++) {
    for (let by = -half; by < half; by++) {
      const x0 = bx * block + setback, y0 = by * block + setback;
      const span = block - setback * 2;
      const cols = randInt(rng, 2, 4), rows = randInt(rng, 2, 3);
      const w = span / cols, h = span / rows;
      const centerDist = Math.hypot(x0 + span / 2, y0 + span / 2);
      if (centerDist > radius + 80) continue;
      const downtown = Math.max(0, 1 - centerDist / (radius * 0.8));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          // only lots that touch the block edge (a street) get a building
          if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1) continue;
          if (rand(rng) < 0.12) continue;
          const gap = 2.5;
          const ax = x0 + c * w + gap, ay = y0 + r * h + gap;
          const bw = w - gap * 2, bh = h - gap * 2;
          const ring = [...rp(ax, ay), ...rp(ax + bw, ay), ...rp(ax + bw, ay + bh), ...rp(ax, ay + bh)];
          const tall = rand(rng) < downtown * 0.7;
          const height = tall ? randRange(rng, 18, 18 + 90 * downtown) : randRange(rng, 4, 12);
          buildings.push({ ring, holes: [], height, minHeight: 0 });
          const [cx, cy] = rp(ax + bw / 2, ay + bh / 2);
          housenumbers.push({ x: cx, y: cy, text: String(10 + ((bx + half) * 37 + (by + half) * 11 + c * 2 + r) % 980) });
          if (rand(rng) < 0.12) pois.push({ x: cx, y: cy, cls: rand(rng) < 0.5 ? 'shop' : 'cafe', name: SHOPS[randInt(rng, 0, SHOPS.length - 1)] });
        }
      }
    }
  }
  return { origin, radius, source: 'synthetic', lines, buildings, pois, housenumbers, names, landuse: [] };
}
