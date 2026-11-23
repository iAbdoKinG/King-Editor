import { useEffect, useState } from 'react';
import { BRAND } from '../../app/brand';
import { Icon } from '../../components/Icon';
import { LogoMark } from '../../components/Logo';
import { Menu } from '../../components/Menu';
import { desktop, isDesktop } from '../../desktop/bridge';
import { clampDimension, MAX_EDGE } from '../../engine/timeline/model';
import { isArabic, t as T, useLangStore } from '../../i18n';
import { useUIStore } from '../../stores/uiStore';
import type { AspectPreset } from '../../types/project';
import { uid } from '../../utils/id';
import { formatDuration } from '../../utils/time';
import { openProject as openProjectFile } from '../project/projectActions';
import { library, type ProjectMeta } from './library';
import { newProject, openFromLibrary, useSession } from './session';

const FORMATS: Array<{ aspect: Exclude<AspectPreset, 'custom'>; label: string; hint: string; w: number; h: number }> = [
  { aspect: '16:9', label: '16:9', hint: 'YouTube · Landscape', w: 16, h: 9 },
  { aspect: '9:16', label: '9:16', hint: 'Reels · TikTok · Shorts', w: 9, h: 16 },
  { aspect: '1:1', label: '1:1', hint: 'Square', w: 1, h: 1 },
  { aspect: '4:5', label: '4:5', hint: 'Instagram post', w: 4, h: 5 },
  { aspect: '4:3', label: '4:3', hint: 'Classic', w: 4, h: 3 },
];

function relativeTime(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(isArabic() ? 'ar' : 'en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString(isArabic() ? 'ar' : 'en');
}

function FormatShape({ w, h }: { w: number; h: number }) {
  const k = 34 / Math.max(w, h);
  return <span className="block rounded-[5px] border-2 border-current" style={{ width: w * k, height: h * k }} />;
}

function NewProjectPanel() {
  const [custom, setCustom] = useState(false);
  const [cw, setCw] = useState('1080');
  const [ch, setCh] = useState('1350');
  return (
    <section aria-labelledby="new-title" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 id="new-title" className="mb-3 text-[15px] font-semibold">
        {T('New project')}
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {FORMATS.map((f) => (
          <button
            key={f.aspect}
            className="group flex h-[108px] flex-col items-center justify-center gap-2 rounded-xl border border-line bg-bg/60 px-1 text-muted transition-colors hover:border-accent hover:text-accent"
            onClick={() => void newProject({ aspect: f.aspect })}
            data-testid={`new-${f.aspect}`}
          >
            <FormatShape w={f.w} h={f.h} />
            <span className="text-[13px] font-semibold text-text group-hover:text-accent">{f.label}</span>
            <span className="text-center text-[10.5px] leading-tight">{T(f.hint)}</span>
          </button>
        ))}
        <button
          className={`flex h-[108px] flex-col items-center justify-center gap-2 rounded-xl border px-1 transition-colors ${custom ? 'border-accent text-accent' : 'border-dashed border-line text-muted hover:border-accent hover:text-accent'}`}
          onClick={() => setCustom(!custom)}
          aria-expanded={custom}
        >
          <Icon name="plus" size={22} />
          <span className="text-[13px] font-semibold">{T('Custom size')}</span>
        </button>
      </div>
      {custom && (
        <div className="mt-3 flex flex-wrap items-end gap-2" dir="ltr">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            {T('Width')}
            <input className="field tnum w-24 text-center" inputMode="numeric" value={cw} onChange={(e) => setCw(e.target.value.replace(/\D/g, ''))} aria-label={T('Width')} />
          </label>
          <span className="pb-2 text-muted">×</span>
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            {T('Height')}
            <input className="field tnum w-24 text-center" inputMode="numeric" value={ch} onChange={(e) => setCh(e.target.value.replace(/\D/g, ''))} aria-label={T('Height')} />
          </label>
          <button
            className="h-8 rounded-lg bg-accent px-4 text-[13px] font-semibold text-on-accent"
            onClick={() => void newProject({ aspect: 'custom', customWidth: clampDimension(parseFloat(cw)), customHeight: clampDimension(parseFloat(ch)) })}
            data-testid="new-custom"
          >
            {T('Create')}
          </button>
          <span className="pb-2 text-[11px] text-muted">{T('Up to {max} px per side', { max: MAX_EDGE })}</span>
        </div>
      )}
    </section>
  );
}

function ProjectCard({ p, onChanged }: { p: ProjectMeta; onChanged: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const portrait = p.height > p.width;
  return (
    <div className="group relative" data-testid="project-card">
      <button className="block w-full text-start" onClick={() => void openFromLibrary(p.id)} aria-label={T('Open {name}', { name: p.name })}>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-line bg-bg transition-colors group-hover:border-accent">
          {p.thumb ? (
            <img src={p.thumb} alt="" className={portrait ? 'h-full w-auto' : 'h-full w-full object-cover'} draggable={false} />
          ) : (
            <LogoMark size={34} className="opacity-40" />
          )}
          {p.duration > 0 && (
            <span className="tnum absolute bottom-1.5 end-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10.5px] font-semibold text-white" dir="ltr">
              {formatDuration(p.duration)}
            </span>
          )}
        </div>
        <div className="mt-2 truncate pe-8 text-[13px] font-medium">{p.name}</div>
        <div className="truncate text-[11px] text-muted">
          {relativeTime(p.updatedAt)} · <bdi dir="ltr">{p.width}×{p.height}</bdi>
        </div>
      </button>
      <button className="icon-btn absolute bottom-0 end-0 !h-8 !min-w-8" aria-label={T('{name} options', { name: p.name })} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
        <Icon name="more" size={16} />
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          title={p.name}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', onSelect: () => void openFromLibrary(p.id) },
            {
              label: 'Rename',
              onSelect: async () => {
                const n = window.prompt(T('Rename project'), p.name)?.trim();
                if (n) {
                  await library.rename(p.id, n.slice(0, 120));
                  onChanged();
                }
              },
            },
            {
              label: 'Duplicate',
              onSelect: async () => {
                await library.duplicate(p.id, uid('prj'), T('{name} (copy)', { name: p.name }));
                onChanged();
              },
            },
            {
              label: 'Delete',
              danger: true,
              onSelect: async () => {
                if (!window.confirm(T('Delete “{name}”? This cannot be undone.', { name: p.name }))) return;
                await library.remove(p.id);
                onChanged();
              },
            },
          ]}
        />
      )}
    </div>
  );
}

export function HomeScreen() {
  const version = useSession((s) => s.libraryVersion);
  const set = useUIStore((s) => s.set);
  const isAr = useLangStore((s) => s.lang) === 'ar';
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState(false);
  const reload = () => useSession.setState((s) => ({ libraryVersion: s.libraryVersion + 1 }));

  useEffect(() => {
    let live = true;
    library
      .list()
      .then((l) => live && setProjects(l))
      .catch(() => live && (setError(true), setProjects([])));
    return () => {
      live = false;
    };
  }, [version]);

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="home">
      <header className="safe-top safe-x shrink-0 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <LogoMark size={28} />
          <div className="flex flex-col leading-tight">
            <span className="text-[16px] font-bold">{isAr ? BRAND.nameAr : BRAND.name}</span>
            <span className="text-[10.5px] text-muted">{isAr ? BRAND.taglineAr : BRAND.tagline}</span>
          </div>
          <div className="flex-1" />
          {!isDesktop && (
            <button className="hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted hover:bg-elevated hover:text-text sm:flex" onClick={() => set({ downloadOpen: true })}>
              <Icon name="windows" size={15} /> {T('Desktop app')}
            </button>
          )}
          <button className="icon-btn" aria-label={T('Keyboard shortcuts')} title={T('Keyboard shortcuts')} onClick={() => set({ shortcutsOpen: true })}>
            <Icon name="keyboard" size={18} />
          </button>
          <button className="icon-btn" aria-label={T('Theme')} title={T('Theme')} onClick={() => set({ themeOpen: true })}>
            <Icon name="palette" size={18} />
          </button>
          <button className="icon-btn !min-w-10 text-[13px] font-semibold" aria-label={T('Language')} onClick={() => useLangStore.getState().setLang(isAr ? 'en' : 'ar')} data-testid="lang-toggle">
            {isAr ? 'EN' : 'ع'}
          </button>
        </div>
      </header>
      <main className="safe-x safe-bottom scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-5">
          <NewProjectPanel />
          <section aria-labelledby="recent-title">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="recent-title" className="text-[15px] font-semibold">
                {T('Your projects')}
              </h2>
              {desktop && (
                <button className="field flex !h-8 items-center gap-1.5 text-[12px]" onClick={() => void openProjectFile()}>
                  <Icon name="media" size={14} /> {T('Open project file…')}
                </button>
              )}
            </div>
            {projects === null ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="aspect-video animate-pulse rounded-xl bg-elevated" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[13px] text-muted">
                {error ? T('Saved projects are not available in this browser (private mode?).') : T('No projects yet. Pick a format above to start.')}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
                {projects.map((p) => (
                  <ProjectCard key={p.id} p={p} onChanged={reload} />
                ))}
              </div>
            )}
          </section>
          <p className="pb-2 text-center text-[11.5px] text-muted">
            {T(isDesktop ? 'Projects are saved automatically in Documents › Qissa. Your media stays where it is.' : 'Projects are saved automatically on this device. Nothing is uploaded.')}
          </p>
        </div>
      </main>
    </div>
  );
}
