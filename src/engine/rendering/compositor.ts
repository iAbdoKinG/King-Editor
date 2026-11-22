/**
 * Canvas 2D compositor. Draws the timeline composition at time `t`.
 * Preview and export call this same function, so both always apply
 * identical transforms, keyframes, effects and transitions.
 */
import type { Effects, MediaAsset, Project, TextClip } from '../../types/project';
import { resolveTransform } from '../timeline/animation';
import { frameSize } from '../timeline/model';
import { trackLayersAt, type Layer } from '../timeline/transitions';
import { clipBox, textBoxSize, textFont, TEXT_LINE_HEIGHT, TEXT_PAD } from './geometry';
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

/** A decoded frame that can draw a source sub-rectangle into a destination rectangle. */
export interface Frame {
  w: number;
  h: number;
  draw(ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

export interface FrameSource {
  getFrame(clipId: string): Frame | null;
}

export function imageFrame(img: CanvasImageSource, w: number, h: number): Frame {
  return {
    w,
    h,
    draw: (ctx, sx, sy, sw, sh, dx, dy, dw, dh) => ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh),
  };
}

function filterString(e: Effects, pxScale: number): string {
  const parts: string[] = [];
  if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturation !== 100) parts.push(`saturate(${e.saturation}%)`);
  if (e.blur > 0) parts.push(`blur(${(e.blur * pxScale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Visual layers at `t`, bottom first (lower tracks first, then outgoing before incoming). */
export function visibleLayersAt(project: Project, assets: Record<string, MediaAsset>, t: number): Layer[] {
  const { width: W, height: H } = frameSize(project.settings);
  const out: Layer[] = [];
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const tr = project.tracks[i];
    if (tr.kind === 'audio' || tr.hidden) continue;
    for (const l of trackLayersAt(project, tr.id, t, W, H)) {
      const c = l.clip;
      if (c.type === 'media') {
        const a = assets[c.assetId];
        if (!a || a.kind === 'audio') continue;
      }
      out.push(l);
    }
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

  for (const { clip, mix } of visibleLayersAt(project, assets, t)) {
    const tr = resolveTransform(clip, t - clip.start);
    const box = clipBox(clip, assets, W, H, tr);
    if (!box) continue;
    const alpha = Math.min(1, tr.opacity) * mix.alpha;
    if (alpha <= 0.001) continue;
    // Transition transform (around the frame centre), then the clip transform.
    const ms = mix.scale;
    ctx.setTransform(k * ms, 0, 0, k * ms, k * ((W / 2) * (1 - ms) + mix.dx), k * ((H / 2) * (1 - ms) + mix.dy));
    ctx.translate(box.cx, box.cy);
    ctx.rotate(box.rot);
    ctx.scale(box.sx, box.sy);
    ctx.globalAlpha = alpha;
    if (canvasFilterSupported) ctx.filter = filterString(clip.effects, k * ms * Math.abs(box.sx));
    const x0 = -box.w * box.ax;
    const y0 = -box.h * box.ay;

    if (clip.type === 'text') {
      drawText(ctx, clip, x0, y0);
      continue;
    }
    const a = assets[clip.assetId];
    let frame: Frame | null = null;
    if (a.kind === 'image') {
      const img = imageCache.get(a);
      if (img) {
        const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
        const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
        frame = imageFrame(img, w, h);
      }
    } else frame = source.getFrame(clip.id);
    if (!frame) continue;
    const c = tr.crop;
    try {
      frame.draw(
        ctx,
        frame.w * c.left,
        frame.h * c.top,
        Math.max(1, frame.w * (1 - c.left - c.right)),
        Math.max(1, frame.h * (1 - c.top - c.bottom)),
        x0,
        y0,
        box.w,
        box.h,
      );
    } catch {
      /* frame not decodable yet */
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
