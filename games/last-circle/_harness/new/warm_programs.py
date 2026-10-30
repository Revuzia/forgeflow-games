#!/usr/bin/env python
"""warm_programs - lane 7F (Wave 7): nothing is compiled, created or uploaded by a SECOND renderer or a shadow-pass flip in the middle of a match.

    python _harness/new/warm_programs.py --disk                              # 3 maps x seeds 1,7 (about 3 min per map x seed on an idle box)
    python _harness/new/warm_programs.py --disk --maps ashgrid --seeds 1     # one run
    python _harness/new/warm_programs.py --disk --plant no-arm               # FALSIFIER: ffg_warmup.js served without armDepthVariants
    python _harness/new/warm_programs.py --disk --plant no-icons             # FALSIFIER: hud.js served without the lobby icon pre-render
    python _harness/new/warm_programs.py --rev 60b854d0 --maps ashgrid,deepwood   # the Wave-6 release (live until the Wave-7 deploy): must FAIL

Promoted into _harness/new/ and registered in gate.py by lane 7G (Wave-7 fix round); written by lane 7F. Registered controls (each must exit 1): --plant no-arm,
--plant no-icons, and --rev 60b854d0 (gate.py NEGATIVE: warm_programs-plant-no-arm / -plant-no-icons / -live-60b854d0).

Why: framecheck counts programs only on the frames it samples (every 30th) and only on the MAIN renderer. Three draws every shadow caster with ONE shared
MeshDepthMaterial whose program is re-derived only when instancing / skinning flips between two draws, so which depth keys a warm frame links depends on the
order of its shadow pass: the live pass reached another key a few seconds into the drop (a 7-25 ms synchronous link, once per map, at an arbitrary second).
The HUD's slot-icon renderer is a second WebGL context that was created, linked and fed on drop frame 1 and on every first pickup. This gate hooks
renderer.renderBufferDirect (every pass) and diffs the program list around each call, so a compile is attributed to the exact (object, material, pass).

Rows per map x seed (exact counts; milliseconds are information):
  drop frame 1       programs compiled on the first rendered drop frame == 0
  natural window     programs compiled on rendered frames (every 3rd) from drop frame 2 to match second WINDOW_S (235 = three minutes of play) == 0
  forced checkpoints a forced all-visible render (the warm-up's own force()) after the window (238 / 246 / 248 s) compiles 0 programs (objects that exist now and would link on first draw)
  shuffle            24 shadow passes with every group's children shuffled and every shadow participant a caster, at match second 240 and 252: programs compiled == 0
  icon renderer      after the real Enter press (the lobby stayed up LOBBY_WAIT s): WebGL contexts created == 0 and toDataURL readbacks == 0
  supply crate       programs compiled between match second 262 and 300 (the storm-phase-2 supply drop falls from second 269) == 0   [the balloon's transparent lit material is linked by loot.js makeSupplyCrate() through warmObjects: the ONE builder of the crate, used by the live drop and by the warm-up (Wave-7 completion round, lane D1)]
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.environ.get("LC_HARNESS") or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402

GAME_DIR = C.ROOT                                 # games/last-circle (the working copy; --rev reads git instead)

HOOK_JS = r"""() => {
  const W = window.__LC__.W, k = W.kernel, r = k.renderer, P = window.__H_PUMP__;
  if (window.__PP__) return 'already';
  const PP = window.__PP__ = { events: [], frame: 0, cur: null, passName: '', warm: null, trace: true, seen: {} };
  r.info.autoReset = false;
  const path = (o) => { const a = []; let p = o; let n = 0; while (p && n++ < 8) { a.push((p.name || p.type) + ''); p = p.parent; } return a.join(' < '); };
  const matInfo = (m) => {
    if (!m) return null;
    const d = { type: m.type, name: m.name || '', transparent: !!m.transparent, blending: m.blending, side: m.side, depthWrite: m.depthWrite,
      fog: m.fog, vertexColors: !!m.vertexColors, map: !!m.map, alphaMap: !!m.alphaMap, alphaTest: m.alphaTest, flatShading: !!m.flatShading,
      emissive: m.emissive ? m.emissive.getHex() : null, envMap: !!m.envMap, normalMap: !!m.normalMap, roughnessMap: !!m.roughnessMap,
      onBeforeCompile: !!(m.onBeforeCompile && m.onBeforeCompile.toString().length > 40), cacheKeyFn: (m.customProgramCacheKey ? m.customProgramCacheKey() : ''),
      defines: m.defines ? JSON.stringify(m.defines) : '', toneMapped: m.toneMapped, premult: !!m.premultipliedAlpha,
      isShader: !!m.isShaderMaterial, uuid: m.uuid.slice(0, 8) };
    if (m.isShaderMaterial) { d.vsLen = (m.vertexShader || '').length; d.fsLen = (m.fragmentShader || '').length; d.lights = !!m.lights; d.fsHead = (m.fragmentShader || '').replace(/\s+/g, ' ').slice(0, 90); }
    return d;
  };
  const rbd = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (PP.trace) {
      const pass0 = scene === null ? 'shadow' : scene === W.scene ? 'main' : 'post';
      const k0 = pass0 + '|' + (object.name || object.type) + '|' + (object.isInstancedMesh ? 'I' : '') + (object.isSkinnedMesh ? 'S' : '') + '|' + material.type + '|map' + (material.map ? 1 : 0) + '|side' + material.side + '|at' + material.alphaTest;
      if (!PP.seen[k0]) PP.seen[k0] = { first: window.__H_PUMP__ ? window.__H_PUMP__.frames : -1, phase: W.phase, n: 0 };
      PP.seen[k0].n++;
    }
    const before = r.info.programs ? r.info.programs.length : 0;
    const prevDesc = PP.prevShadow ? PP.prevShadow.slice() : null;
    if (scene === null) { PP.prevShadow = [object.name || object.type, object.isInstancedMesh ? 'I' : '', object.isSkinnedMesh ? 'S' : '', material.uuid.slice(0,6), 'map' + (material.map ? 1 : 0), 'side' + material.side]; PP.shadowSeq = (PP.shadowSeq || 0) + 1; }
    const ids0 = new Set(r.info.programs ? r.info.programs.map((p) => p.id) : []);
    const res = rbd(camera, scene, geometry, material, object, group);
    const progs = r.info.programs || [];
    if (progs.length !== before || progs.some((p) => !ids0.has(p.id))) {
      const fresh = progs.filter((p) => !ids0.has(p.id));
      PP.events.push({ forced: PP.forced || false, frame: window.__H_PUMP__ ? window.__H_PUMP__.frames : -1, t: +(W.t || 0).toFixed(2), phase: W.phase,
        pass: scene === null ? 'shadow' : scene === W.scene ? 'main' : 'post',
        obj: path(object), objType: object.type, inst: !!object.isInstancedMesh, skinned: !!object.isSkinnedMesh,
        mat: matInfo(material), progName: fresh.map((p) => p.name).join('|'), progIds: fresh.map((p) => p.id), nFresh: fresh.length,
        cacheKey: fresh.map((p) => String(p.cacheKey).slice(0, 700)).join(' || ') , lightsMeta: null,
        prevShadow: prevDesc, shadowSeq: PP.shadowSeq, progsTotal: progs.length, removed: ids0.size - (progs.length - fresh.length) });
    }
    return res;
  };
  // first use of a geometry / texture by the renderer: three registers its dispose listener exactly then
  PP.geoEvents = []; PP.texEvents = []; PP.geoByUuid = {};
  const T = W.THREE;
  const ael = T.EventDispatcher.prototype.addEventListener;
  T.EventDispatcher.prototype.addEventListener = function (type, listener) {
    if (type === 'dispose' && listener) {
      if (listener.name === 'onGeometryDispose' && this.isBufferGeometry) { PP.geoEvents.push({ frame: window.__H_PUMP__ ? window.__H_PUMP__.frames : -1, t: +(W.t || 0).toFixed(2), phase: W.phase, uuid: this.uuid, verts: this.attributes.position ? this.attributes.position.count : 0, geoType: this.type, forced: !!PP.forced }); PP.geoByUuid[this.uuid] = this; }
      else if (listener.name === 'onTextureDispose' && this.isTexture) PP.texEvents.push({ frame: window.__H_PUMP__ ? window.__H_PUMP__.frames : -1, t: +(W.t || 0).toFixed(2), phase: W.phase, uuid: this.uuid, name: this.name || '', w: this.image && (this.image.width || 0), h: this.image && (this.image.height || 0), forced: !!PP.forced, src: this.source && this.source.data && this.source.data.src ? String(this.source.data.src).slice(-60) : '' });
    }
    return ael.apply(this, arguments);
  };
  // forced all-visible render (the warm-up's own force(), without the depth arming): finds objects that exist NOW and would compile on first draw
  PP.forceRender = (label) => {
    const st = []; const scene = W.scene; const k = W.kernel;
    scene.traverse((o) => {
      const isHull = !!(o.userData && o.userData.isOutline === true);
      const needCount = o.isInstancedMesh === true && !isHull && o.count === 0 && o.instanceMatrix && o.instanceMatrix.count > 0;
      const isDrawable = o.isMesh === true || o.isPoints === true || o.isLine === true || o.isSprite === true;
      const needCull = isDrawable && !isHull && o.frustumCulled === true;
      if (!o.visible || needCount || needCull) { st.push([o, o.visible, needCount ? 0 : null, needCull]); o.visible = true; if (needCount) o.count = 1; if (needCull) o.frustumCulled = false; }
    });
    const sm = k.renderer.shadowMap; const prevAuto = k.renderer.autoClear;
    PP.forced = label; const n0 = PP.events.length;
    try { k.renderer.autoClear = true; if (sm && sm.enabled) sm.needsUpdate = true; if (k.composer) k.composer.render(0); else k.renderer.render(k.scene, k.camera); }
    finally { PP.forced = false; k.renderer.autoClear = prevAuto; for (let i = st.length - 1; i >= 0; i--) { const r = st[i]; r[0].visible = r[1]; if (r[2] !== null) r[0].count = r[2]; if (r[3]) r[0].frustumCulled = true; } if (sm && sm.enabled) sm.needsUpdate = true; }
    return PP.events.length - n0;
  };
  // order-independence test of the shadow-depth programs: every shadow participant is made a caster, then the shadow pass runs `iters` times
  // with every group's children shuffled (so the shared depth material flips at a different object each time). New programs = depth keys the warm missed.
  PP.shuffleTest = (iters, seed) => {
    const scene = W.scene, k = W.kernel, r = k.renderer, sm = r.shadowMap;
    let a = (seed >>> 0) || 1; const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const groups = [], flags = [];
    scene.traverse((o) => {
      if (o.children && o.children.length > 1) groups.push([o, o.children.slice()]);
      const isHull = !!(o.userData && o.userData.isOutline === true);
      if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && !isHull) flags.push([o, o.castShadow, o.visible, o.frustumCulled, o.count]);
      else if (!o.visible) flags.push([o, o.castShadow, o.visible, o.frustumCulled, o.count]);
    });
    let forcedCasters = 0;
    for (const f of flags) { const o = f[0]; o.visible = true; if (o.isMesh) { o.frustumCulled = false; if ((f[1] === true) || o.receiveShadow === true) { if (!o.castShadow) forcedCasters++; o.castShadow = true; } if (o.isInstancedMesh && o.count === 0 && o.instanceMatrix && o.instanceMatrix.count > 0) o.count = 1; } }
    const n0 = PP.events.length; const prevAuto = r.autoClear;
    PP.forced = 'shuffle';
    try {
      r.autoClear = true;
      for (let it = 0; it < iters; it++) {
        for (const g of groups) { const arr = g[1].slice(); for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } g[0].children = arr; }
        if (sm && sm.enabled) sm.needsUpdate = true;
        if (k.composer) k.composer.render(0); else r.render(k.scene, k.camera);
      }
    } finally {
      PP.forced = false; r.autoClear = prevAuto;
      for (const g of groups) g[0].children = g[1];
      for (const f of flags) { const o = f[0]; o.castShadow = f[1]; o.visible = f[2]; o.frustumCulled = f[3]; if (f[4] !== undefined && o.isInstancedMesh) o.count = f[4]; }
      if (sm && sm.enabled) sm.needsUpdate = true;
    }
    return { iters, groups: groups.length, objects: flags.length, forcedCasters, newProgramEvents: PP.events.length - n0 };
  };
  PP.resolveGeo = () => {
    const owner = {};
    W.scene.traverse((o) => { if (o.geometry && PP.geoByUuid[o.geometry.uuid] && !owner[o.geometry.uuid]) { const a = []; let p = o, n = 0; while (p && n++ < 6) { a.push((p.name || p.type) + ''); p = p.parent; } owner[o.geometry.uuid] = a.join(' < ') + (o.isInstancedMesh ? ' [inst ' + o.count + ']' : '') + (o.isSkinnedMesh ? ' [skinned]' : '') + (o.visible ? '' : ' [hidden]'); } });
    return PP.geoEvents.map((e) => Object.assign({}, e, { owner: owner[e.uuid] || '(not in scene now)' }));
  };
  // per-frame wall time of the pump (sim + view + render): hitches show as outliers; GL context creation and toDataURL are timed on their own
  PP.slow = []; PP.ctx = [];
  const P0 = window.__H_PUMP__;
  if (P0 && !P0.__timed) {
    P0.__timed = true; const f0 = P0.frame;
    P0.frame = function (dt, doRender) { const a = performance.now(); const gl0 = PP.geoEvents.length, tx0 = PP.texEvents.length; const r = f0.apply(this, arguments); const ms = performance.now() - a;
      if (ms > (window.__PP_SLOW__ || 12)) PP.slow.push({ frame: P0.frames, t: +(W.t || 0).toFixed(2), phase: W.phase, ms: +ms.toFixed(1), rendered: !!doRender, geo: PP.geoEvents.length - gl0, tex: PP.texEvents.length - tx0 });
      return r; };
  }
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) { const a = performance.now(); const r = gc.apply(this, arguments); if (/webgl/.test(String(type))) PP.ctx.push({ t: +(W.t || 0).toFixed(2), phase: W.phase, ms: +(performance.now() - a).toFixed(1), w: this.width, h: this.height, frame: P0 ? P0.frames : -1 }); return r; };
  const tdu = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () { const a = performance.now(); const r = tdu.apply(this, arguments); PP.ctx.push({ t: +(W.t || 0).toFixed(2), phase: W.phase, toDataURL_ms: +(performance.now() - a).toFixed(1), w: this.width, h: this.height, frame: P0 ? P0.frames : -1 }); return r; };
  PP.snapshot = () => (r.info.programs || []).map((p) => ({ id: p.id, name: p.name, key: String(p.cacheKey).slice(0, 300) }));
  return 'ok';
}"""

STUB_JS = """() => { const gl = window.__LC__.W.kernel.renderer.getContext(); if (gl.__hStub) return 'already';
  for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) if (gl[fn]) gl[fn] = function () {};
  gl.__hStub = true; return 'stubbed'; }"""

WINDOW_S = 235.0
CRATE_FROM, CRATE_TO = 262.0, 300.0
LOBBY_WAIT = 3.0
SHUFFLE_N = 24


def route_override(sess, suffix, text):
    body = text.encode("utf-8")

    def handler(route, request=None):
        route.fulfill(status=200, body=body, headers={"content-type": "text/javascript; charset=utf-8", "cache-control": "no-store"})
    sess.context.route(re.compile(r".*" + re.escape(suffix) + r"(\?.*)?$"), handler)


def read_game_file(args, rel):
    if getattr(args, "rev", None):
        return subprocess.run(["git", "show", "%s:games/last-circle/%s" % (args.rev, rel)], cwd=GAME_DIR, capture_output=True, check=True).stdout.decode("utf-8")
    with open(os.path.join(GAME_DIR, rel), "r", encoding="utf-8", newline="") as f:
        return f.read()


def one_run(args, v, mp, seed):
    plant = args.plant
    tag = "%s s%d" % (mp, seed)
    with C.Session(args, "warm_programs") as s:
        if plant == "no-arm":
            txt = read_game_file(args, "runtime/3d/ffg_warmup.js")
            new = re.sub(r"try \{ dv = armDepthVariants\([^)]*\);[^\n]*", "/* planted: depth variants not armed */", txt)   # any argument list: (renderer, scene) before eab44ff0, (renderer, scene, camera) since
            if new == txt:
                v.cnj("plant no-arm", "the armDepthVariants call was not found in ffg_warmup.js")
                return
            route_override(s, "ffg_warmup.js", new)
        if plant == "no-icons":
            txt = read_game_file(args, "runtime/3d/royale/hud.js")
            new = re.sub(r"\n[ \t]*warmIcons\(W\);[^\n]*", "\n/* planted: no icon pre-render */", txt)
            if new == txt:
                v.cnj("plant no-icons", "the warmIcons(W) call was not found in hud.js")
                return
            route_override(s, "royale/hud.js", new)
        for sv in args.serve:
            suf, path = sv.split("=", 1)
            with open(path, "r", encoding="utf-8", newline="") as fh:
                route_override(s, suf, fh.read())
        s.boot()
        s.freeze_loop()
        s.install_pump()
        s.js(STUB_JS)
        s.js(HOOK_JS)
        s.start_match("standard", seed, mp, enter=False)
        # a player sits in the lobby through the fill (0.7 s) and the 3-count (2.7 s) unless they skip it: give the icon pre-render that long, leave early once it settles
        n_prev, stable, waited = -1, 0, 0.0
        while waited < LOBBY_WAIT:
            s.sleep(0.25)
            waited += 0.25
            n_now = s.js("() => window.__PP__.ctx.length")
            stable = stable + 1 if n_now == n_prev else 0
            n_prev = n_now
            if n_now >= 11 and stable >= 2:
                break
        lob = s.js("() => ({ ctx: window.__PP__.ctx.length, phase: window.__LC__.W.phase })")
        ctx0 = lob["ctx"]
        for _ in range(3):
            s.page.keyboard.press("Enter")
            if s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 5, 0.1) is not None:
                break
        if s.phase() not in ("drop", "match"):
            v.cnj("%s: left the lobby" % tag, "phase %s" % s.phase())
            return
        warm = s.js("() => { const W = window.__LC__.W; const w = W.kernel.lastWarmup || {}; return { depthVariants: w.depthVariants, programs: w.programs, by: W._warm && W._warm.by }; }")
        s.js("() => { window.__PP__.events.length = 0; }")
        s.step_frames(1, 1 / 60, render=True)
        d1 = s.js("() => window.__PP__.events.length")
        s.js("() => { window.__PP__.events.length = 0; }")
        shuffle, cps, crate_cps = [], [], []
        # the NATURAL window is left untouched (no forced render before WINDOW_S: a forced render links whatever is missing and would hide a late program)
        marks = sorted([(WINDOW_S + 3.0, "cp"), (WINDOW_S + 5.0, "shuffle"), (WINDOW_S + 11.0, "cp"), (WINDOW_S + 13.0, "cp"), (WINDOW_S + 17.0, "shuffle")] + [(CRATE_FROM + 3.0 * i, "crate") for i in range(15)])
        total = int((CRATE_TO + 6.0) * 60) + 120
        done = 1
        mi = 0
        while done < total:
            t = s.safe_js("() => window.__LC__.W.t", default=0) or 0
            if mi < len(marks) and t >= marks[mi][0]:
                kind = marks[mi][1]
                mi += 1
                if kind == "shuffle":
                    shuffle.append(s.js("([n, sd]) => window.__PP__.shuffleTest(n, sd)", [SHUFFLE_N, 1234 + int(t)]))
                elif kind == "crate":
                    crate_cps.append({"t": round(t, 1), "n": s.js("(l) => window.__PP__.forceRender(l)", "crate%d" % int(t))})
                else:
                    cps.append({"t": round(t, 1), "n": s.js("(l) => window.__PP__.forceRender(l)", "cp%d" % int(t))})
                continue
            n = 240
            if mi < len(marks):
                n = max(1, min(n, int((marks[mi][0] - t) * 60) + 1))
            s.step_frames(n, 1 / 60, render=3, chunk=60)
            done += n
            if s.phase() in ("over", "ended"):
                break
        evs = s.js("() => window.__PP__.events.slice()")
        t_end = s.safe_js("() => window.__LC__.W.t", default=0) or 0
        natural = [e for e in evs if not e.get("forced") and e["t"] <= WINDOW_S]
        crate = [e for e in evs if CRATE_FROM <= e["t"] <= CRATE_TO + 3 and (not e.get("forced") or str(e.get("forced")).startswith("crate"))]
        ctxall = s.js("() => window.__PP__.ctx.slice()")
        after_enter = ctxall[ctx0:]
        n_ctx = len([c for c in after_enter if "ms" in c])
        n_tdu = len([c for c in after_enter if "toDataURL_ms" in c])
        d = s.diagnostics()

        def brief(es):
            return [{"t": e["t"], "pass": e["pass"], "obj": e["obj"][:48], "mat": (e.get("mat") or {}).get("type")} for e in es[:6]]
        v.info("%s: warm" % tag, warm)
        v.check("%s: drop frame 1 compiles 0 programs" % tag, d1 == 0, {"programs": d1}, expect="0")
        v.check("%s: natural window, drop frame 2 .. match second %d, compiles 0 programs" % (tag, WINDOW_S), not natural and t_end >= WINDOW_S,
                {"programs": len(natural), "first": brief(natural), "reached_t": round(t_end, 1)}, expect="0")
        v.check("%s: forced all-visible renders at 238 / 246 / 248 s compile 0 programs" % tag, all(c["n"] == 0 for c in cps) and len(cps) >= 3,
                {"checkpoints": cps}, expect="0 at 3 checkpoints")
        v.check("%s: shadow-order shuffle (%d passes x 2) compiles 0 programs" % (tag, SHUFFLE_N), all(x["newProgramEvents"] == 0 for x in shuffle) and len(shuffle) >= 2,
                {"runs": shuffle}, expect="0")
        icon_name = "%s: the icon renderer made 0 GL contexts and 0 readbacks after Enter" % tag
        if 0 < lob["ctx"] < 11:
            v.cnj(icon_name, "only %d of 11 context / readback events happened inside the %.1f s lobby (box too slow to finish the pre-render: re-run)" % (lob["ctx"], waited))
        else:
            v.check(icon_name, n_ctx == 0 and n_tdu == 0 and lob["ctx"] >= 11,
                    {"contextsAfterEnter": n_ctx, "toDataURLAfterEnter": n_tdu, "inLobby": lob["ctx"], "lobbySeconds": waited}, expect="0 / 0 (the 1 context + 10 icons are built in the lobby)")
        v.check("%s: the supply-crate drop (forced renders every 3 s, match second %d-%d) compiles 0 programs" % (tag, CRATE_FROM, CRATE_TO + 3), t_end >= CRATE_TO and not crate and len(crate_cps) >= 10,
                {"programs": len(crate), "first": brief(crate), "reached_t": round(t_end, 1), "renders": len(crate_cps)}, expect="0 (loot.js makeSupplyCrate() is the one crate builder; warmObjects hands its page-lifetime proxy to the warm frame, so the balloon's transparent lit program is linked before the drop)")
        v.check("%s: no page / window errors" % tag, not (d["pageErrors"] or d["windowErrors"]), {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="ashgrid,deepwood,isla_viva")
    ap.add_argument("--seeds", default="1,7")
    ap.add_argument("--plant", default=None, choices=["no-arm", "no-icons"])
    ap.add_argument("--serve", action="append", default=[], metavar="SUFFIX=FILE",
                    help="lane development: serve FILE for any request ending in SUFFIX (a patched copy of a file another lane owns), e.g. royale/loot.js=loot.js.patched")
    args = ap.parse_args()
    if not args.report:
        args.report = "warm_programs" + ("_plant_" + args.plant.replace("-", "_") if args.plant else "")

    def body(v):
        for mp in [x for x in args.maps.split(",") if x]:
            for sd in [int(x) for x in args.seeds.split(",") if x]:
                one_run(args, v, mp, sd)
    return C.run_gate("warm_programs", body, args)


if __name__ == "__main__":
    sys.exit(main())
