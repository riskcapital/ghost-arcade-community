/**
 * Ghost Arcade Community — license stub.
 *
 * The Pro version of this app uses a licensing system to gate certain
 * features behind a paid tier. This Community Edition is fully open
 * source under AGPL-3.0 and has NO licensing — every feature ships to
 * every user without restriction.
 *
 * This module preserves the import surface used by the rest of the
 * codebase (`canUseX`, `licenseTier`, etc.) but every gate returns the
 * unrestricted value. The dead `{#if !canUseX}` branches in components
 * never render. This is intentional: keeping the same interface lets
 * the OSS fork stay in lockstep with the Pro app's component code, so
 * bug fixes and feature improvements port both ways without surgery.
 *
 * If you fork this project and want to ship a paid tier on top, this
 * is the file to replace — the rest of the codebase already calls
 * through these gates.
 */

import { readable, type Readable } from 'svelte/store';

// Wider than the runtime ever produces, but kept for type compat with
// surviving call sites that reference the Pro version's tier names. The
// only value ever emitted at runtime is 'community'.
export type LicenseTier = 'community' | 'demo' | 'starter' | 'pro';

// Always 'community' — the only tier in the OSS build.
export const licenseTier: Readable<LicenseTier> = readable<LicenseTier>('community');

// No watermark, no grace period nag, no activation flow.
export const hasWatermark: Readable<boolean> = readable(false);
export const graceWarning: Readable<string | null> = readable(null);
export const licenseStatus: Readable<{ valid: true; tier: LicenseTier }> =
  readable({ valid: true as const, tier: 'community' as const });

// Every "can use X" flag returns true — every feature is unlocked.
export const canUseOwnAPIKeys: Readable<boolean> = readable(true);
export const canUseMIDIEdit: Readable<boolean> = readable(true);
export const canUseOutputSlices: Readable<boolean> = readable(true);
export const canUseVideoExport: Readable<boolean> = readable(true);
export const canUseFluidGen: Readable<boolean> = readable(false);  // OSS build doesn't ship FluidGen
export const canUseParticles3D: Readable<boolean> = readable(false);  // OSS build doesn't ship Particles3D

// Output slice count cap — Infinity in OSS (caller still respects whatever
// settings.output.slices.length is, this just removes the upper bound).
export const maxOutputSlices: Readable<number> = readable(Infinity);

// Layer count cap — Infinity in OSS. Pro version had a tier-dependent
// cap (4 for demo, 8 for starter, unlimited for pro).
export const maxLayers: Readable<number> = readable(Infinity);

// ── Lifecycle no-ops ──
// Pro version has license validation + revalidation timers. OSS version
// just returns immediately so callers don't need conditional logic.
export async function initLicense(): Promise<void> { /* no-op */ }
export function destroyLicense(): void { /* no-op */ }

// Dev override existed in Pro for testing tier transitions; OSS has no
// tiers so this is a no-op kept for type compatibility.
export function setDevTierOverride(_tier: LicenseTier): void { /* no-op */ }

// Pro version's activation flow took a key string. OSS rejects since there's
// nothing to activate — the kept signature lets old call sites compile.
export async function activateLicense(_key: string): Promise<{ ok: false; reason: string }> {
  return { ok: false, reason: 'No license required for Ghost Arcade Community.' };
}
