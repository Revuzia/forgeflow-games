#!/usr/bin/env python
"""art_a_integration.py - ART-A gate: the game ACTUALLY consumes ART-A's assets in a real match (contracts C-ART-CLIPS, C-ART-CANOPY).

art_a_clips.py / art_a_canopy.py prove the files themselves. This gate proves the consumer side in the merged working tree
(run it with --disk on the full tree; about 6-20 min on the shared box, mostly the match load and the landing; under --isolate the HEAD player.js has no consumer and the gate reports could-not-judge):

  * a standard match loads; player.js reports clip mode "shared"; every shared assets/chars/clips/<clip>.glb named by player.js
    (its SHARED_REQ: MESHY_CLIPS + DEATH_CLIPS + EXT_CLIPS minus SUPERSEDED) was requested exactly ONCE and 0 per-skin assets/chars/meshy/<skin>_<clip>.glb clip files were
    requested (the per-skin originals stay on disk as the fallback);
  * a REAL Space press deploys the human's canopy: player.js reports the canopy "loaded" with the triangle and line-segment counts
    that canopy.json declares (read from the file, not hard-coded) and the deployed chutes are instances of the one canopy mesh;
    a game-camera screenshot of the human under the canopy is saved (--shots) for a human to LOOK at;
  * after landing, 6 bots are killed through W.killActor with constructed hits (front / back / head mixes): each plays one of the
    seven Mixamo death falls (never death2 / death3), and at the end of its clip the hips are <= 0.6 m above the spot it died on;
    the lowest skinned vertex at that moment is reported (information: the corpse lift in player.js is PLAYER's);
  * 0 page errors / window errors / console errors / failed requests / shader errors.
Exit 0 pass / 1 fail / 2 could-not-judge.     python _harness/new/art_a_integration.py --disk [--shots DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import common  # noqa: E402
import art_a_lib  # noqa: E402
from common import Session, add_common_args, run_gate  # noqa: E402

KILL_JS = r"""
(cfg) => {
  const W = window.__LC__.W, p = W.player;
  const deaths = W._playerProbe.deathClips;
  const out = [];
  const bots = W.actors.filter((a) => a !== p && a.alive && !a.isDummy && a.obj && a.obj.parent && a.clips && a.onGround)
    .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos)).slice(0, cfg.n);
  bots.forEach((b, i) => {
    // a constructed last hit: the attacker is the human; every other one a headshot
    b.lastHit = { attackerId: p.id, weaponId: 'ar', isHead: i % 2 === 1, dist: Math.round(p.pos.distanceTo(b.pos)) };
    W.killActor(b, p.id, 'ar');
    out.push({ id: b.id, anim: b.anim, clipName: b.anim && b.clips ? b.clips[b.anim] : null, y0: b._sinkY0, head: i % 2 === 1 });
  });
  window.__ARTA_KILLED__ = bots;
  return { killed: out, deathClips: deaths };
}
"""

MEASURE_JS = r"""
async () => {
  const THREE = await import('three');
  const W = window.__LC__.W, bots = window.__ARTA_KILLED__ || [];
  const done = window.__ARTA_DONE__ = window.__ARTA_DONE__ || {};
  const v = new THREE.Vector3();
  // record each corpse ONCE, on the first check where its clip has reached the end (clamped) and the corpse hold
  // (player.js: max(3, dur + 0.6) s, then a 1.2 s sink) has not ended yet
  bots.forEach((b) => {
    if (done[b.id]) return;
    const act0 = b.rig && b.rig.actions && b.clips && b.anim ? b.rig.actions[b.clips[b.anim]] : null;
    const dur0 = act0 && act0.getClip ? act0.getClip().duration : null;
    if (dur0 == null || act0.time < dur0 - 1e-3) return;
    if (b._sinkT > 0 && b._sinkHold != null && b._sinkT > b._sinkHold) { done[b.id] = { id: b.id, anim: b.anim, missed: true, sinkT: b._sinkT, hold: b._sinkHold }; return; }
    done[b.id] = measure(b);
  });
  return Object.values(done);
  function measure(b) {
    let hips = null, minV = Infinity;
    b.obj.updateMatrixWorld(true);
    b.obj.traverse((o) => { if (!hips && o.isBone && /Hips$/.test(o.name)) hips = o; });
    b.obj.traverse((o) => {
      if (!o.isSkinnedMesh || !o.visible) return;
      o.skeleton.update();
      const n = o.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 4000));
      for (let i = 0; i < n; i += step) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.y < minV) minV = v.y; }
    });
    const hy = hips ? hips.getWorldPosition(v).y : null;
    const act = b.rig && b.rig.actions && b.clips && b.anim ? b.rig.actions[b.clips[b.anim]] : null;
    return { id: b.id, anim: b.anim, y0: b._sinkY0, hipsAbove: hy == null ? null : hy - b._sinkY0,
             minVertAbove: isFinite(minV) ? minV - b._sinkY0 : null, objY: b.obj.position.y,
             clipTime: act ? act.time : null, clipDur: act && act.getClip ? act.getClip().duration : null, inScene: !!b.obj.parent,
             sinkT: b._sinkT, hold: b._sinkHold };
  }
}
"""


def _player_lists():
    src = open(os.path.join(common.ROOT, "runtime", "3d", "royale", "player.js"), encoding="utf-8").read()

    def grab(name):
        m = re.search(r"const\s+%s\s*=\s*\[(.*?)\];" % name, src, re.S)
        return re.findall(r'"([A-Za-z0-9_]+)"', re.sub(r"//[^\n]*", "", m.group(1))) if m else None
    sup = re.search(r"const\s+SUPERSEDED\s*=\s*\{(.*?)\};", src, re.S)
    superseded = dict(re.findall(r'([A-Za-z0-9_]+)\s*:\s*"([A-Za-z0-9_]+)"', sup.group(1))) if sup else {}
    return grab("MESHY_CLIPS"), grab("DEATH_CLIPS"), grab("EXT_CLIPS") or [], superseded


def shared_request_names(meshy, deaths, ext, superseded):
    """the shared clip files player.js asks for: its SHARED_REQ = MESHY_CLIPS + DEATH_CLIPS + EXT_CLIPS minus the SUPERSEDED names (P2/P3 fix
    round: the P23 player lane bound rifle_idle / walk / run / crouch from their *_g re-bakes, 45 files; this gate still read only the first
    two lists - 22 names - and FAILED the integrated tree 'missing rifle_idle ...' although every file player.js names came exactly once)"""
    allc = (meshy or []) + (deaths or []) + (ext or [])
    return [n for n in allc if not (n in superseded and superseded[n] in allc)]


def main(v):
    art_a_lib.served_note(v, v.args)
    a = v.args
    meshy, deaths, ext, superseded = _player_lists()
    meta = json.load(open(os.path.join(common.ROOT, "assets", "props", "canopy.json"), encoding="utf-8"))
    want_tris, want_lines = int(meta.get("tris") or 0), len(meta["lines"]) // 2
    shots = a.shots or os.path.join(common.ROOT, "_harness", "_shots")
    os.makedirs(shots, exist_ok=True)
    urls = []
    with Session(a, name="art_a_integration") as s:
        art_a_lib.overlay(s, a)
        s.page.on("request", lambda r: urls.append(r.url))
        # which SCRIPT asked for each character file (CDP initiator stack, async parents included)
        initiators = {}

        def on_req(ev):
            u = ev.get("request", {}).get("url", "")
            if "/assets/chars/" not in u:
                return
            files, st = [], (ev.get("initiator") or {}).get("stack")
            while st:
                for f in st.get("callFrames", []):
                    name = (f.get("url") or "").split("?")[0].rsplit("/", 1)[-1]
                    if name and name not in files:
                        files.append(name)
                st = st.get("parent")
            initiators.setdefault(u.split("?")[0], []).append(files)
        try:
            s.cdp().on("Network.requestWillBeSent", on_req)
            s.cdp().send("Network.enable")
        except Exception as e:  # noqa: BLE001
            v.note("CDP initiator capture unavailable: %s" % str(e)[:120])
        s.boot()
        if not s.js("() => !!(window.__LC__.W._playerProbe && window.__LC__.W._playerProbe.clips)"):
            v.cnj("consumer present", "player.js has no _playerProbe.clips (the PLAYER P1.1 consumer is not in this build: --isolate serves HEAD)")
            return
        n_boot = len(urls)          # requests made before startMatch (title screen + locker preview, hud.js)
        r = s.start_match("standard", a.seed, a.map)
        v.info("match", r)
        s.freeze_loop()
        cs = s.js("() => window.__LC__.W._playerProbe.clips()")
        v.info("clip load stats", cs)
        clip_urls = [u.split("?")[0] for u in urls[n_boot:] if "/assets/chars/" in u]
        boot_urls = [u.split("?")[0] for u in urls[:n_boot] if "/assets/chars/" in u]
        shared_req = {}
        for u in clip_urls:
            m = re.search(r"/assets/chars/clips/([A-Za-z0-9_]+)\.glb$", u)
            if m:
                shared_req[m.group(1)] = shared_req.get(m.group(1), 0) + 1
        names = shared_request_names(meshy, deaths, ext, superseded)
        v.info("shared clip names player.js requests (MESHY + DEATH + EXT minus SUPERSEDED)", {"n": len(names), "superseded": superseded})
        clip_re = r"/assets/chars/meshy/[a-z]+_(%s)\.glb$" % "|".join(map(re.escape, (meshy or []) + (deaths or []) + (ext or [])))
        per_skin_all = [u for u in clip_urls if re.search(clip_re, u)]
        # a per-skin request counts against player.js unless its initiator stack is known and does not contain player.js
        def by_player(u):
            st = initiators.get(u)
            return True if not st else any("player.js" in fs for fs in st)
        per_skin = [u for u in per_skin_all if by_player(u)]
        others = sorted(set("%s <- %s" % (u.rsplit("/", 1)[1], ",".join(f for f in (initiators.get(u) or [[]])[0] if f.endswith(".js") and "three" not in f)[:80])
                            for u in per_skin_all if not by_player(u)))
        v.info("per-skin clip files fetched during the match load by OTHER scripts (initiator from CDP)", "%d: %s" % (len(others), others))
        boot_per_skin = [u.rsplit("/", 1)[1] for u in boot_urls if re.search(clip_re, u)]
        v.info("per-skin clip files fetched BEFORE startMatch (title screen; not counted)",
               "%d: %s" % (len(boot_per_skin), boot_per_skin))
        twice = {k: n for k, n in shared_req.items() if n != 1}
        missing = [n for n in names if n not in shared_req]
        v.check("player.js loads the shared clips: mode 'shared', %d requested and %d loaded" % (len(names), len(names)),
                cs.get("mode") == "shared" and cs.get("requests") == len(names) and cs.get("loaded") == len(names), cs)
        v.check("match load: every shared clip file requested exactly once; 0 per-skin <skin>_<clip>.glb requests from player.js",
                not twice and not missing and not per_skin,
                "shared files %d, twice %s, missing %s, per-skin %d %s" % (len(shared_req), twice, missing, len(per_skin), per_skin[:3]))
        # ---- canopy: a REAL Space while gliding toggles the chute (player.js keydown)
        s.step_frames(20, 1 / 60, render=False)
        for _ in range(4):
            if s.js("() => !!window.__LC__.W.player.chute"):
                break
            s.page.keyboard.press("Space")
            s.step_frames(45, 1 / 60, render=False)
        s.step_frames(40, 1 / 60, render=True)
        cn = s.js("""() => { const W = window.__LC__.W, c = W._playerProbe.canopy();
            return Object.assign(c, { humanChute: !!W.player.chute, deployed: W.actors.filter((a) => a.chute).length }); }""")
        v.info("canopy stats", cn)
        v.check("canopy loaded from canopy.glb/json: %d triangles, %d line segments (as canopy.json declares)" % (want_tris, want_lines),
                cn.get("state") == "loaded" and cn.get("triangles") == want_tris and cn.get("lines") == want_lines,
                {k: cn.get(k) for k in ("state", "triangles", "lines", "span")})
        v.check("the human's canopy is deployed and every deployed chute is an instance of the one canopy mesh",
                cn.get("humanChute") and cn.get("deployed", 0) >= 1 and cn.get("instances") == cn.get("deployed"),
                {k: cn.get(k) for k in ("humanChute", "deployed", "instances")})
        shot = os.path.join(shots, "art_a_integration_canopy.png")
        s.canvas_png(shot)
        v.info("shot (game camera under canopy)", shot)
        # ---- deaths
        land = s.land(max_s=150, protect=True)
        v.info("landed", land)
        s.step_frames(30, 1 / 60, render=False)
        k = s.js(KILL_JS, {"n": 6})
        v.info("killed", k["killed"])
        if len(k["killed"]) < 3:
            v.cnj("enough grounded bots to kill", "only %d grounded bots found" % len(k["killed"]))
        else:
            # step in 0.1 s chunks (sim tick + mixers each frame; no draw, the iGPU is the slow part) and record every corpse at the
            # end of ITS clip, before its hold ends and the sink starts (the longest fall is 3.70 s)
            m = []
            for _ in range(45):
                s.step_frames(6, 1 / 60, render=False)
                m = s.js(MEASURE_JS)
                if len(m) >= len(k["killed"]):
                    break
            missed = [r_ for r_ in m if r_.get("missed")]
            m = [r_ for r_ in m if not r_.get("missed")]
            if missed or len(m) < len(k["killed"]):
                v.note("corpses not measured at their clip end: missed %s, measured %d of %d" % (missed, len(m), len(k["killed"])))
            v.data["deathMeasure"] = m
            for row in m:
                v.info("corpse %s" % row["id"], "%-17s clip t %.2f/%.2f s, hips %.3f m above the death spot, lowest vertex %+.3f m, in scene %s" % (
                    row["anim"], row["clipTime"] or -1, row["clipDur"] or -1, row["hipsAbove"] if row["hipsAbove"] is not None else -9,
                    row["minVertAbove"] if row["minVertAbove"] is not None else -9, row["inScene"]))
            bad_clip = [r_["anim"] for r_ in m if r_["anim"] not in (deaths or [])]
            v.check("every killed bot plays one of the seven Mixamo death falls (never death2/death3/death)", not bad_clip,
                    "falls: %s" % sorted(set(r_["anim"] for r_ in m)) if not bad_clip else "off-list: %s" % bad_clip)
            bad_end = [(r_["anim"], round(r_["hipsAbove"], 3) if r_["hipsAbove"] is not None else None) for r_ in m
                       if r_["hipsAbove"] is None or r_["hipsAbove"] > 0.6 or (r_["clipDur"] and r_["clipTime"] is not None and r_["clipTime"] < r_["clipDur"] - 0.05)]
            if len(m) < 3:
                v.cnj("corpse end pose", "only %d corpses measured at their clip end" % len(m))
            else:
                v.check("at the end of its clip (before the sink) every corpse's hips are <= 0.6 m above the spot it died on (includes PLAYER's 0.1 m lift)",
                        not bad_end, ("worst %.3f m over %d corpses" % (max(r_["hipsAbove"] for r_ in m), len(m))) if not bad_end else bad_end)
            shot2 = os.path.join(shots, "art_a_integration_corpses.png")
            # frame a corpse that is still in its hold (the last fall to finish; the earlier ones may already be sinking)
            s.canvas_png(shot2, js_render="""const W = window.__LC__.W, k = W.kernel, cam = W.camera;
                const live = (window.__ARTA_KILLED__ || []).filter((q) => q.obj.parent && q._sinkT >= 0 && q._sinkT < q._sinkHold);
                live.sort((p, q) => (q._sinkHold - q._sinkT) - (p._sinkHold - p._sinkT));
                const b = live[0]; window.__ARTA_SHOT__ = b ? b.id + ' ' + b.anim : null;
                if (b) { const c = b.obj.position; cam.position.set(c.x + 3.2, c.y + 2.2, c.z + 3.2); cam.lookAt(c.x, c.y + 0.3, c.z); cam.updateMatrixWorld(true); }
                if (k.composer) k.composer.render(0.016); else k.renderer.render(k.scene, cam)""")
            v.info("shot (a corpse in its end pose, before the sink)", "%s :: %s" % (s.js("() => window.__ARTA_SHOT__"), shot2))
        d = s.diagnostics()
        v.data["diagnostics"] = {kk: d[kk] for kk in ("consoleErrors", "pageErrors", "windowErrors", "failedRequests", "shader", "rigWarnings")}
        v.check("0 page errors / window errors / console errors / failed requests / shader errors",
                not (d["pageErrors"] or d["windowErrors"] or d["consoleErrors"] or d["failedRequests"] or d["shader"]),
                json.dumps({kk: d[kk][:3] for kk in ("pageErrors", "windowErrors", "consoleErrors", "failedRequests", "shader") if d[kk]}) or "clean")
        v.info("[rig] lines", len(d["rigWarnings"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    add_common_args(ap)
    art_a_lib.add_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--map", default=None)
    ap.add_argument("--shots", default=None, help="directory for the two screenshots (default _harness/_shots)")
    a = ap.parse_args()
    art_a_lib.prepare(a)
    sys.exit(run_gate("art_a_integration", main, a))
