// New-game seeding and save/load reconciliation.

import { ringCentroid } from '../core/geo';
import { pick } from '../core/rng';
import { restoreBuilding } from '../world/build';
import type { World } from '../world/types';
import { START_ACTIVE } from './balance';
import { Simulation } from './simulation';
import { STATE_VERSION, type GameState } from './state';

/** Wake up a handful of buildings near HQ so the first riders have somewhere to come from. */
export function seedNewGame(sim: Simulation) {
  const w = sim.world;
  const hq = w.buildings[w.hq];
  for (const r of [320, 550, 900]) {
    const cand = w.buildingGrid.queryRadius(hq.cx, hq.cy, r)
      .map((i) => w.buildings[i])
      .filter((b) => b.playable && b.idx !== w.hq && Math.hypot(b.cx - hq.cx, b.cy - hq.cy) > 50 && sim.inService(b))
      .sort((a, b) => Math.hypot(a.cx - hq.cx, a.cy - hq.cy) - Math.hypot(b.cx - hq.cx, b.cy - hq.cy))
      .slice(0, 40);
    if (cand.length < START_ACTIVE) continue;
    const homes = cand.filter((b) => b.kind === 'house' || b.kind === 'apartment');
    const chosen = new Set<number>();
    if (homes.length) chosen.add(homes[0].idx);
    for (let guard = 0; chosen.size < START_ACTIVE && guard < 200; guard++) chosen.add(pick(sim.state.rng, cand).idx);
    for (const i of chosen) sim.activate(w.buildings[i]);
    return;
  }
}

/**
 * A persistable copy of the state. Trips already under way are settled as
 * delivered (vehicles aren't saved), so a save never strands a rider in a car.
 */
export function snapshot(sim: Simulation): GameState {
  const copy: GameState = JSON.parse(JSON.stringify(sim.state));
  for (const t of Object.values(copy.trips)) {
    if (t.status === 'waiting') { t.reason = null; continue; }
    delete copy.trips[t.id];
    copy.stats.served++;
  }
  return copy;
}

const MIGRATIONS: Record<number, (s: GameState) => GameState> = {
  // 1 → 2: flat parking fees became hourly rates billed on exit (a typical stay is about two hours)
  1: (s) => {
    for (const st of Object.values(s.structures)) {
      if (st.kind !== 'parking') continue;
      st.fee = Math.round((st.fee ?? 8) / 2);
      for (const p of st.parked ?? []) {
        p.since ??= p.until - 120;
        p.rate ??= st.fee;
      }
    }
    return s;
  },
};

export function migrate(raw: GameState): GameState {
  let s = raw;
  while (s.v < STATE_VERSION) {
    const m = MIGRATIONS[s.v];
    if (!m) throw new Error(`No migration from save version ${s.v}`);
    s = m(s);
    s.v++;
  }
  if (s.v > STATE_VERSION) throw new Error('This save comes from a newer version of the game.');
  return s;
}

/** Build a simulation from a loaded state, re-attaching structures to buildings. */
export function hydrate(world: World, state: GameState): Simulation {
  for (const st of Object.values(state.structures)) {
    if (world.buildingById.has(st.building)) continue;
    // map data shifted: re-attach to a footprint at the same spot, else restore the saved one
    const [cx, cy] = ringCentroid(st.ring);
    let match = -1, bestD = 4;
    for (const i of world.buildingGrid.queryRadius(cx, cy, 6)) {
      const b = world.buildings[i];
      const d = Math.hypot(b.cx - cx, b.cy - cy);
      if (b.playable && d < bestD) { bestD = d; match = i; }
    }
    if (match >= 0) st.building = world.buildings[match].id;
    else restoreBuilding(world, st.building, st.ring, st.height);
  }
  for (const t of Object.values(state.trips)) {
    if (!world.buildingById.has(t.origin) || !world.buildingById.has(t.dest) || t.status !== 'waiting') delete state.trips[t.id];
  }
  state.incidents = state.incidents.filter((i) => world.linkById.has(i.link));
  for (const inc of state.incidents) {
    const li = world.linkById.get(inc.link)!;
    if (!world.linkEdges[li].includes(inc.edge)) inc.edge = world.linkEdges[li][0];
  }
  return new Simulation(world, state);
}
