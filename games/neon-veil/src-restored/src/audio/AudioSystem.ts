import type { Settings } from '../core/types';
import type { MapId } from '../core/types';

/** Per-biome soundtrack (public/music/) — mood-matched from F:\Music. */
const BIOME_MUSIC: Record<string, string> = {
  'sky-city': 'music/biome-sky-city.mp3', // Neon Turbine — synthwave streets
  'the-pit': 'music/biome-the-pit.mp3', // Machine Loop — industrial
  'cloud-sea': 'music/biome-cloud-sea.mp3', // Atoll Mist — airy float
  'upper-atmo': 'music/biome-upper-atmo.mp3', // Meridian Orbit — orbital
  'deep-space': 'music/biome-deep-space.mp3', // Penumbra Spire — void
};

const MENU_MUSIC = 'music/biome-sky-city.mp3';

/**
 * Procedural combat SFX + per-biome background music.
 * Unlocks on first engage click (browser autoplay policy).
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private boostNoise: AudioBufferSourceNode | null = null;
  private boostGain: GainNode | null = null;
  private settings: Settings;
  private unlocked = false;
  private lastBoost = false;
  private musicEl: HTMLAudioElement | null = null;
  private musicStarted = false;
  private currentBiome: MapId | 'menu' | null = null;
  private musicWired = false;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  async unlock() {
    if (this.unlocked) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.mute ? 0 : this.settings.volume;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.settings.mute ? 0 : 0.28;
    this.musicGain.connect(this.master);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.startEngine();
    this.unlocked = true;
    // Expose for ForgeFlow game_controls mute (suspend/resume)
    try {
      (window as unknown as { __AUDIO_CTX__?: AudioContext }).__AUDIO_CTX__ = this.ctx;
    } catch {
      /* ignore */
    }
    // Start with last requested biome or sky-city default
    void this.setBiomeMusic(this.currentBiome && this.currentBiome !== 'menu' ? this.currentBiome : 'sky-city');
  }

  applySettings(s: Settings) {
    this.settings = s;
    if (this.master) {
      this.master.gain.value = s.mute ? 0 : s.volume;
    }
    if (this.musicGain) {
      this.musicGain.gain.value = s.mute ? 0 : 0.28;
    }
    if (this.musicEl) {
      if (!this.musicWired) {
        this.musicEl.volume = s.mute ? 0 : 0.32 * s.volume;
      }
      if (s.mute) this.musicEl.pause();
      else if (this.musicStarted) void this.musicEl.play().catch(() => undefined);
    }
  }

  /**
   * Switch BGM to match sector. Crossfades via short pause + new track.
   * Safe to call before unlock (queues until unlock).
   */
  setBiomeMusic(mapId: MapId | 'menu') {
    this.currentBiome = mapId;
    if (!this.unlocked || this.settings.mute) return;
    const url = mapId === 'menu' ? MENU_MUSIC : BIOME_MUSIC[mapId] || MENU_MUSIC;
    this.ensureMusicEl();
    if (!this.musicEl) return;
    // Same track already playing
    if (this.musicStarted && this.musicEl.src.includes(url.replace('music/', ''))) {
      void this.musicEl.play().catch(() => undefined);
      return;
    }
    this.musicEl.loop = true;
    this.musicEl.src = url;
    void this.musicEl.play().catch((err) => {
      console.warn('[NEON VEIL] biome music failed', url, err);
    });
    this.musicStarted = true;
  }

  private ensureMusicEl() {
    if (this.musicEl) return;
    this.musicEl = new Audio();
    this.musicEl.preload = 'auto';
    this.musicEl.loop = true;
    this.musicEl.volume = 0.32 * this.settings.volume;
    if (this.ctx && this.musicGain && !this.musicWired) {
      try {
        const src = this.ctx.createMediaElementSource(this.musicEl);
        src.connect(this.musicGain);
        this.musicEl.volume = 1;
        this.musicGain.gain.value = 0.28;
        this.musicWired = true;
      } catch {
        /* already connected */
      }
    }
  }

  /** @deprecated use setBiomeMusic — kept for call sites */
  async startMusic() {
    this.setBiomeMusic(this.currentBiome && this.currentBiome !== 'menu' ? this.currentBiome : 'sky-city');
  }

  stopMusic() {
    if (this.musicEl) {
      this.musicEl.pause();
      this.musicStarted = false;
    }
  }

  setEngineThrust(amount: number, boosting: boolean) {
    if (!this.engineGain || !this.engineOsc || !this.ctx || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const base = 0.018 + amount * 0.07;
    this.engineGain.gain.setTargetAtTime(base * (boosting ? 1.7 : 1), t, 0.05);
    this.engineOsc.frequency.setTargetAtTime(48 + amount * 55 + (boosting ? 40 : 0), t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(220 + amount * 400 + (boosting ? 500 : 0), t, 0.08);

    if (boosting && !this.lastBoost) {
      this.playBoost();
      this.startBoostLoop();
    } else if (!boosting && this.lastBoost) {
      this.stopBoostLoop();
    }
    this.lastBoost = boosting;
  }

  playUI() {
    this.beep(880, 0.05, 'square', 0.04);
    this.beep(1320, 0.04, 'sine', 0.025);
  }

  playPlasma() {
    this.noiseBurst(0.05, 0.06, 2200, 0.06);
    this.beep(380, 0.06, 'sawtooth', 0.055);
    this.beep(760, 0.04, 'square', 0.03);
    this.slide(500, 180, 0.08, 'sawtooth', 0.04);
  }

  playRocket() {
    this.noiseBurst(0.22, 0.14, 350, 0.18);
    this.slide(90, 40, 0.25, 'sawtooth', 0.1);
    this.beep(55, 0.15, 'sine', 0.06);
  }

  playRail() {
    this.noiseBurst(0.08, 0.08, 4000, 0.06);
    this.beep(1600, 0.1, 'square', 0.07);
    this.beep(2400, 0.07, 'sine', 0.05);
    this.slide(2800, 400, 0.12, 'sawtooth', 0.04);
  }

  playLaser() {
    this.beep(1900, 0.035, 'square', 0.04);
    this.beep(2600, 0.03, 'sine', 0.03);
    this.noiseBurst(0.03, 0.03, 5000, 0.03);
  }

  playScatter() {
    this.noiseBurst(0.09, 0.09, 1600, 0.08);
    this.beep(280, 0.05, 'sawtooth', 0.05);
    this.beep(420, 0.04, 'square', 0.03);
  }

  playPickup() {
    this.beep(660, 0.05, 'sine', 0.05);
    this.beep(990, 0.07, 'sine', 0.045);
    this.beep(1320, 0.09, 'sine', 0.035);
    this.beep(1760, 0.06, 'triangle', 0.025);
  }

  playLockTick(progress = 0.5) {
    const f = 620 + progress * 900;
    this.beep(f, 0.045, 'square', 0.04 + progress * 0.02);
  }

  playLockTone() {
    this.beep(1400, 0.08, 'square', 0.06);
    this.beep(1800, 0.1, 'sine', 0.05);
    this.beep(2200, 0.06, 'triangle', 0.03);
  }

  playLockLost() {
    this.beep(400, 0.08, 'sawtooth', 0.04);
    this.slide(500, 180, 0.12, 'square', 0.03);
  }

  playExplosion() {
    this.noiseBurst(0.4, 0.28, 180, 0.35);
    this.noiseBurst(0.15, 0.12, 800, 0.12);
    this.beep(70, 0.2, 'sine', 0.08);
    this.slide(120, 30, 0.25, 'sawtooth', 0.06);
  }

  playHitConfirm() {
    this.beep(880, 0.04, 'square', 0.05);
    this.beep(1320, 0.05, 'sine', 0.04);
    this.noiseBurst(0.03, 0.04, 3000, 0.03);
  }

  playHit() {
    this.noiseBurst(0.1, 0.1, 600, 0.09);
    this.beep(180, 0.08, 'square', 0.07);
    this.beep(90, 0.1, 'sawtooth', 0.05);
  }

  playCrit() {
    this.beep(1200, 0.06, 'square', 0.06);
    this.beep(1800, 0.08, 'sine', 0.05);
    this.beep(2400, 0.1, 'triangle', 0.04);
    this.noiseBurst(0.06, 0.06, 2500, 0.05);
  }

  playShieldHit() {
    this.beep(520, 0.05, 'triangle', 0.05);
    this.beep(780, 0.07, 'sine', 0.04);
    this.noiseBurst(0.05, 0.04, 1800, 0.04);
  }

  playShieldUp() {
    this.slide(400, 900, 0.18, 'sine', 0.06);
    this.beep(900, 0.15, 'triangle', 0.04);
  }

  playShieldDown() {
    this.slide(700, 200, 0.15, 'sine', 0.05);
    this.noiseBurst(0.08, 0.05, 500, 0.08);
  }

  playBoost() {
    this.noiseBurst(0.12, 0.1, 1100, 0.1);
    this.slide(200, 500, 0.12, 'sawtooth', 0.05);
  }

  playDeath() {
    this.slide(200, 40, 0.45, 'sawtooth', 0.1);
    this.noiseBurst(0.5, 0.3, 140, 0.4);
    this.beep(60, 0.35, 'sine', 0.08);
  }

  playWarp() {
    this.slide(200, 1400, 0.35, 'sine', 0.07);
    this.noiseBurst(0.25, 0.12, 900, 0.2);
    this.beep(1100, 0.12, 'triangle', 0.04);
  }

  playKill() {
    this.beep(660, 0.06, 'square', 0.05);
    this.beep(990, 0.08, 'sine', 0.05);
    this.beep(1480, 0.12, 'triangle', 0.04);
  }

  private startBoostLoop() {
    if (!this.ctx || !this.sfx || this.boostGain) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
    g.connect(this.sfx);
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.7;
    src.connect(f);
    f.connect(g);
    src.start();
    this.boostNoise = src;
    this.boostGain = g;
  }

  private stopBoostLoop() {
    if (!this.ctx || !this.boostGain || !this.boostNoise) return;
    const t = this.ctx.currentTime;
    try {
      this.boostGain.gain.cancelScheduledValues(t);
      this.boostGain.gain.setValueAtTime(Math.max(0.0001, this.boostGain.gain.value), t);
      this.boostGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    } catch {
      /* ignore */
    }
    const src = this.boostNoise;
    const g = this.boostGain;
    this.boostNoise = null;
    this.boostGain = null;
    window.setTimeout(() => {
      try {
        src.stop();
        src.disconnect();
        g.disconnect();
      } catch {
        /* ignore */
      }
    }, 150);
  }

  private startEngine() {
    if (!this.ctx || !this.master) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 260;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.025;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  private dest(): AudioNode | null {
    return this.sfx ?? this.master;
  }

  private beep(freq: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.dest() || this.settings.mute) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.dest()!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private slide(from: number, to: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.dest() || this.settings.mute) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.dest()!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, cutoff: number, decay: number) {
    if (!this.ctx || !this.dest() || this.settings.mute) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.dest()!);
    src.start(t);
  }
}
