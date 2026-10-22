// Decodes OpenMapTiles-schema vector tiles (OpenFreeMap) into a RawWorld.
// Pure: no fetching here, so it runs the same in the browser and in tests.

import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { LocalProjection, type LatLng } from '../core/geo';
import type { RawBuilding, RawLanduse, RawLine, RawNamedLine, RawPoi, RawLabel, RawWorld, RoadClass } from './types';

const TILE_ZOOM = 14;
/** extra road beyond the playable radius so edge-of-map routes still look right */
const ROAD_MARGIN = 250;

const DRIVABLE = new Set<RoadClass>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']);
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through', 'emergency_access']);

export interface TileRef {
  z: number;
  x: number;
  y: number;
}

export interface TileBuffer extends TileRef {
  data: ArrayBuffer | Uint8Array;
}

function lngLatToTile(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

function tileToLngLat(tx: number, ty: number, z: number): [number, number] {
  const n = 2 ** z;
  const lng = (tx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/** Tiles covering a circle of `radius` metres (plus road margin) around the origin. */
export function tilesFor(origin: LatLng, radius: number): TileRef[] {
  const proj = new LocalProjection(origin);
  const r = radius + ROAD_MARGIN;
  const sw = proj.toLatLng(-r, -r), ne = proj.toLatLng(r, r);
  const [x0, y1] = lngLatToTile(sw.lng, sw.lat, TILE_ZOOM);
  const [x1, y0] = lngLatToTile(ne.lng, ne.lat, TILE_ZOOM);
  const out: TileRef[] = [];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) out.push({ z: TILE_ZOOM, x, y });
  }
  return out;
}

/** Liang–Barsky clip of one segment to the tile square. */
function clipSeg(ax: number, ay: number, bx: number, by: number, max: number): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy], q = [ax, max - ax, ay, max - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}

/** Split a tile-space polyline into runs clipped to the tile's own square. */
function clipLine(pts: { x: number; y: number }[], extent: number): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const c = clipSeg(a.x, a.y, b.x, b.y, extent);
    if (!c) { if (cur.length >= 4) runs.push(cur); cur = []; continue; }
    const sx = a.x + (b.x - a.x) * c[0], sy = a.y + (b.y - a.y) * c[0];
    const ex = a.x + (b.x - a.x) * c[1], ey = a.y + (b.y - a.y) * c[1];
    if (cur.length === 0 || cur[cur.length - 2] !== sx || cur[cur.length - 1] !== sy) {
      if (cur.length >= 4) runs.push(cur);
      cur = [sx, sy];
    }
    cur.push(ex, ey);
    if (c[1] < 1) { runs.push(cur); cur = []; }
  }
  if (cur.length >= 4) runs.push(cur);
  return runs;
}

/** Keep only the stretches of a local-metre polyline inside a radius. */
function withinRuns(pts: number[], r: number): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  const r2 = r * r;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] * pts[i] + pts[i + 1] * pts[i + 1] <= r2) cur.push(pts[i], pts[i + 1]);
    else { if (cur.length >= 4) runs.push(cur); cur = []; }
  }
  if (cur.length >= 4) runs.push(cur);
  return runs;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const latinName = (p: Record<string, unknown>) => str(p['name:latin']) || str(p.name_en) || str(p.name);

export function decodeTiles(tiles: TileBuffer[], origin: LatLng, radius: number, tileset?: string): RawWorld {
  const proj = new LocalProjection(origin);
  const lines: RawLine[] = [];
  const buildings: RawBuilding[] = [];
  const pois: RawPoi[] = [];
  const housenumbers: RawLabel[] = [];
  const names: RawNamedLine[] = [];
  const landuse: RawLanduse[] = [];
  const roadR = radius + ROAD_MARGIN;
  const keepR = radius + 60;

  for (const t of tiles) {
    const vt = new VectorTile(new PbfReader(t.data instanceof Uint8Array ? t.data : new Uint8Array(t.data)));
    const toLocal = (px: number, py: number, extent: number): [number, number] => {
      const [lng, lat] = tileToLngLat(t.x + px / extent, t.y + py / extent, t.z);
      return proj.toLocal(lat, lng);
    };
    const flat = (ring: { x: number; y: number }[], extent: number, close = false) => {
      const out: number[] = [];
      const n = close && ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.length - 1 : ring.length;
      for (let i = 0; i < n; i++) { const [x, y] = toLocal(ring[i].x, ring[i].y, extent); out.push(x, y); }
      return out;
    };

    const tr = vt.layers.transportation;
    if (tr) {
      for (let i = 0; i < tr.length; i++) {
        const f = tr.feature(i);
        if (f.type !== 2) continue;
        const p = f.properties;
        const cls = str(p.class) as RoadClass;
        if (!DRIVABLE.has(cls)) continue;
        if (cls === 'service' && SKIP_SERVICE.has(str(p.service))) continue;
        if (p.access === 'no' || p.access === 'private') continue;
        const oneway = p.oneway === 1 || p.oneway === '1' ? 1 : p.oneway === -1 || p.oneway === '-1' ? -1 : 0;
        const brunnel = p.brunnel === 'bridge' || p.brunnel === 'tunnel';
        const layer = typeof p.layer === 'number' ? p.layer : 0;
        for (const g of f.loadGeometry()) {
          for (const run of clipLine(g, tr.extent)) {
            const local: number[] = [];
            for (let k = 0; k < run.length; k += 2) local.push(...toLocal(run[k], run[k + 1], tr.extent));
            for (const pts of withinRuns(local, roadR)) lines.push({ pts, cls, oneway, brunnel, layer });
          }
        }
      }
    }

    const bl = vt.layers.building;
    if (bl) {
      for (let i = 0; i < bl.length; i++) {
        const f = bl.feature(i);
        if (f.type !== 3) continue;
        const height = Number(f.properties.render_height) || 0;
        const minHeight = Number(f.properties.render_min_height) || 0;
        for (const poly of classifyRings(f.loadGeometry())) {
          const outer = poly[0];
          if (!outer || outer.length < 4) continue;
          // de-duplicate across tiles: a footprint belongs to the tile holding its first vertex
          let sx = 0, sy = 0;
          for (const pt of outer) { sx += pt.x; sy += pt.y; }
          sx /= outer.length; sy /= outer.length;
          if (sx < 0 || sy < 0 || sx >= bl.extent || sy >= bl.extent) continue;
          const ring = flat(outer, bl.extent, true);
          const [cx, cy] = [ring[0], ring[1]];
          if (Math.hypot(cx, cy) > keepR + 200) continue;
          buildings.push({ ring, holes: poly.slice(1).map((h) => flat(h, bl.extent, true)), height, minHeight });
        }
      }
    }

    const poi = vt.layers.poi;
    if (poi) {
      for (let i = 0; i < poi.length; i++) {
        const f = poi.feature(i);
        if (f.type !== 1) continue;
        const pt = f.loadGeometry()[0]?.[0];
        if (!pt || pt.x < 0 || pt.y < 0 || pt.x >= poi.extent || pt.y >= poi.extent) continue;
        const [x, y] = toLocal(pt.x, pt.y, poi.extent);
        if (Math.hypot(x, y) > keepR) continue;
        pois.push({ x, y, cls: str(f.properties.class), name: latinName(f.properties) });
      }
    }

    const hn = vt.layers.housenumber;
    if (hn) {
      for (let i = 0; i < hn.length; i++) {
        const f = hn.feature(i);
        const pt = f.loadGeometry()[0]?.[0];
        if (!pt || pt.x < 0 || pt.y < 0 || pt.x >= hn.extent || pt.y >= hn.extent) continue;
        const [x, y] = toLocal(pt.x, pt.y, hn.extent);
        if (Math.hypot(x, y) > keepR) continue;
        housenumbers.push({ x, y, text: str(f.properties.housenumber) });
      }
    }

    const tn = vt.layers.transportation_name;
    if (tn) {
      for (let i = 0; i < tn.length; i++) {
        const f = tn.feature(i);
        if (f.type !== 2) continue;
        const name = latinName(f.properties);
        if (!name) continue;
        for (const g of f.loadGeometry()) {
          const pts = flat(g, tn.extent);
          let near = false;
          for (let k = 0; k < pts.length; k += 2) if (Math.hypot(pts[k], pts[k + 1]) < roadR) { near = true; break; }
          if (near && pts.length >= 4) names.push({ pts, name });
        }
      }
    }

    const lu = vt.layers.landuse;
    if (lu) {
      for (let i = 0; i < lu.length; i++) {
        const f = lu.feature(i);
        if (f.type !== 3) continue;
        const cls = str(f.properties.class);
        for (const poly of classifyRings(f.loadGeometry())) {
          if (!poly[0] || poly[0].length < 4) continue;
          landuse.push({ ring: flat(poly[0], lu.extent, true), holes: [], cls });
        }
      }
    }
  }

  return { origin, radius, source: 'tiles', tileset, lines, buildings, pois, housenumbers, names, landuse };
}
