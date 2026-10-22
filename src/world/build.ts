// RawWorld → World: road graph, playable buildings, names, road access, HQ.

import {
  LocalProjection, closestOnPolyline, pointInRing, ringArea, ringBounds, ringCentroid, closestOnSegment,
} from '../core/geo';
import { hashString } from '../core/rng';
import { GridIndex } from '../core/spatial';
import { buildRoadGraph } from './graph';
import type { BuildingKind, RawWorld, World, WorldBuilding } from './types';

const LINK_CELL = 40;
const ACCESS_MAX = 220;

const POI_KIND: Record<string, BuildingKind> = {
  shop: 'shop', grocery: 'shop', clothing_store: 'shop', alcohol_shop: 'shop', bakery: 'shop', books: 'shop',
  hardware: 'shop', jewelry: 'shop', mobile_phone: 'shop', pharmacy: 'shop', convenience: 'shop', supermarket: 'shop',
  restaurant: 'food', fast_food: 'food', cafe: 'food', bar: 'food', beer: 'food', ice_cream: 'food', pub: 'food',
  hotel: 'hotel', lodging: 'hotel',
  hospital: 'civic', school: 'civic', college: 'civic', university: 'civic', town_hall: 'civic', library: 'civic',
  place_of_worship: 'civic', police: 'civic', fire_station: 'civic', post: 'civic', kindergarten: 'civic',
  cinema: 'leisure', theatre: 'leisure', museum: 'leisure', attraction: 'leisure', stadium: 'leisure',
  art_gallery: 'leisure', music: 'leisure', fitness: 'leisure', swimming: 'leisure',
  bank: 'office', office: 'office', embassy: 'office',
};

const LANDUSE_KIND: Record<string, BuildingKind> = {
  commercial: 'shop', retail: 'shop', industrial: 'industrial', school: 'civic', university: 'civic',
  college: 'civic', hospital: 'civic', kindergarten: 'civic', library: 'civic', stadium: 'leisure',
};

export const KIND_LABEL: Record<BuildingKind, string> = {
  house: 'House', apartment: 'Apartments', office: 'Offices', shop: 'Shops', food: 'Restaurant',
  civic: 'Civic building', leisure: 'Venue', hotel: 'Hotel', industrial: 'Warehouse',
};

// [trips generated per game hour, attraction]; scaled by building size below
const KIND_TRAFFIC: Record<BuildingKind, [number, number]> = {
  house: [0.35, 0.5], apartment: [0.55, 0.9], office: [0.45, 2.4], shop: [0.32, 2.6], food: [0.3, 2.4],
  civic: [0.3, 2.2], leisure: [0.25, 2.8], hotel: [0.4, 1.4], industrial: [0.2, 0.8],
};

export function worldKey(origin: { lat: number; lng: number }, radius: number) {
  return `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)},${radius}`;
}

export function buildWorld(raw: RawWorld): World {
  const proj = new LocalProjection(raw.origin);
  const g = buildRoadGraph(raw.lines);

  const linkGrid = new GridIndex(LINK_CELL);
  for (const l of g.links) {
    const [minX, minY, maxX, maxY] = ringBounds(l.pts);
    linkGrid.insertBox(l.idx, minX, minY, maxX, maxY);
  }

  // street names: nearest named line within a short distance
  const nameGrid = new GridIndex(50);
  raw.names.forEach((n, i) => {
    const [minX, minY, maxX, maxY] = ringBounds(n.pts);
    nameGrid.insertBox(i, minX, minY, maxX, maxY);
  });
  const nearestName = (x: number, y: number, maxD: number): string => {
    let best = '', bestD2 = maxD * maxD;
    for (const i of nameGrid.queryRadius(x, y, maxD)) {
      const p = raw.names[i].pts;
      for (let k = 0; k < p.length - 2; k += 2) {
        const h = closestOnSegment(x, y, p[k], p[k + 1], p[k + 2], p[k + 3]);
        if (h.d2 < bestD2) { bestD2 = h.d2; best = raw.names[i].name; }
      }
    }
    return best;
  };
  for (const l of g.links) {
    const mid = Math.floor(l.pts.length / 4) * 2;
    l.name = nearestName(l.pts[mid], l.pts[mid + 1], 30);
  }

  const poiGrid = new GridIndex(40);
  raw.pois.forEach((p, i) => poiGrid.insertPoint(i, p.x, p.y));
  const hnGrid = new GridIndex(40);
  raw.housenumbers.forEach((h, i) => hnGrid.insertPoint(i, h.x, h.y));
  const landuse = raw.landuse.map((l) => ({ ...l, bounds: ringBounds(l.ring) }));

  const nearestAccess = (x: number, y: number) => {
    for (const r of [40, 90, 160, ACCESS_MAX]) {
      let best: { link: number; offset: number; x: number; y: number; d2: number } | null = null;
      for (const li of linkGrid.queryRadius(x, y, r)) {
        const l = g.links[li];
        if (l.cls === 'motorway' || l.cls === 'trunk') continue; // nobody parks on a highway
        const h = closestOnPolyline(x, y, l.pts, l.cum);
        if (!best || h.d2 < best.d2) best = { link: li, offset: h.along, x: h.x, y: h.y, d2: h.d2 };
      }
      if (best && best.d2 <= r * r) return { link: best.link, offset: best.offset, x: best.x, y: best.y, d: Math.sqrt(best.d2) };
    }
    return null;
  };

  const buildings: WorldBuilding[] = [];
  const usedIds = new Set<string>();
  for (const rb of raw.buildings) {
    const area = Math.abs(ringArea(rb.ring));
    if (area < 18) continue;
    const [cx, cy] = ringCentroid(rb.ring);
    if (Math.hypot(cx, cy) > raw.radius) continue;
    const decor = rb.minHeight > 0.5;
    const h = hashString(`${Math.round(cx * 2)}:${Math.round(cy * 2)}`);
    let id = 'b' + h.toString(36);
    while (usedIds.has(id)) id += 'x';
    usedIds.add(id);
    const height = rb.height >= 3 ? rb.height : 3.2 + (h % 7) * 0.45;

    // classification: POI inside the footprint, then land use, then shape
    let kind: BuildingKind | null = null;
    let name = '';
    const [bx0, by0, bx1, by1] = ringBounds(rb.ring);
    for (const pi of poiGrid.query(bx0, by0, bx1, by1)) {
      const p = raw.pois[pi];
      if (!pointInRing(p.x, p.y, rb.ring)) continue;
      const k = POI_KIND[p.cls];
      if (k && !kind) kind = k;
      if (p.name && !name) name = p.name;
    }
    if (!kind) {
      for (const lu of landuse) {
        if (cx < lu.bounds[0] || cx > lu.bounds[2] || cy < lu.bounds[1] || cy > lu.bounds[3]) continue;
        if (!pointInRing(cx, cy, lu.ring)) continue;
        if (lu.cls === 'residential') kind = height > 14 ? 'apartment' : 'house';
        else if (LANDUSE_KIND[lu.cls]) kind = lu.cls === 'commercial' && height > 22 ? 'office' : LANDUSE_KIND[lu.cls];
        if (kind) break;
      }
    }
    if (!kind) kind = height > 28 ? 'office' : height > 11 ? 'apartment' : area > 2500 ? 'shop' : 'house';

    let houseNo = '';
    let bestHn = Infinity;
    for (const hi of hnGrid.query(bx0 - 8, by0 - 8, bx1 + 8, by1 + 8)) {
      const hn = raw.housenumbers[hi];
      const d = pointInRing(hn.x, hn.y, rb.ring) ? 0 : Math.hypot(hn.x - cx, hn.y - cy);
      if (d < bestHn && d < 25) { bestHn = d; houseNo = hn.text; }
    }
    const street = nearestName(cx, cy, 70);
    const address = houseNo && street ? `${houseNo} ${street}` : '';
    if (!name) name = address || (street ? `${KIND_LABEL[kind]} on ${street}` : KIND_LABEL[kind]);

    const access = decor ? null : nearestAccess(cx, cy);
    const floors = Math.max(1, Math.round(height / 3.2));
    const size = Math.log2(2 + (area * Math.min(floors, 30)) / 250);
    const [tr, at] = KIND_TRAFFIC[kind];
    buildings.push({
      idx: buildings.length,
      id,
      ring: Float64Array.from(rb.ring),
      holes: rb.holes.map((hh) => Float64Array.from(hh)),
      cx, cy, area, height, minHeight: rb.minHeight, kind, name, street,
      playable: !decor && !!access,
      access,
      trips: Math.min(1.6, tr * size),
      attract: at * Math.min(5, size),
    });
  }

  // HQ: the footprint under the chosen point, else the nearest one nearby, else a placeholder
  let hq = -1;
  for (const b of buildings) if (b.playable && pointInRing(0, 0, b.ring)) { hq = b.idx; break; }
  if (hq < 0) {
    let bestD = 150;
    for (const b of buildings) {
      const d = Math.hypot(b.cx, b.cy);
      if (b.playable && d < bestD) { bestD = d; hq = b.idx; }
    }
  }
  if (hq < 0) {
    const s = 9;
    const ring = [-s, -s, s, -s, s, s, -s, s];
    const access = nearestAccess(0, 0);
    hq = buildings.length;
    buildings.push({
      idx: hq, id: 'bhq', ring: Float64Array.from(ring), holes: [], cx: 0, cy: 0, area: 4 * s * s, height: 12, minHeight: 0,
      kind: 'office', name: 'Headquarters', street: nearestName(0, 0, 80), playable: !!access, access,
      trips: 0, attract: 1,
    });
  }
  buildings[hq].kind = 'office';

  const buildingGrid = new GridIndex(50);
  for (const b of buildings) buildingGrid.insertPoint(b.idx, b.cx, b.cy);

  // denser districts own fewer cars
  const playable = buildings.filter((b) => b.playable).length;
  const km2 = Math.PI * (raw.radius / 1000) ** 2;
  const density = playable / km2;
  const baseCarOwnership = Math.max(0.2, Math.min(0.62, 0.66 - density / 3800));

  return {
    key: worldKey(raw.origin, raw.radius),
    origin: raw.origin,
    radius: raw.radius,
    source: raw.source,
    tileset: raw.tileset,
    proj,
    nodeX: g.nodeX,
    nodeY: g.nodeY,
    nodeOut: g.nodeOut,
    links: g.links,
    edges: g.edges,
    linkEdges: g.linkEdges,
    linkById: new Map(g.links.map((l) => [l.id, l.idx])),
    buildings,
    buildingById: new Map(buildings.map((b) => [b.id, b.idx])),
    hq,
    linkGrid,
    buildingGrid,
    baseCarOwnership,
  };
}

/** Re-insert a footprint remembered by a save when the map data no longer has it. */
export function restoreBuilding(world: World, id: string, ring: number[], height: number): number {
  const area = Math.abs(ringArea(ring));
  const [cx, cy] = ringCentroid(ring);
  const idx = world.buildings.length;
  const access = (() => {
    let best: { link: number; offset: number; x: number; y: number; d: number } | null = null;
    for (const li of world.linkGrid.queryRadius(cx, cy, ACCESS_MAX)) {
      const l = world.links[li];
      const h = closestOnPolyline(cx, cy, l.pts, l.cum);
      const d = Math.sqrt(h.d2);
      if (!best || d < best.d) best = { link: li, offset: h.along, x: h.x, y: h.y, d };
    }
    return best;
  })();
  world.buildings.push({
    idx, id, ring: Float64Array.from(ring), holes: [], cx, cy, area, height, minHeight: 0, kind: 'shop',
    name: 'Restored site', street: '', playable: !!access, access, trips: 0.1, attract: 1,
  });
  world.buildingById.set(id, idx);
  world.buildingGrid.insertPoint(idx, cx, cy);
  return idx;
}
