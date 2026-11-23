import type { Clip, Project } from '../../types/project';
import { t as T } from '../../i18n';
import { useThemeStore } from '../../app/theme';
import { defaultEffects } from '../../engine/timeline/model';
import { updateClip } from '../../engine/timeline/ops';
import { maxTransitionDuration, prevAdjacent } from '../../engine/timeline/transitions';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { ensureFont } from '../fonts/fonts';
import type { Preset } from './presets';

/** The clip a preset would apply to, or why it can't. */
export function presetTarget(p: Preset, project: Project, selectedClipId: string | null, selectedTransitionId: string | null): { clip: Clip | null; reason?: string } {
  if (p.kind === 'theme') return { clip: null };
  const id = p.kind === 'transition' ? selectedTransitionId ?? selectedClipId : selectedClipId;
  const clip = id ? project.clips[id] : null;
  if (!clip) return { clip: null, reason: 'Select a clip first.' };
  const assets = useMediaStore.getState().assets;
  const visual = clip.type === 'text' || (clip.type === 'media' && assets[clip.assetId]?.kind !== 'audio');
  if (p.kind === 'textStyle' && clip.type !== 'text') return { clip: null, reason: 'Select a text clip.' };
  if ((p.kind === 'effects' || p.kind === 'animation') && !visual) return { clip: null, reason: 'Select a video, image or text clip.' };
  if (p.kind === 'transition' && !prevAdjacent(project, clip)) return { clip: null, reason: 'Select a clip that touches a previous clip.' };
  return { clip };
}

export function applyPreset(p: Preset): boolean {
  const ps = useProjectStore.getState();
  const toast = useUIStore.getState().toast;
  if (p.kind === 'theme') {
    useThemeStore.getState().setCustom(p.data as never);
    toast(T('Theme “{name}” applied.', { name: p.name }));
    return true;
  }
  const { clip, reason } = presetTarget(p, ps.project, ps.selectedClipId, ps.selectedTransitionId);
  if (!clip) {
    toast(reason ?? 'Nothing to apply to.', 'error');
    return false;
  }
  ps.apply((proj) =>
    updateClip(proj, clip.id, (c) => {
      switch (p.kind) {
        case 'effects':
          return { ...c, effects: { ...defaultEffects(), ...(p.data as Clip['effects']) } } as Clip;
        case 'textStyle':
          void ensureFont((p.data as { fontFamily: string }).fontFamily);
          return c.type === 'text' ? { ...c, style: { ...(p.data as typeof c.style) } } : c;
        case 'animation':
          return { ...c, keyframes: structuredClone(p.data as Clip['keyframes']) } as Clip;
        case 'transition': {
          const prev = prevAdjacent(proj, c);
          const tr = p.data as NonNullable<Clip['transitionIn']>;
          return { ...c, transitionIn: { ...tr, duration: prev ? Math.min(tr.duration, maxTransitionDuration(prev, c)) : tr.duration } } as Clip;
        }
        default:
          return c;
      }
    }),
  );
  if (p.kind === 'transition') ps.selectTransition(clip.id);
  toast(T('“{name}” applied.', { name: p.name }));
  return true;
}
