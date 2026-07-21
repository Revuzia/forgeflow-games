/**
 * royale/player.js — unified ACTOR system for Last Circle.
 *
 * One code path for the human and all 49 bots: every actor carries an `input`
 * struct (move axes, look yaw/pitch, fire/ads/jump/... flags). The human's
 * keyboard+mouse writes into W.player.input; bot brains (royale/bots.js) write
 * into their actor's input. Movement, physics, animation, and camera all read
 * only from actor state — so bots ARE players mechanically.
 *
 * Owns: actor creation, character models (Quaternius rigs, 4 skins), the
 * glider drop, capsule-vs-world movement (terrain heightfield + static AABBs +
 * ramps + build pieces), animation state, name tags, the third-person camera,
 * spectate, and death/despawn.
 */
import * as THREE from "three";
// ?v= must propagate to intra-runtime imports (FFG gotcha) → top-level await
const { findArmBones, applyArmPose, measureLean, uprightTorso } = await import("./pose.js" + (new URL(import.meta.url).search || ""));

let K = null; // SIM shortcut set in init

export function init(W) {
  K = W.SIM;
  W.hurtActor = (victim, dmg, attackerId, weaponId, isHead) => hurtActor(W, victim, dmg, attackerId, weaponId, isHead);
  W.killActor = (victim, killerId, weaponId) => killActor(W, victim, killerId, weaponId);
  W.useConsumable = (a, id) => useConsumable(W, a, id);
  W.events.on("useConsumable", (a, id) => useConsumable(W, a, id));
  installHumanInput(W);
}

// ── actor factory ────────────────────────────────────────────────────────────
export function createActor(W, opts) {
  const a = {
    id: opts.id, name: opts.name, isBot: !!opts.isBot,
    tier: opts.tier || 3, personality: opts.personality || "rotator",
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    hp: K.PLAYERK.hp, shield: 0, alive: true, downedAt: 0,
    onGround: false, sprinting: false, gliding: false, inWater: false, swimming: false,
    input: mkInput(),
    inventory: {
      // everyone spawns with a pistol — this is a shooter, not a scavenger sim
      slots: [{ kind: "weapon", id: K.START_LOADOUT.weapon, rarity: K.START_LOADOUT.rarity, mag: K.WEAPONS[K.START_LOADOUT.weapon].mag }, null, null, null, null],
      active: 0,
      ammo: Object.assign({ light: 0, medium: 0, shells: 0, heavy: 0, grenades: 0 }, K.START_LOADOUT.ammo),
    },
    weapon: { id: K.START_LOADOUT.weapon, rarity: 0, magAmmo: K.WEAPONS[K.START_LOADOUT.weapon].mag, state: "ready", cd: 0, reloadT: 0 },
    aimErr: 0, lastShotT: -9, lastDamageT: -9, lastAttacker: null,
    healing: null,           // {id, tLeft}
    obj: new THREE.Group(), rig: null, nameTag: null, weaponMesh: null,
    anim: "idle", mixerLOD: 0,
    kills: 0,
    brain: null,
    netRemote: false,        // true = driven by network peer
  };
  a.obj.name = "actor_" + a.id;
  W.group("actors").add(a.obj);
  W.actors.push(a);
  W.actorById.set(a.id, a);
  return a;
}

function mkInput() {
  return {
    mx: 0, mz: 0, jump: false, sprint: false, crouch: false,
    yaw: 0, pitch: 0, fire: false, ads: false, reload: false,
    interact: false, interactDown: false, slot: -1,
  };
}

// ── models ───────────────────────────────────────────────────────────────────
// MESHY AI-GENERATED battle-royale cast (owner direction: no reused fantasy
// characters). Each skin = <key>.glb (mesh+skeleton+idle) + tiny clip-only
// GLBs (<key>_walk/_run/_death.glb) sharing the same skeleton — clips get
// merged into the cached gltf so every clone has the full action set.
// Round-2 fist cast (hands modeled CLOSED — Meshy rigs have no finger bones,
// so open-hand models can never grip; these were generated fists-first).
// drifter/SCRAP REMOVED — Meshy shipped his rig with a 27° baked-in forward
// slouch (every other fighter sits at 1-5°); un-slouchable without regen and
// the regen risked the same. Owner call: cut him.
const SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"];
// Per-skin weapon-holder rotation (hand-bone local). Meshy rigs DON'T share a
// hand-bone rest orientation, so one fixed rotation left wraith/juggernaut
// aiming 35° high. These were auto-calibrated live (measure barrel → rotate to
// forward+level) and verified: dot 1.0, muzzle level on all five.
const HAND_AIM_ROT = {
  soldier:    [-1.449, -0.105, -0.779],
  athlete:    [-1.637, -0.090, -0.788],
  wraith:     [-1.067, -0.403, -0.680],
  juggernaut: [-1.094, -0.444, -0.676],
  viper:      [-1.338,  0.023, -0.788],
};
// armed clips (Alert / Walk_Forward_While_Shooting / Run_and_Shoot) retarget
// badly on these rigs — arms folded over the face ("broken bone" screenshots).
// Arms are posed at runtime (pose.js); locomotion + jump/swim clips load.
const MESHY_CLIPS = ["walk", "run", "death", "dance", "cheer", "jump", "swim", "crouch"];
const _v3 = new THREE.Vector3();

async function preloadMeshySkin(W, key) {
  const url = W.assetBase + "assets/chars/meshy/" + key + ".glb";
  const rig = await W.kernel.loadCharacter(url);   // caches gltf; registers this throwaway clone's mixer
  rig.scene.visible = false;
  const cached = W.kernel._charCache[url];
  if (cached && !cached.__lcMerged) {
    cached.__lcMerged = true;
    if (cached.animations && cached.animations[0]) cached.animations[0].name = "idle";
    for (const clip of MESHY_CLIPS) {
      try {
        const g = await W.kernel.loader.loadAsync(W.assetBase + "assets/chars/meshy/" + key + "_" + clip + ".glb");
        if (g.animations && g.animations[0]) { g.animations[0].name = clip; cached.animations.push(g.animations[0]); }
      } catch (e) { console.warn("[chars] clip load failed", key, clip, e); }
    }
  }
  return url;
}

export async function loadActorModels(W) {
  // tolerant preload: a still-baking skin just drops out of rotation
  const settled = await Promise.allSettled(SKINS.map((k) => preloadMeshySkin(W, k)));
  const urls = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!urls.length) throw new Error("no character skins available");
  const vr = K.mulberry32(W.seed ^ 0xfaceb);
  // the human's locker choice (menu skin bay) — bots keep rotating the cast
  let chosen = null;
  try { chosen = localStorage.getItem("lc_skin"); } catch (e) {}
  const chosenUrl = chosen && urls.find((u) => u.includes("/" + chosen + ".glb"));
  for (let i = 0; i < W.actors.length; i++) {
    const a = W.actors[i];
    const url = (!a.isBot && chosenUrl) ? chosenUrl : urls[i % urls.length];
    const rig = await W.kernel.loadCharacter(url);
    a.rig = rig;
    a.skin = url.split("/").pop().replace(/\.glb.*/, "");
    // PROCEDURAL VARIETY: 4 base rigs × per-actor hue/lightness tints on
    // cloned materials — 50 visually distinct opponents.
    const hueShift = (vr() - 0.5) * 0.2, lightShift = (vr() - 0.5) * 0.14;
    const seen = new Map();
    rig.scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.material) return;
      if (!seen.has(o.material)) {
        const m = o.material.clone();
        if (m.color) m.color.offsetHSL(hueShift, 0.02, lightShift);
        seen.set(o.material, m);
      }
      o.material = seen.get(o.material);
    });
    // Meshy rigs are authored at REAL METERS (rigging height_meters: 1.8,
    // feet at y=0) — do NOT bbox-normalize: the bind-pose bbox of a Meshy
    // SkinnedMesh reads ~0.1m (tiny armature node scales) and "normalizing"
    // it spawned 26m giants once the animation restored true proportions.
    rig.scene.scale.setScalar(1);
    rig.scene.position.y = 0;
    a.obj.add(rig.scene);
    a.clips = classifyClips(rig);
    // the capsule only shrinks when this actor can actually be SEEN crouching
    a.hasCrouchClip = !!a.clips.crouch;
    a.armBones = findArmBones(rig.scene);   // runtime arm-pose layer (pose.js)
    // detect a defective slouching rig (Meshy shipped drifter at ~27°; the
    // rest sit at 1-5°) → straighten its torso every frame
    a.obj.updateMatrixWorld(true);
    a.torsoFix = measureLean(a.armBones) > 0.20;   // >~11° = slouched
    playAnim(a, "idle");
    // name tag sprite (not for self)
    if (a.id !== (W.player && W.player.id)) a.nameTag = mkNameTag(W, a);
    // weapon holder on the RIGHT HAND bone (Meshy = "RightHand"; Quaternius
    // fallback "FistR"). Bone world scale varies wildly between rig families
    // (Meshy ~0.065 vs Quaternius ~5.5) — compensate so guns keep world size.
    let fist = null;
    rig.scene.traverse((o) => { if (o.isBone && /^RightHand$|^FistR$/i.test(o.name) && !fist) fist = o; });
    a.hand = new THREE.Group();
    a.handBone = fist;   // for per-frame barrel aiming (rig hand orientations differ)
    if (fist) {
      fist.add(a.hand);
      a.obj.updateMatrixWorld(true);
      fist.getWorldScale(_v3);
      const ws = Math.max(1e-4, _v3.x);
      a.hand.scale.setScalar(1 / ws);
      // grip orientation — grid-searched live against the gunReady arm pose so
      // the barrel points FORWARD and level out of the fist (was 37° down and
      // off to the right; owner: "gun is STILL pointing the wrong way").
      // dotForward 0.99 at (-90°, 0, -45°). Weapon grip anchor (weapons.js)
      // sits the handle at this origin.
      a.hand.position.set(0, 0.02 / ws, 0);
      const hr = HAND_AIM_ROT[a.skin] || [-Math.PI / 2, 0, -Math.PI / 4];
      a.hand.rotation.set(hr[0], hr[1], hr[2]);
    } else {
      a.hand.position.set(0.32, 1.15, 0.28);
      a.obj.add(a.hand);
    }
    // show the starting pistol in hand (re-equip wires slotRef + mesh)
    if (W.equipSlot) W.equipSlot(a, a.inventory.active);
  }
}

function classifyClips(rig) {
  const names = Object.keys(rig.actions || {});
  const find = (pats) => {
    for (const p of pats) { const n = names.find((x) => p.test(x)); if (n) return n; }
    return null;
  };
  const idle = find([/^idle$/i, /^idle\b/i]) || names[0];
  const run = find([/^run$/i, /^run\b/i]) || names[0];
  const walk = find([/^walk$/i, /^walk\b/i]) || run;
  return {
    idle,
    run,
    walk,
    swim: find([/^swim$/i]) || run,
    jump: find([/jump/i, /fall/i]),
    death: find([/death|die|defeat/i]),
    shoot: find([/shoot|attack|punch|slash|hit/i]),
    dance: find([/^dance$/i, /dance/i]),
    cheer: find([/^cheer$/i, /cheer|wave|victory/i]),
    // Meshy action 524 "Cautious_Crouch_Walk_Forward". Falls back to walk so a
    // skin whose crouch clip failed to bake still animates (and actorHeight()
    // keeps its capsule honest via hasCrouchClip below).
    crouch: find([/^crouch$/i, /crouch/i]),
  };
}

function playAnim(a, key, opts) {
  if (!a.rig || !a.clips) return;
  const realKey = key;
  const clip = a.clips[realKey] || a.clips.idle;
  if (!clip) return;
  // `|| 1` swallowed an explicit timeScale of 0 (falsy), so "freeze this clip"
  // silently played at full speed — a crouching player marched in place.
  const ts = opts && opts.timeScale != null ? opts.timeScale : 1;
  if (a.anim === realKey && !(opts && opts.force)) {
    // same clip, new pace → retune the live action, never restart (restart
    // every frame while speed varies = visible stutter)
    if (a._animTS !== ts) {
      const act = a.rig.actions[clip];
      if (act) act.setEffectiveTimeScale(ts);
      a._animTS = ts;
    }
    return;
  }
  a.anim = realKey;
  a._animTS = ts;
  a.rig.play(clip, Object.assign({ timeScale: ts }, opts));
}

function mkNameTag(W, a) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 48;
  const ctx = cv.getContext("2d");
  ctx.font = "bold 26px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  const w = Math.min(240, ctx.measureText(a.name).width + 22);
  ctx.beginPath(); ctx.roundRect(128 - w / 2, 4, w, 38, 8); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(a.name, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sp.scale.set(2.6, 0.49, 1);
  sp.position.y = 2.25;
  a.obj.add(sp);
  return sp;
}

// ── spawning / drop ─────────────────────────────────────────────────────────
export function spawnAll(W) {
  const modeK = K.MODE[W.mode] || K.MODE.standard;
  const rng = K.mulberry32(W.seed ^ 0x5eed);
  for (const a of W.actors) {
    if (modeK.drop === "glider" && W.mode !== "practice") {
      // airborne NEAR the actor's drop target (assignDrops refines bots right
      // after this) — like jumping from the bus at the right moment. Humans
      // spawn high over a random point and steer freely.
      const p = W.map.randomGroundPos(rng);
      a.pos.set(p.x, 240 + rng() * 30, p.z);
      a.gliding = true;
      a.vel.set(0, -2, 0);
    } else {
      const p = W.map.randomGroundPos(rng);
      a.pos.set(p.x, p.y + 0.1, p.z);
      a.gliding = false;
    }
    a.obj.position.copy(a.pos);
    a.shield = W.mode === "quick" ? 25 : 0;
  }
  // practice: give the player a full kit
  if (W.mode === "practice") {
    const inv = W.player.inventory;
    inv.slots[1] = { kind: "weapon", id: "ar", rarity: 2, mag: K.WEAPONS.ar.mag };
    inv.slots[2] = { kind: "weapon", id: "shotgun", rarity: 2, mag: K.WEAPONS.shotgun.mag };
    inv.slots[3] = { kind: "weapon", id: "sniper", rarity: 3, mag: K.WEAPONS.sniper.mag };
    inv.slots[4] = { kind: "weapon", id: "glauncher", rarity: 3, mag: K.WEAPONS.glauncher.mag };
    inv.ammo = { light: 999, medium: 999, shells: 999, heavy: 999, grenades: 999 };
  }
}

// The practice lobby advertised "RANGE TARGETS SOUTH, MOVEMENT COURSE EAST"
// and neither existed — the only match for that string in the whole runtime was
// the advertisement itself. This builds the range it promised: a row of dummies
// at real engagement distances, laid out south of wherever practice dropped you
// and sat on the terrain. They are deliberately NOT registered with W.match, so
// they cannot touch alive-count, placement or the victory check.
// Creation and placement are separate because models load BEFORE spawnAll runs:
// a dummy created after loadActorModels would have no rig, and one positioned
// before spawnAll would immediately be scattered by it.
export const RANGE_DISTANCES = [12, 22, 35, 55, 80];
export function createPracticeRange(W) {
  W.rangeDummies = RANGE_DISTANCES.map((d, i) => {
    const a = createActor(W, { id: "dummy" + i, name: d + "m", isBot: true });
    a.isDummy = true;
    a.netRemote = true;          // never brain-driven, never net-authoritative
    return a;
  });
  return W.rangeDummies;
}
export function placePracticeRange(W) {
  const p = W.player;
  if (!p || !W.rangeDummies) return;
  W.rangeDummies.forEach((a, i) => {
    const x = W.SIM.clamp(p.pos.x + (i - 2) * 3.5, -W.map.half + 10, W.map.half - 10);
    const z = W.SIM.clamp(p.pos.z - RANGE_DISTANCES[i], -W.map.half + 10, W.map.half - 10);
    a.pos.set(x, W.map.heightAt(x, z) + 0.1, z);
    a.yaw = Math.PI;             // face the shooter
    a.gliding = false;
    a.vel.set(0, 0, 0);
    a.obj.position.copy(a.pos);
    a.obj.rotation.y = a.yaw;
  });
}

// Move the human's glide start over a chosen landing zone (the drop-select
// screen). Bots already get this in bots.assignDrops — the player was the only
// actor on the field still falling on a random point. Altitude is untouched, so
// there is still a full glide to steer.
export function setDropTarget(W, t) {
  const a = W.player;
  if (!a || !t) return;
  const lim = W.map.half - 12;
  a.pos.x = W.SIM.clamp(t.x, -lim, lim);
  a.pos.z = W.SIM.clamp(t.z, -lim, lim);
  a.obj.position.copy(a.pos);
  W.dropTarget = { x: a.pos.x, z: a.pos.z, name: t.name || "" };
}

// ── human input ──────────────────────────────────────────────────────────────
function installHumanInput(W) {
  const dom = W.kernel.renderer.domElement;
  const keys = {};
  const bind = () => (W.settings.keys || {});

  // Keybind remap: settings.remap maps a custom physical key → the canonical
  // default code, so all logic below stays written against the defaults.
  const canon = (c) => (W.settings.remap && W.settings.remap[c]) || c;
  window.addEventListener("keydown", (ev) => {
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
    if (W.captureKey) { W.captureKey(ev.code); ev.preventDefault(); return; }
    const e = { code: canon(ev.code), preventDefault: () => ev.preventDefault() };
    keys[e.code] = true;
    if (!W.player || W.phase === "menu") return;
    const inp = W.player.input;
    if (e.code === "KeyR") inp.reload = true;
    if (e.code === "KeyE") { inp.interact = true; inp.interactDown = true; }
    if (e.code === "Space" && !e.repeat) { inp.jump = true; e.preventDefault(); } // edge-gate: key-repeat was strobing the chute (deploy/cut/deploy) + multi-firing swim strokes
    if (e.code === "Digit1") inp.slot = 0;
    if (e.code === "Digit2") inp.slot = 1;
    if (e.code === "Digit3") inp.slot = 2;
    if (e.code === "Digit4") inp.slot = 3;
    if (e.code === "Digit5") inp.slot = 4;
    if (e.code === "KeyM") W.events.emit("toggleBigMap");
    if (e.code === "KeyB") inp.emote = "dance";
    if (e.code === "KeyN") inp.emote = "cheer";
    if (e.code === "Escape") W.events.emit("escPressed");
  });
  window.addEventListener("keyup", (ev) => {
    const code = canon(ev.code);
    keys[code] = false;
    if (code === "KeyE" && W.player) W.player.input.interactDown = false;
  });

  // Mouse model — mouse-look is the PRIMARY control (owner: "moving the mouse
  // should let me look around, instead of right click and hold"):
  //   any click     = engage pointer lock → then moving the mouse looks around
  //   locked        = mouse-look; LMB shoot; RMB ADS
  //   unlocked      = cursor-follow aim fallback; RMB-drag to look (preview /
  //                   lock-denied only — real play locks on the first click)
  const tryLock = () => {
    if (document.pointerLockElement !== dom) {
      try { const p = dom.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {}
    }
  };
  let rmbDrag = false;
  dom.addEventListener("mousedown", (e) => {
    if (!W.player || W.phase === "menu" || W.paused) return;
    tryLock();                     // ANY click grabs the mouse for looking
    if (e.button === 0) {
      W._lmbDown = true;
      W._fireEdge = true;           // fresh click — semi-auto weapons fire on this EDGE only
      W.player.input.fire = true;   // never swallow the shot
    }
    if (e.button === 2) { W._rmbDown = true; W.player.input.ads = true; rmbDrag = document.pointerLockElement !== dom; }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) { W._lmbDown = false; W._fireEdge = false; }
    if (e.button === 2) { W._rmbDown = false; rmbDrag = false; }
    if (!W.player) return;
    if (e.button === 0) W.player.input.fire = false;
    if (e.button === 2) W.player.input.ads = false;
  });
  // safety: a mouseup outside the window would otherwise leave fire/ADS stuck
  // (stuck ADS = permanent 3.4 m/s — feels like the game is broken-slow)
  const clearButtons = () => { W._lmbDown = false; W._rmbDown = false; if (W.player) { W.player.input.fire = false; W.player.input.ads = false; } rmbDrag = false; };
  window.addEventListener("blur", clearButtons);
  document.addEventListener("mouseleave", clearButtons);
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("mousemove", (e) => {
    // ALWAYS track the cursor: without pointer lock the shot must land where
    // the visible mouse points, not at screen center (playtest: "I aim and my
    // pistol doesn't work")
    const rect = dom.getBoundingClientRect();
    W.mousePx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    W.mouseNDC = {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      y: -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
    };
    if (!W.player || W.paused || W.phase === "menu") return;
    const locked = document.pointerLockElement === dom;
    if (!locked && !rmbDrag) return;
    const sens = (W.player.input.ads ? W.settings.adsSensitivity : W.settings.sensitivity) * 0.0022;
    const mx2 = e.movementX || 0, my2 = e.movementY || 0;
    W.player.input.yaw -= mx2 * sens;
    W.player.input.pitch = K.clamp(W.player.input.pitch - my2 * sens, -1.35, 1.35);
  });
  window.addEventListener("wheel", (e) => {
    // scroll cycles weapon slots (standard shooter convention)
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inv = W.player.inventory;
    const dir2 = e.deltaY > 0 ? 1 : -1;
    for (let step = 1; step <= 5; step++) {
      const idx = (inv.active + dir2 * step + 10) % 5;
      if (inv.slots[idx]) { W.player.input.slot = idx; break; }
    }
  });

  // continuous axes each frame — the human input struct is rebuilt EVERY
  // frame exclusively from live key/button state, so nothing (stale brain,
  // missed keyup, replayed event) can hold a phantom move or trigger
  W.kernel.onUpdate(() => {
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inp = W.player.input;
    inp.mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    inp.mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    inp.sprint = !!keys.ShiftLeft || !!keys.ShiftRight;
    // Crouch defaults to C, NOT Ctrl: this runs in a browser next to WASD, and
    // Ctrl+W closes the tab. Rebindable like any other action.
    inp.crouch = !!keys.KeyC;
    inp.fire = !!W._lmbDown;
    inp.ads = !!W._rmbDown;
  });
  W.pointerLocked = () => document.pointerLockElement === dom;
  W.resetInputState = () => { for (const k in keys) keys[k] = false; W._lmbDown = false; W._rmbDown = false; };
}

// ── movement + physics ──────────────────────────────────────────────────────
const STEP_UP = 0.55;
const tmpV = new THREE.Vector3();

/** highest walkable support under (x,z) at or below y+STEP_UP */
export function supportAt(W, x, z, y) {
  let s = W.map.heightAt(x, z);
  const cols = W.map.queryColliders(x, z, 0.6);
  for (const c of cols) {
    if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
    let top;
    if (c.kind === "ramp") {
      let f;
      if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
      else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
      top = c.minY + (c.maxY - c.minY) * K.clamp(f, 0, 1);
    } else {
      top = c.maxY;
    }
    if (top <= y + STEP_UP && top > s) s = top;
  }
  return s;
}

function blockedHoriz(W, x, z, y, h) {
  // capsule side blocking vs boxes whose vertical span overlaps (feet+step, head)
  const r = K.PLAYERK.radius;
  const cols = W.map.queryColliders(x, z, r + 0.4);
  for (const c of cols) {
    if (c.kind === "ramp") continue;
    if (c.maxY <= y + STEP_UP || c.minY >= y + h) continue;
    const nx = K.clamp(x, c.minX, c.maxX), nz = K.clamp(z, c.minZ, c.maxZ);
    const dx = x - nx, dz = z - nz;
    if (dx * dx + dz * dz < r * r) return c;
  }
  return null;
}

export function update(W, dt) {
  const humanPos = W.player ? W.player.pos : null;
  let anyDrop = false;
  for (const a of W.actors) {
    if (!a.alive) continue;
    if (a.netRemote) { interpRemote(W, a, dt); continue; }
    const far = a.isBot && humanPos && a.pos.distanceToSquared(humanPos) > 250 * 250;
    stepActor(W, a, dt, far);
    if (a.gliding) anyDrop = true;
  }
  if (W.phase === "drop" && !anyDrop) W.phase = "match";
  updateCamera(W, dt);

  // nametags: hide the camera-focus actor's own tag (it fills the screen when
  // spectating) and cull tags beyond readable range
  const camPos = W.camera.position;
  for (const a of W.actors) {
    if (!a.nameTag) continue;
    const d2 = a.pos.distanceToSquared(camPos);
    a.nameTag.visible = a.alive && a !== W._camFocus && d2 > 12 && d2 < 70 * 70;
  }
}

function stepActor(W, a, dt, far) {
  const inp = a.input;
  a.yaw = inp.yaw; a.pitch = inp.pitch;

  // healing channel
  if (a.healing) {
    a.healing.tLeft -= dt;
    if (a.healing.tLeft <= 0) { applyHeal(W, a, a.healing.id); a.healing = null; }
  }

  // glide phase — real skydive: fast belly-down freefall with forward
  // momentum + steering, then an auto-deployed parachute for the final
  // stretch (Final Drop / Fortnite structure)
  if (a.gliding) {
    // landing surface = terrain OR any collider top (floating sky-islands,
    // roofs) — heightAt alone made parachuters fall straight through them
    const g = far ? W.map.heightAt(a.pos.x, a.pos.z) : supportAt(W, a.pos.x, a.pos.z, a.pos.y);
    const landY = Math.max(g, W.map.waterY);
    const agl = a.pos.y - landY;

    // SPACE TOGGLES the parachute — open it, cut it away, open it again, as
    // often as you like (Final Drop style). Failsafe: auto-deploy at 60m the
    // first time; once the player has toggled manually only the 22m hard
    // floor forces it (so cutting away below 60m actually works).
    if (inp.jump) {
      if (a.chute) { removeChute(a); a.chuteToggled = true; W.events.emit("chuteCut", a); }
      else if (agl > 14) { deployChute(W, a); a.chuteToggled = true; }
      inp.jump = false;
    }
    // deploy the canopy high (110m) the first time so most of the descent is a
    // gliding UMBRELLA (Final Drop feel), not a long freefall then a short chute.
    if (!a.chute && agl < (a.chuteToggled ? 22 : 110)) deployChute(W, a);

    const chuted = !!a.chute;
    const speed = chuted ? 8.5 : 15;                        // canopy glides, freefall carries
    const fallTarget = chuted ? -5.5 : (inp.sprint ? -34 : -20);
    const dirX = Math.sin(a.yaw) * -1, dirZ = Math.cos(a.yaw) * -1;
    const fwd = K.clamp(inp.mz, -0.3, 1);
    // the umbrella glides forward gently even with no input (glide ratio), so it
    // reads as gliding not dropping. Kept SMALL (0.15x) so an AFK player drifts
    // only a little — the old 0.35x forced drift pushed them ~100m into the sea.
    const glideF = chuted ? Math.max(0.15, Math.max(0, fwd)) : Math.max(0, fwd);
    const txv = dirX * speed * glideF + Math.cos(a.yaw) * speed * 0.5 * inp.mx;
    const tzv = dirZ * speed * glideF + Math.sin(a.yaw) * speed * 0.5 * inp.mx;
    a.vel.x += (txv - a.vel.x) * Math.min(1, dt * 2.2);      // air has inertia
    a.vel.z += (tzv - a.vel.z) * Math.min(1, dt * 2.2);
    a.vel.y += (fallTarget - a.vel.y) * Math.min(1, dt * (chuted ? 3 : 1.4));
    a.pos.addScaledVector(a.vel, dt);

    if (a.pos.y <= landY + 1.0) {
      a.pos.y = landY + 0.05; a.gliding = false; a.vel.set(0, 0, 0); a.onGround = true;
      removeChute(a);
      a.chuteToggled = false;
      W.events.emit("landed", a);
    }
    clampToMap(W, a);
    syncObj(W, a, dt, far);
    return;
  }

  // EMOTES: dance/cheer on the spot (B / N). Starts only grounded + safe;
  // any human input cancels; bots ride the timer (or cancel when shot).
  if (inp.emote) {
    if (a.onGround && !a.swimming && !a.emoting && (a.clips.dance || a.clips.cheer)) {
      a.emoting = { t: 4.2 };
      if (a.hand) a.hand.visible = false; // holster while emoting
      playAnim(a, a.clips[inp.emote] ? inp.emote : "cheer", { once: true, force: true });
      W.events.emit("emote", a, inp.emote);
    }
    inp.emote = null;
  }
  if (a.emoting) {
    a.emoting.t -= dt;
    const humanCancel = !a.isBot && (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 || inp.fire || inp.jump);
    const shotCancel = W.t - a.lastDamageT < 0.3;
    if (a.emoting.t <= 0 || humanCancel || shotCancel) {
      a.emoting = null; a.anim = null;
      if (a.hand) a.hand.visible = true;
      playAnim(a, "idle", { force: true });
    } else {
      a.vel.x *= 0.75; a.vel.z *= 0.75;
      a.vel.y += K.MOVE.gravity * dt;
      a.pos.y += a.vel.y * dt;
      const supE = far ? W.map.heightAt(a.pos.x, a.pos.z) : supportAt(W, a.pos.x, a.pos.z, a.pos.y);
      if (a.pos.y <= supE + 0.02) { a.pos.y = supE; a.vel.y = 0; }
      a.obj.position.copy(a.pos);
      return;
    }
  }

  // LAUNCH PORTALS: walk into a ring → flung back into the atmosphere, canopy
  // auto-opens on the way down (Final Drop-style island escape / rotation)
  if (!far && W.map.portals && !a._portalBoost && W.t - (a._portalT || 0) > 2.5) {
    for (const pt of W.map.portals) {
      const pdx = a.pos.x - pt.x, pdz = a.pos.z - pt.z, pdy = a.pos.y - pt.y;
      if (pdx * pdx + pdz * pdz < 1.7 * 1.7 && pdy > -1 && pdy < 3.4) {
        a._portalT = W.t;
        a._portalBoost = true;
        a.onGround = false;
        removeChute(a);
        a.vel.set(a.vel.x * 0.4, 42, a.vel.z * 0.4);
        a.pos.y += 0.6;
        W.events.emit("portalLaunch", a, pt);
        break;
      }
    }
  }
  // portal ascent: ballistic climb at half gravity (~80m), then hand over to
  // the skydive — canopy failsafe auto-opens at 60m on the way down
  if (a._portalBoost) {
    a.vel.y += K.MOVE.gravity * 0.55 * dt;
    a.pos.addScaledVector(a.vel, dt);
    if (a.vel.y <= 2) {
      a._portalBoost = false;
      a.gliding = true;
      a.chuteToggled = false;
    }
    clampToMap(W, a);
    syncObj(W, a, dt, far);
    return;
  }

  // water/swim state: deep water = terrain far enough below the surface
  const wy = W.map.waterY;
  const terrH = W.map.heightAt(a.pos.x, a.pos.z);
  const deepWater = terrH < wy - K.PLAYERK.swimDepth;
  const wasSwimming = a.swimming;
  a.swimming = deepWater && a.pos.y <= wy + 0.3;
  a.inWater = a.pos.y < wy + 0.25 && terrH < wy;
  if (a.swimming !== wasSwimming) W.events.emit("swimState", a, a.swimming);

  // desired horizontal velocity (local axes → world by yaw)
  // crouch: ground-only, and sprinting always wins (you stand up to run)
  a.crouching = !!inp.crouch && a.onGround && !a.swimming && !a.gliding && !(inp.sprint && inp.mz > 0.5);
  const spd = a.swimming
    ? (inp.sprint && inp.mz > 0.5 ? K.MOVE.swimSprint : K.MOVE.swim)
    : inp.ads ? K.MOVE.ads : (inp.sprint && inp.mz > 0.5 && !a.inWater) ? K.MOVE.sprint : K.MOVE.walk;
  let wspd = (a.inWater && !a.swimming) ? spd * 0.55 : spd;   // wading is slow
  if (a.crouching) wspd *= K.CROUCH.speedMult;
  const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
  const dx = (inp.mx * cos - inp.mz * sin), dz = (-inp.mx * sin - inp.mz * cos);
  const dl = Math.hypot(dx, dz) || 1;
  const tx = (dx / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const tz = (dz / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const k = (a.onGround || a.swimming) ? Math.min(1, dt / K.MOVE.accelT) : K.MOVE.airControl * Math.min(1, dt / K.MOVE.accelT);
  a.vel.x += (tx - a.vel.x) * k;
  a.vel.z += (tz - a.vel.z) * k;

  a.sprinting = inp.sprint && inp.mz > 0.5;

  if (a.swimming) {
    // buoyancy: settle chest-deep at the surface with a gentle bob; jump = stroke hop
    const targetY = wy - 0.55 + Math.sin(W.t * 2.2 + a.pos.x) * 0.06;
    a.vel.y = 0;
    a.pos.y += (targetY - a.pos.y) * Math.min(1, dt * 6);
    if (inp.jump) { a.vel.x *= 1.6; a.vel.z *= 1.6; W.events.emit("swimStroke", a); }
    inp.jump = false;
    a.onGround = false;
    a.pos.x += a.vel.x * dt;
    a.pos.z += a.vel.z * dt;
  } else {
    // jump — and SPACE in mid-air with enough height re-opens the parachute
    // (stepping off a sky island must be an escape, not a death sentence)
    if (inp.jump && a.onGround) { a.vel.y = K.MOVE.jumpV; a.onGround = false; W.events.emit("jump", a); }
    else if (inp.jump && !a.onGround) {
      const aglJ = a.pos.y - Math.max(supportAt(W, a.pos.x, a.pos.z, a.pos.y), W.map.waterY);
      if (aglJ > 12) { a.gliding = true; a.chuteToggled = true; deployChute(W, a); }
    }
    inp.jump = false;

    // gravity
    a.vel.y += K.MOVE.gravity * dt;

    // integrate — X then Z with wall blocking, then Y with support
    const h = K.PLAYERK.height;
    if (!far) {
      let nx = a.pos.x + a.vel.x * dt;
      if (!blockedHoriz(W, nx, a.pos.z, a.pos.y, h)) a.pos.x = nx; else a.vel.x = 0;
      let nz = a.pos.z + a.vel.z * dt;
      if (!blockedHoriz(W, a.pos.x, nz, a.pos.y, h)) a.pos.z = nz; else a.vel.z = 0;
    } else {
      // far bots: cheap move, terrain only
      a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
    }
    a.pos.y += a.vel.y * dt;

    const sup = far ? W.map.heightAt(a.pos.x, a.pos.z) : supportAt(W, a.pos.x, a.pos.z, a.pos.y);
    // in deep water the "support" is the swim surface, not the seabed
    if (deepWater && a.pos.y <= wy + 0.05) {
      a.pos.y = wy - 0.55;   // enter swim next frame
    } else if (a.pos.y <= sup + 0.02) {
      if (a.vel.y < -16) W.events.emit("hardLand", a, -a.vel.y);
      a.pos.y = sup; a.vel.y = 0; a.onGround = true;
    } else if (a.pos.y - sup > 0.1) {
      a.onGround = false;
    }
  }

  // footsteps: stride-distance accumulator → audible steps (walk ~2.4m,
  // sprint ~3.2m stride) — audio + the sound-visualization indicators
  if (!far && a.onGround && !a.swimming) {
    const sp2 = Math.hypot(a.vel.x, a.vel.z);
    if (sp2 > 1.5) {
      a._stepAcc = (a._stepAcc || 0) + sp2 * dt;
      const stride = a.sprinting ? 3.2 : 2.4;
      if (a._stepAcc >= stride) { a._stepAcc = 0; W.events.emit("footstep", a); }
    } else a._stepAcc = 0;
  }

  clampToMap(W, a);
  syncObj(W, a, dt, far);
}

function clampToMap(W, a) {
  const H = W.map.half;
  a.pos.x = K.clamp(a.pos.x, -H, H);
  a.pos.z = K.clamp(a.pos.z, -H, H);
}

// ── parachute (composed: canopy dome + rim lines + pack) ────────────────────
const CHUTE_COLORS = [0xe0685a, 0x57b0ff, 0xf2c14e, 0x7fb069, 0xb05cf0, 0x22d3a0];
function deployChute(W, a) {
  const grp = new THREE.Group();
  const color = CHUTE_COLORS[Math.abs(hashCode(a.id)) % CHUTE_COLORS.length];
  // dome: top half-sphere squashed
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.85 })
  );
  dome.scale.y = 0.6;
  dome.position.y = 3.6;
  grp.add(dome);
  // alternating gores read as a real canopy
  const stripes = new THREE.Mesh(
    new THREE.SphereGeometry(1.72, 12, 6, 0, Math.PI / 4, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 })
  );
  stripes.scale.y = 0.6;
  stripes.position.y = 3.6;
  grp.add(stripes);
  const stripes2 = stripes.clone();
  stripes2.rotation.y = Math.PI;
  grp.add(stripes2);
  // suspension lines: rim → shoulders
  const lineMat = new THREE.LineBasicMaterial({ color: 0x444444 });
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * 1.55, 3.65, Math.sin(ang) * 1.55));
    pts.push(new THREE.Vector3(Math.cos(ang) * 0.25, 1.55, Math.sin(ang) * 0.18));
  }
  grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  a.obj.add(grp);
  a.chute = grp;
  W.events.emit("chuteDeployed", a);
}
function removeChute(a) {
  if (a.chute) { if (a.chute.parent) a.chute.parent.remove(a.chute); a.chute = null; }
}
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function syncObj(W, a, dt, far) {
  a.obj.position.copy(a.pos);
  // BODY FACING: outside combat the body turns toward where it's RUNNING
  // (pure camera-facing made strafing look like "running sideways"); while
  // aiming/shooting it squares up to the camera aim.
  let wantYaw = a.yaw + Math.PI;
  const spd2 = Math.hypot(a.vel.x, a.vel.z);
  const combat = a.input.ads || (W.t - a.lastShotT < 1.5);
  if (!a.gliding && !a.swimming && !combat && spd2 > 1.2) {
    wantYaw = Math.atan2(-a.vel.x, -a.vel.z) + Math.PI;
  }
  if (a._bodyYaw == null) a._bodyYaw = wantYaw;
  let dy = wantYaw - a._bodyYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  a._bodyYaw += dy * Math.min(1, dt * 10);
  a.obj.rotation.y = a._bodyYaw;
  // body pose: freefall = belly-down skydive with banking; canopy = upright
  // with a gentle pendulum sway; everything else level
  let wantTiltX = 0, wantTiltZ = 0;
  if (a.gliding && !a.chute) {
    // NEGATIVE X pitches the model face-down (positive tipped it onto its
    // back — playtest report: "falling backwards")
    wantTiltX = a.input.sprint ? -1.15 : -1.35;
    wantTiltZ = a.input.mx * 0.45;                           // bank into turns
  } else if (a.gliding && a.chute) {
    wantTiltX = 0.12 + Math.sin(W.t * 1.7) * 0.06;           // sway under canopy
    wantTiltZ = -a.input.mx * 0.18 + Math.cos(W.t * 1.3) * 0.04;
  }
  a._tiltX = (a._tiltX || 0) + (wantTiltX - (a._tiltX || 0)) * Math.min(1, dt * 4);
  a._tiltZ = (a._tiltZ || 0) + (wantTiltZ - (a._tiltZ || 0)) * Math.min(1, dt * 4);
  a.obj.rotation.x = a._tiltX;
  a.obj.rotation.z = a._tiltZ;
  if (a.chute) a.chute.rotation.x = -a._tiltX;               // canopy stays upright
  // animation LOD: far actors freeze mixers
  if (a.rig) {
    a.rig.mixer.timeScale = far ? 0 : 1;
    if (!far) {
      const gs = Math.hypot(a.vel.x, a.vel.z);
      // freefall: NEARLY-FROZEN mid-stride = limbs spread like a skydive
      // (0.35 looked like the character was jogging through the sky)
      if (a.gliding && !a.chute) playAnim(a, "run", { timeScale: 0.05 });
      else if (a.gliding) playAnim(a, "idle");
      else if (a.swimming) playAnim(a, "swim", { timeScale: gs > 4.5 ? 1.25 : 1 });
      else if (!a.onGround) playAnim(a, "jump", { once: true });
      else if (a.crouching && a.clips.crouch) {
        // one clip covers both crouch stances: crouch-walk plays at a pace set
        // by ground speed, and standing still freezes it on a crouched pose
        // rather than marching in place
        playAnim(a, "crouch", { timeScale: gs > 0.7 ? K.clamp(gs / 2.7, 0.55, 1.4) : 0 });
      }
      else if (gs > 0.7) {
        // BACKPEDALING plays the stride in REVERSE (no moonwalking).
        const back = (a.vel.x * -Math.sin(a._bodyYaw - Math.PI) + a.vel.z * -Math.cos(a._bodyYaw - Math.PI)) < -0.5;
        const dirK = back ? -0.9 : 1;
        if (gs > 7 && !back) {
          // SPRINT (Shift, ~9.6 m/s): a proper UPRIGHT Meshy run — action 510
          // "Standard_Forward_Charge", measured ~3-12° athletic lean across the 5
          // rigs. Replaced the old "RunFast" (action 16, ~53° "running bent over")
          // and its per-frame spine counter-rotation hack, both now removed.
          playAnim(a, "run", { timeScale: K.clamp(gs / 6.5, 0.9, 1.5) });
        } else {
          // WALK/JOG (~6 m/s): the upright walk clip, sped up by ground speed.
          playAnim(a, "walk", { timeScale: dirK * K.clamp(gs / 3.0, 0.85, 2.0) });
        }
      }
      else { playAnim(a, "idle"); }

      // ── ARM-POSE LAYER (pose.js) — after the mixer, before render ────────
      // clips own legs/torso; arms are steered per state so they always read
      // right (Meshy retargets folded arms over the face — owner screenshots)
      let mode = null;
      const armed = a.weapon && !a.weapon.id.startsWith("consumable");
      if (!a.alive || a.emoting) mode = null;
      else if (a.gliding && !a.chute) mode = "skydive";
      else if (a.gliding) mode = "hang";
      else if (a.swimming) mode = null;
      else if (armed && a.weapon.state === "reloading") mode = "reload";
      else if (armed && !combat) mode = "lowReady";   // out of combat: relaxed carry (combat = ADS or fired <1.5s ago)
      else if (armed) mode = "gunReady";
      else mode = "relax";
      // straighten a slouched rig BEFORE the arm layer (arms hang off the
      // spine, so upright must happen first) — skip mid-air/emote where the
      // clip owns the whole body
      if (a.torsoFix && !a.gliding && !a.emoting) uprightTorso(a.obj, a.armBones, 1);
      const wantW = mode ? 1 : 0;
      a._armW = (a._armW == null ? wantW : a._armW + (wantW - a._armW) * Math.min(1, dt * 8));
      if (mode) a._armMode = mode;
      // input.pitch > 0 = looking UP (verified: mouse-up → +pitch; aimDir/camera use sin(pitch));
      // tiltDir(+) raises the muzzle, so pass pitch un-negated or the gun tilts the wrong way
      if (a._armW > 0.02 && a._armMode) applyArmPose(a.obj, a.armBones, a._armMode, a._armW, a.pitch);
      // (per-frame barrel aiming removed — it was fragile and unverifiable;
      //  weapon orientation now uses the per-skin calibration set at load)
    }
  }
}

function interpRemote(W, a, dt) {
  // network remote actors lerp toward their last snapshot (net.js sets a.netTarget)
  if (a.netTarget) {
    a.pos.lerp(a.netTarget.pos, Math.min(1, dt * 10));
    a.yaw += (a.netTarget.yaw - a.yaw) * Math.min(1, dt * 10);
    syncObj(W, a, dt, false);
  }
}

// ── camera ───────────────────────────────────────────────────────────────────
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(), camDir = new THREE.Vector3();
function updateCamera(W, dt) {
  const cam = W.camera;
  let focus = W.player;
  if (!focus) return;
  if (!focus.alive && focus.spectating) {
    const t = W.actorById.get(focus.spectating);
    if (t && t.alive) focus = t;
    else {
      // spectated target died — follow their killer, else any survivor
      const next = (t && t.lastAttacker && W.actorById.get(t.lastAttacker)) || W.actors.find((x) => x.alive);
      if (next) { W.player.spectating = next.id; focus = next; }
    }
  }
  W._camFocus = focus;
  const ads = focus.input.ads && focus.weapon && K.WEAPONS[focus.weapon.id] && !K.WEAPONS[focus.weapon.id].harvest;
  const scope = ads && K.WEAPONS[focus.weapon.id] && K.WEAPONS[focus.weapon.id].scope;
  // FIRST-PERSON down the scope: your own body must not block the shot
  // (owner: "when sniping im in the way of the cursor and can see myself")
  const firstPerson = scope;
  // AR/non-scope ADS pulls in tight over the RIGHT shoulder so the body sits
  // left of the reticle instead of covering it
  const dist = focus.gliding ? (focus.chute ? 10 : 9) : firstPerson ? 0.02 : ads ? 1.7 : 4.2;
  const sh = firstPerson ? 0 : ads ? 0.95 : 0.7;
  // crouch dips the camera, but SMOOTHLY — snapping the eye 0.65m is nauseating
  const wantEye = focus.swimming ? 0.7 : K.actorEyeY(focus);
  focus._eyeY = focus._eyeY == null ? wantEye : focus._eyeY + (wantEye - focus._eyeY) * Math.min(1, dt * 12);
  const eye = focus.pos.y + focus._eyeY;
  camTarget.set(focus.pos.x, eye, focus.pos.z);
  const sy = Math.sin(focus.yaw), cy = Math.cos(focus.yaw);
  // during freefall the camera tracks the dive (looks down at the island)
  const pitchBias = focus.gliding ? (focus.chute ? -0.18 : -0.62) : 0;
  const effPitch = K.clamp(focus.pitch + pitchBias, -1.35, 1.35);
  const sp = Math.sin(effPitch), cp = Math.cos(effPitch);
  camDir.set(sy * cp, -sp, cy * cp).multiplyScalar(-1); // forward
  // hide the player's own model in first-person so it never blocks the view
  if (focus.rig && focus.rig.scene) focus.rig.scene.visible = !firstPerson;
  // camera sits behind + slightly right (or AT the eye for first-person)
  camPos.copy(camTarget)
    .addScaledVector(camDir, -dist)
    .add(tmpV.set(cy, 0, -sy).multiplyScalar(sh));
  camPos.y += firstPerson ? 0.05 : 0.25;
  // keep camera out of terrain/structures (skip in first-person — at the eye)
  if (!firstPerson) {
    const minY = W.map.heightAt(camPos.x, camPos.z) + 0.35;
    if (camPos.y < minY) camPos.y = minY;
  }
  cam.position.lerp(camPos, Math.min(1, firstPerson ? 1 : dt * 18));
  if (W.camShake > 0.01) {
    cam.position.x += (Math.random() - 0.5) * W.camShake;
    cam.position.y += (Math.random() - 0.5) * W.camShake * 0.6;
  }
  cam.lookAt(camTarget.x + camDir.x * 8, camTarget.y + camDir.y * 8, camTarget.z + camDir.z * 8);
  // vertical FOV ≈ industry BR (Fortnite ~55-60v): wider view + stronger
  // sprint kick = the speed reads on screen (raw m/s already beats Apex).
  // ADS zoom is PER WEAPON (sim adsFov): sniper 20 + scope overlay, AR 42,
  // launcher 45, SMG 47, pistol 48, shotgun 49.
  const adsDef = ads && K.WEAPONS[focus.weapon.id];
  const wantFov = scope ? (adsDef.adsFov || 22) : ads ? (adsDef.adsFov || 42) : focus.sprinting ? 70 : 57;
  cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 10);
  cam.updateProjectionMatrix();
  W.events.emit("scopeState", !!scope);
}

// ── damage / death ───────────────────────────────────────────────────────────
function hurtActor(W, victim, dmg, attackerId, weaponId, isHead) {
  if (!victim.alive || W.phase === "over") return;
  const res = K.applyDamage(victim.shield, victim.hp, dmg);
  victim.shield = res.shield; victim.hp = res.hp;
  victim.lastDamageT = W.t;
  if (attackerId) { victim.lastAttacker = attackerId; victim.lastHurtByActorT = W.t; }
  W.match.recordDamage(attackerId, res.dealt);
  // per-PAIR damage + last-hit detail. W.match.damage is per-attacker totals
  // only, so "you had them down to 12 HP" was not answerable; the death recap
  // needs the exchange between these two actors specifically.
  if (attackerId) {
    const att = W.actorById.get(attackerId);
    victim.dmgFrom = victim.dmgFrom || {};
    victim.dmgFrom[attackerId] = (victim.dmgFrom[attackerId] || 0) + res.dealt;
    victim.lastHit = {
      attackerId, weaponId, isHead,
      dist: att ? Math.round(att.pos.distanceTo(victim.pos)) : null,
      attHp: att ? Math.max(0, Math.round(att.hp)) : null,
      attShield: att ? Math.max(0, Math.round(att.shield)) : null,
    };
  }
  W.events.emit("actorHurt", victim, { dmg: res.dealt, attackerId, weaponId, isHead, broke: res.broke, toShield: res.toShield });
  // Practice-range dummies absorb and reset rather than die — the hit feedback
  // (damage numbers, hitmarker) has already fired above, and a range you can
  // permanently delete in six seconds is not a range.
  if (victim.isDummy) {
    victim.dummyDamage = (victim.dummyDamage || 0) + res.dealt;
    if (isHead) victim.dummyHeadshots = (victim.dummyHeadshots || 0) + 1;
    if (res.dead) {
      victim.dummyPops = (victim.dummyPops || 0) + 1;
      victim.hp = K.PLAYERK.hp; victim.shield = 0;
      W.events.emit("dummyPopped", victim);
    }
    return;
  }
  if (res.dead) killActor(W, victim, attackerId, weaponId);
}

export function killActor(W, victim, killerId, weaponId) {
  if (!victim.alive) return;
  victim.alive = false;
  // if killed mid-emote, un-holster: the emote hid the weapon (player.js ~524) and
  // only the emote-timeout restores it, so a one-shot kill left the corpse empty-handed
  if (victim.emoting) { victim.emoting = null; if (victim.hand) victim.hand.visible = true; }
  const killer = killerId ? W.actorById.get(killerId) : null;
  if (killer) killer.kills++;
  W.match.eliminate(victim.id, killerId, weaponId, W.t);
  W.events.emit("actorDied", victim, killerId, weaponId);
  // death anim then sink away
  if (victim.rig && victim.clips.death) { playAnim(victim, "death", { once: true }); }
  setTimeout(() => { if (victim.obj.parent) victim.obj.parent.remove(victim.obj); }, 4500);
  // player death → spectate killer
  if (victim === W.player) {
    victim.spectating = killerId || null;
    W.events.emit("playerDied", killerId, weaponId);
  }
}

function applyHeal(W, a, id) {
  const c = K.CONSUMABLES[id];
  if (!c) return;
  if (c.heals === "hp") a.hp = Math.min(c.cap, a.hp + c.amount);
  else a.shield = Math.min(c.cap, a.shield + c.amount);
  W.events.emit("healed", a, id);
}

/** start a heal channel if the actor has that consumable (used by human + bots) */
export function useConsumable(W, a, id) {
  if (a.healing) return false;
  const inv = a.inventory;
  const slot = inv.slots.find((s) => s && s.kind === "consumable" && s.id === id && s.count > 0);
  if (!slot) return false;
  const c = K.CONSUMABLES[id];
  if (!c) return false;
  if (c.heals === "hp" && a.hp >= c.cap) return false;
  if (c.heals === "shield" && a.shield >= c.cap) return false;
  slot.count--;
  if (slot.count <= 0) inv.slots[inv.slots.indexOf(slot)] = null;
  a.healing = { id, tLeft: c.useS };
  W.events.emit("healStart", a, id, c.useS);
  return true;
}
