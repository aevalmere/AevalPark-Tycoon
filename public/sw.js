// Service worker: keeps map tiles, map styles and the game's own files in the
// browser cache, so a revisit opens straight away and a district you've played
// still draws its basemap offline.
//
// - OpenFreeMap tiles, glyphs and sprites live under versioned URLs and never
//   change: cache first.
// - Map styles and the TileJSON pointer change weekly: serve the cached copy,
//   refresh it in the background.
// - The page itself: network first, so a new deploy shows up on the next load.
// - Hashed build output (assets/): cache first.

const VERSION = 'v1';
const APP = `apt-app-${VERSION}`;
const MAP = `apt-map-${VERSION}`;
const MAP_LIMIT = 6000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('apt-') && key !== APP && key !== MAP) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tiles.openfreemap.org') {
    const immutable = /^\/planet\/[^/]+\/\d+\/\d+\/\d+/.test(url.pathname) || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/');
    event.respondWith(immutable ? cacheFirst(req, MAP, true) : staleWhileRevalidate(req, MAP));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') event.respondWith(networkFirst(req, APP));
  else if (url.pathname.includes('/assets/')) event.respondWith(cacheFirst(req, APP, false));
  else event.respondWith(staleWhileRevalidate(req, APP));
});

async function put(cacheName, req, res) {
  if (!res.ok || res.status !== 200) return;
  const cache = await caches.open(cacheName);
  await cache.put(req, res);
}

let puts = 0;
async function trim() {
  // a city's worth of tiles is a few hundred entries; keep a few dozen cities
  if (++puts % 250) return;
  const cache = await caches.open(MAP);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAP_LIMIT; i++) await cache.delete(keys[i]);
}

async function cacheFirst(req, cacheName, isMap) {
  const hit = await caches.match(req, { cacheName });
  if (hit) return hit;
  const res = await fetch(req);
  const copy = res.clone();
  put(cacheName, req, copy).then(() => (isMap ? trim() : undefined)).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const hit = await caches.match(req, { cacheName });
  const fresh = fetch(req).then((res) => {
    put(cacheName, req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return hit;
  }
  return fresh;
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    put(cacheName, req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await caches.match(req, { cacheName });
    if (hit) return hit;
    throw e;
  }
}
