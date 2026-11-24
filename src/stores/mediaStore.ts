/**
 * Session media library. Files stay on the device: in the browser as object
 * URLs, in the desktop app streamed from disk. Nothing is uploaded or cached
 * by the service worker.
 */
import { create } from 'zustand';
import type { MediaAsset } from '../types/project';
import { uid } from '../utils/id';
import { detectKind, makeThumbnail, probe } from '../features/media/probe';
import { requestWaveform } from '../features/media/waveform';
import { desktop, mediaUrl } from '../desktop/bridge';
import { conversionMessage, convertInBrowser, needsConversion } from '../features/media/convert';

export type PathEntry = Pick<MediaAsset, 'id' | 'kind' | 'name' | 'size' | 'mime'> & { path: string; exists: boolean };

interface MediaState {
  assets: Record<string, MediaAsset>;
  order: string[];
  importFiles: (files: FileList | File[]) => Promise<{ added: string[]; rejected: string[] }>;
  /** Desktop: load assets referenced by a project file (streamed from disk). */
  loadFromPaths: (entries: PathEntry[]) => Promise<void>;
  /** Browser library: load stored media files, keeping their asset ids. */
  loadFromFiles: (entries: Array<Pick<MediaAsset, 'id' | 'kind' | 'name' | 'size' | 'mime'> & { file: File | null }>) => Promise<void>;
  clear: () => void;
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

export const useMediaStore = create<MediaState>((set, get) => {
  const patch = (id: string, p: Partial<MediaAsset>) =>
    set((s) => (s.assets[id] ? { assets: { ...s.assets, [id]: { ...s.assets[id], ...p } } } : s));

  /**
   * Make an asset playable: files the browser cannot play directly (TS, MKV,
   * AVI, WMV, …) are converted on this device to MP4/M4A first. Desktop uses
   * the bundled native FFmpeg; the browser uses WebCodecs or FFmpeg.wasm.
   */
  async function convert(id: string): Promise<boolean> {
    const a = get().assets[id];
    if (!a || a.kind === 'image') return false;
    patch(id, { status: 'converting', progress: 0, error: undefined });
    const onProgress = (p: number) => {
      const cur = get().assets[id];
      if (cur && cur.status === 'converting' && Math.abs((cur.progress ?? 0) - p) >= 0.01) patch(id, { progress: p });
    };
    try {
      if (a.path && desktop?.convertMedia) {
        let r = await desktop.convertMedia(a.path, a.kind, onProgress);
        const original = fileStore.get(id);
        if (!r.path && original && desktop.saveConverted) {
          // Native FFmpeg could not read it: convert in the page, keep the result on disk.
          onProgress(0);
          const out = await convertInBrowser(original, a.kind, onProgress);
          r = await desktop.saveConverted(a.path, a.kind, await out.arrayBuffer());
        }
        if (!r.path) throw new Error(r.error ?? 'failed');
        if (!get().assets[id]) return false;
        if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
        fileStore.delete(id); // stream the converted file from disk
        const name = r.path.split(/[\\/]/).pop() ?? a.name;
        patch(id, { path: r.path, url: mediaUrl(r.path), size: r.size ?? a.size, mime: a.kind === 'audio' ? 'audio/mp4' : 'video/mp4', name: name.replace(/-[0-9a-f]{10}(\.\w+)$/, '$1'), status: 'loading', progress: undefined });
        return true;
      }
      const file = fileStore.get(id);
      if (!file) throw new Error('failed');
      const out = await convertInBrowser(file, a.kind, onProgress);
      if (!get().assets[id]) return false;
      if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
      fileStore.set(id, out);
      patch(id, { url: URL.createObjectURL(out), name: out.name, size: out.size, mime: out.type, status: 'loading', progress: undefined });
      return true;
    } catch (e) {
      if (get().assets[id]) patch(id, { status: 'error', progress: undefined, error: conversionMessage(e) });
      return false;
    }
  }

  /** Probe metadata, then thumbnail and waveform in the background. */
  async function analyze(id: string, converted = false): Promise<void> {
    let a = get().assets[id];
    if (!a) return;
    const file = fileStore.get(id);
    if (!converted && a.kind !== 'image' && needsConversion(file ?? ({ name: a.path ?? a.name } as File), a.kind)) {
      if (!(await convert(id))) return;
      converted = true;
      a = get().assets[id];
      if (!a) return;
    }
    try {
      const meta = await probe(a.url, a.kind);
      if (!get().assets[id]) return;
      patch(id, { ...meta, status: 'ready' });
      const data = fileStore.get(id) ?? (a.path ? a.url : undefined);
      if (data) requestWaveform(get().assets[id], data);
      const thumbUrl = await makeThumbnail(a.url, meta.kind, meta.duration);
      if (!thumbUrl) return;
      if (!get().assets[id]) {
        URL.revokeObjectURL(thumbUrl);
        return;
      }
      patch(id, { thumbUrl });
    } catch (e) {
      if (!get().assets[id]) return;
      // A supported container with a codec this browser cannot play (e.g. HEVC, ProRes): convert once.
      if (!converted && a.kind !== 'image' && (await convert(id))) return analyze(id, true);
      if (!get().assets[id] || get().assets[id].status === 'error') return;
      const msg = (e as Error).message === 'timeout' ? 'Timed out reading this file.' : 'This browser cannot decode this file format.';
      patch(id, { status: 'error', error: msg });
    }
  }

  return {
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
        const path = desktop?.pathForFile(file) ?? undefined;
        if (path) void desktop!.registerMedia([path]);
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
          path,
          status: 'loading',
        };
        fileStore.set(id, file);
        set((s) => ({ assets: { ...s.assets, [id]: asset }, order: [...s.order, id] }));
        added.push(id);
      }
      await Promise.all(added.map((id) => analyze(id)));
      return { added, rejected };
    },

    loadFromPaths: async (entries) => {
      for (const e of entries) {
        const asset: MediaAsset = {
          id: e.id,
          kind: e.kind,
          name: e.name,
          size: e.size,
          mime: e.mime,
          url: e.exists ? mediaUrl(e.path) : '',
          duration: 0,
          width: 0,
          height: 0,
          path: e.path,
          status: e.exists ? 'loading' : 'error',
          error: e.exists ? undefined : 'File not found.',
        };
        set((s) => ({ assets: { ...s.assets, [e.id]: asset }, order: [...s.order, e.id] }));
      }
      await Promise.all(entries.filter((e) => e.exists).map((e) => analyze(e.id)));
    },

    loadFromFiles: async (entries) => {
      for (const e of entries) {
        const asset: MediaAsset = {
          id: e.id,
          kind: e.kind,
          name: e.name,
          size: e.size,
          mime: e.mime,
          url: e.file ? URL.createObjectURL(e.file) : '',
          duration: 0,
          width: 0,
          height: 0,
          status: e.file ? 'loading' : 'error',
          error: e.file ? undefined : 'File not found.',
        };
        if (e.file) fileStore.set(e.id, e.file);
        set((s) => ({ assets: { ...s.assets, [e.id]: asset }, order: [...s.order, e.id] }));
      }
      await Promise.all(entries.filter((e) => e.file).map((e) => analyze(e.id)));
    },

    clear: () => {
      for (const id of [...get().order]) get().remove(id);
    },

    remove: (id) => {
      const a = get().assets[id];
      if (!a) return;
      for (const fn of releaseHooks) fn(a);
      if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
      fileStore.delete(id);
      if (a.thumbUrl) URL.revokeObjectURL(a.thumbUrl);
      set((s) => {
        const assets = { ...s.assets };
        delete assets[id];
        return { assets, order: s.order.filter((x) => x !== id) };
      });
    },
  };
});
