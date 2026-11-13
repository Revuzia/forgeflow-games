#!/usr/bin/env python
"""DRIFTWAKE audio diagnostic — what is the white noise the owner hears?

Two independent measurements, deliberately:

  LIVE     an AnalyserNode tapped onto the running game's own master gain,
           after a real trusted click has unlocked the context. This is the
           actual thing the owner is listening to.

  OFFLINE  the SAME voice classes (imported from the page's own module URLs)
           reconstructed in an OfflineAudioContext and stepped at 20 Hz with
           `suspend()/resume()`, so the gust LFO really moves. Deterministic,
           and it is the only way to isolate one wind layer from the other two.

The offline chain carries the same master gain (0.8) and the same limiter as
audio.js `_build()`, so its dBFS numbers are directly comparable to the live tap.

    python audioprobe.py
"""
import base64, json, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"
SR = 48000

BOOT = r"""
(() => {
  window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone'));
  };
})();
"""

# --------------------------------------------------------------- offline probe
#
# Rebuilds the audio.js master chain and whichever voices a case asks for, steps
# the frame loop at 20 Hz, and returns the rendered PCM as base64 float32.
OFFLINE = r"""
async (cfg) => {
  const V = await import('/games/driftwake/src/audio/voices.js');
  const G = await import('/games/driftwake/src/audio/graph.js');

  const SR = cfg.sr, DUR = cfg.dur, HZ = 20, STEP = 1 / HZ;
  const ctx = new OfflineAudioContext(2, Math.floor(SR * DUR), SR);

  // ---- the exact master chain from audio.js _build() ----------------------
  let out = ctx.destination;
  if (cfg.chain !== 'raw') {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 6;
    lim.attack.value = 0.004; lim.release.value = 0.18;
    lim.connect(ctx.destination);
    out = lim;
  }
  const master = ctx.createGain();
  master.gain.value = cfg.master;          // audio.js settles at _volume = 0.8
  master.connect(out);

  const white = G.noiseBuffer(ctx, false, 0x5f3a91c7);
  const pink  = G.noiseBuffer(ctx, true,  0x1d7be40b);

  const wind   = cfg.wind   ? new V.WindBed(ctx, white, pink, master) : null;
  const surf   = cfg.surf   ? new V.SurfBed(ctx, white, pink, master) : null;
  const crunch = cfg.crunch ? new V.CrunchPool(ctx, white, master, 4) : null;
  const thump  = cfg.crunch ? new V.ThumpPool(ctx, master, 2) : null;
  const spell  = cfg.spell  ? new V.SpellVoices(ctx, white, master) : null;

  // ---- step the frame loop -----------------------------------------------
  const nSteps = Math.floor(DUR / STEP);
  for (let i = 1; i < nSteps; i++) {
    const when = i * STEP;
    ctx.suspend(when).then(() => {
      const now = ctx.currentTime, t = now;
      if (wind) {
        wind.drive(now, t, cfg.strength, cfg.speed01, cfg.surfBlend, cfg.pan, cfg.sfx);
        // Layer isolation: hard-hold the layers this case is not measuring.
        // `Smoothed.reset` is the same call blur/mute already use.
        if (cfg.mute && cfg.mute.indexOf('low') >= 0) wind.sLow.reset(0, now);
        if (cfg.mute && cfg.mute.indexOf('mid') >= 0) wind.sMid.reset(0, now);
        if (cfg.mute && cfg.mute.indexOf('top') >= 0) wind.sTop.reset(0, now);
      }
      if (surf) surf.drive(now, cfg.surfBlend, cfg.speed01, cfg.carve || 0, cfg.sfx);
      // One footfall, fired with audio.js's own footstep parameters (imp=1,
      // footIndex=0 -> odd=0), at the time the case asks for.
      if (crunch && cfg.fireAt && Math.abs(now - cfg.fireAt) < STEP * 0.51) {
        crunch.fire(now, 1000 + 260, 0.75, 0.92, 0.40 * cfg.sfx, 0.145, 0.028, -0.22);
      }
      if (crunch && cfg.landAt && Math.abs(now - cfg.landAt) < STEP * 0.51) {
        crunch.fire(now, 740, 0.6, 0.68, 0.60 * cfg.sfx, 0.34, 0.042, 0);
        thump.fire(now, 78, 44, 0.17 * cfg.sfx, 0.26);
      }
      if (spell && cfg.castAt && Math.abs(now - cfg.castAt) < STEP * 0.51) {
        spell.fire(cfg.castKey, now, cfg.sfx, 0);
      }
      ctx.resume();
    });
  }

  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) * 0.5;

  const bytes = new Uint8Array(mono.buffer);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return { sr: SR, n: n, pcm: btoa(s) };
}
"""

# ------------------------------------------------------------------ live probe
LIVE = r"""
async (secs) => {
  const A = globalThis.SNOWFLOW && globalThis.SNOWFLOW.audio;
  if (!A || !A.ctx) return { err: 'no context: ' + (A ? A.state : 'no audio') };
  const ctx = A.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 32768;
  an.smoothingTimeConstant = 0;
  A.master.connect(an);          // post-master, pre-limiter (same as offline tap)

  const td = new Float32Array(an.fftSize);
  const fd = new Float32Array(an.frequencyBinCount);
  const acc = new Float64Array(an.frequencyBinCount);
  let frames = 0, sumSq = 0, nSamp = 0, peak = 0;

  const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000) {
    an.getFloatTimeDomainData(td);
    for (let i = 0; i < td.length; i++) {
      const v = td[i]; sumSq += v * v; const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    nSamp += td.length;
    an.getFloatFrequencyData(fd);
    for (let i = 0; i < fd.length; i++) acc[i] += Math.pow(10, fd[i] / 10);
    frames++;
    await new Promise(r => setTimeout(r, 50));
  }
  A.master.disconnect(an);

  const spec = new Array(acc.length);
  for (let i = 0; i < acc.length; i++) spec[i] = acc[i] / frames;

  return {
    sr: ctx.sampleRate, state: ctx.state, voices: A.voices,
    masterGain: A.master.gain.value,
    rms: Math.sqrt(sumSq / nSamp), peak: peak,
    binHz: ctx.sampleRate / an.fftSize,
    spec: spec,
    windLevel: A.wind ? A.wind.level : null,
    windLow: A.wind ? A.wind.gLow.gain.value : null,
    windMid: A.wind ? A.wind.gMid.gain.value : null,
    windTop: A.wind ? A.wind.gTop.gain.value : null,
    surfLevel: A.surf ? A.surf.level : null,
    surfHiss: A.surf ? A.surf.gHiss.gain.value : null,
    surfBody: A.surf ? A.surf.gBody.gain.value : null,
    charSurf: SNOWFLOW.character ? SNOWFLOW.character.surf : null,
    charSpeed: SNOWFLOW.character ? SNOWFLOW.character.speed01 : null,
  };
}
"""


def db(x):
    return -999.0 if x <= 1e-12 else 20.0 * np.log10(x)


def decode(res):
    raw = base64.b64decode(res["pcm"])
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def analyse(x, sr, t0, t1, label):
    """RMS / peak / spectrum stats over [t0, t1) seconds."""
    seg = x[int(t0 * sr):int(t1 * sr)]
    if seg.size == 0:
        return None
    rms = float(np.sqrt(np.mean(seg ** 2)))
    peak = float(np.max(np.abs(seg)))
    dc = float(np.mean(seg))

    # Welch PSD, 8192-pt Hann, 50% overlap.
    N, hop = 8192, 4096
    win = np.hanning(N)
    segs = [seg[i:i + N] * win for i in range(0, max(1, seg.size - N), hop)]
    if not segs:
        segs = [np.pad(seg, (0, N - seg.size))[:N] * win]
    psd = np.mean([np.abs(np.fft.rfft(s)) ** 2 for s in segs], axis=0)
    psd /= (np.sum(win ** 2) * sr)
    freqs = np.fft.rfftfreq(N, 1 / sr)

    # Spectral flatness over 100 Hz .. 16 kHz: 1.0 = white, ->0 = banded/tonal.
    m = (freqs >= 100) & (freqs <= 16000)
    p = np.maximum(psd[m], 1e-30)
    sfm = float(np.exp(np.mean(np.log(p))) / np.mean(p))
    centroid = float(np.sum(freqs[m] * psd[m]) / max(np.sum(psd[m]), 1e-30))

    # Where the energy is: cumulative-power octave bands.
    edges = [0, 125, 250, 500, 1000, 2000, 4000, 8000, 24000]
    tot = float(np.sum(psd)) or 1e-30
    bands = []
    for a, b in zip(edges[:-1], edges[1:]):
        mm = (freqs >= a) & (freqs < b)
        bands.append(100.0 * float(np.sum(psd[mm])) / tot)

    return dict(label=label, rms=rms, rms_db=db(rms), peak=peak, peak_db=db(peak),
                dc=dc, sfm=sfm, centroid=centroid, bands=bands,
                freqs=freqs, psd=psd)


def show(a, ref_db=None):
    if a is None:
        print(f"    {'?':<28} (empty)"); return
    rel = "" if ref_db is None else f"   rel {a['rms_db'] - ref_db:+6.1f} dB"
    print(f"    {a['label']:<30} RMS {a['rms_db']:7.1f} dBFS   peak {a['peak_db']:7.1f} dBFS"
          f"   SFM {a['sfm']:.3f}   centroid {a['centroid']:6.0f} Hz{rel}")


def bandline(a):
    names = ["<125", "125-250", "250-500", ".5-1k", "1-2k", "2-4k", "4-8k", "8k+"]
    print(f"      {a['label']:<28} " + "  ".join(
        f"{n}:{v:4.1f}%" for n, v in zip(names, a["bands"])))


def main():
    out = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu", "--ignore-gpu-blocklist",
            "--use-angle=d3d11", "--disable-gpu-sandbox",
            "--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(BOOT)
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)

        # A real, trusted gesture: this is what unlocks the context.
        pg.mouse.click(640, 400)
        pg.wait_for_timeout(2500)
        print("  audio state:", pg.evaluate("() => SNOWFLOW.audio.state"))
        print("  wind strength:", pg.evaluate("() => SNOWFLOW.S.windStrength"))

        print("\n== LIVE, standing still, 6 s tap on the running master ==")
        live = pg.evaluate(LIVE, 6)
        out["live"] = {k: v for k, v in live.items() if k != "spec"}
        print("   ", json.dumps(out["live"], indent=None)[:600])
        if "spec" in live:
            spec = np.array(live["spec"]); binHz = live["binHz"]
            fr = np.arange(spec.size) * binHz
            m = (fr >= 100) & (fr <= 16000)
            p = np.maximum(spec[m], 1e-30)
            print(f"    live RMS {db(live['rms']):.1f} dBFS   peak {db(live['peak']):.1f} dBFS"
                  f"   SFM {np.exp(np.mean(np.log(p))) / np.mean(p):.3f}"
                  f"   centroid {np.sum(fr[m]*spec[m])/np.sum(spec[m]):.0f} Hz")
            out["live_spec"] = {"binHz": binHz, "spec": spec.tolist()}

        # --------------------------------------------------- offline cases
        base = dict(sr=SR, dur=12.0, master=0.8, chain="lim", sfx=1.0,
                    strength=1.0, speed01=0.0, surfBlend=0.0, pan=0.0,
                    wind=True, surf=False, crunch=False, spell=False, mute=[])

        cases = [
            ("wind ALL (stand)",        dict()),
            ("wind LOW only",           dict(mute=["mid", "top"])),
            ("wind MID only",           dict(mute=["low", "top"])),
            ("wind TOP only",           dict(mute=["low", "mid"])),
            ("wind no-TOP (low+mid)",   dict(mute=["top"])),
            ("wind no-MID (low+top)",   dict(mute=["mid"])),
            ("wind ALL @ speed 1.0",    dict(speed01=1.0)),
            ("wind ALL @ strength 0",   dict(strength=0.0)),
            ("SURF bed, surf=0",        dict(wind=False, surf=True)),
            ("SURF bed, surf=1 sp=1",   dict(wind=False, surf=True, surfBlend=1.0, speed01=1.0)),
        ]
        results = {}
        print("\n== OFFLINE, same classes, same master chain, 12 s, steady tail 6-12 s ==")
        for label, over in cases:
            cfg = dict(base); cfg.update(over)
            r = pg.evaluate(OFFLINE, cfg)
            a = analyse(decode(r), r["sr"], 6.0, 12.0, label)
            results[label] = a
            show(a)

        ref = results["wind ALL (stand)"]["rms_db"]
        print("\n  -- per-layer, relative to the full bed --")
        for label in ["wind LOW only", "wind MID only", "wind TOP only",
                      "wind no-TOP (low+mid)", "wind no-MID (low+top)"]:
            show(results[label], ref)

        print("\n  -- octave-band energy share --")
        for label in ["wind ALL (stand)", "wind LOW only", "wind MID only", "wind TOP only"]:
            bandline(results[label])

        # ------------------------------------------- discrete sounds vs bed
        print("\n== DISCRETE SOUNDS (bed OFF, so the transient is clean) ==")
        shots = [
            ("footstep (imp 1.0)", dict(wind=False, crunch=True, fireAt=2.0, dur=4.0)),
            ("landing + thump",    dict(wind=False, crunch=True, landAt=2.0, dur=4.0)),
            ("spell 1 Sweep",      dict(wind=False, spell=True, castAt=2.0, castKey=1, dur=4.0)),
            ("spell 5 Vortex",     dict(wind=False, spell=True, castAt=2.0, castKey=5, dur=4.0)),
        ]
        for label, over in shots:
            cfg = dict(base); cfg.update(over)
            r = pg.evaluate(OFFLINE, cfg)
            x = decode(r)
            a = analyse(x, r["sr"], 2.0, 2.6, label)
            results[label] = a
            show(a)

        # ------------------------------------------------- stuck-voice check
        print("\n== STUCK VOICES ==")
        print("    standing still, voices =", pg.evaluate("() => SNOWFLOW.audio.voices"))
        pg.evaluate("() => SNOWFLOW.spells && SNOWFLOW.spells.cast && SNOWFLOW.spells.cast(1)")
        pg.wait_for_timeout(3000)
        print("    3 s after cast(1), voices =", pg.evaluate("() => SNOWFLOW.audio.voices"))
        print("    surf blend standing =", pg.evaluate("() => SNOWFLOW.character.surf"),
              " gHiss =", pg.evaluate("() => SNOWFLOW.audio.surf.gHiss.gain.value"))

        # ------------------------------------------------- noise buffer / DC
        print("\n== NOISE BUFFER ==")
        print("   ", json.dumps(pg.evaluate(r"""
          async () => {
            const G = await import('/games/driftwake/src/audio/graph.js');
            const ctx = new OfflineAudioContext(1, 128, 48000);
            const r = {};
            for (const [k, pinkq] of [['white', false], ['pink', true]]) {
              const b = G.noiseBuffer(ctx, pinkq, pinkq ? 0x1d7be40b : 0x5f3a91c7);
              const d = b.getChannelData(0);
              let s = 0, sq = 0, pk = 0;
              for (let i = 0; i < d.length; i++) {
                s += d[i]; sq += d[i]*d[i];
                const a = Math.abs(d[i]); if (a > pk) pk = a;
              }
              r[k] = { n: d.length, dc: s/d.length, rms: Math.sqrt(sq/d.length), peak: pk,
                       seamJump: Math.abs(d[0] - d[d.length-1]) };
            }
            return r;
          }""")))

        # -------------------------------- music bed noise floor (is it a suspect?)
        print("\n== MUSIC BED ==")
        print("   ", pg.evaluate("() => { const M = globalThis.FFG && FFG.__bed; "
                                 "return M ? M.status() : 'no FFG.__bed handle'; }"))

        br.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
