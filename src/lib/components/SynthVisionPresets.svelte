<script lang="ts">
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Preset = { id: string; name: string; _scope?: string; [key: string]: any };

  export let allPresets: Preset[] = [];
  export let activePresetId: string | null = null;
  export let onSave: (name: string, scope: 'project' | 'global') => void;
  export let onLoad: (preset: Preset) => void;
  export let onDelete: (id: string) => void;

  let showNameInput = false;
  let nameInput = '';
  let saveScope: 'project' | 'global' = 'project';

  function handleSave(name: string) {
    onSave(name, saveScope);
    showNameInput = false;
    nameInput = '';
  }
</script>

<div class="sv-preset-bar">
  <div class="sv-preset-left">
    {#if showNameInput}
      <input class="sv-preset-input" type="text" placeholder="Preset name..." bind:value={nameInput}
        on:keydown={(e) => { if (e.key === 'Enter') handleSave(nameInput); if (e.key === 'Escape') { showNameInput = false; nameInput = ''; } }} />
      <button class="sv-scope-toggle"
        class:global={saveScope === 'global'}
        on:click={() => saveScope = saveScope === 'project' ? 'global' : 'project'}
        title={saveScope === 'project' ? 'Save to this project only' : 'Save globally (all projects)'}>
        {saveScope === 'project' ? '\u{1F4C1}' : '\u{1F310}'}
      </button>
      <button class="sv-preset-save-confirm" on:click={() => handleSave(nameInput)}>OK</button>
      <button class="sv-preset-save-cancel" on:click={() => { showNameInput = false; nameInput = ''; }}>X</button>
    {:else}
      <button class="sv-preset-save-btn" on:click={() => { showNameInput = true; }}>SAVE</button>
    {/if}
  </div>
  <div class="sv-preset-list">
    {#each allPresets as preset (preset.id)}
      <button class="sv-preset-btn" class:active={activePresetId === preset.id}
        class:global-preset={preset._scope === 'global'}
        on:click={() => onLoad(preset)}
        on:contextmenu={(e) => { e.preventDefault(); onDelete(preset.id); }}>
        {#if preset._scope === 'global'}<span class="sv-preset-scope" title="Global preset">G</span>{/if}{preset.name}
      </button>
    {/each}
    {#if allPresets.length === 0}
      <span class="sv-preset-hint">No saved presets</span>
    {/if}
  </div>
</div>

<style>
  .sv-preset-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.3);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .sv-preset-left {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .sv-preset-input {
    width: 120px;
    padding: 3px 6px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    color: #e8e8e8;
    font-size: 11px;
  }

  .sv-scope-toggle {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 12px;
    cursor: pointer;
    color: #aaa;
  }
  .sv-scope-toggle.global {
    border-color: rgba(100, 200, 255, 0.3);
  }

  .sv-preset-save-btn,
  .sv-preset-save-confirm,
  .sv-preset-save-cancel {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: #ccc;
    padding: 3px 8px;
    font-size: 10px;
    cursor: pointer;
  }
  .sv-preset-save-btn:hover,
  .sv-preset-save-confirm:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .sv-preset-list {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    flex: 1;
  }

  .sv-preset-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #aaa;
    padding: 3px 10px;
    font-size: 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.1s ease;
  }
  .sv-preset-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
  }
  .sv-preset-btn.active {
    background: rgba(100, 200, 255, 0.15);
    border-color: rgba(100, 200, 255, 0.3);
    color: #e8e8e8;
  }
  .sv-preset-btn.global-preset {
    border-color: rgba(200, 150, 255, 0.2);
  }

  .sv-preset-scope {
    font-size: 8px;
    margin-right: 3px;
    opacity: 0.6;
  }

  .sv-preset-hint {
    color: #555;
    font-size: 10px;
    font-style: italic;
  }
</style>
