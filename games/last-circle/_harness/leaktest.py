#!/usr/bin/env python
"""leaktest - match-over-match GPU resource growth + the Stage-0 per-group TEXTURE CENSUS (PLAN section 2 item 2).

    python _harness/leaktest.py                       # 3 matches on ashgrid, seed 4242 (the PLAN's `3 ashgrid`)
    python _harness/leaktest.py --matches 3 --map ashgrid --disk

Promoted from _spec/improve_2026-09/baseline/leaktest.py. One page, K back-to-back matches on the SAME map and seed,
started through __LC__.startMatch (what PLAY AGAIN calls; the real button picks a random map, which would hide a leak
behind a different map's texture set). Each match: lobby shown -> real Enter -> fastForward slices to the end with
harness-stepped RENDERED frames in between (textures are uploaded on first draw, so the view must draw what a player
would see; draws are stubbed at the GL call by default so the shared iGPU is not asked to raster - uploads, programs
and every renderer.info counter are unaffected; --real-draws turns that off).

Snapshots at the SAME two points of every match: the lobby (after 2 rendered frames) and the match end.

TEXTURE CENSUS (installed on the menu, before match 1):
  * every THREE.Texture that reaches renderer.properties.get() is recorded (that is the path every upload and every
    render-target setup takes), together with the stack of its FIRST needsUpdate = true (= where it was created:
    new CanvasTexture / texture.clone() / the GLTF parser) and the match "epoch" it was created in (0 = menu);
  * a texture is LIVE on the GPU while renderer.properties still holds it with __webglInit / __webglTexture set
    (three removes it on dispose), counted once per Source like info.memory.textures;
  * the OWNER of a texture is the first runtime/ frame of its creation stack (e.g. royale/player.js:554); GLB textures
    (created asynchronously inside GLTFLoader) are named by the kernel cache URL that holds them; render targets by the
    runtime frame that first drew into them;
  * REACHABILITY: textures referenced from the scene (per top-level group), the kernel GLB caches or the composer are
    marked; everything else is "unreachable" (a module-private cache OR a leak - the per-match growth decides).
Output: owner file per texture group with its unique-source count at every lobby, the growth per match, and the lane
that owns the file (PLAN section 3), so each lane knows which textures its disposeMatch(W) must free.

GATE (PLAN L4): textures at the m2 and m3 lobby within +-5 of m1. Exit 0 / 1 / 2 (could not judge).
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

LANE_OF = {
    "3d/royale/maps.js": "L6", "3d/royale/loot.js": "L6", "3d/royale/weapons.js": "L6", "3d/royale/bots.js": "L6",
    "sim/royale.js": "L6", "3d/royale/player.js": "L5", "3d/royale/rig_pipeline.js": "L5", "3d/royale/nametags.js": "L5",
    "3d/royale/hud.js": "L7", "3d/royale/fx.js": "L7", "3d/royale/audio.js": "L8", "3d/ffg_royale3d.js": "L4",
    "3d/ffg_kernel_3d.js": "L3", "3d/ffg_warmup.js": "L3", "3d/ffg_frameprof.js": "L3", "3d/royale/touch.js": "L10",
    "3d/royale/storm.js": "UNOWNED (storm.js is 'untouched' in PLAN section 3)", "3d/royale/pose.js": "UNOWNED (pose.js untouched)",
    "3d/royale/net.js": "L9",
}

CENSUS_INSTALL_JS = r"""() => {
  const W = window.__LC__.W, THREE = W.THREE, r = W.kernel.renderer, props = r.properties;
  if (window.__TC__) return 'already';
  if (!THREE || !THREE.Texture || !props || typeof props.get !== 'function' || typeof props.has !== 'function') return 'unsupported';
  const TC = window.__TC__ = { seen: new Set(), born: new WeakMap(), firstUse: new WeakMap(), epoch: new WeakMap() };
  window.__H_EPOCH__ = window.__H_EPOCH__ || 0;
  const cap = () => { const L = Error.stackTraceLimit; Error.stackTraceLimit = 40; const s = new Error().stack; Error.stackTraceLimit = L; return s; };
  const d = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', { configurable: true, get: d.get, set(v) {
    if (v === true && !TC.born.has(this)) { TC.born.set(this, cap()); if (!TC.epoch.has(this)) TC.epoch.set(this, window.__H_EPOCH__); }
    return d.set.call(this, v);
  } });
  const g = props.get;
  props.get = function (o) {
    if (o && o.isTexture && !TC.seen.has(o)) { TC.seen.add(o); TC.firstUse.set(o, cap()); if (!TC.epoch.has(o)) TC.epoch.set(o, window.__H_EPOCH__); }
    return g.call(this, o);
  };
  // Skeleton bone textures (DataTexture 4..64 px, RGBA float) are created lazily by WebGLRenderer at the first draw of a
  // skinned mesh (three Skeleton.computeBoneTexture), so their creation stack names only the render call. Tag each one
  // with the stack of the Skeleton's construction instead (SkeletonUtils.clone <- kernel.loadCharacter <- the module
  // that spawned the actor): that module owns the actor and must call skeleton.dispose() when it drops it.
  let skel = 'no THREE.Skeleton';
  if (THREE.Skeleton && THREE.Skeleton.prototype && typeof THREE.Skeleton.prototype.computeBoneTexture === 'function') {
    const SP = THREE.Skeleton.prototype, init0 = SP.init, cbt = SP.computeBoneTexture;
    if (typeof init0 === 'function') SP.init = function () { try { if (!this.__hBorn) this.__hBorn = cap(); } catch (_) {} return init0.apply(this, arguments); };
    SP.computeBoneTexture = function () { const r = cbt.apply(this, arguments);
      try { if (this.boneTexture) { this.boneTexture.__hSkel = this.__hBorn || 'unknown'; this.boneTexture.__hBones = this.bones.length; } } catch (_) {}
      return r; };
    skel = 'skeleton hooks ok';
  }
  TC.skel = skel;
  return 'ok';
}"""

CENSUS_JS = r"""(tag) => {
  const W = window.__LC__.W, k = W.kernel, r = k.renderer, props = r.properties, TC = window.__TC__;
  const reach = new Map();
  const add = (t, where) => { if (t && t.isTexture && !reach.has(t)) reach.set(t, where); };
  const mats = (o) => o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
  const scanMat = (m, where) => {
    if (!m) return;
    for (const key in m) { const v = m[key]; if (v && v.isTexture) add(v, where); }
    if (m.uniforms) for (const u in m.uniforms) { const v = m.uniforms[u] && m.uniforms[u].value;
      if (v && v.isTexture) add(v, where); else if (Array.isArray(v)) for (const x of v) if (x && x.isTexture) add(x, where); }
  };
  const scanObj = (root, where) => { if (!root || !root.traverse) return; root.traverse((o) => {
    for (const m of mats(o)) scanMat(m, where);
    if (o.isLight && o.shadow && o.shadow.map) add(o.shadow.map.texture, where + ':shadowmap');
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.boneTexture) add(o.skeleton.boneTexture, where + ':skeleton');
  }); };
  for (const c of W.scene.children) scanObj(c, 'scene:' + (c.name || c.type));
  if (W.scene.background && W.scene.background.isTexture) add(W.scene.background, 'scene:background');
  if (W.scene.environment && W.scene.environment.isTexture) add(W.scene.environment, 'scene:environment');
  const glbOf = new Map();
  for (const cn of ['_gltfCache', '_charCache']) {
    const c = k[cn]; if (!c) continue;
    for (const url in c) {
      const v = c[url]; const roots = [];
      if (v && v.isObject3D) roots.push(v); if (v && v.scene) roots.push(v.scene); if (v && v.scenes) roots.push(...v.scenes);
      const short = String(url).split('/').pop().split('?')[0];
      for (const rt of roots) rt.traverse((o) => { for (const m of mats(o)) for (const key in m) { const t = m[key];
        if (t && t.isTexture) { if (!reach.has(t)) reach.set(t, 'kernel.' + cn); if (!glbOf.has(t)) glbOf.set(t, short); } } });
    }
  }
  const scanRTs = (obj, where) => { if (!obj) return; for (const key of Object.keys(obj)) { let v; try { v = obj[key]; } catch (e) { continue; } if (!v) continue;
    if (v.isWebGLRenderTarget || v.isRenderTarget) { add(v.texture, where + '.' + key); if (v.depthTexture) add(v.depthTexture, where + '.' + key + '.depth'); }
    else if (Array.isArray(v)) for (const x of v) if (x && (x.isWebGLRenderTarget || x.isRenderTarget)) add(x.texture, where + '.' + key); } };
  if (k.composer) { scanRTs(k.composer, 'composer'); (k.composer.passes || []).forEach((p, i) => scanRTs(p, 'composer.' + p.constructor.name)); }
  const RUNTIME = /\/(runtime\/[^\s)?:]+\.js)(?:\?[^\s):]*)?:(\d+):\d+/;
  const ANYJS = /\/([A-Za-z0-9_.-]+\.js)(?:\?[^\s):]*)?:(\d+):\d+/;
  const frames = (st) => st ? st.split('\n').slice(1) : [];
  const firstRuntime = (st) => { for (const line of frames(st)) { const m = line.match(RUNTIME); if (m) return m[1].replace(/^runtime\//, '') + ':' + m[2]; } return null; };
  const firstThree = (st) => { for (const line of frames(st)) { if (/runtime\/|__playwright|evaluate|<anonymous>/.test(line) && !/three/.test(line)) continue; const m = line.match(ANYJS); if (m && !/^(common|leaktest)\./.test(m[1])) return m[1] + ':' + m[2]; } return null; };
  const rows = [];
  for (const t of TC.seen) {
    if (!props.has(t)) continue;
    const p = props.get(t);
    if (!(p.__webglInit || p.__webglTexture)) continue;
    const born = TC.born.get(t) || null, fu = TC.firstUse.get(t) || null;
    let owner = null, via = 'created';
    if (t.__hSkel) {
      // requester = the first runtime frame outside the kernel (the kernel only clones what it is asked for)
      const rt = []; for (const line of frames(t.__hSkel)) { const m = line.match(RUNTIME); if (m) rt.push(m[1].replace(/^runtime\//, '') + ':' + m[2]); }
      const req = rt.find((f) => !/ffg_kernel_3d\.js/.test(f)) || null, clone = rt.find((f) => /ffg_kernel_3d\.js/.test(f)) || null;
      owner = 'Skeleton.boneTexture of skinned meshes spawned by ' + (req || clone || '?') + (req && clone ? ' (cloned at ' + clone + ')' : '');
      via = 'skeleton';
    }
    if (!owner) owner = firstRuntime(born);
    if (!owner && glbOf.has(t)) { owner = 'GLB ' + glbOf.get(t); via = 'kernel GLB cache'; }
    if (!owner) { const f = firstRuntime(fu); if (f) { owner = (t.isRenderTargetTexture ? 'render target first drawn by ' : 'first drawn by ') + f; via = 'first use'; } }
    if (!owner) { owner = 'three internal (' + (firstThree(born) || firstThree(fu) || '?') + ')'; via = 'three'; }
    const img = t.image || {};
    const kind = t.isRenderTargetTexture ? 'RT' : t.isCanvasTexture ? 'Canvas' : t.isDataTexture ? 'Data' : t.isCompressedTexture ? 'Compressed' : t.isDepthTexture ? 'Depth' : 'Image';
    rows.push({ owner, via, kind, dims: (img.width || 0) + 'x' + (img.height || 0), src: (kind === 'RT' || !t.source) ? t.uuid : t.source.uuid,
                name: t.name || '', epoch: TC.epoch.has(t) ? TC.epoch.get(t) : null, where: reach.get(t) || 'unreachable',
                glb: glbOf.get(t) || null, bornTop: born ? frames(born).slice(1, 5).map((s) => s.trim().replace(/https?:\/\/[^/]+/, '')).join(' < ') : null });
  }
  return { tag, infoTextures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs ? r.info.programs.length : null,
           phase: W.phase, epoch: window.__H_EPOCH__, recorded: TC.seen.size, rows,
           heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
           mixers: k._mixers ? k._mixers.length : null, updaters: k._updaters ? k._updaters.length : null,
           sceneObjects: (() => { let n = 0; W.scene.traverse(() => n++); return n; })(), t: +(W.t || 0).toFixed(1) };
}"""

STUB_DRAWS_JS = r"""() => { const gl = window.__LC__.W.kernel.renderer.getContext(); if (gl.__hStub) return 'already';
  for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) if (gl[fn]) gl[fn] = function () {};
  gl.__hStub = true; return 'stubbed'; }"""


def summarize_census(snaps):
    """Per owner: unique-source count at every snapshot + the reachability of the last lobby's rows."""
    tags = [s["tag"] for s in snaps]
    groups = collections.OrderedDict()
    for s in snaps:
        per = collections.defaultdict(set)
        for r in s["rows"]:
            per[r["owner"]].add(r["src"])
        for owner, srcs in per.items():
            groups.setdefault(owner, {})[s["tag"]] = len(srcs)
    return tags, groups


def lane_for(owner):
    """The lane of the FIRST runtime file named in the owner string (for a skeleton group: the spawning module)."""
    hits = sorted((owner.find(f), lane) for f, lane in LANE_OF.items() if f in owner)
    if hits:
        return hits[0][1]
    if owner.startswith("GLB "):
        return "whoever loads that GLB per match (see where)"
    if owner.startswith("three internal"):
        return "L3/L4 (renderer-level)"
    return "?"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--matches", type=int, default=3)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=4242)
    ap.add_argument("--mode", default="standard")
    ap.add_argument("--slice", type=float, default=10.0, help="fastForward seconds per slice")
    ap.add_argument("--max-slices", type=int, default=90)
    ap.add_argument("--tolerance", type=int, default=5)
    ap.add_argument("--real-draws", action="store_true", help="do not stub gl.draw* (the GPU rasters every stepped frame)")
    args = ap.parse_args()
    args.width, args.height = (1600, 900) if (args.width, args.height) == (1280, 720) else (args.width, args.height)

    def body(v):
        with C.Session(args, "leaktest") as s:
            boot = s.boot()
            v.info("boot", {"lc_s": boot})
            inst = s.js(CENSUS_INSTALL_JS)
            v.info("census hooks", {"textures": inst, "skeletons": s.safe_js("() => window.__TC__ && window.__TC__.skel")})
            if inst not in ("ok", "already"):
                v.cnj("texture census", "could not install the census hooks: %s" % inst)
            if not args.real_draws:
                v.info("gl draws", s.js(STUB_DRAWS_JS))
            s.install_pump()
            s.step_frames(2, 1 / 60, render=True)
            snaps = [s.js(CENSUS_JS, "menu")]
            print("  snapshot menu: textures %s" % snaps[-1]["infoTextures"], flush=True)
            for m in range(1, args.matches + 1):
                s.js("(m) => { window.__H_EPOCH__ = m; }", m)
                t0 = time.time()
                r = s.start_match(args.mode, args.seed, args.map, enter=False)
                s.step_frames(2, 1 / 60, render=True)
                snap = s.js(CENSUS_JS, "m%d_lobby" % m)
                snap["load_s"] = round(time.time() - t0, 1)
                snaps.append(snap)
                print("  snapshot m%d_lobby: textures %s geometries %s programs %s (load %.0f s)" % (
                    m, snap["infoTextures"], snap["geometries"], snap["programs"], snap["load_s"]), flush=True)
                s.page.keyboard.press("Enter")
                if s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 15, 0.1) is None:
                    s.page.keyboard.press("Enter")
                    s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 15, 0.1)
                s.stage("m%d" % m)
                over = False
                for i in range(args.max_slices):
                    # a game throw inside fastForward is recorded (a FAIL below) and the loop goes on, so the census
                    # still gets its three lobbies while another lane's half-landed edit is in the tree
                    st = s.js("(h) => { const L = window.__LC__; if (L.W.match && L.W.match.over) return 'over';"
                              " try { L.fastForward(h, 1 / 30); } catch (e) { (window.__H_FFERR__ = window.__H_FFERR__ || []).push(String(e && (e.stack || e)).slice(0, 600)); }"
                              " return L.W.match && L.W.match.over ? 'over' : L.W.match.aliveCount(); }", args.slice)
                    s.step_frames(3, 1 / 60, render=3)        # the view draws what the sim built (uploads happen here)
                    if st == "over":
                        over = True
                        break
                if not over:
                    v.note("match %d not over after %d slices of %g s" % (m, args.max_slices, args.slice))
                # endMatch runs inside the kernel updater: step view frames until the phase is 'over'
                for _ in range(20):
                    if s.phase() == "over":
                        break
                    s.step_frames(10, 1 / 60, render=10)
                s.sleep(3.0)          # the post-match panel is a 2.6 s setTimeout
                s.step_frames(3, 1 / 60, render=3)
                snap = s.js(CENSUS_JS, "m%d_end" % m)
                snaps.append(snap)
                print("  snapshot m%d_end: textures %s geometries %s (sim t %s, phase %s)" % (
                    m, snap["infoTextures"], snap["geometries"], snap["t"], snap["phase"]), flush=True)
            d = s.diagnostics()
            v.data["fastForwardErrors"] = s.safe_js("() => window.__H_FFERR__ || []", default=[])
        # ---------- verdict ----------
        lob = [x for x in snaps if x["tag"].endswith("_lobby")]
        tex = [x["infoTextures"] for x in lob]
        v.data["series"] = [{k: x.get(k) for k in ("tag", "infoTextures", "geometries", "programs", "heapMB", "mixers", "updaters",
                                                     "sceneObjects", "t", "phase", "load_s", "recorded")} for x in snaps]
        print("\n  tag            textures  geometries  programs  heapMB  mixers  sceneObjects")
        for x in snaps:
            print("  %-13s  %8s  %10s  %8s  %6s  %6s  %12s" % (x["tag"], x["infoTextures"], x["geometries"], x["programs"],
                                                                x.get("heapMB"), x.get("mixers"), x.get("sceneObjects")))
        if len(tex) >= 2:
            base = tex[0]
            for i, t in enumerate(tex[1:], start=2):
                v.check("lobby textures m%d within +-%d of m1" % (i, args.tolerance), abs(t - base) <= args.tolerance,
                        {"m1": base, "m%d" % i: t, "delta": t - base}, expect="|delta| <= %d (PLAN L4)" % args.tolerance)
        else:
            v.cnj("lobby textures", "fewer than 2 lobbies reached")
        # ---------- census ----------
        tags, groups = summarize_census(snaps)
        ltags = [t for t in tags if t.endswith("_lobby")]
        table = []
        last = lob[-1] if lob else None
        where_by_owner = collections.defaultdict(collections.Counter)
        epoch_by_owner = collections.defaultdict(collections.Counter)
        kinds = collections.defaultdict(set)
        sample = {}
        if last:
            seen_src = set()
            for r in last["rows"]:
                if r["src"] in seen_src:
                    continue
                seen_src.add(r["src"])
                where_by_owner[r["owner"]][r["where"]] += 1
                epoch_by_owner[r["owner"]][r["epoch"]] += 1
                kinds[r["owner"]].add("%s %s" % (r["kind"], r["dims"]))
                sample.setdefault(r["owner"], r.get("bornTop"))
        for owner, counts in groups.items():
            series = [counts.get(t, 0) for t in ltags]
            growth = [b - a for a, b in zip(series, series[1:])]
            table.append({"owner": owner, "lane": lane_for(owner), "lobby": dict(zip(ltags, series)),
                          "growthPerMatch": growth, "grows": any(g > 0 for g in growth),
                          "atLastLobby": dict(where_by_owner.get(owner, {})),
                          "bornInMatch": {str(k): n for k, n in epoch_by_owner.get(owner, {}).items()},
                          "kinds": sorted(kinds.get(owner, []))[:6], "createdAt": sample.get(owner)})
        table.sort(key=lambda r: (-sum(max(0, g) for g in r["growthPerMatch"]), r["owner"]))
        v.data["census"] = table
        v.data["censusNote"] = ("counts are unique texture sources (what info.memory.textures counts); 'bornInMatch' = the match "
                                "whose load/play created them (0 = menu); a group that grows every match and whose survivors were "
                                "born in EARLIER matches while 'unreachable' is a leak owned by that file")
        live = [len({r["src"] for r in x["rows"]}) for x in lob]
        v.info("census coverage (live unique sources vs info.memory.textures per lobby)", list(zip(live, tex)))
        print("\n  TEXTURE CENSUS (unique sources per owner at each lobby; growth per match; where the last lobby's survivors are)")
        for r in table:
            if not r["grows"] and all(n == 0 for n in r["lobby"].values()):
                continue
            print("   %s %-60s %-6s %s growth %s  born %s  at-last-lobby %s  %s" % (
                "LEAK" if r["grows"] else "    ", r["owner"][:120], r["lane"][:6], list(r["lobby"].values()), r["growthPerMatch"],
                r["bornInMatch"], r["atLastLobby"], r["kinds"][:2]))
        leak = [r for r in table if r["grows"]]
        v.info("growing texture groups (leak owners)", [{"owner": r["owner"], "lane": r["lane"], "growth": r["growthPerMatch"],
                                                          "survivorsAt": r["atLastLobby"]} for r in leak][:30])
        fferr = v.data.get("fastForwardErrors") or []
        v.check("the game did not throw inside fastForward", not fferr, {"n": len(fferr), "first": fferr[:2]})
        errs = C.diag_problems(d, rig=False)
        v.check("no page errors / window errors during the loop", not (d["pageErrors"] or d["windowErrors"]),
                {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3], "all": errs})
    return C.run_gate("leaktest", body, args)


if __name__ == "__main__":
    sys.exit(main())
