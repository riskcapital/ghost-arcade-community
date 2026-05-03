/**
 * JavaScript Animation Renderer
 * Handles rendering of AI-generated or custom Three.js and p5.js animations
 * by running their HTML in sandboxed iframes and copying frames into textures.
 */

import * as THREE from 'three';
import type { JSAnimationSource } from '../types';

export interface JSAnimationContext {
  id: string;
  iframe: HTMLIFrameElement;
  canvas: HTMLCanvasElement;
  texture: THREE.Texture;
  animationType: 'threejs' | 'p5js';
  updateTexture: () => void;
  updateParams: (params: Record<string, number | boolean | number[]>) => void;
  dispose: () => void;
}

const FRAME_MESSAGE = 'ghostarcade:js-animation-frame';
const PARAM_MESSAGE = 'ghostarcade:js-animation-params';
const jsAnimationCache = new Map<string, JSAnimationContext>();

type JSAnimationFrameMessage = {
  type?: string;
  id?: string;
  bitmap?: ImageBitmap;
};

function buildSandboxedHtml(htmlCode: string, id: string): string {
  const bridgeScript = `
<script>
;(() => {
  const animationId = ${JSON.stringify(id)};
  const frameMessage = ${JSON.stringify(FRAME_MESSAGE)};
  const paramMessage = ${JSON.stringify(PARAM_MESSAGE)};
  window.shaderParams = window.shaderParams || {};

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== paramMessage || data.id !== animationId) return;
    if (data.params && typeof data.params === 'object') {
      Object.assign(window.shaderParams, data.params);
    }
  });

  let frameInFlight = false;
  const sendFrame = () => {
    const canvas = document.querySelector('canvas');
    if (canvas && !frameInFlight && canvas.width > 0 && canvas.height > 0 && window.createImageBitmap) {
      frameInFlight = true;
      window.createImageBitmap(canvas)
        .then((bitmap) => {
          window.parent.postMessage({ type: frameMessage, id: animationId, bitmap }, '*', [bitmap]);
        })
        .catch(() => {})
        .finally(() => { frameInFlight = false; });
    }
    window.requestAnimationFrame(sendFrame);
  };
  window.requestAnimationFrame(sendFrame);
})();
</script>`;

  if (/<\/body\s*>/i.test(htmlCode)) {
    return htmlCode.replace(/<\/body\s*>/i, `${bridgeScript}\n</body>`);
  }
  return `${htmlCode}\n${bridgeScript}`;
}

/**
 * Create a JS animation context from HTML code.
 */
export function createJSAnimationContext(
  id: string,
  jsAnimation: JSAnimationSource,
  width = 1920,
  height = 1080
): JSAnimationContext {
  const cached = jsAnimationCache.get(id);
  if (cached) {
    return cached;
  }

  const iframe = document.createElement('iframe');
  iframe.title = `JS animation ${id}`;
  iframe.referrerPolicy = 'no-referrer';
  iframe.sandbox.add('allow-scripts');
  iframe.style.cssText = `
    position: fixed;
    left: -9999px;
    top: -9999px;
    width: ${width}px;
    height: ${height}px;
    border: none;
    pointer-events: none;
  `;

  const blob = new Blob([buildSandboxedHtml(jsAnimation.htmlCode, id)], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  iframe.src = blobUrl;
  document.body.appendChild(iframe);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const handleFrameMessage = (event: MessageEvent<JSAnimationFrameMessage>) => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!ctx || data?.type !== FRAME_MESSAGE || data.id !== id || !data.bitmap) return;

    try {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(data.bitmap, 0, 0, width, height);
      texture.needsUpdate = true;
    } finally {
      data.bitmap.close();
    }
  };
  window.addEventListener('message', handleFrameMessage);

  const updateTexture = () => {
    // Frames are pushed from the sandbox by postMessage. The method remains
    // for callers that tick all animation contexts once per render frame.
  };

  const updateParams = (params: Record<string, number | boolean | number[]>) => {
    iframe.contentWindow?.postMessage({ type: PARAM_MESSAGE, id, params }, '*');
  };

  const dispose = () => {
    window.removeEventListener('message', handleFrameMessage);
    texture.dispose();
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
    jsAnimationCache.delete(id);
  };

  const context: JSAnimationContext = {
    id,
    iframe,
    canvas,
    texture,
    animationType: jsAnimation.animationType,
    updateTexture,
    updateParams,
    dispose,
  };

  jsAnimationCache.set(id, context);
  return context;
}

/**
 * Get an existing JS animation context.
 */
export function getJSAnimationContext(id: string): JSAnimationContext | undefined {
  return jsAnimationCache.get(id);
}

/**
 * Dispose a JS animation context.
 */
export function disposeJSAnimationContext(id: string): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.dispose();
  }
}

/**
 * Update all active JS animation textures.
 */
export function updateAllJSAnimationTextures(): void {
  const contexts = Array.from(jsAnimationCache.values());
  for (const context of contexts) {
    context.updateTexture();
  }
}

/**
 * Update parameters for a specific animation.
 */
export function updateJSAnimationParams(id: string, params: Record<string, number | boolean | number[]>): void {
  const context = jsAnimationCache.get(id);
  if (context) {
    context.updateParams(params);
  }
}

/**
 * Get all active JS animation IDs.
 */
export function getActiveJSAnimationIds(): string[] {
  return Array.from(jsAnimationCache.keys());
}

/**
 * Check if a JS animation context exists.
 */
export function hasJSAnimationContext(id: string): boolean {
  return jsAnimationCache.has(id);
}

/**
 * Dispose all JS animation contexts.
 */
export function disposeAllJSAnimationContexts(): void {
  const ids = Array.from(jsAnimationCache.keys());
  for (const id of ids) {
    disposeJSAnimationContext(id);
  }
}
