/**
 * Wires stores to the engine and installs global, app-wide behaviour:
 * iOS media unlock on first gesture, page-hide handling, unload warning.
 */
import { engine } from '../engine/playback/engine';
import { imageCache } from '../engine/rendering/imageCache';
import { onAssetReleased, useMediaStore } from '../stores/mediaStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

let booted = false;

export function bootstrap(): void {
  if (booted) return;
  booted = true;

  engine.init(() => ({ project: useProjectStore.getState().project, assets: useMediaStore.getState().assets }));
  engine.projectChanged(useProjectStore.getState().project);
  useProjectStore.subscribe((s, prev) => {
    if (s.project !== prev.project) engine.projectChanged(s.project);
  });
  useMediaStore.subscribe(() => engine.invalidate());

  onAssetReleased((a) => {
    engine.mediaPool?.releaseAsset(a.url);
    imageCache.release(a.id);
  });

  engine.mediaPool!.onBlocked = () =>
    useUIStore.getState().toast('Playback was blocked by the browser. Tap Play again.', 'error');

  // iOS Safari only lets media/audio start from user activation events.
  const unlock = () => engine.gesture();
  for (const ev of ['pointerup', 'touchend', 'keydown', 'click'] as const) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  }

  // Free decoders when the page is hidden; Safari may suspend it anyway.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) engine.pauseAndRelease();
    else engine.invalidate();
  });

  // Session-only editing: warn before discarding work.
  window.addEventListener('beforeunload', (e) => {
    const hasWork =
      Object.keys(useProjectStore.getState().project.clips).length > 0 ||
      useMediaStore.getState().order.length > 0;
    if (hasWork) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Prevent iOS page pinch-zoom inside the editor (the timeline has its own pinch).
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('resize', () => useUIStore.getState().set({ contextMenu: null }));

  // Opt-in debug handle for automated tests (?debug). Exposes nothing by default.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__KING__ = { engine, useProjectStore, useMediaStore, useUIStore };
  }
}
