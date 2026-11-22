import { useEffect, useState } from 'react';
import { engine } from '../engine/playback/engine';

/** Playhead time for UI that needs it (throttled; updates every frame only while paused/scrubbing). */
export function usePlayheadTime(throttleMs = 120): number {
  const [t, setT] = useState(() => engine.clock.now());
  useEffect(() => {
    let last = 0;
    let timer = 0;
    const off = engine.onTime((now) => {
      const wall = performance.now();
      if (!engine.clock.playing || wall - last > throttleMs) {
        last = wall;
        setT(now);
      } else {
        clearTimeout(timer);
        timer = window.setTimeout(() => setT(engine.clock.now()), throttleMs);
      }
    });
    const off2 = engine.clock.subscribe(() => setT(engine.clock.now()));
    return () => {
      off();
      off2();
      clearTimeout(timer);
    };
  }, [throttleMs]);
  return t;
}
