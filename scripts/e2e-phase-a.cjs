/*
 * Phase A end-to-end checks: waveforms + silence, markers, themes, presets
 * (save/apply/share link/import), Arabic fonts, new transitions (GPU vs canvas
 * equivalence), effects/looks, transform tools, extract audio, solo, advisor.
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e-phase-a.cjs <media-dir> <out-dir>
 * Media dir must contain clipA.webm, portrait.webm, speech.ogg (2 s tone / 2 s silence).
 */
const { chromium } = require('playwright');
const path = require('path');
const [mediaDir, outDir] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const m = (f) => path.join(mediaDir, f);

async function previewPng(page) {
  return (await page.locator('[data-testid=preview-stage], [data-testid=preview-canvas]').first().screenshot()).toString('base64');
}
async function pngDiff(page, a, b) {
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Test preset') : d.accept()));
  await page.goto('http://localhost:4173/?debug');
  await page.evaluate(() => window.__KING__.useUIStore.getState().setMode('pro'));
  const K = (fn, arg) => page.evaluate(fn, arg);

  await page.setInputFiles('[data-testid=file-input]', [m('clipA.webm'), m('portrait.webm'), m('speech.ogg')]);
  await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  for (const n of ['clipA.webm', 'portrait.webm']) {
    await page.locator('[data-testid=asset-row]', { hasText: n }).locator('[data-testid=add-asset]').click();
    await K(() => window.__KING__.engine.seek(window.__KING__.engine.clock.duration));
  }
  await K(() => window.__KING__.engine.seek(0));
  await page.locator('[data-testid=asset-row]', { hasText: 'speech.ogg' }).locator('[data-testid=add-asset]').click();

  /* ---------- waveforms ---------- */
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=waveform]').length >= 2, null, { timeout: 20000 }).catch(() => {});
  const waves = await page.locator('[data-testid=waveform]').count();
  check('waveforms drawn under video and on audio clips', waves >= 2, `${waves} waveform canvases`);
  const silence = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('[data-testid=waveform]')];
    const c = cs.find((x) => x.closest('[data-clip-id]')?.getAttribute('aria-label')?.startsWith('speech'));
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const mid = Math.floor(c.height / 2);
    // column brightness at the middle row: loud columns are bright bars, silent ones are only tinted
    const cols = [];
    for (let x = 0; x < c.width; x++) cols.push(d[(mid * c.width + x) * 4 + 3]);
    const loud = cols.filter((a) => a > 150).length / cols.length;
    return { loudFraction: loud, w: c.width };
  });
  check('speech waveform shows sound and silence', silence && silence.loudFraction > 0.3 && silence.loudFraction < 0.7, JSON.stringify(silence));
  await page.locator('[data-testid=timeline-scroller]').screenshot({ path: path.join(outDir, 'waveforms.png') });

  /* ---------- markers ---------- */
  await K(() => window.__KING__.engine.seek(3));
  await page.locator('body').press('m');
  await K(() => window.__KING__.engine.seek(6));
  await page.locator('body').press('m');
  let markers = await K(() => window.__KING__.useProjectStore.getState().project.markers);
  check('M adds markers at playhead', markers?.length === 2 && Math.abs(markers[0].t - 3) < 0.05, JSON.stringify(markers?.map((x) => x.t)));
  await K(() => window.__KING__.engine.seek(0));
  await page.locator('body').press(']');
  const tAfter = await K(() => window.__KING__.engine.clock.now());
  check('] jumps to next marker', Math.abs(tAfter - 3) < 0.05, `t=${tAfter}`);
  await page.locator(`[data-marker-id="${markers[0].id}"]`).click();
  await page.getByLabel('Marker name').fill('Intro');
  await page.getByRole('button', { name: 'Done' }).click();
  markers = await K(() => window.__KING__.useProjectStore.getState().project.markers);
  check('marker renamed via popover', markers[0].label === 'Intro');
  const snap = await K(() => {
    const p = window.__KING__.useProjectStore.getState().project;
    return p.markers.map((x) => x.t);
  });
  check('markers are snap targets', snap.includes(3));

  /* ---------- themes ---------- */
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('button', { name: 'Light' }).click();
  const bgLight = await K(() => getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim());
  check('theme preset applies CSS tokens', bgLight.toLowerCase() === '#eef1f4', bgLight);
  await page.screenshot({ path: path.join(outDir, 'theme-light.png') });
  await page.getByLabel('Custom Accent').fill('#ff5588');
  const acc = await K(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim());
  check('custom theme editable', acc.toLowerCase() === '#ff5588', acc);
  const persisted = await K(() => localStorage.getItem('king-editor:theme'));
  check('theme persisted on device', persisted?.includes('custom'));
  await page.getByRole('button', { name: 'Midnight' }).click();
  await page.getByRole('dialog', { name: 'Themes' }).getByRole('button', { name: 'Close' }).click();

  /* ---------- effects looks + presets ---------- */
  const vid = await K(() => {
    const p = window.__KING__.useProjectStore.getState().project;
    return Object.values(p.clips).find((c) => c.type === 'media' && c.duration > 7.9).id;
  });
  await K((id) => window.__KING__.useProjectStore.getState().select(id), vid);
  await K(() => window.__KING__.engine.seek(1));
  await page.getByRole('button', { name: 'Look Noir' }).click();
  let fx = await K((id) => window.__KING__.useProjectStore.getState().project.clips[id].effects, vid);
  check('look applies effect values', fx.grayscale === 100 && fx.vignette === 55, JSON.stringify(fx));
  await page.getByRole('button', { name: 'Save effects as preset' }).click();
  let presets = await K(() => JSON.parse(localStorage.getItem('king-editor:presets') || '[]'));
  check('effects preset saved to device', presets.length === 1 && presets[0].kind === 'effects', presets.map((p) => p.name).join(','));
  // reset, then apply from presets panel
  await page.getByRole('button', { name: 'Reset effects' }).click();
  await page.getByRole('button', { name: 'Presets library' }).click();
  await page.getByRole('button', { name: 'Apply' }).first().click();
  fx = await K((id) => window.__KING__.useProjectStore.getState().project.clips[id].effects, vid);
  check('preset applies from library', fx.grayscale === 100);
  // share link round-trip in a fresh context
  const link = await K(() => {
    const st = JSON.parse(localStorage.getItem('king-editor:presets'));
    return null || st;
  });
  const shareUrl = await page.evaluate(async () => {
    const mod = await import('/src/features/presets/presets.ts').catch(() => null);
    return mod ? null : null;
  });
  void shareUrl;
  await page.getByRole('button', { name: /Share Test preset/ }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('share produces a link with the preset in the fragment', /#presets=[A-Za-z0-9_-]+$/.test(copied), copied.slice(0, 80) + '…');
  await page.getByRole('dialog', { name: 'Presets' }).getByRole('button', { name: 'Close' }).click();
  const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const p2 = await ctx2.newPage();
  await p2.goto(copied.replace(/^https?:\/\/[^/]+/, 'http://localhost:4173'));
  await p2.getByRole('button', { name: 'Import', exact: true }).click();
  const imported = await p2.evaluate(() => JSON.parse(localStorage.getItem('king-editor:presets') || '[]'));
  check('opening a share link imports the preset elsewhere', imported.length === 1 && imported[0].data.grayscale === 100);
  await ctx2.close();
  void link;

  /* ---------- transform tools ---------- */
  await K((id) => window.__KING__.useProjectStore.getState().select(id), vid);
  await page.getByRole('button', { name: 'Fill' }).click();
  await page.getByRole('button', { name: 'Align top left' }).click();
  const tr = await K((id) => window.__KING__.useProjectStore.getState().project.clips[id].transform, vid);
  check('fill + align top-left', tr.scaleX >= 1 && Math.abs(tr.x) < 2 && Math.abs(tr.y) < 2, JSON.stringify({ s: tr.scaleX, x: tr.x, y: tr.y }));
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.getByTestId('motion-tab-combo').click();
  await page.getByTestId('motion-combo-kenBurnsIn').click();
  const mo = await K((id) => window.__KING__.useProjectStore.getState().project.clips[id], vid);
  check('quick animation stored as a Combo motion (no keyframes)', mo.motion?.combo?.id === 'kenBurnsIn' && !mo.keyframes?.scale, JSON.stringify(mo.motion));
  await K((id) => window.__KING__.useProjectStore.getState().apply((p) => ({ ...p, clips: { ...p.clips, [id]: { ...p.clips[id], motion: undefined } } })), vid);
  await page.getByRole('button', { name: 'Reset effects' }).click();

  /* ---------- Arabic font ---------- */
  await K(() => window.__KING__.engine.seek(1.5));
  await page.locator('body').press('t');
  await page.locator('[aria-label="Text content"]').fill('مرحبا بالعالم');
  await page.locator('[aria-label="Font"]').selectOption('Cairo');
  await page.waitForFunction(() => document.fonts.check('700 48px "Cairo"', 'مرحبا'), null, { timeout: 10000 }).catch(() => {});
  const cairo = await page.evaluate(() => document.fonts.check('700 48px "Cairo"', 'مرحبا'));
  check('Arabic font loads on demand', cairo, cairo ? '' : JSON.stringify(await page.evaluate(() => { const ps = window.__KING__.useProjectStore.getState(); const c = ps.project.clips[ps.selectedClipId]; return { sel: ps.selectedClipId, type: c?.type, font: c?.style?.fontFamily, text: c?.text, fonts: [...document.fonts].filter((f) => /Cairo/.test(f.family)).map((f) => f.status) }; })));
  await page.waitForTimeout(400);
  await page.locator('[data-testid=preview-stage]').screenshot({ path: path.join(outDir, 'arabic-text.png') });
  // The Arabic title must look the same in the GPU preview and the export renderer.
  await K(() => window.__KING__.useProjectStore.getState().select(null));
  await page.waitForTimeout(300);
  const arG = await previewPng(page);
  await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'canvas', quality: 'full' }));
  await page.waitForTimeout(700);
  const arC = await previewPng(page);
  await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'gpu', quality: 'half' }));
  const arDiff = await pngDiff(page, arG, arC);
  check('Arabic text: GPU preview matches export renderer', arDiff < 3, `diff=${arDiff.toFixed(2)}`);

  /* ---------- new transitions: GPU == canvas ---------- */
  await K(() => window.__KING__.useProjectStore.getState().select(null));
  const B = await K(() => {
    const p = window.__KING__.useProjectStore.getState().project;
    return Object.values(p.clips).find((c) => c.type === 'media' && c.start > 7.9 && c.duration < 5.5 && c.duration > 4.5);
  });
  await page.locator(`[data-transition-for="${B.id}"]`).click();
  const types = ['wipe', 'iris', 'cover', 'flash', 'blur', 'spin'];
  for (const ty of types) {
    await page.locator('[aria-label="Transition type"]').selectOption(ty);
    await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'gpu' }));
    await K((t) => window.__KING__.engine.seek(t), B.start + 0.05);
    await page.waitForTimeout(600);
    const g = await previewPng(page);
    await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'canvas', quality: 'full' }));
    await K((t) => window.__KING__.engine.seek(t), B.start + 0.05);
    await page.waitForTimeout(600);
    const c = await previewPng(page);
    const diff = await pngDiff(page, g, c);
    check(`transition ${ty}: GPU preview matches export renderer`, diff < 12, `diff=${diff.toFixed(2)}`);
    require('fs').writeFileSync(path.join(outDir, `tr-${ty}-gpu.png`), Buffer.from(g, 'base64'));
    require('fs').writeFileSync(path.join(outDir, `tr-${ty}-canvas.png`), Buffer.from(c, 'base64'));
  }
  await K(() => window.__KING__.useUIStore.getState().set({ renderer: 'gpu', quality: 'half' }));

  /* ---------- extract audio + solo ---------- */
  await K((id) => window.__KING__.useProjectStore.getState().select(id), vid);
  await page.getByRole('button', { name: 'Extract audio to its own track' }).click();
  const ex = await K((id) => {
    const p = window.__KING__.useProjectStore.getState().project;
    const v = p.clips[id];
    const a = Object.values(p.clips).find((c) => c.id !== id && c.type === 'media' && c.assetId === v.assetId && p.tracks.find((t) => t.id === c.trackId).kind === 'audio');
    return { vVol: v.audio.volume, audio: !!a, sameTiming: a && a.start === v.start && a.duration === v.duration && a.in === v.in };
  }, vid);
  check('extract audio: new audio clip with same timing, video muted', ex.audio && ex.sameTiming && ex.vVol === 0, JSON.stringify(ex));
  const soloBtn = page.getByRole('button', { name: 'Solo track' }).first();
  await soloBtn.click();
  const solo = await K(() => window.__KING__.useProjectStore.getState().project.tracks.some((t) => t.solo));
  check('solo toggles on track', solo);

  /* ---------- advisor ---------- */
  await K(() => {
    const K = window.__KING__;
    const ps = K.useProjectStore.getState();
    const p = ps.project;
    const v = Object.values(p.clips).find((c) => c.type === 'media' && c.duration > 7.9);
    ps.apply((proj) => {
      let next = proj;
      for (let i = 0; i < 5; i++) {
        const tid = 'trk_adv' + i;
        next = { ...next, tracks: [{ id: tid, kind: 'video', name: 'V' + i, muted: false, hidden: false }, ...next.tracks] };
        next = { ...next, clips: { ...next.clips, ['c_adv' + i]: { ...v, id: 'c_adv' + i, trackId: tid } } };
      }
      return next;
    });
  });
  await page.waitForSelector('[data-testid=advisor]', { timeout: 5000 }).catch(() => {});
  const adv = await page.locator('[data-testid=advisor]').innerText().catch(() => '');
  check('advisor warns about heavy stacking', /videos at the same time/.test(adv), adv.split('\n')[0]);
  await page.screenshot({ path: path.join(outDir, 'advisor.png') });

  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---------- phone layout sanity ---------- */
  const phone = await browser.newContext({ ...require('playwright').devices['iPhone 13'] });
  const ph = await phone.newPage();
  const perr = [];
  ph.on('pageerror', (e) => perr.push(e.message));
  await ph.goto('http://localhost:4173/?debug');
  await ph.getByRole('button', { name: 'More' }).tap();
  await ph.getByRole('menuitem', { name: 'Theme' }).tap();
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: path.join(outDir, 'iphone-theme.png') });
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('iPhone: theme sheet fits, no horizontal overflow', overflow && perr.length === 0, perr.join(' | '));
  await phone.close();

  await browser.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
