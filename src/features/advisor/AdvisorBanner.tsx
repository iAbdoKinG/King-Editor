import { Icon } from '../../components/Icon';
import { t as T } from '../../i18n';
import { useAdvisorStore } from './advisor';

export function AdvisorBanner() {
  const a = useAdvisorStore((s) => s.current);
  const dismiss = useAdvisorStore((s) => s.dismiss);
  if (!a) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[85] flex justify-center px-3" style={{ marginTop: 'env(safe-area-inset-top)' }}>
      <div className="sheet-in pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-xl border border-accent/40 bg-elevated p-3 shadow-2xl" role="status" data-testid="advisor">
        <Icon name="gauge" size={20} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{a.title}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted">{a.body}</div>
        </div>
        <button className="h-8 shrink-0 rounded-lg px-3 text-[12px] font-semibold text-accent hover:bg-accent/10" onClick={dismiss}>
          {T('Got it')}
        </button>
      </div>
    </div>
  );
}
