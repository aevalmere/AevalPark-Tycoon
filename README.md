# AevalPark Tycoon

A parking and transport tycoon played on the real map. Pick your location (or any address), and the building there becomes your HQ. The game downloads the real streets and buildings within a kilometre, renders them in 3D, and the neighbourhood starts calling for rides.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (relative paths, host anywhere)
npm test           # graph, routing, simulation and balance tests
```

Needs a modern browser with WebGL2. Map tiles and address search come from public services, so the first load of a location needs a connection. After that the district's streets and buildings are cached, so a saved company still loads offline (on a plainer basemap). With no data at all for a spot, the game generates a city there instead.

## How it plays

- Buildings in your network show a rider bubble on their roof when someone needs to go somewhere. The ring around the bubble is their patience. If it runs out they give up and your star rating drops.
- **Taxi depots** dispatch taxis to riders without a car. A taxi that drops someone at the kerb blocks the lane for a few minutes and slows that street.
- **Parking lots** (converted from any building) let drivers park within 260 m of their destination. Lots are also taxi drop-off zones that don't slow traffic. Upgrade them into multi-level garages.
- **Dealerships** sell cars to customers nearby: commission for you, more drivers, more parking demand, more traffic.
- Every street is coloured by congestion. Cars drive slower on busy roads; rush hours load up the arterials. Widen roads with the road tool.
- Delivered riders bring their destination into your network, so demand grows. Good ratings grow it faster; bad ones make customers leave. Expand your service area as you can afford it.
- You lose if you fall $15,000 into debt, or stay under 1.5 stars for a full game day.

Controls: `1`–`4` tools, `Esc` back/menu, right-click cancels a tool, `Space` pause, `,` `.` speed, `T` traffic view, `G` goals. Right-drag tilts and rotates.

## Saving

- Four save slots in `localStorage`. Cookies cap out around 4 KB, which is too small for a company; a slot is a compressed save of roughly 1–40 KB.
- Autosave every game day and every few minutes (toggle in Settings).
- **Save codes**: the pause menu gives you a string starting `APT1.` that holds the whole company. Paste it into *Enter save code* on any device.
- Map tiles are cached in IndexedDB, so a reloaded company rebuilds the identical street network. If the map data has changed since, saved structures re-attach to the matching footprint or are restored from the footprint stored in the save.

## Data and credits

- Streets, buildings, heights and names: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema).
- Address search and reverse geocoding: [Nominatim](https://nominatim.org).
- Rendering: [MapLibre GL JS](https://maplibre.org).
- From the ParkKing project: the A* router and heap, the synthetic street-grid fallback, the geolocation/geocoding flow, the Hanken Grotesk and Geist Mono fonts, and the crown mark.

## Layout

```
src/
  core/      geometry, seeded RNG, spatial index           (pure)
  world/     tiles → roads graph + buildings               (pure)
  sim/       state, commands, systems, router, balance     (pure)
  platform/  browser services: storage, save codes, tile loader, geocoding, audio
  render/    MapLibre map, 3D model layer, 2D overlay
  game/      session (loop, saving) and command transport
  ui/        React screens and HUD
tests/       vitest; REAL_TILES=1 npm test also hits live map tiles
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit and how to extend them.
