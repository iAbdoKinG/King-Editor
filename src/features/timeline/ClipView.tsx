import { memo } from 'react';
import type { Clip, MediaAsset, TrackKind } from '../../types/project';
import { HANDLE_W } from './constants';
import { keyframeTimes } from '../../engine/timeline/animation';
import { WaveformView } from './WaveformView';

interface Props {
  clip: Clip;
  asset: MediaAsset | undefined;
  selected: boolean;
  pps: number;
  height: number;
  kind: TrackKind;
}

const BG: Record<TrackKind, string> = {
  video: 'var(--color-video)',
  audio: 'var(--color-audio)',
  text: 'var(--color-text-clip)',
};

export const ClipView = memo(function ClipView({ clip, asset, selected, pps, height, kind }: Props) {
  const left = clip.start * pps;
  const width = Math.max(3, clip.duration * pps);
  const missing = clip.type === 'media' && !asset;
  const label = clip.type === 'text' ? clip.text.split('\n')[0] || 'Text' : asset?.name ?? 'Missing media';
  const thumb = clip.type === 'media' && asset?.thumbUrl && kind !== 'audio' ? asset.thumbUrl : null;
  const fadeIn = clip.type === 'media' ? clip.audio.fadeIn * pps : 0;
  const fadeOut = clip.type === 'media' ? clip.audio.fadeOut * pps : 0;
  const showFades = kind === 'audio' || (clip.type === 'media' && asset?.kind === 'video');
  const kfTimes = clip.keyframes ? keyframeTimes(clip).filter((t) => t >= 0 && t <= clip.duration) : [];

  return (
    <div
      data-clip-id={clip.id}
      role="button"
      aria-label={`${label} clip`}
      aria-pressed={selected}
      className="absolute top-[3px] rounded-[6px] overflow-visible"
      style={{
        left,
        width,
        height: height - 6,
        background: missing
          ? 'repeating-linear-gradient(45deg,#4a2f2f 0 6px,#3a2626 6px 12px)'
          : BG[kind],
        touchAction: selected ? 'none' : 'pan-x pan-y',
        zIndex: selected ? 3 : 1,
        contain: 'layout style',
      }}
    >
      <div className="absolute inset-0 rounded-[6px] overflow-hidden pointer-events-none">
        {thumb && (
          <div
            className="absolute inset-0 opacity-55"
            style={{ backgroundImage: `url(${thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }}
          />
        )}
        {clip.type === 'media' && asset && (asset.kind === 'audio' || asset.kind === 'video') && (
          <WaveformView
            assetId={asset.id}
            srcIn={clip.in}
            speed={clip.speed}
            duration={clip.duration}
            width={width}
            height={kind === 'audio' ? height - 22 : Math.round((height - 6) * 0.42)}
            gain={clip.audio.volume}
            mode={kind === 'audio' ? 'center' : 'bottom'}
          />
        )}
        {showFades && fadeIn > 0 && (
          <svg className="absolute left-0 top-0 h-full" width={fadeIn} preserveAspectRatio="none" viewBox="0 0 10 10">
            <path d="M0 0L10 0L0 10Z" fill="rgba(0,0,0,0.35)" />
          </svg>
        )}
        {showFades && fadeOut > 0 && (
          <svg className="absolute right-0 top-0 h-full" width={fadeOut} preserveAspectRatio="none" viewBox="0 0 10 10">
            <path d="M0 0L10 0L10 10Z" fill="rgba(0,0,0,0.35)" />
          </svg>
        )}
        <div className="relative flex items-center gap-1 px-2 pt-[3px] text-[11px] font-medium text-text/95 whitespace-nowrap">
          <span className="truncate" style={{ textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>
            {label}
          </span>
          {clip.type === 'media' && clip.speed !== 1 && (
            <span className="shrink-0 rounded bg-black/40 px-1 text-[10px] tnum">{clip.speed}×</span>
          )}
        </div>
      </div>
      {kfTimes.map((t) => (
        <div
          key={t}
          className="pointer-events-none absolute bottom-[3px] h-[7px] w-[7px] -translate-x-1/2 rotate-45 bg-text shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: t * pps }}
        />
      ))}
      <div
        className={`absolute inset-0 rounded-[6px] pointer-events-none ${
          selected ? 'ring-2 ring-accent' : 'ring-1 ring-black/25'
        }`}
      />
      {selected && (
        <>
          <div
            data-handle="start"
            aria-label="Trim start"
            className="absolute top-0 h-full flex items-center justify-center cursor-ew-resize"
            style={{ left: -HANDLE_W / 2, width: HANDLE_W, touchAction: 'none' }}
          >
            <div className="h-[60%] w-[6px] rounded-full bg-accent shadow" />
          </div>
          <div
            data-handle="end"
            aria-label="Trim end"
            className="absolute top-0 h-full flex items-center justify-center cursor-ew-resize"
            style={{ right: -HANDLE_W / 2, width: HANDLE_W, touchAction: 'none' }}
          >
            <div className="h-[60%] w-[6px] rounded-full bg-accent shadow" />
          </div>
        </>
      )}
    </div>
  );
});
