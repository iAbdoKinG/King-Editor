/**
 * KING EDITOR — desktop (Windows) main process.
 *
 * - Serves the bundled web app from app:// (works fully offline).
 * - Streams local media from media:// with HTTP Range support, so large videos
 *   are never read fully into memory. Only files the user picked (or that a
 *   project they opened references) are served.
 * - Native Save/Open dialogs for .kingproj project files.
 * - Hardened window: context isolation, sandbox, no Node in the page,
 *   navigation locked to the app.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_DIR = path.join(__dirname, 'app');
/** Automated tests only: bypass native file dialogs using this directory. */
const E2E_DIR = process.env.KING_E2E_DIR || null;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

/** Paths the renderer may stream (picked by the user or referenced by an opened project). */
const allowedMedia = new Set();
const norm = (p) => path.resolve(p).toLowerCase();

function serveApp(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(APP_DIR, rel));
  if (!file.startsWith(APP_DIR)) return new Response('Forbidden', { status: 403 });
  if (!fs.existsSync(file)) return net.fetch(pathToFileURL(path.join(APP_DIR, 'index.html')).toString());
  return new Response(fs.createReadStream(file), {
    headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' },
  });
}

/** media://local/<encoded absolute path> with Range support. */
async function serveMedia(request) {
  const url = new URL(request.url);
  const file = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!allowedMedia.has(norm(file))) return new Response('Forbidden', { status: 403 });
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('range');
  const common = { 'content-type': type, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, stat.size - parseInt(m[2], 10));
      end = stat.size - 1;
    }
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size)
      return new Response(null, { status: 416, headers: { ...common, 'content-range': `bytes */${stat.size}` } });
    return new Response(fs.createReadStream(file, { start, end }), {
      status: 206,
      headers: { ...common, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(fs.createReadStream(file), { headers: { ...common, 'content-length': String(stat.size) } });
}

let win = null;
let pendingOpen = process.argv.find((a) => a.toLowerCase().endsWith('.kingproj')) ?? null;

async function readProject(file) {
  const text = await fsp.readFile(file, 'utf8');
  if (text.length > 50 * 1024 * 1024) throw new Error('too large');
  const data = JSON.parse(text);
  for (const a of data?.assets ?? []) if (typeof a?.path === 'string') allowedMedia.add(norm(a.path));
  return { path: file, text };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#15191D',
    title: 'KING EDITOR',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(APP_DIR, 'icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Only the app itself may load in this window; open real links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  // The page warns before discarding unsaved work; Electron needs an explicit choice.
  win.webContents.on('will-prevent-unload', (e) => {
    const ar = app.getLocale().startsWith('ar');
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ar ? ['إغلاق بدون حفظ', 'إلغاء'] : ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'KING EDITOR',
      message: ar ? 'لديك عمل غير محفوظ. هل تريد الإغلاق؟' : 'You have unsaved work. Close anyway?',
    });
    if (choice === 0) e.preventDefault();
  });

  void win.loadURL('app://king/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', serveApp);
  protocol.handle('media', serveMedia);
  // Exported videos: Electron shows the native "Save as" dialog; tests save into E2E_DIR.
  session.defaultSession.on('will-download', (_e, item) => {
    if (E2E_DIR) item.setSavePath(path.join(E2E_DIR, item.getFilename()));
  });
  Menu.setApplicationMenu(null);

  ipcMain.handle('desktop:info', () => ({ version: app.getVersion(), platform: process.platform, locale: app.getLocale() }));

  ipcMain.handle('media:register', (_e, paths) => {
    if (!Array.isArray(paths)) return;
    for (const p of paths) if (typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) allowedMedia.add(norm(p));
  });

  ipcMain.handle('media:exists', async (_e, paths) => {
    if (!Array.isArray(paths)) return [];
    return Promise.all(paths.map((p) => (typeof p === 'string' ? fsp.access(p).then(() => true, () => false) : false)));
  });

  ipcMain.handle('project:save', async (_e, { text, suggestedName, path: current }) => {
    if (typeof text !== 'string') return null;
    let target = typeof current === 'string' && current.toLowerCase().endsWith('.kingproj') ? current : null;
    if (!target && E2E_DIR) target = path.join(E2E_DIR, `${String(suggestedName || 'Project').replace(/[\\/:*?"<>|]+/g, '')}.kingproj`);
    if (!target) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: `${String(suggestedName || 'Project').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'Project'}.kingproj`,
        filters: [{ name: 'KING EDITOR Project', extensions: ['kingproj'] }],
      });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    await fsp.writeFile(target, text, 'utf8');
    return target;
  });

  ipcMain.handle('project:open', async () => {
    const file = pendingOpen;
    pendingOpen = null;
    if (file) return readProject(file).catch(() => null);
    if (E2E_DIR) {
      const f = fs.readdirSync(E2E_DIR).find((n) => n.endsWith('.kingproj'));
      return f ? readProject(path.join(E2E_DIR, f)) : null;
    }
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'KING EDITOR Project', extensions: ['kingproj'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return readProject(r.filePaths[0]);
  });

  ipcMain.handle('project:pending', () => !!pendingOpen);

  createWindow();
});

app.on('window-all-closed', () => app.quit());

// A second launch (e.g. double-clicking a .kingproj) focuses the running window.
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.on('second-instance', (_e, argv) => {
    const proj = argv.find((a) => a.toLowerCase().endsWith('.kingproj'));
    if (proj) {
      pendingOpen = proj;
      win?.webContents.send('project:open-request');
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
