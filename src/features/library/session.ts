/**
 * Editing session: which project is open, automatic saving, and moving
 * between the home screen and the editor.
 */
import { create } from 'zustand';
import type { AspectPreset, Project } from '../../types/project';
import { desktop } from '../../desktop/bridge';
import { engine } from '../../engine/playback/engine';
import { createProject, frameSize, projectDuration, withAspect } from '../../engine/timeline/model';
import { t as T } from '../../i18n';
import { getAssetFile, useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { uid } from '../../utils/id';
import { parseProjectFile, serializeProject } from '../project/projectFile';
import { library, requestPersistence, type ProjectMeta } from './library';

export type View = 'home' | 'editor';
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SessionState {
  view: View;
  currentId: string | null;
  createdAt: number;
  saveState: SaveState;
  /** Project object as last saved (identity = clean). */
  saved: Project | null;
  /** Bumped when the library changes (home screen reloads). */
  libraryVersion: number;
}

export const useSession = create<SessionState>(() => ({
  view: 'home',
  currentId: null,
  createdAt: 0,
  saveState: 'idle',
  saved: null,
  libraryVersion: 0,
}));

const AUTOSAVE_MS = 1000;
let timer = 0;
let inflight: Promise<void> | null = null;

export function hasUnsavedChanges(): boolean {
  const s = useSession.getState();
  if (!s.currentId) return false;
  return useProjectStore.getState().project !== s.saved || s.saveState === 'saving';
}

/** Small thumbnail from the first visual clip's poster (falls back to the background colour). */
async function makeThumb(project: Project): Promise<string | undefined> {
  const assets = useMediaStore.getState().assets;
  const { width, height } = frameSize(project.settings);
  const c = document.createElement('canvas');
  const k = 240 / Math.max(width, height);
  c.width = Math.max(1, Math.round(width * k));
  c.height = Math.max(1, Math.round(height * k));
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = project.settings.background;
  ctx.fillRect(0, 0, c.width, c.height);
  const clips = Object.values(project.clips).sort((a, b) => a.start - b.start);
  const first = clips.find((cl) => cl.type === 'media' && assets[cl.assetId]?.thumbUrl && assets[cl.assetId]?.kind !== 'audio');
  const url = first && first.type === 'media' ? assets[first.assetId]?.thumbUrl : undefined;
  if (url) {
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
      ctx.drawImage(img, (c.width - img.naturalWidth * s) / 2, (c.height - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
    } catch {
      /* keep background */
    }
  } else if (clips.some((cl) => cl.type === 'text')) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(c.width * 0.2, c.height * 0.44, c.width * 0.6, c.height * 0.12);
  }
  return c.toDataURL('image/jpeg', 0.72);
}

/** Save the open project to the library now. */
export async function saveNow(): Promise<void> {
  clearTimeout(timer);
  const s = useSession.getState();
  if (!s.currentId) return;
  if (inflight) await inflight;
  const project = useProjectStore.getState().project;
  const assets = useMediaStore.getState().assets;
  const id = s.currentId;
  useSession.setState({ saveState: 'saving' });
  inflight = (async () => {
    try {
      const { width, height } = frameSize(project.settings);
      const meta: ProjectMeta = {
        id,
        name: project.settings.name,
        createdAt: s.createdAt || Date.now(),
        updatedAt: Date.now(),
        duration: projectDuration(project),
        width,
        height,
        clipCount: Object.keys(project.clips).length,
        thumb: await makeThumb(project),
      };
      const { text } = serializeProject(project, assets, false);
      const media = desktop
        ? []
        : Object.keys(assets)
            .map((aid) => ({ id: aid, file: getAssetFile(aid) }))
            .filter((m): m is { id: string; file: File } => !!m.file);
      await library.save(meta, text, media);
      if (useSession.getState().currentId === id)
        useSession.setState((st) => ({ saveState: 'saved', saved: project, libraryVersion: st.libraryVersion + 1 }));
    } catch (e) {
      useSession.setState({ saveState: 'error' });
      const quota = (e as Error)?.name === 'QuotaExceededError';
      useUIStore.getState().toast(T(quota ? 'Not enough storage on this device to save the project.' : 'Could not save the project.'), 'error');
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}

function scheduleSave(): void {
  const s = useSession.getState();
  if (s.view !== 'editor' || !s.currentId) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void saveNow(), AUTOSAVE_MS);
}

function resetEditor(project: Project): void {
  engine.clock.pause();
  useMediaStore.getState().clear();
  useProjectStore.getState().load(project);
  engine.seek(0);
}

export interface NewProjectOptions {
  aspect: AspectPreset;
  customWidth?: number;
  customHeight?: number;
}

export async function newProject(opts: NewProjectOptions): Promise<void> {
  void requestPersistence();
  const p = createProject();
  let settings = { ...p.settings };
  if (opts.aspect === 'custom') settings = { ...withAspect(settings, 'custom'), customWidth: opts.customWidth, customHeight: opts.customHeight };
  else settings.aspect = opts.aspect;
  const project = { ...p, settings };
  resetEditor(project);
  useSession.setState({ view: 'editor', currentId: uid('prj'), createdAt: Date.now(), saveState: 'idle', saved: null });
  await saveNow();
}

export async function openFromLibrary(id: string): Promise<boolean> {
  const toast = useUIStore.getState().toast;
  const data = await library.load(id).catch(() => null);
  if (!data) {
    toast(T('Could not open the project.'), 'error');
    return false;
  }
  let parsed;
  try {
    parsed = parseProjectFile(data.text);
  } catch {
    toast(T('Could not open the project.'), 'error');
    return false;
  }
  resetEditor(parsed.project);
  useSession.setState({ view: 'editor', currentId: id, createdAt: data.meta.createdAt, saveState: 'saved', saved: useProjectStore.getState().project });
  if (desktop) {
    const exists = await desktop.mediaExists(parsed.assets.map((a) => a.path));
    await desktop.registerMedia(parsed.assets.filter((_, i) => exists[i]).map((a) => a.path));
    void useMediaStore.getState().loadFromPaths(parsed.assets.map((a, i) => ({ ...a, exists: exists[i] })));
    const missing = exists.filter((x) => !x).length;
    if (missing) toast(T('{n} media file(s) could not be found and were skipped.', { n: missing }), 'error');
  } else {
    void useMediaStore.getState().loadFromFiles(parsed.assets.map((a) => ({ ...a, file: data.media.get(a.id) ?? null })));
  }
  return true;
}

/** Return to the home screen, saving first. Empty, untouched projects are not kept. */
export async function goHome(): Promise<void> {
  const s = useSession.getState();
  engine.clock.pause();
  if (s.currentId) {
    const project = useProjectStore.getState().project;
    const empty = Object.keys(project.clips).length === 0 && useMediaStore.getState().order.length === 0;
    if (empty) await library.remove(s.currentId).catch(() => undefined);
    else if (hasUnsavedChanges()) await saveNow();
  }
  resetEditor(createProject());
  useSession.setState((st) => ({ view: 'home', currentId: null, saved: null, saveState: 'idle', libraryVersion: st.libraryVersion + 1 }));
}

/** Start in the editor with a fresh, unsaved-to-library project (used by automated tests via ?debug). */
export function startScratch(): void {
  useSession.setState({ view: 'editor', currentId: uid('prj'), createdAt: Date.now(), saveState: 'idle', saved: null });
}

export function initSession(): void {
  useProjectStore.subscribe((st, prev) => {
    if (st.project !== prev.project) scheduleSave();
  });
  useMediaStore.subscribe((st, prev) => {
    if (st.order !== prev.order) scheduleSave();
  });
  // Save as soon as the app goes to the background or the page is closing
  // (iPad: switching apps; desktop: closing the tab). The unload warning stays
  // up while a save is still pending.
  const flush = () => {
    if (hasUnsavedChanges()) void saveNow();
  };
  document.addEventListener('visibilitychange', () => document.hidden && flush());
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  window.addEventListener('king:home', () => void goHome());
  window.addEventListener('king:save', () => {
    if (useSession.getState().currentId) void saveNow().then(() => useUIStore.getState().toast(T('Project saved.')));
  });
}
