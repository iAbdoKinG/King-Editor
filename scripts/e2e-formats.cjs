/*
 * Universal import: files the browser cannot play are converted on import.
 *   node scripts/e2e-formats.cjs <formats-dir> [url]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [dir, url = 'http://localhost:4173/?debug'] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForSelector('[data-testid=preview-stage]');
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  const t0 = Date.now();
  await p.setInputFiles('[data-testid=file-input]', files.map((f) => path.join(dir, f)));
  const sawProgress = await p.waitForSelector('[data-testid=asset-converting]', { timeout: 20000 }).then(() => true, () => false);
  check('conversion progress shown in the media library', sawProgress);
  await p.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status === 'ready' || a.status === 'error'), null, { timeout: 600000 });
  console.log(`     all imports settled in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const assets = await p.evaluate(() => {
    const s = window.__KING__.useMediaStore.getState();
    return s.order.map((id) => {
      const a = s.assets[id];
      return { name: a.name, kind: a.kind, status: a.status, error: a.error, duration: a.duration, w: a.width, h: a.height, mime: a.mime };
    });
  });
  for (const a of assets) check(`${a.name} (${a.kind}) is usable`, a.status === 'ready' && a.duration > 0.5 && (a.kind !== 'video' || a.w > 0), `${a.status} ${a.error ?? ''} ${a.duration.toFixed(2)}s ${a.w}x${a.h} ${a.mime}`);
  // Put every converted asset on the timeline and play it.
  for (const el of await p.locator('[data-testid=add-asset]').all()) if (await el.isEnabled()) await el.click();
  const clips = await p.locator('[data-clip-id]').count();
  check('converted media added to the timeline', clips === assets.length, `${clips} clips`);
  await p.evaluate(() => window.__KING__.engine.seek(0.5));
  await p.click('[data-testid=play-toggle]');
  await p.waitForTimeout(1500);
  await p.click('[data-testid=play-toggle]');
  const tc = await p.locator('[data-testid=timecode]').innerText();
  check('playback runs on converted media', !tc.startsWith('00:00:00'), tc);
  const visible = await p.evaluate(() => [...document.querySelectorAll('[data-testid=preview-stage] video')].some((v) => v.readyState >= 2 && v.videoWidth > 0));
  check('converted video frames decoded in the preview', visible);
  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
