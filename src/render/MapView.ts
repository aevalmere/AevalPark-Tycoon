// MapLibre map for the game: basemap, the district's 3D buildings (coloured by
// feature-state), directional traffic lines, the service area, and picking.

import { Map as MlMap, type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import './maplibre';
import type { World } from '../world/types';
import { COLORS, DARK_COLORS, TRAFFIC_STOPS, loadBaseStyle, visualHeight, type MapStyle } from './style';

export const ROLE = { none: 0, active: 1, hq: 2, lot: 3, dealer: 4, taxi: 5, outside: 6 } as const;

const SRC_B = 'apt-buildings';
const SRC_T = 'apt-traffic';
const SRC_AREA = 'apt-area';
const SRC_COV = 'apt-coverage';
const SRC_ROADS = 'apt-roads';

function circle(cx: number, cy: number, r: number, n = 96): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export interface Coverage {
  x: number;
  y: number;
  r: number;
  color: string;
}

export class MapView {
  map!: MlMap;
  styleOk = false;
  private world: World;
  private roleOf = new Int8Array(0);
  private levelOf = new Int8Array(0);
  private hovered = -1;
  private selected = -1;
  private previewed = -1;
  private trafficQ: Uint8Array;
  private destroyed = false;

  constructor(world: World) {
    this.world = world;
    this.roleOf = new Int8Array(world.buildings.length).fill(-1);
    this.levelOf = new Int8Array(world.buildings.length);
    this.trafficQ = new Uint8Array(world.edges.length).fill(255);
  }

  ll(x: number, y: number) {
    return this.world.proj.toLngLat(x, y);
  }

  async mount(container: HTMLElement, mapStyle: MapStyle, serviceRadius: number): Promise<void> {
    const base = await loadBaseStyle(mapStyle);
    if (this.destroyed) return;
    this.styleOk = base.ok;
    const w = this.world;
    const center = this.ll(0, 0);
    const r = w.radius + 400;
    const sw = w.proj.toLngLat(-r, -r), ne = w.proj.toLngLat(r, r);
    this.map = new MlMap({
      container,
      style: base.style,
      center,
      zoom: 16,
      pitch: 45,
      bearing: -18,
      minZoom: 14,
      maxZoom: 19.5,
      maxPitch: 70,
      maxBounds: [sw, ne],
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      fadeDuration: 0,
    });
    this.map.dragRotate.enable();
    this.map.touchZoomRotate.enableRotation();
    this.map.keyboard.disable();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The map took too long to start. Check your connection and reload.')), 30000);
      this.map.once('load', () => { clearTimeout(timer); resolve(); });
    });
    if (this.destroyed) return;
    this.addLayers(base.labelBefore, mapStyle, serviceRadius);
  }

  private addLayers(labelBefore: string | undefined, mapStyle: MapStyle, serviceRadius: number) {
    const map = this.map, w = this.world;
    const C = mapStyle === 'dark' ? DARK_COLORS : COLORS;

    // ---- buildings ----
    const features = w.buildings.map((b) => {
      const rings = [b.ring, ...b.holes].map((r) => {
        const out: number[][] = [];
        for (let i = 0; i < r.length; i += 2) out.push(this.ll(r[i], r[i + 1]));
        out.push(out[0]);
        return out;
      });
      return { type: 'Feature' as const, id: b.idx, properties: { h: visualHeight(b.height), b: visualHeight(b.minHeight) }, geometry: { type: 'Polygon' as const, coordinates: rings } };
    });
    map.addSource(SRC_B, { type: 'geojson', data: { type: 'FeatureCollection', features } });

    // ---- service area / fog ----
    map.addSource(SRC_AREA, { type: 'geojson', data: this.areaData(serviceRadius) });
    map.addLayer({
      id: 'apt-fog', type: 'fill', source: SRC_AREA, filter: ['==', ['get', 'k'], 'fog'],
      paint: { 'fill-color': mapStyle === 'dark' ? '#05070b' : '#2a3140', 'fill-opacity': mapStyle === 'dark' ? 0.55 : 0.22 },
    }, labelBefore);
    map.addLayer({
      id: 'apt-locked', type: 'fill', source: SRC_AREA, filter: ['==', ['get', 'k'], 'locked'],
      paint: { 'fill-color': mapStyle === 'dark' ? '#05070b' : '#2a3140', 'fill-opacity': mapStyle === 'dark' ? 0.25 : 0.08 },
    }, labelBefore);

    // ---- our own road surface, only when the basemap is missing ----
    if (!this.styleOk || w.source === 'synthetic') {
      const roads = w.links.map((l) => {
        const coords: number[][] = [];
        for (let i = 0; i < l.pts.length; i += 2) coords.push(this.ll(l.pts[i], l.pts[i + 1]));
        return { type: 'Feature' as const, properties: { major: l.cls === 'primary' || l.cls === 'secondary' ? 1 : 0 }, geometry: { type: 'LineString' as const, coordinates: coords } };
      });
      map.addSource(SRC_ROADS, { type: 'geojson', data: { type: 'FeatureCollection', features: roads } });
      map.addLayer({
        id: 'apt-road-surface', type: 'line', source: SRC_ROADS,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': mapStyle === 'dark' ? '#2a3242' : '#ffffff',
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 14, ['case', ['==', ['get', 'major'], 1], 5, 3], 18, ['case', ['==', ['get', 'major'], 1], 36, 22]],
        },
      }, labelBefore);
    }

    // ---- traffic, one line per direction of travel ----
    const tFeatures = w.edges.map((e) => {
      const l = w.links[e.link];
      const coords: number[][] = [];
      for (let i = 0; i < l.pts.length; i += 2) coords.push(this.ll(l.pts[i], l.pts[i + 1]));
      if (e.dir === -1) coords.reverse();
      return { type: 'Feature' as const, id: e.idx, properties: { ow: l.oneway ? 1 : 0, link: e.link }, geometry: { type: 'LineString' as const, coordinates: coords } };
    });
    map.addSource(SRC_T, { type: 'geojson', data: { type: 'FeatureCollection', features: tFeatures } });
    const t: ExpressionSpecification = ['coalesce', ['feature-state', 't'], 0];
    const ramp: ExpressionSpecification = ['interpolate', ['linear'], t, ...TRAFFIC_STOPS.flat()] as ExpressionSpecification;
    map.addLayer({
      id: 'apt-traffic', type: 'line', source: SRC_T,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hl'], false], '#e8a33d', ramp],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
          14, ['case', ['==', ['get', 'ow'], 1], 1.6, 1.1],
          16, ['case', ['==', ['get', 'ow'], 1], 3.4, 2.3],
          18.5, ['case', ['==', ['get', 'ow'], 1], 9, 6]],
        'line-offset': ['interpolate', ['exponential', 1.5], ['zoom'],
          14, ['case', ['==', ['get', 'ow'], 1], 0, 0.9],
          16, ['case', ['==', ['get', 'ow'], 1], 0, 1.9],
          18.5, ['case', ['==', ['get', 'ow'], 1], 0, 4.6]],
        'line-opacity': ['case', ['boolean', ['feature-state', 'hl'], false], 1, ['interpolate', ['linear'], t, 0, 0.32, 0.25, 0.55, 0.5, 0.9]],
      },
    }, labelBefore);

    // ---- coverage circles (build previews, selected structure reach) ----
    map.addSource(SRC_COV, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'apt-cov-fill', type: 'fill', source: SRC_COV, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.1 } }, labelBefore);
    map.addLayer({ id: 'apt-cov-line', type: 'line', source: SRC_COV, paint: { 'line-color': ['get', 'c'], 'line-width': 2, 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 } }, labelBefore);

    // ---- 3D buildings, coloured by game role ----
    const role: ExpressionSpecification = ['coalesce', ['feature-state', 'role'], 0];
    const lvl: ExpressionSpecification = ['coalesce', ['feature-state', 'lvl'], 1];
    const baseColor: ExpressionSpecification = ['match', role,
      ROLE.active, C.active,
      ROLE.hq, C.hq,
      ROLE.lot, ['case', ['>', lvl, 1], C.garage, C.lot],
      ROLE.dealer, C.dealer,
      ROLE.taxi, C.taxi,
      ROLE.outside, C.outside,
      C.inactive];
    const prev: ExpressionSpecification = ['coalesce', ['feature-state', 'prev'], 0];
    map.addLayer({
      id: 'apt-buildings', type: 'fill-extrusion', source: SRC_B,
      paint: {
        'fill-extrusion-color': ['case',
          ['==', prev, 1], C.valid,
          ['==', prev, 2], C.invalid,
          ['interpolate', ['linear'],
            ['case', ['boolean', ['feature-state', 'sel'], false], 0.45, ['boolean', ['feature-state', 'hover'], false], 0.28, 0],
            0, baseColor, 1, '#ffffff']],
        'fill-extrusion-height': ['match', role,
          ROLE.lot, ['+', 0.6, ['*', ['-', lvl, 1], 3.2]],
          ROLE.taxi, 7,
          ROLE.dealer, 9,
          ['get', 'h']],
        'fill-extrusion-base': ['match', role, ROLE.lot, 0, ROLE.taxi, 0, ROLE.dealer, 0, ['get', 'b']],
        'fill-extrusion-opacity': 0.96,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    map.addLayer({
      id: 'apt-service-ring', type: 'line', source: SRC_AREA, filter: ['==', ['get', 'k'], 'ring'],
      paint: { 'line-color': '#e8a33d', 'line-width': 2.5, 'line-dasharray': [3, 2], 'line-opacity': 0.85 },
    });
  }

  private areaData(serviceRadius: number) {
    const w = this.world;
    const toLL = (pts: number[][]) => pts.map(([x, y]) => this.ll(x, y));
    const big = w.radius + 3000;
    const outer = toLL([[-big, -big], [big, -big], [big, big], [-big, big], [-big, -big]]);
    const world = toLL(circle(0, 0, w.radius));
    const service = toLL(circle(0, 0, serviceRadius));
    return {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: { k: 'fog' }, geometry: { type: 'Polygon' as const, coordinates: [outer, world.slice().reverse()] } },
        { type: 'Feature' as const, properties: { k: 'locked' }, geometry: { type: 'Polygon' as const, coordinates: [world, service.slice().reverse()] } },
        { type: 'Feature' as const, properties: { k: 'ring' }, geometry: { type: 'LineString' as const, coordinates: service } },
      ],
    };
  }

  setServiceRadius(r: number) {
    (this.map.getSource(SRC_AREA) as GeoJSONSource | undefined)?.setData(this.areaData(r));
  }

  setCoverage(list: Coverage[]) {
    const features = list.map((c) => ({
      type: 'Feature' as const,
      properties: { c: c.color },
      geometry: { type: 'Polygon' as const, coordinates: [circle(c.x, c.y, c.r, 72).map(([x, y]) => this.ll(x, y))] },
    }));
    (this.map.getSource(SRC_COV) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  // ---- feature state ----

  setRole(idx: number, role: number, level = 1) {
    if (this.roleOf[idx] === role && this.levelOf[idx] === level) return;
    this.roleOf[idx] = role;
    this.levelOf[idx] = level;
    this.map.setFeatureState({ source: SRC_B, id: idx }, { role, lvl: level });
  }

  setHover(idx: number) {
    if (idx === this.hovered) return;
    if (this.hovered >= 0) this.map.setFeatureState({ source: SRC_B, id: this.hovered }, { hover: false });
    this.hovered = idx;
    if (idx >= 0) this.map.setFeatureState({ source: SRC_B, id: idx }, { hover: true });
  }

  setSelected(idx: number) {
    if (idx === this.selected) return;
    if (this.selected >= 0) this.map.setFeatureState({ source: SRC_B, id: this.selected }, { sel: false });
    this.selected = idx;
    if (idx >= 0) this.map.setFeatureState({ source: SRC_B, id: idx }, { sel: true });
  }

  /** build preview tint: 1 valid, 2 invalid, 0 none */
  setPreview(idx: number, state: 0 | 1 | 2) {
    if (this.previewed >= 0 && this.previewed !== idx) this.map.setFeatureState({ source: SRC_B, id: this.previewed }, { prev: 0 });
    this.previewed = state ? idx : -1;
    if (idx >= 0) this.map.setFeatureState({ source: SRC_B, id: idx }, { prev: state });
  }

  private highlighted: number[] = [];
  highlightLink(link: number) {
    for (const e of this.highlighted) this.map.setFeatureState({ source: SRC_T, id: e }, { hl: false });
    this.highlighted = link >= 0 ? this.world.linkEdges[link] : [];
    for (const e of this.highlighted) this.map.setFeatureState({ source: SRC_T, id: e }, { hl: true });
  }

  /** push traffic levels, only for edges whose rounded level changed */
  updateTraffic(traffic: Float32Array) {
    for (let e = 0; e < traffic.length; e++) {
      const q = Math.round(Math.min(1, traffic[e]) * 20);
      if (q === this.trafficQ[e]) continue;
      this.trafficQ[e] = q;
      this.map.setFeatureState({ source: SRC_T, id: e }, { t: q / 20 });
    }
  }

  setTrafficView(on: boolean) {
    if (!this.map.getLayer('apt-traffic')) return;
    const t: ExpressionSpecification = ['coalesce', ['feature-state', 't'], 0];
    this.map.setPaintProperty('apt-traffic', 'line-opacity', on
      ? ['case', ['boolean', ['feature-state', 'hl'], false], 1, 0.95]
      : ['case', ['boolean', ['feature-state', 'hl'], false], 1, ['interpolate', ['linear'], t, 0, 0.32, 0.25, 0.55, 0.5, 0.9]]);
    this.map.setPaintProperty('apt-buildings', 'fill-extrusion-opacity', on ? 0.55 : 0.96);
    const k = on ? 1.9 : 1;
    this.map.setPaintProperty('apt-traffic', 'line-width', ['interpolate', ['exponential', 1.5], ['zoom'],
      14, ['case', ['==', ['get', 'ow'], 1], 1.6 * k, 1.1 * k],
      16, ['case', ['==', ['get', 'ow'], 1], 3.4 * k, 2.3 * k],
      18.5, ['case', ['==', ['get', 'ow'], 1], 9 * k, 6 * k]]);
    this.map.setPaintProperty('apt-traffic', 'line-offset', ['interpolate', ['exponential', 1.5], ['zoom'],
      14, ['case', ['==', ['get', 'ow'], 1], 0, 0.9 * k],
      16, ['case', ['==', ['get', 'ow'], 1], 0, 1.9 * k],
      18.5, ['case', ['==', ['get', 'ow'], 1], 0, 4.6 * k]]);
  }

  // ---- picking ----

  buildingAt(px: number, py: number): number {
    const hits = this.map.queryRenderedFeatures([px, py], { layers: ['apt-buildings'] });
    return hits.length ? Number(hits[0].id) : -1;
  }

  linkAt(px: number, py: number): number {
    const hits = this.map.queryRenderedFeatures([[px - 7, py - 7], [px + 7, py + 7]], { layers: ['apt-traffic'] });
    return hits.length ? Number(hits[0].properties.link) : -1;
  }

  flyToLocal(x: number, y: number, zoom?: number) {
    this.map.flyTo({ center: this.ll(x, y), zoom: zoom ?? Math.max(this.map.getZoom(), 16.5), duration: 900, essential: true });
  }

  setLight(intensity: number, color: string, azimuth: number, polar: number) {
    this.map.setLight({ anchor: 'map', intensity, color, position: [1.15, azimuth, polar] });
  }

  get alive() {
    return !this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.map?.remove();
  }
}
