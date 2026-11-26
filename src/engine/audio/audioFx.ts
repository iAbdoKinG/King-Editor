/**
 * Per-clip audio effects: 3-band EQ, low/high cut, compressor, echo and
 * reverb, plus ready-made voice presets. The same node chain is built in the
 * live preview (AudioContext) and in export (OfflineAudioContext), so what you
 * hear is what you get.
 *
 * Chain:  in → high-pass → low shelf → mid peak → high shelf → low-pass →
 *         compressor → makeup ─┬─────────────→ out
 *                              ├→ echo (delay + feedback) → out
 *                              └→ reverb (convolver)      → out
 */
import type { AudioFx } from '../../types/project';

export const MAX_VOLUME = 4; // +12 dB

export function defaultAudioFx(): AudioFx {
  return { low: 0, mid: 0, high: 0, highpass: 0, lowpass: 0, compressor: 0, echo: 0, echoTime: 0.3, reverb: 0 };
}

export function fxActive(fx: AudioFx | undefined): fx is AudioFx {
  return !!fx && (fx.low !== 0 || fx.mid !== 0 || fx.high !== 0 || fx.highpass > 0 || fx.lowpass > 0 || fx.compressor > 0 || fx.echo > 0 || fx.reverb > 0);
}

export interface AudioFxPreset {
  id: string;
  name: string;
  fx: Partial<AudioFx>;
}

export const AUDIO_PRESETS: AudioFxPreset[] = [
  { id: 'none', name: 'None', fx: {} },
  { id: 'voice', name: 'Voice boost', fx: { highpass: 90, low: -2, mid: 3, high: 4, compressor: 0.6 } },
  { id: 'clear', name: 'Reduce noise', fx: { highpass: 140, lowpass: 8000, low: -4, high: -2, compressor: 0.35 } },
  { id: 'podcast', name: 'Podcast', fx: { highpass: 75, low: 2, mid: 1, high: 3, compressor: 0.85 } },
  { id: 'deep', name: 'Deep voice', fx: { low: 8, mid: -2, high: -4 } },
  { id: 'bass', name: 'Bass boost', fx: { low: 10, compressor: 0.3 } },
  { id: 'bright', name: 'Bright', fx: { high: 7, low: -2 } },
  { id: 'radio', name: 'Radio', fx: { highpass: 400, lowpass: 4500, mid: 6, compressor: 0.8 } },
  { id: 'phone', name: 'Phone call', fx: { highpass: 320, lowpass: 3400, mid: 4, compressor: 0.5 } },
  { id: 'megaphone', name: 'Megaphone', fx: { highpass: 650, lowpass: 3000, mid: 10, compressor: 1 } },
  { id: 'underwater', name: 'Underwater', fx: { lowpass: 500, low: 4, reverb: 0.3 } },
  { id: 'echo', name: 'Echo', fx: { echo: 0.4, echoTime: 0.32 } },
  { id: 'room', name: 'Room', fx: { reverb: 0.22 } },
  { id: 'hall', name: 'Concert hall', fx: { reverb: 0.5, low: 1 } },
  { id: 'cave', name: 'Cave', fx: { reverb: 0.55, echo: 0.25, echoTime: 0.45, lowpass: 6000 } },
];

export function applyAudioPreset(id: string): AudioFx {
  const p = AUDIO_PRESETS.find((x) => x.id === id);
  return { ...defaultAudioFx(), ...(p?.fx ?? {}), preset: id === 'none' ? undefined : id };
}

/** Linear gain → dB text, e.g. 2 → "+6.0 dB". */
export function gainToDb(g: number): string {
  if (g <= 0.0001) return '−∞ dB';
  const db = 20 * Math.log10(g);
  return `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}

/* ------------------------------- node chain ------------------------------- */

const irCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Deterministic reverb impulse (identical in preview and export). */
function impulse(ctx: BaseAudioContext): AudioBuffer {
  let ir = irCache.get(ctx);
  if (ir) return ir;
  const seconds = 2.4;
  const len = Math.floor(ctx.sampleRate * seconds);
  ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 1234567;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      const t = i / len;
      // Early reflections a little stronger, then an exponential tail.
      d[i] = noise * Math.pow(1 - t, 2.6) * (i < ctx.sampleRate * 0.03 ? 0.4 : 1);
    }
  }
  irCache.set(ctx, ir);
  return ir;
}

export interface FxChain {
  input: AudioNode;
  output: AudioNode;
  update(fx: AudioFx): void;
  disconnect(): void;
}

export function createFxChain(ctx: BaseAudioContext): FxChain {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = 0.707;
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 220;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1600;
  mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 4500;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.707;
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  const out = ctx.createGain();
  hp.connect(low).connect(mid).connect(high).connect(lp).connect(comp).connect(makeup).connect(out);

  // Echo send.
  const delay = ctx.createDelay(1.5);
  const feedback = ctx.createGain();
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0;
  makeup.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(echoWet).connect(out);

  // Reverb send (convolver created on first use; it is the expensive node).
  let conv: ConvolverNode | null = null;
  const revWet = ctx.createGain();
  revWet.gain.value = 0;
  revWet.connect(out);

  const nyquist = ctx.sampleRate / 2;
  return {
    input: hp,
    output: out,
    update(fx) {
      hp.frequency.value = fx.highpass > 0 ? Math.min(nyquist, fx.highpass) : 10;
      lp.frequency.value = fx.lowpass > 0 ? Math.min(nyquist, fx.lowpass) : nyquist;
      low.gain.value = fx.low;
      mid.gain.value = fx.mid;
      high.gain.value = fx.high;
      const c = Math.max(0, Math.min(1, fx.compressor));
      comp.threshold.value = -6 - 30 * c;
      comp.ratio.value = 1 + 11 * c;
      comp.knee.value = 12;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      // Roughly restore the level the compressor takes away.
      makeup.gain.value = c > 0 ? Math.pow(10, (12 * c) / 20) : 1;
      delay.delayTime.value = Math.max(0.05, Math.min(1.2, fx.echoTime || 0.3));
      feedback.gain.value = fx.echo > 0 ? 0.35 : 0;
      echoWet.gain.value = Math.max(0, Math.min(1, fx.echo)) * 0.8;
      if (fx.reverb > 0 && !conv) {
        conv = ctx.createConvolver();
        conv.buffer = impulse(ctx);
        makeup.connect(conv);
        conv.connect(revWet);
      }
      revWet.gain.value = Math.max(0, Math.min(1, fx.reverb)) * 1.2;
    },
    disconnect() {
      for (const n of [hp, low, mid, high, lp, comp, makeup, delay, feedback, echoWet, revWet, out, conv]) n?.disconnect();
    },
  };
}

/** Validate untrusted effect data (project files, presets). */
export function cleanAudioFx(v: unknown): AudioFx | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const n = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  const fx: AudioFx = {
    low: n(o.low, -18, 18, 0),
    mid: n(o.mid, -18, 18, 0),
    high: n(o.high, -18, 18, 0),
    highpass: n(o.highpass, 0, 2000, 0),
    lowpass: n(o.lowpass, 0, 20000, 0),
    compressor: n(o.compressor, 0, 1, 0),
    echo: n(o.echo, 0, 1, 0),
    echoTime: n(o.echoTime, 0.05, 1.2, 0.3),
    reverb: n(o.reverb, 0, 1, 0),
  };
  if (typeof o.preset === 'string' && AUDIO_PRESETS.some((p) => p.id === o.preset)) fx.preset = o.preset;
  return fxActive(fx) ? fx : undefined;
}
