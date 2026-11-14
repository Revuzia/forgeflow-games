// Colosseum — synthesised audio: the cornu, and the crowd.
//
// These two are SYNTHESISED rather than sourced because a regex over all 6,481
// audio files on the F: drive found exactly zero of either. That is not a
// compromise in either case:
//
//   THE CORNU is a conical-bore G-horn with essentially no valve articulation —
//   a stack of sawtooth partials through a formant filter reproduces it closely,
//   and general SFX libraries do not carry ancient instruments at all.
//
//   THE CROWD has to REACT. A recording of 50,000 people is a fixed thing; this
//   crowd hushes when the gate grinds, swells as a fighter presses, and breaks
//   on a kill. A granular bed driven by the same excitement value that drives
//   the visual crowd keeps sight and sound in lockstep by construction.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// The cornu
// ---------------------------------------------------------------------------

/** The signals a Roman arena actually used, as scale degrees over a root. */
export const CALLS = {
  // Long, rising, ceremonial — the gates are opening.
  fanfare: { notes: [0, 0, 7, 7, 12], durs: [0.55, 0.28, 0.75, 0.3, 1.5], gap: 0.06 },
  // Short and flat — begin.
  begin: { notes: [7, 7, 12], durs: [0.3, 0.3, 1.1], gap: 0.05 },
  // Three rising calls — a fresh fighter enters.
  tertiarius: { notes: [0, 5, 9, 12], durs: [0.34, 0.34, 0.34, 1.2], gap: 0.05 },
  // Two low blasts — another wave.
  wave: { notes: [0, 0], durs: [0.7, 1.0], gap: 0.12 },
  // Falling, sombre — a man is dead.
  death: { notes: [12, 7, 3, 0], durs: [0.5, 0.5, 0.55, 2.0], gap: 0.04 },
  // Rising triumph.
  victory: { notes: [0, 4, 7, 12, 12], durs: [0.3, 0.3, 0.3, 0.5, 1.6], gap: 0.04 },
};

/**
 * One cornu note.
 *
 * Built from 7 sawtooth-ish partials with amplitude falling as ~1/n, which is
 * what gives brass its bite, then rolled off at ~2.4 kHz so it reads as a wide
 * conical bore rather than a trumpet. Vibrato deliberately arrives ~250 ms in —
 * a real player does not vibrate the front of the note, and starting it
 * immediately is the single thing that makes synth brass sound fake.
 */
function cornuNote(ctx, dest, freq, t0, dur, gain = 0.5) {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t0);
  // The filter opening is the "blat" at the front of a brass attack.
  lp.frequency.linearRampToValueAtTime(2400, t0 + 0.09);
  lp.frequency.linearRampToValueAtTime(1700, t0 + dur);
  lp.Q.value = 0.8;
  lp.connect(out);

  // A gentle formant bump around 1.1 kHz gives the horn its throat.
  const form = ctx.createBiquadFilter();
  form.type = "peaking";
  form.frequency.value = 1100;
  form.Q.value = 1.1;
  form.gain.value = 6;
  form.connect(lp);

  const vib = ctx.createOscillator();
  const vibAmt = ctx.createGain();
  vib.frequency.value = 5.2;
  vibAmt.gain.setValueAtTime(0, t0);
  vibAmt.gain.setValueAtTime(0, t0 + 0.25);          // no vibrato on the attack
  vibAmt.gain.linearRampToValueAtTime(freq * 0.006, t0 + Math.min(dur, 0.55));
  vib.connect(vibAmt);
  vib.start(t0);
  vib.stop(t0 + dur + 0.2);

  const oscs = [];
  for (let n = 1; n <= 7; n++) {
    const o = ctx.createOscillator();
    o.type = n === 1 ? "sawtooth" : "triangle";
    o.frequency.setValueAtTime(freq * n, t0);
    // Two horns a hair apart — Roman signals were played in pairs, and the
    // detune is most of the "big stone building" impression.
    o.detune.setValueAtTime(n === 1 ? 0 : (n % 2 ? 5 : -5), t0);
    vibAmt.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = (1 / n) * 0.55;
    o.connect(g);
    g.connect(form);
    o.start(t0);
    o.stop(t0 + dur + 0.25);
    oscs.push(o);
  }

  // Brass envelope: fast but not instant attack, long body, natural release.
  const peak = gain;
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(peak, t0 + 0.055);
  out.gain.setValueAtTime(peak, t0 + dur * 0.72);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.18);

  return out;
}

/**
 * Sound a call. `root` defaults to G2 — the cornu was a big low horn.
 * @returns {number} seconds the call will take
 */
export function playCall(ctx, dest, callId, { root = 98, gain = 0.42, when = 0 } = {}) {
  const c = CALLS[callId] || CALLS.fanfare;
  let t = (when || ctx.currentTime) + 0.02;
  for (let i = 0; i < c.notes.length; i++) {
    const f = root * Math.pow(2, c.notes[i] / 12);
    cornuNote(ctx, dest, f, t, c.durs[i], gain);
    t += c.durs[i] + c.gap;
  }
  return t - ctx.currentTime;
}

// ---------------------------------------------------------------------------
// The crowd
// ---------------------------------------------------------------------------

/**
 * A living crowd bed.
 *
 * Construction: filtered pink-ish noise for the murmur of thousands, three
 * parallel band-passes at roughly the formant regions of massed human voice
 * (300 / 900 / 2500 Hz), each gain-modulated independently so the texture
 * breathes instead of hissing. Excitement opens the upper bands and lifts the
 * whole bed; a roar is a fast envelope on top of it.
 *
 * Deliberately driven by the SAME excitement value as the visual crowd, so what
 * you hear and what you see cannot drift apart.
 */
export class CrowdVoice {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    // --- the noise bed ---------------------------------------------------
    const len = Math.floor(ctx.sampleRate * 4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pink-ish noise via a cheap running-sum filter — white noise alone reads
    // as radio static, not people.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.src = ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;

    this.bands = [];
    for (const [freq, q, g] of [[300, 0.9, 0.55], [900, 1.2, 0.40], [2500, 1.6, 0.16]]) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = g;
      this.src.connect(f);
      f.connect(gain);
      gain.connect(this.out);
      this.bands.push({ f, gain, base: g });
    }
    this.src.start();

    // A slow wobble on the mid band keeps the bed from sounding static.
    this.lfo = ctx.createOscillator();
    this.lfoAmt = ctx.createGain();
    this.lfo.frequency.value = 0.13;
    this.lfoAmt.gain.value = 0.06;
    this.lfo.connect(this.lfoAmt);
    this.lfoAmt.connect(this.bands[1].gain.gain);
    this.lfo.start();

    this.level = 0;
  }

  /** Fade the bed in over `s` seconds. */
  start(s = 2.0) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.22, t + s);
  }

  stop(s = 1.2) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + s);
  }

  /**
   * Track the visual crowd's excitement, 0..1. Higher excitement lifts the bed
   * and opens the bright band, which is what "thousands of people getting
   * louder AND shriller" actually is.
   */
  setExcitement(v) {
    const t = this.ctx.currentTime;
    const e = Math.max(0, Math.min(1, v));
    this.level = e;
    this.out.gain.setTargetAtTime(0.16 + e * 0.34, t, 0.5);
    this.bands[2].gain.gain.setTargetAtTime(this.bands[2].base + e * 0.42, t, 0.4);
    this.bands[1].gain.gain.setTargetAtTime(this.bands[1].base + e * 0.22, t, 0.4);
  }

  /**
   * A surge on top of the bed — a hit landing, a kill, a gate opening.
   * @param {number} strength 0..1
   * @param {number} attack seconds to peak (a gasp is slow, a roar is fast)
   */
  surge(strength = 1, attack = 0.18) {
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    const peak = Math.min(0.85, 0.2 + strength * 0.55);
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setTargetAtTime(0.16 + this.level * 0.34, t + attack + 0.15, 0.9);

    // Open the bright band with the surge so the roar has edge.
    const hi = this.bands[2].gain.gain;
    hi.cancelScheduledValues(t);
    hi.setValueAtTime(hi.value, t);
    hi.linearRampToValueAtTime(this.bands[2].base + strength * 0.9, t + attack);
    hi.setTargetAtTime(this.bands[2].base + this.level * 0.42, t + attack + 0.2, 0.8);
  }

  /**
   * The hush before something big — the mob dropping to a murmur is far more
   * dramatic than any noise you can add.
   */
  hush(depth = 0.75, hold = 0.8) {
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.16 * (1 - depth), t + 0.35);
    g.setTargetAtTime(0.16 + this.level * 0.34, t + 0.35 + hold, 0.7);
  }

  dispose() {
    try { this.src.stop(); this.lfo.stop(); } catch (e) { /* already stopped */ }
    this.out.disconnect();
  }
}
