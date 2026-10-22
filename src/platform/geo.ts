// Location services: device geolocation and OpenStreetMap Nominatim search.
// (Request shapes follow ParkKing's start-point search.)

import type { LatLng } from '../core/geo';

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export interface Place extends LatLng {
  label: string;
  detail: string;
}

export function locateMe(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('This browser has no location access.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Location permission was denied. Search for an address instead.'
        : 'Could not get your location. Search for an address instead.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal });
  if (!res.ok) throw new Error('Search is unavailable right now.');
  const data: { lat: string; lon: string; display_name: string; name?: string }[] = await res.json();
  return data.map((d) => {
    const parts = d.display_name.split(', ');
    return { lat: +d.lat, lng: +d.lon, label: d.name || parts[0], detail: parts.slice(1, 4).join(', ') };
  });
}

/** Short "Neighbourhood, City" label for a point. Falls back to coordinates. */
export async function placeName(p: LatLng): Promise<string> {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?lat=${p.lat}&lon=${p.lng}&format=jsonv2&zoom=16&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error();
    const d = await res.json();
    const a = d.address || {};
    const area = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.road;
    const city = a.city || a.town || a.village || a.municipality || a.county;
    return [area, city].filter(Boolean).join(', ') || d.name || fmt(p);
  } catch {
    return fmt(p);
  }
}

const fmt = (p: LatLng) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;

export const FEATURED: (LatLng & { label: string; detail: string })[] = [
  { label: 'Times Square', detail: 'New York', lat: 40.758, lng: -73.9855 },
  { label: 'Shibuya', detail: 'Tokyo', lat: 35.6595, lng: 139.7005 },
  { label: 'Le Marais', detail: 'Paris', lat: 48.8592, lng: 2.3622 },
  { label: 'Soho', detail: 'London', lat: 51.5136, lng: -0.1365 },
  { label: 'Mission District', detail: 'San Francisco', lat: 37.7599, lng: -122.4148 },
  { label: 'Downtown', detail: 'Toronto', lat: 43.6487, lng: -79.3817 },
  { label: 'CBD', detail: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { label: 'Cupertino', detail: 'California suburbs', lat: 37.3229, lng: -122.0322 },
];
