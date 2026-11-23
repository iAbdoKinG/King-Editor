import { useEffect, useRef, useState } from 'react';
import { isDesktop } from '../../desktop/bridge';
import { t as T } from '../../i18n';
import { Icon } from '../../components/Icon';
import { engine } from '../../engine/playback/engine';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { formatBytes, formatDuration } from '../../utils/time';
import { Segmented } from '../inspector/controls';
import type { ExportPhase, ExportPlan, ExportResult, ExportSettings } from './exporter';

/** The encoder (mediabunny) is only downloaded when the export dialog is used. */
const loadExporter = () => import('./exporter');

type State =
  | { kind: 'setup' }
  | { kind: 'running'; progress: number; phase: ExportPhase; startedAt: number }
  | { kind: 'done'; result: ExportResult; url: string }
  | { kind: 'error'; message: string };

const PHASE_LABEL: Record<ExportPhase, string> = {
  preparing: 'Preparing…',
  audio: 'Mixing audio…',
  video: 'Rendering video…',
  finalizing: 'Finalizing file…',
  verifying: 'Verifying file…',
};

const CODEC_LABEL: Record<string, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
  aac: 'AAC',
  opus: 'Opus',
};

async function keepAwake(): Promise<(() => void) | null> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request(
      'screen',
    );
    return lock ? () => void lock.release().catch(() => undefined) : null;
  } catch {
    return null;
  }
}

export function ExportDialog() {
  const open = useUIStore((s) => s.exportOpen);
  const set = useUIStore((s) => s.set);
  const project = useProjectStore((s) => s.project);
  const assets = useMediaStore((s) => s.assets);
  const [settings, setSettings] = useState<ExportSettings>({ height: 1080, fps: 30 });
  const [plan, setPlan] = useState<ExportPlan | { error: string } | null>(null);
  const [state, setState] = useState<State>({ kind: 'setup' });
  const abortRef = useRef<AbortController | null>(null);

  // Default frame rate follows the project.
  useEffect(() => {
    if (open && state.kind === 'setup') setSettings((s) => ({ ...s, fps: project.settings.fps }));
  }, [open]);

  useEffect(() => {
    if (!open || state.kind !== 'setup') return;
    let live = true;
    setPlan(null);
    void loadExporter()
      .then((m) => m.planExport(project, assets, settings))
      .then((p) => {
        if (!live) return;
        setPlan(p);
        if (!('error' in p)) void import('../advisor/advisor').then((a) => a.checkExport(p.duration, p.height, p.fps));
      })
      .catch(() => live && setPlan({ error: T('Could not load the encoder. Check your connection and try again.') }));
    return () => {
      live = false;
    };
  }, [open, settings, project, assets, state.kind]);

  if (!open) return null;

  const close = () => {
    if (state.kind === 'running') return;
    if (state.kind === 'done') URL.revokeObjectURL(state.url);
    setState({ kind: 'setup' });
    set({ exportOpen: false });
  };

  const start = async () => {
    if (!plan || 'error' in plan) return;
    engine.clock.pause();
    const ac = new AbortController();
    abortRef.current = ac;
    const release = await keepAwake();
    const startedAt = performance.now();
    setState({ kind: 'running', progress: 0, phase: 'preparing', startedAt });
    try {
      const { runExport } = await loadExporter();
      const result = await runExport(
        useProjectStore.getState().project,
        useMediaStore.getState().assets,
        plan,
        (progress, phase) => setState({ kind: 'running', progress, phase, startedAt }),
        ac.signal,
      );
      setState({ kind: 'done', result, url: URL.createObjectURL(result.blob) });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || ac.signal.aborted) setState({ kind: 'setup' });
      else setState({ kind: 'error', message: (e as Error).message || T('Export failed.') });
    } finally {
      release?.();
      abortRef.current = null;
    }
  };

  const file = state.kind === 'done' ? new File([state.result.blob], state.result.filename, { type: state.result.mime }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (state.kind === 'setup') {
    const ok = plan && !('error' in plan) ? plan : null;
    body = (
      <>
        <div className="grid grid-cols-[90px_1fr] items-center gap-x-3 gap-y-3">
          <span className="text-[12px] text-muted">{T("Resolution")}</span>
          <Segmented<720 | 1080 | 1440>
            label={T("Export resolution")}
            value={settings.height}
            options={[
              { value: 720, label: '720p' },
              { value: 1080, label: '1080p' },
              { value: 1440, label: '2K' },
            ]}
            onChange={(v) => setSettings((s) => ({ ...s, height: v }))}
          />
          <span className="text-[12px] text-muted">{T("Frame rate")}</span>
          <Segmented<ExportSettings['fps']>
            label={T("Export frame rate")}
            value={settings.fps}
            options={([24, 25, 30, 60] as const).map((f) => ({ value: f, label: `${f}` }))}
            onChange={(v) => setSettings((s) => ({ ...s, fps: v }))}
          />
        </div>
        <div className="rounded-xl border border-line bg-bg/60 p-3 text-[12px] leading-relaxed">
          {!plan && <span className="text-muted">{T("Checking this device’s encoders…")}</span>}
          {plan && 'error' in plan && <span className="text-danger">{T(plan.error)}</span>}
          {ok && (
            <>
              <div>
                <span className="text-muted">{T("Output:")} </span>
                <bdi dir="ltr">
                  {ok.width}×{ok.height} · {ok.fps} fps · {ok.container.toUpperCase()} ({CODEC_LABEL[ok.videoCodec]}
                  {ok.audioCodec ? ` + ${CODEC_LABEL[ok.audioCodec]}` : T(', no audio')})
                </bdi>
              </div>
              <div>
                <span className="text-muted">{T("Length:")} </span>
                <bdi dir="ltr">{formatDuration(ok.duration)}</bdi>
              </div>
              {ok.container === 'webm' && (
                <div className="mt-1 text-muted">{T("This browser cannot encode MP4, so the file will be WebM.")}</div>
              )}
            </>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted">
          {T('Rendering happens on this device and your media is not uploaded. Keep the app open in the foreground until it finishes.')}
        </p>
      </>
    );
    footer = (
      <>
        <button className="h-10 rounded-lg px-4 text-[13px] text-muted hover:bg-elevated hover:text-text" onClick={close}>
          {T('Cancel')}
        </button>
        <button
          className="h-10 rounded-lg bg-accent px-4 text-[13px] font-semibold text-on-accent"
          disabled={!ok}
          onClick={start}
          data-testid="export-start"
        >
          {T('Export video')}
        </button>
      </>
    );
  } else if (state.kind === 'running') {
    const elapsed = (performance.now() - state.startedAt) / 1000;
    const eta = state.progress > 0.12 ? (elapsed / state.progress) * (1 - state.progress) : null;
    body = (
      <div className="py-2" aria-live="polite">
        <div className="mb-2 flex justify-between text-[12px]">
          <span>{T(PHASE_LABEL[state.phase])}</span>
          <span className="tnum text-muted">
            {Math.round(state.progress * 100)}%{eta !== null ? ` · ${T('~{t} left', { t: formatDuration(Math.max(1, eta)) })}` : ''}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${state.progress * 100}%` }} />
        </div>
        <p className="mt-3 text-[11px] text-muted">{T("Keep this screen open.")}</p>
      </div>
    );
    footer = (
      <button className="h-10 rounded-lg px-4 text-[13px] text-danger hover:bg-elevated" onClick={() => abortRef.current?.abort()} data-testid="export-cancel">
        {T('Cancel export')}
      </button>
    );
  } else if (state.kind === 'done') {
    const r = state.result;
    body = (
      <div className="space-y-3" data-testid="export-done">
        {r.playableHere && <video src={state.url} controls playsInline className="max-h-[38vh] w-full rounded-lg bg-black" />}
        <div className="text-[12px] leading-relaxed">
          <div className="font-medium text-text">{r.filename}</div>
          <div className="tnum text-muted">
            <bdi dir="ltr">{r.width}×{r.height} · {formatDuration(r.duration)} · {formatBytes(r.blob.size)}</bdi>
          </div>
          {!r.playableHere && <div className="text-muted">{T("This browser can’t preview this format, but the file was verified as valid.")}</div>}
        </div>
      </div>
    );
    footer = (
      <>
        <button className="h-10 rounded-lg px-4 text-[13px] text-muted hover:bg-elevated hover:text-text" onClick={close}>
          {T('Close')}
        </button>
        <a
          className="flex h-10 items-center rounded-lg border border-line px-4 text-[13px] font-medium hover:bg-elevated"
          href={state.url}
          download={r.filename}
          data-testid="export-download"
        >
          {T(isDesktop ? 'Save video…' : 'Download')}
        </a>
        {canShare && (
          <button
            className="h-10 rounded-lg bg-accent px-4 text-[13px] font-semibold text-on-accent"
            onClick={() => void navigator.share({ files: [file!], title: r.filename }).catch(() => undefined)}
          >
            {T('Save / Share')}
          </button>
        )}
      </>
    );
  } else {
    body = <p className="text-[13px] text-danger">{T(state.message)}</p>;
    footer = (
      <>
        <button className="h-10 rounded-lg px-4 text-[13px] text-muted hover:bg-elevated hover:text-text" onClick={close}>
          {T('Close')}
        </button>
        <button className="h-10 rounded-lg border border-line px-4 text-[13px]" onClick={() => setState({ kind: 'setup' })}>
          {T('Back')}
        </button>
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
      data-testid="export-dialog"
    >
      <div className="sheet-in w-full max-w-md rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="export-title" className="text-[15px] font-semibold">
            {T('Export video')}
          </h2>
          {state.kind !== 'running' && (
            <button className="icon-btn !h-8 !min-w-8" aria-label={T("Close")} onClick={close}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <div className="space-y-3 px-4 py-4">{body}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
      </div>
    </div>
  );
}
