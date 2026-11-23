/**
 * Interface language. English strings are the keys; the Arabic dictionary
 * maps them to translations (missing keys fall back to English). Changing the
 * language remounts the UI tree (see main.tsx), so `t()` can be a plain
 * function usable anywhere, including outside React.
 *
 * In Arabic the page is right-to-left; the timeline, ruler and preview stay
 * left-to-right because time always flows left → right.
 */
import { create } from 'zustand';
import { storage } from '../utils/storage';
import { AR } from './ar';

export type Lang = 'en' | 'ar';

function initialLang(): Lang {
  const saved = storage.get<Lang>('lang');
  if (saved === 'en' || saved === 'ar') return saved;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export const useLangStore = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    storage.set('lang', lang);
    set({ lang });
  },
}));

/** Translate `s`, replacing `{name}` placeholders with `vars`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = useLangStore.getState().lang === 'ar' ? (AR[s] ?? s) : s;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

export function isArabic(): boolean {
  return useLangStore.getState().lang === 'ar';
}

let uiFontRequested = false;

export function applyLang(): void {
  const lang = useLangStore.getState().lang;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  if (lang === 'ar' && !uiFontRequested) {
    uiFontRequested = true;
    // Arabic UI font (bundled, loaded on demand).
    void import('../features/fonts/fonts').then((f) => f.ensureFont('IBM Plex Sans Arabic'));
  }
}

export function initLang(): void {
  applyLang();
  useLangStore.subscribe(applyLang);
}
