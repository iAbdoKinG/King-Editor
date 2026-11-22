export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Quantize a time to the project frame grid. */
export function quantize(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export function formatTimecode(t: number, fps: number): string {
  const total = Math.max(0, Math.round(t * fps));
  const f = total % fps;
  const s = Math.floor(total / fps);
  const ss = s % 60;
  const mm = Math.floor(s / 60) % 60;
  const hh = Math.floor(s / 3600);
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${hh > 0 ? p(hh) + ':' : ''}${p(mm)}:${p(ss)}:${p(f)}`;
}

export function formatDuration(t: number): string {
  if (!isFinite(t) || t <= 0) return '—';
  const s = Math.round(t);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const p = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${p(m % 60)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
