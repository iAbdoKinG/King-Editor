/**
 * Multitrack timeline with a single, input-agnostic gesture model:
 *
 *   touch/pen  – tap selects; dragging a *selected* clip moves it; dragging an
 *                unselected clip or empty space scrolls natively; trim handles
 *                appear on the selected clip; long-press opens the menu;
 *                two-finger pinch zooms.
 *   mouse      – press-drag moves any clip; drag on empty space scrubs;
 *                right-click opens the menu; Ctrl/⌘+wheel zooms.
 *
 * Playhead position is written straight to the DOM from the engine clock and
 * never triggers React renders.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Clip, Track } from '../../types/project';
import { engine } from '../../engine/playback/engine';
import { clipEnd, projectDuration } from '../../engine/timeline/model';
import { moveClip, snapCandidates, snapTime, trimClip } from '../../engine/timeline/ops';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC, useUIStore } from '../../stores/uiStore';
import { clamp } from '../../utils/time';
import { addAssetToTimeline } from './actions';
import { ClipView } from './ClipView';
import { ASSET_DRAG_TYPE, DRAG_SLOP, HEADER_W, HEADER_W_COMPACT, LONG_PRESS_MS, RULER_H, SNAP_PX, TRACK_H, TRACK_H_COMPACT } from './constants';
import { Ruler } from './Ruler';
import { TrackHeader } from './TrackHeader';

type Mode = 'pending-clip' | 'pending-empty' | 'move' | 'trim-start' | 'trim-end' | 'scrub' | 'none';

interface DragState {
  pointerId: number;
  pointerType: string;
  mode: Mode;
  clipId: string | null;
  x0: number;
  y0: number;
  t0: number;
  origStart: number;
  grabOffset: number;
  candidates: number[];
  wasSelected: boolean;
  longPress: number;
}

interface LaneLayout {
  track: Track;
  top: number;
  h: number;
}

export function Timeline({ compact }: { compact: boolean }) {
  const project = useProjectStore((s) => s.project);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const assets = useMediaStore((s) => s.assets);
  const pps = useUIStore((s) => s.pxPerSec);

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointers = useRef(new Set<number>());
  const pendingScroll = useRef<number | null>(null);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const [view, setView] = useState({ left: 0, width: 1200 });

  const trackH = compact ? TRACK_H_COMPACT : TRACK_H;
  const lanes: LaneLayout[] = useMemo(() => {
    let y = 0;
    return project.tracks.map((track) => {
      const lane = { track, top: y, h: trackH[track.kind] };
      y += lane.h;
      return lane;
    });
  }, [project.tracks, trackH]);
  const totalH = lanes.reduce((s, l) => s + l.h, 0);
  const duration = projectDuration(project);
  const contentW = Math.max((duration + 30) * pps, view.width + 240);

  const clipsByTrack = useMemo(() => {
    const m = new Map<string, Clip[]>();
    for (const id in project.clips) {
      const c = project.clips[id];
      const arr = m.get(c.trackId);
      if (arr) arr.push(c);
      else m.set(c.trackId, [c]);
    }
    return m;
  }, [project.clips]);

  /* ---------------- scrolling, virtualization, header sync ---------------- */

  useEffect(() => {
    if (!scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (headersRef.current) headersRef.current.style.transform = `translateY(${-scroller.scrollTop}px)`;
      // Quantize so React only re-renders when the visible window moves meaningfully.
      const q = 300;
      const left = Math.floor(scroller.scrollLeft / q) * q;
      const width = Math.ceil(scroller.clientWidth / q) * q + q;
      setView((v) => (v.left === left && v.width === width ? v : { left, width }));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', on);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scroller]);

  // Keep a requested anchor stable across zoom changes.
  useLayoutEffect(() => {
    if (scroller && pendingScroll.current !== null) {
      scroller.scrollLeft = Math.max(0, pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [pps, scroller]);

  const zoomAround = useCallback(
    (nextPps: number, anchorClientX: number) => {
      if (!scroller) return;
      const next = clamp(nextPps, MIN_PX_PER_SEC, MAX_PX_PER_SEC);
      const rect = scroller.getBoundingClientRect();
      const vx = anchorClientX - rect.left;
      const t = (scroller.scrollLeft + vx) / ppsRef.current;
      pendingScroll.current = t * next - vx;
      useUIStore.getState().set({ pxPerSec: next });
    },
    [scroller],
  );

  // Zoom requests from toolbar/keyboard anchor on the playhead.
  useEffect(() => {
    if (!scroller) return;
    const onZoom = (e: Event) => {
      const f = (e as CustomEvent<number>).detail;
      const rect = scroller.getBoundingClientRect();
      const phX = engine.clock.now() * ppsRef.current - scroller.scrollLeft;
      const anchor = phX >= 0 && phX <= rect.width ? rect.left + phX : rect.left + rect.width / 2;
      zoomAround(ppsRef.current * f, anchor);
    };
    window.addEventListener('king:zoom', onZoom);
    return () => window.removeEventListener('king:zoom', onZoom);
  }, [scroller, zoomAround]);

  /* ---------------- pinch & wheel zoom ---------------- */

  useEffect(() => {
    if (!scroller) return;
    let pinch: { d0: number; pps0: number } | null = null;
    const dist = (e: TouchEvent) =>
      Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const mid = (e: TouchEvent) => (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        abortDrag();
        pinch = { d0: dist(e) || 1, pps0: ppsRef.current };
        e.preventDefault();
      }
    };
    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        zoomAround(pinch.pps0 * (dist(e) / pinch.d0), mid(e));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAround(ppsRef.current * Math.exp(-e.deltaY * 0.01), e.clientX);
      }
    };
    scroller.addEventListener('touchstart', onStart, { passive: false });
    scroller.addEventListener('touchmove', onMove, { passive: false });
    scroller.addEventListener('touchend', onEnd);
    scroller.addEventListener('touchcancel', onEnd);
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
      scroller.removeEventListener('wheel', onWheel);
    };
  }, [scroller, zoomAround]);

  /* ---------------- playhead (DOM-driven) ---------------- */

  useEffect(() => {
    return engine.onTime((t) => {
      const x = t * ppsRef.current;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      // Page-follow during playback.
      if (scroller && engine.clock.playing && !dragRef.current) {
        const w = scroller.clientWidth;
        if (x > scroller.scrollLeft + w - 32 || x < scroller.scrollLeft) scroller.scrollLeft = x - 32;
      }
    });
  }, [scroller]);

  useLayoutEffect(() => {
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${engine.clock.now() * pps}px)`;
  }, [pps]);

  /* ---------------- gesture helpers ---------------- */

  const timeAt = (clientX: number) => {
    if (!scroller) return 0;
    const r = scroller.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + scroller.scrollLeft) / ppsRef.current);
  };

  const laneAt = (clientY: number): LaneLayout | null => {
    if (!scroller) return null;
    const r = scroller.getBoundingClientRect();
    const y = clientY - r.top + scroller.scrollTop - RULER_H;
    return lanes.find((l) => y >= l.top && y < l.top + l.h) ?? null;
  };

  const showSnap = (t: number | null) => {
    const el = snapRef.current;
    if (!el) return;
    if (t === null) el.style.display = 'none';
    else {
      el.style.display = 'block';
      el.style.transform = `translateX(${t * ppsRef.current}px)`;
    }
  };

  function abortDrag() {
    const d = dragRef.current;
    if (!d) return;
    clearTimeout(d.longPress);
    if (d.mode === 'move' || d.mode === 'trim-start' || d.mode === 'trim-end') useProjectStore.getState().cancel();
    dragRef.current = null;
    showSnap(null);
  }

  const snap = (t: number, extraEdge?: number) => {
    const d = dragRef.current;
    if (!d || !useUIStore.getState().snapping) return { t, line: null as number | null };
    const thr = SNAP_PX / ppsRef.current;
    const a = snapTime(t, d.candidates, thr);
    if (extraEdge === undefined) return { t: a.time, line: a.snapped };
    const b = snapTime(t + extraEdge, d.candidates, thr);
    const da = a.snapped === null ? Infinity : Math.abs(a.snapped - t);
    const db = b.snapped === null ? Infinity : Math.abs(b.snapped - (t + extraEdge));
    if (da === Infinity && db === Infinity) return { t, line: null };
    return da <= db ? { t: a.time, line: a.snapped } : { t: b.time - extraEdge, line: b.snapped };
  };

  const startEdit = (d: DragState, mode: Mode, target: Element) => {
    d.mode = mode;
    clearTimeout(d.longPress);
    try {
      target.setPointerCapture(d.pointerId);
    } catch {
      /* ignore */
    }
    const ps = useProjectStore.getState();
    ps.begin();
    d.candidates = snapCandidates(ps.project, d.clipId, engine.clock.now());
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      abortDrag();
      return;
    }
    useUIStore.getState().set({ contextMenu: null });
    const target = e.target as HTMLElement;
    const handle = target.closest('[data-handle]') as HTMLElement | null;
    const clipEl = target.closest('[data-clip-id]') as HTMLElement | null;
    const clipId = clipEl?.dataset.clipId ?? null;
    const ps = useProjectStore.getState();
    const clip = clipId ? ps.project.clips[clipId] : null;
    const d: DragState = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      mode: clip ? 'pending-clip' : 'pending-empty',
      clipId,
      x0: e.clientX,
      y0: e.clientY,
      t0: timeAt(e.clientX),
      origStart: clip?.start ?? 0,
      grabOffset: 0,
      candidates: [],
      wasSelected: !!clip && ps.selectedClipId === clipId,
      longPress: 0,
    };
    dragRef.current = d;

    if (handle && clip) {
      const edge = handle.dataset.handle === 'start' ? 'trim-start' : 'trim-end';
      d.grabOffset = (edge === 'trim-start' ? clip.start : clipEnd(clip)) - d.t0;
      startEdit(d, edge, e.currentTarget);
      e.preventDefault();
      return;
    }
    if (clip && e.pointerType === 'mouse') {
      ps.select(clip.id);
      d.wasSelected = true;
    }
    if (clip && e.pointerType !== 'mouse') {
      const { clientX, clientY } = e;
      d.longPress = window.setTimeout(() => {
        if (dragRef.current !== d || d.mode !== 'pending-clip') return;
        d.mode = 'none';
        useProjectStore.getState().select(clip.id);
        useUIStore.getState().set({ contextMenu: { clipId: clip.id, x: clientX, y: clientY } });
        navigator.vibrate?.(8);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const far = Math.hypot(dx, dy) > DRAG_SLOP;
    const pps = ppsRef.current;

    if (d.mode === 'pending-clip' && far) {
      if (d.pointerType === 'mouse' || d.wasSelected) startEdit(d, 'move', e.currentTarget);
      else {
        clearTimeout(d.longPress);
        d.mode = 'none'; // native scroll takes over
      }
    } else if (d.mode === 'pending-empty' && far) {
      if (d.pointerType === 'mouse') {
        d.mode = 'scrub';
        e.currentTarget.setPointerCapture(e.pointerId);
      } else d.mode = 'none';
    }

    const ps = useProjectStore.getState();
    const base = ps.txBase;
    if (d.mode === 'move' && base && d.clipId) {
      const clip = base.clips[d.clipId];
      if (!clip) return;
      const s = snap(d.origStart + dx / pps, clip.duration);
      showSnap(s.line);
      const lane = laneAt(e.clientY);
      const curKind = base.tracks.find((t) => t.id === clip.trackId)?.kind;
      const trackId = lane && lane.track.kind === curKind ? lane.track.id : clip.trackId;
      ps.apply(() => moveClip(base, d.clipId!, s.t, trackId), { commit: false });
    } else if ((d.mode === 'trim-start' || d.mode === 'trim-end') && base && d.clipId) {
      const s = snap(timeAt(e.clientX) + d.grabOffset);
      showSnap(s.line);
      const edge = d.mode === 'trim-start' ? 'start' : 'end';
      const next = trimClip(base, useMediaStore.getState().assets, d.clipId, edge, s.t);
      ps.apply(() => next, { commit: false });
      // Show the frame at the edge being trimmed.
      const c = next.clips[d.clipId];
      if (c && !engine.clock.playing)
        engine.seek(edge === 'start' ? c.start : Math.max(c.start, clipEnd(c) - 1 / next.settings.fps));
    } else if (d.mode === 'scrub') {
      engine.seek(timeAt(e.clientX));
    }
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    clearTimeout(d.longPress);
    dragRef.current = null;
    showSnap(null);
    const ps = useProjectStore.getState();
    if (d.mode === 'move' || d.mode === 'trim-start' || d.mode === 'trim-end') {
      if (cancelled) ps.cancel();
      else ps.end();
      return;
    }
    if (cancelled) return;
    if (d.mode === 'pending-clip' && d.clipId) ps.select(d.clipId);
    else if (d.mode === 'pending-empty') {
      ps.select(null);
      engine.seek(d.t0);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const clipEl = (e.target as HTMLElement).closest('[data-clip-id]') as HTMLElement | null;
    e.preventDefault();
    if (!clipEl?.dataset.clipId) return;
    useProjectStore.getState().select(clipEl.dataset.clipId);
    useUIStore.getState().set({ contextMenu: { clipId: clipEl.dataset.clipId, x: e.clientX, y: e.clientY } });
  };

  /* ---------------- ruler scrubbing ---------------- */

  const onRulerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    engine.seek(timeAt(e.clientX));
  };
  const onRulerMove = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) engine.seek(timeAt(e.clientX));
  };

  /* ---------------- desktop drag & drop from the library ---------------- */

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    const lane = laneAt(e.clientY);
    addAssetToTimeline(id, timeAt(e.clientX), lane?.track.id);
  };

  /* ---------------- render ---------------- */

  const visFrom = view.left / pps - 2;
  const visTo = (view.left + view.width * 2) / pps + 2;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Track headers */}
      <div
        className="relative shrink-0 overflow-hidden border-r border-line bg-surface"
        style={{ width: compact ? HEADER_W_COMPACT : HEADER_W }}
      >
        <div style={{ height: RULER_H }} className="border-b border-line" />
        <div ref={headersRef} className="will-change-transform">
          {lanes.map((l, i) => (
            <TrackHeader
              key={l.track.id}
              track={l.track}
              height={l.h}
              compact={compact}
              index={i}
              count={lanes.length}
              clipCount={clipsByTrack.get(l.track.id)?.length ?? 0}
            />
          ))}
        </div>
      </div>

      {/* Scrollable lanes */}
      <div
        ref={setScroller}
        className="relative min-w-0 flex-1 overflow-auto overscroll-contain scroll-thin bg-bg"
        style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
        data-testid="timeline-scroller"
      >
        <div className="relative" style={{ width: contentW, height: RULER_H + totalH + 24 }}>
          <div
            className="sticky top-0 z-20 border-b border-line bg-surface/95"
            style={{ height: RULER_H, touchAction: 'none', cursor: 'col-resize' }}
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            data-testid="timeline-ruler"
          >
            <div className="sticky left-0 inline-block align-top">
              <Ruler scroller={scroller} pps={pps} />
            </div>
          </div>

          {lanes.map((l, i) => (
            <div
              key={l.track.id}
              className={`absolute left-0 right-0 border-b border-line/60 ${i % 2 ? 'bg-white/[0.012]' : ''} ${
                l.track.hidden || l.track.muted ? 'opacity-50' : ''
              }`}
              style={{ top: RULER_H + l.top, height: l.h }}
              data-track-id={l.track.id}
            >
              {(clipsByTrack.get(l.track.id) ?? []).map((c) =>
                c.start <= visTo && clipEnd(c) >= visFrom || c.id === selectedClipId ? (
                  <ClipView
                    key={c.id}
                    clip={c}
                    asset={c.type === 'media' ? assets[c.assetId] : undefined}
                    selected={c.id === selectedClipId}
                    pps={pps}
                    height={l.h}
                    kind={l.track.kind}
                  />
                ) : null,
              )}
            </div>
          ))}

          {project.tracks.length === 0 && (
            <div className="absolute left-4 text-muted" style={{ top: RULER_H + 16 }}>
              No tracks. Add a track from the toolbar.
            </div>
          )}

          <div
            ref={snapRef}
            className="pointer-events-none absolute top-0 z-30 hidden w-px bg-accent-strong"
            style={{ height: RULER_H + totalH, left: 0 }}
          />
          <div
            ref={playheadRef}
            className="pointer-events-none absolute top-0 z-30"
            style={{ height: RULER_H + totalH + 24, left: 0, willChange: 'transform' }}
            data-testid="playhead"
          >
            <div className="absolute -left-[6px] top-0 h-3 w-3 rotate-45 rounded-[2px] bg-text" style={{ top: 2 }} />
            <div className="absolute left-[-0.5px] top-0 h-full w-[1.5px] bg-text" />
          </div>
        </div>
      </div>
    </div>
  );
}
