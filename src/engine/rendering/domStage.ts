/**
 * GPU preview renderer.
 *
 * Instead of copying every video frame into a canvas (drawImage, which is
 * slow on iOS Safari), each visible layer is a positioned DOM element and the
 * browser's compositor does the work:
 *   video → the pooled <video> element itself (zero-copy)
 *   image → <img>
 *   text  → a small canvas, redrawn only when the text or style changes
 * Transforms, keyframes, transitions (incl. clip regions), crop, opacity,
 * filters and vignette are expressed as CSS using the same geometry and
 * filter strings as the canvas compositor (used for export).
 *
 * DOM per layer:  outer (frame-sized, clip-path) › wrap (transformed box) › media
 */
import type { Clip, MediaAsset, Project, TextClip } from '../../types/project';
import type { MediaPool } from '../playback/mediaPool';
import { resolveTransform } from '../timeline/animation';
import { motionAt } from '../timeline/motion';
import { frameSize } from '../timeline/model';
import type { Mix } from '../timeline/transitions';
import { visibleLayersAt } from './compositor';
import { filterString, shadowFilter, vignetteGradient } from './filters';
import { clipBox, layerTransform, textBoxSize, textFont, TEXT_LINE_HEIGHT, TEXT_PAD, type ClipBox } from './geometry';
import { useFontStore } from '../../features/fonts/fonts';
import { isRtl } from '../../utils/text';

interface LayerEls {
  outer: HTMLDivElement;
  wrap: HTMLDivElement;
  vig?: HTMLDivElement;
}

interface StaticEls extends LayerEls {
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

function clipPath(mix: Mix, cssW: number, cssH: number): string {
  const c = mix.clip;
  if (!c) return 'none';
  if (c.kind === 'inset') return `inset(${c.top * 100}% ${c.right * 100}% ${c.bottom * 100}% ${c.left * 100}%)`;
  return `circle(${((c.r * Math.hypot(cssW, cssH)) / 2).toFixed(2)}px at 50% 50%)`;
}

const slotEls = new WeakMap<HTMLDivElement, LayerEls>();

export class DomStage {
  private statics = new Map<string, StaticEls>();
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
      const motion = motionAt(clip, t - clip.start, W, H);
      const alpha = Math.min(1, tr.opacity) * mix.alpha * motion.alpha;
      let els: LayerEls | null = null;

      if (clip.type === 'text') {
        els = this.textEls(clip, box);
      } else {
        const a = assets[clip.assetId];
        const c = tr.crop;
        const fw = box.w / Math.max(0.01, 1 - c.left - c.right);
        const fh = box.h / Math.max(0.01, 1 - c.top - c.bottom);
        let inner: HTMLElement | null = null;
        if (a.kind === 'image') {
          const se = this.imageEls(clip, a);
          els = se;
          inner = se.img!;
        } else {
          const slot = this.pool.slotFor(clip.id);
          const el = slot?.el as HTMLVideoElement | undefined;
          // Show the element only once it has a frame (avoids flashing black).
          // Keep the last frame on screen while seeking (no flashing during drags and scrubs).
          if (!slot?.wrap || !slot.outer || !el || (el.readyState < 2 && !slot.hasFrame)) return;
          els = slotEls.get(slot.outer) ?? { outer: slot.outer, wrap: slot.wrap };
          slotEls.set(slot.outer, els);
          inner = el;
        }
        setStyle(inner, 'width', `${fw}px`);
        setStyle(inner, 'height', `${fh}px`);
        setStyle(inner, 'left', `${-c.left * fw}px`);
        setStyle(inner, 'top', `${-c.top * fh}px`);
      }

      const { outer, wrap } = els;
      setStyle(outer, 'zIndex', `${i + 1}`);
      setStyle(outer, 'clipPath', clipPath(mix, this.width, (this.width * H) / W));
      setStyle(outer, 'visibility', alpha > 0.001 ? 'visible' : 'hidden');
      setStyle(wrap, 'width', `${box.w}px`);
      setStyle(wrap, 'height', `${box.h}px`);
      setStyle(wrap, 'transform', `matrix(${layerTransform(k, W, H, mix, motion.components, box, true).join(',')})`);
      setStyle(wrap, 'opacity', `${Math.max(0, Math.min(1, alpha))}`);
      setStyle(wrap, 'filter', filterString(clip.effects, motion.blur ? { blur: mix.blur + motion.blur, brightness: mix.brightness } : mix, 1));
      // Pro effects: corner radius scales with the clip; shadow and blend work on the finished layer.
      setStyle(wrap, 'borderRadius', `${Math.max(0, clip.effects.radius ?? 0)}px`);
      setStyle(outer, 'filter', shadowFilter(clip.effects, k));
      setStyle(outer, 'mixBlendMode', clip.effects.blend && clip.effects.blend !== 'normal' ? clip.effects.blend : 'normal');
      this.vignette(els, clip.effects.vignette ?? 0);
      shown.add(outer);
    });

    for (const s of this.pool.videoSlots) if (s.outer && !shown.has(s.outer)) setStyle(s.outer, 'visibility', 'hidden');
    for (const [id, se] of this.statics) {
      if (shown.has(se.outer)) continue;
      if (!project.clips[id]) {
        se.outer.remove();
        this.statics.delete(id);
      } else setStyle(se.outer, 'visibility', 'hidden');
    }
  }

  private vignette(els: LayerEls, amount: number): void {
    if (amount <= 0) {
      if (els.vig) setStyle(els.vig, 'display', 'none');
      return;
    }
    if (!els.vig) {
      els.vig = document.createElement('div');
      Object.assign(els.vig.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '2' });
      els.wrap.appendChild(els.vig);
    }
    setStyle(els.vig, 'display', 'block');
    setStyle(els.vig, 'background', vignetteGradient(amount));
  }

  private makeEls(): LayerEls {
    const outer = document.createElement('div');
    Object.assign(outer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', left: '0', top: '0', overflow: 'hidden', transformOrigin: '0 0' });
    outer.appendChild(wrap);
    this.root.appendChild(outer);
    return { outer, wrap };
  }

  private imageEls(clip: Clip, a: MediaAsset): StaticEls {
    let se = this.statics.get(clip.id);
    if (!se || se.kind !== 'image' || se.key !== a.url) {
      se?.outer.remove();
      const els = this.makeEls();
      const img = document.createElement('img');
      img.decoding = 'async';
      img.draggable = false;
      img.src = a.url;
      Object.assign(img.style, { position: 'absolute', maxWidth: 'none', display: 'block' });
      els.wrap.appendChild(img);
      se = { ...els, kind: 'image', key: a.url, img };
      this.statics.set(clip.id, se);
    }
    return se;
  }

  private textEls(clip: TextClip, box: ClipBox): StaticEls {
    const key = JSON.stringify([clip.text, clip.style, Math.round(box.w), Math.round(box.h), useFontStore.getState().epoch]);
    let se = this.statics.get(clip.id);
    if (!se || se.kind !== 'text') {
      se?.outer.remove();
      const els = this.makeEls();
      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
      els.wrap.appendChild(canvas);
      se = { ...els, kind: 'text', key: '', canvas };
      this.statics.set(clip.id, se);
    }
    if (se.key !== key) {
      se.key = key;
      drawTextCanvas(se.canvas!, clip, box.w, box.h);
    }
    return se;
  }

  dispose(): void {
    for (const se of this.statics.values()) se.outer.remove();
    this.statics.clear();
    for (const s of this.pool.videoSlots) if (s.outer) s.outer.style.visibility = 'hidden';
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
  ctx.direction = isRtl(c.text) ? 'rtl' : 'ltr';
  // Absolute alignment: with RTL text the default 'start' would mean the right edge.
  ctx.textAlign = 'left';
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
