import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t as T } from '../../i18n';
import { engine } from '../../engine/playback/engine';
import { frameSize } from '../../engine/timeline/model';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { TransformOverlay } from './TransformOverlay';

const QUALITY = { full: 1, half: 0.5, quarter: 0.25 } as const;

/** Preview monitor: an aspect-correct canvas plus the transform overlay. */
export function Preview({ theater = false }: { theater?: boolean }) {
  const settings = useProjectStore((s) => s.project.settings);
  const quality = useUIStore((s) => s.quality);
  const renderer = useUIStore((s) => s.renderer);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { width: W, height: H } = frameSize(settings);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const pad = theater ? 0 : 12;
      const aw = Math.max(0, host.clientWidth - pad * 2);
      const ah = Math.max(0, host.clientHeight - pad * 2);
      const k = Math.min(aw / W, ah / H);
      const w = Math.floor(W * k);
      const h = Math.floor(H * k);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [W, H, theater]);

  // Backing-store resolution: never above project resolution × quality, never above the screen.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !box.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min((box.w * dpr) / W, QUALITY[quality]);
    const bw = Math.max(2, Math.round(W * k));
    const bh = Math.max(2, Math.round(H * k));
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    engine.invalidate();
  }, [box.w, box.h, W, H, quality, renderer]);

  useEffect(() => {
    if (renderer === 'gpu') {
      engine.attachStage(stageRef.current, box.w);
      return () => engine.attachStage(null);
    }
    engine.attachCanvas(canvasRef.current);
    return () => engine.attachCanvas(null);
    // box.w is applied by the effect below; re-attaching on resize is unnecessary.
  }, [renderer]);

  useEffect(() => {
    if (renderer === 'gpu') engine.setStageSize(box.w);
  }, [box.w, renderer]);

  return (
    <div ref={hostRef} dir="ltr" className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-stage">
      <div className="relative shadow-[0_0_0_1px_rgba(57,67,74,0.8)]" style={{ width: box.w, height: box.h }}>
        {renderer === 'gpu' ? (
          <div ref={stageRef} className="absolute inset-0 overflow-hidden" aria-label={T("Preview")} data-testid="preview-stage" />
        ) : (
          <canvas ref={canvasRef} className="block h-full w-full" aria-label={T("Preview")} data-testid="preview-canvas" />
        )}
        <TransformOverlay width={box.w} height={box.h} />
      </div>
    </div>
  );
}
