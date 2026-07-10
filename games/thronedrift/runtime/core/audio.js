// Thronedrift — procedural WebAudio SFX manager.
// No audio files needed; every cue is synthesized. game_controls.js global mute
// works because we route everything through one master GainNode on a shared ctx.

let ctx = null, master = null, desiredVol = 0.5;
function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = desiredVol; master.connect(ctx.destination);
    window.__THRONEDRIFT_AUDIO__ = ctx; // discoverable for mute integrations
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone({ freq = 440, type = "sine", dur = 0.15, vol = 0.3, slide = 0, delay = 0, attack = 0.005 }) {
  const c = ensure(); const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.25, freq = 1000, q = 1, slide = 0, delay = 0 }) {
  const c = ensure(); const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

const cues = {
  ui:        () => tone({ freq: 660, type: "triangle", dur: 0.08, vol: 0.2 }),
  ui_big:    () => { tone({ freq: 520, type: "triangle", dur: 0.1, vol: 0.25 }); tone({ freq: 780, type: "triangle", dur: 0.12, vol: 0.22, delay: 0.07 }); },
  swing:     () => noise({ dur: 0.12, vol: 0.16, freq: 900, q: 0.8, slide: -500 }),
  swing_big: () => noise({ dur: 0.22, vol: 0.24, freq: 500, q: 0.7, slide: -320 }),
  hit:       () => { noise({ dur: 0.08, vol: 0.3, freq: 1800, q: 1.5 }); tone({ freq: 160, type: "square", dur: 0.07, vol: 0.18, slide: -60 }); },
  hit_heavy: () => { noise({ dur: 0.14, vol: 0.4, freq: 900, q: 1 }); tone({ freq: 90, type: "square", dur: 0.16, vol: 0.3, slide: -50 }); },
  shot:      () => { tone({ freq: 900, type: "sawtooth", dur: 0.07, vol: 0.12, slide: -400 }); noise({ dur: 0.05, vol: 0.1, freq: 2500, q: 2 }); },
  bolt:      () => tone({ freq: 620, type: "sawtooth", dur: 0.12, vol: 0.15, slide: 300 }),
  explode:   () => { noise({ dur: 0.45, vol: 0.5, freq: 300, q: 0.5, slide: -200 }); tone({ freq: 70, type: "sine", dur: 0.4, vol: 0.4, slide: -30 }); },
  slam:      () => { noise({ dur: 0.35, vol: 0.5, freq: 220, q: 0.6, slide: -150 }); tone({ freq: 55, type: "sine", dur: 0.45, vol: 0.5, slide: -20 }); },
  shock:     () => { for (let i = 0; i < 4; i++) tone({ freq: 1400 + Math.random() * 900, type: "square", dur: 0.03, vol: 0.14, delay: i * 0.035 }); },
  burn:      () => noise({ dur: 0.3, vol: 0.12, freq: 600, q: 0.4 }),
  frost:     () => { tone({ freq: 1900, type: "sine", dur: 0.2, vol: 0.14, slide: -900 }); noise({ dur: 0.16, vol: 0.08, freq: 4200, q: 3 }); },
  block:     () => { tone({ freq: 300, type: "square", dur: 0.06, vol: 0.25 }); noise({ dur: 0.07, vol: 0.22, freq: 2600, q: 4 }); },
  block_perfect: () => { tone({ freq: 500, type: "square", dur: 0.06, vol: 0.3 }); tone({ freq: 1000, type: "triangle", dur: 0.2, vol: 0.25, delay: 0.05 }); },
  mode:      () => { noise({ dur: 0.14, vol: 0.2, freq: 3000, q: 2, slide: -1500 }); tone({ freq: 240, type: "square", dur: 0.1, vol: 0.16, delay: 0.05 }); },
  hurt:      () => { tone({ freq: 200, type: "sawtooth", dur: 0.2, vol: 0.3, slide: -120 }); },
  death:     () => { tone({ freq: 300, type: "sawtooth", dur: 0.5, vol: 0.3, slide: -240 }); noise({ dur: 0.4, vol: 0.2, freq: 400, q: 0.6, slide: -300 }); },
  heal:      () => { tone({ freq: 620, type: "triangle", dur: 0.12, vol: 0.22 }); tone({ freq: 930, type: "triangle", dur: 0.18, vol: 0.2, delay: 0.09 }); },
  coin:      () => { tone({ freq: 1320, type: "triangle", dur: 0.07, vol: 0.15 }); tone({ freq: 1760, type: "triangle", dur: 0.12, vol: 0.13, delay: 0.06 }); },
  ward:      () => tone({ freq: 420, type: "sine", dur: 0.5, vol: 0.2, slide: 220 }),
  rain:      () => noise({ dur: 0.5, vol: 0.2, freq: 1200, q: 0.6, slide: 800 }),
  combo:     () => { tone({ freq: 880, type: "triangle", dur: 0.09, vol: 0.2 }); tone({ freq: 1174, type: "triangle", dur: 0.14, vol: 0.2, delay: 0.07 }); },
  wave_clear: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.28, vol: 0.24, delay: i * 0.11 })),
  victory:   () => [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.34, vol: 0.26, delay: i * 0.15 })),
  game_over: () => [392, 349, 311, 261].forEach((f, i) => tone({ freq: f, type: "sawtooth", dur: 0.4, vol: 0.2, delay: i * 0.22 })),
};

export const SFX = {
  play(name) { try { (cues[name] || (() => {}))(); } catch (e) { /* audio blocked pre-gesture; ignore */ } },
  unlock() { try { ensure(); } catch (e) {} },
  setVolume(v) { desiredVol = Math.max(0, Math.min(1, v)); if (master) master.gain.value = desiredVol; },
  getVolume() { return desiredVol; },
};
