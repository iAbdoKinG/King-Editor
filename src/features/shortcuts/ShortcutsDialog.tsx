import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { isDesktop } from '../../desktop/bridge';
import { t as T } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import { ACTIONS, bindingOf, comboFromEvent, comboLabel, conflictFor, useKeymapStore, type ShortcutAction } from './keymap';

/** Settings panel: every shortcut, click to record a new key, reset to defaults. */
export function ShortcutsDialog() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const set = useUIStore((s) => s.set);
  const custom = useKeymapStore((s) => s.custom);
  const [recording, setRecording] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // wait for a non-modifier key
      const clash = conflictFor(recording, combo);
      useKeymapStore.getState().set(recording, combo);
      setNotice(clash ? T('“{key}” was moved from “{action}”.', { key: comboLabel(combo), action: T(clash.label) }) : null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [recording]);

  if (!open) return null;
  const close = () => {
    setRecording(null);
    setNotice(null);
    set({ shortcutsOpen: false });
  };
  const groups = ['Playback', 'Editing', 'Markers', 'Timeline', 'App'] as const;
  const visible = (a: ShortcutAction) => !a.desktopOnly || isDesktop;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && close()} role="dialog" aria-modal="true" aria-label={T('Keyboard shortcuts')} data-testid="shortcuts-dialog">
      <div className="sheet-in safe-bottom flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">{T('Keyboard shortcuts')}</h2>
          <div className="flex items-center gap-1">
            {Object.keys(custom).length > 0 && (
              <button className="field !h-8 text-[12px]" onClick={() => useKeymapStore.getState().reset()}>
                {T('Reset all')}
              </button>
            )}
            <button className="icon-btn !h-8 !min-w-8" aria-label={T('Close')} onClick={close}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
        <p className="border-b border-line px-4 py-2 text-[11.5px] text-muted">{T('Click a shortcut, then press the new key. Esc cancels.')}</p>
        {notice && <p className="bg-accent/10 px-4 py-2 text-[12px] text-accent">{notice}</p>}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groups.map((g) => (
            <section key={g} className="mb-2">
              <h3 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{T(g)}</h3>
              {ACTIONS.filter((a) => a.group === g && visible(a)).map((a) => {
                const combo = bindingOf(a.id, custom);
                const isRec = recording === a.id;
                const changed = a.id in custom;
                return (
                  <div key={a.id} className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 hover:bg-white/[0.03]">
                    <span className="min-w-0 flex-1 text-[13px]">{T(a.label)}</span>
                    {changed && (
                      <button className="text-[11px] text-muted hover:text-text" onClick={() => useKeymapStore.getState().reset(a.id)} aria-label={T('Reset “{action}”', { action: T(a.label) })}>
                        {T('Default')}
                      </button>
                    )}
                    <button
                      data-recording={isRec ? '' : undefined}
                      className={`tnum min-w-[92px] rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold ${
                        isRec ? 'animate-pulse border-accent bg-accent/15 text-accent' : combo ? 'border-line bg-bg text-text' : 'border-dashed border-line text-muted'
                      }`}
                      dir="ltr"
                      aria-label={`${T(a.label)}: ${combo ? comboLabel(combo) : T('Not set')}`}
                      onClick={() => {
                        setNotice(null);
                        setRecording(isRec ? null : a.id);
                      }}
                      data-testid={`shortcut-${a.id}`}
                    >
                      {isRec ? T('Press a key…') : combo ? comboLabel(combo) : T('Not set')}
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
