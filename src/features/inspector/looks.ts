/** One-tap colour "looks" (combinations of the regular effect parameters). */
import type { Effects } from '../../types/project';
import { defaultEffects } from '../../engine/timeline/model';

export const LOOKS: Array<{ id: string; name: string; effects: Partial<Effects> }> = [
  { id: 'none', name: 'Original', effects: {} },
  { id: 'vivid', name: 'Vivid', effects: { contrast: 115, saturation: 140 } },
  { id: 'warm', name: 'Warm', effects: { sepia: 22, saturation: 115, hue: -8, brightness: 103 } },
  { id: 'cool', name: 'Cool', effects: { hue: 14, saturation: 92, brightness: 102, contrast: 105 } },
  { id: 'fade', name: 'Faded', effects: { contrast: 82, brightness: 110, saturation: 78 } },
  { id: 'vintage', name: 'Vintage', effects: { sepia: 45, contrast: 92, saturation: 80, vignette: 35 } },
  { id: 'dramatic', name: 'Dramatic', effects: { contrast: 140, saturation: 108, brightness: 95, vignette: 45 } },
  { id: 'mono', name: 'Mono', effects: { grayscale: 100, contrast: 110 } },
  { id: 'noir', name: 'Noir', effects: { grayscale: 100, contrast: 155, brightness: 88, vignette: 55 } },
  { id: 'dream', name: 'Dream', effects: { brightness: 112, contrast: 88, saturation: 120, blur: 1.5, hue: -12 } },
];

export function lookEffects(id: string): Effects {
  return { ...defaultEffects(), ...(LOOKS.find((l) => l.id === id)?.effects ?? {}) };
}
