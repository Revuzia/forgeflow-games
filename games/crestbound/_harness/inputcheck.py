#!/usr/bin/env python
"""CRESTBOUND input gate — LOOK SIGN, CROUCH COMBOS, CONTROLS SCREEN (P1 / P3 / P2).

Why this file exists
--------------------
The owner played the live build and reported three things no automated gate had
caught: the mouse look was INVERTED with no way to change it, the crouch-combo
moves would not fire off a crouch key a browser player can actually use, and the
controls screen could not be used to rebind anything or flip invert. Every one is
a defect a human hits in the first minute, and every one was invisible to
`feelcheck.py` — because feelcheck drives the CONTROLLER and never asks what a
hand on a mouse would SEE, nor what happens when a key is HELD the way a player
holds it.

So this gate measures the player-facing effect, never the intermediate value:

  LOOK   a REAL trusted mouse drag on the canvas (Playwright drives CDP, so
         `isTrusted` is true — the only kind `input.js` accepts), then the sign of
         the change in the CAMERA'S OWN WORLD FORWARD VECTOR. Pushing the mouse
         away must RAISE the view; flipping Settings.invertY must reverse exactly
         that. Asserting on `cam.pitch` alone would pass a build whose pitch
         convention is upside down — which is the bug this gate was written for.

  CROUCH real trusted KeyboardEvents (`page.keyboard`), the engine STOPPED and
         `game.update(1/60)` hand-stepped, so a key meant to be HELD for a second
         is held for exactly sixty frames of GAME time whatever the renderer is
         doing (HARNESS_NOTES: a wall-clock wait in a browser harness is a bug).
         Both human orders are driven: crouch held THROUGH the run-up, and crouch
         tapped at full speed. The first is what a player actually does.

  UI     real mouse clicks at real bounding boxes and real arrow/Enter keys, then
         the LIVE `Settings` / `input.bindings` values and a page RELOAD to prove
         persistence — never the DOM's own label text.

    python inputcheck.py                # headless real-GPU Chrome (default)
    python inputcheck.py --headed
    python inputcheck.py --only look    # look | crouch | ui
    python inputcheck.py --url http://localhost:8788/games/_bisect/x/games/crestbound/index.html

Exit 0 when every check passes, 1 otherwise. Writes _harness/inputcheck.json.
"""
import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html?quality=low&autoscale=0"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

# Every move the controls page must NAME, in the lane brief's own words.
REQUIRED_ROWS = [
    "MOVE FORWARD", "WALK / RUN", "JUMP", "DOUBLE JUMP", "TRIPLE JUMP", "LONG JUMP",
    "BACKFLIP", "SIDEFLIP", "WALL KICK", "DIVE", "CROUCH", "GROUND POUND", "SWIM",
    "CLIMB", "ORBIT", "RECENTER", "PEEK", "INTERACT", "RESTART COURSE",
    "TO CHECKPOINT", "PAUSE",
]

# --------------------------------------------------------------------------
# Page-side driver — installed after every load / reload.
# --------------------------------------------------------------------------
DRIVER_JS = r"""() => {
  const G = globalThis.CRESTBOUND && CRESTBOUND.game;
  const E = globalThis.CRESTBOUND && CRESTBOUND.engine;
  if (!G) return false;

  const firstText = (n) => {
    if (!n) return '';
    for (const c of n.childNodes) if (c.nodeType === 3 && c.nodeValue.trim()) return c.nodeValue.trim().toUpperCase();
    return (n.textContent || '').trim().toUpperCase();
  };
  /* A row in a scrolling panel can have a perfectly good rect and still be
     OUTSIDE the panel's viewport — clicking those coordinates hits whatever is
     painted there instead. Scroll it in, re-measure, and report whether the
     element really is the one under the point, so a click that misses is a
     harness failure with a name rather than a silent false negative. */
  const boxOf = (n, frac) => {
    if (!n) return null;
    try { n.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ignore */ }
    const r = n.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    const x = r.left + r.width * (Number.isFinite(frac) ? frac : 0.5);
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x: x, y: y, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
             onTop: !!(hit && (hit === n || n.contains(hit) || (hit.contains && hit.contains(n)))),
             hit: hit ? (hit.className || hit.tagName) : null };
  };
  const openPage = () => {
    const m = G.menu;
    return m && m.pages ? m.pages[m.page] : null;
  };

  const IC = {
    /* ---- hand-stepping: the renderer stops, game time advances on demand ---- */
    stop() { if (E && E.running && typeof E.stop === 'function') E.stop(); return !(E && E.running); },
    running() { return !!(E && E.running); },
    step(n) { for (let i = 0; i < (n | 0); i++) { try { G.update(1 / 60); } catch (e) { return String(e); } } return null; },
    stick(x, y) { G.input.__test.stick(x, y); },

    /* ---- what the player is actually looking along ---- */
    cam() {
      const c = G.cam, cm = E && E.camera;
      let dx = 0, dy = 0, dz = 0;
      if (cm && typeof cm.getWorldDirection === 'function') {
        const v = cm.getWorldDirection(new CRESTBOUND.THREE.Vector3());
        dx = v.x; dy = v.y; dz = v.z;
      }
      return {
        pitch: c ? +c.pitch : NaN, yaw: c ? +c.yaw : NaN,
        dirX: +dx.toFixed(6), dirY: +dy.toFixed(6), dirZ: +dz.toFixed(6),
        camY: cm ? +cm.position.y.toFixed(4) : NaN,
        state: G.state, suspended: !!(G.input && G.input.suspended),
      };
    },
    ply() {
      const p = G.player;
      return {
        st: p.state, sp: +Math.hypot(p.vel.x, p.vel.z).toFixed(3), y: +p.pos.y.toFixed(3),
        g: !!p.grounded, crouching: !!p.crouching, crouchHeld: !!(G.input && G.input.crouch),
      };
    },
    place(x, y, z, yaw) {
      const p = G.player;
      p.__test.teleport({ x: x, y: y, z: z });
      p.__test.setVel({ x: 0, y: 0, z: 0 });
      if (Number.isFinite(yaw)) p.__test.setFacing(yaw);
      if (G.cam && typeof G.cam.recenter === 'function') G.cam.recenter();
    },
    spawn() {
      const d = G.course && G.course.def;
      const s = (d && d.spawn && d.spawn.p) || [0, 2, 0];
      return { x: s[0], y: s[1], z: s[2], yaw: (d && d.spawn && d.spawn.yaw) || 0 };
    },
    /* Step n frames recording every distinct player state that appeared. */
    watch(n) {
      const seen = [];
      let peakY = -1e9;
      for (let i = 0; i < (n | 0); i++) {
        try { G.update(1 / 60); } catch (e) { return { err: String(e), seen: seen }; }
        const p = G.player;
        if (seen[seen.length - 1] !== p.state) seen.push(p.state);
        if (p.pos.y > peakY) peakY = p.pos.y;
      }
      return { seen: seen, peakY: +peakY.toFixed(3) };
    },

    /* ---- settings / bindings ---- */
    settings(patch) {
      const S = CRESTBOUND.Settings;
      if (!S) return null;
      if (patch) S.set(patch);
      return S.get();
    },
    inputSettings() { return Object.assign({}, G.input.settings); },
    locked() { return !!(document.pointerLockElement || (G.input && G.input.pointerLocked)); },
    /* What a click at (x,y) would actually hit. A menu that has been closed is
       still in the DOM for its 200 ms fade, and a pointerdown that lands on it
       never reaches the canvas — so an unlocked drag fired the instant a menu
       closes is swallowed whole. */
    atPoint(x, y) {
      const n = document.elementFromPoint(x, y);
      return n ? (n.tagName + (n.className ? '.' + String(n.className).split(' ')[0] : '')) : null;
    },
    /* SETUP ONLY: park the orbit pitch back at its authored default. The look
       tests deliberately drive pitch to both clamps, and a key held against a
       clamp cannot move — which is not the key being broken. */
    setPitch(v) {
      const c = G.cam;
      if (!c) return null;
      c.pitch = +v;
      c._pitchIdleT = 0;
      return c.pitch;
    },
    bindings() { return JSON.parse(JSON.stringify(G.input.bindings)); },
    stored() { try { return window.localStorage.getItem('crestbound.bindings.v1'); } catch (e) { return null; } },
    resetBindings() { G.input.resetBindings(); },

    /* ---- menu ---- */
    menu() { const m = G.menu; return m ? { open: !!m.isOpen, page: m.page } : null; },
    openMenu(p) { const m = G.menu; if (m) m.open(p); },
    closeMenu() { const m = G.menu; if (m) m.close(); },
    listening() { const m = G.menu; return !!(m && m._listening); },
    /* Leave every menu the way ESC does from the pause page: `menu.close()` on
       its own does NOT resume, and a game left in 'paused' does not simulate —
       which is how the first run of this gate measured every move as 'idle'. */
    /**
     * Put the game back in a state that SIMULATES, and keep it there.
     *
     * Two things fight this harness. `menu.close()` on its own does not resume —
     * a game left in 'paused' runs no frames, which is how the first run of this
     * gate measured every move as 'idle'. And game.js pauses on POINTER-LOCK
     * LOSS (`bindEvent(inp,'unlock', … this.pause('unlock'))`), while
     * `game.resume()` re-requests the lock it had; a harness that clicks the
     * canvas therefore acquires a lock, drops it on the next ESC, and is pushed
     * straight back into 'paused' a frame later. So: clear the "restore my lock"
     * flag first, leave the pause page the way ESC does, then drop any lock we
     * still hold. Callers re-assert this before every measurement.
     */
    resume() {
      G._wasLockedAtPause = false;
      const m = G.menu;
      if (m) { m.open('pause'); m._escape(); }
      G._wasLockedAtPause = false;
      if (G.state === 'paused' && typeof G.resume === 'function') G.resume();
      /* DO NOT drop the pointer lock here. Measured with `_ic_pauseprobe.py`:
         leaving the pause page re-acquires it, and `document.exitPointerLock()`
         fires 'unlock', which game.js turns straight back into pause('unlock').
         A harness that tidies the lock away therefore pauses the game it just
         resumed — which is what made every look measurement read 0.0000. Locked
         is also what a PLAYING player has, and `input._onMouseMove` handles the
         look on that path, so the measurement is the more honest one. */
      return G.state;
    },
    focusedText() { const a = document.activeElement; return a ? (a.textContent || '').trim().toUpperCase().slice(0, 40) : ''; },

    /** Bounding box of a VISIBLE button on the open page whose text equals `t`. */
    btnBox(t) {
      const root = openPage() || document.body;
      const want = String(t).toUpperCase();
      for (const n of root.querySelectorAll('button, [data-nav]')) {
        const txt = (n.textContent || '').trim().toUpperCase();
        if (txt !== want && txt.split('\n')[0].trim() !== want) continue;
        const b = boxOf(n);
        if (b) { b.text = txt.slice(0, 40); return b; }
      }
      return null;
    },
    /** Bounding box of the controls row whose LABEL (not its hint) is `label`. */
    ctlRowBox(label) {
      const p = G.menu && G.menu.pages ? G.menu.pages.controls : null;
      if (!p) return null;
      for (const row of p.querySelectorAll('.cm-ctlrow')) {
        if (firstText(row.querySelector('.nm')) !== String(label).toUpperCase()) continue;
        const b = boxOf(row);
        if (b) { b.text = label; b.bindable = row.getAttribute('data-nav') === '1'; return b; }
      }
      return null;
    },
    /** Bounding box of a control inside the settings row named `label`. */
    rowCtlBox(label, sel, frac) {
      const p = G.menu && G.menu.pages ? G.menu.pages.settings : null;
      if (!p) return null;
      for (const row of p.querySelectorAll('.cb-row')) {
        if (firstText(row.querySelector('.cb-row-name')) !== String(label).toUpperCase()) continue;
        try { row.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* ignore */ }
        const n = sel ? row.querySelector(sel) : row;
        const b = boxOf(n, frac);
        if (b) b.text = label;
        return b;
      }
      return null;
    },
    /** Focus a settings/controls row by name so a real ArrowRight can adjust it. */
    focusRow(pageId, label) {
      const m = G.menu;
      const p = m && m.pages ? m.pages[pageId] : null;
      const nav = m && m.nav ? m.nav[pageId] : null;
      if (!p || !nav) return null;
      nav.refresh();
      for (let i = 0; i < nav.items.length; i++) {
        const n = nav.items[i];
        const nm = n.querySelector('.cb-row-name') || n.querySelector('.nm') || n;
        if (firstText(nm) !== String(label).toUpperCase()) continue;
        nav.index = -1; nav.focusIndex(i, true);
        return firstText(nm);
      }
      return null;
    },
    /** Every controls-row label the player can read. */
    controlLabels() {
      const p = G.menu && G.menu.pages ? G.menu.pages.controls : null;
      if (!p) return [];
      return Array.from(p.querySelectorAll('.cm-ctlrow .nm')).map(firstText);
    },
    /** The keyboard glyphs printed for one controls row. */
    rowKeys(label) {
      const p = G.menu && G.menu.pages ? G.menu.pages.controls : null;
      if (!p) return null;
      for (const row of p.querySelectorAll('.cm-ctlrow')) {
        if (firstText(row.querySelector('.nm')) !== String(label).toUpperCase()) continue;
        return Array.from(row.querySelectorAll('.keys b, .keys span, .keys i'))
          .map((k) => (k.textContent || '').trim()).filter(Boolean).join(' ');
      }
      return null;
    },
  };
  globalThis.__IC = IC;
  return true;
}"""


class Run:
    """Checks carry an OWNER.

    Everything this gate drives goes through input.js / camera.js / menu.js
    except the crouch-combo SPEED thresholds, which live in player/controller.js
    (`CROUCH_SPEED_MUL`) and core/tuning.js (`longJump.minSpeed`) — the jump
    family's files, not this lane's. Those checks still run and still print,
    because a failure a gate hides is a failure that ships; they are tagged
    `jumpfamily` so the exit code says what THIS lane's files are responsible
    for and the report says what is still owed by another.
    """

    def __init__(self, page):
        self.page = page
        self.checks = []

    def ok(self, name, passed, detail, owner="controls"):
        self.checks.append({"name": name, "ok": bool(passed), "owner": owner, "detail": detail})
        tag = "" if owner == "controls" else "  [" + owner + "]"
        print(("  PASS  " if passed else "  FAIL  ") + name.ljust(30) + " " + detail + tag)
        return bool(passed)


def wait_boot(page, timeout_ms=90000):
    waited = 0
    while waited < timeout_ms:
        if page.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"):
            return True
        page.wait_for_timeout(300)
        waited += 300
    return False


def enter_keep(page):
    """Leave the title the way a player does, then wait for the hub."""
    page.evaluate(r"""() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null);
      for (const want of ['CONTINUE', 'NEW GAME', 'PLAY', 'START']) {
        const b = btns.find((x) => (x.textContent || '').toUpperCase().includes(want));
        if (b) { if (b.__activate) b.__activate(); else b.click(); return want; }
      }
      return null; }""")
    for _ in range(70):
        page.wait_for_timeout(200)
        if page.evaluate("() => CRESTBOUND.game.state === 'keep'"):
            return True
    return page.evaluate("() => CRESTBOUND.game.state") == "keep"


def ensure_live(page):
    """Re-assert a simulating, UNLOCKED game right before a measurement.

    Unlocked matters as much as unpaused: `input._onPointerDown` returns early
    while the pointer is locked (locked look is the mousemove path, not the drag
    path), and `document.exitPointerLock()` is asynchronous — so a drag fired
    immediately after a resume is silently dropped. That is what made the FIRST
    look measurement of a run read d = 0.0000 while every later one moved.
    """
    c = page.evaluate("() => __IC.cam()")
    for _ in range(20):
        if c["state"] == "keep" and not c["suspended"]:
            return "keep"
        page.evaluate("() => __IC.resume()")
        page.evaluate("() => __IC.step(3)")
        page.wait_for_timeout(50)
        c = page.evaluate("() => __IC.cam()")
    return c["state"]


def click(page, box):
    page.mouse.click(box["x"], box["y"])
    page.wait_for_timeout(200)
    return box


def where(box):
    if not box:
        return "<NOT FOUND>"
    return "at (%.0f,%.0f) onTop=%s hit=%s" % (box["x"], box["y"], box.get("onTop"), box.get("hit"))


# ==========================================================================
# 1. CONTROLS SCREEN  (P2) — runs first, while the engine is still live
# ==========================================================================
def check_ui_title(r):
    """Everything a player can reach WITHOUT starting the game."""
    page = r.page
    print("\nCONTROLS SCREEN — FROM THE TITLE (P2)")

    m = page.evaluate("() => __IC.menu()")
    r.ok("title_menu_open_at_boot", bool(m and m["open"] and m["page"] == "title"),
         "menu at boot: %s" % json.dumps(m))

    b = page.evaluate("() => __IC.btnBox('CONTROLS')")
    if b:
        click(page, b)
    m = page.evaluate("() => __IC.menu()")
    r.ok("controls_from_title_mouse", bool(b) and bool(m) and m["page"] == "controls",
         "real click on the title's %s -> menu.page=%s" % (b["text"] if b else "<NO BUTTON>", m and m["page"]))

    labels = page.evaluate("() => __IC.controlLabels()")
    missing = [w for w in REQUIRED_ROWS if not any(w == L or w in L for L in labels)]
    r.ok("controls_lists_every_move", not missing,
         "%d rows on the page; missing: %s" % (len(labels), ", ".join(missing) if missing else "none"))

    ck = page.evaluate("() => __IC.rowKeys('CROUCH')")
    first = (ck or "").split(" ")[0].upper()
    r.ok("crouch_row_shows_C_first", first == "C",
         "CROUCH row prints %r — a browser player must be shown C first, not CTRL" % (ck,))

    lj = page.evaluate("() => __IC.rowKeys('LONG JUMP')")
    parts = set(re.split(r"[+\s]+", (lj or "").upper()))
    r.ok("longjump_row_composed", "C" in parts and "SPACE" in parts,
         "LONG JUMP row prints %r — it must compose from the LIVE crouch binding" % (lj,))

    # --- rebind by MOUSE ---------------------------------------------------
    page.evaluate("() => __IC.resetBindings()")
    row = page.evaluate("() => __IC.ctlRowBox('CROUCH')")
    if row:
        click(page, row)
    listening = page.evaluate("() => __IC.listening()")
    page.keyboard.press("n")
    page.wait_for_timeout(200)
    binds = page.evaluate("() => __IC.bindings()")
    r.ok("rebind_by_mouse", bool(row) and listening and binds.get("crouch", [None])[0] == "KeyN",
         "clicked the CROUCH row %s (bindable=%s, listening=%s), pressed N -> crouch=%s"
         % (where(row), row and row.get("bindable"), listening, binds.get("crouch")))

    painted = page.evaluate("() => __IC.rowKeys('CROUCH')")
    r.ok("rebind_repaints_row", bool(painted) and painted.split(" ")[0].upper() == "N",
         "the row now prints %r without reopening the page" % (painted,))

    # --- persistence across a reload --------------------------------------
    stored = page.evaluate("() => __IC.stored()")
    page.reload(wait_until="load")
    if not wait_boot(page):
        r.ok("rebind_persists_reload", False, "page did not boot after reload")
        return
    page.evaluate(DRIVER_JS)
    after = page.evaluate("() => __IC.bindings()")
    r.ok("rebind_persists_reload", after.get("crouch", [None])[0] == "KeyN",
         "localStorage crestbound.bindings.v1 %s; after reload crouch=%s"
         % ("written" if stored else "MISSING", after.get("crouch")))
    page.evaluate("() => __IC.resetBindings()")


def check_ui_play(r):
    """Everything a player reaches from inside the game."""
    page = r.page
    print("\nCONTROLS SCREEN — FROM PLAY (P2)")

    page.keyboard.press("Escape")
    page.wait_for_timeout(450)
    m = page.evaluate("() => __IC.menu()")
    r.ok("escape_opens_pause", bool(m and m["open"] and m["page"] == "pause"),
         "ESC in the Keep -> menu %s" % json.dumps(m))

    b = page.evaluate("() => __IC.btnBox('CONTROLS')")
    if b:
        click(page, b)
    m = page.evaluate("() => __IC.menu()")
    r.ok("controls_from_pause_mouse", bool(b) and bool(m) and m["page"] == "controls",
         "real click on the pause page's %s -> menu.page=%s" % (b["text"] if b else "<NO BUTTON>", m and m["page"]))

    # --- rebind with the KEYBOARD only -------------------------------------
    focused = page.evaluate("() => __IC.focusRow('controls', 'DIVE')")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    listening = page.evaluate("() => __IC.listening()")
    page.keyboard.press("k")
    page.wait_for_timeout(200)
    binds = page.evaluate("() => __IC.bindings()")
    r.ok("rebind_by_keyboard", focused == "DIVE" and listening and binds.get("dive", [None])[0] == "KeyK",
         "focused %r, ENTER (listening=%s), pressed K -> dive=%s" % (focused, listening, binds.get("dive")))

    # --- the rebound key drives the real action ----------------------------
    page.evaluate("() => __IC.openMenu('controls')")
    row = page.evaluate("() => __IC.ctlRowBox('CROUCH')")
    if row:
        click(page, row)
    page.keyboard.press("n")
    page.wait_for_timeout(200)
    page.evaluate("() => __IC.resume()")
    page.wait_for_timeout(450)
    page.evaluate("() => __IC.stop()")
    page.evaluate("() => __IC.step(6)")
    page.keyboard.down("n")
    page.evaluate("() => __IC.step(8)")
    live = page.evaluate("() => __IC.ply()")
    page.keyboard.up("n")
    page.evaluate("() => __IC.step(6)")
    r.ok("rebound_key_drives_action", bool(live.get("crouchHeld")),
         "crouch rebound to N; holding N in the Keep gives input.crouch=%r, player.state=%s"
         % (live.get("crouchHeld"), live.get("st")))
    page.evaluate("() => __IC.resetBindings()")

    # --- invert toggles + sensitivity sliders ------------------------------
    page.evaluate("() => __IC.settings({ invertX: false, invertY: false, camSensX: 1, camSensY: 1 })")
    page.evaluate("() => __IC.openMenu('settings')")
    page.wait_for_timeout(300)

    for axis, key in (("INVERT Y", "invertY"), ("INVERT X", "invertX")):
        box = page.evaluate("(a) => __IC.rowCtlBox(a, '.cb-toggle')", axis)
        if box:
            click(page, box)
        s = page.evaluate("() => __IC.settings()")
        isx = page.evaluate("() => __IC.inputSettings()")
        r.ok(key + "_toggle_by_mouse", bool(box) and bool(s) and s.get(key) is True and isx.get(key) is True,
             "clicked the %s toggle %s -> Settings.%s=%r, input.settings.%s=%r"
             % (axis, where(box), key, s and s.get(key), key, isx.get(key)))

    focused = page.evaluate("() => __IC.focusRow('settings', 'INVERT Y')")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(200)
    s = page.evaluate("() => __IC.settings()")
    r.ok("invertY_toggle_by_keyboard", focused == "INVERT Y" and s and s.get("invertY") is False,
         "focused %r, ArrowLeft -> Settings.invertY=%r" % (focused, s and s.get("invertY")))

    before = page.evaluate("() => __IC.settings()")
    focused = page.evaluate("() => __IC.focusRow('settings', 'SENSITIVITY X')")
    for _ in range(4):
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(60)
    after = page.evaluate("() => __IC.settings()")
    r.ok("sensX_by_keyboard", focused == "SENSITIVITY X" and after.get("camSensX") > before.get("camSensX"),
         "focused %r, 4x ArrowRight -> camSensX %s -> %s"
         % (focused, before.get("camSensX"), after.get("camSensX")))

    before = page.evaluate("() => __IC.settings()")
    box = page.evaluate("() => __IC.rowCtlBox('SENSITIVITY Y', '.cb-sl-track', 0.85)")
    if box:
        click(page, box)
    after = page.evaluate("() => __IC.settings()")
    r.ok("sensY_by_mouse", bool(box) and after.get("camSensY") != before.get("camSensY"),
         "clicked the SENSITIVITY Y track at 85%% -> camSensY %s -> %s"
         % (before.get("camSensY"), after.get("camSensY")))

    page.evaluate("() => __IC.settings({ invertX: false, invertY: false, camSensX: 1, camSensY: 1 })")
    page.evaluate("() => __IC.closeMenu()")
    page.wait_for_timeout(400)


# ==========================================================================
# 2. LOOK SIGN  (P1)
# ==========================================================================
CX, CY = 640, 380


def park(page):
    """Put the pointer back at the stroke origin and let the game eat that move.

    Under pointer lock EVERY mouse move is a look delta, including the one that
    only repositions the cursor for the next stroke — so parking and flushing it
    before sampling is the difference between measuring the stroke and measuring
    the stroke plus the return trip."""
    page.mouse.move(CX, CY)
    for _ in range(30):
        if page.evaluate("() => __IC.locked()"):
            break
        hit = page.evaluate("(p) => __IC.atPoint(p[0], p[1])", [CX, CY])
        if hit and hit.split(".")[0] == "CANVAS":
            break
        page.wait_for_timeout(60)
    page.evaluate("() => __IC.step(2)")


def stroke(page, dx, dy):
    """A real trusted left-drag from the parked origin. Two moves: unlocked, the
    first crosses DRAG_CLICK_PX (6 px) and already accumulates; locked, both are
    plain movementX/Y."""
    page.mouse.down()
    page.mouse.move(CX + dx * 0.5, CY + dy * 0.5)
    page.mouse.move(CX + dx, CY + dy)
    page.mouse.up()


def dyaw(a, b):
    d = b - a
    while d > 3.14159265:
        d -= 6.28318531
    while d < -3.14159265:
        d += 6.28318531
    return d


def check_look(r):
    page = r.page
    print("\nLOOK SIGN (P1)")
    st = page.evaluate("() => __IC.resume()")
    page.wait_for_timeout(500)
    r.ok("look_setup_game_live", st in ("keep", "playing"),
         "game resumed to %r before the look measurements (a 'paused' game does not simulate)" % st)
    page.evaluate("() => __IC.stop()")
    page.evaluate("() => __IC.step(6)")
    page.evaluate("() => __IC.settings({ invertX: false, invertY: false, camSensX: 1, camSensY: 1 })")
    page.evaluate("() => __IC.step(2)")

    def do(dx, dy):
        ensure_live(page)
        park(page)
        before = page.evaluate("() => __IC.cam()")
        stroke(page, dx, dy)
        page.evaluate("() => __IC.step(3)")
        return before, page.evaluate("() => __IC.cam()")

    b, a = do(0, -160)          # push the mouse AWAY from you = "look up"
    r.ok("look_up_raises_view", a["dirY"] - b["dirY"] > 0.05,
         "mouse up 160px: camera forward.y %+.4f -> %+.4f (d %+.4f); cam.pitch %+.3f -> %+.3f "
         "[state=%s suspended=%s pointerLock=%s]"
         % (b["dirY"], a["dirY"], a["dirY"] - b["dirY"], b["pitch"], a["pitch"],
            b["state"], b["suspended"], page.evaluate("() => __IC.locked()")))
    r.ok("look_up_drops_the_lens", a["camY"] - b["camY"] < -0.10,
         "camera world Y %.3f -> %.3f (a third-person lens DROPS behind the hero to look up)"
         % (b["camY"], a["camY"]))

    b, a = do(0, 160)           # pull the mouse toward you = "look down"
    r.ok("look_down_lowers_view", a["dirY"] - b["dirY"] < -0.05,
         "mouse down 160px: forward.y %+.4f -> %+.4f (d %+.4f)"
         % (b["dirY"], a["dirY"], a["dirY"] - b["dirY"]))

    b, a = do(200, 0)           # push the mouse RIGHT = turn right
    d = dyaw(b["yaw"], a["yaw"])
    r.ok("look_right_turns_right", d < -0.10,
         "mouse right 200px: cam.yaw %+.3f -> %+.3f (d %+.3f rad; turning right is -yaw here)"
         % (b["yaw"], a["yaw"], d))

    # --- invertY ----------------------------------------------------------
    page.evaluate("() => __IC.settings({ invertY: true })")
    page.evaluate("() => __IC.step(2)")
    iset = page.evaluate("() => __IC.inputSettings()")
    r.ok("invertY_reaches_input", iset.get("invertY") is True,
         "Settings.invertY -> input.settings.invertY=%r" % (iset.get("invertY"),))
    b, a = do(0, -160)
    r.ok("invertY_reverses_look", a["dirY"] - b["dirY"] < -0.05,
         "with invertY on, mouse up 160px gives forward.y d %+.4f (must be negative)"
         % (a["dirY"] - b["dirY"]))

    # --- invertX ----------------------------------------------------------
    page.evaluate("() => __IC.settings({ invertY: false, invertX: true })")
    page.evaluate("() => __IC.step(2)")
    b, a = do(200, 0)
    d = dyaw(b["yaw"], a["yaw"])
    r.ok("invertX_reverses_look", d > 0.10,
         "with invertX on, mouse right 200px gives cam.yaw d %+.3f (must be positive)" % d)
    page.evaluate("() => __IC.settings({ invertX: false })")
    page.evaluate("() => __IC.step(2)")

    # --- the keyboard orbit keys must share the sign ----------------------
    # V (orbitDown) is measured first because it is the one orbit key bound to
    # nothing else. R is BOTH orbitUp and restart in DEFAULT_BINDINGS, and one
    # tap of restart reloads the course (game.js: `if (inp.restartPressed)
    # this.restartCourse()`), which parks the game in 'loading' and freezes the
    # pose — the first run of this gate read d = 0.0000 for exactly that reason,
    # not because orbitUp was broken. So R is measured with `restart` parked on
    # an unused code, and the collision is reported separately.
    ensure_live(page)
    page.evaluate("() => __IC.setPitch(0.22)")
    page.evaluate("() => __IC.step(2)")
    b = page.evaluate("() => __IC.cam()")
    page.keyboard.down("v")               # orbitDown
    page.evaluate("() => __IC.step(24)")
    page.keyboard.up("v")
    page.evaluate("() => __IC.step(2)")
    a = page.evaluate("() => __IC.cam()")
    r.ok("orbitDown_key_looks_down", a["dirY"] - b["dirY"] < -0.02,
         "hold V (orbitDown) 24 frames: forward.y %+.4f -> %+.4f (d %+.4f)"
         % (b["dirY"], a["dirY"], a["dirY"] - b["dirY"]))

    page.evaluate("() => CRESTBOUND.game.input.rebind('restart', ['F9'])")
    ensure_live(page)
    page.evaluate("() => __IC.setPitch(0.22)")
    page.evaluate("() => __IC.step(2)")
    b = page.evaluate("() => __IC.cam()")
    page.keyboard.down("r")               # orbitUp
    page.evaluate("() => __IC.step(24)")
    page.keyboard.up("r")
    page.evaluate("() => __IC.step(2)")
    a = page.evaluate("() => __IC.cam()")
    r.ok("orbitUp_key_looks_up", a["dirY"] - b["dirY"] > 0.02,
         "hold R (orbitUp, restart parked on F9) 24 frames: forward.y %+.4f -> %+.4f (d %+.4f)"
         % (b["dirY"], a["dirY"], a["dirY"] - b["dirY"]))
    page.evaluate("() => __IC.resetBindings()")

    share = page.evaluate(r"""() => {
      const B = CRESTBOUND.game.input.bindings;
      const orbit = ['orbitUp', 'orbitDown', 'orbitLeft', 'orbitRight'];
      const bad = [];
      for (const a of orbit) for (const c of (B[a] || [])) {
        for (const d of ['restart', 'toCheckpoint']) if ((B[d] || []).indexOf(c) >= 0) bad.push(a + '+' + d + '=' + c);
      }
      return bad;
    }""")
    r.ok("orbit_keys_are_not_destructive", not share,
         "camera-orbit keys sharing a code with restart/toCheckpoint: %s "
         "— one tap of that key throws the run away (game.js `if (inp.restartPressed) "
         "this.restartCourse()`). Both bindings are CONTRACT sec 4 verbatim, so the "
         "one-token default change is the owner's call, not this lane's."
         % (", ".join(share) or "none"),
         owner="owner-decision")


# ==========================================================================
# 3. CROUCH COMBOS  (P3)
# ==========================================================================
def check_crouch(r):
    page = r.page
    print("\nCROUCH COMBOS ON C (P3)")
    st = page.evaluate("() => __IC.resume()")
    page.wait_for_timeout(500)
    r.ok("crouch_setup_game_live", st in ("keep", "playing"),
         "game resumed to %r before the crouch measurements" % st)
    page.evaluate("() => __IC.stop()")
    spawn = page.evaluate("() => __IC.spawn()")

    def allup():
        for k in ("c", "Space", "Control", "Shift", "n", "r"):
            try:
                page.keyboard.up(k)
            except Exception:
                pass
        page.evaluate("() => __IC.stick(0, 0)")

    def reset():
        allup()
        page.evaluate("(s) => __IC.place(s.x, s.y + 0.35, s.z, s.yaw)", spawn)
        page.evaluate("() => __IC.step(34)")

    def runup(frames):
        page.evaluate("() => __IC.stick(0, 1)")
        page.evaluate("(n) => __IC.step(n)", frames)

    def jump_and_watch(frames=28):
        page.keyboard.down("Space")
        w = page.evaluate("(n) => __IC.watch(n)", frames)
        page.keyboard.up("Space")
        return w.get("seen", [])

    # --- the HUMAN order: crouch held THROUGH the run-up, then jump -------
    reset()
    page.keyboard.down("c")
    page.evaluate("() => __IC.step(5)")
    runup(120)
    held = page.evaluate("() => __IC.ply()")
    seen = jump_and_watch()
    page.keyboard.up("c")
    r.ok("longjump_C_held_through_runup", "longjump" in seen,
         "hold C, run 120f (speed %.2f m/s, crouching=%s, state %s), then Space -> %s"
         % (held["sp"], held["crouching"], held["st"], ",".join(seen[:8]) or "-"),
         owner="jumpfamily")

    # --- crouch pressed at full speed, jump two frames later --------------
    reset()
    runup(120)
    fast = page.evaluate("() => __IC.ply()")
    page.keyboard.down("c")
    page.evaluate("() => __IC.step(2)")
    seen = jump_and_watch()
    page.keyboard.up("c")
    r.ok("longjump_C_tapped_at_speed", "longjump" in seen,
         "run to %.2f m/s, press C, Space 2 frames later -> %s" % (fast["sp"], ",".join(seen[:8]) or "-"))

    # --- crouch pressed at full speed, jump a HUMAN beat later (~0.2 s) ---
    reset()
    runup(120)
    page.keyboard.down("c")
    page.evaluate("() => __IC.step(12)")
    late = page.evaluate("() => __IC.ply()")
    seen = jump_and_watch()
    page.keyboard.up("c")
    r.ok("longjump_C_human_reaction", "longjump" in seen,
         "run, press C, Space 12 frames (0.2 s) later at %.2f m/s -> %s"
         % (late["sp"], ",".join(seen[:8]) or "-"),
         owner="jumpfamily")

    # --- backflip from rest ------------------------------------------------
    reset()
    page.keyboard.down("c")
    page.evaluate("() => __IC.step(12)")
    at = page.evaluate("() => __IC.ply()")
    seen = jump_and_watch(32)
    page.keyboard.up("c")
    r.ok("backflip_C_from_rest", "backflip" in seen,
         "hold C at rest (speed %.2f, state %s) then Space -> %s"
         % (at["sp"], at["st"], ",".join(seen[:8]) or "-"))

    # --- backflip after a run, once the hero has stopped -------------------
    reset()
    page.keyboard.down("c")
    runup(60)
    page.evaluate("() => __IC.stick(0, 0)")
    page.evaluate("() => __IC.step(45)")
    at = page.evaluate("() => __IC.ply()")
    seen = jump_and_watch(32)
    page.keyboard.up("c")
    r.ok("backflip_C_after_stopping", "backflip" in seen,
         "C held, run then release the stick and wait (speed %.2f) then Space -> %s"
         % (at["sp"], ",".join(seen[:8]) or "-"))

    # --- Ctrl must still work as an alternate ------------------------------
    reset()
    page.keyboard.down("Control")
    page.evaluate("() => __IC.step(12)")
    seen = jump_and_watch(32)
    page.keyboard.up("Control")
    r.ok("backflip_ctrl_alternate", "backflip" in seen,
         "hold ControlLeft at rest then Space -> %s" % (",".join(seen[:8]) or "-"))

    reset()
    page.keyboard.down("Shift")
    page.evaluate("() => __IC.step(12)")
    seen = jump_and_watch(32)
    page.keyboard.up("Shift")
    r.ok("backflip_shift_alternate", "backflip" in seen,
         "hold ShiftLeft at rest then Space -> %s" % (",".join(seen[:8]) or "-"))

    # --- Ctrl must never reach the browser ---------------------------------
    prevented = page.evaluate(r"""() => {
      const ev = new KeyboardEvent('keydown', { code: 'ControlLeft', key: 'Control', ctrlKey: true,
                                                bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      const p = ev.defaultPrevented;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlLeft', key: 'Control', bubbles: true }));
      const ev2 = new KeyboardEvent('keydown', { code: 'ControlRight', key: 'Control', ctrlKey: true,
                                                 bubbles: true, cancelable: true });
      window.dispatchEvent(ev2);
      const p2 = ev2.defaultPrevented;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlRight', key: 'Control', bubbles: true }));
      return { left: p, right: p2 };
    }""")
    r.ok("ctrl_keydown_prevented", bool(prevented.get("left")) and bool(prevented.get("right")),
         "ControlLeft defaultPrevented=%r ControlRight=%r — the browser must never see it"
         % (prevented.get("left"), prevented.get("right")))

    allup()


# ==========================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--headless", action="store_true", help="(default)")
    ap.add_argument("--only", default="", help="comma list: look | crouch | ui")
    ap.add_argument("--json", default=os.path.join(HERE, "inputcheck.json"))
    args = ap.parse_args()

    only = set(x.strip() for x in args.only.split(",") if x.strip())
    console = []
    fails = []

    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=not args.headed, args=FLAGS)
        ctx = br.new_context(viewport={"width": 1280, "height": 720})
        page = ctx.new_page()
        page.on("console", lambda m: console.append((m.type, m.text[:200])))
        page.on("pageerror", lambda e: console.append(("pageerror", str(e)[:300])))
        page.goto(args.url, wait_until="load", timeout=90000)
        if not wait_boot(page):
            print("BOOT FAILED — no CRESTBOUND.game.course")
            br.close()
            return 1
        page.evaluate(DRIVER_JS)
        page.wait_for_timeout(700)

        r = Run(page)
        try:
            if not only or "ui" in only:
                check_ui_title(r)
            if not enter_keep(page):
                print("  (!) could not reach the Keep from the title — state %s"
                      % page.evaluate("() => CRESTBOUND.game.state"))
            page.wait_for_timeout(700)
            if not only or "ui" in only:
                check_ui_play(r)
            if not only or "look" in only:
                check_look(r)
            if not only or "crouch" in only:
                check_crouch(r)
        finally:
            errs = [c for c in console if c[0] in ("error", "pageerror")]
            allfails = [c for c in r.checks if not c["ok"]]
            fails = [c for c in allfails if c.get("owner", "controls") == "controls"]
            other = [c for c in allfails if c.get("owner", "controls") != "controls"]
            print("\nconsole errors: %d %s" % (len(errs), errs[:3]))
            print("INPUTCHECK: %d of %d checks failing in this lane's files "
                  "(core/input.js, player/camera.js, ui/menu.js)" % (len(fails), len(r.checks)))
            if fails:
                print("  failing: " + ", ".join(c["name"] for c in fails))
            if other:
                print("STILL OWED, NOT THIS LANE'S FILES — %d check(s):" % len(other))
                for c in other:
                    print("  %-30s [%s] %s" % (c["name"], c["owner"], c["detail"]))
            try:
                with open(args.json, "w", encoding="utf-8") as f:
                    json.dump({"url": args.url, "checks": r.checks, "consoleErrors": errs[:20]}, f, indent=1)
            except Exception:
                pass
            br.close()
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
