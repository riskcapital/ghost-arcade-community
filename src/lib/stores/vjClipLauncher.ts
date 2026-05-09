// VJ Clip Launcher Store
// Manages the clip grid state for the VJ clip launcher workflow
// Works with shaders and videos directly (not compositions)

import { writable, derived, get } from 'svelte/store';
import type { BlendMode, Layer, MediaSource, Effect, JSAnimationSource, IntegratedEffectSource, SplatContent, Model3DContent, ISFInputDef, ContentFitMode } from '../types';
import { createDefaultSplatContent, createDefaultModel3DContent } from '../types';
import { createThreeJSIframeContext, getThreeJSIframeContext, createJSAnimationContext } from '../renderer/engine';
import { keyframeTimeline } from './keyframeTimeline';
import { parseISF } from '../isf/parser';
import { shouldUseAnonymousCrossOrigin } from '../utils/localAsset';

// Cache parsed ISF shader inputs per shader code to avoid re-parsing every frame
const vjShaderInputCache = new Map<string, ISFInputDef[]>();
function getShaderInputs(shaderCode: string | undefined): ISFInputDef[] | undefined {
  if (!shaderCode) return undefined;
  const cached = vjShaderInputCache.get(shaderCode);
  if (cached) return cached;
  try {
    const parsed = parseISF(shaderCode);
    const inputs = (parsed?.metadata?.INPUTS || []) as ISFInputDef[];
    vjShaderInputCache.set(shaderCode, inputs);
    return inputs;
  } catch {
    return undefined;
  }
}

// Default dimensions for the clip grid (user can add/remove dynamically)
export const DEFAULT_VJ_LAYERS = 4;
export const DEFAULT_VJ_COLUMNS = 8;
export const MAX_VJ_LAYERS = 32;
export const MAX_VJ_COLUMNS = 64;

// Backward-compat aliases — existing imports still work
export const NUM_VJ_LAYERS = DEFAULT_VJ_LAYERS;
export const NUM_VJ_COLUMNS = DEFAULT_VJ_COLUMNS;

// A clip in the grid - can be a shader, video, image, three.js HTML, AI-generated JS animation, legacy texture-sharing source, integrated effect, point cloud, or 3D model
export interface VJClip {
  id: string;
  type: 'shader' | 'video' | 'image' | 'threejs' | 'p5js' | 'jsanimation' | 'synthvision' | 'spout' | 'effect' | 'splat' | 'model3d';
  name: string;
  src: string;
  localPath?: string;
  thumbnail?: string;
  // For shaders
  shaderCode?: string;
  shaderValues?: Record<string, any>;
  // For videos
  videoElement?: HTMLVideoElement;
  // For three.js - iframe element for rendering
  iframeElement?: HTMLIFrameElement;
  // For AI-generated JS animations (Three.js or p5.js)
  jsAnimation?: JSAnimationSource;
  // For Performer - offscreen canvas
  synthVisionCanvas?: HTMLCanvasElement;
  // Legacy texture-sharing source name
  spoutSource?: string;
  // For integrated effects (FluidGen, Particles3D running natively in WebGL)
  effectSource?: IntegratedEffectSource;
  // For point cloud / splat clips
  splatContent?: SplatContent;
  // For 3D model clips
  model3dContent?: Model3DContent;
  // Per-clip effects
  effects?: Effect[];

  // ── Per-clip video transforms (only meaningful when type === 'video').
  //
  // These describe how the source video is mapped onto its layer's
  // unit quad. The transform is BAKED into the layer's `corners` field
  // by vjOutputLayers (see below) — Layer.position/scale/rotation stay
  // identity because the engine renders VJ layers via warp-quad
  // corners, bypassing those transforms. Defaults match an unbaked
  // identity quad: zoom=1, fit=cover, anchor=(0.5, 0.5), rotation=0,
  // opacity=1.
  zoom?: number;             // 0.1..4 (multiplier on quad size)
  fit?: 'cover' | 'contain' | 'fill';
  anchorX?: number;          // 0..1 (where in the canvas the quad's anchor sits)
  anchorY?: number;          // 0..1
  rotation?: number;         // -180..180 degrees
  opacity?: number;          // 0..1 (multiplied into vjLayerOpacity)
}

// A block contains a named collection of clips (8 columns x 4 layers)
export interface VJBlock {
  id: string;
  name: string;
  clipGrid: (VJClip | null)[][];
}

// VJ Layer state (per layer)
export interface VJLayerState {
  opacity: number;
  blendMode: BlendMode;
  solo: boolean;
  mute: boolean;
  activeColumn: number | null; // Which column is currently active (null = none) - used for visual indication in current block
  activeClip: VJClip | null; // The actual clip playing on this layer (persists across block switches)
  effects: Effect[];
}

// The full clip launcher state
export interface VJClipLauncherState {
  // Dynamic grid dimensions (user can add/remove layers & columns)
  numLayers: number;
  numColumns: number;
  // Blocks - each block has its own clip grid
  blocks: VJBlock[];
  // Currently active block ID
  activeBlockId: string;
  // Grid of clips [layerIndex][columnIndex] - computed from active block
  clipGrid: (VJClip | null)[][];
  // State per layer
  layerStates: VJLayerState[];
  // Master opacity
  masterOpacity: number;
  // Whether VJ mode is open
  isOpen: boolean;
  // Whether VJ mode is driving the output (live)
  isLive: boolean;
  // Composition-level effects (applied to final composite output)
  compositionEffects: Effect[];
  // Stage mode: bridge VJ layers to mapping layers
  stageMode: boolean;
  stagePresetId: string | null;
  // Stop-all blackout: when true, all VJ output is suppressed (black)
  // Auto-clears when any clip is launched
  stoppedAll: boolean;
  // Currently selected VJ layer index (for parameter panel + keyframe timeline)
  selectedLayerIndex: number | null;
}

// UUID generator with fallback for insecure contexts (mobile HTTP)
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for browsers that don't support crypto.randomUUID (e.g., mobile HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Create an empty clip grid with given dimensions
function createEmptyClipGrid(numLayers: number = DEFAULT_VJ_LAYERS, numColumns: number = DEFAULT_VJ_COLUMNS): (VJClip | null)[][] {
  return Array(numLayers).fill(null).map(() => Array(numColumns).fill(null));
}

// Create a new block with default name
function createNewBlock(name: string = 'Block 1', numLayers: number = DEFAULT_VJ_LAYERS, numColumns: number = DEFAULT_VJ_COLUMNS): VJBlock {
  return {
    id: generateUUID(),
    name,
    clipGrid: createEmptyClipGrid(numLayers, numColumns),
  };
}

// Create a default layer state
function createDefaultLayerState(): VJLayerState {
  return {
    opacity: 1,
    blendMode: 'normal' as BlendMode,
    solo: false,
    mute: false,
    activeColumn: null,
    activeClip: null,
    effects: [],
  };
}

// Create default state
function createDefaultState(): VJClipLauncherState {
  const defaultBlock = createNewBlock('Block 1', DEFAULT_VJ_LAYERS, DEFAULT_VJ_COLUMNS);
  return {
    numLayers: DEFAULT_VJ_LAYERS,
    numColumns: DEFAULT_VJ_COLUMNS,
    blocks: [defaultBlock],
    activeBlockId: defaultBlock.id,
    clipGrid: defaultBlock.clipGrid,
    layerStates: Array(DEFAULT_VJ_LAYERS).fill(null).map(() => createDefaultLayerState()),
    masterOpacity: 1,
    isOpen: false,
    isLive: false,
    compositionEffects: [],
    stageMode: false,
    stagePresetId: null,
    stoppedAll: false,
    selectedLayerIndex: null,
  };
}

// Cache for video elements to persist playback
const videoElementCache = new Map<string, HTMLVideoElement>();

// Cache for VJ source objects (keeps textures persistent)
const vjSourceCache = new Map<string, MediaSource>();

function prepareClipVideo(clip: VJClip | null | undefined): HTMLVideoElement | null {
  if (!clip || clip.type !== 'video') return null;

  let videoEl = videoElementCache.get(clip.id) || clip.videoElement;
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoElementCache.set(clip.id, videoEl);
  }

  if (videoEl.getAttribute('src') !== clip.src) {
    videoEl.pause();
    // IMPORTANT: set crossOrigin BEFORE src. The `.src=` setter initiates
    // the load — changing crossOrigin after that point would force a second
    // in-flight load.
    if (shouldUseAnonymousCrossOrigin(clip.src)) {
      videoEl.crossOrigin = 'anonymous';
    } else {
      videoEl.removeAttribute('crossorigin');
    }
    // The `.src=` setter triggers the resource selection algorithm. Don't
    // call `.load()` afterward — a second in-flight request races any
    // pending play() and throws AbortError on Chromium 130 (Electron 42).
    // That was the "VJ video freezes on rapid clip switch" symptom.
    videoEl.src = clip.src;
  }

  videoEl.loop = true;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.preload = 'auto';
  clip.videoElement = videoEl;
  return videoEl;
}

function pauseClipVideo(clip: VJClip | null | undefined): void {
  if (!clip || clip.type !== 'video') return;
  const videoEl = videoElementCache.get(clip.id) || clip.videoElement;
  try { videoEl?.pause(); } catch {}
}

function syncVideoPlaybackForState(state: VJClipLauncherState, restartIds = new Set<string>()): void {
  const activeVideoIds = new Set<string>();
  if (state.isLive && !state.stoppedAll) {
    for (const layerState of state.layerStates) {
      const clip = layerState.activeClip;
      if (clip?.type === 'video' && !layerState.mute) {
        activeVideoIds.add(clip.id);
        const videoEl = prepareClipVideo(clip);
        if (!videoEl) continue;
        if (restartIds.has(clip.id)) {
          try { videoEl.currentTime = 0; } catch {}
        }
        if (videoEl.paused) {
          videoEl.play().catch(e => console.warn('VJ video play failed:', e));
        }
      }
    }
  }

  for (const [clipId, videoEl] of videoElementCache) {
    if (!activeVideoIds.has(clipId)) {
      try { videoEl.pause(); } catch {}
    }
  }
}

// Create the store
function createVJClipLauncherStore() {
  const { subscribe, set, update } = writable<VJClipLauncherState>(createDefaultState());

  return {
    subscribe,
    set,
    update,

    // Reset to default state
    reset() {
      // Cleanup video elements
      for (const video of videoElementCache.values()) {
        video.pause();
        video.src = '';
      }
      videoElementCache.clear();
      vjSourceCache.clear();
      set(createDefaultState());
    },

    // Set VJ mode open state
    setOpen(isOpen: boolean) {
      update(state => ({ ...state, isOpen }));
    },

    // Set a clip in the grid (updates both clipGrid and the active block)
    setClip(layerIndex: number, columnIndex: number, clip: VJClip | null) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);

        // If setting a video, create/get the video element
        if (clip && clip.type === 'video') {
          prepareClipVideo(clip);
        }

        // If setting a threejs clip (built-in), create/get the iframe context
        if (clip && clip.type === 'threejs') {
          const context = createThreeJSIframeContext(clip.id, clip.src);
          clip.iframeElement = context.iframe;
        }

        // If setting an AI-generated JS animation (threejs or p5js with jsAnimation)
        if (clip && (clip.type === 'jsanimation' || clip.type === 'p5js') && clip.jsAnimation) {
          const context = createJSAnimationContext(clip.id, clip.jsAnimation);
          clip.iframeElement = context.iframe;
        }

        newGrid[layerIndex][columnIndex] = clip;

        // Also update the active block's grid
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = clip;
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });

        return { ...state, clipGrid: newGrid, blocks: newBlocks };
      });
    },

    // Clear a clip from the grid
    clearClip(layerIndex: number, columnIndex: number) {
      update(state => {
        // Remove stale source cache entry for this clip
        const oldClip = state.clipGrid[layerIndex]?.[columnIndex];
        if (oldClip) {
          pauseClipVideo(oldClip);
          vjSourceCache.delete(`vj-${layerIndex}-${oldClip.id}`);
        }

        const newGrid = state.clipGrid.map(row => [...row]);
        newGrid[layerIndex][columnIndex] = null;

        // If this was the active clip, deactivate it and clear the reference
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex].activeColumn === columnIndex) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeColumn: null, activeClip: null };
        }

        // Also update the active block's grid
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = null;
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });

        return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
      });
      syncVideoPlaybackForState(get({ subscribe }));
    },

    /** Clear all synthvision clips from the grid — called when VJ mode closes to prevent stale canvas refs */
    clearSynthVisionClips() {
      update(state => {
        let changed = false;
        const newGrid = state.clipGrid.map((row, li) =>
          row.map((clip, ci) => {
            if (clip?.type === 'synthvision') {
              vjSourceCache.delete(`vj-${li}-${clip.id}`);
              changed = true;
              return null;
            }
            return clip;
          })
        );
        if (!changed) return state;

        // Deactivate any layer whose active clip was synthvision
        const newLayerStates = state.layerStates.map((ls) => {
          if (ls.activeClip?.type === 'synthvision') {
            return { ...ls, activeColumn: null, activeClip: null };
          }
          return ls;
        });

        return { ...state, clipGrid: newGrid, layerStates: newLayerStates };
      });
    },

    // Trigger a clip (activate it on its layer)
    triggerClip(layerIndex: number, columnIndex: number) {
      let didTrigger = false;
      let isReclick = false;
      let outgoingClip: VJClip | null = null;
      let incomingClip: VJClip | null = null;
      const restartIds = new Set<string>();
      update(state => {
        const newLayerStates = [...state.layerStates];
        const clip = state.clipGrid[layerIndex][columnIndex];
        const currentActiveClip = newLayerStates[layerIndex].activeClip;
        if (!clip) return state;

        isReclick = !!(currentActiveClip && currentActiveClip.id === clip.id);
        outgoingClip = !isReclick ? currentActiveClip : null;
        incomingClip = clip;

        // Re-clicking the currently-playing clip keeps STATE unchanged
        // (so we don't reset keyframe time mid-show), but the video
        // element below is still restarted to frame 0 — that's the
        // explicit user expectation: every click on a clip starts it
        // from the beginning, no exceptions.
        if (isReclick) {
          didTrigger = false;
          return state;
        }

        if (currentActiveClip?.type === 'video') pauseClipVideo(currentActiveClip);
        if (clip.type === 'video') {
          prepareClipVideo(clip);
          restartIds.add(clip.id);
        }
        // Trigger the clip - store it in activeClip for playback
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          activeColumn: columnIndex,
          activeClip: clip
        };
        didTrigger = true;

        return { ...state, layerStates: newLayerStates, stoppedAll: false };
      });

      // VJ semantics: clicking a clip ALWAYS restarts it at frame 0,
      // never resumes from where it last paused. Combined with pausing
      // the outgoing clip on this same layer, this stops the
      // "videos play forever in the background and resume mid-stream"
      // behaviour. Wrapped in try/catch because currentTime= can throw
      // if the element is mid-load. Cast through VJClip — TS can't
      // track assignments across the update() closure boundary.
      const inc = incomingClip as VJClip | null;
      const out = outgoingClip as VJClip | null;
      if (inc && inc.type === 'video' && inc.videoElement) {
        try { inc.videoElement.currentTime = 0; } catch { /* */ }
        if (inc.videoElement.paused) {
          inc.videoElement.play().catch(() => { /* AbortError on rapid retrigger is fine */ });
        }
      }
      // Pause the OUTGOING video so it doesn't keep decoding in the
      // background. Only when it's a different element from the
      // incoming clip's — same element (e.g. re-clicking same clip on
      // the layer) doesn't get paused mid-restart.
      if (out && out.type === 'video' && out.videoElement &&
          out.videoElement !== inc?.videoElement) {
        try { out.videoElement.pause(); } catch { /* */ }
      }

      // Restart keyframe timeline from the beginning so clip animations play from t=0
      if (didTrigger) {
        syncVideoPlaybackForState(get({ subscribe }), restartIds);
        keyframeTimeline.seek(0);
        keyframeTimeline.play();
      }
    },

    // Trigger an entire column (all layers at once)
    triggerColumn(columnIndex: number) {
      let didTrigger = false;
      const restartIds = new Set<string>();
      update(state => {
        const newLayerStates = state.layerStates.map((layerState, layerIndex) => {
          // Only activate if there's a clip in that slot
          const clip = state.clipGrid[layerIndex][columnIndex];
          if (clip) {
            if (layerState.activeClip?.type === 'video' && layerState.activeClip.id !== clip.id) {
              pauseClipVideo(layerState.activeClip);
            }
            if (clip.type === 'video') {
              prepareClipVideo(clip);
              restartIds.add(clip.id);
            }
            didTrigger = true;
            return { ...layerState, activeColumn: columnIndex, activeClip: clip };
          }
          return layerState;
        });

        return { ...state, layerStates: newLayerStates, stoppedAll: false };
      });
      if (didTrigger) {
        syncVideoPlaybackForState(get({ subscribe }), restartIds);
        keyframeTimeline.seek(0);
        keyframeTimeline.play();
      }
    },

    // Stop all clips on a layer
    stopLayer(layerIndex: number) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        pauseClipVideo(newLayerStates[layerIndex]?.activeClip);
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeColumn: null, activeClip: null };
        return { ...state, layerStates: newLayerStates };
      });
      syncVideoPlaybackForState(get({ subscribe }));
    },

    // Stop all clips — suppresses all VJ output to black
    stopAll() {
      update(state => {
        for (const layerState of state.layerStates) pauseClipVideo(layerState.activeClip);
        const newLayerStates = state.layerStates.map(ls => ({ ...ls, activeColumn: null, activeClip: null }));
        return { ...state, layerStates: newLayerStates, stoppedAll: true };
      });
      syncVideoPlaybackForState(get({ subscribe }));
    },

    // Set layer opacity
    setLayerOpacity(layerIndex: number, opacity: number) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], opacity: Math.max(0, Math.min(1, opacity)) };
        return { ...state, layerStates: newLayerStates };
      });
    },

    // Set layer blend mode
    setLayerBlendMode(layerIndex: number, blendMode: BlendMode) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], blendMode };
        return { ...state, layerStates: newLayerStates };
      });
    },

    // Toggle layer solo
    toggleLayerSolo(layerIndex: number) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], solo: !newLayerStates[layerIndex].solo };
        return { ...state, layerStates: newLayerStates };
      });
      syncVideoPlaybackForState(get({ subscribe }));
    },

    // Toggle layer mute
    toggleLayerMute(layerIndex: number) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], mute: !newLayerStates[layerIndex].mute };
        return { ...state, layerStates: newLayerStates };
      });
      syncVideoPlaybackForState(get({ subscribe }));
    },

    // Set master opacity
    setMasterOpacity(opacity: number) {
      update(state => ({ ...state, masterOpacity: Math.max(0, Math.min(1, opacity)) }));
    },

    // Toggle live mode
    toggleLive() {
      update(state => ({ ...state, isLive: !state.isLive }));
      syncVideoPlaybackForState(get({ subscribe }));
    },

    // Set live mode
    setLive(isLive: boolean) {
      update(state => ({ ...state, isLive }));
      syncVideoPlaybackForState(get({ subscribe }));
    },

    // Add effect to layer
    addLayerEffect(layerIndex: number, effect: Effect) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: [...newLayerStates[layerIndex].effects, effect]
        };
        return { ...state, layerStates: newLayerStates };
      });
    },

    // Remove effect from layer
    removeLayerEffect(layerIndex: number, effectId: string) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: newLayerStates[layerIndex].effects.filter(e => e.id !== effectId)
        };
        return { ...state, layerStates: newLayerStates };
      });
    },

    // Toggle effect enabled
    toggleLayerEffect(layerIndex: number, effectId: string) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: newLayerStates[layerIndex].effects.map(e =>
            e.id === effectId ? { ...e, enabled: !e.enabled } : e
          )
        };
        return { ...state, layerStates: newLayerStates };
      });
    },

    // Update a single shader uniform value on the active clip of a layer
    updateActiveClipShaderValue(layerIndex: number, paramName: string, value: any) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        const activeClip = newLayerStates[layerIndex].activeClip;
        if (!activeClip) return state;

        const newClip = {
          ...activeClip,
          shaderValues: { ...(activeClip.shaderValues || {}), [paramName]: value },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Also update the clip in the grid if it exists there
        const newGrid = state.clipGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex][col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
      // Auto-record keyframe if track is armed (keyed per-clip so switching clips shows independent keyframes)
      const s = get({ subscribe });
      const activeClipId = s.layerStates[layerIndex]?.activeClip?.id;
      if (activeClipId && (typeof value === 'number' || typeof value === 'boolean')) {
        keyframeTimeline.autoRecord(
          `vj-${activeClipId}`,
          `shader:${paramName}`,
          value,
          paramName,
          typeof value === 'boolean' ? 'boolean' : 'number'
        );
      }
    },

    // Batch-update multiple shader values in a single store mutation (used by modulation engine)
    batchUpdateShaderValues(layerIndex: number, values: Record<string, number>) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        const activeClip = newLayerStates[layerIndex].activeClip;
        if (!activeClip) return state;

        const newClip = {
          ...activeClip,
          shaderValues: { ...(activeClip.shaderValues || {}), ...values },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Sync clip in grid
        const newGrid = state.clipGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex][col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    // Update splat content on the active clip of a layer
    updateActiveClipSplatContent(layerIndex: number, updates: Partial<SplatContent>) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'splat') return state;

        const newClip = {
          ...activeClip,
          splatContent: { ...(activeClip.splatContent || createDefaultSplatContent()), ...updates },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Also update in the grid
        const newGrid = state.clipGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    // Update model3d content on the active clip of a layer
    updateActiveClipModel3DContent(layerIndex: number, updates: Partial<Model3DContent>) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'model3d') return state;

        const newClip = {
          ...activeClip,
          model3dContent: { ...(activeClip.model3dContent || createDefaultModel3DContent()), ...updates },
        };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Also update in the grid
        const newGrid = state.clipGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    // Update video transform props on the active clip of a layer.
    // Community v1.1.4 lacks playback fields (playbackMode/playbackRate/
    // trimStart/trimEnd/isPlaying); the Pick<> here covers ONLY the
    // transform fields the VJ Transform UI mutates. The transforms are
    // baked into Layer.corners by vjOutputLayers — see below.
    updateActiveClipVideoProps(layerIndex: number, updates: Partial<Pick<VJClip, 'zoom' | 'fit' | 'anchorX' | 'anchorY' | 'rotation' | 'opacity'>>) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        if (layerIndex < 0 || layerIndex >= newLayerStates.length) return state;
        const activeClip = newLayerStates[layerIndex]?.activeClip;
        if (!activeClip || activeClip.type !== 'video') return state;

        const newClip = { ...activeClip, ...updates };
        newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };

        // Mirror the change into the grid for any cells whose clip.id
        // matches (handles the case where the same source has been
        // triggered into multiple columns of the same row).
        const newGrid = state.clipGrid.map(row => [...row]);
        for (let col = 0; col < state.numColumns; col++) {
          const gridClip = newGrid[layerIndex]?.[col];
          if (gridClip && gridClip.id === activeClip.id) {
            newGrid[layerIndex][col] = newClip;
          }
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    // Update splat/model3d content on a specific clip in the grid (for file loading)
    updateClipSplatContent(layerIndex: number, columnIndex: number, updates: Partial<SplatContent>) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip || clip.type !== 'splat') return state;

        const newClip = {
          ...clip,
          splatContent: { ...(clip.splatContent || createDefaultSplatContent()), ...updates },
        };
        newGrid[layerIndex][columnIndex] = newClip;

        // Also update activeClip if this clip is active
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex]?.activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    updateClipModel3DContent(layerIndex: number, columnIndex: number, updates: Partial<Model3DContent>) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip || clip.type !== 'model3d') return state;

        const newClip = {
          ...clip,
          model3dContent: { ...(clip.model3dContent || createDefaultModel3DContent()), ...updates },
        };
        newGrid[layerIndex][columnIndex] = newClip;

        // Also update activeClip if this clip is active
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex]?.activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    updateClipEffectSource(layerIndex: number, columnIndex: number, effectSource: any) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex]?.[columnIndex];
        if (!clip || clip.type !== 'effect') return state;

        const newClip = { ...clip, effectSource };
        newGrid[layerIndex][columnIndex] = newClip;

        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex]?.activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = { ...newLayerStates[layerIndex], activeClip: newClip };
        }

        return { ...state, layerStates: newLayerStates, clipGrid: newGrid };
      });
    },

    // Update effect params
    updateLayerEffectParams(layerIndex: number, effectId: string, params: Record<string, any>) {
      update(state => {
        const newLayerStates = [...state.layerStates];
        newLayerStates[layerIndex] = {
          ...newLayerStates[layerIndex],
          effects: newLayerStates[layerIndex].effects.map(e =>
            e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
          )
        };
        return { ...state, layerStates: newLayerStates };
      });
      // Auto-record keyframes for any armed effect parameter tracks (keyed per-clip)
      const sFx = get({ subscribe });
      const activeClipIdFx = sFx.layerStates[layerIndex]?.activeClip?.id;
      if (activeClipIdFx) {
        for (const [paramName, value] of Object.entries(params)) {
          if (typeof value !== 'number' && typeof value !== 'boolean') continue;
          const trackKey = `fx:${effectId}:${paramName}`;
          keyframeTimeline.autoRecord(
            `vj-${activeClipIdFx}`,
            trackKey,
            value,
            paramName,
            typeof value === 'boolean' ? 'boolean' : 'number'
          );
        }
      }
    },

    // ========== Composition Effects ==========

    addCompositionEffect(effect: Effect) {
      update(state => ({
        ...state,
        compositionEffects: [...state.compositionEffects, effect]
      }));
    },

    removeCompositionEffect(effectId: string) {
      update(state => ({
        ...state,
        compositionEffects: state.compositionEffects.filter(e => e.id !== effectId)
      }));
    },

    toggleCompositionEffect(effectId: string) {
      update(state => ({
        ...state,
        compositionEffects: state.compositionEffects.map(e =>
          e.id === effectId ? { ...e, enabled: !e.enabled } : e
        )
      }));
    },

    updateCompositionEffectParams(effectId: string, params: Record<string, any>) {
      update(state => ({
        ...state,
        compositionEffects: state.compositionEffects.map(e =>
          e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
        )
      }));
    },

    // ========== Clip Effects ==========

    addClipEffect(layerIndex: number, columnIndex: number, effect: Effect) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex][columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: [...(clip.effects || []), effect]
        };
        // Also update active clip if this is the one playing
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        // Update block grid too
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = newGrid[layerIndex][columnIndex];
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });
        return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
      });
    },

    removeClipEffect(layerIndex: number, columnIndex: number, effectId: string) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex][columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: (clip.effects || []).filter(e => e.id !== effectId)
        };
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = newGrid[layerIndex][columnIndex];
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });
        return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
      });
    },

    toggleClipEffect(layerIndex: number, columnIndex: number, effectId: string) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex][columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: (clip.effects || []).map(e =>
            e.id === effectId ? { ...e, enabled: !e.enabled } : e
          )
        };
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = newGrid[layerIndex][columnIndex];
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });
        return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
      });
    },

    /**
     * Update a single shader-input value on a grid clip without launching it.
     * Used by the clip preview panel so users can dial in shader params
     * before triggering. Mirrors any matching active layer (same clip id)
     * so the change shows up live if the clip is already playing.
     */
    updateClipShaderValue(layerIndex: number, columnIndex: number, name: string, value: any) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex][columnIndex];
        if (!clip) return state;
        const updatedClip = {
          ...clip,
          shaderValues: { ...(clip.shaderValues || {}), [name]: value },
        };
        newGrid[layerIndex][columnIndex] = updatedClip;
        // Mirror to the active layer if it's playing this same clip
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: updatedClip,
          };
        }
        // Mirror into the active block's persisted grid
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = updatedClip;
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });
        return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
      });
    },

    updateClipEffectParams(layerIndex: number, columnIndex: number, effectId: string, params: Record<string, any>) {
      update(state => {
        const newGrid = state.clipGrid.map(row => [...row]);
        const clip = newGrid[layerIndex][columnIndex];
        if (!clip) return state;
        newGrid[layerIndex][columnIndex] = {
          ...clip,
          effects: (clip.effects || []).map(e =>
            e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e
          )
        };
        const newLayerStates = [...state.layerStates];
        if (newLayerStates[layerIndex].activeClip?.id === clip.id) {
          newLayerStates[layerIndex] = {
            ...newLayerStates[layerIndex],
            activeClip: newGrid[layerIndex][columnIndex]
          };
        }
        const newBlocks = state.blocks.map(block => {
          if (block.id === state.activeBlockId) {
            const blockGrid = block.clipGrid.map(row => [...row]);
            blockGrid[layerIndex][columnIndex] = newGrid[layerIndex][columnIndex];
            return { ...block, clipGrid: blockGrid };
          }
          return block;
        });
        return { ...state, clipGrid: newGrid, layerStates: newLayerStates, blocks: newBlocks };
      });
    },

    // ========== Block Management ==========

    // Add a new block
    addBlock(name?: string) {
      update(state => {
        const blockNum = state.blocks.length + 1;
        const newBlock = createNewBlock(name || `Block ${blockNum}`, state.numLayers, state.numColumns);
        return {
          ...state,
          blocks: [...state.blocks, newBlock],
        };
      });
    },

    // Switch to a different block (does NOT interrupt playing clips)
    setActiveBlock(blockId: string) {
      update(state => {
        const block = state.blocks.find(b => b.id === blockId);
        if (!block) return state;

        // Update activeColumn for each layer based on whether the activeClip exists in this block
        const newLayerStates = state.layerStates.map((layerState, layerIndex) => {
          if (!layerState.activeClip) {
            return { ...layerState, activeColumn: null };
          }
          // Find if the active clip exists in this block's grid
          const columnIndex = block.clipGrid[layerIndex].findIndex(
            clip => clip && clip.id === layerState.activeClip!.id
          );
          return {
            ...layerState,
            activeColumn: columnIndex >= 0 ? columnIndex : null
          };
        });

        // Switch to the block's clip grid (for browsing), keep playing clips unchanged
        return {
          ...state,
          activeBlockId: blockId,
          clipGrid: block.clipGrid.map(row => [...row]),
          layerStates: newLayerStates,
        };
      });
    },

    // Rename a block
    renameBlock(blockId: string, newName: string) {
      update(state => {
        const newBlocks = state.blocks.map(block =>
          block.id === blockId ? { ...block, name: newName } : block
        );
        return { ...state, blocks: newBlocks };
      });
    },

    // Delete a block (cannot delete the last one)
    deleteBlock(blockId: string) {
      update(state => {
        if (state.blocks.length <= 1) return state; // Keep at least one block

        const newBlocks = state.blocks.filter(b => b.id !== blockId);

        // If deleting the active block, switch to the first remaining block
        let newActiveBlockId = state.activeBlockId;
        let newClipGrid = state.clipGrid;

        if (state.activeBlockId === blockId) {
          const firstBlock = newBlocks[0];
          newActiveBlockId = firstBlock.id;
          newClipGrid = firstBlock.clipGrid.map(row => [...row]);
        }

        return {
          ...state,
          blocks: newBlocks,
          activeBlockId: newActiveBlockId,
          clipGrid: newClipGrid,
        };
      });
    },

    // Duplicate a block
    duplicateBlock(blockId: string) {
      update(state => {
        const blockToDuplicate = state.blocks.find(b => b.id === blockId);
        if (!blockToDuplicate) return state;

        const newBlock: VJBlock = {
          id: generateUUID(),
          name: `${blockToDuplicate.name} (copy)`,
          clipGrid: blockToDuplicate.clipGrid.map(row => [...row]),
        };

        return {
          ...state,
          blocks: [...state.blocks, newBlock],
        };
      });
    },

    // Reorder layers (drag and drop)
    reorderLayers(fromIndex: number, toIndex: number) {
      update(state => {
        if (fromIndex === toIndex) return state;
        if (fromIndex < 0 || fromIndex >= state.numLayers) return state;
        if (toIndex < 0 || toIndex >= state.numLayers) return state;

        // Reorder layerStates
        const newLayerStates = [...state.layerStates];
        const [movedLayerState] = newLayerStates.splice(fromIndex, 1);
        newLayerStates.splice(toIndex, 0, movedLayerState);

        // Reorder clipGrid rows
        const newClipGrid = [...state.clipGrid];
        const [movedRow] = newClipGrid.splice(fromIndex, 1);
        newClipGrid.splice(toIndex, 0, movedRow);

        // Also reorder rows in all blocks
        const newBlocks = state.blocks.map(block => {
          const newBlockGrid = [...block.clipGrid];
          const [movedBlockRow] = newBlockGrid.splice(fromIndex, 1);
          newBlockGrid.splice(toIndex, 0, movedBlockRow);
          return { ...block, clipGrid: newBlockGrid };
        });

        return {
          ...state,
          layerStates: newLayerStates,
          clipGrid: newClipGrid,
          blocks: newBlocks,
        };
      });
    },

    // ========== Dynamic Layer/Column Management ==========

    // Add a new layer (row) to all blocks
    addLayer() {
      update(state => {
        if (state.numLayers >= MAX_VJ_LAYERS) return state;

        const newNumLayers = state.numLayers + 1;

        // Add empty row to clipGrid
        const newClipGrid = [...state.clipGrid, Array(state.numColumns).fill(null)];

        // Add empty row to all blocks
        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: [...block.clipGrid, Array(state.numColumns).fill(null)],
        }));

        // Add new layer state
        const newLayerStates = [...state.layerStates, createDefaultLayerState()];

        return { ...state, numLayers: newNumLayers, clipGrid: newClipGrid, blocks: newBlocks, layerStates: newLayerStates };
      });
    },

    // Remove the last layer (or a specific layer by index)
    removeLayer(index?: number) {
      update(state => {
        if (state.numLayers <= 1) return state;

        const removeIdx = index !== undefined ? index : state.numLayers - 1;
        if (removeIdx < 0 || removeIdx >= state.numLayers) return state;

        const newNumLayers = state.numLayers - 1;

        // Remove row from clipGrid
        const newClipGrid = state.clipGrid.filter((_, i) => i !== removeIdx);

        // Remove row from all blocks
        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: block.clipGrid.filter((_, i) => i !== removeIdx),
        }));

        // Remove layer state
        const newLayerStates = state.layerStates.filter((_, i) => i !== removeIdx);

        return { ...state, numLayers: newNumLayers, clipGrid: newClipGrid, blocks: newBlocks, layerStates: newLayerStates };
      });
    },

    // Add a new column to all blocks
    addColumn() {
      update(state => {
        if (state.numColumns >= MAX_VJ_COLUMNS) return state;

        const newNumColumns = state.numColumns + 1;

        // Add null to each row in clipGrid
        const newClipGrid = state.clipGrid.map(row => [...row, null]);

        // Add null to each row in all blocks
        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: block.clipGrid.map(row => [...row, null]),
        }));

        return { ...state, numColumns: newNumColumns, clipGrid: newClipGrid, blocks: newBlocks };
      });
    },

    // Remove the last column (or a specific column by index)
    removeColumn(index?: number) {
      update(state => {
        if (state.numColumns <= 1) return state;

        const removeIdx = index !== undefined ? index : state.numColumns - 1;
        if (removeIdx < 0 || removeIdx >= state.numColumns) return state;

        const newNumColumns = state.numColumns - 1;

        // Remove column from clipGrid
        const newClipGrid = state.clipGrid.map(row => row.filter((_, i) => i !== removeIdx));

        // Remove column from all blocks
        const newBlocks = state.blocks.map(block => ({
          ...block,
          clipGrid: block.clipGrid.map(row => row.filter((_, i) => i !== removeIdx)),
        }));

        // Clear activeColumn reference if it was the removed column
        const newLayerStates = state.layerStates.map(ls => {
          if (ls.activeColumn === removeIdx) {
            return { ...ls, activeColumn: null };
          }
          if (ls.activeColumn !== null && ls.activeColumn > removeIdx) {
            return { ...ls, activeColumn: ls.activeColumn - 1 };
          }
          return ls;
        });

        return { ...state, numColumns: newNumColumns, clipGrid: newClipGrid, blocks: newBlocks, layerStates: newLayerStates };
      });
    },

    // ========== Stage Mode ==========

    toggleStageMode() {
      update(state => ({ ...state, stageMode: !state.stageMode }));
    },

    setStageMode(enabled: boolean) {
      update(state => ({ ...state, stageMode: enabled }));
    },

    setStagePreset(presetId: string | null) {
      update(state => ({ ...state, stagePresetId: presetId }));
    },

    setSelectedLayerIndex(idx: number | null) {
      update(state => ({ ...state, selectedLayerIndex: idx }));
    },
  };
}

export const vjClipLauncher = createVJClipLauncherStore();

// Derived store: Get the active clip for each layer
export const activeVJLayers = derived(
  vjClipLauncher,
  ($vjClipLauncher) => {
    // Check if any layer has solo enabled
    const hasSolo = $vjClipLauncher.layerStates.some(ls => ls.solo);

    return $vjClipLauncher.layerStates.map((layerState, layerIndex) => {
      // If muted, or if solo is active on another layer, return null
      if (layerState.mute) return null;
      if (hasSolo && !layerState.solo) return null;

      // Get the active clip directly from layerState (persists across block switches)
      const clip = layerState.activeClip;
      if (!clip) return null;

      // Merge layer effects + clip effects (clip effects applied first, then layer effects)
      const clipEffects = clip.effects || [];
      const mergedEffects = [...clipEffects, ...layerState.effects];

      return {
        clip,
        opacity: layerState.opacity,
        blendMode: layerState.blendMode,
        effects: mergedEffects,
        layerIndex,
      };
    }).filter(Boolean) as Array<{
      clip: VJClip;
      opacity: number;
      blendMode: BlendMode;
      effects: Effect[];
      layerIndex: number;
    }>;
  }
);

// Derived store: Get layers to render when VJ mode is live
export const vjOutputLayers = derived(
  [vjClipLauncher, activeVJLayers],
  ([$vjClipLauncher, $activeVJLayers]) => {
    if (!$vjClipLauncher.isLive) return null;

    const outputLayers: Layer[] = [];

    // Process layers (layer 0 = topmost in VJ mode)
    for (let vjLayerIndex = 0; vjLayerIndex < $vjClipLauncher.numLayers; vjLayerIndex++) {
      const activeLayer = $activeVJLayers.find(al => al.layerIndex === vjLayerIndex);
      if (!activeLayer) continue;

      const clip = activeLayer.clip;
      const vjLayerOpacity = activeLayer.opacity * $vjClipLauncher.masterOpacity;

      // Get or create cached source
      const cacheKey = `vj-${vjLayerIndex}-${clip.id}`;
      let source = vjSourceCache.get(cacheKey);

      if (!source) {
        // Map VJClip type to MediaSource type
        let mediaType: 'shader' | 'video' | 'image' | 'threejs' | 'color' | 'spout' | 'effect';
        if (clip.type === 'shader') mediaType = 'shader';
        else if (clip.type === 'video') mediaType = 'video';
        else if (clip.type === 'threejs' || clip.type === 'synthvision') mediaType = 'threejs';
        else if (clip.type === 'spout') mediaType = 'spout';
        else if (clip.type === 'effect') mediaType = 'effect';
        else if (clip.type === 'splat' || clip.type === 'model3d') mediaType = 'image'; // Placeholder; actual rendering uses splatContent/model3dContent
        else mediaType = 'image';

        source = {
          id: clip.id,
          type: mediaType,
          name: clip.name,
          src: clip.src,
          localPath: clip.localPath,
          shaderCode: clip.shaderCode,
          shaderInputs: getShaderInputs(clip.shaderCode),
          shaderValues: clip.shaderValues || {},
          videoElement: clip.videoElement,
          iframeElement: clip.iframeElement,
        };

        // For threejs clips, get the canvas from the iframe context
        if (clip.type === 'threejs') {
          const context = getThreeJSIframeContext(clip.id);
          if (context) {
            source.threejsCanvas = context.canvas;
          }
        }

        // For synthvision clips, use the provided offscreen canvas
        if (clip.type === 'synthvision' && clip.synthVisionCanvas) {
          source.threejsCanvas = clip.synthVisionCanvas;
        }

        // Preserve legacy texture-sharing metadata for imported projects
        if (clip.type === 'spout' && clip.spoutSource) {
          source.spoutSource = {
            senderName: clip.spoutSource,
            name: clip.spoutSource, // Legacy compatibility
            width: 1920,
            height: 1080,
          };
        }

        // For effect clips, set the effectSource property for integrated WebGL effects
        if (clip.type === 'effect' && clip.effectSource) {
          source.effectSource = clip.effectSource;
        }

        vjSourceCache.set(cacheKey, source);
      } else {
        // Update dynamic properties
        source.shaderValues = clip.shaderValues || {};
        source.localPath = clip.localPath;
        if (clip.videoElement) {
          source.videoElement = clip.videoElement;
        }
        if (clip.iframeElement) {
          source.iframeElement = clip.iframeElement;
        }
        // For threejs clips, get the canvas from the iframe context
        if (clip.type === 'threejs') {
          const context = getThreeJSIframeContext(clip.id);
          if (context) {
            source.threejsCanvas = context.canvas;
          }
        }
        // For synthvision clips, update the canvas reference
        if (clip.type === 'synthvision' && clip.synthVisionCanvas) {
          source.threejsCanvas = clip.synthVisionCanvas;
        }
        // For effect clips, update the effectSource (for parameter changes)
        if (clip.type === 'effect' && clip.effectSource) {
          source.effectSource = clip.effectSource;
        }
      }

      // Map clip type to layer type (splat/model3d get their own layer types for proper rendering)
      let layerType: Layer['type'] = 'media';
      if (clip.type === 'splat') layerType = 'splat';
      else if (clip.type === 'model3d') layerType = 'model3d';

      // ── Per-clip video transforms baked into corners ──────────────
      // VJ layers render via the engine's warp-quad pipeline, which
      // bypasses Layer.position/scale/rotation in favour of the
      // four-corner UV warp. So we synthesise non-identity corners
      // from the per-clip transform and let the existing warp shader
      // apply them. position/scale/rotation stay identity.
      // contentFit + opacity are still consumed via the existing
      // shader uniforms (they're UV-based and per-layer-multiply,
      // not corner-based).
      const clipZoom = clip.type === 'video' ? (clip.zoom ?? 1) : 1;
      const clipRotation = clip.type === 'video' ? (clip.rotation ?? 0) : 0;
      const clipOpacity = clip.type === 'video' ? (clip.opacity ?? 1) : 1;
      const ax = clip.type === 'video' ? (clip.anchorX ?? 0.5) : 0.5;
      const ay = clip.type === 'video' ? (clip.anchorY ?? 0.5) : 0.5;
      // Map VJ-friendly fit names to engine ContentFitMode.
      let clipContentFit: ContentFitMode | undefined;
      if (clip.type === 'video') {
        const f = clip.fit ?? 'cover';
        clipContentFit = f === 'cover' ? 'fill' : f === 'contain' ? 'crop' : 'stretch';
      }

      // Corner computation. Engine corner space is [0,1]² with
      // y=1 at top. We work in centered space (-0.5..0.5) for the
      // matrix math, then re-translate to [0,1] for the engine.
      const cosR = Math.cos((clipRotation * Math.PI) / 180);
      const sinR = Math.sin((clipRotation * Math.PI) / 180);
      // Anchor maps user 0..1 → quad offset from center in [-0.5..0.5].
      const offX = (ax - 0.5);
      const offY = (ay - 0.5);
      const transformCorner = (cx: number, cy: number) => {
        // cx,cy are corner positions in centered space ±0.5
        // Apply zoom, rotate around center, translate by anchor
        const sx = cx * clipZoom;
        const sy = cy * clipZoom;
        const rx = sx * cosR - sy * sinR;
        const ry = sx * sinR + sy * cosR;
        return { x: rx + 0.5 + offX, y: ry + 0.5 + offY };
      };
      // Default unit corners in centered space (-0.5..0.5). The
      // top corners have cy=+0.5 because engine corner space has
      // y=1 at the top, y=0 at the bottom — transformCorner adds
      // 0.5 at the end so cy=+0.5 → y=1 (top) for identity. Hand-
      // off into the engine's corner format is now direct.
      const clipCorners = {
        topLeft:     transformCorner(-0.5,  0.5),
        topRight:    transformCorner( 0.5,  0.5),
        bottomLeft:  transformCorner(-0.5, -0.5),
        bottomRight: transformCorner( 0.5, -0.5),
      };

      // Create Layer object with all required properties
      const layer: Layer = {
        id: `vj-layer-${vjLayerIndex}`,
        name: clip.name,
        type: layerType,
        visible: true,
        locked: false,
        opacity: vjLayerOpacity * clipOpacity,
        blendMode: activeLayer.blendMode,
        source,
        linesContent: null,
        svgContent: null,
        colorContent: null,
        lightPaintingContent: null,
        textContent: null,
        splatContent: clip.type === 'splat' ? (clip.splatContent || createDefaultSplatContent()) : null,
        model3dContent: clip.type === 'model3d' ? (clip.model3dContent || createDefaultModel3DContent()) : null,
        // Transform identity — per-clip transforms are baked into
        // `corners` below so the engine's warp pipeline applies them
        // uniformly. position/scale/rotation are bypassed by the
        // corner pipeline anyway.
        position: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        flipH: false,
        flipV: false,
        contentFit: clipContentFit,
        // Warping - corners computed from per-clip zoom/anchor/rotation
        // above; defaults to a full-screen unit quad when all transforms
        // are at identity (zoom=1, anchor=0.5/0.5, rotation=0).
        warpMode: 'corners',
        corners: clipCorners,
        meshGrid: null,
        // No mask or crop
        mask: null,
        cropRegion: null,
        layerShape: null,
        edgeEffects: null,
        // Effects from VJ layer state
        effects: activeLayer.effects,
      };

      outputLayers.push(layer);
    }

    return outputLayers.length > 0 ? outputLayers : null;
  }
);

// Helper to get current state
export function getVJClipLauncherState(): VJClipLauncherState {
  return get(vjClipLauncher);
}

// Don't clear source cache when VJ mode toggles - let textures persist
// This was causing issues because textures need to be reloaded each time
// The cache is small and keyed by vj-layer-index + clip-id, so it won't grow unbounded
