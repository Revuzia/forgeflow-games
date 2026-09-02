/* ============================================================================
 * CRESTBOUND — runtime/core/audio.js
 * CONTRACT §5.  100% PROCEDURAL Web Audio. Zero audio files, zero fetches.
 *
 *   destination
 *     <- limiter (DynamicsCompressor)
 *        <- master (Gain) <- dcCut (Highpass 26 Hz)
 *           <- musicDuck <- moodGain <- moodShine <- moodTone <- musicBus <- bed.out
 *           <- stingerBus  (musical one-shots: crest / clear / unlock ...)
 *           <- sfxBus      (one-shot + looping gameplay voices)
 *           <- verbReturn  <- algorithmic FDN reverb <- per-voice sends
 *
 * Ported by transliteration from `games/ascendant/runtime/core/audio.js` (same
 * studio, proven engine: look-ahead scheduler, FDN reverb, voice budgeting,
 * allocation-free spatialisation, param-safety wrappers). Everything below the
 * "beds" line is NEW for Crestbound:
 *
 *  - FIVE new music beds, one per theme, sharing NO motif, NO chord table and
 *    NO rhythm array with each other or with Ascendant:
 *      keep     72 bpm  warm harp + string choir, C major, no percussion
 *      verdant 118 bpm  bright pizzicato + flute, D major, tambourine
 *      ember   100 bpm  low brass + industrial pulse, D minor, anvils
 *      rime     84 bpm  music-box + wide pads + wind, C lydian
 *      azure    96 bpm  marimba + choir formants + water, G mixolydian
 *  - `setMood()` — a filter/intensity/percussion LAYER that rides on top of
 *    whatever bed is playing: explore / danger / underwater / clear / boss.
 *    Underwater additionally wobbles the tone filter with a real LFO, so the
 *    music ducks under the surface with the player rather than cutting.
 *  - `stinger()` — seven short musical cues that bypass the bed entirely.
 *  - Every §5 sfx name, synthesised: the jump1/2/3 rising family, the flip and
 *    whoosh family, pound hang/land, the coin -> sigil -> crest arpeggio
 *    family, water, seven footstep surfaces, and every critter/hazard voice.
 *
 * Safety rules honoured throughout (unchanged from the Ascendant engine):
 *  - never exponentialRampToValueAtTime toward 0 (linear ramps + setTarget only)
 *  - every AudioParam value clamped finite before it is scheduled
 *  - every scheduled time clamped to >= ctx.currentTime
 *  - the whole scheduler tick is wrapped in try/catch; one bad step never
 *    stops the music, one bad sound never breaks the frame
 *  - a suspended context (page mute from game_controls.js) is detected and the
 *    scheduler idles + resyncs instead of building a backlog. We never call
 *    ctx.resume() while the page-level mute is engaged.
 * ==========================================================================*/

const IS_BROWSER = typeof window !== 'undefined';

const LOOKAHEAD_MS = 25;      // scheduler tick
const HORIZON = 0.12;         // seconds of audio scheduled ahead of the clock
const CROSSFADE = 1.2;        // CONTRACT §5: bed crossfade
const MOOD_FADE = 0.8;        // mood filter/intensity glide
const MAX_VOICES = 30;        // concurrent sfx voice budget

const DEFAULT_VOL = { master: 0.8, music: 0.6, sfx: 0.9 };

/* Looping (positional) sfx — `sfx()` returns a handle for these. */
const LOOP_SFX = { wind: 1, lava_flow: 1, water_flow: 1, machine_hum: 1 };

/* Convenience aliases -> the full synthesised sound. */
const ALIAS = {
  jump: 'jump1',
  land: 'land_soft',
  step: 'step_stone',
  crush: 'crusher_slam',
  vanish: 'vanish_warn',
  pound: 'pound_land',
  ui_cancel: 'ui_back',
  squish: 'bumbler_squish',
  bite: 'gnasher_bite',
  roar: 'warden_roar',
};

/* Sounds that ignore the voice cap and the anti-machinegun throttle. */
const CRITICAL = {
  death: 1, crest: 1, checkpoint: 1, crusher_slam: 1, warden_roar: 1,
  gate_open: 1, painting_enter: 1, pound_land: 1, cannon_fire: 1,
};

/* --------------------------------------------------------------- helpers */
function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function fin(v, def) { return (typeof v === 'number' && Number.isFinite(v)) ? v : def; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* ===========================================================================
 * Per-bed note material.
 *
 * Nothing is shared between beds — five separate musical ideas, five separate
 * tables. `-1` in a step array is a rest. MIDI note numbers throughout
 * (mtof converts); bar-indexed arrays cycle every 4 bars.
 * ======================================================================== */

/* ---- KEEP: C major, harp + string choir, 72 bpm, 8 steps/bar ------------ */
const KEEP_CHORDS = [
  { root: 36, harp: [60, 64, 67, 72, 76], str: [48, 55, 64, 67] },   // Cmaj9
  { root: 33, harp: [57, 60, 64, 69, 72], str: [45, 52, 60, 64] },   // Am7
  { root: 29, harp: [53, 57, 60, 65, 69], str: [41, 48, 57, 60] },   // Fmaj9
  { root: 31, harp: [55, 59, 62, 67, 71], str: [43, 50, 59, 62] },   // G6
];
/* Which harp string the roll plucks on each eighth (index into chord.harp). */
const KEEP_ROLL = [0, 1, 2, 3, 4, 3, 2, 1];
/* The upper-voice counter-melody: an offset added to the rolled note, or -1. */
const KEEP_COUNTER = [-1, -1, 12, -1, -1, 12, -1, 7];

/* ---- VERDANT: D major, pizzicato + flute, 118 bpm, 16 steps/bar --------- */
const VERD_PIZZ = [38, -1, 45, -1, 38, -1, 42, 45, 38, -1, 45, -1, 50, -1, 45, 42];
const VERD_MELODY = [
  [74, -1, 76, -1, 78, -1, 81, -1, 78, -1, 76, -1, 74, -1, -1, -1],
  [76, -1, 78, -1, 81, -1, 83, -1, 81, -1, 78, -1, 76, -1, -1, -1],
  [81, -1, -1, 79, -1, 78, -1, 76, -1, -1, 74, -1, 73, -1, 74, -1],
  [69, -1, 71, -1, 74, -1, 76, -1, 78, -1, 76, -1, 74, -1, 71, -1],
];
const VERD_TAMB = [0, 0.28, 0, 0.48, 0, 0.28, 0, 0.62, 0, 0.28, 0, 0.48, 0, 0.34, 0.26, 0.70];
const VERD_STRINGS = [[62, 66, 69, 74], [59, 62, 66, 71], [57, 61, 64, 69], [55, 59, 62, 67]];

/* ---- EMBER: D minor, low brass + industrial, 100 bpm, 16 steps/bar ------ */
const EMB_PULSE = [1, 0, 0.34, 0, 0.70, 0, 0.34, 0.50, 1, 0, 0.34, 0, 0.70, 0.40, 0.50, 0.62];
const EMB_MOTIF = [[38, 41], [41, 43], [43, 46], [41, 38]];        // D-F, F-G, G-A#, F-D
const EMB_BRASS = [[38, 45, 50, 57], [36, 43, 48, 55], [41, 48, 53, 60], [34, 41, 46, 53]];
const EMB_CLANK = [1240, 2010, 3170, 4520, 6180];                   // inharmonic partials
const EMB_KICK = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0];

/* ---- RIME: C lydian, music box + pads + wind, 84 bpm, 8 steps/bar ------- */
const RIME_BOX = [
  [72, -1, 79, -1, 76, -1, 74, -1],
  [78, -1, 76, -1, 79, -1, 83, -1],
  [76, -1, 72, -1, 74, -1, 78, -1],
  [79, -1, 83, -1, 86, -1, 78, -1],
];
const RIME_PADS = [
  [48, 55, 60, 64, 66],   // C(add#11)
  [50, 57, 62, 66, 69],   // D
  [47, 54, 59, 64, 66],   // Bm(add#11)
  [52, 59, 64, 67, 71],   // Em
];
const RIME_SHIMMER = [96, 91, 99, 94];

/* ---- AZURE: G mixolydian, marimba + choir + water, 96 bpm, 16/bar ------- */
const AZ_SCALE = [67, 69, 71, 72, 74, 76, 77, 79];
const AZ_OSTINATO = [0, -1, 4, -1, 2, -1, 5, -1, 3, -1, 7, -1, 5, -1, 4, -1];
const AZ_TRANSPOSE = [0, 0, -2, 3];
const AZ_CHOIR = [[55, 62, 67, 71], [53, 60, 65, 69], [57, 64, 69, 72], [50, 57, 62, 67]];
const AZ_FORMANTS = [540, 1180, 2450];                              // a rounder vowel
const AZ_BASS = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];

/* ===========================================================================
 * Mood layer — CONTRACT §5 `setMood()`
 *
 * A mood never swaps the bed; it colours it. `tone` is a lowpass over the
 * whole music bus, `gain` the bus level, `wob` the depth (Hz) of the LFO on
 * the tone filter (underwater), `shine` a high-shelf lift in dB, and `layer`
 * an extra percussion/tension part scheduled INTO the current bed (so it
 * crossfades away with the bed when the theme changes).
 * ======================================================================== */
const MOODS = {
  explore:    { tone: 17000, res: 0.7, gain: 1.00, wob: 0,   shine: 0,  layer: 0 },
  danger:     { tone: 9000,  res: 0.9, gain: 1.00, wob: 0,   shine: 0,  layer: 1 },
  underwater: { tone: 520,   res: 1.7, gain: 0.70, wob: 130, shine: -6, layer: 0 },
  clear:      { tone: 18000, res: 0.7, gain: 1.06, wob: 0,   shine: 4,  layer: 0 },
  boss:       { tone: 7000,  res: 1.1, gain: 1.10, wob: 0,   shine: 2,  layer: 2 },
};

/* ===========================================================================
 * Impact colour per walked surface. Used by land_* and step_* so a stone lip,
 * a snow drift and a metal catwalk are audibly different places to stand.
 * ======================================================================== */
const SURFACE_RING = {
  stone:  [430, 780, 1180],
  metal:  [1420, 2340, 3510],
  ice:    [2650, 4180, 6100],
  grass:  [280, 520, 900],
  snow:   [760, 1420, 2380],
  sand:   [340, 620, 1120],
  wood:   [520, 890, 1560],
  grate:  [1180, 1720, 2960],
  rubber: [180, 260, 420],
};

/* Ring resonance and ring length per surface — how "live" the material is. */
const SURFACE_Q   = { metal: 20, grate: 12, ice: 14, stone: 5, wood: 7, grass: 2.2, snow: 1.4, sand: 1.6, rubber: 3 };
const SURFACE_DUR = { metal: 0.55, grate: 0.30, ice: 0.24, stone: 0.14, wood: 0.18, grass: 0.10, snow: 0.09, sand: 0.09, rubber: 0.16 };
/* How much of the impact survives as a ring at all (snow eats everything). */
const SURFACE_BITE = { metal: 1, grate: 0.9, ice: 0.85, stone: 0.8, wood: 0.7, grass: 0.42, snow: 0.22, sand: 0.3, rubber: 0.55 };

/* ==========================================================================
 * Audio
 * ========================================================================*/
export class Audio {
  constructor() {
    this.ctx = null;
    this.available = IS_BROWSER && !!(window.AudioContext || window.webkitAudioContext);
    this.ready = false;
    /** @type {string|null} current music bed id ('keep'|'verdant'|…) */
    this.theme = null;
    /** @type {string} current mood id */
    this.mood = 'explore';

    this.vol = { master: DEFAULT_VOL.master, music: DEFAULT_VOL.music, sfx: DEFAULT_VOL.sfx };

    this._active = [];                    // beds currently scheduling (current + fading)
    this._pendingTheme = null;
    this._pendingMood = null;
    this._timer = 0;
    this._live = 0;          // music voices in flight
    this._sfxLive = 0;       // sfx voices in flight (the cap applies to these)
    this._inSfx = false;     // set while an sfx voice is being built
    this._loops = new Map();
    this._loopSeq = 1;
    this._lastPlay = Object.create(null); // per-name throttle
    this._pageMuted = false;
    this._rng = 0x9E37;

    this._noiseBuf = null;
    this._pinkBuf = null;

    if (IS_BROWSER) {
      this._onMuteChange = (e) => {
        this._pageMuted = !!(e && e.detail && e.detail.muted);
        if (!this._pageMuted) this._resume();
        else this._resyncBeds();
      };
      window.addEventListener('mutechange', this._onMuteChange, false);
      try {
        if (window.__CONTROLS__ && window.__CONTROLS__.isMuted) this._pageMuted = !!window.__CONTROLS__.isMuted();
      } catch (e) {}
    }
  }

  /* ------------------------------------------------- deterministic-ish rng */
  _rand() {
    /* mulberry32 — keeps footstep jitter cheap and allocation free. */
    this._rng = (this._rng + 0x6D2B79F5) | 0;
    let t = this._rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  _jit(spread) { return 1 + (this._rand() * 2 - 1) * spread; }

  /* ====================================================================
   * init — MUST be called from a user gesture
   * ==================================================================*/
  init() {
    if (this.ctx) { this._resume(); return this; }
    if (!this.available) return this;
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      this.ctx = new AC();
    } catch (e) {
      this.available = false;
      return this;
    }

    try {
      this._buildBuffers();
      this._buildGraph();
      this.ready = true;
    } catch (e) {
      this.available = false;
      this.ready = false;
      return this;
    }

    this._resume();
    this._startScheduler();

    /* Apply whatever the game asked for before the gesture arrived. */
    const pm = this._pendingMood;
    this._pendingMood = null;
    if (pm) this.setMood(pm); else this._applyMood(this.mood, 0.05);

    if (this._pendingTheme) {
      const t = this._pendingTheme;
      this._pendingTheme = null;
      this.setTheme(t);
    }
    return this;
  }

  _resume() {
    if (!this.ctx) return;
    if (this._pageMuted) return;                       // game_controls owns the mute
    if (this.ctx.state === 'suspended') {
      try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
  }

  _buildBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * 2);

    const white = ctx.createBuffer(1, n, sr);
    const wd = white.getChannelData(0);
    for (let i = 0; i < n; i++) wd[i] = Math.random() * 2 - 1;
    this._noiseBuf = white;

    /* Pink-ish via the Paul Kellet economy filter — wind, pads, breath. */
    const pink = ctx.createBuffer(1, n, sr);
    const pd = pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      pd[i] = clamp(out, -1, 1);
    }
    this._pinkBuf = pink;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -7;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.26;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;

    this.dcCut = ctx.createBiquadFilter();
    this.dcCut.type = 'highpass';
    this.dcCut.frequency.value = 26;
    this.dcCut.Q.value = 0.5;
    this.dcCut.connect(this.limiter);
    this.master.connect(this.dcCut);

    /* --- music chain: bus -> mood tone -> mood shine -> mood gain -> duck -- */
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.vol.music;

    this.moodTone = ctx.createBiquadFilter();
    this.moodTone.type = 'lowpass';
    this.moodTone.frequency.value = MOODS.explore.tone;
    this.moodTone.Q.value = MOODS.explore.res;

    this.moodShine = ctx.createBiquadFilter();
    this.moodShine.type = 'highshelf';
    this.moodShine.frequency.value = 3200;
    this.moodShine.gain.value = 0;

    this.moodGain = ctx.createGain();
    this.moodGain.gain.value = 1;

    this.musicDuck = ctx.createGain();
    this.musicDuck.gain.value = 1;

    this.musicBus.connect(this.moodTone);
    this.moodTone.connect(this.moodShine);
    this.moodShine.connect(this.moodGain);
    this.moodGain.connect(this.musicDuck);
    this.musicDuck.connect(this.master);

    /* Underwater wobble: a permanent slow LFO into the tone filter's cutoff,
       with its depth parked at 0 for every dry mood. Built once — a mood
       switch only ramps `moodWobDepth`, it never rewires the graph. */
    this.moodWob = ctx.createOscillator();
    this.moodWob.type = 'sine';
    this.moodWob.frequency.value = 0.31;
    this.moodWobDepth = ctx.createGain();
    this.moodWobDepth.gain.value = 0;
    this.moodWob.connect(this.moodWobDepth);
    this.moodWobDepth.connect(this.moodTone.frequency);
    try { this.moodWob.start(); } catch (e) {}

    /* --- stingers: musical, but must survive a ducked bed ------------------ */
    this.stingerBus = ctx.createGain();
    this.stingerBus.gain.value = this._stingerLevel();
    this.stingerBus.connect(this.master);

    /* --- gameplay sfx ----------------------------------------------------- */
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);

    this._buildReverb();
  }

  /** Stingers follow the music slider but never drop below an audible floor. */
  _stingerLevel() {
    return clamp(Math.max(this.vol.music, 0.4) * 0.92, 0, 1);
  }

  /** Feedback-delay-network reverb: 4 damped combs -> 2 allpass -> stereo. */
  _buildReverb() {
    const ctx = this.ctx;

    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 1;

    const pre = ctx.createDelay(0.2);
    pre.delayTime.value = 0.013;
    this.verbIn.connect(pre);

    const combSum = ctx.createGain();
    combSum.gain.value = 0.26;

    const times = [0.0297, 0.0371, 0.0411, 0.0437];
    const fbs = [0.805, 0.827, 0.783, 0.764];
    this._verbNodes = [pre, combSum];

    for (let i = 0; i < times.length; i++) {
      const d = ctx.createDelay(0.5);
      d.delayTime.value = times[i];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3400;
      lp.Q.value = 0.4;
      const fb = ctx.createGain();
      fb.gain.value = fbs[i];
      pre.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);           // the cycle contains a DelayNode — legal + stable
      d.connect(combSum);
      this._verbNodes.push(d, lp, fb);
    }

    let node = combSum;
    const apTimes = [0.00507, 0.00171];
    for (let i = 0; i < apTimes.length; i++) {
      const g = 0.55;
      const sum = ctx.createGain(); sum.gain.value = 1;
      const d = ctx.createDelay(0.1); d.delayTime.value = apTimes[i];
      const fb = ctx.createGain(); fb.gain.value = g;
      const ff = ctx.createGain(); ff.gain.value = -g;
      const out = ctx.createGain(); out.gain.value = 1;
      node.connect(sum);
      sum.connect(d);
      d.connect(fb);
      fb.connect(sum);
      d.connect(out);
      sum.connect(ff);
      ff.connect(out);
      this._verbNodes.push(sum, d, fb, ff, out);
      node = out;
    }

    const tone = ctx.createBiquadFilter();
    tone.type = 'highpass';
    tone.frequency.value = 180;
    node.connect(tone);

    const spread = ctx.createDelay(0.05);
    spread.delayTime.value = 0.0093;
    tone.connect(spread);

    const merger = ctx.createChannelMerger(2);
    tone.connect(merger, 0, 0);
    spread.connect(merger, 0, 1);

    this.verbReturn = ctx.createGain();
    this.verbReturn.gain.value = 0.9;
    merger.connect(this.verbReturn);
    this.verbReturn.connect(this.master);
    this._verbNodes.push(tone, spread, merger);
  }

  /* ====================================================================
   * Param helpers — every value clamped, every time clamped
   * ==================================================================*/
  _at(t) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const v = fin(t, now);
    return v < now ? now : v;
  }

  _set(param, v, t) {
    try { param.setValueAtTime(clamp(fin(v, 0), -1e4, 1e4), this._at(t)); } catch (e) {}
  }

  _ramp(param, v, t) {
    try { param.linearRampToValueAtTime(clamp(fin(v, 0), -1e4, 1e4), this._at(t)); } catch (e) {}
  }

  _target(param, v, t, tau) {
    try { param.setTargetAtTime(clamp(fin(v, 0), -1e4, 1e4), this._at(t), Math.max(0.002, fin(tau, 0.05))); } catch (e) {}
  }

  /** Attack / decay envelope on a gain, never exponential toward zero. */
  _env(gain, t, peak, attack, decay, sustain, hold) {
    const p = clamp(fin(peak, 0.2), 0, 4);
    const a = Math.max(0.0008, fin(attack, 0.004));
    const d = Math.max(0.01, fin(decay, 0.2));
    const s = clamp(fin(sustain, 0), 0, 4);
    const h = Math.max(0, fin(hold, 0));
    this._set(gain, 0, t);
    this._ramp(gain, p, t + a);
    if (h > 0) {
      this._ramp(gain, p, t + a + h);
      this._ramp(gain, s, t + a + h + d);
    } else {
      this._ramp(gain, s, t + a + d);
    }
    return t + a + h + d;
  }

  _gain(v) { const g = this.ctx.createGain(); g.gain.value = clamp(fin(v, 1), 0, 8); return g; }

  _osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = clamp(fin(freq, 440), 0.01, 20000);
    return o;
  }

  _filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clamp(fin(freq, 1000), 10, 20000);
    if (q !== undefined) f.Q.value = clamp(fin(q, 1), 0.0001, 40);
    return f;
  }

  _noise(rate, pink) {
    const s = this.ctx.createBufferSource();
    s.buffer = pink ? this._pinkBuf : this._noiseBuf;
    s.loop = true;
    s.playbackRate.value = clamp(fin(rate, 1), 0.06, 6);
    return s;
  }

  /** Stereo placement helper that degrades to null on ancient WebAudio. */
  _pan(v) {
    if (!this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(fin(v, 0), -1, 1);
    return p;
  }

  /**
   * Stop + auto-disconnect a finished voice.
   * Music and sfx are counted in separate buckets: the voice cap in sfx() must
   * never be tripped by a busy music bed, or gameplay audio would drop out.
   */
  _kill(stopAt, srcs, nodes) {
    const t = this._at(stopAt);
    let last = null;
    for (let i = 0; i < srcs.length; i++) {
      const s = srcs[i];
      if (!s) continue;
      try { s.stop(t); } catch (e) {}
      last = s;
    }
    if (!last) return;
    const isSfx = this._inSfx;
    if (isSfx) this._sfxLive++; else this._live++;
    last.onended = () => {
      if (isSfx) this._sfxLive--; else this._live--;
      for (let i = 0; i < srcs.length; i++) { try { if (srcs[i]) srcs[i].disconnect(); } catch (e) {} }
      if (nodes) for (let i = 0; i < nodes.length; i++) { try { if (nodes[i]) nodes[i].disconnect(); } catch (e) {} }
    };
  }

  /** Per-voice reverb send into a specific wet bus. */
  _sendTo(dest, node, amount) {
    if (!dest || !(amount > 0)) return null;
    const g = this._gain(clamp(amount, 0, 1.5));
    node.connect(g);
    g.connect(dest);
    return g;
  }

  /** Per-voice reverb send straight to the global tank (sfx/stingers). */
  _send(node, amount) {
    return this._sendTo(this.verbIn, node, amount);
  }

  /* ====================================================================
   * Volumes / duck
   * ==================================================================*/
  setVolumes(v) {
    if (!v || typeof v !== 'object') return;
    if (typeof v.master === 'number') this.vol.master = clamp(fin(v.master, DEFAULT_VOL.master), 0, 1);
    if (typeof v.music === 'number') this.vol.music = clamp(fin(v.music, DEFAULT_VOL.music), 0, 1);
    if (typeof v.sfx === 'number') this.vol.sfx = clamp(fin(v.sfx, DEFAULT_VOL.sfx), 0, 1);
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime + 0.02;
    this._ramp(this.master.gain, this.vol.master, t);
    this._ramp(this.musicBus.gain, this.vol.music, t);
    this._ramp(this.sfxBus.gain, this.vol.sfx, t);
    this._ramp(this.stingerBus.gain, this._stingerLevel(), t);
  }

  /** Dip the music bed (death / crest / clear) so a stinger reads. */
  duck(ms) {
    if (!this.ctx || !this.ready) return;
    const d = clamp(fin(ms, 600), 80, 6000) / 1000;
    const t = this.ctx.currentTime;
    const g = this.musicDuck.gain;
    try { g.cancelScheduledValues(t); } catch (e) {}
    this._set(g, fin(g.value, 1), t);
    this._ramp(g, 0.22, t + 0.05);
    this._ramp(g, 0.22, t + d * 0.55);
    this._ramp(g, 1, t + d);
  }

  /* ====================================================================
   * Mood — CONTRACT §5 setMood()
   * ==================================================================*/
  /**
   * Colour the current bed. Never restarts or swaps music: the bed keeps its
   * phrase position, so surfacing from water or clearing a Warden fight is a
   * seamless change of light rather than a cut.
   * @param {'explore'|'danger'|'underwater'|'clear'|'boss'} mood
   */
  setMood(mood) {
    const id = (typeof mood === 'string' && MOODS[mood]) ? mood : 'explore';
    if (!this.ctx || !this.ready) { this._pendingMood = id; this.mood = id; return; }
    if (this.mood === id) return;
    this.mood = id;
    this._applyMood(id, MOOD_FADE);
  }

  /** @param {string} id @param {number} fade seconds */
  _applyMood(id, fade) {
    const m = MOODS[id] || MOODS.explore;
    const now = this.ctx.currentTime;
    const t = now + Math.max(0.02, fin(fade, MOOD_FADE));
    /* Cutoff is ramped in log-ish steps so 17 kHz -> 520 Hz sounds like a
       filter closing rather than a cliff; two segments are enough for that. */
    const cur = fin(this.moodTone.frequency.value, 17000);
    const mid = Math.sqrt(clamp(cur, 20, 20000) * clamp(m.tone, 20, 20000));
    this._set(this.moodTone.frequency, cur, now);
    this._ramp(this.moodTone.frequency, mid, now + (t - now) * 0.45);
    this._ramp(this.moodTone.frequency, m.tone, t);
    this._target(this.moodTone.Q, m.res, now, 0.2);
    this._ramp(this.moodShine.gain, m.shine, t);
    this._ramp(this.moodGain.gain, m.gain, t);
    this._ramp(this.moodWobDepth.gain, m.wob, t);
  }

  /* ====================================================================
   * Music beds + look-ahead scheduler
   * ==================================================================*/
  _startScheduler() {
    if (this._timer || !IS_BROWSER) return;
    this._timer = setInterval(() => this._tick(), LOOKAHEAD_MS);
  }

  _stopScheduler() {
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
  }

  _resyncBeds() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      if (b.nextTime < now) {
        /* Snap forward to the next bar so the phrase never restarts mid-beat. */
        const spb = b.stepsPerBar;
        b.stepIdx = Math.ceil(b.stepIdx / spb) * spb;
        b.nextTime = now + 0.05;
      }
    }
  }

  _tick() {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.ready) return;
      if (ctx.state !== 'running') { this._resyncBeds(); return; }

      const now = ctx.currentTime;
      const horizon = now + HORIZON;

      for (let i = this._active.length - 1; i >= 0; i--) {
        const bed = this._active[i];
        if (bed.nextTime < now - 0.4) {
          const spb = bed.stepsPerBar;
          bed.stepIdx = Math.ceil(bed.stepIdx / spb) * spb;
          bed.nextTime = now + 0.03;
        }
        let guard = 0;
        while (bed.nextTime < horizon && guard++ < 64) {
          /* One bad step never stops the music. The mood layer is scheduled
             INTO the bed, so it fades out with the bed on a theme change. */
          try { bed.step(bed, bed.stepIdx, bed.nextTime); } catch (e) {}
          if (bed.retireAt === 0) {
            try { this._moodLayer(bed, bed.stepIdx, bed.nextTime); } catch (e) {}
          }
          bed.stepIdx++;
          bed.nextTime += bed.stepDur;
        }
        if (bed.retireAt > 0 && now >= bed.retireAt) {
          this._teardownBed(bed);
          this._active.splice(i, 1);
        }
      }
    } catch (e) { /* the scheduler must never throw into the page */ }
  }

  /**
   * Crossfade to another bed over 1.2 s (CONTRACT §5). Unknown ids stop the
   * music cleanly, which is what the title screen and the loading state want.
   * @param {'keep'|'verdant'|'ember'|'rime'|'azure'|null} themeId
   */
  setTheme(themeId) {
    const id = typeof themeId === 'string' ? themeId : null;
    if (!this.ctx || !this.ready) { this._pendingTheme = id; return; }
    if (this.theme === id) return;
    const now = this.ctx.currentTime;

    /* Retire whatever is playing. */
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      if (b.retireAt > 0) continue;
      this._ramp(b.out.gain, fin(b.out.gain.value, 1), now);
      this._ramp(b.out.gain, 0, now + CROSSFADE);
      this._ramp(b.rev.gain, fin(b.rev.gain.value, 1), now);
      this._ramp(b.rev.gain, 0, now + CROSSFADE);
      b.retireAt = now + CROSSFADE + 0.35;
    }

    this.theme = id;
    if (!id) return;

    const bed = this._makeBed(id);
    if (!bed) return;
    bed.retireAt = 0;
    bed.stepIdx = 0;
    bed.nextTime = now + 0.06;
    this._set(bed.out.gain, 0, now);
    this._ramp(bed.out.gain, bed.level, now + CROSSFADE);
    this._set(bed.rev.gain, 0, now);
    this._ramp(bed.rev.gain, bed.revLevel, now + CROSSFADE);
    this._active.push(bed);
  }

  _teardownBed(bed) {
    try { bed.out.disconnect(); } catch (e) {}
    if (bed.nodes) {
      for (let i = 0; i < bed.nodes.length; i++) { try { bed.nodes[i].disconnect(); } catch (e) {} }
    }
    if (bed.srcs) {
      const t = this.ctx ? this.ctx.currentTime : 0;
      for (let i = 0; i < bed.srcs.length; i++) { try { bed.srcs[i].stop(t); } catch (e) {} }
    }
  }

  /**
   * Shared bed skeleton: a dry bus into the music chain and a wet bus into the
   * reverb tank, both crossfaded together so a long pad tail cannot keep
   * ringing in the reverb after the theme has already changed.
   */
  _bedBase(id, bpm, stepsPerBeat, level, revAmount) {
    const out = this._gain(0);
    out.connect(this.musicBus);
    const rev = this._gain(0);
    rev.connect(this.verbIn);
    return {
      id, bpm,
      stepsPerBeat,
      stepsPerBar: stepsPerBeat * 4,
      stepDur: 60 / bpm / stepsPerBeat,
      level: clamp(level, 0, 1.2),
      revLevel: clamp(revAmount, 0, 1),
      out, rev,
      nodes: [out, rev],
      srcs: [],
      stepIdx: 0,
      nextTime: 0,
      retireAt: 0,
      step: null,
    };
  }

  _makeBed(id) {
    switch (id) {
      case 'keep': return this._bedKeep();
      case 'verdant': return this._bedVerdant();
      case 'ember': return this._bedEmber();
      case 'rime': return this._bedRime();
      case 'azure': return this._bedAzure();
      default: return null;
    }
  }

  /* ------------------------------------------------------------- KEEP
   * 72 BPM, C major. The hub: a warm harp rolling through a five-note chord
   * with a soft dotted echo, a slow string choir underneath, and a cello
   * pedal every four bars. Deliberately NO percussion — the Keep should feel
   * like a held breath between courses, and a pulse would make it a level.
   * ----------------------------------------------------------------- */
  _bedKeep() {
    const bed = this._bedBase('keep', 72, 2, 0.56, 0.40);
    /* Dotted-eighth echo, tuned to the tempo so the harp blooms in time. */
    const dl = this.ctx.createDelay(1.5);
    dl.delayTime.value = (60 / 72) * 0.75;
    const fb = this._gain(0.32);
    const dlp = this._filter('lowpass', 2400, 0.7);
    const dOut = this._gain(0.40);
    dl.connect(dlp); dlp.connect(fb); fb.connect(dl);
    dl.connect(dOut); dOut.connect(bed.out);
    bed.echo = dl;
    bed.nodes.push(dl, fb, dlp, dOut);
    bed.step = (b, i, t) => this._stepKeep(b, i, t);
    return bed;
  }

  _stepKeep(bed, i, t) {
    const s = i % 8;
    const bar = Math.floor(i / 8);
    const ch = KEEP_CHORDS[bar % KEEP_CHORDS.length];

    /* --- harp: one plucked string per eighth, rolling up and back down --- */
    {
      const note = ch.harp[KEEP_ROLL[s]];
      const f = mtof(note);
      const o1 = this._osc('triangle', f, t);
      const o2 = this._osc('sine', f * 2.002, t);   // slight beat = real string
      const o3 = this._osc('sine', f * 3.01, t);
      const lp = this._filter('lowpass', 4200, 3);
      const g = this._gain(0);
      const g2 = this._gain(0.20), g3 = this._gain(0.07);
      o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp);
      lp.connect(g); g.connect(bed.out);
      if (bed.echo) g.connect(bed.echo);
      /* Pluck: bright for 20 ms, then the string settles. */
      this._set(lp.frequency, 5200, t);
      this._ramp(lp.frequency, 1300, t + 0.22);
      this._env(g.gain, t, s === 0 ? 0.20 : 0.145, 0.003, 0.85, 0);
      this._sendTo(bed.rev, g, 0.42);
      o1.start(t); o2.start(t); o3.start(t);
      this._kill(t + 0.95, [o1, o2, o3], [lp, g, g2, g3]);
    }

    /* --- counter voice: an octave/fifth sparkle over the roll ------------ */
    const co = KEEP_COUNTER[s];
    if (co >= 0) {
      const f = mtof(ch.harp[KEEP_ROLL[s]] + co);
      const o = this._osc('sine', f, t + 0.03);
      const g = this._gain(0);
      const pan = this._pan((this._rand() * 2 - 1) * 0.4);
      o.connect(g);
      if (pan) { g.connect(pan); pan.connect(bed.out); } else { g.connect(bed.out); }
      this._env(g.gain, t + 0.03, 0.075, 0.006, 1.1, 0);
      this._sendTo(bed.rev, g, 0.7);
      o.start(t + 0.03);
      this._kill(t + 1.2, [o], [g, pan]);
    }

    /* --- string choir: one chord per two bars, slow swell + vibrato ------ */
    if (s === 0 && bar % 2 === 0) {
      const dur = bed.stepDur * 8 * 2;
      const lp = this._filter('lowpass', 1450, 0.8);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const vnodes = [lp, g];
      /* One shared vibrato LFO for the whole section — real sections breathe
         together, and it is one oscillator instead of four. */
      const lfo = this._osc('sine', 4.6, t);
      const lfoG = this._gain(4.5);                   // cents
      lfo.connect(lfoG);
      srcs.push(lfo); vnodes.push(lfoG);
      for (let k = 0; k < ch.str.length; k++) {
        const o = this._osc(k === 0 ? 'sawtooth' : 'triangle', mtof(ch.str[k]), t);
        o.detune.value = (k - 1.5) * 6;
        lfoG.connect(o.detune);
        const og = this._gain(k === 0 ? 0.11 : 0.15);
        const pan = this._pan((k - 1.5) * 0.3);
        o.connect(og);
        if (pan) { og.connect(pan); pan.connect(lp); vnodes.push(pan); } else { og.connect(lp); }
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      lfo.start(t);
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.32, t + 2.4);
      this._ramp(g.gain, 0.28, t + dur - 1.6);
      this._ramp(g.gain, 0, t + dur + 0.15);
      this._sendTo(bed.rev, g, 0.44);
      this._kill(t + dur + 0.3, srcs, vnodes);
    }

    /* --- cello pedal every four bars ------------------------------------- */
    if (s === 0 && bar % 4 === 0) {
      const dur = bed.stepDur * 8 * 4;
      const o = this._osc('sawtooth', mtof(ch.root), t);
      const o2 = this._osc('sine', mtof(ch.root - 12), t);
      const lp = this._filter('lowpass', 340, 2.4);
      const g = this._gain(0);
      const g2 = this._gain(0.34);
      o.connect(lp); o2.connect(g2); g2.connect(lp);
      lp.connect(g); g.connect(bed.out);
      this._set(lp.frequency, 250, t);
      this._ramp(lp.frequency, 520, t + dur * 0.5);
      this._ramp(lp.frequency, 260, t + dur);
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.30, t + 3.0);
      this._ramp(g.gain, 0.26, t + dur - 2.0);
      this._ramp(g.gain, 0, t + dur + 0.2);
      this._sendTo(bed.rev, g, 0.25);
      o.start(t); o2.start(t);
      this._kill(t + dur + 0.35, [o, o2], [lp, g, g2]);
    }
  }

  /* ---------------------------------------------------------- VERDANT
   * 118 BPM, D major. Sunlit and springy: a pizzicato string bass on the
   * eighths (short filtered saw with a rosin scrape), a flute melody with real
   * breath noise that changes phrase every bar, tambourine on the offbeats,
   * and a bright string swell every four bars.
   * ----------------------------------------------------------------- */
  _bedVerdant() {
    const bed = this._bedBase('verdant', 118, 4, 0.60, 0.26);
    bed.step = (b, i, t) => this._stepVerdant(b, i, t);
    return bed;
  }

  _stepVerdant(bed, i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16);

    /* --- pizzicato bass -------------------------------------------------- */
    const pz = VERD_PIZZ[s];
    if (pz > 0) {
      const f = mtof(pz);
      const o1 = this._osc('sawtooth', f, t);
      const o2 = this._osc('triangle', f * 0.5, t);
      const lp = this._filter('lowpass', 1500, 5);
      const g = this._gain(0);
      const g2 = this._gain(0.30);
      o1.connect(lp); o2.connect(g2); g2.connect(lp);
      lp.connect(g); g.connect(bed.out);
      this._set(lp.frequency, 2600, t);
      this._ramp(lp.frequency, 420, t + 0.13);
      this._env(g.gain, t, s === 0 ? 0.30 : 0.23, 0.0018, 0.17, 0);
      /* Rosin scrape: the tiny bit of noise that makes a pluck a STRING. */
      const n = this._noise(this._jit(0.15), false);
      const bp = this._filter('bandpass', 2100 * this._jit(0.1), 4);
      const ng = this._gain(0);
      n.connect(bp); bp.connect(ng); ng.connect(bed.out);
      this._env(ng.gain, t, 0.035, 0.001, 0.032, 0);
      this._sendTo(bed.rev, g, 0.14);
      o1.start(t); o2.start(t); n.start(t, this._rand() * 1.6);
      this._kill(t + 0.26, [o1, o2, n], [lp, g, g2, bp, ng]);
    }

    /* --- flute melody ---------------------------------------------------- */
    const mel = VERD_MELODY[bar % VERD_MELODY.length][s];
    if (mel > 0) {
      const f = mtof(mel);
      const dur = bed.stepDur * 2;
      const o1 = this._osc('sine', f, t);
      const o2 = this._osc('triangle', f, t);
      const g = this._gain(0);
      const g2 = this._gain(0.12);
      const pan = this._pan(0.18);
      o1.connect(g); o2.connect(g2); g2.connect(g);
      if (pan) { g.connect(pan); pan.connect(bed.out); } else { g.connect(bed.out); }
      /* A flute leans INTO its note: a fast scoop up over the first 30 ms. */
      this._set(o1.frequency, f * 0.985, t);
      this._ramp(o1.frequency, f, t + 0.03);
      this._set(o2.frequency, f * 0.985, t);
      this._ramp(o2.frequency, f, t + 0.03);
      this._env(g.gain, t, 0.17, 0.026, dur * 0.75, 0, dur * 0.4);
      /* Breath: band-passed pink noise that fades as the tone establishes. */
      const br = this._noise(1.1, true);
      const bhp = this._filter('highpass', 2400, 0.7);
      const bbp = this._filter('bandpass', f * 2.2, 1.6);
      const bg = this._gain(0);
      br.connect(bhp); bhp.connect(bbp); bbp.connect(bg); bg.connect(bed.out);
      this._env(bg.gain, t, 0.045, 0.012, dur * 0.5, 0);
      this._sendTo(bed.rev, g, 0.34);
      o1.start(t); o2.start(t); br.start(t, this._rand() * 1.5);
      this._kill(t + dur + 0.3, [o1, o2, br], [g, g2, pan, bhp, bbp, bg]);
    }

    /* --- tambourine ------------------------------------------------------ */
    const tv = VERD_TAMB[s];
    if (tv > 0) {
      const n = this._noise(this._jit(0.1), false);
      const hp = this._filter('highpass', 5200, 0.8);
      const g = this._gain(0);
      n.connect(hp); hp.connect(g); g.connect(bed.out);
      this._env(g.gain, t, tv * 0.075, 0.001, tv > 0.5 ? 0.09 : 0.038, 0);
      /* Jingle: three narrow resonances make it read as metal zils. */
      const rn = this._noise(this._jit(0.2), false);
      const rout = this._gain(0);
      rout.connect(bed.out);
      const nodes = [hp, g, rout];
      const jf = [6300, 8900, 11400];
      for (let k = 0; k < jf.length; k++) {
        const bp = this._filter('bandpass', jf[k] * this._jit(0.03), 16);
        const bg = this._gain(0.5 / (1 + k));
        rn.connect(bp); bp.connect(bg); bg.connect(rout);
        nodes.push(bp, bg);
      }
      this._env(rout.gain, t, tv * 0.05, 0.0015, 0.14, 0);
      this._sendTo(bed.rev, rout, 0.2);
      n.start(t, this._rand() * 1.7); rn.start(t, this._rand() * 1.7);
      this._kill(t + 0.24, [n, rn], nodes);
    }

    /* --- string swell every four bars ------------------------------------ */
    if (s === 0 && bar % 4 === 0) {
      const dur = bed.stepDur * 16 * 4;
      const chord = VERD_STRINGS[(bar / 4 | 0) % VERD_STRINGS.length];
      const lp = this._filter('lowpass', 2400, 0.8);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const vnodes = [lp, g];
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc('sawtooth', mtof(chord[k]), t);
        o.detune.value = (k - 1.5) * 8;
        const og = this._gain(0.085);
        const pan = this._pan((k / (chord.length - 1)) * 1.3 - 0.65);
        o.connect(og);
        if (pan) { og.connect(pan); pan.connect(lp); vnodes.push(pan); } else { og.connect(lp); }
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(lp.frequency, 1100, t);
      this._ramp(lp.frequency, 3400, t + dur * 0.55);
      this._ramp(lp.frequency, 1300, t + dur);
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.26, t + dur * 0.5);
      this._ramp(g.gain, 0.20, t + dur - 0.6);
      this._ramp(g.gain, 0, t + dur + 0.1);
      this._sendTo(bed.rev, g, 0.3);
      this._kill(t + dur + 0.25, srcs, vnodes);
    }
  }

  /* ------------------------------------------------------------ EMBER
   * 100 BPM, D minor. The foundry: a low brass section with a real filter-env
   * "braaam", an industrial 16th pulse gated out of noise, inharmonic anvil
   * clanks on a five-partial bank, a floor-shaking kick, and a two-note motif
   * that climbs every two bars.
   * ----------------------------------------------------------------- */
  _bedEmber() {
    const bed = this._bedBase('ember', 100, 4, 0.58, 0.30);
    bed.step = (b, i, t) => this._stepEmber(b, i, t);
    return bed;
  }

  _stepEmber(bed, i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16);

    /* --- kick ------------------------------------------------------------ */
    if (EMB_KICK[s]) {
      const o = this._osc('sine', 128, t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._set(o.frequency, 128, t);
      this._ramp(o.frequency, 41, t + 0.09);
      this._env(g.gain, t, 0.66, 0.002, 0.22, 0);
      const th = this._noise(0.5, true);
      const lp = this._filter('lowpass', 200, 1.2);
      const tg = this._gain(0);
      th.connect(lp); lp.connect(tg); tg.connect(bed.out);
      this._env(tg.gain, t, 0.16, 0.002, 0.17, 0);
      o.start(t); th.start(t, this._rand() * 1.5);
      this._kill(t + 0.35, [o, th], [g, lp, tg]);
    }

    /* --- industrial pulse: gated noise, accent pattern -------------------- */
    const pv = EMB_PULSE[s];
    if (pv > 0) {
      const n = this._noise(this._jit(0.12), false);
      const bp = this._filter('bandpass', 1500 * this._jit(0.08), 2.4);
      const hp = this._filter('highpass', 700, 0.7);
      const g = this._gain(0);
      n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(bed.out);
      const dur = pv > 0.6 ? 0.075 : 0.038;
      this._env(g.gain, t, pv * 0.11, 0.0012, dur, 0);
      /* Machine sting on the accents: a square blip that reads as a relay. */
      if (pv >= 1) {
        const sq = this._osc('square', 320, t);
        const sg = this._gain(0);
        sq.connect(sg); sg.connect(bed.out);
        this._ramp(sq.frequency, 190, t + 0.05);
        this._env(sg.gain, t, 0.05, 0.001, 0.05, 0);
        sq.start(t);
        this._kill(t + 0.12, [sq], [sg]);
      }
      n.start(t, this._rand() * 1.7);
      this._kill(t + dur + 0.05, [n], [bp, hp, g]);
    }

    /* --- anvil clank: inharmonic partial bank ---------------------------- */
    if (s === 4 || s === 11 || (bar % 2 === 1 && s === 14)) {
      const amp = s === 4 ? 0.34 : (s === 11 ? 0.26 : 0.18);
      const n = this._noise(this._jit(0.1), false);
      const pre = this._filter('highpass', 320, 0.7);
      const out = this._gain(0);
      n.connect(pre);
      const nodes = [pre, out];
      for (let k = 0; k < EMB_CLANK.length; k++) {
        const bp = this._filter('bandpass', EMB_CLANK[k] * this._jit(0.02), 22);
        const bg = this._gain(0.9 / (1 + k * 0.62));
        pre.connect(bp); bp.connect(bg); bg.connect(out);
        nodes.push(bp, bg);
      }
      out.connect(bed.out);
      this._env(out.gain, t, amp, 0.0015, 0.5, 0);
      this._sendTo(bed.rev, out, 0.45);
      n.start(t, this._rand() * 1.6);
      this._kill(t + 0.62, [n], nodes);
    }

    /* --- low brass: filter-env braaam, one chord per bar ------------------ */
    if (s === 0) {
      const chord = EMB_BRASS[bar % EMB_BRASS.length];
      const dur = bed.stepDur * 16 * 0.92;
      const lp = this._filter('lowpass', 300, 4.5);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const vnodes = [lp, g];
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc(k < 2 ? 'sawtooth' : 'square', mtof(chord[k]), t);
        o.detune.value = (k % 2 === 0 ? -6 : 7);
        const og = this._gain(k < 2 ? 0.22 : 0.10);
        o.connect(og); og.connect(lp);
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      /* The brass character IS the filter envelope: closed, blown open in
         180 ms, then settling back as the section sustains. */
      this._set(lp.frequency, 260, t);
      this._ramp(lp.frequency, 1750, t + 0.18);
      this._ramp(lp.frequency, 620, t + 0.7);
      this._ramp(lp.frequency, 330, t + dur);
      this._env(g.gain, t, 0.28, 0.03, dur * 0.4, 0, dur * 0.5);
      this._sendTo(bed.rev, g, 0.3);
      this._kill(t + dur + 0.25, srcs, vnodes);
    }

    /* --- climbing two-note motif every two bars --------------------------- */
    if (s === 8 && bar % 2 === 0) {
      const pair = EMB_MOTIF[(bar / 2 | 0) % EMB_MOTIF.length];
      const beat = bed.stepDur * 4;
      for (let k = 0; k < 2; k++) {
        const at = t + k * beat;
        const f = mtof(pair[k] + 12);
        const o = this._osc('square', f, at);
        const o2 = this._osc('sawtooth', f * 0.5, at);
        const lp = this._filter('lowpass', 1100, 6);
        const g = this._gain(0);
        const g2 = this._gain(0.24);
        o.connect(lp); o2.connect(g2); g2.connect(lp);
        lp.connect(g); g.connect(bed.out);
        this._set(lp.frequency, 780, at);
        this._ramp(lp.frequency, 2400, at + 0.24);
        this._ramp(lp.frequency, 900, at + beat * 0.9);
        this._env(g.gain, at, 0.15, 0.02, beat * 0.55, 0, beat * 0.3);
        this._sendTo(bed.rev, g, 0.5);
        o.start(at); o2.start(at);
        this._kill(at + beat + 0.2, [o, o2], [lp, g, g2]);
      }
    }

    /* --- steam release every eight bars ---------------------------------- */
    if (s === 12 && bar % 8 === 7) {
      const n = this._noise(1, true);
      const bp = this._filter('bandpass', 1000, 1.5);
      const g = this._gain(0);
      n.connect(bp); bp.connect(g); g.connect(bed.out);
      this._set(bp.frequency, 820, t);
      this._ramp(bp.frequency, 3600, t + 1.3);
      this._env(g.gain, t, 0.19, 0.26, 1.05, 0);
      this._sendTo(bed.rev, g, 0.3);
      n.start(t, this._rand() * 1.4);
      this._kill(t + 1.7, [n], [bp, g]);
    }
  }

  /* ------------------------------------------------------------- RIME
   * 84 BPM, C lydian (the raised fourth is what makes it read as COLD rather
   * than sad). A music-box: a struck metal tine, a very wide detuned pad, slow
   * wind, and a high ice shimmer every four bars. No drums.
   * ----------------------------------------------------------------- */
  _bedRime() {
    const bed = this._bedBase('rime', 84, 2, 0.56, 0.60);
    bed.step = (b, i, t) => this._stepRime(b, i, t);
    return bed;
  }

  _stepRime(bed, i, t) {
    const s = i % 8;
    const bar = Math.floor(i / 8);

    /* --- music box: a tine is a fast metallic transient over a sine body -- */
    const bn = RIME_BOX[bar % RIME_BOX.length][s];
    if (bn > 0) {
      const f = mtof(bn);
      const body = this._osc('sine', f, t);
      const p2 = this._osc('sine', f * 3.98, t);     // slightly stretched partial
      const p3 = this._osc('sine', f * 9.1, t);
      const g = this._gain(0);
      const g2 = this._gain(0.16), g3 = this._gain(0.05);
      const pan = this._pan((this._rand() * 2 - 1) * 0.45);
      body.connect(g); p2.connect(g2); g2.connect(g); p3.connect(g3); g3.connect(g);
      if (pan) { g.connect(pan); pan.connect(bed.out); } else { g.connect(bed.out); }
      /* The upper partials die far faster than the body — that ratio IS the
         difference between a music box and a bell. */
      this._env(g2.gain, t, 0.16, 0.001, 0.35, 0);
      this._env(g3.gain, t, 0.05, 0.001, 0.11, 0);
      this._env(g.gain, t, 0.19, 0.002, 2.1, 0);
      /* Mechanism: the comb-tooth click of the cylinder pin. */
      const ck = this._noise(1.8, false);
      const chp = this._filter('highpass', 7200, 0.9);
      const cg = this._gain(0);
      ck.connect(chp); chp.connect(cg); cg.connect(bed.out);
      this._env(cg.gain, t, 0.028, 0.0008, 0.016, 0);
      this._sendTo(bed.rev, g, 0.8);
      body.start(t); p2.start(t); p3.start(t); ck.start(t, this._rand() * 1.7);
      this._kill(t + 2.4, [body, p2, p3, ck], [g, g2, g3, pan, chp, cg]);
    }

    /* --- wide pad: a new chord every four bars ---------------------------- */
    if (s === 0 && bar % 4 === 0) {
      const dur = bed.stepDur * 8 * 4;
      const chord = RIME_PADS[(bar / 4 | 0) % RIME_PADS.length];
      const lp = this._filter('lowpass', 1050, 0.8);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const vnodes = [lp, g];
      const dets = [-13, -5, 0, 6, 14];
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc(k % 2 === 0 ? 'triangle' : 'sawtooth', mtof(chord[k]), t);
        o.detune.value = dets[k % dets.length];
        const og = this._gain(0.12);
        const pan = this._pan((k / (chord.length - 1)) * 1.6 - 0.8);
        o.connect(og);
        if (pan) { og.connect(pan); pan.connect(lp); vnodes.push(pan); } else { og.connect(lp); }
        vnodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(g.gain, 0, t);
      this._ramp(g.gain, 0.32, t + 3.2);
      this._ramp(g.gain, 0.28, t + dur - 2.4);
      this._ramp(g.gain, 0, t + dur + 0.2);
      this._sendTo(bed.rev, g, 0.55);
      this._kill(t + dur + 0.4, srcs, vnodes);
    }

    /* --- wind: overlapping pink-noise voices, panned apart ---------------- */
    if (s === 0 && bar % 2 === 0) {
      const n = this._noise(0.5, true);
      const bp = this._filter('bandpass', 400, 1.1);
      const hp = this._filter('highpass', 180, 0.6);
      const g = this._gain(0);
      const pan = this._pan((this._rand() * 2 - 1) * 0.7);
      n.connect(bp); bp.connect(hp); hp.connect(g);
      if (pan) { g.connect(pan); pan.connect(bed.out); } else { g.connect(bed.out); }
      const dur = 6.4;
      this._set(bp.frequency, 320, t);
      this._ramp(bp.frequency, 900 * this._jit(0.22), t + dur * 0.45);
      this._ramp(bp.frequency, 350, t + dur);
      this._env(g.gain, t, 0.14, 1.8, 2.6, 0, 1.5);
      this._sendTo(bed.rev, g, 0.4);
      n.start(t, this._rand() * 1.5);
      this._kill(t + dur + 0.3, [n], [bp, hp, g, pan]);
    }

    /* --- ice shimmer every four bars -------------------------------------- */
    if (s === 4 && bar % 4 === 2) {
      const base = RIME_SHIMMER[(bar / 4 | 0) % RIME_SHIMMER.length];
      const srcs = [];
      const nodes = [];
      for (let k = 0; k < 3; k++) {
        const at = t + k * 0.11;
        const o = this._osc('sine', mtof(base + k * 5), at);
        const g = this._gain(0);
        const pan = this._pan((k - 1) * 0.5);
        o.connect(g);
        if (pan) { g.connect(pan); pan.connect(bed.out); nodes.push(pan); } else { g.connect(bed.out); }
        this._env(g.gain, at, 0.05, 0.02, 1.6, 0);
        this._sendTo(bed.rev, g, 0.95);
        o.start(at);
        srcs.push(o); nodes.push(g);
      }
      this._kill(t + 2.1, srcs, nodes);
    }

    /* --- sub pulse every four bars ---------------------------------------- */
    if (s === 0 && bar % 4 === 2) {
      const o = this._osc('sine', mtof(31), t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._env(g.gain, t, 0.30, 0.6, 2.0, 0, 0.4);
      o.start(t);
      this._kill(t + 3.2, [o], [g]);
    }
  }

  /* ------------------------------------------------------------ AZURE
   * 96 BPM, G mixolydian (the flat seventh keeps it buoyant, never resolved).
   * A marimba ostinato with a hard wooden attack, a wordless choir built from
   * a rounded formant bank, sparse water droplets, and a soft plucked bass.
   * ----------------------------------------------------------------- */
  _bedAzure() {
    const bed = this._bedBase('azure', 96, 4, 0.58, 0.44);
    bed.step = (b, i, t) => this._stepAzure(b, i, t);
    return bed;
  }

  _stepAzure(bed, i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16);

    /* --- marimba ostinato ------------------------------------------------- */
    const oi = AZ_OSTINATO[s];
    if (oi >= 0) {
      const tr = AZ_TRANSPOSE[bar % AZ_TRANSPOSE.length];
      const f = mtof(AZ_SCALE[oi % AZ_SCALE.length] + tr);
      const body = this._osc('sine', f, t);
      const h4 = this._osc('sine', f * 4, t);        // marimba's 4:1 bar mode
      const h10 = this._osc('sine', f * 9.8, t);
      const g = this._gain(0);
      const g4 = this._gain(0.20), g10 = this._gain(0.06);
      const pan = this._pan((oi / 7) * 0.7 - 0.35);
      body.connect(g); h4.connect(g4); g4.connect(g); h10.connect(g10); g10.connect(g);
      if (pan) { g.connect(pan); pan.connect(bed.out); } else { g.connect(bed.out); }
      this._env(g4.gain, t, 0.20, 0.001, 0.10, 0);
      this._env(g10.gain, t, 0.06, 0.001, 0.035, 0);
      this._env(g.gain, t, s % 4 === 0 ? 0.19 : 0.145, 0.0015, 0.46, 0);
      /* Mallet knock: the wooden thud under the pitch. */
      const k = this._noise(this._jit(0.15), false);
      const kf = this._filter('bandpass', 1250 * this._jit(0.1), 2.2);
      const kg = this._gain(0);
      k.connect(kf); kf.connect(kg); kg.connect(bed.out);
      this._env(kg.gain, t, 0.045, 0.001, 0.026, 0);
      this._sendTo(bed.rev, g, 0.36);
      body.start(t); h4.start(t); h10.start(t); k.start(t, this._rand() * 1.6);
      this._kill(t + 0.6, [body, h4, h10, k], [g, g4, g10, pan, kf, kg]);
    }

    /* --- plucked bass ----------------------------------------------------- */
    if (AZ_BASS[s]) {
      const chord = AZ_CHOIR[bar % AZ_CHOIR.length];
      const f = mtof(chord[0] - 12);
      const o = this._osc('triangle', f, t);
      const o2 = this._osc('sine', f * 0.5, t);
      const lp = this._filter('lowpass', 700, 3);
      const g = this._gain(0);
      const g2 = this._gain(0.4);
      o.connect(lp); o2.connect(g2); g2.connect(lp);
      lp.connect(g); g.connect(bed.out);
      this._set(lp.frequency, 1300, t);
      this._ramp(lp.frequency, 300, t + 0.3);
      this._env(g.gain, t, 0.34, 0.004, 0.5, 0);
      o.start(t); o2.start(t);
      this._kill(t + 0.62, [o, o2], [lp, g, g2]);
    }

    /* --- wordless choir: a rounded formant bank over a saw stack ---------- */
    if (s === 0 && bar % 2 === 0) {
      const dur = bed.stepDur * 16 * 2;
      const chord = AZ_CHOIR[bar % AZ_CHOIR.length];
      const src = this._gain(0.5);
      const out = this._gain(0);
      const nodes = [src, out];
      const fg = [1, 0.6, 0.22];
      for (let k = 0; k < AZ_FORMANTS.length; k++) {
        const bp = this._filter('bandpass', AZ_FORMANTS[k], 7 + k * 1.5);
        const bg = this._gain(fg[k]);
        src.connect(bp); bp.connect(bg); bg.connect(out);
        nodes.push(bp, bg);
      }
      out.connect(bed.out);
      const srcs = [];
      /* A choir is many slightly-late, slightly-detuned people. */
      const lfo = this._osc('sine', 5.1, t);
      const lfoG = this._gain(6);
      lfo.connect(lfoG);
      srcs.push(lfo); nodes.push(lfoG);
      for (let k = 0; k < chord.length; k++) {
        const o = this._osc('sawtooth', mtof(chord[k] + 12), t);
        o.detune.value = (k - 1.5) * 7;
        lfoG.connect(o.detune);
        const og = this._gain(0.15);
        o.connect(og); og.connect(src);
        nodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      lfo.start(t);
      this._set(out.gain, 0, t);
      this._ramp(out.gain, 0.36, t + 1.9);
      this._ramp(out.gain, 0.30, t + dur - 1.3);
      this._ramp(out.gain, 0, t + dur + 0.1);
      this._sendTo(bed.rev, out, 0.5);
      this._kill(t + dur + 0.25, srcs, nodes);
    }

    /* --- water droplets --------------------------------------------------- */
    if (s === 6 || (bar % 2 === 1 && s === 13)) {
      const j = this._jit(0.3);
      const f0 = 900 * j;
      const o = this._osc('sine', f0, t);
      const g = this._gain(0);
      const pan = this._pan((this._rand() * 2 - 1) * 0.65);
      o.connect(g);
      if (pan) { g.connect(pan); pan.connect(bed.out); } else { g.connect(bed.out); }
      /* A drip is a fast UP-glide: the cavity shrinks as the bubble collapses. */
      this._set(o.frequency, f0 * 0.55, t);
      this._ramp(o.frequency, f0 * 1.7, t + 0.055);
      this._env(g.gain, t, 0.075, 0.001, 0.09, 0);
      this._sendTo(bed.rev, g, 0.7);
      o.start(t);
      this._kill(t + 0.2, [o], [g, pan]);
    }
  }

  /* ====================================================================
   * Mood LAYER — extra parts scheduled into whatever bed is playing
   * ==================================================================*/
  /**
   * Scheduled from `_tick` for the live bed only (never for a retiring one),
   * so the tension parts crossfade away with the theme they were added to.
   * All of it is tempo-relative: the layer locks to the bed's grid whatever
   * the bed's bpm or step resolution is.
   */
  _moodLayer(bed, i, t) {
    const m = MOODS[this.mood] || MOODS.explore;
    if (!m.layer) return;
    const spb = bed.stepsPerBeat;
    const spbar = bed.stepsPerBar;
    const s = i % spbar;
    const bar = Math.floor(i / spbar);

    /* Tension sub on beats 1 and 3 — felt more than heard. */
    if (s % (spb * 2) === 0) {
      const o = this._osc('sine', 46, t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._set(o.frequency, 52, t);
      this._ramp(o.frequency, 33, t + 0.4);
      this._env(g.gain, t, m.layer >= 2 ? 0.34 : 0.22, 0.06, 0.55, 0, 0.1);
      o.start(t);
      this._kill(t + 0.9, [o], [g]);
    }

    /* A dry, close 16th-ish tick that raises the apparent pulse rate. */
    if (s % spb === spb - 1) {
      const n = this._noise(this._jit(0.15), false);
      const bp = this._filter('bandpass', 3400 * this._jit(0.1), 3);
      const g = this._gain(0);
      n.connect(bp); bp.connect(g); g.connect(bed.out);
      this._env(g.gain, t, 0.045, 0.001, 0.028, 0);
      n.start(t, this._rand() * 1.7);
      this._kill(t + 0.06, [n], [bp, g]);
    }

    if (m.layer < 2) return;

    /* BOSS: a war drum on every beat. */
    if (s % spb === 0) {
      const accent = s === 0 ? 1 : 0.6;
      const o = this._osc('sine', 96, t);
      const g = this._gain(0);
      o.connect(g); g.connect(bed.out);
      this._ramp(o.frequency, 54, t + 0.11);
      this._env(g.gain, t, 0.42 * accent, 0.003, 0.3, 0);
      const n = this._noise(0.75, true);
      const lp = this._filter('lowpass', 1000, 1.1);
      const ng = this._gain(0);
      n.connect(lp); lp.connect(ng); ng.connect(bed.out);
      this._env(ng.gain, t, 0.16 * accent, 0.002, 0.18, 0);
      this._sendTo(bed.rev, g, 0.3);
      o.start(t); n.start(t, this._rand() * 1.5);
      this._kill(t + 0.45, [o, n], [g, lp, ng]);
    }

    /* BOSS: a rising horn cluster every four bars — the "it is coming" cue. */
    if (s === 0 && bar % 4 === 3) {
      const dur = bed.stepDur * spbar;
      const lp = this._filter('lowpass', 500, 4);
      const g = this._gain(0);
      lp.connect(g); g.connect(bed.out);
      const srcs = [];
      const nodes = [lp, g];
      const notes = [38, 45, 49];
      for (let k = 0; k < notes.length; k++) {
        const o = this._osc('sawtooth', mtof(notes[k]), t);
        o.detune.value = (k - 1) * 9;
        const og = this._gain(0.2);
        o.connect(og); og.connect(lp);
        /* The cluster BENDS up a semitone across the bar — pure dread. */
        this._set(o.frequency, mtof(notes[k]), t);
        this._ramp(o.frequency, mtof(notes[k] + 1), t + dur);
        nodes.push(og);
        srcs.push(o);
        o.start(t);
      }
      this._set(lp.frequency, 380, t);
      this._ramp(lp.frequency, 2100, t + dur);
      this._env(g.gain, t, 0.24, dur * 0.6, dur * 0.35, 0);
      this._sendTo(bed.rev, g, 0.5);
      this._kill(t + dur + 0.3, srcs, nodes);
    }
  }

  /* ====================================================================
   * Spatialisation
   * ==================================================================*/
  /**
   * @param {{pos?:object, listener?:object, ref?:number, max?:number}} opts
   * @returns {{gain:number, pan:number, dist:number}} SHARED module scratch —
   *   read the fields immediately; the next call overwrites them. This is
   *   deliberate: spatial sfx are evaluated every frame and must not allocate.
   */
  _spatial(opts) {
    const out = _spatialOut;
    out.gain = 1; out.pan = 0; out.dist = 0;
    if (!opts) return out;
    const p = opts.pos;
    const l = opts.listener;
    if (!p || !l) return out;

    const lp = l.position || l.pos || l;
    const lx = fin(lp.x, 0), ly = fin(lp.y, 0), lz = fin(lp.z, 0);
    const dx = fin(p.x, 0) - lx, dy = fin(p.y, 0) - ly, dz = fin(p.z, 0) - lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out.dist = d;

    const ref = fin(opts.ref, 7);
    const max = fin(opts.max, 46);
    if (d >= max) { out.gain = 0; return out; }
    const k = d / ref;
    let g = 1 / (1 + k * k);
    g *= 1 - clamp((d - max * 0.62) / (max * 0.38), 0, 1);   // smooth cull to silence
    out.gain = clamp(g, 0, 1);

    /* Right vector: THREE camera matrixWorld, explicit .right, or a yaw. */
    let rx = 1, ry = 0, rz = 0;
    if (l.matrixWorld && l.matrixWorld.elements) {
      const e = l.matrixWorld.elements;
      rx = fin(e[0], 1); ry = fin(e[1], 0); rz = fin(e[2], 0);
    } else if (l.right) {
      rx = fin(l.right.x, 1); ry = fin(l.right.y, 0); rz = fin(l.right.z, 0);
    } else if (typeof l.yaw === 'number') {
      rx = Math.cos(l.yaw); ry = 0; rz = -Math.sin(l.yaw);
    }
    const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    if (d > 0.001) {
      const dot = (dx * rx + dy * ry + dz * rz) / (d * rl);
      /* Sources very close to the head stay centred (no ping-pong pan). */
      out.pan = clamp(dot, -1, 1) * clamp(d / 3.5, 0, 1) * 0.85;
    }
    return out;
  }

  /* ====================================================================
   * SFX — CONTRACT §5 name list, every one synthesised
   * ==================================================================*/
  /**
   * Play a synthesised sound.
   * @param {string} name any §5 name (aliases in ALIAS)
   * @param {object} [opts] {gain, rate, pos, listener, surface, impact, power,
   *                         ref, max, delay, dur, key}
   * @returns {object|undefined} a loop handle for the looping names
   */
  sfx(name, opts) {
    if (!this.ctx || !this.ready || !this.available) return undefined;
    if (this.ctx.state !== 'running') {
      /* Suspended (page mute or pre-gesture). Never queue a backlog. */
      if (!this._pageMuted) this._resume();
      if (this.ctx.state !== 'running') return undefined;
    }
    const n = ALIAS[name] || name;
    if (typeof n !== 'string') return undefined;
    const o = opts || _emptyOpts;

    if (LOOP_SFX[n]) return this.loop(n, o);

    if (!CRITICAL[n] && this._sfxLive > MAX_VOICES) return undefined;

    /* Anti-machinegun: identical non-critical sounds get a small floor. */
    const now = this.ctx.currentTime;
    if (!CRITICAL[n]) {
      const last = this._lastPlay[n] || 0;
      if (now - last < 0.018) return undefined;
      this._lastPlay[n] = now;
    }

    const t = now + Math.max(0, fin(o.delay, 0)) + 0.002;
    const sp = this._spatial(o);
    if (sp.gain <= 0.0008) return undefined;
    const amp = clamp(fin(o.gain, 1), 0, 4) * sp.gain;
    if (amp <= 0.0008) return undefined;

    /* Every voice lands on this node: pan (if available) -> air LP -> sfxBus. */
    let dest = this.sfxBus;
    let panNode = null;
    if (sp.pan !== 0 && this.ctx.createStereoPanner) {
      panNode = this.ctx.createStereoPanner();
      panNode.pan.value = clamp(sp.pan, -1, 1);
      panNode.connect(this.sfxBus);
      dest = panNode;
    }
    let airNode = null;
    if (sp.dist > 12) {
      airNode = this._filter('lowpass', clamp(15000 - (sp.dist - 12) * 320, 900, 15000), 0.7);
      airNode.connect(dest);
      dest = airNode;
    }

    this._inSfx = true;
    try {
      this._render(n, t, amp, o, dest, sp);
    } catch (e) { /* one broken sound never breaks the frame */ }
    finally { this._inSfx = false; }

    if (panNode || airNode) {
      /* Reclaim the shell nodes after the longest plausible tail. */
      setTimeout(() => {
        try { if (airNode) airNode.disconnect(); } catch (e) {}
        try { if (panNode) panNode.disconnect(); } catch (e) {}
      }, 4600);
    }
    return undefined;
  }

  _render(n, t, amp, o, dest, sp) {
    switch (n) {
      /* --- jump family: the SAME instrument three times, a fourth apart --- */
      case 'jump1': return this._sJump(t, amp, o, dest, 0);
      case 'jump2': return this._sJump(t, amp, o, dest, 1);
      case 'jump3': return this._sJump(t, amp, o, dest, 2);
      case 'longjump': return this._sLongJump(t, amp, o, dest);
      case 'backflip': return this._sFlip(t, amp, o, dest, false);
      case 'sideflip': return this._sFlip(t, amp, o, dest, true);
      case 'wallkick': return this._sWallKick(t, amp, o, dest);
      case 'dive': return this._sDive(t, amp, o, dest);
      case 'slide': return this._sSlide(t, amp, o, dest);
      case 'pound_hang': return this._sPoundHang(t, amp, o, dest);
      case 'pound_land': return this._sPoundLand(t, amp, o, dest);
      /* --- landings + footfalls ------------------------------------------ */
      case 'land_soft': return this._sLand(t, amp, o, dest, false);
      case 'land_hard': return this._sLand(t, amp, o, dest, true);
      case 'step_grass': return this._sStep(t, amp, o, dest, 'grass');
      case 'step_stone': return this._sStep(t, amp, o, dest, 'stone');
      case 'step_metal': return this._sStep(t, amp, o, dest, 'metal');
      case 'step_snow': return this._sStep(t, amp, o, dest, 'snow');
      case 'step_sand': return this._sStep(t, amp, o, dest, 'sand');
      case 'step_wood': return this._sStep(t, amp, o, dest, 'wood');
      case 'step_ice': return this._sStep(t, amp, o, dest, 'ice');
      case 'step_grate': return this._sStep(t, amp, o, dest, 'grate');
      /* --- water ---------------------------------------------------------- */
      case 'splash': return this._sSplash(t, amp, o, dest);
      case 'swim_stroke': return this._sSwimStroke(t, amp, o, dest);
      case 'surface': return this._sSurface(t, amp, o, dest);
      /* --- collectible arpeggio family ------------------------------------ */
      case 'coin': return this._sCoin(t, amp, o, dest);
      case 'sigil': return this._sSigil(t, amp, o, dest);
      case 'crest': return this._sCrest(t, amp, o, dest);
      case 'checkpoint': return this._sCheckpoint(t, amp, o, dest);
      /* --- hazards -------------------------------------------------------- */
      case 'death': return this._sDeath(t, amp, o, dest);
      case 'lava_bubble': return this._sLavaBubble(t, amp, o, dest);
      case 'crusher_slam': return this._sCrusher(t, amp, o, dest);
      case 'bounce': return this._sBounce(t, amp, o, dest);
      case 'vanish_warn': return this._sVanishWarn(t, amp, o, dest);
      case 'cannon_fire': return this._sCannon(t, amp, o, dest);
      case 'ring_pass': return this._sRingPass(t, amp, o, dest);
      /* --- critters ------------------------------------------------------- */
      case 'gnasher_bite': return this._sGnasherBite(t, amp, o, dest);
      case 'bumbler_squish': return this._sSquish(t, amp, o, dest);
      case 'skitter': return this._sSkitter(t, amp, o, dest);
      case 'warden_hit': return this._sWardenHit(t, amp, o, dest);
      case 'warden_roar': return this._sWardenRoar(t, amp, o, dest);
      /* --- world / UI ----------------------------------------------------- */
      case 'gate_open': return this._sGateOpen(t, amp, o, dest);
      case 'painting_enter': return this._sPaintingEnter(t, amp, o, dest);
      case 'ui_move': return this._sUi(t, amp, dest, 620, 760, 0.035, 'triangle', 0.35);
      case 'ui_ok': return this._sUi(t, amp, dest, 660, 990, 0.13, 'sine', 0.8);
      case 'ui_back': return this._sUi(t, amp, dest, 620, 415, 0.14, 'triangle', 0.7);
      default: return undefined;
    }
  }

  /* ==================================================================
   * Individual sounds
   * ================================================================*/

  /**
   * Shared air-whoosh: band-passed noise swept f0 -> fp -> f1 with a matching
   * amplitude arc. Every aerial move (long jump, dive, flips, pound hang,
   * cannon) is built on this, so they read as one family of movements.
   * @returns {{srcs:Array, nodes:Array, end:number}} for the caller to _kill
   */
  _whoosh(t, dest, o) {
    const dur = clamp(fin(o.dur, 0.34), 0.06, 3);
    const f0 = fin(o.f0, 420), fp = fin(o.fp, 1900), f1 = fin(o.f1, 500);
    const q = fin(o.q, 1.3);
    const n = this._noise(fin(o.rate, 1), o.pink !== false);
    const bp = this._filter('bandpass', f0, q);
    const hp = this._filter('highpass', fin(o.hp, 200), 0.6);
    const g = this._gain(0);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(dest);
    this._set(bp.frequency, f0, t);
    this._ramp(bp.frequency, fp, t + dur * 0.42);
    this._ramp(bp.frequency, f1, t + dur);
    this._env(g.gain, t, fin(o.peak, 0.2), dur * 0.22, dur * 0.72, 0);
    if (o.rev > 0) this._send(g, o.rev);
    n.start(t, this._rand() * 1.6);
    return { srcs: [n], nodes: [bp, hp, g], end: t + dur + 0.08 };
  }

  /**
   * jump1 / jump2 / jump3 — CONTRACT §5 "rising pitch family".
   * One voice, three transpositions (unison / fourth / flat-seventh) with
   * progressively more effort behind them: the triple gets a longer body, a
   * fifth on top and a real somersault whoosh, so the player HEARS the chain.
   * @param {number} idx 0|1|2
   */
  _sJump(t, amp, o, dest, idx) {
    const step = [1, 1.335, 1.78][idx] || 1;
    const rate = clamp(fin(o.rate, 1), 0.5, 2) * step;
    const dur = [0.11, 0.135, 0.19][idx] || 0.11;

    const o1 = this._osc('triangle', 205 * rate, t);
    const g = this._gain(0);
    o1.connect(g); g.connect(dest);
    this._set(o1.frequency, 200 * rate, t);
    this._ramp(o1.frequency, 450 * rate, t + 0.085 + idx * 0.02);
    this._env(g.gain, t, (0.28 + idx * 0.035) * amp, 0.003, dur, 0);

    const srcs = [o1];
    const nodes = [g];

    if (idx >= 1) {
      const o2 = this._osc('sine', 305 * rate, t + 0.012);
      const g2 = this._gain(0);
      o2.connect(g2); g2.connect(dest);
      this._ramp(o2.frequency, 690 * rate, t + 0.1);
      this._env(g2.gain, t + 0.012, 0.10 * amp, 0.003, dur * 0.9, 0);
      o2.start(t + 0.012);
      srcs.push(o2); nodes.push(g2);
    }

    const w = this._whoosh(t, dest, {
      dur: 0.09 + idx * 0.05, f0: 700, fp: 2600 + idx * 700, f1: 900,
      q: 1.1, peak: (0.05 + idx * 0.022) * amp, rev: idx === 2 ? 0.18 : 0,
    });

    if (idx === 2) {
      /* Somersault: a doppler-ish body rotation under the whoosh. */
      const sp = this._osc('sine', 150, t + 0.04);
      const sg = this._gain(0);
      sp.connect(sg); sg.connect(dest);
      this._set(sp.frequency, 150, t + 0.04);
      this._ramp(sp.frequency, 330, t + 0.16);
      this._ramp(sp.frequency, 190, t + 0.30);
      this._env(sg.gain, t + 0.04, 0.07 * amp, 0.02, 0.24, 0);
      sp.start(t + 0.04);
      srcs.push(sp); nodes.push(sg);
    }

    o1.start(t);
    this._kill(Math.max(t + dur + 0.12, w.end), srcs.concat(w.srcs), nodes.concat(w.nodes));
  }

  /** Long jump — a low, long committed whoosh with a shove behind it. */
  _sLongJump(t, amp, o, dest) {
    const w = this._whoosh(t, dest, {
      dur: 0.55, f0: 260, fp: 1500, f1: 320, q: 0.9, peak: 0.26 * amp, rev: 0.2, rate: 0.85,
    });
    const b = this._osc('triangle', 260, t);
    const lp = this._filter('lowpass', 1200, 3);
    const bg = this._gain(0);
    b.connect(lp); lp.connect(bg); bg.connect(dest);
    this._set(b.frequency, 285, t);
    this._ramp(b.frequency, 118, t + 0.26);
    this._env(bg.gain, t, 0.24 * amp, 0.006, 0.3, 0);
    const n = this._noise(1.2, false);
    const bp = this._filter('bandpass', 1500, 2);
    const ng = this._gain(0);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.12 * amp, 0.001, 0.09, 0);
    b.start(t); n.start(t, this._rand() * 1.5);
    this._kill(Math.max(t + 0.7, w.end), [b, n].concat(w.srcs), [lp, bg, bp, ng].concat(w.nodes));
  }

  /** Backflip / sideflip — a rising voiced effort plus a spin whoosh. */
  _sFlip(t, amp, o, dest, side) {
    const f0 = side ? 300 : 250;
    const o1 = this._osc('triangle', f0, t);
    const o2 = this._osc('sine', f0 * 1.5, t);
    const lp = this._filter('lowpass', 2400, 2.5);
    const g = this._gain(0);
    const g2 = this._gain(0.3);
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(dest);
    this._set(o1.frequency, f0, t);
    this._ramp(o1.frequency, f0 * 2.6, t + 0.14);
    this._set(o2.frequency, f0 * 1.5, t);
    this._ramp(o2.frequency, f0 * 3.6, t + 0.14);
    /* A moving formant is what turns a blip into a voiced "hup". */
    this._set(lp.frequency, 900, t);
    this._ramp(lp.frequency, 3000, t + 0.1);
    this._ramp(lp.frequency, 1200, t + 0.24);
    this._env(g.gain, t, 0.22 * amp, 0.006, 0.2, 0);
    const w = this._whoosh(t + 0.02, dest, {
      dur: side ? 0.3 : 0.42, f0: side ? 900 : 500, fp: side ? 3200 : 2200,
      f1: side ? 1100 : 620, q: side ? 1.8 : 1.1, peak: 0.14 * amp, rev: 0.16,
    });
    o1.start(t); o2.start(t);
    this._kill(Math.max(t + 0.35, w.end), [o1, o2].concat(w.srcs), [lp, g, g2].concat(w.nodes));
  }

  /** Wall kick — a bright spark-tick triplet plus the kick-off thump. */
  _sWallKick(t, amp, o, dest) {
    const srcs = [];
    const nodes = [];
    /* Three ticks 9 ms apart, rising: boot scuffing up the stone. */
    for (let k = 0; k < 3; k++) {
      const at = t + k * 0.009;
      const n = this._noise(this._jit(0.2), false);
      const bp = this._filter('bandpass', (4200 + k * 1500) * this._jit(0.06), 9);
      const g = this._gain(0);
      n.connect(bp); bp.connect(g); g.connect(dest);
      this._env(g.gain, at, (0.14 - k * 0.03) * amp, 0.0008, 0.022, 0);
      n.start(at, this._rand() * 1.7);
      srcs.push(n); nodes.push(bp, g);
    }
    const b = this._osc('sine', 210, t);
    const bg = this._gain(0);
    b.connect(bg); bg.connect(dest);
    this._ramp(b.frequency, 92, t + 0.09);
    this._env(bg.gain, t, 0.30 * amp, 0.002, 0.13, 0);
    const w = this._whoosh(t + 0.01, dest, {
      dur: 0.2, f0: 800, fp: 3000, f1: 1000, q: 1.4, peak: 0.09 * amp,
    });
    this._send(bg, 0.2);
    b.start(t);
    srcs.push(b); nodes.push(bg);
    this._kill(Math.max(t + 0.3, w.end), srcs.concat(w.srcs), nodes.concat(w.nodes));
  }

  /** Dive — the longest, lowest whoosh, with a committed exhale. */
  _sDive(t, amp, o, dest) {
    const w = this._whoosh(t, dest, {
      dur: 0.62, f0: 320, fp: 2400, f1: 380, q: 1.0, peak: 0.24 * amp, rev: 0.22, rate: 0.9,
    });
    const b = this._osc('sawtooth', 190, t);
    const lp = this._filter('lowpass', 900, 4);
    const g = this._gain(0);
    b.connect(lp); lp.connect(g); g.connect(dest);
    this._ramp(b.frequency, 84, t + 0.3);
    this._set(lp.frequency, 1500, t);
    this._ramp(lp.frequency, 400, t + 0.3);
    this._env(g.gain, t, 0.17 * amp, 0.008, 0.32, 0);
    b.start(t);
    this._kill(Math.max(t + 0.5, w.end), [b].concat(w.srcs), [lp, g].concat(w.nodes));
  }

  /** Belly slide — moving grit under the hero, tinted by the surface. */
  _sSlide(t, amp, o, dest) {
    const surf = typeof o.surface === 'string' ? o.surface : 'stone';
    const dur = clamp(fin(o.dur, 0.42), 0.1, 2.5);
    const bright = surf === 'ice' ? 3.2 : (surf === 'snow' ? 0.6 : (surf === 'sand' ? 0.7 : 1));
    const n = this._noise(this._jit(0.1), surf === 'snow' || surf === 'sand');
    const bp = this._filter('bandpass', 1400 * bright, surf === 'ice' ? 3.5 : 1.2);
    const hp = this._filter('highpass', 260, 0.6);
    const g = this._gain(0);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(dest);
    this._set(bp.frequency, 2200 * bright, t);
    this._ramp(bp.frequency, 700 * bright, t + dur);
    this._env(g.gain, t, 0.16 * amp * (surf === 'snow' ? 0.7 : 1), 0.02, dur * 0.8, 0, dur * 0.2);
    const nodes = [bp, hp, g];
    const srcs = [n];
    if (surf === 'ice') {
      /* Ice sings: a thin resonance that glides down with the slide. */
      const o1 = this._osc('sine', 2400, t);
      const og = this._gain(0);
      o1.connect(og); og.connect(dest);
      this._ramp(o1.frequency, 1500, t + dur);
      this._env(og.gain, t, 0.045 * amp, 0.03, dur * 0.85, 0);
      o1.start(t);
      srcs.push(o1); nodes.push(og);
    }
    this._send(g, 0.14);
    n.start(t, this._rand() * 1.6);
    this._kill(t + dur + 0.15, srcs, nodes);
  }

  /** Ground-pound hang — 0.2 s of suspended, rising tension. */
  _sPoundHang(t, amp, o, dest) {
    const dur = clamp(fin(o.dur, 0.2), 0.06, 0.6);
    const o1 = this._osc('sine', 420, t);
    const o2 = this._osc('sine', 631, t);
    const g = this._gain(0);
    const g2 = this._gain(0.4);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
    this._set(o1.frequency, 420, t);
    this._ramp(o1.frequency, 940, t + dur);
    this._set(o2.frequency, 631, t);
    this._ramp(o2.frequency, 1420, t + dur);
    this._env(g.gain, t, 0.12 * amp, 0.012, dur * 0.5, 0, dur * 0.5);
    const w = this._whoosh(t, dest, {
      dur: dur, f0: 1200, fp: 3400, f1: 2600, q: 2.2, peak: 0.07 * amp,
    });
    this._send(g, 0.35);
    o1.start(t); o2.start(t);
    this._kill(Math.max(t + dur + 0.15, w.end), [o1, o2].concat(w.srcs), [g, g2].concat(w.nodes));
  }

  /** Ground-pound land — the heaviest impact in the game. */
  _sPoundLand(t, amp, o, dest) {
    const surf = typeof o.surface === 'string' ? o.surface : 'stone';
    const a = amp * clamp(fin(o.power, 1), 0.4, 1.6);

    const sub = this._osc('sine', 150, t);
    const sg = this._gain(0);
    sub.connect(sg); sg.connect(dest);
    this._set(sub.frequency, 150, t);
    this._ramp(sub.frequency, 32, t + 0.22);
    this._env(sg.gain, t, 0.85 * a, 0.002, 0.4, 0);

    const n = this._noise(0.8, false);
    const lp = this._filter('lowpass', 1400, 1.1);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._set(lp.frequency, 2000, t);
    this._ramp(lp.frequency, 160, t + 0.26);
    this._env(ng.gain, t, 0.44 * a, 0.001, 0.28, 0);

    /* The shockwave leaves the impact 40 ms later and sweeps UP and out. */
    const w = this._whoosh(t + 0.04, dest, {
      dur: 0.45, f0: 240, fp: 1600, f1: 5200, q: 0.9, peak: 0.16 * a, rev: 0.3,
    });

    const ring = SURFACE_RING[surf] || SURFACE_RING.stone;
    const rn = this._noise(this._jit(0.1), false);
    const rout = this._gain(0);
    rout.connect(dest);
    const nodes = [sg, lp, ng, rout];
    for (let k = 0; k < ring.length; k++) {
      const bp = this._filter('bandpass', ring[k] * 0.9 * this._jit(0.03), (SURFACE_Q[surf] || 5) * 1.4);
      const bg = this._gain(0.8 / (1 + k * 0.8));
      rn.connect(bp); bp.connect(bg); bg.connect(rout);
      nodes.push(bp, bg);
    }
    this._env(rout.gain, t, 0.30 * a * (SURFACE_BITE[surf] || 0.7), 0.002, (SURFACE_DUR[surf] || 0.2) * 2.4, 0);
    this._send(rout, 0.35);
    this._send(ng, 0.25);
    sub.start(t); n.start(t, this._rand() * 1.4); rn.start(t, this._rand() * 1.4);
    this._kill(Math.max(t + 0.95, w.end), [sub, n, rn].concat(w.srcs), nodes.concat(w.nodes));
  }

  /**
   * Landing. `impact` is the vertical speed at touchdown (m/s) so a 3 m/s
   * step-down and a 24 m/s plummet are the same instrument played with very
   * different force; `surface` picks the ring bank.
   */
  _sLand(t, amp, o, dest, hard) {
    const surf = typeof o.surface === 'string' ? o.surface : 'stone';
    const impact = clamp(fin(o.impact, hard ? 22 : 7) / 22, 0.12, 1.35);
    const a = amp * (hard ? 1 : 0.62) * impact;

    const body = this._osc('sine', hard ? 195 : 152, t);
    const bg = this._gain(0);
    body.connect(bg); bg.connect(dest);
    this._ramp(body.frequency, hard ? 48 : 72, t + (hard ? 0.15 : 0.085));
    this._env(bg.gain, t, 0.55 * a, 0.002, hard ? 0.24 : 0.12, 0);

    const n = this._noise(this._jit(0.1), surf === 'snow' || surf === 'sand' || surf === 'grass');
    const lp = this._filter('lowpass', hard ? 1500 : 900, 1.0);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._set(lp.frequency, hard ? 1900 : 1100, t);
    this._ramp(lp.frequency, 280, t + (hard ? 0.2 : 0.1));
    this._env(ng.gain, t, 0.24 * a, 0.001, hard ? 0.2 : 0.09, 0);

    const nodes = [bg, lp, ng];
    const srcs = [body, n];

    /* Surface colour: a short ring bank keyed to the material. */
    const ring = SURFACE_RING[surf] || SURFACE_RING.stone;
    const rq = SURFACE_Q[surf] || 5;
    const rdur = SURFACE_DUR[surf] || 0.14;
    const bite = SURFACE_BITE[surf] === undefined ? 0.8 : SURFACE_BITE[surf];
    const rn = this._noise(this._jit(0.12), false);
    const rout = this._gain(0);
    rout.connect(dest);
    for (let k = 0; k < ring.length; k++) {
      const bp = this._filter('bandpass', ring[k] * this._jit(0.03), rq);
      const bg2 = this._gain(0.8 / (1 + k * 0.8));
      rn.connect(bp); bp.connect(bg2); bg2.connect(rout);
      nodes.push(bp, bg2);
    }
    nodes.push(rout);
    this._env(rout.gain, t, (hard ? 0.30 : 0.13) * a * bite, 0.0015, rdur, 0);
    srcs.push(rn);

    if (surf === 'rubber') {
      const b = this._osc('sine', 140, t);
      const bgg = this._gain(0);
      b.connect(bgg); bgg.connect(dest);
      this._ramp(b.frequency, 250, t + 0.05);
      this._ramp(b.frequency, 170, t + 0.14);
      this._env(bgg.gain, t, 0.20 * a, 0.004, 0.16, 0);
      b.start(t);
      srcs.push(b); nodes.push(bgg);
    }
    if (surf === 'snow') {
      /* Snow squeaks: a high, short, slightly pitched crunch. */
      const sq = this._noise(this._jit(0.25), false);
      const shp = this._filter('bandpass', 3600 * this._jit(0.12), 6);
      const sgn = this._gain(0);
      sq.connect(shp); shp.connect(sgn); sgn.connect(dest);
      this._env(sgn.gain, t + 0.012, 0.10 * a, 0.002, 0.07, 0);
      sq.start(t + 0.012, this._rand() * 1.6);
      srcs.push(sq); nodes.push(shp, sgn);
    }

    this._send(rout, hard ? 0.24 : 0.12);
    body.start(t);
    n.start(t, this._rand() * 1.5);
    rn.start(t, this._rand() * 1.5);
    this._kill(t + Math.max(0.45, rdur + 0.25), srcs, nodes);
  }

  /**
   * Footstep. Pitch, filter and buffer offset all jitter on every call, so a
   * run cycle never sounds like a looped sample.
   */
  _sStep(t, amp, o, dest, surf) {
    const j = this._jit(0.17);
    const a = amp * (0.9 + this._rand() * 0.22);
    const pink = surf === 'stone' || surf === 'snow' || surf === 'sand' || surf === 'grass';
    const n = this._noise(clamp(1 * j, 0.5, 2), pink);
    const g = this._gain(0);
    let f1, f2 = null, dur, peak;

    switch (surf) {
      case 'metal':
        f1 = this._filter('bandpass', 2400 * j, 6);
        f2 = this._filter('peaking', 3350 * j, 4); f2.gain.value = 9;
        dur = 0.062; peak = 0.15;
        break;
      case 'ice':
        f1 = this._filter('highpass', 4200 * j, 0.9);
        f2 = this._filter('bandpass', 6200 * j, 8);
        dur = 0.044; peak = 0.11;
        break;
      case 'grate':
        f1 = this._filter('bandpass', 1700 * j, 3.2);
        f2 = this._filter('peaking', 900 * j, 2); f2.gain.value = 6;
        dur = 0.055; peak = 0.13;
        break;
      case 'wood':
        /* A plank has a real pitched knock plus a hollow body. */
        f1 = this._filter('bandpass', 720 * j, 3.4);
        f2 = this._filter('peaking', 1650 * j, 2.4); f2.gain.value = 7;
        dur = 0.07; peak = 0.135;
        break;
      case 'grass':
        f1 = this._filter('bandpass', 1450 * j, 1.1);
        f2 = this._filter('highpass', 700, 0.6);
        dur = 0.052; peak = 0.10;
        break;
      case 'snow':
        f1 = this._filter('bandpass', 2500 * j, 2.6);
        f2 = this._filter('highpass', 1400, 0.7);
        dur = 0.075; peak = 0.095;
        break;
      case 'sand':
        f1 = this._filter('lowpass', 2600 * j, 0.9);
        f2 = this._filter('highpass', 500, 0.6);
        dur = 0.085; peak = 0.09;
        break;
      case 'rubber':
        f1 = this._filter('lowpass', 900 * j, 1.4);
        dur = 0.05; peak = 0.115;
        break;
      default:
        f1 = this._filter('bandpass', 1120 * j, 1.3);
        dur = 0.048; peak = 0.115;
        break;
    }

    n.connect(f1);
    if (f2) { f1.connect(f2); f2.connect(g); } else { f1.connect(g); }
    g.connect(dest);
    const pk = peak * a;
    /* Soft ground swallows the transient; hard ground snaps. */
    const atk = (surf === 'snow' || surf === 'sand' || surf === 'grass') ? 0.006 : 0.0012;
    this._env(g.gain, t, pk, atk, dur, 0);

    const srcs = [n];
    const nodes = f2 ? [f1, f2, g] : [f1, g];

    if (surf === 'grate') {
      /* A second, slightly later rattle makes the metal grating read. */
      const n2 = this._noise(clamp(1.4 * this._jit(0.2), 0.5, 2.5), false);
      const bp = this._filter('bandpass', 2600 * this._jit(0.15), 5);
      const g2 = this._gain(0);
      n2.connect(bp); bp.connect(g2); g2.connect(dest);
      this._env(g2.gain, t + 0.021, pk * 0.55, 0.001, 0.038, 0);
      n2.start(t + 0.021, this._rand() * 1.6);
      srcs.push(n2); nodes.push(bp, g2);
    }
    if (surf === 'ice') {
      const tick = this._osc('sine', 5200 * j, t);
      const tg = this._gain(0);
      tick.connect(tg); tg.connect(dest);
      this._env(tg.gain, t, pk * 0.4, 0.001, 0.02, 0);
      tick.start(t);
      srcs.push(tick); nodes.push(tg);
    }
    if (surf === 'wood' || surf === 'stone') {
      /* Body thump: the weight of the hero, not just the shoe. */
      const b = this._osc('sine', (surf === 'wood' ? 130 : 165) * this._jit(0.06), t);
      const bg = this._gain(0);
      b.connect(bg); bg.connect(dest);
      this._ramp(b.frequency, surf === 'wood' ? 78 : 96, t + 0.045);
      this._env(bg.gain, t, pk * 0.5, 0.001, 0.05, 0);
      b.start(t);
      srcs.push(b); nodes.push(bg);
    }

    n.start(t, this._rand() * 1.8);
    this._kill(t + 0.2, srcs, nodes);
  }

  /* ------------------------------------------------------------ water --- */

  /** Entering water: the crown of noise plus the cavity thump underneath. */
  _sSplash(t, amp, o, dest) {
    const a = amp * clamp(fin(o.impact, 10) / 12, 0.35, 1.5);
    /* Crown: broadband, opening then closing fast. */
    const n = this._noise(1.1, false);
    const bp = this._filter('bandpass', 1400, 0.9);
    const hp = this._filter('highpass', 420, 0.6);
    const g = this._gain(0);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(dest);
    this._set(bp.frequency, 900, t);
    this._ramp(bp.frequency, 4200, t + 0.06);
    this._ramp(bp.frequency, 700, t + 0.42);
    this._env(g.gain, t, 0.34 * a, 0.004, 0.4, 0);
    /* Cavity: the low "gloop" of the hole the body punched. */
    const b = this._osc('sine', 320, t + 0.012);
    const bg = this._gain(0);
    b.connect(bg); bg.connect(dest);
    this._set(b.frequency, 320, t + 0.012);
    this._ramp(b.frequency, 96, t + 0.14);
    this._env(bg.gain, t + 0.012, 0.26 * a, 0.004, 0.2, 0);
    /* Droplets falling back: three short up-glides. */
    const srcs = [n, b];
    const nodes = [bp, hp, g, bg];
    for (let k = 0; k < 3; k++) {
      const at = t + 0.14 + k * 0.075 + this._rand() * 0.05;
      const f0 = 700 + this._rand() * 900;
      const d = this._osc('sine', f0, at);
      const dg = this._gain(0);
      d.connect(dg); dg.connect(dest);
      this._set(d.frequency, f0 * 0.6, at);
      this._ramp(d.frequency, f0 * 1.6, at + 0.05);
      this._env(dg.gain, at, 0.05 * a, 0.001, 0.08, 0);
      d.start(at);
      srcs.push(d); nodes.push(dg);
    }
    this._send(g, 0.28);
    n.start(t, this._rand() * 1.5); b.start(t + 0.012);
    this._kill(t + 0.75, srcs, nodes);
  }

  /** One swim stroke: a soft pull of water past the body. */
  _sSwimStroke(t, amp, o, dest) {
    const w = this._whoosh(t, dest, {
      dur: 0.38, f0: 300, fp: 1100, f1: 260, q: 1.0, peak: 0.16 * amp, rev: 0.12, rate: 0.6,
    });
    /* Gurgle: a wobbling low sine — the bubbles trailing the hand. */
    const b = this._osc('sine', 180, t + 0.03);
    const bg = this._gain(0);
    b.connect(bg); bg.connect(dest);
    this._set(b.frequency, 150, t + 0.03);
    this._ramp(b.frequency, 260, t + 0.14);
    this._ramp(b.frequency, 170, t + 0.28);
    this._env(bg.gain, t + 0.03, 0.09 * amp, 0.02, 0.24, 0);
    b.start(t + 0.03);
    this._kill(Math.max(t + 0.45, w.end), [b].concat(w.srcs), [bg].concat(w.nodes));
  }

  /** Breaking the surface: muffle lifting, then air and a gasp. */
  _sSurface(t, amp, o, dest) {
    const n = this._noise(1, false);
    const bp = this._filter('bandpass', 500, 1.1);
    const g = this._gain(0);
    n.connect(bp); bp.connect(g); g.connect(dest);
    /* The filter OPENING is the sound of the ears clearing the water. */
    this._set(bp.frequency, 420, t);
    this._ramp(bp.frequency, 4800, t + 0.14);
    this._ramp(bp.frequency, 1600, t + 0.4);
    this._env(g.gain, t, 0.24 * amp, 0.008, 0.36, 0);
    /* Gasp: a short breathy formant pair above it. */
    const br = this._noise(1.3, true);
    const f1 = this._filter('bandpass', 760, 4);
    const f2 = this._filter('bandpass', 1240, 5);
    const bgn = this._gain(0);
    br.connect(f1); f1.connect(f2); f2.connect(bgn); bgn.connect(dest);
    this._env(bgn.gain, t + 0.05, 0.12 * amp, 0.02, 0.18, 0);
    this._send(g, 0.25);
    n.start(t, this._rand() * 1.5); br.start(t + 0.05, this._rand() * 1.5);
    this._kill(t + 0.6, [n, br], [bp, g, f1, f2, bgn]);
  }

  /* ------------------------------------------- collectible arpeggio family */

  /**
   * COIN — the first degree of the collectible arpeggio: two square blips a
   * fifth apart. `sigil` and `crest` are the same idea extended, so the ear
   * hears ONE instrument grow in importance across the three pickups.
   */
  _sCoin(t, amp, o, dest) {
    const f1 = 1046, f2 = 1568;                        // C6 -> G6
    const o1 = this._osc('square', f1, t);
    const g1 = this._gain(0);
    o1.connect(g1); g1.connect(dest);
    this._env(g1.gain, t, 0.13 * amp, 0.001, 0.05, 0);
    const o2 = this._osc('square', f2, t + 0.048);
    const g2 = this._gain(0);
    o2.connect(g2); g2.connect(dest);
    this._env(g2.gain, t + 0.048, 0.13 * amp, 0.001, 0.13, 0);
    const spark = this._noise(1.9, false);
    const hp = this._filter('highpass', 7000, 0.9);
    const sg = this._gain(0);
    spark.connect(hp); hp.connect(sg); sg.connect(dest);
    this._env(sg.gain, t, 0.04 * amp, 0.001, 0.09, 0);
    this._send(g2, 0.35);
    o1.start(t); o2.start(t + 0.048); spark.start(t, this._rand() * 1.6);
    this._kill(t + 0.26, [o1, o2, spark], [g1, g2, hp, sg]);
  }

  /**
   * SIGIL — the coin's interval continued upward into a struck FM bell.
   * `o.index` (0..7) transposes it a semitone per sigil, so collecting all
   * eight builds an audible ascending line across the course.
   */
  _sSigil(t, amp, o, dest) {
    const idx = clamp(fin(o.index, 0) | 0, 0, 7);
    const base = 72 + idx;
    const notes = [base, base + 7, base + 12];
    const srcs = [];
    const nodes = [];
    for (let k = 0; k < notes.length; k++) {
      const at = t + k * 0.055;
      const f = mtof(notes[k]);
      const car = this._osc('sine', f, at);
      const mod = this._osc('sine', f * 2.76, at);
      const modG = this._gain(0);
      const g = this._gain(0);
      mod.connect(modG); modG.connect(car.frequency);
      car.connect(g); g.connect(dest);
      this._set(modG.gain, f * 0.9, at);
      this._ramp(modG.gain, f * 0.05, at + 0.28);
      this._ramp(modG.gain, 0, at + 0.7);
      this._env(g.gain, at, (0.16 - k * 0.02) * amp, 0.003, 0.7 + k * 0.2, 0);
      this._send(g, 0.55);
      car.start(at); mod.start(at);
      srcs.push(car, mod); nodes.push(modG, g);
    }
    const sh = this._noise(1.6, false);
    const hp = this._filter('highpass', 8000, 0.9);
    const sg = this._gain(0);
    sh.connect(hp); hp.connect(sg); sg.connect(dest);
    this._env(sg.gain, t, 0.05 * amp, 0.006, 0.3, 0);
    this._send(sg, 0.5);
    sh.start(t, this._rand() * 1.5);
    srcs.push(sh); nodes.push(hp, sg);
    this._kill(t + 1.3, srcs, nodes);
  }

  /**
   * CREST — the family's resolution: a five-note major run over a detuned saw
   * choir with a swell underneath. Ducks the bed so it lands in the clear.
   */
  _sCrest(t, amp, o, dest) {
    const notes = [72, 76, 79, 84, 88];
    const srcs = [];
    const nodes = [];
    for (let k = 0; k < notes.length; k++) {
      const at = t + k * 0.095;
      const f = mtof(notes[k]);
      const lp = this._filter('lowpass', 4200, 3);
      const g = this._gain(0);
      lp.connect(g); g.connect(dest);
      for (let d = 0; d < 3; d++) {
        const os = this._osc(d === 1 ? 'triangle' : 'sawtooth', f, at);
        os.detune.value = (d - 1) * 10;
        const og = this._gain(0.18);
        os.connect(og); og.connect(lp);
        os.start(at);
        srcs.push(os); nodes.push(og);
      }
      this._set(lp.frequency, 5200, at);
      this._ramp(lp.frequency, 1500, at + 0.55);
      const last = k === notes.length - 1;
      this._env(g.gain, at, 0.22 * amp, 0.006, last ? 1.3 : 0.38, 0, last ? 0.25 : 0.03);
      this._send(g, 0.6);
      nodes.push(lp, g);
    }
    const swell = this._osc('sine', mtof(48), t);
    const sg = this._gain(0);
    swell.connect(sg); sg.connect(dest);
    this._env(sg.gain, t, 0.32 * amp, 0.10, 1.4, 0, 0.25);
    swell.start(t);
    srcs.push(swell); nodes.push(sg);
    this._kill(t + 2.4, srcs, nodes);
    this.duck(1400);
  }

  /** Checkpoint — a clean two-note confirmation with a shimmer tail. */
  _sCheckpoint(t, amp, o, dest) {
    const notes = [76, 83];                             // E5, B5
    const srcs = [];
    const nodes = [];
    for (let k = 0; k < notes.length; k++) {
      const at = t + k * 0.085;
      const f = mtof(notes[k]);
      const o1 = this._osc('sine', f, at);
      const o2 = this._osc('triangle', f * 2.005, at);
      const g = this._gain(0);
      const g2 = this._gain(0.28);
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
      this._env(g.gain, at, 0.26 * amp * (k === 0 ? 1 : 0.9), 0.004, 0.42, 0);
      this._send(g, 0.6);
      o1.start(at); o2.start(at);
      srcs.push(o1, o2); nodes.push(g, g2);
    }
    const n = this._noise(1.4, false);
    const hp = this._filter('highpass', 5200, 0.8);
    const ng = this._gain(0);
    n.connect(hp); hp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.05 * amp, 0.01, 0.38, 0);
    this._send(ng, 0.5);
    n.start(t, this._rand() * 1.5);
    srcs.push(n); nodes.push(hp, ng);
    this._kill(t + 0.72, srcs, nodes);
  }

  /* ---------------------------------------------------------- hazards --- */

  /** Death — a collapsing saw/square pair over a dropping sub. */
  _sDeath(t, amp, o, dest) {
    const a = amp;
    const saw = this._osc('sawtooth', 300, t);
    const sq = this._osc('square', 150, t);
    const lp = this._filter('lowpass', 2400, 4);
    const g = this._gain(0);
    const sg = this._gain(0.34);
    saw.connect(lp); sq.connect(sg); sg.connect(lp);
    lp.connect(g); g.connect(dest);
    this._ramp(saw.frequency, 58, t + 0.55);
    this._ramp(sq.frequency, 34, t + 0.55);
    this._set(lp.frequency, 2600, t);
    this._ramp(lp.frequency, 190, t + 0.5);
    this._env(g.gain, t, 0.42 * a, 0.004, 0.52, 0, 0.05);

    const sub = this._osc('sine', 92, t);
    const subg = this._gain(0);
    sub.connect(subg); subg.connect(dest);
    this._ramp(sub.frequency, 28, t + 0.45);
    this._env(subg.gain, t, 0.5 * a, 0.006, 0.5, 0);

    const n = this._noise(1, true);
    const bp = this._filter('bandpass', 1600, 1.1);
    const ng = this._gain(0);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    this._set(bp.frequency, 2200, t);
    this._ramp(bp.frequency, 260, t + 0.5);
    this._env(ng.gain, t, 0.22 * a, 0.004, 0.5, 0);

    this._send(g, 0.4);
    saw.start(t); sq.start(t); sub.start(t); n.start(t, this._rand() * 1.4);
    this._kill(t + 0.75, [saw, sq, sub, n], [lp, g, sg, subg, bp, ng]);
    this.duck(760);
  }

  /** Lava bubble — a rising cavity that pops. */
  _sLavaBubble(t, amp, o, dest) {
    const j = this._jit(0.35);
    const f0 = 58 * j;
    const os = this._osc('sine', f0, t);
    const lp = this._filter('lowpass', 520, 2.2);
    const g = this._gain(0);
    os.connect(lp); lp.connect(g); g.connect(dest);
    this._set(os.frequency, f0, t);
    this._ramp(os.frequency, f0 * 3.1, t + 0.075);
    this._ramp(os.frequency, f0 * 1.35, t + 0.19);
    this._env(g.gain, t, 0.20 * amp, 0.008, 0.2, 0);
    const pop = this._noise(0.7 * j, true);
    const bp = this._filter('bandpass', 380 * j, 2);
    const pg = this._gain(0);
    pop.connect(bp); bp.connect(pg); pg.connect(dest);
    this._env(pg.gain, t + 0.06, 0.09 * amp, 0.002, 0.1, 0);
    this._send(g, 0.25);
    os.start(t); pop.start(t + 0.06, this._rand() * 1.5);
    this._kill(t + 0.34, [os, pop], [lp, g, bp, pg]);
  }

  /** Crusher slam — mass hitting stop, with a long metal ring. */
  _sCrusher(t, amp, o, dest) {
    const a = amp * clamp(fin(o.power, 1), 0.3, 1.6);
    const body = this._osc('sine', 118, t);
    const bg = this._gain(0);
    body.connect(bg); bg.connect(dest);
    this._ramp(body.frequency, 31, t + 0.3);
    this._env(bg.gain, t, 0.78 * a, 0.002, 0.42, 0);

    const n = this._noise(0.85, false);
    const lp = this._filter('lowpass', 950, 1.1);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._set(lp.frequency, 1500, t);
    this._ramp(lp.frequency, 130, t + 0.3);
    this._env(ng.gain, t, 0.42 * a, 0.001, 0.3, 0);

    const rn = this._noise(this._jit(0.1), false);
    const rout = this._gain(0);
    rout.connect(dest);
    const nodes = [bg, lp, ng, rout];
    const ring = SURFACE_RING.metal;
    for (let k = 0; k < ring.length; k++) {
      const bp = this._filter('bandpass', ring[k] * 0.72 * this._jit(0.03), 18);
      const bg2 = this._gain(0.7 / (1 + k));
      rn.connect(bp); bp.connect(bg2); bg2.connect(rout);
      nodes.push(bp, bg2);
    }
    this._env(rout.gain, t, 0.24 * a, 0.002, 0.75, 0);
    this._send(rout, 0.45);
    this._send(ng, 0.3);
    body.start(t); n.start(t, this._rand() * 1.4); rn.start(t, this._rand() * 1.4);
    this._kill(t + 1.0, [body, n, rn], nodes);
  }

  /** Bounce pad — `power` is the pad's target apex in metres. */
  _sBounce(t, amp, o, dest) {
    const p = clamp(fin(o.power, 4) / 8, 0.35, 2.2);
    const os = this._osc('sine', 175, t);
    const lp = this._filter('lowpass', 2400, 2);
    const g = this._gain(0);
    os.connect(lp); lp.connect(g); g.connect(dest);
    this._set(os.frequency, 165, t);
    this._ramp(os.frequency, 520 * Math.sqrt(p), t + 0.085);
    this._ramp(os.frequency, 300 * Math.sqrt(p), t + 0.17);
    this._env(g.gain, t, 0.34 * amp * clamp(p, 0.5, 1.4), 0.003, 0.2, 0);
    const sq = this._osc('triangle', 88, t);
    const sg = this._gain(0);
    sq.connect(sg); sg.connect(dest);
    this._ramp(sq.frequency, 210, t + 0.09);
    this._env(sg.gain, t, 0.18 * amp, 0.002, 0.16, 0);
    const n = this._noise(1.2, false);
    const bp = this._filter('bandpass', 320, 1.6);
    const ng = this._gain(0);
    n.connect(bp); bp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, 0.09 * amp, 0.001, 0.07, 0);
    this._send(g, 0.22);
    os.start(t); sq.start(t); n.start(t, this._rand() * 1.5);
    this._kill(t + 0.34, [os, sq, n], [lp, g, sg, bp, ng]);
  }

  /** Vanishing platform warning — `power` 0..1 is how close it is to going. */
  _sVanishWarn(t, amp, o, dest) {
    const urgency = clamp(fin(o.power, 0.5), 0, 1);
    const f = 760 + urgency * 420;
    const o1 = this._osc('square', f, t);
    const o2 = this._osc('square', f * 1.5, t);
    const lp = this._filter('lowpass', 3600, 1.2);
    const g = this._gain(0);
    const g2 = this._gain(0.3);
    o1.connect(lp); o2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(dest);
    this._env(g.gain, t, (0.075 + urgency * 0.06) * amp, 0.001, 0.048, 0);
    o1.start(t); o2.start(t);
    this._kill(t + 0.12, [o1, o2], [lp, g, g2]);
  }

  /** Cannon fire — a hard boom with the barrel whistle riding out of it. */
  _sCannon(t, amp, o, dest) {
    const a = amp * clamp(fin(o.power, 1), 0.5, 1.5);
    const sub = this._osc('sine', 190, t);
    const sg = this._gain(0);
    sub.connect(sg); sg.connect(dest);
    this._set(sub.frequency, 190, t);
    this._ramp(sub.frequency, 34, t + 0.3);
    this._env(sg.gain, t, 0.85 * a, 0.0015, 0.45, 0);
    const n = this._noise(1, false);
    const lp = this._filter('lowpass', 2600, 0.9);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._set(lp.frequency, 4200, t);
    this._ramp(lp.frequency, 300, t + 0.35);
    this._env(ng.gain, t, 0.5 * a, 0.001, 0.36, 0);
    /* Barrel whistle: a descending resonance that says "and you are IN it". */
    const wh = this._osc('sine', 2600, t + 0.03);
    const wg = this._gain(0);
    wh.connect(wg); wg.connect(dest);
    this._ramp(wh.frequency, 620, t + 0.5);
    this._env(wg.gain, t + 0.03, 0.10 * a, 0.01, 0.45, 0);
    this._send(ng, 0.5);
    sub.start(t); n.start(t, this._rand() * 1.4); wh.start(t + 0.03);
    this._kill(t + 0.95, [sub, n, wh], [sg, lp, ng, wg]);
  }

  /** Ring pass — a doppler ting: up into the ring, down out of it. */
  _sRingPass(t, amp, o, dest) {
    const idx = clamp(fin(o.index, 0) | 0, 0, 15);
    const f = mtof(79 + (idx % 8));                     // climbs through the run
    const o1 = this._osc('sine', f, t);
    const o2 = this._osc('sine', f * 2.01, t);
    const g = this._gain(0);
    const g2 = this._gain(0.3);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
    this._set(o1.frequency, f * 1.06, t);
    this._ramp(o1.frequency, f * 0.94, t + 0.16);
    this._env(g.gain, t, 0.15 * amp, 0.002, 0.34, 0);
    const air = this._whoosh(t, dest, {
      dur: 0.18, f0: 2200, fp: 5200, f1: 2600, q: 3, peak: 0.06 * amp,
    });
    this._send(g, 0.45);
    o1.start(t); o2.start(t);
    this._kill(Math.max(t + 0.45, air.end), [o1, o2].concat(air.srcs), [g, g2].concat(air.nodes));
  }

  /* --------------------------------------------------------- critters --- */

  /** GNASHER bite — two wooden snaps closing over a low growl. */
  _sGnasherBite(t, amp, o, dest) {
    const srcs = [];
    const nodes = [];
    /* The jaw: two hard clacks 26 ms apart, the second lower (jaw shutting). */
    for (let k = 0; k < 2; k++) {
      const at = t + k * 0.026;
      const n = this._noise(this._jit(0.15), false);
      const bp = this._filter('bandpass', (1500 - k * 420) * this._jit(0.06), 5.5);
      const pk = this._filter('peaking', 620 * this._jit(0.1), 2);
      pk.gain.value = 8;
      const g = this._gain(0);
      n.connect(bp); bp.connect(pk); pk.connect(g); g.connect(dest);
      this._env(g.gain, at, (0.30 - k * 0.06) * amp, 0.0009, 0.05, 0);
      n.start(at, this._rand() * 1.7);
      srcs.push(n); nodes.push(bp, pk, g);
    }
    /* The growl underneath — a detuned saw pair through a moving lowpass. */
    const s1 = this._osc('sawtooth', 78, t);
    const s2 = this._osc('sawtooth', 82, t);
    const lp = this._filter('lowpass', 700, 4);
    const g2 = this._gain(0);
    const s2g = this._gain(0.6);
    s1.connect(lp); s2.connect(s2g); s2g.connect(lp);
    lp.connect(g2); g2.connect(dest);
    this._set(lp.frequency, 900, t);
    this._ramp(lp.frequency, 320, t + 0.24);
    this._env(g2.gain, t, 0.22 * amp, 0.006, 0.26, 0);
    /* Chain: a bright metallic rattle as the links snap taut. */
    const cn = this._noise(1.6, false);
    const cbp = this._filter('bandpass', 3900 * this._jit(0.08), 12);
    const cg = this._gain(0);
    cn.connect(cbp); cbp.connect(cg); cg.connect(dest);
    this._env(cg.gain, t, 0.10 * amp, 0.001, 0.13, 0);
    this._send(g2, 0.28);
    s1.start(t); s2.start(t); cn.start(t, this._rand() * 1.6);
    srcs.push(s1, s2, cn); nodes.push(lp, g2, s2g, cbp, cg);
    this._kill(t + 0.45, srcs, nodes);
  }

  /** BUMBLER squish — comedic, never gruesome: a squelch and a friendly pop. */
  _sSquish(t, amp, o, dest) {
    const n = this._noise(0.9, true);
    const lp = this._filter('lowpass', 1400, 7);
    const g = this._gain(0);
    n.connect(lp); lp.connect(g); g.connect(dest);
    this._set(lp.frequency, 1600, t);
    this._ramp(lp.frequency, 260, t + 0.16);
    this._env(g.gain, t, 0.24 * amp, 0.003, 0.17, 0);
    /* Boink: the cartoon pitch-bend that keeps it friendly. */
    const b = this._osc('triangle', 520, t + 0.01);
    const bg = this._gain(0);
    b.connect(bg); bg.connect(dest);
    this._set(b.frequency, 520, t + 0.01);
    this._ramp(b.frequency, 210, t + 0.09);
    this._ramp(b.frequency, 330, t + 0.16);
    this._env(bg.gain, t + 0.01, 0.20 * amp, 0.003, 0.17, 0);
    const p = this._osc('sine', 900, t + 0.15);
    const pg = this._gain(0);
    p.connect(pg); pg.connect(dest);
    this._ramp(p.frequency, 1500, t + 0.19);
    this._env(pg.gain, t + 0.15, 0.07 * amp, 0.001, 0.05, 0);
    this._send(bg, 0.2);
    n.start(t, this._rand() * 1.5); b.start(t + 0.01); p.start(t + 0.15);
    this._kill(t + 0.42, [n, b, p], [lp, g, bg, pg]);
  }

  /** SKITTER — insect chatter plus wing flutter, never a fixed rhythm. */
  _sSkitter(t, amp, o, dest) {
    const srcs = [];
    const nodes = [];
    let at = t;
    for (let k = 0; k < 5; k++) {
      const f = 2400 + this._rand() * 1800;
      const c = this._osc('square', f, at);
      const bp = this._filter('bandpass', f * 1.2, 8);
      const g = this._gain(0);
      c.connect(bp); bp.connect(g); g.connect(dest);
      this._ramp(c.frequency, f * 1.35, at + 0.018);
      this._env(g.gain, at, 0.055 * amp, 0.0008, 0.02, 0);
      c.start(at);
      srcs.push(c); nodes.push(bp, g);
      at += 0.024 + this._rand() * 0.022;
    }
    /* Wings: fast amplitude flutter out of band-passed noise. */
    const n = this._noise(1.2, false);
    const wbp = this._filter('bandpass', 1300, 2.2);
    const wg = this._gain(0);
    n.connect(wbp); wbp.connect(wg); wg.connect(dest);
    const dur = 0.34;
    this._set(wg.gain, 0, t);
    for (let k = 0; k < 12; k++) {
      this._ramp(wg.gain, (k % 2 === 0 ? 0.075 : 0.025) * amp, t + (k / 12) * dur);
    }
    this._ramp(wg.gain, 0, t + dur + 0.03);
    n.start(t, this._rand() * 1.6);
    srcs.push(n); nodes.push(wbp, wg);
    this._kill(Math.max(at, t + dur) + 0.1, srcs, nodes);
  }

  /** WARDEN hit — an armour plate taking a pound, with a pained grunt. */
  _sWardenHit(t, amp, o, dest) {
    const a = amp * clamp(fin(o.power, 1), 0.5, 1.6);
    const body = this._osc('sine', 160, t);
    const bg = this._gain(0);
    body.connect(bg); bg.connect(dest);
    this._ramp(body.frequency, 44, t + 0.18);
    this._env(bg.gain, t, 0.6 * a, 0.002, 0.3, 0);
    /* Plate ring: a metal bank tuned lower and wider than the crusher's. */
    const rn = this._noise(this._jit(0.1), false);
    const rout = this._gain(0);
    rout.connect(dest);
    const nodes = [bg, rout];
    const ring = [640, 1180, 1930, 3020];
    for (let k = 0; k < ring.length; k++) {
      const bp = this._filter('bandpass', ring[k] * this._jit(0.03), 14);
      const bg2 = this._gain(0.8 / (1 + k * 0.7));
      rn.connect(bp); bp.connect(bg2); bg2.connect(rout);
      nodes.push(bp, bg2);
    }
    this._env(rout.gain, t, 0.3 * a, 0.002, 0.6, 0);
    /* Grunt: a short vowel through two formants. */
    const gr = this._osc('sawtooth', 118, t + 0.02);
    const f1 = this._filter('bandpass', 560, 6);
    const f2 = this._filter('bandpass', 1150, 7);
    const gg = this._gain(0);
    gr.connect(f1); f1.connect(f2); f2.connect(gg); gg.connect(dest);
    this._ramp(gr.frequency, 86, t + 0.22);
    this._env(gg.gain, t + 0.02, 0.24 * a, 0.012, 0.22, 0);
    this._send(rout, 0.4);
    body.start(t); rn.start(t, this._rand() * 1.5); gr.start(t + 0.02);
    this._kill(t + 0.85, [body, rn, gr], nodes.concat([f1, f2, gg]));
  }

  /** WARDEN roar — the biggest voice in the game. Ducks the bed. */
  _sWardenRoar(t, amp, o, dest) {
    const a = amp;
    const dur = 1.25;
    /* Source: a detuned saw/square stack that BENDS down through the roar. */
    const src = this._gain(0.5);
    const nodes = [src];
    const srcs = [];
    const base = [42, 45, 49];
    for (let k = 0; k < base.length; k++) {
      const f = mtof(base[k]);
      const os = this._osc(k === 1 ? 'square' : 'sawtooth', f, t);
      os.detune.value = (k - 1) * 14;
      const og = this._gain(k === 1 ? 0.24 : 0.34);
      os.connect(og); og.connect(src);
      this._set(os.frequency, f * 1.18, t);
      this._ramp(os.frequency, f * 0.86, t + dur);
      os.start(t);
      srcs.push(os); nodes.push(og);
    }
    /* Throat: three formants opening then closing — a mouth, not a synth. */
    const out = this._gain(0);
    const fq = [340, 900, 2200];
    const fg = [1, 0.7, 0.3];
    for (let k = 0; k < fq.length; k++) {
      const bp = this._filter('bandpass', fq[k], 5 + k * 2);
      const bg = this._gain(fg[k]);
      src.connect(bp); bp.connect(bg); bg.connect(out);
      this._set(bp.frequency, fq[k] * 0.8, t);
      this._ramp(bp.frequency, fq[k] * 1.4, t + dur * 0.35);
      this._ramp(bp.frequency, fq[k] * 0.7, t + dur);
      nodes.push(bp, bg);
    }
    out.connect(dest);
    nodes.push(out);
    this._env(out.gain, t, 0.62 * a, 0.07, dur * 0.55, 0, dur * 0.35);
    /* Rasp: the noise that makes it an animal instead of a chord. */
    const n = this._noise(0.8, true);
    const nbp = this._filter('bandpass', 700, 1.4);
    const ng = this._gain(0);
    n.connect(nbp); nbp.connect(ng); ng.connect(dest);
    this._set(nbp.frequency, 900, t);
    this._ramp(nbp.frequency, 420, t + dur);
    this._env(ng.gain, t, 0.28 * a, 0.06, dur * 0.6, 0, dur * 0.3);
    /* Sub: felt in the floor. */
    const sub = this._osc('sine', 58, t);
    const sg = this._gain(0);
    sub.connect(sg); sg.connect(dest);
    this._ramp(sub.frequency, 36, t + dur);
    this._env(sg.gain, t, 0.5 * a, 0.09, dur * 0.6, 0, dur * 0.25);
    this._send(out, 0.5);
    this._send(ng, 0.35);
    n.start(t, this._rand() * 1.4); sub.start(t);
    srcs.push(n, sub); nodes.push(nbp, ng, sg);
    this._kill(t + dur + 0.6, srcs, nodes);
    this.duck(1100);
  }

  /* ------------------------------------------------------ world  /  UI --- */

  /** Gate opening — stone grinding aside, a latch clunk, then relief. */
  _sGateOpen(t, amp, o, dest) {
    const dur = clamp(fin(o.dur, 1.6), 0.4, 4);
    /* Grind: low band-passed noise dragging upward as the slab moves. */
    const n = this._noise(0.55, true);
    const bp = this._filter('bandpass', 260, 1.6);
    const g = this._gain(0);
    n.connect(bp); bp.connect(g); g.connect(dest);
    this._set(bp.frequency, 220, t);
    this._ramp(bp.frequency, 640, t + dur * 0.7);
    this._ramp(bp.frequency, 300, t + dur);
    this._env(g.gain, t, 0.30 * amp, 0.12, dur * 0.55, 0, dur * 0.3);
    /* Rumble under it. */
    const sub = this._osc('sine', 44, t);
    const sg = this._gain(0);
    sub.connect(sg); sg.connect(dest);
    this._env(sg.gain, t, 0.28 * amp, 0.15, dur * 0.6, 0, dur * 0.25);
    /* Latch clunk near the end. */
    const at = t + dur * 0.82;
    const cn = this._noise(this._jit(0.1), false);
    const cout = this._gain(0);
    cout.connect(dest);
    const nodes = [bp, g, sg, cout];
    const ring = [380, 720, 1240, 2100];
    for (let k = 0; k < ring.length; k++) {
      const cbp = this._filter('bandpass', ring[k] * this._jit(0.03), 10);
      const cg = this._gain(0.8 / (1 + k * 0.8));
      cn.connect(cbp); cbp.connect(cg); cg.connect(cout);
      nodes.push(cbp, cg);
    }
    this._env(cout.gain, at, 0.34 * amp, 0.002, 0.55, 0);
    /* Resolution: a rising fifth so the player knows it WORKED. */
    const srcs = [n, sub, cn];
    const notes = [64, 71, 76];
    for (let k = 0; k < notes.length; k++) {
      const nt = t + dur * 0.84 + k * 0.13;
      const os = this._osc('triangle', mtof(notes[k]), nt);
      const og = this._gain(0);
      os.connect(og); og.connect(dest);
      this._env(og.gain, nt, 0.16 * amp, 0.008, k === 2 ? 1.1 : 0.4, 0);
      this._send(og, 0.6);
      os.start(nt);
      srcs.push(os); nodes.push(og);
    }
    this._send(cout, 0.5);
    this._send(g, 0.3);
    n.start(t, this._rand() * 1.4); sub.start(t); cn.start(at, this._rand() * 1.5);
    this._kill(t + dur + 1.5, srcs, nodes);
  }

  /** Painting entry — a rising shimmer that swallows the room. */
  _sPaintingEnter(t, amp, o, dest) {
    const dur = 1.1;
    const srcs = [];
    const nodes = [];
    /* Bell partials sweeping upward, each a little later than the last. */
    const parts = [1, 2.01, 3.02, 4.98, 7.03];
    for (let k = 0; k < parts.length; k++) {
      const at = t + k * 0.055;
      const f = 330 * parts[k];
      const os = this._osc('sine', f, at);
      const g = this._gain(0);
      const pan = this._pan((k / (parts.length - 1)) * 1.2 - 0.6);
      os.connect(g);
      if (pan) { g.connect(pan); pan.connect(dest); nodes.push(pan); } else { g.connect(dest); }
      this._set(os.frequency, f, at);
      this._ramp(os.frequency, f * 1.5, at + dur * 0.8);
      this._env(g.gain, at, (0.14 - k * 0.018) * amp, 0.03, dur * 0.8, 0, dur * 0.15);
      this._send(g, 0.7);
      os.start(at);
      srcs.push(os); nodes.push(g);
    }
    /* Air rushing into the canvas. */
    const w = this._whoosh(t, dest, {
      dur: dur, f0: 500, fp: 5200, f1: 7200, q: 1.2, peak: 0.13 * amp, rev: 0.4,
    });
    this._kill(Math.max(t + dur + 0.6, w.end), srcs.concat(w.srcs), nodes.concat(w.nodes));
    this.duck(900);
  }

  /** UI blips — one shape, three intervals: move / confirm / cancel. */
  _sUi(t, amp, dest, f0, f1, dur, type, revAmt) {
    const os = this._osc(type, f0, t);
    const g = this._gain(0);
    os.connect(g); g.connect(dest);
    this._set(os.frequency, f0, t);
    this._ramp(os.frequency, f1, t + dur * 0.6);
    this._env(g.gain, t, 0.16 * amp, 0.002, dur, 0);
    if (revAmt > 0) this._send(g, revAmt * 0.25);
    os.start(t);
    this._kill(t + dur + 0.08, [os], [g]);
  }

  /* ====================================================================
   * Stingers — CONTRACT §5 stinger(name)
   *
   * Short MUSICAL cues, not gameplay sounds: they go to their own bus so a
   * ducked bed does not swallow them, and they never consume the sfx voice
   * budget. All seven live in the same C-major world as the Keep, so the game
   * reads as one score rather than a pile of unrelated jingles.
   * ==================================================================*/

  /**
   * One stinger note: a detuned saw/triangle choir through a filter sweep.
   * @param {number} t when @param {number} note MIDI
   * @param {object} o {peak, dur, hold, voices, type, rev, bright, attack}
   * @param {Array} srcs out-param, appended  @param {Array} nodes out-param
   * @returns {number} when the note is done
   */
  _stingNote(t, note, o, srcs, nodes) {
    const dest = this.stingerBus;
    const f = mtof(note);
    const voices = fin(o.voices, 3) | 0;
    const lp = this._filter('lowpass', 4200, 3);
    const g = this._gain(0);
    lp.connect(g); g.connect(dest);
    for (let d = 0; d < voices; d++) {
      const os = this._osc(d === 1 ? 'triangle' : (o.type || 'sawtooth'), f, t);
      os.detune.value = (d - (voices - 1) / 2) * 11;
      const og = this._gain(0.55 / voices);
      os.connect(og); og.connect(lp);
      os.start(t);
      srcs.push(os); nodes.push(og);
    }
    const dur = fin(o.dur, 0.42);
    const hold = fin(o.hold, 0.03);
    this._set(lp.frequency, fin(o.bright, 5200), t);
    this._ramp(lp.frequency, 1300, t + dur * 0.9);
    this._env(g.gain, t, fin(o.peak, 0.22), fin(o.attack, 0.006), dur, 0, hold);
    this._send(g, fin(o.rev, 0.55));
    nodes.push(lp, g);
    return t + dur + hold;
  }

  /** A soft mallet ping — the sparkle cues are built from these. */
  _stingPing(t, note, peak, srcs, nodes) {
    const dest = this.stingerBus;
    const f = mtof(note);
    const o1 = this._osc('sine', f, t);
    const o2 = this._osc('sine', f * 3.01, t);
    const g = this._gain(0);
    const g2 = this._gain(0);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(dest);
    this._env(g2.gain, t, 0.22, 0.001, 0.09, 0);
    this._env(g.gain, t, peak, 0.002, 0.75, 0);
    this._send(g, 0.65);
    o1.start(t); o2.start(t);
    srcs.push(o1, o2); nodes.push(g, g2);
  }

  /** A kettle-drum hit under a fanfare. */
  _stingDrum(t, freq, peak, srcs, nodes) {
    const dest = this.stingerBus;
    const o = this._osc('sine', freq, t);
    const g = this._gain(0);
    o.connect(g); g.connect(dest);
    this._ramp(o.frequency, freq * 0.55, t + 0.16);
    this._env(g.gain, t, peak, 0.003, 0.4, 0);
    const n = this._noise(0.7, true);
    const lp = this._filter('lowpass', 800, 1.1);
    const ng = this._gain(0);
    n.connect(lp); lp.connect(ng); ng.connect(dest);
    this._env(ng.gain, t, peak * 0.3, 0.002, 0.2, 0);
    this._send(g, 0.35);
    o.start(t); n.start(t, this._rand() * 1.5);
    srcs.push(o, n); nodes.push(g, lp, ng);
  }

  /**
   * Play one of the seven cues.
   * @param {'crest'|'courseClear'|'death'|'checkpoint'|'unlock'|'sigilsDone'|'coins100'} name
   */
  stinger(name) {
    if (!this.ctx || !this.ready || !this.available) return;
    if (this.ctx.state !== 'running') {
      if (!this._pageMuted) this._resume();
      if (this.ctx.state !== 'running') return;
    }
    const t = this.ctx.currentTime + 0.01;
    const srcs = [];
    const nodes = [];
    let end = t + 1;

    try {
      switch (name) {
        case 'crest': {
          /* I - III - V - octave: the game's victory interval. */
          const run = [72, 76, 79, 84];
          for (let k = 0; k < run.length; k++) {
            const last = k === run.length - 1;
            this._stingNote(t + k * 0.1, run[k], {
              peak: 0.26, dur: last ? 1.4 : 0.34, hold: last ? 0.3 : 0.02, rev: 0.65,
            }, srcs, nodes);
          }
          this._stingNote(t, 48, { peak: 0.2, dur: 1.6, hold: 0.3, voices: 2, attack: 0.09, bright: 1400, rev: 0.4 }, srcs, nodes);
          this._stingDrum(t, 96, 0.34, srcs, nodes);
          end = t + 2.2;
          this.duck(1500);
          break;
        }
        case 'courseClear': {
          /* A six-note fanfare landing on the SIXTH — open, not final: there
             are always more crests left in the course you just cleared. */
          const run = [67, 72, 76, 79, 84, 81];
          for (let k = 0; k < run.length; k++) {
            const last = k === run.length - 1;
            this._stingNote(t + k * 0.135, run[k], {
              peak: 0.24, dur: last ? 1.9 : 0.4, hold: last ? 0.45 : 0.03, rev: 0.6,
            }, srcs, nodes);
          }
          this._stingNote(t + 0.55, 60, { peak: 0.18, dur: 2.1, hold: 0.5, voices: 4, attack: 0.2, bright: 2400, rev: 0.7 }, srcs, nodes);
          this._stingNote(t, 41, { peak: 0.2, dur: 2.4, hold: 0.4, voices: 2, attack: 0.12, bright: 1100, rev: 0.35 }, srcs, nodes);
          this._stingDrum(t, 88, 0.36, srcs, nodes);
          this._stingDrum(t + 0.27, 88, 0.22, srcs, nodes);
          this._stingDrum(t + 0.675, 66, 0.40, srcs, nodes);
          end = t + 3.0;
          this.duck(2400);
          break;
        }
        case 'death': {
          /* Three notes down a minor triad, then the floor drops out. */
          const run = [72, 68, 63];
          for (let k = 0; k < run.length; k++) {
            this._stingNote(t + k * 0.13, run[k], {
              peak: 0.20, dur: k === 2 ? 0.9 : 0.28, hold: 0.02, voices: 2, bright: 2600, rev: 0.4,
            }, srcs, nodes);
          }
          const sub = this._osc('sine', 84, t + 0.26);
          const sg = this._gain(0);
          sub.connect(sg); sg.connect(this.stingerBus);
          this._ramp(sub.frequency, 30, t + 0.9);
          this._env(sg.gain, t + 0.26, 0.36, 0.01, 0.8, 0);
          sub.start(t + 0.26);
          srcs.push(sub); nodes.push(sg);
          end = t + 1.5;
          this.duck(900);
          break;
        }
        case 'checkpoint': {
          this._stingPing(t, 79, 0.20, srcs, nodes);
          this._stingPing(t + 0.09, 86, 0.16, srcs, nodes);
          end = t + 1.1;
          break;
        }
        case 'unlock': {
          /* A heavy resonant clunk, then a rising fourth: the way in opens. */
          this._stingDrum(t, 70, 0.40, srcs, nodes);
          this._stingNote(t + 0.10, 55, { peak: 0.22, dur: 0.5, voices: 2, bright: 2200, rev: 0.5 }, srcs, nodes);
          this._stingNote(t + 0.30, 60, { peak: 0.24, dur: 1.3, hold: 0.25, rev: 0.7 }, srcs, nodes);
          this._stingPing(t + 0.55, 84, 0.13, srcs, nodes);
          this._stingPing(t + 0.68, 91, 0.10, srcs, nodes);
          end = t + 2.0;
          this.duck(1100);
          break;
        }
        case 'sigilsDone': {
          /* Eight rising notes — one per sigil — resolved on the octave. */
          const run = [72, 74, 76, 78, 79, 81, 83, 84];
          for (let k = 0; k < run.length; k++) {
            this._stingPing(t + k * 0.075, run[k], k === 7 ? 0.22 : 0.13, srcs, nodes);
          }
          this._stingNote(t + 0.52, 60, { peak: 0.18, dur: 1.4, hold: 0.2, voices: 3, attack: 0.05, rev: 0.7 }, srcs, nodes);
          end = t + 2.1;
          this.duck(1000);
          break;
        }
        case 'coins100': {
          /* A cascade: six pings tumbling down, then a warm confirmation. */
          const run = [96, 91, 88, 84, 79, 76];
          for (let k = 0; k < run.length; k++) {
            this._stingPing(t + k * 0.055, run[k], 0.12 - k * 0.008, srcs, nodes);
          }
          this._stingNote(t + 0.33, 64, { peak: 0.20, dur: 1.1, hold: 0.15, voices: 3, rev: 0.6 }, srcs, nodes);
          this._stingNote(t + 0.33, 52, { peak: 0.14, dur: 1.2, hold: 0.15, voices: 2, bright: 1600, rev: 0.4 }, srcs, nodes);
          end = t + 1.8;
          this.duck(900);
          break;
        }
        default:
          return;
      }
    } catch (e) { /* a broken stinger never breaks the frame */ }

    /* Counted as music (this._inSfx is false here), so a long fanfare can
       never starve the gameplay voice budget. */
    this._kill(end, srcs, nodes);
  }

  /* ====================================================================
   * Looping, distance-attenuated ambience
   * ==================================================================*/
  /**
   * Start (or fetch, when `opts.key` names an existing one) a continuous
   * positional sound. The handle is allocation-free to drive per frame:
   * `h.setPos(pos, listener)` only writes AudioParams.
   *
   * @param {'wind'|'lava_flow'|'water_flow'|'machine_hum'} name
   * @param {object} [opts] {key, gain, pos, listener, ref, max}
   * @returns {object} loop handle (a no-op stub when audio is unavailable)
   */
  loop(name, opts) {
    const stub = _loopStub;
    if (!this.ctx || !this.ready) return stub;
    if (this.ctx.state !== 'running') { if (!this._pageMuted) this._resume(); }
    const n = ALIAS[name] || name;
    const o = opts || _emptyOpts;

    /* Reuse an existing handle when the caller supplies a stable key. */
    if (o.key !== undefined && this._loops.has(o.key)) {
      const h = this._loops.get(o.key);
      if (o.pos) h.setPos(o.pos, o.listener);
      return h;
    }

    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const out = this._gain(0);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const air = this._filter('lowpass', 15000, 0.7);
    out.connect(air);
    if (pan) { air.connect(pan); pan.connect(this.sfxBus); } else { air.connect(this.sfxBus); }

    const srcs = [];
    const nodes = [out, air];
    if (pan) nodes.push(pan);
    let baseGain = clamp(fin(o.gain, 1), 0, 3);

    if (n === 'wind') {
      /* Two band-passed pink layers on different, non-repeating schedules —
         one gust never lines up with the next. */
      const nz = this._noise(0.6, true);
      const bp = this._filter('bandpass', 430, 0.9);
      const hp = this._filter('highpass', 170, 0.6);
      nz.connect(bp); bp.connect(hp); hp.connect(out);
      let at = t;
      for (let k = 0; k < 20; k++) {
        this._ramp(bp.frequency, 300 + this._rand() * 620, at + 2.0);
        at += 2.0;
      }
      const nz2 = this._noise(0.28, true);
      const bp2 = this._filter('bandpass', 190, 1.4);
      const g2 = this._gain(0.5);
      nz2.connect(bp2); bp2.connect(g2); g2.connect(out);
      nz.start(t, this._rand() * 1.5); nz2.start(t, this._rand() * 1.5);
      srcs.push(nz, nz2);
      nodes.push(bp, hp, bp2, g2);
      baseGain *= 0.55;
    } else if (n === 'lava_flow') {
      const nz = this._noise(0.45, true);
      const lp = this._filter('lowpass', 380, 1.6);
      const bp = this._filter('bandpass', 160, 1.1);
      nz.connect(lp); lp.connect(bp); bp.connect(out);
      /* A slow churn on the cutoff so the surface never sits still. */
      const lfo = this._osc('sine', 0.19, t);
      const lfoG = this._gain(90);
      lfo.connect(lfoG); lfoG.connect(lp.frequency);
      nz.start(t, this._rand() * 1.5); lfo.start(t);
      srcs.push(nz, lfo);
      nodes.push(lp, bp, lfoG);
      baseGain *= 0.6;
    } else if (n === 'water_flow') {
      /* A river: mid noise with a moving notch plus a high sparkle layer. */
      const nz = this._noise(0.9, true);
      const bp = this._filter('bandpass', 900, 0.8);
      const hp = this._filter('highpass', 350, 0.6);
      nz.connect(bp); bp.connect(hp); hp.connect(out);
      const spk = this._noise(1.6, false);
      const shp = this._filter('highpass', 4200, 0.7);
      const sg = this._gain(0.22);
      spk.connect(shp); shp.connect(sg); sg.connect(out);
      const lfo = this._osc('sine', 0.27, t);
      const lfoG = this._gain(260);
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      nz.start(t, this._rand() * 1.5); spk.start(t, this._rand() * 1.5); lfo.start(t);
      srcs.push(nz, spk, lfo);
      nodes.push(bp, hp, shp, sg, lfoG);
      baseGain *= 0.5;
    } else if (n === 'machine_hum') {
      /* Foundry / clockwork room tone: a detuned drone pair, a tooth-rate
         tremolo, and a thin air whistle over the top. */
      const a1 = this._osc('sawtooth', 55, t);
      const a2 = this._osc('sawtooth', 55.6, t);
      const a3 = this._osc('square', 110, t);
      const lp = this._filter('lowpass', 520, 1.6);
      const g1 = this._gain(0.4), g2 = this._gain(0.4), g3 = this._gain(0.14);
      a1.connect(g1); a2.connect(g2); a3.connect(g3);
      g1.connect(lp); g2.connect(lp); g3.connect(lp);
      const trem = this._gain(1);
      lp.connect(trem); trem.connect(out);
      const lfo = this._osc('sine', 7.4, t);
      const lfoG = this._gain(0.28);
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      const air2 = this._noise(1, false);
      const bp = this._filter('bandpass', 2400, 6);
      const ag = this._gain(0.10);
      air2.connect(bp); bp.connect(ag); ag.connect(out);
      a1.start(t); a2.start(t); a3.start(t); lfo.start(t); air2.start(t, this._rand() * 1.4);
      srcs.push(a1, a2, a3, lfo, air2);
      nodes.push(lp, g1, g2, g3, trem, lfoG, bp, ag);
      baseGain *= 0.55;
    } else {
      try { out.disconnect(); air.disconnect(); if (pan) pan.disconnect(); } catch (e) {}
      return stub;
    }

    const self = this;
    const id = this._loopSeq++;
    const key = o.key !== undefined ? o.key : id;
    const handle = {
      id, key, name: n, alive: true,
      _base: baseGain,
      _listener: o.listener || null,
      setListener(l) { this._listener = l || null; return this; },
      setGain(g) { this._base = clamp(fin(g, 1), 0, 3); return this; },
      setRate(r) {
        const v = clamp(fin(r, 1), 0.2, 3);
        for (let i = 0; i < srcs.length; i++) {
          const s = srcs[i];
          if (s && s.playbackRate) { try { self._target(s.playbackRate, v, self.ctx.currentTime, 0.05); } catch (e) {} }
          else if (s && s.detune) { try { self._target(s.detune, (v - 1) * 1200, self.ctx.currentTime, 0.05); } catch (e) {} }
        }
        return this;
      },
      setPos(pos, listener) {
        if (!this.alive || !self.ctx) return this;
        if (listener) this._listener = listener;
        _spatialIn.pos = pos;
        _spatialIn.listener = this._listener;
        _spatialIn.ref = fin(o.ref, 8);
        _spatialIn.max = fin(o.max, 44);
        const sp = self._spatial(_spatialIn);
        const now = self.ctx.currentTime;
        self._target(out.gain, this._base * sp.gain, now, 0.06);
        if (pan) self._target(pan.pan, sp.pan, now, 0.08);
        self._target(air.frequency, clamp(15000 - Math.max(0, sp.dist - 10) * 340, 700, 15000), now, 0.1);
        return this;
      },
      stop(fadeMs) {
        if (!this.alive) return;
        this.alive = false;
        const f = clamp(fin(fadeMs, 140), 0, 4000) / 1000;
        const now = self.ctx ? self.ctx.currentTime : 0;
        try { out.gain.cancelScheduledValues(now); } catch (e) {}
        self._set(out.gain, fin(out.gain.value, 0), now);
        self._ramp(out.gain, 0, now + f);
        self._kill(now + f + 0.05, srcs, nodes);
        self._loops.delete(key);
      },
    };

    /* Initial placement + fade in. Positional loops ride up from 0 via the
       setTarget in setPos; non-positional ones get a plain linear fade. */
    const t0 = ctx.currentTime;
    this._set(out.gain, 0, t0);
    if (o.pos) handle.setPos(o.pos, o.listener);
    else this._ramp(out.gain, baseGain, t0 + 0.25);

    this._loops.set(key, handle);
    return handle;
  }

  /** Stop one loop by the key given to `loop(name, {key})`. */
  stopLoop(key, fadeMs) {
    const h = this._loops.get(key);
    if (h) h.stop(fadeMs);
  }

  /** Optional per-frame housekeeping — safe to call or to skip. */
  update(dt) {
    if (!this.ctx || !this.ready) return;
    if (this._loops.size > 48) {
      /* Runaway guard: something forgot to stop its loops. */
      let n = 0;
      for (const h of this._loops.values()) { if (n++ > 32) h.stop(60); }
    }
  }

  /* ====================================================================
   * Teardown
   * ==================================================================*/
  stopAll() {
    try {
      for (const h of Array.from(this._loops.values())) h.stop(80);
      this._loops.clear();
    } catch (e) {}
    for (let i = 0; i < this._active.length; i++) {
      const b = this._active[i];
      try {
        const now = this.ctx ? this.ctx.currentTime : 0;
        this._ramp(b.out.gain, 0, now + 0.15);
        this._ramp(b.rev.gain, 0, now + 0.15);
      } catch (e) {}
      setTimeout(() => { try { this._teardownBed(b); } catch (e) {} }, 260);
    }
    this._active.length = 0;
    this.theme = null;
    this._pendingTheme = null;
  }

  dispose() {
    this.stopAll();
    this._stopScheduler();
    if (IS_BROWSER && this._onMuteChange) {
      window.removeEventListener('mutechange', this._onMuteChange, false);
    }
    if (this.moodWob) { try { this.moodWob.stop(); } catch (e) {} }
    if (this.ctx) {
      const ctx = this.ctx;
      this.ready = false;
      setTimeout(() => { try { ctx.close(); } catch (e) {} }, 300);
      this.ctx = null;
    }
  }
}

/* Reusable scratch so spatial maths never allocates per call. */
const _spatialOut = { gain: 1, pan: 0, dist: 0 };
const _spatialIn = { pos: null, listener: null, ref: 8, max: 44 };
const _emptyOpts = Object.freeze({});
const _loopStub = Object.freeze({
  id: 0, key: 0, name: '', alive: false,
  setPos() { return this; }, setListener() { return this; },
  setGain() { return this; }, setRate() { return this; }, stop() {},
});

export default Audio;
