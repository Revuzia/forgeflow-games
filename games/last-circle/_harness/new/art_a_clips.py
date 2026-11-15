#!/usr/bin/env python
"""art_a_clips.py - ART-A gate (plan P1.1 + P1.6): the shared clip GLBs in assets/chars/clips bind and play like the originals.

Runs ONE real Chrome (common.Session, boot the game so the game's own GLTFLoader / Draco / three import map are used).
In-page, for each of the 5 skins (athlete = 34 bones, the others 52):

  P1.1 shared clips (the 15 MESHY_CLIPS of player.js; death2/death3 were dropped there):
    * load <skin>_<clip>.glb (old, per skin) and clips/<clip>.glb (new, shared), run BOTH through the game's own load-time
      processing (rebaseRootTracks -> stripRootMotion -> pruneClipTracks, ported from player.js);
    * the surviving track sets are identical, the values agree to the int16 quantisation step (<= 1e-4), and the bone world
      positions (hips, spine, head, hands, feet) agree to <= 1 mm at four times across the clip;
    * a real AnimationMixer on the real skin binds every track: 0 "No target node found" lines after the prune.
  P1.6 death clips (death_front, death_front_head, death_back, death_back_head, death_right, death_crouch_head, death_walking):
    * all tracks bind on all 5 skins (0 PropertyBinding warnings after the prune);
    * IN METRES: standing start hips height in [0.85, 1.05] (crouch: [0.35, 0.60]); the mean hips height is inside the
      stripRootMotion unit guard's silent band [0.2, 3] (a guard hit would rescale the clip by 0.99/mean);
    * the corpse ends DOWN: hips world Y at the last frame <= 0.6 m. The end hips height and, on the soldier, the
      lowest skinned vertex at the start and end are printed for every clip.
  Boot hygiene: 0 page errors, 0 console errors, 0 failed requests while all that ran.

Exit 0 pass / 1 fail / 2 could-not-judge (environment).  Run:  python _harness/new/art_a_clips.py --disk
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import common  # noqa: E402
import art_a_lib  # noqa: E402
from common import EnvFailure, Session, add_common_args, run_gate  # noqa: E402

SKINS = ["athlete", "juggernaut", "soldier", "viper", "wraith"]
SHARED = ["idle", "walk", "run", "death", "hit", "dance", "cheer", "jump", "swim", "crouch",
          "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch"]
DEATHS = ["death_front", "death_front_head", "death_back", "death_back_head", "death_right", "death_crouch_head", "death_walking"]
CLIPS_DIR = os.path.join(common.ROOT, "assets", "chars", "clips")

PROBE_JS = r"""
async (cfg) => {
  const THREE = await import('three');
  const LC = window.__LC__, W = LC.W, loader = W.kernel.loader, base = W.assetBase;
  const warnLog = [];
  const _w = console.warn; console.warn = (...a) => { warnLog.push(a.map(String).join(' ')); };
  const out = { skins: {}, errors: [], base };
  try {
  // ---- ported from runtime/3d/royale/player.js (stripRootMotion / rootBone / rebaseRootTracks), as of 2026-10-05 ----
  const _rbM = new THREE.Matrix4(), _rbQ = new THREE.Quaternion(), _rbV = new THREE.Vector3(), _rbS = new THREE.Vector3(), _rbK = new THREE.Quaternion();
  const rootBone = (scene) => { let r = null; scene.traverse((o) => { if (!r && (o.isBone || /Hips$/.test(o.name)) && /(^|:)?(mixamorig:?)?Hips$/i.test(o.name)) r = o; }); return r; };
  const isRoot = (node) => /(^|:|\|)(Hips|Root|Armature|mixamorig:?Hips)$/i.test(node);
  function rebase(clip, srcScene, baseScene) {
    const src = rootBone(srcScene), bse = rootBone(baseScene);
    if (!src || !bse || !src.parent || !bse.parent) return false;
    srcScene.updateMatrixWorld(true); baseScene.updateMatrixWorld(true);
    _rbM.copy(bse.parent.matrixWorld).invert().multiply(src.parent.matrixWorld);
    const e = _rbM.elements; let id = true;
    for (let i = 0; i < 16; i++) if (Math.abs(e[i] - (i % 5 === 0 ? 1 : 0)) > 1e-4) { id = false; break; }
    if (id) return false;
    _rbM.decompose(_rbV, _rbQ, _rbS);
    for (const tr of clip.tracks) {
      if (tr.name === src.name + '.position') { const v = tr.values; for (let i = 0; i < v.length; i += 3) { _rbV.fromArray(v, i).applyMatrix4(_rbM); _rbV.toArray(v, i); } }
      else if (tr.name === src.name + '.quaternion') { const v = tr.values; for (let i = 0; i < v.length; i += 4) { _rbK.fromArray(v, i).premultiply(_rbQ); _rbK.toArray(v, i); } }
    }
    return true;
  }
  function strip(clip) {
    const info = { rescaled: false, meanY: null };
    clip.tracks = clip.tracks.filter((tr) => { const m = /\.(position|scale)$/.exec(tr.name || ''); if (!m) return true; return isRoot(tr.name.slice(0, -m[0].length)); });
    for (const tr of clip.tracks) {
      if (!/\.position$/.test(tr.name || '')) continue;
      const node = tr.name.replace(/\.position$/, ''); if (!isRoot(node)) continue;
      const v = tr.values; if (!v || v.length < 3) continue;
      const x0 = v[0], y0 = v[1], z0 = v[2];
      const flatY = /^(jump)$/i.test(clip.name || '');
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; if (flatY) v[i + 1] = y0; }
      if (!flatY) {
        let s = 0; for (let i = 1; i < v.length; i += 3) s += v[i];
        const mean = s / (v.length / 3); info.meanY = mean;
        if (mean > 3 || (mean > 1e-6 && mean < 0.2)) { info.rescaled = true; const f = 0.99 / mean; for (let i = 1; i < v.length; i += 3) v[i] *= f; }
      }
    }
    return info;
  }
  function prune(scene, clip) {
    const names = new Set(); scene.traverse((o) => { if (o.name) names.add(o.name); names.add(o.uuid); });
    const before = clip.tracks.length;
    clip.tracks = clip.tracks.filter((t) => { let n; try { n = THREE.PropertyBinding.parseTrackName(t.name).nodeName; } catch (e) { return true; } return !n || names.has(n); });
    return before - clip.tracks.length;
  }
  // ----------------------------------------------------------------------------------------------------------------
  const boneBy = (scene, short) => { let r = null; scene.traverse((o) => { if (!r && o.isBone && o.name.replace(/^mixamorig:?/, '') === short) r = o; }); return r; };
  const KEYS = ['Hips', 'Spine2', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftForeArm', 'RightLeg'];
  function sample(scene, mesh, clip, times, keyBones, wantVerts) {
    const mixer = new THREE.AnimationMixer(scene);
    const act = mixer.clipAction(clip); act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play();
    const res = [];
    for (const t of times) {
      mixer.setTime(t); scene.updateMatrixWorld(true);
      const row = { joints: keyBones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).toArray()) };
      if (wantVerts && mesh) {
        mesh.skeleton.update();
        const n = mesh.geometry.attributes.position.count, v = new THREE.Vector3(); let m = 1e9;
        const stride = wantVerts === 'full' ? 1 : Math.max(1, Math.floor(n / 8000));
        for (let i = 0; i < n; i += stride) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); if (v.y < m) m = v.y; }
        row.minVertY = m;
      }
      res.push(row);
    }
    mixer.stopAllAction(); mixer.uncacheClip(clip); mixer.uncacheRoot(scene);
    if (mesh) mesh.skeleton.pose();
    return res;
  }
  const newCache = {};
  const loadNew = async (name) => (newCache[name] || (newCache[name] = await loader.loadAsync(base + 'assets/chars/clips/' + name + '.glb')));
  for (const skin of cfg.skins) {
    const sg = await loader.loadAsync(base + 'assets/chars/meshy/' + skin + '.glb');
    const scene = sg.scene; let mesh = null; scene.traverse((o) => { if (!mesh && o.isSkinnedMesh) mesh = o; });
    const keyBones = KEYS.map((k) => boneBy(scene, k)); if (keyBones.some((b) => !b)) { out.errors.push(skin + ': missing key bone'); continue; }
    const hips = keyBones[0];
    const nBones = (() => { let n = 0; scene.traverse((o) => { if (o.isBone) n++; }); return n; })();
    const R = { bones: nBones, verts: mesh ? mesh.geometry.attributes.position.count : 0, shared: {}, deaths: {} };
    for (const name of cfg.shared) {
      const row = {};
      try {
        const gO = await loader.loadAsync(base + 'assets/chars/meshy/' + skin + '_' + name + '.glb');
        const gN = await loadNew(name);
        const cO = gO.animations[0].clone(); cO.name = name; const cN = gN.animations[0].clone(); cN.name = name;
        row.animsNew = gN.animations.length;
        rebase(cO, gO.scene, sg.scene); rebase(cN, gN.scene, sg.scene); strip(cO); strip(cN);
        row.tracksBeforePrune = [cO.tracks.length, cN.tracks.length];
        row.orphans = [prune(scene, cO), prune(scene, cN)];
        const kO = cO.tracks.map((t) => t.name).sort(), kN = cN.tracks.map((t) => t.name).sort();
        row.sameTracks = kO.length === kN.length && kO.every((x, i) => x === kN[i]);
        let md = 0; const mapN = new Map(cN.tracks.map((t) => [t.name, t]));
        for (const t of cO.tracks) {
          const u = mapN.get(t.name); if (!u) continue;
          if (u.values.length !== t.values.length || u.times.length !== t.times.length) { md = Infinity; continue; }
          for (let i = 0; i < t.values.length; i++) md = Math.max(md, Math.abs(t.values[i] - u.values[i]));
        }
        row.maxValueDiff = md;
        warnLog.length = 0;
        const mx = new THREE.AnimationMixer(scene); const ac = mx.clipAction(cN); ac.play(); mx.update(0.01);
        row.noTarget = warnLog.filter((s) => s.indexOf('No target node') >= 0).length;
        row.bound = ac._propertyBindings ? ac._propertyBindings.length : null;
        mx.stopAllAction(); mx.uncacheClip(cN); mx.uncacheRoot(scene); if (mesh) mesh.skeleton.pose();
        const dur = cO.duration, ts = [0, dur * 0.31, dur * 0.62, dur];
        const pO = sample(scene, mesh, cO, ts, keyBones, false), pN = sample(scene, mesh, cN, ts, keyBones, false);
        let jd = 0; for (let i = 0; i < ts.length; i++) for (let j = 0; j < keyBones.length; j++) for (let k = 0; k < 3; k++) jd = Math.max(jd, Math.abs(pO[i].joints[j][k] - pN[i].joints[j][k]));
        row.maxJointDiffM = jd; row.duration = dur;
      } catch (e) { row.error = String(e && e.message || e); }
      R.shared[name] = row;
    }
    for (const name of cfg.deaths.concat(['death'])) {
      const row = {};
      try {
        const isNew = name !== 'death';
        const g = isNew ? await loadNew(name) : await loader.loadAsync(base + 'assets/chars/meshy/' + skin + '_death.glb');
        const c = g.animations[0].clone(); c.name = name;
        row.anims = g.animations.length;
        rebase(c, g.scene, sg.scene); const si = strip(c); row.rescaled = si.rescaled; row.meanY = si.meanY;
        row.orphans = prune(scene, c); row.tracks = c.tracks.length;
        warnLog.length = 0;
        const mx = new THREE.AnimationMixer(scene); const ac = mx.clipAction(c); ac.play(); mx.update(0.01);
        row.noTarget = warnLog.filter((s) => s.indexOf('No target node') >= 0).length;
        row.bound = ac._propertyBindings ? ac._propertyBindings.length : null;
        mx.stopAllAction(); mx.uncacheClip(c); mx.uncacheRoot(scene); if (mesh) mesh.skeleton.pose();
        const dur = c.duration;
        const wantV = skin === 'soldier' ? 'full' : 'sparse';
        const pp = sample(scene, mesh, c, [0, dur * 0.5, dur], keyBones, wantV);
        row.duration = dur; row.hipsStartY = pp[0].joints[0][1]; row.hipsMidY = pp[1].joints[0][1]; row.hipsEndY = pp[2].joints[0][1];
        row.headEndY = pp[2].joints[2][1]; row.footEndY = Math.min(pp[2].joints[5][1], pp[2].joints[6][1]);
        row.minVertStart = pp[0].minVertY; row.minVertEnd = pp[2].minVertY;
      } catch (e) { row.error = String(e && e.message || e); }
      R.deaths[name] = row;
    }
    out.skins[skin] = R;
  }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  finally { console.warn = _w; }
  return out;
}
"""


def _player_lists():
    """The clip-name lists as player.js declares them (contract C-ART-CLIPS: one shared file per MESHY_CLIPS name).
    Returns (meshy, deaths) or (None, None) when player.js cannot be parsed."""
    import re
    try:
        src = open(os.path.join(common.ROOT, "runtime", "3d", "royale", "player.js"), encoding="utf-8").read()
    except OSError:
        return None, None
    def grab(name):
        m = re.search(r"const\s+%s\s*=\s*\[(.*?)\];" % name, src, re.S)
        if not m:
            return None
        body = re.sub(r"//[^\n]*", "", m.group(1))
        return re.findall(r'"([A-Za-z0-9_]+)"', body)
    return grab("MESHY_CLIPS"), grab("DEATH_CLIPS")


def main(v):
    art_a_lib.served_note(v, v.args)
    args = v.args
    # ---- contract: the lists this gate checks are the lists player.js loads
    pm, pd = _player_lists()
    if pm is None:
        v.info("player.js lists", "MESHY_CLIPS not found in player.js (PLAYER lane change?) - checked the gate's own list")
    else:
        v.check("contract: gate lists == player.js MESHY_CLIPS (%d) + DEATH_CLIPS (%d)" % (len(pm), len(pd or [])),
                sorted(pm) == sorted(SHARED) and (pd is None or sorted(pd) == sorted(DEATHS)),
                "player.js MESHY_CLIPS=%s DEATH_CLIPS=%s" % (pm, pd))
    # ---- static file facts
    missing = [c for c in SHARED + DEATHS if not os.path.isfile(os.path.join(CLIPS_DIR, c + ".glb"))]
    sizes = {c: os.path.getsize(os.path.join(CLIPS_DIR, c + ".glb")) for c in SHARED + DEATHS if os.path.isfile(os.path.join(CLIPS_DIR, c + ".glb"))}
    v.check("%d clip files exist (%d MESHY_CLIPS + %d deaths)" % (len(SHARED) + len(DEATHS), len(SHARED), len(DEATHS)), not missing,
            "missing: %s" % missing if missing else "all present")
    shared_bytes = sum(sizes.get(c, 0) for c in SHARED)
    death_bytes = sum(sizes.get(c, 0) for c in DEATHS)
    old_bytes = sum(os.path.getsize(os.path.join(common.ROOT, "assets", "chars", "meshy", "soldier_%s.glb" % c)) for c in SHARED)
    v.info("bytes", "%d shared clips %d B (per-skin originals x5 = %d B); %d death clips %d B" % (len(SHARED), shared_bytes, old_bytes * 5, len(DEATHS), death_bytes))
    if missing:
        return
    with Session(args, name="art_a_clips") as s:
        art_a_lib.overlay(s, args)
        s.boot()
        res = s.js(PROBE_JS, {"skins": SKINS, "shared": SHARED, "deaths": DEATHS})
        d = s.diagnostics()
        v.data["probe"] = res
        v.data["diagnostics"] = {k: d[k] for k in ("consoleErrors", "pageErrors", "windowErrors", "failedRequests", "shader")}
        if res.get("errors"):
            v.check("probe ran without an in-page exception", False, res["errors"][0][:600])
            return
        v.check("probe ran without an in-page exception", True, "5 skins loaded in the game's own loader")
        # ---- P1.1
        bad_bind, bad_tracks, bad_vals, bad_pose, bad_err = [], [], [], [], []
        worst_val = worst_pose = 0.0
        for skin, R in res["skins"].items():
            for c, r in R["shared"].items():
                if r.get("error"):
                    bad_err.append("%s/%s: %s" % (skin, c, r["error"][:80])); continue
                if r["noTarget"] != 0 or r["bound"] != r["tracksBeforePrune"][1] - r["orphans"][1] or r["animsNew"] != 1:
                    bad_bind.append("%s/%s noTarget=%s bound=%s expect=%s anims=%s" % (skin, c, r["noTarget"], r["bound"], r["tracksBeforePrune"][1] - r["orphans"][1], r["animsNew"]))
                if not r["sameTracks"]:
                    bad_tracks.append("%s/%s" % (skin, c))
                worst_val = max(worst_val, r["maxValueDiff"]); worst_pose = max(worst_pose, r["maxJointDiffM"])
                if r["maxValueDiff"] > 1e-4:
                    bad_vals.append("%s/%s %.2e" % (skin, c, r["maxValueDiff"]))
                if r["maxJointDiffM"] > 0.001:
                    bad_pose.append("%s/%s %.4f m" % (skin, c, r["maxJointDiffM"]))
        bones = {k: R["bones"] for k, R in res["skins"].items()}
        v.info("skins", "bone counts " + json.dumps(bones))
        v.check("P1.1 every shared clip binds all its tracks on all 5 skins (0 PropertyBinding 'No target node' after the prune)",
                not bad_bind and not bad_err, "; ".join((bad_bind + bad_err)[:5]) or "15 clips x 5 skins, 0 warnings")
        v.check("P1.1 shared and per-skin clips leave the identical track set after the game's own processing",
                not bad_tracks, ", ".join(bad_tracks[:6]) or "15 x 5 identical")
        v.check("P1.1 track values equal to the int16 step (<= 1e-4)", not bad_vals, ("worst %.2e" % worst_val) if not bad_vals else "; ".join(bad_vals[:4]))
        v.check("P1.1 bone world positions old vs new <= 1 mm (hips, spine, head, hands, feet) at 4 times", not bad_pose,
                ("worst %.5f m" % worst_pose) if not bad_pose else "; ".join(bad_pose[:4]))
        orph = {k: {c: r["orphans"][1] for c, r in R["shared"].items() if r.get("orphans")} for k, R in res["skins"].items()}
        v.info("orphan tracks pruned by the game's prune (new clips), per skin, idle/rifle_idle/crouch",
               json.dumps({k: [o.get("idle"), o.get("rifle_idle"), o.get("crouch")] for k, o in orph.items()}))
        # ---- P1.6
        bad_d_bind, bad_d_h, bad_d_end, bad_d_guard, rows = [], [], [], [], []
        for skin, R in res["skins"].items():
            for c, r in R["deaths"].items():
                if r.get("error"):
                    bad_d_bind.append("%s/%s: %s" % (skin, c, r["error"][:80])); continue
                if c != "death":
                    if r["noTarget"] != 0 or r["bound"] != r["tracks"] or r["anims"] != 1:
                        bad_d_bind.append("%s/%s noTarget=%s bound=%s tracks=%s anims=%s" % (skin, c, r["noTarget"], r["bound"], r["tracks"], r["anims"]))
                    lo, hi = (0.35, 0.60) if c == "death_crouch_head" else (0.85, 1.05)
                    if not (lo <= r["hipsStartY"] <= hi):
                        bad_d_h.append("%s/%s start %.3f" % (skin, c, r["hipsStartY"]))
                    if r["rescaled"] or not (0.2 <= r["meanY"] <= 3):
                        bad_d_guard.append("%s/%s meanY %.3f rescaled=%s" % (skin, c, r["meanY"], r["rescaled"]))
                    if not (r["hipsEndY"] <= 0.6):
                        bad_d_end.append("%s/%s end %.3f" % (skin, c, r["hipsEndY"]))
                if skin == "soldier":
                    rows.append("%-17s dur %.2fs hips start %.3f mid %.3f END %.3f | head end %.3f | min vertex y start %s end %s" % (
                        c, r["duration"], r["hipsStartY"], r["hipsMidY"], r["hipsEndY"], r["headEndY"],
                        "%.3f" % r["minVertStart"] if r.get("minVertStart") is not None else "-", "%.3f" % r["minVertEnd"] if r.get("minVertEnd") is not None else "-"))
        v.check("P1.6 all seven death clips bind every track on all 5 skins (0 PropertyBinding warnings)", not bad_d_bind,
                "; ".join(bad_d_bind[:5]) or "7 clips x 5 skins")
        v.check("P1.6 clips are in METRES: standing start hips 0.85-1.05 m (crouch 0.35-0.60), mean inside the unit guard's silent band",
                not bad_d_h and not bad_d_guard, "; ".join((bad_d_h + bad_d_guard)[:5]) or "all in band, no 0.99/mean rescale")
        v.check("P1.6 corpse ends DOWN: hips world Y at the last frame <= 0.6 m on all 5 skins", not bad_d_end,
                "; ".join(bad_d_end[:5]) or "7 clips x 5 skins (soldier rows below)")
        for r in rows:
            v.info("soldier " + r.split()[0], r)
        # ---- hygiene
        d2 = s.diagnostics()
        v.check("0 page errors / window errors / console errors / failed requests", not (d2["pageErrors"] or d2["windowErrors"] or d2["consoleErrors"] or d2["failedRequests"] or d2["shader"]),
                json.dumps({k: d2[k][:2] for k in ("pageErrors", "windowErrors", "consoleErrors", "failedRequests", "shader") if d2[k]}) or "clean")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    add_common_args(ap)
    art_a_lib.add_args(ap)
    a = ap.parse_args()
    art_a_lib.prepare(a)
    sys.exit(run_gate("art_a_clips", main, a))
