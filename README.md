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
node scripts/e2e-m456.cjs <media-dir> <out-dir>   # keyframes, transitions, export (+ ffprobe)
node scripts/measure-playback.cjs <media-dir> 6   # playback smoothness under 6× CPU slowdown
node scripts/e2e-phase-a.cjs <media-dir> <out-dir>   # waveforms, markers, themes, presets, fonts, transitions, audio, advisor
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
    timeline/animation.ts keyframes + easing (unit tested)
    timeline/transitions.ts transition windows, layer mixes (alpha/offset/scale/audio)
  features/export/exporter.ts  offline renderer: sequential WebCodecs decode → compositor → encoder (lazy-loaded)
  stores/                 Zustand: project (+ snapshot undo/redo with transactions), media, UI
  features/               UI by domain: media, preview, timeline, inspector, export
  components/ hooks/ app/ shell, icons, layout detection, shortcuts, PWA registration
```

Key decisions:

- **One clock.** Media elements never drive time. They are re-seeked when they drift more than 200 ms, and the clock holds while active media buffers, for up to 2.5 s.
- **GPU preview (default).** Video is never copied into a canvas during playback. The pooled `<video>` elements themselves are positioned inside the preview, and transforms, keyframes, transitions, crop, opacity and filters are applied as CSS, so the browser's GPU compositor does the work (`engine/rendering/domStage.ts`). Export uses the canvas compositor with the same geometry; an e2e check confirms both produce the same picture (mean difference under 1/255). Profiling with a 6× slowed CPU: before, `drawImage` took about 80% of the main thread and frame-time p95 was 150 ms; after, p95 is 16.7 ms and the main thread is 68% idle. A Canvas renderer remains available under Project → Preview.
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
| 4 Transform & audio: numeric + direct-manipulation transforms, crop, multitrack audio, volume/pan/fades, speed, **keyframes** (position/scale/rotation/opacity, linear/ease in/out/in-out, auto-key, split/trim-safe) | done |
| 5 Effects & transitions: brightness/contrast/saturation/blur; **Cross Dissolve, Fade, Slide (4 directions), Zoom** centred on cuts, with duration/easing and audio crossfade | done |
| 6 Export: offline, frame-accurate WebCodecs render → MP4 (H.264/HEVC + AAC/Opus) or WebM fallback, 720p/1080p, 24–60 fps, progress, cancel, file verified by re-parsing before success, Download / Share | done (needs real iPad validation) |
| 7 Optimisation | basic instrumentation (perf stats toggle in Project inspector); device profiling pending |

## Phase A additions

- **Waveforms** under every clip with sound (video strip + audio clips). They are computed in a background stream, so the decoded audio is never kept in memory. Silent stretches are shaded so pauses are easy to find.
- **Markers**: add with `M` (`⇧M` add and name), jump with `[` / `]`, tap a flag to rename, recolour or delete. Clips snap to markers.
- **Themes**: 7 presets (incl. Light) plus a fully editable custom theme; saved on the device.
- **Presets library**: save effects, text styles, transitions, animations and themes. Apply in one tap. Share as a link (data lives in the URL fragment, never sent to a server) or as a `.kingpreset` file. Imports are strictly validated and clamped (plain values only).
- **Fonts**: 16 Arabic fonts (Cairo, Tajawal, Almarai, IBM Plex Arabic, Amiri, Aref Ruqaa, El Messiri, Reem Kufi, …) and 9 display fonts. They are bundled but download only on first use. RTL text is handled in both the preview and export.
- **Transitions**: Wipe, Iris, Cover, Flash, Blur Dissolve and Spin, in addition to Push, Dissolve, Fade and Zoom. Each is verified to look the same in preview and export.
- **Effects**: hue, warmth, grayscale, vignette, and 10 one-tap **Looks** previewed on the clip's own thumbnail.
- **Transform tools**: flip H/V, Fit/Fill/Stretch, a rotation-aware 3×3 align grid, and 12 quick animations (fade/pop/slide/spin in-out, slow zoom, pan) that remain editable keyframes.
- **Audio arrangement**: extract audio to its own track; per-track volume, mute and solo, applied identically in playback and export.
- **Resource advisor**: warns once about workloads that are heavy for a browser (4K, very long media, many stacked videos, heavy blur, very long exports).
- **Touch**: wider trim handles on touch screens; double-tap a clip to open its properties.

## Known limitations

- **Export needs WebCodecs** (Safari 16.4+/iPadOS 16.4+, current Chrome/Edge). Audio uses AAC where the browser can encode it, otherwise Opus. 4K is not offered yet. The audio mix is rendered in memory (about 23 MB per minute).
- Keyframes cover position, scale, rotation and opacity. Effects and volume are not animatable yet.
- **Effects need canvas `filter` support.** Safari releases older than 18 do not have it, so the controls are disabled there and the UI says so.
- **No audio waveforms.** Decoding whole files would break the "don't load large files into memory" rule.
- Codec support is whatever the browser supports. For example, HEVC `.mov` works in Safari but not in Chromium, and files that cannot be decoded are marked with an error.
- Work is session-only. Refreshing or closing the tab discards it, and a `beforeunload` warning appears when there is work to lose.
- Pool limit: at most six video clips can render at the same instant.

## Requires real-device validation (not testable in CI here)

- iPad/iPhone Safari: audio unlock on first tap, un-muted playback across clip boundaries, A/V sync, memory with long 4K clips, page suspension/resume, installed-PWA mode and safe areas.
- Touch gestures on real hardware: long-press menu, pinch zoom, two-finger preview transform, trim on small iPhones, and Apple Pencil hover/precision.
- H.264/HEVC/AAC files (the CI Chromium build has no proprietary codecs, so the tests use VP9/Opus).
