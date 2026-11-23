import { memo, useEffect, useRef } from 'react';
import { PEAKS_PER_SEC, SILENCE_LEVEL, SILENCE_MIN, useWaveformStore } from '../media/waveform';

interface Props {
  assetId: string;
  /** Source in-point and speed of the clip. */
  srcIn: number;
  speed: number;
  duration: number;
  width: number;
  height: number;
  gain: number;
  /** Draw mirrored around the centre (audio clips) or from the bottom (strip under video). */
  mode: 'center' | 'bottom';
}

const MAX_CANVAS = 4096;

/**
 * Waveform for the visible clip range. Quiet stretches are tinted so pauses
 * are easy to spot. Canvas width is capped and stretched by CSS at extreme zoom.
 */
export const WaveformView = memo(function WaveformView({ assetId, srcIn, speed, duration, width, height, gain, mode }: Props) {
  const wave = useWaveformStore((s) => s.waves[assetId]);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const peaks = wave?.peaks;
    if (!c || !peaks || width < 2 || height < 2) return;
    const cw = Math.max(1, Math.min(MAX_CANVAS, Math.round(width)));
    const ch = Math.max(1, Math.round(height));
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    // CPU-backed canvas: avoids one GPU compositing layer per clip (hundreds on long timelines).
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    const secPerPx = (duration * speed) / cw;
    const g = Math.min(2, Math.max(0.15, gain));
    // Silent stretches
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    let runStart = -1;
    const minRun = SILENCE_MIN / secPerPx;
    const levels = new Float32Array(cw);
    for (let x = 0; x < cw; x++) {
      const s0 = srcIn + x * secPerPx;
      const b0 = Math.floor(s0 * PEAKS_PER_SEC);
      const b1 = Math.max(b0 + 1, Math.floor((s0 + secPerPx) * PEAKS_PER_SEC));
      let v = 0;
      for (let b = b0; b < b1 && b < peaks.length; b++) if (b >= 0 && peaks[b] > v) v = peaks[b];
      levels[x] = v;
    }
    for (let x = 0; x <= cw; x++) {
      const quiet = x < cw && levels[x] < SILENCE_LEVEL;
      if (quiet && runStart < 0) runStart = x;
      else if (!quiet && runStart >= 0) {
        if (x - runStart >= minRun) ctx.fillRect(runStart, 0, x - runStart, ch);
        runStart = -1;
      }
    }
    // Waveform bars (sqrt scale makes quiet speech visible)
    ctx.fillStyle = 'rgba(242,244,245,0.78)';
    for (let x = 0; x < cw; x++) {
      const v = Math.min(1, Math.sqrt(levels[x]) * g);
      if (mode === 'center') {
        const h = Math.max(1, v * (ch - 2));
        ctx.fillRect(x, (ch - h) / 2, 1, h);
      } else {
        const h = Math.max(1, v * (ch - 1));
        ctx.fillRect(x, ch - h, 1, h);
      }
    }
  }, [wave, srcIn, speed, duration, width, height, gain, mode]);

  if (!wave || wave.status === 'none' || wave.status === 'unavailable') return null;
  if (wave.status === 'pending')
    return <div className="absolute inset-x-0 bottom-0 animate-pulse bg-white/5" style={{ height }} aria-hidden="true" />;
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute left-0 bottom-0"
      style={{ width, height, background: mode === 'bottom' ? 'rgba(0,0,0,0.34)' : undefined }}
      data-testid="waveform"
    />
  );
});
