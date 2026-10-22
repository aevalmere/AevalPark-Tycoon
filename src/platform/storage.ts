// Save slots in localStorage. Cookies cap out around 4 KB, far too small for a
// company, so slots store a compressed save code (typically 5–40 KB) and a
// small summary index used to draw the slot cards without decoding anything.

import type { GameState } from '../sim/state';
import { dayOf } from '../sim/state';
import { decodeSave, encodeSave } from './saveCode';

export const SLOT_COUNT = 4;
const KEY = (slot: number) => `aevalpark.v1.slot.${slot}`;
const INDEX = 'aevalpark.v1.index';

export interface SlotSummary {
  slot: number;
  company: string;
  city: string;
  day: number;
  money: number;
  rating: number;
  served: number;
  savedAt: number;
  playMs: number;
  gameOver: boolean;
}

function readIndex(): Record<number, SlotSummary> {
  try {
    return JSON.parse(localStorage.getItem(INDEX) || '{}');
  } catch {
    return {};
  }
}

function writeIndex(idx: Record<number, SlotSummary>) {
  try { localStorage.setItem(INDEX, JSON.stringify(idx)); } catch { /* storage full or blocked; the slot write already reported */ }
}

export function listSlots(): (SlotSummary | null)[] {
  const idx = readIndex();
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const s = idx[i];
    // a summary without its save (cleared storage) is not a usable slot
    try { return s && localStorage.getItem(KEY(i)) ? s : null; } catch { return null; }
  });
}

function summarize(slot: number, state: GameState): SlotSummary {
  const me = state.companies[state.localPlayer];
  return {
    slot,
    company: state.meta.company,
    city: state.meta.city,
    day: dayOf(state.time),
    money: me.money,
    rating: me.rating,
    served: state.stats.served,
    savedAt: Date.now(),
    playMs: state.meta.playMs,
    gameOver: !!state.gameOver,
  };
}

export async function saveToSlot(slot: number, state: GameState): Promise<void> {
  const code = await encodeSave(state);
  try {
    localStorage.setItem(KEY(slot), code);
  } catch {
    throw new Error('Your browser refused to store the save (storage full or disabled). Copy the save code instead.');
  }
  const idx = readIndex();
  idx[slot] = summarize(slot, state);
  writeIndex(idx);
}

export async function loadSlot(slot: number): Promise<GameState> {
  const code = localStorage.getItem(KEY(slot));
  if (!code) throw new Error('That slot is empty.');
  return decodeSave(code);
}

export function slotCode(slot: number): string | null {
  try { return localStorage.getItem(KEY(slot)); } catch { return null; }
}

export function deleteSlot(slot: number) {
  try { localStorage.removeItem(KEY(slot)); } catch { /* nothing to remove */ }
  const idx = readIndex();
  delete idx[slot];
  writeIndex(idx);
}

export function firstFreeSlot(): number {
  const slots = listSlots();
  const free = slots.findIndex((s) => !s);
  if (free >= 0) return free;
  // all full: suggest the oldest
  let oldest = 0;
  slots.forEach((s, i) => { if (s && s.savedAt < (slots[oldest]?.savedAt ?? Infinity)) oldest = i; });
  return oldest;
}

// ---------- settings ----------

export interface Settings {
  mapStyle: 'light' | 'dark';
  dayNight: boolean;
  sound: boolean;
  volume: number;
  units: 'metric' | 'imperial';
  autosave: boolean;
}

const SETTINGS = 'aevalpark.v1.settings';
const DEFAULT_SETTINGS: Settings = { mapStyle: 'light', dayNight: true, sound: true, volume: 0.5, units: 'metric', autosave: true };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* settings are a convenience */ }
}
