/**
 * KING EDITOR mark: a crown cut into three clips by two edit
 * points, resting on a timeline track.
 */
export const MARK_PATHS = {
  crown: 'M8 42V18l11.5 10.54V42zM22.5 42V25.46L32 12l9.5 13.46V42zM44.5 42V28.54L56 18v24z',
  track: 'M10 46h44a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2z',
};

export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="4 4 56 56" className={className} aria-hidden="true">
      <path d={MARK_PATHS.crown} fill="#F2F4F5" />
      <path d={MARK_PATHS.track} fill="#91C1C5" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2 select-none" aria-label="KING EDITOR">
      <LogoMark size={22} />
      <span className="text-[13px] font-bold tracking-[0.18em] text-text whitespace-nowrap">
        KING<span className="text-accent font-medium"> EDITOR</span>
      </span>
    </div>
  );
}
