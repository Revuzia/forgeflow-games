// core/weapons/weapon_meshes.js [A4] — FP weapon GLB load + material repair +
// sockets + animatable parts (architecture §3.11, frozen: loadWeaponGLB(id) →
// Promise<Group>).
//
// GLB convention (produced by tools/a4_build_fp_weapons.py — fix the
// generator, never the artifact):
//   - origin at the grip, barrel down −Z, metres scale;
//   - sight line on the x=0 plane, top of sight post at y = view.sightY
//     EXACTLY (pixel-exact ADS alignment is BY CONSTRUCTION: at ADS the
//     weapon group sits at [0, -sightY, z], putting the sight on the
//     viewmodel camera's center ray — VT §5's 2-px-off red-dot tell);
//   - empties named SOCKET_muzzle / SOCKET_eject / SOCKET_sight baked in
//     (fallback: the data offsets in weapon_data view.muzzle / view.eject);
//   - nodes: base (receiver/stock/barrel), dressing (sights, muzzle device,
//     scope), mag / pump (OPTIONAL separate nodes the reload and pump-action
//     animations move), arms_R_<id> / arms_L_<id> (procedural gloved arms).
//
// PRESENTATION PASS (2026-10). The arms are no longer the soldier rig-cut; they
// are authored gloves + sleeves painted with per-vertex colour (COLOR_0) and one
// tileable weave normal map. repair() therefore treats the two arm materials
// (br_glove, br_sleeve) as FABRIC: MeshPhysicalMaterial with a broad sheen lobe so
// a knit catches a street light at grazing angles, vertex colours kept. Gun
// materials read the authored maps as shipped (the generator now emits a calm,
// dark albedo — the roughness factor is NOT scaled down any more, which is what
// made the old build render as glossy blue-white "dazzle camo").
//
// Doctrine §1/§3 discipline: strips any GLB-embedded light; defensive Meshy
// material repair (emissive-as-albedo bug). On failure: HONEST dev placeholder
// (screaming magenta, unmistakably not a gun) + window.__FFG_FALLBACKS__ push —
// ship is BLOCKED while non-empty (doctrine §7). A primitive composition is never
// silently shipped as final.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { WEAPONS, VIEWMODEL, SLOT_ORDER } from "./weapon_data.js";

const DEG = Math.PI / 180;

const GLB_BASE = new URL("../../assets/weapons/", import.meta.url);
const DRACO_BASE = new URL("../../assets/vendor/draco/", import.meta.url).href;

let _loader = null;
function loader() {
  if (!_loader) {
    _loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_BASE);
    _loader.setDRACOLoader(draco);
  }
  return _loader;
}

const cache = new Map(); // id → Promise<THREE.Group|placeholder Group>

function pushFallback(msg) {
  try {
    if (typeof window !== "undefined") {
      window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || [];
      if (!window.__FFG_FALLBACKS__.includes(msg)) window.__FFG_FALLBACKS__.push(msg);
    }
  } catch (e) { /* headless */ }
  console.warn("[A4]", msg);
}

// Materials are shared datablocks (br_metal is bound to several meshes) — every
// multiplicative treatment is applied ONCE per material (the old build squared
// them; see git history of this file for the measurement).
const repaired = new WeakSet();
// original material -> its fabric replacement (br_glove / br_sleeve are shared by BOTH arms of a
// weapon and by nothing else, so every mesh that used the original must get the same copy)
const fabricOf = new WeakMap();

const ARM_NODE_RE = /^arms?_/;
const FABRIC_RE = /glove|sleeve/i;

function isArmMesh(o) {
  let n = o;
  while (n) { if (ARM_NODE_RE.test(n.name || "")) return true; n = n.parent; }
  return false;
}

// The arm meshes are cube-projected for the weave, so every face is its own UV island
// and the exporter splits every vertex: the shipped normals render the hand FACETED
// (2026-11-13 capture). Rebuild smooth normals across position-coincident vertices,
// keeping creases sharper than ~55 deg (cuff edges, sleeve hem).
function smoothByPosition(geo) {
  if (!geo || geo.userData.__brSmoothed || !geo.attributes.position) return;
  geo.userData.__brSmoothed = true;
  const pos = geo.attributes.position, idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const key = (i) => Math.round(pos.getX(i) * 20000) + "," + Math.round(pos.getY(i) * 20000) + "," + Math.round(pos.getZ(i) * 20000);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const faceN = new Float32Array(triCount * 3);
  const groups = new Map();            // position key -> [tri, tri, ...]
  const keys = new Array(pos.count);
  for (let t = 0; t < triCount; t++) {
    const i0 = vi(t, 0), i1 = vi(t, 1), i2 = vi(t, 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n.subVectors(b, a).cross(c.sub(a));           // area-weighted
    faceN[t * 3] = n.x; faceN[t * 3 + 1] = n.y; faceN[t * 3 + 2] = n.z;
    for (const i of [i0, i1, i2]) {
      const k = keys[i] || (keys[i] = key(i));
      let g = groups.get(k); if (!g) groups.set(k, g = []);
      g.push(t);
    }
  }
  const out = new Float32Array(pos.count * 3);
  const COS = Math.cos(55 * Math.PI / 180);
  const fn = new THREE.Vector3(), own = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    own.set(faceN[t * 3], faceN[t * 3 + 1], faceN[t * 3 + 2]).normalize();
    for (let k = 0; k < 3; k++) {
      const i = vi(t, k);
      if (out[i * 3] || out[i * 3 + 1] || out[i * 3 + 2]) continue;
      n.set(0, 0, 0);
      for (const t2 of groups.get(keys[i])) {
        fn.set(faceN[t2 * 3], faceN[t2 * 3 + 1], faceN[t2 * 3 + 2]);
        const l = fn.length();
        if (l > 0 && fn.dot(own) / l > COS) n.add(fn);
      }
      n.normalize();
      out[i * 3] = n.x; out[i * 3 + 1] = n.y; out[i * 3 + 2] = n.z;
    }
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  if (geo.attributes.tangent) geo.deleteAttribute("tangent");   // stale; three derives a frame
}

// Doctrine §1 defensive repair + light strip + shadow discipline.
function repair(group) {
  const doomedLights = [];
  group.traverse((o) => {
    if (o.isLight) { doomedLights.push(o); return; } // NEVER a light outside the pool
    if (!o.isMesh) return;
    o.castShadow = false;    // viewmodel never casts into the world
    // ...but it DOES receive: with this off, your hands stayed lit by the moon
    // while you stood under an awning — the loudest "pasted-on viewmodel" tell.
    // receiveShadow is a UNIFORM in the vendored r172 (no shader permutation).
    o.receiveShadow = true;
    o.frustumCulled = false; // camera-space rig; bounds vs frustum lie
    if (isArmMesh(o)) { o.userData.isArm = true; smoothByPosition(o.geometry); }
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && fabricOf.has(m)) { list[i] = fabricOf.get(m); continue; }
      if (!m || repaired.has(m)) continue;
      repaired.add(m);
      // Meshy export bug class: albedo bound as full-strength emissive.
      if (m.emissiveMap && m.emissiveMap === m.map) {
        m.emissiveMap = null;
        if (m.emissive) m.emissive.setRGB(0, 0, 0);
      }
      if (m.emissiveIntensity == null || m.emissiveIntensity > 1.001) m.emissiveIntensity = 1;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      // ---- OPTIC GLASS ------------------------------------------------------
      // The generator authors lens discs (br_glass) and a coating ring (br_arcoat)
      // OPAQUE; transparency is applied here on purpose (glTF alphaMode round-trips
      // are exporter-version dependent, and an opaque lens BLINDS the optic).
      // RED DOT (generator material br5_dot): unlit, un-tonemapped, always crisp
      if (/_dot$/i.test(m.name || "")) {
        const dm = new THREE.MeshBasicMaterial({ name: m.name, color: 0xff2a1a, toneMapped: false, fog: false });
        list[i] = dm; repaired.add(dm); m.dispose();
        continue;
      }
      // IRON-SIGHT LUME (generator material br5_lume: pistol 3-dot, shotgun front bead).
      // Unlit so the dots read in the night pool, but a muted pale green-white (not
      // tone-mapped, below any bloom threshold) — a sight dot, not a lamp.
      if (/_lume$/i.test(m.name || "")) {
        const lm = new THREE.MeshBasicMaterial({ name: m.name, color: new THREE.Color(0.50, 0.62, 0.46),
          toneMapped: false, fog: false });
        list[i] = lm; repaired.add(lm); m.dispose();
        continue;
      }
      if (/glass|arcoat/i.test(m.name || "")) {
        const rim = /arcoat/i.test(m.name || "");
        m.transparent = true;
        // coated glass reads as DARK with a bright reflected highlight, never as a flat teal disc
        if (!rim && m.color) m.color.setRGB(0.012, 0.020, 0.024);
        m.opacity = rim ? 0.55 : 0.88;
        m.depthWrite = false;
        m.metalness = rim ? 0.0 : 0.25;
        m.roughness = rim ? 0.16 : 0.03;
        m.envMapIntensity = rim ? 1.4 : 2.6;
        m.needsUpdate = true;
        continue;
      }
      const setAniso = (t) => { if (t && t.anisotropy !== 16) { t.anisotropy = 16; t.needsUpdate = true; } };
      setAniso(m.map); setAniso(m.normalMap); setAniso(m.roughnessMap); setAniso(m.metalnessMap);
      if (FABRIC_RE.test(m.name || "")) {
        // FABRIC: dielectric, broad lobe, per-vertex colour (COLOR_0 → vertexColors).
        // Built EXPLICITLY (never pm.copy(m): MeshPhysicalMaterial.copy in r172 throws
        // on a MeshStandardMaterial source and the whole weapon would fall to the
        // magenta placeholder). Wrapped so a three bump degrades to the standard one.
        try {
          const isSleeve = /sleeve/i.test(m.name);
          const pm = new THREE.MeshPhysicalMaterial({
            name: m.name,
            // vertex colours carry the albedo; this factor is the night treatment (see the
            // gun-metal note below): the vm key + rim over-light dark fabric to a pale card
            // GLOVE (2026-11-13, measured live on pike hip, vm-camera pass into a float RT):
            // the glove atlas is dark coyote (linear 0.024/0.020/0.014) but rendered p50
            // 0.0175 — 2.3x the sleeve (0.0075) and above the receiver metal (0.0097) — and
            // NEUTRAL-BLUE (0.016,0.018,0.022): the night pool + vm rig deliver per-channel
            // radiance/albedo of R 0.96 / G 1.30 / B 2.18, which cancels the coyote hue, and the
            // 0.22 dielectric lobe added 28% (0.0049) of pure grey. Result: "pale grey" hands.
            // Fix: lower + warm-balance the factor against that cool pool and halve the lobe
            // (rendered p50 ~0.009, warm (R>G>B)), stitching kept by a stronger normal.
            color: isSleeve ? new THREE.Color(0.85, 0.85, 0.85) : new THREE.Color(0.50, 0.43, 0.33),
            vertexColors: !!m.vertexColors,
            map: m.map || null,
            normalMap: m.normalMap || null,
            normalScale: (m.normalScale ? m.normalScale.clone() : new THREE.Vector2(1, 1))
              .multiplyScalar(isSleeve ? 1.0 : 1.6),
            roughness: Math.min(1, Math.max(0.3, m.roughness == null ? 0.85 : m.roughness)),
            metalness: 0.0,
            // (2026-11-13, measured live) dark cloth (albedo ~0.01) under the ~15-unit
            // night pool is ALL specular: the default 4% dielectric lobe out-shone the
            // diffuse 5:1 and rendered olive sleeves pale blue-grey. Cloth is not glossy.
            specularIntensity: isSleeve ? 0.22 : 0.12,
            envMapIntensity: 0.15,
            side: THREE.FrontSide,
            // Sheen is ADDED on top of the diffuse term and does not scale with albedo: at
            // ~14 units of irradiance a (0.16,0.14,0.11) sheen colour turned dark fabric into
            // cream-coloured card (measured: vertex colour 0.007 linear, rendered ~0.5).
            // Kept as a faint rim accent only.
            sheen: 0.0,          // sheen is additive and albedo-independent: same pale wash
            sheenRoughness: 0.85,
            sheenColor: isSleeve ? new THREE.Color(0.030, 0.034, 0.028) : new THREE.Color(0.050, 0.044, 0.036),
          });
          list[i] = pm;
          fabricOf.set(m, pm);
          repaired.add(pm);
          m.dispose();
          continue;
        } catch (e) {
          console.warn("[weapon_meshes] fabric sheen skipped:", e && e.message);
          m.metalness = 0.0; m.metalnessMap = null; m.envMapIntensity = 0.65;
        }
      } else {
        // GUN METAL / POLYMER. Normal relief halved (surface noise at 25 cm is a
        // per-frame glitter generator), roughness read AS AUTHORED. The generator's
        // roughness map already carries the per-part variance (grip 1.06, receiver
        // 0.74): scaling it down 0.58x was the "wet chrome" the owner saw.
        if (m.normalScale) m.normalScale.multiplyScalar(0.6);
        // NIGHT TREATMENT: the world pool (moon 5.0 + hemisphere 4.6 + the vm rig) lands
        // ~14 units of irradiance on an upward-facing receiver at 40 cm, so albedo that is
        // right in daylight (sRGB 0.12-0.16) renders as pale blue-grey card at night —
        // measured live, black-albedo A/B: the stock goes from (170,180,205) to near black.
        // 0.5x lands dark gunmetal with the form carried by the key and rim.
        if (m.color) m.color.setScalar(/metal|optic/i.test(m.name || "") ? 0.85 : 0.70);
        m.envMapIntensity = /metal|optic/i.test(m.name || "") ? 0.85 : 0.4;   // metal needs something to reflect
        // The roughness map's low end (0.36 on worn steel) is a narrow lobe that turns the muzzle-flash
        // light and the moon into a foil-like glitter on a hand-sized part. The shader clamps the
        // PRODUCT at 1, so a factor of 1.5 lifts the whole map (0.36 -> 0.54) and keeps its variance.
        // (2026-11-13) The a5 generator (materials named br5_*) now ships an AUTHORED ORM:
        // factor x channel already lands the old flat values on average (metal 0.40, polymer
        // 0.62, grip 0.74) with smudges / scratch lines smoother and dust rougher around it —
        // the x1.5 lift would erase exactly that (and push metal to 0.60, matte). Its floor is
        // authored instead (channel >= 0.30, so the narrowest lobe is a 2-px scratch line at
        // ~0.22, not a whole part). Legacy a4 maps keep the lift.
        const authoredOrm = /^br5_/i.test(m.name || "");
        if (m.roughnessMap && !authoredOrm) m.roughness = Math.min(1.8, (m.roughness == null ? 1 : m.roughness) * 1.5);
        else if (!m.roughnessMap && (m.roughness == null || m.roughness > 0.92)) m.roughness = 0.92;
        // POLYMER GLARE (2026-11-13, measured live in the vm pass): the stock / receiver-top
        // polymer nearest the eye is seen at grazing incidence, where even a roughness-0.99
        // dielectric lobe catches the 5.0 moon — 75% of the breaker stock's radiance was
        // specular (median 0.026, 0.019 of it moon spec) and it read as a pale slab in the
        // bottom-right corner / under the ghost ring. Physical copy with the dielectric lobe
        // at 35%: median 0.0135, the form stays from diffuse + key. Built explicitly (see
        // the fabric note: MeshPhysicalMaterial.copy throws on a Standard source).
        if (authoredOrm && !/metal|optic/i.test(m.name || "")) {
          try {
            const pm = new THREE.MeshPhysicalMaterial({
              name: m.name, color: m.color.clone(), vertexColors: !!m.vertexColors,
              map: m.map || null, normalMap: m.normalMap || null,
              normalScale: m.normalScale ? m.normalScale.clone() : new THREE.Vector2(1, 1),
              roughness: m.roughness, roughnessMap: m.roughnessMap || null,
              aoMap: m.aoMap || null, aoMapIntensity: m.aoMapIntensity,
              metalness: 0.0, envMapIntensity: m.envMapIntensity, side: m.side,
              specularIntensity: 0.35,
            });
            list[i] = pm; fabricOf.set(m, pm); repaired.add(pm); m.dispose();
            continue;
          } catch (e) {
            console.warn("[weapon_meshes] polymer de-glare skipped:", e && e.message);
          }
        }
      }
      m.needsUpdate = true;
    }
    if (Array.isArray(o.material)) o.material = list; else o.material = list[0];
  });
  for (const l of doomedLights) l.parent && l.parent.remove(l);
}

function findSocket(group, name) {
  let hit = null;
  group.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
}

// Honest dev placeholder: a magenta slab that could never be mistaken for a
// finished gun. It exists so the game keeps RUNNING while the asset gap is
// visible and ship-blocked — not so the gap can hide.
function makePlaceholder(id) {
  const g = new THREE.Group();
  g.name = `wpn_placeholder_${id}`;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff00ff, roughness: 0.4, metalness: 0.0,
    emissive: 0x550055, wireframe: false,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.45), mat);
  body.position.set(0, 0.06, -0.18);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), mat);
  grip.position.set(0, -0.05, -0.02);
  g.add(body, grip);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
  const view = (WEAPONS[id] && WEAPONS[id].view) || {};
  g.userData.muzzleOffset = (view.muzzle || [0, 0.05, -0.5]).slice();
  g.userData.ejectOffset = (view.eject || [0.03, 0.05, -0.1]).slice();
  g.userData.placeholder = true;
  g.userData.weaponId = id;
  g.userData.parts = {};
  return g;
}

// Animatable parts: rest transforms + weapon-space bounds, read ONCE at load so the
// viewmodel never has to guess where the magazine or the hands are. Everything is
// expressed in the group's own (grip-origin) space.
function discoverParts(group) {
  const parts = {};
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  const boxOf = (o) => {
    box.makeEmpty();
    o.traverse((c) => {
      if (!c.isMesh || !c.geometry) return;
      if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
      tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld).applyMatrix4(inv);
      box.union(tmp);
    });
    return box.clone();
  };
  const put = (key, node) => {
    if (!node) return;
    const b = boxOf(node);
    parts[key] = {
      node,
      restP: node.position.clone(),
      restQ: node.quaternion.clone(),
      restS: node.scale.clone(),
      box: b,
      center: b.getCenter(new THREE.Vector3()),
      size: b.getSize(new THREE.Vector3()),
    };
  };
  put("mag", group.getObjectByName("mag"));
  put("pump", group.getObjectByName("pump"));
  let armL = null, armR = null;
  for (const c of group.children) {
    if (/^arms?_L/.test(c.name || "")) armL = c;
    else if (/^arms?_R/.test(c.name || "")) armR = c;
  }
  put("armL", armL);
  put("armR", armR);
  return parts;
}

/**
 * Load (and cache) the FP viewmodel GLB for a weapon id. Resolves to a
 * THREE.Group with userData:
 *   { weaponId, muzzle: Object3D|null, eject: Object3D|null, sight, hipPush,
 *     muzzleOffset:[3], ejectOffset:[3], parts:{mag,pump,armL,armR}, placeholder?:true }
 * Callers clone via SkeletonUtils/clone() if they need independent copies;
 * viewmodel.js uses the cached prototype directly (single consumer).
 */
export async function loadWeaponGLB(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const w = WEAPONS[id];
    const rel = (w && w.view && w.view.glb) ? w.view.glb.split("/").pop() : `${id}.glb`;
    // ?v=<build> so a browser holding last build's GLB (CDN max-age 1 day) cannot pair
    // it with this build's viewmodel code — see runtime/boot.js __BR_V__
    const bv = globalThis.__BR_V__ || new URL(import.meta.url).searchParams.get("v");
    const url = new URL(rel, GLB_BASE).href + (bv ? `?v=${bv}` : "");
    try {
      const gltf = await loader().loadAsync(url);
      const group = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!group) throw new Error("GLB contained no scene");
      repair(group);
      if (w && w.view && w.view.scale && w.view.scale !== 1) {
        group.scale.setScalar(w.view.scale);
      }
      const muzzle = findSocket(group, "SOCKET_muzzle");
      const eject = findSocket(group, "SOCKET_eject");
      // ADS alignment BY CONSTRUCTION, not by a copied number: weapon_data's
      // view.sightY is transcribed by hand from the build tool's report and it
      // drifts. viewmodel.js parks the mount at y = -view.sightY for ADS, so
      // shifting the prototype by (declared - built) puts the real sight line on
      // the vm camera's centre ray whatever the data file says.
      const sight = findSocket(group, "SOCKET_sight");
      const declaredSightY = w && w.view && typeof w.view.sightY === "number"
        ? w.view.sightY : null;
      if (sight && declaredSightY != null) {
        const builtSightY = sight.position.y;
        const dy = declaredSightY - builtSightY;
        if (Math.abs(dy) > 1e-4) {
          group.position.y += dy;
          if (Math.abs(dy) > 0.02) {
            console.warn(`[A4] ${id}: sightY drift ${(dy * 1000).toFixed(1)} mm ` +
              `(built ${builtSightY.toFixed(4)} vs weapon_data ${declaredSightY}) ` +
              `— corrected at load, but re-copy the A4BUILD report`);
          }
        }
      } else if (!sight) {
        console.warn(`[A4] ${id}.glb has no SOCKET_sight — ADS rides weapon_data view.sightY unchecked`);
      }

      // ---- HIP STANDOFF — MEASURED AGAINST THE FRUSTUM --------------------------
      // Push the weapon forward at the HIP pose only far enough that no WEAPON vertex
      // (never the arms: a forearm is supposed to run past the eye and be clipped) is
      // BOTH nearer than MACRO_D and inside the vm camera's view volume. Same intent
      // as the old fixed 'rear clearance' rule (never photograph a receiver facet at
      // macro range) but tested where it matters. viewmodel.js blends the push out
      // with adsEase (a shouldered rifle's stock IS behind the eye). Pure Z, so the
      // sight stays on x=0,y=0 at ADS and alignment is untouched.
      const MACRO_D = 0.16;      // m — nearer than this, a facet reads as macro noise
      const HARD_D = 0.055;      // m — nearer than this it is inside the eye, always push
      const MAX_PUSH = 0.34;
      const EDGE_MARGIN = 1.05;
      const REF_ASPECT = 16 / 9;
      const TAN_V = Math.tan(VIEWMODEL.fovDeg * 0.5 * DEG);
      const hipPose = (w && w.view && w.view.posHip) ? w.view.posHip : [0.16, -0.18, -0.34];
      const wpnPts = [];
      {
        const pt = new THREE.Vector3();
        // the hip cant (view.rot, applied about the grip by viewmodel.js) changes which
        // vertices come near the eye — test the pose as it is actually drawn
        const hr = (w && w.view && w.view.rot) || null;
        const hipQ = hr ? new THREE.Quaternion().setFromEuler(
          new THREE.Euler(hr[0] * DEG, hr[1] * DEG, hr[2] * DEG, "YXZ")) : null;
        group.updateMatrixWorld(true);
        group.traverse((o) => {
          if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
          if (o.userData.isArm) return;
          const a = o.geometry.attributes.position;
          const stride = Math.max(1, Math.floor(a.count / 4000));
          for (let i = 0; i < a.count; i += stride) {
            pt.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(o.matrixWorld);
            if (hipQ) pt.applyQuaternion(hipQ);
            wpnPts.push(pt.x, pt.y, pt.z);
          }
        });
      }
      const offends = (push) => {
        for (let i = 0; i < wpnPts.length; i += 3) {
          const cx = hipPose[0] + wpnPts[i];
          const cy = hipPose[1] + wpnPts[i + 1];
          const d = -(hipPose[2] - push + wpnPts[i + 2]);
          if (d < HARD_D) return true;
          if (d >= MACRO_D) continue;
          const hh = d * TAN_V * EDGE_MARGIN;
          if (Math.abs(cy) > hh) continue;
          if (Math.abs(cx) > hh * REF_ASPECT) continue;
          return true;
        }
        return false;
      };
      let push = 0;
      if (wpnPts.length) {
        while (push < MAX_PUSH && offends(push)) push += 0.005;
        push = Math.min(push, MAX_PUSH);
      }
      group.userData.hipPush = push;
      {
        let rear = -Infinity;
        for (let i = 2; i < wpnPts.length; i += 3) rear = Math.max(rear, wpnPts[i]);
        const rearCam = hipPose[2] - push + rear;
        console.info(`[A4] ${id}: hip standoff — grip ${(-(hipPose[2] - push) * 100).toFixed(1)} cm ` +
          `from the eye, rearmost weapon vertex ${(-rearCam * 100).toFixed(1)} cm, ` +
          `hipPush ${(push * 100).toFixed(1)} cm (0 at full ADS)`);
      }
      group.userData.sight = sight;
      group.userData.weaponId = id;
      group.userData.muzzle = muzzle;
      group.userData.eject = eject;
      group.userData.muzzleOffset = (w && w.view && w.view.muzzle ? w.view.muzzle : [0, 0.05, -0.5]).slice();
      group.userData.ejectOffset = (w && w.view && w.view.eject ? w.view.eject : [0.03, 0.05, -0.1]).slice();
      group.userData.parts = discoverParts(group);
      if (!muzzle) console.warn(`[A4] ${id}.glb has no SOCKET_muzzle — using weapon_data view.muzzle offset`);
      return group;
    } catch (err) {
      pushFallback(`A4: FP weapon GLB '${id}' failed to load (${err && err.message}) — dev placeholder active, ship blocked`);
      return makePlaceholder(id);
    }
  })();
  p.then((g) => { p._resolved = g; }, () => {}); // sync reader for prewarmables
  cache.set(id, p);
  return p;
}

// ---- private extras ---------------------------------------------------------

/** Prototypes loaded so far (resolved only) — viewmodel.prewarmables() source. */
export function loadedPrototypes() {
  const out = [];
  for (const p of cache.values()) {
    if (p && p._resolved) out.push(p._resolved);
  }
  return out;
}

/** Kick off (and await) every weapon in the five slots so a weapon switch never
 *  pays a network + decode + material-compile hitch. Safe to call repeatedly. */
export function loadAllWeapons(ids) {
  return Promise.all((ids || SLOT_ORDER).map((id) => loadWeaponGLB(id)));
}

/** Dev/hot-reload seam: forget a cached prototype so the next loadWeaponGLB(id)
 *  re-fetches the (re-exported) GLB. Returns the old group (caller removes it). */
export function invalidateWeapon(id) {
  const old = cache.get(id);
  cache.delete(id);
  return old && old._resolved;
}

// World/third-person loot model (core/weapons/world_weapon.js owns it; boot imports it directly
// too). Re-exported so `import { buildWorldWeapon } from "./weapon_meshes.js"` also works.
export { buildWorldWeapon, preloadWorldWeapons, WORLD_WEAPON_INFO } from "./world_weapon.js";
