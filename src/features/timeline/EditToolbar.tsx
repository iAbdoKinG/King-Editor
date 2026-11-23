import { Icon, type IconName } from '../../components/Icon';
import { t as T } from '../../i18n';
import { addTrack } from '../../engine/timeline/ops';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { addMarkerAtPlayhead, addText, deleteSelected, duplicateSelected, splitAtPlayhead } from './actions';

function Btn({ icon, label, onClick, disabled, pressed, text }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; text?: string }) {
  return (
    <button className="icon-btn gap-1.5 px-2" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      <Icon name={icon} size={18} />
      {text && <span className="text-[12px] font-medium">{T(text)}</span>}
    </button>
  );
}

export function zoom(f: number): void {
  window.dispatchEvent(new CustomEvent('king:zoom', { detail: f }));
}

/** Timeline toolbar for the wide (iPad landscape / desktop) layout. */
export function EditToolbar() {
  const pro = useUIStore((s) => s.mode) === 'pro';
  const hasSel = useProjectStore((s) => !!s.selectedClipId);
  const apply = useProjectStore((s) => s.apply);
  const snapping = useUIStore((s) => s.snapping);
  const set = useUIStore((s) => s.set);
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line bg-surface px-2" role="toolbar" aria-label={T("Edit tools")}>
      <Btn icon="split" label={T("Split at playhead (S)")} text="Split" onClick={splitAtPlayhead} />
      <Btn icon="duplicate" label={T("Duplicate (⌘D)")} onClick={duplicateSelected} disabled={!hasSel} />
      <Btn icon="trash" label={T("Delete (⌫)")} onClick={() => deleteSelected(false)} disabled={!hasSel} />
      {pro && <Btn icon="ripple" label={T("Ripple delete (⇧⌫)")} onClick={() => deleteSelected(true)} disabled={!hasSel} />}
      <div className="mx-1.5 h-5 w-px bg-line" />
      <Btn icon="text" label={T("Add text (T)")} text="Text" onClick={addText} />
      <Btn icon="flag" label={T("Add marker (M)")} onClick={addMarkerAtPlayhead} />
      <Btn icon="film" label={T("Add video track")} text="+Track" onClick={() => apply((p) => addTrack(p, 'video')[0])} />
      <Btn icon="music" label={T("Add audio track")} onClick={() => apply((p) => addTrack(p, 'audio')[0])} />
      <div className="flex-1" />
      <Btn icon="magnet" label={T("Snapping (N)")} pressed={snapping} onClick={() => set({ snapping: !snapping })} />
      <Btn icon="zoomOut" label={T("Zoom out (−)")} onClick={() => zoom(1 / 1.5)} />
      <Btn icon="zoomIn" label={T("Zoom in (+)")} onClick={() => zoom(1.5)} />
    </div>
  );
}

/** Slim timeline header for the compact (phone) layout; edit actions live in the bottom bar. */
export function CompactTimelineBar() {
  const apply = useProjectStore((s) => s.apply);
  const snapping = useUIStore((s) => s.snapping);
  const set = useUIStore((s) => s.set);
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line bg-surface px-1" role="toolbar" aria-label={T("Timeline tools")}>
      <Btn icon="film" label={T("Add video track")} text="+V" onClick={() => apply((p) => addTrack(p, 'video')[0])} />
      <Btn icon="music" label={T("Add audio track")} text="+A" onClick={() => apply((p) => addTrack(p, 'audio')[0])} />
      <Btn icon="flag" label={T("Add marker")} onClick={addMarkerAtPlayhead} />
      <div className="flex-1" />
      <Btn icon="magnet" label={T("Snapping")} pressed={snapping} onClick={() => set({ snapping: !snapping })} />
      <Btn icon="zoomOut" label={T("Zoom out")} onClick={() => zoom(1 / 1.5)} />
      <Btn icon="zoomIn" label={T("Zoom in")} onClick={() => zoom(1.5)} />
    </div>
  );
}

/** Phone bottom bar: the most frequent actions within thumb reach. */
export function BottomBar() {
  const hasSel = useProjectStore((s) => !!s.selectedClipId);
  const sheet = useUIStore((s) => s.sheet);
  const set = useUIStore((s) => s.set);
  const item = (icon: IconName, label: string, onClick: () => void, opts: { disabled?: boolean; pressed?: boolean } = {}) => (
    <button
      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
        opts.pressed ? 'text-accent' : 'text-muted'
      } disabled:opacity-35`}
      disabled={opts.disabled}
      aria-pressed={opts.pressed}
      onClick={onClick}
    >
      <Icon name={icon} size={20} />
      {T(label)}
    </button>
  );
  return (
    <nav className="safe-bottom flex shrink-0 border-t border-line bg-surface" aria-label={T("Editing tools")}>
      {item('media', 'Media', () => set({ sheet: sheet === 'media' ? null : 'media' }), { pressed: sheet === 'media' })}
      {item('text', 'Text', addText)}
      {item('split', 'Split', splitAtPlayhead)}
      {item('duplicate', 'Copy', duplicateSelected, { disabled: !hasSel })}
      {item('trash', 'Delete', () => deleteSelected(false), { disabled: !hasSel })}
      {item('sliders', 'Adjust', () => set({ sheet: sheet === 'inspector' ? null : 'inspector' }), { pressed: sheet === 'inspector' })}
    </nav>
  );
}
