/**
 * royale/bots.js — the 49 opponents. THE quality bar for this game: bots must
 * loot coherently, rotate EARLY, use cover, flank, disengage to heal, and
 * fight with human-feeling aim (reaction delay, acquire overshoot, tracking
 * warm-up, whiffs under strafing) — everything cheap BR bots don't do.
 *
 * Architecture: per-bot BRAIN = utility-scored state machine over a
 * blackboard, ticked on a stagger (near-player bots think more often). The
 * brain only WRITES the actor's input struct — movement/weapons/building run
 * through the exact same code as the human player.
 *
 * States: DROP → LOOT / ROTATE / ENGAGE / FLEE / HEAL / CAMP / PUSH / WANDER
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
  // kill taunts: a bot that just won a fight (and sees no new threat)
  // sometimes dances on the body — reads VERY human
  W.events.on("actorDied", (victim, killerId) => {
    const k2 = killerId && W.actorById.get(killerId);
    if (!k2 || !k2.isBot || !k2.alive || !k2.brain) return;
    if (k2.brain.bb.target && W.t - k2.brain.bb.targetSeenT < 2) return;   // still in danger
    if (Math.random() < 0.3) k2.input.emote = Math.random() < 0.5 ? "dance" : "cheer";
  });
  // hearing: every shot is broadcast to nearby brains
  W.events.on("shotFired", (shooter, weaponId, pos) => {
    for (const b of brains) {
      if (!b.actor.alive || b.actor === shooter) continue;
      const d = Math.hypot(b.actor.pos.x - pos.x, b.actor.pos.z - pos.z);
      if (d < 250) b.bb.heard = { x: pos.x, z: pos.z, t: b.W.t, d, shooterId: shooter.id };
    }
  });
}

// startMatch must clear the previous match's brains — they hold references to
// the old actor objects and keep thinking/acting into them forever otherwise
export function resetBrains() { brains.length = 0; }

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
      heard: null, lootId: null,
      moveTo: null, strafeDir: 1, strafeT: 0,
      campSpot: null, dropTarget: null, chestT: 0, chestId: null,
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
  const alive = W.match.aliveCount();
  const endgame = alive <= 10;
  // everyone spawns with a pistol; "upgraded" = anything beyond it
  const upgraded = a.inventory.slots.some((s2, i) => s2 && s2.kind === "weapon" && !(i === 0 && s2.id === "pistol" && s2.rarity === 0));
  const heals = a.inventory.slots.some((s2) => s2 && s2.kind === "consumable" && s2.count > 0);

  // hard overrides
  if (inStorm) { b.state = "ROTATE"; bb.moveTo = { x: st.center.x, z: st.center.z }; return; }
  if (a.healing) { b.state = "HEAL"; return; }

  // utility scores — a VISIBLE enemy is the headline event: fighting beats
  // looting/rotating for every personality (the "runs right past you" tell)
  const s = {};
  const lastFew = alive <= 4;
  const outnumbered = a.hp + a.shield < 50;
  const liveTarget = bb.target && W.t - bb.targetSeenT < 1.2;
  // live sighting = fight — but an un-geared bot ignores DISTANT enemies and
  // keeps looting (a starter-pistol duel at 60m is how the whole lobby
  // gridlocks); anyone close is always fought
  const tRef = bb.targetPos;
  const tDist = tRef ? Math.hypot(tRef.x - a.pos.x, tRef.z - a.pos.z) : 999;
  const engageBase = liveTarget ? ((!upgraded && tDist > 35) ? 55 : (tDist < 40 ? 88 : 80)) : 42;
  s.ENGAGE = bb.target
    ? engageBase + (a.personality === "rusher" ? 15 : 0) + (endgame ? 20 : 0) + (lastFew ? 25 : 0)
    : 0;
  s.FLEE = bb.target && outnumbered && !lastFew && heals ? 86 : 0;   // disengage to heal, not to hide forever
  s.HEAL = (a.hp < 45 || (a.shield < 30 && a.hp < 80)) && heals && !bb.target ? 75 : (a.hp < 60 && heals && W.t - a.lastDamageT > 6 ? 45 : 0);
  s.LOOT = !upgraded ? 64 : (W.t < 120 ? 35 : 20) + (a.personality === "loot_goblin" ? 25 : 0);
  // BATTLE-ROYALE PRIORITY MODEL (owner: "run from storms but FIGHT once
  // safe"): rotation urgency = how far past safety you are vs time left.
  // Only a genuinely pressing storm outranks a live fight — otherwise bots
  // were sprinting straight past enemies all mid-game.
  let rotScore = 0;
  if (outsideNext) {
    const scx = st.nextCenter ? st.nextCenter.x : st.center.x;
    const scz = st.nextCenter ? st.nextCenter.z : st.center.z;
    const overM = Math.hypot(a.pos.x - scx, a.pos.z - scz) - (st.nextRadius || 0);
    const needS = overM / 8 + 6;                                   // sprint ≈8m/s effective + margin
    const timeLeft = st.phaseState === "closing" ? st.tToNext * 0.5 : st.tToNext;
    rotScore = timeLeft < needS ? 95 : timeLeft < needS * 2 ? 70 : 40;
  }
  s.ROTATE = rotScore;
  s.CAMP = (a.personality === "camper" || a.personality === "sniper") && !outsideNext && !bb.target && !endgame ? 34 : 0;
  s.PUSH = bb.heard && W.t - bb.heard.t < 6 && (a.personality === "rusher" || a.personality === "rotator" || a.personality === "flanker") && !endgame ? 48 : 0;
  s.WANDER = 12;

  // pick best
  let best = "WANDER", bs = -1;
  for (const k in s) if (s[k] > bs) { bs = s[k]; best = k; }
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
    if (bb.avoidId === t.id && W.t < (bb.avoidUntil || 0)) continue;   // fatigue cooldown
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 200) continue;
    // vision: wide ~160° cone; anyone within 15m registers regardless of
    // facing (you notice someone sprinting past you); heard shooters = 360°
    const angTo = Math.atan2(dx, dz);
    let dd = Math.abs(((angTo - Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw))) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    const heardHim = bb.heard && bb.heard.shooterId === t.id && W.t - bb.heard.t < 4;
    if (dd > 1.4 && d > 15 && !heardHim && bb.target !== t.id) continue;
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
    startHeal(W, a);
  } else if (state === "FLEE") {
    // run from target — but NEVER flee into the storm: blend the escape vector
    // toward the circle center
    const t = bb.target && W.actorById.get(bb.target);
    if (t) {
      const dx = a.pos.x - t.pos.x, dz = a.pos.z - t.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      let fx = a.pos.x + (dx / d) * 60, fz = a.pos.z + (dz / d) * 60;
      if (W.stormCtl) {
        const st = W.stormCtl.storm.stateAt(W.t);
        const c = st.nextCenter || st.center;
        fx = fx * 0.55 + c.x * 0.45;
        fz = fz * 0.55 + c.z * 0.45;
      }
      bb.moveTo = { x: fx, z: fz };
    } else bb.moveTo = randNear(W, a, 50);
  }
}

function pickLoot(a, near) {
  const upgraded = a.inventory.slots.some((s, i) => s && s.kind === "weapon" && !(i === 0 && s.id === "pistol" && s.rarity === 0));
  let best = null, bs = -1;
  for (const n of near) {
    let score = 0;
    if (n.type === "chest") score = upgraded ? 55 : 72;
    else if (n.data.kind === "weapon") score = upgraded ? 30 + n.data.rarity * 8 : 66 + n.data.rarity * 6;
    else if (n.data.kind === "consumable") score = n.data.id.includes("shield") ? 45 : 34;
    else if (n.data.kind === "ammo") score = 38;
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

// ── action layer (every frame) ───────────────────────────────────────────────
const _v = new THREE.Vector3();
function act(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  if (a.emoting) { inp.mx = 0; inp.mz = 0; inp.fire = false; return; }   // let the taunt play
  inp.mx = 0; inp.mz = 0; inp.sprint = false; inp.fire = false; inp.ads = false;

  if (a.gliding) {
    // steer toward drop target, dive (sprint) when above it
    const t = bb.dropTarget || { x: 0, z: 0 };
    steerYaw(a, Math.atan2(-(t.x - a.pos.x), -(t.z - a.pos.z)), dt, 3);
    inp.mz = 1;
    const d = Math.hypot(t.x - a.pos.x, t.z - a.pos.z);
    inp.sprint = d < 60; // dive
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
    case "ROTATE": case "PUSH": case "WANDER": actMove(W, b, dt, b.state === "ROTATE"); break;
    case "CAMP": actCamp(W, b, dt); break;
  }

  // suppression reflex: shot recently by someone unseen → sprint to lateral
  // cover instead of standing there soaking damage
  if (W.t - a.lastDamageT < 0.9 && W.t >= (bb.coverReflexUntil || 0) && b.state !== "ENGAGE") {
    const att = a.lastAttacker && W.actorById.get(a.lastAttacker);
    if (att) {
      const ang = Math.atan2(a.pos.x - att.pos.x, a.pos.z - att.pos.z) + (Math.random() < 0.5 ? 1 : -1) * 1.2;
      bb.moveTo = { x: a.pos.x + Math.sin(ang) * 18, z: a.pos.z + Math.cos(ang) * 18 };
      // sim-time gate (was a wall-clock setTimeout → broke synchronous fastForward
      // determinism: the macrotask never drained mid-soak so the reflex stuck on).
      bb.coverReflexUntil = W.t + 1.5;
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
    if (b.bb.stuckT > 2.2) { b.bb.moveTo = randNear(W, a, 25); b.bb.stuckT = 0; } // reroute
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
    if (n.type === "chest") {
      // chests take a 2s channel — bots obey the same rule as the player
      if (bb.chestId !== n.id) { bb.chestId = n.id; bb.chestT = 0; }
      bb.chestT += dt;
      a.input.mz = 0; a.input.mx = 0;
      if (bb.chestT >= 2) { W.openChest(a, n.id); bb.chestId = null; bb.chestT = 0; if (bb.lootId === n.id) { bb.lootId = null; b.nextThink = 0; } }
      return; // stand and channel
    }
    W.pickupItem(a, n.id);
  }
  bb.chestId = null; bb.chestT = 0;
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
  // holding a consumable (or an empty hand) mid-world → switch to the best gun
  if (a.weapon && !a.weapon.id.startsWith("consumable")) return;
  let bestIdx = -1, bs = -1;
  for (let i = 0; i < a.inventory.slots.length; i++) {
    const s = a.inventory.slots[i];
    if (s && s.kind === "weapon") {
      const score = (K.WEAPONS[s.id].damage * K.WEAPONS[s.id].rpm / 60) + s.rarity * 20;
      if (score > bs) { bs = score; bestIdx = i; }
    }
  }
  if (bestIdx >= 0) W.equipSlot(a, bestIdx);
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
  // hold position + slow scan (ADS for the tighter cone read)
  a.input.ads = true;
  a.input.yaw += dt * 0.25;
}

// ── combat ───────────────────────────────────────────────────────────────────
function actEngage(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  const t = bb.target && W.actorById.get(bb.target);
  if (!t || !t.alive) { bb.target = null; bb.fightT = 0; b.nextThink = 0; return; }
  // fight fatigue: humans don't trade pistol whiffs forever — after ~14s of
  // stalemate, break off to reposition/loot (prevents map-wide pistol gridlock)
  if (bb.fightTarget !== bb.target) { bb.fightTarget = bb.target; bb.fightT = 0; }
  bb.fightT = (bb.fightT || 0) + dt;
  if (bb.fightT > 14 && W.t - a.lastDamageT > 6 && W.match.aliveCount() > 6) {
    bb.avoidId = bb.target; bb.avoidUntil = W.t + 6;   // don't instantly re-lock the same stalemate
    bb.target = null; bb.fightT = 0; b.nextThink = 0;
    return;
  }
  const seen = W.t - bb.targetSeenT < 0.4;
  const tp = seen ? t.pos : bb.targetPos;
  if (!tp) { bb.target = null; return; }
  const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z;
  const dist = Math.hypot(dx, dz);

  ensureGunOut(W, a);
  const wid = a.weapon ? a.weapon.id : "pistol";
  const def = K.WEAPONS[wid] || K.WEAPONS.pistol;

  // preferred range by class
  const prefer = { shotgun: 7, smg: 14, pistol: 16, ar: 30, sniper: 90, glauncher: 26 }[wid] || 25;
  // final-circle duels: tighter aim (adrenaline > wobble) so fights resolve
  const duel = W.match.aliveCount() <= 4;

  // movement: close/retreat + strafe; flankers arc around instead of straight-lining
  bb.strafeT -= dt;
  if (bb.strafeT <= 0) {
    bb.strafeT = 0.5 + Math.random() * 0.9;
    bb.strafeDir = a.personality === "flanker" ? (bb.strafeDir || 1) : (Math.random() < 0.5 ? -1 : 1);
  }
  // RELOADING = break for lateral cover, don't stand in the open trading nothing
  if (a.weapon && a.weapon.state === "reloading") {
    inp.mx = bb.strafeDir;
    inp.mz = -0.5;
    inp.sprint = true;
    steerYaw(a, Math.atan2(-(tp.x - a.pos.x), -(tp.z - a.pos.z)), dt, 10);
    return;
  }
  if (dist > prefer * 1.5) { inp.mz = 1; inp.sprint = dist > prefer * 3; }
  else if (dist < prefer * 0.5) inp.mz = -0.7;
  inp.mx = bb.strafeDir * (dist < 50 ? 1 : a.personality === "flanker" ? 0.8 : 0.4);
  if (a.onGround && b.actor.tier >= 3 && Math.random() < dt * 0.35) inp.jump = true;

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
  const motionMul = 1 + Math.min(1.2, tgtSpeed / 9.6) * 0.55 + (t.onGround === false ? 0.35 : 0);
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
      if (Math.hypot(a.vel.x, a.vel.z) < 1.5) { inp.fire = true; inp.mx = 0; inp.mz = 0; }
    } else {
      inp.fire = true;
    }
  }
  // reload when safe
  if (a.weapon && a.weapon.magAmmo === 0) inp.reload = true;
  if (!canSee && a.weapon && def.mag > 0 && a.weapon.magAmmo < def.mag * 0.4) inp.reload = true;

  // search last-known if lost
  if (!seen && bb.targetPos) {
    moveToward(W, b, bb.targetPos.x, bb.targetPos.z, dt, false);
  }
}
