/**
 * The only bridge between the page and the system. Exposes a small, typed
 * API; the page never gets Node.js or direct file access.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kingDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('desktop:info'),
  /** Absolute path of a File chosen in an <input type=file> or dropped. */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  registerMedia: (paths) => ipcRenderer.invoke('media:register', paths),
  mediaExists: (paths) => ipcRenderer.invoke('media:exists', paths),
  saveProject: (text, suggestedName, path) => ipcRenderer.invoke('project:save', { text, suggestedName, path }),
  openProject: () => ipcRenderer.invoke('project:open'),
  hasPendingProject: () => ipcRenderer.invoke('project:pending'),
  onOpenRequest: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('project:open-request', fn);
    return () => ipcRenderer.removeListener('project:open-request', fn);
  },
});
