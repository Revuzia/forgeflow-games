// core/audio/music.js [A9] — R14: FULLY PROCEDURAL Web-Audio score, unique to
// BLACKRIDGE (FFG no-duplicate-music rule, $0, no files). combat_spec §7.5:
//   tense-ambient bed  = D-minor drone 55+110 Hz (detuned saw pairs → LP 400)
//                        + filtered-noise wind + sparse bell pulse every 6–9 s
//   combat layer       = 92 BPM synth kick 4-floor + noise-snare backbeat +
//                        bass stabs on the drone root; high tension arp when
//                        the engagement is heavy (≥4 engaged bots ≈ 2 squads)
//   stingers           = squad-wiped resolve stab · finale riser · death boom
//   mix ceiling        = music ≤ −12 dB vs gun SFX (base levels + gunDuck())
//   menu               = tense bed at −6 dB, combat layer muted
// All ramps linear/setTargetAtTime (AudioParam safety — lane rule).

const BPM = 92;
const BEAT = 60 / BPM;                    // 0.652 s
const ROOT = 55;                          // D-minor root drone (A1=55 ≈ spec's stated 55 Hz)
// D natural-minor bell/arp pools (Hz)
const BELLS = [293.66, 349.23, 440.0, 523.25, 587.33];        // D4 F4 A4 C5 D5
const ARP = [587.33, 698.46, 783.99, 880.0, 1046.5];          // D5 F5 G5 A5 C6

export function makeMusic(env) {
  const { rng, fin, gclamp, err } = env;
  let built = false;
  let modeName = "menu";                  // 'menu' | 'mission' | 'end'
  let out = null;                         // internal master → buses.music
  let duckG = null;                       // gun/death duck
  let bedGain = null, combatGain = null, riserGain = null;
  let droneLP = null;
  let bellT = 0;                          // next bell (ac time)
  let nextBeat = 0;                       // scheduler head (ac time)
  let beatN = 0;                          // running beat counter
  let zeroSince = 0;                      // seconds with zero engaged
  let combatOn = false;
  let arpOn = false;
  let finale = false;
  let testEngaged = null;                 // harness override (audio.selftest)

  const BED_MISSION = 0.07;               // ≈ −18 dB under gun peaks
  const BED_MENU = 0.14;                  // menu bed −6 dB (nothing competes)

  function build() {
    if (built || !env.ac || !env.buses) return;
    built = true;
    const ac = env.ac;
    try {
      out = ac.createGain(); out.gain.value = 1;
      duckG = ac.createGain(); duckG.gain.value = 1;
      duckG.connect(out); out.connect(env.buses.music);

      // ---- tense bed: detuned saw pairs 55 + 110 Hz → LP 400 → breathing gain
      bedGain = ac.createGain(); bedGain.gain.value = 0;
      bedGain.connect(duckG);
      droneLP = ac.createBiquadFilter(); droneLP.type = "lowpass";
      droneLP.frequency.value = 400; droneLP.Q.value = 0.5;
      droneLP.connect(bedGain);
      for (const [f, det, g] of [[ROOT, -5, 0.5], [ROOT, 5, 0.5], [ROOT * 2, -7, 0.32], [ROOT * 2, 7, 0.32]]) {
        const o = ac.createOscillator();
        o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
        const og = ac.createGain(); og.gain.value = g;
        o.connect(og); og.connect(droneLP);
        o.start();
        env.voices++;
      }
      // breathing LFO on the bed
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.05;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.012;
      lfo.connect(lfoG); lfoG.connect(bedGain.gain); lfo.start();
      // wind: filtered noise, very quiet, part of the score bed
      const wind = ac.createBufferSource(); wind.buffer = env.noiseBuf(); wind.loop = true;
      const wf = ac.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 300; wf.Q.value = 0.5;
      const wg = ac.createGain(); wg.gain.value = 0.18;
      wind.connect(wf); wf.connect(wg); wg.connect(bedGain); wind.start();
      env.voices += 2;

      // ---- combat layer master (elements are scheduled per beat)
      combatGain = ac.createGain(); combatGain.gain.value = 0;
      combatGain.connect(duckG);

      // ---- finale riser layer (silent until exfil)
      riserGain = ac.createGain(); riserGain.gain.value = 0;
      riserGain.connect(duckG);
      const r1 = ac.createOscillator(); r1.type = "sawtooth"; r1.frequency.value = 220;
      const r2 = ac.createOscillator(); r2.type = "sawtooth"; r2.frequency.value = 220; r2.detune.value = 9;
      const rf = ac.createBiquadFilter(); rf.type = "lowpass"; rf.frequency.value = 900;
      r1.connect(rf); r2.connect(rf); rf.connect(riserGain);
      r1.start(); r2.start();
      env.voices += 2;

      bellT = ac.currentTime + 2;
      nextBeat = ac.currentTime + BEAT;
    } catch (e) { err(e, "music:build"); }
  }

  // ---- percussion / stab voices (allocated only when scheduled) --------------
  function kick(t) {
    const ac = env.ac;
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(118, t);
    o.frequency.linearRampToValueAtTime(44, t + 0.1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.75, t + 0.006);
    g.gain.linearRampToValueAtTime(0, t + 0.14);
    o.connect(g); g.connect(combatGain);
    o.start(t); o.stop(t + 0.16);
    env.voices++;
  }
  function snare(t) {
    const ac = env.ac;
    const n = ac.createBufferSource(); n.buffer = env.noiseBuf(); n.loop = true; n.loopStart = rng() * 0.4;
    const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.004);
    g.gain.linearRampToValueAtTime(0, t + 0.11);
    n.connect(f); f.connect(g); g.connect(combatGain);
    const b = ac.createOscillator(); b.type = "triangle"; b.frequency.value = 235;
    const bg = ac.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.2, t + 0.004);
    bg.gain.linearRampToValueAtTime(0, t + 0.07);
    b.connect(bg); bg.connect(combatGain);
    n.start(t); n.stop(t + 0.13); b.start(t); b.stop(t + 0.09);
    env.voices += 2;
  }
  function stab(t, f, amp, dur) {
    const ac = env.ac;
    const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = f;
    const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = f; o2.detune.value = 6;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(720, t);
    lp.frequency.linearRampToValueAtTime(180, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(combatGain);
    o1.start(t); o1.stop(t + dur + 0.02); o2.start(t); o2.stop(t + dur + 0.02);
    env.voices += 2;
  }
  function arpNote(t, f) {
    const ac = env.ac;
    const o = ac.createOscillator(); o.type = "square"; o.frequency.value = f;
    const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.006);
    g.gain.linearRampToValueAtTime(0, t + 0.1);
    o.connect(hp); hp.connect(g); g.connect(combatGain);
    o.start(t); o.stop(t + 0.12);
    env.voices++;
  }
  function bell(t) {
    const ac = env.ac;
    const f = BELLS[(rng() * BELLS.length) | 0];
    for (const [mul, amp, dur] of [[1, 0.16, 2.4], [2.76, 0.05, 1.3]]) {
      const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = f * mul;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.01);
      g.gain.linearRampToValueAtTime(amp * 0.25, t + dur * 0.35);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(bedGain);
      o.start(t); o.stop(t + dur + 0.05);
      env.voices++;
    }
    // faint echo: a second, quieter strike (space without a music convolver)
    const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t + 0.42);
    g.gain.linearRampToValueAtTime(0.05, t + 0.43);
    g.gain.linearRampToValueAtTime(0, t + 1.6);
    o.connect(g); g.connect(bedGain);
    o.start(t + 0.42); o.stop(t + 1.65);
    env.voices++;
  }

  // ---- public surface ---------------------------------------------------------
  function start(mode) {
    build();
    if (!built) return;
    modeName = mode === "mission" ? "mission" : mode === "end" ? "end" : "menu";
    testEngaged = null;
    finale = false;
    arpOn = false;
    const t = env.ac.currentTime;
    bedGain.gain.setTargetAtTime(modeName === "menu" ? BED_MENU : BED_MISSION, t, 0.5);
    if (modeName !== "mission") {
      combatOn = false;
      combatGain.gain.setTargetAtTime(0, t, 0.4);
      riserGain.gain.setTargetAtTime(0, t, 0.4);
    }
  }

  function update(dt, engagedCount) {
    if (!built || !env.ac || env.ac.state !== "running") return;
    const ac = env.ac;
    const now = ac.currentTime;
    const engaged = testEngaged != null ? testEngaged : (engagedCount | 0);

    // combat layer gating: IN 1.2 s on first engagement; OUT 5 s after 8 s calm
    if (modeName === "mission" || testEngaged != null) {
      if (engaged > 0) {
        zeroSince = 0;
        if (!combatOn) {
          combatOn = true;
          combatGain.gain.cancelScheduledValues(now);
          combatGain.gain.setTargetAtTime(0.16, now, 0.4);     // ≈1.2 s rise
          nextBeat = Math.max(nextBeat, now + 0.05);
        }
      } else if (combatOn) {
        zeroSince += fin(dt, 0);
        if (zeroSince >= 8) {
          combatOn = false;
          combatGain.gain.setTargetAtTime(0, now, 1.6);        // ≈5 s release
        }
      }
      arpOn = finale || engaged >= 4;                          // ≥2 squads engaged (≈4 bots)
    }

    // beat scheduler (lookahead 0.35 s) — only allocates while audible
    if (combatOn || combatGain.gain.value > 0.003) {
      while (nextBeat < now + 0.35) {
        const t = nextBeat;
        const bar = beatN % 4;
        try {
          kick(t);
          if (bar === 1 || bar === 3) snare(t);
          if (bar === 0) stab(t, ROOT * 2, 0.4, 0.5);          // root stab
          if (bar === 2) stab(t + BEAT * 0.5, ROOT * 3, 0.3, 0.35); // fifth push
          if (arpOn) for (let i = 0; i < 4; i++) arpNote(t + (BEAT / 4) * i, ARP[(beatN + i * 2) % ARP.length]);
        } catch (e) { err(e, "music:beat"); }
        nextBeat += BEAT;
        beatN++;
      }
    } else {
      nextBeat = now + BEAT;                                   // idle: keep head fresh
    }

    // sparse bell pulse every 6–9 s (bed voice)
    if (now >= bellT) {
      bellT = now + 6 + rng() * 3;
      try { bell(now + 0.02); } catch (e) { err(e, "music:bell"); }
    }
  }

  function gunDuck() {
    // guarantee guns own the mix: brief −12 dB-deep dip on every own shot
    if (!built) return;
    try {
      const t = env.ac.currentTime;
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setTargetAtTime(0.55, t, 0.02);
      duckG.gain.setTargetAtTime(1, t + 0.18, 0.5);
    } catch (e) { err(e, "music:duck"); }
  }

  function squadWiped() {
    if (!built) return;
    try {
      const t = env.ac.currentTime + 0.05;
      stab(t, 110, 0.5, 0.4);                                  // A2 …
      stab(t + 0.42, 146.83, 0.55, 0.9);                       // … resolves to D3
    } catch (e) { err(e, "music:wipe"); }
  }

  function playerDeath() {
    if (!built) return;
    try {
      const t = env.ac.currentTime;
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setTargetAtTime(0.25, t, 0.05);
      duckG.gain.setTargetAtTime(1, t + 1.6, 0.6);
      const o = env.ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(52, t);
      o.frequency.linearRampToValueAtTime(30, t + 1.4);
      const g = env.ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + 1.5);
      o.connect(g); g.connect(out);                            // boom bypasses the duck
      o.start(t); o.stop(t + 1.55);
      env.voices++;
    } catch (e) { err(e, "music:death"); }
  }

  function onPhase(d) {
    if (!built || !d) return;
    if (d.phase === "exfil") {
      // finale: rising layer + arp latched on (§7.5 stingers)
      finale = true;
      try {
        const t = env.ac.currentTime;
        riserGain.gain.setTargetAtTime(0.05, t, 2.0);
      } catch (e) { err(e, "music:finale"); }
    }
  }

  // ---- STINGERS (2026-11-13): victory / defeat / draw / lead taken / lead lost /
  // final kill. All synthesized in the score's own D-minor world, routed to `out`
  // (past the gun duck, so a stinger is never swallowed by the last shot) and
  // therefore on the MUSIC bus — the music slider owns them, as in any shooter.
  // brass(): two detuned saws + a square an octave down through a low-pass whose
  // cutoff blooms open on the attack and closes over the note (the "blat").
  function brass(t, f, dur, amp, bloom = 2400, rest = 700) {
    const ac = env.ac;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.1;
    lp.frequency.setValueAtTime(rest * 0.6, t);
    lp.frequency.linearRampToValueAtTime(bloom, t + 0.05);
    lp.frequency.setTargetAtTime(rest, t + 0.06, Math.max(0.05, dur * 0.35));
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gclamp(amp), t + 0.025);
    g.gain.setTargetAtTime(gclamp(amp * 0.7), t + 0.05, 0.12);
    g.gain.setValueAtTime(gclamp(amp * 0.7), t + Math.max(0.08, dur - 0.12));
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g); g.connect(out);
    for (const [type, mul, det, lvl] of [["sawtooth", 1, -6, 0.5], ["sawtooth", 1, 6, 0.5], ["square", 0.5, 0, 0.22]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = det;
      const og = ac.createGain(); og.gain.value = lvl;
      o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + dur + 0.03);
      env.voices++;
    }
  }
  function timp(t, f, amp, dur = 0.7) {
    const ac = env.ac;
    const o = ac.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gclamp(amp), t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.02, dur / 4);
    g.gain.setValueAtTime(0.0001, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
    env.voices++;
  }
  function pad(t, freqs, dur, amp) {
    const ac = env.ac;
    for (const f of freqs) {
      const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gclamp(amp), t + Math.min(0.8, dur * 0.3));
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
      env.voices++;
    }
  }
  const stingLast = {};
  let stingCount = 0;
  function stinger(kind) {
    if (!built) return false;
    const t = env.ac.currentTime + 0.03;
    // lead cues are rate-limited (a trade of kills can flip the lead every tick)
    if ((kind === "leadTaken" || kind === "leadLost") && t - (stingLast.lead || -99) < 4) return false;
    if (kind === "leadTaken" || kind === "leadLost") stingLast.lead = t;
    try {
      if (kind === "victory") {
        // D major fanfare: D4 A4 → D5 held over F#4/A4, timpani under it
        timp(t, 73.4, 0.5); brass(t, 293.66, 0.2, 0.15);
        brass(t + 0.2, 440.0, 0.2, 0.15);
        timp(t + 0.42, 73.4, 0.55, 1.2);
        brass(t + 0.42, 587.33, 1.7, 0.16, 2800, 900);
        brass(t + 0.42, 369.99, 1.7, 0.1, 2000, 700);
        brass(t + 0.42, 440.0, 1.7, 0.09, 2000, 700);
        pad(t + 0.4, [146.83, 220.0], 2.8, 0.06);
      } else if (kind === "defeat") {
        // D minor, falling: D3 → C3 → B♭2 over a low boom, dark and slow
        timp(t, 55, 0.55, 1.4);
        brass(t, 146.83, 0.55, 0.12, 900, 380);
        brass(t + 0.55, 130.81, 0.55, 0.12, 850, 360);
        brass(t + 1.1, 116.54, 1.9, 0.13, 800, 320);
        brass(t + 1.1, 174.61, 1.9, 0.07, 700, 300);                // F3 over it: minor
        pad(t + 1.0, [58.27, 87.31], 2.6, 0.07);
      } else if (kind === "draw") {
        // suspended, unresolved: D-G-A
        timp(t, 65.4, 0.35, 0.9);
        brass(t, 293.66, 1.4, 0.1, 1600, 600);
        brass(t, 392.0, 1.4, 0.08, 1600, 600);
        brass(t, 440.0, 1.4, 0.07, 1600, 600);
      } else if (kind === "leadTaken") {
        // two quick rising hits: A4 → D5
        brass(t, 440.0, 0.12, 0.11, 2600, 900);
        brass(t + 0.12, 587.33, 0.38, 0.12, 2800, 900);
        timp(t + 0.12, 73.4, 0.28, 0.5);
      } else if (kind === "leadLost") {
        // two muted falling notes: F4 → D4, low and closed
        brass(t, 349.23, 0.16, 0.09, 1100, 500);
        brass(t + 0.16, 293.66, 0.45, 0.09, 900, 420);
        timp(t + 0.16, 55, 0.25, 0.6);
      } else if (kind === "finalKill") {
        // the last kill of the match: a reversed-air rush into one big hit
        const ac = env.ac;
        const n = ac.createBufferSource(); n.buffer = env.noiseBuf(); n.loop = true;
        const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.linearRampToValueAtTime(2600, t + 0.45);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.44);
        g.gain.linearRampToValueAtTime(0, t + 0.47);
        n.connect(bp); bp.connect(g); g.connect(out);
        n.start(t); n.stop(t + 0.5);
        env.voices++;
        timp(t + 0.47, 49, 0.7, 1.6);
        brass(t + 0.47, 146.83, 1.2, 0.14, 1800, 500);
        brass(t + 0.47, 220.0, 1.2, 0.1, 1800, 500);
      } else return false;
      stingCount++;
      return true;
    } catch (e) { err(e, "music:sting:" + kind); return false; }
  }

  // result: true/"won" | false/"lost" | "draw"
  function missionEnd(won, opts) {
    if (!built) return;
    try {
      const t = env.ac.currentTime;
      combatOn = false;
      combatGain.gain.setTargetAtTime(0, t, 0.6);
      riserGain.gain.setTargetAtTime(0, t, 0.6);
      const draw = won === "draw";
      const isWin = won === true || won === "won";
      const delay = opts && opts.finalKill ? 1.25 : 0;
      if (opts && opts.finalKill) stinger("finalKill");
      const play = () => stinger(draw ? "draw" : isWin ? "victory" : "defeat");
      if (delay > 0) setTimeout(() => { try { play(); } catch (e) { err(e, "music:end2"); } }, delay * 1000);
      else play();
      if (!isWin && !draw) {
        // the defeat also drops the world away (the old death boom path)
        duckG.gain.cancelScheduledValues(t);
        duckG.gain.setTargetAtTime(0.25, t, 0.05);
        duckG.gain.setTargetAtTime(1, t + 2.4, 0.6);
      }
      modeName = "end";
      bedGain.gain.setTargetAtTime(BED_MENU, t + 2.5, 1.0);
    } catch (e) { err(e, "music:end"); }
  }

  return {
    start, update, gunDuck, squadWiped, playerDeath, onPhase, missionEnd, stinger,
    stingCount: () => stingCount,
    setEngagedForTest: (n) => { testEngaged = n == null ? null : (n | 0); },
    mode: () => modeName + (combatOn ? "+combat" : "") + (arpOn ? "+arp" : ""),
  };
}
