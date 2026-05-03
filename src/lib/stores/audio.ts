// Audio Reactive Store
// Svelte store that bridges the AudioAnalyzer engine to reactive UI and VJ systems
// Provides real-time audio data, beat events, and BPM for the entire app

import { writable, derived, get } from 'svelte/store';
import { audioAnalyzer, type AudioAnalysis, type AudioBands, type BeatState } from '../audio/analyzer';

// Cache raw analysis for audio texture updates (textures need Float32Array data)
let _lastRawAnalysis: AudioAnalysis | null = null;
export function getLastRawAnalysis(): AudioAnalysis | null {
  return _lastRawAnalysis;
}

// Audio input source configuration
export type AudioInputType = 'none' | 'microphone' | 'file' | 'system';

/** Minimal shape we need from MediaDeviceInfo, kept separate so the store
 *  doesn't leak the full DOM type to consumers that don't want it. */
export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface AudioState {
  // Connection
  inputType: AudioInputType;
  isActive: boolean;
  error: string | null;

  // Device selection (for `microphone` input type)
  availableInputDevices: AudioInputDevice[];
  preferredInputDeviceId: string | null;  // null → system default

  // Real-time analysis data (updated every frame)
  bands: AudioBands;
  amplitude: number;
  peak: number;
  rms: number;

  // Beat
  beat: BeatState;

  // BPM
  bpm: number;
  bpmConfidence: number;
  beatPhase: number;

  // Spectral centroid (0-1, brightness/timbre)
  spectralCentroid: number;

  // Manual BPM override (tap tempo)
  manualBPM: number | null;  // null = use auto-detected
  tapTimes: number[];        // timestamps for tap tempo

  // Settings
  sensitivity: number;   // 0-2 multiplier for all bands
  smoothing: number;      // 0-1 smoothing factor
}

const PREFERRED_INPUT_KEY = 'ghostarcade.audio.preferredInputDeviceId';

function loadPreferredInputDeviceId(): string | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFERRED_INPUT_KEY) : null;
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function savePreferredInputDeviceId(id: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) localStorage.setItem(PREFERRED_INPUT_KEY, id);
    else localStorage.removeItem(PREFERRED_INPUT_KEY);
  } catch {}
}

function createDefaultState(): AudioState {
  return {
    inputType: 'none',
    isActive: false,
    error: null,
    availableInputDevices: [],
    preferredInputDeviceId: loadPreferredInputDeviceId(),
    bands: { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
    amplitude: 0,
    peak: 0,
    rms: 0,
    beat: { isBeat: false, beatIntensity: 0, timeSinceLastBeat: 0, beatCount: 0 },
    bpm: 0,
    bpmConfidence: 0,
    beatPhase: 0,
    spectralCentroid: 0,
    manualBPM: null,
    tapTimes: [],
    sensitivity: 1.0,
    smoothing: 0.3,
  };
}

function createAudioStore() {
  const { subscribe, update } = writable<AudioState>(createDefaultState());

  // Wire up the analyzer callback
  audioAnalyzer.setCallback((analysis: AudioAnalysis) => {
    _lastRawAnalysis = analysis; // Cache for audio texture manager
    update(state => {
      const sens = state.sensitivity;
      return {
        ...state,
        bands: {
          sub: Math.min(1, analysis.bands.sub * sens),
          bass: Math.min(1, analysis.bands.bass * sens),
          lowMid: Math.min(1, analysis.bands.lowMid * sens),
          mid: Math.min(1, analysis.bands.mid * sens),
          highMid: Math.min(1, analysis.bands.highMid * sens),
          high: Math.min(1, analysis.bands.high * sens),
        },
        amplitude: Math.min(1, analysis.amplitude * sens),
        peak: Math.min(1, analysis.peak * sens),
        rms: analysis.rms,
        beat: analysis.beat,
        bpm: state.manualBPM ?? analysis.bpm,
        bpmConfidence: state.manualBPM ? 1.0 : analysis.bpmConfidence,
        beatPhase: analysis.beatPhase,
        spectralCentroid: analysis.spectralCentroid,
      };
    });
  });

  return {
    subscribe,

    /** Start listening to microphone. Uses the store's preferredInputDeviceId
     *  if set; pass `null` to force the system default, or a specific id to
     *  override for this session only (doesn't touch the stored preference). */
    async startMicrophone(deviceIdOverride?: string | null) {
      const state = get({ subscribe });
      const deviceId = deviceIdOverride !== undefined ? deviceIdOverride : state.preferredInputDeviceId;
      try {
        update(s => ({ ...s, error: null, inputType: 'microphone' }));
        await audioAnalyzer.startMicrophone(deviceId);
        update(s => ({ ...s, isActive: true }));
        // Once we have a live stream the browser reveals real device labels
        // (labels are empty until the user has granted permission at least
        // once), so refresh the list so the picker UI can show names.
        void this.refreshInputDevices();
      } catch (err: any) {
        // If a specific device was requested and it's gone, fall back to the
        // system default rather than leaving the user stuck — clear the
        // stored preference so the next toggle doesn't repeat the failure.
        const msg = err?.message || 'Microphone access denied';
        if (deviceId && /OverconstrainedError|Requested device not found|NotFoundError/i.test(String(err))) {
          savePreferredInputDeviceId(null);
          update(s => ({ ...s, preferredInputDeviceId: null, error: `Input device not available (${msg}), falling back to default`, isActive: false, inputType: 'none' }));
          try {
            await audioAnalyzer.startMicrophone(null);
            update(s => ({ ...s, error: null, isActive: true, inputType: 'microphone' }));
            void this.refreshInputDevices();
            return;
          } catch (fallbackErr: any) {
            update(s => ({ ...s, error: fallbackErr?.message || msg, isActive: false, inputType: 'none' }));
            return;
          }
        }
        update(s => ({ ...s, error: msg, isActive: false, inputType: 'none' }));
      }
    },

    /** Enumerate audio input devices and update the store's device list.
     *  Labels require a live getUserMedia grant — before the user has clicked
     *  the mic button once, MediaDeviceInfo.label is an empty string. We
     *  substitute a generic placeholder so the picker still functions, and
     *  real names appear on the next refresh after the mic has been started. */
    async refreshInputDevices() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const all = await navigator.mediaDevices.enumerateDevices();
        const inputs: AudioInputDevice[] = all
          .filter(d => d.kind === 'audioinput')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `Input ${i + 1}`,
          }));
        update(s => ({ ...s, availableInputDevices: inputs }));
      } catch (err) {
        console.warn('[audio] enumerateDevices failed:', err);
      }
    },

    /** Select a preferred input device. Persists to localStorage and, if the
     *  mic is currently live, swaps streams in place. Pass null to return to
     *  the system default. */
    async setPreferredInputDevice(deviceId: string | null) {
      savePreferredInputDeviceId(deviceId);
      const wasActive = get({ subscribe }).inputType === 'microphone' && get({ subscribe }).isActive;
      update(s => ({ ...s, preferredInputDeviceId: deviceId }));
      if (wasActive) {
        await audioAnalyzer.stop();
        await this.startMicrophone(deviceId);
      }
    },

    /** Start analyzing a media element */
    async startMediaElement(element: HTMLAudioElement | HTMLVideoElement) {
      try {
        update(s => ({ ...s, error: null, inputType: 'file' }));
        await audioAnalyzer.startMediaElement(element);
        update(s => ({ ...s, isActive: true }));
      } catch (err: any) {
        update(s => ({ ...s, error: err.message || 'Failed to analyze media', isActive: false, inputType: 'none' }));
      }
    },

    /** Start analyzing system/desktop audio (DAW, Spotify, etc.) */
    async startSystemAudio() {
      try {
        update(s => ({ ...s, error: null, inputType: 'system' }));
        await audioAnalyzer.startSystemAudio();
        update(s => ({ ...s, isActive: true }));
      } catch (err: any) {
        update(s => ({ ...s, error: err.message || 'System audio capture failed', isActive: false, inputType: 'none' }));
      }
    },

    /** Stop audio analysis */
    async stop() {
      await audioAnalyzer.stop();
      update(s => ({
        ...createDefaultState(),
        sensitivity: s.sensitivity,
        smoothing: s.smoothing,
        manualBPM: s.manualBPM,
        // Keep the device list warm and the user's device preference
        // across start/stop cycles — toggling the mic off shouldn't
        // forget which device they picked.
        availableInputDevices: s.availableInputDevices,
        preferredInputDeviceId: s.preferredInputDeviceId,
      }));
    },

    /** Tap tempo - call this on each tap */
    tapTempo() {
      const now = performance.now();
      update(state => {
        let taps = [...state.tapTimes, now];

        // Remove taps older than 3 seconds
        taps = taps.filter(t => now - t < 3000);

        if (taps.length < 2) {
          return { ...state, tapTimes: taps };
        }

        // Calculate average interval
        const intervals: number[] = [];
        for (let i = 1; i < taps.length; i++) {
          intervals.push(taps[i] - taps[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(60000 / avgInterval);

        // Clamp to reasonable range
        const clampedBPM = Math.max(30, Math.min(300, bpm));

        return {
          ...state,
          tapTimes: taps,
          manualBPM: clampedBPM,
          bpm: clampedBPM,
          bpmConfidence: 1.0,
        };
      });
    },

    /** Clear manual BPM (return to auto-detection) */
    clearManualBPM() {
      update(s => ({ ...s, manualBPM: null, tapTimes: [] }));
    },

    /** Set manual BPM directly */
    setManualBPM(bpm: number) {
      update(s => ({ ...s, manualBPM: Math.max(30, Math.min(300, bpm)), bpm: Math.max(30, Math.min(300, bpm)), bpmConfidence: 1.0 }));
    },

    /** Set sensitivity multiplier */
    setSensitivity(value: number) {
      update(s => ({ ...s, sensitivity: Math.max(0, Math.min(3, value)) }));
    },

    /** Set smoothing */
    setSmoothing(value: number) {
      audioAnalyzer.setSmoothing(value);
      update(s => ({ ...s, smoothing: value }));
    },

    /** Get current state snapshot */
    getState(): AudioState {
      return get({ subscribe });
    },

    /**
     * Get a MediaStream containing the current audio output for recording.
     * Returns { stream, cleanup } or null if no audio source is active.
     * Caller MUST call cleanup() when done recording.
     */
    getAudioStream(): { stream: MediaStream; cleanup: () => void } | null {
      return audioAnalyzer.getAudioStream();
    },
  };
}

export const audioStore = createAudioStore();

// Derived: is a beat happening right now?
export const isBeat = derived(audioStore, $a => $a.beat.isBeat);

// Derived: current BPM (manual or auto)
export const currentBPM = derived(audioStore, $a => $a.bpm);

// Derived: beat phase (0-1 smooth ramp between beats)
export const beatPhase = derived(audioStore, $a => $a.beatPhase);

// Derived: frequency bands
export const audioBands = derived(audioStore, $a => $a.bands);
