#!/usr/bin/env python
"""mobile - a phone player's session with REAL CDP multi-touch (PLAN L10 / L5 / L7 / L6 gates).

    python _harness/mobile.py                          # pixel7, iphone14, se, ipad (SwiftShader: the iGPU is shared)
    python _harness/mobile.py --devices pixel7 --disk

Ported from the mobile audit's _spec/improve_2026-09/baseline/lc_mobile.py (dyefield/_harness/mobile.py pattern: device
emulation + Input.dispatchTouchEvent with real finger ids). __LC__ is SETUP and READ-BACK only (landing through
fastForward; teleporting next to a chest); every acceptance action is a touch. Frames are STEPPED between touch events
(common.step_frames), so the checks do not depend on the box's rAF.

Touch controls are found by lane L10's `data-touch-ui="stick|look|fire|jump|reload|use|ads|sprint|pause|map"` marks
(requested of L10) and otherwise by the page-level game_controls.js overlay (#__ffg_touch__: stick, LOOK zone, FIRE /
JUMP / RELOAD buttons), so the same script runs before and after L10 lands.

Per device:
  menus      no touch control is shown over the menus; PLAY ANYWAY / CONTINUE ANYWAY (while they exist) close on ONE tap
  look       a 160 px drag in the look zone turns the camera >= 0.3 rad (today: 0 - no pointer lock on a phone)
  fire       the FIRE control's first press after the menu drops the magazine; holding it 2 s with the pistol fires >= 3
  together   stick + look + FIRE held at once: moved > 0.5 m, turned > 0.05 rad, fired
  use        holding USE 2 s next to a chest opens it
  slots      a tap on HUD slot 2 makes it active; a tap on the minimap opens the big map
  lock       no requestPointerLock call in the whole touch session (__H_LOCKREQ__ == 0)
  portrait   turning the phone upright mid-match shows a rotate overlay
  errors     0 console / page errors
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import mobilekit as MK  # noqa: E402

CTL_JS = r"""() => {
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const R = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const out = {};
  for (const e of document.querySelectorAll('[data-touch-ui]')) if (vis(e)) out[e.getAttribute('data-touch-ui').toLowerCase()] = R(e);
  if (!Object.keys(out).length) {
    const root = document.getElementById('__ffg_touch__');
    if (root) for (const e of root.querySelectorAll('.ffgt-stick, .ffgt-btn, .ffgt-look')) { if (!vis(e)) continue;
      const cls = e.className || ''; const lab = (e.textContent || '').trim().toLowerCase();
      out[/stick/.test(cls) ? 'stick' : /look/.test(cls) ? 'look' : lab] = R(e); }
  }
  return out;
}"""

PLAYER_JS = r"""() => { const W = window.__LC__.W, p = W.player; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.input.yaw, pitch: p.input.pitch,
  mag: p.weapon ? p.weapon.magAmmo : null, wid: p.weapon ? p.weapon.id : null, shots: W.stats.shotsFired, active: p.inventory.active,
  alive: p.alive, onGround: p.onGround, chests: window.__H_MYCHEST__ || 0, lockReq: window.__H_LOCKREQ__ || 0, phase: W.phase,
  bigmap: [...document.querySelectorAll('canvas')].some((c) => { if (c === W.kernel.renderer.domElement) return false; const r = c.getBoundingClientRect();
    if (r.width < Math.min(300, innerHeight * 0.6)) return false; for (let n = c; n && n.nodeType === 1; n = n.parentElement) { const st = getComputedStyle(n);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false; } return true; }) }; }"""

SLOT_PREP_JS = r"""() => { const W = window.__LC__.W, p = W.player, sl = p.inventory.slots;
  const was = sl.map((x) => x ? (x.id || x.kind) : null);
  if (!sl[0]) sl[0] = { kind: 'weapon', id: 'pistol', rarity: 0, mag: 12 };
  if (!sl[1]) sl[1] = { kind: 'weapon', id: 'smg', rarity: 0, mag: 30 };
  if (W.equipSlot) W.equipSlot(p, 0); else p.inventory.active = 0;
  return { was, now: sl.map((x) => x ? (x.id || x.kind) : null), active: p.inventory.active }; }"""

SLOTS_JS = r"""() => {
  const own = (e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const am = [...document.querySelectorAll('div')].find((e) => /^(\d+|∞)\s*\/\s*(\d+|∞)$/.test(own(e)) && e.offsetParent !== null);
  let row = null;
  for (let n = am ? am.previousElementSibling : null; n; n = n.previousElementSibling) if (n.children.length >= 3) { row = n; break; }
  const slots = row ? [...row.children].map((c) => { const r = c.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }) : [];
  let mm = null;
  for (const c of document.querySelectorAll('canvas')) { if (c === window.__LC__.W.kernel.renderer.domElement) continue;
    const r = c.getBoundingClientRect(); if (r.width >= 60 && r.width <= 300 && r.height >= 60 && r.top < innerHeight * 0.5) { mm = [r.left, r.top, r.right, r.bottom]; break; } }
  return { slots, minimap: mm };
}"""

CHEST_JS = r"""() => { const W = window.__LC__.W, p = W.player;
  const near = W.nearbyLoot ? W.nearbyLoot(p.pos, 400) : [];
  const c = near.filter((n) => n.type === 'chest').sort((a, b) => a.d - b.d)[0];
  if (!c) return null;
  const cx = c.x != null ? c.x : (c.pos ? c.pos.x : null), cz = c.z != null ? c.z : (c.pos ? c.pos.z : null);
  if (cx == null) return { keys: Object.keys(c) };
  const y = W.map.heightAt(cx + 1.2, cz);
  p.pos.set(cx + 1.2, Math.max(y, c.y != null ? c.y : y), cz); p.vel && p.vel.set(0, 0, 0);
  p.input.yaw = Math.atan2(1.2, 0); return { d: c.d, id: c.id, x: cx, z: cz }; }"""

ROTATE_JS = r"""() => { const t = (document.body.innerText || ''); return { rotate: /rotate|turn your (phone|device)|landscape/i.test(t), sample: (t.match(/[^\n]*(rotate|landscape)[^\n]*/i) || [null])[0] }; }"""


def run_device(v, args, dev):
    spec = MK.DEVICES[dev]
    ctx_kw = {"device_scale_factor": spec["dpr"], "is_mobile": True, "has_touch": True, "user_agent": spec["ua"]}
    inits = ([MK.IOS_INIT] if spec.get("ios") else []) + [MK.PHONE_NO_LOCK]
    P = dev + ": "
    with C.Session(args, "mobile-" + dev, viewport={"width": spec["w"], "height": spec["h"]}, context_kw=ctx_kw, init_scripts=inits) as s:
        T = MK.Touch(s.cdp(), s.sleep)
        s.goto()
        t0 = time.time()
        while time.time() - t0 < args.boot_timeout:
            if s.js(MK.BTN_RECT_JS, "PLAY ANYWAY") or s.safe_js("() => !!window.__LC__"):
                break
            s.sleep(0.5)
        taps = {}
        for label in ("PLAY ANYWAY",):
            n = 0
            for _ in range(4):
                r = s.js(MK.BTN_RECT_JS, label)
                if not r:
                    break
                T.tap(*MK.center(r))
                n += 1
                s.sleep(2.0)
            if n:
                taps[label] = n
        if s.wait_lc() is None:
            v.cnj(P + "boot", "the menu never appeared")
            return
        s.sleep(1.5)
        ctl_menu = s.js(CTL_JS)
        for label in ("CONTINUE ANYWAY", "^GOT IT$"):
            n = 0
            for _ in range(3):
                r = s.js(MK.BTN_RECT_JS, label)
                if not r:
                    break
                if MK.inside(r, spec["w"], spec["h"]):
                    T.tap(*MK.center(r))
                n += 1
                s.sleep(1.2)
            if s.js(MK.BTN_RECT_JS, label):
                s.js("(re) => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && new RegExp(re).test(x.textContent.trim())); if (b) b.click(); }", label)
                v.note(P + "%s did not close on real taps; closed by a DOM click (setup only)" % label)
                n = 99
            if n:
                taps[label] = n
        v.check(P + "menus: no touch control drawn over the menu", not ctl_menu, ctl_menu)
        v.check(P + "menus: every blocking card closes on ONE real tap", all(n == 1 for n in taps.values()), taps or "no cards")
        # a match (setup), landed (setup)
        s.start_match("standard", 7, "isla_viva", enter=True)
        # W.stats.chests is never incremented in 7da063ad: count the player's own 'chestOpened' events instead
        s.js("() => { const W = window.__LC__.W; if (window.__H_MYCHEST_ON__) return; window.__H_MYCHEST_ON__ = true; window.__H_MYCHEST__ = 0;"
             " W.events.on('chestOpened', (a) => { if (a && a === W.player) window.__H_MYCHEST__++; }); }")
        s.land(120, protect=True)
        s.freeze_loop()
        s.install_pump()
        s.step_frames(30, 1 / 60, render=False)
        ctl = s.js(CTL_JS)
        v.info(P + "touch controls in the match", {k: [round(x) for x in r] for k, r in ctl.items()})
        rd = lambda: s.js(PLAYER_JS)  # noqa: E731
        if not rd()["alive"]:
            v.cnj(P + "touch checks", "the player died while landing (setup)")
            return
        W_, H_ = spec["w"], spec["h"]
        look = ctl.get("look")
        lx0, ly0 = (MK.center(look) if look else (W_ * 0.62, H_ * 0.35))
        if look:
            lx0, ly0 = look[0] + (look[2] - look[0]) * 0.3, look[1] + (look[3] - look[1]) * 0.35
        # FIRE: the first press after the menu
        fire = ctl.get("fire")
        if fire:
            s0 = rd()
            fx, fy = MK.center(fire)
            T.down(3, fx, fy)
            s.step_frames(6, 1 / 60, render=False)
            T.up(3)
            s.step_frames(12, 1 / 60, render=False)
            s1 = rd()
            v.check(P + "the first FIRE press after the menu drops the magazine", s0["mag"] is not None and s1["mag"] is not None and s1["mag"] < s0["mag"],
                    {"wid": s0["wid"], "mag": [s0["mag"], s1["mag"]], "shots": s1["shots"] - s0["shots"]})
        else:
            v.check(P + "the first FIRE press after the menu drops the magazine", False, "no FIRE control found (%s)" % list(ctl))
        # LOOK: 160 px drag
        s0 = rd()
        T.down(2, lx0, ly0)
        for k in range(1, 15):
            T.move(2, lx0 + 160 * k / 14, ly0 + 20 * k / 14)
            s.step_frames(1, 1 / 60, render=False)
        T.up(2)
        s.step_frames(5, 1 / 60, render=False)
        s1 = rd()
        dyaw = s1["yaw"] - s0["yaw"]
        v.check(P + "a 160 px LOOK drag turns the camera >= 0.3 rad", abs(dyaw) >= 0.3, {"dyaw": round(dyaw, 4), "lockRequests": s1["lockReq"]})
        # pistol FIRE held 2 s
        s.js("() => { const W = window.__LC__.W, p = W.player; const i = p.inventory.slots.findIndex((x) => x && x.id === 'pistol'); if (i >= 0 && W.equipSlot) W.equipSlot(p, i); p.inventory.ammo.light = Math.max(p.inventory.ammo.light || 0, 60); }")
        s.step_frames(40, 1 / 60, render=False)
        if fire:
            s0 = rd()
            T.down(3, *MK.center(fire))
            s.step_frames(120, 1 / 60, render=False)
            T.up(3)
            s.step_frames(5, 1 / 60, render=False)
            s1 = rd()
            v.check(P + "holding FIRE 2 s with the pistol fires >= 3 rounds", s0["wid"] == "pistol" and s1["shots"] - s0["shots"] >= 3,
                    {"wid": s0["wid"], "shots": s1["shots"] - s0["shots"]})
        # stick + look + FIRE together
        stick = ctl.get("stick")
        if stick and fire:
            s0 = rd()
            sx, sy = MK.center(stick)
            rad = (stick[2] - stick[0]) / 2
            T.down(1, sx, sy)
            T.move(1, sx, sy - rad * 0.85)
            T.down(2, lx0, ly0)
            T.down(3, *MK.center(fire))
            for k in range(1, 11):
                T.move(2, lx0 + 120 * k / 10, ly0)
                s.step_frames(3, 1 / 60, render=False)
            s.step_frames(30, 1 / 60, render=False)
            T.up(3)
            T.up(2)
            T.up(1)
            s.step_frames(3, 1 / 60, render=False)
            s1 = rd()
            moved = math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"])
            turned = abs(s1["yaw"] - s0["yaw"])
            v.check(P + "stick + look + FIRE held together all register", moved > 0.5 and turned > 0.05 and s1["shots"] > s0["shots"],
                    {"moved_m": round(moved, 2), "turned": round(turned, 3), "shots": s1["shots"] - s0["shots"]})
        else:
            v.check(P + "stick + look + FIRE held together all register", False, "stick/fire control missing (%s)" % list(ctl))
        # USE at a chest
        use = ctl.get("use") or ctl.get("loot") or ctl.get("e")
        ch = s.js(CHEST_JS)
        if not ch or "x" not in ch:
            v.cnj(P + "holding USE 2 s at a chest opens it", "no chest found near the player (setup) %s" % ch)
        elif not use:
            v.check(P + "holding USE 2 s at a chest opens it", False, "there is no USE control (%s)" % list(ctl))
        else:
            s.step_frames(10, 1 / 60, render=False)
            s0 = rd()
            T.down(4, *MK.center(use))
            s.step_frames(150, 1 / 60, render=False)
            T.up(4)
            s.step_frames(10, 1 / 60, render=False)
            s1 = rd()
            v.check(P + "holding USE 2 s at a chest opens it", (s1["chests"] or 0) > (s0["chests"] or 0), {"chests": [s0["chests"], s1["chests"]], "chest": ch})
        # slot 2 tap + minimap tap
        # SETUP (not judged): slot 2 must hold something to switch to and slot 1 must be the active one, or the tap proves
        # nothing (Wave-2 L7T: the pistol setup above had left index 1 active, so the old row read active [1, 1])
        prep = s.js(SLOT_PREP_JS)
        s.step_frames(30, 1 / 60, render=False)
        sl = s.js(SLOTS_JS)
        if len(sl["slots"]) >= 2:
            s0 = rd()
            if s0["active"] == 1:
                v.cnj(P + "a tap on HUD slot 2 makes it the active slot", "precondition: slot 2 was already active before the tap (%s)" % prep)
            else:
                T.tap(*MK.center(sl["slots"][1]))
                s.step_frames(10, 1 / 60, render=False)
                s1 = rd()
                v.check(P + "a tap on HUD slot 2 makes it the active slot", s1["active"] == 1,
                        {"active": [s0["active"], s1["active"]], "slot2": [round(x) for x in sl["slots"][1]], "setup": prep})
        else:
            v.cnj(P + "a tap on HUD slot 2 makes it the active slot", "HUD slots not found (%s)" % sl)
        if sl["minimap"]:
            s0 = rd()
            T.tap(*MK.center(sl["minimap"]))
            s.step_frames(10, 1 / 60, render=False)
            s1 = rd()
            v.check(P + "a tap on the minimap opens the big map", bool(s1["bigmap"]) and not s0["bigmap"], {"bigMapVisible": [s0["bigmap"], s1["bigmap"]], "minimap": [round(x) for x in sl["minimap"]]})
            if s1["bigmap"]:
                T.tap(*MK.center(sl["minimap"]))
        else:
            v.cnj(P + "a tap on the minimap opens the big map", "minimap canvas not found")
        # portrait
        s.page.set_viewport_size({"width": spec["h"], "height": spec["w"]})
        s.sleep(1.0)
        s.step_frames(10, 1 / 60, render=False)
        ro = s.js(ROTATE_JS)
        v.check(P + "portrait mid-match shows a rotate overlay", ro["rotate"], ro)
        s.page.set_viewport_size({"width": spec["w"], "height": spec["h"]})
        s.sleep(0.5)
        end = rd()
        v.check(P + "no pointer-lock request in the whole touch session", end["lockReq"] == 0, {"__H_LOCKREQ__": end["lockReq"]})
        d = s.diagnostics()
        real = d["consoleErrors"] + d["pageErrors"] + d["windowErrors"]
        if not real and d.get("envErrors"):
            v.cnj(P + "0 console / page errors", "only GPU-process errors (environment): %s" % d["envErrors"][:2])
        else:
            v.check(P + "0 console / page errors", not real, real[:4])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--devices", default="pixel7,iphone14,se,ipad")
    ap.set_defaults(gpu="swiftshader")
    args = ap.parse_args()

    def body(v):
        for dev in [d.strip() for d in args.devices.split(",") if d.strip()]:
            if dev not in MK.DEVICES:
                v.cnj(dev, "unknown device (known: %s)" % ", ".join(MK.DEVICES))
                continue
            print("\n--- device %s (%s)" % (dev, time.strftime("%H:%M:%S")), flush=True)
            try:
                run_device(v, args, dev)
            except C.EnvFailure as e:
                v.cnj(dev + ": environment", str(e))
    return C.run_gate("mobile", body, args)


if __name__ == "__main__":
    sys.exit(main())
