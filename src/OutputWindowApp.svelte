<script lang="ts">
  /**
   * Minimal renderer for the second-display output window.
   * The main window broadcasts project state; this window renders it
   * full-bleed with no editor panels or toolbars.
   */
  import { onMount, onDestroy } from 'svelte';
  import Canvas from './lib/components/Canvas.svelte';
  import { initStateBroadcast, destroyStateBroadcast } from './lib/sync/stateBroadcast';
  import { invoke } from '$lib/bridge';

  onMount(() => {
    console.log('[Output] Output window started', window.innerWidth, 'x', window.innerHeight);

    // Remove splash immediately; this window doesn't go through App.svelte
    // which normally hides the splash screen during init.
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    // Receive state from the main window via BroadcastChannel
    initStateBroadcast('receiver');

    // Double-click toggles fullscreen on the output display; common VJ
    // gesture so the performer can quickly enter/leave fullscreen on the
    // projector without reaching for the editor window.
    const onDblClick = () => {
      invoke('output_toggle_fullscreen').catch((err: any) => {
        console.error('[Output] Failed to toggle fullscreen:', err);
      });
    };
    window.addEventListener('dblclick', onDblClick);

    return () => {
      window.removeEventListener('dblclick', onDblClick);
    };
  });

  onDestroy(() => {
    destroyStateBroadcast();
  });
</script>

<!-- Full-window canvas, no UI -->
<div class="output-window">
  <Canvas />
</div>

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #000;
    width: 100vw;
    height: 100vh;
    /* Hide the cursor on the output display by default; performers can
       still wiggle the mouse to make it appear briefly via the OS. */
    cursor: none;
  }

  :global(#app) {
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
  }

  .output-window {
    width: 100vw;
    height: 100vh;
    background: #000;
  }
</style>
