/**
 * Font library. Fonts are bundled with the app (no third-party requests) and
 * downloaded only when first used. Export waits for every font in use.
 */
import { create } from 'zustand';

export interface FontDef {
  family: string;
  label: string;
  script: 'arabic' | 'latin' | 'system';
  load?: () => Promise<unknown>;
}

export const FONTS: FontDef[] = [
  { family: 'Inter Variable', label: 'Inter', script: 'latin' },
  { family: 'Cairo', label: 'Cairo — القاهرة', script: 'arabic', load: () => Promise.all([import('@fontsource/cairo/400.css'), import('@fontsource/cairo/700.css')]) },
  { family: 'Tajawal', label: 'Tajawal — تجوال', script: 'arabic', load: () => Promise.all([import('@fontsource/tajawal/400.css'), import('@fontsource/tajawal/700.css')]) },
  { family: 'Almarai', label: 'Almarai — المراعي', script: 'arabic', load: () => Promise.all([import('@fontsource/almarai/400.css'), import('@fontsource/almarai/700.css')]) },
  { family: 'IBM Plex Sans Arabic', label: 'IBM Plex Arabic — بلكس', script: 'arabic', load: () => Promise.all([import('@fontsource/ibm-plex-sans-arabic/400.css'), import('@fontsource/ibm-plex-sans-arabic/700.css')]) },
  { family: 'Readex Pro', label: 'Readex Pro — ريدكس', script: 'arabic', load: () => Promise.all([import('@fontsource/readex-pro/400.css'), import('@fontsource/readex-pro/700.css')]) },
  { family: 'Noto Kufi Arabic', label: 'Noto Kufi — كوفي', script: 'arabic', load: () => Promise.all([import('@fontsource/noto-kufi-arabic/400.css'), import('@fontsource/noto-kufi-arabic/700.css')]) },
  { family: 'Noto Naskh Arabic', label: 'Noto Naskh — نسخ', script: 'arabic', load: () => Promise.all([import('@fontsource/noto-naskh-arabic/400.css'), import('@fontsource/noto-naskh-arabic/700.css')]) },
  { family: 'Amiri', label: 'Amiri — أميري', script: 'arabic', load: () => Promise.all([import('@fontsource/amiri/400.css'), import('@fontsource/amiri/700.css')]) },
  { family: 'Aref Ruqaa', label: 'Aref Ruqaa — رقعة', script: 'arabic', load: () => Promise.all([import('@fontsource/aref-ruqaa/400.css'), import('@fontsource/aref-ruqaa/700.css')]) },
  { family: 'El Messiri', label: 'El Messiri — المسيري', script: 'arabic', load: () => Promise.all([import('@fontsource/el-messiri/400.css'), import('@fontsource/el-messiri/700.css')]) },
  { family: 'Reem Kufi', label: 'Reem Kufi — ريم كوفي', script: 'arabic', load: () => Promise.all([import('@fontsource/reem-kufi/400.css'), import('@fontsource/reem-kufi/700.css')]) },
  { family: 'Changa', label: 'Changa — شانجا', script: 'arabic', load: () => Promise.all([import('@fontsource/changa/400.css'), import('@fontsource/changa/700.css')]) },
  { family: 'Lemonada', label: 'Lemonada — ليمونادة', script: 'arabic', load: () => Promise.all([import('@fontsource/lemonada/400.css'), import('@fontsource/lemonada/700.css')]) },
  { family: 'Marhey', label: 'Marhey — مرحي', script: 'arabic', load: () => Promise.all([import('@fontsource/marhey/400.css'), import('@fontsource/marhey/700.css')]) },
  { family: 'Lalezar', label: 'Lalezar — لاله‌زار', script: 'arabic', load: () => Promise.all([import('@fontsource/lalezar/400.css')]) },
  { family: 'Rakkas', label: 'Rakkas — رقاص', script: 'arabic', load: () => Promise.all([import('@fontsource/rakkas/400.css')]) },
  { family: 'Montserrat', label: 'Montserrat', script: 'latin', load: () => Promise.all([import('@fontsource/montserrat/400.css'), import('@fontsource/montserrat/700.css')]) },
  { family: 'Poppins', label: 'Poppins', script: 'latin', load: () => Promise.all([import('@fontsource/poppins/400.css'), import('@fontsource/poppins/700.css')]) },
  { family: 'Oswald', label: 'Oswald', script: 'latin', load: () => Promise.all([import('@fontsource/oswald/400.css'), import('@fontsource/oswald/700.css')]) },
  { family: 'Playfair Display', label: 'Playfair Display', script: 'latin', load: () => Promise.all([import('@fontsource/playfair-display/400.css'), import('@fontsource/playfair-display/700.css')]) },
  { family: 'Bebas Neue', label: 'Bebas Neue', script: 'latin', load: () => Promise.all([import('@fontsource/bebas-neue/400.css')]) },
  { family: 'Anton', label: 'Anton', script: 'latin', load: () => Promise.all([import('@fontsource/anton/400.css')]) },
  { family: 'Pacifico', label: 'Pacifico', script: 'latin', load: () => Promise.all([import('@fontsource/pacifico/400.css')]) },
  { family: 'Lobster', label: 'Lobster', script: 'latin', load: () => Promise.all([import('@fontsource/lobster/400.css')]) },
  { family: 'Dancing Script', label: 'Dancing Script', script: 'latin', load: () => Promise.all([import('@fontsource/dancing-script/400.css'), import('@fontsource/dancing-script/700.css')]) },
  { family: 'Georgia', label: 'Georgia (system serif)', script: 'system' },
  { family: 'Helvetica Neue', label: 'Helvetica (system)', script: 'system' },
  { family: 'Avenir Next', label: 'Avenir Next (Apple)', script: 'system' },
  { family: 'Menlo', label: 'Menlo (mono)', script: 'system' },
];

/** Bumped whenever a font finishes loading so cached text renders refresh. */
export const useFontStore = create<{ epoch: number; loaded: Record<string, boolean> }>(() => ({ epoch: 0, loaded: {} }));

const pending = new Map<string, Promise<void>>();

export function fontDef(family: string): FontDef | undefined {
  return FONTS.find((f) => f.family === family);
}

/** Ensure a font family is downloaded and ready for canvas text. */
export function ensureFont(family: string): Promise<void> {
  const def = fontDef(family);
  if (!def?.load || useFontStore.getState().loaded[family]) return Promise.resolve();
  let p = pending.get(family);
  if (!p) {
    p = (async () => {
      await def.load!();
      const sample = def.script === 'arabic' ? 'أبجد abc' : 'abc';
      await Promise.all([document.fonts.load(`400 48px "${family}"`, sample), document.fonts.load(`700 48px "${family}"`, sample)]).catch(() => undefined);
      useFontStore.setState((s) => ({ epoch: s.epoch + 1, loaded: { ...s.loaded, [family]: true } }));
    })().catch(() => {
      pending.delete(family);
    });
    pending.set(family, p);
  }
  return p;
}

export { isRtl } from '../../utils/text';
