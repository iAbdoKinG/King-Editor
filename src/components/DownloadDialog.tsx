import { WINDOWS_DOWNLOADS } from '../desktop/bridge';
import { t as T } from '../i18n';
import { useUIStore } from '../stores/uiStore';
import { Icon } from './Icon';
import { LogoMark } from './Logo';

/** Explains and links the Windows desktop app (shown in browsers only). */
export function DownloadDialog() {
  const open = useUIStore((s) => s.downloadOpen);
  const set = useUIStore((s) => s.set);
  if (!open) return null;
  const close = () => set({ downloadOpen: false });
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && close()} role="dialog" aria-modal="true" aria-label={T('Desktop app')} data-testid="download-dialog">
      <div className="sheet-in safe-bottom w-full max-w-md rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <LogoMark size={20} /> {T('Get KING EDITOR for Windows')}
          </h2>
          <button className="icon-btn !h-8 !min-w-8" aria-label={T('Close')} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4 text-[13px] leading-relaxed">
          <p>{T('Free, works offline, exports up to 2K, and saves projects to your computer.')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a className="flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 font-semibold text-on-accent" href={WINDOWS_DOWNLOADS.installer} rel="noopener">
              <Icon name="windows" size={16} /> {T('Installer')}
            </a>
            <a className="flex h-11 items-center justify-center gap-2 rounded-lg border border-line px-3 font-medium hover:bg-elevated" href={WINDOWS_DOWNLOADS.portable} rel="noopener">
              {T('Portable')} (.exe)
            </a>
          </div>
          <p className="text-[11.5px] text-muted">{T('Windows may show a SmartScreen warning because the app is not signed: choose “More info” → “Run anyway”.')}</p>
        </div>
      </div>
    </div>
  );
}
