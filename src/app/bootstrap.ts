/**
 * Wires stores to the engine and installs global, app-wide behaviour:
 * iOS media unlock on first gesture, page-hide handling, unload warning.
 */
import { engine } from '../engine/playback/engine';
import { isDesktop } from '../desktop/bridge';
import { initDesktopProjects } from '../features/project/projectActions';
import { hasUnsavedChanges, initSession, startScratch } from '../features/library/session';
import { imageCache } from '../engine/rendering/imageCache';
import { releaseWaveform } from '../features/media/waveform';
import { ensureFont, useFontStore } from '../features/fonts/fonts';
import { checkAsset, checkProject } from '../features/advisor/advisor';
import { t as T, useLangStore } from '../i18n';
import { AR } from '../i18n/ar';
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

  // Fonts are downloaded on first use; redraw when one arrives.
  const loadFonts = () => {
    for (const c of Object.values(useProjectStore.getState().project.clips)) if (c.type === 'text') void ensureFont(c.style.fontFamily);
  };
  useProjectStore.subscribe((s, prev) => {
    if (s.project.clips !== prev.project.clips) loadFonts();
  });
  useFontStore.subscribe(() => engine.invalidate());

  // Resource advisor (debounced; never on the hot path).
  let advTimer = 0;
  initDesktopProjects();
  initSession();
  // Automated tests (?debug) start directly in an editor with a scratch project.
  if (new URLSearchParams(location.search).has('debug')) startScratch();
  const advise = () => {
    if (isDesktop) return;
    clearTimeout(advTimer);
    advTimer = window.setTimeout(() => checkProject(useProjectStore.getState().project, useMediaStore.getState().assets), 800);
  };
  useProjectStore.subscribe((s, prev) => {
    if (s.project.clips !== prev.project.clips) advise();
  });
  useMediaStore.subscribe((s, prev) => {
    if (isDesktop) return;
    for (const id in s.assets) if (s.assets[id].status === 'ready' && prev.assets[id]?.status !== 'ready') checkAsset(s.assets[id]);
  });

  onAssetReleased((a) => {
    engine.mediaPool?.releaseAsset(a.url);
    imageCache.release(a.id);
    releaseWaveform(a.id);
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
    // Projects autosave; only warn while a save is still pending.
    const hasWork = hasUnsavedChanges();
    if (hasWork) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Prevent iOS page pinch-zoom inside the editor (the timeline has its own pinch).
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('resize', () => useUIStore.getState().set({ contextMenu: null }));

  // Re-localize default names (project title, "Video 1"…) when the language changes;
  // names the user typed are left alone.
  useLangStore.subscribe((st, prev) => {
    if (st.lang === prev.lang) return;
    const defaults = (k: string) => [k, AR[k]];
    useProjectStore.getState().apply(
      (p) => {
        const name = defaults('Untitled Project').includes(p.settings.name) ? T('Untitled Project') : p.settings.name;
        const tracks = p.tracks.map((tr) => {
          for (const key of ['Video {n}', 'Audio {n}', 'Text {n}']) {
            for (const pat of defaults(key)) {
              const m = tr.name.match(new RegExp('^' + pat.replace('{n}', '(\\d+)') + '$'));
              if (m) return { ...tr, name: T(key, { n: m[1] }) };
            }
          }
          return tr;
        });
        return { ...p, settings: { ...p.settings, name }, tracks };
      },
      { commit: false },
    );
  });

  // Opt-in debug handle for automated tests (?debug). Exposes nothing by default.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__KING__ = { engine, useProjectStore, useMediaStore, useUIStore, useLangStore };
  }
}
