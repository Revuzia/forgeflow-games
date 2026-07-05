/**
 * royale/bots.js — the 49 opponents. THE quality bar for this game: bots must
 * loot coherently, farm mats, rotate EARLY, use cover, wall-up when shot,
 * box at low HP, ramp-push with an advantage, and fight with human-feeling
 * aim (reaction delay, acquire overshoot, tracking warm-up, whiffs under
 * strafing) — everything Fortnite's own bots infamously don't do.
 *
 * Architecture: per-bot BRAIN = utility-scored state machine over a
 * blackboard, ticked on a stagger (near-player bots think more often). The
 * brain only WRITES the actor's input struct — movement/weapons/building run
 * through the exact same code as the human player.
 *
 * States: DROP → LOOT / FARM / ROTATE / ENGAGE / FLEE / HEAL / CAMP / WANDER
 */
import * as THREE from "three";
// Import siblings WITH this module's own ?v= so we share the initialized
// instances (a bare "./weapons.js" would be a second, uninitialized copy).
const V = new URL(import.meta.url).search;
const { aimDir, eyePos } = await import("./weapons.js" + V);
const { supportAt } = await import("./player.js" + V);

let K = null;
const brains = [];

export function init(W) {
  K = W.SIM;
  brains.length = 0;
  // hearing: every shot is broadcast to nearby brains
  W.events.on("shotFired", (shooter, weaponId, pos) => {
    for (const b of brains) {
      if (!b.actor.alive || b.actor === shooter) continue;
      const d = Math.hypot(b.actor.pos.x - pos.x, b.actor.pos.z - pos.z);
      if (d < 250) b.bb.heard = { x: pos.x, z: pos.z, t: b.W.t, d, shooterId: shooter.id };
    }
  });
}

export function attachBrain(W, actor) {
  // tier/personality assignment from the seeded mix
  const rng = K.mulberry32((W.seed ^ 0xb0b) + W.actors.length * 31);
  const mix = K.BOT_TIER_MIX[W.mode] || K.BOT_TIER_MIX.standard;
  // draw tier ∝ remaining mix
  const assigned = brains.length;
  let tier = 3, acc = 0;
  const r = (assigned + rng() * 0.99) / 49 * mix.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 5; i++) { acc += mix[i]; if (r <= acc) { tier = i + 1; break; } }
  actor.tier = tier;
  actor.personality = K.BOT_PERSONALITIES[Math.floor(rng() * K.BOT_PERSONALITIES.length)];
  const brain = {
    W, actor,
    tierK: K.BOT_TIERS[tier - 1],
    state: "DROP",
    nextThink: 0,
    bb: {          // blackboard
      target: null, targetSeenT: -99, targetPos: null, acquireT: 0,
      heard: null, lootId: null, harvestId: null,
      moveTo: null, strafeDir: 1, strafeT: 0,
      matsGoal: actor.personality === "builder" ? 320 : actor.personality === "camper" ? 90 : 170,
      boxed: false, campSpot: null, dropTarget: null,
      stuckT: 0, lastPos: new THREE.Vector3(), burstLeft: 0, burstPause: 0,
    },
  };
  actor.brain = brain;
  brains.push(brain);
  return brain;
}

export function assignDrops(W) {
  const rng = K.mulberry32(W.seed ^ 0xd407);
  const pois = W.map.pois;
  for (const b of brains) {
    const hot = b.actor.personality === "rusher" || b.actor.personality === "rotator";
    let p;
    if (pois.length && rng() < (hot ? 0.85 : 0.55)) {
      // rushers pick central/first POIs, goblins the far ones
      const idx = b.actor.personality === "loot_goblin"
        ? pois.length - 1 - Math.floor(rng() * Math.min(3, pois.length))
        : Math.floor(rng() * pois.length);
      p = pois[idx];
      b.bb.dropTarget = { x: p.x + (rng() - 0.5) * p.r, z: p.z + (rng() - 0.5) * p.r };
    } else {
      const gp = W.map.randomGroundPos(rng);
      b.bb.dropTarget = { x: gp.x, z: gp.z };
    }
    // reposition the glide start near the target (bus-jump timing): from
    // 240m up at ~9m/s fall and 13m/s glide, ~150m of drift is comfortable
    const a = b.actor;
    const ang = rng() * Math.PI * 2, off = 60 + rng() * 120;
    a.pos.x = W.SIM.clamp(b.bb.dropTarget.x + Math.cos(ang) * off, -W.map.half, W.map.half);
    a.pos.z = W.SIM.clamp(b.bb.dropTarget.z + Math.sin(ang) * off, -W.map.half, W.map.half);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
export function update(W, dt) {
  if (!brains.length) return;
  const now = W.t;
  const pp = W.player ? W.player.pos : null;
  for (const b of brains) {
    const a = b.actor;
    if (!a.alive || a.netRemote) continue;
    // staggered thinking: near bots think fast, far bots slow
    if (now >= b.nextThink) {
      const near = pp && a.pos.distanceToSquared(pp) < 120 * 120;
      b.nextThink = now + (near ? 0.15 : 0.4) + Math.random() * 0.08;
      think(W, b);
    }
    // continuous control (every frame): steering + combat micro
    act(W, b, dt);
  }
}

// ── decision layer ───────────────────────────────────────────────────────────
function think(W, b) {
  const a = b.actor, bb = b.bb;
  if (a.gliding) { b.state = "DROP"; return; }

  perceive(W, b);

  const st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null;
  const inStorm = st && st.dps > 0 && Math.hypot(a.pos.x - st.center.x, a.pos.z - st.center.z) > st.radius;
  const outsideNext = st && st.nextRadius != null &&
    Math.hypot(a.pos.x - (st.nextCenter ? st.nextCenter.x : st.center.x), a.pos.z - (st.nextCenter ? st.nextCenter.z : st.center.z)) > st.nextRadius * 0.9;
  const hurtRecently = W.t - a.lastDamageT < 2.5;
  const alive = W.match.aliveCount();
  const endgame = alive <= 10;
  const hasGun = a.inventory.slots.some((s, i) => i > 0 && s && s.kind === "weapon" && s.id !== "grenade");
  const heals = a.inventory.slots.some((s) => s && s.kind === "consumable" && s.count > 0);
  const mats = a.inventory.mats.wood + a.inventory.mats.brick + a.inventory.mats.metal;

  // hard overrides
  if (inStorm) { b.state = "ROTATE"; bb.moveTo = { x: st.center.x, z: st.center.z }; return; }
  if (a.healing) { b.state = "HEAL"; return; }

  // utility scores
  const s = {};
  const lastFew = alive <= 4;
  s.ENGAGE = bb.target && (hasGun || lastFew) ? 60 + (a.personality === "rusher" ? 20 : 0) + (endgame ? 25 : 0) + (lastFew ? 25 : 0) : 0;
  if (bb.target && !hasGun && !lastFew) s.FLEE = 70;
  s.HEAL = (a.hp < 45 || (a.shield < 30 && a.hp < 80)) && heals && !bb.target ? 75 : (a.hp < 60 && heals && W.t - a.lastDamageT > 6 ? 45 : 0);
  s.BOXHEAL = a.hp < 40 && heals && bb.target && mats >= 40 && b.tierK.builds >= 2 ? 85 : 0;
  s.LOOT = !hasGun ? 80 : (W.t < 120 ? 35 : 20) + (a.personality === "loot_goblin" ? 25 : 0);
  // farming matters most right after arming up — a bot with a gun and no mats
  // can't wall-up or ramp-push, which is the #1 "feels like a bot" tell.
  // Gate on "no LIVE threat" (seen <3s ago), not on the sticky 8s target memory.
  const liveThreat = bb.target && W.t - bb.targetSeenT < 3;
  s.FARM = mats < bb.matsGoal && !liveThreat
    ? (mats < 40 ? 52 : a.personality === "builder" ? 56 : (hasGun && mats < 60 ? 44 : 26))
    : 0;
  s.ROTATE = outsideNext ? (st.phaseState === "closing" ? 88 : a.personality === "rotator" ? 66 : st.tToNext < 25 ? 62 : 30) : 0;
  s.CAMP = (a.personality === "camper" || a.personality === "sniper") && hasGun && !outsideNext && !bb.target && !endgame ? 34 : 0;
  s.PUSH = bb.heard && W.t - bb.heard.t < 6 && hasGun && (a.personality === "rusher" || a.personality === "rotator") && !endgame ? 48 : 0;
  s.WANDER = 12;

  // pick best
  let best = "WANDER", bs = -1;
  for (const k in s) if (s[k] > bs) { bs = s[k]; best = k; }
  if (best === "BOXHEAL") best = "HEAL"; // handled with boxing flag
  bb.wantBox = s.BOXHEAL > 0;
  if (b.state !== best) { b.state = best; onEnter(W, b, best); }
}

function perceive(W, b) {
  const a = b.actor, bb = b.bb;
  // current target still valid?
  if (bb.target) {
    const t = W.actorById.get(bb.target);
    if (!t || !t.alive) { bb.target = null; }
  }
  // scan for enemies (vision cone + LOS) — nearest wins; sticky to current
  const eye = eyePos(a);
  let best = null, bestD = 1e9;
  for (const t of W.actors) {
    if (t === a || !t.alive) continue;
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 200) continue;
    // vision cone 110° around facing (heard targets get 360°)
    const facing = Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw));
    const angTo = Math.atan2(dx, dz);
    let dd = Math.abs(((angTo - Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw))) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    const heardHim = bb.heard && bb.heard.shooterId === t.id && W.t - bb.heard.t < 4;
    if (dd > 1.0 && !heardHim && bb.target !== t.id) continue;
    if (W.map.losBlocked(eye.x, eye.y, eye.z, t.pos.x, t.pos.y + 1.2, t.pos.z)) continue;
    const bias = bb.target === t.id ? 0.6 : 1;   // stickiness
    if (d * bias < bestD) { bestD = d * bias; best = t; }
  }
  if (best) {
    if (bb.target !== best.id) { bb.target = best.id; bb.acquireT = W.t; }
    bb.targetSeenT = W.t;
    bb.targetPos = { x: best.pos.x, y: best.pos.y, z: best.pos.z };
  } else if (bb.target && W.t - bb.targetSeenT > 8) {
    bb.target = null;   // memory decay → search last known then give up
  }
}

function onEnter(W, b, state) {
  const a = b.actor, bb = b.bb;
  const rng = Math.random;
  if (state === "LOOT") {
    const near = W.nearbyLoot(a.pos, 90);
    const pick = pickLoot(a, near);
    bb.lootId = pick ? pick.id : null;
    bb.lootType = pick ? pick.type : null;
    if (pick) bb.moveTo = { x: pick.pos.x, z: pick.pos.z };
    else {
      // no loot in reach — head to one of the 3 nearest POIs (random pick, so
      // a bot on a barren POI doesn't orbit it forever)
      const ranked = W.map.pois
        .map((p) => ({ p, d: Math.hypot(p.x - a.pos.x, p.z - a.pos.z) }))
        .filter((e) => e.d > 30)
        .sort((x, y) => x.d - y.d)
        .slice(0, 3);
      const bp = ranked.length ? ranked[Math.floor(Math.random() * ranked.length)].p : null;
      bb.moveTo = bp ? { x: bp.x + (Math.random() - 0.5) * bp.r, z: bp.z + (Math.random() - 0.5) * bp.r } : randNear(W, a, 60);
    }
  } else if (state === "FARM") {
    let best = null, bd = 1e9;
    for (const h of W.map.harvestables) {
      if (!h.alive) continue;
      const d = Math.hypot(h.pos.x - a.pos.x, h.pos.z - a.pos.z);
      if (d < bd) { bd = d; best = h; }
      if (bd < 20) break;
    }
    bb.harvestId = best ? best.id : null;
    bb.moveTo = best ? { x: best.pos.x, z: best.pos.z } : randNear(W, a, 30);
  } else if (state === "ROTATE") {
    const st = W.stormCtl.storm.stateAt(W.t);
    const cx = st.nextCenter ? st.nextCenter.x : st.center.x;
    const cz = st.nextCenter ? st.nextCenter.z : st.center.z;
    const rr = (st.nextRadius != null ? st.nextRadius : st.radius) * (0.25 + rng() * 0.5);
    const ang = rng() * Math.PI * 2;
    bb.moveTo = { x: cx + Math.cos(ang) * rr, z: cz + Math.sin(ang) * rr };
  } else if (state === "CAMP") {
    // camp near zone edge / high ground
    const st = W.stormCtl.storm.stateAt(W.t);
    const ang = rng() * Math.PI * 2;
    const rr = st.radius * (a.personality === "sniper" ? 0.55 : 0.8);
    bb.campSpot = { x: st.center.x + Math.cos(ang) * rr, z: st.center.z + Math.sin(ang) * rr };
    bb.moveTo = bb.campSpot;
  } else if (state === "PUSH") {
    bb.moveTo = bb.heard ? { x: bb.heard.x, z: bb.heard.z } : randNear(W, a, 60);
  } else if (state === "WANDER") {
    bb.moveTo = randNear(W, a, 50);
  } else if (state === "HEAL") {
    if (bb.wantBox && b.tierK.builds >= 2) boxUp(W, b);
    startHeal(W, a);
  } else if (state === "FLEE") {
    // run from target
    const t = bb.target && W.actorById.get(bb.target);
    if (t) {
      const dx = a.pos.x - t.pos.x, dz = a.pos.z - t.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      bb.moveTo = { x: a.pos.x + (dx / d) * 60, z: a.pos.z + (dz / d) * 60 };
    } else bb.moveTo = randNear(W, a, 50);
  }
}

function pickLoot(a, near) {
  const hasGun = a.inventory.slots.some((s, i) => i > 0 && s && s.kind === "weapon" && s.id !== "grenade");
  let best = null, bs = -1;
  for (const n of near) {
    let score = 0;
    if (n.type === "chest") score = hasGun ? 55 : 70;
    else if (n.data.kind === "weapon" && n.data.id !== "grenade") score = hasGun ? 30 + n.data.rarity * 8 : 90;
    else if (n.data.kind === "consumable") score = n.data.id.includes("shield") ? 45 : 34;
    else if (n.data.kind === "ammo") score = hasGun ? 40 : 10;
    else if (n.data.kind === "mats") score = 22;
    else if (n.data.kind === "weapon") score = 20; // grenades
    score -= n.d * 0.4;
    if (score > bs) { bs = score; best = n; }
  }
  return best;
}

function randNear(W, a, r) {
  for (let i = 0; i < 8; i++) {
    const x = a.pos.x + (Math.random() - 0.5) * 2 * r;
    const z = a.pos.z + (Math.random() - 0.5) * 2 * r;
    if (Math.abs(x) < W.map.half && Math.abs(z) < W.map.half && W.map.heightAt(x, z) > W.map.waterY + 0.4) return { x, z };
  }
  return { x: a.pos.x, z: a.pos.z };
}

function startHeal(W, a) {
  const order = a.shield < 40 ? ["big_shield", "mini_shield", "medkit", "bandage"] : ["medkit", "bandage", "big_shield", "mini_shield"];
  for (const id of order) if (W.useConsumable(a, id)) return true;
  return false;
}

function boxUp(W, b) {
  const a = b.actor;
  // 4 walls around own cell (facing each cardinal), floor above for tier 4+
  const saveYaw = a.yaw;
  for (let d = 0; d < 4; d++) {
    a.lastBuildT = -1; // bots box in one burst
    W.tryBuild(a, "wall", d);
  }
  if (b.tierK.builds >= 3) { a.lastBuildT = -1; W.tryBuild(a, "ramp"); } // roof-ish ramp inside
  a.yaw = saveYaw;
  b.bb.boxed = true;
}

// ── action layer (every frame) ───────────────────────────────────────────────
const _v = new THREE.Vector3();
function act(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  inp.mx = 0; inp.mz = 0; inp.sprint = false; inp.fire = false; inp.ads = false;
  inp.buildPiece = null;
  inp.crouch = false; // sticky-crouch bug: glide-dive set it and nothing cleared it → bots crawled all match

  if (a.gliding) {
    // steer toward drop target, dive when above it
    const t = bb.dropTarget || { x: 0, z: 0 };
    steerYaw(a, Math.atan2(-(t.x - a.pos.x), -(t.z - a.pos.z)), dt, 3);
    inp.mz = 1;
    const d = Math.hypot(t.x - a.pos.x, t.z - a.pos.z);
    inp.crouch = d < 60; // dive
    return;
  }

  // stuck detection → jump / sidestep
  if (bb.lastPos.distanceToSquared(a.pos) < 0.02 * 0.02 && (inp.mz || inp.mx)) bb.stuckT += dt; else bb.stuckT = 0;
  bb.lastPos.copy(a.pos);

  switch (b.state) {
    case "ENGAGE": actEngage(W, b, dt); break;
    case "FLEE": actMove(W, b, dt, true); break;
    case "HEAL": actHeal(W, b, dt); break;
    case "LOOT": actLoot(W, b, dt); break;
    case "FARM": actFarm(W, b, dt); break;
    case "ROTATE": case "PUSH": case "WANDER": actMove(W, b, dt, b.state === "ROTATE"); break;
    case "CAMP": actCamp(W, b, dt); break;
  }

  // wall-up reflex: shot recently, can't see attacker, have mats (tier 2+)
  if (W.t - a.lastDamageT < 0.9 && b.tierK.builds >= 1 && !bb.reflexWalled) {
    const att = a.lastAttacker && W.actorById.get(a.lastAttacker);
    if (att) {
      // face attacker, drop a wall
      const want = Math.atan2(-(att.pos.x - a.pos.x), -(att.pos.z - a.pos.z));
      a.yaw = want;
      inp.yaw = want;
      W.tryBuild(a, "wall");
      bb.reflexWalled = true;
      setTimeout(() => { bb.reflexWalled = false; }, 1200 - b.tierK.buildMs);
    }
  }
}

function steerYaw(a, want, dt, speed) {
  let d = want - a.input.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  a.input.yaw += d * Math.min(1, dt * (speed || 6));
}

function moveToward(W, b, tx, tz, dt, sprint) {
  const a = b.actor, inp = a.input;
  const want = Math.atan2(-(tx - a.pos.x), -(tz - a.pos.z));
  steerYaw(a, want, dt, 7);
  inp.mz = 1;
  inp.sprint = !!sprint;
  // hop obstacles: support ahead higher than feet → jump
  const aheadX = a.pos.x - Math.sin(a.input.yaw) * 1.4;
  const aheadZ = a.pos.z - Math.cos(a.input.yaw) * 1.4;
  const sup = supportAt(W, aheadX, aheadZ, a.pos.y + 0.6);
  if (sup > a.pos.y + 0.55 && sup < a.pos.y + 2.2 && a.onGround) inp.jump = true;
  if (b.bb.stuckT > 0.7) {
    inp.jump = true;
    inp.mx = Math.random() < 0.5 ? -1 : 1;
    if (b.bb.stuckT > 2 && b.tierK.builds >= 1) { W.tryBuild(a, "ramp"); b.bb.stuckT = 0; }
  }
  return Math.hypot(tx - a.pos.x, tz - a.pos.z);
}

function actMove(W, b, dt, sprint) {
  const bb = b.bb;
  if (!bb.moveTo) { onEnter(W, b, b.state); return; }
  const d = moveToward(W, b, bb.moveTo.x, bb.moveTo.z, dt, sprint);
  if (d < 3) { bb.moveTo = null; b.nextThink = 0; }
}

function actLoot(W, b, dt) {
  const a = b.actor, bb = b.bb;
  // grab everything in arm's reach (chests included)
  const near = W.nearbyLoot(a.pos, 2.4);
  for (const n of near) {
    if (n.type === "chest") { W.openChest(a, n.id); if (bb.lootId === n.id) { bb.lootId = null; b.nextThink = 0; } }
    else W.pickupItem(a, n.id);
  }
  if (bb.moveTo) {
    const far = Math.hypot(bb.moveTo.x - a.pos.x, bb.moveTo.z - a.pos.z) > 12;
    const d = moveToward(W, b, bb.moveTo.x, bb.moveTo.z, dt, far); // sprint the long hauls
    if (d < 1.8) bb.moveTo = null;
  } else {
    // plan exhausted → re-plan NOW (state may stay LOOT, so onEnter must be
    // re-run explicitly or the bot stands idle forever)
    onEnter(W, b, "LOOT");
  }
  // equip best gun if fists out
  ensureGunOut(W, a);
}

function ensureGunOut(W, a) {
  if (a.weapon && a.weapon.id !== "pickaxe" && !a.weapon.id.startsWith("consumable")) return;
  let bestIdx = -1, bs = -1;
  for (let i = 1; i < a.inventory.slots.length; i++) {
    const s = a.inventory.slots[i];
    if (s && s.kind === "weapon" && s.id !== "grenade") {
      const score = (K.WEAPONS[s.id].damage * K.WEAPONS[s.id].rpm / 60) + s.rarity * 20;
      if (score > bs) { bs = score; bestIdx = i; }
    }
  }
  if (bestIdx > 0) W.equipSlot(a, bestIdx);
}

function actFarm(W, b, dt) {
  const a = b.actor, bb = b.bb;
  const h = bb.harvestId && W.map.harvestables.find((x) => x.id === bb.harvestId);
  if (!h || !h.alive) { onEnter(W, b, "FARM"); return; }
  const d = moveToward(W, b, h.pos.x, h.pos.z, dt, false);
  if (d < 2.4) {
    // face it + swing pickaxe
    if (a.inventory.active !== 0) W.equipSlot(a, 0);
    a.input.mz = 0;
    a.input.fire = true;
  }
}

function actHeal(W, b, dt) {
  const a = b.actor;
  a.input.mz = 0; a.input.mx = 0;
  if (!a.healing) {
    if (!startHeal(W, a)) { b.state = "WANDER"; b.nextThink = 0; }
  }
}

function actCamp(W, b, dt) {
  const a = b.actor, bb = b.bb;
  if (bb.campSpot) {
    const d = Math.hypot(bb.campSpot.x - a.pos.x, bb.campSpot.z - a.pos.z);
    if (d > 4) { moveToward(W, b, bb.campSpot.x, bb.campSpot.z, dt, false); return; }
  }
  // crouch + slow scan
  a.input.crouch = true;
  a.input.yaw += dt * 0.25;
}

// ── combat ───────────────────────────────────────────────────────────────────
function actEngage(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  const t = bb.target && W.actorById.get(bb.target);
  if (!t || !t.alive) { bb.target = null; b.nextThink = 0; return; }
  const seen = W.t - bb.targetSeenT < 0.4;
  const tp = seen ? t.pos : bb.targetPos;
  if (!tp) { bb.target = null; return; }
  const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z;
  const dist = Math.hypot(dx, dz);

  ensureGunOut(W, a);
  const wid = a.weapon ? a.weapon.id : "pistol";
  const def = K.WEAPONS[wid] || K.WEAPONS.pistol;

  // preferred range by class
  const prefer = { pickaxe: 1.8, shotgun: 7, smg: 14, pistol: 16, ar: 30, sniper: 90, rocket: 40 }[wid] || 25;
  // final-circle duels: tighter aim (adrenaline > wobble) so fights resolve
  const duel = W.match.aliveCount() <= 4;

  // movement: close/retreat + strafe
  bb.strafeT -= dt;
  if (bb.strafeT <= 0) { bb.strafeT = 0.5 + Math.random() * 0.9; bb.strafeDir = Math.random() < 0.5 ? -1 : 1; }
  if (dist > prefer * 1.5) { inp.mz = 1; inp.sprint = dist > prefer * 3; }
  else if (dist < prefer * 0.5) inp.mz = -0.7;
  inp.mx = bb.strafeDir * (dist < 50 ? 1 : 0.4);
  if (a.onGround && b.actor.tier >= 3 && Math.random() < dt * 0.35) inp.jump = true;

  // ramp-push: advantage + mats + mid range (tier 3+)
  const advantage = (a.hp + a.shield) - (t.hp + t.shield) > 20;
  const mats = a.inventory.mats.wood + a.inventory.mats.brick + a.inventory.mats.metal;
  if (b.tierK.builds >= 2 && advantage && mats > 60 && dist < 40 && dist > 10 && seen && Math.random() < dt * 0.5) {
    W.tryBuild(a, "ramp");
    if (b.tierK.builds >= 3) W.tryBuild(a, "wall");
    inp.jump = a.onGround && supportAt(W, a.pos.x, a.pos.z, a.pos.y + 0.6) > a.pos.y + 0.4;
  }
  // high-ground denial: target above → build up (tier 4+)
  if (b.tierK.builds >= 3 && seen && (tp.y - a.pos.y) > 5 && mats > 40 && Math.random() < dt * 0.4) {
    W.tryBuild(a, "ramp");
  }

  // aiming with human error model
  const eye = eyePos(a);
  const aimY = tp.y + 1.15 + (seen ? (t.vel ? 0 : 0) : 0);
  // lead for projectile weapons
  let lead = 0;
  if (def.speed && def.speed < 600 && seen && t.vel) lead = dist / def.speed;
  const px = tp.x + (seen && t.vel ? t.vel.x * lead : 0);
  const pz = tp.z + (seen && t.vel ? t.vel.z * lead : 0);
  let wantYaw = Math.atan2(-(px - eye.x), -(pz - eye.z));
  let wantPitch = Math.atan2(aimY - eye.y, Math.hypot(px - eye.x, pz - eye.z));

  // error: base tier error × acquire overshoot (3× decaying 0.6s) × target-motion penalty
  const sinceAcq = W.t - bb.acquireT;
  const acquireMul = sinceAcq < 0.6 ? 3 - (sinceAcq / 0.6) * 2 : 1;
  const tgtSpeed = seen && t.vel ? Math.hypot(t.vel.x, t.vel.z) : 0;
  const motionMul = 1 + Math.min(1.2, tgtSpeed / 6) * 0.9 + (t.onGround === false ? 0.5 : 0);
  const errDeg = b.tierK.aimErrDeg * acquireMul * motionMul * (duel ? 0.55 : 1);
  const err = (errDeg * Math.PI) / 180;
  // wander the error smoothly (not white noise): per-brain sine wobble
  bb.errPhase = (bb.errPhase || Math.random() * 9) + dt * 3.1;
  wantYaw += Math.sin(bb.errPhase) * err;
  wantPitch += Math.cos(bb.errPhase * 0.83) * err * 0.6;

  steerYaw(a, wantYaw, dt, 10);
  inp.pitch = K.clamp(inp.pitch + (wantPitch - inp.pitch) * Math.min(1, dt * 9), -1.3, 1.3);

  // fire discipline: reaction delay, LOS, range, bursts
  const reacted = sinceAcq > b.tierK.reactionMs / 1000;
  const inRange = dist < (def.falloff ? def.falloff[1] * 1.3 : 30);
  const canSee = seen;
  inp.ads = dist > 25;
  if (reacted && canSee && inRange) {
    if (def.cls === "ar" || def.cls === "smg" || def.cls === "pistol") {
      if (bb.burstLeft <= 0 && bb.burstPause <= 0) { bb.burstLeft = def.cls === "ar" ? 4 : 8; }
      if (bb.burstLeft > 0) {
        inp.fire = true;
        bb.burstLeft -= dt * (def.rpm / 60);
        if (bb.burstLeft <= 0) bb.burstPause = 0.35 + Math.random() * 0.4;
      }
      bb.burstPause -= dt;
    } else if (def.cls === "sniper") {
      // only when still-ish
      if (Math.hypot(a.vel.x, a.vel.z) < 1.5) { inp.fire = true; inp.mx = 0; inp.mz = 0; inp.crouch = true; }
    } else {
      inp.fire = true;
    }
  }
  // grenade toss at boxed/far targets occasionally (tier 3+)
  if (b.actor.tier >= 3 && a.inventory.grenades > 0 && dist > 12 && dist < 30 && Math.random() < dt * 0.06) {
    W.throwGrenade(a);
  }
  // reload when safe
  if (a.weapon && a.weapon.magAmmo === 0) inp.reload = true;
  if (!canSee && a.weapon && def.mag > 0 && a.weapon.magAmmo < def.mag * 0.4) inp.reload = true;

  // search last-known if lost
  if (!seen && bb.targetPos) {
    moveToward(W, b, bb.targetPos.x, bb.targetPos.z, dt, false);
  }
}
