/*
 * Desktop (Electron) end-to-end test. Runs the real desktop shell.
 *   npm run build && (cd desktop && node copy-app.cjs)
 *   xvfb-run -a node scripts/e2e-desktop.cjs <media-dir> <work-dir>
 */
const { _electron: electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [mediaDir, workDir] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const desktopDir = path.join(__dirname, '..', 'desktop');
const exe = require(path.join(desktopDir, 'node_modules', 'electron'));

async function launch() {
  const app = await electron.launch({
    executablePath: exe,
    args: [desktopDir, '--no-sandbox'],
    env: { ...process.env, KING_E2E_DIR: workDir },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid=preview-stage]', { timeout: 30000 });
  return { app, page };
}

(async () => {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const errors = [];

  /* ---------- session 1: import, edit, save ---------- */
  let { app, page } = await launch();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const info = await page.evaluate(() => ({
    desktop: !!window.kingDesktop,
    node: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
    url: location.href,
    sw: !!navigator.serviceWorker?.controller,
  }));
  check('desktop bridge present, no Node in page', info.desktop && !info.node, JSON.stringify(info));
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration };
  });
  check('hardened window (isolation + sandbox, no nodeIntegration)', prefs.contextIsolation && prefs.sandbox && !prefs.nodeIntegration, JSON.stringify(prefs));
  const blocked = await page.evaluate(() => fetch('media://local/' + encodeURIComponent('/etc/passwd')).then((r) => r.status, () => 'error'));
  check('media:// refuses files the user did not pick', blocked === 403, String(blocked));

  await page.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm'), path.join(mediaDir, 'speech.ogg')]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=asset-row]').length === 2);
  await page.waitForTimeout(1500);
  const paths = await page.evaluate(async () => {
    const mod = await import('/src/stores/mediaStore.ts').catch(() => null);
    return mod ? null : null;
  });
  void paths;
  for (const el of await page.locator('[data-testid=add-asset]').all()) await el.click();
  await page.locator('body').press('m');
  await page.locator('[aria-label="Project title"]').fill('Desktop Test');
  await page.locator('[aria-label="Project title"]').press('Enter');
  await page.getByTestId('save-project').click();
  await page.waitForTimeout(800);
  const saved = fs.readdirSync(workDir).filter((f) => f.endsWith('.kingproj'));
  check('project saved to disk (.kingproj)', saved.length === 1, saved.join(','));
  const proj = JSON.parse(fs.readFileSync(path.join(workDir, saved[0]), 'utf8'));
  check('project references media by absolute path (no media copied)', proj.assets.length === 2 && proj.assets.every((a) => path.isAbsolute(a.path)) && fs.statSync(path.join(workDir, saved[0])).size < 50000, proj.assets.map((a) => path.basename(a.path)).join(','));
  await app.close();

  /* ---------- session 2: reopen; media streamed from disk ---------- */
  ({ app, page } = await launch());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.getByTestId('open-project').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-clip-id]').length >= 2, null, { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=asset-row]')].every((r) => !r.textContent.includes('…')), null, { timeout: 20000 }).catch(() => {});
  const title = await page.locator('[aria-label="Project title"]').inputValue();
  const markerCount = await page.locator('[data-marker-id]').count();
  check('reopened project restores title, clips and marker', title === 'Desktop Test' && markerCount === 1, `title=${title} markers=${markerCount}`);
  const rows = await page.locator('[data-testid=asset-row]').allInnerTexts();
  check('reopened media probed from disk (duration/resolution shown)', rows.length === 2 && rows.some((r) => /1280×720/.test(r)), rows.map((r) => r.replace(/\n/g, ' ')).join(' | '));
  await page.waitForSelector('[data-testid=waveform]', { timeout: 20000 }).catch(() => {});
  check('waveforms computed from streamed media', (await page.locator('[data-testid=waveform]').count()) >= 1);
  await page.locator('[data-testid=play-toggle]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-testid=play-toggle]').click();
  const tc = await page.locator('[data-testid=timecode]').innerText();
  check('playback runs on streamed media', !tc.startsWith('00:00:00'), tc);
  const shot = path.join(workDir, 'desktop.png');
  await page.screenshot({ path: shot });

  /* ---------- 4K export from streamed media ---------- */
  await page.getByRole('button', { name: 'Export' }).first().click();
  const dlg = page.getByTestId('export-dialog');
  const has2k = await dlg.getByRole('radio', { name: '2K' }).count();
  check('2K export option (maximum)', has2k === 1 && (await dlg.getByRole('radio', { name: '4K' }).count()) === 0);
  await dlg.getByRole('radio', { name: '2K' }).click();
  await page
    .waitForFunction(
      () =>
        (document.querySelector('[data-testid=export-dialog]')?.innerText.includes('2560×1440') && !document.querySelector('[data-testid=export-start]')?.disabled) ||
        document.querySelector('[data-testid=export-dialog] .text-danger'),
      null,
      { timeout: 60000 },
    )
    .catch(() => {});
  const planText = await page.locator('[data-testid=export-dialog]').innerText();
  console.log('     dialog:', planText.replace(/\n/g, ' | ').slice(0, 300));
  console.log('     plan:', planText.split('\n').filter((l) => /Output|×/.test(l)).join(' '));
  const canStart = await page.locator('[data-testid=export-start]').isEnabled();
  if (canStart) {
    const t0 = Date.now();
    await page.click('[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-done], [data-testid=export-dialog] p.text-danger', { timeout: 600000 });
    const err = await page.locator('[data-testid=export-dialog] p.text-danger').count();
    check('2K export completes', !err, err ? await page.locator('[data-testid=export-dialog] p.text-danger').innerText() : `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!err) {
      await page.click('[data-testid=export-download]');
      let out = null;
      for (let i = 0; i < 60 && !out; i++) {
        await page.waitForTimeout(500);
        const f = fs.readdirSync(workDir).find((n) => n.endsWith('.mp4') || n.endsWith('.webm'));
        if (f) out = path.join(workDir, f);
      }
      check('exported video saved through the desktop save flow', !!out, out ? path.basename(out) : 'none');
      await page.waitForTimeout(1500);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).toString());
      const v = probe.streams.find((s) => s.codec_type === 'video');
      check('ffprobe: 2560×1440 with audio', v?.width === 2560 && v?.height === 1440 && probe.streams.some((s) => s.codec_type === 'audio'), `${v?.codec_name} ${v?.width}x${v?.height}, ${probe.format.duration}s`);
    }
  } else check('2K export plan available', false, planText.slice(0, 200));

  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
