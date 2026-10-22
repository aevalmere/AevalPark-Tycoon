// Lightweight 3D city maps for the menu backdrop and the HQ picker, using the
// basemap's own building heights (no game data needed).

import { Map as MlMap, type LngLatLike } from 'maplibre-gl';
import './maplibre';
import { loadBaseStyle, type MapStyle } from './style';

export async function createCityMap(container: HTMLElement, opts: { style: MapStyle; center: LngLatLike; zoom: number; pitch: number; bearing: number; interactive: boolean }): Promise<MlMap> {
  const { style, ok } = await loadBaseStyle(opts.style);
  const map = new MlMap({
    container,
    style,
    center: opts.center,
    zoom: opts.zoom,
    pitch: opts.pitch,
    bearing: opts.bearing,
    interactive: opts.interactive,
    attributionControl: { compact: true },
    maxPitch: 70,
    fadeDuration: 0,
  });
  await new Promise<void>((resolve) => map.once('load', () => resolve()));
  if (ok) {
    const dark = opts.style === 'dark';
    map.addLayer({
      id: 'city-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0],
          0, dark ? '#283244' : '#e4ded2', 40, dark ? '#38465f' : '#ece6da', 160, dark ? '#5c7099' : '#f5efe3'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    map.setLight({ anchor: 'map', intensity: dark ? 0.6 : 0.35, color: dark ? '#ffd9a8' : '#ffffff', position: [1.2, 210, 40] });
  }
  return map;
}
