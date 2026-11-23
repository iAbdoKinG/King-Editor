import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '../../types/project';
import { createMediaClip, createProject, createTextClip } from '../../engine/timeline/model';
import { addMarker, insertClip } from '../../engine/timeline/ops';
import { upsertKeyframe } from '../../engine/timeline/animation';
import { parseProjectFile, serializeProject } from './projectFile';

const a: MediaAsset = { id: 'ast_1', kind: 'video', name: 'v.mp4', size: 10, mime: 'video/mp4', url: 'blob:x', duration: 10, width: 1920, height: 1080, status: 'ready', path: 'C:\\Videos\\v.mp4' };

describe('project files', () => {
  it('round-trips timeline, keyframes, transitions and markers', () => {
    let p = createProject();
    const vt = p.tracks[0].id;
    let c = createMediaClip(a, vt, 0);
    c = upsertKeyframe(c, 'opacity', 0, 0);
    p = insertClip(p, c);
    p = insertClip(p, { ...createMediaClip(a, vt, 10), transitionIn: { type: 'wipe', duration: 1, direction: 'up', easing: 'easeOut' } });
    [p] = addMarker(p, 2, 'Intro');
    const { text, unsaved } = serializeProject(p, { [a.id]: a });
    expect(unsaved).toEqual([]);
    const back = parseProjectFile(text);
    expect(back.project.tracks.length).toBe(p.tracks.length);
    expect(Object.keys(back.project.clips).length).toBe(2);
    expect(back.project.clips[c.id].type === 'media' && back.project.clips[c.id].keyframes?.opacity?.[0].v).toBe(0);
    expect(Object.values(back.project.clips).some((x) => x.transitionIn?.type === 'wipe')).toBe(true);
    expect(back.project.markers?.[0].label).toBe('Intro');
    expect(back.assets[0].path).toBe('C:\\Videos\\v.mp4');
  });

  it('rejects foreign files and drops invalid parts', () => {
    expect(() => parseProjectFile('{}')).toThrow();
    expect(() => parseProjectFile('nope')).toThrow();
    const p = createProject();
    const t = createTextClip(p.tracks[0].id, 0);
    const bad = {
      app: 'king-editor',
      kind: 'project',
      v: 1,
      project: {
        ...p,
        settings: { ...p.settings, fps: 999, aspect: 'weird' },
        clips: {
          ok: { ...t, id: 'ok', transform: { ...t.transform, opacity: 7 } },
          orphan: { ...t, id: 'orphan', trackId: 'nope' },
          missingAsset: { id: 'm', type: 'media', trackId: p.tracks[0].id, assetId: 'ghost', start: 0, duration: 1 },
        },
      },
      assets: [{ id: '../../etc', path: 'x' }],
    };
    const r = parseProjectFile(JSON.stringify(bad));
    expect(r.project.settings.fps).toBe(30);
    expect(r.project.settings.aspect).toBe('16:9');
    expect(Object.keys(r.project.clips)).toEqual(['ok']);
    expect(r.project.clips.ok.transform.opacity).toBe(1);
    expect(r.assets).toEqual([]);
  });
});
