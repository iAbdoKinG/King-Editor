/**
 * Shared geometry for the compositor, transform overlay and hit testing so
 * that what is drawn, what is selectable and what is exported always agree.
 */
import type { Clip, MediaAsset, TextClip, Transform } from '../../types/project';
import { isRtl } from '../../utils/text';

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
    m.direction = isRtl(c.text) ? 'rtl' : 'ltr';
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

export function clipBox(
  clip: Clip,
  assets: Record<string, MediaAsset>,
  W: number,
  H: number,
  tr: Transform = clip.transform,
): ClipBox | null {
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
    sx: tr.scaleX * (tr.flipH ? -1 : 1),
    sy: tr.scaleY * (tr.flipV ? -1 : 1),
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

/** Project-space position of the point (fx, fy) given in box fractions (0..1). */
export function boxPoint(b: ClipBox, fx: number, fy: number): Point {
  const x = (fx - b.ax) * b.w * b.sx;
  const y = (fy - b.ay) * b.h * b.sy;
  const cos = Math.cos(b.rot);
  const sin = Math.sin(b.rot);
  return { x: b.cx + x * cos - y * sin, y: b.cy + x * sin + y * cos };
}

/** 2D affine matrix [a, b, c, d, e, f] (same layout as DOMMatrix / canvas setTransform). */
export type Affine = [number, number, number, number, number, number];

const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const translate = (m: Affine, x: number, y: number) => (x || y ? mul(m, [1, 0, 0, 1, x, y]) : m);
const scale = (m: Affine, sx: number, sy: number) => (sx !== 1 || sy !== 1 ? mul(m, [sx, 0, 0, sy, 0, 0]) : m);
const rotate = (m: Affine, rad: number) => {
  if (!rad) return m;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return mul(m, [c, s, -s, c, 0, 0]);
};

/** Frame-space transform step around an origin inside the clip box (In/Out/Combo motion). */
export interface LayerMotion {
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  ox: number;
  oy: number;
}

/**
 * The complete layer transform, shared by the GPU preview and the canvas /
 * export compositor:  k · transition (about the frame centre) · motion steps
 * (about points inside the clip) · clip transform.  With `toBoxOrigin` the
 * result maps box-local pixels (0,0 = box top-left) instead of anchor space.
 */
export function layerTransform(
  k: number,
  W: number,
  H: number,
  mix: { dx: number; dy: number; rotate: number; scale: number },
  motion: readonly LayerMotion[],
  box: ClipBox,
  toBoxOrigin: boolean,
): Affine {
  let m: Affine = [k, 0, 0, k, 0, 0];
  m = translate(m, W / 2 + mix.dx, H / 2 + mix.dy);
  m = rotate(m, (mix.rotate * Math.PI) / 180);
  m = scale(m, mix.scale, mix.scale);
  m = translate(m, -W / 2, -H / 2);
  for (const c of motion) {
    const o = boxPoint(box, c.ox, c.oy);
    m = translate(m, o.x + c.dx, o.y + c.dy);
    m = rotate(m, (c.rotate * Math.PI) / 180);
    m = scale(m, c.scale, c.scale);
    m = translate(m, -o.x, -o.y);
  }
  m = translate(m, box.cx, box.cy);
  m = rotate(m, box.rot);
  m = scale(m, box.sx, box.sy);
  if (toBoxOrigin) m = translate(m, -box.w * box.ax, -box.h * box.ay);
  return m;
}

/** Overall scale factor of the motion steps (for blur parity). */
export function motionScale(motion: readonly LayerMotion[]): number {
  let s = 1;
  for (const c of motion) s *= Math.abs(c.scale);
  return s;
}
