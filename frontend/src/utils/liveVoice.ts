/**
 * One Gemini Live call with a desk agent.
 * 16 kHz mic in, 24 kHz audio out. Gemini owns turn-taking.
 */

const CAPTURE_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;

export type LiveTranscript = {
  role: 'user' | 'agent';
  text: string;
  finished?: boolean;
};

type Handlers = {
  agentId: string;
  onTranscript?: (item: LiveTranscript) => void;
  onStatus?: (status: 'speaking' | 'thinking' | 'idle', detail?: string) => void;
};

function int16ToFloat(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const count = Math.floor(buffer.byteLength / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}

class LiveVoice {
  private socket: WebSocket | null = null;
  private agentId: string | null = null;
  private generation = 0;
  private captureCtx: AudioContext | null = null;
  private captureStream: MediaStream | null = null;
  private playbackCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  get activeAgentId() {
    return this.agentId;
  }

  private stopPlayback() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
    this.nextPlayTime = 0;
  }

  private playPcm(buffer: ArrayBuffer) {
    if (buffer.byteLength < 4) return;
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    }
    const ctx = this.playbackCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const samples = int16ToFloat(buffer);
    if (!samples.length) return;
    const audio = ctx.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE);
    audio.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    if (this.nextPlayTime < now + 0.05) this.nextPlayTime = now + 0.05;
    source.start(this.nextPlayTime);
    this.nextPlayTime += audio.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter(item => item !== source);
    };
  }

  private cleanupMedia() {
    this.captureStream?.getTracks().forEach(track => track.stop());
    this.captureStream = null;
    this.captureCtx?.close().catch(() => {});
    this.captureCtx = null;
    this.stopPlayback();
    this.playbackCtx?.close().catch(() => {});
    this.playbackCtx = null;
  }

  stop() {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.agentId = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: 'call.ended' }));
      socket.close();
    }
    this.cleanupMedia();
  }

  sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ event: 'speech.final', transcript: trimmed }));
  }

  async start(handlers: Handlers) {
    if (this.agentId === handlers.agentId && this.socket) return;
    this.stop();
    const generation = ++this.generation;
    this.agentId = handlers.agentId;
    handlers.onStatus?.('thinking', 'Connecting');

    const playback = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    if (playback.state === 'suspended') await playback.resume();
    if (generation !== this.generation) {
      playback.close().catch(() => {});
      return;
    }
    this.playbackCtx = playback;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/live-voice?agent_id=${encodeURIComponent(handlers.agentId)}`,
    );
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      if (event.data instanceof ArrayBuffer) {
        handlers.onStatus?.('speaking');
        this.playPcm(event.data);
        return;
      }
      let payload: any;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.event === 'user.interrupted') this.stopPlayback();
      if (payload.event === 'session.started') handlers.onStatus?.('idle', 'Listening');
      if (payload.event === 'error') {
        console.error('Live voice error:', payload.message);
        handlers.onStatus?.('idle', payload.message || 'Error');
      }
      if (payload.event === 'transcript' && payload.text) {
        handlers.onTranscript?.({
          role: payload.role === 'user' ? 'user' : 'agent',
          text: payload.text,
          finished: Boolean(payload.finished),
        });
      }
      if (payload.event === 'turn_complete') {
        handlers.onTranscript?.({ role: 'agent', text: '', finished: true });
        handlers.onStatus?.('idle');
      }
      if (payload.event === 'tool_call') handlers.onStatus?.('thinking', payload.name);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.agentId = null;
      this.cleanupMedia();
      handlers.onStatus?.('idle');
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: CAPTURE_SAMPLE_RATE,
      },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.captureStream = stream;
    const capture = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
    if (capture.state === 'suspended') await capture.resume();
    this.captureCtx = capture;
    await capture.audioWorklet.addModule(`/pcm-capture-processor.js?v=${Date.now()}`);
    const node = new AudioWorkletNode(capture, 'pcm-capture-processor');
    node.port.onmessage = (event) => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(event.data);
    };
    const source = capture.createMediaStreamSource(stream);
    const mute = capture.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(capture.destination);
    handlers.onStatus?.('idle', 'Listening');
  }

  toggle(handlers: Handlers) {
    if (this.agentId === handlers.agentId) this.stop();
    else void this.start(handlers);
  }
}

export const liveVoice = new LiveVoice();
