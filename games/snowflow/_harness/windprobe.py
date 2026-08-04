#!/usr/bin/env python
"""DRIFTWAKE wind diagnostic — measure the wind bed, per layer, at rest and at speed.

The owner's report is "there is an odd WHITE NOISE playing". A wind bed should be
felt, not heard, when the player is standing still. This probe answers, in numbers,
(a) how loud the bed is at a dead stand, (b) which of its three layers that level is
coming from, and (c) whether it actually rises with speed and windStrength or just
sits there — a bed that does not move with the player reads as noise, not as wind.

METHOD. It imports the REAL `WindBed` from src/audio/voices.js into the live page
and renders it through a replica of audio.js's master chain (master 0.8 -> the same
DynamicsCompressor -> destination) in an OfflineAudioContext. Offline because the
live ScriptProcessor tap on this page is starved at single-digit fps, which drags
RMS down by an unknown amount (see audioprobe3/4); offline is deterministic and
renders faster than real time, so every number below is repeatable.

Per-layer isolation is done by zeroing the other two layers' gains AFTER drive() has
written them, so each layer is measured at exactly the level the real drive() gives
it at that operating point.

    python windprobe.py                 # measure current code
    python windprobe.py --tag before    # label the run
"""
import argparse, base64, json, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/snowflow/index.html"

BOOT = r"""
(() => { window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone')); }; })();
"""

# Render the real WindBed offline at a pinned operating point.
#   cfg = {strength, speed01, surf, layer: 'all'|'low'|'mid'|'top', secs, t}
RENDER = r"""
async (cfg) => {
  const G = await import('/games/snowflow/src/audio/graph.js');
  const V = await import('/games/snowflow/src/audio/voices.js');
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.floor(SR * cfg.secs), SR);

  // The master chain from audio.js _build(), verbatim.
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 6;
  lim.attack.value = 0.004; lim.release.value = 0.18;
  lim.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(lim);

  const white = G.noiseBuffer(ctx, false, 0x5f3a91c7);
  const pink  = G.noiseBuffer(ctx, true,  0x1d7be40b);
  const wb = new V.WindBed(ctx, white, pink, master);

  // Drive once at t=0, exactly as audio.js does, then let the Smoothed ramps settle.
  wb.drive(0, cfg.t, cfg.strength, cfg.speed01, cfg.surf, 0, 1);

  const kill = (g) => { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, 0); };
  if (cfg.layer === 'low') { kill(wb.gMid); kill(wb.gTop); }
  if (cfg.layer === 'mid') { kill(wb.gLow); kill(wb.gTop); }
  if (cfg.layer === 'top') { kill(wb.gLow); kill(wb.gMid); }

  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const by = new Uint8Array(mono.buffer); let s = ''; const CH = 0x8000;
  for (let i = 0; i < by.length; i += CH) s += String.fromCharCode.apply(null, by.subarray(i, i + CH));
  return { sr: SR, pcm: btoa(s),
           gLow: wb.gLow.gain.value, gMid: wb.gMid.gain.value, gTop: wb.gTop.gain.value };
}
"""

# One footfall through the real CrunchPool, same chain — the reference the bed is
# supposed to sit under. Numbers copied from audio.js's footfall branch at imp=1.
CRUNCH = r"""
async () => {
  const G = await import('/games/snowflow/src/audio/graph.js');
  const V = await import('/games/snowflow/src/audio/voices.js');
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.floor(SR * 1.0), SR);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 6;
  lim.attack.value = 0.004; lim.release.value = 0.18;
  lim.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(lim);
  const white = G.noiseBuffer(ctx, false, 0x5f3a91c7);
  const cp = new V.CrunchPool(ctx, white, master, 4);
  cp.fire(0.02, 1260, 0.75, 0.92, 0.40, 0.145, 0.028, -0.22);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const mono = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const by = new Uint8Array(mono.buffer); let s = ''; const CH = 0x8000;
  for (let i = 0; i < by.length; i += CH) s += String.fromCharCode.apply(null, by.subarray(i, i + CH));
  return { sr: SR, pcm: btoa(s) };
}
"""


def db(x):
    return -999.0 if x <= 1e-12 else 20.0 * np.log10(x)


def dec(r):
    return np.frombuffer(base64.b64decode(r["pcm"]), dtype="<f4").astype(np.float64)


def a_weight_db(x, sr):
    """A-weighted RMS in dBFS. Broadband RMS under-reports hiss badly: the ear is
    ~30 dB more sensitive at 2 kHz than at 60 Hz, so a bed whose energy is mostly
    rumble and a bed whose energy is mostly 2 kHz hiss can read identically flat
    and sound nothing alike. This is the number that tracks 'how much do I hear it'."""
    n = len(x)
    X = np.fft.rfft(x * np.hanning(n))
    f = np.fft.rfftfreq(n, 1.0 / sr)
    f = np.maximum(f, 1e-6)
    f2 = f * f
    ra = (12194.0**2 * f2**2) / (
        (f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194.0**2))
    a = 2.0 + 20.0 * np.log10(np.maximum(ra, 1e-20))
    w = 10.0 ** (a / 20.0)
    Xw = X * w
    # Parseval, one-sided, undoing the Hann window's power loss (0.375).
    p = (np.sum(np.abs(Xw) ** 2) * 2.0) / (n * n * 0.375)
    return db(np.sqrt(p))


def bands(x, sr):
    """Energy split low / mid / high, as a fraction of total. Says WHERE the bed is."""
    n = len(x)
    P = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1.0 / sr)
    tot = P.sum() + 1e-30
    return (P[f < 500].sum() / tot,
            P[(f >= 500) & (f < 2000)].sum() / tot,
            P[f >= 2000].sum() / tot)


def measure(pg, cfg):
    r = pg.evaluate(RENDER, cfg)
    x = dec(r)[int(1.2 * r["sr"]):]          # drop the Smoothed settle
    return {"rms": db(np.sqrt(np.mean(x**2))), "a": a_weight_db(x, r["sr"]),
            "peak": db(np.max(np.abs(x))), "bands": bands(x, r["sr"]),
            "g": (r["gLow"], r["gMid"], r["gTop"])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run")
    args = ap.parse_args()

    out = {"tag": args.tag, "points": {}}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--use-angle=d3d11",
            "--disable-gpu-sandbox", "--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.add_init_script(BOOT)
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(800)

        # The gust term is a function of elapsed time; measure at its crest so the
        # standstill number is the WORST case, not a lucky trough.
        ts = np.linspace(0, 60, 400)
        gust = 0.62 + 0.38 * (0.6 * np.sin(ts * 0.23) + 0.4 * np.sin(ts * 0.517 + 1.7))
        t_crest = float(ts[int(np.argmax(gust))])
        print(f"  gust crest at t={t_crest:.2f}s  (gust={gust.max():.3f}, "
              f"trough {gust.min():.3f})")

        print("\n  STANDSTILL  strength=1.0 speed01=0 surf=0, at the gust crest")
        for layer in ("all", "low", "mid", "top"):
            m = measure(pg, {"strength": 1.0, "speed01": 0.0, "surf": 0.0,
                             "layer": layer, "secs": 4.0, "t": t_crest})
            out["points"][f"stand_{layer}"] = m
            lo, mi, hi = m["bands"]
            print(f"    {layer:>4} : rms {m['rms']:7.2f}  A-wtd {m['a']:7.2f}  "
                  f"peak {m['peak']:7.2f} dBFS   "
                  f"energy <500 {lo*100:4.1f}%  .5-2k {mi*100:4.1f}%  >2k {hi*100:4.1f}%")
        g = out["points"]["stand_all"]["g"]
        print(f"    gains written: low {g[0]:.4f}  mid {g[1]:.4f}  top {g[2]:.4f}")

        print("\n  THE SLOPE — does it move with speed and strength?")
        for name, cfg in (
            ("calm, still   w=0.0 sp=0", {"strength": 0.0, "speed01": 0.0, "surf": 0.0}),
            ("default still w=1.0 sp=0", {"strength": 1.0, "speed01": 0.0, "surf": 0.0}),
            ("default half  w=1.0 sp=.5", {"strength": 1.0, "speed01": 0.5, "surf": 0.0}),
            ("default fast  w=1.0 sp=1", {"strength": 1.0, "speed01": 1.0, "surf": 0.0}),
            ("gale  fast    w=2.0 sp=1", {"strength": 2.0, "speed01": 1.0, "surf": 0.0}),
        ):
            c = dict(cfg); c.update({"layer": "all", "secs": 4.0, "t": t_crest})
            m = measure(pg, c)
            out["points"][name.split()[0] + "_" + name.split()[1]] = m
            lo, mi, hi = m["bands"]
            print(f"    {name:24} : rms {m['rms']:7.2f}  A-wtd {m['a']:7.2f} dBFS   "
                  f">2k {hi*100:4.1f}%")

        r = pg.evaluate(CRUNCH)
        x = dec(r)
        cr = {"peak": db(np.max(np.abs(x))), "a": a_weight_db(x[:int(0.4*r['sr'])], r["sr"])}
        out["crunch"] = cr
        print(f"\n  REFERENCE one footfall (imp=1) : peak {cr['peak']:.2f} dBFS  "
              f"A-wtd over its first 400ms {cr['a']:.2f} dBFS")
        sa = out["points"]["stand_all"]
        print(f"  footfall sits {cr['a'] - sa['a']:+.1f} dB (A) over the standstill bed")

        br.close()

    p = f"windprobe_{args.tag}.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"\n  -> {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
