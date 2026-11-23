import { useEffect } from 'react';
import { engine } from '../engine/playback/engine';
import { addMarkerAtPlayhead, jumpMarker, addText, deleteSelected, duplicateSelected, seekBy, splitAtPlayhead, stepFrames, togglePlay } from '../features/timeline/actions';
import { zoom } from '../features/timeline/EditToolbar';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

/** Desktop keyboard shortcuts. Ignored while typing in a field. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const ps = useProjectStore.getState();
      const ui = useUIStore.getState();
      const k = e.key.toLowerCase();
      let handled = true;
      if (mod && k === 'z') e.shiftKey ? ps.redo() : ps.undo();
      else if (mod && k === 'y') ps.redo();
      else if (mod && k === 'd') duplicateSelected();
      else if (mod && k === 'b') splitAtPlayhead();
      else if (mod) handled = false;
      else if (e.key === ' ' || k === 'k') togglePlay();
      else if (e.key === 'ArrowLeft') e.shiftKey ? seekBy(-1) : stepFrames(-1);
      else if (e.key === 'ArrowRight') e.shiftKey ? seekBy(1) : stepFrames(1);
      else if (e.key === 'Home') engine.seek(0);
      else if (e.key === 'End') engine.seek(engine.clock.duration);
      else if (k === 's') splitAtPlayhead();
      else if (k === 't') addText();
      else if (k === 'm') {
        const id = addMarkerAtPlayhead();
        if (e.shiftKey) window.dispatchEvent(new CustomEvent('king:edit-marker', { detail: id }));
      } else if (e.key === '[') jumpMarker(-1);
      else if (e.key === ']') jumpMarker(1);
      else if (k === 'n') ui.set({ snapping: !ui.snapping });
      else if (k === 'f') ui.set({ focusMode: !ui.focusMode });
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(e.shiftKey);
      else if (e.key === 'Escape') {
        ps.select(null);
        ui.set({ contextMenu: null, sheet: null, exportOpen: false });
      } else if (e.key === '=' || e.key === '+') zoom(1.5);
      else if (e.key === '-' || e.key === '_') zoom(1 / 1.5);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
