// The simulation: persistent GameState plus a runtime of moving vehicles and
// live traffic. Pure TypeScript with no DOM, so the same code can run on a
// server for multiplayer. All player actions arrive through `dispatch`.

import { clamp, pointAlong } from '../core/geo';
import { chance, rand, randRange } from '../core/rng';
import type { LinkPos, World, WorldBuilding } from '../world/types';
import {
  ACTIVATE_ON_ARRIVAL, CURB_INCIDENT, DIFFICULTY, DWELL, PARK_WALK_RADIUS, RATING, SERVICE_LEVELS, SIM_STEP, TAXI, TAXI_LOT_RADIUS, VIS_SPEED,
  WALK_SPEED, speedFactor,
} from './balance';
import { applyCommand, type Command, type CommandResult } from './commands';
import { parkingSpaces } from './content';
import { Emitter } from './events';
import { Router, type Route } from './router';
import { newId, type BuildingState, type Company, type GameState, type Structure, type Trip } from './state';
import { SYSTEMS } from './systems';

export type VehicleKind = 'car' | 'taxi' | 'npc';
export type VehicleTask = 'npc' | 'toLot' | 'home' | 'toPickup' | 'toDrop' | 'return';

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  task: VehicleTask;
  color: number;
  route: Route;
  ri: number;
  pos: number;
  speed: number;
  edge: number;
  stopFor: number;
  trip?: string;
  depot?: string | null;
  lot?: string;
  home?: string;
  curb: boolean;
  /** lateral offset from the centre line, metres at 1× model scale (positive = right) */
  lane: number;
  /** game minute spawned (renderer grows new cars in) */
  born: number;
  x: number; y: number; h: number;
  px: number; py: number; ph: number;
}

export interface Walker {
  x0: number; y0: number; x1: number; y1: number;
  t: number;
  dur: number;
  color: number;
}

const scratch = { x: 0, y: 0, h: 0 };

export class Simulation {
  readonly events = new Emitter();
  readonly router: Router;
  readonly vehicles = new Map<number, Vehicle>();
  walkers: Walker[] = [];
  /** vehicles currently on each directed edge */
  readonly load: Float32Array;
  /** smoothed congestion 0..1 per directed edge */
  readonly traffic: Float32Array;
  readonly incidentSlow: Float32Array;
  /** free-flow speed per directed edge, metres per game minute */
  readonly freeSpeed: Float32Array;
  readonly activeList: number[] = [];
  readonly structureAt = new Map<string, string>();
  readonly lotReserved = new Map<string, number>();
  readonly tripsFrom = new Map<string, number>();
  /** links NPC traffic may start or end on */
  readonly npcLinks: number[];
  /** render interpolation between the last two ticks */
  alpha = 1;
  /** one-shot warnings, so they fire once per episode rather than every check */
  readonly flags = { warnedDebt: false };
  private nextVid = 1;
  private acc = 0;
  private sysAcc: number[];
  private activeDirty = true;

  constructor(readonly world: World, public state: GameState) {
    const nE = world.edges.length;
    this.load = new Float32Array(nE);
    this.traffic = new Float32Array(nE);
    this.incidentSlow = new Float32Array(nE);
    this.freeSpeed = new Float32Array(nE);
    let maxKmh = 0;
    for (const e of world.edges) {
      const l = world.links[e.link];
      this.freeSpeed[e.idx] = l.kmh * VIS_SPEED;
      maxKmh = Math.max(maxKmh, l.kmh);
    }
    this.router = new Router(world, Math.max(1, maxKmh * VIS_SPEED));
    this.npcLinks = world.links.filter((l) => l.cls !== 'service' && l.length > 25).map((l) => l.idx);
    this.sysAcc = SYSTEMS.map((s, i) => (i * 0.137) % s.every);
    this.rebuildIndexes();
    this.recomputeIncidents();
  }

  // ---------- accessors ----------

  get me(): Company {
    return this.state.companies[this.state.localPlayer];
  }

  serviceRadius() {
    return Math.min(this.world.radius, SERVICE_LEVELS[this.state.serviceLevel].radius);
  }

  inService(b: WorldBuilding) {
    return Math.hypot(b.cx, b.cy) <= this.serviceRadius();
  }

  wb(id: string): WorldBuilding | undefined {
    const i = this.world.buildingById.get(id);
    return i === undefined ? undefined : this.world.buildings[i];
  }

  bstate(id: string): BuildingState | undefined {
    return this.state.buildings[id];
  }

  difficulty() {
    return DIFFICULTY[this.state.meta.difficulty];
  }

  lanesOf(link: number) {
    const l = this.world.links[link];
    return l.lanes + (this.state.roads[l.id] ?? 0);
  }

  edgeSpeed(e: number) {
    return this.freeSpeed[e] * speedFactor(this.traffic[e]);
  }

  readonly edgeCost = (e: number) => this.world.edges[e].length / Math.max(0.5, this.edgeSpeed(e));

  getActive(): number[] {
    if (this.activeDirty) {
      this.activeList.length = 0;
      for (const [id, s] of Object.entries(this.state.buildings)) {
        if (!s.active) continue;
        const i = this.world.buildingById.get(id);
        if (i !== undefined && this.world.buildings[i].playable) this.activeList.push(i);
      }
      this.activeDirty = false;
    }
    return this.activeList;
  }

  markActiveDirty() {
    this.activeDirty = true;
  }

  rebuildIndexes() {
    this.structureAt.clear();
    for (const s of Object.values(this.state.structures)) this.structureAt.set(s.building, s.id);
    this.tripsFrom.clear();
    for (const t of Object.values(this.state.trips)) this.tripsFrom.set(t.origin, (this.tripsFrom.get(t.origin) ?? 0) + 1);
    this.activeDirty = true;
  }

  structuresOf(kind: Structure['kind']) {
    return Object.values(this.state.structures).filter((s) => s.kind === kind);
  }

  lotFree(s: Structure) {
    const b = this.wb(s.building);
    if (!b) return 0;
    return parkingSpaces(b, s.level) - (s.parked?.length ?? 0) - (this.lotReserved.get(s.id) ?? 0);
  }

  taxisOut(depot: string) {
    let n = 0;
    for (const v of this.vehicles.values()) if (v.kind === 'taxi' && v.depot === depot) n++;
    return n;
  }

  // ---------- main loop ----------

  dispatch(cmd: Command, by = this.state.localPlayer): CommandResult {
    return applyCommand(this, cmd, by);
  }

  /** Advance by real seconds; returns the number of fixed ticks run. */
  frame(dtReal: number): number {
    const s = this.state;
    if (s.gameOver || s.speed <= 0) return 0;
    s.meta.playMs += dtReal * 1000;
    this.acc += Math.min(dtReal, 0.25) * s.speed;
    let steps = 0;
    while (this.acc >= SIM_STEP && steps < 24) {
      this.tick(SIM_STEP);
      this.acc -= SIM_STEP;
      steps++;
    }
    if (steps >= 24) this.acc = 0;
    this.alpha = this.acc / SIM_STEP;
    return steps;
  }

  tick(dt: number) {
    this.state.time += dt;
    this.moveVehicles(dt);
    if (this.walkers.length) {
      for (const w of this.walkers) w.t += dt;
      this.walkers = this.walkers.filter((w) => w.t < w.dur);
    }
    for (let i = 0; i < SYSTEMS.length; i++) {
      const sys = SYSTEMS[i];
      this.sysAcc[i] += dt;
      if (this.sysAcc[i] >= sys.every) {
        this.sysAcc[i] -= sys.every;
        sys.run(this, sys.every);
        if (this.state.gameOver) return;
      }
    }
  }

  // ---------- vehicles ----------

  spawnVehicle(kind: Vehicle['kind'], task: VehicleTask, from: LinkPos, to: LinkPos, color: number, extra: Partial<Vehicle> = {}): Vehicle | null {
    const route = this.router.route(from, to, this.edgeCost);
    if (!route) return null;
    const v: Vehicle = {
      id: this.nextVid++, kind, task, color, route, ri: 0, pos: route.startOffset, speed: 0, edge: -1, stopFor: 0,
      curb: false, lane: 0, born: this.state.time, x: 0, y: 0, h: 0, px: 0, py: 0, ph: 0, ...extra,
    };
    this.enterEdge(v, route.edges[0]);
    this.updatePos(v);
    v.px = v.x; v.py = v.y; v.ph = v.h;
    this.vehicles.set(v.id, v);
    return v;
  }

  /** Where a vehicle currently is, as a road position (for re-routing mid-trip). */
  vehiclePos(v: Vehicle): LinkPos {
    const e = this.world.edges[v.edge];
    return { link: e.link, offset: e.dir === 1 ? v.pos : e.length - v.pos };
  }

  reroute(v: Vehicle, to: LinkPos): boolean {
    const route = this.router.route(this.vehiclePos(v), to, this.edgeCost);
    if (!route) return false;
    this.leaveEdge(v);
    v.route = route;
    v.ri = 0;
    v.pos = route.startOffset;
    v.curb = false;
    this.enterEdge(v, route.edges[0]);
    return true;
  }

  despawn(v: Vehicle) {
    this.leaveEdge(v);
    this.vehicles.delete(v.id);
  }

  private enterEdge(v: Vehicle, e: number) {
    v.edge = e;
    this.load[e] += 1;
  }

  private leaveEdge(v: Vehicle) {
    if (v.edge >= 0) this.load[v.edge] = Math.max(0, this.load[v.edge] - (v.curb ? 2 : 1));
    v.edge = -1;
  }

  private updatePos(v: Vehicle) {
    const e = this.world.edges[v.edge];
    const l = this.world.links[e.link];
    const along = e.dir === 1 ? v.pos : e.length - v.pos;
    pointAlong(l.pts, l.cum, along, scratch);
    v.x = scratch.x;
    v.y = scratch.y;
    v.h = e.dir === 1 ? scratch.h : scratch.h + Math.PI;
    const lanes = this.lanesOf(e.link);
    if (v.curb) v.lane = l.oneway ? lanes * 1.6 + 0.6 : 3.4;
    else if (l.oneway) v.lane = ((v.id % lanes) - (lanes - 1) / 2) * 3.1;
    else v.lane = 1.7 + (lanes > 1 ? (v.id % lanes) * 3.1 : 0);
  }

  private moveVehicles(dt: number) {
    const edges = this.world.edges;
    for (const v of this.vehicles.values()) {
      v.px = v.x; v.py = v.y; v.ph = v.h;
      if (v.stopFor > 0) {
        v.stopFor -= dt;
        v.speed = 0;
        if (v.stopFor <= 0) this.afterStop(v);
        continue;
      }
      let e = v.route.edges[v.ri];
      let last = v.ri === v.route.edges.length - 1;
      let end = last ? v.route.endOffset : edges[e].length;
      let target = this.edgeSpeed(e);
      if (last) {
        const remain = end - v.pos;
        if (remain < 30) target = Math.min(target, 5 + remain * 1.6);
      }
      v.speed += (target - v.speed) * Math.min(1, dt * 5);
      v.pos += Math.max(1, v.speed) * dt;
      let arrived = false;
      while (v.pos >= end) {
        if (last) { v.pos = end; arrived = true; break; }
        v.pos -= edges[e].length;
        this.leaveEdge(v);
        v.ri++;
        e = v.route.edges[v.ri];
        this.enterEdge(v, e);
        last = v.ri === v.route.edges.length - 1;
        end = last ? v.route.endOffset : edges[e].length;
      }
      this.updatePos(v);
      if (arrived) this.arrive(v);
    }
  }

  private arrive(v: Vehicle) {
    const s = this.state;
    switch (v.task) {
      case 'npc':
      case 'home':
        this.despawn(v);
        return;
      case 'toLot': {
        const trip = v.trip ? s.trips[v.trip] : undefined;
        const lot = v.lot ? s.structures[v.lot] : undefined;
        this.lotReserved.set(v.lot!, Math.max(0, (this.lotReserved.get(v.lot!) ?? 1) - 1));
        this.despawn(v);
        if (!trip) return;
        if (!lot) { this.failTrip(trip, 'parking'); return; }
        const lotB = this.wb(lot.building)!, dest = this.wb(trip.dest)!;
        lot.parked ??= [];
        lot.parked.push({ home: trip.origin, until: s.time + randRange(s.rng, DWELL.min, DWELL.max), color: v.color });
        const fee = lot.fee ?? 0;
        lot.revenue += fee;
        const walk = Math.hypot(lotB.cx - dest.cx, lotB.cy - dest.cy);
        this.walk(lotB.cx, lotB.cy, dest.cx, dest.cy, v.color);
        const price = fee === 0 ? -0.15 : (Math.max(0, fee - 6) / 20) * 1.3;
        this.completeTrip(trip, 'car', s.time - (trip.departedAt ?? s.time), walk, price, fee, lotB, false);
        return;
      }
      case 'toPickup': {
        v.stopFor = TAXI.pickupStop;
        return;
      }
      case 'toDrop': {
        const trip = v.trip ? s.trips[v.trip] : undefined;
        v.curb = !v.lot;
        if (v.curb) {
          // kerbside drop: the stopped taxi holds up the lane for a while
          this.load[v.edge] += 1;
          this.updatePos(v);
          const e = this.world.edges[v.edge];
          const link = this.world.links[e.link];
          s.incidents.push({ id: newId(s, 'i'), link: link.id, edge: v.edge, x: v.x, y: v.y, until: s.time + CURB_INCIDENT.minutes });
          this.recomputeIncidents();
          this.events.emit({ type: 'incident', link: e.link, x: v.x, y: v.y });
          s.stats.curbDrops++;
        } else {
          s.stats.lotDrops++;
        }
        v.stopFor = v.curb ? TAXI.curbStop : TAXI.lotStop;
        if (trip) {
          const dest = this.wb(trip.dest)!;
          const fare = Math.round((TAXI.base + (TAXI.perKm * v.route.length) / 1000) * s.fareMult);
          const walk = Math.hypot(v.x - dest.cx, v.y - dest.cy);
          this.walk(v.x, v.y, dest.cx, dest.cy, 0xf5b82e);
          const depot = v.depot ? s.structures[v.depot] : undefined;
          if (depot) depot.revenue += fare;
          this.completeTrip(trip, 'taxi', s.time - (trip.departedAt ?? s.time), Math.max(0, walk - 40), (s.fareMult - 1) * 1.0, fare, dest, v.curb);
          v.trip = undefined;
        }
        return;
      }
      case 'return':
        this.despawn(v);
        return;
    }
  }

  private afterStop(v: Vehicle) {
    const s = this.state;
    if (v.task === 'toPickup') {
      const trip = v.trip ? s.trips[v.trip] : undefined;
      if (!trip) { this.sendTaxiHome(v); return; }
      const dest = this.wb(trip.dest)!;
      // prefer a lot near the destination: no traffic penalty for the drop-off
      const lot = this.nearestLot(dest, TAXI_LOT_RADIUS, false);
      const target = lot ? this.wb(lot.building)!.access! : dest.access!;
      trip.status = 'riding';
      trip.departedAt = s.time;
      v.task = 'toDrop';
      // no lot near the destination means a kerbside drop on arrival
      v.lot = lot?.id;
      if (!this.reroute(v, target)) { this.failTrip(trip, null); this.sendTaxiHome(v); }
      return;
    }
    if (v.task === 'toDrop') {
      if (v.curb) this.load[v.edge] = Math.max(0, this.load[v.edge] - 1);
      v.curb = false;
      this.sendTaxiHome(v);
    }
  }

  sendTaxiHome(v: Vehicle) {
    v.task = 'return';
    v.trip = undefined;
    const depot = v.depot ? this.state.structures[v.depot] : undefined;
    const b = depot ? this.wb(depot.building) : undefined;
    if (!b?.access || !this.reroute(v, b.access)) this.despawn(v);
  }

  nearestLot(dest: WorldBuilding, radius: number, needSpace: boolean): Structure | null {
    let best: Structure | null = null, bestScore = Infinity;
    for (const s of Object.values(this.state.structures)) {
      if (s.kind !== 'parking') continue;
      const b = this.wb(s.building);
      if (!b?.access) continue;
      const d = Math.hypot(b.cx - dest.cx, b.cy - dest.cy);
      if (d > radius) continue;
      if (needSpace && this.lotFree(s) <= 0) continue;
      const score = d + (needSpace ? (s.fee ?? 0) * 8 : 0);
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  // ---------- trips ----------

  walk(x0: number, y0: number, x1: number, y1: number, color: number) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 3) return;
    this.walkers.push({ x0, y0, x1, y1, t: 0, dur: d / WALK_SPEED, color });
  }

  removeTrip(trip: Trip) {
    delete this.state.trips[trip.id];
    const n = (this.tripsFrom.get(trip.origin) ?? 1) - 1;
    if (n > 0) this.tripsFrom.set(trip.origin, n); else this.tripsFrom.delete(trip.origin);
  }

  private rate(score: number) {
    const c = this.me;
    c.rating = clamp(c.rating + (score - c.rating) * RATING.alpha(this.state.stats.served), 1, 5);
  }

  completeTrip(trip: Trip, mode: 'car' | 'taxi', rideMin: number, walkM: number, price: number, amount: number, at: WorldBuilding, curb: boolean) {
    const s = this.state;
    const o = this.wb(trip.origin)!, d = this.wb(trip.dest)!;
    let score = 5 - (trip.waited / trip.patience) * 2.2;
    const ideal = Math.max(1, (Math.hypot(o.cx - d.cx, o.cy - d.cy) * 1.3) / (32 * VIS_SPEED));
    score -= clamp((rideMin / ideal - 1.4) * 0.5, 0, 1.2);
    score -= (walkM / PARK_WALK_RADIUS) * 0.6;
    score -= price;
    score = clamp(score, 1, 5);
    this.rate(score);
    s.stats.served++;
    s.stats.today.served++;
    if (mode === 'car') s.stats.carTrips++; else s.stats.taxiTrips++;
    if (amount > 0) this.earn(amount);
    this.removeTrip(trip);
    // a satisfied destination joins the network and starts sending its own riders
    const ds = s.buildings[trip.dest];
    if (d.playable && this.inService(d) && !this.structureAt.has(d.id) && !ds?.active && this.roll(ACTIVATE_ON_ARRIVAL)) this.activate(d);
    this.events.emit({ type: 'trip:done', trip: trip.id, mode, score, amount, x: at.cx, y: at.cy, z: at.height + 8, curb });
  }

  failTrip(trip: Trip, reason: Trip['reason']) {
    const s = this.state;
    this.rate(RATING.failScore);
    s.stats.failed++;
    s.stats.today.failed++;
    this.removeTrip(trip);
    for (const v of this.vehicles.values()) {
      if (v.trip !== trip.id) continue;
      v.trip = undefined;
      if (v.kind === 'taxi') this.sendTaxiHome(v);
    }
    const o = this.wb(trip.origin);
    this.events.emit({ type: 'trip:fail', trip: trip.id, reason, x: o?.cx ?? 0, y: o?.cy ?? 0, z: (o?.height ?? 0) + 8 });
  }

  activate(b: WorldBuilding) {
    const s = this.state;
    const prev = s.buildings[b.id];
    const kindCar = b.kind === 'house' ? 1.25 : b.kind === 'apartment' ? 0.9 : b.kind === 'office' ? 0.8 : 1;
    s.buildings[b.id] = {
      active: true,
      since: s.time,
      car: prev?.car ?? clamp(this.world.baseCarOwnership * kindCar * randRange(s.rng, 0.7, 1.3), 0.05, 0.9),
    };
    this.activeDirty = true;
    this.events.emit({ type: 'activate', building: b.idx });
  }

  deactivate(id: string) {
    const st = this.state.buildings[id];
    if (st) st.active = false;
    this.activeDirty = true;
  }

  earn(amount: number) {
    const c = this.me;
    c.money += amount;
    c.revenue += amount;
    this.state.stats.today.revenue += amount;
  }

  /** Returns false (and spends nothing) if the company can't afford it. */
  spend(amount: number, company = this.me): boolean {
    if (company.money < amount) return false;
    company.money -= amount;
    company.expenses += amount;
    this.state.stats.today.expenses += amount;
    return true;
  }

  charge(amount: number) {
    const c = this.me;
    c.money -= amount;
    c.expenses += amount;
    this.state.stats.today.expenses += amount;
  }

  // ---------- traffic ----------

  recomputeIncidents() {
    this.incidentSlow.fill(0);
    const w = this.world;
    for (const inc of this.state.incidents) {
      const e = w.edges[inc.edge];
      if (!e) continue;
      this.incidentSlow[inc.edge] = 1 - (1 - this.incidentSlow[inc.edge]) * (1 - CURB_INCIDENT.slow);
      for (const other of w.linkEdges[e.link]) {
        if (other !== inc.edge) this.incidentSlow[other] = 1 - (1 - this.incidentSlow[other]) * (1 - CURB_INCIDENT.reverseSlow);
      }
    }
  }

  /** Length-weighted congestion on roads that carry any traffic. */
  congestionIndex(): number {
    let sum = 0, wsum = 0;
    for (let e = 0; e < this.traffic.length; e++) {
      const t = this.traffic[e];
      if (t < 0.02) continue;
      const len = this.world.edges[e].length;
      sum += t * len;
      wsum += len;
    }
    return wsum > 0 ? sum / wsum : 0;
  }

  // ---------- misc ----------

  randomColor() {
    const palette = [0xf8fafc, 0x1f2937, 0x9ca3af, 0xdc2626, 0x2563eb, 0x0f766e, 0x7c3aed, 0xea580c, 0x64748b, 0xe2e8f0, 0x334155, 0xbe123c];
    return palette[Math.floor(rand(this.state.rng) * palette.length)];
  }

  roll(p: number) {
    return chance(this.state.rng, p);
  }
}
