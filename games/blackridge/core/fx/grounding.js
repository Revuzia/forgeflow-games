// core/fx/grounding.js [A7 / lane D] — THE shared contact-shadow (grounding)
// helper. VT §1 amateur tell #2 is "nothing is grounded": iter04 shipped with
// no character, prop or vehicle carrying a genuine contact shadow, which trips
// D1's "any floating prop -> max 6" and D7's cap independently.
//
// ONE helper, two consumers (ranked fix 5 asks for exactly this rather than a
// per-system reimplementation):
//   * STATIC bake  — fx.js sweeps the built scene ONCE and emits one merged,
//     one-draw-call mesh of ground-hugging quads under every ground-standing
//     prop and vehicle instance. Footprint and contact height come from the
//     instance's own world bounding box, so a blob physically cannot float or
//     sink relative to the thing it grounds.
//   * DYNAMIC pool — soldiers.js leases one slot per live actor and writes
//     position / footprint / strength every frame.
//
// The blob texture is a PURE radial alpha falloff reaching EXACTLY zero at the
// quad edge. That is why this carries its own texture instead of reusing the
// level decal atlas: materials.js's `ao_blob` cell composites
// `speckle(70, ...)` across the full cell AFTER its radial, so its corners keep
// alpha and the quad reads as the hard-edged RECTANGULAR dark patch all three
// critics measured under the parked cars. A blob whose edge alpha is not zero
// is not a contact shadow, it is a rectangle.
//
// DARKENING ONLY, by construction: the fragment colour is literally vec3(0.0)
// under NormalBlending, so dst' = dst * (1 - a). The S9 defect was a POSITIVE
// luma lift where the contact shadow belonged; this shader cannot brighten a
// pixel at any alpha, at any distance (fog is off on both materials for the
// same reason — a fogged black decal would paint fog colour, which is lighter
// than the wet cobbles it sits on).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TEX_SIZE = 128;
const DYN_N = 32;          // dynamic slots (characters); >= max live actors
const STATIC_MAX = 512;    // sanity cap on the one-time bake

// Static-bake acceptance envelope.
const MIN_FOOT = 0.10;     // m — below this the blob is invisible anyway
const MAX_FOOT = 7.0;      // m — above this it is architecture, not a prop
const MAX_LIFT = 0.90;     // m — bbox floor this far above terrain ⇒ wall-mount
const FOOT_SPREAD = 1.45;  // blob edge / footprint half-extent
const STATIC_ALPHA = 0.66;
// props_static is props.js's MERGED batch: one mesh holding many props baked
// into world space with no per-instance transform, so its bounding box spans
// the whole batch. Measured in the live scene, it emitted 6 quads of 8.7×0.22 m
// and 4.35×3.63 m sitting up to 3.6 m from any prop — a smear, not a contact.
// A merged batch cannot be grounded per-object without a connected-component
// split; skip it rather than ship six wrong shadows to buy sixteen right ones.
const NAME_SKIP = /^(props_base_decals|props_steam|props_fan_|props_rope|props_cable|props_static)/;

function blobTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = TEX_SIZE;
  const g = cv.getContext("2d");
  const c = TEX_SIZE / 2;
  const gr = g.createRadialGradient(c, c, 1, c, c, c);
  // Dense core, long shoulder, hard ZERO at the rim (see header).
  gr.addColorStop(0.00, "rgba(0,0,0,1.00)");
  gr.addColorStop(0.22, "rgba(0,0,0,0.92)");
  gr.addColorStop(0.45, "rgba(0,0,0,0.62)");
  gr.addColorStop(0.66, "rgba(0,0,0,0.30)");
  gr.addColorStop(0.85, "rgba(0,0,0,0.08)");
  gr.addColorStop(1.00, "rgba(0,0,0,0.00)");
  g.fillStyle = gr;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // never tile a shadow
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Own ShaderMaterial rather than MeshBasicMaterial + instanceColor: in three
// r172 `color_pars_fragment` declares vColor under USE_COLOR only, so an
// instanceColor-driven alpha would not even compile. decals.js sets the
// precedent for a raw instanced shader in this lane.
const DYN_VERT = /* glsl */ `
attribute float aStrength;
varying vec2 vUvB;
varying float vS;
void main() {
  vUvB = uv;
  vS = aStrength;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const DYN_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUvB;
varying float vS;
void main() {
  float a = texture2D(uMap, vUvB).a * vS;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _bb = new THREE.Box3();
const _im = new THREE.Matrix4();
const _mtx = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _eul = new THREE.Euler();
const _c3 = new THREE.Vector3();

export function makeGrounding(env) {
  const tex = blobTexture();

  // ---------------------------------------------------------------- dynamic
  // Unit quad in the XZ plane; per-instance scale carries the footprint.
  const dynGeo = new THREE.PlaneGeometry(1, 1);
  dynGeo.rotateX(-Math.PI / 2);
  dynGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const strength = new Float32Array(DYN_N);
  const strengthAttr = new THREE.InstancedBufferAttribute(strength, 1);
  strengthAttr.setUsage(THREE.DynamicDrawUsage);
  dynGeo.setAttribute("aStrength", strengthAttr);

  const dynMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex } },
    vertexShader: DYN_VERT,
    fragmentShader: DYN_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const dyn = new THREE.InstancedMesh(dynGeo, dynMat, DYN_N);
  dyn.name = "fx.grounding.dyn";
  dyn.frustumCulled = false;
  dyn.renderOrder = 3;
  dyn.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < DYN_N; i++) dyn.setMatrixAt(i, _m);
  env.root.add(dyn);

  const used = new Uint8Array(DYN_N);

  function hideSlot(i) {
    if (i < 0 || i >= DYN_N) return;
    _m.makeScale(0, 0, 0);
    dyn.setMatrixAt(i, _m);
    strength[i] = 0;
    dyn.instanceMatrix.needsUpdate = true;
    strengthAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- static
  let staticMesh = null;
  let baked = 0;
  let bakeTried = false;

  // ORIENTED footprint, not the world AABB. A 4.5 m sedan parked at 40° has a
  // world AABB roughly 5.5 × 5.5 m, so an AABB-sized blob spills a metre past
  // the bodywork on every side and reads as a puddle, not a contact — visible
  // in the live C1 frame before this. The footprint therefore comes from the
  // instance's LOCAL geometry bounds × its own scale, and the quad is rotated
  // by the instance's own yaw. The world box is still what supplies the contact
  // HEIGHT, because that is an axis-aligned question.
  function quadFor(box, geoBox, mtx) {
    _mtx.copy(mtx).decompose(_pos, _quat, _scl);
    _eul.setFromQuaternion(_quat, "YXZ");
    const rx = (geoBox.max.x - geoBox.min.x) * 0.5 * Math.abs(_scl.x);
    const rz = (geoBox.max.z - geoBox.min.z) * 0.5 * Math.abs(_scl.z);
    const foot = Math.max(rx, rz) * 2;
    if (!isFinite(foot) || foot < MIN_FOOT || foot > MAX_FOOT) return null;
    // Centre from the geometry centroid pushed through the instance matrix, so
    // an off-origin prototype still lands under its own body.
    _c3.set((geoBox.max.x + geoBox.min.x) * 0.5, 0, (geoBox.max.z + geoBox.min.z) * 0.5)
      .applyMatrix4(mtx);
    const cx = _c3.x, cz = _c3.z;
    // Contact height = the object's OWN bbox floor — exact on decks and stairs
    // where terrain-only groundY is not (the same contract fx.js uses to floor
    // ejected brass).
    const contactY = box.min.y;
    const gy = env.groundY(cx, cz);
    if (contactY - gy > MAX_LIFT) return null;  // wall-mounted / roof clutter
    if (gy - contactY > 2.0) return null;       // below terrain: not a contact
    const g = new THREE.PlaneGeometry(rx * 2 * FOOT_SPREAD, rz * 2 * FOOT_SPREAD);
    g.rotateX(-Math.PI / 2);
    g.rotateY(_eul.y);
    g.translate(cx, contactY + 0.012, cz);
    return g;
  }

  function bakeStatics(scene) {
    if (bakeTried) return baked;
    bakeTried = true;
    const quads = [];
    scene.traverse((o) => {
      if (quads.length >= STATIC_MAX) return;
      if (!o.isMesh && !o.isInstancedMesh) return;
      const n = o.name || "";
      if (!n.startsWith("props_") || NAME_SKIP.test(n) || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const gb = o.geometry.boundingBox;
      if (!gb) return;
      o.updateWorldMatrix(true, false);
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count && quads.length < STATIC_MAX; i++) {
          o.getMatrixAt(i, _im);
          _im.premultiply(o.matrixWorld);
          _bb.copy(gb).applyMatrix4(_im);
          const q = quadFor(_bb, gb, _im);
          if (q) quads.push(q);
        }
      } else {
        _bb.copy(gb).applyMatrix4(o.matrixWorld);
        const q = quadFor(_bb, gb, o.matrixWorld);
        if (q) quads.push(q);
      }
    });
    if (!quads.length) return 0;
    const merged = mergeGeometries(quads, false);
    for (const q of quads) q.dispose();
    if (!merged) return 0;
    staticMesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
      map: tex, color: 0x000000, transparent: true, opacity: STATIC_ALPHA,
      depthWrite: false, depthTest: true, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    staticMesh.name = "fx.grounding.static";
    staticMesh.renderOrder = 3;
    staticMesh.frustumCulled = false;
    env.root.add(staticMesh);
    baked = quads.length;
    return baked;
  }

  return {
    // ---- dynamic (characters) -------------------------------------------
    alloc() {
      for (let i = 0; i < DYN_N; i++) if (!used[i]) { used[i] = 1; return i; }
      return -1;
    },
    /** rx/rz = footprint HALF-extents in metres; s = 0..1 shadow strength. */
    write(i, x, y, z, rx, rz, s) {
      if (i < 0 || i >= DYN_N) return;
      if (!(s > 0.004)) { hideSlot(i); return; }
      _p.set(x, y, z);
      _s.set(Math.max(0.02, rx * 2), 1, Math.max(0.02, rz * 2));
      _m.compose(_p, _q.identity(), _s);
      dyn.setMatrixAt(i, _m);
      strength[i] = Math.min(1, s);
      dyn.instanceMatrix.needsUpdate = true;
      strengthAttr.needsUpdate = true;
    },
    hide: hideSlot,
    free(i) { hideSlot(i); if (i >= 0 && i < DYN_N) used[i] = 0; },
    clear() { for (let i = 0; i < DYN_N; i++) { hideSlot(i); used[i] = 0; } },

    // ---- static (props / vehicles) --------------------------------------
    bakeStatics,
    resetStatics() {
      if (staticMesh) {
        env.root.remove(staticMesh);
        staticMesh.geometry.dispose();
        staticMesh = null;
      }
      baked = 0;
      bakeTried = false;
    },

    prewarmables() { return staticMesh ? [dyn, staticMesh] : [dyn]; },
    stats: () => ({
      statics: baked,
      dynUsed: used.reduce((a, b) => a + b, 0),
      dynSlots: DYN_N,
    }),
  };
}
