// Draws the simulation: building roles → feature-state, traffic → line colours,
// vehicles/people/parked cars → instanced 3D boxes, and the 2D overlay. Also
// runs the day/night lighting. Reads the Simulation; never mutates it.

import { clamp, pointInRing } from '../core/geo';
import type { GameEvent } from '../sim/events';
import { parkingSpaces, STRUCTURES } from '../sim/content';
import type { Simulation } from '../sim/simulation';
import { hourOf, type Structure } from '../sim/state';
import { MapView, ROLE, type Coverage } from './MapView';
import { ModelLayer } from './ModelLayer';
import { InstanceBuffer, pushCar, pushPerson } from './models';
import { Overlay, type Glyph } from './Overlay';
import { visualHeight, type MapStyle } from './style';

const TAXI_COLOR = 0xf5b82e;
const SHOWROOM = [0xdc2626, 0x2563eb, 0xf8fafc, 0x111827, 0x0f766e, 0xf59e0b];
const STRUCT_HEIGHT = (s: Structure) => (s.kind === 'parking' ? 0.6 + (s.level - 1) * 3.2 : s.kind === 'taxi' ? 7 : 9);

export interface ViewState {
  selectedBuilding: number;
  selectedTrip: string | null;
  selectedLink: number;
  hoverBuilding: number;
  hoverLink: number;
  coverage: Coverage[];
  trafficView: boolean;
}

interface Slot { x: number; y: number; h: number }

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Parking-stall grid inside a footprint, aligned to its longest edge. */
function slotsFor(ring: Float64Array, max: number): Slot[] {
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
  const out: Slot[] = [];
  const inside = (u: number, v: number) => pointInRing(u * ux + v * vx, u * uy + v * vy, ring);
  let v = v0 + 3.1, row = 0;
  while (v < v1 - 2.6 && out.length < max) {
    for (let u = u0 + 1.7; u < u1 - 1.2 && out.length < max; u += 2.75) {
      if (inside(u, v) && inside(u - 1.1, v - 2.2) && inside(u + 1.1, v + 2.2) && inside(u - 1.1, v + 2.2) && inside(u + 1.1, v - 2.2)) {
        out.push({ x: u * ux + v * vx, y: u * uy + v * vy, h: ang + Math.PI / 2 + (row % 2 ? Math.PI : 0) });
      }
    }
    v += row % 2 ? 6.4 : 5.2;
    row++;
  }
  return out;
}

export class GameRenderer {
  readonly view: MapView;
  overlay!: Overlay;
  layer!: ModelLayer;
  vs: ViewState = { selectedBuilding: -1, selectedTrip: null, selectedLink: -1, hoverBuilding: -1, hoverLink: -1, coverage: [], trafficView: false };
  dayNight = true;
  night = 0;
  private solids = new InstanceBuffer();
  private shadows = new InstanceBuffer();
  private slotCache = new Map<string, Slot[]>();
  private tripBorn = new Map<string, number>();
  private lastTraffic = 0;
  private lastRoles = 0;
  private rolesDirty = true;
  private lastLight = -1;
  private unsub: () => void;
  private mapStyle: MapStyle;
  private tint!: HTMLElement;

  constructor(private sim: Simulation, mapStyle: MapStyle) {
    this.view = new MapView(sim.world);
    this.mapStyle = mapStyle;
    this.unsub = sim.events.on((e) => this.onEvent(e));
  }

  async mount(wrapper: HTMLElement, mapEl: HTMLElement) {
    await this.view.mount(mapEl, this.mapStyle, this.sim.serviceRadius());
    if (!this.view.alive) return;
    this.tint = document.createElement('div');
    this.tint.className = 'night-tint';
    wrapper.appendChild(this.tint);
    this.overlay = new Overlay(wrapper);
    this.overlay.dark = this.mapStyle === 'dark';
    this.layer = new ModelLayer('apt-models', this.sim.world.proj, (l) => this.drawFrame(l));
    this.view.map.addLayer(this.layer);
    this.syncRoles();
    this.view.updateTraffic(this.sim.traffic);
  }

  private now() {
    return performance.now() / 1000;
  }

  private onEvent(e: GameEvent) {
    if (!this.overlay) return;
    const now = this.now();
    const fl = (x: number, y: number, z: number, text: string, color: string, life = 1.6) => this.overlay.floats.push({ x, y, z: visualHeight(z), text, color, born: now, life });
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
      case 'sale':
        fl(e.x, e.y, e.z, `car sold +$${e.amount.toLocaleString('en-US')}`, '#0d9488', 2);
        break;
      case 'activate': {
        const b = this.sim.world.buildings[e.building];
        this.overlay.pings.push({ x: b.cx, y: b.cy, color: '#e8a33d', born: now, life: 1.2 });
        this.rolesDirty = true;
        break;
      }
      case 'built': {
        const b = this.sim.world.buildings[e.building];
        this.overlay.pings.push({ x: b.cx, y: b.cy, color: STRUCTURES[e.kind].color, born: now, life: 1.4 });
        this.rolesDirty = true;
        break;
      }
      case 'incident':
        this.overlay.pings.push({ x: e.x, y: e.y, color: '#f07b2e', born: now, life: 0.8 });
        break;
      case 'removed':
      case 'upgraded':
        this.slotCache.clear();
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
    const t = this.now();
    if (this.rolesDirty || t - this.lastRoles > 1.5) { this.syncRoles(); this.lastRoles = t; }
    if (t - this.lastTraffic > 0.35) { this.view.updateTraffic(this.sim.traffic); this.lastTraffic = t; }
    this.updateLight();
    const v = this.vs;
    this.view.setHover(v.hoverBuilding);
    this.view.setSelected(v.selectedBuilding);
    this.view.highlightLink(v.selectedLink >= 0 ? v.selectedLink : v.hoverLink);
    this.view.map.triggerRepaint();
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
    this.tint.style.opacity = String(this.night * (this.mapStyle === 'dark' ? 0.3 : 0.5));
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

  private slots(st: Structure, max: number): Slot[] {
    const key = `${st.id}:${st.level}:${max}`;
    let s = this.slotCache.get(key);
    if (!s) {
      const b = this.sim.wb(st.building);
      s = b ? slotsFor(b.ring, max) : [];
      this.slotCache.set(key, s);
    }
    return s;
  }

  private drawFrame(layer: ModelLayer) {
    const sim = this.sim, s = sim.state;
    const zoom = this.view.map.getZoom();
    // cars grow when zoomed out so traffic stays readable at district scale
    const scale = clamp(Math.pow(2, (17.6 - zoom) * 0.85), 1, 3.2);
    const night = this.night;
    const lights = night > 0.35;
    const A = sim.alpha;
    const solids = this.solids, shadows = this.shadows;
    solids.reset();
    shadows.reset();

    // moving vehicles (interpolated between the last two sim ticks)
    for (const v of sim.vehicles.values()) {
      const h = lerpAngle(v.ph, v.h, A);
      const x = v.px + (v.x - v.px) * A, y = v.py + (v.y - v.py) * A;
      const grow = clamp((s.time - v.born) / 0.3, 0.35, 1);
      const k = scale * grow;
      const lx = x + Math.sin(h) * v.lane * scale, ly = y - Math.cos(h) * v.lane * scale;
      pushCar(solids, shadows, lx, ly, 0, h, k, v.kind === 'taxi' ? TAXI_COLOR : v.color, {
        taxi: v.kind === 'taxi', lights, braking: v.stopFor > 0 || v.speed < 6,
      });
    }

    // structures: parked cars, rooftop taxi ranks, showroom displays
    for (const st of Object.values(s.structures)) {
      const b = sim.wb(st.building);
      if (!b) continue;
      const z = STRUCT_HEIGHT(st);
      if (st.kind === 'parking') {
        const perDeck = parkingSpaces(b, 1);
        const slots = this.slots(st, perDeck);
        const parked = st.parked ?? [];
        const show = Math.min(slots.length, Math.ceil(parked.length / st.level));
        for (let i = 0; i < show; i++) pushCar(solids, shadows, slots[i].x, slots[i].y, z, slots[i].h, 1, parked[i].color);
      } else if (st.kind === 'taxi') {
        const idle = Math.max(0, (st.taxis ?? 0) - sim.taxisOut(st.id));
        const slots = this.slots(st, 12);
        for (let i = 0; i < Math.min(idle, slots.length); i++) pushCar(solids, shadows, slots[i].x, slots[i].y, z, slots[i].h, 1, TAXI_COLOR, { taxi: true });
      } else {
        const slots = this.slots(st, 8);
        for (let i = 0; i < Math.min(slots.length, 2 + st.level * 2); i++) pushCar(solids, shadows, slots[i].x, slots[i].y, z, slots[i].h + i * 0.4, 1, SHOWROOM[i % SHOWROOM.length]);
      }
    }

    // pedestrians walking the last stretch
    for (const p of sim.walkers) {
      const k = clamp((p.t + A * (1 / 60)) / p.dur, 0, 1);
      const x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k;
      pushPerson(solids, shadows, x, y, 0, Math.atan2(p.y1 - p.y0, p.x1 - p.x0), scale * 1.25, p.color);
    }
    layer.setInstances(solids.data, solids.n, shadows.data, shadows.n);

    if (layer.matrix) this.drawOverlay(layer.matrix, zoom, scale, lights);
  }

  private drawOverlay(m: Float64Array, zoom: number, scale: number, lights: boolean) {
    const sim = this.sim, s = sim.state, w = sim.world, o = this.overlay;
    const now = this.now();
    o.begin(m);

    if (lights) {
      o.ctx.globalCompositeOperation = 'lighter';
      for (const v of sim.vehicles.values()) o.headlight(v.x + Math.sin(v.h) * v.lane * scale, v.y - Math.cos(v.h) * v.lane * scale, v.h, scale, this.night);
      o.ctx.globalCompositeOperation = 'source-over';
    }

    for (const inc of s.incidents) o.incident(inc.x, inc.y, now);

    // selected trip: arc to the destination and the vehicle's remaining route
    const sel = this.vs.selectedTrip ? s.trips[this.vs.selectedTrip] : undefined;
    if (sel) {
      const a = sim.wb(sel.origin), b = sim.wb(sel.dest);
      if (a && b) {
        for (const v of sim.vehicles.values()) {
          if (v.trip !== sel.id) continue;
          const pts: number[] = [v.x, v.y];
          for (let i = v.ri; i < v.route.edges.length; i++) {
            const e = w.edges[v.route.edges[i]], l = w.links[e.link];
            const n = l.pts.length / 2;
            for (let k = 0; k < n; k++) {
              const j = e.dir === 1 ? k : n - 1 - k;
              pts.push(l.pts[j * 2], l.pts[j * 2 + 1]);
            }
          }
          o.polyline(pts, 1, 'rgba(232,163,61,0.95)', 4);
        }
        o.arc3(a.cx, a.cy, visualHeight(a.height) + 4, b.cx, b.cy, visualHeight(b.height) + 2, '#e8a33d');
        const f = o.project(b.cx, b.cy, visualHeight(b.height) + 2);
        if (f) o.glyph('flag', f[0] + 6, f[1] - 10, 20, '#e8a33d');
      }
    }

    // structure badges
    const showText = zoom >= 15.4;
    const hq = w.buildings[w.hq];
    o.badge(hq.cx, hq.cy, visualHeight(hq.height) + 12, 'crown', '#e8a33d', s.meta.company, showText);
    for (const st of Object.values(s.structures)) {
      const b = sim.wb(st.building);
      if (!b) continue;
      const z = STRUCT_HEIGHT(st) + 2;
      if (st.kind === 'parking') o.badge(b.cx, b.cy, z, 'p', STRUCTURES.parking.color, `${st.parked?.length ?? 0}/${parkingSpaces(b, st.level)}`, showText);
      else if (st.kind === 'taxi') o.badge(b.cx, b.cy, z, 'taxi', STRUCTURES.taxi.color, `${Math.max(0, (st.taxis ?? 0) - sim.taxisOut(st.id))}/${st.taxis ?? 0}`, showText);
      else o.badge(b.cx, b.cy, z, 'key', STRUCTURES.dealership.color, `${st.sales ?? 0} sold`, showText);
    }

    // riders waiting on rooftops
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
      o.bubble(t.id, b.cx, b.cy, visualHeight(b.height) + 3, n, frac, glyph, color, badge, t.id === this.vs.selectedTrip, pulse);
    }

    o.effects(now);
  }

  destroy() {
    this.unsub();
    this.overlay?.destroy();
    this.tint?.remove();
    this.view.destroy();
  }
}
