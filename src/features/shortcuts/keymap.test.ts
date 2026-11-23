import { describe, expect, it, beforeEach } from 'vitest';
import { actionFor, bindingOf, comboFromEvent, comboLabel, useKeymapStore } from './keymap';

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('keymap', () => {
  beforeEach(() => useKeymapStore.getState().reset());

  it('uses physical keys (works with any keyboard layout)', () => {
    // Pressing the S key with an Arabic layout still has code KeyS.
    expect(actionFor(comboFromEvent(ev('KeyS'))!)).toBe('split');
    expect(actionFor(comboFromEvent(ev('KeyM'))!)).toBe('marker');
    expect(actionFor(comboFromEvent(ev('KeyZ', { ctrlKey: true }))!)).toBe('undo');
    expect(actionFor(comboFromEvent(ev('KeyZ', { metaKey: true, shiftKey: true }))!)).toBe('redo');
    expect(comboFromEvent(ev('ShiftLeft', { shiftKey: true }))).toBeNull();
  });

  it('rebinds, resolves conflicts and resets', () => {
    const s = useKeymapStore.getState();
    s.set('split', 'KeyC');
    expect(actionFor('KeyC')).toBe('split');
    expect(actionFor('KeyS')).toBeNull();
    expect(actionFor('Mod+KeyB')).toBeNull(); // alternates drop once customized
    // assigning a key already in use unassigns the other action
    useKeymapStore.getState().set('marker', 'KeyC');
    expect(actionFor('KeyC')).toBe('marker');
    expect(bindingOf('split')).toBe('');
    useKeymapStore.getState().reset();
    expect(actionFor('KeyS')).toBe('split');
  });

  it('labels combos', () => {
    expect(comboLabel('Mod+Shift+KeyZ')).toMatch(/Z$/);
    expect(comboLabel('BracketLeft')).toBe('[');
  });
});
