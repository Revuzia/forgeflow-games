// core/render/reflect.js [A6] — LD §5.4 planar reflection + R18 baked cube.
// BOOT SEAM (A0, changelog v2.1b): createReflect(ctx) export name frozen;
// boot constructs it and calls update(dt) each frame.
//
// PLANAR (the single most AAA-selling pixel investment on the map):
//   one mirrored render of the plaza set into a 512 px HalfFloat target,
//   every 2nd frame, REFLECT_LAYER (3) mask only (sky dome/clouds/rings +
//   neon glows are layer-3-enabled by sky.js/lighting.js; plaza-area meshes
//   and soldier bodies are auto-enrolled here by a cheap periodic traversal
//   against the plaza bounds — ~40 draws budgeted inside the 320 gate).
//   AUTO-OFF: quality preset planarReflection:false (low), setEnabled(false),
//   dynres at floor (globalThis.__BR_DYNRES__ — perf guard, LD §5.4), or the
//   camera far from the plaza. When off, `active` goes false and consumers
//   fall back to the baked cube envMap (same scene, blurrier — no pop).
//
// CONSUMER CONTRACT (A3 materials — flagged in needsElsewhere): the plaza
// ground/puddle material samples:
//   globalThis.__BR_REFLECT__ = { texture, textureMatrix, active, envCube }
//   uv = (textureMatrix * vec4(worldPos, 1.0)) → texture2DProj — blend into
//   the 3 hero puddle masks, distorted by the ripple normal; envCube is the
//   R18 once-baked plaza cube for puddle fallback + car/window glints.
//   (HDRIs are NOT shipped — the baked cube IS the scene, R18.)
//
// Reflection math ported from three's examples Reflector.js (mirrored rigid
// camera + oblique near-plane clip), not imported — the example class drags a
// mesh+material we don't want.

import * as THREE from "three";

export const REFLECT_LAYER = 3;

const PLAZA_CENTER = new THREE.Vector3(-5, 0, 2);
const PLAZA_BOX = { minX: -27, maxX: 17, minZ: -20, maxZ: 20, maxY: 12 };
const PLANE_Y = 0.02;          // hero-puddle water surface
const NEAR_GATE = 55;          // planar pass only when the camera can see plaza puddles
const REFRESH_FRAMES = 90;     // layer-membership traversal cadence

// ---- LANE V2 (2026-08-24) — the mirror only runs when its payoff can be on
// screen. Measured with EXT_disjoint_timer_query_webgl2 (interleaved even/odd
// whole-frame split, mirror runs every 2nd frame): the mirror pass costs
// 4.7-5.1 ms per mirror frame on the boulevard (~2.4 ms/frame amortised),
// 3.3-3.7 ms at the plaza — and the old distance-only NEAR_GATE (55 m) keeps
// it running through the whole perf-traversal sprint down the boulevard, where
// the three hero puddles it feeds are 60-65 deg off the view axis and OUTSIDE
// the frustum entirely. A frustum + projected-screen-area test on the hero
// puddle discs skips exactly the frames where no planar pixel can appear.
// When skipped, `active` goes false and consumers fall back to the baked cube
// envMap — the SAME designed no-pop fallback the quality preset and the dynres
// floor already use. The 0.5 s linger stops flip-flicker on a fast pan; the
// +2 m sphere margin makes the gate flip before a puddle can enter the view.
const GATE_MARGIN = 2.0;       // m added to each hero disc for the frustum test
const GATE_MIN_FRAC = 0.0015;  // min summed projected area, fraction of screen
const GATE_LINGER_S = 0.5;     // keep the mirror alive this long after visible

export function createReflect(ctx) {
  const { renderer, scene, camera } = ctx;

  // A3's GROUND_HOOKS handle. Declared HERE, not next to its assignment below,
  // because renderPlanar() reads it and is called once during construction to
  // warm the RT-variant programs — a `let` further down would put it in the
  // temporal dead zone for that first call.
  let hooks = null;

  // ------------------------------------------------------------ render target
  const rt = new THREE.WebGLRenderTarget(512, 512, {
    type: THREE.HalfFloatType, // matches the post HDR chain (prewarm covers it)
    depthBuffer: true,
  });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;

  const virtualCamera = new THREE.PerspectiveCamera();
  const textureMatrix = new THREE.Matrix4();

  // scratch (zero per-frame allocation)
  const reflectorPlane = new THREE.Plane();
  const normal = new THREE.Vector3(0, 1, 0);
  const reflectorWorldPosition = new THREE.Vector3(PLAZA_CENTER.x, PLANE_Y, PLAZA_CENTER.z);
  const cameraWorldPosition = new THREE.Vector3();
  const rotationMatrix = new THREE.Matrix4();
  const lookAtPosition = new THREE.Vector3();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const clipPlane = new THREE.Vector4();
  const q = new THREE.Vector4();
  const _v = new THREE.Vector3();

  function renderPlanar() {
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(reflectorWorldPosition, cameraWorldPosition);
    if (view.dot(normal) > 0) return false; // camera below the water plane

    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    lookAtPosition.set(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraWorldPosition);
    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
    virtualCamera.lookAt(target);
    virtualCamera.near = camera.near;
    virtualCamera.far = camera.far;
    virtualCamera.fov = camera.fov;
    virtualCamera.aspect = camera.aspect;
    virtualCamera.updateProjectionMatrix();
    virtualCamera.updateMatrixWorld();

    textureMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);

    // oblique near-plane clip at the water plane (Reflector.js verbatim math)
    reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);
    clipPlane.set(reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant);
    const pm = virtualCamera.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    pm.elements[2] = clipPlane.x;
    pm.elements[6] = clipPlane.y;
    pm.elements[10] = clipPlane.z + 1.0 - 0.003; // clipBias
    pm.elements[14] = clipPlane.w;

    virtualCamera.layers.set(REFLECT_LAYER);

    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false; // don't re-render the moon map for the mirror
    // The ground materials sample rt.texture through GROUND_HOOKS.planarTex,
    // and the ground is itself on REFLECT_LAYER — so rendering INTO rt with
    // that sampler still bound is a framebuffer/texture feedback loop. Chrome
    // logs GL_INVALID_OPERATION and drops the draw, ~14 per battery run since
    // iter03. Zeroing the strength for the duration takes the ground down the
    // untextured branch (the `if` in materials.js is on uPlanarStrength) and
    // costs nothing: the mirror pass must not see last frame's mirror anyway.
    const prevPlanar = hooks ? hooks.planarStrength.value : 0;
    if (hooks) hooks.planarStrength.value = 0;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, virtualCamera);
    if (hooks) hooks.planarStrength.value = prevPlanar;
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.xr.enabled = prevXr;
    return true;
  }

  // -------------------------------------------------- layer auto-enrolment
  // Plaza-visible meshes join REFLECT_LAYER. sky.js/lighting.js pre-enable
  // their own objects (userData.br_sky, glow/cone instances); this traversal
  // catches A3's plaza geometry and A8's soldiers when they land — no
  // cross-lane file edit needed, ~40 draws budgeted.
  let enrolled = 0;
  // LANE P1 (2026-08-24) — a mesh whose material SAMPLES the planar target
  // (the a3 `puddle` grounds read GROUND_HOOKS.planarTex = rt.texture) must
  // never be enrolled in the mirror pass: drawing it INTO rt while rt.texture
  // is bound as its sampler is a framebuffer/texture feedback loop. The
  // planarStrength-zeroing in renderPlanar() takes the SHADER down the cheap
  // branch but GL validates the BINDING, not the branch — Chrome still logged
  // GL_INVALID_OPERATION "Feedback loop formed" ~250x/run and dropped the
  // draw. Ground in the mirror is also the mirror's single largest surface
  // cost, for a payoff that cannot be seen (a horizontal plane mirrored
  // across a plane 2 cm above itself). Excluding it kills the warnings and
  // the cost; puddles keep reflecting buildings/signs/sky (A2), which are
  // the layer's remaining members.
  function samplesPlanar(o) {
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (m && m.userData && m.userData.a3 && m.userData.a3.puddle) return true;
    }
    return false;
  }
  function refreshMembership() {
    enrolled = 0;
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      if (o.userData && o.userData.br_sky) { enrolled++; return; } // already on
      if (o.userData && o.userData.noReflect) {                    // opt-out hook
        o.layers.disable(REFLECT_LAYER);
        return;
      }
      if (o.isMesh && samplesPlanar(o)) {   // planar consumers: see note above
        o.userData.noReflect = true;
        o.layers.disable(REFLECT_LAYER);
        return;
      }
      _v.setFromMatrixPosition(o.matrixWorld);
      const inPlaza =
        _v.x > PLAZA_BOX.minX && _v.x < PLAZA_BOX.maxX &&
        _v.z > PLAZA_BOX.minZ && _v.z < PLAZA_BOX.maxZ &&
        _v.y < PLAZA_BOX.maxY;
      if (inPlaza && !(o.geometry && o.geometry.isInstancedBufferGeometry)) {
        o.layers.enable(REFLECT_LAYER);
        enrolled++;
      } else if (!inPlaza && o.layers.isEnabled && o.layers.isEnabled(REFLECT_LAYER) === true &&
                 !(o.userData && o.userData.br_sky)) {
        // moved out of the plaza (soldiers) — drop from the mirror pass
        o.layers.disable(REFLECT_LAYER);
      }
    });
  }

  // ------------------------------------------------------------ R18 cube bake
  // Baked ONCE at load from plaza centre — feeds puddle fallback + car/window
  // glints (A3 consumes). The scene at construction time already holds the
  // level + props groups (boot phase 3 order); soldiers stream later and are
  // deliberately not in the static env.
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(0.3, 600, cubeRT);
  cubeCam.position.set(PLAZA_CENTER.x, 1.6, PLAZA_CENTER.z);
  let cubeBaked = false;
  let envPMREM = null;
  let envPMREMRT = null;
  function bakeCube() {
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      scene.add(cubeCam);
      cubeCam.update(renderer, scene);
      scene.remove(cubeCam);
      cubeBaked = true;
      // The scene-wide IBL: PMREM of THIS baked cube (neon wall, sodium
      // heads, lit windows — the bright sources). sky.js's dome-only PMREM
      // has no practicals in it, so wet ground could only ever reflect dark
      // sky — "wetness only darkens" is a D4 hard cap (VT §4). Constructed
      // pre-prewarm so the program fork is inside the baseline.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromCubemap(cubeRT.texture);
      pmrem.dispose();
      if (envPMREMRT) envPMREMRT.dispose();
      envPMREMRT = rt;
      envPMREM = rt.texture;
      scene.environment = envPMREM;
      if ("environmentIntensity" in scene) scene.environmentIntensity = 0.5;
      if (globalThis.__BR_REFLECT__) globalThis.__BR_REFLECT__.envPMREM = envPMREM;
    } catch (e) {
      console.warn("[reflect] cube bake failed:", e && e.message);
    }
    renderer.shadowMap.autoUpdate = prevShadow;
  }
  bakeCube(); // compile cube-target program variants BEFORE the prewarm baseline

  // one warm planar render so the RT-variant programs exist pre-baseline too
  refreshMembership();
  renderPlanar();

  // ---------------------------------------------------------------- control
  let enabled = true;   // setEnabled()
  let qualityOn = true; // settings preset
  function applyQuality(qname) {
    // dual-instance-safe import of the const table is avoided here: the
    // preset bool is mirrored from weather's import via a tiny local map.
    qualityOn = qname !== "low";
  }
  applyQuality(ctx.settings.quality);
  ctx.onChange("quality", applyQuality);

  let frameFlip = 0;
  let framesSinceRefresh = 0;

  const published = {
    texture: rt.texture,
    textureMatrix,
    active: false,
    envCube: cubeRT.texture,
    envPMREM,
    layer: REFLECT_LAYER,
  };
  globalThis.__BR_REFLECT__ = published;

  // ---- A3 GROUND_HOOKS feed (the consumer contract's OTHER half): the
  // hero-puddle shader (materials.js) reads planarTex/planarMat/
  // planarStrength off level.js's exported hooks — nothing was writing
  // them, so planarStrength sat at 0 and the contracted planar payoff
  // never rendered (iter01: no elongated reflections anywhere).
  scene.traverse((o) => {
    if (!hooks && o.userData && o.userData.level && o.userData.level.hooks) {
      hooks = o.userData.level.hooks;
    }
  });
  if (hooks) {
    hooks.planarTex.value = rt.texture;
    hooks.planarMat.value = textureMatrix; // same Matrix4 instance — updates live
  } else {
    console.warn("[reflect] level GROUND_HOOKS not found — hero puddles stay on envMap");
  }
  function feedHooks() {
    if (hooks) hooks.planarStrength.value = published.active ? 0.9 : 0.0;
  }

  // ---- LANE V2 payoff-visibility gate (see the constant block up top) ------
  // Hero puddle discs from layout (single source: layout.terrain.heroPuddles,
  // pos = [x, z]). No data → the gate never engages (mirror behaves as before).
  const heroDiscs = ((ctx.layout && ctx.layout.terrain && ctx.layout.terrain.heroPuddles) || [])
    .map((h) => ({ x: h.pos[0], z: h.pos[1], r: h.r }));
  const _frustum = new THREE.Frustum();
  const _projScreen = new THREE.Matrix4();
  const _gSph = new THREE.Sphere();
  let gateLinger = GATE_LINGER_S; // start visible: boot/scenario poses judge fresh
  let gateOverride = null;        // measurement seam: true/false pins the gate, null = live
  function puddlePayoffVisible() {
    if (!heroDiscs.length) return true;
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);
    const cy = camera.position.y;
    let frac = 0;
    for (const h of heroDiscs) {
      _gSph.center.set(h.x, PLANE_Y, h.z);
      _gSph.radius = h.r + GATE_MARGIN;
      if (!_frustum.intersectsSphere(_gSph)) continue;
      const d = Math.max(1, Math.hypot(h.x - camera.position.x, cy - PLANE_Y, h.z - camera.position.z));
      // apparent area of a ground disc: pi r^2 foreshortened by sin(elevation)
      // ~ (cy - PLANE_Y)/d, against the view-plane area at distance d.
      const apparent = Math.PI * h.r * h.r * Math.min(1, Math.max(0.05, (cy - PLANE_Y) / d));
      const viewH = 2 * Math.tan((camera.fov * Math.PI) / 360) * d;
      const viewW = viewH * camera.aspect;
      frac += apparent / Math.max(1e-3, viewW * viewH);
      if (frac >= GATE_MIN_FRAC) return true;
    }
    return frac >= GATE_MIN_FRAC;
  }

  const api = {
    update(dt) {
      const dyn = globalThis.__BR_DYNRES__;
      const atFloor = !!(dyn && dyn.atFloor && dyn.atFloor());
      const nearPlaza =
        camera.position.distanceTo(reflectorWorldPosition) < NEAR_GATE;
      // payoff gate with linger (dt is the frame's seconds; clamp odd values)
      if (puddlePayoffVisible()) gateLinger = GATE_LINGER_S;
      else gateLinger = Math.max(-1, gateLinger - Math.max(0, Math.min(0.1, dt || 0.016)));
      const payoff = gateOverride !== null ? gateOverride : gateLinger > 0;
      const want = enabled && qualityOn && !atFloor && nearPlaza && payoff;

      if (!want) {
        published.active = false;
        feedHooks();
        return;
      }
      frameFlip ^= 1;
      if (frameFlip) { feedHooks(); return; } // every 2nd frame (LD §5.4)

      framesSinceRefresh += 2;
      if (framesSinceRefresh >= REFRESH_FRAMES) {
        framesSinceRefresh = 0;
        refreshMembership();
      }
      published.active = renderPlanar();
      feedHooks();
    },
    setEnabled(on) { enabled = !!on; },
    // ---- private additions ----
    texture: rt.texture,
    textureMatrix,
    envCube: cubeRT.texture,
    rebakeCube: bakeCube,
    isActive() { return published.active; },
    enrolledCount() { return enrolled; },
    cubeBaked() { return cubeBaked; },
    // LANE V2 — harness-visible gate state (a run that got faster because the
    // mirror was gated off is a different result from one where it ran).
    gateReport() {
      return { payoffVisible: puddlePayoffVisible(), lingerS: +gateLinger.toFixed(2),
               heroDiscs: heroDiscs.length, active: published.active,
               override: gateOverride };
    },
    // measurement seam only (A/B pricing + regression capture): pins the
    // payoff gate; pass null to return to the live test.
    setGateOverride(v) { gateOverride = v === null ? null : !!v; },
  };

  ctx.reflect = api;
  globalThis.__BR_REFLECT_API__ = api; // profiler seam — ablation prices the pass
  return api;
}
