<script lang="ts">
  import { onMount } from 'svelte';
  import { settings, getSupportedFormats, COLOR_SCHEMES, DEFAULT_LAYER_SHADERS, type RecordingSettings, type ColorSchemeId, type ShaderQualityMode } from '../stores/settings';
  import { project } from '../stores/layers';
  import { midiStore } from '../midi/midiStore';
  import { midiManager } from '../midi/midiManager';
  import { getErrorLog, clearErrorLog, type ErrorEntry } from '../utils/errorReporter';
  import { invoke, isDesktopApp } from '$lib/bridge';
  import {
    probeDecodeSupport,
    probeEncodeSupport,
    formatDecodeSupport,
    type CodecDecodeReport,
    type CodecEncodeReport,
  } from '../utils/codecProbe';

  let diagnosticsOpen = false;
  let errorLog: ErrorEntry[] = [];

  // Codec capability probe results — populated on Performance tab mount.
  // Lazily probed so the panel doesn't pay the cost when the user
  // never opens the tab.
  let codecDecode: CodecDecodeReport | null = null;
  let codecEncode: CodecEncodeReport | null = null;
  let codecProbed = false;
  async function runCodecProbe() {
    if (codecProbed) return;
    codecProbed = true;
    codecEncode = probeEncodeSupport();
    codecDecode = await probeDecodeSupport();
  }
  // Run the probe the first time the Performance tab is opened.
  $: if (activeTab === 'performance' && !codecProbed) runCodecProbe();

  // AI tab + key validation removed in OSS — see Pro edition for AI generation.

  export let isOpen = false;
  export let onClose: () => void = () => {};

  // Output display transforms now live in $settings.output (auto-broadcast
  // via state-sync to the output window; applied in the final WebGL pass).
  // No props needed — read/write the store directly.
  $: outputRotation = $settings.output.outputRotation ?? 0;
  $: outputCropRegion = {
    x: $settings.output.outputCropX ?? 0,
    y: $settings.output.outputCropY ?? 0,
    width: $settings.output.outputCropWidth ?? 1,
    height: $settings.output.outputCropHeight ?? 1,
  };
  $: showOutputCursor = $settings.output.outputShowCursor ?? false;

  function setOutputRotation(deg: 0 | 90 | 180 | 270) {
    settings.update(s => ({ ...s, output: { ...s.output, outputRotation: deg } }));
  }
  function setOutputCrop(part: 'x' | 'y' | 'width' | 'height', v: number) {
    settings.update(s => ({
      ...s,
      output: {
        ...s.output,
        outputCropX:      part === 'x' ? v : (s.output.outputCropX ?? 0),
        outputCropY:      part === 'y' ? v : (s.output.outputCropY ?? 0),
        outputCropWidth:  part === 'width'  ? v : (s.output.outputCropWidth ?? 1),
        outputCropHeight: part === 'height' ? v : (s.output.outputCropHeight ?? 1),
      },
    }));
  }
  function resetOutputCrop() {
    settings.update(s => ({ ...s, output: { ...s.output, outputCropX: 0, outputCropY: 0, outputCropWidth: 1, outputCropHeight: 1 } }));
  }
  function setShowOutputCursor(val: boolean) {
    settings.update(s => ({ ...s, output: { ...s.output, outputShowCursor: val } }));
  }

  // ── Match Resolution ──────────────────────────────────────────────────────
  // Asks the Electron main process for the native pixel dimensions of the
  // display the output window is on (or would land on). Sets the project
  // canvas to those dimensions so source pixels = projector pixels = zero
  // scaling overhead in the GPU compositor.
  let matchResLabel = '';
  let matchResBusy = false;
  async function handleMatchResolution() {
    if (matchResBusy) return;
    matchResBusy = true;
    matchResLabel = '';
    try {
      if (!isDesktopApp) { matchResLabel = 'Desktop only'; return; }
      const info: any = await invoke('get_output_display_info');
      if (info?.nativeWidth && info?.nativeHeight) {
        project.setProjectDimensions(info.nativeWidth, info.nativeHeight);
        matchResLabel = `${info.label}: ${info.nativeWidth}x${info.nativeHeight}`;
      } else {
        matchResLabel = 'No display info returned';
      }
    } catch (e) {
      matchResLabel = 'Failed: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      matchResBusy = false;
      // clear label after 4s
      setTimeout(() => { matchResLabel = ''; }, 4000);
    }
  }

  // MIDI
  $: midiDevices = $midiStore.devices.filter((d: any) => d.state === 'connected');
  $: midiSelectedId = $midiStore.selectedDeviceId;
  $: midiAvailable = $midiStore.available;
  $: midiEditMode = $midiStore.editMode;

  function handleMidiDeviceChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id) midiManager.selectDevice(id);
  }

  // Settings tab navigation
  let activeTab: 'general' | 'output' | 'performance' | 'midi' = 'general';

  // Auto-select a tab from window.location.hash on open. Lets other
  // entry points (e.g. the integrated-GPU warning banner) drop the
  // user directly into the Performance tab without an extra click.
  onMount(() => {
    const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
    if (h === 'performance' || h === 'output' || h === 'midi' || h === 'general') {
      activeTab = h;
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* */ }
    }
  });
  // Same handler for re-opens (component stays mounted; just toggles isOpen).
  $: if (isOpen && typeof window !== 'undefined') {
    const h = window.location.hash.replace(/^#/, '');
    if (h === 'performance' || h === 'output' || h === 'midi' || h === 'general') {
      activeTab = h;
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* */ }
    }
  }

  // License panel state
  let licenseOpen = false;

  // Get supported formats
  const formats = getSupportedFormats();

  // Canvas size presets
  const canvasPresets = [
    { label: '1920 x 1080 (16:9 Landscape)', width: 1920, height: 1080 },
    { label: '1080 x 1920 (9:16 Portrait)', width: 1080, height: 1920 },
    { label: '1080 x 1080 (Square)', width: 1080, height: 1080 },
    { label: '1024 x 768 (4:3)', width: 1024, height: 768 },
    { label: '3840 x 2160 (4K)', width: 3840, height: 2160 },
    { label: '1280 x 720 (720p)', width: 1280, height: 720 },
    { label: 'Custom', width: 0, height: 0 },
  ];

  let customWidth = $project.width;
  let customHeight = $project.height;
  let showCustomInputs = false;
  $: isCustomSize = showCustomInputs || !canvasPresets.slice(0, -1).some(
    p => p.width === $project.width && p.height === $project.height
  );

  function handleCanvasPresetChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    if (value === 'Custom') {
      showCustomInputs = true;
      customWidth = $project.width;
      customHeight = $project.height;
      return;
    }
    showCustomInputs = false;
    const preset = canvasPresets.find(p => p.label === value);
    if (preset && preset.width > 0) {
      project.setProjectDimensions(preset.width, preset.height);
      customWidth = preset.width;
      customHeight = preset.height;
    }
  }

  function applyCustomCanvasSize() {
    const w = Math.max(128, Math.min(7680, customWidth));
    const h = Math.max(128, Math.min(7680, customHeight));
    customWidth = w;
    customHeight = h;
    project.setProjectDimensions(w, h);
  }

  // Texture-sharing slice management is not part of Community.
  // The stored slice fields remain for old project compatibility only.
  // slice config has no consumer. The Pro version's UI lives in this
  // file's git history if you need to port it back.


  // Bitrate options
  const bitrateOptions = [
    { value: 2500000, label: '2.5 Mbps (Small files)' },
    { value: 5000000, label: '5 Mbps (Balanced)' },
    { value: 8000000, label: '8 Mbps (High quality)' },
    { value: 12000000, label: '12 Mbps (Best quality)' },
  ];

  const shaderQualityModes: { value: ShaderQualityMode; label: string }[] = [
    { value: 'full', label: 'Full (100%)' },
    { value: 'high', label: 'High (75%)' },
    { value: 'medium', label: 'Medium (50%)' },
    { value: 'low', label: 'Low (25%)' },
  ];

  function handleFormatChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as RecordingSettings['format'];
    settings.setRecordingFormat(value);
  }

  function handleBitrateChange(e: Event) {
    const value = parseInt((e.target as HTMLSelectElement).value);
    settings.setVideoBitrate(value);
  }

  function handleAutoDownloadChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    settings.setAutoDownload(checked);
  }

  async function handlePickDirectory() {
    await settings.pickSaveDirectory();
  }

  function handleClearDirectory() {
    settings.clearSaveDirectory();
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleColorSchemeChange(schemeId: ColorSchemeId) {
    settings.setColorScheme(schemeId);
  }

  function handleShaderQualityChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as ShaderQualityMode;
    settings.setShaderQuality(value);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div class="settings-overlay" onclick={handleOverlayClick} role="dialog" aria-modal="true">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Tab Navigation -->
      <div class="settings-tabs">
        <button class="settings-tab" class:active={activeTab === 'general'} onclick={() => activeTab = 'general'}>General</button>
        <button class="settings-tab" class:active={activeTab === 'output'} onclick={() => activeTab = 'output'}>Output</button>
        <button class="settings-tab" class:active={activeTab === 'performance'} onclick={() => activeTab = 'performance'}>Performance</button>
        <button class="settings-tab" class:active={activeTab === 'midi'} onclick={() => activeTab = 'midi'}>MIDI</button>
        <!-- AI + License tabs removed in OSS. AI generation is a Pro feature.
             OSS has no licensing — every install is the same tier. -->
      </div>

      <div class="settings-content">
        <!-- Update banner removed in OSS — updates flow through GitHub
             releases / package manager, not in-app. -->

        {#if activeTab === 'general'}
        <!-- Appearance Section -->
        <section class="settings-section">
          <h3>Appearance</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Color Scheme</span>
              <span class="label-hint">Choose your preferred color theme</span>
            </div>
          </div>

          <div class="color-scheme-grid">
            {#each COLOR_SCHEMES as scheme}
              <button
                class="color-scheme-card"
                class:active={$settings.ui.colorScheme === scheme.id}
                onclick={() => handleColorSchemeChange(scheme.id)}
              >
                <div class="scheme-preview" style="
                  background: {scheme.colors.bgPrimary};
                  border-color: {scheme.colors.borderPrimary};
                ">
                  <div class="scheme-accent" style="background: {scheme.colors.accentPrimary};"></div>
                  <div class="scheme-accent-secondary" style="background: {scheme.colors.accentSecondary};"></div>
                </div>
                <span class="scheme-name">{scheme.name}</span>
                <span class="scheme-desc">{scheme.description}</span>
              </button>
            {/each}
          </div>
        </section>

        <!-- Canvas Size Section -->
        <section class="settings-section">
          <h3>Canvas</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Resolution</span>
              <span class="label-hint">Current: {$project.width} x {$project.height}</span>
            </div>
            <select
              value={isCustomSize ? 'Custom' : canvasPresets.find(p => p.width === $project.width && p.height === $project.height)?.label || 'Custom'}
              onchange={handleCanvasPresetChange}
            >
              {#each canvasPresets as preset}
                <option value={preset.label}>{preset.label}</option>
              {/each}
            </select>
          </div>

          {#if isCustomSize}
            <div class="setting-row custom-size-row">
              <div class="setting-label">
                <span class="label-text">Custom Size</span>
                <span class="label-hint">Min 128, Max 7680</span>
              </div>
              <div class="custom-size-inputs">
                <input
                  type="number"
                  class="text-input size-input"
                  bind:value={customWidth}
                  min="128"
                  max="7680"
                  placeholder="Width"
                />
                <span class="size-separator">x</span>
                <input
                  type="number"
                  class="text-input size-input"
                  bind:value={customHeight}
                  min="128"
                  max="7680"
                  placeholder="Height"
                />
                <button class="secondary-btn" onclick={applyCustomCanvasSize}>
                  Apply
                </button>
              </div>
            </div>
          {/if}
        </section>

        <!-- Default Layer Shader -->
        <section class="settings-section">
          <h3>Layers</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Default Layer Shader</span>
              <span class="label-hint">Applied automatically when creating a new layer</span>
            </div>
            <select
              value={$settings.defaultLayerShader || 'grid'}
              onchange={(e) => settings.setDefaultLayerShader((e.target as HTMLSelectElement).value as any)}
            >
              {#each DEFAULT_LAYER_SHADERS as shader}
                <option value={shader.id}>{shader.label}</option>
              {/each}
            </select>
          </div>
        </section>

        <!-- Recording Settings Section -->
        <section class="settings-section">
          <h3>Recording</h3>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video Format</span>
              <span class="label-hint">Choose the format for screen recordings</span>
            </div>
            <select value={$settings.recording.format} onchange={handleFormatChange}>
              {#each formats as format}
                <option value={format.id} disabled={!format.supported}>
                  {format.label} {!format.supported ? '(Not supported)' : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video Quality</span>
              <span class="label-hint">Higher quality = larger file size</span>
            </div>
            <select value={$settings.recording.videoBitrate} onchange={handleBitrateChange}>
              {#each bitrateOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Auto-Download</span>
              <span class="label-hint">Automatically save recordings when stopped</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={$settings.recording.autoDownload}
                onchange={handleAutoDownloadChange}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Save Location</span>
              <span class="label-hint">{$settings.recording.saveDirectoryName}</span>
            </div>
            <div class="button-group">
              <button class="secondary-btn" onclick={handlePickDirectory}>
                Choose Folder
              </button>
              {#if $settings.recording.saveDirectoryHandle}
                <button class="text-btn" onclick={handleClearDirectory}>
                  Reset
                </button>
              {/if}
            </div>
          </div>

          <div class="info-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <p>
              {#if $settings.recording.saveDirectoryHandle}
                Recordings will be saved directly to: <strong>{$settings.recording.saveDirectoryName}</strong>
              {:else}
                Recordings will download to your browser's default Downloads folder.
              {/if}
            </p>
          </div>
        </section>

        {:else if activeTab === 'output'}
        <!-- Output Settings Section -->
        <section class="settings-section">
          <h3>Render Quality</h3>

          <!-- Fluid Quality removed in OSS — fluid simulation is a Pro plugin. -->

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader Quality</span>
              <span class="label-hint">Default render resolution for shader layers (override per-layer in Layer Panel)</span>
            </div>
            <select value={$settings.ui.shaderQuality} onchange={handleShaderQualityChange}>
              {#each shaderQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>

        </section>

        <!-- Output Display Section -->
        <section class="settings-section">
          <h3>Display</h3>

          <!-- Match Resolution: snaps the project canvas to the native pixel
               dimensions of the display the output window is on (or would be).
               Eliminates source→projector scaling entirely. -->
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Resolution</span>
              <span class="label-hint">
                Project canvas: <strong>{$project.width}×{$project.height}</strong>
                {#if matchResLabel}<br/><em style="color: #BB86FC;">{matchResLabel}</em>{/if}
              </span>
            </div>
            <button class="secondary-btn" onclick={handleMatchResolution} disabled={matchResBusy}>
              {matchResBusy ? 'Detecting…' : 'Match Output Display'}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output Rotation</span>
              <span class="label-hint">Rotate the output for portrait projectors</span>
            </div>
            <div class="rotation-buttons">
              <button class="rot-btn" class:active={outputRotation === 0} onclick={() => setOutputRotation(0)}>0°</button>
              <button class="rot-btn" class:active={outputRotation === 90} onclick={() => setOutputRotation(90)}>90°</button>
              <button class="rot-btn" class:active={outputRotation === 180} onclick={() => setOutputRotation(180)}>180°</button>
              <button class="rot-btn" class:active={outputRotation === 270} onclick={() => setOutputRotation(270)}>270°</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Input Crop</span>
              <span class="label-hint">Crop the output region</span>
            </div>
          </div>
          <div class="crop-grid">
            <div class="crop-item">
              <span class="crop-label">X</span>
              <input type="range" min="0" max="0.9" step="0.01" value={outputCropRegion.x}
                oninput={(e) => setOutputCrop('x', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.x * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">Y</span>
              <input type="range" min="0" max="0.9" step="0.01" value={outputCropRegion.y}
                oninput={(e) => setOutputCrop('y', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.y * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">W</span>
              <input type="range" min="0.1" max="1" step="0.01" value={outputCropRegion.width}
                oninput={(e) => setOutputCrop('width', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.width * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">H</span>
              <input type="range" min="0.1" max="1" step="0.01" value={outputCropRegion.height}
                oninput={(e) => setOutputCrop('height', parseFloat((e.target as HTMLInputElement).value))} />
              <span class="crop-value">{Math.round(outputCropRegion.height * 100)}%</span>
            </div>
            <button class="secondary-btn" onclick={resetOutputCrop}>
              Reset Crop
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Show Cursor on Output</span>
              <span class="label-hint">Full-screen crosshair on the output window</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                checked={showOutputCursor}
                onchange={(e) => setShowOutputCursor((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
          {#if showOutputCursor}
            <!-- Cursor sub-controls. Only meaningful for the WebGPU
                 zero-copy output (legacy WebRTC output ignores style
                 fields for now). All five fields drive the output
                 receiver's CSS cursor overlay through the
                 outputSharedTexturePresenter messagePort. -->
            <div class="setting-row sub-row">
              <span class="label-text">Style</span>
              <select class="select-input"
                value={$settings.output.outputCursorStyle ?? 'crosshair'}
                onchange={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorStyle: (e.target as HTMLSelectElement).value as 'crosshair' | 'circle' | 'dot' | 'reticle' | 'fullscreen' } }))}
              >
                <option value="crosshair">Crosshair</option>
                <option value="circle">Circle</option>
                <option value="dot">Dot</option>
                <option value="reticle">Reticle</option>
                <option value="fullscreen">Fullscreen Lines</option>
              </select>
            </div>
            <div class="setting-row sub-row">
              <span class="label-text">Size</span>
              <input type="range" min="4" max="128" step="1"
                value={$settings.output.outputCursorSize ?? 28}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorSize: parseInt((e.target as HTMLInputElement).value) } }))}
              />
              <span class="crop-value">{$settings.output.outputCursorSize ?? 28}px</span>
            </div>
            <div class="setting-row sub-row">
              <span class="label-text">Thickness</span>
              <input type="range" min="1" max="12" step="1"
                value={$settings.output.outputCursorThickness ?? 2}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorThickness: parseInt((e.target as HTMLInputElement).value) } }))}
              />
              <span class="crop-value">{$settings.output.outputCursorThickness ?? 2}px</span>
            </div>
            <div class="setting-row sub-row">
              <span class="label-text">Color</span>
              <input type="color"
                value={$settings.output.outputCursorColor ?? '#ffffff'}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorColor: (e.target as HTMLInputElement).value } }))}
              />
            </div>
            <div class="setting-row sub-row">
              <span class="label-text">Opacity</span>
              <input type="range" min="0" max="1" step="0.01"
                value={$settings.output.outputCursorOpacity ?? 0.85}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, outputCursorOpacity: parseFloat((e.target as HTMLInputElement).value) } }))}
              />
              <span class="crop-value">{(($settings.output.outputCursorOpacity ?? 0.85) * 100).toFixed(0)}%</span>
            </div>
          {/if}
        </section>

        <!-- Projection Tools section removed (v0.3.5):
             Blackout is available via the kill-output icon in the top bar;
             alignment/calibration handled by ISF shaders. The settings UI
             was causing accidental activation that overrode all output and
             made the app appear broken. State is force-reset to off on
             every app launch (see App.svelte). -->



        <!-- Output Color Correction Section -->
        <section class="settings-section">
          <h3>Color Correction</h3>
          <p class="section-hint">Adjust output signal to match projector characteristics</p>

          <div class="crop-grid">
            <div class="crop-item">
              <span class="crop-label">Brightness</span>
              <input type="range" min="0" max="2" step="0.01"
                value={$settings.output.brightness ?? 1}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, brightness: parseFloat((e.target as HTMLInputElement).value) } }))} />
              <span class="crop-value">{(($settings.output.brightness ?? 1) * 100).toFixed(0)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">Contrast</span>
              <input type="range" min="0" max="2" step="0.01"
                value={$settings.output.contrast ?? 1}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, contrast: parseFloat((e.target as HTMLInputElement).value) } }))} />
              <span class="crop-value">{(($settings.output.contrast ?? 1) * 100).toFixed(0)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">Gamma</span>
              <input type="range" min="0.2" max="5" step="0.05"
                value={$settings.output.gamma ?? 1}
                oninput={(e) => settings.update(s => ({ ...s, output: { ...s.output, gamma: parseFloat((e.target as HTMLInputElement).value) } }))} />
              <span class="crop-value">{($settings.output.gamma ?? 1).toFixed(2)}</span>
            </div>
            <button class="secondary-btn" onclick={() => settings.update(s => ({ ...s, output: { ...s.output, brightness: 1, contrast: 1, gamma: 1 } }))}>
              Reset Color
            </button>
          </div>
        </section>


        {:else if activeTab === 'performance'}
        <!-- Performance Tab — opt-in knobs for users on weaker hardware.
             Defaults match the historical full-quality behaviour so
             capable machines see no change. Anything users dial down
             here applies live (no restart) by reading the settings
             store at the relevant hot path. -->
        <section class="settings-section">
          <div class="setting-row" style="border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 12px;">
            <div class="setting-label" style="flex: 1;">
              <span class="label-text" style="color: #BB86FC;">Tune the editor for your hardware</span>
              <span class="label-hint" style="line-height: 1.5;">
                If the app feels laggy, step these down until it feels smooth. None of these change your output content — only how the editor renders the preview and how the output stream encodes. Capable machines should leave everything at the defaults.
                <br/><br/>
                <a href="https://ghostarcade.live/docs/performance" target="_blank" rel="noopener noreferrer"
                   style="color: #BB86FC; text-decoration: underline; font-weight: 600;">
                  Full guide: optimizing Ghost Arcade for your machine →
                </a>
              </span>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <h3>Render Quality</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Shader Quality</span>
              <span class="label-hint">Internal render resolution for shader layers. Full = native; lower scales down then upscales for display.</span>
            </div>
            <select value={$settings.ui.shaderQuality} onchange={handleShaderQualityChange}>
              {#each shaderQualityModes as mode}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>Editor Render</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Editor Frame Rate Cap</span>
              <span class="label-hint">
                Limits how many frames per second the editor renders. Projectors are almost always 60Hz — rendering at 120/144/165 Hz on a high-refresh monitor is wasted GPU. Cap to 60 to free up budget. Input remains responsive regardless. Applies to mapping mode too.
              </span>
            </div>
            <select value={String($settings.performance.editorMaxFps)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, editorMaxFps: parseInt((e.target as HTMLSelectElement).value) as 0 | 30 | 60 } }))}>
              <option value="0">Uncapped (match display)</option>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>VJ Preview</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Preview Resolution</span>
              <span class="label-hint">Long-edge cap for the VJ mode preview canvas. Lower frees GPU for the actual render. Doesn't affect what gets sent to the output.</span>
            </div>
            <select value={String($settings.performance.previewMaxDim)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, previewMaxDim: parseInt((e.target as HTMLSelectElement).value) } }))}>
              <option value="0">Full (match canvas)</option>
              <option value="1280">1280 px (720p)</option>
              <option value="960">960 px</option>
              <option value="640">640 px (recommended on integrated GPU)</option>
              <option value="480">480 px (minimum)</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Preview Refresh Rate</span>
              <span class="label-hint">Frames per second for the preview canvas. 30fps is enough to monitor; 15 frees a lot of budget on weak hardware.</span>
            </div>
            <select value={String($settings.performance.previewFrameRate)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, previewFrameRate: parseInt((e.target as HTMLSelectElement).value) as 60 | 30 | 15 } }))}>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
              <option value="15">15 fps</option>
            </select>
          </div>
        </section>

        <section class="settings-section">
          <h3>Output Stream</h3>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output Frame Rate</span>
              <span class="label-hint">Encoder rate for the output window. 60 = silky for fast motion; 30 = standard projector cadence; 24 = lightest encode + cinematic.</span>
            </div>
            <select value={String($settings.performance.outputFrameRate)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputFrameRate: parseInt((e.target as HTMLSelectElement).value) as 60 | 30 | 24 } }))}>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
              <option value="24">24 fps</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Max Bitrate</span>
              <span class="label-hint">Encoder bitrate ceiling. Same-process loopback so the rate doesn't go on a wire — high = encoder runs near-lossless, low = encoder works much less.</span>
            </div>
            <select value={String($settings.performance.outputMaxBitrate)}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputMaxBitrate: parseInt((e.target as HTMLSelectElement).value) } }))}>
              <option value="80000000">High — 80 Mbps</option>
              <option value="40000000">Medium — 40 Mbps</option>
              <option value="20000000">Low — 20 Mbps</option>
              <option value="10000000">Minimum — 10 Mbps</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Quality vs Smoothness</span>
              <span class="label-hint">How the encoder degrades under load: keep pixels (drop fps), keep smoothness (drop pixels), or let WebRTC decide.</span>
            </div>
            <select value={$settings.performance.outputDegradationPreference}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputDegradationPreference: (e.target as HTMLSelectElement).value as 'maintain-resolution' | 'maintain-framerate' | 'balanced' } }))}>
              <option value="maintain-resolution">Maintain Resolution</option>
              <option value="maintain-framerate">Maintain Frame Rate</option>
              <option value="balanced">Balanced</option>
            </select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Video Codec</span>
              <span class="label-hint">
                Auto picks VP9 first (best quality/bitrate). Force H.264 if your machine has hardware H.264 — usually a big perf win.
                {#if codecEncode}
                  <br/>Available on this machine: {[codecEncode.vp9 && 'VP9', codecEncode.h264 && 'H.264', codecEncode.vp8 && 'VP8', codecEncode.av1 && 'AV1'].filter(Boolean).join(' · ') || 'none detected'}.
                {/if}
              </span>
            </div>
            <select value={$settings.performance.outputCodecPreference}
              onchange={(e) => settings.update(s => ({ ...s, performance: { ...s.performance, outputCodecPreference: (e.target as HTMLSelectElement).value as 'auto' | 'h264' | 'vp8' } }))}>
              <option value="auto">Auto (recommended)</option>
              <option value="h264">Force H.264</option>
              <option value="vp8">Force VP8 (compatibility)</option>
            </select>
          </div>
          <div class="setting-row" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px; margin-top: 4px;">
            <div class="setting-label" style="flex: 1;">
              <span class="label-hint" style="opacity: 0.7;">
                <strong>Apply on next output-window open.</strong> Stream-tuning settings (framerate / bitrate / codec) take effect when the output window opens — close and reopen the output for changes to apply.
              </span>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <h3>Video Decoding (read-only)</h3>
          <div class="setting-row">
            <div class="setting-label" style="flex: 1;">
              <span class="label-hint" style="line-height: 1.7;">
                {#if codecDecode}
                  <strong>H.264:</strong> <span style:color={codecDecode.h264 === 'hw' ? '#4caf50' : codecDecode.h264 === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.h264)}</span>
                  &nbsp;·&nbsp;
                  <strong>HEVC:</strong> <span style:color={codecDecode.hevc === 'hw' ? '#4caf50' : codecDecode.hevc === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.hevc)}</span>
                  &nbsp;·&nbsp;
                  <strong>VP9:</strong> <span style:color={codecDecode.vp9 === 'hw' ? '#4caf50' : codecDecode.vp9 === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.vp9)}</span>
                  &nbsp;·&nbsp;
                  <strong>AV1:</strong> <span style:color={codecDecode.av1 === 'hw' ? '#4caf50' : codecDecode.av1 === 'sw' ? '#fbbf24' : '#999'}>{formatDecodeSupport(codecDecode.av1)}</span>
                  <br/><br/>
                  For best playback performance, re-encode your video clips with a codec your machine decodes in <strong style="color: #4caf50;">hardware</strong>.
                  <a href="https://ghostarcade.live/docs/performance#video-codecs" target="_blank" rel="noopener noreferrer"
                     style="color: #BB86FC; text-decoration: underline;">
                    See ffmpeg recipes →
                  </a>
                {:else}
                  Probing decode capabilities…
                {/if}
              </span>
            </div>
          </div>
        </section>


        {:else if activeTab === 'midi'}
        <!-- MIDI Settings Section -->
        <section class="settings-section">
          <h3>MIDI Controller</h3>

          {#if midiAvailable}
            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">MIDI Device</span>
                <span class="label-hint">Select your MIDI controller input</span>
              </div>
              <select value={midiSelectedId || ''} onchange={handleMidiDeviceChange}>
                <option value="">No MIDI Device</option>
                {#each midiDevices as device}
                  <option value={device.id}>{device.name}</option>
                {/each}
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-label">
                <span class="label-text">MIDI Learn Mode</span>
                <span class="label-hint">Click a parameter, then move a MIDI control to map it</span>
              </div>
              <button
                class="secondary-btn midi-learn-btn"
                class:active={midiEditMode}
                disabled={midiDevices.length === 0 && !midiEditMode}
                onclick={() => midiStore.toggleEditMode()}
              >
                {midiEditMode ? 'Exit MIDI Learn' : midiDevices.length === 0 ? 'No MIDI Device' : 'Enter MIDI Learn'}
              </button>
            </div>

            <div class="info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p>
                In MIDI Learn mode, click any parameter slider in the main UI, then move a knob or fader on your MIDI controller to create a mapping. Press <strong>ESC</strong> to exit learn mode.
              </p>
            </div>
          {:else}
            <div class="info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <p>No MIDI support detected. Connect a MIDI controller and refresh.</p>
            </div>
          {/if}
        </section>

        {/if}
      </div>

      <div class="settings-footer">
        <!-- Diagnostics -->
        <div class="section">
          <h3>
            <button class="section-toggle" onclick={() => { diagnosticsOpen = !diagnosticsOpen; if (diagnosticsOpen) errorLog = getErrorLog(); }}>
              Diagnostics {diagnosticsOpen ? '▾' : '▸'}
            </button>
          </h3>
          {#if diagnosticsOpen}
            <div class="diagnostics">
              <p class="hint">{errorLog.length} captured error{errorLog.length !== 1 ? 's' : ''}</p>
              {#if errorLog.length > 0}
                <div class="error-log">
                  {#each errorLog.slice().reverse() as entry}
                    <div class="error-entry">
                      <span class="error-time">{entry.timestamp.slice(0, 19).replace('T', ' ')}</span>
                      <span class="error-msg">{entry.message}</span>
                      {#if entry.source}
                        <span class="error-source">{entry.source}</span>
                      {/if}
                    </div>
                  {/each}
                </div>
                <div class="diag-actions">
                  <button class="text-btn" onclick={() => { navigator.clipboard.writeText(JSON.stringify(errorLog, null, 2)); }}>
                    Copy to Clipboard
                  </button>
                  <button class="text-btn" onclick={() => { clearErrorLog(); errorLog = []; }}>
                    Clear Log
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <button class="text-btn" onclick={() => settings.reset()}>
          Reset to Defaults
        </button>
        <button class="primary-btn" onclick={onClose}>
          Done
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200000;
    backdrop-filter: blur(4px);
  }

  .settings-panel {
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 12px;
    width: 90%;
    max-width: 680px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #333;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #eee;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .close-btn:hover {
    background: #333;
    color: #eee;
  }

  .settings-tabs {
    display: flex;
    padding: 0 20px;
    gap: 0;
    border-bottom: 1px solid #333;
  }

  .settings-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-size: 13px;
    font-weight: 600;
    padding: 10px 16px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .settings-tab:hover {
    color: #ccc;
  }

  .settings-tab.active {
    color: #BB86FC;
    border-bottom-color: #BB86FC;
  }

  .tier-indicator {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border-radius: 3px;
    color: #000;
    margin-left: 4px;
    vertical-align: middle;
  }

  /* Dev tier override box */
  .dev-tier-box {
    background: rgba(245, 158, 11, 0.06);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .dev-tier-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dev-tier-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f59e0b;
    color: #000;
  }

  .dev-tier-sublabel {
    font-size: 11px;
    color: #f59e0b;
    font-weight: 500;
  }

  .dev-tier-select {
    background: var(--bg-primary, #0d0d1a);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--text-primary, #e0e0e0);
    font-size: 12px;
    cursor: pointer;
    min-width: 200px;
  }

  .dev-tier-select:focus {
    outline: none;
    border-color: #f59e0b;
  }

  .pro-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f59e0b;
    color: #000;
    vertical-align: middle;
  }

  .locked-label {
    font-size: 16px;
    opacity: 0.5;
  }

  .pro-gate-notice {
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.2);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
    color: #999;
    line-height: 1.5;
  }

  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .settings-section {
    margin-bottom: 24px;
  }

  .settings-section:last-child {
    margin-bottom: 0;
  }

  .settings-section h3 {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: #BB86FC;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #161618;
  }

  .setting-row:last-of-type {
    border-bottom: none;
  }

  .setting-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .label-text {
    font-size: 14px;
    color: #eee;
  }

  .label-hint {
    font-size: 12px;
    color: #666;
  }

  select {
    background: #161618;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 12px;
    color: #eee;
    font-size: 13px;
    cursor: pointer;
    min-width: 180px;
  }

  select:hover {
    border-color: #555;
  }

  select:focus {
    outline: none;
    border-color: #BB86FC;
  }

  .text-input {
    background: #161618;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 12px;
    color: #eee;
    font-size: 13px;
    min-width: 180px;
  }

  .text-input:hover {
    border-color: #555;
  }

  .text-input:focus {
    outline: none;
    border-color: #BB86FC;
  }

  select option:disabled {
    color: #666;
  }

  /* Toggle switch */
  .toggle {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 26px;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #444;
    transition: 0.2s;
    border-radius: 26px;
  }

  .toggle-slider::before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background-color: #888;
    transition: 0.2s;
    border-radius: 50%;
  }

  .toggle input:checked + .toggle-slider {
    background-color: #BB86FC33;
  }

  .toggle input:checked + .toggle-slider::before {
    transform: translateX(22px);
    background-color: #BB86FC;
  }

  .button-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .secondary-btn {
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 8px 14px;
    color: #eee;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .secondary-btn:hover {
    background: #3a3a3a;
    border-color: #555;
  }

  .text-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 13px;
    cursor: pointer;
    padding: 8px 12px;
    transition: color 0.15s;
  }

  .text-btn:hover {
    color: #eee;
  }

  .primary-btn {
    background: #BB86FC;
    border: none;
    border-radius: 6px;
    padding: 10px 20px;
    color: #000;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .primary-btn:hover {
    background: #5dd3e3;
  }

  .info-box {
    display: flex;
    gap: 10px;
    padding: 12px;
    background: #111114;
    border-radius: 8px;
    margin-top: 12px;
  }

  .info-box svg {
    flex-shrink: 0;
    color: #BB86FC;
    margin-top: 2px;
  }

  .info-box p {
    margin: 0;
    font-size: 12px;
    color: #888;
    line-height: 1.5;
  }

  .info-box strong {
    color: #aaa;
  }

  .settings-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-top: 1px solid #333;
  }

  .custom-size-row {
    flex-wrap: wrap;
  }

  .custom-size-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .size-input {
    width: 72px;
    min-width: 72px;
    text-align: center;
  }

  .size-separator {
    color: #888;
    font-size: 13px;
  }

  /* Color Scheme Selector */
  .color-scheme-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 8px;
  }

  .color-scheme-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #161618;
    border: 2px solid transparent;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .color-scheme-card:hover {
    background: #1a1a1e;
    border-color: #444;
  }

  .color-scheme-card.active {
    border-color: var(--accent-primary, #FF6B6B);
    background: #1a1a1e;
  }

  .scheme-preview {
    width: 100%;
    height: 48px;
    border-radius: 6px;
    border: 1px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px;
  }

  .scheme-accent {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: 0 0 10px currentColor;
  }

  .scheme-accent-secondary {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    opacity: 0.8;
  }

  .scheme-name {
    font-size: 12px;
    font-weight: 600;
    color: #eee;
  }

  .scheme-desc {
    font-size: 10px;
    color: #666;
    text-align: center;
  }

  /* AI Settings */
  .key-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .key-input {
    flex: 1;
    font-family: monospace;
    min-width: 120px;
  }

  .test-btn {
    padding: 8px 10px;
    white-space: nowrap;
  }

  .key-badge {
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: 6px;
    text-transform: none;
    font-weight: 400;
  }

  .key-badge.valid {
    background: #22c55e33;
    color: #22c55e;
  }

  .key-badge.invalid {
    background: #ef444433;
    color: #ef4444;
  }

  .settings-link {
    color: #BB86FC;
    text-decoration: none;
  }

  .settings-link:hover {
    text-decoration: underline;
  }

  .ai-divider {
    height: 1px;
    background: #333;
    margin: 8px 0;
  }

  /* Rotation buttons */
  .rotation-buttons {
    display: flex;
    gap: 4px;
  }

  .rot-btn {
    background: #161618;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 6px 12px;
    color: #aaa;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .rot-btn:hover {
    border-color: #666;
    color: #eee;
  }

  .rot-btn.active {
    background: #BB86FC22;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* Crop grid */
  .crop-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px 0 12px;
  }

  .crop-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .crop-label {
    font-size: 12px;
    color: #888;
    min-width: 16px;
    font-weight: 600;
  }

  .crop-item input[type="range"] {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    background: #000000;
    border-radius: 2px;
    cursor: pointer;
  }

  .crop-item input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #BB86FC;
    cursor: pointer;
  }

  .crop-value {
    font-size: 11px;
    color: #888;
    min-width: 32px;
    text-align: right;
    font-family: monospace;
  }

  .crop-grid .secondary-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }

  /* MIDI learn button */
  .midi-learn-btn.active {
    background: #BB86FC;
    color: #000;
    border-color: #BB86FC;
  }

  .section-toggle {
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
  }

  .diagnostics {
    margin-top: 8px;
  }

  .error-log {
    max-height: 200px;
    overflow-y: auto;
    font-size: 11px;
    background: #1a1a2e;
    border-radius: 4px;
    padding: 6px;
    margin-top: 4px;
  }

  .error-entry {
    padding: 3px 0;
    border-bottom: 1px solid #ffffff10;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .error-time {
    color: #888;
    font-size: 10px;
  }

  .error-msg {
    color: #ff6b6b;
    word-break: break-word;
  }

  .error-source {
    color: #666;
    font-size: 10px;
  }

  .diag-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .section-hint {
    font-size: 11px;
    color: #666;
    margin: -4px 0 12px 0;
    line-height: 1.4;
  }

  /* ── Slice manager ───────────────────────────────────────────────────── */
  .slice-presets {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .slice-presets-label {
    font-size: 12px;
    color: #888;
  }

  .slice-card {
    background: #111116;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    margin-bottom: 6px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .slice-card.expanded {
    border-color: rgba(187, 134, 252, 0.25);
  }

  .slice-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    user-select: none;
  }
  .slice-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .slice-toggle {
    flex-shrink: 0;
  }

  .slice-name {
    font-size: 13px;
    font-weight: 600;
    color: #e0e0e0;
    min-width: 60px;
  }

  .slice-info {
    font-size: 11px;
    color: #666;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slice-chevron {
    font-size: 12px;
    color: #666;
    flex-shrink: 0;
  }

  .slice-remove {
    background: none;
    border: none;
    color: #555;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    border-radius: 4px;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .slice-remove:hover {
    color: #ff4757;
    background: rgba(255, 71, 87, 0.1);
  }

  .slice-body {
    padding: 8px 12px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .slice-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .slice-field-label {
    font-size: 11px;
    color: #888;
    min-width: 80px;
    font-weight: 600;
  }

  .slice-input {
    flex: 1;
    background: #0a0a0e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-family: monospace;
  }
  .slice-input:focus {
    border-color: rgba(187, 134, 252, 0.4);
    outline: none;
  }

  .slice-subsection {
    margin-top: 4px;
  }

  .slice-subsection-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666;
    display: block;
    margin-bottom: 4px;
  }

  .add-slice-btn {
    margin-top: 8px;
  }

  .clear-slices-btn {
    margin-top: 4px;
    color: #888 !important;
    border-color: rgba(255, 255, 255, 0.06) !important;
  }

  .custom-res-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .custom-res-inputs span {
    color: #888;
    font-size: 12px;
  }
  .small-input {
    width: 70px !important;
  }

  /* Update banner */
  .update-banner {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(126, 200, 227, 0.08));
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  .update-banner-content {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .update-badge {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
    background: #a855f7;
    color: #fff;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .update-text {
    font-size: 12px;
    color: var(--text-primary, #e0e0e0);
  }
  .update-current {
    font-size: 11px;
    color: var(--text-muted, #666);
  }
  .update-links {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .update-link {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    background: rgba(168, 85, 247, 0.15);
    border: 1px solid rgba(168, 85, 247, 0.3);
    color: #a855f7;
    border-radius: 3px;
    text-decoration: none;
    transition: all 0.15s;
  }
  .update-link:hover {
    background: rgba(168, 85, 247, 0.25);
  }
  .update-link-notes {
    font-size: 11px;
    color: var(--text-secondary, #888);
    text-decoration: none;
    padding: 4px 8px;
  }
  .update-link-notes:hover {
    color: var(--text-primary, #e0e0e0);
    text-decoration: underline;
  }
  .update-cta-btn {
    font-size: 12px;
    font-weight: 600;
    padding: 6px 14px;
    background: linear-gradient(90deg, #FF8577, #7EC8E3);
    border: none;
    color: #0a0a0a;
    border-radius: 4px;
    cursor: pointer;
    transition: filter 0.15s, transform 0.15s;
  }
  .update-cta-btn:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  /* Cursor sub-controls (only rendered when "Show Cursor on Output"
     is on). Indented under their parent toggle row to make the
     hierarchy visible. */
  .sub-row {
    padding-left: 16px;
    border-left: 2px solid rgba(255, 255, 255, 0.05);
    margin-left: 4px;
    display: grid;
    grid-template-columns: 88px 1fr auto;
    align-items: center;
    gap: 8px;
  }
  .select-input {
    background: rgba(20, 20, 30, 0.6);
    color: #ddd;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    padding: 4px 6px;
    font-size: 12px;
  }
</style>
