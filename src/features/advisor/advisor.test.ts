import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '../../types/project';
import { createMediaClip, createProject } from '../../engine/timeline/model';
import { addTrack, insertClip } from '../../engine/timeline/ops';
import { maxConcurrentVideo } from './advisor';

const v: MediaAsset = { id: 'v', kind: 'video', name: 'v', size: 1, mime: '', url: '', duration: 10, width: 1920, height: 1080, status: 'ready' };

describe('maxConcurrentVideo', () => {
  it('counts overlapping video clips across tracks', () => {
    let p = createProject();
    let ids = [p.tracks[0].id];
    for (let i = 0; i < 3; i++) {
      const [n, id] = addTrack(p, 'video');
      p = n;
      ids.push(id);
    }
    ids.forEach((id, i) => (p = insertClip(p, { ...createMediaClip(v, id, i), duration: 5 })));
    expect(maxConcurrentVideo(p, { v })).toBe(4);
    ids = [];
  });
});
