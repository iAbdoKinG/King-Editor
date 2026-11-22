# KING EDITOR

A touch-first, privacy-by-default video editor PWA. iPad is the main target, with iPhone and desktop also supported. Everything runs locally in the browser: no accounts, no uploads, no analytics, no persistent storage (V1).

```bash
npm install
npm run dev        # development server
npm run build      # type-check + production build (dist/)
npm test           # unit tests (timeline ops, audio envelopes)
# end-to-end smoke test (needs Playwright + ffmpeg-generated media, see script header)
npm run build && npx vite preview --port 4173 &
node scripts/e2e.cjs <media-dir> <screenshot-dir>
```

## Architecture

```
src/
  engine/                 framework-free editing engine (no React)
    timeline/model.ts     data model factories, frame size, helpers
    timeline/ops.ts       pure, non-destructive ops: insert/move/trim/split/duplicate/
                          ripple-delete/speed/tracks/snapping (unit tested)
    playback/clock.ts     the single master timeline clock (+ buffering hold)
    playback/mediaPool.ts bounded pool of reusable <video>/<audio> elements, synced to the clock
    playback/engine.ts    one rAF loop: clock → media sync → compositor; sleeps when idle
    audio/audioGraph.ts   Web Audio routing (per-element gain + pan → master), fades
    rendering/compositor.ts Canvas 2D compositor (shared by preview and future export)
    rendering/geometry.ts transform maths shared by drawing, handles and hit-testing
  stores/                 Zustand: project (+ snapshot undo/redo with transactions), media, UI
  features/               UI by domain: media, preview, timeline, inspector, export
  components/ hooks/ app/ shell, icons, layout detection, shortcuts, PWA registration
```

Key decisions:

- **One clock.** Media elements never drive time. They are re-seeked when they drift more than 200 ms, and the clock holds while active media buffers, for up to 2.5 s.
- **High-frequency state stays out of React.** The playhead, timecode and transform outline are written to the DOM from the engine's rAF loop.
- **Bounded decoding.** Six video and six audio elements are reused. An element gets a `src` only while its clip is within about 1.5 s of the playhead, and it is unloaded afterwards.
- **iOS media rules.** On the first user gesture, every pooled element is unlocked and the `AudioContext` is created. Video is always `playsinline`. Volume, pan and fades go through Web Audio, because iOS ignores `element.volume`.
- **Undo/redo** keeps structurally shared project snapshots. A continuous gesture (drag, slider) records a single history entry.
- **Feature detection** covers canvas `filter`, `StereoPannerNode`, the Fullscreen API (with a CSS fallback on iPhone), WebCodecs and MediaRecorder.

## Interaction model

| Input | Timeline |
|---|---|
| Touch / Pencil | Tap a clip to select it. Drag a *selected* clip to move it. Drag anything else to scroll natively. Trim handles appear on the selected clip. Long-press opens the menu. Pinch to zoom. Tap empty space to seek. |
| Mouse | Press and drag moves any clip. Drag on empty space scrubs. Right-click opens the menu. Ctrl/⌘ + wheel zooms. |

In the preview you can tap to select the top-most element, drag to move it, use the corner handle to scale and the top handle to rotate, or use two fingers to pinch and rotate. Elements snap to the centre lines and to 45°.

Keyboard: Space/K play · ←/→ frame · ⇧←/→ 1 s · S or ⌘B split · ⌘D duplicate · ⌫ delete · ⇧⌫ ripple delete · ⌘Z / ⇧⌘Z undo/redo · T text · N snapping · F focus mode · +/− zoom · Home/End.

## Milestone status

| Milestone | Status |
|---|---|
| 1 Foundation: Vite/React/TS/Tailwind, tokens, branding, responsive layouts, PWA | done |
| 2 Media workspace: import, metadata, thumbnails, preview, transport, cleanup | done |
| 3 Timeline: tracks, select, move, trim, split, delete, duplicate, zoom, scroll, snapping, undo/redo | done |
| 4 Transform & audio: numeric + direct-manipulation transforms, crop, multitrack audio, volume/pan/fades, speed | mostly done (keyframes pending) |
| 5 Effects & transitions | effects done (brightness/contrast/saturation/blur where canvas filters are supported); transitions and keyframes **not started** |
| 6 Export | **not implemented**. The dialog only reports the device's real encoder capabilities. |
| 7 Optimisation | basic instrumentation (perf stats toggle in Project inspector); device profiling pending |

## Known limitations

- **No export yet.** The Export dialog is honest about this.
- **Effects need canvas `filter` support.** Safari releases older than 18 do not have it, so the controls are disabled there and the UI says so.
- **No audio waveforms.** Decoding whole files would break the "don't load large files into memory" rule.
- Codec support is whatever the browser supports. For example, HEVC `.mov` works in Safari but not in Chromium, and files that cannot be decoded are marked with an error.
- Work is session-only. Refreshing or closing the tab discards it, and a `beforeunload` warning appears when there is work to lose.
- Pool limit: at most six video clips can render at the same instant.

## Requires real-device validation (not testable in CI here)

- iPad/iPhone Safari: audio unlock on first tap, un-muted playback across clip boundaries, A/V sync, memory with long 4K clips, page suspension/resume, installed-PWA mode and safe areas.
- Touch gestures on real hardware: long-press menu, pinch zoom, two-finger preview transform, trim on small iPhones, and Apple Pencil hover/precision.
- H.264/HEVC/AAC files (the CI Chromium build has no proprietary codecs, so the tests use VP9/Opus).
