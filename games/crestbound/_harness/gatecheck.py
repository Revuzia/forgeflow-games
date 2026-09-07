#!/usr/bin/env python
"""CRESTBOUND gate check -- can a PLAYER actually get into a world?

The P0 gate. For every one of the Keep's 13 course gates it drives the real
browser build with real KeyboardEvents and asserts, at BOTH sides of the gate's
crest requirement:

  state          the live gate object carries a real boolean (`locked` and its
                 `unlocked` / `sealed` mirrors) -- never `undefined`, which is
                 falsy and reads as "sealed" to anything that asks
  save agreement Save.unlockedGates(keepDef) and the live gate agree, INCLUDING
                 the Save.unlockAll() accessibility hatch
  live refresh   crests written to the save while the player stands in the Keep
                 open the gate WITHOUT a hub reload
  locked walk    walking into a sealed gate from 3 approach angles refuses with
                 a readable reason naming the crest count -- never silence
  unlocked walk  walking into an open gate from 3 approach angles raises the
                 course card; ENTER loads THAT course id; returnToKeep() lands
                 back in the hub
  title          gameplay input is dead while the title screen is up (both the
                 shipping build and ?dev=1), and NEW GAME starts the hero on
                 the Keep's authored spawn rather than wherever he wandered

    python gatecheck.py                  # all 13 gates
    python gatecheck.py --gates verdant-1,ember-1
    python gatecheck.py --headless

The player's real save is snapshotted and written back, so the gate never costs
anyone their crests. Exit 0 = every assertion passed.
"""
import argparse
import json
import math
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8788/games/crestbound/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]
SAVE_KEY = "crestbound.save.v1"

STAND_DIST = 3.0        # metres out from the wall face the walk starts at
WALK_MS = 3400          # how long a walk-in gets before it is a failure
SETTLE_MS = 420

RESULTS = {"pass": 0, "fail": 0, "rows": []}


def ok(name, cond, detail=""):
    RESULTS["rows"].append({"name": name, "ok": bool(cond), "detail": detail})
    if cond:
        RESULTS["pass"] += 1
    else:
        RESULTS["fail"] += 1
        print("  FAIL  %s  %s" % (name, detail))
    return bool(cond)


# ---------------------------------------------------------------- page helpers

def wait_ready(pg, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


CLICK_TITLE = r"""() => {
  const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
  for (const want of ['NEW GAME', 'NEW', 'CONTINUE', 'PLAY', 'START']) {
    const b = btns.find(x => (x.textContent || '').toUpperCase().indexOf(want) >= 0);
    if (b) { if (typeof b.__activate === 'function') b.__activate(); else b.click(); return want; }
  }
  return null;
}"""

# Award `n` crests across the real course ids WITHOUT touching the gate code, so
# the refresh path under test is the game's own, not the harness's.
SET_CRESTS = r"""(n) => {
  const G = CRESTBOUND.game, S = G.save;
  S.reset();
  const ids = ['verdant-1','verdant-2','verdant-3','ember-1','ember-2','ember-3','ember-4',
               'rime-1','rime-2','rime-3','azure-1','azure-2','azure-3'];
  let given = 0, k = 0;
  while (given < n && k < ids.length * 8) {
    const id = ids[(k / 8) | 0];
    if (S.collectCrest(id, 'h' + (k % 8))) given++;
    k++;
  }
  return { asked: n, total: S.crestTotal() };
}"""

GATE_TABLE = r"""() => {
  const G = CRESTBOUND.game;
  return (G._gates || []).map((g) => ({
    course: g.course, requires: g.requires, kind: g.kind,
    pos: [g.pos.x, g.pos.y, g.pos.z],
    exit: [g.exitPos.x, g.exitPos.y, g.exitPos.z],
    yaw: g.yaw,
  }));
}"""

GATE_STATE = r"""(course) => {
  const G = CRESTBOUND.game;
  const rg = (G._gates || []).find(g => g.course === course) || null;
  const cg = ((G.course && G.course.gates) || []).find(g => g.course === course) || null;
  const keepDef = G.course && G.course.def;
  let open = null;
  try { open = G.save.unlockedGates(keepDef).indexOf(rg ? rg.index : -1) >= 0; } catch (e) { open = null; }
  return {
    total: G.save.crestTotal(),
    requires: rg ? rg.requires : null,
    resolvedLocked: rg ? rg.locked : null,
    resolvedUnlocked: rg ? rg.unlocked : undefined,
    courseLocked: cg ? cg.locked : null,
    courseUnlocked: cg ? cg.unlocked : undefined,
    courseSealed: cg ? cg.sealed : undefined,
    saveSaysOpen: open,
  };
}"""


# When a walk-in fails, say WHY in the failure line -- the gate is only useful
# if it hands the next reader the reason instead of a symptom.
WHY = r"""(course) => {
  const G = CRESTBOUND.game;
  const i = (G._gates || []).findIndex(g => g.course === course);
  const g = G._gates[i];
  const pp = G.player.pos;
  const v = g && g.volume;
  return {
    idx: i, near: G._gateNear, suppressed: G._gateSuppressed,
    dwell: +(G._gateDwell || 0).toFixed(3), locked: g && g.locked,
    loading: G._loading, gateOpenT: G._gateOpenT, deathT: G._deathT,
    insideVolume: v ? !!v.contains(pp) : null,
    volumeActive: v ? v.active : null,
    d2: g ? +((pp.x - g.pos.x) ** 2 + (pp.z - g.pos.z) ** 2).toFixed(2) : null,
  };
}"""

DISMISS = r"""() => {
  const G = CRESTBOUND.game;
  if (G.state === 'card' && G.card && typeof G.card.close === 'function') G.card.close('cancel');
  return G.state;
}"""

# The player steers with the mouse while he walks; the harness holds that steer
# for him. `yawForMovement` is `yaw + _yawSlide` (camera.js), so the pin is
# written through the slide or the collision solver quietly turns the walk.
AIM = r"""([course, offset]) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g || !G.cam) return null;
  const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw);
  const tx = g.pos.x + lx * offset * 0.35, tz = g.pos.z + lz * offset * 0.35;
  const dx = tx - G.player.pos.x, dz = tz - G.player.pos.z;
  if (dx * dx + dz * dz < 1e-4) return null;
  const yaw = Math.atan2(-dx, -dz);                          // yawFromHeading
  const slide = (typeof G.cam._yawSlide === 'number') ? G.cam._yawSlide : 0;
  G.cam.yaw = yaw - slide;
  G.cam._rcHoldT = 0;
  return +yaw.toFixed(3);
}"""


def place(pg, course, offset, dist=STAND_DIST):
    """Teleport the hero to a stand-off spot in front of the gate and aim the camera at it.

    The spot is pulled in toward the wall until there is floor under it, so a
    gate in a shallow niche (azure-3's roof aedicule) is approached from its own
    deck instead of from thin air over the parapet.
    """
    pg.evaluate(DISMISS)
    pg.wait_for_timeout(260)
    out = pg.evaluate(r"""([course, off, dist]) => {
      const G = CRESTBOUND.game;
      const g = (G._gates || []).find(x => x.course === course);
      if (!g) return null;
      const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);      // out of the wall, into the room
      const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw);     // along the wall
      const bp = G.physWorld && G.physWorld.broadphase;
      const hit = { t: 0, normal: { x: 0, y: 0, z: 0 }, collider: null, heightfield: null };
      let use = dist, x = 0, z = 0, y = g.exitPos.y + 0.12;
      for (const d of [dist, dist - 0.8, 1.9]) {
        x = g.pos.x + fx * d + lx * off;
        z = g.pos.z + fz * d + lz * off;
        use = d;
        if (!bp || typeof bp.raycast !== 'function') break;
        let found = false;
        try {
          found = bp.raycast({ x: x, y: y + 1.4, z: z }, { x: 0, y: -1, z: 0 }, 3.0, hit);
        } catch (e) { found = false; }
        if (found) break;
      }
      G.player.__test.teleport({ x: x, y: y, z: z });
      G.player.__test.setVel({ x: 0, y: 0, z: 0 });
      const dx = g.pos.x - x, dz = g.pos.z - z;
      const yaw = Math.atan2(-dx, -dz);                      // yawFromHeading
      G.player.__test.setFacing(yaw);
      if (G.cam) { G.cam.yaw = yaw; G.cam._rcHoldT = 0; }
      return { from: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], dist: +use.toFixed(2) };
    }""", [course, offset, dist])
    pg.wait_for_timeout(SETTLE_MS)
    pg.evaluate(AIM, [course, offset])
    return out


PROBE = r"""() => {
  const G = CRESTBOUND.game;
  const el = document.getElementById('cb-prompt');
  const shown = !!(el && el.classList.contains('show'));
  const toasts = Array.from(document.querySelectorAll('.ch-toast'))
    .map(n => (n.textContent || '').trim()).join(' | ');
  const card = document.querySelector('.cb-card');
  return {
    state: G.state,
    courseId: G.courseId,
    pos: [+G.player.pos.x.toFixed(2), +G.player.pos.y.toFixed(2), +G.player.pos.z.toFixed(2)],
    near: G._gateNear,
    prompt: shown && el ? (el.textContent || '').trim() : '',
    promptShown: shown,
    toast: toasts,
    cardOpen: !!(card && card.classList.contains('on')),
  };
}"""


def walk_in(pg, course, offset, ms=WALK_MS, stop_on_card=True):
    """Hold W with real KeyboardEvents until the game reacts or the budget runs out."""
    pg.keyboard.down("w")
    seen = {"prompt": "", "toast": ""}
    t0 = time.time()
    out = None
    while (time.time() - t0) * 1000 < ms:
        pg.wait_for_timeout(120)
        pg.evaluate(AIM, [course, offset])
        out = pg.evaluate(PROBE)
        if out["prompt"]:
            seen["prompt"] = out["prompt"]
        if out["toast"]:
            seen["toast"] = out["toast"]
        if stop_on_card and (out["state"] == "card" or out["cardOpen"]):
            break
    pg.keyboard.up("w")
    pg.wait_for_timeout(200)
    out = pg.evaluate(PROBE)
    out["seenPrompt"] = seen["prompt"]
    out["seenToast"] = seen["toast"]
    return out


def has_number(text, n):
    return text is not None and str(int(n)) in text


# ------------------------------------------------------------------ the checks

def check_title(pg, url, label):
    """Gameplay input must be dead behind the title, in EVERY build flavour."""
    pg.goto(url, wait_until="load", timeout=90000)
    if not wait_ready(pg):
        ok("title[%s] boots" % label, False, "the page never produced CRESTBOUND.game.course")
        return
    pg.wait_for_timeout(1400)
    st = pg.evaluate("() => CRESTBOUND.game.state")
    ok("title[%s] starts on the title screen" % label, st == "title", "state=%s" % st)
    p0 = pg.evaluate("() => [CRESTBOUND.game.player.pos.x, CRESTBOUND.game.player.pos.y, CRESTBOUND.game.player.pos.z]")
    for key in ("w", "a", "s", "d", "Space"):
        pg.keyboard.down(key)
        pg.wait_for_timeout(700)
        pg.keyboard.up(key)
    pg.wait_for_timeout(400)
    p1 = pg.evaluate("() => [CRESTBOUND.game.player.pos.x, CRESTBOUND.game.player.pos.y, CRESTBOUND.game.player.pos.z]")
    moved = math.sqrt(sum((a - b) ** 2 for a, b in zip(p0, p1)))
    ok("title[%s] gameplay input is suspended" % label, moved < 0.35,
       "the hero moved %.2f m behind the title screen (%s -> %s)"
       % (moved, [round(v, 2) for v in p0], [round(v, 2) for v in p1]))
    spawn = pg.evaluate("() => { const d = CRESTBOUND.game.course.def; const s = d && d.spawn; return s && s.p ? s.p : null; }")
    pg.evaluate(CLICK_TITLE)
    pg.wait_for_timeout(2600)
    st2 = pg.evaluate(PROBE)
    ok("title[%s] NEW GAME reaches a playable Keep" % label, st2["state"] == "keep",
       "state=%s" % st2["state"])
    if spawn:
        d = math.hypot(spawn[0] - st2["pos"][0], spawn[2] - st2["pos"][2])
        ok("title[%s] NEW GAME starts on the authored spawn" % label, d < 2.0,
           "the hero began %.2f m from the Keep spawn %s (at %s)" % (d, spawn, st2["pos"]))
    ok("title[%s] the HUD is up after NEW GAME" % label,
       pg.evaluate("() => !!document.querySelector('.cb-hud')"), "no .cb-hud in the DOM")


def check_gate(pg, g, full_enter):
    course = g["course"]
    req = int(g["requires"])
    print("\n-- %s  (requires %d crest%s, %s)" % (course, req, "" if req == 1 else "s", g["kind"]))
    off = 0.6 if g["kind"] == "door" else 1.0
    angles = [0.0, -off, off]

    # ---------------- SEALED side: one crest short -------------------------
    if req > 0:
        pg.evaluate(SET_CRESTS, req - 1)
        pg.wait_for_timeout(SETTLE_MS)
        st = pg.evaluate(GATE_STATE, course)
        ok("%s: sealed one crest short" % course, st["resolvedLocked"] is True,
           "locked=%r with %s/%s crests" % (st["resolvedLocked"], st["total"], st["requires"]))
        ok("%s: sealed gate carries a real boolean" % course,
           st["courseUnlocked"] is False and st["courseSealed"] is True,
           "course gate unlocked=%r sealed=%r (undefined reads as sealed to every caller)"
           % (st["courseUnlocked"], st["courseSealed"]))
        ok("%s: the save agrees it is sealed" % course, st["saveSaysOpen"] is False,
           "Save.unlockedGates says open=%r while the gate says locked=%r"
           % (st["saveSaysOpen"], st["resolvedLocked"]))
        for a in angles:
            place(pg, course, a)
            r = walk_in(pg, course, a, stop_on_card=False)
            ok("%s: sealed walk-in (offset %+.1f m) refuses" % (course, a),
               r["state"] == "keep" and not r["cardOpen"],
               "state=%s cardOpen=%s" % (r["state"], r["cardOpen"]))
            said = (r["seenPrompt"] or "") + " " + (r["seenToast"] or "")
            ok("%s: sealed walk-in (offset %+.1f m) says what it needs" % (course, a),
               has_number(said, req) and ("CREST" in said.upper()),
               "nothing readable named %d crests -- saw %r" % (req, said.strip()[:120]))

    # ---------------- OPEN side: the requirement met -----------------------
    # The crests are written with the player STANDING IN THE KEEP and no hub
    # reload, so this also proves the gate refreshes off the save's own event.
    pg.evaluate(SET_CRESTS, req)
    pg.wait_for_timeout(SETTLE_MS)
    st = pg.evaluate(GATE_STATE, course)
    ok("%s: opens on a live crest total (no hub reload)" % course, st["resolvedLocked"] is False,
       "locked=%r with %s/%s crests" % (st["resolvedLocked"], st["total"], st["requires"]))
    ok("%s: open gate carries a real boolean" % course,
       st["courseUnlocked"] is True and st["courseSealed"] is False,
       "course gate unlocked=%r sealed=%r" % (st["courseUnlocked"], st["courseSealed"]))
    ok("%s: the save agrees it is open" % course, st["saveSaysOpen"] is True,
       "Save.unlockedGates says open=%r while the gate says locked=%r"
       % (st["saveSaysOpen"], st["resolvedLocked"]))

    for i, a in enumerate(angles):
        place(pg, course, a)
        r = walk_in(pg, course, a)
        raised = r["state"] == "card" or r["cardOpen"]
        why = "" if raised else json.dumps(pg.evaluate(WHY, course))
        ok("%s: walk-in (offset %+.1f m) raises the course card" % (course, a), raised,
           "state=%s pos=%s prompt=%r %s" % (r["state"], r["pos"], (r["seenPrompt"] or "")[:60], why))
        if not raised:
            continue
        if i == 0 and full_enter:
            # The card is a UI surface: confirm it the way a player does, with the
            # key first and the button as the fallback (the key handler is bound
            # in show(), so a keypress that lands in the same frame can be lost).
            pg.wait_for_timeout(500)
            pg.keyboard.press("Enter")
            deadline = time.time() + 25
            got = None
            clicked = False
            while time.time() < deadline:
                pg.wait_for_timeout(300)
                got = pg.evaluate(PROBE)
                if got["courseId"] == course and got["state"] in ("playing", "cinematic"):
                    break
                if not clicked and (time.time() - (deadline - 25)) > 4 and got["state"] == "card":
                    clicked = True
                    pg.evaluate(r"""() => {
                      const c = document.querySelector('.cb-card');
                      if (!c) return false;
                      const b = Array.from(c.querySelectorAll('button'))
                        .find(x => /ENTER/i.test(x.textContent || '') && !x.disabled);
                      if (!b) return false;
                      if (typeof b.__activate === 'function') b.__activate(); else b.click();
                      return true;
                    }""")
            ok("%s: ENTER loads that course" % course,
               bool(got) and got["courseId"] == course,
               "landed in courseId=%r state=%r" % (got and got["courseId"], got and got["state"]))
            pg.evaluate("() => CRESTBOUND.game.returnToKeep().catch(() => {})")
            deadline = time.time() + 30
            back = None
            while time.time() < deadline:
                pg.wait_for_timeout(300)
                back = pg.evaluate(PROBE)
                if back["state"] == "keep" and back["courseId"] == "keep":
                    break
            ok("%s: returning to the Keep works" % course,
               bool(back) and back["state"] == "keep" and back["courseId"] == "keep",
               "state=%r courseId=%r" % (back and back["state"], back and back["courseId"]))
        else:
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(700)
            back = pg.evaluate(PROBE)
            ok("%s: cancelling the card (offset %+.1f m) returns control" % (course, a),
               back["state"] == "keep", "state=%r" % back["state"])


# ------------------------------------------------------------- gate GEOMETRY
# The walk-in tests prove a gate can be entered from the three angles the
# harness drives.  These two prove the PLACEMENT that makes that possible, so a
# painting moved onto a blank wall, hung too high, or given a trigger sunk into
# the masonry fails HERE, with the reason, instead of failing as a mysteriously
# silent walk.

# Nine points across the doorway at FEET height on the authored walking floor
# (`_updateGates` tests `volume.contains(player.pos)` and `player.pos` is the
# feet -- contract §10), plus one point half a metre INSIDE the wall.
DOORWAY = r"""(course) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g) return null;
  if (!g.volume) return { volume: false };
  const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);     // out of the wall, into the room
  const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw);    // along the wall
  const y = g.exitPos.y + 0.02;                         // the floor he walks in on
  const front = [], miss = [];
  for (const d of [0.35, 0.75, 1.15]) {
    for (const lat of [-0.85, 0, 0.85]) {
      const x = g.pos.x + fx * d + lx * lat, z = g.pos.z + fz * d + lz * lat;
      const inside = !!g.volume.contains({ x: x, y: y, z: z });
      front.push(inside);
      if (!inside) miss.push([+d.toFixed(2), +lat.toFixed(2)]);
    }
  }
  const back = !!g.volume.contains({ x: g.pos.x - fx * 0.5, y: y, z: g.pos.z - fz * 0.5 });
  return {
    volume: true, front: front, miss: miss, insideWall: back,
    width: +(g.volume.half.x * 2).toFixed(2), depth: +(g.volume.half.z * 2).toFixed(2),
    span: [+(g.volume.center.y - g.volume.half.y).toFixed(2),
           +(g.volume.center.y + g.volume.half.y).toFixed(2)],
    floor: +g.exitPos.y.toFixed(2),
  };
}"""

DROP = r"""(course) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g) return null;
  G.player.__test.teleport({ x: g.exitPos.x, y: g.exitPos.y + 0.60, z: g.exitPos.z });
  G.player.__test.setVel({ x: 0, y: 0, z: 0 });
  return [+g.exitPos.x.toFixed(2), +g.exitPos.y.toFixed(2), +g.exitPos.z.toFixed(2)];
}"""

LANDED = r"""() => ({
  grounded: !!CRESTBOUND.game.player.grounded,
  y: +CRESTBOUND.game.player.pos.y.toFixed(2),
  pos: [+CRESTBOUND.game.player.pos.x.toFixed(2), +CRESTBOUND.game.player.pos.y.toFixed(2),
        +CRESTBOUND.game.player.pos.z.toFixed(2)],
})"""


def check_geometry(pg, gates, want):
    print("\n== GATE PLACEMENT ==")
    pg.evaluate(SET_CRESTS, 0)
    pg.wait_for_timeout(SETTLE_MS)
    for g in gates:
        course = g["course"]
        if want and course not in want:
            continue
        d = pg.evaluate(DOORWAY, course)
        if not d or not d.get("volume"):
            ok("%s: has a walk-in trigger volume" % course, False, "no Volume on the resolved gate")
            continue
        ok("%s: the trigger covers the doorway at foot height" % course, not d["miss"],
           "floor y=%s, trigger spans y %s, %.2f m wide x %.2f m deep; missed (out,lat) %s"
           % (d["floor"], d["span"], d["width"], d["depth"], d["miss"]))
        ok("%s: the trigger is in FRONT of the wall, not inside it" % course, not d["insideWall"],
           "a point 0.5 m behind the picture plane is inside the trigger")
        ok("%s: the trigger is walk-in sized (>= 2.0 m x >= 1.2 m)" % course,
           d["width"] >= 2.0 and d["depth"] >= 1.2, "%.2f m x %.2f m" % (d["width"], d["depth"]))

        stand = pg.evaluate(DROP, course)
        pg.wait_for_timeout(900)
        r = pg.evaluate(LANDED)
        ok("%s: there is floor to stand on in front of it" % course,
           bool(r["grounded"]) and abs(r["y"] - stand[1]) <= 0.7,
           "dropped at the authored stand-out spot %s and ended %s (grounded=%s)"
           % (stand, r["pos"], r["grounded"]))


# The reward shot for unlocking a world. `_startGateOpen` builds a three-key
# push toward the picture; every key must be on the side of the wall the PLAYER
# is on. Measured 2026-09-06 by `_harness/_gatecam.py`: it stepped forwards
# along `heading(yaw)` -- which points INTO the wall -- so all 13 unlock
# cinematics played from outside the building, over blank exterior masonry, with
# the painting off screen (`_shots/gatecam_verdant-2.png`).
UNLOCK_SHOT = r"""(course) => {
  const G = CRESTBOUND.game;
  const g = (G._gates || []).find(x => x.course === course);
  if (!g) return null;
  G._startGateOpen(g);
  const ox = g.exitPos.x - g.pos.x, oz = g.exitPos.z - g.pos.z;
  const keys = G._gatePath.cam.map(k => [+k.p[0].toFixed(2), +k.p[1].toFixed(2), +k.p[2].toFixed(2)]);
  const side = keys.map(k => +(((k[0] - g.pos.x) * ox + (k[2] - g.pos.z) * oz)).toFixed(2));
  const dolly = +Math.hypot(keys[0][0] - keys[2][0], keys[0][2] - keys[2][2]).toFixed(2);
  G._endGateOpen(true);
  return { keys: keys, side: side, dolly: dolly, floor: +g.exitPos.y.toFixed(2) };
}"""


def check_unlock_shots(pg, gates, want):
    print("\n== GATE-OPENS CINEMATIC ==")
    for g in gates:
        course = g["course"]
        if want and course not in want:
            continue
        r = pg.evaluate(UNLOCK_SHOT, course)
        pg.wait_for_timeout(140)
        if not r:
            ok("%s: unlock shot builds" % course, False, "no gate")
            continue
        ok("%s: the unlock shot films from the room, not through the wall" % course,
           min(r["side"]) > 0,
           "keyframes %s are behind the picture plane (dot %s)" % (r["keys"], r["side"]))
        ok("%s: the unlock shot is above the walking floor" % course,
           all(k[1] > r["floor"] + 0.5 for k in r["keys"]),
           "floor y=%s, keyframe heights %s" % (r["floor"], [k[1] for k in r["keys"]]))
        ok("%s: the unlock shot actually pushes in" % course, r["dolly"] >= 1.0,
           "the camera travels only %.2f m" % r["dolly"])


def check_unlock_all(pg):
    """The accessibility / dev hatch must actually open the doors."""
    pg.evaluate(SET_CRESTS, 0)
    pg.evaluate("() => CRESTBOUND.game.save.unlockAll(true)")
    pg.wait_for_timeout(SETTLE_MS)
    r = pg.evaluate("""() => {
      const G = CRESTBOUND.game;
      return { saveOpen: G.save.unlockedGates(G.course.def).length,
               gameOpen: (G._gates || []).filter(g => !g.locked).length,
               n: (G._gates || []).length };
    }""")
    ok("Save.unlockAll() opens every gate in the live game",
       r["saveOpen"] == r["n"] and r["gameOpen"] == r["n"],
       "the save says %d/%d open, the live gates say %d/%d" % (r["saveOpen"], r["n"], r["gameOpen"], r["n"]))
    pg.evaluate("() => CRESTBOUND.game.save.unlockAll(false)")
    pg.wait_for_timeout(SETTLE_MS)
    r2 = pg.evaluate("() => (CRESTBOUND.game._gates || []).filter(g => !g.locked).length")
    ok("Save.unlockAll(false) seals them again", r2 <= 1, "%d gates still open at 0 crests" % r2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--gates", default="", help="comma-separated course ids (default: all)")
    ap.add_argument("--no-enter", action="store_true", help="skip the course load / return leg")
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    want = [s.strip() for s in args.gates.split(",") if s.strip()]

    t0 = time.time()
    with sync_playwright() as p:
        if args.headless:
            try:
                br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            except Exception:
                br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        fatal = []
        pg.on("pageerror", lambda e: fatal.append(str(e)[:200]))

        url = BASE + "?quality=low&autoscale=0"
        saved = None
        try:
            print("== TITLE (shipping build) ==")
            check_title(pg, url, "ship")
            try:
                saved = pg.evaluate("(k) => window.localStorage.getItem(k)", SAVE_KEY)
            except Exception:
                saved = None

            print("\n== TITLE (?dev=1) ==")
            check_title(pg, BASE + "?dev=1&quality=low&autoscale=0", "dev")

            # the gate walks run on the SHIPPING build
            pg.goto(url, wait_until="load", timeout=90000)
            wait_ready(pg)
            pg.wait_for_timeout(1200)
            pg.evaluate(CLICK_TITLE)
            pg.wait_for_timeout(2600)

            print("\n== UNLOCK-ALL HATCH ==")
            check_unlock_all(pg)

            gates = pg.evaluate(GATE_TABLE)
            ok("the Keep resolves all 13 course gates", len(gates) == 13, "found %d" % len(gates))

            check_geometry(pg, gates, want)
            check_unlock_shots(pg, gates, want)
            for g in gates:
                if want and g["course"] not in want:
                    continue
                check_gate(pg, g, not args.no_enter)
        finally:
            try:
                if saved:
                    pg.evaluate("([k, v]) => window.localStorage.setItem(k, v)", [SAVE_KEY, saved])
                else:
                    pg.evaluate("(k) => window.localStorage.removeItem(k)", SAVE_KEY)
            except Exception:
                pass
            try:
                br.close()
            except Exception:
                pass

    if fatal:
        ok("no uncaught page errors", False, "; ".join(fatal[:3]))
    dur = time.time() - t0
    print("\n%s  %d passed, %d failed  (%.0fs)"
          % ("GATECHECK OK" if RESULTS["fail"] == 0 else "GATECHECK FAILED",
             RESULTS["pass"], RESULTS["fail"], dur))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(RESULTS, f, indent=1)
    return 0 if RESULTS["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
