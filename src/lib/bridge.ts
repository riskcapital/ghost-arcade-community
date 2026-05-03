/**
 * Platform Bridge — Electron IPC wrapper
 *
 * Provides a single `invoke()` function for IPC calls to the Electron main process.
 * Frontend code uses: import { invoke, isDesktopApp } from '$lib/bridge';
 */

declare global {
  interface Window {
    __ELECTRON__?: boolean;
    __OUTPUT_WINDOW_MODE__?: boolean;
    electronAPI?: {
      invoke: (command: string, args?: any) => Promise<any>;
      platform: string;
    };
  }
}

/**
 * Runtime detection — module-level constants for use in onMount() guards and reactive blocks.
 * The invoke() function also checks window.__ELECTRON__ at call time for safety.
 */
export const isElectron = typeof window !== 'undefined' && !!window.__ELECTRON__;
export const isDesktopApp = isElectron;
export const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
/** Legacy hidden-renderer flag retained for older route guards. */
export const isOsrMode = false;
/** True when running inside the visible output window (canvas only, state receiver) */
export const isOutputMode = typeof window !== 'undefined' && !!window.__OUTPUT_WINDOW_MODE__;

/**
 * Unified invoke — routes IPC calls to the Electron main process.
 *
 * Usage:
 *   const displays = await invoke('get_displays');
 *   const data = await invoke('read_file_binary', { path });
 */
export async function invoke<T = any>(command: string, args?: Record<string, any>): Promise<T> {
  if (window.__ELECTRON__ && window.electronAPI) {
    return window.electronAPI.invoke(command, args) as Promise<T>;
  }
  throw new Error(`invoke('${command}') called but Electron runtime not available`);
}
