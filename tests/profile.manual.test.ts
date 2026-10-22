/// <reference types="node" />
// Manual profiling harness: PROFILE_DIR=<dir> npx vitest run tests/profile.manual.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { decodeTiles, tilesFor } from '../src/world/tiles';
import { buildRoadGraph } from '../src/world/graph';
import { buildWorld } from '../src/world/build';
import { Simulation } from '../src/sim/simulation';
import { createState } from '../src/sim/state';
import { seedNewGame } from '../src/sim/setup';

const dir = process.env.PROFILE_DIR;
const origin = { lat: Number(process.env.LAT ?? 40.758), lng: Number(process.env.LNG ?? -73.9855) };

it.skipIf(!dir)('profile world build', async () => {
  mkdirSync(dir!, { recursive: true });
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  const tiles = [];
  let t = performance.now();
  for (const r of tilesFor(origin, 1000)) {
    const f = join(dir!, `${r.z}-${r.x}-${r.y}.pbf`);
    if (!existsSync(f)) {
      const url = tj.tiles[0].replace('{z}', r.z).replace('{x}', r.x).replace('{y}', r.y);
      writeFileSync(f, new Uint8Array(await (await fetch(url)).arrayBuffer()));
    }
    tiles.push({ ...r, data: new Uint8Array(readFileSync(f)) });
  }
  const lap = (label: string) => { const n = performance.now(); process.stderr.write(`${label}: ${Math.round(n - t)}ms\n`); t = n; };
  lap(`tiles x${tiles.length}`);
  const raw = decodeTiles(tiles, origin, 1000);
  lap(`decode lines=${raw.lines.length} buildings=${raw.buildings.length} pois=${raw.pois.length} hn=${raw.housenumbers.length} names=${raw.names.length} landuse=${raw.landuse.length}`);
  const g = buildRoadGraph(raw.lines);
  lap(`graph links=${g.links.length}`);
  const w = buildWorld(raw);
  lap(`world buildings=${w.buildings.length}`);
  const sim = new Simulation(w, createState({ company: 'x', city: 'x', origin, difficulty: 'normal', worldKey: w.key, seed: 1 }));
  lap('sim');
  seedNewGame(sim);
  lap(`seed active=${sim.getActive().length}`);
  const playable = w.buildings.filter((b) => b.playable);
  for (let i = 0; i < 20; i++) {
    const a = playable[(i * 131) % playable.length], b = playable[(i * 977 + 13) % playable.length];
    const r = sim.router.route(a.access!, b.access!, sim.edgeCost);
    lap(`route ${i} ${r ? r.edges.length + ' edges ' + Math.round(r.length) + 'm' : 'none'}`);
  }
});
