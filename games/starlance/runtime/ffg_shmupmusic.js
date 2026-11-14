/**
 * ffg_shmupmusic.js — procedural SPACE-SHMUP background score for Starlance.
 *
 * No audio asset, no license: a driving minor-key synth loop synthesized live with
 * Web Audio — a 16th-note pulsing saw bass, a rolling triangle arpeggio, a soft pad,
 * a square lead motif, and a light synthetic kick/hat groove. ~150 BPM in A-minor
 * (Am–F–C–G), look-ahead scheduled and looped forever. A soft compressor tames the
 * mix so the stacked voices never clip. start() / stop() / setVolume().
 *
 * Distinct from the chess CLASSICAL piano loop — this is the "fly through hostile
 * space" energy the user asked for. Attaches FFG.createSpaceMusic; loaded as a classic
 * <script> (the 2D shmup is not ESM), so it sets a global rather than exporting.
 * Everything is wrapped so a missing/blocked AudioContext never throws.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};

  FFG.createSpaceMusic = function (volume) {
    var ctx = null, master = null, comp = null, timer = null, playing = false, noiseBuf = null;
    var vol = volume != null ? volume : 0.3;
    var bpm = 150, beat = 60 / bpm, six = beat / 4;            // sixteenth-note
    // A-minor driving loop: Am – F – C – G (one bar each). root = bass MIDI; triad = pad/arp.
    var PROG = [
      { root: 45, triad: [57, 60, 64] }, // Am  (A2 ; A3 C4 E4)
      { root: 41, triad: [53, 57, 60] }, // F   (F2 ; F3 A3 C4)
      { root: 48, triad: [55, 60, 64] }, // C   (C3 ; G3 C4 E4)
      { root: 43, triad: [55, 59, 62] }, // G   (G2 ; G3 B3 D4)
    ];
    var bar = 0, nextTime = 0;
    var hz = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

    function env(g, t, a, dur, peak) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0006, t + a + dur);
    }
    // tuned synth voice through a lowpass
    function synth(freq, t, dur, peak, type, cutoff) {
      var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = type || "sawtooth"; o.frequency.value = freq;
      lp.type = "lowpass"; lp.frequency.value = cutoff || 1600;
      env(g, t, 0.008, dur, peak);
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // synthetic kick — pitch-dropping sine
    function kick(t) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.85, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    }
    // closed hat — short high-passed noise (reuses one cached buffer)
    function hat(t, peak) {
      var n = ctx.createBufferSource(); n.buffer = noiseBuf;
      var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
      var g = ctx.createGain(); g.gain.setValueAtTime(peak || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
      n.connect(hp); hp.connect(g); g.connect(master); n.start(t); n.stop(t + 0.06);
    }

    function scheduleBar(t) {
      var P = PROG[bar % PROG.length];
      // soft pad: full triad held most of the bar
      for (var p = 0; p < P.triad.length; p++) synth(hz(P.triad[p]), t, beat * 3.6, 0.032, "sawtooth", 1100);
      // bass: 16th-note root pulse with an octave hop on the off-16ths
      for (var s = 0; s < 16; s++) {
        var note = P.root + (s % 4 === 2 ? 12 : 0);
        synth(hz(note), t + s * six, six * 1.05, 0.10, "sawtooth", 900);
      }
      // arpeggio: 8th notes rolling the triad an octave up
      var arp = [P.triad[0], P.triad[1], P.triad[2], P.triad[1] + 12, P.triad[2] + 12, P.triad[1] + 12, P.triad[2], P.triad[1]];
      for (var a = 0; a < 8; a++) synth(hz(arp[a] + 12), t + a * (beat / 2), (beat / 2) * 1.3, 0.042, "triangle", 2600);
      // groove: kick on beats 1 & 3, hats on every 8th
      kick(t); kick(t + beat * 2);
      for (var h = 0; h < 8; h++) hat(t + h * (beat / 2), h % 2 ? 0.10 : 0.055);
      // lead motif every 4th bar (A-minor pentatonic) for forward motion
      if (bar % 4 === 3) {
        var lead = [72, 75, 79, 75, 72, 70], ls = beat * 0.66;
        for (var L = 0; L < lead.length; L++) synth(hz(lead[L]), t + L * ls, ls * 1.2, 0.05, "square", 3000);
      }
      bar++;
    }

    function pump() {
      if (!ctx) return;
      while (nextTime < ctx.currentTime + 0.6) { scheduleBar(nextTime); nextTime += beat * 4; }
    }

    return {
      start: function () {
        try {
          ctx = ctx || new (root.AudioContext || root.webkitAudioContext)();
          if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
          if (!noiseBuf) {
            noiseBuf = ctx.createBuffer(1, 2048, ctx.sampleRate);
            var d = noiseBuf.getChannelData(0);
            for (var i = 0; i < 2048; i++) d[i] = Math.random() * 2 - 1;
          }
        } catch (e) { return; }
        if (playing) return;
        try {
          master = ctx.createGain(); master.gain.value = vol;
          comp = ctx.createDynamicsCompressor(); // soft limiter so the stack never clips
          master.connect(comp); comp.connect(ctx.destination);
          nextTime = ctx.currentTime + 0.15; bar = 0; playing = true;
          pump(); timer = setInterval(pump, 160);
        } catch (e) {}
      },
      stop: function () {
        playing = false; if (timer) clearInterval(timer); timer = null;
        try { if (master && ctx) master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4); } catch (e) {}
      },
      setVolume: function (v) { vol = v; try { if (master) master.gain.value = v; } catch (e) {} },
      isPlaying: function () { return playing; },
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
