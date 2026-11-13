#!/usr/bin/env python
"""BLOCKTOOTH playtest — CONTRACT §15 gate 4. REAL keyboard input only.

    python _harness/playtest.py --titan molo --biome grideast            # 120 s, headed Chrome
    python _harness/playtest.py --titan voltkite --biome lockwater --seconds 180
    python _harness/playtest.py --matrix        # 4 runs covering every titan AND every biome

From the TITLE screen: Enter → arrow keys to the requested titan card → Enter → arrow keys to the
biome card → Enter (DROP IN) → a key dismisses the open slate → a steering policy plays with
page.keyboard only (WASD held, Space for the hook on cooldown, Shift to dash periodically and out
of hostile paint, 1/2/3 when a draft is open, Esc if an auto-pause appears).

`__BT__` is used for OBSERVATION only: state() for screen/progress, `__BT__.world` (read-only) for the
titan pose, nearby flattenable food and hostile telegraphs, `__BT__.events(n)` (via the harness event
collector) for ability/dash evidence. Never __BT__.step, never cheats.

PASS (gate 4) needs every check: menus navigated by keys to the requested titan+biome · slate
dismissed by a key · moved > 20 m · ate props/floors (≥ --min-eaten) · levelled up · ≥ 1 draft
taken with 1/2/3 (owned count grew) · Space produced a hook effect · Shift produced a dash effect ·
0 console/page/window errors, 0 shader diagnostics, 0 failed requests.
v2 (FEATURES_V2 §11, lane L10) — cinematic-aware: when the opening is the WARD-7 STREET CAM cinematic
(`state().v2.cine` set on the slate screen; the default for a fresh profile) it is dismissed with a
REAL key like the slate, and the FIRST PLAY FRAME must pass the zebra check (bootcheck CROSSWALK_JS:
the titan stands inside a crosswalk, read from `__BT__.world`) — an extra gated check.
Exit: 0 pass · 1 fail · 2 could not start (server/browser/__BT__).
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIOMES, ROMAN, SHOTS, TITANS, HarnessError, Session, add_common_args, build_url,  # noqa: E402
                    compact_state, diag_problems, dismiss_slate, menus_to_slate, owned_total,
                    print_diagnostics, save_report, world_to_keys)
from bootcheck import CROSSWALK_JS  # noqa: E402  (v2: zebra check on the first play frame)

# Every matrix row: all 4 titans AND all 3 biomes are covered.
MATRIX = [("molo", "grideast"), ("voltkite", "whitestacks"), ("hearthback", "lockwater"), ("briarwick", "grideast")]
HOOK_EVENTS = ("ability", "wireDetonate", "vent", "spore")

# Observation (read-only): state + titan pose + best nearby flattenable food + hostile paint.
OBS_JS = r"""
(p) => {
  const B = window.__BT__; if (!B) return null;
  let s = null; try { s = B.state(); } catch (e) { return { err: String(e && e.stack || e) }; }
  const out = { s, world: false };
  const W = window.__H_W__ && window.__H_W__();
  if (!W || !W.titan || !W.city) return out;
  out.world = true;
  const T = W.titan, H = T.height, canF = T.rank;          // canFlatten tier == rank index (CONTRACT §3)
  out.t = { x: T.x, z: T.z, heading: T.heading, abilityCd: T.abilityCd, dashCharges: T.dashCharges,
            dashT: T.dashT, radius: T.radius, height: H, alive: T.alive, rank: T.rank };
  const banned = p.banned || [];
  const bw = Math.max(6, 2 * H);
  const isBanned = (x, z) => { for (const b of banned) if (Math.abs(b[0] - x) < bw && Math.abs(b[1] - z) < bw) return true; return false; };
  const R = Math.max(40, 12 * H + 30), D0 = Math.max(8, 3 * H);
  let best = null, bs = 0;
  const consider = (x, z, v, kind) => {
    const d = Math.hypot(x - T.x, z - T.z);
    if (d > R || d < 0.05 || isBanned(x, z)) return;
    const sc = v / (1 + d / D0);
    if (sc > bs) { bs = sc; best = { x, z, d, kind }; }
  };
  for (const b of W.city.buildings) if (!b.collapsed && b.alive > 0 && b.tier <= canF) consider(b.x, b.z, b.alive * (1 + 2 * b.tier), 'building');
  for (const q of W.city.props) if (q.alive && q.tier <= canF) consider(q.x, q.z, 1 + 3 * q.tier, 'prop');
  for (const q of (W.pickups || [])) if (q.alive) consider(q.x, q.z, 1.5, 'pickup');
  out.food = best;
  const inside = (s, x, z, r) => {
    switch (s.k) {
      case 'circle': return Math.hypot(x - s.x, z - s.z) <= s.r + r;
      case 'ring': { const d = Math.hypot(x - s.x, z - s.z); return d + r >= s.r0 && d - r <= s.r1; }
      case 'cone': {
        const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
        if (d - r > s.r) return false; if (d <= r) return true;
        let a = Math.atan2(dx, dz) - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a));
        return Math.abs(a) <= s.half + Math.asin(Math.min(1, r / d));
      }
      case 'lane': {
        const fx = Math.sin(s.dir), fz = Math.cos(s.dir), dx = x - s.x, dz = z - s.z;
        const al = dx * fx + dz * fz, sd = dx * fz - dz * fx;
        return al >= -r && al <= s.len + r && Math.abs(sd) <= s.w / 2 + r;
      }
      case 'oval': {
        const fx = Math.sin(s.rot), fz = Math.cos(s.rot), dx = x - s.x, dz = z - s.z;
        const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx, ex = lx / (s.rx + r), ez = lz / (s.rz + r);
        return ex * ex + ez * ez <= 1;
      }
      case 'capsule': {
        const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz;
        let t = L2 > 1e-9 ? ((x - s.x0) * vx + (z - s.z0) * vz) / L2 : 0; t = Math.max(0, Math.min(1, t));
        return Math.hypot(x - (s.x0 + vx * t), z - (s.z0 + vz * t)) <= s.r + r;
      }
    }
    return false;
  };
  const esc = (s, x, z) => {
    if (s.k === 'lane') { const fx = Math.sin(s.dir), fz = Math.cos(s.dir); const sd = (x - s.x) * fz - (z - s.z) * fx; const g = sd >= 0 ? 1 : -1; return [fz * g, -fx * g]; }
    if (s.k === 'cone') { const th = Math.atan2(x - s.x, z - s.z); let a = th - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a)); const g = a >= 0 ? 1 : -1; return [Math.cos(th) * g, -Math.sin(th) * g]; }
    if (s.k === 'capsule') {
      const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz;
      let t = L2 > 1e-9 ? ((x - s.x0) * vx + (z - s.z0) * vz) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const dx = x - (s.x0 + vx * t), dz = z - (s.z0 + vz * t), d = Math.hypot(dx, dz);
      if (d > 1e-6) return [dx / d, dz / d];
      const m = Math.hypot(vx, vz) || 1; return [-vz / m, vx / m];
    }
    const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) return [1, 0];
    if (s.k === 'ring' && s.r0 > 0 && d - s.r0 < s.r1 - d) return [-dx / d, -dz / d];
    return [dx / d, dz / d];
  };
  let sx = 0, sz = 0, tMin = Infinity, n = 0;
  const rr = T.radius * 1.3 + 1;
  for (const tg of (W.telegraphs || [])) {
    if (!tg.alive || tg.owner === 'titan') continue;
    let tl;
    if (!tg.fired) tl = tg.windup - tg.t; else if (tg.active > 0 && tg.t < tg.windup + tg.active) tl = 0; else continue;
    if (tl > 3 || !inside(tg.shape, T.x, T.z, rr)) continue;
    const e = esc(tg.shape, T.x, T.z), wgt = 1 / (0.15 + Math.max(0, tl));
    sx += e[0] * wgt; sz += e[1] * wgt; n++; if (tl < tMin) tMin = tl;
  }
  if (n) { const m = Math.hypot(sx, sz) || 1; out.threat = { dx: sx / m, dz: sz / m, tLeft: tMin, n }; }
  if (W.boss && W.boss.alive) out.boss = { x: W.boss.x, z: W.boss.z, introT: W.boss.introT };
  out.bounds = W.city.bounds;
  return out;
}
"""


CAM_JS = "() => { const c = window.__BTCAM__; return c ? {d: c.distance, auto: c.autoDist, zoom: c.zoom, zt: c.zoomTarget} : null; }"


def zoom_check(sess, log):
    """Camera zoom with REAL input events (view-only; observed through the dev camera handle
    __BTCAM__, ?dev=1): 6 wheel notches out over the canvas → the actual camera distance grows vs the
    auto distance; '=' held 1.2 s → back in below 1×; Z → the zoom target returns to 1×.
    Returns (ok, detail) or (None, reason) when it cannot be observed (no dev handle)."""
    c0 = sess.safe_js(CAM_JS)
    if not c0:
        return None, "no __BTCAM__ (needs ?dev=1)"
    vp = sess.page.viewport_size or {"width": 1280, "height": 720}
    sess.page.mouse.move(vp["width"] / 2, vp["height"] / 2)
    for _ in range(6):
        sess.page.mouse.wheel(0, 120)
        time.sleep(0.05)
    time.sleep(0.8)
    c1 = sess.safe_js(CAM_JS) or {}
    sess.page.keyboard.down("Equal")
    time.sleep(1.2)
    sess.page.keyboard.up("Equal")
    time.sleep(0.6)
    c2 = sess.safe_js(CAM_JS) or {}
    sess.press("KeyZ")
    time.sleep(0.9)
    c3 = sess.safe_js(CAM_JS) or {}
    out_ok = c1.get("zoom", 1) > 1.3 and c1.get("d", 0) > 1.3 * c1.get("auto", 1e9)
    in_ok = c2.get("zoom", 9) < c1.get("zoom", 0) and c2.get("zt", 9) < 1.0
    reset_ok = abs(c3.get("zt", 0) - 1.0) < 1e-3 and abs(c3.get("zoom", 0) - 1.0) < 0.05
    detail = ("wheel out ×6: zoom %.2f (D %.1f / auto %.1f) · '=' held: zoom %.2f · Z: zoom %.3f target %.3f" % (
        c1.get("zoom", -1), c1.get("d", -1), c1.get("auto", -1), c2.get("zoom", -1), c3.get("zoom", -1), c3.get("zt", -1)))
    log("zoom check: %s → %s" % (detail, "OK" if (out_ok and in_ok and reset_ok) else "FAIL"))
    return (out_ok and in_ok and reset_ok), detail


def run_one(args, titan, biome, seed):
    tag = "%s/%s" % (titan, biome)
    shot_dir = os.path.join(args.out_dir, "playtest")
    url = build_url(args.base, dev=1 if not args.no_dev else None, seed=seed, quality=args.quality)
    log_lines = []

    def log(msg):
        line = "[%s] %s" % (tag, msg)
        log_lines.append(line)
        print(line, flush=True)

    rep = {"titan": titan, "biome": biome, "seed": seed, "url": url, "seconds": args.seconds}
    sess = Session(args, "playtest")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        log("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        rep.update({"pass": False, "fatal": "setup: %s" % e})
        return 2, rep

    shots = []
    m = {"moved": 0.0, "propsEaten0": None, "floorsEaten0": None, "props": 0, "floors": 0, "level": 1, "rank": 0,
         "draftsTaken": 0, "draftsFailed": 0, "spacePresses": 0, "shiftPresses": 0, "hookConfirmedByCd": 0,
         "dashConfirmedByCharges": 0, "hpLost": 0.0, "pauses": 0, "end": None, "stuckDetours": 0,
         "worldExposed": False, "maxEnemies": 0}
    fatal = None
    nav_ok = False
    play_ok = False
    zoom_ok, zoom_detail = None, "not reached"
    opening = None
    cine_seen = []
    zebra = None
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
                p = os.path.join(shot_dir, "%s_%s_%s.png" % (titan, biome, name))
                if sess.screenshot(p):
                    shots.append(p)
            nav_ok, nav = menus_to_slate(sess, titan, biome, log=log, snap=snap_menu)
            rep["menus"] = nav
            log("menus: %s %s" % ("OK" if nav_ok else "FAIL", json.dumps(nav)))
            if not nav_ok:
                fatal = nav.get("error", "menu navigation failed")
        if not fatal:
            if sess.screen() == "slate":
                t_c = time.time()
                while time.time() - t_c < 1.0:
                    c = ((sess.state() or {}).get("v2") or {}).get("cine")
                    if c and c.get("shot") and c.get("shot") not in cine_seen:
                        cine_seen.append(c.get("shot"))
                    time.sleep(0.05)
                opening = "cinematic" if cine_seen else "slate"
                p = os.path.join(shot_dir, "%s_%s_slate.png" % (titan, biome))
                if sess.screenshot(p):
                    shots.append(p)
            play_ok, scr = dismiss_slate(sess, 20, "Enter")
            log("%s dismissed by Enter: %s (screen=%s)" % (opening or "slate", play_ok, scr))
            if play_ok and opening == "cinematic":
                zebra = sess.safe_js(CROSSWALK_JS, 0.25, default={"ok": False, "reason": "crosswalk eval failed"})
                log("first play frame zebra check: %s" % ("ON ZEBRA" if (zebra or {}).get("ok") else json.dumps(zebra)[:300]))
                time.sleep(0.35)
                p = os.path.join(shot_dir, "%s_%s_firstplay.png" % (titan, biome))
                if sess.screenshot(p):
                    shots.append(p)
            if not play_ok:
                fatal = "slate did not give way to play (screen=%r)" % (scr,)
        if not fatal:
            sess.release_all()
            time.sleep(0.4)
            zoom_ok, zoom_detail = zoom_check(sess, log)
            fatal = steer(sess, args, titan, biome, m, shots, shot_dir, log)
        ev = sess.event_counts()
        rep["eventPolls"] = sess.event_polls()
        final = sess.state()
        rep["finalState"] = final
    except Exception as e:  # a Playwright/driver failure mid-run is a FAIL with its message, not a traceback
        fatal = "harness exception: %s" % str(e).splitlines()[0][:300]
        log(fatal)
        try:
            ev = sess.event_counts()
        except Exception:
            ev = {}
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    # every hook emits `ability`; the kit events (vent / wireDetonate / spore) duplicate it — never double count
    hook_ev = max(int(ev.get("ability", 0)), sum(int(ev.get(k, 0)) for k in HOOK_EVENTS if k != "ability"))
    dash_ev = int(ev.get("dash", 0))
    eaten = m["props"] + m["floors"]
    checks = [
        ("menus navigated by keys to %s + %s" % (titan, biome), nav_ok),
        ("%s dismissed by a real key" % ("cinematic (%s)" % " → ".join(cine_seen) if opening == "cinematic" else "slate"), play_ok),
        ("moved > 20 m (%.1f m)" % m["moved"], m["moved"] > 20),
        ("ate props/floors ≥ %d (props %d, floors %d)" % (args.min_eaten, m["props"], m["floors"]), eaten >= args.min_eaten),
        ("levelled up (LV %d)" % m["level"], m["level"] >= 2),
        ("draft taken with 1/2/3, owned grew (%d taken, %d failed)" % (m["draftsTaken"], m["draftsFailed"]), m["draftsTaken"] >= 1),
        ("Space → hook effect (%d hook events, %d cd-confirmed, %d presses)" % (hook_ev, m["hookConfirmedByCd"], m["spacePresses"]),
         hook_ev >= 1 or m["hookConfirmedByCd"] >= 1),
        ("Shift → dash effect (%d dash events, %d charge-confirmed, %d presses)" % (dash_ev, m["dashConfirmedByCharges"], m["shiftPresses"]),
         dash_ev >= 1 or m["dashConfirmedByCharges"] >= 1),
        ("0 console/page/window errors, 0 shader diagnostics, 0 failed requests", not diag_problems(diag)),
    ]
    if opening == "cinematic":
        checks.append(("first play frame after the cinematic passes the zebra check", bool((zebra or {}).get("ok"))))
    if zoom_ok is not None or not args.no_dev:
        checks.append(("camera zoom by real wheel / '=' / Z (%s)" % zoom_detail, bool(zoom_ok)))
    if fatal:
        checks.insert(0, ("no fatal harness stop (%s)" % fatal, False))
    passed = all(ok for _, ok in checks)
    print("=" * 78)
    print("PLAYTEST %s  seed %s  (%s)" % (tag, seed, "headless" if args.headless else "headed"))
    print("observed: moved %.1f m · props %d · floors %d · LV %d · Size %s · drafts %d · hp lost %.0f · "
          "pauses %d · stuck detours %d · world exposed %s · peak enemies %s" % (
              m["moved"], m["props"], m["floors"], m["level"], ROMAN[min(4, max(0, int(m["rank"])))],
              m["draftsTaken"], m["hpLost"], m["pauses"], m["stuckDetours"], m["worldExposed"], m["maxEnemies"]))
    print("events  : %s" % json.dumps({k: ev[k] for k in sorted(ev)})[:900])
    if m["end"]:
        print("run end : %s" % m["end"])
    print_diagnostics(diag, limit=15)
    for name, ok in checks:
        print("  [%s] %s" % ("PASS" if ok else "FAIL", name))
    print("RESULT %s: %s" % (tag, "PASS" if passed else "FAIL"))
    rep.update({"opening": opening, "cineShots": cine_seen, "zebraFirstPlay": zebra, "pass": passed, "fatal": fatal, "zoom": {"ok": zoom_ok, "detail": zoom_detail}, "metrics": m, "events": ev, "checks": [[n, ok] for n, ok in checks],
                "shots": shots, "diagnostics": diag, "log": log_lines})
    rep["finalState"] = compact_state(rep.get("finalState"))
    print("report  : %s" % save_report("playtest_%s_%s" % (titan, biome), rep, args.base, args.report_dir))
    return (0 if passed else 1), rep


def steer(sess, args, titan, biome, m, shots, shot_dir, log):
    """Play for args.seconds with real keys. Returns a fatal string or None."""
    t_start = time.time()
    t_end = t_start + args.seconds
    next_shot = t_start + 0.5
    shot_n = 0
    last_space = last_shift = 0.0
    prev = None
    prev_hp = prev_max = None
    banned = []                       # [(x, z, until)]
    detour_until = 0.0
    detour = (0.0, 0.0)
    prog_t = time.time()
    prog_pos = None
    space_check = None                # (time, cdBefore)
    shift_check = None                # (time, chargesBefore)
    draft_i = 0
    no_state = 0
    while time.time() < t_end:
        loop_t0 = time.time()
        now = loop_t0
        banned = [b for b in banned if b[2] > now]
        obs = sess.safe_js(OBS_JS, {"banned": [[b[0], b[1]] for b in banned]})
        s = (obs or {}).get("s") if isinstance(obs, dict) else None
        if not isinstance(s, dict):
            no_state += 1
            if no_state > 50:
                return "__BT__.state() unavailable for 5 s during play (%r)" % ((obs or {}).get("err") if isinstance(obs, dict) else obs,)
            time.sleep(0.1)
            continue
        no_state = 0
        scr = s.get("screen")
        m["worldExposed"] = m["worldExposed"] or bool(obs.get("world"))

        # progress metrics
        if m["propsEaten0"] is None:
            m["propsEaten0"] = s.get("propsEaten") or 0
            m["floorsEaten0"] = s.get("floorsEaten") or 0
        m["props"] = max(m["props"], (s.get("propsEaten") or 0) - m["propsEaten0"])
        m["floors"] = max(m["floors"], (s.get("floorsEaten") or 0) - m["floorsEaten0"])
        m["level"] = max(m["level"], int(s.get("level") or 1))
        m["rank"] = max(m["rank"], int(s.get("rank") or 0))
        if isinstance(s.get("enemies"), (int, float)):
            m["maxEnemies"] = max(m["maxEnemies"], int(s["enemies"]))
        x, z = s.get("x"), s.get("z")
        if isinstance(x, (int, float)) and isinstance(z, (int, float)):
            if prev is not None:
                step = math.hypot(x - prev[0], z - prev[1])
                if step < 200:                      # ignore a respawn/teleport
                    m["moved"] += step
            prev = (x, z)
        hp, mhp = s.get("hp"), s.get("maxHp")
        if isinstance(hp, (int, float)) and isinstance(mhp, (int, float)):
            if prev_hp is not None and prev_max == mhp and hp < prev_hp:
                m["hpLost"] += prev_hp - hp
            prev_hp, prev_max = hp, mhp

        if now >= next_shot:
            p = os.path.join(shot_dir, "%s_%s_%02d.png" % (titan, biome, shot_n))
            if sess.screenshot(p):
                shots.append(p)
            shot_n += 1
            next_shot = now + 15.0

        if scr == "end":
            sess.release_all()
            m["end"] = "run ended at %.0f s of play: %s" % (now - t_start, json.dumps(s.get("run"))[:200])
            log(m["end"])
            return None
        if scr == "pause":
            sess.release_all()
            m["pauses"] += 1
            log("auto-pause seen — pressing Escape to resume")
            sess.press("Escape")
            time.sleep(0.6)
            continue
        drafts = s.get("drafts") or {}
        if scr == "draft" or (scr != "play" and drafts.get("offer")):
            draft_i = handle_draft(sess, s, m, draft_i, log)
            continue
        if scr != "play":
            sess.release_all()
            time.sleep(0.15)
            continue

        T = obs.get("t") or {}
        tx, tz = T.get("x", x), T.get("z", z)
        # confirm hook / dash effects from the world (secondary evidence to the event stream)
        if space_check and now - space_check[0] > 0.3:
            if space_check[1] is not None and space_check[1] <= 0.05 and (T.get("abilityCd") or 0) > 0.3:
                m["hookConfirmedByCd"] += 1
            space_check = None
        if shift_check and now - shift_check[0] > 0.15:
            cb = shift_check[1]
            if cb is not None and ((T.get("dashCharges") is not None and T["dashCharges"] < cb) or (T.get("dashT") or 0) > 0):
                m["dashConfirmedByCharges"] += 1
            shift_check = None

        # steering
        threat = obs.get("threat")
        boss = obs.get("boss")
        H = T.get("height") or 1.2
        dx = dz = 0.0
        if threat:
            dx, dz = threat["dx"], threat["dz"]
        elif now < detour_until:
            dx, dz = detour
        elif boss and (boss.get("introT") or 0) <= 0 and isinstance(tx, (int, float)):
            bx, bz = boss["x"] - tx, boss["z"] - tz
            d = math.hypot(bx, bz) or 1.0
            if d > 2.5 * H + 30:
                dx, dz = bx / d, bz / d
            else:                                   # circle the boss
                dx, dz = -bz / d + 0.2 * bx / d, bx / d + 0.2 * bz / d
        elif obs.get("food") and isinstance(tx, (int, float)):
            f = obs["food"]
            dx, dz = f["x"] - tx, f["z"] - tz
        else:                                       # no world / nothing edible: slow spiral wander
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
        keys = world_to_keys(dx, dz)
        if not keys:
            keys = {"KeyW"}
        sess.hold(keys)

        # stuck detector: holding keys but not moving → perpendicular detour + ban the target
        if prog_pos is None:
            prog_pos, prog_t = (x, z), now
        elif now - prog_t >= 1.5:
            if isinstance(x, (int, float)) and prog_pos[0] is not None:
                moved = math.hypot(x - prog_pos[0], z - prog_pos[1])
                if moved < max(1.0, 0.4 * H) and not threat:
                    m["stuckDetours"] += 1
                    mag = math.hypot(dx, dz) or 1.0
                    sgn = 1 if m["stuckDetours"] % 2 else -1
                    detour = (-dz / mag * sgn, dx / mag * sgn)
                    detour_until = now + 1.0
                    f = obs.get("food")
                    if f:
                        banned.append((f["x"], f["z"], now + 12.0))
            prog_pos, prog_t = (x, z), now

        # hook: on cooldown per the world, else every 2.5 s
        cd = T.get("abilityCd")
        want_space = (cd is not None and cd <= 0 and now - last_space > 1.0) or (cd is None and now - last_space > 2.5)
        if want_space:
            sess.press("Space")
            m["spacePresses"] += 1
            last_space = now
            space_check = (now, cd)
        # dash: out of imminent paint, else periodically
        charges = T.get("dashCharges")
        urgent = bool(threat) and threat.get("tLeft", 9) < 0.45
        periodic = now - last_shift > 5.0
        if (urgent or periodic) and (charges is None or charges >= 1) and now - last_shift > 0.35:
            sess.press("Shift")
            m["shiftPresses"] += 1
            last_shift = now
            shift_check = (now, charges)

        dt = time.time() - loop_t0
        if dt < 0.1:
            time.sleep(0.1 - dt)
    sess.release_all()
    return None


def handle_draft(sess, s, m, draft_i, log):
    """A draft is open: release movement, press 1/2/3 (rotating), confirm owned grew."""
    sess.release_all()
    before = owned_total(s.get("owned"))
    offer = (s.get("drafts") or {}).get("offer")
    time.sleep(0.7)                                   # card reveal
    keys = ["Digit1", "Digit2", "Digit3"]
    key = keys[draft_i % 3]
    for attempt in range(3):
        sess.press(key)
        deadline = time.time() + 3.0
        while time.time() < deadline:
            s2 = sess.state() or {}
            after = owned_total(s2.get("owned"))
            if after > before:
                m["draftsTaken"] += 1
                log("draft #%d: pressed %s on offer %s → owned %d→%d (screen %s)" % (
                    m["draftsTaken"], key, offer, before, after, s2.get("screen")))
                time.sleep(0.3)
                return draft_i + 1
            if s2.get("screen") not in ("draft",) and not (s2.get("drafts") or {}).get("offer"):
                break
            time.sleep(0.15)
        s2 = sess.state() or {}
        if s2.get("screen") != "draft":
            break
        key = keys[(draft_i + attempt + 1) % 3]
    m["draftsFailed"] += 1
    log("draft: pressing 1/2/3 did not grow the owned count (screen now %s)" % ((sess.state() or {}).get("screen"),))
    return draft_i + 1


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH playtest with real keyboard input (gate 4)")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--seconds", type=float, default=120.0)
    ap.add_argument("--min-eaten", type=int, default=3, help="props+floors that must be eaten")
    ap.add_argument("--matrix", action="store_true", help="run %s" % ", ".join("%s/%s" % r for r in MATRIX))
    ap.add_argument("--no-dev", action="store_true", help="open without ?dev=1")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()

    runs = MATRIX if args.matrix else [(args.titan, args.biome)]
    results = []
    worst = 0
    for i, (t, b) in enumerate(runs):
        code, rep = run_one(args, t, b, args.seed + i)
        results.append((t, b, code, rep))
        worst = max(worst, code)
    if len(results) > 1:
        print("\n" + "=" * 78)
        print("MATRIX SUMMARY")
        for t, b, code, rep in results:
            mm = rep.get("metrics") or {}
            print("  %-11s %-12s %s  moved %6.1f m · props %3s · floors %3s · LV %2s · drafts %s" % (
                t, b, "PASS" if code == 0 else ("FAIL" if code == 1 else "NO-RUN"), mm.get("moved", 0.0),
                mm.get("props"), mm.get("floors"), mm.get("level"), mm.get("draftsTaken")))
        save_report("playtest_matrix", {"runs": [{"titan": t, "biome": b, "code": c, "pass": c == 0} for t, b, c, _ in results]},
                    args.base, args.report_dir)
    print("GATE 4: %s" % ("PASS" if worst == 0 else "FAIL"))
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
