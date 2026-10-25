# AevalPark Tycoon

A parking and transport tycoon played on the real map. Pick your location (or any address), and the building there becomes your HQ. The game downloads the real streets and buildings within a kilometre, renders them in 3D, and the neighbourhood starts calling for rides.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (relative paths, host anywhere)
npm test           # graph, routing, simulation and balance tests
```

## Put it on GitHub Pages

The repo ships a workflow (`.github/workflows/deploy.yml`) that tests, builds and publishes `dist/` on every push to `main`.

1. Push the repo to GitHub.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). The site appears at `https://<user>.github.io/<repo>/`.

The build uses relative paths, so it also works from any other static host or a sub-folder.

Needs a modern browser with WebGL2. Map tiles and address search come from public services, so the first load of a location needs a connection. After that the district's streets and buildings are cached, so a saved company still loads offline (on a plainer basemap). With no data at all for a spot, the game generates a city there instead.

## How it plays

- Buildings in your network show a rider bubble on their roof when someone needs to go somewhere. The ring around the bubble is their patience. If it runs out they give up and your star rating drops.
- **Taxi depots** dispatch taxis to riders without a car. The yard holds more taxis the bigger the building (2 to 10 bays per level). A taxi that drops someone at the kerb blocks the lane for a few minutes and slows that street.
- **Parking lots** (converted from any building) let drivers park within 260 m of their destination and bill them per started hour when they leave. Lots are also taxi drop-off zones that don't slow traffic. Upgrade them into multi-level garages.
- **Picking sites**: with the parking or taxi tool out, glowing spots mark where drivers recently found nowhere to park or riders went without a taxi. Hovering a building shows what it would reach, the unmet demand nearby, overlap with what you own, and its upkeep. Selling within 20 game minutes of building refunds it in full.
- **Dealerships** sell cars to customers nearby: commission for you, more drivers, more parking demand, more traffic.
- Every street is coloured by congestion. Cars drive slower on busy roads; rush hours load up the arterials. Widen roads with the road tool.
- Delivered riders bring their destination into your network, so demand grows. Good ratings grow it faster; bad ones make customers leave. Expand your service area as you can afford it.
- You lose if you fall $15,000 into debt, or stay under 1.5 stars for a full game day.

Controls: `1`–`4` tools (Shift-click to keep building), `Esc` back/menu, right-click cancels a tool, `Space` pause, `,` `.` speed, `WASD`/arrows pan, `Q` `E` rotate, `+` `-` zoom, `H` back to HQ, `N` next rider about to give up, `T` traffic view, `G` goals. Click any car or taxi to see what it's doing; `F` follows it. Selecting a depot or lot highlights its vehicles and routes. Right-drag tilts and rotates.

If the city stutters, set **Settings → Graphics** to Fast (lower resolution, no shadows or glows); **Show frame rate** puts an FPS readout on screen.

## Saving

- Four save slots in `localStorage`. Cookies cap out around 4 KB, which is too small for a company; a slot is a compressed save of roughly 1–40 KB.
- Autosave every game day and every few minutes (toggle in Settings).
- **Save codes**: the pause menu gives you a string starting `APT1.` that holds the whole company. Paste it into *Enter save code* on any device.
- Map tiles are cached in IndexedDB, so a reloaded company rebuilds the identical street network. In production builds a service worker (`public/sw.js`) also caches basemap tiles, styles and the game's own files, so revisits load fast and a district you've played still draws offline. If the map data has changed since, saved structures re-attach to the matching footprint or are restored from the footprint stored in the save.

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
  render/    MapLibre map, 3D model layer, structure layouts, 2D overlay
  game/      session (loop, saving) and command transport
  ui/        React screens and HUD
tests/       vitest; REAL_TILES=1 npm test also hits live map tiles
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit and how to extend them.
