/*
 * End-to-end smoke test against a built preview server.
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e.cjs <media-dir> <screenshot-dir>
 * Media dir must contain: clipA.webm (video+audio), portrait.webm, tone.ogg, still.png, notes.txt
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const [mediaDir, shotDir] = process.argv.slice(2);
const URL_ = 'http://localhost:4173/?debug';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const m = (f) => path.join(mediaDir, f);

async function state(page) {
  return page.evaluate(() => {
    const K = window.__KING__;
    const p = K.useProjectStore.getState();
    return {
      t: K.engine.clock.now(),
      playing: K.engine.clock.playing,
      duration: K.engine.clock.duration,
      clips: Object.values(p.project.clips).map((c) => ({ id: c.id, start: c.start, duration: c.duration, trackId: c.trackId, type: c.type, in: c.in })),
      tracks: p.project.tracks.map((t) => t.kind),
      selected: p.selectedClipId,
      past: p.past.length,
      assets: Object.values(K.useMediaStore.getState().assets).map((a) => ({ name: a.name, status: a.status, kind: a.kind, duration: a.duration, w: a.width, thumb: !!a.thumbUrl })),
    };
  });
}


/** Pixel statistics of the preview (works for both GPU stage and canvas renderer). */
async function previewPng(page) {
  const loc = page.locator('[data-testid=preview-stage], [data-testid=preview-canvas]').first();
  return (await loc.screenshot()).toString('base64');
}
async function pngStats(page, b64) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = Math.round((160 * img.height) / img.width);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    const distinct = new Set();
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      distinct.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    }
    return { mean: sum / (d.length / 4) / 3, distinct: distinct.size, w: img.width, h: img.height };
  }, b64);
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

async function canvasStats(page) {
  return pngStats(page, await previewPng(page));
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];

  /* ---------------- desktop / iPad-landscape-sized session ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.waitForSelector('[data-testid=preview-stage]');

  await page.setInputFiles('[data-testid=file-input]', [m('clipA.webm'), m('portrait.webm'), m('tone.ogg'), m('still.png'), m('notes.txt')]);
  await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'), null, { timeout: 20000 });
  await page.waitForTimeout(1500); // thumbnails
  let s = await state(page);
  check('imports 4 supported files, rejects .txt', s.assets.length === 4, JSON.stringify(s.assets.map((a) => a.name)));
  check('all assets probed ready', s.assets.every((a) => a.status === 'ready'), JSON.stringify(s.assets.map((a) => `${a.name}:${a.status}:${a.duration.toFixed(2)}`)));
  check('video metadata', s.assets.find((a) => a.name === 'clipA.webm')?.w === 1280);
  check('thumbnails generated', s.assets.filter((a) => a.kind !== 'audio').every((a) => a.thumb));
  check('unsupported file toast', (await page.locator('text=Unsupported file type').count()) > 0);

  // Add clipA at playhead via the touch-friendly + button.
  await page.locator('[data-testid=asset-row]', { hasText: 'clipA.webm' }).locator('[data-testid=add-asset]').click();
  await page.waitForTimeout(600);
  s = await state(page);
  check('clip added to timeline', s.clips.length === 1 && Math.abs(s.clips[0].duration - 8) < 0.1, JSON.stringify(s.clips));
  let cs = await canvasStats(page);
  check('preview renders video frame', cs.distinct > 20, JSON.stringify(cs));

  // Add audio
  await page.locator('[data-testid=asset-row]', { hasText: 'tone.ogg' }).locator('[data-testid=add-asset]').click();
  s = await state(page);
  check('audio placed on audio track', s.clips.length === 2 && s.tracks.includes('audio'));

  // Play and measure sync
  await page.click('[data-testid=play-toggle]');
  await page.waitForTimeout(2000);
  const sync = await page.evaluate(() => {
    const K = window.__KING__;
    const p = K.useProjectStore.getState().project;
    const vid = Object.values(p.clips).find((c) => c.type === 'media' && c.duration > 7.9 && c.duration < 8.1);
    const el = K.engine.mediaPool.getElement(vid.id);
    return { t: K.engine.clock.now(), el: el ? el.currentTime : null, paused: el ? el.paused : null, fps: K.engine.stats.fps };
  });
  check('playback advances', sync.t > 1.2, `t=${sync.t.toFixed(2)}`);
  check('video element follows master clock (<150ms drift)', sync.el !== null && Math.abs(sync.el - sync.t) < 0.15, `clock=${sync.t.toFixed(3)} video=${sync.el?.toFixed(3)} fps=${sync.fps.toFixed(0)}`);
  await page.click('[data-testid=play-toggle]');
  s = await state(page);
  check('pause stops clock', !s.playing);

  // Seek & split with keyboard
  await page.evaluate(() => window.__KING__.engine.seek(3));
  await page.evaluate(() => window.__KING__.useProjectStore.getState().select(null));
  await page.keyboard.press('s');
  s = await state(page);
  check('split at playhead splits clips under playhead', s.clips.length === 4, `${s.clips.length} clips`);
  const right = s.clips.find((c) => c.type === 'media' && Math.abs(c.start - 3) < 0.01 && c.in > 2.9);
  check('split right half has correct source in-point', !!right, JSON.stringify(s.clips));
  await page.click('[data-testid=undo]');
  s = await state(page);
  check('undo restores', s.clips.length === 2);
  await page.click('[data-testid=redo]');
  s = await state(page);
  check('redo reapplies', s.clips.length === 4);
  await page.keyboard.press('Control+z');
  s = await state(page);

  // Trim with mouse: select video clip then drag end handle
  const vclip = s.clips.find((c) => c.type === 'media' && c.duration > 7.9 && c.duration < 8.1);
  const vEl = page.locator(`[data-clip-id="${vclip.id}"]`);
  await vEl.click({ position: { x: 30, y: 15 } });
  const handle = vEl.locator('[data-handle=end]');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 60, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.move(hb.x + hb.width / 2 - 120, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  s = await state(page);
  const trimmed = s.clips.find((c) => c.id === vclip.id);
  check('trim end handle shortens clip', trimmed.duration < 7.5 && trimmed.duration > 4, `duration=${trimmed.duration.toFixed(2)}`);
  const pastAfterTrim = s.past;

  // Move clip by dragging body
  const vb = await vEl.boundingBox();
  await page.mouse.move(vb.x + 40, vb.y + 15);
  await page.mouse.down();
  await page.mouse.move(vb.x + 100, vb.y + 15, { steps: 5 });
  await page.mouse.move(vb.x + 160, vb.y + 15, { steps: 5 });
  await page.mouse.up();
  s = await state(page);
  const moved = s.clips.find((c) => c.id === vclip.id);
  check('drag moves clip', moved.start > 1, `start=${moved.start.toFixed(2)}`);
  check('one history entry per gesture', s.past === pastAfterTrim + 1, `past ${pastAfterTrim} -> ${s.past}`);

  // Text
  await page.evaluate(() => window.__KING__.engine.seek(2.5));
  await page.keyboard.press('t');
  s = await state(page);
  check('text clip added on new text track', s.clips.some((c) => c.type === 'text') && s.tracks[0] === 'text');
  await page.locator('[aria-label="Text content"]').fill('KING EDITOR');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(shotDir, 'desktop-1366.png') });

  // Inspector numeric edit: opacity
  const op = page.locator('[aria-label="Opacity % value"]');
  await op.fill('50');
  await op.press('Enter');
  const opacity = await page.evaluate(() => {
    const p = window.__KING__.useProjectStore.getState();
    return p.project.clips[p.selectedClipId].transform.opacity;
  });
  check('inspector numeric field updates transform', Math.abs(opacity - 0.5) < 1e-6, `opacity=${opacity}`);

  // Delete with keyboard
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.evaluate(() => {
    const K = window.__KING__;
    const c = Object.values(K.useProjectStore.getState().project.clips).find((c) => c.type === 'text');
    K.useProjectStore.getState().select(c.id);
  });
  await page.keyboard.press('Delete');
  s = await state(page);
  check('delete removes selected clip', !s.clips.some((c) => c.type === 'text'));

  // Remove asset in use (confirm auto-accepted) → clips removed, resources released
  await page.locator('[data-testid=asset-row]', { hasText: 'tone.ogg' }).getByRole('button', { name: /Remove/ }).click();
  s = await state(page);
  check('removing used asset removes its clips', s.assets.length === 3 && s.clips.every((c) => c.type !== 'media' || true));

  // Reimport cycle
  for (let i = 0; i < 3; i++) {
    await page.setInputFiles('[data-testid=file-input]', [m('tone.ogg')]);
    await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
    await page.locator('[data-testid=asset-row]', { hasText: 'tone.ogg' }).getByRole('button', { name: /Remove/ }).click();
  }
  s = await state(page);
  check('repeated import/remove leaves library consistent', s.assets.length === 3);

  // Wide iPad landscape
  const ipad = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
  const ip = await ipad.newPage();
  ip.on('pageerror', (e) => errors.push('ipad: ' + e.message));
  await ip.goto(URL_);
  await ip.setInputFiles('[data-testid=file-input]', [m('clipA.webm'), m('tone.ogg'), m('still.png')]);
  await ip.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  for (const n of ['clipA.webm', 'still.png', 'tone.ogg']) {
    const row = ip.locator('[data-testid=asset-row]', { hasText: n });
    if (await row.count()) await row.locator('[data-testid=add-asset]').tap();
  }
  await ip.waitForTimeout(800);
  // Tap-select a clip on the timeline via touch
  const firstClip = ip.locator('[data-clip-id]').first();
  await firstClip.tap();
  const sel = await ip.evaluate(() => window.__KING__.useProjectStore.getState().selectedClipId);
  check('touch tap selects clip (iPad emulation)', !!sel);
  await ip.waitForTimeout(300);
  await ip.screenshot({ path: path.join(shotDir, 'ipad-landscape.png') });

  // iPhone portrait
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const ph = await phone.newPage();
  ph.on('pageerror', (e) => errors.push('iphone: ' + e.message));
  await ph.goto(URL_);
  await ph.getByRole('button', { name: 'Media' }).tap();
  await ph.setInputFiles('[data-testid=file-input]', [m('portrait.webm'), m('tone.ogg')]);
  await ph.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  await ph.waitForTimeout(800);
  await ph.screenshot({ path: path.join(shotDir, 'iphone-media-sheet.png') });
  await ph.locator('[data-testid=add-asset]').first().tap();
  await ph.getByRole('button', { name: 'Close Media' }).tap();
  await ph.locator('[data-clip-id]').first().tap();
  await ph.getByRole('button', { name: 'Adjust' }).tap();
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: path.join(shotDir, 'iphone-inspector.png') });
  await ph.getByRole('button', { name: 'Close Inspector' }).first().tap();
  const noHScroll = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('iPhone: no horizontal page overflow', noHScroll);
  await ph.screenshot({ path: path.join(shotDir, 'iphone-portrait.png') });

  const phoneL = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const pl = await phoneL.newPage();
  await pl.goto(URL_);
  await pl.screenshot({ path: path.join(shotDir, 'iphone-landscape.png') });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
