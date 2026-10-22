import type { ReactNode } from 'react';
import { KIND_LABEL } from '../../world/build';
import { PARK_WALK_RADIUS, ROAD_UPGRADE, speedFactor } from '../../sim/balance';
import { checkBuild, roadUpgradeCost } from '../../sim/commands';
import { STRUCTURES, STRUCTURE_ORDER, TAXI_PRICE, dealerRadius, parkingSpaces, taxiCapacity } from '../../sim/content';
import type { Simulation } from '../../sim/simulation';
import { dayOf, type Structure, type Trip } from '../../sim/state';
import { trafficColor } from '../../render/style';
import { Button } from '../components';
import { distance, money } from '../format';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useGame } from './context';

const ICONS = { taxi: <Icon.Taxi size={18} />, parking: <Icon.Parking size={18} />, dealership: <Icon.Key size={18} /> };

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="row"><span>{k}</span><b>{v}</b></div>;
}

function Meter({ value, color }: { value: number; color: string }) {
  return <div className="meter"><div style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: color }} /></div>;
}

function tripStatus(sim: Simulation, t: Trip): string {
  const dest = sim.wb(t.dest)?.name ?? 'somewhere';
  if (t.status === 'pickup') return 'A taxi is on the way';
  if (t.status === 'riding') return t.mode === 'car' ? `Driving to park near ${dest}` : `In a taxi to ${dest}`;
  if (t.reason === 'parking') return `Has a car, but there's no free parking within ${PARK_WALK_RADIUS} m of ${dest}`;
  if (t.reason === 'taxi') return t.hasCar ? 'No parking near the destination and no free taxi' : 'Needs a taxi and none are free';
  return 'Waiting for a ride';
}

function TripsHere({ sim, building }: { sim: Simulation; building: string }) {
  const { ui } = useGame();
  const trips = Object.values(sim.state.trips).filter((t) => t.origin === building);
  if (!trips.length) return null;
  return (
    <div className="insp-section">
      <h4>Riders waiting here</h4>
      {trips.map((t) => (
        <button type="button" key={t.id} className="trip-line" onClick={() => ui.set({ selection: { kind: 'trip', id: t.id } })}>
          {t.hasCar ? <Icon.Car size={14} /> : <Icon.Users size={14} />}
          <span>to {sim.wb(t.dest)?.name}</span>
          <Meter value={1 - t.waited / t.patience} color={1 - t.waited / t.patience > 0.5 ? '#22c55e' : '#f59e0b'} />
        </button>
      ))}
    </div>
  );
}

function StructureView({ sim, st }: { sim: Simulation; st: Structure }) {
  const { act, session } = useGame();
  const b = sim.wb(st.building)!;
  const def = STRUCTURES[st.kind];
  const upCost = st.level < def.maxLevel ? def.upgradeCost(st, b) : null;
  const refund = Math.round(def.cost(b) * 0.4);
  const units = session.settings.units;
  return (
    <>
      <header className="insp-head" style={{ '--accent': def.color } as React.CSSProperties}>
        <span className="insp-icon">{ICONS[st.kind]}</span>
        <div>
          <h3>{b.name}</h3>
          <p>{def.levelNames[st.level - 1]} · level {st.level}/{def.maxLevel}</p>
        </div>
      </header>
      {st.kind === 'parking' && (() => {
        const spaces = parkingSpaces(b, st.level);
        const used = st.parked?.length ?? 0;
        return (
          <div className="insp-section">
            <Row k="Spaces in use" v={<span className="mono">{used} / {spaces}</span>} />
            <Meter value={used / spaces} color={used / spaces > 0.9 ? '#ef4444' : def.color} />
            <Row k="Drivers walk up to" v={distance(PARK_WALK_RADIUS, units)} />
            <label className="slider">
              <span>Parking fee <b className="mono">{st.fee ? money(st.fee) : 'Free'}</b></span>
              <input type="range" min={0} max={30} step={1} value={st.fee ?? 0} onChange={(e) => act({ type: 'setFee', structure: st.id, fee: Number(e.target.value) })} />
              <small>Above $6 drivers grumble; free parking earns goodwill but no money.</small>
            </label>
          </div>
        );
      })()}
      {st.kind === 'taxi' && (() => {
        const out = sim.taxisOut(st.id);
        const cap = taxiCapacity(st.level);
        return (
          <div className="insp-section">
            <Row k="Taxis" v={<span className="mono">{st.taxis} / {cap} bays</span>} />
            <Row k="Out on jobs" v={<span className="mono">{out}</span>} />
            <div className="btn-row">
              <Button variant="primary" size="sm" disabled={(st.taxis ?? 0) >= cap} onClick={() => act({ type: 'buyTaxi', structure: st.id }, 'New taxi on the road')}>
                <Icon.Plus size={14} /> Buy taxi <span className="mono">{money(TAXI_PRICE)}</span>
              </Button>
              <Button size="sm" disabled={!st.taxis} onClick={() => act({ type: 'sellTaxi', structure: st.id })}><Icon.Minus size={14} /> Sell</Button>
            </div>
            <label className="slider">
              <span>Fares (all depots) <b className="mono">{Math.round(sim.state.fareMult * 100)}%</b></span>
              <input type="range" min={0.5} max={2} step={0.05} value={sim.state.fareMult} onChange={(e) => act({ type: 'setFare', mult: Number(e.target.value) })} />
              <small>Higher fares earn more per ride and cost you stars.</small>
            </label>
          </div>
        );
      })()}
      {st.kind === 'dealership' && (
        <div className="insp-section">
          <Row k="Sells cars within" v={distance(dealerRadius(st.level), units)} />
          <Row k="Cars sold" v={<span className="mono">{st.sales ?? 0}</span>} />
          <p className="hint">Each sale earns a commission and turns a taxi rider into a driver who needs parking.</p>
        </div>
      )}
      <div className="insp-section">
        <Row k="Lifetime revenue" v={<span className="mono pos">{money(st.revenue)}</span>} />
        <Row k="Upkeep" v={<span className="mono neg">{money(def.upkeepPerDay(st, b))}/day</span>} />
        <Row k="Opened" v={`Day ${dayOf(st.builtAt)}`} />
      </div>
      <div className="btn-row">
        {upCost !== null && (
          <Button variant="primary" onClick={() => act({ type: 'upgrade', structure: st.id }, `Upgraded to ${def.levelNames[st.level]}`)}>
            <Icon.ArrowUp size={15} /> {def.levelNames[st.level]} <span className="mono">{money(upCost)}</span>
          </Button>
        )}
        <Button variant="danger" onClick={() => act({ type: 'demolish', structure: st.id }, `Sold for ${money(refund)}`)}>
          Sell <span className="mono">{money(refund)}</span>
        </Button>
      </div>
    </>
  );
}

function BuildingView({ sim, idx }: { sim: Simulation; idx: number }) {
  const { act, ui } = useGame();
  const b = sim.world.buildings[idx];
  const sid = sim.structureAt.get(b.id);
  if (sid) return <StructureView sim={sim} st={sim.state.structures[sid]} />;
  const isHq = idx === sim.world.hq;
  const st = sim.state.buildings[b.id];
  const inService = sim.inService(b);
  const me = sim.me;
  return (
    <>
      <header className="insp-head" style={{ '--accent': isHq ? '#e8a33d' : st?.active ? '#f4c27f' : '#94a3b8' } as React.CSSProperties}>
        <span className="insp-icon">{isHq ? <Icon.Crown size={20} /> : <Icon.Pin size={18} />}</span>
        <div>
          <h3>{isHq ? `${sim.state.meta.company} HQ` : b.name}</h3>
          <p>{KIND_LABEL[b.kind]}{b.street && !b.name.includes(b.street) ? ` · ${b.street}` : ''} · {Math.round(b.height)} m tall</p>
        </div>
      </header>
      {isHq ? (
        <div className="insp-section">
          <Row k="Trips completed" v={<span className="mono">{sim.state.stats.served.toLocaleString()}</span>} />
          <Row k="Riders lost" v={<span className="mono">{sim.state.stats.failed.toLocaleString()}</span>} />
          <Row k="Revenue to date" v={<span className="mono pos">{money(me.revenue)}</span>} />
          <Row k="Spent to date" v={<span className="mono neg">{money(me.expenses)}</span>} />
          <Row k="Network" v={`${sim.getActive().length} buildings`} />
        </div>
      ) : (
        <div className="insp-section">
          <Row k="Status" v={!b.playable ? 'No road access' : !inService ? 'Outside service area' : st?.active ? `Customer since day ${dayOf(st.since)}` : 'Not a customer yet'} />
          {st && <Row k="Households with a car" v={<span className="mono">{Math.round(st.car * 100)}%</span>} />}
          {st && <Meter value={st.car} color="#2563eb" />}
        </div>
      )}
      <TripsHere sim={sim} building={b.id} />
      {!isHq && b.playable && (
        <div className="insp-section">
          <h4>Convert this building</h4>
          <div className="convert-grid">
            {STRUCTURE_ORDER.map((k) => {
              const c = checkBuild(sim, k, idx);
              return (
                <button type="button" key={k} className="convert" disabled={!c.ok} title={c.error ?? STRUCTURES[k].blurb}
                  style={{ '--accent': STRUCTURES[k].color } as React.CSSProperties}
                  onClick={() => { if (act({ type: 'build', kind: k, building: b.id }, `${STRUCTURES[k].name} opened at ${b.name}`)) ui.set({ selection: { kind: 'building', idx } }); }}>
                  <span className="convert-icon">{ICONS[k]}</span>
                  <span>{STRUCTURES[k].name}</span>
                  <b className="mono">{money(c.cost)}</b>
                </button>
              );
            })}
          </div>
          {st?.active && <p className="hint">Converting a customer's building removes it from your network.</p>}
        </div>
      )}
    </>
  );
}

function TripView({ sim, id }: { sim: Simulation; id: string }) {
  const { ui, focus } = useGame();
  const t = sim.state.trips[id];
  if (!t) return <p className="hint">This trip is finished.</p>;
  const o = sim.wb(t.origin)!, d = sim.wb(t.dest)!;
  const frac = 1 - t.waited / t.patience;
  const straight = Math.hypot(o.cx - d.cx, o.cy - d.cy);
  return (
    <>
      <header className="insp-head" style={{ '--accent': t.hasCar ? '#2563eb' : '#f5b82e' } as React.CSSProperties}>
        <span className="insp-icon">{t.hasCar ? <Icon.Car size={18} /> : <Icon.Users size={18} />}</span>
        <div>
          <h3>{t.hasCar ? 'Driver' : 'Rider'} heading out</h3>
          <p>{tripStatus(sim, t)}</p>
        </div>
      </header>
      <div className="insp-section route-pair">
        <button type="button" onClick={() => { focus(o.cx, o.cy); ui.set({ selection: { kind: 'trip', id } }); }}><span className="dot from" /> {o.name}</button>
        <button type="button" onClick={() => focus(d.cx, d.cy)}><span className="dot to" /> {d.name}</button>
        <Row k="Distance" v={distance(straight, 'metric')} />
      </div>
      {t.status !== 'riding' && (
        <div className="insp-section">
          <Row k="Patience" v={<span className="mono">{Math.round(frac * 100)}%</span>} />
          <Meter value={frac} color={frac > 0.55 ? '#22c55e' : frac > 0.28 ? '#f59e0b' : '#ef4444'} />
        </div>
      )}
      {t.status === 'waiting' && t.reason === 'parking' && (
        <div className="insp-section">
          <p className="hint">Convert a building within {PARK_WALK_RADIUS} m of {d.name} into a parking lot, or open a taxi depot so drivers can leave the car at home.</p>
          <Button variant="primary" size="sm" onClick={() => { ui.set({ tool: 'parking' }); focus(d.cx, d.cy, 16.8); }}><Icon.Parking size={15} /> Find a lot site</Button>
        </div>
      )}
      {t.status === 'waiting' && t.reason === 'taxi' && (
        <div className="insp-section">
          <p className="hint">Every taxi is busy or you don't have a depot yet. Buy taxis at a depot or open one nearby.</p>
          <Button variant="primary" size="sm" onClick={() => { ui.set({ tool: 'taxi' }); focus(o.cx, o.cy, 16.6); }}><Icon.Taxi size={15} /> Open a depot</Button>
        </div>
      )}
    </>
  );
}

function LinkView({ sim, idx }: { sim: Simulation; idx: number }) {
  const { act, session } = useGame();
  const l = sim.world.links[idx];
  const edges = sim.world.linkEdges[idx];
  const t = Math.max(...edges.map((e) => sim.traffic[e]));
  const cars = edges.reduce((n, e) => n + sim.load[e], 0);
  const lanes = sim.lanesOf(idx);
  const extra = sim.state.roads[l.id] ?? 0;
  const cost = roadUpgradeCost(sim, idx);
  const speed = Math.round(l.kmh * speedFactor(t));
  const label = t < 0.3 ? 'Flowing' : t < 0.5 ? 'Busy' : t < 0.7 ? 'Slow' : t < 0.85 ? 'Congested' : 'Gridlocked';
  return (
    <>
      <header className="insp-head" style={{ '--accent': trafficColor(t) } as React.CSSProperties}>
        <span className="insp-icon"><Icon.Road size={18} /></span>
        <div>
          <h3>{l.name || 'Unnamed street'}</h3>
          <p>{l.cls === 'minor' ? 'Local street' : l.cls[0].toUpperCase() + l.cls.slice(1) + ' road'} · {l.oneway ? 'one-way' : 'two-way'}{l.bridge ? ' · bridge' : ''}</p>
        </div>
      </header>
      <div className="insp-section">
        <Row k="Traffic" v={<span style={{ color: trafficColor(t) }}>{label} · {Math.round(t * 100)}%</span>} />
        <Meter value={t} color={trafficColor(t)} />
        <Row k="Speed now" v={`${speed} of ${l.kmh} km/h`} />
        <Row k="Cars on it" v={<span className="mono">{Math.round(cars)}</span>} />
        <Row k="Lanes each way" v={<span className="mono">{lanes}{extra ? ` (+${extra})` : ''}</span>} />
        <Row k="Length" v={distance(l.length, session.settings.units)} />
      </div>
      {extra < ROAD_UPGRADE.maxExtraLanes ? (
        <Button variant="primary" onClick={() => act({ type: 'upgradeRoad', link: l.id }, `${l.name || 'Street'} widened to ${lanes + 1} lanes`)}>
          <Icon.Plus size={15} /> Add a lane <span className="mono">{money(cost)}</span>
        </Button>
      ) : <p className="hint">Already widened as far as the street allows.</p>}
    </>
  );
}

export function Inspector() {
  const { ui, session } = useGame();
  const sel = useStore(ui, (s) => s.selection);
  useStore(ui, (s) => s.tick);
  if (!sel) return null;
  const sim = session.sim;
  return (
    <aside className="inspector" aria-label="Details">
      <button type="button" className="icon-btn insp-close" aria-label="Close details" onClick={() => ui.set({ selection: null })}><Icon.Close size={16} /></button>
      {sel.kind === 'building' && <BuildingView sim={sim} idx={sel.idx} />}
      {sel.kind === 'trip' && <TripView sim={sim} id={sel.id} />}
      {sel.kind === 'link' && <LinkView sim={sim} idx={sel.idx} />}
    </aside>
  );
}
