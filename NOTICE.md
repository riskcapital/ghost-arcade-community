# NOTICE

Ghost Arcade Community
Copyright (c) 2024-2026 Risk Capital Media LLC and Ghost Arcade contributors

This product is licensed under the GNU Affero General Public License v3.0
or later. See [`LICENSE`](./LICENSE) for the full text.

`Ghost Arcade`, `Ghost Arcade Community`, `Ghost Arcade Pro`, the app icon,
logos, release artwork, and official release channels are trademarks or
branding controlled by Risk Capital Media LLC. The AGPL license does not
grant trademark rights. See [`TRADEMARKS.md`](./TRADEMARKS.md).

This NOTICE file enumerates third-party software, assets, and conventions
incorporated by this project, in compliance with the AGPL-3.0 attribution
requirement and as a courtesy to upstream authors.

---

## Bundled software (npm dependencies)

Their full license texts are available in `node_modules/<pkg>/LICENSE`
after `npm install`, or via the npm registry. A consolidated
`THIRD-PARTY-LICENSES.md` lives next to this file.

| Package | License | Use |
| --- | --- | --- |
| [electron](https://github.com/electron/electron) | MIT | Desktop runtime |
| [svelte](https://svelte.dev) | MIT | Reactive UI framework |
| [three](https://threejs.org) | MIT | 3D / WebGL rendering |
| [vite](https://vitejs.dev) | MIT | Dev server + bundler |
| [extract-zip](https://github.com/maxogden/extract-zip) | BSD-2-Clause | Demo project unzip |
| [qrcode](https://github.com/soldair/node-qrcode) | MIT | Mobile companion pairing QR |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket server |

## Bundled shaders

See [`ISF/CREDITS.md`](./ISF/CREDITS.md) for per-shader attribution.

## Specifications + standards

- **ISF v2** (Interactive Shader Format) by [VIDVOX](https://www.vidvox.net/) /
  Anton Marini. Used as the shader interchange format for runtime params
  + audio reactivity.
- **WebMIDI**, **WebGL**, **Web Audio API** — W3C standards.

## Forked from

Ghost Arcade Community is the open-source edition of Ghost Arcade.
The Pro edition is closed-source and adds Spout/Syphon texture sharing,
AI shader/video generation, dual-deck VJ, snapshots, macros, setlists,
and the plugin system. See <https://ghostarcade.live>.

## Removed material

Several shaders authored under CC BY-NC-SA 3.0 / NonCommercial terms
were present in the upstream Pro codebase but have been REMOVED from
this distribution because the NonCommercial clause is incompatible with
AGPL-3.0. GLSL Sandbox conversions without explicit AGPL-compatible
permission were also removed. See `ISF/CREDITS.md` for the list.
