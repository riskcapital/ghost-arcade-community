// MIDI Manager - Web MIDI API wrapper with device detection and hot-plug
import { midiStore } from './midiStore';
import { midiRouter } from './midiRouter';
import type { MidiDevice, MidiMessageType } from './midiTypes';
import { get } from 'svelte/store';

class MidiManager {
  private access: MIDIAccess | null = null;
  private activeInput: MIDIInput | null = null;
  private boundMessageHandler = this.handleMessage.bind(this);

  // MIDI CC sweeps / aftertouch / pitch-bend can emit 500+ msg/sec. The
  // `lastMessage` field is purely cosmetic (shown in the MIDI Learn overlay),
  // but every call to `setLastMessage` fires full Svelte reactivity on every
  // `$midiStore` subscriber. Throttle to ~30 Hz so mod-wheel sweeps stop
  // re-rendering the panel on every data point. Learn-mode itself is already
  // driven by `completeLearn`, not `lastMessage`, so there's no learn regression.
  private _lastMsgTs = 0;
  private static _LAST_MSG_MIN_INTERVAL_MS = 33;

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn('[MIDI] Web MIDI API not available');
      midiStore.setAvailable(false);
      return false;
    }
    try {
      // Workaround for an Electron 33.x bug on macOS: the FIRST renderer call to
      // requestMIDIAccess() in a packaged build hangs forever — the main-process
      // permission handler grants the request via callback(true), but Chromium
      // never observes the grant and the returned Promise never settles. A
      // subsequent call resolves immediately because the permission is then
      // cached. So we issue the first call, and if it doesn't resolve in 1.5s,
      // fire a second call and await whichever wins. The first hung promise
      // becomes a harmless dangling reference.
      this.access = await this.requestMIDIAccessWithRetry();
      midiStore.setAvailable(true);
      this.refreshDevices();
      this.access.onstatechange = () => this.refreshDevices();
      console.log('[MIDI] Initialized successfully');
      return true;
    } catch (err) {
      console.error('[MIDI] Failed to get MIDI access:', err);
      midiStore.setAvailable(false);
      return false;
    }
  }

  private requestMIDIAccessWithRetry(): Promise<MIDIAccess> {
    const first = navigator.requestMIDIAccess({ sysex: false });
    return Promise.race([
      first,
      new Promise<MIDIAccess>((resolve, reject) => {
        setTimeout(() => {
          navigator.requestMIDIAccess({ sysex: false }).then(resolve, reject);
        }, 1500);
      }),
    ]);
  }

  private refreshDevices() {
    if (!this.access) return;
    const devices: MidiDevice[] = [];
    this.access.inputs.forEach((input) => {
      devices.push({
        id: input.id,
        name: input.name || 'Unknown Device',
        manufacturer: input.manufacturer || 'Unknown',
        state: input.state as 'connected' | 'disconnected',
      });
    });
    midiStore.setDevices(devices);

    const state = get(midiStore);

    // If selected device disconnected, detach listener
    if (state.selectedDeviceId) {
      const dev = devices.find(d => d.id === state.selectedDeviceId);
      if (!dev || dev.state === 'disconnected') {
        this.detachInput();
      } else if (!this.activeInput || this.activeInput.id !== state.selectedDeviceId) {
        // Device reconnected — reattach
        this.attachInput(state.selectedDeviceId);
      }
    }

    // Auto-select first device if none selected (or try remembered device)
    if (!state.selectedDeviceId || !devices.find(d => d.id === state.selectedDeviceId && d.state === 'connected')) {
      const firstConnected = devices.find(d => d.state === 'connected');
      if (firstConnected) {
        this.selectDevice(firstConnected.id);
      }
    }
  }

  selectDevice(deviceId: string) {
    this.detachInput();
    midiStore.selectDevice(deviceId);
    this.attachInput(deviceId);
  }

  private attachInput(deviceId: string) {
    if (!this.access) return;
    const input = this.access.inputs.get(deviceId);
    if (input) {
      input.onmidimessage = this.boundMessageHandler;
      this.activeInput = input;
      console.log(`[MIDI] Attached to: ${input.name}`);
    }
  }

  private detachInput() {
    if (this.activeInput) {
      this.activeInput.onmidimessage = null;
      this.activeInput = null;
    }
  }

  private handleMessage(event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length < 2) return;

    const status = data[0];
    const channel = status & 0x0F;
    const msgType = status & 0xF0;

    let type: MidiMessageType;
    let number: number;
    let value: number;

    switch (msgType) {
      case 0xB0: // Control Change
        type = 'cc';
        number = data[1];
        value = data[2];
        break;
      case 0x90: // Note On
        type = 'note';
        number = data[1];
        value = data[2]; // velocity, 0 = note off
        break;
      case 0x80: // Note Off
        type = 'note';
        number = data[1];
        value = 0;
        break;
      case 0xE0: // Pitch Bend
        type = 'pitchbend';
        number = 0;
        value = (data[2] << 7) | data[1]; // 14-bit
        break;
      default:
        return; // Ignore sysex, timing, active sensing, etc.
    }

    // Update last message for display (throttled — see field docs above)
    const nowMs = performance.now();
    if (nowMs - this._lastMsgTs >= MidiManager._LAST_MSG_MIN_INTERVAL_MS) {
      this._lastMsgTs = nowMs;
      midiStore.setLastMessage({ channel, type, number, value });
    }

    // Check if we're in learn mode
    const state = get(midiStore);
    if (state.learn.active && state.learn.targetPath) {
      // For note messages, only learn on Note On (velocity > 0)
      if (type === 'note' && value === 0) return;
      midiStore.completeLearn(channel, type, number);
      return;
    }

    // Route to parameter updates (only when NOT in edit mode to avoid unintended changes while mapping)
    if (!state.editMode) {
      midiRouter.routeMessage(channel, type, number, value);
    }
  }

  destroy() {
    this.detachInput();
    if (this.access) {
      this.access.onstatechange = null;
    }
  }
}

export const midiManager = new MidiManager();
