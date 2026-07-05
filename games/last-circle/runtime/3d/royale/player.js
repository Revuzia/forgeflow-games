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
    onGround: false, crouching: false, sprinting: false, gliding: false, inWater: false,
    input: mkInput(),
    inventory: {
      slots: [{ kind: "weapon", id: "pickaxe", rarity: 0, mag: 0 }, null, null, null, null],
      active: 0,
      ammo: { light: 0, medium: 0, shells: 0, heavy: 0, rockets: 0 },
      mats: Object.assign({}, (K.MODE[W.mode] || K.MODE.standard).startMats),
      grenades: 0,
    },
    weapon: { id: "pickaxe", rarity: 0, magAmmo: 0, state: "ready", cd: 0, reloadT: 0 },
    buildMat: "wood", buildPiece: null, lastBuildT: 0,
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
    interact: false, slot: -1, buildPiece: null, place: false, rotate: false,
    useHeal: null, drop: false,
  };
}

// ── models ───────────────────────────────────────────────────────────────────
const SKINS = ["char-hero.glb", "char-pirate.glb", "char-marauder.glb", "char-crew.glb"];
export async function loadActorModels(W) {
  const base = W.assetBase + "assets/chars/";
  // preload the 4 skins once (kernel caches)
  await Promise.all(SKINS.map((s) => W.kernel.loadCharacter(base + s).then((r) => { r.scene.visible = false; })));
  for (let i = 0; i < W.actors.length; i++) {
    const a = W.actors[i];
    const rig = await W.kernel.loadCharacter(base + SKINS[i % SKINS.length]);
    a.rig = rig;
    // normalize height to ~1.8m
    const bbox = new THREE.Box3().setFromObject(rig.scene);
    const h = bbox.max.y - bbox.min.y;
    const s = K.PLAYERK.height / Math.max(0.1, h);
    rig.scene.scale.setScalar(s);
    rig.scene.position.y = -bbox.min.y * s;
    a.obj.add(rig.scene);
    a.clips = classifyClips(rig);
    playAnim(a, "idle");
    // name tag sprite (not for self)
    if (a.id !== (W.player && W.player.id)) a.nameTag = mkNameTag(W, a);
    // weapon holder — right-hand-ish offset; weapon meshes attached by weapons.js
    a.hand = new THREE.Group();
    a.hand.position.set(0.32, 1.15, 0.28);
    a.obj.add(a.hand);
  }
}

function classifyClips(rig) {
  const names = Object.keys(rig.actions || {});
  const find = (pats) => {
    for (const p of pats) { const n = names.find((x) => p.test(x)); if (n) return n; }
    return null;
  };
  return {
    idle: find([/idle/i]) || names[0],
    run: find([/^run/i, /run/i, /walk/i]) || names[0],
    jump: find([/jump/i, /fall/i]),
    crouch: find([/crouch|sneak/i]),
    death: find([/death|die|defeat/i]),
    shoot: find([/shoot|attack|punch|slash|hit/i]),
  };
}

function playAnim(a, key, opts) {
  if (!a.rig || !a.clips) return;
  const clip = a.clips[key] || a.clips.idle;
  if (!clip) return;
  if (a.anim === key && !(opts && opts.force)) return;
  a.anim = key;
  a.rig.play(clip, opts);
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
    inv.slots[4] = { kind: "consumable", id: "big_shield", count: 99 };
    inv.ammo = { light: 999, medium: 999, shells: 999, heavy: 999, rockets: 999 };
    inv.grenades = 99;
  }
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
    if (e.code === "KeyE") inp.interact = true;
    if (e.code === "Space") { inp.jump = true; e.preventDefault(); }
    if (e.code === "Digit1") inp.slot = 0;
    if (e.code === "Digit2") inp.slot = 1;
    if (e.code === "Digit3") inp.slot = 2;
    if (e.code === "Digit4") inp.slot = 3;
    if (e.code === "Digit5") inp.slot = 4;
    if (e.code === "KeyZ") inp.buildPiece = "wall";
    if (e.code === "KeyX") inp.buildPiece = "floor";
    if (e.code === "KeyC") inp.buildPiece = "ramp";
    if (e.code === "KeyV") inp.buildPiece = "stair";
    if (e.code === "KeyQ") inp.buildPiece = inp.buildPiece ? null : "wall"; // toggle build mode
    if (e.code === "KeyG") W.events.emit("editBuild");
    if (e.code === "KeyB") W.events.emit("cycleBuildMat");
    if (e.code === "KeyT") inp.useHeal = "auto";
    if (e.code === "KeyM") W.events.emit("toggleBigMap");
    if (e.code === "Escape") W.events.emit("escPressed");
  });
  window.addEventListener("keyup", (ev) => { keys[canon(ev.code)] = false; });

  dom.addEventListener("mousedown", (e) => {
    if (!W.player || W.phase === "menu" || W.paused) return;
    if (document.pointerLockElement !== dom) { dom.requestPointerLock(); return; }
    if (e.button === 0) W.player.input.fire = true;
    if (e.button === 2) W.player.input.ads = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (!W.player) return;
    if (e.button === 0) W.player.input.fire = false;
    if (e.button === 2) W.player.input.ads = false;
  });
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("mousemove", (e) => {
    if (!W.player || document.pointerLockElement !== dom || W.paused) return;
    const sens = (W.player.input.ads ? W.settings.adsSensitivity : W.settings.sensitivity) * 0.0022;
    W.player.input.yaw -= e.movementX * sens;
    W.player.input.pitch = K.clamp(W.player.input.pitch - e.movementY * sens, -1.35, 1.35);
  });
  window.addEventListener("wheel", (e) => {
    if (!W.player || W.phase === "menu") return;
    const inp = W.player.input;
    if (inp.buildPiece) {
      const order = ["wall", "floor", "ramp", "stair"];
      const i = order.indexOf(inp.buildPiece);
      inp.buildPiece = order[(i + (e.deltaY > 0 ? 1 : 3)) % 4];
    }
  });

  // continuous axes each frame
  W.kernel.onUpdate(() => {
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inp = W.player.input;
    inp.mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    inp.mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    inp.sprint = !!keys.ShiftLeft || !!keys.ShiftRight;
    inp.crouch = !!keys.ControlLeft || !!keys.ControlRight;
  });
  W.pointerLocked = () => document.pointerLockElement === dom;
}

// ── movement + physics ──────────────────────────────────────────────────────
const STEP_UP = 0.55;
const tmpV = new THREE.Vector3();

/** highest walkable support under (x,z) at or below y+STEP_UP */
export function supportAt(W, x, z, y) {
  let s = W.map.heightAt(x, z);
  const cols = W.map.queryColliders(x, z, 0.6).concat(W.queryBuildColliders ? W.queryBuildColliders(x, z, 0.6) : []);
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
  const cols = W.map.queryColliders(x, z, r + 0.4).concat(W.queryBuildColliders ? W.queryBuildColliders(x, z, r + 0.4) : []);
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

  // glide phase
  if (a.gliding) {
    const speed = 13;
    const dirX = Math.sin(a.yaw) * -1, dirZ = Math.cos(a.yaw) * -1;
    const fwd = K.clamp(inp.mz, -0.3, 1);
    a.vel.x = dirX * speed * fwd + Math.cos(a.yaw) * speed * 0.5 * inp.mx;
    a.vel.z = dirZ * speed * fwd + Math.sin(a.yaw) * speed * 0.5 * inp.mx;
    a.vel.y = Math.max(a.vel.y - 14 * dt, inp.crouch ? -26 : -9);   // dive with crouch
    a.pos.addScaledVector(a.vel, dt);
    const g = W.map.heightAt(a.pos.x, a.pos.z);
    const landY = Math.max(g, W.map.waterY);
    if (a.pos.y <= landY + 1.2) {
      a.pos.y = landY + 0.05; a.gliding = false; a.vel.set(0, 0, 0); a.onGround = true;
      W.events.emit("landed", a);
    }
    clampToMap(W, a);
    syncObj(W, a, dt, far);
    return;
  }

  // desired horizontal velocity (local axes → world by yaw)
  const spd = a.crouching ? K.MOVE.crouch : inp.ads ? K.MOVE.ads : (inp.sprint && inp.mz > 0.5 && !a.inWater) ? K.MOVE.sprint : K.MOVE.walk;
  const wspd = a.inWater ? spd * 0.5 : spd;
  const sin = Math.sin(a.yaw), cos = Math.cos(a.yaw);
  const dx = (inp.mx * cos - inp.mz * sin), dz = (-inp.mx * sin - inp.mz * cos);
  const dl = Math.hypot(dx, dz) || 1;
  const tx = (dx / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const tz = (dz / dl) * wspd * (Math.abs(inp.mx) + Math.abs(inp.mz) > 0 ? 1 : 0);
  const k = a.onGround ? Math.min(1, dt / K.MOVE.accelT) : K.MOVE.airControl * Math.min(1, dt / K.MOVE.accelT);
  a.vel.x += (tx - a.vel.x) * k;
  a.vel.z += (tz - a.vel.z) * k;

  a.crouching = inp.crouch && a.onGround;
  a.sprinting = inp.sprint && inp.mz > 0.5 && !a.crouching;

  // jump
  if (inp.jump && a.onGround) { a.vel.y = K.MOVE.jumpV; a.onGround = false; W.events.emit("jump", a); }
  inp.jump = false;

  // gravity
  a.vel.y += K.MOVE.gravity * dt;

  // integrate — X then Z with wall blocking, then Y with support
  const h = a.crouching ? K.PLAYERK.crouchHeight : K.PLAYERK.height;
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
  if (a.pos.y <= sup + 0.02) {
    if (a.vel.y < -16) W.events.emit("hardLand", a, -a.vel.y);
    a.pos.y = sup; a.vel.y = 0; a.onGround = true;
  } else if (a.pos.y - sup > 0.1) {
    a.onGround = false;
  }

  // water state
  const wy = W.map.waterY;
  a.inWater = a.pos.y < wy + 0.25 && W.map.heightAt(a.pos.x, a.pos.z) < wy;
  if (a.inWater && W.map.heightAt(a.pos.x, a.pos.z) < wy - 1.6) {
    // too deep — push back toward shore (no swimming)
    const g = 8;
    const gx = W.map.heightAt(a.pos.x + g, a.pos.z) - W.map.heightAt(a.pos.x - g, a.pos.z);
    const gz = W.map.heightAt(a.pos.x, a.pos.z + g) - W.map.heightAt(a.pos.x, a.pos.z - g);
    a.pos.x += gx * 0.08; a.pos.z += gz * 0.08;
  }

  clampToMap(W, a);
  syncObj(W, a, dt, far);
}

function clampToMap(W, a) {
  const H = W.map.half;
  a.pos.x = K.clamp(a.pos.x, -H, H);
  a.pos.z = K.clamp(a.pos.z, -H, H);
}

function syncObj(W, a, dt, far) {
  a.obj.position.copy(a.pos);
  a.obj.rotation.y = a.yaw + Math.PI;
  // animation LOD: far actors freeze mixers
  if (a.rig) {
    a.rig.mixer.timeScale = far ? 0 : 1;
    if (!far) {
      const moving = Math.hypot(a.vel.x, a.vel.z) > 0.7;
      if (a.gliding) playAnim(a, "jump");
      else if (!a.onGround) playAnim(a, "jump");
      else if (moving) playAnim(a, "run");
      else playAnim(a, a.crouching && a.clips.crouch ? "crouch" : "idle");
    }
  }
  // hide own model in first-person-ish ADS? third person always visible.
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
  const dist = focus.gliding ? 7 : ads ? 2.0 : 4.2;
  const sh = ads ? 0.45 : 0.7;
  const eye = focus.pos.y + (focus.crouching ? 1.15 : K.PLAYERK.eyeY);
  camTarget.set(focus.pos.x, eye, focus.pos.z);
  const sy = Math.sin(focus.yaw), cy = Math.cos(focus.yaw);
  const sp = Math.sin(focus.pitch), cp = Math.cos(focus.pitch);
  camDir.set(sy * cp, -sp, cy * cp).multiplyScalar(-1); // forward
  // camera sits behind + slightly right
  camPos.copy(camTarget)
    .addScaledVector(camDir, -dist)
    .add(tmpV.set(cy, 0, -sy).multiplyScalar(sh));
  camPos.y += 0.25;
  // keep camera out of terrain/structures
  const minY = W.map.heightAt(camPos.x, camPos.z) + 0.35;
  if (camPos.y < minY) camPos.y = minY;
  cam.position.lerp(camPos, Math.min(1, dt * 18));
  if (W.camShake > 0.01) {
    cam.position.x += (Math.random() - 0.5) * W.camShake;
    cam.position.y += (Math.random() - 0.5) * W.camShake * 0.6;
  }
  cam.lookAt(camTarget.x + camDir.x * 8, camTarget.y + camDir.y * 8, camTarget.z + camDir.z * 8);
  const wantFov = scope ? 22 : ads ? 42 : focus.sprinting ? 56 : 50;
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
  W.events.emit("actorHurt", victim, { dmg: res.dealt, attackerId, weaponId, isHead, broke: res.broke, toShield: res.toShield });
  if (res.dead) killActor(W, victim, attackerId, weaponId);
}

export function killActor(W, victim, killerId, weaponId) {
  if (!victim.alive) return;
  victim.alive = false;
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
