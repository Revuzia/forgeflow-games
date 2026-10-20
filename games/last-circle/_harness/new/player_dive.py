#!/usr/bin/env python
"""player_dive - the skydive / canopy body pose follows the actor's heading (lane PLAYER, wave 4).

Found while verifying P2.6: obj.rotation was three's default Euler order XYZ, so the dive's pitch tilt turned about the WORLD x axis.
The belly-down skydive was right only for a body facing -Z; at 90 / 270 deg it lay on its side and at 0 deg on its back (2026-10-12,
40 divers measured). player.js now uses order YXZ (yaw outermost) with the tilt signs flipped to keep the old look at the tuned heading.

A standard match is loaded and the kernel loop is frozen in the drop (stepped frames only). INDEPENDENT of the game's maths: the real
skeleton is read (Hips -> Head bone vector) and compared with the facing (sin b, cos b), b = obj.rotation.y.
  (1) every actor in FREEFALL (gliding, no canopy): the head is FORWARD of the hips along the facing (fwd >= 0.75) and not to the side
      (|side| <= 0.3): belly-down at every heading (bots dive at all headings).
  (2) the human at 4 headings (input yaw 0 / 90 / 180 / 270, 40 stepped frames each): the same, plus one side-view PNG per heading
      (--shots, default _harness/_shots/player_dive_yawNNN.png) and a contact sheet.
  (3) under the CANOPY (a real Space): every SETTLED canopy pilot = a canopy OPEN >= 1.0 s (the deploy time is read from the game's own
      'chuteDeployed' event; a canopy already open when the listener is installed, ~0.6 s into the drop, is stamped with the install
      time: a lower bound on its open time; the dive tilt eases out with a 0.25 s time constant, so 1 s leaves
      <= 0.03 rad of it) hangs upright (up >= 0.9) at every heading. (Stage C, lane C3: until then 'settled' was |tiltX| <= 0.3, which
      admitted a pilot 0.2-0.4 s after its deploy - stage-B bot s38 at tiltX 0.23, up 0.782 - and EXCLUDED every pilot of a build whose
      canopy never leaves the dive pose: the filter read the quantity under test.)
  --plant canopy-dive-pose (needs --disk): player.js served with the canopy branch keeping the dive tilt (wantTiltX 1.35): row (3) must
      FAIL (with the old tilt filter it read could-not-judge: 0 'settled' pilots).
  (4) 0 console / page / window errors, 0 failed requests, 0 shader errors, 0 [rig] lines.
Exit 0 pass / 1 fail / 2 could-not-judge.
    python _harness/new/player_dive.py --isolate
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402

MEASURE_JS = r"""() => {
  const W = window.__LC__.W; const V = W.camera.position.constructor;
  const h = new V(), hd = new V(), out = [];
  const bone = (a, re) => { let r = null; a.rig.scene.traverse((o) => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
  for (const a of W.actors) {
    if (!a.alive || !a.rig || !a.gliding) continue;
    const hips = bone(a, /Hips$/), head = bone(a, /Head$/);
    if (!hips || !head) continue;
    a.obj.updateMatrixWorld(true);
    hips.getWorldPosition(h); head.getWorldPosition(hd);
    const dx = hd.x - h.x, dy = hd.y - h.y, dz = hd.z - h.z, L = Math.hypot(dx, dy, dz) || 1;
    const b = a.obj.rotation.y, fx = Math.sin(b), fz = Math.cos(b), rx = -Math.cos(b), rz = Math.sin(b);
    const d = (window.__H_DEPLOY_T__ || {})[a.id];
    out.push({ id: a.id, human: a === W.player, chute: !!a.chute, openS: a.chute && d != null ? +(W.t - d).toFixed(3) : null, yawDeg: Math.round(((b * 180 / Math.PI) % 360 + 360) % 360), tiltX: +a._tiltX.toFixed(2),
               order: a.obj.rotation.order, up: +(dy / L).toFixed(3), fwd: +((dx * fx + dz * fz) / L).toFixed(3), side: +((dx * rx + dz * rz) / L).toFixed(3) });
  }
  return out;
}"""

# the deploy clock: W.t at each actor's latest 'chuteDeployed' (the game's own event), installed right after start_match + freeze_loop (W.t ~0.6 s:
# start_match's own frames already ran, and ~19 bots open at the plane door). A canopy already open at install is stamped with the install time:
# its measured open time is then a LOWER bound (it has been open at least that long), so it is admitted only when even the bound is >= SETTLE_S.
DEPLOY_JS = r"""() => { const W = window.__LC__.W; window.__H_DEPLOY_T__ = {};
  W.events.on('chuteDeployed', (a) => { window.__H_DEPLOY_T__[a.id] = W.t; });
  let pre = 0; for (const a of W.actors) if (a.chute) { window.__H_DEPLOY_T__[a.id] = W.t; pre++; }     // open since <= now: W.t now is a LOWER bound on its open time
  return { t: +W.t.toFixed(3), phase: W.phase, actors: W.actors.length, chutesAtInstall: pre }; }"""
SETTLE_S = 1.0
PLANTS = {"canopy-dive-pose": ("wantTiltX = -0.12 - Math.sin(W.t * 1.7) * 0.06;", "wantTiltX = 1.35; /* PLANT canopy-dive-pose: the pilot keeps the dive tilt */")}


def install_plant(s, args):
    """serve player.js patched (in memory, checked FIRST: ahead of --isolate's overlay) for the planted fault"""
    rel = "runtime/3d/royale/player.js"
    if args.rev and not args.isolate:
        b = s.disk.git.read(rel)
    else:
        with open(os.path.join(getattr(args, "overlay_root", None) or C.ROOT, rel.replace("/", os.sep)), "rb") as fh:
            b = fh.read()
    src = b.decode("utf-8")
    anchor, repl = PLANTS[args.plant]
    if src.count(anchor) != 1:
        raise C.EnvFailure("plant %s: anchor %r found %d times in %s" % (args.plant, anchor, src.count(anchor), rel))
    body = src.replace(anchor, repl).encode("utf-8")
    s.disk.overrides.insert(0, (lambda url: urllib.parse.urlparse(url).path.endswith("/" + rel),
                                lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
    return "player.js served with %s" % repl


SIDE_SHOT_JS = """const W = window.__LC__.W, p = W.player, cam = W.camera, o = p.obj.position, b = p.obj.rotation.y;
  cam.position.set(o.x + Math.cos(b) * 7, o.y + 1.5, o.z - Math.sin(b) * 7); cam.lookAt(o.x, o.y + 0.4, o.z); cam.updateMatrixWorld(true);
  W.kernel.composer ? W.kernel.composer.render(0.016) : W.kernel.renderer.render(W.kernel.scene, cam)"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    PL.add_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--map", default="isla_viva", choices=C.MAPS)
    ap.add_argument("--shots", default=None)
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS), help="negative control (exit 1 expected)")
    args = ap.parse_args()
    if args.plant and not args.report:
        args.report = "player_dive_plant_" + args.plant.replace("-", "_")
    PL.prepare(args)

    def body(v):
        shots = args.shots or C.SHOTS
        os.makedirs(shots, exist_ok=True)
        with C.Session(args, "player_dive") as s:
            PL.overlay(s, args)
            PL.served_note(v, args)
            if args.plant:
                if not (args.disk or args.rev or args.isolate):
                    raise C.EnvFailure("--plant needs --disk / --rev / --isolate (it patches the served player.js)")
                v.info("plant", install_plant(s, args))
            s.boot()
            s.start_match("standard", args.seed, args.map)
            s.freeze_loop()
            v.info("deploy clock installed", s.js(DEPLOY_JS))
            s.step_frames(45, 1 / 60, render=False)
            fall = [r for r in s.js(MEASURE_JS) if not r["chute"] and abs(r["tiltX"]) > 0.9]
            v.info("freefall divers", {"n": len(fall), "rows": fall[:50]})
            if len(fall) < 10:
                v.cnj("(1) every freefall diver is belly-down along its heading", "only %d settled freefall divers" % len(fall))
            else:
                bad = [r for r in fall if not (r["fwd"] >= 0.75 and abs(r["side"]) <= 0.3)]
                yaws = sorted({(r["yawDeg"] // 45) * 45 for r in fall})
                v.check("(1) every freefall diver (%d, headings in %d of 8 octants) is belly-down along its heading: head forward >= 0.75, side <= 0.3"
                        % (len(fall), len(yaws)), not bad, {"bad": bad[:8], "octants": yaws,
                                                           "fwdMin": min(r["fwd"] for r in fall), "sideMaxAbs": max(abs(r["side"]) for r in fall)})
            rows = {}
            pngs = []
            for yaw in (0, 90, 180, 270):
                s.js("(y) => { const p = window.__LC__.W.player; p.input.yaw = y * Math.PI / 180; p.yaw = p.input.yaw; }", yaw)
                s.step_frames(40, 1 / 60, render=False)
                pth = os.path.join(shots, "player_dive_yaw%03d.png" % yaw)
                s.canvas_png(pth, SIDE_SHOT_JS)
                pngs.append((yaw, pth))
                r = [x for x in s.js(MEASURE_JS) if x["human"]]
                rows[yaw] = r[0] if r else None
            v.info("human at 4 headings", rows)
            good = all(r and not r["chute"] and r["fwd"] >= 0.75 and abs(r["side"]) <= 0.3 for r in rows.values())
            if any(r is None for r in rows.values()):
                v.cnj("(2) the human dives belly-down at 0 / 90 / 180 / 270 deg", "the human left freefall during the sweep")
            else:
                v.check("(2) the human dives belly-down at input yaw 0 / 90 / 180 / 270 deg (head forward >= 0.75, side <= 0.3)", good, rows)
            try:
                from PIL import Image, ImageDraw
                ims = [Image.open(p).crop((340, 110, 940, 610)) for _, p in pngs]
                sheet = Image.new("RGB", (sum(i.width for i in ims), ims[0].height + 30), (0, 0, 0))
                d = ImageDraw.Draw(sheet)
                x = 0
                for (yaw, _), im in zip(pngs, ims):
                    sheet.paste(im, (x, 30))
                    d.text((x + 10, 8), "input yaw %d - seen from its left side" % yaw, fill=(255, 255, 255))
                    x += im.width
                sp = os.path.join(shots, "player_dive_sheet.png")
                sheet.resize((sheet.width // 2, sheet.height // 2)).save(sp)
                v.info("sheet", sp)
            except Exception as e:  # PIL missing: the per-heading PNGs are still there
                v.info("sheet", "not made: %s" % e)
            v.info("deploy clock before Space", s.js("() => { const W = window.__LC__.W, d = window.__H_DEPLOY_T__ || {}; return { t: +W.t.toFixed(3), seen: Object.keys(d).length, chutes: W.actors.filter((a) => a.chute).length, unseen: W.actors.filter((a) => a.chute && !(a.id in d)).map((a) => a.id).slice(0, 12) }; }"))
            s.page.keyboard.press("Space")
            s.step_frames(90, 1 / 60, render=False)
            allc = [r for r in s.js(MEASURE_JS) if r["chute"]]
            # settled pilots only = canopy open >= SETTLE_S (the tilt eases from the dive (+1.35) to the harness sway (~-0.12) with a 0.25 s time constant)
            can = [r for r in allc if r["openS"] is not None and r["openS"] >= SETTLE_S]
            v.info("canopy pilots", {"all": len(allc), "settled (open >= %.1f s)" % SETTLE_S: len(can), "deploy not seen": sum(1 for r in allc if r["openS"] is None),
                                     "opening (< %.1f s)" % SETTLE_S: [r for r in allc if r["openS"] is not None and r["openS"] < SETTLE_S][:8], "rows": allc[:30]})
            if not can:
                v.cnj("(3) every canopy pilot hangs upright", "no canopy deployed")
            else:
                v.check("(3) every canopy pilot (%d) hangs upright (hips->head . up >= 0.9)" % len(can), all(r["up"] >= 0.9 for r in can),
                        {"minUp": min(r["up"] for r in can), "bad": [r for r in can if r["up"] < 0.9][:6]})
            dg = s.diagnostics()
            C.print_diagnostics(dg)
            v.check("0 console errors", not dg["consoleErrors"], dg["consoleErrors"][:5])
            v.check("0 page / window errors", not (dg["pageErrors"] or dg["windowErrors"]), (dg["pageErrors"] + dg["windowErrors"])[:5])
            v.check("0 failed requests", not dg["failedRequests"], dg["failedRequests"][:8])
            v.check("0 shader errors, 0 [rig] lines", not dg["shader"] and not dg["rigWarnings"], (dg["shader"] + dg["rigWarnings"])[:4])
    return C.run_gate("player_dive", body, args)


if __name__ == "__main__":
    sys.exit(main())
