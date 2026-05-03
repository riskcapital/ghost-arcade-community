// Parameter Modulation Engine
// Maps shader uniform parameters to modulation sources (audio bands, BPM, LFO/time)
// Runs each frame, applying modulated values to active VJ clips and mapping layers

import { get } from 'svelte/store';
import { writable } from 'svelte/store';
import { audioStore, type AudioState } from '../stores/audio';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import type { ISFInput } from '../isf/parser';

// Callback for applying modulated values to mapping mode layers
// Registered by the layers store to avoid circular imports
// (layerIndex, values) => void
let _mappingLayerUpdater: ((layerIndex: number, values: Record<string, number>) => void) | null = null;

// Callback to read mapping layer shader values (for initial base value capture)
// (layerIndex, paramName) => number | undefined
let _mappingLayerReader: ((layerIndex: number, paramName: string) => number | undefined) | null = null;

// Returns true if layerIndex refers to a mapping layer (not VJ)
let _isMappingLayer: ((layerIndex: number) => boolean) | null = null;

/** Register mapping mode callbacks — called once from layers store init */
export function registerMappingLayerCallbacks(
  updater: (layerIndex: number, values: Record<string, number>) => void,
  reader: (layerIndex: number, paramName: string) => number | undefined,
  isMapping: (layerIndex: number) => boolean,
) {
  _mappingLayerUpdater = updater;
  _mappingLayerReader = reader;
  _isMappingLayer = isMapping;
}

// Modulation source types
export type ModSource =
  | 'manual'     // No modulation, manual slider only
  | 'sub'        // 20-60 Hz sub bass
  | 'bass'       // 60-250 Hz bass
  | 'lowMid'     // 250-500 Hz
  | 'mid'        // 500-2000 Hz
  | 'highMid'    // 2000-4000 Hz
  | 'high'       // 4000-20000 Hz
  | 'amplitude'  // Overall volume
  | 'beatPhase'  // 0-1 ramp synced to beat
  | 'lfo-sine'   // Sine wave LFO
  | 'lfo-saw'    // Sawtooth LFO
  | 'lfo-square' // Square wave LFO
  | 'lfo-tri';   // Triangle wave LFO

// A single parameter modulation assignment
export interface ParamModulation {
  source: ModSource;
  amount: number;    // 0-1 how much the source affects the parameter
  speed: number;     // LFO speed multiplier (only for LFO sources), cycles per second
  invert: boolean;   // Invert the modulation signal
}

// Default modulation values for new assignments
export const DEFAULT_MOD: Omit<ParamModulation, 'source'> = {
  amount: 0.5,
  speed: 1,
  invert: false,
};

// Pre-parsed key for hot-path use (avoids split(':') per frame)
interface ParsedModEntry {
  mod: ParamModulation;
  layerIndex: number;
  isEffect: boolean;
  effectId: string;   // '' for shader params
  paramName: string;
}

// Key formats:
//   Shader params:  "layerIndex:paramName"
//   Effect params:  "layerIndex:fx:effectId:paramName"
export type ModulationMap = Map<string, ParamModulation>;

// Pre-parsed cache rebuilt on store change — avoids per-frame string parsing
let parsedCache: ParsedModEntry[] = [];

// Parameter range registry — stores ISF min/max for shader params to enable clamping
// Key format: "layerIndex:paramName"
const paramRanges = new Map<string, { min: number; max: number }>();

// Last modulated values — for UI ghost indicator display
const lastModulatedValues = new Map<string, number>();

// Base values — the user's manual slider position, never overwritten by modulation.
// Without this, the modulation engine would read its own output as next frame's input,
// creating a runaway feedback loop where values drift to min/max and stick.
// Key format: "layerIndex:paramName"
const baseValues = new Map<string, number>();

/** Register ISF parameter ranges for a layer so modulation can clamp correctly */
export function registerParamRanges(layerIndex: number, inputs: ISFInput[]) {
  // Clear old ranges for this layer
  for (const key of paramRanges.keys()) {
    if (key.startsWith(`${layerIndex}:`)) paramRanges.delete(key);
  }
  for (const input of inputs) {
    if (input.TYPE === 'float' || input.TYPE === 'long' || input.TYPE === 'event') {
      paramRanges.set(`${layerIndex}:${input.NAME}`, {
        min: input.MIN ?? 0,
        max: input.MAX ?? 1,
      });
    }
  }
}

/** Get the last computed modulated value for a param (for UI ghost indicators) */
export function getModulatedValue(layerIndex: number, paramName: string): number | null {
  return lastModulatedValues.get(`${layerIndex}:${paramName}`) ?? null;
}

/** Clear all modulated value cache entries for a layer */
export function clearModulatedValues(layerIndex: number) {
  for (const key of lastModulatedValues.keys()) {
    if (key.startsWith(`${layerIndex}:`)) lastModulatedValues.delete(key);
  }
}

/** Set the base (manual slider) value for a parameter — called when user moves a slider */
export function setBaseValue(layerIndex: number, paramName: string, value: number) {
  baseValues.set(`${layerIndex}:${paramName}`, value);
}

/** Clear all base values for a layer (call on shader/clip switch) */
export function clearBaseValues(layerIndex: number) {
  for (const key of baseValues.keys()) {
    if (key.startsWith(`${layerIndex}:`)) baseValues.delete(key);
  }
}

function rebuildParsedCache(map: ModulationMap) {
  parsedCache = [];
  for (const [key, mod] of map) {
    const parts = key.split(':');
    const layerIndex = parseInt(parts[0], 10);
    if (parts[1] === 'fx') {
      parsedCache.push({ mod, layerIndex, isEffect: true, effectId: parts[2], paramName: parts[3] });
    } else {
      parsedCache.push({ mod, layerIndex, isEffect: false, effectId: '', paramName: parts[1] });
    }
  }
}

// Store for modulation assignments
function createModulationStore() {
  const { subscribe, update, set } = writable<ModulationMap>(new Map());

  // Rebuild parsed cache whenever store changes
  subscribe(map => rebuildParsedCache(map));

  return {
    subscribe,

    /** Set modulation for a specific layer+param (shader) */
    setModulation(layerIndex: number, paramName: string, mod: ParamModulation) {
      update(map => {
        const newMap = new Map(map);
        const key = `${layerIndex}:${paramName}`;
        if (mod.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, mod);
        }
        return newMap;
      });
    },

    /** Get modulation for a specific layer+param (shader) */
    getModulation(layerIndex: number, paramName: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(`${layerIndex}:${paramName}`);
    },

    /** Set modulation for an effect parameter */
    setEffectModulation(layerIndex: number, effectId: string, paramName: string, mod: ParamModulation) {
      update(map => {
        const newMap = new Map(map);
        const key = `${layerIndex}:fx:${effectId}:${paramName}`;
        if (mod.source === 'manual') {
          newMap.delete(key);
        } else {
          newMap.set(key, mod);
        }
        return newMap;
      });
    },

    /** Get modulation for an effect parameter */
    getEffectModulation(layerIndex: number, effectId: string, paramName: string): ParamModulation | undefined {
      const map = get({ subscribe });
      return map.get(`${layerIndex}:fx:${effectId}:${paramName}`);
    },

    /** Remove all modulations for a layer */
    clearLayer(layerIndex: number) {
      update(map => {
        const newMap = new Map(map);
        for (const key of map.keys()) {
          if (key.startsWith(`${layerIndex}:`)) {
            newMap.delete(key);
          }
        }
        return newMap;
      });
    },

    /** Clear everything */
    clearAll() {
      set(new Map());
    },
  };
}

export const modulationStore = createModulationStore();

// ─── Shared helpers (used by VJModePanel, MediaTray, SynthVision) ───

/** Set or clear a shader param's modulation source. Starts engine if needed. */
export function setParamModSource(layerIndex: number, paramName: string, source: ModSource) {
  if (source === 'manual') {
    modulationStore.setModulation(layerIndex, paramName, { source: 'manual', ...DEFAULT_MOD });
  } else {
    const existing = modulationStore.getModulation(layerIndex, paramName);
    modulationStore.setModulation(layerIndex, paramName, {
      source,
      amount: existing?.amount ?? DEFAULT_MOD.amount,
      speed: existing?.speed ?? DEFAULT_MOD.speed,
      invert: existing?.invert ?? DEFAULT_MOD.invert,
    });
  }
  if (source !== 'manual' && !modulationEngine.running) {
    modulationEngine.start();
  }
}

/** Update modulation depth for a shader param */
export function setParamModAmount(layerIndex: number, paramName: string, amount: number) {
  const existing = modulationStore.getModulation(layerIndex, paramName);
  if (existing) {
    modulationStore.setModulation(layerIndex, paramName, { ...existing, amount });
  }
}

/** Update LFO speed for a shader param */
export function setParamModSpeed(layerIndex: number, paramName: string, speed: number) {
  const existing = modulationStore.getModulation(layerIndex, paramName);
  if (existing) {
    modulationStore.setModulation(layerIndex, paramName, { ...existing, speed });
  }
}

// Modulation engine - runs each frame
class ModulationEngine {
  private animFrameId: number | null = null;
  private isRunning = false;
  private startTime = 0;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = performance.now();
    this.tick();
  }

  stop() {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  get running() {
    return this.isRunning;
  }

  private tick = () => {
    if (!this.isRunning) return;

    // Auto-stop when nothing to modulate
    if (parsedCache.length === 0) {
      this.stop();
      return;
    }

    this.applyModulations();
    this.animFrameId = requestAnimationFrame(this.tick);
  };

  private applyModulations() {
    const audio = get(audioStore);
    const now = (performance.now() - this.startTime) / 1000;
    const vjState = get(vjClipLauncher);

    // Batch: collect shader value updates per layer, separated by mode
    const vjBatch = new Map<number, Record<string, number>>();
    const mappingBatch = new Map<number, Record<string, number>>();

    for (const entry of parsedCache) {
      const { mod, layerIndex, isEffect, effectId, paramName } = entry;

      const isMapping = _isMappingLayer ? _isMappingLayer(layerIndex) : false;

      // Validate layer index for VJ mode
      if (!isMapping && (layerIndex < 0 || layerIndex >= vjState.numLayers)) continue;

      let signal = this.getSignal(mod.source, audio, now, mod.speed);
      if (mod.invert) signal = 1 - signal;

      if (isEffect && !isMapping) {
        // Effect params — VJ mode only, use stable base values
        const layerState = vjState.layerStates[layerIndex];
        const effect = layerState.effects.find(e => e.id === effectId);
        if (!effect) continue;
        const fxKey = `${layerIndex}:fx:${effectId}:${paramName}`;
        let fxBase = baseValues.get(fxKey);
        if (fxBase === undefined) {
          const sv = (effect.params as Record<string, number>)[paramName];
          if (typeof sv !== 'number') continue;
          fxBase = sv;
          baseValues.set(fxKey, fxBase);
        }
        const modulated = Math.max(0, Math.min(1, fxBase + (signal - 0.5) * mod.amount * 2));
        vjClipLauncher.updateLayerEffectParams(layerIndex, effectId, { [paramName]: modulated });
      } else if (!isEffect) {
        // Shader params — works for both VJ and mapping modes
        const bvKey = `${layerIndex}:${paramName}`;
        const range = paramRanges.get(bvKey);
        let base = baseValues.get(bvKey);

        if (base === undefined) {
          // First frame: capture current value as the base
          let sv: number | undefined;
          if (isMapping && _mappingLayerReader) {
            sv = _mappingLayerReader(layerIndex, paramName);
          } else {
            const layerState = vjState.layerStates[layerIndex];
            if (!layerState?.activeClip) continue;
            sv = layerState.activeClip.shaderValues?.[paramName] as number | undefined;
          }
          if (typeof sv === 'number') {
            base = sv;
          } else {
            base = range ? (range.min + range.max) / 2 : 0.5;
          }
          baseValues.set(bvKey, base);
        }

        // Scale modulation relative to param range, clamp to ISF min/max
        const span = range ? (range.max - range.min) : 2;
        const raw = base + (signal - 0.5) * mod.amount * span;
        const modulated = range ? Math.max(range.min, Math.min(range.max, raw)) : raw;
        // Store for UI ghost indicator
        lastModulatedValues.set(bvKey, modulated);

        const batch = isMapping ? mappingBatch : vjBatch;
        let layerBatch = batch.get(layerIndex);
        if (!layerBatch) {
          layerBatch = {};
          batch.set(layerIndex, layerBatch);
        }
        layerBatch[paramName] = modulated;
      }
    }

    // Apply batched VJ shader updates
    for (const [layerIndex, values] of vjBatch) {
      vjClipLauncher.batchUpdateShaderValues(layerIndex, values);
    }

    // Apply batched mapping mode shader updates
    if (_mappingLayerUpdater) {
      for (const [layerIndex, values] of mappingBatch) {
        _mappingLayerUpdater(layerIndex, values);
      }
    }
  }

  private getSignal(source: ModSource, audio: AudioState, time: number, speed: number): number {
    switch (source) {
      case 'sub':       return audio.bands.sub;
      case 'bass':      return audio.bands.bass;
      case 'lowMid':    return audio.bands.lowMid;
      case 'mid':       return audio.bands.mid;
      case 'highMid':   return audio.bands.highMid;
      case 'high':      return audio.bands.high;
      case 'amplitude': return audio.amplitude;
      case 'beatPhase': return audio.beatPhase;
      case 'lfo-sine':  return (Math.sin(time * speed * Math.PI * 2) + 1) / 2;
      case 'lfo-saw':   return (time * speed) % 1;
      case 'lfo-square': return (Math.sin(time * speed * Math.PI * 2) > 0) ? 1 : 0;
      case 'lfo-tri': {
        const phase = (time * speed) % 1;
        return phase < 0.5 ? phase * 2 : 2 - phase * 2;
      }
      default: return 0;
    }
  }
}

export const modulationEngine = new ModulationEngine();

// Auto-start engine when audio becomes active (centralized, not per-component)
audioStore.subscribe(audio => {
  if (audio.isActive && !modulationEngine.running && parsedCache.length > 0) {
    modulationEngine.start();
  }
});
