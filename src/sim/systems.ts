// Periodic systems, run in order on fixed game-minute intervals. A new
// mechanic is a new entry here; each one reads and writes the Simulation.

import { clamp } from '../core/geo';
import { pick, poisson, randRange, weightedPick } from '../core/rng';
import type { WorldBuilding } from '../world/types';
import {
  BANKRUPT_AT, BASE_LOAD, CAR_SPACE, DEALER, JAM_OCCUPANCY, MAX_TRIP, MAX_WAITING, MIN_TRIP, NPC, PARK_WALK_RADIUS,
  PATIENCE, PATIENCE_ASSIGNED_RATE, RATING, activityCurve, rushCurve,
} from './balance';
import { GOALS, STRUCTURES, dealerRadius } from './content';
import type { Simulation, Vehicle } from './simulation';
import { dayOf, hourOf, newId, type Structure, type Trip } from './state';

export interface SimSystem {
  id: string;
  every: number;
  run(sim: Simulation, dt: number): void;
}

const NPC_COLORS = [0xe5e7eb, 0x9ca3af, 0x4b5563, 0x1f2937, 0xf8fafc, 0x94a3b8, 0x7f1d1d, 0x1e3a8a, 0xcbd5e1];
const TAXI_COLOR = 0xf5b82e;

// ---------- traffic ----------

function trafficSystem(sim: Simulation) {
  const s = sim.state, w = sim.world;
  const before = s.incidents.length;
  if (before) {
    s.incidents = s.incidents.filter((i) => i.until > s.time);
    if (s.incidents.length !== before) sim.recomputeIncidents();
  }
  const hour = hourOf(s.time);
  const rush = rushCurve(hour), act = activityCurve(hour);
  for (const e of w.edges) {
    const link = w.links[e.link];
    const lanes = sim.lanesOf(e.link);
    const occ = (sim.load[e.idx] * CAR_SPACE) / (Math.max(35, e.length) * lanes);
    const c = Math.min(1, occ / JAM_OCCUPANCY);
    const [b0, b1] = BASE_LOAD[link.cls];
    const base = (b0 * act + b1 * rush) / (1 + (lanes - link.lanes) * 0.6);
    const target = 1 - (1 - c) * (1 - base) * (1 - sim.incidentSlow[e.idx]);
    sim.traffic[e.idx] += (target - sim.traffic[e.idx]) * 0.35;
  }
}

// ---------- riders ----------

function patienceSystem(sim: Simulation, dt: number) {
  for (const trip of Object.values(sim.state.trips)) {
    if (trip.status === 'riding') continue;
    trip.waited += dt * (trip.status === 'pickup' ? PATIENCE_ASSIGNED_RATE : 1);
    if (trip.waited >= trip.patience) sim.failTrip(trip, trip.reason);
  }
}

interface TaxiPick { depot?: Structure; vehicle?: Vehicle; d: number }

function assignSystem(sim: Simulation) {
  const s = sim.state;
  const waiting = Object.values(s.trips).filter((t) => t.status === 'waiting').sort((a, b) => a.createdAt - b.createdAt);
  if (!waiting.length) return;
  const depots = sim.structuresOf('taxi');
  const out = new Map<string, number>();
  const returning: Vehicle[] = [];
  for (const v of sim.vehicles.values()) {
    if (v.kind !== 'taxi') continue;
    if (v.depot) out.set(v.depot, (out.get(v.depot) ?? 0) + 1);
    if (v.task === 'return') returning.push(v);
  }

  for (const trip of waiting) {
    const o = sim.wb(trip.origin), d = sim.wb(trip.dest);
    if (!o?.access || !d?.access) { sim.removeTrip(trip); continue; }

    if (trip.hasCar) {
      const lot = sim.nearestLot(d, PARK_WALK_RADIUS, true);
      if (lot) {
        const lotB = sim.wb(lot.building)!;
        const v = sim.spawnVehicle('car', 'toLot', o.access, lotB.access!, sim.randomColor(), { trip: trip.id, lot: lot.id });
        if (v) {
          sim.lotReserved.set(lot.id, (sim.lotReserved.get(lot.id) ?? 0) + 1);
          trip.status = 'riding';
          trip.mode = 'car';
          trip.departedAt = s.time;
          trip.reason = null;
          continue;
        }
      }
      // the tutorial's driver waits for a lot so the player learns parking
      if (trip.scripted) { trip.reason = 'parking'; continue; }
    }

    let best: TaxiPick | null = null;
    for (const dep of depots) {
      if ((dep.taxis ?? 0) - (out.get(dep.id) ?? 0) <= 0) continue;
      const b = sim.wb(dep.building);
      if (!b?.access) continue;
      const dd = Math.hypot(b.access.x - o.access.x, b.access.y - o.access.y);
      if (!best || dd < best.d) best = { depot: dep, d: dd };
    }
    for (const v of returning) {
      if (v.task !== 'return') continue;
      const dd = Math.hypot(v.x - o.access.x, v.y - o.access.y) * 0.95;
      if (!best || dd < best.d) best = { vehicle: v, d: dd };
    }

    if (best?.vehicle) {
      const v = best.vehicle;
      v.task = 'toPickup';
      v.trip = trip.id;
      if (!sim.reroute(v, o.access)) { sim.sendTaxiHome(v); trip.reason = 'taxi'; continue; }
    } else if (best?.depot) {
      const b = sim.wb(best.depot.building)!;
      const v = sim.spawnVehicle('taxi', 'toPickup', b.access!, o.access, TAXI_COLOR, { trip: trip.id, depot: best.depot.id });
      if (!v) { trip.reason = 'taxi'; continue; }
      out.set(best.depot.id, (out.get(best.depot.id) ?? 0) + 1);
    } else {
      trip.reason = trip.hasCar ? 'parking' : 'taxi';
      continue;
    }
    trip.status = 'pickup';
    trip.mode = 'taxi';
    trip.reason = null;
  }
}

function npcSystem(sim: Simulation) {
  const s = sim.state, w = sim.world;
  if (!sim.npcLinks.length) return;
  const target = Math.min(NPC.max, (NPC.base + NPC.perActive * sim.getActive().length) * activityCurve(hourOf(s.time)));
  let n = 0;
  for (const v of sim.vehicles.values()) if (v.kind === 'npc') n++;
  for (let k = 0; k < 3 && n < target; k++) {
    const a = w.links[pick(s.rng, sim.npcLinks)];
    const from = { link: a.idx, offset: randRange(s.rng, 0, a.length) };
    for (let tries = 0; tries < 6; tries++) {
      const b = w.links[pick(s.rng, sim.npcLinks)];
      const d = Math.hypot(b.pts[0] - a.pts[0], b.pts[1] - a.pts[1]);
      if (d < 250 || d > 1600) continue;
      if (sim.spawnVehicle('npc', 'npc', from, { link: b.idx, offset: randRange(s.rng, 0, b.length) }, pick(s.rng, NPC_COLORS), {})) n++;
      break;
    }
  }
}

function eligible(sim: Simulation, b: WorldBuilding, exclude: number) {
  return b.playable && b.idx !== exclude && b.idx !== sim.world.hq && !sim.structureAt.has(b.id) && sim.inService(b);
}

function pickDestination(sim: Simulation, o: WorldBuilding): WorldBuilding | null {
  const s = sim.state, w = sim.world;
  const active = sim.getActive();
  const within = (b: WorldBuilding) => {
    const d = Math.hypot(b.cx - o.cx, b.cy - o.cy);
    return d >= MIN_TRIP && d <= MAX_TRIP;
  };
  const pNew = clamp(0.4 - active.length / 200, 0.1, 0.4);
  if (sim.roll(pNew)) {
    const cand = w.buildingGrid.queryRadius(o.cx, o.cy, 750)
      .map((i) => w.buildings[i])
      .filter((b) => eligible(sim, b, o.idx) && !s.buildings[b.id]?.active && within(b));
    if (cand.length) return pick(s.rng, cand);
  }
  const d = weightedPick(s.rng, active.map((i) => w.buildings[i]).filter((b) => eligible(sim, b, o.idx)), (b) => {
    const dd = Math.hypot(b.cx - o.cx, b.cy - o.cy);
    return dd < MIN_TRIP || dd > MAX_TRIP ? 0 : b.attract / (1 + dd / 450);
  });
  if (d) return d;
  const cand = w.buildingGrid.queryRadius(o.cx, o.cy, MAX_TRIP).map((i) => w.buildings[i]).filter((b) => eligible(sim, b, o.idx) && within(b));
  return cand.length ? pick(s.rng, cand) : null;
}

function createTrip(sim: Simulation, o: WorldBuilding, opts: { dest?: WorldBuilding; hasCar?: boolean; patience?: number; scripted?: boolean } = {}): Trip | null {
  const dest = opts.dest ?? pickDestination(sim, o);
  if (!dest) return null;
  const s = sim.state;
  const car = s.buildings[o.id]?.car ?? sim.world.baseCarOwnership;
  const trip: Trip = {
    id: newId(s, 't'),
    origin: o.id,
    dest: dest.id,
    createdAt: s.time,
    patience: opts.patience ?? PATIENCE * sim.difficulty().patience * randRange(s.rng, 0.8, 1.25),
    waited: 0,
    hasCar: opts.hasCar ?? sim.roll(car),
    status: 'waiting',
    reason: null,
    scripted: opts.scripted,
  };
  s.trips[trip.id] = trip;
  sim.tripsFrom.set(o.id, (sim.tripsFrom.get(o.id) ?? 0) + 1);
  sim.events.emit({ type: 'trip:new', trip: trip.id, origin: o.idx, dest: dest.idx, hasCar: trip.hasCar });
  return trip;
}

function demandSystem(sim: Simulation, dt: number) {
  const s = sim.state, w = sim.world;
  if (s.tutorial >= 0 && s.tutorial <= 3) return; // the tutorial scripts the first riders
  let open = Object.keys(s.trips).length;
  if (open >= MAX_WAITING) return;
  const hour = hourOf(s.time);
  const act = activityCurve(hour), rush = rushCurve(hour);
  const active = sim.getActive();
  // a big network keeps growing in demand, but sub-linearly, so a well-run company can keep up
  const mult = ((0.7 + 0.12 * sim.me.rating) * sim.difficulty().demand) / Math.sqrt(1 + active.length / 30);
  const morning = hour < 12;
  for (const bi of active) {
    const b = w.buildings[bi];
    if (sim.structureAt.has(b.id) || (sim.tripsFrom.get(b.id) ?? 0) >= 2) continue;
    const home = b.kind === 'house' || b.kind === 'apartment' || b.kind === 'hotel';
    const bias = home === morning ? 1 + rush * 0.9 : 1 - rush * 0.35;
    if (sim.roll((b.trips * act * bias * mult * dt) / 60) && createTrip(sim, b) && ++open >= MAX_WAITING) break;
  }
}

// ---------- tutorial ----------

function tutorialSystem(sim: Simulation) {
  const s = sim.state;
  if (s.tutorial < 1 || s.tutorial > 3) return;
  const scripted = Object.values(s.trips).filter((t) => t.scripted);
  if (s.tutorial === 1) {
    if (sim.structuresOf('taxi').length) { s.tutorial = 2; return; }
    if (!scripted.length) scriptTrip(sim, false);
  } else if (s.tutorial === 2) {
    if (s.stats.served >= 1) { s.tutorial = 3; scriptTrip(sim, true); return; }
    if (!scripted.length) scriptTrip(sim, false);
  } else if (s.tutorial === 3) {
    if (!scripted.length) s.tutorial = 4;
  }
}

function scriptTrip(sim: Simulation, hasCar: boolean) {
  const w = sim.world;
  const active = sim.getActive().map((i) => w.buildings[i]).filter((b) => !sim.structureAt.has(b.id));
  if (!active.length) return;
  const hq = w.buildings[w.hq];
  active.sort((a, b) => Math.hypot(a.cx - hq.cx, a.cy - hq.cy) - Math.hypot(b.cx - hq.cx, b.cy - hq.cy));
  const o = active.find((b) => b.kind === 'house' || b.kind === 'apartment') ?? active[0];
  const cand = w.buildingGrid.queryRadius(o.cx, o.cy, 480).map((i) => w.buildings[i]).filter((b) => {
    const d = Math.hypot(b.cx - o.cx, b.cy - o.cy);
    return eligible(sim, b, o.idx) && d > 200 && (!hasCar || !sim.nearestLot(b, PARK_WALK_RADIUS, false));
  });
  if (!cand.length) return;
  cand.sort((a, b) => b.attract - a.attract);
  createTrip(sim, o, { dest: cand[0], hasCar, patience: 600, scripted: true });
}

// ---------- structures ----------

function parkingSystem(sim: Simulation) {
  const s = sim.state;
  for (const lot of sim.structuresOf('parking')) {
    if (!lot.parked?.length) continue;
    const lotB = sim.wb(lot.building);
    const keep = [];
    for (const p of lot.parked) {
      if (p.until > s.time) { keep.push(p); continue; }
      const home = sim.wb(p.home);
      if (home?.access && lotB?.access) sim.spawnVehicle('car', 'home', lotB.access, home.access, p.color, { home: p.home });
    }
    lot.parked = keep;
  }
}

function dealerSystem(sim: Simulation, dt: number) {
  const s = sim.state, w = sim.world;
  for (const d of sim.structuresOf('dealership')) {
    const b = sim.wb(d.building);
    if (!b) continue;
    const r = dealerRadius(d.level);
    for (const bi of w.buildingGrid.queryRadius(b.cx, b.cy, r)) {
      const c = w.buildings[bi];
      const st = s.buildings[c.id];
      if (!st?.active || st.car >= DEALER.cap) continue;
      if (Math.hypot(c.cx - b.cx, c.cy - b.cy) > r) continue;
      const p = DEALER.rate * (DEALER.cap - st.car) * Math.min(2, c.trips) * (dt / 60) * (1 + 0.3 * (d.level - 1));
      if (!sim.roll(p)) continue;
      st.car = Math.min(DEALER.cap, st.car + randRange(s.rng, 0.05, 0.12));
      const amount = Math.round(DEALER.saleProfit * (1 + 0.15 * (d.level - 1)));
      sim.earn(amount);
      d.revenue += amount;
      d.sales = (d.sales ?? 0) + 1;
      s.stats.carsSold++;
      sim.events.emit({ type: 'sale', structure: d.id, amount, x: b.cx, y: b.cy, z: b.height + 10 });
    }
  }
}

// ---------- progression ----------

function goalSystem(sim: Simulation) {
  const s = sim.state;
  for (const g of GOALS) {
    if (s.goals.includes(g.id) || !g.check(s)) continue;
    s.goals.push(g.id);
    if (g.reward) sim.earn(g.reward);
    sim.events.emit({ type: 'goal', goal: g });
  }
}

function activateNearNetwork(sim: Simulation): boolean {
  const s = sim.state, w = sim.world;
  const active = sim.getActive();
  const anchor = active.length ? w.buildings[pick(s.rng, active)] : w.buildings[w.hq];
  const cand = w.buildingGrid.queryRadius(anchor.cx, anchor.cy, 260)
    .map((i) => w.buildings[i])
    .filter((b) => eligible(sim, b, -1) && !s.buildings[b.id]?.active);
  if (!cand.length) return false;
  sim.activate(pick(s.rng, cand));
  return true;
}

function growthSystem(sim: Simulation) {
  const s = sim.state;
  if (s.tutorial >= 0 && s.tutorial <= 3) return;
  const r = sim.me.rating;
  const n = poisson(s.rng, 0.35 * Math.max(0, r - 2.2));
  for (let i = 0; i < n; i++) activateNearNetwork(sim);
  if (r < 2.2 && sim.roll((2.2 - r) * 0.35)) {
    const active = sim.getActive().filter((i) => !sim.tripsFrom.has(sim.world.buildings[i].id));
    if (active.length > 3) {
      const b = sim.world.buildings[pick(s.rng, active)];
      sim.deactivate(b.id);
      sim.events.emit({ type: 'notice', level: 'warn', text: `${b.name} stopped calling you. Ratings are hurting business.`, focus: { x: b.cx, y: b.cy } });
    }
  }
}

function statsSystem(sim: Simulation) {
  const s = sim.state;
  s.history.push({ t: s.time, traffic: sim.congestionIndex(), money: sim.me.money, rating: sim.me.rating, waiting: Object.keys(s.trips).length });
  if (s.history.length > 96) s.history.splice(0, s.history.length - 96);
}

function calendarSystem(sim: Simulation) {
  const s = sim.state;
  const day = dayOf(s.time);
  const last = s.days.length ? s.days[s.days.length - 1].day : 0;
  if (day <= last + 1) return;
  const t = s.stats.today;
  s.days.push({ day: day - 1, revenue: t.revenue, expenses: t.expenses, served: t.served, failed: t.failed, rating: sim.me.rating });
  if (s.days.length > 60) s.days.shift();
  s.stats.today = { revenue: 0, expenses: 0, served: 0, failed: 0 };
  sim.events.emit({ type: 'day', day });
}

function economySystem(sim: Simulation, dt: number) {
  let upkeep = 0;
  for (const st of Object.values(sim.state.structures)) {
    const b = sim.wb(st.building);
    if (b) upkeep += (STRUCTURES[st.kind].upkeepPerDay(st, b) * dt) / 1440;
  }
  if (upkeep > 0) sim.charge(Math.round(upkeep));
}


function verdictSystem(sim: Simulation) {
  const s = sim.state, me = sim.me;
  if (me.money < 0 && !sim.flags.warnedDebt) {
    sim.flags.warnedDebt = true;
    sim.events.emit({ type: 'notice', level: 'bad', text: `You're in debt. Below $${Math.abs(BANKRUPT_AT).toLocaleString()} owed, the bank shuts you down.` });
  }
  if (me.money >= 0) sim.flags.warnedDebt = false;
  if (me.money < BANKRUPT_AT) return endGame(sim, 'bankrupt');
  if (me.rating < RATING.gameOverBelow) {
    if (s.lowRatingSince === null) {
      s.lowRatingSince = s.time;
      sim.events.emit({ type: 'notice', level: 'bad', text: 'The city council is reviewing your licence. Get your rating above 1.5★ within a day.' });
    } else if (s.time - s.lowRatingSince >= RATING.gameOverAfter) {
      return endGame(sim, 'rating');
    }
  } else {
    s.lowRatingSince = null;
  }
}

function endGame(sim: Simulation, reason: 'bankrupt' | 'rating') {
  sim.state.gameOver = reason;
  sim.state.speed = 0;
  sim.events.emit({ type: 'gameover', reason });
}

export const SYSTEMS: SimSystem[] = [
  { id: 'traffic', every: 0.25, run: trafficSystem },
  { id: 'patience', every: 0.25, run: patienceSystem },
  { id: 'assign', every: 0.5, run: assignSystem },
  { id: 'npc', every: 0.5, run: npcSystem },
  { id: 'tutorial', every: 0.5, run: tutorialSystem },
  { id: 'demand', every: 1, run: demandSystem },
  { id: 'parking', every: 1, run: parkingSystem },
  { id: 'goals', every: 1, run: goalSystem },
  { id: 'calendar', every: 1, run: calendarSystem },
  { id: 'dealer', every: 5, run: dealerSystem },
  { id: 'verdict', every: 10, run: verdictSystem },
  { id: 'growth', every: 15, run: growthSystem },
  { id: 'stats', every: 15, run: statsSystem },
  { id: 'economy', every: 60, run: economySystem },
];
