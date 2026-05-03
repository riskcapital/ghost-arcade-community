// MIDI Router - Routes MIDI messages to correct store update functions
// Uses a prebuilt lookup table for O(1) dispatch with 16ms throttle per path
import { get } from 'svelte/store';
import { midiStore } from './midiStore';
import { project, selectedLayer } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { synthVisionStore } from '../stores/synthVision';
import type { SVParamKey } from '../stores/synthVision';
import type { MidiMapping, MidiMessageType } from './midiTypes';
import type { BlendMode } from '../types';

// Prebuilt lookup: "cc:74" -> [MidiMapping, ...]
// Rebuilt automatically when mappings change
let lookupMap = new Map<string, MidiMapping[]>();
let lastMappingsRef: MidiMapping[] = [];

function rebuildLookup(mappings: MidiMapping[]) {
  lookupMap.clear();
  for (const m of mappings) {
    const key = `${m.type}:${m.number}`;
    const existing = lookupMap.get(key);
    if (existing) {
      existing.push(m);
    } else {
      lookupMap.set(key, [m]);
    }
  }
  lastMappingsRef = mappings;
}

// Subscribe to store changes to rebuild lookup
midiStore.subscribe(state => {
  if (state.mappings !== lastMappingsRef) {
    rebuildLookup(state.mappings);
  }
});

// Throttle: track last update time per path to avoid flooding stores
const lastUpdateTime = new Map<string, number>();
const THROTTLE_MS = 16; // ~60fps max update rate

// User interaction suppression: when user is manually dragging a slider,
// suppress MIDI updates for that path to prevent fighting/jumping
const userInteractingPaths = new Map<string, number>(); // path -> suppress-until timestamp
const USER_INTERACT_SUPPRESS_MS = 250;

/** Call this when user starts interacting with a MIDI-mappable control */
export function markUserInteracting(path: string, durationMs = USER_INTERACT_SUPPRESS_MS) {
  userInteractingPaths.set(path, performance.now() + durationMs);
}

class MidiRouter {
  routeMessage(channel: number, type: MidiMessageType, number: number, value: number) {
    const key = `${type}:${number}`;
    const mappings = lookupMap.get(key);
    if (!mappings || mappings.length === 0) return;

    const now = performance.now();

    for (const mapping of mappings) {
      // Channel filter
      if (mapping.channel !== -1 && mapping.channel !== channel) continue;

      // Throttle check
      const lastTime = lastUpdateTime.get(mapping.path) || 0;
      if (now - lastTime < THROTTLE_MS) continue;
      lastUpdateTime.set(mapping.path, now);

      // User interaction suppression — skip if user is manually dragging this control
      const suppressUntil = userInteractingPaths.get(mapping.path) || 0;
      if (now < suppressUntil) continue;

      // Convert MIDI value to target range
      const targetValue = this.convertValue(value, mapping, type);

      // Dispatch to correct store
      this.dispatch(mapping.path, targetValue, mapping);
    }
  }

  private convertValue(rawValue: number, mapping: MidiMapping, type: MidiMessageType): number {
    if (mapping.mode === 'toggle') {
      // For note: on/off. For CC: > 64 = on, <= 64 = off
      if (type === 'note') return rawValue > 0 ? 1 : 0;
      return rawValue > 64 ? 1 : 0;
    }

    if (mapping.mode === 'relative') {
      // Relative encoders: 65-127 = increment, 1-63 = decrement
      return rawValue >= 64 ? rawValue - 128 : rawValue;
    }

    // Absolute mode
    let normalized: number;
    if (type === 'pitchbend') {
      normalized = rawValue / 16383; // 14-bit
    } else {
      normalized = rawValue / 127; // 7-bit CC
    }

    // Map to target range
    let result = mapping.min + normalized * (mapping.max - mapping.min);

    // Quantize to step if specified
    if (mapping.step > 0) {
      result = Math.round(result / mapping.step) * mapping.step;
    }

    // Clamp to range
    result = Math.max(mapping.min, Math.min(mapping.max, result));

    return result;
  }

  private dispatch(path: string, value: number, mapping: MidiMapping) {
    const parts = path.split(':');
    const scope = parts[0]; // 'map', 'vj', 'sv'

    try {
      switch (scope) {
        case 'map':
          this.dispatchMapping(parts, value, mapping);
          break;
        case 'vj':
          this.dispatchVJ(parts, value, mapping);
          break;
        case 'sv':
          this.dispatchPerformer(parts, value, mapping);
          break;
      }
    } catch (err) {
      console.warn(`[MIDI Router] Error dispatching to ${path}:`, err);
    }
  }

  private dispatchMapping(parts: string[], value: number, mapping: MidiMapping) {
    // parts: ['map', contentType, property]
    // contentType: 'splat', 'model3d', 'layer', 'preset'
    const contentType = parts[1];

    // Mapping preset switching: map:preset:<index>
    if (contentType === 'preset') {
      const presetIdx = parseInt(parts[2], 10);
      if (!isNaN(presetIdx) && value > 0) {
        window.dispatchEvent(new CustomEvent('midi-mapping-preset', { detail: { index: presetIdx } }));
      }
      return;
    }
    const property = parts.slice(2).join('.'); // supports nested like 'echo.count'
    const layer = get(selectedLayer);
    if (!layer) return;

    // Layer-level properties (opacity, etc.)
    if (contentType === 'layer') {
      if (mapping.mode === 'toggle') {
        const current = (layer as any)[property];
        project.updateLayer(layer.id, { [property]: !current });
      } else {
        project.updateLayer(layer.id, { [property]: value });
      }
      return;
    }

    // Handle toggle mode for content properties
    if (mapping.mode === 'toggle') {
      if (contentType === 'splat' && layer.splatContent) {
        const current = (layer.splatContent as any)[property];
        project.updateSplatContent(layer.id, { [property]: !current });
      } else if (contentType === 'model3d' && layer.model3dContent) {
        const current = (layer.model3dContent as any)[property];
        project.updateModel3DContent(layer.id, { [property]: !current });
      }
      return;
    }

    // Handle discrete values (dropdowns/selects)
    if (mapping.discreteValues && mapping.discreteValues.length > 0) {
      const index = Math.round(value);
      const discreteVal = mapping.discreteValues[Math.min(index, mapping.discreteValues.length - 1)];
      if (contentType === 'splat') {
        project.updateSplatContent(layer.id, { [property]: discreteVal });
      } else if (contentType === 'model3d') {
        project.updateModel3DContent(layer.id, { [property]: discreteVal });
      }
      return;
    }

    // Effect parameters: map:effect:<effectId>:<paramName>
    if (contentType === 'effect') {
      const effectId = parts[2];
      const paramName = parts[3];
      if (effectId && paramName) {
        project.updateEffectParams(layer.id, effectId, { [paramName]: value });
      }
      return;
    }

    // Continuous value
    if (contentType === 'splat') {
      project.updateSplatContent(layer.id, { [property]: value });
    } else if (contentType === 'model3d') {
      // Handle nested properties (echo.count, camera.distance, audio.scaleResponse, etc.)
      if (property.includes('.')) {
        const dotParts = property.split('.');
        const parent = dotParts[0];
        const child = dotParts[1];
        const currentParent = (layer.model3dContent as any)?.[parent] || {};
        project.updateModel3DContent(layer.id, { [parent]: { ...currentParent, [child]: value } } as any);
      } else {
        project.updateModel3DContent(layer.id, { [property]: value } as any);
      }
    }
  }

  private dispatchVJ(parts: string[], value: number, mapping: MidiMapping) {
    // parts: ['vj', layerIndex|'master', property, ...]
    const layerPart = parts[1];
    const property = parts[2];

    if (layerPart === 'master') {
      if (property === 'opacity') {
        vjClipLauncher.setMasterOpacity(value);
      }
      return;
    }

    // VJ Block switching: vj:block:<index>
    if (layerPart === 'block') {
      const blockIdx = parseInt(parts[2], 10);
      if (!isNaN(blockIdx) && value > 0) {
        const state = get(vjClipLauncher);
        if (blockIdx >= 0 && blockIdx < state.blocks.length) {
          vjClipLauncher.setActiveBlock(state.blocks[blockIdx].id);
        }
      }
      return;
    }

    // VJ Column triggering: vj:column:<index>
    if (layerPart === 'column') {
      const colIdx = parseInt(parts[2], 10);
      if (!isNaN(colIdx) && value > 0) {
        vjClipLauncher.triggerColumn(colIdx);
      }
      return;
    }

    // VJ Stage preset: vj:stage:<index>
    if (layerPart === 'stage') {
      const presetIdx = parseInt(parts[2], 10);
      if (!isNaN(presetIdx) && value > 0) {
        window.dispatchEvent(new CustomEvent('midi-stage-preset', { detail: { index: presetIdx } }));
      }
      return;
    }

    // VJ Stop all: vj:stopall
    if (layerPart === 'stopall') {
      if (value > 0) vjClipLauncher.stopAll();
      return;
    }

    // VJ Macros — component-local state, dispatch via DOM event
    if (layerPart === 'macro1' || layerPart === 'macro2') {
      const macroNum = layerPart === 'macro1' ? 1 : 2;
      window.dispatchEvent(new CustomEvent('midi-vj-macro', { detail: { macro: macroNum, value } }));
      return;
    }

    const layerIndex = parseInt(layerPart, 10);
    if (isNaN(layerIndex)) return;

    switch (property) {
      case 'opacity':
        vjClipLauncher.setLayerOpacity(layerIndex, value);
        break;
      case 'blend':
        if (mapping.discreteValues) {
          const idx = Math.round(value);
          const blendVal = mapping.discreteValues[Math.min(idx, mapping.discreteValues.length - 1)];
          vjClipLauncher.setLayerBlendMode(layerIndex, blendVal as BlendMode);
        }
        break;
      case 'solo':
        if (value > 0) vjClipLauncher.toggleLayerSolo(layerIndex);
        break;
      case 'mute':
        if (value > 0) vjClipLauncher.toggleLayerMute(layerIndex);
        break;
      case 'shader': {
        // parts: ['vj', '0', 'shader', 'speed']
        const shaderParam = parts[3];
        if (shaderParam) {
          vjClipLauncher.updateActiveClipShaderValue(layerIndex, shaderParam, value);
        }
        break;
      }
      case 'splat': {
        // parts: ['vj', '0', 'splat', 'pointSize']
        const splatProp = parts[3];
        if (splatProp) {
          vjClipLauncher.updateActiveClipSplatContent(layerIndex, { [splatProp]: value });
        }
        break;
      }
      case 'model3d': {
        const modelProp = parts[3];
        if (modelProp) {
          vjClipLauncher.updateActiveClipModel3DContent(layerIndex, { [modelProp]: value } as any);
        }
        break;
      }
      case 'trigger': {
        // parts: ['vj', '0', 'trigger', columnIndex]
        const colIdx = parseInt(parts[3], 10);
        if (!isNaN(colIdx) && value > 0) {
          vjClipLauncher.triggerClip(layerIndex, colIdx);
        }
        break;
      }
    }
  }

  private dispatchPerformer(parts: string[], value: number, mapping: MidiMapping) {
    // parts: ['sv', sub, ...]
    const sub = parts[1];

    switch (sub) {
      case 'xfade':
        synthVisionStore.setXfade(value);
        break;
      case 'param': {
        // parts: ['sv', 'param', 'chaos'] OR ['sv', 'param', 'shader', 'p1'] OR ['sv', 'param', 'world', 'height']
        const paramSub = parts[2];
        if (paramSub === 'shader' && parts[3]) {
          // Route to currently focused shader's param
          const svState = get(synthVisionStore);
          const shIdx = svState.layers[svState.focus].sh;
          synthVisionStore.setShaderParam(shIdx, parts[3], value);
        } else if (paramSub === 'world' && parts[3]) {
          // Route to currently focused world's param
          const svState = get(synthVisionStore);
          const wIdx = svState.layers[svState.focus].world;
          synthVisionStore.setWorldParam(wIdx, parts[3], value);
        } else {
          synthVisionStore.setParam(paramSub as SVParamKey, value);
        }
        break;
      }
      case 'shader': {
        // parts: ['sv', 'shader', '0', 'tunnelR']
        const shIdx = parseInt(parts[2], 10);
        if (!isNaN(shIdx) && parts[3]) {
          synthVisionStore.setShaderParam(shIdx, parts[3], value);
        }
        break;
      }
      case 'world': {
        // parts: ['sv', 'world', '3', 'height']
        const wIdx = parseInt(parts[2], 10);
        if (!isNaN(wIdx) && parts[3]) {
          synthVisionStore.setWorldParam(wIdx, parts[3], value);
        }
        break;
      }
      case 'clip':
        // Note trigger: fire clip at index
        if (value > 0) {
          synthVisionStore.fireClip(parseInt(parts[2], 10));
        }
        break;
      case 'bpm':
        synthVisionStore.setBpm(value);
        break;
      case 'camOpacity':
        synthVisionStore.setCamOpacity(value);
        break;
      case 'spaceFx':
        // Momentary trigger
        if (value > 0) synthVisionStore.triggerSpaceFx();
        break;
      case 'focus':
        // Toggle A/B focus
        if (value > 0) synthVisionStore.toggleFocus();
        break;
      case 'blackout':
        if (value > 0) synthVisionStore.doBlackout();
        break;
      case 'pump':
        if (value > 0) synthVisionStore.doPump();
        break;
      case 'drift':
        if (value > 0) synthVisionStore.toggleDrift();
        break;
      case 'isf': {
        // parts: ['sv', 'isf', 'inputName']
        const svState = get(synthVisionStore);
        const assignedLayer = svState.assignedLayer;
        if (assignedLayer !== null && parts[2]) {
          vjClipLauncher.updateActiveClipShaderValue(assignedLayer, parts[2], value);
        }
        break;
      }
      case 'fx': {
        // parts: ['sv', 'fx', 'effectType', 'paramName']
        const svState = get(synthVisionStore);
        const fxLayer = svState.assignedLayer;
        if (fxLayer !== null && parts[2] && parts[3]) {
          const effects = get(vjClipLauncher).layerStates[fxLayer]?.effects ?? [];
          const effect = effects.find((e: any) => e.type === parts[2]);
          if (effect) {
            vjClipLauncher.updateLayerEffectParams(fxLayer, effect.id, { [parts[3]]: value });
          }
        }
        break;
      }
    }
  }
}

export const midiRouter = new MidiRouter();
