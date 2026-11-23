import { useState } from 'react';
import { isDesktop } from '../desktop/bridge';
import { openProject, saveProject } from '../features/project/projectActions';
import { goHome, useSession } from '../features/library/session';
import { useLangStore } from '../i18n';
import { t as T } from '../i18n';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { Wordmark, LogoMark } from './Logo';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

/** Simple / Pro switch: Simple shows the essentials, Pro every control and the pro effects. */
function ModeSwitch() {
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  return (
    <div role="radiogroup" aria-label={T('Editing mode')} className="mx-1 flex h-8 shrink-0 rounded-full border border-line p-0.5" data-testid="mode-switch">
      {(['simple', 'pro'] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          className={`rounded-full px-3 text-[12px] font-semibold transition-colors ${mode === m ? 'bg-accent text-on-accent' : 'text-muted hover:text-text'}`}
          onClick={() => setMode(m)}
        >
          {T(m === 'simple' ? 'Simple' : 'Pro')}
        </button>
      ))}
    </div>
  );
}

/** Autosave indicator next to the project title. */
function SaveStatus() {
  const state = useSession((s) => s.saveState);
  if (state === 'idle') return null;
  const label = state === 'saving' ? T('Saving…') : state === 'saved' ? T('Saved') : T('Not saved');
  return (
    <span
      className={`hidden shrink-0 items-center gap-1 text-[11px] sm:flex ${state === 'error' ? 'text-danger' : 'text-muted'}`}
      role="status"
      data-testid="save-status"
      title={T('Projects are saved automatically.')}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state === 'saving' ? 'animate-pulse bg-accent' : state === 'saved' ? 'bg-accent' : 'bg-danger'}`} />
      {label}
    </span>
  );
}

export function Header({ compact }: { compact: boolean }) {
  const name = useProjectStore((s) => s.project.settings.name);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const apply = useProjectStore((s) => s.apply);
  const focusMode = useUIStore((s) => s.focusMode);
  const set = useUIStore((s) => s.set);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  const isAr = useLangStore((s) => s.lang) === 'ar';
  const libraryOpen = useUIStore((s) => s.libraryOpen);
  const inspectorOpen = useUIStore((s) => s.inspectorOpen);

  return (
    <header className="safe-top safe-x shrink-0 border-b border-line bg-surface">
      <div className="flex h-12 items-center gap-2 px-2.5">
        <button
          className="flex h-10 shrink-0 items-center gap-1 rounded-lg px-1 hover:bg-elevated"
          aria-label={T('Projects home')}
          title={T('Projects home')}
          onClick={() => void goHome()}
          data-testid="home-button"
        >
          <Icon name="home" size={16} className="text-muted" />
          {compact ? <LogoMark size={22} /> : <Wordmark />}
        </button>
        <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <input
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-[13px] font-medium text-text/90 hover:bg-white/[0.03] focus:bg-bg focus:outline-none sm:max-w-[280px]"
          value={name}
          aria-label={T("Project title")}
          onChange={(e) => apply((p) => ({ ...p, settings: { ...p.settings, name: e.target.value } }), { commit: false })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <SaveStatus />
        <div className="flex-1 max-sm:hidden" />
        <button className="icon-btn" aria-label={T("Undo (⌘Z)")} title={T("Undo (⌘Z)")} disabled={!canUndo} onClick={undo} data-testid="undo">
          <Icon name="undo" size={18} />
        </button>
        <button className="icon-btn" aria-label={T("Redo (⇧⌘Z)")} title={T("Redo (⇧⌘Z)")} disabled={!canRedo} onClick={redo} data-testid="redo">
          <Icon name="redo" size={18} />
        </button>
        {!compact && (
          <>
            <div className="mx-1 h-5 w-px bg-line" />
            <button className="icon-btn" aria-label={T("Media library")} title={T("Media library")} aria-pressed={libraryOpen && !focusMode} onClick={() => set({ libraryOpen: !libraryOpen || focusMode, focusMode: false })}>
              <Icon name="media" size={18} />
            </button>
            <button className="icon-btn" aria-label={T("Inspector")} title={T("Inspector")} aria-pressed={inspectorOpen && !focusMode} onClick={() => set({ inspectorOpen: !inspectorOpen || focusMode, focusMode: false })}>
              <Icon name="sliders" size={18} />
            </button>
          </>
        )}
        {!compact && (
          <button
            className="icon-btn"
            aria-label={T("Focus mode (F)")}
            title={T("Focus mode (F)")}
            aria-pressed={focusMode}
            onClick={() => set({ focusMode: !focusMode })}
          >
            <Icon name="focus" size={18} />
          </button>
        )}
        {!compact && <ModeSwitch />}
        {isDesktop && (
          <>
            <button className="icon-btn" aria-label={T('Open project file…')} title={`${T('Open project file…')} (Ctrl+O)`} onClick={() => void openProject()} data-testid="open-project">
              <Icon name="media" size={18} />
            </button>
            <button className="icon-btn" aria-label={T('Export project file…')} title={T('Export project file…')} onClick={() => void saveProject(true)} data-testid="save-project">
              <Icon name="save" size={18} />
            </button>
          </>
        )}
        {!isDesktop && !compact && (
          <button
            className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted hover:bg-elevated hover:text-text lg:flex"
            onClick={() => set({ downloadOpen: true })}
            data-testid="download-desktop"
          >
            <Icon name="windows" size={15} /> {T('Desktop app')}
          </button>
        )}
        {!compact && (
          <button
            className="icon-btn !min-w-10 text-[13px] font-semibold"
            aria-label={T('Language')}
            title={T('Language')}
            onClick={() => useLangStore.getState().setLang(isAr ? 'en' : 'ar')}
            data-testid="lang-toggle"
          >
            {isAr ? 'EN' : 'ع'}
          </button>
        )}
        {compact ? (
          <button className="icon-btn" aria-label={T("More")} onClick={(e) => setMore({ x: e.clientX, y: e.clientY })}>
            <Icon name="more" size={18} />
          </button>
        ) : (
          <>
            <button className="icon-btn" aria-label={T("Theme")} title={T("Theme")} onClick={() => set({ themeOpen: true })}>
              <Icon name="palette" size={18} />
            </button>
            <button className="icon-btn" aria-label={T('Keyboard shortcuts')} title={T('Keyboard shortcuts')} onClick={() => set({ shortcutsOpen: true })}>
              <Icon name="keyboard" size={18} />
            </button>
            <button className="icon-btn" aria-label={T("Presets library")} title={T("Presets")} onClick={() => set({ presetsOpen: true })}>
              <Icon name="bookmark" size={18} />
            </button>
          </>
        )}
        {more && (
          <Menu
            x={more.x}
            y={more.y}
            onClose={() => setMore(null)}
            items={[
              { label: 'Presets library', onSelect: () => set({ presetsOpen: true }) },
              { label: 'Theme', onSelect: () => set({ themeOpen: true }) },
              { label: 'Keyboard shortcuts', onSelect: () => set({ shortcutsOpen: true }) },
              { label: mode === 'pro' ? 'Switch to Simple mode' : 'Switch to Pro mode', onSelect: () => setMode(mode === 'pro' ? 'simple' : 'pro') },
              ...(isDesktop ? [] : [{ label: 'Desktop app', onSelect: () => set({ downloadOpen: true }) }]),
              { label: isAr ? 'English' : 'العربية', onSelect: () => useLangStore.getState().setLang(isAr ? 'en' : 'ar') },
            ]}
          />
        )}
        <button
          className="ml-1 flex h-9 items-center gap-1.5 rounded-lg border border-accent/60 px-3 text-[13px] font-semibold text-accent hover:bg-accent/10"
          onClick={() => set({ exportOpen: true })}
        >
          <Icon name="export" size={16} />
          <span className="max-[380px]:hidden">{T("Export")}</span>
        </button>
      </div>
    </header>
  );
}
