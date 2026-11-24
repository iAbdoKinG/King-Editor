/*
 * Desktop universal import (native FFmpeg).
 *   npm run build && (cd desktop && node copy-app.cjs)
 *   xvfb-run -a node scripts/e2e-desktop-formats.cjs <formats-dir> <work-dir>
 */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const [dir, workDir] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const desktopDir = path.join(__dirname, '..', 'desktop');

(async () => {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const app = await electron.launch({ executablePath: require(path.join(desktopDir, 'node_modules', 'electron')), args: [desktopDir, '--no-sandbox'], env: { ...process.env, KING_E2E_DIR: workDir } });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('[data-testid=home]', { timeout: 30000 });
  check('web FFmpeg (WebAssembly) not shipped in the desktop app', !fs.existsSync(path.join(desktopDir, 'app', 'ffmpeg')));
  await page.getByTestId('new-16:9').click();
  await page.waitForSelector('[data-testid=preview-stage]');
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  await page.setInputFiles('[data-testid=file-input]', files.map((f) => path.join(dir, f)));
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid=asset-row]')];
    return rows.length > 0 && rows.every((r) => !/…/.test(r.innerText));
  }, null, { timeout: 300000 });
  const rows = await page.locator('[data-testid=asset-row]').allInnerTexts();
  for (const r of rows) check(`ready: ${r.split('\n')[1]}`, /\d+×\d+|0:0\d|00:0/.test(r) && !/could not|cannot/i.test(r), r.replace(/\n/g, ' '));
  const conv = fs.existsSync(path.join(workDir, 'converted')) ? fs.readdirSync(path.join(workDir, 'converted')) : [];
  check('converted copies written next to the library (originals untouched)', conv.length === files.length && conv.every((f) => /\.(mp4|m4a)$/.test(f)), conv.join(', '));
  for (const el of await page.locator('[data-testid=add-asset]').all()) if (await el.isEnabled()) await el.click();
  await page.locator('[data-testid=play-toggle]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid=play-toggle]').click();
  const tc = await page.locator('[data-testid=timecode]').innerText();
  check('playback runs on converted media', !tc.startsWith('00:00:00'), tc);
  await page.waitForTimeout(1500);
  const lib = path.join(workDir, 'library');
  const proj = fs.readdirSync(lib).map((d) => JSON.parse(fs.readFileSync(path.join(lib, d, 'project.qissa'), 'utf8')))[0];
  check('project references the converted files', proj && proj.assets.every((a) => /converted/.test(a.path)), proj?.assets.map((a) => path.basename(a.path)).join(', '));
  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
