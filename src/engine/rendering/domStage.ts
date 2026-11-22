/**
 * GPU preview renderer.
 *
 * Instead of copying every video frame into a canvas (drawImage, which is
 * slow on iOS Safari), each visible layer is a positioned DOM element and the
 * browser's compositor does the work:
 *   video → the pooled <video> element itself (zero-copy)
 *   image → <img>
 *   text  → a small canvas, redrawn only when the text or style changes
 * Transforms, keyframes, transitions, crop, opacity and filters are expressed
 * as CSS using the same geometry as the canvas compositor (used for export),
 * so both renderers produce the same picture.
 */
import type { Clip, Effects, MediaAsset, Project, TextClip } from '../../types/project';
import type { MediaPool } from '../playback/mediaPool';
import { resolveTransform } from '../timeline/animation';
import { frameSize } from '../timeline/model';
import type { Mix } from '../timeline/transitions';
import { visibleLayersAt } from './compositor';
import { clipBox, textBoxSize, textFont, TEXT_LINE_HEIGHT, TEXT_PAD, type ClipBox } from './geometry';

function cssFilter(e: Effects): string {
  const parts: string[] = [];
  if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturation !== 100) parts.push(`saturate(${e.saturation}%)`);
  // Local units are project pixels (scaling happens in the transform), so blur matches export.
  if (e.blur > 0) parts.push(`blur(${e.blur.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

interface StaticWrap {
  wrap: HTMLDivElement;
  kind: 'image' | 'text';
  key: string;
  canvas?: HTMLCanvasElement;
  img?: HTMLImageElement;
}

/** Write a style property only when it changed (avoids needless style recalcs). */
function setStyle(el: HTMLElement, prop: string, value: string): void {
  const s = el.style as unknown as Record<string, string>;
  if (s[prop] !== value) s[prop] = value;
}

function layerMatrix(k: number, W: number, H: number, mix: Mix, box: ClipBox): string {
  const ms = mix.scale;
  const m = new DOMMatrix([k * ms, 0, 0, k * ms, k * ((W / 2) * (1 - ms) + mix.dx), k * ((H / 2) * (1 - ms) + mix.dy)]);
  m.translateSelf(box.cx, box.cy);
  m.rotateSelf((box.rot * 180) / Math.PI);
  m.scaleSelf(box.sx, box.sy);
  m.translateSelf(-box.w * box.ax, -box.h * box.ay);
  return `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
}

export class DomStage {
  private statics = new Map<string, StaticWrap>();
  private width = 0;

  constructor(
    private root: HTMLDivElement,
    private pool: MediaPool,
  ) {}

  /** CSS pixel width of the stage (set by the preview on resize). */
  setSize(cssWidth: number): void {
    this.width = cssWidth;
  }

  render(project: Project, assets: Record<string, MediaAsset>, t: number): void {
    const { width: W, height: H } = frameSize(project.settings);
    const k = this.width / W;
    setStyle(this.root, 'background', project.settings.background);
    const shown = new Set<HTMLElement>();
    const layers = visibleLayersAt(project, assets, t);

    layers.forEach(({ clip, mix }, i) => {
      const tr = resolveTransform(clip, t - clip.start);
      const box = clipBox(clip, assets, W, H, tr);
      if (!box) return;
      const alpha = Math.min(1, tr.opacity) * mix.alpha;
      let wrap: HTMLDivElement | null = null;

      if (clip.type === 'text') {
        wrap = this.textWrap(clip, box).wrap;
      } else {
        const a = assets[clip.assetId];
        const c = tr.crop;
        const fw = box.w / Math.max(0.01, 1 - c.left - c.right);
        const fh = box.h / Math.max(0.01, 1 - c.top - c.bottom);
        let inner: HTMLElement | null = null;
        if (a.kind === 'image') {
          const sw = this.imageWrap(clip, a);
          wrap = sw.wrap;
          inner = sw.img!;
        } else {
          const slot = this.pool.slotFor(clip.id);
          const el = slot?.el as HTMLVideoElement | undefined;
          // Show the element only once it has a frame (avoids flashing black).
          if (!slot?.wrap || !el || el.readyState < 2) return;
          wrap = slot.wrap;
          inner = el;
        }
        setStyle(inner, 'width', `${fw}px`);
        setStyle(inner, 'height', `${fh}px`);
        setStyle(inner, 'left', `${-c.left * fw}px`);
        setStyle(inner, 'top', `${-c.top * fh}px`);
      }

      setStyle(wrap, 'width', `${box.w}px`);
      setStyle(wrap, 'height', `${box.h}px`);
      setStyle(wrap, 'transform', layerMatrix(k, W, H, mix, box));
      setStyle(wrap, 'opacity', `${Math.max(0, Math.min(1, alpha))}`);
      setStyle(wrap, 'filter', cssFilter(clip.effects));
      setStyle(wrap, 'zIndex', `${i + 1}`);
      setStyle(wrap, 'visibility', alpha > 0.001 ? 'visible' : 'hidden');
      shown.add(wrap);
    });

    for (const s of this.pool.videoSlots) if (s.wrap && !shown.has(s.wrap)) setStyle(s.wrap, 'visibility', 'hidden');
    for (const [id, sw] of this.statics) {
      if (shown.has(sw.wrap)) continue;
      if (!project.clips[id]) {
        sw.wrap.remove();
        this.statics.delete(id);
      } else setStyle(sw.wrap, 'visibility', 'hidden');
    }
  }

  private makeWrap(): HTMLDivElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', left: '0', top: '0', overflow: 'hidden', transformOrigin: '0 0' });
    this.root.appendChild(wrap);
    return wrap;
  }

  private imageWrap(clip: Clip, a: MediaAsset): StaticWrap {
    let sw = this.statics.get(clip.id);
    if (!sw || sw.kind !== 'image' || sw.key !== a.url) {
      sw?.wrap.remove();
      const wrap = this.makeWrap();
      const img = document.createElement('img');
      img.decoding = 'async';
      img.draggable = false;
      img.src = a.url;
      Object.assign(img.style, { position: 'absolute', maxWidth: 'none', display: 'block' });
      wrap.appendChild(img);
      sw = { wrap, kind: 'image', key: a.url, img };
      this.statics.set(clip.id, sw);
    }
    return sw;
  }

  private textWrap(clip: TextClip, box: ClipBox): StaticWrap {
    const key = JSON.stringify([clip.text, clip.style, Math.round(box.w), Math.round(box.h)]);
    let sw = this.statics.get(clip.id);
    if (!sw || sw.kind !== 'text') {
      sw?.wrap.remove();
      const wrap = this.makeWrap();
      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
      wrap.appendChild(canvas);
      sw = { wrap, kind: 'text', key: '', canvas };
      this.statics.set(clip.id, sw);
    }
    if (sw.key !== key) {
      sw.key = key;
      drawTextCanvas(sw.canvas!, clip, box.w, box.h);
    }
    return sw;
  }

  dispose(): void {
    for (const sw of this.statics.values()) sw.wrap.remove();
    this.statics.clear();
    for (const s of this.pool.videoSlots) if (s.wrap) s.wrap.style.visibility = 'hidden';
  }
}

/** Rasterize a text clip at (up to) 2× its project size, using the same layout as the compositor. */
function drawTextCanvas(canvas: HTMLCanvasElement, c: TextClip, w: number, h: number): void {
  const scale = Math.min(2, 4096 / Math.max(w, h));
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const { lines, lineWidths } = textBoxSize(c);
  const s = c.style;
  const pad = s.fontSize * TEXT_PAD;
  if (s.background) {
    ctx.fillStyle = s.background;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, w, h, s.fontSize * 0.18);
    else ctx.rect(0, 0, w, h);
    ctx.fill();
  }
  ctx.font = textFont(c);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = s.color;
  if (s.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = s.fontSize * 0.12 * scale;
    ctx.shadowOffsetY = s.fontSize * 0.04 * scale;
  }
  const lh = s.fontSize * TEXT_LINE_HEIGHT;
  lines.forEach((line, i) => {
    const inner = w - pad * 2;
    const lw = lineWidths[i];
    const x = s.align === 'left' ? pad : s.align === 'right' ? pad + inner - lw : pad + (inner - lw) / 2;
    ctx.fillText(line, x, pad + lh * i + lh / 2);
  });
}
