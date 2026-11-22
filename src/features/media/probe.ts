/**
 * Metadata probing and thumbnail generation using native media elements.
 * Files are never read fully into JS memory: the browser streams from the
 * object URL.
 */
import type { MediaKind } from '../../types/project';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|3gp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|caf|aif|aiff)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i;

export function detectKind(file: File): MediaKind | null {
  const t = file.type;
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  if (VIDEO_EXT.test(file.name)) return 'video';
  if (AUDIO_EXT.test(file.name)) return 'audio';
  if (IMAGE_EXT.test(file.name)) return 'image';
  return null;
}

export interface ProbeResult {
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
}

function once(el: EventTarget, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('decode'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

async function resolveDuration(el: HTMLMediaElement): Promise<number> {
  if (isFinite(el.duration) && el.duration > 0) return el.duration;
  // Some recorded WebM files report Infinity until the end is sought.
  try {
    el.currentTime = 1e7;
    await once(el, 'durationchange', 4000);
  } catch {
    /* ignore */
  }
  const d = el.duration;
  el.currentTime = 0;
  return isFinite(d) && d > 0 ? d : 0;
}

function disposeMedia(el: HTMLMediaElement): void {
  el.removeAttribute('src');
  el.load();
}

export async function probe(url: string, kind: MediaKind): Promise<ProbeResult> {
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { kind, duration: 0, width: img.naturalWidth, height: img.naturalHeight };
  }
  const el = document.createElement(kind === 'video' ? 'video' : 'audio');
  el.preload = 'metadata';
  el.muted = true;
  if (el instanceof HTMLVideoElement) el.playsInline = true;
  el.src = url;
  try {
    await once(el, 'loadedmetadata', 15000);
    const duration = await resolveDuration(el);
    let width = 0;
    let height = 0;
    let finalKind: MediaKind = kind;
    if (el instanceof HTMLVideoElement) {
      width = el.videoWidth;
      height = el.videoHeight;
      if (!width || !height) finalKind = 'audio'; // audio-only container
    }
    if (!duration) throw new Error('duration');
    return { kind: finalKind, duration, width, height };
  } finally {
    disposeMedia(el);
  }
}

/* ---------- thumbnails (one at a time to limit concurrent decoding) ---------- */

let queue: Promise<unknown> = Promise.resolve();

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : undefined), 'image/jpeg', 0.72);
  });
}

function drawThumb(src: CanvasImageSource, sw: number, sh: number): HTMLCanvasElement {
  const H = 120;
  const W = Math.max(1, Math.round((sw / sh) * H)) || 160;
  const c = document.createElement('canvas');
  c.width = Math.min(W, 240);
  c.height = H;
  const ctx = c.getContext('2d')!;
  // cover-fit
  const k = Math.max(c.width / sw, c.height / sh);
  const dw = sw * k;
  const dh = sh * k;
  ctx.drawImage(src, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
  return c;
}

export function makeThumbnail(url: string, kind: MediaKind, duration: number): Promise<string | undefined> {
  const job = queue.then(async () => {
    if (kind === 'audio') return undefined;
    if (kind === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      return canvasToUrl(drawThumb(img, img.naturalWidth, img.naturalHeight));
    }
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    try {
      await once(v, 'loadeddata', 10000);
      v.currentTime = Math.min(1, duration * 0.1);
      await once(v, 'seeked', 8000);
      return await canvasToUrl(drawThumb(v, v.videoWidth, v.videoHeight));
    } catch {
      return undefined;
    } finally {
      disposeMedia(v);
    }
  });
  queue = job.catch(() => undefined);
  return job.catch(() => undefined);
}
