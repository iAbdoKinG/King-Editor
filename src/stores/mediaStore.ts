/**
 * Session-only media library. Files stay on the device as object URLs and are
 * never uploaded or cached by the service worker.
 */
import { create } from 'zustand';
import type { MediaAsset } from '../types/project';
import { uid } from '../utils/id';
import { detectKind, makeThumbnail, probe } from '../features/media/probe';
import { requestWaveform } from '../features/media/waveform';

interface MediaState {
  assets: Record<string, MediaAsset>;
  order: string[];
  importFiles: (files: FileList | File[]) => Promise<{ added: string[]; rejected: string[] }>;
  remove: (id: string) => void;
}

/** Original File objects, kept outside React state (needed for frame-accurate export decoding). */
const fileStore = new Map<string, File>();
export function getAssetFile(id: string): File | undefined {
  return fileStore.get(id);
}

/** Hooks other modules register to free resources tied to an asset. */
const releaseHooks: Array<(asset: MediaAsset) => void> = [];
export function onAssetReleased(fn: (asset: MediaAsset) => void): void {
  releaseHooks.push(fn);
}

export const useMediaStore = create<MediaState>((set, get) => ({
  assets: {},
  order: [],

  importFiles: async (list) => {
    const files = Array.from(list);
    const added: string[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const kind = detectKind(file);
      if (!kind) {
        rejected.push(file.name);
        continue;
      }
      const id = uid('ast');
      const asset: MediaAsset = {
        id,
        kind,
        name: file.name,
        size: file.size,
        mime: file.type,
        url: URL.createObjectURL(file),
        duration: 0,
        width: 0,
        height: 0,
        status: 'loading',
      };
      fileStore.set(id, file);
      set((s) => ({ assets: { ...s.assets, [id]: asset }, order: [...s.order, id] }));
      added.push(id);
    }
    await Promise.all(
      added.map(async (id) => {
        const a = get().assets[id];
        try {
          const meta = await probe(a.url, a.kind);
          if (!get().assets[id]) return;
          set((s) => ({ assets: { ...s.assets, [id]: { ...s.assets[id], ...meta, status: 'ready' } } }));
          const f = fileStore.get(id);
          if (f) requestWaveform(get().assets[id], f);
          const thumbUrl = await makeThumbnail(a.url, meta.kind, meta.duration);
          if (!thumbUrl) return;
          if (!get().assets[id]) {
            URL.revokeObjectURL(thumbUrl);
            return;
          }
          set((s) => ({ assets: { ...s.assets, [id]: { ...s.assets[id], thumbUrl } } }));
        } catch (e) {
          if (!get().assets[id]) return;
          const msg =
            (e as Error).message === 'timeout'
              ? 'Timed out reading this file.'
              : 'This browser cannot decode this file format.';
          set((s) => ({ assets: { ...s.assets, [id]: { ...s.assets[id], status: 'error', error: msg } } }));
        }
      }),
    );
    return { added, rejected };
  },

  remove: (id) => {
    const a = get().assets[id];
    if (!a) return;
    for (const fn of releaseHooks) fn(a);
    URL.revokeObjectURL(a.url);
    fileStore.delete(id);
    if (a.thumbUrl) URL.revokeObjectURL(a.thumbUrl);
    set((s) => {
      const assets = { ...s.assets };
      delete assets[id];
      return { assets, order: s.order.filter((x) => x !== id) };
    });
  },
}));
