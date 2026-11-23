import { useEffect, useRef, useState } from 'react';
import { t as T } from '../../i18n';
import { Icon } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { filterString } from '../../engine/rendering/filters';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { ensureFont } from '../fonts/fonts';
import { applyPreset, presetTarget } from './applyPreset';
import { KIND_LABEL, parseBundle, presetFile, presetsFromLocation, shareLink, usePresetStore, type Preset, type PresetKind } from './presets';
import type { Effects, Keyframes, TextStyle, Transition } from '../../types/project';
import type { ThemeColors } from '../../app/theme';
import { TRANSITION_TYPES } from '../../engine/timeline/transitions';

/** Save the given data as a named preset (asks for a name). */
export function savePreset<K extends PresetKind>(kind: K, data: Parameters<ReturnType<typeof usePresetStore.getState>['add']>[2], suggested: string): void {
  const name = window.prompt(T('Name this preset'), suggested);
  if (name === null) return;
  usePresetStore.getState().add(kind, name.trim() || suggested, data as never);
  useUIStore.getState().toast(T('Saved “{name}” to your presets.', { name: name.trim() || suggested }));
}

async function share(list: Preset[], title: string): Promise<void> {
  const toast = useUIStore.getState().toast;
  const url = shareLink(list);
  try {
    if (navigator.share) {
      await navigator.share({ title: `KING EDITOR — ${title}`, url });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(T('Share link copied.'));
  } catch {
    window.prompt(T('Copy this link:'), url);
  }
}

async function shareFile(list: Preset[], name: string): Promise<void> {
  const file = presetFile(list, name);
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function PresetPreview({ p }: { p: Preset }) {
  if (p.kind === 'effects')
    return (
      <span
        className="block h-9 w-12 rounded-md"
        style={{ backgroundImage: 'linear-gradient(135deg,#d98c5f,#5f8fd9 55%,#6fcf97)', filter: filterString(p.data as Effects, null, 0.2) }}
      />
    );
  if (p.kind === 'textStyle') {
    const s = p.data as TextStyle;
    void ensureFont(s.fontFamily);
    return (
      <span
        className="flex h-9 w-12 items-center justify-center overflow-hidden rounded-md text-[15px]"
        style={{ fontFamily: `"${s.fontFamily}", sans-serif`, fontWeight: s.fontWeight, color: s.color, background: s.background ?? '#2a2f35', textShadow: s.shadow ? '0 1px 3px rgba(0,0,0,.6)' : undefined }}
      >
        Aa
      </span>
    );
  }
  if (p.kind === 'theme') {
    const c = p.data as ThemeColors;
    return (
      <span className="flex h-9 w-12 overflow-hidden rounded-md border border-black/20">
        <span className="flex-1" style={{ background: c.bg }} />
        <span className="flex-1" style={{ background: c.surface }} />
        <span className="flex-1" style={{ background: c.accent }} />
      </span>
    );
  }
  const label =
    p.kind === 'transition'
      ? T(TRANSITION_TYPES.find((t) => t.value === (p.data as Transition).type)?.label ?? '')
      : `${Object.values(p.data as Keyframes).reduce((n, l) => n + (l?.length ?? 0), 0)} ◆`;
  return <span className="flex h-9 w-12 items-center justify-center rounded-md bg-elevated text-[10px] text-muted">{label}</span>;
}

export function PresetsDialog() {
  const open = useUIStore((s) => s.presetsOpen);
  const set = useUIStore((s) => s.set);
  const toast = useUIStore((s) => s.toast);
  const presets = usePresetStore((s) => s.presets);
  const project = useProjectStore((s) => s.project);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectedTransitionId = useProjectStore((s) => s.selectedTransitionId);
  const [menu, setMenu] = useState<{ p: Preset; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;
  const close = () => set({ presetsOpen: false });
  const groups = (Object.keys(KIND_LABEL) as PresetKind[]).map((k) => [k, presets.filter((p) => p.kind === k)] as const).filter(([, l]) => l.length);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && close()} role="dialog" aria-modal="true" aria-label={T("Presets")}>
      <div className="sheet-in safe-bottom flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">{T("My presets")}</h2>
          <div className="flex items-center gap-1">
            <button className="field flex !h-8 items-center gap-1.5 text-[12px]" onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={14} /> Import
            </button>
            {presets.length > 0 && (
              <button className="field !h-8 text-[12px]" onClick={() => void shareFile(presets, 'King Editor presets')}>
                {T('Export all')}
              </button>
            )}
            <button className="icon-btn !h-8 !min-w-8" aria-label={T("Close")} onClick={close}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".kingpreset,application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                if (f.size > 2_000_000) throw new Error(T('This file is too large to be a preset file.'));
                const list = parseBundle(await f.text());
                usePresetStore.getState().addMany(list);
                toast(T('Imported {n} preset(s).', { n: list.length }));
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }}
          />
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!groups.length && (
            <p className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-muted">
              No presets yet. Use <b>{T("Save")}</b> in the Inspector (effects, text style, transition or animation), or save a custom theme.
              Presets stay on this device; share them as a link or file.
            </p>
          )}
          {groups.map(([kind, list]) => (
            <section key={kind} className="mb-2">
              <h3 className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{T(KIND_LABEL[kind])}</h3>
              {list.map((p) => {
                const target = presetTarget(p, project, selectedClipId, selectedTransitionId);
                const canApply = p.kind === 'theme' || !!target.clip;
                return (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                    <PresetPreview p={p} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{p.name}</span>
                    <button
                      className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold text-on-accent disabled:opacity-40"
                      disabled={!canApply}
                      title={canApply ? T('Apply') : target.reason}
                      onClick={() => applyPreset(p)}
                    >
                      {T('Apply')}
                    </button>
                    <button className="icon-btn !h-8 !min-w-8" aria-label={T('Share {name}', { name: p.name })} onClick={() => void share([p], p.name)}>
                      <Icon name="export" size={15} />
                    </button>
                    <button className="icon-btn !h-8 !min-w-8" aria-label={`${p.name} options`} onClick={(e) => setMenu({ p, x: e.clientX, y: e.clientY })}>
                      <Icon name="more" size={15} />
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        {menu && (
          <Menu
            x={menu.x}
            y={menu.y}
            title={menu.p.name}
            onClose={() => setMenu(null)}
            items={[
              { label: 'Share as file', onSelect: () => void shareFile([menu.p], menu.p.name) },
              {
                label: 'Rename',
                onSelect: () => {
                  const n = window.prompt(T('Rename preset'), menu.p.name);
                  if (n?.trim()) usePresetStore.getState().rename(menu.p.id, n.trim());
                },
              },
              { label: 'Delete', danger: true, onSelect: () => usePresetStore.getState().remove(menu.p.id) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** Offers to import presets that arrived through a share link (#presets=…). */
export function PresetLinkImport() {
  const [incoming, setIncoming] = useState<Preset[] | null>(null);
  useEffect(() => {
    const check = () => {
      const list = presetsFromLocation();
      if (list) setIncoming(list);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  if (!incoming) return null;
  const done = () => {
    history.replaceState(null, '', location.pathname + location.search);
    setIncoming(null);
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={T("Import presets")}>
      <div className="sheet-in w-full max-w-sm rounded-2xl border border-line bg-surface p-4 shadow-2xl">
        <h2 className="mb-1 text-[15px] font-semibold">{T("Import shared presets?")}</h2>
        <p className="mb-3 text-[12px] text-muted">Someone shared {incoming.length} preset{incoming.length === 1 ? '' : 's'} with you. They contain settings only.</p>
        <ul className="mb-4 max-h-48 space-y-1 overflow-y-auto">
          {incoming.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-[13px]">
              <PresetPreview p={p} />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-[11px] text-muted">{T(KIND_LABEL[p.kind])}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button className="h-10 rounded-lg px-4 text-[13px] text-muted hover:bg-elevated" onClick={done}>
            {T('Ignore')}
          </button>
          <button
            className="h-10 rounded-lg bg-accent px-4 text-[13px] font-semibold text-on-accent"
            onClick={() => {
              usePresetStore.getState().addMany(incoming);
              useUIStore.getState().toast(T('Imported {n} preset(s).', { n: incoming.length }));
              done();
            }}
          >
            {T('Import')}
          </button>
        </div>
      </div>
    </div>
  );
}
