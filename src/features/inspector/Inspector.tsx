/**
 * Context-aware inspector: its content is derived entirely from the current
 * selection (video / image / audio / text clip, or project settings).
 */
import { useState } from 'react';
import type { Clip, MediaAsset, MediaClip, ProjectSettings, TextClip, Transform } from '../../types/project';
import { Icon } from '../../components/Icon';
import { canvasFilterSupported } from '../../engine/rendering/compositor';
import { defaultAudio, defaultEffects, defaultTransform, frameSize } from '../../engine/timeline/model';
import { setClipSpeed, updateClip } from '../../engine/timeline/ops';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore, type PreviewQuality } from '../../stores/uiStore';
import { formatTimecode } from '../../utils/time';
import { Row, Section, Segmented, SliderField, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}`;
const fromPct = (s: string) => parseFloat(s) / 100;

function usePatch(clipId: string) {
  return (fn: (c: Clip) => Clip, commit = true) =>
    useProjectStore.getState().apply((p) => updateClip(p, clipId, fn), { commit });
}

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="mr-2 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-elevated hover:text-text" onClick={onClick} aria-label={label}>
      Reset
    </button>
  );
}

function TransformSection({ clip }: { clip: Clip }) {
  const patch = usePatch(clip.id);
  const t = clip.transform;
  const set = (p: Partial<Transform>, commit: boolean) => patch((c) => ({ ...c, transform: { ...c.transform, ...p } }) as Clip, commit);
  const [uniform, setUniform] = useState(() => Math.abs(t.scaleX - t.scaleY) < 1e-6);
  const settings = useProjectStore((s) => s.project.settings);
  const { width: W, height: H } = frameSize(settings);
  return (
    <Section
      title="Transform"
      action={<ResetButton label="Reset transform" onClick={() => set({ ...defaultTransform(), crop: t.crop }, true)} />}
    >
      <SliderField label="Position X" value={t.x} min={-W} max={W} step={1} onChange={(v, c) => set({ x: v }, c)} />
      <SliderField label="Position Y" value={t.y} min={-H} max={H} step={1} onChange={(v, c) => set({ y: v }, c)} />
      {uniform ? (
        <SliderField
          label="Scale %"
          value={t.scaleX}
          min={0.05}
          max={4}
          step={0.01}
          display={pct}
          parse={fromPct}
          onChange={(v, c) => set({ scaleX: v, scaleY: v }, c)}
        />
      ) : (
        <>
          <SliderField label="Scale X %" value={t.scaleX} min={0.05} max={4} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ scaleX: v }, c)} />
          <SliderField label="Scale Y %" value={t.scaleY} min={0.05} max={4} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ scaleY: v }, c)} />
        </>
      )}
      <Row label="Uniform">
        <Toggle
          label="Uniform scale"
          checked={uniform}
          onChange={(on) => {
            setUniform(on);
            if (on && t.scaleX !== t.scaleY) set({ scaleY: t.scaleX }, true);
          }}
        />
      </Row>
      <SliderField label="Rotation °" value={t.rotation} min={-180} max={180} step={0.5} onChange={(v, c) => set({ rotation: v }, c)} />
      <SliderField label="Opacity %" value={t.opacity} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ opacity: v }, c)} />
      <SliderField label="Anchor X %" value={t.anchorX} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ anchorX: v }, c)} />
      <SliderField label="Anchor Y %" value={t.anchorY} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ anchorY: v }, c)} />
    </Section>
  );
}

function CropSection({ clip }: { clip: MediaClip }) {
  const patch = usePatch(clip.id);
  const cr = clip.transform.crop;
  const set = (p: Partial<Transform['crop']>, commit: boolean) =>
    patch((c) => ({ ...c, transform: { ...c.transform, crop: { ...c.transform.crop, ...p } } }) as Clip, commit);
  const side = (k: keyof Transform['crop'], label: string, other: keyof Transform['crop']) => (
    <SliderField
      label={label}
      value={cr[k]}
      min={0}
      max={0.95 - cr[other]}
      step={0.005}
      display={pct}
      parse={fromPct}
      onChange={(v, c) => set({ [k]: v }, c)}
    />
  );
  return (
    <Section title="Crop" action={<ResetButton label="Reset crop" onClick={() => set({ top: 0, right: 0, bottom: 0, left: 0 }, true)} />}>
      {side('left', 'Left %', 'right')}
      {side('right', 'Right %', 'left')}
      {side('top', 'Top %', 'bottom')}
      {side('bottom', 'Bottom %', 'top')}
    </Section>
  );
}

function EffectsSection({ clip }: { clip: Clip }) {
  const patch = usePatch(clip.id);
  const e = clip.effects;
  const set = (p: Partial<Clip['effects']>, commit: boolean) => patch((c) => ({ ...c, effects: { ...c.effects, ...p } }) as Clip, commit);
  const off = !canvasFilterSupported;
  return (
    <Section title="Color & Effects" action={<ResetButton label="Reset effects" onClick={() => set(defaultEffects(), true)} />}>
      {off && (
        <p className="pb-1 text-[11px] leading-snug text-muted">
          This browser does not support canvas filters, so color effects are unavailable here.
        </p>
      )}
      <SliderField disabled={off} label="Brightness" value={e.brightness} min={0} max={200} onChange={(v, c) => set({ brightness: v }, c)} />
      <SliderField disabled={off} label="Contrast" value={e.contrast} min={0} max={200} onChange={(v, c) => set({ contrast: v }, c)} />
      <SliderField disabled={off} label="Saturation" value={e.saturation} min={0} max={200} onChange={(v, c) => set({ saturation: v }, c)} />
      <SliderField disabled={off} label="Blur px" value={e.blur} min={0} max={40} step={0.5} onChange={(v, c) => set({ blur: v }, c)} />
    </Section>
  );
}

function AudioSection({ clip }: { clip: MediaClip }) {
  const patch = usePatch(clip.id);
  const a = clip.audio;
  const set = (p: Partial<MediaClip['audio']>, commit: boolean) =>
    patch((c) => ({ ...(c as MediaClip), audio: { ...(c as MediaClip).audio, ...p } }), commit);
  const maxFade = Math.max(0, clip.duration / 2);
  return (
    <Section title="Audio" action={<ResetButton label="Reset audio" onClick={() => set(defaultAudio(), true)} />}>
      <SliderField label="Volume %" value={a.volume} min={0} max={2} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ volume: v }, c)} />
      <SliderField
        label="Pan"
        value={a.pan}
        min={-1}
        max={1}
        step={0.05}
        display={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        parse={(s) => {
          const m = s.trim().toUpperCase();
          if (m === 'C') return 0;
          const n = parseFloat(m.replace(/^[LR]/, '')) / 100;
          return m.startsWith('L') ? -n : n;
        }}
        onChange={(v, c) => set({ pan: v }, c)}
      />
      <SliderField label="Fade in s" value={a.fadeIn} min={0} max={maxFade} step={0.05} onChange={(v, c) => set({ fadeIn: v }, c)} />
      <SliderField label="Fade out s" value={a.fadeOut} min={0} max={maxFade} step={0.05} onChange={(v, c) => set({ fadeOut: v }, c)} />
    </Section>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function SpeedSection({ clip }: { clip: MediaClip }) {
  return (
    <Section title="Speed">
      <Row label="Speed">
        <select
          className="field w-full"
          aria-label="Playback speed"
          value={clip.speed}
          onChange={(e) => {
            const speed = parseFloat(e.target.value);
            useProjectStore.getState().apply((p) => setClipSpeed(p, useMediaStore.getState().assets, clip.id, speed));
          }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </Row>
      <p className="text-[11px] leading-snug text-muted">Audio pitch is preserved where the browser supports it.</p>
    </Section>
  );
}

const FONTS = [
  { value: 'Inter Variable', label: 'Inter' },
  { value: 'Georgia', label: 'Georgia (serif)' },
  { value: 'Helvetica Neue', label: 'Helvetica' },
  { value: 'Avenir Next', label: 'Avenir Next' },
  { value: 'Menlo', label: 'Menlo (mono)' },
  { value: 'Courier New', label: 'Courier' },
];

function TextSection({ clip }: { clip: TextClip }) {
  const patch = usePatch(clip.id);
  const s = clip.style;
  const set = (p: Partial<TextClip['style']>, commit = true) =>
    patch((c) => ({ ...(c as TextClip), style: { ...(c as TextClip).style, ...p } }), commit);
  return (
    <Section title="Text">
      <textarea
        className="field !h-auto min-h-[64px] w-full resize-y py-1.5 text-[13px]"
        value={clip.text}
        aria-label="Text content"
        onFocus={() => useProjectStore.getState().begin()}
        onBlur={() => useProjectStore.getState().end()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const text = e.target.value;
          patch((c) => ({ ...(c as TextClip), text }), false);
        }}
      />
      <Row label="Font">
        <select className="field w-full" value={s.fontFamily} aria-label="Font" onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <SliderField label="Size px" value={s.fontSize} min={12} max={400} onChange={(v, c) => set({ fontSize: v }, c)} />
      <Row label="Weight">
        <Segmented
          label="Font weight"
          value={s.fontWeight}
          options={[
            { value: 400, label: 'Regular' },
            { value: 600, label: 'Semi' },
            { value: 800, label: 'Bold' },
          ]}
          onChange={(v) => set({ fontWeight: v })}
        />
      </Row>
      <Row label="Align">
        <Segmented
          label="Alignment"
          value={s.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => set({ align: v })}
        />
      </Row>
      <Row label="Color">
        <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" value={s.color} aria-label="Text color" onChange={(e) => set({ color: e.target.value })} />
        <span className="tnum text-[12px] text-muted">{s.color.toUpperCase()}</span>
      </Row>
      <Row label="Shadow">
        <Toggle label="Text shadow" checked={s.shadow} onChange={(v) => set({ shadow: v })} />
      </Row>
      <Row label="Background">
        <Toggle label="Text background" checked={!!s.background} onChange={(v) => set({ background: v ? '#15191DCC' : null })} />
        {s.background && (
          <input
            type="color"
            className="h-8 w-12 rounded border border-line bg-transparent"
            value={s.background.slice(0, 7)}
            aria-label="Background color"
            onChange={(e) => set({ background: `${e.target.value}CC` })}
          />
        )}
      </Row>
    </Section>
  );
}

function ClipHeader({ clip, asset }: { clip: Clip; asset?: MediaAsset }) {
  const fps = useProjectStore((s) => s.project.settings.fps);
  const kind = clip.type === 'text' ? 'Text' : asset?.kind === 'audio' ? 'Audio' : asset?.kind === 'image' ? 'Image' : 'Video';
  return (
    <div className="border-b border-line/70 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">{kind} clip</div>
      <div className="truncate text-[13px] font-medium" title={asset?.name}>
        {clip.type === 'text' ? clip.text.split('\n')[0] || 'Text' : asset?.name ?? 'Missing media'}
      </div>
      <div className="tnum mt-0.5 text-[11px] text-muted">
        Start {formatTimecode(clip.start, fps)} · Duration {formatTimecode(clip.duration, fps)}
        {clip.type === 'media' && asset && asset.kind !== 'image' ? ` · In ${formatTimecode(clip.in, fps)}` : ''}
      </div>
    </div>
  );
}

function ProjectInspector() {
  const settings = useProjectStore((s) => s.project.settings);
  const apply = useProjectStore((s) => s.apply);
  const quality = useUIStore((s) => s.quality);
  const showStats = useUIStore((s) => s.showStats);
  const setUI = useUIStore((s) => s.set);
  const set = (p: Partial<ProjectSettings>) => apply((pr) => ({ ...pr, settings: { ...pr.settings, ...p } }));
  const { width, height } = frameSize(settings);
  return (
    <>
      <div className="border-b border-line/70 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Project</div>
        <div className="text-[12px] text-muted">Select a clip to edit its properties.</div>
      </div>
      <Section title="Format">
        <Row label="Aspect">
          <select className="field w-full" aria-label="Aspect ratio" value={settings.aspect} onChange={(e) => set({ aspect: e.target.value as ProjectSettings['aspect'] })}>
            {['16:9', '9:16', '1:1', '4:5', '4:3'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Row>
        <Row label="Resolution">
          <Segmented
            label="Resolution"
            value={settings.resolution}
            options={[
              { value: 720, label: '720p' },
              { value: 1080, label: '1080p' },
            ]}
            onChange={(v) => set({ resolution: v })}
          />
        </Row>
        <Row label="Frame rate">
          <Segmented
            label="Frame rate"
            value={settings.fps}
            options={[24, 25, 30, 60].map((f) => ({ value: f as ProjectSettings['fps'], label: `${f}` }))}
            onChange={(v) => set({ fps: v })}
          />
        </Row>
        <Row label="Frame">
          <span className="tnum text-[12px] text-text/80">
            {width} × {height}
          </span>
        </Row>
        <Row label="Background">
          <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" aria-label="Background color" value={settings.background} onChange={(e) => set({ background: e.target.value })} />
        </Row>
      </Section>
      <Section title="Preview">
        <Row label="Quality">
          <Segmented<PreviewQuality>
            label="Preview quality"
            value={quality}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'half', label: 'Half' },
              { value: 'quarter', label: 'Quarter' },
            ]}
            onChange={(v) => setUI({ quality: v })}
          />
        </Row>
        <Row label="Perf stats">
          <Toggle label="Show performance stats" checked={showStats} onChange={(v) => setUI({ showStats: v })} />
        </Row>
        <p className="text-[11px] leading-snug text-muted">Lower preview quality reduces GPU and memory load on older devices.</p>
      </Section>
    </>
  );
}

export function Inspector({ onClose }: { onClose?: () => void }) {
  const clip = useProjectStore((s) => (s.selectedClipId ? s.project.clips[s.selectedClipId] : null));
  const asset = useMediaStore((s) => (clip?.type === 'media' ? s.assets[clip.assetId] : undefined));

  let body;
  if (!clip) body = <ProjectInspector />;
  else if (clip.type === 'text')
    body = (
      <>
        <TextSection clip={clip} />
        <TransformSection key={clip.id} clip={clip} />
        <EffectsSection clip={clip} />
      </>
    );
  else if (!asset) body = <p className="p-3 text-[12px] text-muted">The media for this clip was removed.</p>;
  else if (asset.kind === 'audio')
    body = (
      <>
        <AudioSection clip={clip} />
        <SpeedSection clip={clip} />
      </>
    );
  else
    body = (
      <>
        <TransformSection key={clip.id} clip={clip} />
        <CropSection clip={clip} />
        {asset.kind === 'video' && <SpeedSection clip={clip} />}
        <EffectsSection clip={clip} />
        {asset.kind === 'video' && <AudioSection clip={clip} />}
      </>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Inspector</h2>
        {onClose && (
          <button className="icon-btn !h-8 !min-w-8" aria-label="Close inspector" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {clip && <ClipHeader clip={clip} asset={asset} />}
        {body}
      </div>
    </div>
  );
}
