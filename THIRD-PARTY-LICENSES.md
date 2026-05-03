# Third-Party Licenses

Ghost Arcade Community is licensed under AGPL-3.0-or-later. It bundles
or links to third-party software whose licenses are listed below.

For a full machine-readable inventory of every transitive dependency
plus its license text, generate one locally with:

```bash
npx license-checker --production --json > third-party-licenses.json
```

## Direct dependencies

### `electron`
- License: MIT
- Homepage: <https://www.electronjs.org/>
- Use: desktop runtime

### `svelte`
- License: MIT
- Homepage: <https://svelte.dev>
- Use: reactive UI framework

### `three`
- License: MIT
- Homepage: <https://threejs.org>
- Use: 3D / WebGL rendering

### `extract-zip`
- License: BSD-2-Clause
- Homepage: <https://github.com/maxogden/extract-zip>
- Use: demo project unzip

### `qrcode`
- License: MIT
- Homepage: <https://github.com/soldair/node-qrcode>
- Use: mobile companion pairing QR

### `ws`
- License: MIT
- Homepage: <https://github.com/websockets/ws>
- Use: WebSocket server for the mobile companion

## Build-time dev dependencies

`vite`, `typescript`, `@sveltejs/vite-plugin-svelte`, `electron-builder`,
`svelte-check`, `eslint`, `prettier`, `vitest`, and their transitive
dependencies. All MIT-licensed (see `node_modules/<pkg>/LICENSE` after
`npm install`).

## Bundled assets

- **ISF shaders** in `ISF/` — see [`ISF/CREDITS.md`](./ISF/CREDITS.md)
- **Geometric shader pack** in `geometric-shader-pack/` — original to
  this project, AGPL-3.0
- **Icons** in `build-resources/icons/` — original wordmark
- **Demo project** (downloaded on first launch from public GitHub
  Releases) — see the demo bundle's own LICENSE inside the zip

## Specifications

- **ISF v2** (Interactive Shader Format) — by VIDVOX / Anton Marini.
  Used as the shader interchange format. <https://isf.video>
- **WebMIDI**, **WebGL**, **Web Audio API** — W3C standards
