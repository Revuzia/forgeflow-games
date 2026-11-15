#!/usr/bin/env python
"""waterlook - Wave 10 round 2 lane R2A "water, horizon, light, grass, underwater sky" (gate w10_waterlook). Built from the W10 visuals audit's
pinned views (F:/lc_p23/w10/audit/visuals/vshots.py: the same camera searches - ground / shore / in-water / under-water / vista - on the same
seed 7), turned into bar rows (PLAN.md "Lane R2A" acceptance bars; the audit value each replaces in brackets).

    python _harness/p23/waterlook.py --disk                          # every part: 3 maps medium + isla_viva low / high / ultra
    python _harness/p23/waterlook.py --disk --plant flat-water       # the W9 surface: one weak layer, no fresnel/glint - MUST FAIL water-detail, glint
    python _harness/p23/waterlook.py --disk --plant storm-early      # the W9 wall: drawn pre-close, no distance fade - MUST FAIL storm-early
    python _harness/p23/waterlook.py --disk --plant flat-light       # the W9 hemisphere / sun, no contrast curve   - MUST FAIL light
    python _harness/p23/waterlook.py --disk --plant dim-rooms        # the rooms without the W10 indoor lift       - MUST FAIL light: interiors
    python _harness/p23/waterlook.py --disk --plant sea-edge         # the sea translucent past the map edge        - MUST FAIL light: far-sea edge
    python _harness/p23/waterlook.py --disk --plant lip-static       # foam on the static level, not the bobbing one - MUST FAIL shore lip
    python _harness/p23/waterlook.py --disk --plant wet-flat         # wet sand by height alone (whole islets)     - MUST FAIL wet sand from the air
    python _harness/p23/waterlook.py --disk --plant sparse-grass     # the blade cell 0.56 -> 1.4 m                 - MUST FAIL grass
    python _harness/p23/waterlook.py --disk --plant grass-on-low     # the blade layer built on low too             - MUST FAIL low-identical
    python _harness/p23/waterlook.py --disk --plant grass-on-sand    # the blades without the grass-ness mask (on beaches) - MUST FAIL grass-sand
    python _harness/p23/waterlook.py --disk --plant uw-sky-sharp     # no dome fog, no output-pass murk under water - MUST FAIL underwater
    python _harness/p23/waterlook.py --rev cbf0a1ff                  # the R2 base (W10 R1 live): every bar row MUST FAIL

Rows (every view: actors / fx hidden, the frame drawn through the game's composer at the pinned camera after 26 stepped frames there, the map
clock then pinned - SHORE_T for the shore / in-water views, VIEW_T for the rest - so every view is the same frame run to run):
  water-detail  in-water view (vshots `inwater`), luminance p95 - p5 over the lower half >= 0.15, the worst of 3 map clocks (bob crest / level /
                trough) [0.06]
  glint         a sun-facing view over deep water (>= 2.5 m under every sampled point): >= 0.5 % (the plan's 0.3 % RAISED: the base build reads
                0.298 % and the W9-surface plant 0.309 %, so 0.3 % did not separate them) of the water pixels (water A/B mask) at display
                luminance >= 0.9; the same view turned away from the sun: 0 % [none]
  fresnel       away from the sun: mean water luminance in the band just under the horizon / looking straight down >= 1.3 [~1]
  shore         at EACH of 3 map clocks (the bob's crest, level, trough; the transects' waterline is the surface at that clock),
                top-down over the vshots shore point, 9 transects across the waterline: the white foam run that starts at the waterline is
                0.5-2.0 m wide (median), and the ground 0.05-0.9 m above the water is darker than 1.2-2.0 m above (ratio <= 0.85) [faint]
  storm-early   pre-close views (circle 1 waiting, "no damage yet"): pixels the wall tints lilac (its A/B, the change leaning violet) above
                the horizon band (+3 % of the frame) <= 0.1 % of the frame [every view]
  storm-late    circle 1 closing: the wall A/B moves >= 1 % of the frame from 380 m (and the stormfx rows stay: run stormfx_storm)
  light         ground luminance spread p95 - p5 >= 0.25 on every map (mean of ground / ground2 / groundlow, lower half) [0.14 / 0.17 / 0.28];
                the OD-2 drop view mean 0.45-0.55 held; far sea: no colour step along the map edge in the drop view
                (p90 <= 0.02); interiors (3 houses' biggest ground-floor rooms) mean >= 0.9 x the base's ON EVERY MAP
  grass-sand    medium, a low view (0.5 m) over dry non-grass ground (the nearest 30 m disc - the blade ring - that is >= 95 % sand band, dunes,
                dry wash, mud, snow or rock by the blade layer's own grass-ness bake): the blades A/B moves <= 0.5 % of the lower half
                [build 1: the sand under blades]
  grass         medium: >= 0.8 cards + tufts per m2 within 30 m of open ground (the audit's ground spot, or the nearest point whose 30 m disc is
                >= 95 % land outside the town mask), and the blade layer moves >= 8 % of the lower half of a low view there [0.148]
  low-identical low tier, isla_viva: 4 views identical to the base build (<= 0.001 % of the pixels differ - the base's own run-to-run
                noise is 1 pixel, control --rev cbf0a1ff; loot, launch portals and door leaves hidden: they animate on the sim
                clock / bot traffic) - phones / low untouched
  underwater    from below (vshots `underup`): high-frequency energy (mean |Laplacian| of luminance) of the upper half <= 0.4 x the base's
  tiers         SSIM(ultra, medium) on the 3 eye-level pinned views (ground, inwater, shore) <= 0.92; vista and vista2 reported [identical]
  programs      0 new shader programs after the warm frames, on every tier
plus 0 page / console errors, 0 failed requests, 0 shader errors.
Base numbers (underwater, interiors, low views) come from a second Chrome on BASE_REV, cached in _reports.
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import base64
import copy
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402
import p23lib as L  # noqa: E402
import shotsheet as SS  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

BASE_REV = "cbf0a1ff"      # the W10 R2 base = W10 R1 live (LIVE_REV cb244268) + the gates baseline commit. NEVER moves
MAPS = ["isla_viva", "ashgrid", "deepwood"]
TIER_VIEWS = ("ground", "inwater", "shore")     # the player's eye-level views; vista (14 m over the highest ground) and vista2 (70 m up) are reported
TIER_INFO = ("vista", "vista2")
SEED = 7
# map clocks the water views are pinned to (every view settled: the water's bob, foam wash and wave scroll are a function of this clock alone).
# The bob is sin(0.7 t) * 0.12 m: SHORE_T = crest (+0.12), still water level, trough (-0.12) - the shore and water-detail rows are judged at
# EVERY one of them (a foam band that only meets the bar at one phase of the bob is a fail); VIEW_T for the other views (as the storm / tier views)
SHORE_T = (2.244, 4.488, 6.732)
VIEW_T = 100.0
RP = "runtime/3d/royale/"

PLANTS = {
    # flat-water = item 1 not delivered: the W9 surface - ONE weak ripple layer (0.2 ~ its 0.35 normalScale x our 0.55) and no fresnel sky / sun glint
    "flat-water": [(RP + "maps.js", [("    vec2 lsl = ln1 * 0.55 + ln2 * 0.45;", "    vec2 lsl = ln1 * 0.2;"),
                                     ("  vec3 lv = normalize( cameraPosition - vLcW );\n  if ( lv.y > 0.0 ) {\n    float lfr", "  vec3 lv = normalize( cameraPosition - vLcW );\n  if ( lv.y > 2.0 ) {\n    float lfr")])],
    # storm-early = item 3 not delivered: the wall drawn before circle 1 closes and not faded with distance (the W9 wall)
    "storm-early": [(RP + "storm.js", [("const early = v10 && (st.phase < 1 || (st.phase === 1 && !st.closing));", "const early = false;"),
                                       ("if (v10) vu.set(WALL_FAR[0], WALL_FAR[1], Math.min(1, ctl.visT / WALL_FADE_IN_S)); else vu.set(1e9, 2e9, 1);", "vu.set(1e9, 2e9, 1);")])],
    "flat-light": [(RP + "maps.js", [("const lw = W10V ? (K.w10Light || W10_LIGHT) : null;", "const lw = null;"),
                                     ("op.uniforms.lcGrade.value.set(K.w10Light && K.w10Light.contrast != null ? K.w10Light.contrast : W10_CONTRAST, uw, 0, 0);", "op.uniforms.lcGrade.value.set(0, uw, 0, 0);")])],
    # dim-rooms = the furnished rooms without the W10 indoor lift (the W10 R1 HG_INDOOR against the W10 lower fill): MUST FAIL light: interiors
    "dim-rooms": [(RP + "maps.js", [("const HG_INDOOR = (mapId === \"deepwood\" ? 0.95 : 0.8) * (W10V ? (K.w10Indoor || W10_INDOOR) : 1);", "const HG_INDOOR = (mapId === \"deepwood\" ? 0.95 : 0.8);")])],
    # sea-edge = the sea plane translucent past the map edge (no opaque fade): the sky dome shows through, a hard straight step - MUST FAIL far-sea edge
    "sea-edge": [(RP + "maps.js", [("    diffuseColor.a = mix( diffuseColor.a, 1.0, smoothstep( -240.0, -20.0, lout ) );", "")])],
    # lip-static = the foam / depth terms on the STATIC water level (the bobbing mesh not followed): the lip slides off the shore - MUST FAIL shore lip
    "lip-static": [(RP + "maps.js", [("if (W10V && LCFX) LCU.uLcWater.value.x = water.position.y;", "")])],
    # wet-flat = the wet-sand term by height alone (no slope-distance cap): whole low islets darkened from the air - MUST FAIL wet sand from the air
    "wet-flat": [(RP + "maps.js", [(" * ( 1.0 - smoothstep( 3.0, 7.0, lwd ) ) * step( -8.0, lhw );", " * step( -8.0, lhw );")])],
    "sparse-grass": [(RP + "maps.js", [("lamps: 4, grassR: 30, grassC: 0.56,", "lamps: 4, grassR: 30, grassC: 1.4,")])],
    # grass-on-low = the blade layer (and the ground lattice texture it stands on) built on the low tier too
    "grass-on-low": [(RP + "maps.js", [("lamps: 0, grassR: 0, grassC: 1,", "lamps: 0, grassR: 30, grassC: 0.56,"),
                                       ("  if (LCFX) {\n    const L = field.lat, hp", "  if (true) {\n    const L = field.lat, hp"),
                                       ("if (W10V && TIER_Q.grassR > 0 && LCU.uLcHgt.value) {", "if (TIER_Q.grassR > 0 && LCU.uLcHgt.value) {")])],
    # grass-on-sand = the blade layer without its grass-ness mask (the W10 R2A build-1 field: blades over beaches, washes, mud and snow)
    "grass-on-sand": [(RP + "maps.js", [("         * step( gh3 * 0.9 + 0.05, gt.a );", "         * 1.0;")])],
    "uw-sky-sharp": [(RP + "maps.js", [("skyMat.uniforms.uUw.value = uw;", "skyMat.uniforms.uUw.value = 0;"),
                                       ("op.uniforms.lcGrade.value.set(K.w10Light && K.w10Light.contrast != null ? K.w10Light.contrast : W10_CONTRAST, uw, 0, 0);", "op.uniforms.lcGrade.value.set(K.w10Light && K.w10Light.contrast != null ? K.w10Light.contrast : W10_CONTRAST, 0, 0, 0);")])],
}

# the audit's cameras (vshots CAMS_JS, verbatim) + this gate's water cameras: a deep-water point seen toward / away from the sun, and the shore
CAMS_JS = r"""() => { const W = window.__LC__.W, M = W.map, half = M.half, wy = (typeof M.waterY === 'number') ? M.waterY : -999;
  const G = (x, z) => (M.groundAt || M.heightAt)(x, z), H = (x, z) => M.heightAt(x, z);
  const out = {}; const inPoi = (x, z, pad) => M.pois.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r || 60) + pad);
  let best = null; for (let x = -half * 0.55; x <= half * 0.55; x += 20) for (let z = -half * 0.55; z <= half * 0.55; z += 20) { const h = G(x, z); if (!best || h > best.h) best = { x, z, h }; }
  const d0 = Math.hypot(best.x, best.z) || 1; const tx = -best.x / d0 * 300 + best.x, tz = -best.z / d0 * 300 + best.z;
  out.vista = [best.x, best.h + 14, best.z, d0 < 60 ? best.x + 300 : tx, Math.max(wy, 0) + 5, d0 < 60 ? best.z + 120 : tz, 62];
  out.vista2 = [-half * 0.62, Math.max(G(-half * 0.62, half * 0.62), wy) + 70, half * 0.62, 0, 10, 0, 55];
  let g = null; for (let r = 60; r < half * 0.7 && !g; r += 30) for (let a = 0; a < 16 && !g; a++) { const x = Math.cos(a * 0.3927 + 0.3) * r, z = Math.sin(a * 0.3927 + 0.3) * r; const h = G(x, z);
      if (h > wy + 2.5 && !inPoi(x, z, 50) && Math.abs(G(x + 6, z) - h) < 1.2 && Math.abs(G(x, z + 6) - h) < 1.2) g = { x, z, h }; }
  if (g) { out.ground = [g.x, H(g.x, g.z) + 1.7, g.z, g.x + 40, H(g.x + 40, g.z + 25) + 3, g.z + 25, 70];
           out.ground2 = [g.x, H(g.x, g.z) + 1.7, g.z, g.x - 30, H(g.x - 30, g.z - 40) + 2, g.z - 40, 70];
           out.groundlow = [g.x, H(g.x, g.z) + 0.5, g.z, g.x + 8, H(g.x + 8, g.z + 2) + 0.6, g.z + 2, 60]; }
  out._ground = g;
  if (wy > -900) {
    let s = null; for (let r = 80; r < half * 0.98 && !s; r += 12) for (let a = 0; a < 48 && !s; a++) { const x = Math.cos(a * 0.1309) * r, z = Math.sin(a * 0.1309) * r; const h = G(x, z) - wy;
      if (h < 0.35 || h > 1.1 || inPoi(x, z, 30)) continue;
      for (let k = 0; k < 8; k++) { const dx = Math.cos(k * 0.7854), dz = Math.sin(k * 0.7854);
        if (G(x + dx * 22, z + dz * 22) - wy < -1.6 && G(x - dx * 22, z - dz * 22) - wy > 1.4 && G(x + dx * 40, z + dz * 40) - wy < -2) { s = { x, z, dx, dz }; break; } } }
    out._shore = s;
    if (s) { const px = -s.dz, pz = s.dx;
      out.shore = [s.x - s.dx * 3, H(s.x - s.dx * 3, s.z - s.dz * 3) + 1.7, s.z - s.dz * 3, s.x + px * 40 + s.dx * 14, wy + 0.3, s.z + pz * 40 + s.dz * 14, 70];
      out.inwater = [s.x + s.dx * 20, wy + 0.45, s.z + s.dz * 20, s.x - s.dx * 20 + px * 12, wy + 2.5, s.z - s.dz * 20 + pz * 12, 70];
      out.underup = [s.x + s.dx * 30, wy - 2.0, s.z + s.dz * 30, s.x + s.dx * 60, wy + 1.5, s.z + s.dz * 60, 70];
      out.shoretop = [s.x - s.dx * 7, wy + 40, s.z - s.dz * 7, s.x - s.dx * 7 + 0.0005, wy, s.z - s.dz * 7 + 0.4, 60]; }
    // deep water: a point whose ground is >= 2.5 m under the water at every sample out to 70 m toward AND away from the sun (sea, or a lake)
    const sp = W._lcU && W._lcU.uLcSun ? W._lcU.uLcSun.value : null;
    const sx = sp ? sp.x : 0.6, sz = sp ? sp.z : 0.4, sl = Math.hypot(sx, sz) || 1, ux = sx / sl, uz = sz / sl;
    const deep = (x, z) => { for (let t = -70; t <= 70; t += 7) { if (G(x + ux * t, z + uz * t) > wy - 2.5) return false; } return true; };
    let dp = null;
    if (s) for (let d = 60; d < 420 && !dp; d += 20) { const x = s.x + s.dx * d, z = s.z + s.dz * d; if (Math.abs(x) < half * 1.3 && Math.abs(z) < half * 1.3 && deep(x, z)) dp = { x, z }; }
    for (let r = 0; r < half * 0.95 && !dp; r += 25) for (let a = 0; a < 24 && !dp; a++) { const x = Math.cos(a * 0.2618) * r, z = Math.sin(a * 0.2618) * r; if (deep(x, z)) dp = { x, z }; }
    out._deep = dp;
    if (dp) {
      const pitchDn = Math.tan(40 * Math.PI / 180), y = wy + 5;
      out.sunward = [dp.x, y, dp.z, dp.x + ux * 10, y - 10 * pitchDn, dp.z + uz * 10, 70];
      out.sunaway = [dp.x, y, dp.z, dp.x - ux * 10, y - 10 * pitchDn, dp.z - uz * 10, 70];
      out.horizon = [dp.x, wy + 3, dp.z, dp.x - ux * 100, wy + 3 - 100 * Math.tan(4 * Math.PI / 180), dp.z - uz * 100, 60];
      out.down = [dp.x, wy + 3, dp.z, dp.x - ux * 0.05, wy - 10, dp.z - uz * 0.05, 60];
    }
  }
  return out; }"""

# what the player sees from a pinned camera: actors / fx hidden (+ the named things), drawn through the composer; optional world points projected
RENDER_JS = r"""([spec, hide, pts]) => { const W = window.__LC__.W, T = W.THREE, k = W.kernel, cam = k.camera, r = k.renderer, sc = k.scene;
  const [px, py, pz, tx, ty, tz, fov] = spec; const Hd = [];
  const off = (o) => { if (o && o.visible) { Hd.push(o); o.visible = false; } };
  for (const a of (W.actors || [])) { off(a.obj); off(a.weaponMesh); off(a.nameTag); off(a.chute); off(a.hand); }
  if (W.player) { off(W.player.obj); off(W.player.weaponMesh); off(W.player.chute); }
  sc.traverse((o) => { if (o.name === 'fx-quads' || o.name === 'fx-smoke') off(o); });
  if (W.stormCtl && W.stormCtl.bolts) off(W.stormCtl.bolts);
  if (hide.includes('water') && W.map) off(W.map.water);
  if (hide.includes('blades')) off(W._grassBlades);
  if (hide.includes('wall') && W.stormCtl) off(W.stormCtl.wall);
  if (hide.includes('loot') && W._groups && W._groups.loot) off(W._groups.loot);
  if (hide.includes('doors')) sc.traverse((o) => { if (o.name === 'houses:doors@all') off(o); });
  if (hide.includes('portals')) sc.traverse((o) => { if (o.name === 'portal-rings' || (o.isMesh && o.material && o.material.isMeshBasicMaterial && o.material.transparent && o.material.color && o.material.color.getHex() === 0x9fefff)) off(o); });
  const of = cam.fov; cam.fov = fov; cam.updateProjectionMatrix();
  cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(true);
  if (r.shadowMap && r.shadowMap.enabled) r.shadowMap.needsUpdate = true; r.info.reset();
  if (k.composer) k.composer.render(1 / 60); else r.render(sc, cam);
  const out = { png: r.domElement.toDataURL('image/png'), calls: r.info.render.calls, tris: r.info.render.triangles, size: [r.domElement.width, r.domElement.height] };
  const f = new T.Vector3(); cam.getWorldDirection(f); f.y = 0; f.normalize();
  const hz = new T.Vector3(px + f.x * 1500, py, pz + f.z * 1500).project(cam); out.horizon = (1 - hz.y) / 2;
  if (pts) out.proj = pts.map((q) => { const v = new T.Vector3(q[0], q[1], q[2]).project(cam); return [(v.x + 1) / 2, (1 - v.y) / 2, v.z]; });
  for (const o of Hd) o.visible = true;
  cam.fov = of; cam.updateProjectionMatrix(); return out; }"""

# the map's clock pinned for a deterministic frame (water bob, cloud drift, wind): every map updater run once at t
SETTLE_JS = r"""(t) => { const W = window.__LC__.W; for (const fn of (W._mapUpdaters || [])) { try { fn(0.6, t); } catch (e) {} } return (W._mapUpdaters || []).length; }"""

# shore transects across the waterline: points every 0.1 m from 20 m inland to 14 m out (was 6 m: at the bob's trough the waterline of a flat beach
# moves ~6 m seaward and left 3 transects with no waterline at all - read as '0 m of foam'), 9 transects 3 m apart; [x, y, z, t (m seaward), above (m)]
TRANSECT_JS = r"""([sx, sz, dx, dz]) => { const W = window.__LC__.W, M = W.map, wy = M.waterY, wl = M.water ? M.water.position.y : wy; const px = -dz, pz = dx; const out = [];
  for (let k = -4; k <= 4; k++) { const row = []; for (let i = -200; i <= 140; i++) { const t = i * 0.1, x = sx + px * k * 3 + dx * t, z = sz + pz * k * 3 + dz * t; const g = M.heightAt(x, z);
    row.push([x, Math.max(g, wl), z, t, g - wl]); } out.push(row); }   // (above: metres over the LIVE surface - the drawn waterline at this clock)
  return out; }"""

STORM_JS = r"""() => { const W = window.__LC__.W, c = W.stormCtl; if (!c || !c.storm || !c.storm.phases.length) return null; const st = c.storm.stateAt(W.t);
  return { t: W.t, phase: st.phase, state: st.phaseState, closing: !!st.closing, r: st.radius, cx: st.center.x, cz: st.center.z, wallVisible: !!c.wall.visible,
           tl: (c.storm.timeline || []).slice(0, 2).map((x) => ({ shrinkStart: x.shrinkStart, end: x.end })), half: W.map.half }; }"""
FF_JS = r"""([target, cx, cz]) => { const C = window.__LC__, W = C.W, p = W.player, M = W.map; let n = 0; const t0 = performance.now();
  while (W.t < target && n < 4000 && performance.now() - t0 < 20000) { if (p) { p.pos.set(cx, M.heightAt(cx, cz) + 0.2, cz); p.hp = 100; p.shield = 100; if (p.vel) p.vel.set(0, 0, 0); } C.fastForward(0.5, 1 / 30); n++; }
  return { t: W.t, n, phase: W.phase, alive: !!(p && p.alive) }; }"""
WALLCAM_JS = r"""([dist]) => { const W = window.__LC__.W, M = W.map, st = W.stormCtl.storm.stateAt(W.t), c = st.center, R = st.radius; let best = null;
  for (let a = 0; a < 48; a++) { const dx = Math.cos(a * 0.1309), dz = Math.sin(a * 0.1309); const x = c.x + dx * (R - dist), z = c.z + dz * (R - dist);
    if (Math.abs(x) > M.half * 0.95 || Math.abs(z) > M.half * 0.95) continue; const h = Math.max(M.heightAt(x, z), M.waterY);
    let block = 0; for (let t = 20; t < dist; t += 20) { const g = M.heightAt(x + dx * t, z + dz * t); if (g > h + 25 + (t / dist) * 10) block++; }
    if (!best || block < best.block) best = { x, z, h, dx, dz, block }; }
  const b = best; return [b.x, b.h + 25, b.z, b.x + b.dx * dist, b.h + 30, b.z + b.dz * dist, 66]; }"""

# interiors: the 3 houses nearest the drop POI, each one's biggest ground-floor room, camera at its centre 1.6 m up looking at its far corner
ROOMS_JS = r"""([poi]) => { const W = window.__LC__.W, M = W.map; const P = M.pois.find((p) => p.id === poi) || M.pois[0]; const hs = (M.houses || []).map((H, i) => [H, i]);
  hs.sort((a, b) => Math.hypot(a[0].cx - P.x, a[0].cz - P.z) - Math.hypot(b[0].cx - P.x, b[0].cz - P.z));
  const out = [];
  for (const [H, i] of hs) { if (out.length >= 3) break; let best = null;
    for (const R of H.rooms || []) { if (R.floor !== 0 || !(R.area >= 9)) continue; if (!best || R.area > best.area) best = R; }
    if (!best) continue; const R = best;
    out.push({ house: i, id: H.id, room: R.id, kind: R.kind, spec: [R.cx, R.y + 1.6, R.cz, R.x1 - 0.3, R.y + 1.1, R.z1 - 0.3, 70] }); }
  return out; }"""

# the blade layer's placement in JS (the vertex shader's: world cell grid, hash jitter, ground lattice, mask): cards within r m of (x, z) whose
# scale is >= 0.35 (the ring's fade counted honestly), and the tufts (the clutter instances with a real scale) within r
GRASS_JS = r"""([x, z, r]) => { const W = window.__LC__.W, M = W.map, b = W._grassBlades; const out = { built: !!b, cards: 0, tufts: 0, area: Math.PI * r * r };
  const GA = (x, z) => { const t = b && b.userData.gTint; if (!t) return 1; const n = t.n, u = (x + M.half) / (2 * M.half) * n - 0.5, v = (z + M.half) / (2 * M.half) * n - 0.5;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(u))), j0 = Math.max(0, Math.min(n - 1, Math.floor(v))), i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    const fu = Math.max(0, Math.min(1, u - Math.floor(u))), fv = Math.max(0, Math.min(1, v - Math.floor(v))), a = (i, j) => t.px[(j * n + i) * 4 + 3] / 255;
    return (a(i0, j0) * (1 - fu) + a(i1, j0) * fu) * (1 - fv) + (a(i0, j1) * (1 - fu) + a(i1, j1) * fu) * fv; };
  if (b) { const u = b.material.userData; const gd = b.userData.grass, GR = gd.R, GC = gd.C, N = gd.N; const f = Math.fround;
    const fr = (v) => v - Math.floor(v);
    const grH = (px, py) => { let a = fr(px * 0.1031), bb = fr(py * 0.1031), c = fr(px * 0.1031); const d = a * (bb + 33.33) + bb * (c + 33.33) + c * (a + 33.33); a += d; bb += d; c += d; return fr((a + bb) * c); };
    const cx = Math.floor(x / GC), cz = Math.floor(z / GC), h0 = N >> 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const gx = cx + i - h0, gz = cz + j - h0;
      const h1 = grH(gx, gz), h2 = grH(gx + 17.3, gz + 17.3), h3 = grH(gx - 41.7, gz - 41.7);
      let wx = (gx + 0.5 + (h1 - 0.5) * 0.9) * GC, wz = (gz + 0.5 + (h2 - 0.5) * 0.9) * GC;
      const kx = Math.floor(wx / 2.4), kz = Math.floor(wz / 2.4), kcx = (kx + 0.5 + (grH(kx + 211, kz + 211) - 0.5) * 0.7) * 2.4, kcz = (kz + 0.5 + (grH(kx + 307, kz + 307) - 0.5) * 0.7) * 2.4;
      const kt = Math.min(1, Math.max(0, Math.hypot(wx - kcx, wz - kcz) / 1.7)), gcl = 1.5 + (0.4 - 1.5) * kt;
      wx += (kcx - wx) * 0.5; wz += (kcz - wz) * 0.5;
      const d = Math.hypot(wx - x, wz - z); if (d > r) continue;
      const e0 = GR * 0.72, tt = Math.min(1, Math.max(0, (d - e0) / (GR - e0))); const fade = 1 - tt * tt * (3 - 2 * tt);
      const g = M.heightAt(wx, wz); if (g < M.waterY + 0.35 || Math.max(Math.abs(wx), Math.abs(wz)) > M.half - 4) continue;
      const mk = b.userData.gMask; if (mk && mk[Math.floor((wz + M.half) / 4) * 400 + Math.floor((wx + M.half) / 4)]) continue;
      if (b.userData.gTint && h3 * 0.9 + 0.05 > GA(wx, wz)) continue;
      if (fade * (0.6 + 0.7 * h3) * gcl >= 0.35) out.cards++; } }
  let cl = null; W.scene.traverse((o) => { if (o.name === 'clutter') cl = o; });
  if (cl) { const m = new W.THREE.Matrix4(), p = new W.THREE.Vector3(), q = new W.THREE.Quaternion(), s = new W.THREE.Vector3();
    for (let i = 0; i < cl.count; i++) { cl.getMatrixAt(i, m); m.decompose(p, q, s); if (s.x >= 0.35 && Math.hypot(p.x - x, p.z - z) <= r) out.tufts++; } }
  out.perM2 = +((out.cards + out.tufts) / out.area).toFixed(3); out.cardsPerM2 = +(out.cards / out.area).toFixed(3); out.tuftsPerM2 = +(out.tufts / out.area).toFixed(3);
  return out; }"""

# open ground for the grass count: from the audit's ground spot outward, the first point whose 30 m disc is >= 95 % land (>= 0.35 m above the water,
# not under the city mask: streets, plazas and town blocks grow no grass by design); the audit spot itself when it qualifies
GRASSSPOT_JS = r"""([x0, z0, r]) => { const W = window.__LC__.W, M = W.map, b = W._grassBlades, mk = b && b.userData.gMask;
  const GA = (x, z) => { const t = b && b.userData.gTint; if (!t) return 1; const n = t.n, u = (x + M.half) / (2 * M.half) * n - 0.5, v = (z + M.half) / (2 * M.half) * n - 0.5;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(u))), j0 = Math.max(0, Math.min(n - 1, Math.floor(v))), i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    const fu = Math.max(0, Math.min(1, u - Math.floor(u))), fv = Math.max(0, Math.min(1, v - Math.floor(v))), a = (i, j) => t.px[(j * n + i) * 4 + 3] / 255;
    return (a(i0, j0) * (1 - fu) + a(i1, j0) * fu) * (1 - fv) + (a(i0, j1) * (1 - fu) + a(i1, j1) * fu) * fv; };
  const frac = (x, z) => { let n = 0, ok = 0; for (let i = 0; i < 64; i++) { const a = i * 2.39996, d = r * Math.sqrt((i + 0.5) / 64); const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; n++;
      if (M.heightAt(px, pz) < M.waterY + 0.35 || Math.max(Math.abs(px), Math.abs(pz)) > M.half - 4) continue;
      if (mk && mk[Math.floor((pz + M.half) / 4) * 400 + Math.floor((px + M.half) / 4)]) continue; if (GA(px, pz) < 0.5) continue; ok++; } return ok / n; };
  for (let rr = 0; rr < 600; rr += 20) for (let k = 0; k < (rr ? 16 : 1); k++) { const x = x0 + Math.cos(k * 0.3927) * rr, z = z0 + Math.sin(k * 0.3927) * rr;
    const f = frac(x, z); if (f >= 0.95) { const H = M.heightAt(x, z); return { x, z, open: f, moved: rr, spec: [x, H + 0.5, z, x + 8, M.heightAt(x + 8, z + 2) + 0.6, z + 2, 60] }; } }
  return null; }"""

# the grass-sand row's spot: from the audit's ground spot outward, the first point whose 30 m disc (the blade ring's radius on medium: no blade of a
# lawn further out is drawn) is >= 95 % dry NON-grass land - the blade layer's own grass-ness bake < 0.15 (beach / sand band, dry wash, dunes, mud,
# snow, rock), >= 0.35 m over the water, outside the town mask; viewed low (0.5 m, as the grass view). null when the build has no grass-ness bake
SANDSPOT_JS = r"""([x0, z0, r]) => { const W = window.__LC__.W, M = W.map, b = W._grassBlades, mk = b && b.userData.gMask; if (!b || !b.userData.gTint) return null;
  const GA = (x, z) => { const t = b && b.userData.gTint; if (!t) return 1; const n = t.n, u = (x + M.half) / (2 * M.half) * n - 0.5, v = (z + M.half) / (2 * M.half) * n - 0.5;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(u))), j0 = Math.max(0, Math.min(n - 1, Math.floor(v))), i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    const fu = Math.max(0, Math.min(1, u - Math.floor(u))), fv = Math.max(0, Math.min(1, v - Math.floor(v))), a = (i, j) => t.px[(j * n + i) * 4 + 3] / 255;
    return (a(i0, j0) * (1 - fu) + a(i1, j0) * fu) * (1 - fv) + (a(i0, j1) * (1 - fu) + a(i1, j1) * fu) * fv; };
  const frac = (x, z) => { let n = 0, ok = 0; for (let i = 0; i < 64; i++) { const a = i * 2.39996, d = r * Math.sqrt((i + 0.5) / 64); const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; n++;
      if (M.heightAt(px, pz) < M.waterY + 0.35 || Math.max(Math.abs(px), Math.abs(pz)) > M.half - 4) continue;
      if (mk && mk[Math.floor((pz + M.half) / 4) * 400 + Math.floor((px + M.half) / 4)]) continue; if (GA(px, pz) >= 0.15) continue; ok++; } return ok / n; };
  for (let rr = 0; rr < 900; rr += 20) for (let k = 0; k < (rr ? 24 : 1); k++) { const x = x0 + Math.cos(k * 0.2618) * rr, z = z0 + Math.sin(k * 0.2618) * rr;
    const f = frac(x, z); if (f >= 0.95) { const H = M.heightAt(x, z); return { x, z, open: f, moved: rr, spec: [x, H + 0.5, z, x + 8, M.heightAt(x + 8, z + 2) + 0.6, z + 2, 60] }; } }
  return null; }"""

INFO_JS = r"""() => { const W = window.__LC__.W, k = W.kernel, r = k.renderer, op = k.outputPass, b = W._grassBlades, st = W.stormCtl;
  let hemi = null; W.scene.traverse((o) => { if (o.isHemisphereLight) hemi = o; });
  return { tier: W.gfxTier, touch: !!(W._gfx && W._gfx.touch), exposure: r.toneMappingExposure, sun: k.sun ? +k.sun.intensity.toFixed(3) : null, hemi: hemi ? +hemi.intensity.toFixed(3) : null,
    lcGrade: op && op.uniforms && op.uniforms.lcGrade ? op.uniforms.lcGrade.value.toArray() : null, blades: b ? Object.assign({ visible: b.visible }, b.userData.grass) : null,
    waterDefs: W.map && W.map.water ? Object.keys(W.map.water.material.defines || {}).sort() : null, wallVisible: st && st.wall ? st.wall.visible : null,
    programs: r.info.programs ? r.info.programs.length : -1, size: [r.domElement.width, r.domElement.height], dpr: r.getPixelRatio() }; }"""


# ───────────────────────── image measures ─────────────────────────
def decode(url):
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")).astype(np.float32)


def save(url, d, name):
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name), "wb") as f:
        f.write(base64.b64decode(url.split(",", 1)[1]))


def lum(A):
    return (0.2126 * A[..., 0] + 0.7152 * A[..., 1] + 0.0722 * A[..., 2]) / 255.0


def spread(A, part="lower"):
    Lm = lum(A)
    h = Lm.shape[0]
    Lm = Lm[h // 2:] if part == "lower" else Lm
    return float(np.percentile(Lm, 95) - np.percentile(Lm, 5))


def water_mask(A, B):
    return np.abs(A - B).max(axis=2) > 6.0


def lilac_share(A, hz, Bw=None):
    """the share of the frame's pixels above the horizon band (the eye-height horizon + 3 % of the frame: the far wall sits ON the horizon) that the
    storm wall tints lilac: they change when the wall alone is hidden (Bw = that frame) and the change leans violet (red + blue up against green,
    by > 2 / 255) - a purple facade or a cloud is not the storm band. Without Bw: lilac hue 250-320 deg, sat >= 0.10 (reported only)"""
    h = A.shape[0]
    row = int(max(0, min(h, round(hz * h + 0.03 * h))))
    if row <= 2:
        return 0.0, 0
    if Bw is not None:
        D = A[:row] - Bw[:row]
        tint = (np.abs(D).max(axis=2) > 4.0) & ((D[..., 0] + D[..., 2]) * 0.5 - D[..., 1] > 2.0)
        return float(tint.sum()) / float(A.shape[0] * A.shape[1]), row
    X = A[:row] / 255.0
    mx, mn = X.max(axis=2), X.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = X[..., 0], X[..., 1], X[..., 2]
    d = np.maximum(mx - mn, 1e-4)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    lil = (hue >= 250) & (hue <= 320) & (sat >= 0.10) & (mx >= 0.25)
    if Bw is not None:
        lil &= np.abs(A[:row] - Bw[:row]).max(axis=2) > 4.0
    return float(lil.mean()), row


def hf_energy(A, part="upper"):
    Lm = lum(A)
    h = Lm.shape[0]
    Lm = Lm[: h // 2] if part == "upper" else Lm
    lap = np.abs(4 * Lm[1:-1, 1:-1] - Lm[:-2, 1:-1] - Lm[2:, 1:-1] - Lm[1:-1, :-2] - Lm[1:-1, 2:])
    return float(lap.mean())


def ssim(A, B, size=(640, 360)):
    def g(X):
        im = Image.fromarray(np.clip(X, 0, 255).astype(np.uint8)).resize(size, Image.BILINEAR)
        return lum(np.asarray(im).astype(np.float64))
    a, b = g(A), g(B)
    k = 7
    def box(X):
        c = np.cumsum(np.cumsum(np.pad(X, ((1, 0), (1, 0))), 0), 1)
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    mu_a, mu_b = box(a), box(b)
    va, vb, cov = box(a * a) - mu_a ** 2, box(b * b) - mu_b ** 2, box(a * b) - mu_a * mu_b
    C1, C2 = 0.01 ** 2, 0.03 ** 2
    m = ((2 * mu_a * mu_b + C1) * (2 * cov + C2)) / ((mu_a ** 2 + mu_b ** 2 + C1) * (va + vb + C2))
    return float(m.mean())


# ───────────────────────── session helpers ─────────────────────────
def start(s, tier, map_id, mode="standard"):
    s.boot()
    L.dismiss_cards(s)
    s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
    got = s.safe_js("(t) => { const W = window.__LC__.W; return W.setGfx ? JSON.stringify(W.setGfx('tier', t)) : 'no setGfx'; }", tier)
    st = s.start_match(mode, SEED, map_id, enter=True, guard=True)
    s.land(120, protect=True)
    s.freeze_loop()
    s.install_pump()
    s.guard_player(True)
    s.step_frames(12, 1 / 30, render=True)
    info = s.js(INFO_JS)
    return {"setGfx": got, "start": st, "info": info}


def view(s, spec, hide=(), pts=None, settle=None, step=26):
    s.js(SS.SPEC_JS, ["cam:" + ",".join(str(x) for x in spec), {"plant": None}])
    s.step_frames(step, dt=1.0 / 20, render=False)
    s.js(SS.UNPIN_JS)
    if settle is not None:
        s.js(SETTLE_JS, settle)
    return s.js(RENDER_JS, [spec, list(hide), pts])


def shoot(s, spec, shots, name, hide=(), pts=None, settle=None):
    r = view(s, spec, hide, pts, settle)
    save(r["png"], shots, name + ".png")
    r["A"] = decode(r.pop("png"))
    return r


# ───────────────────────── parts ─────────────────────────
def part_map(s, v, R, map_id, shots, want, interiors=True):
    M = R.setdefault(map_id, {})
    cams = s.js(CAMS_JS)
    M["cams"] = {k: (vv if k.startswith("_") else [round(x, 2) for x in vv]) for k, vv in cams.items() if vv is not None}
    st = s.js(STORM_JS)
    M["stormAtViews"] = st
    tag = map_id
    # ---- storm-early: the pre-close views, lilac above the horizon
    if "storm" in want:
        pre = {}
        early = st is not None and st["phase"] <= 1 and not st["closing"]
        for nm in ("vista", "vista2", "ground", "ground2", "shore"):
            if nm in cams and cams[nm]:
                r = shoot(s, cams[nm], shots, "%s_%s" % (tag, nm), settle=100.0)
                r2 = s.js(RENDER_JS, [cams[nm], ["wall"], None])          # the same frame, the wall alone hidden (no frame stepped between)
                sh, row = lilac_share(r["A"], r["horizon"], decode(r2["png"]))
                pre[nm] = {"lilacPct": round(sh * 100, 4), "horizonRow": row}
        M["stormEarly"] = {"views": pre, "early": early, "state": st}
    # ---- light: ground spread, drop mean, interiors
    if "light" in want:
        sp = {}
        for nm in ("ground", "ground2", "groundlow"):
            if nm in cams and cams[nm]:
                r = shoot(s, cams[nm], shots, "%s_%s_l" % (tag, nm), settle=VIEW_T)
                sp[nm] = round(spread(r["A"]), 4)
        M["spread"] = sp
        dspec = s.js(SS.SPEC_JS, ["drop", {"dropAt": SS.DEF_DROP[map_id], "streetAt": SS.DEF_STREET[map_id], "plant": None}])
        s.js(SS.UNPIN_JS)
        if dspec:
            ed = s.js(EDGE_JS, [list(EDGE_OFF)])
            epts = edge_pts(ed[0], ed[1]) if ed[1] > -900 else None
            r = shoot(s, dspec, shots, "%s_drop" % tag, pts=epts, settle=VIEW_T)
            M["dropMean"] = round(float(lum(r["A"]).mean()), 4)
            if epts:
                M["seaEdge"] = edge_step(r, ed[2])
                # wet sand from the air: the same frame, water hidden, with the wet term on / off (uLcWetK.x = 0); judged on the DRY LAND only (pixels the
                # water does not cover in the live frame - the term also darkens the seabed under the water, which is not this row's): the share of the
                # drop view it darkens by > 0.02
                Bw = decode(s.js(RENDER_JS, [dspec, ["water"], None])["png"])
                wk = s.js("() => { const u = window.__LC__.W._lcU.uLcWetK.value; const x = u.x; u.x = 0; return x; }")
                Cw = decode(s.js(RENDER_JS, [dspec, ["water"], None])["png"])
                s.js("(x) => { window.__LC__.W._lcU.uLcWetK.value.x = x; return 1; }", wk)
                land = ~water_mask(r["A"], Bw)
                d = lum(Cw) - lum(Bw)
                M["wetDrop"] = {"wetK": wk, "landPct": round(float(land.mean() * 100), 2), "darkenedPct": round(float(((d > 0.02) & land).mean() * 100), 3),
                                "ofLandPct": round(float(((d > 0.02) & land).sum() / max(1, land.sum()) * 100), 2)}
        if interiors:
            rooms = s.js(ROOMS_JS, [SS.DEF_DROP[map_id]])
            im = []
            for i, rm in enumerate(rooms):
                r = shoot(s, rm["spec"], shots, "%s_room%d" % (tag, i), settle=VIEW_T)
                im.append({"house": rm["id"], "mean": round(float(lum(r["A"]).mean()), 4)})
            M["interiors"] = im
    # ---- grass: density at the ground camera + the blade A/B in the low ground view
    if "grass" in want and cams.get("_ground"):
        g = s.js(GRASSSPOT_JS, [cams["_ground"]["x"], cams["_ground"]["z"], 30.0]) or cams["_ground"]
        gspec = g.get("spec") or cams["groundlow"]
        s.js(SS.SPEC_JS, ["cam:" + ",".join(str(x) for x in gspec), {"plant": None}])
        s.step_frames(26, dt=1.0 / 20, render=False)
        M["grass"] = s.js(GRASS_JS, [g["x"], g["z"], 30.0])
        M["grass"]["spot"] = {k: g.get(k) for k in ("x", "z", "open", "moved")}
        s.js(SS.UNPIN_JS)
        a = shoot(s, gspec, shots, "%s_grass_on" % tag, settle=VIEW_T)
        b = shoot(s, gspec, shots, "%s_grass_off" % tag, hide=("blades",), settle=VIEW_T)
        h = a["A"].shape[0]
        M["grass"]["bladePixPct"] = round(float((np.abs(a["A"] - b["A"]).max(axis=2)[h // 2:] > 6).mean() * 100), 2)
        M["grass"]["groundSpreadNoBlades"] = round(spread(b["A"]), 4)
    # ---- grass-sand: the blade layer stands on grass only - a low view over non-grass ground (sand / dunes / mud / snow), blades A/B
    if "grass" in want and cams.get("_ground"):
        sp = s.js(SANDSPOT_JS, [cams["_ground"]["x"], cams["_ground"]["z"], 30.0])
        if sp:
            a = shoot(s, sp["spec"], shots, "%s_sand_on" % tag, settle=VIEW_T)
            b = shoot(s, sp["spec"], shots, "%s_sand_off" % tag, hide=("blades",), settle=VIEW_T)
            h = a["A"].shape[0]
            M["grassSand"] = {"spot": {k: sp.get(k) for k in ("x", "z", "open", "moved")},
                              "bladePixPct": round(float((np.abs(a["A"] - b["A"]).max(axis=2)[h // 2:] > 6).mean() * 100), 3)}
        else:
            M["grassSand"] = None
    # ---- water
    if "water" in want and cams.get("_shore"):
        W_ = M.setdefault("water", {})
        per = {}
        for t in SHORE_T:
            r = shoot(s, cams["inwater"], shots, "%s_inwater_t%.3f" % (tag, t), settle=t)
            per["%.3f" % t] = round(spread(r["A"]), 4)
        W_["inwaterSpreadByClock"] = per
        W_["inwaterSpread"] = min(per.values())                      # (judged at the worst phase of the bob)
    if "water" in want and cams.get("_deep"):
        W_ = M.setdefault("water", {})
        for nm in ("sunward", "sunaway"):
            a = shoot(s, cams[nm], shots, "%s_%s" % (tag, nm), settle=VIEW_T)
            b = shoot(s, cams[nm], shots, "%s_%s_nowater" % (tag, nm), hide=("water",), settle=VIEW_T)
            m = water_mask(a["A"], b["A"])
            Lm = lum(a["A"])
            n = int(m.sum())
            W_[nm] = {"waterPx": n, "brightPct": round(float((Lm[m] >= 0.9).mean() * 100) if n else 0.0, 4), "p99": round(float(np.percentile(Lm[m], 99)), 3) if n else None}
        a = shoot(s, cams["horizon"], shots, "%s_fresnel_horizon" % tag, settle=VIEW_T)
        b = shoot(s, cams["horizon"], shots, "%s_fresnel_horizon_nowater" % tag, hide=("water",), settle=VIEW_T)
        m = water_mask(a["A"], b["A"])
        hh = a["A"].shape[0]
        row = int(round(a["horizon"] * hh))
        band = np.zeros_like(m)
        band[min(hh, row + int(0.02 * hh)): min(hh, row + int(0.12 * hh))] = True
        Lm = lum(a["A"])
        hv = float(Lm[m & band].mean()) if (m & band).sum() > 200 else None
        a2 = shoot(s, cams["down"], shots, "%s_fresnel_down" % tag, settle=VIEW_T)
        b2 = shoot(s, cams["down"], shots, "%s_fresnel_down_nowater" % tag, hide=("water",), settle=VIEW_T)
        m2 = water_mask(a2["A"], b2["A"])
        c = np.zeros_like(m2)
        H2, W2 = c.shape
        c[int(H2 * 0.3): int(H2 * 0.7), int(W2 * 0.3): int(W2 * 0.7)] = True
        dv = float(lum(a2["A"])[m2 & c].mean()) if (m2 & c).sum() > 200 else None
        W_["fresnel"] = {"horizon": round(hv, 4) if hv is not None else None, "down": round(dv, 4) if dv is not None else None,
                         "ratio": round(hv / dv, 3) if hv and dv else None, "bandPx": int((m & band).sum()), "downPx": int((m2 & c).sum())}
    if "water" in want and cams.get("_shore"):
        W_ = M.setdefault("water", {})
        sh = cams["_shore"]
        byc = {}
        for t in SHORE_T:
            s.js(SETTLE_JS, t)                                          # (the transect's waterline is the surface at THIS clock)
            tr = s.js(TRANSECT_JS, [sh["x"], sh["z"], sh["dx"], sh["dz"]])
            pts = [p[:3] for row in tr for p in row]
            a = shoot(s, cams["shoretop"], shots, "%s_shoretop_t%.3f" % (tag, t), pts=pts, settle=t)
            b = shoot(s, cams["shoretop"], shots, "%s_shoretop_nowater_t%.3f" % (tag, t), hide=("water",), pts=pts, settle=t)
            byc["%.3f" % t] = shore_measure(a, b, tr)
        W_["shore"] = byc
    # ---- underwater (from below)
    if "uw" in want and cams.get("underup"):
        r = shoot(s, cams["underup"], shots, "%s_underup" % tag, settle=VIEW_T)
        M["underup"] = {"hf": round(hf_energy(r["A"]), 5), "uw": s.safe_js("() => window.__LC__.W._uw", default=None)}
    return M


# far sea: the sea plane is 3.5x the map, the ground (seabed) under it only 1x. Points on the water along the four map edges at -100 / -60 / -20 / +20 m
# across the edge (41 per edge): the step across the edge |L(+20) - L(-20)| against the same 40 m step well inside |L(-60) - L(-100)|
EDGE_OFF = (-100, -60, -20, 20)


# per (sample, side): True when the ground at the three inside points is open sea (>= 1 m under the water): a land edge (Deepwood) is not judged
EDGE_JS = r"""([off]) => { const M = window.__LC__.W.map, half = M.half, wy = (typeof M.waterY === 'number') ? M.waterY : -999, ok = [];
  for (let i = 0; i < 41; i++) { const t = -0.95 + 1.9 * i / 40;
    const P = [(o) => [half + o, t * half], (o) => [-half - o, t * half], (o) => [t * half, half + o], (o) => [t * half, -half - o]];
    for (const f of P) ok.push(off.filter((o) => o < 0).every((o) => { const q = f(o); return M.heightAt(q[0], q[1]) < wy - 1; })); }
  return [half, wy, ok]; }"""


def edge_pts(half, wy):
    pts = []
    for i in range(41):
        t = -0.95 + 1.9 * i / 40
        for o in EDGE_OFF:
            pts += [[half + o, wy, t * half], [-half - o, wy, t * half], [t * half, wy, half + o], [t * half, wy, -half - o]]
    return pts


def edge_step(r, sea):
    Lm = lum(r["A"])
    Hh, Ww = Lm.shape
    P = r["proj"]

    def at(q):
        if q[2] >= 1 or not (0 <= q[0] < 1 and 0 <= q[1] < 1):
            return None
        return float(Lm[int(q[1] * Hh), int(q[0] * Ww)])
    steps, ctrl = [], []
    for i in range(41):
        for side in range(4):
            v = [at(P[(i * len(EDGE_OFF) + o) * 4 + side]) for o in range(len(EDGE_OFF))]
            if None in v or not sea[i * 4 + side]:
                continue
            steps.append(abs(v[3] - v[2]))
            ctrl.append(abs(v[1] - v[0]))
    return {"n": len(steps), "stepP90": round(float(np.percentile(steps, 90)), 4) if steps else None,
            "insideP90": round(float(np.percentile(ctrl, 90)), 4) if ctrl else None}


def shore_measure(a, b, tr):
    A, B = a["A"], b["A"]
    Hh, Ww = A.shape[:2]
    m = water_mask(A, B)
    Lm = lum(A)
    X = A / 255.0
    sat = (X.max(axis=2) - X.min(axis=2)) / np.maximum(X.max(axis=2), 1e-4)
    # the deep-water reference: water pixels > 3 m out on the transects
    proj = a["proj"]
    k = 0
    rows = []
    deepL = []
    for row in tr:
        rec = []
        for p in row:
            q = proj[k]
            k += 1
            x, y = int(q[0] * Ww), int(q[1] * Hh)
            if 0 <= x < Ww and 0 <= y < Hh:
                rec.append((p[3], p[4], float(Lm[y, x]), float(sat[y, x]), bool(m[y, x])))
            else:
                rec.append(None)
        rows.append(rec)
        wl = min([r[0] for r in rec if r and r[1] < 0.0] or [None]) if any(r and r[1] < 0.0 for r in rec) else None
        if wl is not None:
            deepL += [r[2] for r in rec if r and r[1] < 0.0 and r[0] >= wl + 3.5 and r[4]]
    ref = float(np.percentile(deepL, 90)) if deepL else None
    widths, wets = [], []
    for rec in rows:
        rec = [r for r in rec if r]
        wet = [r[2] for r in rec if 0.05 <= r[1] <= 0.9 and not r[4]]
        dry = [r[2] for r in rec if 1.2 <= r[1] <= 2.0 and not r[4]]
        if wet and dry:
            wets.append(float(np.mean(wet)) / max(1e-4, float(np.mean(dry))))
        if ref is None:
            continue
        # the foam run: walking seaward from the waterline over this transect's water points, white points (>= ref + 0.10, saturation
        # <= 0.22, on the water mask) that start within 0.3 m of the waterline; holes of up to 0.2 m in the pattern do not end the run
        line = sorted([r for r in rec if r[1] < 0.0], key=lambda r: r[0])
        n = 0.0
        if line:
            t0, tw, first = line[0][0], None, None
            for r in line:
                white = r[4] and r[2] >= ref + 0.10 and r[3] <= 0.22
                if first is None:
                    if white and r[0] - t0 <= 0.3:
                        first = tw = r[0]
                    elif r[0] - t0 > 0.3:
                        break
                elif white:
                    tw = r[0]
                elif r[0] - tw > 0.25:
                    break
            n = (tw - first + 0.1) if first is not None else 0.0
        else:
            n = None                                     # no waterline on this transect (in frame): never a pass of the lip row
        widths.append(round(n, 2) if n is not None else None)
    return {"deepRef": round(ref, 4) if ref is not None else None, "foamWidths": widths, "foamMedian": float(np.median([w for w in widths if w is not None])) if any(w is not None for w in widths) else None,
            "wetRatios": [round(x, 3) for x in wets], "wetMedian": float(np.median(wets)) if wets else None}


def part_storm_late(s, v, R, map_id, shots):
    st = s.js(STORM_JS)
    if not st or not st["tl"]:
        return {"err": "no storm timeline"}
    target = st["tl"][0]["shrinkStart"] + 8
    out = {"before": st, "target": target}
    import time as _t
    t1 = _t.time()
    while True:
        ff = s.js(FF_JS, [target, st["cx"], st["cz"]])
        if ff["t"] >= target or not ff["alive"] or _t.time() - t1 > 600 or ff["phase"] not in ("match", "drop"):
            break
    out["ff"] = ff
    s.step_frames(20, dt=1.0 / 30, render=False)
    out["after"] = s.js(STORM_JS)
    spec = s.js(WALLCAM_JS, [380])
    a = shoot(s, spec, shots, "%s_stormlate_380" % map_id)
    b = shoot(s, spec, shots, "%s_stormlate_380_nowall" % map_id, hide=("wall",))
    out["delta380Pct"] = round(float((np.abs(a["A"] - b["A"]).max(axis=2) > 4).mean() * 100), 3)
    out["spec380"] = spec
    return out


def part_low(s, v, R, shots, tag):
    """the low tier on isla_viva: 4 views with the map clock pinned (t 100), for the pixel compare with the base. The loot group is hidden in
    these frames (its beams pulse on the sim clock: W.t differs run to run; loot.js is not this lane's file), and so are the launch portals'
    rings / swirls (animated off the frame loop) and the door leaves (bots open them): none of them changed by this lane"""
    cams = s.js(CAMS_JS)
    out = {}
    for nm in ("ground", "groundlow", "shore", "inwater"):
        if nm in cams and cams[nm]:
            r = shoot(s, cams[nm], shots, "%s_low_%s" % (tag, nm), hide=("loot", "portals", "doors"), settle=100.0)
            out[nm] = r["A"]
    return out


def base_cache(args, v, shots):
    """the base build's underwater HF, interiors and low-tier views (second Chrome on BASE_REV), cached"""
    stem = os.path.join(C.REPORTS, "w10_waterlook_base_%s_%dx%d_v7" % (BASE_REV, args.width, args.height))
    if os.path.exists(stem + ".json") and not args.no_cache:
        with open(stem + ".json") as f:
            res = json.load(f)
        res["low"] = {k: np.load(stem + "_low_%s.npy" % k) for k in res.get("lowViews", [])}
        return res, True
    a2 = copy.copy(args)
    a2.rev = BASE_REV
    a2.disk = True
    a2.overlay = None
    a2.plant = None
    res = {}
    with C.Session(a2, "w10_waterlook_base") as s:
        res["info"] = start(s, "medium", "isla_viva")
        R = {}
        part_map(s, v, R, "isla_viva", os.path.join(shots, "base"), {"light", "uw"})
        res["interiors"] = {"isla_viva": R["isla_viva"].get("interiors")}   # (v7: interiors on all 3 maps; v6 had isla_viva only)
        res["underup"] = R["isla_viva"].get("underup")
        res["spread"] = {"isla_viva": R["isla_viva"].get("spread")}
        res["drop"] = {"isla_viva": R["isla_viva"].get("dropMean")}
    for m in ("ashgrid", "deepwood"):
        with C.Session(a2, "w10_waterlook_base_" + m) as s:
            start(s, "medium", m)
            R = {}
            part_map(s, v, R, m, os.path.join(shots, "base"), {"light"})
            res["interiors"][m] = R[m].get("interiors")
            res["spread"][m] = R[m].get("spread")
            res["drop"][m] = R[m].get("dropMean")
    with C.Session(a2, "w10_waterlook_base_low") as s:
        res["infoLow"] = start(s, "low", "isla_viva")
        low = part_low(s, v, R, os.path.join(shots, "base"), "base")
    res["lowViews"] = sorted(low)
    with open(stem + ".json", "w") as f:
        json.dump(res, f, default=str)
    for k, A in low.items():
        np.save(stem + "_low_%s.npy" % k, A)
    res["low"] = low
    return res, False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--maps", default=",".join(MAPS))
    ap.add_argument("--parts", default="storm,light,grass,water,uw,late,low,tiers")
    ap.add_argument("--shots", default=None)
    ap.add_argument("--no-cache", action="store_true", help="re-measure the base build's cached numbers")
    args = L.parse(ap)
    want = set(args.parts.split(","))
    maps = [m for m in args.maps.split(",") if m]
    tag = (args.plant or ("rev-" + args.rev if getattr(args, "rev", None) else "disk"))
    shots = args.shots or os.path.join(C.SHOTS, "waterlook_" + tag)
    os.makedirs(shots, exist_ok=True)

    def plant(s):
        if args.plant:
            for rel, edits in PLANTS[args.plant]:
                L.serve_patched(s, rel, edits)

    def body(v):
        R = v.data["rows"] = {}
        progs = []
        diag = []
        med = {}
        for map_id in maps:
            with C.Session(args, "w10_waterlook") as s:
                plant(s)
                info = start(s, "medium", map_id)
                v.info("%s medium" % map_id, info)
                R.setdefault(map_id, {})["info"] = info["info"]
                p0 = L.programs(s)
                part_map(s, v, R, map_id, shots, want)
                if "tiers" in want and map_id == "isla_viva":
                    c = R[map_id]["cams"]
                    med = {nm: shoot(s, c[nm], shots, "isla_viva_tier_medium_%s" % nm, settle=100.0)["A"] for nm in TIER_VIEWS + TIER_INFO if nm in c}
                if "late" in want and map_id == "isla_viva":
                    R[map_id]["stormLate"] = part_storm_late(s, v, R, map_id, shots)
                s.step_frames(6, 1 / 30, render=True)
                progs.append(["%s medium" % map_id, p0, L.programs(s)])
                L.errors_row(v, s, "0 page errors / console errors / failed requests [%s medium]" % map_id)
                diag.append(s.diagnostics())
        if "low" in want:
            with C.Session(args, "w10_waterlook_low") as s:
                plant(s)
                info = start(s, "low", "isla_viva")
                v.info("isla_viva low", info)
                p0 = L.programs(s)
                R["lowBuild"] = part_low(s, v, R, shots, "build")
                s.step_frames(6, 1 / 30, render=True)
                progs.append(["isla_viva low", p0, L.programs(s)])
                diag.append(s.diagnostics())
        if "tiers" in want:
            for tier in ("high", "ultra"):
                with C.Session(args, "w10_waterlook_" + tier) as s:
                    plant(s)
                    info = start(s, tier, "isla_viva")
                    v.info("isla_viva %s" % tier, info)
                    p0 = L.programs(s)
                    if tier == "ultra":
                        c = s.js(CAMS_JS)
                        ul = {nm: shoot(s, c[nm], shots, "isla_viva_tier_ultra_%s" % nm, settle=100.0)["A"] for nm in TIER_VIEWS + TIER_INFO if nm in c}
                        R["tiersSSIM"] = {nm: round(ssim(ul[nm], med[nm]), 4) for nm in ul if nm in med}
                    else:
                        c = s.js(CAMS_JS)
                        shoot(s, c["ground"], shots, "isla_viva_tier_high_ground", settle=100.0)
                    s.step_frames(6, 1 / 30, render=True)
                    progs.append(["isla_viva %s" % tier, p0, L.programs(s)])
                    diag.append(s.diagnostics())
        R["programs"] = progs
        # ---------------- base numbers
        base = None
        if want & {"uw", "light", "low"}:
            base, cached = base_cache(args, v, shots)
            v.info("base %s (cached %s)" % (BASE_REV, cached), {k: base.get(k) for k in ("underup", "interiors", "spread", "drop")})
        # ---------------- verdict rows
        I = R.get("isla_viva", {})
        if "water" in want:
            ws = {m: R.get(m, {}).get("water", {}) for m in maps if R.get(m, {}).get("water")}
            if not I.get("water"):
                v.cnj("water", "no shore / deep-water camera on isla_viva")
            else:
                det = {m: w.get("inwaterSpread") for m, w in ws.items() if w.get("inwaterSpread") is not None}
                v.check("water-detail: in-water view, luminance p95-p5 of the lower half >= 0.15 (every map with a shore view; the worst of the bob's crest / level / trough clocks)",
                        bool(det) and all(x >= 0.15 for x in det.values()), {m: ws[m].get("inwaterSpreadByClock") for m in det}, ">= 0.15")
                gl = {m: {"sunward": w.get("sunward"), "sunaway": w.get("sunaway")} for m, w in ws.items() if w.get("sunward")}
                ok = bool(gl) and all(x["sunward"]["waterPx"] > 5000 and x["sunward"]["brightPct"] >= 0.5 and x["sunaway"]["waterPx"] > 5000 and x["sunaway"]["brightPct"] == 0.0 for x in gl.values())
                v.check("glint: sun-facing deep-water view >= 0.5 % of water pixels at luminance >= 0.9 (plan 0.3 %, raised: the base reads 0.298 %); facing away 0 %", ok, gl, ">= 0.5 % / 0 %")
                fr = {m: w.get("fresnel") for m, w in ws.items() if w.get("fresnel")}
                v.check("fresnel: water luminance just under the horizon / looking down >= 1.3 (away from the sun)",
                        bool(fr) and all(x.get("ratio") is not None and x["ratio"] >= 1.3 for x in fr.values()), fr, ">= 1.3")
                sh = {m: w.get("shore") for m, w in ws.items() if w.get("shore")}
                ok = bool(sh) and all(len(x) == len(SHORE_T) and all(c.get("foamMedian") is not None and 0.5 <= c["foamMedian"] <= 2.0 and c.get("wetMedian") is not None
                                                                     and c["wetMedian"] <= 0.85 for c in x.values()) for x in sh.values())
                v.check("shore: at the bob's crest, still level AND trough (map clock %s): foam band from the waterline 0.5-2.0 m wide (median of 9 transects); wet band (0.05-0.9 m above the water / 1.2-2.0 m) <= 0.85"
                        % ", ".join("%.3f" % t for t in SHORE_T), ok,
                        {m: {t: {k: c.get(k) for k in ("foamMedian", "wetMedian", "foamWidths", "deepRef")} for t, c in x.items()} for m, x in sh.items()}, "0.5-2.0 m; <= 0.85, every clock")
                # the lip on EVERY transect (not the median): a shore that loses its lip on part of the beach for part of every bob is a fail
                ok = bool(sh) and all(len(x) == len(SHORE_T) and all(len(c.get("foamWidths") or []) == 9 and all(w is not None and w >= 0.3 for w in c["foamWidths"]) for c in x.values()) for x in sh.values())
                v.check("shore lip: every one of the 9 transects has a foam run >= 0.3 m from the waterline at the bob's crest, still level AND trough", ok,
                        {m: {t: c.get("foamWidths") for t, c in x.items()} for m, x in sh.items()}, ">= 0.3 m, 9 of 9, every clock")
        if "storm" in want:
            se = {m: R.get(m, {}).get("stormEarly") for m in maps}
            if not all(x and x["early"] for x in se.values()):
                v.cnj("storm-early", "a map's views were not taken before circle 1 closed: %s" % {m: (x or {}).get("state") for m, x in se.items()})
            else:
                worst = {m: max(q["lilacPct"] for q in x["views"].values()) for m, x in se.items()}
                v.check("storm-early: pre-close views, lilac pixels above the horizon <= 0.1 % (every view, every map)", all(w <= 0.1 for w in worst.values()),
                        {"worstPct": worst, "views": {m: x["views"] for m, x in se.items()}}, "<= 0.1 %")
        if "late" in want:
            sl = I.get("stormLate") or {}
            a = sl.get("after") or {}
            if not a or not a.get("closing") and a.get("phase", 0) <= 1:
                v.cnj("storm-late", "circle 1 was not closing after the fast-forward: %s" % a)
            else:
                v.check("storm-late: circle 1 closing, the wall A/B moves >= 1 % of the frame from 380 m", (sl.get("delta380Pct") or 0) >= 1.0,
                        {k: sl.get(k) for k in ("delta380Pct", "after", "spec380")}, ">= 1 %")
        if "light" in want:
            sp = {m: R.get(m, {}).get("spread") for m in maps}
            means = {m: round(float(np.mean(list(x.values()))), 4) if x else None for m, x in sp.items()}
            v.check("light: ground luminance spread p95-p5 >= 0.25 on every map (mean of ground / ground2 / groundlow, lower half)",
                    all(x is not None and x >= 0.25 for x in means.values()), {"mean": means, "views": sp}, ">= 0.25")
            # OD-2 held: in 0.45-0.55 on every map; a map whose BASE drop view is already outside the band (pre-existing) must not move further out
            bd = (base or {}).get("drop") or {}
            dm = {m: R.get(m, {}).get("dropMean") for m in maps}
            def held(m, x):
                if x is None:
                    return False
                if 0.45 <= x <= 0.55:
                    return True
                b0 = bd.get(m)
                out = lambda y: max(0.45 - y, y - 0.55, 0.0)
                return b0 is not None and not (0.45 <= b0 <= 0.55) and out(x) <= out(b0) + 0.005
            v.check("light: OD-2 drop-view mean held in 0.45-0.55 (every map; a map already outside on the base: not further out)",
                    all(held(m, x) for m, x in dm.items()), {"build": dm, "base": bd}, "0.45-0.55")
            wd = {m: R.get(m, {}).get("wetDrop") for m in maps if (R.get(m, {}).get("wetDrop") or {}).get("wetK")}
            if wd:
                v.check("light: wet sand from the air - the wet-sand term darkens <= 18 % of the dry land in the drop view (a swash band, not whole low islets; by height alone: 28.5 %)",
                        all(x["ofLandPct"] <= 18.0 for x in wd.values()), wd, "<= 18 % of the land")
            se = {m: R.get(m, {}).get("seaEdge") for m in maps if (R.get(m, {}).get("seaEdge") or {}).get("n", 0) >= 8}
            if not se:
                v.cnj("light: far-sea edge", "no drop view shows >= 8 points of the map edge over water: %s" % {m: R.get(m, {}).get("seaEdge") for m in maps})
            else:
                v.check("light: far sea - no colour step along the map edge in the drop view (p90 |L(+20 m) - L(-20 m)| across the edge <= 0.02; well inside the map it reads ~0.01)",
                        all(x["stepP90"] <= 0.02 for x in se.values()), se, "<= 0.02")
            bia = (base or {}).get("interiors") or {}
            if isinstance(bia, list):
                bia = {"isla_viva": bia}                 # (a v6 cache: isla_viva only - never judged as all maps)
            rows, miss = {}, []
            for m in maps:
                bi, ii = bia.get(m) or [], R.get(m, {}).get("interiors") or []
                if not bi or not ii:
                    miss.append("%s (build %d, base %d)" % (m, len(ii), len(bi)))
                    continue
                bm, im = float(np.mean([x["mean"] for x in bi])), float(np.mean([x["mean"] for x in ii]))
                rows[m] = {"build": ii, "base": bi, "ratio": round(im / max(1e-4, bm), 3)}
            if miss:
                v.cnj("light: interiors", "no interior views on %s" % ", ".join(miss))
            else:
                v.check("light: interiors (every map, 3 houses each) mean luminance >= 0.9 x the base's", all(x["ratio"] >= 0.9 for x in rows.values()),
                        rows, ">= 0.9x every map")
        if "grass" in want:
            gr = {m: R.get(m, {}).get("grass") for m in maps}
            ok = all(x and x.get("perM2") is not None and x["perM2"] >= 0.8 and x.get("bladePixPct", 0) >= 8.0 for x in gr.values())
            v.check("grass: medium, >= 0.8 cards + tufts per m2 within 30 m of open ground and the blade layer moves >= 8 % of the lower half (every map)",
                    ok, gr, ">= 0.8 / m2")
        if "grass" in want:
            gs_ = {m: R.get(m, {}).get("grassSand") for m in maps}
            judged = {m: x for m, x in gs_.items() if x}
            if not judged:
                v.cnj("grass-sand", "no map has a 30 m disc of >= 95 %% dry non-grass ground (or the build has no grass-ness bake): %s" % gs_)
            else:
                v.check("grass-sand: the blade layer grows on grass only - a low view over dry non-grass ground (a 30 m disc >= 95 % sand / dunes / mud / snow), the blades A/B moves <= 0.5 % of the lower half (every map with such a spot)",
                        all(x["bladePixPct"] <= 0.5 for x in judged.values()), gs_, "<= 0.5 %")
        if "low" in want:
            bl, lb = (base or {}).get("low") or {}, R.get("lowBuild") or {}
            res = {}
            for nm in sorted(set(bl) | set(lb)):
                if nm in bl and nm in lb and bl[nm].shape == lb[nm].shape:
                    d = np.abs(bl[nm] - lb[nm]).max(axis=2)
                    res[nm] = {"maxDiff": float(d.max()), "pctDiff": round(float((d > 0).mean() * 100), 4)}
                else:
                    res[nm] = {"missingOrSize": [nm in bl, nm in lb]}
            # identical up to the sim's own noise: the base build against its own cache (control --rev cbf0a1ff) differs in ONE pixel of one view
            # (0.0001 %: a far object the sim moves between runs); <= 0.001 % (9 px at 1280 x 720) per view - the grass-on-low plant moves 0.2-12 %
            v.check("low-identical: low tier, isla_viva, the views identical to the base build (<= 0.001 % of the pixels differ per view: the base's own run-to-run noise is 1 px)",
                    bool(res) and len(res) >= 3 and all(x.get("pctDiff") is not None and x["pctDiff"] <= 0.001 for x in res.values()), res, "<= 0.001 %")
            for nm in lb:
                Image.fromarray(np.clip(np.abs(lb[nm] - bl.get(nm, lb[nm])) * 8, 0, 255).astype(np.uint8)).save(os.path.join(shots, "lowdiff_x8_%s.png" % nm))
        if "uw" in want:
            bu, uu = (base or {}).get("underup") or {}, I.get("underup") or {}
            if not bu or not uu:
                v.cnj("underwater", "no under-water view (build %s, base %s)" % (bool(uu), bool(bu)))
            else:
                rat = uu["hf"] / max(1e-6, bu["hf"])
                v.check("underwater: from below, high-frequency energy of the sky region <= 0.4 x the base's", rat <= 0.4,
                        {"build": uu, "base": bu, "ratio": round(rat, 3)}, "<= 0.4x")
        if "tiers" in want:
            ts = R.get("tiersSSIM") or {}
            tv = {k: x for k, x in ts.items() if k in TIER_VIEWS}
            v.check("tiers: SSIM(ultra, medium) on the 3 eye-level pinned views (ground, inwater, shore) <= 0.92 (a visible difference); vista / vista2 reported",
                    len(tv) == 3 and all(x <= 0.92 for x in tv.values()), {"judged": tv, "info": {k: ts.get(k) for k in TIER_INFO}}, "<= 0.92")
        v.check("programs: 0 new shader programs after the warm frames, every tier", all(a is not None and b is not None and b <= a for _, a, b in progs), progs, "no increase")
        sh_err = [x for d in diag for x in (d.get("shader") or [])]
        v.check("0 shader errors", not sh_err, sh_err[:4])
        # data for the report: drop the arrays
        R.pop("lowBuild", None)
    return C.run_gate("w10_waterlook", body, args)


if __name__ == "__main__":
    sys.exit(main())
