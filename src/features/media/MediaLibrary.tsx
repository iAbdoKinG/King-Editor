import { memo, useRef, useState } from 'react';
import { t as T } from '../../i18n';
import { Icon } from '../../components/Icon';
import { deleteClips } from '../../engine/timeline/ops';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { MediaAsset } from '../../types/project';
import { formatBytes, formatDuration } from '../../utils/time';
import { addAssetToTimeline } from '../timeline/actions';
import { ASSET_DRAG_TYPE } from '../timeline/constants';

const ACCEPT = 'video/*,audio/*,image/*,.mov,.m4v,.mkv,.m4a,.flac,.caf';

export function ImportButton({ className = '', label }: { className?: string; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const importFiles = useMediaStore((s) => s.importFiles);
  const toast = useUIStore((s) => s.toast);
  return (
    <>
      <button
        className={`flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-strong ${className}`}
        onClick={() => input.current?.click()}
        data-testid="import-button"
      >
        <Icon name="plus" size={16} />
        {label ?? T('Import')}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) return;
          const { rejected } = await importFiles(files);
          e.target.value = '';
          if (rejected.length) toast(T('Unsupported file type: {names}', { names: rejected.join(', ') }), 'error');
        }}
      />
    </>
  );
}

const KIND_ICON = { video: 'film', audio: 'music', image: 'image' } as const;

const AssetRow = memo(function AssetRow({ asset, usage }: { asset: MediaAsset; usage: number }) {
  const remove = useMediaStore((s) => s.remove);
  const onRemove = () => {
    if (usage > 0) {
      if (!window.confirm(T('“{name}” is used by {n} clip(s). Remove it and those clips?', { name: asset.name, n: usage }))) return;
      const ps = useProjectStore.getState();
      const ids = Object.values(ps.project.clips)
        .filter((c) => c.type === 'media' && c.assetId === asset.id)
        .map((c) => c.id);
      ps.apply((p) => deleteClips(p, ids));
      ps.select(null);
    }
    remove(asset.id);
  };
  const meta = [
    asset.kind !== 'image' ? formatDuration(asset.duration) : null,
    asset.width ? `${asset.width}×${asset.height}` : null,
    formatBytes(asset.size),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li
      className="group flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-white/[0.03]"
      draggable={asset.status === 'ready'}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      data-testid="asset-row"
    >
      <div className="relative flex h-11 w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated text-muted">
        {asset.thumbUrl ? (
          <img src={asset.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <Icon name={KIND_ICON[asset.kind]} size={18} />
        )}
        {asset.status === 'loading' && <div className="absolute inset-0 animate-pulse bg-white/5" />}
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-text/90">
          {T(asset.kind)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-text" title={asset.name}>
          {asset.name}
        </div>
        <div className={`tnum truncate text-[11px] ${asset.status === 'error' ? 'text-danger' : 'text-muted'}`}>
          {asset.status === 'error' ? T(asset.error ?? '') : asset.status === 'loading' ? T('Reading…') : meta}
        </div>
      </div>
      <button
        className="icon-btn !min-w-9 shrink-0"
        aria-label={T('Add {name} to timeline at playhead', { name: asset.name })}
        disabled={asset.status !== 'ready'}
        onClick={() => addAssetToTimeline(asset.id)}
        data-testid="add-asset"
      >
        <Icon name="plus" size={18} />
      </button>
      <button className="icon-btn !min-w-9 shrink-0" aria-label={T('Remove {name}', { name: asset.name })} onClick={onRemove}>
        <Icon name="trash" size={16} />
      </button>
    </li>
  );
});

export function MediaLibrary() {
  const order = useMediaStore((s) => s.order);
  const assets = useMediaStore((s) => s.assets);
  const clips = useProjectStore((s) => s.project.clips);
  const importFiles = useMediaStore((s) => s.importFiles);
  const toast = useUIStore((s) => s.toast);
  const [over, setOver] = useState(false);

  const usage = new Map<string, number>();
  for (const id in clips) {
    const c = clips[id];
    if (c.type === 'media') usage.set(c.assetId, (usage.get(c.assetId) ?? 0) + 1);
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col ${over ? 'bg-accent/5' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const { rejected } = await importFiles(e.dataTransfer.files);
        if (rejected.length) toast(T('Unsupported file type: {names}', { names: rejected.join(', ') }), 'error');
      }}
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{T("Media")}</h2>
        <ImportButton className="!h-8 text-[12px]" />
      </div>
      <ul className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5">
        {order.map((id) => (
          <AssetRow key={id} asset={assets[id]} usage={usage.get(id) ?? 0} />
        ))}
      </ul>
      {order.length === 0 && (
        <div className="mx-3 mb-auto mt-2 rounded-xl border border-dashed border-line p-4 text-center text-[12px] leading-relaxed text-muted">
          {T('Import video, audio or images.')}
          <br />
          <span className="hidden pointer-fine:inline">{T("Drop files here, then drag them to the timeline.")}</span>
          <span className="pointer-fine:hidden">{T("Tap + on a file to place it at the playhead.")}</span>
        </div>
      )}
      <p className="border-t border-line px-3 py-2 text-[10.5px] leading-snug text-muted/80">
        {T('Files stay on this device and are never uploaded. Work lasts for this session only — refreshing or closing discards it.')}
      </p>
    </div>
  );
}
