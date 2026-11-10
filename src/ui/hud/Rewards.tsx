// The pull to keep playing: the next goal and how close it is, the current
// streak of riders served without losing one, and a banner for big moments.

import { useEffect } from 'react';
import { GOALS } from '../../sim/content';
import { compactMoney } from '../format';
import { Icon } from '../icons';
import { useStore } from '../store';
import { useGame } from './context';

const fmt = (n: number) => (n >= 10000 ? compactMoney(n).replace('$', '') : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function GoalChip() {
  const { session, ui } = useGame();
  useStore(ui, (s) => s.tick);
  const streak = useStore(ui, (s) => s.streak);
  const panel = useStore(ui, (s) => s.panel);
  const state = session.sim.state;
  const next = GOALS.find((g) => !state.goals.includes(g.id));
  const prog = next?.progress?.(state);
  const frac = prog ? Math.max(0, Math.min(1, prog[0] / prog[1])) : 0;
  if (!next && streak < 3) return null;
  return (
    <div className="goal-row">
      {next && (
        <button type="button" className="goal-chip" title={`Next goal: ${next.detail} (G for all goals)`}
          onClick={() => ui.set({ panel: panel === 'goals' ? null : 'goals' })}>
          <Icon.Trophy size={16} />
          <span><b>{next.title}</b> <span className="goal-detail">· {next.detail}</span></span>
          {prog && (
            <>
              <span className={`goal-bar ${frac >= 0.8 ? 'near' : ''}`}><i style={{ width: `${frac * 100}%` }} /></span>
              <span className="mono">{fmt(Math.min(prog[0], prog[1]))}/{fmt(prog[1])}</span>
            </>
          )}
          {next.reward > 0 && <span className="goal-reward mono">+{compactMoney(next.reward)}</span>}
        </button>
      )}
      {streak >= 3 && (
        <div key={streak} className={`streak-chip ${streak >= 10 ? 'hot' : ''}`} title="Riders served in a row without losing one">
          <b className="mono">×{streak}</b> streak
        </div>
      )}
    </div>
  );
}

const KICKER = { goal: 'Goal complete', day: 'A new day', expand: 'Expanded', streak: 'Perfect streak' } as const;

export function Banner() {
  const { ui } = useGame();
  const banner = useStore(ui, (s) => s.banner);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => { if (ui.get().banner?.id === banner.id) ui.set({ banner: null }); }, 3400);
    return () => clearTimeout(t);
  }, [banner, ui]);
  if (!banner) return null;
  return (
    <div key={banner.id} className={`banner ${banner.kind}`} role="status">
      <span className="banner-kicker">{KICKER[banner.kind]}</span>
      <span className="banner-title">{banner.title}</span>
      <span className="banner-sub">{banner.sub}</span>
    </div>
  );
}
