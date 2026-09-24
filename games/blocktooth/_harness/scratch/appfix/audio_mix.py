"""PC-11: music vs SFX bus RMS in busy play (real keys; dev cheats set up the load). Taps = AnalyserNodes
on the engine's sfx / music / duck gains (flows.py AUDIO_JS, read-only)."""
import os, sys, time, json, argparse, statistics
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, ensure_play
from flows import AUDIO_JS
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--seconds", type=float, default=45); ap.add_argument("--tag", default="x")
ap.add_argument("--titan", default="voltkite"); ap.add_argument("--biome", default="lockwater")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "audiomix"); S.start(); S.page.add_init_script(AUDIO_JS)
CIRCLE = [{"KeyW"}, {"KeyW", "KeyD"}, {"KeyD"}, {"KeyD", "KeyS"}, {"KeyS"}, {"KeyS", "KeyA"}, {"KeyA"}, {"KeyA", "KeyW"}]
try:
    S.goto(build_url(args.base, autostart=1, seed=4242, titan=args.titan, biome=args.biome, dev=1)); S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1.2)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(0.5)
    S.cheat("god", True)
    edges = S.js("() => { const A = window.__AU__; A.tap(); const post = A.edges.some(e => e[0] === 5 && e[1] === 'g0');"
                 " if (post && !A.taps.sfxOut) { const a = A.ctx.createAnalyser(); a.fftSize = 2048; A.gains[5].connect(a); A.taps.sfxOut = a; }"
                 " return { state: A.ctx && A.ctx.state, post, edges: A.edges.slice(0, 16) }; }")
    print(json.dumps(edges))
    idle = []
    for _ in range(12):
        idle.append(S.js("() => { const r = window.__AU__.rms(); return [r.music.rms, (r.sfxOut || r.sfx).rms]; }")); time.sleep(0.25)
    S.cheat("rank", 2); time.sleep(1.5)
    samples = []; t0 = time.time(); i = 0
    while time.time() - t0 < args.seconds:
        s = S.state() or {}
        if s.get("screen") != "play":
            S.release_all(); ensure_play(S, 8); continue
        if (s.get("enemies") or 0) < 60:
            for k, n in (("android", 12), ("drone", 6), ("tank", 4), ("walker", 3), ("apc", 3)): S.cheat("spawn", k, n)
        S.hold(CIRCLE[i % 8] | ({"Space"} if i % 6 == 0 else set())); i += 1
        for _ in range(3):
            r = S.js("() => { const r = window.__AU__.rms(); return [r.music.rms, (r.sfxOut || r.sfx).rms, r.sfx.rms]; }")
            samples.append(r); time.sleep(0.12)
    S.release_all()
    mus = [x[0] for x in samples]; sfx = [x[1] for x in samples]
    ratio = [m / s for m, s in zip(mus, sfx) if s > 1e-4]
    out = {"tag": args.tag, "n": len(samples),
           "idle_music_mean": round(statistics.mean(x[0] for x in idle), 4), "idle_sfx_mean": round(statistics.mean(x[1] for x in idle), 4),
           "busy_music_mean": round(statistics.mean(mus), 4), "busy_sfx_mean": round(statistics.mean(sfx), 4),
           "busy_sfx_pre_glue_mean": round(statistics.mean(x[2] for x in samples), 4),
           "busy_music_over_sfx_median": round(statistics.median(ratio), 3),
           "busy_frac_sfx_5x_music": round(sum(1 for r in ratio if r < 0.2) / max(1, len(ratio)), 3),
           "busy_music_p10_p90": [round(sorted(mus)[len(mus) // 10], 4), round(sorted(mus)[len(mus) * 9 // 10], 4)],
           "busy_sfx_p10_p90": [round(sorted(sfx)[len(sfx) // 10], 4), round(sorted(sfx)[len(sfx) * 9 // 10], 4)]}
    print(json.dumps(out))
    with open(os.path.join(HERE, "audio_mix_%s.json" % args.tag), "w") as f: json.dump(out, f, indent=1)
finally:
    S.close()
