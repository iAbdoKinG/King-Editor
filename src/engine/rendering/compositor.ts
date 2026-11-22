/**
 * Canvas 2D compositor. Draws the timeline composition at time `t`.
 * The same function is used for preview (and later, export) so both always
 * use identical transform and effect parameters.
 */
import type { Clip, Effects, MediaAsset, Project, TextClip } from '../../types/project';
import { frameSize } from '../timeline/model';
import { clipBox, fitContain, textBoxSize, textFont, TEXT_LINE_HEIGHT, TEXT_PAD } from './geometry';
import { imageCache } from './imageCache';

export const canvasFilterSupported: boolean = (() => {
  if (typeof document === 'undefined') return false;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || !('filter' in ctx)) return false;
    ctx.filter = 'blur(1px)';
    return ctx.filter === 'blur(1px)';
  } catch {
    return false;
  }
})();

export interface FrameSource {
  getElement(clipId: string): HTMLVideoElement | HTMLAudioElement | null;
}

function filterString(e: Effects, pxScale: number): string {
  const parts: string[] = [];
  if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturation !== 100) parts.push(`saturate(${e.saturation}%)`);
  if (e.blur > 0) parts.push(`blur(${(e.blur * pxScale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Visual clips active at `t`, bottom layer first. */
export function visibleClipsAt(project: Project, assets: Record<string, MediaAsset>, t: number): Clip[] {
  const byTrack = new Map<string, Clip>();
  for (const id in project.clips) {
    const c = project.clips[id];
    if (t < c.start || t >= c.start + c.duration) continue;
    if (c.type === 'media') {
      const a = assets[c.assetId];
      if (!a || a.kind === 'audio') continue;
    }
    byTrack.set(c.trackId, c);
  }
  const out: Clip[] = [];
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const tr = project.tracks[i];
    if (tr.kind === 'audio' || tr.hidden) continue;
    const c = byTrack.get(tr.id);
    if (c) out.push(c);
  }
  return out;
}

export interface RenderOptions {
  project: Project;
  assets: Record<string, MediaAsset>;
  t: number;
  source: FrameSource;
}

export function renderFrame(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  const { project, assets, t, source } = opts;
  const canvas = ctx.canvas;
  const { width: W, height: H } = frameSize(project.settings);
  const k = canvas.width / W; // project px -> canvas px
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (canvasFilterSupported) ctx.filter = 'none';
  ctx.fillStyle = project.settings.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const clip of visibleClipsAt(project, assets, t)) {
    const box = clipBox(clip, assets, W, H);
    if (!box) continue;
    const tr = clip.transform;
    if (tr.opacity <= 0) continue;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(box.cx, box.cy);
    ctx.rotate(box.rot);
    ctx.scale(box.sx, box.sy);
    ctx.globalAlpha = Math.min(1, tr.opacity);
    if (canvasFilterSupported) ctx.filter = filterString(clip.effects, k * Math.abs(box.sx));
    const x0 = -box.w * box.ax;
    const y0 = -box.h * box.ay;

    if (clip.type === 'text') {
      drawText(ctx, clip, x0, y0);
    } else {
      const a = assets[clip.assetId];
      let img: CanvasImageSource | null = null;
      let sw = a.width;
      let sh = a.height;
      if (a.kind === 'image') img = imageCache.get(a);
      else {
        const el = source.getElement(clip.id) as HTMLVideoElement | null;
        if (el && el.readyState >= 2 && el.videoWidth > 0) {
          img = el;
          sw = el.videoWidth;
          sh = el.videoHeight;
        }
      }
      if (img) {
        if (img instanceof HTMLImageElement) {
          sw = img.naturalWidth;
          sh = img.naturalHeight;
        } else if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
          sw = img.width;
          sh = img.height;
        }
        const c = tr.crop;
        try {
          ctx.drawImage(
            img,
            sw * c.left,
            sh * c.top,
            Math.max(1, sw * (1 - c.left - c.right)),
            Math.max(1, sh * (1 - c.top - c.bottom)),
            x0,
            y0,
            box.w,
            box.h,
          );
        } catch {
          /* frame not decodable yet */
        }
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (canvasFilterSupported) ctx.filter = 'none';
}

function drawText(ctx: CanvasRenderingContext2D, c: TextClip, x0: number, y0: number): void {
  const { w, h, lines, lineWidths } = textBoxSize(c);
  const s = c.style;
  const pad = s.fontSize * TEXT_PAD;
  if (s.background) {
    ctx.fillStyle = s.background;
    const r = s.fontSize * 0.18;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x0, y0, w, h, r);
    else ctx.rect(x0, y0, w, h);
    ctx.fill();
  }
  ctx.font = textFont(c);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = s.color;
  if (s.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = s.fontSize * 0.12;
    ctx.shadowOffsetY = s.fontSize * 0.04;
  }
  const lh = s.fontSize * TEXT_LINE_HEIGHT;
  lines.forEach((line, i) => {
    const lw = lineWidths[i];
    const inner = w - pad * 2;
    const x = s.align === 'left' ? x0 + pad : s.align === 'right' ? x0 + pad + inner - lw : x0 + pad + (inner - lw) / 2;
    ctx.fillText(line, x, y0 + pad + lh * i + lh / 2);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

export { fitContain };
