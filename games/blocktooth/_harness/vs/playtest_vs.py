#!/usr/bin/env python
"""BLOCKTOOTH VS playtest (lane B-QA) — REAL keyboard input only: menu -> VS PRACTICE -> a full practice match.

    python _harness/vs/playtest_vs.py --base http://localhost:5197/ --no-serve --titan molo --biome grideast
    python _harness/vs/playtest_vs.py --seconds 700            # the whole 10:45 match in real time (default 700 s)

From the TITLE screen the script walks the real menus with arrow keys / Enter to the visible 'VS PRACTICE' entry (vsmenu.py),
answers the following screens, then plays with page.keyboard only: WASD held toward food / the ring centre / a beatable rival,
Space for the hook, Shift to dash (periodically and out of paint), 1/2/3 whenever the CARD RAIL offers cards (the sim never
pauses for a draft in VS), Esc if an auto-pause shows. `__BT__` / the live World are used for OBSERVATION only (never
__BT__.step, never cheats).

PASS needs every check:
  menus: 'VS PRACTICE' found and entered by keys · a VS world with 4 seats (3 bot seats) appeared
  the match clock ran COUNTDOWN -> OPEN HOUSE -> HOSTILE TAKEOVER -> FINAL NOTICE (-> LAST CALL) in that order
  the phase banners were VISIBLE on screen (OPEN HOUSE / HOSTILE TAKEOVER / FINAL NOTICE text in the page)
  moved > 20 m · ate floors/props · levelled up · a CARD RAIL pick made with a real 1/2/3 key (owned grew) · NO draft modal
  opened (screen 'draft' would freeze the shared sim) · Space -> hook effect · Shift -> dash effect
  the match ENDED by itself (result 'vs', a winner, places 1..4) before the time limit, and an end card was visible
  0 console / page / window errors, 0 shader diagnostics, 0 failed requests
Exit: 0 pass · 1 fail · 2 could not start · 3 NOT RUN (no 'VS PRACTICE' entry on screen: the VS UI has not landed).
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from common import (BIOMES, SHOTS, TITANS, HarnessError, Session, add_common_args, build_url, compact_state,  # noqa: E402
                    diag_problems, print_diagnostics, save_report, world_to_keys)
from playtest import HOOK_EVENTS, OBS_JS  # noqa: E402
from vsmenu import goto_vs_practice, page_text, vs_obs  # noqa: E402

PHASE_ORDER = ["countdown", "open", "takeover", "final", "last"]
BANNERS = {"open": "OPEN HOUSE", "takeover": "HOSTILE TAKEOVER", "final": "FINAL NOTICE", "last": "LAST CALL"}
FF_NEXT = {"open": 240.0, "takeover": 420.0, "final": 600.0, "last": 645.0}   # match-clock boundary each phase ends at (VS.phase)
END_CARD_WORDS = ("ZONING DISPUTE", "WINS", "PLACEMENT", "1ST", "FRONT PAGE", "EVICTED BY", "VS SCORE")


def play(sess, args, m, shots, shot_dir, log):
    """Play until the match ends or args.seconds pass. Returns a fatal string or None."""
    t_start = time.time()
    t_end = t_start + args.seconds
    next_shot = t_start + 1.0
    shot_n = 0
    last_space = last_shift = 0.0
    last_text = 0.0
    prev = None
    detour_until = 0.0
    detour = (0.0, 0.0)
    prog_t = time.time()
    prog_pos = None
    banned = []
    draft_i = 0
    space_check = shift_check = None
    no_state = 0
    ff_phase_t = time.time()
    while time.time() < t_end:
        t0 = time.time()
        now = t0
        banned = [b for b in banned if b[2] > now]
        obs = sess.safe_js(OBS_JS, {"banned": [[b[0], b[1]] for b in banned]})
        s = (obs or {}).get("s") if isinstance(obs, dict) else None
        vo = vs_obs(sess)
        if not isinstance(s, dict) or not vo.get("world"):
            no_state += 1
            if no_state > 80:
                return "state / World unavailable for 8 s during play"
            time.sleep(0.1)
            continue
        no_state = 0
        scr = s.get("screen")
        vs = vo.get("vs") or {}
        players = vo.get("players") or []
        me = players[vo.get("view") or 0] if players else {}
        ph = vs.get("phase")
        if ph and (not m["phases"] or m["phases"][-1][0] != ph):
            m["phases"].append((ph, round(vs.get("clock") or 0.0, 1)))
            log("phase -> %s at match clock %.1f s" % (ph, vs.get("clock") or 0.0))
            ff_phase_t = now
        if args.fast_forward and ph in FF_NEXT and now - ff_phase_t > args.ff_dwell and vs.get("startT") is not None and (vs.get("clock") or 0.0) < FF_NEXT[ph] - 1.5:
            # DEV-ONLY (labelled in the report): the shared GPU can run a 4-titan scene at < 1 fps and the sim is capped at 0.1 s per frame,
            # so a real-time 10:45 match is out of reach there. Jump the match clock to 1 s before the next phase boundary (cheat.time).
            tgt = vs["startT"] + FF_NEXT[ph] - 1.0
            ok_c, v_c = sess.cheat("time", tgt)
            m["fastForwards"].append((ph, round(vs.get("clock") or 0.0, 1), bool(ok_c)))
            log("FAST-FORWARD (dev cheat.time) from %s: match clock %.1f -> %.1f (%s)" % (ph, vs.get("clock") or 0.0, FF_NEXT[ph] - 1.0, "ok" if ok_c else v_c))
            ff_phase_t = now
        if now - last_text > 1.0:
            last_text = now
            txt = page_text(sess)
            for k, word in BANNERS.items():
                # a banner counts only while ITS phase is running (the words may also sit in static menu / legend text)
                if word in txt and k == ph and k not in m["bannersSeen"]:
                    m["bannersSeen"][k] = round(vs.get("clock") or 0.0, 1)
                    p = os.path.join(shot_dir, "banner_%s.png" % k)
                    if sess.screenshot(p):
                        shots.append(p)
            if any(w in txt for w in END_CARD_WORDS) and vo.get("result"):
                m["endCardText"] = True
        m["level"] = max(m["level"], int(me.get("level") or 1))
        m["rank"] = max(m["rank"], int(me.get("rank") or 0))
        x, z = me.get("x"), me.get("z")
        if isinstance(x, (int, float)) and isinstance(z, (int, float)):
            if prev is not None:
                step = math.hypot(x - prev[0], z - prev[1])
                if step < 200:
                    m["moved"] += step
            prev = (x, z)
        if m["floors0"] is None and isinstance(s.get("floorsEaten"), (int, float)):
            m["floors0"] = s.get("floorsEaten") or 0
            m["props0"] = s.get("propsEaten") or 0
        m["floors"] = max(m["floors"], (s.get("floorsEaten") or 0) - (m["floors0"] or 0))
        m["props"] = max(m["props"], (s.get("propsEaten") or 0) - (m["props0"] or 0))
        m["maxOwned"] = max(m["maxOwned"], int(me.get("owned") or 0))
        if me.get("evictions") is not None:
            m["evictions"] = max(m["evictions"], int(me.get("evictions") or 0))
        if me.get("ko") is not None:
            m["koSeen"] = max(m["koSeen"], int(me.get("ko") or 0))

        if now >= next_shot:
            p = os.path.join(shot_dir, "vs_%02d.png" % shot_n)
            if sess.screenshot(p):
                shots.append(p)
            shot_n += 1
            next_shot = now + 30.0

        # the match is over
        if vo.get("result"):
            sess.release_all()
            m["result"] = {"result": vo.get("result"), "winner": vs.get("winner"), "phase": ph, "clock": round(vs.get("clock") or 0.0, 1),
                           "places": [p.get("place") for p in players], "order": vs.get("order")}
            log("match over: %s" % json.dumps(m["result"]))
            return None
        if scr == "pause":
            sess.release_all()
            m["pauses"] += 1
            sess.press("Escape")
            time.sleep(0.5)
            continue
        if scr == "draft":
            # a modal draft owns the screen = the shared sim is frozen: that is the thing the CARD RAIL exists to avoid
            m["draftModal"] += 1
            sess.release_all()
            sess.press("Digit1")
            time.sleep(0.5)
            continue
        if scr in ("slate", "loading"):
            sess.release_all()
            sess.press("Enter")
            time.sleep(0.8)
            continue

        # CARD RAIL: pick with a real 1/2/3 key while the rail is open
        if me.get("railOpen") or me.get("offer"):
            key = ["Digit1", "Digit2", "Digit3"][draft_i % 3]
            before = int(me.get("owned") or 0)
            sess.press(key)
            m["railKeys"] += 1
            deadline = time.time() + 2.0
            grew = False
            while time.time() < deadline:
                v2 = vs_obs(sess)
                pl = (v2.get("players") or [{}])[v2.get("view") or 0]
                if int(pl.get("owned") or 0) > before:
                    grew = True
                    break
                time.sleep(0.1)
            if grew:
                m["railPicks"] += 1
                log("CARD RAIL: pressed %s -> owned %d -> grew (pick #%d)" % (key, before, m["railPicks"]))
            draft_i += 1

        T = obs.get("t") or {}
        tx, tz = T.get("x", x), T.get("z", z)
        H = T.get("height") or 1.2
        if space_check and now - space_check[0] > 0.3:
            if space_check[1] is not None and space_check[1] <= 0.05 and (T.get("abilityCd") or 0) > 0.3:
                m["hookConfirmedByCd"] += 1
            space_check = None
        if shift_check and now - shift_check[0] > 0.15:
            cb = shift_check[1]
            if cb is not None and ((T.get("dashCharges") is not None and T["dashCharges"] < cb) or (T.get("dashT") or 0) > 0):
                m["dashConfirmedByCharges"] += 1
            shift_check = None

        # steering priority: paint > the ring > a rival (chase a beatable one, flee when hurt) > food
        threat = obs.get("threat")
        dx = dz = 0.0
        ring = vs.get("ring")
        rivals = [p for p in players if p.get("slot") != me.get("slot") and p.get("alive") and not p.get("elim")]
        near = None
        if rivals and isinstance(tx, (int, float)):
            near = min(rivals, key=lambda p: math.hypot(p["x"] - tx, p["z"] - tz))
        hpf = (me.get("hp") or 0) / (me.get("maxHp") or 1)
        if threat:
            dx, dz = threat["dx"], threat["dz"]
        elif now < detour_until:
            dx, dz = detour
        elif ring and ph in ("final", "last") and isinstance(tx, (int, float)) and math.hypot(ring["cx"] - tx, ring["cz"] - tz) > max(5.0, ring["r"] - 2.0 * H):
            dx, dz = ring["cx"] - tx, ring["cz"] - tz
        elif near and ph in ("takeover", "final", "last") and isinstance(tx, (int, float)):
            rx, rz = near["x"] - tx, near["z"] - tz
            d = math.hypot(rx, rz) or 1.0
            if hpf < 0.3 or (near.get("rank", 0) > me.get("rank", 0) + 1 and hpf < 0.8):
                dx, dz = -rx / d, -rz / d                       # flee
            elif hpf > 0.55 and near.get("rank", 0) <= me.get("rank", 0) + 1:
                dx, dz = (rx / d, rz / d) if d > 0.8 * H else (0.0, 0.0)   # engage
            elif obs.get("food"):
                f = obs["food"]
                dx, dz = f["x"] - tx, f["z"] - tz
        elif obs.get("food") and isinstance(tx, (int, float)):
            f = obs["food"]
            dx, dz = f["x"] - tx, f["z"] - tz
        else:
            a = (now - t_start) * 0.35
            dx, dz = math.sin(a), math.cos(a)
        bd = obs.get("bounds")
        if bd and isinstance(tx, (int, float)):
            edge = max(4.0, 2 * H)
            if tx < bd["minX"] + edge:
                dx = abs(dx) + 0.5
            if tx > bd["maxX"] - edge:
                dx = -abs(dx) - 0.5
            if tz < bd["minZ"] + edge:
                dz = abs(dz) + 0.5
            if tz > bd["maxZ"] - edge:
                dz = -abs(dz) - 0.5
        keys = world_to_keys(dx, dz) or ({"KeyW"} if (dx or dz) else set())
        sess.hold(keys)

        if prog_pos is None:
            prog_pos, prog_t = (x, z), now
        elif now - prog_t >= 1.5:
            if isinstance(x, (int, float)) and prog_pos[0] is not None and keys:
                moved = math.hypot(x - prog_pos[0], z - prog_pos[1])
                if moved < max(1.0, 0.4 * H) and not threat and not (near and math.hypot(near["x"] - x, near["z"] - z) < 1.2 * H):
                    m["stuckDetours"] += 1
                    mag = math.hypot(dx, dz) or 1.0
                    sgn = 1 if m["stuckDetours"] % 2 else -1
                    detour = (-dz / mag * sgn, dx / mag * sgn)
                    detour_until = now + 1.0
                    f = obs.get("food")
                    if f:
                        banned.append((f["x"], f["z"], now + 12.0))
            prog_pos, prog_t = (x, z), now

        cd = T.get("abilityCd")
        if (cd is not None and cd <= 0 and now - last_space > 1.0) or (cd is None and now - last_space > 2.5):
            sess.press("Space")
            m["spacePresses"] += 1
            last_space = now
            space_check = (now, cd)
        charges = T.get("dashCharges")
        urgent = bool(threat) and threat.get("tLeft", 9) < 0.45
        if (urgent or now - last_shift > 5.0) and (charges is None or charges >= 1) and now - last_shift > 0.35:
            sess.press("Shift")
            m["shiftPresses"] += 1
            last_shift = now
            shift_check = (now, charges)
        dt = time.time() - t0
        if dt < 0.1:
            time.sleep(0.1 - dt)
    sess.release_all()
    return "time limit (%.0f s) reached before the match ended" % args.seconds


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH VS playtest with real keyboard input")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=700.0, help="real-time cap for the match (10:45 match clock = 645 s + countdown)")
    ap.add_argument("--fast-forward", action="store_true", help="DEV cheat.time jumps between phases (for a GPU too slow to play 10:45 in real time); marked in the report")
    ap.add_argument("--ff-dwell", type=float, default=12.0, help="real seconds to stay in a phase before jumping (banner time)")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()

    shot_dir = os.path.join(args.out_dir, "playtest_vs")
    url = build_url(args.base, dev=1, seed=args.seed, quality=args.quality)
    tag = "vs/%s/%s" % (args.titan, args.biome)
    log_lines = []

    def log(msg):
        line = "[%s] %s" % (tag, msg)
        log_lines.append(line)
        print(line, flush=True)

    m = {"phases": [], "bannersSeen": {}, "moved": 0.0, "level": 1, "rank": 0, "floors": 0, "props": 0, "floors0": None, "props0": 0,
         "maxOwned": 0, "railKeys": 0, "railPicks": 0, "draftModal": 0, "spacePresses": 0, "shiftPresses": 0, "hookConfirmedByCd": 0,
         "dashConfirmedByCharges": 0, "pauses": 0, "stuckDetours": 0, "fastForwards": [], "result": None, "endCardText": False, "evictions": 0, "koSeen": 0}
    rep = {"url": url, "titan": args.titan, "biome": args.biome, "seed": args.seed}
    sess = Session(args, "playtest_vs")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        log("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        return 2
    shots = []
    fatal = None
    not_run = None
    nav_ok = False
    seats0 = None
    ev = {}
    try:
        log("open %s" % url)
        try:
            sess.goto(url)
        except Exception as e:
            fatal = "navigation failed: %s" % str(e).splitlines()[0]
        if not fatal and not sess.wait_bt(60):
            fatal = "window.__BT__ never appeared"
        if not fatal:
            def snap_menu(name):
                p = os.path.join(shot_dir, "menu_%s.png" % name)
                if sess.screenshot(p):
                    shots.append(p)
            nav_ok, det = goto_vs_practice(sess, args.titan, args.biome, log=log, snap=snap_menu)
            rep["menus"] = det
            log("menus: %s %s" % ("OK" if nav_ok else "FAIL", json.dumps(det)[:700]))
            if not nav_ok:
                if det.get("notFound"):
                    not_run = det["error"]
                else:
                    fatal = det.get("error", "menu navigation failed")
        if not fatal and not not_run:
            sess.release_all()
            seats0 = vs_obs(sess)
            fatal = play(sess, args, m, shots, shot_dir, log)
            ev = sess.event_counts()
            # let the end card render, then look at it
            if m["result"]:
                time.sleep(2.0)
                txt = page_text(sess)
                m["endCardText"] = m["endCardText"] or any(w in txt for w in END_CARD_WORDS)
                p = os.path.join(shot_dir, "end_card.png")
                if sess.screenshot(p):
                    shots.append(p)
            rep["finalState"] = compact_state(sess.state())
    except Exception as e:
        fatal = "harness exception: %s" % str(e).splitlines()[0][:300]
        log(fatal)
        try:
            ev = sess.event_counts()
        except Exception:
            ev = {}
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    if not_run and not fatal:
        print("=" * 78)
        print("VS PLAYTEST: NOT RUN - %s" % not_run)
        rep.update({"notRun": not_run, "menus": rep.get("menus")})
        print("report  : %s" % save_report("playtest_vs", rep, args.base, args.report_dir))
        return 3

    hook_ev = max(int(ev.get("ability", 0)), sum(int(ev.get(k, 0)) for k in HOOK_EVENTS if k != "ability"))
    dash_ev = int(ev.get("dash", 0))
    seq = [p for p, _ in m["phases"]]
    ordered = all(PHASE_ORDER.index(a) < PHASE_ORDER.index(b) for a, b in zip(seq, seq[1:]) if a in PHASE_ORDER and b in PHASE_ORDER)
    res = m["result"] or {}
    places = res.get("places") or []
    checks = [
        ("VS PRACTICE entered by real keys; a VS world appeared", nav_ok),
        ("4 seats, 3 of them bots (%s)" % json.dumps([(p["slot"], p["titan"], p["bot"]) for p in (seats0 or {}).get("players", [])]),
         len((seats0 or {}).get("players", [])) == 4 and sum(1 for p in (seats0 or {}).get("players", []) if p.get("bot")) == 3),
        ("phase order COUNTDOWN->OPEN->TAKEOVER->FINAL observed (%s)" % " -> ".join("%s@%s" % x for x in m["phases"]),
         ordered and all(p in seq for p in ("open", "takeover", "final"))),
        ("banners visible on screen: %s" % json.dumps(m["bannersSeen"]), all(k in m["bannersSeen"] for k in ("open", "takeover", "final"))),
        ("moved > 20 m (%.1f m)" % m["moved"], m["moved"] > 20),
        ("ate floors/props (floors %d, props %d)" % (m["floors"], m["props"]), m["floors"] + m["props"] >= 3),
        ("levelled up (LV %d)" % m["level"], m["level"] >= 2),
        ("CARD RAIL pick with a real 1/2/3 key, owned grew (%d picks / %d key presses)" % (m["railPicks"], m["railKeys"]), m["railPicks"] >= 1),
        ("no modal draft screen opened (%d)" % m["draftModal"], m["draftModal"] == 0),
        ("Space -> hook effect (%d hook events, %d cd-confirmed)" % (hook_ev, m["hookConfirmedByCd"]), hook_ev >= 1 or m["hookConfirmedByCd"] >= 1),
        ("Shift -> dash effect (%d dash events, %d charge-confirmed)" % (dash_ev, m["dashConfirmedByCharges"]), dash_ev >= 1 or m["dashConfirmedByCharges"] >= 1),
        ("the match ENDED by itself (result %s, winner %s, places %s)" % (res.get("result"), res.get("winner"), places),
         res.get("result") == "vs" and isinstance(res.get("winner"), int) and res.get("winner") >= 0 and sorted(p for p in places if p) == [1, 2, 3, 4]),
        ("an end card was visible", bool(m["endCardText"])),
        ("0 console/page/window errors, 0 shader diagnostics, 0 failed requests", not diag_problems(diag)),
    ]
    if fatal:
        checks.insert(0, ("no fatal harness stop (%s)" % fatal, False))
    passed = all(ok for _, ok in checks)
    print("=" * 78)
    print("VS PLAYTEST %s  seed %s  (%s)%s" % (tag, args.seed, "headless" if args.headless else "headed", "  [FAST-FORWARD: dev cheat.time between phases, NOT a real-time match]" if args.fast_forward else ""))
    print("observed: moved %.1f m - floors %d - props %d - LV %d - Size idx %d - owned %d - evictions %d - KOs %d - pauses %d - detours %d" % (
        m["moved"], m["floors"], m["props"], m["level"], m["rank"], m["maxOwned"], m["evictions"], m["koSeen"], m["pauses"], m["stuckDetours"]))
    print("events  : %s" % json.dumps({k: ev[k] for k in sorted(ev)})[:900])
    print_diagnostics(diag, limit=15)
    for name, ok in checks:
        print("  [%s] %s" % ("PASS" if ok else "FAIL", name))
    print("RESULT %s: %s" % (tag, "PASS" if passed else "FAIL"))
    rep.update({"fastForward": bool(args.fast_forward), "pass": passed, "fatal": fatal, "metrics": m, "events": ev, "checks": [[n, ok] for n, ok in checks], "shots": shots, "diagnostics": diag, "log": log_lines})
    print("report  : %s" % save_report("playtest_vs", rep, args.base, args.report_dir))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
