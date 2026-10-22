// Events the simulation emits. The UI, sound and effects layers listen; a
// future network layer can forward the same stream to remote players.

import type { GoalDef } from './content';
import type { StructureKind } from './state';

export type GameEvent =
  | { type: 'trip:new'; trip: string; origin: number; dest: number; hasCar: boolean }
  | { type: 'trip:done'; trip: string; mode: 'car' | 'taxi'; score: number; amount: number; x: number; y: number; z: number; curb: boolean }
  | { type: 'trip:fail'; trip: string; reason: 'taxi' | 'parking' | null; x: number; y: number; z: number }
  | { type: 'money'; amount: number; x: number; y: number; z: number; label?: string }
  | { type: 'sale'; structure: string; amount: number; x: number; y: number; z: number }
  | { type: 'activate'; building: number }
  | { type: 'incident'; link: number; x: number; y: number }
  | { type: 'built'; structure: string; kind: StructureKind; building: number }
  | { type: 'removed'; structure: string; building: number }
  | { type: 'upgraded'; structure: string; level: number }
  | { type: 'goal'; goal: GoalDef }
  | { type: 'expand'; level: number; radius: number }
  | { type: 'road'; link: number; lanes: number }
  | { type: 'notice'; level: 'info' | 'warn' | 'bad' | 'good'; text: string; focus?: { x: number; y: number } }
  | { type: 'day'; day: number }
  | { type: 'gameover'; reason: 'bankrupt' | 'rating' };

type Listener = (e: GameEvent) => void;

export class Emitter {
  private listeners = new Set<Listener>();
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  emit(e: GameEvent) {
    for (const fn of this.listeners) fn(e);
  }
}
