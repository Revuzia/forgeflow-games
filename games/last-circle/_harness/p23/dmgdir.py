#!/usr/bin/env python
"""dmgdir - the damage-direction indicator (owner 2026-11-22: "if you get shot you can see where you are getting shot from").

    python _harness/p23/dmgdir.py --disk
    python _harness/p23/dmgdir.py --disk --plant dmgdir-mirror          # left / right swapped - MUST FAIL
    python _harness/p23/dmgdir.py --disk --plant dmgdir-tied-to-sound   # hidden while the sound indicators are off - MUST FAIL
    python _harness/p23/dmgdir.py --disk --no-touch                     # desktop only

STANDARD match (seed 7), landed under the harness guard, loop frozen, frames stepped with render. A scripted attacker (the nearest
bot, pinned 20 m away) hurts the player through the real damage path (W.hurtActor -> actorHurt). The arc's SCREEN angle is read
from the drawn arc (the bounding box of its stroke, around the reticle's centre), the truth from the attacker's offset from the
player on the CAMERA's horizontal axes (camera matrix, not p.yaw) - both independent of the HUD's own yaw maths. Rows:
  contract        [data-lc=dmgdir] with pooled arcs; W.settings.dmgDir defaults ON
  bearing-*       attacker front / right / behind / left: ONE arc within ONE frame, at the true angle +-10 deg, centred on the reticle
  turn            a 90 deg camera turn: the arc follows (true angle +-10 deg, moved 90 +-10)
  fade            peak through 0.3 s, part-faded at 1.0 s, gone by 1.6 s (spec: hold 0.5 s + fade 1.0 s)
  damage-scale    a 45-damage hit draws a wider and brighter arc than an 8-damage hit
  shield-health   shield hit = blue + segmented; health hit = palette damage colour + solid
  two-attackers   two attackers (right, left) in one frame = two arcs at both angles
  sound-off       W.settings.soundVis = false: the arc still shows
  dmgdir-off      W.settings.dmgDir = false: no arc, and a live arc is cleared
  cb-palette      daltonize deutan: the health arc takes CB_PAL.deutan.dmg
  flash-reduce    flashReduce: the onset is capped (<= 0.75 opacity)
  no-old-glyph    the sound ring draws no damage glyph any more
  touch: bearing-right / bearing-behind on a phone (pixel7 landscape, real touch context)
  errors
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C
sys.path.insert(0, L.HARNESS)
import mobilekit as MK  # noqa: E402

HUD = "runtime/3d/royale/hud.js"
PLANTS = {
    # the arc's screen angle mirrored: right shows left
    "dmgdir-mirror": [(HUD, [("    const rel = p.yaw + Math.PI - Math.atan2(d.x - p.pos.x, d.z - p.pos.z);\n",
                               "    const rel = Math.atan2(d.x - p.pos.x, d.z - p.pos.z) - p.yaw + Math.PI;\n")])],
    # the arc switched off together with the sound indicators
    "dmgdir-tied-to-sound": [(HUD, [("  const off = (W.settings && W.settings.dmgDir === false) || !p || !p.alive;\n",
                                      "  const off = (W.settings && (W.settings.dmgDir === false || W.settings.soundVis === false)) || !p || !p.alive;\n")])],
}

TOL = 10.0
DT = 1 / 60

# place the attacker `dist` m from the player at `bearing` deg clockwise from the CAMERA's horizontal facing, pin it there
PLACE_JS = r"""([id, bearing, dist]) => {
  const W = window.__LC__.W, p = W.player, cam = W.camera, a = W.actorById.get(id);
  cam.updateMatrixWorld(); const f = new p.pos.constructor(); cam.getWorldDirection(f); f.y = 0; f.normalize();
  const rx = -f.z, rz = f.x, b = bearing * Math.PI / 180;
  const x = p.pos.x + dist * (Math.cos(b) * f.x + Math.sin(b) * rx), z = p.pos.z + dist * (Math.cos(b) * f.z + Math.sin(b) * rz);
  const y = W.map.heightAt(x, z);
  window.__P23PIN__ = window.__P23PIN__ || {}; window.__P23PIN__[id] = [x, y, z];
  a.pos.set(x, y, z); return [x, y, z]; }"""

HURT_JS = r"""([id, dmg, shield]) => { const W = window.__LC__.W, p = W.player; p.hp = 100; p.shield = shield; W.hurtActor(p, dmg, id, 'ar', false); return true; }"""

# the arcs as drawn + the truth: the attacker's angle in camera space (0 = ahead, clockwise)
ARCS_JS = r"""(ids) => {
  const W = window.__LC__.W, cam = W.camera; cam.updateMatrixWorld();
  const ret = document.querySelector('[data-lc="reticle"]').getBoundingClientRect(), rx = ret.left + ret.width / 2, ry = ret.top + ret.height / 2;
  const box = document.querySelector('[data-lc="dmgdir"]');
  const arcs = [...box.querySelectorAll('svg')].filter((e) => e.style.display !== 'none').map((e) => {
    const mn = e.lastChild, r = mn.getBoundingClientRect(), sb = e.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let deg = Math.atan2(cx - rx, -(cy - ry)) * 180 / Math.PI; if (deg < 0) deg += 360;
    return { src: e.dataset.src, kind: e.dataset.kind, w: +e.dataset.w, deg: +deg.toFixed(1), op: +(e.style.opacity || 0),
             stroke: mn.getAttribute('stroke'), dash: mn.getAttribute('stroke-dasharray'), sw: +mn.getAttribute('stroke-width'),
             off: +Math.hypot(sb.left + sb.width / 2 - rx, sb.top + sb.height / 2 - ry).toFixed(1), rad: +Math.hypot(cx - rx, cy - ry).toFixed(1) }; });
  const truth = {};
  // the attacker's direction FROM THE PLAYER in the camera's horizontal frame (the third-person camera sits ~4 m behind the player, so
  // the camera-origin angle compresses side bearings; the cue is about where the shot comes from relative to YOU, on the screen's axes)
  const f = new W.player.pos.constructor(); cam.getWorldDirection(f); f.y = 0; f.normalize();
  for (const id of ids) { const a = W.actorById.get(id); if (!a) continue; const dx = a.pos.x - W.player.pos.x, dz = a.pos.z - W.player.pos.z;
    const right = dx * -f.z + dz * f.x, fwd = dx * f.x + dz * f.z;
    let d = Math.atan2(right, fwd) * 180 / Math.PI; if (d < 0) d += 360; truth[id] = +d.toFixed(1); }
  const old = [...document.querySelectorAll('[data-lc="indicators"] div')].filter((e) => e.style.display !== 'none' && /❮/.test(e.textContent)).length;
  return { arcs, truth, oldGlyph: old, settings: { dmgDir: W.settings.dmgDir, soundVis: W.settings.soundVis } }; }"""


def cdiff(a, b):
    d = abs((a - b) % 360)
    return min(d, 360 - d)


def setup(s, args, touch=False):
    if touch:
        s.goto()
        for _ in range(240):
            s.js("() => { for (const re of [/^\\s*PLAY ANYWAY\\s*$/i, /^\\s*CONTINUE ANYWAY\\s*$/i]) { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && re.test(x.textContent)); if (b) b.click(); } return true; }")
            if s.safe_js("() => !!window.__LC__", default=False):
                break
            s.sleep(0.5)
        s.wait_lc()
        s.sleep(1.5)
        for _ in range(4):
            s.js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^\\s*(GOT IT|CONTINUE ANYWAY)\\s*$/i.test(x.textContent)); if (b) b.click(); return true; }")
            s.sleep(0.6)
    else:
        s.boot()
        s.sleep(1.0)
        s.js("() => { try { localStorage.setItem('lc_seen_intro', '1'); } catch (e) {} }")
        L.dismiss_cards(s)
    start = s.start_match("standard", args.seed, args.map, enter=True, guard=True)
    s.freeze_loop()
    s.install_pump()
    s.land(150, protect=True)
    s.step_frames(30, DT, render=True)
    # the attacker: the nearest live bot; every other bot is parked 600 m away so no stray hit draws an arc
    ids = s.js("""() => { const W = window.__LC__.W, p = W.player; const bots = W.actors.filter((a) => a !== p && a.alive)
        .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos)); return bots.slice(0, 2).map((a) => a.id); }""")
    s.js("""(keep) => { const W = window.__LC__.W, p = W.player; window.__P23PIN__ = window.__P23PIN__ || {}; let k = 0;
        for (const a of W.actors) { if (a === p || !a.alive || keep.includes(a.id)) continue; const ang = (k++) * 0.13, x = p.pos.x + Math.cos(ang) * 600, z = p.pos.z + Math.sin(ang) * 600;
          window.__P23PIN__[a.id] = [x, W.map.heightAt(x, z), z]; } return true; }""", ids)
    L.pin_actor(s, ids[0], None)          # installs the pin updater (the map above is what it holds)
    s.js("() => { const p = window.__LC__.W.player; p.input.pitch = 0; return true; }")
    s.step_frames(5, DT, render=True)
    return start, ids


def expire(s):
    s.step_frames(100, DT, render=True)


def hit(s, aid, bearing, dmg=20, shield=0, dist=20):
    s.js(PLACE_JS, [aid, bearing, dist])
    s.step_frames(2, DT, render=True)
    s.js(HURT_JS, [aid, dmg, shield])
    s.step_frames(1, DT, render=True)


def arc_of(view, aid):
    xs = [a for a in view["arcs"] if a["src"] == str(aid)]
    return xs[0] if len(xs) == 1 else None


def bearing_rows(v, s, ids, P, shots, tag, shot_for=()):
    aid = ids[0]
    for name, b in (("front", 0), ("right", 90), ("behind", 180), ("left", 270)):
        hit(s, aid, b)
        vw = s.js(ARCS_JS, [aid])
        a = arc_of(vw, aid)
        tr = vw["truth"].get(str(aid), vw["truth"].get(aid))
        ok = a is not None and tr is not None and cdiff(a["deg"], tr) <= TOL and a["off"] <= 3 and len(vw["arcs"]) == 1
        v.check(P + "bearing-%s (ONE arc within one frame at the attacker's true angle +-%d deg, centred on the reticle)" % (name, TOL), ok,
                {"arc": a, "truth": tr, "arcs": len(vw["arcs"])}, "|arc - truth| <= %d" % TOL)
        if name in shot_for:
            s.step_frames(5, DT, render=True)
            s.screenshot(os.path.join(shots, "dmgdir_%s_%s.png" % (tag, name)))
        expire(s)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-touch", action="store_true")
    args = L.parse(ap)
    shots = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(shots, exist_ok=True)
    tag = "rev_" + args.rev if args.rev else ("plant_" + args.plant if args.plant else "disk")

    def plant(s):
        if args.plant:
            v_n = 0
            for rel, edits in PLANTS[args.plant]:
                v_n += L.serve_patched(s, rel, edits)
            return v_n
        return 0

    def body(v):
        with C.Session(args, "p23_dmgdir", viewport={"width": 1280, "height": 720}) as s:
            v.data["plant_edits"] = plant(s)
            v.data["start"], ids = setup(s, args)
            aid, aid2 = ids[0], ids[1]
            have = s.js("() => { const b = document.querySelector('[data-lc=\"dmgdir\"]'); return { pool: b ? b.querySelectorAll('svg').length : 0, def: window.__LC__.W.settings.dmgDir }; }")
            v.check("contract ([data-lc=dmgdir] pooled arcs; W.settings.dmgDir defaults ON)", have["pool"] >= 4 and have["def"] is True, have, "pool >= 4, default true")
            # the SOUND ring (gunfire cue) must sit on the same side as the shooter (it was mirrored until 2026-11-22)
            side = {}
            for name, b in (("right", 90), ("left", 270)):
                s.js(PLACE_JS, [aid, b, 20])
                s.step_frames(2, DT, render=True)
                truth = s.js(ARCS_JS, [aid])["truth"]
                tr = truth.get(str(aid), truth.get(aid))
                s.js("""(aid) => { const W = window.__LC__.W, a = W.actorById.get(aid); W.settings.soundVis = true;
                    const P = W.player; window.__P23RS__ = { alive: P.alive, sv: W.settings.soundVis, d: Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z) };
                    W.events.emit('shotFired', a, (a.weapon && a.weapon.id) || 'ar', { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z }, { x: W.player.pos.x - a.pos.x, y: 0, z: W.player.pos.z - a.pos.z }); return true; }""", aid)
                s.step_frames(2, DT, render=True)
                g = s.js("""() => { const L = document.querySelector('[data-lc=indicators]'); if (!L) return null;
                    const cx = innerWidth / 2, cy = innerHeight / 2;
                    const els = [...L.children].filter((e) => e.style.display !== 'none' && /︿/.test(e.textContent));
                    return { n: els.length, all: els.map((e) => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
                      return { op: +e.style.opacity, deg: Math.round(((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360) }; }) }; }""")
                fresh = max(g["all"], key=lambda c: c["op"]) if g and g.get("all") else None   # the cue this shot drew = the brightest (older cues are fading)
                ok = fresh is not None and tr is not None and cdiff(fresh["deg"], tr) <= 25
                side[name] = {"cue": g, "truth": tr, "state": s.js("() => window.__P23RS__")}
                v.check("sound-ring-side-%s (a gunshot on the %s draws its ring cue on the %s, +-25 deg)" % (name, name, name), ok, side[name], "|cue - truth| <= 25")
                expire(s)
            if have["pool"] < 1:
                L.errors_row(v, s)
                return
            bearing_rows(v, s, ids, "", shots, "desk_" + tag, shot_for=("right", "behind"))

            # turn: hit from the front, then turn the camera 90 deg right
            hit(s, aid, 0)
            a0 = arc_of(s.js(ARCS_JS, [aid]), aid)
            s.js("() => { const p = window.__LC__.W.player; p.input.yaw -= Math.PI / 2; p.yaw = p.input.yaw; return [p.yaw]; }")
            s.step_frames(6, DT, render=True)
            vw = s.js(ARCS_JS, [aid])
            a1 = arc_of(vw, aid)
            tr = vw["truth"].get(str(aid))
            ok = a0 is not None and a1 is not None and tr is not None and cdiff(a1["deg"], tr) <= TOL and abs(cdiff(a1["deg"], a0["deg"]) - 90) <= TOL
            v.check("turn (a 90 deg camera turn: the arc follows the attacker's last known position)", ok, {"before": a0, "after": a1, "truth": tr}, "true angle +-10, moved 90 +-10")
            expire(s)

            # fade
            hit(s, aid, 90)
            ops = {}
            for t_s, n in ((0.3, 17), (1.0, 42), (1.6, 36)):
                s.step_frames(n, DT, render=True)
                a = arc_of(s.js(ARCS_JS, [aid]), aid)
                ops[t_s] = a["op"] if a else 0.0
            ok = ops[0.3] >= 0.6 and 0.05 <= ops[1.0] <= ops[0.3] * 0.8 and ops[1.6] == 0.0
            v.check("fade (peak through 0.3 s, part-faded at 1.0 s, gone by 1.6 s)", ok, ops, "op(0.3) >= 0.6, 0.05 <= op(1.0) <= 0.8 op(0.3), op(1.6) 0")
            expire(s)

            # damage scale
            got = {}
            for dmg in (8, 45):
                hit(s, aid, 90, dmg=dmg)
                s.step_frames(17, DT, render=True)
                got[dmg] = arc_of(s.js(ARCS_JS, [aid]), aid)
                expire(s)
            ok = got[8] and got[45] and got[45]["w"] > got[8]["w"] and got[45]["op"] > got[8]["op"] and got[45]["sw"] > got[8]["sw"]
            v.check("damage-scale (45 damage: wider, thicker and brighter than 8)", bool(ok), got, "w, stroke and opacity grow")

            # shield vs health
            hit(s, aid, 90, dmg=20, shield=100)
            sh = arc_of(s.js(ARCS_JS, [aid]), aid)
            expire(s)
            hit(s, aid, 90, dmg=20, shield=0)
            hp = arc_of(s.js(ARCS_JS, [aid]), aid)
            expire(s)
            ok = sh and hp and sh["kind"] == "shield" and hp["kind"] == "health" and sh["stroke"] != hp["stroke"] and sh["dash"] and not hp["dash"]
            v.check("shield-health (shield = blue + segmented, health = damage colour + solid)", bool(ok), {"shield": sh, "health": hp}, "kinds differ in colour AND dash")

            # two attackers in one frame
            s.js(PLACE_JS, [aid, 90, 20])
            s.js(PLACE_JS, [aid2, 270, 20])
            s.step_frames(2, DT, render=True)
            s.js("([a, b]) => { const W = window.__LC__.W, p = W.player; p.hp = 100; p.shield = 0; W.hurtActor(p, 15, a, 'ar', false); p.hp = 100; W.hurtActor(p, 15, b, 'ar', false); return true; }", [aid, aid2])
            s.step_frames(1, DT, render=True)
            vw = s.js(ARCS_JS, [aid, aid2])
            a, b2 = arc_of(vw, aid), arc_of(vw, aid2)
            ok = a and b2 and cdiff(a["deg"], vw["truth"][str(aid)]) <= TOL and cdiff(b2["deg"], vw["truth"][str(aid2)]) <= TOL
            v.check("two-attackers (one arc each, both at their true angles)", bool(ok), {"a": a, "b": b2, "truth": vw["truth"]}, "two arcs +-10")
            expire(s)

            # independent of the sound indicators
            s.js("() => { window.__LC__.W.settings.soundVis = false; return true; }")
            hit(s, aid, 180)
            s.step_frames(2, DT, render=True)
            a = arc_of(s.js(ARCS_JS, [aid]), aid)
            v.check("sound-off (sound indicators OFF: the damage arc still shows)", a is not None and a["op"] > 0.3, {"arc": a}, "arc shown")
            s.js("() => { window.__LC__.W.settings.soundVis = true; return true; }")
            expire(s)

            # its own switch
            hit(s, aid, 90)
            live = arc_of(s.js(ARCS_JS, [aid]), aid)
            s.js("() => { window.__LC__.W.settings.dmgDir = false; return true; }")
            s.step_frames(1, DT, render=True)
            cleared = s.js(ARCS_JS, [aid])["arcs"]
            hit(s, aid, 270)
            after = s.js(ARCS_JS, [aid])["arcs"]
            s.js("() => { window.__LC__.W.settings.dmgDir = true; return true; }")
            v.check("dmgdir-off (Damage direction OFF: a live arc clears, a new hit draws none)", live is not None and not cleared and not after,
                    {"live": live, "cleared": cleared, "after": after}, "none")
            expire(s)

            # colour-blind palette + flash reduction
            s.js("() => { const S = window.__LC__.W.settings; S.gfx = Object.assign({}, S.gfx || {}, { daltonize: 'deutan' }); S.flashReduce = true; return true; }")
            hit(s, aid, 90)
            a = arc_of(s.js(ARCS_JS, [aid]), aid)
            v.check("cb-palette (deutan: the health arc is CB_PAL.deutan.dmg #ff9f1c)", a is not None and (a["stroke"] or "").lower() == "#ff9f1c", {"arc": a}, "#ff9f1c")
            v.check("flash-reduce (Reduce flashes: onset capped <= 0.75)", a is not None and a["op"] <= 0.75, {"arc": a}, "op <= 0.75")
            s.js("() => { const S = window.__LC__.W.settings; S.gfx = Object.assign({}, S.gfx || {}, { daltonize: 'off' }); S.flashReduce = false; return true; }")
            vw = s.js(ARCS_JS, [aid])
            v.check("no-old-glyph (the sound ring draws no damage glyph)", vw["oldGlyph"] == 0, {"oldGlyph": vw["oldGlyph"]}, "0")
            expire(s)

            L.errors_row(v, s)

        if args.no_touch:
            return
        spec = MK.DEVICES["pixel7"]
        ctx_kw = {"device_scale_factor": spec["dpr"], "is_mobile": True, "has_touch": True, "user_agent": spec["ua"]}
        with C.Session(args, "p23_dmgdir_touch", viewport={"width": spec["w"], "height": spec["h"]}, context_kw=ctx_kw, init_scripts=[MK.PHONE_NO_LOCK]) as s:
            plant(s)
            _, ids = setup(s, args, touch=True)
            tm = s.safe_js("() => !!document.querySelector('.lc-touch, [data-lc=\"touchpad\"], [data-lc=\"fire\"]') || window.matchMedia('(pointer: coarse)').matches", default=None)
            v.data["touch_mode"] = tm
            bearing_rows(v, s, ids, "touch: ", shots, "touch_" + tag, shot_for=("right", "behind"))
            L.errors_row(v, s, "touch: 0 page errors / console errors / failed requests")
    return C.run_gate("p23_dmgdir", body, args)


if __name__ == "__main__":
    sys.exit(main())
