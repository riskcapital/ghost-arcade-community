# Security Policy

Ghost Arcade Community takes security seriously. Thank you for helping
keep the project + its users safe.

## Reporting a vulnerability

**Do not file a public GitHub issue for a security vulnerability.**

Instead, use GitHub's private vulnerability reporting:
<https://github.com/riskcapital/ghost-arcade-community/security/advisories/new>

Include:
- A description of the vulnerability
- Reproduction steps
- Affected versions
- Your assessment of impact + suggested mitigation

We aim to acknowledge reports within **5 business days** and ship a fix
within **30 days** for critical vulnerabilities. We'll credit you in the
release notes unless you prefer to remain anonymous.

## Supported versions

Ghost Arcade Community is pre-1.0; only the latest tagged release is
actively patched. Older releases will not receive backports.

## Security architecture

The Electron renderer is locked down with:

- `contextIsolation: true` - renderer cannot directly access Node APIs
- `nodeIntegration: false` - no `require()` in renderer scripts
- **IPC allowlist** - only commands in `electron/preload.cjs`
  `ALLOWED_IPC_COMMANDS` reach the main process
- **Content Security Policy** - production blocks runtime eval, limits
  connections to local companion services plus documented download hosts,
  and injects `object-src 'none'` / `frame-ancestors 'none'`. Inline scripts
  remain allowed for local animation surfaces; imported JS animation HTML is
  rendered in a sandboxed frame. See `electron/main.js` `setupPermissions()`
  for the full policy.
- **`setWindowOpenHandler`** - `window.open()` from the renderer routes
  to the system browser via `shell.openExternal`; no child BrowserWindow
  is created (would otherwise inherit the IPC bridge)
- **`will-navigate` blocker** - renderer cannot navigate away from the
  app's own origin, defeating injection-driven page replacement

The HTTP proxy (`http_fetch` / `http_fetch_binary` / `http_put_binary` IPC
handlers in `electron/main.js`) enforces:

- HTTPS only (HTTP allowed only for `localhost`/`127.0.0.1`)
- Host allowlist - defaults to `github.com`, `*.githubusercontent.com`;
  forks override via the `FETCH_HOSTS_ALLOW` env var
- Private/loopback/link-local IP literals rejected to prevent SSRF (e.g.
  `169.254.169.254` AWS metadata, `192.168.x.x` intranet probing)

The WebSocket server (`server/ws-server.js`, port 9001) and HTTP server
(port 9002) bind to **all network interfaces** to support the mobile
companion. Desktop builds generate a fresh per-launch pairing token, include
it in the mobile QR URL, and reject WebSocket clients that do not present it.
The HTTP server still serves the mobile UI on the LAN, so only run this app
on networks you trust.

## Known limitations

- **Unsigned binaries on first launch** - Windows SmartScreen + macOS
  Gatekeeper will warn. See README troubleshooting section.
- **Demo project zip downloaded on first launch** - fetched from this
  project's public GitHub Releases. Forks should override the URL via
  the `download_demo_zip` IPC `url` argument.

## Threat model

Ghost Arcade Community is intended for use:

- **On the local machine** by the operator
- **On a trusted LAN** for mobile companion access (one operator + their
  iPad / phone, both connected to the same Wi-Fi)

It is **NOT designed for**:

- Running on a public internet host
- Multi-user authentication / authorization
- Use as a server-side service receiving arbitrary uploads

If your fork wants to deploy this in a multi-tenant SaaS context, you
will need to add authentication, rate limiting, sandboxing, and audit
logging. The AGPL-3.0 license also requires you to publish your
modifications.
