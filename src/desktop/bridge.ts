/**
 * Access to the Windows desktop shell (Electron preload). `null` in browsers,
 * so every desktop-only feature is behind a capability check.
 */
export interface DesktopBridge {
  isDesktop: true;
  info(): Promise<{ version: string; platform: string; locale: string }>;
  pathForFile(file: File): string | null;
  registerMedia(paths: string[]): Promise<void>;
  mediaExists(paths: string[]): Promise<boolean[]>;
  saveProject(text: string, suggestedName: string, path?: string | null): Promise<string | null>;
  openProject(): Promise<{ path: string; text: string } | null>;
  hasPendingProject(): Promise<boolean>;
  onOpenRequest(cb: () => void): () => void;
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { kingDesktop?: DesktopBridge }).kingDesktop ?? null) : null;

export const isDesktop = !!desktop;

/** Streaming URL for a local file served by the desktop shell (Range-capable). */
export function mediaUrl(path: string): string {
  return `media://local/${encodeURIComponent(path)}`;
}

export const WINDOWS_DOWNLOADS = {
  installer: 'https://github.com/iAbdoKinG/King-Editor/releases/download/desktop-latest/Qissa-Setup.exe',
  portable: 'https://github.com/iAbdoKinG/King-Editor/releases/download/desktop-latest/Qissa-Portable.exe',
  page: 'https://github.com/iAbdoKinG/King-Editor/releases/tag/desktop-latest',
};
