import { mount } from 'svelte';
import { initErrorReporter } from './lib/utils/errorReporter';
import { silenceThreeSerializationNoise } from './lib/utils/silenceThreePatches';

// Patch THREE.Texture.toJSON before anything else; any tree walker that
// serializes a live texture would otherwise log "Unable to serialize Texture"
// per frame and starve the renderer.
silenceThreeSerializationNoise();

// Install global error handlers
initErrorReporter();

// Determine which app to mount based on URL mode parameter.
//   ?mode=webrtc-display -> presentation-only WebRTC receiver (CURRENT DEFAULT
//                            for the output window — the editor publishes its
//                            canvas via same-process WebRTC and this window
//                            renders the stream into a single <video> element).
//   ?mode=output         -> legacy second-renderer fallback (kept for safety;
//                            re-enable from electron/main.js if WebRTC ever
//                            misbehaves on a specific machine).
//   (anything else)      -> full editor UI
//
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');
const isOutputWindow = mode === 'output' || mode === 'webrtc-display';

if (isOutputWindow && !(window as any).__OUTPUT_WINDOW_MODE__) {
  // contextBridge.exposeInMainWorld may have already set this read-only;
  // silently swallow the assignment failure if so.
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* */ }
}

async function init() {
  if (mode === 'webrtc-display') {
    const { default: OutputDisplayApp } = await import('./OutputDisplayApp.svelte');
    mount(OutputDisplayApp, { target: document.getElementById('app')! });
  } else if (mode === 'output') {
    const { default: OutputWindowApp } = await import('./OutputWindowApp.svelte');
    mount(OutputWindowApp, { target: document.getElementById('app')! });
  } else {
    const { default: App } = await import('./App.svelte');
    mount(App, { target: document.getElementById('app')! });
  }
}

init();
