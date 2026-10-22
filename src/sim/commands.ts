// Every player action is a serialisable Command. The UI never mutates state
// directly, which is the seam a multiplayer server would sit behind: clients
// send commands, the authority validates and applies them.

import { ROAD_UPGRADE, SERVICE_LEVELS } from './balance';
import { STRUCTURES, TAXI_PRICE, taxiCapacity } from './content';
import type { Simulation } from './simulation';
import { newId, type Structure, type StructureKind } from './state';

export type Command =
  | { type: 'build'; kind: StructureKind; building: string }
  | { type: 'upgrade'; structure: string }
  | { type: 'demolish'; structure: string }
  | { type: 'setFee'; structure: string; fee: number }
  | { type: 'buyTaxi'; structure: string }
  | { type: 'sellTaxi'; structure: string }
  | { type: 'setFare'; mult: number }
  | { type: 'upgradeRoad'; link: string }
  | { type: 'expandService' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'tutorial'; step: number };

export interface CommandResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const fail = (error: string): CommandResult => ({ ok: false, error });
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** Whether a building can take a structure, and what it costs. Used by build previews too. */
export function checkBuild(sim: Simulation, kind: StructureKind, buildingIdx: number): { ok: boolean; cost: number; error?: string } {
  const b = sim.world.buildings[buildingIdx];
  if (!b) return { ok: false, cost: 0, error: 'Pick a building.' };
  const cost = STRUCTURES[kind].cost(b);
  if (b.idx === sim.world.hq) return { ok: false, cost, error: "That's your headquarters." };
  if (!b.playable) return { ok: false, cost, error: 'No road access to this building.' };
  if (sim.structureAt.has(b.id)) return { ok: false, cost, error: 'Already converted.' };
  if (!sim.inService(b)) return { ok: false, cost, error: 'Outside your service area. Expand it first.' };
  if (sim.me.money < cost) return { ok: false, cost, error: `Needs ${money(cost)}.` };
  return { ok: true, cost };
}

export function roadUpgradeCost(sim: Simulation, linkIdx: number) {
  const l = sim.world.links[linkIdx];
  const extra = sim.state.roads[l.id] ?? 0;
  return Math.round(Math.max(ROAD_UPGRADE.min, l.length * ROAD_UPGRADE.perMetre * (extra + 1)) / 50) * 50;
}

export function applyCommand(sim: Simulation, cmd: Command, by: string): CommandResult {
  const s = sim.state;
  const company = s.companies[by];
  if (!company) return fail('Unknown player.');
  if (s.gameOver && cmd.type !== 'tutorial') return fail('The game is over.');
  const own = (id: string): Structure | null => {
    const st = s.structures[id];
    return st && st.owner === by ? st : null;
  };

  switch (cmd.type) {
    case 'build': {
      const idx = sim.world.buildingById.get(cmd.building);
      if (idx === undefined) return fail('Unknown building.');
      const check = checkBuild(sim, cmd.kind, idx);
      if (!check.ok) return fail(check.error!);
      if (!sim.spend(check.cost, company)) return fail('Not enough money.');
      const b = sim.world.buildings[idx];
      const st: Structure = {
        id: newId(s, 's'),
        kind: cmd.kind,
        owner: by,
        building: b.id,
        level: 1,
        builtAt: s.time,
        revenue: 0,
        ring: Array.from(b.ring, (v) => Math.round(v * 10) / 10),
        height: b.height,
      };
      if (cmd.kind === 'parking') { st.fee = 8; st.parked = []; }
      if (cmd.kind === 'taxi') st.taxis = 1;
      if (cmd.kind === 'dealership') st.sales = 0;
      s.structures[st.id] = st;
      sim.structureAt.set(b.id, st.id);
      // the building stops being a customer; riders waiting there go elsewhere
      sim.deactivate(b.id);
      for (const t of Object.values(s.trips)) if (t.origin === b.id && t.status === 'waiting') sim.removeTrip(t);
      sim.events.emit({ type: 'built', structure: st.id, kind: st.kind, building: idx });
      return { ok: true, id: st.id };
    }

    case 'upgrade': {
      const st = own(cmd.structure);
      if (!st) return fail('Not yours.');
      const def = STRUCTURES[st.kind];
      if (st.level >= def.maxLevel) return fail('Already fully upgraded.');
      const b = sim.wb(st.building);
      if (!b) return fail('Building missing.');
      const cost = def.upgradeCost(st, b);
      if (!sim.spend(cost, company)) return fail(`Needs ${money(cost)}.`);
      st.level++;
      sim.events.emit({ type: 'upgraded', structure: st.id, level: st.level });
      return { ok: true };
    }

    case 'demolish': {
      const st = own(cmd.structure);
      if (!st) return fail('Not yours.');
      const b = sim.wb(st.building);
      const refund = b ? Math.round(STRUCTURES[st.kind].cost(b) * 0.4) : 0;
      for (const v of [...sim.vehicles.values()]) {
        if (st.kind === 'taxi' && v.kind === 'taxi' && v.depot === st.id) {
          if (v.task === 'toDrop') { v.depot = null; continue; }
          const trip = v.trip ? s.trips[v.trip] : undefined;
          if (trip) { trip.status = 'waiting'; trip.mode = undefined; }
          sim.despawn(v);
        }
        if (st.kind === 'parking' && v.task === 'toLot' && v.lot === st.id) {
          const trip = v.trip ? s.trips[v.trip] : undefined;
          v.task = 'home';
          v.lot = undefined;
          v.trip = undefined;
          const home = trip ? sim.wb(trip.origin) : undefined;
          if (!home?.access || !sim.reroute(v, home.access)) sim.despawn(v);
          if (trip) sim.failTrip(trip, 'parking');
        }
      }
      sim.lotReserved.delete(st.id);
      delete s.structures[st.id];
      sim.structureAt.delete(st.building);
      company.money += refund;
      sim.events.emit({ type: 'removed', structure: st.id, building: b?.idx ?? -1 });
      return { ok: true };
    }

    case 'setFee': {
      const st = own(cmd.structure);
      if (!st || st.kind !== 'parking') return fail('Not a parking lot.');
      st.fee = Math.max(0, Math.min(30, Math.round(cmd.fee)));
      return { ok: true };
    }

    case 'buyTaxi': {
      const st = own(cmd.structure);
      if (!st || st.kind !== 'taxi') return fail('Not a taxi depot.');
      if ((st.taxis ?? 0) >= taxiCapacity(st.level)) return fail('Depot is full. Upgrade it for more bays.');
      if (!sim.spend(TAXI_PRICE, company)) return fail(`Needs ${money(TAXI_PRICE)}.`);
      st.taxis = (st.taxis ?? 0) + 1;
      return { ok: true };
    }

    case 'sellTaxi': {
      const st = own(cmd.structure);
      if (!st || st.kind !== 'taxi') return fail('Not a taxi depot.');
      if ((st.taxis ?? 0) <= 0) return fail('No taxis to sell.');
      if ((st.taxis ?? 0) - sim.taxisOut(st.id) <= 0) return fail('Every taxi is out on a job.');
      st.taxis = (st.taxis ?? 0) - 1;
      company.money += Math.round(TAXI_PRICE * 0.5);
      return { ok: true };
    }

    case 'setFare':
      s.fareMult = Math.max(0.5, Math.min(2, Math.round(cmd.mult * 20) / 20));
      return { ok: true };

    case 'upgradeRoad': {
      const idx = sim.world.linkById.get(cmd.link);
      if (idx === undefined) return fail('Unknown road.');
      const l = sim.world.links[idx];
      const extra = s.roads[l.id] ?? 0;
      if (extra >= ROAD_UPGRADE.maxExtraLanes) return fail('This road is as wide as it gets.');
      if (Math.hypot(l.pts[0], l.pts[1]) > sim.serviceRadius() + 60) return fail('Outside your service area.');
      const cost = roadUpgradeCost(sim, idx);
      if (!sim.spend(cost, company)) return fail(`Needs ${money(cost)}.`);
      s.roads[l.id] = extra + 1;
      sim.events.emit({ type: 'road', link: idx, lanes: sim.lanesOf(idx) });
      return { ok: true };
    }

    case 'expandService': {
      const next = SERVICE_LEVELS[s.serviceLevel + 1];
      if (!next) return fail('Your service area covers the whole district.');
      if (!sim.spend(next.cost, company)) return fail(`Needs ${money(next.cost)}.`);
      s.serviceLevel++;
      sim.events.emit({ type: 'expand', level: s.serviceLevel, radius: sim.serviceRadius() });
      return { ok: true };
    }

    case 'setSpeed':
      if (![0, 1, 2, 4].includes(cmd.speed)) return fail('Bad speed.');
      s.speed = cmd.speed;
      return { ok: true };

    case 'tutorial':
      s.tutorial = cmd.step;
      return { ok: true };
  }
}
