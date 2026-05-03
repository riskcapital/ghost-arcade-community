<script lang="ts">
  import { settings, getSupportedFormats, COLOR_SCHEMES, DEFAULT_LAYER_SHADERS, type RecordingSettings, type ColorSchemeId, type ShaderQualityMode } from '../stores/settings';
  import { project } from '../stores/layers';
  import { midiStore } from '../midi/midiStore';
  import { midiManager } from '../midi/midiManager';
  import { getErrorLog, clearErrorLog, type ErrorEntry } from '../utils/errorReporter';

  let diagnosticsOpen = false;
  let errorLog: ErrorEntry[] = [];

  // AI tab + key validation removed in OSS — see Pro edition for AI generation.

  export let isOpen = false;
  export let onClose: () => void = () => {};

  // Output display settings (passed from App.svelte)
  export let outputRotation: number = 0;
  export let outputCropRegion: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 1, height: 1 };
  export let showOutputCursor: boolean = false;
  export let onOutputCursorChange: (val: boolean) => void = () => {};

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
  let activeTab: 'general' | 'output' | 'midi' = 'general';

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

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Output Rotation</span>
              <span class="label-hint">Rotate the output for portrait projectors</span>
            </div>
            <div class="rotation-buttons">
              <button class="rot-btn" class:active={outputRotation === 0} onclick={() => outputRotation = 0}>0°</button>
              <button class="rot-btn" class:active={outputRotation === 90} onclick={() => outputRotation = 90}>90°</button>
              <button class="rot-btn" class:active={outputRotation === 180} onclick={() => outputRotation = 180}>180°</button>
              <button class="rot-btn" class:active={outputRotation === 270} onclick={() => outputRotation = 270}>270°</button>
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
              <input type="range" min="0" max="0.9" step="0.01" bind:value={outputCropRegion.x} />
              <span class="crop-value">{Math.round(outputCropRegion.x * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">Y</span>
              <input type="range" min="0" max="0.9" step="0.01" bind:value={outputCropRegion.y} />
              <span class="crop-value">{Math.round(outputCropRegion.y * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">W</span>
              <input type="range" min="0.1" max="1" step="0.01" bind:value={outputCropRegion.width} />
              <span class="crop-value">{Math.round(outputCropRegion.width * 100)}%</span>
            </div>
            <div class="crop-item">
              <span class="crop-label">H</span>
              <input type="range" min="0.1" max="1" step="0.01" bind:value={outputCropRegion.height} />
              <span class="crop-value">{Math.round(outputCropRegion.height * 100)}%</span>
            </div>
            <button class="secondary-btn" onclick={() => outputCropRegion = { x: 0, y: 0, width: 1, height: 1 }}>
              Reset Crop
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="label-text">Show Cursor on Output</span>
              <span class="label-hint">Press 'C' in output window to toggle</span>
            </div>
            <label class="toggle">
              <input
                type="checkbox"
                bind:checked={showOutputCursor}
                onchange={() => onOutputCursorChange(showOutputCursor)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
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
</style>
