import { memo, useState } from 'react';
import type { Track } from '../../types/project';
import { Icon, type IconName } from '../../components/Icon';
import { Menu } from '../../components/Menu';
import { moveTrack, removeTrack, updateTrack } from '../../engine/timeline/ops';
import { useProjectStore } from '../../stores/projectStore';

const KIND_ICON: Record<Track['kind'], IconName> = { video: 'film', audio: 'music', text: 'text' };

interface Props {
  track: Track;
  height: number;
  compact: boolean;
  index: number;
  count: number;
  clipCount: number;
}

export const TrackHeader = memo(function TrackHeader({ track, height, compact, index, count, clipCount }: Props) {
  const apply = useProjectStore((s) => s.apply);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const visual = track.kind !== 'audio';
  const toggle = () =>
    apply((p) => updateTrack(p, track.id, visual ? { hidden: !track.hidden } : { muted: !track.muted }));
  const off = visual ? track.hidden : track.muted;

  const items = [
    ...(track.kind !== 'text'
      ? [{ label: track.muted ? 'Unmute track' : 'Mute track', onSelect: () => apply((p) => updateTrack(p, track.id, { muted: !track.muted })) }]
      : []),
    ...(visual
      ? [{ label: track.hidden ? 'Show track' : 'Hide track', onSelect: () => apply((p) => updateTrack(p, track.id, { hidden: !track.hidden })) }]
      : []),
    { label: 'Move up', disabled: index === 0, onSelect: () => apply((p) => moveTrack(p, track.id, -1)) },
    { label: 'Move down', disabled: index === count - 1, onSelect: () => apply((p) => moveTrack(p, track.id, 1)) },
    {
      label: 'Delete track',
      danger: true,
      onSelect: () => {
        if (clipCount > 0 && !window.confirm(`Delete “${track.name}” and its ${clipCount} clip(s)? You can undo this.`)) return;
        apply((p) => removeTrack(p, track.id));
      },
    },
  ];

  return (
    <div
      className="flex items-center gap-1 border-b border-line/60 px-1.5 text-muted"
      style={{ height }}
      data-testid={`track-header-${track.kind}`}
    >
      {compact ? (
        <button
          className="flex h-full w-full items-center justify-center"
          aria-label={`${track.name} options`}
          onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
        >
          <Icon name={off ? (visual ? 'eyeOff' : 'mute') : KIND_ICON[track.kind]} size={18} />
        </button>
      ) : (
        <>
          <Icon name={KIND_ICON[track.kind]} size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text/85">{track.name}</span>
          <button
            className="flex h-8 w-7 items-center justify-center rounded-md hover:bg-elevated hover:text-text"
            aria-label={visual ? (track.hidden ? 'Show track' : 'Hide track') : track.muted ? 'Unmute track' : 'Mute track'}
            aria-pressed={off}
            onClick={toggle}
          >
            <Icon name={visual ? (track.hidden ? 'eyeOff' : 'eye') : track.muted ? 'mute' : 'volume'} size={15} />
          </button>
          <button
            className="flex h-8 w-6 items-center justify-center rounded-md hover:bg-elevated hover:text-text"
            aria-label={`${track.name} options`}
            onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
          >
            <Icon name="more" size={15} />
          </button>
        </>
      )}
      {menu && <Menu x={menu.x} y={menu.y} title={track.name} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
});
