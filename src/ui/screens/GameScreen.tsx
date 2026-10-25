import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameSession } from '../../game/session';
import { sfx } from '../../platform/audio';
import { REACH, type Coverage } from '../../render/MapView';
import { reachOf } from '../../sim/advisor';
import { PARK_WALK_RADIUS } from '../../sim/balance';
import { checkBuild, type Command } from '../../sim/commands';
import { STRUCTURES, dealerRadius } from '../../sim/content';
import { money } from '../format';
import { Icon } from '../icons';
import { createStore, emptyHud, type GameUi, type Toast } from '../store';
import { CityPulse } from '../hud/CityPulse';
import { GameCtx, useGame, type GameCtxValue } from '../hud/context';
import { Feed } from '../hud/Feed';
import { Inspector } from '../hud/Inspector';
import { GameOver, GoalsPanel, PauseMenu, StatsPanel } from '../hud/Panels';
import { Toolbar, ToolHint } from '../hud/Toolbar';
import { Tooltip } from '../hud/Tooltip';
import { TopBar } from '../hud/TopBar';
import { Tutorial } from '../hud/Tutorial';
import { useStore } from '../store';

let toastId = 1;

/** keys that move the camera while held */
const CAMERA_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e', '=', '+', '-', '_']);

export function GameScreen({ session, onQuit }: { session: GameSession; onQuit: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [mountErr, setMountErr] = useState<string | null>(null);
  const lastSpeed = useRef(1);
  const ui = useMemo(() => createStore<GameUi>({
    tool: 'select', selection: null, hover: null, toasts: [], panel: null, trafficView: false, follow: false, hud: emptyHud, tick: 0,
  }), []);

  const toast = useCallback((level: Toast['level'], text: string, focus?: Toast['focus']) => {
    ui.set((s) => ({ toasts: [...s.toasts.slice(-6), { id: toastId++, level, text, focus, at: Date.now() }] }));
  }, [ui]);

  const act = useCallback((cmd: Command, success?: string) => {
    const r = session.send(cmd);
    if (!r.ok) toast('bad', r.error ?? 'That did not work.');
    else if (success) toast('good', success);
    return r.ok;
  }, [session, toast]);

  const focus = useCallback((x: number, y: number, zoom?: number) => {
    if (ui.get().follow) ui.set({ follow: false });
    session.renderer?.view.flyToLocal(x, y, zoom);
  }, [session, ui]);

  const urgent = useCallback(() => {
    const sim = session.sim;
    const waiting = Object.values(sim.state.trips).filter((t) => t.status !== 'riding')
      .sort((a, b) => (1 - a.waited / a.patience) - (1 - b.waited / b.patience));
    if (!waiting.length) { toast('info', 'Nobody is waiting right now.'); return; }
    const cur = ui.get().selection;
    const at = cur?.kind === 'trip' ? waiting.findIndex((t) => t.id === cur.id) : -1;
    const t = waiting[(at + 1) % waiting.length];
    const o = sim.wb(t.origin);
    ui.set({ selection: { kind: 'trip', id: t.id }, tool: 'select' });
    if (o) focus(o.cx, o.cy);
  }, [session, ui, toast, focus]);

  const quit = useCallback(() => { onQuit(); }, [onQuit]);

  const ctx: GameCtxValue = useMemo(() => ({ session, ui, act, toast, focus, urgent, quit }), [session, ui, act, toast, focus, urgent, quit]);

  // mount the map and start the loop
  useEffect(() => {
    let cancelled = false;
    // dev-only handle for automated play-testing from the browser console
    if (import.meta.env.DEV) (window as unknown as { __apt: GameSession }).__apt = session;
    session.mount(wrapRef.current!, mapRef.current!)
      .then((ok) => {
        if (!ok || cancelled) return;
        setMounted(true);
        if (session.offline) toast('warn', "Couldn't download map data here, so you're playing on a generated city.");
      })
      .catch((e) => { console.error(e); if (!cancelled) setMountErr((e as Error).message); });
    return () => { cancelled = true; session.unmount(); };
  }, [session, toast]);

  // simulation events → toasts and sound
  useEffect(() => {
    const sim = session.sim;
    let lastFail = 0;
    return sim.events.on((e) => {
      switch (e.type) {
        case 'trip:done': sfx.play('coin'); break;
        case 'trip:fail': {
          sfx.play('fail');
          const now = Date.now();
          if (now - lastFail > 5000) {
            lastFail = now;
            toast('bad', `A rider gave up waiting${e.reason === 'parking' ? ' for parking' : e.reason === 'taxi' ? ' for a taxi' : ''}.`, { x: e.x, y: e.y });
          }
          break;
        }
        case 'sale': sfx.play('sale'); break;
        case 'built': sfx.play('build'); break;
        case 'upgraded': sfx.play('build'); break;
        case 'goal':
          sfx.play('goal');
          toast('good', `Goal: ${e.goal.title}${e.goal.reward ? ` · +$${e.goal.reward.toLocaleString()}` : ''}`);
          break;
        case 'expand': sfx.play('goal'); break;
        case 'notice': if (e.level === 'bad') sfx.play('alert'); toast(e.level, e.text, e.focus); break;
        case 'day': {
          const d = sim.state.days[sim.state.days.length - 1];
          if (d) toast('info', `Day ${e.day}. Yesterday: ${d.served} trips, ${money(Math.abs(d.revenue - d.expenses))} ${d.revenue >= d.expenses ? 'profit' : 'loss'}.`);
          break;
        }
        case 'gameover': sfx.play('alert'); break;
        default: break;
      }
    });
  }, [session, toast]);

  // HUD snapshot + renderer view state, a few times a second
  useEffect(() => {
    if (!mounted) return;
    const sim = session.sim;
    let last = 0;
    // where a selected vehicle came from, so the selection can fall back there when it finishes its run
    let lastVehicle: { id: number; depot: string | null } | null = null;
    return session.onFrame(() => {
      const now = performance.now();
      let st = ui.get();
      const r = session.renderer;
      if (st.selection?.kind === 'vehicle') {
        const v = sim.vehicles.get(st.selection.id);
        if (v) lastVehicle = { id: v.id, depot: v.depot ?? null };
        else {
          const depot = lastVehicle?.id === st.selection.id && lastVehicle.depot ? sim.state.structures[lastVehicle.depot] : undefined;
          const b = depot ? sim.wb(depot.building) : undefined;
          ui.set({ selection: b ? { kind: 'building', idx: b.idx } : null, follow: false });
          st = ui.get();
        }
      }
      const sel = st.selection;
      r.vs.selectedTrip = sel?.kind === 'trip' ? sel.id : null;
      r.vs.selectedBuilding = sel?.kind === 'building' ? sel.idx : -1;
      r.vs.selectedLink = sel?.kind === 'link' ? sel.idx : -1;
      r.vs.selectedVehicle = sel?.kind === 'vehicle' ? sel.id : -1;
      r.vs.follow = st.follow && sel?.kind === 'vehicle';
      r.vs.hoverBuilding = st.hover?.kind === 'building' ? st.hover.idx : -1;
      r.vs.hoverLink = st.hover?.kind === 'link' ? st.hover.idx : -1;
      r.vs.demand = st.tool === 'parking' ? 'parking' : st.tool === 'taxi' ? 'taxi' : null;
      if (now - last < 200) return;
      last = now;
      const s = sim.state;
      let waiting = 0, needTaxi = 0, needParking = 0;
      for (const t of Object.values(s.trips)) {
        if (t.status === 'riding') continue;
        waiting++;
        if (t.reason === 'taxi') needTaxi++;
        if (t.reason === 'parking') needParking++;
      }
      const hourAgo = [...s.history].reverse().find((h) => h.t <= s.time - 60);
      ui.set((u) => ({
        tick: u.tick + 1,
        hud: {
          money: sim.me.money, rating: sim.me.rating, time: s.time, speed: s.speed, waiting, needTaxi, needParking,
          served: s.stats.served, failed: s.stats.failed, traffic: sim.congestionIndex(), active: sim.getActive().length,
          ratingTrend: hourAgo ? sim.me.rating - hourAgo.rating : 0, fps: Math.round(session.fps),
          goals: s.goals.length, gameOver: s.gameOver, tutorial: s.tutorial, serviceLevel: s.serviceLevel, lowRating: s.lowRatingSince !== null,
        },
      }));
    });
  }, [mounted, session, ui]);

  // traffic view, coverage rings, build preview tint and the reach of a lot or dealership follow UI state
  useEffect(() => {
    if (!mounted) return;
    const sim = session.sim;
    let covKey = '', reachKey = '';
    const sync = () => {
      const st = ui.get();
      const r = session.renderer;
      if (r.vs.trafficView !== st.trafficView) r.setTrafficView(st.trafficView);
      const hovered = st.hover?.kind === 'building' ? sim.world.buildings[st.hover.idx] : undefined;
      const selB = st.tool === 'select' && st.selection?.kind === 'building' ? sim.world.buildings[st.selection.idx] : undefined;
      const selSid = selB && sim.structureAt.get(selB.id);
      const selSt = selSid ? sim.state.structures[selSid] : undefined;

      const cov: Coverage[] = [];
      const lots = () => sim.structuresOf('parking').forEach((l) => { const b = sim.wb(l.building)!; cov.push({ x: b.cx, y: b.cy, r: PARK_WALK_RADIUS, color: STRUCTURES.parking.color }); });
      if (st.tool === 'parking') lots();
      if (st.tool === 'dealership') sim.structuresOf('dealership').forEach((d) => { const b = sim.wb(d.building)!; cov.push({ x: b.cx, y: b.cy, r: dealerRadius(d.level), color: STRUCTURES.dealership.color }); });
      if ((st.tool === 'parking' || st.tool === 'dealership') && hovered) {
        cov.push({ x: hovered.cx, y: hovered.cy, r: st.tool === 'parking' ? PARK_WALK_RADIUS : dealerRadius(1), color: STRUCTURES[st.tool].color });
      }
      if (selB && selSt && STRUCTURES[selSt.kind].radius(selSt) > 0) cov.push({ x: selB.cx, y: selB.cy, r: STRUCTURES[selSt.kind].radius(selSt), color: STRUCTURES[selSt.kind].color });
      const key = JSON.stringify(cov.map((c) => [Math.round(c.x), Math.round(c.y), c.r]));
      if (key !== covKey) {
        covKey = key;
        r.setCoverage(cov);
      }

      // customers a previewed site, or the selected lot or dealership, would serve
      const reachKind = (st.tool === 'parking' || st.tool === 'dealership') && hovered ? st.tool
        : selSt && selSt.kind !== 'taxi' ? selSt.kind : null;
      const site = reachKind && (hovered && st.tool !== 'select' ? hovered : selB);
      const level = site === selB ? selSt?.level ?? 1 : 1;
      const rk = reachKind && site ? `${reachKind}:${site.idx}:${level}:${sim.getActive().length}` : '';
      if (rk !== reachKey) {
        reachKey = rk;
        if (reachKind && site) r.view.setReach(reachOf(sim, reachKind, site, level), reachKind === 'parking' ? REACH.lot : REACH.dealer);
        else r.view.setReach([], REACH.none);
      }

      const isBuild = st.tool === 'taxi' || st.tool === 'parking' || st.tool === 'dealership';
      if (isBuild && hovered) r.view.setPreview(hovered.idx, checkBuild(sim, st.tool as 'taxi', hovered.idx).ok ? 1 : 2);
      else r.view.setPreview(-1, 0);
    };
    sync();
    return ui.subscribe(sync);
  }, [mounted, session, ui]);

  // map pointer interactions
  useEffect(() => {
    if (!mounted) return;
    const r = session.renderer, map = r.view.map, sim = session.sim;
    let pending: { x: number; y: number } | null = null;
    let raf = 0;
    const hoverAt = () => {
      raf = 0;
      if (!pending) return;
      const { x, y } = pending;
      const tool = ui.get().tool;
      if (tool === 'road') {
        const l = r.view.linkAt(x, y);
        ui.set({ hover: l >= 0 ? { kind: 'link', idx: l, x, y } : null });
        map.getCanvas().style.cursor = l >= 0 ? 'pointer' : '';
        return;
      }
      const bubble = r.overlay.hitBubble(x, y);
      const veh = tool === 'select' && !bubble ? r.vehicleAt(x, y) : -1;
      if (veh >= 0) {
        ui.set({ hover: { kind: 'vehicle', idx: veh, x, y } });
        map.getCanvas().style.cursor = 'pointer';
        return;
      }
      const b = r.view.buildingAt(x, y);
      ui.set({ hover: b >= 0 ? { kind: 'building', idx: b, x, y } : null });
      map.getCanvas().style.cursor = b >= 0 || bubble ? 'pointer' : '';
    };
    const onMove = (e: { point: { x: number; y: number } }) => {
      pending = { x: e.point.x, y: e.point.y };
      if (!raf) raf = requestAnimationFrame(hoverAt);
    };
    const onLeave = () => { pending = null; ui.set({ hover: null }); };
    const onClick = (e: { point: { x: number; y: number }; originalEvent: MouseEvent }) => {
      const { x, y } = e.point;
      const st = ui.get();
      sfx.play('click');
      if (st.tool === 'road') {
        const l = r.view.linkAt(x, y);
        ui.set({ selection: l >= 0 ? { kind: 'link', idx: l } : null });
        return;
      }
      if (st.tool !== 'select') {
        const b = r.view.buildingAt(x, y);
        if (b < 0) return;
        const bb = sim.world.buildings[b];
        // shift-click keeps the tool out for placing several in a row
        if (act({ type: 'build', kind: st.tool, building: bb.id }, `${STRUCTURES[st.tool].name} opened at ${bb.name}`) && !e.originalEvent.shiftKey) {
          ui.set({ selection: { kind: 'building', idx: b }, tool: 'select' });
        }
        return;
      }
      const trip = r.overlay.hitBubble(x, y);
      if (trip) { ui.set({ selection: { kind: 'trip', id: trip }, follow: false }); return; }
      const veh = r.vehicleAt(x, y);
      if (veh >= 0) { ui.set({ selection: { kind: 'vehicle', id: veh }, follow: false }); return; }
      const b = r.view.buildingAt(x, y);
      if (b >= 0) { ui.set({ selection: { kind: 'building', idx: b }, follow: false }); return; }
      const l = r.view.linkAt(x, y);
      ui.set({ selection: l >= 0 ? { kind: 'link', idx: l } : null, follow: false });
    };
    const onContext = (e: { originalEvent: MouseEvent }) => {
      e.originalEvent.preventDefault();
      if (ui.get().tool !== 'select') ui.set({ tool: 'select' });
    };
    // grabbing the map takes the camera back from a followed vehicle
    const onDrag = () => { if (ui.get().follow) ui.set({ follow: false }); };
    map.on('mousemove', onMove);
    map.on('click', onClick);
    map.on('contextmenu', onContext);
    map.on('dragstart', onDrag);
    map.getCanvas().addEventListener('mouseleave', onLeave);
    return () => {
      map.off('mousemove', onMove);
      map.off('click', onClick);
      map.off('contextmenu', onContext);
      map.off('dragstart', onDrag);
      map.getCanvas().removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [mounted, session, ui, act]);

  // keyboard shortcuts, and camera keys that act for as long as they're held
  useEffect(() => {
    if (!mounted) return;
    const map = session.renderer.view.map;
    const held = new Set<string>();
    let raf = 0, last = 0;
    const fly = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const has = (...k: string[]) => k.some((x) => held.has(x));
      const dx = (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0);
      const dy = (has('s', 'arrowdown') ? 1 : 0) - (has('w', 'arrowup') ? 1 : 0);
      const rot = (has('e') ? 1 : 0) - (has('q') ? 1 : 0);
      const zoom = (has('=', '+') ? 1 : 0) - (has('-', '_') ? 1 : 0);
      if (dx || dy) {
        map.panBy([dx * 640 * dt, dy * 640 * dt], { duration: 0 });
        if (ui.get().follow) ui.set({ follow: false });
      }
      if (rot) map.setBearing(map.getBearing() + rot * 75 * dt);
      if (zoom) map.setZoom(map.getZoom() + zoom * 1.5 * dt);
      raf = held.size ? requestAnimationFrame(fly) : 0;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = ui.get();
      const k = e.key.toLowerCase();
      if (CAMERA_KEYS.has(k) && !st.panel) {
        e.preventDefault();
        held.add(k);
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(fly); }
        return;
      }
      const speed = session.sim.state.speed;
      switch (k) {
        case '1': ui.set({ tool: 'taxi', selection: null }); break;
        case '2': ui.set({ tool: 'parking', selection: null }); break;
        case '3': ui.set({ tool: 'dealership', selection: null }); break;
        case '4': ui.set({ tool: 'road', selection: null }); break;
        case 'escape':
          if (st.panel) ui.set({ panel: null });
          else if (st.tool !== 'select') ui.set({ tool: 'select' });
          else if (st.selection) ui.set({ selection: null, follow: false });
          else ui.set({ panel: 'menu' });
          break;
        case ' ':
          e.preventDefault();
          act({ type: 'setSpeed', speed: speed === 0 ? (lastSpeed.current || 1) : 0 });
          if (speed !== 0) lastSpeed.current = speed;
          break;
        case '.': act({ type: 'setSpeed', speed: speed === 0 ? 1 : Math.min(4, speed * 2) }); break;
        case ',': act({ type: 'setSpeed', speed: speed <= 1 ? 0 : speed / 2 }); break;
        case 't': ui.set({ trafficView: !st.trafficView }); break;
        case 'g': ui.set({ panel: st.panel === 'goals' ? null : 'goals' }); break;
        case 'h': { const hq = session.sim.world.buildings[session.sim.world.hq]; focus(hq.cx, hq.cy, 16.4); break; }
        case 'n': urgent(); break;
        case 'f': if (st.selection?.kind === 'vehicle') ui.set({ follow: !st.follow }); break;
        default: return;
      }
    };
    const onUp = (e: KeyboardEvent) => { held.delete(e.key.toLowerCase()); };
    const onBlur = () => held.clear();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(raf);
    };
  }, [mounted, session, ui, act, focus, urgent]);

  const panel = useStore(ui, (s) => s.panel);
  const paused = useStore(ui, (s) => s.hud.speed === 0 && !s.hud.gameOver);

  // the menu pauses the clock while it's open
  useEffect(() => {
    if (!mounted || panel !== 'menu') return;
    const prev = session.sim.state.speed;
    if (prev > 0) session.send({ type: 'setSpeed', speed: 0 });
    return () => { if (prev > 0 && !session.sim.state.gameOver) session.send({ type: 'setSpeed', speed: prev }); };
  }, [panel, mounted, session]);

  return (
    <GameCtx.Provider value={ctx}>
      <div className="game" ref={wrapRef}>
        <div className="game-map" ref={mapRef} />
        {!mounted && (
          <div className="game-cover">
            {mountErr ? <p className="form-error">{mountErr}</p> : <><Icon.Crown size={40} /><p>Opening for business…</p></>}
          </div>
        )}
        {mounted && (
          <div className="hud">
            <TopBar />
            <Toolbar />
            <ToolHint />
            <Inspector />
            <Tutorial />
            <CityPulse />
            <Feed />
            <Tooltip />
            <FpsChip />
            {paused && panel !== 'menu' && <div className="paused-chip">Paused · Space to resume</div>}
            {panel === 'goals' && <GoalsPanel />}
            {panel === 'stats' && <StatsPanel />}
            {panel === 'menu' && <PauseMenu />}
            <GameOver />
          </div>
        )}
      </div>
    </GameCtx.Provider>
  );
}

function FpsChip() {
  const { ui, session } = useGame();
  const fps = useStore(ui, (s) => s.hud.fps);
  if (!session.settings.showFps) return null;
  return <div className={`fps-chip mono ${fps < 30 ? 'slow' : ''}`}>{fps} fps</div>;
}
