#!/usr/bin/env python
"""DRIFTWAKE — set the recorded one-shot levels against the wind bed, by measuring.

A sample and a synthesised voice are not comparable by their gain numbers: the
synth voices are white noise through a bandpass, which costs ~12 dB of insertion
loss, while a decoded .ogg arrives at the gain node at the level it was recorded
at (these decode at about -1.4 dBFS peak). So the sample levels in audio.js cannot
be picked by analogy with the crunch levels next to them; they have to be measured
against the thing they sit on, which is the wind bed.

The acceptance criterion this exists to check:

    a footfall must sit CLEARLY ABOVE the standstill wind bed.

Before the wind fix it sat 7.9 dB BELOW it, which is the whole of the owner's
"odd white noise" report — a bed louder than the events on top of it stops being
a bed and becomes a noise floor.

Everything is rendered offline through a replica of audio.js's master chain (0.8
master -> the same DynamicsCompressor -> destination), because the live tap on this
page is starved at single-digit fps. A-weighted, because the ear is ~30 dB more
sensitive at 2 kHz than at 60 Hz and a flat RMS scores a rumble and a hiss the same.

    python levelprobe.py                        # report at the levels in audio.js
    python levelprobe.py --sweep                # sweep candidate gains
"""
import argparse, base64, json, re, sys, time
from pathlib import Path
import numpy as np
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/snowflow/index.html"
AUDIO_JS = Path(__file__).resolve().parent.parent / "src" / "audio" / "audio.js"

BOOT = r"""
(() => { window.__sfReady = () => {
    const SF = globalThis.SNOWFLOW;
    if (!SF || !SF.terrain || !SF.rig || !SF.character) return false;
    const b = document.getElementById('boot');
    return !(b && !b.classList.contains('gone')); }; })();
"""

# The wind bed, offline, at a pinned operating point. Same chain as everything else.
WIND = r"""
async (cfg) => {
  const G = await import('/games/snowflow/src/audio/graph.js');
  const V = await import('/games/snowflow/src/audio/voices.js');
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.floor(SR*cfg.secs), SR);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value=-8; lim.knee.value=6; lim.ratio.value=6;
  lim.attack.value=0.004; lim.release.value=0.18; lim.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value=0.8; master.connect(lim);
  const wb = new V.WindBed(ctx, G.noiseBuffer(ctx,false,0x5f3a91c7),
                                G.noiseBuffer(ctx,true,0x1d7be40b), master);
  wb.drive(0, cfg.t, cfg.strength, cfg.speed01, cfg.surf, 0, 1);
  const buf = await ctx.startRendering();
  const L=buf.getChannelData(0), R=buf.getChannelData(1);
  const m=new Float32Array(buf.length);
  for (let i=0;i<buf.length;i++) m[i]=(L[i]+R[i])*0.5;
  const by=new Uint8Array(m.buffer); let s=''; const CH=0x8000;
  for (let i=0;i<by.length;i+=CH) s+=String.fromCharCode.apply(null,by.subarray(i,i+CH));
  return { sr: SR, pcm: btoa(s) };
}
"""

# One recorded one-shot (or a layered pair) through the same chain, at a given gain.
# This is exactly the graph SampleBank.play() builds: source -> gain -> panner -> master.
SAMPLE = r"""
async (cfg) => {
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.floor(SR*cfg.secs), SR);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value=-8; lim.knee.value=6; lim.ratio.value=6;
  lim.attack.value=0.004; lim.release.value=0.18; lim.connect(ctx.destination);
  const master = ctx.createGain(); master.gain.value=0.8; master.connect(lim);
  for (const L of cfg.layers) {
    const ab = await (await fetch('/games/snowflow/assets/audio/'+L.file)).arrayBuffer();
    const b  = await ctx.decodeAudioData(ab);
    const p = ctx.createStereoPanner(); p.pan.value = L.pan; p.connect(master);
    const g = ctx.createGain(); g.gain.value = L.gain; g.connect(p);
    const s = ctx.createBufferSource(); s.buffer=b; s.playbackRate.value=L.rate;
    s.connect(g); s.start(0);
  }
  const buf = await ctx.startRendering();
  const Lc=buf.getChannelData(0), Rc=buf.getChannelData(1);
  const m=new Float32Array(buf.length);
  for (let i=0;i<buf.length;i++) m[i]=(Lc[i]+Rc[i])*0.5;
  const by=new Uint8Array(m.buffer); let s=''; const CH=0x8000;
  for (let i=0;i<by.length;i+=CH) s+=String.fromCharCode.apply(null,by.subarray(i,i+CH));
  return { sr: SR, pcm: btoa(s) };
}
"""

# The synthesised footfall, for the before/after comparison.
CRUNCH = r"""
async () => {
  const G = await import('/games/snowflow/src/audio/graph.js');
  const V = await import('/games/snowflow/src/audio/voices.js');
  const SR=48000; const ctx=new OfflineAudioContext(2, Math.floor(SR*1.0), SR);
  const lim=ctx.createDynamicsCompressor();
  lim.threshold.value=-8; lim.knee.value=6; lim.ratio.value=6;
  lim.attack.value=0.004; lim.release.value=0.18; lim.connect(ctx.destination);
  const master=ctx.createGain(); master.gain.value=0.8; master.connect(lim);
  const cp=new V.CrunchPool(ctx, G.noiseBuffer(ctx,false,0x5f3a91c7), master, 4);
  cp.fire(0.02, 1260, 0.75, 0.92, 0.40, 0.145, 0.028, -0.22);
  const buf=await ctx.startRendering();
  const L=buf.getChannelData(0), R=buf.getChannelData(1);
  const m=new Float32Array(buf.length);
  for (let i=0;i<buf.length;i++) m[i]=(L[i]+R[i])*0.5;
  const by=new Uint8Array(m.buffer); let s=''; const CH=0x8000;
  for (let i=0;i<by.length;i+=CH) s+=String.fromCharCode.apply(null,by.subarray(i,i+CH));
  return { sr:SR, pcm: btoa(s) };
}
"""

# Momentary loudness window. 200 ms, and a MAXIMUM over sliding positions rather
# than one fixed window from t=0 — two corrections to a naive reading:
#
#   · a footstep's energy spans ~185 ms, so averaging it over a fixed 400 ms window
#     folds in 200 ms of silence and reports the transient ~3 dB quieter than it is;
#   · the ear integrates loudness over roughly this long, so the peak short-term
#     level is what decides whether a transient is heard over a steady background,
#     not its average across an arbitrary window.
#
# The bed is steady, so for the bed this returns essentially its continuous level
# and the two are directly comparable.
WINDOW = 0.20


def db(x): return -999.0 if x <= 1e-12 else 20.0*np.log10(x)
def dec(r): return np.frombuffer(base64.b64decode(r["pcm"]), dtype="<f4").astype(np.float64)


def a_max(x, sr, win=WINDOW, hop=0.02):
    """Maximum A-weighted level over a sliding `win`-second window."""
    n = int(win*sr); h = int(hop*sr)
    if len(x) <= n:
        return a_db(x, sr)
    best = -999.0
    for i in range(0, len(x)-n+1, h):
        v = a_db(x[i:i+n], sr)
        if v > best: best = v
    return best


def a_db(x, sr):
    n = len(x)
    X = np.fft.rfft(x*np.hanning(n)); f = np.maximum(np.fft.rfftfreq(n, 1.0/sr), 1e-6)
    f2 = f*f
    ra = (12194.0**2*f2**2)/((f2+20.6**2)*np.sqrt((f2+107.7**2)*(f2+737.9**2))*(f2+12194.0**2))
    w = 10.0**((2.0+20.0*np.log10(np.maximum(ra,1e-20)))/20.0)
    p = (np.sum(np.abs(X*w)**2)*2.0)/(n*n*0.375)
    return db(np.sqrt(p))


def levels_from_source():
    """Read the three constants out of audio.js, so the probe reports the code as
    it actually stands rather than a number typed twice."""
    src = AUDIO_JS.read_text(encoding="utf-8")
    out = {}
    for k in ("LEVEL_STEP", "LEVEL_LAND", "LEVEL_CRUST"):
        m = re.search(r"const\s+" + k + r"\s*=\s*([0-9.]+)", src)
        if not m:
            raise SystemExit(f"{k} not found in {AUDIO_JS}")
        out[k] = float(m.group(1))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep", action="store_true")
    ap.add_argument("--tag", default="after")
    args = ap.parse_args()
    L = levels_from_source()
    print(f"  levels read from audio.js: {L}")

    out = {"tag": args.tag, "levels": L}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--enable-unsafe-webgpu","--ignore-gpu-blocklist","--use-angle=d3d11",
            "--disable-gpu-sandbox","--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width":1280,"height":720})
        pg.add_init_script(BOOT)
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time()+180
        while time.time()<end and not pg.evaluate("window.__sfReady && window.__sfReady()"):
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(800)

        ts = np.linspace(0,60,400)
        g = 0.62+0.38*(0.6*np.sin(ts*0.23)+0.4*np.sin(ts*0.517+1.7))
        t_crest = float(ts[int(np.argmax(g))])

        def wind(strength, sp, surf=0.0):
            r = pg.evaluate(WIND, {"strength":strength,"speed01":sp,"surf":surf,
                                   "secs":4.0,"t":t_crest})
            x = dec(r)[int(1.2*r["sr"]):]
            return {"rms": db(np.sqrt(np.mean(x**2))), "a": a_max(x, r["sr"]),
                    "peak": db(np.max(np.abs(x)))}

        def sample(layers, secs=1.0):
            r = pg.evaluate(SAMPLE, {"layers":layers,"secs":secs})
            x = dec(r)
            return {"a": a_max(x, r["sr"]), "peak": db(np.max(np.abs(x)))}

        print("\n  THE BED, at each speed (the thing everything else sits on top of)")
        bed = {}
        for nm, st, sp in (("standstill w=1.0 sp=0",1.0,0.0),
                           ("calm still  w=0.0 sp=0",0.0,0.0),
                           ("walk        w=1.0 sp=.5",1.0,0.5),
                           ("run         w=1.0 sp=1",1.0,1.0),
                           ("gale  run   w=2.0 sp=1",2.0,1.0)):
            m = wind(st, sp); bed[nm] = m
            print(f"    {nm:24} rms {m['rms']:7.2f}  A {m['a']:7.2f}  peak {m['peak']:7.2f} dBFS")
        out["bed"] = bed
        floor = bed["standstill w=1.0 sp=0"]["a"]
        walk_bed = bed["walk        w=1.0 sp=.5"]["a"]
        run_bed = bed["run         w=1.0 sp=1"]["a"]

        # controller.js line 462: footImpact = clamp(0.35 + speed/RUN_SPEED, 0, 1.3),
        # so a footfall's own loudness is tied to the same speed that sets the bed.
        # Comparing a footstep against the STANDSTILL bed would be comparing it
        # against a bed that cannot be playing while it happens.
        IMP_WALK, IMP_RUN = 0.85, 1.30

        r = pg.evaluate(CRUNCH); x = dec(r)
        syn = {"a": a_max(x, r["sr"]), "peak": db(np.max(np.abs(x)))}
        out["synth_footfall"] = syn
        print(f"\n  synthesised footfall, the fallback (imp=1)  A {syn['a']:7.2f}  "
              f"peak {syn['peak']:7.2f} dBFS  -> {syn['a']-walk_bed:+.1f} dB over the walk bed")

        if args.sweep:
            print("\n  SWEEP — footfall at a WALK (imp 0.85), against the walk bed "
                  f"{walk_bed:.1f} dBA")
            for gv in (0.25,0.4,0.6,0.9,1.3,1.8,2.4):
                m = sample([{"file":"footstep_snow_0.ogg","gain":gv*IMP_WALK,
                             "rate":0.96,"pan":-0.22}])
                print(f"    LEVEL_STEP {gv:5.2f} : A {m['a']:7.2f}  peak {m['peak']:7.2f} dBFS"
                      f"   -> {m['a']-walk_bed:+5.1f} dB over the walk bed")
            print("\n  SWEEP — landing, impact_heavy_0 + crust step at 0.74, ratio 1:0.65")
            for gv in (0.25,0.4,0.6,0.9,1.3,1.8):
                m = sample([{"file":"impact_heavy_0.ogg","gain":gv,"rate":0.9,"pan":0.0},
                            {"file":"footstep_snow_2.ogg","gain":gv*0.65,"rate":0.74,"pan":0.0}])
                print(f"    LEVEL_LAND {gv:5.2f} : A {m['a']:7.2f}  peak {m['peak']:7.2f} dBFS"
                      f"   -> {m['a']-walk_bed:+5.1f} dB over the walk bed")

        print("\n  AT THE LEVELS IN audio.js, each against the bed it actually plays over")
        shots = {}
        for nm, ref, layers in (
            ("footfall walk", walk_bed,
             [{"file":"footstep_snow_0.ogg","gain":L["LEVEL_STEP"]*IMP_WALK,
               "rate":0.96,"pan":-0.22}]),
            ("footfall run", run_bed,
             [{"file":"footstep_snow_2.ogg","gain":L["LEVEL_STEP"]*IMP_RUN,
               "rate":0.93,"pan":0.22}]),
            ("landing hard imp=1", walk_bed,
             [{"file":"impact_heavy_0.ogg","gain":L["LEVEL_LAND"],"rate":0.90,"pan":0.0},
              {"file":"footstep_snow_2.ogg","gain":L["LEVEL_CRUST"],"rate":0.74,"pan":0.0}]),
            ("landing soft imp=0.4", floor,
             [{"file":"impact_medium_0.ogg","gain":L["LEVEL_LAND"]*0.4,"rate":1.10,"pan":0.0},
              {"file":"footstep_snow_4.ogg","gain":L["LEVEL_CRUST"]*0.4,"rate":0.74,"pan":0.0}]),
        ):
            m = sample(layers); m["over"] = m["a"] - ref; shots[nm] = m
            print(f"    {nm:22} A {m['a']:7.2f}  peak {m['peak']:7.2f} dBFS"
                  f"   -> {m['over']:+5.1f} dB over its bed")

        # Worst case for the limiter: a hard landing on top of the loudest bed.
        m = sample([{"file":"impact_heavy_0.ogg","gain":L["LEVEL_LAND"],"rate":0.9,"pan":0},
                    {"file":"footstep_snow_2.ogg","gain":L["LEVEL_CRUST"],"rate":0.74,"pan":0},
                    {"file":"footstep_snow_0.ogg","gain":L["LEVEL_STEP"]*IMP_RUN,
                     "rate":0.93,"pan":-0.2}])
        shots["stacked worst case"] = m
        print(f"    {'stacked worst case':22} A {m['a']:7.2f}  peak {m['peak']:7.2f} dBFS"
              f"   (headroom to 0 dBFS: {-m['peak']:.1f} dB)")

        out["shots"] = shots
        out["floor_a"] = floor
        br.close()

    p = f"levelprobe_{args.tag}.json"
    Path(__file__).resolve().with_name(p).write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"\n  -> {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
