/**
 * Ghost Arcade Community - Electron Preload
 *
 * Exposes a narrow IPC bridge to the renderer. AGPL-3.0 OSS variant;
 * the Pro preload includes AI streaming, license validation, Director,
 * updater, and texture-sharing channels. Community omits those surfaces.
 *
 * NOTE: must be CommonJS (.cjs). Electron preloads with contextIsolation: true
 * do not reliably support ESM.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Whitelist of IPC commands the renderer is allowed to invoke. Anything
// not in this set is rejected before reaching ipcMain. Keep this trimmed
// to the surface main.js actually implements; every entry here represents
// a permission boundary you've decided to expose to the UI.
const ALLOWED_IPC_COMMANDS = new Set([
  // Health check
  'ping',
  'get_companion_token',
  // Companion server status (mobile pairing UI). force_start is an
  // explicit user opt-in to free 9001/9002 from competing processes —
  // it's only invoked from a button the user clicks AFTER seeing the
  // "port in use" error message.
  'companion_status',
  'companion_force_start',

  // Output window
  'get_displays', 'create_output_window', 'close_output_window',
  'output_fullscreen_external', 'output_toggle_fullscreen', 'output_set_cursor',
  'show_main_window',

  // File system
  'pick_directory', 'save_file_binary', 'save_file_text', 'save_project_dialog',
  'read_project_file', 'read_local_asset_file', 'download_demo_zip',

  // Cloud shader source persistence (saved to userData/shaders/)
  'save_shader_source', 'list_shader_sources', 'delete_shader_source',
  'save_shader_thumbnail',

  // HTTP proxy used by cloud shader fetches and demo zip downloads.
  // We deliberately don't include `http_fetch_stream` (was for AI gen
  // streaming, removed in OSS).
  'http_fetch', 'http_fetch_binary', 'http_put_binary',

  // Local logging; no remote telemetry in OSS, just appends to debug.log.
  'debug_log',
  'report_error',
]);

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Restricted invoke; only allows whitelisted IPC commands. Any other
   * command name rejects without ever reaching the main process. This
   * limits the renderer's blast radius even if a malicious cloud shader
   * ever managed to escape its execution context.
   */
  invoke: (command, args) => {
    if (!ALLOWED_IPC_COMMANDS.has(command)) {
      return Promise.reject(new Error(`IPC command not allowed: ${command}`));
    }
    return ipcRenderer.invoke(command, args);
  },

  /**
   * Listen for IPC events from main process. Channels are also whitelisted.
   * Returns a cleanup function that removes the listener.
   */
  on: (channel, callback) => {
    const allowed = [
      'demo-download-progress', 'open-settings', 'output-cursor',
      // Pushed from main whenever startNodeServer() updates state, so
      // the mobile pairing UI updates without polling.
      'companion-status',
    ];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Platform string: 'win32' | 'darwin' | 'linux'.
   */
  platform: process.platform,

  /**
   * Resolve the absolute filesystem path for a File object obtained from
   * a drag-and-drop or <input type="file"> in the renderer. Replaces
   * Electron's removed `File.path` extension (gone since Electron 32).
   *
   * Returns '' (empty string) if the input is not a real OS File or the
   * path can't be resolved. Callers must treat empty as "no path
   * available" and fall back to Save As.
   */
  getPathForFile: (file) => {
    try {
      if (!file || typeof file !== 'object') return '';
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
});

// Detection flag for the renderer.
contextBridge.exposeInMainWorld('__ELECTRON__', true);

// Output window mode (?mode=output); main app UI hides chrome and shows
// only the canvas when this flag is set.
const isOutputMode = typeof window !== 'undefined' && window.location.search.includes('mode=output');
if (isOutputMode) {
  contextBridge.exposeInMainWorld('__OUTPUT_MODE__', true);
}

console.log('[Preload] Bridge exposed: electronAPI + __ELECTRON__' + (isOutputMode ? ' + __OUTPUT_MODE__' : ''));
