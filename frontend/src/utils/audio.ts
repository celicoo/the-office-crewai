// Ambient loop by Fupicat, used with permission. Credit is not required.
import bgUrl from '../assets/bg.wav';

const AMBIENT_VOLUME = 0.35;

// Web Audio API procedural futuristic sound effects generator
class SoundFX {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;
  private ambientGain: GainNode | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private ambientBuffer: AudioBuffer | null = null;
  private ambientStarting = false;
  private resumeArmed = false;

  setEnabled(enabled: boolean) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      if (this.ctx) {
        this.ctx.suspend().catch(() => {});
      }
      return;
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => this.armResume());
    }
    void this.startAmbient();
  }

  private armResume() {
    if (this.resumeArmed || typeof window === 'undefined') return;
    this.resumeArmed = true;
    const onGesture = () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      this.resumeArmed = false;
      if (!this.enabled) return;
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      void this.startAmbient();
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
  }

  private async startAmbient() {
    if (!this.enabled || this.ambientSource || this.ambientStarting) return;
    const ctx = this.getContext();
    if (!ctx) return;
    this.ambientStarting = true;
    try {
      if (!this.ambientBuffer) {
        const response = await fetch(bgUrl);
        const data = await response.arrayBuffer();
        if (!this.enabled) return;
        this.ambientBuffer = await ctx.decodeAudioData(data);
      }
      if (!this.enabled || this.ambientSource) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = this.ambientBuffer;
      source.loop = true;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(AMBIENT_VOLUME, now + 1.2);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      this.ambientSource = source;
      this.ambientGain = gain;
      if (ctx.state === 'suspended') this.armResume();
    } catch {
      this.armResume();
    } finally {
      this.ambientStarting = false;
    }
  }

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Futuristic click / select beep
  playClick() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // ignore
    }
  }

  // Holographic warp / mode change swoosh
  playModeSwitch() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch {}
  }

  // Data pulse / tool execution chirp
  playDataPulse() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'sawtooth';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(540, ctx.currentTime);
      osc2.frequency.setValueAtTime(1080, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.12);
    } catch {}
  }

  // Voice listening chime
  playListeningStart() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [440, 660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.04, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.08);
      });
    } catch {}
  }

  playVoiceTrigger() {
    this.playListeningStart();
  }

  playNotification() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.045, now + index * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + index * 0.08);
        osc.stop(now + index * 0.08 + 0.18);
      });
    } catch {}
  }
}

export const soundFX = new SoundFX();
