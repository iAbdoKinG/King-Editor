import { describe, expect, it } from 'vitest';
import type { MediaAsset, Project } from '../../types/project';
import { createMediaClip, createProject, createTextClip, clipsOnTrack } from './model';
import {
  addTrack,
  deleteClips,
  duplicateClip,
  ensureTrackWithRoom,
  findFreeStart,
  insertClip,
  moveClip,
  rippleDelete,
  setClipSpeed,
  snapTime,
  splitClip,
  trimClip,
} from './ops';

const video: MediaAsset = {
  id: 'a1',
  kind: 'video',
  name: 'v.mp4',
  size: 1,
  mime: 'video/mp4',
  url: 'blob:x',
  duration: 10,
  width: 1920,
  height: 1080,
  status: 'ready',
};
const image: MediaAsset = { ...video, id: 'a2', kind: 'image', duration: 0 };
const assets = { a1: video, a2: image };

function setup(): { p: Project; vt: string } {
  const p = createProject();
  return { p, vt: p.tracks[0].id };
}

describe('timeline ops', () => {
  it('inserts clips without overlap', () => {
    let { p, vt } = setup();
    p = insertClip(p, createMediaClip(video, vt, 0));
    p = insertClip(p, createMediaClip(video, vt, 3)); // would overlap; pushed to 10
    const clips = clipsOnTrack(p, vt);
    expect(clips.map((c) => c.start)).toEqual([0, 10]);
  });

  it('finds the closest free gap', () => {
    let { p, vt } = setup();
    p = insertClip(p, { ...createMediaClip(video, vt, 0), duration: 2 });
    p = insertClip(p, { ...createMediaClip(video, vt, 5), duration: 2 });
    expect(findFreeStart(p, vt, 2, 1.5)).toBe(2);
    expect(findFreeStart(p, vt, 4, 1.5)).toBe(7);
  });

  it('splits a clip and keeps source continuity', () => {
    let { p, vt } = setup();
    const c = createMediaClip(video, vt, 1);
    p = insertClip(p, c);
    const [p2, rightId] = splitClip(p, c.id, 4);
    expect(rightId).toBeTruthy();
    const l = p2.clips[c.id];
    const r = p2.clips[rightId!];
    expect(l.duration).toBeCloseTo(3);
    expect(r.start).toBeCloseTo(4);
    expect(r.duration).toBeCloseTo(7);
    expect(r.type === 'media' && r.in).toBeCloseTo(3);
    // splitting at the edge is a no-op
    expect(splitClip(p, c.id, 1)[1]).toBeNull();
  });

  it('trims start/end within source bounds and neighbours', () => {
    let { p, vt } = setup();
    const a = createMediaClip(video, vt, 0);
    p = insertClip(p, a);
    p = trimClip(p, assets, a.id, 'start', 2);
    let c = p.clips[a.id];
    expect(c.start).toBeCloseTo(2);
    expect(c.type === 'media' && c.in).toBeCloseTo(2);
    // cannot extend before source start
    p = trimClip(p, assets, a.id, 'start', -5);
    c = p.clips[a.id];
    expect(c.start).toBeCloseTo(0);
    // cannot extend past source end
    p = trimClip(p, assets, a.id, 'end', 50);
    expect(p.clips[a.id].duration).toBeCloseTo(10);
    // stills can be extended freely
    const img = createMediaClip(image, vt, 20);
    p = insertClip(p, img);
    p = trimClip(p, assets, img.id, 'end', 60);
    expect(p.clips[img.id].duration).toBeCloseTo(40);
  });

  it('does not trim into a neighbour', () => {
    let { p, vt } = setup();
    const a = { ...createMediaClip(video, vt, 0), duration: 4 };
    const b = { ...createMediaClip(video, vt, 5), duration: 2 };
    p = insertClip(insertClip(p, a), b);
    p = trimClip(p, assets, a.id, 'end', 9);
    expect(p.clips[a.id].duration).toBeCloseTo(5);
  });

  it('moves clips to free space and across tracks', () => {
    let { p, vt } = setup();
    const a = createMediaClip(video, vt, 0);
    p = insertClip(p, a);
    const [p2, vt2] = addTrack(p, 'video');
    p = moveClip(p2, a.id, 3, vt2);
    expect(p.clips[a.id].trackId).toBe(vt2);
    expect(p.clips[a.id].start).toBeCloseTo(3);
  });

  it('duplicates after the original and deletes', () => {
    let { p, vt } = setup();
    const a = createMediaClip(video, vt, 0);
    p = insertClip(p, a);
    const [p2, id] = duplicateClip(p, a.id);
    expect(p2.clips[id!].start).toBeCloseTo(10);
    const p3 = deleteClips(p2, [a.id]);
    expect(Object.keys(p3.clips)).toEqual([id]);
    // original object untouched (non-destructive)
    expect(Object.keys(p2.clips).length).toBe(2);
  });

  it('ripple deletes', () => {
    let { p, vt } = setup();
    const a = { ...createMediaClip(video, vt, 0), duration: 3 };
    const b = { ...createMediaClip(video, vt, 3), duration: 3 };
    p = insertClip(insertClip(p, a), b);
    p = rippleDelete(p, a.id);
    expect(p.clips[b.id].start).toBeCloseTo(0);
  });

  it('creates a text track when needed', () => {
    const { p } = setup();
    const [p2, tid] = ensureTrackWithRoom(p, 'text', 0, 4);
    expect(p2.tracks[0].id).toBe(tid);
    const p3 = insertClip(p2, createTextClip(tid, 0));
    expect(Object.keys(p3.clips).length).toBe(1);
  });

  it('changes speed keeping the source range', () => {
    let { p, vt } = setup();
    const a = createMediaClip(video, vt, 0);
    p = insertClip(p, a);
    p = setClipSpeed(p, assets, a.id, 2);
    expect(p.clips[a.id].duration).toBeCloseTo(5);
    // slowing down is limited by a neighbour
    const b = { ...createMediaClip(video, vt, 6), duration: 2 };
    p = insertClip(p, b);
    p = setClipSpeed(p, assets, a.id, 0.5);
    expect(p.clips[a.id].duration).toBeCloseTo(6);
  });

  it('snaps within threshold', () => {
    expect(snapTime(1.02, [0, 1, 2], 0.05).time).toBe(1);
    expect(snapTime(1.2, [0, 1, 2], 0.05).snapped).toBeNull();
  });
});
