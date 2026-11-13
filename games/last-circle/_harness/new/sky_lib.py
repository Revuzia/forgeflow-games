#!/usr/bin/env python
"""SKY lane (Wave 4) shared helpers for the sky / fog / palette probes.

  * head_maps_override(session): serve runtime/3d/royale/maps.js as committed at git HEAD while EVERY other file
    comes from the working copy. That gives a frozen BEFORE column for a maps.js-only change even though other
    lanes are editing other files in the same tree right now (common.py --rev would freeze their files too).
  * HELPERS_JS: __SKY__.place / status helpers (the research capture.py pattern, trimmed).
  * stats(): the lighting-post imgstats numbers (luma, sd, sat, |r-b|) over the same centre crop.
"""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402

MAPS_REL = "games/last-circle/runtime/3d/royale/maps.js"


def head_maps_bytes():
    r = subprocess.run(["git", "-C", C.REPO, "show", "HEAD:" + MAPS_REL], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("git show HEAD:%s failed: %s" % (MAPS_REL, r.stderr[:200]))
    return r.stdout


def work_maps_bytes():
    with open(os.path.join(C.ROOT, "runtime", "3d", "royale", "maps.js"), "rb") as f:
        return f.read()


def maps_override(session, which, subs=None):
    """Call after session.start(): route the maps.js request to `which` = 'head' (the committed bytes) or 'work' (the
    working copy). With --rev HEAD for everything else this isolates a maps.js-only A/B from other lanes' half-edited files.
    `subs` = [(old, new), ...] text substitutions applied to the SERVED copy only (falsifier plants, the Step B sheet);
    every `old` must be present, so a stale patch can never silently do nothing."""
    body = head_maps_bytes() if which == "head" else work_maps_bytes()
    if subs:
        text = body.decode("utf-8")
        for old, new in subs:
            if old not in text:
                raise RuntimeError("maps.js substitution target not found: %r" % old[:80])
            text = text.replace(old, new)
        body = text.encode("utf-8")

    def pred(url):
        return "/royale/maps.js" in url.split("?")[0]

    def handler(route):
        route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
                                                      "Access-Control-Allow-Origin": "*"})
    session.disk.overrides.append((pred, handler))
    return len(body)


def head_maps_override(session):
    return maps_override(session, "head")


HELPERS_JS = r"""() => {
  const C = window.__LC__, W = C.W;
  window.__SKY__ = {
    pois() { return W.map.pois.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r })); },
    yawTo(fx, fz, tx, tz) { return Math.atan2(-(tx - fx), -(tz - fz)); },
    ground(x, z) { return W.map.heightAt(x, z); },
    place(x, y, z, yaw, pitch, o) {
      o = o || {}; const p = W.player;
      p.pos.set(x, y, z); p.vel.set(0, o.vy || 0, 0);
      if (o.ground != null) { p.gliding = !o.ground; p.onGround = !!o.ground; }
      if (p.obj) p.obj.position.copy(p.pos);
      p.input.yaw = yaw; p.input.pitch = pitch; p.yaw = yaw; p.pitch = pitch;
    },
    top() { const p = W.player; if (p && p.alive) { p.hp = Math.max(p.hp, 100); p.shield = Math.max(p.shield || 0, 100); } },
    status() {
      const p = W.player, f = W.scene.fog;
      return { phase: W.phase, t: +W.t.toFixed(1), alive: !!p.alive, gliding: !!p.gliding, onGround: !!p.onGround,
               pos: [+p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1)],
               cam: [+W.camera.position.x.toFixed(1), +W.camera.position.y.toFixed(1), +W.camera.position.z.toFixed(1)],
               fogDensity: f ? +f.density.toFixed(6) : null, baseFog: W.map && W.map.K ? W.map.K.fog : null,
               programs: W.kernel.renderer.info.programs.length };
    },
  };
  return 'ok';
}"""


def stats(path):
    """lighting-post imgstats over the same centre crop (11-89 % x 16-84 %): luma mean / sd, mean HSV saturation, r-b, |r-b|."""
    import cv2
    import numpy as np
    im = cv2.imread(path)
    h, w = im.shape[:2]
    if "reference" in path.replace("\\", "/"):
        crop = im[120:470, 140:660]
    else:
        crop = im[int(h * 0.11):int(h * 0.89), int(w * 0.16):int(w * 0.84)]
    f = crop.astype(np.float32) / 255.0
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).astype(np.float32)
    sat = hsv[..., 1] / 255.0
    return {"luma": float(luma.mean()), "luma_sd": float(luma.std()), "sat": float(sat.mean()),
            "r_minus_b": float(r.mean() - b.mean()), "abs_r_minus_b": float(abs(r.mean() - b.mean())),
            "r": float(r.mean()), "g": float(g.mean()), "b": float(b.mean())}


def sky_region_stats(path, y0=0.04, y1=0.30, x0=0.30, x1=0.70):
    """Stats of just the sky band at the top of a ground view (HUD-free centre columns)."""
    import cv2
    import numpy as np
    im = cv2.imread(path)
    h, w = im.shape[:2]
    crop = im[int(h * y0):int(h * y1), int(w * x0):int(w * x1)]
    f = crop.astype(np.float32) / 255.0
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).astype(np.float32)
    return {"r": float(r.mean()), "g": float(g.mean()), "b": float(b.mean()), "sat": float((hsv[..., 1] / 255.0).mean()),
            "luma_sd": float((0.2126 * r + 0.7152 * g + 0.0722 * b).std())}


# ───────────────────────────────── per-map measuring (shared by sky_shots.py and sky_probe.py) ─────────────────────────────────
import math  # noqa: E402

COUNT_HOOKS_JS = r"""() => { const W = window.__LC__.W, r = W.kernel.renderer, P = window.__H_PUMP__; r.info.autoReset = false;
  window.__CNT__ = { last: null };
  P.onBeforeRender = () => { r.info.reset(); window.__CNT__.p0 = r.info.programs.length; };
  P.onAfterRender = () => { window.__CNT__.last = { calls: r.info.render.calls, tris: r.info.render.triangles,
    programs: r.info.programs.length, newPrograms: r.info.programs.length - window.__CNT__.p0 }; }; return 'ok'; }"""

# world fingerprint: everything buildMap placed from the seeded rng stream (POIs, loot/chest points, every collider box)
FINGERPRINT_JS = r"""() => { const W = window.__LC__.W, m = W.map; let h = 2166136261 >>> 0;
  const mix = (v) => { const q = Math.round(v * 1000) | 0; h ^= q & 0xff; h = Math.imul(h, 16777619) >>> 0; h ^= (q >> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    h ^= (q >> 16) & 0xff; h = Math.imul(h, 16777619) >>> 0; h ^= (q >>> 24) & 0xff; h = Math.imul(h, 16777619) >>> 0; };
  for (const p of m.pois) { mix(p.x); mix(p.z); mix(p.r); }
  for (const l of m.lootPoints) { mix(l.x); mix(l.y); mix(l.z); mix(l.kind === 'chest' ? 1 : 2); }
  let nb = 0; for (const c of m.colliders) { nb++; mix(c.minX); mix(c.maxX); mix(c.minY || 0); mix(c.maxY || 0); mix(c.minZ); mix(c.maxZ); }
  for (let i = 0; i < 64; i++) { const x = ((i % 8) - 3.5) * 180, z = (Math.floor(i / 8) - 3.5) * 180; mix(m.heightAt(x, z)); }
  return { hash: h.toString(16), pois: m.pois.length, loot: m.lootPoints.length, colliders: nb }; }"""

SPRITE_CENSUS_JS = r"""() => { const W = window.__LC__.W, g = W._groups && W._groups.map; if (!g) return null;
  let sprites = 0; const mats = new Set(); const tex = new Set();
  g.traverse((o) => { if (o.isSprite) { sprites++; mats.add(o.material); if (o.material && o.material.map) tex.add(o.material.map); } });
  let calls = 0; return { sprites, distinctSpriteMaterials: mats.size, distinctSpriteTextures: tex.size }; }"""

SKY_HANDLES_JS = r"""() => { const W = window.__LC__.W, d = W.skyDome, u = W.skyUniforms; if (!u || !d) return { present: false };
  const live = d.material && d.material.uniforms && d.material.uniforms.top === u.top && d.material.uniforms.bot === u.bot;
  return { present: true, isUniform: !!(u.top && 'value' in u.top && u.top.value && u.top.value.isColor && u.bot.value.isColor), live: !!live,
           domeName: d.name, domeIsMesh: !!d.isMesh, inScene: (() => { let f = false; W.scene.traverse((o) => { if (o === d) f = true; }); return f; })() }; }"""


# Clouds OFF for the seam measurement only (both columns): the AFTER dome's cloud deck (cloudCov -1 => coverage clamps to 0 =>
# no cloud texel passes the threshold) and the BEFORE build's sprite-cloud groups (the only map objects carrying userData.drift).
# Cloud edges are real row-to-row luminance steps in the top of an outward view, so with them in frame the seam score measures
# the clouds, not the horizon (first 2026-10-12 run: every AFTER max step sat at rows 8-97, inside the cloud deck).
NOCLOUDS_JS = r"""(on) => { const W = window.__LC__.W, d = W.skyDome, g = W._groups && W._groups.map;
  const S = window.__NOCL__ = window.__NOCL__ || { cov: null, hidden: [] };
  if (on) {
    if (d && d.material && d.material.uniforms && d.material.uniforms.cloudCov) { S.cov = d.material.uniforms.cloudCov.value; d.material.uniforms.cloudCov.value = -1; }
    if (g) g.traverse((o) => { if (o.userData && o.userData.drift != null && o.visible) { o.visible = false; S.hidden.push(o); } });
    return { domeCov: S.cov, spriteGroupsHidden: S.hidden.length };
  }
  if (S.cov != null && d && d.material.uniforms.cloudCov) d.material.uniforms.cloudCov.value = S.cov;
  S.cov = null; for (const o of S.hidden) o.visible = true; S.hidden = []; return 'restored'; }"""


def seam_strength(path, y1=0.70):
    """Max row-to-row mean luminance step (3-row difference) in the two side column bands = a horizontal map-edge / ocean seam score.
    Only the top `y1` of the frame is searched: the bottom is the island's own shoreline / terrain, which is scene content, not a seam."""
    import cv2
    import numpy as np
    im = cv2.imread(path)
    g = (0.0722 * im[..., 0] + 0.7152 * im[..., 1] + 0.2126 * im[..., 2]).astype(np.float32) / 255.0
    h, w = g.shape
    bands = np.concatenate([g[:, int(w * 0.04):int(w * 0.30)], g[:, int(w * 0.70):int(w * 0.96)]], axis=1)
    prof = bands.mean(axis=1)
    step = np.abs(prof[3:] - prof[:-3])
    step[:6] = 0
    step[int(h * y1):] = 0
    return float(step.max()), int(step.argmax())


class MapRun:
    """One started match on `mid` with count hooks installed; take() poses the camera and records numbers + a PNG."""

    def __init__(self, s, mid, seed, mode, outdir, tag):
        self.s, self.mid, self.seed, self.mode, self.outdir, self.tag = s, mid, seed, mode, outdir, tag
        self.shots = {}
        os.makedirs(outdir, exist_ok=True)

    def start(self):
        s = self.s
        self.start_info = s.start_match(self.mode, self.seed, self.mid, enter=True)
        s.js(HELPERS_JS)
        s.js(COUNT_HOOKS_JS)
        s.guard_player(True)
        self.pois = s.js("() => window.__SKY__.pois()")
        self.half = s.js("() => window.__LC__.W.map.half")
        self.big = max(self.pois, key=lambda p: p["r"])
        self.gy = s.js("([x,z]) => window.__SKY__.ground(x,z)", [self.big["x"], self.big["z"]])
        return self.start_info

    def drop_pose(self, alt):
        px, pz = self.big["x"], self.big["z"]
        back = alt / math.tan(0.82)
        fx, fz = px + math.sin(0.7) * back, pz + math.cos(0.7) * back
        yaw = self.s.js("([a,b,c,d]) => window.__SKY__.yawTo(a,b,c,d)", [fx, fz, px, pz])
        return fx, self.gy + alt, fz, yaw, -0.2

    def edge_poses(self):
        e = self.half * 0.9
        return {"edge250_px": (e, 250.0, 0, -math.pi / 2, -0.12), "edge250_nx": (-e, 250.0, 0, math.pi / 2, -0.12),
                "edge250_pz": (0, 250.0, e, math.pi, -0.12), "edge250_nz": (0, 250.0, -e, 0.0, -0.12)}

    def ground_spot(self):
        s = self.s
        dry = [q for q in self.pois if s.js("([x,z]) => window.__SKY__.ground(x,z)", [q["x"], q["z"]]) >= 3.0]
        dp = max(dry, key=lambda q: q["r"]) if dry else self.big
        gx, gz = dp["x"] + 24.0, dp["z"] + 24.0
        ggy = s.js("([x,z]) => window.__SKY__.ground(x,z)", [gx, gz])
        sun = s.js("() => window.__LC__.W.map.K.sun.pos")
        return gx, ggy, gz, math.atan2(-sun[0], -sun[2]), dp["id"]

    def shore_spot(self):
        """A beach spot with open sea beyond it: scan outward along 24 bearings from the map centre for the first crossing of the
        waterline (ground < 0.4 m) that has >= 150 m of water after it. Returns (x, ground_y, z, yaw_looking_out) or None (no water map)."""
        # (2026-10-12: the first version required land >= 1.2 m on the sample right before the first < 0.4 m one, 4 m apart; the
        #  islands' beaches are gentler than that, so it found no spot on ANY map and the shore row silently dropped out. Now the
        #  last sample >= 1.2 m before the waterline is the standing spot.)
        res = self.s.js("""() => { const W = window.__LC__.W, m = W.map; if (!(m.waterY > -100)) return null;
            const half = m.half || 800;
            for (let a = 0; a < 24; a++) { const th = a * Math.PI / 12;
              let land = null;
              for (let r = 60; r < half; r += 4) { const x = Math.cos(th) * r, z = Math.sin(th) * r, h = m.heightAt(x, z);
                if (h >= 1.2) land = { x, z, h };
                else if (h < 0.4 && land) {
                  let sea = true; for (let q = r; q < r + 150; q += 10) if (m.heightAt(Math.cos(th) * q, Math.sin(th) * q) > 0.4) { sea = false; break; }
                  if (sea) return { x: land.x, z: land.z, y: land.h, th };
                  land = null; } } }
            return null; }""")
        if not res:
            return None
        th = res["th"]
        # looking outward (+r direction = (cos th, sin th)); forward = (-sin yaw, -cos yaw)
        return res["x"], res["y"], res["z"], math.atan2(-math.cos(th), -math.sin(th))

    def take(self, name, x, y, z, yaw, pitch, vy=-2, ground=None, frames=6, png=True):
        s = self.s
        o = {"vy": vy}
        if ground is not None:
            o["ground"] = ground
        for _ in range(2):
            s.js("([x,y,z,yw,pt,o]) => window.__SKY__.place(x,y,z,yw,pt,o)", [x, y, z, yaw, pitch, o])
            s.js("() => window.__SKY__.top()")
            s.step_frames(frames, 1 / 60, render=False)
        s.js("([x,y,z,yw,pt,o]) => window.__SKY__.place(x,y,z,yw,pt,o)", [x, y, z, yaw, pitch, o])
        path = os.path.join(self.outdir, "%s_%s_%s.png" % (self.tag, self.mid, name)) if png else None
        if png:
            s.canvas_png(path, js_render="window.__H_PUMP__.frame(1/60, true)")
        else:
            s.step_frames(1, 1 / 60, render=True)
        st = s.js("() => window.__SKY__.status()")
        st["counts"] = s.js("() => window.__CNT__.last")
        if png:
            st["imgstats"] = stats(path)
            st["seamWithClouds"], st["seamRowWithClouds"] = seam_strength(path)
            if name.startswith("edge") or name.startswith("shore"):
                # the gated seam score: the same pose and frame re-rendered with the clouds off (see NOCLOUDS_JS)
                pnc = os.path.join(self.outdir, "%s_%s_%s_noclouds.png" % (self.tag, self.mid, name))
                st["noclouds"] = s.js(NOCLOUDS_JS, True)
                s.canvas_png(pnc, js_render="window.__H_PUMP__.frame(1/60, true)")
                s.js(NOCLOUDS_JS, False)
                st["seam"], st["seamRow"] = seam_strength(pnc)
                st["pngNoClouds"] = pnc
            else:
                st["seam"], st["seamRow"] = st["seamWithClouds"], st["seamRowWithClouds"]
            if name.startswith("ground_"):
                st["skyBand"] = sky_region_stats(path)
            st["png"] = path
        self.shots[name] = st
        return st
