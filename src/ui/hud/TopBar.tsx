import { useEffect, useRef, useState } from 'react';
import { SERVICE_LEVELS } from '../../sim/balance';
import { GOALS, STRUCTURES } from '../../sim/content';
import { hourOf } from '../../sim/state';
import { Stars } from '../components';
import { clock, compactMoney, dayLabel, money, phaseOf } from '../format';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useGame } from './context';

function MoneyCounter({ value }: { value: number }) {
  const [delta, setDelta] = useState<{ v: number; k: number } | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    const d = value - prev.current;
    prev.current = value;
    if (Math.abs(d) >= 1) setDelta((cur) => ({ v: d + (cur && Math.sign(cur.v) === Math.sign(d) ? cur.v : 0), k: Date.now() }));
  }, [value]);
  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), 1400);
    return () => clearTimeout(t);
  }, [delta]);
  return (
    <div className={`money ${value < 0 ? 'neg' : ''}`}>
      <span className="money-value mono">{money(value)}</span>
      {delta && <span key={delta.k} className={`money-delta mono ${delta.v > 0 ? 'up' : 'down'}`}>{delta.v > 0 ? '+' : '−'}{compactMoney(Math.abs(delta.v))}</span>}
    </div>
  );
}

/** Hover card under the cash: where today's money came from and went. */
function MoneyCard() {
  const { session, ui } = useGame();
  useStore(ui, (s) => s.tick);
  const sim = session.sim, s = sim.state, t = s.stats.today;
  let upkeep = 0;
  for (const st of Object.values(s.structures)) {
    const b = sim.wb(st.building);
    if (b) upkeep += STRUCTURES[st.kind].upkeepPerDay(st, b);
  }
  const hourAgo = [...s.history].reverse().find((h) => h.t <= s.time - 60);
  const flow = hourAgo ? sim.me.money - hourAgo.money : null;
  return (
    <div className="tb-pop" role="tooltip">
      <div className="row"><span>Earned today</span><b className="mono pos">{money(t.revenue)}</b></div>
      <div className="row"><span>Spent today</span><b className="mono neg">{money(t.expenses)}</b></div>
      <div className="row"><span>Upkeep</span><b className="mono">{money(upkeep)}/day</b></div>
      {flow !== null && <div className="row"><span>Last hour</span><b className={`mono ${flow >= 0 ? 'pos' : 'neg'}`}>{flow >= 0 ? '+' : ''}{money(flow)}</b></div>}
    </div>
  );
}

export function TopBar() {
  const { session, ui, act } = useGame();
  const hud = useStore(ui, (s) => s.hud);
  const panel = useStore(ui, (s) => s.panel);
  const trafficView = useStore(ui, (s) => s.trafficView);
  const hour = hourOf(hud.time);
  const night = hour < 6 || hour >= 19.5;
  const phase = phaseOf(hud.time);
  const trend = Math.abs(hud.ratingTrend) >= 0.03 ? Math.sign(hud.ratingTrend) : 0;
  const next = SERVICE_LEVELS[hud.serviceLevel + 1];
  const meta = session.sim.state.meta;
  const setSpeed = (speed: number) => act({ type: 'setSpeed', speed });

  return (
    <header className="topbar">
      <div className="tb-group tb-brand">
        <Icon.Crown size={26} />
        <div className="tb-brand-text">
          <span className="tb-company">{meta.company}</span>
          <span className="tb-city">{meta.city}</span>
        </div>
      </div>

      <div className="tb-group tb-main">
        <div className="tb-money" tabIndex={0}>
          <MoneyCounter value={hud.money} />
          <MoneyCard />
        </div>
        <div className={`tb-rating ${hud.lowRating ? 'warn' : ''}`} title={`Your rating: an average of recent riders' satisfaction${trend ? ` (${hud.ratingTrend > 0 ? 'up' : 'down'} ${Math.abs(hud.ratingTrend).toFixed(2)} in the last hour)` : ''}`}>
          <Stars value={hud.rating} size={15} />
          <span className="mono">{hud.rating.toFixed(1)}</span>
          {trend !== 0 && <span className={`trend ${trend > 0 ? 'up' : 'down'}`} aria-label={trend > 0 ? 'rising' : 'falling'}><Icon.Trend size={13} /></span>}
        </div>
        <div className="tb-clock" title={`${dayLabel(hud.time)} · ${phase.label}${phase.rush ? ': arterials fill up, expect slow traffic' : ''}`}>
          {night ? <Icon.Moon size={15} /> : <Icon.Sun size={15} />}
          <span className="mono">{clock(hud.time)}</span>
          <span className="tb-day">{dayLabel(hud.time)} · <span className={phase.rush ? 'rush' : ''}>{phase.label}</span></span>
        </div>
        <div className="speed" role="group" aria-label="Game speed">
          <button type="button" className={hud.speed === 0 ? 'on' : ''} aria-label="Pause" title="Pause (Space)" onClick={() => setSpeed(0)}><Icon.Pause size={14} /></button>
          <button type="button" className={hud.speed === 1 ? 'on' : ''} aria-label="Normal speed" title="1×" onClick={() => setSpeed(1)}><Icon.Play size={13} /></button>
          <button type="button" className={hud.speed === 2 ? 'on' : ''} aria-label="Double speed" title="2×" onClick={() => setSpeed(2)}><Icon.Fast size={14} /></button>
          <button type="button" className={hud.speed === 4 ? 'on' : ''} aria-label="Quadruple speed" title="4×" onClick={() => setSpeed(4)}><Icon.Fast size={14} /><span className="x4">4</span></button>
        </div>
      </div>

      <div className="tb-group tb-actions">
        {next && (
          <button type="button" className="tb-btn" title={`Expand service area to ${next.radius} m`}
            onClick={() => act({ type: 'expandService' }, `Service area expanded to ${next.radius} m`)}>
            <Icon.Expand size={16} /><span>Expand <b className="mono">{compactMoney(next.cost)}</b></span>
          </button>
        )}
        <button type="button" className={`tb-btn ${trafficView ? 'on' : ''}`} title="Traffic view (T)" aria-pressed={trafficView}
          onClick={() => ui.set({ trafficView: !trafficView })}><Icon.Layers size={16} /><span>Traffic</span></button>
        <button type="button" className={`tb-btn ${panel === 'goals' ? 'on' : ''}`} title="Goals (G)" onClick={() => ui.set({ panel: panel === 'goals' ? null : 'goals' })}>
          <Icon.Trophy size={16} /><span className="mono">{hud.goals}/{GOALS.length}</span>
        </button>
        <button type="button" className={`tb-btn ${panel === 'stats' ? 'on' : ''}`} title="Company stats" onClick={() => ui.set({ panel: panel === 'stats' ? null : 'stats' })}>
          <Icon.Chart size={16} />
        </button>
        <button type="button" className="tb-btn" title="Menu (Esc)" aria-label="Menu" onClick={() => ui.set({ panel: 'menu' })}><Icon.Menu size={16} /></button>
      </div>
    </header>
  );
}
