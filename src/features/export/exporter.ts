/**
 * Offline, frame-accurate export.
 *
 * Video: every output frame is rendered with the same compositor as the
 * preview. Source video frames are decoded in order with WebCodecs (through
 * mediabunny). If a source cannot be decoded that way, a seeking <video>
 * element is used instead.
 * Audio: the mix is rendered in an OfflineAudioContext, using the same
 * gain/fade/transition functions as playback.
 * Encoding: WebCodecs encoder → MP4 (H.264/HEVC + AAC/Opus) or WebM (VP9/VP8 + Opus).
 *
 * Nothing leaves the device.
 */
import { t as T } from '../../i18n';
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import type { Clip, MediaAsset, MediaClip, Project } from '../../types/project';
import { fadeEnvelope } from '../../engine/audio/audioGraph';
import { imageFrame, renderFrame, visibleLayersAt, type Frame, type FrameSource } from '../../engine/rendering/compositor';
import { imageCache } from '../../engine/rendering/imageCache';
import { frameSize, projectDuration, trackGain } from '../../engine/timeline/model';
import { clipRange, trackLayersAt } from '../../engine/timeline/transitions';
import { getAssetData, makeSource, readAll } from '../media/assetSource';
import { clamp } from '../../utils/time';

export interface ExportSettings {
  height: 720 | 1080 | 2160;
  fps: 24 | 25 | 30 | 60;
}

export interface ExportPlan {
  width: number;
  height: number;
  fps: number;
  container: 'mp4' | 'webm';
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  duration: number;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mime: string;
  duration: number;
  width: number;
  height: number;
  /** Whether this browser can play the file back (it is valid either way). */
  playableHere: boolean;
}

export type ExportPhase = 'preparing' | 'audio' | 'video' | 'finalizing' | 'verifying';

const SAMPLE_RATE = 48000;

function hasAudibleAudio(project: Project, assets: Record<string, MediaAsset>): boolean {
  return Object.values(project.clips).some((c) => {
    if (c.type !== 'media' || c.audio.volume <= 0) return false;
    const a = assets[c.assetId];
    const tr = project.tracks.find((t) => t.id === c.trackId);
    return !!a && trackGain(project, tr) > 0 && (a.kind === 'audio' || a.kind === 'video');
  });
}

/** Choose the most compatible container/codec combination this browser can actually encode. */
export async function planExport(
  project: Project,
  assets: Record<string, MediaAsset>,
  settings: ExportSettings,
): Promise<ExportPlan | { error: string }> {
  const duration = projectDuration(project);
  if (duration <= 0) return { error: T('The timeline is empty.') };
  if (typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'function')
    return { error: T('This browser has no video encoder (WebCodecs). Use Safari on iPadOS 16.4 or newer, or a current Chrome/Edge.') };
  const { width, height } = frameSize({ aspect: project.settings.aspect, resolution: settings.height });
  const needAudio = hasAudibleAudio(project, assets);
  const candidates: Array<{ container: 'mp4' | 'webm'; video: VideoCodec; audio: AudioCodec[] }> = [
    { container: 'mp4', video: 'avc', audio: ['aac', 'opus'] },
    { container: 'mp4', video: 'hevc', audio: ['aac', 'opus'] },
    { container: 'webm', video: 'vp9', audio: ['opus'] },
    { container: 'webm', video: 'vp8', audio: ['opus'] },
  ];
  for (const c of candidates) {
    const okVideo = await canEncodeVideo(c.video, { width, height, frameRate: settings.fps, bitrate: QUALITY_HIGH }).catch(() => false);
    if (!okVideo) continue;
    let audioCodec: AudioCodec | null = null;
    if (needAudio) {
      for (const a of c.audio) {
        if (await canEncodeAudio(a, { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: QUALITY_HIGH }).catch(() => false)) {
          audioCodec = a;
          break;
        }
      }
      if (!audioCodec) continue;
    }
    return { width, height, fps: settings.fps, container: c.container, videoCodec: c.video, audioCodec, duration };
  }
  return { error: T('This browser cannot encode {w}×{h} video{audio}. Try 720p.', { w: width, h: height, audio: needAudio ? T(' with audio') : '' }) };
}

/* ----------------------------- video frames ----------------------------- */

interface DecoderEntry {
  kind: 'decoder';
  input: Input;
  iter: AsyncGenerator<VideoSample | null, void, unknown>;
  sample: VideoSample | null;
}
interface ElementEntry {
  kind: 'element';
  el: HTMLVideoElement;
}

function waitEvent(el: EventTarget, name: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      el.removeEventListener(name, on);
      reject(new Error(`timeout waiting for ${name}`));
    }, ms);
    const on = () => {
      clearTimeout(t);
      resolve();
    };
    el.addEventListener(name, on, { once: true });
  });
}

/** Provides exact source frames for each output frame, decoding sequentially. */
class ExportFrames implements FrameSource {
  private entries = new Map<string, DecoderEntry | ElementEntry>();
  /** For each clip: the source timestamps it needs, in output-frame order. */
  private plan = new Map<string, { timestamps: number[]; lastFrame: number }>();

  constructor(
    private project: Project,
    private assets: Record<string, MediaAsset>,
    private fps: number,
    frames: number,
  ) {
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      for (const { clip } of visibleLayersAt(project, assets, t)) {
        if (clip.type !== 'media' || assets[clip.assetId]?.kind !== 'video') continue;
        const ts = this.sourceTime(clip, t);
        const p = this.plan.get(clip.id);
        if (p) {
          p.timestamps.push(ts);
          p.lastFrame = i;
        } else this.plan.set(clip.id, { timestamps: [ts], lastFrame: i });
      }
    }
  }

  private sourceTime(clip: MediaClip, t: number): number {
    const a = this.assets[clip.assetId];
    // Sample at the middle of the frame interval to avoid landing on the previous frame.
    return clamp(clip.in + (t - clip.start) * clip.speed, 0, Math.max(0, a.duration - 0.5 / this.fps));
  }

  private async open(clip: MediaClip): Promise<DecoderEntry | ElementEntry> {
    const asset = this.assets[clip.assetId];
    const data = getAssetData(asset.id);
    const plan = this.plan.get(clip.id)!;
    if (data) {
      try {
        const input = new Input({ source: await makeSource(data), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (track && (await track.canDecode())) {
          const sink = new VideoSampleSink(track);
          return { kind: 'decoder', input, iter: sink.samplesAtTimestamps(plan.timestamps), sample: null };
        }
        input.dispose();
      } catch {
        /* fall back to element seeking */
      }
    }
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = asset.url;
    await waitEvent(el, 'loadeddata', 15000);
    return { kind: 'element', el };
  }

  /** Advance every clip visible in frame `i` to its next source frame. */
  async prepare(i: number, t: number): Promise<void> {
    for (const { clip } of visibleLayersAt(this.project, this.assets, t)) {
      if (clip.type !== 'media' || this.assets[clip.assetId]?.kind !== 'video') continue;
      let e = this.entries.get(clip.id);
      if (!e) {
        e = await this.open(clip);
        this.entries.set(clip.id, e);
      }
      if (e.kind === 'decoder') {
        const r = await e.iter.next();
        const next = r.done ? null : r.value;
        if (next !== e.sample) {
          e.sample?.close();
          e.sample = next;
        }
      } else {
        const target = this.sourceTime(clip, t);
        if (Math.abs(e.el.currentTime - target) > 1e-3) {
          e.el.currentTime = target;
          await waitEvent(e.el, 'seeked', 10000);
        }
      }
    }
    // Free decoders for clips that are finished.
    for (const [id, e] of this.entries) {
      if ((this.plan.get(id)?.lastFrame ?? -1) < i) this.closeEntry(id, e);
    }
  }

  getFrame(clipId: string): Frame | null {
    const e = this.entries.get(clipId);
    if (!e) return null;
    if (e.kind === 'element') return e.el.videoWidth ? imageFrame(e.el, e.el.videoWidth, e.el.videoHeight) : null;
    const s = e.sample;
    if (!s) return null;
    return {
      w: s.displayWidth,
      h: s.displayHeight,
      draw: (ctx, sx, sy, sw, sh, dx, dy, dw, dh) => s.draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh),
    };
  }

  private closeEntry(id: string, e: DecoderEntry | ElementEntry): void {
    if (e.kind === 'decoder') {
      e.sample?.close();
      void e.iter.return(undefined);
      e.input.dispose();
    } else {
      e.el.removeAttribute('src');
      e.el.load();
    }
    this.entries.delete(id);
  }

  dispose(): void {
    for (const [id, e] of [...this.entries]) this.closeEntry(id, e);
  }
}

/* ----------------------------- audio mix ----------------------------- */

async function decodeRange(asset: MediaAsset, from: number, to: number, ctx: BaseAudioContext): Promise<{ buffer: AudioBuffer; start: number } | null> {
  const data = getAssetData(asset.id);
  if (!data) return null;
  // Preferred: decode only the needed range with WebCodecs.
  try {
    const input = new Input({ source: await makeSource(data), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null; // video without audio
      if (await track.canDecode()) {
        const parts: Array<{ buffer: AudioBuffer; timestamp: number }> = [];
        for await (const w of new AudioBufferSink(track).buffers(from, to)) parts.push(w);
        if (!parts.length) return null;
        const ch = parts[0].buffer.numberOfChannels;
        const sr = parts[0].buffer.sampleRate;
        const len = parts.reduce((n, p) => n + p.buffer.length, 0);
        const out = ctx.createBuffer(ch, len, sr);
        let off = 0;
        for (const p of parts) {
          for (let c = 0; c < ch; c++) out.copyToChannel(p.buffer.getChannelData(Math.min(c, p.buffer.numberOfChannels - 1)), c, off);
          off += p.buffer.length;
        }
        return { buffer: out, start: parts[0].timestamp };
      }
    } finally {
      input.dispose();
    }
  } catch {
    /* fall through */
  }
  // Fallback: let Web Audio decode the whole file.
  try {
    const buffer = await ctx.decodeAudioData(await readAll(data));
    return { buffer, start: 0 };
  } catch {
    return null;
  }
}

async function renderAudio(project: Project, assets: Record<string, MediaAsset>, duration: number, signal: AbortSignal): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: SAMPLE_RATE });
  const { width: W, height: H } = frameSize(project.settings);
  for (const c of Object.values(project.clips) as Clip[]) {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (c.type !== 'media' || c.audio.volume <= 0) continue;
    const asset = assets[c.assetId];
    const track = project.tracks.find((t) => t.id === c.trackId);
    const tGain = trackGain(project, track);
    if (!asset || tGain <= 0 || (asset.kind !== 'audio' && asset.kind !== 'video')) continue;
    const [s0, e0] = clipRange(project, c);
    let s = Math.max(0, s0);
    const e = Math.min(duration, e0);
    let srcA = c.in + (s - c.start) * c.speed;
    if (srcA < 0) {
      s += -srcA / c.speed;
      srcA = 0;
    }
    const srcB = Math.min(asset.duration, c.in + (e - c.start) * c.speed);
    if (e - s <= 0.001 || srcB - srcA <= 0.001) continue;
    const dec = await decodeRange(asset, srcA, srcB, ctx);
    if (!dec) continue;

    const src = ctx.createBufferSource();
    src.buffer = dec.buffer;
    src.playbackRate.value = c.speed;
    const gain = ctx.createGain();
    // Sample the exact same gain function used during playback.
    const steps = Math.max(2, Math.ceil((e - s) * 200));
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const t = s + ((e - s) * i) / (steps - 1);
      const mix = trackLayersAt(project, c.trackId, Math.min(t, e - 1e-6), W, H).find((l) => l.clip.id === c.id)?.mix;
      const lt = clamp(t - c.start, 0, c.duration);
      curve[i] = tGain * c.audio.volume * (mix?.audio ?? 0) * fadeEnvelope(lt, c.duration, c.audio.fadeIn, c.audio.fadeOut);
    }
    gain.gain.setValueCurveAtTime(curve, s, e - s);
    let last: AudioNode = src.connect(gain);
    if (c.audio.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = c.audio.pan;
      last = last.connect(pan);
    }
    last.connect(ctx.destination);
    src.start(s, Math.max(0, srcA - dec.start), srcB - srcA);
  }
  return ctx.startRendering();
}

/* ----------------------------- run ----------------------------- */

export async function runExport(
  project: Project,
  assets: Record<string, MediaAsset>,
  plan: ExportPlan,
  onProgress: (fraction: number, phase: ExportPhase) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const aborted = () => {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  onProgress(0, 'preparing');
  // Everything drawn must be ready: fonts and still images.
  const { ensureFont } = await import('../fonts/fonts');
  await Promise.all(Object.values(project.clips).map((c) => (c.type === 'text' ? ensureFont(c.style.fontFamily) : null)));
  await document.fonts?.ready;
  for (const c of Object.values(project.clips)) {
    if (c.type === 'media' && assets[c.assetId]?.kind === 'image') await imageCache.ensure(assets[c.assetId]);
  }

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!;

  const output = new Output({
    format: plan.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, { codec: plan.videoCodec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: plan.fps });
  let audioSource: AudioBufferSource | null = null;
  if (plan.audioCodec) {
    audioSource = new AudioBufferSource({ codec: plan.audioCodec, bitrate: QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }

  const totalFrames = Math.max(1, Math.round(plan.duration * plan.fps));
  const frames = new ExportFrames(project, assets, plan.fps, totalFrames);
  const onAbort = () => void output.cancel().catch(() => undefined);
  signal.addEventListener('abort', onAbort);

  try {
    await output.start();

    if (audioSource) {
      onProgress(0.02, 'audio');
      const mix = await renderAudio(project, assets, plan.duration, signal);
      aborted();
      await audioSource.add(mix);
    }

    for (let i = 0; i < totalFrames; i++) {
      aborted();
      const t = i / plan.fps;
      await frames.prepare(i, t);
      renderFrame(ctx, { project, assets, t, source: frames });
      await videoSource.add(t, 1 / plan.fps);
      if (i % 3 === 0) onProgress(0.08 + 0.88 * (i / totalFrames), 'video');
    }

    aborted();
    onProgress(0.97, 'finalizing');
    await output.finalize();
  } catch (err) {
    if (output.state !== 'canceled') await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    frames.dispose();
    signal.removeEventListener('abort', onAbort);
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf || buf.byteLength === 0) throw new Error(T('The encoder produced an empty file.'));
  const mime = plan.container === 'mp4' ? 'video/mp4' : 'video/webm';
  const blob = new Blob([buf], { type: mime });

  // Verify: parse the produced file and check its tracks and duration.
  onProgress(0.99, 'verifying');
  const check = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  let verifiedDuration = 0;
  try {
    const vt = await check.getPrimaryVideoTrack();
    if (!vt) throw new Error(T('The exported file has no video track.'));
    if (plan.audioCodec && !(await check.getPrimaryAudioTrack())) throw new Error(T('The exported file is missing its audio track.'));
    verifiedDuration = await check.computeDuration();
    if (!(verifiedDuration > plan.duration * 0.9)) throw new Error(T('The exported file is too short ({d} s).', { d: verifiedDuration.toFixed(2) }));
  } finally {
    check.dispose();
  }
  const probe = document.createElement('video');
  const playableHere = probe.canPlayType(mime) !== '';

  const safe = (project.settings.name || 'King Editor').replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'King Editor';
  onProgress(1, 'verifying');
  return {
    blob,
    filename: `${safe} ${plan.height}p.${plan.container}`,
    mime,
    duration: verifiedDuration,
    width: plan.width,
    height: plan.height,
    playableHere,
  };
}
