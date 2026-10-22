// Minimal external store for UI state. The simulation lives outside React;
// the HUD reads a snapshot that the session refreshes a few times a second.

import { useSyncExternalStore } from 'react';
import type { StructureKind } from '../sim/state';

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export type Store<T extends object> = ReturnType<typeof createStore<T>>;

export function useStore<T extends object, U>(store: Store<T>, select: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

export type Tool = 'select' | StructureKind | 'road';

export type Selection =
  | { kind: 'building'; idx: number }
  | { kind: 'trip'; id: string }
  | { kind: 'link'; idx: number };

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'bad' | 'good';
  text: string;
  focus?: { x: number; y: number };
  at: number;
}

export interface Hud {
  money: number;
  rating: number;
  time: number;
  speed: number;
  waiting: number;
  needTaxi: number;
  needParking: number;
  served: number;
  failed: number;
  traffic: number;
  active: number;
  goals: number;
  gameOver: null | 'bankrupt' | 'rating';
  tutorial: number;
  serviceLevel: number;
  lowRating: boolean;
}

export type Panel = null | 'goals' | 'stats' | 'menu' | 'settings' | 'help';

export interface GameUi {
  tool: Tool;
  selection: Selection | null;
  hover: { kind: 'building' | 'link'; idx: number; x: number; y: number } | null;
  toasts: Toast[];
  panel: Panel;
  trafficView: boolean;
  hud: Hud;
  /** bumps a few times a second so detail panels re-read the simulation */
  tick: number;
}

export const emptyHud: Hud = {
  money: 0, rating: 3, time: 0, speed: 1, waiting: 0, needTaxi: 0, needParking: 0, served: 0, failed: 0,
  traffic: 0, active: 0, goals: 0, gameOver: null, tutorial: -1, serviceLevel: 0, lowRating: false,
};
