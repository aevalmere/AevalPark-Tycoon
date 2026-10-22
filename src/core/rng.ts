// Seeded randomness. The state is a plain object stored inside GameState so a
// save (or a future server) reproduces the same sequence.

export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 || 0x9e3779b9 };
}

/** mulberry32 */
export function rand(r: RngState): number {
  let t = (r.s = (r.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (r: RngState, a: number, b: number) => a + (b - a) * rand(r);
export const randInt = (r: RngState, a: number, b: number) => Math.floor(a + (b - a + 1) * rand(r));
export const chance = (r: RngState, p: number) => rand(r) < p;

export function pick<T>(r: RngState, arr: readonly T[]): T {
  return arr[Math.floor(rand(r) * arr.length)];
}

export function weightedPick<T>(r: RngState, items: readonly T[], weight: (item: T) => number): T | undefined {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return undefined;
  let x = rand(r) * total;
  for (const it of items) {
    x -= Math.max(0, weight(it));
    if (x <= 0) return it;
  }
  return items[items.length - 1];
}

/** Knuth's method; fine for the small rates the simulation uses. */
export function poisson(r: RngState, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(r); } while (p > L && k < 50);
  return k - 1;
}

/** FNV-1a, for stable ids derived from geometry. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
