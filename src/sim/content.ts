// Content registry. Adding a new buildable is a matter of adding a definition
// here and (if it has behaviour) a system that reads structures of its kind.

import type { WorldBuilding } from '../world/types';
import type { GameState, Structure, StructureKind } from './state';

export interface StructureDef {
  kind: StructureKind;
  name: string;
  verb: string;
  blurb: string;
  /** brand colour used for the 3D model, icons and map badges */
  color: string;
  maxLevel: number;
  levelNames: string[];
  cost(b: WorldBuilding): number;
  upgradeCost(s: Structure, b: WorldBuilding): number;
  upkeepPerDay(s: Structure, b: WorldBuilding): number;
  /** radius of influence for coverage overlays, metres (0 = none) */
  radius(s: Pick<Structure, 'level'>): number;
}

const round = (n: number, to = 50) => Math.round(n / to) * to;

export function parkingSpaces(b: WorldBuilding, level: number) {
  const perDeck = Math.max(6, Math.min(160, Math.round(b.area / 30)));
  return perDeck * level;
}

/** Taxi bays per level scale with the yard: a corner shop fits a couple of cabs, a warehouse lot a fleet. */
export function taxiBays(b: WorldBuilding) {
  return Math.max(2, Math.min(10, Math.round(b.area / 120)));
}

export function taxiCapacity(b: WorldBuilding, level: number) {
  return taxiBays(b) * level;
}

export function dealerRadius(level: number) {
  return 380 + level * 90;
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  taxi: {
    kind: 'taxi',
    name: 'Taxi Depot',
    verb: 'Open taxi depot',
    blurb: 'Dispatches taxis to riders without a car. Bigger buildings make bigger yards with more taxi bays. Kerbside drop-offs slow traffic unless a parking lot is near the destination.',
    color: '#f5b82e',
    maxLevel: 3,
    levelNames: ['Taxi stand', 'Taxi depot', 'Dispatch hub'],
    cost: (b) => round(Math.min(9000, 4200 + b.area * 0.9)),
    upgradeCost: (s) => [0, 6000, 14000][s.level] ?? Infinity,
    upkeepPerDay: (s) => 300 + (s.taxis ?? 0) * 150,
    radius: () => 0,
  },
  parking: {
    kind: 'parking',
    name: 'Parking Lot',
    verb: 'Convert to parking',
    blurb: 'Drivers park here and walk the last stretch. Also a taxi drop-off zone that keeps traffic flowing.',
    color: '#4f8cff',
    maxLevel: 4,
    levelNames: ['Surface lot', 'Two-level garage', 'Three-level garage', 'Parking tower'],
    cost: (b) => round(Math.min(24000, 2200 + b.area * 2.4 + b.height * 20)),
    upgradeCost: (s, b) => round(3500 * s.level + parkingSpaces(b, 1) * 110),
    upkeepPerDay: (s, b) => 120 + parkingSpaces(b, s.level) * 6,
    radius: () => 260,
  },
  dealership: {
    kind: 'dealership',
    name: 'Car Dealership',
    verb: 'Open dealership',
    blurb: 'Sells cars to customers nearby. More drivers means fewer taxi calls but more parking demand and traffic.',
    color: '#22c7a9',
    maxLevel: 3,
    levelNames: ['Showroom', 'Dealership', 'Auto mall'],
    cost: (b) => round(Math.min(22000, 11000 + b.area * 1.5)),
    upgradeCost: (s) => [0, 11000, 24000][s.level] ?? Infinity,
    upkeepPerDay: (s) => 600 + s.level * 250,
    radius: (s) => dealerRadius(s.level),
  },
};

export const STRUCTURE_ORDER: StructureKind[] = ['taxi', 'parking', 'dealership'];

export const TAXI_PRICE = 2600;

// ---------- goals ----------

export interface GoalDef {
  id: string;
  title: string;
  detail: string;
  reward: number;
  check(s: GameState): boolean;
}

const count = (s: GameState, kind: StructureKind) => Object.values(s.structures).filter((x) => x.kind === kind).length;
const me = (s: GameState) => s.companies[s.localPlayer];

export const GOALS: GoalDef[] = [
  { id: 'first_ride', title: 'First fare', detail: 'Get someone where they were going.', reward: 1500, check: (s) => s.stats.served >= 1 },
  { id: 'lot', title: 'Room to park', detail: 'Convert a building into a parking lot.', reward: 1200, check: (s) => count(s, 'parking') >= 1 },
  { id: 'served_25', title: 'Getting around', detail: 'Complete 25 trips.', reward: 3000, check: (s) => s.stats.served >= 25 },
  { id: 'dealer', title: 'Showroom floor', detail: 'Open a car dealership.', reward: 2500, check: (s) => count(s, 'dealership') >= 1 },
  { id: 'fleet_5', title: 'Fleet owner', detail: 'Own 5 taxis.', reward: 3500, check: (s) => Object.values(s.structures).reduce((n, x) => n + (x.taxis ?? 0), 0) >= 5 },
  { id: 'rating_4', title: 'Four stars', detail: 'Reach a 4.0 rating.', reward: 5000, check: (s) => me(s).rating >= 4 },
  { id: 'expand', title: 'New territory', detail: 'Expand your service area.', reward: 6000, check: (s) => s.serviceLevel >= 1 },
  { id: 'garage', title: 'Going up', detail: 'Upgrade a lot to a three-level garage.', reward: 6000, check: (s) => Object.values(s.structures).some((x) => x.kind === 'parking' && x.level >= 3) },
  { id: 'served_250', title: 'City mover', detail: 'Complete 250 trips.', reward: 12000, check: (s) => s.stats.served >= 250 },
  { id: 'network_80', title: 'Household name', detail: 'Serve 80 buildings in your network.', reward: 15000, check: (s) => Object.values(s.buildings).filter((b) => b.active).length >= 80 },
  { id: 'rating_48', title: 'Five-star operator', detail: 'Reach a 4.8 rating.', reward: 25000, check: (s) => me(s).rating >= 4.8 },
  { id: 'money_250k', title: 'Parking magnate', detail: 'Bank $250,000.', reward: 0, check: (s) => me(s).money >= 250000 },
];
