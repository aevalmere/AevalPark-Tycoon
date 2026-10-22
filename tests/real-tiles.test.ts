/// <reference types="node" />
// Network test against live OpenFreeMap tiles. Opt-in: REAL_TILES=1 npm test
import { describe, expect, it } from 'vitest';
import { buildWorld } from '../src/world/build';
import { decodeTiles, tilesFor } from '../src/world/tiles';
import { createState } from '../src/sim/state';
import { Simulation } from '../src/sim/simulation';
import { seedNewGame } from '../src/sim/setup';

const PLACES: Record<string, { lat: number; lng: number }> = {
  midtown: { lat: 40.758, lng: -73.9855 },
  suburb: { lat: 37.3318, lng: -122.0312 },
  paris: { lat: 48.8566, lng: 2.3522 },
};

describe.skipIf(!process.env.REAL_TILES)('real tiles', () => {
  for (const [name, origin] of Object.entries(PLACES)) {
    it(`builds a playable world for ${name}`, async () => {
      const tj = await (await fetch('https://tiles.openfreemap.org/planet', { signal: AbortSignal.timeout(20000) })).json();
      const refs = tilesFor(origin, 1000);
      const t0 = performance.now();
      const tiles = await Promise.all(refs.map(async (r) => {
        const url = tj.tiles[0].replace('{z}', r.z).replace('{x}', r.x).replace('{y}', r.y);
        return { ...r, data: new Uint8Array(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer()) };
      }));
      const t1 = performance.now();
      const raw = decodeTiles(tiles, origin, 1000);
      const t2 = performance.now();
      const world = buildWorld(raw);
      const t3 = performance.now();

      const playable = world.buildings.filter((b) => b.playable);
      const sim = new Simulation(world, createState({ company: 'x', city: name, origin, difficulty: 'normal', worldKey: world.key, seed: 1 }));
      seedNewGame(sim);
      let ok = 0, tried = 0, detour = 0;
      for (let i = 0; i < 60; i++) {
        const a = playable[(i * 131) % playable.length], b = playable[(i * 977 + 13) % playable.length];
        if (a === b) continue;
        tried++;
        const r = sim.router.route(a.access!, b.access!, sim.edgeCost);
        if (r) {
          ok++;
          detour += r.length / Math.max(50, Math.hypot(a.cx - b.cx, a.cy - b.cy));
        }
      }
      console.log(name, JSON.stringify({
        tiles: refs.length, kb: Math.round(tiles.reduce((n, t) => n + t.data.byteLength, 0) / 1024),
        fetchMs: Math.round(t1 - t0), decodeMs: Math.round(t2 - t1), buildMs: Math.round(t3 - t2),
        rawLines: raw.lines.length, nodes: world.nodeX.length, links: world.links.length, edges: world.edges.length,
        buildings: world.buildings.length, playable: playable.length, hq: world.buildings[world.hq].name,
        hqKind: world.buildings[world.hq].kind, carOwnership: world.baseCarOwnership.toFixed(2),
        routes: `${ok}/${tried}`, avgDetour: (detour / Math.max(1, ok)).toFixed(2),
        sample: playable.slice(0, 6).map((b) => `${b.name} (${b.kind})`),
      }));
      expect(world.links.length).toBeGreaterThan(200);
      expect(playable.length).toBeGreaterThan(50);
      expect(ok).toBe(tried);
    });
  }
});
