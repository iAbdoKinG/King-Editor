/**
 * The playback engine: one requestAnimationFrame loop that advances the
 * master clock, keeps media elements in sync, and draws the preview canvas.
 * The loop sleeps when nothing changes so an idle editor costs ~nothing.
 */
import type { MediaAsset, Project } from '../../types/project';
import { TimelineClock } from './clock';
import { MediaPool } from './mediaPool';
import { renderFrame } from '../rendering/compositor';
import { imageCache } from '../rendering/imageCache';
import { projectDuration } from '../timeline/model';

type TimeListener = (t: number) => void;

export interface EngineStats {
  fps: number;
  renderMs: number;
}

class PlaybackEngine {
  readonly clock = new TimelineClock();
  private pool: MediaPool | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dirty = true;
  private running = false;
  private idleFrames = 0;
  private lastT = -1;
  private lastProject: Project | null = null;
  private lastAssets: Record<string, MediaAsset> | null = null;
  private timeListeners = new Set<TimeListener>();
  private frameListeners = new Set<() => void>();
  private getState: () => { project: Project; assets: Record<string, MediaAsset> } = () => ({
    project: null as unknown as Project,
    assets: {},
  });
  // instrumentation
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  stats: EngineStats = { fps: 0, renderMs: 0 };

  init(getState: () => { project: Project; assets: Record<string, MediaAsset> }): void {
    this.getState = getState;
    if (!this.pool) {
      this.pool = new MediaPool();
      this.pool.onFrame = () => this.invalidate();
      imageCache.onLoad = () => this.invalidate();
    }
    this.clock.subscribe(() => this.wake());
  }

  get mediaPool(): MediaPool | null {
    return this.pool;
  }

  /** Call from any user-gesture handler (iOS media unlock). */
  gesture(): void {
    this.pool?.bless();
  }

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false, desynchronized: true }) : null;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    this.wake();
  }

  onTime(fn: TimeListener): () => void {
    this.timeListeners.add(fn);
    fn(this.clock.now());
    return () => this.timeListeners.delete(fn);
  }

  /** Called after each drawn frame (used by overlays that follow the picture). */
  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  projectChanged(project: Project): void {
    this.clock.setDuration(projectDuration(project));
    this.invalidate();
  }

  seek(t: number): void {
    this.clock.seek(t);
  }

  wake(): void {
    if (this.running) return;
    this.running = true;
    this.idleFrames = 0;
    requestAnimationFrame(this.loop);
  }

  pauseAndRelease(): void {
    this.clock.pause();
    this.pool?.releaseAll();
  }

  private loop = (now: number): void => {
    const t = this.clock.tick();
    const { project, assets } = this.getState();
    const playing = this.clock.playing;
    const changed = project !== this.lastProject || assets !== this.lastAssets || t !== this.lastT;
    if (this.pool && (playing || changed || this.dirty || this.pool.busy)) {
      const r = this.pool.sync(project, assets, t, playing);
      this.clock.hold(r.stalled);
    }
    const draw = playing || changed || this.dirty || (this.pool?.busy ?? false);
    if (draw && this.ctx) {
      const r0 = performance.now();
      renderFrame(this.ctx, { project, assets, t, source: this.pool! });
      const r1 = performance.now();
      this.stats.renderMs = this.stats.renderMs * 0.9 + (r1 - r0) * 0.1;
      this.dirty = false;
      for (const fn of this.frameListeners) fn();
    }
    if (t !== this.lastT) for (const fn of this.timeListeners) fn(t);
    this.lastT = t;
    this.lastProject = project;
    this.lastAssets = assets;

    if (this.lastFrameAt) {
      this.frameTimes.push(now - this.lastFrameAt);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.stats.fps = avg > 0 ? 1000 / avg : 0;
    }
    this.lastFrameAt = now;

    if (draw || playing) this.idleFrames = 0;
    else this.idleFrames++;
    if (this.idleFrames > 20) {
      this.running = false;
      this.lastFrameAt = 0;
      this.frameTimes = [];
      return;
    }
    requestAnimationFrame(this.loop);
  };
}

export const engine = new PlaybackEngine();
