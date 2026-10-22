import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameSession } from '../../game/session';
import { sfx } from '../../platform/audio';
import type { Coverage } from '../../render/MapView';
import { PARK_WALK_RADIUS } from '../../sim/balance';
import { checkBuild, type Command } from '../../sim/commands';
import { STRUCTURES, dealerRadius } from '../../sim/content';
import { money } from '../format';
import { Icon } from '../icons';
import { createStore, emptyHud, type GameUi, type Toast } from '../store';
import { CityPulse } from '../hud/CityPulse';
import { GameCtx, type GameCtxValue } from '../hud/context';
import { Feed } from '../hud/Feed';
import { Inspector } from '../hud/Inspector';
import { GameOver, GoalsPanel, PauseMenu, StatsPanel } from '../hud/Panels';
import { Toolbar, ToolHint } from '../hud/Toolbar';
import { Tooltip } from '../hud/Tooltip';
import { TopBar } from '../hud/TopBar';
import { Tutorial } from '../hud/Tutorial';
import { useStore } from '../store';

let toastId = 1;

export function GameScreen({ session, onQuit }: { session: GameSession; onQuit: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [mountErr, setMountErr] = useState<string | null>(null);
  const lastSpeed = useRef(1);
  const ui = useMemo(() => createStore<GameUi>({
    tool: 'select', selection: null, hover: null, toasts: [], panel: null, trafficView: false, hud: emptyHud, tick: 0,
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

  const focus = useCallback((x: number, y: number, zoom?: number) => session.renderer?.view.flyToLocal(x, y, zoom), [session]);

  const quit = useCallback(() => { onQuit(); }, [onQuit]);

  const ctx: GameCtxValue = useMemo(() => ({ session, ui, act, toast, focus, quit }), [session, ui, act, toast, focus, quit]);

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
    return session.onFrame(() => {
      const now = performance.now();
      const st = ui.get();
      const r = session.renderer;
      r.vs.selectedTrip = st.selection?.kind === 'trip' ? st.selection.id : null;
      r.vs.selectedBuilding = st.selection?.kind === 'building' ? st.selection.idx : -1;
      r.vs.selectedLink = st.selection?.kind === 'link' ? st.selection.idx : -1;
      r.vs.hoverBuilding = st.hover?.kind === 'building' ? st.hover.idx : -1;
      r.vs.hoverLink = st.hover?.kind === 'link' ? st.hover.idx : -1;
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
      ui.set((u) => ({
        tick: u.tick + 1,
        hud: {
          money: sim.me.money, rating: sim.me.rating, time: s.time, speed: s.speed, waiting, needTaxi, needParking,
          served: s.stats.served, failed: s.stats.failed, traffic: sim.congestionIndex(), active: sim.getActive().length,
          goals: s.goals.length, gameOver: s.gameOver, tutorial: s.tutorial, serviceLevel: s.serviceLevel, lowRating: s.lowRatingSince !== null,
        },
      }));
    });
  }, [mounted, session, ui]);

  // traffic view + coverage overlays follow UI state
  useEffect(() => {
    if (!mounted) return;
    const sim = session.sim;
    let covKey = '';
    return ui.subscribe(() => {
      const st = ui.get();
      const r = session.renderer;
      if (r.vs.trafficView !== st.trafficView) r.setTrafficView(st.trafficView);
      const cov: Coverage[] = [];
      const lots = () => sim.structuresOf('parking').forEach((l) => { const b = sim.wb(l.building)!; cov.push({ x: b.cx, y: b.cy, r: PARK_WALK_RADIUS, color: STRUCTURES.parking.color }); });
      if (st.tool === 'parking') lots();
      if (st.tool === 'dealership') sim.structuresOf('dealership').forEach((d) => { const b = sim.wb(d.building)!; cov.push({ x: b.cx, y: b.cy, r: dealerRadius(d.level), color: STRUCTURES.dealership.color }); });
      if ((st.tool === 'parking' || st.tool === 'dealership') && st.hover?.kind === 'building') {
        const b = sim.world.buildings[st.hover.idx];
        cov.push({ x: b.cx, y: b.cy, r: st.tool === 'parking' ? PARK_WALK_RADIUS : dealerRadius(1), color: STRUCTURES[st.tool].color });
      }
      if (st.tool === 'select' && st.selection?.kind === 'building') {
        const b = sim.world.buildings[st.selection.idx];
        const sid = b && sim.structureAt.get(b.id);
        const s2 = sid ? sim.state.structures[sid] : undefined;
        if (s2 && STRUCTURES[s2.kind].radius(s2) > 0) cov.push({ x: b.cx, y: b.cy, r: STRUCTURES[s2.kind].radius(s2), color: STRUCTURES[s2.kind].color });
      }
      const key = JSON.stringify(cov.map((c) => [Math.round(c.x), Math.round(c.y), c.r]));
      if (key !== covKey) {
        covKey = key;
        r.setCoverage(cov);
      }
      const isBuild = st.tool === 'taxi' || st.tool === 'parking' || st.tool === 'dealership';
      if (isBuild && st.hover?.kind === 'building') r.view.setPreview(st.hover.idx, checkBuild(sim, st.tool as 'taxi', st.hover.idx).ok ? 1 : 2);
      else r.view.setPreview(-1, 0);
    });
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
      const b = r.view.buildingAt(x, y);
      const bubble = r.overlay.hitBubble(x, y);
      ui.set({ hover: b >= 0 ? { kind: 'building', idx: b, x, y } : null });
      map.getCanvas().style.cursor = b >= 0 || bubble ? 'pointer' : '';
    };
    const onMove = (e: { point: { x: number; y: number } }) => {
      pending = { x: e.point.x, y: e.point.y };
      if (!raf) raf = requestAnimationFrame(hoverAt);
    };
    const onLeave = () => { pending = null; ui.set({ hover: null }); };
    const onClick = (e: { point: { x: number; y: number } }) => {
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
        if (act({ type: 'build', kind: st.tool, building: bb.id }, `${STRUCTURES[st.tool].name} opened at ${bb.name}`)) {
          ui.set({ selection: { kind: 'building', idx: b }, tool: 'select' });
        }
        return;
      }
      const trip = r.overlay.hitBubble(x, y);
      if (trip) { ui.set({ selection: { kind: 'trip', id: trip } }); return; }
      const b = r.view.buildingAt(x, y);
      if (b >= 0) { ui.set({ selection: { kind: 'building', idx: b } }); return; }
      const l = r.view.linkAt(x, y);
      ui.set({ selection: l >= 0 ? { kind: 'link', idx: l } : null });
    };
    const onContext = (e: { originalEvent: MouseEvent }) => {
      e.originalEvent.preventDefault();
      if (ui.get().tool !== 'select') ui.set({ tool: 'select' });
    };
    map.on('mousemove', onMove);
    map.on('click', onClick);
    map.on('contextmenu', onContext);
    map.getCanvas().addEventListener('mouseleave', onLeave);
    return () => {
      map.off('mousemove', onMove);
      map.off('click', onClick);
      map.off('contextmenu', onContext);
      map.getCanvas().removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [mounted, session, ui, act]);

  // keyboard shortcuts
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const st = ui.get();
      const speed = session.sim.state.speed;
      switch (e.key) {
        case '1': ui.set({ tool: 'taxi', selection: null }); break;
        case '2': ui.set({ tool: 'parking', selection: null }); break;
        case '3': ui.set({ tool: 'dealership', selection: null }); break;
        case '4': ui.set({ tool: 'road', selection: null }); break;
        case 'Escape':
          if (st.panel) ui.set({ panel: null });
          else if (st.tool !== 'select') ui.set({ tool: 'select' });
          else if (st.selection) ui.set({ selection: null });
          else ui.set({ panel: 'menu' });
          break;
        case ' ':
          e.preventDefault();
          act({ type: 'setSpeed', speed: speed === 0 ? (lastSpeed.current || 1) : 0 });
          if (speed !== 0) lastSpeed.current = speed;
          break;
        case '.': act({ type: 'setSpeed', speed: speed === 0 ? 1 : Math.min(4, speed * 2) }); break;
        case ',': act({ type: 'setSpeed', speed: speed <= 1 ? 0 : speed / 2 }); break;
        case 't': case 'T': ui.set({ trafficView: !st.trafficView }); break;
        case 'g': case 'G': ui.set({ panel: st.panel === 'goals' ? null : 'goals' }); break;
        default: return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, session, ui, act]);

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
