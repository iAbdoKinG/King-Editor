/**
 * Project state with snapshot-based undo/redo.
 *
 * Continuous gestures (dragging, slider scrubbing) call `begin()` once, then
 * apply live updates with `commit: false`, and finally `end()` which records a
 * single history entry. Snapshots share structure, so history is cheap.
 */
import { create } from 'zustand';
import type { Project } from '../types/project';
import { createProject } from '../engine/timeline/model';

const MAX_HISTORY = 100;

interface ProjectState {
  project: Project;
  past: Project[];
  future: Project[];
  selectedClipId: string | null;
  selectedTrackId: string | null;
  /** Id of the clip whose incoming transition is selected. */
  selectedTransitionId: string | null;
  /** Snapshot taken at the start of a continuous gesture. */
  txBase: Project | null;

  apply: (fn: (p: Project) => Project, opts?: { commit?: boolean }) => void;
  begin: () => void;
  end: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  /** Replace the whole project (open file / new project); clears history and selection. */
  load: (project: Project) => void;
  select: (clipId: string | null) => void;
  selectTrack: (trackId: string | null) => void;
  selectTransition: (clipId: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  selectedClipId: null,
  selectedTrackId: null,
  selectedTransitionId: null,
  txBase: null,

  apply: (fn, opts) => {
    const { project, past, txBase } = get();
    const next = fn(project);
    if (next === project) return;
    const commit = opts?.commit !== false && !txBase;
    set({
      project: next,
      ...(commit ? { past: [...past, project].slice(-MAX_HISTORY), future: [] } : null),
    });
  },

  begin: () => {
    if (!get().txBase) set({ txBase: get().project });
  },

  end: () => {
    const { txBase, project, past } = get();
    if (!txBase) return;
    if (txBase !== project) set({ txBase: null, past: [...past, txBase].slice(-MAX_HISTORY), future: [] });
    else set({ txBase: null });
  },

  cancel: () => {
    const { txBase } = get();
    if (txBase) set({ project: txBase, txBase: null });
  },

  undo: () => {
    const { past, project, future, txBase } = get();
    if (txBase || !past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], ...validSelection(prev, get()) });
  },

  redo: () => {
    const { past, project, future, txBase } = get();
    if (txBase || !future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), ...validSelection(next, get()) });
  },

  load: (project) => set({ project, past: [], future: [], txBase: null, selectedClipId: null, selectedTrackId: null, selectedTransitionId: null }),

  select: (clipId) => {
    const clip = clipId ? get().project.clips[clipId] : null;
    set({
      selectedClipId: clip ? clipId : null,
      selectedTrackId: clip ? clip.trackId : get().selectedTrackId,
      selectedTransitionId: null,
    });
  },

  selectTrack: (trackId) => set({ selectedTrackId: trackId }),

  selectTransition: (clipId) => {
    const clip = clipId ? get().project.clips[clipId] : null;
    set({ selectedTransitionId: clip?.transitionIn ? clip.id : null, selectedClipId: null });
  },
}));

function validSelection(p: Project, s: ProjectState): Partial<ProjectState> {
  return {
    selectedClipId: s.selectedClipId && p.clips[s.selectedClipId] ? s.selectedClipId : null,
    selectedTrackId: s.selectedTrackId && p.tracks.some((t) => t.id === s.selectedTrackId) ? s.selectedTrackId : null,
    selectedTransitionId:
      s.selectedTransitionId && p.clips[s.selectedTransitionId]?.transitionIn ? s.selectedTransitionId : null,
  };
}
