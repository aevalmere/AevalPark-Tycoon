# Architecture

## The shape

```
            ┌──────────── pure TypeScript, no DOM ────────────┐
 tiles ──▶  world/  ──▶  World (roads graph, buildings)        │
            │                    │                             │
 UI ──Command──▶ Transport ──▶ sim/Simulation ──GameEvent──▶ UI, sound, effects
            │                    │ GameState (JSON)            │
            └────────────────────┼─────────────────────────────┘
                                 ▼
                     render/ reads, never writes
```

- **World** is static and derived: the road graph and building footprints built from vector tiles. It is never saved; the tiles are cached and the world rebuilt.
- **GameState** (`sim/state.ts`) is everything persistent, as plain JSON: companies, structures, activated buildings, waiting riders, road upgrades, stats, RNG state.
- **Simulation runtime** holds what can be recomputed: vehicles in motion, per-edge traffic, walkers. Saves settle in-flight trips instead of serialising vehicles, which keeps save codes small.
- **Commands** (`sim/commands.ts`) are the only way to change state. The UI sends them through a `Transport`.
- **Events** (`sim/events.ts`) flow out to the UI, sound and the effects overlay.

## Time

One real second at 1× is one game minute. The sim steps at a fixed 1/60 game minute; the renderer interpolates vehicles between ticks. Vehicles move at a "visual" pace (`VIS_SPEED` in `sim/balance.ts`) so a 1 km drive takes about half a minute on screen.

## World building (`world/`)

`tiles.ts` decodes OpenMapTiles z14 tiles. Vector tiles simplify geometry, which drops the shared vertex at many real intersections, so `graph.ts`:

1. merges vertices within 0.9 m (stitches tile edges),
2. snaps dangling road ends within 2.5 m onto the nearest road (T-junctions),
3. splits roads where they cross on the same level (bridges and tunnels only meet their own level),
4. keeps the largest strongly connected component, so every route has an answer.

`build.ts` classifies buildings from POIs and land use, names them from POIs or house number + street, links each to its nearest road position, and picks the HQ. `synthetic.ts` generates a city when tiles are unreachable.

## Simulation (`sim/`)

- `router.ts`: A* over directed edges weighted by live travel time, starting and ending part-way along a road. Scratch arrays are reused between searches.
- `systems.ts`: periodic systems in a registry: traffic, patience, dispatch, NPC traffic, demand, tutorial, parking turnover, dealer sales, goals, growth, stats, calendar, economy, game-over checks.
- `content.ts`: structure definitions (costs, upkeep, levels, radius, taxi bays by footprint) and goals.
- `advisor.ts`: what a structure would do on a given site (reach, unmet demand, overlap, upkeep). Build previews read it.
- Unmet demand is remembered in the runtime (`parkDemand`, `taxiDemand`: building id → recent misses) and fades every half hour. It is not saved.
- `balance.ts`: every tunable number.

Traffic per directed edge is `1 − (1 − occupancy)(1 − background)(1 − incident)`, smoothed. Speed is `speedFactor(traffic)`. Kerbside taxi drops add an incident to the edge (and a smaller one to the reverse edge) for a few minutes.

## Rendering (`render/`)

- `MapView.ts`: MapLibre map. District buildings are one GeoJSON `fill-extrusion` layer whose colour and height come from **feature-state** (role, level, hover, selection, build preview), so changes never re-upload geometry. Traffic is one line per direction of travel, coloured by feature-state, updated only for edges whose rounded level changed.
- `ModelLayer.ts`: a WebGL2 custom layer in MapLibre's 3D pass. Cars, taxis, people, parked cars, depot offices and showrooms are instanced boxes in local metres; one matrix maps local metres to clip space, and the depth buffer is shared with the building extrusions so towers hide what's behind them. Three passes: blended ground decals (shadows, selection halos), opaque solids, then glass.
- `layout.ts`: where things go inside a converted footprint (stalls and their paint, a depot's office and bays, a showroom, a lot's booth facing the street). Computed once per structure.
- `Overlay.ts`: a 2D canvas for UI drawn in world space (rider bubbles, badges, floating money, incident pulses, night glows, selection outlines, demand heat), projected with the same matrix. Anything with a blur or gradient is rendered once into a sprite and stamped each frame.
- `GameRenderer.ts`: glue; reads the simulation, writes to the layers above, highlights the selection and the vehicles tied to it, runs day/night lighting. It stops requesting repaints while the game is paused with nothing selected.

Feature-state writes make MapLibre re-upload paint buffers, so `MapView` only writes when a value actually changes. Graphics quality (`mapQuality`) caps the canvas pixel ratio and, on Fast, drops antialiasing, contact shadows and glows.
- `style.ts`: the basemap palette, game colours, and `visualHeight`, which compresses tall towers so downtown streets stay visible.

## Extending

**A new structure** (say, an EV charging hub):
1. Add the kind to `StructureKind` in `sim/state.ts` and a definition to `STRUCTURES` in `sim/content.ts`.
2. Give it behaviour with a new entry in `SYSTEMS` (or hook it into dispatch in `assignSystem`).
3. Add a role colour in `render/style.ts` / `MapView.ts`, a badge in `GameRenderer.drawOverlay`, and a tool in `ui/hud/Toolbar.tsx`.

**A new transport mode** (buses, bikes): dispatch lives in `assignSystem`. Add a branch that claims waiting trips, spawn vehicles with a new `VehicleKind`, and handle arrival in `Simulation.arrive`. Scoring is shared in `completeTrip`.

**A new goal**: one entry in `GOALS`.

**A save format change**: bump `STATE_VERSION` and add a migration to `MIGRATIONS` in `sim/setup.ts`. (Version 2 turned flat parking fees into hourly rates.)

## Multiplayer

The pieces are in place; the network layer isn't written.

- `sim/`, `world/` and `core/` have no DOM dependencies and run in Node (the tests do exactly that), so the same simulation can run on an authoritative server.
- Every mutation is a serialisable `Command` with a player id (`applyCommand(sim, cmd, by)`), validated against ownership. A `NetworkTransport` implementing `Transport` would send commands to the server instead of applying them locally.
- State is keyed by company (`state.companies[playerId]`) and structures have an `owner`, so competing companies in one city are a matter of adding players. Money and rating are per company today; trips would need a "served by" company to split revenue.
- Randomness is a seeded RNG stored in state. Clients can predict and reconcile, or simply render server snapshots plus the `GameEvent` stream.
- Worlds are reproducible from the tile set id stored in `meta.tileset`, so every client builds the same graph.

## 3D

Buildings already render in 3D from OSM heights, cars are real 3D instances, and lighting follows the sun. Ways to go further:

- **Detailed models**: `ModelLayer` is instanced boxes. Swapping the box mesh for glTF meshes (one buffer per model, same instance attributes) gives real car and building models without touching the simulation.
- **Terrain**: MapLibre supports raster-DEM terrain; elevations would need sampling for vehicle `z`.
- **Photoreal 3D tiles** (Cesium/Google 3D Tiles or similar): replace `render/` with a renderer on that engine. It only needs the same inputs, local metres from `world.proj` plus the simulation's vehicles and state, because nothing in `sim/` knows how it is drawn.
