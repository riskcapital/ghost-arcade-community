# Ghost Arcade Community

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Build](https://github.com/riskcapital/ghost-arcade-community/actions/workflows/build.yml/badge.svg)](https://github.com/riskcapital/ghost-arcade-community/actions/workflows/build.yml)
[![GitHub release](https://img.shields.io/github/v/release/riskcapital/ghost-arcade-community?include_prereleases&sort=semver)](https://github.com/riskcapital/ghost-arcade-community/releases)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> Open-source projection mapping, VJ, and shader playground for live performance.
> Built on Svelte 5, Three.js, and Electron. Runs on macOS, Windows, and Linux.

<!--
TODO: insert hero screenshot or animated GIF here.
Recommended: 1280×720 PNG showing the editor UI mid-session.
Save to `docs/media/hero.png` and reference as:
  ![Ghost Arcade Community editor](./docs/media/hero.png)
-->

> **TL;DR**: Ghost Arcade Community is the free, open-source edition of
> Ghost Arcade. It's fully featured for live performance — projection mapping,
> shader rendering, video/image layers, MIDI control, mobile companion, output
> recording. The commercial Pro edition adds Spout/Syphon texture sharing,
> AI shader generation, dual-deck VJ with crossfader, snapshots, macros,
> setlists, keyframe animation, and the plugin ecosystem.
> See [What's different from Pro](#whats-different-from-pro) below.

---

## Features

- **Projection mapping** — quad warp + mesh warp, multi-output slicing,
  drag-to-position, per-corner curves
- **Layers** — shader / video / image / 3D model / point cloud / Gaussian splat
  / SVG / lines / text / light painting / Three.js scene
- **Effects** — 50+ built-in effects (blur, glitch, displacement, color grading,
  chromatic aberration, kaleidoscope, etc.) chainable per-layer or per-clip
- **MIDI control** — full WebMIDI support with MIDI Learn — map any param to
  any controller in seconds
- **Mobile companion** — open `http://<your-lan-ip>:9002` on an iPad or phone
  for a touch-controllable VJ surface (clip launcher, mixer, master fader,
  effects, shader params)
- **Recording** — capture the output to MP4 / WebM at any resolution
- **Cloud shader sync** — pull community shaders from a configurable index;
  edit + save your own
- **Live ISF shader playground** — write shaders in the browser with the
  full ISF v2 spec
- **Audio reactivity** — system audio or microphone, FFT bands feed any param

## Quick start

### Run from source

```bash
git clone https://github.com/riskcapital/ghost-arcade-community.git
cd ghost-arcade-community
npm install
npm run desktop          # Electron + Vite dev server in one
```

The first launch downloads a small demo project from the public releases
asset bundle so you have something to play with immediately.

### Build a desktop installer

```bash
npm run build:desktop          # Windows NSIS installer
npm run build:desktop:mac      # macOS DMG (universal)
npm run build:desktop:linux    # Linux AppImage
```

Output lands in `dist-electron/`.

### Mobile companion

The desktop app starts a WebSocket server on port 9001 and an HTTP server
on port 9002. Open the HTTP URL on a device on the same Wi-Fi:

```
http://<your-mac-or-pc-lan-ip>:9002
```

The desktop QR code includes a per-launch pairing token. Open the URL from
the desktop app or scan the QR code so the mobile UI can authenticate to the
WebSocket controller and show the clip launcher + mixer.

> **Network note**: the WS + HTTP servers bind to all interfaces (0.0.0.0)
> so the mobile companion can reach them. The control WebSocket requires the
> QR/session token in desktop builds, but you should still only run this app
> on networks you trust. See [`SECURITY.md`](./SECURITY.md) for the threat model.

## First launch troubleshooting

Ghost Arcade Community ships **unsigned binaries**. The first time you
launch a downloaded build, your OS will warn that the publisher is
unverified. This is expected — the project doesn't have a code-signing
budget yet, and the binaries are reproducible from public source.

### macOS

> *"Ghost Arcade Community can't be opened because Apple cannot check
>   it for malicious software."*

**Fix**: in Finder, right-click the app → **Open** → confirm.
You only need to do this once per install.

If the app silently exits on first launch, check Console.app for a
Gatekeeper rejection log. The unsigned-binary path is documented in
`SECURITY.md`.

### Windows

> *"Windows protected your PC — Microsoft Defender SmartScreen prevented
>    an unrecognized app from starting."*

**Fix**: click **More info** → **Run anyway**.
SmartScreen reputation is per-file; new builds will trigger this until
enough downloads accumulate.

### Linux (AppImage)

```bash
chmod +x ghost-arcade-community-1.0.0.AppImage
./ghost-arcade-community-1.0.0.AppImage
```

If you get a sandbox error on Ubuntu 24.04+:

```bash
./ghost-arcade-community-*.AppImage --no-sandbox
```

(This is an Electron 33 + glibc-confinement issue, not specific to
this project.)

## What's different from Pro

The commercial Pro edition is a separately maintained codebase. Same
foundation (projection mapping, layers, shader library, MIDI, mobile
companion), Pro adds the live-performance + AI surfaces:

### Same in both editions

| Feature | Community | Pro |
| --- | --- | --- |
| Projection mapping (quad warp + mesh warp) | ✅ | ✅ |
| 11 layer types (shader, video, image, 3D, splat, lines, SVG, text, light, Three.js scene, point cloud) | ✅ | ✅ |
| 50+ built-in effects (chainable per-layer / per-clip) | ✅ | ✅ |
| MIDI control + MIDI Learn | ✅ | ✅ |
| Mobile companion (touch surface at port 9002) | ✅ | ✅ |
| Recording (MP4 / WebM at any resolution) | ✅ | ✅ |
| Cloud Shader Library (community + AI-generated, ISF v2) | ✅ | ✅ |
| Live ISF shader playground | ✅ | ✅ |
| Audio reactivity (FFT bands + onsets) | ✅ | ✅ |
| Single-deck VJ clip launcher | ✅ | ✅ |

### Pro-only

| Feature | Community | Pro |
| --- | --- | --- |
| **Dual-deck VJ** (Bank A / Bank B with full per-bank state) | ❌ | ✅ |
| **A/B Crossfader** (10 transitions × 9 output blend modes that combine) | ❌ | ✅ |
| **Macro effect-bank** (8 wet/dry knobs, expandable per-effect param editor, auto-pulse on beat grid) | ❌ | ✅ |
| **Snapshot bank** (16-slot scene capture + recall, MIDI-mapped) | ❌ | ✅ |
| **Quantized clip launching** (1/4 / 1/2 / 1bar / 2bar / 4bar beat-snap) | ❌ | ✅ |
| **MIDI clock receive + send** (24 PPQN, sync to/from Ableton + drum machines) | ❌ | ✅ |
| **Spout (Win) / Syphon (Mac) texture sharing** | ❌ | ✅ |
| **AI shader generator** (Claude API) | ❌ | ✅ |
| **AI video generator** (Luma API) | ❌ | ✅ |
| **Director AI agent** | ❌ | ✅ |
| **Keyframe animation timeline** | ❌ | ✅ |
| **Stage mode + slice layers** | ❌ | ✅ |
| **Plugin tab** (FluidGen, Particles3D) | ❌ | ✅ |
| **Three.js / p5.js live coding tabs** | ❌ | ✅ |
| **Onboarding tour + in-app updater** | ❌ | ✅ |
| **Code signing + auto-updates** | ❌ | ✅ |
| **Priority support + commercial license** | ❌ | ✅ |

If you need any of the Pro features, the commercial edition is at
<https://ghostarcade.live>.

## License

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE) for the full text.

The AGPL applies to the entire repository — including any modifications,
forks, and SaaS deployments. If you run a modified version on a server that
users interact with over a network (e.g. a hosted web build), you must make
the modified source code available to those users.

Commercial creative use is allowed: paid shows, client visuals, installations,
recordings, streams, tutorials, and content made with the app do not become
owned by this project just because you used Ghost Arcade Community. See
[`COMMERCIAL_USE.md`](./COMMERCIAL_USE.md).

The AGPL does not grant trademark rights. Official names, logos, app icons,
release channels, and brand identity are controlled by Risk Capital Media LLC.
Forks and unofficial builds must use their own name and branding. See
[`TRADEMARKS.md`](./TRADEMARKS.md).

For commercial use that doesn't fit the AGPL terms (e.g. closed-source
modifications), the Pro edition is available under a separate commercial
license at <https://ghostarcade.live>.

## Contributing

Issues and pull requests welcome at
<https://github.com/riskcapital/ghost-arcade-community>.

By contributing, you agree to license your contributions under the AGPL-3.0.
Please don't submit code copied from the Pro edition unless it is your own
original work.

## Tech stack

- [Svelte 5.46](https://svelte.dev/) (with `export let` props, no runes yet)
- [Three.js 0.182](https://threejs.org/) for 3D rendering
- [Electron 33.4](https://www.electronjs.org/) for the desktop shell
- [Vite 7](https://vitejs.dev/) for the dev server + build
- TypeScript 5.9, vanilla `ws` for the WebSocket server

## Acknowledgments

Built by Justin Wood and contributors. Forked from the Pro codebase to
ship under AGPL-3.0 in early 2026.
