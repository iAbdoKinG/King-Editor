import { useEffect, useRef } from 'react';
import { RULER_H } from './constants';

const STEPS = [1 / 30, 1 / 10, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

function label(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (step < 1) return `${m}:${Math.floor(s).toString().padStart(2, '0')}.${Math.round((s % 1) * 10)}`;
  return `${m}:${Math.round(s).toString().padStart(2, '0')}`;
}

/**
 * Viewport-sized canvas ruler (never as wide as the timeline itself, which can
 * be tens of thousands of pixels). Redraws on scroll/zoom via rAF.
 */
export function Ruler({ scroller, pps }: { scroller: HTMLDivElement | null; pps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !scroller) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = scroller.clientWidth;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(RULER_H * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(RULER_H * dpr);
        canvas.style.width = `${w}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, RULER_H);
      const left = scroller.scrollLeft;
      const major = STEPS.find((s) => s * pps >= 84) ?? STEPS[STEPS.length - 1];
      const minor = major / (major >= 1 && major % 5 === 0 ? 5 : 2);
      const t0 = Math.floor(left / pps / minor) * minor;
      const t1 = (left + w) / pps;
      ctx.font = '500 10px Inter Variable, Inter, system-ui, sans-serif';
      ctx.textBaseline = 'top';
      for (let t = t0; t <= t1 + minor; t += minor) {
        const x = Math.round(t * pps - left) + 0.5;
        const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
        ctx.strokeStyle = isMajor ? '#5b6870' : '#39434a';
        ctx.beginPath();
        ctx.moveTo(x, isMajor ? RULER_H - 12 : RULER_H - 6);
        ctx.lineTo(x, RULER_H);
        ctx.stroke();
        if (isMajor && t >= 0) {
          ctx.fillStyle = '#9caab1';
          ctx.fillText(label(Math.max(0, t), major), x + 4, 5);
        }
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scroller, pps]);

  return <canvas ref={ref} height={RULER_H} className="block pointer-events-none" style={{ height: RULER_H }} />;
}
