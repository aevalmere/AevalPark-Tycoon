// Plain-language status for a vehicle, shared by the inspector, the hover
// tooltip and a depot's list of its taxis.

import { VIS_SPEED } from '../sim/balance';
import type { Simulation, Vehicle } from '../sim/simulation';

export interface VehicleSummary {
  title: string;
  status: string;
  /** short form for lists */
  short: string;
  color: string;
}

export function describeVehicle(sim: Simulation, v: Vehicle): VehicleSummary {
  const s = sim.state;
  const trip = v.trip ? s.trips[v.trip] : undefined;
  const nameOf = (id?: string | null) => (id ? sim.wb(id)?.name : undefined);
  const structName = (id?: string | null) => (id && s.structures[id] ? nameOf(s.structures[id].building) : undefined);
  const depot = structName(v.depot), lot = structName(v.lot);
  if (v.kind === 'taxi') {
    const title = depot ? `Taxi from ${depot}` : 'Taxi';
    switch (v.task) {
      case 'toPickup': return { title, color: '#f5b82e', short: 'Picking up', status: `Picking up a rider at ${nameOf(trip?.origin) ?? 'the kerb'}` };
      case 'toDrop': return {
        title, color: '#f5b82e', short: 'Rider aboard',
        status: `Taking a rider to ${nameOf(trip?.dest) ?? 'their stop'}${v.lot ? `, dropping off at ${lot}` : ', kerbside drop-off'}`,
      };
      default: return { title, color: '#f5b82e', short: 'Returning', status: depot ? `Heading back to ${depot}` : 'Off duty, heading home' };
    }
  }
  if (v.kind === 'car') {
    if (v.task === 'toLot') {
      return { title: 'Your customer, driving', color: '#4f8cff', short: 'To park', status: `Parking at ${lot ?? 'a lot'}, then walking to ${nameOf(trip?.dest) ?? 'their stop'}` };
    }
    const home = nameOf(v.home) ?? 'their building';
    return { title: 'Your customer, driving', color: '#4f8cff', short: 'Heading home', status: lot ? `Left ${lot}, heading home to ${home}` : `Heading home to ${home}` };
  }
  return { title: 'Through traffic', color: '#94a3b8', short: 'Traffic', status: "Not one of your customers, but it takes up road space all the same." };
}

/** metres still to drive and a rough ETA in game minutes at current road speeds */
export function vehicleProgress(sim: Simulation, v: Vehicle) {
  const r = v.route, last = r.edges.length - 1;
  let left = 0, eta = 0;
  for (let i = v.ri; i <= last; i++) {
    const end = i === last ? r.endOffset : sim.world.edges[r.edges[i]].length;
    const d = Math.max(0, end - (i === v.ri ? v.pos : 0));
    left += d;
    eta += d / Math.max(1, sim.edgeSpeed(r.edges[i]));
  }
  return { left, eta, kmh: Math.round(v.speed / VIS_SPEED) };
}
