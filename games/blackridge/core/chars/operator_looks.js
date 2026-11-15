// core/chars/operator_looks.js [a11] — operator variety on the ONE soldier skeleton.
//
// Ten identical bodies in a match looked cheap. Each operator now draws one of six
// LOOKS: modular gear (headgear, packs, pads, pouches — tools/a11_build_operators.py,
// assets/chars/op_gear.glb) rigidly skinned to the shared body's bones, plus a body
// recolour (cloth palette + camo contrast, skin tone) through the soldier shader's
// look uniforms (actor.js applyWetShoulder) and a small uniform scale. Every shared
// clip still drives every look: nothing here touches the skeleton or the clips.
//
// COST: one extra draw per operator (each look's pieces are merged into ONE skinned
// mesh at load, ~0.7-1.6k tris) + its shadow-pass draw; one extra program (gear),
// compiled in soldiers.ready()'s prewarm. Body recolour is a uniform branch in the
// existing soldier program (no new program).
//
// ASSIGNMENT (stable for the whole match, deterministic from identity):
//   match: the roster actor (bot.actorId; killcam ghosts carry the roster slot in
//   their id) -> its callsign. Within each side the callsigns are ranked by
//   nameHash(callsign) and dealt looks in rank order, so a team of five never shows
//   two identical operators; the other side starts three looks along. FFA ranks the
//   whole field (ten operators over six looks, at most two alike). The killcam ghost
//   of an operator therefore wears exactly what the live operator wore.
//   campaign (no roster): hash of the bot id.
//
// TEAM READ: every look carries an armband (and most a helmet/hat band or patch)
// authored in pure magenta; the gear shader swaps it for the team colour from
// core/team_color.js (friend = teamHex(0), hostile = teamHex(1), live on CVD change).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadGLB } from "./actor.js";
import { nameHash } from "../ai/personality.js";
import { teamHex } from "../team_color.js";

const GEAR_URL = "assets/chars/op_gear.glb";
const MASK_URL = "assets/chars/op_mask.png";
const GAME_ROOT = new URL("../../", import.meta.url);
const GHOST_BASE = 900000, GHOST_SLOTS = 16;   // = core/render/killcam.js (slot === roster actorId)

// cloth: rgb tint on luminance, a = camo contrast (1 keeps the pattern, 0 = solid);
// k = how far the cloth moves to the new palette (0 = the authored multicam)
// (2026-11-15 hold pass) value spread widened for the 30 m read: recon and sharp lifted
// (pale), breach and scout pushed darker, signal greener — one step each, so a squad
// reads as six people at range without any look drifting toward a team colour (the
// team read stays on the rim + armband + band accents, core/team_color.js)
export const LOOKS = [
  { id: "line",   scale: 1.00, k: 0.00, top: [1, 1, 1, 1],          low: [1, 1, 1, 1],          skin: [1.00, 1.00, 1.00] },
  { id: "recon",  scale: 0.97, k: 0.90, top: [1.58, 1.26, 0.86, 0.75], low: [1.40, 1.14, 0.80, 0.8], skin: [0.62, 0.50, 0.42] },
  { id: "breach", scale: 1.04, k: 0.94, top: [0.50, 0.52, 0.56, 0.35], low: [0.44, 0.46, 0.50, 0.3], skin: [0.82, 0.74, 0.66] },
  { id: "signal", scale: 1.00, k: 0.84, top: [0.72, 1.14, 0.56, 0.85], low: [0.66, 0.98, 0.54, 0.85], skin: [1.06, 1.00, 0.96] },
  { id: "scout",  scale: 0.98, k: 0.88, top: [0.84, 0.90, 1.04, 0.9],  low: [0.54, 0.58, 0.68, 0.8], skin: [0.46, 0.37, 0.31] },
  { id: "sharp",  scale: 1.02, k: 0.87, top: [1.24, 1.24, 0.80, 0.5],  low: [1.40, 1.20, 0.92, 0.6], skin: [0.92, 0.86, 0.80] },
];
export const LOOK_COUNT = LOOKS.length;
const FLATTEN_REF = 0.075;   // linear luminance a solid-colour cloth settles on

// ---------------------------------------------------------------- loading
let kitPromise = null;
/** Load + prepare the gear kit ONCE: per look a merged geometry + its bone names. */
export function loadOperatorKit() {
  if (kitPromise) return kitPromise;
  kitPromise = (async () => {
    const [gltf, mask] = await Promise.all([
      loadGLB(GEAR_URL),
      new Promise((res, rej) => new THREE.TextureLoader().load(new URL(MASK_URL, GAME_ROOT).href, res, undefined, rej)),
    ]);
    mask.flipY = false;                 // glTF UV convention, like the body's own map
    mask.colorSpace = THREE.NoColorSpace;
    mask.generateMipmaps = false;
    mask.minFilter = THREE.LinearFilter;
    mask.magFilter = THREE.LinearFilter;
    const parts = new Map();            // look -> [{geo, bone}]
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = /^L(\d+)__(\w+)$/.exec(o.name);
      if (!m) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
      if (!g.attributes.color) return;   // a11 always authors COLOR_0
      const look = +m[1];
      if (!parts.has(look)) parts.set(look, []);
      parts.get(look).push({ geo: g, bone: m[2] });
    });
    const looks = [];
    for (let i = 0; i < LOOK_COUNT; i++) {
      const list = parts.get(i) || [];
      if (!list.length) { looks.push(null); continue; }
      const bones = [...new Set(list.map((p) => p.bone))];
      const geos = list.map((p) => {
        const g = p.geo;
        const n = g.attributes.position.count;
        const bi = bones.indexOf(p.bone);
        const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
        for (let v = 0; v < n; v++) { si[v * 4] = bi; sw[v * 4] = 1; }
        g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
        // colours as a plain 3-component float attribute so every piece merges
        const c = g.attributes.color;
        if (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array)) {
          const out = new Float32Array(n * 3);
          for (let v = 0; v < n; v++) { out[v * 3] = c.getX(v); out[v * 3 + 1] = c.getY(v); out[v * 3 + 2] = c.getZ(v); }
          g.setAttribute("color", new THREE.Float32BufferAttribute(out, 3));
        }
        return g;
      });
      const merged = mergeGeometries(geos, false);
      merged.computeBoundingSphere();
      looks.push({ geometry: merged, bones, tris: (merged.index ? merged.index.count : merged.attributes.position.count) / 3 });
    }
    return { looks, mask };
  })();
  return kitPromise;
}

// ---------------------------------------------------------------- materials
let _gearBase = null;
function gearMaterial(accentHex) {
  if (!_gearBase) {
    _gearBase = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  }
  const m = _gearBase.clone();
  const rim = { c: { value: new THREE.Color(0, 0, 0) }, s: { value: 0 } };
  const acc = { value: new THREE.Color(accentHex || "#3a3c3e") };
  m.userData = { __brRim: rim, __brAcc: acc };
  m.customProgramCacheKey = () => "br_op_gear";
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBrRimC = rim.c;
    sh.uniforms.uBrRimS = rim.s;
    sh.uniforms.uBrAcc = acc;
    sh.fragmentShader =
      "uniform vec3 uBrRimC;\nuniform float uBrRimS;\nuniform vec3 uBrAcc;\n" +
      sh.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" +
        // pure magenta in the authored vertex colour = team accent
        "\tfloat brAcc = step(0.8, vColor.r) * step(0.8, vColor.b) * (1.0 - step(0.2, vColor.g));\n" +
        "\tdiffuseColor.rgb = mix(diffuseColor.rgb, uBrAcc * diffuse, brAcc);"
      ).replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n" +
        "\ttotalEmissiveRadiance += uBrAcc * (brAcc * 0.05);\n" +
        "\tfloat brRimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.2);\n" +
        "\ttotalEmissiveRadiance += uBrRimC * (uBrRimS * brRimF);"
      );
  };
  return m;
}

// rest (node-TRS) bone matrices of a proto, relative to its scene root — the pose the
// gear was authored against. Cached per proto scene.
const _restInv = new WeakMap();
function restInverses(protoScene) {
  let map = _restInv.get(protoScene);
  if (map) return map;
  map = new Map();
  protoScene.updateWorldMatrix(true, true);
  const rootInv = protoScene.matrixWorld.clone().invert();
  protoScene.traverse((o) => {
    if (!o.isBone) return;
    const rel = rootInv.clone().multiply(o.matrixWorld);
    map.set(o.name.replace(/^mixamorig:?/i, ""), rel.invert());
  });
  _restInv.set(protoScene, map);
  return map;
}

// ---------------------------------------------------------------- assignment
const _rankCache = new WeakMap();
function rosterLooks(match) {
  const actors = match.actors;
  let res = _rankCache.get(actors);
  if (res) return res;
  const twoTeams = Array.isArray(match.teams) && match.teams.length === 2;
  const groups = new Map();
  for (const a of actors) {
    if (!a) continue;
    const g = twoTeams ? a.team : 0;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(a);
  }
  res = new Map();
  for (const [g, list] of groups) {
    const ranked = list.slice().sort((x, y) =>
      (nameHash(x.name, 0xa11) - nameHash(y.name, 0xa11)) || (x.actorId - y.actorId));
    const off = twoTeams && g === 1 ? 3 : 0;
    ranked.forEach((a, i) => res.set(a.actorId, (i + off) % LOOK_COUNT));
  }
  _rankCache.set(actors, res);
  return res;
}

/** Roster actorId behind a soldiers.js id (live bot or killcam ghost), or null. */
export function actorIdOf(state, botId, bot) {
  if (botId >= GHOST_BASE) return (botId - GHOST_BASE) % GHOST_SLOTS;
  if (bot && bot.actorId != null) return bot.actorId;
  return null;
}

/** Look index for a roster actor (match) or a campaign bot id. */
export function lookFor(state, actorId, botId) {
  const m = state && state.match;
  if (m && Array.isArray(m.actors) && actorId != null && m.actors[actorId]) {
    const l = rosterLooks(m).get(actorId);
    if (l != null) return l;
  }
  return nameHash(String(botId | 0), 0xa11) % LOOK_COUNT;
}

/** Team-accent hex for a body seen from the human's seat (same rule as the rim). */
export function accentFor(state, team) {
  const m = state && state.match;
  if (!m) return null;                  // campaign: no team accent
  const pTeam = state.player ? state.player.team : 0;
  return teamHex(team === pTeam ? 0 : 1, m.teams);
}

// ---------------------------------------------------------------- dressing
/**
 * Dress a freshly created actor (soldier body only) in look `look`.
 * Must run BEFORE attachWeapon (the grip holder counter-scales the hand's world
 * scale at attach time, so the look's model scale has to be in place first).
 */
export function dressActor(actor, kit, proto, look, accentHex) {
  if (!actor || actor.placeholder || !kit || !proto || !actor.addGear) return null;
  const L = LOOKS[look] || LOOKS[0];
  actor._model.scale.setScalar(L.scale);
  actor.setLook(L.k > 0 || L.skin[0] !== 1 ? { mask: kit.mask, k: L.k, ref: FLATTEN_REF, top: L.top, low: L.low, skin: L.skin } : null);
  const g = kit.looks[look];
  let mesh = null;
  if (g) {
    const inv = restInverses(proto.scene);
    const bones = [], inverses = [];
    for (const nm of g.bones) {
      const b = actor._boneByName.get(nm);
      const i = inv.get(nm);
      if (!b || !i) return null;          // foreign rig: no gear rather than garbage
      bones.push(b); inverses.push(i.clone());
    }
    mesh = new THREE.SkinnedMesh(g.geometry, gearMaterial(accentHex));
    mesh.name = "op_gear_" + LOOKS[look].id;
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    mesh.frustumCulled = false;         // skinned bounds lie (doctrine §1)
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    actor.addGear(mesh);
  }
  actor._look = look;
  actor._gear = mesh;
  return mesh;
}

/** Re-tint a dressed actor's team accent (colour-blind mode change). */
export function setAccent(actor, hex) {
  const m = actor && actor._gear && actor._gear.material;
  if (m && m.userData.__brAcc) m.userData.__brAcc.value.set(hex || "#3a3c3e");
}
