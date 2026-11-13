// Audio: streamed music (HTMLAudio) + WebAudio SFX (files + synthesized elements).
import { loadAudioBuffer } from './assets.js';

const SFX_FILES = {
  ui_click: 'assets/audio/sfx/ui_click.ogg',
  ui_back: 'assets/audio/sfx/ui_back.ogg',
  ui_confirm: 'assets/audio/sfx/ui_confirm.ogg',
  ui_error: 'assets/audio/sfx/ui_error.ogg',
  ui_select: 'assets/audio/sfx/ui_select.ogg',
  coins: 'assets/audio/sfx/coins.ogg',
  coins2: 'assets/audio/sfx/coins2.ogg',
  build: 'assets/audio/sfx/build.ogg',
  upgrade: 'assets/audio/sfx/upgrade.ogg',
  hit_soft: 'assets/audio/sfx/hit_soft.ogg',
  hit_punch: 'assets/audio/sfx/hit_punch.ogg',
  hit_metal: 'assets/audio/sfx/hit_metal.ogg',
  death_soft: 'assets/audio/sfx/death_soft.ogg',
  cannon: 'assets/audio/sfx/cannon.ogg',
  glass_shatter: 'assets/audio/sfx/glass_shatter.ogg',
  bell: 'assets/audio/sfx/bell.ogg',
  mining: 'assets/audio/sfx/mining.ogg',
  knife: 'assets/audio/sfx/knife.ogg',
  bong: 'assets/audio/sfx/bong.ogg',
  wood_light: 'assets/audio/sfx/wood_light.ogg',
};

export function createAudio(settings) {
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const sfxGain = actx.createGain();
  sfxGain.gain.value = settings.sfx;
  sfxGain.connect(actx.destination);

  const buffers = new Map();
  let unlocked = false;
  const lastPlay = new Map();

  async function preload() {
    await Promise.all(Object.entries(SFX_FILES).map(async ([k, url]) => {
      try { buffers.set(k, await loadAudioBuffer(actx, url)); } catch { /* missing sfx tolerated */ }
    }));
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    actx.resume?.();
    music.el.play().catch(() => {});
  }

  function play(name, { vol = 1, rate = 1, throttle = 60 } = {}) {
    if (!unlocked) return;
    const now = performance.now();
    if (lastPlay.has(name) && now - lastPlay.get(name) < throttle) return;
    lastPlay.set(name, now);
    const buf = buffers.get(name);
    if (!buf) return;
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = actx.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(sfxGain);
    src.start();
  }

  // ---------- synthesized elemental SFX ----------
  function env(g, a = 0.005, d = 0.18, peak = 1) {
    const t = actx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.001, t + a + d);
  }
  function noiseBuf(dur = 0.4) {
    const n = actx.sampleRate * dur;
    const b = actx.createBuffer(1, n, actx.sampleRate);
    const ch = b.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    return b;
  }
  const synth = {
    zap(vol = 0.5) {
      if (!unlocked) return;
      const o = actx.createOscillator(); o.type = 'sawtooth';
      const t = actx.currentTime;
      o.frequency.setValueAtTime(1600, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.16);
      const g = actx.createGain(); env(g, 0.004, 0.16, vol * 0.5);
      o.connect(g); g.connect(sfxGain);
      o.start(); o.stop(t + 0.2);
      const src = actx.createBufferSource(); src.buffer = noiseBuf(0.12);
      const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2400;
      const g2 = actx.createGain(); env(g2, 0.002, 0.1, vol * 0.35);
      src.connect(f); f.connect(g2); g2.connect(sfxGain);
      src.start();
    },
    whoosh(vol = 0.4) {
      if (!unlocked) return;
      const src = actx.createBufferSource(); src.buffer = noiseBuf(0.35);
      const f = actx.createBiquadFilter(); f.type = 'bandpass';
      const t = actx.currentTime;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(1600, t + 0.25);
      f.Q.value = 1.4;
      const g = actx.createGain(); env(g, 0.03, 0.3, vol);
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start();
    },
    freezePing(vol = 0.4) {
      if (!unlocked) return;
      const t = actx.currentTime;
      for (const [freq, delay] of [[2200, 0], [3300, 0.04], [2750, 0.08]]) {
        const o = actx.createOscillator(); o.type = 'sine';
        o.frequency.value = freq;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t + delay);
        g.gain.linearRampToValueAtTime(vol * 0.28, t + delay + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.22);
        o.connect(g); g.connect(sfxGain);
        o.start(t + delay); o.stop(t + delay + 0.25);
      }
    },
    bubble(vol = 0.35) {
      if (!unlocked) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(240, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.1);
      o.frequency.exponentialRampToValueAtTime(180, t + 0.22);
      const g = actx.createGain(); env(g, 0.01, 0.22, vol * 0.6);
      o.connect(g); g.connect(sfxGain);
      o.start(); o.stop(t + 0.26);
    },
    horn(vol = 0.5) {
      if (!unlocked) return;
      const t = actx.currentTime;
      for (const [f0, detune] of [[196, 0], [147, 4]]) {
        const o = actx.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = f0; o.detune.value = detune;
        const flt = actx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900;
        const g = actx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol * 0.35, t + 0.06);
        g.gain.setValueAtTime(vol * 0.35, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        o.connect(flt); flt.connect(g); g.connect(sfxGain);
        o.start(); o.stop(t + 1);
      }
    },
    // Creature death: pitch-dropping growl + thump. pitch <1 = big beast, >1 = small critter.
    deathGrunt(pitch = 1, vol = 0.5) {
      if (!unlocked) return;
      const t = actx.currentTime;
      // vocal component: descending saw through a falling lowpass
      const o = actx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(260 * pitch, t);
      o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.28);
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(900 * pitch, t);
      f.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.3);
      const g = actx.createGain(); env(g, 0.008, 0.3, vol * 0.5);
      o.connect(f); f.connect(g); g.connect(sfxGain);
      o.start(); o.stop(t + 0.34);
      // body thump
      const o2 = actx.createOscillator(); o2.type = 'sine';
      o2.frequency.setValueAtTime(120 * Math.min(pitch, 1), t + 0.02);
      o2.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      const g2 = actx.createGain(); env(g2, 0.005, 0.2, vol * 0.55);
      o2.connect(g2); g2.connect(sfxGain);
      o2.start(t + 0.02); o2.stop(t + 0.24);
      // breathy noise tail
      const src = actx.createBufferSource(); src.buffer = noiseBuf(0.22);
      const nf = actx.createBiquadFilter(); nf.type = 'bandpass';
      nf.frequency.value = 500 * pitch; nf.Q.value = 1.2;
      const g3 = actx.createGain(); env(g3, 0.01, 0.2, vol * 0.22);
      src.connect(nf); nf.connect(g3); g3.connect(sfxGain);
      src.start(t + 0.03);
    },
    roar(vol = 0.55) {
      if (!unlocked) return;
      const src = actx.createBufferSource(); src.buffer = noiseBuf(0.9);
      const f = actx.createBiquadFilter(); f.type = 'lowpass';
      const t = actx.currentTime;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(90, t + 0.8);
      f.Q.value = 2.5;
      const g = actx.createGain(); env(g, 0.05, 0.85, vol);
      const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = 55;
      const og = actx.createGain(); env(og, 0.05, 0.8, vol * 0.3);
      src.connect(f); f.connect(g); g.connect(sfxGain);
      o.connect(og); og.connect(sfxGain);
      src.start(); o.start(); o.stop(t + 0.9);
    },
  };

  // ---------- music ----------
  const music = {
    el: new Audio(),
    current: null,
    fadeTimer: null,
  };
  music.el.loop = true;
  music.el.volume = settings.music;

  function playMusic(track) { // 'menu' | biome ids | 'victory' | 'defeat'
    const url = `assets/audio/music/${track}.mp3`;
    if (music.current === url) return;
    music.current = url;
    clearInterval(music.fadeTimer);
    const target = settings.music;
    const el = music.el;
    // quick fade out, swap, fade in
    let v = el.volume;
    music.fadeTimer = setInterval(() => {
      v -= 0.1;
      if (v <= 0) {
        clearInterval(music.fadeTimer);
        el.src = url;
        el.loop = track !== 'victory' && track !== 'defeat';
        el.volume = 0;
        if (unlocked) el.play().catch(() => {});
        let v2 = 0;
        music.fadeTimer = setInterval(() => {
          v2 += 0.08;
          if (v2 >= target) { el.volume = target; clearInterval(music.fadeTimer); }
          else el.volume = v2;
        }, 60);
      } else el.volume = Math.max(0, v);
    }, 50);
  }

  return {
    actx, preload, unlock, play, synth, playMusic,
    setMusicVolume(v) { settings.music = v; music.el.volume = v; },
    setSfxVolume(v) { settings.sfx = v; sfxGain.gain.value = v; },
    get unlocked() { return unlocked; },
  };
}
