#!/usr/bin/env python
"""Turn one or more lc_liveprobe_*.json reports into markdown tables: median [min-max] across repeats.

    python lc_liveprobe_table.py _reports/lc_liveprobe_baseline_*.json
"""
import json
import statistics
import sys
import glob

for _s in (sys.stdout,):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def agg(vals, nd=1):
    v = [x for x in vals if num(x)]
    if not v:
        return "n/a"
    m = statistics.median(v)
    f = "%%.%df" % nd
    if len(v) == 1:
        return f % m
    return (f + " [" + f + "-" + f + "]") % (m, min(v), max(v))


def main():
    files = []
    for a in sys.argv[1:]:
        files += glob.glob(a)
    runs = []
    for f in files:
        d = json.load(open(f, encoding="utf-8"))
        runs += d.get("results", [])
    maps = []
    for r in runs:
        if r["map"] not in maps:
            maps.append(r["map"])
    print("runs: %d (%s)" % (len(runs), ", ".join("%s r%s" % (r["map"], r["rep"]) for r in runs)))

    # ---- boot
    print("\n### Boot (ms from navigation start; median [min-max] over %d runs)\n" % len(runs))
    print("| | first paint | __FFG3D__ (kernel up) | __LC__ (menu built) | splash removed | CDN last byte | local last byte | long tasks n / total ms / max | resources / MB |")
    print("|---|---|---|---|---|---|---|---|---|")
    for lab in ("cold", "warm"):
        B = [r.get("boot_" + lab) or {} for r in runs]
        mk = lambda k: [((b.get("marks") or {}).get(k)) for b in B]  # noqa: E731
        lt = [b.get("longtasks") or {} for b in B]
        print("| %s | %s | %s | %s | %s | %s | %s | %s / %s / %s | %s / %s |" % (
            lab, agg([(b.get("paint") or {}).get("first-paint") for b in B], 0), agg(mk("__FFG3D__"), 0), agg(mk("__LC__"), 0),
            agg(mk("splashGone"), 0), agg([b.get("cdnLastEnd") for b in B], 0), agg([b.get("localLastEnd") for b in B], 0),
            agg([x.get("n") for x in lt], 0), agg([x.get("ms") for x in lt], 0), agg([x.get("max") for x in lt], 0),
            agg([b.get("resources") for b in B], 0), agg([b.get("transferMB") for b in B], 2)))

    print("\n### Box control (blank WebGL2 clear page, same browser + flags, measured right before each run)\n")
    print("| map | frames | p50 ms | p95 ms | p99 ms | max ms | >33ms |")
    print("|---|---|---|---|---|---|---|")
    for m in maps:
        C = [r.get("control") or {} for r in runs if r["map"] == m]
        print("| %s | %s | %s | %s | %s | %s | %s |" % (
            m, agg([c.get("frames") for c in C], 0), agg([c.get("p50") for c in C], 2), agg([c.get("p95") for c in C], 2),
            agg([c.get("p99") for c in C], 1), agg([c.get("max") for c in C], 0),
            agg([100 * c["over33"] if num(c.get("over33")) else None for c in C], 1) + "%"))

    print("\n### Match load timeline (ms after startMatch(); first poll sample where the condition held)\n")
    print("| map | main thread first free (first poll after start) | map built (W.map new) | 50 mixers (models loaded) | resolved (lobby shown) | programs at resolve | textures | geometries |")
    print("|---|---|---|---|---|---|---|---|")
    for m in maps:
        rows = []
        for r in runs:
            if r["map"] != m:
                continue
            tl = (r.get("load") or {}).get("tl") or []
            firstfree = next((x["t"] for x in tl if x.get("tag") != "start"), None)
            mapb = next((x["t"] for x in tl if x.get("mapNew")), None)
            mix = next((x["t"] for x in tl if x.get("mixers", 0) >= 50), None)
            res = next((x for x in tl if x.get("tag") == "resolved"), {})
            rows.append((firstfree, mapb, mix, res.get("t"), res.get("programs"), res.get("textures"), res.get("geometries")))
        print("| %s | %s | %s | %s | %s | %s | %s | %s |" % ((m,) + tuple(agg([x[i] for x in rows], 0) for i in range(7))))

    print("\n### Match load / lobby (per map)\n")
    print("| map | startMatch() ms (menu -> lobby shown) | Enter -> drop s (harness wall) | Enter -> drop s (in-page) | land fastForward wall s | endgame over? | endgame wall s | PLAY AGAIN -> lobby s |")
    print("|---|---|---|---|---|---|---|---|")
    for m in maps:
        R = [r for r in runs if r["map"] == m]
        print("| %s | %s | %s | %s | %s | %s | %s | %s |" % (
            m, agg([(r.get("load") or {}).get("ms") for r in R], 0), agg([r.get("lobby_skip_s") for r in R], 2),
            agg([r.get("lobby_skip_page_s") for r in R], 3),
            agg([(r.get("land_ff") or {}).get("wall_s") for r in R], 1),
            "/".join(str((r.get("endgame") or {}).get("over")) for r in R),
            agg([(r.get("endgame") or {}).get("wall_s") for r in R], 0), agg([r.get("again_load_s") for r in R], 1)))

    for wname in ("menu", "drop", "ground", "endgame_realframes", "again_drop"):
        print("\n### Window: %s (median [min-max] across repeats)\n" % wname)
        print("| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for m in maps:
            W = [(r.get("windows") or {}).get(wname) for r in runs if r["map"] == m]
            W = [w for w in W if w]
            if not W:
                continue
            g = [w.get("gpu") or {} for w in W]
            print("| %s | %d | %s | %s | %s | %s | %s | %s | %s / %s (%s / %s) | %s (%s / %s) | %s | %s | %s | %s | %s | %s, %s | %s / %s |" % (
                m, len(W), agg([w.get("avgFps") for w in W]), agg([w.get("p50") for w in W]), agg([w.get("p95") for w in W]),
                agg([w.get("p99") for w in W]), agg([w.get("max") for w in W], 0),
                agg([100 * w["over33"] if num(w.get("over33")) else None for w in W]) + "%",
                agg([w.get("cpuFrame_p50") for w in W]), agg([w.get("cpuFrame_p99") for w in W]),
                agg([w.get("cpuUpd_p50") for w in W]), agg([w.get("cpuRender_p50") for w in W]),
                agg([w.get("calls_med") for w in W], 0), agg([w.get("shadow_med") for w in W], 0), agg([w.get("scene_med") for w in W], 0),
                agg([(w.get("tris_med") or 0) / 1000.0 if num(w.get("tris_med")) else None for w in W], 0) + "k",
                agg([w.get("programs") for w in W], 0), agg([w.get("geometries") for w in W], 0), agg([w.get("textures") for w in W], 0),
                agg([w.get("heapMB_end") for w in W], 0), agg([w.get("dpr") for w in W], 2), (W[-1].get("buf")),
                agg([x.get("cpu_total_pct") for x in g], 0), agg([x.get("others") for x in g], 0)))

    print("\n### Stall attribution (frames whose CPU frame > 50 ms; per window, summed over runs)\n")
    print("| window | map | frames >50 ms | >100 ms | of which a new program / texture / geometry appeared | pre-window frame cpu ms | worst 3 (cpu ms, render-submit ms, dProg/dTex/dGeo) |")
    print("|---|---|---|---|---|---|---|")
    for wname in ("menu", "drop", "ground", "endgame_realframes", "again_drop"):
        for m in maps:
            W = [(r.get("windows") or {}).get(wname) for r in runs if r["map"] == m]
            W = [w for w in W if w]
            if not W:
                continue
            o50 = sum(w.get("cpu_over50ms") or 0 for w in W)
            o100 = sum(w.get("cpu_over100ms") or 0 for w in W)
            wl = [x for w in W for x in (w.get("worst") or []) if x.get("cpu", 0) > 50]
            res = sum(1 for x in wl if (x.get("dProg") or 0) > 0 or (x.get("dTex") or 0) > 0 or (x.get("dGeo") or 0) > 0)
            pre = [((w.get("preFrame") or [None, None])[0] or 0) + ((w.get("preFrame") or [None, None])[1] or 0) for w in W if w.get("preFrame")]
            wl.sort(key=lambda x: -x["cpu"])
            print("| %s | %s | %d | %d | %d (of the <=8 worst listed per run) | %s | %s |" % (
                wname, m, o50, o100, res, agg(pre, 0),
                "; ".join("%s/%s (%s/%s/%s)" % (x["cpu"], x["rnd"], x.get("dProg"), x.get("dTex"), x.get("dGeo")) for x in wl[:3])))

    print("\n### Errors by stage (all runs)\n")
    tot = {}
    for r in runs:
        for st, d in (r.get("console") or {}).items():
            t = tot.setdefault(st, {"error": 0, "warning": 0, "samples": []})
            t["error"] += d["error"]
            t["warning"] += d["warning"]
            for s in d["samples"]:
                if s not in t["samples"] and len(t["samples"]) < 8:
                    t["samples"].append(s)
    for st, t in tot.items():
        print("- %s: %d console errors, %d warnings" % (st, t["error"], t["warning"]))
        for s in t["samples"]:
            print("    - `%s`" % s.replace("`", "'")[:400])
    pe = [(r["map"], r["rep"], x) for r in runs for x in (r.get("pageerrors") or [])]
    print("- pageerrors: %d" % len(pe))
    for m, rep, (st, txt) in pe[:12]:
        print("    - %s r%s [%s] `%s`" % (m, rep, st, txt.replace("`", "'")[:500]))
    we = [(r["map"], r["rep"], x) for r in runs for x in (r.get("window_errors") or []) if isinstance(x, dict)]
    print("- window error/unhandledrejection (init-script listener): %d" % len(we))
    for m, rep, x in we[:12]:
        print("    - %s r%s `%s`" % (m, rep, str(x.get("msg")).replace("`", "'")[:500]))
    rf = [(r["map"], r["rep"], x) for r in runs for x in (r.get("reqfail") or [])]
    print("- failed requests: %d" % len(rf))
    for m, rep, (st, txt) in rf[:10]:
        print("    - %s r%s [%s] %s" % (m, rep, st, txt))
    notes = [(r["map"], r["rep"], n) for r in runs for n in (r.get("notes") or [])]
    print("- probe notes: %d" % len(notes))
    for m, rep, n in notes:
        print("    - %s r%s: %s" % (m, rep, n))
    print("\n### Contamination\n")
    for r in runs:
        ac = r.get("automated_chromes_at_start") or []
        print("- %s r%s: other automated Chromes at start = %d; GL = %s; run wall %s s" % (
            r["map"], r["rep"], len([x for x in ac if isinstance(x, dict) and "pid" in x]),
            (r.get("gl") or {}).get("renderer"), r.get("run_wall_s")))


if __name__ == "__main__":
    main()
