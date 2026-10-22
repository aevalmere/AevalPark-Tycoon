import type { ReactNode } from 'react';
import { PARK_WALK_RADIUS } from '../../sim/balance';
import { STRUCTURES, dealerRadius } from '../../sim/content';
import { Icon } from '../icons';
import { useStore, type Tool } from '../store';
import { useGame } from './context';

const TOOLS: { tool: Tool; key: string; label: string; icon: ReactNode; color?: string }[] = [
  { tool: 'select', key: 'Esc', label: 'Select', icon: <Icon.Pointer size={20} /> },
  { tool: 'taxi', key: '1', label: 'Taxi depot', icon: <Icon.Taxi size={22} />, color: STRUCTURES.taxi.color },
  { tool: 'parking', key: '2', label: 'Parking', icon: <Icon.Parking size={21} />, color: STRUCTURES.parking.color },
  { tool: 'dealership', key: '3', label: 'Dealership', icon: <Icon.Key size={21} />, color: STRUCTURES.dealership.color },
  { tool: 'road', key: '4', label: 'Widen road', icon: <Icon.Road size={21} />, color: '#e8a33d' },
];

const TOOL_HINTS: Record<Tool, string> = {
  select: '',
  taxi: 'Click a building inside your service area to open a taxi depot there.',
  parking: `Click a building to convert it into a parking lot. Drivers walk up to ${PARK_WALK_RADIUS} m from it.`,
  dealership: `Click a building to open a dealership. It sells cars within ${dealerRadius(1)} m.`,
  road: 'Click a street to see its traffic and add lanes.',
};

export function Toolbar() {
  const { ui } = useGame();
  const tool = useStore(ui, (s) => s.tool);
  return (
    <nav className="toolbar" aria-label="Build tools">
      {TOOLS.map((t) => (
        <button key={t.tool} type="button" className={`tool ${tool === t.tool ? 'on' : ''}`} aria-pressed={tool === t.tool}
          title={`${t.label} (${t.key})`} style={t.color ? ({ '--tool': t.color } as React.CSSProperties) : undefined}
          onClick={() => ui.set({ tool: t.tool, selection: t.tool === 'select' ? ui.get().selection : null })}>
          <span className="tool-icon">{t.icon}</span>
          <span className="tool-label">{t.label}</span>
          <kbd>{t.key}</kbd>
        </button>
      ))}
    </nav>
  );
}

export function ToolHint() {
  const { ui } = useGame();
  const tool = useStore(ui, (s) => s.tool);
  if (tool === 'select') return null;
  return (
    <div className="tool-hint" role="status">
      {TOOL_HINTS[tool]} <span className="tool-hint-esc">Right-click or Esc to stop.</span>
    </div>
  );
}
