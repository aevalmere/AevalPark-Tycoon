import { createContext, useContext } from 'react';
import type { GameSession } from '../../game/session';
import type { Command } from '../../sim/commands';
import type { GameUi, Store, Toast } from '../store';

export interface GameCtxValue {
  session: GameSession;
  ui: Store<GameUi>;
  /** send a command; failures surface as a toast */
  act: (cmd: Command, success?: string) => boolean;
  toast: (level: Toast['level'], text: string, focus?: Toast['focus']) => void;
  focus: (x: number, y: number, zoom?: number) => void;
  /** select and fly to the waiting rider closest to giving up (cycles on repeat) */
  urgent: () => void;
  quit: () => void;
}

export const GameCtx = createContext<GameCtxValue | null>(null);

export function useGame(): GameCtxValue {
  const c = useContext(GameCtx);
  if (!c) throw new Error('useGame outside a game');
  return c;
}
