/**
 * Universal import: files the browser cannot play directly (TS, MKV, AVI,
 * FLV, WMV, MPG, VOB, AC3, WMA, …) are converted on this device to an MP4/M4A
 * the editor can use. The original file is never modified or uploaded.
 *
 *  1. mediabunny (WebCodecs): fast; copies streams without re-encoding when
 *     possible. Reads MP4/MOV, MPEG-TS, Matroska/WebM, Ogg, WAV, MP3, AAC, FLAC.
 *  2. FFmpeg compiled to WebAssembly: every other container/codec. Downloaded
 *     only when first needed (self-hosted, ~32 MB, cached for offline use).
 */
import type { MediaKind } from '../../types/project';

/** Containers every supported browser plays natively. Anything else is converted. */
const NATIVE = /\.(mp4|m4v|mov|webm|mp3|m4a|aac|wav|ogg|oga|opus|flac|png|jpe?g|gif|webp|avif|bmp|svg)$/i;

export function needsConversion(file: File, kind: MediaKind): boolean {
  if (kind === 'image') return false;
  return !NATIVE.test(file.name);
}

/** Browser conversion buffers the file in memory; very large files belong in the desktop app. */
export const MAX_BROWSER_CONVERT_BYTES = 1.5 * 1024 ** 3;

export class ConversionError extends Error {}

function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || 'media';
}

async function withMediabunny(file: File, kind: MediaKind, onProgress: (p: number) => void): Promise<File | null> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    let vt, at;
    try {
      vt = kind === 'video' ? await input.getPrimaryVideoTrack() : null;
      at = await input.getPrimaryAudioTrack();
    } catch {
      return null; // container not readable here
    }
    if (!vt && !at) return null;
    if (vt && !(await vt.canDecode())) return null;
    if (at && !(await at.canDecode())) return null;
    const videoCodec = vt ? ((await mb.canEncodeVideo('avc').catch(() => false)) ? 'avc' : null) : null;
    if (vt && !videoCodec) return null;
    const audioCodec = at ? ((await mb.canEncodeAudio('aac').catch(() => false)) ? 'aac' : 'opus') : null;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const conv = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: vt ? { codec: videoCodec! } : { discard: true },
      audio: at ? { codec: audioCodec! } : { discard: true },
    });
    if (!conv.isValid) return null;
    conv.onProgress = (p) => onProgress(Math.min(0.99, p));
    await conv.execute();
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf?.byteLength) return null;
    const audioOnly = !vt;
    return new File([buf], `${baseName(file.name)}.${audioOnly ? 'm4a' : 'mp4'}`, { type: audioOnly ? 'audio/mp4' : 'video/mp4' });
  } finally {
    input.dispose();
  }
}

async function withFfmpegWasm(file: File, kind: MediaKind, onProgress: (p: number) => void): Promise<File> {
  if (file.size > MAX_BROWSER_CONVERT_BYTES) throw new ConversionError('too-large');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg();
  const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, location.href).toString();
  try {
    await ff.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` });
  } catch {
    throw new ConversionError('engine-unavailable');
  }
  const handler = ({ progress }: { progress: number }) => {
    if (isFinite(progress) && progress >= 0) onProgress(Math.min(0.99, progress));
  };
  ff.on('progress', handler);
  try {
    const ext = (file.name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase();
    const inName = `in.${ext}`;
    await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    const audioOnly = kind === 'audio';
    const outName = audioOnly ? 'out.m4a' : 'out.mp4';
    const args = audioOnly
      ? ['-i', inName, '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', outName]
      : ['-i', inName, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outName];
    const code = await ff.exec(args);
    if (code !== 0) throw new ConversionError('failed');
    const data = (await ff.readFile(outName)) as Uint8Array;
    if (!data?.byteLength) throw new ConversionError('failed');
    return new File([data as BlobPart], `${baseName(file.name)}.${audioOnly ? 'm4a' : 'mp4'}`, { type: audioOnly ? 'audio/mp4' : 'video/mp4' });
  } finally {
    ff.off('progress', handler);
    ff.terminate();
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** Convert one file to a playable MP4/M4A (queued: one conversion at a time). */
export function convertInBrowser(file: File, kind: MediaKind, onProgress: (p: number) => void): Promise<File> {
  const job = queue.then(async () => {
    onProgress(0);
    const fast = await withMediabunny(file, kind, onProgress).catch(() => null);
    if (fast) return fast;
    return withFfmpegWasm(file, kind, onProgress);
  });
  queue = job.catch(() => undefined);
  return job;
}

export function conversionMessage(e: unknown): string {
  const m = (e as Error)?.message;
  if (m === 'too-large') return 'This file is too large to convert in the browser. Use the Windows app.';
  if (m === 'engine-unavailable') return 'The converter could not be loaded. Check your connection and try again.';
  return 'This file could not be converted.';
}
