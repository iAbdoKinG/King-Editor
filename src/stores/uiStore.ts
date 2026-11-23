import { create } from 'zustand';

import { storage } from '../utils/storage';

export type PreviewQuality = 'full' | 'half' | 'quarter';
/** Simple shows the essentials; Pro shows every control and the pro effects. */
export type EditorMode = 'simple' | 'pro';
/** 'gpu' shows media elements directly (smooth); 'canvas' draws every frame into a canvas. */
export type PreviewRenderer = 'gpu' | 'canvas';
export type Sheet = 'media' | 'inspector' | null;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export interface ContextMenuState {
  clipId: string;
  x: number;
  y: number;
}

interface UIState {
  pxPerSec: number;
  focusMode: boolean;
  libraryOpen: boolean;
  inspectorOpen: boolean;
  sheet: Sheet;
  snapping: boolean;
  quality: PreviewQuality;
  mode: EditorMode;
  setMode: (m: EditorMode) => void;
  renderer: PreviewRenderer;
  showStats: boolean;
  exportOpen: boolean;
  themeOpen: boolean;
  presetsOpen: boolean;
  shortcutsOpen: boolean;
  downloadOpen: boolean;
  contextMenu: ContextMenuState | null;
  toasts: Toast[];
  set: (patch: Partial<Omit<UIState, 'set' | 'toast' | 'zoomBy' | 'setMode'>>) => void;
  zoomBy: (factor: number) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 480;

let toastId = 0;

export const useUIStore = create<UIState>((set, get) => ({
  pxPerSec: 60,
  focusMode: false,
  libraryOpen: true,
  inspectorOpen: true,
  sheet: null,
  snapping: true,
  quality: 'half',
  mode: storage.get<EditorMode>('mode') === 'pro' ? 'pro' : 'simple',
  setMode: (mode) => {
    storage.set('mode', mode);
    set({ mode });
  },
  renderer: 'gpu',
  showStats: false,
  exportOpen: false,
  themeOpen: false,
  presetsOpen: false,
  shortcutsOpen: false,
  downloadOpen: false,
  contextMenu: null,
  toasts: [],
  set: (patch) => set(patch),
  zoomBy: (f) =>
    set({ pxPerSec: Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, get().pxPerSec * f)) }),
  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === 'error' ? 5200 : 2800);
  },
}));
