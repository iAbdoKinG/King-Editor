/**
 * Audio waveform peaks, computed in the background after import.
 *
 * Audio is decoded in a stream (WebCodecs via mediabunny) and reduced to
 * peak values right away, so the decoded audio is never kept in memory. Work
 * is chunked with yields to keep the UI responsive, and only one file is
 * processed at a time.
 */
import { create } from 'zustand';
import type { MediaAsset } from '../../types/project';
import { dataSize, makeSource, readAll, type AssetData } from './assetSource';

export const PEAKS_PER_SEC = 60;
/** Peak level below which audio is considered silent (≈ −34 dBFS). */
export const SILENCE_LEVEL = 0.02;
/** Minimum silent stretch (seconds) worth highlighting. */
export const SILENCE_MIN = 0.35;

export interface Waveform {
  status: 'pending' | 'ready' | 'none' | 'unavailable';
  peaks?: Float32Array;
}

interface WaveState {
  waves: Record<string, Waveform>;
}

export const useWaveformStore = create<WaveState>(() => ({ waves: {} }));

const setWave = (id: string, w: Waveform) =>
  useWaveformStore.setState((s) => ({ waves: { ...s.waves, [id]: w } }));

let queue: Promise<void> = Promise.resolve();
const cancelled = new Set<string>();

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

async function computeStreaming(file: AssetData, duration: number, id: string): Promise<Float32Array | 'none' | null> {
  const { ALL_FORMATS, AudioBufferSink, Input } = await import('mediabunny');
  const input = new Input({ source: await makeSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return 'none';
    if (!(await track.canDecode())) return null;
    const peaks = new Float32Array(Math.max(1, Math.ceil(duration * PEAKS_PER_SEC)));
    let n = 0;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      if (cancelled.has(id)) return null;
      const sr = buffer.sampleRate;
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      const len = buffer.length;
      const step = Math.max(1, Math.floor(sr / 4000)); // ~4 kHz sampling of the envelope is plenty
      for (let i = 0; i < len; i += step) {
        let v = 0;
        for (const ch of chans) {
          const a = Math.abs(ch[i]);
          if (a > v) v = a;
        }
        const b = Math.floor((timestamp + i / sr) * PEAKS_PER_SEC);
        if (b >= 0 && b < peaks.length && v > peaks[b]) peaks[b] = v;
      }
      if (++n % 8 === 0) await yieldToUI();
    }
    return peaks;
  } finally {
    input.dispose();
  }
}

async function computeFallback(file: AssetData, duration: number, size: number): Promise<Float32Array | null> {
  // Whole-file decode: only for reasonably small files to protect memory.
  if (dataSize(file, size) > 120 * 1024 * 1024) return null;
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx(1, 1, 22050);
  const buf = await ctx.decodeAudioData(await readAll(file));
  const peaks = new Float32Array(Math.max(1, Math.ceil(duration * PEAKS_PER_SEC)));
  const per = buf.sampleRate / PEAKS_PER_SEC;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i += 4) {
      const b = Math.floor(i / per);
      const a = Math.abs(d[i]);
      if (b < peaks.length && a > peaks[b]) peaks[b] = a;
    }
  }
  return peaks;
}

/** Queue waveform analysis for an asset (no-op for images). */
export function requestWaveform(asset: MediaAsset, file: AssetData): void {
  if (asset.kind === 'image' || useWaveformStore.getState().waves[asset.id]) return;
  setWave(asset.id, { status: 'pending' });
  queue = queue.then(async () => {
    if (cancelled.has(asset.id)) return;
    let result: Float32Array | 'none' | null = null;
    try {
      result = await computeStreaming(file, asset.duration, asset.id);
    } catch {
      result = null;
    }
    if (result === null && !cancelled.has(asset.id)) {
      try {
        result = await computeFallback(file, asset.duration, asset.size);
      } catch {
        // Video files often have no decodable audio via Web Audio.
        result = asset.kind === 'video' ? 'none' : null;
      }
    }
    if (cancelled.has(asset.id)) return;
    if (result === 'none') setWave(asset.id, { status: 'none' });
    else if (result) setWave(asset.id, { status: 'ready', peaks: result });
    else setWave(asset.id, { status: 'unavailable' });
  });
}

export function releaseWaveform(assetId: string): void {
  cancelled.add(assetId);
  useWaveformStore.setState((s) => {
    const waves = { ...s.waves };
    delete waves[assetId];
    return { waves };
  });
}

/** Silent regions [from, to] in source seconds. */
export function silentRegions(peaks: Float32Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= peaks.length; i++) {
    const quiet = i < peaks.length && peaks[i] < SILENCE_LEVEL;
    if (quiet && start < 0) start = i;
    else if (!quiet && start >= 0) {
      if ((i - start) / PEAKS_PER_SEC >= SILENCE_MIN) out.push([start / PEAKS_PER_SEC, i / PEAKS_PER_SEC]);
      start = -1;
    }
  }
  return out;
}
