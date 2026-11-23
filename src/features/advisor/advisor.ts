/**
 * Resource advisor: spots workloads that are likely to be heavy for a browser
 * (especially on iPhone/iPad) and explains why, once per session per topic.
 */
import { create } from 'zustand';
import { t as T } from '../../i18n';
import type { MediaAsset, Project } from '../../types/project';
import { clipRange } from '../../engine/timeline/transitions';

export interface Advice {
  key: string;
  title: string;
  body: string;
}

interface AdvisorState {
  current: Advice | null;
  dismissed: Record<string, true>;
  show: (a: Advice) => void;
  dismiss: () => void;
}

export const useAdvisorStore = create<AdvisorState>((set, get) => ({
  current: null,
  dismissed: {},
  show: (a) => {
    if (get().dismissed[a.key] || get().current?.key === a.key) return;
    set({ current: a });
  },
  dismiss: () => {
    const c = get().current;
    set({ current: null, dismissed: c ? { ...get().dismissed, [c.key]: true } : get().dismissed });
  },
}));

const desktop = () => T('The Windows desktop version is built for this level of work.');

function isLowEndDevice(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (mem !== undefined && mem <= 4) || /iPhone|iPod/.test(navigator.userAgent);
}

export function checkAsset(a: MediaAsset): void {
  if (a.kind !== 'video') return;
  const px = a.width * a.height;
  if (px > 3840 * 2160 * 0.9)
    useAdvisorStore.getState().show({
      key: '4k',
      title: T('4K video on the web'),
      body: T('“{name}” is {w}×{h}. Playback and export can be slow or run out of memory in a browser{device}. {desktop}', {
        name: a.name,
        w: a.width,
        h: a.height,
        device: isLowEndDevice() ? T(' on this device') : '',
        desktop: desktop(),
      }),
    });
  if (a.duration > 20 * 60)
    useAdvisorStore.getState().show({
      key: 'long',
      title: T('Very long video'),
      body: T('“{name}” is over 20 minutes. Waveform analysis and export will take a while in the browser. {desktop}', { name: a.name, desktop: desktop() }),
    });
}

/** Maximum number of video clips that overlap in time across visual tracks. */
export function maxConcurrentVideo(project: Project, assets: Record<string, MediaAsset>): number {
  const ev: Array<[number, number]> = [];
  for (const c of Object.values(project.clips)) {
    if (c.type !== 'media' || assets[c.assetId]?.kind !== 'video') continue;
    const tr = project.tracks.find((t) => t.id === c.trackId);
    if (!tr || tr.kind === 'audio' || tr.hidden) continue;
    const [s, e] = clipRange(project, c);
    ev.push([s, 1], [e, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) max = Math.max(max, (cur += d));
  return max;
}

export function checkProject(project: Project, assets: Record<string, MediaAsset>): void {
  const n = maxConcurrentVideo(project, assets);
  const limit = isLowEndDevice() ? 3 : 4;
  if (n > limit)
    useAdvisorStore.getState().show({
      key: 'layers',
      title: T('{n} videos at the same time', { n }),
      body: T('Stacking more than {limit} videos makes the browser decode them all at once, which can stutter on this device. Consider fewer overlapping videos here. {desktop}', { limit, desktop: desktop() }),
    });
  const blurred = Object.values(project.clips).filter((c) => (c.effects?.blur ?? 0) > 8).length;
  if (blurred >= 3)
    useAdvisorStore.getState().show({
      key: 'blur',
      title: T('Heavy blur'),
      body: T('Strong blur on {n} clips is expensive to render in real time on mobile devices. {desktop}', { n: blurred, desktop: desktop() }),
    });
}

export function checkExport(durationSec: number, height: number, fps: number): void {
  const frames = durationSec * fps * (height >= 1080 ? 2.25 : 1);
  if (frames > 30 * 60 * 10 * 2.25)
    useAdvisorStore.getState().show({
      key: 'export-long',
      title: T('Long export'),
      body: T('Rendering {m} min at {h}p{fps} in the browser can take a long time and needs the screen to stay on. {desktop}', {
        m: Math.round(durationSec / 60),
        h: height,
        fps,
        desktop: desktop(),
      }),
    });
}
