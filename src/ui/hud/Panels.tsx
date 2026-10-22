import { useState } from 'react';
import { GOALS, STRUCTURES } from '../../sim/content';
import { dayOf } from '../../sim/state';
import { SLOT_COUNT, listSlots } from '../../platform/storage';
import { Button, Modal, Sparkline, Stars, TrafficChart } from '../components';
import { money } from '../format';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useGame } from './context';
import { HelpContent } from './Help';
import { SettingsContent } from './SettingsPanel';

export function GoalsPanel() {
  const { ui, session } = useGame();
  useStore(ui, (s) => s.tick);
  const done = new Set(session.sim.state.goals);
  return (
    <Modal title="Goals" onClose={() => ui.set({ panel: null })}>
      <ol className="goals">
        {GOALS.map((g) => (
          <li key={g.id} className={done.has(g.id) ? 'done' : ''}>
            <span className="goal-check">{done.has(g.id) ? '✓' : ''}</span>
            <div>
              <b>{g.title}</b>
              <span>{g.detail}</span>
            </div>
            {g.reward > 0 && <span className="goal-reward mono">+{money(g.reward)}</span>}
          </li>
        ))}
      </ol>
    </Modal>
  );
}

export function StatsPanel() {
  const { ui, session } = useGame();
  useStore(ui, (s) => s.tick);
  const [tab, setTab] = useState<'money' | 'traffic' | 'fleet'>('money');
  const sim = session.sim, s = sim.state;
  const days = s.days.slice(-10).reverse();
  return (
    <Modal title="Company" wide onClose={() => ui.set({ panel: null })}>
      <div className="tabs" role="tablist">
        {(['money', 'traffic', 'fleet'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'money' ? 'Finances' : t === 'traffic' ? 'Traffic & riders' : 'Properties'}
          </button>
        ))}
      </div>
      {tab === 'money' && (
        <>
          <div className="stat-cards">
            <div><span>Cash</span><b className="mono">{money(sim.me.money)}</b></div>
            <div><span>Earned today</span><b className="mono pos">{money(s.stats.today.revenue)}</b></div>
            <div><span>Spent today</span><b className="mono neg">{money(s.stats.today.expenses)}</b></div>
            <div><span>Rating</span><b><Stars value={sim.me.rating} size={13} /></b></div>
          </div>
          <h4>Cash, last 24 hours</h4>
          <Sparkline values={s.history.map((h) => h.money)} />
          <h4>Recent days</h4>
          {days.length ? (
            <table className="table">
              <thead><tr><th>Day</th><th>Revenue</th><th>Costs</th><th>Profit</th><th>Trips</th><th>Lost</th><th>Rating</th></tr></thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}><td>{d.day}</td><td className="mono pos">{money(d.revenue)}</td><td className="mono neg">{money(d.expenses)}</td>
                    <td className={`mono ${d.revenue - d.expenses >= 0 ? 'pos' : 'neg'}`}>{money(d.revenue - d.expenses)}</td>
                    <td className="mono">{d.served}</td><td className="mono">{d.failed}</td><td className="mono">{d.rating.toFixed(1)}★</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="hint">Your first full day of results appears at midnight.</p>}
        </>
      )}
      {tab === 'traffic' && (
        <>
          <h4>Congestion, last 24 hours</h4>
          <TrafficChart values={s.history.map((h) => h.traffic)} height={90} />
          <h4>Riders waiting</h4>
          <Sparkline values={s.history.map((h) => h.waiting)} color="#4f8cff" />
          <h4>Rating</h4>
          <Sparkline values={s.history.map((h) => h.rating)} color="#e8a33d" />
          <div className="stat-cards">
            <div><span>Trips by car</span><b className="mono">{s.stats.carTrips.toLocaleString()}</b></div>
            <div><span>Trips by taxi</span><b className="mono">{s.stats.taxiTrips.toLocaleString()}</b></div>
            <div><span>Kerbside drops</span><b className="mono">{s.stats.curbDrops.toLocaleString()}</b></div>
            <div><span>Lot drop-offs</span><b className="mono">{s.stats.lotDrops.toLocaleString()}</b></div>
            <div><span>Cars sold</span><b className="mono">{s.stats.carsSold.toLocaleString()}</b></div>
            <div><span>Riders lost</span><b className="mono">{s.stats.failed.toLocaleString()}</b></div>
          </div>
        </>
      )}
      {tab === 'fleet' && (
        <table className="table">
          <thead><tr><th>Property</th><th>Type</th><th>Level</th><th>Revenue</th><th>Upkeep/day</th><th /></tr></thead>
          <tbody>
            {Object.values(s.structures).map((st) => {
              const b = sim.wb(st.building)!;
              const def = STRUCTURES[st.kind];
              return (
                <tr key={st.id}>
                  <td>{b.name}</td>
                  <td><span className="dot" style={{ background: def.color }} /> {def.name}{st.kind === 'taxi' ? ` · ${st.taxis} taxis` : ''}</td>
                  <td>{def.levelNames[st.level - 1]}</td>
                  <td className="mono pos">{money(st.revenue)}</td>
                  <td className="mono neg">{money(def.upkeepPerDay(st, b))}</td>
                  <td><button type="button" className="link-btn" onClick={() => { ui.set({ panel: null, selection: { kind: 'building', idx: b.idx } }); session.renderer.view.flyToLocal(b.cx, b.cy); }}>Show</button></td>
                </tr>
              );
            })}
            {!Object.keys(s.structures).length && <tr><td colSpan={6} className="hint">Nothing built yet.</td></tr>}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export function PauseMenu() {
  const { ui, session, toast, quit } = useGame();
  const [view, setView] = useState<'main' | 'slots' | 'code' | 'settings' | 'help'>('main');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => ui.set({ panel: null });
  const save = async (slot: number) => {
    setBusy(true);
    try { await session.save(slot); toast('good', `Saved to slot ${slot + 1}`); close(); } catch (e) { toast('bad', (e as Error).message); } finally { setBusy(false); }
  };
  const slots = listSlots();

  return (
    <Modal title={view === 'main' ? 'Paused' : view === 'slots' ? 'Save to slot' : view === 'code' ? 'Save code' : view === 'settings' ? 'Settings' : 'How to play'} onClose={close}>
      {view === 'main' && (
        <div className="pause-menu">
          <Button variant="primary" size="lg" onClick={close}><Icon.Play size={15} /> Resume</Button>
          <Button size="lg" disabled={busy} onClick={() => (session.slot === null ? setView('slots') : save(session.slot))}>
            <Icon.Save size={15} /> {session.slot === null ? 'Save…' : `Save to slot ${session.slot + 1}`}
          </Button>
          <Button size="lg" onClick={() => setView('slots')}><Icon.Folder size={15} /> Save to another slot</Button>
          <Button size="lg" onClick={async () => { setView('code'); setCode(await session.saveCode()); }}><Icon.Code size={15} /> Get a save code</Button>
          <div className="menu-row">
            <Button onClick={() => setView('settings')}><Icon.Gear size={15} /> Settings</Button>
            <Button onClick={() => setView('help')}><Icon.Help size={15} /> Help</Button>
          </div>
          <Button variant="ghost" size="lg" onClick={async () => { if (session.slot !== null) { try { await session.save(); } catch { /* quitting anyway */ } } quit(); }}>
            <Icon.Exit size={15} /> {session.slot !== null ? 'Save and quit to menu' : 'Quit to menu'}
          </Button>
        </div>
      )}
      {view === 'slots' && (
        <div className="slot-picker col">
          {Array.from({ length: SLOT_COUNT }, (_, i) => (
            <button type="button" key={i} className={`slot-pick ${session.slot === i ? 'on' : ''}`} disabled={busy} onClick={() => save(i)}>
              <b>Slot {i + 1}</b>
              <span>{slots[i] ? `${slots[i]!.company} · Day ${slots[i]!.day}${session.slot === i ? ' (this game)' : ' · overwrite'}` : 'Empty'}</span>
            </button>
          ))}
          <Button variant="ghost" onClick={() => setView('main')}>Back</Button>
        </div>
      )}
      {view === 'code' && (
        <div className="code-form">
          <p className="hint">This code holds your whole company. Paste it into <b>Enter save code</b> on any device.</p>
          <textarea readOnly value={code ?? 'Packing your company…'} rows={7} onFocus={(e) => e.target.select()} />
          <div className="btn-row">
            <Button variant="primary" disabled={!code} onClick={async () => { await navigator.clipboard.writeText(code!); toast('good', 'Save code copied'); }}><Icon.Copy size={15} /> Copy</Button>
            <Button variant="ghost" onClick={() => setView('main')}>Back</Button>
          </div>
          {code && <p className="hint">{(code.length / 1024).toFixed(1)} KB</p>}
        </div>
      )}
      {view === 'settings' && (<><SettingsContent inGame onChange={(st) => session.applySettings(st)} /><Button variant="ghost" onClick={() => setView('main')}>Back</Button></>)}
      {view === 'help' && (<><HelpContent /><Button variant="ghost" onClick={() => setView('main')}>Back</Button></>)}
    </Modal>
  );
}

export function GameOver() {
  const { ui, session, quit } = useGame();
  const reason = useStore(ui, (s) => s.hud.gameOver);
  if (!reason) return null;
  const s = session.sim.state;
  return (
    <Modal title={reason === 'bankrupt' ? 'Bankrupt' : 'Licence revoked'}>
      <div className="gameover">
        <p>{reason === 'bankrupt'
          ? 'The bank called in your debts and closed the company.'
          : 'After a full day below 1.5 stars, the city council pulled your operating licence.'}</p>
        <div className="stat-cards">
          <div><span>Days in business</span><b className="mono">{dayOf(s.time)}</b></div>
          <div><span>Trips completed</span><b className="mono">{s.stats.served.toLocaleString()}</b></div>
          <div><span>Buildings served</span><b className="mono">{session.sim.getActive().length}</b></div>
          <div><span>Goals</span><b className="mono">{s.goals.length}/{GOALS.length}</b></div>
        </div>
        <Button variant="primary" size="lg" onClick={quit}>Back to the menu</Button>
      </div>
    </Modal>
  );
}
