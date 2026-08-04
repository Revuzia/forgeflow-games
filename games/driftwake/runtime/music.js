/**
 * DRIFTWAKE — procedural music bed.  `FFG.MusicBed`
 *
 * WHY THIS FILE EXISTS — AND WHY IT IS NO LONGER THE DEFAULT
 *
 * `ffg_shell.js` owns a looping background track and expects a URL for it
 * (`new Audio(opts.music)`). This file was written when DRIFTWAKE was forbidden
 * asset files of any kind, so the shell was handed no `music` option and this
 * synthesised the bed instead, live, through Web Audio.
 *
 * That constraint is lifted. The bed is now a real recording —
 * `assets/audio/music/hollow-wave.mp3`, wired through the shell's own `music`
 * path in `src/main.js` — and this is the FALLBACK, reached only when that file
 * fails to load or decode. `src/main.js` owns that decision, calls `start()`
 * from exactly one place, and stops the shell's element before it does, so the
 * two are never audible at the same time. Do not call `start()` from anywhere
 * else: a second caller is a second soundtrack.
 *
 * Everything below still stands on its own — a synthesised bed is what a
 * fallback should be, since it cannot itself fail to download.
 *
 * ---------------------------------------------------------------------------
 * WHY A STANDING GRAPH AND NOT A RENDERED BUFFER
 *
 * The obvious alternative — synthesise thirty seconds into an AudioBuffer and
 * loop one AudioBufferSourceNode — costs a multi-megabyte allocation and a
 * hundred-millisecond synchronous fill at the exact moment the player clicks
 * PLAY. This frame has no headroom to give away (ultra runs ~8 fps on the
 * verification machine), and a hitch on the first frame of the game is the most
 * expensive hitch there is.
 *
 * What is built instead is ~27 nodes, once, that then run forever on the
 * browser's audio thread: three chord voices of two detuned oscillators each,
 * one sub, per-voice lowpass, and four LFOs at deliberately incommensurate
 * rates (0.017 / 0.023 / 0.031 / 0.041 Hz) so the swell never lines up with
 * itself and the bed does not read as a loop. The frame thread's total per-frame
 * cost is zero: nothing here runs from requestAnimationFrame, and nothing
 * allocates after `start()`.
 *
 * The chord progression is scheduled ahead on the audio clock — a whole 96 s
 * cycle at a time — and re-armed from a `setTimeout`, not from the render loop.
 *
 * ---------------------------------------------------------------------------
 * MUTE
 *
 * The context is constructed through `globalThis.AudioContext` AT START TIME,
 * never a cached native constructor: `game_controls.js` wraps that constructor
 * before any game code runs and suspends every context it handed out when the
 * page-level Mute button is pressed. Routing around the wrap would give the
 * player a Mute button that does not mute the music. Same house rule as
 * `src/audio/audio.js`.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};

  /* Seconds per chord, and the four chords. A minor / F / C / G — a plain,
     slow, cold progression; the point is that it stays out of the way of the
     wind bed and the surf hiss, which are the sounds the game is actually
     about. Frequencies are Hz, one per voice, low register on purpose so the
     bed sits underneath the SFX rather than across them. */
  var CHORD_S = 24;
  var CHORDS = [
    [220.00, 261.63, 329.63], // Am   A3 C4 E4
    [174.61, 261.63, 349.23], // F    F3 C4 F4
    [196.00, 261.63, 329.63], // C/G  G3 C4 E4
    [196.00, 246.94, 293.66], // G    G3 B3 D4
  ];
  /** Sub-octave root per chord, an octave and a fifth below the top voice. */
  var SUBS = [55.00, 43.65, 49.00, 49.00];

  /** Glide between chords, seconds. `setTargetAtTime` time-constant. */
  var GLIDE = 2.6;

  /** Per-voice pan, amplitude-LFO rate (Hz) and detune (cents). */
  var VOICES = [
    { pan: -0.55, lfo: 0.017, detune: 7 },
    { pan: 0.10, lfo: 0.023, detune: -5 },
    { pan: 0.60, lfo: 0.031, detune: 9 },
  ];

  function MusicBed() {
    this.ctx = null;
    this.error = null;
    this._started = false;
    this._muted = false;
    this._volume = 0.3;
    this._next = 0;
    this._timer = null;

    this.master = null;
    /** @type {Array<{a:OscillatorNode,b:OscillatorNode,filter:BiquadFilterNode}>} */
    this._voices = [];
    this._sub = null;

    var self = this;
    this._onMute = function (e) {
      var d = e && e.detail;
      if (d && typeof d.muted === "boolean") self._muted = d.muted;
    };
    this._onBlur = function () { self._suspend(); };
    this._onFocus = function () { self._resume(); };
  }

  /**
   * Build the graph and open the bed. Must be called from a user gesture — the
   * shell's PLAY click is one. Safe to call repeatedly; only the first call
   * with a live gesture behind it does anything.
   * @returns {void}
   */
  MusicBed.prototype.start = function () {
    if (this._started) { this._resume(); return; }
    this._started = true;
    try {
      var Ctor = root.AudioContext || root.webkitAudioContext;
      if (!Ctor) { this.error = "no Web Audio in this browser"; return; }
      var ctx = this.ctx = new Ctor();
      this._build(ctx);
      this._arm(ctx.currentTime + 0.15);
      this._resume();
      root.addEventListener("mutechange", this._onMute);
      root.addEventListener("blur", this._onBlur);
      root.addEventListener("focus", this._onFocus);
    } catch (err) {
      // Music is not load-bearing. A browser that refuses a context still gets
      // the game; the reason is recorded for the report surface and that is all.
      this.error = err && err.message ? err.message : String(err);
      this.ctx = null;
    }
  };

  /** @param {AudioContext} ctx @returns {void} */
  MusicBed.prototype._build = function (ctx) {
    var t0 = ctx.currentTime;

    // Soft limiter, then the volume trim. Insurance, not colour: three voices
    // plus a sub all swelling in phase would otherwise clip the bus.
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -14;
    lim.knee.value = 20;
    lim.ratio.value = 8;
    lim.attack.value = 0.02;
    lim.release.value = 0.35;
    lim.connect(ctx.destination);

    var master = this.master = ctx.createGain();
    // Opens from silence over four seconds: the menu appears before the music
    // does, which is what a fade-in is for.
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(this._volume * 0.55, t0 + 4);
    master.connect(lim);

    // One shared filter LFO, so the three voices breathe together while their
    // amplitudes drift apart.
    var fLfo = ctx.createOscillator();
    fLfo.frequency.value = 0.041;
    var fLfoGain = ctx.createGain();
    fLfoGain.gain.value = 260;
    fLfo.connect(fLfoGain);
    fLfo.start(t0);

    for (var i = 0; i < VOICES.length; i++) {
      var V = VOICES[i];

      var filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 620;
      filter.Q.value = 0.7;
      fLfoGain.connect(filter.frequency);

      var vGain = ctx.createGain();
      vGain.gain.value = 0.085;

      // Slow amplitude drift, one incommensurate rate per voice.
      var aLfo = ctx.createOscillator();
      aLfo.frequency.value = V.lfo;
      var aGain = ctx.createGain();
      aGain.gain.value = 0.045;
      aLfo.connect(aGain);
      aGain.connect(vGain.gain);
      aLfo.start(t0);

      var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = V.pan;
        filter.connect(vGain);
        vGain.connect(pan);
        pan.connect(master);
      } else {
        filter.connect(vGain);
        vGain.connect(master);
      }

      // Two oscillators per voice, detuned against each other: the beating is
      // what stops a held chord sounding like a test tone.
      var a = ctx.createOscillator();
      a.type = "triangle";
      a.frequency.value = CHORDS[0][i];
      a.detune.value = V.detune;
      a.connect(filter);
      a.start(t0);

      var b = ctx.createOscillator();
      b.type = "sawtooth";
      b.frequency.value = CHORDS[0][i];
      b.detune.value = -V.detune;
      var bTrim = ctx.createGain();
      bTrim.gain.value = 0.35; // the saw is texture under the triangle, not a second voice
      b.connect(bTrim);
      bTrim.connect(filter);
      b.start(t0);

      this._voices.push({ a: a, b: b, filter: filter });
    }

    // Sub. A pure sine, well below everything the wind bed occupies.
    var sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = SUBS[0];
    var subGain = ctx.createGain();
    subGain.gain.value = 0.11;
    sub.connect(subGain);
    subGain.connect(master);
    sub.start(t0);
    this._sub = sub;
  };

  /**
   * Schedule one full progression cycle on the audio clock and set a timer to
   * schedule the next one. A timer, deliberately — nothing about the music is
   * allowed near the render loop.
   * @param {number} startTime AudioContext time for the first chord
   * @returns {void}
   */
  MusicBed.prototype._arm = function (startTime) {
    var ctx = this.ctx;
    if (!ctx) return;
    // A suspended context stops its clock, so a re-arm that lands after a long
    // mute would schedule the whole cycle in the past and every chord would
    // arrive at once. Never schedule behind the playhead.
    var t = Math.max(startTime, ctx.currentTime + 0.05);

    for (var c = 0; c < CHORDS.length; c++) {
      var when = t + c * CHORD_S;
      for (var i = 0; i < this._voices.length; i++) {
        var v = this._voices[i];
        v.a.frequency.setTargetAtTime(CHORDS[c][i], when, GLIDE);
        v.b.frequency.setTargetAtTime(CHORDS[c][i], when, GLIDE);
      }
      if (this._sub) this._sub.frequency.setTargetAtTime(SUBS[c], when, GLIDE);
    }

    this._next = t + CHORDS.length * CHORD_S;
    var self = this;
    if (this._timer) clearTimeout(this._timer);
    // Re-arm two seconds before the cycle runs out, so a late timer (a busy
    // main thread — and this one is busy) still schedules ahead of the clock.
    this._timer = setTimeout(function () { self._arm(self._next); },
      Math.max(1000, (CHORDS.length * CHORD_S - 2) * 1000));
  };

  /** @returns {void} */
  MusicBed.prototype._resume = function () {
    var ctx = this.ctx;
    // The context's OWN resume: `game_controls.js` replaced it with a wrapper
    // that refuses while muted, and that refusal is the mute.
    if (ctx && ctx.state !== "running") { try { ctx.resume(); } catch (e) {} }
  };

  /** @returns {void} */
  MusicBed.prototype._suspend = function () {
    var ctx = this.ctx;
    if (ctx && ctx.state === "running") { try { ctx.suspend(); } catch (e) {} }
  };

  /**
   * The shell's MUSIC slider, 0..1. Also the value the fade-in targets if the
   * slider is moved before the fade has finished.
   * @param {number} v
   * @returns {void}
   */
  MusicBed.prototype.setVolume = function (v) {
    this._volume = v < 0 ? 0 : v > 1 ? 1 : v;
    var ctx = this.ctx;
    if (!ctx || !this.master) return;
    var now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this._volume * 0.55, now + 0.08);
  };

  /** For the report surface: what the bed is actually doing. @returns {string} */
  MusicBed.prototype.status = function () {
    if (this.error) return "failed: " + this.error;
    if (!this.ctx) return "not started";
    return this.ctx.state;
  };

  FFG.MusicBed = MusicBed;
})(typeof window !== "undefined" ? window : globalThis);
