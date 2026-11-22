/**
 * High-level editing commands shared by the toolbar, keyboard shortcuts,
 * context menus and touch gestures (one implementation for every input type).
 */
import { engine } from '../../engine/playback/engine';
import { clipEnd, createMediaClip, createTextClip, trackKindForAsset } from '../../engine/timeline/model';
import {
  deleteClips,
  duplicateClip,
  ensureTrackWithRoom,
  findFreeStart,
  insertClip,
  rippleDelete,
  splitClip,
  updateClip,
} from '../../engine/timeline/ops';
import { defaultTransition, maxTransitionDuration, prevAdjacent } from '../../engine/timeline/transitions';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { quantize } from '../../utils/time';

const ps = () => useProjectStore.getState();
const toast = (t: string, tone?: 'info' | 'error') => useUIStore.getState().toast(t, tone);

export function playhead(): number {
  return engine.clock.now();
}

export function addAssetToTimeline(assetId: string, at?: number, trackId?: string): void {
  const asset = useMediaStore.getState().assets[assetId];
  if (!asset) return;
  if (asset.status !== 'ready') {
    toast(asset.status === 'error' ? `${asset.name} can't be used: ${asset.error}` : 'Still reading this file…', 'error');
    return;
  }
  let newId = '';
  ps().apply((p) => {
    const start = quantize(Math.max(0, at ?? playhead()), p.settings.fps);
    const dur = asset.kind === 'image' ? 5 : asset.duration;
    const [p1, tid] = ensureTrackWithRoom(p, trackKindForAsset(asset), start, dur, trackId);
    const clip = createMediaClip(asset, tid, start);
    // Frame-align the duration (rounding down keeps it within the source).
    clip.duration = Math.max(1 / p.settings.fps, Math.floor(clip.duration * p.settings.fps + 1e-6) / p.settings.fps);
    newId = clip.id;
    return insertClip(p1, clip);
  });
  ps().select(newId);
}

export function addText(): void {
  let newId = '';
  ps().apply((p) => {
    const start = quantize(playhead(), p.settings.fps);
    const [p1, tid] = ensureTrackWithRoom(p, 'text', start, 4);
    const clip = createTextClip(tid, start);
    newId = clip.id;
    return insertClip(p1, clip);
  });
  ps().select(newId);
}

export function splitAtPlayhead(): void {
  const t = playhead();
  const { project, selectedClipId } = ps();
  const sel = selectedClipId ? project.clips[selectedClipId] : null;
  let targets: string[];
  if (sel && t > sel.start && t < clipEnd(sel)) targets = [sel.id];
  else targets = Object.values(project.clips).filter((c) => t > c.start && t < clipEnd(c)).map((c) => c.id);
  if (!targets.length) {
    toast('Move the playhead over a clip to split it.');
    return;
  }
  let rightSel: string | null = null;
  ps().apply((p) => {
    let next = p;
    for (const id of targets) {
      const [n, right] = splitClip(next, id, t);
      next = n;
      if (id === selectedClipId) rightSel = right;
    }
    return next;
  });
  if (rightSel) ps().select(rightSel);
}

export function duplicateSelected(): void {
  const id = ps().selectedClipId;
  if (!id) return;
  let copy: string | null = null;
  ps().apply((p) => {
    const [n, c] = duplicateClip(p, id);
    copy = c;
    return n;
  });
  if (copy) ps().select(copy);
}

export function deleteSelected(ripple = false): void {
  const tid = ps().selectedTransitionId;
  if (tid) {
    removeTransition(tid);
    return;
  }
  const id = ps().selectedClipId;
  if (!id) return;
  ps().apply((p) => (ripple ? rippleDelete(p, id) : deleteClips(p, [id])));
  ps().select(null);
}

export function togglePlay(): void {
  engine.gesture();
  const { clock } = engine;
  if (!clock.playing && clock.duration <= 0) {
    toast('Add media to the timeline to play.');
    return;
  }
  clock.toggle();
}

export function stepFrames(n: number): void {
  const fps = ps().project.settings.fps;
  engine.clock.pause();
  engine.seek(quantize(engine.clock.now() + n / fps, fps));
}

export function seekBy(sec: number): void {
  engine.seek(engine.clock.now() + sec);
}

/** Copy a clip into free space on another compatible track (touch alternative to vertical drag). */
export function moveSelectedToTrack(dir: -1 | 1): void {
  const { project, selectedClipId } = ps();
  const c = selectedClipId ? project.clips[selectedClipId] : null;
  if (!c) return;
  const kind = project.tracks.find((t) => t.id === c.trackId)?.kind;
  const idx = project.tracks.findIndex((t) => t.id === c.trackId);
  for (let i = idx + dir; i >= 0 && i < project.tracks.length; i += dir) {
    const t = project.tracks[i];
    if (t.kind !== kind) continue;
    ps().apply((p) => {
      const start = findFreeStart(p, t.id, c.duration, c.start, c.id);
      return { ...p, clips: { ...p.clips, [c.id]: { ...c, trackId: t.id, start } } };
    });
    return;
  }
  toast('No other compatible track in that direction.');
}

/** Add (or select) the transition into `clipId` from the adjacent previous clip. */
export function addTransition(clipId: string): void {
  const { project } = ps();
  const clip = project.clips[clipId];
  if (!clip) return;
  const prev = prevAdjacent(project, clip);
  if (!prev) {
    toast('Transitions need two clips touching on the same track.');
    return;
  }
  if (!clip.transitionIn) {
    const d = Math.min(defaultTransition().duration, maxTransitionDuration(prev, clip));
    ps().apply((p) => updateClip(p, clipId, (c) => ({ ...c, transitionIn: { ...defaultTransition(), duration: d } })));
  }
  ps().selectTransition(clipId);
}

export function removeTransition(clipId: string): void {
  ps().apply((p) => updateClip(p, clipId, (c) => ({ ...c, transitionIn: undefined })));
  ps().selectTransition(null);
}
