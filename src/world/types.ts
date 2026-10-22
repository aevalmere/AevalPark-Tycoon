import type { LatLng, LocalProjection } from '../core/geo';
import type { GridIndex } from '../core/spatial';

// ---------- raw input (from vector tiles or the synthetic generator) ----------
// All coordinates are flat [x0, y0, x1, y1, ...] arrays in local metres.

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'minor' | 'service';

export interface RawLine {
  pts: number[];
  cls: RoadClass;
  oneway: -1 | 0 | 1;
  /** bridge or tunnel: only connects to roads at the same level */
  brunnel: boolean;
  layer: number;
}

export interface RawPolygon {
  ring: number[];
  holes: number[][];
}

export interface RawBuilding extends RawPolygon {
  height: number;
  minHeight: number;
}

export interface RawPoi {
  x: number;
  y: number;
  cls: string;
  name: string;
}

export interface RawLabel {
  x: number;
  y: number;
  text: string;
}

export interface RawNamedLine {
  pts: number[];
  name: string;
}

export interface RawLanduse extends RawPolygon {
  cls: string;
}

export interface RawWorld {
  origin: LatLng;
  radius: number;
  source: 'tiles' | 'synthetic';
  tileset?: string;
  lines: RawLine[];
  buildings: RawBuilding[];
  pois: RawPoi[];
  housenumbers: RawLabel[];
  names: RawNamedLine[];
  landuse: RawLanduse[];
}

// ---------- built world (static; derived, never saved) ----------

export interface RoadLink {
  idx: number;
  /** stable across reloads of the same data; used to persist road upgrades */
  id: string;
  a: number;
  b: number;
  pts: Float64Array;
  cum: Float64Array;
  length: number;
  cls: RoadClass;
  oneway: -1 | 0 | 1;
  /** lanes per direction before upgrades */
  lanes: number;
  /** free-flow speed, km/h */
  kmh: number;
  name: string;
  bridge: boolean;
}

export interface RoadEdge {
  idx: number;
  link: number;
  /** +1 travels a→b along the link geometry, -1 travels b→a */
  dir: 1 | -1;
  from: number;
  to: number;
  length: number;
}

/** A point on the road network: a link and a distance from its `a` end. */
export interface LinkPos {
  link: number;
  offset: number;
}

export type BuildingKind =
  | 'house' | 'apartment' | 'office' | 'shop' | 'food' | 'civic' | 'leisure' | 'hotel' | 'industrial';

export interface WorldBuilding {
  idx: number;
  id: string;
  ring: Float64Array;
  holes: Float64Array[];
  cx: number;
  cy: number;
  area: number;
  height: number;
  minHeight: number;
  kind: BuildingKind;
  name: string;
  street: string;
  /** false for building parts and footprints with no reachable road */
  playable: boolean;
  access: (LinkPos & { x: number; y: number; d: number }) | null;
  /** base trips generated per game hour */
  trips: number;
  /** relative pull as a destination */
  attract: number;
}

export interface World {
  key: string;
  origin: LatLng;
  radius: number;
  source: 'tiles' | 'synthetic';
  tileset?: string;
  proj: LocalProjection;
  nodeX: Float64Array;
  nodeY: Float64Array;
  nodeOut: number[][];
  links: RoadLink[];
  edges: RoadEdge[];
  /** directed edges belonging to each link */
  linkEdges: number[][];
  linkById: Map<string, number>;
  buildings: WorldBuilding[];
  buildingById: Map<string, number>;
  hq: number;
  linkGrid: GridIndex;
  buildingGrid: GridIndex;
  /** share of residents who own a car before any dealership */
  baseCarOwnership: number;
}
