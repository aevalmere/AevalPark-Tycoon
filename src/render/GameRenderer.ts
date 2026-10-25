// Draws the simulation: building roles → feature-state, traffic → line colours,
// vehicles/people/parked cars/structure buildings → instanced 3D boxes, and the
// 2D overlay. Highlights whatever the player has selected and the vehicles that
// belong to it. Also runs the day/night lighting. Reads the Simulation; never
// mutates it.

import { clamp } from '../core/geo';
import type { Graphics } from '../platform/storage';
import { STRUCTURES, parkingSpaces, taxiCapacity } from '../sim/content';
import type { GameEvent } from '../sim/events';
import type { Simulation, Vehicle } from '../sim/simulation';
import { hourOf, type Structure } from '../sim/state';
import { layoutFor, type Layout } from './layout';
import { MapView, ROLE, type Coverage, type MapQuality } from './MapView';
import { ModelLayer } from './ModelLayer';
import { InstanceBuffer, pushCar, pushDepotOffice, pushHalo, pushLotEntrance, pushPerson, pushShowroom, pushStallLine } from './models';
import { Overlay, type Glyph } from './Overlay';
import { YARD_HEIGHT, deckZ, visualHeight, type MapStyle } from './style';

const TAXI_COLOR = 0xf5b82e;
const SHOWROOM = [0xdc2626, 0x2563eb, 0xf8fafc, 0x111827, 0x0f766e, 0xf59e0b];
const GOLD = '#e8a33d';

export interface ViewState {
  selectedBuilding: number;
  selectedTrip: string | null;
  selectedLink: number;
  selectedVehicle: number;
  hoverBuilding: number;
  hoverLink: number;
  coverage: Coverage[];
  trafficView: boolean;
  /** unmet demand painted on the ground while the matching build tool is out */
  demand: 'parking' | 'taxi' | null;
  /** keep the camera on the selected vehicle */
  follow: boolean;
}

export function mapQuality(g: Graphics): MapQuality {
  const dpr = window.devicePixelRatio || 1;
  return { pixelRatio: g === 'high' ? dpr : g === 'balanced' ? Math.min(dpr, 1.5) : 1, antialias: g !== 'low' };
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const hex = (c: string) => parseInt(c.slice(1), 16);

/** Height of a structure's top: the roof of the depot office or showroom, or the top deck of a lot. */
function topZ(st: Structure, layout: Layout) {
  if (st.kind === 'parking') return deckZ('parking', st.level);
  if (!layout.building) return YARD_HEIGHT;
  return YARD_HEIGHT + (st.kind === 'taxi' ? 7.2 : 6.4);
}

export class GameRenderer {
  readonly view: MapView;
  overlay!: Overlay;
  layer!: ModelLayer;
  vs: ViewState = {
    selectedBuilding: -1, selectedTrip: null, selectedLink: -1, selectedVehicle: -1, hoverBuilding: -1, hoverLink: -1,
    coverage: [], trafficView: false, demand: null, follow: false,
  };
  dayNight = true;
  night = 0;
  private graphics: Graphics;
  private solids = new InstanceBuffer();
  private shadows = new InstanceBuffer();
  private glass = new InstanceBuffer();
  /** contact shadows go here instead on low graphics, and are never drawn */
  private sink = new InstanceBuffer();
  private layouts = new Map<string, Layout>();
  private tripBorn = new Map<string, number>();
  private out = new Map<string, number>();
  private lastTraffic = 0;
  private lastRoles = 0;
  private rolesDirty = true;
  private lastLight = -1;
  private tintOpacity = '';
  private unsub: () => void;
  private mapStyle: MapStyle;
  private tint!: HTMLElement;

  constructor(private sim: Simulation, mapStyle: MapStyle, graphics: Graphics) {
    this.view = new MapView(sim.world);
    this.mapStyle = mapStyle;
    this.graphics = graphics;
    this.unsub = sim.events.on((e) => this.onEvent(e));
  }

  async mount(wrapper: HTMLElement, mapEl: HTMLElement) {
    await this.view.mount(mapEl, this.mapStyle, this.sim.serviceRadius(), mapQuality(this.graphics));
    if (!this.view.alive) return;
    this.tint = document.createElement('div');
    this.tint.className = 'night-tint';
    wrapper.appendChild(this.tint);
    this.overlay = new Overlay(wrapper);
    this.overlay.dark = this.mapStyle === 'dark';
    this.overlay.maxDpr = mapQuality(this.graphics).pixelRatio;
    this.layer = new ModelLayer('apt-models', this.sim.world.proj, (l) => this.drawFrame(l));
    this.view.map.addLayer(this.layer);
    this.syncRoles();
    this.view.updateTraffic(this.sim.traffic);
    const hq = this.sim.world.buildings[this.sim.world.hq];
    this.view.establish(hq.cx, hq.cy);
  }

  /** Resolution changes apply live; antialiasing needs the map rebuilt, so it waits for the next load. */
  setGraphics(g: Graphics) {
    this.graphics = g;
    const q = mapQuality(g);
    this.view.setPixelRatio(q.pixelRatio);
    if (this.overlay) this.overlay.maxDpr = q.pixelRatio;
  }

  private now() {
    return performance.now() / 1000;
  }

  private onEvent(e: GameEvent) {
    if (!this.overlay) return;
    const now = this.now();
    const fl = (x: number, y: number, z: number, text: string, color: string, life = 1.6, small = false) =>
      this.overlay.floats.push({ x, y, z: visualHeight(z), text, color, born: now, life, small });
    switch (e.type) {
      case 'trip:new':
        this.tripBorn.set(e.trip, now);
        break;
      case 'trip:done':
        if (e.amount > 0) fl(e.x, e.y, e.z, `+$${e.amount.toLocaleString('en-US')}`, e.score >= 3 ? '#16a34a' : '#d97706');
        this.tripBorn.delete(e.trip);
        break;
      case 'trip:fail':
        fl(e.x, e.y, e.z, 'gave up', '#dc2626', 1.8);
        this.overlay.pings.push({ x: e.x, y: e.y, color: '#ef4444', born: now, life: 0.9 });
        this.tripBorn.delete(e.trip);
        break;
      case 'money':
        fl(e.x, e.y, e.z, `+$${e.amount.toLocaleString('en-US')}`, '#2563eb', 1.4, true);
        break;
      case 'sale':
        fl(e.x, e.y, e.z, `car sold +$${e.amount.toLocaleString('en-US')}`, '#0d9488', 2);
        break;
      case 'activate': {
        const b = this.sim.world.buildings[e.building];
        this.overlay.pings.push({ x: b.cx, y: b.cy, color: GOLD, born: now, life: 1.2 });
        this.rolesDirty = true;
        break;
      }
      case 'built': {
        const b = this.sim.world.buildings[e.building];
        const def = STRUCTURES[e.kind];
        this.overlay.pings.push({ x: b.cx, y: b.cy, color: def.color, born: now, life: 1.4 });
        fl(b.cx, b.cy, 8, `${def.name} open`, def.color, 2.2);
        this.rolesDirty = true;
        break;
      }
      case 'incident':
        this.overlay.pings.push({ x: e.x, y: e.y, color: '#f07b2e', born: now, life: 0.8 });
        break;
      case 'removed':
        this.layouts.delete(e.structure);
        this.rolesDirty = true;
        break;
      case 'upgraded':
        this.rolesDirty = true;
        break;
      case 'expand':
        this.view.setServiceRadius(e.radius);
        this.rolesDirty = true;
        break;
      default:
        break;
    }
  }

  syncRoles() {
    const sim = this.sim, w = sim.world;
    const R = sim.serviceRadius();
    for (const b of w.buildings) {
      let role: number = ROLE.none, lvl = 1;
      const sid = sim.structureAt.get(b.id);
      if (sid) {
        const st = sim.state.structures[sid];
        role = st.kind === 'parking' ? ROLE.lot : st.kind === 'taxi' ? ROLE.taxi : ROLE.dealer;
        lvl = st.level;
      } else if (b.idx === w.hq) role = ROLE.hq;
      else if (sim.state.buildings[b.id]?.active) role = ROLE.active;
      else if (Math.hypot(b.cx, b.cy) > R) role = ROLE.outside;
      this.view.setRole(b.idx, role, lvl);
    }
    this.rolesDirty = false;
  }

  /** Per animation frame, after the simulation has stepped. */
  update() {
    const t = this.now(), s = this.sim.state, v = this.vs;
    if (this.rolesDirty || t - this.lastRoles > 1.5) { this.syncRoles(); this.lastRoles = t; }
    if (t - this.lastTraffic > 0.35) { this.view.updateTraffic(this.sim.traffic); this.lastTraffic = t; }
    this.updateLight();
    this.view.setHover(v.hoverBuilding);
    this.view.setSelected(v.selectedBuilding);
    this.view.highlightLink(v.selectedLink >= 0 ? v.selectedLink : v.hoverLink);
    const followed = v.follow ? this.sim.vehicles.get(v.selectedVehicle) : undefined;
    if (followed) {
      const [x, y] = this.lerpPos(followed);
      this.view.map.setCenter(this.view.ll(x, y));
    }
    // a paused city with nothing selected doesn't need redrawing; camera moves still repaint on their own
    const live = (s.speed > 0 && !s.gameOver) || this.overlay.busy(t) || v.selectedBuilding >= 0 || v.selectedVehicle >= 0
      || !!v.selectedTrip || !!v.demand || s.incidents.length > 0;
    if (live) this.view.map.triggerRepaint();
  }

  setCoverage(list: Coverage[]) {
    this.vs.coverage = list;
    this.view.setCoverage(list);
  }

  setTrafficView(on: boolean) {
    this.vs.trafficView = on;
    this.view.setTrafficView(on);
  }

  private updateLight() {
    const hour = this.dayNight ? hourOf(this.sim.state.time) : 13;
    const elev = Math.sin(((hour - 6) / 12) * Math.PI); // 1 at noon, <0 at night
    this.night = clamp((0.25 - elev) / 0.45, 0, 1);
    const op = (this.night * (this.mapStyle === 'dark' ? 0.3 : 0.5)).toFixed(3);
    if (op !== this.tintOpacity) { this.tint.style.opacity = op; this.tintOpacity = op; }
    const key = Math.round(hour * 4);
    if (key === this.lastLight) return;
    this.lastLight = key;
    const az = 90 + ((hour - 6) / 12) * 180; // east in the morning, west in the evening
    const dusk = clamp(1 - Math.abs(elev) / 0.35, 0, 1);
    const color = this.night > 0.6 ? '#9fb4ff' : dusk > 0.3 ? '#ffc08a' : '#ffffff';
    this.view.setLight(0.32 + 0.2 * (1 - this.night), color, az, clamp(90 - Math.max(0, elev) * 65, 20, 80));
    const a = (az * Math.PI) / 180, el = Math.max(0.2, elev);
    this.layer.lighting = {
      sun: [Math.sin(a) * Math.cos(el), Math.cos(a) * Math.cos(el), Math.sin(el)],
      ambient: 0.5 + 0.18 * (1 - this.night),
      diffuse: 0.48 * (1 - this.night * 0.6),
    };
  }

  private layout(st: Structure): Layout {
    let l = this.layouts.get(st.id);
    if (!l) {
      const b = this.sim.wb(st.building)!;
      const max = st.kind === 'parking' ? parkingSpaces(b, 1) : st.kind === 'taxi' ? taxiCapacity(b, STRUCTURES.taxi.maxLevel) : 10;
      l = layoutFor(st.kind, b, max);
      this.layouts.set(st.id, l);
    }
    return l;
  }

  private lerpPos(v: Vehicle): [number, number, number] {
    const A = this.sim.alpha;
    return [v.px + (v.x - v.px) * A, v.py + (v.y - v.py) * A, lerpAngle(v.ph, v.h, A)];
  }

  private carScale() {
    // cars grow when zoomed out so traffic stays readable at district scale
    return clamp(Math.pow(2, (17.6 - this.view.map.getZoom()) * 0.85), 1, 3.2);
  }

  /** The vehicles tied to the current selection, and the colour to mark them in. */
  related(): { ids: Set<number>; color: string } {
    const sim = this.sim, v = this.vs, ids = new Set<number>();
    if (v.selectedVehicle >= 0) {
      if (sim.vehicles.has(v.selectedVehicle)) ids.add(v.selectedVehicle);
      return { ids, color: GOLD };
    }
    if (v.selectedTrip) {
      for (const x of sim.vehicles.values()) if (x.trip === v.selectedTrip) ids.add(x.id);
      return { ids, color: GOLD };
    }
    const st = this.selectedStructure();
    if (!st) return { ids, color: GOLD };
    for (const x of sim.vehicles.values()) {
      if (st.kind === 'taxi' ? x.kind === 'taxi' && x.depot === st.id : x.lot === st.id) ids.add(x.id);
    }
    return { ids, color: STRUCTURES[st.kind].color };
  }

  private selectedStructure(): Structure | undefined {
    const b = this.vs.selectedBuilding >= 0 ? this.sim.world.buildings[this.vs.selectedBuilding] : undefined;
    const sid = b && this.sim.structureAt.get(b.id);
    return sid ? this.sim.state.structures[sid] : undefined;
  }

  /** The vehicle drawn under a screen point, or -1. */
  vehicleAt(px: number, py: number): number {
    if (!this.layer?.matrix) return -1;
    const k = this.carScale();
    let best = -1, bestD = 9 + 3 * k;
    for (const v of this.sim.vehicles.values()) {
      const p = this.overlay.project(v.x, v.y, 1);
      if (!p) continue;
      const d = Math.hypot(p[0] - px, p[1] - py);
      if (d < bestD) { bestD = d; best = v.id; }
    }
    return best;
  }

  private drawFrame(layer: ModelLayer) {
    const sim = this.sim, s = sim.state;
    const zoom = this.view.map.getZoom();
    const scale = this.carScale();
    const t = this.now();
    const lights = this.night > 0.35;
    const low = this.graphics === 'low';
    const { solids, glass } = this;
    const decals = this.shadows, shadows = low ? this.sink : this.shadows;
    solids.reset();
    decals.reset();
    glass.reset();
    this.sink.reset();
    this.out = sim.taxisOutAll();
    const rel = this.related();
    const relRgb = hex(rel.color);
    const pulse = (t * 1.2) % 1;

    // moving vehicles (interpolated between the last two sim ticks)
    for (const v of sim.vehicles.values()) {
      const [x, y, h] = this.lerpPos(v);
      const grow = clamp((s.time - v.born) / 0.3, 0.35, 1);
      const k = scale * grow;
      const lx = x + Math.sin(h) * v.lane * scale, ly = y - Math.cos(h) * v.lane * scale;
      if (rel.ids.has(v.id)) pushHalo(decals, lx, ly, 0, h, k, relRgb, pulse);
      pushCar(solids, shadows, lx, ly, 0, h, k, v.kind === 'taxi' ? TAXI_COLOR : v.color, {
        taxi: v.kind === 'taxi', lights, braking: v.stopFor > 0 || v.speed < 6,
      });
    }

    // structures: lots with their stalls and booth, taxi yards with an office, dealer forecourts with a showroom
    const detail = zoom >= 15.6 && !low;
    for (const st of Object.values(s.structures)) {
      const b = sim.wb(st.building);
      if (!b) continue;
      const l = this.layout(st);
      const z = deckZ(st.kind, st.level);
      if (st.kind === 'parking') {
        const parked = st.parked ?? [];
        const show = Math.min(l.slots.length, Math.ceil(parked.length / st.level));
        for (let i = 0; i < show; i++) pushCar(solids, shadows, l.slots[i].x, l.slots[i].y, z, l.slots[i].h, 1, parked[i].color);
        if (detail) for (const ln of l.lines) pushStallLine(solids, ln.x, ln.y, z, ln.h, this.mapStyle === 'dark' ? 0x9aa3b2 : 0xe9edf2);
        if (l.entrance) {
          // a surface lot's booth stands on the lot; a garage's out front by the ramp
          const e = l.entrance, k = st.level === 1 ? 0 : 3.4;
          pushLotEntrance(solids, e.x + Math.cos(e.h) * k, e.y + Math.sin(e.h) * k, st.level === 1 ? z : 0, e.h, lights);
        }
      } else if (st.kind === 'taxi') {
        if (l.building) pushDepotOffice(solids, shadows, l.building, z, lights);
        const idle = Math.max(0, (st.taxis ?? 0) - (this.out.get(st.id) ?? 0));
        for (let i = 0; i < Math.min(idle, l.slots.length); i++) pushCar(solids, shadows, l.slots[i].x, l.slots[i].y, z, l.slots[i].h, 1, TAXI_COLOR, { taxi: true, lights });
      } else {
        if (l.building) pushShowroom(solids, glass, shadows, l.building, z, lights);
        l.inside.forEach((p, i) => pushCar(solids, shadows, p.x, p.y, z + 0.15, p.h, 1, SHOWROOM[(i + 3) % SHOWROOM.length]));
        for (let i = 0; i < Math.min(l.slots.length, 2 + st.level * 2); i++) pushCar(solids, shadows, l.slots[i].x, l.slots[i].y, z, l.slots[i].h + i * 0.4, 1, SHOWROOM[i % SHOWROOM.length]);
      }
    }

    // pedestrians walking the last stretch
    for (const p of sim.walkers) {
      const k = clamp((p.t + sim.alpha * (1 / 60)) / p.dur, 0, 1);
      const x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k;
      pushPerson(solids, shadows, x, y, 0, Math.atan2(p.y1 - p.y0, p.x1 - p.x0), scale * 1.25, p.color);
    }
    layer.setInstances(solids.data, solids.n, decals.data, decals.n, glass.data, glass.n);

    if (layer.matrix) this.drawOverlay(layer.matrix, zoom, scale, lights && !low, rel, t);
  }

  private routePoints(v: Vehicle): number[] {
    const w = this.sim.world;
    const [x, y] = this.lerpPos(v);
    const pts: number[] = [x, y];
    for (let i = v.ri; i < v.route.edges.length; i++) {
      const e = w.edges[v.route.edges[i]], l = w.links[e.link];
      const n = l.pts.length / 2;
      for (let k = 0; k < n; k++) {
        const j = e.dir === 1 ? k : n - 1 - k;
        pts.push(l.pts[j * 2], l.pts[j * 2 + 1]);
      }
    }
    return pts;
  }

  private drawOverlay(m: Float64Array, zoom: number, scale: number, glows: boolean, rel: { ids: Set<number>; color: string }, now: number) {
    const sim = this.sim, s = sim.state, w = sim.world, o = this.overlay, v = this.vs;
    o.begin(m);

    if (glows) {
      o.beginGlow();
      for (const x of sim.vehicles.values()) o.headlight(x.x + Math.sin(x.h) * x.lane * scale, x.y - Math.cos(x.h) * x.lane * scale, x.h, scale, this.night);
      o.endGlow();
    }

    if (v.demand) this.drawDemand(v.demand, zoom);

    for (const inc of s.incidents) o.incident(inc.x, inc.y, now);

    // selected building: an outline you can't miss, plus what it serves
    const selB = v.selectedBuilding >= 0 ? w.buildings[v.selectedBuilding] : undefined;
    const selSt = this.selectedStructure();
    if (selB) {
      const color = selSt ? STRUCTURES[selSt.kind].color : selB.idx === w.hq || s.buildings[selB.id]?.active ? GOLD : '#f8fafc';
      const top = selSt ? topZ(selSt, this.layout(selSt)) : visualHeight(selB.height);
      o.outline(selB.ring, selSt ? 0 : visualHeight(selB.minHeight), top, color, now);
      if (selSt?.kind === 'parking') {
        // dashed walks from the lot to where its parked drivers went
        const seen = new Set<string>();
        for (const p of selSt.parked ?? []) {
          if (!p.dest || seen.has(p.dest)) continue;
          seen.add(p.dest);
          const d = sim.wb(p.dest);
          if (d) o.polyline([selB.cx, selB.cy, d.cx, d.cy], 0.6, 'rgba(79,140,255,0.75)', 2, [3, 5]);
        }
      }
    }

    // vehicles tied to the selection: their remaining route and a pin above each
    if (rel.ids.size) {
      const single = rel.ids.size === 1;
      for (const id of rel.ids) {
        const x = sim.vehicles.get(id);
        if (!x) continue;
        o.polyline(this.routePoints(x), 1, rel.color, single ? 4 : 2.5, single ? [] : [6, 6]);
      }
      for (const id of rel.ids) {
        const x = sim.vehicles.get(id);
        if (!x) continue;
        const [px, py] = this.lerpPos(x);
        o.marker(px, py, 2.4 * scale, rel.color, now + id);
      }
    }

    // selected trip: arc from origin to destination
    const sel = v.selectedTrip ? s.trips[v.selectedTrip] : undefined;
    if (sel) {
      const a = sim.wb(sel.origin), b = sim.wb(sel.dest);
      if (a && b) {
        o.arc3(a.cx, a.cy, visualHeight(a.height) + 4, b.cx, b.cy, visualHeight(b.height) + 2, GOLD);
        const f = o.project(b.cx, b.cy, visualHeight(b.height) + 2);
        if (f) o.glyph('flag', f[0] + 6, f[1] - 10, 20, GOLD);
      }
    }
    // selected vehicle with a rider aboard: where they're headed
    const selV = v.selectedVehicle >= 0 ? sim.vehicles.get(v.selectedVehicle) : undefined;
    const vTrip = selV?.trip ? s.trips[selV.trip] : undefined;
    if (vTrip) {
      const b = sim.wb(vTrip.dest);
      const f = b && o.project(b.cx, b.cy, visualHeight(b.height) + 2);
      if (f) o.glyph('flag', f[0] + 6, f[1] - 10, 20, GOLD);
    }

    // structure badges
    const showText = zoom >= 15.4;
    const hq = w.buildings[w.hq];
    o.badge(hq.cx, hq.cy, visualHeight(hq.height) + 12, 'crown', GOLD, s.meta.company, showText);
    for (const st of Object.values(s.structures)) {
      const b = sim.wb(st.building);
      if (!b) continue;
      const z = topZ(st, this.layout(st)) + 2;
      const big = st === selSt ? 1.15 : 1;
      if (st.kind === 'parking') o.badge(b.cx, b.cy, z, 'p', STRUCTURES.parking.color, `${st.parked?.length ?? 0}/${parkingSpaces(b, st.level)}`, showText, big);
      else if (st.kind === 'taxi') o.badge(b.cx, b.cy, z, 'taxi', STRUCTURES.taxi.color, `${Math.max(0, (st.taxis ?? 0) - (this.out.get(st.id) ?? 0))}/${st.taxis ?? 0}`, showText, big);
      else o.badge(b.cx, b.cy, z, 'key', STRUCTURES.dealership.color, `${st.sales ?? 0} sold`, showText, big);
    }

    // riders waiting on rooftops; the ones a selected depot is fetching get its colour
    const fetching = new Set<string>();
    if (selSt?.kind === 'taxi') for (const x of sim.vehicles.values()) if (x.depot === selSt.id && x.trip) fetching.add(x.trip);
    const stack = new Map<string, number>();
    for (const t of Object.values(s.trips)) {
      if (t.status === 'riding') continue;
      const b = sim.wb(t.origin);
      if (!b) continue;
      const n = stack.get(t.origin) ?? 0;
      stack.set(t.origin, n + 1);
      const frac = 1 - t.waited / t.patience;
      const born = this.tripBorn.get(t.id) ?? 0;
      const pulse = now - born < 1.2 ? Math.sin((now - born) * 12) * (1 - (now - born) / 1.2) : frac < 0.25 ? Math.sin(now * 8) * 0.5 : 0;
      let glyph: Glyph = 'person', color = o.dark ? '#e7ecf5' : '#1e293b';
      if (t.status === 'pickup') { glyph = 'taxi'; color = '#d99a12'; }
      else if (t.hasCar) { glyph = 'car'; color = '#2563eb'; }
      const badge = t.reason === 'parking' ? { glyph: 'p' as Glyph, bg: STRUCTURES.parking.color, fg: '#ffffff' }
        : t.reason === 'taxi' ? { glyph: 'taxi' as Glyph, bg: STRUCTURES.taxi.color, fg: '#1f2937' } : null;
      o.bubble(t.id, b.cx, b.cy, visualHeight(b.height) + 3, n, frac, glyph, color, badge, t.id === v.selectedTrip, pulse, fetching.has(t.id) ? STRUCTURES.taxi.color : null);
    }

    o.effects(now);
  }

  /** Ground heat where drivers couldn't park (or riders found no taxi), recent and live. */
  private drawDemand(kind: 'parking' | 'taxi', zoom: number) {
    const sim = this.sim, o = this.overlay;
    const spots = new Map(kind === 'parking' ? sim.parkDemand : sim.taxiDemand);
    for (const t of Object.values(sim.state.trips)) {
      if (t.reason !== kind) continue;
      const id = kind === 'parking' ? t.dest : t.origin;
      spots.set(id, (spots.get(id) ?? 0) + 1);
    }
    const color = kind === 'parking' ? STRUCTURES.parking.color : STRUCTURES.taxi.color;
    for (const [id, n] of spots) {
      const b = sim.wb(id);
      if (!b || n < 0.3) continue;
      o.heat(b.cx, b.cy, 26 + 12 * Math.sqrt(n), color, n, zoom >= 15.4 && n >= 0.95 ? String(Math.round(n)) : null);
    }
  }

  destroy() {
    this.unsub();
    this.overlay?.destroy();
    this.tint?.remove();
    this.view.destroy();
  }
}
