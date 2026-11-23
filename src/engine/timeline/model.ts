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
  return { brightness: 100, contrast: 100, saturation: 100, blur: 0, hue: 0, sepia: 0, grayscale: 0, vignette: 0 };
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

/** Project frame size in pixels for the chosen aspect ratio and short-edge resolution. */
export function frameSize(settings: { aspect: ProjectSettings['aspect']; resolution: number }): { width: number; height: number } {
  const ratios: Record<AspectPreset, [number, number]> = {
    '16:9': [16, 9],
    '9:16': [9, 16],
    '1:1': [1, 1],
    '4:5': [4, 5],
    '4:3': [4, 3],
  };
  const [rw, rh] = ratios[settings.aspect];
  const short = settings.resolution;
  // Keep dimensions even (encoder friendly).
  const even = (n: number) => Math.round(n / 2) * 2;
  return rw >= rh
    ? { width: even((short * rw) / rh), height: short }
    : { width: short, height: even((short * rh) / rw) };
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

export function clipsOnTrack(project: Project, trackId: string, excludeId?: string): Clip[] {
  const out: Clip[] = [];
  for (const id in project.clips) {
    const c = project.clips[id];
    if (c.trackId === trackId && c.id !== excludeId) out.push(c);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function projectDuration(project: Project): number {
  let end = 0;
  for (const id in project.clips) end = Math.max(end, clipEnd(project.clips[id]));
  return end;
}
