/*
 * Counts preview frames where the picture disappears while a clip is dragged
 * along the timeline under the playhead (and while scrubbing).
 *   node scripts/measure-flicker.cjs <media-dir>
 */
const { chromium } = require('playwright');
const path = require('path');
const [mediaDir] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  await p.goto('http://localhost:4173/?debug');
  await p.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm')]);
  await p.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  await p.locator('[data-testid=add-asset]').first().click();
  await p.evaluate(() => window.__KING__.engine.seek(4));
  await p.waitForTimeout(800);
  // Sample every animation frame: is a video layer visible in the GPU stage?
  await p.evaluate(() => {
    window.__flick = { frames: 0, hidden: 0 };
    const tick = () => {
      const stage = document.querySelector('[data-testid=preview-stage]');
      const vids = [...stage.querySelectorAll('video')];
      const visible = vids.some((v) => getComputedStyle(v.parentElement.parentElement).visibility === 'visible');
      const K = window.__KING__;
      const t = K.engine.clock.now();
      const covered = Object.values(K.useProjectStore.getState().project.clips).some((c) => t >= c.start + 0.05 && t < c.start + c.duration - 0.05);
      if (covered) {
        window.__flick.frames++;
        if (!visible) window.__flick.hidden++;
      }
      if (window.__flickOn) requestAnimationFrame(tick);
    };
    window.__flickOn = true;
    requestAnimationFrame(tick);
  });
  const clip = p.locator('[data-clip-id]').first();
  const bb = await clip.boundingBox();
  await p.mouse.move(bb.x + 40, bb.y + 15);
  await p.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await p.mouse.move(bb.x + 40 + i * 4, bb.y + 15);
    await p.waitForTimeout(16);
  }
  await p.mouse.up();
  // scrub the ruler too
  const ruler = await p.locator('[data-testid=timeline-ruler]').boundingBox();
  await p.mouse.move(ruler.x + 100, ruler.y + 10);
  await p.mouse.down();
  for (let i = 0; i < 40; i++) {
    await p.mouse.move(ruler.x + 100 + i * 6, ruler.y + 10);
    await p.waitForTimeout(16);
  }
  await p.mouse.up();
  const r = await p.evaluate(() => {
    window.__flickOn = false;
    return window.__flick;
  });
  console.log(JSON.stringify({ ...r, hiddenPct: ((100 * r.hidden) / r.frames).toFixed(1) }));
  await b.close();
})();
