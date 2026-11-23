/*
 * Custom frame size (independent width/height), independent clip width/height,
 * and 2K export cap — exercised in the Arabic interface.
 *   node scripts/e2e-size.cjs <media-dir> <out-dir>
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true, locale: 'ar-SA' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:4173/?debug');
  await page.evaluate(() => window.__KING__.useUIStore.getState().setMode('pro'));
  check('Arabic UI by default for an Arabic device', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');

  await page.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm')]);
  await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  await page.locator('[data-testid=add-asset]').first().click();
  await page.evaluate(() => window.__KING__.useProjectStore.getState().select(null));

  // Custom frame size from the project inspector (Arabic labels)
  await page.getByLabel('نسبة الأبعاد').last().selectOption('custom');
  await page.getByLabel('العرض', { exact: true }).fill('1080');
  await page.getByLabel('العرض', { exact: true }).press('Enter');
  await page.getByLabel('الطول', { exact: true }).fill('1350');
  await page.getByLabel('الطول', { exact: true }).press('Enter');
  const st = await page.evaluate(() => window.__KING__.useProjectStore.getState().project.settings);
  check('custom width and height set independently', st.aspect === 'custom' && st.customWidth === 1080 && st.customHeight === 1350, JSON.stringify(st));
  const box = await page.locator('[data-testid=preview-stage]').boundingBox();
  check('preview follows the custom frame (4:5)', Math.abs(box.width / box.height - 1080 / 1350) < 0.01, `${box.width.toFixed(0)}×${box.height.toFixed(0)}`);
  await page.getByLabel('الطول', { exact: true }).fill('9999');
  await page.getByLabel('الطول', { exact: true }).press('Enter');
  const capped = await page.evaluate(() => window.__KING__.useProjectStore.getState().project.settings.customHeight);
  check('dimension capped at 2560 (2K)', capped === 2560, String(capped));
  await page.getByLabel('الطول', { exact: true }).fill('1350');
  await page.getByLabel('الطول', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'تبديل الطول والعرض' }).click();
  const swapped = await page.evaluate(() => window.__KING__.useProjectStore.getState().project.settings);
  check('swap width/height', swapped.customWidth === 1350 && swapped.customHeight === 1080);
  await page.getByRole('button', { name: 'تبديل الطول والعرض' }).click();

  // Clip width and height independently
  const id = await page.evaluate(() => Object.keys(window.__KING__.useProjectStore.getState().project.clips)[0]);
  await page.evaluate((id) => window.__KING__.useProjectStore.getState().select(id), id);
  await page.evaluate(() => window.__KING__.engine.seek(1));
  await page.getByRole('switch', { name: 'ربط الطول والعرض' }).click();
  await page.getByLabel('قيمة العرض %').fill('150');
  await page.getByLabel('قيمة العرض %').press('Enter');
  await page.getByLabel('قيمة الطول %').fill('80');
  await page.getByLabel('قيمة الطول %').press('Enter');
  const tr = await page.evaluate((id) => window.__KING__.useProjectStore.getState().project.clips[id].transform, id);
  check('clip width and height scaled independently', Math.abs(tr.scaleX - 1.5) < 1e-6 && Math.abs(tr.scaleY - 0.8) < 1e-6, `x=${tr.scaleX} y=${tr.scaleY}`);
  await page.screenshot({ path: path.join(outDir, 'size-ar.png') });

  // Export: options top out at 2K
  await page.getByRole('button', { name: 'تصدير' }).first().click();
  const radios = await page.getByTestId('export-dialog').getByRole('radio').allInnerTexts();
  check('export options are 720p / 1080p / 2K (no 4K)', radios.includes('2K') && !radios.some((r) => /4K|2160/.test(r)), radios.join(','));
  await page.getByTestId('export-dialog').getByRole('radio', { name: '2K' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=export-dialog]')?.innerText.includes('1440×1800'), null, { timeout: 15000 }).catch(() => {});
  const planTxt = await page.getByTestId('export-dialog').innerText();
  check('2K plan for 1080×1350 is 1440×1800', planTxt.includes('1440×1800'), planTxt.split('\n').find((l) => l.includes('×')) || '');
  await page.click('[data-testid=export-start]');
  await page.waitForSelector('[data-testid=export-done], [data-testid=export-dialog] p.text-danger', { timeout: 240000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-download]')]);
  const out = path.join(outDir, 'custom-2k.mp4');
  await dl.saveAs(out);
  const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', out]).toString()).streams[0];
  check('ffprobe: exported 1440×1800', v.width === 1440 && v.height === 1800, `${v.codec_name} ${v.width}x${v.height}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', out, '-frames:v', '1', path.join(outDir, 'custom-2k-frame.png')]);

  check('no uncaught errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
