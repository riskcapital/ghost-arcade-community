// Audio Analyzer Engine
// WebAudio API-based real-time audio analysis with FFT, beat detection, and BPM estimation
// Designed for VJ performance: provides frequency bands, amplitude, beat triggers, and BPM

export interface AudioBands {
  sub: number;      // 20-60 Hz (sub bass)
  bass: number;     // 60-250 Hz (bass / kick)
  lowMid: number;   // 250-500 Hz (low mids)
  mid: number;      // 500-2000 Hz (mids / vocals)
  highMid: number;  // 2000-4000 Hz (high mids / presence)
  high: number;     // 4000-20000 Hz (highs / cymbals)
}

export interface BeatState {
  isBeat: boolean;         // True on the frame a beat is detected
  beatIntensity: number;   // 0-1 strength of the current beat
  timeSinceLastBeat: number; // ms since last beat
  beatCount: number;       // Total beats detected
}

export interface AudioAnalysis {
  // Raw data
  fftData: Float32Array<ArrayBuffer>;        // Full FFT frequency data (dB values)
  waveformData: Float32Array<ArrayBuffer>;   // Time-domain waveform

  // Frequency bands (normalized 0-1)
  bands: AudioBands;

  // Overall levels
  amplitude: number;    // 0-1 overall volume level
  peak: number;         // 0-1 peak level with slower decay
  rms: number;          // Root mean square energy

  // Beat detection
  beat: BeatState;

  // BPM
  bpm: number;          // Estimated BPM (0 if not enough data)
  bpmConfidence: number; // 0-1 confidence in BPM estimate

  // Phase (0-1 cycle through each beat, useful for smooth animations)
  beatPhase: number;

  // Spectral centroid (0-1 normalized, indicates brightness/timbre of sound)
  spectralCentroid: number;
}

export type AudioSourceType = 'microphone' | 'system' | 'file';

// Beat detection config
const BEAT_THRESHOLD = 1.4;       // Energy must be this many times the average
const BEAT_DECAY = 0.98;          // How fast beat intensity decays
const BEAT_MIN_INTERVAL = 200;    // Min ms between beats (300 BPM max)
const BEAT_ENERGY_HISTORY = 43;   // ~1 second at 43 fps analysis rate

// BPM detection config
const BPM_HISTORY_SIZE = 16;      // Number of beat intervals to average
const BPM_MIN = 60;
const BPM_MAX = 200;

export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private stream: MediaStream | null = null;

  // Track the last-used source type so hotplug recovery can re-attach correctly.
  // `ondevicechange` fires when the user plugs/unplugs audio hardware (Bluetooth
  // headphones, USB mic, etc.). Without recovery, the AudioContext stays bound
  // to the dead device, the analyser flatlines, and BPM silently drifts to 0 —
  // a VJ's beat sync goes dead mid-set. We capture the source type so we can
  // re-run startMicrophone() / startSystemAudio() with the same intent.
  private lastSourceType: 'microphone' | 'system' | 'mediaElement' | null = null;
  private lastMediaElement: HTMLAudioElement | HTMLVideoElement | null = null;
  private lastMicDeviceId: string | null = null;
  private deviceChangeHandler: (() => void) | null = null;
  private ctxStateHandler: (() => void) | null = null;

  // FFT buffers
  private fftSize = 2048;
  private fftData: Float32Array<ArrayBuffer> = new Float32Array(0);
  private waveformData: Float32Array<ArrayBuffer> = new Float32Array(0);

  // Beat detection state
  private energyHistory: number[] = [];
  private lastBeatTime = 0;
  private beatIntensity = 0;
  private beatCount = 0;

  // BPM detection
  private beatTimes: number[] = [];
  private estimatedBPM = 0;
  private bpmConfidence = 0;

  // Smoothing
  private smoothedBands: AudioBands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 };
  private smoothedAmplitude = 0;
  private peakLevel = 0;

  // Animation frame
  private animFrameId: number | null = null;
  private isRunning = false;

  // Callback for each analysis frame
  private onAnalysis: ((analysis: AudioAnalysis) => void) | null = null;

  // Smoothing factor (0 = no smoothing, 1 = frozen)
  private smoothing = 0.3;

  constructor() {}

  /**
   * Start analyzing audio from microphone input. When `deviceId` is passed,
   * requests that specific input device (e.g. BlackHole for DAW routing,
   * a USB mic, a Bluetooth headset); omit to let the browser pick the
   * system default. The constraint uses `exact` so the browser does not
   * silently fall back to the default when the requested device is gone
   * — we'd rather see the error and surface it in the UI.
   */
  async startMicrophone(deviceId?: string | null): Promise<void> {
    await this.stop();

    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      this.audioContext = new AudioContext();
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.fftSize;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.sourceNode.connect(this.analyserNode);

      // Allocate buffers
      const bufferLength = this.analyserNode.frequencyBinCount;
      this.fftData = new Float32Array(bufferLength);
      this.waveformData = new Float32Array(bufferLength);

      this.resetState();
      this.isRunning = true;
      this.lastSourceType = 'microphone';
      this.lastMicDeviceId = deviceId ?? null;
      this._installHotplugHandlers();
      this.tick();
    } catch (err) {
      console.error('Failed to start microphone:', err);
      throw err;
    }
  }

  /** Start analyzing audio from a media element (e.g., <audio> tag) */
  async startMediaElement(element: HTMLAudioElement | HTMLVideoElement): Promise<void> {
    await this.stop();

    try {
      this.audioContext = new AudioContext();
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.fftSize;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;

      this.sourceNode = this.audioContext.createMediaElementSource(element);
      this.sourceNode.connect(this.analyserNode);
      // Also connect to destination so audio still plays
      this.analyserNode.connect(this.audioContext.destination);

      const bufferLength = this.analyserNode.frequencyBinCount;
      this.fftData = new Float32Array(bufferLength);
      this.waveformData = new Float32Array(bufferLength);

      this.resetState();
      this.isRunning = true;
      this.lastSourceType = 'mediaElement';
      this.lastMediaElement = element;
      this._installHotplugHandlers();
      this.tick();
    } catch (err) {
      console.error('Failed to start media element analysis:', err);
      throw err;
    }
  }

  /** Start analyzing system/desktop audio via screen capture (for DAW, Spotify, etc.) */
  async startSystemAudio(): Promise<void> {
    await this.stop();

    try {
      // getDisplayMedia captures system audio - user picks a tab/window/screen
      // We only need the audio track; video is minimal (required by the API)
      this.stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Verify audio track exists
      const audioTracks = this.stream!.getAudioTracks();
      if (audioTracks.length === 0) {
        this.stream!.getTracks().forEach(t => t.stop());
        this.stream = null;
        throw new Error('No audio track available. Select a source with audio output.');
      }

      // Stop the video track - we only need audio
      this.stream!.getVideoTracks().forEach(t => t.stop());

      this.audioContext = new AudioContext();
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.fftSize;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream!);
      this.sourceNode.connect(this.analyserNode);
      // Do NOT connect to destination - avoid feedback loop with system audio

      const bufferLength = this.analyserNode.frequencyBinCount;
      this.fftData = new Float32Array(bufferLength);
      this.waveformData = new Float32Array(bufferLength);

      this.resetState();
      this.isRunning = true;
      this.lastSourceType = 'system';
      this._installHotplugHandlers();
      this.tick();
    } catch (err) {
      console.error('Failed to start system audio:', err);
      throw err;
    }
  }

  /**
   * Install device-change + audio-context-state handlers so a Bluetooth
   * headphone swap, USB audio unplug, or system-wide sample-rate change
   * doesn't leave the analyser flatlined. When the OS/browser tells us
   * something changed, we rebuild the pipeline from scratch using the
   * source type that was last requested.
   */
  private _installHotplugHandlers(): void {
    this._uninstallHotplugHandlers();

    this.deviceChangeHandler = () => {
      console.warn('[AudioAnalyzer] Audio device changed — re-initialising analyser');
      this._recoverAudioPipeline();
    };
    try {
      navigator.mediaDevices?.addEventListener?.('devicechange', this.deviceChangeHandler);
    } catch {}

    // AudioContext can auto-suspend on device loss or user-gesture timeout.
    // Try to resume; if that fails, do a full rebuild.
    if (this.audioContext) {
      this.ctxStateHandler = () => {
        const ctx = this.audioContext;
        if (!ctx) return;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => this._recoverAudioPipeline());
        } else if (ctx.state === 'closed') {
          this._recoverAudioPipeline();
        }
      };
      this.audioContext.addEventListener('statechange', this.ctxStateHandler);
    }
  }
  private _uninstallHotplugHandlers(): void {
    if (this.deviceChangeHandler) {
      try { navigator.mediaDevices?.removeEventListener?.('devicechange', this.deviceChangeHandler); } catch {}
      this.deviceChangeHandler = null;
    }
    if (this.ctxStateHandler && this.audioContext) {
      try { this.audioContext.removeEventListener('statechange', this.ctxStateHandler); } catch {}
    }
    this.ctxStateHandler = null;
  }
  private _recoveryInFlight = false;
  private async _recoverAudioPipeline(): Promise<void> {
    if (this._recoveryInFlight) return;
    this._recoveryInFlight = true;
    const src = this.lastSourceType;
    const el = this.lastMediaElement;
    const micId = this.lastMicDeviceId;
    try {
      await this.stop();
      // Brief delay gives the OS time to finish its device transition.
      await new Promise(r => setTimeout(r, 300));
      if (src === 'microphone') await this.startMicrophone(micId);
      else if (src === 'system') await this.startSystemAudio();
      else if (src === 'mediaElement' && el) await this.startMediaElement(el);
    } catch (err) {
      console.error('[AudioAnalyzer] Audio pipeline recovery failed:', err);
    } finally {
      this._recoveryInFlight = false;
    }
  }

  /** Stop all audio analysis and release resources */
  async stop(): Promise<void> {
    this.isRunning = false;
    this._uninstallHotplugHandlers();

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.analyserNode = null;
  }

  /** Set the analysis callback */
  setCallback(cb: (analysis: AudioAnalysis) => void): void {
    this.onAnalysis = cb;
  }

  /** Set smoothing factor (0-1) */
  setSmoothing(value: number): void {
    this.smoothing = Math.max(0, Math.min(1, value));
  }

  /** Check if analyzer is currently running */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get a MediaStream containing the current audio for recording.
   * Returns { stream, cleanup } where cleanup() must be called when done.
   * Returns null if no audio source is active.
   */
  getAudioStream(): { stream: MediaStream; cleanup: () => void } | null {
    if (!this.audioContext || !this.analyserNode || !this.isRunning) return null;

    // For mic/system audio: raw stream has audio tracks we can use directly
    if (this.stream) {
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        // Clone tracks so recording doesn't interfere with analysis
        const clonedStream = new MediaStream(audioTracks.map(t => t.clone()));
        return {
          stream: clonedStream,
          cleanup: () => {
            clonedStream.getTracks().forEach(t => t.stop());
          },
        };
      }
    }

    // For media element source: create a destination node to capture the audio output
    if (this.sourceNode && this.audioContext.state === 'running') {
      try {
        const dest = this.audioContext.createMediaStreamDestination();
        // Connect the source through to the destination for capture
        this.analyserNode.connect(dest);
        return {
          stream: dest.stream,
          cleanup: () => {
            try {
              this.analyserNode?.disconnect(dest);
            } catch (_) {
              // May already be disconnected
            }
          },
        };
      } catch (err) {
        console.warn('[AudioAnalyzer] Failed to create audio capture stream:', err);
        return null;
      }
    }

    return null;
  }

  private resetState(): void {
    this.energyHistory = [];
    this.lastBeatTime = 0;
    this.beatIntensity = 0;
    this.beatCount = 0;
    this.beatTimes = [];
    this.estimatedBPM = 0;
    this.bpmConfidence = 0;
    this.smoothedBands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 };
    this.smoothedAmplitude = 0;
    this.peakLevel = 0;
  }

  private tick = (): void => {
    if (!this.isRunning || !this.analyserNode) return;

    // Get frequency and time-domain data
    this.analyserNode.getFloatFrequencyData(this.fftData);
    this.analyserNode.getFloatTimeDomainData(this.waveformData);

    const analysis = this.analyze();

    if (this.onAnalysis) {
      this.onAnalysis(analysis);
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  private analyze(): AudioAnalysis {
    const now = performance.now();
    const nyquist = this.audioContext!.sampleRate / 2;
    const binCount = this.fftData.length;
    const binWidth = nyquist / binCount;

    // Extract frequency bands
    const rawBands = this.extractBands(binWidth, binCount);

    // Smooth bands
    const s = this.smoothing;
    this.smoothedBands = {
      sub:     this.smoothedBands.sub * s + rawBands.sub * (1 - s),
      bass:    this.smoothedBands.bass * s + rawBands.bass * (1 - s),
      lowMid:  this.smoothedBands.lowMid * s + rawBands.lowMid * (1 - s),
      mid:     this.smoothedBands.mid * s + rawBands.mid * (1 - s),
      highMid: this.smoothedBands.highMid * s + rawBands.highMid * (1 - s),
      high:    this.smoothedBands.high * s + rawBands.high * (1 - s),
    };

    // Calculate amplitude (RMS of waveform)
    let sumSq = 0;
    for (let i = 0; i < this.waveformData.length; i++) {
      sumSq += this.waveformData[i] * this.waveformData[i];
    }
    const rms = Math.sqrt(sumSq / this.waveformData.length);

    // Normalize amplitude (waveform is -1 to 1, rms of 0.5 is quite loud)
    const rawAmplitude = Math.min(1, rms * 2);
    this.smoothedAmplitude = this.smoothedAmplitude * s + rawAmplitude * (1 - s);

    // Peak with slow decay
    if (rawAmplitude > this.peakLevel) {
      this.peakLevel = rawAmplitude;
    } else {
      this.peakLevel *= 0.995;
    }

    // Beat detection using bass energy
    const beatEnergy = rawBands.bass * 0.7 + rawBands.sub * 0.3;
    this.energyHistory.push(beatEnergy);
    if (this.energyHistory.length > BEAT_ENERGY_HISTORY) {
      this.energyHistory.shift();
    }

    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const timeSinceLastBeat = now - this.lastBeatTime;

    let isBeat = false;
    if (
      beatEnergy > avgEnergy * BEAT_THRESHOLD &&
      beatEnergy > 0.05 &&
      timeSinceLastBeat > BEAT_MIN_INTERVAL &&
      this.energyHistory.length >= 8
    ) {
      isBeat = true;
      this.beatIntensity = Math.min(1, beatEnergy);
      this.lastBeatTime = now;
      this.beatCount++;

      // Record beat time for BPM calculation
      this.beatTimes.push(now);
      if (this.beatTimes.length > BPM_HISTORY_SIZE + 1) {
        this.beatTimes.shift();
      }

      this.updateBPM();
    } else {
      this.beatIntensity *= BEAT_DECAY;
    }

    // Beat phase (0-1 cycle through the beat interval)
    let beatPhase = 0;
    if (this.estimatedBPM > 0) {
      const beatInterval = 60000 / this.estimatedBPM;
      beatPhase = (timeSinceLastBeat % beatInterval) / beatInterval;
    }

    // Spectral centroid: weighted average of frequency bins normalized to 0-1
    let weightedSum = 0;
    let magnitudeSum = 0;
    for (let i = 0; i < this.fftData.length; i++) {
      const magnitude = Math.max(0, (this.fftData[i] + 90) / 80);
      weightedSum += i * magnitude;
      magnitudeSum += magnitude;
    }
    const spectralCentroid = magnitudeSum > 0
      ? (weightedSum / magnitudeSum) / this.fftData.length
      : 0;

    return {
      fftData: this.fftData,
      waveformData: this.waveformData,
      bands: { ...this.smoothedBands },
      amplitude: this.smoothedAmplitude,
      peak: this.peakLevel,
      rms,
      beat: {
        isBeat,
        beatIntensity: this.beatIntensity,
        timeSinceLastBeat,
        beatCount: this.beatCount,
      },
      bpm: this.estimatedBPM,
      bpmConfidence: this.bpmConfidence,
      beatPhase,
      spectralCentroid,
    };
  }

  private extractBands(binWidth: number, binCount: number): AudioBands {
    // Map frequency ranges to bin indices
    const getBinRange = (lowHz: number, highHz: number): [number, number] => {
      const lowBin = Math.max(0, Math.floor(lowHz / binWidth));
      const highBin = Math.min(binCount - 1, Math.ceil(highHz / binWidth));
      return [lowBin, highBin];
    };

    // Average dB in a bin range, then normalize to 0-1
    const getEnergy = (lowHz: number, highHz: number): number => {
      const [lo, hi] = getBinRange(lowHz, highHz);
      if (lo >= hi) return 0;

      let sum = 0;
      for (let i = lo; i <= hi; i++) {
        // fftData is in dB, typically -90 to -10
        // Normalize: -90 -> 0, -10 -> 1
        const normalized = (this.fftData[i] + 90) / 80;
        sum += Math.max(0, Math.min(1, normalized));
      }
      return sum / (hi - lo + 1);
    };

    return {
      sub:     getEnergy(20, 60),
      bass:    getEnergy(60, 250),
      lowMid:  getEnergy(250, 500),
      mid:     getEnergy(500, 2000),
      highMid: getEnergy(2000, 4000),
      high:    getEnergy(4000, 20000),
    };
  }

  private updateBPM(): void {
    if (this.beatTimes.length < 4) {
      this.estimatedBPM = 0;
      this.bpmConfidence = 0;
      return;
    }

    // Calculate intervals between consecutive beats
    const intervals: number[] = [];
    for (let i = 1; i < this.beatTimes.length; i++) {
      intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
    }

    // Filter out outliers (intervals that would give BPM outside range)
    const minInterval = 60000 / BPM_MAX; // 300ms for 200 BPM
    const maxInterval = 60000 / BPM_MIN; // 1000ms for 60 BPM
    const validIntervals = intervals.filter(i => i >= minInterval && i <= maxInterval);

    if (validIntervals.length < 3) {
      this.bpmConfidence = Math.max(0, this.bpmConfidence - 0.05);
      return;
    }

    // Median interval (more robust than mean)
    const sorted = [...validIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const rawBPM = 60000 / median;

    // Calculate confidence based on consistency
    const deviations = validIntervals.map(i => Math.abs(i - median) / median);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    const consistency = Math.max(0, 1 - avgDeviation * 4); // 25% deviation = 0 confidence

    this.bpmConfidence = consistency * Math.min(1, validIntervals.length / 8);

    // Smooth BPM changes
    if (this.estimatedBPM === 0 || Math.abs(rawBPM - this.estimatedBPM) > 10) {
      this.estimatedBPM = Math.round(rawBPM);
    } else {
      this.estimatedBPM = Math.round(this.estimatedBPM * 0.8 + rawBPM * 0.2);
    }
  }
}

// Singleton instance
export const audioAnalyzer = new AudioAnalyzer();
