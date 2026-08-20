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
  function burst(out, { f = 2000, q = 4, durMs = 30, gain = 0.2, when = 0, sweepTo = 0 } = {}) {
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
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gclamp(gain), t0 + Math.min(0.004, dur * 0.25));
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

    // tail layer — shooter's-zone convolver (§7.3 shooter-tail rule)
    const conv = env.tailIn(shooterZone);
    if (conv && bodySrc) {
      try {
        const tg = ac.createGain();
        tg.gain.value = gclamp((ring === 1 ? 0.7 : 0.5) * (own ? 0.8 : 1)); // +40% ring 2
        bodySrc.connect(tg); tg.connect(conv);
      } catch (e) { err(e, "tail"); }
    }
    if (ring === 2) {
      // distant tail 1.2 s+ — the convolver zones are short; synthesize it
      burst(dst, { f: 420, q: 0.7, durMs: 1300 + rng() * 400, gain: 0.10, when: when + 0.03 });
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

  function onStep(d) {
    if (!d) return;
    const own = d.who === "P";
    let out, gain;
    if (own) {
      out = env.spatial(null);
      gain = 0.12 * (d.sprint ? 1.41 : 1);                     // −10 dB vs bots (§7.4)
      const st = env.ctx.sim() && env.ctx.sim().state;
      if (st && st.player && st.player.stance === "crouch") gain *= 0.4; // −8 dB
    } else {
      const p = env.botPos(d.who);
      if (!p) return;
      out = env.spatial(p, 30);
      if (!out) return;
      gain = 0.38 * (d.sprint ? 1.41 : 1);
    }
    if (!out) return;
    const name = STEP_ALIAS[d.surface] || "step_concrete";
    const b = buf(name);
    if (b) {
      const isImp = name === "step_metal" || name === "step_glass"; // repurposed takes
      voice(b, out, { rate: (1 + (rng() * 2 - 1) * 0.08) * (isImp ? 1.25 : 1), gain: gain * (isImp ? 0.5 : 1), lp: isImp ? 3200 : 0 });
    } else {
      burst(out, { f: 900 + rng() * 300, q: 1, durMs: 28, gain: gain * 0.5 });
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
  }

  return {
    loadBuffers,
    bufferCount: () => decoded,
    reset, ui, radioSquelch,
    onShot, onHurt, onDeath, onReload, onSwitch, onAds, onStep, onLand,
    onEmpty, onBark, onObjective, onWhiz, onExplosion, onGrenade,
  };
}
