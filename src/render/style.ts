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
const PALETTE: Record<MapStyle, Record<string, Paint>> = {
  light: {
    background: { 'background-color': '#eef0e9' },
    park: { 'fill-color': '#d6e7cc' },
    landuse_park: { 'fill-color': '#d6e7cc' },
    landcover_wood: { 'fill-color': '#cfe2c4', 'fill-opacity': 0.8 },
    water: { 'fill-color': '#a8cde4' },
    landuse_residential: { 'fill-color': '#ebe8e0' },
    building: { 'fill-color': '#e0dcd2', 'fill-outline-color': '#d3cec3' },
    highway_minor: { 'line-color': '#ffffff' },
    highway_major_inner: { 'line-color': '#ffffff' },
    highway_major_casing: { 'line-color': '#d4d7dc' },
    highway_major_subtle: { 'line-color': '#e6e6e2' },
  },
  dark: {
    background: { 'background-color': '#10151d' },
    water: { 'fill-color': '#182838' },
    landuse_park: { 'fill-color': '#132018' },
    landcover_wood: { 'fill-color': '#132018' },
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
  active: '#f4c27f',
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

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
