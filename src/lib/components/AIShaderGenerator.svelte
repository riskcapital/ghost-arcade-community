<script lang="ts">
  /**
   * Ghost Arcade Community — AIShaderGenerator stub.
   *
   * Pro version generates shaders via Claude. OSS strips AI generation
   * entirely. This stub exists only so the call sites in MediaTray /
   * MediaLibrary / VJModePanel still compile and render. The component
   * renders nothing; props are accepted-and-ignored.
   */
  // svelte-ignore unused_export_let
  export let onClose: (() => void) | null = null;
  // svelte-ignore unused_export_let
  export let editingItem: unknown = null;
  void onClose; void editingItem;
</script>
