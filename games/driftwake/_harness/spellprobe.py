#!/usr/bin/env python
"""DRIFTWAKE — measure the recorded spell/bed material through the real code.

Everything renders offline through the REAL modules (graph.js, voices.js,
samples.js) and a replica of audio.js's master chain, with the real shipped
.ogg assets fetched and decoded — the same method as windprobe.py/levelprobe.py
and for the same reason: the live tap is starved at single-digit fps, offline
is deterministic.

Sections:
  calib   per-layer A-levels of each adopted bed with makeup FORCED to 1,
          against the same layer on generated noise — prints the makeup each
          layer needs to sit back on the tuned envelope. Run this after
          changing an asset; copy the constants into voices.js.
  verify  the beds THROUGH the constants in voices.js as they stand, at the
          standard operating points — the envelope that must survive adoption.
  spells  each spell one-shot at the SMP_* levels in voices.js, A-weighted
          against the standstill and walk beds; spell 4 additionally reports
          spectral flatness (200 Hz-12 kHz) for the recorded cracks vs the
          synth bell — the number that separates a fracture from a chime.
  events  jump whoosh and surf bed levels per event.

    python spellprobe.py            # all sections
    python spellprobe.py calib
"""
import json, sys, time
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"

BOOT = r"""
(() => { window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone')); }; })();
"""

# Shared prologue: offline ctx + the master chain from audio.js _build(),
# verbatim, plus helpers to decode a shipped asset and export the render.
PRO = r"""
  const G = await import('/games/driftwake/src/audio/graph.js');
  const V = await import('/games/driftwake/src/audio/voices.js');
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.floor(SR * cfg.secs), SR);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 6;
  lim.attack.value = 0.004; lim.release.value = 0.18;
  lim.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(lim);
  const white = G.noiseBuffer(ctx, false, 0x5f3a91c7);
  const pink  = G.noiseBuffer(ctx, true,  0x1d7be40b);
  const load = async (f) => ctx.decodeAudioData(
      await (await fetch('/games/driftwake/assets/audio/' + f)).arrayBuffer());
  const out = async () => {
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const m = new Float32Array(buf.length);
    for (let i = 0; i < buf.length; i++) m[i] = (L[i] + R[i]) * 0.5;
    const by = new Uint8Array(m.buffer); let s = ''; const CH = 0x8000;
    for (let i = 0; i < by.length; i += CH)
      s += String.fromCharCode.apply(null, by.subarray(i, i + CH));
    return { sr: SR, pcm: btoa(s) };
  };
"""

# Wind bed at an operating point. cfg: {secs,t,strength,speed01,surf,layer,
# real:bool, mk1:bool force makeups to 1}
WIND = "async (cfg) => {" + PRO + r"""
  const wb = new V.WindBed(ctx, white, pink, master);
  if (cfg.real) {
    wb.adopt(await load('wind_loop.ogg'));
    if (cfg.mk1) {
      wb.mkLow0 = wb.mkLow1 = 1;
      wb.mkMid0 = wb.mkMid1 = 1;
      wb.mkTop0 = wb.mkTop1 = 1;
    }
  }
  wb.drive(0, cfg.t, cfg.strength, cfg.speed01, cfg.surf, 0, 1);
  const kill = (g) => { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, 0); };
  if (cfg.layer === 'low') { kill(wb.gMid); kill(wb.gTop); }
  if (cfg.layer === 'mid') { kill(wb.gLow); kill(wb.gTop); }
  if (cfg.layer === 'top') { kill(wb.gLow); kill(wb.gMid); }
  return out();
}"""

# Surf bed. cfg: {secs,surf,speed01,carve,real,mk1}
SURF = "async (cfg) => {" + PRO + r"""
  const sb = new V.SurfBed(ctx, white, pink, master);
  if (cfg.real) {
    sb.adopt(await load('surf_slide_loop.ogg'));
    if (cfg.mk1) sb.mkHiss = 1;
  }
  sb.drive(0, cfg.surf, cfg.speed01, cfg.carve, 1);
  if (cfg.layer === 'hiss') { sb.gBody.gain.cancelScheduledValues(0); sb.gBody.gain.setValueAtTime(0,0); }
  return out();
}"""

# Ribbon hold. cfg: {secs,real}
RIBBON = "async (cfg) => {" + PRO + r"""
  const sv = new V.SpellVoices(ctx, white, master, null);
  if (cfg.real) sv.adoptRibbon(await load('spell_ribbon_stream.ogg'));
  sv.hold(true, 0.02, 1);
  return out();
}"""

# A spell one-shot through the REAL SampleBank + SpellVoices.fire, or the
# synth fallback when cfg.synth. cfg: {secs,key,synth}
SPELL = "async (cfg) => {" + PRO + r"""
  const S = await import('/games/driftwake/src/audio/samples.js');
  let bank = null;
  if (!cfg.synth) {
    bank = new S.SampleBank(8);
    bank.prefetch();
    bank.attach(ctx, master);
    const total = 20;
    const t0 = performance.now();
    while (bank.loaded + bank.failed < total && performance.now() - t0 < 20000)
      await new Promise(r => setTimeout(r, 50));
  }
  const sv = new V.SpellVoices(ctx, white, master, bank);
  sv.fire(cfg.key, 0.05, 1, 0.2);
  const r = await out();
  r.loaded = bank ? bank.loaded : -1; r.failed = bank ? bank.failed : -1;
  r.err = bank ? bank.error : null;
  return r;
}"""

# Jump whoosh through the real bank at the LEVEL_WHOOSH in audio.js.
WHOOSH = "async (cfg) => {" + PRO + r"""
  const S = await import('/games/driftwake/src/audio/samples.js');
  const A = await fetch('/games/driftwake/src/audio/audio.js').then(r => r.text());
  const m = A.match(/LEVEL_WHOOSH\s*=\s*([0-9.]+)/);
  const lvl = m ? parseFloat(m[1]) : NaN;
  const bank = new S.SampleBank(8);
  bank.prefetch(); bank.attach(ctx, master);
  const t0 = performance.now();
  while (bank.loaded + bank.failed < 20 && performance.now() - t0 < 20000)
    await new Promise(r => setTimeout(r, 50));
  bank.play('whoosh', 0.05, lvl * (cfg.sfx || 1), 1.0 + 0.25 * (cfg.speed01 || 0), 0, 0);
  const r = await out(); r.lvl = lvl;
  return r;
}"""


def db(x):
    return -999.0 if x <= 1e-12 else 20.0 * np.log10(x)


def dec(r):
    return np.frombuffer(__import__("base64").b64decode(r["pcm"]), dtype="<f4").astype(np.float64)


def a_db(x, sr):
    n = len(x)
    X = np.fft.rfft(x * np.hanning(n))
    f = np.maximum(np.fft.rfftfreq(n, 1.0 / sr), 1e-6)
    f2 = f * f
    ra = (12194.0**2 * f2**2) / ((f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194.0**2))
    w = 10.0 ** ((2.0 + 20.0 * np.log10(np.maximum(ra, 1e-20))) / 20.0)
    p = (np.sum(np.abs(X * w) ** 2) * 2.0) / (n * n * 0.375)
    return db(np.sqrt(p))


def a_max(x, sr, win=0.20, hop=0.02):
    n = int(win * sr); h = int(hop * sr)
    if len(x) <= n:
        return a_db(x, sr)
    best = -999.0
    for i in range(0, len(x) - n + 1, h):
        v = a_db(x[i:i + n], sr)
        if v > best:
            best = v
    return best


def flatness(x, sr, lo=200.0, hi=12000.0):
    n = len(x)
    P = np.abs(np.fft.rfft(x * np.hanning(n))) ** 2
    f = np.fft.rfftfreq(n, 1.0 / sr)
    m = (f >= lo) & (f <= hi)
    P = P[m] + 1e-30
    return float(np.exp(np.mean(np.log(P))) / np.mean(P))


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    t_crest = 24.66  # gust crest, same as windprobe.py derivation
    out = {}
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

        def wind(cfg):
            base = {"secs": 5.0, "t": t_crest, "strength": 1.0, "speed01": 0.0,
                    "surf": 0.0, "layer": "all", "real": False, "mk1": False}
            base.update(cfg)
            r = pg.evaluate(WIND, base)
            x = dec(r)[int(1.2 * r["sr"]):]
            return {"rms": db(np.sqrt(np.mean(x ** 2))), "a": a_max(x, r["sr"]),
                    "peak": db(np.max(np.abs(x)))}

        def surf(cfg):
            base = {"secs": 5.0, "surf": 1.0, "speed01": 0.8, "carve": 0.0,
                    "layer": "all", "real": False, "mk1": False}
            base.update(cfg)
            r = pg.evaluate(SURF, base)
            x = dec(r)[int(1.2 * r["sr"]):]
            return {"a": a_max(x, r["sr"]), "peak": db(np.max(np.abs(x)))}

        if which in ("all", "calib"):
            print("\nCALIB — makeup each adopted layer needs (target = noise-bed level)")
            for layer in ("low", "mid", "top"):
                for sp in (0.0, 1.0):
                    ref = wind({"layer": layer, "speed01": sp})
                    got = wind({"layer": layer, "speed01": sp, "real": True, "mk1": True})
                    need = 10 ** ((ref["a"] - got["a"]) / 20)
                    print(f"  wind {layer:>4} sp={sp:0.0f}: noise {ref['a']:7.2f}  "
                          f"real@mk1 {got['a']:7.2f} dBA  -> mk {need:6.2f}")
            for cfg in ({"speed01": 0.8, "carve": 0.0}, {"speed01": 0.8, "carve": 0.8}):
                ref = surf({**cfg, "layer": "hiss"})
                got = surf({**cfg, "layer": "hiss", "real": True, "mk1": True})
                need = 10 ** ((ref["a"] - got["a"]) / 20)
                print(f"  surf hiss sp={cfg['speed01']} carve={cfg['carve']}: "
                      f"noise {ref['a']:7.2f}  real@mk1 {got['a']:7.2f} dBA  -> mk {need:6.2f}")
            for real in (False, True):
                r = pg.evaluate(RIBBON, {"secs": 4.0, "real": real})
                x = dec(r)[int(1.0 * r["sr"]):]
                print(f"  ribbon held real={real}: A {a_max(x, r['sr']):7.2f}  "
                      f"peak {db(np.max(np.abs(x))):7.2f} dBFS")

        if which in ("all", "verify"):
            print("\nVERIFY — the adopted beds through the constants in voices.js")
            pts = (("stand", 0.0), ("walk", 0.5), ("sprint", 1.0))
            out["bed"] = {}
            for nm, sp in pts:
                syn = wind({"speed01": sp})
                real = wind({"speed01": sp, "real": True})
                out["bed"][nm] = {"syn": syn, "real": real}
                print(f"  wind {nm:>6}: synth {syn['a']:7.2f}  adopted {real['a']:7.2f} dBA  "
                      f"(delta {real['a'] - syn['a']:+.1f})")
            calm = wind({"strength": 0.0, "speed01": 0.0, "real": True})
            print(f"  wind calm-still adopted: {calm['a']:7.2f} dBA (near-silent floor)")
            for nm, cfg in (("surf drift", {"speed01": 0.4}), ("surf run", {"speed01": 0.9}),
                            ("surf carve", {"speed01": 0.9, "carve": 0.9})):
                syn = surf(cfg); real = surf({**cfg, "real": True})
                out.setdefault("surf", {})[nm] = {"syn": syn, "real": real}
                print(f"  {nm:>10}: synth {syn['a']:7.2f}  adopted {real['a']:7.2f} dBA  "
                      f"(delta {real['a'] - syn['a']:+.1f})")

        if which in ("all", "spells"):
            print("\nSPELLS — recorded at SMP_* levels vs the beds; flatness for key 4")
            stand = wind({"real": True})["a"]
            walk = wind({"speed01": 0.5, "real": True})["a"]
            print(f"  (adopted bed: stand {stand:.2f}  walk {walk:.2f} dBA)")
            out["spells"] = {}
            for key, nm in ((1, "sweep"), (3, "bloom"), (4, "crystallise"), (5, "vortex")):
                r = pg.evaluate(SPELL, {"secs": 4.0, "key": key, "synth": False})
                if r["failed"] > 0:
                    print(f"  !! bank load {r['loaded']}/20 failed {r['failed']}: {r['err']}")
                x = dec(r)
                a = a_max(x, r["sr"]); pk = db(np.max(np.abs(x)))
                fl = flatness(x, r["sr"])
                out["spells"][nm] = {"a": a, "peak": pk, "flat": fl}
                print(f"  key {key} {nm:>12}: A {a:7.2f}  peak {pk:7.2f} dBFS  "
                      f"flatness {fl:.4f}   -> {a - stand:+5.1f} dB over stand bed")
            r = pg.evaluate(SPELL, {"secs": 4.0, "key": 4, "synth": True})
            x = dec(r)
            fl = flatness(x, r["sr"])
            out["spells"]["bell_synth"] = {"a": a_max(x, r["sr"]), "flat": fl}
            print(f"  key 4 BELL (synth fallback): flatness {fl:.4f}  "
                  f"A {a_max(x, r['sr']):7.2f} dBA   <- the sound this replaces")

        if which in ("all", "events"):
            print("\nEVENTS")
            walk = wind({"speed01": 0.5, "real": True})["a"]
            for sp in (0.3, 1.0):
                r = pg.evaluate(WHOOSH, {"secs": 2.5, "sfx": 1, "speed01": sp})
                x = dec(r)
                a = a_max(x, r["sr"])
                print(f"  jump whoosh sp={sp} (LEVEL_WHOOSH={r['lvl']}): A {a:7.2f}  "
                      f"peak {db(np.max(np.abs(x))):7.2f} dBFS  -> {a - walk:+5.1f} dB over walk bed")

        br.close()

    with open("spellprobe_last.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("\n  -> spellprobe_last.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
