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
  const A = globalThis.CRESTBOUND, E = A.engine, THREE = A.THREE;
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
                        "colPad": args.col_pad, "colPadPx": args.col_pad_px})
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

    print("=" * 96)
    print("CRESTBOUND contrast check — walked surface vs the fog band, floor %.1f:1" % args.floor)
    print("-" * 96)
    print("%-12s %-8s %-7s %-16s %-16s %7s %-9s %-13s %6s  %s"
          % ("course", "theme", "station", "deck rgb", "background rgb", "ratio",
             "bg", "bg depth m", "strip", "verdict"))
    print("-" * 96)
    fails = unmeasured = 0
    for cid, r in results.items():
        if r.get("error"):
            print("%-12s ERROR: %s" % (cid, str(r["error"])[:70]))
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
                print("%-12s %-8s %-7s %-16s %-16s %7s  %s (%s)"
                      % (cid, theme, row.get("station"), "-", "-", "-", mark,
                         str(row.get("detail") or row.get("status"))[:56]))
                continue
            ok = row["ratio"] >= args.floor
            gates = row.get("gates")
            if not ok and gates:
                fails += 1
            verdict = "ok" if ok else ("FAIL" if gates else "low (spawn, not gated)")
            d = row.get("bgDepth") or [0, 0, 0]
            print("%-12s %-8s %-7s %-16s %-16s %5.2f:1 %-9s %5.0f-%-7.0f %6s  %s"
                  % (cid, theme, row.get("station"), str(row["deckRgb"]), str(row["fogRgb"]),
                     row["ratio"], row.get("bgKind", "?"), d[0], d[2],
                     ("%.2f" % row["stripRatio"]) if row.get("stripRatio") else "-",
                     verdict))
    print("-" * 96)
    print("`strip` is the PRE-2026-09-08 ruler (a fixed 14 %-wide band at 55 % frame "
          "height on the far\nside of the frame). It is printed for comparison only and "
          "gates nothing.")
    print("shots in %s" % os.path.abspath(SHOTS))
    if unmeasured:
        print("%d station(s) UNMEASURABLE (contention frames) — neither pass nor fail" % unmeasured)
    if pageerrs:
        print("page errors (%d):" % len(pageerrs))
        for e in pageerrs[:8]:
            print("  !! %s" % str(e)[:250])
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"floor": args.floor, "results": results, "pageErrors": pageerrs},
                          f, indent=2)
        except Exception:
            pass
    print("VERDICT: %s (%d failing checkpoint stations)"
          % ("READABLE" if fails == 0 else "UNREADABLE", fails))
    print("RESULT: %s" % ("OK" if fails == 0 else "FAIL"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
