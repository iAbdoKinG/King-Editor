/**
 * Project library: projects saved on this device and listed on the home
 * screen.
 *   Browser: IndexedDB (project + a copy of each media file, stored once).
 *   Desktop: files in Documents/Qissa/Projects (media referenced by path).
 * Nothing is ever uploaded.
 */
import type { MediaKind } from '../../types/project';
import { desktop } from '../../desktop/bridge';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Seconds. */
  duration: number;
  width: number;
  height: number;
  clipCount: number;
  /** Small JPEG data URL. */
  thumb?: string;
}

export interface StoredAsset {
  id: string;
  kind: MediaKind;
  name: string;
  size: number;
  mime: string;
  /** Browser: the stored media file. */
  file?: File;
  /** Desktop: original path on disk. */
  path?: string;
  exists: boolean;
}

export interface Library {
  list(): Promise<ProjectMeta[]>;
  /** `text` is a serialized project; `media` are files to store if not stored yet (browser). */
  save(meta: ProjectMeta, text: string, media: Array<{ id: string; file: File }>): Promise<void>;
  load(id: string): Promise<{ meta: ProjectMeta; text: string; media: Map<string, File> } | null>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string, newId: string, name: string): Promise<void>;
}

/* ----------------------------- IndexedDB (browser) ----------------------------- */

const DB_NAME = 'qissa-library';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => {
        dbPromise = null;
        reject(open.error);
      };
    });
  }
  return dbPromise;
}

interface ProjectRow {
  id: string;
  meta: ProjectMeta;
  text: string;
  mediaIds: string[];
}

interface MediaRow {
  id: string;
  blob: Blob;
  name: string;
  type: string;
}

const browserLibrary: Library = {
  async list() {
    const d = await db();
    const rows = await req<ProjectRow[]>(d.transaction('projects').objectStore('projects').getAll());
    return rows.map((r) => r.meta).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async save(meta, text, media) {
    const d = await db();
    // Store media first (each file once), then the project that references it.
    const existing = new Set(await req<IDBValidKey[]>(d.transaction('media').objectStore('media').getAllKeys()));
    for (const m of media) {
      if (existing.has(m.id)) continue;
      const row: MediaRow = { id: m.id, blob: m.file, name: m.file.name, type: m.file.type };
      await req(d.transaction('media', 'readwrite').objectStore('media').put(row));
    }
    const row: ProjectRow = { id: meta.id, meta, text, mediaIds: media.map((m) => m.id) };
    await req(d.transaction('projects', 'readwrite').objectStore('projects').put(row));
  },

  async load(id) {
    const d = await db();
    const row = await req<ProjectRow | undefined>(d.transaction('projects').objectStore('projects').get(id));
    if (!row) return null;
    const media = new Map<string, File>();
    const store = d.transaction('media').objectStore('media');
    for (const mid of row.mediaIds) {
      const m = await req<MediaRow | undefined>(store.get(mid));
      if (m) media.set(mid, new File([m.blob], m.name, { type: m.type }));
    }
    return { meta: row.meta, text: row.text, media };
  },

  async remove(id) {
    const d = await db();
    const all = await req<ProjectRow[]>(d.transaction('projects').objectStore('projects').getAll());
    const target = all.find((r) => r.id === id);
    if (!target) return;
    const stillUsed = new Set(all.filter((r) => r.id !== id).flatMap((r) => r.mediaIds));
    const tx = d.transaction(['projects', 'media'], 'readwrite');
    tx.objectStore('projects').delete(id);
    for (const mid of target.mediaIds) if (!stillUsed.has(mid)) tx.objectStore('media').delete(mid);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async rename(id, name) {
    const d = await db();
    const row = await req<ProjectRow | undefined>(d.transaction('projects').objectStore('projects').get(id));
    if (!row) return;
    row.meta = { ...row.meta, name, updatedAt: Date.now() };
    try {
      const parsed = JSON.parse(row.text);
      parsed.project.settings.name = name;
      row.text = JSON.stringify(parsed);
    } catch {
      /* keep text */
    }
    await req(d.transaction('projects', 'readwrite').objectStore('projects').put(row));
  },

  async duplicate(id, newId, name) {
    const d = await db();
    const row = await req<ProjectRow | undefined>(d.transaction('projects').objectStore('projects').get(id));
    if (!row) return;
    const now = Date.now();
    let text = row.text;
    try {
      const parsed = JSON.parse(text);
      parsed.project.settings.name = name;
      text = JSON.stringify(parsed);
    } catch {
      /* keep text */
    }
    const copy: ProjectRow = { ...row, id: newId, text, meta: { ...row.meta, id: newId, name, createdAt: now, updatedAt: now } };
    await req(d.transaction('projects', 'readwrite').objectStore('projects').put(copy));
  },
};

/* ----------------------------- Desktop (files) ----------------------------- */

interface DesktopLibraryBridge {
  libraryList(): Promise<ProjectMeta[]>;
  librarySave(meta: ProjectMeta, text: string): Promise<void>;
  libraryLoad(id: string): Promise<{ meta: ProjectMeta; text: string } | null>;
  libraryRemove(id: string): Promise<void>;
  libraryRename(id: string, name: string): Promise<void>;
  libraryDuplicate(id: string, newId: string, name: string): Promise<void>;
}

function desktopLibrary(b: DesktopLibraryBridge): Library {
  return {
    list: () => b.libraryList(),
    save: (meta, text) => b.librarySave(meta, text),
    async load(id) {
      const r = await b.libraryLoad(id);
      return r ? { ...r, media: new Map() } : null;
    },
    remove: (id) => b.libraryRemove(id),
    rename: (id, name) => b.libraryRename(id, name),
    duplicate: (id, newId, name) => b.libraryDuplicate(id, newId, name),
  };
}

export const library: Library = desktop ? desktopLibrary(desktop as unknown as DesktopLibraryBridge) : browserLibrary;

/** Ask the browser not to evict saved projects under storage pressure. */
export async function requestPersistence(): Promise<void> {
  try {
    if (!desktop && navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* best effort */
  }
}

export function isValidProjectId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
