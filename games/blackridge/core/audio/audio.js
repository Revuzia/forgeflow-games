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
const ZONES = {
  exterior:   { rt60: 0.25, pre: 0.090, wet: 0.14, slap: true },
  warehouse:  { rt60: 1.10, pre: 0.018, wet: 0.30, slap: false },
  corridor:   { rt60: 0.50, pre: 0.008, wet: 0.26, flutter: true },
  small_room: { rt60: 0.35, pre: 0.005, wet: 0.22, slap: false },
};

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
        for (let i = 0; i < sr * 0.02; i++) d[i] = (rngS() * 2 - 1) * 0.5 * (1 - i / (sr * 0.02));
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
      // brickwall so a pellet burst + explosion can never clip in hardware
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.003; limiter.release.value = 0.12;
      master.connect(duck); duck.connect(hpMuffle); hpMuffle.connect(limiter);
      limiter.connect(ac.destination);

      const sfxBus = ac.createGain(); sfxBus.gain.value = gclamp(ctx.settings.sfx);
      const musicBus = ac.createGain(); musicBus.gain.value = gclamp(ctx.settings.music);
      const ambBus = ac.createGain(); ambBus.gain.value = gclamp(ctx.settings.ambience);
      sfxBus.connect(master); musicBus.connect(master); ambBus.connect(master);
      const sfxDry = ac.createGain(); sfxDry.gain.value = 1; sfxDry.connect(sfxBus);

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

      buses = { master, duck, hpMuffle, limiter, sfx: sfxBus, sfxDry, music: musicBus, ambience: ambBus };

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
      bridge.register("shot", safe("shot", (d) => sfx.onShot(d)));
      bridge.register("hurt", safe("hurt", (d) => sfx.onHurt(d)));
      bridge.register("death", safe("death", (d) => {
        sfx.onDeath(d);
        if (d && d.victim === "P") music.playerDeath();
        else if (d && engaged.delete(d.victim) && engaged.size === 0) music.squadWiped();
      }));
      bridge.register("reload", safe("reload", (d) => sfx.onReload(d)));
      bridge.register("switch", safe("switch", (d) => sfx.onSwitch(d)));
      bridge.register("ads", safe("ads", (d) => sfx.onAds(d)));
      bridge.register("step", safe("step", (d) => sfx.onStep(d)));
      bridge.register("land", safe("land", (d) => sfx.onLand(d)));
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
      }));
      bridge.register("mission:phase", safe("mission:phase", (d) => music.onPhase(d)));
      bridge.register("mission:end", safe("mission:end", (d) => {
        sfx.reset();
        music.missionEnd(d && d.result === "won");
        engaged.clear();
      }));
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

      // hp muffle + heartbeat (combat_spec §6)
      if (st && st.player) {
        const hp = fin(st.player.hp, 100);
        const t = ac.currentTime;
        if (hp < 35 && st.player.alive) {
          const f = 1100 + 18900 * Math.max(0, hp / 35);
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

        // §7.4 slide scrape: crouched at near-sprint speed = sliding (heuristic
        // read of frozen state; there is no slide event in the vocabulary)
        const sliding = st.player.stance === "crouch" && fin(st.player.speedNorm, 0) > 0.72 && st.player.grounded;
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
    ui(kind) { if (ac && sfx) { try { sfx.ui(kind); } catch (e) { err(e, "ui"); } } },
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

      return {
        ok: errors.length === 0,
        ctxState: ac.state,
        errors: errors.slice(0, 40),
        voices: env.voices,
        buffersLoaded: sfx.bufferCount(),
        cameraZone,
        musicMode: music.mode(),
      };
    },
  };

  // selftest dispatch table — bound to the SAME functions attach() registers
  const testHooks = {
    shot: (d) => sfx && sfx.onShot(d),
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
    buses.music.gain.setTargetAtTime(gclamp(ctx.settings.music), t, 0.03);
    buses.ambience.gain.setTargetAtTime(gclamp(ctx.settings.ambience), t, 0.03);
  }
  ctx.onChange("sfx", applyVolumes);
  ctx.onChange("music", applyVolumes);
  ctx.onChange("ambience", applyVolumes);

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
