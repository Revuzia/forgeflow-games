"""App fix group: browser checks for PC-04 (blur pauses), PC-08 (held move keys live after
pause/draft), F17 (rank-up + level-up same moment: sting first, then draft), F12 (tabloid photo
without telegraphs), PC-12 (select remembers titan), PC-03 (HUD status card CSS), A2 (records).
Real keys drive play; dev cheats only set up situations. Observation + screenshots in _shots/appfix/."""
import argparse, base64, json, math, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (Session, add_common_args, build_url, SHOTS, detect_focus, ensure_play, xp_to_next,  # noqa
                    TITAN_NAMES)

ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument("--only", default="")
args = ap.parse_args(); args.no_serve = True
OUT = os.path.join(SHOTS, "appfix"); os.makedirs(OUT, exist_ok=True)
S = Session(args, "appfix"); S.start()
R = {}
def note(k, v): R[k] = v; print(k, "=", json.dumps(v, default=str)[:600], flush=True)
def st(): return S.state() or {}
def want(name): return not args.only or name in args.only.split(",")
def pos(): s = st(); return (s.get("x") or 0.0, s.get("z") or 0.0)
def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

def boot(**kw):
    S.release_all()
    S.goto(build_url(args.base, **kw)); S.wait_bt(60)

try:
    if want("blur"):
        boot(autostart=1, noslate=1, seed=77, titan="molo", biome="grideast", dev=1)
        S.wait_screen("play", 60); time.sleep(1.0)
        S.js("() => window.dispatchEvent(new Event('blur'))"); ok, scr = S.wait_screen("pause", 2)
        note("PC04_blur_pauses", {"ok": ok, "screen": scr})
        time.sleep(0.6); S.press("Escape"); ok2, _ = S.wait_screen("play", 4)
        t0 = st().get("t"); time.sleep(1.0); t1 = st().get("t")
        note("PC04_resume_after_blur_pause_sim_runs", {"ok": ok2, "t0": t0, "t1": t1})
        # blur outside play is harmless (title/select)
    if want("held"):
        boot(autostart=1, noslate=1, seed=78, titan="molo", biome="grideast", dev=1)
        S.wait_screen("play", 60); S.cheat("god", True); S.cheat("noSpawns", True); time.sleep(1.0)
        S.hold({"KeyD"}); time.sleep(0.6)
        S.page.keyboard.down("Escape"); time.sleep(0.05); S.page.keyboard.up("Escape")   # D still held
        okp, _ = S.wait_screen("pause", 3); time.sleep(1.0)
        S.page.keyboard.down("Escape"); time.sleep(0.05); S.page.keyboard.up("Escape")
        okr, _ = S.wait_screen("play", 4)
        a = pos(); time.sleep(0.8); b = pos()
        note("PC08_held_D_through_pause_moves_m", {"paused": okp, "resumed": okr, "moved_m": round(dist(a, b), 2)})
        lvl = st().get("level") or 1
        S.cheat("xp", xp_to_next(lvl) + 1)
        okd, _ = S.wait_screen("draft", 4); time.sleep(0.8)
        S.page.keyboard.down("Digit1"); time.sleep(0.05); S.page.keyboard.up("Digit1")
        okp2, _ = S.wait_screen("play", 5)
        a = pos(); time.sleep(0.8); b = pos()
        note("PC08_held_D_through_draft_moves_m", {"draft": okd, "play": okp2, "moved_m": round(dist(a, b), 2)})
        # Space held through a draft must NOT fire the hook after resume
        S.release_all()
    if want("sting"):
        boot(autostart=1, noslate=1, seed=79, titan="hearthback", biome="whitestacks", dev=1)
        S.wait_screen("play", 60); S.cheat("god", True); time.sleep(1.2)
        lvl = st().get("level") or 1
        # rank-up and a level-up in the SAME moment (one JS task, between two ticks)
        S.js("(x) => { const c = window.__BT__.cheat; c.xp(x); c.rank(1); }", xp_to_next(lvl) + 1)
        t0 = time.time(); trace = []; shots = {}
        while time.time() - t0 < 4.0:
            s = st(); el = round(time.time() - t0, 2)
            trace.append((el, s.get("screen"), s.get("tick"), s.get("rank")))
            if el > 0.9 and "mid" not in shots:
                S.screenshot(os.path.join(OUT, "F17_sting_mid.png")); shots["mid"] = el
            if s.get("screen") == "draft" and "draft" not in shots:
                time.sleep(0.5); S.screenshot(os.path.join(OUT, "F17_draft_after_sting.png")); shots["draft"] = round(time.time() - t0, 2)
            time.sleep(0.1)
        first_draft = next((x[0] for x in trace if x[1] == "draft"), None)
        ticks_in_hold = [x[2] for x in trace if x[1] == "play"]
        note("F17_draft_waits_for_sting", {"first_draft_s": first_draft, "rank": trace[-1][3],
                                          "ticks_advanced_during_hold": (max(ticks_in_hold) - min(ticks_in_hold)) if ticks_in_hold else None,
                                          "shots": shots, "trace": trace[::5]})
        ensure_play(S, 8)
        # plain level-up (no rank-up): still opens at once
        lvl = st().get("level") or 1
        S.cheat("xp", xp_to_next(lvl) + 1); t0 = time.time()
        ok, _ = S.wait_screen("draft", 3)
        note("F17_plain_levelup_opens_immediately_s", {"ok": ok, "s": round(time.time() - t0, 2)})
        ensure_play(S, 8)
    if want("photo"):
        boot(autostart=1, noslate=1, seed=4242, titan="hearthback", biome="lockwater", dev=1)
        S.wait_screen("play", 60); time.sleep(1.0)
        S.cheat("spawn", "tank", 14); S.cheat("spawn", "walker", 6); S.cheat("spawn", "apc", 6)
        t0 = time.time(); tg = []
        while time.time() - t0 < 90:
            s = st()
            if s.get("screen") == "draft": S.press("Digit1"); time.sleep(0.5); continue
            if (s.get("run") or {}).get("result") or s.get("screen") == "end": break
            S.safe_js("() => { const w = window.__BT__.world; if (w && w.titan.hp > 20) w.titan.hp = 20; }")
            time.sleep(0.4)
        tel_at_end = S.safe_js("() => { const w = window.__BT__.world; return w ? w.telegraphs.filter(t => t.alive !== false).length : null; }")
        ok, _ = S.wait_screen("end", 8); time.sleep(2.2)
        src = S.safe_js("() => { const i = document.querySelector('.bt-np-img'); return i ? i.src : null; }")
        if src and src.startswith("data:image"):
            with open(os.path.join(OUT, "F12_tabloid_photo.jpg"), "wb") as f:
                f.write(base64.b64decode(src.split(",", 1)[1]))
        S.screenshot(os.path.join(OUT, "F12_tabloid.png"))
        rec = S.safe_js("() => [...document.querySelectorAll('.bt-np-record-row, .bt-np-record-note')].map(e => e.innerText.replace(/\\s+/g, ' ')).slice(0, 8)")
        note("F12_photo", {"end": ok, "live_telegraphs_in_world_at_end": tel_at_end, "photo_saved": bool(src), "record_book": rec})
    if want("select"):
        boot(seed=5)
        S.wait_screen("title", 60); time.sleep(1.2); S.press("Enter")
        S.wait_screen("select", 30); time.sleep(1.0)
        names = [TITAN_NAMES[t] for t in ("molo", "voltkite", "hearthback", "briarwick")]
        f0, _ = detect_focus(S, names)
        S.press("ArrowRight"); time.sleep(0.4)
        f1, _ = detect_focus(S, names)
        S.press("Enter"); time.sleep(0.8); S.press("Escape"); time.sleep(0.8); S.press("Escape")
        okt, _ = S.wait_screen("title", 5); time.sleep(1.2); S.press("Enter")
        S.wait_screen("select", 10); time.sleep(1.0)
        f2, _ = detect_focus(S, names)
        note("PC12_select_remembers", {"initial": f0, "moved_to": f1, "back_at_title": okt, "after_roundtrip": f2})
    if want("hud"):
        JS = r"""() => { const c = document.querySelector('.bt-status'); if (!c) return null; const cs = getComputedStyle(c);
          const r = c.getBoundingClientRect(); const spill = [...c.querySelectorAll('*')].filter(k => { const b = k.getBoundingClientRect(); return b.width && b.right > r.right + 0.5; }).length;
          const scrollers = [...document.querySelectorAll('#ui *')].filter(e => { const s = getComputedStyle(e); if (s.display === 'none') return false;
            return (e.scrollWidth - e.clientWidth > 1 && /auto|scroll/.test(s.overflowX)) || (e.scrollHeight - e.clientHeight > 1 && /auto|scroll/.test(s.overflowY)); }).map(e => e.className).slice(0, 6);
          return { padding: cs.padding, overflow: cs.overflow, w: Math.round(r.width), scrollW: c.scrollWidth, clientW: c.clientWidth, spill, scrollers,
                   anyBtCardInUi: document.querySelectorAll('#ui .bt-card').length }; }"""
        res = {}
        for t in ("molo", "voltkite", "hearthback", "briarwick"):
            for vw in ((1280, 720), (1920, 1080)):
                S.page.set_viewport_size({"width": vw[0], "height": vw[1]})
                boot(autostart=1, noslate=1, seed=11, titan=t); S.wait_screen("play", 60); time.sleep(1.5)
                res["%s_%d" % (t, vw[0])] = S.safe_js(JS)
                if t == "voltkite": S.screenshot(os.path.join(OUT, "PC03_hud_voltkite_%d.png" % vw[0]))
        S.page.set_viewport_size({"width": args.width, "height": args.height})
        note("PC03_hud_status", res)
finally:
    d = S.diagnostics()
    note("diagnostics", {k: v[:4] for k, v in d.items() if v})
    with open(os.path.join(OUT, "app_flows.json"), "w", encoding="utf-8") as f:
        json.dump(R, f, indent=1, default=str)
    S.close()
