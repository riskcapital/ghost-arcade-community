/**
 * Ghost Arcade Community — feature-gate stub.
 *
 * Pro version of this file enforced per-tier effect access (Premium effects
 * locked behind paid tiers, etc.). OSS version unlocks everything — every
 * effect is available to every user. Module exists only to preserve the
 * import surface used by `effectCatalog.ts` and `EffectPickerModal.svelte`.
 *
 * See `src/lib/stores/license.ts` for the rationale.
 */

import type { LicenseTier } from '$lib/stores/license';

// Pro version had multiple tiers ('demo' | 'starter' | 'pro' | 'core').
// OSS keeps the union for type compat with .gha project files that may
// have been authored under the Pro version, but every tier is treated
// as 'core' (unrestricted) at runtime.
export type EffectTier = 'core' | 'demo' | 'starter' | 'pro';

// Every effect category resolves to 'core' = unrestricted.
export function getEffectTier(_category: string): EffectTier { return 'core'; }

// Always allowed — nothing is locked.
export function canAccessEffect(_tier: LicenseTier, _category: string): boolean { return true; }

// Never reached in OSS UI (no locked effects), kept for type compat.
export function getTierBadgeLabel(_tier: EffectTier): string { return ''; }
