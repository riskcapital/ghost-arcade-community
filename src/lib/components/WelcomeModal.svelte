<script lang="ts">
  /**
   * Welcome modal — first-run greeting for Ghost Arcade Community.
   *
   * Pro version of this file showed three buttons: Enter License Key /
   * Start Free Demo / Purchase License. OSS has no licensing — just a
   * one-button "Get Started" that dismisses the modal and lets the
   * caller kick off the demo project download.
   */
  export let onClose: () => void = () => {};

  function getStarted() {
    localStorage.setItem('ghostarcade-welcome-seen', 'true');
    onClose();
  }

  function openRepo() {
    window.open('https://github.com/riskcapital/ghost-arcade-community', '_blank');
  }
</script>

<div class="welcome-overlay">
  <div class="welcome-panel">
    <h1 class="welcome-title">Welcome to Ghost Arcade Community</h1>
    <p class="welcome-subtitle">Open-source projection mapping &amp; VJ software</p>

    <p class="welcome-body">
      A demo project will load automatically so you have something to play with.
      Open the <strong>Settings</strong> panel for input device options, MIDI
      controllers, and output configuration.
    </p>

    <div class="welcome-actions">
      <button class="welcome-btn primary" onclick={getStarted}>
        Get Started
      </button>
      <button class="welcome-btn outline" onclick={openRepo}>
        View on GitHub
      </button>
    </div>

    <p class="welcome-hint">
      Ghost Arcade Community is licensed under AGPL-3.0.
      Need texture sharing, AI generation, dual-deck VJ, or commercial
      licensing? See the <a href="https://ghostarcade.live" target="_blank" rel="noopener">Pro edition</a>.
    </p>
  </div>
</div>

<style>
  .welcome-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
    backdrop-filter: blur(8px);
  }

  .welcome-panel {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border: 1px solid #333;
    border-radius: 16px;
    padding: 36px 36px 28px;
    width: 460px;
    text-align: center;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }

  .welcome-title {
    font-size: 22px;
    font-weight: 700;
    color: #e0e0e0;
    margin: 0 0 6px 0;
  }

  .welcome-subtitle {
    font-size: 13px;
    color: #888;
    margin: 0 0 20px 0;
  }

  .welcome-body {
    font-size: 13px;
    color: #aaa;
    line-height: 1.55;
    margin: 0 0 24px 0;
  }

  .welcome-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 18px;
  }

  .welcome-btn {
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .welcome-btn.primary {
    background: linear-gradient(135deg, #e74c6f, #c2185b);
    color: #fff;
    border: none;
  }
  .welcome-btn.primary:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .welcome-btn.outline {
    background: transparent;
    color: #999;
    border: 1px solid #333;
  }
  .welcome-btn.outline:hover {
    color: #ccc;
    border-color: #555;
  }

  .welcome-hint {
    font-size: 11px;
    color: #666;
    line-height: 1.6;
    margin: 0;
  }
  .welcome-hint a { color: #999; text-decoration: underline; }
  .welcome-hint a:hover { color: #ccc; }
</style>
