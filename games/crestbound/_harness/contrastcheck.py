#!/usr/bin/env python
"""CRESTBOUND readability gate — walked surface vs the fog band, in PIXELS.

THE LAW (CONTRACT §15): the surface the hero walks on must hold >= 3.5:1 WCAG
relative-luminance contrast against the background actually behind it — the fog
band. This tool is the only honest source for that number: albedo arithmetic
(tint hex vs fog hex) has shipped fiction before, because lighting, exposure,
tone mapping, the grade, bloom and the sky dome all sit between a material
constant and the pixel a player sees.

METHOD, per station (the spawn and every checkpoint of every course):
  1. teleport the hero onto the station, let the frame settle (lighting, LOD,
     particles, the camera's ease-back),
  2. project the station's WORLD position through the LIVE camera
     (`camera.project`) to find the hero's feet in screen pixels — the def is
     ground truth for where the walked surface is, and the live camera says
     which pixels are wearing it. A fixed screen rectangle would sample the sky
     on a climb and the hero's own back on a descent,
  3. sample a band just BELOW the feet (the ground between the hero and the
     camera; offset far enough down to clear the blob shadow) and take the
     MEDIAN colour — median, not mean, so one bright stripe or a coin does not
     move the number,
  4. sample the BACKGROUND BEHIND THAT DECK — see THE RULER below,
  5. WCAG contrast between the two luminances.

THE RULER (rewritten 2026-09-08, readability lane).
Until this pass step 4 was "a horizontal strip 14 % of the frame wide at 55 %
of frame height, on the side away from the hero". That is a FIXED SCREEN
RECTANGLE, and a fixed screen rectangle is not the background: measured on the
shipped tree it read a cottage wall, a signboard, the HUD, or the SAME SNOW the
hero is standing on five metres away — `rime-1 cp1` scored 1.03:1 with deck
[165,198,235] against "fog" [161,195,233], which is the same snow twice. 40 of
61 gated stations failed that ruler.

The repaired ruler measures what is actually behind the walked surface:

  a. every overlay element is hidden for the capture (`MUTE_JS`) — the HUD, the
     dev panel and the toasts are not the world and must never enter a median;
  b. ONE DEPTH PASS per station: `MeshDepthMaterial` (RGBA-packed) is rendered
     over the scene into a render target the size of the screenshot and read
     back, so every sampled pixel carries a view-space distance in metres.
     Objects that do not write depth in the real frame (particles, glows, the
     sky dome, blob shadows) are hidden for it, so they cannot pretend to be
     occluders. The clear colour is WHITE, which unpacks to ~1.0 = beyond the
     far plane, so "no geometry" reads as sky rather than as a pixel 25 cm away;
  c. the SIGHT COLUMN: the screen region above the deck band's own projected
     silhouette, spanning the deck's width plus `--col-pad`, is scanned on a
     grid, and every pixel is unprojected to a WORLD POINT. A candidate is
     BACKGROUND only if that point is at least `--min-behind` metres FROM THE
     STATION. That is the rejection the old ruler never had: the deck's own lip,
     the pad ring, a sign post and the fence rail are all inside that radius;
  d. the HORIZON filter: a candidate BELOW the camera's horizon line is GROUND,
     however far away it is — a horizontal plane under the eye can never project
     above its own vanishing line. That is the geometric form of the old ruler's
     second failure, "walked snow measured against snow thirty metres away": two
     views of one material cannot be separated by any lighting or palette change,
     so counting them measures nothing. What survives is sky, fog, distant walls,
     buildings, hillsides and cliff faces — the fog band;
  e. the row reports which RUNG produced the number. `far` is the normal case.
     `enclosed` means an interior with nothing `--min-behind` past the deck, so
     the depth margin relaxed — the far wall of a cellar IS that deck's
     background and the law still applies to it. `ground` means no pixel above
     the horizon was in the sight column at all (a shaft, a pit) and the HORIZON
     filter had to be dropped.

The old strip is still measured and printed as `strip` for comparison; it is
not a pass condition any more.

An all-black frame (GPU/tab contention) is evidence of nothing: it is retaken,
and if it stays black the station prints UNMEASURABLE — deliberately distinct
from FAIL, because nothing was measured.

    python contrastcheck.py                       # every course on disk
    python contrastcheck.py --courses verdant-1 --save-crops
    python contrastcheck.py --floor 3.5 --headless

Exit 0 = every CHECKPOINT station is at or above the floor. The spawn row is
printed for information; a spawn apron inside set dressing does not gate.
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
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "_shots", "contrast")
BASE = "http://localhost:8788/games/crestbound/index.html"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

FLOOR = 3.5              # CONTRACT §15
LUMA_FLOOR = 2.5         # mean 8-bit luma below this = a contention frame
BLACK_RETRIES = 2

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

STATIONS_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, G = A && A.game, C = G && G.course;
  if (!C) return {error: 'no course'};
  const posOf = (o) => {
    if (!o) return null;
    if (typeof o.x === 'number') return {x:o.x, y:o.y, z:o.z};
    if (o.pos) return posOf(o.pos);
    if (o.p) return Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : posOf(o.p);
    if (o.position) return posOf(o.position);
    return null;
  };
  const out = [];
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  if (sp && sp.pos) out.push({name: 'spawn', gates: false, p: posOf(sp.pos),
                              yaw: (typeof sp.yaw === 'number') ? sp.yaw : 0});
  (C.checkpoints || []).forEach((c, i) => {
    if (i === 0) return;                       // checkpoints[0] IS the spawn
    const p = posOf(c);
    if (p) out.push({name: 'cp' + i, gates: true, p,
                     yaw: (typeof c.yaw === 'number') ? c.yaw : 0,
                     padR: (typeof c.radius === 'number') ? c.radius : 2.15});
  });
  return {stations: out, theme: G.themeId, courseId: G.courseId,
          name: (C.def && C.def.name) || G.courseId};
}
"""

# Pose the hero on a station and report where the ground under their feet lands
# on screen, through the LIVE camera.
POSE_JS = r"""
async (st) => {
  const A = globalThis.CRESTBOUND, G = A.game, THREE = A.THREE, E = A.engine;
  if (!G || !THREE || !E) return {error: 'no game/THREE/engine'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  syncP();
  if (!P || !P.__test) return {error: 'no player.__test'};

  const yaw = (typeof st.yaw === 'number' && isFinite(st.yaw)) ? st.yaw : 0;
  const put = () => {
    P.__test.teleport(new THREE.Vector3(st.p.x, st.p.y + 0.5, st.p.z));
    P.__test.setVel(new THREE.Vector3(0, 0, 0));
    /* Face the authored course direction, so the camera recenters BEHIND the
       hero and "ahead of the checkpoint" is the ground the player looks at. */
    if (P.__test.setFacing) P.__test.setFacing(yaw);
  };
  /* A FROZEN WORLD, SETTLED IN. The frame has to be the same frame twice or the
     row is a mood: the checkpoint pad PULSES (CONTRACT §15 asks it to), the deck
     band sits partly on it, and hazards, coins and water all animate. Two sweeps
     of an unedited tree disagreed by up to 0.73 (ember-4 cp1 read deck
     [81,81,89] then [117,110,113]).

     The clock is pinned BEFORE the settle, not after. Pinning it after was worse
     than not pinning it: CONTRACT §21 makes every hazard a pure function of the
     course clock, so jumping the clock at the end teleports azure-2's rotating
     rooms and ember-2's crushers out from under a hero who settled somewhere
     else (azure-2 cp3 read deck [192,186,177] one way and [36,107,91] the
     other). Stop the loop, pin both clocks, and hand-step game.update(1/60):
     the hero, the camera ease, the hazards, the pad phase and the water are all
     one deterministic configuration, and the screenshot and the depth pass see
     the SAME frame instead of two moving ones. */
  const PHASE = 12.0, DT = 1 / 60;
  const pin = () => {
    try { if (typeof E.elapsed === 'number') E.elapsed = PHASE; } catch (e) {}
    try { if (G.course && typeof G.course.clock === 'number') G.course.clock = PHASE; } catch (e) {}
  };
  const step = (n) => {
    for (let k = 0; k < n; k++) { pin(); try { G.update(DT); } catch (e) {} }
  };
  try { if (E.running && typeof E.stop === 'function') E.stop(); } catch (e) {}
  await frame();                    // let the in-flight rAF drain
  pin();
  put();
  if (G.cam && G.cam.recenter) G.cam.recenter();
  step(60);                         // lighting / LOD / camera ease, deterministically

  // A station on a conveyor or a slope carries the hero away during the settle;
  // re-pin once and give the frame a short second settle, or the "station" shot
  // is of somewhere else entirely.
  syncP();
  if (Math.hypot(P.pos.x - st.p.x, P.pos.y - (st.p.y + 0.5), P.pos.z - st.p.z) > 2.0) {
    put();
    step(20);
  }
  syncP();
  if (P.dead) return {error: 'the hero died on the station'};

  const cam = E.camera;
  const cv = document.querySelector('canvas');
  const rect = cv ? cv.getBoundingClientRect() : {width: window.innerWidth, height: window.innerHeight, left: 0, top: 0};
  const project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return {x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
            y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
            behind: v.z > 1};
  };
  const feet = project(st.p.x, st.p.y, st.p.z);
  const head = project(P.pos.x, P.pos.y + 1.5, P.pos.z);
  const heroFeet = project(P.pos.x, P.pos.y, P.pos.z);
  /* View-space depth (metres along the camera's forward axis) — the same
     quantity the depth pass reconstructs, so "N metres behind the deck" is a
     comparison of like with like. */
  const _v = new THREE.Vector3();
  const viewDepth = (x, y, z) => -_v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse).z;

  /* THE DECK WINDOW (critic C13). The old window was a screen rectangle just
     below the projected feet — which, through a third-person camera that sits
     behind and above the hero, is the hero's own legs and the checkpoint's
     glowing torus, not the walked surface. Sample a band of WORLD points
     0.8-2.0 m AHEAD of the station along the course direction (yaw 0 faces
     -Z: forward = (-sin, -cos), right = (cos, -sin)), spread 1.6 m either
     side, project each through the live camera, and let Python reject any
     that fall inside the hero's screen box. Points on the pad's lit ring
     (torus at 1.42 m, course.js _buildCheckpoints) are rejected in WORLD
     space here, so the ring's glow never enters the median. */
  const fwx = -Math.sin(yaw), fwz = -Math.cos(yaw);
  const rtx = Math.cos(yaw), rtz = -Math.sin(yaw);
  const RING_R = 1.42, RING_HALF = 0.20;
  const samples = [];
  const sampleDepths = [];
  const NA = 7, NL = 13;
  for (let ia = 0; ia < NA; ia++) {
    const a = st.aheadFrom + (st.aheadTo - st.aheadFrom) * (ia / (NA - 1));
    for (let il = 0; il < NL; il++) {
      const l = -st.halfWidth + 2 * st.halfWidth * (il / (NL - 1));
      const wx = st.p.x + fwx * a + rtx * l, wz = st.p.z + fwz * a + rtz * l;
      const dr = Math.hypot(wx - st.p.x, wz - st.p.z);
      if (Math.abs(dr - RING_R) < RING_HALF) continue;      // the torus glow
      const s = project(wx, st.p.y, wz);
      if (s.behind) continue;
      samples.push([Math.round(s.x), Math.round(s.y)]);
      sampleDepths.push(viewDepth(wx, st.p.y, wz));
    }
  }
  const _sd = sampleDepths.slice().sort((a, b) => a - b);
  const deckDepth = _sd.length ? _sd[_sd.length >> 1] : 0;
  const deckDepthMax = _sd.length ? _sd[_sd.length - 1] : 0;

  const frozen = !E.running;
  /* The hero's screen box: feet to head, +-0.45 m of shoulder, so his body,
     scarf and blob shadow never land in the deck median. */
  const hb = [
    project(P.pos.x - rtx * 0.45, P.pos.y, P.pos.z - rtz * 0.45),
    project(P.pos.x + rtx * 0.45, P.pos.y, P.pos.z + rtz * 0.45),
    project(P.pos.x - rtx * 0.45, P.pos.y + 1.75, P.pos.z - rtz * 0.45),
    project(P.pos.x + rtx * 0.45, P.pos.y + 1.75, P.pos.z + rtz * 0.45),
    project(P.pos.x - fwx * 0.45, P.pos.y, P.pos.z - fwz * 0.45),
    project(P.pos.x + fwx * 0.45, P.pos.y + 1.75, P.pos.z + fwz * 0.45),
  ];
  const heroBox = {
    x0: Math.min(...hb.map(q => q.x)) - 6, x1: Math.max(...hb.map(q => q.x)) + 6,
    y0: Math.min(...hb.map(q => q.y)) - 6, y1: Math.max(...hb.map(q => q.y)) + 6,
  };
  return {
    ok: true,
    w: Math.round(rect.width), h: Math.round(rect.height),
    feet, head, heroFeet, samples, sampleDepths, heroBox, yaw,
    deckDepth, deckDepthMax, deckY: st.p.y, frozen,
    heroPx: Math.round(Math.abs(heroFeet.y - head.y)),
    theme: G.themeId, state: G.state,
    fog: (E.scene && E.scene.fog) ? '#' + E.scene.fog.color.getHexString() : null,
    surface: P.surface || null,
  };
}
"""

# --------------------------------------------------------------------------
# Overlay mute. The screenshot must contain the WORLD and nothing else: the
# HUD glass, the ?dev=1 panel and the checkpoint toast are DOM, they sit on top
# of the canvas, and both the deck band and the background band can land on
# them. Hiding them is not cosmetic — a HUD panel in a median is a fabricated
# contrast number.
MUTE_JS = r"""
() => {
  const cv = document.querySelector('canvas');
  if (!cv) return 0;
  const hidden = [];
  const walk = (node) => {
    for (const el of Array.from(node.children || [])) {
      if (el === cv) continue;
      if (el.contains && el.contains(cv)) { walk(el); continue; }
      let vis = '';
      try { vis = getComputedStyle(el).visibility; } catch (e) { vis = ''; }
      if (vis === 'hidden') continue;
      hidden.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    }
  };
  walk(document.body);
  globalThis.__ccHidden = hidden;
  return hidden.length;
}
"""

# Hand the loop back after a frozen capture; the next station's pose needs real
# rAF frames to settle the camera.
RESUME_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A && A.engine, G = A && A.game;
  if (!E || !G) return false;
  if (!E.running && typeof E.start === 'function') { E.start((dt) => G.update(dt)); return true; }
  return false;
}
"""

UNMUTE_JS = r"""
() => {
  const h = globalThis.__ccHidden || [];
  for (const [el, v] of h) { try { el.style.visibility = v || ''; } catch (e) {} }
  globalThis.__ccHidden = null;
  return h.length;
}
"""

# --------------------------------------------------------------------------
# THE DEPTH PASS + THE SIGHT COLUMN.
#
# One `MeshDepthMaterial` override render into a render target the size of the
# screenshot, read back in the browser (3.7 M bytes never cross the Playwright
# bridge — only the few hundred accepted screen points do).
#
# Three details that decide whether the number means anything:
#   * the CLEAR COLOUR is white. `packDepthToRGBA(1.0)` saturates to
#     (0,0,0,255), which unpacks to 0.99609 — with near 0.05 / far 900 that is
#     a view depth of ~13 m, so a black clear would make the SKY look like a
#     near occluder and reject the whole background. White unpacks to 0.99999
#     (~1800 m), i.e. "nothing here".
#   * every object whose REAL material does not write depth (particles, glows,
#     the sky dome, decals, the blob shadow) is hidden for the pass. Under an
#     override material they would all write depth and pretend to occlude —
#     rime's ambient snow alone would reject most of the frame.
#   * depth is converted to VIEW-SPACE METRES, the same quantity POSE_JS
#     reports for the deck, so `--min-behind` is a real distance.
BG_JS = r"""
(o) => {
  const A = globalThis.CRESTBOUND, E = A.engine, THREE = A.THREE, G_ = A.game;
  const renderer = E.renderer, scene = E.scene, cam = E.camera;
  const w = Math.round(o.w), h = Math.round(o.h);
  if (!(w > 0 && h > 0)) return {error: 'bad size'};

  let rt = globalThis.__ccDepthRT;
  if (!rt || rt.width !== w || rt.height !== h) {
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false});
    globalThis.__ccDepthRT = rt;
  }
  let mat = globalThis.__ccDepthMat;
  if (!mat) {
    mat = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking,
                                       side: THREE.DoubleSide});
    globalThis.__ccDepthMat = mat;
  }

  /* hide everything that does not occlude in the real frame */
  const hidden = [];
  scene.traverse((ob) => {
    if (!ob.visible) return;
    const m = ob.material;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    let occludes = false;
    for (const mm of list) {
      if (!mm) continue;
      if (mm.depthWrite !== false && mm.depthTest !== false) occludes = true;
    }
    if (!occludes) { hidden.push(ob); ob.visible = false; }
  });

  const prevRT = renderer.getRenderTarget();
  const prevOverride = scene.overrideMaterial;
  const prevFog = scene.fog;
  /* `scene.background` is painted by WebGLBackground BEFORE the scene and is
     NOT covered by `overrideMaterial`, so it overwrites the white clear with
     the theme's sky colour and every sky pixel then unpacks to the NEAR PLANE.
     Measured: verdant-2 cp3's sight column came back 9996/12432 "bad depth",
     raw RGBA (29,82,161) = the LINEAR value of the verdant background
     0x5f9ad0. Null it for the pass. */
  const prevBg = scene.background;
  const prevClear = new THREE.Color(); renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevVp = new THREE.Vector4(); renderer.getViewport(prevVp);
  const prevScissor = renderer.getScissorTest();
  const prevAutoClear = renderer.autoClear;
  const prevShadow = renderer.shadowMap.enabled;

  scene.overrideMaterial = mat;
  scene.fog = null;
  scene.background = null;
  renderer.shadowMap.enabled = false;
  renderer.setScissorTest(false);
  renderer.autoClear = true;
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(rt);
  renderer.setViewport(0, 0, w, h);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);

  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);

  renderer.setRenderTarget(prevRT);
  renderer.setViewport(prevVp);
  renderer.setScissorTest(prevScissor);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  renderer.shadowMap.enabled = prevShadow;
  scene.overrideMaterial = prevOverride;
  scene.fog = prevFog;
  scene.background = prevBg;
  for (const ob of hidden) ob.visible = true;

  /* three r172 packing.glsl, inverted. NOTE THE ORDER: `packDepthToRGBA`
     returns vec4(vuf*Inv255, gf*PackUpscale, bf*PackUpscale, af) and
     UnpackFactors4 = vec4(UnpackDownscale/1, /256, /65536, 1/16777216) — R is
     the HIGH byte and A the lowest fraction. Reading it the other way round
     (the pre-r15x order) makes every pixel report the NEAR PLANE: measured
     0.05 m everywhere on the first run of this pass, which rejected 10116 of
     10791 candidates as "in front of the deck". */
  const UD = 255 / 256;
  const UF = [UD, UD / 256, UD / 65536, 1 / 16777216];
  const near = cam.near, far = cam.far;
  const depthAt = (x, y) => {
    const i = (((h - 1 - y) * w) + x) * 4;
    const d = (buf[i] / 255) * UF[0] + (buf[i + 1] / 255) * UF[1] +
              (buf[i + 2] / 255) * UF[2] + (buf[i + 3] / 255) * UF[3];
    const ndc = d * 2 - 1;
    const den = far + near - ndc * (far - near);
    if (den <= 1e-6) return far * 4;
    return 2 * near * far / den;
  };

  /* the deck's own silhouette on screen */
  const ds = (o.deckSamples || []).filter(s => s[0] >= 0 && s[0] < w && s[1] >= 0 && s[1] < h);
  if (!ds.length) return {error: 'no on-screen deck samples'};
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of ds) { x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]);
                        y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]); }
  const pad = Math.max(o.colPadPx || 0, (x1 - x0) * (o.colPad || 0));
  const cx0 = Math.max(0, Math.round(x0 - pad)), cx1 = Math.min(w - 1, Math.round(x1 + pad));
  const cyTop = 0, cyBot = Math.max(0, Math.round(y0) - 2);

  const hb = o.heroBox || {};
  const inHero = (x, y) => (hb.x0 !== undefined && x >= hb.x0 && x <= hb.x1 && y >= hb.y0 && y <= hb.y1);

  /* Unproject a screen pixel at view depth d back to WORLD space, so a
     candidate can be asked what it IS, not just how far away it is. */
  const tanHalf = Math.tan(cam.fov * Math.PI / 360);
  const aspect = cam.aspect;
  const _p = new THREE.Vector3();
  const sx_ = o.station ? o.station.x : 0, sy_ = o.station ? o.station.y : 0,
        sz_ = o.station ? o.station.z : 0;
  /* Distance FROM THE STATION, in world metres. "Nearer than N" has to be a
     physical distance, not a view depth: under a camera pitched down, the top
     of a wall four metres away has a SMALLER view depth than its foot, so a
     view-depth margin throws away the whole background of an interior and
     leaves only whatever is visible through a doorway (measured: rime-1 cp4
     scored 1.16:1 against the snow seen through the cottage door while the
     dark wall it is really read against was rejected as "too near"). */
  const distAt = (x, y, d) => {
    const nx = (x + 0.5) / w * 2 - 1;
    const ny = -((y + 0.5) / h * 2 - 1);
    _p.set(nx * tanHalf * aspect * d, ny * tanHalf * d, -d).applyMatrix4(cam.matrixWorld);
    return Math.hypot(_p.x - sx_, _p.y - sy_, _p.z - sz_);
  };

  /* THE HORIZON — the vanishing line of every horizontal plane in this camera.
     Ground BELOW the eye can never project above it, whatever its height or
     how far away it is, so "at or above the horizon" is the exact test for
     "this is the fog band, not more floor". The camera has no roll (YXZ,
     FollowCamera), so the line is flat and one number fixes it:
        forward.y = sin(pitch);  ndcY_horizon = -tan(pitch) / tanHalfFov. */
  const _f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
  const pitch = Math.asin(Math.max(-1, Math.min(1, _f.y)));
  const horizonY = (0.5 + Math.tan(pitch) / (2 * tanHalf)) * h;

  const step = Math.max(1, o.step | 0);
  const cands = [];
  let scanned = 0, near_ = 0, hero_ = 0, bad_ = 0;
  const rawBad = [];
  const behind = o.minBehind || 0;
  for (let y = cyTop; y <= cyBot; y += step) {
    for (let x = cx0; x <= cx1; x += step) {
      scanned++;
      if (inHero(x, y)) { hero_++; continue; }
      const d = depthAt(x, y);
      if (d < 0.5) {
        bad_++;
        if (rawBad.length < 6) {
          const i = (((h - 1 - y) * w) + x) * 4;
          rawBad.push([x, y, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]);
        }
        continue;
      }
      const r = distAt(x, y, d);
      if (r < behind) { near_++; continue; }
      cands.push([x, y, Math.round(d * 100) / 100, Math.round(r * 10) / 10]);
    }
  }
  /* VERIFY THE DECK BAND. A sample is only on the walked surface if the depth
     buffer at that pixel agrees with the depth the projection expected. Where
     the deck band overhangs an edge — verdant-2 cp3's rampart, whose 2 m band
     runs off the parapet — the pixel is showing the grass sixty metres beyond,
     and averaging that into "the deck" measures the background twice. */
  const expect = o.deckDepths || [];
  const deckKeep = [];
  let deckOff = 0;
  const dsAll = o.deckSamples || [];
  for (let i = 0; i < dsAll.length; i++) {
    const s = dsAll[i];
    if (!(s[0] >= 0 && s[0] < w && s[1] >= 0 && s[1] < h)) continue;
    if (inHero(s[0], s[1])) continue;
    const dm = depthAt(s[0], s[1]);
    const de = expect[i];
    if (typeof de === 'number' && Math.abs(dm - de) > (o.deckTol || 0.35) + de * 0.03) {
      deckOff++;
      continue;
    }
    deckKeep.push([s[0], s[1]]);
  }
  let deckSeen = [];
  for (const s of deckKeep) deckSeen.push(depthAt(s[0], s[1]));
  deckSeen.sort((a, b) => a - b);

  /* ==================================================================
     THE SILHOUETTE EDGE — the quantity a player actually uses.
     ------------------------------------------------------------------
     The deck-vs-fog-band ruler asks "is the floor a different tone from
     the far distance". That is not the judgement a jump needs. A jump
     needs "WHERE DOES THIS SURFACE STOP", and that is a LOCAL question:
     the eye finds the boundary between the last deck pixel and the first
     pixel of whatever lies beyond or below it, and reads the step across
     it. CONTRACT hard rule 2 names the other half of the same mechanism
     — "bright leading-edge stripes on jump-critical surfaces" (§17:
     every landable surface gets `edgeStripe` in `palette.safeEdge`).

     Both are measured here, off the SAME frozen frame and the SAME depth
     pass, so no new source of truth is invented:

       * walk out from the deck's projected footprint (UP the screen for
         the far lip, LEFT and RIGHT for the lateral lips) one pixel at a
         time, reading the depth buffer;
       * the first place view depth JUMPS AWAY by more than
         max(edgeJumpAbs, edgeJumpRel * d) is the silhouette edge: the
         surface ended and something much further (or nothing at all —
         sky reads as ~1800 m) is behind it;
       * a jump TOWARD the camera is an occluder rising in front of the
         deck (a wall, a post, a crate). That scan line has no measurable
         lip and says so — it is not counted as a pass or a fail;
       * around the edge, three windows of pixels are handed to Python,
         which owns the colour: DECK (just inside the lip, past a 1 px
         anti-alias guard), BEYOND (just outside it), and LIP (the first
         `edgeLip` pixels inside — where a leading-edge stripe would be).
         Each window is depth-verified, so a "deck" sample that is really
         sky cannot enter the median.

     Python turns those into contrast ratios. Nothing here decides a
     verdict; this function only says which pixels are where. */
  /* THE SILHOUETTE, FOUND BY TRACKING THE SURFACE — two wrong rulers first.
     ------------------------------------------------------------------------
     v1 called ANY per-pixel view-depth jump a lip. It fired all over open
     ground, because a surface seen at a grazing angle puts metres between
     adjacent pixels near its vanishing line (keep/cp3 "found" 66 lips at a
     median cue of 1.57 — grass measured against grass).
     v2 predicted the depth of the horizontal plane y = the station's y and
     called a lip a jump PAST it. That is exact on a flat deck and wrong
     everywhere else: a hillside, a ramp or a stair is not that plane, so
     verdant-1's terrain stations and the whole Keep interior returned
     "no lip" (0 of 84 scan lines on four Keep stations).

     v3 tracks the SURFACE the hero is standing on, whatever its shape. Walk
     outward one pixel at a time; keep an EMA of the per-pixel depth slope; the
     lip is where depth leaps past the surface's OWN continuation:

         dPred = prev + slope        (the surface, carried on one more pixel)
         lip   <=> d - dPred > max(jumpAbs, jumpRel * prev)

     Grazing ground is handled because the slope term IS the grazing. Three
     stops keep the number honest:
       * `slope > maxSlopeFrac * prev` — one pixel now spans a quarter of the
         surface's distance. Nobody reads an edge off ground that foreshortened,
         and neither should the gate;
       * `prev > edgeMaxDepth` — a lip 60 m away is not a jump decision;
       * a leap TOWARD the camera is an occluder rising in front (a wall, a
         post, a crate). That line has no readable lip and is reported as
         `occluded` — neither a pass nor a fail;
       * the tracked surface CLIMBS more than `edgeMaxRise` above the station.
         A vertical face has almost constant view depth, so a scan line walking
         up one registers neither a jump nor an occluder: measured on ember-3
         cp2, lines that started on the ash plain walked up the spiral tower's
         front face and reported its SKYLINE as the lip (frame
         `_shots/contrast/ember-3_cp2_deck.png`, beyond samples on the red sky
         at the tower's crest, cue 1.74). That is a silhouette, but not of
         anything the hero can walk off. A surface a metre over his boots is a
         wall. */
  const eStride = Math.max(1, o.edgeStride | 0);
  const eGap = Math.max(0, o.edgeGap | 0);
  const eSpan = Math.max(2, o.edgeSpan | 0);
  const eLip = Math.max(2, o.edgeLip | 0);
  const eJumpAbs = o.edgeJumpAbs || 0.4;
  const eJumpRel = o.edgeJumpRel || 0.06;
  const eMaxWalk = Math.max(8, o.edgeMaxWalk | 0);
  const eMaxDepth = o.edgeMaxDepth || 60;
  const eMaxSlope = o.edgeMaxSlopeFrac || 0.25;
  const eStartTol = o.edgeStartTol || 0.6;
  const eMinGap = o.edgeMinGap || 1.5;
  const eMaxRise = o.edgeMaxRise || 1.0;
  const skyD = far * 0.5;

  /* A DEPTH JUMP IS NOT YET A LIP. verdant-1's instanced grass writes depth,
     and a blade tip against the hillside behind it is a metre-scale jump at a
     grazing angle: cp1 "found" 31 lips whose beyond samples sit on grass
     (frame `_shots/contrast/verdant-1_cp1_deck.png`) and scored 1.11 — grass
     against grass, the same fiction the old fog-band ruler told. A real lip
     puts real space between the last pixel of the surface and the first pixel
     past it, so the two are unprojected to WORLD points and the gap between
     them must clear `--edge-min-gap`. Sky always clears it. */
  const _wA = new THREE.Vector3(), _wB = new THREE.Vector3();
  const worldAt = (x, y, d, out) => {
    const nx = (x + 0.5) / w * 2 - 1;
    const ny = -((y + 0.5) / h * 2 - 1);
    return out.set(nx * tanHalf * aspect * d, ny * tanHalf * d, -d).applyMatrix4(cam.matrixWorld);
  };

  /* ...AND A GAP IS NOT YET A FALL. A rolling hill has silhouettes too: past a
     convex break the next VISIBLE ground is metres further and metres lower,
     which clears any purely optical test, and verdant-1 cp1 went on scoring
     1.25 on grass-over-grass with 23 such "lips". But a player cannot fall off
     a hill, and the readability law exists so a player can see WHERE THE
     PLATFORM ENDS — an edge with no fall behind it is not a jump decision and
     must not be gated as one.

     So the candidate is put to the game's own physics. `Broadphase.raycast`
     (CONTRACT §9 — boxes AND heightfields) probes the ground a short step
     PAST the lip, along the outward ground direction of the very ray that
     found it. Missing ground, or ground more than `edgeFallM` below over
     `edgeProbeM` of horizontal travel (a ~63 deg face, well past the
     `slope.slideDeg` 38 the controller still lets you walk), is a fall.
     Anything gentler is walkable ground and the scan carries on looking. */
  const _bp = (G_ && G_.course) ? G_.course.broadphase : null;
  const _ro = new THREE.Vector3(), _rdn = new THREE.Vector3(0, -1, 0);
  const _rout = {t: 0, normal: new THREE.Vector3(), collider: null, heightfield: null};
  const eProbe = o.edgeProbeM || 0.7, eFall = o.edgeFallM || 1.4;
  const isFall = (nx_, ny_, nz_, hx, hz) => {
    if (!_bp || typeof _bp.raycast !== 'function') return true;   /* no physics: do not invent one */
    for (let i = 1; i <= 2; i++) {
      const s = eProbe * i, drop = eFall * i;
      _ro.set(nx_ + hx * s, ny_ + 0.6, nz_ + hz * s);
      const hitOk = _bp.raycast(_ro, _rdn, 0.6 + drop, _rout);
      if (!hitOk) return true;                       /* nothing under the step: a void */
      if (ny_ - (_ro.y - _rout.t) >= drop) return true;
    }
    return false;
  };

  /* The walked plane, used ONLY to choose a start pixel that is really on the
     surface the hero stands on (a prop or the pad ring inside the deck box
     would otherwise seed the walk). */
  const _camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const _rd = new THREE.Vector3();
  const deckY = sy_;
  const planeDepthAt = (x, y) => {
    const nx = (x + 0.5) / w * 2 - 1, ny = -((y + 0.5) / h * 2 - 1);
    _rd.set(nx * tanHalf * aspect, ny * tanHalf, -1).transformDirection(cam.matrixWorld);
    if (_rd.y >= -1e-4) return Infinity;
    const t = (deckY - _camPos.y) / _rd.y;
    if (!(t > 0)) return Infinity;
    const vd = t * (_rd.x * _f.x + _rd.y * _f.y + _rd.z * _f.z);
    return vd > 0 ? vd : Infinity;
  };
  const startOk = (x, y) => {
    const d = depthAt(x, y);
    if (!(d > 0.5) || inHero(x, y)) return 0;
    const pd = planeDepthAt(x, y);
    if (!isFinite(pd)) return 0;
    return Math.abs(d - pd) <= Math.max(eStartTol, pd * 0.06) ? d : 0;
  };

  /* One scan line. (sx, sy) is a seed inside the deck's footprint; (dx, dy)
     is OUTWARD; the seed search walks INWARD for a pixel really on the
     surface. Returns null for "no measurable lip on this line". */
  const scanEdge = (sx, sy, dx, dy) => {
    let bx = sx, by = sy, d0 = 0;
    for (let t = 0; t < 14; t++) {
      const x = sx - dx * t, y = sy - dy * t;
      if (x < 0 || x >= w || y < 0 || y >= h) break;
      const d = startOk(x, y);
      if (d) { bx = x; by = y; d0 = d; break; }
    }
    if (!d0) return null;
    const at = (k) => [bx + dx * k, by + dy * k];

    let prev = d0, slope = 0, have = 0;
    let hit = -1, dNear = d0, dFar = 0;
    for (let k = 1; k <= eMaxWalk; k++) {
      const p = at(k);
      if (p[0] < 0 || p[0] >= w || p[1] < 0 || p[1] >= h) return null;
      if (inHero(p[0], p[1])) return null;               /* the hero is not a lip */
      const d = depthAt(p[0], p[1]);
      if (!(d > 0.5)) return null;
      const thr = Math.max(eJumpAbs, eJumpRel * prev);
      if (have >= 2) {
        const dPred = prev + slope;
        if (d - dPred > thr) {
          const q = at(k - 1);
          worldAt(q[0], q[1], prev, _wA);
          let ok = d > skyD;                          /* sky is always a gap */
          if (!ok) { worldAt(p[0], p[1], d, _wB); ok = _wA.distanceTo(_wB) >= eMinGap; }
          if (ok) {
            /* the outward GROUND direction of the ray that found the lip */
            const nx2 = (p[0] + 0.5) / w * 2 - 1, ny2 = -((p[1] + 0.5) / h * 2 - 1);
            _rd.set(nx2 * tanHalf * aspect, ny2 * tanHalf, -1).transformDirection(cam.matrixWorld);
            const hl = Math.hypot(_rd.x, _rd.z) || 1;
            if (isFall(_wA.x, _wA.y, _wA.z, _rd.x / hl, _rd.z / hl)) {
              hit = k; dNear = prev; dFar = d; break;
            }
          }
          /* a blade, a pebble, a seam, or a hillside that rolls away: not a
             lip. Carry on along the surface, re-seeding the slope beyond it. */
          slope = 0; have = 1; prev = d;
          if (prev > eMaxDepth) return null;
          continue;
        }
        if (dPred - d > thr) return {occluded: true};
      }
      worldAt(p[0], p[1], d, _wB);
      if (_wB.y > sy_ + eMaxRise) return {occluded: true}; /* a wall, not the deck */
      const s = d - prev;
      slope = have ? slope * 0.5 + s * 0.5 : s;
      have++;
      prev = d;
      if (prev > eMaxDepth) return null;                  /* too far to be a jump decision */
      if (slope > eMaxSlope * prev) return null;          /* too foreshortened to read */
    }
    if (hit < 0) return null;

    const near = [], beyond = [], lip = [];
    const nearTol = Math.max(0.35, dNear * 0.06);
    const farLo = dNear + Math.max(eJumpAbs, eJumpRel * dNear);
    for (let k = 0; k < eSpan; k++) {
      const p = at(hit - 1 - eGap - k);                    /* inward: still the surface */
      if (p[0] < 0 || p[0] >= w || p[1] < 0 || p[1] >= h) break;
      if (inHero(p[0], p[1])) continue;
      if (Math.abs(depthAt(p[0], p[1]) - dNear) <= nearTol) near.push(p);
    }
    for (let k = 0; k < eSpan; k++) {
      const p = at(hit + eGap + k);                        /* outward: past the lip */
      if (p[0] < 0 || p[0] >= w || p[1] < 0 || p[1] >= h) break;
      if (inHero(p[0], p[1])) continue;
      const d = depthAt(p[0], p[1]);
      if (d >= farLo || d > skyD) beyond.push(p);
    }
    for (let k = 0; k < eLip; k++) {
      const p = at(hit - 1 - k);                           /* the lip band itself */
      if (p[0] < 0 || p[0] >= w || p[1] < 0 || p[1] >= h) break;
      if (inHero(p[0], p[1])) continue;
      if (Math.abs(depthAt(p[0], p[1]) - dNear) <= nearTol) lip.push(p);
    }
    if (near.length < 2 || beyond.length < 2) return null;
    return {x: at(hit)[0], y: at(hit)[1], dNear: Math.round(dNear * 100) / 100,
            dFar: dFar > skyD ? null : Math.round(dFar * 100) / 100,
            sky: dFar > skyD, near, beyond, lip};
  };

  /* WHAT IS THE LIP MADE OF? A diagnostic, not a gate input. Two rounds of
     palette guesses (a light-rig sweep, then a `faceInject` sweep over every
     deck material) moved the failing stations by hundredths, because neither
     guess had ever asked the engine WHICH MATERIAL is on each side of the
     boundary. `--edge-names` raycasts the live scene through the first few
     lip points and prints the mesh + material names for the surface and for
     what lies beyond it, so a palette fix can be aimed instead of sprayed. */
  const nameAt = (x, y) => {
    if (!globalThis.__ccRay) globalThis.__ccRay = new THREE.Raycaster();
    const rc = globalThis.__ccRay;
    rc.setFromCamera(new THREE.Vector2((x + 0.5) / w * 2 - 1, -((y + 0.5) / h * 2 - 1)), cam);
    const hits = rc.intersectObjects(scene.children, true);
    for (const it of hits) {
      const ob = it.object;
      if (!ob || !ob.visible) continue;
      let m = ob.material;
      if (Array.isArray(m)) m = m[it.face && typeof it.face.materialIndex === 'number'
                                  ? it.face.materialIndex : 0] || m[0];
      /* the same rule the depth pass uses: a material that writes no depth is
         not an occluder, and a raycaster that stops on one reports the pad
         glow or a beam sprite instead of the deck (measured: every sample on
         ember-3 cp4 came back `Mesh:ShaderMaterial@8.8` on BOTH sides). */
      if (!m || m.depthWrite === false || m.depthTest === false) continue;
      const nm = (ob.name || ob.type || '?');
      const mn = (m && (m.name || m.type)) || '?';
      const col = (m && m.color) ? '#' + m.color.getHexString() : '';
      const em = (m && m.emissive && m.emissiveIntensity) ?
                 ('/em#' + m.emissive.getHexString() + 'x' + m.emissiveIntensity.toFixed(2)) : '';
      return nm + ':' + mn + (col ? '(' + col + ')' : '') + em + '@' + it.distance.toFixed(1);
    }
    return 'none';
  };

  const edges = [];
  let edgeLines = 0, edgeOccluded = 0, edgeNone = 0;
  const ebx0 = Math.max(0, Math.round(x0)), ebx1 = Math.min(w - 1, Math.round(x1));
  const eby0 = Math.max(0, Math.round(y0)), eby1 = Math.min(h - 1, Math.round(y1));
  const push = (r, side) => {
    if (!r) { edgeNone++; return; }
    if (r.occluded) { edgeOccluded++; return; }
    r.side = side; edges.push(r);
  };
  /* FAR lip: up the screen from the nearest deck row. */
  for (let x = ebx0; x <= ebx1; x += eStride) { edgeLines++; push(scanEdge(x, eby1, 0, -1), 'far'); }
  /* LATERAL lips: out from the deck's own mid column, both ways. */
  const emx = (ebx0 + ebx1) >> 1;
  for (let y = eby0; y <= eby1; y += eStride) {
    edgeLines += 2;
    push(scanEdge(emx, y, -1, 0), 'left');
    push(scanEdge(emx, y, 1, 0), 'right');
  }

  const fog = scene.fog;
  return {
    cands, scanned, rejectedNear: near_, rejectedHero: hero_, rejectedBadDepth: bad_, rawBad,
    deckKeep, deckOff,
    col: [cx0, cyTop, cx1, cyBot],
    deckBox: [x0, y0, x1, y1],
    near, far,
    deckDepthMeasured: deckSeen.length ? Math.round(deckSeen[deckSeen.length >> 1] * 100) / 100 : null,
    horizonY: Math.round(horizonY * 10) / 10, pitch: Math.round(pitch * 1000) / 1000,
    fogColor: fog ? '#' + fog.color.getHexString() : null,
    fogNear: (fog && fog.near !== undefined) ? fog.near : null,
    fogFar: (fog && fog.far !== undefined) ? fog.far : null,
    fogDensity: (fog && fog.density !== undefined) ? fog.density : null,
    fogType: fog ? fog.type || fog.constructor.name : null,
    hiddenForDepth: hidden.length,
    edges, edgeLines, edgeOccluded, edgeNone,
    edgeNames: o.edgeNames ? edges.slice(0, 40).filter((e, i) => i % 5 === 0).map(e => ({
      side: e.side, d: e.dNear, sky: !!e.sky,
      near: e.near.length ? nameAt(e.near[0][0], e.near[0][1]) : '-',
      beyond: e.beyond.length ? nameAt(e.beyond[0][0], e.beyond[0][1]) : '-',
      lip: e.lip.length ? nameAt(e.lip[0][0], e.lip[0][1]) : '-',
    })) : null,
    deckBoxPx: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
  };
}
"""


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
    if not n:
        return 0
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def band_median(px, w, h, x0, x1, y0, y1, step=2):
    """Median RGB over a screen rectangle, clamped to the frame."""
    x0 = max(0, int(x0)); x1 = min(w, int(x1))
    y0 = max(0, int(y0)); y1 = min(h, int(y1))
    rs, gs, bs = [], [], []
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            p = px[x, y]
            rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
    if not rs:
        return None, 0
    return (median(rs), median(gs), median(bs)), len(rs)


def frame_mean_luma(path):
    from PIL import Image, ImageStat
    return ImageStat.Stat(Image.open(path).convert("L")).mean[0]


def snap(pg, path):
    """Screenshot with the black-frame guard: a contention frame is evidence of
    nothing, so retake before believing it.

    The screenshot itself also gets an explicit, generous timeout and its own
    retry. HARNESS_NOTES already records that browser gates false-fail when
    several Chromes run at once; on a loaded box the headless swiftshader
    rasteriser cannot deliver a 1280x720 frame inside Playwright's 30 s default
    and the whole run dies on
        `playwright._impl._errors.TimeoutError: Page.screenshot: Timeout 30000ms exceeded`
    with no table printed. That is a harness fragility, not a contrast result —
    the 3.5:1 CONTRACT floor is untouched."""
    last = 0.0
    for _ in range(BLACK_RETRIES + 1):
        shot = False
        for a in range(3):
            try:
                pg.screenshot(path=path, timeout=180_000)
                shot = True
                break
            except Exception as e:
                print("  snap retry %d: %s" % (a + 1, str(e).splitlines()[0][:110]))
                pg.wait_for_timeout(2500)
        if not shot:
            return False, 0.0
        last = frame_mean_luma(path)
        if last >= LUMA_FLOOR:
            return True, last
        pg.wait_for_timeout(900)
    return False, last


def page_url(args):
    """REPEATABILITY. The gate used to load `?dev=1` and nothing else, so every
    run took whatever tier `detectQuality()` picked AND let the dynamic render
    scale controller move the resolution during the run — and `post.setSharpen`
    is a function of `renderScale`, so the same station's pixels differ between
    runs. Measured across two sweeps of a tree where only the Keep had changed:
    ember-4 cp1 2.52 -> 3.13, rime-2 cp2 4.23 -> 3.77, rime-3 cp4 3.40 -> 3.65
    (across the floor), on courses nothing had touched. Pinning the tier and
    freezing the scale is what makes a row evidence instead of a mood."""
    q = "?dev=1&autoscale=0"
    if args.quality:
        q += "&quality=" + args.quality
    return args.url + q


def leave_title(pg, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("keep", "playing"):
            return True
        if st == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def goto_course(pg, cid, timeout=90):
    try:
        pg.evaluate("async (id) => { const d = CRESTBOUND.game.__dev;"
                    " if (!d) throw new Error('__dev missing (?dev=1)'); await d.goto(id); }", cid)
    except Exception as e:
        return False, str(e)[:200]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if pg.evaluate("(id)=>!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId===id"
                           " && (CRESTBOUND.game.state==='playing'||CRESTBOUND.game.state==='keep'))", cid):
                return True, "ok"
        except Exception:
            pass
        try:
            if pg.evaluate(STATE_JS) in ("card", "cinematic", "title", "paused"):
                pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False, "never arrived"


def courses_on_disk(pg):
    ids = []
    try:
        ids = pg.evaluate(
            "async () => { const m = await import(new URL('runtime/data/index.js', location.href).href);"
            " return m.ALL_COURSE_IDS || []; }") or []
    except Exception:
        ids = []
    if not ids:
        d = os.path.join(ROOT, "runtime", "data", "courses")
        ids = sorted(f[:-3] for f in os.listdir(d)) if os.path.isdir(d) else []
    out = [c for c in ids
           if os.path.isfile(os.path.join(ROOT, "runtime", "data", "courses", c + ".js"))]
    if os.path.isfile(os.path.join(ROOT, "runtime", "data", "keep.js")):
        out = ["keep"] + out
    return out


def deck_median(px, w, h, samples, hero_box, patch=2):
    """Median RGB over the projected deck samples: a (2*patch+1)^2 pixel patch
    around every world sample that is on screen and OUTSIDE the hero's screen
    box. Returns (rgb, pixels used, samples used, samples rejected as hero)."""
    rs, gs, bs = [], [], []
    used = rejected = 0
    hx0, hx1 = hero_box.get("x0", -1e9), hero_box.get("x1", -1e9)
    hy0, hy1 = hero_box.get("y0", -1e9), hero_box.get("y1", -1e9)
    for sx, sy in samples:
        if not (0 <= sx < w and 0 <= sy < h):
            continue
        if hx0 <= sx <= hx1 and hy0 <= sy <= hy1:
            rejected += 1
            continue
        used += 1
        for y in range(max(0, sy - patch), min(h, sy + patch + 1)):
            for x in range(max(0, sx - patch), min(w, sx + patch + 1)):
                p = px[x, y]
                rs.append(p[0]); gs.append(p[1]); bs.append(p[2])
    if not rs:
        return None, 0, used, rejected
    return (median(rs), median(gs), median(bs)), len(rs), used, rejected


def pixel_median(px, w, h, pts):
    rs, gs, bs = [], [], []
    for pt in pts:
        x, y = int(pt[0]), int(pt[1])
        if not (0 <= x < w and 0 <= y < h):
            continue
        q = px[x, y]
        rs.append(q[0]); gs.append(q[1]); bs.append(q[2])
    if not rs:
        return None, 0
    return (median(rs), median(gs), median(bs)), len(rs)


def pctile(xs, q):
    """q in 0..1, linear interpolation. `xs` need not be sorted."""
    if not xs:
        return None
    v = sorted(xs)
    if len(v) == 1:
        return v[0]
    i = q * (len(v) - 1)
    lo = int(i)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def edge_readability(px, w, h, bg, args):
    """EDGE READABILITY — the boundary, not the backdrop.

    `bg['edges']` is one entry per scan line that found a silhouette lip: the
    pixels just INSIDE the walked surface (`near`), the pixels just OUTSIDE it
    (`beyond`), and the lip band where CONTRACT §17's `edgeStripe` lives
    (`lip`). All three are depth-verified in the browser; this function only
    reads their colour off the same frozen screenshot the deck ruler uses.

    Per scan line:
      step        = WCAG(deck just inside the lip, whatever is beyond it)
      lipVsBeyond = WCAG(the lip band's strongest excursion, beyond)
      lipVsDeck   = WCAG(that same excursion, the deck just inside) -- "is there
                    a drawn line at the lip at all", the presence test for §17
      cue         = max(step, lipVsBeyond) -- the strongest luminance boundary a
                    player's eye can land on at that point of the lip.

    BOTH ENDS OF THE LIP BAND COUNT. themes.js states the mechanism: "leading-
    edge stripes are flanked by near-black keylines (builders.js), so safeEdge
    reads as a DRAWN LINE on any deck value ... the keyline, not the luminance
    step, carries the separation at the lip." A ruler that only looked for the
    BRIGHT pixel would therefore miss half the drawn lines the art actually
    uses -- a dark keyline against a bright sea is exactly as legible as a
    bright stripe against a black void. So the lip band contributes its
    brightest AND its darkest pixel, and whichever separates further from what
    lies beyond is the one the eye would use.

    Station level: the MEDIAN cue over the scan lines (a player reads the whole
    lip, not one pixel of it) and the 20th percentile (its worst stretch)."""
    edges = (bg or {}).get("edges") or []
    lines = int((bg or {}).get("edgeLines") or 0)
    if not edges:
        return {"edgeLines": lines, "edgeFound": 0,
                "edgeOccluded": (bg or {}).get("edgeOccluded"),
                "edgeNone": (bg or {}).get("edgeNone")}
    steps, cues, lipD, lipB, sides, dists = [], [], [], [], {}, []
    sky = 0
    for e in edges:
        n_rgb, n_px = pixel_median(px, w, h, e.get("near") or [])
        b_rgb, b_px = pixel_median(px, w, h, e.get("beyond") or [])
        if n_rgb is None or b_rgb is None:
            continue
        ln, lb = luminance(n_rgb), luminance(b_rgb)
        st = contrast(ln, lb)
        hi = lo = None
        for pt in (e.get("lip") or []):
            x, y = int(pt[0]), int(pt[1])
            if not (0 <= x < w and 0 <= y < h):
                continue
            l = luminance(px[x, y])
            if hi is None or l > hi:
                hi = l
            if lo is None or l < lo:
                lo = l
        if hi is None:
            lvb, lvd = st, 1.0
        else:
            lvb = max(contrast(hi, lb), contrast(lo, lb))
            lvd = max(contrast(hi, ln), contrast(lo, ln))
        steps.append(st)
        lipB.append(lvb)
        lipD.append(lvd)
        cues.append(max(st, lvb))
        sides[e.get("side", "?")] = sides.get(e.get("side", "?"), 0) + 1
        if isinstance(e.get("dNear"), (int, float)):
            dists.append(e["dNear"])
        if e.get("sky"):
            sky += 1
    if not cues:
        return {"edgeLines": lines, "edgeFound": 0,
                "edgeOccluded": (bg or {}).get("edgeOccluded"),
                "edgeNone": (bg or {}).get("edgeNone")}
    striped = sum(1 for v in lipD if v >= args.stripe_floor)
    return {
        "edgeLines": lines, "edgeFound": len(cues),
        "edgeOccluded": (bg or {}).get("edgeOccluded"),
        "edgeNone": (bg or {}).get("edgeNone"),
        "edgeCue": round(median(cues), 2),
        "edgeCueP20": round(pctile(cues, 0.20), 2),
        "edgeCueMin": round(min(cues), 2),
        "edgeStep": round(median(steps), 2),
        "edgeStepP20": round(pctile(steps, 0.20), 2),
        "stripeVsDeck": round(median(lipD), 2),
        "stripeVsBeyond": round(median(lipB), 2),
        "stripeFrac": round(striped / float(len(lipD)), 2),
        "edgeSides": sides, "edgeSky": sky, "edgeNames": (bg or {}).get("edgeNames"),
        "edgeDepth": round(median(dists), 1) if dists else None,
        "edgeDepthMin": round(min(dists), 1) if dists else None,
        "edgeDepthMax": round(max(dists), 1) if dists else None,
    }


def background_band(px, w, h, cands, deck_depth, horizon_y, args):
    """THE FOG BAND. `cands` are [x, y, viewDepth, worldY] screen points in the
    sight column above the deck, already past the ENCLOSED depth margin. Two
    filters, then a ladder:

    DISTANCE — a pixel is background only if the world point behind it is at
    least `--min-behind` metres FROM THE STATION. World distance, not view
    depth: under a camera pitched down, the top of a wall four metres away has a
    smaller view depth than its foot, so a view-depth margin throws away an
    interior's whole background. This throws out the deck's own lip, the pad
    ring, a sign post and the fence rail.

    HORIZON — a pixel below the camera's horizon line is GROUND, however far
    away it is: a horizontal plane under the eye can never project above its own
    vanishing line. That is the exact, geometric form of the second failure the
    old ruler had — "walked snow measured against snow thirty metres away" —
    and no lighting or palette change can ever separate two views of one
    material, so counting them measures nothing. What survives is the sky, the
    fog, distant walls, buildings, hillsides and cliff faces: the fog band.

    Ladder (first rung with enough pixels wins; the rung is reported):
      far      — depth >= deck + --min-behind, at or above the horizon;
      enclosed — an interior with nothing that far away: relax the depth margin
                 to --min-behind-enclosed. The far wall of a cellar IS that
                 deck's background and the law still applies to it;
      ground   — no pixel above the horizon is in the sight column at all (the
                 camera is looking down a shaft or into a pit): drop the HORIZON
                 filter and say so in the row.
    """
    slack = args.horizon_slack
    rungs = (("far", args.min_behind, True),
             ("enclosed", args.min_behind_enclosed, True),
             ("ground", args.min_behind, False),
             ("ground-enclosed", args.min_behind_enclosed, False))
    for kind, margin, above_horizon in rungs:
        keep = [c for c in cands if c[3] >= margin]
        if above_horizon:
            keep = [c for c in keep if c[1] <= horizon_y + slack]
        if len(keep) < args.min_bg_samples:
            continue
        rgb, n = pixel_median(px, w, h, keep)
        if rgb is None:
            continue
        depths = [c[2] for c in keep]
        return {"kind": kind, "rgb": rgb, "pixels": n,
                "depthLo": round(min(depths), 1), "depthHi": round(max(depths), 1),
                "depthMed": round(median(depths), 1), "pool": len(keep),
                "pts": keep}
    return None


def measure(png, info, bg, args, crop_path=None):
    """Deck band (0.8-2.0 m AHEAD of the station, hero and pad ring rejected)
    vs the background actually behind it (depth-gated sight column)."""
    from PIL import Image
    im = Image.open(png).convert("RGB")
    w, h = im.size
    px = im.load()
    fx, fy = info["feet"]["x"], info["feet"]["y"]
    # the projected point can fall outside the frame on a steep camera
    if not (0 <= fx < w) or not (0 <= fy < h) or info["feet"].get("behind"):
        return {"status": "offscreen", "feet": [round(fx, 1), round(fy, 1)]}

    samples = info.get("samples") or []
    hero_box = info.get("heroBox") or {}
    if not isinstance(bg, dict) or bg.get("error"):
        return {"status": "no-depth", "detail": str((bg or {}).get("error", "depth pass failed"))[:80]}
    verified = bg.get("deckKeep") or []
    deck_src = verified if len(verified) >= args.min_samples else samples
    deck, npx, used, rejected = deck_median(px, w, h, deck_src, hero_box)
    if deck is None or used < args.min_samples:
        return {"status": "no-deck-pixels", "feet": [round(fx, 1), round(fy, 1)],
                "deckSamples": used, "heroRejected": rejected,
                "detail": "%d of %d samples usable (%d in hero box)" % (used, len(samples), rejected)}
    onscreen = [s for s in samples if 0 <= s[0] < w and 0 <= s[1] < h]
    sx0 = min(s[0] for s in onscreen); sx1 = max(s[0] for s in onscreen)
    sy0 = min(s[1] for s in onscreen); sy1 = max(s[1] for s in onscreen)

    deck_depth = float(info.get("deckDepth") or 0)
    band = background_band(px, w, h, bg.get("cands") or [], deck_depth,
                           float(bg.get("horizonY") or 0), args)
    if band is None:
        return {"status": "no-background",
                "detail": "%d of %d sight-column pixels are within %.1f m of the station"
                          % (bg.get("rejectedNear", 0), bg.get("scanned", 0), args.min_behind_enclosed),
                "deckRgb": [int(v) for v in deck], "deckDepth": round(deck_depth, 2)}

    ld, lf = luminance(deck), luminance(band["rgb"])
    edge = edge_readability(px, w, h, bg, args)

    # INFO ONLY: the pre-2026-09-08 ruler, a fixed strip at 55 % height on the
    # far side of the frame. Kept so the two numbers can be compared in one
    # table; it is not a pass condition.
    fog_y0 = int(h * (args.fog_at - 0.02))
    fog_y1 = int(h * (args.fog_at + 0.02))
    strip = max(24, int(w * 0.14))
    if fx > w * 0.5:
        old, on_ = band_median(px, w, h, 0, strip, fog_y0, fog_y1)
    else:
        old, on_ = band_median(px, w, h, w - strip, w, fog_y0, fog_y1)

    if crop_path:
        try:
            from PIL import ImageDraw
            dbg = im.copy()
            d = ImageDraw.Draw(dbg)
            hb = hero_box
            if hb:
                d.rectangle([hb["x0"], hb["y0"], hb["x1"], hb["y1"]], outline=(255, 0, 0))
            col = bg.get("col")
            if col:
                d.rectangle([col[0], col[1], col[2], col[3]], outline=(80, 160, 255))
            for pt in band["pts"][::7]:
                d.point((pt[0], pt[1]), fill=(0, 200, 255))
            for sx, sy in onscreen:
                inside = hb and hb["x0"] <= sx <= hb["x1"] and hb["y0"] <= sy <= hb["y1"]
                d.rectangle([sx - 1, sy - 1, sx + 1, sy + 1],
                            outline=(255, 0, 0) if inside else (0, 255, 0))
            for e in (bg.get("edges") or []):
                d.point((e["x"], e["y"]), fill=(255, 0, 255))
                for pt in (e.get("beyond") or []):
                    d.point((pt[0], pt[1]), fill=(255, 220, 0))
            dbg.save(crop_path)
        except Exception:
            pass
    return {
        "status": "ok",
        "deckRgb": [int(v) for v in deck], "fogRgb": [int(v) for v in band["rgb"]],
        "deckLum": round(ld, 4), "fogLum": round(lf, 4),
        "ratio": round(contrast(ld, lf), 2),
        "bgKind": band["kind"], "bgPixels": band["pixels"], "bgPool": band["pool"],
        "bgDepth": [band["depthLo"], band["depthMed"], band["depthHi"]],
        "deckDepth": round(deck_depth, 2),
        "deckDepthMeasured": bg.get("deckDepthMeasured"),
        "sightColumn": bg.get("col"), "sightScanned": bg.get("scanned"),
        "sightRejectedNear": bg.get("rejectedNear"),
        "sightBadDepth": bg.get("rejectedBadDepth"), "rawBad": bg.get("rawBad"),
        "frozen": info.get("frozen"),
        "stripRgb": [int(v) for v in old] if old else None,
        "stripRatio": round(contrast(ld, luminance(old)), 2) if old else None,
        "deckPixels": npx, "deckSamples": used, "heroRejected": rejected,
        "deckVerified": len(verified), "deckOffSurface": bg.get("deckOff"),
        "deckWindow": [int(sx0), int(sy0), int(sx1), int(sy1)],
        "feet": [round(fx, 1), round(fy, 1)],
        **edge,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND contrast check")
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--quality", default="low",
                    help="tier pinned via ?quality= (default low, the tier the perf gate ships)")
    ap.add_argument("--courses", default="", help="comma list; default = every course on disk")
    ap.add_argument("--floor", type=float, default=FLOOR)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--ahead-from", type=float, default=0.8,
                    help="near edge of the deck band, metres AHEAD of the station along its yaw")
    ap.add_argument("--ahead-to", type=float, default=2.0,
                    help="far edge of the deck band, metres ahead")
    ap.add_argument("--band-half-width", type=float, default=1.6,
                    help="lateral half-width of the deck band, metres")
    ap.add_argument("--min-samples", type=int, default=20,
                    help="fewest usable deck samples (of 91) before the station is NO SAMPLE")
    ap.add_argument("--fog-at", type=float, default=0.55,
                    help="INFO strip centre as a fraction of frame height (the old ruler)")
    ap.add_argument("--min-behind", type=float, default=3.5,
                    help="world metres a pixel must be FROM THE STATION to count as background")
    ap.add_argument("--min-behind-enclosed", type=float, default=2.0,
                    help="relaxed radius for an interior station with nothing that far behind it")
    ap.add_argument("--deck-tol", type=float, default=0.35,
                    help="metres a deck sample's measured depth may differ from its projected"
                         " depth before it is judged not to be on the walked surface")
    ap.add_argument("--horizon-slack", type=float, default=8.0,
                    help="pixels below the horizon line still counted as the fog band")
    ap.add_argument("--min-bg-samples", type=int, default=60,
                    help="fewest background pixels before the ladder relaxes")
    ap.add_argument("--col-pad", type=float, default=0.25,
                    help="sight column widening either side of the deck, as a fraction of its width")
    ap.add_argument("--col-pad-px", type=float, default=40,
                    help="minimum sight column widening in pixels")
    ap.add_argument("--bg-step", type=int, default=4,
                    help="sight column scan step in pixels")
    ap.add_argument("--law", default="edge", choices=("edge", "deck", "both"),
                    help="which measurement GATES (CONTRACT §15). 'edge' = the silhouette-lip"
                         " cue, the shipped law since 2026-09-08; 'deck' = the old"
                         " deck-vs-fog-band ratio; 'both' = a station must clear both.")
    ap.add_argument("--edge-floor", type=float, default=3.0,
                    help="minimum MEDIAN edge cue over a station's scan lines")
    ap.add_argument("--edge-floor-p20", type=float, default=1.6,
                    help="minimum 20th-percentile edge cue (the lip's worst stretch)")
    ap.add_argument("--stripe-floor", type=float, default=1.5,
                    help="lip-vs-deck ratio above which a scan line counts as STRIPED")
    ap.add_argument("--edge-stride", type=int, default=4,
                    help="pixels between silhouette scan lines")
    ap.add_argument("--edge-gap", type=int, default=1,
                    help="anti-alias guard pixels skipped on each side of the lip")
    ap.add_argument("--edge-span", type=int, default=6,
                    help="pixels sampled either side of the lip")
    ap.add_argument("--edge-lip", type=int, default=10,
                    help="pixels inside the lip searched for a leading-edge stripe")
    ap.add_argument("--edge-jump-abs", type=float, default=0.4,
                    help="metres of per-pixel view-depth jump that can start a silhouette edge")
    ap.add_argument("--edge-jump-rel", type=float, default=0.06,
                    help="...or this fraction of the current depth, whichever is larger")
    ap.add_argument("--edge-max-slope-frac", type=float, default=0.25,
                    help="stop a scan line once one pixel spans this fraction of the"
                         " surface's distance: ground that foreshortened has no readable lip")
    ap.add_argument("--edge-start-tol", type=float, default=0.6,
                    help="metres a seed pixel may differ from the walked plane's own depth")
    ap.add_argument("--edge-probe-m", type=float, default=0.7,
                    help="horizontal metres past the lip the ground probe steps")
    ap.add_argument("--edge-fall-m", type=float, default=1.4,
                    help="metres the ground must be missing or below over that step for the"
                         " lip to be a FALL (0.7/1.4 = a ~63 deg face)")
    ap.add_argument("--edge-max-rise", type=float, default=1.0,
                    help="metres a tracked surface may climb above the station before the"
                         " scan line calls it a wall rather than the walked deck")
    ap.add_argument("--edge-min-gap", type=float, default=1.5,
                    help="world metres between the last surface pixel and the first pixel"
                         " past it before the jump counts as a lip (sky always counts)")
    ap.add_argument("--edge-max-depth", type=float, default=60.0,
                    help="stop a scan line once the walked plane is this far away: a lip"
                         " beyond it is not a jump decision")
    ap.add_argument("--edge-max-walk", type=int, default=600,
                    help="pixels a scan line walks before giving up on finding a lip")
    ap.add_argument("--min-edge-lines", type=int, default=8,
                    help="fewest scan lines with a measurable lip before the station is"
                         " NO EDGE (neither pass nor fail)")
    ap.add_argument("--edge-names", action="store_true",
                    help="raycast the live scene through a sample of lips and print what"
                         " material is on each side (diagnostic; costs a raycast per sample)")
    ap.add_argument("--save-crops", action="store_true")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "contrastcheck.json"))
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)
    results, pageerrs = {}, []

    with sync_playwright() as p:
        if args.headless:
            # HARNESS_NOTES (measured on this box): headless *Chrome* with the
            # d3d11 flags gets the real Intel UHD GPU; only the bundled Chromium
            # needs SwiftShader, which is a CPU rasteriser -- an order of
            # magnitude slower and a different tone response. Try the GPU first
            # and keep SwiftShader as the documented fallback (perfcheck.py has
            # done this since the perf pass; the other gates had not caught up).
            try:
                br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            except Exception as _e:
                print("headless: no hardware Chrome (%s) -> SwiftShader" % str(_e)[:120],
                      file=sys.stderr)
                br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        try:
            pg.goto(page_url(args), wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        deadline, ready = time.time() + 70, False
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ready or not leave_title(pg):
            print("CONTRAST CHECK: the game never reached a live state", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        courses = ([c.strip() for c in args.courses.split(",") if c.strip()]
                   if args.courses else courses_on_disk(pg))
        if not courses:
            print("CONTRAST CHECK: no course data on disk", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        for cid in courses:
            arrived, why = goto_course(pg, cid)
            if not arrived:
                results[cid] = {"error": why}
                continue
            pg.wait_for_timeout(900)
            try:
                meta = pg.evaluate(STATIONS_JS)
            except Exception as e:
                results[cid] = {"error": str(e)[:200]}
                continue
            if not isinstance(meta, dict) or meta.get("error"):
                results[cid] = {"error": (meta or {}).get("error", "no stations")}
                continue

            rows = []
            for st in meta.get("stations", []):
                st["aheadFrom"] = args.ahead_from
                st["aheadTo"] = args.ahead_to
                st["halfWidth"] = args.band_half_width
                try:
                    info = pg.evaluate(POSE_JS, st)
                except Exception as e:
                    rows.append({"station": st["name"], "gates": st["gates"],
                                 "status": "pose-failed", "detail": str(e)[:160]})
                    continue
                if not isinstance(info, dict) or info.get("error"):
                    rows.append({"station": st["name"], "gates": st["gates"],
                                 "status": "pose-failed",
                                 "detail": (info or {}).get("error", "?")})
                    continue
                png = os.path.join(SHOTS, "%s_%s.png" % (cid, st["name"]))
                # The world, and only the world: HUD, dev panel and toasts are
                # DOM and would otherwise land in a median.
                try:
                    pg.evaluate(MUTE_JS)
                except Exception:
                    pass
                bright, luma = snap(pg, png)
                try:
                    bg = pg.evaluate(BG_JS, {
                        "deckSamples": info["samples"], "deckDepth": info["deckDepth"],
                        "heroBox": info["heroBox"], "w": info["w"], "h": info["h"],
                        "minBehind": args.min_behind_enclosed, "step": args.bg_step,
                        "station": st["p"], "deckDepths": info.get("sampleDepths"),
                        "deckTol": args.deck_tol,
                        "colPad": args.col_pad, "colPadPx": args.col_pad_px,
                        "edgeStride": args.edge_stride, "edgeGap": args.edge_gap,
                        "edgeSpan": args.edge_span, "edgeLip": args.edge_lip,
                        "edgeJumpAbs": args.edge_jump_abs, "edgeJumpRel": args.edge_jump_rel,
                        "edgeMaxSlopeFrac": args.edge_max_slope_frac,
                        "edgeStartTol": args.edge_start_tol,
                        "edgeMinGap": args.edge_min_gap,
                        "edgeProbeM": args.edge_probe_m, "edgeFallM": args.edge_fall_m,
                        "edgeMaxRise": args.edge_max_rise,
                        "edgeNames": bool(args.edge_names),
                        "edgeMaxDepth": args.edge_max_depth,
                        "edgeMaxWalk": args.edge_max_walk})
                except Exception as e:
                    bg = {"error": str(e)[:160]}
                for js in (UNMUTE_JS, RESUME_JS):
                    try:
                        pg.evaluate(js)
                    except Exception:
                        pass
                if not bright:
                    rows.append({"station": st["name"], "gates": st["gates"],
                                 "status": "unmeasurable",
                                 "detail": "frame luma %.2f < %.1f on %d captures"
                                           % (luma, LUMA_FLOOR, BLACK_RETRIES + 1)})
                    continue
                crop = (os.path.join(SHOTS, "%s_%s_deck.png" % (cid, st["name"]))
                        if args.save_crops else None)
                m = measure(png, info, bg, args, crop)
                m["station"] = st["name"]
                m["gates"] = st["gates"]
                m["shot"] = png
                m["surface"] = info.get("surface")
                m["fogColor"] = info.get("fog")
                rows.append(m)
            results[cid] = {"theme": meta.get("theme"), "name": meta.get("name"), "rows": rows}
        br.close()

    print("=" * 118)
    print("CRESTBOUND readability gate — gating law: %s (edge floor %.1f median / %.1f p20, "
          "deck floor %.1f:1)" % (args.law.upper(), args.edge_floor, args.edge_floor_p20,
                                  args.floor))
    print("-" * 118)
    print("%-11s %-7s %-7s %7s %6s %6s %6s %6s %5s %5s  %s"
          % ("course", "theme", "station", "deck:bg", "edge", "p20", "step", "stripe",
             "str%", "lines", "verdict"))
    print("-" * 118)
    fails = unmeasured = 0
    xt = {"both": [], "edge-only": [], "deck-only": [], "neither": []}
    for cid, r in results.items():
        if r.get("error"):
            print("%-11s ERROR: %s" % (cid, str(r["error"])[:70]))
            fails += 1
            continue
        theme = r.get("theme") or "?"
        for row in r.get("rows", []):
            if row.get("status") != "ok":
                soft = row.get("status") in ("unmeasurable", "no-background", "no-depth")
                mark = {"unmeasurable": "UNMEASURABLE", "no-background": "NO BACKGROUND",
                        "no-depth": "NO DEPTH"}.get(row.get("status"), "NO SAMPLE")
                if soft:
                    unmeasured += 1
                elif row.get("gates"):
                    fails += 1
                print("%-11s %-7s %-7s %7s  %s (%s)"
                      % (cid, theme, row.get("station"), "-", mark,
                         str(row.get("detail") or row.get("status"))[:60]))
                continue
            gates = row.get("gates")
            deck_ok = row["ratio"] >= args.floor
            n_lines = int(row.get("edgeFound") or 0)
            has_edge = n_lines >= args.min_edge_lines
            edge_ok = (has_edge
                       and (row.get("edgeCue") or 0) >= args.edge_floor
                       and (row.get("edgeCueP20") or 0) >= args.edge_floor_p20)
            row["deckPass"] = deck_ok
            row["edgePass"] = edge_ok if has_edge else None
            if gates and has_edge:
                key = ("both" if (deck_ok and edge_ok) else
                       "edge-only" if edge_ok else
                       "deck-only" if deck_ok else "neither")
                xt[key].append("%s/%s" % (cid, row.get("station")))
            if args.law == "deck":
                ok = deck_ok
            elif args.law == "both":
                ok = deck_ok and (edge_ok or not has_edge)
            else:
                ok = edge_ok if has_edge else True
            if not has_edge and args.law != "deck":
                verdict = "NO EDGE (%d lines, %d occluded) — not gated" % (
                    n_lines, row.get("edgeOccluded") or 0)
                if gates:
                    unmeasured += 1
            else:
                if not ok and gates:
                    fails += 1
                verdict = "ok" if ok else ("FAIL" if gates else "low (spawn, not gated)")
            print("%-11s %-7s %-7s %6.2f:1 %6s %6s %6s %6s %5s %5d  %s"
                  % (cid, theme, row.get("station"), row["ratio"],
                     row.get("edgeCue", "-"), row.get("edgeCueP20", "-"),
                     row.get("edgeStep", "-"), row.get("stripeVsDeck", "-"),
                     row.get("stripeFrac", "-"), n_lines, verdict))
            for nm in (row.get("edgeNames") or []):
                print("      lip %-5s %5.1f m  surface %-46s beyond %-46s lip %s"
                      % (nm.get("side"), nm.get("d") or 0, str(nm.get("near"))[:46],
                         ("SKY" if nm.get("sky") else str(nm.get("beyond"))[:46]),
                         str(nm.get("lip"))[:46]))
    print("-" * 118)
    print("edge   = MEDIAN edge cue over the station's silhouette scan lines: per line,")
    print("         max(deck-just-inside vs beyond, brightest lip pixel vs beyond).")
    print("p20    = the same cue at the 20th percentile — the lip's worst stretch.")
    print("step   = median deck-vs-beyond alone (no stripe credit).")
    print("stripe = median lip-vs-deck (CONTRACT §17 leading-edge stripe presence);")
    print("         str%% = fraction of scan lines whose stripe clears %.1f." % args.stripe_floor)
    print("deck:bg = the 2026-09-08 fog-band ruler, retained as a REPORTED signal.")
    print("-" * 118)
    print("CROSS-TAB (gated stations with a measurable lip) — deck-vs-fog-band %.1f:1 "
          "x edge %.1f/%.1f" % (args.floor, args.edge_floor, args.edge_floor_p20))
    print("  pass both          : %3d" % len(xt["both"]))
    print("  edge only (deck X) : %3d   %s" % (len(xt["edge-only"]), ", ".join(xt["edge-only"])))
    print("  deck only (edge X) : %3d   %s" % (len(xt["deck-only"]), ", ".join(xt["deck-only"])))
    print("  fail both          : %3d   %s" % (len(xt["neither"]), ", ".join(xt["neither"])))
    print("-" * 118)
    print("shots in %s" % os.path.abspath(SHOTS))
    if unmeasured:
        print("%d station(s) UNMEASURABLE / NO EDGE — neither pass nor fail" % unmeasured)
    if pageerrs:
        print("page errors (%d):" % len(pageerrs))
        for e in pageerrs[:8]:
            print("  !! %s" % str(e)[:250])
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"floor": args.floor, "law": args.law,
                           "edgeFloor": args.edge_floor, "edgeFloorP20": args.edge_floor_p20,
                           "crosstab": xt, "results": results, "pageErrors": pageerrs},
                          f, indent=2)
        except Exception:
            pass
    print("VERDICT: %s (%d failing checkpoint stations under the %s law)"
          % ("READABLE" if fails == 0 else "UNREADABLE", fails, args.law.upper()))
    print("RESULT: %s" % ("OK" if fails == 0 else "FAIL"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
