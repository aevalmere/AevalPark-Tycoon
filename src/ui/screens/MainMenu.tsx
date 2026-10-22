import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import type { SessionInit } from '../../game/session';
import { FEATURED } from '../../platform/geo';
import { decodeSave } from '../../platform/saveCode';
import { deleteSlot, listSlots, loadSlot, slotCode, type SlotSummary } from '../../platform/storage';
import { createCityMap } from '../../render/preview';
import { Button, Stars } from '../components';
import { ago, compactMoney, playtime } from '../format';
import { Icon } from '../icons';
import { HelpContent } from '../hud/Help';
import { SettingsContent } from '../hud/SettingsPanel';

type Tab = null | 'load' | 'code' | 'help' | 'settings';

function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let map: MlMap | null = null;
    let raf = 0, cycle = 0, alive = true;
    const order = [...FEATURED].sort(() => Math.random() - 0.5);
    let i = 0;
    createCityMap(ref.current!, { style: 'dark', center: [order[0].lng, order[0].lat], zoom: 15.6, pitch: 62, bearing: 20, interactive: false })
      .then((m) => {
        if (!alive) { m.remove(); return; }
        map = m;
        setReady(true);
        let last = performance.now();
        const spin = (t: number) => {
          if (!map) return;
          map.setBearing(map.getBearing() + ((t - last) / 1000) * 2.2);
          last = t;
          raf = requestAnimationFrame(spin);
        };
        raf = requestAnimationFrame(spin);
        cycle = window.setInterval(() => {
          i = (i + 1) % order.length;
          map?.flyTo({ center: [order[i].lng, order[i].lat], zoom: 15.6, pitch: 62, duration: 5000, essential: true });
        }, 28000);
      })
      .catch(() => { /* the gradient behind stands in */ });
    return () => { alive = false; cancelAnimationFrame(raf); clearInterval(cycle); map?.remove(); };
  }, []);
  return <div ref={ref} className={`menu-backdrop ${ready ? 'ready' : ''}`} aria-hidden="true" />;
}

function SlotCard({ s, onPlay, onDelete }: { s: SlotSummary; onPlay: () => void; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="slot-card">
      <button type="button" className="slot-main" onClick={onPlay}>
        <div className="slot-top">
          <span className="slot-company">{s.company}</span>
          {s.gameOver && <span className="tag tag-bad">Closed</span>}
        </div>
        <div className="slot-city"><Icon.Pin size={13} /> {s.city}</div>
        <div className="slot-stats">
          <span>Day {s.day}</span>
          <span className="mono">{compactMoney(s.money)}</span>
          <Stars value={s.rating} size={12} />
        </div>
        <div className="slot-meta">{s.served.toLocaleString()} trips · {playtime(s.playMs)} played · saved {ago(s.savedAt)}</div>
      </button>
      <div className="slot-actions">
        <button type="button" className="icon-btn" title="Copy save code" aria-label="Copy save code" onClick={async () => {
          const code = slotCode(s.slot);
          if (code) { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); }
        }}>{copied ? <span className="tiny">Copied</span> : <Icon.Copy size={16} />}</button>
        {confirm
          ? <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
          : <button type="button" className="icon-btn" title="Delete save" aria-label="Delete save" onClick={() => setConfirm(true)}><Icon.Trash size={16} /></button>}
      </div>
    </article>
  );
}

export function MainMenu({ onNew, onStart }: { onNew: () => void; onStart: (i: SessionInit) => void }) {
  const [tab, setTab] = useState<Tab>(null);
  const [slots, setSlots] = useState(listSlots);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const latest = slots.filter((s): s is SlotSummary => !!s && !s.gameOver).sort((a, b) => b.savedAt - a.savedAt)[0];

  const play = async (slot: number) => {
    setErr(null);
    try { onStart({ mode: 'load', state: await loadSlot(slot), slot }); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="menu">
      <Backdrop />
      <div className="menu-shade" />
      <main className="menu-left">
        <div className="logo">
          <Icon.Crown size={54} />
          <div>
            <div className="logo-word">AevalPark</div>
            <div className="logo-tag">Tycoon</div>
          </div>
        </div>
        <p className="menu-pitch">Run parking and rides on the real streets around you. Every building is a customer waiting to happen.</p>
        <nav className="menu-buttons" aria-label="Main menu">
          {latest && (
            <Button variant="primary" size="lg" onClick={() => play(latest.slot)}>
              <Icon.Play size={16} /> Continue <span className="btn-sub">{latest.company} · Day {latest.day}</span>
            </Button>
          )}
          <Button variant={latest ? 'secondary' : 'primary'} size="lg" onClick={onNew}><Icon.Plus size={16} /> New company</Button>
          <Button size="lg" className={tab === 'load' ? 'on' : ''} onClick={() => setTab(tab === 'load' ? null : 'load')}><Icon.Folder size={16} /> Load game</Button>
          <Button size="lg" className={tab === 'code' ? 'on' : ''} onClick={() => setTab(tab === 'code' ? null : 'code')}><Icon.Code size={16} /> Enter save code</Button>
          <div className="menu-row">
            <Button className={tab === 'help' ? 'on' : ''} onClick={() => setTab(tab === 'help' ? null : 'help')}><Icon.Help size={16} /> How to play</Button>
            <Button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab(tab === 'settings' ? null : 'settings')}><Icon.Gear size={16} /> Settings</Button>
          </div>
        </nav>
        {err && <p className="form-error" role="alert">{err}</p>}
        <footer className="menu-foot">Map data © OpenStreetMap contributors · tiles by OpenFreeMap</footer>
      </main>

      {tab && (
        <aside className="menu-panel" aria-label={tab}>
          <header className="panel-head">
            <h2>{tab === 'load' ? 'Saved companies' : tab === 'code' ? 'Save code' : tab === 'help' ? 'How to play' : 'Settings'}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setTab(null)}><Icon.Close /></button>
          </header>
          {tab === 'load' && (
            <div className="slot-list">
              {slots.map((s, i) => s
                ? <SlotCard key={i} s={s} onPlay={() => play(i)} onDelete={() => { deleteSlot(i); setSlots(listSlots()); }} />
                : <div key={i} className="slot-empty">Slot {i + 1} · empty</div>)}
              <p className="hint">Saves live in this browser. Copy a save code to move a company to another device.</p>
            </div>
          )}
          {tab === 'code' && (
            <form className="code-form" onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              try { onStart({ mode: 'load', state: await decodeSave(code), slot: null }); } catch (er) { setErr((er as Error).message); }
            }}>
              <label htmlFor="code">Paste a code that starts with <code>APT1.</code></label>
              <textarea id="code" value={code} onChange={(e) => setCode(e.target.value)} rows={7} spellCheck={false} placeholder="APT1.…" />
              <Button variant="primary" type="submit" disabled={!code.trim()}>Load company</Button>
              <p className="hint">Loaded companies play without a slot until you save from the pause menu.</p>
            </form>
          )}
          {tab === 'help' && <HelpContent />}
          {tab === 'settings' && <SettingsContent />}
        </aside>
      )}
    </div>
  );
}
