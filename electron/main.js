/**
 * Ghost Arcade Community - Electron Main Process
 *
 * AGPL-3.0 fork of Ghost Arcade. The Pro version of this file includes
 * Spout/Syphon texture sharing, AI shader/video generation, the Director
 * AI agent, an in-app updater, and license validation. This Community
 * Edition strips all of those; what's left is a clean Electron host:
 *
 *   - Main window + optional second-display Output window
 *   - In-process Node.js WebSocket server (port 9001) for the mobile companion
 *   - IPC for file IO, demo project download, http proxy (cloud shaders),
 *     screen enumeration, error log forwarding
 *   - Permission whitelist (media, MIDI, fullscreen, display capture)
 *
 * No licensing. No telemetry. No external phone-home.
 */

import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// GPU / DPI / autoplay tuning. Same flags the Pro version uses; nothing
// here is feature-gated, just performance + Chromium-quirk workarounds.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-hardware-overlays');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-pinch');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Debug log to file (stdout doesn't always flush from background Electron).
// In production the main.js lives inside the read-only asar bundle, so log
// to %LOCALAPPDATA% / ~/Library/Logs instead of next to main.js.
const _isAsar = __dirname.includes('app.asar');
const _logDir = _isAsar
  ? (process.platform === 'darwin'
      ? path.join(process.env.HOME || '/tmp', 'Library', 'Logs')
      : (process.env.LOCALAPPDATA || process.env.TEMP || '.'))
  : path.join(__dirname, '..');
const _logFile = path.join(_logDir, _isAsar ? 'ghost-arcade-community-debug.log' : 'electron-debug.log');
fs.writeFileSync(_logFile, `=== Electron started ${new Date().toISOString()} ===\n`);
const _origLog = console.log.bind(console);
console.log = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  try { fs.appendFileSync(_logFile, `${msg}\n`); } catch { /* disk full / readonly */ }
  try { _origLog(...args); } catch { /* EPIPE on closed stdout */ }
};
const _origErr = console.error.bind(console);
console.error = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  try { fs.appendFileSync(_logFile, `[ERR] ${msg}\n`); } catch { /* */ }
  try { _origErr(...args); } catch { /* */ }
};

// Don't let EPIPE on stdout/stderr or unhandled async crashes nuke the app.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});
process.on('uncaughtException', (err) => {
  console.error('[Main] uncaughtException:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main] unhandledRejection:', reason);
});

// Surface GPU + utility crashes to our log so we can debug device-lost / TDR.
app.on('gpu-process-crashed', (_ev, killed) => {
  console.error(`[Main] GPU process crashed (killed=${killed}).`);
});
app.on('child-process-gone', (_ev, details) => {
  if (!details) return;
  console.error(`[Main] child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name || ''}`);
});

// ============================================================
// State
// ============================================================

let mainWindow = null;
let outputWindow = null;
let sidecarProcess = null;
const COMPANION_WS_PORT = '9001';
const COMPANION_HTTP_PORT = '9002';
const COMPANION_SESSION_TOKEN = process.env.COMPANION_SESSION_TOKEN || crypto.randomBytes(16).toString('hex');

// Companion server status — read by the renderer over IPC so the mobile
// pairing UI can show a useful error when ports are busy. Without this
// the user just sees a vague "WebSocket retrying..." spinner forever
// and has no way to know the server never started.
//   'unstarted' — startNodeServer() hasn't run yet (initial state)
//   'starting'  — currently probing/starting
//   'running'   — both ports bound, server up
//   'port-in-use' — one or both companion ports owned by another process
//   'failed'    — server crashed during startup
let companionStatus = {
  state: 'unstarted',
  wsPort: COMPANION_WS_PORT,
  httpPort: COMPANION_HTTP_PORT,
  wsAvailable: null,
  httpAvailable: null,
  message: '',
};
function setCompanionStatus(patch) {
  companionStatus = { ...companionStatus, ...patch };
  // Push to renderer so the pairing popup updates without polling.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('companion-status', companionStatus);
  }
}

// ============================================================
// In-process WebSocket server for the mobile companion
// ============================================================
//
// The server is a vanilla Node module that exposes both the WS port (9001)
// for realtime messages and an HTTP port (9002) for serving the mobile UI.
// We try to import it in-process first (fastest, single Node VM); fall back
// to an ELECTRON_RUN_AS_NODE child process if that fails for any reason.

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        probe.close(() => resolve(true));
      });
    probe.listen(Number(port), '0.0.0.0');
  });
}

async function startNodeServer({ takeOver = false } = {}) {
  const serverPath = path.join(__dirname, '..', 'server', 'ws-server.js');
  if (!fs.existsSync(serverPath)) {
    console.warn('[Main] Node.js server not found at:', serverPath);
    setCompanionStatus({ state: 'failed', message: 'Companion server module missing from install.' });
    return;
  }

  setCompanionStatus({ state: 'starting', message: '' });

  // Probe both companion ports. We refuse to silently kill arbitrary
  // processes on the user's machine — that was the previous behavior and
  // a real footgun if some other dev tool happens to use 9001/9002. But
  // we DO offer an explicit "take over" path the user can opt into via
  // IPC (companion_force_start), which falls through to this branch with
  // takeOver=true and frees the ports first.
  let [wsAvailable, httpAvailable] = await Promise.all([
    isPortAvailable(COMPANION_WS_PORT),
    isPortAvailable(COMPANION_HTTP_PORT),
  ]);

  if ((!wsAvailable || !httpAvailable) && takeOver) {
    console.warn('[Main] User opted in to take over companion ports; killing competing listeners.');
    freeCompanionPorts();
    await new Promise(r => setTimeout(r, 500));
    [wsAvailable, httpAvailable] = await Promise.all([
      isPortAvailable(COMPANION_WS_PORT),
      isPortAvailable(COMPANION_HTTP_PORT),
    ]);
  }

  if (!wsAvailable || !httpAvailable) {
    const which = [
      !wsAvailable ? `WebSocket port ${COMPANION_WS_PORT}` : null,
      !httpAvailable ? `HTTP port ${COMPANION_HTTP_PORT}` : null,
    ].filter(Boolean).join(' and ');
    const msg = `Mobile companion server can't start because ${which} is already in use by another app on your computer.`;
    console.warn(`[Main] ${msg}`);
    setCompanionStatus({
      state: 'port-in-use',
      wsAvailable, httpAvailable,
      message: msg,
    });
    return;
  }

  process.env.WS_PORT = COMPANION_WS_PORT;
  process.env.HTTP_PORT = COMPANION_HTTP_PORT;
  process.env.COMPANION_SESSION_TOKEN = COMPANION_SESSION_TOKEN;

  try {
    const serverUrl = new URL(`file:///${serverPath.replace(/\\/g, '/')}`).href;
    console.log('[Main] Importing server from:', serverUrl);
    await import(serverUrl);
    console.log('[Main] Server module loaded in-process');
    setCompanionStatus({ state: 'running', wsAvailable: true, httpAvailable: true, message: '' });
  } catch (e) {
    console.error('[Main] Failed to load server in-process:', e.message);
    // Fallback: spawn with ELECTRON_RUN_AS_NODE so the same binary acts as Node.
    try {
      sidecarProcess = spawn(process.execPath, [serverPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          WS_PORT: COMPANION_WS_PORT,
          HTTP_PORT: COMPANION_HTTP_PORT,
          COMPANION_SESSION_TOKEN,
          ELECTRON_RUN_AS_NODE: '1',
        },
        windowsHide: true,
        shell: false,
      });
      sidecarProcess.stdout?.on('data', (d) => console.log(`[Server] ${d.toString().trim()}`));
      sidecarProcess.stderr?.on('data', (d) => console.error(`[Server] ${d.toString().trim()}`));
      sidecarProcess.on('exit', (code) => {
        console.log(`[Main] Server exited ${code}`);
        sidecarProcess = null;
        setCompanionStatus({ state: 'failed', message: `Companion server exited (code ${code}).` });
      });
      sidecarProcess.on('error', (err) => {
        console.error(`[Main] Server spawn error: ${err.message}`);
        setCompanionStatus({ state: 'failed', message: `Companion server failed to start: ${err.message}` });
      });
      setCompanionStatus({ state: 'running', wsAvailable: true, httpAvailable: true, message: '' });
    } catch (e2) {
      console.error('[Main] Server spawn fallback also failed:', e2.message);
      setCompanionStatus({ state: 'failed', message: `Companion server failed to start: ${e2.message}` });
    }
  }
}

// Kill whatever is currently bound to 9001/9002. Only invoked when the
// user explicitly opts in via the renderer ("Take over port" button) —
// we never do this automatically because some dev tools legitimately use
// these ports and silently killing them would be a nasty surprise.
function freeCompanionPorts() {
  try {
    if (process.platform === 'win32') {
      for (const port of [COMPANION_WS_PORT, COMPANION_HTTP_PORT]) {
        try {
          execSync(
            `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`,
            { shell: 'cmd.exe', stdio: 'ignore', timeout: 5000 }
          );
        } catch { /* nothing on this port — fine */ }
      }
    } else {
      try {
        execSync(`lsof -ti:${COMPANION_WS_PORT},${COMPANION_HTTP_PORT} | xargs kill -9 2>/dev/null || true`, {
          stdio: 'ignore', timeout: 5000,
        });
      } catch { /* */ }
    }
  } catch (e) {
    console.warn('[Main] freeCompanionPorts failed:', e.message);
  }
}

function stopServer() {
  if (sidecarProcess) {
    try { sidecarProcess.kill(); } catch { /* */ }
    sidecarProcess = null;
  }
}

// ============================================================
// IPC handlers
// ============================================================

function registerIpcHandlers() {
  ipcMain.handle('ping', () => ({ ok: true, app: 'ghost-arcade-community', version: app.getVersion() }));
  ipcMain.handle('get_companion_token', () => COMPANION_SESSION_TOKEN);

  // Companion server status — renderer queries on demand to render the
  // mobile pairing UI ("server up / port-in-use / failed"). Pushed
  // automatically via 'companion-status' channel whenever it changes.
  ipcMain.handle('companion_status', () => companionStatus);

  // User opt-in to free the companion ports and retry. Called from the
  // mobile pairing popup's "Take over port" button. Won't run unless
  // the user clicked through the explanation in the UI.
  ipcMain.handle('companion_force_start', async () => {
    await startNodeServer({ takeOver: true });
    return companionStatus;
  });

  // Output window control
  ipcMain.handle('get_displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id, label: d.label, bounds: d.bounds, scaleFactor: d.scaleFactor,
      primary: d.id === screen.getPrimaryDisplay().id,
    }));
  });
  ipcMain.handle('create_output_window', (_, args) => createOutputWindow(args));
  ipcMain.handle('close_output_window', () => {
    if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();
    outputWindow = null;
    return { ok: true };
  });
  ipcMain.handle('output_fullscreen_external', () => {
    if (!outputWindow || outputWindow.isDestroyed()) return { ok: false };
    outputWindow.setFullScreen(true);
    return { ok: true };
  });
  ipcMain.handle('output_toggle_fullscreen', () => {
    if (!outputWindow || outputWindow.isDestroyed()) return { ok: false, fullscreen: false };
    const next = !outputWindow.isFullScreen();
    outputWindow.setFullScreen(next);
    return { ok: true, fullscreen: next };
  });
  ipcMain.handle('output_set_cursor', (_e, show) => {
    if (!outputWindow || outputWindow.isDestroyed()) return { ok: false };
    // Render an empty cursor when hidden; default arrow when shown.
    // (Electron has no first-class hideCursor API; CSS `cursor:none` on
    // the canvas is the actual mechanism; this just signals intent.)
    outputWindow.webContents.send('output-cursor', !!show);
    return { ok: true };
  });
  ipcMain.handle('show_main_window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    return { ok: true };
  });

  // File IO (open/save dialogs + project read)
  // All paths are validated for absolute + no `..` traversal. Project
  // reads are restricted to .gha / .json / .shrnk extensions.
  ipcMain.handle('save_project_dialog', async (_, args) => {
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: args?.defaultName || 'project.gha',
      filters: [
        { name: 'Ghost Arcade Project', extensions: ['gha'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('save_file_text', async (_, args) => {
    try {
      if (!args?.path || typeof args.path !== 'string') return { success: false, error: 'Invalid path' };
      const normalized = path.normalize(args.path);
      if (!path.isAbsolute(normalized) || normalized.includes('..')) {
        return { success: false, error: 'Invalid path (must be absolute, no traversal)' };
      }
      fs.mkdirSync(path.dirname(normalized), { recursive: true });
      fs.writeFileSync(normalized, args.content ?? '', 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('save_file_binary', async (_, args) => {
    try {
      if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
      const { path: filePath, base64Data } = args;
      if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'Invalid file path' };
      if (typeof base64Data !== 'string') return { success: false, error: 'Invalid base64 data' };
      const normalized = path.normalize(filePath);
      if (!path.isAbsolute(normalized) || normalized.includes('..')) {
        return { success: false, error: 'Invalid file path (must be absolute, no traversal)' };
      }
      const buf = Buffer.from(base64Data, 'base64');
      if (buf.length === 0 && base64Data.length > 0) {
        return { success: false, error: 'base64 decode produced empty buffer' };
      }
      fs.mkdirSync(path.dirname(normalized), { recursive: true });
      fs.writeFileSync(normalized, buf);
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('read_project_file', async (_, { path: filePath }) => {
    if (typeof filePath !== 'string' || !filePath) throw new Error('Invalid file path');
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.gha' && ext !== '.json' && ext !== '.shrnk') {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    if (!fs.existsSync(filePath)) throw new Error('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, dir: path.dirname(filePath) };
  });

  ipcMain.handle('pick_directory', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Save Location',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
  });

  // Shader source persistence (saves cloud shaders to userData)
  ipcMain.handle('save_shader_source', (_, args) => {
    try {
      const { id, source } = args || {};
      if (typeof id !== 'string' || !id || typeof source !== 'string') {
        return { success: false, error: 'Invalid args' };
      }
      // Sanitize id to alphanum + dash/underscore (it's used as filename).
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeId) return { success: false, error: 'Invalid shader id' };
      const dir = path.join(app.getPath('userData'), 'shaders');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${safeId}.fs`), source, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('list_shader_sources', () => {
    try {
      const dir = path.join(app.getPath('userData'), 'shaders');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.fs'))
        .map(f => ({ id: f.replace(/\.fs$/, ''), source: fs.readFileSync(path.join(dir, f), 'utf-8') }));
    } catch (err) {
      console.error('[Main] list_shader_sources error:', err?.message || err);
      return [];
    }
  });

  ipcMain.handle('delete_shader_source', (_, args) => {
    try {
      const { id } = args || {};
      const safeId = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeId) return { success: false, error: 'Invalid shader id' };
      const filePath = path.join(app.getPath('userData'), 'shaders', `${safeId}.fs`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('save_shader_thumbnail', (_, args) => {
    try {
      const { id, dataUrl } = args || {};
      if (typeof id !== 'string' || !id || typeof dataUrl !== 'string') {
        return { success: false, error: 'Invalid args' };
      }
      const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
      const m = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!m) return { success: false, error: 'Invalid data URL' };
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      const dir = path.join(app.getPath('userData'), 'thumbnails');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${safeId}.${ext}`), buf);
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // Generic HTTP proxy with SSRF guards
  // Renderer can't make cross-origin requests for arbitrary URLs without
  // relaxing CSP; this proxy keeps the renderer locked-down. The Pro
  // version had no host allowlist; a hostile cloud shader could exfiltrate
  // data via http_put_binary, hit AWS metadata at 169.254.169.254, or
  // probe localhost services. OSS hardens with:
  //   1. https:// only (no file:, no http: except localhost dev)
  //   2. Host allowlist (configurable; defaults to GitHub + raw.githubusercontent)
  //   3. Block private/loopback/link-local IP literals so a hostile
  //      DNS-rebound name can't sneak past the host allowlist
  //   4. Deliberately omit the streaming variant (was AI-only, removed)
  //
  // Hosts forks should add: their own shader catalog domain. See README
  // for the FETCH_HOSTS_ALLOW env override.
  const DEFAULT_FETCH_ALLOW = new Set([
    'github.com', 'api.github.com', 'objects.githubusercontent.com',
    'raw.githubusercontent.com', 'codeload.github.com',
  ]);
  const _envAllow = (process.env.FETCH_HOSTS_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  const FETCH_ALLOW = new Set([...DEFAULT_FETCH_ALLOW, ..._envAllow]);

  // Reject URLs that target the local network (RFC 1918 / link-local /
  // loopback / IPv6 ULA). Stops a hostile renderer from probing the
  // user's intranet via the main-process fetch.
  function isPrivateHost(host) {
    if (!host) return true;
    const lower = host.toLowerCase();
    if (lower === 'localhost' || lower === '0.0.0.0') return true;
    if (lower.endsWith('.local') || lower.endsWith('.lan')) return true;
    // IPv4 literals
    const v4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;        // link-local + AWS metadata
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
      if (a === 0) return true;
    }
    // IPv6: loopback, link-local, ULA
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc00:') || lower.startsWith('fd00:')) return true;
    return false;
  }

  function checkFetchUrl(rawUrl) {
    let parsed;
    try { parsed = new URL(rawUrl); }
    catch { return { ok: false, reason: 'invalid url' }; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: `scheme ${parsed.protocol} not allowed` };
    }
    if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return { ok: false, reason: 'http: only allowed for localhost' };
    }
    if (isPrivateHost(parsed.hostname)) {
      return { ok: false, reason: `host ${parsed.hostname} is private/loopback` };
    }
    if (!FETCH_ALLOW.has(parsed.hostname)) {
      return { ok: false, reason: `host ${parsed.hostname} not in fetch allowlist` };
    }
    return { ok: true };
  }

  ipcMain.handle('http_fetch', async (_, args) => {
    try {
      const { url, options } = args || {};
      if (typeof url !== 'string') return { ok: false, error: 'Invalid url' };
      const check = checkFetchUrl(url);
      if (!check.ok) return { ok: false, error: `Refused: ${check.reason}` };
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      return { ok: true, status: res.status, headers: Object.fromEntries(res.headers), body: text };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('http_fetch_binary', async (_, args) => {
    try {
      const { url, options } = args || {};
      if (typeof url !== 'string') return { ok: false, error: 'Invalid url' };
      const check = checkFetchUrl(url);
      if (!check.ok) return { ok: false, error: `Refused: ${check.reason}` };
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(60_000) });
      const ab = await res.arrayBuffer();
      return { ok: true, status: res.status, headers: Object.fromEntries(res.headers), bodyBase64: Buffer.from(ab).toString('base64') };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // PUT is doubly dangerous (data exfiltration vector). Same allowlist
  // applies. Forks adding their own upload endpoint must add the host
  // to FETCH_HOSTS_ALLOW or extend DEFAULT_FETCH_ALLOW above.
  ipcMain.handle('http_put_binary', async (_, args) => {
    try {
      const { url, base64Data, headers } = args || {};
      if (typeof url !== 'string' || typeof base64Data !== 'string') {
        return { ok: false, error: 'Invalid args' };
      }
      const check = checkFetchUrl(url);
      if (!check.ok) return { ok: false, error: `Refused: ${check.reason}` };
      const buf = Buffer.from(base64Data, 'base64');
      const res = await fetch(url, {
        method: 'PUT',
        headers: headers || {},
        body: buf,
        signal: AbortSignal.timeout(60_000),
      });
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Demo project download + extract
  // Pulls the demo .gha bundle from the public releases repo. URL is
  // overridable from the renderer for forks that want to ship their own demo.
  ipcMain.handle('download_demo_zip', async (_, { url } = {}) => {
    const extractZip = (await import('extract-zip')).default;
    const targetDir = path.join(app.getPath('documents'), 'Ghost Arcade Community', 'Demo Project');
    const demoFile = path.join(targetDir, 'demo.gha');

    if (fs.existsSync(demoFile)) {
      return { projectDir: targetDir, projectJSON: fs.readFileSync(demoFile, 'utf-8'), alreadyExists: true };
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const downloadUrl = url || 'https://github.com/riskcapital/ghost-arcade-releases/releases/download/demo-assets/ghost-arcade-demo.zip';
    console.log('[Demo] Downloading from:', downloadUrl);

    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('demo-download-progress', {
          received, total: contentLength, percent: Math.round((received / contentLength) * 100),
        });
      }
    }

    const tempZip = path.join(app.getPath('temp'), 'ghost-arcade-community-demo.zip');
    fs.writeFileSync(tempZip, Buffer.concat(chunks));
    await extractZip(tempZip, { dir: targetDir });
    try { fs.unlinkSync(tempZip); } catch { /* */ }

    let illFile = demoFile;
    if (!fs.existsSync(illFile)) {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.gha')) {
          illFile = path.join(targetDir, entry.name);
          break;
        }
        if (entry.isDirectory()) {
          const sub = fs.readdirSync(path.join(targetDir, entry.name));
          const found = sub.find(f => f.endsWith('.gha'));
          if (found) {
            const subDir = path.join(targetDir, entry.name);
            for (const f of sub) fs.renameSync(path.join(subDir, f), path.join(targetDir, f));
            try { fs.rmdirSync(subDir); } catch { /* */ }
            illFile = path.join(targetDir, found);
            break;
          }
        }
      }
    }
    if (!fs.existsSync(illFile)) throw new Error('No .gha project file found in the demo zip');

    return { projectDir: targetDir, projectJSON: fs.readFileSync(illFile, 'utf-8'), alreadyExists: false };
  });

  // Renderer to main log forwarding
  ipcMain.handle('debug_log', (_e, msg) => {
    try {
      const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
      fs.appendFileSync(_logFile, `[RENDERER] ${new Date().toISOString()} ${line}\n`);
    } catch { /* */ }
    return true;
  });

  // Local-only error log (no remote telemetry in OSS)
  // Pro version POSTs to ghostarcade.live/api/error-report with license key
  // attached so we can correlate crashes to users. OSS just appends to the
  // local debug log; no phone-home.
  ipcMain.handle('report_error', async (_, args) => {
    try {
      const { error, stack, context, severity } = args || {};
      const line = `[${severity || 'error'}] ${context ? '(' + context + ') ' : ''}${error}${stack ? '\n' + stack : ''}`;
      fs.appendFileSync(_logFile, `[ERROR-REPORT] ${new Date().toISOString()} ${line}\n`);
      return { logged: true };
    } catch {
      return { logged: false };
    }
  });
}

// ============================================================
// Permissions
// ============================================================

function setupPermissions() {
  // Whitelist of permissions the app legitimately needs. Anything not in
  // this set gets denied. midi/midiSysex are critical because Chromium's macOS
  // MIDI backend hard-requires the granted permission and will silently
  // reject `navigator.requestMIDIAccess()` without it.
  const SAFE_PERMISSIONS = new Set([
    'media',
    'display-capture',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'local-fonts',
    'midi',
    'midiSysex',
  ]);

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (SAFE_PERMISSIONS.has(permission)) return callback(true);
    console.warn(`[Permissions] Denying '${permission}' request`);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => SAFE_PERMISSIONS.has(permission));

  // Content Security Policy (defense in depth)
  // Inject a CSP header on every renderer response. The renderer SHOULD
  // already be locked down by `contextIsolation:true` + `nodeIntegration:false`,
  // but a strict CSP gives us a second layer that:
  //   - blocks remote script injection (a hostile cloud shader can't smuggle
  //     a <script src="evil.js"> via shader source rendered as HTML)
  //   - whitelists exactly the network surface we expect (own ws/http on
  //     loopback, github for cloud shader catalog, blobs/data for
  //     canvas-extracted thumbnails)
  // Forks adding an external endpoint must extend connect-src here.
  // (Pro-only FFmpeg loop creator + its unpkg.com CDN allowance and
  // 'wasm-unsafe-eval' directive were removed — Community has no
  // WebAssembly surface.)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = app.isPackaged
      ? "script-src 'self' 'unsafe-inline' blob:"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:";
    const csp = [
      "default-src 'self' blob: data:",
      // Vite dev needs eval for HMR. Production keeps inline scripts for
      // trusted local animation surfaces, but does not allow runtime eval.
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: data:",
      "font-src 'self' data:",
      // Local WS server (9001) + HTTP server (9002) for mobile companion.
      // Vite dev server (1420) for development. github for cloud shader
      // catalog metadata fetches.
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:* https://github.com https://*.githubusercontent.com https://api.github.com",
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ');
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // System audio capture: getDisplayMedia() needs an explicit handler in
  // Electron or it throws "Not supported". We pick the primary screen and
  // include audio loopback (Windows-only effectively; Mac requires
  // BlackHole/Loopback for the audio track to actually carry samples).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const primaryScreen = sources[0];
      if (primaryScreen) {
        callback({ video: primaryScreen, audio: 'loopback' });
      } else {
        callback({});
      }
    } catch (err) {
      console.error('[DisplayMedia] Error getting sources:', err);
      callback({});
    }
  });
}

// ============================================================
// Windows
// ============================================================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Ghost Arcade Community',
    backgroundColor: '#0a0a0c',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build-resources', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      zoomFactor: 1.0,
    },
  });

  mainWindow.webContents.setZoomFactor(1.0);

  if (process.platform === 'darwin') {
    // macOS native menu required for Cmd+C/V/Z shortcuts in text fields.
    const { Menu } = require('electron');
    const template = [
      {
        label: 'Ghost Arcade Community',
        submenu: [
          { label: 'About', role: 'about' },
          { type: 'separator' },
          { label: 'Settings', accelerator: 'Cmd+,', click: () => mainWindow.webContents.send('open-settings') },
          { type: 'separator' },
          { label: 'Hide', accelerator: 'Cmd+H', role: 'hide' },
          { label: 'Hide Others', accelerator: 'Cmd+Alt+H', role: 'hideOthers' },
          { label: 'Show All', role: 'unhide' },
          { type: 'separator' },
          { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Cmd+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'Shift+Cmd+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'Cmd+X', role: 'cut' },
          { label: 'Copy', accelerator: 'Cmd+C', role: 'copy' },
          { label: 'Paste', accelerator: 'Cmd+V', role: 'paste' },
          { label: 'Select All', accelerator: 'Cmd+A', role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle Full Screen', accelerator: 'Ctrl+Cmd+F', role: 'togglefullscreen' },
          { type: 'separator' },
          { label: 'Reload', accelerator: 'Cmd+R', role: 'reload' },
          { label: 'Developer Tools', accelerator: 'Alt+Cmd+I', role: 'toggleDevTools' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { label: 'Minimize', accelerator: 'Cmd+M', role: 'minimize' },
          { label: 'Close', accelerator: 'Cmd+W', role: 'close' },
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    mainWindow.setMenu(null);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Auto-recover from renderer crashes (D3D device lost, OOM, driver TDR).
  // Reload up to 3 times within 30s; bail after that to avoid a reload-loop
  // burning CPU forever.
  let _reloads = 0;
  let _lastCrashAt = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const now = Date.now();
    const wasRecent = (now - _lastCrashAt) < 30_000;
    _lastCrashAt = now;
    if (wasRecent) _reloads++; else _reloads = 1;
    console.error(`[Main] Renderer process gone (reason=${details.reason}, exitCode=${details.exitCode}). Reload attempt #${_reloads}`);
    if (_reloads > 3) {
      console.error('[Main] Too many renderer crashes; not reloading.');
      return;
    }
    try { mainWindow.reload(); } catch (e) { console.error('[Main] reload() threw:', e); }
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main] Renderer unresponsive; waiting 10s before reloading...');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isLoading() === false) {
        try { mainWindow.reload(); } catch { /* */ }
      }
    }, 10_000);
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log(`[Renderer:err] ${message}`);
  });

  // Window-open + navigation hardening
  // Any `window.open()` from the renderer (or hostile injection) goes
  // through here. We DENY new BrowserWindow creation entirely (a new
  // window would inherit our preload + IPC bridge) and instead route
  // safe https:// URLs to the user's default browser via shell.openExternal.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch { /* malformed URL; silently drop */ }
    return { action: 'deny' };
  });
  // Block the renderer from navigating away from its origin entirely.
  // A stray window.location = "https://evil.com" would otherwise replace
  // the app with attacker-controlled content that retains preload bridge.
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    const allowedOrigin = (process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420');
    if (!navUrl.startsWith('file://') && !navUrl.startsWith(allowedOrigin)) {
      console.warn('[Nav] Blocked navigation to', navUrl);
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (outputWindow) {
      try { outputWindow.close(); } catch { /* */ }
      outputWindow = null;
    }
  });
}

function createOutputWindow(args = {}) {
  const { width, height, x, y, fullscreen = false, displayId = null } = args;

  // Dimension validation; clamp to sane bounds.
  const w = Math.max(320, Math.min(8192, Number(width) || 1920));
  const h = Math.max(240, Math.min(8192, Number(height) || 1080));

  if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();

  // Find the target display. Default: pick external if any, else primary.
  let targetDisplay = null;
  if (displayId) {
    targetDisplay = screen.getAllDisplays().find(d => d.id === displayId);
  }
  if (!targetDisplay) {
    const all = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    targetDisplay = all.find(d => d.id !== primary.id) || primary;
  }
  const bounds = targetDisplay.bounds;

  const winX = fullscreen ? bounds.x : Math.round(x ?? bounds.x);
  const winY = fullscreen ? bounds.y : Math.round(y ?? bounds.y);
  const winW = fullscreen ? bounds.width : w;
  const winH = fullscreen ? bounds.height : h;

  outputWindow = new BrowserWindow({
    width: winW, height: winH, x: winX, y: winY,
    title: 'Ghost Arcade Output',
    resizable: true,
    frame: true,
    fullscreen,
    // macOS: simpleFullscreen avoids the Mission Control space transition
    // which is critical for a VJ output on a second monitor (Cmd+Tab during
    // a set won't yank the output away).
    simpleFullscreen: process.platform === 'darwin',
    autoHideMenuBar: true,
    skipTaskbar: false,
    backgroundColor: '#000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
    },
  });
  outputWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
  if (!app.isPackaged) {
    outputWindow.loadURL(`${devUrl}?mode=output`);
  } else {
    outputWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { mode: 'output' } });
  }

  // Same nav hardening as the main window; output should never load anything
  // other than the local renderer and never spawn child BrowserWindows.
  outputWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch { /* */ }
    return { action: 'deny' };
  });
  outputWindow.webContents.on('will-navigate', (event, navUrl) => {
    const allowedOrigin = (process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420');
    if (!navUrl.startsWith('file://') && !navUrl.startsWith(allowedOrigin)) {
      console.warn('[Output Nav] Blocked navigation to', navUrl);
      event.preventDefault();
    }
  });

  outputWindow.on('closed', () => { outputWindow = null; });
  console.log(`[Output] Window created on display "${targetDisplay.label || targetDisplay.id}" at ${winX},${winY} ${winW}x${winH} fullscreen=${fullscreen}`);
  return { ok: true };
}

// ============================================================
// App lifecycle
// ============================================================

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[Main] Another instance is running; quitting');
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  setupPermissions();
  registerIpcHandlers();
  await startNodeServer();
  createMainWindow();

  // Display hotplug. If the output is on a display that's pulled, snap it
  // back to the primary monitor so the performer can find it again.
  screen.on('display-removed', (_ev, removedDisplay) => {
    try {
      if (!outputWindow || outputWindow.isDestroyed()) return;
      const bounds = outputWindow.getBounds();
      const remaining = screen.getAllDisplays();
      const stillVisible = remaining.some(d => {
        const b = d.bounds;
        return bounds.x >= b.x && bounds.x < b.x + b.width
            && bounds.y >= b.y && bounds.y < b.y + b.height;
      });
      if (stillVisible) return;
      const primary = screen.getPrimaryDisplay();
      console.warn(`[Main] Display removed (id=${removedDisplay?.id}); snapping output to primary.`);
      outputWindow.setBounds({
        x: primary.bounds.x + 40,
        y: primary.bounds.y + 40,
        width: Math.min(1280, primary.bounds.width - 80),
        height: Math.min(720, primary.bounds.height - 80),
      });
      outputWindow.setFullScreen(false);
    } catch (err) {
      console.error('[Main] display-removed handler failed:', err?.message || err);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  cleanupAndQuit();
});

let isQuitting = false;
function cleanupAndQuit() {
  if (isQuitting) return;
  isQuitting = true;
  console.log('[Main] Cleaning up before quit...');
  try { stopServer(); } catch (e) { console.error('[Cleanup] stopServer:', e.message); }

  // Force-quit fallback in case anything hangs cleanup.
  setTimeout(() => {
    console.log('[Main] Force quitting');
    app.exit(0);
  }, 500);
  app.quit();
}
