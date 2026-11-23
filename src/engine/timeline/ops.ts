/**
 * Pure, non-destructive timeline operations. Every function returns a new
 * Project and never mutates its input, which keeps undo/redo trivial and the
 * operations easy to unit test.
 */
import type { Clip, Marker, MediaAsset, Project, Track, TrackKind } from '../../types/project';
import { uid } from '../../utils/id';
import { clamp, quantize } from '../../utils/time';
import { clipEnd, clipsOnTrack, createTrack, maxClipDuration } from './model';
import { shiftKeyframes, splitKeyframes } from './animation';

const EPS = 1e-6;

export function minClipDuration(fps: number): number {
  return 1 / fps;
}

function withClip(project: Project, clip: Clip): Project {
  return { ...project, clips: { ...project.clips, [clip.id]: clip } };
}

/**
 * Find the start time closest to `desired` where a clip of `duration` fits on
 * the track without overlapping other clips.
 */
export function findFreeStart(
  project: Project,
  trackId: string,
  duration: number,
  desired: number,
  excludeId?: string,
): number {
  const others = clipsOnTrack(project, trackId, excludeId);
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const c of others) {
    if (c.start > cursor) gaps.push([cursor, c.start]);
    cursor = Math.max(cursor, clipEnd(c));
  }
  gaps.push([cursor, Infinity]);
  let best = Infinity;
  let bestDist = Infinity;
  for (const [g0, g1] of gaps) {
    if (g1 - g0 + EPS < duration) continue;
    const cand = clamp(desired, g0, g1 === Infinity ? Infinity : g1 - duration);
    const d = Math.abs(cand - desired);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return Math.max(0, best);
}

export function insertClip(project: Project, clip: Clip): Project {
  const fps = project.settings.fps;
  const start = findFreeStart(project, clip.trackId, clip.duration, quantize(Math.max(0, clip.start), fps));
  return withClip(project, { ...clip, start });
}

export function moveClip(project: Project, clipId: string, desiredStart: number, trackId?: string): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const fps = project.settings.fps;
  const target = trackId ?? clip.trackId;
  const start = findFreeStart(project, target, clip.duration, quantize(Math.max(0, desiredStart), fps), clipId);
  if (start === clip.start && target === clip.trackId) return project;
  return withClip(project, { ...clip, start, trackId: target });
}

/** Trim either edge of a clip to `time` (timeline seconds), respecting neighbours and source length. */
export function trimClip(
  project: Project,
  assets: Record<string, MediaAsset>,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const fps = project.settings.fps;
  const minDur = minClipDuration(fps);
  const neighbours = clipsOnTrack(project, clip.trackId, clipId);
  const end = clipEnd(clip);
  if (edge === 'start') {
    let lower = 0;
    for (const n of neighbours) if (clipEnd(n) <= clip.start + EPS) lower = Math.max(lower, clipEnd(n));
    if (clip.type === 'media') {
      const a = assets[clip.assetId];
      if (a && a.kind !== 'image') lower = Math.max(lower, clip.start - clip.in / clip.speed);
    }
    const ns = clamp(quantize(time, fps), lower, end - minDur);
    if (Math.abs(ns - clip.start) < EPS) return project;
    const delta = ns - clip.start;
    const keyframes = shiftKeyframes(clip.keyframes, -delta);
    const next: Clip =
      clip.type === 'media'
        ? { ...clip, start: ns, duration: end - ns, in: Math.max(0, clip.in + delta * clip.speed), keyframes }
        : { ...clip, start: ns, duration: end - ns, keyframes };
    return withClip(project, next);
  }
  let upper = clip.start + maxClipDuration(clip, assets);
  for (const n of neighbours) if (n.start >= end - EPS) upper = Math.min(upper, n.start);
  const ne = clamp(quantize(time, fps), clip.start + minDur, upper);
  if (Math.abs(ne - end) < EPS) return project;
  return withClip(project, { ...clip, duration: ne - clip.start });
}

/** Split a clip at timeline time `t`. Returns the new project and the id of the right-hand clip. */
export function splitClip(project: Project, clipId: string, t: number): [Project, string | null] {
  const clip = project.clips[clipId];
  if (!clip) return [project, null];
  const fps = project.settings.fps;
  const at = quantize(t, fps);
  const minDur = minClipDuration(fps);
  if (at <= clip.start + minDur - EPS || at >= clipEnd(clip) - minDur + EPS) return [project, null];
  const leftDur = at - clip.start;
  const rightDur = clipEnd(clip) - at;
  const rightId = uid('clp');
  const [kl, kr] = splitKeyframes(clip.keyframes, leftDur);
  let left: Clip;
  let right: Clip;
  if (clip.type === 'media') {
    left = { ...clip, duration: leftDur, keyframes: kl, audio: { ...clip.audio, fadeOut: 0 } };
    right = {
      ...clip,
      id: rightId,
      start: at,
      duration: rightDur,
      keyframes: kr,
      transitionIn: undefined,
      in: clip.in + leftDur * clip.speed,
      audio: { ...clip.audio, fadeIn: 0 },
    };
  } else {
    left = { ...clip, duration: leftDur, keyframes: kl };
    right = { ...clip, id: rightId, start: at, duration: rightDur, keyframes: kr, transitionIn: undefined };
  }
  return [{ ...project, clips: { ...project.clips, [left.id]: left, [right.id]: right } }, rightId];
}

export function duplicateClip(project: Project, clipId: string): [Project, string | null] {
  const clip = project.clips[clipId];
  if (!clip) return [project, null];
  const copy: Clip = structuredClone(clip);
  copy.id = uid('clp');
  copy.start = findFreeStart(project, clip.trackId, clip.duration, clipEnd(clip));
  return [withClip(project, copy), copy.id];
}

export function deleteClips(project: Project, ids: string[]): Project {
  if (!ids.length) return project;
  const clips = { ...project.clips };
  for (const id of ids) delete clips[id];
  return { ...project, clips };
}

/** Remove a clip and close the gap it leaves on its track (ripple delete). */
export function rippleDelete(project: Project, clipId: string): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  const clips = { ...project.clips };
  delete clips[clipId];
  for (const c of clipsOnTrack(project, clip.trackId, clipId)) {
    if (c.start >= clipEnd(clip) - EPS) clips[c.id] = { ...c, start: c.start - clip.duration };
  }
  return { ...project, clips };
}

export function updateClip(project: Project, clipId: string, patch: (c: Clip) => Clip): Project {
  const clip = project.clips[clipId];
  if (!clip) return project;
  return withClip(project, patch(clip));
}

export function addTrack(project: Project, kind: TrackKind): [Project, string] {
  const track = createTrack(kind, project.tracks);
  const tracks = [...project.tracks];
  // Visual tracks go above existing tracks of the same group; audio tracks go at the bottom.
  if (kind === 'audio') tracks.push(track);
  else {
    const firstSame = tracks.findIndex((t) => t.kind === kind);
    const firstVisual = tracks.findIndex((t) => t.kind !== 'audio');
    const idx = firstSame >= 0 ? firstSame : firstVisual >= 0 ? firstVisual : tracks.findIndex((t) => t.kind === 'audio');
    tracks.splice(idx < 0 ? tracks.length : idx, 0, track);
  }
  return [{ ...project, tracks }, track.id];
}

export function removeTrack(project: Project, trackId: string): Project {
  const clips: Record<string, Clip> = {};
  for (const id in project.clips) if (project.clips[id].trackId !== trackId) clips[id] = project.clips[id];
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId), clips };
}

export function moveTrack(project: Project, trackId: string, dir: -1 | 1): Project {
  const i = project.tracks.findIndex((t) => t.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= project.tracks.length) return project;
  const tracks = [...project.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  return { ...project, tracks };
}

export function updateTrack(project: Project, trackId: string, patch: Partial<Track>): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)) };
}

/** Snap `t` to the nearest candidate within `threshold` seconds. */
export function snapTime(t: number, candidates: number[], threshold: number): { time: number; snapped: number | null } {
  let best: number | null = null;
  let bestD = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - t);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best === null ? { time: t, snapped: null } : { time: best, snapped: best };
}

export function snapCandidates(project: Project, excludeId: string | null, playhead: number): number[] {
  const out = [0, playhead, ...(project.markers ?? []).map((m) => m.t)];
  for (const id in project.clips) {
    if (id === excludeId) continue;
    const c = project.clips[id];
    out.push(c.start, clipEnd(c));
  }
  return out;
}

/** Find a track of `kind` with room for [start, start+duration), or create one. */
export function ensureTrackWithRoom(
  project: Project,
  kind: TrackKind,
  start: number,
  duration: number,
  preferredTrackId?: string,
): [Project, string] {
  const fits = (trackId: string) =>
    clipsOnTrack(project, trackId).every((c) => clipEnd(c) <= start + EPS || c.start >= start + duration - EPS);
  const pref = preferredTrackId && project.tracks.find((t) => t.id === preferredTrackId && t.kind === kind);
  if (pref && fits(pref.id)) return [project, pref.id];
  for (const t of project.tracks) if (t.kind === kind && fits(t.id)) return [project, t.id];
  return addTrack(project, kind);
}

/** Change playback speed, keeping the same source range where neighbours allow. */
export function setClipSpeed(
  project: Project,
  assets: Record<string, MediaAsset>,
  clipId: string,
  speed: number,
): Project {
  const clip = project.clips[clipId];
  if (!clip || clip.type !== 'media' || speed <= 0) return project;
  const fps = project.settings.fps;
  const span = clip.duration * clip.speed;
  let duration = span / speed;
  const next = { ...clip, speed };
  duration = Math.min(duration, maxClipDuration(next, assets));
  for (const n of clipsOnTrack(project, clip.trackId, clipId)) {
    if (n.start >= clipEnd(clip) - EPS) duration = Math.min(duration, n.start - clip.start);
  }
  return withClip(project, { ...next, duration: Math.max(minClipDuration(fps), quantize(duration, fps)) });
}

/* ----------------------------- markers ----------------------------- */

export const MARKER_COLORS = ['#91C1C5', '#E3B261', '#E0817A', '#9FC27D', '#B39DDB', '#F2F4F5'];

export function addMarker(project: Project, t: number, label = '', color = MARKER_COLORS[0]): [Project, string] {
  const fps = project.settings.fps;
  const at = quantize(Math.max(0, t), fps);
  const existing = (project.markers ?? []).find((m) => Math.abs(m.t - at) < EPS);
  if (existing) return [project, existing.id];
  const m: Marker = { id: uid('mrk'), t: at, label, color };
  const markers = [...(project.markers ?? []), m].sort((a, b) => a.t - b.t);
  return [{ ...project, markers }, m.id];
}

export function updateMarker(project: Project, id: string, patch: Partial<Marker>): Project {
  const markers = (project.markers ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t);
  return { ...project, markers };
}

export function removeMarker(project: Project, id: string): Project {
  return { ...project, markers: (project.markers ?? []).filter((m) => m.id !== id) };
}
