/*
 * Projects home + autosave + reopen (browser library, IndexedDB), keyboard
 * shortcut customization, Simple/Pro modes, pro effects parity and flicker.
 *   node scripts/e2e-home.cjs <media-dir> <out-dir>
 */
const { chromium } = require('playwright');
const path = require('path');
const [mediaDir, outDir] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

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
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Renamed project') : d.accept()));

  /* ---------- home → new project ---------- */
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('[data-testid=home]');
  check('app opens on the projects home', true);
  await page.screenshot({ path: path.join(outDir, 'home-empty.png') });
  await page.getByTestId('new-9:16').click();
  await page.waitForSelector('[data-testid=preview-stage]');
  const st = await page.evaluate(() => document.querySelector('[data-testid=preview-stage]').getBoundingClientRect());
  check('new 9:16 project opens the editor in portrait', st.height > st.width, `${Math.round(st.width)}×${Math.round(st.height)}`);
  await page.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm'), path.join(mediaDir, 'speech.ogg')]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=asset-row]').length === 2 && ![...document.querySelectorAll('[data-testid=asset-row]')].some((r) => r.textContent.includes('…')), null, { timeout: 20000 });
  for (const b of await page.locator('[data-testid=add-asset]').all()) await b.click();
  await page.locator('[aria-label="Project title"]').fill('My Reel');
  await page.locator('[aria-label="Project title"]').press('Enter');
  await page.waitForTimeout(1500);
  await page.waitForSelector('[data-testid=save-status]:has-text("Saved")', { timeout: 15000 });
  check('autosave indicator shows Saved', true);

  /* ---------- reload → project persists with media ---------- */
  await page.reload();
  await page.waitForSelector('[data-testid=project-card]', { timeout: 10000 });
  const cards = await page.locator('[data-testid=project-card]').allInnerTexts();
  check('project listed on home after reload', cards.length === 1 && cards[0].includes('My Reel'), cards.join(' | ').replace(/\n/g, ' '));
  const thumb = await page.locator('[data-testid=project-card] img').count();
  check('project card has a thumbnail', thumb === 1);
  await page.screenshot({ path: path.join(outDir, 'home-projects.png') });
  await page.locator('[data-testid=project-card] button').first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-clip-id]').length === 2, null, { timeout: 15000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid=asset-row]')].some((r) => r.textContent.includes('…')), null, { timeout: 20000 });
  const rows = await page.locator('[data-testid=asset-row]').allInnerTexts();
  check('reopened project restores clips and stored media', rows.length === 2 && rows.some((r) => /1280×720/.test(r)), rows.map((r) => r.replace(/\n/g, ' ')).join(' | '));
  await page.click('[data-testid=play-toggle]');
  await page.waitForTimeout(1200);
  await page.click('[data-testid=play-toggle]');
  check('restored media plays', !(await page.getByTestId('timecode').innerText()).startsWith('00:00:00'));

  /* ---------- flicker while dragging a clip ---------- */
  await page.evaluate(() => {
    const K = window.__KING__;
    window.__fl = { f: 0, h: 0, on: true };
    const tick = () => {
      const t = window.__KING__?.engine?.clock.now?.() ?? 0;
      void t;
      const vids = [...document.querySelectorAll('[data-testid=preview-stage] video')];
      const vis = vids.some((v) => getComputedStyle(v.parentElement.parentElement).visibility === 'visible');
      window.__fl.f++;
      if (!vis) window.__fl.h++;
      if (window.__fl.on) requestAnimationFrame(tick);
    };
    void K;
    requestAnimationFrame(tick);
  }).catch(() => {});
  const ruler = await page.locator('[data-testid=timeline-ruler]').boundingBox();
  await page.mouse.move(ruler.x + 40, ruler.y + 10);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(ruler.x + 40 + i * 5, ruler.y + 10);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const fl = await page.evaluate(() => ((window.__fl.on = false), window.__fl));
  check('no flicker while scrubbing over a clip', fl.h === 0, `${fl.h}/${fl.f} frames hidden`);

  /* ---------- Simple / Pro ---------- */
  const vid = page.locator('[data-clip-id]').first();
  await vid.click({ position: { x: 20, y: 12 } });
  const simpleAnchor = await page.getByLabel('Anchor X %', { exact: true }).count();
  const simpleDiamonds = await page.getByRole('button', { name: /keyframe$/ }).count();
  check('Simple mode hides advanced controls', simpleAnchor === 0 && simpleDiamonds === 0, `anchor=${simpleAnchor} diamonds=${simpleDiamonds}`);
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Pro' }).click();
  const proAnchor = await page.getByLabel('Anchor X %', { exact: true }).count();
  const proFx = await page.getByText('Pro effects').count();
  check('Pro mode shows keyframes, anchor and pro effects', proAnchor === 1 && proFx === 1);

  // pro effects parity: rounded corners + shadow + blend
  await page.evaluate(() => window.__KING__ && null);
  await page.getByLabel('Corners px value').fill('120');
  await page.getByLabel('Corners px value').press('Enter');
  await page.getByRole('switch', { name: 'Drop shadow' }).click();
  await page.getByLabel('Blend mode').selectOption('screen');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const fx = await page.evaluate(() => 1);
  void fx;
  const gpu = await previewPng(page);
  await page.getByRole('radio', { name: 'Canvas' }).click();
  await page.getByRole('radio', { name: 'Full' }).click();
  await page.waitForTimeout(800);
  const cv = await previewPng(page);
  const diff = await pngDiff(page, gpu, cv);
  check('pro effects (corners + shadow + blend): GPU preview matches export renderer', diff < 6, `diff=${diff.toFixed(2)}`);
  require('fs').writeFileSync(path.join(outDir, 'pro-gpu.png'), Buffer.from(gpu, 'base64'));
  require('fs').writeFileSync(path.join(outDir, 'pro-canvas.png'), Buffer.from(cv, 'base64'));
  await page.getByRole('radio', { name: 'GPU (smooth)' }).click();
  await page.screenshot({ path: path.join(outDir, 'pro-effects.png') });

  /* ---------- shortcuts: rebind split to C ---------- */
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).first().click();
  await page.getByTestId('shortcut-split').click();
  await page.keyboard.press('c');
  const label = await page.getByTestId('shortcut-split').innerText();
  check('shortcut rebound by pressing a key', label.trim() === 'C', label);
  await page.getByTestId('shortcuts-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const before = await page.locator('[data-clip-id]').count();
  await page.locator('body').click({ position: { x: 700, y: 300 } }).catch(() => {});
  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  const after = await page.locator('[data-clip-id]').count();
  check('custom shortcut performs split', after > before, `${before} → ${after}`);
  await page.keyboard.press('s');
  await page.waitForTimeout(200);
  check('old key no longer splits', (await page.locator('[data-clip-id]').count()) === after);
  const persisted = await page.evaluate(() => localStorage.getItem('king-editor:shortcuts'));
  check('shortcut saved on device', !!persisted && persisted.includes('KeyC'), persisted);

  /* ---------- back home, rename / duplicate / delete ---------- */
  await page.getByTestId('home-button').click();
  await page.waitForSelector('[data-testid=project-card]');
  await page.getByRole('button', { name: /My Reel options/ }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-card]').length === 2);
  check('duplicate project', true);
  await page.getByRole('button', { name: /My Reel \(copy\) options/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=project-card]').length === 1);
  check('delete project', true);
  await page.getByRole('button', { name: /My Reel options/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=project-card]')?.textContent.includes('Renamed project'));
  check('rename project', true);

  /* ---------- an untouched new project is not kept ---------- */
  await page.getByTestId('new-16:9').click();
  await page.waitForSelector('[data-testid=preview-stage]');
  await page.getByTestId('home-button').click();
  await page.waitForSelector('[data-testid=project-card]');
  await page.waitForTimeout(300);
  check('empty untouched project is discarded', (await page.locator('[data-testid=project-card]').count()) === 1);

  /* ---------- Arabic home ---------- */
  await page.getByTestId('lang-toggle').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'home-ar.png') });

  check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const fails = results.filter((r) => !r).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
