/**
 * Tiny, failure-tolerant wrapper around localStorage for device-only
 * preferences (themes, saved presets). Never used for media.
 */
const PREFIX = 'king-editor:';

export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};
