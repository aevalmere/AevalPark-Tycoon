// What a structure would do on a given site, for build previews: who it would
// reach, the unmet demand around it, how it overlaps what you already own, and
// what it costs to run. Pure reads of the simulation.

import type { WorldBuilding } from '../world/types';
import { DEALER, PARK_WALK_RADIUS, TAXI_REACH } from './balance';
import { STRUCTURES, dealerRadius, parkingSpaces, taxiCapacity } from './content';
import type { Simulation } from './simulation';
import type { Structure, StructureKind } from './state';

export interface SiteReport {
  kind: StructureKind;
  cost: number;
  upkeep: number;
  /** customers in reach: destinations for a lot, origins for a depot, buyers for a dealership */
  customers: number;
  /** recent unmet demand in reach: drivers who found no parking, riders who found no taxi */
  demand: number;
  /** the nearest structure of the same kind, if any */
  nearest: { name: string; d: number } | null;
  /** parking spaces or taxi bays at level 1 */
  capacity: number;
  /** dealership: expected cars sold per game day, and the share of customers in reach who already drive */
  sales: number;
  carShare: number;
}

/** Customer buildings a structure of this kind on `b` would reach (empty for depots, which roam). */
export function reachOf(sim: Simulation, kind: StructureKind, b: WorldBuilding, level = 1): number[] {
  if (kind === 'taxi') return [];
  const r = kind === 'parking' ? PARK_WALK_RADIUS : dealerRadius(level);
  const w = sim.world, out: number[] = [];
  for (const i of w.buildingGrid.queryRadius(b.cx, b.cy, r)) {
    const c = w.buildings[i];
    if (c.idx !== b.idx && sim.state.buildings[c.id]?.active && Math.hypot(c.cx - b.cx, c.cy - b.cy) <= r) out.push(i);
  }
  return out;
}

export function siteReport(sim: Simulation, kind: StructureKind, b: WorldBuilding): SiteReport {
  const def = STRUCTURES[kind];
  const s = sim.state;
  const probe = { kind, level: 1, taxis: 1 } as Structure;
  const report: SiteReport = {
    kind, cost: def.cost(b), upkeep: def.upkeepPerDay(probe, b), customers: 0, demand: 0, nearest: null,
    capacity: kind === 'parking' ? parkingSpaces(b, 1) : kind === 'taxi' ? taxiCapacity(b, 1) : 0, sales: 0, carShare: 0,
  };
  for (const st of sim.structuresOf(kind)) {
    const o = sim.wb(st.building);
    if (!o || o.idx === b.idx) continue;
    const d = Math.hypot(o.cx - b.cx, o.cy - b.cy);
    if (!report.nearest || d < report.nearest.d) report.nearest = { name: o.name, d };
  }
  const near = (id: string, r: number) => {
    const x = sim.wb(id);
    return !!x && Math.hypot(x.cx - b.cx, x.cy - b.cy) <= r;
  };

  if (kind === 'parking') {
    report.customers = reachOf(sim, kind, b).length;
    for (const [id, n] of sim.parkDemand) if (near(id, PARK_WALK_RADIUS)) report.demand += n;
    for (const t of Object.values(s.trips)) if (t.reason === 'parking' && near(t.dest, PARK_WALK_RADIUS)) report.demand++;
  } else if (kind === 'taxi') {
    for (const i of sim.getActive()) {
      const c = sim.world.buildings[i];
      if (Math.hypot(c.cx - b.cx, c.cy - b.cy) <= TAXI_REACH) report.customers++;
    }
    for (const [id, n] of sim.taxiDemand) if (near(id, TAXI_REACH)) report.demand += n;
    for (const t of Object.values(s.trips)) if (t.reason === 'taxi' && near(t.origin, TAXI_REACH)) report.demand++;
  } else {
    const reach = reachOf(sim, kind, b);
    report.customers = reach.length;
    let car = 0;
    for (const i of reach) {
      const c = sim.world.buildings[i], st = s.buildings[c.id];
      car += st.car;
      // same expectation the dealer system rolls against, over a whole day
      report.sales += DEALER.rate * Math.max(0, DEALER.cap - st.car) * Math.min(2, c.trips) * 24;
    }
    report.carShare = reach.length ? car / reach.length : 0;
  }
  report.demand = Math.round(report.demand);
  return report;
}
