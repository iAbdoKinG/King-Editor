/**
 * Web Audio routing. Media elements are connected through per-element
 * gain/pan nodes into a single master bus. The AudioContext can only start
 * after a user gesture on iOS Safari, so `unlock()` must be called from a
 * gesture handler.
 */
import type { AudioFx } from '../../types/project';
import { createFxChain, fxActive, type FxChain } from './audioFx';

type Ctor = typeof AudioContext;

export interface ChannelNodes {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  /** Effects chain, created the first time an effect is used on this element. */
  fx?: FxChain;
  fxOn?: boolean;
  fxRef?: AudioFx;
}

class AudioGraph {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  readonly supported: boolean;
  private channels = new WeakMap<HTMLMediaElement, ChannelNodes>();

  constructor() {
    this.supported =
      typeof window !== 'undefined' &&
      !!((window as unknown as { AudioContext?: Ctor }).AudioContext ||
        (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);
  }

  /** Create/resume the context. Must run inside a user gesture on iOS. */
  unlock(): void {
    if (!this.supported) return;
    if (!this.ctx) {
      const C: Ctor =
        (window as unknown as { AudioContext?: Ctor }).AudioContext ||
        (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
      try {
        this.ctx = new C({ latencyHint: 'playback' });
      } catch {
        this.ctx = new C();
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // Play one silent buffer: the documented way to fully unlock iOS audio output.
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.ctx.state === 'suspended' || (this.ctx.state as string) === 'interrupted') {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  get ready(): boolean {
    return !!this.ctx && !!this.master;
  }

  /** Route an element through the graph (once per element lifetime). */
  attach(el: HTMLMediaElement): ChannelNodes | null {
    if (!this.ctx || !this.master) return null;
    const existing = this.channels.get(el);
    if (existing) return existing;
    try {
      const source = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      let pan: StereoPannerNode | null = null;
      if (typeof this.ctx.createStereoPanner === 'function') {
        pan = this.ctx.createStereoPanner();
        source.connect(gain).connect(pan).connect(this.master);
      } else {
        source.connect(gain).connect(this.master);
      }
      const nodes = { source, gain, pan };
      this.channels.set(el, nodes);
      return nodes;
    } catch {
      return null;
    }
  }

  channel(el: HTMLMediaElement): ChannelNodes | undefined {
    return this.channels.get(el);
  }

  setGain(nodes: ChannelNodes, value: number, pan: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = nodes.gain.gain;
    if (Math.abs(g.value - value) > 1e-3) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(value, t, 0.012);
    }
    if (nodes.pan && Math.abs(nodes.pan.pan.value - pan) > 1e-3) nodes.pan.pan.setTargetAtTime(pan, t, 0.012);
  }

  /** Route the channel through its effects chain (gain → fx → pan) or bypass it. */
  setFx(nodes: ChannelNodes, fx: AudioFx | undefined): void {
    if (!this.ctx || !this.master) return;
    const after: AudioNode = nodes.pan ?? this.master;
    const on = fxActive(fx);
    if (on && !nodes.fx) {
      nodes.fx = createFxChain(this.ctx);
    }
    if (on !== !!nodes.fxOn) {
      nodes.gain.disconnect();
      if (on) {
        nodes.gain.connect(nodes.fx!.input);
        nodes.fx!.output.connect(after);
      } else {
        nodes.fx?.output.disconnect();
        nodes.gain.connect(after);
      }
      nodes.fxOn = on;
    }
    if (on && nodes.fxRef !== fx) nodes.fx!.update(fx);
    nodes.fxRef = on ? fx : undefined;
  }

  /** Optional tap for export: a MediaStream of the master bus. */
  createStreamDestination(): MediaStreamAudioDestinationNode | null {
    if (!this.ctx || !this.master) return null;
    const dest = this.ctx.createMediaStreamDestination();
    this.master.connect(dest);
    return dest;
  }
}

export const audioGraph = new AudioGraph();

/** Gain envelope for a clip at local time `lt` (seconds since clip start). */
export function fadeEnvelope(lt: number, duration: number, fadeIn: number, fadeOut: number): number {
  let g = 1;
  if (fadeIn > 0 && lt < fadeIn) g = Math.min(g, Math.max(0, lt / fadeIn));
  const rem = duration - lt;
  if (fadeOut > 0 && rem < fadeOut) g = Math.min(g, Math.max(0, rem / fadeOut));
  return g;
}
