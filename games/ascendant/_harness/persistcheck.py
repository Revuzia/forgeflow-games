#!/usr/bin/env python
"""ASCENDANT persistcheck - persistence, settings and audio lifecycle gate.

Runs a REAL headed Chrome (rAF must actually tick, and a real mouse click is the
only trusted gesture a Web Audio context will resume from) and asserts the
things a player notices when this lens is broken:

  save      clear a stage -> reload -> best time, cleared flag, coins, deaths and
            the furthest checkpoint all come back; CONTINUE (a REAL click on the
            title's own button) resumes at the right stage; unlockedWorlds()
            matches the documented rule; one page load counts exactly one
            session.
  corrupt   truncated JSON / future schema version / wrong types / non-object
            payloads never block boot: the game starts on a fresh (or repaired)
            save, Save.recovered says so, and the player is told exactly once.
  settings  every persisted field round-trips through a reload and applies live;
            five quality switches leave renderer.info.memory where they found it
            (a post-chain rebuild that leaks render targets shows up here).
  audio     the context starts on the first gesture and NOT before; no AudioParam
            / AudioNode call throws across 4 theme crossfades, a death duck, the
            finish fanfare and 200 rapid sfx; the page-level mute wrapper in
            game_controls.js silences everything and unmute restores it; hiding
            the tab and coming back does not leave a suspended context with the
            bed "playing" silently forever.
  boot      ?quality= / ?stage= / ?mode=ai / ?mode=online / junk values are all
            respected or ignored gracefully, #boot always goes away - including
            when a module fetch stalls forever (the failure card takes over) -
            and a ?stage= id that is not a stage is said so, visibly.

    python persistcheck.py
    python persistcheck.py --only audio,boot
    python persistcheck.py --url http://localhost:8788/games/ascendant/index.html
    python persistcheck.py --only boot --boot-js path/to/old/boot.js   # A/B a boot.js

Exit 0 only when every selected section passes.

XFAIL rows: defects this probe REPRODUCES but whose generator lives outside the
persistence/settings/audio lane (game.js, menu.js, style.js). They print as
"xfail" with the owning file, do not fail the run, and flip to "XPASS" the day
someone fixes them - so the report can never quietly forget them.

NOTE: this probe deliberately runs in PRODUCTION mode (no ?dev=1) and does NOT
pass --autoplay-policy=no-user-gesture-required, so the gesture requirement it
claims to test is the real one.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/ascendant/index.html"

# Same GPU flags as bootcheck. --autoplay-policy is deliberately ABSENT: the
# audio section asserts the real first-gesture rule.
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
]

SAVE_KEY = "ascendant.save.v1"
SET_KEY = "ascendant.settings"

# ---------------------------------------------------------------------------
# Injected before any game module runs.
#
# Web Audio failures in this codebase are SILENT by design: every scheduling
# call in audio.js sits inside a try/catch so one bad sound never kills the
# frame. That makes a real AudioParam bug invisible to the console. Patching the
# prototypes here records every throw, so the probe sees what the catch ate.
# ---------------------------------------------------------------------------
INIT_JS = r"""
window.__err = [];
addEventListener('error', e => window.__err.push(String(e.message)));
addEventListener('unhandledrejection', e => window.__err.push('reject: ' + e.reason));

window.__AP = { calls: 0, throws: [], bad: [] };

(function () {
  function wrap(proto, name, kind) {
    if (!proto || typeof proto[name] !== 'function') return;
    const orig = proto[name];
    proto[name] = function () {
      window.__AP.calls++;
      for (let i = 0; i < arguments.length; i++) {
        const a = arguments[i];
        if (typeof a === 'number' && !Number.isFinite(a)) {
          window.__AP.bad.push(kind + '.' + name + ' arg' + i + '=' + String(a));
        }
      }
      try {
        return orig.apply(this, arguments);
      } catch (e) {
        window.__AP.throws.push(kind + '.' + name + ': ' + ((e && e.message) || e));
        throw e;
      }
    };
  }
  const AP = window.AudioParam && window.AudioParam.prototype;
  ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
   'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues',
   'cancelAndHoldAtTime'].forEach(n => wrap(AP, n, 'AudioParam'));

  const ABS = window.AudioBufferSourceNode && window.AudioBufferSourceNode.prototype;
  ['start', 'stop'].forEach(n => wrap(ABS, n, 'BufferSource'));
  const OSC = window.OscillatorNode && window.OscillatorNode.prototype;
  ['start', 'stop'].forEach(n => wrap(OSC, n, 'Oscillator'));
  const AN = window.AudioNode && window.AudioNode.prototype;
  ['connect', 'disconnect'].forEach(n => wrap(AN, n, 'AudioNode'));
})();
"""

# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


class Section:
    def __init__(self, name):
        self.name = name
        self.rows = []          # (ok, label, detail, xfail)

    def check(self, ok, label, detail="", xfail=None):
        """xfail: owning file + reason for a REPRODUCED defect outside this lane.
        Such rows never fail the run; they print as xfail / XPASS."""
        self.rows.append((bool(ok), label, str(detail), xfail))
        return bool(ok)

    @property
    def failures(self):
        return [r for r in self.rows if not r[0] and not r[3]]

    def dump(self):
        print("-" * 74)
        print("[%s]" % self.name)
        for ok, label, detail, xfail in self.rows:
            if xfail:
                mark = "XPASS" if ok else "xfail"
            else:
                mark = "ok   " if ok else "FAIL "
            line = "  %s %s" % (mark, label)
            if detail:
                line += "   %s" % detail
            if xfail:
                line += "   [out of lane: %s]" % xfail
            print(line)


def wait_boot(pg, wait=60.0):
    """Wait until the runtime handle exists AND the #boot overlay is gone.
    Returns early (bootGone False) if the failure card shows up instead."""
    deadline = time.time() + wait
    got_global = False
    while time.time() < deadline:
        try:
            got_global = bool(pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.engine)"))
        except Exception:
            got_global = False
        if got_global:
            break
        try:
            if pg.evaluate("!!document.getElementById('asc-fail')"):
                return {"global": False, "bootGone": False, "failCard": True}
        except Exception:
            pass
        pg.wait_for_timeout(250)
    if not got_global:
        return {"global": False, "bootGone": False, "failCard": False}
    deadline = time.time() + 25.0
    gone = False
    while time.time() < deadline:
        try:
            gone = bool(pg.evaluate(
                "(() => {const b=document.getElementById('boot');"
                "return !b || b.classList.contains('gone');})()"))
        except Exception:
            gone = False
        if gone:
            break
        pg.wait_for_timeout(200)
    return {"global": True, "bootGone": gone, "failCard": False}


TITLE_JS = r"""() => {
  const g = globalThis.ASCENDANT && ASCENDANT.game;
  const m = g && g.menu;
  if (!m || !m.tBtnPlay) return null;
  const r = m.tBtnPlay.getBoundingClientRect();
  return {state: g.state, open: !!m._open, page: m.page,
          gone: m.el.classList.contains('asc-gone'),
          opacity: parseFloat(getComputedStyle(m.el).opacity),
          playW: Math.round(r.width),
          has: (() => { try { return m._hasProgress(); } catch (e) { return null; } })()};
}"""


def wait_title(pg, timeout=30.0):
    """Wait until the title menu is REVEALED: open, on the title page, not held
    behind the boot splash (asc-gone) and with a PLAY button that has geometry.
    Menu.open('title') runs while #boot still covers the screen and the reveal
    is deferred to the splash's fade-out - sampling before that reads a menu
    the player cannot see or click."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = pg.evaluate(TITLE_JS)
        except Exception:
            last = None
        if (last and last["state"] == "title" and last["open"] and last["page"] == "title"
                and not last["gone"] and last["opacity"] > 0.9 and last["playW"] > 4):
            pg.wait_for_timeout(300)
            return last
        pg.wait_for_timeout(250)
    return last


def title_button_box(pg, which):
    """Centre of one of the title's OWN buttons (menu.tBtnPlay / tBtnCont).
    Never search the DOM by text: the HUD's finish card also has a hidden
    CONTINUE button, earlier in DOM order, that a text search finds first."""
    return pg.evaluate(
        """(which) => {
             const m = ASCENDANT.game.menu; const b = m && m[which];
             if (!b) return null;
             const r = b.getBoundingClientRect();
             return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height,
                     display: getComputedStyle(b).display, disabled: !!b.disabled,
                     text: (b.textContent || '').trim()};
           }""", which)


def click_play_for_real(pg, timeout=30.0):
    """Click the title PLAY with a REAL mouse press.

    pg.evaluate('...menu._act("play")') gets past the title but is not a trusted
    gesture, so a context resumed that way is a lie. The audio section needs the
    real thing.
    """
    t = wait_title(pg, timeout)
    if not t:
        return None
    box = title_button_box(pg, "tBtnPlay")
    if not box or box["w"] < 4:
        return None
    pg.mouse.click(box["x"], box["y"])
    for _ in range(60):
        st = pg.evaluate("ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        if st and st not in ("title", "loading"):
            return box["text"]
        pg.wait_for_timeout(150)
    return box["text"]


def act_play(pg, timeout=30.0):
    """Get past the title without needing a trusted gesture."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate("ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st and st not in ("title", "loading"):
            return True
        try:
            pg.evaluate("ASCENDANT.game.menu._act('play')")
        except Exception:
            pass
        pg.wait_for_timeout(350)
    return False


def seed_storage(pg, origin, save_raw=None, settings_raw=None, clear=False):
    """Write localStorage for the game origin BEFORE the game modules run.
    (The blank URL 404s - callers reset their console capture after this.)"""
    pg.goto(origin + "/__persistcheck_blank__", wait_until="domcontentloaded")
    pg.evaluate(
        """([key, sk, save, settings, clear]) => {
             if (clear) localStorage.clear();
             if (save === null) localStorage.removeItem(key); else localStorage.setItem(key, save);
             if (settings === null) localStorage.removeItem(sk); else localStorage.setItem(sk, settings);
           }""",
        [SAVE_KEY, SET_KEY, save_raw, settings_raw, clear],
    )


def wait_stage(pg, stage_id, timeout=25.0):
    deadline = time.time() + timeout
    loaded = None
    while time.time() < deadline:
        loaded = pg.evaluate("() => ({id: ASCENDANT.game.stageId, state: ASCENDANT.game.state})")
        if loaded["id"] == stage_id and loaded["state"] != "loading":
            return loaded
        pg.wait_for_timeout(250)
    return loaded


# ---------------------------------------------------------------------------
# SECTION: save round-trip
# ---------------------------------------------------------------------------
WRITE_PROGRESS_JS = r"""() => {
  const S = ASCENDANT.Save;
  S.addAttempt('neon-1');
  S.addDeath('neon-1'); S.addDeath('neon-1'); S.addDeath('neon-1');
  S.setCheckpoint('neon-1', 3);
  S.collectCoin('neon-1', 0); S.collectCoin('neon-1', 2); S.collectCoin('neon-1', 5);
  S.clearStage('neon-1', 41234);
  S.addDeath('neon-2');
  S.setCheckpoint('neon-2', 1);
  S.clearStage('neon-2', 52345);
  S.addDeath('neon-3');
  S.setCheckpoint('neon-3', 2);
  S.addPlaytime(90000, 'neon-3');
  S.flush();
  return {sessions: S.raw().sessions, unlocked: S.unlockedWorlds()};
}"""

READ_PROGRESS_JS = r"""() => {
  const S = ASCENDANT.Save;
  return {
    n1: S.stageCopy('neon-1'),
    n2: S.stageCopy('neon-2'),
    n3: S.stageCopy('neon-3'),
    unlocked: S.unlockedWorlds(),
    totals: S.totals(),
    sessions: S.raw().sessions,
    persistent: S.persistent,
    recovered: S.recovered,
    cont: (() => {
      try { return ASCENDANT.game.menu._continueTarget(); } catch (e) { return null; }
    })(),
  };
}"""


def sec_save(pg, url, origin):
    s = Section("save")
    seed_storage(pg, origin, save_raw=None, settings_raw=None, clear=True)
    pg.goto(url, wait_until="load", timeout=60_000)
    b = wait_boot(pg)
    if not s.check(b["global"] and b["bootGone"], "fresh boot with empty storage",
                   json.dumps(b)):
        return s
    wait_title(pg)

    first_sessions = pg.evaluate("ASCENDANT.Save.raw().sessions")
    s.check(first_sessions == 1, "one page load counts one session",
            "sessions=%s (want 1)" % first_sessions)
    s.check(pg.evaluate("ASCENDANT.Save.recovered") is False,
            "a brand-new player is not a 'recovered' save")
    s.check(pg.evaluate("ASCENDANT.Save.load() === ASCENDANT.Save.raw()"),
            "Save.load() is idempotent (a second call returns the live object)")

    wrote = pg.evaluate(WRITE_PROGRESS_JS)
    s.check(wrote["unlocked"] == ["neon", "foundry"],
            "two clears in neon unlock foundry immediately", wrote["unlocked"])

    # ---- reload ----
    pg.goto(url, wait_until="load", timeout=60_000)
    b = wait_boot(pg)
    if not s.check(b["global"] and b["bootGone"], "boot after reload", json.dumps(b)):
        return s
    t = wait_title(pg)
    s.check(bool(t) and not t["gone"] and t["playW"] > 4, "title menu revealed after the splash",
            json.dumps(t))
    r = pg.evaluate(READ_PROGRESS_JS)

    s.check(r["persistent"] is True, "localStorage is persistent", r["persistent"])
    s.check(r["recovered"] is False, "a valid save is not flagged as recovered", r["recovered"])
    n1, n2, n3 = r["n1"], r["n2"], r["n3"]
    s.check(n1["best"] == 41234, "neon-1 best time restored", "best=%s want 41234" % n1["best"])
    s.check(n1["cleared"] is True, "neon-1 cleared flag restored", n1["cleared"])
    s.check(n1["coins"] == [0, 2, 5], "neon-1 coins restored", n1["coins"])
    s.check(n1["deaths"] == 3, "neon-1 deaths restored", n1["deaths"])
    s.check(n1["cpIndex"] == 3, "neon-1 furthest checkpoint restored", n1["cpIndex"])
    s.check(bool(n1["firstClearDate"]), "neon-1 first-clear date restored", n1["firstClearDate"])
    s.check(n2["best"] == 52345, "neon-2 best time restored", n2["best"])
    s.check(n3["cleared"] is False and n3["cpIndex"] == 2,
            "neon-3 uncleared with checkpoint 2",
            "cleared=%s cp=%s" % (n3["cleared"], n3["cpIndex"]))
    s.check(n3["playMs"] == 90000, "neon-3 playtime restored", n3["playMs"])

    # unlock rule: world 0 always; world N unlocks at >= 2 clears in world N-1.
    s.check(r["unlocked"] == ["neon", "foundry"],
            "unlockedWorlds() matches the >=2-clears rule", r["unlocked"])
    s.check(r["totals"]["cleared"] == 2 and r["totals"]["deaths"] == 5,
            "totals() aggregates the reloaded stages",
            "cleared=%s deaths=%s" % (r["totals"]["cleared"], r["totals"]["deaths"]))

    s.check(r["sessions"] == 2, "session counter advanced by exactly one",
            "sessions=%s (want 2)" % r["sessions"])

    cont = r["cont"] or {}
    s.check(cont.get("stageId") == "neon-3", "CONTINUE targets the first uncleared stage",
            "target=%s want neon-3" % cont.get("stageId"))
    cb = title_button_box(pg, "tBtnCont") or {}
    s.check(cb.get("w", 0) > 4 and cb.get("display") != "none" and not cb.get("disabled"),
            "the title's CONTINUE button is shown and enabled", json.dumps(cb))

    # ---- and a REAL click on it loads that stage ----
    loaded = None
    if cb.get("w", 0) > 4:
        pg.mouse.click(cb["x"], cb["y"])
        loaded = wait_stage(pg, "neon-3")
    s.check(bool(loaded) and loaded["id"] == "neon-3", "CONTINUE resumes at the right stage",
            "loaded=%s want neon-3" % json.dumps(loaded))

    # Resuming is only half done if the player is dropped at the start of a
    # stage whose saved cpIndex says they reached checkpoint 2 - the title's
    # CLEARED stat even counts those segments. loadStage() always spawns at 0.
    cp = pg.evaluate("ASCENDANT.game.cpIndex")
    s.check(cp == 2, "resume spawns at the saved furthest checkpoint (cpIndex 2)",
            "game.cpIndex=%s saved=2" % cp,
            xfail="game.js loadStage() sets cpIndex=0 and spawns at _spawnFor(0); the saved cpIndex is never read back")
    return s


# ---------------------------------------------------------------------------
# SECTION: corrupt payloads
# ---------------------------------------------------------------------------
# (label, payload, expected Save.recovery.kind)
CORRUPT_CASES = [
    ("truncated JSON", '{"v":1,"sessions":4,"stages":{"neon-1":{"best":1234,"cleared":tr', "unreadable"),
    ("future schema version", json.dumps({"v": 99, "stages": {"neon-1": {"best": 111, "cleared": True}}}), "newer-version"),
    ("wrong types everywhere", json.dumps({
        "v": "one", "createdAt": "yesterday", "updatedAt": None, "sessions": {},
        "totalPlaytimeMs": "lots", "unlockAll": "yes",
        "stages": {"neon-1": {"best": "fast", "coins": "all", "cpIndex": -4,
                              "cleared": "yes", "deaths": None, "attempts": [],
                              "firstClearDate": 12345}},
    }), "repaired"),
    ("stages is an array", json.dumps({"v": 1, "stages": [1, 2, 3]}), "repaired"),
    ("payload is a bare string", '"just a string"', "not-an-object"),
    ("payload is null", "null", "not-an-object"),
    ("payload is empty", "", "unreadable"),
    ("payload is binary junk", "\x00\x01\x02 not json at all �", "unreadable"),
]

CORRUPT_SETTINGS = json.dumps({
    "quality": "ludicrous", "sens": "fast", "fov": 9999, "invertY": "maybe",
    "master": -3, "music": None, "sfx": [], "showTimer": 0, "hudScale": "big",
})

CORRUPT_STATE_JS = r"""() => {
  const S = ASCENDANT && ASCENDANT.Save;
  if (!S) return null;
  const raw = S.raw();
  const n = document.getElementById('asc-save-notice');
  const r = n ? n.getBoundingClientRect() : null;
  return {
    v: raw.v,
    n1best: S.stage('neon-1').best,
    n1cleared: S.stage('neon-1').cleared,
    stageIds: S.stageIds(),
    unlockAll: raw.unlockAll,
    sessions: raw.sessions,
    recovered: !!S.recovered,
    kind: S.recovery ? S.recovery.kind : null,
    repairs: S.recovery ? S.recovery.repairs : [],
    notice: !!n,
    noticeShown: !!(n && r.width > 40 && r.height > 20 && parseFloat(getComputedStyle(n).opacity) > 0.9),
    noticeText: n ? (n.innerText || '').replace(/\s+/g, ' ').slice(0, 160) : '',
    bak: (() => { try { return localStorage.getItem('ascendant.save.v1.bak') !== null; } catch (e) { return null; } })(),
    stored: (() => { try { const t = localStorage.getItem('ascendant.save.v1'); const o = JSON.parse(t); return o && o.v === 1 && typeof o.stages === 'object'; } catch (e) { return false; } })(),
    quality: ASCENDANT.Settings.qualityId(),
    fov: ASCENDANT.Settings.get().fov,
    failCard: !!document.getElementById('asc-fail'),
  };
}"""


def sec_corrupt(pg, url, origin):
    s = Section("corrupt")
    errs, cerr = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    handler = lambda m: cerr.append((m.type, m.text))
    pg.on("console", handler)
    try:
        for label, payload, want_kind in CORRUPT_CASES:
            seed_storage(pg, origin, save_raw=payload, settings_raw=CORRUPT_SETTINGS, clear=True)
            del errs[:]
            del cerr[:]
            pg.goto(url, wait_until="load", timeout=60_000)
            b = wait_boot(pg)
            state = None
            if b["global"]:
                # the notice fades in over two rAFs and the stored write is debounced 320 ms
                pg.wait_for_timeout(900)
                state = pg.evaluate(CORRUPT_STATE_JS)
            hard = [t for (k, t) in cerr if k == "error"]
            ok_boot = bool(b["global"] and b["bootGone"] and not errs and state and not state["failCard"])
            s.check(ok_boot, "%s: boot completes, no failure card" % label,
                    "global=%s bootGone=%s pageerrors=%d consoleErrors=%d %s" %
                    (b["global"], b["bootGone"], len(errs), len(hard), hard[:1]))
            if not state:
                continue
            s.check(state["v"] == 1, "%s: save migrated to v1" % label, state["v"])
            s.check(state["n1best"] is None and state["n1cleared"] is False,
                    "%s: neon-1 carries nothing from the bad payload" % label,
                    "best=%s cleared=%s" % (state["n1best"], state["n1cleared"]))
            s.check(state["unlockAll"] is False, "%s: unlockAll not smuggled in" % label,
                    state["unlockAll"])
            s.check(isinstance(state["sessions"], int) and state["sessions"] == 1,
                    "%s: session counter restarts at 1" % label, state["sessions"])
            s.check(state["recovered"] is True and state["kind"] == want_kind,
                    "%s: Save.recovered flags it as %s" % (label, want_kind),
                    "recovered=%s kind=%s repairs=%s" % (state["recovered"], state["kind"], state["repairs"][:4]))
            s.check(state["notice"] and state["noticeShown"],
                    "%s: the player is told, visibly" % label,
                    "#asc-save-notice present=%s shown=%s text=%r" %
                    (state["notice"], state["noticeShown"], state["noticeText"][:70]))
            s.check(state["bak"] is True, "%s: the damaged payload was kept as a backup" % label, state["bak"])
            s.check(state["stored"] is True, "%s: a clean v1 save was written back" % label, state["stored"])
            # corrupt settings must not survive either
            s.check(state["quality"] in ("low", "medium", "high", "ultra"),
                    "%s: corrupt settings fall back to a real quality" % label, state["quality"])
            s.check(65 <= state["fov"] <= 110, "%s: corrupt fov clamped into range" % label,
                    state["fov"])
            s.check(len(hard) == 0, "%s: no console errors" % label, hard[:2])

        # the notice appears ONCE - a second load on the now-clean save must be quiet
        pg.goto(url, wait_until="load", timeout=60_000)
        b = wait_boot(pg)
        pg.wait_for_timeout(900)
        quiet = pg.evaluate(
            "() => ({notice: !!document.getElementById('asc-save-notice'),"
            " recovered: !!ASCENDANT.Save.recovered, sessions: ASCENDANT.Save.raw().sessions})") if b["global"] else {}
        s.check(quiet.get("notice") is False and quiet.get("recovered") is False,
                "notice does NOT reappear on the next clean load", json.dumps(quiet))
        s.check(quiet.get("sessions") == 2, "the repaired save carried its session count forward",
                "sessions=%s (want 2)" % quiet.get("sessions"))
    finally:
        pg.remove_listener("console", handler)
    return s


# ---------------------------------------------------------------------------
# SECTION: settings
# ---------------------------------------------------------------------------
NON_DEFAULT = {
    "quality": "medium",
    "sens": 2.35,
    "fov": 97,
    "invertY": True,
    "master": 0.35,
    "music": 0.25,
    "sfx": 0.55,
    "showTimer": False,
    "showViewmodel": False,
    "motionBlurDip": False,
    "hudScale": 1.25,
}

POST_JS = r"""() => { const p = ASCENDANT.engine.post; return {
  qType: typeof p.quality, qId: p.quality && p.quality.id,
  bloom: !!p.bloomPass, aa: !!(p.fxaaPass || p.smaaPass),
  passes: p.composer ? p.composer.passes.map(x => x.constructor.name) : null }; }"""


def sec_settings(pg, url, origin):
    s = Section("settings")
    seed_storage(pg, origin, save_raw=None, settings_raw=None, clear=True)
    pg.goto(url, wait_until="load", timeout=60_000)
    b = wait_boot(pg)
    if not s.check(b["global"] and b["bootGone"], "boot", json.dumps(b)):
        return s
    act_play(pg)
    pg.wait_for_timeout(900)

    pg.evaluate("(p) => ASCENDANT.Settings.set(p)", NON_DEFAULT)
    pg.wait_for_timeout(700)

    # --- applies LIVE (before any reload) ---
    live = pg.evaluate(
        """() => {
             const A = ASCENDANT, e = A.engine, g = A.game;
             return {
               camFov: e.camera ? +e.camera.fov.toFixed(2) : null,
               baseFov: typeof e.baseFov === 'number' ? e.baseFov : null,
               pixelRatio: e.renderer ? +e.renderer.getPixelRatio().toFixed(3) : null,
               wantRatio: +A.Settings.pixelRatio().toFixed(3),
               qualityId: A.Settings.qualityId(),
               invertY: g.input ? !!g.input.invertY : null,
               sens: g.input ? g.input.sensitivity : null,
               audioMaster: g.audio && g.audio.vol ? g.audio.vol.master : null,
               audioMusic: g.audio && g.audio.vol ? g.audio.vol.music : null,
               audioSfx: g.audio && g.audio.vol ? g.audio.vol.sfx : null,
               timerVisible: (() => {
                 /* hud.js hides the whole top-right cluster (nTR.style.display='none'),
                    so ask layout, not the child's own computed display */
                 const t = document.querySelector('.ah-timer');
                 if (!t) return null;
                 return t.getClientRects().length > 0;
               })(),
               hudShowTimer: (() => { const h = ASCENDANT.game.hud; return h && h._c ? h._c.showTimer : null; })(),
             };
           }"""
    )
    s.check(abs((live["camFov"] or 0) - 97) < 0.01 or abs((live["baseFov"] or 0) - 97) < 0.01,
            "fov applies live to the camera",
            "camera.fov=%s baseFov=%s" % (live["camFov"], live["baseFov"]))
    s.check(live["qualityId"] == "medium", "quality id applied", live["qualityId"])
    s.check(abs((live["pixelRatio"] or 0) - (live["wantRatio"] or -1)) < 0.002,
            "renderer pixel ratio follows the preset",
            "renderer=%s want=%s" % (live["pixelRatio"], live["wantRatio"]))
    s.check(live["invertY"] is True, "invertY applies live to input", live["invertY"])
    s.check(abs((live["sens"] or 0) - 2.35) < 1e-6, "sensitivity applies live to input", live["sens"])
    s.check(live["audioMaster"] == 0.35 and live["audioMusic"] == 0.25 and live["audioSfx"] == 0.55,
            "volumes applied live to the audio buses",
            "master=%s music=%s sfx=%s" % (live["audioMaster"], live["audioMusic"], live["audioSfx"]))
    s.check(live["timerVisible"] in (None, False) and live["hudShowTimer"] is False,
            "showTimer=false hides the timer (hud._c.showTimer + no layout box)",
            "layoutBox=%s hud._c.showTimer=%s" % (live["timerVisible"], live["hudShowTimer"]))
    post = pg.evaluate(POST_JS)
    s.check(post["qType"] == "object" and post["qId"] == "medium" and post["bloom"] and post["aa"],
            "Settings.set(quality) leaves a complete post chain (bloom + AA)", json.dumps(post))

    # --- the OPTIONS menu path, which is what a player actually uses ---
    pg.evaluate("() => ASCENDANT.game.menu._set({quality: 'high'})")
    pg.wait_for_timeout(600)
    post = pg.evaluate(POST_JS)
    s.check(post["qType"] == "object" and post["qId"] == "high" and post["bloom"] and post["aa"],
            "menu._set(quality) leaves a complete post chain (bloom + AA)", json.dumps(post),
            xfail="menu.js _applyLive() passes the preset ID STRING (s.quality) to engine.post.setQuality(); "
                  "post rebuilds with quality='high' and drops bloom + AA until a non-menu quality change")
    pg.evaluate("() => ASCENDANT.Settings.set({quality: 'medium'})")   # repair for the rest of the section
    pg.wait_for_timeout(300)

    # --- round-trip ---
    pg.goto(url, wait_until="load", timeout=60_000)
    b = wait_boot(pg)
    if not s.check(b["global"] and b["bootGone"], "boot after reload", json.dumps(b)):
        return s
    got = pg.evaluate("() => ASCENDANT.Settings.snapshot()")
    for k, want in NON_DEFAULT.items():
        have = got.get(k)
        ok = (abs(have - want) < 1e-6) if isinstance(want, float) else (have == want)
        s.check(ok, "settings.%s round-trips a reload" % k, "have=%r want=%r" % (have, want))

    # --- 5 quality switches must not leak GPU memory ---
    act_play(pg)
    pg.wait_for_timeout(1200)
    mem = pg.evaluate(
        """async () => {
             const A = ASCENDANT, r = A.engine.renderer;
             const frame = () => new Promise(res => requestAnimationFrame(() => res()));
             const settle = async (n) => { for (let i = 0; i < n; i++) await frame(); };
             const snap = () => ({
               geometries: r.info.memory.geometries,
               textures: r.info.memory.textures,
               programs: r.info.programs ? r.info.programs.length : -1,
             });
             const order = ['low', 'high', 'medium', 'ultra', 'low', 'high'];
             A.Settings.set({quality: 'high'});
             await settle(30);
             const before = snap();
             const trail = [];
             for (let i = 0; i < order.length; i++) {
               A.Settings.set({quality: order[i]});
               await settle(20);
               trail.push([order[i], snap()]);
             }
             A.Settings.set({quality: 'high'});
             await settle(40);
             const after = snap();
             return {before, after, trail};
           }"""
    )
    d_tex = mem["after"]["textures"] - mem["before"]["textures"]
    d_geo = mem["after"]["geometries"] - mem["before"]["geometries"]
    s.check(d_tex <= 2, "5+ quality switches leak no render targets",
            "textures %d -> %d (delta %+d)" %
            (mem["before"]["textures"], mem["after"]["textures"], d_tex))
    s.check(d_geo <= 2, "5+ quality switches leak no geometries",
            "geometries %d -> %d (delta %+d)" %
            (mem["before"]["geometries"], mem["after"]["geometries"], d_geo))
    peak = max(t[1]["textures"] for t in mem["trail"])
    s.check(peak - mem["before"]["textures"] <= 24,
            "texture count stays bounded across the ladder",
            "peak=%d base=%d" % (peak, mem["before"]["textures"]))

    # --- reset()/purge() do not wedge anything ---
    after_reset = pg.evaluate(
        """() => { ASCENDANT.Settings.reset();
                   const a = ASCENDANT.Settings.snapshot();
                   ASCENDANT.Settings.purge();
                   return {reset: a, purged: ASCENDANT.Settings.snapshot()}; }"""
    )
    s.check(after_reset["reset"]["fov"] == 82 and after_reset["purged"]["fov"] == 82,
            "reset() and purge() return fov to the default",
            "reset=%s purged=%s" % (after_reset["reset"]["fov"], after_reset["purged"]["fov"]))
    s.check(pg.evaluate("() => ASCENDANT.game.frames") > 0, "render loop still alive after purge")
    return s


# ---------------------------------------------------------------------------
# SECTION: audio
# ---------------------------------------------------------------------------
TAP_JS = r"""() => {
  const a = ASCENDANT.game.audio;
  if (!a || !a.ctx || !a.limiter) return false;
  if (!window.__tap) {
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    a.limiter.connect(an);
    window.__tap = an;
    window.__tapBuf = new Float32Array(an.fftSize);
  }
  return true;
}"""

RMS_JS = r"""() => {
  if (!window.__tap) return -1;
  window.__tap.getFloatTimeDomainData(window.__tapBuf);
  let s = 0;
  for (let i = 0; i < window.__tapBuf.length; i++) s += window.__tapBuf[i] * window.__tapBuf[i];
  return Math.sqrt(s / window.__tapBuf.length);
}"""

AUDIO_STATE_JS = r"""() => {
  const a = ASCENDANT.game.audio;
  return {
    hasCtx: !!(a && a.ctx),
    state: a && a.ctx ? a.ctx.state : null,
    currentTime: a && a.ctx ? +a.ctx.currentTime.toFixed(4) : null,
    ready: !!(a && a.ready),
    theme: a ? a.theme : null,
    activeBeds: a && a._active ? a._active.length : null,
    pageMuted: a ? !!a._pageMuted : null,
    loops: a && a._loops ? a._loops.size : null,
    sfxLive: a ? a._sfxLive : null,
    musicLive: a ? a._live : null,
    apCalls: window.__AP.calls,
    apThrows: window.__AP.throws.slice(0, 40),
    apBad: window.__AP.bad.slice(0, 40),
  };
}"""


def sec_audio(pg, url, origin, ctx):
    s = Section("audio")
    cerr = []
    handler = lambda m: cerr.append((m.type, m.text))
    pg.on("console", handler)
    try:
        seed_storage(pg, origin, save_raw=None, settings_raw=None, clear=True)
        del cerr[:]
        pg.goto(url, wait_until="load", timeout=60_000)
        b = wait_boot(pg)
        if not s.check(b["global"] and b["bootGone"], "boot", json.dumps(b)):
            return s

        pre = pg.evaluate(AUDIO_STATE_JS)
        s.check(pre["hasCtx"] is False,
                "no AudioContext before the first gesture", "ctx=%s" % pre["hasCtx"])

        label = click_play_for_real(pg)
        s.check(label is not None, "PLAY clicked with a real mouse press", label)
        pg.wait_for_timeout(2500)

        post = pg.evaluate(AUDIO_STATE_JS)
        s.check(post["hasCtx"] and post["ready"], "context built on the gesture",
                "ctx=%s ready=%s" % (post["hasCtx"], post["ready"]))
        s.check(post["state"] == "running", "context is RUNNING after the gesture",
                "state=%s" % post["state"])
        s.check(post["activeBeds"] and post["activeBeds"] > 0, "a music bed is scheduling",
                "activeBeds=%s theme=%s" % (post["activeBeds"], post["theme"]))

        s.check(pg.evaluate(TAP_JS), "analyser tap installed on the limiter")
        pg.wait_for_timeout(1200)
        rms_play = max(pg.evaluate(RMS_JS) for _ in _repeat(pg, 8, 150))
        s.check(rms_play > 0.002, "the bed is actually audible", "rms=%.5f" % rms_play)

        # ---- battery: 4 crossfades, duck, finish, 200 rapid sfx ----
        pg.evaluate("() => { window.__AP.throws.length = 0; window.__AP.bad.length = 0; }")
        base_calls = pg.evaluate("() => window.__AP.calls")
        for theme in ("foundry", "spire", "temple", "hub"):
            pg.evaluate("(t) => ASCENDANT.game.audio.setTheme(t)", theme)
            pg.wait_for_timeout(1500)
        pg.evaluate("() => { const a = ASCENDANT.game.audio; a.duck(700); a.sfx('death'); }")
        pg.wait_for_timeout(900)
        pg.evaluate("() => { const a = ASCENDANT.game.audio; a.sfx('finish'); a.duck(900); }")
        pg.wait_for_timeout(1200)
        pg.evaluate(
            """() => {
                 const a = ASCENDANT.game.audio;
                 const names = ['jump','land','land_hard','step','step_metal','step_ice',
                                'coin','checkpoint','bounce','laser','crush','vanish',
                                'lava_bubble','ui_move','ui_ok','ui_cancel'];
                 for (let i = 0; i < 200; i++) a.sfx(names[i % names.length], {gain: 0.4});
               }"""
        )
        pg.wait_for_timeout(1500)
        # positional loops too - they own the other half of the graph
        pg.evaluate(
            """() => {
                 const a = ASCENDANT.game.audio;
                 const L = {position: {x: 0, y: 0, z: 0}};
                 for (const n of ['saw_whirr','wind','portal_hum','lava_flow']) {
                   const h = a.sfx(n, {key: 'pc_' + n, pos: {x: 2, y: 0, z: 3}, listener: L});
                   if (h && h.setPos) h.setPos({x: 20, y: 0, z: 3}, L);
                 }
               }"""
        )
        pg.wait_for_timeout(900)
        pg.evaluate("() => { const a = ASCENDANT.game.audio; "
                    "for (const n of ['saw_whirr','wind','portal_hum','lava_flow']) a.stopLoop('pc_' + n, 80); }")
        pg.wait_for_timeout(600)

        bat = pg.evaluate(AUDIO_STATE_JS)
        s.check(len(bat["apThrows"]) == 0, "no AudioParam/AudioNode call threw",
                "%d throws, %d calls: %s" %
                (len(bat["apThrows"]), bat["apCalls"] - base_calls, bat["apThrows"][:6]))
        s.check(len(bat["apBad"]) == 0, "no non-finite AudioParam arguments",
                bat["apBad"][:6])
        s.check(bat["state"] == "running", "context still running after the battery",
                bat["state"])
        s.check(bat["sfxLive"] is not None and bat["sfxLive"] <= 64,
                "sfx voice bookkeeping did not run away", "sfxLive=%s" % bat["sfxLive"])
        s.check(bat["loops"] == 0, "loop handles all released", "loops=%s" % bat["loops"])
        aud_console = [t for (k, t) in cerr
                       if k in ("error", "warning")
                       and any(m in t for m in ("AudioParam", "AudioContext", "Web Audio",
                                                "audio", "autoplay"))]
        s.check(len(aud_console) == 0, "no audio warnings/errors on the console",
                aud_console[:4])

        # ---- page-level mute wrapper ----
        pg.evaluate("() => window.__CONTROLS__.toggleMute()")
        pg.wait_for_timeout(900)
        muted = pg.evaluate(AUDIO_STATE_JS)
        t0 = muted["currentTime"]
        pg.wait_for_timeout(1200)
        t1 = pg.evaluate("() => ASCENDANT.game.audio.ctx.currentTime")
        s.check(muted["state"] == "suspended", "mute suspends the context", muted["state"])
        s.check(muted["pageMuted"] is True, "audio.js saw the mutechange event",
                muted["pageMuted"])
        s.check(abs(t1 - t0) < 0.05, "the audio clock is frozen while muted",
                "dt=%.4f s" % (t1 - t0))
        # while muted, sfx must not queue a backlog or resume behind the mute
        pg.evaluate("() => { const a = ASCENDANT.game.audio;"
                    " for (let i = 0; i < 40; i++) a.sfx('coin'); a.setTheme('neon'); }")
        pg.wait_for_timeout(800)
        still = pg.evaluate(AUDIO_STATE_JS)
        s.check(still["state"] == "suspended", "sfx while muted never resumes behind the mute",
                still["state"])

        pg.evaluate("() => window.__CONTROLS__.toggleMute()")
        pg.wait_for_timeout(1600)
        un = pg.evaluate(AUDIO_STATE_JS)
        s.check(un["state"] == "running", "unmute resumes the context", un["state"])
        rms_un = max(pg.evaluate(RMS_JS) for _ in _repeat(pg, 10, 200))
        s.check(rms_un > 0.002, "sound comes back after unmute", "rms=%.5f" % rms_un)
        s.check(len(pg.evaluate("() => window.__AP.throws")) == 0,
                "mute/unmute cycle threw nothing",
                pg.evaluate("() => window.__AP.throws.slice(0,6)"))

        # ---- real tab hide / return ----
        other = ctx.new_page()
        other.goto("about:blank")
        other.bring_to_front()
        time.sleep(6.0)
        other.close()
        pg.bring_to_front()
        pg.wait_for_timeout(2500)
        back = pg.evaluate(AUDIO_STATE_JS)
        s.check(back["state"] == "running",
                "context is running again after the tab comes back", back["state"])
        tb0 = pg.evaluate("() => ASCENDANT.game.audio.ctx.currentTime")
        pg.wait_for_timeout(1200)
        tb1 = pg.evaluate("() => ASCENDANT.game.audio.ctx.currentTime")
        s.check(tb1 - tb0 > 0.4, "the audio clock advances again", "dt=%.3f s" % (tb1 - tb0))
        rms_back = max(pg.evaluate(RMS_JS) for _ in _repeat(pg, 12, 200))
        s.check(rms_back > 0.002, "the bed is audible again, not silently 'playing'",
                "rms=%.5f" % rms_back)
        s.check(back["activeBeds"] and back["activeBeds"] > 0,
                "a bed survived the hide", "activeBeds=%s" % back["activeBeds"])
        s.check(len(pg.evaluate("() => window.__AP.throws")) == 0,
                "tab hide/return threw nothing",
                pg.evaluate("() => window.__AP.throws.slice(0,6)"))
    finally:
        pg.remove_listener("console", handler)
    return s


def _repeat(pg, n, ms):
    for i in range(n):
        if i:
            pg.wait_for_timeout(ms)
        yield i


# ---------------------------------------------------------------------------
# SECTION: boot parameters
# ---------------------------------------------------------------------------
BOOT_CASES = [
    ("?quality=low", "?quality=low", {"quality": "low"}),
    ("?quality=ultra", "?quality=ultra", {"quality": "ultra"}),
    ("?quality=banana", "?quality=banana", {"qualityValid": True}),
    ("?stage=neon-2", "?stage=neon-2", {"pending": "neon-2"}),
    ("?mode=ai", "?mode=ai", {"state": "title"}),
    ("?mode=online", "?mode=online", {"state": "title"}),
    ("?mode=ai&stage=spire-1", "?mode=ai&stage=spire-1", {"state": "title", "pending": "spire-1"}),
    ("no params", "", {"state": "title"}),
]

BOOT_STATE_JS = r"""() => {
  const A = ASCENDANT;
  const boot = document.getElementById('boot');
  return {
    bootGone: !boot || boot.classList.contains('gone'),
    failCard: !!document.getElementById('asc-fail'),
    nogpu: (() => { const n = document.getElementById('nogpu');
                    return !!(n && getComputedStyle(n).display !== 'none'); })(),
    state: A.game.state,
    quality: A.Settings.qualityId(),
    qualityValid: ['low','medium','high','ultra'].indexOf(A.Settings.qualityId()) >= 0,
    pending: A.game._pendingStage,
    menuOpen: !!document.querySelector('button.asc-btn'),
    paramNotice: !!document.getElementById('asc-param-notice'),
  };
}"""

NOTICE_JS = r"""(id) => {
  const n = document.getElementById(id);
  if (!n) return {present: false};
  const r = n.getBoundingClientRect();
  return {present: true, shown: r.width > 40 && r.height > 20 && parseFloat(getComputedStyle(n).opacity) > 0.9,
          text: (n.innerText || '').replace(/\s+/g, ' ').slice(0, 200)};
}"""

FAIL_JS = r"""() => {
  const f = document.getElementById('asc-fail');
  const boot = document.getElementById('boot');
  return {failCard: !!f, text: f ? (f.innerText || '').replace(/\s+/g, ' ').slice(0, 300) : '',
          bootHidden: !boot || getComputedStyle(boot).display === 'none' || boot.classList.contains('gone'),
          bootMsg: boot ? (document.getElementById('boot-msg') || {}).textContent : null};
}"""


def sec_boot(pg, url, origin, ctx, boot_js_override=None):
    s = Section("boot")
    base = url.split("?")[0]
    for label, qs, want in BOOT_CASES:
        errs = []
        h = lambda e, box=errs: box.append(str(e))
        pg.on("pageerror", h)
        try:
            seed_storage(pg, origin, save_raw=None, settings_raw=None, clear=True)
            pg.goto(base + ("?" + qs.lstrip("?") if qs else ""), wait_until="load", timeout=60_000)
            b = wait_boot(pg)
            st = pg.evaluate(BOOT_STATE_JS) if b["global"] else None
        finally:
            pg.remove_listener("pageerror", h)
        if not s.check(b["global"] and b["bootGone"] and not errs,
                       "%s: boots and the #boot overlay goes away" % label,
                       "global=%s bootGone=%s pageerrors=%s" % (b["global"], b["bootGone"], errs[:2])):
            continue
        s.check(not st["failCard"] and not st["nogpu"], "%s: no failure card" % label,
                "fail=%s nogpu=%s" % (st["failCard"], st["nogpu"]))
        for k, v in want.items():
            s.check(st.get(k) == v, "%s: %s == %r" % (label, k, v), "got %r" % st.get(k))
        s.check(st["menuOpen"], "%s: the title menu is the first thing shown" % label)
        s.check(not st["paramNotice"], "%s: no 'unknown stage' notice for a valid link" % label)

        if qs == "?stage=neon-2":
            # The contract says PLAY loads the ?stage= stage. The title's PLAY
            # routes through style.js uiAction('play') -> callFirst(game,
            # ['startRun','newRun','beginRun','returnToHub']); Game has none of
            # the first three, so PLAY reloads the hub and Game.startGame() - the
            # only consumer of _pendingStage - is never reached from the UI.
            wait_title(pg)
            box = title_button_box(pg, "tBtnPlay")
            if box and box["w"] > 4:
                pg.mouse.click(box["x"], box["y"])
            loaded = wait_stage(pg, "neon-2", 20)
            s.check(bool(loaded) and loaded["id"] == "neon-2", "%s: PLAY loads the ?stage= stage" % label,
                    "after PLAY: %s pending=%s" % (json.dumps(loaded), pg.evaluate("ASCENDANT.game._pendingStage")),
                    xfail="style.js uiAction('play') never reaches Game.startGame() (no startRun/newRun/beginRun on Game) - PLAY calls returnToHub()")

    # ---- a ?stage= id that is not a stage: said so, visibly, then ignored ----
    seed_storage(pg, origin, save_raw=None, settings_raw=None, clear=True)
    pg.goto(base + "?stage=not-a-real-stage", wait_until="load", timeout=60_000)
    b = wait_boot(pg)
    s.check(b["global"] and b["bootGone"], "?stage=not-a-real-stage still boots to the menu",
            json.dumps(b))
    pg.wait_for_timeout(700)
    n = pg.evaluate(NOTICE_JS, "asc-param-notice")
    s.check(n["present"] and n["shown"] and "not-a-real-stage" in n["text"],
            "an unknown ?stage= id is reported to the player, visibly, naming the id",
            json.dumps(n))
    s.check(pg.evaluate("ASCENDANT.game._pendingStage") is None,
            "the unknown id is not handed to the game", "pending=%r" % pg.evaluate("ASCENDANT.game._pendingStage"))
    act_play(pg)
    pg.wait_for_timeout(2500)
    err = pg.evaluate(
        """() => ({state: ASCENDANT.game.state, frames: ASCENDANT.game.frames,
                   failCard: !!document.getElementById('asc-fail')})"""
    )
    s.check(err["state"] in ("hub", "playing"), "PLAY still works - the game falls back to a live state",
            err["state"])
    s.check(not err["failCard"], "one bad stage id does not kill the whole runtime", err["failCard"])
    frames0 = err["frames"]
    pg.wait_for_timeout(1200)
    s.check(pg.evaluate("() => ASCENDANT.game.frames") > frames0,
            "the render loop keeps running after the ignored id")

    # ---- a module fetch that stalls forever must NOT leave the splash forever ----
    # (real-world analogue: a CDN request that hangs.) The watchdog window is
    # shortened through the documented harness hook so this runs in seconds.
    pg2 = ctx.new_page()
    pg2.add_init_script(INIT_JS + "\nwindow.__ASCENDANT_BOOT_STALL_MS = 6000;")
    if boot_js_override:
        _serve_override(pg2, boot_js_override)
    pg2.route("**/runtime/ui/menu.js*", lambda route: None)   # never fulfilled, never aborted
    t0 = time.time()
    try:
        pg2.goto(base, wait_until="load", timeout=60_000)
    except Exception as e:
        pass
    card = None
    while time.time() - t0 < 45:
        try:
            card = pg2.evaluate(FAIL_JS)
        except Exception:
            card = None
        if card and card["failCard"]:
            break
        pg2.wait_for_timeout(500)
    dt = time.time() - t0
    s.check(bool(card) and card["failCard"], "a stalled module fetch ends in the failure card, not a splash forever",
            "after %.1fs: %s" % (dt, json.dumps(card)))
    s.check(bool(card) and card["failCard"] and "stalled" in card["text"].lower() and "interface" in card["text"].lower(),
            "the card names the stall and the phase that hung", (card or {}).get("text", "")[:160])
    s.check(bool(card) and card["bootHidden"], "the #boot splash is out of the way once the card shows",
            json.dumps({k: (card or {}).get(k) for k in ("bootHidden", "bootMsg")}))
    pg2.unroute("**/runtime/ui/menu.js*")
    pg2.close()

    # ---- a RUNTIME stage-load failure (module aborted) - what the player sees ----
    pg3 = ctx.new_page()
    pg3.add_init_script(INIT_JS)
    pg3.route("**/runtime/data/stages/neon-2.js*", lambda route: route.abort())
    seed_storage(pg3, origin, save_raw=None, settings_raw=None, clear=True)
    pg3.goto(base, wait_until="load", timeout=60_000)
    b = wait_boot(pg3)
    act_play(pg3)
    pg3.wait_for_timeout(1500)
    pg3.evaluate("() => { ASCENDANT.game.loadStage('neon-2').catch(() => {}); }")
    seen = {"toast": False, "visibleSamples": 0, "samples": 0, "text": ""}
    t0 = time.time()
    while time.time() - t0 < 5:
        o = pg3.evaluate(
            """() => { const t = document.querySelector('.ah-toast'); const p = document.querySelector('.ah-play');
                       return {toast: !!t, text: t ? t.textContent.trim().slice(0, 80) : '',
                               visible: !!(t && p && parseFloat(getComputedStyle(p).opacity) > 0.5)}; }""")
        seen["samples"] += 1
        if o["toast"]:
            seen["toast"] = True
            seen["text"] = o["text"]
            if o["visible"]:
                seen["visibleSamples"] += 1
        pg3.wait_for_timeout(120)
    # a toast lives 2.6 s; "readable" means it stayed visible for most of that,
    # not that one sample caught .ah-play mid-fade
    seen["toastVisible"] = seen["visibleSamples"] >= 10
    after = pg3.evaluate(
        """() => ({state: ASCENDANT.game.state, stageId: ASCENDANT.game.stageId,
                   suspended: !!(ASCENDANT.game.input && ASCENDANT.game.input.suspended),
                   hudVisible: !!(ASCENDANT.game.hud && ASCENDANT.game.hud._visible),
                   failCard: !!document.getElementById('asc-fail'), frames: ASCENDANT.game.frames})""")
    # 'paused' counts as live: a focus change while the probe drives two pages
    # pauses the game (pause('blur')) - the loop still runs and the menu is up.
    s.check(not after["failCard"] and after["state"] in ("hub", "playing", "paused"),
            "a runtime load failure falls back to a live state", json.dumps(after))
    s.check(seen["toast"], "a runtime load failure raises the 'COULD NOT LOAD' toast", json.dumps(seen))
    s.check(seen["toastVisible"], "...and the player can actually SEE it (visible >= 1.2 s of its 2.6 s life)",
            json.dumps(seen),
            xfail="game.js _onLoadError() toasts into hud.nPlay, which loadStage() hid (setVisible(false)) and never re-shows")
    pg3.unroute("**/runtime/data/stages/neon-2.js*")
    pg3.close()
    return s


def _serve_override(pg, path):
    """A/B helper: serve an alternate boot.js (e.g. the committed one) so the
    same probe can show the defect before and after."""
    body = open(path, "rb").read()
    pg.route("**/runtime/boot.js*", lambda route: route.fulfill(
        status=200, body=body, headers={"Content-Type": "text/javascript", "Cache-Control": "no-store"}))


# ---------------------------------------------------------------------------
SECTIONS = {
    "save": sec_save,
    "corrupt": sec_corrupt,
    "settings": sec_settings,
    "audio": sec_audio,
    "boot": sec_boot,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--only", default="", help="comma list: save,corrupt,settings,audio,boot")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--json", default=os.path.join(HERE, "persistcheck.json"))
    ap.add_argument("--boot-js", default=None,
                    help="serve this file as runtime/boot.js (A/B a boot.js against the same probe)")
    args = ap.parse_args()

    want = [x.strip() for x in args.only.split(",") if x.strip()] or list(SECTIONS.keys())
    bad = [w for w in want if w not in SECTIONS]
    if bad:
        print("unknown section(s): %s" % ", ".join(bad), file=sys.stderr)
        return 2

    parts = args.url.split("/")
    origin = "/".join(parts[:3])

    print("=" * 74)
    print("ASCENDANT persistcheck   (PRODUCTION mode - no ?dev=1, no autoplay flag)")
    print("URL      : %s" % args.url)
    print("sections : %s" % ", ".join(want))
    if args.boot_js:
        print("boot.js  : OVERRIDE %s" % args.boot_js)
    print("=" * 74)

    results = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        ctx = br.new_context(viewport={"width": args.width, "height": args.height})
        pg = ctx.new_page()
        pg.add_init_script(INIT_JS)
        if args.boot_js:
            _serve_override(pg, args.boot_js)
        for name in want:
            try:
                if name == "audio":
                    sec = SECTIONS[name](pg, args.url, origin, ctx)
                elif name == "boot":
                    sec = SECTIONS[name](pg, args.url, origin, ctx, args.boot_js)
                else:
                    sec = SECTIONS[name](pg, args.url, origin)
            except Exception as e:
                sec = Section(name)
                sec.check(False, "section crashed", "%s: %s" % (type(e).__name__, e))
            sec.dump()
            results.append(sec)
        ctx.close()
        br.close()

    fails = [(s.name, lbl, det) for s in results for (ok, lbl, det, xf) in s.rows if not ok and not xf]
    xfails = [(s.name, lbl, xf) for s in results for (ok, lbl, det, xf) in s.rows if not ok and xf]
    xpass = [(s.name, lbl, xf) for s in results for (ok, lbl, det, xf) in s.rows if ok and xf]
    total = sum(len(s.rows) for s in results)
    print("=" * 74)
    if fails:
        print("FAILURES (%d of %d checks):" % (len(fails), total))
        for name, lbl, det in fails:
            print("  x [%s] %s   %s" % (name, lbl, det))
    else:
        print("all %d in-lane checks passed" % (total - len(xfails) - len(xpass)))
    if xfails:
        print("OPEN, OUT OF LANE (%d, reproduced here, not counted):" % len(xfails))
        for name, lbl, xf in xfails:
            print("  ~ [%s] %s   -> %s" % (name, lbl, xf))
    if xpass:
        print("XPASS (%d): previously open defects now passing - drop the xfail:" % len(xpass))
        for name, lbl, xf in xpass:
            print("  + [%s] %s" % (name, lbl))
    print("=" * 74)
    print("VERDICT: %s" % ("PERSIST OK" if not fails else "PERSIST BROKEN"))

    try:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({
                "url": args.url,
                "sections": {s.name: [{"ok": o, "label": l, "detail": d, "xfail": xf} for (o, l, d, xf) in s.rows]
                             for s in results},
                "failing": len(fails),
                "xfail": len(xfails),
                "xpass": len(xpass),
                "total": total,
            }, fh, indent=2)
    except Exception:
        pass

    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
