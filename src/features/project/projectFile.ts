/**
 * .kingproj project files (desktop app). The file stores the timeline and
 * the *paths* of the media, never the media itself. Loading validates and
 * normalizes every field, so a damaged or hand-edited file cannot put the
 * editor into an invalid state.
 */
import type { AspectPreset, AudioProps, Clip, Marker, MediaAsset, MediaKind, Project, Track, TrackKind, Transform } from '../../types/project';
import { defaultAudio, defaultSettings, defaultTransform } from '../../engine/timeline/model';
import { cleanAnimation, cleanEffects, cleanTextStyle, cleanTransition } from '../presets/presets';

export interface ProjectFileAsset {
  id: string;
  kind: MediaKind;
  name: string;
  size: number;
  mime: string;
  path: string;
}

interface ProjectFileV1 {
  app: 'king-editor';
  kind: 'project';
  v: 1;
  savedAt: string;
  project: Project;
  assets: ProjectFileAsset[];
}

export function serializeProject(project: Project, assets: Record<string, MediaAsset>): { text: string; unsaved: string[] } {
  const list: ProjectFileAsset[] = [];
  const unsaved: string[] = [];
  for (const a of Object.values(assets)) {
    if (!a.path) {
      unsaved.push(a.name);
      continue;
    }
    list.push({ id: a.id, kind: a.kind, name: a.name, size: a.size, mime: a.mime, path: a.path });
  }
  const file: ProjectFileV1 = { app: 'king-editor', kind: 'project', v: 1, savedAt: new Date().toISOString(), project, assets: list };
  return { text: JSON.stringify(file), unsaved };
}

/* ----------------------------- validation ----------------------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const str = (v: unknown, max: number, def: string) => (typeof v === 'string' ? v.slice(0, max) : def);
const id = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const oneOf = <T,>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const color = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

function cleanTransform(v: unknown): Transform {
  const d = defaultTransform();
  if (!isObj(v)) return d;
  const c = isObj(v.crop) ? v.crop : {};
  return {
    x: num(v.x, -1e5, 1e5, 0),
    y: num(v.y, -1e5, 1e5, 0),
    scaleX: num(v.scaleX, -50, 50, 1),
    scaleY: num(v.scaleY, -50, 50, 1),
    rotation: num(v.rotation, -36000, 36000, 0),
    opacity: num(v.opacity, 0, 1, 1),
    anchorX: num(v.anchorX, 0, 1, 0.5),
    anchorY: num(v.anchorY, 0, 1, 0.5),
    crop: { top: num(c.top, 0, 0.95, 0), right: num(c.right, 0, 0.95, 0), bottom: num(c.bottom, 0, 0.95, 0), left: num(c.left, 0, 0.95, 0) },
    flipH: v.flipH === true,
    flipV: v.flipV === true,
  };
}

function cleanAudio(v: unknown): AudioProps {
  const d = defaultAudio();
  if (!isObj(v)) return d;
  return { volume: num(v.volume, 0, 2, 1), pan: num(v.pan, -1, 1, 0), fadeIn: num(v.fadeIn, 0, 3600, 0), fadeOut: num(v.fadeOut, 0, 3600, 0) };
}

function cleanClip(v: unknown, tracks: Map<string, Track>, assetIds: Set<string>): Clip | null {
  if (!isObj(v)) return null;
  const cid = id(v.id);
  const trackId = id(v.trackId);
  if (!cid || !trackId || !tracks.has(trackId)) return null;
  const base = {
    id: cid,
    trackId,
    start: num(v.start, 0, 864000, 0),
    duration: num(v.duration, 1 / 240, 864000, 1),
    keyframes: isObj(v.keyframes) ? cleanAnimation(v.keyframes) : undefined,
    transitionIn: isObj(v.transitionIn) ? cleanTransition(v.transitionIn) : undefined,
    transform: cleanTransform(v.transform),
    effects: cleanEffects(isObj(v.effects) ? v.effects : {}),
  };
  if (v.type === 'text') return { ...base, type: 'text', text: str(v.text, 5000, ''), style: cleanTextStyle(isObj(v.style) ? v.style : {}) };
  if (v.type === 'media') {
    const assetId = id(v.assetId);
    if (!assetId || !assetIds.has(assetId)) return null;
    return { ...base, type: 'media', assetId, in: num(v.in, 0, 864000, 0), speed: num(v.speed, 0.1, 16, 1), audio: cleanAudio(v.audio) };
  }
  return null;
}

export interface ParsedProject {
  project: Project;
  assets: ProjectFileAsset[];
}

export function parseProjectFile(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a KING EDITOR project.');
  }
  if (!isObj(raw) || raw.app !== 'king-editor' || raw.kind !== 'project' || !isObj(raw.project)) throw new Error('This file is not a KING EDITOR project.');
  const p = raw.project;

  const assets: ProjectFileAsset[] = [];
  for (const a of Array.isArray(raw.assets) ? raw.assets.slice(0, 5000) : []) {
    if (!isObj(a)) continue;
    const aid = id(a.id);
    if (!aid || typeof a.path !== 'string' || !a.path) continue;
    assets.push({
      id: aid,
      kind: oneOf(a.kind, ['video', 'audio', 'image'] as const, 'video'),
      name: str(a.name, 260, 'media'),
      size: num(a.size, 0, 1e13, 0),
      mime: str(a.mime, 100, ''),
      path: a.path.slice(0, 4096),
    });
  }
  const assetIds = new Set(assets.map((a) => a.id));

  const ds = defaultSettings();
  const s = isObj(p.settings) ? p.settings : {};
  const settings = {
    name: str(s.name, 200, ds.name),
    aspect: oneOf(s.aspect, ['16:9', '9:16', '1:1', '4:5', '4:3'] as AspectPreset[], ds.aspect),
    resolution: oneOf(s.resolution, [720, 1080] as const, ds.resolution),
    fps: oneOf(s.fps, [24, 25, 30, 60] as const, ds.fps),
    background: color(s.background, ds.background),
  };

  const tracks: Track[] = [];
  for (const t of Array.isArray(p.tracks) ? p.tracks.slice(0, 200) : []) {
    if (!isObj(t)) continue;
    const tid = id(t.id);
    if (!tid || tracks.some((x) => x.id === tid)) continue;
    tracks.push({
      id: tid,
      kind: oneOf(t.kind, ['video', 'audio', 'text'] as TrackKind[], 'video'),
      name: str(t.name, 60, 'Track'),
      muted: t.muted === true,
      hidden: t.hidden === true,
      volume: num(t.volume, 0, 2, 1),
      solo: t.solo === true,
    });
  }
  const trackMap = new Map(tracks.map((t) => [t.id, t]));

  const clips: Record<string, Clip> = {};
  const rawClips = isObj(p.clips) ? Object.values(p.clips).slice(0, 20000) : [];
  for (const c of rawClips) {
    const clip = cleanClip(c, trackMap, assetIds);
    if (clip && !clips[clip.id]) clips[clip.id] = clip;
  }

  const markers: Marker[] = [];
  for (const m of Array.isArray(p.markers) ? p.markers.slice(0, 1000) : []) {
    if (!isObj(m)) continue;
    const mid = id(m.id);
    if (mid) markers.push({ id: mid, t: num(m.t, 0, 864000, 0), label: str(m.label, 80, ''), color: color(m.color, '#91C1C5') });
  }

  return { project: { settings, tracks, clips, markers: markers.sort((a, b) => a.t - b.t) }, assets };
}
