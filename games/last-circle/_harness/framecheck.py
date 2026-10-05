#!/usr/bin/env python
"""framecheck - exact, GPU-independent frame counters (promoted from _spec/improve_2026-09/baseline/framepump5/6/7.py).

    python _harness/framecheck.py                  # isla_viva seed 1, standard mode (the framepump baseline setup)
    python _harness/framecheck.py --disk --real-draws

The kernel's own rAF loop is STOPPED and frames are pumped by hand (common.PUMP_JS: tweens -> mixers -> updaters ->
render) at dt = 1/60. Render calls happen on SAMPLED frames only; gl.draw* are stubbed by default so the shared iGPU
never rasters (program link, uploads, culling, uniforms and every renderer.info counter still run: counts are exact
whatever the GPU is doing). Milliseconds are printed as INFORMATION only.

Counted (each with the PLAN threshold it gates on; "was" = the audit's measurement on 2026-09-30):
  drop frame 1        new programs == 0 (was 27, L3/L4/L5/L7 warm-up); total tris < 1.5 M (was 9.91 M);
                      shadow:actor* tris < 0.5 M (was 8.57 M, L5 a)
  sampled drop/match  new programs == 0 on every sampled frame after drop frame 1
  10 SPACE toggles    GPU geometries flat after the first deploy/cut pair (real Space key presses; L5 e)
  drop cluster        every live actor clustered 22 m ahead of the gliding camera (characters-art method), one
                      rendered frame: calls <= 250 (was 482), actor-chute calls <= 2, actor-nametag calls <= 1 (L5 e/f)
  skinned tris        per visible actor < 30 k (L5 b)
  match frame         total tris < 5 M (was 16.5 M, L5)
  forced layouts      Layout trace events WITH A JS STACK per frame (a stack-traced Chrome trace over 240 drop / 600 match
                      pumped frames): drop 0.00 (was 1.00, L3), match 0.00 (was 0.15, L7); each forcing call site is printed
                      (file:line:col). CDP LayoutCount (which also counts the browser's own lifecycle layout after each
                      evaluate - Wave-3: that was all of Wave-2's 0.01 / 0.02) is information. Falsifier: --plant forced-layout
  allocation          HeapProfiler sampling KB per match frame < 100 (was 554.5, L6 i)
  queryColliders      calls per match frame <= 150 (was 423.2; PLAN says "well below 423" - this harness reads that
                      as <= 150, about a third; L6 may tighten)
  SMG cadence         in-page CADENCE probe (weapons.update driven directly): 720 +-6 rpm at 20..165 Hz (was 600
                      at 60 Hz, L6 g)
Attribution keys are pass:group - pass is shadow / main / post; group is actor-body / actor-weapon / actor-chute /
actor-nametag / actor-other for objects under an actor (or any object named like chute/canopy/nametag, so lane L5's
instanced replacements are counted in the same bucket - name them "actor-chute" / "actor-nametag"), else the
top-level scene group (map, loot, fx, storm ...), plus [skinned] / [inst].
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ATTR_JS = r"""() => {
  const W = window.__LC__.W, k = W.kernel, r = k.renderer, P = window.__H_PUMP__;
  if (window.__FC__) return 'already';
  const FC = window.__FC__ = { attr: null, want: false, last: null, cat: null };
  r.info.autoReset = false;
  const catMap = () => {
    const m = new Map();
    for (const a of W.actors) {
      if (!a.obj) continue;
      const mark = (root, c) => root && root.traverse && root.traverse((o) => m.set(o, c));
      a.obj.traverse((o) => { if (!m.has(o)) m.set(o, o.isSkinnedMesh ? 'actor-body' : 'actor-other'); });
      mark(a.hand, 'actor-weapon'); mark(a.weaponMesh, 'actor-weapon');
      mark(a.nameTag, 'actor-nametag'); mark(a.chute, 'actor-chute');
    }
    return m;
  };
  const top = (o) => { let p = o; while (p && p.parent && p.parent !== W.scene) p = p.parent; return (p && p.parent === W.scene) ? (p.name || p.type) : 'other'; };
  const catOf = (o) => {
    const c = FC.cat && FC.cat.get(o);
    if (c) return c;
    const nm = (o.name || '') + ' ' + ((o.parent && o.parent.name) || '');
    if (/chute|canopy|parachute/i.test(nm)) return 'actor-chute';
    if (/name-?tag/i.test(nm)) return 'actor-nametag';
    return top(o);
  };
  const actorOf = new Map();
  const rbd = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (FC.attr) {
      const pass = scene === null ? 'shadow' : scene === W.scene ? 'main' : 'post';
      const key = pass + ':' + catOf(object) + (object.isSkinnedMesh ? '[skinned]' : object.isInstancedMesh ? '[inst]' : '');
      const n = geometry.index ? geometry.index.count : (geometry.attributes.position ? geometry.attributes.position.count : 0);
      const inst = object.isInstancedMesh ? object.count : 1;
      const tris = object.isMesh || object.isSkinnedMesh ? Math.round(n / 3) * inst : 0;
      const e = FC.attr[key] || (FC.attr[key] = [0, 0]);
      e[0]++; e[1] += tris;
      if (pass === 'main' && object.isSkinnedMesh) {
        const a = FC.actorByObj && FC.actorByObj.get(object);
        if (a) FC.skinByActor[a] = (FC.skinByActor[a] || 0) + tris;
      }
    }
    return rbd(camera, scene, geometry, material, object, group);
  };
  P.onBeforeRender = () => {
    r.info.reset();
    FC.p0 = r.info.programs ? r.info.programs.length : 0;
    FC.g0 = r.info.memory.geometries;
    if (FC.want) {
      FC.attr = {}; FC.skinByActor = {}; FC.cat = catMap();
      FC.actorByObj = new Map();
      for (const a of W.actors) if (a.obj) a.obj.traverse((o) => { if (o.isSkinnedMesh) FC.actorByObj.set(o, a.id); });
    }
    FC.t0 = performance.now();
  };
  P.onAfterRender = () => {
    const p1 = r.info.programs ? r.info.programs.length : 0;
    const row = { i: P.frames, calls: r.info.render.calls, tris: r.info.render.triangles, programs: p1, newPrograms: p1 - FC.p0,
                  geometries: r.info.memory.geometries, textures: r.info.memory.textures, renderMs: +(performance.now() - FC.t0).toFixed(1),
                  phase: W.phase, t: +(W.t || 0).toFixed(2) };
    if (FC.attr) { row.attr = FC.attr; row.skinByActor = FC.skinByActor; FC.attr = null; FC.want = false; FC.cat = null; FC.actorByObj = null; }
    FC.log.push(row); FC.last = row;
  };
  FC.log = [];
  return 'ok';
}"""

STUB_DRAWS_JS = r"""() => { const gl = window.__LC__.W.kernel.renderer.getContext(); if (gl.__hStub) return 'already';
  for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) if (gl[fn]) gl[fn] = function () {};
  gl.__hStub = true; return 'stubbed'; }"""

ENV_JS = r"""() => {
  const W = window.__LC__.W, r = W.kernel.renderer, gl = r.getContext();
  const s = new W.THREE.Vector2(); r.getDrawingBufferSize(s);
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { dpr: window.devicePixelRatio, rendererPR: r.getPixelRatio(), buffer: [s.x, s.y],
           gpu: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
           programs: r.info.programs ? r.info.programs.length : 0, graphics: W.settings.graphics,
           shadows: r.shadowMap.enabled, shadowMapSize: W.kernel.sun && W.kernel.sun.shadow ? W.kernel.sun.shadow.mapSize.x : null,
           composerPasses: W.kernel.composer ? W.kernel.composer.passes.map((p) => p.constructor.name + (p.enabled ? '' : '(off)')) : null,
           nativeStepFrames: typeof window.__LC__.stepFrames === 'function', prof: typeof window.__LC__.prof === 'function' };
}"""

# the drop cluster (characters-art charprobe5 SCEN, air = true): every live actor except the camera focus is moved into a
# phyllotaxis disc of radius 12 m, 22 m ahead of the camera and 4 m below it, name tags and weapons visible as update()
# shows them in range; ONE rendered frame is attributed; everything is restored in the same evaluate.
CLUSTER_JS = r"""() => {
  const W = window.__LC__.W, THREE = W.THREE, P = window.__H_PUMP__, FC = window.__FC__;
  const cam = W.camera; cam.updateMatrixWorld();
  const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const c = cam.position.clone().addScaledVector(fwd, 22);
  const live = W.actors.filter((a) => a.alive && a.rig && a !== W._camFocus && a !== W.player);
  const saved = live.map((a) => [a.obj.position.clone(), a.nameTag ? a.nameTag.visible : null, a.weaponMesh ? a.weaponMesh.visible : null]);
  live.forEach((a, i) => { const ang = i * 2.39996, rr = 12 * Math.sqrt((i + 0.5) / live.length);
    a.obj.position.set(c.x + Math.cos(ang) * rr, cam.position.y - 4 + (i % 5) * 0.6, c.z + Math.sin(ang) * rr); a.obj.updateMatrixWorld(true); });
  for (const a of live) { if (a.nameTag) a.nameTag.visible = true; if (a.weaponMesh) a.weaponMesh.visible = true; }
  FC.want = true;
  P.onBeforeRender(); const k = W.kernel; if (k.composer) k.composer.render(1 / 60); else k.renderer.render(k.scene, k.camera); P.onAfterRender();
  const row = FC.last;
  live.forEach((a, i) => { a.obj.position.copy(saved[i][0]); if (a.nameTag) a.nameTag.visible = saved[i][1]; if (a.weaponMesh) a.weaponMesh.visible = saved[i][2]; a.obj.updateMatrixWorld(true); });
  return { n: live.length, chutes: live.filter((a) => !!(a.chute && a.chute.visible !== false && a.chute.deployed !== false && a.chute.active !== false)).length, row };
}"""

# weapon view-models (VERIFY.md #25): weapons.js builds its protos asynchronously and refreshWeaponMesh awaits them, so with
# the 15k-tri bodies the guns can pop in seconds into the drop (L2: 3.6-10.2 s). Every actor-weapon measurement first awaits
# W.weaponProto('pistol') - the same promise every pending refreshWeaponMesh awaits, so by the time it resolves for us their
# continuations (registered earlier) have attached the meshes.
WPN_STATE_JS = r"""() => { const W = window.__LC__.W; const live = W.actors.filter((a) => a.alive);
  return { protosReady: !!W._weaponProtos, liveActors: live.length, withWeaponMesh: live.filter((a) => a.weaponMesh).length,
           withHand: live.filter((a) => a.hand).length, weaponProtoApi: typeof W.weaponProto === 'function' }; }"""
WPN_AWAIT_JS = r"""async () => { const W = window.__LC__.W; const t0 = performance.now();
  if (typeof W.weaponProto !== 'function') return { awaited: false, why: 'no W.weaponProto' };
  let ok = true; try { await W.weaponProto('pistol'); } catch (e) { ok = String(e); }
  await new Promise((r) => setTimeout(r, 0));
  const live = W.actors.filter((a) => a.alive);
  return { awaited: true, ok, waitedMs: Math.round(performance.now() - t0), protosReady: !!W._weaponProtos,
           liveActors: live.length, withWeaponMesh: live.filter((a) => a.weaponMesh).length, withHand: live.filter((a) => a.hand).length }; }"""

CADENCE_JS = r"""async () => {
  const C = window.__LC__, W = C.W;
  const el = [...document.querySelectorAll('script[type=module]')].find((s) => /ffg_boot3d/.test(s.src));
  const V = el ? new URL(el.src).search : '';
  const base = new URL('runtime/3d/royale/weapons.js', location.href.replace(/[^/]*$/, '')).href;
  const wm = await import(base + V);
  const a = W.player;
  let shots = 0;
  W.events.on('shotFired', (who) => { if (who === a && window.__H_CAD_ON__) shots++; });
  window.__H_CAD_ON__ = true;
  const save = { alive: a.alive, weapon: a.weapon, slot0: a.inventory.slots[0], active: a.inventory.active, ammo: a.inventory.ammo, gliding: a.gliding };
  const run = (wid, h) => {
    a.alive = true; a.weapon = { id: wid, rarity: 0, magAmmo: 1e9, state: 'ready', cd: 0, reloadT: 0 };
    a.inventory.slots[0] = { kind: 'weapon', id: wid, rarity: 0, mag: 1e9 }; a.inventory.active = 0;
    a.gliding = false; a.healing = null; a.swimming = false; a.mantleT = null;
    a.inventory.ammo = { light: 1e9, medium: 1e9, shells: 1e9, heavy: 1e9, grenades: 1e9 };
    shots = 0; let t = 0;
    while (t < 10) { const dt = Math.min(0.05, h); a.input.fire = true; a.input.slot = -1; a.input.reload = false; wm.update(W, dt); t += dt; }
    a.input.fire = false;
    return shots * 6;
  };
  const res = {};
  for (const wid of ['smg']) { res[wid] = {}; for (const hz of [165, 144, 120, 75, 60, 50, 30, 20]) res[wid][hz + 'Hz'] = run(wid, 1 / hz); }
  window.__H_CAD_ON__ = false;
  Object.assign(a, { alive: save.alive, weapon: save.weapon, gliding: save.gliding }); a.inventory.slots[0] = save.slot0; a.inventory.active = save.active; a.inventory.ammo = save.ammo;
  return res;
}"""


def metrics(cdp):
    return {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}


# ---- forced layouts (Wave-3 H-harness) ------------------------------------------------------------------------------
# CDP LayoutCount counts EVERY layout, including the browser's own rendering-lifecycle layout that runs after each
# page.evaluate returns when the HUD dirtied the DOM. Wave-3 probe (scratch wave3/H-harness/layoutprobe.py): LayoutCount
# scaled with the number of evaluates, not frames (drop 240 frames in 1 / 4 / 24 evaluates -> 2 / 4 / 12 layouts), and a
# stack-traced Chrome trace showed 0 of 14 Layout events with a JS stack - so Wave-2's "0.01 / 0.02 forced layouts per
# frame" were lifecycle layouts at this harness's chunk boundaries. A FORCED layout is a Layout trace event that carries a
# JS stack (beginData.stackTrace with disabled-by-default-devtools.timeline.stack): script asked for geometry while layout
# was dirty. That is what the gate counts now, with the call site; CDP LayoutCount stays as information.
TRACE_CATS = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack"]

# --plant forced-layout (falsifier): a kernel updater that writes a style and then reads offsetWidth on every frame
PLANT_FORCED_JS = r"""() => { const k = window.__LC__.W.kernel; if (window.__H_PLANT_FL__) return 'already';
  const el = document.createElement('div'); el.id = '__h_plant_fl';
  el.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;pointer-events:none'; document.body.appendChild(el); let i = 0;
  window.__H_PLANT_FL__ = function hPlantForcedLayout() { el.style.width = (10 + (i++ % 2)) + 'px'; return el.offsetWidth; };
  k._updaters.push(window.__H_PLANT_FL__); return 'planted: kernel updater hPlantForcedLayout (style write + offsetWidth read every frame)'; }"""


def _site(fr):
    # the timeline stack's lineNumber/columnNumber are 1-based here (probe: the trace and Error().stack both gave
    # ffg_kernel_3d.js:738:37 for the same frame)
    url = (fr.get("url") or "").split("/games/last-circle/")[-1].split("?")[0] or "(eval)"
    return "%s %s:%s:%s" % (fr.get("functionName") or "(anon)", url, fr.get("lineNumber"), fr.get("columnNumber"))


def classify_trace(raw):
    """Layout / UpdateLayoutTree events on the renderer main thread -> forced (with a JS stack) vs lifecycle, with sites."""
    tr = json.loads(raw)
    evs = tr["traceEvents"] if isinstance(tr, dict) else tr
    main = {(e["pid"], e["tid"]) for e in evs if e.get("ph") == "M" and e.get("name") == "thread_name"
            and (e.get("args") or {}).get("name") == "CrRendererMain"}
    out = {"forcedLayouts": 0, "lifecycleLayouts": 0, "forcedStyle": 0, "sites": {}}
    for e in evs:
        if (e.get("pid"), e.get("tid")) not in main or e.get("name") not in ("Layout", "UpdateLayoutTree") or e.get("ph") not in ("X", "B"):
            continue
        a = e.get("args") or {}
        st = (a.get("beginData") or {}).get("stackTrace") or (a.get("data") or {}).get("stackTrace") or []
        if e["name"] == "Layout":
            if st:
                out["forcedLayouts"] += 1
                key = " <- ".join(_site(f) for f in st[:3])
                out["sites"][key] = out["sites"].get(key, 0) + 1
            else:
                out["lifecycleLayouts"] += 1
        elif st:
            out["forcedStyle"] += 1
    out["sites"] = sorted(out["sites"].items(), key=lambda kv: -kv[1])[:8]
    return out


def forced_layout_window(s, cdp, n, chunk=60):
    """Pump n frames (no render) under a stack-traced Chrome trace. Returns counts per frame + the forcing call sites, or
    {'error': ...} when tracing is unavailable (the caller reports could-not-judge)."""
    m0 = metrics(cdp)
    try:
        s.browser.start_tracing(page=s.page, categories=TRACE_CATS)
    except Exception as e:
        return {"error": "tracing did not start: %s" % str(e).splitlines()[0][:200]}
    try:
        s.step_frames(n, 1 / 60, render=False, chunk=chunk)
    finally:
        raw = s.browser.stop_tracing()
    m1 = metrics(cdp)
    c = classify_trace(raw)
    return {"frames": n, "evaluates": -(-n // chunk), "forcedLayouts": c["forcedLayouts"],
            "forcedLayoutsPerFrame": round(c["forcedLayouts"] / n, 3), "forcedStyleRecalcs": c["forcedStyle"],
            "lifecycleLayouts(info)": c["lifecycleLayouts"], "cdpLayoutCount(info)": int(m1["LayoutCount"] - m0["LayoutCount"]),
            "cdpLayoutsPerFrame(info, incl. lifecycle)": round((m1["LayoutCount"] - m0["LayoutCount"]) / n, 3),
            "forcingSites": c["sites"], "traceKB": len(raw) // 1024}


def mdelta(m0, m1, nf):
    return {"frames": nf,
            "cdpLayoutsPerFrame": round((m1["LayoutCount"] - m0["LayoutCount"]) / nf, 3),     # incl. lifecycle layouts
            "styleRecalcsPerFrame": round((m1["RecalcStyleCount"] - m0["RecalcStyleCount"]) / nf, 2),
            "layoutMsPerFrame": round((m1["LayoutDuration"] - m0["LayoutDuration"]) * 1000 / nf, 3)}


def attr_sum(attr, pred, idx):
    return sum(v[idx] for k, v in (attr or {}).items() if pred(k))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--every", type=int, default=30, help="render every Nth pumped frame")
    ap.add_argument("--real-draws", action="store_true")
    ap.add_argument("--skip", default="", help="comma list of sections to skip: shadow,space,cluster,layout,alloc,qc,cadence,match")
    ap.add_argument("--plant", default=None, choices=["forced-layout"],
                    help="FALSIFIER: a kernel updater forces a layout every frame; both forced-layout rows MUST fail (the plant run "
                         "judges only those rows - every other section is skipped or reported as information)")
    args = ap.parse_args()
    skip = {x.strip() for x in args.skip.split(",") if x.strip()}
    if args.plant:
        skip |= {"shadow", "space", "cluster", "alloc", "qc", "cadence", "match"}
        if not args.report:
            args.report = "framecheck_plant_" + args.plant.replace("-", "_")

    def body(v):
        if args.plant:
            _check = v.check
            judged = ("forced layouts", "game threw", "harness exception", "environment", "interrupted")
            v.check = lambda name, ok, detail="", expect=None: (
                _check(name, ok, detail, expect) if any(j in name for j in judged) else v.info("[plant run, not judged] " + name, detail))
        with C.Session(args, "framecheck") as s:
            s.boot()
            s.freeze_loop()
            s.install_pump()
            v.info("pump", {"nativeStepFrames": s.safe_js("() => typeof window.__LC__.stepFrames === 'function'")})
            if not args.real_draws:
                v.info("gl draws", s.js(STUB_DRAWS_JS))
            s.js(ATTR_JS)
            v.data["envMenu"] = s.js(ENV_JS)
            v.info("env", v.data["envMenu"])
            cdp = s.cdp()
            cdp.send("Performance.enable")
            p_before = s.js("() => window.__LC__.W.kernel.renderer.info.programs.length")
            sm = s.start_match("standard", args.seed, args.map, enter=True)
            v.info("startMatch", sm)
            p_after = s.js("() => window.__LC__.W.kernel.renderer.info.programs.length")
            v.info("programs before/after startMatch (the warm-up's work)", [p_before, p_after])
            # ---- drop frame 1 (the first rendered frame of the drop)
            s.js("() => { window.__FC__.want = true; }")
            s.step_frames(1, 1 / 60, render=True)
            f1 = s.js("() => window.__FC__.last")
            v.data["dropFrame1"] = f1
            att = f1.get("attr") or {}
            sh_act = attr_sum(att, lambda k: k.startswith("shadow:actor"), 1)
            v.check("drop frame 1: new programs == 0", f1["newPrograms"] == 0, {"newPrograms": f1["newPrograms"], "renderMs(info)": f1["renderMs"]},
                    expect="0 (was 27)")
            v.check("drop frame 1: total tris < 1.5 M", f1["tris"] < 1_500_000, {"tris": f1["tris"], "calls": f1["calls"]}, expect="< 1.5 M (was 9.91 M)")
            v.check("drop frame 1: shadow:actor* tris < 0.5 M", sh_act < 500_000, {"shadowActorTris": sh_act}, expect="< 0.5 M (was 8.57 M)")
            print("    drop frame 1 attribution: %s" % sorted(att.items(), key=lambda kv: -kv[1][1])[:10], flush=True)
            v.info("weapon view-models at drop frame 1 (information; L4 item 7 preloads them before the lobby)",
                   s.js(WPN_STATE_JS))
            # ---- drop window shadow share (PLAN L4 b gate, measured in lc_liveprobe as 60-80 %): 6 CONSECUTIVE rendered
            # drop frames with attribution (a shadow refresh every 3rd frame is covered twice); total tris include the
            # shadow passes (renderer.info is reset once per frame, autoReset off)
            if "shadow" not in skip:
                sh_rows = []
                for _ in range(6):
                    s.js("() => { window.__FC__.want = true; }")
                    s.step_frames(1, 1 / 60, render=True)
                    r6 = s.js("() => window.__FC__.last")
                    a6 = r6.get("attr") or {}
                    sh_rows.append({"t": r6.get("t"), "tris": r6.get("tris"), "shadowTris": attr_sum(a6, lambda k: k.startswith("shadow:"), 1),
                                    "shadowCalls": attr_sum(a6, lambda k: k.startswith("shadow:"), 0),
                                    "shadowMapTris": attr_sum(a6, lambda k: k.startswith("shadow:") and not k.startswith("shadow:actor"), 1)})
                tot = sum(x["tris"] or 0 for x in sh_rows)
                sht = sum(x["shadowTris"] for x in sh_rows)
                share = round(100.0 * sht / tot, 1) if tot else None
                v.data["dropShadowWindow"] = sh_rows
                v.check("drop window: shadow share of tris < 30 % (6 consecutive drop frames)", share is not None and share < 30,
                        {"sharePct": share, "shadowTris": sht, "tris": tot, "frames": sh_rows}, expect="< 30 % (was 60-80 %, L4 b)")
                v.check("drop window: the shadow pass still draws world casters (ground stays shadowed)",
                        any(x["shadowMapTris"] > 0 for x in sh_rows), {"worldCasterTrisPerFrame": [x["shadowMapTris"] for x in sh_rows]},
                        expect="> 0 on at least 1 of 6 frames (L4 b must not buy the share by dropping the ground shadows)")
                s.step_frames(23, 1 / 60, render=args.every)
            else:
                s.step_frames(29, 1 / 60, render=args.every)
            # ---- 10 real SPACE toggles while gliding high
            if "space" not in skip:
                geo = []
                pl = s.js("() => { const p = window.__LC__.W.player; const a = p; return { gliding: p.gliding, chute: !!(a.chute && a.chute.visible !== false && a.chute.deployed !== false && a.chute.active !== false), y: +p.pos.y.toFixed(1) }; }")
                for i in range(10):
                    s.press("Space", 0.05)
                    s.step_frames(12, 1 / 60, render=12)
                    geo.append(s.js("() => ({ g: window.__LC__.W.kernel.renderer.info.memory.geometries, chute: ((a) => !!(a.chute && a.chute.visible !== false && a.chute.deployed !== false && a.chute.active !== false))(window.__LC__.W.player), gliding: window.__LC__.W.player.gliding })"))
                gs = [x["g"] for x in geo]
                toggled = len({x["chute"] for x in geo}) > 1
                if not pl.get("gliding") or not toggled:
                    v.cnj("10 SPACE toggles: geometries flat", "the player was not gliding / the chute never toggled (%s, %s)" % (pl, geo[:3]))
                else:
                    v.check("10 SPACE toggles: GPU geometries flat after the first pair", max(gs[2:]) - min(gs[2:]) == 0 and gs[-1] <= gs[1],
                            {"geometriesAfterEachToggle": gs, "chuteStates": [x["chute"] for x in geo], "startState": pl}, expect="flat (L5 e)")
            # ---- drop cluster
            if "cluster" not in skip:
                # the characters-art cluster was measured 10 s into the drop, when the bots' canopies are out
                for _ in range(8):
                    if (s.safe_js("() => window.__LC__.W.t", default=0) or 0) >= 10 or s.phase() != "drop":
                        break
                    s.step_frames(120, 1 / 60, render=args.every)
                wa = s.js(WPN_AWAIT_JS)
                v.data["weaponsBeforeCluster"] = wa
                v.info("weapon view-models awaited before the drop cluster (VERIFY.md #25)", wa)
                s.step_frames(2, 1 / 60, render=False)
                cl = s.js(CLUSTER_JS)
                row = cl["row"]
                att = row.get("attr") or {}
                v.data["dropCluster"] = cl
                chute_calls = attr_sum(att, lambda k: ":actor-chute" in k and k.startswith("main"), 0)
                tag_calls = attr_sum(att, lambda k: ":actor-nametag" in k and k.startswith("main"), 0)
                v.check("drop cluster: draw calls <= 250", row["calls"] <= 250, {"calls": row["calls"], "tris": row["tris"], "actors": cl["n"], "chutes": cl["chutes"]},
                        expect="<= 250 (was 482)")
                if cl["chutes"] < 10:
                    v.cnj("drop cluster: actor-chute calls <= 2", "only %d canopies were out at t=%s (need >= 10 to judge)" % (cl["chutes"], row.get("t")))
                else:
                    v.check("drop cluster: actor-chute calls <= 2", chute_calls <= 2, {"chuteCalls": chute_calls, "chutesOut": cl["chutes"]}, expect="<= 2 (was 200)")
                v.check("drop cluster: actor-nametag calls <= 1", tag_calls <= 1, {"nametagCalls": tag_calls}, expect="1 (was 49)")
                v.info("drop cluster: actor-weapon calls / tris (main pass)", {
                    "calls": attr_sum(att, lambda k: ":actor-weapon" in k and k.startswith("main"), 0),
                    "tris": attr_sum(att, lambda k: ":actor-weapon" in k and k.startswith("main"), 1),
                    "actorsWithWeaponMesh": (wa or {}).get("withWeaponMesh")})
                sk = row.get("skinByActor") or {}
                mx = max(sk.values()) if sk else None
                v.check("skinned tris per visible actor < 30 k", mx is not None and mx < 30_000,
                        {"maxPerActor": mx, "actorsDrawn": len(sk), "median": sorted(sk.values())[len(sk) // 2] if sk else None}, expect="< 30 k (bodies 245-632 k)")
                if row.get("newPrograms"):
                    v.info("drop cluster frame compiled programs", row["newPrograms"])
                print("    drop cluster attribution: %s" % sorted(att.items(), key=lambda kv: -kv[1][0])[:12], flush=True)
            if args.plant == "forced-layout":
                v.note("PLANTED FAULT: " + s.js(PLANT_FORCED_JS) + " - both forced-layout rows MUST fail")
            # ---- forced layouts per drop frame (no render: pure CPU window), counted from a stack-traced Chrome trace
            if "layout" not in skip:
                ld = forced_layout_window(s, cdp, 240)
                v.data["layoutDrop"] = ld
                if "error" in ld:
                    v.cnj("forced layouts per drop frame == 0.00 (trace: Layout events with a JS stack)", ld["error"])
                else:
                    v.check("forced layouts per drop frame == 0.00 (trace: Layout events with a JS stack)", ld["forcedLayouts"] == 0, ld,
                            expect="0.00 (was 1.00)")
            # ---- to the ground
            t0 = time.time()
            for _ in range(12):
                if s.phase() == "match":
                    break
                s.step_frames(240, 1 / 60, render=args.every)
            ph = s.phase()
            v.info("drop -> match", {"phase": ph, "wall_s": round(time.time() - t0, 1), "t": s.safe_js("() => window.__LC__.W.t")})
            if ph != "match":
                s.land(90)
                s.step_frames(30, 1 / 60, render=30)
            # ---- match frames
            if "match" not in skip:
                v.data["weaponsBeforeMatchFrame"] = s.js(WPN_AWAIT_JS)
                s.js("() => { const M = window.__LC__.W.map, q = M.queryColliders; window.__QC__ = 0; if (!M.__hqc) { M.__hqc = true; M.queryColliders = function () { window.__QC__++; return q.apply(this, arguments); }; } }")
                n0 = s.js("() => window.__FC__.log.length")
                s.step_frames(299, 1 / 60, render=args.every)
                s.js("() => { window.__FC__.want = true; }")
                s.step_frames(1, 1 / 60, render=True)
                qc = s.js("() => +(window.__QC__ / 300).toFixed(1)")
                fm = s.js("() => window.__FC__.last")
                v.data["matchFrame"] = fm
                v.check("match frame: total tris < 5 M", fm["tris"] < 5_000_000, {"tris": fm["tris"], "calls": fm["calls"]}, expect="< 5 M (was 16.5 M)")
                if "qc" not in skip:
                    v.check("queryColliders calls per match frame <= 150", qc <= 150, {"perFrame": qc}, expect="well below 423 (harness reads <= 150)")
                rows = s.js("(n0) => window.__FC__.log.slice(n0).map((r) => [r.i, r.newPrograms, r.phase])", n0)
                print("    match frame attribution: %s" % sorted((fm.get("attr") or {}).items(), key=lambda kv: -kv[1][1])[:10], flush=True)
            # sampled frames after drop frame 1 must compile nothing
            logrows = s.js("() => window.__FC__.log.map((r) => ({ i: r.i, n: r.newPrograms, phase: r.phase, t: r.t, calls: r.calls }))")
            later = [r for r in logrows[1:] if r["n"] > 0]
            v.check("sampled drop/match frames after frame 1: new programs == 0", not later,
                    {"framesWithNewPrograms": later[:10], "sampled": len(logrows) - 1}, expect="0 on every sampled frame")
            # ---- forced layouts + allocation per match frame
            if "layout" not in skip or "alloc" not in skip:
                cdp.send("HeapProfiler.enable")
                cdp.send("HeapProfiler.startSampling", {"samplingInterval": 4096, "includeObjectsCollectedByMajorGC": True,
                                                       "includeObjectsCollectedByMinorGC": True})
                m0 = metrics(cdp)
                s.step_frames(600, 1 / 60, render=False)
                m1 = metrics(cdp)
                prof = cdp.send("HeapProfiler.stopSampling")["profile"]
                lm = mdelta(m0, m1, 600)
                v.data["layoutMatch"] = lm
                agg, by_file = {}, {}

                def walk(n):
                    cf = n["callFrame"]
                    f = cf.get("url", "").split("/")[-1].split("?")[0]
                    key = "%s %s:%d" % (cf.get("functionName") or "(anon)", f, cf.get("lineNumber", -1) + 1)
                    if n.get("selfSize", 0):
                        agg[key] = agg.get(key, 0) + n["selfSize"]
                        by_file[f or "(native)"] = by_file.get(f or "(native)", 0) + n["selfSize"]
                    for ch in n.get("children", []):
                        walk(ch)
                walk(prof["head"])
                kbpf = round(sum(agg.values()) / 1024 / 600, 1)
                v.data["allocTopSites"] = [[k, round(x / 1024)] for k, x in sorted(agg.items(), key=lambda kv: -kv[1])[:30]]
                v.data["allocByFile"] = [[k, round(x / 1024)] for k, x in sorted(by_file.items(), key=lambda kv: -kv[1])[:15]]
                if "layout" not in skip:
                    # the alloc window's CDP count (lifecycle layouts included) is information; the gate is a separate,
                    # stack-traced 600-frame window (tracing is kept out of the heap-sampling window)
                    v.info("CDP LayoutCount per match frame (includes the browser's lifecycle layouts at the 10 evaluate boundaries)", lm)
                    lt = forced_layout_window(s, cdp, 600)
                    v.data["layoutMatchTrace"] = lt
                    if "error" in lt:
                        v.cnj("forced layouts per match frame == 0.00 (trace: Layout events with a JS stack)", lt["error"])
                    else:
                        v.check("forced layouts per match frame == 0.00 (trace: Layout events with a JS stack)", lt["forcedLayouts"] == 0, lt,
                                expect="0.00 (was 0.15)")
                if "alloc" not in skip:
                    v.check("KB allocated per match frame < 100", kbpf < 100, {"KBperFrame": kbpf, "topFiles": v.data["allocByFile"][:6]},
                            expect="< 100 (was 554.5)")
            if "cadence" not in skip:
                try:
                    cad = s.js(CADENCE_JS)
                    smg = cad.get("smg", {})
                    bad = {hz: rpm for hz, rpm in smg.items() if abs(rpm - 720) > 6}
                    v.check("SMG cadence 720 +-6 rpm at 20..165 Hz", not bad and bool(smg), smg, expect="720 +-6 (was 600 at 60 Hz)")
                except Exception as e:
                    v.cnj("SMG cadence", "probe failed: %s" % str(e).splitlines()[0][:200])
            d = s.diagnostics()
            v.check("no page / window errors while pumping", not (d["pageErrors"] or d["windowErrors"]),
                    {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})
            v.data["frameLog"] = s.js("() => window.__FC__.log.map((r) => { const o = Object.assign({}, r); delete o.attr; delete o.skinByActor; return o; })")
    return C.run_gate("framecheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
