/**
 * royale/weapons.js — the 9-gun BR arsenal: pistol, SMG, AR, shotgun, sniper,
 * grenade launcher + (parity P2-D, LC-16) marksman rifle, LMG and burst rifle.
 * Firing (explicit fire modes: auto / semi / burst, sim WEAPONS[id].fire),
 * projectiles, recoil, reload, splash, smoke clouds (C-SMOKE: W.smokes) and the
 * bone-derived hit volumes (LC-22, sim HITVOL).
 *
 * Projectiles are REAL (position + velocity), stepped in
 * segments each frame and tested against static world boxes → terrain → actor
 * capsules — nearest hit wins. "Hitscan-fast" weapons are just very fast
 * projectiles, so travel time comes free for the sniper. Bullets fly FLAT:
 * no weapon definition ever carried a `gravity` field, so the drop this header
 * used to promise was never actually simulated. Only the grenade launcher arcs,
 * lobbing shells that burst on a body hit or after a short fuse.
 *
 * No firing while swimming (industry standard). No melee and no building — this
 * is a pure BR shooter. One throwable exists BUILT DARK (parity P1-A, LC-14): the
 * frag grenade, a CONSUMABLE with `throws` thrown by its own branch in stepWeapon
 * (throwRound) as a pooled bouncing round that bursts through explode(). Its loot
 * weight is 0 until bots can throw it (P2-B / P2-D). The smoke grenade (C-SMOKE)
 * is thrown by the same branch and on its fuse becomes a sphere on W.smokes.
 * Launcher shells burst on CONTACT (wall, ground, body), not on a bounce.
 * A downed actor (C-DBNO) cannot fire, reload, throw, heal or switch.
 *
 * View models: Meshy GLBs for the six original guns (composed low-poly builds
 * as the fallback); the P2-D guns are CC0 Poly Pizza models baked to
 * assets/props/wpn_cc0/ (credits: _spec/parity_2026-10/credits_sim.md -> CREDITS.md).
 */
import * as THREE from "three";

let K = null;
const projectiles = [];
const POOL = [];
let protosPromise = null;

export function init(W) {
  K = W.SIM;
  W.equipSlot = (a, idx) => equipSlot(W, a, idx);
  // net.js needs this for remote actors: their a.weapon comes from snapshots,
  // never through equipSlot, so without this hook a remote's rendered gun
  // stayed the spawn pistol for the whole match no matter what they carried
  W.refreshWeaponMesh = (a) => refreshWeaponMesh(W, a);
  W.explode = (x, y, z, weaponId, rarity, ownerId) => explode(W, x, y, z, weaponId, rarity, ownerId);
  // C-SMOKE: the live smoke spheres. ONE array for the session, mutated in place (fx.js / maps.js losBlocked /
  // bots.js may keep the reference). W.deploySmoke lets net.js replay a remote client's smoke at its own spot.
  if (!Array.isArray(W.smokes)) W.smokes = [];
  W.deploySmoke = (x, y, z, ownerId, t0) => deploySmoke(W, x, y, z, ownerId, t0);
  // LC-22: the same bone-derived volumes the bullets test, for any caller that needs "is this ray on the body"
  // (hud.js aim-at name tags per OD-11, bots' line checks). Returns the entry distance along the unit ray or -1.
  W.hitVolRay = (t, ox, oy, oz, dx, dy, dz, maxT) => hitVolRay(W, t, ox, oy, oz, dx, dy, dz, maxT);
  // the live joints the hit test would use for t right now (sim HITVOL_LIVE layout, world) or null = the table (probes / harness)
  W.hitVolLiveJoints = (t) => liveJoints(W, t);
  protosPromise = null;
  W.weaponProto = (id) => protos(W).then((p) => p[id]);
}

function protos(W) {
  if (!protosPromise) protosPromise = buildProtos(W).then((p) => { W._weaponProtos = p; return p; });
  return protosPromise;
}

// ── view models ──────────────────────────────────────────────────────────────
async function buildProtos(W) {
  const protos = {};
  const mk = (parts) => {
    const g = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(
        p.cyl ? new THREE.CylinderGeometry(p.cyl[0], p.cyl[0], p.cyl[1], 8) : new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]),
        new THREE.MeshStandardMaterial({ color: p.c, roughness: 0.6, metalness: 0.3 })
      );
      if (p.cyl) mesh.rotation.x = Math.PI / 2;
      mesh.position.set(p.p[0], p.p[1], p.p[2]);
      g.add(mesh);
    }
    return g;
  };
  const DARK = 0x2b2f33, MID = 0x4a5258, WOOD = 0x7a5233, ACC = 0x1c1f22;
  // composed silhouettes (z+ = barrel forward)
  protos.ar = mk([
    { s: [0.09, 0.14, 0.62], p: [0, 0, 0.05], c: DARK },        // receiver
    { cyl: [0.028, 0.5], p: [0, 0.02, 0.52], c: MID },          // barrel
    { s: [0.06, 0.22, 0.09], p: [0, -0.16, 0.12], c: ACC },     // mag
    { s: [0.07, 0.12, 0.3], p: [0, -0.03, -0.38], c: WOOD },    // stock
    { s: [0.05, 0.06, 0.18], p: [0, 0.11, 0.1], c: ACC },       // sight rail
  ]);
  protos.smg = mk([
    { s: [0.09, 0.12, 0.4], p: [0, 0, 0], c: MID },
    { cyl: [0.025, 0.22], p: [0, 0.01, 0.3], c: DARK },
    { s: [0.05, 0.26, 0.07], p: [0, -0.17, 0.02], c: ACC },
    { s: [0.06, 0.05, 0.16], p: [0, -0.04, -0.26], c: DARK },
  ]);
  protos.sniper = mk([
    { s: [0.08, 0.12, 0.7], p: [0, 0, 0.1], c: WOOD },
    { cyl: [0.024, 0.72], p: [0, 0.02, 0.68], c: DARK },
    { cyl: [0.045, 0.3], p: [0, 0.13, 0.12], c: ACC },          // scope
    { s: [0.06, 0.14, 0.26], p: [0, -0.05, -0.36], c: WOOD },
    { s: [0.04, 0.05, 0.1], p: [0, -0.14, 0.3], c: DARK },
  ]);
  protos.glauncher = mk([
    { cyl: [0.075, 0.55], p: [0, 0, 0.2], c: 0x4d5a3a },        // barrel tube
    { cyl: [0.11, 0.22], p: [0, -0.02, -0.08], c: ACC },        // revolver drum
    { s: [0.06, 0.16, 0.12], p: [0, -0.16, -0.18], c: DARK },   // grip
    { s: [0.07, 0.1, 0.24], p: [0, -0.04, -0.34], c: 0x3d4a30 },// stock
    { s: [0.05, 0.08, 0.06], p: [0, 0.12, 0.05], c: ACC },      // sight
  ]);
  // GLB models
  const base = W.assetBase + "assets/props/";
  for (const [id, file, len] of [["pistol", "wpn-pistol.glb", 0.34], ["shotgun", "wpn-shotgun.glb", 0.8]]) {
    try {
      const m = await W.kernel.loadGLTF(base + file);
      const bbox = new THREE.Box3().setFromObject(m);
      const size = bbox.getSize(new THREE.Vector3());
      const s = len / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(s);
      const c = bbox.getCenter(new THREE.Vector3()).multiplyScalar(s);
      m.position.sub(c);
      const g = new THREE.Group(); g.add(m);
      m.rotation.y = Math.PI / 2; // barrels forward
      protos[id] = g;
    } catch (e) { console.warn("[weapons] GLB fail", id, e); protos[id] = protos.smg.clone(); }
  }

  // MESHY AI weapons override everything above when present (owner direction:
  // all assets generated). Prompted as "horizontal side view" → longest axis
  // = barrel axis; rotate barrel to +Z, sights up.
  const WPN_LEN = { pistol: 0.34, smg: 0.5, ar: 0.62, shotgun: 0.8, sniper: 0.95, glauncher: 0.7 };
  for (const id of Object.keys(WPN_LEN)) {
    try {
      const m = await W.kernel.loadGLTF(base + "meshy_wpn/wpn_" + id + ".glb");
      // Meshy sometimes renders the "side view" at a 3/4 angle → barrel sits
      // diagonal in XZ. Search the yaw that minimizes cross-width so the
      // barrel lands exactly on +Z (sights stay up: rotate around Y only).
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
      // If the front (+Z) third holds more verts than the back, flip.
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
      // MANUAL 180-degree overrides (owner playtest 2026-07-28, verified by
      // side-view screenshots): the muzzle-thin/stock-dense heuristic picks
      // WRONG when the fore-end out-clusters the stock — the AR's rail/mag
      // block and the launcher's rear venturi bell both fooled it, so those
      // two shipped stock-forward. Pistol/shotgun verified correct; judge by
      // SCREENSHOT before adding to this table, never by the heuristic.
      const WPN_FLIP = { ar: true, glauncher: true };
      if (WPN_FLIP[id]) { m.rotation.y += Math.PI; m.updateMatrixWorld(true); }
      // RETEXTURE (owner: "the pistol looks pink it should be black"): Meshy's
      // pistol texture came out salmon. Multiply the map toward gunmetal —
      // shading detail survives, the hue dies. Applied to the PROTO, so every
      // clone (hands, ground loot, hotbar icon) inherits it.
      if (id === "pistol") {
        m.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          for (const mm of (Array.isArray(o.material) ? o.material : [o.material])) {
            mm.color.setHex(0x23262b);
            if (mm.metalness != null) mm.metalness = Math.max(mm.metalness, 0.5);
            if (mm.roughness != null) mm.roughness = Math.min(mm.roughness, 0.55);
          }
        });
      }
      const size = bb.setFromObject(m).getSize(new THREE.Vector3());
      const s = WPN_LEN[id] / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(s);
      m.updateMatrixWorld(true);
      // GRIP ANCHOR (data-driven, like the Claudecraft "grip y" metadata):
      // the handle is the dense cluster in the bottom third — attach THAT to
      // the hand, not the geometric center, so the fist wraps the grip and the
      // barrel sticks out forward (centering made guns float mid-body).
      bb.setFromObject(m);
      const yLo = bb.min.y, yHi = bb.max.y, yBand = yLo + (yHi - yLo) * 0.34;
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
      if (gN) grip.multiplyScalar(1 / gN); else grip.copy(bb.getCenter(new THREE.Vector3()));
      // pistols/SMG: hand wraps at the grip cluster. Long guns: trigger hand
      // sits a touch forward of the rearmost grip so the stock clears the arm.
      grip.z += (WPN_LEN[id] > 0.55 ? 0.06 : 0.0);
      m.position.sub(grip);                 // grip → hand origin
      // Same Meshy export defect the characters had (see player.js): metallicFactor
      // is omitted, and glTF 2.0 defaults an absent metallicFactor to 1.0. A gun at
      // metalness 1 / roughness 1 with no scene.environment has no diffuse term AND
      // nothing to reflect, so it renders as a near-black silhouette in the hand
      // instead of a readable weapon. Verified on the live build: every weapon
      // material under RightHand reported metalness 1, roughness 1, colour #ffffff.
      m.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat.metalness === 1) mat.metalness = 0.35;   // gunmetal, not mirror
          if (mat.roughness === 1) mat.roughness = 0.55;
          if (mat.emissiveMap) { mat.emissiveMap = null; if (mat.emissive) mat.emissive.setHex(0x000000); }
          mat.needsUpdate = true;
        }
      });
      const g = new THREE.Group();
      g.add(m);
      protos[id] = g;
    } catch (e) { /* not generated yet — composed/GLB fallback stays */ }
  }

  // ── P2-D roster (LC-16): CC0 models (Poly Pizza, baked by F:/lc_p23/sim/tools/bake_gun.py: +Z barrel, metres, origin
  // at the pistol grip, static, flat PBR factors). Each source model is ~6 primitives = 6 draw calls per held gun, x 50
  // actors in the drop frame (player.js hides far guns, but the drop cluster is near): they are MERGED here into ONE
  // mesh with per-vertex colours and one material, so a held DMR / LMG / burst rifle costs one draw like a Meshy gun,
  // and loot.js instances it as one pool. Fallbacks (a failed fetch): the composed sniper (DMR) / AR (LMG, burst).
  protos.dmr = protos.sniper.clone();
  protos.lmg = protos.ar.clone();
  protos.burst = protos.ar.clone();
  const CC0 = { dmr: "wpn_dmr.glb", lmg: "wpn_lmg.glb", burst: "wpn_burst.glb" };
  await Promise.all(Object.keys(CC0).map(async (id) => {
    try {
      const m = await W.kernel.loadGLTF(base + "wpn_cc0/" + CC0[id]);
      const g = mergeColoured(m);
      if (g) protos[id] = g;
    } catch (e) { console.warn("[weapons] CC0 GLB fail", id, e && e.message); }
  }));
  return protos;
}

/** ONE vertex-coloured mesh from a static multi-material GLB scene (see the P2-D block above). The flat Poly Pizza
 *  factors are near-black (linear 0.004-0.07) at roughness 1, which renders as a silhouette in this game's light
 *  (the Meshy guns had the same defect, fixed the same way in the Meshy loop): colours get a gunmetal floor, and
 *  one material at roughness 0.55 / metalness 0.35. Non-indexed output (the sources are flat-shaded anyway). */
function mergeColoured(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    parts.push({ o, geo, mats });
    n += geo.attributes.position.count;
  });
  if (!n) return null;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), col = new THREE.Color();
  let k = 0;
  for (const { o, geo, mats } of parts) {
    const pa = geo.attributes.position, na = geo.attributes.normal;
    nm.getNormalMatrix(o.matrixWorld);
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: pa.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex || 0] || mats[0];
      col.copy(mat && mat.color ? mat.color : col.setRGB(0.05, 0.05, 0.05));
      // gunmetal floor (linear): the blacks read as dark steel, the brass / white details keep their hue
      const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
      if (lum < 0.018) { const f = lum > 1e-5 ? 0.018 / lum : 0; if (f) col.multiplyScalar(f); else col.setRGB(0.018, 0.018, 0.019); }
      for (let i = gr.start; i < gr.start + gr.count && i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
        P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
        if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N[k * 3] = v.x; N[k * 3 + 1] = v.y; N[k * 3 + 2] = v.z; }
        Cc[k * 3] = col.r; Cc[k * 3 + 1] = col.g; Cc[k * 3 + 2] = col.b;
        k++;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(P.subarray(0, k * 3), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(N.subarray(0, k * 3), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(Cc.subarray(0, k * 3), 3));
  if (!parts[0].geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));
  mesh.name = "wpn_cc0";
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function equipSlot(W, a, idx) {
  const inv = a.inventory;
  const slot = inv.slots[idx];
  if (!slot) return;
  // LC-05 hook (parity P1-A, inert until P2-A defines W.cancelHeal in player.js): switching to another
  // slot mid-heal cancels the heal for a HUMAN. Bots are exempt: bots.js ensureGunOut calls equipSlot
  // before its HEAL override, so cancelling there would abort every bot heal.
  if (a.healing && !a.isBot && idx !== a.inventory.active && W.cancelHeal) W.cancelHeal(W, a);
  // Swapping used to hand back a weapon with cd: 0, so tap-2-tap-1 cancelled the
  // fire-rate timer and double-pumped the shotgun. Each slot remembers its own
  // remaining cooldown, and the incoming weapon also inherits whatever the
  // outgoing one still owed — you cannot dodge a timer by swapping off it.
  const prev = a.weapon;
  if (prev && prev.slotRef) prev.slotRef.cd = Math.max(0, prev.cd || 0);
  const carry = prev ? Math.max(0, prev.cd || 0) : 0;
  // READY DELAY: both benchmarks charge one and we charged none — PUBG lists
  // a 400-500ms Ready Delay on every weapon page fetched, and Fortnite added
  // equip times for the same anti-swap-cheese reason (COMBAT_CALIBRATION.md).
  // Applies to spawns, pickups and swaps alike; bots inherit it automatically.
  const startCd = Math.max(carry, Math.max(0, slot.cd || 0), 0.4);
  inv.active = idx;
  // bloom heat belongs to the gun in your hands: a fresh draw starts cold (the 0.4 s ready delay already
  // outlasts most of a cool-down), and the reticle's live heat is dropped with it
  if (!a.isBot) { a._heat = 0; if (a === W.player) K.setLiveHeat(null); }
  if (slot.kind === "weapon") {
    a.weapon = { id: slot.id, rarity: slot.rarity || 0, magAmmo: slot.mag != null ? slot.mag : 0, state: "ready", cd: startCd, reloadT: 0, slotRef: slot };
  } else {
    a.weapon = { id: "consumable:" + slot.id, rarity: 0, magAmmo: 0, state: "ready", cd: startCd, reloadT: 0, slotRef: slot };
  }
  refreshWeaponMesh(W, a);
  W.events.emit("weaponEquipped", a, a.weapon);
}

async function refreshWeaponMesh(W, a) {
  const P = await protos(W);
  if (a.weaponMesh) { a.hand && a.hand.remove(a.weaponMesh); a.weaponMesh = null; }
  const id = a.weapon && a.weapon.id;
  const proto = P[id];
  if (!proto || !a.hand) return;
  a.weaponMesh = proto.clone();
  // identity stamp: a.weapon.id changes SYNCHRONOUSLY in equipSlot but this
  // mesh swap is microtask-deferred (the await above), so for the rest of the
  // frame the actor holds the OUTGOING gun's geometry under the incoming id.
  // Anything measuring the held mesh (support-hand foregrip) must check this
  // stamp against a.weapon.id or a bot's same-frame swap measures the wrong gun.
  a.weaponMesh.userData.wid = id;
  a.hand.add(a.weaponMesh);
}

// ── aim helpers ──────────────────────────────────────────────────────────────
const _dir = new THREE.Vector3();
/** `out` optional: per-frame callers (bot aim, perception) pass a scratch object
 *  and nothing is allocated; without it a fresh object comes back as before. */
export function eyePos(a, out) {
  const y = a.pos.y + (a.swimming ? 0.7 : K.actorEyeY(a));
  if (out) { out.x = a.pos.x; out.y = y; out.z = a.pos.z; return out; }
  return { x: a.pos.x, y, z: a.pos.z };
}
export function aimDir(a, out) {
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  const sp = Math.sin(a.pitch), cp = Math.cos(a.pitch);
  out = out || _dir;
  out.set(-sy * cp, sp, -cy * cp);
  return out;
}

// ── update loop ──────────────────────────────────────────────────────────────
/** Drop every live round back into the pool. The projectile list is
 *  module-level, so without this rounds fired in one match kept flying in the
 *  next one — and their meshes stayed parented to a cleared group. */
export function reset(W) {
  W._dmgRng = null;               // fresh damage-roll stream per match
  W._spreadRng = null;            // fresh spread stream per match (fire())
  W._recoilRng = null;            // fresh human recoil-yaw stream per match
  if (K && K.setLiveHeat) K.setLiveHeat(null);   // the reticle's bloom registry (sim/royale.js LIVE_HEAT)
  for (const p of projectiles) {
    if (p.m && p.m.parent) p.m.parent.remove(p.m);
    p.dead = true;
    POOL.push(p);
  }
  projectiles.length = 0;
  if (Array.isArray(W.smokes)) W.smokes.length = 0;   // C-SMOKE: no cloud outlives its match (same array kept)
  // sway/breath state lives on W and outlived the match (sweep finding): a
  // player who quit while WINDED started the next match still winded
  W._swayP = 0; W._swayY = 0; W._breathT = null; W._winded = false;
}

/** C8 teardown contract. Held guns are proto CLONES (weapons.js refreshWeaponMesh):
 *  they share the protos' geometry and materials, which live for the page on
 *  purpose, so there is nothing of theirs to free — only references to drop so the
 *  dead roster is collectable. Live rounds go back to the pool (reset). Shell
 *  meshes share one geometry/material. Safe to call twice. */
export function disposeMatch(W) {
  reset(W);
  let detached = 0;
  for (const a of (W.actors || [])) {
    if (a.weaponMesh) {
      if (a.weaponMesh.parent) a.weaponMesh.parent.remove(a.weaponMesh);
      a.weaponMesh = null; detached++;
    }
  }
  return { detached };
}

export function update(W, dt) {
  const acts = W.actors;
  for (let ai = 0; ai < acts.length; ai++) {
    const a = acts[ai];
    if (!a.alive || a.netRemote) continue;
    stepWeapon(W, a, dt);
    if (!a.isBot && !a.input.fire) a._rcN = 0;     // a released trigger restarts the spray pattern
    // PATTERN recoil (automatics, human, not touch: fire() set _rcBase) recovers by its own rule
    if (a._rcBase != null) recoverPattern(W, a, dt);
    // recoil recovery: re-center what the kicks added (~0.3s), leaving the
    // player's own mouse aim untouched
    else if (a.recoilPitch > 0.0001) {
      const r = Math.min(a.recoilPitch, dt * 0.12);
      a.input.pitch = K.clamp(a.input.pitch - r, -1.35, 1.35);
      a.recoilPitch -= r;
    }
    if (a._rcBase == null && a.recoilYaw && Math.abs(a.recoilYaw) > 0.0001) {
      const r = Math.sign(a.recoilYaw) * Math.min(Math.abs(a.recoilYaw), dt * 0.08);
      a.input.yaw -= r;
      a.recoilYaw -= r;
    }
    // ── SNIPER SWAY + BREATH-HOLD (player only) ─────────────────────────────
    // Scoped snipers drift on layered sines; holding SHIFT while scoped
    // steadies the aim against a 5 s breath meter, and running the meter dry
    // leaves you WINDED (1.7x sway) until it refills past half. Applied
    // DIFFERENTIALLY to input.yaw/pitch — only the frame-to-frame CHANGE in
    // the sway signal lands on the aim, so it oscillates without permanently
    // displacing the mouse aim, and because it lives on the same input the
    // bullets, camera and reticle read, all three agree (crosshair-truth).
    // Bots are exempt: their aim error model already covers this.
    if (a === W.player) {
      const swdef = a.weapon && K.WEAPONS[a.weapon.id];
      const scoped = !!(swdef && swdef.scope && a.input.ads && (a._adsT || 0) >= (swdef.adsTimeS || 0));
      let sp = 0, sy = 0;
      if (W._breathT == null) W._breathT = 5;
      if (scoped) {
        const held = !!W._breathHeld && W._breathT > 0 && !W._winded;
        W._breathT = held ? Math.max(0, W._breathT - dt) : Math.min(5, W._breathT + dt * 1.4);
        if (W._breathT <= 0.001) W._winded = true;
        else if (W._winded && W._breathT > 2.5) W._winded = false;
        const amp = (held ? 0.05 : W._winded ? 1.7 : 1) * 0.004;
        sp = amp * (Math.sin(W.t * 1.3 + 0.7) * 0.7 + Math.sin(W.t * 2.3) * 0.3);
        sy = amp * (Math.sin(W.t * 0.9) * 0.6 + Math.sin(W.t * 1.7 + 1.3) * 0.4);
      } else {
        W._breathT = Math.min(5, W._breathT + dt * 1.4);
        if (W._winded && W._breathT > 2.5) W._winded = false;
      }
      const dp = sp - (W._swayP || 0), dy = sy - (W._swayY || 0);
      if (dp || dy) {
        a.input.pitch = K.clamp(a.input.pitch + dp, -1.35, 1.35);
        a.input.yaw += dy;
      }
      W._swayP = sp; W._swayY = sy;
    }
    // VIEW-MODEL punch. refreshWeaponMesh (weapons.js:217) parents a static
    // proto.clone() to the hand and never touches it again, so the gun itself
    // never moved when it fired. Local units under a.hand are metres — the hand
    // group divides out the bone's world scale (player.js:257-259) — so this is
    // a 5 cm slide back down the barrel axis (+Z is barrel-forward, weapons.js:56).
    // A camera-PITCH kick is deliberately not used: crosshairPoint derives the
    // human's aim ray from the camera direction (weapons.js:353-357), so pitching
    // the camera moves the shots — it would be a second aim recoil, not a visual.
    if (a.vmKick > 0) {
      a.vmKick = Math.max(0, a.vmKick - dt * 6);
      if (a.weaponMesh) a.weaponMesh.position.z = -a.vmKick * 0.05;
    }
  }
  // the reticle's bloom registry describes the LIVE local human only
  if (W.player && !W.player.alive) K.setLiveHeat(null);
  tickSmokes(W);
  stepProjectiles(W, dt);
}

/** LC-01 recovery for the spray pattern: HELD while the trigger is held and the gun is cycling (a shot
 *  within one interval + 0.1 s), then the climb re-centres at the pattern's recoverPerS - never below the
 *  pitch the burst started from, so a player who pulled down against the climb keeps their aim (the old
 *  accumulator would have dragged them under the target by everything they compensated). */
function recoverPattern(W, a, dt) {
  const rc = a._rc;
  const def = a.weapon && K.WEAPONS[a.weapon.id];
  if (a.input.fire && def && def.rpm && (W.t - a.lastShotT) < 60 / def.rpm + 0.1) return;
  if (a.recoilPitch > 0.0001) {
    const room = a.input.pitch - a._rcBase;
    const r = Math.min(a.recoilPitch, dt * rc.recoverPerS, room > 0 ? room : 0);
    if (r > 0) a.input.pitch = K.clamp(a.input.pitch - r, -1.35, 1.35);
    a.recoilPitch = room - r <= 1e-6 ? 0 : a.recoilPitch - r;
  } else a.recoilPitch = 0;
  if (a.recoilYaw && Math.abs(a.recoilYaw) > 0.0001) {
    const r = Math.sign(a.recoilYaw) * Math.min(Math.abs(a.recoilYaw), dt * rc.recoverYawPerS);
    a.input.yaw -= r;
    a.recoilYaw -= r;
  } else a.recoilYaw = 0;
  if (a.recoilPitch === 0 && a.recoilYaw === 0) a._rcBase = null;
}

/** The touch layer is live (contract C6): the touch path keeps the legacy kick, spread and pellets. */
function touchOn(W) { return !!(W.touch && W.touch.active); }

function stepWeapon(W, a, dt) {
  const inp = a.input;
  // Slot switching runs FIRST. It used to run after `const wpn = a.weapon`, so
  // for the rest of that frame every read (def, cd, magAmmo, state) came from
  // the OUTGOING weapon object while fire() stamped the INCOMING id and rarity
  // onto the projectile: swapping shotgun -> sniper on a live trigger spawned
  // 9 pellets each resolving as sniper damage, and the outgoing object's ammo
  // decrement was written to an orphan.
  // C-DBNO downed gate: a knocked actor cannot fire, reload, throw, heal or switch (PUBG / Apex: the gun is away
  // while you crawl). A reload in progress is abandoned (the magazine keeps what it had); a started burst is dropped.
  if (a.downed) {
    inp.slot = -1; inp.reload = false;
    const w0 = a.weapon;
    if (w0) { w0.burstLeft = 0; if (w0.state === "reloading") { w0.state = "ready"; w0.reloadT = 0; W.events.emit("reloadCancel", a, w0); } }
    return;
  }
  if (inp.slot >= 0) { equipSlot(W, a, inp.slot); inp.slot = -1; }
  const wpn = a.weapon;
  if (!wpn) return;

  // consumable "weapon" — fire = use
  if (wpn.id.startsWith("consumable:")) {
    // THROWABLES (LC-14) have their own branch: a throw is never a heal, so it never reaches
    // useConsumable / applyHeal (and so can never move hp or shield)
    const tdef = K.CONSUMABLES[wpn.id.slice(11)];
    if (tdef && tdef.throws) { stepThrow(W, a, wpn, tdef, dt); return; }
    if (inp.fire && !a.healing) {
      const cid = wpn.id.slice("consumable:".length);
      W.events.emit("useConsumable", a, cid);
      if (!a.isBot) inp.fire = false;
    }
    return;
  }

  const def = K.WEAPONS[wpn.id];
  if (!def) return;
  // invariant: the definition driving pellets/spread must describe the weapon
  // whose id fire() stamps on the projectile (see the swap bug above)
  if (def !== K.WEAPONS[a.weapon.id]) { console.warn("[weapons] def/weapon mismatch", wpn.id, a.weapon.id); return; }
  wpn.cd -= dt;

  // reload
  if (inp.reload && wpn.state === "ready" && def.mag > 0 && wpn.magAmmo < def.mag && a.inventory.ammo[def.ammo] > 0) {
    wpn.state = "reloading"; wpn.reloadT = def.reloadS;
    W.events.emit("reloadStart", a, wpn);
  }
  inp.reload = false;
  if (wpn.state === "reloading") {
    wpn.reloadT -= dt;
    if (wpn.reloadT <= 0) {
      const need = def.mag - wpn.magAmmo;
      const take = Math.min(need, a.inventory.ammo[def.ammo]);
      a.inventory.ammo[def.ammo] -= take;
      wpn.magAmmo += take;
      if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
      wpn.state = "ready";
      W.events.emit("reloadDone", a, wpn);
    }
    return;
  }

  // firing — no shooting while gliding, healing, or swimming (weapon's wet).
  // The FIRE MODE is the definition's explicit `fire` field (parity P2-D, LC-16; it used to be inferred from
  // cls === "smg" || "ar", which no burst rifle or LMG could fit): AUTO weapons fire while the trigger is HELD;
  // SEMI weapons fire once per CLICK; BURST weapons fire def.burst.n rounds def.burst.gapS apart for one click or a
  // held trigger (held: the next burst follows def.burst.delayS later), and a started burst completes unless the
  // magazine runs dry or a no-fire state (glide, heal, swim, mantle, downed) interrupts it. The human input is
  // rebuilt from the live button every frame, so a held-state guard (inp.fire=false) is overwritten next frame →
  // auto-cycle. Gate semi weapons on the mousedown EDGE (W._fireEdge, set on click, cleared on release/consume).
  const mode = K.fireMode(def);
  const isAuto = mode === "auto", isBurst = mode === "burst" && !!def.burst;
  // SEMI-AUTO INPUT, two paths (owner playtest: "pressing mouse button
  // doesn't actually fire ... it gets stuck"):
  //   1. click buffer — the edge is a timestamp honoured for 420 ms (covers
  //      the 400 ms swap ready-delay), so a quick click inside a cooldown
  //      fires the moment the gun is ready instead of being swallowed
  //      (mouseup no longer erases the edge);
  //   2. hold-to-fire — if the button is STILL DOWN when the cooldown ends,
  //      fire (the modern-shooter standard; covers the sniper/pistol
  //      between-shot cds that are longer than any sane click buffer).
  const edgeLive = W._fireEdge && (performance.now() - W._fireEdge) < 420;
  // Semi-autos fire on CLICK EDGES ONLY (owner: "pistol fires like automatic
  // weapon, thats impossible"). The old `|| inp.fire` hold-to-fire fallback
  // made a held button cycle the pistol at its full 400 rpm; the 420ms edge
  // buffer alone already fixes the swallowed-click problem it was added for.
  // TOUCH (contract C6): a phone has no click edge to buffer — the FIRE button is
  // HELD. While it is held, a semi-auto re-arms at its own fire interval (the cd
  // gate below is that interval), so holding FIRE with a pistol fires at the
  // pistol's rate instead of once per tap. Mouse play is unchanged: W.touch is
  // absent or inactive there. Feature-detected; touch.js (L10) owns W.touch.
  const touchHeld = !a.isBot && a === W.player && !!(W.touch && W.touch.active && W.touch.fire);
  const blocked = a.gliding || a.healing || a.swimming || a.mantleT != null;
  if (isBurst && (wpn.burstLeft || 0) > 0) {
    // the rest of a started burst needs no trigger: only the gun, the magazine and free hands
    if (blocked || (def.mag > 0 && wpn.magAmmo <= 0)) { wpn.burstLeft = 0; wpn.cd = Math.max(wpn.cd, def.burst.delayS); return; }
    if (wpn.cd > 0) return;
    fire(W, a, def);
    wpn.magAmmo--;
    if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
    wpn.burstLeft--;
    wpn.cd = Math.max(wpn.cd, -dt) + (wpn.burstLeft > 0 ? def.burst.gapS : def.burst.delayS);
    return;
  }
  // burst: a held trigger (bots: inp.fire) or a buffered click starts a burst
  const wantFire = (a.isBot || isAuto) ? inp.fire
    : isBurst ? (inp.fire || !!edgeLive || touchHeld) : (!!edgeLive || touchHeld);
  if (wantFire && wpn.cd <= 0 && !blocked) {
    if (def.mag > 0 && wpn.magAmmo <= 0) {
      // auto reload attempt
      if (a.inventory.ammo[def.ammo] > 0) { inp.reload = true; }
      else W.events.emit("dryFire", a);
      wpn.cd = 0.25;
      if (!a.isBot && !isAuto) W._fireEdge = 0;   // the click is spent even on a dry trigger
      return;
    }
    if (isBurst) {
      // a fresh burst replays the SAME learnable climb (sim RECOIL.burst) once the last one has recovered
      if (a._rcBase == null) a._rcN = 0;
      fire(W, a, def);
      wpn.magAmmo--;
      if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
      wpn.burstLeft = Math.max(0, def.burst.n - 1);
      wpn.cd = Math.max(wpn.cd, -dt) + (wpn.burstLeft > 0 ? def.burst.gapS : def.burst.delayS);
      if (!a.isBot) W._fireEdge = 0;
      return;
    }
    fire(W, a, def);
    wpn.magAmmo--;
    if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
    // CADENCE CARRY. `wpn.cd = 60 / def.rpm` threw away how far past zero the
    // timer had run, so a gun could only fire on frame boundaries: the SMG (720
    // designed, 83.3 ms) fired every 5th frame at 60 Hz = 600 rpm, 606 at 30 Hz,
    // 708 at 165 Hz (measured in-page). Carrying the overshoot makes the cadence
    // exact at any frame rate. The floor (>= -dt) stops an idle gun banking a
    // burst of instant shots: an idle timer runs far below zero.
    wpn.cd = Math.max(wpn.cd, -dt) + 60 / def.rpm;
    if (!a.isBot && !isAuto) W._fireEdge = 0;      // one shot per click for semi weapons
  }
}

// ── throwing (LC-14, built dark) ────────────────────────────────────────────
/** Fire = throw for a held throwable. Same input contract as a semi-auto gun (one click edge = one throw
 *  for the human, the held FIRE button re-arms at cycleS on touch, bots throw while inp.fire is set), the
 *  same no-throw states (gliding, healing, swimming, mantling), and the swap ready delay (wpn.cd). The
 *  stack is spent here; the last one empties the slot and puts a gun back in the hands (as useConsumable
 *  does for the last heal). */
function stepThrow(W, a, wpn, tdef, dt) {
  const inp = a.input;
  wpn.cd -= dt;
  const human = !a.isBot;
  const edgeLive = human && W._fireEdge && (performance.now() - W._fireEdge) < 420;
  const touchHeld = human && a === W.player && !!(W.touch && W.touch.active && W.touch.fire);
  const want = a.isBot ? inp.fire : (!!edgeLive || touchHeld);
  if (!want || wpn.cd > 0 || a.gliding || a.healing || a.swimming || a.mantleT != null) return;
  const slot = wpn.slotRef;
  if (!slot || !(slot.count > 0)) return;
  throwRound(W, a, tdef.throws);
  slot.count--;
  wpn.cd = K.FRAG.cycleS;
  if (human) W._fireEdge = 0;
  if (slot.count <= 0) {
    const inv = a.inventory, idx = inv.slots.indexOf(slot);
    if (idx >= 0) inv.slots[idx] = null;
    if (idx >= 0 && inv.active === idx) {
      const gun = inv.slots.findIndex((s2) => s2 && s2.kind === "weapon");
      if (gun >= 0) equipSlot(W, a, gun);
    }
  }
}

const _thrDir = new THREE.Vector3(), _thrV = { vx: 0, vy: 0, vz: 0 }, _thrCols = [];
/** Launch one thrown round: the aim (the human's camera forward = where the reticle points; a bot's
 *  yaw/pitch) through K.fragLaunch, from the eye nudged 0.3 m forward unless a collider is in the way.
 *  The round is a pooled arcing round: it bounces off the world, passes bodies (a frag is not a
 *  contact charge), and bursts through explode() when its fuse runs out. */
function throwRound(W, a, wid) {
  const def = K.WEAPONS[wid];
  if (!def) return null;
  const eye = eyePos(a, _eyeFire);
  if (a === W.player && W.camera) W.camera.getWorldDirection(_thrDir);
  else aimDir(a, _thrDir);
  const v = K.fragLaunch(_thrDir.x, _thrDir.y, _thrDir.z, _thrV);
  let ox = eye.x, oy = eye.y, oz = eye.z;
  const fx = eye.x + _thrDir.x * 0.3, fy = eye.y + _thrDir.y * 0.3, fz = eye.z + _thrDir.z * 0.3;
  const cols = W.map.queryColliders((eye.x + fx) / 2, (eye.z + fz) / 2, 0.9, _thrCols);
  if (!(cols && cols.length && K.segmentColliders(eye.x, eye.y, eye.z, fx, fy, fz, cols))) { ox = fx; oy = fy; oz = fz; }
  const p = takeRound();
  p.x = ox; p.y = oy; p.z = oz;
  p.vx = v.vx; p.vy = v.vy; p.vz = v.vz;
  p.weaponId = wid; p.rarity = 0; p.ownerId = a.id;
  p.gravity = K.FRAG.gravity;
  p.tLeft = def.fuseS;
  p.splash = def.splashR || 0; p.bounce = true; p.mesh = true; p.noActor = true;
  p.origin.x = ox; p.origin.y = oy; p.origin.z = oz;
  launchRound(W, p);
  W.events.emit("grenadeThrown", a, wid, { x: ox, y: oy, z: oz }, { x: v.vx, y: v.vy, z: v.vz });
  return p;
}

// ── firing ───────────────────────────────────────────────────────────────────
const _d = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _pdir = new THREE.Vector3();
const _up2 = new THREE.Vector3(), _stance = { ads: false, crouching: false };
const _camDir = new THREE.Vector3(), _camPt = new THREE.Vector3();

/** What is the crosshair actually ON? March the camera-forward ray against
 * actor capsules, terrain, and static colliders; return the first hit point
 * (or the 300m far point). The projectile then flies muzzle→this point, so
 * shots land EXACTLY where the reticle points — slopes, shoulders, parallax
 * all accounted for. (The old fixed-120m convergence missed uphill targets.) */
function crosshairPoint(W, shooter, out) {
  // aim ray: ALWAYS through screen center (owner: "make sure cursor always
  // stays CENTERED"). The reticle is pinned center-screen in every mode now;
  // unlocked mouse pans the camera (cursor-follow) instead of moving the aim
  // point around the screen — the AAA model.
  W.camera.getWorldDirection(_camDir);
  const o = W.camera.position;
  const FAR = 300;
  let bestT = FAR;
  // actor capsules (closest approach of ray to vertical axis)
  for (const t of W.actors) {
    if (!t.alive || t === shooter) continue;
    const dx = t.pos.x - o.x, dz = t.pos.z - o.z;
    const denom = _camDir.x * _camDir.x + _camDir.z * _camDir.z;
    if (denom < 1e-6) continue;
    const u = (dx * _camDir.x + dz * _camDir.z) / denom;   // ray param of closest XZ approach
    if (u < 1 || u > bestT) continue;
    const px = o.x + _camDir.x * u, pz = o.z + _camDir.z * u, py = o.y + _camDir.y * u;
    // LC-22: the crosshair is ON a body only where the bullet's own test (the bone-derived volume) would hit it, so
    // a reticle 0.4 m beside a shoulder aims PAST the body at what is behind it, exactly as the round will fly
    const HV = W.SIM.HITVOL, reach = HV ? Math.max(HV.reach, W.SIM.PLAYERK.radius + 0.15) : W.SIM.PLAYERK.radius + 0.15;
    if ((px - t.pos.x) ** 2 + (pz - t.pos.z) ** 2 > reach * reach) continue;
    if (py < t.pos.y - 0.1 || py > t.pos.y + W.SIM.actorHeight(t) + 0.3) continue;
    if (W.SIM.hitVolSegment) {
      const L = bestT;
      const hv = W.SIM.hitVolSegment(t, o.x, o.y, o.z, o.x + _camDir.x * L, o.y + _camDir.y * L, o.z + _camDir.z * L, W.t, liveJoints(W, t));
      if (hv >= 0) { if (hv * L >= 1) bestT = hv * L; continue; }
      if (hv === -1) continue;
    }
    const r = W.SIM.PLAYERK.radius + 0.15;
    if ((px - t.pos.x) ** 2 + (pz - t.pos.z) ** 2 > r * r) continue;
    if (py < t.pos.y - 0.1 || py > t.pos.y + W.SIM.actorHeight(t) + 0.15) continue;
    bestT = u;
  }
  // terrain + static colliders. Colliders are SWEPT (boxes and ramps, exactly as bullets
  // test them) instead of point-tested every 0.75 m, which stepped over a 0.32 m house
  // wall 57 % of the time and never saw a ramp. The march starts at the ray's closest
  // approach to the shooter's eye, not at a fixed 3 m past the lens: with the Wave-4
  // wall pull-in the lens can sit a few decimetres behind the eye, and a wall 1-3 m in
  // front of it used to be skipped (the shot then flew at a point BEHIND the wall and
  // landed a shoulder-width off the reticle); with the 4.2 m boom the old 3 m start
  // also read things beside the shooter's own back as the aim point.
  eyePos(shooter, _aimEye);
  const dEye = (_aimEye.x - o.x) * _camDir.x + (_aimEye.y - o.y) * _camDir.y + (_aimEye.z - o.z) * _camDir.z;
  const d0 = dEye < 0.05 ? 0.05 : dEye > 8 ? 8 : dEye;
  _aimW = W;
  bestT = K.aimRayDist(o.x, o.y, o.z, _camDir.x, _camDir.y, _camDir.z, d0, bestT, _aimHeight, _aimQuery, _aimCols);
  _aimW = null;
  return out.copy(o).addScaledVector(_camDir, bestT);
}
// the map's own functions, called as methods (no `this` assumption), with the caller's own scratch array
let _aimW = null;
const _aimEye = { x: 0, y: 0, z: 0 }, _aimCols = [];
const _aimHeight = (x, z) => _aimW.map.heightAt(x, z);
const _aimQuery = (x, z, r, buf) => _aimW.map.queryColliders(x, z, r, buf);

// Per-shot tables, hoisted: fire() built three object literals per trigger pull.
// P2-D: the DMR kicks between the AR and the bolt sniper (a 46-damage semi round: 0.022 rad, recovered before the
// next 0.375 s shot); the LMG / burst rifle use their spray tables on mouse + keyboard (sim RECOIL) and these legacy
// kicks only on touch. VM_KICK is keyed by cls (the burst rifle is cls "ar").
const VM_KICK = { pistol: 0.7, smg: 0.5, ar: 0.75, shotgun: 1.6, sniper: 1.9, launcher: 1.2, dmr: 1.25, lmg: 0.65 };
const HUMAN_KICK = { pistol: 0.008, smg: 0.006, ar: 0.011, shotgun: 0.03, sniper: 0.05, glauncher: 0.035, dmr: 0.022, lmg: 0.009, burst: 0.010 };
const BARREL_LEN = { pistol: 0.5, smg: 0.7, ar: 0.95, shotgun: 0.85, sniper: 1.15, glauncher: 0.8, dmr: 1.15, lmg: 1.08, burst: 0.96 };
const _eyeFire = { x: 0, y: 0, z: 0 };
function fire(W, a, def) {
  const eye = eyePos(a, _eyeFire);
  aimDir(a, _d);
  // HUMAN aim = wherever the crosshair visually points
  if (a === W.player) {
    crosshairPoint(W, a, _camPt);
    _d.set(_camPt.x - eye.x, _camPt.y - eye.y, _camPt.z - eye.z).normalize();
  }
  const pellets = def.pellets || 1;
  // MODERN gunplay (parity P1-A): per-shot bloom, disc pellets, spray patterns - for the local human on
  // mouse + keyboard. Bots (their aim-error model is tuned against D8 pacing) and the touch path keep the
  // legacy rules byte for byte.
  const modern = !a.isBot && !touchOn(W);
  const since = W.t - a.lastShotT;
  const adsReady = !!a.input.ads && (a._adsT || 0) >= (def.adsTimeS || 0);
  // spread: one shared model (sim.effectiveSpread) so the crosshair can draw the
  // SAME number this fires with — it used to guess with a cruder formula
  const spread = K.effectiveSpread(a.weapon.id, a.weapon.rarity, {
    // the ADS accuracy bonus is EARNED at adsTimeS, not on the frame RMB lands —
    // player.js accrues a._adsT while ads is held (bots included)
    ads: adsReady,
    speed: Math.sqrt(a.vel.x * a.vel.x + a.vel.z * a.vel.z),
    airborne: !a.onGround,
    crouching: !!a.crouching,
    sinceLastShotS: since,
    heat: modern ? (a._heat || 0) : null,
  });
  if (modern) {
    // heat after THIS shot (the cone the next one starts from), published for the reticle
    a._heat = K.heatAfterShot(a.weapon.id, K.heatNow(a._heat || 0, since));
    if (a === W.player) K.setLiveHeat(a.weapon.id, a._heat);
  }

  // Per-system seeded stream (never Math.random, never a shared global one): the
  // pellet cone of every bot shot is sim state, and Math.random here was one of
  // the four sources that stopped a seed replaying a match (audit M4).
  if (!W._spreadRng) W._spreadRng = K.mulberry32((((W.seed >>> 0) ^ 0x5b7ead) >>> 0));
  const srng = W._spreadRng;
  const sr = (spread * Math.PI / 180);
  _right.crossVectors(_d, _up).normalize();
  // DISC sampling for the modern path (LC-33): the square (+-sr, +-sr) put 21 % of pellets outside the
  // cone the reticle draws (its corners reach sr x 1.41). r = sr x sqrt(u) is area-uniform over the disc,
  // on a true perpendicular basis (world up only is perpendicular at pitch 0); the SAME two draws per
  // pellet, so the seeded stream stays in step with the legacy path.
  if (modern) _up2.crossVectors(_right, _d).normalize();
  for (let p = 0; p < pellets; p++) {
    let ox, oy;
    if (modern) {
      const rr = sr * Math.sqrt(srng()), th = srng() * Math.PI * 2;
      ox = rr * Math.cos(th); oy = rr * Math.sin(th);
    } else { ox = (srng() - 0.5) * 2 * sr; oy = (srng() - 0.5) * 2 * sr; }
    const dir = _pdir.copy(_d).addScaledVector(_right, ox).addScaledVector(modern ? _up2 : _up, oy).normalize();
    // (fields written straight onto a pooled round: this used to build a spawn
    // object plus an origin object per PELLET and Object.assign them in)
    const p = takeRound();
    p.x = eye.x + dir.x * 0.6; p.y = eye.y + dir.y * 0.6 - 0.05; p.z = eye.z + dir.z * 0.6;
    p.vx = dir.x * def.speed; p.vy = dir.y * def.speed + (def.arc ? 3 : 0); p.vz = dir.z * def.speed;
    p.weaponId = a.weapon.id; p.rarity = a.weapon.rarity; p.ownerId = a.id;
    // only the launcher arcs. The old `def.gravity ? -9.8 : 0` fallback was
    // dead code — none of the six WEAPONS entries in sim/royale.js has a
    // gravity key, so it always resolved to 0 and bullets were always flat.
    p.gravity = def.arc ? -18 : 0;
    p.tLeft = def.arc ? def.fuseS : 3.5;
    // impact-fused shells (def.impact, the launcher) BURST on the first wall / ground / body they touch, as every
    // reference launcher does; they used to bounce like a hand grenade and could roll back to the shooter
    p.splash = def.splashR || 0; p.bounce = !!def.arc && !def.impact; p.mesh = !!def.arc; p.noActor = false;
    p.origin.x = eye.x; p.origin.y = eye.y; p.origin.z = eye.z;
    launchRound(W, p);
  }
  // VISIBLE ROUND for every LOCAL shot (owner playtest: "firing sniper i see
  // no tracer"). The tracer dash listener existed with per-weapon colors and a
  // cosmetic speed cap — but only net.js's REMOTE fire replay ever emitted it,
  // so solo play had no bullet trails at all. One dash per trigger pull (base
  // aim dir, not per pellet — a shotgun blast is one streak, matching the
  // remote replay), launcher included: its dash trails the arcing shell.
  W.events.emit("tracer", {
    x: eye.x + _d.x * 0.6, y: eye.y + _d.y * 0.6 - 0.05, z: eye.z + _d.z * 0.6,
    vx: _d.x * def.speed, vy: _d.y * def.speed, vz: _d.z * def.speed,
    weaponId: a.weapon.id,
  });
  // View-model punch, all actors — a bot's gun is on screen too. Was a flat 1
  // (= 5 cm setback) for every weapon, so a sniper and an SMG kicked the gun
  // identically. Per-class multiplier onto the SAME 0.05 m axis and 6/s decay:
  // pistol 3.5 cm, smg 2.5, ar 3.75, shotgun 8, sniper 9.5, launcher 6 — and a
  // sniper's recovery stretches to ~0.32 s, which reads as the bolt cycling.
  a.vmKick = VM_KICK[def.cls] || 1;
  // recoil kick (human only — bots model error separately). The kick is
  // tracked in recover-accumulators and re-centers over ~0.3s — permanent
  // kick made the crosshair CLIMB forever (aim drifted ~2m high after a few
  // shots: "my pistol doesn't work").
  if (!a.isBot) {
    if (!W._recoilRng) W._recoilRng = K.mulberry32((((W.seed >>> 0) ^ 0x7ec011) >>> 0));
    const rc = modern && K.RECOIL ? K.RECOIL[a.weapon.id] : null;
    if (rc) {
      // SPRAY PATTERN (LC-01): shot n of the burst kicks pitch[n] (sim/royale.js RECOIL), capped so the
      // whole climb never exceeds rc.cap; the yaw follows the table's wobble plus the seeded jitter (one
      // draw per shot, as the legacy kick). The baseline is taken only from a fully recovered aim, so a
      // quick re-press keeps the original floor (recoverPattern never pulls below it).
      if (a._rcBase == null || !((a.recoilPitch || 0) > 0.0001)) a._rcBase = a.input.pitch;
      const n = a._rcN || 0;
      _stance.ads = adsReady; _stance.crouching = !!a.crouching;
      const room = rc.cap - (a.recoilPitch || 0);
      const kick = Math.min(K.recoilPitchKick(a.weapon.id, n, _stance), room > 0 ? room : 0);
      const yawKick = rc.yaw[n < rc.yaw.length ? n : rc.yaw.length - 1] + (W._recoilRng() - 0.5) * rc.jitter;
      a.input.pitch = K.clamp(a.input.pitch + kick, -1.35, 1.35);
      a.input.yaw += yawKick;
      a.recoilPitch = (a.recoilPitch || 0) + kick;
      a.recoilYaw = (a.recoilYaw || 0) + yawKick;
      a._rcN = n + 1; a._rc = rc;
    } else {
      const kick = HUMAN_KICK[a.weapon.id] || 0.01;
      const yawKick = (W._recoilRng() - 0.5) * kick * 0.6;
      a.input.pitch = K.clamp(a.input.pitch + kick, -1.35, 1.35);
      a.input.yaw += yawKick;
      a.recoilPitch = (a.recoilPitch || 0) + kick;
      a.recoilYaw = (a.recoilYaw || 0) + yawKick;
    }
    W.stats.shotsFired += pellets;
  }
  a.lastShotT = W.t;
  // muzzle world position from the held weapon (right-hand bone) so the flash
  // erupts at the BARREL, not the eye/body-centre (the third-person "fire from
  // the face" issue). Physics/aim stay eye-based; only the FX origin moves.
  let muzzle = null;
  if (a.hand) {
    a.hand.updateWorldMatrix(true, false);
    const m = a.hand.matrixWorld.elements;
    const bl = BARREL_LEN[a.weapon.id] || 0.8;
    muzzle = { x: m[12] + _d.x * bl, y: m[13] + _d.y * bl, z: m[14] + _d.z * bl };
  } else muzzle = { x: eye.x, y: eye.y, z: eye.z };   // eye is scratch now: listeners get their own copy
  W.events.emit("shotFired", a, a.weapon.id, muzzle, _d.clone());
}

// ── projectiles ──────────────────────────────────────────────────────────────
const _whizPt = { x: 0, y: 0, z: 0 };
/** distance from point c to segment a->b, writing the closest point to out */
function segPointDist(ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t; out.y = ay + dy * t; out.z = az + dz * t;
  const ex = out.x - cx, ey = out.y - cy, ez = out.z - cz;
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

/** One [0,1) sample per damaging hit, for the weapon damage RANGE in
 *  K.hitDamage. Seeded off the match so offline play and the harness reproduce
 *  exactly; in multiplayer the SHOOTER computes the number and ships it in the
 *  "hitYou" packet (net.js), so the two clients never have to agree on a roll. */
function dmgRoll(W) {
  if (!W._dmgRng) W._dmgRng = K.mulberry32((((W.seed >>> 0) ^ 0xda4a) >>> 0));
  return W._dmgRng();
}

/** A pooled round with ONE fixed shape (every field present from birth), so the
 *  projectile loop stays monomorphic and nothing is allocated per pellet. */
function takeRound() {
  return POOL.pop() || { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, weaponId: "", rarity: 0, ownerId: null,
    gravity: 0, tLeft: 0, splash: 0, bounce: false, mesh: false, noActor: false, origin: { x: 0, y: 0, z: 0 },
    dead: false, whizzed: false, m: null };
}
function launchRound(W, p) {
  const o = p;
  p.dead = false;
  // pooled rounds keep their old fields: a stale `true` here would mute the
  // whiz-by on every reused round.
  p.whizzed = false;
  if (o.mesh && !p.m) {
    // grenade-launcher shell: visible arcing round with a hot tracer tint
    // 0.15 m + hot emissive: the 0.11/0.4 shell was invisible in flight
    // (owner playtest: "grenade launcher shoots no grenade, at least i cant
    // see it") — the bloom pass needs the emissive over its 0.72 threshold.
    // ONE geometry + material shared by every shell (was a fresh pair per pooled
    // round, each resident for the life of the page).
    if (!_shellGeo) {
      _shellGeo = new THREE.SphereGeometry(0.15, 6, 6);
      _shellMat = new THREE.MeshStandardMaterial({ color: 0x3d5a3a, emissive: 0xff6622, emissiveIntensity: 1.2 });
      // the frag: same geometry and material TYPE (one shader program, no new link mid-match), a dark
      // olive body with a dimmer fuse glow that still clears the 0.72 bloom threshold, shown at 0.8 scale
      _fragMat = new THREE.MeshStandardMaterial({ color: 0x2f3a26, emissive: 0xff3a1a, emissiveIntensity: 0.9 });
    }
    p.m = new THREE.Mesh(_shellGeo, _shellMat);
  }
  if (p.m && o.mesh) {
    const frag = p.weaponId === "frag", smoke = p.weaponId === "smoke";
    // the smoke canister: the same geometry and material TYPE again (no new shader program), pale grey with a faint
    // green fuse glow so it reads apart from the frag in flight
    if (smoke && !_smokeMat) _smokeMat = new THREE.MeshStandardMaterial({ color: 0x8a9088, emissive: 0x7dff9a, emissiveIntensity: 0.55 });
    p.m.material = frag ? _fragMat : smoke ? _smokeMat : _shellMat;
    p.m.scale.setScalar(frag || smoke ? 0.8 : 1);
  }
  // Only SHOW the mesh when THIS spawn is a mesh projectile. kill() removes p.m
  // from the scene but keeps it on the pooled object for the next grenade to
  // reuse — so a plain hitscan bullet popping that same pool slot used to re-add
  // the grenade sphere and drag it across the map. Gate on o.mesh, and hide a
  // cached mesh the current spawn does not want.
  if (p.m) {
    if (o.mesh) { p.m.visible = true; W.group("projectiles").add(p.m); }
    else { p.m.visible = false; }
  }
  projectiles.push(p);
  // a thrown grenade is not a bullet: no tracer streak behind it (the fuse glow is its read)
  if (!p.noActor) W.events.emit("tracer", p);
}

let _shellGeo = null, _shellMat = null, _fragMat = null, _smokeMat = null;

// ── smoke (contract C-SMOKE) ────────────────────────────────────────────────
/** A smoke canister pops at (x, y, z): one sphere on W.smokes = {x, y, z, r, t0, t1} (+ rMax, ownerId). r is the LIVE
 *  radius (tickSmokes rewrites it every frame from K.smokeRadiusAt), so losBlocked never blocks more than the cloud
 *  already covers; the entry is dropped at t1. The centre sits K.SMOKE.yOff over the rest point (a canister rolls to
 *  the floor), so a standing head is inside the cloud from the first second. Oldest entry recycled past maxLive.
 *  Pure sim state from the seeded round's path: same seed, same clouds. */
function deploySmoke(W, x, y, z, ownerId, t0) {
  if (!Array.isArray(W.smokes)) W.smokes = [];
  const S = K.SMOKE, now = t0 != null ? t0 : W.t;
  if (W.smokes.length >= S.maxLive) W.smokes.shift();
  const s = { x, y: y + S.yOff, z, r: 0, t0: now, t1: now + S.lifeS, rMax: S.r, ownerId: ownerId == null ? null : ownerId };
  s.r = K.smokeRadiusAt(s, W.t);
  W.smokes.push(s);
  W.events.emit("smokeDeployed", s);
  return s;
}
/** Grow / expire the live clouds (in place: the array identity is the contract). */
function tickSmokes(W) {
  const L = W.smokes;
  if (!L || !L.length) return;
  let j = 0;
  for (let i = 0; i < L.length; i++) {
    const s = L[i];
    if (W.t > s.t1) { W.events.emit("smokeExpired", s); continue; }
    s.r = K.smokeRadiusAt(s, W.t);
    L[j++] = s;
  }
  L.length = j;
}
// ── LC-22 LIVE BONES (FIX ROUND) ────────────────────────────────────────────────────────────────────────────────────
// The hit test reads the bones of an actor whose DRAWN pose is fresh: the camera focus, or on screen with its mixer at
// the full rate (player.js actorView: _onScreen, _mixRate 1 = within 40 m fov-scaled, every pose layer applied every
// frame). Everyone else (far, off screen, a half-rate mixer, no rig yet) keeps sim's deterministic table. The joints are
// the bones' world positions as last posed (the tick runs after the frame that drew them: the body the shooter saw);
// matrices are refreshed from the bones' local transforms here because a frame can be stepped without a render.
// Per actor, once per sim time W.t: one Float64Array(54) + the 18-bone list, built once per rig (no per-frame garbage).
const HV_LIVE_BONES = ["Hips", "Spine2", "Neck", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot", "Head", "LeftToeBase", "RightToeBase"];
const _hvV = new THREE.Vector3(), _hvM = new THREE.Matrix4();
/** the head-sphere centre in the Head bone's own frame: the centroid of the body meshes' Head-dominant vertices in bind
 *  pose (skinned world = bone.matrixWorld x boneInverse x bindMatrix x v, three's attached bind mode). Once per skin. */
const _hvHeadBySkin = new Map();
function headLocal(t, headBone) {
  const key = t.skin || "?";
  if (_hvHeadBySkin.has(key)) return _hvHeadBySkin.get(key);
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (const mesh of t._bodies) {
    const g = mesh.geometry, sk = mesh.skeleton;
    if (!g || !sk || !g.attributes.skinIndex || !g.attributes.skinWeight) continue;
    const hi = sk.bones.indexOf(headBone);
    if (hi < 0) continue;
    const P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    _hvM.multiplyMatrices(sk.boneInverses[hi], mesh.bindMatrix);
    for (let i = 0; i < P.count; i++) {
      let bw = -1, bi = -1;
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; bi = SI.getComponent(i, k); } }
      if (bi !== hi) continue;
      _hvV.fromBufferAttribute(P, i).applyMatrix4(_hvM);
      sx += _hvV.x; sy += _hvV.y; sz += _hvV.z; n++;
    }
  }
  const out = n > 20 ? { x: sx / n, y: sy / n, z: sz / n } : null;
  _hvHeadBySkin.set(key, out);
  return out;
}
function liveRig(t) {
  const rig = t.rig;
  if (t._hvRig === rig) return t._hvLB;
  t._hvRig = rig; t._hvLB = null;
  if (!rig || !rig.scene || !t._bodies || !t._bodies.length) return null;
  const by = {};
  rig.scene.traverse((o) => { if (o.isBone) { const n = o.name.replace(/^mixamorig:?/, ""); if (!by[n]) by[n] = o; } });
  const bones = HV_LIVE_BONES.map((n) => by[n] || null);
  if (bones.some((b) => !b)) return null;
  const hl = headLocal(t, bones[15]);
  if (!hl) return null;
  t._hvLB = { bones, head: hl, J: new Float64Array(K.HITVOL_LIVE_N || 54), t: -1 };
  return t._hvLB;
}
/** the live joints of t (world, the sim's HITVOL_LIVE layout) or null = use the table */
function liveJoints(W, t) {
  if (!K.HITVOL_LIVE_N || !t || !t.rig || !t.obj || t.downed || t.swimming) return null;
  const fresh = t === W.player || t === W._camFocus || (t._onScreen === true && t._mixRate === 1);
  if (!fresh || t.obj.visible === false) return null;
  const L = liveRig(t);
  if (!L) return null;
  if (L.t === W.t) return L.J;
  const B = L.bones, J = L.J;
  B[0].updateWorldMatrix(true, true);            // the obj chain down to the hips, then the whole skeleton under it
  for (let i = 0; i < 15; i++) { const e = B[i].matrixWorld.elements; J[i * 3] = e[12]; J[i * 3 + 1] = e[13]; J[i * 3 + 2] = e[14]; }
  _hvV.set(L.head.x, L.head.y, L.head.z).applyMatrix4(B[15].matrixWorld);
  J[45] = _hvV.x; J[46] = _hvV.y; J[47] = _hvV.z;
  for (let i = 0; i < 2; i++) { const e = B[16 + i].matrixWorld.elements; J[48 + i * 3] = e[12]; J[49 + i * 3] = e[13]; J[50 + i * 3] = e[14]; }
  L.t = W.t;
  return J;
}
/** LC-22 for any caller that needs "is this ray on the body" (hud aim-at tags, bots' line checks): the entry distance of
 *  the unit ray (o, d) into actor t's body within maxT (default 300 m), or -1. Same volumes as the bullets (live bones
 *  where fresh, else the table; swimming / downed / no data: the legacy cylinder). */
function hitVolRay(W, t, ox, oy, oz, dx, dy, dz, maxT) {
  if (!K || !t || !t.alive || !t.pos) return -1;
  const L = maxT > 0 ? maxT : 300;
  const bx = ox + dx * L, by = oy + dy * L, bz = oz + dz * L;
  const hv = K.hitVolSegment ? K.hitVolSegment(t, ox, oy, oz, bx, by, bz, W.t, liveJoints(W, t)) : -2;
  if (hv !== -2) return hv >= 0 ? hv * L : -1;
  // legacy cylinder (the bullets' own rule in testSegment): closest approach of the segment to the actor's axis
  const ex = bx - ox, ez = bz - oz, len2 = ex * ex + ez * ez;
  let u = len2 > 0 ? ((t.pos.x - ox) * ex + (t.pos.z - oz) * ez) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const px = ox + ex * u - t.pos.x, pz = oz + ez * u - t.pos.z, py = oy + (by - oy) * u;
  const feetY = t.pos.y, headY = t.pos.y + (t.swimming ? 0.9 : K.actorHeight(t));
  if (px * px + pz * pz < (K.PLAYERK.radius + 0.12) ** 2 && py > feetY - 0.05 && py < headY + 0.12) return u * L;
  return -1;
}
const NO_ACTORS = [];
const BOUNCED = 2;         // testSegment: the round bounced and its position + velocity are already set
// Colliders along ONE projectile's whole frame of travel. testSegment used to run a
// fresh queryColliders per 2.5 m sub-step (up to 8 a frame per round, each building
// an array, a Set and string keys) — the top allocation site of the whole frame,
// 180.7 KB/frame measured. One query per round per frame, into this reused array.
const _projCols = [];
function stepProjectiles(W, dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.tLeft -= dt;
    if (p.tLeft <= 0) {
      if (p.splash) explode(W, p.x, p.y, p.z, p.weaponId, p.rarity, p.ownerId); // fused shells burst
      else if (p.weaponId === "smoke") deploySmoke(W, p.x, p.y, p.z, p.ownerId);  // C-SMOKE: the canister pops
      kill(W, i, p);
      continue;
    }
    // sub-steps so fast bullets don't tunnel
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / 2.5)));
    const sx = p.x, sy = p.y, sz = p.z;
    // the frame's XZ travel (gravity only bends Y; a launcher bounce stays well
    // inside the 0.6 m margin at 26 m/s x 0.45)
    // (use the RETURN value: a maps.js without the out-param returns its own array)
    const hx = p.vx * dt / 2, hz = p.vz * dt / 2;
    const cols = W.map.queryColliders(sx + hx, sz + hz, Math.sqrt(hx * hx + hz * hz) + 0.6, _projCols);
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      const h = dt / steps;
      // EXACT ballistic step (parity P1-A): y += (vy0 + vy1) / 2 * h is the parabola itself, so an arcing
      // round lands where K.predictArc says at ANY frame rate (the old vy-first Euler step moved a lob by
      // g t h / 2: ~0.2 m at 60 Hz, ~0.5 m at 30 Hz). With gravity 0 it is the old arithmetic exactly.
      const vy0 = p.vy;
      p.vy += (p.gravity || 0) * h;
      const nx = p.x + p.vx * h, ny = p.y + (vy0 + p.vy) * 0.5 * h, nz = p.z + p.vz * h;
      const r = testSegment(W, p, p.x, p.y, p.z, nx, ny, nz, cols);
      // A BOUNCE placed the round at the contact itself. It used to be thrown away here (the round was
      // moved on to the segment's END - through a wall - and then reflected), so shells and frags passed
      // through walls on a bounce and burst on the far side.
      if (r === BOUNCED) continue;
      hit = r;
      if (!hit) { p.x = nx; p.y = ny; p.z = nz; }
    }
    // Whiz-by: a round passing close is the ONLY cue that you are under fire —
    // the impact tick tells you where it LANDED (audio.js: dirt 0.06 gain at
    // 45 m, stone/wood 0.07 at 55 m) and a round into open air said nothing at
    // all, so sniper fire read as "I died" rather than "someone is shooting
    // from my left". Tested once per frame against the whole step segment, not
    // per sub-step, so a 999 m/s round costs one distance calc; only for rounds
    // you did not fire.
    if (!p.dead && !p.whizzed && W.player && W.player.alive && p.ownerId !== W.player.id) {
      const c = W.camera.position;
      // broad phase first (inline, no call): the whole frame's segment lies within
      // its own length of its start, so a camera further than that + 3.5 m from the
      // start cannot be whizzed (segPointDist boxed 9 numbers per round per frame)
      const ex = c.x - sx, ey = c.y - sy, ez = c.z - sz;
      const fx = p.x - sx, fy = p.y - sy, fz = p.z - sz;
      const reach = Math.sqrt(fx * fx + fy * fy + fz * fz) + 3.5;
      if (ex * ex + ey * ey + ez * ez < reach * reach) {
        const miss = segPointDist(sx, sy, sz, p.x, p.y, p.z, c.x, c.y, c.z, _whizPt);
        if (miss < 3.5) { p.whizzed = true; W.events.emit("whizBy", { x: _whizPt.x, y: _whizPt.y, z: _whizPt.z }, miss); }
      }
    }
    if (p.m && !p.dead) p.m.position.set(p.x, p.y, p.z);
    // A round that has left the world can never hit anything: everything that can
    // be hit (actors, colliders, terrain) sits inside the map square, and nothing
    // bends a round sideways (only the launcher has gravity, and that only pulls
    // DOWN). A miss used to fly its full 3.5 s - 3.5 km at 999 m/s - testing
    // segments every frame far past the coast and over the sky, the bulk of the
    // projectile loop's work. Retire it once it is outside the square and moving
    // further out, or above everything (1 km; gliders top out near 460 m) and still
    // climbing without gravity. Nothing a round can do in play changes.
    if (!hit && !p.dead) {
      const lim = (W.map.size || 1600) * 0.5 + 20;
      if ((p.x > lim && p.vx >= 0) || (p.x < -lim && p.vx <= 0) || (p.z > lim && p.vz >= 0) || (p.z < -lim && p.vz <= 0) ||
          (p.y > 1000 && p.vy >= 0 && !p.gravity)) p.dead = true;
    }
    if (hit || p.dead) kill(W, i, p);
  }
}

function kill(W, i, p) {
  if (p.m) { W.group("projectiles").remove(p.m); }
  // in-place removal, ORDER KEPT (the order decides which of two rounds hitting in
  // one frame lands first): splice(i, 1) allocated its removed-elements array per kill
  const n = projectiles.length - 1;
  for (let j = i; j < n; j++) projectiles[j] = projectiles[j + 1];
  projectiles.length = n;
  POOL.push(p);
}

function testSegment(W, p, ax, ay, az, bx, by, bz, cols) {
  // ── NEAREST-HIT ARBITRATION ────────────────────────────────────────────────
  // This used to `return` on the FIRST actor whose capsule the segment touched,
  // before the static world was tested at all. Two consequences, both bad:
  //   1. COVER DID NOT STOP BULLETS. A sub-step runs up to 2.5 m, so any enemy
  //      within that distance of the far side of a wall, crate, tree or shipping
  //      container took full damage THROUGH it — with a hitmarker, a damage
  //      number and a kill. Every close-quarters fight around cover was decided
  //      wrongly, and the function's own header already claimed to resolve this.
  //   2. It took the first actor in W.actors order, not the CLOSEST one, so a
  //      round could pass through a teammate-adjacent body and register on
  //      whoever happened to sit earlier in the array.
  // Solve the world hit FIRST, keep the nearest actor candidate rather than the
  // first, then let whichever is nearer along the segment win.
  if (!cols) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, hx = (bx - ax) / 2, hz = (bz - az) / 2;
    cols = W.map.queryColliders(mx, mz, Math.sqrt(hx * hx + hz * hz) + 0.6);
  }
  const sh = K.segmentColliders(ax, ay, az, bx, by, bz, cols);
  const worldT = sh ? sh.t : Infinity;

  // 1) actors (capsule vs segment, coarse: sample closest point) — nearest wins.
  // Broad phase first: an actor whose axis is outside the sub-segment's XZ box
  // (grown by the capsule reach) cannot be hit, so it costs four compares, not a
  // projection and a Math.hypot (60 KB/frame of hypot garbage measured).
  // The broad-phase box grows by the widest reach of any measured pose (feet and the gun hand reach ~0.7 m from the
  // axis), the legacy cylinder's 0.57 m otherwise.
  const REACH = K.PLAYERK.radius + 0.12;
  const BREACH = K.HITVOL ? Math.max(REACH, K.HITVOL.reach) : REACH;
  const bx0 = (ax < bx ? ax : bx) - BREACH, bx1 = (ax < bx ? bx : ax) + BREACH;
  const bz0 = (az < bz ? az : bz) - BREACH, bz1 = (az < bz ? bz : az) + BREACH;
  let hitT = Infinity, hitActor = null, hitPx = 0, hitPy = 0, hitPz = 0, hitDh = 0, hitHead = false, hitVol = false;
  const acts = p.noActor ? NO_ACTORS : W.actors;
  for (let ai = 0; ai < acts.length; ai++) {
    const t = acts[ai];
    if (!t.alive || t.id === p.ownerId) continue;
    const cx = t.pos.x, cz = t.pos.z;
    if (cx < bx0 || cx > bx1 || cz < bz0 || cz > bz1) continue;
    // LC-22: the bone-derived body (sim HITVOL); -2 = no measured volume here (swimming, downed, no data): the cylinder
    const hv = K.hitVolSegment ? K.hitVolSegment(t, ax, ay, az, bx, by, bz, W.t, liveJoints(W, t)) : -2;
    if (hv !== -2) {
      if (hv >= 0 && hv < hitT) {
        hitT = hv; hitActor = t; hitVol = true; hitHead = K.HITVOL_HIT.head;
        hitPx = ax + (bx - ax) * hv; hitPy = ay + (by - ay) * hv; hitPz = az + (bz - az) * hv; hitDh = 0;
      }
      continue;
    }
    const feetY = t.pos.y, headY = t.pos.y + (t.swimming ? 0.9 : K.actorHeight(t));
    // closest point of segment to vertical axis of capsule
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let u = len2 > 0 ? (((cx - ax) * dx) + ((cz - az) * dz)) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + dx * u, pz = az + dz * u, py = ay + (by - ay) * u;
    const ex2 = px - cx, ez2 = pz - cz;
    const dh = Math.sqrt(ex2 * ex2 + ez2 * ez2);
    if (dh < REACH && py > feetY - 0.05 && py < headY + 0.12) {
      if (u < hitT) { hitT = u; hitActor = t; hitPx = px; hitPy = py; hitPz = pz; hitDh = dh; hitVol = false; hitHead = false; }
    }
  }
  // the round only reaches the actor if no solid surface is nearer along the path
  if (hitActor && hitT <= worldT) {
    {
      const t = hitActor, px = hitPx, py = hitPy, pz = hitPz, dh = hitDh;
      const feetY = t.pos.y, headY = t.pos.y + (t.swimming ? 0.9 : K.actorHeight(t));
      if (p.splash) { explode(W, px, py, pz, p.weaponId, p.rarity, p.ownerId); p.dead = true; return true; }
      const ox = px - p.origin.x, oy = py - p.origin.y, oz = pz - p.origin.z;
      const distFromOrigin = Math.sqrt(ox * ox + oy * oy + oz * oz);
      // The 2.5x head zone used to be the ENTIRE body cylinder above 0.8 height:
      // dh was never re-tested, so a 1.14 m wide disc (radius 0.45 + 0.12 slop)
      // paid headshot damage on a rig whose shoulders are ~0.5 m across — a
      // sniper round passing half a metre clear of the model still dealt
      // 105 * 2.5 = 263 and one-shot a full 100 shield + 100 HP bar. Body
      // registration on the line above is deliberately left as forgiving as it
      // was; only the multiplier tightens, to a 0.4 m band in the top 14%.
      // LC-22: a measured-volume hit is a headshot when it entered the HEAD SPHERE (fitted to the Head-weighted
      // vertices); the legacy cylinder (swimming / downed) keeps this band rule, with no headshots on a downed body
      // (its crawl pose has no measured head yet)
      const isHead = hitVol ? hitHead : (!t.downed && py > feetY + (headY - feetY) * 0.86 && dh < 0.2);
      const dmg = K.hitDamage(p.weaponId, p.rarity, distFromOrigin, isHead, dmgRoll(W));
      if (t.netRemote && !t.isDummy) {
        // remote-owned actor: its client (or the host, for bots) applies damage.
        // The owner id has to ride along: without it net.js stamped every hit as
        // `attacker: W.player.id`, so a host-simulated BOT's kill showed up on the
        // guest as the host eliminating them (wrong kill-feed name, wrong death-cam
        // spectate target, inflated host kill count on every other screen).
        if (W.reportRemoteHit) W.reportRemoteHit(t, dmg, p.weaponId, isHead, p.ownerId);
      } else {
        W.hurtActor(t, dmg, p.ownerId, p.weaponId, isHead);
      }
      const owner = W.actorById.get(p.ownerId);
      if (owner && !owner.isBot) W.stats.shotsHit++;
      if (owner) W.events.emit("hitMarker", owner, t, dmg, isHead);
      W.events.emit("impact", { x: px, y: py, z: pz }, "flesh");
      p.dead = true; return true;
    }
  }
  // 2) static world: SWEPT segment vs colliders.
  // This used to test only whether the sub-step's END POINT landed inside a box.
  // Sub-steps run up to 2.5 m, so a 0.32 m wall was missed ~87% of the time, and
  // ramps (kind !== "box") were skipped entirely — cover did not stop bullets.
  // Query along the WHOLE segment, not just around the endpoint, or a wall
  // crossed mid-step is never even a candidate.
  // (the query + swept solve were hoisted to the top so the actor test could be
  // arbitrated against them; `sh` is already computed)
  if (sh) {
    const c = sh.c;
    // impact at the ENTRY point on the face, not the overshot endpoint
    const hx = ax + (bx - ax) * sh.t, hy = ay + (by - ay) * sh.t, hz = az + (bz - az) * sh.t;
    if (p.splash && !p.bounce) {
      // contact burst: 0.15 m back out along the face normal, so the blast point is outside the solid and
      // blastBlocked (losBlocked from the blast) sees the shooter's side of the wall, not the wall's own inside
      const on = sh.nx || sh.ny || sh.nz ? 0.15 : 0;
      explode(W, hx + sh.nx * on, hy + sh.ny * on, hz + sh.nz * on, p.weaponId, p.rarity, p.ownerId);
      p.dead = true; return true;
    }
    if (p.bounce) {
      // reflect off the face we actually entered through (the old code derived
      // the normal from the overshot endpoint's smallest penetration axis)
      let nx = sh.nx, ny = sh.ny, nz = sh.nz;
      if (!nx && !ny && !nz) ny = 1;                 // started inside: shove it up
      p.x = hx + nx * 0.06; p.y = hy + ny * 0.06; p.z = hz + nz * 0.06;
      bounceEvent(W, p, nx, ny, nz);
      bounceOff(p, nx, ny, nz);
      return BOUNCED;
    }
    // destructible prop (barrel/tree): a direct hit chips its hp; barrels detonate
    // on any hit, trees drop once their hp is gone (then the collider is removed).
    if (c.prop && c.hp > 0 && W.map.destroyProp) {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      c.hp -= K.hitDamage(p.weaponId, p.rarity, 0, false);
      if (c.prop === "barrel") {
        W.map.destroyProp(c);
        explode(W, cx, c.minY + 0.8, cz, "glauncher", 0, p.ownerId);   // barrel blows up (splash + knockback)
      } else if (c.hp <= 0) {
        W.map.destroyProp(c);
        W.events.emit("propBreak", { x: cx, y: c.minY, z: cz, kind: c.prop });
      } else {
        // nx/ny/nz: the entry-face normal rides along so fx can place a decal
        // flush on the surface (fields are additive — older listeners read x/y/z)
        // Surface by PROP KIND: cars/containers ring metal, rocks chip stone —
        // audio.js has carried imp_metal since the Kenney pack landed with no
        // emitter ever sending the surface (sweep finding).
        const surf = (c.prop === "car" || c.prop === "container") ? "metal"
                   : c.prop === "rocks" ? "stone" : "wood";
        W.events.emit("impact", { x: hx, y: hy, z: hz, nx: sh.nx, ny: sh.ny, nz: sh.nz }, surf);
      }
      p.dead = true; return true;
    }
    W.events.emit("impact", { x: hx, y: hy, z: hz, nx: sh.nx, ny: sh.ny, nz: sh.nz }, "stone");
    p.dead = true; return true;
  }
  // 3) terrain
  const th = W.map.heightAt(bx, bz);
  if (by <= th) {
    if (p.splash && !p.bounce) {
      // burst where the shell actually touched down inside this sub-step (not its overshot end point)
      const ha = W.map.heightAt(ax, az), da = ay - ha, db = by - th;
      const f = da > 0 && da - db > 1e-9 ? da / (da - db) : 1;
      const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f;
      explode(W, cx, W.map.heightAt(cx, cz) + 0.15, cz, p.weaponId, p.rarity, p.ownerId);
      p.dead = true; return true;
    }
    if (p.bounce) {
      // contact INSIDE the segment (the ground under a and b, interpolated), not the overshot end point:
      // up to v x dt = 0.3-0.7 m past where a lob actually touched down
      const ha = W.map.heightAt(ax, az), da = ay - ha, db = by - th;
      const f = da > 0 && da - db > 1e-9 ? da / (da - db) : 1;
      const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f;
      // approximate normal from height gradient
      const e = 0.6;
      const nx2 = W.map.heightAt(cx - e, cz) - W.map.heightAt(cx + e, cz);
      const nz2 = W.map.heightAt(cx, cz - e) - W.map.heightAt(cx, cz + e);
      const inv = 1 / Math.sqrt(nx2 * nx2 + 4 * e * e + nz2 * nz2);
      const nnx = nx2 * inv, nny = 2 * e * inv, nnz = nz2 * inv;
      p.x = cx; p.z = cz; p.y = W.map.heightAt(cx, cz) + 0.12;
      bounceEvent(W, p, nnx, nny, nnz);
      bounceOff(p, nnx, nny, nnz);
      return BOUNCED;
    }
    W.events.emit("impact", { x: bx, y: th, z: bz }, "dirt");
    p.dead = true; return true;
  }
  return false;
}

/** "roundBounce" (pos, weaponId, impact speed into the surface): a clink for audio (P1-B), and the
 *  landing point the frag gate compares with K.predictArc. Only real impacts (> 1.5 m/s into the face):
 *  a resting round re-touches the ground every few frames. */
const _bncPos = { x: 0, y: 0, z: 0 };
function bounceEvent(W, p, nx, ny, nz) {
  const vin = -(p.vx * nx + p.vy * ny + p.vz * nz);
  if (vin < 1.5) return;
  _bncPos.x = p.x; _bncPos.y = p.y; _bncPos.z = p.z;
  W.events.emit("roundBounce", _bncPos, p.weaponId, vin);
}

function bounceOff(p, nx, ny, nz) {
  const dot = p.vx * nx + p.vy * ny + p.vz * nz;
  p.vx = (p.vx - 2 * dot * nx) * 0.45;
  p.vy = (p.vy - 2 * dot * ny) * 0.45;
  p.vz = (p.vz - 2 * dot * nz) * 0.45;
}

// ── explosions ───────────────────────────────────────────────────────────────
/** LC-25: splash used to reach every actor inside the radius THROUGH walls, floors and hills. A victim
 *  is shielded when the line from the blast to its chest AND the line to its head are both blocked
 *  (maps.js losBlocked: swept colliders + terrain; read-only use of the maps API). Two lines, so a body
 *  half behind a low wall is still caught. Blast points sit outside solids by construction (a bounce
 *  rests 0.06 m off the face or 0.12 m over the ground; a barrel's own collider is dead before it
 *  bursts). A map without losBlocked keeps the old open splash. */
function blastBlocked(W, x, y, z, t) {
  const los = W.map && W.map.losBlocked;
  if (!los) return false;
  const h = t.swimming ? 0.8 : K.actorHeight(t);
  const top = t.pos.y + h - 0.2;
  // chest line: 1.0 m on a standing body, half the 0.6 m capsule on a downed one (C-DBNO) so a knocked body is
  // judged at the height it actually lies at
  if (!los(x, y, z, t.pos.x, t.pos.y + (t.downed ? h * 0.5 : 1.0), t.pos.z)) return false;
  return !!los(x, y, z, t.pos.x, top, t.pos.z);
}
function explode(W, x, y, z, weaponId, rarity, ownerId, depth) {
  depth = depth || 0;
  const def = K.WEAPONS[weaponId] || K.WEAPONS.glauncher;
  const R = def.splashR || 3.5;
  for (const t of W.actors) {
    if (!t.alive) continue;
    // body centre: 0.9 m standing (unchanged), 0.3 m for a downed body lying on the ground (C-DBNO)
    const d = Math.hypot(t.pos.x - x, (t.pos.y + (t.downed ? K.actorHeight(t) * 0.5 : 0.9)) - y, t.pos.z - z);
    const k = K.splashScale(d, R + 0.8);
    if (k > 0 && !blastBlocked(W, x, y, z, t)) {
      const dmg = Math.round(K.hitDamage(weaponId, rarity, 0, false, dmgRoll(W)) * k);
      if (t.netRemote && !t.isDummy) {
        // remote-owned actor: its own client is authoritative over its HP — route
        // splash through the same path as direct hits so it isn't double-counted.
        // ownerId travels with it for the same attribution reason as the direct-hit
        // site above (host bots were credited to the host).
        if (W.reportRemoteHit) W.reportRemoteHit(t, dmg, weaponId, false, ownerId);
      } else {
        W.hurtActor(t, dmg, ownerId === t.id ? null : ownerId, weaponId, false);
      }
      // knockback (cosmetic; remote actors are corrected by the next net snapshot)
      const kb = 7 * k;
      const dl = Math.max(0.1, d);
      t.vel.x += ((t.pos.x - x) / dl) * kb;
      t.vel.y += 4 * k;
      t.vel.z += ((t.pos.z - z) / dl) * kb;
      t.onGround = false;
    }
  }
  // environment: level nearby trees, detonate nearby barrels (chain reaction, depth-capped)
  if (W.map.destroyProp && W.map.queryColliders) {
    // own array: explode() recurses through barrel chains while iterating this
    // list, and queryColliders' default return is one shared scratch array
    const near = W.map.queryColliders(x, z, R + 1.5, []);
    for (const c of near) {
      if (c.dead || !c.prop || !c.hp) continue;
      const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2, cz = (c.minZ + c.maxZ) / 2;
      if (Math.hypot(cx - x, cy - y, cz - z) > R + 1.2) continue;
      W.map.destroyProp(c);
      if (c.prop === "barrel" && depth < 3) explode(W, cx, cy, cz, "glauncher", 0, ownerId, depth + 1);
      else W.events.emit("propBreak", { x: cx, y: c.minY, z: cz, kind: c.prop });
    }
  }
  W.events.emit("explosion", { x, y, z }, R);
}
