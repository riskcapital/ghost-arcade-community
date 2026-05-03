/**
 * Ghost Arcade Community — keyframeTimeline stub.
 *
 * The Pro version has a full keyframe-animation timeline (record/playback,
 * easing curves, per-param tracks, auto-discovery). OSS removes the UI but
 * keeps this no-op store so consumers (layers.ts, vjClipLauncher.ts, the
 * preview Canvas) still compile.
 *
 * Every method is a no-op that returns sensible defaults. .gha projects
 * created in the Pro version that contain `keyframeTimelines` data will
 * round-trip safely — `importAll()` accepts and ignores it, `exportAll()`
 * returns an empty object so saved projects don't carry phantom keyframe
 * state from a previous session.
 */

import { readable, type Readable } from 'svelte/store';

interface KfConfig {
  autoRecord: boolean;
  loop: boolean;
  durationSec: number;
  isPlaying: boolean;
  currentTime: number;
}

interface KeyframeTimelineState {
  isOpen: boolean;
  isRecording: boolean;
  isPlaying: boolean;
  selectedKeyframe: null;
  tracks: Record<string, never>;
  // Pro version's animation engine reads these per-frame to override
  // tweened param values onto layers. OSS keeps the keys present (empty)
  // so Canvas.svelte's `if (kfState.config.someFlag)` reads return falsy
  // and the override path stays dormant.
  config: KfConfig;
  activeOverrides: Record<string, never>;
}

const _state: KeyframeTimelineState = {
  isOpen: false,
  isRecording: false,
  isPlaying: false,
  selectedKeyframe: null,
  tracks: {},
  config: { autoRecord: false, loop: false, durationSec: 8, isPlaying: false, currentTime: 0 },
  activeOverrides: {},
};

// Readable store form for `$keyframeTimeline` subscribers.
const _store: Readable<KeyframeTimelineState> = readable(_state);

export const keyframeTimeline = {
  // Subscription surface (Svelte store contract).
  subscribe: _store.subscribe,

  // ── No-op methods used by layers.ts / vjClipLauncher.ts / Canvas.svelte ──
  setOpen(_open: boolean) { /* no-op */ },
  toggle() { /* no-op */ },
  startRecording() { /* no-op */ },
  stopRecording() { /* no-op */ },
  startPlayback() { /* no-op */ },
  stopPlayback() { /* no-op */ },
  // play / seek used by vjClipLauncher when triggering clips with embedded
  // animation timelines. OSS skips the animation playback entirely.
  play() { /* no-op */ },
  pause() { /* no-op */ },
  seek(_t: number) { /* no-op */ },
  autoRecord(
    _layerId: string,
    _trackKey: string,
    _value: unknown,
    _paramName?: string,
    _kind?: 'number' | 'boolean',
  ) { /* no-op */ },
  exportAll(): Record<string, never> { return {}; },
  importAll(_data: unknown) { /* accept and ignore */ },
  reset() { /* no-op */ },
  clearLayer(_layerId: string) { /* no-op */ },
};
