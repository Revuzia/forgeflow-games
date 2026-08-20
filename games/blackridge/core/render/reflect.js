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

export function createReflect(ctx) {
  const { renderer, scene, camera } = ctx;

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
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, virtualCamera);
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
  function refreshMembership() {
    enrolled = 0;
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      if (o.userData && o.userData.br_sky) { enrolled++; return; } // already on
      if (o.userData && o.userData.noReflect) return;              // opt-out hook
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
  function bakeCube() {
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      scene.add(cubeCam);
      cubeCam.update(renderer, scene);
      scene.remove(cubeCam);
      cubeBaked = true;
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
    layer: REFLECT_LAYER,
  };
  globalThis.__BR_REFLECT__ = published;

  const api = {
    update(dt) {
      const dyn = globalThis.__BR_DYNRES__;
      const atFloor = !!(dyn && dyn.atFloor && dyn.atFloor());
      const nearPlaza =
        camera.position.distanceTo(reflectorWorldPosition) < NEAR_GATE;
      const want = enabled && qualityOn && !atFloor && nearPlaza;

      if (!want) {
        published.active = false;
        return;
      }
      frameFlip ^= 1;
      if (frameFlip) return; // every 2nd frame (LD §5.4)

      framesSinceRefresh += 2;
      if (framesSinceRefresh >= REFRESH_FRAMES) {
        framesSinceRefresh = 0;
        refreshMembership();
      }
      published.active = renderPlanar();
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
  };

  ctx.reflect = api;
  return api;
}
