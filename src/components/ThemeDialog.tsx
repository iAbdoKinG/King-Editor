import { THEME_PRESETS, currentColors, deriveCustom, useThemeStore, type ThemeColors } from '../app/theme';
import { t as T } from '../i18n';
import { savePreset } from '../features/presets/PresetsDialog';
import { useUIStore } from '../stores/uiStore';
import { Icon } from './Icon';

const CUSTOM_FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: 'bg', label: 'Background' },
  { key: 'surface', label: 'Panels' },
  { key: 'accent', label: 'Accent' },
  { key: 'text', label: 'Text' },
  { key: 'video', label: 'Video clips' },
  { key: 'audio', label: 'Audio clips' },
  { key: 'textClip', label: 'Text clips' },
];

function Swatch({ c }: { c: ThemeColors }) {
  return (
    <div className="flex h-12 overflow-hidden rounded-lg border border-black/20" style={{ background: c.bg }}>
      <div className="w-1/3" style={{ background: c.surface }} />
      <div className="flex flex-1 flex-col justify-center gap-1 px-2">
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.text }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.accent }} />
        <div className="flex gap-1">
          <div className="h-1.5 w-4 rounded-full" style={{ background: c.video }} />
          <div className="h-1.5 w-4 rounded-full" style={{ background: c.audio }} />
        </div>
      </div>
    </div>
  );
}

export function ThemeDialog() {
  const open = useUIStore((s) => s.themeOpen);
  const set = useUIStore((s) => s.set);
  const themeId = useThemeStore((s) => s.themeId);
  const custom = useThemeStore((s) => s.custom);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setCustom = useThemeStore((s) => s.setCustom);
  if (!open) return null;
  const close = () => set({ themeOpen: false });
  const editCustom = (key: keyof ThemeColors, value: string) => {
    const next = { ...custom, [key]: value };
    // Key colours re-derive the supporting tones; clip colours are taken as-is.
    setCustom(['bg', 'surface', 'accent', 'text'].includes(key) ? { ...deriveCustom(next), video: next.video, audio: next.audio, textClip: next.textClip } : next);
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && close()} role="dialog" aria-modal="true" aria-label={T("Themes")}>
      <div className="sheet-in safe-bottom max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">{T("Theme")}</h2>
          <button className="icon-btn !h-8 !min-w-8" aria-label={T("Close")} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          {THEME_PRESETS.map((t) => (
            <button key={t.id} className={`rounded-xl p-1.5 text-left ${themeId === t.id ? 'ring-2 ring-accent' : 'hover:bg-elevated'}`} aria-pressed={themeId === t.id} onClick={() => setTheme(t.id)}>
              <Swatch c={t.colors} />
              <div className="mt-1.5 px-0.5 text-[12px] font-medium">{T(t.name)}</div>
            </button>
          ))}
          <button className={`rounded-xl p-1.5 text-left ${themeId === 'custom' ? 'ring-2 ring-accent' : 'hover:bg-elevated'}`} aria-pressed={themeId === 'custom'} onClick={() => setTheme('custom')}>
            <Swatch c={custom} />
            <div className="mt-1.5 px-0.5 text-[12px] font-medium">{T("Custom")}</div>
          </button>
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{T("Custom theme")}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {CUSTOM_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-2 text-[12px] text-muted">
                {T(f.label)}
                <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" value={custom[f.key]} onChange={(e) => editCustom(f.key, e.target.value)} aria-label={T('Custom {label}', { label: T(f.label) })} />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">{T("Saved on this device. Save as a preset to share it.")}</p>
            <button className="field !h-8 shrink-0 text-[12px]" onClick={() => savePreset('theme', currentColors().colors, T('My theme'))}>
              {T('Save as preset')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
