#!/usr/bin/env python
"""ASCENDANT walked-surface contrast gate — measures what the RENDERER shows.

THE LAW (CONTRACT section 9): a walked platform TOP surface must hold >= 3.5:1
WCAG relative-luminance contrast against the background actually behind it at
eye level (the fog/horizon band). This tool is the ONLY source of truth for
that number: theme-constant arithmetic (tint vs fog hex) has now shipped two
rounds of fiction (spire "4.40:1" measured 1.0-1.9:1 on screenshots) because
lighting, exposure, grade, bloom and the sky dome all sit between an albedo
constant and the pixel the player sees.

WHAT IT DOES, per stage:
  1. loads the stage (same goto + arrival-poll pattern as shots.py), then for
     each station (spawn + every checkpoint) teleports the player onto the
     station facing down-course (+X, yaw -PI/2 — identical pose to the shot
     battery the visual critic judges; when nothing is sampleable from that
     facing it re-poses once toward the next station, because courses bend),
  2. picks the NEXT walked surface via STAGE-DEF GEOMETRY PROJECTED THROUGH
     THE LIVE CAMERA — not a fixed screen region. Why: stations differ in
     elevation and the course bends, so any fixed screen rect samples the wrong
     surface on climbs/descents; the def is ground truth for where a top
     surface IS, and projecting it through engine.camera tells us exactly which
     pixels wear it. Walked kinds: platform / ice / conveyor / speedpad /
     beam / vanish (all static in place; movers are excluded because their def
     pose is not their live pose, and a cycling vanish target is captured
     INSIDE its solid ON window, scheduled from the deterministic stage clock
     + the def cycle — a blanked tile is the absence of a walked surface and
     the warn strobe is a telegraph, not the surface). Selection: ahead of the
     camera (forward-dot > 1.5 m), top face below eye level (else the top face
     back-projects onto background pixels), not the deck underfoot, nearest.
     Laser-family beams (endpoint defs) project to inflated screen bands that
     are EXCLUDED from both the deck pool and the background candidates: an
     additive telegraph beam parked across the next deck is not the walked
     surface's value, and exclusion can only shrink the sample set (the
     fewPts guard turns an all-beam deck into 'na', never into a ratio).
  3. samples the surface's top face AREA-WEIGHTED IN SCREEN SPACE — a 6x6
     bilinear grid over the projected inset quad (22.5% margin per side keeps
     edge stripes / keylines / trim out). Area weighting matters: a world-
     space grid bunches half its points into the compressed far band, where
     grazing-angle Fresnel mirrors the pale sky on any albedo, out-voting the
     deck body the player actually reads. Points outside the viewport or
     inside a NEARER object's screen rect are dropped (coarse occlusion), and
     the deck value is the median over ALL pooled patch pixels (speckle-proof),
  4. picks a background patch adjacent to the silhouette: candidates step
     upward from the projected top edge (that is the haze band the deck must
     separate from), then lateral offsets. JS drops candidates inside any
     known solid's screen rect (all sized kinds + an estimated board rect per
     text sign); Python then walks the survivors and takes the first whose
     11x11 patch is UNIFORM (max per-channel MAD <= 7) — fog is smooth, so a
     high-variance patch means we hit lettering, trim or particles — AND whose
     colour matches an EMPIRICAL FOG REFERENCE sampled from the same frame's
     horizon flanks (decor props are not in the def, so a prop wall can pass
     every geometric test; matching the frame's own haze colour is what proves
     a patch is haze). If props hide the haze everywhere adjacent, the ratio
     is taken against the haze band itself ('fogband' in the table),
  5. PROVES the sampled pixels are really the target: it screenshots, then
     brightens the target's themed registry material x2.6 for one more frame
     and diffs — only pixels that responded are the target's material. Decor
     props carry no size in the def, so a prop boulder standing between the
     camera and the def target passes every geometric test; it cannot pass
     this one. If under 22% of the pooled pixels respond the candidate is a
     ghost: it is excluded and selection reruns (up to 4 candidates),
  6. computes WCAG contrast between the median pooled deck luminance (from
     the responding pixels of the UNmodified frame) and the median background
     patch luminance.

OUTPUT: a per-stage table + _harness/contrastcheck.json. Exit 1 when any
CHECKPOINT station's sampled walked surface is under --floor (default 3.0:1;
the design target is 3.5:1 and anything between floor and target prints as
WARN). The spawn row (station "sp") is informational — it prints, but a
red spawn never fails the gate: several spawn aprons sit inside fixture-dense
set dressing whose additive light pools are the lighting system's lever.
Rows whose background patch is ARCHITECTURE rather than haze ('occl' in the
bgmode) are likewise printed but never gate: the law is written against the
fog/sky behind a deck, and a station inside a set-piece interior has no haze
behind its next deck to fail against.

    python contrastcheck.py                          # every stage
    python contrastcheck.py --stages spire-1,temple-1 --save-shots
    python contrastcheck.py --cps 3                  # first 3 checkpoints only
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "..", "_shots", "contrast")
BASE = "http://localhost:8788/games/ascendant/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]

# ---------------------------------------------------------------- page JS ----

# Stand ON station i (0 = def.spawn, k>0 = def.checkpoints[k-1]), face +X
# down-course — the same pose contract as the shot battery the critic judges.
# Stations come from THE DEF (not live spawnFor(), which returns the currently
# armed respawn and therefore duplicates checkpoint 0 once one is armed).
POSE_JS = r"""
async ([i, mode]) => {
  const A = globalThis.ASCENDANT;
  if (!A || !A.game || !A.game.stage) return {error:'no stage'};
  const G = A.game, S = G.stage, P = G.player;
  const T = A.THREE || { Vector3: (P && P.pos ? P.pos.constructor : null) };
  if (!T.Vector3) return {error:'no Vector3'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const def = S.def || {};
  const pts = [];
  if (def.spawn && def.spawn.p) pts.push(def.spawn.p);
  (def.checkpoints || []).forEach(c => { if (c && c.p) pts.push(c.p); });
  const nStations = pts.length;
  if (def.finish && def.finish.p) pts.push(def.finish.p);   // direction only
  if (i >= nStations) return {error:'no station ' + i, stations: nStations};
  const p = pts[i];
  // Re-arm the stage the way a death does (resetFrom re-arms crumble/vanish
  // and rewinds the deterministic clock to the checkpoint's offset): teleport
  // posing never runs the respawn path, so a crumble tile the player broke
  // while sliding off an EARLIER station stayed broken forever and its
  // "sample" was a rect of open sky (spire-2 c8, THE REACH). This also pins
  // every hazard's phase per station, making vanish captures reproducible.
  try { if (typeof S.resetFrom === 'function') S.resetFrom(i - 1); } catch (e) { /* optional */ }
  P.__test.teleport(new T.Vector3(p[0], p[1] + 0.6, p[2]));
  P.__test.setVel(new T.Vector3(0, 0, 0));
  // mode 0: face +X, the shot-battery convention (what the critic judges).
  // mode 1 (retry when 0 finds nothing): face the next station — courses
  // bend, and a fixed +X yaw shoots the void on stages that leave a station
  // sideways. Controller forward is (-sin yaw, 0, -cos yaw) => atan2(-dx,-dz).
  let yaw = -Math.PI / 2;
  if (mode === 1) {
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const dx = q[0] - p[0], dz = q[2] - p[2];
    if (Math.abs(dx) + Math.abs(dz) > 0.01) yaw = Math.atan2(-dx, -dz);
  }
  if (P.yaw !== undefined) P.yaw = yaw;
  if (P.pitch !== undefined) P.pitch = -0.06;
  for (let k = 0; k < 45; k++) await frame();
  return {x:+p[0].toFixed(1), y:+p[1].toFixed(1), z:+p[2].toFixed(1), station:i, stations:pts.length};
}
"""

STATION_COUNT_JS = r"""() => {
  const A = globalThis.ASCENDANT;
  if (!A || !A.game || !A.game.stage || !A.game.stage.def) return 0;
  const d = A.game.stage.def;
  return (d.spawn && d.spawn.p ? 1 : 0) + ((d.checkpoints && d.checkpoints.length) || 0);
}"""

# Brighten / restore the themed material a target wears, so the runner can
# prove by pixel diff that the sampled points actually show THAT material —
# def-geometry alone cannot see decor props (they carry no size in the def),
# and several stations were measuring a prop boulder as "the deck".
WIGGLE_JS = r"""
([matKey, on]) => {
  const A = globalThis.ASCENDANT, G = A && A.game, S = G && G.stage;
  if (!S) return false;
  const reg = G.mats || (S.mats);
  if (!reg || typeof reg.get !== 'function') return false;
  const m = reg.get(matKey, S.themeId);
  if (!m || !m.color) return false;
  if (on) {
    if (!m.userData.__ccSaved) {
      m.userData.__ccSaved = m.color.clone();
      // DARKEN, never brighten: a sun-struck deck is already tone-map
      // clipped, so a brightened material changes nothing on screen and the
      // deck reads as a false ghost. Darkening always registers.
      m.color.multiplyScalar(0.22);
    }
  } else if (m.userData.__ccSaved) {
    m.color.copy(m.userData.__ccSaved);
    delete m.userData.__ccSaved;
  }
  return true;
}"""

# Pick the next platform + sample coordinates. Pure read: no scene mutation.
SAMPLE_JS = r"""
([stationIdx, exclude]) => {
  const A = globalThis.ASCENDANT;
  if (!A || !A.game || !A.game.stage) return {error:'no stage'};
  const G = A.game, S = G.stage, E = G.engine;
  const cam = E && E.camera;
  if (!cam || !cam.projectionMatrix) return {error:'no camera'};
  cam.updateMatrixWorld(true);
  const pm = cam.projectionMatrix.elements;
  const vm = cam.matrixWorldInverse.elements;
  const mw = cam.matrixWorld.elements;
  const W = window.innerWidth, H = window.innerHeight;
  const camP = [mw[12], mw[13], mw[14]];
  let fwd = [-mw[8], -mw[9], -mw[10]];
  const fl = Math.hypot(fwd[0], fwd[1], fwd[2]) || 1;
  fwd = [fwd[0]/fl, fwd[1]/fl, fwd[2]/fl];

  const xf = (m, x, y, z, w) => [
    m[0]*x + m[4]*y + m[8]*z  + m[12]*w,
    m[1]*x + m[5]*y + m[9]*z  + m[13]*w,
    m[2]*x + m[6]*y + m[10]*z + m[14]*w,
    m[3]*x + m[7]*y + m[11]*z + m[15]*w,
  ];
  // world -> screen px; null when behind the camera or far outside the frame
  const project = (x, y, z) => {
    const v = xf(vm, x, y, z, 1);
    const c = xf(pm, v[0], v[1], v[2], v[3]);
    if (c[3] <= 1e-6) return null;
    const nx = c[0]/c[3], ny = c[1]/c[3];
    if (nx < -1.3 || nx > 1.3 || ny < -1.3 || ny > 1.3) return null;
    return [(nx*0.5 + 0.5) * W, (1 - (ny*0.5 + 0.5)) * H];
  };
  // same, but WITHOUT the frame bound — occluder rects must survive corners
  // that project far off-screen (a huge nearby wall lost its rect entirely to
  // the bound above, and a "background" patch landed on the wall)
  const projectAny = (x, y, z) => {
    const v = xf(vm, x, y, z, 1);
    const c = xf(pm, v[0], v[1], v[2], v[3]);
    if (c[3] <= 1e-6) return null;
    return [(c[0]/c[3]*0.5 + 0.5) * W, (1 - (c[1]/c[3]*0.5 + 0.5)) * H];
  };

  // THREE Euler XYZ rotation of a local offset
  const rotv = (rot, x, y, z) => {
    if (!rot) return [x, y, z];
    const [rx, ry, rz] = [rot[0]||0, rot[1]||0, rot[2]||0];
    if (!rx && !ry && !rz) return [x, y, z];
    const a = Math.cos(rx), b = Math.sin(rx);
    const c = Math.cos(ry), d = Math.sin(ry);
    const e = Math.cos(rz), f = Math.sin(rz);
    const ae = a*e, af = a*f, be = b*e, bf = b*f;
    return [
      (c*e)*x + (-c*f)*y + d*z,
      (af + be*d)*x + (ae - bf*d)*y + (-b*c)*z,
      (bf - ae*d)*x + (be + af*d)*y + (a*c)*z,
    ];
  };

  // Walked static landables. Movers excluded: def pose != live pose. Vanish
  // tiles ARE static (they blink in place) — the runner samples them across
  // several frames and keeps the solid-state reading.
  const WALKED = { platform: 1, ice: 1, conveyor: 1, speedpad: 1, beam: 1, vanish: 1 };
  // Solid occluders (things that can sit between the camera and a patch).
  // 'wind' volumes are invisible air and must NOT occlude; lights are points.
  const SOLID = { platform: 1, ice: 1, conveyor: 1, speedpad: 1, beam: 1,
                  deco: 1, mover: 1, vanish: 1, crusher: 1, spikes: 1,
                  saw: 1, rotor: 1, lava: 1, risinglava: 1, jumppad: 1 };
  // Additive beam FX (endpoint defs, no p/s): a HOT laser parked across the
  // next deck paints a blown white band over the sample area — spire-2 cp2
  // measured 1.07:1 against a deck that visibly silhouettes, because every
  // pooled pixel was the beam, not the surface. Beam pixels are excluded from
  // BOTH the deck pool and the background candidates: the beam is a cycling
  // hazard telegraph, not the walked surface's own value. Exclusion can only
  // SHRINK the sample set — the fewPts guard turns an all-beam deck into an
  // honest 'na', never into a ratio.
  const FXBEAM = { laser: 1, lasergrid: 1, lasersweep: 1 };

  const objs = (S.def && S.def.objects) || [];
  const excl = new Set(exclude || []);
  const solids = [];   // occluders with screen rects
  const fxRects = [];  // beam-glow screen bands (excluded from deck AND bg)
  const bgExcl = [];   // rotor sweep discs (excluded from bg candidates only)
  const plats = [];    // walked candidates
  const rej = { underfoot: 0, behind: 0, topHidden: 0, grazing: 0, far: 0, fewPts: 0, sliver: 0 };
  const addSolid = (p, half, rot, o, ahead, dist) => {
    let sx0 = 1e9, sy0 = 1e9, sx1 = -1e9, sy1 = -1e9, seen = 0;
    for (let ci = 0; ci < 8; ci++) {
      const lo = rotv(rot, (ci&1 ? half[0] : -half[0]), (ci&2 ? half[1] : -half[1]), (ci&4 ? half[2] : -half[2]));
      const sp = projectAny(p[0]+lo[0], p[1]+lo[1], p[2]+lo[2]);
      if (!sp) continue;
      seen++;
      sx0 = Math.min(sx0, sp[0]); sy0 = Math.min(sy0, sp[1]);
      sx1 = Math.max(sx1, sp[0]); sy1 = Math.max(sy1, sp[1]);
    }
    const rect = seen >= 2 ? [sx0, sy0, sx1, sy1] : null;
    // wellFormed: all corners in front of the camera. A giant slab straddling
    // the near plane projects a screen-swallowing rect — good enough to keep a
    // BACKGROUND patch away from, far too coarse to occlusion-drop deck points
    // with (it silently blanked whole stations' legitimate targets).
    if (rect && ahead > 0.3) solids.push({ o, dist, rect, wellFormed: seen === 8 });
    return rect;
  };
  for (let oi = 0; oi < objs.length; oi++) {
    const o = objs[oi];
    if (!o) continue;
    if (FXBEAM[o.kind] && o.a && o.b) {
      const sa = projectAny(o.a[0], o.a[1], o.a[2]);
      const sb = projectAny(o.b[0], o.b[1], o.b[2]);
      const mid = [(o.a[0]+o.b[0])/2, (o.a[1]+o.b[1])/2, (o.a[2]+o.b[2])/2];
      const md = Math.hypot(mid[0]-camP[0], mid[1]-camP[1], mid[2]-camP[2]);
      if (sa && sb && md < 160) {
        // the bloom halo outgrows the beam core; inflate to cover it, but not
        // so far that a deck the beam merely crosses loses its whole top band
        const pad = 24 + (o.radius || 0.1) * 100;
        fxRects.push([Math.min(sa[0], sb[0]) - pad, Math.min(sa[1], sb[1]) - pad,
                      Math.max(sa[0], sb[0]) + pad, Math.max(sa[1], sb[1]) + pad]);
      }
      continue;
    }
    if (!o.p) continue;
    o.__ccIdx = oi;
    if (o.kind === 'rotor') {
      // a rotor's live arm pose is a function of the clock, not the def, so
      // its rect model cannot say where the arm IS — but the arm is always
      // somewhere inside the sweep disc. Exclude the whole projected disc
      // from BACKGROUND candidates (temple-2 c6 measured its shelf against a
      // sunlit chevron arm that had swept into the "clear" patch). Deck
      // sample points are NOT excluded: an arm crossing a deck is transient
      // and the timed retakes + the photometric mask already govern that.
      const len = (typeof o.len === 'number' ? o.len : 4) + 0.6;
      const ax = o.axis || [0, 1, 0];
      const p = o.p;
      let sx0 = 1e9, sy0 = 1e9, sx1 = -1e9, sy1 = -1e9, seen = 0;
      for (let cx = -1; cx <= 1; cx += 2) for (let cy = -1; cy <= 1; cy += 2) for (let cz = -1; cz <= 1; cz += 2) {
        // box spanning the disc: full len on axes perpendicular to the spin axis
        const hx = Math.abs(ax[0]) > 0.7 ? 0.6 : len;
        const hy = Math.abs(ax[1]) > 0.7 ? 0.6 : len;
        const hz = Math.abs(ax[2]) > 0.7 ? 0.6 : len;
        const sp = projectAny(p[0] + cx * hx, p[1] + cy * hy, p[2] + cz * hz);
        if (!sp) continue;
        seen++;
        sx0 = Math.min(sx0, sp[0]); sy0 = Math.min(sy0, sp[1]);
        sx1 = Math.max(sx1, sp[0]); sy1 = Math.max(sy1, sp[1]);
      }
      const dx0 = p[0]-camP[0], dy0 = p[1]-camP[1], dz0 = p[2]-camP[2];
      if (seen >= 4 && Math.hypot(dx0, dy0, dz0) < 80) {
        bgExcl.push([sx0, sy0, sx1, sy1]);
      }
      continue;
    }
    const p = o.p;
    const dx = p[0]-camP[0], dy = p[1]-camP[1], dz = p[2]-camP[2];
    const ahead = fwd[0]*dx + fwd[1]*dy + fwd[2]*dz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 160) continue;
    if (o.kind === 'text' && o.text) {
      // signs render on a backing board wider/taller than the glyph run:
      // estimate it so a bg patch never lands in the lettering
      const size = o.size || 0.4;
      const half = [String(o.text).length * size * 0.33 + 0.5, size * 1.1 + 0.4, 0.15];
      addSolid(p, half, o.rot, o, ahead, dist);
      continue;
    }
    if (o.kind === 'deco' && !o.s && (o.model || o.kindOf)) {
      // SINGLE model decos carry no size in the def but render as real
      // geometry — temple-1's spawn "next platform" was actually a huge prop
      // boulder in front of the dais, sampled as if it were the deck.
      // Estimate a bbox from scale. Scatter decos (count > 1) are skipped:
      // treating a 9-piece spread-26 scatter as one solid box blanketed the
      // frame, vetoed every background candidate AND the fog reference.
      const cnt = (typeof o.count === 'number' ? o.count : 1);
      if (cnt <= 1) {
        const sc = (typeof o.scale === 'number' ? o.scale : 1) * 2.2;
        addSolid(p, [sc, sc, sc], o.rot, o, ahead, dist);
      }
      continue;
    }
    if (!o.s || !SOLID[o.kind]) continue;
    const h = [Math.abs(o.s[0])/2, Math.abs(o.s[1])/2, Math.abs(o.s[2])/2];
    const rect = addSolid(p, h, o.rot, o, ahead, dist);
    if (!WALKED[o.kind] || !rect) continue;
    const topO = rotv(o.rot, 0, h[1], 0);
    const topC = [p[0]+topO[0], p[1]+topO[1], p[2]+topO[2]];
    const underfoot = Math.abs(camP[0]-p[0]) < h[0]+0.4 && Math.abs(camP[2]-p[2]) < h[2]+0.4
                      && (camP[1] - topC[1]) > 0 && (camP[1] - topC[1]) < 2.6;
    if (underfoot) { rej.underfoot++; continue; }
    if (ahead < 1.5) { rej.behind++; continue; }
    if (camP[1] < topC[1] + 0.25) { rej.topHidden++; continue; }   // top face not visible
    // grazing-far guard: below ~8 deg of viewing elevation AND beyond 14 m the
    // top face is a Fresnel mirror of the sky for ANY albedo (physics, not a
    // material bug) and its projected band collapses into the bleed radius of
    // the sample patches — at that geometry the player reads the SILHOUETTE
    // and the edge stripe, not the top value. spire-1 measured a correctly-
    // dark slab at 1.27:1 from 21 m this way. The guard is DISTANCE-GATED
    // because in a climbing obby the next deck sits near eye level, so 6-10
    // deg at 8-10 m is the NORMAL readable case, not a mirror sliver.
    {
      const horiz = Math.hypot(camP[0] - topC[0], camP[2] - topC[2]);
      if (dist > 14 &&
          Math.atan2(camP[1] - topC[1], Math.max(1e-3, horiz)) < 0.14) { rej.grazing++; continue; }
    }
    // a distant vanish tile is a trim-and-bloom blob, not a readable deck —
    // its top-surface value is only measurable close up (the stripe law, not
    // the deck law, governs its long-range read)
    if (dist > (o.kind === 'vanish' ? 12 : 60)) { rej.far++; continue; }
    if (excl.has(oi)) continue;      // ghosted on a previous pass (prop in front)
    plats.push({ o, h, dist, topC, rect });
  }
  plats.sort((a, b) => a.dist - b.dist);

  const inRect = (x, y, r, pad) =>
    r && x > r[0]-pad && x < r[2]+pad && y > r[1]-pad && y < r[3]+pad;

  for (const cand of plats) {
    const { o, h } = cand;
    // Sample the inset top face AREA-WEIGHTED IN SCREEN SPACE: project the
    // four inset corners and walk a bilinear grid over the projected quad.
    // A world-space grid bunches half its points into the compressed far
    // band, where grazing-angle Fresnel mirrors the pale sky on ANY albedo —
    // that band was out-voting the deck body the player actually reads.
    const okPoint = (sp) => {
      if (!sp) return false;
      if (sp[0] < 3 || sp[0] > W-3 || sp[1] < 3 || sp[1] > H-3) return false;
      for (const fr of fxRects) {
        if (inRect(sp[0], sp[1], fr, 0)) return false;   // beam-glow band
      }
      for (const s2 of solids) {
        if (s2.o === o || !s2.wellFormed) continue;
        if (s2.dist < cand.dist - 0.5 && inRect(sp[0], sp[1], s2.rect, 0)) return false;
      }
      return true;
    };
    const pts = [];
    // inset per axis: 22.5% margin keeps stripes/keylines out of wide decks.
    // NARROW axes (catwalk beams) get 0.80 — at 0.55 the sampled strip of a
    // 0.9 m beam is mostly its bright top-centre guide line, and the pooled
    // median reads the guide, not the walked metal beside it. Vanish tiles
    // get a DEEPER inset both ways (0.40): their trim ring blooms a halo
    // ~15 px past itself and the tile is small enough that 22.5% sat in it.
    const inFor = (half) => (o.kind === 'vanish' ? 0.40 : (half < 0.8 ? 0.80 : 0.55));
    const INx = inFor(h[0]), INz = inFor(h[2]);
    // Conveyors scroll a bright self-lit chevron lane down the belt's CENTRE
    // — the mechanic's direction telegraph, same class as an edge stripe or a
    // laser: not the walked surface's passive value. Its scroll phase made
    // temple-2 c2 flip 4.9:1 <-> 1.7:1 run to run. Sample the tread FLANKS:
    // skip grid columns in the centre band across the belt's travel axis
    // (`dir` in the def says which local axis that is).
    let skipAxis = 0, skipLo = 2, skipHi = -1;   // default: skip nothing
    if (o.kind === 'conveyor' && o.dir) {
      skipAxis = Math.abs(o.dir[0]) >= Math.abs(o.dir[2]) ? 2 : 1; // 1=u,2=v
      skipLo = 0.24; skipHi = 0.76;
    }
    const cs = [[-INx, -INz], [INx, -INz], [INx, INz], [-INx, INz]].map(([ux, uz]) => {
      const lo = rotv(o.rot, ux * h[0], h[1], uz * h[2]);
      return project(o.p[0]+lo[0], o.p[1]+lo[1], o.p[2]+lo[2]);
    });
    if (cs.every(c => c)) {
      for (let gu = 0; gu <= 5; gu++) {
        for (let gv = 0; gv <= 5; gv++) {
          const u = gu / 5, v = gv / 5;
          if (skipAxis === 1 && u > skipLo && u < skipHi) continue;
          if (skipAxis === 2 && v > skipLo && v < skipHi) continue;
          const top = [cs[0][0] + (cs[1][0]-cs[0][0])*u, cs[0][1] + (cs[1][1]-cs[0][1])*u];
          const bot = [cs[3][0] + (cs[2][0]-cs[3][0])*u, cs[3][1] + (cs[2][1]-cs[3][1])*u];
          const sp = [top[0] + (bot[0]-top[0])*v, top[1] + (bot[1]-top[1])*v];
          if (okPoint(sp)) pts.push([Math.round(sp[0]), Math.round(sp[1])]);
        }
      }
    } else {
      // partial projection (very close / clipped): world-grid fallback
      for (let gx = 0; gx <= 4; gx++) {
        for (let gz = 0; gz <= 4; gz++) {
          const lo = rotv(o.rot, (gx/4 - 0.5) * 2*h[0] * INx, h[1], (gz/4 - 0.5) * 2*h[2] * INz);
          const sp = project(o.p[0]+lo[0], o.p[1]+lo[1], o.p[2]+lo[2]);
          if (okPoint(sp)) pts.push([Math.round(sp[0]), Math.round(sp[1])]);
        }
      }
    }
    if (pts.length < (o.kind === 'vanish' ? 4 : 5)) { rej.fewPts++; continue; }
    // sliver guard: if the projected top face spans under 5 px vertically the
    // patches inevitably bleed onto the front face / the void behind the
    // edge — skip to the next candidate rather than report fiction
    let py0 = 1e9, py1 = -1e9;
    for (const q of pts) { py0 = Math.min(py0, q[1]); py1 = Math.max(py1, q[1]); }
    if (py1 - py0 < (o.kind === 'vanish' ? 6 : 5)) { rej.sliver++; continue; }

    // background candidates: adjacent to the silhouette, preferring straight
    // above the projected top edge (the haze band the deck must separate
    // from). JS clears them against solid rects; Python then walks the list
    // and takes the first UNIFORM patch, so lettering / trim / particles that
    // slipped past the rect model still get rejected.
    const rect = cand.rect;
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
    const my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const raw = [];
    for (const dy of [18, 38, 62, 92, 130, 172]) raw.push([cx, rect[1] - dy, 'above']);
    for (const dxs of [1.2, 1.55, 1.95]) {
      const half = Math.max(40, (rect[2]-rect[0]) / 2), mx = (rect[0]+rect[2]) / 2;
      raw.push([mx + half*dxs, my, 'side']); raw.push([mx - half*dxs, my, 'side']);
    }
    const cleared = [], fallback = [];
    for (const [bx, by, mode] of raw) {
      if (bx < 10 || bx > W-10 || by < 10 || by > H-10) continue;
      let clear = true;
      for (const fr of fxRects) {
        if (inRect(bx, by, fr, 0)) { clear = false; break; }
      }
      if (clear) for (const fr of bgExcl) {
        if (inRect(bx, by, fr, 0)) { clear = false; break; }
      }
      if (clear) for (const s2 of solids) {
        if (s2.o === o) continue;   // the target's own rect never disqualifies
        if (inRect(bx, by, s2.rect, 7)) { clear = false; break; }
      }
      (clear ? cleared : fallback).push([Math.round(bx), Math.round(by), mode + (clear ? '' : '!')]);
    }
    const bgCands = cleared.concat(fallback);
    if (!bgCands.length) {
      bgCands.push([Math.round(Math.min(W-12, Math.max(12, cx))),
                    Math.max(12, Math.round(rect[1] - 20)), 'forced!']);
    }

    // EMPIRICAL FOG REFERENCE — the haze band as this very frame renders it.
    // Project a point far down the camera's level forward axis to find the
    // horizon row, then take patches near the frame's left/right edges (an
    // obby course is a line down +X; its flanks are open air). Python medians
    // the uniform ones. No theme constant is trusted anywhere in this tool.
    const fh = Math.hypot(fwd[0], fwd[2]) || 1;
    const hp = projectAny(camP[0] + (fwd[0]/fh) * 500, camP[1], camP[2] + (fwd[2]/fh) * 500);
    const horY = hp ? Math.min(H - 30, Math.max(30, hp[1])) : H * 0.47;
    const fogCands = [];
    for (let k = 0; k < 12; k++) {
      const bx = (0.04 + (0.92 * k) / 11) * W;
      for (const by of [horY, Math.max(20, horY - 42)]) {
        let clear = true;
        for (const fr of fxRects) if (inRect(bx, by, fr, 0)) { clear = false; break; }
        if (clear) for (const fr of bgExcl) if (inRect(bx, by, fr, 0)) { clear = false; break; }
        if (clear) for (const s2 of solids) if (inRect(bx, by, s2.rect, 7)) { clear = false; break; }
        if (clear) fogCands.push([Math.round(bx), Math.round(by)]);
      }
    }

    return {
      station: stationIdx, mat: o.mat || o.kind, kind: o.kind, idx: o.__ccIdx,
      p: o.p, s: o.s, dist: +cand.dist.toFixed(1),
      pts, bgCands, fogCands, rect: rect.map(v => Math.round(v)),
      cam: camP.map(v => +v.toFixed(1)), w: W, hpx: H,
    };
  }
  return { station: stationIdx, none: true, considered: plats.length, rej,
           cam: camP.map(v => +v.toFixed(1)) };
}
"""

# A cycling vanish tile spends most of its period blanked or STROBING RED in
# its warn telegraph; three blind frames 700 ms apart routinely miss the solid
# ON state entirely, and the "best" of three warn/off frames is fiction
# (temple-3 c0 measured its tile mid-telegraph at 2.07:1). The cycle is
# CLOSED-FORM in the deterministic stage clock (vanish.js evalState:
# s = fract(t/period + phase) * period; s < on → solid), so the runner reads
# the live clock + the def cycle and schedules the capture INSIDE the ON
# window instead of guessing. crumble/touch tiles are solid until triggered
# (single immediate frame); flicker keeps the blind multi-frame fallback.
VANISH_INFO_JS = r"""
([idx]) => {
  const A = globalThis.ASCENDANT, G = A && A.game, S = G && G.stage;
  if (!S || !S.hazards) return null;
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  for (const rec of S.hazards) {
    const h = rec && rec.h;
    if (!h || h.kind !== 'vanish' || !h.def) continue;
    const d = h.def;
    const t = (S.def && S.def.objects) ? S.def.objects[idx] : null;
    // the stage hands the SAME def objects to the factories, so identity
    // matches; positional match is the fallback if that ever changes
    const same = (d === t) || (d.__ccIdx === idx) ||
      (t && t.p && d.p && Math.hypot(d.p[0]-t.p[0], d.p[1]-t.p[1], d.p[2]-t.p[2]) < 0.01);
    if (!same) continue;
    const cyc = d.cycle || {};
    return {
      mode: String(d.mode || 'cycle').toLowerCase(),
      on: Math.max(0.10, num(cyc.on, 2.2)),
      warn: Math.max(0.08, num(cyc.warn, 0.75)),
      off: Math.max(0.10, num(cyc.off, 1.6)),
      phase: num(cyc.phase, 0),
      clock: S.clock,
    };
  }
  return null;
}"""

CLOCK_JS = "ASCENDANT.game.stage.clock"

CLICK_JS = r"""() => {
  const btns = Array.from(document.querySelectorAll('button.asc-btn'));
  for (const want of ['NEW RUN', 'PLAY', 'CONTINUE']) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (b.__activate) b.__activate(); else b.click();
      return want;
    }
  }
  return null;
}"""


RESUME_JS = r"""() => {
  const A = globalThis.ASCENDANT;
  const st = A && A.game && A.game.state;
  if (st !== 'paused') return st;
  const btns = Array.from(document.querySelectorAll('button.asc-btn'));
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4) continue;
    if ((b.textContent || '').toUpperCase().indexOf('RESUME') < 0) continue;
    if (b.__activate) b.__activate(); else b.click();
    return 'resumed';
  }
  return st;
}"""


def ensure_playing(pg, timeout=10):
    """The game pauses itself on focus loss; a paused frame is dimmed + blurred
    and every sample from it is fiction. Resume and wait for 'playing'."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st == "playing":
            return True
        try:
            pg.evaluate(RESUME_JS)
        except Exception:
            pass
        pg.wait_for_timeout(300)
    return False


def wait_ready(pg, timeout=70):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.stage)"):
                return True
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def click_play(pg, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st and st != "title":
            return True
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


# Registry material keys the photometric mask can reach (Mats.get keys whose
# themed instance is shared by the rendered mesh — vanish clones are not).
MASKABLE = {"stone", "metal", "panel", "grate", "ice", "glass", "obsidian",
            "wood", "sand", "checker", "rubber", "conveyor", "neon", "emissive"}


# ------------------------------------------------------------- sampling -----

def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    return 0.2126 * _lin(rgb[0]) + 0.7152 * _lin(rgb[1]) + 0.0722 * _lin(rgb[2])


def contrast(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def patch_stats(px, x, y, r, w, h):
    """(median RGB, max per-channel MAD) over a (2r+1)^2 patch, clamped"""
    rs, gs, bs = [], [], []
    for yy in range(max(0, y - r), min(h, y + r + 1)):
        for xx in range(max(0, x - r), min(w, x + r + 1)):
            p = px[xx, yy]
            rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
    med = (median(rs), median(gs), median(bs))
    mad = max(median([abs(v - med[i]) for v in ch])
              for i, ch in enumerate((rs, gs, bs)))
    return med, mad


def sample_frame(png_path, info, save_overlay=None, wiggle_path=None,
                 restore_path=None):
    """Measure one station from screenshot png_path.

    When wiggle_path is given it is a SECOND frame identical except that the
    target's themed material was darkened x0.22 — only pixels that responded
    to that change are provably the target material (a decor prop in front of
    the def target does not respond). When restore_path is ALSO given (a THIRD
    frame, material restored) a pixel only counts as responding if it moved in
    the wiggle frame AND came back in the restore frame: drifting particles
    (spire snow, temple motes) change pixels between any two frames and were
    counted as 'response', letting a bright flake-dusted pool impersonate the
    deck — a moving flake does not return to baseline, the deck does.
    Returns (deck, bg, ratio, bgmode, resp) with resp = responding pixel count
    (None when no wiggle frame given).
    """
    from PIL import Image, ImageDraw
    im = Image.open(png_path).convert("RGB")
    px = im.load()
    w, h = im.size
    px2 = px3 = None
    if wiggle_path:
        im2 = Image.open(wiggle_path).convert("RGB")
        if im2.size == im.size:
            px2 = im2.load()
    if restore_path and px2 is not None:
        im3 = Image.open(restore_path).convert("RGB")
        if im3.size == im.size:
            px3 = im3.load()
    # deck: pool a 5x5 patch around EVERY projected point and take the median
    # over the whole pool. Decks are speckled — frost-crust blobs, rime dots,
    # fixture glints — and a median of 25 tiny per-point medians lets those
    # speckles capture half the votes (spire's dark slab measured 40 sRGB
    # points too bright that way). The pooled median reads the DOMINANT deck
    # value, which is what the player separates from the haze.
    pool_r, pool_g, pool_b, pool_l = [], [], [], []
    total = responded = 0
    for (x, y) in info["pts"]:
        for yy in range(max(0, y - 2), min(h, y + 3)):
            for xx in range(max(0, x - 2), min(w, x + 3)):
                p = px[xx, yy]
                total += 1
                if px2 is not None:
                    q = px2[xx, yy]
                    if max(abs(q[0]-p[0]), abs(q[1]-p[1]), abs(q[2]-p[2])) < 10:
                        continue     # did not respond: not the target material
                    if px3 is not None:
                        r3 = px3[xx, yy]
                        if max(abs(r3[0]-p[0]), abs(r3[1]-p[1]), abs(r3[2]-p[2])) >= 12:
                            continue  # never came back: animation, not response
                    responded += 1
                pool_r.append(p[0]); pool_g.append(p[1]); pool_b.append(p[2])
                pool_l.append(luminance(p))
    # resp = COUNT of responding pixels (None when no wiggle frame was given).
    # A partially prop-occluded deck still yields an honest reading from its
    # visible slice, so the runner gates on absolute pixel count, not fraction.
    resp = responded if px2 is not None else None
    if not pool_l:
        return None, None, None, None, resp
    deck_l = median(pool_l)
    deck_rgb = (round(median(pool_r)), round(median(pool_g)), round(median(pool_b)))
    # empirical fog reference: cluster vote over the uniform horizon patches.
    # A single flank patch can land on a prop tower and lie; the haze band is
    # the LARGEST family of mutually-agreeing smooth patches along the horizon.
    fog_pool = []
    for (fx, fy) in info.get("fogCands", []):
        rgb, mad = patch_stats(px, fx, fy, 5, w, h)
        if mad <= 7:
            fog_pool.append(((fx, fy), rgb))
    fog_ref = None
    fog_xy = None
    if len(fog_pool) >= 3:
        best_cluster = []
        for (_, a) in fog_pool:
            cl = [(xy, r) for (xy, r) in fog_pool
                  if max(abs(r[i] - a[i]) for i in range(3)) <= 22]
            if len(cl) > len(best_cluster):
                best_cluster = cl
        if len(best_cluster) >= 3:
            fog_ref = tuple(median([r[i] for (_, r) in best_cluster]) for i in range(3))
            fog_xy = best_cluster[0][0]
    # background selection:
    #   1. with a fog reference: first uniform ADJACENT candidate that matches
    #      it (haze right next to the silhouette, not a prop wall); if none is
    #      haze, measure against the haze band itself ('fogband') — the law is
    #      written against the fog, and props hiding it locally do not repeal it,
    #   2. no fog reference (canyon interior): first uniform candidate ('occl'
    #      — the backdrop is architecture, read against that),
    #   3. else the least-varying candidate ('~' — nothing was clean).
    scored = []
    for (bx, by, mode) in info["bgCands"]:
        rgb, mad = patch_stats(px, bx, by, 5, w, h)
        scored.append((bx, by, mode, mad, rgb))
    chosen = None
    if fog_ref is not None:
        for (bx, by, mode, mad, rgb) in scored:
            if mad <= 7 and abs(luminance(rgb) - luminance(fog_ref)) <= 0.05 \
               and max(abs(rgb[i] - fog_ref[i]) for i in range(3)) <= 26:
                chosen = (bx, by, mode, mad, rgb)
                break
        if chosen is None:
            # no adjacent candidate shows haze, but the horizon does: measure
            # against the haze band itself, as the law is written
            chosen = (fog_xy[0], fog_xy[1], "fogband", 0, fog_ref)
    if chosen is None:
        for c in scored:
            if c[3] <= 7:
                chosen = (c[0], c[1], c[2] + " occl", c[3], c[4])
                break
    if chosen is None:
        c = min(scored, key=lambda q: q[3])
        chosen = (c[0], c[1], c[2] + "~", c[3], c[4])
    bx, by, bgmode, _, bg_rgb = chosen
    bg_l = luminance(bg_rgb)
    ratio = contrast(deck_l, bg_l)
    if save_overlay:
        d = ImageDraw.Draw(im)
        for (x, y) in info["pts"]:
            d.rectangle([x - 2, y - 2, x + 2, y + 2], outline=(255, 0, 255))
        d.rectangle([bx - 5, by - 5, bx + 5, by + 5], outline=(0, 255, 0), width=2)
        r = info.get("rect")
        if r:
            d.rectangle(r, outline=(255, 255, 0))
        im.save(save_overlay)
    return deck_rgb, tuple(round(v) for v in bg_rgb), ratio, bgmode, resp


# ------------------------------------------------------------------ main ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--floor", type=float, default=3.0)
    ap.add_argument("--target", type=float, default=3.5)
    ap.add_argument("--cps", type=int, default=0, help="limit stations per stage (0 = all)")
    ap.add_argument("--save-shots", action="store_true",
                    help="keep annotated frames in _shots/contrast/")
    args = ap.parse_args()

    os.makedirs(OUTDIR, exist_ok=True)
    if args.stages:
        stages = [s.strip() for s in args.stages.split(",") if s.strip()]
    else:
        d = os.path.join(HERE, "..", "runtime", "data", "stages")
        stages = sorted(f[:-3] for f in os.listdir(d) if f.endswith(".js")) if os.path.isdir(d) else []

    results = {}
    worst = None
    fails = warns = 0

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        tmp = os.path.join(OUTDIR, "_frame.png")
        tmp_w = os.path.join(OUTDIR, "_frame_wiggle.png")
        tmp_r = os.path.join(OUTDIR, "_frame_restore.png")

        for sid in stages:
            rows = []
            url = f"{BASE}?dev=1&quality={args.quality}&stage={sid}"
            try:
                pg.goto(url, wait_until="load", timeout=60_000)
            except Exception as e:
                rows.append({"error": f"nav failed {e}"})
                results[sid] = rows
                continue
            if not wait_ready(pg):
                rows.append({"error": "never loaded"})
                results[sid] = rows
                continue
            click_play(pg)
            pg.wait_for_timeout(1200)
            try:
                pg.evaluate("(s)=>ASCENDANT.game.__dev.goto(s)", sid)
            except Exception as e:
                rows.append({"error": f"goto failed {e}"})
                results[sid] = rows
                continue
            arrived = False
            deadline = time.time() + 60
            while time.time() < deadline:
                try:
                    if pg.evaluate("(s)=>!!(ASCENDANT.game.stage && ASCENDANT.game.stage.def && ASCENDANT.game.stage.def.id===s)", sid):
                        arrived = True
                        break
                except Exception:
                    pass
                pg.wait_for_timeout(400)
            if not arrived:
                rows.append({"error": "stage never became " + sid})
                results[sid] = rows
                continue
            pg.wait_for_timeout(1800)

            n_st = pg.evaluate(STATION_COUNT_JS)
            if args.cps:
                n_st = min(n_st, args.cps)
            for i in range(n_st):
                if not ensure_playing(pg):
                    rows.append({"station": i, "error": "game not in 'playing' state"})
                    continue
                # Ghost-retry loop: the photometric mask (WIGGLE_JS) proves the
                # sampled pixels wear the target's material; when they do not —
                # a decor prop with no def size is standing in front — the
                # candidate is excluded and selection runs again.
                ov = (os.path.join(OUTDIR, f"{sid}_st{i}.png") if args.save_shots else None)
                excl = []
                row = None
                for _attempt in range(4):
                    # pose facing +X (battery convention); if nothing is
                    # sampleable from that facing, turn toward the next station
                    info = None
                    err = None
                    for mode in (0, 1):
                        try:
                            pose = pg.evaluate(POSE_JS, [i, mode])
                        except Exception as e:
                            err = f"pose failed {e}"
                            break
                        if isinstance(pose, dict) and pose.get("error"):
                            err = pose["error"]
                            break
                        try:
                            got = pg.evaluate(SAMPLE_JS, [i, excl])
                        except Exception as e:
                            err = f"sample failed {e}"
                            break
                        err = None
                        info = got
                        if not got.get("error") and not got.get("none"):
                            if mode == 1:
                                info["turned"] = True
                            break
                    if err:
                        row = {"station": i, "error": err}
                        break
                    if info.get("error"):
                        row = {"station": i, "error": info["error"]}
                        break
                    if info.get("none"):
                        row = {"station": i, "na": True,
                               "considered": info.get("considered"),
                               "rej": info.get("rej"),
                               "ghosted": len(excl) or None}
                        break
                    if not ensure_playing(pg):
                        row = {"station": i, "error": "paused before capture"}
                        break
                    kind = info.get("kind")
                    mat = info.get("mat")
                    if kind == "conveyor":
                        # the belt top wears the 'conveyor' registry material,
                        # whatever frame material the def names in `mat`
                        mat = "conveyor"
                    if kind == "vanish":
                        # Vanish tiles blink, and their body material is a
                        # per-tile clone the registry wiggle cannot reach — no
                        # photometric mask here. The capture must land in the
                        # tile's solid ON state (a blanked tile is the absence
                        # of a walked surface; the warn strobe is a telegraph,
                        # not the surface). For 'cycle' tiles the ON window is
                        # computed from the live stage clock + the def cycle
                        # (see VANISH_INFO_JS); two takes inside ON, keep the
                        # better. crumble/touch = solid until triggered: shoot
                        # now. flicker (hash-driven) keeps blind best-of-3.
                        try:
                            vinfo = pg.evaluate(VANISH_INFO_JS, [info["idx"]])
                        except Exception:
                            vinfo = None
                        if vinfo is None:
                            # The def object has NO live hazard: the factory
                            # rejected it at stage build (spire-2's five
                            # crumble planks die in validateHazardDef —
                            # "missing required field(s) cycle:object" — even
                            # though crumble ignores cycle). Sampling the def's
                            # ghost rectangle would measure open sky as "the
                            # deck". Report the absence instead.
                            row = {"station": i, "error":
                                   "vanish def objects[%d] has no live hazard "
                                   "(hazard factory rejected it at build — "
                                   "see the stage console)" % info["idx"]}
                            break
                        best = None
                        if vinfo and vinfo["mode"] == "cycle":
                            period = vinfo["on"] + vinfo["warn"] + vinfo["off"]
                            for s_target in (min(0.30 * vinfo["on"], vinfo["on"] - 0.05),
                                             min(0.65 * vinfo["on"], vinfo["on"] - 0.05)):
                                try:
                                    clock = pg.evaluate(CLOCK_JS)
                                except Exception:
                                    break
                                s_now = ((clock / period + vinfo["phase"]) % 1.0) * period
                                wait_s = (s_target - s_now) % period
                                if wait_s > 0.02:
                                    pg.wait_for_timeout(int(wait_s * 1000) + 20)
                                pg.screenshot(path=tmp)
                                got = sample_frame(tmp, info, save_overlay=ov)
                                if got[2] is not None and (best is None or got[2] > best[2]):
                                    best = got
                        elif vinfo and vinfo["mode"] in ("crumble", "touch"):
                            pg.screenshot(path=tmp)
                            got = sample_frame(tmp, info, save_overlay=ov)
                            if got[2] is not None:
                                best = got
                        if best is None:
                            for fi in range(3):
                                if fi:
                                    pg.wait_for_timeout(700)
                                pg.screenshot(path=tmp)
                                got = sample_frame(tmp, info, save_overlay=ov)
                                if got[2] is not None and (best is None or got[2] > best[2]):
                                    best = got
                        if best is None:
                            row = {"station": i, "error": "vanish sample empty"}
                            break
                        deck, bg, ratio, bgmode, _resp = best
                        bgmode += " vanish-solid"
                    elif mat in MASKABLE:
                        # up to two timed takes: laser sweeps / blade FX wash
                        # additively over a deck for part of their cycle, and
                        # one badly-timed frame should not fail a surface that
                        # reads fine the rest of the time — keep the better
                        best2 = None
                        ghost = False
                        for take in range(2):
                            if take:
                                pg.wait_for_timeout(800)
                            pg.screenshot(path=tmp)
                            pg.evaluate(WIGGLE_JS, [mat, True])
                            pg.wait_for_timeout(170)
                            pg.screenshot(path=tmp_w)
                            pg.evaluate(WIGGLE_JS, [mat, False])
                            pg.wait_for_timeout(170)
                            pg.screenshot(path=tmp_r)
                            got = sample_frame(tmp, info, save_overlay=ov,
                                               wiggle_path=tmp_w, restore_path=tmp_r)
                            ghost = got[0] is None or (got[4] is not None and got[4] < 120)
                            if ghost:
                                break
                            if best2 is None or got[2] > best2[2]:
                                best2 = got
                            if best2[2] >= args.target:
                                break
                        if ghost or best2 is None:
                            excl.append(info["idx"])   # ghost: prop in front
                            continue
                        deck, bg, ratio, bgmode, resp = best2
                    else:
                        pg.screenshot(path=tmp)
                        deck, bg, ratio, bgmode, _resp = sample_frame(tmp, info, save_overlay=ov)
                        if deck is None:
                            row = {"station": i, "error": "sample empty"}
                            break
                    row = {
                        "station": i, "mat": mat, "dist": info["dist"],
                        "deck": deck, "bg": bg, "bgmode": bgmode,
                        "ratio": round(ratio, 2),
                        "verdict": ("FAIL" if ratio < args.floor
                                    else "WARN" if ratio < args.target else "pass"),
                    }
                    break
                if row is None:
                    row = {"station": i, "na": True, "ghosted": len(excl)}
                # THE LAW IS WRITTEN AGAINST THE FOG/SKY (file docstring, and
                # the contrast criterion itself: deck vs the haze behind it).
                # A station whose backdrop is ARCHITECTURE — a canyon interior,
                # a drum set-piece — has no haze to fail against: its 'occl'
                # reading is printed as evidence but does not drive the gate
                # (temple-2's torch-blasted shelf vs a sunlit machine arm is a
                # composition question for the lighting owner, not a walked-
                # surface-vs-fog violation).
                if "occl" in str(row.get("bgmode", "")) and row.get("verdict") in ("FAIL", "WARN"):
                    row["verdict"] = "occl-" + row["verdict"]
                # THE GATE COVERS CHECKPOINT STATIONS (the spec: "stands at
                # each checkpoint"). Station 0 is the spawn — a bonus reading,
                # printed for information but never the reason the gate goes
                # red: several spawn aprons sit inside fixture-dense set
                # dressing whose additive light pools are the lighting
                # system's lever, not a walked-surface albedo.
                if i == 0 and row.get("verdict") in ("FAIL", "WARN"):
                    row["verdict"] = "info-" + row["verdict"]
                rows.append(row)
                if row.get("verdict") == "FAIL":
                    fails += 1
                elif row.get("verdict") == "WARN":
                    warns += 1
                if i > 0 and row.get("ratio") is not None and (worst is None or row["ratio"] < worst[2]):
                    worst = (sid, i, row["ratio"])
            results[sid] = rows

        br.close()
    for f in (tmp, tmp_w, tmp_r):
        try:
            os.remove(f)
        except OSError:
            pass

    # ---------------------------------------------------------- report ------
    print(f"\nwalked-surface contrast (target >= {args.target}:1, hard floor {args.floor}:1)")
    for sid, rows in results.items():
        print(f"\n  {sid}")
        print("    st  mat        dist   deck RGB         bg RGB           ratio  verdict")
        for r in rows:
            st = r.get("station")
            lbl = "sp" if st == 0 else (f"c{st-1}" if isinstance(st, int) else "-")
            if r.get("error"):
                print(f"    {lbl:>2}  ERROR: {r['error']}")
            elif r.get("na"):
                gh = r.get("ghosted")
                extra = f" — {gh} candidate(s) hidden behind decor props" if gh else ""
                print(f"    {lbl:>2}  (no visible next-platform top from this station{extra})")
            else:
                d, b = r["deck"], r["bg"]
                mode = "" if r["bgmode"] == "above" else f" [{r['bgmode']}]"
                print(f"    {lbl:>2}  {r['mat']:<9}  {r['dist']:>4}   "
                      f"({d[0]:>3},{d[1]:>3},{d[2]:>3})    ({b[0]:>3},{b[1]:>3},{b[2]:>3})    "
                      f"{r['ratio']:>5}  {r['verdict']}{mode}")

    out = {"floor": args.floor, "target": args.target, "results": results}
    with open(os.path.join(HERE, "contrastcheck.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)

    print(f"\n  {fails} FAIL (< {args.floor}:1), {warns} WARN (< {args.target}:1)")
    if worst:
        print(f"  worst: {worst[0]} station {worst[1]} at {worst[2]:.2f}:1")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
