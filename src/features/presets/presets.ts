/**
 * User presets, saved on this device (localStorage) and shareable as a link
 * or a small `.kingpreset` file. Imported data is validated and clamped field by
 * field: presets are plain values only.
 */
import { create } from 'zustand';
import type { Easing, Effects, Keyframe, Keyframes, TextStyle, Transition } from '../../types/project';
import type { ThemeColors } from '../../app/theme';
import { defaultEffects } from '../../engine/timeline/model';
import { ANIM_PROPS } from '../../engine/timeline/animation';
import { TRANSITION_TYPES } from '../../engine/timeline/transitions';
import { storage } from '../../utils/storage';
import { uid } from '../../utils/id';

export type PresetKind = 'effects' | 'textStyle' | 'transition' | 'animation' | 'theme';

export interface PresetDataMap {
  effects: Effects;
  textStyle: TextStyle;
  transition: Transition;
  animation: Keyframes;
  theme: ThemeColors;
}

export interface Preset<K extends PresetKind = PresetKind> {
  id: string;
  kind: K;
  name: string;
  data: PresetDataMap[K];
  createdAt: number;
}

export const KIND_LABEL: Record<PresetKind, string> = {
  effects: 'Color & effects',
  textStyle: 'Text styles',
  transition: 'Transitions',
  animation: 'Animations',
  theme: 'Themes',
};

/* ----------------------------- validation ----------------------------- */

const num = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const color = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v) ? v : def);
const str = (v: unknown, max: number, def: string) => (typeof v === 'string' ? v.slice(0, max) : def);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const;

function cleanEffects(d: Record<string, unknown>): Effects {
  const e = defaultEffects();
  return {
    brightness: num(d.brightness, 0, 200, e.brightness),
    contrast: num(d.contrast, 0, 200, e.contrast),
    saturation: num(d.saturation, 0, 200, e.saturation),
    blur: num(d.blur, 0, 40, e.blur),
    hue: num(d.hue, -180, 180, 0),
    sepia: num(d.sepia, 0, 100, 0),
    grayscale: num(d.grayscale, 0, 100, 0),
    vignette: num(d.vignette, 0, 100, 0),
  };
}

function cleanTextStyle(d: Record<string, unknown>): TextStyle {
  return {
    fontFamily: str(d.fontFamily, 80, 'Inter Variable').replace(/[^\p{L}\p{N} _-]/gu, ''),
    fontSize: num(d.fontSize, 8, 600, 96),
    fontWeight: oneOf(d.fontWeight as never, [400, 600, 800] as never, 800 as never),
    color: color(d.color, '#F2F4F5'),
    align: oneOf(d.align, ['left', 'center', 'right'] as const, 'center'),
    shadow: d.shadow === true,
    background: d.background === null ? null : typeof d.background === 'string' ? color(d.background, '#15191DCC') : null,
  };
}

function cleanTransition(d: Record<string, unknown>): Transition {
  return {
    type: oneOf(d.type, TRANSITION_TYPES.map((t) => t.value), 'dissolve'),
    duration: num(d.duration, 0.05, 4, 0.5),
    direction: oneOf(d.direction, ['left', 'right', 'up', 'down'] as const, 'left'),
    easing: oneOf(d.easing, EASINGS, 'easeInOut'),
  };
}

function cleanAnimation(d: Record<string, unknown>): Keyframes {
  const out: Keyframes = {};
  for (const p of ANIM_PROPS) {
    const list = d[p];
    if (!Array.isArray(list)) continue;
    const kfs: Keyframe[] = list.slice(0, 200).map((k: Record<string, unknown>) => ({
      t: num(k?.t, -3600, 3600, 0),
      v: num(k?.v, -100000, 100000, 0),
      ease: oneOf(k?.ease, EASINGS, 'linear') as Easing,
    }));
    if (kfs.length) out[p] = kfs.sort((a, b) => a.t - b.t);
  }
  return out;
}

function cleanTheme(d: Record<string, unknown>): ThemeColors {
  const keys: Array<keyof ThemeColors> = ['bg', 'surface', 'elevated', 'accent', 'text', 'muted', 'line', 'video', 'audio', 'textClip'];
  const out = {} as ThemeColors;
  for (const k of keys) out[k] = color(d[k], '#808080');
  return out;
}

const CLEAN: { [K in PresetKind]: (d: Record<string, unknown>) => PresetDataMap[K] } = {
  effects: cleanEffects,
  textStyle: cleanTextStyle,
  transition: cleanTransition,
  animation: cleanAnimation,
  theme: cleanTheme,
};

export function sanitizePreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = oneOf(r.kind, Object.keys(CLEAN) as PresetKind[], null as unknown as PresetKind);
  if (!kind || !r.data || typeof r.data !== 'object') return null;
  return {
    id: uid('pre'),
    kind,
    name: str(r.name, 60, 'Preset').trim() || 'Preset',
    data: CLEAN[kind](r.data as Record<string, unknown>),
    createdAt: Date.now(),
  };
}

/* ----------------------------- store ----------------------------- */

interface PresetState {
  presets: Preset[];
  add: <K extends PresetKind>(kind: K, name: string, data: PresetDataMap[K]) => Preset<K>;
  addMany: (list: Preset[]) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const persist = (presets: Preset[]) => storage.set('presets', presets);

export const usePresetStore = create<PresetState>((set, get) => ({
  presets: (storage.get<unknown[]>('presets') ?? []).map(sanitizePreset).filter((p): p is Preset => !!p),
  add: (kind, name, data) => {
    const p = { id: uid('pre'), kind, name: name.slice(0, 60) || 'Preset', data: structuredClone(data), createdAt: Date.now() };
    const presets = [p as Preset, ...get().presets];
    set({ presets });
    persist(presets);
    return p;
  },
  addMany: (list) => {
    const presets = [...list, ...get().presets];
    set({ presets });
    persist(presets);
  },
  rename: (id, name) => {
    const presets = get().presets.map((p) => (p.id === id ? { ...p, name: name.slice(0, 60) } : p));
    set({ presets });
    persist(presets);
  },
  remove: (id) => {
    const presets = get().presets.filter((p) => p.id !== id);
    set({ presets });
    persist(presets);
  },
}));

/* ----------------------------- sharing ----------------------------- */

interface Bundle {
  app: 'king-editor';
  v: 1;
  presets: Array<Pick<Preset, 'kind' | 'name' | 'data'>>;
}

export function toBundle(list: Preset[]): Bundle {
  return { app: 'king-editor', v: 1, presets: list.map(({ kind, name, data }) => ({ kind, name, data })) };
}

export function parseBundle(text: string): Preset[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a KING EDITOR preset file.');
  }
  const b = raw as Partial<Bundle>;
  if (!b || b.app !== 'king-editor' || !Array.isArray(b.presets)) throw new Error('This is not a KING EDITOR preset file.');
  const out = b.presets.slice(0, 200).map(sanitizePreset).filter((p): p is Preset => !!p);
  if (!out.length) throw new Error('No valid presets found.');
  return out;
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A link that opens KING EDITOR and offers to import the presets. Data lives in the URL fragment (never sent to a server). */
export function shareLink(list: Preset[]): string {
  const base = location.href.split('#')[0];
  return `${base}#presets=${b64urlEncode(JSON.stringify(toBundle(list)))}`;
}

export function presetsFromLocation(): Preset[] | null {
  const m = location.hash.match(/presets=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    return parseBundle(b64urlDecode(m[1]));
  } catch {
    return null;
  }
}

export function presetFile(list: Preset[], name = 'presets'): File {
  const safe = name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'presets';
  return new File([JSON.stringify(toBundle(list), null, 2)], `${safe}.kingpreset`, { type: 'application/json' });
}
