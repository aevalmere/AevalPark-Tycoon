// Every tunable number in one place. Time is in game minutes; at 1× speed one
// real second is one game minute, so a game day lasts 24 real minutes.

import type { RoadClass } from '../world/types';

export const WORLD_RADIUS = 1000;

/** Vehicles move at a "visual" pace: metres per game minute per km/h of road speed. */
export const VIS_SPEED = 0.75;
export const WALK_SPEED = 7; // metres per game minute, visual pace

export const SIM_STEP = 1 / 60; // game minutes per fixed tick

export const SERVICE_LEVELS = [
  { radius: 380, cost: 0 },
  { radius: 560, cost: 18000 },
  { radius: 760, cost: 42000 },
  { radius: 1000, cost: 85000 },
];

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { label: string; money: number; patience: number; demand: number; blurb: string }> = {
  easy: { label: 'Relaxed', money: 40000, patience: 1.4, demand: 0.85, blurb: 'More cash, patient riders.' },
  normal: { label: 'Standard', money: 26000, patience: 1, demand: 1, blurb: 'The intended balance.' },
  hard: { label: 'Rush hour', money: 16000, patience: 0.75, demand: 1.25, blurb: 'Tight budget, impatient city.' },
};

export const START_ACTIVE = 4;
/** chance a delivered destination joins the network and starts sending riders */
export const ACTIVATE_ON_ARRIVAL = 0.4;
export const PATIENCE = 55;
export const PATIENCE_ASSIGNED_RATE = 0.35; // patience drains slower once a taxi is on its way
export const MAX_WAITING = 70;
export const MIN_TRIP = 140;
export const MAX_TRIP = 1100;

export const PARK_WALK_RADIUS = 260;
export const TAXI_LOT_RADIUS = 200;

export const TAXI = {
  base: 22,
  perKm: 30,
  pickupStop: 0.8,
  curbStop: 1.2,
  lotStop: 0.5,
};

export const CURB_INCIDENT = { slow: 0.4, reverseSlow: 0.18, minutes: 6 };

export const DWELL = { min: 40, max: 200 };

export const DEALER = {
  saleProfit: 1300,
  cap: 0.82,
  /** expected sales per active building per game hour at zero ownership */
  rate: 0.09,
};

export const RATING = {
  start: 3,
  /** EMA weight: responsive early, steadier once a company has history */
  alpha: (served: number) => 0.02 + 0.06 / (1 + served / 30),
  failScore: 0.6,
  gameOverBelow: 1.5,
  gameOverAfter: 1440,
};

export const BANKRUPT_AT = -15000;

/** Background congestion that arterial roads carry at peak, on top of simulated cars. */
export const BASE_LOAD: Record<RoadClass, [number, number]> = {
  motorway: [0.14, 0.32], trunk: [0.12, 0.3], primary: [0.1, 0.28], secondary: [0.06, 0.2],
  tertiary: [0.04, 0.12], minor: [0, 0.03], service: [0, 0],
};

export const CAR_SPACE = 7.5; // metres of lane per car at standstill
export const JAM_OCCUPANCY = 0.55;

export const NPC = { base: 14, perActive: 0.22, max: 130 };

export const ROAD_UPGRADE = { perMetre: 55, min: 1800, maxExtraLanes: 2 };

/** 0..1 congestion → speed multiplier */
export function speedFactor(traffic: number) {
  return Math.max(0.12, 1 - 0.88 * Math.pow(traffic, 1.4));
}

/** Smooth double-hump rush-hour curve over the hour of day, 0..1 */
export function rushCurve(hour: number) {
  const g = (mu: number, s: number) => Math.exp(-((hour - mu) ** 2) / (2 * s * s));
  return Math.min(1, g(8.25, 1.1) + g(17.5, 1.4));
}

/** Overall activity level by hour (night is quiet). */
export function activityCurve(hour: number) {
  const night = hour < 5.5 || hour > 23 ? 0.18 : hour < 7 ? 0.5 : hour > 21 ? 0.55 : 0.85;
  return Math.min(1.6, night + rushCurve(hour) * 0.75);
}
