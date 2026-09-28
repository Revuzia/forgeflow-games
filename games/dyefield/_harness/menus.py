#!/usr/bin/env python
"""DYEFIELD — menus gate (CONTRACT_P6_11 §20): a headless, real-input walk through the whole front end.

Real mouse clicks (page.mouse at element centres) and real key presses (page.keyboard) drive:

  1. title / lobby  — the wordmark, the mode line, the five menu labels, the key-hint pills; the live Pier 18
                      backdrop at noon (runners move, the camera drifts); ↑/↓ move the focus.
  2. LOADOUT        — the hint; each of the 4 kit tiles → the profile kit, the mannequin's kit + its aim
                      preview, and the mannequin's pixels change (image diff of its slot); crew GULF CREW → the
                      mannequin's team; a typed name; ESC back.
  3. SETTINGS       — rebind JUMP to F (capture → press F); a conflict (SPECIAL ← E, which is SUB's) shows the
                      SWAP / CANCEL prompt and CANCEL leaves the bindings alone; SHOW FPS on; COLORBLIND MARKS on
                      (html.df-cb, the dye uniform) and off; a volume slider moved by keys.
  4. HOW TO PLAY / CREDITS — 4 panels (the legend shows the new JUMP key); the credits line.
  5. PLAY → map select — each map card (PIER 18 PLAZA / LOCKWELL WORKS / CINDER REEF / RANDOM) selects; the
                      time-of-day row only for Pier 18; bot tiers BREEZE / SWELL / STORM; START on LOCKWELL →
                      loading → countdown → live.
  6. in the match   — the rebound key: F jumps (a 'jump' event for the human), SPACE no longer does; ESC →
                      PAUSED (legend shows F); pause → SETTINGS → back; QUIT MATCH → confirm → QUIT → the lobby
                      (Pier 18 reloaded).
  7. a keyboard-only START — Enter on PLAY, arrows to PIER 18, GOLDEN HOUR, START by Enter; a 25 s match
                      (?matchSeconds) to the victory slate: the coverage tally (bars fill, then the stamp), then
                      LOBBY → the lobby again.
  8. a synthetic gamepad (navigator.getGamepads is replaced — headless Chrome has no virtual pad): d-pad down
                      moves focus, A opens a screen, B backs out.
  9. leaks          — renderer.info geometries / textures after each return to the lobby.
 10. layout         — every screen at 1600×900 and 1280×720: every control inside the viewport and no two
                      controls overlapping; screenshots _shots/menu_*.png (720p ones _shots/menu720_*.png).

Verdict line: MENUS OK / MENUS FAIL (+ problems). Report: _harness/_reports/menus.json.

Run:  python _harness/menus.py            (headless, dev server on :5186 — started with DF_FROZEN=1 if down)
      python _harness/menus.py --headed   (watch it)
      python _harness/menus.py --base http://localhost:5191/
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, Session, add_common_args, build_url, diag_problems, print_diagnostics,  # noqa: E402
                    save_report)

KITS = ["mist-rasp", "sheet-drum", "needle-glint", "pop-well"]
MAPS = ["pier18", "lockwell", "cinder", "random"]
SCREENS = [("loadout", "#dfm-loadout"), ("play", "#dfm-play"), ("settings", "#dfm-settings"),
           ("howto", "#dfm-how-to-play"), ("credits", "#dfm-credits")]
STRINGS = {
    "wordmark": "DYEFIELD", "mode": "Harbor Cup • 4 v 4", "hint": "Pick your kit — crest sits on the right",
    "credits": "An original 4 v 4 turf-paint shooter.", "victory": "THE HARBOR CHOSE A COLOR.",
}
FORBIDDEN = ("CHILL", "FRESH", "FIERCE")


class Run:
    def __init__(self, sess, prefix="menu"):
        self.s = sess
        self.prefix = prefix
        self.problems = []
        self.notes = []
        self.checks = {}
        self.shots = []

    # ── helpers
    def fail(self, msg):
        self.problems.append(msg)
        print("  !! " + msg)

    def ok(self, cond, msg):
        if not cond:
            self.fail(msg)
        return bool(cond)

    def shot(self, name):
        path = os.path.join(SHOTS, "%s_%s.png" % (self.prefix, name))
        if self.s.screenshot(path):
            self.shots.append(os.path.relpath(path, os.path.dirname(SHOTS)).replace("\\", "/"))
        return path

    def box(self, sel, timeout=4000):
        try:
            return self.s.page.locator(sel).first.bounding_box(timeout=timeout)
        except Exception:
            return None

    def click(self, sel, settle=0.35):
        b = self.box(sel)
        if not b:
            self.fail("no clickable %s" % sel)
            return False
        x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        self.s.page.mouse.move(x, y)
        self.s.page.mouse.click(x, y)
        time.sleep(settle)
        return True

    def key(self, k, settle=0.25):
        self.s.page.keyboard.press(k)
        time.sleep(settle)

    def menu(self):
        return self.s.safe_js("() => window.__DF__.menu()", default={}) or {}

    def df(self, m):
        return self.s.safe_js("() => window.__DF__.%s()" % m, default=None)

    def gl(self):
        """renderer.info memory + the JS heap after forced GCs (Chrome runs with --js-flags=--expose-gc)"""
        return self.s.safe_js("""async () => {
          for (let i = 0; i < 3; i++) { if (window.gc) window.gc(); await new Promise((r) => setTimeout(r, 250)); }
          return window.__DF__.gl();
        }""", default=None)

    def phase(self):
        return (self.s.state() or {}).get("phase")

    def wait(self, fn, timeout=20.0, poll=0.15):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return v
            time.sleep(poll)
        return None

    def text(self, sel):
        return self.s.safe_js("(q) => { const e = document.querySelector(q); return e ? e.textContent : null; }", sel)

    def layout(self, where):
        """every visible control inside the viewport; no two controls overlapping (> 4 px each way)"""
        r = self.s.safe_js(r"""() => {
          const W = innerWidth, H = innerHeight;
          const scope = document.querySelector('#df-menus');
          const items = [...document.querySelectorAll('#df-menus [data-nav], #df-menus .df-btn, .df-victory .df-btn')].filter((e) => {
            const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]');
          });
          const rs = items.map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 24), l: r.left, t: r.top, r: r.right, b: r.bottom }; });
          const out = rs.filter((q) => q.l < -1 || q.t < -1 || q.r > W + 1 || q.b > H + 1).map((q) => q.id);
          const over = [];
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i], b = rs[j];
            const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            if (ox > 4 && oy > 4) over.push(a.id + ' × ' + b.id);
          }
          return { n: rs.length, out, over };
        }""", default=None)
        if not r:
            self.fail("%s: layout read-back failed" % where)
            return
        self.ok(not r["out"], "%s: controls outside the viewport: %s" % (where, r["out"][:6]))
        self.ok(not r["over"], "%s: overlapping controls: %s" % (where, r["over"][:6]))
        self.checks.setdefault("layout", {})[where] = r

    def region_diff(self, a_path, b_path, rect):
        try:
            from PIL import Image, ImageChops, ImageStat
            box = (int(rect["x"]), int(rect["y"]), int(rect["x"] + rect["width"]), int(rect["y"] + rect["height"]))
            a = Image.open(a_path).convert("RGB").crop(box)
            b = Image.open(b_path).convert("RGB").crop(box)
            st = ImageStat.Stat(ImageChops.difference(a, b))
            return sum(st.mean) / 3.0
        except Exception as e:
            self.notes.append("image diff unavailable: %s" % e)
            return None


# ───────────────────────────── the flow ─────────────────────────────
def title(run):
    s = run.s
    print("title / lobby")
    m = run.menu()
    run.ok(m.get("screen") == "title", "the lobby did not open on the title (menu %s)" % m)
    wm = run.text("#df-menus .dfm-brand .df-wordmark")
    run.ok(wm == STRINGS["wordmark"], "wordmark %r" % wm)
    mode = run.text("#df-menus .dfm-brand .df-mode")
    run.ok(mode and STRINGS["mode"] in mode, "mode line %r" % mode)
    labels = s.safe_js("() => [...document.querySelectorAll('.dfm-stack .dfm-item .lbl')].map((e) => e.textContent)", default=[])
    run.ok(labels == ["PLAY", "LOADOUT", "SETTINGS", "HOW TO PLAY", "CREDITS"], "menu labels %s" % labels)
    hints = s.safe_js("() => document.querySelector('.dfm-hints').innerText", default="")
    run.ok("ENTER" in (hints or ""), "key-hint pills missing (%r)" % hints)
    ses = run.df("session") or {}
    run.ok(ses.get("mode") == "lobby" and ses.get("map") == "pier18" and ses.get("preset") == "noon",
           "the lobby backdrop is not Pier 18 at noon (%s)" % ses)
    # life: runners move, the camera drifts
    a = run.df("match") or {}
    cam0 = ses.get("cam")
    time.sleep(2.0)
    b = run.df("match") or {}
    cam1 = (run.df("session") or {}).get("cam")
    moved = 0
    for ra, rb in zip(a.get("runners") or [], b.get("runners") or []):
        if abs(ra["x"] - rb["x"]) + abs(ra["z"] - rb["z"]) > 0.5:
            moved += 1
    run.checks["lobbyLife"] = {"runners": len(a.get("runners") or []), "moved": moved, "cam0": cam0, "cam1": cam1,
                              "coverage": b.get("coverage")}
    run.ok(moved >= 2, "the lobby's runners are not moving (%d moved in 2 s)" % moved)
    run.ok(cam0 and cam1 and sum(abs(x - y) for x, y in zip(cam0, cam1)) > 0.2, "the lobby camera is not drifting (%s → %s)" % (cam0, cam1))
    cov = b.get("coverage") or {}
    run.ok((cov.get("sun") or 0) + (cov.get("gulf") or 0) > 0.005, "the lobby runners are not painting (coverage %s)" % cov)
    # keyboard focus
    run.ok(run.menu().get("focus") == "dfm-play", "PLAY is not focused on the title (%s)" % run.menu().get("focus"))
    run.key("ArrowDown")
    f1 = run.menu().get("focus")
    run.key("ArrowUp")
    f2 = run.menu().get("focus")
    run.ok(f1 == "dfm-loadout" and f2 == "dfm-play", "↓/↑ focus went %s → %s" % (f1, f2))
    run.shot("title")
    run.layout("title")


def loadout(run):
    print("LOADOUT")
    run.click("#dfm-loadout", 0.8)
    m = run.menu()
    run.ok(m.get("screen") == "loadout", "LOADOUT did not open (%s)" % m.get("screen"))
    hint = run.text("#df-menus .dfm-s-loadout .dfm-hint")
    run.ok(hint == STRINGS["hint"], "loadout hint %r" % hint)
    slot = run.box("#dfm-mannequin")
    run.ok(slot and slot["width"] > 200 and slot["height"] > 200, "the mannequin slot is missing / tiny (%s)" % slot)
    # the slot must sit on the RIGHT half
    run.ok(slot and slot["x"] + slot["width"] / 2 > run.s.args.width * 0.55, "the mannequin is not on the right (%s)" % slot)
    prev_path = None
    kits = {}
    for k in KITS:
        run.click("#dfm-kit-%s" % k, 0.25)
        m = run.menu()
        mq = m.get("mannequin") or {}
        prof = m.get("profile") or {}
        aim_seen = mq.get("upper") == "aim"
        time.sleep(0.25)
        mq2 = (run.menu().get("mannequin") or {})
        aim_seen = aim_seen or mq2.get("upper") == "aim"
        time.sleep(1.5)                       # the aim preview ends; shoot the idle pose
        path = run.shot("loadout_%s" % k)
        stats = run.s.safe_js("() => [...document.querySelectorAll('.dfm-stat')].map((r) => [r.dataset.stat, r.querySelectorAll('.bar i.on').length])", default=[])
        diff = run.region_diff(prev_path, path, slot) if (prev_path and slot) else None
        kits[k] = {"profileKit": prof.get("kit"), "mannequin": mq2, "aimPreview": aim_seen, "stats": stats, "slotDiff": diff}
        run.ok(prof.get("kit") == k, "kit tile %s → profile kit %s" % (k, prof.get("kit")))
        run.ok(mq2.get("kit") == k and mq2.get("kitAttached"), "the mannequin does not hold %s (%s)" % (k, mq2))
        run.ok(aim_seen, "no aim preview on picking %s (%s)" % (k, mq2))
        run.ok(len(stats) == 5, "%s: %d stat bars (want 5)" % (k, len(stats)))
        if diff is not None:
            run.ok(diff > 1.0, "the mannequin did not change from the previous kit to %s (mean diff %.2f)" % (k, diff))
        prev_path = path
    run.checks["kits"] = kits
    # crew
    run.click("#dfm-crew-gulf", 0.6)
    m = run.menu()
    run.ok((m.get("profile") or {}).get("crew") == 2 and (m.get("mannequin") or {}).get("team") == 2,
           "GULF CREW did not reach the profile / mannequin (%s / %s)" % (m.get("profile"), m.get("mannequin")))
    gpath = run.shot("loadout_gulf")
    if slot and prev_path:
        d = run.region_diff(prev_path, gpath, slot)
        run.checks["crewDiff"] = d
        if d is not None:
            run.ok(d > 1.0, "the mannequin did not recolour for GULF CREW (mean diff %.2f)" % d)
    # (GULF CREW stays picked: both harness matches run with the human on the second crew — the deep-link
    # harnesses cover SUNCREW)
    # name
    run.click("#dfm-name", 0.2)
    run.s.page.keyboard.type("Tester")
    run.key("Enter")
    prof = run.menu().get("profile") or {}
    run.ok(prof.get("name") == "Tester", "typed name → profile %r" % prof.get("name"))
    run.layout("loadout")
    run.key("Escape", 0.5)
    run.ok(run.menu().get("screen") == "title", "ESC did not go back to the title from LOADOUT")
    run.ok(run.text(".dfm-profile b") == "Tester", "the profile card does not show the name (%r)" % run.text(".dfm-profile b"))


def settings(run):
    print("SETTINGS")
    run.click("#dfm-settings", 0.6)
    run.ok(run.menu().get("screen") == "settings", "SETTINGS did not open")
    run.shot("settings")
    run.layout("settings")
    # rebind JUMP → F
    run.click("#dfm-key-jump-0", 0.3)
    run.ok(run.menu().get("capture") == "jump:0", "the key capture did not start (%s)" % run.menu().get("capture"))
    run.key("KeyF", 0.4)
    b = (run.df("settings") or {}).get("bindings") or {}
    run.ok((b.get("jump") or [None])[0] == "KeyF", "JUMP slot 0 is %s after pressing F" % b.get("jump"))
    run.ok(run.text("#dfm-key-jump-0") == "F", "the JUMP key cap shows %r" % run.text("#dfm-key-jump-0"))
    # a conflict: SPECIAL ← E (SUB's key) → SWAP / CANCEL; CANCEL keeps everything
    run.click("#dfm-key-special-0", 0.3)
    run.key("KeyE", 0.4)
    m = run.menu()
    conflict = m.get("conflict") or {}
    run.ok(conflict.get("other") == "sub" and "already on SUB" in (m.get("note") or ""),
           "no conflict prompt for E on SPECIAL (%s / %r)" % (conflict, m.get("note")))
    run.shot("settings_conflict")
    run.click("#dfm-swap-cancel", 0.3)
    b2 = (run.df("settings") or {}).get("bindings") or {}
    run.ok(b2.get("special") == ["KeyQ"] and "KeyE" in (b2.get("sub") or []), "CANCEL changed the bindings (%s / %s)" % (b2.get("special"), b2.get("sub")))
    run.checks["bindings"] = {"jump": b2.get("jump"), "special": b2.get("special"), "sub": b2.get("sub")}
    # SHOW FPS on
    run.click("#dfm-fps", 0.3)
    fps_on = run.s.safe_js("() => { const e = document.querySelector('.df-fps'); return !!e && !e.hidden; }", default=False)
    run.ok((run.df("settings") or {}).get("showFps") is True and fps_on, "SHOW FPS did not turn the FPS pill on")
    # colorblind on (live: html.df-cb, the dye shader uniform, CSS palette) then off
    run.click("#dfm-colorblind", 0.4)
    cb = run.s.safe_js("() => ({ cls: document.documentElement.classList.contains('df-cb'), dye: getComputedStyle(document.documentElement).getPropertyValue('--gulf-dye').trim(), u: (() => { try { return window.__DF__.dev.parts.dye.uColorblind.value; } catch (e) { return null; } })() })", default={})
    run.ok(cb.get("cls") and cb.get("dye", "").lower() == "#1f6bff", "colorblind marks did not apply (%s)" % cb)
    if cb.get("u") is not None:
        run.ok(cb.get("u") == 1, "the dye shader's uColorblind is %s with colorblind on" % cb.get("u"))
    run.checks["colorblind"] = cb
    run.shot("settings_colorblind")
    run.click("#dfm-colorblind", 0.3)
    cb_off = run.s.safe_js("() => document.documentElement.classList.contains('df-cb')", default=True)
    run.ok(not cb_off, "colorblind marks did not switch off")
    # a volume slider by keys (focus it with a click, then ← ×5)
    v0 = ((run.df("settings") or {}).get("volume") or {}).get("music")
    run.click("#dfm-vol-music", 0.2)
    v_click = ((run.df("settings") or {}).get("volume") or {}).get("music")
    for _ in range(5):
        run.key("ArrowLeft", 0.05)
    v1 = ((run.df("settings") or {}).get("volume") or {}).get("music")
    run.checks["volume"] = {"before": v0, "afterClick": v_click, "afterKeys": v1}
    run.ok(isinstance(v1, (int, float)) and isinstance(v_click, (int, float)) and abs((v_click - v1) - 0.05) < 0.011,
           "music volume did not step with ← (%s → %s)" % (v_click, v1))
    run.key("ArrowDown", 0.2)                   # leave the slider before ESC
    run.key("Escape", 0.5)
    run.ok(run.menu().get("screen") == "title", "ESC did not go back from SETTINGS")


def howto_credits(run):
    print("HOW TO PLAY / CREDITS")
    run.click("#dfm-how-to-play", 0.6)
    run.ok(run.menu().get("screen") == "howto", "HOW TO PLAY did not open")
    n = run.s.safe_js("() => document.querySelectorAll('.dfm-s-howto .dfm-howp').length", default=0)
    run.ok(n == 4, "HOW TO PLAY has %s panels (want 4)" % n)
    leg = run.s.safe_js("() => document.querySelector('.dfm-howkeys').innerText", default="") or ""
    run.ok("F" in leg.split() or "F\nJUMP" in leg or "FJUMP" in leg.replace("\n", ""), "the HOW TO PLAY legend does not show the rebound JUMP key F (%r)" % leg[:200])
    run.shot("howto")
    run.layout("howto")
    run.key("Escape", 0.5)
    run.click("#dfm-credits", 0.6)
    run.ok(run.menu().get("screen") == "credits", "CREDITS did not open")
    line = run.text(".dfm-tagline")
    run.ok(line == STRINGS["credits"], "credits line %r" % line)
    audio = run.s.safe_js("() => document.querySelector('.dfm-cgrid .blk:last-child').innerText", default="") or ""
    run.ok("Kenney" in audio or "Music" in audio, "the audio credits are missing (%r)" % audio[:120])
    run.shot("credits")
    run.layout("credits")
    run.key("Escape", 0.5)


def map_select(run):
    print("PLAY → map select")
    run.click("#dfm-play", 0.7)
    run.ok(run.menu().get("screen") == "play", "PLAY did not open the map select")
    thumbs = run.s.safe_js("() => [...document.querySelectorAll('.dfm-map .thumb img')].map((i) => i.complete && i.naturalWidth > 0)", default=[])
    run.ok(len(thumbs) == 3 and all(thumbs), "map thumbnails not loaded (%s)" % thumbs)
    tiers = run.s.safe_js("() => [...document.querySelectorAll('[data-skill]')].map((b) => b.textContent)", default=[])
    run.ok(tiers == ["BREEZE", "SWELL", "STORM"], "bot tiers %s" % tiers)
    body = run.s.safe_js("() => document.querySelector('#df-menus').innerText.toUpperCase()", default="") or ""
    run.ok(not any(w in body.split() for w in FORBIDDEN), "a source-clip tier label is on screen")
    for mp in MAPS:
        run.click("#dfm-map-%s" % mp, 0.35)
        prof = run.menu().get("profile") or {}
        run.ok(prof.get("map") == mp, "map card %s → profile map %s" % (mp, prof.get("map")))
        tod = run.s.safe_js("() => !document.querySelector('.dfm-s-play .dfm-seg').closest('[hidden]') && !document.querySelector('.dfm-s-play .dfm-seg').hidden", default=None)
        run.ok(bool(tod) == (mp == "pier18"), "time-of-day row visible=%s on %s" % (tod, mp))
        run.shot("play_%s" % mp)
    run.layout("play")
    run.click("#dfm-skill-storm", 0.2)
    run.click("#dfm-skill-swell", 0.2)
    run.ok((run.menu().get("profile") or {}).get("skill") == "swell", "bot tier buttons did not set the skill")


def match_lockwell(run):
    print("START → LOCKWELL → pause → quit")
    s = run.s
    run.click("#dfm-map-lockwell", 0.3)
    t0 = time.time()
    run.click("#dfm-start", 0.05)
    time.sleep(0.5)
    run.shot("loading")
    ph = run.wait(lambda: run.phase() if run.phase() in ("ready", "play", "error") else None, 60)
    load_s = time.time() - t0
    ses = run.df("session") or {}
    run.checks["start1"] = {"phase": ph, "seconds": round(load_s, 2), "session": ses, "state": {k: (s.state() or {}).get(k) for k in ("startedBy", "pointerLocked")}}
    run.ok(ph in ("ready", "play"), "START did not reach the match (phase %s: %s)" % (ph, (s.state() or {}).get("error")))
    run.ok(ses.get("map") == "lockwell" and ses.get("mode") == "match", "the match is not on LOCKWELL (%s)" % ses)
    me = ((run.df("match") or {}).get("runners") or [{}])[0]
    run.ok(me.get("team") == 2 and me.get("name") == "Tester" and me.get("kit") == KITS[-1],
           "the human is not the LOADOUT pick (team %s, name %s, kit %s)" % (me.get("team"), me.get("name"), me.get("kit")))
    if ph == "ready":
        run.notes.append("START: pointer lock not held after loading → CLICK TO PLAY (clicked)")
        run.click("#df-play", 1.0)
    cd = run.wait(lambda: (run.df("match") or {}).get("phase") == "countdown" or None, 6)
    run.ok(cd or (run.df("match") or {}).get("phase") == "live", "no countdown after START")
    live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 8)
    run.ok(live, "the match did not go live")
    time.sleep(0.5)
    run.shot("match_live")
    # the rebound JUMP key works in the match: F jumps, SPACE no longer does
    def jumps():
        ev = s.safe_js("() => window.__DF__.events(500)", default=[]) or []
        return len([e for e in ev if e.get("t") == "jump" and e.get("pid") == 0])
    j0 = jumps()
    s.page.keyboard.down("f"); time.sleep(0.12); s.page.keyboard.up("f")
    time.sleep(1.4)
    j1 = jumps()
    s.page.keyboard.down("Space"); time.sleep(0.12); s.page.keyboard.up("Space")
    time.sleep(1.0)
    j2 = jumps()
    run.checks["rebind"] = {"before": j0, "afterF": j1, "afterSpace": j2}
    run.ok(j1 == j0 + 1, "the rebound F did not jump (%d → %d)" % (j0, j1))
    run.ok(j2 == j1, "SPACE still jumps after the rebind (%d → %d)" % (j1, j2))
    # pause
    run.key("Escape", 0.6)
    ph = run.phase()
    m = run.menu()
    run.ok(ph == "paused" and m.get("screen") == "pause", "ESC did not pause (phase %s, screen %s)" % (ph, m.get("screen")))
    title = run.text(".dfm-s-pause h2")
    run.ok(title == "PAUSED", "pause title %r" % title)
    pl = [t.strip() for t in (s.safe_js("() => [...document.querySelectorAll('.dfm-pause-l button')].map((b) => b.innerText)", default=[]) or [])]
    run.ok(pl[:1] == ["RESUME"] and any("SETTINGS" in x for x in pl) and any("HOW TO PLAY" in x for x in pl) and any("QUIT MATCH" in x for x in pl),
           "pause buttons %s" % pl)
    legend = s.safe_js("() => document.querySelector('.dfm-legend').innerText", default="") or ""
    run.ok("JUMP" in legend and "\nF" in "\n" + legend.replace("\t", "\n"), "the pause legend does not show F for JUMP (%r)" % legend[:160])
    run.shot("pause")
    run.layout("pause")
    run.click("#df-p-settings", 0.5)
    run.ok(run.menu().get("screen") == "settings" and run.menu().get("context") == "pause", "pause → SETTINGS failed (%s)" % run.menu().get("screen"))
    run.key("Escape", 0.5)
    run.ok(run.menu().get("screen") == "pause", "ESC from pause SETTINGS did not return to the pause card")
    run.click("#df-p-quit", 0.4)
    run.ok(run.menu().get("confirm") is True, "QUIT MATCH did not ask to confirm")
    run.shot("quit_confirm")
    run.click("#dfm-quit-yes", 0.2)
    ph = run.wait(lambda: run.phase() if run.phase() in ("menu", "error") else None, 60)
    ses = run.df("session") or {}
    run.ok(ph == "menu" and ses.get("mode") == "lobby" and ses.get("map") == "pier18", "QUIT did not return to the Pier 18 lobby (%s / %s)" % (ph, ses))
    run.ok(run.menu().get("screen") == "title", "the lobby did not show the title after QUIT")
    time.sleep(1.0)
    run.shot("lobby_return")
    return run.gl()


def match_keyboard(run):
    print("keyboard-only START → PIER 18 golden → victory tally → LOBBY")
    s = run.s
    run.ok(run.menu().get("focus") == "dfm-play", "title focus %s (want PLAY)" % run.menu().get("focus"))
    run.key("Enter", 0.7)
    run.ok(run.menu().get("screen") == "play", "Enter on PLAY did not open the map select")
    path = []
    # up to the map row, then left to PIER 18
    run.key("ArrowUp")
    path.append(run.menu().get("focus"))
    for _ in range(4):
        if run.menu().get("focus") == "dfm-map-pier18":
            break
        run.key("ArrowLeft")
        path.append(run.menu().get("focus"))
    run.key("Enter")
    run.ok((run.menu().get("profile") or {}).get("map") == "pier18", "keyboard map select failed (path %s, map %s)" % (path, (run.menu().get("profile") or {}).get("map")))
    run.key("ArrowDown")
    path.append(run.menu().get("focus"))
    for _ in range(3):
        if run.menu().get("focus") == "dfm-preset-golden":
            break
        run.key("ArrowRight")
        path.append(run.menu().get("focus"))
    run.key("Enter")
    run.ok((run.menu().get("profile") or {}).get("preset") == "golden", "keyboard GOLDEN HOUR failed (path %s)" % path)
    for _ in range(8):
        if run.menu().get("focus") == "dfm-start":
            break
        run.key("ArrowRight")
        path.append(run.menu().get("focus"))
    run.checks["keyboardPath"] = path
    run.ok(run.menu().get("focus") == "dfm-start", "→ never reached START (path %s)" % path)
    run.key("Enter", 0.05)
    ph = run.wait(lambda: run.phase() if run.phase() in ("ready", "play", "error") else None, 60)
    ses = run.df("session") or {}
    run.checks["start2"] = {"phase": ph, "session": ses}
    run.ok(ses.get("map") == "pier18" and ses.get("preset") == "golden", "the match is not Pier 18 golden (%s)" % ses)
    if ph == "ready":
        run.click("#df-play", 1.0)
    live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 10)
    run.ok(live, "match 2 did not go live")
    run.shot("match_golden")
    # victory: the 25 s clock runs out
    vic = run.wait(lambda: (run.df("match") or {}).get("victoryShown") or None, 60, 0.1)
    run.ok(vic, "no victory slate")
    time.sleep(0.75)
    h1 = run.df("hud") or {}
    run.shot("victory_tally")
    time.sleep(1.6)
    h2 = run.df("hud") or {}
    run.shot("victory")
    t1, t2 = h1.get("tally") or {}, h2.get("tally") or {}
    run.checks["tally"] = {"mid": t1, "end": t2, "victory": (h2.get("victory") or "")[:200]}
    run.ok(STRINGS["victory"] in (h2.get("victory") or ""), "victory line missing (%r)" % h2.get("victory"))
    run.ok(t1 and not t1.get("stamped") and t2.get("stamped"), "the tally did not fill then stamp (mid %s, end %s)" % (t1, t2))
    run.ok(t1.get("sun") != t2.get("sun") or t1.get("gulf") != t2.get("gulf"), "the tally numbers did not count up (%s → %s)" % (t1, t2))
    btns = s.safe_js("() => [...document.querySelectorAll('.df-victory .df-btn')].filter((b) => !b.hidden).map((b) => b.textContent)", default=[])
    run.ok(btns == ["PLAY AGAIN", "LOBBY"], "victory buttons %s" % btns)
    run.layout("victory")
    # keyboard on the slate: PLAY AGAIN has focus; → moves to LOBBY; Enter takes it
    active = lambda: s.safe_js("() => document.activeElement && document.activeElement.id", default=None)
    f0 = active()
    run.key("ArrowRight", 0.3)
    f1 = active()
    run.checks["victoryKeys"] = [f0, f1]
    run.ok(f0 == "df-again" and f1 == "df-lobby", "victory slate focus %s → %s (want df-again → df-lobby)" % (f0, f1))
    if f1 == "df-lobby":
        run.key("Enter", 0.2)
    else:
        run.click("#df-lobby", 0.2)
    ph = run.wait(lambda: run.phase() if run.phase() in ("menu", "error") else None, 60)
    ses = run.df("session") or {}
    run.ok(ph == "menu" and ses.get("key") == "pier18:noon", "LOBBY did not return to the noon lobby (%s / %s)" % (ph, ses))
    time.sleep(1.0)
    return run.gl()


def gamepad(run):
    print("synthetic gamepad")
    s = run.s
    s.js("""() => {
      const pad = { id: 'harness pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.__PADX__ = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
    }""")
    def press(i, hold=0.12):
        s.js("(i) => { const b = window.__PADX__.buttons[i]; b.pressed = true; b.value = 1; }", i)
        time.sleep(hold)
        s.js("(i) => { const b = window.__PADX__.buttons[i]; b.pressed = false; b.value = 0; }", i)
        time.sleep(0.15)
    f0 = run.menu().get("focus")
    press(13)                   # d-pad down
    f1 = run.menu().get("focus")
    press(0)                    # A
    scr = run.menu().get("screen")
    press(1)                    # B
    scr2 = run.menu().get("screen")
    run.checks["gamepad"] = {"focus": [f0, f1], "afterA": scr, "afterB": scr2, "hintPad": run.menu().get("gamepad")}
    run.ok(f1 != f0 and f1 == "dfm-loadout", "pad d-pad down did not move focus (%s → %s)" % (f0, f1))
    run.ok(scr == "loadout", "pad A did not open LOADOUT (%s)" % scr)
    run.ok(scr2 == "title", "pad B did not go back (%s)" % scr2)
    s.js("() => { delete navigator.getGamepads; }")


def small_screens(args, all_problems, shots):
    print("1280x720 layout pass")
    a2 = argparse.Namespace(**vars(args))
    a2.width, a2.height = 1280, 720
    with Session(a2, "menus720") as s:
        run = Run(s, "menu720")
        s.goto(build_url(args.base, lobby=1, dev=1))
        ok, ph = s.wait_phase(("menu",), 120)
        if not ok:
            run.fail("720p: lobby never came up (%s)" % ph)
        else:
            time.sleep(1.0)
            run.shot("title")
            run.layout("720 title")
            for name, sel in SCREENS:
                run.click(sel, 0.8)
                run.shot(name)
                run.layout("720 " + name)
                run.key("Escape", 0.4)
        all_problems.extend(run.problems)
        shots.extend(run.shots)
        d = s.diagnostics()
        all_problems.extend("720p: " + p for p in diag_problems(d))
        return run.checks


def main():
    ap = add_common_args(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--headed", action="store_true", help="show the browser (default headless)")
    ap.add_argument("--match-seconds", type=int, default=25, help="dev match length for the victory leg")
    ap.add_argument("--skip-720", action="store_true")
    args = ap.parse_args()
    args.headless = not args.headed
    args.chrome_arg = list(args.chrome_arg or []) + ["--js-flags=--expose-gc"]     # the leak check forces GC
    args.width, args.height = (args.width if args.width != 1280 else 1600), (args.height if args.height != 720 else 900)
    t_start = time.time()
    report = {"base": args.base, "viewport": [args.width, args.height], "headless": args.headless}
    problems, shots = [], []
    gl = {}
    with Session(args, "menus") as s:
        run = Run(s, "menu")
        url = build_url(args.base, lobby=1, dev=1, matchSeconds=args.match_seconds)
        print("open %s" % url)
        s.goto(url)
        if not s.wait_df(90):
            problems.append("__DF__ never appeared")
        ok, ph = s.wait_phase(("menu",), 150)
        if not ok:
            problems.append("the lobby never came up (phase %s: %s)" % (ph, str((s.state() or {}).get("error"))[:400]))
        else:
            time.sleep(1.2)
            steps = [("title", title), ("loadout", loadout), ("settings", settings), ("howto_credits", howto_credits),
                     ("map_select", map_select)]
            for name, fn in steps:
                try:
                    fn(run)
                except Exception as e:
                    run.fail("%s: harness error %s" % (name, str(e).splitlines()[0][:300]))
            gl["lobby0"] = run.gl()            # after every lobby screen (the mannequin's textures are in)
            try:
                gl["lobby1"] = match_lockwell(run)
            except Exception as e:
                run.fail("match 1: harness error %s" % str(e).splitlines()[0][:300])
            try:
                gl["lobby2"] = match_keyboard(run)
            except Exception as e:
                run.fail("match 2: harness error %s" % str(e).splitlines()[0][:300])
            try:
                gamepad(run)
            except Exception as e:
                run.fail("gamepad: harness error %s" % str(e).splitlines()[0][:300])
        d = s.diagnostics()
        print_diagnostics(d)
        problems.extend(run.problems)
        problems.extend(diag_problems(d))
        shots.extend(run.shots)
        report.update(checks=run.checks, notes=run.notes, diagnostics=d)
    # leaks across sessions: the same lobby state after each return
    g0, g1, g2 = gl.get("lobby0") or {}, gl.get("lobby1") or {}, gl.get("lobby2") or {}
    report["gl"] = gl
    for (na, ga), (nb, gb) in ((("before the matches", g0), ("after match 1", g1)), (("after match 1", g1), ("after match 2", g2))):
        if not ga or not gb:
            continue
        for k in ("geometries", "textures"):
            a, b = ga.get(k) or 0, gb.get(k) or 0
            if a and abs(b - a) > max(3, 0.05 * a):
                problems.append("renderer.info %s drifted in the lobby %s → %s: %d → %d" % (k, na, nb, a, b))
        ha, hb = ga.get("heapMB"), gb.get("heapMB")
        if isinstance(ha, (int, float)) and isinstance(hb, (int, float)) and hb > ha * 1.15 + 5:
            problems.append("JS heap (after GC) grew in the lobby %s → %s: %s → %s MB" % (na, nb, ha, hb))
    if not args.skip_720:
        try:
            report["checks720"] = small_screens(args, problems, shots)
        except Exception as e:
            problems.append("720p pass: harness error %s" % str(e).splitlines()[0][:300])
    report["problems"] = problems
    report["shots"] = shots
    report["seconds"] = round(time.time() - t_start, 1)
    verdict = "MENUS OK" if not problems else "MENUS FAIL"
    report["verdict"] = verdict
    path = save_report("menus", report, args.base)
    print("\nleaks (renderer.info at lobby: boot / after match 1 / after match 2): %s" % json.dumps(gl))
    print("screenshots: %d in _shots/ (menu_*.png, menu720_*.png)" % len(shots))
    print("report: %s" % path)
    if problems:
        print("\n%s — %d problem(s):" % (verdict, len(problems)))
        for p in problems:
            print("  - " + p)
    else:
        print("\n" + verdict)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
