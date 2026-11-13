// core/audio/audio.js [A9] — context, buses, reverb zones, listener, hp-muffle.
// Architecture §3.16 (frozen surface: createAudio(ctx) → {unlock, attach,
// setVolumes, update}); combat_spec §6 (hp muffle, heartbeat, tinnitus), §7
// (buses, zones); BUILD_PLAN §A9.
//
// Context discipline: constructed at unlock() via globalThis.AudioContext —
// AFTER game_controls.js wrapped the constructor at page load, so the page-
// level Mute reaches this context (wrap registers it and holds resume() while
// muted). unlock() runs on the first user gesture (listeners installed here)
// and is also directly callable (__FPS__.audio.unlock() — harness path).
//
// AudioParam safety (lane rule): linear ramps + setTargetAtTime only — NEVER
// exponentialRampToValueAtTime (throws near 0); every computed value goes
// through fin()/gclamp() so a NaN position or hp can never throw out of an
// event handler and kill the frame (the last-circle "one bad sound position
// stopped the entire game" lesson).
//
// Graph:
//   voices → sfxDry ─┬────────────────────────────→ sfx ─┐
//                    └→ zone.send → zone.conv → zone.wet ─┘   (listener wet,
//   shot tails ─────────→ zone.conv (shooter's zone)          250 ms xfade)
//   music bus, ambience bus ──────────────────────────────┐
//   sfx/music/ambience → duck → hpMuffle(lowpass) → limiter → destination
//   tinnitus/heartbeat → limiter input (ring through the duck + muffle)

import { mulberry32 } from "../rng.js";
import { makeSfx } from "./sfx.js";
import { makeAmbience } from "./ambience.js";
import { makeMusic } from "./music.js";

// combat_spec §7.3 — synthesized impulse recipes (no IR files).
//
// `wet` = the zone's fixed listener-side reverb-return level. `pre` = predelay,
// which is the PRIMARY size cue — a listener reads room size from the gap before
// the first reflection far more than from RT60 — and which also decides how much
// reverb energy lands ON the transient rather than after it.
//
// RT60s are deliberately UNCHANGED by the 2026-09-16 tail retune. Three of the
// four already sit at or below the realistic floor for the space they model
// (a real corridor is ≈2 s against our 0.50; an empty industrial hall is 2–6 s
// against our 1.10), so the tails in this game are too LOUD, too FLAT and too
// UNDIFFERENTIATED BY DISTANCE — not too long. Lengthening a tail in response to
// "the echo is too loud" would be the wrong knob, and every extra 100 ms of RT60
// is extra accumulation under automatic fire. The RT60 recommendations that were
// deliberately NOT applied are in the lane report.
const ZONES = {
  // exterior.wet 0.14 → 0.12 (−1.3 dB). Paired on purpose with the impulse fix
  //   in makeImpulse() below: that removes 24.0% of this zone's impulse energy,
  //   and ConvolverNode normalisation (`normalize` defaults true) therefore lifts
  //   whatever is left by about +1.1 dB. The pair nets ≈ −0.2 dB for a DISTANT
  //   shooter — the exterior space is preserved, which is the brief — while the
  //   player's OWN weapon drops a further 3.9 dB from losing its double-feed in
  //   sfx.js. That asymmetry is the entire point.
  //   NOT taken to 0.08 as an unqualified level cut would suggest: measured, the
  //   exterior convolver branch sits 38–44 dB under the direct report and a full
  //   render differs from a reverb-killed render by ≤0.3 dB in this zone. Cutting
  //   it hard would buy nothing audible and would cost the distant-shooter reads.
  exterior:   { rt60: 0.25, pre: 0.090, wet: 0.12, slap: true },
  // warehouse.pre 0.018 → 0.030 (+12 ms). 18 ms is a 3.1 m first reflection,
  //   which reads as a medium ROOM; 30 ms is ≈5 m, which reads as a hall. Moving
  //   the reflection later also moves reverb energy off the muzzle transient, so
  //   the dry crack stays dry: the size cue improves and the "wet" impression
  //   drops at the same time, with no change to level and no change to RT60.
  //   wet stays 0.30 — interiors are SUPPOSED to have more tail than the street,
  //   and that ordering (0.30 > 0.26 > 0.22 > 0.12) is now wider, not flatter.
  warehouse:  { rt60: 1.10, pre: 0.030, wet: 0.30, slap: false },
  corridor:   { rt60: 0.50, pre: 0.008, wet: 0.26, flutter: true },
  small_room: { rt60: 0.35, pre: 0.005, wet: 0.22, slap: false },
};

// ---- §7.3 tail duck: reverb-return compression, keyed off the shots ---------
// Standard practice for gunfire is a compressor on the reverb RETURN, side-
// chained from the dry weapon bus: ≈6:1, 1–3 ms attack, 90–140 ms release, tuned
// for 5–8 dB of gain reduction on a single shot. Web Audio has no side-chain, so
// the same shape is scheduled directly onto the zone's wet gain by the shot that
// causes it (sfx.js bang() calls env.tailDuck once per gunshot).
//
// Why it is needed, measured on this graph: overlapping incoherent tails sum at
// 10·log10(N). A 30-round warden mag (750 rpm) fired in exterior raised the
// inter-shot noise floor from −35.9 dBFS before round 2 to −10.4 dBFS before
// round 29 — +25.5 dB of build-up, i.e. by the end of a magazine the space
// BETWEEN rounds sat only ~9 dB under the rounds themselves. That is the mush,
// and it is the one part of the complaint a static level cut cannot fix: the
// tail is not too loud on shot one, it is too loud on shot twenty. A return
// compressor is exactly the tool for "loud once is fine, loud twenty times is
// not".
const TAIL_DUCK_ONE = 0.50;    // one shot → −6 dB on that zone's return
const TAIL_DUCK_FLOOR = 0.32;  // sustained fire bottoms out at −10 dB, never more
const TAIL_DUCK_TAU = 0.25;    // heat decay: ≈4 rounds at 750 rpm reaches the floor

export function createAudio(ctx) {
  let ac = null;                  // AudioContext, constructed at unlock
  let buses = null;               // {master, duck, hpMuffle, limiter, sfx, sfxDry, music, ambience}
  let zones = null;               // name → {conv, send, wet}
  let sfx = null, ambience = null, music = null;
  let cameraZone = "exterior";
  let unlocked = false;
  let started = false;            // beds/music started
  const errors = [];              // handler exceptions (selftest reads; console warns)
  const errSeen = new Set();
  const rng = mulberry32(0xa9d1);
  const engaged = new Set();      // botIds in combat|suppress|flank (music drive)
  let engagedPoll = 0;
  let zonePoll = 0;
  let heartNext = 0;              // ac time of next heartbeat
  let tinnitusLast = -100;        // sim-clock guard (max once / 20 s)
  let slideGain = null, slideSrc = null; // §7.4 slide scrape loop
  let muffleOpen = true;
  let supOpen = true; // suppression low-pass released
  const duckHeat = {};            // zone → {h, t} for the §7.3 tail duck
  // H1 (2026-08-25, owner request): laboured-breathing loop at CRITICAL hp.
  // No breathing take exists in the CC0 set (assets/audio audited: steps/
  // impacts/shots/ui/thunder/cloth only) — synthesized: bandpass noise with
  // per-cycle inhale/exhale envelopes, scheduled like the heartbeat.
  let breathSrc = null, breathGain = null, breathFilt = null, breathNext = 0;
  let lowEpisode = false;         // hp dipped <50 while alive → recovery cue at full
  let lastBreathT = 0;            // diagnostic (debugHp)
  // 2026-11-13 additions: match lead tracking, final-kill window, grenade cook
  // poll, bot-landing poll (no sim events for the last two — read-only polls)
  let lead = 0;                   // player's standing: 1 leading, 0 tied, −1 behind
  let lastOwnKillT = -100;        // ac time of the player's last kill
  let cookLive = false, cookNext = 0, cookN = 0;
  const botAir = new Map();       // botId → peak y while airborne
  let leadCues = 0;
  const volumes = (ctx.content && ctx.content.reverbZones && ctx.content.reverbZones.volumes) || [];
  const defaultZone =
    (ctx.content && ctx.content.reverbZones && ctx.content.reverbZones.default) || "exterior";

  // ---- safety helpers (shared with sub-modules via env) ---------------------
  const fin = (v, fb) => (Number.isFinite(v) ? v : fb);
  const gclamp = (v) => Math.min(2, Math.max(0, fin(v, 0)));
  function err(e, where) {
    const key = where + ":" + (e && e.message);
    if (!errSeen.has(key)) {
      errSeen.add(key);
      console.warn("[audio]", where, e && e.message ? e.message : e);
    }
    errors.push(where + ": " + (e && e.message ? e.message : String(e)));
  }

  function zoneOf(x, y, z) {
    for (let i = 0; i < volumes.length; i++) {
      const v = volumes[i];
      if (x >= v.min[0] && x <= v.max[0] && y >= v.min[1] && y <= v.max[1] &&
          z >= v.min[2] && z <= v.max[2]) return v.zone;
    }
    return defaultZone;
  }

  // ---- synthesized impulse responses (combat_spec §7.3) ---------------------
  function makeImpulse(spec) {
    const sr = ac.sampleRate;
    const len = Math.max(1, Math.floor(sr * (spec.pre + spec.rt60 * 1.35)));
    const buf = ac.createBuffer(2, len, sr);
    const preN = Math.floor(sr * spec.pre);
    for (let chn = 0; chn < 2; chn++) {
      const d = buf.getChannelData(chn);
      if (spec.slap) {
        // exterior night: sparse early burst + ONE discrete slap echo at the
        // predelay, short decay — "0.25 s slap, 90 ms single echo".
        //
        // 2026-09-16: this leading burst ran at amplitude 0.5, which put 24.0% of
        // the whole impulse's energy into a 20 ms noise wash at ZERO predelay —
        // glued to the muzzle transient instead of arriving after it. Energy
        // check, from these two loops: the t=0 burst integrates to
        // (1/3)(0.5²)(0.02/3) = 5.56e-4 and the 250 ms slap cluster below to
        // (1/3)(0.35²)(0.25/5.8) = 1.76e-3, so 5.56/23.16 = 24.0%. Audibly that
        // is not an echo at all — it is mud ON the attack, and it is why your own
        // shot reads as a WET crack rather than a dry crack followed by a space.
        // No amount of send trimming could remove it, because it lives inside the
        // impulse, ahead of the predelay the zone is supposed to have.
        // OLD 0.5 → NEW 0.12 (−12.4 dB): the wash falls to 1.8% of the impulse
        // and the crack reads dry, while the 90 ms slap that actually gives this
        // zone its "night slap, single echo" character is left alone.
        for (let i = 0; i < sr * 0.02; i++) d[i] = (rngS() * 2 - 1) * 0.12 * (1 - i / (sr * 0.02));
        for (let i = 0; i < sr * spec.rt60; i++) {
          const k = preN + i;
          if (k >= len) break;
          d[k] += (rngS() * 2 - 1) * 0.35 * Math.pow(1 - i / (sr * spec.rt60), 2.4);
        }
      } else {
        for (let i = preN; i < len; i++) {
          const t = (i - preN) / (len - preN);
          let s = (rngS() * 2 - 1) * Math.pow(1 - t, 2.0);
          // corridor flutter: comb-like repeats every ~13 ms
          if (spec.flutter && ((i - preN) % Math.floor(sr * 0.013)) < sr * 0.0015) s *= 2.2;
          d[i] = s;
        }
      }
    }
    return buf;
  }
  // decorrelated deterministic noise for IRs (independent of the fx stream)
  let _irState = 0x1234abcd;
  function rngS() {
    _irState |= 0; _irState = (_irState + 0x6d2b79f5) | 0;
    let t = Math.imul(_irState ^ (_irState >>> 15), 1 | _irState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- listener sync (zero-alloc: matrix elements, no Vector3) --------------
  let _lisT = -1;
  function syncListener() {
    if (!ac || !ctx.camera) return;
    if (ac.currentTime === _lisT) return;
    _lisT = ac.currentTime;
    const e = ctx.camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];   // -Z column = forward
    const ux = e[4], uy = e[5], uz = e[6];       // +Y column = up
    if (!Number.isFinite(px) || !Number.isFinite(fx) || !Number.isFinite(ux)) return;
    const L = ac.listener;
    try {
      if (L.positionX) {
        L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
        L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
        L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
      } else {
        L.setPosition(px, py, pz);
        L.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch (e2) { err(e2, "listener"); }
  }

  // ---- env shared with sfx/ambience/music -----------------------------------
  const env = {
    ctx, rng, fin, gclamp, err,
    get ac() { return ac; },
    get buses() { return buses; },
    get cameraZone() { return cameraZone; },
    zoneOf,
    epoch: () => (ctx.sim() ? ctx.sim().epoch : 0),
    // shooter-tail send: returns the convolver input for a named zone (§7.3 —
    // a shooter's TAIL uses the SHOOTER's zone, whatever the camera hears).
    tailIn(zoneName) {
      if (!zones) return null;
      const z = zones[zoneName] || zones[defaultZone] || zones.exterior;
      return z ? z.conv : null;
    },
    // Reverb-return duck (see the TAIL_DUCK_* block above ZONES for the measured
    // reason this exists). sfx.js calls it once per gunshot with the SHOOTER's
    // zone — every zone's wet feeds the sfx bus regardless of where the camera
    // is, so ducking the shooter's zone ducks exactly the return that shot is
    // about to bloom. `when` is the shot's scheduled arrival (dist/343), so a
    // distant shot ducks when its sound lands, not when it was fired, and
    // `weight` is 1 for the player and the shot's distance gain for anyone else
    // — a 250 m shot barely keys the duck at all, which is correct: it is not
    // what is building up in your ears.
    //
    // No reset hook is needed. `heat` decays against wall time and the release
    // target is always scheduled alongside the duck, so a mission ending mid
    // burst restores the zone's wet level on its own within ~150 ms.
    tailDuck(zoneName, when, weight) {
      if (!ac || !zones) return;
      const z = zones[zoneName] || zones[defaultZone] || zones.exterior;
      if (!z) return;
      const w = Math.min(1, Math.max(0, fin(weight, 1)));
      if (w < 0.05) return;
      const spec = ZONES[zoneName] || ZONES[defaultZone] || ZONES.exterior;
      const t = ac.currentTime + Math.max(0, fin(when, 0));
      const s = duckHeat[zoneName] || (duckHeat[zoneName] = { h: 0, t });
      s.h = s.h * Math.exp(-Math.max(0, t - s.t) / TAIL_DUCK_TAU) + w;
      s.t = t;
      // one shot → −6 dB; four or more overlapping → the −10 dB floor
      const k = Math.min(1, Math.max(0, (s.h - 1) / 3));
      const depth = TAIL_DUCK_ONE - (TAIL_DUCK_ONE - TAIL_DUCK_FLOOR) * k;
      try {
        const g = z.wet.gain;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(gclamp(spec.wet * (1 - (1 - depth) * w)), t, 0.008); // ≈2 ms attack
        g.setTargetAtTime(gclamp(spec.wet), t + 0.040, 0.05);                  // ≈110 ms release
      } catch (e) { err(e, "tailDuck"); }
    },
    // HRTF panner + tuned distance curve. Returns a GainNode wired into sfxDry
    // (with .__d = distance) or null when out of earshot / non-finite (skip,
    // never crash). pos null = own-player / UI: head-relative, full bright.
    spatial(pos, maxD) {
      if (!ac || !buses) return null;
      let vol = 1, dist = null;
      if (pos) {
        const e = ctx.camera ? ctx.camera.matrixWorld.elements : null;
        const cx = e ? e[12] : 0, cy = e ? e[13] : 0, cz = e ? e[14] : 0;
        const d = Math.hypot(pos[0] - cx, (pos[1] || 0) - cy, pos[2] - cz);
        maxD = maxD || 60;
        if (!Number.isFinite(d) || d > maxD) return null;
        dist = d;
        vol = Math.pow(Math.max(0, 1 - d / maxD), 1.4);
        if (!Number.isFinite(vol)) return null;
      }
      const g = ac.createGain();
      g.gain.value = gclamp(vol);
      if (pos) {
        syncListener();
        const p = ac.createPanner();
        p.panningModel = "HRTF";
        p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 0;
        const py = fin(pos[1], 0);
        try {
          if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = py; p.positionZ.value = pos[2]; }
          else p.setPosition(pos[0], py, pos[2]);
        } catch (e2) { err(e2, "panner"); }
        g.connect(p); p.connect(buses.sfxDry);
      } else {
        g.connect(buses.sfxDry);
      }
      g.__d = dist;
      return g;
    },
    // cached 1 s noise buffer for every synth voice
    noiseBuf() {
      if (env._nb) return env._nb;
      const b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
      env._nb = b;
      return b;
    },
    playerPos() {
      const s = ctx.sim() && ctx.sim().state;
      return s && s.player ? s.player.pos : null;
    },
    botPos(id) {
      const s = ctx.sim() && ctx.sim().state;
      if (!s || !s.bots) return null;
      for (let i = 0; i < s.bots.length; i++) if (s.bots[i].id === id) return s.bots[i].pos;
      return null;
    },
    losBlocked(a, b) {
      // best-effort read-only query; absence of the world hook degrades to
      // "assume blocked" (interiors sound muffled from outside — safe default)
      const sim = ctx.sim();
      const w = sim && sim.world;
      if (w && typeof w.losBlocked === "function") {
        try { return !!w.losBlocked(a, b); } catch (e) { return true; }
      }
      return true;
    },
    voices: 0, // diagnostic counter (selftest reports it)
  };

  // The SHARED core for audio modules boot creates after this one
  // (streak_audio.js): one context, one graph, one limiter. Published at
  // creation; the getters resolve lazily once unlock() has built the graph.
  ctx.__audioCore = {
    env,
    get sfx() { return sfx; },
    get music() { return music; },
    unlock: () => unlock(),
  };

  // ---- unlock: build the graph -----------------------------------------------
  function unlock() {
    if (!unlocked) {
      unlocked = true;
      try {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        ac = new AC();
      } catch (e) { err(e, "ctx"); ac = null; return; }

      const master = ac.createGain(); master.gain.value = 1;
      const duck = ac.createGain(); duck.gain.value = 1;
      const hpMuffle = ac.createBiquadFilter();
      hpMuffle.type = "lowpass"; hpMuffle.frequency.value = 20000; hpMuffle.Q.value = 0.4;
      // MASTER DYNAMICS (2026-11-13 mix pass). Before: one brickwall at −6 dBFS
      // (20:1, 3 ms / 120 ms), and the measured 30-round Warden burst sat ON it
      // (pre-limiter peak −0.6 dBFS) — every round pulled 5–6 dB of gain
      // reduction and released inside the next round's gap: the pumping. Now a
      // gentle GLUE stage (soft knee, 2.5:1, 15 ms attack so transients pass,
      // 250 ms release so it rides a burst instead of breathing with it) takes
      // the sustained level down 1–3 dB, and the LIMITER moves to −2 dBFS with a
      // fast release — a safety net that a single own shot (≈ −6 dBFS after the
      // gun-level trim in sfx.js) no longer touches. Measured numbers: lane report.
      const glue = ac.createDynamicsCompressor();
      glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 2.5;
      glue.attack.value = 0.015; glue.release.value = 0.25;
      // brickwall so a pellet burst + explosion can never clip in hardware
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.002; limiter.release.value = 0.09;
      master.connect(duck); duck.connect(hpMuffle); hpMuffle.connect(glue); glue.connect(limiter);
      limiter.connect(ac.destination);

      const sfxBus = ac.createGain(); sfxBus.gain.value = gclamp(ctx.settings.sfx);
      const musicBus = ac.createGain(); musicBus.gain.value = gclamp(ctx.settings.music);
      const ambBus = ac.createGain(); ambBus.gain.value = gclamp(ctx.settings.ambience);
      // ear-fatigue shelf on the SFX bus: −3 dB above ~7 kHz. Measured, the own
      // Warden put 16% of its spectral magnitude above 6 kHz (centroid 2.9 kHz)
      // and a held trigger is exactly where that top end tires the ear; the
      // crack lives at 2–5 kHz and is untouched.
      const sfxTone = ac.createBiquadFilter();
      sfxTone.type = "highshelf"; sfxTone.frequency.value = 7000; sfxTone.gain.value = -3;
      sfxBus.connect(sfxTone); sfxTone.connect(master);
      musicBus.connect(master); ambBus.connect(master);
      const sfxDry = ac.createGain(); sfxDry.gain.value = 1; sfxDry.connect(sfxBus);
      // CUE bus: hit/kill ticks, grenade warning, streak/medal/match UI cues —
      // straight into the limiter (past duck + muffle + glue) so they stay
      // legible at low health; follows the SFX slider.
      const cue = ac.createGain(); cue.gain.value = gclamp(ctx.settings.sfx);
      cue.connect(limiter);

      zones = {};
      for (const name of Object.keys(ZONES)) {
        const spec = ZONES[name];
        let conv = null;
        try { conv = ac.createConvolver(); conv.buffer = makeImpulse(spec); }
        catch (e) { conv = null; }
        if (!conv) continue;
        const send = ac.createGain(); send.gain.value = 0;       // listener xfade
        const wet = ac.createGain(); wet.gain.value = spec.wet;  // fixed zone level
        sfxDry.connect(send); send.connect(conv);
        conv.connect(wet); wet.connect(sfxBus);
        zones[name] = { conv, send, wet };
      }
      if (zones[cameraZone]) zones[cameraZone].send.gain.value = 1;

      buses = { master, duck, hpMuffle, glue, limiter, cue, sfx: sfxBus, sfxDry, music: musicBus, ambience: ambBus };

      sfx = makeSfx(env);
      ambience = makeAmbience(env);
      music = makeMusic(env);
      env.music = music; // sfx ducks music on own shots
    }
    if (ac && ac.state === "suspended") {
      try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
    if (ac && !started) {
      started = true;
      sfx.loadBuffers();       // background decode; every call site keeps synth fallback
      ambience.start();
      music.start("menu");     // menu reuses the tense bed (−6 dB, combat muted)
      heartNext = 0;
    }
  }

  // first real gesture unlocks; kept non-once so a suspended context retries
  if (typeof window !== "undefined") {
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    // shell mute: the game_controls wrap suspends/resumes registered contexts
    // itself; on unmute nudge a resume in case the wrap raced our unlock.
    window.addEventListener("mutechange", (e) => {
      if (ac && e && e.detail && !e.detail.muted && ac.state === "suspended") {
        try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch (e2) {}
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!ac) return;
      try {
        if (document.visibilityState === "hidden") { if (ac.state === "running") ac.suspend(); }
        else if (ac.state === "suspended") { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); }
      } catch (e) {}
    });
  }

  function setCameraZone(name) {
    if (!ZONES[name]) name = defaultZone;
    if (name === cameraZone) return;
    cameraZone = name;
    if (!ac || !zones) return;
    const t = ac.currentTime;
    for (const zn of Object.keys(zones)) {
      // 250 ms crossfade (combat_spec §7.3): setTargetAtTime τ ≈ 250/4 ms
      zones[zn].send.gain.setTargetAtTime(zn === name ? 1 : 0, t, 0.0625);
    }
    if (ambience) ambience.setZone(name);
  }

  // guard wrapper: one bad payload skips one sound, never kills the dispatch
  function safe(name, fn) {
    return (d, t) => {
      if (!ac) return;
      try { fn(d, t); } catch (e) { err(e, name); }
    };
  }

  // ---- the frozen surface -----------------------------------------------------
  const audio = {
    unlock,

    attach(bridge) {
      // R13-amended vocabulary only (architecture §4 + changelog v2 item 5).
      bridge.register("shot", safe("shot", (d, t) => sfx.onShot(d, t))); // t = sim time: the volley window is sim-time
      bridge.register("hurt", safe("hurt", (d) => sfx.onHurt(d)));
      bridge.register("death", safe("death", (d) => {
        sfx.onDeath(d);
        if (d && d.attacker === "P" && d.victim !== "P") lastOwnKillT = ac.currentTime;
        if (d && d.victim === "P") music.playerDeath();
        else if (d && engaged.delete(d.victim) && engaged.size === 0) music.squadWiped();
      }));
      bridge.register("reload", safe("reload", (d) => sfx.onReload(d)));
      bridge.register("switch", safe("switch", (d) => sfx.onSwitch(d)));
      bridge.register("ads", safe("ads", (d) => sfx.onAds(d)));
      bridge.register("step", safe("step", (d) => sfx.onStep(d)));
      bridge.register("land", safe("land", (d) => sfx.onLand(d)));
      bridge.register("jump", safe("jump", (d) => sfx.onJump && sfx.onJump(d)));
      bridge.register("empty", safe("empty", (d) => sfx.onEmpty(d)));
      bridge.register("bark", safe("bark", (d) => sfx.onBark(d)));
      bridge.register("botstate", safe("botstate", (d) => {
        if (!d) return;
        if (d.state === "combat" || d.state === "suppress" || d.state === "flank") engaged.add(d.botId);
        else engaged.delete(d.botId);
      }));
      bridge.register("objective", safe("objective", (d) => sfx.onObjective(d)));
      bridge.register("whiz", safe("whiz", (d) => sfx.onWhiz(d)));
      bridge.register("zone", safe("zone", (d) => { if (d) setCameraZone(d.reverbZone); }));
      bridge.register("explosion", safe("explosion", (d) => {
        sfx.onExplosion(d);
        if (d && d.pos && ctx.camera) {
          const e = ctx.camera.matrixWorld.elements;
          const dd = Math.hypot(d.pos[0] - e[12], (d.pos[1] || 0) - e[13], d.pos[2] - e[14]);
          const now = ac.currentTime;
          if (Number.isFinite(dd) && dd <= 6 && now - tinnitusLast >= 20) {
            tinnitusLast = now;
            tinnitus();
          }
        }
      }));
      bridge.register("grenade", safe("grenade", (d) => sfx.onGrenade(d)));
      bridge.register("mission:start", safe("mission:start", () => {
        engaged.clear();
        sfx.reset();
        music.start("mission");
        breathStop(); lowEpisode = false;   // H1: no stale breathing across missions
      }));
      bridge.register("mission:phase", safe("mission:phase", (d) => music.onPhase(d)));
      bridge.register("mission:end", safe("mission:end", (d) => {
        sfx.reset();
        const draw = !!(d && d.match && d.match.result === "draw");
        const won = !!(d && d.result === "won");
        // FINAL KILL: the match ended within 2 s of a kill YOU made, and you won
        const finalKill = won && !!(d && d.match) && ac.currentTime - lastOwnKillT < 2.0;
        music.missionEnd(draw ? "draw" : won, { finalKill });
        engaged.clear();
        cookLive = false;
      }));
      // ---- events that had no sound (2026-11-13) --------------------------------
      bridge.register("respawn", safe("respawn", (d) => sfx.onRespawn(d)));
      bridge.register("resupply", safe("resupply", (d) => sfx.onResupply(d)));
      bridge.register("loot", safe("loot", (d) => sfx.onLoot(d)));
      bridge.register("match:start", safe("match:start", () => { lead = 0; lastOwnKillT = -100; }));
      bridge.register("match:score", safe("match:score", () => leadCheck()));
    },

    setVolumes(v) {
      if (!v) return;
      if (v.sfx != null) ctx.setSetting("sfx", v.sfx);
      if (v.music != null) ctx.setSetting("music", v.music);
      if (v.ambience != null) ctx.setSetting("ambience", v.ambience);
      applyVolumes();
    },

    update(dt) {
      if (!ac || ac.state !== "running") return;
      syncListener();
      const sim = ctx.sim();
      const st = sim && sim.state;

      // hp muffle + heartbeat (combat_spec §6) + laboured breathing (H1)
      if (st && st.player) {
        const hp = fin(st.player.hp, 100);
        const t = ac.currentTime;
        if (hp < 35 && st.player.alive) {
          // H1: curve steepened (linear → ^1.6) so CRITICAL sits noticeably
          // deeper in the muffle; §6 endpoints preserved (35 hp → 20 kHz,
          // 0 hp → 1.1 kHz).
          const f = 1100 + 18900 * Math.pow(Math.max(0, hp / 35), 1.6);
          buses.hpMuffle.frequency.setTargetAtTime(fin(f, 20000), t, 0.12);
          muffleOpen = false;
          if (t >= heartNext) {
            const depth = 1 - hp / 35;
            const bpm = 58 + 24 * depth;
            heartNext = t + 60 / bpm;
            heartbeat(0.10 + 0.16 * depth);
          }
        } else if (!muffleOpen && hp >= 50) {
          // release over ~1.5 s as regen passes 50 hp
          buses.hpMuffle.frequency.setTargetAtTime(20000, t, 0.4);
          muffleOpen = true;
        }

        // SUPPRESSION (sfx.onWhiz / onHurt feed ctx.suppress 0..1): near misses pull
        // the mix under a low-pass for a moment and let go within ~1 s. Only above
        // 35 hp — below that the low-health muffle already owns this filter.
        {
          const sup = Math.max(0, fin(ctx.suppress, 0) - dt * 0.85);
          ctx.suppress = sup;
          if (hp >= 35) {
            if (sup > 0.04) {
              const k = 1 - sup;
              buses.hpMuffle.frequency.setTargetAtTime(2400 + 17600 * k * k, t, 0.05);
              supOpen = false;
            } else if (!supOpen) {
              buses.hpMuffle.frequency.setTargetAtTime(20000, t, 0.25);
              supOpen = true;
            }
          }
        }

        // H1 laboured breathing: starts below 30 hp (CRITICAL), hysteresis
        // release at 40 hp so regen doesn't gate-chatter the loop. The loop
        // feeds the limiter input directly (like heartbeat/tinnitus): the
        // player's own body is never muffled by its own dying ears.
        const critical = hp < 30 && st.player.alive;
        if (critical && !breathSrc) breathStart();
        else if (breathSrc && (hp >= 40 || !st.player.alive)) breathStop();
        if (breathSrc && critical && t >= breathNext) {
          breathCycle(Math.min(1, 1 - hp / 30));
        }
        // H1 recovery cue: hp dipped below 50, then regenned to FULL while
        // alive → one soft inhale/exhale so "safe again" is as legible as
        // "dying". Death clears the episode (a respawn must not sigh).
        const maxHpA = (sim && sim.tuning && sim.tuning.maxHp) || 100;
        if (!st.player.alive) lowEpisode = false;
        else if (hp < 50) lowEpisode = true;
        else if (lowEpisode && hp >= maxHpA - 0.5) { lowEpisode = false; recoverBreath(); }

        // §7.4 slide scrape: crouched at near-sprint speed = sliding (heuristic
        // read of frozen state; there is no slide event in the vocabulary)
        // (2026-10-14) the sim's own slide flag first — the speed heuristic cut the
        // scrape off before the slide ended (it decays below 4.6 m/s mid-slide)
        const sliding = st.player._m && typeof st.player._m.sliding === "boolean"
          ? (st.player._m.sliding && st.player.grounded)
          : (st.player.stance === "crouch" && fin(st.player.speedNorm, 0) > 0.72 && st.player.grounded);
        if (sliding && !slideSrc) {
          try {
            slideSrc = ac.createBufferSource(); slideSrc.buffer = env.noiseBuf(); slideSrc.loop = true;
            const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 0.7;
            slideGain = ac.createGain(); slideGain.gain.value = 0;
            slideSrc.connect(f); f.connect(slideGain); slideGain.connect(buses.sfxDry);
            slideSrc.start();
            slideGain.gain.setTargetAtTime(0.10, ac.currentTime, 0.05);
          } catch (e) { err(e, "slide"); slideSrc = null; }
        } else if (!sliding && slideSrc) {
          const s = slideSrc, g = slideGain;
          slideSrc = null; slideGain = null;
          try {
            g.gain.setTargetAtTime(0, ac.currentTime, 0.06);
            setTimeout(() => { try { s.stop(); } catch (e) {} }, 350);
          } catch (e) {}
        }
      }

      // GRENADE PIN / COOK (2026-11-13): the sim emits nothing until the throw,
      // so read the player's cook flag (read-only, like the slide flag above).
      // Rising edge = the pin; one fuse tick per second while it is held.
      if (st && st.player) {
        const m = st.player._m;
        const cooking = !!(m && m.cooking && st.player.alive);
        const t = ac.currentTime;
        if (cooking && !cookLive) { cookLive = true; cookN = 0; cookNext = t + 1.0; sfx.grenadePin(); }
        else if (!cooking && cookLive) cookLive = false;
        if (cookLive && t >= cookNext) { cookN++; cookNext = t + 1.0; sfx.cookTick(cookN); }
      }

      // BOT LANDINGS (2026-11-13): the sim emits `land` for the player only, so a
      // bot dropping off a ledge behind you was silent. Track each nearby bot's
      // airborne peak; a touchdown after > 0.6 m of fall plays sfx.onLand for it.
      if (st && st.bots) {
        const c = ctx.camera ? ctx.camera.matrixWorld.elements : null;
        for (let i = 0; i < st.bots.length; i++) {
          const b = st.bots[i];
          if (!b || !b.pos) continue;
          if (!b.alive) { botAir.delete(b.id); continue; }
          const y = fin(b.pos[1], 0);
          if (b.grounded === false) {
            const pk = botAir.get(b.id);
            botAir.set(b.id, pk == null ? y : Math.max(pk, y));
          } else if (botAir.has(b.id)) {
            const fall = botAir.get(b.id) - y;
            botAir.delete(b.id);
            if (fall > 0.6 && c && Math.hypot(b.pos[0] - c[12], y - c[13], b.pos[2] - c[14]) < 26) {
              sfx.onLand({ who: b.id, height: fall });
            }
          }
        }
        if (botAir.size > 64) botAir.clear();
      }

      // camera-zone backup poll (the sim's `zone` events are primary)
      zonePoll += dt;
      if (zonePoll >= 0.5) {
        zonePoll = 0;
        const p = env.playerPos();
        if (p) {
          const z = zoneOf(p[0], (p[1] || 0) + 1.6, p[2]);
          if (z !== cameraZone) setCameraZone(z);
        }
      }

      // engagement truth poll at 2 Hz (botstate events are the fast path)
      engagedPoll += dt;
      if (engagedPoll >= 0.5) {
        engagedPoll = 0;
        if (st && st.bots) {
          engaged.clear();
          for (let i = 0; i < st.bots.length; i++) {
            const b = st.bots[i];
            if (b.alive && (b.state === "combat" || b.state === "suppress" || b.state === "flank")) {
              engaged.add(b.id);
            }
          }
        }
      }

      ambience.update(dt);
      music.update(dt, engaged.size);
    },

    // ---- private extras (allowed additions; other lanes may call) ------------
    // H1 diagnostic: harness-readable proof the low-hp layers are live (the
    // operator cannot listen — gains + muffle Hz at each threshold ARE the
    // verification record).
    debugHp() {
      return {
        ctxState: ac ? ac.state : "none",
        muffleHz: buses ? buses.hpMuffle.frequency.value : null,
        duck: buses ? buses.duck.gain.value : null,
        heartNext,
        breathing: !!breathSrc,
        breathGain: breathGain ? breathGain.gain.value : 0,
        breathNext, lastBreathT, lowEpisode,
        voices: env.voices,
        acTime: ac ? ac.currentTime : 0,
      };
    },
    ui(kind) { if (ac && sfx) { try { sfx.ui(kind); } catch (e) { err(e, "ui"); } } },
    // weapon-voice counters (shot events seen vs volleys voiced, racks, shell
    // inserts, hit/kill ticks) — probes read these to prove one boom per volley.
    sfxStats() {
      if (!sfx) return null;
      const ex = (ctx.__audioExtra || []).map((a) => (a.stats ? a.stats() : null));
      return { ...sfx.stats(), voices: env.voices, ctxState: ac ? ac.state : "none",
               stingers: music ? music.stingCount() : 0, leadCues, extra: ex,
               limiterReductionDb: buses ? buses.limiter.reduction : null,
               glueReductionDb: buses && buses.glue ? buses.glue.reduction : null };
    },
    // match stinger by name (victory|defeat|draw|leadTaken|leadLost|finalKill)
    stinger(kind) { if (ac && music) { try { return music.stinger(kind); } catch (e) { err(e, "stinger"); } } return false; },
    radioSquelch() { if (ac && sfx) { try { sfx.radioSquelch(); } catch (e) { err(e, "squelch"); } } },

    // Scripted burst for the lane gate: exercises gunshot/footstep/reverb/
    // music paths through the SAME handler functions the bridge dispatches to,
    // collecting every AudioParam/handler exception. Returns JSON-safe report.
    async selftest() {
      errors.length = 0;
      unlock();
      if (!ac) return { ok: false, ctxState: "none", errors: ["no AudioContext"] };
      const fire = (type, d) => {
        const h = testHooks[type];
        if (h) h(d);
      };
      const cam = ctx.camera ? ctx.camera.matrixWorld.elements : [0,0,0,0,0,0,0,0,0,0,0,0,0,1.6,0];
      const cx = cam[12], cy = cam[13], cz = cam[14];
      const at = (dx, dy, dz) => [cx + dx, cy + dy, cz + dz];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      // reverb zone crossfades
      fire("zone", { reverbZone: "warehouse" });
      await wait(120);
      fire("zone", { reverbZone: "exterior" });

      // gunshots: own first-shot + burst, suppressed CQB, ring 2, ring 3,
      // impactOnly resolution, penetration faces
      fire("shot", { shooter: "P", weaponId: "warden", origin: at(0, 0, 0), dir: [0, 0, -1], hit: null, tracer: true, pellet: 0, firstShot: true });
      for (let i = 0; i < 3; i++) fire("shot", { shooter: "P", weaponId: "warden", origin: at(0, 0, 0), dir: [0, 0, -1], hit: { pos: at(0, 0, -12), normal: [0, 0, 1], surface: "concrete", entity: null, part: null }, tracer: false, pellet: 0 });
      fire("shot", { shooter: 7, weaponId: "vesper", origin: at(6, 0, -10), dir: [0, 0, 1], hit: null, tracer: false, pellet: 0, firstShot: true });
      fire("shot", { shooter: 8, weaponId: "warden", origin: at(-30, 0, -50), dir: [0, 0, 1], hit: null, tracer: false, pellet: 0 });
      fire("shot", { shooter: 9, weaponId: "corvus", origin: at(40, 2, -140), dir: [0, 0, 1], hit: null, tracer: true, pellet: 0, firstShot: true });
      fire("shot", { shooter: "P", weaponId: "corvus", origin: at(0, 0, 0), dir: [0, 0, -1], hit: { pos: at(0, 0, -60), normal: [0, 0, 1], surface: "metal", entity: 7, part: "head" }, tracer: true, pellet: 0, impactOnly: true });
      fire("shot", { shooter: "P", weaponId: "warden", origin: at(0, 0, 0), dir: [0, 0, -1], hit: { pos: at(0, 0, -8), normal: [0, 0, 1], surface: "wood", entity: null, part: null }, tracer: false, pellet: 0, impactOnly: true, pen: "entry" });
      fire("shot", { shooter: "P", weaponId: "warden", origin: at(0, 0, 0), dir: [0, 0, -1], hit: { pos: at(0, 0, -8.3), normal: [0, 0, -1], surface: "wood", entity: null, part: null }, tracer: false, pellet: 0, impactOnly: true, pen: "exit" });

      // B-12 Breaker: a nine-pellet volley (own + a bot at 12 m), then the
      // shell-by-shell reload, switch and dry-fire foley
      for (let p = 0; p < 9; p++) fire("shot", { shooter: "P", weaponId: "breaker", origin: at(0, 0, 0), dir: [0, 0, -1], hit: p % 3 === 0 ? { pos: at(0, 0, -6), normal: [0, 0, 1], surface: "flesh", entity: 7, part: p === 6 ? "head" : "body" } : null, tracer: true, pellet: p, firstShot: true });
      for (let p = 1; p < 9; p++) fire("shot", { shooter: 7, weaponId: "breaker", origin: at(4, 0, -12), dir: [0, 0, 1], hit: null, tracer: false, pellet: p, firstShot: true });
      fire("reload", { who: "P", weaponId: "breaker", phase: "start", duration: 3.4, empty: false });
      fire("reload", { who: "P", weaponId: "breaker", phase: "shell", mag: 5, reserve: 25 });
      fire("reload", { who: "P", weaponId: "breaker", phase: "shell", mag: 6, reserve: 24 });
      fire("reload", { who: "P", weaponId: "breaker", phase: "done", duration: 3.4 });
      fire("switch", { who: "P", from: "pike", to: "breaker" });
      fire("switch", { who: "P", from: "breaker", to: "corvus" });
      fire("empty", { who: "P", weaponId: "breaker" });

      // whiz-by
      fire("whiz", { pos: at(0.8, 0.2, -1), dist: 0.8 });
      fire("whiz", { pos: at(-1.5, 0, 1), dist: 1.5 });

      // footsteps on every surface (player + positional bot)
      for (const s of ["concrete", "metal", "dirt", "wood", "glass"]) {
        fire("step", { who: "P", surface: s, sprint: false });
        fire("step", { who: 7, surface: s, sprint: true });
        await wait(45);
      }

      // foley chain
      fire("reload", { who: "P", weaponId: "warden", phase: "start", duration: 2.1, empty: true });
      fire("ads", { on: true });
      fire("empty", { who: "P", weaponId: "pike" });
      fire("switch", { who: "P", from: "warden", to: "pike" });
      fire("land", { who: "P", height: 2.2 });
      fire("hurt", { victim: "P", attacker: 7, amount: 24, hp: 30, part: "body", dir: [0, 0, 1] });
      fire("bark", { botId: 7, kind: "contact" });
      fire("bark", { botId: 8, kind: "grenade" });

      // grenade + explosion (tinnitus + duck path)
      fire("grenade", { phase: "out", who: 7, pos: at(4, 0, -6) });
      fire("grenade", { phase: "bounce", who: 7, pos: at(2, 0, -4) });
      fire("grenade", { phase: "land", who: 7, pos: at(2, 0, -3) });
      fire("explosion", { pos: at(2, 0, -3), radius: 5.5, source: "grenade" });

      // objective + music: engage combat layer, then resolve
      fire("objective", { id: "obj_x", state: "active", label: "test" });
      fire("mission:phase", { phase: "assault", prev: "infil" });
      music.setEngagedForTest(3);
      await wait(1200);
      fire("death", { victim: 7, attacker: "P", headshot: true, pos: at(6, 0, -10), dir: [0, 0, 1] });
      music.setEngagedForTest(0);
      fire("objective", { id: "obj_x", state: "done", label: "test" });
      fire("mission:end", { result: "won", stats: {} });
      await wait(700);

      // hp muffle sweep exercised directly (update() reads live sim hp)
      try {
        const t = ac.currentTime;
        buses.hpMuffle.frequency.setTargetAtTime(1100, t, 0.12);
        heartbeat(0.2);
        buses.hpMuffle.frequency.setTargetAtTime(20000, t + 0.3, 0.4);
      } catch (e) { err(e, "muffle"); }
      await wait(400);

      // H1 breathing paths: loop start → one cycle → stop, then recovery cue.
      // Any AudioParam exception lands in `errors` and fails the gate.
      breathStart();
      breathCycle(0.8);
      await wait(250);
      breathStop();
      recoverBreath();
      await wait(300);

      // 2026-11-13 paths: the distance model across every layer boundary, the
      // suppressed profile, indoor shooters, the events that used to be silent,
      // the stingers, the UI samples and the folded-in streak cues.
      for (const dd of [8, 30, 60, 110, 170, 260]) {
        fire("shot", { shooter: 20 + dd, weaponId: dd % 2 ? "corvus" : "warden", origin: at(dd * 0.3, 0, -dd), dir: [0, 0, 1], hit: null, tracer: false, pellet: 0, firstShot: true });
      }
      fire("shot", { shooter: 40, weaponId: "vesper", origin: at(-20, 0, -40), dir: [0, 0, 1], hit: null, tracer: false, pellet: 0 });
      fire("shot", { shooter: "P", weaponId: "vesper", origin: at(0, 0, 0), dir: [0, 0, -1], hit: null, tracer: false, pellet: 0, firstShot: true });
      fire("shot", { shooter: "P", weaponId: "pike", origin: at(0, 0, 0), dir: [0, 0, -1], hit: null, tracer: false, pellet: 0, firstShot: true });
      fire("zone", { reverbZone: "warehouse" });
      fire("shot", { shooter: "P", weaponId: "warden", origin: at(0, 0, 0), dir: [0, 0, -1], hit: null, tracer: false, pellet: 0, firstShot: true });
      fire("zone", { reverbZone: "exterior" });
      fire("respawn", { who: "P", actorId: 0, team: 0, pos: at(0, -1.6, 0) });
      fire("resupply", { who: "P", mags: 1 });
      fire("loot", { phase: "spawn", id: 1, kind: "weapon", weapon: "warden", pos: at(3, -1.4, -4) });
      fire("grenade", { phase: "land", who: 8, pos: at(2, -1.4, -2) });          // → warning tick
      try { sfx.grenadePin(); sfx.cookTick(1); sfx.cookTick(2); } catch (e) { err(e, "selftest:cook"); }
      try { sfx.onLand({ who: "P", height: 3 }); } catch (e) { err(e, "selftest:land"); }
      for (const k of ["click", "back", "confirm", "error", "hover"]) audio.ui(k);
      for (const k of ["leadTaken", "victory", "defeat", "draw", "finalKill"]) music.stinger(k);
      music.missionEnd("draw", { finalKill: false });
      const H2 = {};
      for (const a of ctx.__audioExtra || []) a.attach({ register: (n, f) => { (H2[n] = H2[n] || []).push(f); } });
      const fx2 = (n, d, t) => { for (const f of H2[n] || []) f(d, t); };
      fx2("streak", { phase: "earned", tier: 1, id: "recon", name: "x", count: 3, stock: 1 });
      fx2("streak", { phase: "call", tier: 2, id: "mortar", target: at(10, -1.6, -30), eta: 2, plan: [{ t: 12.0, pos: at(10, -1.6, -30) }, { t: 12.5, pos: at(14, -1.6, -28) }] }, 10.0);
      fx2("streak", { phase: "call", tier: 3, id: "airstrike", target: at(0, -1.6, -40), eta: 3, dir: [0, -1], plan: [{ t: 23.0, pos: at(0, -1.6, -40) }] }, 20.0);
      fx2("streak", { phase: "sweep", contacts: [{ id: 1 }, { id: 2 }] });
      fx2("medal", { kind: "multi" });
      fx2("flag", { state: "taken", team: 1 });
      fx2("match:state", { phase: "live" });
      fx2("pickup", { who: "P", kind: "ammo" });
      fx2("pickup", { who: "P", kind: "weapon", weaponId: "vesper" });
      for (const a of ctx.__audioExtra || []) if (a.cue) a.cue("clock10");
      await wait(400);

      return {
        ok: errors.length === 0,
        ctxState: ac.state,
        errors: errors.slice(0, 40),
        voices: env.voices,
        buffersLoaded: sfx.bufferCount(),
        cameraZone,
        musicMode: music.mode(),
        stats: audio.sfxStats(),
      };
    },
  };

  // tiny global hook for other lanes: ctx.audio.ui("click"|"back"|"confirm"|
  // "error"|"hover") — and the rest of the surface (also at __FPS__.audio)
  if (!ctx.audio) ctx.audio = audio;

  // selftest dispatch table — bound to the SAME functions attach() registers
  const testHooks = {
    shot: (d, t) => sfx && sfx.onShot(d, t),
    hurt: (d) => sfx && sfx.onHurt(d),
    death: (d) => { if (sfx) { sfx.onDeath(d); if (d.victim === "P") music.playerDeath(); } },
    reload: (d) => sfx && sfx.onReload(d),
    switch: (d) => sfx && sfx.onSwitch(d),
    ads: (d) => sfx && sfx.onAds(d),
    step: (d) => sfx && sfx.onStep(d),
    land: (d) => sfx && sfx.onLand(d),
    empty: (d) => sfx && sfx.onEmpty(d),
    bark: (d) => sfx && sfx.onBark(d),
    objective: (d) => sfx && sfx.onObjective(d),
    whiz: (d) => sfx && sfx.onWhiz(d),
    zone: (d) => setCameraZone(d.reverbZone),
    explosion: (d) => { if (sfx) { sfx.onExplosion(d); tinnitusLast = -100; tinnitus(); tinnitusLast = ac.currentTime; } },
    grenade: (d) => sfx && sfx.onGrenade(d),
    respawn: (d) => sfx && sfx.onRespawn(d),
    resupply: (d) => sfx && sfx.onResupply(d),
    loot: (d) => sfx && sfx.onLoot(d),
    "mission:phase": (d) => music && music.onPhase(d),
    "mission:end": (d) => music && music.missionEnd(d.result === "won"),
  };
  // guard the test hooks too — a selftest exception is DATA, not a crash
  for (const k of Object.keys(testHooks)) {
    const fn = testHooks[k];
    testHooks[k] = (d) => { try { fn(d); } catch (e) { err(e, "selftest:" + k); } };
  }

  function applyVolumes() {
    if (!ac || !buses) return;
    const t = ac.currentTime;
    buses.sfx.gain.setTargetAtTime(gclamp(ctx.settings.sfx), t, 0.03);
    if (buses.cue) buses.cue.gain.setTargetAtTime(gclamp(ctx.settings.sfx), t, 0.03);
    buses.music.gain.setTargetAtTime(gclamp(ctx.settings.music), t, 0.03);
    buses.ambience.gain.setTargetAtTime(gclamp(ctx.settings.ambience), t, 0.03);
  }
  ctx.onChange("sfx", applyVolumes);
  ctx.onChange("music", applyVolumes);
  ctx.onChange("ambience", applyVolumes);

  // ---- LEAD TAKEN / LOST (match:score) ---------------------------------------
  // Standing from the frozen match state: 2 teams → my team vs the other; FFA →
  // my score vs the best other score. Taking the lead (from tied or behind, with
  // points on the board) and losing it (from leading to tied or behind) play the
  // music stingers; music.stinger() rate-limits flip-flopping to one per 4 s.
  function standing() {
    const s = ctx.sim && ctx.sim();
    const m = s && s.state && s.state.match;
    if (!m || !m.actors || (m.phase !== "live" && m.phase !== "overtime")) return null;
    const me = m.actors.find((a) => a && (a.who === "P" || a.kind === "human"));
    if (!me) return null;
    let mine, best = -Infinity;
    if (m.teams && m.teams.length === 2) {
      for (const t of m.teams) { if (t.id === me.team) mine = fin(t.score, 0); else best = Math.max(best, fin(t.score, 0)); }
    } else {
      mine = fin(me.score, 0);
      for (const a of m.actors) if (a !== me) best = Math.max(best, fin(a.score, 0));
    }
    if (!Number.isFinite(best) || mine == null) return null;
    return { s: mine > best ? 1 : mine < best ? -1 : 0, total: mine + Math.max(0, best) };
  }
  function leadCheck() {
    const r = standing();
    if (!r) return;
    if (r.s === 1 && lead !== 1 && r.total > 0) { if (music.stinger("leadTaken")) leadCues++; }
    else if (r.s !== 1 && lead === 1) { if (music.stinger("leadLost")) leadCues++; }
    lead = r.s;
  }

  // ---- UI SOUNDS for the menu / pause / settings / scoreboard overlays ------------
  // Those files belong to other lanes, so instead of calls in their click
  // handlers ONE delegated document listener (capture phase, so a handler that
  // stops propagation cannot starve it) classifies the button: Back/Cancel/
  // Resume → "back", Deploy/Start/Confirm/Rematch → "confirm", disabled →
  // "error", anything else → "click"; a pointer moving onto a new button →
  // "hover" (quiet). Anyone can also call ctx.audio.ui(kind) /
  // __FPS__.audio.ui(kind) directly.
  const UI_SCOPE = "#menu, #pause-overlay, #settings-overlay, #mboard, .a10-overlay";
  const UI_BACK = /^(back|cancel|resume|close|quit)$/i;
  const UI_CONFIRM = /^(deploy|startmatch|start|confirm|rematch|play|apply)$/i;
  let uiHoverEl = null, uiHoverT = 0, uiClickT = 0;
  function uiTarget(e) {
    const el = e && e.target && e.target.closest ? e.target.closest("button, [data-a], [data-o], [data-cdiff], [role=button]") : null;
    if (!el || !el.closest(UI_SCOPE)) return null;
    return el;
  }
  function uiKindOf(el) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return "error";
    const a = (el.getAttribute("data-a") || "").trim();
    if (UI_BACK.test(a)) return "back";
    if (UI_CONFIRM.test(a)) return "confirm";
    return "click";
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", (e) => {
      try {
        const el = uiTarget(e);
        if (!el || !ac || !sfx) return;
        const now = performance.now();
        if (now - uiClickT < 40) return;                   // one sound per click
        uiClickT = now;
        sfx.ui(uiKindOf(el));
      } catch (er) { err(er, "ui:click"); }
    }, true);
    document.addEventListener("pointerover", (e) => {
      try {
        if (!ac || !sfx || (e.pointerType && e.pointerType !== "mouse")) return;
        const el = uiTarget(e);
        if (!el || el === uiHoverEl) return;
        uiHoverEl = el;
        const now = performance.now();
        if (now - uiHoverT < 60 || el.disabled) return;
        uiHoverT = now;
        sfx.ui("hover");
      } catch (er) { err(er, "ui:hover"); }
    }, true);
  }

  // §6: explosion ≤ 6 m — 2.2 s tinnitus ring + duck −10 dB (rings through the
  // duck/muffle by feeding the limiter input directly)
  function tinnitus() {
    try {
      const t = ac.currentTime;
      buses.duck.gain.cancelScheduledValues(t);
      buses.duck.gain.setTargetAtTime(0.32, t, 0.03);            // ≈ −10 dB
      buses.duck.gain.setTargetAtTime(1, t + 0.8, 0.45);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = 3500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + 2.2);
      o.connect(g); g.connect(buses.limiter);
      o.start(t); o.stop(t + 2.25);
      env.voices++;
    } catch (e) { err(e, "tinnitus"); }
  }

  // ---- H1 laboured breathing (2026-08-25, owner request) --------------------
  // Persistent noise loop; each cycle schedules an inhale (rising, brighter)
  // and a heavier exhale (louder, darker) on the shared gain/filter. depth 0..1
  // scales rate (23 → 37 breaths/min) and volume. Linear ramps only (lane rule).
  function breathStart() {
    if (breathSrc || !ac || !buses) return;
    try {
      breathSrc = ac.createBufferSource();
      breathSrc.buffer = env.noiseBuf();
      breathSrc.loop = true;
      breathFilt = ac.createBiquadFilter();
      breathFilt.type = "bandpass"; breathFilt.frequency.value = 620; breathFilt.Q.value = 0.9;
      breathGain = ac.createGain(); breathGain.gain.value = 0;
      breathSrc.connect(breathFilt); breathFilt.connect(breathGain);
      breathGain.connect(buses.limiter);
      breathSrc.start();
      breathNext = ac.currentTime + 0.12;
    } catch (e) { err(e, "breath:start"); breathSrc = null; breathGain = null; breathFilt = null; }
  }
  function breathStop() {
    if (!breathSrc) return;
    const s = breathSrc, g = breathGain;
    breathSrc = null; breathGain = null; breathFilt = null;
    try {
      g.gain.cancelScheduledValues(ac.currentTime);
      g.gain.setTargetAtTime(0, ac.currentTime, 0.15);
      setTimeout(() => { try { s.stop(); } catch (e) {} }, 900);
    } catch (e) {}
  }
  function breathCycle(depth) {
    try {
      const d = Math.min(1, Math.max(0, fin(depth, 0)));
      const t = Math.max(ac.currentTime, breathNext);
      const cyc = 2.6 - 1.0 * d;                    // full cycle length, s
      const inD = cyc * 0.32, exD = cyc * 0.42;     // rest of the cycle = gap
      const peak = 0.045 + 0.105 * d;
      const g = breathGain.gain, f = breathFilt.frequency;
      // inhale — rising, brighter
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(gclamp(peak), t + inD * 0.7);
      g.linearRampToValueAtTime(gclamp(peak * 0.25), t + inD);
      f.setValueAtTime(520, t);
      f.linearRampToValueAtTime(920, t + inD);
      // exhale — heavier, darker
      g.linearRampToValueAtTime(gclamp(peak * 1.25), t + inD + exD * 0.35);
      g.linearRampToValueAtTime(0.0001, t + inD + exD);
      f.linearRampToValueAtTime(420, t + inD + exD);
      breathNext = t + cyc;
      lastBreathT = t;
      env.voices++;
    } catch (e) { err(e, "breath:cycle"); }
  }
  // one-shot soft inhale/exhale when regen completes after a low episode
  function recoverBreath() {
    try {
      const t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = env.noiseBuf(); src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = "bandpass"; f.Q.value = 0.8;
      f.frequency.setValueAtTime(680, t);
      f.frequency.linearRampToValueAtTime(980, t + 0.5);   // inhale opens
      f.frequency.linearRampToValueAtTime(380, t + 1.6);   // exhale settles
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.45);     // soft inhale
      g.gain.linearRampToValueAtTime(0.012, t + 0.7);
      g.gain.linearRampToValueAtTime(0.055, t + 0.95);     // long exhale
      g.gain.linearRampToValueAtTime(0.0001, t + 1.8);
      src.connect(f); f.connect(g); g.connect(buses.limiter);
      src.start(t); src.stop(t + 1.9);
      env.voices++;
    } catch (e) { err(e, "breath:recover"); }
  }

  // low double-thump heartbeat under the muffle (feeds limiter directly)
  function heartbeat(gain) {
    try {
      const t = ac.currentTime;
      for (let i = 0; i < 2; i++) {
        const o = ac.createOscillator(), g = ac.createGain();
        const t0 = t + i * 0.14;
        o.type = "sine";
        o.frequency.setValueAtTime(64, t0);
        o.frequency.linearRampToValueAtTime(40, t0 + 0.1);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(gclamp(gain) * (i === 0 ? 1 : 0.6), t0 + 0.015);
        g.gain.linearRampToValueAtTime(0, t0 + 0.12);
        o.connect(g); g.connect(buses.limiter);
        o.start(t0); o.stop(t0 + 0.14);
      }
      env.voices++;
    } catch (e) { err(e, "heartbeat"); }
  }

  return audio;
}
