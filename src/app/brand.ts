/**
 * Product identity in one place. To rename the app, change these values
 * (and `desktop/package.json` productName / artifact names for the Windows build).
 */
export const BRAND = {
  name: 'Qissa',
  nameAr: 'قصّة',
  tagline: 'Video editor',
  taglineAr: 'محرر فيديو',
  /** New project files use this extension; older `.kingproj` files still open. */
  projectExt: 'qissa',
  presetExt: 'qissapreset',
};

/** The logo mark on a 64×64 grid: timeline clips cut by a playhead. */
export const MARK = {
  clips: [
    { x: 7, y: 15, w: 27, color: '#8B6CFF' },
    { x: 17, y: 27.75, w: 22, color: '#FF7A59' },
    { x: 45, y: 27.75, w: 12, color: '#FF7A59' },
    { x: 7, y: 40.5, w: 20, color: '#3ED6B4' },
  ],
  playhead: { x: 40.5, y: 12, w: 3, h: 42 },
  head: 'M36 7.5h12a1.5 1.5 0 0 1 1.2 2.4l-6 7.2a1.5 1.5 0 0 1-2.4 0l-6-7.2A1.5 1.5 0 0 1 36 7.5z',
};

export function markSvgInner(playheadColor = '#FFFFFF'): string {
  const clips = MARK.clips.map((c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="8.5" rx="3" fill="${c.color}"/>`).join('');
  const p = MARK.playhead;
  return `${clips}<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="1.5" fill="${playheadColor}"/><path d="${MARK.head}" fill="${playheadColor}"/>`;
}
