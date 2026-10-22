// One running game: world + simulation + renderer + saving. The UI talks to
// this object; it owns the frame loop.

import type { LatLng } from '../core/geo';
import { hashString } from '../core/rng';
import { loadWorld, type LoadProgress } from '../platform/worldLoader';
import { encodeSave } from '../platform/saveCode';
import { loadSettings, saveToSlot, type Settings } from '../platform/storage';
import { sfx } from '../platform/audio';
import type { Difficulty } from '../sim/balance';
import type { Command, CommandResult } from '../sim/commands';
import { hydrate, seedNewGame, snapshot } from '../sim/setup';
import { Simulation } from '../sim/simulation';
import { createState, dayOf, type GameState } from '../sim/state';
import { GameRenderer } from '../render/GameRenderer';
import { LocalTransport, type Transport } from './transport';

export type SessionInit =
  | { mode: 'new'; origin: LatLng; city: string; company: string; difficulty: Difficulty; slot: number }
  | { mode: 'load'; state: GameState; slot: number | null };

const AUTOSAVE_MS = 3 * 60 * 1000;

export class GameSession {
  renderer!: GameRenderer;
  transport: Transport;
  settings: Settings = loadSettings();
  offline = false;
  private raf = 0;
  private last = 0;
  private lastSave = Date.now();
  private lastDay = 0;
  private listeners = new Set<() => void>();
  private gen = 0;

  private constructor(public sim: Simulation, public slot: number | null) {
    this.transport = new LocalTransport(sim);
    this.lastDay = dayOf(sim.state.time);
  }

  static async create(init: SessionInit, onProgress: (p: LoadProgress) => void): Promise<GameSession> {
    if (init.mode === 'new') {
      const { world, tileset, offline } = await loadWorld(init.origin, onProgress);
      const state = createState({
        company: init.company, city: init.city, origin: init.origin, difficulty: init.difficulty,
        worldKey: world.key, tileset, seed: hashString(`${init.company}|${Date.now()}`),
      });
      const sim = new Simulation(world, state);
      seedNewGame(sim);
      const s = new GameSession(sim, init.slot);
      s.offline = offline;
      return s;
    }
    const { world, offline } = await loadWorld(init.state.meta.origin, onProgress, init.state.meta.tileset);
    const sim = hydrate(world, init.state);
    const s = new GameSession(sim, init.slot);
    s.offline = offline;
    return s;
  }

  /**
   * Create the map and start the frame loop. Resolves false if a newer
   * mount/unmount superseded this one (React may mount effects twice).
   */
  async mount(wrapper: HTMLElement, mapEl: HTMLElement): Promise<boolean> {
    const gen = ++this.gen;
    const renderer = new GameRenderer(this.sim, this.settings.mapStyle);
    renderer.dayNight = this.settings.dayNight;
    try {
      await renderer.mount(wrapper, mapEl);
    } catch (e) {
      renderer.destroy();
      if (gen === this.gen) throw e;
      return false;
    }
    if (gen !== this.gen) { renderer.destroy(); return false; }
    this.renderer = renderer;
    sfx.enabled = this.settings.sound;
    sfx.volume = this.settings.volume;
    this.last = performance.now();
    const loop = (t: number) => {
      if (gen !== this.gen) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.sim.frame(dt);
      this.renderer.update();
      this.maybeAutosave();
      for (const fn of this.listeners) fn();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return true;
  }

  /** Stop the loop and tear down the map. The simulation survives, so mount can run again. */
  unmount() {
    this.gen++;
    cancelAnimationFrame(this.raf);
    this.renderer?.destroy();
  }

  /** called every frame after the sim steps (UI throttles itself) */
  onFrame(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  send(cmd: Command): CommandResult {
    const r = this.transport.send(cmd);
    if (!r.ok) sfx.play('fail');
    return r;
  }

  applySettings(s: Settings) {
    this.settings = s;
    sfx.enabled = s.sound;
    sfx.volume = s.volume;
    if (this.renderer) this.renderer.dayNight = s.dayNight;
  }

  private maybeAutosave() {
    if (!this.settings.autosave || this.slot === null) return;
    const day = dayOf(this.sim.state.time);
    if (day !== this.lastDay || Date.now() - this.lastSave > AUTOSAVE_MS) {
      this.lastDay = day;
      void this.save().catch((e) => console.warn('[save] autosave failed', e));
    }
  }

  async save(slot = this.slot): Promise<void> {
    if (slot === null) throw new Error('Pick a save slot first.');
    this.slot = slot;
    this.lastSave = Date.now();
    await saveToSlot(slot, snapshot(this.sim));
  }

  saveCode(): Promise<string> {
    return encodeSave(snapshot(this.sim));
  }
}
