import { KIND_LABEL } from '../../world/build';
import { siteReport, type SiteReport } from '../../sim/advisor';
import { PARK_WALK_RADIUS, TAXI_REACH } from '../../sim/balance';
import { STRUCTURES } from '../../sim/content';
import { checkBuild } from '../../sim/commands';
import { trafficColor } from '../../render/style';
import { distance, money } from '../format';
import { useStore } from '../store';
import { describeVehicle } from '../vehicles';
import { useGame } from './context';

/** What building here would do, in a few lines a player can weigh at a glance. */
function SiteLines({ r, units }: { r: SiteReport; units: 'metric' | 'imperial' }) {
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const lines: { text: string; tone?: 'hot' | 'warn' | 'dim' }[] = [];
  if (r.kind === 'parking') {
    lines.push({ text: `${plural(r.capacity, 'space')} · ${plural(r.customers, 'customer')} within ${distance(PARK_WALK_RADIUS, units)}` });
    lines.push(r.demand > 0
      ? { text: `${plural(r.demand, 'driver')} recently found nowhere to park near here`, tone: 'hot' }
      : { text: 'No drivers stuck for parking around here yet', tone: 'dim' });
    if (r.nearest && r.nearest.d < PARK_WALK_RADIUS) lines.push({ text: `Overlaps ${r.nearest.name}, ${distance(r.nearest.d, units)} away`, tone: 'warn' });
  } else if (r.kind === 'taxi') {
    lines.push({ text: `${plural(r.capacity, 'taxi bay')} now, ${r.capacity * STRUCTURES.taxi.maxLevel} fully upgraded` });
    lines.push({ text: `${plural(r.customers, 'customer')} within ${distance(TAXI_REACH, units)}` });
    if (r.demand > 0) lines.push({ text: `${plural(r.demand, 'rider')} recently went without a taxi nearby`, tone: 'hot' });
    lines.push(r.nearest ? { text: `Nearest depot ${distance(r.nearest.d, units)} away`, tone: r.nearest.d < 250 ? 'warn' : 'dim' } : { text: 'Your first depot', tone: 'dim' });
  } else {
    lines.push({ text: `${plural(r.customers, 'customer')} in reach · ${Math.round(r.carShare * 100)}% already drive` });
    lines.push({ text: `About ${r.sales.toFixed(1)} sales a day to start`, tone: r.sales >= 1 ? 'hot' : 'dim' });
    if (r.nearest && r.nearest.d < 500) lines.push({ text: `Shares buyers with ${r.nearest.name}`, tone: 'warn' });
  }
  lines.push({ text: `Upkeep ${money(r.upkeep)}/day`, tone: 'dim' });
  return <>{lines.map((l, i) => <span key={i} className={`tt-line ${l.tone ? `tt-${l.tone}` : ''}`}>{l.text}</span>)}</>;
}

export function Tooltip() {
  const { ui, session } = useGame();
  const hover = useStore(ui, (s) => s.hover);
  const tool = useStore(ui, (s) => s.tool);
  useStore(ui, (s) => s.tick);
  if (!hover) return null;
  const sim = session.sim;
  const units = session.settings.units;
  let body: React.ReactNode = null;
  if (hover.kind === 'vehicle') {
    const v = sim.vehicles.get(hover.idx);
    if (!v) return null;
    const d = describeVehicle(sim, v);
    body = (
      <>
        <b style={{ color: d.color }}>{d.title}</b>
        <span>{d.status}</span>
      </>
    );
  } else if (hover.kind === 'building') {
    const b = sim.world.buildings[hover.idx];
    if (!b) return null;
    const sid = sim.structureAt.get(b.id);
    const st = sid ? sim.state.structures[sid] : undefined;
    if (tool === 'taxi' || tool === 'parking' || tool === 'dealership') {
      const c = checkBuild(sim, tool, hover.idx);
      body = (
        <>
          <b>{b.name}</b>
          <span className={c.ok ? 'tt-ok' : 'tt-bad'}>{c.ok ? `${STRUCTURES[tool].name} · ${money(c.cost)}` : c.error}</span>
          {b.playable && !st && hover.idx !== sim.world.hq && <SiteLines r={siteReport(sim, tool, b)} units={units} />}
        </>
      );
    } else {
      body = (
        <>
          <b>{hover.idx === sim.world.hq ? 'Your headquarters' : b.name}</b>
          <span>{st ? STRUCTURES[st.kind].levelNames[st.level - 1] : sim.state.buildings[b.id]?.active ? `${KIND_LABEL[b.kind]} · customer` : KIND_LABEL[b.kind]}</span>
        </>
      );
    }
  } else {
    const l = sim.world.links[hover.idx];
    if (!l) return null;
    const t = Math.max(...sim.world.linkEdges[hover.idx].map((e) => sim.traffic[e]));
    body = (
      <>
        <b>{l.name || 'Street'}</b>
        <span style={{ color: trafficColor(t) }}>Traffic {Math.round(t * 100)}%</span>
      </>
    );
  }
  return <div className="tooltip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 14}px)` }}>{body}</div>;
}
