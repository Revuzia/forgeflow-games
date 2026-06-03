/**
 * ffg_chessmusic.js — procedural CLASSICAL piano loop for Warboard Chess.
 *
 * No audio asset + no licensing: a gentle arpeggiated chord progression in D major
 * (a Pachelbel-Canon-style sequence) synthesized with Web Audio — soft triangle
 * "piano" voices through a low-pass, with attack/release envelopes, looped via a
 * look-ahead scheduler. Calm, classical, fitting for chess. start()/stop()/setVolume().
 * Everything is wrapped so a missing/blocked AudioContext never throws.
 */
export function createClassicalMusic(volume) {
  let ctx = null, master = null, timer = null, playing = false;
  let vol = volume != null ? volume : 0.16;
  // Canon-in-D-style progression (MIDI root triads): D A Bm F#m G D G A
  const PROG = [
    [62, 66, 69], [57, 61, 64], [59, 62, 66], [54, 57, 61],
    [55, 59, 62], [50, 54, 57], [55, 59, 62], [57, 61, 64],
  ];
  const bpm = 64, beat = 60 / bpm, bar = beat * 2; // two beats per chord
  let step = 0, nextTime = 0;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function voice(freq, t, dur, gain, type) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type || "triangle"; o.frequency.value = freq;
    lp.type = "lowpass"; lp.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.06);
  }

  function schedule() {
    if (!ctx) return;
    while (nextTime < ctx.currentTime + 0.5) {
      const ch = PROG[step % PROG.length];
      voice(hz(ch[0] - 12), nextTime, bar * 1.02, 0.11, "sine");          // soft bass root
      const arp = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2] + 12, ch[1] + 12]; // rolling arpeggio
      const sub = bar / arp.length;
      for (let i = 0; i < arp.length; i++) voice(hz(arp[i]), nextTime + i * sub, sub * 1.6, 0.05, "triangle");
      nextTime += bar; step++;
    }
  }

  return {
    start() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        // ALWAYS try to resume first — the deep-link auto-start runs with a suspended
        // context (no page gesture yet), and the gesture-arm re-calls start(); if we
        // bailed on `playing` before resuming, the context stayed suspended = silent.
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
      } catch (e) { return; }
      if (playing) return;
      try {
        master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
        nextTime = ctx.currentTime + 0.12; step = 0; playing = true;
        schedule(); timer = setInterval(schedule, 140);
      } catch (e) {}
    },
    stop() {
      playing = false; if (timer) clearInterval(timer); timer = null;
      try { if (master && ctx) { master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4); } } catch (e) {}
    },
    setVolume(v) { vol = v; try { if (master) master.gain.value = v; } catch (e) {} },
    isPlaying() { return playing; },
  };
}
