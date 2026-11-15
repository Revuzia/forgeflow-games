#!/usr/bin/env python
"""orch_lowpost_ab - ORCH lane (Wave 4): interleaved A/B of the LOW tier with and without the composer. INFORMATION ONLY.

    python _harness/new/orch_lowpost_ab.py --disk --isolate            # stepped bench + the perfcheck probe, ABAB x2
    python _harness/new/orch_lowpost_ab.py --disk --isolate --no-lp    # the stepped bench only (about 1 minute per arm)
    python _harness/new/orch_lowpost_ab.py --disk --reps 1 --no-stepped --lp-only-label demo

Arms (same build, same map, same seed, same landed pose; the only difference is one URL flag):
    A = low with the composer   (?lowpost=1: RenderPass -> disabled bloom -> OutputPass, the behaviour before the ORCH change)
    B = low direct to canvas    (the new default)
Order is A B A B (interleaved), because this box is shared and drifts: a non-interleaved pair measured DPR 0.75 SLOWER than 1.0
on the same GPU (PLAN section 2, DynRes row).

Three measurements:
  inpage    (the strongest: the skeptic's tierprobe2 method) ONE page, one landed pose; the kernel is flipped between the real
            composer and the direct draw every 12 frames, ABBA order, so box drift cancels. Needs no second page load.
Per-arm measurements (separate page loads):
  stepped   boot at a stored 'low', load the match, land by fastForward (sim only), freeze the kernel loop, then time N
            kernel frames (tweens, mixers, updaters, camera fit, draw) each followed by a 1-pixel gl.readPixels so the GPU
            work is INCLUDED. rAF is never waited on, so a starved rAF cannot fake a result. Reported: median / p90 / p99 ms
            per frame, draw calls and triangles of the last frame (exact counts), textures / geometries / programs alive.
  perfcheck the lc_liveprobe.py windows that _harness/perfcheck.py reports (menu / drop / ground rAF p50 / p99 with the real
            game loop), one map, --profile dgpu-uncapped by default (the only profile in which rAF runs on this box).
Nothing here gates: milliseconds are information; the counts are printed for the record. Exit 0 when at least one arm of each
kind measured, 2 when nothing could be measured. Never 1.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from orch_lowpost import TIER_INIT, url_for, head_override, PROBE_JS  # noqa: E402

BENCH_JS = r"""([n, warm, dt]) => {
  const C = window.__LC__, W = C.W, k = W.kernel, r = k.renderer, gl = r.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < warm; i++) { C.stepFrames(1, dt, true); sync(); }
  const ms = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); C.stepFrames(1, dt, true); sync(); ms.push(performance.now() - t0); }
  const info = r.info;
  return { ms, calls: info.render.calls, tris: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries,
           programs: info.programs ? info.programs.length : -1, post: W._gfx ? W._gfx.post : null, tier: W._gfx ? W._gfx.tier : null,
           composer: k.composer ? (k.composer.isDirectPost ? 'direct' : 'real') : null, pr: r.getPixelRatio(), buf: [r.domElement.width, r.domElement.height],
           pos: W.player ? [+W.player.pos.x.toFixed(2), +W.player.pos.y.toFixed(2), +W.player.pos.z.toFixed(2)] : null, phase: W.phase, t: +W.t.toFixed(2) }; }"""


INPAGE_JS = r"""([rounds, warm, n, dt]) => {
  const C = window.__LC__, W = C.W, k = W.kernel, r = k.renderer, gl = r.getContext(), px = new Uint8Array(4);
  const real = k.composer;
  if (!real || real.isDirectPost) return { error: 'needs ?lowpost=1 so there is a real composer to flip against' };
  const set = { A: () => { k.composer = real; }, B: () => { k.composer = null; } };   // null = the kernel's own no-composer draw (what DIRECT_POST.render does)
  const S = { A: [], B: [] }, counts = { A: null, B: null };
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? ['B', 'A'] : ['A', 'B'];
    for (const key of order) {
      set[key]();
      for (let i = 0; i < warm; i++) C.stepFrames(1, dt, true);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ms = [];
      for (let i = 0; i < n; i++) { const t0 = performance.now(); C.stepFrames(1, dt, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ms.push(performance.now() - t0); }
      S[key].push(ms);
      counts[key] = { calls: r.info.render.calls, tris: r.info.render.triangles, textures: r.info.memory.textures, programs: r.info.programs ? r.info.programs.length : -1 };
    }
  }
  k.composer = real;
  return { S, counts, pos: W.player ? [+W.player.pos.x.toFixed(2), +W.player.pos.y.toFixed(2), +W.player.pos.z.toFixed(2)] : null };
}"""


def pct(a, p):
    a = sorted(a)
    k = (len(a) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(a) - 1)
    return a[lo] + (a[hi] - a[lo]) * (k - lo)


def stepped_arm(args, label, lowpost):
    out = {"label": label, "lowpost": lowpost}
    with C.Session(args, "orch_ab_" + label, init_scripts=[TIER_INIT]) as s:
        if args.isolate:
            head_override(s)
        s.boot(url_for(args.base, "low", lowpost, 1))
        out["menu"] = s.js(PROBE_JS)
        s.start_match("standard", args.seed, args.map, enter=True)
        s.guard_player(True)
        out["landed"] = s.land(max_s=150, step=1 / 30, protect=True)
        s.sleep(0.5)
        s.freeze_loop()
        s.step_frames(3, 1 / 60, render=True)
        r = s.js(BENCH_JS, [args.frames, args.warm, 1 / 60])
        ms = r.pop("ms")
        out.update(r)
        out["frames"] = len(ms)
        out["p50"] = round(statistics.median(ms), 2)
        out["p90"] = round(pct(ms, 90), 2)
        out["p99"] = round(pct(ms, 99), 2)
        out["min"] = round(min(ms), 2)
        out["mean"] = round(statistics.fmean(ms), 2)
        out["diag"] = C.diag_problems(s.diagnostics())
    return out


def inpage_arm(args):
    out = {}
    with C.Session(args, "orch_ab_inpage", init_scripts=[TIER_INIT]) as s:
        if args.isolate:
            head_override(s)
        s.boot(url_for(args.base, "low", True, 1))
        s.start_match("standard", args.seed, args.map, enter=True)
        s.guard_player(True)
        out["landed"] = s.land(max_s=150, step=1 / 30, protect=True)
        s.sleep(0.5)
        s.freeze_loop()
        s.step_frames(3, 1 / 60, render=True)
        r = s.js(INPAGE_JS, [args.rounds, args.warm_inpage, args.n_inpage, 1 / 60])
        out["raw"] = r
        out["diag"] = C.diag_problems(s.diagnostics())
    if r.get("error"):
        return out
    drop = args.discard_rounds
    for key, name in (("A", "composer"), ("B", "direct")):
        rounds = r["S"][key][drop:]
        flat = [x for rd in rounds for x in rd]
        out[name] = {"samples": len(flat), "p25": round(pct(flat, 25), 2), "p50": round(pct(flat, 50), 2), "p75": round(pct(flat, 75), 2),
                     "p90": round(pct(flat, 90), 2), "min": round(min(flat), 2),
                     "roundP50s": [round(statistics.median(rd), 1) for rd in r["S"][key]], "counts": r["counts"][key]}
    out["delta_p50_ms"] = round(out["direct"]["p50"] - out["composer"]["p50"], 2)
    out["delta_p50_pct"] = round(100 * (out["direct"]["p50"] / out["composer"]["p50"] - 1), 1)
    # per-round paired difference (round i direct p50 - round i composer p50): the drift-free view
    pair = [round(statistics.median(b) - statistics.median(a), 1) for a, b in zip(r["S"]["A"][drop:], r["S"]["B"][drop:])]
    out["pairedRoundDeltaMs"] = pair
    out["roundsDirectFaster"] = sum(1 for d in pair if d < 0)
    return out


def lp_arm(args, label, lowpost, v):
    import lc_liveprobe as LP
    orig_init = getattr(LP, "_ORCH_ORIG_INIT", None) or LP.INIT_JS
    LP._ORCH_ORIG_INIT = orig_init
    LP.INIT_JS = orig_init + "\n(() => { try { localStorage.setItem('lc_settings', JSON.stringify({ graphics: 'low' })); } catch (_) {} })();\n"
    LP.URL = args.base + ("?lowpost=1" if lowpost else "")
    u = C.urllib.parse.urlparse(args.base)
    srv = C.DiskServer(["%s://%s" % (u.scheme, u.netloc)], "HEAD" if args.isolate else None)
    if args.isolate:
        path = os.path.join(C.ROOT, "runtime", "3d", "ffg_royale3d.js")
        body = open(path, "rb").read()
        srv.overrides.append((lambda url: url.split("?")[0].endswith("/runtime/3d/ffg_royale3d.js"),
                              lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8",
                                                                                           "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    LP.ROUTER = (lambda url: srv.matches(url), srv.handle)
    argv = ["--reps", "1", "--maps", args.map, "--label", "orchab_" + label, "--profile", args.profile, "--no-again",
            "--menu", "3", "--control", "3", "--drop", str(args.lp_drop), "--ground", str(args.lp_ground), "--max-slices", "2",
            "--width", "1600", "--height", "900", "--seed", str(args.seed)]
    path = LP.main(argv)
    res = json.load(open(path, encoding="utf-8")).get("results", []) if path and os.path.isfile(path) else []
    row = {"label": label, "lowpost": lowpost, "report": path}
    if res:
        r = res[0]
        row["pageerrors"] = r.get("pageerror_count")
        row["graphics"] = (r.get("gl") or {}).get("graphics")
        row["notes"] = r.get("notes")
        for name in ("menu", "drop", "ground"):
            w = (r.get("windows") or {}).get(name) or {}
            row[name] = {k: w.get(k) for k in ("frames", "p50", "p99", "programs", "textures", "heapMB_end")}
    return row


def fmt_table(rows, cols):
    lines = []
    head = "  %-8s %-9s" % ("arm", "post") + "".join("%10s" % c for c in cols)
    lines.append(head)
    for r in rows:
        lines.append("  %-8s %-9s" % (r["label"], r.get("composer") or "?") + "".join("%10s" % (r.get(c) if r.get(c) is not None else "-") for c in cols))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--isolate", action="store_true", help="git HEAD for every file except the working-copy ffg_royale3d.js")
    ap.add_argument("--reps", type=int, default=2, help="A B repetitions (default 2 = ABAB)")
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--frames", type=int, default=90, help="timed stepped frames per arm")
    ap.add_argument("--warm", type=int, default=20)
    ap.add_argument("--no-stepped", action="store_true")
    ap.add_argument("--inpage", action="store_true", help="run the in-page flip measurement (composer <-> direct every n frames, ABBA)")
    ap.add_argument("--rounds", type=int, default=10)
    ap.add_argument("--discard-rounds", type=int, default=2, help="leading rounds dropped (program compiles)")
    ap.add_argument("--warm-inpage", type=int, default=3)
    ap.add_argument("--n-inpage", type=int, default=12)
    ap.add_argument("--no-lp", action="store_true", help="skip the lc_liveprobe (perfcheck engine) arms")
    ap.add_argument("--profile", default="dgpu-uncapped", choices=["dgpu-uncapped", "default", "default-uncapped"])
    ap.add_argument("--lp-drop", type=float, default=8.0)
    ap.add_argument("--lp-ground", type=float, default=15.0)
    args = ap.parse_args()
    if args.isolate and not args.rev:
        args.rev = "HEAD"

    def body(v):
        order = []
        for i in range(args.reps):
            order += [("A%d" % (i + 1), True), ("B%d" % (i + 1), False)]
        stepped, lp = [], []
        if not args.no_stepped:
            for label, lowpost in order:
                print("[stepped] arm %s (%s) ..." % (label, "composer" if lowpost else "direct"), flush=True)
                r = stepped_arm(args, label, lowpost)
                stepped.append(r)
                v.info("stepped arm %s" % label, {k: r.get(k) for k in ("composer", "post", "p50", "p90", "p99", "calls", "tris", "textures", "geometries", "programs", "buf", "pos", "diag")})
            v.data["stepped"] = stepped
            ok = [r for r in stepped if r.get("frames")]
            if ok:
                print("\nstepped (GPU-synced) ms per frame, low tier, %s seed %d:" % (args.map, args.seed))
                print(fmt_table(ok, ["p50", "p90", "p99", "calls", "tris", "textures", "geometries", "programs"]))
                a = [r["p50"] for r in ok if r["lowpost"]]
                b = [r["p50"] for r in ok if not r["lowpost"]]
                if a and b:
                    v.info("stepped A (composer) vs B (direct) median of per-arm p50 ms", {"A": round(statistics.median(a), 2), "B": round(statistics.median(b), 2),
                                                                                      "delta_ms": round(statistics.median(b) - statistics.median(a), 2),
                                                                                      "delta_pct": round(100 * (statistics.median(b) / statistics.median(a) - 1), 1)})
                if a and b:
                    v.check("the stepped bench measured both arms", True, {"A": a, "B": b})
                else:
                    v.cnj("the stepped bench measured both arms", {"A": a, "B": b})
                same_pose = len({tuple(r.get("pos") or []) for r in ok}) == 1
                v.info("same pose in every arm (landed position identical)", {"same": same_pose, "pos": [r.get("pos") for r in ok]})
            else:
                v.cnj("the stepped bench measured both arms", "no arm produced frames")
        if args.inpage:
            print("[inpage] flipping composer <-> direct inside one page ...", flush=True)
            ip = inpage_arm(args)
            v.data["inpage"] = ip
            if ip.get("error") or "direct" not in ip:
                v.cnj("the in-page flip measured both routes", ip.get("raw") if isinstance(ip.get("raw"), dict) else "no data")
            else:
                print("\nin-page flip (GPU-synced ms per frame, same page and pose, ABBA), low tier, %s:" % args.map)
                for name in ("composer", "direct"):
                    d = ip[name]
                    print("  %-9s n %3d  p25 %7.1f  p50 %7.1f  p75 %7.1f  p90 %7.1f  min %6.1f | calls %s tris %s textures %s programs %s" % (
                        name, d["samples"], d["p25"], d["p50"], d["p75"], d["p90"], d["min"], d["counts"]["calls"], d["counts"]["tris"],
                        d["counts"]["textures"], d["counts"]["programs"]))
                print("  direct - composer p50: %+.2f ms (%+.1f %%); per-round paired deltas %s; direct faster in %d of %d rounds" % (
                    ip["delta_p50_ms"], ip["delta_p50_pct"], ip["pairedRoundDeltaMs"], ip["roundsDirectFaster"], len(ip["pairedRoundDeltaMs"])))
                v.info("in-page flip (information)", {k: ip[k] for k in ("composer", "direct", "delta_p50_ms", "delta_p50_pct", "pairedRoundDeltaMs", "roundsDirectFaster")})
                v.check("the in-page flip measured both routes", True, {"composer": ip["composer"]["samples"], "direct": ip["direct"]["samples"]})
        if not args.no_lp:
            for label, lowpost in order:
                print("[perfcheck/lc_liveprobe] arm %s (%s) ..." % (label, "composer" if lowpost else "direct"), flush=True)
                try:
                    r = lp_arm(args, label, lowpost, v)
                except Exception as e:  # information only
                    r = {"label": label, "lowpost": lowpost, "error": str(e)[:400]}
                lp.append(r)
                v.info("perfcheck arm %s" % label, r)
            v.data["perfcheck"] = lp
            got = [r for r in lp if (r.get("ground") or {}).get("frames")]
            if got:
                print("\nperfcheck windows (rAF ms), low tier, %s:" % args.map)
                for r in got:
                    print("  %-4s %-9s drop p50 %s p99 %s | ground p50 %s p99 %s (frames %s) | graphics %s | pageerrors %s" % (
                        r["label"], "composer" if r["lowpost"] else "direct", r["drop"].get("p50"), r["drop"].get("p99"),
                        r["ground"].get("p50"), r["ground"].get("p99"), r["ground"].get("frames"), r.get("graphics"), r.get("pageerrors")))
                v.check("perfcheck (lc_liveprobe) measured >= 1 ground window", True, {"arms": len(got)})
            else:
                v.cnj("perfcheck (lc_liveprobe) measured >= 1 ground window", "no arm produced a ground window")

    return C.run_gate("orch_lowpost_ab", body, args)


if __name__ == "__main__":
    sys.exit(main())
