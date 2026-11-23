import { t as T } from '../../i18n';
import type {
  AspectPreset,
  AudioProps,
  Clip,
  Effects,
  MediaAsset,
  MediaClip,
  Project,
  ProjectSettings,
  TextClip,
  Track,
  TrackKind,
  Transform,
} from '../../types/project';
import { uid } from '../../utils/id';

export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_TEXT_DURATION = 4;

export function defaultTransform(): Transform {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

export function defaultEffects(): Effects {
  return {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    hue: 0,
    sepia: 0,
    grayscale: 0,
    vignette: 0,
    invert: 0,
    radius: 0,
    blend: 'normal',
    shadow: 0,
    shadowX: 0,
    shadowY: 12,
    shadowBlur: 24,
    shadowColor: '#000000',
  };
}

export function defaultAudio(): AudioProps {
  return { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0 };
}

export function defaultSettings(): ProjectSettings {
  return { name: T('Untitled Project'), aspect: '16:9', resolution: 1080, fps: 30, background: '#000000' };
}

export function createTrack(kind: TrackKind, existing: Track[]): Track {
  const n = existing.filter((t) => t.kind === kind).length + 1;
  const label = kind === 'video' ? 'Video {n}' : kind === 'audio' ? 'Audio {n}' : 'Text {n}';
  return { id: uid('trk'), kind, name: T(label, { n }), muted: false, hidden: false };
}

export function createProject(): Project {
  const tracks: Track[] = [];
  tracks.push(createTrack('video', tracks));
  tracks.push(createTrack('audio', tracks));
  return { settings: defaultSettings(), tracks, clips: {} };
}

/** Largest frame edge anywhere in the app (2K = 2560×1440). */
export const MAX_EDGE = 2560;
export const MAX_SHORT_EDGE = 1440;
export const MIN_EDGE = 128;

/** Keep dimensions even (encoder friendly). */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Clamp a user-entered custom dimension. */
export function clampDimension(n: number): number {
  return even(Math.min(MAX_EDGE, Math.max(MIN_EDGE, isFinite(n) ? n : 1080)));
}

type FrameSettings = { aspect: ProjectSettings['aspect']; resolution: number; customWidth?: number; customHeight?: number };

/** Project frame size: preset aspect × short-edge resolution, or the exact custom width × height. */
export function frameSize(settings: FrameSettings): { width: number; height: number } {
  if (settings.aspect === 'custom') {
    return { width: clampDimension(settings.customWidth ?? 1920), height: clampDimension(settings.customHeight ?? 1080) };
  }
  const ratios: Record<Exclude<AspectPreset, 'custom'>, [number, number]> = {
    '16:9': [16, 9],
    '9:16': [9, 16],
    '1:1': [1, 1],
    '4:5': [4, 5],
    '4:3': [4, 3],
  };
  const [rw, rh] = ratios[settings.aspect];
  const short = settings.resolution;
  return rw >= rh ? { width: even((short * rw) / rh), height: even(short) } : { width: even(short), height: even((short * rh) / rw) };
}

/** Change aspect; switching to 'custom' starts from the current frame size. */
export function withAspect(settings: ProjectSettings, aspect: AspectPreset): ProjectSettings {
  if (aspect === 'custom' && settings.aspect !== 'custom') {
    const f = frameSize(settings);
    return { ...settings, aspect, customWidth: f.width, customHeight: f.height };
  }
  return { ...settings, aspect };
}

/**
 * Output size for an export: the project frame scaled so its short edge is
 * `shortEdge`, never larger than 2K (long edge ≤ 2560, short edge ≤ 1440).
 */
export function exportSize(settings: FrameSettings, shortEdge: number): { width: number; height: number } {
  const f = frameSize(settings);
  const short = Math.min(f.width, f.height);
  const long = Math.max(f.width, f.height);
  const k = Math.min(Math.min(shortEdge, MAX_SHORT_EDGE) / short, MAX_EDGE / long);
  return { width: even(f.width * k), height: even(f.height * k) };
}

export function trackKindForAsset(asset: MediaAsset): TrackKind {
  return asset.kind === 'audio' ? 'audio' : 'video';
}

/** Effective audio gain of a track: mute, solo and track volume combined. */
export function trackGain(project: Project, track: Track | undefined): number {
  if (!track || track.muted) return 0;
  if (project.tracks.some((t) => t.solo) && !track.solo) return 0;
  return track.volume ?? 1;
}

export function clipEnd(c: Clip): number {
  return c.start + c.duration;
}

export function isVisual(c: Clip, assets: Record<string, MediaAsset>): boolean {
  if (c.type === 'text') return true;
  const a = assets[c.assetId];
  return !!a && a.kind !== 'audio';
}

export function hasAudio(c: Clip, assets: Record<string, MediaAsset>): boolean {
  if (c.type !== 'media') return false;
  const a = assets[c.assetId];
  return !!a && (a.kind === 'audio' || a.kind === 'video');
}

/** Maximum timeline duration a clip may have given its source (Infinity for stills/text). */
export function maxClipDuration(c: Clip, assets: Record<string, MediaAsset>): number {
  if (c.type === 'text') return Infinity;
  const a = assets[c.assetId];
  if (!a || a.kind === 'image') return Infinity;
  return Math.max(0, (a.duration - c.in) / c.speed);
}

export function createMediaClip(asset: MediaAsset, trackId: string, start: number): MediaClip {
  return {
    id: uid('clp'),
    type: 'media',
    trackId,
    assetId: asset.id,
    start,
    duration: asset.kind === 'image' ? DEFAULT_IMAGE_DURATION : asset.duration,
    in: 0,
    speed: 1,
    transform: defaultTransform(),
    effects: defaultEffects(),
    audio: defaultAudio(),
  };
}

export function createTextClip(trackId: string, start: number, text = T('Your title')): TextClip {
  return {
    id: uid('clp'),
    type: 'text',
    trackId,
    start,
    duration: DEFAULT_TEXT_DURATION,
    text,
    style: {
      fontFamily: 'Inter',
      fontSize: 96,
      fontWeight: 800,
      color: '#F2F4F5',
      align: 'center',
      shadow: true,
      background: null,
    },
    transform: defaultTransform(),
    effects: defaultEffects(),
  };
}

/**
 * Per-track clip lists sorted by start, built once per project version.
 * Project clip records are immutable (every edit produces a new object), so
 * caching by object identity can never return stale data.
 */
const trackIndexCache = new WeakMap<Record<string, Clip>, Map<string, readonly Clip[]>>();

export function trackIndex(project: Project): Map<string, readonly Clip[]> {
  let idx = trackIndexCache.get(project.clips);
  if (!idx) {
    const m = new Map<string, Clip[]>();
    for (const id in project.clips) {
      const c = project.clips[id];
      const list = m.get(c.trackId);
      if (list) list.push(c);
      else m.set(c.trackId, [c]);
    }
    for (const list of m.values()) list.sort((a, b) => a.start - b.start);
    idx = m;
    trackIndexCache.set(project.clips, idx);
  }
  return idx;
}

const EMPTY: readonly Clip[] = Object.freeze([]);

/** Clips on a track sorted by start (shared, read-only array unless `excludeId` is given). */
export function clipsOnTrack(project: Project, trackId: string, excludeId?: string): readonly Clip[] {
  const list = trackIndex(project).get(trackId) ?? EMPTY;
  return excludeId ? list.filter((c) => c.id !== excludeId) : list;
}

export function projectDuration(project: Project): number {
  let end = 0;
  for (const id in project.clips) end = Math.max(end, clipEnd(project.clips[id]));
  return end;
}
