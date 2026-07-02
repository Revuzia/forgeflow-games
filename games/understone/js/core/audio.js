// WebAudio SFX pool + music with crossfade. Files: assets/audio/sfx/*.ogg, music/*.ogg.
// Audio unlocks on first user gesture (browser autoplay policy).

const SFX = ['dig0', 'dig1', 'dig2', 'chop', 'place', 'doorOpen', 'doorClose', 'hurt', 'hit',
  'slimeHit', 'death', 'pickup', 'coins', 'craft', 'swing', 'jump', 'uiClick', 'uiOpen', 'uiClose', 'powerup'];
// music tracks are full songs (own Suno catalog) — loaded LAZILY per track, never all at once
const MUSIC = ['title', 'day', 'night', 'underground', 'corruption', 'boss', 'hell', 'victory'];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.musicGain = null;
    this.sfxGain = null;
    this.currentMusic = null;      // {name, source, gain}
    this.enabled = true;
    this.musicVolume = 0.35;
    this.sfxVolume = 0.7;
    this.lastPlay = new Map();     // throttle repeated sfx
    const unlock = () => { this.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.ctx.destination);
    // SFX are tiny — load them all now. Music streams in on demand (see music()).
    await Promise.all(SFX.map(n => this.load(`assets/audio/sfx/${n}.ogg`, `sfx:${n}`)));
  }

  async load(path, key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(key, buf);
      return buf;
    } catch { return null; /* missing audio is non-fatal */ }
  }

  play(name, { volume = 1, rate = 1, throttleMs = 60 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const now = performance.now();
    if (now - (this.lastPlay.get(name) ?? 0) < throttleMs) return;
    this.lastPlay.set(name, now);
    const buf = this.buffers.get(`sfx:${name}`);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g); g.connect(this.sfxGain);
    src.start();
  }

  async music(name) {
    if (!this.ctx || !this.enabled) return;
    if (this.currentMusic?.name === name || this.pendingMusic === name) return;
    this.pendingMusic = name;
    const buf = await this.load(`assets/audio/music/${name}.ogg`, `music:${name}`);
    if (this.pendingMusic !== name) return;      // superseded while loading
    this.pendingMusic = null;
    // fade out old
    if (this.currentMusic) {
      const old = this.currentMusic;
      old.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5);
      setTimeout(() => { try { old.source.stop(); } catch {} }, 1700);
      this.currentMusic = null;
    }
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = name !== 'victory';
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1.5);
    src.connect(g); g.connect(this.musicGain);
    src.start();
    this.currentMusic = { name, source: src, gain: g };
  }
}
