/**
 * ffg_navalmusic.js — procedural OPEN-OCEAN ambient loop for Tide Breakers.
 *
 * No audio asset, no licensing, and guaranteed UNIQUE across the studio (the other
 * games use a different file or their own procedural loop — never duplicate music).
 * Style: calm, airy naval ambient — slow swelling sine "pad" chords (a wave-like
 * LFO breathing under them) with a sparse, bright glockenspiel motif drifting on
 * top, in a lydian/pentatonic colour so it reads as open sea rather than piano.
 * Web Audio only, look-ahead scheduler, start()/stop()/setVolume()/isPlaying().
 * Everything is wrapped so a missing/blocked AudioContext never throws.
 */
export function createNavalMusic(volume) {
  let ctx = null, master = null, padBus = null, lfo = null, lfoGain = null, timer = null, playing = false;
  let vol = volume != null ? volume : 0.15;
  // Slow chord bed (MIDI roots) — Dmaj add-lydian flavour: D, G, A, Bm, all open.
  const PADS = [
    [50, 57, 62, 66],   // D   (D A D F#)
    [55, 62, 66, 69],   // G   (G D F# A)
    [57, 64, 69, 73],   // A   (A E A C#)
    [59, 66, 69, 74],   // Bm  (B F# A D)
  ];
  // Bright motif notes drift from a D-lydian pentatonic (D E F# A B), high register.
  const MOTIF = [74, 76, 78, 81, 83, 86];
  const bpm = 50, beat = 60 / bpm, bar = beat * 4; // one pad chord per bar
  let step = 0, nextTime = 0;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // a soft, slow-attack sine "pad" voice through a gentle lowpass
  function pad(freq, t, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "sine"; o.frequency.value = freq;
    lp.type = "lowpass"; lp.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);     // slow swell in
    g.gain.linearRampToValueAtTime(gain * 0.7, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);     // ebb out
    o.connect(lp); lp.connect(g); g.connect(padBus);
    o.start(t); o.stop(t + dur + 0.1);
  }
  // a bright, quick glockenspiel "ping" (two detuned triangles + fast decay)
  function ping(freq, t, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 1.4);
    [0, 7].forEach((cents, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = freq * (1 + cents / 1200) * (i ? 2 : 1);
      o.connect(g); o.start(t); o.stop(t + 1.5);
    });
    g.connect(master);
  }

  function schedule() {
    if (!ctx) return;
    while (nextTime < ctx.currentTime + 1.0) {
      const ch = PADS[step % PADS.length];
      ch.forEach((m, i) => pad(hz(m - (i === 0 ? 12 : 0)), nextTime, bar * 1.04, i === 0 ? 0.10 : 0.055));
      // sparse motif: a couple of pings per bar, never on every beat (drifting feel)
      const seed = (step * 2654435761) >>> 0;        // deterministic, no Math.random dependence on timing
      const a = MOTIF[seed % MOTIF.length];
      const b = MOTIF[(seed >> 8) % MOTIF.length];
      ping(hz(a), nextTime + beat * 1.0, 0.05);
      if ((seed >> 16) % 3 !== 0) ping(hz(b), nextTime + beat * 2.5, 0.04);
      nextTime += bar; step++;
    }
  }

  return {
    start() {
      if (playing) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
        master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
        // pad bus with a slow "wave" tremolo so the bed breathes like swell
        padBus = ctx.createGain(); padBus.gain.value = 1; padBus.connect(master);
        lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.07; // ~14s breath
        lfoGain = ctx.createGain(); lfoGain.gain.value = 0.18;
        lfo.connect(lfoGain); lfoGain.connect(padBus.gain); lfo.start();
        nextTime = ctx.currentTime + 0.15; step = 0; playing = true;
        schedule(); timer = setInterval(schedule, 240);
      } catch (e) {}
    },
    stop() {
      playing = false; if (timer) clearInterval(timer); timer = null;
      try { if (lfo) lfo.stop(); } catch (e) {}
      try { if (master && ctx) master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5); } catch (e) {}
    },
    setVolume(v) { vol = v; try { if (master) master.gain.value = v; } catch (e) {} },
    isPlaying() { return playing; },
  };
}
