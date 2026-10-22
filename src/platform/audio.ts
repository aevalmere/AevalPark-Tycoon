// Tiny synthesised sound effects. No audio files; each sound is a couple of
// oscillators with an envelope. Rate-limited so a busy rush hour stays pleasant.

export type Sound = 'coin' | 'build' | 'fail' | 'click' | 'goal' | 'sale' | 'alert';

export class Sfx {
  enabled = true;
  volume = 0.5;
  private ctx: AudioContext | null = null;
  private last = new Map<Sound, number>();
  private static readonly GAP: Record<Sound, number> = { coin: 0.09, build: 0.1, fail: 0.25, click: 0.03, goal: 0.5, sale: 0.3, alert: 1 };

  private ensure() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(ctx: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain * this.volume, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  play(s: Sound) {
    if (!this.enabled || this.volume <= 0) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - (this.last.get(s) ?? -1) < Sfx.GAP[s]) return;
    this.last.set(s, t);
    switch (s) {
      case 'coin':
        this.tone(ctx, 1318, t, 0.08, 'triangle', 0.12);
        this.tone(ctx, 1760, t + 0.06, 0.14, 'triangle', 0.1);
        break;
      case 'sale':
        this.tone(ctx, 784, t, 0.1, 'triangle', 0.14);
        this.tone(ctx, 1046, t + 0.08, 0.1, 'triangle', 0.12);
        this.tone(ctx, 1568, t + 0.16, 0.22, 'triangle', 0.1);
        break;
      case 'build':
        this.tone(ctx, 180, t, 0.18, 'sine', 0.3, 70);
        this.tone(ctx, 520, t + 0.04, 0.12, 'square', 0.04);
        break;
      case 'fail':
        this.tone(ctx, 330, t, 0.22, 'sawtooth', 0.06, 180);
        break;
      case 'click':
        this.tone(ctx, 900, t, 0.03, 'square', 0.03);
        break;
      case 'goal':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(ctx, f, t + i * 0.09, 0.25, 'triangle', 0.13));
        break;
      case 'alert':
        this.tone(ctx, 660, t, 0.14, 'square', 0.05);
        this.tone(ctx, 494, t + 0.16, 0.2, 'square', 0.05);
        break;
    }
  }
}

export const sfx = new Sfx();
