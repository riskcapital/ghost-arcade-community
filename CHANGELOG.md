# Changelog

All notable changes to Ghost Arcade Community are documented here.

This project follows [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

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
  `illVisualsLogo.png`, `ShrinkWrapLogo.png`, etc.)

### Known issues

- Several `npm audit` findings against transitive deps of `vite` 7.3.x
  + `electron-builder` 25.x. All dev-time only; will be cleared by the
  next dep bump.
- Unsigned binaries — Windows SmartScreen + macOS Gatekeeper will warn
  on first launch. See README troubleshooting.
- Some dead UI branches remain visible (e.g. `MediaTray` "Plug" tab
  opens to an empty grid since the plugin registry is empty in OSS).
  Will be cleaned up in 1.0.0 final.
