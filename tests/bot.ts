// A simple heuristic player used to check that the economy is winnable when
// the network is actually managed.

import { checkBuild } from '../src/sim/commands';
import { STRUCTURES, TAXI_PRICE, taxiCapacity } from '../src/sim/content';
import { SERVICE_LEVELS, PARK_WALK_RADIUS } from '../src/sim/balance';
import type { Simulation } from '../src/sim/simulation';
import type { StructureKind } from '../src/sim/state';

function siteNear(sim: Simulation, x: number, y: number, kind: StructureKind, maxD = 400) {
  let best = -1, bestScore = Infinity;
  for (const i of sim.world.buildingGrid.queryRadius(x, y, maxD)) {
    const b = sim.world.buildings[i];
    if (!checkBuild(sim, kind, i).ok) continue;
    if (sim.state.buildings[b.id]?.active) continue; // don't convert customers
    const score = Math.hypot(b.cx - x, b.cy - y) + STRUCTURES[kind].cost(b) / 40;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best >= 0 ? sim.world.buildings[best] : null;
}

export function botTurn(sim: Simulation) {
  const s = sim.state;
  const money = () => sim.me.money;
  const trips = Object.values(s.trips);
  const needTaxi = trips.filter((t) => t.reason === 'taxi');
  const needPark = trips.filter((t) => t.reason === 'parking');
  const depots = sim.structuresOf('taxi');

  if (!depots.length) {
    const hq = sim.world.buildings[sim.world.hq];
    const site = siteNear(sim, hq.cx, hq.cy, 'taxi');
    if (site) sim.dispatch({ type: 'build', kind: 'taxi', building: site.id });
    return;
  }

  if (needTaxi.length >= 2 && money() > TAXI_PRICE + 2500) {
    const room = depots.find((d) => (d.taxis ?? 0) < taxiCapacity(sim.wb(d.building)!, d.level));
    if (room) sim.dispatch({ type: 'buyTaxi', structure: room.id });
    else {
      const d = depots[0];
      const b = sim.wb(d.building)!;
      if (d.level < STRUCTURES.taxi.maxLevel && money() > STRUCTURES.taxi.upgradeCost(d, b) + 3000) sim.dispatch({ type: 'upgrade', structure: d.id });
    }
  }

  if (needPark.length && money() > 9000) {
    const dest = sim.wb(needPark[0].dest)!;
    const existing = sim.nearestLot(dest, PARK_WALK_RADIUS, false);
    if (existing && existing.level < STRUCTURES.parking.maxLevel && money() > STRUCTURES.parking.upgradeCost(existing, sim.wb(existing.building)!) + 4000) {
      sim.dispatch({ type: 'upgrade', structure: existing.id });
    } else if (!existing) {
      const site = siteNear(sim, dest.cx, dest.cy, 'parking', PARK_WALK_RADIUS * 0.8);
      if (site && money() > STRUCTURES.parking.cost(site) + 3000) sim.dispatch({ type: 'build', kind: 'parking', building: site.id });
    }
  }

  if (!sim.structuresOf('dealership').length && money() > 30000) {
    const hq = sim.world.buildings[sim.world.hq];
    const site = siteNear(sim, hq.cx, hq.cy, 'dealership');
    if (site) sim.dispatch({ type: 'build', kind: 'dealership', building: site.id });
  }

  const next = SERVICE_LEVELS[s.serviceLevel + 1];
  if (next && money() > next.cost + 25000 && sim.me.rating > 3.4) sim.dispatch({ type: 'expandService' });
}
