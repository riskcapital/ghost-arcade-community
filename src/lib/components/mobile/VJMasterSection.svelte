<script lang="ts">
  import VJFader from './VJFader.svelte';

  export let masterOpacity: number = 1;
  export let isLive: boolean = false;
  export let onMasterOpacityChange: (val: number) => void = () => {};
  export let onToggleLive: () => void = () => {};
  export let onStopAll: () => void = () => {};
</script>

<div class="master-section">
  <div class="master-fader-row">
    <span class="master-label">MASTER</span>
    <div class="master-fader">
      <VJFader
        value={masterOpacity}
        label=""
        color="var(--accent-primary)"
        orientation="horizontal"
        onChange={onMasterOpacityChange}
        showLeds={true}
        ledCount={12}
      />
    </div>
  </div>
  <div class="master-buttons">
    <button
      class="live-btn"
      class:active={isLive}
      on:click={onToggleLive}
    >
      <span class="live-dot" class:active={isLive}></span>
      {isLive ? 'LIVE' : 'GO LIVE'}
    </button>
    <button
      class="stop-all-btn"
      on:click={onStopAll}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
      STOP ALL
    </button>
  </div>
</div>

<style>
  .master-section {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(10, 10, 14, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
    z-index: 10;
  }

  .master-fader-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .master-label {
    font-size: 10px;
    font-weight: 800;
    color: var(--accent-primary, #FF6B6B);
    letter-spacing: 2px;
    text-shadow: 0 0 10px var(--accent-primary, #FF6B6B);
    white-space: nowrap;
  }

  .master-fader {
    flex: 1;
    min-width: 0;
  }

  .master-buttons {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .live-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    background: rgba(60, 60, 60, 0.6);
    border: 2px solid #444;
    color: #888;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }

  .live-btn.active {
    background: rgba(255, 50, 50, 0.12);
    border-color: #ff3333;
    color: #ff3333;
    box-shadow:
      0 0 16px rgba(255, 50, 50, 0.25),
      inset 0 0 16px rgba(255, 50, 50, 0.04);
    animation: live-pulse 1.5s ease-in-out infinite;
  }

  .live-btn:active {
    transform: scale(0.96);
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    transition: background 0.2s;
  }

  .live-dot.active {
    background: #ff3333;
    box-shadow: 0 0 8px #ff3333;
    animation: dot-blink 1s infinite;
  }

  @keyframes live-pulse {
    0%, 100% {
      box-shadow:
        0 0 16px rgba(255, 50, 50, 0.25),
        inset 0 0 16px rgba(255, 50, 50, 0.04);
    }
    50% {
      box-shadow:
        0 0 32px rgba(255, 50, 50, 0.4),
        0 0 60px rgba(255, 50, 50, 0.15),
        inset 0 0 20px rgba(255, 50, 50, 0.06);
    }
  }

  @keyframes dot-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .stop-all-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    background: rgba(255, 68, 68, 0.08);
    border: 1px solid rgba(255, 68, 68, 0.25);
    color: #ff4444;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }

  .stop-all-btn:active {
    transform: scale(0.95);
    background: rgba(255, 68, 68, 0.25);
    box-shadow: 0 0 16px rgba(255, 68, 68, 0.3);
  }
</style>
