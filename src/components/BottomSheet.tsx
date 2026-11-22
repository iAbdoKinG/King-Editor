import type { ReactNode } from 'react';

/** Non-modal bottom sheet for phones: the preview stays visible above it. */
export function BottomSheet({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  return (
    <div
      className="sheet-in safe-bottom fixed inset-x-0 bottom-0 z-[70] flex max-h-[62vh] min-h-[38vh] flex-col rounded-t-2xl border-t border-line bg-surface shadow-[0_-12px_40px_rgba(0,0,0,0.45)]"
      role="dialog"
      aria-label={label}
    >
      <button className="flex h-6 w-full shrink-0 items-center justify-center" aria-label={`Close ${label}`} onClick={onClose}>
        <span className="h-1 w-10 rounded-full bg-line" />
      </button>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
