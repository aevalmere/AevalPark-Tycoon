// Geometry in local metres. The simulation never touches lat/lng except at
// the edges (loading tiles, drawing on the map), so all maths here is planar.

export interface LatLng {
  lat: number;
  lng: number;
}

const DEG = Math.PI / 180;

/**
 * East/north metres around an origin (x east, y north). Over the couple of
 * kilometres a game world spans the error is a few centimetres.
 */
export class LocalProjection {
  readonly mPerDegLat: number;
  readonly mPerDegLng: number;

  constructor(readonly origin: LatLng) {
    const p = origin.lat * DEG;
    this.mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
    this.mPerDegLng = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  }

  toLocal(lat: number, lng: number): [number, number] {
    return [(lng - this.origin.lng) * this.mPerDegLng, (lat - this.origin.lat) * this.mPerDegLat];
  }

  toLatLng(x: number, y: number): LatLng {
    return { lat: this.origin.lat + y / this.mPerDegLat, lng: this.origin.lng + x / this.mPerDegLng };
  }

  /** [lng, lat] in the order GeoJSON and MapLibre expect. */
  toLngLat(x: number, y: number): [number, number] {
    return [this.origin.lng + x / this.mPerDegLng, this.origin.lat + y / this.mPerDegLat];
  }
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

/** Signed shoelace area of a flat [x0,y0,x1,y1,...] ring (positive = counter-clockwise). */
export function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

export function ringCentroid(r: ArrayLike<number>): [number, number] {
  let a = 0, cx = 0, cy = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const f = r[j] * r[i + 1] - r[i] * r[j + 1];
    a += f;
    cx += (r[j] + r[i]) * f;
    cy += (r[j + 1] + r[i + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate sliver: fall back to the vertex mean
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i += 2) { sx += r[i]; sy += r[i + 1]; }
    return [sx / (n / 2), sy / (n / 2)];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(x: number, y: number, r: ArrayLike<number>): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringBounds(r: ArrayLike<number>): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < minX) minX = r[i];
    if (r[i] > maxX) maxX = r[i];
    if (r[i + 1] < minY) minY = r[i + 1];
    if (r[i + 1] > maxY) maxY = r[i + 1];
  }
  return [minX, minY, maxX, maxY];
}

export interface SegmentHit {
  t: number;
  x: number;
  y: number;
  d2: number;
}

export function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): SegmentHit {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx, y = ay + t * dy;
  return { t, x, y, d2: (px - x) ** 2 + (py - y) ** 2 };
}

/** Proper intersection of segments AB and CD, as parameters along each. */
export function segmentIntersection(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): { t: number; u: number } | null {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Point and heading at distance `d` along a flat polyline with cumulative lengths. */
export function pointAlong(pts: ArrayLike<number>, cum: ArrayLike<number>, d: number, out: { x: number; y: number; h: number }) {
  const n = cum.length;
  if (d <= 0) {
    out.x = pts[0]; out.y = pts[1];
    out.h = Math.atan2(pts[3] - pts[1], pts[2] - pts[0]);
    return out;
  }
  const total = cum[n - 1];
  if (d >= total) {
    out.x = pts[(n - 1) * 2]; out.y = pts[(n - 1) * 2 + 1];
    out.h = Math.atan2(pts[(n - 1) * 2 + 1] - pts[(n - 2) * 2 + 1], pts[(n - 1) * 2] - pts[(n - 2) * 2]);
    return out;
  }
  // binary search for the segment containing d
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 0 ? (d - cum[lo]) / segLen : 0;
  const ax = pts[lo * 2], ay = pts[lo * 2 + 1], bx = pts[hi * 2], by = pts[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.y = ay + (by - ay) * t;
  out.h = Math.atan2(by - ay, bx - ax);
  return out;
}

export function polylineLengths(pts: ArrayLike<number>): Float64Array {
  const n = pts.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  return cum;
}

/** Closest point on a polyline: distance along it, the point, and squared distance. */
export function closestOnPolyline(px: number, py: number, pts: ArrayLike<number>, cum: ArrayLike<number>) {
  let best = { along: 0, x: pts[0], y: pts[1], d2: Infinity };
  for (let i = 0; i < cum.length - 1; i++) {
    const h = closestOnSegment(px, py, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3]);
    if (h.d2 < best.d2) best = { along: cum[i] + h.t * (cum[i + 1] - cum[i]), x: h.x, y: h.y, d2: h.d2 };
  }
  return best;
}
