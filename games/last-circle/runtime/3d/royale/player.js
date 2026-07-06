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
    mx: 0, mz: 0, jump: false, sprint: false,
    yaw: 0, pitch: 0, fire: false, ads: false, reload: false,
    interact: false, interactDown: false, slot: -1,
  };
}

// ── models ───────────────────────────────────────────────────────────────────
const SKINS = ["char-hero.glb", "char-pirate.glb", "char-marauder.glb", "char-crew.glb", "char-wizard.glb"];
export async function loadActorModels(W) {
  const base = W.assetBase + "assets/chars/";
  // preload the skins once (kernel caches)
  await Promise.all(SKINS.map((s) => W.kernel.loadCharacter(base + s).then((r) => { r.scene.visible = false; })));
  const vr = K.mulberry32(W.seed ^ 0xfaceb);
  for (let i = 0; i < W.actors.length; i++) {
    const a = W.actors[i];
    const rig = await W.kernel.loadCharacter(base + SKINS[i % SKINS.length]);
    a.rig = rig;
    // NEUTRAL characters: strip the RPG weapon meshes baked into the rigs.
    const strip = [];
    rig.scene.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && /_?(bow|dagger|sword|staff|axe|shield|quiver)$/i.test(o.name)) strip.push(o); });
    strip.forEach((o) => { o.visible = false; });
    // PROCEDURAL VARIETY: 5 base rigs × per-actor hue/lightness shifts on cloned
    // materials — 50 visually distinct opponents from a small asset set.
    const hueShift = (vr() - 0.5) * 0.24, lightShift = (vr() - 0.5) * 0.16;
    const seen = new Map();
    rig.scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.material || !o.visible) return;
      if (!seen.has(o.material)) {
        const m = o.material.clone();
        if (m.color) m.color.offsetHSL(hueShift, 0, lightShift);
        seen.set(o.material, m);
      }
      o.material = seen.get(o.material);
    });
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
    // weapon holder — parented to the RIGHT HAND BONE so the gun rides the
    // skeleton through every animation (the fixed chest offset floated at head
    // height). Scale-compensate so guns keep world size under the rig scale.
    let fist = null;
    rig.scene.traverse((o) => { if (o.isBone && o.name === "FistR" && !fist) fist = o; });
    a.hand = new THREE.Group();
    if (fist) {
      fist.add(a.hand);
      a.hand.scale.setScalar(1 / Math.max(0.01, s));
      a.hand.position.set(0, 0.02 / s, 0);
      // barrel forward when the arm points ahead (tuned visually)
      a.hand.rotation.set(-Math.PI / 2, 0, 0);
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
  const idle = find([/^idle$/i, /idle/i]) || names[0];
  const run = find([/^run$/i, /run/i, /walk/i]) || names[0];
  return {
    idle,
    run,
    // armed variants: arms raised in a holding pose (rigs ship these)
    idleArmed: find([/idle_weapon/i, /idle_attacking/i, /attacking_idle/i]) || idle,
    runArmed: find([/run_holding/i, /run_weapon/i]) || run,
    jump: find([/jump/i, /fall/i]),
    death: find([/death|die|defeat/i]),
    shoot: find([/shoot|attack|punch|slash|hit/i]),
  };
}

function playAnim(a, key, opts) {
  if (!a.rig || !a.clips) return;
  // armed actors use the weapon-holding variants of idle/run
  const armed = a.weapon && !a.weapon.id.startsWith("consumable");
  let realKey = key;
  if (armed && key === "idle" && a.clips.idleArmed) realKey = "idleArmed";
  if (armed && key === "run" && a.clips.runArmed) realKey = "runArmed";
  const clip = a.clips[realKey] || a.clips.idle;
  if (!clip) return;
  const ts = (opts && opts.timeScale) || 1;
  if (a.anim === realKey && a._animTS === ts && !(opts && opts.force)) return;
  const tsChanged = a.anim === realKey && a._animTS !== ts;
  a.anim = realKey;
  a._animTS = ts;
  a.rig.play(clip, Object.assign({}, opts, tsChanged ? { force: true, timeScale: ts } : null));
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
    if (e.code === "Space") { inp.jump = true; e.preventDefault(); }
    if (e.code === "Digit1") inp.slot = 0;
    if (e.code === "Digit2") inp.slot = 1;
    if (e.code === "Digit3") inp.slot = 2;
    if (e.code === "Digit4") inp.slot = 3;
    if (e.code === "Digit5") inp.slot = 4;
    if (e.code === "KeyM") W.events.emit("toggleBigMap");
    if (e.code === "Escape") W.events.emit("escPressed");
  });
  window.addEventListener("keyup", (ev) => {
    const code = canon(ev.code);
    keys[code] = false;
    if (code === "KeyE" && W.player) W.player.input.interactDown = false;
  });

  // Mouse model (works with OR without pointer lock — lock can be denied in
  // embedded/preview contexts and the game must stay fully playable):
  //   LMB          = shoot, ALWAYS (also tries to engage pointer lock)
  //   locked       = mouse-look, RMB = ADS
  //   unlocked     = HOLD RMB and drag to rotate the camera (RMB also ADSes)
  let rmbDrag = false;
  dom.addEventListener("mousedown", (e) => {
    if (!W.player || W.phase === "menu" || W.paused) return;
    if (e.button === 0) {
      W.player.input.fire = true;   // never swallow the shot
      if (document.pointerLockElement !== dom) {
        try { const p = dom.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {}
      }
    }
    if (e.button === 2) { W.player.input.ads = true; rmbDrag = document.pointerLockElement !== dom; }
  });
  window.addEventListener("mouseup", (e) => {
    if (!W.player) return;
    if (e.button === 0) W.player.input.fire = false;
    if (e.button === 2) { W.player.input.ads = false; rmbDrag = false; }
  });
  // safety: a mouseup outside the window would otherwise leave fire/ADS stuck
  // (stuck ADS = permanent 3.4 m/s — feels like the game is broken-slow)
  const clearButtons = () => { if (W.player) { W.player.input.fire = false; W.player.input.ads = false; } rmbDrag = false; };
  window.addEventListener("blur", clearButtons);
  document.addEventListener("mouseleave", clearButtons);
  dom.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("mousemove", (e) => {
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

  // continuous axes each frame
  W.kernel.onUpdate(() => {
    if (!W.player || !W.player.alive || W.phase === "menu" || W.paused) return;
    const inp = W.player.input;
    inp.mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    inp.mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    inp.sprint = !!keys.ShiftLeft || !!keys.ShiftRight;
  });
  W.pointerLocked = () => document.pointerLockElement === dom;
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
    const g = W.map.heightAt(a.pos.x, a.pos.z);
    const landY = Math.max(g, W.map.waterY);
    const agl = a.pos.y - landY;

    // deploy the canopy on the way down
    if (!a.chute && agl < 60) deployChute(W, a);

    const chuted = !!a.chute;
    const speed = chuted ? 7.5 : 15;                        // canopy drifts, freefall carries
    const fallTarget = chuted ? -5.5 : (inp.sprint ? -34 : -20);
    const dirX = Math.sin(a.yaw) * -1, dirZ = Math.cos(a.yaw) * -1;
    const fwd = K.clamp(inp.mz, -0.3, 1);
    const txv = dirX * speed * Math.max(0.35, fwd) + Math.cos(a.yaw) * speed * 0.5 * inp.mx;
    const tzv = dirZ * speed * Math.max(0.35, fwd) + Math.sin(a.yaw) * speed * 0.5 * inp.mx;
    a.vel.x += (txv - a.vel.x) * Math.min(1, dt * 2.2);      // air has inertia
    a.vel.z += (tzv - a.vel.z) * Math.min(1, dt * 2.2);
    a.vel.y += (fallTarget - a.vel.y) * Math.min(1, dt * (chuted ? 3 : 1.4));
    a.pos.addScaledVector(a.vel, dt);

    if (a.pos.y <= landY + 1.0) {
      a.pos.y = landY + 0.05; a.gliding = false; a.vel.set(0, 0, 0); a.onGround = true;
      removeChute(a);
      W.events.emit("landed", a);
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
  const spd = a.swimming
    ? (inp.sprint && inp.mz > 0.5 ? K.MOVE.swimSprint : K.MOVE.swim)
    : inp.ads ? K.MOVE.ads : (inp.sprint && inp.mz > 0.5 && !a.inWater) ? K.MOVE.sprint : K.MOVE.walk;
  const wspd = (a.inWater && !a.swimming) ? spd * 0.55 : spd;   // wading is slow
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
    // jump
    if (inp.jump && a.onGround) { a.vel.y = K.MOVE.jumpV; a.onGround = false; W.events.emit("jump", a); }
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
  a.obj.rotation.y = a.yaw + Math.PI;
  // body pose: freefall = belly-down skydive with banking; canopy = upright
  // with a gentle pendulum sway; everything else level
  let wantTiltX = 0, wantTiltZ = 0;
  if (a.gliding && !a.chute) {
    wantTiltX = a.input.sprint ? 1.15 : 1.35;               // ~65-77° face-down
    wantTiltZ = -a.input.mx * 0.45;                          // bank into turns
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
      const moving = Math.hypot(a.vel.x, a.vel.z) > 0.7;
      if (a.gliding && !a.chute) playAnim(a, "run", { timeScale: 0.35 }); // limbs spread mid-stride ≈ skydive
      else if (a.gliding) playAnim(a, "idle");
      else if (a.swimming) playAnim(a, "run", { timeScale: 0.6 });
      else if (!a.onGround) playAnim(a, "jump");
      else if (moving) playAnim(a, "run");
      else playAnim(a, "idle");
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
  const dist = focus.gliding ? (focus.chute ? 10 : 9) : ads ? 2.0 : 4.2;
  const sh = ads ? 0.45 : 0.7;
  const eye = focus.pos.y + (focus.swimming ? 0.7 : K.PLAYERK.eyeY);
  camTarget.set(focus.pos.x, eye, focus.pos.z);
  const sy = Math.sin(focus.yaw), cy = Math.cos(focus.yaw);
  // during freefall the camera tracks the dive (looks down at the island)
  const pitchBias = focus.gliding ? (focus.chute ? -0.18 : -0.62) : 0;
  const effPitch = K.clamp(focus.pitch + pitchBias, -1.35, 1.35);
  const sp = Math.sin(effPitch), cp = Math.cos(effPitch);
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
  const wantFov = scope ? 22 : ads ? 42 : focus.sprinting ? 61 : 52;
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
