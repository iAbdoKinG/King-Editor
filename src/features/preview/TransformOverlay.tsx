/**
 * Direct manipulation of the selected visual clip in the preview:
 * drag to move, corner handle to scale, top handle to rotate, two-finger
 * pinch/rotate. Tap selects the top-most element under the finger.
 *
 * The outline follows playback imperatively (engine.onFrame) — no React
 * renders per frame.
 */
import { useEffect, useRef } from 'react';
import type { AnimProp, Clip, Project, Transform } from '../../types/project';
import { engine } from '../../engine/playback/engine';
import { visibleLayersAt } from '../../engine/rendering/compositor';
import { resolveTransform, setAnimatedValue } from '../../engine/timeline/animation';
import { boxCorners, boxPoint, clipBox, hitBox, type ClipBox, type Point } from '../../engine/rendering/geometry';
import { motionDef, setMotion } from '../../engine/timeline/motion';
import { frameSize } from '../../engine/timeline/model';
import { updateClip } from '../../engine/timeline/ops';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';

type Mode = 'move' | 'scale' | 'rotate' | 'pinch' | 'focus';

interface Gesture {
  mode: Mode;
  clipId: string;
  start: Point; // project px
  orig: Transform;
  lt: number;
  anchor: Point;
  d0: number;
  a0: number;
  moved: boolean;
}

const HANDLE_R = 11; // CSS px visual radius; hit radius is larger

export function TransformOverlay({ width, height }: { width: number; height: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const outlineRef = useRef<SVGPolygonElement>(null);
  const scaleRef = useRef<SVGCircleElement>(null);
  const rotRef = useRef<SVGCircleElement>(null);
  const rotLineRef = useRef<SVGLineElement>(null);
  const rotHitRef = useRef<SVGCircleElement>(null);
  const scaleHitRef = useRef<SVGCircleElement>(null);
  const focusRef = useRef<SVGGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const toProject = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const { width: W, height: H } = frameSize(useProjectStore.getState().project.settings);
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  };

  const activeSelected = (project: Project, t: number): Clip | null => {
    const id = useProjectStore.getState().selectedClipId;
    const c = id ? project.clips[id] : null;
    if (!c || t < c.start || t >= c.start + c.duration) return null;
    const track = project.tracks.find((tr) => tr.id === c.trackId);
    if (!track || track.kind === 'audio' || track.hidden) return null;
    return c;
  };

  // Imperative outline update.
  useEffect(() => {
    const update = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const { project } = useProjectStore.getState();
      const assets = useMediaStore.getState().assets;
      const t = engine.clock.now();
      const clip = activeSelected(project, t);
      const box = clip
        ? clipBox(clip, assets, frameSize(project.settings).width, frameSize(project.settings).height, resolveTransform(clip, t - clip.start))
        : null;
      const show = !!box && !engine.clock.playing;
      svg.style.visibility = show ? 'visible' : 'hidden';
      if (!box || !show) return;
      const { width: W, height: H } = frameSize(project.settings);
      const k = sizeRef.current.width / W;
      const kh = sizeRef.current.height / H;
      const pts = boxCorners(box).map((p) => ({ x: p.x * k, y: p.y * kh }));
      outlineRef.current!.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
      scaleRef.current!.setAttribute('cx', `${pts[2].x}`);
      scaleRef.current!.setAttribute('cy', `${pts[2].y}`);
      scaleHitRef.current!.setAttribute('cx', `${pts[2].x}`);
      scaleHitRef.current!.setAttribute('cy', `${pts[2].y}`);
      // rotation handle: 28px beyond the top edge midpoint
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const ex = pts[1].x - pts[0].x;
      const ey = pts[1].y - pts[0].y;
      const len = Math.hypot(ex, ey) || 1;
      const flip = box.sy < 0 ? -1 : 1;
      const nx = (ey / len) * flip;
      const ny = (-ex / len) * flip;
      const rx = mx + nx * 28;
      const ry = my + ny * 28;
      rotRef.current!.setAttribute('cx', `${rx}`);
      rotRef.current!.setAttribute('cy', `${ry}`);
      rotHitRef.current!.setAttribute('cx', `${rx}`);
      rotHitRef.current!.setAttribute('cy', `${ry}`);
      rotLineRef.current!.setAttribute('x1', `${mx}`);
      rotLineRef.current!.setAttribute('y1', `${my}`);
      rotLineRef.current!.setAttribute('x2', `${rx}`);
      rotLineRef.current!.setAttribute('y2', `${ry}`);
      // Zoom/pan focus point of a Combo animation.
      const combo = clip!.motion?.combo;
      const fg = focusRef.current!;
      if (combo && motionDef('combo', combo.id)?.focus) {
        const f = boxPoint(box, combo.focusX ?? 0.5, combo.focusY ?? 0.5);
        fg.setAttribute('transform', `translate(${f.x * k},${f.y * kh})`);
        fg.style.display = '';
      } else fg.style.display = 'none';
    };
    const offFrame = engine.onFrame(update);
    const offSel = useProjectStore.subscribe(update);
    const offClock = engine.clock.subscribe(update);
    update();
    return () => {
      offFrame();
      offSel();
      offClock();
    };
  }, []);

  useEffect(() => {
    engine.invalidate();
  }, [width, height]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const host = e.currentTarget as HTMLElement;
    host.setPointerCapture(e.pointerId);
    const p = toProject(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const ps = useProjectStore.getState();
    const assets = useMediaStore.getState().assets;
    const { width: W, height: H } = frameSize(ps.project.settings);
    const t = engine.clock.now();

    if (pointers.current.size === 2) {
      // Two fingers: pinch-scale + rotate the selected element.
      const sel = activeSelected(ps.project, t);
      if (!sel) return;
      if (gesture.current?.moved) ps.cancel();
      const [a, b] = [...pointers.current.values()];
      const orig = resolveTransform(sel, t - sel.start);
      const box = clipBox(sel, assets, W, H, orig)!;
      ps.begin();
      gesture.current = {
        mode: 'pinch',
        clipId: sel.id,
        start: p,
        orig,
        lt: t - sel.start,
        anchor: { x: box.cx, y: box.cy },
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        a0: Math.atan2(b.y - a.y, b.x - a.x),
        moved: true,
      };
      return;
    }

    const handle = (e.target as Element).getAttribute?.('data-handle') as 'scale' | 'rotate' | 'focus' | null;
    let clip = activeSelected(ps.project, t);
    if (!handle) {
      const box = clip ? clipBox(clip, assets, W, H, resolveTransform(clip, t - clip.start)) : null;
      if (!box || !hitBox(box, p)) {
        // Select the top-most element under the pointer.
        const stack = visibleLayersAt(ps.project, assets, t)
          .map((l) => l.clip)
          .reverse();
        clip = stack.find((c) => {
          const b = clipBox(c, assets, W, H, resolveTransform(c, t - c.start));
          return b && hitBox(b, p);
        }) ?? null;
        ps.select(clip?.id ?? null);
      }
    }
    if (!clip) {
      gesture.current = null;
      return;
    }
    const orig = resolveTransform(clip, t - clip.start);
    const box = clipBox(clip, assets, W, H, orig)!;
    gesture.current = {
      mode: handle ?? 'move',
      clipId: clip.id,
      start: p,
      orig,
      lt: t - clip.start,
      anchor: { x: box.cx, y: box.cy },
      d0: Math.hypot(p.x - box.cx, p.y - box.cy) || 1,
      a0: Math.atan2(p.y - box.cy, p.x - box.cx),
      moved: false,
    };
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toProject(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const ps = useProjectStore.getState();
    const o = g.orig;
    let next: Partial<Record<AnimProp, number>> | null = null;

    if (g.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const k = Math.hypot(a.x - b.x, a.y - b.y) / g.d0;
      const da = Math.atan2(b.y - a.y, b.x - a.x) - g.a0;
      next = { scale: clampScale(o.scaleX * k), rotation: round1(o.rotation + (da * 180) / Math.PI) };
    } else {
      const { width: W } = frameSize(ps.project.settings);
      const slop = (4 / sizeRef.current.width) * W;
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < slop) return;
      if (!g.moved) {
        g.moved = true;
        ps.begin();
      }
      if (g.mode === 'focus') {
        const c = ps.project.clips[g.clipId];
        const combo = c?.motion?.combo;
        const b = c && clipBox(c, useMediaStore.getState().assets, W, frameSize(ps.project.settings).height, g.orig);
        if (combo && b) {
          const [fx, fy] = boxFraction(b, p);
          ps.apply((proj) => updateClip(proj, g.clipId, (cl) => setMotion(cl, 'combo', { ...combo, focusX: fx, focusY: fy })), { commit: false });
        }
        return;
      }
      if (g.mode === 'move') {
        let x = o.x + (p.x - g.start.x);
        let y = o.y + (p.y - g.start.y);
        // Soft snap to centre lines.
        const snap = (8 / sizeRef.current.width) * W;
        if (Math.abs(x) < snap) x = 0;
        if (Math.abs(y) < snap) y = 0;
        next = { x: Math.round(x), y: Math.round(y) };
      } else if (g.mode === 'scale') {
        const k = Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y) / g.d0;
        next = { scale: clampScale(o.scaleX * k) };
      } else if (g.mode === 'rotate') {
        const a = Math.atan2(p.y - g.anchor.y, p.x - g.anchor.x);
        let deg = o.rotation + ((a - g.a0) * 180) / Math.PI;
        const nearest = Math.round(deg / 45) * 45;
        if (Math.abs(deg - nearest) < 3) deg = nearest;
        next = { rotation: round1(deg) };
      }
    }
    if (next) {
      const vals = next;
      ps.apply(
        (proj) =>
          updateClip(proj, g.clipId, (c) => {
            let out = c;
            for (const prop of Object.keys(vals) as AnimProp[]) out = setAnimatedValue(out, prop, g.lt, vals[prop]!);
            return out;
          }),
        { commit: false },
      );
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pinch' && pointers.current.size > 0) return; // wait for last finger
    if (g.moved) useProjectStore.getState().end();
    gesture.current = null;
    pointers.current.clear();
  };

  return (
    <div
      className="absolute inset-0"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        if (gesture.current?.moved) useProjectStore.getState().cancel();
        gesture.current = null;
        pointers.current.delete(e.pointerId);
      }}
      data-testid="preview-overlay"
    >
      <svg ref={svgRef} width={width} height={height} className="absolute inset-0 overflow-visible" style={{ visibility: 'hidden' }}>
        <polygon ref={outlineRef} fill="none" style={{ stroke: 'var(--color-accent)' }} strokeWidth={1.5} />
        <line ref={rotLineRef} style={{ stroke: 'var(--color-accent)' }} strokeWidth={1.5} />
        <circle ref={rotRef} r={HANDLE_R - 3} style={{ fill: 'var(--color-bg)', stroke: 'var(--color-accent)' }} strokeWidth={2} pointerEvents="none" />
        <circle ref={scaleRef} r={HANDLE_R - 3} fill="#F2F4F5" stroke="#15191D" strokeWidth={2} pointerEvents="none" />
        {/* Larger invisible hit areas for touch. */}
        <circle ref={rotHitRef} r={22} fill="transparent" data-handle="rotate" style={{ cursor: 'grab' }} />
        <circle ref={scaleHitRef} r={22} fill="transparent" data-handle="scale" style={{ cursor: 'nwse-resize' }} />
        <g ref={focusRef} style={{ display: 'none' }} data-testid="focus-handle">
          <circle r={9} fill="none" stroke="#fff" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,.8))' }} pointerEvents="none" />
          <path d="M-15 0h9M6 0h9M0 -15v9M0 6v9" stroke="#fff" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,.8))' }} pointerEvents="none" />
          <circle r={3} style={{ fill: 'var(--color-accent)' }} pointerEvents="none" />
          <circle r={22} fill="transparent" data-handle="focus" style={{ cursor: 'move' }} />
        </g>
      </svg>
    </div>
  );
}

/** Inverse of boxPoint: project point → fractions of the clip box, clamped to 0..1. */
function boxFraction(b: ClipBox, p: Point): [number, number] {
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const cos = Math.cos(-b.rot);
  const sin = Math.sin(-b.rot);
  const lx = (dx * cos - dy * sin) / (b.w * (b.sx || 1e-6));
  const ly = (dx * sin + dy * cos) / (b.h * (b.sy || 1e-6));
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return [c(lx + b.ax), c(ly + b.ay)];
}

function clampScale(v: number): number {
  const s = Math.sign(v) || 1;
  return s * Math.min(20, Math.max(0.02, Math.abs(v)));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
