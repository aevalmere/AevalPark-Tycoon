import { useEffect, useRef, useState } from 'react';
import { GameSession, type SessionInit } from '../../game/session';
import type { LoadProgress } from '../../platform/worldLoader';
import { Button } from '../components';
import { Icon } from '../icons';

const STEPS: { key: LoadProgress['step']; label: string }[] = [
  { key: 'tiles', label: 'Downloading map tiles' },
  { key: 'roads', label: 'Surveying streets and intersections' },
  { key: 'buildings', label: 'Mapping buildings' },
  { key: 'ready', label: 'Opening for business' },
];

const TIPS = [
  'Taxis that drop riders at a parking lot don’t block the street.',
  'Drivers only park within a short walk of where they’re going.',
  'Dealerships make more drivers, which means more parking demand.',
  'Red streets slow every car on them. Widen the worst ones.',
  'Delighted riders bring their buildings into your network.',
];

export function Loading({ init, onReady, onFail }: { init: SessionInit; onReady: (s: GameSession) => void; onFail: () => void }) {
  const [p, setP] = useState<LoadProgress>({ step: 'tiles', done: 0, total: 1 });
  const [err, setErr] = useState<string | null>(null);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    let alive = true;
    GameSession.create(init, (x) => alive && setP(x))
      .then((s) => { if (alive) ready.current(s); })
      .catch((e) => { console.error(e); if (alive) setErr((e as Error).message || 'Something went wrong while building the world.'); });
    return () => { alive = false; };
  }, [init]);

  const current = STEPS.findIndex((s) => s.key === p.step);
  const frac = p.step === 'tiles' ? (p.done / Math.max(1, p.total)) * 0.6 : p.step === 'roads' ? 0.7 : p.step === 'buildings' ? 0.85 : 1;
  const where = init.mode === 'new' ? init.city : init.state.meta.city;

  return (
    <div className="loading">
      <div className="loading-card">
        <Icon.Crown size={44} />
        <h1>{init.mode === 'new' ? init.company : init.state.meta.company}</h1>
        <p className="loading-where"><Icon.Pin size={14} /> {where}</p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
          <div className="progress-bar" style={{ width: `${frac * 100}%` }} />
        </div>
        <ol className="loading-steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < current ? 'done' : i === current ? 'now' : ''}>
              <span className="dot" />{s.label}{s.key === 'tiles' && i === current && p.total > 1 ? ` (${p.done}/${p.total})` : ''}
            </li>
          ))}
        </ol>
        {err ? (
          <div className="loading-err" role="alert">
            <p>{err}</p>
            <Button onClick={onFail}>Back to menu</Button>
          </div>
        ) : <p className="loading-tip">{tip}</p>}
      </div>
    </div>
  );
}
