<script lang="ts">
  import { onMount } from 'svelte';
  import VJClipGrid from './VJClipGrid.svelte';
  import VJMixerStrip from './VJMixerStrip.svelte';
  import VJMasterSection from './VJMasterSection.svelte';
  import VJBlockSelector from './VJBlockSelector.svelte';
  import VJColumnTriggers from './VJColumnTriggers.svelte';
  import VJEffectsPanel from './VJEffectsPanel.svelte';
  import VJShaderPanel from './VJShaderPanel.svelte';
  import type { EffectType, EffectParams, Effect } from '../../types';

  // VJ state from desktop sync
  export let vjClipsState: any = null;

  // Callback props (functions from MobileApp.svelte)
  export let onTriggerClip: (layerIndex: number, columnIndex: number) => void = () => {};
  export let onTriggerColumn: (columnIndex: number) => void = () => {};
  export let onStopLayer: (layerIndex: number) => void = () => {};
  export let onStopAll: () => void = () => {};
  export let onSetBlock: (blockId: string) => void = () => {};
  export let onToggleLive: () => void = () => {};
  export let onSetLayerOpacity: (layerIndex: number, opacity: number) => void = () => {};
  export let onSetLayerBlendMode: (layerIndex: number, blendMode: string) => void = () => {};
  export let onSetMasterOpacity: (opacity: number) => void = () => {};

  // Layer effect callbacks
  export let onAddLayerEffect: (layerIndex: number, effectType: EffectType) => void = () => {};
  export let onRemoveLayerEffect: (layerIndex: number, effectId: string) => void = () => {};
  export let onToggleLayerEffect: (layerIndex: number, effectId: string) => void = () => {};
  export let onUpdateLayerEffectParams: (layerIndex: number, effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Composition effect callbacks
  export let onAddCompEffect: (effectType: EffectType) => void = () => {};
  export let onRemoveCompEffect: (effectId: string) => void = () => {};
  export let onToggleCompEffect: (effectId: string) => void = () => {};
  export let onUpdateCompEffectParams: (effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Clip effect callbacks
  export let onAddClipEffect: (layerIndex: number, columnIndex: number, effectType: EffectType) => void = () => {};
  export let onRemoveClipEffect: (layerIndex: number, columnIndex: number, effectId: string) => void = () => {};
  export let onToggleClipEffect: (layerIndex: number, columnIndex: number, effectId: string) => void = () => {};
  export let onUpdateClipEffectParams: (layerIndex: number, columnIndex: number, effectId: string, params: Partial<EffectParams>) => void = () => {};

  // Shader callback
  export let onUpdateShaderValue: (layerIndex: number, paramName: string, value: any) => void = () => {};
  export let onShaderParamDragEnd: (layerIndex: number, paramName: string) => void = () => {};

  // Composition effects synced from desktop
  export let compositionEffects: Effect[] = [];

  let isTablet = false;
  let isLandscape = false;
  let controllerEl: HTMLDivElement;

  // Phone-only: which layers currently have their shader-params drawer
  // expanded. Default = all collapsed so the opacity faders stack
  // tightly and stay reachable; the user taps PARAMS to expand the
  // shader-params panel for editing, taps again to collapse. Tablet
  // layout has plenty of room to show params permanently so this state
  // doesn't apply there.
  let expandedShaderLayers = new Set<number>();
  function toggleShaderParams(layerIndex: number) {
    if (expandedShaderLayers.has(layerIndex)) {
      expandedShaderLayers.delete(layerIndex);
    } else {
      expandedShaderLayers.add(layerIndex);
    }
    expandedShaderLayers = expandedShaderLayers;  // trigger Svelte reactivity
  }

  // Show max 6 layers in mixer, scroll for more
  const MAX_VISIBLE_LAYERS = 6;
  const layerColors = [
    'var(--accent-primary)',
    '#4FC3F7',
    '#81C784',
    '#FFB74D',
    '#CE93D8',
    '#EF5350',
    '#4DD0E1',
    '#AED581',
  ];

  function checkDevice() {
    isTablet = window.innerWidth >= 768;
    isLandscape = window.innerWidth > window.innerHeight;
  }

  onMount(() => {
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => {
      window.removeEventListener('resize', checkDevice);
    };
  });

  // Derived data
  $: blocks = vjClipsState?.blocks || [];
  $: activeBlockId = vjClipsState?.activeBlockId || '';
  $: activeBlock = blocks.find((b: any) => b.id === activeBlockId) || null;
  $: clipGrid = activeBlock?.clipGrid || [];
  $: layerStates = vjClipsState?.layerStates || [];
  $: numColumns = clipGrid[0]?.length || 8;
  $: isLive = vjClipsState?.isLive || false;
  $: masterOpacity = vjClipsState?.masterOpacity ?? 1;
  $: phoneShaderLayers = layerStates
    .map((layerState: any, layerIndex: number) => ({ layerState, layerIndex }))
    .filter(({ layerState }: any) => layerState?.activeClip?.type === 'shader');
</script>

{#if !vjClipsState}
  <div class="vj-empty">
    <div class="empty-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    </div>
    <p class="empty-title">No VJ Session Active</p>
    <p class="empty-hint">Open the VJ panel on the desktop to start</p>
  </div>
{:else if isTablet}
  <!-- ═══ TABLET / iPad LAYOUT ═══ -->
  <!-- TOP: Clip launcher (mixer + grid) -->
  <!-- BOTTOM: 40% shader params | 60% effects -->
  <div class="vj-controller tablet" bind:this={controllerEl}>
    <!-- Block selector at top -->
    {#if blocks.length > 1}
      <div class="vj-section block-section">
        <VJBlockSelector {blocks} {activeBlockId} {onSetBlock} />
      </div>
    {/if}

    <!-- ═══ TOP: VJ Clip Launcher ═══ -->
    <div class="launcher-section">
      <!-- Mixer strips on the left -->
      <div class="launcher-mixer" class:scrollable={layerStates.length > MAX_VISIBLE_LAYERS}>
        {#each layerStates.slice(0, MAX_VISIBLE_LAYERS) as layerState, layerIndex}
          <VJMixerStrip
            {layerIndex}
            {layerState}
            isTablet={true}
            onOpacityChange={onSetLayerOpacity}
            onBlendModeChange={onSetLayerBlendMode}
            {onStopLayer}
          />
        {/each}
        {#if layerStates.length > MAX_VISIBLE_LAYERS}
          <div class="more-layers-indicator">
            +{layerStates.length - MAX_VISIBLE_LAYERS} more
          </div>
        {/if}
      </div>

      <!-- Clip grid on the right -->
      <div class="launcher-grid">
        <VJClipGrid
          {clipGrid}
          {layerStates}
          {numColumns}
          isTablet={true}
          {onTriggerClip}
          {onStopLayer}
        />
        <VJColumnTriggers {numColumns} {onTriggerColumn} />
      </div>
    </div>

    <!-- ═══ BOTTOM: Shader Params (40%) + Effects (60%) ═══ -->
    <div class="bottom-panels">
      <div class="bottom-left">
        <div class="panel-header">SHADER PARAMS</div>
        <VJShaderPanel
          {layerStates}
          {onUpdateShaderValue}
          {onShaderParamDragEnd}
        />
      </div>
      <div class="bottom-right">
        <VJEffectsPanel
          {layerStates}
          {compositionEffects}
          {clipGrid}
          onAddLayerEffect={onAddLayerEffect}
          onRemoveLayerEffect={onRemoveLayerEffect}
          onToggleLayerEffect={onToggleLayerEffect}
          onUpdateLayerEffectParams={onUpdateLayerEffectParams}
          {onAddCompEffect}
          {onRemoveCompEffect}
          {onToggleCompEffect}
          {onUpdateCompEffectParams}
          {onAddClipEffect}
          {onRemoveClipEffect}
          {onToggleClipEffect}
          {onUpdateClipEffectParams}
        />
      </div>
    </div>

    <!-- BOTTOM: Master section (pinned) -->
    <VJMasterSection
      {masterOpacity}
      {isLive}
      onMasterOpacityChange={onSetMasterOpacity}
      {onToggleLive}
      {onStopAll}
    />
  </div>
{:else}
  <!-- ═══ PHONE LAYOUT ═══ -->
  <div class="vj-controller phone" class:landscape={isLandscape} bind:this={controllerEl}>
    <!-- Block selector at top -->
    {#if blocks.length > 1}
      <div class="vj-section block-section">
        <VJBlockSelector {blocks} {activeBlockId} {onSetBlock} />
      </div>
    {/if}

    {#if isLandscape}
      <!-- LANDSCAPE: Side-by-side layout with scrollable content -->
      <div class="landscape-layout">
        <!-- LEFT: Clip grid + column triggers -->
        <div class="landscape-grid-side">
          <VJClipGrid
            {clipGrid}
            {layerStates}
            {numColumns}
            isTablet={false}
            {onTriggerClip}
            {onStopLayer}
          />
          <VJColumnTriggers {numColumns} {onTriggerColumn} />
        </div>

        <!-- RIGHT: Mixer strips (vertical in landscape for better control) -->
        <div class="landscape-mixer-side">
          {#each layerStates as layerState, layerIndex}
            <VJMixerStrip
              {layerIndex}
              {layerState}
              isTablet={true}
              onOpacityChange={onSetLayerOpacity}
              onBlendModeChange={onSetLayerBlendMode}
              {onStopLayer}
            />
          {/each}
        </div>
      </div>
      {#if phoneShaderLayers.length > 0}
        <div class="vj-section phone-shader-section landscape-shader-section">
          {#each phoneShaderLayers as { layerIndex }}
            <div
              class="phone-layer-shader-wrap"
              style="--layer-color: {layerColors[layerIndex % layerColors.length]}"
            >
              <button
                class="params-toggle"
                class:expanded={expandedShaderLayers.has(layerIndex)}
                on:click={() => toggleShaderParams(layerIndex)}
                aria-label={expandedShaderLayers.has(layerIndex) ? `Hide L${layerIndex + 1} shader params` : `Show L${layerIndex + 1} shader params`}
              >
                <span class="params-toggle-label">L{layerIndex + 1} PARAMS</span>
                <span class="params-toggle-chevron">{expandedShaderLayers.has(layerIndex) ? '▾' : '▸'}</span>
              </button>
              {#if expandedShaderLayers.has(layerIndex)}
                <div class="phone-layer-shader">
                  <VJShaderPanel
                    {layerStates}
                    {onUpdateShaderValue}
                    {onShaderParamDragEnd}
                    embedded={true}
                    fixedLayerIndex={layerIndex}
                    showLayerSelector={false}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- PORTRAIT: Stacked layout -->
      <!-- Clip grid + column triggers -->
      <div class="vj-section grid-section">
        <VJClipGrid
          {clipGrid}
          {layerStates}
          {numColumns}
          isTablet={false}
          {onTriggerClip}
          {onStopLayer}
        />
        <VJColumnTriggers {numColumns} {onTriggerColumn} />
      </div>

      <!-- Mixer strips (horizontal — full width). Each layer renders its
           opacity fader + (if a shader is active) a small toggle that
           expands an inline shader-params panel below the row. The
           panel starts collapsed so the opacity faders stack tightly
           and stay reachable; tap PARAMS to expand for editing. -->
      <div class="vj-section mixer-section">
        {#each layerStates as layerState, layerIndex}
          <div class="phone-layer-control">
            <div class="phone-layer-row">
              <div class="phone-layer-mixer">
                <VJMixerStrip
                  {layerIndex}
                  {layerState}
                  isTablet={false}
                  onOpacityChange={onSetLayerOpacity}
                  onBlendModeChange={onSetLayerBlendMode}
                  {onStopLayer}
                />
              </div>
              {#if layerState?.activeClip?.type === 'shader'}
                <button
                  class="params-toggle inline"
                  class:expanded={expandedShaderLayers.has(layerIndex)}
                  style="--layer-color: {layerColors[layerIndex % layerColors.length]}"
                  on:click={() => toggleShaderParams(layerIndex)}
                  aria-label={expandedShaderLayers.has(layerIndex) ? `Hide L${layerIndex + 1} shader params` : `Show L${layerIndex + 1} shader params`}
                  title={expandedShaderLayers.has(layerIndex) ? 'Hide params' : 'Show params'}
                >
                  <span class="params-toggle-chevron">{expandedShaderLayers.has(layerIndex) ? '▾' : '▸'}</span>
                  <span class="params-toggle-label">PARAMS</span>
                </button>
              {/if}
            </div>
            {#if layerState?.activeClip?.type === 'shader' && expandedShaderLayers.has(layerIndex)}
              <div
                class="phone-layer-shader"
                style="--layer-color: {layerColors[layerIndex % layerColors.length]}"
              >
                <VJShaderPanel
                  {layerStates}
                  {onUpdateShaderValue}
                  {onShaderParamDragEnd}
                  embedded={true}
                  fixedLayerIndex={layerIndex}
                  showLayerSelector={false}
                />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Master section (pinned to bottom) -->
    <VJMasterSection
      {masterOpacity}
      {isLive}
      onMasterOpacityChange={onSetMasterOpacity}
      {onToggleLive}
      {onStopAll}
    />
  </div>
{/if}

<style>
  /* ── Empty State ── */
  .vj-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: rgba(255, 255, 255, 0.3);
    padding: 40px;
  }
  .empty-icon {
    opacity: 0.3;
  }
  .empty-title {
    font-size: 16px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
  }
  .empty-hint {
    font-size: 12px;
  }

  /* ── Controller Container ── */
  .vj-controller {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary, #0a0a0c);
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }

  /* ── Phone Layout ── */
  .vj-section {
    flex-shrink: 0;
  }

  .grid-section {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .mixer-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    flex-shrink: 0;
  }

  .phone-layer-control {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Row that holds the mixer strip + the inline params toggle.
     Mixer fills available width; toggle is fixed width on the right. */
  .phone-layer-row {
    display: flex;
    align-items: stretch;
    gap: 6px;
  }
  .phone-layer-mixer {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* Compact PARAMS toggle button. Big enough to hit reliably with a
     thumb (44×~50px on phones) without crowding the opacity fader. */
  .params-toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 56px;
    padding: 4px 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.15s;
    -webkit-tap-highlight-color: transparent;
  }
  .params-toggle.inline {
    border-left-width: 3px;
    border-left-color: var(--layer-color, rgba(255, 255, 255, 0.2));
  }
  .params-toggle:active {
    transform: scale(0.96);
  }
  .params-toggle.expanded {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    border-color: var(--layer-color, rgba(255, 255, 255, 0.2));
  }
  .params-toggle-chevron {
    font-size: 14px;
    line-height: 1;
    color: var(--layer-color, currentColor);
  }
  .params-toggle-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
  }

  /* Wrapper used in landscape "shader section" — header (toggle) above
     a collapsible body. Stacks vertically rather than inline because
     in landscape the mixer + grid live in their own row above. */
  .phone-layer-shader-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    border-left: 3px solid var(--layer-color);
  }
  .phone-layer-shader-wrap > .params-toggle {
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
    min-height: 36px;
    border-left: none;
  }
  .phone-layer-shader-wrap > .params-toggle .params-toggle-label {
    font-size: 11px;
  }

  .phone-layer-shader {
    margin-left: 8px;
    border-left: 3px solid var(--layer-color);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.025);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.055);
    overflow: hidden;
  }
  /* Inside the landscape wrapper the shader panel doesn't need its own
     border-left (the wrapper already has one), so neutralize. */
  .phone-layer-shader-wrap > .phone-layer-shader {
    margin-left: 0;
    border-left: none;
  }

  .phone-shader-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    flex-shrink: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .landscape-shader-section {
    max-height: 44vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .block-section {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.01);
  }

  /* ── Phone Landscape Layout ── */
  .landscape-layout {
    display: grid;
    grid-template-columns: 1fr auto;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .landscape-grid-side {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  .landscape-mixer-side {
    display: flex;
    gap: 4px;
    padding: 6px;
    overflow-y: auto;
    overflow-x: hidden;
    background: rgba(255, 255, 255, 0.01);
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* ── Tablet Layout ── */
  .vj-controller.tablet {
    display: flex;
    flex-direction: column;
  }

  /* ── TOP: Clip Launcher (mixer strips + clip grid side by side) ── */
  .launcher-section {
    display: grid;
    grid-template-columns: auto 1fr;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .launcher-mixer {
    display: flex;
    gap: 4px;
    padding: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    -webkit-overflow-scrolling: touch;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.01);
  }

  .launcher-mixer.scrollable {
    -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
    mask-image: linear-gradient(to right, black 85%, transparent 100%);
  }

  .more-layers-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 8px;
    font-size: 9px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.3);
    white-space: nowrap;
    flex-shrink: 0;
    letter-spacing: 0.5px;
  }

  .launcher-grid {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* ── BOTTOM: Shader (40%) + Effects (60%) side by side ── */
  .bottom-panels {
    display: grid;
    grid-template-columns: 40fr 60fr;
    flex: 1;
    min-height: 0;
    max-height: 45%;
    overflow: hidden;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .bottom-left {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.01);
  }

  .bottom-right {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    font-size: 9px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.35);
    letter-spacing: 1.5px;
    padding: 5px 8px 3px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }
</style>
