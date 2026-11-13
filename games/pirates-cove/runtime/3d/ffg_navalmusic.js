/**
 * ffg_navalmusic.js — procedural OPEN-OCEAN ambient loop for Tide Breakers.
 *
 * No audio asset, no licensing, and UNIQUE across the studio (never duplicate music).
 * Style: calm, airy naval ambient — slow swelling sine "pad" chords with a sparse,
 * bright glockenspiel motif drifting on top, in a lydian/pentatonic colour so it
 * reads as open sea, NOT piano. Web Audio only, look-ahead scheduler.
 * start()/stop()/setVolume()/isPlaying(). Every value is finite-guarded and the
 * scheduler is wrapped, so a missing/blocked AudioContext or odd timing never throws.
 */
export function createNavalMusic(volume) {
  let ctx = null, master = null, timer = null, playing = false;
  let vol = volume != null ? volume : 0.15;
  // Slow chord bed (MIDI roots) — D-major / lydian colour, all open voicings.
  const PADS = [
    [50, 57, 62, 66],   // D
    [55, 62, 66, 69],   // G
    [57, 64, 69, 73],   // A
    [59, 66, 69, 74],   // Bm
  ];
  // Bright motif from a D-lydian pentatonic (high register).
  const MOTIF = [74, 76, 78, 81, 83, 86];
  const bpm = 50, beat = 60 / bpm, bar = beat * 4; // one pad chord per bar
  let step = 0, nextTime = 0;
  const fin = (v, d) => (Number.isFinite(v) && v > -1e6 && v < 1e6) ? v : d; // hard finite clamp
  const hz = (m) => fin(440 * Math.pow(2, (m - 69) / 12), 220);

  // a soft sine "pad" voice with a slow swell, through a gentle lowpass.
  function pad(freq, t, dur, gain) {
    freq = fin(freq, 220); dur = fin(dur, 4); gain = fin(gain, 0.06); t = fin(t, ctx.currentTime);
    if (gain <= 0) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "sine"; o.frequency.value = freq;
    lp.type = "lowpass"; lp.frequency.value = 1400;
    g.gain.setValueAtTime(0.0008, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);       // swell in
    g.gain.linearRampToValueAtTime(gain * 0.7, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0008, t + dur);           // ebb out (linear — never exp-from/to 0)
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.1);
  }
  // a bright, quick glockenspiel "ping" (two detuned triangles + fast decay).
  function ping(freq, t, gain) {
    freq = fin(freq, 880); gain = fin(gain, 0.04); t = fin(t, ctx.currentTime);
    if (gain <= 0) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0006, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.linearRampToValueAtTime(0.0004, t + 1.4);           // decay (linear — safe)
    [0, 7].forEach((cents, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = fin(freq * (1 + cents / 1200) * (i ? 2 : 1), 880);
      o.connect(g); o.start(t); o.stop(t + 1.5);
    });
    g.connect(master);
  }

  function schedule() {
    if (!ctx || !master) return;
    try {
      while (nextTime < ctx.currentTime + 1.0) {
        const ch = PADS[step % PADS.length];
        ch.forEach((m, i) => pad(hz(m - (i === 0 ? 12 : 0)), nextTime, bar * 1.04, i === 0 ? 0.10 : 0.055));
        // sparse, drifting motif (deterministic, no timing-coupled Math.random)
        const seed = (step * 2654435761) >>> 0;
        ping(hz(MOTIF[seed % MOTIF.length]), nextTime + beat, 0.05);
        if ((seed >> 16) % 3 !== 0) ping(hz(MOTIF[(seed >> 8) % MOTIF.length]), nextTime + beat * 2.5, 0.04);
        nextTime += bar; step++;
        if (step > 1e6) step = 0; // never let step grow unbounded
      }
    } catch (e) { /* never spam — drop a tick rather than throw */ }
  }

  return {
    start() {
      if (playing) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
        master = ctx.createGain(); master.gain.value = fin(vol, 0.15); master.connect(ctx.destination);
        nextTime = fin(ctx.currentTime, 0) + 0.15; step = 0; playing = true;
        schedule(); timer = setInterval(schedule, 240);
      } catch (e) {}
    },
    stop() {
      playing = false; if (timer) clearInterval(timer); timer = null;
      try { if (master && ctx) master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5); } catch (e) {}
    },
    setVolume(v) { vol = fin(v, vol); try { if (master) master.gain.value = vol; } catch (e) {} },
    isPlaying() { return playing; },
  };
}
