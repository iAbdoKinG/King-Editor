import { useEffect } from 'react';
import { isDesktop } from '../desktop/bridge';
import { engine } from '../engine/playback/engine';
import { openProject } from '../features/project/projectActions';
import { actionFor, comboFromEvent } from '../features/shortcuts/keymap';
import {
  addMarkerAtPlayhead,
  addText,
  deleteSelected,
  duplicateSelected,
  extractAudio,
  jumpMarker,
  seekBy,
  splitAtPlayhead,
  stepFrames,
  togglePlay,
} from '../features/timeline/actions';
import { zoom } from '../features/timeline/EditToolbar';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

/** Runs the action bound to a shortcut. Returns false if the action does not apply here. */
export function runAction(id: string): boolean {
  const ps = useProjectStore.getState();
  const ui = useUIStore.getState();
  switch (id) {
    case 'playPause':
      togglePlay();
      break;
    case 'prevFrame':
      stepFrames(-1);
      break;
    case 'nextFrame':
      stepFrames(1);
      break;
    case 'back1s':
      seekBy(-1);
      break;
    case 'fwd1s':
      seekBy(1);
      break;
    case 'toStart':
      engine.seek(0);
      break;
    case 'toEnd':
      engine.seek(engine.clock.duration);
      break;
    case 'split':
      splitAtPlayhead();
      break;
    case 'delete':
      deleteSelected(false);
      break;
    case 'rippleDelete':
      deleteSelected(true);
      break;
    case 'duplicate':
      duplicateSelected();
      break;
    case 'addText':
      addText();
      break;
    case 'extractAudio':
      extractAudio();
      break;
    case 'undo':
      ps.undo();
      break;
    case 'redo':
      ps.redo();
      break;
    case 'marker':
      addMarkerAtPlayhead();
      break;
    case 'markerNamed':
      window.dispatchEvent(new CustomEvent('king:edit-marker', { detail: addMarkerAtPlayhead() }));
      break;
    case 'prevMarker':
      jumpMarker(-1);
      break;
    case 'nextMarker':
      jumpMarker(1);
      break;
    case 'snapping':
      ui.set({ snapping: !ui.snapping });
      break;
    case 'zoomIn':
      zoom(1.5);
      break;
    case 'zoomOut':
      zoom(1 / 1.5);
      break;
    case 'deselect':
      ps.select(null);
      ui.set({ contextMenu: null, sheet: null, exportOpen: false, shortcutsOpen: false });
      break;
    case 'focusMode':
      ui.set({ focusMode: !ui.focusMode });
      break;
    case 'toggleMode':
      ui.setMode(ui.mode === 'pro' ? 'simple' : 'pro');
      break;
    case 'shortcuts':
      ui.set({ shortcutsOpen: true });
      break;
    case 'save':
      window.dispatchEvent(new CustomEvent('king:save'));
      break;
    case 'open':
      if (!isDesktop) return false;
      void openProject();
      break;
    case 'home':
      window.dispatchEvent(new CustomEvent('king:home'));
      break;
    default:
      return false;
  }
  return true;
}

/** Keyboard shortcuts (customizable). Ignored while typing in a field or recording a new binding. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], [data-recording]')) return;
      if (useUIStore.getState().shortcutsOpen && e.code !== 'Escape') return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const id = actionFor(combo);
      if (id && runAction(id)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
