// Where commands go. Single player applies them to the local simulation; a
// multiplayer client would implement the same interface over a socket and
// apply the authoritative state/events the server sends back.

import type { Command, CommandResult } from '../sim/commands';
import type { Simulation } from '../sim/simulation';

export interface Transport {
  send(cmd: Command): CommandResult;
}

export class LocalTransport implements Transport {
  constructor(private sim: Simulation) {}
  send(cmd: Command): CommandResult {
    return this.sim.dispatch(cmd);
  }
}
