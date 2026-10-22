// The persistent game state. Everything here is plain JSON so it can be saved,
// turned into a save code, or (later) sent over the wire to other players.
// Anything that can be recomputed (vehicles in motion, traffic levels) lives
// in the Simulation runtime instead.

import type { LatLng } from '../core/geo';
import { createRng, type RngState } from '../core/rng';
import { DIFFICULTY, RATING, type Difficulty } from './balance';

export const STATE_VERSION = 1;

export type StructureKind = 'parking' | 'dealership' | 'taxi';

export interface ParkedCar {
  home: string;
  until: number;
  color: number;
}

export interface Structure {
  id: string;
  kind: StructureKind;
  owner: string;
  building: string;
  level: number;
  builtAt: number;
  revenue: number;
  /** footprint remembered so the structure survives map-data changes between sessions */
  ring: number[];
  height: number;
  // parking
  fee?: number;
  parked?: ParkedCar[];
  // taxi
  taxis?: number;
  // dealership
  sales?: number;
}

export type TripStatus = 'waiting' | 'pickup' | 'riding';
export type WaitReason = 'taxi' | 'parking' | null;

export interface Trip {
  id: string;
  origin: string;
  dest: string;
  createdAt: number;
  patience: number;
  /** patience used so far (drains slower once a taxi is assigned) */
  waited: number;
  hasCar: boolean;
  status: TripStatus;
  reason: WaitReason;
  mode?: 'car' | 'taxi';
  /** game minute the rider got moving */
  departedAt?: number;
  scripted?: boolean;
}

export interface Company {
  id: string;
  name: string;
  color: string;
  money: number;
  rating: number;
  revenue: number;
  expenses: number;
}

export interface Incident {
  id: string;
  link: string;
  edge: number;
  x: number;
  y: number;
  until: number;
}

export interface BuildingState {
  active: boolean;
  since: number;
  car: number;
}

export interface HistoryPoint {
  t: number;
  traffic: number;
  money: number;
  rating: number;
  waiting: number;
}

export interface DayRecord {
  day: number;
  revenue: number;
  expenses: number;
  served: number;
  failed: number;
  rating: number;
}

export interface GameStats {
  served: number;
  failed: number;
  carTrips: number;
  taxiTrips: number;
  curbDrops: number;
  lotDrops: number;
  carsSold: number;
  today: { revenue: number; expenses: number; served: number; failed: number };
}

export interface GameMeta {
  company: string;
  city: string;
  origin: LatLng;
  difficulty: Difficulty;
  createdAt: number;
  worldKey: string;
  tileset?: string;
  playMs: number;
}

export interface GameState {
  v: number;
  meta: GameMeta;
  rng: RngState;
  nextId: number;
  /** game minutes since midnight of day 1 */
  time: number;
  speed: number;
  localPlayer: string;
  companies: Record<string, Company>;
  serviceLevel: number;
  buildings: Record<string, BuildingState>;
  structures: Record<string, Structure>;
  trips: Record<string, Trip>;
  incidents: Incident[];
  /** extra lanes per link id */
  roads: Record<string, number>;
  fareMult: number;
  stats: GameStats;
  history: HistoryPoint[];
  days: DayRecord[];
  goals: string[];
  /** tutorial step, or -1 when finished/skipped */
  tutorial: number;
  lowRatingSince: number | null;
  gameOver: null | 'bankrupt' | 'rating';
}

const PLAYER_COLORS = ['#e8a33d', '#4f8cff', '#22c7a9', '#f06292'];

export function createState(opts: {
  company: string;
  city: string;
  origin: LatLng;
  difficulty: Difficulty;
  worldKey: string;
  tileset?: string;
  seed: number;
}): GameState {
  const d = DIFFICULTY[opts.difficulty];
  return {
    v: STATE_VERSION,
    meta: {
      company: opts.company,
      city: opts.city,
      origin: opts.origin,
      difficulty: opts.difficulty,
      createdAt: Date.now(),
      worldKey: opts.worldKey,
      tileset: opts.tileset,
      playMs: 0,
    },
    rng: createRng(opts.seed),
    nextId: 1,
    time: 7 * 60,
    speed: 1,
    localPlayer: 'p1',
    companies: {
      p1: { id: 'p1', name: opts.company, color: PLAYER_COLORS[0], money: d.money, rating: RATING.start, revenue: 0, expenses: 0 },
    },
    serviceLevel: 0,
    buildings: {},
    structures: {},
    trips: {},
    incidents: [],
    roads: {},
    fareMult: 1,
    stats: { served: 0, failed: 0, carTrips: 0, taxiTrips: 0, curbDrops: 0, lotDrops: 0, carsSold: 0, today: { revenue: 0, expenses: 0, served: 0, failed: 0 } },
    history: [],
    days: [],
    goals: [],
    tutorial: 0,
    lowRatingSince: null,
    gameOver: null,
  };
}

export function newId(s: GameState, prefix: string) {
  return prefix + (s.nextId++).toString(36);
}

export const dayOf = (t: number) => Math.floor(t / 1440) + 1;
export const hourOf = (t: number) => (t % 1440) / 60;
