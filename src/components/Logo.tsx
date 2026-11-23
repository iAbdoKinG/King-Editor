/**
 * Logo mark: three clips on a timeline, one of them cut by the playhead.
 */
import { BRAND, MARK } from '../app/brand';
import { isArabic } from '../i18n';

export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="4 4 56 56" className={className} aria-hidden="true">
      {MARK.clips.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={8.5} rx={3} fill={c.color} />
      ))}
      <rect x={MARK.playhead.x} y={MARK.playhead.y} width={MARK.playhead.w} height={MARK.playhead.h} rx={1.5} fill="var(--color-text)" />
      <path d={MARK.head} fill="var(--color-text)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex select-none items-center gap-2" aria-label={BRAND.name}>
      <LogoMark size={24} />
      <span className="whitespace-nowrap text-[15px] font-bold tracking-[0.02em] text-text">{isArabic() ? BRAND.nameAr : BRAND.name}</span>
    </div>
  );
}
