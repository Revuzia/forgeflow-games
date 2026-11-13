#!/usr/bin/env python
"""
W7 lane verification — live TDM kill-pace probe (the gate-2 target).

Starts a real SKIRMISH match on the deployed page via __test.startMatch,
steps it synchronously with __test.stepFrames, and reports kills-per-minute
across the whole match plus the longest kill-free gap while live. The gate-2
playtest saw kills flow ~90 s then nearly stop for ~3 minutes; the commander
(core/ai/objective.js) is the fix, and this probe is its observed effect.

Afterwards it re-runs the campaign smoke (startMission) — owner amendment A1:
breaking the campaign is a regression, not an acceptable cost.

    python w7_pace.py [--seed 5] [--max-min 10]
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--max-min", type=float, default=10.0, help="sim-minutes cap")
    args = ap.parse_args()
    ensure_server()

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.goto(URL, wait_until="load", timeout=60_000)
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"):
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            print("BOOT TIMEOUT", file=sys.stderr)
            return 2

        # FIRE-AND-FORGET: startMatch is async; awaiting its promise in
        # evaluate() is an UNBOUNDED hang if any internal await wedges
        # (observed 2026-08-25: probe hung >25 min). The bounded matchState
        # poll below is the real readiness signal.
        pg.evaluate(f"void __FPS__.__test.startMatch({{mode:'tdm', seed:{args.seed}}}); 1")
        okStart = True
        for _ in range(240):
            ms = pg.evaluate("__FPS__.__test.matchState()")
            if ms:
                break
            time.sleep(0.5)
        ms = pg.evaluate("__FPS__.__test.matchState()")
        if not ms:
            print(f"startMatch failed (returned {okStart}); errors={errors}", file=sys.stderr)
            return 2
        print(f"match started: mode={ms['modeId']} phase={ms['phase']} seed={args.seed}")

        kills_t = []   # (sim_elapsed, total_kills)
        cmd_seen = set()
        last_kills = 0
        step_frames = 600  # 10 sim-seconds per chunk
        max_chunks = int(args.max_min * 6) + 3
        for i in range(max_chunks):
            pg.evaluate(f"__FPS__.__test.step({step_frames})")
            snap = pg.evaluate(
                "(() => { const M = __FPS__.sim.state.match; if (!M) return null;"
                " let k = 0; for (const a of M.actors) k += a.kills;"
                " const roles = {};"
                " for (const b of __FPS__.sim.state.bots) if (b._obj) roles[b._obj.role] = (roles[b._obj.role]||0)+1;"
                " return { phase: M.phase, elapsed: M.elapsed, kills: k,"
                "  score: M.teams.map(t=>t.score), roles }; })()")
            if not snap:
                print("match state vanished", file=sys.stderr)
                return 2
            kills_t.append((snap["elapsed"], snap["kills"]))
            for r in snap["roles"]:
                cmd_seen.add(r)
            if snap["kills"] != last_kills or i % 6 == 0:
                print(f"  t={snap['elapsed']:6.1f}s phase={snap['phase']:9s} kills={snap['kills']:3d} "
                      f"score={snap['score']} roles={snap['roles']}")
            last_kills = snap["kills"]
            if snap["phase"] == "ended":
                break

        final = pg.evaluate(
            "(() => { const M = __FPS__.sim.state.match;"
            " return { phase: M.phase, elapsed: M.elapsed, result: M.result,"
            "  score: M.teams.map(t=>t.score) }; })()")
        print(f"\nfinal: phase={final['phase']} elapsed={final['elapsed']:.1f}s "
              f"score={final['score']} result={json.dumps(final['result'])}")

        # ---- kills-per-minute buckets + the longest kill-free gap
        total_s = kills_t[-1][0]
        per_min = {}
        prev_e, prev_k = 0.0, 0
        gaps = []
        gap_start_k = 0
        # reconstruct per-sample deltas
        for (e, k) in kills_t:
            b = int(e // 60)
            per_min[b] = per_min.get(b, 0) + (k - prev_k)
            prev_e, prev_k = e, k
        # longest kill-free stretch (sample resolution 10 s)
        longest, cur = 0.0, 0.0
        pk = 0
        pe = 0.0
        for (e, k) in kills_t:
            if k > pk:
                cur = 0.0
            else:
                cur += e - pe
            longest = max(longest, cur)
            pk, pe = k, e
        kpm = [(b, per_min[b]) for b in sorted(per_min)]
        print("\nKILLS PER MINUTE:", " ".join(f"m{b}:{n}" for b, n in kpm))
        total_kpm = (kills_t[-1][1] / total_s * 60) if total_s > 0 else 0
        print(f"total kills {kills_t[-1][1]} over {total_s:.0f} s → {total_kpm:.1f} kills/min")
        print(f"longest kill-free stretch while running: {longest:.0f} s (10 s sampling)")
        print(f"commander roles observed: {sorted(cmd_seen)}")
        print(f"page errors: {errors if errors else 'none'}")

        # ---- A1: the campaign must still start after a match
        # fire-and-forget for the same unbounded-await reason as startMatch
        pg.evaluate("void __FPS__.__test.startMission({}); 1")
        # C29b maps match phases onto the same enum (warmup→infil), so phase
        # alone could false-pass if startMission wrongly started a match.
        # Campaign = campaign phase AND no sim.state.match block.
        camp_ok = False
        for _ in range(60):
            cs = pg.evaluate(
                "(() => ({ phase: __FPS__.sim.state.phase, hasMatch: !!__FPS__.sim.state.match }))()")
            if cs["phase"] in ("infil", "assault", "exfil") and not cs["hasMatch"]:
                camp_ok = True
                break
            time.sleep(0.5)
        print(f"campaign post-match smoke: phase={cs['phase']} hasMatch={cs['hasMatch']} → {'OK' if camp_ok else 'FAIL'}")
        br.close()

        ended = final["phase"] == "ended"
        bad = (not ended and total_s >= args.max_min * 60 - 1) or longest > 60 or not camp_ok or bool(errors)
        print(f"\nRESULT: {'OK' if not bad else 'FAIL'}")
        return 0 if not bad else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
