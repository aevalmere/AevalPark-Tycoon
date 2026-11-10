// Basemap: OpenFreeMap vector styles recoloured into a softer "game board"
// palette, with clutter (POIs, house numbers) removed. Falls back to a plain
// background when the style can't be fetched; the game draws its own roads then.

import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

export type MapStyle = 'light' | 'dark';

const URLS: Record<MapStyle, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

type Paint = Record<string, unknown>;
// Ground the colour of real pavement and asphalt, so buildings and cars stand on something.
const PALETTE: Record<MapStyle, Record<string, Paint>> = {
  light: {
    background: { 'background-color': '#e6e3d8' },
    park: { 'fill-color': '#b9dba0' },
    landuse_park: { 'fill-color': '#b9dba0' },
    landcover_wood: { 'fill-color': '#a3cf8f', 'fill-opacity': 0.9 },
    water: { 'fill-color': '#86c1e6' },
    waterway: { 'line-color': '#86c1e6' },
    landuse_residential: { 'fill-color': '#e9e5d9' },
    building: { 'fill-color': '#d9d4c8', 'fill-outline-color': '#cbc5b8' },
    highway_path: { 'line-color': '#f3efe4' },
    highway_minor: { 'line-color': '#c5cad1' },
    highway_major_inner: { 'line-color': '#b4bac3' },
    highway_major_casing: { 'line-color': '#f4f1e8' },
    highway_major_subtle: { 'line-color': '#b4bac3' },
    highway_motorway_inner: { 'line-color': '#a4abb6' },
    highway_motorway_casing: { 'line-color': '#f4f1e8' },
    highway_motorway_subtle: { 'line-color': '#a4abb6' },
    highway_motorway_bridge_inner: { 'line-color': '#a4abb6' },
    road_area_pier: { 'fill-color': '#ddd8cb' },
    road_pier: { 'line-color': '#ddd8cb' },
  },
  dark: {
    background: { 'background-color': '#10151d' },
    water: { 'fill-color': '#15304a' },
    park: { 'fill-color': '#15281b' },
    landuse_park: { 'fill-color': '#15281b' },
    landcover_wood: { 'fill-color': '#15281b' },
    landuse_residential: { 'fill-color': '#131921' },
    building: { 'fill-color': '#1a212b' },
    highway_minor: { 'line-color': '#2a3242' },
    highway_major_inner: { 'line-color': '#3a465c' },
    highway_major_casing: { 'line-color': '#222a38' },
  },
};

const DROP_SOURCE_LAYERS = new Set(['poi', 'housenumber', 'aerodrome_label', 'mountain_peak']);

export interface LoadedStyle {
  style: StyleSpecification;
  /** first label layer: game layers that should sit under labels go before it */
  labelBefore?: string;
  ok: boolean;
}

// The menu, the HQ picker and the game all start from the same style; fetch it once per page.
const fetched = new Map<MapStyle, Promise<StyleSpecification>>();

function fetchStyle(kind: MapStyle): Promise<StyleSpecification> {
  let p = fetched.get(kind);
  if (!p) {
    p = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      try {
        const res = await fetch(URLS[kind], { signal: ctl.signal });
        if (!res.ok) throw new Error(`style ${res.status}`);
        return (await res.json()) as StyleSpecification;
      } finally {
        clearTimeout(timer);
      }
    })();
    p.catch(() => fetched.delete(kind));
    fetched.set(kind, p);
  }
  return p;
}

export async function loadBaseStyle(kind: MapStyle): Promise<LoadedStyle> {
  try {
    const style = structuredClone(await fetchStyle(kind));
    const pal = PALETTE[kind];
    style.layers = style.layers.filter((l) => {
      const sl = (l as { 'source-layer'?: string })['source-layer'];
      return !(sl && DROP_SOURCE_LAYERS.has(sl)) && !l.id.startsWith('road_oneway') && !l.id.includes('shield');
    });
    for (const l of style.layers as (LayerSpecification & { paint?: Paint })[]) {
      const p = pal[l.id];
      if (p) l.paint = { ...(l.paint ?? {}), ...p };
    }
    const label = style.layers.find((l) => l.type === 'symbol');
    return { style, labelBefore: label?.id, ok: true };
  } catch (e) {
    console.warn('[map] basemap style unavailable, using a plain background', e);
    return {
      ok: false,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': kind === 'dark' ? '#10151d' : '#eef0e9' } }],
      },
    };
  }
}

/**
 * Drawn building height. Real towers would bury the streets the game is
 * about, so everything above a few storeys is compressed. Monotonic, so
 * skylines keep their shape.
 */
export function visualHeight(h: number) {
  return h <= 18 ? h : 18 + (h - 18) * 0.38;
}

// ---------- building colours ----------
// No textures: a city reads as real when its walls and roofs vary. Each kind
// of building draws from its own small palette, picked by a stable hash.

const WALLS: Record<string, string[]> = {
  house: ['#ead9c4', '#e2c7ae', '#d7b49c', '#efe6d6', '#d2bfad', '#c9a48d'],
  apartment: ['#e3d6c6', '#d6c8ba', '#e7ded1', '#ccc0b3', '#dccdb8', '#c7b3a2'],
  office: ['#c9d6e3', '#b9cbdd', '#e3d8c6', '#d9c7b0', '#d9e0e6', '#c9b29c', '#e8e2d6', '#bda592', '#cfd4d9', '#d6b9a4'],
  shop: ['#eedfc8', '#e7d0bd', '#e3dcc6', '#f0e4d2', '#dccbbb'],
  food: ['#eedfc8', '#e9cdb6', '#e3dcc6', '#f0e4d2'],
  civic: ['#e9e3d3', '#ddd6c4', '#e4dccb'],
  leisure: ['#e6dcc8', '#dfe3d0'],
  hotel: ['#e4d6c8', '#d5c5b9', '#cfd6df'],
  industrial: ['#d5d3cc', '#c9c8c2', '#cfc6ba'],
};
const ROOFS: Record<string, string[]> = {
  house: ['#a8654e', '#8f5b4b', '#7b6b63', '#9b7a66', '#6f7780'],
  apartment: ['#9c9a94', '#8a8f96', '#a8a39a', '#93867c'],
  office: ['#9aa3ad', '#b3b0a8', '#8b96a3', '#a79f95', '#c2beb5', '#8f8a86'],
  shop: ['#a39686', '#8f8a84', '#b0a090'],
  food: ['#a39686', '#9a6f5c', '#b0a090'],
  civic: ['#7f9a8c', '#94a39a', '#8c8f95'],
  leisure: ['#9aa58c', '#a39d90'],
  hotel: ['#8e8680', '#7e8792'],
  industrial: ['#8f949a', '#9d9a92'],
};

export interface BuildingColors { wall: string; roof: string; wallOut: string; roofOut: string }

export function buildingColors(idx: number, kind: string, height: number, mapStyle: MapStyle): BuildingColors {
  const h = Math.imul(idx + 1, 2654435761) >>> 0;
  // towers read as glass and steel whatever they hold
  const k = height > 45 && kind !== 'house' ? 'office' : kind;
  const walls = WALLS[k] ?? WALLS.apartment, roofs = ROOFS[k] ?? ROOFS.apartment;
  let wall = walls[h % walls.length], roof = roofs[(h >>> 8) % roofs.length];
  if (mapStyle === 'dark') { wall = mixHex(wall, '#1b2330', 0.74); roof = mixHex(roof, '#141a24', 0.7); }
  const dim = mapStyle === 'dark' ? '#171c24' : '#d3d2cd';
  return { wall, roof, wallOut: mixHex(wall, dim, 0.62), roofOut: mixHex(roof, dim, 0.55) };
}

// ---------- structure shapes (shared by the extrusions and the 3D models) ----------

/** paving height of a taxi yard or dealer forecourt */
export const YARD_HEIGHT = 0.3;
/** a surface lot's slab, and each garage deck above it */
export const LOT_BASE = 0.6;
export const DECK_HEIGHT = 3.2;

/** Height parked cars sit at on a structure: the top deck of a garage, or the paving of a yard. */
export function deckZ(kind: 'parking' | 'taxi' | 'dealership', level: number) {
  return kind === 'parking' ? LOT_BASE + (level - 1) * DECK_HEIGHT : YARD_HEIGHT;
}

// ---------- game palette (shared by 3D layers and UI) ----------

export const COLORS = {
  inactive: '#f2eee6',
  outside: '#dcd8d0',
  active: '#f6b85c',
  activeRoof: '#fbd699',
  hqRoof: '#f4c063',
  hq: '#e8a33d',
  lot: '#5d6776',
  garage: '#8fa3c7',
  /** forecourt and yard paving, so the showroom and cabs on them read as objects */
  dealer: '#3aa58f',
  taxi: '#c99a3a',
  valid: '#7fdca5',
  invalid: '#f08f8f',
  select: '#fff1c2',
  /** customers a selected lot or dealership reaches */
  reachLot: '#9cc0ff',
  reachDealer: '#8fe3cf',
};

export const DARK_COLORS: typeof COLORS = {
  ...COLORS,
  inactive: '#3a4250',
  outside: '#2a303a',
  active: '#c98d45',
  activeRoof: '#dba25a',
  hqRoof: '#f0b455',
};

/** traffic ramp, 0 = free flowing, 1 = gridlock */
export const TRAFFIC_STOPS: [number, string][] = [
  [0, '#2fbf71'],
  [0.3, '#a9d13b'],
  [0.5, '#f2bd33'],
  [0.68, '#f07b2e'],
  [0.85, '#dc3a3a'],
  [1, '#8e1b2b'],
];

export function trafficColor(t: number): string {
  for (let i = 1; i < TRAFFIC_STOPS.length; i++) {
    if (t <= TRAFFIC_STOPS[i][0]) {
      const [t0, c0] = TRAFFIC_STOPS[i - 1], [t1, c1] = TRAFFIC_STOPS[i];
      return mixHex(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return TRAFFIC_STOPS[TRAFFIC_STOPS.length - 1][1];
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
