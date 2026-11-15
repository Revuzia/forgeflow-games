// core/audio/ambience.js [A9] — the night-storm bed: exterior rain loop +
// distant industrial-harbor atmos + synth wind, with the LD §5.3 audio hook —
// rain crossfades to a muffled exterior + close roof-patter band inside the
// four interior occlusion volumes (zone != exterior), 250 ms-class fades.
// Distant thunder one-shots on a seeded scheduler; tram-wire hum positional
// on the boulevard (LD §9 handoff). Beds are Sonniss GDC 2024 slices (see
// assets/manifest.a9.json); every bed keeps a synth fallback.

export function makeAmbience(env) {
  const { rng, fin, gclamp, err } = env;
  let started = false;
  let interior = false;
  let exteriorGain = null;   // rain dry + harbor + wind ride this
  let interiorGain = null;   // muffled rain + roof patter ride this
  let thunderT = 8 + rng() * 14;   // first rumble comes early, then sparse
  const buffers = {};        // name → AudioBuffer
  let rainSrc = null;

  const FILES = {
    rain: "beds/rain_night_loop.ogg",
    harbor: "beds/harbor_distant_loop.ogg",
    thunder_a: "oneshots/thunder_a.ogg",
    thunder_b: "oneshots/thunder_b.ogg",
  };

  function fetchBuf(name, onReady) {
    const base = typeof document !== "undefined" ? document.baseURI : "";
    const url = new URL("assets/audio/" + FILES[name], base).href;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status + " " + FILES[name]); return r.arrayBuffer(); })
      .then((ab) => env.ac.decodeAudioData(ab))
      .then((b) => { buffers[name] = b; if (onReady) onReady(b); })
      .catch((e) => err(e, "amb:" + name));
  }

  function loopInto(buffer, out, gain) {
    const ac = env.ac;
    const src = ac.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const g = ac.createGain(); g.gain.value = gclamp(gain);
    src.connect(g); g.connect(out);
    src.start(ac.currentTime + 0.05);
    env.voices++;
    return src;
  }

  function start() {
    if (started || !env.ac || !env.buses) return;
    started = true;
    const ac = env.ac;
    try {
      exteriorGain = ac.createGain(); exteriorGain.gain.value = 1;
      interiorGain = ac.createGain(); interiorGain.gain.value = 0;
      exteriorGain.connect(env.buses.ambience);
      interiorGain.connect(env.buses.ambience);

      // synth wind bed runs from t0 (beds arrive async): slow-breathing
      // filtered noise — also the rain fallback until the ogg decodes.
      const wind = ac.createBufferSource();
      wind.buffer = env.noiseBuf(); wind.loop = true;
      const wf = ac.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 420; wf.Q.value = 0.4;
      const wg = ac.createGain(); wg.gain.value = 0.05;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.07;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.02;
      lfo.connect(lfoG); lfoG.connect(wg.gain);
      wind.connect(wf); wf.connect(wg); wg.connect(exteriorGain);
      wind.start(); lfo.start();
      env.voices += 2;

      // rain: dry exterior copy + interior band (roof patter = 500–1600 Hz
      // band of the same loop, quieter; exterior side lowpassed hard when in)
      fetchBuf("rain", (b) => {
        try {
          rainSrc = env.ac.createBufferSource();
          rainSrc.buffer = b; rainSrc.loop = true;
          const dry = env.ac.createGain(); dry.gain.value = 0.5;
          rainSrc.connect(dry); dry.connect(exteriorGain);
          const bp = env.ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 950; bp.Q.value = 0.9;
          const muf = env.ac.createBiquadFilter(); muf.type = "lowpass"; muf.frequency.value = 620;
          const ig = env.ac.createGain(); ig.gain.value = 0.34;
          rainSrc.connect(bp); bp.connect(ig);
          rainSrc.connect(muf); muf.connect(ig);
          ig.connect(interiorGain);
          rainSrc.start(env.ac.currentTime + 0.03);
          env.voices++;
        } catch (e) { err(e, "amb:rain-wire"); }
      });

      // distant port atmos, exterior only, very low (fiction: the harbor south)
      fetchBuf("harbor", (b) => {
        try { loopInto(b, exteriorGain, 0.16); } catch (e) { err(e, "amb:harbor-wire"); }
      });
      fetchBuf("thunder_a");
      fetchBuf("thunder_b");

      // tram-wire hum — positional at the boulevard centre-line (LD §9);
      // detuned pair + slow AM wobble, only audible within ~28 m.
      const humOut = env.spatial([37, 6, -2], 28);
      if (humOut) {
        const o1 = ac.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 100;
        const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = 100.7;
        const hf = ac.createBiquadFilter(); hf.type = "lowpass"; hf.frequency.value = 300; hf.Q.value = 1.2;
        const hg = ac.createGain(); hg.gain.value = 0.03;
        const am = ac.createOscillator(); am.frequency.value = 0.9;
        const amG = ac.createGain(); amG.gain.value = 0.012;
        am.connect(amG); amG.connect(hg.gain);
        o1.connect(hf); o2.connect(hf); hf.connect(hg); hg.connect(humOut);
        o1.start(); o2.start(); am.start();
        env.voices += 3;
      }
    } catch (e) { err(e, "amb:start"); }
  }

  function setZone(name) {
    const inNow = name !== "exterior";
    if (inNow === interior || !env.ac || !exteriorGain) { interior = inNow; return; }
    interior = inNow;
    const t = env.ac.currentTime;
    // LD §5.3: exterior rain ↔ interior muffle + roof patter (τ ≈ fade/4)
    exteriorGain.gain.setTargetAtTime(inNow ? 0.22 : 1, t, 0.09);
    interiorGain.gain.setTargetAtTime(inNow ? 1 : 0, t, 0.09);
  }

  function thunder() {
    const b = rng() < 0.5 ? buffers.thunder_a : buffers.thunder_b;
    const out = env.buses ? env.ac.createGain() : null;
    if (!out) return;
    try {
      out.gain.value = gclamp(0.35 + rng() * 0.2);
      out.connect(exteriorGain);
      if (b) {
        const src = env.ac.createBufferSource();
        src.buffer = b;
        src.playbackRate.value = 0.92 + rng() * 0.16;
        src.connect(out);
        src.start();
        env.voices++;
      } else {
        // synth rumble fallback
        const o = env.ac.createOscillator(); o.type = "sine";
        const t0 = env.ac.currentTime;
        o.frequency.setValueAtTime(55, t0);
        o.frequency.linearRampToValueAtTime(32, t0 + 2.4);
        const g = env.ac.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.25, t0 + 0.5);
        g.gain.linearRampToValueAtTime(0, t0 + 3.2);
        o.connect(g); g.connect(out);
        o.start(t0); o.stop(t0 + 3.3);
        env.voices++;
      }
    } catch (e) { err(e, "amb:thunder"); }
  }

  function update(dt) {
    if (!started) return;
    thunderT -= fin(dt, 0);
    if (thunderT <= 0) {
      thunderT = 25 + rng() * 35;                              // sparse storm rhythm
      thunder();
    }
  }

  return { start, setZone, update };
}
