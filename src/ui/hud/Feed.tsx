import { useEffect } from 'react';
import { useStore } from '../store';
import { useGame } from './context';

const LIFE = 6500;

export function Feed() {
  const { ui, focus } = useGame();
  const toasts = useStore(ui, (s) => s.toasts);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setInterval(() => {
      const now = Date.now();
      if (ui.get().toasts.some((x) => now - x.at > LIFE)) ui.set((s) => ({ toasts: s.toasts.filter((x) => now - x.at <= LIFE) }));
    }, 500);
    return () => clearInterval(t);
  }, [toasts.length, ui]);
  return (
    <div className="feed" aria-live="polite">
      {toasts.slice(-5).map((t) => (
        <button type="button" key={t.id} className={`toast toast-${t.level} ${t.focus ? 'clickable' : ''}`}
          onClick={() => { if (t.focus) focus(t.focus.x, t.focus.y); ui.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })); }}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
