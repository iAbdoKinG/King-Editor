import { Menu } from '../../components/Menu';
import { engine } from '../../engine/playback/engine';
import { clipEnd } from '../../engine/timeline/model';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { addTransition, deleteSelected, duplicateSelected, moveSelectedToTrack, splitAtPlayhead } from './actions';
import { prevAdjacent } from '../../engine/timeline/transitions';

export function ClipContextMenu({ compact }: { compact: boolean }) {
  const menu = useUIStore((s) => s.contextMenu);
  const set = useUIStore((s) => s.set);
  const clip = useProjectStore((s) => (menu ? s.project.clips[menu.clipId] : null));
  if (!menu || !clip) return null;
  const t = engine.clock.now();
  const canSplit = t > clip.start && t < clipEnd(clip);
  const project = useProjectStore.getState().project;
  const visualTrack = project.tracks.find((tr) => tr.id === clip.trackId)?.kind !== 'audio';
  const canTransition = visualTrack && !!prevAdjacent(project, clip);
  return (
    <Menu
      x={menu.x}
      y={menu.y}
      title="Clip"
      onClose={() => set({ contextMenu: null })}
      items={[
        { label: 'Split at playhead', hint: 'S', disabled: !canSplit, onSelect: splitAtPlayhead },
        { label: 'Duplicate', hint: '⌘D', onSelect: duplicateSelected },
        ...(canTransition
          ? [{ label: clip.transitionIn ? 'Edit transition in' : 'Add transition in', onSelect: () => addTransition(clip.id) }]
          : []),
        { label: 'Move to track above', onSelect: () => moveSelectedToTrack(-1) },
        { label: 'Move to track below', onSelect: () => moveSelectedToTrack(1) },
        { label: 'Jump playhead to clip', onSelect: () => engine.seek(clip.start) },
        {
          label: 'Properties',
          onSelect: () => (compact ? set({ sheet: 'inspector' }) : set({ inspectorOpen: true, focusMode: false })),
        },
        { label: 'Ripple delete', hint: '⇧⌫', danger: true, onSelect: () => deleteSelected(true) },
        { label: 'Delete', hint: '⌫', danger: true, onSelect: () => deleteSelected(false) },
      ]}
    />
  );
}
