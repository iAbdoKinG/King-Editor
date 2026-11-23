import { useCallback, useEffect, useRef, useState } from 'react';
import { t as T } from '../i18n';
import { BottomSheet } from '../components/BottomSheet';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { StatsOverlay } from '../components/StatsOverlay';
import { Toasts } from '../components/Toasts';
import { ThemeDialog } from '../components/ThemeDialog';
import { AdvisorBanner } from '../features/advisor/AdvisorBanner';
import { DownloadDialog } from '../components/DownloadDialog';
import { ShortcutsDialog } from '../features/shortcuts/ShortcutsDialog';
import { HomeScreen } from '../features/library/HomeScreen';
import { useSession } from '../features/library/session';
import { PresetLinkImport, PresetsDialog } from '../features/presets/PresetsDialog';
import { ExportDialog } from '../features/export/ExportDialog';
import { Inspector } from '../features/inspector/Inspector';
import { MediaLibrary } from '../features/media/MediaLibrary';
import { Preview } from '../features/preview/Preview';
import { Transport } from '../features/preview/Transport';
import { ClipContextMenu } from '../features/timeline/ClipContextMenu';
import { BottomBar, CompactTimelineBar, EditToolbar } from '../features/timeline/EditToolbar';
import { Timeline } from '../features/timeline/Timeline';
import { useLayout } from '../hooks/useLayout';
import { useShortcuts } from '../hooks/useShortcuts';
import { useUIStore } from '../stores/uiStore';

/** Fullscreen API where available (iPad, desktop); CSS "theater" fallback (iPhone). */
function useFullscreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [theater, setTheater] = useState(false);
  const toggle = useCallback(() => {
    const el = ref.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc))?.();
      return;
    }
    if (theater) return setTheater(false);
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setTheater(true));
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else setTheater(true);
  }, [theater]);
  return { ref, theater, toggle, exitTheater: () => setTheater(false) };
}

function PreviewPane({ compact }: { compact: boolean }) {
  const fs = useFullscreen();
  return (
    <div
      ref={fs.ref}
      className={`flex min-h-0 min-w-0 flex-1 flex-col bg-bg ${fs.theater ? 'safe-top safe-bottom fixed inset-0 z-[80]' : 'relative'}`}
    >
      <StatsOverlay />
      <Preview theater={fs.theater} />
      <Transport compact={compact} onFullscreen={fs.toggle} />
      {fs.theater && (
        <button className="icon-btn absolute right-3 top-3 bg-black/50" style={{ marginTop: 'env(safe-area-inset-top)' }} aria-label={T("Exit fullscreen")} onClick={fs.exitTheater}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

function Splitter({ onResize }: { onResize: (dy: number) => void }) {
  const last = useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={T("Resize timeline")}
      className="group relative z-10 h-2 shrink-0 cursor-row-resize bg-bg"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        onResize(e.clientY - last.current);
        last.current = e.clientY;
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
    >
      <div className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line group-hover:bg-muted" />
    </div>
  );
}

function WideLayout() {
  const focusMode = useUIStore((s) => s.focusMode);
  const libraryOpen = useUIStore((s) => s.libraryOpen) && !focusMode;
  const inspectorOpen = useUIStore((s) => s.inspectorOpen) && !focusMode;
  const set = useUIStore((s) => s.set);
  const [timelineH, setTimelineH] = useState(() => Math.round(window.innerHeight * 0.36));
  const clampH = (h: number) => Math.max(150, Math.min(window.innerHeight * 0.7, h));

  return (
    <div className="flex h-full flex-col">
      <Header compact={false} />
      <div className="safe-x flex min-h-0 flex-1">
        {libraryOpen && (
          <aside className="panel w-[272px] shrink-0 border-r xl:w-[300px]" aria-label={T("Media library")}>
            <MediaLibrary />
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <PreviewPane compact={false} />
        </main>
        {inspectorOpen && (
          <aside className="panel w-[300px] shrink-0 border-l xl:w-[320px]" aria-label={T("Inspector")}>
            <Inspector onClose={() => set({ inspectorOpen: false })} />
          </aside>
        )}
      </div>
      <Splitter onResize={(dy) => setTimelineH((h) => clampH(h - dy))} />
      <section className="safe-x safe-bottom flex shrink-0 flex-col border-t border-line" style={{ height: timelineH }} aria-label={T("Timeline")}>
        <EditToolbar />
        <Timeline compact={false} />
      </section>
    </div>
  );
}

function CompactLayout({ landscape }: { landscape: boolean }) {
  const sheet = useUIStore((s) => s.sheet);
  const set = useUIStore((s) => s.set);
  const close = () => set({ sheet: null });

  return (
    <div className="flex h-full flex-col">
      <Header compact />
      <div className={`safe-x flex min-h-0 flex-1 ${landscape ? 'flex-row' : 'flex-col'}`}>
        <div className={landscape ? 'flex w-[52%] min-w-0 flex-col border-r border-line' : 'flex h-[42%] min-h-[180px] shrink-0 flex-col'}>
          <PreviewPane compact />
        </div>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={T("Timeline")}>
          <CompactTimelineBar />
          <Timeline compact />
        </section>
      </div>
      <BottomBar />
      {sheet === 'media' && (
        <BottomSheet label={T("Media")} onClose={close}>
          <MediaLibrary />
        </BottomSheet>
      )}
      {sheet === 'inspector' && (
        <BottomSheet label={T("Inspector")} onClose={close}>
          <Inspector onClose={close} />
        </BottomSheet>
      )}
    </div>
  );
}

export function App() {
  const { mode, landscape } = useLayout();
  useShortcuts();
  useEffect(() => {
    // Collapse the library by default on narrower tablets.
    if (mode === 'wide' && window.innerWidth < 1100) useUIStore.getState().set({ libraryOpen: false });
  }, [mode]);

  const view = useSession((s) => s.view);
  return (
    <>
      {view === 'home' ? <HomeScreen /> : mode === 'wide' ? <WideLayout /> : <CompactLayout landscape={landscape} />}
      <ClipContextMenu compact={mode === 'compact'} />
      <ExportDialog />
      <ThemeDialog />
      <PresetsDialog />
      <PresetLinkImport />
      <AdvisorBanner />
      <DownloadDialog />
      <ShortcutsDialog />
      <Toasts />
    </>
  );
}
