import { useEffect, useState } from 'react';

export type LayoutMode = 'compact' | 'wide';

function compute(): { mode: LayoutMode; landscape: boolean; coarse: boolean } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // Phones (portrait or landscape) and narrow windows get the compact composition.
  const mode: LayoutMode = w < 900 || h < 520 ? 'compact' : 'wide';
  return { mode, landscape: w > h, coarse };
}

export function useLayout() {
  const [state, setState] = useState(compute);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = compute();
        setState((s) => (s.mode === next.mode && s.landscape === next.landscape && s.coarse === next.coarse ? s : next));
      });
    };
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return state;
}
