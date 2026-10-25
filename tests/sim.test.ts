import { describe, expect, it } from 'vitest';
import { buildWorld } from '../src/world/build';
import { syntheticWorld } from '../src/world/synthetic';
import { createState } from '../src/sim/state';
import { Simulation } from '../src/sim/simulation';
import { hydrate, migrate, seedNewGame, snapshot } from '../src/sim/setup';
import { checkBuild } from '../src/sim/commands';
import { siteReport } from '../src/sim/advisor';
import { UNDO_WINDOW } from '../src/sim/balance';
import { STRUCTURES, taxiCapacity } from '../src/sim/content';
import { SYSTEMS } from '../src/sim/systems';
import type { GameState } from '../src/sim/state';
import type { World, WorldBuilding } from '../src/world/types';
import { botTurn } from './bot';

const origin = { lat: 40.7128, lng: -74.006 };

function newSim(world: World) {
  const state = createState({ company: 'Test Co', city: 'Testville', origin, difficulty: 'normal', worldKey: world.key, seed: 42 });
  state.tutorial = -1;
  const sim = new Simulation(world, state);
  seedNewGame(sim);
  return sim;
}

/** Cheapest buildable building near a point, for scripted building in tests. */
function siteNear(sim: Simulation, x: number, y: number, kind: 'taxi' | 'parking' | 'dealership'): WorldBuilding {
  const sites = sim.world.buildings
    .filter((b) => checkBuild(sim, kind, b.idx).ok)
    .sort((a, b) => Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y));
  return sites[0];
}

describe('routing on a synthetic city', () => {
  const world = buildWorld(syntheticWorld(origin, 1000));
  const sim = newSim(world);

  it('builds a connected world with playable buildings and an HQ', () => {
    expect(world.links.length).toBeGreaterThan(100);
    expect(world.buildings.filter((b) => b.playable).length).toBeGreaterThan(100);
    expect(world.buildings[world.hq].playable).toBe(true);
  });

  it('routes between any two buildings with a sensible length', () => {
    const bs = world.buildings.filter((b) => b.playable);
    for (let i = 0; i < 30; i++) {
      const a = bs[(i * 37) % bs.length], b = bs[(i * 91 + 7) % bs.length];
      if (a === b) continue;
      const r = sim.router.route(a.access!, b.access!, sim.edgeCost);
      expect(r, `route ${a.id}→${b.id}`).not.toBeNull();
      const straight = Math.hypot(a.access!.x - b.access!.x, a.access!.y - b.access!.y);
      expect(r!.length).toBeGreaterThanOrEqual(straight - 1);
      expect(r!.length).toBeLessThan(straight * 3 + 400);
      // the route is a contiguous chain of edges
      for (let k = 1; k < r!.edges.length; k++) expect(world.edges[r!.edges[k - 1]].to).toBe(world.edges[r!.edges[k]].from);
    }
  });

  it('routes along a single link when start and end share it', () => {
    const l = world.links.find((x) => x.oneway === 0 && x.length > 60)!;
    const r = sim.router.route({ link: l.idx, offset: 10 }, { link: l.idx, offset: 50 }, sim.edgeCost)!;
    expect(r.edges.length).toBe(1);
    expect(r.length).toBeCloseTo(40, 3);
  });
});

describe('simulation', () => {
  it('runs several game days, serves riders, and saves cleanly', () => {
    const world = buildWorld(syntheticWorld(origin, 1000));
    const sim = newSim(world);
    const hq = world.buildings[world.hq];
    expect(sim.getActive().length).toBeGreaterThanOrEqual(3);

    const depot = siteNear(sim, hq.cx + 60, hq.cy, 'taxi');
    expect(sim.dispatch({ type: 'build', kind: 'taxi', building: depot.id }).ok).toBe(true);
    const depotId = sim.structureAt.get(depot.id)!;
    expect(sim.dispatch({ type: 'buyTaxi', structure: depotId }).ok).toBe(true);
    const lot = siteNear(sim, hq.cx - 120, hq.cy + 80, 'parking');
    expect(sim.dispatch({ type: 'build', kind: 'parking', building: lot.id }).ok).toBe(true);

    let maxVehicles = 0;
    const events: Record<string, number> = {};
    sim.events.on((e) => { events[e.type] = (events[e.type] ?? 0) + 1; });
    for (let m = 0; m < 3 * 1440; m++) {
      for (let k = 0; k < 60; k++) sim.tick(1 / 60);
      maxVehicles = Math.max(maxVehicles, sim.vehicles.size);
      if (sim.state.gameOver) break;
    }
    const s = sim.state;
    expect(Number.isFinite(sim.me.money)).toBe(true);
    expect(s.stats.served).toBeGreaterThan(20);
    expect(s.stats.taxiTrips).toBeGreaterThan(0);
    expect(maxVehicles).toBeLessThan(400);
    expect(s.days.length).toBeGreaterThanOrEqual(2);
    for (const v of sim.vehicles.values()) expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    for (let e = 0; e < sim.load.length; e++) expect(sim.load[e]).toBeGreaterThanOrEqual(0);

    console.log(JSON.stringify({
      money: Math.round(sim.me.money), rating: sim.me.rating.toFixed(2), served: s.stats.served, failed: s.stats.failed,
      car: s.stats.carTrips, taxi: s.stats.taxiTrips, curb: s.stats.curbDrops, active: sim.getActive().length,
      waiting: Object.keys(s.trips).length, maxVehicles, days: s.days.map((d) => [d.day, Math.round(d.revenue), Math.round(d.expenses), d.served, d.failed]),
      events,
    }));

    // save → load → keep playing
    const saved = JSON.parse(JSON.stringify(snapshot(sim)));
    const savedTime = saved.time;
    const world2 = buildWorld(syntheticWorld(origin, 1000));
    const sim2 = hydrate(world2, saved);
    expect(Object.keys(sim2.state.structures).length).toBe(2);
    sim2.state.gameOver = null;
    for (let k = 0; k < 600; k++) sim2.tick(1 / 60);
    expect(sim2.state.time).toBeGreaterThan(savedTime);
  });

  it('is winnable for a player who keeps up with demand', () => {
    const world = buildWorld(syntheticWorld(origin, 1000));
    const sim = newSim(world);
    for (let m = 0; m < 5 * 1440 && !sim.state.gameOver; m++) {
      for (let k = 0; k < 60; k++) sim.tick(1 / 60);
      if (m % 20 === 0) botTurn(sim);
    }
    const s = sim.state;
    console.log('bot', JSON.stringify({
      money: Math.round(sim.me.money), rating: sim.me.rating.toFixed(2), served: s.stats.served, failed: s.stats.failed,
      car: s.stats.carTrips, taxi: s.stats.taxiTrips, curb: s.stats.curbDrops, lotDrops: s.stats.lotDrops, sold: s.stats.carsSold,
      active: sim.getActive().length, service: s.serviceLevel, goals: s.goals.length,
      structures: Object.values(s.structures).map((x) => `${x.kind}${x.level}${x.taxis ? '×' + x.taxis : ''}`).join(' '),
      days: s.days.map((d) => [d.day, Math.round(d.revenue), Math.round(d.expenses), d.served, d.failed, d.rating.toFixed(2)]),
    }));
    expect(s.gameOver).toBeNull();
    expect(sim.me.rating).toBeGreaterThan(3);
    expect(s.stats.served).toBeGreaterThan(s.stats.failed * 2);
  });

  it('re-attaches structures whose building id changed', () => {
    const world = buildWorld(syntheticWorld(origin, 1000));
    const sim = newSim(world);
    const site = siteNear(sim, 0, 0, 'parking');
    sim.dispatch({ type: 'build', kind: 'parking', building: site.id });
    const saved = snapshot(sim);
    const st = Object.values(saved.structures)[0];
    st.building = 'b-gone';
    const sim2 = hydrate(buildWorld(syntheticWorld(origin, 1000)), saved);
    const st2 = Object.values(sim2.state.structures)[0];
    expect(st2.building).toBe(site.id);
  });
});

describe('structures', () => {
  const world = buildWorld(syntheticWorld(origin, 1000));
  const runSystem = (sim: Simulation, id: string) => { const sys = SYSTEMS.find((x) => x.id === id)!; sys.run(sim, sys.every); };
  const homes = (sim: Simulation, n: number, not: string) => sim.world.buildings.filter((b) => b.playable && b.id !== not).slice(0, n);

  it('bills parked cars per started hour as they leave, then sends them home', () => {
    const sim = newSim(world);
    const site = siteNear(sim, 0, 0, 'parking');
    sim.dispatch({ type: 'build', kind: 'parking', building: site.id });
    const lot = sim.structuresOf('parking')[0];
    sim.dispatch({ type: 'setFee', structure: lot.id, fee: 5 });
    const t = sim.state.time;
    const [home] = homes(sim, 1, site.id);
    // 2 h 10 min is three started hours
    lot.parked = [{ home: home.id, since: t - 130, until: t, rate: 5, color: 0 }, { home: home.id, since: t, until: t + 500, rate: 5, color: 0 }];
    const paid: number[] = [];
    sim.events.on((e) => { if (e.type === 'money') paid.push(e.amount); });
    const before = sim.me.money;
    runSystem(sim, 'parking');
    expect(paid).toEqual([15]);
    expect(sim.me.money - before).toBe(15);
    expect(lot.parked.length).toBe(1);
    const leaving = [...sim.vehicles.values()].filter((v) => v.task === 'home');
    expect(leaving.length).toBe(1);
    expect(leaving[0].lot).toBe(lot.id);
  });

  it('refunds everything inside the undo window and 40% after', () => {
    const sim = newSim(world);
    const site = siteNear(sim, 0, 0, 'taxi');
    const cost = STRUCTURES.taxi.cost(site);
    const start = sim.me.money;
    sim.dispatch({ type: 'build', kind: 'taxi', building: site.id });
    expect(sim.dispatch({ type: 'demolish', structure: sim.structureAt.get(site.id)! }).ok).toBe(true);
    expect(sim.me.money).toBe(start);
    sim.dispatch({ type: 'build', kind: 'taxi', building: site.id });
    sim.state.time += UNDO_WINDOW + 1;
    const mid = sim.me.money;
    sim.dispatch({ type: 'demolish', structure: sim.structureAt.get(site.id)! });
    expect(sim.me.money - mid).toBe(Math.round(cost * 0.4));
  });

  it('sends parked drivers home when a lot is sold', () => {
    const sim = newSim(world);
    const site = siteNear(sim, 0, 0, 'parking');
    sim.dispatch({ type: 'build', kind: 'parking', building: site.id });
    const lot = sim.structuresOf('parking')[0];
    lot.parked = homes(sim, 3, site.id).map((h) => ({ home: h.id, since: sim.state.time, until: sim.state.time + 90, rate: 4, color: 0 }));
    sim.dispatch({ type: 'demolish', structure: lot.id });
    expect([...sim.vehicles.values()].filter((v) => v.task === 'home').length).toBe(3);
  });

  it('gives bigger buildings bigger taxi yards, and stops selling taxis when the bays are full', () => {
    const sim = newSim(world);
    const sites = sim.world.buildings.filter((b) => checkBuild(sim, 'taxi', b.idx).ok).sort((a, b) => a.area - b.area);
    const small = sites[0], large = sites[sites.length - 1];
    expect(taxiCapacity(small, 1)).toBeGreaterThanOrEqual(2);
    expect(taxiCapacity(large, 1)).toBeGreaterThan(taxiCapacity(small, 1));
    expect(taxiCapacity(small, 3)).toBe(taxiCapacity(small, 1) * 3);
    sim.me.money = 1e6;
    sim.dispatch({ type: 'build', kind: 'taxi', building: small.id });
    const depot = sim.state.structures[sim.structureAt.get(small.id)!];
    while (sim.dispatch({ type: 'buyTaxi', structure: depot.id }).ok);
    expect(depot.taxis).toBe(taxiCapacity(small, 1));
  });

  it('remembers drivers who could not park and shows them in a lot preview', () => {
    const sim = newSim(world);
    const [o, d] = sim.world.buildings.filter((b) => b.playable && sim.inService(b) && b.idx !== sim.world.hq);
    const trip = { id: 'tx', origin: o.id, dest: d.id, createdAt: 0, patience: 10, waited: 10, hasCar: true, status: 'waiting' as const, reason: 'parking' as const };
    sim.state.trips[trip.id] = trip;
    sim.failTrip(trip, 'parking');
    expect(sim.parkDemand.get(d.id)).toBe(1);
    expect(siteReport(sim, 'parking', d).demand).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 40; i++) runSystem(sim, 'demand-memory');
    expect(sim.parkDemand.has(d.id)).toBe(false);
  });

  it('migrates version 1 saves to hourly parking rates', () => {
    const sim = newSim(world);
    const site = siteNear(sim, 0, 0, 'parking');
    sim.dispatch({ type: 'build', kind: 'parking', building: site.id });
    const old = JSON.parse(JSON.stringify(snapshot(sim))) as GameState;
    old.v = 1;
    const lot = Object.values(old.structures)[0];
    lot.fee = 8;
    lot.parked = [{ home: 'b1', until: 900, color: 0 } as never];
    const s = migrate(old);
    const st = Object.values(s.structures)[0];
    expect(s.v).toBe(2);
    expect(st.fee).toBe(4);
    expect(st.parked![0].since).toBe(780);
    expect(st.parked![0].rate).toBe(4);
  });
});
