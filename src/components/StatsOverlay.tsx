import { useEffect, useRef } from 'react';
import { engine } from '../engine/playback/engine';
import { useUIStore } from '../stores/uiStore';

/** Measured (not estimated) frame rate, compositor cost and JS heap where exposed. */
export function StatsOverlay() {
  const show = useUIStore((s) => s.showStats);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const s = engine.stats;
      const p = engine.mediaPool?.stats;
      if (ref.current)
        ref.current.textContent =
          `${engine.clock.playing ? s.fps.toFixed(0) + ' fps' : 'idle'} · draw ${s.renderMs.toFixed(1)} ms` +
          (p ? ` · drift ${p.leadDriftMs} ms · resync ${p.playSeeks} · wait ${p.holdFrames}` : '') +
          ` · ${useUIStore.getState().renderer}` +
          (mem ? ` · heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '');
    }, 500);
    return () => clearInterval(id);
  }, [show]);
  if (!show) return null;
  return (
    <div
      ref={ref}
      className="tnum pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 font-mono text-[10.5px] text-accent"
    />
  );
}
