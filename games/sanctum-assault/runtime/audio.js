// Procedural Web Audio SFX for Sanctum Assault

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let unlocked = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    return ctx;
  }

  function unlock() {
    ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  }

  function tone({ type = 'sine', freq = 440, dur = 0.1, gain = 0.2, slide = 0, delay = 0 }) {
    if (muted || !unlocked) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.08, gain = 0.12, filterFreq = 1200 }) {
    if (muted || !unlocked) return;
    const c = ensure();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
  }

  return {
    unlock,
    setMuted(v) {
      muted = !!v;
    },
    play(name) {
      switch (name) {
        case 'hit':
          noise({ dur: 0.06, gain: 0.15, filterFreq: 1800 });
          tone({ type: 'square', freq: 180, dur: 0.07, gain: 0.1, slide: -80 });
          break;
        case 'crit':
          tone({ type: 'sawtooth', freq: 520, dur: 0.08, gain: 0.1 });
          tone({ type: 'square', freq: 780, dur: 0.1, gain: 0.08, delay: 0.04 });
          break;
        case 'swing':
          noise({ dur: 0.05, gain: 0.08, filterFreq: 900 });
          break;
        case 'shoot':
          tone({ type: 'triangle', freq: 880, dur: 0.06, gain: 0.08, slide: -400 });
          break;
        case 'magic':
          tone({ type: 'sine', freq: 440, dur: 0.12, gain: 0.1, slide: 220 });
          tone({ type: 'sine', freq: 660, dur: 0.14, gain: 0.06, delay: 0.03 });
          break;
        case 'explosion':
          noise({ dur: 0.2, gain: 0.22, filterFreq: 600 });
          tone({ type: 'sawtooth', freq: 120, dur: 0.18, gain: 0.12, slide: -60 });
          break;
        case 'shock':
          tone({ type: 'square', freq: 900, dur: 0.05, gain: 0.1 });
          tone({ type: 'square', freq: 1400, dur: 0.05, gain: 0.08, delay: 0.04 });
          tone({ type: 'square', freq: 600, dur: 0.08, gain: 0.07, delay: 0.08 });
          break;
        case 'block':
          tone({ type: 'triangle', freq: 300, dur: 0.08, gain: 0.1 });
          noise({ dur: 0.04, gain: 0.1, filterFreq: 2000 });
          break;
        case 'hurt':
          tone({ type: 'sawtooth', freq: 200, dur: 0.15, gain: 0.12, slide: -100 });
          break;
        case 'kill':
          tone({ type: 'square', freq: 360, dur: 0.08, gain: 0.1, slide: 200 });
          break;
        case 'wave':
          tone({ type: 'sine', freq: 392, dur: 0.15, gain: 0.12 });
          tone({ type: 'sine', freq: 523, dur: 0.18, gain: 0.1, delay: 0.12 });
          tone({ type: 'sine', freq: 659, dur: 0.25, gain: 0.1, delay: 0.24 });
          break;
        case 'victory':
          tone({ type: 'sine', freq: 523, dur: 0.15, gain: 0.12 });
          tone({ type: 'sine', freq: 659, dur: 0.15, gain: 0.12, delay: 0.14 });
          tone({ type: 'sine', freq: 784, dur: 0.15, gain: 0.12, delay: 0.28 });
          tone({ type: 'sine', freq: 1046, dur: 0.35, gain: 0.14, delay: 0.42 });
          break;
        case 'gameover':
          tone({ type: 'sawtooth', freq: 300, dur: 0.25, gain: 0.12, slide: -180 });
          tone({ type: 'triangle', freq: 180, dur: 0.4, gain: 0.1, delay: 0.2 });
          break;
        case 'ui':
          tone({ type: 'sine', freq: 660, dur: 0.06, gain: 0.06 });
          break;
        case 'combo':
          tone({ type: 'square', freq: 700 + Math.random() * 200, dur: 0.07, gain: 0.07 });
          break;
        case 'mode':
          tone({ type: 'triangle', freq: 480, dur: 0.08, gain: 0.08 });
          tone({ type: 'triangle', freq: 620, dur: 0.08, gain: 0.06, delay: 0.05 });
          break;
        default:
          break;
      }
    },
  };
}
