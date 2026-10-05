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

FREE-FOR-ALL (CONTRACT_FFA F3, lane UI), all by real clicks / keys:
 11. PLAY → MODE      — FREE-FOR-ALL selects (aria-checked, the profile, localStorage); the title mode line keeps
                      naming both modes ('Harbor Cup • 4 v 4 · Free-for-all') and the profile card says FREE-FOR-ALL;
                      a match's loading card names its mode exactly ('Harbor Cup • 4 v 4' / 'Harbor Cup • Free-for-all');
                      LOADOUT swaps the crew toggle for the 8-colour pick (chip + mark): VIOLET → the profile + the
                      mannequin's team + its pixels; TEAMS restores the crew row with GULF CREW still picked.
 12. an FFA match     — PLAY → FREE-FOR-ALL → CINDER REEF → START: 8 crews, the human on the picked colour, the FFA HUD;
                      the 25 s clock → the FFA victory slate (winner, podium, 8 standings, the stamp; the stinger by
                      whether the human won) → LOBBY. Leaks are compared after this match too.
 13. 720p             — the FFA PLAY / title / LOADOUT screens and a deep-link FFA victory slate (dev setTimeLeft) are
                      layout-checked at 1280×720. Shots _shots/ffa_ui_menu_*.png / ffa_ui_menu720_*.png.
 14. review F1        — FFA on PIER 18 at NOON (the lobby's arena, kept on QUIT): pause → SETTINGS → COLORBLIND MARKS on
                      → QUIT → the lobby: the A/B team pads' accent (their dfPadTeam uniform) = the page's team dye
                      (--sun-dye / --gulf-dye); then COLORBLIND off from the title → they follow again.

WASHOUT + CONTROLS (CONTRACT_WASHOUT W4 / W8, CONTRACT_CONTROLS C1 / C4), all by real clicks / keys:
 15. PLAY → RULE      — TURF (the default, "Cover the most floor") / WASHOUT ("Most washes wins"): aria-checked, the
                      profile + localStorage, the line under the pair; the title mode line names every option
                      ('Harbor Cup • 4 v 4 · Free-for-all · Washout', also the page title); the profile card reads
                      'TEAMS · WASHOUT' / 'FREE-FOR-ALL · WASHOUT' (TURF: the crew name / FREE-FOR-ALL as before); HOW TO
                      PLAY panel 1 carries the WASHOUT rule text; back to TURF restores every TURF line.
 16. a WASHOUT START  — PLAY → WASHOUT → START on LOCKWELL: the loading card reads 'Harbor Cup • Washout · 4 v 4', the HUD
                      is the WASHOUT one; pause → QUIT → the lobby; RULE back to TURF.
 17. SETTINGS → AIM   — AIM is in the remap list (RMB), SUB is E only; AIM SENSITIVITY (0.65×) and TOGGLE AIM switch.
 18. old bindings     — a pre-1.4 save (SUB = E + RMB, no AIM) loads as SUB = E, AIM = RMB; a customised SUB keeps RMB and
                      AIM stays unbound (RMB was not free).
The TURF legs above are unchanged; their mode-line expectation is the both-modes line with Washout (W4).

Verdict line: MENUS OK / MENUS FAIL (+ problems). Report: _harness/_reports/menus.json.

Run:  python _harness/menus.py            (headless, dev server on :5186 — started with DF_FROZEN=1 if down)
      python _harness/menus.py --headed   (watch it)
      python _harness/menus.py --base http://localhost:5191/
      python _harness/menus.py --legs ffa_pier18_cb --skip-720   (one leg; names in --help)
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
    "credits": "An original 4 v 4 and free-for-all turf-paint shooter.", "victory": "THE HARBOR CHOSE A COLOR.",
    "modeFfa": "Harbor Cup • Free-for-all", "teams": "TEAMS · 4 v 4", "ffa": "FREE-FOR-ALL",
    # owner 2026-09-28: where no mode is committed (title, lobby card, bare-URL static card) the line names BOTH modes;
    # a match's loading card names that match's mode ("mode" / "modeFfa" exactly). CHANGED(WASHOUT) W4: it names the
    # WASHOUT rule too
    "modeAll": "Harbor Cup • 4 v 4 · Free-for-all · Washout",
    # CONTRACT_WASHOUT W4: the WASHOUT match lines, the RULE selector, the profile card, HOW TO PLAY
    "modeWashout": "Harbor Cup • Washout · 4 v 4", "modeFfaWashout": "Harbor Cup • Washout · Free-for-all",
    "turf": "TURF", "washout": "WASHOUT", "turfLine": "Cover the most floor", "washoutLine": "Most washes wins",
    "cardWashout": "TEAMS · WASHOUT", "cardFfaWashout": "FREE-FOR-ALL · WASHOUT",
    "howTurf": "Dye the court in your crew’s color. When the final horn sounds, the crew with more turf wins.",
    "howWashout": "Washout: wash the other side. Most washes when the horn sounds — or the first to the limit — wins. Paint still moves you, refills you and charges your special.",
}
BOOT_MODE_JS = "() => { const c = document.querySelector('#df-boot'); const s = c && c.querySelector('.df-mode span'); return s && c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== 'none' ? s.textContent : null; }"


def loading_line(run, want, label):
    """the mode line on the loading card right after START (the match being loaded names its mode). The card can be
    gone already on a fast load: that is recorded, not failed."""
    got = None
    t_end = time.time() + 1.5
    while time.time() < t_end and got is None:
        got = run.s.safe_js(BOOT_MODE_JS, default=None)
        if got is None:
            time.sleep(0.05)
    run.checks.setdefault("loadingLine", {})[label] = got
    if got is None:
        run.notes.append("%s: the loading card was already gone when read (fast load) — mode line not checked" % label)
    else:
        run.ok(got == want, "%s: the loading card reads %r (want exactly %r)" % (label, got, want))
FFA_COLORS = ["amber", "violet", "lime", "magenta", "sky", "coral", "sunflower", "jade"]
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
        # CONTRACT_FFA F3: the FFA legs' shots are _shots/ffa_ui_<prefix>_<name>.png
        fname = ("ffa_ui_%s_%s.png" % (self.prefix, name[4:])) if name.startswith("ffa_") else ("%s_%s.png" % (self.prefix, name))
        path = os.path.join(SHOTS, fname)
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
    mode = run.text("#df-menus .dfm-brand .df-mode span")
    run.ok(mode == STRINGS["modeAll"], "title mode line %r (want exactly %r: both modes)" % (mode, STRINGS["modeAll"]))
    boot_title = s.safe_js("() => document.title", default="")
    run.ok("Free-for-all" in (boot_title or "") and "4 v 4" in (boot_title or "") and "Washout" in (boot_title or ""),
           "the page title %r does not name both modes and the WASHOUT rule" % boot_title)
    labels = s.safe_js("() => [...document.querySelectorAll('.dfm-stack .dfm-item .lbl')].map((e) => e.textContent)", default=[])
    run.ok(labels == ["PLAY", "PLAY ONLINE", "LOADOUT", "SETTINGS", "HOW TO PLAY", "CREDITS"], "menu labels %s" % labels)  # CHANGED(ONLINE) CONTRACT_ONLINE §O4.1: the PLAY ONLINE tile beside PLAY
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
    # CONTRACT_CONTROLS C1 / C4: AIM in the remap list on RMB, SUB on E only; AIM SENSITIVITY + TOGGLE AIM in the MOUSE card
    remap = run.s.safe_js("() => [...document.querySelectorAll('.dfm-keys .dfm-bind .lbl')].map((e) => e.textContent)", default=[]) or []
    aim_cap, sub_caps = run.text("#dfm-key-aim-0"), [run.text("#dfm-key-sub-0"), run.text("#dfm-key-sub-1")]
    run.checks["aimRemap"] = {"rows": remap, "aim": aim_cap, "sub": sub_caps, "bindings": {"aim": b2.get("aim"), "sub": b2.get("sub")}}
    run.ok("AIM" in remap and remap.index("AIM") == remap.index("FIRE") + 1, "AIM is not in the remap list after FIRE (%s)" % remap)
    run.ok(aim_cap == "RMB" and b2.get("aim") == ["Mouse2"], "the AIM key cap / binding is %r / %s (want RMB / Mouse2)" % (aim_cap, b2.get("aim")))
    run.ok(b2.get("sub") == ["KeyE"] and sub_caps[0] == "E", "SUB is %s / caps %s (want E only)" % (b2.get("sub"), sub_caps))
    sens = run.text("#dfm-aim-sens + output") or run.s.safe_js("() => { const r = document.getElementById('dfm-aim-sens'); return r ? r.parentElement.querySelector('output').textContent : null; }")
    run.ok(sens == "0.65×", "AIM SENSITIVITY reads %r (want 0.65×)" % sens)
    t0 = (run.df("settings") or {}).get("aimToggle")
    run.click("#dfm-aim-toggle", 0.3)
    t1 = (run.df("settings") or {}).get("aimToggle")
    run.click("#dfm-aim-toggle", 0.3)
    t2 = (run.df("settings") or {}).get("aimToggle")
    run.checks["aimSettings"] = {"sens": sens, "toggle": [t0, t1, t2]}
    run.ok(t0 is False and t1 is True and t2 is False, "TOGGLE AIM did not switch hold → toggle → hold (%s)" % [t0, t1, t2])
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
    # CONTRACT_CONTROLS C1: the controls legend reads RMB AIM · E JELLY CHARGE (and the mouse LOOKs)
    flat = " ".join(leg.split())
    run.checks["howLegend"] = flat
    run.ok("RMB AIM" in flat and "E JELLY CHARGE" in flat and "MOUSE LOOK" in flat, "the HOW TO PLAY legend lacks RMB AIM / E JELLY CHARGE / MOUSE LOOK (%r)" % flat[:220])
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
    loading_line(run, STRINGS["mode"], "teams START (LOCKWELL)")
    time.sleep(0.2)
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
    # review fix A-A8: a TURF countdown is the brief's — no objective line under the digits
    if cd:
        h_cd = run.df("hud") or {}
        run.checks["turfCountRule"] = {"countdown": h_cd.get("countdown"), "countRule": h_cd.get("countRule")}
        run.ok(h_cd.get("countRule") is None, "the TURF countdown shows a rule line %r (TURF must stay unchanged)" % h_cd.get("countRule"))
    # 20 s, not 8: the sim runs at most MAX_STEPS_PER_FRAME (5) ticks a frame, so below 12 fps the 3 s countdown takes
    # longer than 3 s of wall time (QA 2026-09-28: 9 FPS on the contended iGPU, live came just after an 8 s wait)
    live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 20)
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


def ffa_menus(run):
    """CONTRACT_FFA F3: the PLAY mode selector (persisted), the title mode line per mode, the LOADOUT colour pick.
    Starts and ends on the PLAY screen in TEAMS mode (the LOCKWELL match leg follows)."""
    print("FFA: PLAY mode selector + LOADOUT colour pick")
    s = run.s
    if run.menu().get("screen") != "play":
        run.click("#dfm-play", 0.7)
    labels = s.safe_js("() => [...document.querySelectorAll('.dfm-modebtn')].map((b) => b.textContent)", default=[])
    run.ok(labels == [STRINGS["teams"], STRINGS["ffa"]], "mode selector labels %s" % labels)
    run.ok((run.menu().get("profile") or {}).get("mode") == "teams", "the default mode is not TEAMS (%s)" % run.menu().get("profile"))
    run.click("#dfm-mode-ffa", 0.4)
    prof = run.menu().get("profile") or {}
    checked = s.safe_js("() => document.querySelector('#dfm-mode-ffa').getAttribute('aria-checked')", default=None)
    saved = s.safe_js("() => { try { return JSON.parse(localStorage.getItem('dyefield.profile.v1') || '{}'); } catch (e) { return null; } }", default=None) or {}
    run.checks["ffaMode"] = {"profile": prof, "ariaChecked": checked, "saved": {k: saved.get(k) for k in ("mode", "ffaColor")}}
    run.ok(prof.get("mode") == "ffa" and checked == "true", "FREE-FOR-ALL did not select (profile %s, aria %s)" % (prof, checked))
    run.ok(saved.get("mode") == "ffa", "the FFA mode was not persisted (localStorage %s)" % saved)
    run.shot("ffa_play")
    run.layout("ffa play")
    run.key("Escape", 0.5)
    line = run.text("#df-menus .dfm-brand .df-mode span")
    card = run.text(".dfm-profile .txt span")
    run.checks["ffaTitle"] = {"modeLine": line, "profileCard": card}
    run.ok(line == STRINGS["modeAll"], "FFA picked: the title mode line %r (want exactly %r: still both modes)" % (line, STRINGS["modeAll"]))
    run.ok(card == STRINGS["ffa"], "the FFA profile card reads %r" % card)
    run.shot("ffa_title")
    run.layout("ffa title")
    # LOADOUT: the 8-colour pick replaces the crew toggle
    run.click("#dfm-loadout", 0.8)
    slot = run.box("#dfm-mannequin")
    vis = s.safe_js("""() => ({ colors: [...document.querySelectorAll('.dfm-color')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('[hidden]')).map((b) => [b.id, b.textContent]),
      crewRow: !!document.querySelector('#dfm-crew-sun') && !document.querySelector('#dfm-crew-sun').closest('[hidden]'),
      cap: document.querySelector('.dfm-crew .dfm-cap').textContent })""", default={}) or {}
    run.ok(len(vis.get("colors") or []) == 8 and len({t for _, t in vis.get("colors") or []}) == 8, "the FFA colour pick shows %s (want 8 chips, 8 marks)" % vis.get("colors"))
    run.ok(not vis.get("crewRow"), "the crew toggle is still visible in FFA")
    run.ok((vis.get("cap") or "").startswith("COLOR"), "the FFA colour caption reads %r" % vis.get("cap"))
    a_path = run.shot("ffa_loadout_amber")
    run.click("#dfm-color-violet", 0.7)
    m = run.menu()
    prof, mq = m.get("profile") or {}, m.get("mannequin") or {}
    run.ok(prof.get("ffaColor") == 2 and mq.get("team") == 2, "VIOLET did not reach the profile / mannequin (%s / %s)" % (prof.get("ffaColor"), mq))
    time.sleep(0.4)
    v_path = run.shot("ffa_loadout")
    d = run.region_diff(a_path, v_path, slot) if slot else None
    run.checks["ffaLoadout"] = {"visible": vis, "profile": {k: prof.get(k) for k in ("mode", "ffaColor", "crew")}, "mannequin": mq, "recolourDiff": d}
    if d is not None:
        run.ok(d > 1.0, "the mannequin did not recolour for VIOLET (mean diff %.2f)" % d)
    run.layout("ffa loadout")
    run.key("Escape", 0.5)
    # back to TEAMS: the exact teams line, the crew row, GULF CREW still picked (the LOCKWELL leg needs it)
    run.click("#dfm-play", 0.7)
    run.click("#dfm-mode-teams", 0.4)
    run.key("Escape", 0.5)
    line = run.text("#df-menus .dfm-brand .df-mode span")
    prof = run.menu().get("profile") or {}
    run.checks["ffaBackToTeams"] = {"modeLine": line, "profile": prof, "mannequin": run.menu().get("mannequin")}
    run.ok(line == STRINGS["modeAll"], "the title mode line reads %r after TEAMS (want exactly %r)" % (line, STRINGS["modeAll"]))
    run.ok(prof.get("mode") == "teams" and prof.get("crew") == 2 and (run.menu().get("mannequin") or {}).get("team") == 2,
           "TEAMS did not restore the crew pick (%s)" % prof)
    run.click("#dfm-play", 0.7)


def rule_menus(run):
    """CONTRACT_WASHOUT W4 / W8: the PLAY RULE selector (aria-checked, persisted, its line), the title mode line, the profile
    card and HOW TO PLAY per rule. Starts and ends on the PLAY screen in TEAMS · TURF (the LOCKWELL match leg follows)."""
    print("WASHOUT: PLAY rule selector + mode lines + profile card + HOW TO PLAY")
    s = run.s
    if run.menu().get("screen") != "play":
        run.click("#dfm-play", 0.7)
    rules = s.safe_js("() => [...document.querySelectorAll('.dfm-rulebtn')].map((b) => [b.id, b.textContent, b.getAttribute('aria-checked'), b.title])", default=[]) or []
    note0 = run.text("#dfm-rule-note")
    prof0 = run.menu().get("profile") or {}
    run.checks["ruleSelector"] = {"buttons": rules, "note": note0, "profileRule": prof0.get("rule")}
    run.ok([r[1] for r in rules] == [STRINGS["turf"], STRINGS["washout"]], "RULE selector labels %s" % [r[1] for r in rules])
    run.ok([r[3] for r in rules] == [STRINGS["turfLine"], STRINGS["washoutLine"]], "RULE descriptions %s" % [r[3] for r in rules])
    run.ok(prof0.get("rule") == "turf" and [r[2] for r in rules] == ["true", "false"], "the default rule is not TURF (profile %s, aria %s)" % (prof0.get("rule"), [r[2] for r in rules]))
    run.ok(note0 == STRINGS["turfLine"], "the TURF line reads %r" % note0)
    run.click("#dfm-rule-washout", 0.4)
    prof = run.menu().get("profile") or {}
    checked = s.safe_js("() => [document.querySelector('#dfm-rule-turf').getAttribute('aria-checked'), document.querySelector('#dfm-rule-washout').getAttribute('aria-checked')]", default=None)
    saved = s.safe_js("() => { try { return JSON.parse(localStorage.getItem('dyefield.profile.v1') || '{}'); } catch (e) { return null; } }", default=None) or {}
    note1 = run.text("#dfm-rule-note")
    run.checks["ruleWashout"] = {"profile": prof.get("rule"), "aria": checked, "saved": saved.get("rule"), "note": note1}
    run.ok(prof.get("rule") == "washout" and checked == ["false", "true"], "WASHOUT did not select (profile %s, aria %s)" % (prof.get("rule"), checked))
    run.ok(saved.get("rule") == "washout", "the WASHOUT rule was not persisted (localStorage %s)" % saved.get("rule"))
    run.ok(note1 == STRINGS["washoutLine"], "the WASHOUT line reads %r" % note1)
    run.shot("play_washout")
    run.layout("play washout")
    run.key("Escape", 0.5)
    line = run.text("#df-menus .dfm-brand .df-mode span")
    card = run.text(".dfm-profile .txt span")
    run.ok(line == STRINGS["modeAll"], "WASHOUT picked: the title mode line %r (want exactly %r)" % (line, STRINGS["modeAll"]))
    run.ok(card == STRINGS["cardWashout"], "the TEAMS WASHOUT profile card reads %r" % card)
    run.shot("title_washout")
    run.click("#dfm-how-to-play", 0.6)
    how = run.text(".dfm-s-howto .dfm-howp p")
    run.ok(how == STRINGS["howWashout"], "HOW TO PLAY panel 1 in WASHOUT reads %r" % how)
    # review fix A-A9: card 1's PICTURE follows the rule too (WASHOUT: washes + score chips, never the TURF court + tug bar)
    art_w = s.safe_js("() => { const a = document.querySelector('.dfm-s-howto .dfm-howp .art'); return a ? [a.dataset.art, !!a.querySelector('#dfh-wcourt'), !!a.querySelector('#dfh-court')] : null; }", default=None)
    run.ok(art_w == ["washout", True, False], "HOW TO PLAY card 1 in WASHOUT still shows the TURF picture (data-art, washout clip, turf clip: %s)" % art_w)
    run.shot("howto_washout")
    run.key("Escape", 0.5)
    # FFA · WASHOUT: the card names both
    run.click("#dfm-play", 0.7)
    run.click("#dfm-mode-ffa", 0.3)
    run.key("Escape", 0.5)
    card_ffa = run.text(".dfm-profile .txt span")
    run.ok(card_ffa == STRINGS["cardFfaWashout"], "the FFA WASHOUT profile card reads %r" % card_ffa)
    # back to TEAMS · TURF: every TURF line as before
    run.click("#dfm-play", 0.7)
    run.click("#dfm-mode-teams", 0.3)
    run.click("#dfm-rule-turf", 0.4)
    run.key("Escape", 0.5)
    prof2 = run.menu().get("profile") or {}
    card2 = run.text(".dfm-profile .txt span")
    run.click("#dfm-how-to-play", 0.6)
    how2 = run.text(".dfm-s-howto .dfm-howp p")
    art_t = s.safe_js("() => { const a = document.querySelector('.dfm-s-howto .dfm-howp .art'); return a ? [a.dataset.art, !!a.querySelector('#dfh-wcourt'), !!a.querySelector('#dfh-court')] : null; }", default=None)
    run.ok(art_t == ["floor", False, True], "HOW TO PLAY card 1 back in TURF does not show the TURF picture (%s)" % art_t)
    run.key("Escape", 0.5)
    run.checks["ruleBackToTurf"] = {"profile": {k: prof2.get(k) for k in ("mode", "rule", "crew")}, "card": card2, "how": how2,
                                   "cards": {"washout": card, "ffaWashout": card_ffa}, "modeLine": line, "howWashout": how,
                                   "howArt": {"washout": art_w, "turf": art_t}}
    run.ok(prof2.get("rule") == "turf" and prof2.get("mode") == "teams", "TURF / TEAMS did not restore (%s)" % prof2)
    run.ok(card2 == ("GULF CREW" if prof2.get("crew") == 2 else "SUNCREW"), "the TURF profile card reads %r (want the crew name)" % card2)
    run.ok(how2 == STRINGS["howTurf"], "HOW TO PLAY panel 1 back in TURF reads %r" % how2)
    run.click("#dfm-play", 0.7)


def match_washout(run):
    """CONTRACT_WASHOUT W4 / W8: PLAY → WASHOUT → START on LOCKWELL: the loading card names the WASHOUT match, the HUD is the
    WASHOUT one (score chips + the tie-break label); pause → QUIT → the lobby; RULE back to TURF."""
    print("WASHOUT START (LOCKWELL) → loading line → WASHOUT HUD → QUIT")
    s = run.s
    if run.menu().get("screen") != "play":
        run.click("#dfm-play", 0.7)
    run.click("#dfm-mode-teams", 0.3)
    run.click("#dfm-rule-washout", 0.3)
    run.click("#dfm-map-lockwell", 0.3)
    run.click("#dfm-start", 0.05)
    loading_line(run, STRINGS["modeWashout"], "WASHOUT START (LOCKWELL)")
    ph = run.wait(lambda: run.phase() if run.phase() in ("ready", "play", "error") else None, 60)
    run.ok(ph in ("ready", "play"), "WASHOUT START did not reach the match (phase %s: %s)" % (ph, (s.state() or {}).get("error")))
    if ph == "ready":
        run.click("#df-play", 1.0)
    # review fix A-A8: the WASHOUT countdown names the objective ("WASHOUT · Most washes wins · first crew to <limit>")
    cr = run.wait(lambda: (run.df("hud") or {}).get("countRule") or None, 20)
    lim_cd = (run.df("match") or {}).get("limit")
    run.checks["washoutCountRule"] = {"countRule": cr, "limit": lim_cd}
    run.ok(bool(cr) and "Most washes wins" in cr and ("first crew to %s" % lim_cd) in cr,
           "the WASHOUT countdown does not name the objective (line %r, limit %s)" % (cr, lim_cd))
    if cr:
        run.shot("washout_countdown")
    live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 20)
    run.ok(live, "the WASHOUT match did not go live")
    time.sleep(0.5)
    h = run.df("hud") or {}
    m = run.df("match") or {}
    wo = h.get("washout") or {}
    run.checks["washoutMatch"] = {"hudRule": h.get("rule"), "limit": h.get("limit"), "chips": wo.get("chips"), "tugLabel": wo.get("tugLabel"),
                                  "matchRule": m.get("rule")}
    run.ok(h.get("rule") == "washout" and (h.get("limit") or 0) > 0, "the HUD is not the WASHOUT HUD (rule %s, limit %s)" % (h.get("rule"), h.get("limit")))
    chips = wo.get("chips") or {}
    run.ok(bool(chips.get("sun")) and bool(chips.get("gulf")) and "/ %s" % h.get("limit") in (chips.get("sun") or ""),
           "the WASHOUT score chips are missing (%s)" % chips)
    run.ok(wo.get("tugLabel") == "TURF (tie-break)", "the tie-break label reads %r" % wo.get("tugLabel"))
    run.shot("washout_match_live")
    run.key("Escape", 0.6)
    run.ok(run.phase() == "paused", "ESC did not pause the WASHOUT match (phase %s)" % run.phase())
    run.click("#df-p-quit", 0.4)
    run.click("#dfm-quit-yes", 0.2)
    ph = run.wait(lambda: run.phase() if run.phase() in ("menu", "error") else None, 60)
    run.ok(ph == "menu", "QUIT did not return to the lobby from the WASHOUT match (%s)" % ph)
    time.sleep(0.8)
    run.click("#dfm-play", 0.7)
    run.click("#dfm-rule-turf", 0.3)
    run.key("Escape", 0.5)
    run.ok((run.menu().get("profile") or {}).get("rule") == "turf", "the rule did not go back to TURF")


def aim_migration(args, all_problems, shots):
    """CONTRACT_CONTROLS C1 / C4: a pre-1.4 save (SUB = E + RMB, no AIM) loads as SUB = E, AIM = RMB (the remap list shows it);
    a customised SUB that holds RMB keeps it, and AIM then stays unbound (RMB was not free)."""
    print("old saved bindings → the C1 migration")
    checks = {}
    with Session(args, "menus_aim") as s:
        run = Run(s, "menu_aim")
        url = build_url(args.base, lobby=1, dev=1)
        for label, sub, want_sub, want_aim in (("default", ["KeyE", "Mouse2"], ["KeyE"], ["Mouse2"]),
                                               ("custom", ["KeyF", "Mouse2"], ["KeyF", "Mouse2"], [])):
            s.goto(url)
            if not s.wait_df(90):
                run.fail("aim migration (%s): __DF__ never appeared" % label)
                continue
            s.js("(sub) => { const raw = JSON.parse(localStorage.getItem('dyefield.settings.v1') || '{}'); const b = raw.bindings || {};"
                 " b.sub = sub; delete b.aim; raw.bindings = b; delete raw.aimSens; delete raw.aimToggle;"
                 " localStorage.setItem('dyefield.settings.v1', JSON.stringify(raw)); }", sub)
            s.goto(url)
            ok, ph = s.wait_phase(("menu",), 120)
            if not ok:
                run.fail("aim migration (%s): the lobby never came up (%s)" % (label, ph))
                continue
            b = (run.df("settings") or {}).get("bindings") or {}
            run.click("#dfm-settings", 0.6)
            caps = {"aim": run.text("#dfm-key-aim-0"), "sub0": run.text("#dfm-key-sub-0"), "sub1": run.text("#dfm-key-sub-1")}
            run.key("Escape", 0.4)
            checks[label] = {"saved": sub, "sub": b.get("sub"), "aim": b.get("aim"), "caps": caps}
            run.ok(b.get("sub") == want_sub and (b.get("aim") or []) == want_aim,
                   "aim migration (%s): SUB %s / AIM %s (want %s / %s)" % (label, b.get("sub"), b.get("aim"), want_sub, want_aim))
        # leave a clean default save for whoever runs next
        s.js("() => { const raw = JSON.parse(localStorage.getItem('dyefield.settings.v1') || '{}'); delete raw.bindings; localStorage.setItem('dyefield.settings.v1', JSON.stringify(raw)); }")
        all_problems.extend(run.problems)
        shots.extend(run.shots)
    return checks


def washout_deeplink(args, all_problems, shots):
    """Review fix A-A8: a DEEP-LINKED WASHOUT match (?rule=washout[&mode=ffa], the saved profile still TURF) — the countdown
    names the objective, and HOW TO PLAY opened from the pause card teaches the RUNNING match (title, rule line, picture),
    not the profile's TURF. Real clicks (CLICK TO PLAY, the pause card's HOW TO PLAY); ESC pauses."""
    print("deep-linked WASHOUT → countdown objective + pause → HOW TO PLAY follows the match")
    checks = {}
    with Session(args, "menus_wodeep") as s:
        run = Run(s, "menu_wodeep")
        for label, extra, want_rule in (("teams", {}, STRINGS["howWashout"]), ("ffa", {"mode": "ffa"}, STRINGS["howWashout"])):
            url = build_url(args.base, map="pier18", rule="washout", dev=1, matchSeconds=300, **extra)
            s.goto(url)
            if not s.wait_df(90) or not s.wait_phase(("ready", "play"), 150)[0]:
                run.fail("deep link %s: the match never loaded (%s)" % (label, (s.state() or {}).get("phase")))
                continue
            prof = (run.df("profile") or {})
            if run.phase() == "ready":
                s.page.mouse.click(args.width / 2, args.height / 2)
                s.wait_phase(("play",), 20)
            cr = run.wait(lambda: (run.df("hud") or {}).get("countRule") or None, 30)
            lim = (run.df("match") or {}).get("limit")
            live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 60)
            run.key("Escape", 0.8)
            paused = run.phase() == "paused"
            run.click("#df-p-howto", 0.7)
            title = run.text(".dfm-s-howto .dfm-howp h3 span:not(.n)")
            rule_line = run.text(".dfm-s-howto .dfm-howp p")
            art = s.safe_js("() => { const a = document.querySelector('.dfm-s-howto .dfm-howp .art'); return a ? a.dataset.art : null; }", default=None)
            run.shot("wodeep_%s_howto" % label)
            checks[label] = {"profileRule": prof.get("rule"), "countRule": cr, "limit": lim, "live": bool(live), "paused": paused,
                             "howTitle": title, "howRule": rule_line, "art": art}
            want_to = "first to %s" % lim if label == "ffa" else "first crew to %s" % lim
            run.ok(bool(cr) and "Most washes wins" in cr and want_to in cr, "deep link %s: the countdown line %r does not name the objective (%s)" % (label, cr, want_to))
            run.ok(paused, "deep link %s: ESC did not pause (phase %s)" % (label, run.phase()))
            run.ok(title == "MOST WASHES WINS" and rule_line == want_rule and art == "washout",
                   "deep link %s (profile rule %r): pause → HOW TO PLAY teaches %r / %r / art %r (want the running WASHOUT match)" % (
                       label, prof.get("rule"), title, rule_line, art))
        all_problems.extend(run.problems)
        shots.extend(run.shots)
    return checks


def match_ffa(run):
    """CONTRACT_FFA F3: PLAY → FREE-FOR-ALL → CINDER REEF → START → the FFA HUD → the FFA victory slate → LOBBY."""
    print("FFA match: PLAY → FREE-FOR-ALL → CINDER → victory standings → LOBBY")
    s = run.s
    run.click("#dfm-play", 0.7)
    run.click("#dfm-mode-ffa", 0.3)
    run.click("#dfm-map-cinder", 0.3)
    run.click("#dfm-start", 0.05)
    loading_line(run, STRINGS["modeFfa"], "FFA START (CINDER)")
    ph = run.wait(lambda: run.phase() if run.phase() in ("ready", "play", "error") else None, 60)
    ses = run.df("session") or {}
    run.ok(ph in ("ready", "play"), "FFA START did not reach the match (phase %s: %s)" % (ph, (s.state() or {}).get("error")))
    if ph == "ready":
        run.click("#df-play", 1.0)
    live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 10)
    run.ok(live, "the FFA match did not go live")
    time.sleep(0.6)
    m = run.df("match") or {}
    h = run.df("hud") or {}
    rs = m.get("runners") or []
    me = rs[0] if rs else {}
    run.checks["ffaMatch"] = {"session": ses, "matchMode": m.get("matchMode"), "crews": [r.get("team") for r in rs], "me": {k: me.get(k) for k in ("team", "name", "kit")},
                              "hudMode": h.get("mode"), "hudFfa": {k: (h.get("ffa") or {}).get(k) for k in ("me", "rank")}}
    run.ok(ses.get("matchMode") == "ffa" and ses.get("map") == "cinder", "the FFA match is not FFA on CINDER (%s)" % ses)
    run.ok(m.get("matchMode") == "ffa" and sorted(r.get("team") for r in rs) == list(range(1, 9)), "FFA: want 8 crews 1..8 (%s)" % run.checks["ffaMatch"]["crews"])
    run.ok(me.get("team") == 2 and me.get("name") == "Tester", "the human is not on the picked VIOLET crew (%s)" % me)
    run.ok(h.get("mode") == "ffa", "the HUD is not in FFA mode (%s)" % h.get("mode"))
    run.shot("ffa_match_live")
    vic = run.wait(lambda: (run.df("match") or {}).get("victoryShown") or None, 70, 0.1)
    run.ok(vic, "no FFA victory slate")
    time.sleep(0.75)
    h1 = run.df("hud") or {}
    run.shot("ffa_victory_tally")
    # the tally clock is the page's frame dt (≤ 0.1 s a frame): poll for the stamp, not wall time
    run.wait(lambda: ((run.df("hud") or {}).get("tally") or {}).get("stamped") or None, 10, 0.2)
    time.sleep(0.3)
    h2 = run.df("hud") or {}
    m2 = run.df("match") or {}
    au = run.df("audio") or {}
    run.shot("ffa_victory")
    t1, t2 = h1.get("tally") or {}, h2.get("tally") or {}
    res = m2.get("result") or {}
    winners = [res.get("winner")] if res.get("winner") else list(res.get("tied") or [])
    won = 2 in winners
    run.checks["ffaVictory"] = {"mid": {k: t1.get(k) for k in ("t", "stamped", "podium")}, "end": {k: t2.get(k) for k in ("t", "stamped", "winner", "podium")},
                                "rows": [r.get("text") for r in t2.get("standings") or []], "result": {k: res.get(k) for k in ("mode", "winner", "tied")},
                                "cue": au.get("cue"), "humanWon": won}
    run.ok(STRINGS["victory"] in (h2.get("victory") or ""), "FFA victory line missing (%r)" % (h2.get("victory") or "")[:120])
    run.ok(t2.get("mode") == "ffa" and len(t2.get("standings") or []) == 8 and len(t2.get("podium") or []) == 3,
           "the FFA slate lacks the podium / 8 standings (%s)" % t2)
    run.ok(t1 and not t1.get("stamped") and t2.get("stamped"), "the FFA tally did not count up then stamp (mid %s, end %s)" % (t1.get("stamped"), t2.get("stamped")))
    run.ok([r.get("pct") for r in t1.get("standings") or []] != [r.get("pct") for r in t2.get("standings") or []], "the FFA tally numbers did not count up")
    for st in res.get("standings") or []:
        p = "%.1f%%" % ((st.get("share") or 0) * 100)
        run.ok(p in (h2.get("victory") or "") and st.get("name") in (h2.get("victory") or ""), "the FFA slate misses %s %s" % (st.get("name"), p))
    if au.get("cue") in ("victory", "defeat"):
        run.ok(au.get("cue") == ("victory" if won else "defeat"), "FFA stinger %r but the human %s" % (au.get("cue"), "won" if won else "lost"))
    else:
        run.fail("the FFA victory slate started no stinger (cue %r)" % au.get("cue"))
    btns = s.safe_js("() => [...document.querySelectorAll('.df-victory .df-btn')].filter((b) => !b.hidden).map((b) => b.textContent)", default=[])
    run.ok(btns == ["PLAY AGAIN", "LOBBY"], "FFA victory buttons %s" % btns)
    run.layout("ffa victory")
    run.click("#df-lobby", 0.2)
    ph = run.wait(lambda: run.phase() if run.phase() in ("menu", "error") else None, 60)
    ses = run.df("session") or {}
    run.ok(ph == "menu" and ses.get("mode") == "lobby" and ses.get("matchMode") == "teams", "LOBBY did not return to the (teams) lobby backdrop (%s / %s)" % (ph, ses))
    time.sleep(1.0)
    return run.gl()


PAD_ACCENT_JS = r"""() => {
  const d = window.__DF__ && window.__DF__.dev;
  const root = d && d.parts && d.parts.map && d.parts.map.root;
  if (!root) return null;
  const pads = {}, seen = new Set();
  root.traverse((o) => {
    const mm = o.material;
    if (!mm) return;
    for (const m of (Array.isArray(mm) ? mm : [mm])) {
      const p = m.userData && m.userData.dfPadTeam;
      if (!p || seen.has(m)) continue;
      seen.add(m);
      pads[p.team] = '#' + p.u.value.getHexString();
    }
  });
  const cs = getComputedStyle(document.documentElement);
  return { pads, css: { 1: cs.getPropertyValue('--sun-dye').trim().toLowerCase(), 2: cs.getPropertyValue('--gulf-dye').trim().toLowerCase() },
           cb: document.documentElement.classList.contains('df-cb') };
}"""


def pad_accent_ok(acc):
    """the A/B team pads' accent (their dfPadTeam uniform) equals the page's team dye (--sun-dye / --gulf-dye)"""
    if not acc:
        return False
    pads, css = acc.get("pads") or {}, acc.get("css") or {}
    return set(pads.keys()) == {"1", "2"} and all(pads[k].lower() == css.get(k) for k in ("1", "2"))


def ffa_pier18_colorblind(run):
    """review F1: FFA on PIER 18 at NOON — the lobby's arena, kept on QUIT — with COLORBLIND MARKS turned on from the pause
    card mid-match: back in the lobby the A/B team pads' accent must follow the setting (it came back in the palette saved
    when the FFA session began). Then SETTINGS → COLORBLIND off from the title: the pads follow again."""
    print("FFA on PIER 18 (noon) → pause → SETTINGS → COLORBLIND on → QUIT → lobby: the team-pad accent follows the setting")
    s = run.s
    cb0 = bool((run.df("settings") or {}).get("colorblind"))
    run.ok(not cb0, "colorblind is already on before the FFA Pier 18 leg")
    run.click("#dfm-play", 0.7)
    run.click("#dfm-mode-ffa", 0.3)
    run.click("#dfm-map-pier18", 0.3)
    run.click("#dfm-preset-noon", 0.3)
    run.click("#dfm-start", 0.05)
    ph = run.wait(lambda: run.phase() if run.phase() in ("ready", "play", "error") else None, 60)
    ses = run.df("session") or {}
    run.ok(ph in ("ready", "play"), "FFA Pier 18 START did not reach the match (phase %s: %s)" % (ph, (s.state() or {}).get("error")))
    run.ok(ses.get("matchMode") == "ffa" and ses.get("key") == "pier18:noon", "not FFA on the lobby's arena pier18:noon (%s)" % ses)
    if ph == "ready":
        run.click("#df-play", 1.0)
    live = run.wait(lambda: (run.df("match") or {}).get("phase") in ("countdown", "live") or None, 10)
    run.ok(live, "the FFA Pier 18 match did not start")
    in_ffa = s.safe_js(PAD_ACCENT_JS, default=None) or {}
    run.ok(in_ffa.get("pads") == {}, "during FFA the A/B team pads are still tagged crew pads (%s)" % in_ffa.get("pads"))
    run.key("Escape", 0.6)
    run.ok(run.phase() == "paused" and run.menu().get("screen") == "pause", "ESC did not pause the FFA match (phase %s)" % run.phase())
    run.click("#df-p-settings", 0.5)
    run.ok(run.menu().get("screen") == "settings" and run.menu().get("context") == "pause", "pause → SETTINGS failed (%s)" % run.menu().get("screen"))
    run.click("#dfm-colorblind", 0.4)
    run.ok((run.df("settings") or {}).get("colorblind") is True, "COLORBLIND MARKS did not switch on from the pause SETTINGS")
    run.key("Escape", 0.5)
    run.click("#df-p-quit", 0.4)
    run.click("#dfm-quit-yes", 0.2)
    ph = run.wait(lambda: run.phase() if run.phase() in ("menu", "error") else None, 60)
    ses2 = run.df("session") or {}
    run.ok(ph == "menu" and ses2.get("mode") == "lobby" and ses2.get("key") == "pier18:noon", "QUIT did not return to the pier18:noon lobby (%s / %s)" % (ph, ses2))
    time.sleep(0.6)
    acc_on = s.safe_js(PAD_ACCENT_JS, default=None)
    run.ok(pad_accent_ok(acc_on) and (acc_on or {}).get("cb") is True,
           "after FFA on the reused Pier 18 arena with COLORBLIND on mid-match, the team pads' accent %s ≠ the team dye %s"
           % ((acc_on or {}).get("pads"), (acc_on or {}).get("css")))
    run.shot("lobby_after_ffa_cb")
    # back off from the title's SETTINGS (the live toggle path; the legs after this one expect colorblind off)
    run.click("#dfm-settings", 0.6)
    run.click("#dfm-colorblind", 0.4)
    run.key("Escape", 0.5)
    acc_off = s.safe_js(PAD_ACCENT_JS, default=None)
    run.ok((run.df("settings") or {}).get("colorblind") is False and pad_accent_ok(acc_off) and (acc_off or {}).get("cb") is False,
           "COLORBLIND off from the title: the team pads' accent %s vs the team dye %s" % ((acc_off or {}).get("pads"), (acc_off or {}).get("css")))
    run.ok(run.menu().get("screen") == "title", "ESC did not go back to the title after SETTINGS")
    run.checks["padAccentAfterFfa"] = {"session": ses.get("key"), "duringFfa": in_ffa.get("pads"), "cbOn": acc_on, "cbOff": acc_off}


def gamepad(run):
    print("synthetic gamepad")
    s = run.s
    s.js("""() => {
      const pad = { id: 'harness pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.__PADX__ = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
    }""")
    # qa lane 2026-10-01 harness fix: Menus.update() polls the pad once per rendered frame, so a fixed 120 ms wall hold
    # is lost whenever no frame runs inside it (diag_pad: lobby warm-up / a loaded box gave 0 polls in 134-613 ms holds
    # → 'd-pad down did not move focus'; every hold that a poll landed in moved PLAY → LOADOUT on that frame). Hold (and
    # rest) for at least 2 rendered frames (window.__H_FRAMES__, the harness rAF counter) as well as the wall minimum;
    # 2 frames stay well under the menus' 0.38 s d-pad repeat delay.
    def frames_past(f0, n, min_s, cap_s=5.0):
        t0 = time.time()
        while time.time() - t0 < cap_s:
            f = s.frames()
            if time.time() - t0 >= min_s and isinstance(f, int) and isinstance(f0, int) and f >= f0 + n:
                return
            time.sleep(0.02)

    def press(i, hold=0.12):
        f0 = s.js("(i) => { const b = window.__PADX__.buttons[i]; b.pressed = true; b.value = 1; return window.__H_FRAMES__; }", i)
        frames_past(f0, 2, hold)
        f1 = s.js("(i) => { const b = window.__PADX__.buttons[i]; b.pressed = false; b.value = 0; return window.__H_FRAMES__; }", i)
        frames_past(f1, 2, 0.15)
    # the checks below start from PLAY; the leg before this one (ffa_pier18_cb) returns from the title's SETTINGS, so
    # the focus comes back on SETTINGS — home it to PLAY with real ↑ key presses first (QA 2026-09-28 harness fix)
    for _ in range(6):
        if run.menu().get("focus") == "dfm-play":
            break
        run.key("ArrowUp", 0.2)
    f0 = run.menu().get("focus")
    run.ok(f0 == "dfm-play", "gamepad leg: could not home the title focus to PLAY with ↑ (focus %s)" % f0)
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
            # CONTRACT_FFA F3: the FFA screens at 1280×720
            run.click("#dfm-play", 0.8)
            run.click("#dfm-mode-ffa", 0.4)
            run.shot("ffa_play")
            run.layout("720 ffa play")
            run.key("Escape", 0.4)
            run.shot("ffa_title")
            run.layout("720 ffa title")
            run.click("#dfm-loadout", 0.8)
            run.click("#dfm-color-jade", 0.5)
            run.shot("ffa_loadout")
            run.layout("720 ffa loadout")
            run.key("Escape", 0.4)
            # the FFA victory slate at 1280×720: a deep-link FFA match, dev setTimeLeft to reach the horn
            s.goto(build_url(args.base, map="lockwell", dev=1, mode="ffa", seed=11, autostart=1))
            ok, ph = s.wait_phase(("play",), 120)
            live = run.wait(lambda: (run.df("match") or {}).get("phase") == "live" or None, 12)
            if not live:
                run.fail("720p: the FFA deep link never went live (%s)" % ph)
            else:
                time.sleep(4.0)
                run.shot("ffa_hud")
                s.safe_js("() => window.__DF__.setTimeLeft(1)")
                vic = run.wait(lambda: (run.df("match") or {}).get("victoryShown") or None, 20, 0.1)
                # the tally clock is the page's frame dt (≤ 0.1 s a frame): poll for the stamp, not wall time
                run.wait(lambda: ((run.df("hud") or {}).get("tally") or {}).get("stamped") or None, 10, 0.2)
                time.sleep(0.4)
                t = (run.df("hud") or {}).get("tally") or {}
                run.ok(vic and t.get("mode") == "ffa" and t.get("stamped") and len(t.get("standings") or []) == 8,
                       "720p: the FFA victory slate did not show its 8 standings (%s)" % t)
                run.shot("ffa_victory")
                run.layout("720 ffa victory")
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
    ap.add_argument("--legs", default="", help="comma list of legs to run (title, loadout, settings, howto_credits, map_select, ffa_menus, rule_menus, lockwell, keyboard, ffa, ffa_pier18_cb, gamepad, washout, aim_migration, washout_deeplink, 720); default: all")
    args = ap.parse_args()
    args.headless = not args.headed
    legs = {x.strip() for x in (args.legs or "").split(",") if x.strip()}
    on = (lambda name: not legs or name in legs)
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
                     ("map_select", map_select), ("ffa_menus", ffa_menus), ("rule_menus", rule_menus)]
            for name, fn in steps:
                if not on(name):
                    continue
                try:
                    fn(run)
                except Exception as e:
                    run.fail("%s: harness error %s" % (name, str(e).splitlines()[0][:300]))
            gl["lobby0"] = run.gl()            # after every lobby screen (the mannequin's textures are in)
            try:
                if on("lockwell"):
                    gl["lobby1"] = match_lockwell(run)
            except Exception as e:
                run.fail("match 1: harness error %s" % str(e).splitlines()[0][:300])
            try:
                if on("keyboard"):
                    gl["lobby2"] = match_keyboard(run)
            except Exception as e:
                run.fail("match 2: harness error %s" % str(e).splitlines()[0][:300])
            try:
                if on("ffa"):
                    gl["lobby3"] = match_ffa(run)
            except Exception as e:
                run.fail("FFA match: harness error %s" % str(e).splitlines()[0][:300])
            try:
                if on("ffa_pier18_cb"):
                    ffa_pier18_colorblind(run)
            except Exception as e:
                run.fail("FFA Pier 18 colorblind: harness error %s" % str(e).splitlines()[0][:300])
            try:
                if on("gamepad"):
                    gamepad(run)
            except Exception as e:
                run.fail("gamepad: harness error %s" % str(e).splitlines()[0][:300])
            try:
                if on("washout"):
                    match_washout(run)
            except Exception as e:
                run.fail("WASHOUT match: harness error %s" % str(e).splitlines()[0][:300])
        d = s.diagnostics()
        print_diagnostics(d)
        problems.extend(run.problems)
        problems.extend(diag_problems(d))
        shots.extend(run.shots)
        report.update(checks=run.checks, notes=run.notes, diagnostics=d)
    # leaks across sessions: the same lobby state after each return
    g0, g1, g2, g3 = gl.get("lobby0") or {}, gl.get("lobby1") or {}, gl.get("lobby2") or {}, gl.get("lobby3") or {}
    report["gl"] = gl
    for (na, ga), (nb, gb) in ((("before the matches", g0), ("after match 1", g1)), (("after match 1", g1), ("after match 2", g2)),
                               (("after match 2", g2), ("after the FFA match", g3))):
        if not ga or not gb:
            continue
        for k in ("geometries", "textures"):
            a, b = ga.get(k) or 0, gb.get(k) or 0
            if a and abs(b - a) > max(3, 0.05 * a):
                problems.append("renderer.info %s drifted in the lobby %s → %s: %d → %d" % (k, na, nb, a, b))
        ha, hb = ga.get("heapMB"), gb.get("heapMB")
        if isinstance(ha, (int, float)) and isinstance(hb, (int, float)) and hb > ha * 1.15 + 5:
            problems.append("JS heap (after GC) grew in the lobby %s → %s: %s → %s MB" % (na, nb, ha, hb))
    if on("aim_migration"):
        try:
            report["aimMigration"] = aim_migration(args, problems, shots)
        except Exception as e:
            problems.append("aim migration: harness error %s" % str(e).splitlines()[0][:300])
    if on("washout_deeplink"):
        try:
            report["washoutDeeplink"] = washout_deeplink(args, problems, shots)
        except Exception as e:
            problems.append("WASHOUT deep link: harness error %s" % str(e).splitlines()[0][:300])
    if not args.skip_720 and on("720"):
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
    print("\nleaks (renderer.info at lobby: boot / after match 1 / after match 2 / after the FFA match): %s" % json.dumps(gl))
    print("screenshots: %d in _shots/ (menu_*.png, menu720_*.png, ffa_ui_menu_*.png, ffa_ui_menu720_*.png)" % len(shots))
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
