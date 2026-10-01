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
// Math.hypot allocates in V8 (it is a rest-args builtin): 60 KB/frame of garbage
// was measured on the brain + bullet paths. Two-argument form, no allocation.
const hyp = (x, z) => Math.sqrt(x * x + z * z);
// scratch for per-frame K.moveBasis calls (out-param; older sims ignore it)
const _mb0 = { fx: 0, fz: 0, rx: 0, rz: 0 }, _mb1 = { fx: 0, fz: 0, rx: 0, rz: 0 };
const _eye_actEngage = { x: 0, y: 0, z: 0 }, _eye_fireOnTheMove = { x: 0, y: 0, z: 0 }, _eye_perceive = { x: 0, y: 0, z: 0 }, _eye_underFire = { x: 0, y: 0, z: 0 };   // eyePos scratch per caller (no per-frame allocation)

// First-run protection. BOT_TIER_MIX.standard is [8,12,14,10,5] over 49 bots and
// nothing here ever read the player's record, so match one shipped 5 tier-5 bots
// (210 ms reaction, 0.9° aim error) and 10 tier-4 (300 ms, 1.8°) at someone who
// had never fired the gun. Same five tiers, same seeded draw — just weighted down
// for the first three RECORDED matches (career.matches is incremented by
// recordMatch on the post-match screen, so practice and abandoned matches don't
// spend one). Offline only: bots simulate on the authority in online play, and a
// per-client skew would desync the roster.
// SUPERSEDED 2026-09-15 by the skill-banded mixes in royale.js (BOT_TIER_BANDS).
// Kept, not deleted, because it records a real decision. Two reasons it went:
// it scaled difficulty DOWN only and never ran online (it was gated !W.net), and
// 34 of its 49 bots sit at 700ms/7.5deg and 500ms/4.5deg — the audit measured a
// tier-1 bot at a 0% kill rate, so that is 34 whiffing statues, not a gentle
// lobby. The soft end is now band B0, which keeps 69% of the lobby in tiers 3-5.
const ROOKIE_TIER_MIX = [18, 16, 10, 4, 1];   // eslint-disable-line no-unused-vars

export function init(W) {
  K = W.SIM;
  brains.length = 0;
  // kill taunts: a bot that just won a fight (and sees no new threat)
  // sometimes dances on the body — reads VERY human
  W.events.on("actorDied", (victim, killerId) => {
    const k2 = killerId && W.actorById.get(killerId);
    if (!k2 || !k2.isBot || !k2.alive || !k2.brain) return;
    if (k2.brain.bb.target && W.t - k2.brain.bb.targetSeenT < 2) return;   // still in danger
    const r = k2.brain.rng;
    if (r() < 0.3) k2.input.emote = r() < 0.5 ? "dance" : "cheer";
  });
  // hearing: every shot is broadcast to nearby brains
  // The shot is located at the SHOOTER, not at the event's muzzle point: weapons.js
  // derives the muzzle from the hand bone's world matrix, i.e. from the animation
  // pose — view state that does not replay. Hearing at the muzzle sent a PUSHing
  // bot to a goal 0.2 m different on a replay of the same seed (measured
  // 2026-09-30: the first divergence of a seed-1 replay, at t = 25.5 s).
  W.events.on("shotFired", (shooter, weaponId, muzzle) => {
    const p = (shooter && shooter.pos) || muzzle;
    for (const b of brains) {
      if (!b.actor.alive || b.actor === shooter) continue;
      const d = hyp(b.actor.pos.x - p.x, b.actor.pos.z - p.z);
      if (d < 250) {
        // one record per brain, rewritten in place (every shot used to allocate one per
        // listening brain); nothing keeps a reference to it (PUSH copies x/z out)
        const h = b.bb.heard || (b.bb.heard = { x: 0, z: 0, t: 0, d: 0, shooterId: null });
        h.x = p.x; h.z = p.z; h.t = b.W.t; h.d = d; h.shooterId = shooter.id;
      }
    }
  });
  // supply drops: no brain had ANY concept of the two per-match crates, so the
  // best loot in the game was uncontested. A bot could only collect one by
  // coincidence — via the 90m scan inside LOOT, which scores 20-35 mid-game and
  // loses to ENGAGE/ROTATE every time. This mark is what routes them there.
  W.events.on("supplyDropLanded", (p) => {
    for (const b of brains) {
      if (!b.actor.alive) continue;
      if (hyp(b.actor.pos.x - p.x, b.actor.pos.z - p.z) < 220) {
        b.bb.supply = { x: p.x, z: p.z, t: b.W.t };
        b.nextThink = 0;
      }
    }
  });
}

// startMatch must clear the previous match's brains — they hold references to
// the old actor objects and keep thinking/acting into them forever otherwise
export function resetBrains() { brains.length = 0; }

/** C8 teardown contract. Bots own no GPU objects; what they hold across a match
 *  boundary is references: the brain list (old actors) and the pathfinder's
 *  collider window (old map colliders). Drop both. Safe to call twice. */
export function disposeMatch(W) {
  const n = brains.length;
  brains.length = 0;
  navCols.length = 0;
  return { brains: n };
}

/** Test hook: the live brain list, for _harness/botcheck.py. Read-only by
 *  convention — the harness measures, it never steers. */
export function debugBrains() { return brains; }

/**
 * Decide the lobby's difficulty ONCE, at match start, before any brain attaches.
 *
 * This has to live outside attachBrain for three separate reasons, all of them
 * real code paths:
 *  - ffg_royale3d.js guests never call attachBrain at all (the bots are remote),
 *    so anything memoized inside it is never populated on a guest;
 *  - net.js hostLost() schedules attachBrain via an async import().then() AFTER
 *    it has already synchronously set W.net = null, so a `W.net` test inside
 *    attachBrain reads the wrong value on host takeover;
 *  - PLAY AGAIN re-enters startMatch, so the read must happen after recordMatch
 *    has updated the rating, not before.
 * Reading it once here makes all three correct by construction.
 */
export function setLobbySkill(W) {
  W.matchWasNet = !!W.net;          // captured BEFORE a takeover nulls W.net
  W.matchSkill = readSkill(W);
  // Quick mode is the short, hot format — nudge it up a little.
  const s = W.mode === "quick" ? Math.min(1, W.matchSkill + 0.15) : W.matchSkill;
  W.botMix = K.skillMix(s);
  W.botMixRating = K.mixRating(W.botMix);
  return W.botMix;
}

/** The account's hidden skill rating, 0-1. Defaults mid-low so a brand-new
 *  account starts challenged-but-not-slaughtered and converges from there. */
export function readSkill(W) {
  const p = W.progress;
  const v = p && typeof p.skill === "number" ? p.skill : NaN;
  return Number.isFinite(v) ? Math.min(0.98, Math.max(0.05, v)) : 0.35;
}

export function attachBrain(W, actor, nBots) {
  // Seed off the SLOT, not brains.length/W.actors.length: on the hostLost path the
  // roster is already fully built when brains are attached, so a length-derived
  // seed hands every converted bot the same rng stream (46 identical bots). Slot
  // ids are "s<i>", and slot-seeding also makes host and guest agree per slot.
  const slot = parseInt(String(actor.id).slice(1), 10) || 0;
  const rng = K.mulberry32((W.seed ^ 0xb0b) + (slot + 1) * 31);
  const mix = W.botMix || K.BOT_TIER_MIX[W.mode] || K.BOT_TIER_MIX.standard;
  const total = nBots || 49;

  // An IID draw, not the old quota walk. The old form was
  //   r = (assigned + rng()*0.99) / 49 * sum(mix)
  // which (a) made tier monotone in slot index — not random per bot at all — and
  // (b) divided by the LITERAL 49 regardless of how many bots actually exist, so
  // every human who joined silently deleted a top-tier bot (a 4-stack faced 2
  // tier-5s instead of 5). weightedIndex has no quota, so neither bug can recur.
  let tier = K.weightedIndex(rng, mix) + 1;

  // Variance rails. An IID draw can roll a freak lobby; these bound the top end
  // without reintroducing a quota. Counted off `brains` rather than module
  // counters on purpose: resetBrains() only empties that array, so counters would
  // survive into the next match and cap every later lobby into the soft tiers.
  let n5 = 0, n45 = 0;
  for (const x of brains) { if (x.tier0 === 5) n5++; if (x.tier0 >= 4) n45++; }
  const cap5 = Math.ceil(total * mix[4] / 49 * 1.6) + 1;
  const cap45 = Math.ceil(total * (mix[3] + mix[4]) / 49 * 1.35) + 1;
  if (tier === 5 && n5 >= cap5) tier = 4;
  if (tier >= 4 && n45 >= cap45) tier = 3;

  actor.tier = tier;
  actor.personality = K.BOT_PERSONALITIES[Math.floor(rng() * K.BOT_PERSONALITIES.length)];
  const brain = {
    W, actor,
    // PER-SLOT SEEDED STREAM (audit M4). Every random decision this brain makes
    // draws from here — never Math.random, never a stream shared with the view
    // (fx/audio draw a wall-clock-dependent count). This is what lets a seed
    // replay a whole match.
    rng,
    tier0: tier,                  // the DRAWN tier; the rails count this
    tierNow: tier,                // the live, possibly fractional, ramped tier
    // How far this bot climbs by the final circle. Random per bot, per the
    // owner's call: some opponents grow into the endgame, some don't.
    ramp: rng() < 0.5 ? 1 : (rng() < 0.6 ? 0 : 2),
    tierK: K.BOT_TIERS[tier - 1],
    state: "DROP",
    nextThink: 0,
    bb: {          // blackboard
      target: null, targetSeenT: -99, targetPos: null, acquireT: 0,
      heard: null, lootId: null,
      moveTo: null, strafeDir: 1, strafeT: 0,
      campSpot: null, dropTarget: null, chestT: 0, chestId: null,
      stuckT: 0, lastPos: new THREE.Vector3(), burstLeft: 0, burstPause: 0,
      // EVERY field the brain ever writes, present from birth, so all 49
      // blackboards share one hidden class. They used to grow these on first use,
      // each bot in its own order: dozens of shapes at every bb.* read, i.e.
      // megamorphic loads, and a megamorphic load of a number field hands back a
      // fresh heap box - garbage on every read in actEngage/moveToward/think. Each
      // start value behaves exactly like the old `undefined` at every reader:
      // numbers only meet `|| 0` / `|| -99` defaults or `>` tests against W.t >= 0;
      // the rest only meet truthiness or `== null`. fightTarget, threatFor and
      // coverState keep `undefined` itself (compared with !== / ===).
      lootType: null, supply: null, path: null, pathGoal: null, nextPathT: 0, badLoot: null,
      progGoal: null, progBest: null, progT: 0, wallSide: 0, detourDir: 0, nextJumpT: 0,
      anchor: null, anchorT: 0, breaks: 0,
      fightTarget: undefined, fightT: 0, aimHigh: false, errPhase: 0, closeInUntil: 0,
      avoidId: null, avoidUntil: 0, swapT: -99, healBlockedUntil: 0,
      threatFor: undefined, threatT: -99, threatAt: null,
      coverState: undefined, coverPt: null, coverGiveUp: 0, coverUntil: 0, coverFailUntil: 0, coverReflexUntil: 0,
    },
  };
  actor.brain = brain;
  brains.push(brain);
  return brain;
}

// One bot per this many loot-point units at a POI (a chest counts 2: it bursts into
// a gun, its ammo and an extra). Measured before the cap: 27-51% of the lobby dead
// inside 60 s, because 55-85% of bots dropped into ~8 POIs holding 1-16 loot
// points each: a pistol brawl over a handful of guns (audit gap 4).
const DROP_PTS_PER_BOT = 4;
const LAND_CLEAR_M = 3.5;          // landing spot: no low overhang within this reach
export function assignDrops(W) {
  const rng = K.mulberry32(W.seed ^ 0xd407);
  const pois = W.map.pois;
  const pts = Object.create(null);
  for (const lp of (W.map.lootPoints || [])) {
    if (lp.poi == null) continue;
    pts[lp.poi] = (pts[lp.poi] || 0) + (lp.kind === "chest" ? 2 : 1);
  }
  const cap = pois.map((p) => Math.max(1, Math.floor((pts[p.id] || 0) / DROP_PTS_PER_BOT)));
  const used = pois.map(() => 0);
  // LAND ON A GUN. A player in the glide aims at a gun or a chest they can see; the
  // bots aimed at a random point inside the POI radius (or anywhere on the map),
  // landed empty-handed and met each other with the starter pistol. Measured
  // 2026-09-30 after the loot-economy change: 13-23 of 49 bots still died inside
  // 60 s, and 20 of the first 22 kills on isla_viva seed 1 were pistol kills.
  // Landing spots are loot points that hold a non-pistol gun (or a chest, which
  // always bursts into one), one bot per spot, in loot-point order (deterministic).
  const spots = { wild: [] };
  const byPoi = Object.create(null);
  // A spot has to be somewhere a glide can actually END: open ground under open sky
  // and dry all round. Aiming straight at loot inside a hut landed the bot on the
  // roof above it, and a chest on a pier or the shipwreck landed it in the sea
  // beside the structure (both measured on the first version of this: bots on
  // roofs, and bots swimming against a pier for 200+ s). So the glide aims at the
  // nearest clear patch of ground within ~7 m of the gun — outside the hut's door
  // side or beside the platform — and the bot walks the last few metres.
  const wy = W.map.waterY;
  const clearGround = (x, z) => {
    const g = W.map.heightAt(x, z);
    if (g < wy + 0.5) return false;
    for (let k = 0; k < 8; k++) {
      const an = k * Math.PI / 4;
      if (W.map.heightAt(x + Math.cos(an) * 4, z + Math.sin(an) * 4) < wy + 0.5) return false;
    }
    // nothing standing on the spot, and no LOW OVERHANG within the ~2.3 m a glide
    // drifts off its target (measured): an actor that lands under a deck or slab
    // with less than its 1.8 m of headroom cannot walk out (player.js
    // blockedHoriz blocks every direction while it overlaps the slab).
    const cols = W.map.queryColliders(x, z, LAND_CLEAR_M);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.dead) continue;
      const near = x > c.minX - 1.0 && x < c.maxX + 1.0 && z > c.minZ - 1.0 && z < c.maxZ + 1.0;
      if (near && c.maxY > g + 0.3) return false;
      const reach = x > c.minX - LAND_CLEAR_M && x < c.maxX + LAND_CLEAR_M && z > c.minZ - LAND_CLEAR_M && z < c.maxZ + LAND_CLEAR_M;
      if (reach && c.kind !== "ramp" && c.minY > g + 0.3 && c.minY < g + 2.6) return false;
    }
    return true;
  };
  const RING_R = [0, 3, 5, 7];
  const landingFor = (lp) => {
    for (let ri = 0; ri < RING_R.length; ri++) {
      const r = RING_R[ri];
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const an = k * Math.PI / 4;
        const x = lp.x + Math.cos(an) * r, z = lp.z + Math.sin(an) * r;
        if (clearGround(x, z)) return { x, z };
      }
    }
    return null;
  };
  if (W.nearbyLoot) {
    for (const lp of (W.map.lootPoints || [])) {
      let ok = lp.kind === "chest";
      if (!ok) {
        const near = W.nearbyLoot(lp, 1.8);
        for (let i = 0; i < near.length && !ok; i++) {
          const n = near[i];
          if (n.type === "item" && n.data.kind === "weapon" && n.data.id !== "pistol") ok = true;
        }
      }
      if (!ok) continue;
      const at = landingFor(lp);
      if (!at) continue;
      const s = { x: at.x, z: at.z, taken: false };
      if (lp.poi == null) spots.wild.push(s);
      else (byPoi[lp.poi] || (byPoi[lp.poi] = [])).push(s);
    }
  }
  const claim = (list) => {
    if (!list || !list.length) return null;
    let k = Math.floor(rng() * list.length);
    for (let n = 0; n < list.length; n++, k = (k + 1) % list.length) {
      if (!list[k].taken) { list[k].taken = true; return list[k]; }
    }
    return null;
  };
  for (const b of brains) {
    const hot = b.actor.personality === "rusher" || b.actor.personality === "rotator";
    let p;
    let idx = -1;
    if (pois.length && rng() < (hot ? 0.85 : 0.55)) {
      // rushers pick central/first POIs, goblins the far ones
      idx = b.actor.personality === "loot_goblin"
        ? pois.length - 1 - Math.floor(rng() * Math.min(3, pois.length))
        : Math.floor(rng() * pois.length);
      // POI full: this bot spreads out instead
      if (used[idx] >= cap[idx]) idx = -1;
    }
    if (idx >= 0) {
      used[idx]++;
      p = pois[idx];
      const s = claim(byPoi[p.id]);
      b.bb.dropTarget = s ? { x: s.x, z: s.z } : { x: p.x + (rng() - 0.5) * p.r, z: p.z + (rng() - 0.5) * p.r };
    } else {
      const s = claim(spots.wild);
      if (s) b.bb.dropTarget = { x: s.x, z: s.z };
      else { const gp = W.map.randomGroundPos(rng); b.bb.dropTarget = { x: gp.x, z: gp.z }; }
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
  // Cover scans are the one genuinely expensive thing a brain can do, so they are
  // rationed GLOBALLY rather than per-bot: 2 full scans per frame across all 49
  // brains. With ~24 bots fighting at once every fighter still gets a slot about
  // every 12 frames (~0.2s), far more often than the re-plan interval needs.
  _coverBudget = 2;
  const now = W.t;
  const pp = W.player ? W.player.pos : null;
  for (const b of brains) {
    const a = b.actor;
    if (!a.alive || a.netRemote) continue;
    // staggered thinking: near bots think fast, far bots slow
    if (now >= b.nextThink) {
      const near = pp && a.pos.distanceToSquared(pp) < 120 * 120;
      b.nextThink = now + (near ? 0.15 : 0.4) + b.rng() * 0.08;
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
  // Weapon choice belongs on the think cadence, not inside two act states. It
  // used to be called only from actLoot and actEngage, so a bot rotating across
  // the map with a dry gun never re-evaluated until it happened to engage —
  // by which point it was already pulling a dead trigger at someone.
  ensureGunOut(W, a);

  const st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null;
  const inStorm = st && st.dps > 0 && hyp(a.pos.x - st.center.x, a.pos.z - st.center.z) > st.radius;
  const outsideNext = st && st.nextRadius != null &&
    hyp(a.pos.x - (st.nextCenter ? st.nextCenter.x : st.center.x), a.pos.z - (st.nextCenter ? st.nextCenter.z : st.center.z)) > st.nextRadius * 0.9;
  const alive = W.match.aliveCount();
  const endgame = alive <= 10;

  // ── IN-MATCH DIFFICULTY RAMP ─────────────────────────────────────────────
  // Survivors get sharper as the lobby thins, so the last few opponents are the
  // hardest fight of the match — which is what a BR player expects and what this
  // game did NOT deliver (tier was fixed at spawn and never touched think()).
  //
  // Two deliberate constraints:
  //  - CALM-GATED. A bot that gets better while you are shooting at it reads as
  //    cheating, not skill. It only re-tiers when it has not been hit and has not
  //    seen its target for 2.5s.
  //  - CONTINUOUS, not per-storm-phase. Keyed to a smooth p01 so a bot that
  //    fought through three phases catches up gradually instead of jumping three
  //    tiers at once.
  // It moves reaction time and aim error ONLY — never damage, HP or speed. That
  // line is what keeps this "smart" rather than "cheap".
  if (b.ramp) {
    const p01 = K.clamp((50 - alive) / 44, 0, 1);       // saturates at 6 alive
    const calm = W.t - a.lastDamageT > 2.5 && (!bb.target || W.t - bb.targetSeenT > 2.5);
    if (calm) {
      const want = Math.min(5, b.tier0 + b.ramp * p01);
      if (Math.abs(want - (b.tierNow || b.tier0)) > 0.02) {
        b.tierNow = want;
        b.tierK = K.interpTierK(want);
        a.tier = Math.round(want);                       // caps at 5 -> HEAD_CHANCE cap holds
      }
    }
  }
  // "upgraded" = carries a gun that genuinely beats the starter pistol as a
  // GENERAL gun (sim gunScore). It used to be "anything but slot-0 pistol", so a
  // bot that found a common sniper or launcher dropped LOOT from 64 to 35/20 and
  // stopped looting — while ensureGunOut swapped it straight back to the pistol
  // (audit S2). Snipers/launchers are situational: keep looting for a real gun.
  const upgraded = isUpgraded(a);
  // "Do I want to heal" and "can I actually heal" MUST agree, or the machine
  // livelocks: actHeal's failure path sets WANDER with nextThink 0, think()
  // re-scores immediately, HEAL wins again, and the input stays zeroed — the bot
  // stands motionless for the rest of the match. Reproducible case: 78 HP, 20
  // shield, bandages only. s.HEAL fires on (shield < 30 && hp < 80) = true, but
  // useConsumable refuses every bandage because bandage cap is 75 and hp is 78,
  // and there is no shield item to fall back to. So test USABILITY, not mere
  // presence — mirroring useConsumable's own cap checks (player.js).
  const usable = (id) => {
    const c = K.CONSUMABLES[id];
    if (!c) return false;
    return c.heals === "hp" ? a.hp < c.cap : a.shield < c.cap;
  };
  const heals = a.inventory.slots.some((s2) => s2 && s2.kind === "consumable" && s2.count > 0 && usable(s2.id));
  // A bot with NOTHING LEFT TO SHOOT must go find ammo/weapons, not dance
  // around a fight it cannot win (owner: "two bots ran and jumped around
  // because they had no bullets rather than looking for chests").
  const hasFirepower = a.inventory.slots.some((s2) => s2 && s2.kind === "weapon" && slotAmmo(a, s2) > 0);

  // hard overrides
  if (inStorm) { b.state = "ROTATE"; bb.moveTo = { x: st.center.x, z: st.center.z }; return; }
  if (a.healing) { b.state = "HEAL"; return; }

  // utility scores — a VISIBLE enemy is the headline event: fighting beats
  // looting/rotating for every personality (the "runs right past you" tell)
  const s = {};
  const lastFew = alive <= 4;
  // THE EHP RACE (DYEFIELD director.ts:784). Fleeing at <50 EHP regardless of the
  // enemy made a hurt bot run from a target it was about to finish. Break off only
  // when LOSING: low, and the target has clearly more left than we do.
  const myEhp = a.hp + a.shield;
  const tAct = bb.target ? W.actorById.get(bb.target) : null;
  const tEhp = tAct && tAct.alive ? tAct.hp + tAct.shield : 200;
  const outnumbered = myEhp < 50 && tEhp > myEhp + 10;
  const winning = !!tAct && tEhp < myEhp * 0.5 && tEhp < 90;   // press a cracked enemy
  const liveTarget = bb.target && W.t - bb.targetSeenT < 1.2;
  // live sighting = fight — but an un-geared bot ignores DISTANT enemies and
  // keeps looting (a starter-pistol duel at 60m is how the whole lobby
  // gridlocks); anyone close is always fought
  const tRef = bb.targetPos;
  const tDist = tRef ? hyp(tRef.x - a.pos.x, tRef.z - a.pos.z) : 999;
  // (a sniper or AR carrier is geared for a DISTANT fight even when it is not
  // "upgraded" as a general gun — that is the whole point of carrying a sniper)
  const engageBase = liveTarget ? ((!upgraded && !carriesLongGun(a) && tDist > 35) ? 55 : (tDist < 40 ? 88 : 80)) : 42;
  s.ENGAGE = bb.target
    ? (hasFirepower ? engageBase + (a.personality === "rusher" ? 15 : 0) + (endgame ? 20 : 0) + (lastFew ? 25 : 0) + (winning ? 12 : 0) : 8)
    : 0;
  // FLEE used to also require `heals`, so a bot at 15 HP with an empty inventory
  // scored 0 here — the exact case where running is most obviously right — and
  // stood trading against ENGAGE 88 until it died. 72 still loses to a close
  // ENGAGE (88) but beats the 80 mid-range case, so a cracked bot breaks contact
  // instead of dying bravely; with heals in the bag it keeps the old 86.
  s.FLEE = bb.target && outnumbered && !lastFew ? (heals ? 86 : 72) : 0;   // disengage to heal, not to hide forever
  const healOk = heals && !(bb.healBlockedUntil > W.t);
  s.HEAL = (a.hp < 45 || (a.shield < 30 && a.hp < 80)) && healOk && !bb.target ? 75 : (a.hp < 60 && healOk && W.t - a.lastDamageT > 6 ? 45 : 0);
  s.LOOT = !upgraded ? 64 : (W.t < 120 ? 35 : 20) + (a.personality === "loot_goblin" ? 25 : 0);
  // GRAB FIRST. Measured 2026-09-30 (isla_viva 7, deepwood 3): of the pistol kills
  // inside the first 60 s, 10 of 16 were by a pistol-only bot 2-15 s after it
  // landed — beside the gun it had glided onto — that answered an enemy 20-25 m
  // away with the starter pistol instead of taking the two steps to the gun. A
  // player picks the gun up first. So: not geared, a real upgrade within a few
  // steps, nobody close enough to punish the pickup, not being shot right now ->
  // the pickup outranks a fight (ENGAGE 88). Anyone inside 8 m is still fought.
  let grab = null;
  if (!upgraded && hasFirepower && !(liveTarget && tDist < GRAB_CLOSE_M) && W.t - (a.lastDamageT || -99) > 1.0) {
    grab = nearestGun(W, a, bb, GRAB_R);
    if (grab) s.LOOT = Math.max(s.LOOT, 92);
  }
  if (!hasFirepower) {
    /* A dry bot's JOB is to get ammo. The previous pass set LOOT 78 here and
       then FLEE 84 on the very next line, so FLEE won every time a target
       existed — and in a 50-player lobby one almost always does. Measured
       (_harness/botdiag.py): dry bots spent 1066 and 1414 samples in FLEE
       against 81 and 24 in LOOT, and 9 of 16 dry episodes ended in DEATH
       rather than resupply, one after 73.6 s of running around empty.

       Fleeing is how a dry bot survives the next few seconds, not a plan for
       the match. So it only outranks the ammo hunt while the threat is close
       enough to kill it right now; past that the bot goes and gets a gun. */
    s.LOOT = Math.max(s.LOOT, 88);
    if (bb.target && tDist < 18) s.FLEE = Math.max(s.FLEE || 0, 92);
  }
  // BATTLE-ROYALE PRIORITY MODEL (owner: "run from storms but FIGHT once
  // safe"): rotation urgency = how far past safety you are vs time left.
  // Only a genuinely pressing storm outranks a live fight — otherwise bots
  // were sprinting straight past enemies all mid-game.
  let rotScore = 0;
  if (outsideNext) {
    const scx = st.nextCenter ? st.nextCenter.x : st.center.x;
    const scz = st.nextCenter ? st.nextCenter.z : st.center.z;
    const overM = hyp(a.pos.x - scx, a.pos.z - scz) - (st.nextRadius || 0);
    const needS = overM / 8 + 6;                                   // sprint ≈8m/s effective + margin
    const timeLeft = st.phaseState === "closing" ? st.tToNext * 0.5 : st.tToNext;
    rotScore = timeLeft < needS ? 95 : timeLeft < needS * 2 ? 70 : 40;
  }
  s.ROTATE = rotScore;
  s.CAMP = (a.personality === "camper" || a.personality === "sniper") && !outsideNext && !bb.target && !endgame ? 34 : 0;
  // PUSH toward gunfire — but not into it at 30 EHP: a hurt bot that pushes a
  // fight it only heard is feeding it. Healthy aggressors still go.
  s.PUSH = bb.heard && W.t - bb.heard.t < 6 && (a.personality === "rusher" || a.personality === "rotator" || a.personality === "flanker") && !endgame && myEhp >= 90 ? 48 : 0;
  // a landed supply drop is worth crossing the map for, never worth dying for:
  // sits above LOOT/WANDER, below ENGAGE (80-88) and a pressing ROTATE (95).
  // The 0.12/m falloff is what stops a bot 200m out abandoning what it is doing
  // for a crate that whoever was standing next to it has already emptied.
  s.SUPPLY = bb.supply && W.t - bb.supply.t < 90
    ? (a.personality === "loot_goblin" ? 78 : 58) - hyp(a.pos.x - bb.supply.x, a.pos.z - bb.supply.z) * 0.12
    : 0;
  // ENDGAME HUNT (owner playtest: "at some point they just wander around
  // aimlessly doing nothing"): ≤10 alive, nothing visible, safely inside the
  // zone → actively seek the fight instead of pacing random 50m circles.
  s.HUNT = endgame && !bb.target && !outsideNext && upgraded ? 46 : 0;
  s.WANDER = 12;
  s.CLOSEIN = bb.closeInUntil > W.t && tAct && tAct.alive ? 99 : 0;

  // pick best
  let best = "WANDER", bs = -1;
  for (const k in s) if (s[k] > bs) { bs = s[k]; best = k; }
  if (b.state !== best) { b.state = best; onEnter(W, b, best); }
  if (best === "LOOT" && grab && bb.lootId !== grab.id) {
    bb.lootId = grab.id; bb.lootType = "item";
    bb.moveTo = { x: grab.pos.x, z: grab.pos.z, y: grab.pos.y };
  }
}

const GRAB_R = 8, GRAB_CLOSE_M = 8;
/** Nearest ground gun that is a real upgrade over the starter pistol (a primary:
 *  isUpgraded's definition, so a pistol of any rarity is not one) and that the
 *  inventory would take (same predicate give() enforces). */
function nearestGun(W, a, bb, r) {
  if (!W.nearbyLoot) return null;
  const near = W.nearbyLoot(a.pos, r);
  const base = K.gunScore("pistol", 0);
  let best = null, bd = 1e9;
  for (let i = 0; i < near.length; i++) {
    const n = near[i];
    if (n.type !== "item" || n.data.kind !== "weapon" || n.data.id === "pistol") continue;
    if (K.gunScore(n.data.id, n.data.rarity || 0) <= base * 1.001) continue;
    if (bb.badLoot && bb.badLoot[n.id] > W.t) continue;
    if (W.wouldAcceptItem && !W.wouldAcceptItem(a, n.data)) continue;
    if (n.d < bd && !lowCeiling(W, n.pos.x, n.pos.y, n.pos.z)) { bd = n.d; best = n; }
  }
  return best;
}

function perceive(W, b) {
  const a = b.actor, bb = b.bb;
  // current target still valid?
  if (bb.target) {
    const t = W.actorById.get(bb.target);
    if (!t || !t.alive) { bb.target = null; }
  }
  // scan for enemies (vision cone + LOS) — nearest wins; sticky to current
  const eye = eyePos(a, _eye_perceive);
  let best = null, bestD = 1e9;
  for (const t of W.actors) {
    if (t === a || !t.alive) continue;
    if (bb.avoidId === t.id && W.t < (bb.avoidUntil || 0)) continue;   // fatigue cooldown
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const d = hyp(dx, dz);
    if (d > 200) continue;
    // vision: wide ~160° cone; anyone within 15m registers regardless of
    // facing (you notice someone sprinting past you); heard shooters = 360°
    const angTo = Math.atan2(dx, dz);
    let dd = Math.abs(((angTo - Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw))) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    const heardHim = bb.heard && bb.heard.shooterId === t.id && W.t - bb.heard.t < 4;
    if (dd > 1.4 && d > 15 && !heardHim && bb.target !== t.id) continue;
    if (W.map.losBlocked(eye.x, eye.y, eye.z, t.pos.x, t.pos.y + 1.2, t.pos.z)) continue;
    // TARGET VALUE, not just distance (audit S1: bots never read hp/shield). A
    // player judges an enemy by the shield bar and by who is shooting at them:
    //  - a cracked target (low shield+hp) is worth walking a little further for;
    //  - whoever just hit ME is the one to answer, not a bystander at 5 m less.
    // Scored as an effective distance so stickiness keeps working the same way.
    const bias = bb.target === t.id ? 0.6 : 1;   // stickiness
    const ehp = (t.hp || 0) + (t.shield || 0);
    const weak = ehp < 50 ? 0.6 : ehp < 100 ? 0.85 : 1;
    const attacker = a.lastAttacker === t.id && W.t - (a.lastDamageT || -99) < 3 ? 0.6 : 1;
    const sd = d * bias * weak * attacker;
    if (sd < bestD) { bestD = sd; best = t; }
  }
  if (best) {
    if (bb.target !== best.id) { bb.target = best.id; bb.acquireT = W.t; }
    bb.targetSeenT = W.t;
    setTargetPos(bb, best.pos);
  } else if (bb.target && W.t - bb.targetSeenT > 8) {
    bb.target = null;   // memory decay → search last known then give up
  }
}

/** The last-seen target position, rewritten in place: perceive (every think) and
 *  underFire (every frame of a burst) used to allocate a fresh {x,y,z} each time.
 *  Every reader copies the numbers out (moveToward, ensureGunOut, coverStep). */
function setTargetPos(bb, p) {
  const t = bb.targetPos || (bb.targetPos = { x: 0, y: 0, z: 0 });
  t.x = p.x; t.y = p.y; t.z = p.z;
}

function onEnter(W, b, state) {
  const a = b.actor, bb = b.bb;
  const rng = b.rng;
  if (state === "LOOT") {
    let near = W.nearbyLoot(a.pos, 90);
    if (bb.badLoot) {                       // skip what this bot has failed to reach
      const bad = bb.badLoot;
      for (const k in bad) if (bad[k] <= W.t) delete bad[k];
      near = near.filter((n) => !(bad[n.id] > W.t));
    }
    const pick = pickLoot(W, a, near);
    bb.lootId = pick ? pick.id : null;
    bb.lootType = pick ? pick.type : null;
    if (pick) bb.moveTo = { x: pick.pos.x, z: pick.pos.z, y: pick.pos.y };   // y: loot on an upper floor
    else {
      // no loot in reach — head to one of the 3 nearest POIs (random pick, so
      // a bot on a barren POI doesn't orbit it forever)
      const ranked = W.map.pois
        .map((p) => ({ p, d: hyp(p.x - a.pos.x, p.z - a.pos.z) }))
        .filter((e) => e.d > 30)
        .sort((x, y) => x.d - y.d)
        .slice(0, 3);
      const bp = ranked.length ? ranked[Math.floor(rng() * ranked.length)].p : null;
      bb.moveTo = bp ? { x: bp.x + (rng() - 0.5) * bp.r, z: bp.z + (rng() - 0.5) * bp.r } : randNear(W, a, 60, rng);
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
    bb.moveTo = bb.heard ? { x: bb.heard.x, z: bb.heard.z } : randNear(W, a, 60, rng);
  } else if (state === "SUPPLY") {
    bb.moveTo = bb.supply ? { x: bb.supply.x, z: bb.supply.z } : randNear(W, a, 40, rng);
  } else if (state === "CLOSEIN") {
    const t = bb.target && W.actorById.get(bb.target);
    bb.moveTo = t ? { x: t.pos.x, z: t.pos.z } : randNear(W, a, 30, rng);
  } else if (state === "HUNT") {
    // head for the NEAREST living enemy's rough area — ±22m of fuzz makes it a
    // sixth sense for direction, not a wallhack; re-planned every arrival so it
    // tracks a moving lobby. Endgame-only (see the score), where converging is
    // exactly what the shrinking circle forces anyway.
    let nearT = null, nd = 1e9;
    for (const t2 of W.actors) {
      if (t2 === a || !t2.alive) continue;
      const d2 = hyp(t2.pos.x - a.pos.x, t2.pos.z - a.pos.z);
      if (d2 < nd) { nd = d2; nearT = t2; }
    }
    bb.moveTo = nearT
      ? { x: nearT.pos.x + (rng() - 0.5) * 44, z: nearT.pos.z + (rng() - 0.5) * 44 }
      : randNear(W, a, 50, rng);
  } else if (state === "WANDER") {
    bb.moveTo = randNear(W, a, 50, rng);
  } else if (state === "HEAL") {
    startHeal(W, a);
  } else if (state === "FLEE") {
    // run from target — but NEVER flee into the storm: blend the escape vector
    // toward the circle center
    const t = bb.target && W.actorById.get(bb.target);
    if (t) {
      const dx = a.pos.x - t.pos.x, dz = a.pos.z - t.pos.z;
      const d = hyp(dx, dz) || 1;
      let fx = a.pos.x + (dx / d) * 60, fz = a.pos.z + (dz / d) * 60;
      if (W.stormCtl) {
        const st = W.stormCtl.storm.stateAt(W.t);
        const c = st.nextCenter || st.center;
        fx = fx * 0.55 + c.x * 0.45;
        fz = fz * 0.55 + c.z * 0.45;
      }
      bb.moveTo = { x: fx, z: fz };
    } else bb.moveTo = randNear(W, a, 50, rng);
  }
}

/** Carries a PRIMARY it can fight with: a non-pistol gun that beats the common
 *  starter pistol as a general-purpose gun, with at least half a magazine on hand.
 *  Two holes measured 2026-10-01 (6 storm-on matches, wdiag): an uncommon pistol
 *  (gunScore 153 > 133) counted as "upgraded", so a bot that found one dropped
 *  LOOT from 64 to 35/20 and fought the match with a sidearm; and an EMPTY rifle
 *  counted too, so a bot with a dry AR and a loaded pistol never went looking for
 *  rifle ammo (15% of the "better gun carried, pistol held" samples were a dry
 *  better gun). A pistol is a sidearm at any rarity; a gun with nothing in it is
 *  not an upgrade. */
function isUpgraded(a) {
  const base = K.gunScore("pistol", 0);
  const sl = a.inventory.slots;
  for (let i = 0; i < sl.length; i++) {
    const s2 = sl[i];
    if (s2 && s2.kind === "weapon" && s2.id !== "pistol" && K.gunScore(s2.id, s2.rarity || 0) > base * 1.001 &&
        !lowOnAmmo(a, s2, 0.5)) return true;
  }
  return false;
}
/** Fewer rounds on hand (mag + matching reserve) than `frac` of a magazine. */
function lowOnAmmo(a, s, frac) {
  const def = K.WEAPONS[s.id];
  return !def || slotAmmo(a, s) < Math.max(1, def.mag * frac);
}
/** Does this ammo type feed a carried primary that is short of a full magazine?
 *  Ammo for it is a NEED, not filler: without it the primary stays in the bag and
 *  the bot fights with the pistol (measured: rifles carried with 0-4 rounds). */
function feedsStarvingPrimary(a, ammoId) {
  const sl = a.inventory.slots;
  for (let i = 0; i < sl.length; i++) {
    const s2 = sl[i];
    if (!s2 || s2.kind !== "weapon" || s2.id === "pistol") continue;
    const def = K.WEAPONS[s2.id];
    if (def && def.ammo === ammoId && lowOnAmmo(a, s2, 1)) return true;
  }
  return false;
}

function pickLoot(W, a, near) {
  const upgraded = isUpgraded(a);
  // out of ammo everywhere → ammo boxes and chests ARE the priority
  const dry = !a.inventory.slots.some((s) => s && s.kind === "weapon" && slotAmmo(a, s) > 0);
  let best = null, bs = -1;
  for (const n of near) {
    let score = 0;
    // Skip anything give() would refuse. Without this a bot at the gun cap kept
    // re-selecting the same weapon, walking to it, being refused, and re-planning
    // to it again — a twitch loop in the open, next to loot it could not take.
    if (n.type === "item" && W.wouldAcceptItem && !W.wouldAcceptItem(a, n.data)) continue;
    if (n.type === "chest") score = dry ? 82 : (upgraded ? 55 : 72);
    else if (n.data.kind === "weapon") {
      score = dry ? 76 + n.data.rarity * 4 : (upgraded ? 30 + n.data.rarity * 8 : 66 + n.data.rarity * 6);
      // a copy of a gun already carried at the same or better rarity adds nothing
      // (a second common pistol was scored 66 — a walk across the POI for nothing)
      if (!dry && carriesAtLeast(a, n.data.id, n.data.rarity || 0)) score = 12;
    }
    else if (n.data.kind === "consumable") score = n.data.id.includes("shield") ? 45 : 34;
    else if (n.data.kind === "ammo") score = dry ? 80 : (feedsStarvingPrimary(a, n.data.id) ? 70 : 38);
    score -= n.d * 0.4;
    if (score > bs && !lowCeiling(W, n.pos.x, n.pos.y, n.pos.z) && !offShore(W, a, n.pos)) { bs = score; best = n; }   // (only a would-be winner pays for the probes)
  }
  return best;
}

/** Loot under a ceiling lower than a standing actor is a TRAP, not a target: the
 *  actor that walks in under it cannot walk out (player.js blockedHoriz refuses
 *  every direction while the capsule overlaps the slab). Measured 2026-09-30 on
 *  isla_viva: terrain rising inside a two-storey house leaves 1.4-1.7 m under the
 *  first-floor slab; a bot pinned there died, its death drop landed there, and the
 *  next bot that came for the drop was pinned too (two to three bots per match at
 *  the same spot, 200+ s each). */
function lowCeiling(W, x, y, z) {
  const s = supportAt(W, x, z, y + 0.3);
  const cols = W.map.queryColliders(x, z, 0.5);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.dead || c.kind === "ramp") continue;
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (c.minY > s + 0.3 && c.minY < s + K.PLAYERK.height + 0.05) return true;
  }
  return false;
}

/** Loot on a deck or hull standing in DEEP water, seen from another level: a
 *  swimmer can only haul out onto a ledge at chest height (player.js), so a chest
 *  on the shipwreck or a pier is a dead end from the water, and from the beach it
 *  is usually a swim to the same dead end. Measured 2026-09-30: bots swimming
 *  against the isla_viva shipwreck hull and pier for 60-200 s. */
function offShore(W, a, p) {
  if (W.map.heightAt(p.x, p.z) >= W.map.waterY - NAV_SWIM_DEPTH) return false;
  return Math.abs(p.y - a.pos.y) > 1.2;
}

function carriesAtLeast(a, id, rarity) {
  const sl = a.inventory.slots;
  for (let i = 0; i < sl.length; i++) { const s2 = sl[i]; if (s2 && s2.kind === "weapon" && s2.id === id && (s2.rarity || 0) >= rarity) return true; }
  return false;
}
function carriesLongGun(a) {
  const sl = a.inventory.slots;
  for (let i = 0; i < sl.length; i++) {
    const s2 = sl[i];
    // half a magazine, like isUpgraded: a rifle with 4 rounds left is not what
    // makes a 100 m fight worth starting (measured: bots with "ar:1:4"-style
    // loadouts opened 70-140 m fights, drew the pistol when the rifle ran dry and
    // stayed in them instead of looting rifle ammo)
    if (s2 && s2.kind === "weapon" && (s2.id === "sniper" || s2.id === "ar") && !lowOnAmmo(a, s2, 0.5)) return true;
  }
  return false;
}

function randNear(W, a, r, rng) {
  const R = rng || (a.brain && a.brain.rng);
  for (let i = 0; i < 8; i++) {
    const x = a.pos.x + (R() - 0.5) * 2 * r;
    const z = a.pos.z + (R() - 0.5) * 2 * r;
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
/** Launch angle for an ARCING weapon, matching how weapons.js actually fires it:
 *  vx = cos(p)*speed, vy = sin(p)*speed + 3 (the launch boost), gravity -18.
 *  A textbook ballistic formula gets this wrong because of that +3 — solving
 *  without it overshot by ~8 m at every range (measured against the game's own
 *  integration). Bisect instead, on a CLOSED-FORM range so there is no
 *  integration loop: t = (vy + sqrt(vy^2 - 2*g*dy)) / g, range = vx * t. */
function arcPitch(wdef, dHoriz, dy) {
  const v = wdef.speed || 26, g = 18, boost = 3;
  const rangeAt = (p) => {
    const vx = Math.cos(p) * v, vy = Math.sin(p) * v + boost;
    const disc = vy * vy - 2 * g * dy;
    if (disc < 0) return -1;                       // never reaches that height
    return vx * ((vy + Math.sqrt(disc)) / g);
  };
  let lo = 0, hi = 1.35;                           // 0 to ~77 degrees
  if (rangeAt(hi) < dHoriz && rangeAt(0.7) < dHoriz) return 0.7;   // out of reach: max lob
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (rangeAt(mid) < dHoriz) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const _v = new THREE.Vector3();
function act(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  if (a.emoting) { inp.mx = 0; inp.mz = 0; inp.fire = false; return; }   // let the taunt play
  // crouch joins the per-frame reset: the states below only ever set it TRUE,
  // so without a clear here a bot that crouched once at a camp spot would stay
  // crouched — and at CROUCH.speedMult 0.45 — for the rest of the match.
  inp.mx = 0; inp.mz = 0; inp.sprint = false; inp.fire = false; inp.ads = false; inp.crouch = false;

  if (a.gliding) {
    // steer toward drop target, dive (sprint) when above it
    const t = bb.dropTarget || { x: 0, z: 0 };
    steerYaw(a, Math.atan2(-(t.x - a.pos.x), -(t.z - a.pos.z)), dt, 3);
    inp.mz = 1;
    const d = hyp(t.x - a.pos.x, t.z - a.pos.z);
    inp.sprint = d < 60; // dive
    return;
  }

  // Stuck detection. This used to sit HERE, testing `inp.mz || inp.mx` — the
  // values zeroed 13 lines above, because the switch that sets them runs below.
  // The && could never hold, so stuckT never accumulated and a bot that walked
  // into a wall ground against it for the rest of the match. Now evaluated
  // AFTER the state has expressed its movement intent (see below).
  const _wasStuckPos = _v.copy(bb.lastPos);
  bb.lastPos.copy(a.pos);

  // Being shot outranks whatever the brain had planned. This may flip b.state to
  // ENGAGE, so it runs BEFORE the dispatch below and the fight starts this frame.
  const answering = underFire(W, b, dt);

  switch (b.state) {
    case "ENGAGE": actEngage(W, b, dt); break;
    case "FLEE": actMove(W, b, dt, true); fireOnTheMove(W, b, dt); break;
    case "HEAL": actHeal(W, b, dt); break;
    case "LOOT": actLoot(W, b, dt); break;
    case "SUPPLY": actSupply(W, b, dt); fireOnTheMove(W, b, dt); break;
    case "ROTATE": case "PUSH": case "WANDER": actMove(W, b, dt, b.state === "ROTATE"); fireOnTheMove(W, b, dt); break;
    case "HUNT": actMove(W, b, dt, true); fireOnTheMove(W, b, dt); break;
    case "CLOSEIN": actMove(W, b, dt, true); fireOnTheMove(W, b, dt); break;
    case "CAMP": actCamp(W, b, dt); break;
  }

  // now inp.mx / inp.mz carry this frame's intent: barely moved while TRYING to
  // move => stuck
  if (_wasStuckPos.distanceToSquared(a.pos) < 0.02 * 0.02 && (inp.mz || inp.mx)) bb.stuckT += dt;
  else bb.stuckT = 0;

  // HARD BREAKER (audit S7: one bot sat in a Coco Village corner for 329 s while
  // every softer recovery kept firing). A bot that has meant to be travelling but
  // stayed inside the same 2 m for 12 s abandons its goal and walks OUT: the
  // nearest reachable open-sky ground (via the stairs, the door, or a drop), found
  // at its own floor height. Fights, camps, heals and chest channels are exempt:
  // standing still is their job.
  if (MOVING_STATES[b.state] && !bb.chestId && !a.healing && !a.emoting) {
    if (!bb.anchor || hyp(a.pos.x - bb.anchor.x, a.pos.z - bb.anchor.z) > 2) {
      if (!bb.anchor) bb.anchor = { x: 0, z: 0 };
      bb.anchor.x = a.pos.x; bb.anchor.z = a.pos.z; bb.anchorT = W.t;
    } else if (W.t - bb.anchorT > 12) {
      breakOut(W, b);
      bb.anchor.x = a.pos.x; bb.anchor.z = a.pos.z; bb.anchorT = W.t;
    }
  } else if (bb.anchor) { bb.anchorT = W.t; bb.anchor.x = a.pos.x; bb.anchor.z = a.pos.z; }

  // suppression reflex: shot recently by someone unseen → sprint to lateral
  // cover instead of standing there soaking damage
  if (!answering && W.t - a.lastDamageT < 0.9 && W.t >= (bb.coverReflexUntil || 0) && b.state !== "ENGAGE") {
    const att = a.lastAttacker && W.actorById.get(a.lastAttacker);
    if (att) {
      const ang = Math.atan2(a.pos.x - att.pos.x, a.pos.z - att.pos.z) + (b.rng() < 0.5 ? 1 : -1) * 1.2;
      bb.moveTo = { x: a.pos.x + Math.sin(ang) * 18, z: a.pos.z + Math.cos(ang) * 18 };
      // sim-time gate (was a wall-clock setTimeout → broke synchronous fastForward
      // determinism: the macrotask never drained mid-soak so the reflex stuck on).
      bb.coverReflexUntil = W.t + 1.5;
    }
  }
}

const MOVING_STATES = { LOOT: 1, ROTATE: 1, PUSH: 1, WANDER: 1, HUNT: 1, FLEE: 1, SUPPLY: 1, CLOSEIN: 1 };
function breakOut(W, b) {
  const a = b.actor, bb = b.bb;
  bb.breaks = (bb.breaks || 0) + 1;
  if (bb.lootId) {
    if (!bb.badLoot) bb.badLoot = {};
    bb.badLoot[bb.lootId] = W.t + 60;
    bb.lootId = null;
  }
  const ex = findExit(W, a.pos.x, a.pos.y, a.pos.z, 6);
  if (ex && ex.length) {
    const last = ex[ex.length - 1];
    bb.path = ex; bb.pathGoal = { x: last.x, z: last.z };
    bb.moveTo = { x: last.x, z: last.z };
    bb.nextPathT = W.t + 2.5;
  } else {
    bb.path = null; bb.pathGoal = null;
    bb.moveTo = randNear(W, a, 40, b.rng);
  }
  bb.progGoal = null; bb.stuckT = 0;
}

/** UNDER FIRE (owner 2026-09-15: "make sure enemies can spot where attacks are
 *  coming from and fight in that direction"). A hit is itself a sighting: the
 *  bot freezes the bearing the shot came from, whips round to face it, and — if
 *  it can actually answer — commits to the fight instead of trotting away while
 *  being shot in the back. It does NOT live-track an unseen shooter: the bearing
 *  is snapshotted at the moment of the hit, so moving after you fire still jukes
 *  it, exactly like a player who only saw your muzzle flash. Turn speed scales
 *  with tier, so a tier-1 is visibly slower to react than a tier-5.
 *  Returns true when the bot is answering; false means it cannot, and the
 *  break-for-cover reflex in act() takes over. */
function underFire(W, b, dt) {
  const a = b.actor, bb = b.bb;
  if (W.t - a.lastDamageT > 1.6) return false;
  const att = a.lastAttacker && W.actorById.get(a.lastAttacker);
  if (!att || !att.alive || att === a) return false;
  // freeze the bearing on the first frame of this burst
  if (bb.threatFor !== a.lastAttacker || (W.t - (bb.threatT || -99)) > 2.5) {
    bb.threatFor = a.lastAttacker;
    bb.threatT = W.t;
    if (!bb.threatAt) bb.threatAt = { x: 0, z: 0 };
    bb.threatAt.x = att.pos.x; bb.threatAt.z = att.pos.z;
  }
  const tp = bb.threatAt;
  steerYaw(a, Math.atan2(-(tp.x - a.pos.x), -(tp.z - a.pos.z)), dt, 4 + (a.tier || 3) * 1.6);
  // can this actually be answered — gun, ammo, reach, and a clear line?
  const slot = a.inventory.slots[a.inventory.active];
  const def = K.WEAPONS[a.weapon && a.weapon.id];
  if (!def || !slot || slotAmmo(a, slot) <= 0) return false;
  const dist = hyp(att.pos.x - a.pos.x, att.pos.z - a.pos.z);
  if (dist > (def.falloff ? def.falloff[1] * 1.2 : 40)) return false;
  const eye = eyePos(a, _eye_underFire);
  if (W.map.losBlocked(eye.x, eye.y, eye.z, att.pos.x, att.pos.y + 1.2, att.pos.z)) return false;
  // answer it. Clearing avoidId matters: fight-fatigue may have just blacklisted
  // this very actor, which would otherwise make the bot ignore the man shooting it.
  if (bb.avoidId === att.id) { bb.avoidId = null; bb.avoidUntil = 0; }
  if (bb.target !== att.id) { bb.target = att.id; bb.acquireT = W.t; bb.fightT = 0; }
  bb.targetSeenT = W.t;
  setTargetPos(bb, att.pos);
  if (b.state !== "ENGAGE") { b.state = "ENGAGE"; b.nextThink = 0; }
  return true;
}

function steerYaw(a, want, dt, speed) {
  let d = want - a.input.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  a.input.yaw += d * Math.min(1, dt * (speed || 6));
}

/** Does a collider WALL block the walk band at (x,z) for someone at height y?
 *  NOT supportAt: that returns walkable surfaces at-or-below y+STEP_UP by
 *  definition, so "supportAt > y+2.2" was mathematically impossible and the
 *  old probe NEVER fired (found by scanning a whole map for hits: zero).
 *  A wall blocks when its box spans the hop-to-headroom band. Ramps are
 *  walkable by design and never block. */
function obstacleAt(W, x, z, y) {
  const cols = W.map.queryColliders(x, z, 0.6);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.kind === "ramp") continue;
    if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
    if (c.minY < y + 2.0 && c.maxY > y + 0.55) return true;
  }
  return false;
}

/** Is a wall too tall to hop blocking the path `look` metres along `yaw`?
 *  Probed at the floor height the bot would have THERE, not at its
 *  current feet: walking up a slope under a slab, the head meets the slab only
 *  further on, and the old same-height probe never saw it. Measured 2026-09-30:
 *  bots walked uphill inside an isla_viva house until the 2nd-floor slab pinned
 *  them (blockedHoriz then refuses every direction) for 200+ s. */
function wallAhead(W, a, yaw, look) {
  const px = a.pos.x - Math.sin(yaw) * look, pz = a.pos.z - Math.cos(yaw) * look;
  return obstacleAt(W, px, pz, Math.max(a.pos.y, supportAt(W, px, pz, a.pos.y)));
}

// ── PATHFINDING — layered A* over a BOT-CENTRED, FLOOR-AWARE walk grid ──────
// Industry-standard fallback for when straight-line steering is defeated: an
// 8-connected A* (no corner cutting) then string-pulled so bots walk smooth
// diagonals, not grid staircases. Computed only when the wall probe or the stuck
// detector says the direct line failed, at most once per bot per 2.5 s.
//
// Rebuilt 2026-09 against two measured faults (audit bots-match S4/S7, M1/M5):
//  1. The window was centred on the start->goal MIDPOINT and capped at ~63 m, so
//     for any goal > 63 m away the bot's own cell was clamped onto the window
//     edge and the path began somewhere else entirely: 0/30 usable paths at
//     >= 120 m on every map, and 65% of live isla_viva path samples had a first
//     leg through a blocked cell. The window is now centred on the BOT, and a far
//     goal is clamped to the window edge as an intermediate waypoint.
//  2. Every cell was judged at TERRAIN height, so a bot on a second floor saw
//     open ground below its walls: slot s21 sat in a Coco Village corner for
//     329 s. Cells are now judged at the height the bot would actually be
//     standing at, found by walking there: each edge is marched in ~0.5 m steps
//     with the same support rule player.js uses (highest surface at or below
//     feet + STEP_UP, terrain always counts), walls are tested in the walk band
//     at THAT height, and a cell can hold up to three stacked floors (layers).
//     Drops are legal edges (this game has no fall damage: hardLand is audio and
//     camera only) but cost extra, so stairs win when both exist; drops over
//     6 m and open water are blocked.
// All search state lives in pooled typed arrays validated by a per-search stamp
// (nothing is cleared or allocated per call) with a binary heap for the open set;
// the window's colliders are fetched with ONE query and bucketed per cell.
const CELL = 1.5, GRID_R = 21;           // 43 x 43 cells = a ~64 m window around the bot
const NAV_N = GRID_R * 2 + 1;
const NAV_CELLS = NAV_N * NAV_N;
const NAV_L = 3;                          // stacked floors per cell
const NAV_NODES = NAV_CELLS * NAV_L;
const NAV_STEP_UP = 0.55;                 // player.js STEP_UP
const NAV_RAMP_EXTRA = 0.45;              // a ramp may rise faster than a step per 0.5 m sub-step
const NAV_DROP_MAX = 6.0;
const NAV_DROP_COST = 2.0;
const NAV_LAYER_EPS = 1.0;
const NAV_MAX_EXPAND = 2600;
const NAV_BUCKET_M = CELL * 0.5 + 0.3 + 0.01;   // cell half-size + obstacle margin
const navH = new Float32Array(NAV_NODES);
const navG = new Float32Array(NAV_NODES);
const navFrom = new Int32Array(NAV_NODES);
const navSeen = new Int32Array(NAV_NODES);
const navClosed = new Int32Array(NAV_NODES);
const navTerr = new Float32Array(NAV_CELLS);
const navTerrSeen = new Int32Array(NAV_CELLS);
const navBStart = new Int32Array(NAV_CELLS + 1);
const navBFill = new Int32Array(NAV_CELLS);
let navBItems = new Int32Array(16384);
const navCols = [];
let navStamp = 0;
let navOX = 0, navOZ = 0;                 // world position of the window centre cell
let heapIds = new Int32Array(8192), heapF = new Float64Array(8192), heapN = 0;
const NAV_DX = [1, -1, 0, 0, 1, 1, -1, -1], NAV_DZ = [0, 0, 1, -1, 1, -1, 1, -1];

function heapPush(id, f) {
  if (heapN >= heapIds.length) {
    const ni = new Int32Array(heapIds.length * 2); ni.set(heapIds); heapIds = ni;
    const nf = new Float64Array(heapF.length * 2); nf.set(heapF); heapF = nf;
  }
  let i = heapN++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= f) break;
    heapIds[i] = heapIds[p]; heapF[i] = heapF[p]; i = p;
  }
  heapIds[i] = id; heapF[i] = f;
}
function heapPop() {
  const top = heapIds[0];
  const lastId = heapIds[--heapN], lastF = heapF[heapN];
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= heapN) break;
    if (c + 1 < heapN && heapF[c + 1] < heapF[c]) c++;
    if (heapF[c] >= lastF) break;
    heapIds[i] = heapIds[c]; heapF[i] = heapF[c]; i = c;
  }
  if (heapN > 0) { heapIds[i] = lastId; heapF[i] = lastF; }
  return top;
}

// ALLOCATION: these helpers run ~10^5 times per search. A double RETURNED from a
// non-inlined function, or written to a module-level `let`, is boxed as a fresh
// HeapNumber; framecheck's heap sampling put navWalk/navTerrPt/navSearch at
// ~130 KB per match frame (2026-09-30). So doubles cross function boundaries
// through this typed scratch instead (typed-array stores are unboxed):
//   NF[0] navSupport result · NF[1] metres dropped · NF[2] metres wet · NF[3] walk end height
//   NF[4..6] navSupport/navWall inputs x, z, yTop · NF[8..12] navWalk inputs x0, z0, h0, x1, z1
// (double ARGUMENTS to a non-inlined call are boxed too, hence the input slots)
const NF = new Float64Array(16);
/** Terrain height at a cell centre, cached for this search (read navTerr[ci] after). */
function navTerrEnsure(W, ci) {
  if (navTerrSeen[ci] !== navStamp) {
    navTerrSeen[ci] = navStamp;
    const ix = ci % NAV_N, iz = (ci - ix) / NAV_N;
    navTerr[ci] = W.map.heightAt(navOX + (ix - GRID_R) * CELL, navOZ + (iz - GRID_R) * CELL);
  }
}
function navCellOf(x, z) {
  const ix = Math.round((x - navOX) / CELL) + GRID_R, iz = Math.round((z - navOZ) / CELL) + GRID_R;
  if (ix < 0 || iz < 0 || ix >= NAV_N || iz >= NAV_N) return -1;
  return iz * NAV_N + ix;
}
/** Fetch the window's colliders once and bucket them per cell (counting sort). */
function navPrepare(W, cx, cz) {
  navStamp++;
  navOX = cx; navOZ = cz;
  const got = W.map.queryColliders(cx, cz, GRID_R * CELL + NAV_BUCKET_M + 1, navCols);
  // a maps.js without the out-param returns a fresh array: adopt it
  if (got !== navCols) { navCols.length = 0; for (let i = 0; i < got.length; i++) navCols.push(got[i]); }
  navBStart.fill(0);
  const lo = (v, o) => Math.max(0, Math.ceil((v - NAV_BUCKET_M - o) / CELL) + GRID_R);
  const hi = (v, o) => Math.min(NAV_N - 1, Math.floor((v + NAV_BUCKET_M - o) / CELL) + GRID_R);
  let total = 0;
  for (let k = 0; k < navCols.length; k++) {
    const c = navCols[k];
    const x0 = lo(c.minX, cx), x1 = hi(c.maxX, cx), z0 = lo(c.minZ, cz), z1 = hi(c.maxZ, cz);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) { navBStart[iz * NAV_N + ix + 1]++; total++; }
  }
  for (let i = 1; i <= NAV_CELLS; i++) navBStart[i] += navBStart[i - 1];
  if (total > navBItems.length) navBItems = new Int32Array(total * 2);
  navBFill.set(navBStart.subarray(0, NAV_CELLS));
  for (let k = 0; k < navCols.length; k++) {
    const c = navCols[k];
    const x0 = lo(c.minX, cx), x1 = hi(c.maxX, cx), z0 = lo(c.minZ, cz), z1 = hi(c.maxZ, cz);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) navBItems[navBFill[iz * NAV_N + ix]++] = k;
  }
}
/** Highest standable surface at (x,z) no higher than yTop (+ramp allowance);
 *  terrain always counts, exactly like player.js supportAt. Over DEEP water
 *  (player.js: terrain more than swimDepth under the surface) the support is the
 *  swim surface (feet at waterY - 0.55, where player.js pins a swimmer) and
 *  navSwim is set; shallow water sets navWet (wading is slow).
 *  Water used to be NaN = impassable, which left a bot that had landed or fallen
 *  in the sea with NO path at all: measured 2026-09-30, bots swimming against a
 *  pier or the shipwreck hull for 200+ s while every recovery returned null. */
let navSwim = false, navWetPt = false;
function navSupport(W, ci) {
  const x = NF[4], z = NF[5], yTop = NF[6];
  // bilinear terrain between the four cell centres around (x,z)
  const fx = (x - navOX) / CELL + GRID_R, fz = (z - navOZ) / CELL + GRID_R;
  let ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0) ix = 0; if (iz < 0) iz = 0;
  if (ix > NAV_N - 2) ix = NAV_N - 2; if (iz > NAV_N - 2) iz = NAV_N - 2;
  const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
  const c0 = iz * NAV_N + ix;
  navTerrEnsure(W, c0); navTerrEnsure(W, c0 + 1); navTerrEnsure(W, c0 + NAV_N); navTerrEnsure(W, c0 + NAV_N + 1);
  const terr = (navTerr[c0] * (1 - tx) + navTerr[c0 + 1] * tx) * (1 - tz) + (navTerr[c0 + NAV_N] * (1 - tx) + navTerr[c0 + NAV_N + 1] * tx) * tz;
  let s = terr, onCol = false;
  for (let k = navBStart[ci], e = navBStart[ci + 1]; k < e; k++) {
    const c = navCols[navBItems[k]];
    if (c.dead) continue;
    if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
    let top;
    if (c.kind === "ramp") {
      // sim rampTopAt, inlined: the search calls this per 0.5 m step per ramp, and a
      // call with number arguments boxes them (the hottest garbage site in a search)
      let f;
      if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
      else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
      top = c.minY + (c.maxY - c.minY) * (f < 0 ? 0 : f > 1 ? 1 : f);
      if (top > yTop + NAV_RAMP_EXTRA) continue;
    }
    else { top = c.maxY; if (top > yTop) continue; }
    if (top > s) { s = top; onCol = true; }
  }
  navSwim = false; navWetPt = false;
  const wy = W.map.waterY;
  if (!onCol || s < wy - NAV_SWIM_DEPTH) {
    if (terr < wy - NAV_SWIM_DEPTH) { navSwim = true; navWetPt = true; NF[0] = wy - 0.55; return; }
    if (terr < wy + 0.25) navWetPt = true;
  }
  NF[0] = s;
}
const NAV_SWIM_DEPTH = 1.1;               // sim PLAYERK.swimDepth
const NAV_SWIM_UP = 0.9;                  // player.js haul-out: a ledge up to chest height (+0.9)
const NAV_WET_COST = 1.5;                 // per cell of water: swimming/wading is slow
/** A wall in the walk band (knee to head) at feet height h. Ramps never block. */
function navWall(ci) {
  const x = NF[4], z = NF[5], h = NF[0];
  for (let k = navBStart[ci], e = navBStart[ci + 1]; k < e; k++) {
    const c = navCols[navBItems[k]];
    if (c.dead || c.kind === "ramp") continue;
    if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
    if (c.minY < h + 2.0 && c.maxY > h + 0.55) return true;
  }
  return false;
}
/** Walk a straight line from (x0,z0) standing at h0. Returns false when a wall,
 *  a too-deep drop or the window edge stops it; on true the feet height at the
 *  end is NF[3], metres dropped NF[1] (for the cost), metres in water NF[2]. */
function navWalk(W) {
  const x0 = NF[8], z0 = NF[9], h0 = NF[10], x1 = NF[11], z1 = NF[12];
  const dx = x1 - x0, dz = z1 - z0;
  const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / 0.5));
  let h = h0;
  let swim = h0 < W.map.waterY - 0.4;               // starting afloat
  let drop = 0, wet = 0;
  const stepM = Math.sqrt(dx * dx + dz * dz) / n;
  for (let k = 1; k <= n; k++) {
    const f = k / n, x = x0 + dx * f, z = z0 + dz * f;
    const cix = Math.round((x - navOX) / CELL) + GRID_R, ciz = Math.round((z - navOZ) / CELL) + GRID_R;
    if (cix < 0 || ciz < 0 || cix >= NAV_N || ciz >= NAV_N) return false;
    const ci = ciz * NAV_N + cix;
    NF[4] = x; NF[5] = z; NF[6] = h + (swim ? NAV_SWIM_UP : NAV_STEP_UP);
    navSupport(W, ci);
    const s = NF[0];
    if (h - s > NAV_DROP_MAX) return false;
    if (navWall(ci)) return false;
    if (s < h && !navSwim) drop += h - s;
    if (navWetPt) wet += stepM;
    swim = navSwim;
    h = s;
  }
  NF[1] = drop; NF[2] = wet; NF[3] = h;
  return true;
}
/** Node for cell ci at height h (a matching layer, or a free one), or -1. */
function navNodeAt(ci, h) {
  const base = ci * NAV_L;
  for (let l = 0; l < NAV_L; l++) {
    const id = base + l;
    if (navSeen[id] !== navStamp) {
      navSeen[id] = navStamp; navH[id] = h; navG[id] = Infinity; navFrom[id] = -1;
      return id;
    }
    if (Math.abs(navH[id] - h) < NAV_LAYER_EPS) return id;
  }
  return -1;
}
function navCellX(ci) { return navOX + ((ci % NAV_N) - GRID_R) * CELL; }
function navCellZ(ci) { return navOZ + (Math.floor(ci / NAV_N) - GRID_R) * CELL; }
function navOct(ci, tci) {
  const ax = Math.abs((ci % NAV_N) - (tci % NAV_N)), az = Math.abs(Math.floor(ci / NAV_N) - Math.floor(tci / NAV_N));
  return ax > az ? ax + 0.41421356 * az : az + 0.41421356 * ax;
}
/**
 * Core search. mode 0 = path to (tx,tz[,ty]); mode 1 = nearest "exit" (standing
 * on open ground, not under a roof, >= minDist from the start). Returns an array
 * of {x, z, y} waypoints (string-pulled), or null. A far goal is clamped to the
 * window edge. When the goal cannot be reached, the path to the closed node that
 * got nearest to it is returned if that is real progress (>= 3 cells closer).
 */
function navSearch(W, sx, sy, sz, tx, tz, ty, mode, minDist, off) {
  // `off` shifts the whole grid by a fraction of a cell (the bot stays inside the
  // centre cell). See findPath: a 1.5 m grid with the 0.3 m wall margin leaves a
  // 1.4 m doorway an 0.8 m free band, which a grid row hits only about half the
  // time; the half-cell-shifted retry always has a row inside it.
  const o = off || 0;
  navPrepare(W, sx + o, sz + o);
  const S = GRID_R * NAV_N + GRID_R;
  const sc = navCellOf(sx, sz);
  NF[4] = sx; NF[5] = sz; NF[6] = sy + NAV_STEP_UP;
  navSupport(W, sc < 0 ? S : sc);
  let sh = NF[0];
  if (o) {
    // walk from the feet to the centre cell first; if that is walled, no search
    NF[8] = sx; NF[9] = sz; NF[10] = sh; NF[11] = navCellX(S); NF[12] = navCellZ(S);
    if (!navWalk(W)) return null;
    sh = NF[3];
  }
  // goal cell: clamp a far goal onto the window edge along the line to it
  let T = -1, clamped = false;
  if (mode === 0) {
    let gx = tx - sx, gz = tz - sz;
    const m = Math.max(Math.abs(gx), Math.abs(gz)) / CELL;
    if (m > GRID_R - 1) { const k = (GRID_R - 1) / m; gx *= k; gz *= k; clamped = true; }
    T = navCellOf(sx + gx, sz + gz);
    if (T < 0) return null;
  }
  const useTy = mode === 0 && !clamped && ty != null;
  heapN = 0;
  const s = navNodeAt(S, sh);
  navG[s] = 0;
  heapPush(s, mode === 0 ? navOct(S, T) : 0);
  let found = -1, bestId = s, bestH = mode === 0 ? navOct(S, T) : 0, expanded = 0;
  const minD2 = (minDist || 0) * (minDist || 0);
  while (heapN > 0 && expanded < NAV_MAX_EXPAND) {
    const id = heapPop();
    if (navClosed[id] === navStamp) continue;
    navClosed[id] = navStamp;
    expanded++;
    const ci = (id / NAV_L) | 0;
    const h = navH[id];
    if (mode === 0) {
      if (ci === T && (!useTy || Math.abs(h - ty) < 1.8)) { found = id; break; }
      const hh = navOct(ci, T);
      if (hh < bestH) { bestH = hh; bestId = id; }
    } else if (id !== s) {
      const x = navCellX(ci), z = navCellZ(ci);
      const ddx = x - sx, ddz = z - sz;
      if (ddx * ddx + ddz * ddz >= minD2 && (navTerrEnsure(W, ci), Math.abs(h - navTerr[ci]) < 0.35) && !navRoofed(x, z, h, ci)) { found = id; break; }
    }
    const x0 = navCellX(ci), z0 = navCellZ(ci), ix = ci % NAV_N, iz = (ci - ix) / NAV_N;
    for (let d = 0; d < 8; d++) {
      const nx = ix + NAV_DX[d], nz = iz + NAV_DZ[d];
      if (nx < 0 || nz < 0 || nx >= NAV_N || nz >= NAV_N) continue;
      const cj = nz * NAV_N + nx;
      const x1 = navCellX(cj), z1 = navCellZ(cj);
      // no corner cutting on diagonals: both orthogonal neighbours must be walkable
      NF[8] = x0; NF[9] = z0; NF[10] = h;
      if (d >= 4) {
        NF[11] = x1; NF[12] = z0; if (!navWalk(W)) continue;
        NF[11] = x0; NF[12] = z1; if (!navWalk(W)) continue;
      }
      NF[11] = x1; NF[12] = z1;
      if (!navWalk(W)) continue;    // (last: NF[1..3] are this edge's)
      const h1 = NF[3], edgeDrop = NF[1], edgeWet = NF[2];
      const nid = navNodeAt(cj, h1);
      if (nid < 0 || navClosed[nid] === navStamp) continue;
      const ng = navG[id] + (d >= 4 ? 1.41421356 : 1) + (edgeDrop > 1.2 ? NAV_DROP_COST : 0) + (edgeWet / CELL) * NAV_WET_COST;
      if (ng < navG[nid]) {
        navG[nid] = ng; navFrom[nid] = id;
        heapPush(nid, ng + (mode === 0 ? navOct(cj, T) : 0));
      }
    }
  }
  let end = found;
  if (end < 0) {
    if (mode !== 0) return null;
    // partial: only if it is real progress toward the goal
    if (bestId === s || navOct(S, T) - bestH < 3) return null;
    end = bestId;
  }
  // reconstruct (end -> start), then string-pull from the bot's feet
  const raw = [];
  for (let id = end; id >= 0 && id !== s; id = navFrom[id]) {
    const ci = (id / NAV_L) | 0;
    raw.push({ x: navCellX(ci), z: navCellZ(ci), y: navH[id] });
  }
  raw.reverse();
  if (!raw.length) return null;
  const pulled = [];
  let ax = sx, az = sz, ah = sh;
  for (let i = 0; i < raw.length; i++) {
    const nxt = raw[i + 1];
    if (!nxt) { pulled.push(raw[i]); break; }
    NF[8] = ax; NF[9] = az; NF[10] = ah; NF[11] = nxt.x; NF[12] = nxt.z;
    const ok = navWalk(W);
    // keep the corner when the shortcut is blocked, or lands on another floor
    if (!ok || Math.abs(NF[3] - nxt.y) > 0.6) { pulled.push(raw[i]); ax = raw[i].x; az = raw[i].z; ah = raw[i].y; }
  }
  pulled.partial = found < 0;
  return pulled;
}
/** A roof overhead (anything solid 2-12 m above the feet) = indoors. */
function navRoofed(x, z, h, ci) {
  for (let k = navBStart[ci], e = navBStart[ci + 1]; k < e; k++) {
    const c = navCols[navBItems[k]];
    if (c.dead || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (c.minY > h + 2.0 && c.minY < h + 12) return true;
  }
  return false;
}
/** Path toward (tx,tz). When the bot-aligned grid finds no complete route, retry
 *  on a grid shifted by half a cell (doorways: see navSearch). Measured 2026-09-30:
 *  a bot inside a palm_bay hut with two 1.4 m doors got null from BOTH findPath
 *  and findExit and stayed inside for a minute. */
function findPath(W, sx, sy, sz, tx, tz, ty) {
  const p = navSearch(W, sx, sy, sz, tx, tz, ty, 0, 0, 0);
  if (p && !p.partial) return p;
  const q = navSearch(W, sx, sy, sz, tx, tz, ty, 0, 0, NAV_HALF);
  if (q && (!p || !q.partial)) return q;
  return p || q;
}
/** Nearest reachable spot OUTSIDE (on open ground, no roof) at least minDist away. */
function findExit(W, sx, sy, sz, minDist) {
  return navSearch(W, sx, sy, sz, 0, 0, null, 1, minDist || 4, 0) || navSearch(W, sx, sy, sz, 0, 0, null, 1, minDist || 4, NAV_HALF);
}
const NAV_HALF = CELL * 0.5 - 0.01;
/** Test hook for the lane probes: the live pathfinder, read-only. */
export function debugNav() { return { findPath, findExit, CELL, GRID_R }; }

/** Floor-aware "can I stand here" for local probes (cover candidates): the
 *  support a bot at feet height y would have at (x,z), or NaN when that spot is
 *  water, walled, or more than 1.2 m below this floor (not on the same level). */
function standAt(W, x, z, y) {
  const s = supportAt(W, x, z, y + NAV_STEP_UP);
  const terr = W.map.heightAt(x, z);
  if (s <= terr + 1e-6 && terr < W.map.waterY + 0.3) return NaN;
  if (y - s > 1.2) return NaN;
  if (obstacleAt(W, x, z, s)) return NaN;
  return s;
}
function requestPath(W, b, tx, tz, ty) {
  const bb = b.bb;
  if ((bb.nextPathT || 0) > W.t) return;
  bb.nextPathT = W.t + 2.5;
  const a = b.actor;
  bb.path = findPath(W, a.pos.x, a.pos.y, a.pos.z, tx, tz, ty);
  bb.pathGoal = bb.path ? { x: tx, z: tz } : null;
}

function moveToward(W, b, tx, tz, dt, sprint, ty) {
  const a = b.actor, inp = a.input, bb = b.bb;
  /* PROGRESS stuck, as opposed to FROZEN stuck.
     The speed test at the top of act() only accumulates bb.stuckT when the bot
     moves less than 0.02 m in a frame — i.e. pinned solid. A bot grinding along
     a wall, or circling a building it cannot enter, moves at full speed and
     never trips it, so none of the recovery below ever ran. Measured
     (_harness/stuckdiag.py): 3.6% / 3.3% of goal-seeking samples had the goal
     distance refuse to fall for 4 s, one bot parked 3.0 m from a loot pickup.
     So watch the GOAL, not the legs: if the distance has not improved by half a
     metre in 3 s, declare hard-stuck and let the pathfinder take over. */
  if (!bb.progGoal || hyp(tx - bb.progGoal.x, tz - bb.progGoal.z) > 4) {
    if (!bb.progGoal) bb.progGoal = { x: 0, z: 0 };
    bb.progGoal.x = tx; bb.progGoal.z = tz; bb.progBest = null; bb.progT = 0;
  }
  const goalD = hyp(tx - a.pos.x, tz - a.pos.z);
  if (bb.progBest == null || goalD < bb.progBest - 0.5) { bb.progBest = goalD; bb.progT = 0; }
  else bb.progT = (bb.progT || 0) + dt;
  if (bb.progT > 3.0 && goalD > 2.0) {
    bb.stuckT = Math.max(bb.stuckT || 0, 2.3);   // trip the hard-stuck branch
    bb.progT = 0; bb.progBest = null;
    /* And stop choosing the thing it cannot reach. onEnter('LOOT') re-picked
       the SAME item every time, so the bot escaped the wall and walked straight
       back into it. Park this id for 30 s and let it pick something else. */
    if (bb.lootId) {
      if (!bb.badLoot) bb.badLoot = {};
      bb.badLoot[bb.lootId] = W.t + 30;
      bb.lootId = null; bb.moveTo = null; b.nextThink = 0;
    }
  }
  // PATH FOLLOW: an active A* waypoint chain overrides the direct line.
  // Drop the plan when the caller's goal has moved well away from the one the
  // path was computed for (a re-planned rotation, a moving target).
  if (bb.path && bb.pathGoal && hyp(tx - bb.pathGoal.x, tz - bb.pathGoal.z) > 8) { bb.path = null; bb.pathGoal = null; }
  if (bb.path && bb.path.length && hyp(bb.path[0].x - a.pos.x, bb.path[0].z - a.pos.z) < 1.6) bb.path.shift();
  if (bb.path && !bb.path.length) { bb.path = null; bb.pathGoal = null; }
  const gx = bb.path ? bb.path[0].x : tx, gz = bb.path ? bb.path[0].z : tz;
  let want = Math.atan2(-(gx - a.pos.x), -(gz - a.pos.z));
  // PROACTIVE wall steer (owner playtest: bots ground against buildings while
  // fleeing the storm). Walls used to be discovered only by the stuck detector
  // — AFTER seconds of running in place. Probe the path 3.2m out; if a wall too
  // tall to hop is there, request an A* path around it, and slide along the
  // wall while (or if) the path isn't available. The slide side is chosen ONCE
  // and held, so the bot commits around the corner instead of dithering.
  // While following a path the probe stops at the next waypoint (the path turns
  // there). A wall INSIDE the current leg means the plan is wrong: drop it and
  // keep the wall-slide (the old code switched the slide off whenever any path
  // existed, so a bad long-range path also disabled the one thing that would
  // have got the bot round the wall — audit S4).
  const legD = hyp(gx - a.pos.x, gz - a.pos.z);
  let holdStill = false;
  // The probe sits 3.2 m out, so a THIN wall right in front (a 0.35 m hut wall)
  // falls between the bot and the probe point and is never seen: measured
  // 2026-10-01, deepwood seed 13, a bot inside a hut pushed into the wall beside the
  // door for ~80 s (8 stuck episodes) while every probe landed outside. Once the
  // bot is visibly not moving (stuckT, frozen legs), probe at arm's length too.
  // (Only then: an extra collider query per moving bot per frame would cost more
  // than the whole queryColliders budget saved by L6.)
  if (wallAhead(W, a, want, bb.path ? Math.min(3.2, Math.max(0.8, legD)) : 3.2) ||
      (bb.stuckT > 0.3 && wallAhead(W, a, want, 0.9))) {
    if (bb.path) { bb.path = null; bb.pathGoal = null; }
    requestPath(W, b, tx, tz, ty);
    if (!bb.wallSide) bb.wallSide = !wallAhead(W, a, want + 0.9, 3.2) ? 1 : (!wallAhead(W, a, want - 0.9, 3.2) ? -1 : 1);
    if (!bb.path) {
      // The slide itself must not walk the bot somewhere it cannot leave. Sliding
      // uphill along an isla_viva house wall walked bots into the low-ceiling
      // pocket under its first-floor slab, where player.js blockedHoriz then
      // refuses every direction (measured 2026-09-30: 200+ s pinned). Probe the
      // slide heading at floor height; if that is walled too, slide the other way;
      // if both are, hold still and let the path request (every 2.5 s) find a way.
      if (wallAhead(W, a, want + bb.wallSide * 1.05, 1.6)) {
        if (!wallAhead(W, a, want - bb.wallSide * 1.05, 1.6)) bb.wallSide = -bb.wallSide;
        else bb.wallSide = 0;
      }
      if (bb.wallSide) want += bb.wallSide * 1.05;
      else holdStill = true;
    }
  } else bb.wallSide = 0;
  steerYaw(a, want, dt, 7);
  inp.mz = holdStill ? 0 : 1;
  inp.sprint = !!sprint && !holdStill;
  // hop obstacles: support ahead higher than feet → jump
  const aheadX = a.pos.x - Math.sin(a.input.yaw) * 1.4;
  const aheadZ = a.pos.z - Math.cos(a.input.yaw) * 1.4;
  const sup = supportAt(W, aheadX, aheadZ, a.pos.y + 0.6);
  if (sup > a.pos.y + 0.55 && sup < a.pos.y + 2.2 && a.onGround) inp.jump = true;
  if (bb.stuckT > 0.7) {
    // jump at most once every 0.9s — the old EVERY-FRAME jump while stuck
    // read as a bot pogo-ing in place inside a house for a minute straight
    // (owner witnessed it). One hop per second is a real "try to get over it".
    if ((bb.nextJumpT || 0) <= W.t) { inp.jump = true; bb.nextJumpT = W.t + 0.9; }
    // COMMIT to one detour side — the old per-frame random ±1 jittered the bot
    // left-right against the same wall face forever
    if (!bb.detourDir) bb.detourDir = b.rng() < 0.5 ? -1 : 1;
    inp.mx = bb.detourDir;
    if (bb.stuckT > 2.2) {
      // hard-stuck: ask A* for a real route around the blocker. If no path
      // exists (trapped in a blocked pocket — indoors against a wall), walk to
      // the NEAREST OPEN CELL first; the blind detour is the last resort.
      requestPath(W, b, tx, tz, ty);
      if (!bb.path) {
        // Escape search at the bot's OWN floor height (the old ring probed cells
        // at terrain height, so on an upper floor it picked a spot 1.5 m away on
        // the ground below that the bot could never reach — audit S7).
        const ex = findExit(W, a.pos.x, a.pos.y, a.pos.z, 3);
        if (ex && ex.length) {
          const last = ex[ex.length - 1];
          bb.path = ex; bb.pathGoal = { x: last.x, z: last.z };
          bb.moveTo = { x: last.x, z: last.z };
        } else {
          const dirA = want + bb.detourDir * 1.1;
          bb.moveTo = { x: a.pos.x - Math.sin(dirA) * 26, z: a.pos.z - Math.cos(dirA) * 26 };
        }
      }
      bb.stuckT = 0;
    }
  } else bb.detourDir = 0;
  return hyp(tx - a.pos.x, tz - a.pos.z);
}

/** Fight WHILE running (owner playtest: bots "all just run instead of always
 *  fighting while they run"). Movement states call this after setting their
 *  move intent: with a live visible target in weapon range, the bot turns its
 *  yaw to the enemy and fires — while the world-space move direction the state
 *  chose is REPROJECTED into the new yaw frame, so the legs keep carrying it
 *  where it was going. Aim error runs 1.5x: shooting on the run is rougher. */
function fireOnTheMove(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  const t = bb.target && W.actorById.get(bb.target);
  if (!t || !t.alive || W.t - bb.targetSeenT > 0.4) return;
  if (W.t - bb.acquireT < b.tierK.reactionMs / 1000) return;
  const def = K.WEAPONS[a.weapon ? a.weapon.id : "pistol"] || K.WEAPONS.pistol;
  if (a.weapon && (a.weapon.state === "reloading" || a.weapon.magAmmo === 0)) {
    /* An empty mag is only a reload if there is something to reload FROM.
       weapons.js:381 refuses the reload when the matching reserve is 0, so a
       bot whose gun and reserve were both empty sat here setting inp.reload
       every frame and pulling a dead trigger — aiming perfectly, never firing.
       ensureGunOut swaps to a loaded slot, but think() only runs it on the
       brain cadence, which is far too slow inside a firefight. */
    const slot = a.inventory.slots[a.inventory.active];
    const dryNow = slot && slot.kind === "weapon" && slotAmmo(a, slot) <= 0;
    if (dryNow) { ensureGunOut(W, a); b.nextThink = 0; return; }
    inp.reload = true;
    return;
  }
  const dist = hyp(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
  if (dist > (def.falloff ? def.falloff[1] * 1.15 : 30)) return;
  // capture the state's move intent as a WORLD direction before touching yaw
  const b0 = K.moveBasis(inp.yaw, _mb0);
  const wx = b0.fx * inp.mz + b0.rx * inp.mx, wz = b0.fz * inp.mz + b0.rz * inp.mx;
  const eye = eyePos(a, _eye_fireOnTheMove);
  const aimY = t.pos.y + K.actorHeight(t) * 0.64;
  const err = (b.tierK.aimErrDeg * 1.5 * Math.PI) / 180;
  bb.errPhase = (bb.errPhase || b.rng() * 9) + dt * 3.1;
  steerYaw(a, Math.atan2(-(t.pos.x - eye.x), -(t.pos.z - eye.z)) + Math.sin(bb.errPhase) * err, dt, 10);
  inp.pitch = K.clamp(Math.atan2(aimY - eye.y, dist) + Math.cos(bb.errPhase * 0.83) * err * 0.6, -1.3, 1.3);
  const b1 = K.moveBasis(inp.yaw, _mb1);
  inp.mz = wx * b1.fx + wz * b1.fz;
  inp.mx = wx * b1.rx + wz * b1.rz;
  inp.fire = true;
}

function actMove(W, b, dt, sprint) {
  const bb = b.bb;
  if (!bb.moveTo) { onEnter(W, b, b.state); return; }
  const d = moveToward(W, b, bb.moveTo.x, bb.moveTo.z, dt, sprint);
  if (d < 3) { bb.moveTo = null; b.nextThink = 0; }
}

function actLoot(W, b, dt) {
  const a = b.actor, bb = b.bb;
  // grab everything in arm's reach (chests included). Only worth a query near the
  // goal or mid-channel: walkover (loot.js) already takes items passed on the way,
  // and this allocated a sorted result list every frame for every looting bot.
  const mt = bb.moveTo;
  const nearGoal = !mt || bb.chestId || hyp(mt.x - a.pos.x, mt.z - a.pos.z) < 3.5;
  const near = nearGoal ? W.nearbyLoot(a.pos, 2.4) : _noLoot;
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
    const far = hyp(bb.moveTo.x - a.pos.x, bb.moveTo.z - a.pos.z) > 12;
    const d = moveToward(W, b, bb.moveTo.x, bb.moveTo.z, dt, far, bb.moveTo.y); // sprint the long hauls
    if (d < 1.8) bb.moveTo = null;
  } else {
    // plan exhausted → re-plan NOW (state may stay LOOT, so onEnter must be
    // re-run explicitly or the bot stands idle forever)
    onEnter(W, b, "LOOT");
  }
}

const _noLoot = [];

/** Walk to a marked supply drop, then hand off to the normal loot grab.
 *  Clearing bb.supply on ARRIVAL is the whole trick: the mark has no owner and
 *  nothing else retires it before the 90s expiry, so without this a bot that got
 *  there second would orbit an empty patch of grass for a minute and a half. */
function actSupply(W, b, dt) {
  const a = b.actor, bb = b.bb;
  if (!bb.supply) { b.state = "WANDER"; b.nextThink = 0; return; }
  if (hyp(a.pos.x - bb.supply.x, a.pos.z - bb.supply.z) < 4) { bb.supply = null; b.nextThink = 0; }
  actLoot(W, b, dt);
}

/** Ammo a slot can actually put downrange right now (mag + matching reserve). */
function slotAmmo(a, s) {
  const def = K.WEAPONS[s.id];
  if (!def) return 0;
  const mag = s.mag != null ? s.mag : 0;
  return mag + (a.inventory.ammo[def.ammo] || 0);
}
/** Sustained DPS of a slot, rarity-weighted. Fallback only (sim without gunValueAt). */
function slotScore(a, s) {
  const def = K.WEAPONS[s.id];
  if (!def) return -1;
  if (slotAmmo(a, s) <= 0) return 0;                       // a dry gun is worth nothing
  const pellets = def.pellets || 1;                        // without this a legendary
  // shotgun scored BELOW the starter pistol, because raw `damage` is per pellet
  return (def.damage * pellets * def.rpm / 60) + (s.rarity || 0) * 20;
}
// With no fight on, hold what the NEXT fight most likely needs: the mean value over
// the ranges fights actually open at: point blank round a corner, across a room,
// across a street, across a field.
const IDLE_RANGES = [5, 15, 40, 80];
/** What this slot is worth right now (sim gunValueAt: time-to-kill from the
 *  weapon tables). dist == null = no live fight. */
// The value is computed for THIS bot's hands, with the error model actEngage
// actually applies (measured, not assumed). Until 2026-10-01 it used only the
// tier's wobble amplitude x 0.7 (the RMS of the sine), so a tier-4/5 bot "aimed"
// to 0.6-1.3 deg and the pistol's tight cone won at 20-50 m. The game disagreed:
// bot damage landed per trigger pull, 6 storm-on matches (wdiag_v1b), tiers 4-5,
// at 20-30 / 30-40 / 40-50 m: SMG 39 / 25 / 18 vs pistol 26 / 17 / 13 (x rpm/60),
// and the AR beat the pistol in every band from 10 m out. What the old model left
// out, both straight from actEngage:
//  - the target-motion multiplier on the aim error (motionMul below: a target
//    strafing at walk speed widens the wobble 1.34x, airborne +0.35);
//  - the turn lag: steerYaw chases the aim point at rate 10/s, so the muzzle trails
//    a target moving across the sightline by (relative lateral speed x 0.1 s) - a
//    LINEAR miss that does not shrink with range (gunValueAt trackM). Two strafing
//    fighters: ~0.85 m, wider than the 0.45 m half-width of a body.
// With both in, the model ranks the guns the way the matches do (fit 2026-10-01:
// a free fit of aim + linear miss to the same data lands on 0.5-1.5 deg + 1.0 m).
const AIM_RMS = 0.7;
const BOT_TURN_RATE = 10;                         // actEngage: steerYaw(a, wantYaw, dt, 10)
/** actEngage's target-motion multiplier on the aim error (one definition for both). */
function aimMotionMul(tgtSpeed, airborne) { return 1 + Math.min(1.2, tgtSpeed / 9.6) * 0.55 + (airborne ? 0.35 : 0); }
/** The distance actEngage will pull this weapon's trigger at (its inRange test).
 *  ONE definition for the fire discipline and the weapon choice: they used to
 *  disagree. slotValue scored every gun at every range, and the sim's value model
 *  ranks the pistol's tight cone above the SMG and the shotgun at 50-100 m, so the
 *  bot drew a pistol it would not even fire past 49 m, closed in with it and
 *  fought the close range with it (measured 2026-10-01, wdiag: 3,885 of 10,792
 *  "better gun carried, pistol held" samples were fights at >= 50 m, and 90 of
 *  156 bot lives that ended on the pistol carried a loaded better gun). */
function fireRangeM(def) { return def.falloff ? def.falloff[1] * 1.3 : 30; }
// gunValueAt opts, reused (slotValue runs per slot per think for 49 brains)
const _gvOpts = { ehp: 150, speed: 0, mag: 0, reserve: 0, aimDeg: undefined, trackM: 0 };
/** tgtSpeed / tgtAir: the live target's ground speed and airborne flag (live fight
 *  only). No fight: the next one is assumed to be against someone strafing at walk
 *  speed while this bot strafes too (actEngage strafes at mx = +-1 inside 50 m). */
function slotValue(a, s, dist, ehp, speed, tgtSpeed, tgtAir) {
  const def = K.WEAPONS[s.id];
  if (!def) return -1;
  if (!K.gunValueAt) return slotScore(a, s);
  const reserve = a.inventory.ammo[def.ammo] || 0;
  const mag = s.mag != null ? s.mag : 0;
  if (mag + reserve <= 0) return 0;
  const tk = a.brain && a.brain.tierK;
  const o = _gvOpts;
  const walk = K.MOVE ? K.MOVE.walk : 6;
  const idle = dist == null;
  const ts = idle ? walk : (tgtSpeed || 0), ss = idle ? walk : speed;
  o.mag = mag; o.reserve = reserve;
  o.aimDeg = tk ? tk.aimErrDeg * AIM_RMS * aimMotionMul(ts, !idle && tgtAir) : undefined;
  o.trackM = Math.sqrt(ts * ts + ss * ss) / BOT_TURN_RATE;
  o.speed = ss;
  const reach = fireRangeM(def);
  let v;
  if (idle) {
    o.ehp = 150;
    v = 0;
    for (let i = 0; i < IDLE_RANGES.length; i++) {
      const r = IDLE_RANGES[i];
      if (r <= reach) v += K.gunValueAt(s.id, s.rarity || 0, r, o);   // no shots past its fire range
    }
    v /= IDLE_RANGES.length;
  } else {
    if (dist > reach) return 0;                    // the bot will not fire it from here
    o.ehp = ehp;
    v = K.gunValueAt(s.id, s.rarity || 0, dist, o);
    // A bot only pulls a sniper trigger while standing still (actEngage), so a
    // sniper is only worth drawing when the bot is not running.
    if (def.cls === "sniper" && speed > 3) v *= 0.5;
  }
  return v;
}
// PRIMARY FIRST. Measured 2026-10-01 (wdiag_v2, 6 storm-on matches): damage a bot
// deals per second ENGAGED holding a gun at a seen target, tiers 4-5, at 10-20 /
// 20-30 / 30-40 / 40-50 m: pistol 10.0 / 7.5 / 6.0 / 3.8, SMG 25.2 / 15.2 / 11.6 /
// 8.0, AR 22.5 / 23.7 / 17.6 / 13.6; tiers 1-3: pistol 7.6 / 5.8 / 3.5 / 1.0 vs SMG
// 33.1 / 6.9 / 4.2 / 1.9 and AR 10.0 / 9.6 / 6.2 / 8.8; shotgun 21.7-27.7 inside
// 20 m; sniper and launcher out-damage the pistol inside their own reach as well.
// In bot hands EVERY primary beats the sidearm wherever both can fire - the pistol
// tight cone is swamped by turn lag, target motion and its 3-round burst cadence
// (actEngage). The value model still ranks the pistol over the SMG at 25-45 m for
// a steady hand (it has no burst cadence and no head-hit term), and that one
// ranking was 40-62% of the "better gun carried, pistol held" samples. So the
// pistol is what a player uses it as: the gun drawn when no primary can do the
// job - none with a round left (a player empties the rifle, THEN draws the
// pistol), or none that fires at this range while the pistol does (shotgun past
// 26 m). Among primaries, and whenever the pistol IS a candidate, the value model
// decides as before.
/** RANGE-AWARE WEAPON CHOICE (audit S2): scored by sim gunValueAt at the live
 *  target's distance and EHP, so a sniper is drawn for the man at 120 m, the
 *  shotgun for the man in the doorway, and a sniper one-shot is taken on a target
 *  on 20 EHP. Pure decision (no side effects): fills and returns the scratch _gc. */
const _gc = { bestIdx: -1, curScore: -1, bestScore: -1, eff: 0, clock: false, primaryOnly: false, dist: -1, ehp: 150, swap: false, why: "" };
const _gcScores = [];
function chooseGun(W, a) {
  const g = _gc;
  g.bestIdx = -1; g.curScore = -1; g.bestScore = -1; g.eff = 0; g.clock = false; g.primaryOnly = false; g.swap = false; g.why = "";
  _gcScores.length = 0;
  const cur = a.weapon;
  const holdingConsumable = !cur || cur.id.startsWith("consumable");
  const curSlot = a.inventory.slots[a.inventory.active];
  const curDry = !holdingConsumable && curSlot && curSlot.kind === "weapon" && slotAmmo(a, curSlot) <= 0;
  const bb = a.brain && a.brain.bb;
  let dist = null, ehp = 150, tgtSpeed = 0, tgtAir = false;
  if (bb && bb.target && bb.targetPos && W.t - bb.targetSeenT < 3) {
    const dx = bb.targetPos.x - a.pos.x, dz = bb.targetPos.z - a.pos.z;
    dist = Math.sqrt(dx * dx + dz * dz);
    const t = W.actorById.get(bb.target);
    if (t && t.alive) {
      ehp = (t.hp || 0) + (t.shield || 0);
      if (t.vel) tgtSpeed = Math.sqrt(t.vel.x * t.vel.x + t.vel.z * t.vel.z);
      tgtAir = t.onGround === false;
    }
  }
  g.dist = dist == null ? -1 : dist; g.ehp = ehp;
  const speed = a.vel ? Math.sqrt(a.vel.x * a.vel.x + a.vel.z * a.vel.z) : 0;
  const sl = a.inventory.slots;
  // which guns can fire at this range at all, and is a loaded primary among them?
  let anyReach = false, primaryReach = false, primaryLoaded = false;
  for (let i = 0; i < sl.length; i++) {
    const s = sl[i];
    if (!s || s.kind !== "weapon" || slotAmmo(a, s) <= 0) continue;
    const def = K.WEAPONS[s.id];
    if (!def) continue;
    const reach = dist == null || dist <= fireRangeM(def);
    if (reach) anyReach = true;
    if (s.id !== "pistol") { primaryLoaded = true; if (reach) primaryReach = true; }
  }
  // the pistol sits out when a loaded primary can fire here, or when nothing can
  // fire from here at all (the fight is still to be closed: carry the primary in)
  const primaryOnly = primaryReach || (primaryLoaded && !anyReach);
  g.primaryOnly = primaryOnly;
  let bestIdx = -1, bs = -1, curScore = -1, fightBest = 0;
  for (let i = 0; i < sl.length; i++) {
    const s = sl[i];
    if (!s || s.kind !== "weapon") continue;
    let score = slotValue(a, s, dist, ehp, speed, tgtSpeed, tgtAir);
    if (score > fightBest) fightBest = score;
    // Tie-break on the NEXT fight (measured 2026-09-30: 66-80% of the samples where
    // a bot held the pistol while carrying a better gun were fights at 30-200 m,
    // where no carried gun can finish a 150 EHP target on the ammo it has — every
    // value was ~0, the tie kept the pistol, and the bot met the next close fight
    // with it). Where the live fight's value is real (tens) this term is noise.
    // Every gun with rounds gets it, including the ones out of fire range (value
    // exactly 0 now): with nothing in the bag able to fire at this range, the bot
    // holds what the fight will need once it has closed the distance.
    if (dist != null && slotAmmo(a, s) > 0) score += IDLE_TIE * slotValue(a, s, null, ehp, speed, 0, false);
    if (primaryOnly && s.id === "pistol") score = 0;   // not a candidate (see above)
    _gcScores.push(i, score);
    if (i === a.inventory.active) curScore = score;
    if (score > bs) { bs = score; bestIdx = i; }
  }
  g.bestIdx = bestIdx; g.curScore = curScore; g.bestScore = bs;
  if (bestIdx < 0) { g.why = "noGun"; return g; }
  // Only act when there is a REASON to: holding a consumable, holding a dry gun,
  // or a meaningfully better gun is available. And never re-equip the slot we
  // already hold — equipSlot rebuilds the weapon object, so calling it every
  // think would cancel reloads and re-clone the mesh forever.
  if (bestIdx === a.inventory.active) { g.why = "holding"; return g; }
  if (holdingConsumable || curDry) { g.swap = true; g.why = "dryOrConsumable"; return g; }
  if (bb && W.t - (bb.swapT || -99) <= SWAP_GATE_S) { g.why = "gate"; return g; }   // one range-driven swap per 1.2 s
  // In a fight, charge the swap its real price in the value's own units: the value
  // is target EHP / time-to-kill, and equipSlot holds a fresh gun for 0.4 s
  // (weapons.js equipSlot startCd), so the swapped-in gun is worth
  // ehp / (ehp / v + 0.4). Then demand SWAP_MARGIN over what is in hand, because the
  // value model's aim and dodge constants are estimates, not measurements.
  // With NO clock running there is no price and nothing noisy to dither on (no
  // target: the idle values move only when ammo does; a target beyond every
  // carried gun's fire range: the fight values are all exactly 0), so the margin
  // is only hysteresis there. At 1.15 it was the reason a bot that had answered a
  // mid-range fight with the pistol kept it out for the rest of the match: an SMG
  // is worth 1.11x the pistol at the idle ranges for a steady hand, under the bar.
  let eff = bs;
  const clock = dist != null && fightBest > 0;
  if (clock) eff = ehp / (ehp / Math.max(1e-6, bs) + SWAP_READY_S);
  g.eff = eff; g.clock = clock;
  g.swap = eff > curScore * (clock ? SWAP_MARGIN : SWAP_MARGIN_IDLE);
  g.why = g.swap ? "better" : "margin";
  return g;
}
function ensureGunOut(W, a) {
  // Old guard: `if (a.weapon && !a.weapon.id.startsWith("consumable")) return;`
  // Every actor is created holding a pistol, so this returned immediately for
  // every bot in every match and the scoring below was dead code. A bot locked
  // onto the first gun it ever touched, never upgraded, and — once mag AND
  // reserve hit zero — stood in the open aiming correctly and pulling a dead
  // trigger while a loaded pistol sat in slot 0.
  const g = chooseGun(W, a);
  if (!g.swap) return;
  W.equipSlot(a, g.bestIdx);
  const bb = a.brain && a.brain.bb;
  if (bb) bb.swapT = W.t;
}
/** Test hook (read-only): what ensureGunOut would decide for this bot right now. */
export function debugGunChoice(W, a) {
  const g = chooseGun(W, a);
  const scores = [];
  for (let i = 0; i < _gcScores.length; i += 2) scores.push({ slot: _gcScores[i], score: +_gcScores[i + 1].toFixed(3) });
  return Object.assign({}, g, { scores });
}
const IDLE_TIE = 0.02;
const SWAP_READY_S = 0.4;       // weapons.js equipSlot: startCd >= 0.4
const SWAP_MARGIN = 1.15;
const SWAP_MARGIN_IDLE = 1.03;
const SWAP_GATE_S = 1.2;

function actHeal(W, b, dt) {
  const a = b.actor, bb = b.bb;
  if (!a.healing) {
    if (!startHeal(W, a)) {
      // Second line of defence behind the usability predicate above: if a heal
      // ever fails anyway, refuse to re-enter HEAL for a few seconds instead of
      // re-deciding on the very next tick. nextThink 0 + an unchanged score is
      // precisely the shape of an infinite loop.
      b.bb.healBlockedUntil = W.t + 4;
      b.state = "WANDER"; b.nextThink = 0.35 + b.rng() * 0.4;
    }
    return;
  }
  // Healing used to zero movement outright, which pinned a bot in the open for
  // the whole channel — up to 8s for a medkit — as a free stationary target.
  // The sim now charges the tempo cost itself (HEAL.speedMult 0.45 + sprint
  // locked out in player.js), so a bot that keeps walking is already slowed by
  // the same rule the human pays. Zeroing input on top of that made the penalty
  // human-only: the player could back behind cover mid-heal and no bot ever
  // could. Break line of sight instead of standing still.
  // bb.target is an ID STRING, so bb.target.pos was always undefined, and
  // bb.lastThreat is never set anywhere — so `away` was always null and the bot
  // stood still through the entire heal channel, exactly the freeze this code
  // was meant to end. bb.targetPos is the RESOLVED last-seen position the rest
  // of the brain already maintains (see s.ENGAGE tRef at the top of think);
  // fall back to the storm centre so a bot with no known threat still drifts to
  // safety while healing rather than rooting in the open.
  let away = bb.targetPos || null;
  if (!away && W.stormCtl) { const st = W.stormCtl.storm.stateAt(W.t); away = st.nextCenter || st.center; away = { x: 2 * a.pos.x - away.x, z: 2 * a.pos.z - away.z }; }
  if (away) {
    const dx = a.pos.x - away.x, dz = a.pos.z - away.z;
    const d = hyp(dx, dz) || 1;
    a.yaw = Math.atan2(-dx / d, -dz / d);   // face the threat while backing off
    a.input.mz = -1;                        // retreat, at the slowed heal speed
    a.input.mx = 0;
  } else {
    a.input.mz = 0; a.input.mx = 0;
  }
  a.input.sprint = false;                   // the sim blocks it anyway; be explicit
}

function actCamp(W, b, dt) {
  const a = b.actor, bb = b.bb;
  if (bb.campSpot) {
    const d = hyp(bb.campSpot.x - a.pos.x, bb.campSpot.z - a.pos.z);
    if (d > 4) { moveToward(W, b, bb.campSpot.x, bb.campSpot.z, dt, false); return; }
  }
  // hold position + slow scan (ADS for the tighter cone read). Crouch too: the
  // verb was keyboard-only (player.js KeyC), so campers and snipers stood bolt
  // upright at their spot, paying none of CROUCH's 0.62 spread and giving away
  // the full 1.8m capsule when they had already chosen not to move.
  a.input.ads = true;
  a.input.crouch = true;
  a.input.yaw += dt * 0.25;
}

// ── combat ───────────────────────────────────────────────────────────────────
// Odds a bot deliberately aims for the head, by tier. Every bot used to aim at a
// flat 1.15m, but weapons.js only counts a hit as a headshot above 0.86 of the
// target's capsule = 1.548m standing, so every "headshot" a bot ever landed was
// spread luck. Top tier is held at 0.25 and not higher on purpose: a tier-5
// sniper head hit is 105 * 2.5 = 262 damage, straight through a full 100+100 bar.
const HEAD_CHANCE = [0, 0, 0.1, 0.2, 0.25];

// ── OCCLUSION-AWARE COVER ──────────────────────────────────────────────────
// The brain could always SEE line-of-sight (perceive() and the return-fire check
// both call losBlocked), but nothing ever asked whether a DESTINATION broke it.
// obstacleAt/cellBlocked test WALKABILITY, not occlusion, so bots pathed AROUND
// walls and never BEHIND them — they fought every duel standing in the open.
// This is that missing half: pick a nearby spot that breaks the target's line,
// go to it, hold briefly, then peek back out.
let _coverBudget = 2;

const COVER_HOLD = 0.9;        // seconds behind cover before peeking back out
const COVER_FAIL_MEMO = 3.0;   // after a failed scan, don't re-scan for this long
const COVER_ARRIVE = 1.8;      // metres: close enough to count as "in cover"

/**
 * Returns TRUE when cover owns locomotion this frame (caller must not write
 * inp.mx/mz/sprint afterwards), FALSE to let normal engage movement run.
 *
 * Deliberately uses `tp` (the last KNOWN target position) rather than the live
 * target position: a bot must not get unperceivable knowledge out of this.
 */
function coverStep(W, b, dt, tp, seen, dist) {
  const a = b.actor, bb = b.bb, inp = a.input;

  // ── already committed: run the state machine, no search ──
  if (bb.coverState === "MOVING") {
    const cp = bb.coverPt;
    if (!cp || W.t > (bb.coverGiveUp || 0)) { bb.coverState = "NONE"; return false; }
    const d = hyp(cp.x - a.pos.x, cp.z - a.pos.z);
    if (d < COVER_ARRIVE) {
      bb.coverState = "IN";
      // Tier-scaled: a sharper bot spends less time hiding and more time shooting.
      bb.coverUntil = W.t + COVER_HOLD * (1.35 - (b.tierNow || a.tier || 3) * 0.09);
      return true;
    }
    moveToward(W, b, cp.x, cp.z, dt, d > 6);
    return true;
  }
  if (bb.coverState === "IN") {
    if (W.t > (bb.coverUntil || 0)) {
      // PEEK: drop back to normal engage. Without this a bot that found cover
      // would turtle there forever — unkillable and boring, which is worse than
      // one that stands in the open.
      bb.coverState = "NONE";
      bb.coverFailUntil = W.t + 1.2;      // don't instantly re-hide
      return false;
    }
    // reload and heal while the wall is doing the work
    inp.mx = 0; inp.mz = 0; inp.sprint = false;
    steerYaw(a, Math.atan2(-(tp.x - a.pos.x), -(tp.z - a.pos.z)), dt, 6);
    return true;
  }

  // ── should we even look? cheapest tests first ──
  if (W.t < (bb.coverFailUntil || 0)) return false;
  const reloading = !!(a.weapon && a.weapon.state === "reloading");
  const hurt = (a.hp + a.shield) < 70;
  const shotAt = W.t - a.lastDamageT < 1.5;
  if (!reloading && !hurt && !shotAt) return false;     // no reason to break off
  if (dist < 6) return false;                           // point-blank: fight, don't hide
  if (_coverBudget <= 0) return false;

  // Open terrain is the common case and must cost almost nothing: one cheap
  // collider query rejects it before any raycast.
  const near = W.map.queryColliders(a.pos.x, a.pos.z, 16);
  if (!near || !near.length) { bb.coverFailUntil = W.t + COVER_FAIL_MEMO; return false; }

  _coverBudget--;
  const found = findCover(W, a, tp);
  if (!found) { bb.coverFailUntil = W.t + COVER_FAIL_MEMO; return false; }
  bb.coverPt = found;
  bb.coverState = "MOVING";
  bb.coverGiveUp = W.t + 3.5;             // never chase a cover point forever
  return true;
}

/** 12 candidates = 6 bearings x 2 radii. Each is prefiltered on walkability and
 *  height before it is allowed to cost a ray. */
function findCover(W, a, tp) {
  const gy = a.pos.y;                                   // this floor, not the terrain under it
  const toT = Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z);
  let best = null, bestScore = -1e9;
  for (let ri = 0; ri < 2; ri++) {
    const r = ri === 0 ? 7 : 14;
    for (let i = 0; i < 6; i++) {
      // bias the ring AWAY from the target: cover is behind you, not past them
      const ang = toT + Math.PI + (i - 2.5) * 0.62;
      const x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
      if (Math.abs(x) > W.map.half - 4 || Math.abs(z) > W.map.half - 4) continue;
      const h = standAt(W, x, z, gy);                   // NaN: water, wall, or off this floor
      if (h !== h) continue;
      if (h - gy > 3) continue;                         // not a cliff we can't climb
      if (!losTruncated(W, x, h, z, tp)) continue;      // must actually break the line
      // prefer close cover, and prefer keeping some distance from the target
      const score = -r + Math.min(20, hyp(x - tp.x, z - tp.z)) * 0.35;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  return best;
}

/** Cast only the FIRST 12m of the candidate->target line. Casting the whole line
 *  would make a 200m sniper duel cost ~9 collider sweeps and 60 terrain samples
 *  PER CANDIDATE — and it would be wrong as well as slow, since a ridge 80m
 *  downrange is not cover the target cannot simply walk around. */
function losTruncated(W, x, h, z, tp) {
  const ex = x, ey = h + 1.5, ez = z;
  const dx = tp.x - ex, dz = tp.z - ez;
  const len = hyp(dx, dz) || 1;
  const f = Math.min(1, 12 / len);
  return W.map.losBlocked(ex, ey, ez, ex + dx * f, (tp.y || h) + 1.2, ez + dz * f);
}

const PREFER_RANGE = { shotgun: 7, smg: 14, pistol: 16, ar: 30, sniper: 90, glauncher: 26 };
function actEngage(W, b, dt) {
  const a = b.actor, bb = b.bb, inp = a.input;
  const t = bb.target && W.actorById.get(bb.target);
  if (!t || !t.alive) { bb.target = null; bb.fightT = 0; b.nextThink = 0; return; }
  // fight fatigue: humans don't trade pistol whiffs forever — after ~14s of
  // stalemate, break off to reposition/loot (prevents map-wide pistol gridlock).
  // The same edge also rolls the aim height: per TARGET here and per burst below,
  // never per frame — a per-frame roll would shimmer the aim point between chest
  // and head and land in neither.
  if (bb.fightTarget !== bb.target) { bb.fightTarget = bb.target; bb.fightT = 0; bb.aimHigh = b.rng() < (HEAD_CHANCE[a.tier - 1] || 0); }
  bb.fightT = (bb.fightT || 0) + dt;
  if (bb.fightT > 14 && W.t - a.lastDamageT > 6) {
    if (W.match.aliveCount() > 6) {
      bb.avoidId = bb.target; bb.avoidUntil = W.t + 6;   // don't instantly re-lock the same stalemate
      bb.target = null; bb.fightT = 0; b.nextThink = 0;
      return;
    }
    // ENDGAME: there is nobody else to go and fight, and this used to mean no
    // breaker at all. ENGAGE steering is a raw push toward the target with no
    // pathing, so two survivors 60 m apart with a crater rim or a building
    // between them traded misses until the storm ended the match (measured
    // 2026-09-30: isla_viva seed 1 and ashgrid seed 4 both ran from ~250 s to
    // ~745 s on one stalemate). Close in on a PATH for a few seconds instead,
    // shooting on the move whenever he is in sight.
    bb.closeInUntil = W.t + 6; bb.fightT = 0; b.nextThink = 0;
    return;
  }
  const seen = W.t - bb.targetSeenT < 0.4;
  const tp = seen ? t.pos : bb.targetPos;
  if (!tp) { bb.target = null; return; }
  const dx = tp.x - a.pos.x, dz = tp.z - a.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);   // (inline: actEngage is past the inliner's budget, and every call boxes its numbers)

  const wid = a.weapon ? a.weapon.id : "pistol";
  const def = K.WEAPONS[wid] || K.WEAPONS.pistol;

  // preferred range by class
  const prefer = PREFER_RANGE[wid] || 25;          // (module table: the literal was an allocation per bot per frame)
  // final-circle duels: tighter aim (adrenaline > wobble) so fights resolve
  const duel = W.match.aliveCount() <= 4;

  // movement: close/retreat + strafe; flankers arc around instead of straight-lining
  bb.strafeT -= dt;
  if (bb.strafeT <= 0) {
    bb.strafeT = 0.5 + b.rng() * 0.9;
    bb.strafeDir = a.personality === "flanker" ? (bb.strafeDir || 1) : (b.rng() < 0.5 ? -1 : 1);
  }
  // Cover owns locomotion when it returns true. It MUST be hooked above the
  // reloading branch below: that branch ends in a bare `return`, so anything
  // placed after it can never run while reloading — which is one of the exact
  // moments a bot most needs to break line of sight.
  if (coverStep(W, b, dt, tp, seen, dist)) return;

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
  if (a.onGround && b.actor.tier >= 3 && b.rng() < dt * 0.35) inp.jump = true;

  // aiming with human error model
  const eye = eyePos(a, _eye_actEngage);
  // Aim as a FRACTION of the target's real capsule instead of a fixed 1.15m,
  // which was hard-coded for a standing 1.8m actor. weapons.js scores a headshot
  // above 0.86 of actorHeight — 1.548m standing — so 1.15m could only ever land
  // on the body. A fixed 1.62m head point would work standing but sits just
  // 0.05m under a crouched capsule's 1.668m ceiling and a full 0.6m OVER a
  // swimmer's 1.02m one, so scale it: 0.94 stays inside the head band at every
  // stance, 0.64 reproduces the old ~1.15m chest point when standing.
  const th = t.swimming ? 0.9 : K.actorHeight(t);
  const aimY = tp.y + th * (bb.aimHigh ? 0.94 : 0.64);
  // lead for projectile weapons
  let lead = 0;
  if (def.speed && def.speed < 600 && seen && t.vel) lead = dist / def.speed;
  const px = tp.x + (seen && t.vel ? t.vel.x * lead : 0);
  const pz = tp.z + (seen && t.vel ? t.vel.z * lead : 0);
  let wantYaw = Math.atan2(-(px - eye.x), -(pz - eye.z));
  const ehx = px - eye.x, ehz = pz - eye.z, dHorizE = Math.sqrt(ehx * ehx + ehz * ehz);
  let wantPitch = Math.atan2(aimY - eye.y, dHorizE);
  // ARCING WEAPONS need a ballistic solution, not a straight line. The grenade
  // launcher flies at speed 26 under gravity -18 (sim/royale.js, weapons.js), so
  // a flat aim drops every bot-fired shell well short — bots holding one were
  // harmless. Solve the low-arc launch angle for the horizontal range.
  {
    const wdef = K.WEAPONS[a.weapon && a.weapon.id];
    if (wdef && wdef.arc) {
      const dHoriz = dHorizE;
      if (dHoriz > 0.5) wantPitch = arcPitch(wdef, dHoriz, aimY - eye.y);
    }
  }

  // error: base tier error × acquire overshoot (3× decaying 0.6s) × target-motion penalty
  const sinceAcq = W.t - bb.acquireT;
  const acquireMul = sinceAcq < 0.6 ? 3 - (sinceAcq / 0.6) * 2 : 1;
  const tgtSpeed = seen && t.vel ? Math.sqrt(t.vel.x * t.vel.x + t.vel.z * t.vel.z) : 0;
  const motionMul = 1 + Math.min(1.2, tgtSpeed / 9.6) * 0.55 + (t.onGround === false ? 0.35 : 0);   // = aimMotionMul (inlined)
  const errDeg = b.tierK.aimErrDeg * acquireMul * motionMul * (duel ? 0.55 : 1);
  const err = (errDeg * Math.PI) / 180;
  // wander the error smoothly (not white noise): per-brain sine wobble
  bb.errPhase = (bb.errPhase || b.rng() * 9) + dt * 3.1;
  wantYaw += Math.sin(bb.errPhase) * err;
  wantPitch += Math.cos(bb.errPhase * 0.83) * err * 0.6;

  steerYaw(a, wantYaw, dt, 10);
  inp.pitch = Math.max(-1.3, Math.min(1.3, inp.pitch + (wantPitch - inp.pitch) * Math.min(1, dt * 9)));

  // fire discipline: reaction delay, LOS, range, bursts
  const reacted = sinceAcq > b.tierK.reactionMs / 1000;
  const inRange = dist < fireRangeM(def);          // the same reach ensureGunOut values a gun at
  const canSee = seen;
  inp.ads = dist > 25;
  // Take the crouched stance only when already holding a range position, not
  // while closing: player.js resolves crouch-vs-sprint in the sprint's favour,
  // so this can never fight the approach, and CROUCH.speedMult 0.45 is only
  // paid on a frame the bot had chosen to stand still anyway.
  inp.crouch = seen && dist > 30 && Math.abs(inp.mz) < 0.1 && a.tier >= 3;
  if (reacted && canSee && inRange) {
    if (def.cls === "ar" || def.cls === "smg" || def.cls === "pistol") {
      // burst sizes per class: AR 4, SMG 8 — and pistols 3, they are SEMI-AUTO
      // sidearms, not machine pistols (they used to fall into the SMG bucket
      // and mag-dump 8 rounds at 400rpm — the "killed by AFKAndy (Pistol)"
      // spectate reports)
      if (bb.burstLeft <= 0 && bb.burstPause <= 0) { bb.burstLeft = def.cls === "ar" ? 4 : (def.cls === "pistol" ? 3 : 8); bb.aimHigh = b.rng() < (HEAD_CHANCE[a.tier - 1] || 0); }
      if (bb.burstLeft > 0) {
        inp.fire = true;
        bb.burstLeft -= dt * (def.rpm / 60);
        if (bb.burstLeft <= 0) bb.burstPause = 0.35 + b.rng() * 0.4;
      }
      bb.burstPause -= dt;
    } else if (def.cls === "sniper") {
      // PLANT, then fire once still. This used to stop the bot only when it was
      // ALREADY below 1.5 m/s - but the strafe a few lines up has just set
      // inp.mx = +-1 (walk speed), so a sniper bot in a fight was never still and
      // almost never pulled the trigger: 99 sniper trigger pulls at a target in 6 whole
      // matches against 7,794 landed samples of bots carrying a loaded sniper
      // (wdiag_base2), and 0-1 damage/s engaged past 50 m. Standing still is the
      // sniper's price (the value model already halves a running bot's sniper).
      // NOTE: coverStep owns inp.mx/mz when it is active — only fire+crouch here.
      if (bb.coverState === "NONE" || !bb.coverState) { inp.mx = 0; inp.mz = 0; inp.sprint = false; inp.jump = false; }
      inp.crouch = true;
      if (a.vel.x * a.vel.x + a.vel.z * a.vel.z < 2.25) inp.fire = true;   // < 1.5 m/s
    } else {
      inp.fire = true;
    }
  }
  // reload when safe
  if (a.weapon && a.weapon.magAmmo === 0) inp.reload = true;
  if (!canSee && a.weapon && def.mag > 0 && a.weapon.magAmmo < def.mag * 0.4) inp.reload = true;

  // Search last-known if lost. Guarded on coverState: `seen` goes false the
  // instant LOS breaks, which is exactly what coverStep just achieved — ungated,
  // this walks the bot straight back out of the cover it reached.
  if (!seen && bb.targetPos && (bb.coverState === "NONE" || !bb.coverState)) {
    moveToward(W, b, bb.targetPos.x, bb.targetPos.z, dt, false);
  }
}
