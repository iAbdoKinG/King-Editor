/**
 * Customizable keyboard shortcuts.
 *
 * Bindings use the *physical* key (`KeyboardEvent.code`), so S/M/T keep working
 * with an Arabic (or any) keyboard layout. A binding is written like
 * "Mod+Shift+KeyZ", where Mod = Ctrl on Windows/Linux and ⌘ on macOS.
 */
import { create } from 'zustand';
import { storage } from '../../utils/storage';

export interface ShortcutAction {
  id: string;
  label: string;
  group: 'Playback' | 'Editing' | 'Timeline' | 'Markers' | 'App';
  /** Default binding. Extra built-in alternates apply only while the default is in use. */
  keys: string;
  alt?: string[];
  desktopOnly?: boolean;
}

export const ACTIONS: ShortcutAction[] = [
  { id: 'playPause', label: 'Play / pause', group: 'Playback', keys: 'Space', alt: ['KeyK'] },
  { id: 'prevFrame', label: 'Previous frame', group: 'Playback', keys: 'ArrowLeft' },
  { id: 'nextFrame', label: 'Next frame', group: 'Playback', keys: 'ArrowRight' },
  { id: 'back1s', label: 'Back 1 second', group: 'Playback', keys: 'Shift+ArrowLeft' },
  { id: 'fwd1s', label: 'Forward 1 second', group: 'Playback', keys: 'Shift+ArrowRight' },
  { id: 'toStart', label: 'Go to start', group: 'Playback', keys: 'Home' },
  { id: 'toEnd', label: 'Go to end', group: 'Playback', keys: 'End' },
  { id: 'split', label: 'Split at playhead', group: 'Editing', keys: 'KeyS', alt: ['Mod+KeyB'] },
  { id: 'delete', label: 'Delete', group: 'Editing', keys: 'Delete', alt: ['Backspace'] },
  { id: 'rippleDelete', label: 'Ripple delete', group: 'Editing', keys: 'Shift+Delete', alt: ['Shift+Backspace'] },
  { id: 'duplicate', label: 'Duplicate', group: 'Editing', keys: 'Mod+KeyD' },
  { id: 'addText', label: 'Add text', group: 'Editing', keys: 'KeyT' },
  { id: 'extractAudio', label: 'Extract audio', group: 'Editing', keys: 'Shift+KeyE' },
  { id: 'undo', label: 'Undo', group: 'Editing', keys: 'Mod+KeyZ' },
  { id: 'redo', label: 'Redo', group: 'Editing', keys: 'Mod+Shift+KeyZ', alt: ['Mod+KeyY'] },
  { id: 'marker', label: 'Add marker', group: 'Markers', keys: 'KeyM' },
  { id: 'markerNamed', label: 'Add and name marker', group: 'Markers', keys: 'Shift+KeyM' },
  { id: 'prevMarker', label: 'Previous marker', group: 'Markers', keys: 'BracketLeft' },
  { id: 'nextMarker', label: 'Next marker', group: 'Markers', keys: 'BracketRight' },
  { id: 'snapping', label: 'Snapping on/off', group: 'Timeline', keys: 'KeyN' },
  { id: 'zoomIn', label: 'Zoom in', group: 'Timeline', keys: 'Equal', alt: ['NumpadAdd'] },
  { id: 'zoomOut', label: 'Zoom out', group: 'Timeline', keys: 'Minus', alt: ['NumpadSubtract'] },
  { id: 'deselect', label: 'Deselect / close', group: 'Timeline', keys: 'Escape' },
  { id: 'focusMode', label: 'Focus mode', group: 'App', keys: 'KeyF' },
  { id: 'toggleMode', label: 'Switch Simple / Pro', group: 'App', keys: 'KeyP' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'App', keys: 'Shift+Slash' },
  { id: 'save', label: 'Save project', group: 'App', keys: 'Mod+KeyS' },
  { id: 'open', label: 'Open project', group: 'App', keys: 'Mod+KeyO', desktopOnly: true },
  { id: 'home', label: 'Projects home', group: 'App', keys: 'Mod+KeyH' },
];

/** Build the canonical combo string for a key event (null for bare modifier presses). */
export function comboFromEvent(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | null {
  const code = e.code;
  if (!code || /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(code);
  return parts.join('+');
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_LABEL: Record<string, string> = {
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '−',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Backquote: '`',
  Escape: 'Esc',
  Delete: 'Del',
  Backspace: '⌫',
  Enter: 'Enter',
  Tab: 'Tab',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
};

/** Human-readable label for a combo, e.g. "Ctrl+Shift+Z" / "⌘⇧Z". */
export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) => {
      if (p === 'Mod') return IS_MAC ? '⌘' : 'Ctrl';
      if (p === 'Shift') return IS_MAC ? '⇧' : 'Shift';
      if (p === 'Alt') return IS_MAC ? '⌥' : 'Alt';
      if (p.startsWith('Key')) return p.slice(3);
      if (p.startsWith('Digit')) return p.slice(5);
      return KEY_LABEL[p] ?? p;
    })
    .join(IS_MAC ? '' : '+');
}

interface KeymapState {
  /** User overrides: action id → combo ('' = unassigned). */
  custom: Record<string, string>;
  set: (id: string, combo: string) => void;
  reset: (id?: string) => void;
}

export const useKeymapStore = create<KeymapState>((set, get) => ({
  custom: storage.get<Record<string, string>>('shortcuts') ?? {},
  set: (id, combo) => {
    const custom = { ...get().custom };
    // A combo belongs to one action: unassign it elsewhere.
    for (const a of ACTIONS) if (a.id !== id && bindingOf(a.id, custom) === combo) custom[a.id] = '';
    custom[id] = combo;
    storage.set('shortcuts', custom);
    set({ custom });
  },
  reset: (id) => {
    const custom = { ...get().custom };
    if (id) delete custom[id];
    else for (const k of Object.keys(custom)) delete custom[k];
    storage.set('shortcuts', custom);
    set({ custom });
  },
}));

export function bindingOf(id: string, custom = useKeymapStore.getState().custom): string {
  if (id in custom) return custom[id];
  return ACTIONS.find((a) => a.id === id)?.keys ?? '';
}

/** Which action (if any) a combo triggers. */
export function actionFor(combo: string, custom = useKeymapStore.getState().custom): string | null {
  for (const a of ACTIONS) if (bindingOf(a.id, custom) === combo) return a.id;
  // Built-in alternates only while the action keeps its default binding.
  for (const a of ACTIONS) if (!(a.id in custom) && a.alt?.includes(combo)) return a.id;
  return null;
}

/** Another action already using `combo`, for conflict warnings. */
export function conflictFor(id: string, combo: string): ShortcutAction | null {
  const other = actionFor(combo);
  return other && other !== id ? ACTIONS.find((a) => a.id === other) ?? null : null;
}
