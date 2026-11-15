/**
 * FFG runtime — 3d/ffg_scene.js  (ES module, FIXED TEMPLATE — not regenerated per game)
 *
 * The generic AAA environment assembler for the Three-kernel author target (Tier 3).
 * It reads content.json and dresses the Kernel3D scene with REAL Poly Haven PBR
 * materials + image-based lighting staged from F: by the pipeline
 * (pipeline/art/material_library + hdri_library + texture_transcode):
 *   • ground + scenery on MeshStandardMaterial with map/roughnessMap/aoMap/normalMap
 *   • scene.environment from a prefiltered .hdr (RGBELoader -> kernel.setEnvironment)
 *   • bloom + ground-truth AO via the kernel's post stack
 * This is what routes the F: assets THROUGH the AAA renderer — the keystone wiring.
 *
 * Per-game variation lives in content.json (theme, material manifest, env path); this
 * file is generic so it versions like the kernel. Gameplay is layered on top by the
 * claude -p kernel-authoring step, which overrides buildGameplay() (see the stub).
 */
import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

const SURFACE_TINT = {            // fallback flat colours when F: materials aren't staged
  ground: 0x6b6f63, concrete: 0x8a8d86, rock: 0x6d6960, sand: 0xc9b487,
  grass: 0x5c7a44, wood: 0x6b4b2e, brick: 0x9c6b4f, metal: 0x9aa3ad, wall: 0x8f8a80,
};

function _texLoader() { return new THREE.TextureLoader(); }

// Build a MeshStandardMaterial from a staged material manifest entry, or a tinted
// fallback if no maps were staged (F: absent). diffuse is sRGB; data maps are linear.
function makeMaterial(entry, key) {
  if (!entry || !entry.dir || !(entry.maps && entry.maps.length)) {
    return new THREE.MeshStandardMaterial({ color: SURFACE_TINT[key] || 0x808080, roughness: 0.95, metalness: 0.0 });
  }
  const loader = _texLoader();
  const rep = entry.repeat || [1, 1];
  const load = (name, srgb) => {
    const t = loader.load(`${entry.dir}/${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const has = (n) => entry.maps.indexOf(n) !== -1;
  const mat = new THREE.MeshStandardMaterial({ roughness: 1.0, metalness: 0.0 });
  if (has("diffuse")) mat.map = load("diffuse", true);
  if (has("rough")) mat.roughnessMap = load("rough", false);
  if (has("ao")) mat.aoMap = load("ao", false);
  if (has("normal")) { mat.normalMap = load("normal", false); mat.normalScale = new THREE.Vector2(1, 1); }
  return mat;
}

// IBL from a prefiltered .hdr -> scene.environment (real sky-tinted ambient/reflections).
function applyEnvironment(kernel, content) {
  if (!content.env) return;
  try {
    new RGBELoader().load(content.env, (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      kernel.setEnvironment(hdr, content.envIntensity != null ? content.envIntensity : 1.0);
      if (content.envAsBackground) kernel.scene.background = hdr;
    });
  } catch (e) { console.warn("[scene] env load failed:", e && e.message); }
}

// The deterministic AAA environment: textured ground + a little scenery so the PBR +
// IBL is visible immediately. Gameplay (units, goals, input) is added by buildGameplay.
export function buildEnvironment(kernel, content) {
  const mats = content.materials || {};
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160, 1, 1),
    makeMaterial(mats.ground, "ground"));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  kernel.scene.add(ground);

  // a ring of scenery blocks on a second material — shows normal/AO + contact shadows
  const wallMat = makeMaterial(mats.wall || mats.ground, "wall");
  const N = 10, R = 34;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const h = 4 + (i % 3) * 3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(6, h, 6), wallMat);
    b.position.set(Math.cos(a) * R, h / 2, Math.sin(a) * R);
    b.castShadow = b.receiveShadow = true;
    kernel.scene.add(b);
  }
  applyEnvironment(kernel, content);
  try { kernel.enableBloom({ strength: 0.5, gtao: true, smaa: true }); } catch (e) {}
  return { ground };
}

// GAMEPLAY EXTENSION POINT. The deterministic scaffold ships a lit, textured, orbitable
// scene (proves AAA render + F: assets). The claude -p kernel-authoring step overrides
// this to add the actual genre (units, turns, projectiles, win/lose) on top of the same
// renderer + materials. Kept as a named export so authoring can re-emit just this file.
export function buildGameplay(kernel, content, env) {
  if (typeof kernel.enableOrbit === "function") kernel.enableOrbit({ wasdPan: true });
  kernel.hud(`<div style="position:absolute;top:12px;left:12px;font-size:13px;opacity:.85">`
    + `${(content.title || content.slug || "Scene")} — AAA scaffold (Three-kernel + F: PBR/IBL)</div>`);
}
