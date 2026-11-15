// core/audio/streak_audio.js — small synthesized cues for the loot + killstreak
// systems (pick-up click, call-in radio blip + incoming whistle / jet roar, streak
// earned chime, medal tick) and the match cues (flag, phase, clock). The strike
// EXPLOSIONS use the game's normal explosion audio; these are only the lead-ins
// and UI feedback.
//
// 2026-11-13 — FOLDED INTO THE MAIN GRAPH. This module used to run its OWN
// AudioContext (own compressor → destination), so its cues bypassed the master
// limiter, the explosion duck and the low-health muffle, and it scheduled with
// exponentialRampToValueAtTime, which the audio lane forbids (it throws at or
// near 0). Now:
//   * it shares the main context: audio.js publishes ctx.__audioCore (the env:
//     ac, buses, spatial(), noiseBuf()) at createAudio() time, which boot runs
//     BEFORE createStreakAudio(); nothing here constructs an AudioContext;
//   * UI-type cues (earned chime, medals, flag/phase/clock stings, radio blips,
//     ammo pickup) go to buses.cue — the LIMITER input, scaled by the SFX
//     slider — so, like the hit ticks, they stay legible under the low-health
//     muffle and the explosion duck;
//   * WORLD sounds (the incoming mortar/artillery whistles, the jet, the drone
//     rotor, a weapon being snatched up) go through env.spatial() into the sfx
//     bus: positional at the TARGET, reverbed, ducked and muffled like any gun;
//   * linear ramps + setTargetAtTime only; every value through fin()/gclamp().
// If the core is absent (a harness without audio.js) every cue is a silent no-op.

export function createStreakAudio(ctx) {
  const core = () => {
    const c = ctx && ctx.__audioCore;
    const env = c && c.env;
    return env && env.ac && env.buses ? env : null;
  };
  const fin = (v, fb) => (Number.isFinite(v) ? v : fb);
  const gcl = (v) => Math.min(2, Math.max(0, fin(v, 0)));
  const stats = { cues: 0, world: 0, errors: 0 };
  let lastErr = null;

  // UI cue node: → buses.cue (limiter input, SFX slider). 0.42 = this module's
  // historical master level, kept so relative balance with the HUD is unchanged.
  function uiOut(env) {
    const g = env.ac.createGain();
    g.gain.value = 0.42;
    g.connect(env.buses.cue || env.buses.limiter || env.buses.sfx);
    return g;
  }

  // shared envelope: linear attack, exponential-shaped decay via setTargetAtTime,
  // pinned to the exact reached value and linear-ramped to true 0 at the end
  function env3(param, t0, dur, peak, swell) {
    const atk = swell ? dur * 0.85 : Math.min(0.012, dur * 0.2);
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(gcl(peak), t0 + atk);
    const rest = Math.max(0.005, dur - atk);
    if (swell) { param.linearRampToValueAtTime(0, t0 + dur); return; }
    const tau = rest / 4;
    param.setTargetAtTime(0, t0 + atk, tau);
    param.setValueAtTime(gcl(peak * Math.exp(-Math.max(0, rest - 0.012) / tau)), t0 + dur - 0.012);
    param.linearRampToValueAtTime(0, t0 + dur);
  }

  function tone(out, freq, dur, type = "sine", gain = 0.3, when = 0, slideTo = null) {
    const env = core();
    if (!env || !out) return;
    try {
      const ac = env.ac;
      const t0 = ac.currentTime + Math.max(0, fin(when, 0));
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, fin(freq, 440)), t0);
      if (slideTo) o.frequency.linearRampToValueAtTime(Math.max(20, fin(slideTo, freq)), t0 + dur);
      env3(g.gain, t0, Math.max(0.02, fin(dur, 0.1)), gain, false);
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0 + dur + 0.05);
      env.voices++;
    } catch (e) { stats.errors++; lastErr = e && e.message; }
  }

  function noise(out, dur, f0, f1, gain, when = 0, q = 1.2, swell = false) {
    const env = core();
    if (!env || !out) return;
    try {
      const ac = env.ac;
      const t0 = ac.currentTime + Math.max(0, fin(when, 0));
      const s = ac.createBufferSource();
      s.buffer = env.noiseBuf(); s.loop = true;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass"; bp.Q.value = q;
      bp.frequency.setValueAtTime(Math.max(40, fin(f0, 1000)), t0);
      bp.frequency.linearRampToValueAtTime(Math.max(40, fin(f1, f0)), t0 + dur);
      const g = ac.createGain();
      env3(g.gain, t0, Math.max(0.02, fin(dur, 0.1)), gain, swell);
      s.connect(bp); bp.connect(g); g.connect(out);
      s.start(t0); s.stop(t0 + dur + 0.05);
      env.voices++;
    } catch (e) { stats.errors++; lastErr = e && e.message; }
  }

  // a UI cue: run fn(out) against a fresh cue-bus node
  function ui(fn) {
    const env = core();
    if (!env) return;
    try { stats.cues++; fn(uiOut(env)); } catch (e) { stats.errors++; lastErr = e && e.message; }
  }
  // a world cue at pos (null = head-relative), through the sfx bus
  function world(pos, maxD, gain, fn) {
    const env = core();
    if (!env) return;
    try {
      const out = env.spatial(pos || null, maxD);
      if (!out) return;
      out.gain.value = gcl(out.gain.value * gain);
      stats.world++;
      fn(out);
    } catch (e) { stats.errors++; lastErr = e && e.message; }
  }

  // ---- positional strike lead-ins ------------------------------------------------
  // INCOMING SHELL: a falling whistle that ends at the impact, placed AT the
  // impact point (the panner + distance curve of env.spatial), so a mortar
  // dropping 30 m to your left is heard to your left and quieter than one on top
  // of you. `delay` = seconds from now to impact.
  function shellWhistle(pos, delay, big) {
    const len = Math.min(1.25, Math.max(0.35, delay - 0.02));
    const start = Math.max(0, delay - len);
    world(pos, 220, big ? 1.0 : 0.85, (out) => {
      tone(out, big ? 1900 : 2300, len, "sine", 0.16, start, big ? 420 : 560);
      tone(out, big ? 1915 : 2318, len, "sine", 0.05, start, big ? 425 : 566);   // beating partner
      noise(out, len, 3200, 900, 0.09, start, 2.5, true);                         // air rush swelling in
    });
  }
  // JET: one positional source FLOWN along the bomb run (panner position
  // automation; the panner here uses an inverse distance model so the pass-by
  // swells and fades on its own), a roar band-pass that sweeps down through the
  // pass (fake doppler — Web Audio has none) and a low engine saw.
  function jetPass(target, dir, passDelay) {
    const env = core();
    if (!env || !target) return;
    try {
      const ac = env.ac;
      const t0 = ac.currentTime;
      const tPass = t0 + Math.max(0.6, passDelay);
      const tA = Math.max(t0 + 0.05, tPass - 2.6), tB = tPass + 2.6;
      const dx = fin(dir && dir[0], 1), dz = fin(dir && dir[1], 0);
      const n = Math.hypot(dx, dz) || 1;
      const ux = dx / n, uz = dz / n;
      const y = fin(target[1], 0) + 70;
      const ax = fin(target[0], 0) - ux * 380, az = fin(target[2], 0) - uz * 380;
      const bx = fin(target[0], 0) + ux * 380, bz = fin(target[2], 0) + uz * 380;
      const p = ac.createPanner();
      p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 60; p.rolloffFactor = 1.2;
      if (p.positionX) {
        p.positionX.setValueAtTime(ax, tA); p.positionX.linearRampToValueAtTime(bx, tB);
        p.positionY.setValueAtTime(y, tA);
        p.positionZ.setValueAtTime(az, tA); p.positionZ.linearRampToValueAtTime(bz, tB);
      } else p.setPosition(fin(target[0], 0), y, fin(target[2], 0));
      p.connect(env.buses.sfxDry);
      const g = ac.createGain(); g.gain.value = 1; g.connect(p);
      const dur = tB - tA;
      // roar
      const s = ac.createBufferSource(); s.buffer = env.noiseBuf(); s.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(1500, tA);
      bp.frequency.linearRampToValueAtTime(1900, tPass - 0.2);
      bp.frequency.linearRampToValueAtTime(650, tPass + 0.5);
      bp.frequency.linearRampToValueAtTime(420, tB);
      const rg = ac.createGain();
      rg.gain.setValueAtTime(0, tA);
      rg.gain.linearRampToValueAtTime(0.4, tA + 0.8);
      rg.gain.setValueAtTime(0.4, tB - 0.6);
      rg.gain.linearRampToValueAtTime(0, tB);
      s.connect(bp); bp.connect(rg); rg.connect(g);
      s.start(tA); s.stop(tB + 0.05);
      // engine whine, falling through the pass
      const o = ac.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(210, tA);
      o.frequency.linearRampToValueAtTime(240, tPass - 0.15);
      o.frequency.linearRampToValueAtTime(150, tPass + 0.4);
      o.frequency.linearRampToValueAtTime(130, tB);
      const of = ac.createBiquadFilter(); of.type = "lowpass"; of.frequency.value = 900;
      const og = ac.createGain();
      og.gain.setValueAtTime(0, tA);
      og.gain.linearRampToValueAtTime(0.08, tA + 0.8);
      og.gain.setValueAtTime(0.08, tB - 0.6);
      og.gain.linearRampToValueAtTime(0, tB);
      o.connect(of); of.connect(og); og.connect(g);
      o.start(tA); o.stop(tB + 0.05);
      env.voices += 2;
      stats.world++;
      void dur;
    } catch (e) { stats.errors++; lastErr = e && e.message; }
  }

  const handlers = {
    pickup(d) {
      if (!d || d.who !== "P") return;
      if (d.kind === "ammo") {
        ui((o) => { tone(o, 1500, 0.05, "square", 0.12); tone(o, 1150, 0.06, "square", 0.10, 0.07); noise(o, 0.05, 3000, 1800, 0.16, 0.0); });
        const c = ctx.__audioCore && ctx.__audioCore.sfx;
        if (c && c.ammoRattle) { try { c.ammoRattle(0.7); } catch (e) {} }
      } else {
        // metal "clack-clack" of a weapon being snatched up (world, head-relative)
        world(null, 0, 0.42, (o) => {
          noise(o, 0.07, 2600, 900, 0.30, 0.0, 2.0);
          tone(o, 780, 0.07, "square", 0.14, 0.0, 420);
          noise(o, 0.09, 2000, 700, 0.26, 0.11, 2.0);
          tone(o, 520, 0.1, "triangle", 0.16, 0.11, 300);
        });
      }
    },
    streak(d, t) {
      if (!d) return;
      if (d.phase === "earned") {
        ui((o) => {
          tone(o, 660, 0.14, "sine", 0.26, 0.0); tone(o, 880, 0.14, "sine", 0.26, 0.11); tone(o, 1320, 0.30, "sine", 0.28, 0.22);
          tone(o, 1320, 0.34, "triangle", 0.10, 0.22);
        });
      } else if (d.phase === "sweep") {
        // sonar-style sweep: a falling ping, plus one soft tick per contact found
        ui((o) => {
          tone(o, 1900, 0.32, "sine", 0.13, 0.0, 950);
          tone(o, 3800, 0.05, "sine", 0.05, 0.0);
          const n = Math.min(6, (d.contacts && d.contacts.length) | 0);
          for (let i = 0; i < n; i++) tone(o, 1400, 0.04, "triangle", 0.07, 0.30 + i * 0.06);
        });
      } else if (d.id === "recon" && d.phase === "done") {
        ui((o) => tone(o, 900, 0.18, "sine", 0.10, 0.0, 450));
      } else if (d.phase === "denied") {
        ui((o) => tone(o, 150, 0.14, "sawtooth", 0.18));
      } else if (d.phase === "call") {
        // radio confirm blips (UI), then the weapon-specific incoming sound (WORLD)
        ui((o) => { tone(o, 1250, 0.06, "square", 0.14, 0.0); tone(o, 1250, 0.06, "square", 0.14, 0.11); tone(o, 1700, 0.09, "square", 0.14, 0.24); });
        const eta = Math.max(0.8, fin(d.eta, 2.4));
        const simNow = fin(t, NaN);
        // seconds from NOW until plan[i] — the plan carries sim times; fall back
        // to eta + the plan's own spacing when the bridge gave no event time
        const p0 = d.plan && d.plan.length ? fin(d.plan[0].t, 0) : 0;
        const until = (q) => Number.isFinite(simNow) ? fin(q.t, simNow + eta) - simNow : eta + (fin(q.t, p0) - p0);
        if (d.id === "recon") {
          // rotor whine spinning up as the drone launches (overhead, head-relative)
          world(null, 0, 0.42, (o) => {
            tone(o, 180, 1.4, "sawtooth", 0.05, 0.3, 420);
            noise(o, 1.3, 600, 1800, 0.10, 0.3, 4.0, true);
          });
        } else if (d.id === "airstrike") {
          const first = d.plan && d.plan.length ? until(d.plan[0]) : eta;
          jetPass(d.target, d.dir, first - 0.25);
        } else {
          // mortar / barrage: one whistle per round AT its impact point (capped)
          const plan = (d.plan || []).filter((q) => q && q.pos).slice(0, 8);
          if (plan.length) for (const q of plan) shellWhistle(q.pos, until(q), d.id !== "mortar");
          else if (d.target) shellWhistle(d.target, eta, false);
        }
      }
    },
    // MATCH CUES (2026-10-14 review: flag / phase / clock events had no audio at
    // all). Synth stings, team-aware: YOUR flag in trouble sounds like trouble.
    flag(d) {
      if (!d) return;
      const s = ctx.sim && ctx.sim();
      const mine = s && s.state && s.state.player && (d.team | 0) === (s.state.player.team | 0);
      ui((o) => {
        if (d.state === "taken") {
          if (mine) { tone(o, 440, 0.16, "square", 0.12); tone(o, 330, 0.30, "square", 0.12, 0.17); }       // alarm
          else { tone(o, 660, 0.10, "triangle", 0.18); tone(o, 990, 0.20, "triangle", 0.18, 0.1); }
        } else if (d.state === "captured") {
          if (mine) { tone(o, 392, 0.25, "sawtooth", 0.10); tone(o, 262, 0.55, "sawtooth", 0.10, 0.22); }
          else { tone(o, 523, 0.14, "triangle", 0.22); tone(o, 659, 0.14, "triangle", 0.22, 0.12); tone(o, 784, 0.14, "triangle", 0.22, 0.24); tone(o, 1046, 0.45, "triangle", 0.24, 0.36); }
        } else if (d.state === "returned" || d.state === "reset") {
          if (mine) { tone(o, 784, 0.10, "sine", 0.16); tone(o, 1046, 0.22, "sine", 0.16, 0.1); }
        } else if (d.state === "dropped") {
          tone(o, 560, 0.12, "triangle", 0.12); tone(o, 420, 0.18, "triangle", 0.10, 0.12);
        }
      });
    },
    "match:state"(d) {
      if (!d) return;
      ui((o) => {
        if (d.phase === "live") {            // go horn
          tone(o, 220, 0.9, "sawtooth", 0.07); tone(o, 330, 0.9, "sawtooth", 0.05); noise(o, 0.9, 400, 900, 0.06, 0, 0.7);
        } else if (d.phase === "overtime") {
          for (let i = 0; i < 3; i++) { tone(o, 880, 0.12, "square", 0.10, i * 0.24); tone(o, 660, 0.12, "square", 0.10, i * 0.24 + 0.12); }
        }
      });
    },
    medal(d) {
      if (!d) return;
      ui((o) => {
        if (d.kind === "streak") { tone(o, 523, 0.12, "triangle", 0.2); tone(o, 784, 0.12, "triangle", 0.2, 0.1); tone(o, 1046, 0.26, "triangle", 0.22, 0.2); }
        else { tone(o, 1000, 0.07, "sine", 0.16); tone(o, 1500, 0.09, "sine", 0.12, 0.06); }
      });
    },
  };

  // one-shot cues other view modules can fire (match_hud: clock warnings)
  function cue(name) {
    ui((o) => {
      if (name === "clock60" || name === "clock30") { tone(o, 1000, 0.09, "sine", 0.16); tone(o, 1000, 0.09, "sine", 0.16, 0.16); }
      else if (name === "clock10") { tone(o, 1200, 0.08, "square", 0.10); tone(o, 1200, 0.08, "square", 0.10, 0.14); tone(o, 1500, 0.16, "square", 0.10, 0.28); }
      else if (name === "tick") tone(o, 1400, 0.05, "sine", 0.12);
    });
  }

  const api = {
    cue,
    attach(bridge) {
      for (const k of Object.keys(handlers)) {
        bridge.register(k, (d, t) => { try { handlers[k](d, t); } catch (e) { stats.errors++; lastErr = e && e.message; } });
      }
    },
    // harness: the context this module plays through (the MAIN one now)
    state() { const e = core(); return e ? e.ac.state : "none"; },
    stats() { return { ...stats, lastErr, sharedContext: !!core() }; },
  };
  // let the main audio selftest / probes drive these handlers too
  if (ctx) (ctx.__audioExtra || (ctx.__audioExtra = [])).push(api);
  return api;
}
