import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon';
import { engine } from '../../engine/playback/engine';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore, type PreviewQuality } from '../../stores/uiStore';
import type { AspectPreset } from '../../types/project';
import { formatTimecode } from '../../utils/time';
import { seekBy, stepFrames, togglePlay } from '../timeline/actions';

export function usePlaying(): boolean {
  return useSyncExternalStore(
    (cb) => engine.clock.subscribe(cb),
    () => engine.clock.playing,
  );
}

/** Timecode written directly to the DOM each frame (no React renders). */
function Timecode({ compact }: { compact: boolean }) {
  const fps = useProjectStore((s) => s.project.settings.fps);
  const ref = useRef<HTMLSpanElement>(null);
  const durRef = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      engine.onTime((t) => {
        if (ref.current) ref.current.textContent = formatTimecode(t, fps);
      }),
    [fps],
  );
  const project = useProjectStore((s) => s.project);
  useEffect(() => {
    if (durRef.current) durRef.current.textContent = formatTimecode(engine.clock.duration, fps);
  }, [project, fps]);
  return (
    <div className={`tnum flex items-baseline gap-1 font-mono ${compact ? 'text-[11px]' : 'text-[12px]'}`} aria-live="off">
      <span ref={ref} className="text-text" data-testid="timecode">
        00:00:00
      </span>
      <span className={compact ? 'hidden' : 'text-muted'}>/</span>
      <span ref={durRef} className={compact ? 'hidden' : 'text-muted'} />
    </div>
  );
}

export function Transport({ compact, onFullscreen }: { compact: boolean; onFullscreen: () => void }) {
  const playing = usePlaying();
  const aspect = useProjectStore((s) => s.project.settings.aspect);
  const apply = useProjectStore((s) => s.apply);
  const quality = useUIStore((s) => s.quality);
  const renderer = useUIStore((s) => s.renderer);
  const setUI = useUIStore((s) => s.set);

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-t border-line bg-surface px-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Timecode compact={compact} />
      </div>
      <div className="flex shrink-0 items-center">
        {!compact && (
          <button className="icon-btn" aria-label="Go to start" onClick={() => engine.seek(0)}>
            <Icon name="toStart" size={18} />
          </button>
        )}
        <button className="icon-btn" aria-label="Previous frame" onClick={() => stepFrames(-1)}>
          <Icon name="stepBack" size={18} />
        </button>
        <button
          className="icon-btn mx-1 !h-11 !w-11 rounded-full bg-text !text-bg hover:opacity-90"
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play-toggle"
          onClick={togglePlay}
        >
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <button className="icon-btn" aria-label="Next frame" onClick={() => stepFrames(1)}>
          <Icon name="stepFwd" size={18} />
        </button>
        {!compact && (
          <button className="icon-btn" aria-label="Forward 1 second" onClick={() => seekBy(1)}>
            <span className="text-[11px] font-semibold">+1s</span>
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <select
          className="field !h-8 !w-auto !pr-1 text-[12px]"
          aria-label="Aspect ratio"
          value={aspect}
          onChange={(e) => apply((p) => ({ ...p, settings: { ...p.settings, aspect: e.target.value as AspectPreset } }))}
        >
          {(['16:9', '9:16', '1:1', '4:5', '4:3'] as AspectPreset[]).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        {!compact && renderer === 'canvas' && (
          <select
            className="field !h-8 !w-auto !pr-1 text-[12px]"
            aria-label="Preview quality"
            value={quality}
            onChange={(e) => setUI({ quality: e.target.value as PreviewQuality })}
          >
            <option value="full">Full</option>
            <option value="half">Half</option>
            <option value="quarter">Quarter</option>
          </select>
        )}
        <button className="icon-btn" aria-label="Fullscreen preview" onClick={onFullscreen}>
          <Icon name="fullscreen" size={17} />
        </button>
      </div>
    </div>
  );
}
