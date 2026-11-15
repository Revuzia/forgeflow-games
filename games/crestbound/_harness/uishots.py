#!/usr/bin/env python
"""CRESTBOUND UI gate — screenshots of every interface surface + a death strip.

Drives the REAL surfaces (no hand-built DOM): the title screen, settings and
controls pages, the Keep HUD, WALKING into the verdant-1 painting to raise the
course card, the intro cinematic, the in-play HUD loaded with 2 crests and 37
coins, a checkpoint flash, the crest ribbon, the course-clear panel, the pause
menu, and a DEATH STRIP that catches the rewind ghost, the iris and the respawn.

    python uishots.py                      # headless on the real GPU (d3d11)
    python uishots.py --headed
    python uishots.py --out ../_shots/ui

CAPTURE NOTES (measured on this box, 2026-09-02):
  * `page.screenshot()` hits Playwright's 30 s cap on this page — the renderer is
    running at ~20 fps at 1600x900 and the capture waits for a fresh surface. Every
    still here therefore goes through raw CDP `Page.captureScreenshot`, which has
    no such cap (5-12 s per still is normal until the perf lane lands).
  * A 40 ms still cadence is impossible for the same reason, so the death strip
    uses `Page.startScreencast` (needs `Page.enable` first — without it Chrome
    silently emits zero frames). Screencast pushes one JPEG per COMPOSITED frame,
    so the strip's real cadence is the game's frame time; every frame is stamped
    with the death clock it was taken at, in uishots.json and in its filename.

Everything lands in _shots/ui/ plus _harness/uishots.json.
Exit 0 when every hard check passed, 1 otherwise, 2 if the page never booted.
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html"
CP_NUMBERS_JS = "() => {\n  const g = CRESTBOUND.game;\n  const chip = document.querySelector('#hud .ch-cp');\n  const toast = [...document.querySelectorAll('#hud .ch-toast .t1')]\n      .map(n => (n.textContent||'').trim())\n      .filter(t => /^CHECKPOINT\\s+\\d+\\s*\\/\\s*\\d+$/.test(t))[0] || null;\n  const m = toast ? toast.match(/(\\d+)\\s*\\/\\s*(\\d+)/) : null;\n  return { cpIndex: g.cpIndex, cpCount: Math.max(0, (g._cpCount|0) - 1),\n           chip: chip ? (chip.textContent||'').trim() : null,\n           toast: toast, toastN: m ? +m[1] : null, toastTot: m ? +m[2] : null };\n}"
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "_shots", "ui"))

# HARNESS_NOTES: plain headless Chrome reaches the real Intel UHD GPU over d3d11
# here, so a headless frame is the frame a player sees.
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
    "--force-device-scale-factor=1",
]
VIEW = {"width": 1600, "height": 900}

R = {"checks": [], "shots": [], "notes": []}


def ok(name, passed, detail=""):
    R["checks"].append({"name": name, "pass": bool(passed), "detail": str(detail)[:400]})
    print(("  PASS  " if passed else "  FAIL  ") + name + (("   " + str(detail)[:220]) if detail else ""))
    return bool(passed)


def note(msg):
    R["notes"].append(str(msg))
    print("  ..    " + str(msg))


# --------------------------------------------------------------------------
# capture (raw CDP — Playwright's screenshot cap is too tight for this page)
# --------------------------------------------------------------------------

class Cap:
    """Stills come off a LIVE SCREENCAST, not Page.captureScreenshot.

    Measured on this box: `Page.captureScreenshot` on this page returns a surface
    that both costs 5-55 s and predates the request — two phase-A stills came back
    showing a menu that the DOM said was open. `Page.startScreencast` instead
    pushes the compositor's frames as they are produced, so "the newest frame that
    arrived AFTER I asked" is current by construction and costs nothing extra.
    """

    def __init__(self, pg, out):
        self.pg = pg
        self.out = out
        self.frames = []                       # (wall_time, base64 jpeg)
        self.cdp = pg.context.new_cdp_session(pg)
        self.cdp.send("Page.enable")
        self.cdp.on("Page.screencastFrame", self._on)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "everyNthFrame": 1,
                                               "maxWidth": VIEW["width"], "maxHeight": VIEW["height"]})

    def _on(self, pl):
        self.frames.append((time.time(), pl["data"]))
        if len(self.frames) > 400:
            del self.frames[:200]
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": pl["sessionId"]})
        except Exception:
            pass

    def _newest_after(self, t_req, budget=25.0):
        t0 = time.time()
        while time.time() - t0 < budget:
            fresh = [f for f in self.frames if f[0] > t_req]
            if len(fresh) >= 2:                # >=2 so the frame is fully after the request
                return fresh[-1]
            self.pg.wait_for_timeout(60)
        return self.frames[-1] if self.frames else None

    def still(self, name):
        from PIL import Image
        t = time.time()
        f = self._newest_after(t)
        if not f:
            print("  shot  %s  FAILED (no screencast frame)" % name)
            return None
        img = Image.open(io.BytesIO(base64.b64decode(f[1])))
        path = os.path.join(self.out, name)
        img.save(path)
        R["shots"].append(name)
        print("  shot  %-28s %5.1f s" % (name, time.time() - t))
        return path


STATE = "() => (globalThis.CRESTBOUND && CRESTBOUND.game) ? CRESTBOUND.game.state : null"

# Fire a visible button through the same onClick a mouse click runs.
ACTIVATE_JS = """(want) => {
  const w = String(want).toUpperCase();
  for (const b of document.querySelectorAll('.cb-btn')) {
    if (b.offsetParent === null || b.disabled) continue;
    const t = (b.textContent || '').trim().toUpperCase();
    if (t === w || t.startsWith(w)) { b.__activate ? b.__activate() : b.click(); return t; }
  }
  return null;
}"""

VISIBLE_BTNS = ("() => [...document.querySelectorAll('.cb-btn')]"
                ".filter(b => b.offsetParent !== null).map(b => (b.textContent||'').trim())")

LAYOUT_JS = r"""() => {
  const vw = innerWidth, vh = innerHeight;
  const clipped = [], off = [];
  for (const r of [document.getElementById('hud'), document.getElementById('ui')].filter(Boolean)) {
    for (const n of r.querySelectorAll('*')) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      const b = n.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const cls = (n.className && n.className.baseVal !== undefined) ? n.className.baseVal : String(n.className || '');
      const id = n.tagName.toLowerCase() + (cls ? '.' + cls.split(/\s+/).slice(0, 2).join('.') : '');
      const leaf = n.children.length === 0 && (n.textContent || '').trim().length > 1;
      if (leaf && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') &&
          n.scrollWidth > n.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
        clipped.push({ id, text: n.textContent.trim().slice(0, 40), sw: n.scrollWidth, cw: n.clientWidth });
      }
      // Content parked below the fold of a SCROLLABLE panel is not "off-screen";
      // only flag a node that no ancestor can scroll into view.
      let scrollable = false;
      for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (/(auto|scroll)/.test(acs.overflowY + acs.overflowX) && a.scrollHeight > a.clientHeight + 8) { scrollable = true; break; }
      }
      if (!scrollable && (b.right < -4 || b.bottom < -4 || b.left > vw + 4 || b.top > vh + 4)) {
        off.push({ id, rect: [b.left | 0, b.top | 0, b.right | 0, b.bottom | 0] });
      }
    }
  }

  // ---- OCCLUSION -------------------------------------------------------
  // Text overflow and off-viewport miss the failure mode where a control is
  // simply COVERED — the credits BACK button sliced in half by the footer bar,
  // a chip drawn under another surface. Hit-test five points of every visible
  // button: if the topmost element there is neither the button nor inside it,
  // that part of the control cannot be seen or clicked.
  const occluded = [];
  for (const b of document.querySelectorAll('.cb-btn')) {
    if (b.offsetParent === null || b.disabled || b.classList.contains('is-disabled')) continue;
    const cs = getComputedStyle(b);
    if (cs.visibility === 'hidden' || +cs.opacity < 0.2 || cs.pointerEvents === 'none') continue;
    const r = b.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2],
                 [r.left + 5, r.top + 5], [r.right - 5, r.top + 5],
                 [r.left + 5, r.bottom - 5], [r.right - 5, r.bottom - 5]];
    let blocked = 0; let by = null;
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x > vw || y > vh) { blocked++; if (!by) by = 'off-viewport'; continue; }
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === b || b.contains(hit) || hit.contains(b))) {
        blocked++;
        if (!by && hit) {
          const hc = (hit.className && hit.className.baseVal !== undefined) ? hit.className.baseVal : String(hit.className || '');
          by = hit.tagName.toLowerCase() + (hc ? '.' + hc.split(/\s+/).slice(0, 2).join('.') : '');
        }
      }
    }
    if (blocked >= 2) {
      occluded.push({ id: 'button:' + (b.textContent || '').trim().slice(0, 24), blocked, by,
                      rect: [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0] });
    }
  }
  return { clipped, off, occluded };
}"""

# The page-level control cluster (game_controls.js: fullscreen / mute / pause)
# is fixed bottom-right on every ForgeFlow game page and is NOT part of the
# game's DOM. Anything the game draws into that box collides with it. Rects are
# read with getBoundingClientRect, which is independent of opacity, so the death
# badge and the cinematic skip hint are measurable without provoking them.
CORNER_JS = r"""() => {
  const bar = document.getElementById('__ff_controls__');
  const barRect = bar ? bar.getBoundingClientRect() : null;
  const want = [['rewind badge', '.ct-rewind .rw-glyph'], ['cinematic skip hint', '#cb-cine .cb-cine-skip']];
  const out = { bar: barRect ? [barRect.left|0, barRect.top|0, barRect.right|0, barRect.bottom|0] : null, items: [], hits: [] };
  if (!barRect) return out;
  for (const [name, sel] of want) {
    const n = document.querySelector(sel);
    if (!n) { out.items.push({ name, sel, missing: true }); continue; }
    // INK rect, not the layout box: a centred affordance is laid out full-width,
    // so only the pixels it actually paints can collide with the cluster.
    let r = n.getBoundingClientRect();
    try {
      const rng = document.createRange();
      rng.selectNodeContents(n);
      const ink = rng.getBoundingClientRect();
      if (ink && ink.width > 1 && ink.height > 1) r = ink;
      rng.detach && rng.detach();
    } catch (e) { /* keep the layout box */ }
    const rec = { name, sel, rect: [r.left|0, r.top|0, r.right|0, r.bottom|0], w: r.width|0, h: r.height|0 };
    const overlap = !(r.right <= barRect.left || r.left >= barRect.right ||
                      r.bottom <= barRect.top || r.top >= barRect.bottom);
    // a full-width centred affordance only "hits" if its INK reaches the bar
    rec.overlap = overlap && r.width > 0;
    out.items.push(rec);
    if (rec.overlap) out.hits.push(name);
  }
  return out;
}"""

FONT_JS = r"""() => {
  const probe = document.createElement('span');
  probe.textContent = 'CRESTBOUND 0123456789';
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:64px;white-space:pre;';
  document.body.appendChild(probe);
  probe.style.fontFamily = "'Rajdhani'";      const wRaj = probe.getBoundingClientRect().width;
  probe.style.fontFamily = "'__cb_missing__'"; const wFall = probe.getBoundingClientRect().width;
  probe.style.fontFamily = "serif";            const wSerif = probe.getBoundingClientRect().width;
  probe.remove();
  return { check400: document.fonts.check("400 20px Rajdhani"),
           check700: document.fonts.check("700 20px Rajdhani"),
           wRaj, wFall, wSerif, status: document.fonts.status,
           loaded: [...document.fonts].map(f => f.family + '/' + f.weight + '/' + f.status) };
}"""


def wait_for(pg, expr, timeout=60, poll=0.3):
    dl = time.time() + timeout
    while time.time() < dl:
        try:
            if pg.evaluate(expr):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(int(poll * 1000))
    return False


def wait_state(pg, states, timeout=60, nudge=False):
    if isinstance(states, str):
        states = (states,)
    dl = time.time() + timeout
    last = None
    while time.time() < dl:
        try:
            last = pg.evaluate(STATE)
        except Exception:
            last = None
        if last in states:
            return True, last
        if nudge:
            try:
                pg.evaluate(ACTIVATE_JS, "ENTER") or pg.evaluate(ACTIVATE_JS, "")
            except Exception:
                pass
        pg.wait_for_timeout(250)
    return False, last


def layout(pg, tag, label):
    lay = pg.evaluate(LAYOUT_JS)
    R["layout_" + tag] = lay
    occ = lay.get("occluded") or []
    return ok("%s: no clipped text, nothing off-viewport, no occluded control" % label,
              not lay["clipped"] and not lay["off"] and not occ,
              json.dumps(lay["clipped"] + lay["off"] + occ)[:300])


def corner(pg, label):
    """Nothing the game draws may enter the page control cluster's corner."""
    c = pg.evaluate(CORNER_JS)
    R["corner_" + label] = c
    if not c.get("bar"):
        note("no #__ff_controls__ cluster on the page — corner check skipped (%s)" % label)
        return True
    return ok("bottom-right affordances clear the page control cluster (%s)" % label,
              not c["hits"], json.dumps(c)[:320])


# --------------------------------------------------------------------------
# phase A — release build (no ?dev=1)
# --------------------------------------------------------------------------

def phase_release(pg, cap, url):
    pg.goto(url, wait_until="load", timeout=60_000)
    if not wait_for(pg, "() => !!(globalThis.CRESTBOUND && CRESTBOUND.game)", 240):
        raise RuntimeError("TargetClosed-equivalent: CRESTBOUND.game never appeared (box overloaded)")
    got, st = wait_state(pg, ("title",), 180)
    ok("release build reaches the title screen", got, "state=%s" % st)
    pg.wait_for_timeout(1500)

    f = pg.evaluate(FONT_JS)
    R["font"] = f
    ok("Rajdhani webfont loaded (a serif fallback would be a fail)",
       bool(f["check700"]) and abs(f["wRaj"] - f["wSerif"]) > 4,
       "check700=%s wRaj=%.1f wFallback=%.1f wSerif=%.1f" % (f["check700"], f["wRaj"], f["wFall"], f["wSerif"]))

    dev = pg.evaluate("""() => { const n = document.getElementById('cb-dev');
      return { hook: typeof CRESTBOUND.game.__dev, node: !!n,
               display: n ? getComputedStyle(n).display : null }; }""")
    R["devOverlay"] = dev
    ok("dev overlay hidden and __dev absent without ?dev=1",
       dev["hook"] == "undefined" and dev["display"] in (None, "none"),
       "__dev=%s  #cb-dev display=%s" % (dev["hook"], dev["display"]))

    prog = pg.evaluate("""() => { const m = CRESTBOUND.game.menu;
      let t = null; try { t = CRESTBOUND.game.save.totals(); } catch(e) {}
      return { totals: t, hasProgress: m && m._hasProgress ? m._hasProgress() : null,
               saveBlob: !!localStorage.getItem('crestbound.save.v1') }; }""")
    R["freshSave"] = prog
    ok("a FRESH profile offers NEW GAME without an erase-my-progress confirm",
       prog["hasProgress"] is False,
       "hasProgress=%s totals=%s savedBlob=%s" % (prog["hasProgress"], json.dumps(prog["totals"]), prog["saveBlob"]))

    cap.still("title.png")
    layout(pg, "title", "title")

    nav0 = pg.evaluate("() => { const a=document.activeElement; return a?(a.textContent||'').trim():null; }")
    pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(200)
    pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(200)
    nav1 = pg.evaluate("() => { const a=document.activeElement; return a?(a.textContent||'').trim():null; }")
    R["titleNav"] = {"before": nav0, "after": nav1}
    ok("title menu navigates by keyboard", nav1 is not None and nav1 != nav0, "%r -> %r" % (nav0, nav1))
    cap.still("title_nav.png")

    fired = pg.evaluate(ACTIVATE_JS, "SETTINGS"); pg.wait_for_timeout(1100)
    ok("SETTINGS opens the settings page", fired is not None, "fired=%r" % fired)
    cap.still("settings.png")
    layout(pg, "settings", "settings")
    R["settingsRows"] = pg.evaluate("""() => [...document.querySelectorAll('.cb-row')]
      .filter(n=>n.offsetParent!==null).map(n=>(n.textContent||'').trim().slice(0,60))""")

    pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
    fired = pg.evaluate(ACTIVATE_JS, "CONTROLS"); pg.wait_for_timeout(1100)
    ok("CONTROLS opens the controls page", fired is not None, "fired=%r" % fired)
    cap.still("controls.png")
    g = pg.evaluate("""() => {
      const pad = [...document.querySelectorAll('.cb-pad,[class*="pad-glyph"],[class*="cb-glyph"]')]
        .filter(n=>n.offsetParent!==null).map(n=>(n.textContent||'').trim()).filter(Boolean);
      const kbd = [...document.querySelectorAll('kbd,.cb-kbd,[class*="cb-key"]')]
        .filter(n=>n.offsetParent!==null).map(n=>(n.textContent||'').trim()).filter(Boolean);
      return { pad, kbd: kbd.slice(0,30), padCount: pad.length, kbdCount: kbd.length };
    }""")
    R["controlsGlyphs"] = g
    ok("controls page shows gamepad glyphs AND keyboard keys",
       g["padCount"] > 4 and g["kbdCount"] > 4,
       "pad=%d kbd=%d  pad sample=%s" % (g["padCount"], g["kbdCount"], g["pad"][:12]))
    layout(pg, "controls", "controls")
    pg.evaluate("""() => { for (const s of document.querySelectorAll('.cb-scroll,.cm-page.is-open *')) {
      if (s.scrollHeight > s.clientHeight + 20) { s.scrollTop = s.scrollHeight; return; } } }""")
    pg.wait_for_timeout(600)
    cap.still("controls_bottom.png")

    pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
    pg.evaluate(ACTIVATE_JS, "CREDITS"); pg.wait_for_timeout(1000)
    cap.still("credits.png")
    # the credits page HAD an un-checked surface: its BACK button was sliced in
    # half by the footer legend and no gate looked.
    layout(pg, "credits", "credits")
    corner(pg, "title")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
    return True


# --------------------------------------------------------------------------
# phase B — ?dev=1
# --------------------------------------------------------------------------

def phase_play(pg, cap, url):
    pg.goto(url + "?dev=1", wait_until="load", timeout=60_000)
    if not wait_for(pg, "() => !!(globalThis.CRESTBOUND && CRESTBOUND.game)", 240):
        raise RuntimeError("TargetClosed-equivalent: CRESTBOUND.game never appeared (box overloaded)")
    wait_state(pg, ("title",), 180)
    pg.wait_for_timeout(1000)

    pg.evaluate(ACTIVATE_JS, "NEW GAME")
    pg.wait_for_timeout(900)
    btns = pg.evaluate(VISIBLE_BTNS)
    if any("ERASE" in b.upper() for b in btns):
        note("NEW GAME raised the erase-progress confirm on a fresh profile: %s" % btns)
        cap.still("newgame_confirm.png")
        pg.evaluate(ACTIVATE_JS, "ERASE")
    got, st = wait_state(pg, ("keep", "playing"), 180)
    ok("NEW GAME lands in the Keep", got and st == "keep", "state=%s" % st)
    # The ?dev=1 readout is pinned at left:10/top:10, exactly where the HUD's
    # realm / course / crest-tally cluster lives, so park it for the stills.
    pg.evaluate("() => { const d = CRESTBOUND.game.__dev; if (d && d.panel) d.panel(false); }")
    pg.wait_for_timeout(3000)
    cap.still("keep_hud.png")
    layout(pg, "keep", "keep HUD")
    corner(pg, "keep")
    R["keepHud"] = pg.evaluate("() => (document.getElementById('hud').innerText||'').trim().slice(0,400)")

    # ---- walk into the verdant-1 painting -------------------------------
    gate = pg.evaluate("""() => { const gs = CRESTBOUND.game.__dev.gates();
      const g = gs.find(x => x.course === 'verdant-1');
      return g ? { course:g.course, pos:[g.pos.x,g.pos.y,g.pos.z], yaw:g.yaw, locked:g.locked,
                   label:g.label, sub:g.sub, kind:g.kind, n:gs.length } : null; }""")
    R["gate"] = gate
    if not gate:
        return ok("verdant-1 painting gate exists in the Keep", False, "no gate with course=verdant-1")
    ok("verdant-1 painting gate exists and is unlocked", not gate["locked"],
       "label=%r sub=%r  (%d gates)" % (gate["label"], gate["sub"], gate["n"]))

    # Stand in the room in front of the painting. Which side of the wall that is
    # depends on the gate's yaw convention, so try both and keep the side that
    # leaves Nim standing on a floor with the gate prompt armed.
    # Which side of the wall the room is on depends on the gate's yaw convention,
    # so probe the Keep's own broadphase for a floor under each candidate spot and
    # stand on the one that actually has one (the other side is inside the wall,
    # where Nim falls out of the level and the walk never happens).
    probe = pg.evaluate("""(g) => {
      const G = CRESTBOUND.game, T = CRESTBOUND.THREE, yaw = g.yaw || 0;
      const bp = G.course && G.course.broadphase;
      const out = [];
      for (const side of [-1, 1]) for (const d of [2.6, 3.3, 4.2]) {
        const hx = -Math.sin(yaw) * side, hz = -Math.cos(yaw) * side;
        const x = g.pos[0] + hx * d, z = g.pos[2] + hz * d;
        const o = new T.Vector3(x, g.pos[1] + 3.0, z), dir = new T.Vector3(0, -1, 0);
        const hit = { t: 0, normal: new T.Vector3(), collider: null };
        let floorY = null;
        if (bp && typeof bp.raycast === 'function' && bp.raycast(o, dir, 14, hit)) floorY = o.y - hit.t;
        out.push({ side, d, x, z, floorY });
      }
      return out;
    }""", gate)
    R["floorProbe"] = probe
    cands = [p for p in probe if p["floorY"] is not None and abs(p["floorY"] - gate["pos"][1]) < 4.0]
    cands.sort(key=lambda p: (-p["d"],))          # stand back a little, then walk in
    note("floor probe: %s" % json.dumps(probe))
    if not cands:
        cands = [p for p in probe if p["side"] == -1]

    placed = None
    for c in cands:
        placed = pg.evaluate("""([g, c]) => {
          const G = CRESTBOUND.game, yaw = g.yaw || 0;
          G.__dev.tp(c.x, (c.floorY != null ? c.floorY : g.pos[1]) + 0.15, c.z);
          const p = G.player, face = c.side < 0 ? yaw : yaw + Math.PI;
          if (p.__test && p.__test.setFacing) p.__test.setFacing(face);
          if (G.cam) { G.cam.yaw = face; G.cam.recenter(); }
          return { side:c.side, d:c.d, at:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)] };
        }""", [gate, c])
        pg.wait_for_timeout(2500)
        st = pg.evaluate("""() => { const G=CRESTBOUND.game, p=G.player;
          return { grounded:!!p.grounded, near:G._gateNear, state:G.state,
                   at:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)] }; }""")
        placed.update(st)
        note("side %+d @%.1f m -> %s grounded=%s gateNear=%s state=%s"
             % (c["side"], c["d"], st["at"], st["grounded"], st["near"], st["state"]))
        if st["grounded"] and st["near"] != -1 and st["state"] == "keep":
            break
    R["placed"] = placed
    ok("Nim stands on the floor in front of the painting, prompt armed",
       bool(placed and placed.get("grounded") and placed.get("near") != -1),
       json.dumps(placed))
    pg.wait_for_timeout(600)
    cap.still("keep_painting_prompt.png")
    prompt = pg.evaluate("""() => { const n=document.getElementById('cb-prompt');
      return n ? { cls:n.className, text:(n.textContent||'').trim().slice(0,140) } : null; }""")
    R["gatePrompt"] = prompt
    ok("standing at the painting raises the walk-in prompt",
       bool(prompt and "show" in (prompt["cls"] or "") and prompt["text"]), json.dumps(prompt)[:220])

    # WALK in on the analog stick, STEERED at the painting every 100 ms.
    # Holding a raw key assumes the movement frame equals `cam.yaw`; it does not —
    # `yawForMovement` is `yaw + _yawSlide`, and the camera's wall-slide can sit
    # ~0.5 rad off-axis, which sends a blind forward-hold diagonally into the wall
    # (measured: 1 run in 6). A player steers; so does this. Real analog input via
    # `input.__test.stick` (contract §4 calls it the analog injection point).
    STEER_JS = """(g) => {
      const G = CRESTBOUND.game, p = G.player, c = G.cam, i = G.input;
      let dx = g.pos[0] - p.pos.x, dz = g.pos[2] - p.pos.z;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const y = (c && typeof c.yawForMovement === 'number') ? c.yawForMovement : (c ? c.yaw : 0);
      const fx = -Math.sin(y), fz = -Math.cos(y);   // camera forward (flat)
      const rx = -fz,          rz =  fx;            // camera right
      i.__test.stick(dx * rx + dz * rz, dx * fx + dz * fz);
      return +L.toFixed(2);
    }"""
    got, st, t0 = False, None, time.time()
    while time.time() - t0 < 22:
        pg.evaluate(STEER_JS, gate)
        st = pg.evaluate(STATE)
        if st == "card":
            got = True
            break
        pg.wait_for_timeout(100)
    pg.evaluate("() => CRESTBOUND.game.input.__test.stick(0, 0)")
    how = "walked in"
    if not got:                      # fall back to the other real input path
        pg.keyboard.press("KeyE")
        got, st = wait_state(pg, ("card",), 12)
        how = "pressed E (walk-in dwell did not fire)"
    R["cardEntry"] = how
    ok("WALKING into the painting raises the course card", got and how == "walked in",
       "state=%s  via=%s" % (st, how))
    pg.wait_for_timeout(1400)
    cap.still("course_card.png")
    card = pg.evaluate("""() => ({
      text: (document.getElementById('ui').innerText||'').trim().slice(0,700),
      canvases: [...document.querySelectorAll('#ui canvas')].filter(c=>c.offsetParent!==null).map(c=>({w:c.width,h:c.height})),
      buttons: [...document.querySelectorAll('.cb-btn')].filter(b=>b.offsetParent!==null).map(b=>(b.textContent||'').trim())
    })""")
    R["courseCard"] = card
    t = (card["text"] or "").upper()
    ok("course card carries the crest tally", ("/ 7" in t or "/7" in t), t.replace("\n", " | ")[:200])
    ok("course card carries best times", ("BEST" in t or "PAR" in t), t.replace("\n", " | ")[:200])
    ok("course card paints a real painting canvas (a frame, not a flat panel)",
       len(card["canvases"]) > 0, str(card["canvases"]))
    layout(pg, "card", "course card")

    # ---- enter -> intro cinematic ---------------------------------------
    pg.evaluate(ACTIVATE_JS, "ENTER")
    seen, n, t0 = [], 0, time.time()
    while time.time() - t0 < 30 and n < 3:
        stt = pg.evaluate(STATE)
        seen.append(stt)
        if stt == "cinematic":
            cap.still("intro_%02d.png" % n); n += 1
            pg.wait_for_timeout(700)
        elif stt == "playing":
            break
        else:
            pg.wait_for_timeout(250)
    R["introStates"] = sorted(set(x for x in seen if x))
    ok("entering the painting plays a course INTRO CINEMATIC", "cinematic" in seen, "states: %s" % R["introStates"])
    got, st = wait_state(pg, ("playing",), 60, nudge=True)
    ok("the intro hands control back to play", got, "state=%s" % st)
    pg.wait_for_timeout(1200)

    # ---- crest ribbon + course-clear panel -------------------------------
    pg.evaluate("() => CRESTBOUND.game.__dev.give('open')")
    cap.still("crest_ribbon_00.png")
    # The ribbon must be a MOMENT, not a class name: the node has to be painted
    # (computed opacity, not just offsetParent — `.ch-ribbon` lives in the DOM at
    # opacity 0 between crests) and it has to carry the crest's own name.
    rib = pg.evaluate("""() => {
      const nodes = [...document.querySelectorAll('#hud *')].filter(n => {
        const c=(n.className&&n.className.baseVal!==undefined)?n.className.baseVal:String(n.className||'');
        return /ribbon|crest/i.test(c) && n.offsetParent!==null;
      }).map(n=>{ const cs=getComputedStyle(n);
        return {cls:(n.className.baseVal!==undefined?n.className.baseVal:n.className),
                op:+parseFloat(cs.opacity||'0').toFixed(3), vis:cs.visibility,
                text:(n.textContent||'').trim().slice(0,80)}; });
      return { nodes, hudText:(document.getElementById('hud').innerText||'').trim().slice(0,400) };
    }""")
    R["ribbon"] = rib
    shown = [x for x in rib["nodes"] if "ribbon" in (x["cls"] or "").lower()
             and x["op"] > 0.5 and x["vis"] != "hidden"]
    named = [x for x in shown if "CREST" in (x["text"] or "").upper() and len((x["text"] or "")) > 12]
    ok("crest ribbon appears on collect — painted, and it names the crest",
       bool(named), json.dumps(shown or rib["nodes"])[:320])
    cap.still("crest_ribbon_01.png")

    wait_state(pg, ("clear",), 15)
    pg.wait_for_timeout(2600)                    # CLEAR_ORBIT_MS = 2.2 s
    cap.still("course_clear.png")
    clr = pg.evaluate("""() => ({
      text: ((document.getElementById('hud').innerText||'') + '\\n' + (document.getElementById('ui').innerText||'')).trim().slice(0,800),
      buttons: [...document.querySelectorAll('.cb-btn')].filter(b=>b.offsetParent!==null).map(b=>(b.textContent||'').trim()) })""")
    R["clearPanel"] = clr
    bt = " ".join(clr["buttons"]).upper()
    ok("course-clear panel offers STAY / RETURN TO KEEP", "STAY" in bt and "KEEP" in bt,
       json.dumps(clr["buttons"])[:200])
    layout(pg, "clear", "clear panel")

    pg.evaluate(ACTIVATE_JS, "STAY")
    wait_state(pg, ("playing",), 30, nudge=True)
    pg.wait_for_timeout(700)

    pg.evaluate("() => CRESTBOUND.game.__dev.give('sigils')")
    wait_state(pg, ("clear",), 15)
    pg.wait_for_timeout(2800)
    pg.evaluate(ACTIVATE_JS, "STAY")
    wait_state(pg, ("playing",), 30, nudge=True)
    pg.wait_for_timeout(800)

    # ---- 37 coins through the collectibles API ---------------------------
    R["coins"] = pg.evaluate("""() => { const c = CRESTBOUND.game._collectibles;
      if (!c) return null; let got = 0;
      for (let i = 0; got < 37 && i < c.coinCount; i++) if (c.collect('coin', i)) got++;
      return { got, counts: JSON.parse(JSON.stringify(c.counts)) }; }""")
    pg.wait_for_timeout(1800)
    cap.still("hud_play.png")
    hud = pg.evaluate("() => (document.getElementById('hud').innerText||'').trim()")
    R["hudText"] = hud[:600]
    # The coin counter is a per-digit odometer (each column is its own block
    # box so it can roll), so innerText puts a line break BETWEEN THE DIGITS
    # of one number: the digits arrive on separate lines. Re-join digits that
    # are separated only by whitespace before asserting on what the player reads.
    hud_n = re.sub(r"(?<=\d)\s+(?=\d)", "", hud)
    R["snapshot"] = pg.evaluate("() => { const s = CRESTBOUND.game.__dev.state(); return s; }")
    ok("in-play HUD shows 2 crests and 37 coins",
       ("2 / 7" in hud_n or "2/7" in hud_n) and "37" in hud_n, hud.replace("\n", " | ")[:280])
    layout(pg, "play", "in-play HUD")

    # ---- checkpoint feedback ---------------------------------------------
    pg.evaluate("() => CRESTBOUND.game.onCheckpoint(1)")
    # Read the DOM BEFORE the still: a screencast still costs seconds on this
    # page and the checkpoint toast only lives ~2.6 s, so probing afterwards was
    # measuring whether the capture was fast, not whether the HUD reacted.
    cpt = pg.evaluate("""() => {
      const nodes=[...document.querySelectorAll('#hud *')].filter(n=>{
        const c=(n.className&&n.className.baseVal!==undefined)?n.className.baseVal:String(n.className||'');
        return /flash|checkpoint|toast/i.test(c) && n.offsetParent!==null;})
        .map(n=>({cls:(n.className.baseVal!==undefined?n.className.baseVal:n.className),
                  text:(n.textContent||'').trim().slice(0,60)}));
      return { nodes, hudText:(document.getElementById('hud').innerText||'').slice(0,300) }; }""")
    R["checkpoint"] = cpt
    ok("checkpoint gives visible HUD feedback", len(cpt["nodes"]) > 0, json.dumps(cpt["nodes"])[:320])
    # One fact, one number: the persistent pip and the toast celebrating the SAME
    # checkpoint must agree (the pip used to render cpIndex+1, so it read "2 / 4"
    # beside a "CHECKPOINT 1 / 4" toast — and "1 / 4" while still on the spawn).
    pg.wait_for_timeout(400)          # the pip is written by the next HUD update
    cpn = pg.evaluate(CP_NUMBERS_JS)
    R["cpNumbers"] = cpn
    _chip = cpn.get("chip") or ""
    _m = re.search(r"(\d+)\s*/\s*(\d+)", _chip)
    _n = int(_m.group(1)) if _m else None
    _t = int(_m.group(2)) if _m else None
    ok("the checkpoint pip and the checkpoint toast agree (spawn reads 0)",
       _n is not None and _n == cpn.get("toastN") and _t == cpn.get("toastTot")
       and _n == (cpn.get("cpIndex") or 0),
       "pip=%r toast=%r cpIndex=%s cpCount=%s"
       % (_chip, cpn.get("toast"), cpn.get("cpIndex"), cpn.get("cpCount")))
    cap.still("checkpoint_00.png")
    cap.still("checkpoint_01.png")
    pg.wait_for_timeout(2200)

    # ---- pause menu -------------------------------------------------------
    pg.keyboard.press("Escape")
    got, st = wait_state(pg, ("paused",), 15)
    pg.wait_for_timeout(1000)
    cap.still("pause.png")
    ok("Escape opens the pause menu", got, "state=%s" % st)
    R["pauseText"] = pg.evaluate("() => (document.getElementById('ui').innerText||'').trim().slice(0,500)")

    # ONE scope, ONE denominator: the HUD chip and the pause header must agree
    # with each other and with the live run (37 coins collected above).
    coinsurf = pg.evaluate("""() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      // odometer digits are separate block boxes -> innerText breaks "37" apart
      const digits = (t) => norm(t).replace(/([0-9])[^\\S]*(?=[0-9])/g, '$1');
      const chip = document.querySelector('.ch-coins');
      let pause = null;
      for (const s of document.querySelectorAll('.cm-hstat')) {
        const k = s.querySelector('.k'), v = s.querySelector('.v');
        if (k && /COINS/i.test(k.textContent || '')) pause = norm(v ? v.textContent : '');
      }
      const g = CRESTBOUND.game;
      return { hud: chip ? digits(chip.innerText) : null, pause,
               live: g.coins, goal: g.coinsGoal };
    }""")
    R["coinSurfaces"] = coinsurf

    def pair(s):
        m = re.search(r"(\d+)\s*/\s*(\d+)", s or "")
        return (int(m.group(1)), int(m.group(2))) if m else None

    ph, pp = pair(coinsurf.get("hud")), pair(coinsurf.get("pause"))
    live, goal = coinsurf.get("live"), coinsurf.get("goal")
    ok("coin count agrees across HUD chip and pause header (live run, one denominator)",
       ph is not None and pp is not None and ph == pp and ph == (live, goal),
       "hud=%r pause=%r live=%s goal=%s" % (coinsurf.get("hud"), coinsurf.get("pause"), live, goal))
    p0 = pg.evaluate("() => { const a=document.activeElement; return a?(a.textContent||'').trim():null; }")
    pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(250)
    p1 = pg.evaluate("() => { const a=document.activeElement; return a?(a.textContent||'').trim():null; }")
    ok("pause menu navigates by keyboard", p1 is not None and p1 != p0, "%r -> %r" % (p0, p1))
    layout(pg, "pause", "pause menu")
    pg.keyboard.press("Escape")
    wait_state(pg, ("playing",), 20, nudge=True)
    pg.wait_for_timeout(800)

    death_strip(pg, cap)
    return True


# --------------------------------------------------------------------------
# the death strip — screencast, because a still costs seconds on this page
# --------------------------------------------------------------------------

def death_strip(pg, cap):
    from PIL import Image

    # Nim must be MOVING or the rewind ghost has nothing to replay.
    pg.keyboard.down("KeyW")
    pg.wait_for_timeout(900)
    pre = pg.evaluate("""() => { const p = CRESTBOUND.game.player, h = p.history;
      let n = 0, span = 0;
      if (h && typeof h.at === 'function') { n = h.length|0;
        if (n > 1) { const a=h.at(0), b=h.at(n-1);
          if (a && b) span = Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z); } }
      return { speed:+Math.hypot(p.vel.x,p.vel.z).toFixed(2), state:p.state, historyN:n,
               historySpan:+span.toFixed(3), pos:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)] }; }""")
    R["preDeath"] = pre
    ok("Nim is running when the kill lands (so the rewind has motion to replay)",
       pre["speed"] > 3.0 and pre["historyN"] > 4 and pre["historySpan"] > 0.4,
       "speed=%.2f state=%s historyN=%d span=%.2f m" % (pre["speed"], pre["state"], pre["historyN"], pre["historySpan"]))

    cap.frames.clear()                 # the live screencast IS the strip recorder

    # per-frame recorder inside the page, then the kill
    pg.evaluate("""() => {
      const g = CRESTBOUND.game;
      window.__dtrack = [];
      const veil = document.getElementById('cb-veil');
      /* Sample the veil the way the GAME writes it, not the way a rAF happens to
         catch it: at 8 fps the one fully-covered frame falls between rAF ticks. */
      window.__veiltrack = [];
      if (!g.__veilWrapped) {
        g.__veilWrapped = true;
        const orig = g._setVeil.bind(g);
        g._setVeil = function (a, mode) {
          window.__veiltrack.push({ dT: g._deathT, a: +(+a).toFixed(4), mode: mode || null });
          return orig(a, mode);
        };
      }
      const t0 = performance.now();
      const tick = () => {
        const t = performance.now() - t0;
        const h = g.hero && g.hero.root ? g.hero.root.position : null;
        window.__dtrack.push({ t:+t.toFixed(1), wall: Date.now(), state:g.state, dT:g._deathT,
          rewind:+(g._rewindK||0).toFixed(3),
          x:h?+h.x.toFixed(3):null, y:h?+h.y.toFixed(3):null, z:h?+h.z.toFixed(3):null,
          veil: veil ? +parseFloat(getComputedStyle(veil).opacity||'0').toFixed(3) : null,
          ir: veil ? (getComputedStyle(veil).display === 'none' ? 100
                : parseFloat(veil.style.getPropertyValue('--cb-ir') || '100')) : null,
          respawn: g.lastRespawnMs });
        if (t < 1500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__killWall = Date.now();
      g.player.kill('void');
    }""")
    kill_wall = pg.evaluate("() => window.__killWall")
    t_kill = time.time()
    pg.keyboard.up("KeyW")

    t0 = time.time()
    while time.time() - t0 < 2.2:
        pg.wait_for_timeout(30)
    frames = list(cap.frames)
    track = pg.evaluate("() => window.__dtrack || []")
    R["deathTrack"] = track

    # map each captured frame onto the death clock the page was at
    def dclock(wall_ms):
        best, bd = None, 1e9
        for s in track:
            d = abs(s["wall"] - wall_ms)
            if d < bd:
                bd, best = d, s
        return best

    strip = []
    for i, (ts, data) in enumerate(frames[:24]):
        wall_ms = kill_wall + (ts - t_kill) * 1000.0
        s = dclock(wall_ms) or {}
        ms = round(wall_ms - kill_wall)
        dc = s.get("dT")
        name = "death_%02d_dT%s.png" % (i, ("%04d" % dc) if isinstance(dc, (int, float)) and dc >= 0 else "pre")
        img = Image.open(io.BytesIO(base64.b64decode(data)))
        img.save(os.path.join(cap.out, name))
        R["shots"].append(name)
        strip.append({"shot": name, "sinceKillMs": ms, "deathClock": s.get("dT"),
                      "state": s.get("state"), "rewind": s.get("rewind"), "veil": s.get("veil")})
    R["death"] = strip
    print("  strip %d frames, cadence %s ms" % (
        len(strip), [strip[i + 1]["sinceKillMs"] - strip[i]["sinceKillMs"] for i in range(len(strip) - 1)][:12]))
    ok("death strip captured across the whole sequence (>= 6 frames inside 800 ms)",
       len([s for s in strip if s["sinceKillMs"] <= 800]) >= 6,
       "%d frames <= 800 ms of %d total" % (len([s for s in strip if s["sinceKillMs"] <= 800]), len(strip)))

    # the ghost must really move backward along the path Nim just ran
    rew = [s for s in track if isinstance(s.get("dT"), (int, float)) and 88 <= s["dT"] < 315 and s.get("x") is not None]
    dist = 0.0
    for a, b in zip(rew, rew[1:]):
        dist += ((b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2 + (b["z"] - a["z"]) ** 2) ** 0.5
    away = 0.0
    if rew:
        away = ((pre["pos"][0] - rew[-1]["x"]) ** 2 + (pre["pos"][2] - rew[-1]["z"]) ** 2) ** 0.5
    R["rewind"] = {"frames": len(rew), "pathLen": round(dist, 3), "awayFromDeathPos": round(away, 3),
                   "samples": rew}
    ok("death rewind ghost really moves backwards (>=3 frames, path > 0.4 m, ends away from the death spot)",
       len(rew) >= 3 and dist > 0.4 and away > 0.35, json.dumps(
           {k: R["rewind"][k] for k in ("frames", "pathLen", "awayFromDeathPos")}))

    # The iris expresses COVER through the mask radius, not through opacity —
    # `_setVeil` pins opacity to 1 the moment the plate is shown at ANY coverage,
    # so an opacity test can never fail. Cover = `--cb-ir` reaching 0 %.
    veils = [s.get("veil") for s in track if isinstance(s.get("dT"), (int, float)) and s["dT"] >= 0]
    R["veilPeak"] = max([v for v in veils if v is not None] or [0])
    irs = [s.get("ir") for s in track if isinstance(s.get("dT"), (int, float)) and s["dT"] >= 0
           and isinstance(s.get("ir"), (int, float))]
    vt = pg.evaluate("() => window.__veiltrack || []")
    R["veilWrites"] = vt[-20:]
    applied = [v["a"] for v in vt if isinstance(v.get("dT"), (int, float)) and v["dT"] >= 0]
    if applied:
        irs.append(round((1 - max(applied)) * 100, 2))
    R["veilIrMin"] = min(irs) if irs else None
    R["veilCleared"] = pg.evaluate("""() => { const v=document.getElementById('cb-veil');
      if (!v) return null; const cs=getComputedStyle(v);
      return {display:cs.display, opacity:+parseFloat(cs.opacity||'0').toFixed(3),
              ir:v.style.getPropertyValue('--cb-ir')}; }""")
    cleared = (R["veilCleared"] or {}).get("display") == "none" or               ((R["veilCleared"] or {}).get("opacity") or 0) < 0.02
    ok("the iris really closes over the swap (mask radius reaches full cover) and clears after",
       R["veilIrMin"] is not None and R["veilIrMin"] <= 2.0 and R["veilPeak"] > 0.9 and cleared,
       "min mask radius %s%% (0%% = full cover), peak opacity %.3f, after=%s"
       % (R["veilIrMin"], R["veilPeak"], json.dumps(R["veilCleared"])))

    resp = pg.evaluate("() => CRESTBOUND.game.lastRespawnMs")
    tl = pg.evaluate("() => CRESTBOUND.game.lastDeathTimeline || null")
    R["respawnMs"], R["deathTimeline"] = resp, tl
    ok("respawn (kill -> controls restored) <= 700 ms",
       isinstance(resp, (int, float)) and 0 < resp <= 700,
       "lastRespawnMs=%s  timeline=%s" % (resp, json.dumps(tl)))

    pg.wait_for_timeout(1500)
    cap.still("death_after.png")
    after = pg.evaluate("""() => { const g=CRESTBOUND.game, p=g.player;
      const v=document.getElementById('cb-veil');
      return { state:g.state, deaths:g.deaths, cpIndex:g.cpIndex, dead:!!p.dead,
               pos:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)],
               speed:+Math.hypot(p.vel.x,p.vel.z).toFixed(2), clock:g.course?+g.course.clock.toFixed(2):null,
               veil: v?+parseFloat(getComputedStyle(v).opacity||'0'):null }; }""")
    R["afterDeath"] = after
    ok("clean respawn: alive, back in play, veil clear, hazards rewound",
       after["state"] == "playing" and not after["dead"] and (after["veil"] or 0) < 0.05,
       json.dumps(after)[:320])
    layout(pg, "after_death", "after respawn")


def phase_death_only(pg, cap, url):
    """Straight to verdant-1 and one death — for re-measuring the strip when the
    box is quiet enough that the compositor can actually deliver frames."""
    pg.goto(url + "?dev=1", wait_until="load", timeout=60_000)
    if not wait_for(pg, "() => !!(globalThis.CRESTBOUND && CRESTBOUND.game)", 240):
        raise RuntimeError("TargetClosed-equivalent: CRESTBOUND.game never appeared")
    wait_state(pg, ("title",), 180)
    pg.evaluate(ACTIVATE_JS, "NEW GAME")
    pg.wait_for_timeout(900)
    if any("ERASE" in b.upper() for b in pg.evaluate(VISIBLE_BTNS)):
        pg.evaluate(ACTIVATE_JS, "ERASE")
    wait_state(pg, ("keep", "playing"), 180)
    if not wait_for(pg, "() => !!(CRESTBOUND.game && CRESTBOUND.game.__dev && CRESTBOUND.game.__dev.gates)", 60):
        raise RuntimeError("TargetClosed-equivalent: __dev never installed (boot was starved)")
    pg.evaluate("() => { const d = CRESTBOUND.game.__dev; if (d && d.panel) d.panel(false); }")

    # WHY the walk-in never fires: measure the painting's trigger volume against
    # the player's FEET position, which is what _updateGates tests.
    gv = pg.evaluate("""() => {
      const G = CRESTBOUND.game;
      const g = G.__dev.gates().find(x => x.course === 'verdant-1');
      if (!g) return null;
      const v = g.volume;
      const out = { gateP: [g.pos.x, g.pos.y, g.pos.z], hasVolume: !!v };
      if (v) {
        const c = v.center, h = v.half;
        out.center = c ? [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)] : null;
        out.half = h ? [+h.x.toFixed(3), +h.y.toFixed(3), +h.z.toFixed(3)] : null;
        if (out.center && out.half) out.yRange = [+(out.center[1]-out.half[1]).toFixed(3), +(out.center[1]+out.half[1]).toFixed(3)];
        const T = CRESTBOUND.THREE;
        const feet = G.player.pos.clone();
        const atFrame = new T.Vector3(g.pos.x, feet.y, g.pos.z);
        out.feetY = +feet.y.toFixed(3);
        out.containsFeetAtFrame = !!v.contains(atFrame);
        atFrame.y = out.center[1];
        out.containsAtVolumeHeight = !!v.contains(atFrame);
      }
      return out;
    }""")
    R["gateVolume"] = gv
    note("painting trigger volume: %s" % json.dumps(gv))
    if gv and gv.get("hasVolume"):
        ok("the painting's walk-in trigger volume reaches the floor Nim walks on",
           bool(gv.get("containsFeetAtFrame")),
           "feetY=%s volume y-range=%s -> contains(feet)=%s, contains(same xz at volume height)=%s"
           % (gv.get("feetY"), gv.get("yRange"), gv.get("containsFeetAtFrame"), gv.get("containsAtVolumeHeight")))

    pg.evaluate("async () => { await CRESTBOUND.game.__dev.goto('verdant-1'); }")
    got, st = wait_state(pg, ("playing",), 180, nudge=True)
    ok("reached verdant-1 for the death strip", got, "state=%s" % st)
    pg.wait_for_timeout(2500)
    fps = pg.evaluate("() => CRESTBOUND.engine.stats.fps")
    note("fps before the kill: %s" % fps)
    R["stripFps"] = fps
    death_strip(pg, cap)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--skip-release", action="store_true")
    ap.add_argument("--death-only", action="store_true")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    console = []

    # Chrome dies under contention on this box (HARNESS_NOTES: run browser gates
    # ONE at a time). A phase that loses its target is retried in a fresh browser
    # instead of being reported as a UI defect.
    def run_phase(label, fn, attempts=3):
        for a in range(1, attempts + 1):
            keep = len(R["checks"])
            with sync_playwright() as p:
                try:
                    br = p.chromium.launch(channel="chrome", headless=not args.headed, args=FLAGS)
                except Exception as e:
                    print("no hardware Chrome (%s) -> chromium + swiftshader" % str(e)[:120], file=sys.stderr)
                    br = p.chromium.launch(headless=not args.headed,
                                           args=[f for f in FLAGS if not f.startswith("--use-angle")] +
                                                ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
                ctx = br.new_context(viewport=VIEW, device_scale_factor=1)
                pg = ctx.new_page()
                pg.on("console", lambda m: console.append({"type": m.type, "text": m.text[:300]}))
                pg.on("pageerror", lambda e: console.append({"type": "pageerror", "text": str(e)[:300]}))
                pg.on("crash", lambda _: print("  !!    page crashed"))
                try:
                    fn(pg, Cap(pg, out), args.url)
                    try:
                        ctx.close(); br.close()
                    except Exception:
                        pass
                    return True
                except Exception as e:
                    msg = repr(e)[:200]
                    try:
                        ctx.close(); br.close()
                    except Exception:
                        pass
                    if "TargetClosed" in msg or "crash" in msg.lower():
                        del R["checks"][keep:]          # a dead browser is not evidence
                        print("  ..    %s lost its browser (attempt %d/%d) -> retry" % (label, a, attempts))
                        time.sleep(6)
                        continue
                    ok(label + " completed", False, msg)
                    return False
        ok(label + " completed", False, "browser died on every attempt")
        return False

    if args.death_only:
        print("\n--- DEATH STRIP ONLY ---")
        run_phase("death strip", phase_death_only)
    else:
        if not args.skip_release:
            print("\n--- PHASE A   release build (no ?dev=1) ---")
            run_phase("phase A", phase_release)

        print("\n--- PHASE B   ?dev=1   keep -> card -> course -> death ---")
        run_phase("phase B", phase_play)

    errs = [c for c in console if c["type"] in ("error", "pageerror")]
    R["console"] = console[-60:]
    ok("no console / page errors across the whole UI walk", not errs, json.dumps(errs[:4])[:400])

    with open(os.path.join(HERE, "uishots.json"), "w", encoding="utf-8") as f:
        json.dump(R, f, indent=1)

    bad = [c for c in R["checks"] if not c["pass"]]
    print("\nUI SHOTS: %d/%d checks passed, %d images -> %s"
          % (len(R["checks"]) - len(bad), len(R["checks"]), len(R["shots"]), out))
    for b in bad:
        print("  FAILING: %s   %s" % (b["name"], b["detail"][:220]))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
