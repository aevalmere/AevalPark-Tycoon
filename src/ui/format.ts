import { dayOf, hourOf } from '../sim/state';

export const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

export const compactMoney = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return money(n);
};

export function clock(t: number) {
  const h = Math.floor(hourOf(t)), m = Math.floor(t % 60);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export const dayLabel = (t: number) => `Day ${dayOf(t)}`;

export function distance(m: number, units: 'metric' | 'imperial') {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    return ft < 1000 ? `${Math.round(ft / 10) * 10} ft` : `${(m / 1609.34).toFixed(1)} mi`;
  }
  return m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`;
}

export function playtime(ms: number) {
  const min = Math.floor(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function ago(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ADJ = ['Crown', 'Velvet', 'Swift', 'Golden', 'Metro', 'Royal', 'Neon', 'Harbor', 'Summit', 'Liberty', 'Copper', 'Union'];
const NOUN = ['Parking Co.', 'Transit', 'Mobility', 'Motors', 'Curbside', 'Lots & Cabs', 'Rides', 'Garages'];
export const randomCompany = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
