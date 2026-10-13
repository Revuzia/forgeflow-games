// core/audio/streak_audio.js — small synthesized cues for the loot + killstreak
// systems (pick-up click, call-in radio blip + incoming whistle / jet roar, streak
// earned chime, medal tick). The strike EXPLOSIONS use the game's normal explosion
// audio; these are only the lead-ins and UI feedback. Own AudioContext, created
// lazily on first use through globalThis.AudioContext so the page-level Mute
// (game_controls.js wraps the constructor) reaches it like every other voice.

export function createStreakAudio(ctx) {
  let ac = null, out = null, noiseBuf = null;

  function ensure() {
    if (ac) { if (ac.state === "suspended") ac.resume().catch(() => {}); return ac; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ac = new AC();
      out = ac.createGain();
      out.gain.value = 0.42;
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
      } else if (d.phase === "denied") {
        tone(150, 0.14, "sawtooth", 0.18);
      } else if (d.phase === "call") {
        // radio confirm blips, then the weapon-specific incoming sound
        tone(1250, 0.06, "square", 0.14, 0.0); tone(1250, 0.06, "square", 0.14, 0.11); tone(1700, 0.09, "square", 0.14, 0.24);
        const eta = Math.max(0.8, d.eta || 2.4);
        if (d.id === "airstrike") {
          noise(eta + 0.6, 380, 2400, 0.62, 0.4, 0.9, true);            // jet roar swelling in
          tone(130, eta, "sawtooth", 0.07, 0.4, 210);
        } else {
          tone(2300, Math.max(0.6, eta - 0.7), "sine", 0.10, 0.5, 520);  // incoming whistle
          noise(0.7, 3200, 900, 0.18, Math.max(0.4, eta - 0.9), 3.0);
        }
      }
    },
    medal(d) {
      if (!d) return;
      if (d.kind === "streak") { tone(523, 0.12, "triangle", 0.2); tone(784, 0.12, "triangle", 0.2, 0.1); tone(1046, 0.26, "triangle", 0.22, 0.2); }
      else { tone(1000, 0.07, "sine", 0.16); tone(1500, 0.09, "sine", 0.12, 0.06); }
    },
  };

  return {
    attach(bridge) {
      for (const k of Object.keys(handlers)) {
        bridge.register(k, (d) => { try { handlers[k](d); } catch (e) { /* audio must never break the frame */ } });
      }
    },
    // exposed so a harness can confirm the context exists / is running
    state() { return ac ? ac.state : "none"; },
  };
}
