/**
 * Ghost Arcade Community — plugins/registry stub.
 *
 * Pro version maintains a registry of generative-effect plugins (FluidGen,
 * Particles3D, etc.) loaded from /public/plugins/. OSS removes the plugin
 * tab entirely — every effect ships in the core catalog. This stub keeps
 * the type + helper surface alive so MediaTray + VJModePanel compile.
 */

export interface PluginParamDef {
  param: string;
  // Pro version uses some legacy alternate names — preserve for type compat.
  name?: string;
  label: string;
  type: 'number' | 'boolean' | 'string' | 'color' | 'select' | 'slider' | 'toggle';
  default: number | boolean | string;
  value?: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  // `options` always uses { value; label } records in OSS — kept narrow
  // so callers can `.value` / `.label` without union-narrowing each time.
  // Pro version supported a string-only fallback that the OSS callers
  // (none, since plugins are always empty) never relied on.
  options?: { value: string | number; label: string }[];
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: 'demo' | 'starter' | 'pro';
  params: PluginParamDef[];
  // Pro version has multiple optional fields used by MediaTray rendering;
  // OSS keeps them in the type so the never-instantiated callsites compile.
  paramDefs?: PluginParamDef[];
  effectType?: string;
  icon?: string;
  previewCSS?: string;
  defaultSourceParams?: Record<string, unknown>;
}

// OSS has no plugins. Returning empty arrays keeps MediaTray's "no plugins
// available" branch active.
export function getAllPlugins(): PluginManifest[] { return []; }
export function getPlugin(_id: string): PluginManifest | null { return null; }
export function getPluginByEffectType(_effectType: string): PluginManifest | null { return null; }
