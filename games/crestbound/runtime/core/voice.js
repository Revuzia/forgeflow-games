/**
 * CRESTBOUND — runtime/core/voice.js
 * ---------------------------------------------------------------------------
 * NIM'S VOICE — a procedural, ORIGINAL gibberish voice. Web Audio only: no
 * audio files, no sampled voice, no paid service, no borrowed catch-phrase.
 *
 *   const v = new Voice(audio);        // audio = core/audio.js Audio (ctx, sfxBus)
 *   v.onEvent(name, a, b, c);          // the Player forwards every event it emits
 *   v.update(dt, player);              // idle mutters / shivers / pants
 *   v.bark(name, opts?) -> bool        // fire one line directly
 *   v.stats                            // {fired, dropped, byName, log[16]}
 *   Voice.renderOffline(name, opts)    // Promise<AudioBuffer> — the harness proof
 *
 * HOW IT SPEAKS. A little formant synthesiser: ONE sawtooth glottal source per
 * line, pitch-contoured syllable by syllable, run through three PARALLEL
 * band-pass formant filters (F1/F2/F3) whose centres are automated from vowel
 * to vowel, then a single amplitude envelope that gates the syllables. Onsets
 * and codas are shaped noise (h, s, f), plosive bursts (p b t d k g), nasal
 * murmurs (m n) or formant GLIDES (w y r l). The formants are a child-sized,
 * cartoon-bright set (roughly a small speaker's /a e i o u/), so the same
 * gibberish reads as a small, eager explorer rather than as a synth blip.
 *
 * Every line is invented gibberish ("hu!", "wi-HOO", "hu-pa", "yi-pa-HAA!",
 * "mm-ba-lo ti-ru") — original, and never a word of any existing character.
 *
 * NEVER SPAMS (four independent gates, all measured by `stats.dropped`):
 *   1. a global gap — no line starts within GAP_S of the last one;
 *   2. per-line cooldowns (`cd`) — a mashed punch cannot machine-gun "hi!";
 *   3. a rolling budget — at most BUDGET lines per BUDGET_WINDOW_S;
 *   4. no talking over yourself — a lower-priority line never starts while a
 *      higher-or-equal-priority one is still sounding. Hurt / death / crest are
 *      PRIORITY lines and pass gates 1 and 3.
 * Common lines also have a probability (a single jump barks ~4 times in 5), so
 * a long run of plain hops breathes instead of chanting.
 *
 * PITCH PER JUMP IN THE CHAIN: jump1 < jump2 < jump3 by construction (base f0
 * multipliers 1.00 -> 1.14 -> 1.32 -> a 1.62 peak on the triple's "HOO"), plus
 * a small random jitter so no two hops are the same take.
 *
 * Allocation: a line allocates its Web Audio nodes (that is what Web Audio is);
 * nothing allocates per FRAME — `update()` is timer arithmetic only.
 * ---------------------------------------------------------------------------
 */

/* ============================== tunables ============================== */

/** Nim's speaking fundamental (Hz): a small, bright voice. */
export const BASE_F0 = 292;
/** No line starts within this long of the last one (non-priority lines). */
const GAP_S = 0.12;
/** Rolling budget: at most BUDGET non-priority lines per BUDGET_WINDOW_S. */
const BUDGET = 5;
const BUDGET_WINDOW_S = 2.5;
/** Output level into the sfx bus, and the reverb send. */
const OUT_GAIN = 0.34;
const VERB_SEND = 0.10;
/** Idle mutters: first after this much stillness, then every MUTTER_MIN..MAX s. */
const MUTTER_AFTER = 3.5;
const MUTTER_MIN = 7.0;
const MUTTER_MAX = 13.0;

/**
 * Child-sized cartoon formants, Hz, and relative band gains. Rounded from
 * published child-vowel means, pushed a touch brighter for a toon read.
 */
const VOWELS = {
  a: [1020, 1480, 3050],
  e: [620, 2350, 3250],
  i: [390, 2900, 3700],
  o: [610, 1050, 3000],
  u: [430, 1080, 2900],
  // glide / nasal / liquid anchors
  W: [360, 800, 2600],       // w onset (a rounded u, lower F2)
  Y: [330, 3050, 3800],      // y onset (a tight i)
  R: [480, 1350, 1750],      // r onset (low F3 is the r)
  L: [420, 1250, 2800],
  M: [280, 1100, 2500],      // nasal murmur
};
const F_Q = [5.5, 9.0, 13.0];
const F_GAIN = [1.0, 0.62, 0.30];

/**
 * THE LINES. Each syllable: [onset, vowel, seconds, f0StartMul, f0EndMul, glideTo?, coda?]
 *   onset: '' h w y r l m n b p d t g k s
 *   coda:  '' p t k m n h f
 * `pri` 0 chatter, 1 action, 2 priority (hurt/death/crest).
 */
const LINES = {
  jump1:     { syl: [['h', 'u', 0.11, 1.00, 1.10]], gain: 0.52, prob: 0.8, cd: 0.20, pri: 1 },
  jump2:     { syl: [['h', 'a', 0.13, 1.14, 1.30]], gain: 0.60, prob: 1, cd: 0.20, pri: 1 },
  jump3:     { syl: [['w', 'i', 0.10, 1.32, 1.44], ['h', 'o', 0.30, 1.62, 1.30, 'u']], gain: 0.70, prob: 1, cd: 0.35, pri: 1 },
  longjump:  { syl: [['y', 'a', 0.34, 1.22, 0.96]], gain: 0.62, prob: 1, cd: 0.4, pri: 1 },
  backflip:  { syl: [['h', 'u', 0.08, 1.10, 1.18], ['p', 'a', 0.16, 1.30, 1.42]], gain: 0.60, prob: 1, cd: 0.4, pri: 1 },
  sideflip:  { syl: [['h', 'i', 0.08, 1.20, 1.30], ['y', 'a', 0.16, 1.36, 1.18]], gain: 0.60, prob: 1, cd: 0.4, pri: 1 },
  wallkick:  { syl: [['h', 'e', 0.10, 1.26, 1.42, null, 'p']], gain: 0.62, prob: 1, cd: 0.16, pri: 1 },
  pound:     { syl: [['h', 'u', 0.08, 1.00, 0.88, null, 'm']], gain: 0.55, prob: 1, cd: 0.3, pri: 1 },
  dive:      { syl: [['w', 'a', 0.16, 1.22, 1.02]], gain: 0.58, prob: 1, cd: 0.3, pri: 1 },
  hop:       { syl: [['h', 'u', 0.07, 1.06, 1.12]], gain: 0.40, prob: 0.6, cd: 0.25, pri: 0 },
  punch1:    { syl: [['h', 'i', 0.07, 1.24, 1.30]], gain: 0.50, prob: 0.9, cd: 0.12, pri: 1 },
  punch2:    { syl: [['h', 'a', 0.07, 1.30, 1.36]], gain: 0.52, prob: 0.9, cd: 0.12, pri: 1 },
  kick:      { syl: [['y', 'a', 0.16, 1.44, 1.20, null, 'h']], gain: 0.62, prob: 1, cd: 0.2, pri: 1 },
  slideKick: { syl: [['h', 'w', 0.05, 1.2, 1.2], ['w', 'a', 0.18, 1.26, 1.06]], gain: 0.58, prob: 1, cd: 0.3, pri: 1 },
  airKick:   { syl: [['h', 'u', 0.06, 1.16, 1.22, null, 'p']], gain: 0.55, prob: 1, cd: 0.2, pri: 1 },
  grab:      { syl: [['h', 'u', 0.07, 1.04, 1.08, null, 'n']], gain: 0.46, prob: 1, cd: 0.4, pri: 1 },
  climb:     { syl: [['n', 'u', 0.10, 0.98, 1.10], ['h', 'a', 0.09, 1.20, 1.30, null, 'p']], gain: 0.50, prob: 1, cd: 0.4, pri: 1 },
  pickup:    { syl: [['h', 'u', 0.07, 1.00, 0.95, null, 'm']], gain: 0.44, prob: 1, cd: 0.4, pri: 1 },
  throw:     { syl: [['h', 'o', 0.09, 1.20, 1.36], ['y', 'i', 0.08, 1.36, 1.30]], gain: 0.58, prob: 1, cd: 0.3, pri: 1 },
  hardland:  { syl: [['', 'o', 0.13, 1.02, 0.82, 'u', 'f']], gain: 0.55, prob: 1, cd: 0.6, pri: 1 },
  hurt:      { syl: [['', 'o', 0.20, 1.52, 1.02, 'u']], gain: 0.70, prob: 1, cd: 0.5, pri: 2, rough: 0.35 },
  death:     { syl: [['n', 'o', 0.62, 1.34, 0.60, 'u']], gain: 0.72, prob: 1, cd: 1.0, pri: 2, vib: 0.05 },
  crest:     { syl: [['y', 'i', 0.09, 1.40, 1.50], ['p', 'a', 0.09, 1.50, 1.56], ['h', 'a', 0.34, 1.82, 1.46, 'e']], gain: 0.74, prob: 1, cd: 1.5, pri: 2 },
  shiver:    { syl: [['b', 'u', 0.34, 1.06, 1.00, null, 'h']], gain: 0.34, prob: 1, cd: 5, pri: 0, trem: 22 },
  pant:      { syl: [['h', 'a', 0.12, 0.94, 0.90, null, 'h'], ['h', 'a', 0.12, 0.92, 0.88, null, 'h']], gain: 0.30, prob: 1, cd: 5, pri: 0, rough: 0.5 },
  mutter:    { syl: null, gain: 0.30, prob: 1, cd: MUTTER_MIN, pri: 0 },
};

/** Gibberish inventory for the mutters. */
const M_ONSETS = ['m', 'b', 'l', 'n', 'd', 't', 'r', '', 'h', 'w', 'y'];
const M_VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'o'];
const M_CODAS = ['', '', '', 'n', 'm', 'p'];

/** Event -> line for the controller's `jump` kinds. */
const JUMP_LINE = {
  single: 'jump1', double: 'jump2', triple: 'jump3', long: 'longjump',
  backflip: 'backflip', sideflip: 'sideflip', wallkick: 'wallkick',
  hop: 'hop', poundjump: 'jump2', climb: 'jump1', slope: 'jump1',
};

/* ============================== synthesis ============================== */

function vowelF(v) { return VOWELS[v] || VOWELS.a; }

function onsetAnchor(c) {
  switch (c) {
    case 'w': return VOWELS.W;
    case 'y': return VOWELS.Y;
    case 'r': return VOWELS.R;
    case 'l': return VOWELS.L;
    case 'm': case 'n': return VOWELS.M;
    default: return null;
  }
}

/** Plosive burst colour (Hz) and whether the consonant is voiced. */
function plosive(c) {
  switch (c) {
    case 'p': return { f: 900, voiced: false };
    case 'b': return { f: 800, voiced: true };
    case 't': return { f: 3800, voiced: false };
    case 'd': return { f: 3300, voiced: true };
    case 'k': return { f: 2100, voiced: false };
    case 'g': return { f: 1900, voiced: true };
    default: return null;
  }
}

let _noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = _noiseCache.get(ctx);
  if (b) return b;
  const n = Math.floor(ctx.sampleRate * 1.2);
  b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 0x51f15e;
  for (let i = 0; i < n; i++) {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    d[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  _noiseCache.set(ctx, b);
  return b;
}

/**
 * Build and schedule one line on ANY BaseAudioContext (live or offline).
 * @returns {number} the line's duration in seconds
 */
export function renderLine(ctx, dest, line, when, opts) {
  const o = opts || {};
  const syl = o.syl || line.syl;
  if (!syl || !syl.length) return 0;
  const f0base = (o.f0 || BASE_F0) * (o.pitch || 1);
  const gainK = (line.gain || 0.5) * (o.gain === undefined ? 1 : o.gain);
  const rough = line.rough || 0;
  const t0 = Math.max(when, ctx.currentTime);

  /* ---- total length ------------------------------------------------------ */
  let dur = 0;
  for (let i = 0; i < syl.length; i++) dur += syl[i][2] + 0.035;
  dur += 0.06;

  /* ---- source: one glottal sawtooth for the whole line -------------------- */
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  /* a second, detuned partial softens the saw's buzz into something throatier */
  const src2 = ctx.createOscillator();
  src2.type = 'triangle';
  const srcMix = ctx.createGain();
  srcMix.gain.value = 0.55;
  const src2Mix = ctx.createGain();
  src2Mix.gain.value = 0.45;
  src.connect(srcMix);
  src2.connect(src2Mix);

  const voiced = ctx.createGain();       // the voicing gate (per syllable)
  voiced.gain.setValueAtTime(0, t0);
  srcMix.connect(voiced);
  src2Mix.connect(voiced);

  /* ---- three parallel formants ------------------------------------------- */
  const fsum = ctx.createGain();
  fsum.gain.value = 1;
  const formants = [];
  for (let k = 0; k < 3; k++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = F_Q[k];
    const g = ctx.createGain();
    g.gain.value = F_GAIN[k] * (k === 0 ? 1.6 : 2.2);   // band-pass eats level; restore it
    voiced.connect(bp);
    bp.connect(g);
    g.connect(fsum);
    formants.push(bp);
  }

  /* ---- noise path (breath, bursts, sibilance) ---------------------------- */
  const nsrc = ctx.createBufferSource();
  nsrc.buffer = noiseBuffer(ctx);
  nsrc.loop = true;
  const nbp = ctx.createBiquadFilter();
  nbp.type = 'bandpass';
  nbp.Q.value = 1.4;
  const ngate = ctx.createGain();
  ngate.gain.setValueAtTime(0, t0);
  nsrc.connect(nbp);
  nbp.connect(ngate);

  /* ---- master: soften, shape, out ----------------------------------------- */
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 6200;
  lp.Q.value = 0.5;
  const amp = ctx.createGain();
  amp.gain.value = gainK;
  fsum.connect(lp);
  ngate.connect(lp);
  lp.connect(amp);
  amp.connect(dest);
  if (o.verb) {
    const send = ctx.createGain();
    send.gain.value = VERB_SEND;
    amp.connect(send);
    send.connect(o.verb);
  }

  /* ---- schedule each syllable -------------------------------------------- */
  let t = t0 + 0.005;
  const vib = line.vib || 0;
  const trem = line.trem || 0;
  const jit = o.jitter === undefined ? 1 : o.jitter;
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i];
    const on = s[0] || '', v = s[1] || 'a', d = s[2] || 0.1;
    const fa = f0base * s[3] * jit, fb = f0base * s[4] * jit;
    const glide = s[5] || null, coda = s[6] || '';
    const F = vowelF(v);
    const anchor = onsetAnchor(on);
    const pl = plosive(on);
    let vStart = t;

    /* onset */
    if (on === 'h' || on === 's') {
      const nd = on === 's' ? 0.06 : 0.045;
      nbp.frequency.setValueAtTime(on === 's' ? 5200 : F[1], t);
      nbp.Q.setValueAtTime(on === 's' ? 2.0 : 0.9, t);
      ngate.gain.setValueAtTime(0, t);
      ngate.gain.linearRampToValueAtTime(on === 's' ? 0.55 : 0.42, t + 0.012);
      ngate.gain.linearRampToValueAtTime(0.0, t + nd);
      vStart = t + nd * 0.55;
    } else if (pl) {
      nbp.frequency.setValueAtTime(pl.f, t);
      nbp.Q.setValueAtTime(1.2, t);
      ngate.gain.setValueAtTime(0, t);
      ngate.gain.linearRampToValueAtTime(0.9, t + 0.003);
      ngate.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
      ngate.gain.setValueAtTime(0, t + 0.02);
      vStart = t + (pl.voiced ? 0.006 : 0.028);
    }

    /* formant path: onset anchor -> vowel (-> glide) */
    for (let k = 0; k < 3; k++) {
      const fp = formants[k].frequency;
      if (anchor) {
        fp.setValueAtTime(anchor[k], vStart);
        fp.linearRampToValueAtTime(F[k], vStart + Math.min(0.07, d * 0.5));
      } else {
        fp.setValueAtTime(F[k], vStart);
      }
      if (glide) {
        const G = vowelF(glide);
        fp.linearRampToValueAtTime(G[k], vStart + d);
      }
    }

    /* pitch contour (+ a little vibrato on long notes) */
    const pf = src.frequency, pf2 = src2.frequency;
    pf.setValueAtTime(fa, vStart);
    pf2.setValueAtTime(fa * 1.003, vStart);
    if (vib > 0 && d > 0.2) {
      const steps = Math.floor(d / 0.05);
      for (let q = 1; q <= steps; q++) {
        const u = q / steps;
        const f = fa + (fb - fa) * u;
        const w = 1 + vib * Math.sin(q * 1.9);
        pf.linearRampToValueAtTime(f * w, vStart + d * u);
        pf2.linearRampToValueAtTime(f * w * 1.003, vStart + d * u);
      }
    } else {
      pf.exponentialRampToValueAtTime(Math.max(40, fb), vStart + d);
      pf2.exponentialRampToValueAtTime(Math.max(40, fb * 1.003), vStart + d);
    }

    /* voicing envelope: attack, (tremolo), release */
    const vg = voiced.gain;
    const peak = anchor && (on === 'm' || on === 'n') ? 0.8 : 1.0;
    vg.setValueAtTime(0, vStart);
    vg.linearRampToValueAtTime(peak, vStart + 0.014);
    if (trem > 0) {
      const n = Math.floor(d * trem);
      for (let q = 1; q < n; q++) {
        vg.linearRampToValueAtTime(q & 1 ? 0.35 : 1.0, vStart + q / trem);
      }
    }
    vg.setValueAtTime(trem > 0 ? 0.8 : 1.0, vStart + d - 0.035);
    vg.linearRampToValueAtTime(0, vStart + d);

    /* roughness: breath under the vowel (hurt, pant) */
    if (rough > 0) {
      nbp.frequency.setValueAtTime(F[1], vStart);
      nbp.Q.setValueAtTime(0.8, vStart);
      ngate.gain.setValueAtTime(0, vStart);
      ngate.gain.linearRampToValueAtTime(rough * 0.5, vStart + 0.02);
      ngate.gain.linearRampToValueAtTime(0, vStart + d);
    }

    /* coda */
    let tEnd = vStart + d;
    if (coda === 'h' || coda === 'f') {
      nbp.frequency.setValueAtTime(coda === 'f' ? 4200 : F[1], tEnd - 0.01);
      nbp.Q.setValueAtTime(coda === 'f' ? 1.6 : 0.9, tEnd - 0.01);
      ngate.gain.setValueAtTime(0, tEnd - 0.01);
      ngate.gain.linearRampToValueAtTime(0.35, tEnd + 0.01);
      ngate.gain.linearRampToValueAtTime(0, tEnd + 0.06);
      tEnd += 0.04;
    } else if (coda === 'm' || coda === 'n') {
      for (let k = 0; k < 3; k++) formants[k].frequency.linearRampToValueAtTime(VOWELS.M[k], tEnd + 0.03);
      vg.cancelScheduledValues(tEnd - 0.035);
      vg.setValueAtTime(0.9, tEnd - 0.035);
      vg.linearRampToValueAtTime(0.55, tEnd + 0.02);
      vg.linearRampToValueAtTime(0, tEnd + 0.07);
      tEnd += 0.06;
    } else if (coda === 'p' || coda === 't' || coda === 'k') {
      /* a closure: the voice stops dead, then a tiny release burst */
      const pc = plosive(coda);
      nbp.frequency.setValueAtTime(pc.f, tEnd + 0.03);
      ngate.gain.setValueAtTime(0, tEnd + 0.03);
      ngate.gain.linearRampToValueAtTime(0.5, tEnd + 0.033);
      ngate.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.05);
      ngate.gain.setValueAtTime(0, tEnd + 0.052);
      tEnd += 0.05;
    }
    t = tEnd + 0.03;
  }

  const stop = t + 0.08;
  try {
    src.start(t0); src2.start(t0); nsrc.start(t0, Math.random() * 0.5);
    src.stop(stop); src2.stop(stop); nsrc.stop(stop);
  } catch (e) { /* a context that is closing */ }
  src.onended = () => {
    try { amp.disconnect(); } catch (e) { /* noop */ }
  };
  return stop - t0;
}

/** Build a fresh gibberish mutter (2..4 syllables) from a random stream. */
function makeMutter(rnd) {
  const n = 2 + Math.floor(rnd() * 3);
  const out = [];
  let f = 0.92 + rnd() * 0.16;
  for (let i = 0; i < n; i++) {
    const on = M_ONSETS[Math.floor(rnd() * M_ONSETS.length)];
    const v = M_VOWELS[Math.floor(rnd() * M_VOWELS.length)];
    const coda = i === n - 1 ? M_CODAS[Math.floor(rnd() * M_CODAS.length)] : '';
    const d = 0.08 + rnd() * 0.10 + (i === n - 1 ? 0.06 : 0);
    const f1 = f * (0.94 + rnd() * 0.14);
    out.push([on, v, d, f, f1, null, coda]);
    f = f1;
  }
  return out;
}

/* ============================== the Voice ============================== */

export class Voice {
  /** @param {object|null} audio core/audio.js Audio (ctx + sfxBus + verbIn), may init later */
  constructor(audio) {
    this.audio = audio || null;
    this.enabled = true;
    /** Multiplies every line's level (a settings hook for the UI lane). */
    this.level = 1;
    this.stats = { fired: 0, dropped: 0, byName: Object.create(null), log: [], logN: 0 };
    for (let i = 0; i < 16; i++) this.stats.log.push({ name: '', t: 0, pitch: 0, dur: 0 });
    this._cd = Object.create(null);         // name -> time it may fire again
    this._lastAny = -1e9;
    this._busyUntil = -1e9;
    this._busyPri = -1;
    /** Start times of the last BUDGET non-priority lines — a true ring (`_recentI`
        is the next slot). Measured before this was a ring: a 10 s mash fired 19
        lines in one 2.5 s window, because every write after the fifth landed in
        slot 0 and the other four aged out of the window. */
    this._recent = new Float64Array(BUDGET).fill(-1e9);
    this._recentI = 0;
    this._mutterT = MUTTER_MIN;
    this._idleT = 0;
    this._clock = 0;                        // fallback clock when no context yet
    this._rng = 0x4e494d;
  }

  _rand() {
    this._rng = (this._rng + 0x6D2B79F5) | 0;
    let t = this._rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  _now() {
    const a = this.audio;
    return (a && a.ctx && typeof a.ctx.currentTime === 'number') ? a.ctx.currentTime : this._clock;
  }

  /**
   * Fire a line if every gate allows it.
   * @param {string} name a key of LINES
   * @param {{pitch?:number, gain?:number, force?:boolean}} [opts]
   * @returns {boolean} whether it spoke (or would have, with no audio context)
   */
  bark(name, opts) {
    const line = LINES[name];
    if (!line || !this.enabled) return false;
    const now = this._now();
    const pri = line.pri | 0;
    const force = !!(opts && opts.force);
    const st = this.stats;
    const drop = () => { st.dropped++; return false; };

    if (!force) {
      if ((this._cd[name] || -1e9) > now) return drop();
      if (pri < 2) {
        if (now - this._lastAny < GAP_S) return drop();
        if (now < this._busyUntil && pri <= this._busyPri) return drop();
        /* rolling budget */
        let n = 0;
        for (let i = 0; i < BUDGET; i++) if (now - this._recent[i] < BUDGET_WINDOW_S) n++;
        if (n >= BUDGET) return drop();
        if (line.prob < 1 && this._rand() > line.prob) return drop();
      }
    }

    const jitter = 0.97 + this._rand() * 0.06;
    const pitch = (opts && opts.pitch) || 1;
    const syl = line.syl || makeMutter(() => this._rand());
    let dur = 0;
    const a = this.audio;
    if (a && a.ctx && a.ready !== false && a.sfxBus) {
      try {
        dur = renderLine(a.ctx, a.sfxBus, line, a.ctx.currentTime + 0.004, {
          syl, pitch, jitter, gain: OUT_GAIN * this.level * (opts && opts.gain !== undefined ? opts.gain : 1),
          verb: a.verbIn || null,
        });
      } catch (e) { dur = 0; }
    } else {
      /* no context yet (before the first user gesture): account for it anyway so the
         gates and the stats behave identically — nothing is heard, nothing is queued */
      for (let i = 0; i < syl.length; i++) dur += syl[i][2] + 0.035;
    }

    this._cd[name] = now + (line.cd || 0);
    this._lastAny = now;
    this._busyUntil = now + dur;
    this._busyPri = pri;
    if (pri < 2) {
      this._recent[this._recentI] = now;
      this._recentI = (this._recentI + 1) % BUDGET;
    }
    st.fired++;
    st.byName[name] = (st.byName[name] || 0) + 1;
    const rec = st.log[st.logN % st.log.length];
    rec.name = name; rec.t = now; rec.pitch = +(pitch * jitter).toFixed(3); rec.dur = +dur.toFixed(3);
    rec.f0 = Math.round(BASE_F0 * pitch * jitter * syl[0][3]);
    st.logN++;
    return true;
  }

  /**
   * The Player's event stream (controller.js `_ev` forwards every emit here).
   * Never throws into the sim.
   */
  onEvent(name, a, b, c) {
    try {
      switch (name) {
        case 'jump': {
          const line = JUMP_LINE[a];
          if (line) this.bark(line);
          break;
        }
        case 'pound': this.bark('pound'); break;
        case 'dive': this.bark('dive'); break;
        case 'death': this.bark('death'); break;
        case 'hurt': this.bark('hurt'); break;
        case 'land': if (c === true && a >= 20 && a < 39) this.bark('hardland'); break;
        case 'punch': this.bark(a === 2 ? 'punch2' : 'punch1'); break;
        case 'kick': this.bark('kick'); break;
        case 'slideKick': this.bark('slideKick'); break;
        case 'airKick': this.bark('airKick'); break;
        case 'ledgeGrab': this.bark('grab'); break;
        case 'ledgeClimb': this.bark('climb'); break;
        case 'pickup': this.bark('pickup'); break;
        case 'throw': this.bark('throw'); break;
        case 'crest': this.bark('crest'); break;
        default: break;
      }
    } catch (e) { /* the voice never breaks movement */ }
    void b;
  }

  /**
   * Per frame. Idle mutters — plus a shiver in the cold and a pant in the heat —
   * once the hero has been standing still a while. Allocation-free.
   */
  update(dt, player) {
    const d = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    this._clock += d;
    if (!player || player.dead) { this._idleT = 0; return; }
    if (player.state === 'idle' && (player.speed || 0) < 0.2) this._idleT += d;
    else { this._idleT = 0; this._mutterT = MUTTER_MIN * 0.6; return; }
    if (this._idleT < MUTTER_AFTER) return;
    this._mutterT -= d;
    if (this._mutterT > 0) return;
    this._mutterT = MUTTER_MIN + this._rand() * (MUTTER_MAX - MUTTER_MIN);
    const w = player.world;
    const th = w && w.game ? w.game.themeId : null;
    const surf = player.surface;
    if (th === 'rime' || surf === 'snow' || surf === 'ice') this.bark(this._rand() < 0.6 ? 'shiver' : 'mutter');
    else if (th === 'ember') this.bark(this._rand() < 0.6 ? 'pant' : 'mutter');
    else this.bark('mutter');
  }

  /**
   * Render one line offline (harness proof: non-silent, pitch contour measurable).
   * @returns {Promise<AudioBuffer>|null}
   */
  static renderOffline(name, opts) {
    const line = LINES[name];
    const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
      : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null); // eslint-disable-line no-undef
    if (!line || !OAC) return null;
    const sr = 44100;
    const o = opts || {};
    let seed = 0x1234;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const syl = line.syl || makeMutter(rnd);
    let dur = 0.3;
    for (let i = 0; i < syl.length; i++) dur += syl[i][2] + 0.12;
    const ctx = new OAC(1, Math.ceil(sr * dur), sr);
    renderLine(ctx, ctx.destination, line, 0, { syl, pitch: o.pitch || 1, jitter: 1, gain: 1 });
    return ctx.startRendering();
  }

  /** The line table (read-only), for UI / harness listings. */
  static get lines() { return LINES; }
}

export default Voice;
