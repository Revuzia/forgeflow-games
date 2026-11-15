#!/usr/bin/env python
"""HIT PARADE perf check (gate G9, CONTRACT section 13) - lane VIEW. Adapted from dyefield _harness/perfcheck.py.

    python _harness/perfcheck.py --headless                 # the VIEW lab, super cinematic loop, 1600x900
    python _harness/perfcheck.py --headless --scene ko      # another scripted window
    python _harness/perfcheck.py --headless --gate-p99 33   # G9: p99 frame <= 33 ms in a super cinematic
    python _harness/perfcheck.py --headless --query crowd=0 --label nocrowd   # A/B knobs: crowd=0 outline=0 post=0 bloom=1
    python _harness/perfcheck.py --stages rust_theater,butcher_block,wheel_of_pain,rooftop,control_room --gate-p99 33
                                                            # P2: the super cinematic on every set, one page, p50 / p99 per stage
    python _harness/perfcheck.py --stages ... --circle 60   # CHANGED(VIEW3D): the pair circles 60 f first (fight line ~40 deg off
                                                            #   the spawn axis): the super on a diagonal of the 3D ring

Refuses to run (exit 3, says why) while another automated Chrome is alive (a chrome.exe browser process with
--remote-debugging-pipe or --enable-automation and no --type=): a second automated Chrome shares the GPU and the numbers
would be contaminated. --wait-clear N polls up to N seconds first; --force-beside-others measures anyway, labels the
result CONTAMINATED and exits 4.

Flow (default, P2 --lab sim): load /lab/view.html?sim=1 at 1600x900 - the REAL sim + REAL data drive BoutView - set up
`--p1` vs `--p2` (johnny vs bruno), record the Lv3 script (walk in, PRIME TIME), then __LAB__.perf(S, from, to) replays
the super freeze + the whole cinematic in real time (one sim step + one view frame per rAF, looped) and records EVERY
requestAnimationFrame delta page-side and the renderer counters. `--lab scripted` = the P1 scripted-snapshot lab scene.
`--ab N`: the machine is shared - N interleaved windows of the cinematic (A) and of the same bout standing idle (B) in one
page, so contamination hits both alike; prints both distributions and the A/B p99 ratio (a RELATIVE number, labelled).
With ?prof=1 (always on here) the blocktooth FrameProf adds CPU sections and GPU timer-query times per frame.
Prints frames, avg fps, frame-time p50 / p90 / p99 / max, draw calls, triangles, programs, GPU string, the load split
and the machine load at the time (CPU %, other GPU users) so a contaminated number is visible as such.
Exit: 0 measured (and --gate-p99 met) | 1 gate missed | 2 setup failed | 3 refused | 4 contaminated.
"""
import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lookshots import FLAGS, PORT, REPORTS, ensure_server, stop_server  # noqa: E402

_PS_SCAN = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; "
            "ppid = $_.ParentProcessId; cmd = [string]$_.CommandLine } } | ConvertTo-Json -Compress")


def automated_chromes(exclude=()):
    """other automated Chrome BROWSER processes (dyefield common.py rule)"""
    if os.name != "nt":
        return [], None
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_SCAN],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        txt = (r.stdout or "").strip()
        rows = json.loads(txt) if txt else []
        if isinstance(rows, dict):
            rows = [rows]
    except Exception as e:
        return [], "process scan failed: %s" % str(e).splitlines()[0][:200]
    out = []
    for p in rows:
        cmd = p.get("cmd") or ""
        if "--type=" in cmd or ("--remote-debugging-pipe" not in cmd and "--enable-automation" not in cmd):
            continue
        if p.get("pid") in exclude:
            continue
        out.append({"pid": p.get("pid"), "headless": "--headless" in cmd})
    return out, None


def machine_load():
    """CPU % and the top 3D-engine users right now (informational: the dev box is shared)"""
    if os.name != "nt":
        return {}
    ps = ("$c=(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples.CookedValue; "
          "$g=@(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue | "
          "Select-Object -ExpandProperty CounterSamples | Where-Object {$_.CookedValue -gt 2} | ForEach-Object { "
          "$p=($_.InstanceName -split '_')[1]; $n=(Get-Process -Id $p -ErrorAction SilentlyContinue).Name; "
          "'{0}:{1}:{2:N0}' -f $n,$p,$_.CookedValue }); @{cpu=[math]::Round($c,1); gpu=$g} | ConvertTo-Json -Compress")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
        return json.loads((r.stdout or "{}").strip() or "{}")
    except Exception as e:
        return {"error": str(e)[:200]}


def attrib(pf, n=8):
    """CHANGED(fix_view) G9: the FrameProf dump boiled down for attribution - the worst frames by rAF gap (their CPU
    sections wrap / sim / view / render, GPU timer ms, renderer deltas: programs linked, textures / geometries created,
    JS heap delta KB, note = cinematic frame + 'wrap'), the longest Long-Animation-Frame entries with their scripts, and
    how many frames in the window changed the program / texture / geometry counts at all"""
    if not pf:
        return None
    worst = []
    for f in (pf.get("worst") or [])[:n]:
        worst.append({k: f.get(k) for k in ("raw", "cpu", "gpu", "sec", "dProg", "dTex", "dGeo", "dHeap", "note", "screen")})
    loaf = sorted(pf.get("loaf") or [], key=lambda e: -e.get("dur", 0))[:6]
    series = pf.get("series") or []
    return {"gpuP": pf.get("gpuP"), "cpuP": pf.get("cpuP"), "rawP": pf.get("rawP"), "mean": pf.get("mean"), "max": pf.get("max"),
            "worst": worst, "loaf": loaf, "frames": pf.get("frames"),
            "framesWithDeltas": sum(1 for w in (pf.get("worst") or []) if (w.get("dProg") or w.get("dTex") or w.get("dGeo"))),
            "seriesN": len(series)}


def attrib_line(a):
    if not a:
        return "-"
    parts = []
    for w in a["worst"][:5]:
        sec = w.get("sec") or {}
        parts.append("%.0fms(cpu %.1f gpu %s %s%s%s)" % (w.get("raw") or 0, w.get("cpu") or 0, w.get("gpu"),
                     " ".join("%s %.1f" % (k, v) for k, v in sec.items() if v >= 0.5),
                     (" dProg %d dTex %d dGeo %d" % (w.get("dProg") or 0, w.get("dTex") or 0, w.get("dGeo") or 0)) if (w.get("dProg") or w.get("dTex") or w.get("dGeo")) else "",
                     (" heap %+dKB" % w["dHeap"]) if abs(w.get("dHeap") or 0) > 512 else "") + " [" + (w.get("note") or "") + "]")
    return "; ".join(parts)


def main():
    ap = argparse.ArgumentParser(description="HIT PARADE perf check (G9) through the VIEW lab")
    ap.add_argument("--base", default="http://localhost:%d/" % PORT)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--no-serve", action="store_true")
    ap.add_argument("--scene", default="super")
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--query", action="append", default=[], metavar="K=V")
    ap.add_argument("--label", default="")
    ap.add_argument("--gate-p99", type=float, default=None)
    ap.add_argument("--wait-clear", type=float, default=0.0)
    ap.add_argument("--force-beside-others", action="store_true")
    ap.add_argument("--wait", type=float, default=900.0, help="seconds to wait for the lab to be ready")
    ap.add_argument("--uncapped", action="store_true", help="--disable-gpu-vsync --disable-frame-rate-limit")
    ap.add_argument("--lab", default="sim", choices=["sim", "scripted"], help="sim = real sim + data (P2 default)")
    ap.add_argument("--p1", default="johnny")
    ap.add_argument("--p2", default="bruno")
    ap.add_argument("--ab", type=int, default=0, help="interleave N A/B windows (cinematic vs idle) of --seconds each")
    ap.add_argument("--circle", type=int, default=0, help="CHANGED(VIEW3D) --lab sim: frames of STEP_IN before the walk-in (diagonal line)")
    ap.add_argument("--stages", default="", help="--lab sim: comma list of stage ids measured one after another in the same page "
                    "(the super cinematic on each set; per-stage p50 / p99 table; the gate applies to the worst p99)")
    ap.add_argument("--chrome-arg", action="append", default=[], help="CHANGED(fix_view) extra Chrome flag (repeatable), e.g. "
                    "--chrome-arg=--force_high_performance_gpu (the dGPU when other sessions saturate the iGPU; say so in the report)")
    args = ap.parse_args()
    name = "perfcheck_%s" % (args.label or (args.scene + ("_headless" if args.headless else "_headed")))
    extra = FLAGS + (["--disable-gpu-vsync", "--disable-frame-rate-limit"] if args.uncapped else []) + list(args.chrome_arg)

    t0 = time.time()
    found, err = automated_chromes()
    while found and not err and time.time() - t0 < args.wait_clear:
        time.sleep(5.0)
        found, err = automated_chromes()
    print("pre-flight   : other automated Chrome processes: %s" % (err or (len(found) if found else "none")))
    if err:
        print("REFUSED: %s - not measuring blind" % err)
        print("RESULT: REFUSED")
        return 3
    if found and not args.force_beside_others:
        print("REFUSED: %d other automated Chrome(s) alive (pids %s); their GPU work contaminates frame times. "
              "Re-run when they exit (--wait-clear 600) or --force-beside-others for a labelled A/B." % (
                  len(found), ", ".join(str(c["pid"]) for c in found)))
        print("RESULT: REFUSED")
        return 3
    try:
        server = ensure_server(args.base, not args.no_serve)
    except Exception as e:
        print("SETUP FAILED: %s" % e)
        print("RESULT: FAIL")
        return 2
    rep = {"scene": args.scene, "seconds": args.seconds, "size": [args.width, args.height], "query": args.query,
           "headless": args.headless, "uncapped": args.uncapped, "forced": bool(found), "othersAtStart": found}
    fatal = None
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    try:
        b = pw.chromium.launch(channel="chrome", headless=args.headless, args=extra)
        pg = b.new_context(viewport={"width": args.width, "height": args.height}, device_scale_factor=1).new_page()
        pg.set_default_timeout(int(args.wait * 1000))
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        q = "&".join((["sim=1", "p1=" + args.p1, "p2=" + args.p2] if args.lab == "sim" else ["scene=idle", "frame=1"]) + ["prof=1", "hud=0"] + args.query)
        t1 = time.time()
        pg.goto(args.base.rstrip("/") + "/lab/view.html?" + q)
        while time.time() - t1 < args.wait:
            st = pg.evaluate("() => window.__LAB__ ? {r: window.__LAB__.ready, e: window.__LAB__.error} : null")
            if st and st.get("e"):
                raise RuntimeError("lab error: " + st["e"][:600])
            if st and st.get("r"):
                break
            time.sleep(0.5)
        rep["readyS"] = round(time.time() - t1, 1)
        rep["lab"] = pg.evaluate("() => window.__LAB__.info()")
        rep["loadBefore"] = machine_load()
        if args.lab == "sim" and args.stages:
            per = {}
            for sid in [x for x in args.stages.split(",") if x]:
                su = pg.evaluate("([a, b, s]) => window.__LAB__.setup(a, b, {stage: s})", [args.p1, args.p2, sid])
                sc = pg.evaluate("(o) => window.__LAB__.prime(o)", {"circle": args.circle})
                c0 = sc.get("cineAt", -1) if sc.get("cineAt", -1) >= 0 else sc.get("lockAt", -1)
                if c0 is None or c0 < 0:
                    raise RuntimeError("no PRIME TIME cinematic started on %s: %s" % (sid, json.dumps(sc)))
                a0, a1 = max(0, sc.get("pressAt", c0) - 4), (sc.get("endAt", c0 + 180) or c0 + 180)
                wins = []
                atts = []
                for k in range(max(1, args.ab)):
                    ra = pg.evaluate("([n, a, b]) => window.__LAB__.perf(n, a, b)", [args.seconds, a0, a1])
                    rb = pg.evaluate("([n, a, b]) => window.__LAB__.perf(n, a, b)", [args.seconds, 30, max(31, a0 - 10)]) if args.ab > 0 else None
                    # CHANGED(fix_view) G9: keep each window's attribution (the full dumps are too big for the report)
                    atts.append({"A": attrib(ra.pop("prof", None)), "B": attrib(rb.pop("prof", None)) if rb else None,
                                 "Awraps": ra.get("wraps"), "Bwraps": rb.get("wraps") if rb else None})
                    print("   %s window %d: A p50 %.1f p99 %.1f max %.1f (%d fr, %s wraps left out)%s" % (sid, k, ra["p50"], ra["p99"], ra["max"], ra["frames"], ra.get("wraps"),
                          (" | B idle p50 %.1f p99 %.1f max %.1f" % (rb["p50"], rb["p99"], rb["max"])) if rb else ""), flush=True)
                    print("      A worst: %s" % attrib_line(atts[-1]["A"]), flush=True)
                    if rb:
                        print("      B worst: %s" % attrib_line(atts[-1]["B"]), flush=True)
                    wins.append((ra, rb))
                med = lambda xs: sorted(xs)[len(xs) // 2]
                r_ = dict(wins[-1][0])
                pf = (atts[-1]["A"] or {})
                for key in ("p50", "p90", "p99", "max", "avgFps"):
                    r_[key] = med([w[0][key] for w in wins])
                r_["window"] = [a0, a1]
                r_["lineDegAtCine"] = sc.get("lineDegAtCine")
                r_["stageFallback"] = su.get("stageFallback")
                r_["prof"] = {k: pf.get(k) for k in ("gpuP", "cpuP", "mean")}
                r_["attribution"] = atts
                if args.ab > 0:
                    r_["ab"] = [{"A": {k: w[0][k] for k in ("p50", "p99", "frames")}, "B": {k: w[1][k] for k in ("p50", "p99", "frames")}} for w in wins]
                    r_["idleP50"] = med([w[1]["p50"] for w in wins]); r_["idleP99"] = med([w[1]["p99"] for w in wins])
                    r_["ratioP99"] = round(r_["p99"] / max(0.01, r_["idleP99"]), 3)
                per[sid] = r_
                print("stage %-14s line %5s deg | frames %4d avg %5.1f fps | p50 %6.2f p90 %6.2f p99 %6.2f max %6.2f ms | calls %s tris %s | gpu p %s%s" % (
                    sid, r_.get("lineDegAtCine"), r_["frames"], r_["avgFps"], r_["p50"], r_["p90"], r_["p99"], r_["max"], r_.get("calls"), r_.get("triangles"),
                    json.dumps(r_["prof"].get("gpuP")),
                    (" | idle p50 %.2f p99 %.2f -> A/B p99 ratio %.3f (median of %d interleaved)" % (r_["idleP50"], r_["idleP99"], r_["ratioP99"], len(wins))) if args.ab > 0 else ""), flush=True)
            rep["stages"] = per
            worst = max(per, key=lambda k: per[k]["p99"])
            res = dict(per[worst])
            res.pop("prof", None)
            res["scene"] = "prime %s vs %s, worst stage %s" % (args.p1, args.p2, worst)
            res["seconds"] = args.seconds
        elif args.lab == "sim":
            sc = pg.evaluate("(o) => window.__LAB__.prime(o)", {"circle": args.circle})
            rep["script"] = sc
            c0 = sc.get("cineAt", -1) if sc.get("cineAt", -1) >= 0 else sc.get("lockAt", -1)
            if c0 is None or c0 < 0:
                raise RuntimeError("no PRIME TIME cinematic started: %s" % json.dumps(sc))
            a0, a1 = max(0, sc.get("pressAt", c0) - 4), (sc.get("endAt", c0 + 180) or c0 + 180)
            rep["window"] = [a0, a1]
            if args.ab > 0:
                wins = []
                for k in range(args.ab):
                    ra = pg.evaluate("([n, a, b]) => window.__LAB__.perf(n, a, b)", [args.seconds, a0, a1])
                    rb = pg.evaluate("([n, a, b]) => window.__LAB__.perf(n, a, b)", [args.seconds, 30, max(31, a0 - 10)])
                    for r_ in (ra, rb):
                        r_.pop("prof", None)
                    wins.append({"A": ra, "B": rb})
                    print("ab %d  A cinematic p50 %.2f p99 %.2f (%d fr) | B idle p50 %.2f p99 %.2f (%d fr)" % (
                        k, ra["p50"], ra["p99"], ra["frames"], rb["p50"], rb["p99"], rb["frames"]), flush=True)
                rep["ab"] = wins
                res = dict(wins[-1]["A"])
                ap99 = sorted(w["A"]["p99"] for w in wins)[len(wins) // 2]
                bp99 = sorted(w["B"]["p99"] for w in wins)[len(wins) // 2]
                rep["abSummary"] = {"medianA_p99": ap99, "medianB_p99": bp99, "ratio": round(ap99 / max(0.01, bp99), 3)}
            else:
                res = pg.evaluate("([n, a, b]) => window.__LAB__.perf(n, a, b)", [args.seconds, a0, a1])
            res["scene"] = "prime %s vs %s" % (args.p1, args.p2)
            res["seconds"] = args.seconds
        else:
            res = pg.evaluate("([s, n]) => window.__LAB__.perf(n, s)", [args.scene, args.seconds])
        rep["loadAfter"] = machine_load()
        prof = res.pop("prof", None) or {}
        rep["perf"] = res
        rep["prof"] = {k: prof.get(k) for k in ("gpuSupported", "frames", "gpuMean", "gpuP", "rawP", "cpuP", "mean", "max")}
        rep["pageErrors"] = errors[:20]
        b.close()
    except Exception as e:
        fatal = str(e).splitlines()[0][:600]
    finally:
        pw.stop()
        stop_server(server)
    intruders, _ = automated_chromes()
    rep["othersAtEnd"] = intruders
    os.makedirs(REPORTS, exist_ok=True)
    out = os.path.join(REPORTS, name + ".json")
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=2, default=str)
    print("=" * 96)
    if fatal:
        print("report       : %s" % out)
        print("RESULT: FAIL - %s" % fatal)
        return 2
    p, lab = rep["perf"], rep.get("lab") or {}
    r = lab.get("render") or {}
    print("mode         : %s Chrome d3d11 %dx%d%s | query %s" % ("headless" if args.headless else "headed", args.width, args.height,
                                                               " uncapped" if args.uncapped else "", " ".join(args.query) or "-"))
    print("renderer     : %s" % p.get("gpu"))
    print("lab load     : ready %.1f s | BoutView.create %s ms | warm-up %s ms %s | load %s" % (
        rep["readyS"], lab.get("createMs"), lab.get("warmMs"), json.dumps(lab.get("warmSplit")), json.dumps(lab.get("loadSplit"))))
    print("window       : %s, %d frames / %.1f s | avg %.1f fps | frame ms p50 %.2f p90 %.2f p99 %.2f max %.2f" % (
        p.get("scene"), p.get("frames", 0), p.get("seconds", 0), p.get("avgFps", 0), p.get("p50", 0), p.get("p90", 0),
        p.get("p99", 0), p.get("max", 0)))
    print("draws        : calls %s | triangles %s | programs %s | buffer %s scale %s" % (
        p.get("calls"), p.get("triangles"), p.get("programs"), p.get("buffer"), p.get("scale")))
    pr = rep.get("prof") or {}
    print("frameprof    : gpu timer %s | gpu p %s | cpu p %s | section means %s" % (
        pr.get("gpuSupported"), json.dumps(pr.get("gpuP")), json.dumps(pr.get("cpuP")), json.dumps(pr.get("mean"))))
    print("machine load : before %s | after %s" % (json.dumps(rep.get("loadBefore")), json.dumps(rep.get("loadAfter"))))
    if rep.get("pageErrors"):
        print("page errors  : %s" % " | ".join(rep["pageErrors"][:3]))
    print("report       : %s" % out)
    if rep.get("abSummary"):
        print("A/B (RELATIVE, contaminated box): median p99 cinematic %.2f ms vs idle %.2f ms -> ratio %.3f" % (
            rep["abSummary"]["medianA_p99"], rep["abSummary"]["medianB_p99"], rep["abSummary"]["ratio"]))
    if args.gate_p99 is not None and (p.get("p99") or 1e9) > args.gate_p99:
        print("RESULT: FAIL - frame-time p99 %.2f ms > %.1f ms" % (p.get("p99") or 0, args.gate_p99))
        return 1
    if found or intruders:
        print("RESULT: CONTAMINATED - another automated Chrome was alive while measuring")
        return 4
    print("RESULT: MEASURED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
