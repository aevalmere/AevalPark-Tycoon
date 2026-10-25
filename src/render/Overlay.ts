// 2D canvas above the map for things that are UI rather than world: rider
// bubbles with patience rings, structure badges, floating money, pings,
// kerbside-incident pulses, night-time headlight glows, selection outlines and
// demand heat. Positions come from the same matrix as the 3D models, so
// bubbles sit on real rooftops.
//
// It redraws every frame, so anything with a blur or gradient (bubble discs,
// badges, glows) is rendered once into a small sprite canvas and stamped.

import { projectLocal } from './ModelLayer';

export type Glyph = 'person' | 'car' | 'taxi' | 'p' | 'crown' | 'flag' | 'warn' | 'key';

const PATHS: Record<Exclude<Glyph, 'p'>, string> = {
  person: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  car: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  taxi: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5H15V3H9v2H6.5c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  crown: 'M3 17 L3 8 L8 12 L12 5 L16 12 L21 8 L21 17 Z M3 19 h18 v2 h-18 Z',
  flag: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z',
  warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  key: 'M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
};
const path2d = new Map<string, Path2D>();
const P = (g: Exclude<Glyph, 'p'>) => {
  let p = path2d.get(g);
  if (!p) { p = new Path2D(PATHS[g]); path2d.set(g, p); }
  return p;
};

function drawGlyph(c: CanvasRenderingContext2D, g: Glyph, x: number, y: number, size: number, color: string) {
  if (g === 'p') {
    c.fillStyle = color;
    c.font = `800 ${Math.round(size * 0.82)}px "Hanken Grotesk", system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('P', x, y + 0.5);
    return;
  }
  c.save();
  c.translate(x - size / 2, y - size / 2);
  c.scale(size / 24, size / 24);
  c.fillStyle = color;
  c.fill(P(g));
  c.restore();
}

export interface FloatText {
  x: number; y: number; z: number;
  text: string;
  color: string;
  born: number;
  life: number;
  /** smaller, quieter text (parking fees ticking in) */
  small?: boolean;
}

export interface Ping {
  x: number; y: number;
  color: string;
  born: number;
  life: number;
}

export interface BubbleHit {
  trip: string;
  x: number;
  y: number;
  r: number;
}

/** A pre-rendered image and where its anchor sits inside it, in CSS pixels. */
interface Sprite { img: HTMLCanvasElement; w: number; h: number; ax: number; ay: number }

const SPRITE_LIMIT = 400;

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  /** cap on canvas pixels per CSS pixel (graphics quality) */
  maxDpr = 2;
  private dpr = 1;
  private sized = false;
  private resize: ResizeObserver;
  m: Float64Array | null = null;
  floats: FloatText[] = [];
  pings: Ping[] = [];
  hits: BubbleHit[] = [];
  dark = false;
  private sprites = new Map<string, Sprite>();

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-overlay';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    // measuring the parent every frame would force a layout whenever the HUD changed
    this.resize = new ResizeObserver(() => { this.sized = false; });
    this.resize.observe(parent);
  }

  begin(m: Float64Array) {
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    if (!this.sized || dpr !== this.dpr) {
      const r = this.canvas.parentElement!.getBoundingClientRect();
      this.w = r.width; this.h = r.height;
      if (dpr !== this.dpr) this.sprites.clear();
      this.dpr = dpr;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.sized = true;
    }
    this.m = m;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    this.hits.length = 0;
  }

  /** anything still animating on its own (the renderer keeps repainting while true) */
  busy(now: number) {
    return this.floats.some((f) => now - f.born < f.life) || this.pings.some((p) => now - p.born < p.life);
  }

  project(x: number, y: number, z: number): [number, number] | null {
    if (!this.m) return null;
    const p = projectLocal(this.m, x, y, z, this.w, this.h);
    if (!p || p[0] < -80 || p[1] < -80 || p[0] > this.w + 80 || p[1] > this.h + 80) return null;
    return p;
  }

  /** projected even when off screen (for lines that cross the edge), null only behind the camera */
  private projectAny(x: number, y: number, z: number): [number, number] | null {
    return this.m ? projectLocal(this.m, x, y, z, this.w, this.h) : null;
  }

  glyph(g: Glyph, x: number, y: number, size: number, color: string) {
    drawGlyph(this.ctx, g, x, y, size, color);
  }

  // ---------- sprites ----------

  private sprite(key: string, w: number, h: number, ax: number, ay: number, draw: (c: CanvasRenderingContext2D) => void): Sprite {
    let s = this.sprites.get(key);
    if (s) return s;
    if (this.sprites.size > SPRITE_LIMIT) this.sprites.clear();
    const img = document.createElement('canvas');
    img.width = Math.ceil(w * this.dpr);
    img.height = Math.ceil(h * this.dpr);
    const c = img.getContext('2d')!;
    c.scale(this.dpr, this.dpr);
    draw(c);
    s = { img, w, h, ax, ay };
    this.sprites.set(key, s);
    return s;
  }

  private stamp(s: Sprite, x: number, y: number, scale = 1) {
    this.ctx.drawImage(s.img, x - s.ax * scale, y - s.ay * scale, s.w * scale, s.h * scale);
  }

  /** bubble disc with its drop shadow and glyph */
  private disc(r: number, glyph: Glyph, glyphColor: string): Sprite {
    const pad = 12, size = (r + pad) * 2;
    return this.sprite(`disc|${r}|${glyph}|${glyphColor}|${this.dark}`, size, size, size / 2, size / 2, (c) => {
      c.shadowColor = 'rgba(0,0,0,0.28)';
      c.shadowBlur = 8;
      c.shadowOffsetY = 2;
      c.fillStyle = this.dark ? '#1b2230' : '#ffffff';
      c.beginPath(); c.arc(size / 2, size / 2, r, 0, Math.PI * 2); c.fill();
      c.shadowColor = 'transparent';
      c.lineWidth = 3;
      c.strokeStyle = this.dark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)';
      c.beginPath(); c.arc(size / 2, size / 2, r - 1.5, 0, Math.PI * 2); c.stroke();
      drawGlyph(c, glyph, size / 2, size / 2, r * 1.15, glyphColor);
    });
  }

  /** soft round glow, white so globalAlpha and size do the work */
  private glow(color: string): Sprite {
    return this.sprite(`glow|${color}`, 64, 64, 32, 32, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    });
  }

  // ---------- world-anchored UI ----------

  /** A rider waiting on a rooftop: patience ring, glyph, and a need badge. */
  bubble(trip: string, x: number, y: number, z: number, stack: number, frac: number, glyph: Glyph, glyphColor: string, badge: { glyph: Glyph; bg: string; fg: string } | null, selected: boolean, pulse: number, accent: string | null = null) {
    const base = this.project(x, y, z);
    if (!base) return;
    const c = this.ctx;
    const r = Math.round((selected || accent ? 15 : 12.5) * (1 + pulse * 0.08) * 2) / 2;
    const bx = base[0] + stack * 9, by = base[1] - 22 - stack * 6;
    // stem
    c.strokeStyle = this.dark ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.35)';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(base[0], base[1]); c.lineTo(bx, by + r); c.stroke();
    this.stamp(this.disc(r, glyph, glyphColor), bx, by);
    // patience ring
    c.strokeStyle = frac > 0.55 ? '#22c55e' : frac > 0.28 ? '#f59e0b' : '#ef4444';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath(); c.arc(bx, by, r - 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, frac)); c.stroke();
    c.lineCap = 'butt';
    if (badge) {
      const ex = bx + r * 0.78, ey = by - r * 0.78;
      c.fillStyle = badge.bg;
      c.beginPath(); c.arc(ex, ey, 7, 0, Math.PI * 2); c.fill();
      c.strokeStyle = this.dark ? '#1b2230' : '#ffffff';
      c.lineWidth = 1.5;
      c.stroke();
      drawGlyph(c, badge.glyph, ex, ey, 10, badge.fg);
    }
    if (selected || accent) {
      c.strokeStyle = selected ? '#e8a33d' : accent!;
      c.lineWidth = 2;
      c.beginPath(); c.arc(bx, by, r + 3.5, 0, Math.PI * 2); c.stroke();
    }
    this.hits.push({ trip, x: bx, y: by, r: r + 3 });
  }

  /** Rounded pill badge over a structure. */
  badge(x: number, y: number, z: number, glyph: Glyph, color: string, text: string, showText: boolean, scale = 1) {
    const p = this.project(x, y, z);
    if (!p) return;
    const label = showText ? text : '';
    const key = `badge|${glyph}|${color}|${label}|${this.dark}`;
    let s = this.sprites.get(key);
    if (!s) {
      this.ctx.font = '700 11px "Geist Mono", ui-monospace, monospace';
      const tw = label ? this.ctx.measureText(label).width + 10 : 0;
      const h = 22, w = 22 + tw, pad = 8;
      s = this.sprite(key, w + pad * 2, h + pad * 2 + 6, (w + pad * 2) / 2, h + pad + 5, (c) => {
        c.shadowColor = 'rgba(0,0,0,0.3)';
        c.shadowBlur = 6;
        c.shadowOffsetY = 2;
        c.fillStyle = this.dark ? '#151b26' : '#ffffff';
        roundRect(c, pad, pad, w, h, 11);
        c.fill();
        c.shadowColor = 'transparent';
        c.fillStyle = color;
        c.beginPath(); c.arc(pad + 11, pad + 11, 9, 0, Math.PI * 2); c.fill();
        drawGlyph(c, glyph, pad + 11, pad + 11, 13, '#ffffff');
        if (tw) {
          c.font = '700 11px "Geist Mono", ui-monospace, monospace';
          c.fillStyle = this.dark ? '#e7ecf5' : '#0f172a';
          c.textAlign = 'left';
          c.textBaseline = 'middle';
          c.fillText(label, pad + 24, pad + 11.5);
        }
        // tail
        c.fillStyle = this.dark ? '#151b26' : '#ffffff';
        const mx = pad + w / 2;
        c.beginPath(); c.moveTo(mx - 4, pad + h - 0.5); c.lineTo(mx, pad + h + 5); c.lineTo(mx + 4, pad + h - 0.5); c.fill();
      });
    }
    this.stamp(s, p[0], p[1] - 6, scale);
  }

  /** dashed polyline in local metres (selected route, link highlight, trip line) */
  polyline(pts: ArrayLike<number>, z: number, color: string, width: number, dash: number[] = []) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.setLineDash(dash);
    c.beginPath();
    let started = false;
    for (let i = 0; i < pts.length; i += 2) {
      const p = this.projectAny(pts[i], pts[i + 1], z);
      if (!p) { started = false; continue; }
      if (!started) { c.moveTo(p[0], p[1]); started = true; } else c.lineTo(p[0], p[1]);
    }
    c.stroke();
    c.setLineDash([]);
  }

  arc3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, width = 2.5, alpha = 1) {
    const a = this.projectAny(x0, y0, z0), b = this.projectAny(x1, y1, z1);
    if (!a || !b) return;
    const c = this.ctx;
    const mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]) - Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.25;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash([6, 6]);
    c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(mx, my, b[0], b[1]); c.stroke();
    c.setLineDash([]);
    c.fillStyle = color;
    c.beginPath(); c.arc(b[0], b[1], width + 1.5, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  }

  /**
   * Glowing outline of a footprint from the ground to its roof, so a selected
   * building reads at any zoom. Drawn over the map, so it shows through towers.
   */
  outline(ring: ArrayLike<number>, z0: number, z1: number, color: string, t: number) {
    const c = this.ctx;
    const n = ring.length / 2, tall = z1 - z0 > 1;
    const lo: ([number, number] | null)[] = [], hi: ([number, number] | null)[] = [];
    for (let i = 0; i < n; i++) {
      lo.push(this.projectAny(ring[i * 2], ring[i * 2 + 1], z0));
      hi.push(this.projectAny(ring[i * 2], ring[i * 2 + 1], z1));
    }
    const loop = (pts: ([number, number] | null)[]) => {
      let started = false;
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n];
        if (!p) { started = false; continue; }
        if (!started) { c.moveTo(p[0], p[1]); started = true; } else c.lineTo(p[0], p[1]);
      }
    };
    const path = () => {
      c.beginPath();
      loop(hi);
      if (!tall) return;
      loop(lo);
      if (n > 48) return;
      for (let i = 0; i < n; i++) {
        const a = lo[i], b = hi[i];
        if (a && b) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      }
    };
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = color;
    for (const [w, a] of [[9, 0.12 + 0.1 * pulse], [2.5, 1]] as const) {
      c.globalAlpha = a;
      c.lineWidth = w;
      path();
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /** A pin above a vehicle tied to the current selection. */
  marker(x: number, y: number, z: number, color: string, t: number) {
    const p = this.project(x, y, z);
    if (!p) return;
    const c = this.ctx;
    const bob = Math.sin(t * 5) * 1.5;
    const px = p[0], py = p[1] - 16 + bob;
    c.fillStyle = color;
    c.strokeStyle = this.dark ? '#0b0f17' : '#ffffff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(px, py + 9);
    c.lineTo(px - 5.5, py + 1.5);
    c.arc(px, py, 6.5, Math.PI * 0.82, Math.PI * 0.18);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = this.dark ? '#0b0f17' : '#ffffff';
    c.beginPath(); c.arc(px, py, 2.2, 0, Math.PI * 2); c.fill();
  }

  /** A soft ground spot sized by unmet demand, with a count once you're close enough to read it. */
  heat(x: number, y: number, rMetres: number, color: string, strength: number, label: string | null) {
    const p = this.project(x, y, 0.5);
    if (!p) return;
    const q = this.projectAny(x + rMetres, y, 0.5);
    const r = q ? Math.max(14, Math.hypot(q[0] - p[0], q[1] - p[1])) : 14;
    const c = this.ctx;
    c.globalAlpha = Math.min(0.85, 0.25 + strength * 0.12);
    this.stamp(this.glow(color), p[0], p[1], r / 32);
    c.globalAlpha = 1;
    if (!label) return;
    c.font = '700 11px "Geist Mono", ui-monospace, monospace';
    const w = c.measureText(label).width + 12;
    c.fillStyle = color;
    roundRect(c, p[0] - w / 2, p[1] - 9, w, 18, 9);
    c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, p[0], p[1] + 0.5);
  }

  incident(x: number, y: number, t: number) {
    const p = this.project(x, y, 1);
    if (!p) return;
    const c = this.ctx;
    const k = (t * 1.6) % 1;
    c.strokeStyle = `rgba(240, 123, 46, ${1 - k})`;
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(p[0], p[1], 6 + k * 18, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#f07b2e';
    c.beginPath(); c.arc(p[0], p[1] - 16, 9, 0, Math.PI * 2); c.fill();
    drawGlyph(c, 'warn', p[0], p[1] - 16.5, 12, '#ffffff');
  }

  /** Night-time pool of light ahead of a car. Call between beginGlow/endGlow. */
  headlight(x: number, y: number, h: number, s: number, strength: number) {
    const fx = x + Math.cos(h) * 7 * s, fy = y + Math.sin(h) * 7 * s;
    const p = this.project(fx, fy, 0.5);
    if (!p) return;
    const q = this.projectAny(x + Math.cos(h) * 1.5 * s, y + Math.sin(h) * 1.5 * s, 0.5);
    if (!q) return;
    const r = Math.max(5, Math.hypot(p[0] - q[0], p[1] - q[1]) * 1.1);
    this.ctx.globalAlpha = 0.55 * strength;
    this.stamp(this.glow('rgba(255, 236, 180, 1)'), p[0], p[1], r / 32);
  }

  beginGlow() {
    this.ctx.globalCompositeOperation = 'lighter';
  }

  endGlow() {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
  }

  /** floating texts and pings; `now` in real seconds */
  effects(now: number) {
    const c = this.ctx;
    if (this.pings.length) this.pings = this.pings.filter((p) => now - p.born < p.life);
    for (const p of this.pings) {
      const k = (now - p.born) / p.life;
      const s = this.project(p.x, p.y, 1);
      if (!s) continue;
      c.strokeStyle = p.color;
      c.globalAlpha = 1 - k;
      c.lineWidth = 3;
      c.beginPath(); c.arc(s[0], s[1], 8 + k * 46, 0, Math.PI * 2); c.stroke();
      c.globalAlpha = 1;
    }
    if (this.floats.length) this.floats = this.floats.filter((f) => now - f.born < f.life);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const f of this.floats) {
      const k = (now - f.born) / f.life;
      const s = this.project(f.x, f.y, f.z);
      if (!s) continue;
      const y = s[1] - (f.small ? 14 : 26) - k * (f.small ? 22 : 34);
      c.font = f.small ? '750 11px "Hanken Grotesk", system-ui, sans-serif' : '800 13px "Hanken Grotesk", system-ui, sans-serif';
      c.globalAlpha = (k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25) * (f.small ? 0.85 : 1);
      c.lineWidth = 3.5;
      c.strokeStyle = this.dark ? 'rgba(10,14,22,0.9)' : 'rgba(255,255,255,0.95)';
      c.strokeText(f.text, s[0], y);
      c.fillStyle = f.color;
      c.fillText(f.text, s[0], y);
      c.globalAlpha = 1;
    }
  }

  hitBubble(px: number, py: number): string | null {
    let best: string | null = null, bestD = Infinity;
    for (const h of this.hits) {
      const d = Math.hypot(px - h.x, py - h.y);
      if (d <= h.r && d < bestD) { bestD = d; best = h.trip; }
    }
    return best;
  }

  destroy() {
    this.resize.disconnect();
    this.canvas.remove();
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
