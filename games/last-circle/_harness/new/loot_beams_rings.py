#!/usr/bin/env python
"""loot_beams_rings - LOOT lane (Wave 4) gate for look plan P1.3: rarity light beams + glowing floor rings as instanced draws.

    python _harness/new/loot_beams_rings.py --disk [--only gpusync,pools,clamp,ceilpix,pickup,deaths,chestview,rings,glare,stormfade] [--shots DIR]
    python _harness/new/loot_beams_rings.py --disk --only gpusync --plant flush-clear      # falsifier: MUST fail gpusync
    python _harness/new/loot_beams_rings.py --disk --only stormfade --plant storm-ignore   # falsifier: MUST fail stormfade
    python _harness/new/loot_beams_rings.py --disk --tier low [--only rings,glare,pools]   # the LOW tier (no composer: the frame is drawn straight to the canvas)
    python _harness/new/loot_isowrap.py new/loot_beams_rings.py ...                         # git HEAD + only the working-copy loot.js

One standard match on isla_viva seed 7 (the research's measured seed: 124 weapons / 157 ammo / 65 consumables / 51 chests). Rows:

  gpusync    what the GPU draws == the module's CPU slot state: the frame as the game left it vs the same frame after a forced
             FULL re-upload of every marker attribute, after the landing skip (player view), after a 20 s sim-only skip (250 m up)
             and after 90 rendered frames of 3 sim ticks each - 0 differing pixels (a lost update range = a ghost marker of a
             taken item). Falsifier: --plant flush-clear serves loot.js with the pre-fix flush and must FAIL this row

  pools      the markers are THREE instanced meshes (loot-rings / loot-beams / loot-glows) at renderOrder >= 6; the loot group holds no
             per-item ring torus and no sprite; the three add exactly 3 draw calls (renderer.info delta, markers shown vs hidden);
             census: every floor weapon has a ring and a beam, ammo / consumables a ring and NO beam, every chest ring + beam + glow;
             beam heights follow the rarity table (common ~2 m ... legendary ~14 m) when nothing is above them
  clamp      EVERY beam's drawn top <= the underside of the first collider above it - 4 cm, checked against an independent brute-force
             pass over ALL map colliders (not the spatial grid the module used); the under-roof census is printed (research: 69 of 346
             floor items and 17 of 51 chests on this seed before bots take any)
  ceilpix    no beam PIXEL above a ceiling collider (samples: the most-clamped under-roof beams 30 m apart, up to 12 candidates, until 3 have a framed view whose
             un-clamped control shows the beam - Wave 7: town buildings hide the first 3 on Savanna): for under-roof beams the scene is rendered (float RT, no bloom) with beams shown
             and hidden from outside the building; the column above the projected ceiling must be identical. CONTROL: the same view
             with the clamp deliberately removed (the beam's drawn height forced to nominal) MUST show beam pixels there - a probe
             that cannot fail is reported as could-not-judge
  pickup     picking an item (E / walkover path), a net take mirror, and opening a chest each park their ring / beam / glow slot (zero
             matrix, free list) and the region renders identically with the markers hidden afterwards (and does NOT before)
  deaths     a killed bot's drops: every dropped item has a ring and a glow, every dropped weapon also a beam (and takes them away on pickup)
  chestview  from 250 m up (the glider) the chest beams are still drawn: >= 70 % of the OPEN-SKY chests within 900 m in view, whose beam top is in LINE OF SIGHT,
             show beam pixels. Open sky = no collider above the beam's footprint (the module's recorded ceiling is null, i.e. the beam is drawn at its nominal
             height). A chest under a roof has its beam clamped under that roof BY DESIGN (the clamp / ceilpix rows judge those): on Savanna the chests stand
             inside the town buildings, so the old all-chests count read the roofs, not the beacons. Line of sight: the segment from the camera to the top of the
             beam (0.2 m below it) crosses no terrain and no collider with a footprint >= 3 x 3 m (a building or a slab; trees, rocks, props and cars do not count):
             a downtown skyline 40 m high hides what stands behind it from a 250 m glider 600 m away, and a beam that is not drawn because a tower is in front
             of it is not a missing beam (Wave 7, lane 7D; the roofed and the hidden counts are printed). Falsifier: --plant chest-beams-short serves loot.js with every beam's fade-out
             distance capped at 60 m and must FAIL this row on any map (no beam pixel is left from 250 m)
  rings      A/B (ring shown / hidden, same frame state, scene + beams + glows otherwise identical): on SAND, GRASS and WOOD (a wooden
             structure top) each rarity ring's band pixels read as the rarity colour (hue error < 15 deg on the displayed pixel) at
             >= 1.4x the floor luminance (scene-linear HDR, pre-bloom, pre-tonemap)
  stormfade  C-LOOT-RENDER: beams fade beyond the storm circle. (a) the module follows W.stormU (a provider whose numbers the gate controls),
             (b) a legendary beam: drawn inside the circle (and with no circle, r = 1e9 - no NaN from the smoothstep), about half faded 6 m beyond
             the edge, gone 24 m beyond it (own-slot A/B pixels), (c) with W.stormU absent the module reads the sim's circle itself and lands on the
             same numbers, (d) where a provider already exists (the merged tree) the uniform equals it after a frame
  glare      INFORMATION: beam axis radiance vs the pixel behind it, and the bloom-weighted luminance of the beam's own contribution
             (common / uncommon must stay under the 0.72 bloom threshold), per rarity
  errors     0 page errors, 0 console errors, 0 failed requests, 0 shader errors from the loot materials (a shader error from another
             lane's material is printed as information with its material name)

Exit 0 pass / 1 fail / 2 could-not-judge. Milliseconds are never judged.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402

try:
    import numpy as np
    from PIL import Image
except Exception:  # pragma: no cover
    np = None
    Image = None

RARITY_HEX = {0: "#9da5b4", 1: "#3ec46d", 2: "#3fa9f5", 3: "#b05cf0", 4: "#f2a33c"}
RARITY_NAME = ["common", "uncommon", "rare", "epic", "legendary"]
BEAM_NOMINAL = {0: 2.0, 1: 4.0, 2: 7.0, 3: 10.5, 4: 14.0}

LG_JS = r"""() => {
  if (window.__LG__) return 'already';
  const W = window.__LC__.W, k = W.kernel, r = k.renderer, THREE = W.THREE;
  const LG = window.__LG__ = {};
  const cvs = r.domElement;
  const b64 = (buf) => { let s = ''; const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength); const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  LG.canvas = () => [cvs.width, cvs.height];
  LG.tp = (x, z, y) => { const p = W.player; p.pos.x = x; p.pos.z = z; p.pos.y = (y == null ? W.map.heightAt(x, z) : y) + 0.05;
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } return [p.pos.x, p.pos.y, p.pos.z]; };
  LG.face = (tx, tz, pitch, yawOff) => { const p = W.player; const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const y = Math.atan2(-dx, -dz) + (yawOff || 0); p.input.yaw = y; p.yaw = y; p.input.pitch = pitch; return y; };
  LG.project = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(W.camera);
    return [(v.x * 0.5 + 0.5) * cvs.width, (1 - (v.y * 0.5 + 0.5)) * cvs.height, v.z]; };
  LG.vis = (rings, beams, glows) => { const m = W.debugLootFx().meshes; m[0].visible = !!rings; m[1].visible = !!beams; m[2].visible = !!glows; };
  // hide ONE object's own slots (pairs of [meshIndex 0 rings / 1 beams / 2 glows, slot]) and restore them exactly: an A/B of a
  // single marker, so a far beam that happens to share the measured pixels (chest beams are drawn to 1.8 km) cannot pollute it
  LG._saved = [];
  LG.hide = (pairs) => { const m = W.debugLootFx().meshes;
    for (const [mi, s] of pairs) { if (s == null || s < 0) continue; const a = m[mi].instanceMatrix, o = s * 16;
      LG._saved.push([mi, s, Array.from(a.array.slice(o, o + 16))]); a.array.fill(0, o, o + 16); a.clearUpdateRanges(); a.needsUpdate = true; }
    return LG._saved.length; };
  LG.unhide = () => { const m = W.debugLootFx().meshes;
    for (const [mi, s, v] of LG._saved) { const a = m[mi].instanceMatrix; a.array.set(v, s * 16); a.clearUpdateRanges(); a.needsUpdate = true; }
    LG._saved = []; return 'ok'; };
  LG.spawn = (id, data, x, z, y) => { W.netSpawnItem({ id, data, x, y: y == null ? W.map.heightAt(x, z) + 0.15 : y, z }); return W.debugLootFx(id).obj; };
  LG.info = (id) => { const d = W.debugLootFx(id); return d && d.obj ? d.obj : null; };
  // one measured frame: hdr = the scene (no composer, no bloom, no tone map) into a private FLOAT target; srgb = the composed frame
  // exactly as displayed. rect = [x, y, w, h] in canvas px, top-left origin.
  LG.frame = (rect, wantHdr, wantSrgb) => {
    const out = {}; const w = cvs.width, h = cvs.height; const [x, y, rw, rh] = rect;
    if (wantHdr) {
      if (!LG.rt || LG.rt.width !== w || LG.rt.height !== h) { if (LG.rt) LG.rt.dispose();
        LG.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true }); }
      const prev = r.getRenderTarget();
      r.setRenderTarget(LG.rt); r.clear(); r.render(k.scene, k.camera);
      const buf = new Float32Array(rw * rh * 4); r.readRenderTargetPixels(LG.rt, x, h - y - rh, rw, rh, buf);
      r.setRenderTarget(prev); out.hdr = b64(buf);
    }
    if (wantSrgb) {
      if (k.composer) k.composer.render(0); else { r.setRenderTarget(null); r.render(k.scene, k.camera); }
      const gl = r.getContext(); r.setRenderTarget(null);
      const buf = new Uint8Array(rw * rh * 4); gl.readPixels(x, h - y - rh, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      out.srgb = b64(buf);
    }
    return out;
  };
  // free spot search: terrain height in [lo, hi] over a (2*span)^2 patch, max relief, no collider within span + 3 m
  LG.findSpot = (lo, hi, span, maxRel, from, minFrom) => {
    const M = W.map, half = M.half * 0.78; let best = null;
    for (let x = -half; x <= half; x += 9) for (let z = -half; z <= half; z += 9) {
      const h0 = M.heightAt(x, z); if (h0 < lo || h0 > hi) continue;
      let ok = true, mn = 1e9, mx = -1e9;
      for (let dx = -span; dx <= span && ok; dx += span / 2) for (let dz = -span; dz <= span; dz += span / 2) {
        const q = M.heightAt(x + dx, z + dz); if (q < lo - 0.25 || q > hi + 0.25) { ok = false; break; } mn = Math.min(mn, q); mx = Math.max(mx, q); }
      if (!ok || mx - mn > maxRel) continue;
      if (M.queryColliders(x, z, span + 3, []).length) continue;
      if (from && Math.hypot(x - from[0], z - from[1]) < (minFrom || 0)) continue;
      const rel = mx - mn; if (!best || rel < best.rel) best = { x, z, h: h0, rel };
    }
    return best;
  };
  // WOOD: no map in this build has a wooden floor (house floors are the terrain), so the wood case drapes a wood-brown, lit, shadow-receiving
  // plane over the terrain 3 cm up (below the ring's 6.5 cm), exactly like a plank deck would sit. Gate-only object, removed afterwards.
  LG.planks = [];
  LG.plank = (cx, cz, half, hex) => { const M = W.map; const geo = new THREE.PlaneGeometry(half * 2, half * 2, 24, 24); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = cx + pos.getX(i), z = cz + pos.getZ(i); pos.setXYZ(i, x, M.heightAt(x, z) + 0.03, z); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0 }));
    m.receiveShadow = true; m.name = '__lg_plank'; W.scene.add(m); LG.planks.push(m); return LG.planks.length; };
  LG.unplank = () => { for (const m of LG.planks) { W.scene.remove(m); m.geometry.dispose(); m.material.dispose(); } LG.planks = []; return 'ok'; };
  // independent re-cast for the clamp row: brute force over ALL colliders (the module uses the spatial grid)
  LG.ceilBrute = (x, z, floor, rad) => { let c = Infinity, by = null;
    for (const o of W.map.colliders) { if (o.dead) continue;
      if (o.maxX < x - rad || o.minX > x + rad || o.maxZ < z - rad || o.minZ > z + rad) continue;
      if (o.minY > floor + 0.6 && o.minY < c) { c = o.minY; by = [o.minX, o.maxX, o.minZ, o.maxZ, o.maxY]; } }
    return { ceil: c === Infinity ? null : c, by }; };
  return 'ok';
}"""

CENSUS_JS = r"""() => {
  const W = window.__LC__.W, g = W.group('loot'), d = W.debugLootFx();
  let torus = 0, sprites = 0; const inst = [];
  g.traverse((o) => { if (o.isSprite) sprites++; if (o.isMesh && o.geometry && o.geometry.type === 'TorusGeometry') torus++;
    if (o.isInstancedMesh && /^loot-(rings|beams|glows)$/.test(o.name)) inst.push({ name: o.name, ro: o.renderOrder, count: o.count, inGroup: o.parent === g }); });
  const rows = [];
  for (const it of W.debugItems()) { const o = W.debugLootFx(it.id).obj; if (!o) continue;
    rows.push({ id: it.id, kind: it.data.kind, did: it.data.id, r: it.data.rarity || 0, ring: o.ring ? o.ring.slot : -1, beam: o.beam ? o.beam.slot : -1,
                glow: o.glow ? o.glow.slot : -1, ringAlive: !!(o.ring && o.ring.alive), top: o.beam ? o.beam.top : null, by: o.beam ? o.beam.y : null,
                nominal: o.beam ? o.beam.nominal : null, size: o.beam ? o.beam.size : null, x: it.pos.x, y: it.pos.y, z: it.pos.z, ceil: o.ceil === Infinity ? null : o.ceil,
                th: W.map.heightAt(it.pos.x, it.pos.z) }); }
  const chests = W.debugChests().map((c) => { const o = W.debugLootFx(c.id).obj; return { id: c.id, opened: c.opened, ring: c.ring, beam: c.beam, glow: c.glow,
      top: o && o.beam ? o.beam.top : null, by: o && o.beam ? o.beam.y : null, nominal: o && o.beam ? o.beam.nominal : null, x: c.pos.x, y: c.pos.y, z: c.pos.z, ceil: c.ceil === Infinity ? null : c.ceil }; });
  return { torus, sprites, inst, rows, chests, fx: { beams: d.beams, rings: d.rings, glows: d.glows } };
}"""

CALLS_JS = r"""() => {
  const W = window.__LC__.W, k = W.kernel, r = k.renderer, m = W.debugLootFx().meshes;
  const was = r.info.autoReset; r.info.autoReset = false;
  const run = () => { r.info.reset(); if (k.composer) k.composer.render(0); else r.render(k.scene, k.camera); return r.info.render.calls; };
  const vis = m.map((o) => o.visible);
  m.forEach((o) => { o.visible = true; }); const on = run();
  m.forEach((o) => { o.visible = false; }); const off = run();
  m.forEach((o, i) => { o.visible = vis[i]; }); r.info.autoReset = was;
  return { on, off, delta: on - off, counts: m.map((o) => o.count) };
}"""


# ───────────────────────────── helpers ─────────────────────────────
def dec_f32(b, w, h):
    a = np.frombuffer(base64.b64decode(b), dtype=np.float32).reshape(h, w, 4)
    return a[::-1].astype(np.float64)               # rows bottom-up -> top-down


def dec_u8(b, w, h):
    a = np.frombuffer(base64.b64decode(b), dtype=np.uint8).reshape(h, w, 4)
    return a[::-1].astype(np.float64)


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def hue_deg(rgb):
    """Vectorised HSV hue in degrees for an (..., 3) array in 0..1."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1); mn = np.min(rgb, axis=-1); d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-9
    rc = np.where(m & (mx == r), ((g - b) / np.where(m, d, 1)) % 6, 0)
    gc = np.where(m & (mx == g) & (mx != r), (b - r) / np.where(m, d, 1) + 2, 0)
    bc = np.where(m & (mx == b) & (mx != r) & (mx != g), (r - g) / np.where(m, d, 1) + 4, 0)
    h = np.where(mx == r, rc, np.where(mx == g, gc, bc)) * 60.0
    return np.where(m, h % 360.0, 0.0)


def hue_err(a, b):
    d = np.abs(a - b) % 360.0
    return np.minimum(d, 360.0 - d)


def sat(rgb):
    mx = np.max(rgb, axis=-1); mn = np.min(rgb, axis=-1)
    return np.where(mx > 1e-9, (mx - mn) / np.where(mx > 1e-9, mx, 1), 0.0)


def save_png(arr, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path)


class Rig:
    """Thin wrapper over a Session with the in-page helper installed."""

    def __init__(self, s):
        self.s = s
        s.js(LG_JS)
        self.size = s.js("() => window.__LG__.canvas()")

    def js(self, expr, arg=None):
        return self.s.js(expr, arg)

    def settle(self, n=8):
        self.s.step_frames(n, 1 / 60, True)

    def place(self, ix, iz, dist=4.0, pitch=-0.40, yaw_off=0.38, y=None, from_dir=(0.0, 1.0)):
        """Player `dist` m from (ix, iz) along from_dir, facing the item, aim turned yaw_off so the item sits off-centre."""
        px, pz = ix + from_dir[0] * dist, iz + from_dir[1] * dist
        self.js("([x, z, y, ix, iz, pt, yo]) => { window.__LG__.tp(x, z, y); window.__LG__.face(ix, iz, pt, yo); }",
                [px, pz, y, ix, iz, pitch, yaw_off])
        self.settle(8)

    def rect_around(self, x, y, z, rad, pad=14):
        """Canvas rect bounding a horizontal disc of radius rad at (x, y, z)."""
        pts = []
        for i in range(16):
            a = i / 16 * math.tau
            pts.append(self.js("([x, y, z]) => window.__LG__.project(x, y, z)", [x + math.cos(a) * rad, y, z + math.sin(a) * rad]))
        W, H = self.size
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        x0 = max(0, int(min(xs)) - pad); x1 = min(W, int(max(xs)) + pad)
        y0 = max(0, int(min(ys)) - pad); y1 = min(H, int(max(ys)) + pad)
        return [x0, y0, max(8, x1 - x0), max(8, y1 - y0)]

    def grab(self, rect, hdr=True, srgb=True):
        o = self.js("([r, a, b]) => window.__LG__.frame(r, a, b)", [rect, hdr, srgb])
        w, h = rect[2], rect[3]
        res = {}
        if hdr:
            res["hdr"] = dec_f32(o["hdr"], w, h)
        if srgb:
            res["srgb"] = dec_u8(o["srgb"], w, h)
        return res

    def ab(self, rect, off, hdr=True, srgb=True):
        """Shown vs hidden: off = (rings, beams, glows) visibility for the OFF frame; the ON frame shows everything."""
        self.js("() => window.__LG__.vis(true, true, true)")
        on = self.grab(rect, hdr, srgb)
        self.js("([a, b, c]) => window.__LG__.vis(a, b, c)", list(off))
        of = self.grab(rect, hdr, srgb)
        self.js("() => window.__LG__.vis(true, true, true)")
        return on, of


# ───────────────────────────── the gate ─────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", default="", help="comma list of rows to run: gpusync,pools,clamp,ceilpix,pickup,deaths,chestview,rings,glare,stormfade")
    ap.add_argument("--shots", default=None, help="directory for the A/B contact PNGs (default _harness/_shots/loot)")
    ap.add_argument("--tier", default=None, choices=["low", "medium", "high"], help="boot with this stored graphics tier (default: the game's own)")
    ap.add_argument("--hue-tol", type=float, default=15.0)
    ap.add_argument("--min-lum-ratio", type=float, default=1.4)
    ap.add_argument("--plant", default=None, choices=["flush-clear", "storm-ignore", "chest-beams-short"],
                    help="falsifier (loot.js served through a page.route override, never the working tree): flush-clear = the pre-fix flush "
                         "(clearUpdateRanges before every addUpdateRange), gpusync MUST fail; storm-ignore = every shader's stormK() returns 1 "
                         "(beams ignore the circle), stormfade MUST fail; chest-beams-short = every beam fades out by 60 m, chestview MUST fail")
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    want = lambda n: not only or n in only  # noqa: E731
    shots = args.shots or os.path.join(C.SHOTS, "loot")

    def body(v):
        if np is None:
            v.cnj("numpy / PIL", "numpy and Pillow are required for the pixel rows")
            return
        TIER_INIT = ("(() => { try { const m = /[#&]h_tier=(low|medium|high)/.exec(location.hash || ''); "
                     "if (m) localStorage.setItem('lc_settings', JSON.stringify({ graphics: m[1] })); } catch (_) {} })();")
        with C.Session(args, "loot_beams_rings", init_scripts=([TIER_INIT] if args.tier else None)) as s:
            if args.plant in ("flush-clear", "storm-ignore", "chest-beams-short"):
                if s.disk is None:
                    v.cnj("plant " + args.plant, "needs --disk / --rev (page routing)")
                    return
                import urllib.parse as _up

                def _pred(url):
                    return _up.urlparse(url).path.endswith("/runtime/3d/royale/loot.js")

                def _serve(route):
                    # the loot.js of the build being served (a --rev run plants into that revision's file, never the working tree's)
                    if s.disk.git is not None:
                        src = (s.disk.git.read("runtime/3d/royale/loot.js") or b"").decode("utf-8")
                    else:
                        src = open(os.path.join(C.ROOT, "runtime", "3d", "royale", "loot.js"), "rb").read().decode("utf-8")
                    if args.plant == "storm-ignore":
                        key, put = "float stormK(vec3 st, vec2 p) {", " return 1.0;"
                    elif args.plant == "chest-beams-short":
                        key, put = "float far = aBeam.w;", " far = min(far, 60.0);"
                    else:
                        key, put = "function queueRange(a, start, count) {", " a.clearUpdateRanges();"
                    if key not in src:
                        route.fulfill(status=500, body="plant: anchor not found: " + key)
                        return
                    src = src.replace(key, key + put, 1)
                    route.fulfill(status=200, body=src.encode("utf-8"), headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store"})
                s.disk.overrides.insert(0, (_pred, _serve))
                v.info("PLANT", {"flush-clear": "loot.js served with clearUpdateRanges() before every queued range (the pre-fix flush): gpusync must FAIL",
                                 "storm-ignore": "loot.js served with stormK() returning 1 (beams ignore the storm circle): stormfade must FAIL",
                                 "chest-beams-short": "loot.js served with every beam's fade-out distance capped at 60 m (no chest beacon from the glider): chestview must FAIL"}[args.plant])
            if args.tier:
                s.boot("%s%slc=1#h_tier=%s" % (args.base, "&" if "?" in args.base else "?", args.tier))
                v.info("tier", args.tier)
            else:
                s.boot()
            sm = s.start_match("standard", args.seed, args.map, enter=True)
            v.info("startMatch", sm)
            s.guard_player(True)
            v.info("land", s.land(protect=True))
            # The kernel's OWN rAF loop must not run between two page.evaluate calls of one A/B (it moved clouds, bots, the
            # camera follow and the item bob between "on" and "off": a 5,842 px difference between two renders of the SAME
            # state in the ceilpix debug, 2026-10-12). Stop it; from here only harness-stepped frames advance the game.
            v.info("kernel loop was running (now stopped)", s.freeze_loop())
            rig = Rig(s)
            v.info("canvas", rig.size)
            v.info("composer route", s.js("() => { const c = window.__LC__.W.kernel.composer; return c ? (c.isDirectPost ? 'direct (no post passes)' : 'real composer') : null; }"))

            # ---- gpusync: what the GPU draws == the module's CPU slot state (no ghost marker) ---------------------------
            # The landing skip runs ~850 sim ticks with no render while bots loot, and a normal frame runs 2-3 sim ticks per
            # render; every tick may park / write slots. Render the frame as the game left it, then force a FULL re-upload of
            # every marker attribute and render again: any pixel that differs was a slot the GPU never received (a ghost ring /
            # beam / glow of a taken item, or a missing marker). Checked after the landing skip and after 90 rendered frames of
            # 3 sim ticks each. Vantage: 250 m over the map (every beam and chest glow in range is on screen) and the player's view.
            if want("gpusync"):
                SYNC_JS = r"""() => { const W = window.__LC__.W, m = W.debugLootFx().meshes; let n = 0;
                    for (const o of m) for (const a of [o.instanceMatrix, o.instanceColor, o.geometry.getAttribute('aBeam'), o.geometry.getAttribute('aRing')]) {
                      if (!a) continue; a.clearUpdateRanges(); a.needsUpdate = true; n++; }
                    if (W._groups && W._groups.loot) W._groups.loot.traverse((o) => { if (o.name === 'loot-blobs') { o.instanceMatrix.clearUpdateRanges(); o.instanceMatrix.needsUpdate = true; n++; } });
                    return n; }"""
                VIEW_JS = r"""(k) => { const W = window.__LC__.W, p = W.player;
                    if (k === 'high') { p.pos.x = 0; p.pos.z = 330; p.pos.y = 250; p.onGround = false; if (p.vel) { p.vel.x = p.vel.y = p.vel.z = 0; } }
                    return [p.pos.x, p.pos.y, p.pos.z]; }"""

                # compared IN the page (two full-frame float reads never cross the wire): render as left -> read, force the
                # full re-upload -> render -> read, count differing pixels and report where the biggest cluster is
                CMP_JS = r"""(sync) => { const W = window.__LC__.W, k = W.kernel, r = k.renderer, THREE = W.THREE, LG = window.__LG__;
                    const w = r.domElement.width, h = r.domElement.height;
                    if (!LG.rt || LG.rt.width !== w || LG.rt.height !== h) { if (LG.rt) LG.rt.dispose();
                      LG.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true }); }
                    const read = () => { const prev = r.getRenderTarget(); r.setRenderTarget(LG.rt); r.clear(); r.render(k.scene, k.camera);
                      const b = new Float32Array(w * h * 4); r.readRenderTargetPixels(LG.rt, 0, 0, w, h, b); r.setRenderTarget(prev); return b; };
                    // PRE-WARM: the FIRST render after a teleport that skipped sim time can differ from the second (a one-time lazy effect of the
                    // actors / loot models in view: ~13.8 k px, max 1.7 HDR, seen intermittently 2026-10-12, never with the markers hidden - see
                    // REPORT.md). Two throwaway renders settle it; they upload what the game would upload on its own frames, so a range the module
                    // dropped stays dropped and the forced re-upload below still shows it.
                    for (let i = 0; i < 2; i++) { const prev = r.getRenderTarget(); r.setRenderTarget(LG.rt); r.clear(); r.render(k.scene, k.camera); r.setRenderTarget(prev); }
                    const a = read(); const n = eval(sync)(); const b = read();
                    let px = 0, mx = 0, sx = 0, sy = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
                    for (let i = 0; i < w * h; i++) { const o = i * 4; const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
                      if (d > 0.004) { px++; const x = i % w, y = h - 1 - Math.floor(i / w); sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
                      if (d > mx) mx = d; }
                    return { pixels: px, maxDiff: +mx.toFixed(4), centroid: px ? [Math.round(sx / px), Math.round(sy / px)] : null, bbox: px ? [x0, y0, x1, y1] : null, attrsReuploaded: n }; }"""

                def sync_diff(tag):
                    # CONTROL first: the same two renders with NO re-upload between them must be identical, else the method
                    # itself is non-deterministic here and the row is could-not-judge
                    ctl = s.js(CMP_JS, "() => 0")
                    out = s.js(CMP_JS, SYNC_JS)
                    out["view"] = tag
                    out["controlPixels"] = ctl["pixels"]
                    out["controlBbox"] = ctl["bbox"]
                    return out
                res = []
                # 1. right after the landing skip: from the player's own view, then from 250 m up (both still un-stepped since landing)
                res.append(sync_diff("after landing skip: player view"))
                pos0 = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.y, p.pos.z]; }")
                # (the first sync_diff re-uploaded everything; re-create the landing condition with another sim-only skip)
                s.js("() => { const C = window.__LC__; C.fastForward(20, 1 / 60); }")
                s.js("(k) => { const W = window.__LC__.W, p = W.player; p.pos.x = 0; p.pos.z = 330; p.pos.y = 250; p.onGround = false; if (p.vel) { p.vel.x = p.vel.y = p.vel.z = 0; }"
                     " p.input.pitch = -0.30; p.input.yaw = 0; p.yaw = 0; }", "high")
                s.step_frames(1, 1 / 60, False)       # camera follows (sim tick, no render)
                res.append(sync_diff("after a 20 s sim-only skip: 250 m up"))
                # 2. normal play at 20 fps: 3 sim ticks per rendered frame for 90 frames, bots looting meanwhile
                s.js("(x) => { const W = window.__LC__.W, p = W.player; p.pos.x = x[0]; p.pos.y = x[1]; p.pos.z = x[2]; p.onGround = true; if (p.vel) { p.vel.x = p.vel.y = p.vel.z = 0; } }", pos0)
                s.step_frames(90, 1 / 20, True)
                res.append(sync_diff("after 90 rendered frames of 3 ticks: player view"))
                v.info("gpusync per view", res)
                if any(r["controlPixels"] for r in res):
                    v.cnj("gpusync: the rendered markers equal a forced full re-upload", "two renders with NO re-upload already differ: %s" % res)
                else:
                    v.check("gpusync: the rendered markers equal a forced full re-upload of every marker attribute (no ghost or missing ring / beam / glow / blob)",
                            all(r["pixels"] == 0 for r in res), res, expect="0 differing pixels in every view (control: 0 without a re-upload)")
            cen = s.js(CENSUS_JS)
            rows, chests = cen["rows"], cen["chests"]
            v.info("loot census (live after landing)", {"items": len(rows), "weapons": sum(1 for r in rows if r["kind"] == "weapon"),
                                                          "ammo": sum(1 for r in rows if r["kind"] == "ammo"),
                                                          "consumables": sum(1 for r in rows if r["kind"] == "consumable"), "chests": len(chests), "fx": cen["fx"]})

            # ---- pools -------------------------------------------------------------------------------------------------
            if want("pools"):
                names = {m["name"]: m for m in cen["inst"]}
                ok_names = all(n in names for n in ("loot-rings", "loot-beams", "loot-glows"))
                v.check("pools: markers are 3 instanced meshes (loot-rings / loot-beams / loot-glows) in the loot group, renderOrder >= 6",
                        ok_names and all(m["ro"] >= 6 and m["inGroup"] for m in names.values()), cen["inst"], expect="3 meshes, renderOrder >= 6")
                v.check("pools: no per-item ring torus and no sprite left in the loot group", cen["torus"] == 0 and cen["sprites"] == 0,
                        {"torus": cen["torus"], "sprites": cen["sprites"]}, expect="0 / 0 (was 1 torus per floor item + 55 chest sprites)")
                calls = s.js(CALLS_JS)
                v.check("pools: the markers add exactly 3 draw calls", calls["delta"] == 3, calls, expect="3 (was ~8 beams + ~8 glows + ~12 rings in the ground frustum)")
                wp = [r for r in rows if r["kind"] == "weapon"]
                other = [r for r in rows if r["kind"] != "weapon"]
                # an item the module could not put a ring under (nothing within 0.9 m below it) has no markers by design
                noring_w = [r for r in wp if r["ring"] < 0]
                v.check("pools: every floor weapon has a ring and a beam (a beam only where >= 0.35 m of headroom)",
                        len(noring_w) <= max(1, int(0.02 * len(wp))) and all(r["beam"] >= 0 for r in wp if r["ring"] >= 0 and (r["ceil"] is None or r["ceil"] - r["by"] > 0.5 if r["by"] is not None else True)),
                        {"weapons": len(wp), "noRing": len(noring_w), "noBeam": sum(1 for r in wp if r["beam"] < 0), "sample": noring_w[:3]})
                v.check("pools: ammo and consumables get a ring and NO beam",
                        all(r["beam"] < 0 for r in other) and sum(1 for r in other if r["ring"] < 0) <= max(1, int(0.02 * len(other))),
                        {"n": len(other), "withBeam": sum(1 for r in other if r["beam"] >= 0), "noRing": sum(1 for r in other if r["ring"] < 0)})
                live_ch = [c for c in chests if not c["opened"]]
                v.check("pools: every unopened chest has a ring, a beam and a glow", all(c["ring"] >= 0 and c["glow"] >= 0 and c["beam"] >= 0 for c in live_ch),
                        {"chests": len(live_ch), "missing": [c["id"] for c in live_ch if min(c["ring"], c["glow"], c["beam"]) < 0][:5]})
                # beam heights follow the rarity table where nothing is above
                bad = []
                for r in wp:
                    if r["beam"] >= 0 and r["ceil"] is None and abs(r["nominal"] - BEAM_NOMINAL[r["r"]]) > 1e-3:
                        bad.append((r["id"], r["r"], r["nominal"]))
                    if r["beam"] >= 0 and r["ceil"] is None and abs((r["top"] - r["by"]) - BEAM_NOMINAL[r["r"]]) > 1e-3:
                        bad.append((r["id"], r["r"], "drawn", r["top"] - r["by"]))
                v.check("pools: beam height by rarity (common 2 m ... legendary 14 m) where nothing is above", not bad, {"bad": bad[:5], "checked": sum(1 for r in wp if r["beam"] >= 0 and r["ceil"] is None)})

            # ---- clamp (independent brute-force re-cast) -------------------------------------------------------------
            under = []
            if want("clamp") or want("ceilpix"):
                allb = [dict(r, what="item") for r in rows if r["beam"] >= 0] + [dict(c, what="chest") for c in chests if not c["opened"] and c["beam"] >= 0]
                bad, checked, n_under, mism = [], 0, 0, []
                for b in allb:
                    # the beam's own base radius is in its matrix size; the module's footprint rule is radius + 0.12
                    info = s.js("(id) => { const o = window.__LC__.W.debugLootFx(id).obj; return o && o.beam ? { size: o.beam.size, y: o.beam.y, top: o.beam.top } : null; }", b["id"])
                    if not info:
                        continue
                    rad = info["size"] + 0.12
                    floor = info["y"] - 0.04
                    brute = s.js("([x, z, f, r]) => window.__LG__.ceilBrute(x, z, f, r)", [b["x"], b["z"], floor, rad])
                    checked += 1
                    cb = brute["ceil"]
                    if cb is not None:
                        n_under += 1
                        under.append(dict(b, ceilBrute=cb, by_=brute["by"], size=info["size"], floor=floor))
                        if info["top"] > cb - 0.039:
                            bad.append((b["id"], round(info["top"], 3), round(cb, 3)))
                    if (b["ceil"] is None) != (cb is None) or (cb is not None and abs(b["ceil"] - cb) > 1e-6):
                        mism.append((b["id"], b["ceil"], cb))
                nit = sum(1 for u in under if u["what"] == "item"); nch = sum(1 for u in under if u["what"] == "chest")
                v.info("under-roof census (this seed after landing; research before bots take any: 69 of 346 items, 17 of 51 chests)",
                       {"beams": checked, "underRoofItems": nit, "underRoofChests": nch})
                if want("clamp"):
                    v.check("clamp: every beam's drawn top <= first collider above it - 4 cm (independent brute-force re-cast over all colliders)",
                            checked > 0 and not bad, {"beamsChecked": checked, "underRoof": n_under, "violations": bad[:6]}, expect="0 violations")
                    v.check("clamp: the module's recorded ceiling equals the brute-force ceiling for every beam", not mism, {"mismatches": mism[:6]})

            # ---- ceilpix ---------------------------------------------------------------------------------------------
            if want("ceilpix"):
                clamped = [u for u in under if u["what"] == "item" and u["nominal"] - (u["ceilBrute"] - u["floor"] - 0.08) >= 2.0 and u["ceilBrute"] - u["floor"] > 1.5 and u["ceilBrute"] - u["floor"] < 8]
                clamped.sort(key=lambda u: -(u["nominal"] - (u["ceilBrute"] - u["floor"])))
                picks = []
                for u in clamped:
                    if all(math.hypot(u["x"] - p["x"], u["z"] - p["z"]) > 30 for p in picks):
                        picks.append(u)
                    if len(picks) >= 12:                # up to 12 candidates, 30 m apart: the loop below stops at 3 FRAMED samples whose un-clamped control shows the beam
                        break
                if not picks:
                    v.cnj("ceilpix: no beam pixel above a ceiling collider", "no under-roof beam is clamped by >= 2 m on this seed")
                else:
                    per, ctrl = [], []
                    for u in picks:
                        bx0, bx1, bz0, bz1, bmaxy = u["by_"]
                        cx, cz = (bx0 + bx1) / 2, (bz0 + bz1) / 2
                        # stand outside the roof footprint, on the side away from its centre, far enough that the roof does not fill the view
                        dx, dz = u["x"] - cx, u["z"] - cz
                        n = math.hypot(dx, dz) or 1.0
                        ux, uz = (dx / n, dz / n) if n > 0.5 else (0.0, 1.0)
                        halfd = max(bx1 - bx0, bz1 - bz0) / 2
                        dist = halfd + 26.0            # far enough that a 14 m beam and the roof both fit the 57 deg view
                        mid = (u["ceilBrute"] + u["floor"] + u["nominal"]) / 2.0
                        rig.place(u["x"], u["z"], dist=dist, pitch=0.0, yaw_off=0.0, from_dir=(ux, uz))
                        cam_y = rig.js("() => window.__LC__.W.camera.position.y")
                        pitch = math.atan2(mid - cam_y, dist + 4.0)
                        rig.place(u["x"], u["z"], dist=dist, pitch=pitch, yaw_off=0.0, from_dir=(ux, uz))
                        pc = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [u["x"], u["ceilBrute"] + 0.15, u["z"]])
                        pt = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [u["x"], u["floor"] + u["nominal"], u["z"]])
                        W_, H_ = rig.size
                        if not (0 < pc[0] < W_ and 0 < pt[1] < H_ and pt[1] < pc[1] - 6):
                            per.append({"id": u["id"], "skipped": "ceiling / unclamped top off screen or too close in screen space", "pc": pc, "pt": pt})
                            continue
                        x0 = int(pc[0]) - 10; rect = [max(0, x0), 0, 21, int(pc[1])]

                        def own_ab():
                            # THIS beam's slot alone hidden vs shown (every other marker drawn in both frames)
                            on_ = rig.grab(rect, True, False)
                            rig.js("(s) => window.__LG__.hide([[1, s]])", u["beam"])
                            of_ = rig.grab(rect, True, False)
                            rig.js("() => window.__LG__.unhide()")
                            return int((np.abs(on_["hdr"][..., :3] - of_["hdr"][..., :3]).max(axis=-1) > 0.01).sum())
                        px = own_ab()
                        # CONTROL: remove the clamp (drawn height := nominal) - the same column must now show the beam above the ceiling
                        rig.js("""([slot, nom]) => { const g = window.__LC__.W.debugLootFx().meshes[1].geometry.getAttribute('aBeam'); window.__LG__._save = g.array[slot * 4];
                                 g.array[slot * 4] = nom; g.clearUpdateRanges && g.clearUpdateRanges(); g.needsUpdate = true; }""", [u["beam"], u["nominal"]])
                        cpx = own_ab()
                        rig.js("""([slot]) => { const g = window.__LC__.W.debugLootFx().meshes[1].geometry.getAttribute('aBeam'); g.array[slot * 4] = window.__LG__._save; g.clearUpdateRanges && g.clearUpdateRanges(); g.needsUpdate = true; }""", [u["beam"]])
                        per.append({"id": u["id"], "rarity": RARITY_NAME[u["r"]], "ceil": round(u["ceilBrute"], 2), "nominal": u["nominal"], "pixelsAboveCeiling": px, "controlPixels": cpx,
                                    "rect": rect, "pc": [round(pc[0]), round(pc[1])], "pt": [round(pt[0]), round(pt[1])]})
                        ctrl.append(cpx)
                        os.makedirs(shots, exist_ok=True)
                        # Wave 7: in a Savanna town the neighbouring buildings hide a 26 m view of a beam (the control reads 0 px and the probe cannot fail there): keep
                        # sampling until 3 samples can fail, instead of judging the first 3 candidates whatever they show. The bar is unchanged.
                        if sum(1 for q in per if q.get("controlPixels", 0) > 20) >= 3:
                            break
                    judged = [p for p in per if "pixelsAboveCeiling" in p]
                    v.info("ceilpix per sample", per)
                    if not judged:
                        v.cnj("ceilpix: no beam pixel above a ceiling collider", "no sample was framed")
                    elif not any(p["controlPixels"] > 20 for p in judged):
                        v.cnj("ceilpix: no beam pixel above a ceiling collider", "the un-clamped control showed no beam pixels, so this probe cannot fail here: %s" % judged)
                    else:
                        ok = all(p["pixelsAboveCeiling"] == 0 for p in judged if p["controlPixels"] > 20)
                        v.check("ceilpix: no beam pixel above a ceiling collider (clamped beams render nothing above the roof; the un-clamped control does)", ok,
                                {"samples": [{k: p[k] for k in ("id", "rarity", "pixelsAboveCeiling", "controlPixels")} for p in judged]}, expect="0 pixels (control > 20)")

            # ---- pickup / net take / chest open ------------------------------------------------------------------------
            if want("pickup"):
                pl = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
                spot = s.js("([a, b]) => window.__LG__.findSpot(2.5, 25, 6, 0.8, null, 0)", pl)
                if not spot:
                    v.cnj("pickup rows", "no free patch of ground for the pickup probe")
                else:
                    sx, sz = spot["x"], spot["z"]
                    # the landing walkover may have filled the 3-gun cap, and a plain pickup then (correctly) refuses a gun: make room
                    s.js("() => { const p = window.__LC__.W.player; const sl = p.inventory.slots; let kept = 0; for (let i = 0; i < sl.length; i++) { if (sl[i] && sl[i].kind === 'weapon') { if (++kept > 1 && i !== p.inventory.active) sl[i] = null; } } }")
                    s.js("([x, z]) => { const L = window.__LG__; L.spawn('t_pick', { kind: 'weapon', id: 'ar', rarity: 3, mag: 30 }, x, z); L.spawn('t_net', { kind: 'weapon', id: 'smg', rarity: 2, mag: 30 }, x + 6, z); }", [sx, sz])
                    rig.place(sx, sz, dist=3.0, pitch=-0.25, yaw_off=0.3)
                    pre = s.js("() => ({ p: window.__LG__.info('t_pick'), n: window.__LG__.info('t_net'), fx: (() => { const d = window.__LC__.W.debugLootFx(); return [d.beams.live, d.rings.live]; })() })")
                    rect = rig.rect_around(sx, s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z)", [sx, sz]) + 3, sz, 2.5, pad=40)
                    rect[1] = max(0, rect[1] - 160); rect[3] = min(rig.size[1] - rect[1], rect[3] + 200)
                    alive_pre = bool(pre["p"] and pre["p"]["ring"] and pre["p"]["ring"]["alive"] and pre["p"]["beam"] and pre["p"]["beam"]["alive"])
                    slots_p = (pre["p"]["ring"]["slot"], pre["p"]["beam"]["slot"]) if alive_pre else None
                    slots_n = (pre["n"]["ring"]["slot"], pre["n"]["beam"]["slot"]) if pre["n"] and pre["n"]["ring"] and pre["n"]["beam"] else None
                    # BEFORE: the picked item's OWN marker pixels = (all markers) vs (all but its ring + beam slots); pixels any OTHER marker
                    # touches (all-but-target vs none, low threshold, dilated 1 px) are excluded, so a far beam crossing the region (chest
                    # beams are drawn to 1.8 km) can neither pass nor fail this row. Frames of one A/B are rendered without stepping time.
                    rig.js("() => window.__LG__.vis(true, true, true)")
                    f_all = rig.grab(rect, False, True)["srgb"][..., :3]
                    rig.js("(p) => window.__LG__.hide(p)", [[0, slots_p[0]], [1, slots_p[1]]] if slots_p else [])
                    f_not = rig.grab(rect, False, True)["srgb"][..., :3]
                    rig.js("() => window.__LG__.unhide()")
                    rig.js("() => window.__LG__.vis(false, false, false)")
                    f_none = rig.grab(rect, False, True)["srgb"][..., :3]
                    rig.js("() => window.__LG__.vis(true, true, true)")
                    tmask = np.abs(f_all - f_not).max(axis=-1) > 6
                    omask = np.abs(f_not - f_none).max(axis=-1) > 3
                    om = omask.copy()
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                        om |= np.roll(np.roll(omask, dy, axis=0), dx, axis=1)
                    mask = tmask & ~om
                    before_px = int(mask.sum())
                    ok_pick = s.js("() => window.__LC__.W.pickupItem(window.__LC__.W.player, 't_pick')")
                    s.js("() => window.__LC__.W.netTakeItem('t_net')")
                    s.step_frames(3, 1 / 60, True)
                    post = s.js("""([sp, sn]) => { const W = window.__LC__.W, D = W.debugLootFx(), m = D.meshes;
                        const zero = (mesh, slot) => { const a = mesh.instanceMatrix.array; let t = 0; for (let i = 0; i < 16; i++) t += Math.abs(a[slot * 16 + i]); return t === 0; };
                        const free = (k, slot) => D.free ? D.free[k].indexOf(slot) >= 0 : null;
                        // a freed slot may be taken again at once by loot a BOT spawns during the 3 stepped frames (a bot opening a chest bursts items that reuse it): then it is
                        // neither zero nor free, but it is owned by someone else - the item that was picked no longer owns it. That is reuse, not a leak (the accounting row below
                        // proves every live slot has exactly one live owner).
                        const ownerOf = (k, slot) => { for (const o of W.debugItems().concat(W.debugChests())) { if (o[k] === slot) return o.id; } return null; };
                        return { ringOwner: ownerOf('ring', sp[0]), beamOwner: ownerOf('beam', sp[1]), netRingOwner: sn ? ownerOf('ring', sn[0]) : null, netBeamOwner: sn ? ownerOf('beam', sn[1]) : null,
                                 ringZero: zero(m[0], sp[0]), beamZero: zero(m[1], sp[1]), netRingZero: sn ? zero(m[0], sn[0]) : null, netBeamZero: sn ? zero(m[1], sn[1]) : null,
                                 ringFree: free('rings', sp[0]), beamFree: free('beams', sp[1]), netRingFree: sn ? free('rings', sn[0]) : null, netBeamFree: sn ? free('beams', sn[1]) : null,
                                 itemGone: !W.debugItems().some((q) => q.id === 't_pick' || q.id === 't_net'),
                                 nearby: W.nearbyLoot(W.player.pos, 12).filter((q) => q.id === 't_pick' || q.id === 't_net').length }; }""", [slots_p, slots_n]) if slots_p else None
                    p_all = rig.grab(rect, False, True)["srgb"][..., :3]
                    rig.js("() => window.__LG__.vis(false, false, false)")
                    p_none = rig.grab(rect, False, True)["srgb"][..., :3]
                    rig.js("() => window.__LG__.vis(true, true, true)")
                    after_px = int(((np.abs(p_all - p_none).max(axis=-1) > 6) & mask).sum())
                    # slot ACCOUNTING instead of a global live-count delta (49 bots keep looting during the stepped frames): every live slot
                    # of every pool is owned by exactly one live item / chest, and nothing owns a freed slot
                    acct = s.js("""() => { const W = window.__LC__.W, d = W.debugLootFx(); const own = { beams: [], rings: [], glows: [] };
                        for (const o of W.debugItems().concat(W.debugChests())) { if (o.beam >= 0) own.beams.push(o.beam); if (o.ring >= 0) own.rings.push(o.ring); if (o.glow >= 0) own.glows.push(o.glow); }
                        const out = {};
                        for (const k of ['beams', 'rings', 'glows']) { const set = new Set(own[k]); const fr = d.free ? new Set(d.free[k]) : new Set();
                          out[k] = { owned: own[k].length, distinct: set.size, live: d[k].live, ownedButFree: own[k].filter((x) => fr.has(x)).length }; }
                        return out; }""")
                    acct_ok = all(a["owned"] == a["live"] == a["distinct"] and a["ownedButFree"] == 0 for a in acct.values())
                    # a picked item's slot is PARKED when it is zero and on the free list, or - reused at once by loot a bot spawned in the stepped frames - owned by anything but the
                    # picked item itself (with the accounting row, every live slot has exactly one live owner: a leaked slot has none)
                    def parked(zero_k, free_k, owner_k):
                        if post is None:
                            return False
                        own = post.get(owner_k)
                        if own in ("t_pick", "t_net"):
                            return False
                        if own is not None:
                            return True
                        return bool(post.get(zero_k)) and post.get(free_k) is not False
                    v.check("pickup: picking an item and a net-take mirror each park their ring + beam (zero matrix, back on the free list) and the pools stay "
                            "consistent (every live slot owned by exactly one live item / chest)",
                            bool(ok_pick) and alive_pre and post is not None and parked("ringZero", "ringFree", "ringOwner") and parked("beamZero", "beamFree", "beamOwner")
                            and parked("netRingZero", "netRingFree", "netRingOwner") and parked("netBeamZero", "netBeamFree", "netBeamOwner")
                            and post["itemGone"] and post["nearby"] == 0 and acct_ok,
                            {"pickupReturned": ok_pick, "aliveBefore": alive_pre, "liveBefore": pre["fx"], "post": post, "accounting": acct})
                    if before_px < 30:
                        v.cnj("pickup: the item's own marker pixels are gone once it is picked", "only %d own-marker pixels before the pickup (framing)" % before_px)
                    else:
                        v.check("pickup: the item's own marker pixels are gone once it is picked (all markers vs none, inside its own pre-pickup marker mask)",
                                after_px == 0, {"ownMarkerPixelsBefore": before_px, "ofThoseStillMarkerAfter": after_px}, expect="after == 0, before >= 30")
                    # chest open parks its three slots
                    ch = s.js("() => { const W = window.__LC__.W; const c = W.debugChests().find((q) => !q.opened && q.ring >= 0 && q.beam >= 0 && q.glow >= 0); return c ? { id: c.id, ring: c.ring, beam: c.beam, glow: c.glow } : null; }")
                    if not ch:
                        v.cnj("pickup: opening a chest parks its ring + beam + glow", "no unopened chest with all three markers")
                    else:
                        before = s.js("() => { const d = window.__LC__.W.debugLootFx(); return [d.beams.live, d.rings.live, d.glows.live]; }")
                        # the opened chest's slots go back to the free list and the loot it drops may reuse them at once (a gun's beam, an item's
                        # ring), so ownership - not a zero matrix - is what proves the chest let go: the chest record holds no slot, its glow
                        # (drops get none) is gone from the live count, and the chest is no longer a pickup target
                        s.js("(id) => window.__LC__.W.openChest(window.__LC__.W.player, id)", ch["id"])
                        s.step_frames(2, 1 / 60, True)
                        after = s.js("""(id) => { const W = window.__LC__.W, d = W.debugLootFx(), c = W.debugChests().find((q) => q.id === id);
                            const own = []; for (const o of W.debugItems().concat(W.debugChests())) { if (o.glow >= 0) own.push(o.glow); }
                            return { live: [d.beams.live, d.rings.live, d.glows.live], glowOwned: own.length, glowDistinct: new Set(own).size, rec: { opened: c.opened, ring: c.ring, beam: c.beam, glow: c.glow },
                                     targetable: W.nearbyLoot({ x: c.pos.x, y: c.pos.y, z: c.pos.z }, 3).some((q) => q.type === 'chest' && q.id === id) }; }""", ch["id"])
                        v.check("pickup: opening a chest parks its ring + beam + glow slots (the record lets go of all three, the glow count drops by at least 1 - a bot may open another chest in the same frames - and every live glow has exactly one owner)",
                                after["rec"]["opened"] and after["rec"]["ring"] == -1 and after["rec"]["beam"] == -1 and after["rec"]["glow"] == -1
                                and after["live"][2] <= before[2] - 1 and after["glowOwned"] == after["live"][2] == after["glowDistinct"] and not after["targetable"],
                                {"before": before, "after": after, "note": "rings / beams live may rise: the loot the chest drops takes slots of its own"})

            # ---- deaths ------------------------------------------------------------------------------------------------
            if want("deaths"):
                b = s.js("""() => { const W = window.__LC__.W; const a = W.actors.find((x) => x.isBot && x.alive && x.inventory && x.inventory.slots.some((q) => q && q.kind === 'weapon'));
                    if (!a) return null; W.giveItem(a, { kind: 'weapon', id: 'sniper', rarity: 4, mag: 5 }); W.giveItem(a, { kind: 'consumable', id: 'medkit', count: 2 });
                    return { id: a.id }; }""")
                if not b:
                    v.cnj("deaths: a killed bot's drops carry ring + glow (+ beam for a weapon)", "no armed bot alive")
                else:
                    before = s.js("() => { const d = window.__LC__.W.debugLootFx(); return [d.beams.live, d.rings.live, d.glows.live]; }")
                    s.js("(id) => { const W = window.__LC__.W; W.killActor(W.actorById.get(id), W.player, 'ar'); }", b["id"])
                    s.step_frames(2, 1 / 60, True)
                    drops = s.js("""(id) => { const W = window.__LC__.W; return W.debugItems().filter((it) => it.id.indexOf('dd:' + id) === 0).map((it) => { const o = W.debugLootFx(it.id).obj;
                        return { id: it.id, kind: it.data.kind, did: it.data.id, r: it.data.rarity, ring: o.ring ? o.ring.slot : -1, beam: o.beam ? o.beam.slot : -1, glow: o.glow ? o.glow.slot : -1 }; }); }""", b["id"])
                    after = s.js("() => { const d = window.__LC__.W.debugLootFx(); return [d.beams.live, d.rings.live, d.glows.live]; }")
                    okd = bool(drops) and all(d["ring"] >= 0 and d["glow"] >= 0 and ((d["beam"] >= 0) == (d["kind"] == "weapon")) for d in drops)
                    v.check("deaths: a killed bot's drops carry ring + glow, and a beam if (and only if) they are weapons", okd and len(drops) >= 2,
                            {"drops": drops[:8], "nDrops": len(drops), "liveBefore": before, "liveAfter": after})

            # ---- chestview ---------------------------------------------------------------------------------------------
            if want("chestview"):
                pl = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
                s.js("() => { const W = window.__LC__.W, p = W.player; p.pos.x = 330; p.pos.z = 330; p.pos.y = 250; p.onGround = false; if (p.vel) { p.vel.x = p.vel.y = p.vel.z = 0; } }")
                s.js("() => window.__LG__.face(0, 0, -0.30, 0)")
                rig.settle(6)
                W_, H_ = rig.size
                chs = s.js("""() => { const W = window.__LC__.W, c0 = W.camera.position; return W.debugChests().filter((c) => !c.opened && c.beam >= 0).map((c) => { const d = Math.hypot(c.pos.x - c0.x, c.pos.y - c0.y, c.pos.z - c0.z);
                    const o = W.debugLootFx(c.id).obj; return { id: c.id, x: o.beam.x, y: o.beam.y, z: o.beam.z, top: o.beam.top, d, ceil: c.ceil === Infinity ? null : c.ceil, nominal: o.beam.nominal }; }); }""")
                # line of sight from the glider's camera to the top of every beam: terrain (every 8 m along the segment) and big boxes (slab test; footprint >= 3 x 3 m)
                occ = s.js("""(pts) => { const W = window.__LC__.W, c0 = W.camera.position, M = W.map, cols = M.colliders.filter((o) => !o.dead && (o.maxX - o.minX) >= 3 && (o.maxZ - o.minZ) >= 3);
                    const hit = (tx, ty, tz) => { const d = [tx - c0.x, ty - c0.y, tz - c0.z], L = Math.hypot(d[0], d[1], d[2]), n = Math.ceil(L / 8), o0 = [c0.x, c0.y, c0.z];
                      for (let i = 1; i < n; i++) { const t = i / n; if (M.heightAt(c0.x + d[0] * t, c0.z + d[2] * t) > c0.y + d[1] * t) return 'terrain'; }
                      for (const o of cols) { let t0 = 0, t1 = 1; const lo = [o.minX, o.minY, o.minZ], hi = [o.maxX, o.maxY, o.maxZ];
                        for (let a = 0; a < 3 && t0 <= t1; a++) { if (Math.abs(d[a]) < 1e-9) { if (o0[a] < lo[a] || o0[a] > hi[a]) t0 = 2; } else { let ta = (lo[a] - o0[a]) / d[a], tb = (hi[a] - o0[a]) / d[a]; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; } }
                        if (t0 <= t1 && t1 > 0) return 'collider'; }
                      return null; };
                    return pts.map((p) => hit(p[0], p[1], p[2])); }""", [[c["x"], c["top"] - 0.2, c["z"]] for c in chs])
                full = [0, 0, W_, H_]
                s.js("() => window.__LG__.vis(true, true, true)")
                on = rig.grab(full, True, False)
                s.js("() => window.__LG__.vis(true, false, true)")
                of = rig.grab(full, True, False)
                s.js("() => window.__LG__.vis(true, true, true)")
                dif = np.abs(on["hdr"][..., :3] - of["hdr"][..., :3]).max(axis=-1)
                seen, inview, roofed, roofed_seen, hidden, hidden_seen = 0, 0, 0, 0, 0, 0
                detail = []
                for ci, c in enumerate(chs):
                    if c["d"] > 900:
                        continue
                    p0 = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [c["x"], c["y"] + 0.2, c["z"]])
                    p1 = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [c["x"], c["top"] - 0.2, c["z"]])
                    if not (0 < p0[0] < W_ and 0 < p0[1] < H_ and p0[2] < 1):
                        continue
                    x0 = max(0, int(p0[0]) - 6); x1 = min(W_, int(p0[0]) + 7); y0 = max(0, int(min(p0[1], p1[1])) - 6); y1 = min(H_, int(max(p0[1], p1[1])) + 6)
                    n = int((dif[y0:y1, x0:x1] > 0.03).sum())
                    if c.get("ceil") is not None:
                        roofed += 1                 # a collider above the beam: its beam is clamped under that roof by design (clamp / ceilpix judge it)
                        roofed_seen += 1 if n >= 3 else 0
                        continue
                    if occ[ci] is not None:
                        hidden += 1                 # a building / slab / hill stands between the glider and the top of its beam: nothing to draw there
                        hidden_seen += 1 if n >= 3 else 0
                        continue
                    inview += 1
                    seen += 1 if n >= 3 else 0
                    detail.append((c["id"], round(c["d"]), n))
                v.info("chestview: roofed chests excluded (their beam is clamped under the roof by design)",
                       "%d of %d chests in view within 900 m are roofed (%d of them show beam pixels); the all-chests figure the row used before Wave 7 would read %d of %d = %.0f %%" % (
                           roofed, roofed + hidden + inview, roofed_seen, seen + roofed_seen + hidden_seen, roofed + hidden + inview, 100.0 * (seen + roofed_seen + hidden_seen) / max(1, roofed + hidden + inview)))
                v.info("chestview: open-sky chests with no line of sight to the top of their beam (not judged)", "%d of %d open-sky chests in view are behind a building / slab / hill (%d of them show beam pixels anyway)" % (hidden, hidden + inview, hidden_seen))
                if inview < 3:
                    v.cnj("chestview: chest beams are drawn from the glider", "only %d open-sky chests in line of sight within 900 m in view (%d roofed and %d hidden ones excluded)" % (inview, roofed, hidden))
                else:
                    v.check("chestview: from 250 m up >= 70 %% of the open-sky chests in line of sight within 900 m still show beam pixels (%d of %d; %d roofed and %d hidden chests not judged)" % (seen, inview, roofed, hidden), seen >= 0.7 * inview,
                            {"inView": inview, "seen": seen, "roofedExcluded": roofed, "hiddenExcluded": hidden, "sample": detail[:8]})

            # ---- rings A/B ---------------------------------------------------------------------------------------------
            spots = {}
            if want("rings") or want("glare"):
                pl = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
                spots = {
                    "sand": s.js("([a, b]) => window.__LG__.findSpot(0.8, 1.9, 5, 0.6, [a, b], 0)", pl),
                    "grass": s.js("([a, b]) => window.__LG__.findSpot(4.0, 22.0, 5, 0.6, [a, b], 0)", pl),
                }
                v.info("A/B spots", spots)
                wood = spots.get("grass")      # the wood case drapes a wooden plank over a second visit to the grass patch (see LG.plank)
                v.info("A/B wood", "synthetic wood-brown plank draped over the grass patch: no map has wooden floors in this build")
                RES = []
                os.makedirs(shots, exist_ok=True)
                sheet_tiles = []
                for surf in ("sand", "grass", "wood"):
                    sp = spots.get("grass" if surf == "wood" else surf)
                    if not sp:
                        RES.append({"surface": surf, "skipped": "no spot"})
                        continue
                    top = None
                    if surf == "wood":
                        s.js("([x, z]) => window.__LG__.plank(x, z, 4.5, 0x7a5230)", [sp["x"], sp["z"]])
                    for rar in range(5):
                        iid = "t_%s_%d" % (surf, rar)
                        data = {"kind": "weapon", "id": "ar", "rarity": rar, "mag": 30}
                        y = (top + 0.15) if top is not None else None
                        s.js("([id, d, x, z, y]) => window.__LG__.spawn(id, d, x, z, y)", [iid, data, sp["x"], sp["z"], y])
                        rig.place(sp["x"], sp["z"], dist=4.2, pitch=-0.42, yaw_off=0.40, y=top)
                        info = s.js("(id) => window.__LG__.info(id)", iid)
                        if not info or not info.get("ring") or not info["ring"]["alive"]:
                            RES.append({"surface": surf, "rarity": rar, "skipped": "ring not alive", "info": info})
                            s.js("(id) => window.__LC__.W.netTakeItem(id)", iid)
                            continue
                        ry = info["ring"]["y"]
                        rect = rig.rect_around(sp["x"], ry, sp["z"], 1.15, pad=16)
                        # rings A/B: beams + glows hidden in BOTH frames so only the ring differs
                        rig.js("() => window.__LG__.vis(true, false, false)")
                        on = rig.grab(rect, True, True)
                        rig.js("() => window.__LG__.vis(false, false, false)")
                        of = rig.grab(rect, True, True)
                        rig.js("() => window.__LG__.vis(true, true, true)")
                        C_ = np.array(info["ring"]["color"])               # HDR band colour (linear), the module's own number
                        h_on, h_of = on["hdr"][..., :3], of["hdr"][..., :3]
                        dlt = h_on - h_of
                        cc = C_[None, None, :] - h_of
                        den = (cc * cc).sum(axis=-1)
                        alpha = np.where(den > 1e-6, (dlt * cc).sum(axis=-1) / np.where(den > 1e-6, den, 1), 0.0)
                        # the band breathes between 0.84 and 1.0 coverage (shader pulse; frozen in a stepped frame), every other layer
                        # (glow 0.30, disc <= 0.26, dark outline 0.5 of BLACK) projects far below 0.75 on the band colour
                        band = (alpha >= 0.75) & (np.abs(dlt).max(axis=-1) > 0.05)
                        nb = int(band.sum())
                        rec = {"surface": surf, "rarity": RARITY_NAME[rar], "bandPixels": nb}
                        if nb < 25:
                            rec["skipped"] = "too few band pixels (%d): framing" % nb
                            rec["why"] = {"alphaP99": round(float(np.percentile(alpha, 99)), 3), "dltMaxP99": round(float(np.percentile(np.abs(dlt).max(axis=-1), 99)), 3),
                                          "bandColour": [round(float(x), 3) for x in C_], "floorP50": [round(float(x), 3) for x in np.median(h_of.reshape(-1, 3), axis=0)],
                                          "ring": {k: info["ring"].get(k) for k in ("slot", "alive", "size", "y")}}
                            RES.append(rec)
                        else:
                            y_on = lum(h_on)[band]; y_of = lum(h_of)[band]
                            ratio = y_on / np.maximum(y_of, 1e-4)
                            sr_on = on["srgb"][..., :3][band] / 255.0
                            sr_of = of["srgb"][..., :3][band] / 255.0
                            tgt_h = float(hue_deg(hex_rgb(RARITY_HEX[rar])))
                            tgt_s = float(sat(hex_rgb(RARITY_HEX[rar])))
                            he = hue_err(hue_deg(sr_on), tgt_h)
                            rec.update({"lumRatioHDR_median": round(float(np.median(ratio)), 3), "lumRatioHDR_p10": round(float(np.percentile(ratio, 10)), 3),
                                        "floorLumHDR": round(float(np.median(y_of)), 3), "bandLumHDR": round(float(np.median(y_on)), 3),
                                        "hueErr_median": round(float(np.median(he)), 2), "hueErr_p90": round(float(np.percentile(he, 90)), 2),
                                        "targetHue": round(tgt_h, 1), "targetSat": round(tgt_s, 2),
                                        "displayLumRatio_median": round(float(np.median(lum(srgb_to_lin(sr_on)) / np.maximum(lum(srgb_to_lin(sr_of)), 1e-4))), 3)})
                            RES.append(rec)
                        # contact tiles: ring on | ring off | diff x4
                        a = on["srgb"][..., :3]; b = of["srgb"][..., :3]
                        sheet_tiles.append((surf, rar, np.concatenate([a, b, np.clip(np.abs(a - b) * 4, 0, 255)], axis=1)))
                        s.js("(id) => window.__LC__.W.netTakeItem(id)", iid)
                        s.step_frames(1, 1 / 60, True)
                    if surf == "wood":
                        s.js("() => window.__LG__.unplank()")
                v.data["ringAB"] = RES
                if sheet_tiles:
                    try:
                        wmax = max(t[2].shape[1] for t in sheet_tiles)
                        rowsimg = []
                        for _, _, im in sheet_tiles:
                            pad = np.zeros((im.shape[0], wmax - im.shape[1], 3))
                            rowsimg.append(np.concatenate([im, pad], axis=1))
                        save_png(np.concatenate(rowsimg, axis=0), os.path.join(shots, "ring_ab_sheet.png"))
                        v.info("ring A/B contact sheet (rows: sand c/u/r/e/l, grass ..., wood ...; cols: on | off | diff x4)", os.path.join(shots, "ring_ab_sheet.png"))
                    except Exception as e:  # pragma: no cover
                        v.info("ring A/B sheet not written", str(e)[:200])
                if want("rings"):
                    judged = [r for r in RES if "hueErr_median" in r]
                    for r in RES:
                        v.info("ring A/B %s %s" % (r.get("surface"), r.get("rarity")), {k: r[k] for k in r if k not in ("surface", "rarity")})
                    surfaces_judged = sorted({r["surface"] for r in judged})
                    miss = [r for r in RES if "skipped" in r]
                    if len(surfaces_judged) < 3:
                        v.cnj("rings: rarity-coloured ring on sand, grass and wood", "only judged surfaces %s (skipped: %s)" % (surfaces_judged, [(m.get("surface"), m.get("rarity"), m.get("skipped")) for m in miss][:6]))
                    else:
                        # hue: judged where the rarity colour is saturated enough for a hue to exist (common #9da5b4 has saturation 0.13)
                        hue_rows = [r for r in judged if r["targetSat"] >= 0.25]
                        bad_h = [(r["surface"], r["rarity"], r["hueErr_median"]) for r in hue_rows if r["hueErr_median"] >= args.hue_tol]
                        v.check("rings: hue error < %.0f deg on sand, grass and wood (rarities with a defined hue)" % args.hue_tol, not bad_h and len(hue_rows) >= 9,
                                {"judged": len(hue_rows), "over": bad_h})
                        com = [r for r in judged if r["targetSat"] < 0.25]
                        v.info("common ring (saturation 0.13: hue is not a meaningful gate) median hue error / chroma kept", [(r["surface"], r["hueErr_median"]) for r in com])
                        bad_l = [(r["surface"], r["rarity"], r["lumRatioHDR_median"]) for r in judged if r["lumRatioHDR_median"] < args.min_lum_ratio]
                        v.check("rings: >= %.1fx the floor luminance (scene-linear, pre-bloom, pre-tonemap) on sand, grass and wood" % args.min_lum_ratio, not bad_l,
                                {"judged": len(judged), "under": bad_l, "minRatio": min(r["lumRatioHDR_median"] for r in judged)})

            # ---- glare (information) ----------------------------------------------------------------------------------
            if want("glare"):
                spot = (spots or {}).get("grass")
                if spot:
                    G = []
                    for rar in range(5):
                        iid = "t_g_%d" % rar
                        s.js("([id, d, x, z]) => window.__LG__.spawn(id, d, x, z)", [iid, {"kind": "weapon", "id": "ar", "rarity": rar, "mag": 30}, spot["x"], spot["z"]])
                        rig.place(spot["x"], spot["z"], dist=7.0, pitch=0.10, yaw_off=0.30)
                        info = s.js("(id) => window.__LG__.info(id)", iid)
                        if not info or not info.get("beam"):
                            G.append({"rarity": RARITY_NAME[rar], "skipped": "no beam"})
                            continue
                        bx, by, bz = info["beam"]["x"], info["beam"]["y"], info["beam"]["z"]
                        top = info["beam"]["top"]
                        p0 = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [bx, by + 0.3, bz])
                        p1 = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [bx, top - 0.1, bz])
                        W_, H_ = rig.size
                        x0 = int(p0[0]) - 24; rect = [max(0, x0), max(0, int(min(p0[1], p1[1])) - 6), 49, int(abs(p0[1] - p1[1])) + 12]
                        rect[3] = min(rect[3], H_ - rect[1])
                        # THIS beam's own slot hidden vs shown, rings + glows hidden in both: a far chest beam crossing the 49 px rect
                        # (drawn to 1.8 km) used to be counted as this beam's peak (run 2: "uncommon" 0.775, above its own maximum)
                        rig.js("() => window.__LG__.vis(false, true, false)")
                        on = rig.grab(rect, True, True)
                        rig.js("(s) => window.__LG__.hide([[1, s]])", info["beam"]["slot"])
                        of = rig.grab(rect, True, True)
                        rig.js("() => window.__LG__.unhide()")
                        rig.js("() => window.__LG__.vis(true, true, true)")
                        d = lum(on["hdr"][..., :3]) - lum(of["hdr"][..., :3])
                        bl = lambda a: 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]  # noqa: E731  UnrealBloom's luminance weights
                        dd = bl(on["hdr"][..., :3]) - bl(of["hdr"][..., :3])
                        col = np.unravel_index(np.argmax(d), d.shape)[1]
                        axis = d[:, max(0, col - 1):col + 2].max(axis=1)
                        peak_row = int(np.argmax(axis))
                        bg = lum(of["hdr"][..., :3])[peak_row, max(0, col - 1):col + 2].mean()
                        peak_on = lum(on["hdr"][..., :3])[:, max(0, col - 1):col + 2].max()
                        width_core = int((d[peak_row] > 0.5 * d.max()).sum())
                        # halo: the displayed frame's brightening around the beam at the peak row, > 4/255 over the hidden frame
                        sd = np.abs(on["srgb"][peak_row, :, :3] - of["srgb"][peak_row, :, :3]).max(axis=-1)
                        width_halo = int((sd > 4).sum())
                        G.append({"rarity": RARITY_NAME[rar], "beamContribPeakLum": round(float(d.max()), 3), "bloomWeightedContribPeak": round(float(dd.max()), 3),
                                  "bgLum": round(float(bg), 3), "peakOverBg": round(float(peak_on / max(bg, 1e-3)), 2), "corePx": width_core, "haloPx": width_halo,
                                  "haloOverCore": round(width_halo / max(width_core, 1), 2)})
                        s.js("(id) => window.__LC__.W.netTakeItem(id)", iid)
                    v.data["glare"] = G
                    for g in G:
                        v.info("glare %s" % g.get("rarity"), g)
                    cu = [g for g in G if g.get("rarity") in ("common", "uncommon") and "bloomWeightedContribPeak" in g]
                    if cu:
                        v.check("glare: common / uncommon beam contribution stays under the 0.72 bloom threshold (bloom-weighted luminance of the beam's own radiance)",
                                all(g["bloomWeightedContribPeak"] < 0.72 for g in cu), [(g["rarity"], g["bloomWeightedContribPeak"]) for g in cu])
                else:
                    v.cnj("glare", "no grass spot")

            # ---- stormfade --------------------------------------------------------------------------------------------
            # C-LOOT-RENDER. The uniform is set DIRECTLY for the pixel A/B and no frame is stepped between that and the grab (storm.js may be
            # writing the real W.stormU while the gate runs); the providers below are property descriptors that ignore writes, then restored.
            if want("stormfade"):
                pl = s.js("() => { const p = window.__LC__.W.player; return [p.pos.x, p.pos.z]; }")
                sp = (spots or {}).get("grass") or s.js("([a, b]) => window.__LG__.findSpot(4.0, 22.0, 5, 0.6, [a, b], 0)", pl)
                if not sp:
                    v.cnj("stormfade", "no grass spot for the probe item")
                else:
                    iid = "t_storm"
                    s.js("([id, d, x, z]) => window.__LG__.spawn(id, d, x, z)", [iid, {"kind": "weapon", "id": "ar", "rarity": 4, "mag": 30}, sp["x"], sp["z"]])
                    rig.place(sp["x"], sp["z"], dist=7.0, pitch=0.10, yaw_off=0.30)
                    info = s.js("(id) => window.__LG__.info(id)", iid)
                    UNI_JS = "() => { const v = window.__LC__.W.debugLootFx().uniforms.storm.value; return [v.x, v.y, v.z]; }"
                    PROV_JS = "() => { const u = window.__LC__.W.stormU; return u ? { cx: u.cx, cz: u.cz, r: u.r } : null; }"
                    had = s.js(PROV_JS)
                    if had:
                        s.step_frames(2, 1 / 60, True)
                        had2 = s.js(PROV_JS)
                        uni = s.js(UNI_JS)
                        near = lambda a, b: abs(a - b) <= max(1e-3, 1e-6 * abs(b))  # noqa: E731
                        v.check("stormfade: a W.stormU provider exists (merged tree) and the module's storm uniform equals it after a frame",
                                near(uni[0], had2["cx"]) and near(uni[1], had2["cz"]) and near(uni[2], had2["r"]), {"W.stormU": had2, "uniform": uni})
                    else:
                        v.info("stormfade: no W.stormU provider in this build (isolated run)", "the module must use its own read of the sim's circle (checked below)")
                    if not info or not info.get("beam"):
                        v.cnj("stormfade: beam fades beyond the storm circle", "no beam for the probe item")
                    else:
                        b = info["beam"]
                        bx, by, bz, top = b["x"], b["y"], b["z"], b["top"]
                        W_, H_ = rig.size
                        p0 = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [bx, by + 0.3, bz])
                        p1 = rig.js("([x, y, z]) => window.__LG__.project(x, y, z)", [bx, top - 0.1, bz])
                        rect = [max(0, int(p0[0]) - 24), max(0, int(min(p0[1], p1[1])) - 6), 49, int(abs(p0[1] - p1[1])) + 12]
                        rect[3] = min(rect[3], H_ - rect[1])
                        SET_JS = "([cx, cz, r]) => { window.__LC__.W.debugLootFx().uniforms.storm.value.set(cx, cz, r); return 1; }"

                        def beam_px(cx, cz, r):
                            rig.js(SET_JS, [cx, cz, r])
                            rig.js("() => window.__LG__.vis(false, true, false)")
                            on = rig.grab(rect, True, False)["hdr"][..., :3]
                            rig.js("(s) => window.__LG__.hide([[1, s]])", b["slot"])
                            of = rig.grab(rect, True, False)["hdr"][..., :3]
                            rig.js("() => window.__LG__.unhide()")
                            rig.js("() => window.__LG__.vis(true, true, true)")
                            dl = lum(on) - lum(of)
                            return {"px": int((np.abs(on - of).max(axis=-1) > 0.01).sum()), "peak": round(float(np.abs(dl).max()), 4)}
                        R_ = 200.0
                        r_in = beam_px(bx, bz, R_)                        # beam at the centre of the circle
                        r_none = beam_px(0.0, 0.0, 1e9)                   # no circle (practice / before the first circle)
                        r_edge = beam_px(bx + R_ + 6.0, bz, R_)           # 6 m beyond the edge: 1 - smoothstep(r - 6, r + 18, r + 6) = 0.5
                        r_out = beam_px(bx + R_ + 24.0, bz, R_)           # 24 m beyond: gone
                        r_far = beam_px(bx + 900.0, bz, R_)               # far outside
                        v.info("stormfade beam pixels (own-slot A/B, legendary, 7 m)", {"inside": r_in, "noCircle": r_none, "edge+6": r_edge, "edge+24": r_out, "far": r_far, "rect": rect})
                        if r_in["px"] < 30:
                            v.cnj("stormfade: beam fades beyond the storm circle", "only %d beam pixels inside the circle (framing)" % r_in["px"])
                        else:
                            v.check("stormfade: with no circle (r = 1e9) the beam is drawn in full (no NaN from smoothstep with equal edges)",
                                    r_none["px"] >= 0.95 * r_in["px"] and r_none["peak"] >= 0.95 * r_in["peak"], {"inside": r_in, "noCircle": r_none})
                            v.check("stormfade: 6 m beyond the circle edge the beam is about half faded, 24 m beyond it is gone (and stays gone far outside)",
                                    0.25 * r_in["peak"] <= r_edge["peak"] <= 0.8 * r_in["peak"] and r_out["px"] == 0 and r_out["peak"] < 1e-3 and r_far["px"] == 0,
                                    {"inside": r_in, "edge+6": r_edge, "edge+24": r_out, "far": r_far}, expect="edge+6 peak in [0.25, 0.8] x inside; edge+24 and far: 0 pixels")
                    # (a) the module follows a provider's numbers: a provider the gate controls (a property that ignores writes)
                    FOLLOW_JS = r"""([cx, cz, r]) => { const W = window.__LC__.W; window.__LG__._stormPrev = Object.getOwnPropertyDescriptor(W, 'stormU') || null;
                        const o = { get cx() { return cx; }, set cx(v) {}, get cz() { return cz; }, set cz(v) {}, get r() { return r; }, set r(v) {} };
                        Object.defineProperty(W, 'stormU', { value: o, writable: true, configurable: true, enumerable: true }); return true; }"""
                    NOPROV_JS = r"""() => { const W = window.__LC__.W; window.__LG__._stormPrev = Object.getOwnPropertyDescriptor(W, 'stormU') || null;
                        Object.defineProperty(W, 'stormU', { get() { return undefined; }, set(v) {}, configurable: true, enumerable: true }); return true; }"""
                    RESTORE_JS = r"""() => { const W = window.__LC__.W, p = window.__LG__._stormPrev;
                        if (p) Object.defineProperty(W, 'stormU', p); else delete W.stormU; window.__LG__._stormPrev = null; return !!W.stormU; }"""
                    s.js(FOLLOW_JS, [123.5, -77.25, 431.75])
                    s.step_frames(2, 1 / 60, True)
                    uni_a = s.js(UNI_JS)
                    s.js(RESTORE_JS)
                    v.check("stormfade: the module's storm uniform follows a W.stormU provider (cx, cz, r)",
                            abs(uni_a[0] - 123.5) < 1e-3 and abs(uni_a[1] + 77.25) < 1e-3 and abs(uni_a[2] - 431.75) < 1e-3, {"provider": [123.5, -77.25, 431.75], "uniform": uni_a})
                    # (c) no provider: the module reads the sim's circle itself (3 Hz) and lands on the same numbers
                    EXPECT_JS = r"""() => { const W = window.__LC__.W, sc = W.stormCtl;
                        if (!sc || !sc.storm || !sc.storm.phases || !sc.storm.phases.length) return [0, 0, 1e9];
                        const st = sc.storm.stateAt(W.t); return (st && st.center && st.radius > 0.5) ? [st.center.x, st.center.z, st.radius] : [0, 0, 1e9]; }"""
                    s.js(NOPROV_JS)
                    s.step_frames(40, 1 / 60, True)
                    uni_c = s.js(UNI_JS)
                    exp_c = s.js(EXPECT_JS)
                    s.js(RESTORE_JS)
                    close = lambda a, b: abs(a - b) <= max(4.0, 1e-6 * abs(b))  # noqa: E731  (the 3 Hz read lags the expectation by <= 0.33 s of sim)
                    v.check("stormfade: with no W.stormU the module reads the sim's circle itself and lands on the same numbers (not stuck on a provider's)",
                            all(close(uni_c[i], exp_c[i]) for i in range(3)) and abs(uni_c[2] - 431.75) > 1.0, {"uniform": uni_c, "simCircle": exp_c})
                    s.step_frames(2, 1 / 60, True)                     # the real provider (if any) is the source again
                    s.js("(id) => window.__LC__.W.netTakeItem(id)", iid)
                    s.step_frames(1, 1 / 60, True)

            # ---- errors -----------------------------------------------------------------------------------------------
            d = s.diagnostics()
            mine = [t for t in d["shader"] if "Material Name: Loot" in t or "loot-" in t]
            other = [t for t in d["shader"] if t not in mine]
            v.check("errors: 0 page errors, 0 window errors, 0 console errors, 0 failed requests",
                    not (d["pageErrors"] or d["windowErrors"] or d["consoleErrors"] or d["failedRequests"]),
                    {k: d[k][:3] for k in ("pageErrors", "windowErrors", "consoleErrors", "failedRequests")})
            v.check("errors: 0 shader errors from the loot materials", not mine, {"mine": len(mine), "first": (mine[0][:300] if mine else None)})
            if other:
                names = sorted({(t.split("Material Name:")[1].split("\n")[0].strip() if "Material Name:" in t else t[:60]) for t in other})
                v.info("shader errors from OTHER lanes' materials (not gating this lane)", {"count": len(other), "materials": names})

    return C.run_gate("loot_beams_rings", body, args)


if __name__ == "__main__":
    sys.exit(main())
