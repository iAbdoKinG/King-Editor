/*
 * Measures preview playback smoothness with an emulated slow CPU.
 *   node scripts/measure-playback.cjs <media-dir> [cpuSlowdown=4]
 * Reports: corrective seeks, clock holds, frames where the picture did not
 * advance although the clock did (visible stutter), and A/V drift.
 */
const { chromium } = require('playwright');
const path = require('path');
const [mediaDir, slow = '4'] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  if (process.env.FLAKY) {
    // Simulate iOS Safari briefly reporting "not enough data" while a video keeps playing.
    await page.addInitScript(() => {
      const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
      let until = 0;
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
        get() {
          const real = d.get.call(this);
          const now = performance.now();
          if (!this.paused && real >= 3) {
            if (now < until) return 2;
            if (Math.random() < 0.01) { until = now + 150; return 2; }
          }
          return real;
        },
      });
    });
  }
  await page.goto('http://localhost:4173/?debug');
  await page.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm'), path.join(mediaDir, 'portrait.webm'), path.join(mediaDir, 'tone.ogg')]);
  await page.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  for (const n of ['clipA.webm', 'portrait.webm']) {
    await page.locator('[data-testid=asset-row]', { hasText: n }).locator('[data-testid=add-asset]').click();
    await page.evaluate(() => window.__KING__.engine.seek(window.__KING__.engine.clock.duration));
  }
  await page.evaluate(() => window.__KING__.engine.seek(0));
  await page.locator('[data-testid=asset-row]', { hasText: 'tone.ogg' }).locator('[data-testid=add-asset]').click();
  await page.evaluate(() => window.__KING__.useProjectStore.getState().select(null));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slow) });
  await page.evaluate(() => window.__KING__.engine.seek(0));
  await page.waitForTimeout(800);
  await page.click('[data-testid=play-toggle]');
  const r = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const K = window.__KING__;
        const pool = K.engine.mediaPool;
        pool.stats.playSeeks = 0;
        pool.stats.holdFrames = 0;
        let frames = 0, frozen = 0, maxDrift = 0, lastVt = -1, lastT = -1, intervals = [], lastNow = performance.now();
        const step = (now) => {
          intervals.push(now - lastNow);
          lastNow = now;
          const t = K.engine.clock.now();
          const p = K.useProjectStore.getState().project;
          const c = Object.values(p.clips).find((c) => c.type === 'media' && t >= c.start && t < c.start + c.duration && c.duration > 4.5);
          const el = c && pool.getElement(c.id);
          if (el && !el.paused) {
            frames++;
            const expected = c.in + (t - c.start) * c.speed;
            maxDrift = Math.max(maxDrift, Math.abs(el.currentTime - expected));
            if (el.currentTime === lastVt && t - lastT > 0.07) frozen++;
            if (el.currentTime !== lastVt) { lastVt = el.currentTime; lastT = t; }
          }
          if (t < 12.5 && K.engine.clock.playing) requestAnimationFrame(step);
          else {
            intervals.sort((a, b) => a - b);
            resolve({ frames, frozen, maxDrift, playSeeks: pool.stats.playSeeks, holdFrames: pool.stats.holdFrames,
              p50: intervals[Math.floor(intervals.length / 2)], p95: intervals[Math.floor(intervals.length * 0.95)] });
          }
        };
        requestAnimationFrame(step);
      }),
  );
  console.log(JSON.stringify(r));
  await browser.close();
})();
