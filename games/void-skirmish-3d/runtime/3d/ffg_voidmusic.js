/**
 * ffg_voidmusic.js — procedural DARK MILITARISTIC SCI-FI loop for Void Skirmish.
 *
 * No audio asset + no licensing: a tense XCOM-style tactical underscore synthesized
 * with Web Audio — NOT the chess classical piano. Three layers, all generated live:
 *   1) a LOW DRONING PAD: two detuned saw voices a fifth apart through a slow
 *      low-pass sweep (the ever-present sub-bass dread bed).
 *   2) a SLOW MINOR-KEY OSTINATO: a brooding 8-step cell in C minor on a hard
 *      square "synth-brass" voice, low register, marcato — the militaristic pulse.
 *   3) a SPARSE PERCUSSIVE PULSE: a filtered-noise war-drum hit on the down-beats
 *      plus an occasional metallic tick, leaving lots of negative space (tension).
 * Look-ahead scheduler, start()/stop()/setVolume()/isPlaying(). Everything is
 * wrapped so a missing/blocked AudioContext never throws. Default volume ~0.14.
 *
 * Tonally distinct from createClassicalMusic (D-major triangle arpeggio): this is
 * minor-key, saw/square + noise, slow, low, and ominous — guaranteed unique audio.
 */
export function createTacticalMusic(volume) {
  let ctx = null, master = null, padBus = null, timer = null, playing = false;
  let vol = volume != null ? volume : 0.14;
  let noiseBuf = null;

  // C natural-minor — a low, brooding ostinato cell (MIDI). Roots in the C2/C3
  // octave so it sits UNDER the action as dread, not melody. 8 steps, marcato.
  // C  Eb  G  C  Ab  G  Eb  D   (i → bVI → v feel, no resolution = tension)
  const OSTINATO = [48, 51, 55, 48, 56, 55, 51, 50];
  // Drone = a slow-moving open fifth (C1 + G1), the sub-bass war bed.
  const DRONE = [24, 31];
  // Pad chord cycle (whole-bar) under the ostinato — minor, claustrophobic:
  // Cm, Abmaj (bVI), Fm (iv), G (V, no third = ambiguous power chord).
  const PAD_CHORDS = [[48, 51, 55], [44, 48, 51], [41, 44, 48], [43, 50, 55]];

  const bpm = 76, beat = 60 / bpm;         // brisk-but-heavy tactical pulse
  const stepDur = beat / 2;                // ostinato runs in eighths
  const barSteps = 8;                      // 8 eighths per bar (one ostinato cell)
  let step = 0, nextTime = 0;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function ensureNoise() {
    if (noiseBuf || !ctx) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // A sustained pad/drone voice: detuned oscillator pair through a gentle low-pass,
  // long attack + release so it breathes under everything. Routed to padBus.
  function pad(freq, t, dur, gain, type, detune) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o1.type = o2.type = type || "sawtooth";
    o1.frequency.value = freq; o2.frequency.value = freq;
    o2.detune.value = detune != null ? detune : 7;          // chorused thickness
    lp.type = "lowpass"; lp.frequency.value = 540; lp.Q.value = 0.7; // keep it dark/muffled
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);    // slow swell
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);    // slow fade
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(padBus);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  // The ostinato "synth-brass" stab: a hard square through a band-ish low-pass with
  // a short, punchy envelope — marcato, militaristic. Routed to master.
  function stab(freq, t, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = "square"; o.frequency.value = freq;
    lp.type = "lowpass"; lp.frequency.value = 1300; lp.Q.value = 4;  // nasal brass bite
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);         // sharp attack
    g.gain.exponentialRampToValueAtTime(gain * 0.4, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // War-drum hit: a short burst of filtered noise + a thudding sine pitch-drop.
  // `bright` swaps the noise filter to a high tick (the sparse metallic accent).
  function drum(t, gain, bright) {
    ensureNoise();
    if (noiseBuf) {
      const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      src.buffer = noiseBuf;
      f.type = bright ? "highpass" : "bandpass";
      f.frequency.value = bright ? 4200 : 220; f.Q.value = bright ? 0.8 : 1.2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t + (bright ? 0.07 : 0.16));
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.2);
    }
    if (!bright) { // body thump only on the deep hits
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.14);
      g.gain.setValueAtTime(gain * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.18);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.22);
    }
  }

  function schedule() {
    if (!ctx) return;
    while (nextTime < ctx.currentTime + 0.6) {
      const inBar = step % barSteps;
      const bar = Math.floor(step / barSteps);
      // ── DRONE + PAD: refreshed at the top of each bar (whole-bar sustains) ──
      if (inBar === 0) {
        const barDur = stepDur * barSteps;
        // open-fifth drone bed
        pad(hz(DRONE[0]), nextTime, barDur * 1.04, 0.10, "sawtooth", 5);
        pad(hz(DRONE[1]), nextTime, barDur * 1.04, 0.06, "sawtooth", -6);
        // brooding minor pad chord (cycles every 4 bars)
        const chord = PAD_CHORDS[bar % PAD_CHORDS.length];
        for (let i = 0; i < chord.length; i++) pad(hz(chord[i]), nextTime, barDur * 1.02, 0.045, "sawtooth", (i - 1) * 6);
      }
      // ── OSTINATO: the low minor cell, one note per eighth, accent the down-beat ──
      const note = OSTINATO[inBar % OSTINATO.length];
      const accent = (inBar === 0 || inBar === 4);
      // leave a little space: skip step 3 & 7 on alternating bars for a "breathing" line
      const rest = ((inBar === 3 || inBar === 7) && (bar % 2 === 1));
      if (!rest) stab(hz(note), nextTime, stepDur * (accent ? 1.5 : 0.9), accent ? 0.085 : 0.05);
      // ── PERCUSSION: sparse. Deep war-drum on beats 1 & 3; metallic tick on the
      //    off-beat of beat 4 only every other bar (negative space = tension). ──
      if (inBar === 0) drum(nextTime, 0.16, false);
      else if (inBar === 4) drum(nextTime, 0.12, false);
      else if (inBar === 6 && (bar % 2 === 0)) drum(nextTime, 0.06, true);

      nextTime += stepDur; step++;
    }
  }

  return {
    start() {
      if (playing) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
        master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
        // pad bus a touch quieter so the drone never masks the ostinato/drums
        padBus = ctx.createGain(); padBus.gain.value = 0.9; padBus.connect(master);
        ensureNoise();
        nextTime = ctx.currentTime + 0.14; step = 0; playing = true;
        schedule(); timer = setInterval(schedule, 150);
      } catch (e) {}
    },
    stop() {
      playing = false; if (timer) clearInterval(timer); timer = null;
      try { if (master && ctx) { master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.5); } } catch (e) {}
    },
    setVolume(v) { vol = v; try { if (master) master.gain.value = v; } catch (e) {} },
    isPlaying() { return playing; },
  };
}
