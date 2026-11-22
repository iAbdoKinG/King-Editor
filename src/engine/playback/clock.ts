/**
 * The single master timeline clock. Every renderer and media element follows
 * this clock; no media element is allowed to drive time on its own.
 *
 * High-frequency time is intentionally kept out of React state: consumers read
 * `now()` inside requestAnimationFrame or subscribe to the low-frequency
 * play/pause/seek state changes.
 */
type Listener = () => void;

export class TimelineClock {
  private anchorPerf = 0;
  private anchorTime = 0;
  private _playing = false;
  private _holding = false;
  private _duration = 0;
  private stateListeners = new Set<Listener>();
  /** Incremented on every discontinuity (seek / play / pause). */
  epoch = 0;

  get playing(): boolean {
    return this._playing;
  }

  get duration(): number {
    return this._duration;
  }

  setDuration(d: number): void {
    this._duration = d;
    if (this.now() > d && !this._playing) this.seek(d);
  }

  now(): number {
    if (!this._playing || this._holding) return this.anchorTime;
    return this.anchorTime + (performance.now() - this.anchorPerf) / 1000;
  }

  /**
   * Advance check, called once per frame by the engine. Stops at the end of
   * the timeline.
   */
  tick(): number {
    const t = this.now();
    if (this._playing && t >= this._duration) {
      this.anchorTime = this._duration;
      this._playing = false;
      this._holding = false;
      this.epoch++;
      this.emit();
      return this._duration;
    }
    return t;
  }

  play(): void {
    if (this._playing) return;
    if (this.anchorTime >= this._duration - 1e-3) this.anchorTime = 0;
    this.anchorPerf = performance.now();
    this._playing = true;
    this.epoch++;
    this.emit();
  }

  pause(): void {
    if (!this._playing) return;
    this.anchorTime = this.now();
    this._playing = false;
    this._holding = false;
    this.epoch++;
    this.emit();
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    this.anchorTime = Math.max(0, Math.min(t, this._duration || 0));
    this.anchorPerf = performance.now();
    this.epoch++;
    this.emit();
  }

  /**
   * Gently steer the clock toward `target` (the lead media element's time).
   * Small errors are corrected gradually (no visible jumps); large ones snap.
   */
  follow(target: number): void {
    if (!this._playing) return;
    const err = target - this.now();
    if (Math.abs(err) > 0.5) {
      this.anchorTime = target;
      this.anchorPerf = performance.now();
      this._holding = false;
    } else if (Math.abs(err) > 0.004) {
      this.anchorTime += err * 0.12;
    }
  }

  /**
   * Freeze time while required media is buffering so that audio and video
   * stay in sync instead of jumping once data arrives.
   */
  hold(on: boolean): void {
    if (on === this._holding || !this._playing) return;
    if (on) this.anchorTime = this.now();
    else this.anchorPerf = performance.now();
    this._holding = on;
  }

  get holding(): boolean {
    return this._holding;
  }

  subscribe(fn: Listener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.stateListeners) fn();
  }
}
