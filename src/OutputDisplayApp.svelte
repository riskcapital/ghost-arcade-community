<script lang="ts">
  /**
   * OutputDisplayApp — receiver-side counterpart to outputPixelBroadcast.
   *
   * Mounted by main.ts when the output window loads with
   * `?mode=webrtc-display`. Responsibilities:
   *
   *   1. Open the `ghostarcade-output-pixels` BroadcastChannel the editor
   *      is listening on, exchange WebRTC signaling (offer / answer /
   *      ICE), and receive a MediaStream from `pc.ontrack`.
   *   2. Display the stream in a single full-screen `<video srcObject>`.
   *   3. Subscribe to `transform` messages from the editor and apply
   *      output rotation / brightness / contrast / fit-policy as CSS
   *      on the `<video>` element. (Gamma + crop stay TODO — gamma
   *      can't be expressed in pure CSS, crop needs a math pass we
   *      haven't written yet.)
   *
   * That's the entire renderer for this window. No state-sync, no
   * decoders, no Three.js. Single-renderer architecture: the editor
   * is the only source of pixels.
   *
   * Resilience:
   *   - 'ready' heartbeat every 2 s until `connected`, restarts on
   *     disconnected/failed. Survives editor restarts, flag toggles,
   *     race-on-mount when output is ready before editor is listening.
   *   - ICE candidates that arrive before setRemoteDescription resolves
   *     are queued and drained when the remote description is set.
   *     Without the queue, addIceCandidate throws and the candidate is
   *     lost (the catch in the legacy version dropped candidates
   *     silently — caused intermittent connection failures).
   *
   * `?stats=1` URL flag enables a small diagnostics overlay sampling
   * `RTCPeerConnection.getStats()` once per second + a per-frame FPS
   * counter via `requestVideoFrameCallback`. Used to verify the
   * success criteria the user asked for.
   *
   * Cross-platform: pure browser APIs. Same code runs on Windows + Mac.
   */
  import { onMount, onDestroy } from 'svelte';

  const SIGNAL_CHANNEL = 'ghostarcade-output-pixels';

  const urlParams = new URLSearchParams(window.location.search);
  const showStats = urlParams.get('stats') === '1';

  let videoEl: HTMLVideoElement;
  let pc: RTCPeerConnection | null = null;
  let channel: BroadcastChannel | null = null;
  let connected = false;
  let statusText = 'Waiting for editor stream…';
  let disposed = false;

  // ── Output transforms received over the signaling channel ──────────
  // The editor's outputPixelBroadcast pushes settings deltas as
  // `{type:'transform', from:'editor', payload:{rotation,brightness,contrast,fit}}`
  // whenever any of those settings change. We hold the latest snapshot
  // in module state and apply it to the `<video>` via reactive CSS.
  // Defaults match the legacy output renderer's "no transform" state
  // so the WebRTC view starts visually equivalent to before any settings
  // are flipped.
  let rotation = 0;          // degrees, 0 / 90 / 180 / 270
  let brightness = 1;        // 1 = identity
  let contrast = 1;          // 1 = identity
  let fit: 'contain' | 'cover' | 'fill' = 'cover';
  // CSS that materialises the above. Reactive on changes.
  $: videoTransform = `rotate(${rotation}deg)`;
  $: videoFilter = `brightness(${brightness}) contrast(${contrast})`;
  $: videoObjectFit = fit;

  // ── Reconnect heartbeat ────────────────────────────────────────────
  let readyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function startReadyHeartbeat() {
    if (readyHeartbeatTimer) clearInterval(readyHeartbeatTimer);
    // Send `ready` immediately, then every 2 s until `connected`
    // becomes true. Editor's outputPixelBroadcast handles repeated
    // `ready` idempotently — it only rebuilds the peer if there isn't
    // one or if the existing one is stale.
    const tick = () => {
      if (disposed || connected) return;
      if (channel) {
        channel.postMessage({ type: 'ready', from: 'output' });
      }
    };
    tick();
    readyHeartbeatTimer = setInterval(tick, 2000);
  }

  function stopReadyHeartbeat() {
    if (readyHeartbeatTimer) {
      clearInterval(readyHeartbeatTimer);
      readyHeartbeatTimer = null;
    }
  }

  // ── ICE candidate queue ────────────────────────────────────────────
  // RTCPeerConnection.addIceCandidate throws if called before
  // setRemoteDescription resolves. Queue any candidates that arrive
  // during that window and drain them once the remote description is
  // in place. Without this, occasional candidates get logged + dropped
  // and the peer connection stalls in 'checking' state until ICE-restart.
  const pendingIceCandidates: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;

  async function applyIceCandidate(candidate: RTCIceCandidateInit) {
    if (!pc) return;
    if (!remoteDescriptionSet) {
      pendingIceCandidates.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (e: any) {
      console.warn('[OutputDisplay] addIceCandidate failed:', e?.message ?? e);
    }
  }

  async function drainIceQueue() {
    if (!pc) return;
    while (pendingIceCandidates.length) {
      const c = pendingIceCandidates.shift();
      if (c) {
        try {
          await pc.addIceCandidate(c);
        } catch (e: any) {
          console.warn('[OutputDisplay] queued addIceCandidate failed:', e?.message ?? e);
        }
      }
    }
  }

  // ── Stats overlay (only when ?stats=1) ─────────────────────────────
  let statsOverlay = '';
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let lastFrameAt = 0;
  let videoFps = 0;

  async function setupSignaling() {
    try {
      channel = new BroadcastChannel(SIGNAL_CHANNEL);
    } catch (e: any) {
      statusText = `BroadcastChannel unavailable: ${e?.message ?? e}`;
      return;
    }

    channel.onmessage = async (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object' || msg.from === 'output') return;

      try {
        if (msg.type === 'offer') {
          await handleOffer(msg.sdp);
        } else if (msg.type === 'ice' && msg.candidate) {
          await applyIceCandidate(msg.candidate);
        } else if (msg.type === 'transform' && msg.payload) {
          applyTransformSnapshot(msg.payload);
        }
      } catch (e: any) {
        console.error('[OutputDisplay] signaling error:', e?.message ?? e);
      }
    };

    startReadyHeartbeat();
    console.log('[OutputDisplay] heartbeat started, waiting for editor offer');
  }

  function applyTransformSnapshot(payload: any) {
    if (!payload || typeof payload !== 'object') return;
    if (typeof payload.rotation === 'number') rotation = payload.rotation;
    if (typeof payload.brightness === 'number') brightness = payload.brightness;
    if (typeof payload.contrast === 'number') contrast = payload.contrast;
    if (payload.fit === 'contain' || payload.fit === 'cover' || payload.fit === 'fill') fit = payload.fit;
  }

  async function handleOffer(sdp: RTCSessionDescriptionInit) {
    if (disposed) return;
    if (pc) {
      // Re-offer arrived (editor restarted, peer was stale, etc.). Drop
      // the old peer and accept the new one. Reset ICE state.
      try { pc.close(); } catch { /* */ }
      pc = null;
      pendingIceCandidates.length = 0;
      remoteDescriptionSet = false;
    }

    pc = new RTCPeerConnection();

    pc.onicecandidate = (event) => {
      if (event.candidate && channel) {
        channel.postMessage({ type: 'ice', from: 'output', candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      if (disposed) return;
      console.log('[OutputDisplay] track received:', event.track.kind, event.streams.length, 'streams');
      const incomingStream = event.streams[0];
      if (videoEl && incomingStream) {
        videoEl.srcObject = incomingStream;
        videoEl.play().catch((e) => console.warn('[OutputDisplay] play() rejected:', e?.message ?? e));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[OutputDisplay] connectionState:', pc?.connectionState);
      if (pc?.connectionState === 'connected') {
        connected = true;
        statusText = '';
        stopReadyHeartbeat();
        if (showStats) startStatsLoop();
      } else if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'failed') {
        connected = false;
        statusText = `Peer ${pc.connectionState} — reconnecting…`;
        if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
        // Restart the heartbeat so we tell the editor we want a fresh
        // peer. Editor will tear down its side on receiving the next
        // `ready` and build a new one.
        startReadyHeartbeat();
      }
    };

    await pc.setRemoteDescription(sdp);
    remoteDescriptionSet = true;
    await drainIceQueue();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (channel) channel.postMessage({ type: 'answer', from: 'output', sdp: answer });
  }

  function setupFrameCallback() {
    if (!videoEl || typeof (videoEl as any).requestVideoFrameCallback !== 'function') return;
    const onFrame = (now: number, _metadata: VideoFrameCallbackMetadata) => {
      if (disposed) return;
      if (lastFrameAt > 0) {
        const dt = now - lastFrameAt;
        videoFps = videoFps === 0 ? 1000 / dt : videoFps * 0.95 + (1000 / dt) * 0.05;
      }
      lastFrameAt = now;
      (videoEl as any).requestVideoFrameCallback(onFrame);
    };
    (videoEl as any).requestVideoFrameCallback(onFrame);
  }

  function startStatsLoop() {
    if (statsTimer) clearInterval(statsTimer);
    setupFrameCallback();
    statsTimer = setInterval(async () => {
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let inboundFps = 0;
        let inboundBytes = 0;
        let inboundFramesDecoded = 0;
        let framesDropped = 0;
        let jitter = 0;
        let processingDelay = 0;
        let codec = '';
        stats.forEach((s: any) => {
          if (s.type === 'inbound-rtp' && s.kind === 'video') {
            inboundFps = s.framesPerSecond || 0;
            inboundBytes = s.bytesReceived || 0;
            inboundFramesDecoded = s.framesDecoded || 0;
            framesDropped = s.framesDropped || 0;
            jitter = s.jitter || 0;
            processingDelay = (s.totalProcessingDelay || 0) / Math.max(1, inboundFramesDecoded);
          } else if (s.type === 'codec' && s.mimeType) {
            codec = s.mimeType;
          }
        });
        const dims = videoEl ? `${videoEl.videoWidth}×${videoEl.videoHeight}` : '?';
        statsOverlay = [
          `RTC ${inboundFps.toFixed(1)} fps  pres ${videoFps.toFixed(1)} fps`,
          `${dims}  ${codec || 'codec?'}`,
          `frames decoded ${inboundFramesDecoded}  dropped ${framesDropped}`,
          `jitter ${(jitter * 1000).toFixed(2)}ms  proc-delay ${(processingDelay * 1000).toFixed(2)}ms`,
          `bytes received ${(inboundBytes / 1024 / 1024).toFixed(1)} MiB`,
          `rotation ${rotation}°  fit ${fit}  bri ${brightness.toFixed(2)}  con ${contrast.toFixed(2)}`,
        ].join('\n');
      } catch (e) {
        // getStats can throw transiently during connection setup. Ignore.
      }
    }, 1000);
  }

  onMount(async () => {
    // Remove the index.html splash overlay (same pattern the other
    // output apps use; otherwise the splash sits on top forever).
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hidden');
      setTimeout(() => splash.remove(), 600);
    }

    await setupSignaling();
  });

  onDestroy(() => {
    disposed = true;
    stopReadyHeartbeat();
    if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
    if (videoEl) {
      try { videoEl.pause(); } catch { /* */ }
      try { videoEl.srcObject = null; } catch { /* */ }
    }
    if (pc) {
      try { pc.close(); } catch { /* */ }
      pc = null;
    }
    if (channel) {
      try { channel.postMessage({ type: 'bye', from: 'output' }); } catch { /* */ }
      try { channel.close(); } catch { /* */ }
      channel = null;
    }
  });
</script>

<video
  bind:this={videoEl}
  class="output-display"
  autoplay
  muted
  playsinline
  style="object-fit: {videoObjectFit}; transform: {videoTransform}; filter: {videoFilter};"
></video>

{#if !connected && statusText}
  <div class="status-overlay">{statusText}</div>
{/if}

{#if showStats && connected && statsOverlay}
  <pre class="stats-overlay">{statsOverlay}</pre>
{/if}

<style>
  :global(html), :global(body) {
    margin: 0;
    padding: 0;
    background: #000;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }
  .output-display {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #000;
    display: block;
    /* object-fit / transform / filter are set inline so the
       reactive Svelte bindings can update them per-frame as
       transform messages arrive from the editor. */
  }
  .status-overlay {
    position: fixed;
    bottom: 8px;
    left: 8px;
    color: #888;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.6);
    padding: 4px 8px;
    border-radius: 3px;
    pointer-events: none;
  }
  .stats-overlay {
    position: fixed;
    top: 8px;
    right: 8px;
    color: #0f0;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    background: rgba(0, 0, 0, 0.7);
    padding: 6px 10px;
    border-radius: 4px;
    pointer-events: none;
    margin: 0;
    white-space: pre;
  }
</style>
