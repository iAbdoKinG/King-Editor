/** Save / open projects in the desktop app. */
import { create } from 'zustand';
import { desktop } from '../../desktop/bridge';
import { engine } from '../../engine/playback/engine';
import { t as T } from '../../i18n';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { Project } from '../../types/project';
import { parseProjectFile, serializeProject } from './projectFile';

interface FileState {
  path: string | null;
  /** The project object as last saved/opened (identity comparison = dirty check). */
  saved: Project | null;
}

export const useProjectFileStore = create<FileState>(() => ({ path: null, saved: null }));

export function isDirty(): boolean {
  const { project } = useProjectStore.getState();
  const saved = useProjectFileStore.getState().saved;
  return saved ? project !== saved : Object.keys(project.clips).length > 0 || useMediaStore.getState().order.length > 0;
}

export async function saveProject(saveAs = false): Promise<void> {
  if (!desktop) return;
  const toast = useUIStore.getState().toast;
  const { project } = useProjectStore.getState();
  const { text, unsaved } = serializeProject(project, useMediaStore.getState().assets);
  const path = await desktop.saveProject(text, project.settings.name, saveAs ? null : useProjectFileStore.getState().path);
  if (!path) return;
  useProjectFileStore.setState({ path, saved: project });
  toast(T('Project saved.'));
  if (unsaved.length) toast(T('{n} media file(s) could not be found and were skipped.', { n: unsaved.length }), 'error');
}

export async function openProject(): Promise<void> {
  if (!desktop) return;
  const toast = useUIStore.getState().toast;
  if (isDirty() && !window.confirm(T('Replace the current project? Unsaved changes will be lost.'))) return;
  const file = await desktop.openProject();
  if (!file) return;
  let parsed;
  try {
    parsed = parseProjectFile(file.text);
  } catch (e) {
    toast(T((e as Error).message), 'error');
    return;
  }
  engine.clock.pause();
  const exists = await desktop.mediaExists(parsed.assets.map((a) => a.path));
  useMediaStore.getState().clear();
  useProjectStore.getState().load(parsed.project);
  engine.seek(0);
  useProjectFileStore.setState({ path: file.path, saved: useProjectStore.getState().project });
  await desktop.registerMedia(parsed.assets.filter((_, i) => exists[i]).map((a) => a.path));
  void useMediaStore.getState().loadFromPaths(parsed.assets.map((a, i) => ({ ...a, exists: exists[i] })));
  const missing = exists.filter((x) => !x).length;
  toast(T('Project opened.'));
  if (missing) toast(T('{n} media file(s) could not be found and were skipped.', { n: missing }), 'error');
}

/** Wire up desktop-only behaviour: file-association opens. */
export function initDesktopProjects(): void {
  if (!desktop) return;
  void desktop.hasPendingProject().then((p) => {
    if (p) void openProject();
  });
  desktop.onOpenRequest(() => void openProject());
}
