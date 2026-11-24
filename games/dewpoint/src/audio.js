/* DEWPOINT - procedural audio (Web Audio API only).
 *
 * Every sound is synthesised at runtime: oscillators, noise buffers generated in
 * code, filters, envelopes, a delay and convolvers fed with generated impulses.
 * No samples, no network, no libraries.
 *
 * Public contract (DESIGN.md "Audio API"): the exported `audio` object has
 *   init(), setMuted(b), setVolume(music, sfx), playSfx(name, {intensity, pan}),
 *   setForm(form), setMusic(mood), suspend(), resume()
 * plus, from DESIGN-ELEMENTS.md, setElement(el) with el in 'water'|'fire'|'clay' (default
 * 'water'). The element picks the form family that setForm() accepts (water: liquid/ice/
 * steam/film, fire: ember/blaze/smoke/spark, clay: clay/slip/stone/dust), the looping layer
 * for each, and the colour of the generative music. Call setElement() before setForm();
 * a form name that belongs to another element is ignored. Changing element moves the form to
 * the new element's default (liquid / ember / clay) unless the form was off (null).
 * With element 'water' the output is exactly what it was before elements existed.
 * All of them are safe to call at any time (before init, repeatedly, with unknown
 * names, with no AudioContext at all) and never throw.
 *
 * Extras that are not part of the contract (harmless to ignore):
 *   audio.getState()  - plain snapshot of what is remembered / running
 *   audio._pump()     - run the scheduler once now (test hook)
 *   audio._debug()    - internal state (test hook)
 *   createAudio(opts) - factory, used by tests to inject a fake AudioContext
 *
 * Architecture
 *   sfx voices ---> sfxBus --+
 *   ambience  ----> sfxBus   +--> master -> compressor -> limiter -> muteGain -> destination
 *   music runs --> musicBus -+
 *   (sfxRev / musicRev are convolver reverbs that return into their own bus, so the
 *    volume and mute of a bus also silences its reverb tail)
 *
 * Music is scheduled on the audio clock with a lookahead pump (setTimeout is only
 * used to wake the pump; note onsets are computed in audio time and accumulate
 * without drift).
 */

// ---------------------------------------------------------------------------
// Names / constants
// ---------------------------------------------------------------------------

// DESIGN.md "Audio API" list (unchanged, same order) ...
export const SFX_NAMES_BASE = Object.freeze([
  'jump', 'land', 'splash', 'freeze', 'melt', 'vaporize', 'condense', 'flatten', 'unflatten',
  'plate_down', 'plate_up', 'door_open', 'door_close', 'fan', 'pane_crack', 'pane_smash',
  'crate_push', 'ember_douse', 'sprout_grow', 'spark', 'checkpoint', 'shard', 'respawn',
  'level_complete', 'ui_tap', 'ui_back', 'denied',
]);
// ... plus DESIGN-ELEMENTS.md "Audio" additions (same order as that file)
export const SFX_NAMES_NEW = Object.freeze([
  'ignite', 'flare', 'smoke_puff', 'spark_zip', 'wire_ride', 'fuse_burn', 'wood_burn', 'ice_melt',
  'wax_melt', 'gas_blast', 'extinguish', 'coal', 'squish', 'slip_pour', 'fire_harden', 'shell_shed',
  'shell_crumble', 'dust_puff', 'soak', 'mould_cast', 'piston', 'wheel_spin', 'climb_stick',
]);
export const SFX_NAMES = Object.freeze([...SFX_NAMES_BASE, ...SFX_NAMES_NEW]);
export const FORMS = Object.freeze(['liquid', 'ice', 'steam', 'film']);   // water's forms (kept for compatibility)
export const ELEMENTS = Object.freeze(['water', 'fire', 'clay']);
export const ELEMENT_FORMS = Object.freeze({
  water: FORMS,
  fire: Object.freeze(['ember', 'blaze', 'smoke', 'spark']),
  clay: Object.freeze(['clay', 'slip', 'stone', 'dust']),
});
export const MOODS = Object.freeze(['menu', 'calm', 'tense', 'win']);

const MAX_VOICES = 26;          // simultaneous SFX voices (ordinary)
const PRIORITY_EXTRA = 8;       // extra headroom for important sounds
const LOOKAHEAD = 1.2;          // seconds of music scheduled ahead of the clock
const PUMP_MS = 80;             // scheduler wake interval
const SFX_BASE = 0.8;           // bus gain at user volume 1
const MUSIC_BASE = 0.85;
const FORM_FADE_TC = 0.28;      // time constant of the ambience crossfade

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const fin = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Slider position (0..1) to linear gain. Squared taper feels closer to loudness. */
export function volumeToGain(v) {
  const x = clamp(fin(v, 0), 0, 1);
  return x * x;
}

// ---------------------------------------------------------------------------
// Low-level node helpers (shared by sfx, ambience and music)
// ---------------------------------------------------------------------------

/** percussive envelope: ~0 -> peak (linear, atk) -> ~0 (exponential, by t0+dur) */
function env(p, t0, peak, atk, dur, hold) {
  peak = Math.max(peak, 0.0002);
  dur = Math.max(dur, atk + (hold || 0) + 0.01);
  p.setValueAtTime(0.0001, t0);
  p.linearRampToValueAtTime(peak, t0 + atk);
  if (hold > 0) p.setValueAtTime(peak, t0 + atk + hold);   // optional sustain (sustained hisses, rolls)
  p.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/**
 * A group owns a set of nodes that live and die together. Sources registered with
 * start() count down via onended; when the last one ends every node is disconnected,
 * so nothing leaks. kill() force-stops everything.
 */
function group(onDispose, now) {
  const g = {
    nodes: [], srcs: [], left: 0, dead: false, end: 0,
    add(n) { g.nodes.push(n); return n; },
    start(src, t0, t1, off) {
      g.nodes.push(src);
      g.srcs.push(src);
      g.left++;
      src.onended = () => { if (--g.left <= 0) g.dispose(); };
      try {
        if (off !== undefined) src.start(t0, off); else src.start(t0);
        if (t1 !== undefined) { src.stop(t1); if (t1 > g.end) g.end = t1; }
      } catch (e) {
        g.left--;
        src.onended = null;
        throw e;
      }
      return src;
    },
    stopAll(t) { for (const s of g.srcs) { try { s.stop(t); } catch (e) { /* not started / already stopped */ } } },
    dispose() {
      if (g.dead) return;
      g.dead = true;
      for (const n of g.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
      if (onDispose) onDispose(g);
    },
    kill() {
      if (g.dead) return;
      const t = now ? now() : 0;   // "now", not 0: 0 would mean the start of the timeline on an offline context
      for (const s of g.srcs) { try { s.stop(t); } catch (e) { /* ignore */ } }
      g.dispose();
    },
  };
  return g;
}

function mkOsc(c, g, type, f0, t0, dur, peak, to, o) {
  o = o || {};
  if (f0 > (c.sampleRate || 44100) * 0.45) return null;   // above Nyquist on low-rate devices: skip the partial
  const os = c.createOscillator();
  os.type = type;
  os.frequency.setValueAtTime(f0, t0);
  if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, t0 + (o.ft || dur));
  if (o.det) os.detune.setValueAtTime(o.det, t0);
  const ge = c.createGain();
  env(ge.gain, t0, peak, o.atk === undefined ? 0.004 : o.atk, dur, o.hold);
  os.connect(ge);
  ge.connect(to);
  g.add(ge);
  g.start(os, t0, t0 + dur + 0.04);
  return ge;
}

function mkNoise(c, nb, g, kind, t0, dur, peak, to, o, B) {
  o = o || {};
  const buf = nb[kind] || nb.white;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  let node = src;
  if (o.type) {
    const f = c.createBiquadFilter();
    f.type = o.type;
    const bb = o.nb ? 1 : B;
    f.frequency.setValueAtTime(clamp(o.f0 * bb, 20, 18000), t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(clamp(o.f1 * bb, 20, 18000), t0 + (o.ft || dur));
    f.Q.value = o.q || 1;
    src.connect(f);
    g.add(f);
    node = f;
  }
  const ge = c.createGain();
  env(ge.gain, t0, peak, o.atk === undefined ? 0.005 : o.atk, dur, o.hold);
  node.connect(ge);
  ge.connect(to);
  g.add(ge);
  g.start(src, t0, t0 + dur + 0.04, Math.random() * 1.5);
  return ge;
}

const BELL_RATIOS = [1, 2.76, 5.4, 8.93];
const BELL_GAINS = [1, 0.42, 0.18, 0.07];
const BELL_DECAY = [1, 0.55, 0.32, 0.2];

function mkBell(c, g, f, t0, dur, peak, to, ratios) {
  const r = ratios || BELL_RATIOS;
  for (let i = 0; i < r.length; i++) {
    const fr = f * r[i];
    if (fr > 15000 || fr > (c.sampleRate || 44100) * 0.45) break;
    mkOsc(c, g, 'sine', fr, t0, Math.max(0.05, dur * BELL_DECAY[i]), peak * BELL_GAINS[i], to, { atk: 0.003 });
  }
}

// Sources of noise (generated once) -----------------------------------------

function makeNoiseBuffer(c, kind, secs) {
  const sr = c.sampleRate || 44100;
  const n = Math.floor(sr * secs);
  const X = 1024;                       // crossfade so the loop point is seamless
  const gen = new Float32Array(n + X);
  if (kind === 'white') {
    for (let i = 0; i < gen.length; i++) gen[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {         // Paul Kellet's economy filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < gen.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      gen[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'crackle' || kind === 'grit') {
    // Sparse random bursts, each a few ms of decaying noise: 'crackle' = fire / wood / sparks
    // (~55 pops a second, uneven sizes), 'grit' = sand, dust and gravel (~650 tiny grains a
    // second). Own tiny PRNG so building these never shifts Math.random's sequence (the
    // water sounds draw from it, and must stay exactly as they were).
    let s = kind === 'crackle' ? 0x9e3779b1 : 0x85ebca6b;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const rate = kind === 'crackle' ? 55 : 650;
    const decay = Math.pow(kind === 'crackle' ? 0.986 : 0.93, 48000 / sr);
    const p = rate / sr;
    let e = 0, peak = 0;
    for (let i = 0; i < gen.length; i++) {
      if (r() < p) { const a = r(); e = Math.max(e, 0.15 + 0.85 * a * a); }
      gen[i] = e * (r() * 2 - 1);
      e *= decay;
      if (Math.abs(gen[i]) > peak) peak = Math.abs(gen[i]);
    }
    const k = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < gen.length; i++) gen[i] *= k;
  } else {                              // brown
    let last = 0;
    for (let i = 0; i < gen.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      gen[i] = last * 3.5;
    }
  }
  const buf = c.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    if (i < X) { const a = i / X; d[i] = gen[i] * a + gen[n + i] * (1 - a); } else d[i] = gen[i];
  }
  return buf;
}

function makeImpulse(c, secs, decay, dark) {
  const sr = c.sampleRate || 44100;
  const n = Math.floor(sr * secs);
  const buf = c.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / (n - pre);
      const coef = 0.92 - (0.92 - 0.07) * Math.pow(t, 0.5) * dark;
      lp += ((Math.random() * 2 - 1) - lp) * coef;
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// SFX recipes.  (V, t, I, p): voice helper, start time, intensity, pitch jitter.
// Peaks given here are for intensity 1; V multiplies them by the loudness factor and
// scales noise filter frequencies by the brightness factor.
// ---------------------------------------------------------------------------

const META = {
  // gap (s): minimum spacing of identical sfx. wet: reverb send. prio: may use the extra voice
  // headroom. trim: loudness balance, measured by offline-rendering each sfx at intensity 1
  // (target peak ~0.2-0.5 FS at default volumes) so the set sits evenly.
  jump:           { gap: 0.05, wet: 0.12, prio: 0, trim: 3.29 },
  land:           { gap: 0.06, wet: 0.10, prio: 0, trim: 3.43 },
  splash:         { gap: 0.06, wet: 0.25, prio: 0, trim: 2 },
  freeze:         { gap: 0.10, wet: 0.35, prio: 0, trim: 2.22 },
  melt:           { gap: 0.10, wet: 0.20, prio: 0, trim: 2.46 },
  vaporize:       { gap: 0.10, wet: 0.25, prio: 0, trim: 1.91 },
  condense:       { gap: 0.10, wet: 0.25, prio: 0, trim: 3.46 },
  flatten:        { gap: 0.08, wet: 0.10, prio: 0, trim: 5 },
  unflatten:      { gap: 0.08, wet: 0.10, prio: 0, trim: 2.27 },
  plate_down:     { gap: 0.08, wet: 0.15, prio: 0, trim: 2.92 },
  plate_up:       { gap: 0.08, wet: 0.12, prio: 0, trim: 4.19 },
  door_open:      { gap: 0.20, wet: 0.18, prio: 0, trim: 0.96 },
  door_close:     { gap: 0.20, wet: 0.18, prio: 0, trim: 0.84 },
  fan:            { gap: 0.25, wet: 0.08, prio: 0, trim: 3.86 },
  pane_crack:     { gap: 0.06, wet: 0.20, prio: 0, trim: 4.17 },
  pane_smash:     { gap: 0.08, wet: 0.40, prio: 1, trim: 3.54 },
  crate_push:     { gap: 0.12, wet: 0.05, prio: 0, trim: 3.46 },
  ember_douse:    { gap: 0.10, wet: 0.15, prio: 0, trim: 2.91 },
  sprout_grow:    { gap: 0.10, wet: 0.30, prio: 0, trim: 2.11 },
  spark:          { gap: 0.05, wet: 0.10, prio: 0, trim: 6 },
  checkpoint:     { gap: 0.20, wet: 0.50, prio: 1, trim: 0.95 },
  shard:          { gap: 0.06, wet: 0.45, prio: 1, trim: 1.14 },
  respawn:        { gap: 0.15, wet: 0.25, prio: 1, trim: 3.46 },
  level_complete: { gap: 0.50, wet: 0.60, prio: 1, trim: 0.92 },
  ui_tap:         { gap: 0.04, wet: 0.00, prio: 1, trim: 6 },
  ui_back:        { gap: 0.04, wet: 0.00, prio: 1, trim: 6 },
  denied:         { gap: 0.12, wet: 0.05, prio: 1, trim: 1.85 },
  // --- fire and clay (DESIGN-ELEMENTS.md). Same meaning of the fields. These trims were set from
  // a LIVE capture of the real output at intensity 1 and default volumes (tests/audio-demo.html
  // "Loudness report"), aiming each at the live level of the original set (median about -25 dBFS
  // RMS over the sound). Offline renders were not used: they read several dB low for loud sounds.
  ignite:         { gap: 0.12, wet: 0.20, prio: 0, trim: 2.57 },
  flare:          { gap: 0.12, wet: 0.25, prio: 0, trim: 1.15 },
  smoke_puff:     { gap: 0.12, wet: 0.25, prio: 0, trim: 4.01 },
  spark_zip:      { gap: 0.06, wet: 0.12, prio: 0, trim: 5.6 },
  wire_ride:      { gap: 0.30, wet: 0.10, prio: 0, trim: 3.63 },
  fuse_burn:      { gap: 0.30, wet: 0.10, prio: 0, trim: 3.01 },
  wood_burn:      { gap: 0.25, wet: 0.12, prio: 0, trim: 3.94 },
  ice_melt:       { gap: 0.15, wet: 0.25, prio: 0, trim: 2.92 },
  wax_melt:       { gap: 0.15, wet: 0.15, prio: 0, trim: 2.28 },
  gas_blast:      { gap: 0.20, wet: 0.35, prio: 1, trim: 1.0 },
  extinguish:     { gap: 0.15, wet: 0.20, prio: 0, trim: 1.99 },
  coal:           { gap: 0.08, wet: 0.35, prio: 1, trim: 1.03 },
  squish:         { gap: 0.07, wet: 0.08, prio: 0, trim: 2.07 },
  slip_pour:      { gap: 0.15, wet: 0.15, prio: 0, trim: 1.88 },
  fire_harden:    { gap: 0.25, wet: 0.30, prio: 0, trim: 1.84 },
  shell_shed:     { gap: 0.12, wet: 0.12, prio: 0, trim: 1.28 },
  shell_crumble:  { gap: 0.15, wet: 0.15, prio: 0, trim: 1.68 },
  dust_puff:      { gap: 0.10, wet: 0.15, prio: 0, trim: 5.64 },
  soak:           { gap: 0.12, wet: 0.15, prio: 0, trim: 2.08 },
  mould_cast:     { gap: 0.20, wet: 0.15, prio: 0, trim: 1.36 },
  piston:         { gap: 0.10, wet: 0.08, prio: 0, trim: 1.54 },
  wheel_spin:     { gap: 0.30, wet: 0.08, prio: 0, trim: 1.24 },
  climb_stick:    { gap: 0.06, wet: 0.05, prio: 0, trim: 4.07 },
};

// Loudness trims of the fire / clay form layers, set from the live output so that they sit with the
// water layers (steady-state RMS about -34..-46 dBFS at default volumes; ambience stays well under sfx).
const LAYER_TRIM = {
  ember: 1.25, blaze: 0.77, smoke: 1, spark: 1, clay: 1, slip: 1, stone: 0.64, dust: 0.56,
};

const R = {
  // --- liquid -------------------------------------------------------------
  jump(V, t, I, p) {
    V.osc('sine', 320 * p, t, 0.17, 0.34, { f1: 760 * p, ft: 0.13, atk: 0.008 });
    V.osc('triangle', 640 * p, t + 0.01, 0.10, 0.07, { f1: 1500 * p, ft: 0.08 });
    V.noise('white', t, 0.09, 0.05, { type: 'bandpass', f0: 1500, f1: 2800, q: 2.2 });
  },
  land(V, t, I, p) {
    V.osc('sine', 175 * p, t, 0.20, 0.62, { f1: 52, ft: 0.16, atk: 0.002 });
    V.noise('pink', t, 0.14, 0.30, { type: 'lowpass', f0: 1000, f1: 260, q: 0.7, atk: 0.002 });
    if (I > 0.5) V.noise('white', t + 0.01, 0.07, 0.10, { type: 'bandpass', f0: 1800, q: 1.5 });
    if (I > 0.8) V.osc('sine', 480 * p, t + 0.05, 0.08, 0.10, { f1: 900 * p, ft: 0.06 });
  },
  splash(V, t, I, p) {
    V.noise('white', t, 0.38, 0.22, { type: 'bandpass', f0: 1300, f1: 500, q: 0.9, atk: 0.01 });
    V.noise('pink', t, 0.22, 0.12, { type: 'lowpass', f0: 800, q: 0.7, atk: 0.004 });
    const n = 4 + Math.round(3 * Math.min(I, 1.5));
    for (let i = 0; i < n; i++) {
      const f = rnd(500, 1600) * p;
      V.osc('sine', f, t + rnd(0, 0.3), 0.09, rnd(0.07, 0.15), { f1: f * 1.8, ft: 0.06, atk: 0.003 });
    }
  },
  // --- ice ----------------------------------------------------------------
  freeze(V, t, I, p) {
    const base = 1800 * p;
    [1, 1.5, 2.01, 2.76, 3.4].forEach((r, i) => {
      V.osc('sine', base * r, t + i * 0.035, rnd(0.4, 0.6), 0.075, { atk: 0.004 });
    });
    V.noise('white', t, 0.28, 0.12, { type: 'highpass', f0: 3000, f1: 9000, q: 0.7, atk: 0.02 });
    for (let i = 0; i < 4; i++) V.noise('white', t + rnd(0, 0.35), 0.014, 0.10, { type: 'highpass', f0: 6000, q: 0.7, atk: 0.001 });
    V.osc('sine', 3200 * p, t + 0.28, 0.25, 0.05, { atk: 0.002 });
  },
  melt(V, t, I, p) {
    V.noise('pink', t, 0.62, 0.14, { type: 'lowpass', f0: 1400, f1: 500, q: 0.8, atk: 0.08 });
    V.osc('sine', 500 * p, t, 0.5, 0.10, { f1: 200 * p, ft: 0.45, atk: 0.04 });
    for (let i = 0; i < 6; i++) {
      const f = rnd(900, 1700) * p;
      V.osc('sine', f, t + 0.06 + i * rnd(0.07, 0.11), 0.09, 0.10 * (1 - i * 0.1), { f1: f * 0.55, ft: 0.07, atk: 0.003 });
    }
  },
  // --- steam --------------------------------------------------------------
  vaporize(V, t, I, p) {
    V.noise('white', t, 0.75, 0.22, { type: 'bandpass', f0: 1500, f1: 6000, q: 0.8, atk: 0.12 });
    V.noise('pink', t, 0.7, 0.10, { type: 'bandpass', f0: 400, f1: 1200, q: 0.7, atk: 0.1 });
    V.osc('sine', 300 * p, t, 0.5, 0.06, { f1: 900 * p, ft: 0.45, atk: 0.1 });
  },
  condense(V, t, I, p) {
    V.noise('white', t, 0.55, 0.20, { type: 'bandpass', f0: 5000, f1: 1200, q: 0.8, atk: 0.02 });
    V.noise('pink', t + 0.05, 0.4, 0.08, { type: 'lowpass', f0: 900, f1: 400, q: 0.7, atk: 0.1 });
    V.osc('sine', 700 * p, t + 0.5, 0.12, 0.09, { f1: 400 * p, ft: 0.08, atk: 0.004 });
  },
  // --- film ---------------------------------------------------------------
  flatten(V, t, I, p) {
    V.noise('white', t, 0.22, 0.20, { type: 'bandpass', f0: 1800, f1: 400, q: 3, atk: 0.01 });
    V.osc('sine', 260 * p, t, 0.20, 0.22, { f1: 90, ft: 0.18, atk: 0.006 });
    V.noise('pink', t, 0.05, 0.12, { type: 'lowpass', f0: 600, q: 0.7, atk: 0.002 });
  },
  unflatten(V, t, I, p) {
    V.noise('white', t, 0.22, 0.20, { type: 'bandpass', f0: 400, f1: 1800, q: 3, atk: 0.12 });
    V.osc('sine', 140 * p, t, 0.20, 0.20, { f1: 380 * p, ft: 0.18, atk: 0.06 });
    V.osc('sine', 600 * p, t + 0.16, 0.08, 0.07, { f1: 950 * p, ft: 0.05, atk: 0.003 });
  },
  // --- mechanisms ---------------------------------------------------------
  plate_down(V, t, I, p) {
    V.osc('sine', 120 * p, t, 0.22, 0.60, { f1: 48, ft: 0.12, atk: 0.002 });
    V.osc('triangle', 210 * p, t, 0.10, 0.25, { f1: 140, ft: 0.08, atk: 0.002 });
    V.noise('white', t, 0.035, 0.30, { type: 'bandpass', f0: 1800, q: 2.5, atk: 0.001 });
    V.noise('pink', t, 0.13, 0.25, { type: 'lowpass', f0: 500, q: 0.7, atk: 0.002 });
    V.osc('sine', 460 * p, t, 0.28, 0.06, { atk: 0.002 });
  },
  plate_up(V, t, I, p) {
    V.osc('sine', 150 * p, t, 0.12, 0.30, { f1: 90, ft: 0.08, atk: 0.002 });
    V.noise('white', t, 0.025, 0.22, { type: 'highpass', f0: 2400, q: 0.7, atk: 0.001 });
    V.osc('sine', 620 * p, t, 0.12, 0.04, { atk: 0.002 });
  },
  door_open(V, t, I, p) {
    const D = 1.05;
    const tg = V.gain(0.65);
    V.lfo(9 * p, 0.3, tg.gain, t, D + 0.1);
    const lp = V.filter('lowpass', 300, 0.8, tg);
    V.osc('sawtooth', 52 * p, t, D, 0.30, { f1: 84 * p, ft: D * 0.95, atk: 0.12, to: lp });
    V.noise('brown', t, D, 0.45, { type: 'lowpass', f0: 240, q: 0.7, atk: 0.1 });
    for (let k = 0; k < 3; k++) V.noise('white', t + rnd(0.1, 0.9), 0.09, 0.14, { type: 'bandpass', f0: rnd(700, 1500), q: 4 });
    V.osc('sine', 110 * p, t + D - 0.04, 0.16, 0.50, { f1: 48, ft: 0.12, atk: 0.002 });
    V.noise('pink', t + D - 0.04, 0.08, 0.22, { type: 'lowpass', f0: 900, q: 0.7, atk: 0.002 });
  },
  door_close(V, t, I, p) {
    const D = 0.62;
    const tg = V.gain(0.65);
    V.lfo(10 * p, 0.3, tg.gain, t, D + 0.1);
    const lp = V.filter('lowpass', 300, 0.8, tg);
    V.osc('sawtooth', 84 * p, t, D, 0.26, { f1: 56 * p, ft: D * 0.95, atk: 0.06, to: lp });
    V.noise('brown', t, D, 0.35, { type: 'lowpass', f0: 220, q: 0.7, atk: 0.06 });
    V.noise('white', t + rnd(0.1, 0.4), 0.08, 0.12, { type: 'bandpass', f0: rnd(700, 1400), q: 4 });
    const h = t + D - 0.02;
    V.osc('sine', 92 * p, h, 0.26, 0.72, { f1: 38, ft: 0.2, atk: 0.002 });
    V.noise('pink', h, 0.15, 0.30, { type: 'lowpass', f0: 300, q: 0.7, atk: 0.002 });
    V.noise('white', h, 0.03, 0.22, { type: 'bandpass', f0: 1500, q: 2, atk: 0.001 });
  },
  fan(V, t, I, p) {
    const tg = V.gain(0.75);
    V.lfo(22 * p, 0.25, tg.gain, t, 0.7);
    V.noise('pink', t, 0.6, 0.20, { type: 'bandpass', f0: 300, f1: 700, q: 0.9, atk: 0.15, to: tg });
    V.noise('white', t, 0.55, 0.05, { type: 'bandpass', f0: 2500, f1: 1800, q: 0.6, atk: 0.2, to: tg });
  },
  pane_crack(V, t, I, p) {
    let at = 0;
    const n = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      at += rnd(0.015, 0.07);
      V.noise('white', t + at, 0.02, rnd(0.15, 0.28), { type: 'bandpass', f0: rnd(3000, 7000), q: 6, atk: 0.001 });
    }
    V.osc('sine', 2400 * p, t, 0.18, 0.12, { f1: 1800 * p, ft: 0.15, atk: 0.001 });
    V.osc('sine', 3700 * p, t, 0.12, 0.06, { atk: 0.001 });
  },
  pane_smash(V, t, I, p) {
    V.noise('white', t, 0.12, 0.50, { type: 'bandpass', f0: 3000, q: 0.7, atk: 0.001 });
    V.osc('sine', 140 * p, t, 0.16, 0.35, { f1: 60, ft: 0.12, atk: 0.002 });
    const n = 10 + Math.round(6 * Math.min(I, 1.5));
    for (let i = 0; i < n; i++) {
      const at = 0.02 + 0.55 * Math.pow(Math.random(), 1.6);
      V.osc(Math.random() < 0.7 ? 'sine' : 'triangle', rnd(1800, 7500) * p, t + at, rnd(0.08, 0.3), rnd(0.03, 0.09), { atk: 0.001 });
    }
    for (let i = 0; i < 3; i++) V.noise('white', t + rnd(0.05, 0.6), 0.012, rnd(0.07, 0.14), { type: 'highpass', f0: 5000, q: 0.7, atk: 0.001 });
  },
  crate_push(V, t, I, p) {
    const tg = V.gain(0.7);
    V.lfo(28 * p, 0.3, tg.gain, t, 0.4);
    V.noise('pink', t, 0.3, 0.22, { type: 'lowpass', f0: 700, q: 0.7, atk: 0.03, to: tg });
    V.osc('triangle', 95 * p, t, 0.25, 0.20, { f1: 80, ft: 0.2, atk: 0.02 });
  },
  ember_douse(V, t, I, p) {
    V.noise('white', t, 0.8, 0.25, { type: 'bandpass', f0: 4000, q: 0.5, atk: 0.01 });
    for (let i = 0; i < 6; i++) {
      V.noise('white', t + rnd(0, 0.6), 0.008, rnd(0.08, 0.22) * (1 - i * 0.08), { type: 'highpass', f0: 5000, q: 0.7, atk: 0.001 });
    }
    V.osc('sine', 250 * p, t, 0.14, 0.30, { f1: 80, ft: 0.1, atk: 0.003 });
  },
  sprout_grow(V, t, I, p) {
    const base = 392 * p;
    [1, 9 / 8, 5 / 4, 3 / 2].forEach((r, i) => {
      const f = base * r * 2;
      V.osc('sine', f, t + i * 0.09, 0.35, 0.11, { atk: 0.02 });
      V.osc('triangle', f * 2, t + i * 0.09, 0.2, 0.03, { atk: 0.02 });
    });
    V.noise('pink', t, 0.45, 0.06, { type: 'bandpass', f0: 1000, f1: 3000, q: 1.5, atk: 0.15 });
    V.osc('sine', 200 * p, t, 0.3, 0.08, { f1: 400 * p, ft: 0.25, atk: 0.05 });
  },
  spark(V, t, I, p) {
    V.steps('sawtooth', t, 0.13, 0.16, 0.012, 1200, 5000, V.filter('highpass', 800, 0.7));
    V.noise('white', t, 0.06, 0.20, { type: 'highpass', f0: 4000, q: 0.7, atk: 0.001 });
    V.osc('square', 90 * p, t, 0.10, 0.07, { atk: 0.002 });
  },
  // --- rewards ------------------------------------------------------------
  checkpoint(V, t, I, p) {
    const q = 1 + (p - 1) * 0.2;
    V.bell(659.25 * q, t, 0.9, 0.26);
    V.bell(987.77 * q, t + 0.12, 1.1, 0.24);
    V.osc('sine', 329.6 * q, t, 0.7, 0.05, { atk: 0.1 });
  },
  shard(V, t, I, p) {
    const q = 1 + (p - 1) * 0.2;
    const seq = [1046.5, 1318.5, 1568, 2093];
    const s = (Math.random() * 2) | 0;
    for (let i = 0; i < 3; i++) {
      V.bell(seq[s + i] * q, t + i * 0.065, 0.55, 0.2, { ratios: [1, 2.0, 3.01] });
    }
    V.noise('white', t, 0.12, 0.06, { type: 'highpass', f0: 8000, q: 0.7, atk: 0.001 });
  },
  respawn(V, t, I, p) {
    V.noise('white', t, 0.35, 0.15, { type: 'bandpass', f0: 200, f1: 2200, q: 1.2, atk: 0.1 });
    V.osc('sine', 220 * p, t, 0.3, 0.12, { f1: 660 * p, ft: 0.26, atk: 0.06 });
    V.osc('sine', 880 * p, t + 0.28, 0.1, 0.08, { f1: 1200 * p, ft: 0.06, atk: 0.003 });
  },
  level_complete(V, t, I, p) {
    const q = 1 + (p - 1) * 0.2;
    const arp = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
    arp.forEach((f, i) => V.bell(f * q, t + i * 0.14, 1.2, 0.18));
    const h = t + 0.95;
    [523.25, 783.99, 1318.5].forEach((f) => V.bell(f * q, h, 2.0, 0.13));
    [261.63, 329.63, 392, 523.25].forEach((f) => V.osc('sine', f * q, t + 0.5, 2.4, 0.05, { atk: 0.4 }));
  },
  // --- ui -----------------------------------------------------------------
  ui_tap(V, t, I, p) {
    const q = 1 + (p - 1) * 0.3;
    V.osc('sine', 880 * q, t, 0.05, 0.15, { atk: 0.002 });
    V.osc('triangle', 1760 * q, t, 0.025, 0.04, { atk: 0.001 });
  },
  ui_back(V, t, I, p) {
    const q = 1 + (p - 1) * 0.3;
    V.osc('sine', 620 * q, t, 0.07, 0.14, { f1: 480 * q, ft: 0.06, atk: 0.002 });
  },
  denied(V, t, I, p) {
    const lp = V.filter('lowpass', 500, 0.7);
    V.osc('triangle', 170 * p, t, 0.10, 0.24, { f1: 150 * p, ft: 0.09, atk: 0.004, to: lp });
    V.osc('triangle', 150 * p, t + 0.11, 0.12, 0.22, { f1: 120 * p, ft: 0.1, atk: 0.004, to: lp });
    V.osc('sine', 85 * p, t, 0.22, 0.10, { atk: 0.01 });
  },

  // =========================================================================
  // FIRE (Cinder).  Warm, bright, crackly: the 'crackle' noise (sparse pops) is the signature.
  // =========================================================================
  // lantern / brazier / fuse lit by touch: a match-strike, a soft whoosh opening upward, a warm bloom
  ignite(V, t, I, p) {
    V.noise('white', t, 0.07, 0.10, { type: 'highpass', f0: 3500, q: 0.7, atk: 0.002 });
    V.noise('pink', t + 0.04, 0.55, 0.20, { type: 'bandpass', f0: 500, f1: 2400, ft: 0.3, q: 1, atk: 0.12 });
    V.osc('sine', 150 * p, t + 0.05, 0.6, 0.10, { f1: 230 * p, ft: 0.4, atk: 0.1 });
    V.noise('crackle', t + 0.12, 0.55, 0.35, { type: 'bandpass', f0: 2500, q: 0.8, atk: 0.02 });
  },
  // blaze form: a bigger gust of flame, low thump under a roaring swell
  flare(V, t, I, p) {
    V.noise('pink', t, 0.85, 0.30, { type: 'lowpass', f0: 350, f1: 1700, ft: 0.25, q: 0.8, atk: 0.05 });
    V.noise('white', t, 0.6, 0.12, { type: 'bandpass', f0: 1200, f1: 3500, ft: 0.3, q: 0.6, atk: 0.03 });
    V.osc('sine', 70 * p, t, 0.65, 0.24, { f1: 112 * p, ft: 0.3, atk: 0.05 });
    V.noise('crackle', t + 0.08, 0.7, 0.4, { type: 'bandpass', f0: 3000, q: 0.7, atk: 0.02 });
  },
  // smoke form: a breathy, low-passed "pff" that hangs a moment
  smoke_puff(V, t, I, p) {
    V.noise('pink', t, 0.75, 0.16, { type: 'bandpass', f0: 420, f1: 800, ft: 0.4, q: 0.7, atk: 0.09 });
    V.noise('white', t + 0.02, 0.5, 0.035, { type: 'bandpass', f0: 2200, f1: 1200, q: 0.5, atk: 0.08 });
    V.osc('sine', 190 * p, t, 0.5, 0.06, { f1: 120 * p, ft: 0.4, atk: 0.07 });
  },
  // spark form moves: a fast rising electric chirp with a fizzing tail
  spark_zip(V, t, I, p) {
    V.osc('sawtooth', 700 * p, t, 0.15, 0.07, { f1: 5200 * p, ft: 0.11, atk: 0.004, to: V.filter('highpass', 900, 0.7) });
    V.osc('sine', 1400 * p, t, 0.13, 0.16, { f1: 6000 * p, ft: 0.1, atk: 0.003 });
    V.noise('white', t, 0.13, 0.16, { type: 'highpass', f0: 4500, q: 0.7, atk: 0.002 });
    V.steps('square', t + 0.02, 0.1, 0.04, 0.01, 2500, 7500, V.filter('highpass', 2000, 0.7));
    V.noise('crackle', t + 0.05, 0.22, 0.06, { type: 'highpass', f0: 3500, q: 0.7, atk: 0.003 });
  },
  // riding a wire rail: a buzzing hum gliding up with a thin zing and little zaps
  wire_ride(V, t, I, p) {
    const D = 0.8;
    const tg = V.gain(0.7);
    V.lfo(46 * p, 0.35, tg.gain, t, D + 0.1);
    const lp = V.filter('lowpass', 1400, 0.9, tg);
    V.osc('sawtooth', 120 * p, t, D, 0.10, { f1: 170 * p, ft: D * 0.9, atk: 0.06, to: lp });
    V.osc('square', 960 * p, t, D, 0.02, { f1: 1400 * p, ft: D * 0.9, atk: 0.08, to: tg });
    V.noise('white', t, D, 0.07, { type: 'bandpass', f0: 4500, f1: 6500, q: 2, atk: 0.08, hold: 0.3, to: tg });
    for (let k = 0; k < 4; k++) V.noise('white', t + rnd(0.05, D - 0.1), 0.012, rnd(0.08, 0.18), { type: 'highpass', f0: 5000, q: 0.7, atk: 0.001 });
  },
  // a fuse hissing and sputtering along its length
  fuse_burn(V, t, I, p) {
    V.noise('white', t, 0.9, 0.10, { type: 'bandpass', f0: 6500, q: 1.2, atk: 0.05, hold: 0.5 });
    V.noise('crackle', t, 0.9, 0.36, { type: 'bandpass', f0: 3800, q: 1, atk: 0.03, hold: 0.55 });
    V.noise('pink', t, 0.8, 0.05, { type: 'bandpass', f0: 900, q: 1, atk: 0.08, hold: 0.3 });
  },
  // wood alight: lower, rounder crackle, a woody roar and the odd pop
  wood_burn(V, t, I, p) {
    V.noise('crackle', t, 1.1, 0.32, { type: 'lowpass', f0: 2800, q: 0.7, atk: 0.03, hold: 0.5 });
    V.noise('pink', t, 1.0, 0.14, { type: 'lowpass', f0: 300, q: 0.7, atk: 0.1, hold: 0.4 });
    const n = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const at = t + rnd(0.05, 0.8), f = rnd(180, 320) * p;
      V.noise('white', at, 0.02, 0.2, { type: 'bandpass', f0: rnd(1500, 3000), q: 3, atk: 0.001 });
      V.osc('sine', f, at, 0.06, 0.10, { f1: f * 0.5, ft: 0.05, atk: 0.002 });
    }
  },
  // fire meets ice: sizzling steam hiss, ticking cracks, falling drips
  ice_melt(V, t, I, p) {
    V.noise('white', t, 0.6, 0.12, { type: 'bandpass', f0: 5000, f1: 2200, ft: 0.5, q: 0.8, atk: 0.02, hold: 0.2 });
    V.noise('crackle', t, 0.6, 0.3, { type: 'highpass', f0: 4000, q: 0.7, atk: 0.01 });
    V.osc('sine', 2800 * p, t, 0.2, 0.05, { f1: 2300 * p, ft: 0.15, atk: 0.001 });
    for (let i = 0; i < 5; i++) {
      const f = rnd(1000, 2200) * p;
      V.osc('sine', f, t + 0.12 + i * rnd(0.09, 0.14), 0.09, 0.09 * (1 - i * 0.12), { f1: f * 0.6, ft: 0.06, atk: 0.003 });
    }
  },
  // wax softening: slow, low, sticky, with lazy bubbles
  wax_melt(V, t, I, p) {
    V.noise('pink', t, 1.0, 0.12, { type: 'lowpass', f0: 500, f1: 250, q: 0.7, atk: 0.2 });
    V.osc('sine', 210 * p, t, 0.9, 0.09, { f1: 120 * p, ft: 0.8, atk: 0.12 });
    for (let i = 0; i < 4; i++) {
      const f = rnd(260, 420) * p;
      V.osc('sine', f, t + 0.15 + i * rnd(0.12, 0.2), 0.12, 0.08, { f1: f * 1.7, ft: 0.07, atk: 0.01 });
    }
  },
  // gas pocket going off: a crack, a deep boom with a falling roar, debris
  gas_blast(V, t, I, p) {
    V.noise('white', t, 0.06, 0.55, { type: 'bandpass', f0: 2500, q: 0.7, atk: 0.001 });
    V.noise('pink', t, 1.0, 0.5, { type: 'lowpass', f0: 3200, f1: 180, ft: 0.8, q: 0.7, atk: 0.004 });
    V.osc('sine', 120 * p, t, 0.6, 0.5, { f1: 32, ft: 0.4, atk: 0.003 });
    V.noise('brown', t, 1.1, 0.35, { type: 'lowpass', f0: 160, q: 0.7, atk: 0.01, hold: 0.2 });
    V.noise('crackle', t + 0.1, 0.8, 0.3, { type: 'bandpass', f0: 2200, q: 0.7, atk: 0.02 });
  },
  // fire put out: a long falling hiss, a sinking tone and a few last crackles
  extinguish(V, t, I, p) {
    V.noise('white', t, 1.1, 0.16, { type: 'bandpass', f0: 5200, f1: 1200, ft: 1.0, q: 0.7, atk: 0.02, hold: 0.15 });
    V.noise('crackle', t, 0.6, 0.35, { type: 'lowpass', f0: 3500, q: 0.7, atk: 0.01 });
    V.osc('sine', 340 * p, t, 0.7, 0.09, { f1: 70 * p, ft: 0.6, atk: 0.01 });
    V.noise('pink', t, 0.5, 0.10, { type: 'lowpass', f0: 700, q: 0.7, atk: 0.02 });
  },
  // heat pickup: warm two-note glow with a crackle
  coal(V, t, I, p) {
    const q = 1 + (p - 1) * 0.2;
    V.bell(392 * q, t, 0.8, 0.22, { ratios: [1, 2, 3.01] });
    V.bell(587 * q, t + 0.08, 0.8, 0.2, { ratios: [1, 2, 3.01] });
    V.osc('sine', 196 * q, t, 0.8, 0.08, { atk: 0.05 });
    V.noise('crackle', t, 0.35, 0.3, { type: 'bandpass', f0: 2600, q: 0.8, atk: 0.005 });
    V.noise('pink', t, 0.4, 0.05, { type: 'bandpass', f0: 400, f1: 1200, q: 1, atk: 0.1 });
  },

  // =========================================================================
  // CLAY (Dab).  Damp, soft, rounded: pitch-bent sines for squelch, 'grit' noise for stone and dust.
  // =========================================================================
  // a wet press: squash down, then a small lip of release
  squish(V, t, I, p) {
    V.osc('sine', 300 * p, t, 0.14, 0.32, { f1: 95, ft: 0.12, atk: 0.004 });
    V.osc('sine', 150 * p, t + 0.1, 0.12, 0.20, { f1: 330 * p, ft: 0.09, atk: 0.006 });
    V.noise('pink', t, 0.22, 0.22, { type: 'bandpass', f0: 700, f1: 350, q: 2, atk: 0.005 });
    V.noise('white', t + 0.08, 0.1, 0.07, { type: 'bandpass', f0: 1800, q: 3, atk: 0.004 });
  },
  // slip form: a thick slow pour with gurgle and glugs
  slip_pour(V, t, I, p) {
    const tg = V.gain(0.7);
    V.lfo(7 * p, 0.3, tg.gain, t, 1.3);
    V.noise('pink', t, 1.2, 0.20, { type: 'bandpass', f0: 380, f1: 300, q: 1.4, atk: 0.12, hold: 0.6, to: tg });
    V.noise('brown', t, 1.1, 0.20, { type: 'lowpass', f0: 200, q: 0.7, atk: 0.15, hold: 0.5 });
    for (let i = 0; i < 5; i++) {
      const f = rnd(120, 230) * p;
      V.osc('sine', f, t + rnd(0.1, 1.0), rnd(0.1, 0.18), 0.10, { f1: f * 1.6, ft: 0.09, atk: 0.015 });
    }
  },
  // clay to stone: kiln crackle and rising heat, then a hard ceramic ring and a solid thunk
  fire_harden(V, t, I, p) {
    V.noise('crackle', t, 0.5, 0.35, { type: 'lowpass', f0: 2000, q: 0.7, atk: 0.02, hold: 0.2 });
    V.noise('pink', t, 0.5, 0.12, { type: 'bandpass', f0: 200, f1: 1100, ft: 0.45, q: 1, atk: 0.2 });
    const h = t + 0.45;
    V.bell(1180 * p, h, 0.8, 0.16, { ratios: [1, 2.32, 4.25] });
    V.noise('white', h, 0.02, 0.3, { type: 'bandpass', f0: 2200, q: 3, atk: 0.001 });
    V.osc('sine', 95 * p, h, 0.2, 0.25, { f1: 55, ft: 0.15, atk: 0.002 });
  },
  // stone shell dropped: heavy chunk, a clack, crumbs
  shell_shed(V, t, I, p) {
    V.osc('sine', 100 * p, t, 0.3, 0.5, { f1: 42, ft: 0.2, atk: 0.003 });
    V.noise('pink', t, 0.22, 0.3, { type: 'lowpass', f0: 700, f1: 250, q: 0.7, atk: 0.003 });
    V.noise('white', t, 0.03, 0.3, { type: 'bandpass', f0: 1400, q: 2.5, atk: 0.001 });
    V.noise('grit', t + 0.02, 0.35, 0.35, { type: 'bandpass', f0: 1800, f1: 800, q: 1.2, atk: 0.004 });
    V.osc('triangle', 220 * p, t, 0.12, 0.10, { f1: 150, ft: 0.1, atk: 0.002 });
  },
  // the old shell falling apart: long grit, a rumble, falling pebbles and a last settle
  shell_crumble(V, t, I, p) {
    V.noise('grit', t, 1.2, 0.5, { type: 'bandpass', f0: 1600, f1: 500, ft: 1.0, q: 1, atk: 0.02, hold: 0.25 });
    V.noise('brown', t, 1.0, 0.35, { type: 'lowpass', f0: 180, q: 0.7, atk: 0.05, hold: 0.3 });
    for (let i = 0; i < 6; i++) {
      const at = t + 0.05 + 0.95 * Math.pow(Math.random(), 1.3), f = rnd(180, 420) * p;
      V.osc('sine', f, at, 0.06, rnd(0.06, 0.14), { f1: f * 0.6, ft: 0.04, atk: 0.002 });
      V.noise('white', at, 0.015, rnd(0.08, 0.16), { type: 'bandpass', f0: rnd(1800, 3200), q: 4, atk: 0.001 });
    }
    V.osc('sine', 80 * p, t + 0.9, 0.2, 0.22, { f1: 40, ft: 0.15, atk: 0.003 });
  },
  // a fine puff: short, higher and grittier than smoke
  dust_puff(V, t, I, p) {
    V.noise('white', t, 0.45, 0.13, { type: 'bandpass', f0: 3200, f1: 2200, q: 0.6, atk: 0.02 });
    V.noise('grit', t, 0.5, 0.15, { type: 'highpass', f0: 2500, q: 0.7, atk: 0.01 });
    V.noise('pink', t, 0.3, 0.10, { type: 'lowpass', f0: 900, q: 0.7, atk: 0.02 });
    V.osc('sine', 140 * p, t, 0.25, 0.05, { f1: 100 * p, ft: 0.2, atk: 0.01 });
  },
  // water soaking into clay: a wet slosh, then swallowed glurps falling in pitch
  soak(V, t, I, p) {
    V.noise('pink', t, 0.6, 0.20, { type: 'bandpass', f0: 600, f1: 250, q: 1.1, atk: 0.01 });
    for (let i = 0; i < 5; i++) {
      const f = rnd(220, 500) * p;
      V.osc('sine', f, t + i * rnd(0.07, 0.12), 0.1, 0.12, { f1: f * 0.55, ft: 0.08, atk: 0.004 });
    }
    V.osc('sine', 130 * p, t, 0.35, 0.20, { f1: 70, ft: 0.3, atk: 0.005 });
    V.noise('white', t, 0.15, 0.06, { type: 'bandpass', f0: 1500, q: 1, atk: 0.005 });
  },
  // slip filling a mould: pitch climbs as the cavity fills, then a settling thump and a knock
  mould_cast(V, t, I, p) {
    V.osc('sine', 110 * p, t, 0.7, 0.18, { f1: 300 * p, ft: 0.65, atk: 0.05 });
    V.noise('pink', t, 0.75, 0.20, { type: 'bandpass', f0: 300, f1: 700, ft: 0.6, q: 1.2, atk: 0.08, hold: 0.3 });
    const h = t + 0.7;
    V.osc('sine', 95 * p, h, 0.22, 0.45, { f1: 50, ft: 0.15, atk: 0.002 });
    V.osc('triangle', 240 * p, h, 0.1, 0.20, { f1: 170, ft: 0.08, atk: 0.002 });
    V.noise('pink', h, 0.1, 0.10, { type: 'lowpass', f0: 600, q: 0.7, atk: 0.002 });
  },
  // a piston thrust: thump, pneumatic hiss, a metal clack, then a lighter return tick
  piston(V, t, I, p) {
    V.osc('sine', 80 * p, t, 0.22, 0.45, { f1: 48, ft: 0.15, atk: 0.003 });
    V.noise('white', t, 0.3, 0.22, { type: 'bandpass', f0: 2800, f1: 900, q: 0.9, atk: 0.005 });
    V.osc('triangle', 520 * p, t + 0.01, 0.05, 0.12, { atk: 0.001 });
    V.noise('white', t, 0.02, 0.3, { type: 'bandpass', f0: 2200, q: 3, atk: 0.001 });
    V.noise('white', t + 0.28, 0.02, 0.15, { type: 'bandpass', f0: 1800, q: 3, atk: 0.001 });
    V.osc('sine', 130 * p, t + 0.28, 0.1, 0.20, { f1: 70, ft: 0.08, atk: 0.002 });
  },
  // potter's wheel spinning up: a humming turn with a wobble and wet slaps
  wheel_spin(V, t, I, p) {
    const D = 1.2;
    const tg = V.gain(0.65);
    V.lfo(8 * p, 0.3, tg.gain, t, D + 0.1);
    const lp = V.filter('lowpass', 420, 0.8, tg);
    V.osc('triangle', 86 * p, t, D, 0.12, { f1: 108 * p, ft: D * 0.4, atk: 0.15, hold: 0.5, to: lp });
    V.noise('pink', t, D, 0.30, { type: 'bandpass', f0: 420, f1: 600, ft: D * 0.4, q: 0.9, atk: 0.15, hold: 0.5, to: tg });
    for (let i = 0; i < 4; i++) V.noise('pink', t + 0.2 + i * 0.22, 0.05, 0.24, { type: 'bandpass', f0: 800, q: 2.5, atk: 0.003 });
  },
  // clay gripping a rough wall: a tacky grab, a tiny peel
  climb_stick(V, t, I, p) {
    V.noise('white', t, 0.06, 0.22, { type: 'bandpass', f0: 1500, f1: 700, q: 4, atk: 0.002 });
    V.osc('sine', 420 * p, t, 0.08, 0.20, { f1: 200 * p, ft: 0.07, atk: 0.002 });
    V.osc('sine', 700 * p, t + 0.06, 0.05, 0.10, { f1: 300 * p, ft: 0.04, atk: 0.002 });
    V.noise('pink', t + 0.04, 0.1, 0.10, { type: 'bandpass', f0: 900, q: 2, atk: 0.003 });
  },
};

// ---------------------------------------------------------------------------
// Music definitions
// ---------------------------------------------------------------------------

const MOOD_DEFS = {
  // D dorian, add9 chords, kalimba melody: warm and slightly wistful
  menu: {
    root: 50, scale: [0, 2, 3, 5, 7, 9, 10], chordOff: [0, 2, 4, 8],
    degrees: [[0, 3], [3, 2], [4, 2], [6, 2], [2, 2]],
    bpm: 72, padBeats: [10, 18], padGain: 0.055, padLP: 1500,
    melLo: 62, melHi: 81, kind: 'kalimba', rest: [3, 9], density: 0.75,
    shifts: [0, 0, 0, 5, 7, -2], delay: 0.75, fb: 0.36, pluckVel: 0.9,
  },
  // A minor pentatonic, quartal chords, very sparse
  calm: {
    root: 45, scale: [0, 3, 5, 7, 10], chordOff: [0, 2, 4],
    degrees: [[0, 3], [1, 2], [2, 2], [3, 1], [4, 2]],
    bpm: 58, padBeats: [12, 20], padGain: 0.05, padLP: 1000,
    melLo: 57, melHi: 76, kind: 'kalimba', rest: [4, 12], density: 0.5,
    shifts: [0, 0, 0, 5, -2, 7], delay: 0.75, fb: 0.4, pluckVel: 0.75,
  },
  // E phrygian, drone and a soft clock, hollow marimba
  tense: {
    root: 40, scale: [0, 1, 3, 5, 7, 8, 10], chordOff: [0, 2, 4],
    degrees: [[0, 5], [1, 2], [5, 1], [6, 2]],
    bpm: 52, padBeats: [12, 20], padGain: 0.05, padLP: 700,
    melLo: 52, melHi: 72, kind: 'marimba', rest: [6, 16], density: 0.4,
    shifts: [0, 0, -1, 1], pulse: true, drone: true, delay: 1, fb: 0.3, pluckVel: 0.7,
  },
  // G lydian, bright bells, resolves upward
  win: {
    root: 55, scale: [0, 2, 4, 6, 7, 9, 11], chordOff: [0, 2, 4, 8],
    degrees: [[0, 3], [1, 2], [4, 2], [5, 2]],
    bpm: 92, padBeats: [8, 14], padGain: 0.05, padLP: 2400,
    melLo: 67, melHi: 91, kind: 'bell', rest: [1, 4], density: 1,
    shifts: [0, 0, 5, 7], flourish: true, delay: 0.75, fb: 0.38, pluckVel: 0.85,
  },
};

const MELODY_RHYTHMS = [
  [1, 1, 2], [1, 0.5, 0.5, 2], [2, 1, 1, 2], [1.5, 0.5, 1, 1],
  [0.5, 0.5, 1, 1, 1], [1, 2, 1], [3, 1], [2, 2, 1, 1],
];

// Per-element palettes. Water keeps MOOD_DEFS untouched. The same engine and the same four moods
// run for every element; only these fields differ:
//   scale / root / register  - the pitch world
//   kind                     - pluck timbre ('ember' warm plucked string, 'mallet' round wooden bar)
//   rhythms                  - melody rhythm pool (default MELODY_RHYTHMS)
//   padTypes / padGain       - pad waveforms
//   pulse / pulseEvery       - soft pulse under the music ('thump' fire, 'knock' clay, true = water's tick)
//   shimmer:false            - skip the airy noise swells (clay stays earthy)
const FIRE_RHYTHMS = [
  [1, 1, 1, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1.5, 0.5, 1, 1],
  [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 2], [0.5, 1, 0.5, 2], [1, 0.5, 0.5, 0.5, 0.5, 1],
];
const CLAY_RHYTHMS = [
  [2, 1, 1], [2, 2], [1.5, 1.5, 1], [3, 1], [1, 1, 2], [2, 1, 1, 2], [1.5, 0.5, 2],
];
const ELEMENT_MOODS = {
  // warmer, lower, a touch more rhythmic, with a gentle low pulse
  fire: {
    // G mixolydian
    menu: {
      root: 43, scale: [0, 2, 4, 5, 7, 9, 10], chordOff: [0, 2, 4, 8],
      degrees: [[0, 3], [3, 2], [6, 2], [4, 2], [1, 1]],
      bpm: 80, padBeats: [10, 18], padGain: 0.052, padLP: 1100, padTypes: ['sawtooth', 'sine'],
      melLo: 55, melHi: 74, kind: 'ember', rest: [2, 6], density: 0.8, rhythms: FIRE_RHYTHMS,
      shifts: [0, 0, 0, 5, -2], delay: 0.75, fb: 0.3, pluckVel: 0.9, pulse: 'thump',
    },
    // D minor pentatonic
    calm: {
      root: 38, scale: [0, 3, 5, 7, 10], chordOff: [0, 2, 4],
      degrees: [[0, 3], [1, 2], [2, 2], [3, 1], [4, 2]],
      bpm: 64, padBeats: [12, 20], padGain: 0.05, padLP: 800, padTypes: ['sawtooth', 'sine'],
      melLo: 50, melHi: 69, kind: 'ember', rest: [3, 9], density: 0.6, rhythms: FIRE_RHYTHMS,
      shifts: [0, 0, 0, 5, -2, 7], delay: 0.75, fb: 0.32, pluckVel: 0.75, pulse: 'thump',
    },
    // C phrygian dominant: drone and a slow heartbeat
    tense: {
      root: 36, scale: [0, 1, 4, 5, 7, 8, 10], chordOff: [0, 2, 4],
      degrees: [[0, 5], [1, 2], [5, 1], [6, 2]],
      bpm: 62, padBeats: [12, 20], padGain: 0.05, padLP: 600, padTypes: ['sawtooth', 'sine'],
      melLo: 48, melHi: 67, kind: 'ember', rest: [4, 12], density: 0.5, rhythms: FIRE_RHYTHMS,
      shifts: [0, 0, -1, 1], pulse: 'thump', drone: true, delay: 1, fb: 0.28, pluckVel: 0.75,
    },
    // E lydian, warm and rising
    win: {
      root: 52, scale: [0, 2, 4, 6, 7, 9, 11], chordOff: [0, 2, 4, 8],
      degrees: [[0, 3], [1, 2], [4, 2], [5, 2]],
      bpm: 100, padBeats: [8, 14], padGain: 0.05, padLP: 2000, padTypes: ['sawtooth', 'sine'],
      melLo: 62, melHi: 86, kind: 'ember', rest: [1, 4], density: 1, rhythms: FIRE_RHYTHMS,
      shifts: [0, 0, 5, 7], flourish: true, delay: 0.75, fb: 0.34, pluckVel: 0.85, pulse: 'thump',
    },
  },
  // earthy, rounder, slower: wooden mallet tones on pentatonic and modal scales
  clay: {
    // A major pentatonic
    menu: {
      root: 45, scale: [0, 2, 4, 7, 9], chordOff: [0, 2, 4],
      degrees: [[0, 3], [1, 2], [2, 2], [3, 2], [4, 1]],
      bpm: 62, padBeats: [10, 18], padGain: 0.055, padLP: 900, padTypes: ['sine', 'sine'],
      melLo: 57, melHi: 76, kind: 'mallet', rest: [3, 8], density: 0.65, rhythms: CLAY_RHYTHMS,
      shifts: [0, 0, 0, 5, -2, 7], delay: 1.5, fb: 0.3, pluckVel: 0.85, shimmer: false,
    },
    // F suspended pentatonic, very sparse
    calm: {
      root: 41, scale: [0, 2, 5, 7, 9], chordOff: [0, 2, 4],
      degrees: [[0, 3], [1, 2], [2, 2], [3, 1], [4, 2]],
      bpm: 50, padBeats: [12, 20], padGain: 0.05, padLP: 700, padTypes: ['sine', 'sine'],
      melLo: 53, melHi: 72, kind: 'mallet', rest: [4, 12], density: 0.45, rhythms: CLAY_RHYTHMS,
      shifts: [0, 0, 0, 5, -2, 7], delay: 1.5, fb: 0.34, pluckVel: 0.75, drone: true, shimmer: false,
    },
    // D aeolian, drone and a slow wooden knock
    tense: {
      root: 38, scale: [0, 2, 3, 5, 7, 8, 10], chordOff: [0, 2, 4],
      degrees: [[0, 4], [2, 2], [5, 2], [6, 2]],
      bpm: 48, padBeats: [12, 20], padGain: 0.05, padLP: 600, padTypes: ['sine', 'sine'],
      melLo: 50, melHi: 69, kind: 'mallet', rest: [5, 14], density: 0.4, rhythms: CLAY_RHYTHMS,
      shifts: [0, 0, -1, 1], pulse: 'knock', pulseEvery: 4, drone: true, delay: 1.5, fb: 0.28, pluckVel: 0.7, shimmer: false,
    },
    // E major pentatonic
    win: {
      root: 52, scale: [0, 2, 4, 7, 9], chordOff: [0, 2, 4],
      degrees: [[0, 3], [1, 2], [2, 2], [3, 2]],
      bpm: 84, padBeats: [8, 14], padGain: 0.05, padLP: 1800, padTypes: ['sine', 'sine'],
      melLo: 64, melHi: 88, kind: 'mallet', rest: [1, 4], density: 1, rhythms: CLAY_RHYTHMS,
      shifts: [0, 0, 5, 7], flourish: true, delay: 1, fb: 0.32, pluckVel: 0.85, shimmer: false,
    },
  },
};

/** The palette for a mood under an element (water, or anything unknown, gets the original). */
function defFor(mood, element) {
  const e = hasOwn(ELEMENT_MOODS, element) ? ELEMENT_MOODS[element] : null;
  return (e && e[mood]) || MOOD_DEFS[mood];
}

function wpick(pairs) {
  let sum = 0;
  for (const p of pairs) sum += p[1];
  let r = Math.random() * sum;
  for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}

// ---------------------------------------------------------------------------
// The factory
// ---------------------------------------------------------------------------

export function createAudio(opts) {
  opts = opts || {};

  const S = {
    ctx: null, ready: false, unavailable: false,
    musicVol: 0.7, sfxVol: 0.8, muted: false,
    element: 'water', form: 'liquid', mood: null,
    wantSuspended: false,
    errors: 0, lastError: null,
    last: Object.create(null),
    voices: new Set(),
    retired: [],
    run: null, layer: null, retiredLayers: [],
    timer: null, unlockArmed: false, silentPlayed: false,
    nodes: {},
  };
  const N = S.nodes;
  const mkGroup = (cb) => group(cb, () => S.ctx.currentTime);

  const guard = (fn, fallback) => (...a) => {
    try { return fn(...a); } catch (e) { S.errors++; S.lastError = e; return fallback; }
  };

  const ctxClass = () => {
    if (opts.AudioContext !== undefined) return opts.AudioContext;
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    return g.AudioContext || g.webkitAudioContext || null;
  };
  const docRef = () => (opts.document !== undefined ? opts.document
    : (typeof document !== 'undefined' ? document : null));

  function ramp(p, v, tc) {
    const t = S.ctx.currentTime;
    try {
      if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
      else { const cur = p.value; p.cancelScheduledValues(t); p.setValueAtTime(cur, t); }
      p.setTargetAtTime(v, t, tc === undefined ? 0.03 : tc);
    } catch (e) {
      try { p.value = v; } catch (e2) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ graph build
  function build() {
    const c = S.ctx;
    const setp = (p, v) => { try { p.value = v; } catch (e) { /* ignore */ } };

    N.master = c.createGain(); setp(N.master.gain, 0.9);
    N.comp = c.createDynamicsCompressor();
    setp(N.comp.threshold, -16); setp(N.comp.knee, 14); setp(N.comp.ratio, 3.5);
    setp(N.comp.attack, 0.006); setp(N.comp.release, 0.22);
    N.limit = c.createDynamicsCompressor();
    setp(N.limit.threshold, -4); setp(N.limit.knee, 0); setp(N.limit.ratio, 20);
    setp(N.limit.attack, 0.001); setp(N.limit.release, 0.08);
    N.mute = c.createGain(); setp(N.mute.gain, S.muted ? 0 : 1);
    N.master.connect(N.comp); N.comp.connect(N.limit); N.limit.connect(N.mute);
    N.mute.connect(c.destination);

    N.sfxBus = c.createGain(); setp(N.sfxBus.gain, volumeToGain(S.sfxVol) * SFX_BASE);
    N.musicBus = c.createGain(); setp(N.musicBus.gain, volumeToGain(S.musicVol) * MUSIC_BASE);
    N.sfxBus.connect(N.master);
    N.musicBus.connect(N.master);

    N.sfxRev = c.createConvolver();
    N.sfxRev.buffer = makeImpulse(c, 1.1, 3, 1);
    N.sfxRev.connect(N.sfxBus);
    N.musicRev = c.createConvolver();
    N.musicRev.buffer = makeImpulse(c, 3.2, 2.6, 1);
    N.musicRev.connect(N.musicBus);

    N.noise = {
      white: makeNoiseBuffer(c, 'white', 2),
      pink: makeNoiseBuffer(c, 'pink', 2),
      brown: makeNoiseBuffer(c, 'brown', 2),
      crackle: makeNoiseBuffer(c, 'crackle', 5),
      grit: makeNoiseBuffer(c, 'grit', 4),
    };
  }

  // ------------------------------------------------------------ unlock / ctx state
  const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'];

  function playSilent() {
    // iOS: a started (silent) source inside a gesture fully unlocks the context
    const c = S.ctx;
    try {
      const b = c.createBuffer(1, 1, c.sampleRate || 44100);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.onended = () => { try { s.disconnect(); } catch (e) { /* ignore */ } };
      s.start(0);
    } catch (e) { /* ignore */ }
  }

  function onGesture() {
    if (!S.ctx) return;
    resumeCtx();
  }
  function armUnlock() {
    const d = docRef();
    if (!d || S.unlockArmed || typeof d.addEventListener !== 'function') return;
    S.unlockArmed = true;
    for (const e of UNLOCK_EVENTS) d.addEventListener(e, onGesture, { capture: true, passive: true });
  }
  function disarmUnlock() {
    const d = docRef();
    if (!d || !S.unlockArmed || typeof d.removeEventListener !== 'function') { S.unlockArmed = false; return; }
    S.unlockArmed = false;
    for (const e of UNLOCK_EVENTS) d.removeEventListener(e, onGesture, { capture: true });
  }
  function resumeCtx() {
    const c = S.ctx;
    if (!c || S.wantSuspended) return;
    if (c.state === 'running') { disarmUnlock(); return; }
    try {
      playSilent();
      const p = c.resume();
      if (p && typeof p.then === 'function') {
        p.then(() => { if (c.state === 'running') disarmUnlock(); }, () => { /* still blocked */ });
      }
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ pump
  function startPump() {
    if (S.timer !== null || opts.autoPump === false) return;
    const tick = () => {
      S.timer = null;
      pump();
      if (S.ready && !S.wantSuspended) {
        S.timer = setTimeout(tick, PUMP_MS);
        if (S.timer && typeof S.timer.unref === 'function') S.timer.unref();
      }
    };
    S.timer = setTimeout(tick, PUMP_MS);
    if (S.timer && typeof S.timer.unref === 'function') S.timer.unref();
  }
  function stopPump() {
    if (S.timer !== null) { clearTimeout(S.timer); S.timer = null; }
  }

  const pump = guard(() => {
    if (!S.ready) return;
    const now = S.ctx.currentTime;
    const until = now + LOOKAHEAD;
    sweepVoices(now);
    sweepRetired(now);
    if (S.run) S.run.step(now, until);
    if (S.layer && S.layer.event && !S.layer.dead) layerEvents(S.layer, now, until);
  });

  function sweepVoices(now) {
    for (const g of S.voices) if (now > g.end + 1.0) g.kill();
  }
  function sweepRetired(now) {
    if (S.retired.length) {
      S.retired = S.retired.filter((r) => { if (now >= r.killAt) { r.kill(); return false; } return true; });
    }
    if (S.retiredLayers.length) {
      S.retiredLayers = S.retiredLayers.filter((l) => { if (now >= l.killAt) { l.g.kill(); return false; } return true; });
    }
  }

  // ------------------------------------------------------------ sfx
  function makeVoice(t, o) {
    const c = S.ctx;
    const g = mkGroup((gg) => S.voices.delete(gg));
    S.voices.add(g);
    const out = g.add(c.createGain());
    if (o.pan && typeof c.createStereoPanner === 'function') {
      const p = g.add(c.createStereoPanner());
      p.pan.value = o.pan;
      out.connect(p);
      p.connect(N.sfxBus);
    } else {
      out.connect(N.sfxBus);
    }
    if (o.wet > 0) {
      const w = g.add(c.createGain());
      w.gain.value = o.wet;
      out.connect(w);
      w.connect(N.sfxRev);
    }
    const L = o.loud, B = o.bright;
    return {
      g, c, out, L, B, t,
      osc(type, f0, t0, dur, peak, oo) { return mkOsc(c, g, type, f0, t0, dur, peak * L, (oo && oo.to) || out, oo); },
      noise(kind, t0, dur, peak, oo) { return mkNoise(c, N.noise, g, kind, t0, dur, peak * L, (oo && oo.to) || out, oo, B); },
      bell(f, t0, dur, peak, oo) { mkBell(c, g, f, t0, dur, peak * L, (oo && oo.to) || out, oo && oo.ratios); },
      gain(v, to) { const n = g.add(c.createGain()); n.gain.value = v; n.connect(to || out); return n; },
      filter(type, f, q, to) {
        const n = g.add(c.createBiquadFilter());
        n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(to || out);
        return n;
      },
      lfo(rate, depth, param, t0, dur) {
        const o2 = c.createOscillator();
        o2.frequency.value = rate;
        const lg = g.add(c.createGain());
        lg.gain.value = depth;
        o2.connect(lg); lg.connect(param);
        g.start(o2, t0, t0 + dur);
      },
      // one oscillator whose frequency jumps randomly every `step` seconds (electric zap)
      steps(type, t0, dur, peak, step, fmin, fmax, to) {
        const os = c.createOscillator();
        os.type = type;
        for (let k = 0; k * step < dur; k++) os.frequency.setValueAtTime(rnd(fmin, fmax), t0 + k * step);
        const ge = c.createGain();
        env(ge.gain, t0, peak * L, 0.002, dur);
        os.connect(ge); ge.connect(to || out); g.add(ge);
        g.start(os, t0, t0 + dur + 0.04);
      },
    };
  }

  const playSfx = guard((name, o) => {
    if (!S.ready || S.muted || S.wantSuspended) return false;
    if (typeof name !== 'string' || !hasOwn(R, name)) return false;
    const c = S.ctx;
    if (c.state !== 'running') return false;   // never queue stale sounds while locked
    if (S.sfxVol <= 0.001) return false;
    o = (o && typeof o === 'object') ? o : {};
    const I = clamp(fin(o.intensity, 1), 0, 2);
    if (I < 0.02) return false;
    const pan = clamp(fin(o.pan, 0), -1, 1);
    const now = c.currentTime;
    const meta = META[name];
    const last = S.last[name];
    if (last !== undefined && now >= last && now - last < meta.gap) return false;
    S.last[name] = now;
    sweepVoices(now);
    if (S.voices.size >= MAX_VOICES + (meta.prio ? PRIORITY_EXTRA : 0)) return false;
    const t = now + 0.008 + Math.random() * 0.006;
    const V = makeVoice(t, {
      pan, wet: meta.wet,
      loud: Math.min(1.5, Math.pow(I, 0.9)) * meta.trim,
      bright: 0.75 + 0.25 * Math.min(I, 1.5),
    });
    try {
      R[name](V, t, I, 1 + rnd(-0.07, 0.07));
    } catch (e) {
      V.g.kill();
      throw e;
    }
    return true;
  }, false);

  // ------------------------------------------------------------ ambience (per form)
  function buildLayer(form) {
    const c = S.ctx;
    const g = mkGroup();
    const out = g.add(c.createGain());
    out.gain.value = 0;
    if (hasOwn(LAYER_TRIM, form)) {     // fire / clay layers: a fixed level trim after the fade node
      const lvl = g.add(c.createGain());
      lvl.gain.value = LAYER_TRIM[form];
      out.connect(lvl);
      lvl.connect(N.sfxBus);
    } else {
      out.connect(N.sfxBus);
    }
    const t = c.currentTime;
    const nz = (kind) => {
      const s = c.createBufferSource();
      s.buffer = N.noise[kind];
      s.loop = true;
      g.start(s, t, undefined, Math.random() * 1.5);
      return s;
    };
    const filt = (type, f, q, to) => {
      const n = g.add(c.createBiquadFilter());
      n.type = type; n.frequency.value = f; n.Q.value = q;
      n.connect(to);
      return n;
    };
    const gn = (v, to) => { const n = g.add(c.createGain()); n.gain.value = v; n.connect(to); return n; };
    const lfo = (rate, depth, param) => {
      const o = c.createOscillator();
      o.frequency.value = rate;
      const lg = g.add(c.createGain());
      lg.gain.value = depth;
      o.connect(lg); lg.connect(param);
      g.start(o, t);
    };
    const layer = { form, g, out, dead: false, killAt: Infinity, next: 0, event: null, gap: [2, 6] };

    if (form === 'liquid') {          // soft brook with a few drips
      const a = gn(0.07, out);
      const fa = filt('lowpass', 1500, 0.7, a);
      const ba = filt('bandpass', 420, 0.7, fa);
      nz('pink').connect(ba);
      lfo(0.17, 150, ba.frequency);
      const b = gn(0.03, out);
      const bb = filt('bandpass', 900, 1.5, b);
      nz('pink').connect(bb);
      lfo(0.23, 0.02, b.gain);
      lfo(0.31, 220, bb.frequency);
      layer.gap = [1.8, 6.5];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.6, 0.6), wet: 0.3, loud: 1, bright: 1 });
        const f = rnd(700, 1500);
        try {
          v.osc('sine', f, tt, 0.12, 0.05, { f1: f * 1.9, ft: 0.05, atk: 0.003 });
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'ice') {      // faint glassy shimmer
      const a = gn(0.03, out);
      const bp = filt('bandpass', 6000, 6, a);
      nz('white').connect(bp);
      lfo(0.11, 0.015, a.gain);
      [2093, 3136].forEach((f, i) => {
        const o = c.createOscillator();
        o.type = 'sine'; o.frequency.value = f * (1 + i * 0.0007);
        const og = gn(0.006, out);
        o.connect(og);
        g.start(o, t);
        lfo(0.3 + i * 0.13, 0.004, og.gain);
      });
      layer.gap = [3, 8];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.7, 0.7), wet: 0.4, loud: 1, bright: 1 });
        try {
          v.osc('sine', rnd(3200, 5200), tt, 0.28, 0.022, { atk: 0.002 });
          v.noise('white', tt, 0.012, 0.03, { type: 'highpass', f0: 6000, atk: 0.001 });
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'steam') {    // airy hiss with a soft rumble under it
      const a = gn(0.06, out);
      const bp = filt('bandpass', 3200, 0.4, a);
      nz('white').connect(bp);
      lfo(0.2, 0.02, a.gain);
      const b = gn(0.03, out);
      const lp = filt('lowpass', 400, 0.7, b);
      nz('pink').connect(lp);
    } else if (form === 'film') {     // wet whisper
      const a = gn(0.05, out);
      const bp = filt('bandpass', 1100, 3, a);
      nz('pink').connect(bp);
      lfo(0.4, 300, bp.frequency);
      const b = gn(0.03, out);
      const lp = filt('lowpass', 150, 0.7, b);
      nz('brown').connect(lp);
    } else if (form === 'ember') {    // soft crackling glow: warm low bed, two layers of small pops
      const a = gn(0.02, out);
      const lp = filt('lowpass', 420, 0.7, a);
      nz('brown').connect(lp);
      lfo(0.13, 0.008, a.gain);
      const b = gn(0.2, out);
      const bp = filt('bandpass', 2600, 0.8, b);
      nz('crackle').connect(bp);
      lfo(0.19, 0.08, b.gain);
      const c2 = gn(0.12, out);
      const lp2 = filt('lowpass', 1400, 0.7, c2);
      nz('crackle').connect(lp2);
      layer.gap = [0.9, 3.2];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.6, 0.6), wet: 0.15, loud: 1, bright: 1 });
        try {
          v.noise('white', tt, 0.02, 0.05, { type: 'bandpass', f0: rnd(1500, 3500), q: 4, atk: 0.001 });
          const f = rnd(90, 140);
          v.osc('sine', f, tt, 0.07, 0.03, { f1: f * 0.5, ft: 0.06, atk: 0.003 });
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'blaze') {    // roaring, breathy flame: flickering mid roar, low rumble, airy breath
      const a = gn(0.1, out);
      const bp = filt('bandpass', 520, 0.6, a);
      nz('pink').connect(bp);
      lfo(0.7, 120, bp.frequency);
      lfo(1.9, 0.04, a.gain);
      const b = gn(0.06, out);
      const lp = filt('lowpass', 180, 0.7, b);
      nz('brown').connect(lp);
      lfo(0.4, 0.025, b.gain);
      const c2 = gn(0.035, out);
      const bp2 = filt('bandpass', 2400, 0.5, c2);
      nz('white').connect(bp2);
      lfo(0.28, 0.02, c2.gain);
      lfo(0.5, 700, bp2.frequency);
      const d = gn(0.12, out);
      const bp3 = filt('bandpass', 1800, 0.8, d);
      nz('crackle').connect(bp3);
      layer.gap = [2.5, 7];
      layer.event = (tt) => {           // a slow low "whoomp" now and then
        const v = makeVoice(tt, { pan: rnd(-0.4, 0.4), wet: 0.2, loud: 1, bright: 1 });
        try {
          v.osc('sine', rnd(55, 70), tt, 0.9, 0.035, { atk: 0.25 });
          v.noise('pink', tt, 0.8, 0.03, { type: 'lowpass', f0: 400, q: 0.7, atk: 0.3 });
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'smoke') {    // muffled, airy drift: low-passed, slowly wandering band
      const a = gn(0.07, out);
      const lp = filt('lowpass', 800, 0.6, a);
      const bp = filt('bandpass', 400, 0.5, lp);
      nz('pink').connect(bp);
      lfo(0.06, 220, bp.frequency);
      lfo(0.09, 0.025, a.gain);
      const b = gn(0.025, out);
      const lp2 = filt('lowpass', 1500, 0.5, b);
      const bp2 = filt('bandpass', 1100, 0.3, lp2);
      nz('white').connect(bp2);
      lfo(0.11, 400, bp2.frequency);
      layer.gap = [3.5, 9];
      layer.event = (tt) => {           // a soft far-off puff
        const v = makeVoice(tt, { pan: rnd(-0.6, 0.6), wet: 0.3, loud: 1, bright: 1 });
        try {
          v.noise('pink', tt, 0.8, 0.02, { type: 'bandpass', f0: 450, q: 0.8, atk: 0.3 });
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'spark') {    // thin electric fizz: high, grainy, amplitude-buzzed, with tiny zaps
      const a = gn(0.02, out);
      const bp = filt('bandpass', 7200, 3.5, a);
      nz('white').connect(bp);
      lfo(31, 0.012, a.gain);
      lfo(47, 0.006, a.gain);
      const b = gn(0.14, out);
      const hp = filt('bandpass', 6500, 0.6, b);
      nz('grit').connect(hp);
      layer.gap = [1.2, 5];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.7, 0.7), wet: 0.1, loud: 1, bright: 1 });
        try {
          v.steps('square', tt, 0.06, 0.02, 0.008, 1800, 6000, v.filter('highpass', 1500, 0.7));
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'clay') {     // soft damp thud-and-squelch bed
      const a = gn(0.1, out);
      const lp = filt('bandpass', 260, 0.8, a);
      nz('pink').connect(lp);
      lfo(0.21, 0.035, a.gain);
      const b = gn(0.05, out);
      const bp = filt('bandpass', 520, 1.2, b);
      nz('pink').connect(bp);
      lfo(0.15, 0.025, b.gain);
      lfo(0.12, 160, bp.frequency);
      layer.gap = [0.9, 3];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.5, 0.5), wet: 0.12, loud: 1, bright: 1 });
        try {
          if (Math.random() < 0.5) {      // thud
            const f = rnd(110, 170);
            v.osc('sine', f, tt, 0.18, 0.09, { f1: f * 0.5, ft: 0.14, atk: 0.004 });
            v.noise('pink', tt, 0.1, 0.07, { type: 'lowpass', f0: 600, q: 0.7, atk: 0.003 });
          } else {                        // squelch
            const f = rnd(200, 340);
            v.osc('sine', f, tt, 0.14, 0.06, { f1: f * 0.45, ft: 0.1, atk: 0.005 });
            v.noise('pink', tt, 0.12, 0.06, { type: 'bandpass', f0: 1000, f1: 450, q: 3, atk: 0.004 });
          }
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'slip') {     // thick slow pour: low, smooth, viscous, with the occasional glug
      const a = gn(0.1, out);
      const bp = filt('bandpass', 420, 1.3, a);
      nz('pink').connect(bp);
      lfo(0.1, 100, bp.frequency);
      lfo(0.14, 0.04, a.gain);
      const b = gn(0.03, out);
      const lp = filt('lowpass', 150, 0.7, b);
      nz('brown').connect(lp);
      lfo(0.07, 0.012, b.gain);
      const c2 = gn(0.05, out);
      const bp3 = filt('bandpass', 750, 2, c2);
      nz('pink').connect(bp3);
      lfo(0.5, 180, bp3.frequency);
      layer.gap = [2, 5.5];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.4, 0.4), wet: 0.2, loud: 1, bright: 1 });
        try {
          const f = rnd(150, 260);
          v.osc('sine', f, tt, 0.3, 0.05, { f1: f * 1.6, ft: 0.22, atk: 0.04 });
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'stone') {    // dry stony scrape and rumble, with pebble clacks
      const a = gn(0.05, out);
      const lp = filt('lowpass', 150, 0.7, a);
      nz('brown').connect(lp);
      lfo(0.11, 0.02, a.gain);
      const b = gn(0.09, out);
      const bp = filt('bandpass', 1500, 2.2, b);
      nz('white').connect(bp);
      lfo(0.43, 0.05, b.gain);
      lfo(0.97, 0.03, b.gain);
      lfo(0.3, 500, bp.frequency);
      const c2 = gn(0.3, out);
      const bp2 = filt('bandpass', 900, 1, c2);
      nz('grit').connect(bp2);
      layer.gap = [0.8, 3.5];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.6, 0.6), wet: 0.1, loud: 1, bright: 1 });
        try {
          if (Math.random() < 0.75) {     // pebble clack
            v.osc('sine', rnd(500, 1100), tt, 0.05, 0.035, { atk: 0.001 });
            v.noise('white', tt, 0.02, 0.04, { type: 'bandpass', f0: 2400, q: 5, atk: 0.001 });
          } else {                        // a short grind
            v.noise('pink', tt, 0.5, 0.04, { type: 'bandpass', f0: 700, f1: 400, q: 1.2, atk: 0.1 });
          }
        } catch (e) { v.g.kill(); throw e; }
      };
    } else if (form === 'dust') {     // fine papery hiss, grainy, with soft sifting
      const a = gn(0.05, out);
      const hp = filt('highpass', 3500, 0.5, a);
      const bp = filt('bandpass', 5000, 0.7, hp);
      nz('white').connect(bp);
      lfo(0.16, 0.015, a.gain);
      lfo(9, 0.012, a.gain);
      const b = gn(0.15, out);
      const bp2 = filt('bandpass', 4500, 1, b);
      nz('grit').connect(bp2);
      lfo(0.23, 0.05, b.gain);
      const c2 = gn(0.02, out);
      const bp3 = filt('bandpass', 1500, 0.5, c2);
      nz('pink').connect(bp3);
      layer.gap = [0.5, 2];
      layer.event = (tt) => {
        const v = makeVoice(tt, { pan: rnd(-0.7, 0.7), wet: 0.1, loud: 1, bright: 1 });
        try {
          v.noise('grit', tt, 0.15, 0.02, { type: 'bandpass', f0: 4000, q: 1, atk: 0.01 });
        } catch (e) { v.g.kill(); throw e; }
      };
    }
    return layer;
  }

  function layerEvents(layer, now, until) {
    if (layer.next < now) layer.next = now + rnd(layer.gap[0], layer.gap[1]) * 0.5;
    let guardN = 0;
    while (layer.next < until && guardN++ < 4) {
      if (S.voices.size < MAX_VOICES - 4) layer.event(Math.max(layer.next, now + 0.02));
      layer.next += rnd(layer.gap[0], layer.gap[1]);
    }
  }

  function applyForm() {
    if (!S.ready) return;
    const now = S.ctx.currentTime;
    const cur = S.layer;
    if (cur && cur.form === S.form) return;
    if (cur) {
      ramp(cur.out.gain, 0, FORM_FADE_TC);
      cur.killAt = now + 2.2;
      cur.dead = true;
      cur.g.stopAll(now + 2.2);
      S.retiredLayers.push(cur);
    }
    S.layer = null;
    if (S.form) {
      const l = buildLayer(S.form);
      l.next = now + rnd(0.5, 2);
      ramp(l.out.gain, 1, FORM_FADE_TC);
      S.layer = l;
    }
  }

  // ------------------------------------------------------------ music
  function createRun(name, startAt) {
    const c = S.ctx;
    const element = S.element;
    const def = defFor(name, element);
    const beat = 60 / def.bpm;
    const L = def.scale.length;
    const pg = mkGroup();
    const run = {
      name, element, def, pg, groups: new Set(), killAt: Infinity, retiring: false, dead: false,
      energy: 0.7, log: [], plan: [], stats: { chords: 0, plucks: 0, phrases: 0, pulses: 0 },
    };

    // persistent graph for this run
    const out = pg.add(c.createGain());
    out.gain.value = 0;
    out.connect(N.musicBus);
    const wet = pg.add(c.createGain());
    wet.gain.value = 0.32;
    out.connect(wet); wet.connect(N.musicRev);
    const padLP = pg.add(c.createBiquadFilter());
    padLP.type = 'lowpass'; padLP.frequency.value = def.padLP; padLP.Q.value = 0.5;
    padLP.connect(out);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = pg.add(c.createGain());
    lg.gain.value = def.padLP * 0.25;
    lfo.connect(lg); lg.connect(padLP.frequency);
    pg.start(lfo, startAt);
    const pluckBus = pg.add(c.createGain());
    pluckBus.connect(out);
    const dly = pg.add(c.createDelay(4));
    dly.delayTime.value = def.delay * beat;
    const fb = pg.add(c.createGain());
    fb.gain.value = def.fb;
    const dlp = pg.add(c.createBiquadFilter());
    dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    const dsend = pg.add(c.createGain());
    dsend.gain.value = 0.35;
    pluckBus.connect(dsend); dsend.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly); dlp.connect(out);
    run.out = out;

    if (def.drone) {
      const dg = pg.add(c.createGain());
      dg.gain.value = 0.045;
      dg.connect(out);
      const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = mtof(def.root);
      const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(def.root + 12) * 1.002;
      const dg2 = pg.add(c.createGain()); dg2.gain.value = 0.35;
      o1.connect(dg); o2.connect(dg2); dg2.connect(dg);
      pg.start(o1, startAt); pg.start(o2, startAt);
      const tl = c.createOscillator(); tl.frequency.value = 0.13;
      const tlg = pg.add(c.createGain()); tlg.gain.value = 0.02;
      tl.connect(tlg); tlg.connect(dg.gain);
      pg.start(tl, startAt);
    }

    const mgroup = () => {
      const g = mkGroup((gg) => run.groups.delete(gg));
      run.groups.add(g);
      return g;
    };

    // --- harmony ---------------------------------------------------------
    const scaleMidi = (n) => { const q = Math.floor(n / L); return def.scale[n - q * L] + 12 * q; };
    const mod = (n) => ((n % L) + L) % L;
    const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
    let chordCount = 0;
    let shift = 0;
    let nextShiftAt = 5 + ((Math.random() * 5) | 0);

    function pickDegree(prev) {
      let d;
      if (prev === undefined) return def.degrees[0][0];
      if (chordCount % 4 === 0 && Math.random() < 0.5 && prev !== def.degrees[0][0]) return def.degrees[0][0];
      let guardN = 0;
      do { d = wpick(def.degrees); } while (d === prev && guardN++ < 8);
      return d;
    }

    function planChord() {
      const prev = run.plan[run.plan.length - 1];
      const t0 = prev ? prev.t1 : startAt;
      const d = pickDegree(prev ? prev.d : undefined);
      chordCount++;
      if (chordCount >= nextShiftAt) {
        shift = pick(def.shifts);
        nextShiftAt = chordCount + 5 + ((Math.random() * 5) | 0);
      }
      const beats = def.padBeats[0] + Math.floor(Math.random() * (def.padBeats[1] - def.padBeats[0] + 1));
      const rs = def.root + shift;
      const tones = def.chordOff.map((o) => fold(rs + scaleMidi(d + o), rs + 5, rs + 19)).sort((a, b) => a - b);
      const bass = fold(rs + scaleMidi(d), rs - 12, rs - 1);
      const set = new Set(def.chordOff.map((o) => mod(d + o)));
      run.plan.push({ t0, t1: t0 + beats * beat, d, shift, tones, bass, set, sounded: false });
      run.stats.chords++;
    }

    const padT = def.padTypes || ['triangle', 'sine'];
    function soundChord(ch) {
      const g = mgroup();
      const t0 = ch.t0, D = ch.t1 - ch.t0;
      const A = Math.min(3.4, D * 0.3), Rl = Math.min(4.5, D * 0.4);
      const stopT = ch.t1 + Rl + 0.05;
      const voice = (f, type, peak, detune, to) => {
        const os = c.createOscillator();
        os.type = type;
        os.frequency.value = f;
        os.detune.value = detune;
        const ge = c.createGain();
        const p = ge.gain;
        p.setValueAtTime(0.0001, t0);
        p.linearRampToValueAtTime(peak, t0 + A);
        p.setValueAtTime(peak, ch.t1);
        p.exponentialRampToValueAtTime(0.0001, ch.t1 + Rl);
        os.connect(ge); ge.connect(to);
        g.add(ge);
        g.start(os, t0, stopT);
      };
      ch.tones.forEach((m, i) => {
        let to = padLP;
        if (typeof c.createStereoPanner === 'function') {
          const pn = g.add(c.createStereoPanner());
          pn.pan.value = (i % 2 ? -1 : 1) * (0.25 + 0.1 * (i >> 1));
          pn.connect(padLP);
          to = pn;
        }
        const f = mtof(m);
        voice(f, padT[0], def.padGain * 0.6, -(3 + Math.random() * 3), to);
        voice(f, padT[1], def.padGain * 0.8, 3 + Math.random() * 3, to);
      });
      const bf = mtof(ch.bass);
      voice(bf, 'sine', def.padGain * 1.6, 0, padLP);
      voice(bf, padT[0], def.padGain * 0.5, 2, padLP);
    }

    const chordAt = (t) => {
      const p = run.plan;
      for (let i = p.length - 1; i >= 0; i--) if (p[i].t0 <= t) return p[i];
      return p[0];
    };

    // --- instruments -----------------------------------------------------
    function soundPluck(t, midi, vel, pan, kind) {
      const g = mgroup();
      let dest = pluckBus;
      if (pan && typeof c.createStereoPanner === 'function') {
        const pn = g.add(c.createStereoPanner());
        pn.pan.value = pan;
        pn.connect(pluckBus);
        dest = pn;
      }
      const f = mtof(midi);
      if (kind === 'bell') {
        mkBell(c, g, f, t, 2.4, 0.2 * vel, dest, [1, 2.76, 5.4]);
      } else if (kind === 'ember') {      // fire: warm plucked string with a tiny crackle of pick
        const dur = clamp(1.6 - (midi - 50) * 0.025, 0.7, 1.5);
        mkOsc(c, g, 'triangle', f, t, dur, 0.2 * vel, dest, { atk: 0.003 });
        mkOsc(c, g, 'sine', f * 2, t, 0.35, 0.07 * vel, dest, { atk: 0.002 });
        mkNoise(c, N.noise, g, 'crackle', t, 0.05, 0.04 * vel, dest, { type: 'bandpass', f0: clamp(f * 4, 1000, 5000), q: 1, atk: 0.002 }, 1);
      } else if (kind === 'mallet') {     // clay: round wooden bar, soft thunk underneath
        mkOsc(c, g, 'sine', f, t, 0.6, 0.3 * vel, dest, { atk: 0.005 });
        mkOsc(c, g, 'sine', f * 3.9, t, 0.08, 0.1 * vel, dest, { atk: 0.002 });
        mkOsc(c, g, 'sine', f * 0.5, t, 0.25, 0.08 * vel, dest, { atk: 0.004 });
        mkNoise(c, N.noise, g, 'pink', t, 0.025, 0.06 * vel, dest, { type: 'bandpass', f0: clamp(f * 2, 300, 3000), q: 2, atk: 0.001 }, 1);
      } else if (kind === 'marimba') {
        mkOsc(c, g, 'sine', f, t, 0.75, 0.3 * vel, dest, { atk: 0.004 });
        mkOsc(c, g, 'sine', f * 4, t, 0.09, 0.09 * vel, dest, { atk: 0.002 });
      } else {
        const dur = clamp(2.6 - (midi - 50) * 0.03, 1, 2.4);
        mkOsc(c, g, 'sine', f, t, dur, 0.26 * vel, dest, { atk: 0.004 });
        mkOsc(c, g, 'sine', f * 4, t, 0.12, 0.06 * vel, dest, { atk: 0.002 });
        mkOsc(c, g, 'triangle', f * 2, t, 0.5, 0.04 * vel, dest, { atk: 0.003 });
      }
      run.stats.plucks++;
      if (run.log.length < 6000) run.log.push(midi);
    }

    function soundTick(t, kind) {    // soft "clock" for the tense mood (water); fire / clay get their own pulse
      run.stats.pulses++;
      const g = mgroup();
      if (kind === 'thump') {          // fire: a soft low heartbeat with a faint crackle
        mkOsc(c, g, 'sine', 70, t, 0.26, 0.07, out, { f1: 46, ft: 0.2, atk: 0.004 });
        mkNoise(c, N.noise, g, 'crackle', t, 0.1, 0.03, out, { type: 'bandpass', f0: 2400, q: 1.2, atk: 0.002 }, 1);
      } else if (kind === 'knock') {   // clay: a slow wooden knock
        mkOsc(c, g, 'sine', 150, t, 0.14, 0.06, out, { f1: 95, ft: 0.1, atk: 0.003 });
        mkNoise(c, N.noise, g, 'pink', t, 0.03, 0.025, out, { type: 'bandpass', f0: 700, q: 2, atk: 0.001 }, 1);
      } else {
        mkOsc(c, g, 'sine', 220, t, 0.12, 0.05, out, { f1: 160, ft: 0.1, atk: 0.003 });
        mkNoise(c, N.noise, g, 'white', t, 0.03, 0.02, out, { type: 'bandpass', f0: 3000, q: 2, atk: 0.001 }, 1);
      }
    }

    function soundShimmer(t, ch) {   // rare airy swell
      const g = mgroup();
      const f = mtof(ch.tones[ch.tones.length - 1] + 24);
      mkNoise(c, N.noise, g, 'white', t, 7, 0.045, out, { type: 'bandpass', f0: clamp(f, 1500, 6000), q: 10, atk: 3, nb: true }, 1);
      mkOsc(c, g, 'sine', clamp(f, 800, 5000), t, 7, 0.02, out, { atk: 3 });
    }

    // --- melody ----------------------------------------------------------
    const mel = { next: startAt + beat * (2 + Math.random() * 3), phrase: null, lastN: null };
    const bank = [];

    const nextStep = () => {
      if (Math.random() < 0.1) return (Math.random() < 0.5 ? -1 : 1) * (3 + (Math.random() < 0.4 ? 1 : 0));
      return wpick([[-2, 0.16], [-1, 0.3], [0, 0.04], [1, 0.3], [2, 0.16]]);
    };
    function newMotif() {
      const dur = pick(def.rhythms || MELODY_RHYTHMS).slice();
      const steps = dur.map((_, i) => (i === 0 ? 0 : nextStep()));
      return { dur, steps };
    }
    function varyMotif(m) {
      const dur = m.dur.slice(), steps = m.steps.slice();
      switch ((Math.random() * 5) | 0) {
        case 0: for (let i = 0; i < steps.length; i++) steps[i] = -steps[i]; break;
        case 1: { const i = 1 + ((Math.random() * (steps.length - 1)) | 0); if (steps.length > 1) steps[i] += Math.random() < 0.5 ? -1 : 1; break; }
        case 2: if (dur.length > 2) { dur.pop(); steps.pop(); } break;
        case 3: if (dur.reduce((a, b) => a + b, 0) <= 4) for (let i = 0; i < dur.length; i++) dur[i] *= 2; break;
        default: { const rest = steps.slice(1).reverse(); for (let i = 1; i < steps.length; i++) steps[i] = rest[i - 1]; }
      }
      return { dur, steps };
    }
    const nearN = (target, sh) => {
      let best = 0, bd = 1e9;
      for (let n = -20; n < 40; n++) {
        const dd = Math.abs(def.root + sh + scaleMidi(n) - target);
        if (dd < bd) { bd = dd; best = n; }
      }
      return best;
    };
    const snap = (n, set) => {
      for (const dl of [0, 1, -1, 2, -2]) if (set.has(mod(n + dl))) return n + dl;
      return n;
    };

    function beginPhrase() {
      run.energy = clamp(run.energy + (Math.random() - 0.5) * 0.4, 0.25, 1);
      if (Math.random() > def.density * (0.55 + 0.45 * run.energy)) {
        mel.next += beat * Math.round(rnd(def.rest[0], def.rest[1]));
        return false;
      }
      let m;
      if (bank.length && Math.random() < 0.5) {
        m = varyMotif(pick(bank));
      } else {
        m = newMotif();
      }
      bank.push(m);
      if (bank.length > 5) bank.shift();
      mel.phrase = { m, i: 0, pos: 0, rep: 0, reps: Math.random() < 0.35 ? 2 : 1, shift: pick([0, 0, -1, 1, 2, -2]), n: null };
      run.stats.phrases++;
      return true;
    }

    function melStep(now, until) {
      let guardN = 0;
      while (mel.next < until && guardN++ < 24) {
        if (mel.next < now - 0.05) mel.next = now + 0.05;
        if (!mel.phrase) { if (!beginPhrase()) continue; }
        const ph = mel.phrase;
        const ch = chordAt(mel.next);
        const sh = ch.shift;
        const dur = ph.m.dur[ph.i];
        let n;
        if (ph.n === null) {
          const center = mel.lastN === null ? nearN((def.melLo + def.melHi) / 2, sh) : mel.lastN;
          n = snap(center + ph.shift, ch.set);
        } else {
          n = ph.n + ph.m.steps[ph.i];
          if (ph.pos % 1 === 0 && dur >= 1 && Math.random() < 0.75) n = snap(n, ch.set);
        }
        let midi = def.root + sh + scaleMidi(n);
        while (midi > def.melHi) { n -= L; midi -= 12; }
        while (midi < def.melLo) { n += L; midi += 12; }
        ph.n = n; mel.lastN = n;
        if (Math.random() > 0.06) {
          const strong = ph.pos % 1 === 0;
          const vel = def.pluckVel * (0.6 + 0.4 * run.energy) * (strong ? 0.95 : 0.7 + Math.random() * 0.2);
          soundPluck(mel.next + (Math.random() - 0.5) * 0.024, midi, vel, rnd(-0.45, 0.45), def.kind);
        }
        mel.next += dur * beat;
        ph.pos += dur;
        ph.i++;
        if (ph.i >= ph.m.dur.length) {
          ph.rep++;
          if (ph.rep < ph.reps) {
            ph.i = 0; ph.pos = 0; ph.n = null; ph.shift = pick([-2, -1, 1, 2]);
            mel.next += beat * pick([0, 1, 2]);
          } else {
            mel.phrase = null;
            mel.next += beat * Math.round(rnd(def.rest[0], def.rest[1]) * (1.6 - run.energy));
          }
        }
      }
    }

    const pulse = { next: startAt + beat };
    const tex = { next: startAt + rnd(18, 40) };
    let flourished = !def.flourish;

    run.step = (now, until) => {
      if (run.retiring || run.dead) return;
      let guardN = 0;
      while ((run.plan.length === 0 || run.plan[run.plan.length - 1].t1 < until + 8) && guardN++ < 6) planChord();
      for (const ch of run.plan) if (!ch.sounded && ch.t0 < until) { ch.sounded = true; soundChord(ch); }
      while (run.plan.length > 2 && run.plan[0].t1 < now - 2) run.plan.shift();
      if (!flourished) {
        flourished = true;
        const ch = run.plan[0];
        const t0 = Math.max(startAt, now) + 0.25;
        ch.tones.concat([ch.tones[0] + 12]).forEach((m, i) => soundPluck(t0 + i * 0.17, m + 12, 0.8, (i % 2 ? 1 : -1) * 0.3, 'bell'));
      }
      melStep(now, until);
      if (def.pulse) {
        guardN = 0;
        while (pulse.next < until && guardN++ < 8) {
          if (pulse.next < now) pulse.next = now + 0.05;
          if (Math.random() < 0.85) soundTick(pulse.next, def.pulse);
          pulse.next += beat * (def.pulseEvery || 2);
        }
      }
      if (tex.next < until) {
        if (def.shimmer !== false) soundShimmer(Math.max(tex.next, now + 0.05), chordAt(tex.next));
        tex.next += rnd(35, 80);
      }
    };

    run.kill = () => {
      if (run.dead) return;
      run.dead = true;
      for (const g of Array.from(run.groups)) g.kill();
      pg.kill();
    };
    return run;
  }

  function applyMusic() {
    if (!S.ready) return;
    const want = S.mood;
    const cur = S.run;
    if (cur && cur.name === want && cur.element === S.element && !cur.retiring) return;
    const c = S.ctx;
    const now = c.currentTime;
    const XF = want === 'win' ? 1.0 : 2.4;
    if (cur) {
      cur.retiring = true;
      ramp(cur.out.gain, 0, XF / 4);
      cur.killAt = now + XF * 1.8 + 0.2;
      S.retired.push(cur);
    }
    S.run = null;
    if (want) {
      const r = createRun(want, now + 0.12);
      const p = r.out.gain;
      try {
        const n = 24, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) curve[i] = Math.sin((i / (n - 1)) * Math.PI / 2);
        p.setValueAtTime(0, now);
        p.setValueCurveAtTime(curve, now, XF);
      } catch (e) {
        try { p.linearRampToValueAtTime(1, now + XF); } catch (e2) { p.value = 1; }
      }
      S.run = r;
    }
  }

  // ------------------------------------------------------------ remembered state -> graph
  function applyAll() {
    ramp(N.sfxBus.gain, volumeToGain(S.sfxVol) * SFX_BASE, 0.02);
    ramp(N.musicBus.gain, volumeToGain(S.musicVol) * MUSIC_BASE, 0.02);
    ramp(N.mute.gain, S.muted ? 0 : 1, 0.02);
    applyForm();
    applyMusic();
  }

  // ------------------------------------------------------------ public API
  const api = {
    init: guard(() => {
      if (S.ready) { resumeCtx(); return true; }
      const C = ctxClass();
      if (!C) { S.unavailable = true; return false; }
      let ctx = null;
      try { ctx = new C({ latencyHint: 'interactive' }); } catch (e) {
        try { ctx = new C(); } catch (e2) { ctx = null; }
      }
      if (!ctx) { S.unavailable = true; return false; }
      S.ctx = ctx;
      try {
        build();
      } catch (e) {
        S.errors++; S.lastError = e;
        S.ready = false; S.ctx = null; S.unavailable = true;
        try { if (ctx.close) ctx.close(); } catch (e2) { /* ignore */ }
        return false;
      }
      S.ready = true;
      S.unavailable = false;
      try {
        ctx.onstatechange = () => { if (S.ctx && ctx.state !== 'running' && !S.wantSuspended) armUnlock(); };
      } catch (e) { /* ignore */ }
      armUnlock();
      resumeCtx();
      applyAll();
      startPump();
      return true;
    }, false),

    setMuted: guard((b) => {
      S.muted = !!b;
      if (S.ready) ramp(N.mute.gain, S.muted ? 0 : 1, 0.02);
    }),

    setVolume: guard((music, sfx) => {
      if (typeof music === 'number' && Number.isFinite(music)) S.musicVol = clamp(music, 0, 1);
      if (typeof sfx === 'number' && Number.isFinite(sfx)) S.sfxVol = clamp(sfx, 0, 1);
      if (S.ready) {
        ramp(N.musicBus.gain, volumeToGain(S.musicVol) * MUSIC_BASE, 0.02);
        ramp(N.sfxBus.gain, volumeToGain(S.sfxVol) * SFX_BASE, 0.02);
      }
    }),

    playSfx,

    // Element = which family of forms / ambience / music palette is active. Unknown values are
    // ignored. A form that does not belong to the new element moves to that element's default
    // form (a form that is off stays off); setForm() then picks the real one.
    setElement: guard((el) => {
      if (typeof el !== 'string' || !hasOwn(ELEMENT_FORMS, el)) return;
      if (S.element === el) return;
      S.element = el;
      if (S.form !== null && !ELEMENT_FORMS[el].includes(S.form)) S.form = ELEMENT_FORMS[el][0];
      applyForm();
      applyMusic();
    }),

    setForm: guard((form) => {
      if (form !== null && !(typeof form === 'string' && ELEMENT_FORMS[S.element].includes(form))) return;
      S.form = form;
      applyForm();
    }),

    setMusic: guard((mood) => {
      if (mood !== null && !(typeof mood === 'string' && hasOwn(MOOD_DEFS, mood))) return;
      S.mood = mood;
      applyMusic();
    }),

    suspend: guard(() => {
      if (!S.ready) return;
      S.wantSuspended = true;
      stopPump();
      try { const p = S.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }),

    resume: guard(() => {
      if (!S.ready) return;
      S.wantSuspended = false;
      resumeCtx();
      startPump();
    }),

    getState() {
      return {
        initialised: S.ready, available: !S.unavailable,
        muted: S.muted, musicVolume: S.musicVol, sfxVolume: S.sfxVol,
        element: S.element, form: S.form, mood: S.mood,
        ctxState: S.ctx ? S.ctx.state : null,
        suspended: S.wantSuspended,
        voices: S.voices.size, maxVoices: MAX_VOICES + PRIORITY_EXTRA,
        errors: S.errors, lastError: S.lastError ? String(S.lastError && S.lastError.stack || S.lastError) : null,
      };
    },
    _pump() { pump(); },
    _debug() { return S; },
  };
  return api;
}

export const audio = createAudio();
export default audio;
