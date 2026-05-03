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
//   ?mode=output  -> second-display canvas-only output window
//   (anything else) -> full editor UI
//
const urlParams = new URLSearchParams(window.location.search);
const isOutputWindow = urlParams.get('mode') === 'output';

if (isOutputWindow && !(window as any).__OUTPUT_WINDOW_MODE__) {
  // contextBridge.exposeInMainWorld may have already set this read-only;
  // silently swallow the assignment failure if so.
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* */ }
}

async function init() {
  if (isOutputWindow) {
    const { default: OutputWindowApp } = await import('./OutputWindowApp.svelte');
    mount(OutputWindowApp, { target: document.getElementById('app')! });
  } else {
    const { default: App } = await import('./App.svelte');
    mount(App, { target: document.getElementById('app')! });
  }
}

init();
