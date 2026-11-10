// The home screen's backdrop: a real city at night, slowly turning. Built
// straight from the basemap's own tiles (no game world): towers with lit
// windows, lamp-lit streets and traffic with headlights, drawn with the same
// instanced model layer the game uses.
//
// Nothing moves until everything is in. The map is fenced to the couple of
// kilometres around the camera (the haze hides the rest), which leaves a
// handful of tiles: the scene loads all of them by looking right round once,
// dresses the city from them, and only then reports ready;
// the caller fades it in and calls start(). Its first frame is always the same
// city, camera, lighting and traffic, and public/menu-hero.jpg (shown before
// any of this has loaded) is a capture of exactly that frame, so the live map
// fades in over a picture of itself.

import { Map as MlMap } from 'maplibre-gl';
import './maplibre';
import { LocalProjection, pointAlong, polylineLengths } from '../core/geo';
import { ModelLayer } from './ModelLayer';
import { InstanceBuffer, pushCar } from './models';
import { pushLamp, pushWindows } from './scenery';
import { loadBaseStyle } from './style';

/**
 * Midtown Manhattan among the towers, at their real heights. The zoom is for a
 * view 900 px tall and scales with the window, so every screen frames the same
 * shot as the still. Changing any of this means re-shooting menu-hero.jpg.
 */
export const MENU_CAMERA = { center: [-73.9855, 40.758] as [number, number], zoom: 15.7, pitch: 64, bearing: 24 };
const HERO_HEIGHT = 900;
/** how far the camera breathes in and out, in zoom levels */
const BREATH = 0.08;
/** degrees per second */
const TURN = 1.7;
/** the map stops this far from the camera's target, in metres; nothing beyond is ever requested */
const FENCE = 1900;
/** where the basemap style says its tiles are listed */
const TILEJSON = 'https://tiles.openfreemap.org/planet';

const WALLS = ['#3a4a6e', '#465274', '#35506a', '#4f5578', '#3e465c', '#5a5670', '#30466e', '#48546c'];

const CAR_COLORS = [0xd8dde6, 0x20242c, 0x9aa3b2, 0xb3261e, 0x1f4fbf, 0xf5b82e, 0xf5b82e, 0x2c3440, 0xe7e2d6];
const STREETS = new Set(['primary', 'secondary', 'tertiary', 'minor', 'trunk']);
const REACH = 1100;
/** buildings this close to the centre get lit windows */
const WINDOW_REACH = 800;

interface Car { pts: Float64Array; cum: Float64Array; len: number; d: number; v: number; color: number; taxi: boolean }
interface Block { ring: Float64Array; base: number; top: number; d: number; key: string }
interface Street { pts: Float64Array; cum: Float64Array; len: number; key: string }

export interface MenuScene {
  /** Begin the orbit and the traffic, easing in from standstill. Call once the scene is fully visible. */
  start(): void;
  /** for automated checks in dev builds */
  debug: unknown;
  destroy(): void;
}

export async function createMenuScene(container: HTMLElement): Promise<MenuScene> {
  // asked for alongside the style rather than after it: one round trip sooner
  const tileJson = fetch(TILEJSON).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const { style, ok } = await loadBaseStyle('dark');
  const proj = new LocalProjection({ lat: MENU_CAMERA.center[1], lng: MENU_CAMERA.center[0] });
  // Give the map its tile source directly, with bounds. Left to the style it
  // would fetch tiles out to the horizon, and "loaded" would be a long way off.
  const source = (style.sources as Record<string, { type?: string; url?: string }>).openmaptiles;
  if (ok && source?.type === 'vector' && source.url) {
    try {
      const tj = (await (source.url === TILEJSON ? tileJson : fetch(source.url).then((r) => r.json()))) as { tiles: string[]; minzoom?: number; maxzoom?: number; attribution?: string } | null;
      if (!tj?.tiles?.length) throw new Error('no tile list');
      const sw = proj.toLngLat(-FENCE, -FENCE), ne = proj.toLngLat(FENCE, FENCE);
      style.sources.openmaptiles = {
        type: 'vector', tiles: tj.tiles, minzoom: tj.minzoom ?? 0, maxzoom: tj.maxzoom ?? 14, attribution: tj.attribution,
        bounds: [sw[0], sw[1], ne[0], ne[1]],
      };
    } catch (e) {
      console.warn('[menu] could not fence the map; it will take longer to load', e);
    }
  }
  const zoomFor = () => MENU_CAMERA.zoom + Math.log2(Math.max(240, container.clientHeight) / HERO_HEIGHT);
  const map = new MlMap({
    container, style, ...MENU_CAMERA, zoom: zoomFor(),
    interactive: false,
    attributionControl: false,
    maxPitch: 74,
    fadeDuration: 0,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
  });
  await new Promise<void>((resolve) => map.once('load', () => resolve()));

  const solids = new InstanceBuffer(), shadows = new InstanceBuffer(), glows = new InstanceBuffer();
  let cars: Car[] = [];
  let last = performance.now();
  /** 0 while everything stands still, easing to 1 once started */
  let motion = 0;
  const at = { x: 0, y: 0, h: 0 };

  const layer = new ModelLayer('menu-models', proj, (l) => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000) * motion;
    last = now;
    solids.reset(); shadows.reset(); glows.reset();
    for (const c of cars) {
      c.d += c.v * dt;
      if (c.d > c.len) c.d -= c.len;
      pointAlong(c.pts, c.cum, c.d, at);
      // keep right
      const x = at.x + Math.sin(at.h) * 2.4, y = at.y - Math.cos(at.h) * 2.4;
      pushCar(solids, shadows, x, y, 0, at.h, 2.1, c.color, { taxi: c.taxi, lights: true });
      glows.push(x + Math.cos(at.h) * 12, y + Math.sin(at.h) * 12, 0.14, at.h, 30, 16, 0.02, 0xfff0c4, 0.9, 1);
    }
    l.solids.set(solids.data, solids.n);
    l.glows.set(glows.data, glows.n);
  });
  layer.night = 1;
  layer.lighting = { sun: [0.3, -0.4, 0.86], ambient: 0.5, diffuse: 0.25, tint: [0.62, 0.68, 0.9] };
  // thick enough that the far edge of the fenced map dissolves into the night
  layer.haze = [0.09, 0.08, 0.17, 0.92];
  layer.vignette = 0.38;

  if (ok) {
    // walls vary building to building; the height stands in for an id the tiles don't carry
    const pickWall = ['match', ['%', ['round', ['*', ['coalesce', ['get', 'render_height'], 0], 3.7]], WALLS.length],
      ...WALLS.slice(1).flatMap((c, i) => [i + 1, c]), WALLS[0]];
    map.addLayer({
      id: 'city-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
      paint: {
        'fill-extrusion-color': pickWall as never,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    map.setLight({ anchor: 'map', intensity: 0.5, color: '#b9c4ff', position: [1.2, 230, 38] });
    map.setSky({ 'sky-color': '#070a18', 'horizon-color': '#3a2a55', 'fog-color': '#2a2145', 'sky-horizon-blend': 0.8, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.8 });
    map.addLayer(layer);
  }

  const toLocal = (ring: number[][]) => {
    const out = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) { const p = proj.toLocal(ring[i][1], ring[i][0]); out[i * 2] = p[0]; out[i * 2 + 1] = p[1]; }
    return out;
  };

  // Footprints and streets gathered from every tile the orbit loads. Tiles
  // overlap at their edges and are visited more than once, hence the keys.
  const blocks = new Map<string, Block>();
  const streets = new Map<string, Street>();

  const collect = () => {
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const top = Number(f.properties.render_height) || 0, base = Number(f.properties.render_min_height) || 0;
      for (const poly of polys) {
        if (poly[0].length < 4) continue;
        const ring = toLocal(poly[0].slice(0, -1)), d = Math.hypot(ring[0], ring[1]);
        if (d > WINDOW_REACH) continue;
        const key = `${Math.round(ring[0])},${Math.round(ring[1])},${ring.length},${Math.round(top)}`;
        if (!blocks.has(key)) blocks.set(key, { ring, base, top, d, key });
      }
    }
    for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' })) {
      if (!STREETS.has(String(f.properties.class)) || f.properties.brunnel) continue;
      const g = f.geometry;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        if (line.length < 2) continue;
        const pts = toLocal(line), cum = polylineLengths(pts), len = cum[cum.length - 1];
        if (len < 40 || Math.hypot(pts[0], pts[1]) > REACH) continue;
        const key = `${Math.round(pts[0])},${Math.round(pts[1])},${Math.round(len)}`;
        if (!streets.has(key)) streets.set(key, { pts, cum, len, key });
      }
    }
  };

  /** Dress the city from everything collected: windows, lamps, traffic. Sorted, so it comes out the same every visit. */
  const dress = () => {
    const windows = new InstanceBuffer();
    // nearest first, so if the budget runs out it is the far edge that goes dark
    const near = [...blocks.values()].sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1));
    for (const b of near) {
      const seed = Math.round(b.ring[0] * 7 + b.ring[1] * 13) | 0;
      if (!pushWindows(b.ring, b.base, b.top, seed, 52, windows, 24000, b.top > 120 ? 150 : b.top > 45 ? 80 : 30, 1.6)) break;
    }

    const lampSolids = new InstanceBuffer(), lampLights = new InstanceBuffer(), pools = new InstanceBuffer();
    const next: Car[] = [];
    let n = 0;
    for (const { pts, cum, len } of [...streets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
      n++;
      for (let d = 18 + (n % 5) * 6; d < len - 10 && lampSolids.n < 3600; d += 40) {
        pointAlong(pts, cum, d, at);
        const side = (Math.round(d / 40) + n) % 2 ? 1 : -1;
        pushLamp(lampSolids, lampLights, pools, at.x - Math.sin(at.h) * 7 * side, at.y + Math.cos(at.h) * 7 * side, at.h + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 0.62, 34);
      }
      if (len > 90 && next.length < 170 && n % 2 === 0) {
        for (let k = 0; k < Math.min(3, Math.floor(len / 110)); k++) {
          const c = CAR_COLORS[(n + k * 3) % CAR_COLORS.length];
          next.push({ pts, cum, len, d: ((n * 37 + k * 71) % 100) / 100 * len, v: 7 + ((n + k) % 6), color: c, taxi: c === 0xf5b82e });
        }
      }
    }
    layer.windows.set(windows.data, windows.n);
    layer.propSolids.set(lampSolids.data, lampSolids.n);
    layer.propLights.set(lampLights.data, lampLights.n);
    layer.propPools.set(pools.data, pools.n);
    cars = next;
  };

  let alive = true;
  /** Resolves when the map has drawn everything it has been asked for (or after `ms`, on a bad connection). */
  const settled = (ms: number) => new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); map.off('idle', done); resolve(); };
    const timer = setTimeout(done, ms);
    map.once('idle', done);
    map.triggerRepaint();
  });

  if (ok) {
    // Look right round once, unseen, at the orbit's widest: every tile inside
    // the fence is loaded and the whole neighbourhood collected.
    for (const turn of [90, 180, 270, 0]) {
      if (!alive) break;
      map.jumpTo({ bearing: MENU_CAMERA.bearing + turn, zoom: zoomFor() - (turn ? BREATH : 0) });
      await settled(12000);
      collect();
    }
    if (alive) {
      dress();
      // and the dressed city has to be on screen, too
      await settled(4000);
    }
  }

  // a slow orbit, breathing in and out a little; both ease in from standstill
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, t0 = 0, prev = 0, phase = 0, started = false;
  const spin = (t: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (t - prev) / 1000);
    prev = t;
    if (!document.hidden) {
      const k = Math.min(1, (t - t0) / 3000);
      motion = k * k * (3 - 2 * k);
      phase += dt * motion;
      map.jumpTo({
        bearing: MENU_CAMERA.bearing + phase * TURN,
        zoom: zoomFor() - BREATH * (0.5 - 0.5 * Math.cos((phase / 31) * Math.PI * 2)),
      });
    }
    raf = requestAnimationFrame(spin);
  };
  // until it starts (and for good, if motion is unwelcome) the shot just follows the window's size
  const reframe = () => { if (!started) map.jumpTo({ zoom: zoomFor() }); };
  map.on('resize', reframe);

  return {
    start() {
      if (started || still || !alive) return;
      started = true;
      t0 = prev = performance.now();
      raf = requestAnimationFrame(spin);
    },
    debug: { map, layer, cars: () => cars.length },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      map.remove();
    },
  };
}
