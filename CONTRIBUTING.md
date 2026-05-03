# Contributing to Ghost Arcade Community

First — thanks for taking the time to contribute. Ghost Arcade Community is
AGPL-3.0 and welcomes pull requests, bug reports, and shader contributions.

## Getting started

```bash
git clone https://github.com/riskcapital/ghost-arcade-community.git
cd ghost-arcade-community
npm install
npm run desktop
```

Requirements:

- **Node 20+** — matches the CI Node version
- **macOS / Windows / Linux** — all three are first-class platforms
- (Optional) For Windows builds: NSIS, Visual Studio Build Tools

## Development workflow

```bash
npm run dev          # Vite dev server only (browser preview at http://localhost:1420)
npm run desktop      # Vite + Electron concurrently
npm run check        # svelte-check (TypeScript + Svelte type validation)
npm run lint         # ESLint
npm run format       # Prettier
npm run test         # Vitest unit tests
npm run build        # Production Vite build
```

To build a packaged installer:

```bash
npm run build:desktop          # Windows NSIS (unsigned)
npm run build:desktop:mac      # macOS DMG (universal, unsigned)
npm run build:desktop:linux    # Linux AppImage
```

Output lands in `dist-electron/`.

## Pull request checklist

Before opening a PR:

- [ ] `npm run check` reports 0 errors
- [ ] `npm run build` succeeds
- [ ] No new dependencies without discussion in an issue first
- [ ] No new outbound network calls without discussion (this app is privacy-respecting)
- [ ] No new IPC handlers without security review (see [`SECURITY.md`](./SECURITY.md))
- [ ] If adding a new shader, include a `CREDIT` block per
      [`ISF/CREDITS.md`](./ISF/CREDITS.md)
- [ ] Title format: `area: short description` (e.g. `vj: fix beat-pulse drift`)

## What we're looking for

**High-priority contributions:**

- Bug fixes (especially cross-platform issues)
- macOS + Linux compatibility improvements
- Performance optimizations (startup time, render frame budget)
- New ISF shaders (with proper attribution)
- Documentation (README polish, screenshots, video tutorials)
- Translations / i18n scaffolding (none today)
- Test coverage

**Out of scope** (these are Pro-only features by design):

- Spout / Syphon texture sharing
- AI shader / video generation
- Director AI agent
- Keyframe animation timeline
- Dual-deck VJ + A/B crossfader
- Macros / snapshots / setlists
- Plugin system (FluidGen, Particles3D)
- License / tier system

If you want any of those, the Pro edition is at <https://ghostarcade.live>.
We won't accept PRs that re-add Pro features to the Community Edition —
the codebases are intentionally separate.

## Architecture orientation

- `src/App.svelte` — main editor UI shell
- `src/lib/components/` — Svelte components
- `src/lib/stores/` — Svelte stores (state management)
- `src/lib/renderer/` — WebGL render engine
- `src/lib/effects/` — effect catalog + shader sources
- `electron/main.js` — Electron main process (window creation, IPC, server lifecycle)
- `electron/preload.cjs` — IPC bridge exposed to the renderer
- `server/ws-server.js` — Node WebSocket server for the mobile companion

The Pro version's removed features are stubbed in:

- `src/lib/stores/license.ts` (every gate returns "unlocked")
- `src/lib/license/featureGates.ts` (every effect tier = "core")
- `src/lib/stores/keyframeTimeline.ts` (no-op)
- `src/lib/api/ai-client.ts` (validators always return false)
- `src/lib/plugins/registry.ts` (empty plugin list)
- etc.

These stubs preserve the import surface so the rest of the codebase
stays in lockstep with the Pro app — bug fixes port both ways without
surgery. **Don't remove the stubs without checking every import site.**

## License

By submitting a PR you agree to license your contribution under
**AGPL-3.0-or-later**. Don't submit code copied from the Pro edition
unless it's your own original work.

Contributions must also respect the project's brand and commercial-use
boundaries. Do not add unofficial logos, confusing fork branding, app store
metadata, or resale language that conflicts with [`TRADEMARKS.md`](./TRADEMARKS.md)
or [`COMMERCIAL_USE.md`](./COMMERCIAL_USE.md).

## Code style

- **Svelte 5** with `export let` props (NOT `$props()` runes — staying
  on the older API for parity with the Pro repo)
- **TypeScript strict mode** — no `any` unless commented as intentional
- **Comments explain *why*, not *what*** — the code shows what; comments
  capture rationale, gotchas, and references to related code
- **2-space indent**, single quotes, trailing commas

Formatter is Prettier; linter is ESLint. `npm run format` + `npm run lint`
before pushing.

## Reporting bugs

Use the issue templates under <https://github.com/riskcapital/ghost-arcade-community/issues/new/choose>.
For security issues see [`SECURITY.md`](./SECURITY.md) — please don't
file public issues for security holes.

## Communication

- GitHub Issues for bugs + feature discussions
- GitHub Discussions for general questions
- (No Discord / Slack yet — opening if community demand warrants it)
