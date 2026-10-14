// core/audio/streak_audio.js — small synthesized cues for the loot + killstreak
// systems (pick-up click, call-in radio blip + incoming whistle / jet roar, streak
// earned chime, medal tick). The strike EXPLOSIONS use the game's normal explosion
// audio; these are only the lead-ins and UI feedback. Own AudioContext, created
// lazily on first use through globalThis.AudioContext so the page-level Mute
// (game_controls.js wraps the constructor) reaches it like every other voice.

export function createStreakAudio(ctx) {
  let ac = null, out = null, noiseBuf = null;

  // (2026-10-14) these cues used to ignore the SFX slider entirely
  function level() {
    const v = ctx && ctx.settings && ctx.settings.sfx;
    const vol = typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    if (out) out.gain.value = 0.42 * vol;
    return vol;
  }

  function ensure() {
    if (typeof document !== "undefined" && document.hidden) return null;
    if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); level(); return ac; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ac = new AC();
      out = ac.createGain();
      out.gain.value = 0.42;
      level();
      const comp = ac.createDynamicsCompressor();
      out.connect(comp); comp.connect(ac.destination);
      const len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
    return ac;
  }

  function tone(freq, dur, type = "sine", gain = 0.3, when = 0, slideTo = null) {
    if (!ensure()) return;
    const t0 = ac.currentTime + when;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, f0, f1, gain, when = 0, q = 1.2, swell = false) {
    if (!ensure()) return;
    const t0 = ac.currentTime + when;
    const s = ac.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    if (swell) {
      g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    s.connect(bp); bp.connect(g); g.connect(out);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  const handlers = {
    pickup(d) {
      if (!d || d.who !== "P") return;
      if (d.kind === "ammo") { tone(1500, 0.05, "square", 0.12); tone(1150, 0.06, "square", 0.10, 0.07); noise(0.05, 3000, 1800, 0.16, 0.0); }
      else {
        // metal "clack-clack" of a weapon being snatched up
        noise(0.07, 2600, 900, 0.30, 0.0, 2.0);
        tone(780, 0.07, "square", 0.14, 0.0, 420);
        noise(0.09, 2000, 700, 0.26, 0.11, 2.0);
        tone(520, 0.1, "triangle", 0.16, 0.11, 300);
      }
    },
    streak(d) {
      if (!d) return;
      if (d.phase === "earned") {
        tone(660, 0.14, "sine", 0.26, 0.0); tone(880, 0.14, "sine", 0.26, 0.11); tone(1320, 0.30, "sine", 0.28, 0.22);
        tone(1320, 0.34, "triangle", 0.10, 0.22);
      } else if (d.phase === "sweep") {
        // sonar-style sweep: a falling ping, plus one soft tick per contact found
        tone(1900, 0.32, "sine", 0.13, 0.0, 950);
        tone(3800, 0.05, "sine", 0.05, 0.0);
        const n = Math.min(6, (d.contacts && d.contacts.length) | 0);
        for (let i = 0; i < n; i++) tone(1400, 0.04, "triangle", 0.07, 0.30 + i * 0.06);
      } else if (d.id === "recon" && d.phase === "done") {
        tone(900, 0.18, "sine", 0.10, 0.0, 450);
      } else if (d.phase === "denied") {
        tone(150, 0.14, "sawtooth", 0.18);
      } else if (d.phase === "call") {
        // radio confirm blips, then the weapon-specific incoming sound
        tone(1250, 0.06, "square", 0.14, 0.0); tone(1250, 0.06, "square", 0.14, 0.11); tone(1700, 0.09, "square", 0.14, 0.24);
        const eta = Math.max(0.8, d.eta || 2.4);
        if (d.id === "recon") {
          // rotor whine spinning up as the drone launches
          tone(180, 1.4, "sawtooth", 0.05, 0.3, 420);
          noise(1.3, 600, 1800, 0.10, 0.3, 4.0, true);
        } else if (d.id === "airstrike") {
          noise(eta + 0.6, 380, 2400, 0.62, 0.4, 0.9, true);            // jet roar swelling in
          tone(130, eta, "sawtooth", 0.07, 0.4, 210);
        } else {
          tone(2300, Math.max(0.6, eta - 0.7), "sine", 0.10, 0.5, 520);  // incoming whistle
          noise(0.7, 3200, 900, 0.18, Math.max(0.4, eta - 0.9), 3.0);
        }
      }
    },
    // MATCH CUES (2026-10-14 review: flag / phase / clock events had no audio at
    // all). Synth stings, team-aware: YOUR flag in trouble sounds like trouble.
    flag(d) {
      if (!d) return;
      const s = ctx.sim && ctx.sim();
      const mine = s && s.state && s.state.player && (d.team | 0) === (s.state.player.team | 0);
      if (d.state === "taken") {
        if (mine) { tone(440, 0.16, "square", 0.12); tone(330, 0.30, "square", 0.12, 0.17); }       // alarm
        else { tone(660, 0.10, "triangle", 0.18); tone(990, 0.20, "triangle", 0.18, 0.1); }
      } else if (d.state === "captured") {
        if (mine) { tone(392, 0.25, "sawtooth", 0.10); tone(262, 0.55, "sawtooth", 0.10, 0.22); }
        else { tone(523, 0.14, "triangle", 0.22); tone(659, 0.14, "triangle", 0.22, 0.12); tone(784, 0.14, "triangle", 0.22, 0.24); tone(1046, 0.45, "triangle", 0.24, 0.36); }
      } else if (d.state === "returned" || d.state === "reset") {
        if (mine) { tone(784, 0.10, "sine", 0.16); tone(1046, 0.22, "sine", 0.16, 0.1); }
      } else if (d.state === "dropped") {
        tone(560, 0.12, "triangle", 0.12); tone(420, 0.18, "triangle", 0.10, 0.12);
      }
    },
    "match:state"(d) {
      if (!d) return;
      if (d.phase === "live") {            // go horn
        tone(220, 0.9, "sawtooth", 0.07); tone(330, 0.9, "sawtooth", 0.05); noise(0.9, 400, 900, 0.06, 0, 0.7);
      } else if (d.phase === "overtime") {
        for (let i = 0; i < 3; i++) { tone(880, 0.12, "square", 0.10, i * 0.24); tone(660, 0.12, "square", 0.10, i * 0.24 + 0.12); }
      }
    },
    medal(d) {
      if (!d) return;
      if (d.kind === "streak") { tone(523, 0.12, "triangle", 0.2); tone(784, 0.12, "triangle", 0.2, 0.1); tone(1046, 0.26, "triangle", 0.22, 0.2); }
      else { tone(1000, 0.07, "sine", 0.16); tone(1500, 0.09, "sine", 0.12, 0.06); }
    },
  };

  // one-shot cues other view modules can fire (match_hud: clock warnings)
  function cue(name) {
    try {
      if (name === "clock60" || name === "clock30") { tone(1000, 0.09, "sine", 0.16); tone(1000, 0.09, "sine", 0.16, 0.16); }
      else if (name === "clock10") { tone(1200, 0.08, "square", 0.10); tone(1200, 0.08, "square", 0.10, 0.14); tone(1500, 0.16, "square", 0.10, 0.28); }
      else if (name === "tick") tone(1400, 0.05, "sine", 0.12);
    } catch (e) { /* audio never breaks the frame */ }
  }

  return {
    cue,
    attach(bridge) {
      for (const k of Object.keys(handlers)) {
        bridge.register(k, (d) => { try { handlers[k](d); } catch (e) { /* audio must never break the frame */ } });
      }
    },
    // exposed so a harness can confirm the context exists / is running
    state() { return ac ? ac.state : "none"; },
  };
}
