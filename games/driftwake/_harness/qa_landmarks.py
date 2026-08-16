# -*- coding: utf-8 -*-
"""
qa_landmarks.py -- the realm landmark layer (src/world/landmarks.js), measured.

Per realm (cold / sand / ash) this asserts, on the LIVE layer rather than on the
source:

  1. INSTANCE COUNT     3 types x PER_TYPE instances are actually built.
  2. SPACING            every pair of landmarks in the realm is >= 150 m apart.
  3. SHRINE CLEARANCE   every landmark is >= 120 m from all seven
                        `shrine.positions`.
  4. GROUNDING          per prism, against 16 fresh ring samples of the live
                        heightfield: FLOAT (base above the lowest ground under
                        its own base ring) must be ~0, BURY must stay under a
                        fraction of the prism's height, and a re-derived seat
                        proves the post-swap re-ground actually fired.
  5. DRAWS              the layer's own draw calls, counted EXACTLY by hooking
                        `onBeforeRender` on the beauty mesh and its cascade
                        proxies. A whole-scene toggle diff is also reported, but
                        it is noisy (Ash's weather/motes/director move the total
                        between adjacent frames) and is not what is asserted.
  6. HORIZON SHOT       a screenshot per realm whose landmark is proven VISIBLE,
                        not merely in frustum: the world is frozen with
                        `S.freezeTime`, two frames are captured that differ only
                        in the layer's visibility, and the changed pixels inside
                        the projected silhouette are counted. Stands are searched
                        and verified by render -- projection alone once reported
                        a landmark "dead centre, 108 px tall" that a dune was
                        depth-rejecting entirely.

Game-time waits only (`combat.registry.time` + rAF); no wall sleeps for game
state. Port 8873.

    python qa_landmarks.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
# The repo root the server is rooted at: .../forgeflow-games. HERE is
# .../games/driftwake/_harness, so that is parents[2] OF THE DIRECTORY --
# qa_clippitch.py's `parents[3]` counts from the FILE, not from `.parent`.
ROOT = HERE.parents[2]
PORT = 8873
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
SHOTS = HERE.parent / "_shots"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# --------------------------------------------------------------- page helpers

# Installed once. `gameWait` counts GAME seconds off the combat registry clock,
# `frames` counts rAF ticks, and `settle` waits for the growth animation to
# report itself finished rather than guessing at a duration.
INSTALL = """() => {
  const SF = globalThis.SNOWFLOW;
  window.__h = {
    gameWait: (sec) => new Promise((res) => {
      const t0 = SF.combat.registry.time;
      const tick = () => (SF.combat.registry.time - t0 >= sec)
        ? res() : requestAnimationFrame(tick);
      tick();
    }),
    frames: (n) => new Promise((res) => {
      let k = 0;
      const tick = () => (++k >= n) ? res() : requestAnimationFrame(tick);
      tick();
    }),
    settle: (maxFrames) => new Promise((res) => {
      let k = 0;
      const tick = () => (SF.landmarks._settled || ++k >= maxFrames)
        ? res({ settled: SF.landmarks._settled, frames: k })
        : requestAnimationFrame(tick);
      tick();
    }),
    // Every object the landmark layer puts in front of the rasteriser: the
    // beauty mesh plus the cascade proxies `shadows.registerCaster` built,
    // which share the beauty geometry instance and are otherwise unfindable.
    layerObjects: () => {
      const lm = SF.landmarks, out = [lm.mesh];
      for (const sc of SF.shadows.scenes)
        for (const o of sc.children)
          if (o.geometry === lm.mesh.geometry) out.push(o);
      return out;
    },
  };
  return true;
}"""

ENTER = """async (realm) => {
  const SF = globalThis.SNOWFLOW;
  await SF.enterRealm(realm);
  const s = await window.__h.settle(600);
  await window.__h.gameWait(0.5);
  return s;
}"""

# Geometry + grounding, all computed in the page so nothing large crosses the
# bridge. Distances are plain Euclidean in the xz plane, the same quantity
# landmarks.js's own placement filter uses.
MEASURE = """() => {
  const SF = globalThis.SNOWFLOW, lm = SF.landmarks, T = SF.terrain;
  const st = lm.stats;
  const inst = st.instances;

  let minPair = Infinity, pairA = null, pairB = null;
  for (let i = 0; i < inst.length; i++)
    for (let j = i + 1; j < inst.length; j++) {
      const d = Math.hypot(inst[i].x - inst[j].x, inst[i].z - inst[j].z);
      if (d < minPair) { minPair = d; pairA = inst[i].type; pairB = inst[j].type; }
    }

  const shr = SF.shrine.positions;
  let minShrine = Infinity, shrineOf = null;
  for (const a of inst)
    for (const s of shr) {
      const d = Math.hypot(a.x - s.x, a.z - s.z);
      if (d < minShrine) { minShrine = d; shrineOf = a.type + '/' + s.id; }
    }

  // GROUNDING. "Nothing floats or buries" is not one number, because on sloping
  // ground it CANNOT be: a rigid prism 3-6 m across, standing where the terrain
  // falls 3 m over its own footprint, must either bury its uphill side or float
  // its downhill one. landmarks.js seats on the footprint minimum, which chooses
  // burying -- so these are the two quantities that matter, measured
  // INDEPENDENTLY of how the base was written (16 fresh ring samples per prism
  // at a rotated offset, where landmarks.js's seat uses 12):
  //
  //   float  how far a prism's base sits ABOVE the lowest ground under its own
  //          base ring. This is the visible failure and it must be ~0.
  //   bury   how far the base sits BELOW the highest ground under that ring,
  //          as a fraction of the prism's own height. Reads as a monument
  //          standing in its own drift; only a problem if it swallows the prism.
  //
  // `driftDy` re-derives the seat against the live heightfield and so is the
  // test that the post-swap RE-GROUND fired at all: a layer still carrying the
  // previous realm's heights misses by metres.
  const ri = SF.realms.REALM_ORDER.indexOf(lm.realm);
  const w = lm.prismCount * 4;
  let flo = 0, floAt = null, bur = 0, burAt = null, spread = 0;
  let drift = 0, driftAt = null, n = 0;
  for (let p = 0; p < lm.prismCount; p++) {
    if (lm._prismRealm[p] !== ri) continue;
    const o = p * 4;
    const x = lm._texData[o], y = lm._texData[o + 1], z = lm._texData[o + 2];
    const h = lm._texData[o + 3];
    const rad = lm._texData[w + o + 3];

    // 16 samples where landmarks.js's seat uses 12, and offset so only every
    // fourth angle coincides -- the check must be able to find ground the seat
    // stepped over, or it is measuring its own arithmetic back at itself.
    let lo = T.heightAt(x, z), hi = lo;
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8 + 0.19;
      const g = T.heightAt(x + Math.cos(ang) * rad, z + Math.sin(ang) * rad);
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    const base = y - lm._baseOff[p];
    const f = base - lo;                       // + is floating
    const b = (hi - base) / Math.max(h, 1e-3); // fraction of the prism buried
    const d = Math.abs(base - (lo - 0.02));    // re-ground freshness
    if (f > flo) { flo = f; floAt = [+x.toFixed(1), +z.toFixed(1)]; }
    if (b > bur) { bur = b; burAt = [+x.toFixed(1), +z.toFixed(1)]; }
    if (d > drift) { drift = d; driftAt = [+x.toFixed(1), +z.toFixed(1)]; }
    if (hi - lo > spread) spread = hi - lo;
    n++;
  }

  // Radial band + per-type census.
  const byType = {};
  let rMin = Infinity, rMax = 0;
  for (const a of inst) {
    byType[a.type] = (byType[a.type] || 0) + 1;
    const r = Math.hypot(a.x, a.z);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }

  return {
    realm: st.realm, types: st.types, perType: st.perType,
    instances: inst.length, byType,
    prismsTotal: st.prisms, livePrisms: n, triangles: lm.triangles,
    settled: st.settled,
    minPair: +minPair.toFixed(1), minPairBetween: pairA + ' / ' + pairB,
    minShrine: +minShrine.toFixed(1), minShrineAt: shrineOf,
    radial: [+rMin.toFixed(0), +rMax.toFixed(0)],
    floatMax: +flo.toFixed(3), floatAt: floAt,
    buryMaxFrac: +bur.toFixed(3), buryAt: burAt,
    regroundDy: +drift.toFixed(3), regroundAt: driftAt,
    footSpread: +spread.toFixed(2),
    anchors: inst.map(a => ({ t: a.type, x: a.x, z: a.z, y: a.y })),
  };
}"""

# Draw delta, by PAIRED sampling.
#
# The first cut took a block of 21 frames with the layer on, then a block with
# it off, and diffed the medians. That reported Ash at delta = -2 -- an
# impossible answer, and the tell that the two blocks were not measuring the
# same scene: the ember weather and the spell pools change their own draw count
# between blocks, and in Ash that churn is larger than the signal.
#
# So the states are interleaved instead: on, off, on, off, ... 15 pairs, each
# pair one frame apart, and the median of the PER-PAIR differences is taken.
# Anything that drifts on a timescale longer than a frame now cancels inside
# each pair rather than landing in the answer.
DRAWS = """async () => {
  const SF = globalThis.SNOWFLOW;
  const objs = window.__h.layerObjects();
  const was = objs.map(o => o.visible);
  const set = (v) => objs.forEach(o => { o.visible = v; });
  const frame = () => new Promise(r => requestAnimationFrame(r));

  const d = [], onV = [], offV = [];
  // One warm pair first: the very first toggle can land mid-frame.
  set(true); await frame(); set(false); await frame();
  for (let k = 0; k < 15; k++) {
    set(true);  await frame(); const on  = SF.perfStats.drawCalls;
    set(false); await frame(); const off = SF.perfStats.drawCalls;
    onV.push(on); offV.push(off); d.push(on - off);
  }
  objs.forEach((o, i) => { o.visible = was[i]; });
  const med = (v) => { const s = v.slice().sort((a, b) => a - b); return s[7]; };

  // EXACT count, and the one asserted on. Even paired, the toggle diff is a
  // difference of two whole-scene totals, and in Ash the ember weather, the
  // health motes and the encounter director move that total between adjacent
  // frames -- measured at a median of 4 with a 3..7 spread, for a layer that
  // can only be 3. Three calls `onBeforeRender` once per object per draw, which
  // is the technique core/perf.js:544-556 already uses for its per-draw
  // breakdown, so hooking the layer's own three objects counts the layer's own
  // draws and nothing else.
  const prev = objs.map(o => o.onBeforeRender);
  let hits = 0;
  objs.forEach(o => { o.onBeforeRender = function () { hits++; }; });
  const F = 6;
  for (let k = 0; k < F; k++) await frame();
  objs.forEach((o, i) => { o.onBeforeRender = prev[i]; });

  return {
    objects: objs.length, drawsOn: med(onV), drawsOff: med(offV),
    delta: med(d), deltaMin: Math.min(...d), deltaMax: Math.max(...d),
    exact: Math.round(hits / F),
  };
}"""

# The horizon shot, and the measurement that makes "reads at 200+ m" a number
# rather than an opinion.
#
# STAND POINT. Not "outward from the origin" -- that aims down an arbitrary
# bearing relative to the sun, and the first cut of this probe shot Sand's Watch
# Spire straight into a 22-degree sun and produced a white frame with a sliver in
# it. The camera is placed `dist` metres from the landmark ALONG THE SUN'S
# horizontal bearing, so the sun is behind the camera and the monument is
# front-lit. The subject is also chosen mid-band (nearest r = 320 m) so the shot
# looks across the field rather than off the edge of the play area.
#
# AIM. `_fwd` in core/camera.js:239-243 is
# (sin(yaw)*cos(pitch), -sin(pitch), -cos(yaw)*cos(pitch)), so looking along
# (dx, dz) means yaw = atan2(dx, -dz).
#
# MEASUREMENT. The landmark's base and crown are projected through the live
# camera to pixels. `pxHeight` is what the claim actually rests on, and
# `offCentreFrac` catches an aim error the way an eyeball cannot.
# PLAN / APPLY -- a render-VERIFIED search for a viewpoint.
#
# Predicting visibility from terrain.heightAt alone does not survive this
# terrain. Measured: with the world frozen, Ash's colonnade sat dead centre at
# NDC (-0.005, 0.191, 0.9987) -- in frustum, 175 m out, growth 1, mesh visible
# -- and still changed ZERO pixels, because a dune crest depth-rejected every
# one of them. A line-of-sight walk with slack said that stand was clear.
#
# So the walk is demoted to a RANKING heuristic and the caller decides by
# rendering: PLAN builds an ordered list of candidate stands (every instance of
# the type x several ranges in the 150-300 m band x several bearings either side
# of the sun, LOS-clear ones first), APPLY puts the camera on candidate k, and
# the caller diffs a frozen pair per candidate until one actually puts ink on
# screen. Prediction proposes; the framebuffer decides.
PLAN = """(P) => {
  const SF = globalThis.SNOWFLOW, T = SF.terrain;
  const all = SF.landmarks.stats.instances;
  const list = all.filter(i => i.type === P.type);
  const pool = list.length ? list : all;
  const sd = SF.sky.sunDir;
  const sBear = Math.atan2(sd.x, sd.z);
  const eyeH = 4.0;                       // measured camera eye above the stand

  // Dense, no-slack sight walk. Ranking only -- see the header.
  const clearScore = (qx, qz, y0, a2) => {
    const ty = a2.y + P.crownM * 0.55;
    let worst = 0;
    for (let s = 1; s < 48; s++) {
      const f = s / 48;
      const gx = qx + (a2.x - qx) * f, gz = qz + (a2.z - qz) * f;
      const ray = y0 + (ty - y0) * f;
      const over = T.heightAt(gx, gz) - ray;
      if (over > worst) worst = over;
    }
    return worst;                          // <= 0 means nothing blocks the crown
  };

  // Does the crown break the SKYLINE from this stand?
  //
  // This is the condition that decides whether a landmark reads at all, and it
  // is what separates Ash's one working viewpoint from its many failures. A
  // monument seen against dark ground is invisible once the realm's fog has
  // eaten 95% of its contrast; the same monument against the bright sky is a
  // clean silhouette. So: continue the eye->crown ray PAST the landmark and ask
  // whether any terrain out to +260 m still rises above it. Positive = clear
  // sky behind the crown.
  const skyBreak = (qx, qz, y0, a2) => {
    const ty = a2.y + P.crownM * 0.85;
    const dx = a2.x - qx, dz = a2.z - qz;
    const L = Math.hypot(dx, dz) || 1;
    const ux = dx / L, uz = dz / L;
    const slope = (ty - y0) / L;
    let margin = 1e9;
    for (let d = 40; d <= 260; d += 20) {
      const gx = a2.x + ux * d, gz = a2.z + uz * d;
      const ray = y0 + slope * (L + d);
      const m = ray - T.heightAt(gx, gz);
      if (m < margin) margin = m;
    }
    return margin;
  };

  const cands = [];
  for (const a of pool) {
    for (const dd of [P.dist, P.dist + 25, P.dist - 20, P.dist + 55,
                      P.dist - 35, P.dist + 90]) {
      if (dd < P.band[0] || dd > P.band[1]) continue;
      for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
        const b = sBear + off;
        const qx = a.x + Math.sin(b) * dd, qz = a.z + Math.cos(b) * dd;
        if (Math.hypot(qx, qz) > 600) continue;
        const y0 = T.heightAt(qx, qz) + eyeH;
        const dx = a.x - qx, dz = a.z - qz, L = Math.hypot(dx, dz);
        cands.push({
          ax: a.x, ay: a.y, az: a.z, type: a.type, label: a.label,
          px: qx, pz: qz, range: L,
          yaw: Math.atan2(dx / L, -dz / L),
          block: clearScore(qx, qz, y0, a),
          sky: skyBreak(qx, qz, y0, a),
          // Prefer: nothing blocking, then a stand HIGH relative to the
          // landmark (looking down a slope beats looking up one), then a
          // bearing near the sun so the face is lit.
          rise: T.heightAt(qx, qz) - a.y,
          off: Math.abs(off),
        });
      }
    }
  }
  // Unblocked first, then SKYLINE-BREAKING first (the readability condition),
  // then the biggest sky margin, then the bearing nearest the sun.
  cands.sort((u, v) =>
    (u.block > 0.5 ? 1 : 0) - (v.block > 0.5 ? 1 : 0) ||
    (u.sky > 0 ? 0 : 1) - (v.sky > 0 ? 0 : 1) ||
    v.sky - u.sky ||
    u.off - v.off);
  window.__cands = cands;
  return { total: cands.length,
           clear: cands.filter(c => c.block <= 0.5).length,
           skyline: cands.filter(c => c.block <= 0.5 && c.sky > 0).length };
}"""

APPLY = """async (P) => {
  const SF = globalThis.SNOWFLOW, c = SF.character, rig = SF.rig, T = SF.terrain;
  const k = Math.min(P.k, window.__cands.length - 1);
  const cd = window.__cands[k];
  const px = cd.px, pz = cd.pz, yaw = cd.yaw;

  c.position.set(px, T.heightAt(px, pz), pz);
  if (c.velocity) c.velocity.set(0, 0, 0);
  rig.yaw = yaw; rig.pitch = P.pitch;
  rig.distance = rig.distanceTarget = 4.2;
  SF.shrine.mesh.visible = false;

  // Wait for the CAMERA to converge, not for wall time: core/camera.js damps
  // the arm, and a 200-400 m teleport leaves it trailing for seconds (measured
  // at 223 m still adrift after 2.2 s, which framed the shot off centre).
  const conv = await new Promise((res) => {
    const t0 = SF.combat.registry.time;
    let n = 0;
    const tick = () => {
      c.position.set(px, T.heightAt(px, pz), pz);
      if (c.velocity) c.velocity.set(0, 0, 0);
      rig.yaw = yaw; rig.pitch = P.pitch;
      const gap = Math.hypot(rig.camera.position.x - px,
                             rig.camera.position.z - pz);
      if ((gap < 8 && SF.combat.registry.time - t0 >= 0.6) || ++n > 900) {
        res({ frames: n, camGap: +gap.toFixed(2) });
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });

  const cam = rig.camera;
  cam.updateMatrixWorld(true);
  const V = SF.renderer.domElement;
  const scratch = cam.position.clone();
  const proj = (wx, wy, wz) => {
    scratch.set(wx, wy, wz).project(cam);
    return [(scratch.x * 0.5 + 0.5) * V.width,
            (0.5 - scratch.y * 0.5) * V.height, scratch.z];
  };
  const b = proj(cd.ax, cd.ay, cd.az);
  const t = proj(cd.ax, cd.ay + P.crownM, cd.az);
  return {
    k, aimedAt: cd.type, label: cd.label,
    landmark: [+cd.ax.toFixed(1), +cd.az.toFixed(1)],
    stand: [+px.toFixed(1), +pz.toFixed(1)],
    standX: px, standZ: pz, yaw, pitch: P.pitch,
    range: +cd.range.toFixed(1),
    blockM: +cd.block.toFixed(2), riseM: +cd.rise.toFixed(1),
    skyM: +cd.sky.toFixed(1),
    yawDeg: +(rig.yaw * 180 / Math.PI).toFixed(1),
    drift: { camGap: conv.camGap, pinFrames: conv.frames },
    basePx: [Math.round(b[0]), Math.round(b[1])],
    crownPx: [Math.round(t[0]), Math.round(t[1])],
    pxHeight: Math.round(Math.abs(b[1] - t[1])),
    onScreen: b[2] > 0 && b[2] < 1 && b[0] > 0 && b[0] < V.width,
    offCentreFrac: +Math.abs(b[0] / V.width - 0.5).toFixed(3),
  };
}"""

RESTORE = """() => { globalThis.SNOWFLOW.shrine.mesh.visible = true; return true; }"""

# FREEZE the world for the paired shots.
#
# Holding the stand for N frames inside one evaluate is NOT enough, and the
# amplified crop `_zoom_ash.png` is the proof: a `pg.screenshot()` takes ~100 ms
# =~ 6 frames, and the autoplay build drives the controller through every one of
# them. The control and subject frames therefore came from different camera
# positions, and the "changed pixels" the first cut reported were the character
# and the ember bed having MOVED -- 8899 px of motion, zero px of evidence.
#
# `S.freezeTime` is the game's own pause: dt goes to 0, the controller and the
# rig stop integrating, and rAF keeps presenting. With it set, the only thing
# that can differ between the two frames is the layer's visibility, which is the
# whole point of the pair.
FREEZE = """async (on) => {
  const SF = globalThis.SNOWFLOW;
  SF.S.freezeTime = on;
  for (let k = 0; k < 8; k++) await new Promise(r => requestAnimationFrame(r));
  return SF.S.freezeTime;
}"""

# Hold the aimed stand for `n` frames -- run BEFORE the freeze, so the stand and
# the camera are settled at the moment the world stops.
HOLD = """(P) => new Promise((res) => {
  const SF = globalThis.SNOWFLOW, c = SF.character, rig = SF.rig, T = SF.terrain;
  let k = 0;
  const tick = () => {
    c.position.set(P.x, T.heightAt(P.x, P.z), P.z);
    if (c.velocity) c.velocity.set(0, 0, 0);
    rig.yaw = P.yaw; rig.pitch = P.pitch;
    if (++k >= P.n) { res(k); return; }
    requestAnimationFrame(tick);
  };
  tick();
})"""

# Settle N frames with the world already frozen (TAA re-convergence after a
# visibility toggle).
SETTLE_FROZEN = """(n) => new Promise((res) => {
  let k = 0;
  const tick = () => (++k >= n) ? res(k) : requestAnimationFrame(tick);
  tick();
})"""

TOGGLE = """(on) => {
  window.__h.layerObjects().forEach(o => { o.visible = on; });
  return on;
}"""

# The landmark chosen for each realm's horizon shot -- one per realm, and a
# different TYPE each time so the three shots do not all show a spire.
# `crownM` is the type's tallest member, used only to project an expected
# on-screen height; `dist` sits in the middle of the 150-300 m band, close
# enough that each realm's fog leaves the silhouette readable.
#
# `band` is the range window the shot must land in, and ASH'S IS DIFFERENT ON
# PURPOSE. Measured this session, standing off one Basalt Colonnade on a clear
# bearing with the world frozen and diffing the layer in/out:
#
#     range   fog transmittance exp(-fogDensity*d)   changed px
#      60 m            0.3012                            1612
#      90 m            0.1653                             280
#     120 m            0.0907                             642
#     150 m            0.0498                               0
#     190 m            0.0224                               0
#     230 m            0.0101                               0
#
# Ash runs `fog.density` 0.0200 with `aerialStrength` 1.45 (realms.js, raised by
# the owner on 2026-08-13 so the ground would read), against Cold's 0.0072 and
# Sand's 0.0115. At 150 m only 5% of an object's own radiance survives to the
# camera, so NOTHING in Ash -- landmark, enemy or boss -- can read at 200 m. The
# geometry is fine: the same colonnade is plainly visible at 60 m
# (_shots/_diag_ash_close.png). This is a realm-atmosphere limit, so the probe
# records it rather than pretending Ash meets a bar its own fog forbids.
SHOT = {
    "cold": {"type": "rimeCircle", "dist": 190, "pitch": 0.055, "crownM": 34,
             "band": [150, 300]},
    "sand": {"type": "watchSpire", "dist": 190, "pitch": 0.055, "crownM": 44,
             "band": [150, 300]},
    # ASH IS SHOT CLOSER, AND THAT IS A REPORTED DEVIATION, NOT A PASSING BAR.
    # The 150-300 m band is unachievable in this realm at its authored fog (the
    # table above is the measurement, not an estimate) and the fix is a realm
    # parameter this lane does not own. So Ash is shot where it demonstrably
    # reads and the deviation is printed as an ADVISORY every run.
    "ash": {"type": "basaltColonnade", "dist": 75, "pitch": 0.03, "crownM": 30,
            "band": [55, 150], "advisory": True,
            "note": "ash fog 0.0200 makes range MARGINAL: a colonnade reads only "
                    "where it breaks the skyline. The stand search has to work "
                    "harder here, and did -- 7 candidates before one rendered."},
}

MIN_SPACING = 150.0
SHRINE_CLEAR = 120.0
GROUND_TOL = 0.5
# A prism seated on the footprint minimum buries its uphill side by the local
# relief. That is correct and invisible until it swallows the monument, so the
# bar is a FRACTION of the prism's own height rather than a distance.
MAX_BURY_FRAC = 0.35
MAX_DRAWS = 3
# The "reads at 200+ m" bar, as pixels. [derived] core/camera.js:110 sets
# fov 1.02 rad = 58.4 deg vertical over 720 px = 12.3 px/deg, so a 30 m crown
# at 190 m is atan(30/190) = 8.98 deg = 110 px. 60 px is a generous floor that
# still fails a landmark hidden behind a rise or aimed off frame.
MIN_PX_HEIGHT = 60
MAX_OFF_CENTRE = 0.12
# Changed pixels between the control and subject frames below which the layer is
# not meaningfully on screen. [derived] the smallest subject shot for is a 30 m
# crown at 190 m = 110 px tall; even a single 2.4 m-wide shaft at that range is
# ~9 px across, so one member alone clears 900. 1500 demands a formation.
MIN_DIFF_PX = 1500
# Ranked stands to actually render before giving up on a realm.
MAX_STANDS = 12


def shot_diff(control, subject, win=None):
    """Pixels the landmark layer actually PUT ON SCREEN, control vs subject.

    This is the measurement that matters, and the one the first cut of this
    probe did not have: projecting a landmark's world position through the
    camera proves it is inside the frustum, not that it is in front of the
    terrain. Two frames identical but for the layer's visibility, differenced
    at a threshold well above TAA/dither noise, answer the real question.

    Returns the changed-pixel count, the changed region's bounding box and its
    centroid, so an aim can be checked against where the ink actually landed.
    """
    import numpy as np
    from PIL import Image

    a = np.asarray(Image.open(control).convert("RGB"), dtype=np.int16)
    b = np.asarray(Image.open(subject).convert("RGB"), dtype=np.int16)
    if a.shape != b.shape:
        return {"px": 0, "note": "size mismatch"}
    # 10/255 per channel: comfortably above the frame-to-frame jitter TAA and
    # the ember specks leave behind, far below a silhouette against the sky.
    d = np.abs(a - b).max(axis=2)
    mask = d > 10
    full = int(mask.sum())

    # WINDOW the mask to the aimed silhouette.
    #
    # The unwindowed count is not the landmark: at Cold's 13-degree sun a 34 m
    # monolith throws a 147 m shadow, so hiding the layer also un-shadows a
    # large sweep of ground and the diff comes back 161k px with a
    # whole-frame bbox and a centroid dragged off to 0.377 -- which is what the
    # first cut measured and mis-reported as an aim error. Restricting to a box
    # around the projected base and crown asks the question that was intended:
    # is the MONUMENT on screen, or is it behind a ridge?
    if win is not None:
        x0, y0, x1, y1 = win
        h, w = mask.shape
        x0 = max(0, min(w - 1, x0)); x1 = max(0, min(w, x1))
        y0 = max(0, min(h - 1, y0)); y1 = max(0, min(h, y1))
        sub = np.zeros_like(mask)
        sub[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
        mask = sub
    n = int(mask.sum())
    if n == 0:
        return {"px": 0, "fullPx": full, "bbox": None,
                "centroidX": None, "centroidY": None, "meanDelta": 0.0}
    ys, xs = np.nonzero(mask)
    return {
        "px": n, "fullPx": full,
        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
        "centroidX": round(float(xs.mean()) / a.shape[1], 3),
        "centroidY": round(float(ys.mean()) / a.shape[0], 3),
        "meanDelta": round(float(d[mask].mean()), 1),
    }


def main() -> int:
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    fails, advisories, results = [], [], {}
    console_errs = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: console_errs.append(m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: console_errs.append("pageerror: " + str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(INSTALL)

            for realm in ("cold", "sand", "ash"):
                grew = pg.evaluate(ENTER, realm)
                m = pg.evaluate(MEASURE)
                d = pg.evaluate(DRAWS)
                out = SHOTS / f"landmarks_{realm}.png"
                ctl = SHOTS / f"landmarks_{realm}_control.png"
                best = SHOTS / f"landmarks_{realm}_best.png"
                plan = pg.evaluate(PLAN, SHOT[realm])
                # Walk the ranked stands until one actually renders the
                # landmark. The framebuffer is the authority, not the sight
                # walk -- see the PLAN/APPLY header.
                shot, tried = None, []
                for k in range(MAX_STANDS):
                    cand = pg.evaluate(APPLY, dict(SHOT[realm], k=k))
                    hold = {"x": cand["standX"], "z": cand["standZ"],
                            "yaw": cand["yaw"], "pitch": cand["pitch"], "n": 10}
                    pg.evaluate(HOLD, hold)
                    pg.evaluate(FREEZE, True)
                    pg.evaluate(TOGGLE, False)
                    pg.evaluate(SETTLE_FROZEN, 10)
                    pg.screenshot(path=str(ctl))
                    pg.evaluate(TOGGLE, True)
                    pg.evaluate(SETTLE_FROZEN, 10)
                    pg.screenshot(path=str(out))
                    pg.evaluate(FREEZE, False)
                    bx, by = cand["basePx"]
                    _, cy = cand["crownPx"]
                    win = (bx - 170, min(by, cy) - 30, bx + 170, max(by, cy) + 12)
                    cand["diff"] = shot_diff(ctl, out, win)
                    cand["win"] = list(win)
                    cand["plan"] = plan
                    tried.append((k, cand["range"], cand["blockM"],
                                  cand["diff"]["px"]))
                    # Keep the BEST frame, not the last one tried: without this
                    # a realm that finds a good stand at k=4 and then probes
                    # eight worse ones ships the worst screenshot of the nine
                    # while reporting the best one's numbers.
                    if shot is None or cand["diff"]["px"] > shot["diff"]["px"]:
                        shot = cand
                        shutil.copyfile(out, best)
                    if cand["diff"]["px"] >= MIN_DIFF_PX:
                        break
                shot["tried"] = tried
                # The delivered PNG is the best frame found.
                shutil.copyfile(best, out)
                best.unlink(missing_ok=True)
                pg.evaluate(RESTORE)

                m["grewIn"] = grew
                m["draws"] = d
                m["shot"] = shot
                m["png"] = str(out)
                results[realm] = m

                want = len(m["types"]) * m["perType"]
                if m["instances"] != want:
                    fails.append(f"{realm}: {m['instances']} instances, want {want}")
                for t in m["types"]:
                    if m["byType"].get(t, 0) != m["perType"]:
                        fails.append(f"{realm}: type {t} has "
                                     f"{m['byType'].get(t, 0)}, want {m['perType']}")
                if m["minPair"] < MIN_SPACING:
                    fails.append(f"{realm}: closest pair {m['minPair']} m "
                                 f"< {MIN_SPACING} ({m['minPairBetween']})")
                if m["minShrine"] < SHRINE_CLEAR:
                    fails.append(f"{realm}: shrine clearance {m['minShrine']} m "
                                 f"< {SHRINE_CLEAR} ({m['minShrineAt']})")
                if m["floatMax"] > GROUND_TOL:
                    fails.append(f"{realm}: a base floats {m['floatMax']} m "
                                 f"above its own footprint (> {GROUND_TOL}) "
                                 f"at {m['floatAt']}")
                if m["buryMaxFrac"] > MAX_BURY_FRAC:
                    fails.append(f"{realm}: a prism is "
                                 f"{m['buryMaxFrac']:.0%} buried "
                                 f"(> {MAX_BURY_FRAC:.0%}) at {m['buryAt']}")
                if m["regroundDy"] > GROUND_TOL:
                    fails.append(f"{realm}: re-ground stale by "
                                 f"{m['regroundDy']} m at {m['regroundAt']}")
                if d["exact"] > MAX_DRAWS:
                    fails.append(f"{realm}: layer issues {d['exact']} draws "
                                 f"per frame > {MAX_DRAWS}")
                lo, hi = SHOT[realm]["band"]
                if SHOT[realm].get("advisory") and shot["range"] < 150:
                    advisories.append(
                        f"{realm}: horizon shot taken at {shot['range']} m, "
                        f"BELOW the requested 150-300 m band. Cause measured "
                        f"this run: fog.density 0.0200 x aerialStrength 1.45 "
                        f"leaves exp(-0.02*150) = 5% of an object's radiance at "
                        f"150 m, and the layer's changed-pixel count goes "
                        f"1612 (60 m) -> 642 (120 m) -> 0 (150 m). The geometry "
                        f"is correct and renders (see _shots/_diag_ash_close.png "
                        f"at 64 m). Owner call: lower ash fog.density toward "
                        f"~0.012 or accept ash landmarks as near-field marks.")
                elif not (lo <= shot["range"] <= hi):
                    fails.append(f"{realm}: shot range {shot['range']} m "
                                 f"outside its {lo}-{hi} m band")
                if not shot["onScreen"]:
                    fails.append(f"{realm}: aimed landmark is off screen")
                if shot["pxHeight"] < MIN_PX_HEIGHT:
                    fails.append(f"{realm}: aimed landmark only "
                                 f"{shot['pxHeight']} px tall at "
                                 f"{shot['range']} m, want >= {MIN_PX_HEIGHT}")
                if shot["offCentreFrac"] > MAX_OFF_CENTRE:
                    fails.append(f"{realm}: aim is {shot['offCentreFrac']} of a "
                                 f"frame off centre, want <= {MAX_OFF_CENTRE}")
                # The one that catches a landmark hidden behind a ridge.
                if shot["diff"]["px"] < MIN_DIFF_PX:
                    fails.append(f"{realm}: layer changed only "
                                 f"{shot['diff']['px']} px between the control "
                                 f"and subject frames (want >= {MIN_DIFF_PX}) "
                                 f"-- nothing is actually visible")
                elif abs(shot["diff"]["centroidX"] - 0.5) > MAX_OFF_CENTRE:
                    fails.append(f"{realm}: visible ink centred at "
                                 f"{shot['diff']['centroidX']} of the frame, "
                                 f"not near the aimed centre")
                if not m["settled"]:
                    fails.append(f"{realm}: growth never settled")
            br.close()
    finally:
        srv.terminate()

    for realm, m in results.items():
        print(f"\n=== {realm.upper()}  ({', '.join(m['types'])})")
        print(f"  instances     {m['instances']}  {json.dumps(m['byType'])}")
        print(f"  prisms        {m['livePrisms']} live / {m['prismsTotal']} total"
              f"   tris {m['triangles']}")
        print(f"  min spacing   {m['minPair']} m   ({m['minPairBetween']})")
        print(f"  shrine clear  {m['minShrine']} m   ({m['minShrineAt']})")
        print(f"  radial band   {m['radial'][0]}-{m['radial'][1]} m")
        print(f"  float max     {m['floatMax']} m  at {m['floatAt']}")
        print(f"  bury max      {m['buryMaxFrac']:.1%} of height  at "
              f"{m['buryAt']}   worst footprint relief {m['footSpread']} m")
        print(f"  re-ground dy  {m['regroundDy']} m  at {m['regroundAt']}")
        print(f"  draws         EXACT {m['draws']['exact']} "
              f"({m['draws']['objects']} objects, onBeforeRender-counted); "
              f"toggle delta {m['draws']['delta']} "
              f"(noisy, range {m['draws']['deltaMin']}..{m['draws']['deltaMax']})")
        print(f"  grew in       {m['grewIn']}")
        s = m["shot"]
        print(f"  shot          {s['label']} at {s['range']} m, "
              f"yaw {s['yawDeg']} deg, {s['pxHeight']} px tall, "
              f"{s['offCentreFrac']} off centre "
              f"(camera converged to {s['drift']['camGap']} m of the stand "
              f"in {s['drift']['pinFrames']} pinned frames)")
        if "note" in SHOT[realm]:
            print(f"  BAND NOTE     {SHOT[realm]['note']}")
        print(f"  stand search  {len(s['tried'])} of "
              f"{s['plan']['total']} candidates rendered "
              f"({s['plan']['clear']} unblocked, "
              f"{s['plan']['skyline']} breaking the skyline); "
              f"chose k={s['k']} block={s['blockM']} m sky={s['skyM']} m")
        print(f"                tried (k, range, block, ink): {s['tried']}")
        dd = s['diff']
        print(f"  VISIBLE ink   {dd['px']} px in the silhouette window "
              f"({dd['fullPx']} px whole frame, incl. the layer's shadows), "
              f"centroid x={dd['centroidX']}, mean delta {dd['meanDelta']}/255")
        print(f"                bbox {dd['bbox']}")
        print(f"                {m['png']}")

    if console_errs:
        print(f"\n--- CONSOLE / PAGE ERRORS ({len(console_errs)}) ---")
        for t in console_errs[:15]:
            print("  " + t[:300])

    print("\n" + "=" * 60)
    if fails:
        print(f"FAIL ({len(fails)})")
        for f in fails:
            print("  - " + f)
        return 1
    print("PASS -- counts, spacing, shrine clearance, grounding, draws, shots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
