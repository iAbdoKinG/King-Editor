import { useUIStore } from '../stores/uiStore';

export function Toasts() {
  const toasts = useUIStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[120] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`sheet-in max-w-md rounded-xl border px-3.5 py-2 text-[13px] shadow-xl ${
            t.tone === 'error' ? 'border-danger/60 bg-elevated text-text' : 'border-line bg-elevated text-text'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
