// Fetches the vector tiles around HQ and turns them into a World. Tiles are
// kept in IndexedDB so reloading a save rebuilds the identical street network
// (OpenFreeMap republishes its planet weekly; ids would drift otherwise).

import type { LatLng } from '../core/geo';
import { WORLD_RADIUS } from '../sim/balance';
import { buildWorld } from '../world/build';
import { syntheticWorld } from '../world/synthetic';
import { decodeTiles, tilesFor, type TileBuffer, type TileRef } from '../world/tiles';
import type { World } from '../world/types';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const DB = 'aevalpark';
const STORE = 'tiles';
const MAX_CACHED = 120;

export interface LoadProgress {
  step: 'tiles' | 'roads' | 'buildings' | 'ready';
  done: number;
  total: number;
}

let tileTemplate: Promise<{ url: string; tileset: string }> | null = null;

function currentTileset() {
  tileTemplate ??= fetchWithTimeout(TILEJSON, 10000)
    .then((r) => r.json())
    .then((j: { tiles: string[] }) => {
      const url = j.tiles[0];
      const m = url.match(/planet\/([^/]+)\//);
      return { url, tileset: m ? m[1] : 'current' };
    })
    .catch((e) => { tileTemplate = null; throw e; });
  return tileTemplate;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- IndexedDB tile cache ----------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

interface CachedTile { data: ArrayBuffer; t: number }

async function trimCache(db: IDBDatabase) {
  const keys = (await idb(db, 'readonly', (s) => s.getAllKeys())) ?? [];
  if (keys.length <= MAX_CACHED) return;
  const entries = await Promise.all(keys.map(async (k) => ({ k, t: (await idb<CachedTile>(db, 'readonly', (s) => s.get(k)))?.t ?? 0 })));
  entries.sort((a, b) => a.t - b.t);
  for (const e of entries.slice(0, keys.length - MAX_CACHED)) await idb(db, 'readwrite', (s) => s.delete(e.k));
}

const keyOf = (tileset: string, r: TileRef) => `${tileset}/${r.z}/${r.x}/${r.y}`;

// ---------- loader ----------

export interface LoadedWorld {
  world: World;
  tileset?: string;
  offline: boolean;
}

/**
 * Load the district around `origin`. `preferTileset` (from a save) is tried
 * from cache first so a reloaded company sees the same streets.
 */
export async function loadWorld(origin: LatLng, onProgress: (p: LoadProgress) => void, preferTileset?: string): Promise<LoadedWorld> {
  const refs = tilesFor(origin, WORLD_RADIUS);
  const db = await openDb();
  let tiles: TileBuffer[] | null = null;
  let tileset: string | undefined;

  if (db && preferTileset) {
    const cached = await Promise.all(refs.map((r) => idb<CachedTile>(db, 'readonly', (s) => s.get(keyOf(preferTileset, r)))));
    if (cached.every(Boolean)) {
      tiles = refs.map((r, i) => ({ ...r, data: cached[i]!.data }));
      tileset = preferTileset;
      onProgress({ step: 'tiles', done: refs.length, total: refs.length });
    }
  }

  if (!tiles) {
    try {
      const tpl = await currentTileset();
      tileset = tpl.tileset;
      let done = 0;
      onProgress({ step: 'tiles', done, total: refs.length });
      tiles = await Promise.all(refs.map(async (r) => {
        const key = keyOf(tpl.tileset, r);
        const hit = db ? await idb<CachedTile>(db, 'readonly', (s) => s.get(key)) : undefined;
        let data = hit?.data;
        if (!data) {
          const url = tpl.url.replace('{z}', String(r.z)).replace('{x}', String(r.x)).replace('{y}', String(r.y));
          let lastErr: unknown;
          for (let attempt = 0; attempt < 3 && !data; attempt++) {
            try { data = await (await fetchWithTimeout(url, 15000)).arrayBuffer(); } catch (e) { lastErr = e; }
          }
          if (!data) throw lastErr;
          const fresh: CachedTile = { data, t: Date.now() };
          if (db) await idb(db, 'readwrite', (s) => s.put(fresh, key));
        }
        onProgress({ step: 'tiles', done: ++done, total: refs.length });
        return { ...r, data };
      }));
      if (db) void trimCache(db);
    } catch (e) {
      console.warn('[world] map tiles unavailable, generating an offline city', e);
      tiles = null;
    }
  }

  // yield so the progress UI can paint between the heavy steps
  const breathe = () => new Promise((r) => setTimeout(r, 16));
  onProgress({ step: 'roads', done: 0, total: 1 });
  await breathe();
  const raw = tiles ? decodeTiles(tiles, origin, WORLD_RADIUS, tileset) : syntheticWorld(origin, WORLD_RADIUS);
  onProgress({ step: 'buildings', done: 0, total: 1 });
  await breathe();
  let world = buildWorld(raw);
  let offline = !tiles;
  if (world.links.length < 20 || world.buildings.filter((b) => b.playable).length < 15) {
    // middle of a lake, a desert, or data that won't make a game: use the generated city
    world = buildWorld(syntheticWorld(origin, WORLD_RADIUS));
    offline = true;
  }
  onProgress({ step: 'ready', done: 1, total: 1 });
  return { world, tileset: offline ? undefined : tileset, offline };
}
