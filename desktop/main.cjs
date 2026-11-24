/**
 * Qissa — desktop (Windows) main process.
 *
 * - Serves the bundled web app from app:// (works fully offline).
 * - Streams local media from media:// with HTTP Range support, so large videos
 *   are never read fully into memory. Only files the user picked (or that a
 *   project they opened references) are served.
 * - Native Save/Open dialogs for .qissa project files (.kingproj still opens).
 * - Project library in Documents/Qissa/Projects (autosaved by the app).
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
const PROJECT_EXT = /\.(qissa|kingproj)$/i;
let pendingOpen = process.argv.find((a) => PROJECT_EXT.test(a)) ?? null;

/* ------------------------- universal format import ------------------------- */
// Files Chromium cannot play (TS, MKV, AVI, FLV, WMV, MPG, AC3, WMA, …) are
// converted once with the bundled FFmpeg into Documents/Qissa/Converted.
// H.264/AAC streams are copied without re-encoding; everything else is
// transcoded to H.264/AAC. The original file is never modified.

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    // Inside the packaged app the binary lives next to app.asar, not inside it.
    return p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : null;
  } catch {
    return null;
  }
}

function convertedRoot() {
  const root = E2E_DIR ? path.join(E2E_DIR, 'converted') : path.join(app.getPath('documents'), 'Qissa', 'Converted');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

const running = new Set();
app.on('before-quit', () => {
  for (const p of running) p.kill();
});

function runFfmpeg(args, onLine) {
  return new Promise((resolve) => {
    const bin = ffmpegPath();
    if (!bin || !fs.existsSync(bin)) return resolve({ code: -1, err: 'ffmpeg missing' });
    const proc = spawn(bin, ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    running.add(proc);
    let err = '';
    let buf = '';
    proc.stderr.on('data', (d) => {
      const t = d.toString();
      err = (err + t).slice(-20000);
      buf += t;
      const parts = buf.split(/[\r\n]+/);
      buf = parts.pop();
      for (const l of parts) onLine?.(l);
    });
    proc.on('error', () => {
      running.delete(proc);
      resolve({ code: -1, err });
    });
    proc.on('close', (code) => {
      running.delete(proc);
      resolve({ code, err });
    });
  });
}

const secs = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** Where the converted copy of `src` lives (stable per source file version, so conversions are reused). */
async function convertedTarget(src, audioOnly) {
  if (typeof src !== 'string' || !path.isAbsolute(src) || !allowedMedia.has(norm(src))) return null;
  const st = await fsp.stat(src).catch(() => null);
  if (!st) return null;
  const key = crypto.createHash('sha1').update(`${norm(src)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 10);
  const base = path.basename(src).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'media';
  return path.join(convertedRoot(), `${base}-${key}.${audioOnly ? 'm4a' : 'mp4'}`);
}

/** Fallback: the page converted the file itself (WebCodecs); store the result like a native conversion. */
async function saveConverted(_e, { path: src, kind, data }) {
  const out = await convertedTarget(src, kind === 'audio');
  if (!out || !(data instanceof ArrayBuffer || ArrayBuffer.isView(data)) || !data.byteLength) return { error: 'denied' };
  const tmp = `${out}.part`;
  await fsp.writeFile(tmp, Buffer.from(data instanceof ArrayBuffer ? data : data.buffer));
  await fsp.rename(tmp, out);
  allowedMedia.add(norm(out));
  return { path: out, size: data.byteLength };
}

async function convertMedia(event, { jobId, path: src, kind }) {
  const audioOnly = kind === 'audio';
  const out = await convertedTarget(src, audioOnly);
  if (!out) return { error: 'denied' };
  const send = (p) => {
    if (!event.sender.isDestroyed()) event.sender.send('media:convert-progress', { jobId, progress: p });
  };
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    allowedMedia.add(norm(out));
    return { path: out, size: fs.statSync(out).size };
  }
  // Inspect the streams (ffmpeg prints them and exits with an error when no output is given).
  const info = (await runFfmpeg(['-i', src])).err;
  const dm = info.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = dm ? secs(dm[1], dm[2], dm[3]) : 0;
  const v = info.match(/Stream #\S+?: Video: (\w+)/);
  const a = info.match(/Stream #\S+?: Audio: (\w+)/);
  if (audioOnly ? !a : !v) return { error: 'unreadable' };
  const copyV = v && v[1] === 'h264' && /yuv420p[^1]/.test(info.slice(v.index, v.index + 200) + ' ');
  const copyA = a && a[1] === 'aac';
  const tmp = `${out}.part`;
  const args = ['-y', '-i', src];
  if (audioOnly) args.push('-vn', '-map', '0:a:0', ...(copyA ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']));
  else {
    args.push('-map', '0:v:0', '-map', '0:a:0?');
    args.push(...(copyV ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']));
    args.push(...(copyA ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']));
    args.push('-movflags', '+faststart');
  }
  args.push('-f', audioOnly ? 'ipod' : 'mp4', tmp);
  send(0);
  const r = await runFfmpeg(args, (line) => {
    const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m && duration > 0) send(Math.min(0.99, secs(m[1], m[2], m[3]) / duration));
  });
  if (r.code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    fs.rmSync(tmp, { force: true });
    return { error: 'failed' };
  }
  await fsp.rename(tmp, out);
  allowedMedia.add(norm(out));
  return { path: out, size: fs.statSync(out).size };
}

/* ----------------------------- project library ----------------------------- */

function libraryRoot() {
  const root = E2E_DIR ? path.join(E2E_DIR, 'library') : path.join(app.getPath('documents'), 'Qissa', 'Projects');
  fs.mkdirSync(root, { recursive: true });
  return root;
}
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
function projectDir(id) {
  if (!validId(id)) throw new Error('invalid id');
  return path.join(libraryRoot(), id);
}
async function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}
function registerProjectMedia(text) {
  try {
    for (const a of JSON.parse(text)?.assets ?? []) if (typeof a?.path === 'string' && a.path) allowedMedia.add(norm(a.path));
  } catch {
    /* ignore */
  }
}

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
    backgroundColor: '#0E1014',
    title: 'Qissa',
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
      title: 'Qissa',
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

  ipcMain.handle('media:convert', convertMedia);
  ipcMain.handle('media:save-converted', saveConverted);

  ipcMain.handle('media:exists', async (_e, paths) => {
    if (!Array.isArray(paths)) return [];
    return Promise.all(paths.map((p) => (typeof p === 'string' ? fsp.access(p).then(() => true, () => false) : false)));
  });

  ipcMain.handle('project:save', async (_e, { text, suggestedName, path: current }) => {
    if (typeof text !== 'string') return null;
    let target = typeof current === 'string' && PROJECT_EXT.test(current) ? current : null;
    if (!target && E2E_DIR) target = path.join(E2E_DIR, `${String(suggestedName || 'Project').replace(/[\\/:*?"<>|]+/g, '')}.qissa`);
    if (!target) {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: `${String(suggestedName || 'Project').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'Project'}.qissa`,
        filters: [{ name: 'Qissa Project', extensions: ['qissa'] }],
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
      const f = fs.readdirSync(E2E_DIR).find((n) => PROJECT_EXT.test(n));
      return f ? readProject(path.join(E2E_DIR, f)) : null;
    }
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Qissa Project', extensions: ['qissa', 'kingproj'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return readProject(r.filePaths[0]);
  });

  ipcMain.handle('project:pending', () => !!pendingOpen);

  ipcMain.handle('library:list', async () => {
    const root = libraryRoot();
    const out = [];
    for (const id of await fsp.readdir(root)) {
      if (!validId(id)) continue;
      try {
        out.push(JSON.parse(await fsp.readFile(path.join(root, id, 'meta.json'), 'utf8')));
      } catch {
        /* skip broken entries */
      }
    }
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  });

  ipcMain.handle('library:save', async (_e, meta, text) => {
    if (!meta || !validId(meta.id) || typeof text !== 'string' || text.length > 50 * 1024 * 1024) throw new Error('invalid');
    const dir = projectDir(meta.id);
    await fsp.mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, 'project.qissa'), text);
    await writeAtomic(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, id: meta.id }));
  });

  ipcMain.handle('library:load', async (_e, id) => {
    const dir = projectDir(id);
    try {
      const text = await fsp.readFile(path.join(dir, 'project.qissa'), 'utf8');
      const meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'));
      registerProjectMedia(text);
      return { meta, text };
    } catch {
      return null;
    }
  });

  ipcMain.handle('library:remove', async (_e, id) => {
    const dir = projectDir(id);
    if (!fs.existsSync(dir)) return;
    // Recycle Bin when available, so a deleted project can be recovered.
    await shell.trashItem(dir).catch(() => fsp.rm(dir, { recursive: true, force: true }));
  });

  ipcMain.handle('library:rename', async (_e, id, name) => {
    const dir = projectDir(id);
    const metaFile = path.join(dir, 'meta.json');
    const projFile = path.join(dir, 'project.qissa');
    const clean = String(name ?? '').slice(0, 120);
    const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    await writeAtomic(metaFile, JSON.stringify({ ...meta, name: clean, updatedAt: Date.now() }));
    const proj = JSON.parse(await fsp.readFile(projFile, 'utf8'));
    proj.project.settings.name = clean;
    await writeAtomic(projFile, JSON.stringify(proj));
  });

  ipcMain.handle('library:duplicate', async (_e, id, newId, name) => {
    const src = projectDir(id);
    const dst = projectDir(newId);
    await fsp.cp(src, dst, { recursive: true });
    const now = Date.now();
    const clean = String(name ?? '').slice(0, 120);
    const meta = JSON.parse(await fsp.readFile(path.join(dst, 'meta.json'), 'utf8'));
    await writeAtomic(path.join(dst, 'meta.json'), JSON.stringify({ ...meta, id: newId, name: clean, createdAt: now, updatedAt: now }));
    const proj = JSON.parse(await fsp.readFile(path.join(dst, 'project.qissa'), 'utf8'));
    proj.project.settings.name = clean;
    await writeAtomic(path.join(dst, 'project.qissa'), JSON.stringify(proj));
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());

// A second launch (e.g. double-clicking a .qissa file) focuses the running window.
if (!app.requestSingleInstanceLock()) app.quit();
else
  app.on('second-instance', (_e, argv) => {
    const proj = argv.find((a) => PROJECT_EXT.test(a));
    if (proj) {
      pendingOpen = proj;
      win?.webContents.send('project:open-request');
    }
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
