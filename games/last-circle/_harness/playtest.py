#!/usr/bin/env python
"""playtest - a real-input solo session: camera, look, gunshots, the post-match loop (harness-gates G3).

    python _harness/playtest.py
    python _harness/playtest.py --disk --clicks 8

Every acceptance action is REAL input (page.mouse / page.keyboard); __LC__ is used for setup (skipping to a match end)
and observation. View frames are STEPPED (common.step_frames) so nothing depends on the box's starved rAF.

  camera drift   PRACTICE (one human, no storm - nobody can kill the subject; precondition W.player.alive and
                 phase 'match'): the REAL cursor parked hard off-centre (95 % x, 10 % y), then 90 stepped frames with
                 NO input, pointer UNLOCKED and then LOCKED: |d yaw| and |d pitch| of the camera < 0.05 deg
                 (the removed 5adf16f4 block turned ~3.2 rad/s here)
  look           a real locked mouse move of +200 px -> input.yaw changes by -200 x settings.sensitivity x 0.0022
                 (player.js mousemove), within 2 %
  gunshots       N real LMB clicks with the pistol (semi-auto): shots >= N - 1 (the first click after a deliberate
                 release is swallowed by design); every AudioBufferSourceNode.start() made while an own 'shotFired' is
                 dispatched holds EXACTLY ONE report in its PLAYED window (onsets >= 40 ms apart over 35 % of the
                 file peak - the 7-reports-per-shot bug, c663ddf3); AudioContext 'running'
  loop           a QUICK match skipped to its end (setup), the post-match panel, a REAL click on PLAY AGAIN -> the next
                 lobby -> REAL Enter -> frames; skipped to its end, REAL click on MAIN MENU -> the menu
  errors         0 console errors, 0 page / window errors, 0 failed requests, 0 shader errors across the whole run
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

CAM_JS = r"""() => { const W = window.__LC__.W, c = W.camera; c.updateMatrixWorld(true);
  const e = new W.THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
  const p = W.player;
  return { yaw: e.y, pitch: e.x, inYaw: p ? p.input.yaw : null, inPitch: p ? p.input.pitch : null, alive: !!(p && p.alive), phase: W.phase,
           lock: !!document.pointerLockElement, ndc: W.mouseNDC || null, t: W.t }; }"""

AUD_JS = r"""(since) => {
  const rows = [];
  const list = window.__H_AUD__ || [];
  for (let i = since; i < list.length; i++) {
    const r = list[i]; const b = r.buf;
    if (!b || b.duration < 0.05) { rows.push({ i, tag: r.tag, own: !!(r.tagArgs && r.tagArgs.own), skip: 'short' }); continue; }
    const d = b.getChannelData(0), sr = b.sampleRate, n = d.length;
    let peak = 0; for (let k = 0; k < n; k++) { const x = Math.abs(d[k]); if (x > peak) peak = x; }
    const count = (i0, i1) => { let c = 0, last = -1e9; const gap = Math.floor(sr * 0.04);
      for (let k = i0; k < i1; k++) { if (Math.abs(d[k]) > peak * 0.35 && k - last >= gap) { c++; last = k; } } return c; };
    const i0 = Math.floor((r.off || 0) * sr), i1 = r.dur != null ? Math.min(n, i0 + Math.floor(r.dur * sr)) : n;
    rows.push({ i, tag: r.tag, own: !!(r.tagArgs && r.tagArgs.own), weapon: r.tagArgs && r.tagArgs.a2, fileDur: +b.duration.toFixed(3),
                off: +(r.off || 0).toFixed(3), dur: r.dur == null ? null : +r.dur.toFixed(3), inFile: peak > 0 ? count(0, n) : 0, played: peak > 0 ? count(i0, i1) : 0 });
  }
  return rows;
}"""

BTN_JS = r"""(re) => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && new RegExp(re, 'i').test(x.textContent || ''));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent.trim().slice(0, 30) }; }"""

CARD_JS = r"""(want) => { const c = [...document.querySelectorAll('.lc-mode-card')].find((x) => x.offsetParent && new RegExp(want, 'i').test(x.textContent || ''));
  if (!c) return null; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }"""


def deg(x):
    return math.degrees(x)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--clicks", type=int, default=6)
    ap.add_argument("--no-loop", action="store_true", help="skip the post-match PLAY AGAIN / MAIN MENU loop")
    args = ap.parse_args()

    def body(v):
        with C.Session(args, "playtest") as s:
            s.boot()
            s.sleep(1.0)
            for _ in range(3):
                b = s.js(BTN_JS, "^\\s*GOT IT\\s*$")
                if not b:
                    break
                s.page.mouse.click(b["x"], b["y"])
                s.sleep(0.5)
            card = s.js(CARD_JS, "PRACTICE")
            if not card:
                v.check("menu shows the PRACTICE card", False, "no card")
                return
            s.stage("load")
            s.page.mouse.click(card["x"], card["y"])
            if s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25) is None:
                v.check("PRACTICE card -> lobby", False, s.phase())
                return
            s.sleep(0.3)
            s.page.keyboard.press("Enter")
            if s.wait_js("() => window.__LC__.W.phase === 'match'", 20, 0.1) is None:
                v.check("real Enter -> practice match", False, s.phase())
                return
            s.stage("practice")
            s.freeze_loop()
            s.install_pump()
            s.step_frames(30, 1 / 60, render=False)
            # ---------- camera drift, UNLOCKED, cursor parked off-centre ----------
            W_, H_ = args.width, args.height
            s.page.mouse.move(W_ * 0.95, H_ * 0.10, steps=4)
            s.step_frames(2, 1 / 60, render=False)
            a = s.js(CAM_JS)
            if not (a["alive"] and a["phase"] == "match"):
                v.cnj("camera drift (unlocked)", "precondition: player alive in phase match (got %s)" % a)
            else:
                s.step_frames(90, 1 / 60, render=False)
                b = s.js(CAM_JS)
                dy, dp = abs(deg(C.angle_delta(a["yaw"], b["yaw"]))), abs(deg(b["pitch"] - a["pitch"]))
                v.check("camera drift < 0.05 deg over 90 frames, cursor parked off-centre, pointer UNLOCKED", dy < 0.05 and dp < 0.05 and not b["lock"],
                        {"dYawDeg": round(dy, 4), "dPitchDeg": round(dp, 4), "ndc": b["ndc"], "locked": b["lock"]})
            # ---------- lock by a real click, then drift LOCKED ----------
            cv = s.js("() => { const c = window.__LC__.W.kernel.renderer.domElement; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
            s.page.mouse.click(cv["x"], cv["y"])
            s.wait_js("() => !!document.pointerLockElement", 3, 0.1)
            s.step_frames(20, 1 / 60, render=False)
            a = s.js(CAM_JS)
            if not a["lock"]:
                v.cnj("camera drift (locked) + look", "pointer lock was not granted to a real canvas click")
            else:
                s.step_frames(90, 1 / 60, render=False)
                b = s.js(CAM_JS)
                dy, dp = abs(deg(C.angle_delta(a["yaw"], b["yaw"]))), abs(deg(b["pitch"] - a["pitch"]))
                v.check("camera drift < 0.05 deg over 90 frames with NO input, pointer LOCKED", dy < 0.05 and dp < 0.05,
                        {"dYawDeg": round(dy, 4), "dPitchDeg": round(dp, 4)})
                # ---------- look: +200 px under lock ----------
                sens = s.js("() => { const W = window.__LC__.W; return W.player.input.ads ? W.settings.adsSensitivity : W.settings.sensitivity; }")
                y0 = s.js("() => window.__LC__.W.player.input.yaw")
                s.page.mouse.move(cv["x"] + 200, cv["y"], steps=10)
                y1 = s.js("() => window.__LC__.W.player.input.yaw")
                want = -200 * sens * 0.0022
                got = y1 - y0
                v.check("a locked +200 px mouse move turns input.yaw by -200 x sens x 0.0022 (2 %)", abs(got - want) <= abs(want) * 0.02,
                        {"dYaw": round(got, 5), "expected": round(want, 5), "sensitivity": sens})
                s.page.mouse.move(cv["x"], cv["y"], steps=10)
                s.step_frames(10, 1 / 60, render=False)
            # ---------- gunshots: N real semi-auto clicks ----------
            s.press("Digit1")
            s.step_frames(40, 1 / 60, render=False)
            wid = s.js("() => window.__LC__.W.player.weapon && window.__LC__.W.player.weapon.id")
            n0 = s.js("() => (window.__H_AUD__ || []).length")
            f0 = s.js("() => window.__LC__.W.stats.shotsFired")
            for i in range(args.clicks):
                s.page.mouse.down()
                s.step_frames(3, 1 / 60, render=False)
                s.page.mouse.up()
                s.step_frames(30, 1 / 60, render=False)
            f1 = s.js("() => window.__LC__.W.stats.shotsFired")
            shots = f1 - f0
            v.check("%d real LMB clicks with the %s fire >= %d shots" % (args.clicks, wid, args.clicks - 1), shots >= args.clicks - 1,
                    {"shots": shots, "weapon": wid})
            ctx = s.js("() => window.__AUDIO_CTX__ ? window.__AUDIO_CTX__.state : null")
            v.check("AudioContext is running", ctx == "running", ctx)
            rows = s.js(AUD_JS, n0)
            gun = [r for r in rows if r.get("tag") == "shotFired" and r.get("own") and not r.get("skip")]
            v.data["audioStarts"] = rows[:80]
            if shots <= 0:
                v.cnj("exactly 1 report per shot", "no shots fired")
            elif not gun:
                v.check("own gunshots are audible (buffer starts during an own 'shotFired')", False,
                        {"shots": shots, "startsInWindow": len(rows), "tags": sorted({str(r.get('tag')) for r in rows})})
            else:
                bad = [r for r in gun if r["played"] != 1]
                v.check("exactly 1 report in the PLAYED window of every own-gunshot buffer start", not bad,
                        {"gunStarts": len(gun), "shots": shots, "bad": bad[:4], "sample": gun[:3]})
                v.info("own-gun buffer starts per shot", round(len(gun) / max(1, shots), 2))
            # ---------- post-match loop ----------
            if not args.no_loop:
                s.release_all()
                s.stage("loop")
                s.start_match("quick", 3, None, enter=True)
                for rnd, button in ((1, "PLAY AGAIN"), (2, "MAIN MENU")):
                    for _ in range(200):
                        st = s.js("() => { const C = window.__LC__; if (C.W.match && C.W.match.over) return 'over'; C.fastForward(5, 1 / 30); return C.W.match && C.W.match.over ? 'over' : 'on'; }")
                        if st == "over":
                            break
                    for _ in range(30):
                        if s.phase() == "over":
                            break
                        s.step_frames(10, 1 / 60, render=False)
                    s.sleep(3.2)                         # the post-match panel is a 2.6 s setTimeout
                    s.step_frames(5, 1 / 60, render=False)
                    btn = None
                    for _ in range(20):
                        btn = s.js(BTN_JS, "^\\s*%s\\s*$" % button)
                        if btn:
                            break
                        s.sleep(0.5)
                    if not btn:
                        v.check("post-match panel offers %s (round %d)" % (button, rnd), False, {"phase": s.phase(), "screen": (s.safe_js("() => document.body.innerText.slice(0, 200)") or "")})
                        break
                    s.page.mouse.click(btn["x"], btn["y"])
                    if button == "PLAY AGAIN":
                        ok = s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
                        v.check("a REAL click on PLAY AGAIN reaches the next lobby", ok is not None, {"s": ok, "phase": s.phase()})
                        if ok is None:
                            break
                        s.sleep(0.3)
                        s.page.keyboard.press("Enter")
                        s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 20, 0.1)
                        s.step_frames(60, 1 / 60, render=30)
                    else:
                        ok = s.wait_js("() => window.__LC__.W.phase === 'menu'", 60, 0.25)
                        v.check("a REAL click on MAIN MENU returns to the menu", ok is not None, {"s": ok, "phase": s.phase()})
            s.thaw_loop()
            s.sleep(1.0)
            d = s.diagnostics()
            v.data["diagnostics"] = d
            C.print_diagnostics(d)
            probs = C.diag_problems(d, rig=False)
            v.check("0 console / page / window errors, 0 failed requests, 0 shader errors (menu -> match -> post-match -> menu)",
                    not probs, {"problems": probs, "first": (d["consoleErrors"] + d["pageErrors"] + d["windowErrors"] + d["failedRequests"])[:5]})
    return C.run_gate("playtest", body, args)


if __name__ == "__main__":
    sys.exit(main())
