/**
 * Ghost Arcade Community — ai-client stub.
 *
 * Pro version provides a chat client for shader/video generation against
 * Anthropic + Luma APIs. OSS strips AI generation entirely. This stub
 * preserves the type + validator export surface only so the SettingsPanel
 * (which has a now-dead "AI keys" section) and shaderLibrary's GenerationType
 * type still compile.
 */

// Pro's GenerationType union — kept to satisfy shaderLibrary's `GenerationType`
// type-only import. Saved-shader records authored under the Pro version may
// carry these tags; OSS reads them as string labels with no runtime meaning.
// Wider than what the Pro version emits — covers MediaLibrary's extra
// source kinds (`threejs`, `p5js`, `shader-isf`) so saved-source enums
// from older project files round-trip cleanly.
export type GenerationType = 'shader' | 'shader-isf' | 'video' | 'image' | 'enhance' | 'hybrid' | 'threejs' | 'p5js';

// SettingsPanel called these to live-validate keys typed into the (removed)
// AI tab. Returns plain `false` so existing call sites that use the result
// as a boolean (`claudeKeyValid = await validateAPIKey(...)`) keep working.
// Variadic args accept any provider/model combo the Pro version passed.
export async function validateAPIKey(..._args: unknown[]): Promise<boolean> {
  return false;
}
export async function validateLumaKey(..._args: unknown[]): Promise<boolean> {
  return false;
}
