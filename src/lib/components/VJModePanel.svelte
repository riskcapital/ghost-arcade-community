<script lang="ts">
  // VJ Mode Panel - Layers/Columns Grid
  // Uses vjClipLauncher store for state management

  import { onMount, onDestroy } from 'svelte';
  import { isMac } from '$lib/bridge';
  import { get } from 'svelte/store';
  import { mediaLibrary } from '../stores/media';
  import { vjClipLauncher, type VJClip, type VJBlock } from '../stores/vjClipLauncher';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { project, stagePresets } from '../stores/layers';
  import { globalStagePresets } from '../stores/globalPresets';
  import { parseISF, getInputDefault } from '../isf/parser';
  import { generateCachedThumbnail as generateShaderThumbnail } from '../isf/thumbnail';
  import type { BlendMode, Effect, EffectType, ISFInputDef, SplatContent, Model3DContent, Model3DFormat, SplatAnimationType, SplatDisplacementType, Model3DAnimationType, Model3DDeformationType, Model3DMaterialType, Model3DWireframeMode, Model3DLightingPreset } from '../types';
  import { generateUUID, createDefaultSplatContent, createDefaultModel3DContent } from '../types';
  import { audioStore } from '../stores/audio';
  import ClipPreviewPanel from './ClipPreviewPanel.svelte';
  import { markUserInteracting } from '../midi/midiRouter';
  import { modulationStore, modulationEngine, setParamModSource, setParamModAmount, setParamModSpeed, registerParamRanges, getModulatedValue, setBaseValue, clearBaseValues, clearModulatedValues, type ModSource, type ParamModulation } from '../audio/modulation';
  import { performanceStore } from '../audio/performanceEngine';
  import type { ISFInput } from '../isf/parser';
  import { getPluginByEffectType, type PluginParamDef } from '../plugins/registry';
  import AIShaderGenerator from './AIShaderGenerator.svelte';
  import AIVideoGenerator from './AIVideoGenerator.svelte';
  import { shaderLibrary } from '../stores/shaderLibrary';
  import { videoLibrary } from '../stores/videoLibrary';
  import { settings } from '../stores/settings';
  import { startRecording as startRec, formatRecordingDuration, type RecorderHandle } from '../recording/recorder';
  import { showLoading } from '../stores/loading';
  import SynthVision from './SynthVision.svelte';
  import VJAudioBar from './VJAudioBar.svelte';
  import { applyPresetToEffect, getEffectPresets, getNumericEffectParams } from '../effects/effectUX';
  import { EFFECT_CATALOG } from '../effects/effectCatalog';
  import { EFFECT_PARAM_DEFS } from '../effects/effectParamDefs';
  import { canUseVideoExport, canUseParticles3D } from '../stores/license';
  import { getDefaultEffectParams as getRendererDefaultEffectParams } from '../renderer/effects';
  import EffectPickerModal from './EffectPickerModal.svelte';
  import SplatPanel from './SplatPanel.svelte';
  import Model3DPanel from './Model3DPanel.svelte';
  import { createSharedMediaUrl, getPathForFile, shouldUseAnonymousCrossOrigin } from '../utils/localAsset';

  // File menu callback (wired by parent App.svelte)
  export let onFileAction: ((action: 'new' | 'open' | 'save' | 'saveAs' | 'importPresets' | 'loadDemo' | 'undo' | 'redo') => void) | null = null;
  let vjFileMenuOpen = false;
  function vjFileAction(action: 'new' | 'open' | 'save' | 'saveAs' | 'importPresets' | 'loadDemo' | 'undo' | 'redo') {
    vjFileMenuOpen = false;
    onFileAction?.(action);
  }

  // Plugin definitions for VJ mode (integrated effects - no external process needed)
  interface VJPluginItem {
    id: string;
    name: string;
    description: string;
    effectType: 'fluid' | 'particles' | 'splat' | 'model3d';
    icon: 'fluid' | 'particles' | 'splat' | 'model3d';
  }

  const vjPlugins: VJPluginItem[] = [
    {
      id: 'fluidgen',
      name: 'FluidGen',
      description: 'GPU fluid simulation',
      effectType: 'fluid',
      icon: 'fluid',
    },
    {
      id: 'particles3d',
      name: 'Particles3D',
      description: '3D volumetric particles',
      effectType: 'particles',
      icon: 'particles',
    },
    {
      id: 'pointcloud',
      name: 'Point Cloud',
      description: 'PLY point cloud / splat',
      effectType: 'splat',
      icon: 'splat',
    },
    {
      id: 'model3d',
      name: '3D Model',
      description: 'GLTF/OBJ/FBX models',
      effectType: 'model3d',
      icon: 'model3d',
    },
  ];

  // Performer panel state
  let showPerformer = false;
  let performerStarted = false; // Once started, keeps running in background

  // Media tray collapse state
  let mediaTrayCollapsed = false;

  // Effects tab: Composition / Layer / Clip
  let effectsTab: 'composition' | 'layer' | 'clip' = 'layer';

  // Effect types available
  const effectTypes: { value: EffectType; label: string }[] =
    EFFECT_CATALOG.map((e) => ({ value: e.type, label: e.label }));

  // Expanded effect param
  let expandedEffectId: string | null = null;
  let showEffectPicker = false;
  let vjPresetSelection: Record<string, string> = {};
  let vjMacro1 = 0.5;
  let vjMacro2 = 0.5;
  let vjMacroBindings: Record<string, { m1?: string; m2?: string }> = {};

  let stageSaveScope: 'project' | 'global' = 'project';

  $: allStagePresets = [
    ...$stagePresets.map(p => ({ ...p, _scope: (p.scope || 'project') as 'project' | 'global' })),
    ...$globalStagePresets.map(p => ({ ...p, _scope: 'global' as const })),
  ];

  // Stable index arrays for the clip-grid {#each ... (key)} loops. Without these,
  // `{#each Array($vjClipLauncher.numLayers)}` creates a fresh anonymous array
  // on every reactive tick, forcing Svelte to tear down and recreate every row
  // and every cell on every store change (incl. audio-driven ones). Keyed by
  // integer index so rows/cells keep their DOM when only the contents change.
  let layerIndices: number[] = [];
  let columnIndices: number[] = [];
  $: {
    const n = $vjClipLauncher.numLayers;
    if (layerIndices.length !== n) {
      layerIndices = Array.from({ length: n }, (_, i) => i);
    }
  }
  $: {
    const n = $vjClipLauncher.numColumns;
    if (columnIndices.length !== n) {
      columnIndices = Array.from({ length: n }, (_, i) => i);
    }
  }

  function getVJMacroBinding(effectId: string, which: 'm1' | 'm2'): string {
    return vjMacroBindings[effectId]?.[which] || '';
  }

  function setVJMacroBinding(effectId: string, which: 'm1' | 'm2', paramName: string) {
    const prev = vjMacroBindings[effectId] || {};
    vjMacroBindings = {
      ...vjMacroBindings,
      [effectId]: { ...prev, [which]: paramName || undefined },
    };
  }

  function saveStagePresetWithScope() {
    const name = `Preset ${allStagePresets.length + 1}`;
    if (stageSaveScope === 'global') {
      const currentProject = get(project);
      const layersSnapshot = JSON.parse(JSON.stringify(currentProject.layers, (key, value) => {
        if (key === 'texture' || key === 'videoElement') return undefined;
        if (typeof value === 'object' && value !== null && value.constructor && value.constructor.name.startsWith('_')) return undefined;
        return value;
      }));
      globalStagePresets.add({
        id: generateUUID(),
        name,
        createdAt: Date.now(),
        layers: layersSnapshot,
        scope: 'global',
      });
    } else {
      project.saveStagePreset(name);
    }
  }

  function deleteStagePreset(preset: any) {
    if (preset._scope === 'global') {
      globalStagePresets.remove(preset.id);
    } else {
      project.deleteStagePreset(preset.id);
    }
  }

  // Block editing state
  let editingBlockId: string | null = null;
  let editingBlockName: string = '';
  let blockInputEl: HTMLInputElement | null = null;

  // Preview canvas
  let previewCanvas: HTMLCanvasElement;
  let previewCtx: CanvasRenderingContext2D | null = null;
  let previewAnimationFrame: number | null = null;

  // Resizable preview section
  let previewSectionHeight = 350;
  let isResizingPreview = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  function onPreviewResizeStart(e: PointerEvent) {
    isResizingPreview = true;
    resizeStartY = e.clientY;
    resizeStartHeight = previewSectionHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPreviewResizeMove(e: PointerEvent) {
    if (!isResizingPreview) return;
    const delta = e.clientY - resizeStartY;
    previewSectionHeight = Math.max(150, Math.min(800, resizeStartHeight + delta));
  }

  function onPreviewResizeEnd() {
    isResizingPreview = false;
  }

  // Resizable performer tray (drag top edge)
  let performerTopOverride: number | null = null;
  let isResizingPerformer = false;
  let performerResizeStartY = 0;
  let performerResizeStartTop = 0;

  $: performerTop = performerTopOverride ?? (previewSectionHeight + 56);

  function onPerformerResizeStart(e: PointerEvent) {
    isResizingPerformer = true;
    performerResizeStartY = e.clientY;
    performerResizeStartTop = performerTop;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPerformerResizeMove(e: PointerEvent) {
    if (!isResizingPerformer) return;
    const delta = e.clientY - performerResizeStartY;
    const minTop = 56; // don't go above the header bar
    const maxTop = window.innerHeight - 150; // leave at least 150px for performer
    performerTopOverride = Math.max(minTop, Math.min(maxTop, performerResizeStartTop + delta));
  }

  function onPerformerResizeEnd() {
    isResizingPerformer = false;
  }

  // Access the main output canvas via window (set by App.svelte)
  function getMainCanvas(): HTMLCanvasElement | null {
    return (window as any).__ghostarcadeOutputCanvas || null;
  }

  // Preview loop perf budget — controlled by Settings → Performance.
  // Defaults to full resolution at 60fps so capable machines look
  // crisp out of the box; users on weak hardware can downgrade either
  // axis (resolution / framerate) via the settings panel to free GPU
  // budget for the actual render. The full-res + 60fps path is the
  // historical default; the cap settings are pure opt-in.
  let _lastPreviewFrameTime = 0;

  // Start preview loop when VJ mode opens
  function startPreviewLoop() {
    if (previewAnimationFrame !== null) return;

    function updatePreview(now: number) {
      previewAnimationFrame = requestAnimationFrame(updatePreview);

      // Pull the current perf settings off the store snapshot each
      // frame — cheap, and reactive to settings panel changes without
      // restart.
      const perf = (get(settings) as any)?.performance;
      const fpsTarget = perf?.previewFrameRate ?? 60;
      const resCap = perf?.previewMaxDim ?? 0; // 0 = no cap (full res)
      const frameIntervalMs = 1000 / Math.max(1, fpsTarget);

      if (fpsTarget < 60 && now - _lastPreviewFrameTime < frameIntervalMs) return;
      _lastPreviewFrameTime = now;

      const mainCanvas = getMainCanvas();
      if (!previewCanvas || !mainCanvas || !previewCtx) return;
      const srcW = mainCanvas.width;
      const srcH = mainCanvas.height;
      if (srcW === 0 || srcH === 0) return;

      // Resolution cap (long-edge). When 0 (Full), we match the main
      // canvas dimensions exactly — same as the pre-settings behavior.
      const longEdge = Math.max(srcW, srcH);
      const scale = resCap > 0 && longEdge > resCap ? resCap / longEdge : 1;
      const dstW = Math.max(1, Math.round(srcW * scale));
      const dstH = Math.max(1, Math.round(srcH * scale));
      if (previewCanvas.width !== dstW || previewCanvas.height !== dstH) {
        previewCanvas.width = dstW;
        previewCanvas.height = dstH;
      }
      previewCtx.drawImage(mainCanvas, 0, 0, dstW, dstH);
    }
    previewAnimationFrame = requestAnimationFrame(updatePreview);
  }

  // Stop preview loop when VJ mode closes
  function stopPreviewLoop() {
    if (previewAnimationFrame !== null) {
      cancelAnimationFrame(previewAnimationFrame);
      previewAnimationFrame = null;
    }
  }

  // Watch for VJ mode open/close
  $: if ($vjClipLauncher.isOpen && previewCanvas) {
    previewCtx = previewCanvas.getContext('2d');
    startPreviewLoop();
  } else {
    stopPreviewLoop();
  }

  // Cleanup on destroy
  onDestroy(() => {
    stopPreviewLoop();
    stopModGhostLoop();
    if (vjRecorderHandle && vjIsRecording) {
      try { vjRecorderHandle.stop(); } catch {}
    }
  });

  // Blend modes
  const blendModes: BlendMode[] = [
    'normal',
    'add',
    'multiply',
    'screen',
    'overlay',
    'difference',
    'subtract',
    'darken',
    'lighten',
    'exclusion',
    'hardlight',
    'softlight',
    'color-dodge',
    'color-burn',
    'hue',
    'saturation',
    'color',
    'luminosity',
    'divide',
    'average',
    'negation',
    'phoenix',
    'linear-light',
    'hard-mix',
    'vivid-light',
    'pin-light',
  ];


  // Shader library
  interface ShaderItem {
    id: string;
    name: string;
    src: string;
    shaderCode: string;
    inputs: ISFInputDef[];
    values: Record<string, any>;
    thumbnail?: string;
  }

  let shaders: ShaderItem[] = [];
  let shadersLoading = true;

  // Recording state (shared recorder with audio support)
  let vjRecorderHandle: RecorderHandle | null = null;
  let vjIsRecording = false;
  let vjRecordingDuration = 0;

  function vjStartRecording() {
    vjRecordingDuration = 0;
    vjRecorderHandle = startRec({
      namePrefix: 'VJ Recording',
      onDurationUpdate: (s) => { vjRecordingDuration = s; },
      onComplete: () => { vjIsRecording = false; vjRecorderHandle = null; },
      onError: (err) => { alert('Failed to start recording: ' + err.message); },
    });
    if (vjRecorderHandle) {
      vjIsRecording = true;
    }
  }

  function vjStopRecording() {
    if (vjRecorderHandle) {
      vjRecorderHandle.stop();
      vjIsRecording = false;
      vjRecorderHandle = null;
    }
  }

  function formatVJRecordingDuration(seconds: number): string {
    return formatRecordingDuration(seconds);
  }

  // Drag state for clips
  let draggedClip: { type: 'shader' | 'video' | 'image' | 'threejs' | 'spout' | 'effect' | 'splat' | 'model3d'; id: string; spoutName?: string; pluginName?: string; effectType?: 'fluid' | 'particles' | 'splat' | 'model3d' } | null = null;
  let dragOverCell: { layer: number; column: number } | null = null;
  let dragSourceCell: { layer: number; column: number } | null = null;

  // Copy/paste state
  let clipboardClip: VJClip | null = null;
  let cellContextMenu: { x: number; y: number; layer: number; column: number } | null = null;
  // Clip-preview panel state — opened from the cell context menu's Edit/Preview item.
  let previewPanel: { layer: number; column: number; clip: VJClip } | null = null;

  // Drag state for layer reordering
  let draggedLayerIndex: number | null = null;
  let dragOverLayerIndex: number | null = null;

  // Selected layer for effects editing
  let selectedLayerIndex: number | null = null;
  // Keep vjClipLauncher store's selectedLayerIndex in sync so keyframe timeline can pick it up
  $: vjClipLauncher.setSelectedLayerIndex(selectedLayerIndex);

  // Media tab (matching mapping mode tabs)
  let vjMediaTab: 'shaders' | 'js' | 'library' | 'videos' | 'images' | 'sources' | 'plugins' = 'shaders';

  // AI generator state
  let vjShowAIGenerator = false;
  let vjShowVideoGenerator = false;

  // Shader params overlay visibility
  let showShaderParams = true;

  // Get the current effects list based on the active effects tab
  $: currentEffects = (() => {
    if (effectsTab === 'composition') {
      return $vjClipLauncher.compositionEffects;
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return [];
      const activeCol = $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return [];
      const clip = $vjClipLauncher.clipGrid[selectedLayerIndex][activeCol];
      return clip?.effects || [];
    } else {
      // layer
      return selectedLayerState?.effects || [];
    }
  })();

  // Get label for current effects tab context
  $: effectsTabLabel = (() => {
    if (effectsTab === 'composition') return 'COMPOSITION FX';
    if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return 'CLIP FX';
      const activeCol = $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn;
      const clip = activeCol !== null ? $vjClipLauncher.clipGrid[selectedLayerIndex][activeCol] : null;
      return clip ? `CLIP: ${clip.name}` : 'CLIP FX';
    }
    return selectedLayerIndex !== null ? `LAYER ${selectedLayerIndex + 1} FX` : 'LAYER FX';
  })();

  // Track active clip ID to force shader params re-render when clip changes
  $: activeClipId = selectedLayerIndex !== null ? $vjClipLauncher.layerStates[selectedLayerIndex]?.activeClip?.id : null;
  // Clear modulation & base values when the active clip/shader changes on the selected layer
  let _prevActiveClipId: string | null = null;
  $: {
    if (activeClipId !== _prevActiveClipId) {
      if (_prevActiveClipId !== null && selectedLayerIndex !== null) {
        // Clip changed — clear stale modulation assignments and base values
        modulationStore.clearLayer(selectedLayerIndex);
        clearBaseValues(selectedLayerIndex);
        clearModulatedValues(selectedLayerIndex);
      }
      _prevActiveClipId = activeClipId ?? null;
    }
  }
  // Force re-parse shader inputs when clip changes
  $: selectedClipShaderInputs = (() => {
    if (selectedLayerIndex === null) return [];
    // Reference activeClipId to make this reactive to clip changes
    void activeClipId;
    return getActiveShaderInputs(selectedLayerIndex);
  })();

  // Audio-ready badge: true if current shader uses audio uniforms
  $: clipIsAudioReady = (() => {
    if (selectedLayerIndex === null) return false;
    const clip = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeClip;
    return (clip as any)?._isAudioReady === true;
  })();

  // Saved items
  $: savedShaders = $shaderLibrary.shaders;
  $: savedVideos = $videoLibrary.videos;

  // --- Live Sources for VJ ---
  interface VJLiveSource {
    id: string;
    name: string;
    type: 'spout' | 'webcam' | 'capture';
    status: 'disconnected' | 'connecting' | 'live';
    stream?: MediaStream;
    videoEl?: HTMLVideoElement;
  }

  let vjLiveSources: VJLiveSource[] = [];

  async function vjStartWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const videoTrack = stream.getVideoTracks()[0];
      const label = videoTrack.label || 'Webcam';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();
      vjLiveSources = [...vjLiveSources, {
        id: crypto.randomUUID?.() || Date.now().toString(),
        name: label,
        type: 'webcam',
        status: 'live',
        stream,
        videoEl,
      }];
    } catch (err) {
      console.error('VJ webcam error:', err);
    }
  }

  async function vjStartCapture() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const videoTrack = stream.getVideoTracks()[0];
      const label = videoTrack.label || 'Screen Capture';
      const videoEl = document.createElement('video');
      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      await videoEl.play();
      const src: VJLiveSource = {
        id: crypto.randomUUID?.() || Date.now().toString(),
        name: label,
        type: 'capture',
        status: 'live',
        stream,
        videoEl,
      };
      videoTrack.onended = () => vjStopSource(src.id);
      vjLiveSources = [...vjLiveSources, src];
    } catch (err) {
      if ((err as any).name !== 'AbortError') console.error('VJ capture error:', err);
    }
  }

  function vjStopSource(id: string) {
    const s = vjLiveSources.find(s => s.id === id);
    if (s?.stream) s.stream.getTracks().forEach(t => t.stop());
    vjLiveSources = vjLiveSources.filter(s => s.id !== id);
  }

  // Three.js items (built-in)
  interface ThreeJSItem {
    id: string;
    name: string;
    src: string;
    thumbnail?: string;
  }

  const defaultThreeJSItems: ThreeJSItem[] = [
    {
      id: 'threejs-embryo',
      name: 'Embryo',
      src: '/threejs/embryo/index.html',
      thumbnail: undefined, // Will generate preview
    },
    {
      id: 'threejs-flow',
      name: 'Flow',
      src: '/threejs/flow/index-new.html',
      thumbnail: undefined,
    },
  ];

  let threejsItems: ThreeJSItem[] = [...defaultThreeJSItems];

  // Generate thumbnail from Three.js iframe
  async function generateThreeJSThumbnail(src: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position: absolute; left: -9999px; top: -9999px; width: 320px; height: 180px; border: none;';
      iframe.src = src;
      document.body.appendChild(iframe);

      // Give it time to render
      setTimeout(() => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeCanvas = iframeDoc.querySelector('canvas');
            if (iframeCanvas) {
              const thumbCanvas = document.createElement('canvas');
              thumbCanvas.width = 160;
              thumbCanvas.height = 90;
              const ctx = thumbCanvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(iframeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
                resolve(thumbCanvas.toDataURL('image/jpeg', 0.7));
              } else {
                resolve(undefined);
              }
            } else {
              resolve(undefined);
            }
          } else {
            resolve(undefined);
          }
        } catch (err) {
          // Cross-origin or other error
          console.warn('Could not generate Three.js thumbnail:', err);
          resolve(undefined);
        } finally {
          document.body.removeChild(iframe);
        }
      }, 2000); // Wait 2 seconds for Three.js to render
    });
  }

  // Load shaders on mount
  onMount(() => {
    const init = async () => {
      try {
        const response = await fetch('./ISF/manifest.json');
        const manifest = await response.json();

        const loadedShaders: ShaderItem[] = [];

        // Support both v1 (flat array) and v2 (objects with metadata) manifest formats
        const entries: Array<{ file: string; defaults?: Record<string, any> }> =
          manifest.version === 2
            ? manifest.shaders.filter((s: any) => s.enabled !== false)
            : manifest.shaders.map((f: string) => ({ file: f }));

        for (const entry of entries) {
          const filename = entry.file;
          try {
            const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
            const shaderResponse = await fetch(`./ISF/${encodedPath}`);
            const shaderCode = await shaderResponse.text();
            const parsed = parseISF(shaderCode);

            const shaderItem: ShaderItem = {
              id: generateUUID(),
              name: filename.replace('.fs', '').replace('DM-', ''),
              src: `./ISF/${encodedPath}`,
              shaderCode,
              inputs: parsed.metadata.INPUTS as ISFInputDef[],
              values: {},
            };

            for (const input of shaderItem.inputs) {
              if (input.TYPE !== 'image') {
                // Apply manifest default overrides if present
                const manifestDefault = entry.defaults?.[input.NAME];
                shaderItem.values[input.NAME] = manifestDefault !== undefined
                  ? manifestDefault
                  : getInputDefault(input);
              }
            }

            loadedShaders.push(shaderItem);
          } catch (err) {
            console.warn(`Failed to load shader ${filename}:`, err);
          }
        }

        shaders = loadedShaders;
        shadersLoading = false;

        // Generate shader thumbnails in background
        for (const shader of shaders) {
          try {
            shader.thumbnail = await generateShaderThumbnail(shader.shaderCode, 0.5);
            shaders = [...shaders];
          } catch (err) {}
        }

        // Generate Three.js thumbnails in background
        for (let i = 0; i < threejsItems.length; i++) {
          const item = threejsItems[i];
          if (!item.thumbnail) {
            try {
              const thumbnail = await generateThreeJSThumbnail(item.src);
              if (thumbnail) {
                threejsItems[i] = { ...item, thumbnail };
                threejsItems = [...threejsItems]; // Trigger reactivity
              }
            } catch (err) {}
          }
        }
      } catch (err) {
        console.error('Failed to load shaders:', err);
        shadersLoading = false;
      }
    };

    init();

    // Listen for MIDI macro events (dispatched by midiRouter for component-local macro state)
    const handleMidiMacro = (e: Event) => {
      const { macro, value } = (e as CustomEvent).detail;
      if (macro === 1) onVJMacro1Change(value);
      else if (macro === 2) onVJMacro2Change(value);
    };
    window.addEventListener('midi-vj-macro', handleMidiMacro);

    return () => {
      window.removeEventListener('midi-vj-macro', handleMidiMacro);
    };
  });

  // === Audio State ===
  async function setAudioSource(source: 'none' | 'microphone' | 'system') {
    if (source === 'none') {
      await audioStore.stop();
    } else if (source === 'microphone') {
      await audioStore.stop();
      await audioStore.startMicrophone();
    } else if (source === 'system') {
      await audioStore.stop();
      await audioStore.startSystemAudio();
    }
  }

  function handleTapTempo() {
    audioStore.tapTempo();
  }

  function clearTapTempo() {
    audioStore.clearManualBPM();
  }

  // Close VJ mode
  function closeVJMode() {
    console.log('[VJPanel] closeVJMode: start');
    modulationEngine.stop();
    performanceStore.stop();
    // Clear synthvision clips from VJ grid FIRST (while VJ is still live)
    // so Canvas properly disposes the stale canvas textures
    vjClipLauncher.clearSynthVisionClips();
    console.log('[VJPanel] closeVJMode: synthvision clips cleared');
    // Destroy SynthVision component
    showPerformer = false;
    performerStarted = false;
    console.log('[VJPanel] closeVJMode: performer destroyed');
    // Now close VJ — layers are clean, no stale performer texture
    vjClipLauncher.setLive(false);
    vjClipLauncher.setOpen(false);
    console.log('[VJPanel] closeVJMode: VJ closed');
  }

  // Minimize VJ mode (keep live output running)
  function minimizeVJMode() {
    vjClipLauncher.setOpen(false);
    // isLive stays true — VJ output continues
  }

  // === Shader Parameter Controls ===
  // Cache parsed ISF inputs per shader code hash to avoid re-parsing every frame
  let cachedShaderInputs: Map<string, ISFInput[]> = new Map();

  function getActiveShaderInputs(layerIndex: number): ISFInput[] {
    const clip = $vjClipLauncher.layerStates[layerIndex]?.activeClip;
    if (!clip || clip.type !== 'shader' || !clip.shaderCode) return [];

    // Use clip ID + first 64 chars as cache key to distinguish different shaders
    const cacheKey = clip.id + ':' + clip.shaderCode.substring(0, 64);
    if (cachedShaderInputs.has(cacheKey)) {
      return cachedShaderInputs.get(cacheKey)!;
    }

    // Parse the ISF metadata from shader code
    try {
      const parsed = parseISF(clip.shaderCode);
      const inputs = parsed.metadata.INPUTS.filter(
        i => i.TYPE !== 'image' && i.TYPE !== 'audio' && i.TYPE !== 'audioFFT'
      );
      cachedShaderInputs.set(cacheKey, inputs);
      // Register param ranges for modulation clamping
      registerParamRanges(layerIndex, inputs);
      // Ensure all float/long params have their DEFAULT written to shaderValues
      // so modulation can find a base value even if the user hasn't moved the slider
      for (const inp of inputs) {
        if ((inp.TYPE === 'float' || inp.TYPE === 'long') && inp.DEFAULT !== undefined) {
          const current = clip.shaderValues?.[inp.NAME];
          if (current === undefined) {
            vjClipLauncher.updateActiveClipShaderValue(layerIndex, inp.NAME, inp.DEFAULT as number);
          }
        }
      }
      // Store audio-ready flag on the clip for UI badges
      if (clip.shaderCode) {
        (clip as any)._isAudioReady = parsed.isAudioReady;
      }
      return inputs;
    } catch {
      return [];
    }
  }

  function getShaderParamValue(layerIndex: number, paramName: string, defaultValue: number): number {
    const clip = $vjClipLauncher.layerStates[layerIndex]?.activeClip;
    if (!clip || !clip.shaderValues) return defaultValue;
    const val = clip.shaderValues[paramName];
    return typeof val === 'number' ? val : defaultValue;
  }

  function setShaderParamValue(layerIndex: number, paramName: string, value: number) {
    vjClipLauncher.updateActiveClipShaderValue(layerIndex, paramName, value);
    setBaseValue(layerIndex, paramName, value); // Keep modulation base in sync with slider
  }

  // Modulation helpers — thin wrappers using shared functions from modulation.ts
  function getParamModulation(layerIndex: number, paramName: string): ParamModulation | undefined {
    return modulationStore.getModulation(layerIndex, paramName);
  }
  // setParamModSource and setParamModAmount imported from '../audio/modulation'

  // Live modulated values for ghost indicator on sliders
  let modGhostValues: Record<string, number> = {};
  let modGhostRaf: number | null = null;

  function startModGhostLoop() {
    if (modGhostRaf !== null) return;
    const tick = () => {
      if (selectedLayerIndex === null || !showShaderParams) {
        modGhostValues = {};
        modGhostRaf = null;
        return;
      }
      const newVals: Record<string, number> = {};
      for (const input of selectedClipShaderInputs) {
        const v = getModulatedValue(selectedLayerIndex, input.NAME);
        if (v !== null) newVals[input.NAME] = v;
      }
      modGhostValues = newVals;
      modGhostRaf = requestAnimationFrame(tick);
    };
    modGhostRaf = requestAnimationFrame(tick);
  }

  function stopModGhostLoop() {
    if (modGhostRaf !== null) {
      cancelAnimationFrame(modGhostRaf);
      modGhostRaf = null;
    }
    modGhostValues = {};
  }

  // Start/stop ghost loop when shader params panel is visible
  $: if (showShaderParams && selectedLayerIndex !== null) {
    startModGhostLoop();
  } else {
    stopModGhostLoop();
  }

  // Drag handlers
  function handleDragStart(e: DragEvent, clip: { type: 'shader' | 'video' | 'image' | 'threejs' | 'spout' | 'effect' | 'splat' | 'model3d'; id: string; spoutName?: string; pluginName?: string; effectType?: 'fluid' | 'particles' | 'splat' | 'model3d' }) {
    draggedClip = clip;
    // Electron/Chromium requires dataTransfer.setData() for drag to work
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify(clip));
    }
  }

  function handleDragEnd() {
    draggedClip = null;
    dragOverCell = null;
    dragSourceCell = null;
  }

  // ─── VJ Media Library File Import (drag/drop + file picker) ────────
  let vjMediaFileInput: HTMLInputElement | null = null;
  let vjMediaDragOver = false;

  function vjMediaGetType(file: File): 'video' | 'image' | 'shader' | null {
    const n = file.name.toLowerCase();
    if (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(n)) return 'video';
    if (file.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(n)) return 'image';
    if (/\.(fs|isf)$/i.test(n)) return 'shader';
    return null;
  }

  async function vjCaptureVideoThumb(video: HTMLVideoElement): Promise<string> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        video.onseeked = null;
        resolve(value);
      };
      const grab = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 120; canvas.height = 68;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            finish(canvas.toDataURL('image/jpeg', 0.7));
          } else {
            finish('');
          }
        } catch (err) {
          console.warn('[VJ Media] Thumbnail capture skipped:', err);
          finish('');
        }
      };
      if (video.readyState >= 2) { video.currentTime = 0.1; video.onseeked = grab; setTimeout(() => { if (video.onseeked) grab(); }, 300); }
      else { video.onloadeddata = () => { video.currentTime = 0.1; video.onseeked = grab; }; }
    });
  }

  async function vjAddMediaFile(file: File) {
    const kind = vjMediaGetType(file);
    if (!kind) { console.warn('[VJ Media] Unsupported file type:', file.name); return; }
    if (kind === 'video') {
      const localMedia = await createSharedMediaUrl(file);
      const url = localMedia.url;
      const video = document.createElement('video');
      if (shouldUseAnonymousCrossOrigin(url)) video.crossOrigin = 'anonymous';
      video.loop = true; video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.src = url;
      // `.src=` setter already initiated the load. Don't call `.load()`.
      await new Promise<void>((resolve) => {
        const done = () => { video.removeEventListener('loadeddata', done); video.removeEventListener('error', done); resolve(); };
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener('error', done, { once: true });
        if (video.readyState >= 2) done();
      });
      mediaLibrary.addItem({
        id: generateUUID(),
        name: file.name,
        src: url,
        localPath: localMedia.localPath,
        type: 'video',
        videoElement: video,
        thumbnail: await vjCaptureVideoThumb(video),
      } as any);
    } else if (kind === 'image') {
      const url = URL.createObjectURL(file);
      mediaLibrary.addItem({
        id: generateUUID(),
        name: file.name,
        src: url,
        type: 'image',
        thumbnail: url,
      } as any);
    }
  }

  async function vjHandleMediaDrop(e: DragEvent) {
    e.preventDefault();
    vjMediaDragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) { await vjAddMediaFile(f); }
  }

  function vjHandleMediaDragOver(e: DragEvent) {
    e.preventDefault();
    // Only show overlay for actual file drops, not clip drags from the grid
    if (e.dataTransfer?.types.includes('Files')) vjMediaDragOver = true;
  }

  function vjHandleMediaDragLeave(e: DragEvent) {
    // Only clear when leaving the outer container
    if ((e.currentTarget as HTMLElement) === e.target) vjMediaDragOver = false;
  }

  async function vjHandleMediaFilePick(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    for (const f of Array.from(files)) { await vjAddMediaFile(f); }
    input.value = '';
  }

  function handleClipCellDragStart(e: DragEvent, layerIndex: number, columnIndex: number) {
    const clip = $vjClipLauncher.clipGrid[layerIndex]?.[columnIndex];
    if (!clip || !e.dataTransfer) return;
    dragSourceCell = { layer: layerIndex, column: columnIndex };
    draggedClip = { type: clip.type as any, id: clip.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'cell-move');
  }

  function handleCellDragOver(e: DragEvent, layerIndex: number, columnIndex: number) {
    e.preventDefault();
    dragOverCell = { layer: layerIndex, column: columnIndex };
  }

  function handleCellDragLeave() {
    dragOverCell = null;
  }

  // File loading helper for splat/model3d VJ clips
  function fileToDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function triggerVJFileLoad(layerIndex: number, columnIndex: number, type: 'splat' | 'model3d') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'splat' ? '.ply,.splat' : '.glb,.gltf,.obj,.fbx';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const localPath = getPathForFile(file);

      // Capture the outgoing clip's blob URL (if any) so we can revoke after
      // the swap. Without this, overwriting a 500MB .ply on a cell accumulates
      // the old blob forever — a 4-hour set cycling through clips accumulates
      // gigabytes in renderer heap.
      const existing = $vjClipLauncher.clipGrid[layerIndex]?.[columnIndex] as any;
      const priorBlobUrl: string | null =
        existing?.splatContent?.filePath && existing.splatContent.filePath.startsWith('blob:')
          ? existing.splatContent.filePath
          : existing?.model3dContent?.modelData && existing.model3dContent.modelData.startsWith?.('blob:')
          ? existing.model3dContent.modelData
          : null;

      if (type === 'splat') {
        const sourceUrl = localPath || URL.createObjectURL(file);
        const isSplatFormat = file.name.toLowerCase().endsWith('.splat');
        vjClipLauncher.updateClipSplatContent(layerIndex, columnIndex, {
          filePath: sourceUrl,
          dataType: isSplatFormat ? 'gaussian' : 'pointcloud',
          _originalFileName: file.name,  // Pass filename so Canvas can detect .splat format
          _originalFilePath: localPath || undefined,
          _sourceVersion: Date.now(),
        } as any);
        vjClipLauncher.setClip(layerIndex, columnIndex, {
          ...($vjClipLauncher.clipGrid[layerIndex]?.[columnIndex] as VJClip),
          name: file.name.replace(/\.[^.]+$/, ''),
        });
      } else {
        const modelSource = localPath || URL.createObjectURL(file);
        const ext = file.name.split('.').pop()?.toLowerCase() || 'glb';
        vjClipLauncher.updateClipModel3DContent(layerIndex, columnIndex, {
          modelData: modelSource,
          modelFormat: ext as Model3DFormat,
          modelName: file.name,
          _originalFilePath: localPath || undefined,
          _sourceVersion: Date.now(),
        });
        vjClipLauncher.setClip(layerIndex, columnIndex, {
          ...($vjClipLauncher.clipGrid[layerIndex]?.[columnIndex] as VJClip),
          name: file.name.replace(/\.[^.]+$/, ''),
        });
      }

      // Revoke after a short tick — gives Canvas a frame to swap in the new
      // texture before we yank the old one from memory.
      if (priorBlobUrl) {
        setTimeout(() => { try { URL.revokeObjectURL(priorBlobUrl); } catch {} }, 500);
      }
    };
    input.click();
  }

  // Re-trigger file load for existing splat/model3d clip (right-click or double-click)
  function reloadVJClipFile(layerIndex: number, columnIndex: number) {
    const clip = $vjClipLauncher.clipGrid[layerIndex]?.[columnIndex];
    if (!clip) return;
    if (clip.type === 'splat' || clip.type === 'model3d') {
      triggerVJFileLoad(layerIndex, columnIndex, clip.type);
    }
  }

  function handleCellDrop(e: DragEvent, layerIndex: number, columnIndex: number) {
    e.preventDefault();
    dragOverCell = null;

    // Cell-to-cell move
    if (dragSourceCell) {
      const srcClip = $vjClipLauncher.clipGrid[dragSourceCell.layer]?.[dragSourceCell.column];
      if (srcClip && (dragSourceCell.layer !== layerIndex || dragSourceCell.column !== columnIndex)) {
        const movedClip: VJClip = { ...srcClip, id: generateUUID() };
        vjClipLauncher.setClip(layerIndex, columnIndex, movedClip);
        vjClipLauncher.clearClip(dragSourceCell.layer, dragSourceCell.column);
      }
      dragSourceCell = null;
      draggedClip = null;
      return;
    }

    if (!draggedClip) return;

    if (draggedClip.type === 'shader') {
      const shader = shaders.find(s => s.id === draggedClip!.id);
      if (shader) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: 'shader',
          name: shader.name,
          src: shader.src,
          thumbnail: shader.thumbnail,
          shaderCode: shader.shaderCode,
          shaderValues: { ...shader.values },
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
      }
    } else if (draggedClip.type === 'threejs') {
      const threejsItem = threejsItems.find(t => t.id === draggedClip!.id);
      if (threejsItem) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: 'threejs',
          name: threejsItem.name,
          src: threejsItem.src,
          thumbnail: threejsItem.thumbnail,
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
      }
    } else if (draggedClip.type === 'spout') {
      // Legacy texture-sharing clips import as inert placeholders in Community.
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'spout',
        name: draggedClip.pluginName || draggedClip.id,
        src: draggedClip.spoutName || draggedClip.id,
        spoutSource: draggedClip.spoutName,
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
    } else if (draggedClip.type === 'effect') {
      // Handle integrated effect (FluidGen, Particles3D running natively)
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'effect',
        name: draggedClip.pluginName || draggedClip.id,
        src: draggedClip.effectType || 'fluid',
        effectSource: {
          effectType: draggedClip.effectType || 'fluid',
        },
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
    } else if (draggedClip.type === 'splat') {
      // Handle point cloud / splat clip
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'splat',
        name: draggedClip.pluginName || 'Point Cloud',
        src: '',
        splatContent: createDefaultSplatContent(),
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
      // Trigger file picker for PLY file
      triggerVJFileLoad(layerIndex, columnIndex, 'splat');
    } else if (draggedClip.type === 'model3d') {
      // Handle 3D model clip
      const vjClip: VJClip = {
        id: generateUUID(),
        type: 'model3d',
        name: draggedClip.pluginName || '3D Model',
        src: '',
        model3dContent: createDefaultModel3DContent(),
      };
      vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
      // Trigger file picker for 3D model file
      triggerVJFileLoad(layerIndex, columnIndex, 'model3d');
    } else {
      const media = $mediaLibrary.find(m => m.id === draggedClip!.id);
      if (media) {
        const vjClip: VJClip = {
          id: generateUUID(),
          type: draggedClip.type,
          name: media.name,
          src: media.src,
          localPath: media.localPath,
          thumbnail: media.thumbnail,
        };
        vjClipLauncher.setClip(layerIndex, columnIndex, vjClip);
      }
    }

    // Don't auto-trigger - user clicks to play
    draggedClip = null;
  }

  // Click on clip cell to trigger it and auto-select layer for shader params
  function handleCellClick(layerIndex: number, columnIndex: number) {
    vjClipLauncher.triggerClip(layerIndex, columnIndex);
    // Auto-select this layer so shader params show
    selectedLayerIndex = layerIndex;
    showShaderParams = true;
  }

  // Clear a clip from cell
  function handleClearClip(layerIndex: number, columnIndex: number, e: Event) {
    e.stopPropagation();
    vjClipLauncher.clearClip(layerIndex, columnIndex);
  }

  // Trigger entire column
  function handleColumnTrigger(columnIndex: number) {
    vjClipLauncher.triggerColumn(columnIndex);
  }

  // Stop layer
  function handleStopLayer(layerIndex: number) {
    vjClipLauncher.stopLayer(layerIndex);
  }

  // Stop all
  function handleStopAll() {
    vjClipLauncher.stopAll();
  }

  // Context menu for clip cells
  function handleCellContextMenu(e: MouseEvent, layerIndex: number, columnIndex: number) {
    e.preventDefault();
    cellContextMenu = { x: e.clientX, y: e.clientY, layer: layerIndex, column: columnIndex };
  }

  function closeCellContextMenu() {
    cellContextMenu = null;
  }

  function copyClipToClipboard() {
    if (!cellContextMenu) return;
    const clip = $vjClipLauncher.clipGrid[cellContextMenu.layer]?.[cellContextMenu.column];
    if (clip) clipboardClip = { ...clip };
    cellContextMenu = null;
  }

  function pasteClipFromClipboard() {
    if (!cellContextMenu || !clipboardClip) return;
    const pasted: VJClip = { ...clipboardClip, id: generateUUID() };
    vjClipLauncher.setClip(cellContextMenu.layer, cellContextMenu.column, pasted);
    cellContextMenu = null;
  }

  function openClipPreview() {
    if (!cellContextMenu) return;
    const clip = $vjClipLauncher.clipGrid[cellContextMenu.layer]?.[cellContextMenu.column];
    if (!clip) return;
    previewPanel = { layer: cellContextMenu.layer, column: cellContextMenu.column, clip };
    cellContextMenu = null;
  }

  function clearClipFromMenu() {
    if (!cellContextMenu) return;
    vjClipLauncher.clearClip(cellContextMenu.layer, cellContextMenu.column);
    cellContextMenu = null;
  }

  // Layer controls
  function handleLayerOpacityChange(layerIndex: number, e: Event) {
    markUserInteracting(`vj:${layerIndex}:opacity`);
    const value = parseFloat((e.target as HTMLInputElement).value);
    vjClipLauncher.setLayerOpacity(layerIndex, value);
  }

  function handleLayerBlendChange(layerIndex: number, e: Event) {
    const value = (e.target as HTMLSelectElement).value as BlendMode;
    vjClipLauncher.setLayerBlendMode(layerIndex, value);
  }

  function handleToggleSolo(layerIndex: number) {
    vjClipLauncher.toggleLayerSolo(layerIndex);
  }

  function handleToggleMute(layerIndex: number) {
    vjClipLauncher.toggleLayerMute(layerIndex);
  }

  // Master opacity
  function handleMasterOpacityChange(e: Event) {
    markUserInteracting('vj:master:opacity');
    const value = parseFloat((e.target as HTMLInputElement).value);
    vjClipLauncher.setMasterOpacity(value);
  }

  // Select layer for shader params editing
  function selectLayerForEffects(layerIndex: number) {
    selectedLayerIndex = selectedLayerIndex === layerIndex ? null : layerIndex;
    // Re-show shader params when selecting a new layer
    if (selectedLayerIndex !== null) {
      showShaderParams = true;
    }
  }

  // Block management handlers
  function handleAddBlock() {
    vjClipLauncher.addBlock();
  }

  function handleSelectBlock(blockId: string) {
    vjClipLauncher.setActiveBlock(blockId);
  }

  function startEditingBlock(block: VJBlock, e: MouseEvent) {
    e.stopPropagation();
    editingBlockId = block.id;
    editingBlockName = block.name;
    // Focus the input after render
    setTimeout(() => blockInputEl?.focus(), 0);
  }

  function finishEditingBlock() {
    if (editingBlockId && editingBlockName.trim()) {
      vjClipLauncher.renameBlock(editingBlockId, editingBlockName.trim());
    }
    editingBlockId = null;
    editingBlockName = '';
  }

  function handleBlockKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditingBlock();
    } else if (e.key === 'Escape') {
      editingBlockId = null;
      editingBlockName = '';
    }
  }

  function handleDeleteBlock(blockId: string, e: MouseEvent) {
    e.stopPropagation();
    vjClipLauncher.deleteBlock(blockId);
  }

  // Layer drag handlers for reordering
  function handleLayerDragStart(layerIndex: number, e: DragEvent) {
    draggedLayerIndex = layerIndex;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layerIndex.toString());
    }
  }

  function handleLayerDragEnd() {
    draggedLayerIndex = null;
    dragOverLayerIndex = null;
  }

  function handleLayerDragOver(layerIndex: number, e: DragEvent) {
    e.preventDefault();
    if (draggedLayerIndex !== null && draggedLayerIndex !== layerIndex) {
      dragOverLayerIndex = layerIndex;
    }
  }

  function handleLayerDragLeave() {
    dragOverLayerIndex = null;
  }

  function handleLayerDrop(layerIndex: number, e: DragEvent) {
    e.preventDefault();
    if (draggedLayerIndex !== null && draggedLayerIndex !== layerIndex) {
      vjClipLauncher.reorderLayers(draggedLayerIndex, layerIndex);
    }
    draggedLayerIndex = null;
    dragOverLayerIndex = null;
  }

  // Handle multi-add from the effect picker modal
  function handlePickerAdd(types: EffectType[]) {
    for (const type of types) {
      addEffect(type);
    }
    showEffectPicker = false;
  }

  // Effect management
  function addEffect(type: EffectType) {
    const newEffect: Effect = {
      id: generateUUID(),
      type,
      enabled: true,
      params: getRendererDefaultEffectParams(type),
    };
    if (effectsTab === 'composition') {
      vjClipLauncher.addCompositionEffect(newEffect);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.addClipEffect(selectedLayerIndex, activeCol, newEffect);
    } else {
      // layer
      if (selectedLayerIndex === null) return;
      vjClipLauncher.addLayerEffect(selectedLayerIndex, newEffect);
    }
  }

  function toggleEffect(effectId: string) {
    if (effectsTab === 'composition') {
      vjClipLauncher.toggleCompositionEffect(effectId);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.toggleClipEffect(selectedLayerIndex, activeCol, effectId);
    } else {
      if (selectedLayerIndex === null) return;
      vjClipLauncher.toggleLayerEffect(selectedLayerIndex, effectId);
    }
  }

  function deleteEffect(effectId: string) {
    if (effectsTab === 'composition') {
      vjClipLauncher.removeCompositionEffect(effectId);
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.removeClipEffect(selectedLayerIndex, activeCol, effectId);
    } else {
      if (selectedLayerIndex === null) return;
      vjClipLauncher.removeLayerEffect(selectedLayerIndex, effectId);
    }
    expandedEffectId = null;
  }

  function updateEffectParam(effectId: string, paramName: string, value: number | boolean) {
    if (effectsTab === 'composition') {
      vjClipLauncher.updateCompositionEffectParams(effectId, { [paramName]: value });
    } else if (effectsTab === 'clip') {
      if (selectedLayerIndex === null) return;
      const activeCol = $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn;
      if (activeCol === null) return;
      vjClipLauncher.updateClipEffectParams(selectedLayerIndex, activeCol, effectId, { [paramName]: value });
    } else {
      if (selectedLayerIndex === null) return;
      vjClipLauncher.updateLayerEffectParams(selectedLayerIndex, effectId, { [paramName]: value });
    }
  }

  function applyVJPreset(effect: Effect) {
    const raw = vjPresetSelection[effect.id];
    if (raw === undefined || raw === '') return;
    const idx = parseInt(raw, 10);
    if (Number.isNaN(idx)) return;
    const patch = applyPresetToEffect(effect, idx);
    if (!patch) return;
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === 'number' || typeof v === 'boolean') {
        updateEffectParam(effect.id, k, v);
      }
    }
  }

  function applyVJMacroValue(effectId: string, which: 'm1' | 'm2', value: number) {
    const binding = vjMacroBindings[effectId]?.[which];
    if (!binding) return;
    updateEffectParam(effectId, binding, value);
  }

  function onVJMacro1Change(v: number) {
    vjMacro1 = v;
    for (const eff of currentEffects) applyVJMacroValue(eff.id, 'm1', v);
  }

  function onVJMacro2Change(v: number) {
    vjMacro2 = v;
    for (const eff of currentEffects) applyVJMacroValue(eff.id, 'm2', v);
  }

  // Get filtered media based on active tab.
  //
  // Memoized per-tab: the previous implementation walked the full `$mediaLibrary`
  // twice (video+image filter), mapped shaders, and mapped threejsItems on every
  // reactive tick — including every audio-frame tick — even when the user was
  // on a single tab that only needed one of the four source arrays. With audio
  // running that was ~60 × (2N+M+K) allocations/second. Now we only do the work
  // for the currently-selected tab, and only when its source changed.
  let _vjMediaVideos: any[] = [];
  let _vjMediaImages: any[] = [];
  let _vjMediaShaders: any[] = [];
  let _vjMediaThreejs: any[] = [];
  let _vjMediaLib: any = null;
  let _vjMediaShadersSrc: any = null;
  let _vjMediaThreejsSrc: any = null;

  $: {
    // $mediaLibrary changed → refresh the video/image-derived slices
    if ($mediaLibrary !== _vjMediaLib) {
      _vjMediaLib = $mediaLibrary;
      _vjMediaVideos = $mediaLibrary
        .filter(m => m.type === 'video')
        .map(m => ({ ...m, itemType: 'video' as const }));
      _vjMediaImages = $mediaLibrary
        .filter(m => m.type === 'image')
        .map(m => ({ ...m, itemType: 'image' as const }));
    }
    if (shaders !== _vjMediaShadersSrc) {
      _vjMediaShadersSrc = shaders;
      _vjMediaShaders = shaders.map(s => ({
        id: s.id, name: s.name, thumbnail: s.thumbnail, src: s.src,
        itemType: 'shader' as const,
      }));
    }
    if (threejsItems !== _vjMediaThreejsSrc) {
      _vjMediaThreejsSrc = threejsItems;
      _vjMediaThreejs = threejsItems.map(t => ({
        id: t.id, name: t.name, thumbnail: t.thumbnail, src: t.src,
        itemType: 'threejs' as const,
      }));
    }
  }

  $: vjFilteredMedia =
      vjMediaTab === 'videos' ? _vjMediaVideos
    : vjMediaTab === 'images' ? _vjMediaImages
    : vjMediaTab === 'shaders' ? _vjMediaShaders
    : vjMediaTab === 'js' ? _vjMediaThreejs
    : [..._vjMediaShaders, ..._vjMediaThreejs, ..._vjMediaVideos, ..._vjMediaImages];

  // Handle AI generated shader in VJ mode
  function handleVJAIGenerated() {
    vjShowAIGenerator = false;
  }

  // Handle AI generated video in VJ mode — add the clip to the media
  // library (shared with mapping mode) so it shows up in the Vid tab
  // immediately with a thumbnail, and persist to IndexedDB for the
  // Saved tab. Mirrors MediaTray.handleAIVideoGenerated.
  async function handleVJAIVideoGenerated(event: CustomEvent<{ id: string; name: string; src: string; blob: Blob }>) {
    const { id, name, src, blob } = event.detail || ({} as any);

    vjShowVideoGenerator = false;
    vjMediaTab = 'videos';

    if (!blob) {
      console.warn('[VJ AI Video] no blob in event.detail');
      return;
    }

    const videoBlob = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(videoBlob);

    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = blobUrl;

    mediaLibrary.addItem({
      id,
      name,
      src: blobUrl,
      type: 'video',
      videoElement: video,
      thumbnail: '',
    } as any);

    // `.src=` setter already started the load — don't call `.load()`.
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      video.oncanplaythrough = done;
      video.onloadeddata = done;
      video.onerror = done;
      if (video.readyState >= 2) done();
      setTimeout(done, 5000);
    });

    let thumbnail = '';
    try {
      await video.play().catch(() => {});
      await new Promise(r => setTimeout(r, 120));
      video.pause();
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (ctx && video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      }
      video.currentTime = 0;
    } catch (e) {
      console.warn('[VJ AI Video] thumbnail capture failed:', e);
    }

    if (thumbnail) {
      try { mediaLibrary.updateItem(id, { thumbnail }); } catch {}
    }

    try {
      const promptText = (name || '').replace(/^AI:\s*/, '');
      await videoLibrary.addVideo({
        name: name || 'AI Video',
        prompt: promptText,
        thumbnail,
        blob: videoBlob,
      });
    } catch (e) {
      console.warn('[VJ AI Video] videoLibrary.addVideo failed:', e);
    }

    if (src && src !== blobUrl) {
      try { URL.revokeObjectURL(src); } catch {}
    }
  }

  // Get selected layer effects
  $: selectedLayerState = selectedLayerIndex !== null ? $vjClipLauncher.layerStates[selectedLayerIndex] : null;

  // ─── VJ Video Controls (full LayerPanel-mapping-mode parity) ──────────
  // Mirrors LayerPanel.svelte's mapping-mode video controls. Refreshed
  // by a requestAnimationFrame tick whenever the active clip is a video
  // so the timeline + time readout stay live without forcing store
  // updates 60×/sec.
  let vjVideoCurrentTime = 0;
  let vjVideoDuration = 0;
  let vjTrimDragging: 'start' | 'end' | null = null;
  let vjTimelineScrubbing = false;
  let vjTimelineEl: HTMLDivElement | null = null;
  let vjVideoTickFrame: number | null = null;

  function vjFormatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function startVjVideoTick() {
    if (vjVideoTickFrame !== null) return;
    function tick() {
      const clip = selectedLayerState?.activeClip;
      const v = clip?.videoElement;
      if (clip?.type === 'video' && v) {
        vjVideoCurrentTime = v.currentTime;
        vjVideoDuration = v.duration || 0;
      }
      vjVideoTickFrame = requestAnimationFrame(tick);
    }
    tick();
  }

  function stopVjVideoTick() {
    if (vjVideoTickFrame !== null) {
      cancelAnimationFrame(vjVideoTickFrame);
      vjVideoTickFrame = null;
    }
  }

  $: {
    const _activeClip = selectedLayerState?.activeClip;
    if (_activeClip?.type === 'video' && _activeClip.videoElement) {
      startVjVideoTick();
    } else {
      stopVjVideoTick();
      vjVideoCurrentTime = 0;
      vjVideoDuration = 0;
    }
  }

  onDestroy(() => stopVjVideoTick());

  function vjSeekToPosition(e: MouseEvent, vEl: HTMLVideoElement) {
    if (!vjTimelineEl || !vEl) return;
    const rect = vjTimelineEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    // Clamp to active trim region — the per-frame loop pulls currentTime
    // back to trimStart anyway, but clamping here avoids visual snap-back.
    const clip = selectedLayerState?.activeClip;
    const trimS = clip?.trimStart ?? 0;
    const trimE = clip?.trimEnd ?? 1;
    const clamped = Math.max(trimS, Math.min(trimE, pct));
    try { vEl.currentTime = clamped * (vEl.duration || 0); } catch { /* mid-load */ }
  }

  function vjHandleTimelineMouseDown(e: MouseEvent, vEl: HTMLVideoElement) {
    if (!vjTimelineEl || !vEl) return;
    e.stopPropagation();
    vjTimelineScrubbing = true;
    vjSeekToPosition(e, vEl);
    const onMove = (me: MouseEvent) => vjSeekToPosition(me, vEl);
    const onUp = () => {
      vjTimelineScrubbing = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function vjHandleTrimMouseDown(e: MouseEvent, which: 'start' | 'end', layerIdx: number) {
    e.stopPropagation();
    e.preventDefault();
    vjTrimDragging = which;
    const onMove = (me: MouseEvent) => {
      if (!vjTimelineEl) return;
      const rect = vjTimelineEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / (rect.width || 1)));
      const clip = $vjClipLauncher.layerStates[layerIdx]?.activeClip;
      if (!clip) return;
      const trimS = clip.trimStart ?? 0;
      const trimE = clip.trimEnd ?? 1;
      const updates: { trimStart?: number; trimEnd?: number } = {};
      if (which === 'start') updates.trimStart = Math.min(pct, trimE - 0.02);
      else updates.trimEnd = Math.max(pct, trimS + 0.02);
      vjClipLauncher.updateActiveClipVideoProps(layerIdx, updates);
    };
    const onUp = () => {
      vjTrimDragging = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function vjSetVideoPlaying(layerIdx: number, playing: boolean) {
    const clip = $vjClipLauncher.layerStates[layerIdx]?.activeClip;
    const v = clip?.videoElement;
    if (!clip || !v) return;
    if (playing) v.play().catch(() => {}); else v.pause();
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, { isPlaying: playing });
  }

  function vjRestartVideo(layerIdx: number) {
    const clip = $vjClipLauncher.layerStates[layerIdx]?.activeClip;
    const v = clip?.videoElement;
    if (!clip || !v) return;
    try { v.currentTime = (clip.trimStart ?? 0) * (v.duration || 0); } catch {}
    v.play().catch(() => {});
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, { isPlaying: true });
  }

  function vjSetPlaybackRate(layerIdx: number, rate: number) {
    const clip = $vjClipLauncher.layerStates[layerIdx]?.activeClip;
    const v = clip?.videoElement;
    if (!clip) return;
    if (v) v.playbackRate = rate;
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, { playbackRate: rate });
  }

  function vjSetPlaybackMode(layerIdx: number, mode: 'loop' | 'once') {
    const clip = $vjClipLauncher.layerStates[layerIdx]?.activeClip;
    if (!clip) return;
    vjClipLauncher.updateActiveClipVideoProps(layerIdx, { playbackMode: mode });
  }
</script>

<!-- VJ Mode Full Overlay -->
<svelte:window onclick={(e) => { const t = e.target as HTMLElement; if (vjFileMenuOpen && !t.closest?.('.vj-file-menu-container')) vjFileMenuOpen = false; }} />

{#if $vjClipLauncher.isOpen}
  <div class="vj-overlay" class:kf-tray-open={$keyframeTimeline.isOpen}>
    <!-- Header -->
    <div class="vj-header">
      <div class="header-left">
        <img src="{import.meta.env.BASE_URL}logo.png" alt="Ghost Arcade" class="vj-logo" />
        <!-- File Menu -->
        <div class="vj-file-menu-container">
          <button class="vj-file-menu-btn" class:active={vjFileMenuOpen} onclick={() => vjFileMenuOpen = !vjFileMenuOpen}>
            File
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
          </button>
          {#if vjFileMenuOpen}
            <div class="vj-file-menu-dropdown">
              <button class="vj-menu-item" onclick={() => vjFileAction('new')}>New<span class="vj-menu-sc">Ctrl+N</span></button>
              <button class="vj-menu-item" onclick={() => vjFileAction('open')}>Open...<span class="vj-menu-sc">Ctrl+O</span></button>
              <div class="vj-menu-sep"></div>
              <button class="vj-menu-item" onclick={() => vjFileAction('save')}>Save<span class="vj-menu-sc">Ctrl+S</span></button>
              <button class="vj-menu-item" onclick={() => vjFileAction('saveAs')}>Save As...<span class="vj-menu-sc">Ctrl+Shift+S</span></button>
              <div class="vj-menu-sep"></div>
              <button class="vj-menu-item" onclick={() => vjFileAction('importPresets')}>Import Presets...</button>
              <div class="vj-menu-sep"></div>
              <button class="vj-menu-item" onclick={() => vjFileAction('undo')}>Undo<span class="vj-menu-sc">Ctrl+Z</span></button>
              <button class="vj-menu-item" onclick={() => vjFileAction('redo')}>Redo<span class="vj-menu-sc">Ctrl+Y</span></button>
            </div>
          {/if}
        </div>
        <div class="live-indicator" class:active={$vjClipLauncher.isLive}>
          <span class="live-dot"></span>
          <span>LIVE</span>
        </div>
        <div class="master-control">
          <span class="master-label">MASTER</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={$vjClipLauncher.masterOpacity}
            oninput={handleMasterOpacityChange}
            class="master-slider"
            data-midi-path="vj:master:opacity"
            data-midi-label="Master Opacity"
            data-midi-min="0"
            data-midi-max="1"
            data-midi-step="0.01"
          />
          <span class="master-value">{Math.round($vjClipLauncher.masterOpacity * 100)}%</span>
        </div>
      </div>

      <div class="header-center">
        <button class="stop-all-btn" onclick={handleStopAll}
          data-midi-path="vj:stopall"
          data-midi-label="Stop All"
          data-midi-mode="toggle"
        >
          ■ STOP ALL
        </button>
        <button class="performer-btn" class:active={showPerformer} class:running={performerStarted && !showPerformer} onclick={() => { showPerformer = !showPerformer; if (showPerformer && !performerStarted) { performerStarted = true; } }}>
          PERFORMER
        </button>
        {#if vjIsRecording}
          <div class="vj-recording-indicator">
            <span class="vj-rec-dot"></span>
            <span class="vj-rec-time">{formatVJRecordingDuration(vjRecordingDuration)}</span>
          </div>
          <button class="vj-stop-rec-btn" onclick={vjStopRecording}>
            Stop Rec
          </button>
        {:else}
          {#if $canUseVideoExport}
            <button class="vj-rec-btn" onclick={vjStartRecording} title="Record Output">
              ● REC
            </button>
          {:else}
            <button class="vj-rec-btn locked" title="Recording requires Pro license" disabled>
              🔒 REC
            </button>
          {/if}
        {/if}
      </div>

      <!-- MIX / STAGE toggle removed in OSS — stage mode is a Pro feature
           (used with VJ slice layers, also Pro-only). -->


      <div class="header-right">
        <button class="minimize-btn" class:active={$settings.ui.vjLayoutReversed}
          onclick={() => settings.update(s => ({ ...s, ui: { ...s.ui, vjLayoutReversed: !s.ui.vjLayoutReversed } }))}
          title={$settings.ui.vjLayoutReversed ? 'Controls left (default)' : 'Controls right (right-handed)'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m10 0h3a2 2 0 0 0 2-2v-3"/>
          </svg>
        </button>
        <button class="minimize-btn" onclick={() => window.dispatchEvent(new CustomEvent('open-settings'))} title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="minimize-btn" onclick={minimizeVJMode} title="Minimize (VJ stays live)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 12h14"/>
          </svg>
        </button>
        <button class="exit-btn" onclick={closeVJMode}>Exit VJ Mode</button>
      </div>
    </div>

    <!-- Stage Presets Bar (visible when stage mode active, stays above overlay content) -->
    {#if $vjClipLauncher.stageMode}
      <div class="stage-presets-bar">
        <span class="stage-presets-label">Stage Presets</span>
        <div class="stage-presets-list">
          {#each allStagePresets as preset (preset.id)}
            <button
              class="stage-preset-btn"
              class:active={$vjClipLauncher.stagePresetId === preset.id}
              onclick={() => project.loadStagePreset(preset.id)}
              oncontextmenu={(e) => { e.preventDefault(); deleteStagePreset(preset); }}
              title={preset.name}
            >
              {#if preset._scope === 'global'}<span class="stage-preset-scope">G</span>{/if}
              {#if preset.thumbnail}
                <img src={preset.thumbnail} alt={preset.name} class="stage-preset-thumb" />
              {/if}
              <span class="stage-preset-name">{preset.name}</span>
            </button>
          {/each}
        </div>
        <button class="stage-preset-save-btn" onclick={() => saveStagePresetWithScope()} title="Save current mapping as stage preset">
          + Save
        </button>
        <button class="stage-scope-toggle"
          class:global={stageSaveScope === 'global'}
          onclick={() => stageSaveScope = stageSaveScope === 'project' ? 'global' : 'project'}
          title={stageSaveScope === 'project' ? 'Save to project' : 'Save globally'}>
          {stageSaveScope === 'project' ? '📁' : '🌐'}
        </button>
      </div>
    {/if}

    <!-- Audio Control Bar — extracted into its own component so the high-
         frequency $audioStore subscription (60 Hz FFT updates) doesn't
         re-invalidate the rest of the VJ panel's reactive graph. -->
    <VJAudioBar {isMac} {setAudioSource} />

    <!-- Main Layout -->
    <div class="vj-main">
      <!-- Preview Section: Effects (left) | Preview 16:9 (center) | Shader Params + Media (right) -->
      <div class="vj-preview-section" class:reversed={$settings.ui.vjLayoutReversed} style="height: {previewSectionHeight}px">

        <!-- LEFT: Composition / Layer / Clip effects -->
        <div class="effects-panel-vj">
          <div class="effects-tabs">
            <button class="fx-tab" class:active={effectsTab === 'composition'} onclick={() => effectsTab = 'composition'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              Comp
            </button>
            <button class="fx-tab" class:active={effectsTab === 'layer'} onclick={() => effectsTab = 'layer'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              Layer
            </button>
            <button class="fx-tab" class:active={effectsTab === 'clip'} onclick={() => effectsTab = 'clip'}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Clip
            </button>
          </div>

          <div class="effects-panel-content">
            {#if (effectsTab === 'layer' || effectsTab === 'clip') && selectedLayerIndex === null}
              <div class="no-effects">Click a layer to edit effects</div>
            {:else if effectsTab === 'clip' && selectedLayerIndex !== null && $vjClipLauncher.layerStates[selectedLayerIndex].activeColumn === null}
              <div class="no-effects">No active clip on layer {selectedLayerIndex + 1}</div>
            {:else}
              <div class="effects-info">
                <span class="effects-info-label">{effectsTabLabel}</span>
                {#if effectsTab === 'composition'}
                  <p class="effects-info-hint">Applied to all output</p>
                {/if}
              </div>
              <div class="effects-section">
                <div class="effects-header">
                  <span>Effects</span>
                  <button class="add-effect-btn" onclick={() => showEffectPicker = true}>+ Add</button>
                </div>
                <div class="effects-list">
                  {#each currentEffects as effect (effect.id)}
                    <div class="effect-item" class:disabled={!effect.enabled}>
                      <div class="effect-header" onclick={() => expandedEffectId = expandedEffectId === effect.id ? null : effect.id}>
                        <button class="effect-toggle" class:active={effect.enabled}
                          onclick={(e) => { e.stopPropagation(); toggleEffect(effect.id); }}>
                          {effect.enabled ? '●' : '○'}
                        </button>
                        <span class="effect-name">{effect.type}</span>
                        <span class="effect-expand">{expandedEffectId === effect.id ? '▼' : '▶'}</span>
                        <button class="effect-delete" onclick={(e) => { e.stopPropagation(); deleteEffect(effect.id); }}>×</button>
                      </div>
                      {#if expandedEffectId === effect.id}
                        <div class="effect-params">
                          {#if getEffectPresets(effect.type).length > 0}
                            <details open>
                              <summary>Presets</summary>
                              <div class="param-row">
                                <span>Preset</span>
                                <select
                                  value={vjPresetSelection[effect.id] ?? ''}
                                  onchange={(e) => {
                                    vjPresetSelection = { ...vjPresetSelection, [effect.id]: (e.target as HTMLSelectElement).value };
                                  }}
                                >
                                  <option value="">Select preset</option>
                                  {#each getEffectPresets(effect.type) as preset, i}
                                    <option value={String(i)}>{preset.name}</option>
                                  {/each}
                                </select>
                              </div>
                              <div class="param-row">
                                <button class="btn-small" onclick={() => applyVJPreset(effect)}>Apply Preset</button>
                              </div>
                            </details>
                          {/if}

                          <details open>
                            <summary>Controls</summary>
                          {#if (EFFECT_PARAM_DEFS[effect.type] || []).length > 0}
                            {#each (EFFECT_PARAM_DEFS[effect.type] || []) as pd}
                              {@const val = (effect.params as Record<string, number>)[pd.param] ?? pd.default}
                              <div class="param-row">
                                <span class="param-name">{pd.name}</span>
                                {#if pd.type === 'select' && pd.options}
                                  <select value={val}
                                    onchange={(e) => updateEffectParam(effect.id, pd.param, parseFloat((e.target as HTMLSelectElement).value))}
                                    style="flex:1; background:#222; color:#fff; border:1px solid #444; border-radius:3px; padding:2px 4px; font-size:11px;">
                                    {#each pd.options as opt}
                                      <option value={opt.value} selected={val === opt.value}>{opt.label}</option>
                                    {/each}
                                  </select>
                                {:else if pd.type === 'color' && pd.colorParams}
                                  {@const cr = (effect.params as Record<string, number>)[pd.colorParams.r] ?? 0}
                                  {@const cg = (effect.params as Record<string, number>)[pd.colorParams.g] ?? 1}
                                  {@const cb = (effect.params as Record<string, number>)[pd.colorParams.b] ?? 0.4}
                                  {@const hexVal = '#' + [cr,cg,cb].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
                                  <input type="color" value={hexVal}
                                    oninput={(e) => {
                                      const hex = (e.target as HTMLInputElement).value;
                                      const r = parseInt(hex.slice(1,3), 16) / 255;
                                      const g = parseInt(hex.slice(3,5), 16) / 255;
                                      const b = parseInt(hex.slice(5,7), 16) / 255;
                                      if (pd.colorParams) {
                                        updateEffectParam(effect.id, pd.colorParams.r, r);
                                        updateEffectParam(effect.id, pd.colorParams.g, g);
                                        updateEffectParam(effect.id, pd.colorParams.b, b);
                                      }
                                    }}
                                    style="flex:0 0 40px; height:22px; padding:0; border:1px solid #444; border-radius:3px; cursor:pointer;" />
                                {:else}
                                  <input type="range" min={pd.min} max={pd.max} step={pd.step} value={val}
                                    oninput={(e) => updateEffectParam(effect.id, pd.param, parseFloat((e.target as HTMLInputElement).value))}
                                    data-midi-path="vj:fx:{effect.id}:{pd.param}"
                                    data-midi-label="{effect.type} {pd.name}"
                                    data-midi-min={pd.min}
                                    data-midi-max={pd.max}
                                    data-midi-step={pd.step} />
                                  <span class="param-value">{val.toFixed(pd.step < 0.1 ? 2 : pd.step < 1 ? 1 : 0)}</span>
                                {/if}
                              </div>
                            {/each}
                          {:else}
                            <div class="param-row"><span class="no-params">No adjustable parameters</span></div>
                          {/if}
                          </details>
                        </div>
                      {/if}
                    </div>
                  {/each}
                  {#if currentEffects.length === 0}
                    <div class="no-effects">No effects - add one above</div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- CENTER: Preview 16:9 -->
        <div class="preview-wrapper">
          <div class="preview-container">
            <canvas bind:this={previewCanvas} class="preview-canvas"></canvas>
            <div class="preview-label">OUTPUT PREVIEW</div>
          </div>
        </div>

        <!-- RIGHT: Shader Params (only shows when a shader clip is selected) -->
        <div class="right-panel-vj" class:collapsed={!(selectedLayerIndex !== null && (
          (selectedLayerState?.activeClip?.type === 'shader' && selectedLayerState?.activeClip?.shaderCode && showShaderParams) ||
          (selectedLayerState?.activeClip?.type === 'splat') ||
          (selectedLayerState?.activeClip?.type === 'model3d') ||
          (selectedLayerState?.activeClip?.type === 'video') ||
          (selectedLayerState?.activeClip?.type === 'effect' && selectedLayerState?.activeClip?.effectSource)
        ))}>
          <!-- Shader Parameters (above media tabs) -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'shader' && selectedLayerState?.activeClip?.shaderCode && showShaderParams}
            {#if selectedClipShaderInputs.length > 0}
              <div class="shader-params-panel">
                <div class="shader-params-panel-header">
                  <span class="shader-params-overlay-title">
                    {selectedLayerState.activeClip.name}
                    <span class="shader-params-layer-badge">L{selectedLayerIndex! + 1}</span>
                    {#if clipIsAudioReady}
                      <span class="audio-ready-badge" title="Audio-reactive shader">♪</span>
                    {/if}
                  </span>
                  <button class="shader-params-close" onclick={() => showShaderParams = false}>×</button>
                </div>
                {#if !clipIsAudioReady && selectedClipShaderInputs.some(i => { const m = getParamModulation(selectedLayerIndex!, i.NAME); return m && m.source !== 'manual'; })}
                  <div class="audio-warn">This shader doesn't use audio uniforms — modulation controls parameters only, not the shader's internal audio response.</div>
                {/if}
                <div class="shader-params-panel-list">
                  {#each selectedClipShaderInputs as input (input.NAME)}
                    {@const mod = getParamModulation(selectedLayerIndex!, input.NAME)}
                    {@const isModulated = mod && mod.source !== 'manual'}
                    <div class="shader-param" class:modulated={isModulated}>
                      <div class="shader-param-header">
                        <span class="shader-param-name">{input.LABEL || input.NAME}</span>
                        <select class="mod-source-select" class:active={isModulated} value={mod?.source || 'manual'}
                          onchange={(e) => setParamModSource(selectedLayerIndex!, input.NAME, (e.target as HTMLSelectElement).value as ModSource)}>
                          <optgroup label="Control"><option value="manual">Manual</option></optgroup>
                          <optgroup label="Audio">
                            <option value="sub">Sub</option><option value="bass">Bass</option><option value="lowMid">Low Mid</option>
                            <option value="mid">Mid</option><option value="highMid">Hi Mid</option><option value="high">High</option>
                            <option value="amplitude">Volume</option>
                          </optgroup>
                          <optgroup label="Sync"><option value="beatPhase">Beat</option></optgroup>
                          <optgroup label="LFO">
                            <option value="lfo-sine">Sine</option><option value="lfo-saw">Saw</option>
                            <option value="lfo-square">Square</option><option value="lfo-tri">Triangle</option>
                          </optgroup>
                        </select>
                      </div>
                      {#if input.TYPE === 'float' || input.TYPE === 'event'}
                        <div class="shader-param-slider">
                          <div class="slider-track-wrap">
                            <input type="range" min={input.MIN ?? 0} max={input.MAX ?? 1} step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 200}
                              value={getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? input.MIN ?? 0)}
                              oninput={(e) => { markUserInteracting(`vj:${selectedLayerIndex}:shader:${input.NAME}`); setShaderParamValue(selectedLayerIndex!, input.NAME, parseFloat((e.target as HTMLInputElement).value)); }} class="param-slider"
                              data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                              data-midi-label="{input.LABEL || input.NAME}"
                              data-midi-min={input.MIN ?? 0}
                              data-midi-max={input.MAX ?? 1}
                              data-midi-step={((input.MAX ?? 1) - (input.MIN ?? 0)) / 200} />
                            {#if isModulated && modGhostValues[input.NAME] !== undefined}
                              <div class="mod-ghost" style="left: {((modGhostValues[input.NAME] - (input.MIN ?? 0)) / ((input.MAX ?? 1) - (input.MIN ?? 0))) * 100}%"></div>
                            {/if}
                          </div>
                          <span class="param-val">{(isModulated && modGhostValues[input.NAME] !== undefined ? modGhostValues[input.NAME] : getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? input.MIN ?? 0)).toFixed(2)}</span>
                        </div>
                      {:else if input.TYPE === 'bool'}
                        <div class="shader-param-toggle">
                          <button class="bool-toggle" class:on={getShaderParamValue(selectedLayerIndex!, input.NAME, 0) > 0.5}
                            onclick={() => { const cur = getShaderParamValue(selectedLayerIndex!, input.NAME, 0); setShaderParamValue(selectedLayerIndex!, input.NAME, cur > 0.5 ? 0 : 1); }}
                            data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                            data-midi-label="{input.LABEL || input.NAME}"
                            data-midi-discrete="true">
                            {getShaderParamValue(selectedLayerIndex!, input.NAME, 0) > 0.5 ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      {:else if input.TYPE === 'long' && input.VALUES && input.LABELS}
                        <div class="shader-param-select">
                          <select class="long-select" value={getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? 0)}
                            onchange={(e) => setShaderParamValue(selectedLayerIndex!, input.NAME, parseInt((e.target as HTMLSelectElement).value))}
                            data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                            data-midi-label="{input.LABEL || input.NAME}"
                            data-midi-discrete="true">
                            {#each input.VALUES as val, i}<option value={val}>{input.LABELS?.[i] ?? val}</option>{/each}
                          </select>
                        </div>
                      {:else if input.TYPE === 'long'}
                        <div class="shader-param-slider">
                          <input type="range" min={input.MIN ?? 0} max={input.MAX ?? 10} step="1"
                            value={getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? 0)}
                            oninput={(e) => setShaderParamValue(selectedLayerIndex!, input.NAME, parseInt((e.target as HTMLInputElement).value))} class="param-slider"
                            data-midi-path="vj:{selectedLayerIndex}:shader:{input.NAME}"
                            data-midi-label="{input.LABEL || input.NAME}"
                            data-midi-min={input.MIN ?? 0}
                            data-midi-max={input.MAX ?? 10}
                            data-midi-step="1" />
                          <span class="param-val">{getShaderParamValue(selectedLayerIndex!, input.NAME, (input.DEFAULT as number) ?? 0)}</span>
                        </div>
                      {/if}
                      {#if isModulated}
                        <div class="mod-amount-row">
                          <span class="mod-amount-label">Depth</span>
                          <input type="range" min="0" max="1" step="0.01" value={mod?.amount ?? 0.5}
                            oninput={(e) => setParamModAmount(selectedLayerIndex!, input.NAME, parseFloat((e.target as HTMLInputElement).value))} class="mod-amount-slider" />
                          <span class="mod-amount-val">{((mod?.amount ?? 0.5) * 100).toFixed(0)}%</span>
                        </div>
                        {#if mod?.source?.startsWith('lfo-')}
                          <div class="mod-amount-row">
                            <span class="mod-amount-label">Speed</span>
                            <input type="range" min="0.1" max="10" step="0.1" value={mod?.speed ?? 1}
                              oninput={(e) => setParamModSpeed(selectedLayerIndex!, input.NAME, parseFloat((e.target as HTMLInputElement).value))} class="mod-amount-slider" />
                            <span class="mod-amount-val">{(mod?.speed ?? 1).toFixed(1)}Hz</span>
                          </div>
                        {/if}
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}

          <!-- Point Cloud (Splat) Parameters — Full controls via reusable SplatPanel -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'splat'}
            {@const splatClip = selectedLayerState.activeClip}
            {@const vjSplatContent = splatClip.splatContent || createDefaultSplatContent()}
            <div class="shader-params-panel splat-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {splatClip.name || 'Point Cloud'}
                  <span class="shader-params-layer-badge" style="background: rgba(52, 211, 153, 0.3); color: #34d399;">PLY</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <SplatPanel
                  content={vjSplatContent}
                  onUpdate={(updates) => vjClipLauncher.updateActiveClipSplatContent(selectedLayerIndex!, updates)}
                  onFileLoad={() => reloadVJClipFile(selectedLayerIndex!, $vjClipLauncher.layerStates[selectedLayerIndex!]?.activeColumn ?? 0)}
                  compact={true}
                />
              </div>
            </div>
          {/if}

          <!-- 3D Model Parameters — Full controls via reusable Model3DPanel -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'model3d'}
            {@const modelClip = selectedLayerState.activeClip}
            {@const vjModel3DContent = modelClip.model3dContent || createDefaultModel3DContent()}
            <div class="shader-params-panel model3d-params-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {modelClip.name || '3D Model'}
                  <span class="shader-params-layer-badge" style="background: rgba(251, 191, 36, 0.3); color: #fbbf24;">3DM</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <Model3DPanel
                  content={vjModel3DContent}
                  onUpdate={(updates) => vjClipLauncher.updateActiveClipModel3DContent(selectedLayerIndex!, updates)}
                  onFileLoad={() => reloadVJClipFile(selectedLayerIndex!, $vjClipLauncher.layerStates[selectedLayerIndex!]?.activeColumn ?? 0)}
                  compact={true}
                />
              </div>
            </div>
          {/if}

          <!-- Plugin/Effect Parameters (FluidGen, Particles3D, etc.) -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'effect'}
            {@const effectClip = selectedLayerState.activeClip}
            {@const vjEffectSource = effectClip.effectSource}
            {@const pluginManifest = vjEffectSource ? getPluginByEffectType(vjEffectSource.effectType) : null}
            {#if pluginManifest && vjEffectSource}
              <div class="shader-params-panel effect-params-panel">
                <div class="shader-params-panel-header">
                  <span class="shader-params-overlay-title">
                    {pluginManifest.name || effectClip.name || 'Plugin'}
                    <span class="shader-params-layer-badge" style="background: rgba(16, 185, 129, 0.3); color: #10b981;">FX</span>
                  </span>
                </div>
                <div class="shader-params-panel-list">
                  {#each pluginManifest.paramDefs as pd}
                    <div class="shader-param">
                      <div class="shader-param-header">
                        <span class="shader-param-name">{pd.name}</span>
                      </div>
                      {#if pd.type === 'slider'}
                        <div class="shader-param-slider">
                          <div class="slider-track-wrap">
                            <input type="range" class="param-slider"
                              min={pd.min ?? 0} max={pd.max ?? 1} step={pd.step ?? 0.01}
                              value={(vjEffectSource as any)[pd.param] ?? pd.default ?? 0.5}
                              oninput={(e) => {
                                if (selectedLayerIndex === null) return;
                                const val = parseFloat((e.target as HTMLInputElement).value);
                                const col = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeColumn ?? 0;
                                const clip = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeClip;
                                if (clip?.effectSource) {
                                  vjClipLauncher.updateClipEffectSource(selectedLayerIndex, col, { ...clip.effectSource, [pd.param]: val });
                                }
                              }}
                            />
                          </div>
                          <span class="param-val">{((vjEffectSource as any)[pd.param] ?? pd.default ?? 0).toFixed(pd.step && pd.step >= 1 ? 0 : 2)}</span>
                        </div>
                      {:else if pd.type === 'toggle'}
                        <div class="shader-param-slider">
                          <label class="toggle-label">
                            <input type="checkbox"
                              checked={(vjEffectSource as any)[pd.param] ?? pd.default ?? false}
                              onchange={(e) => {
                                if (selectedLayerIndex === null) return;
                                const val = (e.target as HTMLInputElement).checked;
                                const col = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeColumn ?? 0;
                                const clip = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeClip;
                                if (clip?.effectSource) {
                                  vjClipLauncher.updateClipEffectSource(selectedLayerIndex, col, { ...clip.effectSource, [pd.param]: val });
                                }
                              }}
                            />
                            <span class="toggle-slider"></span>
                          </label>
                        </div>
                      {:else if pd.type === 'select' && pd.options}
                        <div class="shader-param-slider">
                          <select class="isf-select"
                            value={(vjEffectSource as any)[pd.param] ?? pd.default ?? 0}
                            onchange={(e) => {
                              if (selectedLayerIndex === null) return;
                              const val = parseFloat((e.target as HTMLSelectElement).value);
                              const col = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeColumn ?? 0;
                              const clip = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeClip;
                              if (clip?.effectSource) {
                                vjClipLauncher.updateClipEffectSource(selectedLayerIndex, col, { ...clip.effectSource, [pd.param]: val });
                              }
                            }}
                          >
                            {#each pd.options as opt}
                              <option value={opt.value}>{opt.label}</option>
                            {/each}
                          </select>
                        </div>
                      {:else if pd.type === 'color'}
                        {@const colorVal = (vjEffectSource as any)[pd.param] ?? pd.default ?? [1,1,1]}
                        <div class="shader-param-slider">
                          <input type="color"
                            value={'#' + [0,1,2].map(i => Math.round((colorVal[i] ?? 0) * 255).toString(16).padStart(2,'0')).join('')}
                            oninput={(e) => {
                              if (selectedLayerIndex === null) return;
                              const hex = (e.target as HTMLInputElement).value;
                              const r = parseInt(hex.slice(1,3), 16) / 255;
                              const g = parseInt(hex.slice(3,5), 16) / 255;
                              const b = parseInt(hex.slice(5,7), 16) / 255;
                              const col = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeColumn ?? 0;
                              const clip = $vjClipLauncher.layerStates[selectedLayerIndex]?.activeClip;
                              if (clip?.effectSource) {
                                vjClipLauncher.updateClipEffectSource(selectedLayerIndex, col, { ...clip.effectSource, [pd.param]: [r, g, b] });
                              }
                            }}
                            style="width: 100%; height: 24px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; background: transparent;"
                          />
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}

          <!-- Video Transform (only when a video clip is selected). The
               transforms are baked into the layer's `corners` field by
               vjOutputLayers in vjClipLauncher; sliders here drive
               updateActiveClipVideoProps which updates the active clip's
               zoom/fit/anchor/rotation/opacity fields. -->
          <!-- Video Controls Panel — matches LayerPanel mapping-mode controls.
               Transport row (play/pause + restart + time + speed) → trim-aware
               timeline → Loop/Once mode buttons → Transform sliders. -->
          {#if selectedLayerIndex !== null && selectedLayerState?.activeClip?.type === 'video' && selectedLayerState?.activeClip?.videoElement}
            {@const vClip = selectedLayerState.activeClip}
            {@const vEl = vClip.videoElement!}
            {@const vMode = vClip.playbackMode || 'loop'}
            {@const vRate = vClip.playbackRate ?? 1.0}
            {@const vTrimS = vClip.trimStart ?? 0}
            {@const vTrimE = vClip.trimEnd ?? 1}
            {@const vIsPlaying = vClip.isPlaying !== false}
            <div class="shader-params-panel video-controls-panel">
              <div class="shader-params-panel-header">
                <span class="shader-params-overlay-title">
                  {vClip.name || 'Video'}
                  <span class="shader-params-layer-badge" style="background: rgba(96, 165, 250, 0.3); color: #60a5fa;">VID</span>
                </span>
              </div>
              <div class="shader-params-panel-list">
                <div class="vt-controls">
                  <!-- Transport row -->
                  <div class="vt-transport">
                    <button
                      class="vt-btn vt-play"
                      onclick={() => vjSetVideoPlaying(selectedLayerIndex!, !vIsPlaying)}
                      title={vIsPlaying ? 'Pause' : 'Play'}
                    >
                      {#if !vIsPlaying}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      {:else}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
                      {/if}
                    </button>
                    <button class="vt-btn" onclick={() => vjRestartVideo(selectedLayerIndex!)} title="Restart">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                      </svg>
                    </button>
                    <span class="vt-time">{vjFormatTime(vjVideoCurrentTime)} / {vjFormatTime(vjVideoDuration)}</span>
                    <select
                      class="vt-speed"
                      value={String(vRate)}
                      onchange={(e) => vjSetPlaybackRate(selectedLayerIndex!, parseFloat((e.target as HTMLSelectElement).value))}
                    >
                      <option value="0.25">0.25x</option>
                      <option value="0.5">0.5x</option>
                      <option value="1">1x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2x</option>
                      <option value="4">4x</option>
                    </select>
                  </div>

                  <!-- Trim-aware timeline with playhead + drag handles -->
                  <div
                    class="vt-timeline"
                    bind:this={vjTimelineEl}
                    onmousedown={(e) => vjHandleTimelineMouseDown(e, vEl)}
                    role="slider"
                    tabindex="0"
                    aria-label="Video timeline"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={vjVideoDuration > 0 ? Math.round(vjVideoCurrentTime / vjVideoDuration * 100) : 0}
                  >
                    <div class="vt-trim-outside-left" style="width: {vTrimS * 100}%"></div>
                    <div class="vt-trim-outside-right" style="width: {(1 - vTrimE) * 100}%"></div>
                    <div class="vt-trim-region" style="left: {vTrimS * 100}%; width: {(vTrimE - vTrimS) * 100}%"></div>
                    {#if vjVideoDuration > 0}
                      <div class="vt-playhead" style="left: {(vjVideoCurrentTime / vjVideoDuration) * 100}%"></div>
                    {/if}
                    <div
                      class="vt-trim-handle vt-trim-start"
                      style="left: {vTrimS * 100}%"
                      onmousedown={(e) => vjHandleTrimMouseDown(e, 'start', selectedLayerIndex!)}
                      role="slider" tabindex="0" aria-label="Trim start"
                    ></div>
                    <div
                      class="vt-trim-handle vt-trim-end"
                      style="left: {vTrimE * 100}%"
                      onmousedown={(e) => vjHandleTrimMouseDown(e, 'end', selectedLayerIndex!)}
                      role="slider" tabindex="0" aria-label="Trim end"
                    ></div>
                  </div>

                  <!-- Mode buttons -->
                  <div class="vt-modes">
                    <button class="vt-mode-btn" class:active={vMode === 'loop'} onclick={() => vjSetPlaybackMode(selectedLayerIndex!, 'loop')} title="Loop">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                      </svg>
                      Loop
                    </button>
                    <button class="vt-mode-btn" class:active={vMode === 'once'} onclick={() => vjSetPlaybackMode(selectedLayerIndex!, 'once')} title="Play Once">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                      Once
                    </button>
                  </div>

                  <!-- Transform sliders -->
                  <div class="vt-transform">
                    <div class="vt-section-title">Transform</div>
                    <div class="vt-tf-row">
                      <span class="vt-tf-label">Fit</span>
                      <select class="vt-tf-select"
                        value={vClip.fit ?? 'cover'}
                        onchange={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { fit: (e.target as HTMLSelectElement).value as any })}
                      >
                        <option value="cover">Cover (fill + crop)</option>
                        <option value="contain">Contain (letterbox)</option>
                        <option value="fill">Fill (stretch)</option>
                      </select>
                    </div>
                    <div class="vt-tf-row">
                      <span class="vt-tf-label">Zoom</span>
                      <input type="range" min="0.1" max="4" step="0.05"
                        value={vClip.zoom ?? 1}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { zoom: +(e.target as HTMLInputElement).value })}
                      />
                      <span class="vt-tf-num">{(vClip.zoom ?? 1).toFixed(2)}×</span>
                    </div>
                    <div class="vt-tf-row">
                      <span class="vt-tf-label">Anchor X</span>
                      <input type="range" min="0" max="1" step="0.01"
                        value={vClip.anchorX ?? 0.5}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { anchorX: +(e.target as HTMLInputElement).value })}
                      />
                      <span class="vt-tf-num">{(vClip.anchorX ?? 0.5).toFixed(2)}</span>
                    </div>
                    <div class="vt-tf-row">
                      <span class="vt-tf-label">Anchor Y</span>
                      <input type="range" min="0" max="1" step="0.01"
                        value={vClip.anchorY ?? 0.5}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { anchorY: +(e.target as HTMLInputElement).value })}
                      />
                      <span class="vt-tf-num">{(vClip.anchorY ?? 0.5).toFixed(2)}</span>
                    </div>
                    <div class="vt-tf-row">
                      <span class="vt-tf-label">Rotation</span>
                      <input type="range" min="-180" max="180" step="1"
                        value={vClip.rotation ?? 0}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { rotation: +(e.target as HTMLInputElement).value })}
                      />
                      <span class="vt-tf-num">{(vClip.rotation ?? 0).toFixed(0)}°</span>
                    </div>
                    <div class="vt-tf-row">
                      <span class="vt-tf-label">Opacity</span>
                      <input type="range" min="0" max="1" step="0.01"
                        value={vClip.opacity ?? 1}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { opacity: +(e.target as HTMLInputElement).value })}
                      />
                      <span class="vt-tf-num">{Math.round((vClip.opacity ?? 1) * 100)}%</span>
                    </div>
                    <button class="vt-tf-reset"
                      onclick={() => vjClipLauncher.updateActiveClipVideoProps(selectedLayerIndex!, { zoom: 1, fit: 'cover', anchorX: 0.5, anchorY: 0.5, rotation: 0, opacity: 1 })}
                    >Reset Transform</button>
                  </div>
                </div>
              </div>
            </div>
          {/if}
      </div>
      </div>

      <!-- Resize handle for preview section -->
      <div
        class="preview-resize-handle"
        onpointerdown={onPreviewResizeStart}
        onpointermove={onPreviewResizeMove}
        onpointerup={onPreviewResizeEnd}
        onpointercancel={onPreviewResizeEnd}
      >
        <div class="resize-grip"></div>
      </div>

      <!-- Bottom Section: Grid + Media Tray -->
      <div class="vj-bottom">
      <!-- Clip Grid (now takes more space without left panel) -->
      <div class="grid-section" class:reversed={$settings.ui.vjLayoutReversed}>
        <!-- Blocks Tab Bar -->
        <div class="blocks-tab-bar">
          <div class="blocks-tabs">
            {#each $vjClipLauncher.blocks as block, blockIdx (block.id)}
              <div
                class="block-tab"
                class:active={$vjClipLauncher.activeBlockId === block.id}
                onclick={() => handleSelectBlock(block.id)}
                ondblclick={(e) => startEditingBlock(block, e)}
                role="tab"
                tabindex="0"
                data-midi-path="vj:block:{blockIdx}"
                data-midi-label="Block {blockIdx + 1}: {block.name}"
                data-midi-mode="toggle"
              >
                {#if editingBlockId === block.id}
                  <input
                    bind:this={blockInputEl}
                    type="text"
                    class="block-name-input"
                    bind:value={editingBlockName}
                    onblur={finishEditingBlock}
                    onkeydown={handleBlockKeyDown}
                    onclick={(e) => e.stopPropagation()}
                  />
                {:else}
                  <span class="block-name">{block.name}</span>
                {/if}
                {#if $vjClipLauncher.blocks.length > 1}
                  <button
                    class="block-delete-btn"
                    onclick={(e) => handleDeleteBlock(block.id, e)}
                    title="Delete block"
                  >
                    x
                  </button>
                {/if}
              </div>
            {/each}
          </div>
          <button class="add-block-btn" onclick={handleAddBlock} title="Add new block">
            +
          </button>
        </div>

        <!-- Grid dimension controls -->
        <div class="grid-dimension-controls">
          <div class="dim-group">
            <span class="dim-label">Layers</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.removeLayer()} title="Remove layer">−</button>
            <span class="dim-value">{$vjClipLauncher.numLayers}</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.addLayer()} title="Add layer">+</button>
          </div>
          <div class="dim-group">
            <span class="dim-label">Columns</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.removeColumn()} title="Remove column">−</button>
            <span class="dim-value">{$vjClipLauncher.numColumns}</span>
            <button class="dim-btn" onclick={() => vjClipLauncher.addColumn()} title="Add column">+</button>
          </div>
        </div>

        <!-- Column headers (for triggering entire columns) -->
        <div class="column-headers">
          <div class="live-preview-header">LIVE</div>
          <div class="layer-controls-header"></div>
          {#each columnIndices as colIdx (colIdx)}
            <button
              class="column-trigger"
              onclick={() => handleColumnTrigger(colIdx)}
              title="Trigger column {colIdx + 1}"
              data-midi-path="vj:column:{colIdx}"
              data-midi-label="Column {colIdx + 1} Trigger"
              data-midi-mode="toggle"
            >
              {colIdx + 1}
            </button>
          {/each}
        </div>

        <!-- Layer rows -->
        {#each layerIndices as layerIdx (layerIdx)}
          {@const activeClip = $vjClipLauncher.layerStates[layerIdx].activeClip}
          <div
            class="layer-row"
            class:selected={selectedLayerIndex === layerIdx}
            class:dragging={draggedLayerIndex === layerIdx}
            class:drag-over={dragOverLayerIndex === layerIdx}
            ondragover={(e) => handleLayerDragOver(layerIdx, e)}
            ondragleave={handleLayerDragLeave}
            ondrop={(e) => handleLayerDrop(layerIdx, e)}
          >
            <!-- Live Preview Thumbnail (drag handle for layer reorder) -->
            <div class="layer-live-preview" class:has-clip={activeClip !== null}
              draggable="true"
              ondragstart={(e) => handleLayerDragStart(layerIdx, e)}
              ondragend={handleLayerDragEnd}
              title="Drag to reorder layer"
            >
              {#if activeClip}
                {#if activeClip.thumbnail}
                  <img src={activeClip.thumbnail} alt={activeClip.name} class="live-preview-thumb" />
                {:else}
                  <div class="live-preview-placeholder {activeClip.type}">
                    {activeClip.type === 'shader' ? 'ISF' : activeClip.type === 'video' ? 'VID' : activeClip.type === 'spout' ? 'SPT' : activeClip.type === 'threejs' ? '3JS' : 'IMG'}
                  </div>
                {/if}
                <div class="live-indicator-dot"></div>
              {:else}
                <div class="live-preview-empty">-</div>
              {/if}
            </div>

            <!-- Layer controls -->
            <div class="layer-controls" draggable="false" ondragstart={(e) => { e.preventDefault(); e.stopPropagation(); }} onclick={() => selectLayerForEffects(layerIdx)}>
              <div class="layer-header">
                <button class="layer-select-icon" class:selected={selectedLayerIndex === layerIdx}
                  onclick={(e) => { e.stopPropagation(); selectLayerForEffects(layerIdx); }} title="Select layer {layerIdx + 1}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/></svg>
                </button>
                <span class="layer-num">{layerIdx + 1}</span>
                <div class="layer-buttons">
                  <button
                    class="layer-btn solo"
                    class:active={$vjClipLauncher.layerStates[layerIdx].solo}
                    onclick={(e) => { e.stopPropagation(); handleToggleSolo(layerIdx); }}
                    title="Solo"
                    data-midi-path="vj:{layerIdx}:solo"
                    data-midi-label="Layer {layerIdx + 1} Solo"
                    data-midi-mode="toggle"
                  >S</button>
                  <button
                    class="layer-btn mute"
                    class:active={$vjClipLauncher.layerStates[layerIdx].mute}
                    onclick={(e) => { e.stopPropagation(); handleToggleMute(layerIdx); }}
                    title="Mute"
                    data-midi-path="vj:{layerIdx}:mute"
                    data-midi-label="Layer {layerIdx + 1} Mute"
                    data-midi-mode="toggle"
                  >M</button>
                  <button
                    class="layer-btn stop"
                    onclick={(e) => { e.stopPropagation(); handleStopLayer(layerIdx); }}
                    title="Stop layer"
                  >■</button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={$vjClipLauncher.layerStates[layerIdx].opacity}
                oninput={(e) => handleLayerOpacityChange(layerIdx, e)}
                class="opacity-slider"
                draggable="false"
                onmousedown={(e) => e.stopPropagation()}
                onclick={(e) => e.stopPropagation()}
                onpointerdown={(e) => e.stopPropagation()}
                data-midi-path="vj:{layerIdx}:opacity"
                data-midi-label="Layer {layerIdx + 1} Opacity"
                data-midi-min="0"
                data-midi-max="1"
                data-midi-step="0.01"
              />
              <select
                class="blend-select"
                value={$vjClipLauncher.layerStates[layerIdx].blendMode}
                onchange={(e) => handleLayerBlendChange(layerIdx, e)}
                onclick={(e) => e.stopPropagation()}
                data-midi-path="vj:{layerIdx}:blend"
                data-midi-label="Layer {layerIdx + 1} Blend"
                data-midi-discrete="true"
              >
                {#each blendModes as mode}
                  <option value={mode}>{mode}</option>
                {/each}
              </select>
            </div>

            <!-- Clip cells -->
            {#each columnIndices as colIdx (colIdx)}
              {@const clip = $vjClipLauncher.clipGrid[layerIdx][colIdx]}
              {@const isActive = activeClip !== null && clip !== null && activeClip.id === clip.id}
              <div
                class="clip-cell"
                class:has-clip={clip !== null}
                class:active={isActive}
                class:dragover={dragOverCell?.layer === layerIdx && dragOverCell?.column === colIdx}
                draggable={clip !== null ? 'true' : 'false'}
                onclick={() => clip && handleCellClick(layerIdx, colIdx)}
                ondragstart={(e) => clip && handleClipCellDragStart(e, layerIdx, colIdx)}
                ondragend={handleDragEnd}
                ondragover={(e) => handleCellDragOver(e, layerIdx, colIdx)}
                ondragleave={handleCellDragLeave}
                ondrop={(e) => handleCellDrop(e, layerIdx, colIdx)}
                oncontextmenu={(e) => handleCellContextMenu(e, layerIdx, colIdx)}
                role="button"
                tabindex="0"
                data-midi-path="vj:{layerIdx}:trigger:{colIdx}"
                data-midi-label="L{layerIdx + 1} C{colIdx + 1} Trigger"
                data-midi-mode="toggle"
              >
                {#if clip}
                  <div class="clip-content">
                    {#if clip.thumbnail}
                      <img src={clip.thumbnail} alt={clip.name} class="clip-thumb" />
                    {:else}
                      <div class="clip-placeholder {clip.type}">
                        {clip.type === 'shader' ? 'ISF' : clip.type === 'video' ? 'VID' : clip.type === 'spout' ? 'SPT' : clip.type === 'threejs' ? '3JS' : clip.type === 'splat' ? 'PLY' : clip.type === 'model3d' ? '3DM' : clip.type === 'effect' ? 'FX' : 'IMG'}
                      </div>
                    {/if}
                    <span class="clip-name">{clip.name}</span>
                    <button class="clear-btn" onclick={(e) => handleClearClip(layerIdx, colIdx, e)}>×</button>
                  </div>
                {:else}
                  <div class="empty-cell"></div>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>

      <!-- Clip Context Menu -->
      {#if cellContextMenu}
        <div class="ctx-backdrop" onclick={closeCellContextMenu}></div>
        <div class="ctx-menu" style="left:{cellContextMenu.x}px;top:{cellContextMenu.y}px">
          {#if $vjClipLauncher.clipGrid[cellContextMenu.layer]?.[cellContextMenu.column]}
            <button class="ctx-item" onclick={openClipPreview}>Edit / Preview</button>
            <button class="ctx-item" onclick={copyClipToClipboard}>Copy</button>
          {/if}
          {#if clipboardClip}
            <button class="ctx-item" onclick={pasteClipFromClipboard}>Paste</button>
          {/if}
          {#if $vjClipLauncher.clipGrid[cellContextMenu.layer]?.[cellContextMenu.column]}
            <button class="ctx-item ctx-danger" onclick={clearClipFromMenu}>Clear</button>
          {/if}
          {#if !$vjClipLauncher.clipGrid[cellContextMenu.layer]?.[cellContextMenu.column] && !clipboardClip}
            <div class="ctx-item ctx-disabled">No actions</div>
          {/if}
        </div>
      {/if}

      <!-- Clip Preview Panel — opened from cell context menu's Edit/Preview -->
      {#if previewPanel}
        <ClipPreviewPanel
          layerIndex={previewPanel.layer}
          columnIndex={previewPanel.column}
          clip={previewPanel.clip}
          onClose={() => previewPanel = null}
        />
      {/if}

      <!-- Right Panel: Media Tray (collapsible) -->
      <div class="media-tray-vj" class:collapsed={mediaTrayCollapsed}>
        <button class="tray-collapse-btn" onclick={() => mediaTrayCollapsed = !mediaTrayCollapsed} title={mediaTrayCollapsed ? 'Expand media tray' : 'Collapse media tray'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            {#if mediaTrayCollapsed}
              <polyline points="15 18 9 12 15 6"/>
            {:else}
              <polyline points="9 18 15 12 9 6"/>
            {/if}
          </svg>
        </button>
        {#if !mediaTrayCollapsed}
        <!-- Tab Icons Row (matching mapping mode) -->
        <div class="vj-tabs">
          <div class="vj-tab-row">
            <button class="vj-tab" class:active={vjMediaTab === 'shaders'} onclick={() => vjMediaTab = 'shaders'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              <span>FX</span>
              {#if shaders.length}<span class="vj-tab-count">{shaders.length}</span>{/if}
            </button>
            <!-- JS tab (Three.js / p5.js live coding) removed in OSS — Pro-only. -->
            <button class="vj-tab" class:active={vjMediaTab === 'library'} onclick={() => vjMediaTab = 'library'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span>Saved</span>
              {#if savedShaders.length}<span class="vj-tab-count">{savedShaders.length}</span>{/if}
            </button>
            <button class="vj-tab" class:active={vjMediaTab === 'videos'} onclick={() => vjMediaTab = 'videos'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span>Vid</span>
              {#if $mediaLibrary.filter(m => m.type === 'video').length}<span class="vj-tab-count">{$mediaLibrary.filter(m => m.type === 'video').length}</span>{/if}
            </button>
            <button class="vj-tab" class:active={vjMediaTab === 'images'} onclick={() => vjMediaTab = 'images'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>Img</span>
              {#if $mediaLibrary.filter(m => m.type === 'image').length}<span class="vj-tab-count">{$mediaLibrary.filter(m => m.type === 'image').length}</span>{/if}
            </button>
            <button class="vj-tab" class:active={vjMediaTab === 'sources'} onclick={() => vjMediaTab = 'sources'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <span>Src</span>
              {#if vjLiveSources.filter(s => s.status === 'live').length > 0}
                <span class="vj-tab-count live">{vjLiveSources.filter(s => s.status === 'live').length}</span>
              {/if}
            </button>
            <!-- Plug tab (FluidGen / Particles3D plugin shelf) removed in OSS — Pro-only. -->
          </div>
        </div>

        <!-- AI Generator buttons + panels removed in OSS — Pro-only feature. -->


        <!-- Loading indicator -->
        {#if shadersLoading && (vjMediaTab === 'shaders' || vjMediaTab === 'js')}
          <div class="loading">Loading shaders...</div>
        {/if}

        <!-- Import bar: file picker for VJ-only media import -->
        {#if vjMediaTab === 'videos' || vjMediaTab === 'images'}
          <div class="vj-import-bar">
            <button class="vj-import-btn" onclick={() => vjMediaFileInput?.click()} title="Import files from disk">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import {vjMediaTab === 'videos' ? 'Videos' : 'Images'}
            </button>
            <input
              type="file"
              bind:this={vjMediaFileInput}
              accept={vjMediaTab === 'videos' ? 'video/*' : 'image/*'}
              multiple
              style="display:none;"
              onchange={vjHandleMediaFilePick}
            />
          </div>
        {/if}

        <!-- Media List -->
        <div
          class="media-list"
          class:vj-media-drag-over={vjMediaDragOver}
          ondragover={vjHandleMediaDragOver}
          ondragleave={vjHandleMediaDragLeave}
          ondrop={vjHandleMediaDrop}
          role="region">
          {#if vjMediaTab === 'sources'}
            <!-- Live Sources Panel for VJ -->
            <div class="vj-sources-panel">
              <div class="vj-sources-btns">
                <button class="vj-src-btn" onclick={() => vjStartWebcam()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                  Webcam
                </button>
                <button class="vj-src-btn" onclick={() => vjStartCapture()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                  Capture
                </button>
              </div>
              {#if vjLiveSources.length === 0}
                <div class="empty-media">
                  <p>No live sources active</p>
                  <p class="hint">Add a webcam or screen capture above</p>
                </div>
              {:else}
                {#each vjLiveSources as src (src.id)}
                  <div
                    class="media-item vj-source-item"
                    class:source-live={src.status === 'live'}
                    draggable={src.status === 'live' ? 'true' : 'false'}
                    ondragstart={(e) => src.videoEl && handleDragStart(e, { type: 'video', id: src.id })}
                    ondragend={handleDragEnd}
                    role="button"
                    tabindex="0"
                  >
                    <div class="item-thumb">
                      <div class="thumb-placeholder source-thumb">
                        <span class="source-type-icon">
                          {#if src.type === 'webcam'}CAM{:else if src.type === 'capture'}SCR{:else}SPT{/if}
                        </span>
                        {#if src.status === 'live'}
                          <span class="thumb-live-dot"></span>
                        {/if}
                      </div>
                    </div>
                    <div class="item-info">
                      <span class="item-name">{src.name}</span>
                      <span class="item-type">{src.status}</span>
                    </div>
                    <button class="vj-src-stop" onclick={() => vjStopSource(src.id)} title="Stop">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          {:else if vjMediaTab === 'plugins'}
            <!-- Plugins Panel (FluidGen, Particles3D) - Integrated WebGL effects -->
            <div class="vj-plugins-panel">
              {#each vjPlugins as plugin (plugin.id)}
                <div
                  class="vj-plugin-card running"
                  draggable="true"
                  ondragstart={(e) => {
                    const clipType = plugin.effectType === 'splat' ? 'splat' : plugin.effectType === 'model3d' ? 'model3d' : 'effect';
                    handleDragStart(e, { type: clipType, id: plugin.id, effectType: plugin.effectType, pluginName: plugin.name });
                  }}
                  ondragend={handleDragEnd}
                >
                  <div class="vj-plugin-icon" class:fluid={plugin.icon === 'fluid'} class:particles={plugin.icon === 'particles'} class:splat={plugin.icon === 'splat'} class:model3d={plugin.icon === 'model3d'}>
                    {#if plugin.icon === 'fluid'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 2C6.5 8 4 12 4 15a8 8 0 1 0 16 0c0-3-2.5-7-8-13Z"/>
                      </svg>
                    {:else if plugin.icon === 'splat'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="1.5"/>
                        <circle cx="8" cy="8" r="1"/>
                        <circle cx="16" cy="8" r="1"/>
                        <circle cx="6" cy="14" r="1"/>
                        <circle cx="18" cy="14" r="1"/>
                        <circle cx="10" cy="18" r="1"/>
                        <circle cx="15" cy="17" r="1"/>
                        <circle cx="4" cy="10" r="0.8"/>
                        <circle cx="20" cy="10" r="0.8"/>
                        <circle cx="12" cy="6" r="0.8"/>
                        <circle cx="9" cy="12" r="0.6"/>
                        <circle cx="15" cy="12" r="0.6"/>
                      </svg>
                    {:else if plugin.icon === 'model3d'}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5Z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                      </svg>
                    {:else}
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="3"/>
                        <circle cx="5" cy="5" r="2"/>
                        <circle cx="19" cy="5" r="2"/>
                        <circle cx="5" cy="19" r="2"/>
                        <circle cx="19" cy="19" r="2"/>
                      </svg>
                    {/if}
                  </div>
                  <div class="vj-plugin-info">
                    <span class="vj-plugin-name">{plugin.name}</span>
                    <span class="vj-plugin-desc">{plugin.description}</span>
                    <span class="vj-plugin-status live">
                      Native WebGL
                    </span>
                  </div>
                </div>
              {/each}
              <div class="vj-plugin-hint">
                <p>Drag effect onto a clip slot to use it</p>
                <p>Effects run natively in WebGL - no external process needed</p>
              </div>
            </div>
          {:else if vjMediaTab === 'library'}
            <!-- Saved shaders/videos -->
            {#if savedShaders.length === 0 && savedVideos.length === 0}
              <div class="empty-media">
                <p>No saved items</p>
                <p class="hint">Generate shaders or videos with AI to save them here</p>
              </div>
            {:else}
              {#each savedShaders as saved (saved.id)}
                <div
                  class="media-item"
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, { type: 'shader', id: saved.id })}
                  ondragend={handleDragEnd}
                  role="button"
                  tabindex="0"
                >
                  <div class="item-thumb">
                    {#if saved.thumbnail}
                      <img src={saved.thumbnail} alt={saved.name} />
                    {:else}
                      <div class="thumb-placeholder shader"><span>ISF</span></div>
                    {/if}
                  </div>
                  <div class="item-info">
                    <span class="item-name">{saved.name}</span>
                    <span class="item-type">saved shader</span>
                  </div>
                </div>
              {/each}
              {#each savedVideos as vid (vid.id)}
                <div class="media-item" draggable="true" ondragstart={(e) => handleDragStart(e, { type: 'video', id: vid.id })} ondragend={handleDragEnd} role="button" tabindex="0">
                  <div class="item-thumb">
                    {#if vid.thumbnail}
                      <img src={vid.thumbnail} alt={vid.name} />
                    {:else}
                      <div class="thumb-placeholder video"><span>VID</span></div>
                    {/if}
                  </div>
                  <div class="item-info">
                    <span class="item-name">{vid.name}</span>
                    <span class="item-type">saved video</span>
                  </div>
                </div>
              {/each}
            {/if}
          {:else if vjFilteredMedia.length === 0}
            <div class="empty-media">
              <p>No media available</p>
              <p class="hint">Drag & drop files or use AI Generate</p>
            </div>
          {:else}
            {#each vjFilteredMedia as item (item.id)}
              <div
                class="media-item"
                class:dragging={draggedClip?.id === item.id}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, { type: item.itemType, id: item.id })}
                ondragend={handleDragEnd}
                role="button"
                tabindex="0"
              >
                <div class="item-thumb">
                  {#if item.thumbnail}
                    <img src={item.thumbnail} alt={item.name} />
                  {:else}
                    <div class="thumb-placeholder {item.itemType}">
                      <span>{item.itemType === 'shader' ? 'ISF' : item.itemType === 'video' ? 'VID' : item.itemType === 'threejs' ? '3JS' : 'IMG'}</span>
                    </div>
                  {/if}
                </div>
                <div class="item-info">
                  <span class="item-name">{item.name}</span>
                  <span class="item-type">{item.itemType}</span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
        {/if}
      </div>
      </div> <!-- End vj-bottom -->
    </div>

  </div>
{/if}

<!-- Performer - persists outside VJ panel lifecycle to avoid destroy/recreate on VJ close -->
{#if performerStarted}
  <div class="performer-overlay" class:hidden={!showPerformer || !$vjClipLauncher.isOpen} style="top: {performerTop}px">
    <div
      class="performer-resize-handle"
      onpointerdown={onPerformerResizeStart}
      onpointermove={onPerformerResizeMove}
      onpointerup={onPerformerResizeEnd}
      onpointercancel={onPerformerResizeEnd}
    >
      <div class="resize-grip"></div>
    </div>
    <SynthVision onClose={() => showPerformer = false} visible={showPerformer} />
  </div>
{/if}

<!-- Effect Picker Modal (full catalog, multi-select, 3-col grid) -->
<EffectPickerModal
  bind:open={showEffectPicker}
  onAdd={handlePickerAdd}
  onClose={() => showEffectPicker = false}
/>

<style>
  /* VJ Overlay */
  .vj-overlay {
    position: fixed;
    inset: 0;
    background: #0a0a0a;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    transition: bottom 0.2s ease-out;
  }
  .vj-overlay.kf-tray-open {
    bottom: 300px;
  }

  /* Header Stage/Mix toggle */
  .header-stage {
    display: flex;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #444;
  }

  .stage-mix-btn {
    padding: 6px 16px;
    background: #1a1a1a;
    border: none;
    color: #888;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .stage-mix-btn:first-child {
    border-right: 1px solid #444;
  }

  .stage-mix-btn:hover {
    color: #fff;
    background: #2a2a2a;
  }

  .stage-mix-btn.active {
    background: #f90;
    color: #000;
  }

  /* Header */
  .vj-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 20px;
    background: #141414;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .header-left, .header-center, .header-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .vj-logo {
    height: 28px;
    width: auto;
    margin-right: 12px;
  }

  .vj-file-menu-container { position: relative; margin-right: 12px; }
  .vj-file-menu-btn {
    display: flex; align-items: center; gap: 4px;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #ddd; font-size: 12px; padding: 5px 10px; border-radius: 4px; cursor: pointer;
  }
  .vj-file-menu-btn:hover, .vj-file-menu-btn.active { background: rgba(255,255,255,0.14); color: #fff; }
  .vj-file-menu-dropdown {
    position: absolute; top: 100%; left: 0; margin-top: 4px;
    background: #1a1a1e; border: 1px solid #333; border-radius: 6px;
    min-width: 220px; padding: 4px 0; z-index: 10000;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .vj-menu-item {
    display: flex; justify-content: space-between; align-items: center;
    width: 100%; background: none; border: none; color: #ddd;
    font-size: 12px; padding: 7px 14px; cursor: pointer; text-align: left;
  }
  .vj-menu-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .vj-menu-sc { color: #666; font-size: 10px; margin-left: 16px; font-family: monospace; }
  .vj-menu-sep { height: 1px; background: #333; margin: 4px 0; }

  .live-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: #222;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    color: #555;
  }

  .live-indicator.active {
    background: #ff3333;
    color: #fff;
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }

  .live-indicator.active .live-dot {
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .master-control {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-left: 20px;
    border-left: 1px solid #333;
  }

  .master-label {
    font-size: 10px;
    font-weight: 600;
    color: #666;
  }

  .master-slider {
    width: 120px;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: #000000;
    border-radius: 3px;
    cursor: pointer;
  }
  .master-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    background: #BB86FC;
    border-radius: 50%;
    cursor: pointer;
  }

  .master-value {
    font-size: 12px;
    color: #888;
    min-width: 40px;
  }

  .stop-all-btn {
    background: #ff3333;
    border: none;
    color: #fff;
    padding: 8px 20px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .stop-all-btn:hover {
    background: #ff5555;
  }

  /* VJ Recording */
  .vj-rec-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #333;
    border: 1px solid #555;
    color: #ff4444;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-rec-btn:hover {
    background: #ff4444;
    border-color: #ff4444;
    color: #fff;
  }

  .vj-stop-rec-btn {
    background: #ff4444;
    border: none;
    color: #fff;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .vj-stop-rec-btn:hover {
    background: #ff6666;
  }

  .vj-recording-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .vj-rec-dot {
    width: 8px;
    height: 8px;
    background: #ff4444;
    border-radius: 50%;
    animation: vj-rec-blink 1s infinite;
  }

  @keyframes vj-rec-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .vj-rec-time {
    font-size: 11px;
    font-weight: 600;
    color: #ff4444;
    font-family: monospace;
  }

  .minimize-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #ccc;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .minimize-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .exit-btn {
    background: #333;
    border: 1px solid #555;
    color: #aaa;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .exit-btn:hover {
    background: #444;
    color: #fff;
  }

  /* Main Layout */
  .vj-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Preview Section - 3 columns: effects | preview | shader params */
  .vj-preview-section {
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    padding: 8px;
    background: #0a0a0a;
    gap: 8px;
    min-height: 150px;
  }
  .vj-preview-section.reversed { flex-direction: row-reverse; }

  /* Resize handle between preview and grid */
  .preview-resize-handle {
    flex-shrink: 0;
    height: 6px;
    background: #1a1a1a;
    border-top: 1px solid #333;
    border-bottom: 1px solid #333;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }

  .preview-resize-handle:hover,
  .preview-resize-handle:active {
    background: #2a2a2a;
  }

  .resize-grip {
    width: 40px;
    height: 2px;
    background: #555;
    border-radius: 1px;
  }

  .preview-resize-handle:hover .resize-grip {
    background: #888;
  }

  /* LEFT: Effects Panel */
  .effects-panel-vj {
    width: 220px;
    flex-shrink: 0;
    background: #111;
    border: 1px solid #161618;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .effects-tabs {
    display: flex;
    background: #181818;
    border-bottom: 1px solid #161618;
  }

  .fx-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 4px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #666;
    font-size: 9px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .fx-tab:hover {
    color: #aaa;
  }

  .fx-tab.active {
    color: #BB86FC;
    border-bottom-color: #BB86FC;
    background: rgba(187, 134, 252, 0.05);
  }

  .effects-panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .effects-panel-content::-webkit-scrollbar { width: 4px; }
  .effects-panel-content::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  .effects-info {
    margin-bottom: 8px;
  }

  .effects-info-label {
    font-size: 10px;
    font-weight: 700;
    color: #BB86FC;
    letter-spacing: 0.5px;
  }

  .effects-info-hint {
    font-size: 9px;
    color: #555;
    margin: 2px 0 0;
  }

  .effects-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .effects-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    color: #888;
  }

  .add-effect-btn {
    background: rgba(187, 134, 252, 0.1);
    border: 1px solid rgba(187, 134, 252, 0.3);
    color: #BB86FC;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .add-effect-btn:hover {
    background: rgba(187, 134, 252, 0.2);
    border-color: #BB86FC;
  }

  .effects-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .effect-item {
    background: #0d0d10;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .effect-item + .effect-item {
    margin-top: 3px;
  }

  .effect-item.disabled { opacity: 0.4; }

  .effect-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .effect-header:hover { background: #111114; }

  .effect-toggle {
    background: none;
    border: none;
    color: #BB86FC;
    font-size: 12px;
    cursor: pointer;
    padding: 2px;
    width: 18px;
    text-align: center;
  }

  .effect-toggle:not(.active) { color: #555; }

  .effect-name {
    flex: 1;
    font-size: 11px;
    color: #ddd;
    text-transform: capitalize;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .effect-expand {
    font-size: 8px;
    color: #666;
    padding: 2px;
  }

  .effect-delete {
    background: none;
    border: none;
    color: #555;
    font-size: 16px;
    cursor: pointer;
    padding: 2px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .effect-header:hover .effect-delete { opacity: 1; }
  .effect-delete:hover { color: #ff4444; }

  .effect-params {
    padding: 8px 12px 10px;
    background: rgba(22, 22, 26, 0.8);
    border-top: 1px solid rgba(187, 134, 252, 0.1);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 10px;
    color: #999;
    padding: 6px 0;
  }

  .param-row + .param-row {
    border-top: 1px solid rgba(255, 255, 255, 0.03);
  }

  .param-row .param-name,
  .param-row span:first-child {
    width: 56px;
    flex-shrink: 0;
    font-weight: 500;
    color: #aaa;
    letter-spacing: 0.2px;
  }

  .param-row input[type="range"] {
    flex: 1;
    height: 6px;
    accent-color: #BB86FC;
    border-radius: 3px;
    cursor: pointer;
  }

  .param-row input[type="range"]::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
  }

  .param-value {
    width: 38px;
    text-align: right;
    color: #777;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }

  .no-effects {
    color: #555;
    font-size: 10px;
    text-align: center;
    padding: 16px 8px;
  }

  .no-params {
    color: #555;
    font-style: italic;
  }

  /* CENTER: Preview wrapper + 16:9 container */
  .preview-wrapper {
    flex: 1;
    position: relative;
    min-width: 0;
  }

  .preview-container {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    height: 100%;
    aspect-ratio: 16 / 9;
    max-width: 100%;
    background: #000;
    border: 2px solid #333;
    border-radius: 4px;
    overflow: hidden;
  }

  .preview-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  .preview-label {
    position: absolute;
    top: 8px;
    left: 8px;
    font-size: 9px;
    font-weight: 600;
    color: #555;
    background: rgba(0, 0, 0, 0.6);
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
  }

  /* RIGHT: Shader Params Panel (above media tabs) */
  .right-panel-vj {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.2s ease;
  }

  .right-panel-vj.collapsed {
    width: 0;
    padding: 0;
  }

  .shader-params-panel {
    background: #111;
    border: 1px solid #161618;
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .shader-params-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #181818;
    border-bottom: 1px solid #161618;
    flex-shrink: 0;
  }

  .shader-params-overlay-title {
    font-size: 10px;
    font-weight: 600;
    color: #BB86FC;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shader-params-layer-badge {
    font-size: 8px;
    padding: 1px 4px;
    background: #BB86FC30;
    border: 1px solid #BB86FC50;
    border-radius: 3px;
    color: #BB86FC;
    font-weight: 700;
  }

  .shader-params-close {
    background: none;
    border: none;
    color: #666;
    font-size: 16px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
  }

  .shader-params-close:hover {
    color: #ff4444;
  }

  .shader-params-panel-list {
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .shader-params-panel-list::-webkit-scrollbar { width: 4px; }
  .shader-params-panel-list::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

  /* Bottom Section: Grid + Media Tray */
  .vj-bottom {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 200px;
  }
  /* Media tray stays right; only the grid internals flip */

  /* Layer select icon */
  .layer-select-icon {
    width: 20px;
    height: 20px;
    background: #222;
    border: 1px solid #444;
    border-radius: 3px;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .layer-select-icon:hover {
    border-color: #BB86FC;
    color: #BB86FC;
  }

  .layer-select-icon.selected {
    background: #BB86FC20;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* Grid Section */
  .grid-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: auto;
    background: #0e0e0e;
    padding: 12px;
  }

  .column-headers {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    position: sticky;
    top: 0;
    background: #0e0e0e;
    z-index: 10;
    padding-bottom: 8px;
  }

  .layer-controls-header {
    width: 150px;
    flex-shrink: 0;
  }

  .column-trigger {
    flex: 1;
    height: 28px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: #888;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.1s;
  }

  .column-trigger:hover {
    background: #BB86FC;
    border-color: #BB86FC;
    color: #000;
  }

  .layer-row {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }

  /* Reversed layout: controls on right, clips flow left-to-right */
  .grid-section.reversed .column-headers { flex-direction: row-reverse; }
  .grid-section.reversed .layer-row { flex-direction: row-reverse; }

  .layer-row.selected .layer-controls {
    border-color: #BB86FC;
  }

  .layer-controls {
    width: 150px;
    flex-shrink: 0;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .layer-controls:hover {
    border-color: #444;
  }

  .layer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .layer-num {
    font-size: 14px;
    font-weight: 700;
    color: #888;
  }

  .layer-buttons {
    display: flex;
    gap: 2px;
  }

  .layer-btn {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.1s;
  }

  .layer-btn.solo {
    background: #333;
    color: #666;
  }

  .layer-btn.solo:hover {
    background: #444;
    color: #FFD54F;
  }

  .layer-btn.solo.active {
    background: #FFD54F;
    color: #000;
  }

  .layer-btn.mute {
    background: #333;
    color: #666;
  }

  .layer-btn.mute:hover {
    background: #444;
    color: #ff4444;
  }

  .layer-btn.mute.active {
    background: #ff4444;
    color: #fff;
  }

  .layer-btn.stop {
    background: #333;
    color: #666;
  }

  .layer-btn.stop:hover {
    background: #ff4444;
    color: #fff;
  }

  .opacity-slider {
    width: 100%;
    height: 18px;
    accent-color: #BB86FC;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    outline: none;
    margin: 0;
    padding: 0;
  }

  .opacity-slider::-webkit-slider-runnable-track {
    width: 100%;
    height: 8px;
    background: #000000;
    border-radius: 4px;
    cursor: pointer;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #BB86FC;
    cursor: pointer;
    border: 2px solid #111;
    margin-top: -5px;
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.4);
  }

  .opacity-slider::-webkit-slider-thumb:hover {
    background: #9ef0ff;
    transform: scale(1.2);
    box-shadow: 0 0 8px rgba(187, 134, 252, 0.6);
  }

  .blend-select {
    width: 100%;
    background-color: #161618;
    border: 1px solid #444;
    color: #aaa;
    padding: 5px 8px;
    border-radius: 3px;
    font-size: 10px;
    cursor: pointer;
  }

  /* Clip Cells */
  .clip-cell {
    flex: 1;
    aspect-ratio: 16 / 9;
    min-width: 0;
    min-height: 60px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.1s;
    position: relative;
  }

  .clip-cell:hover {
    border-color: #555;
  }

  .clip-cell.has-clip:hover {
    border-color: #BB86FC;
  }

  .clip-cell.active {
    border-color: #BB86FC;
    box-shadow: 0 0 12px rgba(187, 134, 252, 0.4);
  }

  .clip-cell.dragover {
    border-color: #BB86FC;
    background: #1a2530;
  }

  .clip-content {
    width: 100%;
    height: 100%;
    position: relative;
  }

  .clip-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .clip-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
  }

  .clip-placeholder.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }

  .clip-placeholder.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }

  .clip-placeholder.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }

  .clip-placeholder.spout {
    background: linear-gradient(135deg, #4a3a2a, #3a2a2a);
    color: #ffa050;
  }

  .clip-placeholder.threejs {
    background: linear-gradient(135deg, #2a4a4a, #2a3a3a);
    color: #50c0c0;
  }

  .clip-placeholder.splat {
    background: linear-gradient(135deg, #1a3a2a, #2a3a2a);
    color: #34d399;
  }

  .clip-placeholder.model3d {
    background: linear-gradient(135deg, #3a3a1a, #3a2a1a);
    color: #fbbf24;
  }

  .clip-placeholder.effect {
    background: linear-gradient(135deg, #2a2a4a, #2a2a3a);
    color: #a78bfa;
  }

  .clip-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.8);
    font-size: 8px;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .clear-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    background: rgba(255, 50, 50, 0.9);
    border: none;
    border-radius: 50%;
    color: #fff;
    font-size: 10px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s;
    padding: 0;
    line-height: 1;
  }

  .clip-cell:hover .clear-btn {
    opacity: 1;
  }

  .empty-cell {
    width: 100%;
    height: 100%;
  }

  /* Context menu */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ctx-menu {
    position: fixed;
    z-index: 1000;
    background: #1a1a1e;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 4px 0;
    min-width: 100px;
    box-shadow: 0 4px 12px rgba(0,0,0,.5);
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 6px 14px;
    background: none;
    border: none;
    color: #ccc;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .ctx-item:hover {
    background: rgba(255,255,255,.08);
    color: #fff;
  }
  .ctx-danger { color: #ff6b6b; }
  .ctx-danger:hover { background: rgba(255,80,80,.12); color: #ff4444; }
  .ctx-disabled { color: #555; cursor: default; }
  .ctx-disabled:hover { background: none; color: #555; }

  /* Media Tray (compact, matching mapping mode) */
  .media-tray-vj {
    width: 220px;
    background: #111114;
    border-left: 1px solid #161618;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.2s ease;
  }

  .media-tray-vj.collapsed {
    width: 40px;
    min-width: 40px;
  }

  .tray-collapse-btn {
    width: 100%;
    height: 36px;
    background: #111114;
    border: none;
    border-bottom: 1px solid #161618;
    color: #888;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .tray-collapse-btn:hover {
    color: #BB86FC;
  }

  /* VJ Tab Row (matching mapping mode icons) */
  .vj-tabs {
    background: #0d0d10;
    border-bottom: 1px solid #161618;
  }

  .vj-tab-row {
    display: flex;
  }

  .vj-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px 6px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #666;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.15s;
    position: relative;
  }

  .vj-tab:hover {
    color: #aaa;
    background: rgba(187, 134, 252, 0.03);
  }

  .vj-tab.active {
    color: #BB86FC;
    border-bottom-color: #BB86FC;
    background: rgba(187, 134, 252, 0.06);
  }

  .vj-tab svg {
    opacity: 0.7;
  }

  .vj-tab.active svg {
    opacity: 1;
  }

  .vj-tab-count {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 8px;
    color: #555;
    font-weight: 600;
  }

  .vj-tab.active .vj-tab-count {
    color: #BB86FC;
  }

  .vj-tab-count.live {
    color: #22c55e;
  }

  /* AI Generator Section */
  .vj-ai-section {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    background: #0d0d10;
    border-bottom: 1px solid #161618;
  }

  .vj-ai-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    background: linear-gradient(135deg, #2a1a3a, #1a2a3a);
    border: 1px solid #a855f740;
    border-radius: 4px;
    color: #a855f7;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-ai-btn:hover {
    border-color: #a855f7;
    background: linear-gradient(135deg, #3a2a4a, #2a3a4a);
  }

  .vj-ai-video-btn {
    background: linear-gradient(135deg, #1a2a3a, #1a3a2a);
    border-color: #3b82f640;
    color: #3b82f6;
  }

  .vj-ai-video-btn:hover {
    border-color: #3b82f6;
    background: linear-gradient(135deg, #2a3a4a, #2a4a3a);
  }

  .vj-ai-container {
    border-bottom: 1px solid #161618;
    max-height: 300px;
    overflow-y: auto;
  }

  .loading {
    padding: 12px;
    font-size: 11px;
    color: #666;
    text-align: center;
  }

  .media-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-auto-rows: 80px;
    gap: 4px;
    align-content: start;
    position: relative;
    transition: background 0.15s, outline-color 0.15s;
    outline: 2px dashed transparent;
    outline-offset: -4px;
  }
  .media-list.vj-media-drag-over {
    background: rgba(120, 180, 255, 0.08);
    outline-color: rgba(120, 180, 255, 0.6);
  }
  .vj-import-bar {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .vj-import-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 10px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    color: #ddd;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .vj-import-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }

  .empty-media {
    text-align: center;
    color: #444;
    padding: 20px 12px;
    grid-column: 1 / -1;
  }

  .empty-media p {
    margin: 0;
    font-size: 11px;
  }

  .empty-media .hint {
    font-size: 9px;
    color: #333;
    margin-top: 8px;
  }

  .media-item {
    position: relative;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .media-item:hover {
    transform: scale(1.02);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .media-item.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .item-thumb {
    width: 100%;
    height: 100%;
  }

  .item-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 600;
  }

  .thumb-placeholder.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }

  .thumb-placeholder.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }

  .thumb-placeholder.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }

  .thumb-placeholder.threejs {
    background: linear-gradient(135deg, #4a3a2a, #3a2a1a);
    color: #c0a080;
  }

  .item-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.8);
  }

  .item-name {
    font-size: 9px;
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-type {
    font-size: 8px;
    color: #888;
    text-transform: uppercase;
  }

  /* Scrollbar */
  .media-list::-webkit-scrollbar,
  .grid-section::-webkit-scrollbar {
    width: 6px;
  }

  .media-list::-webkit-scrollbar-track,
  .grid-section::-webkit-scrollbar-track {
    background: #141414;
  }

  .media-list::-webkit-scrollbar-thumb,
  .grid-section::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
  }

  .media-list::-webkit-scrollbar-thumb:hover,
  .grid-section::-webkit-scrollbar-thumb:hover {
    background: #444;
  }

  /* Blocks Tab Bar */
  .blocks-tab-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 4px 0;
  }

  .blocks-tabs {
    display: flex;
    gap: 4px;
    flex: 1;
    overflow-x: auto;
  }

  .blocks-tabs::-webkit-scrollbar {
    height: 4px;
  }

  .blocks-tabs::-webkit-scrollbar-track {
    background: #141414;
  }

  .blocks-tabs::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 2px;
  }

  .block-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    min-width: 80px;
  }

  .block-tab:hover {
    background: #111114;
    border-color: #444;
  }

  .block-tab.active {
    background: #BB86FC;
    border-color: #BB86FC;
    color: #000;
  }

  .block-tab.active .block-name {
    color: #000;
  }

  .block-name {
    font-size: 11px;
    font-weight: 600;
    color: #aaa;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .block-name-input {
    background: #111;
    border: 1px solid #BB86FC;
    border-radius: 3px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    width: 80px;
    outline: none;
  }

  .block-delete-btn {
    background: none;
    border: none;
    color: #666;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    width: 16px;
    height: 16px;
    line-height: 16px;
    text-align: center;
    border-radius: 50%;
    opacity: 0;
    transition: all 0.1s;
  }

  .block-tab:hover .block-delete-btn {
    opacity: 1;
  }

  .block-delete-btn:hover {
    background: rgba(255, 68, 68, 0.3);
    color: #ff4444;
  }

  .block-tab.active .block-delete-btn {
    color: #333;
  }

  .block-tab.active .block-delete-btn:hover {
    background: rgba(0, 0, 0, 0.2);
    color: #000;
  }

  .add-block-btn {
    width: 28px;
    height: 28px;
    background: #222;
    border: 1px dashed #444;
    border-radius: 4px;
    color: #666;
    font-size: 18px;
    font-weight: 300;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .add-block-btn:hover {
    background: #333;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* Layer Live Preview */
  .layer-live-preview {
    width: 56px;
    height: 42px;
    flex-shrink: 0;
    background: #0a0a0a;
    border: 2px solid #222;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
  }

  .layer-live-preview:active {
    cursor: grabbing;
  }

  .layer-live-preview.has-clip {
    border-color: #BB86FC;
    box-shadow: 0 0 8px rgba(187, 134, 252, 0.3);
  }

  .live-preview-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .live-preview-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
  }

  .live-preview-placeholder.shader {
    background: linear-gradient(135deg, #3a2a4a, #2a2a3a);
    color: #a080c0;
  }

  .live-preview-placeholder.video {
    background: linear-gradient(135deg, #2a3a4a, #2a2a3a);
    color: #80a0c0;
  }

  .live-preview-placeholder.image {
    background: linear-gradient(135deg, #3a4a2a, #2a3a2a);
    color: #a0c080;
  }

  .live-preview-placeholder.spout {
    background: linear-gradient(135deg, #4a3a2a, #3a2a2a);
    color: #ffa050;
  }

  .live-preview-placeholder.threejs {
    background: linear-gradient(135deg, #2a4a4a, #2a3a3a);
    color: #50c0c0;
  }

  .live-preview-empty {
    color: #333;
    font-size: 14px;
  }

  .live-indicator-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    background: #ff3333;
    border-radius: 50%;
    animation: blink 1s infinite;
  }

  /* Layer Row Dragging */
  .layer-row {
    cursor: grab;
  }

  .layer-row:active {
    cursor: grabbing;
  }

  .layer-row.dragging {
    opacity: 0.5;
    background: #0d0d10;
  }

  .layer-row.drag-over {
    border-top: 2px solid #BB86FC;
    margin-top: -2px;
  }

  .live-preview-header {
    width: 56px;
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 600;
    color: #666;
    text-align: center;
    padding: 4px 0;
  }

  /* Sources Filter */
  .sources-filter-btn {
    position: relative;
  }

  .vj-live-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: #22c55e;
    color: #000;
    font-size: 8px;
    font-weight: 700;
    margin-left: 3px;
    vertical-align: middle;
  }

  .vj-sources-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    grid-column: 1 / -1;
  }

  .vj-sources-btns {
    display: flex;
    gap: 4px;
  }

  .vj-src-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 4px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 4px;
    color: #aaa;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .vj-src-btn:hover {
    border-color: #BB86FC;
    color: #BB86FC;
    background: #1a2a2d;
  }

  .vj-source-item {
    position: relative;
  }

  .vj-source-item.source-live {
    border-left: 2px solid #22c55e;
  }

  .source-thumb {
    background: #111 !important;
    position: relative;
  }

  .source-type-icon {
    font-size: 9px;
    font-weight: 700;
    color: #BB86FC;
    letter-spacing: 0.5px;
  }

  .thumb-live-dot {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e80;
  }

  .vj-src-stop {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border-radius: 3px;
    border: none;
    background: rgba(0,0,0,0.6);
    color: #888;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
  }

  .vj-source-item:hover .vj-src-stop {
    opacity: 1;
  }

  .vj-src-stop:hover {
    color: #f44;
    background: rgba(255,68,68,0.2);
  }

  /* ========== Audio Control Bar ========== */
  /* Audio bar styles moved to VJAudioBar.svelte (see extraction note in template) */

  /* ========== Shader Parameters ========== */
  .active-clip-name {
    font-size: 10px;
    color: #BB86FC;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }

  .shader-params-section {
    border-bottom: 1px solid #161618;
    padding-bottom: 8px;
    margin-bottom: 8px;
  }

  .section-header {
    padding: 6px 0;
    font-size: 10px;
    font-weight: 700;
    color: #BB86FC;
    letter-spacing: 0.5px;
  }

  .shader-params-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shader-param {
    padding: 4px 0;
    border-left: 2px solid transparent;
    padding-left: 6px;
  }

  .shader-param.modulated {
    border-left-color: #a855f7;
    background: rgba(168, 85, 247, 0.05);
    border-radius: 0 4px 4px 0;
  }

  .shader-param-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    margin-bottom: 3px;
  }

  .shader-param-name {
    font-size: 10px;
    color: #aaa;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .mod-source-select {
    font-size: 9px;
    padding: 1px 2px;
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 3px;
    color: #666;
    cursor: pointer;
    max-width: 70px;
  }

  .mod-source-select.active {
    border-color: #a855f7;
    color: #a855f7;
    background: #1a1a2a;
  }

  .shader-param-slider {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .slider-track-wrap {
    position: relative;
    flex: 1;
  }

  .param-slider {
    width: 100%;
    height: 3px;
    accent-color: #BB86FC;
  }

  .mod-ghost {
    position: absolute;
    top: 50%;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #5ce1e6;
    box-shadow: 0 0 6px #5ce1e6;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
    transition: left 0.03s linear;
  }

  .param-val {
    font-size: 9px;
    color: #555;
    font-variant-numeric: tabular-nums;
    min-width: 32px;
    text-align: right;
  }

  .shader-param-toggle {
    display: flex;
  }

  .bool-toggle {
    padding: 2px 10px;
    border: 1px solid #333;
    border-radius: 3px;
    background: #0d0d10;
    color: #666;
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.1s;
  }

  .bool-toggle.on {
    background: #1a3a1a;
    border-color: #22c55e;
    color: #22c55e;
  }

  .shader-param-select {
    display: flex;
  }

  .long-select {
    width: 100%;
    font-size: 10px;
    padding: 5px 8px;
    background-color: #0d0d10;
    border: 1px solid #333;
    border-radius: 3px;
    color: #aaa;
  }

  .audio-ready-badge {
    display: inline-block;
    font-size: 10px;
    color: #5ce1e6;
    background: rgba(92, 225, 230, 0.15);
    border: 1px solid rgba(92, 225, 230, 0.3);
    border-radius: 3px;
    padding: 0 4px;
    margin-left: 4px;
    line-height: 1.4;
    vertical-align: middle;
  }

  .audio-warn {
    font-size: 9px;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 3px;
    padding: 4px 6px;
    margin: 0 0 6px 0;
    line-height: 1.4;
  }

  .mod-amount-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding-left: 2px;
  }

  .mod-amount-label {
    font-size: 9px;
    color: #a855f7;
    min-width: 30px;
  }

  .mod-amount-slider {
    flex: 1;
    height: 4px;
    accent-color: #a855f7;
  }

  .mod-amount-val {
    font-size: 8px;
    color: #a855f7;
    min-width: 28px;
    text-align: right;
  }

  /* Performer Button */
  .performer-btn {
    padding: 6px 14px;
    background: rgba(187, 134, 252, .06);
    border: 1px solid rgba(187, 134, 252, .2);
    border-radius: 4px;
    color: #BB86FC;
    font-family: 'Orbitron', monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    cursor: pointer;
    transition: all .15s;
  }
  .performer-btn:hover {
    background: rgba(187, 134, 252, .12);
    border-color: rgba(187, 134, 252, .4);
  }
  .performer-btn.active {
    background: rgba(187, 134, 252, .15);
    border-color: rgba(187, 134, 252, .5);
    box-shadow: 0 0 12px rgba(187, 134, 252, .2);
  }

  /* Performer Overlay - aligns exactly over vj-bottom section */
  .performer-overlay {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    /* top is set dynamically via inline style */
    z-index: 1001; /* Above vj-overlay (z-index: 1000) */
    animation: performer-slide-up .25s ease-out;
    display: flex;
    flex-direction: column;
  }

  .performer-resize-handle {
    flex-shrink: 0;
    height: 8px;
    background: #111;
    border-bottom: 1px solid #333;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    touch-action: none;
  }

  .performer-resize-handle:hover,
  .performer-resize-handle:active {
    background: #222;
  }

  .performer-resize-handle .resize-grip {
    width: 48px;
    height: 3px;
    background: #555;
    border-radius: 2px;
  }

  .performer-resize-handle:hover .resize-grip {
    background: #999;
  }
  .performer-overlay.hidden {
    pointer-events: none;
    opacity: 0;
    transform: translateY(100%);
    transition: opacity .2s, transform .25s;
  }
  @keyframes performer-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Performer button running state (playing in background) */
  .performer-btn.running {
    background: rgba(105, 240, 174, .08);
    border-color: rgba(105, 240, 174, .3);
    color: #69F0AE;
    animation: sv-pulse 2s ease-in-out infinite;
  }
  @keyframes sv-pulse {
    0%, 100% { box-shadow: 0 0 4px rgba(105, 240, 174, .2); }
    50% { box-shadow: 0 0 12px rgba(105, 240, 174, .4); }
  }

  /* Plugin Panel Styles */
  .vj-plugins-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .vj-plugin-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    border: 1px solid #333;
    border-radius: 6px;
    cursor: grab;
    transition: all 0.2s;
  }

  .vj-plugin-card:hover {
    border-color: #BB86FC;
    box-shadow: 0 0 8px rgba(187, 134, 252, 0.15);
  }

  .vj-plugin-card.running {
    border-color: #4ade80;
    background: linear-gradient(135deg, #1a2e1a, #16213e);
  }

  .vj-plugin-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
  }

  .vj-plugin-icon.fluid {
    color: #60a5fa;
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.2), rgba(96, 165, 250, 0.05));
  }

  .vj-plugin-icon.particles {
    color: #f472b6;
    background: linear-gradient(135deg, rgba(244, 114, 182, 0.2), rgba(244, 114, 182, 0.05));
  }

  /* Splat / Model3D param panel details sections */
  .shader-params-panel details {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .shader-params-panel summary {
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #aaa;
    cursor: pointer;
    user-select: none;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .shader-params-panel summary:hover {
    color: #ddd;
    background: rgba(255, 255, 255, 0.03);
  }

  .shader-params-panel details[open] summary {
    color: #bb86fc;
    border-bottom: 1px solid rgba(187, 134, 252, 0.1);
  }

  .shader-params-panel details > div {
    padding: 4px 8px 8px;
  }

  .shader-params-panel .param-row select {
    flex: 1;
    background-color: #1a1a1e;
    border: 1px solid #333;
    color: #ccc;
    border-radius: 3px;
    font-size: 11px;
    padding: 2px 4px;
  }

  .splat-params-panel {
    border-color: rgba(52, 211, 153, 0.2);
  }

  .model3d-params-panel {
    border-color: rgba(251, 191, 36, 0.2);
  }

  .vj-plugin-icon.splat {
    color: #34d399;
    background: linear-gradient(135deg, rgba(52, 211, 153, 0.2), rgba(52, 211, 153, 0.05));
  }

  .vj-plugin-icon.model3d {
    color: #fbbf24;
    background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.05));
  }

  .vj-plugin-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .vj-plugin-name {
    font-size: 12px;
    font-weight: 600;
    color: #eee;
  }

  .vj-plugin-desc {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .vj-plugin-status {
    font-size: 9px;
    color: #666;
  }

  .vj-plugin-status.live {
    color: #4ade80;
  }

  .vj-plugin-actions {
    flex-shrink: 0;
  }

  .vj-plugin-btn {
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid transparent;
  }

  .vj-plugin-btn.start {
    background: linear-gradient(135deg, #166534, #15803d);
    color: #4ade80;
    border-color: #22c55e;
  }

  .vj-plugin-btn.start:hover {
    box-shadow: 0 0 8px rgba(74, 222, 128, 0.3);
  }

  .vj-plugin-btn.stop {
    background: linear-gradient(135deg, #7f1d1d, #991b1b);
    color: #f87171;
    border-color: #ef4444;
  }

  .vj-plugin-btn.stop:hover {
    box-shadow: 0 0 8px rgba(248, 113, 113, 0.3);
  }

  .vj-plugin-hint {
    text-align: center;
    padding: 12px;
    color: #555;
    font-size: 10px;
  }

  .vj-plugin-hint p {
    margin: 2px 0;
  }

  /* ── Grid Dimension Controls ── */
  .grid-dimension-controls {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 0;
    margin-bottom: 8px;
  }

  .dim-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .dim-label {
    font-size: 10px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
  }

  .dim-btn {
    width: 22px;
    height: 22px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ccc;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0;
  }

  .dim-btn:hover {
    background: #BB86FC;
    border-color: #BB86FC;
    color: #000;
  }

  .dim-value {
    font-size: 12px;
    color: #fff;
    font-weight: 600;
    min-width: 20px;
    text-align: center;
  }

  .stage-toggle {
    margin-left: auto;
    padding: 4px 12px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: #888;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .stage-toggle:hover {
    border-color: #f90;
    color: #f90;
  }

  .stage-toggle.active {
    background: #f90;
    border-color: #f90;
    color: #000;
  }

  /* ── Stage Presets Bar ── */
  .stage-presets-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 20px;
    border-top: 1px solid #333;
    border-bottom: 1px solid #333;
    background: #141414;
    flex-shrink: 0;
  }

  .stage-presets-label {
    font-size: 10px;
    color: #f90;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .stage-presets-list {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    flex: 1;
  }

  .stage-preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 4px 8px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    color: #aaa;
    font-size: 10px;
    cursor: pointer;
    flex-shrink: 0;
    min-width: 60px;
    transition: all 0.15s;
  }

  .stage-preset-btn:hover {
    border-color: #f90;
    color: #fff;
  }

  .stage-preset-btn.active {
    border-color: #f90;
    background: #2a1a00;
    color: #f90;
  }

  .stage-preset-thumb {
    width: 48px;
    height: 28px;
    object-fit: cover;
    border-radius: 2px;
  }

  .stage-preset-name {
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stage-preset-save-btn {
    padding: 4px 10px;
    background: #222;
    border: 1px dashed #555;
    border-radius: 4px;
    color: #888;
    font-size: 10px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .stage-preset-save-btn:hover {
    border-color: #f90;
    color: #f90;
  }

  .stage-scope-toggle {
    padding: 2px 6px;
    font-size: 10px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px;
    background: rgba(255,255,255,0.05);
    cursor: pointer;
    min-width: 20px;
  }
  .stage-scope-toggle.global {
    border-color: rgba(100,200,255,0.4);
    background: rgba(100,200,255,0.1);
  }
  .stage-preset-scope {
    font-size: 8px;
    font-weight: bold;
    color: rgba(100,200,255,0.8);
    margin-right: 2px;
  }

  /* ── Per-clip video transform sub-panel ───────────────────────────
     Lives inside .shader-params-panel.video-controls-panel; sliders
     drive vjClipLauncher.updateActiveClipVideoProps which the
     vjOutputLayers derived store reads to bake transforms into the
     layer's `corners` field. */
  .vt-transform {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 0 6px;
  }
  .vt-section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    opacity: 0.7;
    margin-bottom: 2px;
  }
  .vt-tf-row {
    display: grid;
    grid-template-columns: 60px 1fr 44px;
    align-items: center;
    gap: 6px;
  }
  .vt-tf-label {
    font-size: 11px;
    opacity: 0.8;
  }
  .vt-tf-num {
    font-size: 11px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  .vt-tf-select {
    grid-column: 2 / span 2;
    background: rgba(20, 20, 30, 0.6);
    color: #ddd;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
  }
  .vt-tf-reset {
    margin-top: 6px;
    padding: 4px 8px;
    background: rgba(40, 40, 50, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #ccc;
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
  }
  .vt-tf-reset:hover {
    background: rgba(60, 60, 70, 0.8);
    color: #fff;
  }

  /* ── VJ Video Controls Panel — full mapping-mode parity (transport row,
     trim-aware timeline, Loop/Once mode buttons). Visuals match Pro/GPU. */
  .video-controls-panel { padding: 8px; background: rgba(255, 255, 255, 0.04); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.06); }
  .vt-controls { display: flex; flex-direction: column; gap: 8px; }
  .vt-transport { display: flex; align-items: center; gap: 4px; }
  .vt-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #ccc;
    border: none;
    width: 28px; height: 28px;
    border-radius: 4px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .vt-btn:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
  .vt-play { background: #BB86FC; color: #111; }
  .vt-play:hover { background: #CF6EFF; color: #000; }
  .vt-time {
    font-size: 11px;
    color: #888;
    font-family: monospace;
    margin-left: 4px;
    flex: 1;
    white-space: nowrap;
  }
  .vt-speed {
    background: rgba(255, 255, 255, 0.08);
    color: #aaa;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    font-size: 11px;
    padding: 2px 4px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .vt-speed:hover { border-color: rgba(255, 255, 255, 0.25); }

  .vt-timeline {
    position: relative;
    height: 24px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    cursor: pointer;
    overflow: visible;
    user-select: none;
  }
  .vt-trim-outside-left, .vt-trim-outside-right {
    position: absolute; top: 0; height: 100%;
    background: rgba(0, 0, 0, 0.45);
    pointer-events: none;
    z-index: 1;
  }
  .vt-trim-outside-left { left: 0; border-radius: 3px 0 0 3px; }
  .vt-trim-outside-right { right: 0; border-radius: 0 3px 3px 0; }
  .vt-trim-region {
    position: absolute; top: 0; height: 100%;
    background: rgba(187, 134, 252, 0.15);
    border-top: 2px solid rgba(187, 134, 252, 0.35);
    border-bottom: 2px solid rgba(187, 134, 252, 0.35);
    pointer-events: none;
    z-index: 1;
  }
  .vt-playhead {
    position: absolute; top: -2px;
    width: 2px; height: calc(100% + 4px);
    background: #BB86FC;
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.6);
    z-index: 3;
    pointer-events: none;
    transform: translateX(-1px);
  }
  .vt-trim-handle {
    position: absolute; top: 0;
    width: 8px; height: 100%;
    cursor: ew-resize;
    z-index: 4;
    transform: translateX(-4px);
    border-radius: 2px;
    transition: background 0.1s;
  }
  .vt-trim-handle::after {
    content: ''; position: absolute;
    top: 25%; left: 50%;
    transform: translateX(-50%);
    width: 2px; height: 50%;
    background: rgba(187, 134, 252, 0.7);
    border-radius: 1px;
  }
  .vt-trim-handle:hover { background: rgba(187, 134, 252, 0.25); }
  .vt-trim-handle:hover::after { background: #BB86FC; }

  .vt-modes { display: flex; gap: 2px; }
  .vt-mode-btn {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #888;
    font-size: 10px;
    padding: 4px 2px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .vt-mode-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #bbb;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .vt-mode-btn.active {
    background: rgba(187, 134, 252, 0.2);
    color: #BB86FC;
    border-color: rgba(187, 134, 252, 0.4);
  }
</style>
