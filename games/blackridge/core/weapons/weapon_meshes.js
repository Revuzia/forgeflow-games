// core/weapons/weapon_meshes.js [A4] — FP weapon GLB load + material repair +
// sockets (architecture §3.11, frozen: loadWeaponGLB(id) → Promise<Group>).
//
// GLB convention (produced by tools/a4_build_fp_weapons.py — fix the
// generator, never the artifact):
//   - origin at the grip, barrel down −Z, metres scale;
//   - sight line on the x=0 plane, top of sight post at y = view.sightY
//     EXACTLY (pixel-exact ADS alignment is BY CONSTRUCTION: at ADS the
//     weapon group sits at [0, -sightY, z], putting the sight on the
//     viewmodel camera's center ray — VT §5's 2-px-off red-dot tell);
//   - empties named SOCKET_muzzle / SOCKET_eject baked in (fallback: the
//     data offsets in weapon_data view.muzzle / view.eject);
//   - Draco compressed, ≤250 KB each (Part 5 budget), arms included.
//
// Doctrine §1/§3 discipline: strips any GLB-embedded light; defensive Meshy
// material repair (emissive-as-albedo bug) even though the build script
// authors materials — the next regenerated asset arrives broken the same way.
// NIGHT TREATMENT (iter01 F2 fix): VT §3/§5 — "source weapon GLBs ... then
// ADD roughness variance + edge-wear treatment at load. The viewmodel weapon
// is the closest, most-stared-at surface in the game." The a4 build tool
// authors a charcoal albedo set (body mean #2b2d2e ≈ 0.028 linear, gloves
// #121212 ≈ 0.008 linear) that is plausible PBR in daylight but renders as a
// BLACK CUTOUT in the blue-hour scene (iter01 S1/S2: "shattered black
// polygon soup" / "no viewmodel visible" — both were the unlit-black gun).
// repair() lifts albedo through the material color multiplier (the ORM/
// albedo MAPS stay authoritative for variance and edge wear) and gives the
// body a real env-map sheen so the night sky/practicals model the surface.
// Tuned against tools/a4_build_fp_weapons.py's authored set — regenerating
// brighter textures at the build tool makes these multipliers 1.0 again.
// On failure: HONEST dev placeholder (screaming magenta, unmistakably not a
// gun) + window.__FFG_FALLBACKS__ push — ship is BLOCKED while non-empty
// (doctrine §7). A primitive composition is never silently shipped as final.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { WEAPONS } from "./weapon_data.js";

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

// Doctrine §1 defensive repair + light strip + shadow discipline.
function repair(group) {
  const doomedLights = [];
  group.traverse((o) => {
    if (o.isLight) { doomedLights.push(o); return; } // NEVER a light outside the pool
    if (o.isMesh) {
      o.castShadow = false;    // viewmodel never casts into the world
      o.receiveShadow = false; // and never samples the 1024 moon map at 30 cm
      o.frustumCulled = false; // camera-space rig; bounds vs frustum lie
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        // Meshy export bug class: albedo bound as full-strength emissive.
        if (m.emissiveMap && m.emissiveMap === m.map) {
          m.emissiveMap = null;
          if (m.emissive) m.emissive.setRGB(0, 0, 0);
        }
        if (m.emissiveIntensity == null || m.emissiveIntensity > 1.001) m.emissiveIntensity = 1;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        // W1 (iter03): NO ALBEDO MULTIPLIER. The 3.4x/4.5x lift above was
        // written against an OLD authored texture set (the stale header note
        // still quotes "#2b2d2e ~ 0.028 linear"); the set the build tool
        // actually ships now measures sRGB 0.288 body / 0.426 metal / 0.22-0.36
        // glove (PIL means over tools/_a4_gen/*.png, this session), and
        // gen_textures' own comment says the glove band "needs no runtime lift".
        // Multiplying a 0.15-linear metal by 3.4 puts albedo at 0.51 and then
        // the VM fill rig lands on top of it: that is the BLOWN WHITE gun in
        // iter03 S1/S2. Albedo > 1 is not a lighting fix, it is a clipped
        // surface with no form left in it. Read the maps as authored; the vm
        // fill rig (viewmodel.js) owns night readability, which is where a
        // lighting problem belongs.
        // ---- OPTIC GLASS (W1, iter07) -----------------------------------
        // a4_build_fp_weapons.py build_scope() authors an objective lens disc
        // (br_glass) and its coating rim (br_arcoat) as OPAQUE meshes, and the
        // transparency is applied here on purpose: glTF alphaMode/alphaCutoff
        // round-trips are exporter-version dependent, and a lens that silently
        // exports opaque does not soften a frame — it BLINDS the optic. Keyed
        // on the material name, which is the contract between the two files.
        // The defect this exists to close: 2/3 iter06 blind verdicts led with
        // the S2 ADS frame, and both named the same absence — "no modelled
        // optic body, no lens, no glass". The tube was bored end to end, so
        // the pixels inside the ring were byte-identical to the pixels outside
        // it and nothing said the player was looking THROUGH anything.
        if (/glass|arcoat/i.test(m.name || "")) {
          const rim = /arcoat/i.test(m.name || "");
          m.transparent = true;
          m.opacity = rim ? 0.55 : 0.24;
          m.depthWrite = false;      // never occlude the reticle behind it
          m.metalness = 0.0;
          m.roughness = rim ? 0.16 : 0.035;
          // A coated objective is a MIRROR at grazing angles — this is the one
          // surface on the gun that legitimately reflects the sky and the
          // sodium practicals, and it is what makes glass read as glass.
          m.envMapIntensity = rim ? 1.4 : 3.2;
          m.needsUpdate = true;
          continue;                  // skip the parkerised-metal treatment
        }
        if (m.color) {
          const glove = /glove/i.test(m.name || "");
          m.color.setScalar(1.0);
          if (!glove) {
            // W1 (iter05): 1.15 was not "sheen" — with metalness-1 barrel and
            // sight hardware it mirrored the sky PMREM and rendered them as
            // chrome at macro range in the live S8 capture. 0.55 keeps the
            // blue-hour wet-metal cue without a second key light.
            m.envMapIntensity = 0.55;
            // W1 (iter05): the 0.92 clamp used to fire on EVERY gun material,
            // because glTF's roughnessFactor default is 1.0 whenever a
            // metallicRoughness map is bound. The build tool now ships that
            // factor as a deliberate per-part multiplier (rubberised grip 1.06,
            // anodised receiver 0.70 over one shared roughness map — VT §3
            // "distinct roughness per part"), so clamping it flattened the
            // very variance this repair exists to protect. Clamp only the
            // mapless case, which is the one it was written for.
            if (!m.roughnessMap && (m.roughness == null || m.roughness > 0.92)) {
              m.roughness = 0.92;
            }
          }
        }
        m.needsUpdate = true;
      }
    }
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
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  const view = (WEAPONS[id] && WEAPONS[id].view) || {};
  g.userData.muzzleOffset = (view.muzzle || [0, 0.05, -0.5]).slice();
  g.userData.ejectOffset = (view.eject || [0.03, 0.05, -0.1]).slice();
  g.userData.placeholder = true;
  g.userData.weaponId = id;
  return g;
}

/**
 * Load (and cache) the FP viewmodel GLB for a weapon id. Resolves to a
 * THREE.Group with userData:
 *   { weaponId, muzzle: Object3D|null, eject: Object3D|null,
 *     muzzleOffset:[3], ejectOffset:[3], placeholder?:true }
 * Callers clone via SkeletonUtils/clone() if they need independent copies;
 * viewmodel.js uses the cached prototype directly (single consumer).
 */
export async function loadWeaponGLB(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const w = WEAPONS[id];
    const rel = (w && w.view && w.view.glb) ? w.view.glb.split("/").pop() : `${id}.glb`;
    const url = new URL(rel, GLB_BASE).href;
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
      // W1 (iter03): ADS alignment BY CONSTRUCTION, not by a copied number.
      // weapon_data's view.sightY is transcribed by hand from the build tool's
      // A4BUILD report and it drifts — this session the tool reported warden
      // 0.134 / vesper 0.0997 / corvus 0.106 against declared 0.126 / 0.0967 /
      // 0.103, i.e. up to 8 mm, ~1.8 deg of aim error at the 0.26 m ADS pose.
      // viewmodel.js parks the mount at y = -view.sightY for ADS, so shifting
      // the prototype by (declared - built) puts the real sight line on the vm
      // camera's centre ray whatever the data file says. Falls back to a no-op
      // when the GLB predates the socket.
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

      // ---- W1 (iter03) REAR STANDOFF -------------------------------------
      // THE iter01-03 "shattered white polygon" framing bug, measured:
      // weapon_data's posHip/posAds place the GRIP, and the GLB origin IS the
      // grip — so the buttstock sticks out BEHIND the origin, straight at the
      // eye. Rearmost vertex vs. pose (Blender -Y = glTF +Z, this session):
      //   warden  rear +0.246 @ posHip z -0.34  ->  9.4 cm from the camera
      //   corvus  rear +0.313 @ posHip z -0.40  ->  8.8 cm
      //   vesper  rear +0.247 @ posHip z -0.30  ->  5.3 cm
      // A 10 cm buttstock viewed from 9 cm at the vm camera's 60 deg vFOV
      // subtends ~58 deg — the whole frame. That is what S1/S6 were showing:
      // not broken geometry (the rifle clay-renders clean, iso render this
      // session) but the REAR OF THE RECEIVER at macro range, where the base
      // mesh's own facets read as polygon soup. No amount of material or mesh
      // work fixes a camera that is inside the gun.
      // Rule, not a per-asset fudge: measure the prototype and publish the
      // forward push its rearmost point needs to clear REAR_CLEAR at the HIP
      // pose. viewmodel.js applies it to the HIP term only and blends it out
      // with adsEase — ADS must NOT be pushed: a shouldered rifle's stock IS
      // behind the eye (the near plane is the correct thing to remove it), and
      // shoving the weapon out at ADS shrinks the sight picture, which is the
      // one thing that frame exists to show. Pure Z either way, so the sight
      // stays on x=0,y=0 at ADS and alignment is untouched.
      const REAR_CLEAR = 0.28;   // m of air between the eye and the butt pad
      const MAX_PUSH = 0.28;     // never shove a weapon out to arm's length
      // Measure the WEAPON, not the arms: a forearm is supposed to run past
      // the eye and get clipped (that is what a real one does), and letting it
      // drive the rule shoved the Pike — a 23 cm pistol whose own rearmost
      // point is 5 cm behind the grip — out to 0.49 m on the strength of a
      // 19 cm arm stub. Arm objects are named arms_<side>_<weapon> by
      // a4_build_fp_weapons.py's place_arms().
      const box = new THREE.Box3();
      group.traverse((o) => {
        if (!o.isMesh) return;
        let n = o;
        while (n && n !== group) { if (/^arms?_/.test(n.name || "")) return; n = n.parent; }
        box.expandByObject(o);
      });
      if (box.isEmpty()) box.setFromObject(group);
      const hipZ = (w && w.view && w.view.posHip) ? w.view.posHip[2] : -0.34;
      const rearCam = hipZ + box.max.z;     // camera-space z, negative = ahead
      const push = Math.min(MAX_PUSH, Math.max(0, rearCam + REAR_CLEAR));
      group.userData.hipPush = push;
      if (push > 0) {
        console.info(`[A4] ${id}: rear standoff ${(-rearCam * 100).toFixed(1)} cm ` +
          `at the hip pose — hipPush ${(push * 100).toFixed(1)} cm (0 at full ADS)`);
      }
      group.userData.sight = sight;
      group.userData.weaponId = id;
      group.userData.muzzle = muzzle;
      group.userData.eject = eject;
      group.userData.muzzleOffset = (w && w.view && w.view.muzzle ? w.view.muzzle : [0, 0.05, -0.5]).slice();
      group.userData.ejectOffset = (w && w.view && w.view.eject ? w.view.eject : [0.03, 0.05, -0.1]).slice();
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

/** Prototypes loaded so far (resolved only) — viewmodel.prewarmables() source.
 *  Prewarm runs in boot phase 5, after phase 4 awaited warden+pike, so the
 *  mission-loadout prototypes are always present here by then. */
export function loadedPrototypes() {
  const out = [];
  for (const p of cache.values()) {
    if (p && p._resolved) out.push(p._resolved);
  }
  return out;
}
