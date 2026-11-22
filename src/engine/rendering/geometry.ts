/**
 * Shared geometry for the compositor, transform overlay and hit testing so
 * that what is drawn, what is selectable and what is exported always agree.
 */
import type { Clip, MediaAsset, TextClip } from '../../types/project';

export interface ClipBox {
  /** Anchor position in project pixels (from the frame's top-left). */
  cx: number;
  cy: number;
  /** Unscaled box size in project pixels. */
  w: number;
  h: number;
  ax: number;
  ay: number;
  sx: number;
  sy: number;
  rot: number; // radians
}

export interface Point {
  x: number;
  y: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

export function textFont(c: TextClip): string {
  return `${c.style.fontWeight} ${c.style.fontSize}px ${c.style.fontFamily}, Inter, system-ui, -apple-system, sans-serif`;
}

export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_PAD = 0.25; // × fontSize

export function textBoxSize(c: TextClip): { w: number; h: number; lines: string[]; lineWidths: number[] } {
  const lines = c.text.split('\n');
  const m = measurer();
  let lineWidths: number[];
  if (m) {
    m.font = textFont(c);
    lineWidths = lines.map((l) => m.measureText(l).width);
  } else lineWidths = lines.map((l) => l.length * c.style.fontSize * 0.55);
  const pad = c.style.fontSize * TEXT_PAD;
  const w = Math.max(c.style.fontSize, ...lineWidths) + pad * 2;
  const h = lines.length * c.style.fontSize * TEXT_LINE_HEIGHT + pad * 2;
  return { w, h, lines, lineWidths };
}

/** Contain-fit `sw×sh` into `W×H`. */
export function fitContain(sw: number, sh: number, W: number, H: number): { w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { w: W, h: H };
  const k = Math.min(W / sw, H / sh);
  return { w: sw * k, h: sh * k };
}

export function clipBox(clip: Clip, assets: Record<string, MediaAsset>, W: number, H: number): ClipBox | null {
  const tr = clip.transform;
  let w: number;
  let h: number;
  if (clip.type === 'text') {
    const s = textBoxSize(clip);
    w = s.w;
    h = s.h;
  } else {
    const a = assets[clip.assetId];
    if (!a || a.kind === 'audio') return null;
    const fit = fitContain(a.width || W, a.height || H, W, H);
    w = fit.w * Math.max(0.01, 1 - tr.crop.left - tr.crop.right);
    h = fit.h * Math.max(0.01, 1 - tr.crop.top - tr.crop.bottom);
  }
  return {
    cx: W / 2 + tr.x,
    cy: H / 2 + tr.y,
    w,
    h,
    ax: tr.anchorX,
    ay: tr.anchorY,
    sx: tr.scaleX,
    sy: tr.scaleY,
    rot: (tr.rotation * Math.PI) / 180,
  };
}

/** Corner points of the box in project space: TL, TR, BR, BL. */
export function boxCorners(b: ClipBox): Point[] {
  const cos = Math.cos(b.rot);
  const sin = Math.sin(b.rot);
  const pts: Array<[number, number]> = [
    [-b.w * b.ax, -b.h * b.ay],
    [b.w * (1 - b.ax), -b.h * b.ay],
    [b.w * (1 - b.ax), b.h * (1 - b.ay)],
    [-b.w * b.ax, b.h * (1 - b.ay)],
  ];
  return pts.map(([x, y]) => {
    const X = x * b.sx;
    const Y = y * b.sy;
    return { x: b.cx + X * cos - Y * sin, y: b.cy + X * sin + Y * cos };
  });
}

/** Whether project-space point `p` lies inside the transformed box. */
export function hitBox(b: ClipBox, p: Point): boolean {
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const cos = Math.cos(-b.rot);
  const sin = Math.sin(-b.rot);
  const lx = (dx * cos - dy * sin) / (b.sx || 1e-6);
  const ly = (dx * sin + dy * cos) / (b.sy || 1e-6);
  return lx >= -b.w * b.ax && lx <= b.w * (1 - b.ax) && ly >= -b.h * b.ay && ly <= b.h * (1 - b.ay);
}
