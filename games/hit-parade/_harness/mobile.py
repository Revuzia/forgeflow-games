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
--game (integration): the shell's ?touch=1&mode=versus&p1=johnny&p2=bruno&cpu2=1&autostart=1&dev=1 deep link: the stick
walks P1 (x changes >= 0.3 m), an L tap produces a HIT or WHIFF event, PAUSE -> card -> RESUME, portrait -> rotate overlay.
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
from menus import LabServer, HarnessError, lab_url, save_report, shot, wait_ready, ROOT, INIT_JS, READ_MENUS, READ_TOUCH  # noqa: E402
from layoutcheck import DEVICES, check_page  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

BIT = {"UP": 1, "DOWN": 2, "LEFT": 4, "RIGHT": 8, "L": 16, "M": 32, "H": 64, "S": 128, "ASSIST": 256, "THROW": 512, "PARRY": 1024, "IMPACT": 2048}
BTN_BITS = {"l": BIT["L"], "m": BIT["M"], "h": BIT["H"], "s": BIT["S"], "parry": BIT["PARRY"], "impact": BIT["IMPACT"], "throw": BIT["THROW"]}
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
        self.pts.pop(i, None)
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": x, "y": y, "id": j} for j, (x, y) in self.pts.items()]})

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
        R.ok(f"tap_{bid}", w & 0xFFF == bit, f"word={names(w)}")
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
    T.up(3); T.up(2); T.up(1)
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
                    raise HarnessError("--game: the touch bout runs once the shell wires TouchControls + __HP__.touch() (integration)")
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
        save_report("mobile", {"verdict": "ERROR", "error": str(e), "results": results})
        return 2
    finally:
        if srv:
            srv.__exit__(None, None, None)
    failed = [r for r in results if not r["ok"]]
    verdict = "PASS" if not failed and not errors else "FAIL"
    path = save_report("mobile", {"verdict": verdict, "seconds": round(time.time() - t0, 1), "failed": failed, "errors": errors[:40], "results": results})
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
