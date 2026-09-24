"""cleanup lane / PC-11: music-bus vs sfx-bus RMS over N s of BUSY Size III play (real keys; dev cheats
only set up the load). Taps = AnalyserNodes on the engine's gain nodes (flows.AUDIO_JS, read-only):
music = post-duck gain (what reaches master), sfx = post-glue sfxOut gain (what reaches master).
Sampled every ~40 ms; reports mean RMS, energy RMS (sqrt of mean square), dBFS, and ratio stats."""
import os, sys, time, json, argparse, statistics, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, ensure_play
from flows import AUDIO_JS
ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument("--seconds", type=float, default=20); ap.add_argument("--tag", default="x")
ap.add_argument("--titan", default="hearthback"); ap.add_argument("--biome", default="grideast")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "mixmeter"); S.start(); S.page.add_init_script(AUDIO_JS)
CIRCLE = [{"KeyW"}, {"KeyW", "KeyD"}, {"KeyD"}, {"KeyD", "KeyS"}, {"KeyS"}, {"KeyS", "KeyA"}, {"KeyA"}, {"KeyA", "KeyW"}]
TAP = ("() => { const A = window.__AU__; A.tap();"
       " if (!A.taps.sfxOut && A.gains[5]) { const a = A.ctx.createAnalyser(); a.fftSize = 2048; A.gains[5].connect(a); A.taps.sfxOut = a; }"
       " return { state: A.ctx && A.ctx.state, edges: A.edges.slice(0, 20) }; }")
RD = "() => { const r = window.__AU__.rms(); return [r.duck.rms, r.sfxOut.rms, r.music.rms, r.sfx.rms, r.master.rms]; }"
def db(x): return round(20 * math.log10(max(x, 1e-6)), 1)
try:
    S.goto(build_url(args.base, autostart=1, seed=4242, titan=args.titan, biome=args.biome, dev=1)); S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1.2)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(0.5)
    S.cheat("god", True)
    print(json.dumps(S.js(TAP)))
    S.cheat("rank", 2); time.sleep(2.0)
    st = S.state() or {}
    print("rank", st.get("rank"), "height", st.get("height"))
    samples = []; t0 = time.time(); i = 0; nxt = 0
    while time.time() - t0 < args.seconds:
        s = S.state() or {}
        if s.get("screen") != "play":
            S.release_all(); ensure_play(S, 8); continue
        if (s.get("enemies") or 0) < 60:
            for k, n in (("android", 12), ("drone", 6), ("tank", 4), ("walker", 3), ("apc", 3)): S.cheat("spawn", k, n)
        S.hold(CIRCLE[i % 8] | ({"Space"} if i % 5 == 0 else set()) | ({"ShiftLeft"} if i % 9 == 4 else set())); i += 1
        for _ in range(8):
            samples.append(S.js(RD)); time.sleep(0.04)
    S.release_all()
    mus = [x[0] for x in samples]; sfx = [x[1] for x in samples]
    ratio = sorted(m / s for m, s in zip(mus, sfx) if s > 1e-4)
    erms = lambda a: math.sqrt(sum(v * v for v in a) / len(a))
    out = {"tag": args.tag, "titan": args.titan, "biome": args.biome, "rank": st.get("rank"), "n": len(samples), "seconds": args.seconds,
           "music_mean_rms": round(statistics.mean(mus), 4), "sfx_mean_rms": round(statistics.mean(sfx), 4),
           "music_energy_rms": round(erms(mus), 4), "sfx_energy_rms": round(erms(sfx), 4),
           "music_dbfs": db(erms(mus)), "sfx_dbfs": db(erms(sfx)),
           "sfx_over_music_energy": round(erms(sfx) / max(1e-6, erms(mus)), 2),
           "music_over_sfx_median": round(ratio[len(ratio) // 2], 3),
           "frac_sfx_5x_music": round(sum(1 for r in ratio if r < 0.2) / max(1, len(ratio)), 3),
           "music_p10_p90": [round(sorted(mus)[len(mus) // 10], 4), round(sorted(mus)[len(mus) * 9 // 10], 4)],
           "sfx_p10_p90": [round(sorted(sfx)[len(sfx) // 10], 4), round(sorted(sfx)[len(sfx) * 9 // 10], 4)],
           "music_predk_mean": round(statistics.mean(x[2] for x in samples), 4),
           "sfx_preglue_mean": round(statistics.mean(x[3] for x in samples), 4),
           "master_mean": round(statistics.mean(x[4] for x in samples), 4),
           "diag_errors": [e for e in (S.diagnostics().get("page_errors") or [])][:3]}
    print(json.dumps(out))
    with open(os.path.join(HERE, "mix_%s.json" % args.tag), "w") as f: json.dump(out, f, indent=1)
finally:
    S.close()
