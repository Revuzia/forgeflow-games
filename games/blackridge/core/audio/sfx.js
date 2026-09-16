// core/audio/sfx.js [A9] — 3-layer gunshot stack (mech synth + recorded body +
// zone-convolved tail), distance rings with dist/343 playback delay (§7.2),
// whiz-by cracks, per-surface impacts + footsteps on the frozen §3.14 surface
// vocabulary, reload foley at animation beats (§7.4), hitmarker/UI cues (§4.1),
// grenade/explosion chain (R6/R13), bark radio-squelch (§5.10 honesty rule).
//
// Every recorded call site keeps a synth fallback (degrade to synth, never to
// silence — §7 header rule). All ramps linear/setTargetAtTime; every computed
// value goes through env.fin/gclamp (AudioParam safety, lane rule).
//
// Shot-event convention (A1 wave-1, architecture changelog): bang/muzzle only
// when neither `impactOnly` nor `pen` is set; impact cues for ANY non-null
// hit; hitmarker cues for player shots with hit.entity (impactOnly included,
// pen excluded — pen entity is always null anyway).

import { FIRST_SHOT, RELOAD_MODEL } from "../weapons/weapon_data.js";

// name → file list under assets/audio/ (multiple = round-robin takes).
// FFSL/Kenney slices via games/last-circle (CC0); svd_* sliced from Sonniss
// GDC 2024 "Dramatic Cat - SVD Dragunov"; expl_* from "DavidDumais -
// Explosion SFX Pack". Provenance + licenses: assets/manifest.a9.json.
const FILES = {
  gun_warden: ["sfx/shot_ar_0.ogg", "sfx/shot_ar_1.ogg", "sfx/shot_ar_2.ogg"],
  gun_vesper: ["sfx/shot_smg_0.ogg", "sfx/shot_smg_1.ogg", "sfx/shot_smg_2.ogg"],
  gun_corvus: ["sfx/svd_shot_0.ogg", "sfx/shot_sniper_0.ogg", "sfx/shot_sniper_1.ogg", "sfx/shot_sniper_2.ogg"],
  gun_pike: ["sfx/shot_pistol_0.ogg", "sfx/shot_pistol_1.ogg"],
  step_concrete: ["sfx/step_concrete_000.ogg", "sfx/step_concrete_001.ogg", "sfx/step_concrete_002.ogg", "sfx/step_concrete_003.ogg"],
  step_dirt: ["sfx/step_grass_000.ogg", "sfx/step_grass_001.ogg", "sfx/step_grass_002.ogg", "sfx/step_grass_003.ogg"],
  step_wood: ["sfx/step_wood_000.ogg", "sfx/step_wood_001.ogg", "sfx/step_wood_002.ogg", "sfx/step_wood_003.ogg"],
  step_metal: ["sfx/impactPlate_light_000.ogg", "sfx/impactPlate_light_001.ogg", "sfx/impactPlate_light_002.ogg"],
  step_glass: ["sfx/impactGlass_light_000.ogg", "sfx/impactGlass_light_001.ogg", "sfx/impactGlass_light_002.ogg"],
  imp_concrete: ["sfx/impactGeneric_light_000.ogg", "sfx/impactGeneric_light_001.ogg", "sfx/impactGeneric_light_002.ogg"],
  imp_metal: ["sfx/impactMetal_light_000.ogg", "sfx/impactMetal_light_001.ogg", "sfx/impactMetal_light_002.ogg"],
  imp_wood: ["sfx/impactPlank_medium_000.ogg", "sfx/impactPlank_medium_001.ogg", "sfx/impactPlank_medium_002.ogg"],
  imp_glass: ["sfx/impactGlass_light_000.ogg", "sfx/impactGlass_light_001.ogg", "sfx/impactGlass_light_002.ogg"],
  imp_dirt: ["sfx/impactGeneric_light_000.ogg", "sfx/impactGeneric_light_001.ogg", "sfx/impactGeneric_light_002.ogg"],
  mag_out: ["sfx/beltHandle1.ogg", "sfx/dropLeather.ogg"],
  mag_in: ["sfx/beltHandle2.ogg"],
  mag_in_corvus: ["sfx/svd_mag.ogg"],
  rack: ["sfx/metalLatch.ogg", "sfx/metalClick.ogg"],
  click: ["sfx/metalClick.ogg"],
  cloth: ["sfx/cloth1.ogg", "sfx/cloth2.ogg"],
  expl_frag: ["oneshots/expl_frag.ogg"],
  expl_large: ["oneshots/expl_large.ogg"],
  ui_click: ["sfx/ui_click_001.ogg", "sfx/ui_click_002.ogg"],
  ui_back: ["sfx/ui_back_001.ogg"],
  ui_confirm: ["sfx/ui_confirmation_001.ogg"],
  ui_error: ["sfx/ui_error_001.ogg"],
};

// per-weapon mechanical-layer character (§7.1 table)
const MECH = {
  warden: { kind: "double", f: 4200, durMs: 8, gapMs: 14, gain: 1.0 },   // tight double-click
  vesper: { kind: "single", f: 4800, durMs: 12, gapMs: 0, gain: 0.85 },  // buzzy short
  corvus: { kind: "bolt", f: 1600, durMs: 42, gapMs: 90, gain: 1.5 },    // heavy bolt CHUNK
  pike: { kind: "slide", f: 3500, durMs: 9, gapMs: 25, gain: 0.9 },      // crisp slide
};

// §7.3 shooter-tail send (2026-09-16 retune — see the tail block in bang() for
// the full audit). TAIL_SEND is the single base that replaced the old per-ring
// ladder 0.5 / 0.7 / 0.5; TAIL_SEND_EXP is the outdoor send exponent, applied to
// the shot's own distance gain so the tail falls SLOWER than the direct report
// (vol^0.6 against a direct of vol^1.4) instead of not falling at all.
const TAIL_SEND = 0.55;
const TAIL_SEND_EXP = 0.6;
// Air absorption is ~5 dB/km at 1 kHz but ~24 dB/km at 3 kHz, so a distant tail
// is a low thump, never a bright hiss. The send gets its own lowpass because the
// tap point (bodySrc) is upstream of the ring filters.
const TAIL_LP_NEAR_HZ = 6000;   // corner at/inside 30 m
const TAIL_LP_FAR_HZ = 900;     // corner at/beyond 250 m
const TAIL_LP_FAR_M = 250;
const TAIL_LP_NEAR_M = 30;
// The ring-2 SYNTHESIZED tail is a tail too, so it obeys the same law as the
// convolver send above. It is spawned into the spatial node, which already
// scales it by vol^1.0, so this tilt of vol^(0.6−1) = vol^−0.4 leaves it at
// vol^0.6 — one exponent governing both tail paths instead of two behaviours.
// Capped at +6 dB (reached at ≈228 m): un-capped, vol^−0.4 keeps climbing and
// re-creates the very pathology this retune removes — a tail nearly as loud as
// an almost inaudible report at the edge of the world.
const TAIL_TILT_MAX = 2.0;

const STEP_ALIAS = { concrete: "step_concrete", dirt: "step_dirt", wood: "step_wood", metal: "step_metal", glass: "step_glass" };
const IMP_ALIAS = { concrete: "imp_concrete", metal: "imp_metal", wood: "imp_wood", glass: "imp_glass", dirt: "imp_dirt" };

export function makeSfx(env) {
  const { rng, fin, gclamp, err } = env;
  const buffers = {};            // name → AudioBuffer[]
  let decoded = 0;
  let loading = false;
  const pendingReload = new Map(); // who → [scheduled sources]
  let liveVoices = 0;            // gun-voice budget
  let lastBark = -10;

  const takeIdx = {};
  function buf(name) {
    const list = buffers[name];
    if (!list || !list.length) return null;
    // random take, but never the same twice in a row when >1 exist
    let i = (rng() * list.length) | 0;
    if (list.length > 1 && i === takeIdx[name]) i = (i + 1) % list.length;
    takeIdx[name] = i;
    return list[i];
  }

  function loadBuffers() {
    if (loading || !env.ac) return;
    loading = true;
    const base = typeof document !== "undefined" ? document.baseURI : "";
    for (const name of Object.keys(FILES)) {
      buffers[name] = [];
      for (const rel of FILES[name]) {
        const url = new URL("assets/audio/" + rel, base).href;
        fetch(url)
          .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status + " " + rel); return r.arrayBuffer(); })
          .then((ab) => env.ac.decodeAudioData(ab))
          .then((b) => { buffers[name].push(b); decoded++; })
          .catch((e) => err(e, "decode:" + rel)); // synth fallback stands
      }
    }
  }

  // ---- tiny voice builders ---------------------------------------------------
  function voice(buffer, out, { rate = 1, gain = 1, when = 0, lp = 0, hp = 0 } = {}) {
    const ac = env.ac;
    if (!buffer || !out) return null;
    try {
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = fin(rate, 1);
      const g = ac.createGain();
      g.gain.value = gclamp(gain);
      let head = src;
      if (lp) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = fin(lp, 20000); head.connect(f); head = f; }
      if (hp) { const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = fin(hp, 20); head.connect(f); head = f; }
      head.connect(g); g.connect(out);
      liveVoices++; env.voices++;
      src.onended = () => { liveVoices = Math.max(0, liveVoices - 1); };
      src.start(Math.max(ac.currentTime, ac.currentTime + fin(when, 0)));
      return src;
    } catch (e) { err(e, "voice"); return null; }
  }

  // band-passed noise burst — the synth workhorse (mech layers, whiz, squelch)
  //
  // `decayMs` (2026-09-16, added for the ring-2 distant tail) is OPT-IN: leave it
  // unset and the envelope is bit-identical to the old linear one, so every other
  // caller — mech layers, whiz, squelch, grenade, empty, impacts — is untouched.
  // Set it and the release becomes an exponential with that time constant.
  // Why it exists: a LINEAR ramp to zero is still at −6 dB half way through and
  // reaches zero with energy still present, so it reads as a sustained hiss that
  // stops on an audible corner, not as a decay. A real tail is exponential.
  function burst(out, { f = 2000, q = 4, durMs = 30, gain = 0.2, when = 0, sweepTo = 0, decayMs = 0 } = {}) {
    const ac = env.ac;
    if (!out) return;
    try {
      const t0 = ac.currentTime + Math.max(0, fin(when, 0));
      const dur = Math.max(0.004, fin(durMs, 30) / 1000);
      const src = ac.createBufferSource();
      src.buffer = env.noiseBuf();
      src.loop = true;
      src.loopStart = rng() * 0.5;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = fin(f, 2000); bp.Q.value = fin(q, 4);
      if (sweepTo) bp.frequency.linearRampToValueAtTime(fin(sweepTo, f), t0 + dur);
      const g = ac.createGain();
      const atk = Math.min(0.004, dur * 0.25);
      const pk = gclamp(gain);
      const tau = Math.max(0, fin(decayMs, 0)) / 1000;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(pk, t0 + atk);
      if (tau > 0.001 && dur > atk + 0.05) {
        // setTargetAtTime only — the lane forbids exponentialRampToValueAtTime
        // (it throws near 0). The last 30 ms is pinned to the exact value the
        // exponential has reached and then linear-ramped to true zero, so the
        // voice is silent at stop() with no step and no residual.
        g.gain.setTargetAtTime(0, t0 + atk, tau);
        g.gain.setValueAtTime(gclamp(pk * Math.exp(-(dur - 0.03 - atk) / tau)), t0 + dur - 0.03);
      }
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      src.connect(bp); bp.connect(g); g.connect(out);
      env.voices++;
      src.start(t0); src.stop(t0 + dur + 0.02);
    } catch (e) { err(e, "burst"); }
  }

  // decaying sine thump (landings, kill thock, explosion sub, heart of synth body)
  function thump(out, { f0 = 90, f1 = 0, durMs = 120, gain = 0.3, when = 0, type = "sine" } = {}) {
    const ac = env.ac;
    if (!out) return;
    try {
      const t0 = ac.currentTime + Math.max(0, fin(when, 0));
      const dur = Math.max(0.02, fin(durMs, 120) / 1000);
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(fin(f0, 90), t0);
      if (f1) o.frequency.linearRampToValueAtTime(fin(f1, f0), t0 + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gclamp(gain), t0 + 0.006);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g); g.connect(out);
      env.voices++;
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { err(e, "thump"); }
  }

  function camPos() {
    const c = env.ctx.camera;
    if (!c) return [0, 1.6, 0];
    const e = c.matrixWorld.elements;
    return [fin(e[12], 0), fin(e[13], 1.6), fin(e[14], 0)];
  }

  // UI path: post-reverb-send (never positional, never reverbed — §4.1)
  function uiOut(gain) {
    const ac = env.ac;
    const g = ac.createGain();
    g.gain.value = gclamp(gain);
    g.connect(env.buses.sfx);
    return g;
  }

  // ---- gunshots (§7.1 / §7.2 / §2.8) ----------------------------------------

  // Distant-tail pooling (2026-09-16). Overlapping incoherent tails sum at
  // 10·log10(N) with N = tailLength × rpm / 60, so ONE ring-2 bot on full auto
  // was stacking its own tails into a continuous bed: at 800 rpm and the old
  // 1.3–1.7 s length, N = 20 → +13 dB of self-built-up hiss under its own fire.
  // Holding accumulation to the +6 dB ceiling means tailLength ≤ 240/rpm s,
  // which at 800 rpm is 300 ms — shorter than a distant tail is allowed to be.
  // So the tails get POOLED instead of shortened past usefulness: one tail per
  // shooter per TAIL_SLOT_S. At the new 0.55–0.85 s length that is N ≈ 3.2 →
  // +5.1 dB, inside the ceiling. 220 ms is well under any human trigger-pull
  // interval, so semi-auto and bolt fire are never throttled — only sustained
  // automatic fire from one shooter is.
  const TAIL_SLOT_S = 0.22;
  const lastTail = new Map();   // shooter id → ac time of its last ring-2 tail
  function tailSlot(shooter, when) {
    const t = env.ac.currentTime + Math.max(0, fin(when, 0));
    const prev = lastTail.get(shooter);
    if (prev != null && t - prev < TAIL_SLOT_S && t >= prev) return false;
    lastTail.set(shooter, t);
    if (lastTail.size > 32) {                       // bounded: drop stale ids
      for (const [k, v] of lastTail) if (t - v > 5) lastTail.delete(k);
    }
    return true;
  }

  function bang(d) {
    const ac = env.ac;
    const own = d.shooter === "P";
    const origin = d.origin || camPos();
    let dist = 0;
    if (!own) {
      const c = camPos();
      dist = Math.hypot(origin[0] - c[0], (origin[1] || 0) - c[1], origin[2] - c[2]);
      if (!Number.isFinite(dist) || dist > 300) return;
    }
    const ring = own || dist < 30 ? 0 : dist < 90 ? 1 : 2;
    // voice budget: under load distant fire degrades to crack-only, never player
    if (!own && liveVoices > 40) return;
    const degraded = !own && liveVoices > 24;

    const when = own ? 0 : dist / 343;              // audible flight delay (§7.2)
    const out = env.spatial(own ? null : origin, 320);
    if (!out) return;
    // The honest distance gain, captured BEFORE the ring-2 mix boost below: the
    // tail send and the tail duck are keyed off physics, not off a mix decision.
    const spatialVol = Math.max(0, fin(out.gain.value, 1));
    if (ring === 2) out.gain.value = gclamp(out.gain.value * 1.26); // night-quiet +2 dB

    // zones-differ + no-LOS muffle (§7.3): boom through the door
    const shooterZone = env.zoneOf(origin[0], (origin[1] || 0), origin[2]);
    let dst = out;
    if (!own && shooterZone !== env.cameraZone && env.losBlocked(origin, camPos())) {
      const f = ac.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 900;
      f.connect(out); dst = f;
    }

    const first = !!d.firstShot;
    // mechanical layer — synth, per-weapon character; rings 0-1 only
    if (ring < 2 && !degraded) {
      const m = MECH[d.weaponId] || MECH.warden;
      let mg = 0.14 * m.gain * (own ? 1.41 : 1);              // player's own action +3 dB
      if (first) mg *= Math.pow(10, (FIRST_SHOT.mechLayerDb || 2) / 20);
      if (ring === 1) mg *= 0.25;                              // −12 dB at 30–90 m
      const durMul = first ? (FIRST_SHOT.transientLenMult || 1.15) : 1;
      const dur = m.durMs * durMul;
      if (m.kind === "double") {
        burst(dst, { f: m.f, q: 6, durMs: dur, gain: mg, when });
        burst(dst, { f: m.f * 0.85, q: 6, durMs: dur, gain: mg * 0.8, when: when + m.gapMs / 1000 });
      } else if (m.kind === "bolt") {
        burst(dst, { f: m.f, q: 2, durMs: dur, gain: mg, when });
        burst(dst, { f: 2800, q: 10, durMs: 18, gain: mg * 0.35, when });         // metallic ping
        burst(dst, { f: m.f * 1.3, q: 3, durMs: dur * 0.7, gain: mg * 0.7, when: when + m.gapMs / 1000 }); // action cycles
      } else if (m.kind === "slide") {
        burst(dst, { f: m.f, q: 5, durMs: dur, gain: mg, when });
        burst(dst, { f: 5200, q: 7, durMs: 7, gain: mg * 0.5, when: when + m.gapMs / 1000 });
      } else {
        burst(dst, { f: m.f, q: 5, durMs: dur, gain: mg, when });
      }
      // spring rattle tail on autos
      if (d.weaponId === "warden" || d.weaponId === "vesper") {
        burst(dst, { f: 5600, q: 3, durMs: 22, gain: mg * 0.25, when: when + 0.006 });
      }
    }

    // body layer — recorded take ±6% rate/gain jitter (§7.1 decorrelation)
    const b = buf("gun_" + d.weaponId) || buf("gun_warden");
    const bodyGain = (own ? 0.7 : 0.6) * (1 + (rng() * 2 - 1) * 0.06);
    const bodyRate = 1 + (rng() * 2 - 1) * 0.06;
    let bodySrc = null;
    if (b && !degraded) {
      bodySrc = voice(b, dst, {
        rate: bodyRate, gain: bodyGain, when,
        lp: ring === 2 ? 1400 : 0,                             // body-only ring
        hp: ring === 1 ? 700 : 0,                              // crack-dominant ring
      });
    } else {
      // synth fallback: boom + crack
      thump(dst, { f0: 170, f1: 62, durMs: ring === 2 ? 160 : 110, gain: bodyGain * 0.5, when });
      if (ring < 2) burst(dst, { f: 1300, q: 1.2, durMs: 45, gain: bodyGain * 0.45, when });
    }

    // tail layer — shooter's-zone convolver (§7.3 shooter-tail rule).
    //
    // RETUNE 2026-09-16 — owner: "the ECHO of the weapon firing AFTER the fact is
    // TOO loud." Four defects, every one of them measured through
    // _harness/tailprobe.html against the live graph:
    //
    // (a) DOUBLE-FEED on your own weapon. audio.js already wires the WHOLE dry
    //     bus into the CAMERA zone's convolver (`sfxDry.connect(send);
    //     send.connect(conv)` with send = 1 for the camera zone). You ARE the
    //     camera, so your own shot's body reaches the exterior convolver at full
    //     level through the listener bed before this line runs; the explicit tap
    //     then added 0.40 more on top of a 0.70 body — 1.10 of a signal whose
    //     whole is 0.70. That is the one knob the complaint is actually about.
    //     OLD own send (ring 0) 0.5 × 0.8 = 0.40 → NEW 0. The listener bed IS the
    //     own-weapon tail; nothing is added to it. −3.9 dB of convolver drive on
    //     every shot the player fires, at zero cost to anyone else's tail.
    //     Deliberately KEPT for other shooters: their explicit send is the
    //     distance-independent reverberant-field term and it is the only reason a
    //     firefight at range reads as "mostly tail". Deleting it there would
    //     flatten the spatial cue, which is the opposite of the brief.
    //
    // (b) NO DISTANCE SCALING AT ALL. Measured on the isolated tail branch
    //     (warden bot, exterior, 4 pulls, peak dBFS): 5 m −40.3, 30 m −37.4,
    //     60 m −37.4, 120 m −39.7, 200 m −39.8, 295 m −39.8 — flat within 3 dB
    //     while the direct report fell 27 dB across the same span. A shot at
    //     295 m drove the convolver exactly as hard as one at 5 m. The fix is
    //     NOT a constant: outdoors the tail must fall SLOWER than the direct,
    //     not not-at-all, so the send takes the shot's own distance gain raised
    //     to TAIL_SEND_EXP (0.6) against a direct that falls as vol^1.4. Net
    //     tail-to-direct still RISES with range — about +0.5 dB at 30 m, +6.8 dB
    //     at 250 m — but bounded instead of running away to −9 dB under an
    //     almost inaudible report at 295 m.
    //
    // (c) RING STEPS. OLD 0.5 / 0.7 / 0.5 by ring put a +2.9 dB tail jump at the
    //     30 m boundary and a −2.9 dB drop at 90 m: a bot walking one metre
    //     changed its own echo. The continuous curve replaces the ladder, so both
    //     boundaries are now smooth. TAIL_SEND 0.55 sits between the old 0.5 and
    //     0.7; after the distance term the send lands at 0.54 @5 m (was 0.50),
    //     0.51 @30 m (was 0.70), 0.46 @60 m (was 0.70), 0.42 @90 m (was 0.50),
    //     0.32 @150 m, 0.16 @250 m, 0.06 @295 m.
    //
    // (d) THE TAP IS PRE-FILTER. `bodySrc` is the raw BufferSource — upstream of
    //     the ring-2 lp 1400, the ring-1 hp 700 and the no-LOS 900 Hz muffle — so
    //     the tail carried full 3–6 kHz content at any range. Brightness is the
    //     fastest "this is fake" tell there is: air absorption is ~5 dB/km at
    //     1 kHz but ~24 dB/km at 3 kHz, so a distant tail is physically a low
    //     thump. The send therefore gets its own lowpass, 6 kHz at 30 m → 900 Hz
    //     at 250 m, log-interpolated, inserted only past 30 m so close shots pay
    //     no node cost.
    const conv = env.tailIn(shooterZone);
    if (conv && bodySrc && !own) {
      try {
        const tg = ac.createGain();
        tg.gain.value = gclamp(TAIL_SEND * Math.pow(spatialVol, TAIL_SEND_EXP));
        let tsrc = bodySrc;
        if (dist > TAIL_LP_NEAR_M) {
          const k = Math.min(1, (dist - TAIL_LP_NEAR_M) / (TAIL_LP_FAR_M - TAIL_LP_NEAR_M));
          const f = ac.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = fin(TAIL_LP_NEAR_HZ * Math.pow(TAIL_LP_FAR_HZ / TAIL_LP_NEAR_HZ, k), TAIL_LP_NEAR_HZ);
          bodySrc.connect(f); tsrc = f;
        }
        tsrc.connect(tg); tg.connect(conv);
      } catch (e) { err(e, "tail"); }
    }
    // Reverb-RETURN ducking, keyed off the shot that causes it (Web Audio has no
    // side-chain). Stops sustained fire from stacking its own tails into mush
    // without making a single shot any drier — see tailDuck() in audio.js for the
    // measured +25.5 dB build-up this exists to stop.
    if (env.tailDuck) env.tailDuck(shooterZone, when, own ? 1 : spatialVol);
    if (ring === 2 && tailSlot(d.shooter, when)) {
      // distant tail — the convolver zones are short; synthesize it. Three
      // measured faults fixed here, all on a clean single-shot take (pike, whose
      // two takes are the only gun bodies with no extra reports baked in):
      //  * LENGTH. Measured audible tail (t60) was 1432 ms at 120 m and 1273 ms
      //    at 200 m. A night street canyon is 400–900 ms; 1.3–1.7 s is open
      //    terrain or a mountain valley. OLD durMs 1300 + rng()×400 (1.3–1.7 s)
      //    → NEW 550 + rng()×300 (0.55–0.85 s).
      //  * ENVELOPE — the bigger error. burst()'s default release is LINEAR,
      //    which is −6 dB only at the half-way point (650–850 ms on the old
      //    length) and quits with energy still present. Perceptually that is a
      //    flat hiss ending on a corner, equivalent to an exponential RT60 of
      //    several seconds. NEW decayMs = dur/5 makes it a true exponential:
      //    −6 dB at ~140 ms, −43 dB by the end, no corner.
      //  * TIMBRE. OLD f 420 Hz → NEW 340 Hz. Distance strips highs; the tail
      //    has to sit below the body it belongs to, not beside it.
      // BASE PEAK GAIN IS DELIBERATELY UNCHANGED at 0.10. The brief is to keep
      // the distant tail — it is what makes a firefight read spatially — and the
      // length/envelope fix already removes ~8 dB of tail ENERGY on its own.
      // TAIL_TILT is the distance law, not a level change: without it the
      // measured tail-to-direct ratio came out dead flat at −24 dB from 5 m to
      // 295 m, i.e. the tail tracked the report exactly and carried no distance
      // information at all. With it the ratio rises with range the way a real
      // reverberant field does, bounded at +6 dB.
      const dur = 550 + rng() * 300;
      const tilt = Math.min(TAIL_TILT_MAX, Math.pow(Math.max(1e-4, spatialVol), TAIL_SEND_EXP - 1));
      burst(dst, { f: 340, q: 0.7, durMs: dur, decayMs: dur / 5, gain: 0.10 * tilt, when: when + 0.03 });
    }

    if (own && env.music) env.music.gunDuck();                 // guns own the mix
    if (first && own && ring === 0) {
      // first-shot pop: tiny sub emphasis under the mech pop (§2.8)
      thump(dst, { f0: 95, f1: 55, durMs: 70, gain: 0.18, when });
    }
  }

  function impact(hit, d) {
    const s = hit.surface;
    if (s === "flesh") {
      // wet thap — synth only (restrained; no recorded gore)
      const out = env.spatial(hit.pos, 40);
      if (!out) return;
      burst(out, { f: 750, q: 1.4, durMs: 26, gain: 0.24 });
      thump(out, { f0: 150, f1: 90, durMs: 60, gain: 0.16 });
      return;
    }
    const out = env.spatial(hit.pos, 45);
    if (!out) return;
    const name = IMP_ALIAS[s] || "imp_concrete";
    const b = buf(name);
    if (b) voice(b, out, { rate: 1 + (rng() * 2 - 1) * 0.1, gain: s === "metal" ? 0.3 : 0.26, lp: s === "dirt" ? 1800 : 0 });
    else burst(out, { f: s === "metal" ? 2600 : 1400, q: 2, durMs: 40, gain: 0.2 });
    if (s === "metal") {
      // ring 2.8 kHz (§4.2 imp_metal character)
      thump(out, { f0: 2800, f1: 2740, durMs: 240, gain: 0.05, type: "sine" });
    }
  }

  function hitTick(head) {
    // §4.1: 2.4 kHz band-limited click 30 ms (−14 dB), headshot 3.1 kHz. UI bus.
    burst(uiOut(1), { f: head ? 3100 : 2400, q: 8, durMs: 30, gain: 0.18 });
  }

  // ---- handlers ---------------------------------------------------------------
  function onShot(d) {
    if (!d) return;
    if (!d.impactOnly && !d.pen) bang(d);
    if (d.hit && d.hit.pos && d.hit.surface) impact(d.hit, d);
    if (d.shooter === "P" && d.hit && d.hit.entity != null && !d.pen) hitTick(d.hit.part === "head");
  }

  // The "step" event is now DISTANCE-based (core/sim/player.js STRIDE): a
  // footfall every strideLength() metres of ground covered, so the measured
  // cadence went 1.85 → 3.27 Hz at walk and 2.60 → 3.54 Hz at sprint. Two
  // consequences land here.
  //
  // 1. Per-second footstep ENERGY rose ~1.8× (≈ +2.5 dB) with no change to any
  //    per-step level. STEP_CADENCE_TRIM takes a flat −1.4 dB off every step
  //    voice so the footstep bed sits near its tuned loudness while still
  //    netting ~+1 dB denser than before. It is applied UNIFORMLY, so every
  //    §7.4 relative differential is untouched: sprint stays +3 dB, crouch
  //    −8 dB, the player's own steps −10 dB vs bots. Set it to 1 to get the
  //    old per-step level back — this is the one knob, nothing else moved.
  // 2. At 10 bots × 3.5 Hz the step path can now out-allocate the gun path, so
  //    remote steps take the same liveVoices budget gate onShot() uses.
  const STEP_CADENCE_TRIM = 0.85;

  function onStep(d) {
    if (!d) return;
    const own = d.who === "P";
    // voice budget: under load distant footsteps drop, the player's never do
    if (!own && liveVoices > 40) return;
    let out, gain;
    // stance now rides the event (the stance at the FOOT-PLANT, and it works
    // for bots too); fall back to the live sim read for any older emitter.
    let crouched = d.stance === "crouch";
    if (own) {
      out = env.spatial(null);
      gain = 0.12 * (d.sprint ? 1.41 : 1);                     // −10 dB vs bots (§7.4)
      if (d.stance == null) {
        const st = env.ctx.sim() && env.ctx.sim().state;
        crouched = !!(st && st.player && st.player.stance === "crouch");
      }
      if (crouched) gain *= 0.4;                               // −8 dB
    } else {
      const p = env.botPos(d.who);
      if (!p) return;
      out = env.spatial(p, 30);
      if (!out) return;
      gain = 0.38 * (d.sprint ? 1.41 : 1);
      // NOTE: bots deliberately keep the FULL level when crouched. §7.4's
      // −8 dB crouch row has only ever applied to the player's own steps, and
      // quietening crouched bots by 8 dB is a stealth-balance change, not a
      // gait-feel one. Left alone on purpose — see the lane report.
    }
    if (!out) return;
    gain *= STEP_CADENCE_TRIM;
    // left and right foot do not sound identical on a real body, and at 3.3 Hz
    // an unbiased take pool reads as one repeated sample. A fixed ±2.8% pitch
    // bias by foot rides UNDER the existing ±8% take jitter — the two feet
    // stay obviously the same boots, they just stop being the same recording.
    const footBias = d.foot === "L" ? 0.972 : d.foot === "R" ? 1.028 : 1;
    const name = STEP_ALIAS[d.surface] || "step_concrete";
    const b = buf(name);
    if (b) {
      const isImp = name === "step_metal" || name === "step_glass"; // repurposed takes
      voice(b, out, { rate: (1 + (rng() * 2 - 1) * 0.08) * footBias * (isImp ? 1.25 : 1), gain: gain * (isImp ? 0.5 : 1), lp: isImp ? 3200 : 0 });
    } else {
      burst(out, { f: (900 + rng() * 300) * footBias, q: 1, durMs: 28, gain: gain * 0.5 });
    }
  }

  function onReload(d) {
    if (!d) return;
    const own = d.who === "P";
    const key = d.who;
    if (d.phase === "done") {
      // cancel semantics (§2.2): stop cues that have not sounded yet
      if (d.canceled) {
        const list = pendingReload.get(key);
        if (list) for (const s of list) { try { s.stop(); } catch (e) {} }
      }
      pendingReload.delete(key);
      return;
    }
    if (d.phase !== "start") return;
    let out;
    if (own) out = env.spatial(null);
    else {
      const p = env.botPos(d.who);
      out = p ? env.spatial(p, 20) : null;                     // 10 m hearing radius class
    }
    if (!out) return;
    const dur = Math.max(0.6, fin(d.duration, 2));
    const g = own ? 0.5 : 0.35;
    const srcs = [];
    // stages at the animation's beats (§7.4): out ~18%, in at the 65% commit,
    // rack ~84% on empty (player.js drives the same commitFraction).
    const magIn = d.weaponId === "corvus" ? (buf("mag_in_corvus") || buf("mag_in")) : buf("mag_in");
    const s1 = voice(buf("mag_out"), out, { gain: g, when: dur * 0.18, rate: 1 + rng() * 0.06 });
    const s2 = voice(magIn, out, { gain: g, when: dur * (RELOAD_MODEL.commitFraction || 0.65), rate: 1 + rng() * 0.06 });
    if (s1) srcs.push(s1); else burst(out, { f: 1900, q: 4, durMs: 30, gain: g * 0.4, when: dur * 0.18 });
    if (s2) srcs.push(s2); else burst(out, { f: 1500, q: 4, durMs: 35, gain: g * 0.4, when: dur * (RELOAD_MODEL.commitFraction || 0.65) });
    if (d.empty) {
      const s3 = voice(buf("rack"), out, { gain: g * 1.1, when: dur * 0.84, rate: 1 + rng() * 0.05 });
      if (s3) srcs.push(s3); else burst(out, { f: 2400, q: 5, durMs: 25, gain: g * 0.5, when: dur * 0.84 });
    }
    pendingReload.set(key, srcs);
  }

  function onSwitch(d) {
    const out = env.spatial(null);
    if (!out) return;
    const b = buf("click");
    if (b) voice(b, out, { gain: 0.4, rate: 1.15 });
    else burst(out, { f: 2600, q: 5, durMs: 18, gain: 0.2 });
    const c = buf("cloth");
    if (c) voice(c, out, { gain: 0.22, when: 0.08 });
  }

  function onAds(d) {
    const out = env.spatial(null);
    if (!out) return;
    const c = buf("cloth");
    if (c) voice(c, out, { gain: d && d.on ? 0.18 : 0.12, rate: 1.1 });
    else burst(out, { f: 1200, q: 0.8, durMs: 45, gain: 0.06 });
  }

  function onEmpty(d) {
    // dry click (§2.2) — always synth (crisp, tonal)
    const out = env.spatial(null);
    if (!out) return;
    burst(out, { f: 3000, q: 7, durMs: 9, gain: 0.22 });
    burst(out, { f: 1800, q: 7, durMs: 11, gain: 0.16, when: 0.045 });
  }

  function onLand(d) {
    if (!d) return;
    const own = d.who === "P";
    const h = Math.max(0, fin(d.height, 0));
    let out;
    if (own) out = env.spatial(null);
    else {
      const p = env.botPos(d.who);
      out = p ? env.spatial(p, 24) : null;
    }
    if (!out) return;
    const k = Math.min(1, h / 4);                              // §1.7: 4 m = the big thud
    thump(out, { f0: 110, f1: 55, durMs: 90 + 60 * k, gain: 0.12 + 0.3 * k });
    const c = buf("cloth");
    if (c) voice(c, out, { gain: 0.1 + 0.2 * k, rate: 0.95 });
  }

  function onHurt(d) {
    if (!d || d.victim !== "P") return;                        // bot flesh = shot impact
    const out = env.spatial(null);
    if (!out) return;
    thump(out, { f0: 95, f1: 60, durMs: 100, gain: 0.2 });
    burst(out, { f: 380, q: 0.8, durMs: 70, gain: 0.1 });
  }

  function onDeath(d) {
    if (!d) return;
    if (d.attacker === "P" && d.victim !== "P") {
      // kill thunk (§4.1): 700 Hz thock + tick, −8 dB, UI bus
      const o = uiOut(1);
      thump(o, { f0: 700, f1: 640, durMs: 60, gain: 0.34 });
      burst(o, { f: 2400, q: 8, durMs: 26, gain: 0.2 });
    }
    if (d.victim !== "P" && d.pos) {
      const out = env.spatial(d.pos, 35);
      if (out) {
        const c = buf("cloth");
        if (c) voice(c, out, { gain: 0.3, rate: 0.8, when: 0.35 });   // body settles
        thump(out, { f0: 90, f1: 50, durMs: 110, gain: 0.16, when: 0.4 });
      }
    }
  }

  function squelchInto(out, urgent, gain) {
    // §5.10 v1 voice: radio click + synthesized squelch burst (+ subtitle by
    // A10) — honest about no recorded VO.
    burst(out, { f: 3200, q: 9, durMs: 6, gain: gain * 0.8 });                 // key click
    burst(out, { f: 1700, q: 2.6, durMs: urgent ? 160 : 240, gain, when: 0.02 });
    if (urgent) burst(out, { f: 1900, q: 2.6, durMs: 130, gain: gain * 0.85, when: 0.22 });
    burst(out, { f: 2900, q: 9, durMs: 6, gain: gain * 0.6, when: urgent ? 0.38 : 0.29 }); // off click
  }

  function onBark(d) {
    if (!d || !env.ac) return;
    const t = env.ac.currentTime;
    if (t - lastBark < 0.15) return;                           // same-tick stack guard
    lastBark = t;
    const p = env.botPos(d.botId);
    const out = p ? env.spatial(p, 45) : env.spatial(null);
    if (!out) return;
    const urgent = d.kind === "grenade" || d.kind === "down" || d.kind === "push" || d.kind === "lastman";
    squelchInto(out, urgent, 0.26);
  }

  function radioSquelch() {
    // player-side radio line (A10 calls this when it shows a mission radio
    // subtitle — needsElsewhere; also wired for the pending `radio` event)
    const out = env.spatial(null);
    if (out) squelchInto(out, false, 0.2);
  }

  function onObjective(d) {
    if (!d) return;
    const o = uiOut(1);
    if (d.state === "done") {
      thump(o, { f0: 880, f1: 880, durMs: 120, gain: 0.1, type: "sine" });
      thump(o, { f0: 1174.7, f1: 1174.7, durMs: 200, gain: 0.1, type: "sine", when: 0.13 });
    } else if (d.state === "active") {
      thump(o, { f0: 987.8, f1: 987.8, durMs: 140, gain: 0.08, type: "sine" });
    }
  }

  function onWhiz(d) {
    if (!d || !d.pos) return;
    // supersonic crack: 90 ms, 2–4 kHz snap (§7.2)
    const out = env.spatial(d.pos, 15);
    if (!out) return;
    const near = 1 - Math.min(1, fin(d.dist, 1.5) / 3);
    burst(out, { f: 3800, sweepTo: 2200, q: 1.8, durMs: 90, gain: 0.16 + 0.2 * near });
  }

  function onExplosion(d) {
    if (!d || !d.pos) return;
    const ac = env.ac;
    const c = camPos();
    const dist = Math.hypot(d.pos[0] - c[0], (d.pos[1] || 0) - c[1], d.pos[2] - c[2]);
    if (!Number.isFinite(dist) || dist > 280) return;
    const when = dist / 343;
    const out = env.spatial(d.pos, 300);
    if (!out) return;
    const big = d.source === "drum" || d.source === "transformer";
    const b = buf(big ? "expl_large" : "expl_frag");
    let src = null;
    if (b) src = voice(b, out, { gain: 0.9, rate: 1 + (rng() * 2 - 1) * 0.05, when });
    else {
      thump(out, { f0: 120, f1: 30, durMs: 500, gain: 0.8, when });
      burst(out, { f: 900, q: 0.5, durMs: 350, gain: 0.5, when });
    }
    thump(out, { f0: 48, f1: 26, durMs: 480, gain: 0.5, when });          // sub layer
    // debris clatter
    for (let i = 0; i < 3; i++) {
      const ib = buf("imp_concrete");
      if (ib) voice(ib, out, { gain: 0.12, rate: 0.8 + rng() * 0.3, when: when + 0.3 + rng() * 0.6 });
    }
    // tail into the blast zone's convolver
    const conv = env.tailIn(env.zoneOf(d.pos[0], d.pos[1] || 0, d.pos[2]));
    if (conv && src) {
      try { const tg = ac.createGain(); tg.gain.value = 0.8; src.connect(tg); tg.connect(conv); } catch (e) { err(e, "expl-tail"); }
    }
    if (env.music) env.music.gunDuck();
  }

  function onGrenade(d) {
    if (!d || !d.pos) return;
    const out = env.spatial(d.pos, 30);
    if (!out) return;
    if (d.phase === "bounce") {
      const b = buf("click");
      if (b) voice(b, out, { gain: 0.3, rate: 1.55 + rng() * 0.15 });
      else burst(out, { f: 3400, q: 6, durMs: 14, gain: 0.18 });
    } else if (d.phase === "land") {
      thump(out, { f0: 240, f1: 130, durMs: 45, gain: 0.16 });
    } else if (d.phase === "out") {
      burst(out, { f: 900, sweepTo: 500, q: 0.7, durMs: 220, gain: 0.08 }); // throw whoosh
    }
  }

  function ui(kind) {
    const map = { click: "ui_click", back: "ui_back", confirm: "ui_confirm", error: "ui_error" };
    const b = buf(map[kind] || "ui_click");
    const o = uiOut(0.5);
    if (b) voice(b, o, { gain: 1 });
    else burst(o, { f: 2200, q: 6, durMs: 20, gain: 0.3 });
  }

  function reset() {
    for (const list of pendingReload.values()) for (const s of list) { try { s.stop(); } catch (e) {} }
    pendingReload.clear();
    lastBark = -10;
    lastTail.clear();            // no stale distant-tail slots across missions
  }

  return {
    loadBuffers,
    bufferCount: () => decoded,
    reset, ui, radioSquelch,
    onShot, onHurt, onDeath, onReload, onSwitch, onAds, onStep, onLand,
    onEmpty, onBark, onObjective, onWhiz, onExplosion, onGrenade,
  };
}
