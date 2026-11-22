/**
 * A bounded pool of reusable <video>/<audio> elements.
 *
 * - Elements are only given a source when their clip is near the playhead, so
 *   invisible media is not decoded.
 * - The pool size caps concurrent decoders (important on iPhone).
 * - All elements are "blessed" once inside the first user gesture, which is
 *   what iOS Safari requires before un-muted media may start from script.
 * - Every element follows the master clock; drift is corrected by seeking.
 */
import type { MediaAsset, MediaClip, Project } from '../../types/project';
import { audioGraph, fadeEnvelope } from '../audio/audioGraph';
import { clamp } from '../../utils/time';
import { imageFrame, type Frame } from '../rendering/compositor';
import { frameSize } from '../timeline/model';
import { allMixesAt, clipRange } from '../timeline/transitions';

type Kind = 'video' | 'audio';

interface Slot {
  kind: Kind;
  el: HTMLVideoElement | HTMLAudioElement;
  clipId: string | null;
  url: string | null;
  seeking: boolean;
  pendingSeek: number | null;
  playPending: boolean;
  lastUsed: number;
}

const POOL_SIZE: Record<Kind, number> = { video: 6, audio: 6 };
/** Seconds before a clip starts when its element is prepared. */
const PRELOAD = 1.5;
/** Drift (seconds) after which a playing element is re-seeked. */
const MAX_DRIFT = 0.2;
const MAX_HOLD_MS = 2500;

export interface SyncResult {
  /** True while an active element is still buffering during playback. */
  stalled: boolean;
}

export class MediaPool {
  private slots: Slot[] = [];
  private byClip = new Map<string, Slot>();
  private container: HTMLDivElement;
  private blessed = false;
  private stallSince = 0;
  /** Called whenever a new frame becomes available while paused. */
  onFrame: () => void = () => undefined;
  /** Called when a play() attempt was blocked by the browser. */
  onBlocked: () => void = () => undefined;

  constructor() {
    this.container = document.createElement('div');
    this.container.setAttribute('aria-hidden', 'true');
    // Keep elements in the DOM (some iOS versions will not decode detached video).
    Object.assign(this.container.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      overflow: 'hidden',
      opacity: '0.01',
      pointerEvents: 'none',
      zIndex: '-1',
    });
    document.body.appendChild(this.container);
    (['video', 'audio'] as Kind[]).forEach((kind) => {
      for (let i = 0; i < POOL_SIZE[kind]; i++) this.slots.push(this.createSlot(kind));
    });
  }

  private createSlot(kind: Kind): Slot {
    const el = document.createElement(kind);
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.muted = true;
    if (el instanceof HTMLVideoElement) {
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.width = 2;
      el.height = 2;
    }
    const slot: Slot = { kind, el, clipId: null, url: null, seeking: false, pendingSeek: null, playPending: false, lastUsed: 0 };
    el.addEventListener('seeked', () => {
      slot.seeking = false;
      if (slot.pendingSeek !== null) {
        const t = slot.pendingSeek;
        slot.pendingSeek = null;
        this.seekSlot(slot, t);
      }
      this.onFrame();
    });
    el.addEventListener('loadeddata', () => this.onFrame());
    el.addEventListener('canplay', () => this.onFrame());
    this.container.appendChild(el);
    return slot;
  }

  /** Must be called synchronously inside a user gesture handler. */
  bless(): void {
    audioGraph.unlock();
    if (this.blessed) return;
    this.blessed = true;
    for (const s of this.slots) {
      if (s.url) continue;
      try {
        s.el.load();
        const p = s.el.play();
        if (p) p.catch(() => undefined);
        s.el.pause();
      } catch {
        /* ignore */
      }
    }
  }

  get isBlessed(): boolean {
    return this.blessed;
  }

  getElement(clipId: string): HTMLVideoElement | HTMLAudioElement | null {
    return this.byClip.get(clipId)?.el ?? null;
  }

  getFrame(clipId: string): Frame | null {
    const el = this.byClip.get(clipId)?.el;
    if (!(el instanceof HTMLVideoElement) || el.readyState < 2 || !el.videoWidth) return null;
    return imageFrame(el, el.videoWidth, el.videoHeight);
  }

  private seekSlot(slot: Slot, t: number): void {
    if (slot.seeking) {
      slot.pendingSeek = t;
      return;
    }
    slot.seeking = true;
    try {
      slot.el.currentTime = t;
    } catch {
      slot.seeking = false;
    }
    // Some browsers do not fire 'seeked' if the time did not change.
    if (Math.abs(slot.el.currentTime - t) < 1e-4 && !slot.el.seeking) slot.seeking = false;
  }

  private release(slot: Slot): void {
    if (slot.clipId) this.byClip.delete(slot.clipId);
    slot.clipId = null;
    const ch = audioGraph.channel(slot.el);
    if (ch) ch.gain.gain.value = 0;
    if (slot.url) {
      slot.el.pause();
      slot.el.removeAttribute('src');
      slot.el.load(); // frees the decoder
    }
    slot.url = null;
    slot.seeking = false;
    slot.pendingSeek = null;
    slot.playPending = false;
  }

  private assign(slot: Slot, clip: MediaClip, asset: MediaAsset): void {
    if (slot.clipId) this.byClip.delete(slot.clipId);
    slot.clipId = clip.id;
    this.byClip.set(clip.id, slot);
    if (slot.url !== asset.url) {
      slot.url = asset.url;
      slot.seeking = false;
      slot.pendingSeek = null;
      slot.el.src = asset.url;
      slot.el.currentTime = clip.in;
    }
  }

  /** Release every element (e.g. on page hide or memory pressure). */
  releaseAll(): void {
    for (const s of this.slots) this.release(s);
  }

  releaseAsset(url: string): void {
    for (const s of this.slots) if (s.url === url) this.release(s);
  }

  /** Align every element with the master clock at time `t`. */
  sync(project: Project, assets: Record<string, MediaAsset>, t: number, playing: boolean): SyncResult {
    const now = performance.now();
    const trackById = new Map(project.tracks.map((tr) => [tr.id, tr]));
    // 1. Decide which clips need an element, nearest first.
    const wanted: Array<{ clip: MediaClip; asset: MediaAsset; dist: number; range: [number, number] }> = [];
    const pre = playing ? PRELOAD : 0.25;
    for (const id in project.clips) {
      const c = project.clips[id];
      if (c.type !== 'media') continue;
      const a = assets[c.assetId];
      if (!a || a.status !== 'ready' || a.kind === 'image') continue;
      const range = clipRange(project, c);
      if (t < range[0] - pre || t >= range[1] + 0.05) continue;
      wanted.push({ clip: c, asset: a, dist: Math.max(0, range[0] - t), range });
    }
    wanted.sort((x, y) => x.dist - y.dist);
    const wantedIds = new Set(wanted.map((w) => w.clip.id));

    // 2. Release slots no longer needed.
    for (const s of this.slots) if (s.clipId && !wantedIds.has(s.clipId)) this.release(s);

    // 3. Assign free slots.
    for (const w of wanted) {
      const kind: Kind = w.asset.kind === 'audio' ? 'audio' : 'video';
      let slot = this.byClip.get(w.clip.id);
      if (slot && slot.url !== w.asset.url) this.assign(slot, w.clip, w.asset);
      if (slot) continue;
      // Prefer a free slot already holding this source (avoids reloading after a split).
      slot =
        this.slots.find((s) => s.kind === kind && !s.clipId && s.url === w.asset.url) ??
        this.slots.find((s) => s.kind === kind && !s.clipId);
      if (!slot) continue; // pool exhausted; nearest clips win
      this.assign(slot, w.clip, w.asset);
    }

    // 4. Drive each element from the clock.
    let stalled = false;
    const graph = audioGraph.ready;
    const { width: W, height: H } = frameSize(project.settings);
    const mixes = allMixesAt(project, t, W, H);
    for (const w of wanted) {
      const slot = this.byClip.get(w.clip.id);
      if (!slot) continue;
      slot.lastUsed = now;
      const { clip, asset } = w;
      const el = slot.el;
      const track = trackById.get(clip.trackId);
      const active = t >= w.range[0] && t < w.range[1];
      const srcDur = isFinite(el.duration) && el.duration > 0 ? el.duration : asset.duration;
      const local = active ? t - clip.start : w.range[0] - clip.start;
      const desired = clamp(clip.in + local * clip.speed, 0, Math.max(0, srcDur - 0.02));

      if (playing && active) {
        if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
        if (el.paused) {
          if (!slot.playPending) {
            if (Math.abs(el.currentTime - desired) > 0.05 && !slot.seeking) this.seekSlot(slot, desired);
            slot.playPending = true;
            const p = el.play();
            if (p)
              p.then(
                () => (slot.playPending = false),
                () => {
                  slot.playPending = false;
                  this.onBlocked();
                },
              );
            else slot.playPending = false;
          }
        } else if (!slot.seeking && !el.seeking && Math.abs(el.currentTime - desired) > MAX_DRIFT * clip.speed) {
          this.seekSlot(slot, desired);
        }
        if (el.readyState < 3 || slot.seeking) stalled = true;
      } else {
        if (!el.paused) el.pause();
        // While seeking, currentTime already reports the requested target.
        const target = slot.pendingSeek ?? el.currentTime;
        if (Math.abs(target - desired) > 0.5 / project.settings.fps) this.seekSlot(slot, desired);
      }

      // Audio level for this element.
      const mix = mixes.get(clip.id);
      const silent = !mix || !playing || !track || track.muted;
      const lt = t - clip.start;
      const level = silent
        ? 0
        : clip.audio.volume * mix.audio * fadeEnvelope(clamp(lt, 0, clip.duration), clip.duration, clip.audio.fadeIn, clip.audio.fadeOut);
      if (graph) {
        const nodes = audioGraph.attach(el);
        if (nodes) {
          if (el.muted) el.muted = false;
          audioGraph.setGain(nodes, level, clip.audio.pan);
        } else {
          el.muted = level === 0;
        }
      } else {
        el.muted = level === 0;
        try {
          el.volume = clamp(level, 0, 1);
        } catch {
          /* iOS: volume is read-only */
        }
      }
    }

    // Hold the clock while buffering, but never forever.
    if (stalled && playing) {
      if (!this.stallSince) this.stallSince = now;
      if (now - this.stallSince > MAX_HOLD_MS) stalled = false;
    } else this.stallSince = 0;

    return { stalled };
  }

  /** True while any assigned element is still seeking (preview should keep redrawing). */
  get busy(): boolean {
    for (const s of this.slots) if (s.clipId && (s.seeking || s.el.seeking)) return true;
    return false;
  }

  destroy(): void {
    this.releaseAll();
    this.container.remove();
  }
}
