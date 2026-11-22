import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useUIStore } from '../../stores/uiStore';
import { detectExportCapabilities, type ExportCapabilities } from './capabilities';

/**
 * Export is a separate milestone. Until a verified encoder path exists, this
 * dialog reports the device's real encoding capabilities instead of
 * pretending to export.
 */
export function ExportDialog() {
  const open = useUIStore((s) => s.exportOpen);
  const set = useUIStore((s) => s.set);
  const [caps, setCaps] = useState<ExportCapabilities | null>(null);
  useEffect(() => {
    if (open && !caps) void detectExportCapabilities().then(setCaps);
  }, [open, caps]);
  if (!open) return null;

  const line = (ok: boolean | null, label: string, detail?: string) => (
    <li className="flex items-start gap-2">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-accent' : ok === null ? 'bg-line' : 'bg-danger'}`} />
      <span>
        {label}
        {detail && <span className="block text-[11px] text-muted">{detail}</span>}
      </span>
    </li>
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && set({ exportOpen: false })}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div className="sheet-in w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="export-title" className="text-[15px] font-semibold">
            Export
          </h2>
          <button className="icon-btn !h-8 !min-w-8" aria-label="Close" onClick={() => set({ exportOpen: false })}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4 text-[13px] leading-relaxed">
          <p>
            Video export is not available yet in this build. It is being developed as its own milestone so that it
            only ever reports success when a valid, playable file has been produced.
          </p>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">This device</div>
            {caps ? (
              <ul className="space-y-1.5">
                {line(caps.webCodecs, 'WebCodecs', caps.webCodecs ? 'Frame-accurate encoding possible' : 'Not available in this browser')}
                {caps.webCodecs && line(caps.videoEncoderH264, 'H.264 hardware/software encoder (1080p)')}
                {line(caps.mediaRecorder, 'MediaRecorder', caps.recorderTypes.length ? caps.recorderTypes.join(', ') : 'No supported container')}
                {line(caps.canvasCaptureStream, 'Canvas capture stream')}
              </ul>
            ) : (
              <p className="text-muted">Checking…</p>
            )}
          </div>
          <p className="text-[12px] text-muted">Your media never leaves this device.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button className="h-10 rounded-lg px-4 text-[13px] text-muted hover:bg-elevated hover:text-text" onClick={() => set({ exportOpen: false })}>
            Close
          </button>
          <button className="h-10 rounded-lg bg-accent px-4 text-[13px] font-semibold text-bg" disabled>
            Export video
          </button>
        </div>
      </div>
    </div>
  );
}
