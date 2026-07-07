// Bastion Realms: Stronghold audio — 100% generated.
// SFX: WebAudio synthesis. Music: an original procedural sequencer with a
// distinct composition per world (key, tempo, progression, instrumentation).
// No audio files are loaded anywhere.

export function createAudio(settings) {
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const sfxGain = actx.createGain(); sfxGain.gain.value = settings.sfx;
  const musGain = actx.createGain(); musGain.gain.value = settings.music;
  sfxGain.connect(actx.destination);
  musGain.connect(actx.destination);
  let unlocked = false;
  const lastPlay = new Map();

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    actx.resume?.();
    music.ensureRunning();
  }

  // ---------------- SFX synth kit ----------------
  function env(g, a, d, peak, t0 = actx.currentTime) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
  }
  function noiseBuf(dur = 0.4) {
    const n = Math.floor(actx.sampleRate * dur);
    const b = actx.createBuffer(1, n, actx.sampleRate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    return b;
  }
  function osc(type, f0, f1, a, d, vol, filter = null) {
    if (!unlocked) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    const g = actx.createGain(); env(g, a, d, vol);
    if (filter) {
      const f = actx.createBiquadFilter();
      if (filter.type) f.type = filter.type;
      if (filter.frequency) f.frequency.value = filter.frequency;
      if (filter.Q) f.Q.value = filter.Q;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(sfxGain);
    o.start(); o.stop(t + a + d + 0.05);
  }
  function noise(dur, vol, { type = 'lowpass', f0 = 800, f1 = null, q = 1, a = 0.01 } = {}) {
    if (!unlocked) return;
    const t = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = noiseBuf(dur);
    const f = actx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = actx.createGain(); env(g, a, dur - a, vol);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start();
  }

  const sfx = {
    ballista() { noise(0.1, 0.5, { type: 'bandpass', f0: 300, q: 2 }); osc('square', 140, 60, 0.005, 0.12, 0.35); },
    crossbow() { noise(0.07, 0.45, { type: 'highpass', f0: 1200 }); osc('triangle', 900, 200, 0.003, 0.1, 0.3); },
    arcane() { osc('sine', 700, 1500, 0.02, 0.25, 0.22); osc('sine', 1050, 2100, 0.02, 0.22, 0.14); },
    missileHit() { osc('triangle', 800, 250, 0.005, 0.14, 0.3); noise(0.12, 0.2, { f0: 2000, f1: 500 }); },
    oilThrow() { noise(0.3, 0.3, { type: 'bandpass', f0: 500, f1: 1400, q: 1.2, a: 0.05 }); },
    oilSplash() { noise(0.4, 0.45, { f0: 1600, f1: 300 }); osc('sawtooth', 220, 70, 0.01, 0.3, 0.25, { type: 'lowpass', frequency: 600 }); },
    thornPulse() { noise(0.15, 0.18, { type: 'bandpass', f0: 900, q: 3 }); },
    holyChime() {
      const t = actx.currentTime;
      [880, 1320, 1760].forEach((f, i) => {
        if (!unlocked) return;
        const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = actx.createGain(); env(g, 0.01, 0.5, 0.12, t + i * 0.05);
        o.connect(g); g.connect(sfxGain);
        o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.6);
      });
    },
    runeBlast() { osc('square', 300, 60, 0.005, 0.3, 0.5, { type: 'lowpass', frequency: 900 }); noise(0.35, 0.4, { f0: 2400, f1: 200 }); },
    stormZap() {
      osc('sawtooth', 1800, 120, 0.004, 0.18, 0.4);
      noise(0.14, 0.3, { type: 'highpass', f0: 2600 });
    },
    bastionHit() {
      osc('sine', 90, 34, 0.008, 0.5, 0.85);
      noise(0.5, 0.5, { f0: 500, f1: 90 });
    },
    bastionCrack() { noise(0.6, 0.6, { f0: 900, f1: 120, q: 1.4 }); osc('square', 70, 30, 0.01, 0.5, 0.4); },
    repair() { osc('sine', 520, 1040, 0.05, 0.4, 0.1); },
    deathClank(pitch = 1) {
      osc('square', 220 * pitch, 60 * pitch, 0.005, 0.25, 0.4, { type: 'lowpass', frequency: 1200 * pitch });
      noise(0.22, 0.3, { f0: 1800 * pitch, f1: 300 * pitch });
      osc('sine', 100 * Math.min(1, pitch), 40, 0.01, 0.2, 0.4);
    },
    bossDeath() {
      this.deathClank(0.5);
      noise(1.1, 0.6, { f0: 700, f1: 60, a: 0.05 });
    },
    coin() { osc('sine', 1400, 1800, 0.004, 0.12, 0.12); },
    build() { noise(0.08, 0.4, { type: 'bandpass', f0: 700, q: 2 }); osc('sine', 180, 90, 0.005, 0.12, 0.3); },
    upgrade() { osc('sine', 520, 780, 0.02, 0.2, 0.2); osc('sine', 780, 1170, 0.06, 0.22, 0.18); },
    sell() { osc('sine', 900, 500, 0.01, 0.2, 0.18); },
    uiTap() { osc('sine', 660, 500, 0.004, 0.07, 0.16); },
    uiBack() { osc('sine', 440, 330, 0.004, 0.09, 0.14); },
    uiError() { osc('square', 220, 180, 0.01, 0.18, 0.2); },
    waveHorn() {
      const t = actx.currentTime;
      for (const [f, det] of [[196, 0], [147, 5]]) {
        if (!unlocked) continue;
        const o = actx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = f; o.detune.value = det;
        const flt = actx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 850;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.07);
        g.gain.setValueAtTime(0.18, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
        o.connect(flt); flt.connect(g); g.connect(sfxGain);
        o.start(); o.stop(t + 1);
      }
    },
    cartRumble() { noise(0.8, 0.35, { f0: 300, f1: 120, a: 0.08 }); },
    lightning() { this.stormZap(); noise(0.6, 0.4, { f0: 1200, f1: 100, a: 0.02 }); },
  };

  function play(name, opts = {}) {
    if (!unlocked) return;
    const now = performance.now();
    const th = opts.throttle ?? 70;
    if (lastPlay.has(name) && now - lastPlay.get(name) < th) return;
    lastPlay.set(name, now);
    sfx[name]?.(opts.pitch ?? 1);
  }

  // ---------------- procedural music engine ----------------
  // Original compositions: per-track scale/progression/instruments, scheduled
  // with a lookahead timer. Seamless because it never stops composing.
  const SONGS = {
    menu: {
      bpm: 72, root: 220, minor: true, prog: [0, -4, -2, -5], // Am F G Dm feel
      pad: true, harp: true, drums: null, bass: 'soft',
    },
    colosseum: {
      bpm: 108, root: 196, minor: true, prog: [0, 0, -2, 3],
      pad: false, harp: false, brass: true, drums: 'war', bass: 'stab',
    },
    gothic: {
      bpm: 84, root: 174.6, minor: true, prog: [0, -4, 1, -2],
      pad: 'organ', harp: false, drums: 'toll', bass: 'deep',
    },
    sky: {
      bpm: 116, root: 261.6, minor: false, prog: [0, 5, -2, 4],
      pad: true, harp: true, flute: true, drums: 'light', bass: 'soft',
    },
    crystal: {
      bpm: 92, root: 246.9, minor: false, prog: [0, 2, -3, 4],
      pad: true, bells: true, drums: null, bass: 'soft',
    },
    dwarven: {
      bpm: 96, root: 146.8, minor: true, prog: [0, 0, -3, -2],
      pad: false, drums: 'anvil', brass: 'low', bass: 'deep',
    },
    victory: { bpm: 110, root: 261.6, minor: false, prog: [0, 5, 0, 7], brass: true, drums: 'light', bass: 'stab', once: 8 },
    defeat: { bpm: 60, root: 196, minor: true, prog: [0, -2, -4, -5], pad: 'organ', bass: 'deep', once: 8 },
  };
  const SCALE_MAJ = [0, 2, 4, 5, 7, 9, 11, 12];
  const SCALE_MIN = [0, 2, 3, 5, 7, 8, 10, 12];
  const st = (root, semis) => root * Math.pow(2, semis / 12);

  const music = {
    current: null, songKey: null,
    nextBeat: 0, beatIdx: 0, timer: null,
    tone(f, t0, dur, vol, type = 'sine', dest = musGain, filterF = 0) {
      const o = actx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = actx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.05, dur * 0.2));
      g.gain.setValueAtTime(vol * 0.8, t0 + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      if (filterF) {
        const f2 = actx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = filterF;
        o.connect(f2); f2.connect(g);
      } else o.connect(g);
      g.connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    thump(t0, vol, f = 60) {
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f * 2.2, t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + 0.1);
      const g = actx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(g); g.connect(musGain);
      o.start(t0); o.stop(t0 + 0.3);
    },
    clank(t0, vol) {
      const src = actx.createBufferSource(); src.buffer = noiseBuf(0.12);
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 4;
      const g = actx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      src.connect(f); f.connect(g); g.connect(musGain);
      src.start(t0);
    },
    scheduleBar(song, barIdx, t0) {
      const beat = 60 / song.bpm;
      const bar = beat * 4;
      const scale = song.minor ? SCALE_MIN : SCALE_MAJ;
      const chordRoot = st(song.root, song.prog[barIdx % song.prog.length]);
      const triad = [0, scale[2], scale[4]];
      // bass
      if (song.bass) {
        const bf = chordRoot / 2;
        if (song.bass === 'deep') this.tone(bf / 2, t0, bar * 0.95, 0.16, 'triangle', musGain, 300);
        else if (song.bass === 'stab') { for (let i = 0; i < 4; i++) this.tone(bf, t0 + i * beat, beat * 0.5, 0.12, 'sawtooth', musGain, 500); }
        else this.tone(bf, t0, bar * 0.95, 0.1, 'sine');
      }
      // pad / organ
      if (song.pad) {
        for (const semis of triad) {
          this.tone(st(chordRoot, semis), t0, bar, song.pad === 'organ' ? 0.06 : 0.045,
            song.pad === 'organ' ? 'sawtooth' : 'sine', musGain, song.pad === 'organ' ? 900 : 1400);
        }
      }
      // brass swells
      if (song.brass) {
        const f = chordRoot * (song.brass === 'low' ? 1 : 2);
        this.tone(f, t0 + (barIdx % 2 ? beat * 2 : 0), beat * 1.6, 0.09, 'sawtooth', musGain, 1100);
      }
      // harp / bells / flute — melodic sprinkle (deterministic per bar)
      const mel = song.harp || song.bells || song.flute;
      if (mel) {
        const rngLocal = (n) => { const x = Math.sin(barIdx * 91.7 + n * 47.3) * 10000; return x - Math.floor(x); };
        for (let i = 0; i < 4; i++) {
          if (rngLocal(i) < 0.62) {
            const deg = Math.floor(rngLocal(i + 10) * 6);
            const oct = song.bells ? 4 : 2;
            const f = st(chordRoot * oct, scale[deg]);
            const dur = song.flute ? beat * 0.9 : beat * 1.4;
            this.tone(f, t0 + i * beat + (rngLocal(i + 20) < 0.4 ? beat / 2 : 0), dur,
              song.bells ? 0.055 : 0.05, song.flute ? 'triangle' : 'sine');
          }
        }
      }
      // drums
      if (song.drums === 'war') {
        for (const b of [0, 1, 2, 2.5, 3]) this.thump(t0 + b * beat, b % 1 ? 0.12 : 0.22, 55);
      } else if (song.drums === 'anvil') {
        this.thump(t0, 0.22, 50); this.thump(t0 + 2 * beat, 0.2, 50);
        this.clank(t0 + beat, 0.1); this.clank(t0 + 3 * beat, 0.1);
      } else if (song.drums === 'toll' && barIdx % 2 === 0) {
        this.tone(st(song.root, -12), t0, beat * 3, 0.1, 'sine');
      } else if (song.drums === 'light') {
        this.thump(t0 + beat, 0.1, 90); this.thump(t0 + 3 * beat, 0.1, 90);
      }
    },
    ensureRunning() {
      if (!this.songKey || this.timer) return;
      const tick = () => {
        const song = SONGS[this.songKey];
        if (!song) return;
        const beat = 60 / song.bpm;
        const bar = beat * 4;
        while (this.nextBeat < actx.currentTime + 1.2) {
          if (song.once && this.beatIdx >= song.once) break;
          this.scheduleBar(song, this.beatIdx, Math.max(this.nextBeat, actx.currentTime + 0.05));
          this.nextBeat = Math.max(this.nextBeat, actx.currentTime + 0.05) + bar;
          this.beatIdx++;
        }
      };
      tick();
      this.timer = setInterval(tick, 400);
    },
    play(key) {
      if (this.songKey === key) return;
      this.songKey = key;
      this.beatIdx = 0;
      this.nextBeat = actx.currentTime + 0.1;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (unlocked) this.ensureRunning();
    },
  };

  return {
    actx, unlock, play, sfx,
    playMusic: (key) => music.play(key),
    setMusicVolume(v) { settings.music = v; musGain.gain.value = v; },
    setSfxVolume(v) { settings.sfx = v; sfxGain.gain.value = v; },
    get unlocked() { return unlocked; },
  };
}
