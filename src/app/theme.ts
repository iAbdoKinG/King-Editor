/**
 * Themes: preset palettes plus a user-editable custom theme. Applied as CSS
 * variables (the design tokens Tailwind utilities read), persisted on this
 * device only.
 */
import { create } from 'zustand';
import { storage } from '../utils/storage';

export interface ThemeColors {
  bg: string;
  surface: string;
  elevated: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  video: string;
  audio: string;
  textClip: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  light?: boolean;
  colors: ThemeColors;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'studio',
    name: 'Studio',
    colors: { bg: '#0E1014', surface: '#161920', elevated: '#1F232C', accent: '#8B6CFF', text: '#F1F2F6', muted: '#8D94A6', line: '#2A2F3A', video: '#4A3F8C', audio: '#255E54', textClip: '#7E4634' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    colors: { bg: '#15191D', surface: '#22282E', elevated: '#2C343B', accent: '#91C1C5', text: '#F2F4F5', muted: '#9CAAB1', line: '#39434A', video: '#4F7477', audio: '#5A6F52', textClip: '#7A6A52' },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    colors: { bg: '#161616', surface: '#212121', elevated: '#2B2B2B', accent: '#8AB4F8', text: '#F1F1F1', muted: '#A3A3A3', line: '#3A3A3A', video: '#4A5F7E', audio: '#4E6A55', textClip: '#76664F' },
  },
  {
    id: 'desert',
    name: 'Desert',
    colors: { bg: '#1B1814', surface: '#26211B', elevated: '#312A22', accent: '#E3B261', text: '#F4EFE7', muted: '#AA9E8E', line: '#43392F', video: '#6E5A3E', audio: '#5C6B45', textClip: '#7D5C4A' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: { bg: '#0E1820', surface: '#15232E', elevated: '#1D2F3C', accent: '#5FC8D8', text: '#EEF6F8', muted: '#93AAB6', line: '#2B4150', video: '#2F6475', audio: '#3E6B5B', textClip: '#6B6250' },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    colors: { bg: '#111916', surface: '#1A2420', elevated: '#222F2A', accent: '#6FCF97', text: '#EEF5F1', muted: '#97ABA2', line: '#33443D', video: '#3E6B5A', audio: '#596C43', textClip: '#73654D' },
  },
  {
    id: 'rose',
    name: 'Rose',
    colors: { bg: '#1A1517', surface: '#251E21', elevated: '#30272B', accent: '#E79AB3', text: '#F6EEF1', muted: '#AE9CA3', line: '#45373D', video: '#6A4A5C', audio: '#5B6648', textClip: '#7C6050' },
  },
  {
    id: 'light',
    name: 'Light',
    light: true,
    colors: { bg: '#EEF1F4', surface: '#FFFFFF', elevated: '#E6EAEE', accent: '#2F7F86', text: '#15191D', muted: '#5D6A72', line: '#D3D9DE', video: '#8DB6B9', audio: '#A6C098', textClip: '#D2C09F' },
  },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function mixColors(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Fill derived colours (elevated, line, muted) from the four key colours of a custom theme. */
export function deriveCustom(base: Pick<ThemeColors, 'bg' | 'surface' | 'accent' | 'text'> & Partial<ThemeColors>): ThemeColors {
  const light = luminance(base.bg) > 0.4;
  return {
    elevated: mixColors(base.surface, base.text, light ? 0.06 : 0.07),
    line: mixColors(base.surface, base.text, light ? 0.16 : 0.14),
    muted: mixColors(base.text, base.bg, 0.38),
    video: mixColors(base.accent, base.bg, 0.45),
    audio: mixColors('#7FA86A', base.bg, 0.4),
    textClip: mixColors('#C2A273', base.bg, 0.4),
    ...base,
  } as ThemeColors;
}

interface ThemeState {
  themeId: string;
  custom: ThemeColors;
  setTheme: (id: string) => void;
  setCustom: (c: ThemeColors) => void;
}

const saved = storage.get<{ themeId: string; custom: ThemeColors }>('theme');

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: saved?.themeId ?? 'studio',
  custom: saved?.custom ?? deriveCustom({ bg: '#14161C', surface: '#1F232C', accent: '#C792EA', text: '#F2F2F7' }),
  setTheme: (themeId) => {
    set({ themeId });
    storage.set('theme', { themeId, custom: get().custom });
  },
  setCustom: (custom) => {
    set({ custom, themeId: 'custom' });
    storage.set('theme', { themeId: 'custom', custom });
  },
}));

export function currentColors(): { colors: ThemeColors; light: boolean } {
  const { themeId, custom } = useThemeStore.getState();
  if (themeId === 'custom') return { colors: custom, light: luminance(custom.bg) > 0.4 };
  const p = THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0];
  return { colors: p.colors, light: !!p.light };
}

export function applyTheme(): void {
  const { colors: c, light } = currentColors();
  const root = document.documentElement.style;
  const vars: Record<string, string> = {
    '--color-bg': c.bg,
    '--color-surface': c.surface,
    '--color-elevated': c.elevated,
    '--color-accent': c.accent,
    '--color-accent-strong': mixColors(c.accent, light ? '#000000' : '#FFFFFF', 0.18),
    '--color-text': c.text,
    '--color-muted': c.muted,
    '--color-line': c.line,
    '--color-video': c.video,
    '--color-audio': c.audio,
    '--color-text-clip': c.textClip,
    '--color-stage': light ? '#DDE2E6' : mixColors(c.bg, '#000000', 0.3),
    '--color-on-accent': luminance(c.accent) > 0.35 ? '#111417' : '#FFFFFF',
  };
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  root.colorScheme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.surface);
}

export function initTheme(): void {
  applyTheme();
  useThemeStore.subscribe(applyTheme);
}
