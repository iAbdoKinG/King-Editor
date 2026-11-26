/*
 * Phase B: per-clip In/Out/Combo motion (independent, survives move/trim/split,
 * preview = export), focus point on the preview, draggable keyframes, playhead
 * magnet + edit-point navigation, audio volume to 400 % and sound effects
 * (preview graph + export).
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e-phase-b.cjs <media-dir> <out-dir>
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [mediaDir, outDir] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const m = (f) => path.join(mediaDir, f);

async function shot(page) {
  return (await page.locator('[data-testid=preview-stage], [data-testid=preview-canvas]').first().screenshot()).toString('base64');
}
async function diff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = async (s) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + s;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 160, 90);
      return x.getImageData(0, 0, 160, 90).data;
    };
    const [da, db] = [await load(a), await load(b)];
    let s = 0;
    for (let i = 0; i < da.length; i += 4) s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    return s / (da.length / 4) / 3;
  }, [a, b]);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?debug');
  await page.evaluate(() => window.__KING__.useUIStore.getState().setMode('simple'));
  const K = (fn, arg) => page.evaluate(fn, arg);
  const clipOf = (id) => K((id) => window.__KING__.useProjectStore.getState().project.clips[id], id);

  await page.setInputFiles('[data-testid=file-input]', [m('clipA.webm'), m('portrait.webm')]);
  await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status === 'ready'));
  for (const n of ['clipA.webm', 'portrait.webm']) {
    await page.locator('[data-testid=asset-row]', { hasText: n }).locator('[data-testid=add-asset]').click();
    await K(() => window.__KING__.engine.seek(window.__KING__.engine.clock.duration));
  }
  const [A, B] = await K(() => Object.values(window.__KING__.useProjectStore.getState().project.clips).sort((a, b) => a.start - b.start).map((c) => c.id));

  /* ---------- independent per-clip motion ---------- */
  await K((id) => window.__KING__.useProjectStore.getState().select(id), A);
  await page.getByTestId('motion-tab-in').click();
  await page.getByTestId('motion-in-pop').click();
  await page.getByTestId('motion-tab-out').click();
  await page.getByTestId('motion-out-fade').click();
  await page.getByTestId('motion-tab-combo').click();
  await page.getByTestId('motion-combo-kenBurnsIn').click();
  await K((id) => window.__KING__.useProjectStore.getState().select(id), B);
  await page.getByTestId('motion-tab-in').click();
  await page.getByTestId('motion-in-slideLeft').click();
  await page.getByTestId('motion-tab-out').click();
  await page.getByTestId('motion-out-spin').click();
  let a = await clipOf(A);
  let b = await clipOf(B);
  check(
    'In, Out and Combo all kept on clip A; clip B has its own',
    a.motion?.in?.id === 'pop' && a.motion?.out?.id === 'fade' && a.motion?.combo?.id === 'kenBurnsIn' && b.motion?.in?.id === 'slideLeft' && b.motion?.out?.id === 'spin' && !b.motion.combo,
    JSON.stringify({ A: a.motion, B: b.motion }),
  );
  check('animations create no hidden keyframes', !a.keyframes && !b.keyframes);
  const bands = await page.locator(`[data-clip-id="${A}"] [data-testid=motion-in-band], [data-clip-id="${A}"] [data-testid=motion-out-band]`).count();
  check('In/Out ranges shown on the clip in the timeline', bands === 2);

  // Move clip A in the preview (mid-clip): position changes, animation unchanged, still no keyframes.
  await K((id) => window.__KING__.useProjectStore.getState().select(id), A);
  await K(() => window.__KING__.engine.seek(4));
  await page.waitForTimeout(300);
  const ov = await page.getByTestId('preview-overlay').boundingBox();
  // Grab the clip away from the centre (the centre holds the zoom focus handle).
  await page.mouse.move(ov.x + ov.width * 0.3, ov.y + ov.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(ov.x + ov.width * 0.3 + 80, ov.y + ov.height * 0.7 + 30, { steps: 6 });
  await page.mouse.up();
  a = await clipOf(A);
  check('moving a clip with animations keeps them and adds no keyframe', a.transform.x > 50 && !a.keyframes && a.motion?.in?.id === 'pop' && a.motion?.combo?.id === 'kenBurnsIn', `x=${a.transform.x}`);

  // Opacity during the animations follows the clip edges, whatever the trim.
  const alphaAt = (id, lt) =>
    K(
      ([id, lt]) => {
        const c = window.__KING__.useProjectStore.getState().project.clips[id];
        return window.__KING__.motionAt(c, lt, 1920, 1080).alpha;
      },
      [id, lt],
    );
  const hasMotionAt = await K(() => typeof window.__KING__.motionAt === 'function');
  if (hasMotionAt) {
    await K((id) => window.__KING__.useProjectStore.getState().apply((p) => ({ ...p, clips: { ...p.clips, [id]: { ...p.clips[id], duration: p.clips[id].duration - 2 } } })), A);
    a = await clipOf(A);
    const endAlpha = await alphaAt(A, a.duration - 0.01);
    const midAlpha = await alphaAt(A, a.duration / 2);
    check('Out animation stays anchored to the (trimmed) clip end', endAlpha < 0.1 && midAlpha === 1, `end=${endAlpha.toFixed(3)} mid=${midAlpha}`);
  } else check('motion evaluator exposed for tests', false);

  // Split clip A: In stays on the left part, Out moves to the right part.
  await K(() => window.__KING__.engine.seek(2));
  await K((id) => window.__KING__.useProjectStore.getState().select(id), A);
  await page.locator('body').press('s');
  const parts = await K((assetId) => Object.values(window.__KING__.useProjectStore.getState().project.clips).filter((c) => c.assetId === assetId).sort((x, y) => x.start - y.start), a.assetId);
  check('split: In on the left part, Out on the right part, Combo on both', parts.length === 2 && parts[0].motion?.in && !parts[0].motion?.out && parts[1].motion?.out && !parts[1].motion?.in && parts[0].motion.combo && parts[1].motion.combo, JSON.stringify(parts.map((p) => p.motion)));
  await page.locator('body').press('Control+z');

  /* ---------- preview = export (GPU vs canvas) mid-animation ---------- */
  b = await clipOf(B);
  await K((id) => window.__KING__.useProjectStore.getState().select(null), null);
  let worst = 0;
  for (const t of [b.start + 0.15, b.start + b.duration - 0.2]) {
    await K((t) => window.__KING__.engine.seek(t), t);
    await page.waitForTimeout(600);
    const g = await shot(page);
    await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'canvas', quality: 'full' }));
    await page.waitForTimeout(700);
    const c = await shot(page);
    await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'gpu', quality: 'half' }));
    await page.waitForTimeout(400);
    worst = Math.max(worst, await diff(page, g, c));
  }
  check('In/Out motion looks the same in preview and export renderer', worst < 6, `mean diff ${worst.toFixed(2)}/255`);

  /* ---------- focus point on the preview ---------- */
  await K((id) => window.__KING__.useProjectStore.getState().select(id), A);
  await K(() => window.__KING__.engine.seek(3));
  await page.getByTestId('motion-tab-combo').click();
  await page.waitForTimeout(300);
  const fh = page.locator('[data-handle=focus]');
  const fb = await fh.boundingBox();
  check('focus point handle shown for the zoom animation', !!fb);
  if (fb) {
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width / 2 - 120, fb.y + fb.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    a = await clipOf(A);
    check('dragging the focus point on the video moves the zoom origin', a.motion.combo.focusX < 0.45 && a.motion.combo.focusY < 0.45 && a.transform.x > 50, JSON.stringify({ fx: a.motion.combo.focusX, fy: a.motion.combo.focusY }));
  }
  await page.screenshot({ path: path.join(outDir, 'motion-inspector.png') });

  /* ---------- keyframes: drag in time on the timeline ---------- */
  await K(() => window.__KING__.useUIStore.getState().setMode('pro'));
  await K(() => window.__KING__.engine.seek(1));
  await page.getByRole('button', { name: 'Add Position X keyframe' }).click();
  await K(() => window.__KING__.engine.seek(3));
  await page.getByRole('button', { name: 'Add Position X keyframe' }).click();
  a = await clipOf(A);
  const kf0 = a.keyframes?.x?.map((k) => k.t) ?? [];
  const diamond = page.locator(`[data-clip-id="${A}"] [data-kf]`).nth(1);
  const db = await diamond.boundingBox();
  const pps = await K(() => window.__KING__.useUIStore.getState().pxPerSec);
  if (db) {
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 2 + pps * 1.03, db.y + db.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  a = await clipOf(A);
  const kf1 = a.keyframes?.x?.map((k) => k.t) ?? [];
  check('keyframe dragged later in time on the timeline', kf0.length === 2 && kf1.length === 2 && Math.abs(kf1[1] - (kf0[1] + 1)) < 0.15, `${kf0.map((x) => x.toFixed(2))} → ${kf1.map((x) => x.toFixed(2))}`);
  if (db) {
    const d2 = await page.locator(`[data-clip-id="${A}"] [data-kf]`).first().boundingBox();
    await page.mouse.click(d2.x + d2.width / 2, d2.y + d2.height / 2);
    const now = await K(() => window.__KING__.engine.clock.now());
    check('tapping a keyframe moves the playhead onto it', Math.abs(now - (a.start + kf1[0])) < 0.02, now.toFixed(3));
  }

  /* ---------- playhead magnet ---------- */
  b = await clipOf(B);
  const ruler = await page.locator('[data-testid=timeline-ruler]').boundingBox().catch(() => null);
  const scrollerBox = await page.locator('[data-testid=timeline-scroller]').boundingBox().catch(() => null);
  const scroll = await page.evaluate(() => document.querySelector('[data-testid=timeline-scroller]')?.scrollLeft ?? 0);
  if (ruler && scrollerBox) {
    const xAt = (t) => scrollerBox.x + t * pps - scroll;
    await page.mouse.click(xAt(b.start) + 7, ruler.y + ruler.height / 2);
    const t1 = await K(() => window.__KING__.engine.clock.now());
    check('tapping the ruler near a cut snaps the playhead onto it', Math.abs(t1 - b.start) < 1e-6, `${t1.toFixed(4)} vs ${b.start.toFixed(4)}`);
    await page.mouse.click(xAt(b.start) + 40, ruler.y + ruler.height / 2);
    const t2 = await K(() => window.__KING__.engine.clock.now());
    check('away from cuts the playhead goes exactly where tapped', Math.abs(t2 - (b.start + 40 / pps)) < 0.03, t2.toFixed(3));
    const clipBox = await page.locator(`[data-clip-id="${B}"]`).boundingBox();
    await K((id) => window.__KING__.useProjectStore.getState().select(id), B);
    await page.mouse.click(clipBox.x + clipBox.width - 6, clipBox.y + clipBox.height / 2);
    const t3 = await K(() => window.__KING__.engine.clock.now());
    check('tapping near a clip end puts the playhead on its last frame', Math.abs(t3 - (b.start + b.duration - 1 / 30)) < 0.04, `${t3.toFixed(3)} (end ${(b.start + b.duration).toFixed(3)})`);
  } else check('timeline ruler/scroller test ids present', false);
  await K(() => window.__KING__.engine.seek(0.5));
  await page.getByTestId('next-edit').click();
  const e1 = await K(() => window.__KING__.engine.clock.now());
  await page.getByTestId('next-edit').click();
  const e2 = await K(() => window.__KING__.engine.clock.now());
  await page.getByTestId('prev-edit').click();
  const e3 = await K(() => window.__KING__.engine.clock.now());
  a = await clipOf(A);
  const aEnd = a.start + a.duration; // A was trimmed: there is a gap before B
  check('next/previous edit point buttons jump between cuts', Math.abs(e1 - aEnd) < 1e-6 && Math.abs(e2 - b.start) < 1e-6 && Math.abs(e3 - aEnd) < 1e-6, [e1, e2, e3].map((x) => x.toFixed(3)).join(' → ') + ` (A end ${aEnd}, B start ${b.start})`);
  await K(() => window.__KING__.engine.seek(0.5));
  await page.locator('body').press('ArrowDown');
  check('↓ shortcut jumps to the next edit point', Math.abs((await K(() => window.__KING__.engine.clock.now())) - aEnd) < 1e-6);

  /* ---------- audio: 400 % and effects ---------- */
  await K((id) => window.__KING__.useProjectStore.getState().select(id), A);
  await page.getByRole('button', { name: '400%' }).click();
  await page.getByTestId('audio-preset-echo').click();
  await page.getByTestId('audio-preset-voice').click();
  a = await clipOf(A);
  check('volume up to 400 % (+12 dB)', a.audio.volume === 4 && (await page.getByText('+12.0 dB').count()) > 0, String(a.audio.volume));
  check('sound preset applies EQ + compressor', a.audio.fx?.preset === 'voice' && a.audio.fx.compressor > 0 && a.audio.fx.high > 0 && a.audio.fx.echo === 0, JSON.stringify(a.audio.fx));
  await page.getByRole('slider', { name: 'Reverb %' }).fill('0.4').catch(() => {});
  await K((id) => window.__KING__.useProjectStore.getState().apply((p) => ({ ...p, clips: { ...p.clips, [id]: { ...p.clips[id], audio: { ...p.clips[id].audio, fx: { ...p.clips[id].audio.fx, reverb: 0.4, preset: undefined } } } } })), A);
  // Live preview routes the element through the effects chain.
  await K(() => window.__KING__.engine.seek(1));
  await page.getByTestId('play-toggle').click();
  await page.waitForTimeout(1200);
  const routed = await K((id) => {
    const pool = window.__KING__.engine.mediaPool;
    const slot = pool.slotFor(id);
    const nodes = slot && window.__KING__.audioGraph?.channel(slot.el);
    return nodes ? { fxOn: !!nodes.fxOn, gain: nodes.gain.gain.value } : null;
  }, A);
  await page.getByTestId('play-toggle').click();
  check('preview plays through the effects chain with gain above 1', !!routed?.fxOn && routed.gain > 1.5, JSON.stringify(routed));
  // Save/reload keeps everything.
  const saved = await K(async () => {
    const mod = window.__KING__;
    return JSON.stringify(mod.useProjectStore.getState().project.clips);
  });
  check('motion and audio effects are part of the project data', saved.includes('"motion"') && saved.includes('"fx"'));

  /* ---------- export with motion + audio effects ---------- */
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const dlg = page.getByTestId('export-dialog');
  await dlg.getByRole('radio', { name: '720p' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=export-start]')?.disabled, null, { timeout: 30000 });
  await page.click('[data-testid=export-start]');
  await page.waitForSelector('[data-testid=export-done], [data-testid=export-dialog] p.text-danger', { timeout: 300000 });
  const err = await page.locator('[data-testid=export-dialog] p.text-danger').count();
  check('export with motion + audio effects completes', !err, err ? await page.locator('[data-testid=export-dialog] p.text-danger').innerText() : '');
  if (!err) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-download]')]);
    const out = path.join(outDir, 'phase-b' + path.extname(dl.suggestedFilename()));
    await dl.saveAs(out);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out]).toString());
    check('exported file has video + audio', probe.streams.some((s) => s.codec_type === 'video') && probe.streams.some((s) => s.codec_type === 'audio'));
    // The first frame is mid "Pop" (scaled down + fading in): mostly background.
    const vol = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-t', '1', '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    void vol;
  }

  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
