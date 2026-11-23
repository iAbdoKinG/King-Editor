/**
 * CSS filter string shared by the canvas compositor (export) and the GPU
 * preview, so both apply identical colour effects.
 */
import type { Effects } from '../../types/project';
import type { Mix } from '../timeline/transitions';

export function filterString(e: Effects, mix: Pick<Mix, 'blur' | 'brightness'> | null, blurScale: number): string {
  const parts: string[] = [];
  const bright = e.brightness * (mix?.brightness ?? 1);
  if (bright !== 100) parts.push(`brightness(${bright.toFixed(1)}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturation !== 100) parts.push(`saturate(${e.saturation}%)`);
  if (e.hue) parts.push(`hue-rotate(${e.hue}deg)`);
  if (e.sepia) parts.push(`sepia(${e.sepia}%)`);
  if (e.grayscale) parts.push(`grayscale(${e.grayscale}%)`);
  const blur = e.blur + (mix?.blur ?? 0);
  if (blur > 0) parts.push(`blur(${(blur * blurScale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Radial vignette as a CSS gradient (amount 0–100). */
export function vignetteGradient(amount: number): string {
  const a = Math.min(1, amount / 100) * 0.85;
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${a.toFixed(3)}) 100%)`;
}
