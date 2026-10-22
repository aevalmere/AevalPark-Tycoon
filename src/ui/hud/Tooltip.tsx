import { KIND_LABEL } from '../../world/build';
import { STRUCTURES } from '../../sim/content';
import { checkBuild } from '../../sim/commands';
import { trafficColor } from '../../render/style';
import { money } from '../format';
import { useStore } from '../store';
import { useGame } from './context';

export function Tooltip() {
  const { ui, session } = useGame();
  const hover = useStore(ui, (s) => s.hover);
  const tool = useStore(ui, (s) => s.tool);
  useStore(ui, (s) => s.tick);
  if (!hover) return null;
  const sim = session.sim;
  let body: React.ReactNode = null;
  if (hover.kind === 'building') {
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
