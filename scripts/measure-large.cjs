/*
 * Milestone 7 measurements on a large project.
 *   node scripts/measure-large.cjs <media-dir> [clips=300] [cpuSlowdown=4]
 * Reports frame times while dragging a clip and while playing, the hottest
 * functions (CPU profile), and JS heap growth after repeated import/remove.
 */
const { chromium } = require('playwright');
const path = require('path');
const [mediaDir, nArg = '300', slowArg = '4'] = process.argv.slice(2);
const N = Number(nArg);

async function profile(cdp, fn) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await cdp.send('Profiler.start');
  await fn();
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const k = n.callFrame.functionName || `(${n.callFrame.url ? 'anon' : n.callFrame.functionName || 'native'})`;
    self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0));
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  return [...self.entries()]
    .filter(([k]) => !/^\((idle|program|garbage)/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${((v / total) * 100).toFixed(1)}% ${k}`);
}

(async () => {
  const b = await chromium.launch({ args: ['--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  await p.goto('http://localhost:4173/?debug');
  await p.evaluate(() => window.__KING__.useUIStore.getState().setMode('pro'));
  await p.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm')]);
  await p.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
  // Build a large timeline: N one-second clips spread over 6 video tracks, with transitions.
  await p.evaluate((N) => {
    const K = window.__KING__;
    const asset = Object.values(K.useMediaStore.getState().assets)[0];
    K.useProjectStore.getState().apply((proj) => {
      const tracks = [];
      for (let i = 0; i < 6; i++) tracks.push({ id: 'trk_big' + i, kind: 'video', name: 'V' + i, muted: false, hidden: false });
      const clips = {};
      const per = Math.ceil(N / 6);
      for (let i = 0; i < N; i++) {
        const tr = i % 6;
        const k = Math.floor(i / 6);
        const id = 'c_big' + i;
        clips[id] = {
          id, type: 'media', trackId: tracks[tr].id, assetId: asset.id, start: k * 1, duration: 1, in: (k % 7) * 1, speed: 1,
          transform: { x: 0, y: 0, scaleX: 0.4, scaleY: 0.4, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5, crop: { top: 0, right: 0, bottom: 0, left: 0 } },
          effects: { brightness: 100, contrast: 100, saturation: 100, blur: 0, hue: 0, sepia: 0, grayscale: 0, vignette: 0 },
          audio: { volume: 1, pan: 0, fadeIn: 0, fadeOut: 0 },
          transitionIn: k > 0 && k % 3 === 0 ? { type: 'dissolve', duration: 0.3, direction: 'left', easing: 'linear' } : undefined,
        };
      }
      void per;
      return { ...proj, tracks: [...tracks, ...proj.tracks.filter((t) => t.kind === 'audio')], clips };
    });
  }, N);
  await p.waitForTimeout(800);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slowArg) });

  // 1) Drag a clip continuously (60 updates through the real store/React path).
  let drag;
  const dragTop = await profile(cdp, async () => {
    drag = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const K = window.__KING__;
          const ps = K.useProjectStore.getState();
          ps.begin();
          const base = K.useProjectStore.getState().txBase;
          const times = [];
          let i = 0;
          let last = performance.now();
          const step = (now) => {
            times.push(now - last);
            last = now;
            const c = base.clips['c_big0'];
            K.useProjectStore.getState().apply(() => ({ ...base, clips: { ...base.clips, c_big0: { ...c, start: c.start + i * 0.01 } } }), { commit: false });
            if (++i < 60) requestAnimationFrame(step);
            else {
              K.useProjectStore.getState().end();
              times.sort((a, b) => a - b);
              resolve({ p50: times[30].toFixed(1), p95: times[57].toFixed(1) });
            }
          };
          requestAnimationFrame(step);
        }),
    );
  });

  // 2) Playback over the dense region.
  await p.evaluate(() => window.__KING__.engine.seek(2));
  await p.waitForTimeout(500);
  let play;
  const playTop = await profile(cdp, async () => {
    await p.click('[data-testid=play-toggle]');
    play = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const times = [];
          let last = performance.now();
          const step = (now) => {
            times.push(now - last);
            last = now;
            if (times.length < 180) requestAnimationFrame(step);
            else {
              times.sort((a, b) => a - b);
              resolve({ p50: times[90].toFixed(1), p95: times[171].toFixed(1) });
            }
          };
          requestAnimationFrame(step);
        }),
    );
    await p.click('[data-testid=play-toggle]');
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // 3) Memory: import/remove the same file repeatedly.
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await p.evaluate(() => performance.memory.usedJSHeapSize)) / 1048576;
  };
  await p.evaluate(() => window.__KING__.useProjectStore.getState().apply((pr) => ({ ...pr, clips: {} })));
  const h0 = await heap();
  for (let i = 0; i < 8; i++) {
    await p.setInputFiles('[data-testid=file-input]', [path.join(mediaDir, 'clipA.webm'), path.join(mediaDir, 'speech.ogg')]);
    await p.waitForFunction(() => Object.values(window.__KING__.useMediaStore.getState().assets).every((a) => a.status !== 'loading'));
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      const ms = window.__KING__.useMediaStore.getState();
      for (const id of ms.order.slice(1)) ms.remove(id);
    });
  }
  await p.waitForTimeout(500);
  const h1 = await heap();
  const blobs = await p.evaluate(() => document.querySelectorAll('[data-testid=asset-row]').length);

  console.log(JSON.stringify({ clips: N, cpuSlowdown: Number(slowArg), dragFrameMs: drag, playFrameMs: play, heapMB: { before: h0.toFixed(1), after8Cycles: h1.toFixed(1) }, libraryRows: blobs }, null, 1));
  console.log('drag hot spots:\n  ' + dragTop.join('\n  '));
  console.log('playback hot spots:\n  ' + playTop.join('\n  '));
  await b.close();
})();
