import { useState } from 'react';
import { trafficColor } from '../../render/style';
import { TrafficChart } from '../components';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useGame } from './context';

export function CityPulse() {
  const { ui, session, urgent } = useGame();
  const hud = useStore(ui, (s) => s.hud);
  useStore(ui, (s) => s.tick);
  const [open, setOpen] = useState(true);
  const s = session.sim.state;
  const history = s.history.map((h) => h.traffic);
  const values = history.length ? [...history.slice(-95), hud.traffic] : [hud.traffic];
  const car = s.stats.carTrips, taxi = s.stats.taxiTrips;
  const share = car + taxi ? car / (car + taxi) : 0.5;
  const t = s.stats.today;
  return (
    <section className={`pulse ${open ? '' : 'closed'}`} aria-label="City pulse">
      <button type="button" className="pulse-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="pulse-title">City pulse</span>
        <span className="pulse-traffic" style={{ color: trafficColor(hud.traffic) }}>
          <span className="dot" style={{ background: trafficColor(hud.traffic) }} /> Traffic {Math.round(hud.traffic * 100)}%
        </span>
      </button>
      {open && (
        <>
          <TrafficChart values={values} />
          <div className="pulse-axis"><span>24 h ago</span><span>now</span></div>
          <div className="pulse-grid">
            <button type="button" className="pulse-jump" title="Jump to the rider closest to giving up (N)" onClick={urgent} disabled={!hud.waiting}>
              <b className="mono">{hud.waiting}</b><span>waiting <kbd>N</kbd></span>
            </button>
            <div title="Waiting for a free taxi"><b className="mono" style={{ color: hud.needTaxi ? '#f5b82e' : undefined }}>{hud.needTaxi}</b><span><Icon.Taxi size={11} /> need taxi</span></div>
            <div title="Drivers with no free parking near their destination"><b className="mono" style={{ color: hud.needParking ? '#4f8cff' : undefined }}>{hud.needParking}</b><span><Icon.Parking size={11} /> need parking</span></div>
            <div><b className="mono">{t.served}</b><span>served today</span></div>
            <div><b className="mono" style={{ color: t.failed ? '#ef4444' : undefined }}>{t.failed}</b><span>lost today</span></div>
            <div><b className="mono">{hud.active}</b><span>in network</span></div>
          </div>
          <div className="share" title="Trips by car vs taxi">
            <div className="share-bar"><div style={{ width: `${share * 100}%` }} /></div>
            <div className="share-legend"><span><i className="sw car" />Car {Math.round(share * 100)}%</span><span><i className="sw taxi" />Taxi {Math.round((1 - share) * 100)}%</span></div>
          </div>
        </>
      )}
    </section>
  );
}
