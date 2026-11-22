/*
 * Milestones 4–6 end-to-end checks: keyframes, transitions, export.
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e-m456.cjs <media-dir> <out-dir>
 * Requires ffprobe on PATH to validate the exported file.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const [mediaDir, outDir] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const m = (f) => path.join(mediaDir, f);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?debug');
  await page.setInputFiles('[data-testid=file-input]', [m('clipA.webm'), m('portrait.webm'), m('tone.ogg')]);
  await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  for (const n of ['clipA.webm', 'portrait.webm']) {
    await page.locator('[data-testid=asset-row]', { hasText: n }).locator('[data-testid=add-asset]').click();
    await page.evaluate(() => window.__KING__.engine.seek(window.__KING__.engine.clock.duration));
  }
  await page.evaluate(() => window.__KING__.engine.seek(0));
  await page.locator('[data-testid=asset-row]', { hasText: 'tone.ogg' }).locator('[data-testid=add-asset]').click();

  const S = () =>
    page.evaluate(() => {
      const p = window.__KING__.useProjectStore.getState();
      return { clips: Object.values(p.project.clips), sel: p.selectedClipId, selT: p.selectedTransitionId, t: window.__KING__.engine.clock.now() };
    });
  let s = await S();
  const vids = s.clips.filter((c) => c.type === 'media' && c.duration > 4.5 && c.trackId === s.clips.find((x) => x.duration > 7.9)?.trackId).sort((a, b) => a.start - b.start);
  check('two adjacent video clips', vids.length === 2 && Math.abs(vids[1].start - (vids[0].start + vids[0].duration)) < 1e-3, JSON.stringify(vids.map((v) => [v.start, v.duration])));

  /* ---------- keyframes via inspector ---------- */
  const A = vids[0];
  await page.evaluate((id) => window.__KING__.useProjectStore.getState().select(id), A.id);
  await page.evaluate(() => window.__KING__.engine.seek(1));
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Add Opacity % keyframe' }).click();
  await page.evaluate(() => window.__KING__.engine.seek(3));
  await page.waitForTimeout(250);
  const op = page.locator('[aria-label="Opacity % value"]');
  await op.fill('0');
  await op.press('Enter');
  await page.evaluate(() => window.__KING__.engine.seek(2));
  await page.waitForTimeout(250);
  s = await S();
  const a2 = s.clips.find((c) => c.id === A.id);
  check('auto-key creates second keyframe', a2.keyframes?.opacity?.length === 2, JSON.stringify(a2.keyframes));
  const shown = await op.inputValue();
  check('inspector shows interpolated value at playhead', shown === '50', `opacity field=${shown}`);
  const diamonds = await page.locator(`[data-clip-id="${A.id}"] .rotate-45`).count();
  check('keyframe diamonds drawn on clip', diamonds === 2, `${diamonds}`);
  // ease
  await page.evaluate(() => window.__KING__.engine.seek(1));
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Keyframe easing"]').selectOption('easeIn');
  s = await S();
  check('easing set on keyframe at playhead', s.clips.find((c) => c.id === A.id).keyframes.opacity[0].ease === 'easeIn');
  // preview brightness at t=2.9 should be darker than at t=0.5 (opacity fades to 0 over black bg)
  const mean = async (t) => {
    await page.evaluate((t) => window.__KING__.engine.seek(t), t);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const c = document.querySelector('[data-testid=preview-canvas]');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4 * 53) s += d[i] + d[i + 1] + d[i + 2];
      return s / (d.length / (4 * 53)) / 3;
    });
  };
  const m05 = await mean(0.5);
  const m29 = await mean(2.9);
  check('keyframed opacity affects preview', m29 < m05 * 0.3, `mean@0.5=${m05.toFixed(1)} mean@2.9=${m29.toFixed(1)}`);
  // remove animation to keep the export test simple
  await page.evaluate((id) => window.__KING__.useProjectStore.getState().select(id), A.id);
  await page.getByRole('button', { name: 'Remove all keyframes' }).click();

  /* ---------- transition via timeline marker ---------- */
  await page.evaluate(() => window.__KING__.useProjectStore.getState().select(null));
  await page.waitForTimeout(150);
  const B = vids[1];
  await page.locator(`[data-transition-for="${B.id}"]`).click();
  s = await S();
  const b2 = s.clips.find((c) => c.id === B.id);
  check('tapping cut marker adds a dissolve', b2.transitionIn?.type === 'dissolve' && s.selT === B.id, JSON.stringify(b2.transitionIn));
  await page.locator('[aria-label="Transition type"]').selectOption('slide');
  s = await S();
  check('transition inspector edits type', s.clips.find((c) => c.id === B.id).transitionIn.type === 'slide');
  const layers = await page.evaluate((cut) => {
    const K = window.__KING__;
    const p = K.useProjectStore.getState().project;
    // use the compositor via the engine's state: count visible clips at the cut
    return Object.values(p.clips).filter((c) => c.type === 'media').length && cut;
  }, B.start);
  const cutMean = await mean(B.start);
  check('preview renders during transition', cutMean > 5, `mean@cut=${cutMean.toFixed(1)} (${layers})`);
  await page.screenshot({ path: path.join(outDir, 'transition.png') });

  // Undo/redo of transition
  await page.click('[data-testid=undo]');
  s = await S();
  check('undo reverts transition type', s.clips.find((c) => c.id === B.id).transitionIn?.type === 'dissolve');
  await page.click('[data-testid=redo]');

  /* ---------- export ---------- */
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.waitForSelector('[data-testid=export-dialog]');
  await page.getByRole('radio', { name: '720p' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=export-start]')?.disabled, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=export-dialog]')?.innerText.includes('1280×720'));
  const planText = await page.locator('[data-testid=export-dialog]').innerText();
  console.log('     plan:', planText.split('\n').filter((l) => l.startsWith('Output')).join(' '));
  const t0 = Date.now();
  await page.click('[data-testid=export-start]');
  await page.waitForSelector('[data-testid=export-done], [data-testid=export-dialog] p.text-danger', { timeout: 240000 });
  const failed = await page.locator('[data-testid=export-dialog] p.text-danger').count();
  check('export completes', !failed, failed ? await page.locator('[data-testid=export-dialog] p.text-danger').innerText() : `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (!failed) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-download]')]);
    const out = path.join(outDir, dl.suggestedFilename());
    await dl.saveAs(out);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).toString());
    const v = probe.streams.find((x) => x.codec_type === 'video');
    const a = probe.streams.find((x) => x.codec_type === 'audio');
    const dur = parseFloat(probe.format.duration);
    check('ffprobe: video stream 1280x720', v && v.width === 1280 && v.height === 720, `${v?.codec_name} ${v?.width}x${v?.height}`);
    check('ffprobe: audio stream present', !!a, a?.codec_name);
    check('ffprobe: duration matches timeline (~13s)', Math.abs(dur - 13) < 0.3, `${dur}s, ${probe.format.format_name}`);
    // decode every frame to be sure the file is fully valid
    execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-']);
    check('ffmpeg decodes the full file without errors', true);
    // grab frames to look at
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '8', '-i', out, '-frames:v', '1', path.join(outDir, 'export-at-cut.png')]);
  }

  // cancel path
  await page.getByRole('button', { name: 'Close' }).last().click();
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=export-start]')?.disabled, null, { timeout: 15000 });
  await page.click('[data-testid=export-start]');
  await page.waitForTimeout(1200);
  await page.click('[data-testid=export-cancel]');
  await page.waitForSelector('[data-testid=export-start]', { timeout: 15000 });
  check('cancel returns to setup', true);

  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
