#!/usr/bin/env python
"""HIT PARADE - mobile gate (G8 part 1, CONTRACT_MOBILE M11). Pattern: dyefield/_harness/mobile.py. HEADLESS.

Device emulation (viewport, DPR, is_mobile, has_touch, a mobile UA, notch safe-area insets through CDP) and REAL touches
through CDP Input.dispatchTouchEvent (multi-touch included) - never synthetic calls into TouchControls internals. The
input word is read back exactly as input.ts consumes it (held | latched, latched cleared per tick).

--lab (default, runs now): runtime/lab/ui.html?hud=mid&touch=1 on the UI dev server (:5324) - the real Hud + Menus +
TouchControls over the scripted bout. Per device:
  1 boot      html.hp-touch; the overlay is visible; every control >= 44 px and inside the safe area
  2 stick     a drag from the stick's home: right -> RIGHT; 45 deg -> UP|RIGHT; 80 deg -> UP (the 60-degree UP sector);
              20 deg -> RIGHT (not up); down-left -> DOWN|LEFT; release -> neutral; inside the 15 % deadzone -> neutral
  3 buttons   a tap on L / M / H / SP / PARRY / IMPACT / THROW sets exactly its bit (a tap shorter than a tick still lands);
              SUPER (shown at >= 1 SHOWTIME bar) = S|H; ASSIST latches ASSIST for ~1 s after a tap
  4 multi     stick right + L + H held together -> RIGHT|L|H (3 touches)
  5 pause     the PAUSE button -> the pause card -> a tap on RESUME -> back to the bout
  6 edit      EDIT LAYOUT: drag L by (-40, -30) -> DONE -> settings.touchLayout.l = {dx -40, dy -30} and L moved
  7 menus     taps: title -> main -> VERSUS -> BACK -> main (the menus take touches, 44 px targets)
  8 hygiene   a pinch keeps visualViewport.scale 1; the page never scrolls; a long-press selects nothing
  CHANGED(UI3D) (CONTRACT §35.2, the 3D ring): taps on STEP IN / STEP OUT set bit 13 / 14 (in `buttons`); a held STEP stays
  held across reads (= the sim's circle-walk) and clears on release; stick + STEP together (2 touches); the STEP pair sits
  above the stick (no overlap with its base); EDIT LAYOUT drags STEP IN too. --game adds: a held STEP IN circle-walks P1
  round P2 (sidewalk, distance kept, >= 30 deg) and a STEP OUT tap sidesteps (state sidestep, dir 'out').
--game (integration, CHANGED(integrator): implemented): the shell's ?touch=1&mode=versus&p1=johnny&p2=bruno&autostart=1&dev=1
deep link (P2 idle): the overlay shows, the stick walks P1 (x changes >= 0.3 m), an L tap produces a HIT or WHIFF event,
PAUSE -> card -> a tap on RESUME, portrait -> rotate overlay pauses the bout.
CHANGED(fix_ui_stage) (verifier D12): Touch.up() sends `touchEnd` listing ONLY the released finger (CDP ends the points a
touchEnd lists; the old call listed every OTHER finger and lifted the wrong ones). New checks: lab `release_step_keeps_stick`
(stick + STEP, lift STEP: LEFT stays, 1 active) and `release_one_of_3` (stick + L + H, lift H: RIGHT|L stay, 2 active);
--game `game_release_one_finger` (stick right + STEP OUT, lift STEP: the game's touch word keeps RIGHT, drops STEP_OUT).
Screenshots: _shots/mobile_<device>_<step>.png. Report: _harness/_reports/mobile.json. Exit 0 PASS, 1 FAIL, 2 error.
Run:  python _harness/mobile.py --headless [--devices se,p844,iphone14,pixel7,ipad]
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from menus import LabServer, HarnessError, lab_url, save_report, shot, wait_ready, ROOT, INIT_JS, READ_MENUS, READ_TOUCH, LAB_PORT  # noqa: E402
from layoutcheck import DEVICES, check_page  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

BIT = {"UP": 1, "DOWN": 2, "LEFT": 4, "RIGHT": 8, "L": 16, "M": 32, "H": 64, "S": 128, "ASSIST": 256, "THROW": 512, "PARRY": 1024, "IMPACT": 2048,
       "STEP_IN": 8192, "STEP_OUT": 16384}
BTN_BITS = {"l": BIT["L"], "m": BIT["M"], "h": BIT["H"], "s": BIT["S"], "parry": BIT["PARRY"], "impact": BIT["IMPACT"], "throw": BIT["THROW"],
            "stepin": BIT["STEP_IN"], "stepout": BIT["STEP_OUT"]}
READ_WORD = "(() => { const L = window.__UILAB__; if (L) return L.readWord(); const H = window.__HP__; return H && H.dev && H.dev.touchWord ? H.dev.touchWord() : -1; })()"


class Touch:
    """CDP touch driver: every active point is re-sent on each event (the protocol's multi-touch model)"""

    def __init__(self, cdp):
        self.cdp = cdp
        self.pts: dict[int, tuple[float, float]] = {}

    def _send(self, typ: str) -> None:
        pts = [{"x": x, "y": y, "id": i, "radiusX": 8, "radiusY": 8, "force": 1} for i, (x, y) in self.pts.items()]
        self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": pts})

    def down(self, i: int, x: float, y: float) -> None:
        self.pts[i] = (x, y)
        self._send("touchStart")

    def move(self, i: int, x: float, y: float, steps: int = 4) -> None:
        x0, y0 = self.pts[i]
        for k in range(1, steps + 1):
            self.pts[i] = (x0 + (x - x0) * k / steps, y0 + (y - y0) * k / steps)
            self._send("touchMove")
            time.sleep(0.016)

    def up(self, i: int) -> None:
        # CHANGED(fix_ui_stage) (verifier D12): CDP Input.dispatchTouchEvent `touchEnd` ENDS THE POINTS IT LISTS (measured by
        # the 3D verifier, ver3d_touch2: touchEnd [stick] released the stick and left STEP held; touchEnd [STEP finger]
        # released STEP and kept the stick). The old call listed every OTHER active finger, so a multi-touch release lifted
        # the wrong fingers (and an empty list ended them all). List only the released finger.
        if i not in self.pts:
            return
        x, y = self.pts.pop(i)
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": x, "y": y, "id": i}]})

    def tap(self, x: float, y: float, hold: float = 0.05) -> None:
        self.down(99, x, y)
        time.sleep(hold)
        self.up(99)


class Run:
    def __init__(self, page, dev: str, results: list):
        self.page = page
        self.dev = dev
        self.results = results

    def ok(self, step: str, cond: bool, detail: str = "", snap: bool = False) -> bool:
        path = shot(self.page, f"mobile_{self.dev}_{step}") if snap else ""
        self.results.append({"device": self.dev, "step": step, "ok": bool(cond), "detail": detail, "shot": os.path.relpath(path, ROOT).replace("\\", "/") if path else ""})
        print(f"  [{'PASS' if cond else 'FAIL'}] {self.dev:<8} {step:<24} {detail}")
        return cond

    def touch(self) -> dict:
        return self.page.evaluate(READ_TOUCH) or {}

    def word(self) -> int:
        return int(self.page.evaluate(READ_WORD))

    def btn(self, bid: str) -> dict | None:
        for b in self.touch().get("buttons", []):
            if b["id"] == bid:
                return b
        return None

    def centre(self, bid: str) -> tuple[float, float]:
        b = self.btn(bid)
        if not b:
            raise HarnessError(f"touch button {bid} not on screen")
        r = b["rect"]
        return r["x"] + r["w"] / 2, r["y"] + r["h"] / 2


def names(word: int) -> str:
    return "|".join(k for k, v in BIT.items() if word & v) or "neutral"


def label_fit(R: "Run", t: dict, d: dict, prefix: str = "") -> None:
    """CHANGED(UI) P2 (P1 verifier: touch labels overflowed their discs on an iPhone, DPR 3): every visible label's width
    fits the chord of its disc at the label's half height (TouchControls.labelFit read-back, real glyph boxes)."""
    labels = t.get("labels") or []
    bad = [f"{x['id']} {x['w']}>{x['avail']}" for x in labels if not x.get("fit")]
    worst = min((x["avail"] - x["w"] for x in labels), default=0)
    R.ok(f"{prefix}labels_fit", bool(labels) and not bad, f"dpr={d['dpr']} labels={len(labels)} min spare={worst:.1f}px overflow={bad}")


def lab_device(page, cdp, dev: str, results: list) -> None:
    R = Run(page, dev, results)
    T = Touch(cdp)
    d = DEVICES[dev]
    W, H = d["w"], d["h"]
    # 1 boot
    t = R.touch()
    R.ok("boot_touch_mode", page.evaluate("document.documentElement.classList.contains('hp-touch')") and t.get("visible") is True, f"buttons={len(t.get('buttons', []))}", snap=True)
    lay = check_page(page, f"{dev}:hud")
    R.ok("boot_layout", not lay["problems"], f"problems={[p['msg'] for p in lay['problems']][:3]}")
    small = [b["id"] for b in t.get("buttons", []) if b["id"] != "stick" and min(b["rect"]["w"], b["rect"]["h"]) < 44 - 0.5]
    R.ok("targets_44", not small, f"small={small}")
    label_fit(R, t, d)
    # 2 stick (home = the drawn base centre; the drag starts there)
    sb = R.btn("stick")["rect"]
    sx, sy = sb["x"] + sb["w"] / 2, sb["y"] + sb["h"] / 2
    rad = sb["w"] / 2
    cases = [("right", 0, BIT["RIGHT"]), ("up_right_45", 45, BIT["UP"] | BIT["RIGHT"]), ("up_80", 80, BIT["UP"]),
             ("right_20", 20, BIT["RIGHT"]), ("down_left", 225, BIT["DOWN"] | BIT["LEFT"])]
    for label, ang, want in cases:
        T.down(1, sx, sy)
        a = math.radians(ang)
        T.move(1, sx + math.cos(a) * rad * 0.8, sy - math.sin(a) * rad * 0.8)
        time.sleep(0.03)
        w = R.word() & 15
        T.up(1)
        R.ok(f"stick_{label}", w == want, f"word={names(w)} want={names(want)}")
    T.down(1, sx, sy)
    T.move(1, sx + rad * 0.08, sy)
    w = R.word() & 15
    T.up(1)
    R.ok("stick_deadzone", w == 0, f"word={names(w)} (8 % of the radius)")
    time.sleep(0.05)
    R.ok("stick_release", R.word() & 15 == 0, "neutral after release")
    # 3 buttons (a quick tap is latched until the next read)
    for bid, bit in BTN_BITS.items():
        R.word()                                   # drain
        x, y = R.centre(bid)
        T.tap(x, y, 0.02)
        w = R.word()
        R.ok(f"tap_{bid}", w & 0x7FFF == bit, f"word={names(w)}")
    sup = R.btn("super")
    if sup:
        R.word()
        x, y = R.centre("super")
        T.tap(x, y)
        w = R.word()
        R.ok("tap_super_macro", w & (BIT["S"] | BIT["H"]) == (BIT["S"] | BIT["H"]), f"word={names(w)}")
    else:
        R.ok("tap_super_macro", False, "SUPER not shown although P1 holds 2.4 SHOWTIME bars")
    R.word()
    x, y = R.centre("assist")
    T.tap(x, y)
    w1 = R.word()
    time.sleep(0.45)
    w2 = R.word()
    time.sleep(0.8)
    w3 = R.word()
    R.ok("assist_latch_1s", bool(w1 & BIT["ASSIST"]) and bool(w2 & BIT["ASSIST"]) and not (w3 & BIT["ASSIST"]), f"t0={names(w1)} t0.45={names(w2)} t1.25={names(w3)}")
    # CHANGED(UI3D): STEP - the pair sits above the stick base; a held STEP stays held (circle-walk), clears on release;
    # stick + STEP together
    si, so = R.btn("stepin"), R.btn("stepout")
    above = bool(si and so) and all(b["rect"]["y"] + b["rect"]["h"] <= sb["y"] + 0.5 and b["rect"]["x"] + b["rect"]["w"] > sb["x"] - 40 and b["rect"]["x"] < sb["x"] + sb["w"] + 40 for b in (si, so))
    R.ok("step_pair_above_stick", above, f"stepin={si and si['rect']} stepout={so and so['rect']} stick={sb}")
    R.word()
    x, y = R.centre("stepin")
    T.down(8, x, y)
    time.sleep(0.05)
    w1 = R.word()
    time.sleep(0.3)
    w2 = R.word()
    T.up(8)
    time.sleep(0.05)
    w3 = R.word()
    R.ok("step_hold_held", (w1 & BIT["STEP_IN"]) and (w2 & BIT["STEP_IN"]) and not (w3 & (BIT["STEP_IN"] | BIT["STEP_OUT"])), f"t0={names(w1)} t0.3={names(w2)} released={names(w3)}")
    T.down(1, sx, sy)
    T.move(1, sx - rad * 0.8, sy)
    x, y = R.centre("stepout")
    T.down(9, x, y)
    time.sleep(0.05)
    w = R.word()
    act = R.touch().get("active")
    R.ok("stick_plus_step", (w & (BIT["LEFT"] | BIT["STEP_OUT"])) == (BIT["LEFT"] | BIT["STEP_OUT"]) and act == 2, f"word={names(w)} active={act}", snap=True)
    # CHANGED(fix_ui_stage) (verifier D12): lifting ONE finger of two releases that finger only (STEP up, the stick stays)
    T.up(9)
    time.sleep(0.05)
    w = R.word()
    act = R.touch().get("active")
    R.ok("release_step_keeps_stick", bool(w & BIT["LEFT"]) and not (w & (BIT["STEP_IN"] | BIT["STEP_OUT"])) and act == 1, f"word={names(w)} active={act}")
    T.up(1)
    time.sleep(0.05)
    R.word()
    # 4 multi-touch: stick right + L + H
    T.down(1, sx, sy)
    T.move(1, sx + rad * 0.8, sy)
    lx, ly = R.centre("l")
    hx, hy = R.centre("h")
    T.down(2, lx, ly)
    T.down(3, hx, hy)
    time.sleep(0.05)
    w = R.word()
    act = R.touch().get("active")
    R.ok("multitouch_3", (w & (BIT["RIGHT"] | BIT["L"] | BIT["H"])) == (BIT["RIGHT"] | BIT["L"] | BIT["H"]) and act == 3, f"word={names(w)} active={act}", snap=True)
    # CHANGED(fix_ui_stage) (verifier D12): release H first - the stick and L stay held
    T.up(3)
    time.sleep(0.05)
    w = R.word()
    act = R.touch().get("active")
    R.ok("release_one_of_3", (w & (BIT["RIGHT"] | BIT["L"])) == (BIT["RIGHT"] | BIT["L"]) and not (w & BIT["H"]) and act == 2, f"word={names(w)} active={act}")
    T.up(2); T.up(1)
    time.sleep(0.05)
    R.word()
    R.ok("multitouch_release", R.word() == 0, f"word={names(R.word())}")
    # 5 pause by touch -> card -> RESUME by touch
    px, py = R.centre("pause")
    T.tap(px, py)
    time.sleep(0.4)
    m = page.evaluate(READ_MENUS) or {}
    R.ok("pause_card", m.get("screen") == "pause", f"screen={m.get('screen')}", snap=True)
    rb = page.evaluate("(() => { const r = document.getElementById('hpm-p-resume').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()")
    T.tap(rb["x"], rb["y"])
    time.sleep(0.4)
    m = page.evaluate(READ_MENUS) or {}
    R.ok("pause_resume", not m.get("visible") and page.evaluate("window.__UILAB__ ? window.__UILAB__.phase() : ''") == "bout", f"visible={m.get('visible')}")
    # 6 edit layout: drag L by (-40, -30), DONE
    page.evaluate("window.__UILAB__.editLayout(true)")
    time.sleep(0.15)
    lx, ly = R.centre("l")
    T.down(4, lx, ly)
    T.move(4, lx - 40, ly - 30, 6)
    T.up(4)
    done = page.evaluate("(() => { const b = document.querySelector('#hp-touch .hpt-ebtn.done').getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()")
    shot(page, f"mobile_{dev}_edit_layout")
    T.tap(done["x"], done["y"])
    time.sleep(0.2)
    lay_l = (page.evaluate("window.__UILAB__.settings().touchLayout") or {}).get("l") or {}
    nx, ny = R.centre("l")
    R.ok("edit_layout_saved", abs(lay_l.get("dx", 0) + 40) <= 2 and abs(lay_l.get("dy", 0) + 30) <= 2 and abs((nx - lx) + 40) <= 3, f"saved={lay_l} moved=({nx - lx:.0f},{ny - ly:.0f})")
    # CHANGED(UI3D): the STEP buttons are in the layout editor too (drag STEP IN by (+30, -20))
    page.evaluate("window.__UILAB__.editLayout(true)")
    time.sleep(0.15)
    ix, iy = R.centre("stepin")
    T.down(4, ix, iy)
    T.move(4, ix + 30, iy - 20, 6)
    T.up(4)
    done = page.evaluate("(() => { const b = document.querySelector('#hp-touch .hpt-ebtn.done').getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()")
    T.tap(done["x"], done["y"])
    time.sleep(0.2)
    lay_s = (page.evaluate("window.__UILAB__.settings().touchLayout") or {}).get("stepin") or {}
    nx, ny = R.centre("stepin")
    R.ok("edit_layout_step", abs(lay_s.get("dx", 0) - 30) <= 2 and abs(lay_s.get("dy", 0) + 20) <= 2 and abs((nx - ix) - 30) <= 3, f"saved={lay_s} moved=({nx - ix:.0f},{ny - iy:.0f})")
    # 8 hygiene
    T.down(5, W * 0.5 - 40, H * 0.5)
    T.down(6, W * 0.5 + 40, H * 0.5)
    T.move(6, W * 0.5 + 120, H * 0.5)
    T.up(6); T.up(5)
    scale = page.evaluate("window.visualViewport ? window.visualViewport.scale : 1")
    scroll = page.evaluate("[scrollX, scrollY, document.scrollingElement.scrollTop]")
    R.ok("pinch_no_zoom", abs(scale - 1) < 1e-3 and scroll == [0, 0, 0], f"scale={scale} scroll={scroll}")
    T.down(7, W * 0.3, H * 0.45)
    time.sleep(0.9)
    T.up(7)
    sel = page.evaluate("String(getSelection ? getSelection() : '')")
    R.ok("longpress_no_select", sel == "", f"selection={sel!r}")


def lab_menus_by_tap(page, cdp, dev: str, results: list) -> None:
    R = Run(page, dev, results)
    T = Touch(cdp)

    def tap_id(eid: str) -> None:
        c = page.evaluate(f"(() => {{ const e = document.getElementById('{eid}'); if (!e) return null; const r = e.getBoundingClientRect(); return {{x: r.left + r.width / 2, y: r.top + r.height / 2}}; }})()")
        if not c:
            raise HarnessError(f"#{eid} not found")
        T.tap(c["x"], c["y"])
        time.sleep(0.35)

    scr = lambda: (page.evaluate(READ_MENUS) or {}).get("screen")  # noqa: E731
    T.tap(100, 100)
    time.sleep(0.35)
    R.ok("tap_title_to_main", scr() == "main", f"screen={scr()}")
    tap_id("hpm-main-versus")
    R.ok("tap_versus", scr() == "versus", f"screen={scr()}", snap=True)
    page.evaluate("document.querySelector('#hp-menus .hpm-s-versus .hpm-back') && (document.querySelector('#hp-menus .hpm-s-versus .hpm-back').id = 'hpm-test-back')")
    tap_id("hpm-test-back")
    R.ok("tap_back", scr() == "main", f"screen={scr()}")


def game_device(page, cdp, dev: str, results: list, base: str) -> None:
    """CHANGED(integrator): the --game path (the shell now wires TouchControls, CONTRACT §24.3): a real deep-linked bout
    in touch mode, driven by CDP touches only."""
    R = Run(page, dev, results)
    T = Touch(cdp)
    d = DEVICES[dev]
    # P2 is an idle dummy (no cpu2): a live CPU can stun P1 through every tap (measured: 4 L taps, 0 attacks on iphone14)
    url = base.rstrip("/") + "/?touch=1&mode=versus&p1=johnny&p2=bruno&stage=rust_theater&seed=1&autostart=1&dev=1"
    page.goto(url, wait_until="load")
    phase = lambda: page.evaluate("(() => { try { return __HP__.state().phase; } catch (e) { return null; } })()")  # noqa: E731
    mphase = lambda: page.evaluate("(() => { try { const m = __HP__.match(); return m ? m.phase : null; } catch (e) { return null; } })()")  # noqa: E731
    fx = lambda: page.evaluate("(() => { try { return __HP__.fighters()[0].x; } catch (e) { return null; } })()")  # noqa: E731
    t0 = time.time()
    while time.time() - t0 < 90 and not (phase() == "bout" and mphase() == "fight"):
        time.sleep(0.25)
    R.ok("game_bout_fight", phase() == "bout" and mphase() == "fight", f"phase={phase()} match={mphase()}")
    time.sleep(0.8)
    t = R.touch()
    R.ok("game_overlay_visible", page.evaluate("document.documentElement.classList.contains('hp-touch')") and t.get("visible") is True,
         f"visible={t.get('visible')} buttons={len(t.get('buttons', []))}", snap=True)
    label_fit(R, t, d, "game_")
    # stick right -> P1 walks
    sb = (R.btn("stick") or {}).get("rect")
    if sb:
        sx, sy = sb["x"] + sb["w"] / 2, sb["y"] + sb["h"] / 2
        x0 = fx()
        T.down(1, sx, sy)
        T.move(1, sx + sb["w"] * 0.4, sy)
        time.sleep(0.8)
        x1 = fx()
        T.up(1)
        R.ok("game_stick_walks", isinstance(x0, (int, float)) and isinstance(x1, (int, float)) and x1 - x0 >= 0.3, f"P1 x {x0} -> {x1}")
        # CHANGED(fix_ui_stage) (verifier D12): two fingers (stick right + STEP OUT held), lift ONLY the STEP finger -> the
        # game's touch word keeps RIGHT and drops STEP_OUT; lift the stick -> neutral (dev.touchWord = what input.ts reads)
        if R.btn("stepout"):
            ox, oy = R.centre("stepout")
            T.down(1, sx, sy)
            T.move(1, sx + sb["w"] * 0.4, sy)
            T.down(2, ox, oy)
            time.sleep(0.15)
            w_both = R.word()
            T.up(2)
            time.sleep(0.15)
            w_stick = R.word()
            act = R.touch().get("active")
            T.up(1)
            time.sleep(0.15)
            w_none = R.word()
            R.ok("game_release_one_finger", (w_both & (BIT["RIGHT"] | BIT["STEP_OUT"])) == (BIT["RIGHT"] | BIT["STEP_OUT"])
                 and bool(w_stick & BIT["RIGHT"]) and not (w_stick & BIT["STEP_OUT"]) and act == 1 and w_none == 0,
                 f"both={names(w_both)} after STEP up={names(w_stick)} active={act} after stick up={names(w_none)}")
            time.sleep(0.4)
    else:
        R.ok("game_stick_walks", False, "no stick rect in __HP__.touch()")
    # L tap -> an attack event by P1
    n0 = page.evaluate("__HP__.events(512).filter(e => e.a === 0 && ['HIT','WHIFF','BLOCK','COUNTER','PUNISH'].includes(e.typeName)).length")
    lx, ly = R.centre("l")
    got = 0
    for _ in range(4):
        T.tap(lx, ly, 0.06)
        time.sleep(0.45)
        got = page.evaluate("__HP__.events(512).filter(e => e.a === 0 && ['HIT','WHIFF','BLOCK','COUNTER','PUNISH'].includes(e.typeName)).length") - n0
        if got > 0:
            break
    R.ok("game_tap_L_attacks", got > 0, f"new P1 HIT/WHIFF/BLOCK events: {got}")
    # CHANGED(UI3D): a held STEP IN circle-walks P1 round P2; a STEP OUT tap sidesteps
    rd = lambda: page.evaluate("(() => { const f = __HP__.fighters(); const a = f[0], b = f[1]; return { st: a.stateName, dir: a.step ? a.step.dir : '', ang: Math.atan2(a.x - b.x, a.z - b.z) * 180 / Math.PI, d: Math.hypot(a.x - b.x, a.z - b.z) }; })()")  # noqa: E731
    time.sleep(0.6)
    if R.btn("stepin") and R.btn("stepout"):
        a0 = rd()
        x, y = R.centre("stepin")
        T.down(1, x, y)
        sts, dists = set(), []
        for _ in range(12):
            time.sleep(0.12)
            r = rd()
            sts.add(r["st"])
            if r["st"] == "sidewalk":
                dists.append(r["d"])
        a1 = rd()
        T.up(1)
        sweep = abs(((a1["ang"] - a0["ang"]) + 180) % 360 - 180)
        R.ok("game_step_in_circles", "sidewalk" in sts and sweep >= 30 and bool(dists) and max(dists) - min(dists) < 0.05,
             f"states={sorted(sts)} swept={sweep:.0f} deg distance={min(dists) if dists else 0:.3f}..{max(dists) if dists else 0:.3f} m", snap=True)
        time.sleep(0.5)
        x, y = R.centre("stepout")
        T.tap(x, y, 0.05)
        seen = None
        for _ in range(10):
            r = rd()
            if r["st"] == "sidestep":
                seen = r
                break
            time.sleep(0.03)
        R.ok("game_step_out_tap_sidesteps", bool(seen) and seen["dir"] == "out", f"seen={seen}")
        time.sleep(0.5)
    else:
        R.ok("game_step_in_circles", False, "no STEP buttons in __HP__.touch()")
    # PAUSE button -> the pause card -> tap RESUME
    px, py = R.centre("pause")
    T.tap(px, py, 0.06)
    time.sleep(0.6)
    R.ok("game_pause_button", phase() == "paused", f"phase={phase()}", snap=True)
    rect = page.evaluate("(() => { const b = document.getElementById('hpm-p-resume'); if (!b) return null; const r = b.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()")
    if rect:
        T.tap(rect["x"], rect["y"], 0.06)
        time.sleep(0.6)
    R.ok("game_resume_tap", phase() == "bout", f"phase={phase()} resume={rect}")
    # portrait -> the rotate overlay pauses the bout
    page.set_viewport_size({"width": d["h"], "height": d["w"]})
    time.sleep(0.8)
    shown = page.evaluate("(() => { const e = document.getElementById('hp-rotate'); return !!e && !e.hidden; })()")
    R.ok("game_portrait_rotate_pauses", shown and phase() == "paused", f"rotate overlay={shown} phase={phase()}", snap=True)
    page.set_viewport_size({"width": d["w"], "height": d["h"]})
    time.sleep(0.3)


def run(args) -> int:
    from playwright.sync_api import sync_playwright
    devices = [d.strip() for d in args.devices.split(",") if d.strip()]
    results: list = []
    errors: list = []
    t0 = time.time()
    srv = LabServer() if not args.base else None
    try:
        if srv:
            srv.__enter__()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--use-angle=d3d11", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
            for dev in devices:
                d = DEVICES[dev]
                if not d["mobile"]:
                    continue
                ctx = browser.new_context(viewport={"width": d["w"], "height": d["h"]}, device_scale_factor=d["dpr"], is_mobile=True, has_touch=True, user_agent=d["ua"])
                ctx.add_init_script(INIT_JS)
                page = ctx.new_page()
                page.on("pageerror", lambda e, dev=dev: errors.append(f"{dev} pageerror: {e}"))
                page.on("console", lambda m, dev=dev: errors.append(f"{dev} console.{m.type}: {m.text}") if m.type == "error" else None)
                cdp = ctx.new_cdp_session(page)
                if any(d["safe"]):
                    l, t, r, b = d["safe"]
                    try:
                        cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": t, "left": l, "bottom": b, "right": r}})
                    except Exception as e:
                        errors.append(f"{dev} safe-area override unsupported: {e}")
                if args.game:
                    game_device(page, cdp, dev, results, args.base or f"http://localhost:{LAB_PORT}/")
                    ctx.close()
                    continue
                page.goto(args.base or lab_url(None, "hud=mid&touch=1"), wait_until="load")
                wait_ready(page)
                time.sleep(1.0)
                lab_device(page, cdp, dev, results)
                page.goto(args.base or lab_url(None, "touch=1"), wait_until="load")
                wait_ready(page)
                time.sleep(0.6)
                lab_menus_by_tap(page, cdp, dev, results)
                ctx.close()
            browser.close()
    except HarnessError as e:
        print(f"[mobile] HARNESS ERROR: {e}")
        save_report("mobile_game" if args.game else "mobile", {"verdict": "ERROR", "error": str(e), "results": results})
        return 2
    finally:
        if srv:
            srv.__exit__(None, None, None)
    failed = [r for r in results if not r["ok"]]
    verdict = "PASS" if not failed and not errors else "FAIL"
    path = save_report("mobile_game" if args.game else "mobile", {"verdict": verdict, "seconds": round(time.time() - t0, 1), "failed": failed, "errors": errors[:40], "results": results})
    print(f"[mobile] {verdict}: {len(results) - len(failed)}/{len(results)} checks, {len(errors)} page errors -> {os.path.relpath(path, ROOT)}")
    return 0 if verdict == "PASS" else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--devices", default="se,p844,iphone14,pixel7,ipad")
    ap.add_argument("--base", default=None)
    ap.add_argument("--game", action="store_true")
    ap.add_argument("--lab", action="store_true")
    ap.add_argument("--headless", action="store_true", help="(always headless; accepted for the gate table)")
    return run(ap.parse_args())


if __name__ == "__main__":
    sys.exit(main())
