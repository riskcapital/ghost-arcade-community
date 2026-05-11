# Changelog

All notable changes to Ghost Arcade Community are documented here.

This project follows [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

---

## [1.1.6] — 2026-05-11

### Added

- **Settings → Performance tab.** A dedicated panel for users on
  weaker hardware to dial in the editor until it feels smooth.
  Defaults match the historical full-quality behaviour so capable
  machines see no change. All settings apply live (no restart).
  - **Render Quality**: Shader Quality (moved here from Output).
  - **Editor Render**: Frame rate cap (Uncapped / 60 / 30 fps).
    Caps the main render loop — big win on high-refresh monitors
    (120/144/165 Hz) where the projector is 60 Hz and the extra
    frames are wasted.
  - **VJ Preview**: Resolution cap (Full / 1280 / 960 / 640 / 480 px
    long-edge) + Refresh rate (60 / 30 / 15 fps). Only affects the VJ
    mode preview pane, not the output.
  - **Output Stream**: Frame rate (60 / 30 / 24 fps), Max bitrate
    (80 / 40 / 20 / 10 Mbps), Quality vs Smoothness (maintain
    resolution / framerate / balanced), Video codec (Auto / Force
    H.264 / Force VP8). Codec selection routes through
    `RTCRtpTransceiver.setCodecPreferences`. Forcing H.264 on
    machines with hardware H.264 encoders gives a large perf bump.
  - **Video Decoding readout**: live `MediaCapabilities` probe shows
    whether H.264 / HEVC / VP9 / AV1 decode on this machine in
    hardware, software, or not at all. Links to ffmpeg recipes on
    the website.
  - **Help link** to https://ghostarcade.live/docs/performance for a
    full guide on optimizing for your hardware.

- **Integrated-GPU warning banner.** On startup, queries the WebGL
  renderer string. If it matches an integrated / software pattern
  (Intel HD/UHD/Iris, Microsoft Basic Render, llvmpipe), surfaces a
  yellow banner at the top of the editor with three actions:
  *Tune Performance* (opens Settings → Performance), *Dismiss* (this
  session), *Don't show again* (persistent). Most "app is laggy"
  reports trace back to laptops running on the wrong GPU — this gets
  users straight to a fix instead of leaving them blaming the app.

### Fixed

- **Resize guard on the engine.** `Canvas.svelte`'s reactive
  `$project` block was calling `engine.resize` + reallocating every
  shader/SVG render target on every project store update — layer
  adds, name edits, slider tweaks, the lot. Now bails when project
  dimensions are unchanged. Eliminates spurious RT reallocations
  during normal interaction; especially noticeable on weak GPUs.

- **`preserveDrawingBuffer: false`** on the editor canvas. Was `true`
  to support one-shot thumbnail captures, but the cost was paid on
  every paint for the rest of the session. Removed unconditionally;
  any thumbnail capture path that needed it can do an explicit
  one-shot render to a dedicated render target.

### Changed

- **Floating output-window status badge** no longer permanently
  displays the FPS readout when output is configured to run below
  50fps. Pre-fix the badge fired on `fps < 50` as a "degraded link"
  signal, but users with the new Output Stream framerate set to 30
  or 24 fps saw it constantly. Badge now only surfaces on genuine
  fault states: no-link (WebRTC) or CPU fallback (WebGPU zero-copy).
  Press-S stats overlay still works for users who want the numbers.

---

## [1.1.5] — 2026-05-11

### Fixed

- **VJ video clip switching no longer freezes after the first clip.**
  Two bugs were colliding: (1) two cells holding the same source file
  shared one texture-cache entry because the key was `${layer.id}:${src}`
  instead of `${layer.id}:${clip.id}`; (2) `loadTextureAsync` re-resolved
  `videoSrc` via `registerLocalMediaSource` and re-assigned `video.src`
  on every load even when the element from `prepareClipVideo` was
  already loading the same file. On Chromium 130 / Electron 42 the
  re-assignment aborted the in-flight load and any pending `play()`,
  leaving the second-and-onward clip stuck in `loadingTextures` forever.
  Now: cache keys by clip id, and the reused-element fast path skips
  the register/reassign dance entirely.

- **VJ video trim region is now respected.** The per-frame trim-clamp
  loop was reading `source.trimStart/trimEnd/playbackMode/playbackRate/
  isPlaying`, but `vjOutputLayers` never stamped those fields onto the
  `MediaSource` — so the loop always saw `trimEnd ?? 1` and let the
  playhead run past the trim handles. Stamped at source-construction
  time and re-stamped on every cache reuse so live drags propagate
  immediately.

### Added

- **Full VJ video controls panel** — pause/restart, time readout, speed
  selector, trim-aware timeline with playhead and drag handles, and
  Loop / Once mode buttons. Mirrors the mapping-mode `LayerPanel` video
  controls one-to-one. New `VJClip` fields: `playbackMode`,
  `playbackRate`, `trimStart`, `trimEnd`, `isPlaying`. Widened
  `updateActiveClipVideoProps` to accept them.

- **Performer-mode video clip thumbnails.** Drop a video onto a key in
  edit mode and the captured poster frame now shows on the cell, the
  same way shader thumbnails do. Pre-fix the cell tried to use the
  video URL as a CSS `background-image` and silently rendered nothing
  because video can't be a CSS image. New `SVClipAssignment.mediaThumbnail`
  field carries the poster through the drag → drop → label chain.
  Legacy assignments (saved before this field existed) self-heal by
  looking up the library item by `mediaId` on render.

---

## [1.0.9] — 2026-05-06

### Changed

- **SRC tab → Capture** now opens a chooser modal listing every screen
  AND every open application window with a thumbnail preview, instead of
  silently grabbing the primary monitor. Click a tile to start the
  capture. Behaves like the screen-share picker in Zoom / Slack / OBS.

### Why this matters

  Previously the only thing you could capture was your primary display,
  which produced an infinite-mirror feedback loop if Ghost Arcade itself
  was on that screen and offered no way to bring in a specific Chrome
  tab, Resolume preview, game window, AI generator output, etc. The new
  picker gives you the full set of capturable surfaces the OS knows
  about, plus app icons + window titles so you can pick the right one.

### Technical notes

- New main-process IPC `screen_sources_list` enumerates
  `desktopCapturer.getSources({ types: ['screen', 'window'] })` with
  320×180 PNG thumbnails + window app icons.
- Renderer uses `getUserMedia({ video: { mandatory: { chromeMediaSource:
  'desktop', chromeMediaSourceId } } })` to pin the stream to the chosen
  source. Capped at 1080p / 60 fps by default.
- The legacy `setDisplayMediaRequestHandler` now passes
  `useSystemPicker: true` (macOS 15+ only) and includes `'window'` in
  its fallback type list. The audio analyzer's system-audio capture
  still routes through the handler unchanged.
- Custom modal styled to match the existing Shader Library modal —
  same backdrop, same card grid layout.

---

## [1.0.0] — 2026-05-02

First stable release of Ghost Arcade Community. Promotes the
1.0.0-beta.1 codebase to a tagged 1.0.0 release; same feature set,
documentation polish, and the public GitHub repository goes live.

### Highlights

- **AGPL-3.0** open-source edition of Ghost Arcade, with full feature
  parity for the foundation surfaces (mapping, layers, MIDI, mobile
  companion, recording, shader playground).
- **Cross-platform builds** — Windows NSIS installer, macOS .dmg
  (unsigned — Gatekeeper right-click bypass on first launch),
  Linux AppImage. CI builds reproducibly from `git tag v*`.
- **Updated `What's different from Pro`** — reflects the live-performance
  surfaces shipped in Pro v0.5.0 (dual-deck, X-fader blend modes, macros
  effect-bank, snapshots, quantized launching, MIDI clock). Setlist
  feature was removed from both editions (interrupted output during
  song-load).

### Documentation

- README hero feature list reorganized into "Same in both" + "Pro-only"
  to make the upgrade path clearer.
- AppImage filename example updated to drop `-beta.1`.
- All install / build / contributing flows verified against a fresh
  clone.

---

## [1.0.0-beta.1] — 2026-05-01

Initial public release of Ghost Arcade Community — the open-source
edition of Ghost Arcade, forked from the Pro codebase under AGPL-3.0.

### Features

- **Projection mapping** — quad warp + mesh warp, drag-to-position,
  per-corner curves
- **11 layer types** — shader / video / image / 3D model / point cloud /
  Gaussian splat / SVG / lines / text / light painting / Three.js scene
- **50+ effects** — chainable per-layer + per-clip + per-composition
- **Full WebMIDI support** — including MIDI Learn (map any controller
  to any param)
- **Recording** — MP4 / WebM at any resolution
- **Mobile companion** — WebSocket server (port 9001) + HTTP server
  (port 9002) for an iPad / phone touch surface (clip launcher, mixer,
  master fader, effects, shader params)
- **ISF v2 shader playground** — write + edit shaders in-browser
- **Cloud shader sync** — pull from a configurable catalog (none ships
  by default; forks point at their own)
- **Audio reactivity** — system audio / mic, FFT bands feed any param
- **Output window** — second-display fullscreen for the audience-facing
  output, double-click toggles fullscreen

### Pro features intentionally NOT in this edition

The following are commercial features available only in the Pro edition
(<https://ghostarcade.live>):

- Spout (Windows) / Syphon (macOS) texture sharing
- AI Shader Generator (Claude) + AI Video Generator (Luma)
- Director AI agent
- Keyframe animation timeline
- Dual-deck VJ mode + A/B crossfader
- Quantized clip launching (beat-snap)
- 8-knob macros + 16-slot snapshots + setlist support
- VJ slice layers + stage mode
- Plugin system (FluidGen, Particles3D)
- Three.js / p5.js live-coding tabs
- License / tier system
- In-app updater
- Code signing + auto-updates

### Security hardening (vs Pro fork)

- **No telemetry, no phone-home** — `report_error` IPC writes to the
  local debug log only
- **SSRF guards on HTTP proxy** — `http_fetch` / `_binary` / `_put`
  IPC handlers enforce a host allowlist (GitHub + raw.githubusercontent
  by default; extend via `FETCH_HOSTS_ALLOW` env var) and block
  private/loopback/link-local IP literals
- **Strict Content Security Policy** — `script-src 'self'` (no
  WebAssembly surface), narrow `connect-src` allowlist (loopback +
  GitHub only — no external CDNs)
- **`setWindowOpenHandler`** — `window.open()` routes to system browser
  via `shell.openExternal`; child BrowserWindows blocked
- **`will-navigate` blocker** — renderer can't navigate away from app
  origin
- **IPC allowlist** — only commands in `electron/preload.cjs`'s
  `ALLOWED_IPC_COMMANDS` reach the main process

### Removed from upstream

- Hardcoded developer-machine path leak in `MediaTray.svelte` thumbnail
  generator (was leaking `C:/Users/.../001RISKCAPITAL/...`)
- 5 Shadertoy-derived shaders authored under CC BY-NC-SA 3.0 (license
  incompatible with AGPL-3.0). See `ISF/CREDITS.md` for the list.
- Pro EULA text backup (`build-resources/EULA-text-backup.rtf`)
- `electron/native/` Spout C++ + Syphon Objective-C addons
- `src/lib/director/`, `src/lib/keyframes/`, `src/lib/plugins/` source
- License panel + EULA modal + Update modal + license validator
- Several Windows Store / UWP square logos that aren't used by Electron
- **FFmpeg seamless-loop creator** (`src/lib/utils/videoLoop.ts` +
  the `@ffmpeg/*` runtime deps + the unpkg.com CDN allowance in CSP +
  the `'wasm-unsafe-eval'` script-src directive). The loader required
  cross-origin isolation for SharedArrayBuffer in the multi-threaded
  build, which conflicted with audio worklets; the single-threaded
  fallback added a 10MB CDN dependency for a feature most VJs don't
  use. Removed entirely from Community.
- **Timelapse video playback mode** (the `'timelapse'` value in
  `VideoPlaybackMode` + the camera-icon button on video tray items +
  the per-frame stepping timer). Per-frame stepping interacted poorly
  with VJ-mode layer compositing and there was no reliable "exit
  timelapse and resume normal playback" path from the tray UI.
  Community keeps the basic `'loop'` and `'once'` modes; legacy
  projects with `playbackMode: 'timelapse'` deserialize as `'loop'`.

### Renamed

- `00-vangogh.fs` → `00-impasto.fs` (filename implied attribution)
- `00-refikky.fs` → `00-data-flow.fs` (same)
- All `Premium X` effect categories → `Advanced X` (no tier system)
- All logo references → `/logo.png` (was scattered between
  `logo.png`, `logo.png`, etc.)

### Known issues

- Several `npm audit` findings against transitive deps of `vite` 7.3.x
  + `electron-builder` 25.x. All dev-time only; will be cleared by the
  next dep bump.
- Unsigned binaries — Windows SmartScreen + macOS Gatekeeper will warn
  on first launch. See README troubleshooting.
- Some dead UI branches remain visible (e.g. `MediaTray` "Plug" tab
  opens to an empty grid since the plugin registry is empty in OSS).
  Will be cleaned up in 1.0.0 final.
