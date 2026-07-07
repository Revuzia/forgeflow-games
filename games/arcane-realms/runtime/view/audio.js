// Arcane Realms TCG — bespoke procedural WebAudio engine.
// 100% original, generated in code for THIS game: three musical themes
// (menu / battle / victory-defeat stings) + a full SFX kit. No samples,
// no reused tracks.

let ctx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let musicTimer = null;
let currentTrack = null;

export const Audio2 = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  enabled: true,

  ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = this.musicVolume;
      musicGain.connect(masterGain);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = this.sfxVolume;
      sfxGain.connect(masterGain);
      return true;
    } catch { return false; }
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  setMusicVolume(v) { this.musicVolume = v; if (musicGain) musicGain.gain.value = v; },
  setSfxVolume(v) { this.sfxVolume = v; if (sfxGain) sfxGain.gain.value = v; },

  // ── instruments ────────────────────────────────────────────────
  _pluck(freq, t, dur = 0.35, vol = 0.5, dest = null) {
    // lute-ish pluck: triangle + quick lowpass sweep
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(dest || musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  },
  _pad(freq, t, dur, vol = 0.12, dest = null) {
    // warm pad: two detuned saws through gentle lowpass
    for (const det of [-4, 3]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = freq * 3; f.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
      g.gain.setValueAtTime(vol, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f); f.connect(g); g.connect(dest || musicGain);
      o.start(t); o.stop(t + dur + 0.05);
    }
  },
  _bell(freq, t, dur = 1.2, vol = 0.25, dest = null) {
    // FM-ish bell for magic accents
    const c = ctx.createOscillator(); c.type = 'sine'; c.frequency.value = freq;
    const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = freq * 2.76;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(freq * 1.4, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur);
    m.connect(mg); mg.connect(c.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    c.connect(g); g.connect(dest || musicGain);
    c.start(t); m.start(t); c.stop(t + dur + 0.1); m.stop(t + dur + 0.1);
  },
  _drum(t, kind = 'kick', vol = 0.5) {
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(musicGain);
      o.start(t); o.stop(t + 0.25);
    } else {
      // taiko/snare: filtered noise burst
      const len = kind === 'taiko' ? 0.28 : 0.09;
      const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = ctx.createBufferSource(); s.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'taiko' ? 'lowpass' : 'bandpass';
      f.frequency.value = kind === 'taiko' ? 220 : 2400;
      const g = ctx.createGain(); g.gain.value = vol * (kind === 'taiko' ? 0.9 : 0.35);
      s.connect(f); f.connect(g); g.connect(musicGain);
      s.start(t);
    }
  },

  // ── music sequencer ────────────────────────────────────────────
  // Original compositions. Scale degrees over a root; chord patterns per track.
  playMusic(track) {
    if (!this.ensure()) return;
    if (currentTrack === track) return;
    this.stopMusic();
    currentTrack = track;
    const N = (o, s) => 220 * Math.pow(2, o + s / 12); // A3-rooted
    // A natural-minor-ish palettes
    const T = {
      menu: {
        bpm: 62,
        chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, 0, 4]], // Am F G Em-ish colors
        bass: [0, -4, -2, -5],
        arp: [0, 3, 7, 10, 7, 3],
        drums: false, bells: true,
      },
      battle: {
        bpm: 96,
        chords: [[0, 3, 7], [0, 3, 7], [-2, 2, 5], [-4, 0, 3]],
        bass: [0, 0, -2, -4],
        arp: [0, 7, 3, 7, 0, 7, 5, 7],
        drums: true, bells: false,
      },
      battle2: {
        bpm: 104,
        chords: [[0, 4, 7], [-3, 0, 4], [-5, 0, 4], [-2, 2, 5]],
        bass: [0, -3, -5, -2],
        arp: [0, 4, 7, 12, 7, 4, 7, 12],
        drums: true, bells: true,
      },
    }[track];
    if (!T) return;
    const beat = 60 / T.bpm;
    const barLen = beat * 4;
    let bar = 0;
    let nextBarTime = ctx.currentTime + 0.08;
    const scheduleBar = () => {
      if (currentTrack !== track) return;
      const t0 = nextBarTime;
      const chord = T.chords[bar % T.chords.length];
      const bass = T.bass[bar % T.bass.length];
      // pad chord (skip some bars on menu for air)
      if (track !== 'menu' || bar % 2 === 0) {
        for (const s of chord) this._pad(N(-1, s), t0, barLen * 1.02, track === 'menu' ? 0.085 : 0.06);
      }
      // bass
      this._pluck(N(-2, bass), t0, beat * 1.6, 0.4);
      if (track !== 'menu') this._pluck(N(-2, bass), t0 + beat * 2, beat * 1.4, 0.32);
      // arpeggio melody (deterministic per-bar variation)
      const steps = T.arp.length;
      for (let i = 0; i < steps; i++) {
        const jitter = ((bar * 7 + i * 5) % 11) / 11; // pseudo-random but repeatable
        if (track === 'menu' && jitter > 0.72) continue; // sparse
        const s = T.arp[(i + bar) % steps];
        const oct = jitter > 0.8 ? 1 : 0;
        this._pluck(N(oct, chord[0] + s), t0 + (barLen / steps) * i, beat * 0.9, track === 'menu' ? 0.16 : 0.14);
      }
      // bells accent
      if (T.bells && bar % 4 === 3) this._bell(N(1, chord[2]), t0 + beat * 3, beat * 2, 0.08);
      // drums
      if (T.drums) {
        this._drum(t0, 'kick', 0.5);
        this._drum(t0 + beat * 1, 'snare', 0.5);
        this._drum(t0 + beat * 2, 'kick', 0.42);
        this._drum(t0 + beat * 2.5, 'kick', 0.3);
        this._drum(t0 + beat * 3, 'snare', 0.5);
        if (bar % 2 === 1) this._drum(t0 + beat * 3.5, 'taiko', 0.5);
      }
      bar++;
      nextBarTime += barLen;
      musicTimer = setTimeout(scheduleBar, (nextBarTime - ctx.currentTime - 0.35) * 1000);
    };
    scheduleBar();
  },
  stopMusic() {
    currentTrack = null;
    if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  },
  sting(kind) {
    if (!this.ensure()) return;
    const t = ctx.currentTime + 0.02;
    const N = (o, s) => 220 * Math.pow(2, o + s / 12);
    if (kind === 'victory') {
      this.stopMusic();
      [[0, 0], [0.16, 4], [0.32, 7], [0.5, 12], [0.86, 7], [1.0, 12]].forEach(([dt, s]) => {
        this._pluck(N(0, s), t + dt, 0.5, 0.45);
        this._bell(N(1, s), t + dt, 1.4, 0.1);
      });
      this._pad(N(-1, 0), t, 2.6, 0.12); this._pad(N(-1, 4), t, 2.6, 0.1); this._pad(N(-1, 7), t, 2.6, 0.1);
      this._drum(t + 0.5, 'taiko', 0.7);
    } else if (kind === 'defeat') {
      this.stopMusic();
      [[0, 5], [0.3, 3], [0.6, 0], [1.05, -4]].forEach(([dt, s]) => {
        this._pluck(N(-1, s), t + dt, 0.9, 0.4);
      });
      this._pad(N(-2, 0), t, 3.0, 0.14);
      this._drum(t + 1.2, 'taiko', 0.5);
    }
  },

  // ── SFX kit ────────────────────────────────────────────────────
  sfx(name) {
    if (!this.enabled || !this.ensure()) return;
    const t = ctx.currentTime + 0.005;
    const noise = (len, filtType, freq, vol, sweepTo = null) => {
      const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * len), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = ctx.createBufferSource(); s.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = filtType;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      s.connect(f); f.connect(g); g.connect(sfxGain);
      s.start(t);
    };
    const tone = (freq, len, vol, type = 'sine', to = null) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g); g.connect(sfxGain);
      o.start(t); o.stop(t + len + 0.05);
    };
    switch (name) {
      case 'hover': tone(880, 0.05, 0.05, 'sine'); break;
      case 'click': tone(660, 0.06, 0.12, 'triangle'); noise(0.03, 'highpass', 3000, 0.05); break;
      case 'draw': noise(0.18, 'bandpass', 1400, 0.18, 2600); break;
      case 'play': noise(0.12, 'lowpass', 900, 0.3); tone(520, 0.18, 0.15, 'triangle'); break;
      case 'summon': tone(330, 0.25, 0.2, 'triangle', 495); noise(0.2, 'bandpass', 800, 0.12, 1800); break;
      case 'tap': noise(0.06, 'bandpass', 2000, 0.14); tone(240, 0.08, 0.12, 'square'); break;
      case 'untap': tone(300, 0.08, 0.08, 'triangle', 420); break;
      case 'attack': noise(0.22, 'bandpass', 900, 0.3, 300); break;
      case 'impact': noise(0.16, 'lowpass', 500, 0.5); tone(90, 0.18, 0.4, 'sine', 45); break;
      case 'death': noise(0.4, 'lowpass', 700, 0.3, 120); tone(160, 0.4, 0.2, 'sawtooth', 60); break;
      case 'spell': [0, 0.05, 0.1].forEach((dt, i) => tone(700 + i * 260, 0.22, 0.1, 'sine')); noise(0.25, 'highpass', 2500, 0.08); break;
      case 'freeze': tone(1400, 0.35, 0.12, 'sine', 500); noise(0.3, 'highpass', 4000, 0.1); break;
      case 'heal': [0, 0.08, 0.16].forEach((dt, i) => tone(520 * Math.pow(1.25, i), 0.3, 0.09, 'sine')); break;
      case 'buff': tone(440, 0.2, 0.12, 'triangle', 660); break;
      case 'debuff': tone(440, 0.25, 0.12, 'sawtooth', 220); break;
      case 'trap': noise(0.1, 'highpass', 1800, 0.3); tone(180, 0.15, 0.25, 'square', 120); break;
      case 'shield': tone(700, 0.12, 0.15, 'sine'); tone(1050, 0.2, 0.1, 'sine'); break;
      case 'legendary': {
        // brass-ish fanfare stab
        [0, 0.12].forEach((dt) => {
          [220, 277, 330].forEach((f) => {
            const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
            const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1200;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.001, t + dt);
            g.gain.linearRampToValueAtTime(0.12, t + dt + 0.03);
            g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.5);
            o.connect(fl); fl.connect(g); g.connect(sfxGain);
            o.start(t + dt); o.stop(t + dt + 0.6);
          });
        });
        this._drum && this._drum(t, 'taiko', 0.6);
        break;
      }
      case 'coin': tone(1200, 0.3, 0.12, 'sine', 1800); break;
      case 'error': tone(200, 0.15, 0.15, 'square', 150); break;
      case 'turn': tone(392, 0.15, 0.14, 'triangle'); tone(523, 0.25, 0.12, 'triangle'); break;
      case 'pierce': noise(0.2, 'highpass', 1500, 0.25, 500); break;
      case 'venom': tone(300, 0.3, 0.14, 'sawtooth', 90); noise(0.25, 'bandpass', 600, 0.1); break;
    }
  },
};
