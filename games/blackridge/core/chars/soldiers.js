// core/chars/soldiers.js [A8] — spawn/interp/death; ready() gate; attach
// (architecture §3.15, BUILD_PLAN §A8). soldiers.ready() gates MISSION start,
// never boot (requiredBodies pattern); bodies stream in the background during
// the menu. View reads sim.state.bots + the frozen event vocabulary — never
// writes gameplay.
//
// Implements: R15 bodies (soldier + juggernaut, archetype tint variants),
// VT §7 (aim-pose blend toward aimAt, directional deaths, 70 ms color-multiply
// flinch flash — never emissive, bodies persist), interpolated state reads
// with alpha, off-screen 1-in-3 pose evaluation with dt accumulation,
// LD §5.4 wet-shoulder (inside actor.js material prep), 3P carried weapons
// (last-circle Meshy wpn3p_* with the transliterated orientation/grip recipe).

import * as THREE from "three";
import { loadBody, createActor, loadGLB } from "./actor.js";
import { validateAnimMap } from "./anim_map.js";

// ---------------------------------------------------------------------------
// 3P weapon protos — transliterated from last-circle weapons.js (the proven
// recipe; memory: transliterate ports, no prose round-trip).
// ---------------------------------------------------------------------------
const WPN_GLB = {
  ar: "assets/chars/wpn3p_ar.glb",
  smg: "assets/chars/wpn3p_smg.glb",
  sniper: "assets/chars/wpn3p_sniper.glb",
};
// Overall length in metres. iter06: the old set (0.62 / 0.50 / 0.95) was
// sub-scale — a 0.62 m "assault rifle" is a prop, and it is also WHY the
// support hand had nothing to hold: the grip anchor sits 0.26 m behind the
// muzzle while the Mixamo rifle clips put the support fist ~0.35 m forward of
// the firing fist, so the handguard physically could not reach it (measured
// live this session: support fist at 0.372 m in weapon space vs a 0.322 m
// forward extent). These are the real lengths of the classes they represent —
// M4-with-stock-out 0.84, MP5-class 0.66, DMR 1.05 — which puts the support
// fist at ~85% of each weapon's forward extent, i.e. ON the handguard.
const WPN_LEN = { ar: 0.84, smg: 0.66, sniper: 1.05 };
// MANUAL 180° overrides (last-circle owner playtest, verified by screenshots):
// the muzzle-thin/stock-dense heuristic picks WRONG on the AR — its rail/mag
// block out-clusters the stock. Same source GLBs, same override.
const WPN_FLIP = { ar: true };
// weapon id → 3P model kind (R4 ids; heavies carry warden → ar)
const WPN_KIND = { warden: "ar", vesper: "smg", corvus: "sniper", pike: "smg" };

// Module-level proto cache. NEVER stash the proto in userData: Object3D.copy
// JSON-stringifies userData on every clone, and a THREE.Group in there is
// circular — measured this session as a pageerror storm on spawn.
const WPN_PROTO_CACHE = new Map(); // kind -> Promise<Group>

// ---------------------------------------------------------------------------
// 3P WEAPON MATERIAL — parkerised steel + polymer furniture (iter06, ranked
// fix 7: "UNACTIONED FOR THREE CONSECUTIVE ITERATIONS", 3/3 critics).
//
// The defect, measured this session rather than assumed: the Meshy source GLBs
// ship a BAKED SATURATED albedo — the AR's baseColorTexture means sRGB
// (106,116,51) over the 69% of its texels with saturation > 0.30, i.e. the
// whole receiver/handguard/stock is highlighter lime; the sniper's is orange-
// brown. The old repair here only touched metalness/roughness FACTORS, so the
// lime went to the screen untouched and read as a missing-texture fallback.
// Its metallicRoughness map is also a real map (mean G 102/255 → roughness
// 0.40, B 9/255 → metalness 0.035), so factor 0.35/0.55 multiplied DOWN to
// roughness ~0.22 / metalness ~0.01: glossy dielectric, i.e. lime PLASTIC.
//
// Fix at the generator, not the artifact (doctrine §1/§3): remap the authored
// albedo through a luminance classifier into the same treatment the FP guns
// get (weapon_meshes.js repair(): read the maps as authored, let roughness
// vary PER PART, no albedo blowout). Dark source texels are the barrel/optic/
// magazine → parkerised phosphate steel; bright source texels are the painted
// furniture → black polymer. The two albedos sit close together (a cohesive
// dark firearm); the READ comes from the generated roughness/metalness map,
// which is VT §3's "distinct roughness per part" done per texel. Source tonal
// variation survives as a brightness modulation so the result is not a flat
// grey slab, and the GLB's normal map keeps carrying the real surface detail.
const GUN_STEEL = [85, 88, 92];    // parkerised receiver/barrel, sRGB
const GUN_POLY = [66, 68, 71];     // black polymer furniture, sRGB
const GUN_STEEL_R = 0.40, GUN_STEEL_M = 0.70;
const GUN_POLY_R = 0.76, GUN_POLY_M = 0.05;

/** Build {albedo, orm} CanvasTextures from an authored baseColor texture.
 *  Returns null when there is nothing to read (headless, or a mapless
 *  material) — the caller then falls back to flat gunmetal. */
function buildGunMaps(src) {
  if (!src || !src.image || typeof document === "undefined") return null;
  const img = src.image;
  const w = img.width | 0, h = img.height | 0;
  if (!w || !h) return null;
  const ac = document.createElement("canvas");
  ac.width = w; ac.height = h;
  const ag = ac.getContext("2d", { willReadFrequently: true });
  if (!ag) return null;
  ag.drawImage(img, 0, 0, w, h);
  const idat = ag.getImageData(0, 0, w, h);
  const px = idat.data;
  const n = w * h;

  // Percentile-normalise luminance so ONE classifier works across the whole
  // set (the AR is bright-lime dominant, the SMG is dark-dominant): a fixed
  // threshold would classify a whole weapon as one material.
  const hist = new Uint32Array(256);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const L = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
    lum[i] = L;
    hist[L | 0]++;
  }
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.05) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.95) { hi = v; break; } }
  const span = Math.max(8, hi - lo);

  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const og = oc.getContext("2d");
  if (!og) return null;
  const odat = og.createImageData(w, h);
  const opx = odat.data;
  for (let i = 0; i < n; i++) {
    let t = (lum[i] - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let u = (t - 0.35) / 0.30;              // smoothstep → polymer weight
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const pw = u * u * (3 - 2 * u);
    const f = 0.85 + 0.30 * t;              // keep the authored tonal variation
    const j = i * 4;
    px[j] = Math.min(255, (GUN_STEEL[0] + (GUN_POLY[0] - GUN_STEEL[0]) * pw) * f);
    px[j + 1] = Math.min(255, (GUN_STEEL[1] + (GUN_POLY[1] - GUN_STEEL[1]) * pw) * f);
    px[j + 2] = Math.min(255, (GUN_STEEL[2] + (GUN_POLY[2] - GUN_STEEL[2]) * pw) * f);
    px[j + 3] = 255;
    opx[j] = 255;                                                     // (unused AO)
    opx[j + 1] = (255 * (GUN_STEEL_R + (GUN_POLY_R - GUN_STEEL_R) * pw)) | 0;
    opx[j + 2] = (255 * (GUN_STEEL_M + (GUN_POLY_M - GUN_STEEL_M) * pw)) | 0;
    opx[j + 3] = 255;
  }
  ag.putImageData(idat, 0, 0);
  og.putImageData(odat, 0, 0);

  const albedo = new THREE.CanvasTexture(ac);
  const orm = new THREE.CanvasTexture(oc);
  for (const t2 of [albedo, orm]) {
    // glTF textures are flipY:false and the pixels were read/written in the
    // SOURCE orientation — copying the sampler state keeps the UVs valid.
    t2.flipY = src.flipY;
    t2.wrapS = src.wrapS; t2.wrapT = src.wrapT;
    t2.repeat.copy(src.repeat); t2.offset.copy(src.offset);
    t2.anisotropy = src.anisotropy;
    if (src.channel !== undefined) t2.channel = src.channel;
    t2.needsUpdate = true;
  }
  albedo.colorSpace = THREE.SRGBColorSpace;
  orm.colorSpace = THREE.NoColorSpace;
  return { albedo, orm };
}

function repairGunMaterial(mat) {
  if (!mat || mat.userData.__brGun) return;
  mat.userData.__brGun = true;
  // Meshy's emissive channel is the albedo-as-emissive export bug class — a
  // gun that glows cannot darken in shadow and feeds the bloom threshold.
  mat.emissiveMap = null;
  if (mat.emissive) mat.emissive.setHex(0x000000);
  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0;
  // W1's iter05 lesson, transliterated: envMapIntensity 1.0 on metal mirrors
  // the sky PMREM and renders as chrome. 0.5 keeps the wet-metal cue.
  mat.envMapIntensity = 0.5;
  let built = null;
  try {
    built = buildGunMaps(mat.map);
  } catch (e) {
    console.warn("[soldiers] 3P gun albedo remap failed — flat gunmetal", e);
  }
  if (built) {
    mat.map = built.albedo;
    mat.roughnessMap = built.orm;
    mat.metalnessMap = built.orm;
    mat.roughness = 1.0;   // the generated map is authoritative for both
    mat.metalness = 1.0;
    if (mat.color) mat.color.setHex(0xffffff);
  } else {
    mat.map = null;
    mat.roughnessMap = null;
    mat.metalnessMap = null;
    if (mat.color) mat.color.setHex(0x494c50);
    mat.roughness = 0.52;
    mat.metalness = 0.45;
  }
  mat.needsUpdate = true;
}

function prepWeaponProto(kind) {
  if (!WPN_PROTO_CACHE.has(kind)) WPN_PROTO_CACHE.set(kind, _prepWeaponProto(kind));
  return WPN_PROTO_CACHE.get(kind);
}

async function _prepWeaponProto(kind) {
  const gltf = await loadGLB(`./${WPN_GLB[kind]}`);
  const m = gltf.scene;
  // Meshy "side view" renders at a 3/4 angle sometimes → barrel diagonal in
  // XZ. Search the yaw that minimizes cross-width so the barrel lands on +Z.
  const bb = new THREE.Box3(), sz = new THREE.Vector3();
  let bestYaw = 0, bestW = 1e9;
  for (let deg = 0; deg < 180; deg += 3) {
    m.rotation.y = (deg * Math.PI) / 180;
    m.updateMatrixWorld(true);
    bb.setFromObject(m).getSize(sz);
    if (sz.x < bestW) { bestW = sz.x; bestYaw = m.rotation.y; }
  }
  m.rotation.y = bestYaw;
  m.updateMatrixWorld(true);
  bb.setFromObject(m);
  // 180° ambiguity: muzzle end is thin (few verts), grip/stock end dense.
  {
    const zMin = bb.min.z, zMax = bb.max.z, third = (zMax - zMin) / 3;
    let front = 0, back = 0;
    const wp = new THREE.Vector3();
    m.traverse((o) => {
      if (!o.isMesh) return;
      const posA = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(posA.count / 2000));
      for (let i = 0; i < posA.count; i += step) {
        wp.fromBufferAttribute(posA, i).applyMatrix4(o.matrixWorld);
        if (wp.z > zMax - third) front++;
        else if (wp.z < zMin + third) back++;
      }
    });
    if (front > back) { m.rotation.y += Math.PI; m.updateMatrixWorld(true); }
  }
  if (WPN_FLIP[kind]) { m.rotation.y += Math.PI; m.updateMatrixWorld(true); }
  // normalize to class length
  const size = bb.setFromObject(m).getSize(new THREE.Vector3());
  const s = WPN_LEN[kind] / Math.max(size.x, size.y, size.z, 0.001);
  m.scale.setScalar(s);
  m.updateMatrixWorld(true);
  // GRIP ANCHOR: the handle is the dense vertex cluster in the bottom third —
  // attach THAT to the hand (centering made guns float mid-body).
  bb.setFromObject(m);
  const yBand = bb.min.y + (bb.max.y - bb.min.y) * 0.34;
  const grip = new THREE.Vector3(); let gN = 0; const wp = new THREE.Vector3();
  m.traverse((o) => {
    if (!o.isMesh) return;
    const posA = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(posA.count / 3000));
    for (let i = 0; i < posA.count; i += step) {
      wp.fromBufferAttribute(posA, i).applyMatrix4(o.matrixWorld);
      if (wp.y <= yBand) { grip.add(wp); gN++; }
    }
  });
  if (gN) grip.multiplyScalar(1 / gN); else bb.getCenter(grip);
  grip.z += (WPN_LEN[kind] > 0.55 ? 0.06 : 0.0); // long guns: stock clears the arm
  m.position.sub(grip); // grip → hand origin
  // Real firearm material (doctrine §1 repair, weapon edition — iter06).
  const done = new Set();
  m.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (mat && !done.has(mat)) { done.add(mat); repairGunMaterial(mat); }
    }
    o.castShadow = true;
    o.frustumCulled = false; // rides a skinned hand — bounds lie like the body's
  });
  // SUPPORT-HAND HOLD HEIGHT. The weapon origin is the pistol-grip anchor,
  // which sits well BELOW the bore, so the line from the firing palm to the
  // support hand is NOT the bore — it rises toward the muzzle. actor.js needs
  // one number to correct for that: how far above the origin the underside of
  // the handguard sits. Measured off this weapon's own geometry (the 25th-
  // percentile y over the forward z-band a support hand can reach, which is
  // past the magazine and short of the muzzle device), so it is right for any
  // weapon a later wave drops in — never a per-model constant.
  m.updateMatrixWorld(true); // position.sub(grip) above left matrixWorld stale
  bb.setFromObject(m);
  const zF = bb.max.z;
  const ys = [];
  m.traverse((o) => {
    if (!o.isMesh) return;
    const posA = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(posA.count / 3000));
    for (let i = 0; i < posA.count; i += step) {
      wp.fromBufferAttribute(posA, i).applyMatrix4(o.matrixWorld);
      if (wp.z > zF * 0.40 && wp.z < zF * 0.85) ys.push(wp.y);
    }
  });
  ys.sort((a, b) => a - b);
  const hold = ys.length ? ys[Math.floor(ys.length * 0.25)] : 0.06 * WPN_LEN[kind];
  const g = new THREE.Group();
  g.userData.brHold = hold;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// createSoldiers
// ---------------------------------------------------------------------------

// archetype → body when content is the inline fallback ({} archetypes)
const DEFAULT_BODY = { heavy: "juggernaut" };
const DEFAULT_TINTS = { rifleman: "#4b5142", cqb: "#3a3e46", marksman: "#414b56", heavy: "#33292b" };

// module scratch (0 allocations inside update)
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
function dampAngle(cur, target, lambda, dt) {
  return cur + wrapAngle(target - cur) * (1 - Math.exp(-lambda * dt));
}

export function createSoldiers(ctx) {
  const actors = new Map();       // botId -> rec
  const pendingSpawns = [];       // spawn events that arrived before protos
  const protos = {};              // bodyName -> proto
  const wpnProtos = {};           // kind -> Group proto
  let protosReady = false;
  let loadError = null;
  let loadPromise = null;
  let viewT = 0;                  // monotonic view clock (flash timing)
  const botIndex = new Map();     // persistent per-frame id -> bot index
  let lastSimT = null;            // sim clock latch (held-frame detection)

  // ---- contact shadows (ranked fix 5) --------------------------------------
  // VT §1 amateur tell #2: iter04 had NO character grounded. Critic-a measured
  // the S9 ground directly under the soldier's boots at RGB 154/165/177 against
  // 44/51/61 away from him — the brightest patch in the shot was exactly where
  // his contact shadow belonged. There is no character light to remove (actor.js
  // strips every light out of the GLB); that lift is the wet-cobble specular
  // sheen that peaks toward frame centre, and the only thing missing was the
  // shadow itself. Slots come from fx's ONE shared grounding pool (core/fx/
  // grounding.js) — never a per-system blob — resolved lazily through the
  // test-surface global exactly as fx.js resolves the light pool.
  const CONTACT = {
    // Half-extents of the QUAD, not of the visible core: the radial falloff
    // reaches zero at the quad edge, so the dark part is roughly half of this.
    rx: 0.56, rz: 0.50,
    strength: 0.88,       // peak alpha multiplier at full contact
    fadeH: 0.55,          // metres of airborne lift that fades the blob to 0
    deadR: 1.15,          // prone body: wider, softer
    deadS: 0.64,
  };
  let groundingApi = null;
  function grounding() {
    if (groundingApi) return groundingApi;
    const fx = ctx.fx || ((typeof window !== "undefined" && window.__FPS__)
      ? window.__FPS__.fx : null);
    if (fx && fx.grounding) groundingApi = fx.grounding;
    return groundingApi;
  }

  function archBody(arch) {
    const a = ctx.content && ctx.content.archetypes && ctx.content.archetypes[arch];
    if (a && a.bodyGlb) return a.bodyGlb.replace(/^.*\/|\.glb$/g, "");
    if (a && a.body) return a.body;
    return DEFAULT_BODY[arch] || "soldier";
  }
  function archTint(arch) {
    const a = ctx.content && ctx.content.archetypes && ctx.content.archetypes[arch];
    return (a && a.tint) || DEFAULT_TINTS[arch] || "#4b5142";
  }
  function archWpnKind(arch) {
    const a = ctx.content && ctx.content.archetypes && ctx.content.archetypes[arch];
    return WPN_KIND[a && a.weapon] || "ar";
  }

  /** Load everything the mission cast needs. Idempotent; shared promise. */
  function ensureLoaded(archetypes, onProgress) {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const names = archetypes && archetypes.length
        ? archetypes : ["rifleman", "cqb", "marksman", "heavy"];
      const bodies = [...new Set(names.map(archBody))];
      if (!bodies.includes("soldier")) bodies.push("soldier"); // test-surface spawns
      const kinds = [...new Set(names.map(archWpnKind))];
      const steps = bodies.length + kinds.length + 1;
      let done = 0;
      const tick = () => { done++; if (onProgress) onProgress(done / steps); };

      for (const b of bodies) {
        try {
          protos[b] = await loadBody(b);
        } catch (e) {
          // Honest dev placeholder + ship blocker (doctrine §7 / arch §0.9).
          console.error(`[soldiers] body GLB failed: ${b}`, e);
          (window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || []).push(
            { lane: "A8", asset: `assets/chars/${b}.glb`, reason: String(e) });
          protos[b] = null;
        }
        tick();
      }
      for (const k of kinds) {
        try {
          wpnProtos[k] = await prepWeaponProto(k);
        } catch (e) {
          console.error(`[soldiers] 3P weapon GLB failed: ${k}`, e);
          (window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || []).push(
            { lane: "A8", asset: WPN_GLB[k], reason: String(e) });
          wpnProtos[k] = null;
        }
        tick();
      }

      // CONTRACT GATE (runs at load): every semantic anim must resolve to a
      // loaded clip on every loaded body. Throws — a dangling clip is a build
      // failure, never a frozen soldier on stage.
      for (const b of bodies) {
        if (protos[b]) validateAnimMap(protos[b].clipNames);
      }

      // Program + texture prewarm BEFORE the mission (perf gate: programs
      // delta == 0 during play; compileAsync alone leaves ANGLE D3D11 texture
      // uploads cold — driftwake lesson — so also DRAW once into a scratch RT).
      try {
        const staging = new THREE.Group();
        staging.position.set(0, -500, 0);
        for (const b of bodies) if (protos[b]) staging.add(protos[b].scene);
        for (const k of kinds) if (wpnProtos[k]) staging.add(wpnProtos[k]);
        ctx.scene.add(staging);
        if (ctx.renderer.compileAsync) {
          await ctx.renderer.compileAsync(staging, ctx.camera, ctx.scene);
        } else {
          ctx.renderer.compile(ctx.scene, ctx.camera);
        }
        const rt = new THREE.WebGLRenderTarget(16, 16);
        const prevRT = ctx.renderer.getRenderTarget();
        ctx.renderer.setRenderTarget(rt);
        ctx.renderer.render(ctx.scene, ctx.camera);
        ctx.renderer.setRenderTarget(prevRT);
        rt.dispose();
        ctx.scene.remove(staging);
        // protos were reparented into staging — detach them back to limbo
        for (const b of bodies) if (protos[b]) protos[b].scene.removeFromParent();
        for (const k of kinds) if (wpnProtos[k]) wpnProtos[k].removeFromParent();
        tick();
      } catch (e) {
        console.warn("[soldiers] prewarm pass failed (non-fatal):", e);
        tick();
      }

      protosReady = true;
      flushPending();
    })();
    return loadPromise;
  }

  function flushPending() {
    if (!protosReady) return;
    const sim = ctx.sim();
    while (pendingSpawns.length) {
      const d = pendingSpawns.shift();
      // epoch/liveness check: only spawn if the bot still exists in the
      // CURRENT sim (a mission restart may have discarded it mid-load)
      if (sim && sim.state.bots.some((b) => b.id === d.botId)) spawnActor(d);
    }
  }

  function spawnActor(d) {
    if (actors.has(d.botId)) return;
    const bodyName = archBody(d.archetype);
    const proto = protos[bodyName] || null;
    const actor = createActor(proto);
    if (actor.placeholder && proto === null) {
      // loadBody already pushed the fallback flag; nothing more to report here
    }
    actor.setTint(archTint(d.archetype));
    const kind = archWpnKind(d.archetype);
    let wpn = null;
    if (wpnProtos[kind]) {
      wpn = wpnProtos[kind].clone(true); // shares geometry+materials — cheap
      actor.attachWeapon(wpn, "R");
    }
    // Model faces +Z locally; sim forward for yaw ψ is (-sin ψ, -cos ψ), so
    // the THREE root yaw is ψ + π (verified against sim.aimAt's convention).
    const rec = {
      botId: d.botId,
      archetype: d.archetype,
      actor,
      wpn,
      prev: [d.pos[0], d.pos[1], d.pos[2]],
      curr: [d.pos[0], d.pos[1], d.pos[2]],
      lastTick: -1,
      yaw: (d.yaw || 0) + Math.PI,
      yawTarget: (d.yaw || 0) + Math.PI,
      flashUntil: -1,
      flashOn: false,
      deathPlayed: false,
      skipN: (d.botId | 0) % 3, // stagger off-screen eval so thirds interleave
      skipAcc: 0,
      forceAnim: null,
      kick: 0,
      shadow: -1, // grounding slot, leased on the first update (fx may lag boot)
    };
    actor.root.position.set(d.pos[0], d.pos[1], d.pos[2]);
    actor.root.rotation.y = rec.yaw;
    ctx.scene.add(actor.root);
    actors.set(d.botId, rec);
  }

  function removeActor(botId) {
    const rec = actors.get(botId);
    if (!rec) return;
    const G = grounding();
    if (G && rec.shadow >= 0) G.free(rec.shadow);
    rec.shadow = -1;
    rec.actor.dispose();
    actors.delete(botId);
  }

  function clearAll() {
    const G = grounding();
    for (const rec of actors.values()) {
      if (G && rec.shadow >= 0) G.free(rec.shadow);
      rec.actor.dispose();
    }
    actors.clear();
    pendingSpawns.length = 0;
  }

  function onDeath(d) {
    const rec = actors.get(d.victim);
    if (!rec || rec.deathPlayed) return;
    rec.deathPlayed = true;
    // DIRECTIONAL DEATH (VT §7): the body is knocked AWAY from the shot —
    // face the shooter so the (backward-falling) Mixamo deaths read as impact
    // direction, not a canned flop. d.dir is the shot's travel direction.
    if (d.dir && (d.dir[0] || d.dir[2])) {
      const simYawFacingShooter = Math.atan2(d.dir[0], d.dir[2]);
      rec.yawTarget = simYawFacingShooter + Math.PI;
    }
    // Variant: honor the sim's latched death_a/death_b semantic (both resolve
    // to the one proven fall clip — see anim_map.js) and vary the playback
    // rate deterministically per victim so nearby deaths never read identical.
    const sim = ctx.sim();
    const bot = sim && sim.state.bots.find((b) => b.id === d.victim);
    const v = (bot && (bot.anim === "death_a" || bot.anim === "death_b")) ? bot.anim : "death_a";
    const ts = 0.88 + (d.victim % 4) * 0.08; // 0.88 / 0.96 / 1.04 / 1.12
    rec.actor.playOnce(v, { fade: 0.09, timeScale: ts });
    // Bodies persist ≥ 20 s (VT §7 / D6 permanence): nothing here removes the
    // actor — it stays until its bot leaves sim.state (checkpoint restore) or
    // mission:start clears the cast.
  }

  const soldiers = {
    /**
     * requiredBodies gate before mission start (frozen signature). Boot is
     * NEVER gated on this; startMission awaits it behind the mission loading
     * overlay. Progress cb feeds the determinate bar.
     */
    async ready(archetypes, onProgress) {
      await ensureLoaded(archetypes, onProgress);
      if (loadError) throw loadError;
      flushPending();
      if (onProgress) onProgress(1);
    },

    /** Registered on the frozen vocabulary only (architecture §4). */
    attach(bridge) {
      bridge.register("mission:start", () => { clearAll(); });
      bridge.register("spawn", (d) => {
        if (protosReady) spawnActor(d);
        else pendingSpawns.push(d);
      });
      bridge.register("death", (d) => {
        if (typeof d.victim === "number") onDeath(d);
      });
      bridge.register("hurt", (d) => {
        // 70 ms COLOR-MULTIPLY flinch flash — never emissive (VT §7).
        const rec = actors.get(d.victim);
        if (rec) rec.flashUntil = viewT + 0.07;
      });
      bridge.register("botstate", (d) => {
        // fallback: a bot can die from test-surface damage with the death
        // event filtered upstream — the state edge still buries it
        if (d.state === "dead") {
          const rec = actors.get(d.botId);
          if (rec && !rec.deathPlayed) onDeath({ victim: d.botId, dir: null });
        }
      });
      bridge.register("shot", (d) => {
        // fire-anim/kick ONLY on true fire-time events: impactOnly is a
        // late-resolving swept projectile, pen is an impact-face event (A1's
        // additive-field convention) — reacting to those replays the kick.
        if (d.impactOnly || d.pen) return;
        if (typeof d.shooter === "number") {
          const rec = actors.get(d.shooter);
          if (rec) rec.kick = 1;
        }
      });
    },

    /**
     * Per-frame: interpolate prev→curr tick positions with alpha, drive anims
     * from bot.anim, aim-blend, flash restore, off-screen 1-in-3 pose eval.
     */
    update(dt, alpha) {
      const sim = ctx.sim();
      if (!sim) return;
      const st = sim.state;
      const G = grounding();

      // ---- HELD-FRAME GUARD (ranked fix 5, S9 pose) ------------------------
      // boot's rAF loop calls viewUpdates() every frame whether or not the sim
      // stepped, so while the world is held for a battery pose the mixer kept
      // advancing on WALL time: the harness's 24-frame settle spends 3.70 s of
      // wall clock at 0.000 s of sim (measured live this session), which walks
      // a 1.2 s run cycle three times over and lands the pose wherever the
      // machine's frame rate happens to drop it. That is why S9's captured
      // stance is a mid-air stride with the rear boot off the cobbles: it is
      // not a chosen pose, it is a lottery. Freezing the mixer when the sim
      // clock does not move makes a held pose deterministic AND makes it the
      // pose the scenario's own settle ticks produced.
      const simHeld = (lastSimT !== null) && !(st.time > lastSimT);
      lastSimT = st.time;
      const dtAnim = simHeld ? 0 : dt;
      viewT += dtAnim;

      // one pass over state (persistent map — no per-frame allocation growth)
      botIndex.clear();
      for (let i = 0; i < st.bots.length; i++) botIndex.set(st.bots[i].id, st.bots[i]);

      // reconcile: create actors for bots that missed their spawn event
      if (protosReady) {
        for (const b of st.bots) {
          if (!actors.has(b.id)) {
            spawnActor({ botId: b.id, archetype: b.archetype, pos: b.pos, yaw: b.yaw });
            if (!b.alive) { // late join on a corpse: bury it without replaying
              const rec = actors.get(b.id);
              rec.deathPlayed = true;
              rec.actor.playOnce(b.anim === "death_b" ? "death_b" : "death_a", { fade: 0, timeScale: 1000 });
            }
          }
        }
      }

      // camera frustum for the off-screen eval discount
      _projView.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projView);

      for (const rec of actors.values()) {
        const bot = botIndex.get(rec.botId);
        if (!bot) { removeActor(rec.botId); continue; } // checkpoint restore reap
        const actor = rec.actor;

        // ---- interpolated position reads (alpha between the last two ticks)
        if (st.tick !== rec.lastTick) {
          if (st.tick - rec.lastTick === 1) {
            rec.prev[0] = rec.curr[0]; rec.prev[1] = rec.curr[1]; rec.prev[2] = rec.curr[2];
          } else { // >1 tick this frame (or teleport): snap, don't rubber-band
            rec.prev[0] = bot.pos[0]; rec.prev[1] = bot.pos[1]; rec.prev[2] = bot.pos[2];
          }
          rec.curr[0] = bot.pos[0]; rec.curr[1] = bot.pos[1]; rec.curr[2] = bot.pos[2];
          rec.lastTick = st.tick;
        }
        const a = Math.min(1, Math.max(0, alpha));
        actor.root.position.set(
          rec.prev[0] + (rec.curr[0] - rec.prev[0]) * a,
          rec.prev[1] + (rec.curr[1] - rec.prev[1]) * a,
          rec.prev[2] + (rec.curr[2] - rec.prev[2]) * a
        );

        // ---- facing (damped — pivots with weight, never snaps)
        if (bot.alive && !rec.forceAnim) rec.yawTarget = bot.yaw + Math.PI;
        rec.yaw = dampAngle(rec.yaw, rec.yawTarget, rec.deathPlayed ? 18 : 10, dtAnim);
        actor.root.rotation.y = rec.yaw;

        // ---- animation selection (sim's bot.anim is authoritative)
        const hs = bot.vel ? Math.hypot(bot.vel[0], bot.vel[2]) : 0;
        actor.groundSpeed = hs;
        actor.crouchW = 0;
        if (!bot.alive) {
          if (!rec.deathPlayed) onDeath({ victim: rec.botId, dir: null });
        } else if (rec.forceAnim) {
          actor.groundSpeed = rec.forceAnim === "run" ? 3.6 : rec.forceAnim === "walk" ? 1.5 : 0;
          actor.play(rec.forceAnim);
        } else if (bot.anim === "hit") {
          if (actor.currentName !== "hit") actor.playOnce("hit", { fade: 0.06 });
        } else {
          if (bot.anim === "crouch_walk") actor.crouchW = 1;
          actor.play(bot.anim);
        }

        // ---- 70 ms flinch flash restore (exact, view-clocked)
        const flashing = viewT < rec.flashUntil;
        if (flashing !== rec.flashOn) { rec.flashOn = flashing; actor.setFlash(flashing); }

        // ---- weapon fire kick (cosmetic; decays fast)
        if (rec.wpn && rec.kick > 0.001) {
          rec.wpn.position.z = -0.02 * rec.kick;
          rec.kick *= Math.exp(-22 * dtAnim);
        } else if (rec.wpn && rec.wpn.position.z !== 0) {
          rec.wpn.position.z = 0;
        }

        // ---- pose evaluation: off-screen actors evaluate 1-in-3 frames with
        // dt accumulation (perf budget §8) — position/yaw still track exactly
        _sphere.center.copy(actor.root.position);
        _sphere.center.y += 0.9;
        _sphere.radius = 1.3;
        const onScreen = _frustum.intersectsSphere(_sphere);
        rec.skipAcc += dtAnim;
        rec.skipN++;
        if (onScreen || rec.skipN % 3 === 0) {
          actor.update(rec.skipAcc);
          rec.skipAcc = 0;
          // aim-pose blend AFTER the mixer (it edits the spine bones the mixer
          // just wrote). Weight in for aim/fire, out for everything else.
          if (bot.alive) {
            let pitch = 0, yawDelta = 0, want = 0;
            if ((bot.anim === "aim" || bot.anim === "fire") && bot.aimAt) {
              const dx = bot.aimAt[0] - bot.pos[0];
              const dy = bot.aimAt[1] - (bot.pos[1] + 1.45);
              const dz = bot.aimAt[2] - bot.pos[2];
              const hl = Math.hypot(dx, dz) || 1e-9;
              pitch = Math.atan2(dy, hl);
              const aimYawThree = Math.atan2(dx, dz); // THREE θ: forward (sinθ,cosθ)
              yawDelta = Math.max(-0.6, Math.min(0.6, wrapAngle(aimYawThree - rec.yaw)));
              want = 1;
            }
            actor.aimBlend(pitch, yawDelta, want);
          }
        }

        // ---- contact shadow (ranked fix 5) ---------------------------------
        // Placement is the actor's own feet plane: bot.pos is the sim capsule
        // FOOT position, so the blob needs no downward raycast to be exact on
        // decks and stairs — the same contract fx.js uses to floor brass. The
        // terrain height is consulted only to fade the blob out while a body
        // is genuinely airborne (jump / fall), so a lifted stride foot keeps
        // its shadow and a vaulting soldier does not drag one through the air.
        if (G) {
          if (rec.shadow < 0) rec.shadow = G.alloc();
          if (rec.shadow >= 0) {
            const px = actor.root.position.x;
            const pz = actor.root.position.z;
            const py = actor.root.position.y;
            const gy = (ctx.colliders && ctx.colliders.groundY)
              ? ctx.colliders.groundY(px, pz) : 0;
            const contactY = Math.min(py, gy);
            const lift = Math.max(0, py - gy);
            const air = Math.max(0, 1 - lift / CONTACT.fadeH);
            const dead = !bot.alive;
            G.write(
              rec.shadow, px, contactY + 0.014, pz,
              dead ? CONTACT.deadR : CONTACT.rx,
              dead ? CONTACT.deadR : CONTACT.rz,
              (dead ? CONTACT.deadS : CONTACT.strength) * air);
          }
        }
      }
    },

    /** {alive, total} — read from the sim (the one source of truth). */
    count() {
      const sim = ctx.sim();
      if (!sim) return { alive: 0, total: 0 };
      let alive = 0;
      for (const b of sim.state.bots) if (b.alive) alive++;
      return { alive, total: sim.state.bots.length };
    },

    // ---- private (harness/debug only — not part of the frozen surface)
    _actors: actors,
    _debugPose(botId, anim) {
      const rec = actors.get(botId);
      if (rec) rec.forceAnim = anim || null;
    },
  };

  // Background prefetch during the menu (boot NEVER gated — §5 boot table):
  // kicked off a beat after construction so boot phase 4 isn't lengthened by
  // fetch scheduling. A validation failure in here throws out of a task →
  // page error → bootcheck catches it: that IS the anim_map gate at load.
  setTimeout(() => {
    ensureLoaded(ctx.content && ctx.content.archetypes
      ? Object.keys(ctx.content.archetypes).filter((k) => !k.startsWith("_")) : null)
      .catch((e) => {
        loadError = e;
        console.error("[soldiers] background load failed:", e);
        // contract-gate failures must be LOUD in dev (page error, not a log)
        setTimeout(() => { throw e; }, 0);
      });
  }, 0);

  return soldiers;
}
