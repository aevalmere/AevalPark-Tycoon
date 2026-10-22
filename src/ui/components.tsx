import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { trafficColor } from '../render/style';
import { Icon } from './icons';

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) {
  return <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />;
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="star" style={{ width: size, height: size }}>
            <Icon.Star size={size} className="star-bg" />
            <span className="star-fill" style={{ width: `${fill * 100}%` }}><Icon.Star size={size} /></span>
          </span>
        );
      })}
    </span>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          {onClose && <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button>}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
    </label>
  );
}

/** Bar chart of congestion over time, each bar coloured by its own traffic level. */
export function TrafficChart({ values, height = 56 }: { values: number[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = height;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = Math.max(24, values.length);
    const bw = w / n;
    values.forEach((v, i) => {
      const bh = Math.max(2, v * (h - 4));
      ctx.fillStyle = trafficColor(v);
      ctx.beginPath();
      ctx.roundRect(i * bw + 1, h - bh, Math.max(1.5, bw - 2), bh, 2);
      ctx.fill();
    });
  }, [values, height]);
  return <canvas ref={ref} className="traffic-chart" style={{ height }} aria-label="Traffic over the last day" />;
}

export function Sparkline({ values, color = '#e8a33d', height = 40 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return <div className="sparkline-empty" style={{ height }}>Collecting data…</div>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / span) * 90 - 5}`).join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
