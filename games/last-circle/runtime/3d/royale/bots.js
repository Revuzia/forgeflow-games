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
const { supportAt, supportA, groundA, fitsAt } = await import("./player.js" + V);
const SPQ = new Float64Array(4);          // supportA scratch: x, z, y -> [3] the support (Wave 7b, S1)
// (Wave 7b, S1) the ground under a probe point, read unboxed: GA[0] = x, GA[1] = z -> groundA -> GA[2] = W.map.heightAt(x, z) (a call with
// double arguments boxes them and its result: the bots' per-frame wall probes read the terrain at every step)
const GA = new Float64Array(3);

let K = null;
const brains = [];
// BOT PACING TABLE (sim/royale.js BOT_PACE, owner decision D8). A sim without it
// plays exactly as it did before the table existed: PACE_OFF is that behaviour.
const PACE_OFF = {
  noticeM: [200, 200, 200, 200, 200], chaseM: [1e9, 1e9, 1e9, 1e9, 1e9], pushM: 1e9, pushPct: 100,
  dropSepM: 0, rotateEdge: 0, rotateLeadS: -1, endgamePhase: 0, earlyChutePct: 0,
};
let PACE = PACE_OFF;
const paceAt = (arr, tier) => arr[Math.max(0, Math.min(arr.length - 1, (tier | 0) - 1))];
/** Re-read the table (init() runs once per page; a match start re-reads it, so an edited table is live). A
 *  table with a missing key falls back to PACE_OFF for that key. QUICK mode keeps PACE_OFF: it is the short, hot
 *  format and its 5-circle storm was never the problem. */
function loadPace(W) { PACE = K && K.BOT_PACE && !(W && W.mode === "quick") ? Object.assign({}, PACE_OFF, K.BOT_PACE) : PACE_OFF; }
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
  loadPace(W);
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
  _wq.length = 0; _mq.length = 0;     // (Wave 5) the wall probes' collider scratch: references to the old map's colliders
  navReset();                         // (Wave 7) the town grid: typed arrays + the old map's colliders
  IND.map = null; IND.H = null; IND.R.length = 0; IND.ix.clear(); IND.grid = null;      // (Wave 8) the room graph: the old map's house records
  OCC.map = null; OCC.cells = null;                                                    // (Wave 8) the cover test's cell table: the old map's colliders
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
  loadPace(W);
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
      lootType: null, supply: null, path: null, pathGoal: null, nextPathT: 0, badLoot: null, navGX: 0, navGZ: 0, navT: -99,
      progGoal: null, progBest: null, progT: 0, wallSide: 0, detourDir: 0, nextJumpT: 0,
      anchor: null, anchorT: 0, breaks: 0,
      // Wave 5 (lane 5B): the wall-aware fight / heal steering. progKind: what progBest measures (0 = horizontal distance
      // to the goal, 1 = the length of the route left, used on the wrong floor). wall*: the held collider list (see wallCols).
      // hd*: the heal retreat heading + the heading banned after a pin. unstickT: last pinned-in-a-fight recovery.
      progKind: 0, wallCols: [], wallT: -99, wallX: 0, wallZ: 0,
      hdX: 0, hdZ: 0, hdT: -99, healSide: 1, hdBadX: 0, hdBadZ: 0, hdBadUntil: 0, unstickT: -99, hdHold: -1,
      slideX: 0, slideZ: 0, slideUntil: -99, slideFlips: 0, routeId: null, pinX: 0, pinZ: 0, pinT: 0, pinIntent: 0, pinN: 0,
      fightTarget: undefined, fightT: 0, aimHigh: false, errPhase: 0, closeInUntil: 0,
      avoidId: null, avoidUntil: 0, swapT: -99, healBlockedUntil: 0,
      threatFor: undefined, threatT: -99, threatAt: null,
      coverState: undefined, coverPt: null, coverGiveUp: 0, coverUntil: 0, coverFailUntil: 0, coverReflexUntil: 0,
      noRouteT: -99, deckT: -99, heldN: 0, heldT: -99, heldAcc: 0,        // (Wave 7, round 2) the last "no route" answer of a path request / the next time a roof exit may be looked for
      // (Wave 8) indoors: the bot's own room (IND.R index, -1 outdoors) and when / where it was read; the target's room; the doorway an indoor cover
      // spot is held beside (coverFace: 1 = face that doorway while holding)
      roomI: -1, roomT: -99, roomX: 0, roomZ: 0, roomY: 0, tRoomI: -1, tRoomT: -99, coverFace: 0, coverFX: 0, coverFZ: 0, nearLootT: 0,
      // (Wave 8 fix round, lane K2) standGoal: the moveTo object that is a house loot STAND point (arrive closer: LOOT_STAND_M); solid*: the
      // inside-a-solid detector's 0.5 s window (escapeSolid)
      standGoal: null, solidT: -99, solidX: 0, solidZ: 0, solidN: 0,
      // (K2, re-run) offFurn*: offFurniture's committed heading (until when, which heading, where the window began, which candidate, for which room);
      // furn*: the off-the-floor pin detector's 0.5 s window (escapeToWalk)
      offFurnUntil: -99, offFurnYaw: 0, offFurnX: 0, offFurnZ: 0, offFurnK: 0, offFurnGi: -1, furnT: -99, furnX: 0, furnZ: 0, furnN: 0, furnD: 0,
    },
    // a stable 0-99 draw per SLOT (not the rng stream: adding a draw there would reshuffle every
    // other decision of every bot); gates how many aggressive bots answer gunfire (BOT_PACE.pushPct)
    pushRoll: (slot * 37 + 11) % 100,
    // the same kind of stable per-slot draw for BOT_PACE.earlyChutePct; earlyChute is set by assignDrops
    chuteRoll: (slot * 53 + 29) % 100,
    earlyChute: false,
  };
  actor.brain = brain;
  brains.push(brain);
  doubleFields(brain); doubleFields(brain.bb);
  // (Wave 7) the town grid's outdoor tiles bake in the idle time of startMatch's awaits and of the lobby; update() is the barrier (navArm). Lobby phase only.
  if (nav.map !== W.map && W.phase === "lobby") startNav(W);
  return brain;
}

/** (Wave 8, lane I2) Every NUMBER field of a new brain / blackboard is made a double field at birth (a double stored, then the start value put back:
 *  the values are exactly the ones above). A field born holding a small integer (0, -99, -1) is a Smi field, and the first time ANY bot stores a fraction
 *  into it (W.t, a timer += dt) V8 deprecates the shared map and re-builds the whole blackboard transition chain (120-odd fields): every optimized
 *  function that reads a blackboard is thrown away and runs interpreted - boxing every number - until it is optimized again. Over a match that
 *  happened once per field, at the moment the match first used it (framecheck, isla_viva: ~8,500 map deprecations and ~2,300 deopts, 195 of them in
 *  bots.js, in bursts through the measured window; the housed maps' new indoor fields added their own). Done here, it happens once, in the lobby. */
const INT_FIELDS = new Set(["solidN", "offFurnK", "offFurnGi", "furnN", "furnD", "roomI", "tRoomI", "strafeDir", "healSide", "hdHold", "pinN", "heldN", "breaks", "slideFlips", "progKind", "wallSide", "detourDir",
  "coverFace", "ramp", "pushRoll", "chuteRoll"]);      // small integers / indexes / signs: they stay Smi fields (they never hold a fraction)
function doubleFields(o) {
  for (const k in o) {
    const v = o[k];
    if (typeof v === "number" && !INT_FIELDS.has(k)) { o[k] = 0.5; o[k] = v; }
  }
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
    // (Wave 8) a house's loot point carries w = the items loot.js expects there (it fills only a few of a house's points: lane I3's per-house budget)
    pts[lp.poi] = (pts[lp.poi] || 0) + (lp.kind === "chest" ? 2 : (lp.w != null ? lp.w : 1));
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
  // (Wave 8 fix round, lane K2) a furnished house's loot lands bots by loot.js's own list of the spots it USED (W.houseLootSpots: a chest, or a floor / top
  // spot where a non-pistol gun lies), aimed at the spot's STAND point inside its room. The house lootPoints are skipped: the 1.8 m query round one found
  // a gun through the wall of the next room or the street (no clear-line rule), and most of a house's points hold nothing (lane I3's per-room budget).
  const HSP = Array.isArray(W.houseLootSpots) && W.map.houses ? W.houseLootSpots : null;
  if (W.nearbyLoot) {
    for (const lp of (W.map.lootPoints || [])) {
      if (HSP && lp.house != null) continue;
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
      // (Wave 7) a Savanna compound's loot points are tagged cmpNN, which names no POI: they used to be filed under a list nothing ever
      // claimed from, so ~30 compounds with their guns and chests were never a landing zone. They land with the wild spots (one bot per
      // gun / chest spot, so the number of bots a compound takes scales with its loot points, as a POI's cap does).
      if (lp.poi == null || (typeof lp.poi === "string" && lp.poi.startsWith("cmp"))) spots.wild.push(s);
      else (byPoi[lp.poi] || (byPoi[lp.poi] = [])).push(s);
    }
    if (HSP) for (let i = 0; i < HSP.length; i++) {
      const hs = HSP[i];
      if (!hs.gun) continue;
      const at = landingFor(hs.stand || hs);
      if (!at) continue;
      const s = { x: at.x, z: at.z, taken: false };
      if (hs.poi == null || (typeof hs.poi === "string" && hs.poi.startsWith("cmp"))) spots.wild.push(s);
      else (byPoi[hs.poi] || (byPoi[hs.poi] = [])).push(s);
    }
  }
  // BOT_PACE.dropSepM: a landing spot must be at least this far from every drop already assigned.
  // Measured (killdiag, 4 storm-on matches): the first-60-s deaths are landing-zone brawls - the victim
  // dies 1-36 s after touching down, 5-60 m from the man who kills it - so the fix is who lands beside
  // whom, not how well they shoot. 0 = off: the claims below then draw exactly the numbers they always did.
  const sep = PACE.dropSepM || 0, sep2 = sep * sep;
  const placed = [];
  const clear = (x, z) => {
    for (let i = 0; i < placed.length; i++) { const dx = placed[i].x - x, dz = placed[i].z - z; if (dx * dx + dz * dz < sep2) return false; }
    return true;
  };
  const claim = (list) => {
    if (!list || !list.length) return null;
    let k = Math.floor(rng() * list.length);
    for (let n = 0; n < list.length; n++, k = (k + 1) % list.length) {
      if (!list[k].taken && (!sep || clear(list[k].x, list[k].z))) { list[k].taken = true; return list[k]; }
    }
    return null;
  };
  const poiLists = [];
  for (const pp of pois) if (byPoi[pp.id]) poiLists.push(byPoi[pp.id]);
  const claimAnyPoi = () => {
    if (!poiLists.length) return null;
    const k0 = Math.floor(rng() * poiLists.length);
    for (let n = 0; n < poiLists.length; n++) { const s = claim(poiLists[(k0 + n) % poiLists.length]); if (s) return s; }
    return null;
  };
  // Nothing clears the separation (a small island fills up: 13 of 49 bots still landed within 50 m of another
  // at 100 m on isla_viva): take the untaken gun spot FARTHEST from every landing already placed - best candidate,
  // no rng draw - instead of dropping the rule altogether.
  const nearestPlaced = (x, z) => {
    let m = 1e18;
    for (let i = 0; i < placed.length; i++) { const dx = placed[i].x - x, dz = placed[i].z - z, d2 = dx * dx + dz * dz; if (d2 < m) m = d2; }
    return m;
  };
  const allLists = [spots.wild].concat(poiLists);
  const claimFarthest = () => {
    let best = null, bd = -1;
    for (let l = 0; l < allLists.length; l++) {
      const list = allLists[l];
      for (let i = 0; i < list.length; i++) {
        if (list[i].taken) continue;
        const d = nearestPlaced(list[i].x, list[i].z);
        if (d > bd) { bd = d; best = list[i]; }
      }
    }
    if (best) best.taken = true;
    return best;
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
      let s = claim(byPoi[p.id]);
      if (!s && sep) s = claim(spots.wild) || claimAnyPoi() || claimFarthest();    // this POI has no spot left that clears the others: land elsewhere
      b.bb.dropTarget = s ? { x: s.x, z: s.z } : { x: p.x + (rng() - 0.5) * p.r, z: p.z + (rng() - 0.5) * p.r };
    } else {
      let s = claim(spots.wild);
      if (!s && sep) s = claimAnyPoi() || claimFarthest();
      if (s) b.bb.dropTarget = { x: s.x, z: s.z };
      else {
        let gp = W.map.randomGroundPos(rng);
        if (sep) {       // best of 24 random ground points: the one farthest from every landing placed so far
          let bd = nearestPlaced(gp.x, gp.z);
          for (let tries = 0; tries < 23 && bd < sep2; tries++) { const g2 = W.map.randomGroundPos(rng), d2 = nearestPlaced(g2.x, g2.z); if (d2 > bd) { bd = d2; gp = g2; } }
        }
        b.bb.dropTarget = { x: gp.x, z: gp.z };
      }
    }
    placed.push(b.bb.dropTarget);
    // BOT_PACE.earlyChutePct: this share of the bots that are not rushers opens the canopy at the jump and floats
    // down (~45 s at the canopy's 5.5 m/s instead of ~25 s of freefall + canopy). All 49 bots used to touch down
    // inside the same 11 s (22-33 s), so every landing zone was live at once; a real bus drop spreads that over a
    // minute. Measured (the same 9 storm-on matches, 0 vs 40 %): first-60-s deaths max 12 -> 9 (median 5 -> 2),
    // median end 707 -> 701 s, circle 5 reached 7 -> 8 of 9; floating bots shot in the air: 1 of 37 first-minute deaths.
    b.earlyChute = PACE.earlyChutePct > 0 && b.actor.personality !== "rusher" && b.chuteRoll < PACE.earlyChutePct;
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
  if (IND.map !== W.map) indEnsure(W);       // (Wave 8) the room graph and the cover test's cell table: built once per map, before the first brain tick
  if (OCC.map !== W.map && !W.map.hasCollidersNear) occBuild(W.map);
  if (nav.job && !nav.ready) navArm(W);      // (Wave 7) the barrier: the first tick of a match never runs on a half-baked grid
  if (nav.ready) navTick(W);                 // (Wave 7) the bake schedule: a slice of the building tile in progress
  // Cover scans are the one genuinely expensive thing a brain can do, so they are
  // rationed GLOBALLY rather than per-bot: 2 full scans per frame across all 49
  // brains. With ~24 bots fighting at once every fighter still gets a slot about
  // every 12 frames (~0.2s), far more often than the re-plan interval needs.
  _coverBudget = 2;
  nav.q = NAV_Q_PER_FRAME;
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
  // BOT_PACE.endgamePhase: "endgame" (<= 10 alive: campers stop camping, everyone hunts, +20 to ENGAGE) only counts
  // once the storm has reached this circle. With the first-minutes brawls gone, ten left alive happens in circle 2 and
  // the hunt then ends the match in ~100 s, long before the storm does.
  const endgame = alive <= 10 && (!st || st.phase >= PACE.endgamePhase);

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
    // BOT_PACE.rotateLeadS: the leisurely "40" rotation starts only this many seconds before the
    // "70" one, instead of at second 0 - every bot outside the next ring used to start walking to
    // the centre the moment it had a gun, so the whole lobby converged inside the first two minutes.
    if (rotScore === 40 && PACE.rotateLeadS >= 0 && timeLeft > needS * 2 + PACE.rotateLeadS) rotScore = 0;
  }
  s.ROTATE = rotScore;
  s.CAMP = (a.personality === "camper" || a.personality === "sniper") && !outsideNext && !bb.target && !endgame ? 34 : 0;
  // PUSH toward gunfire — but not into it at 30 EHP: a hurt bot that pushes a
  // fight it only heard is feeding it. Healthy aggressors still go.
  s.PUSH = bb.heard && W.t - bb.heard.t < 6 && (a.personality === "rusher" || a.personality === "rotator" || a.personality === "flanker") && !endgame && myEhp >= 90 && b.pushRoll < PACE.pushPct && bb.heard.d < PACE.pushM ? 48 : 0;
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
    bb.lootId = grab.id; bb.lootType = "item"; bb.nearLootT = 0;
    setLootGoal(bb, grab);
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
  const noticeM = paceAt(PACE.noticeM, a.tier || 3);
  for (const t of W.actors) {
    if (t === a || !t.alive) continue;
    if (bb.avoidId === t.id && W.t < (bb.avoidUntil || 0)) continue;   // fatigue cooldown
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const d = hyp(dx, dz);
    if (d > 200) continue;
    // A bot notices a stranger only inside its tier's reach (BOT_PACE.noticeM) unless it is already fighting
    // him or he just shot it. Distance was the one thing every tier saw identically: 200 m for all.
    if (d > noticeM && bb.target !== t.id && !(a.lastAttacker === t.id && W.t - (a.lastDamageT || -99) < 4)) continue;
    // vision: wide ~160° cone; anyone within 15m registers regardless of
    // facing (you notice someone sprinting past you); heard shooters = 360°
    const angTo = Math.atan2(dx, dz);
    let dd = Math.abs(((angTo - Math.atan2(-Math.sin(a.yaw), -Math.cos(a.yaw))) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    const heardHim = bb.heard && bb.heard.shooterId === t.id && W.t - bb.heard.t < 4;
    if (dd > 1.4 && d > 15 && !heardHim && bb.target !== t.id) continue;
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
    // (Wave 7b, S1) the sight line LAST, and only for a candidate that would win: a seen candidate replaces the best only when
    // sd < bestD, so one that cannot win needs no march (the same choice as before; losBlocked has no lasting side effect - its
    // collider queries only stamp their own results). It was the costliest call of the think tick (maps.js losBlocked 3.7 KB
    // of garbage a frame on Isla Viva, every candidate in reach every think).
    if (!(sd < bestD)) continue;
    if (W.map.losBlocked(eye.x, eye.y, eye.z, t.pos.x, t.pos.y + 1.2, t.pos.z)) continue;
    bestD = sd; best = t;
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
    if (!pick || pick.id !== bb.lootId) bb.nearLootT = 0;
    bb.lootId = pick ? pick.id : null;
    bb.lootType = pick ? pick.type : null;
    if (pick) {
      setLootGoal(bb, pick);                                         // y: loot on an upper floor
    } else {
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
    const nr = st.nextRadius != null ? st.nextRadius : st.radius;
    const rr = nr * (0.25 + rng() * 0.5);
    const ang = rng() * Math.PI * 2;
    bb.moveTo = { x: cx + Math.cos(ang) * rr, z: cz + Math.sin(ang) * rr };
    // BOT_PACE.rotateEdge: play the EDGE. Aim for the nearest point just inside the next ring, on
    // the bot's own bearing from its centre, instead of a random point in its inner 25-75 %. Every
    // bot used to walk to the middle, so the whole lobby converged on one spot ~100 s in.
    if (PACE.rotateEdge > 0) {
      const dx = a.pos.x - cx, dz = a.pos.z - cz, d = hyp(dx, dz);
      if (d > 1e-3) {
        const f = PACE.rotateEdge + (rng() - 0.5) * 0.16;
        bb.moveTo.x = cx + dx / d * nr * f; bb.moveTo.z = cz + dz / d * nr * f;
      }
    }
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
    bb.moveTo = t ? { x: t.pos.x, z: t.pos.z, y: t.pos.y } : randNear(W, a, 30, rng);   // (Wave 5) y: arrive on HIS floor
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
    if (nearT) {
      const hx = nearT.pos.x + (rng() - 0.5) * 44, hz = nearT.pos.z + (rng() - 0.5) * 44;   // (same two draws, same order)
      // (Wave 5) the floor of the fuzzed point at HIS height: the goal is a place on his storey, not a column through the
      // map. NaN (water, a wall, a floor more than a step below him) -> a floor-blind goal, as before.
      const hy = standAt(W, hx, hz, nearT.pos.y);
      bb.moveTo = hy === hy ? { x: hx, z: hz, y: hy } : { x: hx, z: hz };
    } else bb.moveTo = randNear(W, a, 50, rng);
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

const NAV_UNREACHABLE = 25;       // pickLoot: a candidate the town grid cannot route to loses this many points
const _pkS = [], _pkN = [];       // pickLoot's best-K scratch (score, loot), best first
function pickLoot(W, a, near) {
  const upgraded = isUpgraded(a);
  // out of ammo everywhere → ammo boxes and chests ARE the priority
  const dry = !a.inventory.slots.some((s) => s && s.kind === "weapon" && slotAmmo(a, s) > 0);
  // (Wave 7, lane 7B2) K = 1 is the old scan (the strict > keeps the first of equal scores). With the town grid armed the best K are kept
  // and re-priced by their route: score - 0.4 x metres of PATH instead of 0.4 x metres of straight line, so the gun behind a wall
  // is not "8 m away" and the one across a street is not "nearer" than the one on the way; a candidate with no route loses 25 points.
  const K = nav.ready ? NAV_PICK_K : 1;
  _pkS.length = 0; _pkN.length = 0;
  // (Wave 8) CLEAR THE HOUSE: inside a furnished house the loot of that house is worth IND_LOOT_HOUSE points more (its own room IND_LOOT_ROOM): a bot
  // takes what the house holds before it crosses the street for the next one (a candidate's room from roomAt; -1 = no houses / outdoors: no change)
  const myR = IND.H !== null && a.brain ? myRoom(W, a.brain) : -1;
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
    if (myR >= 0) { RAQ[0] = n.pos.x; RAQ[1] = n.pos.y; RAQ[2] = n.pos.z; const lr = roomAtQ(W); if (lr >= 0 && IND.R[lr].h === IND.R[myR].h) score += lr === myR ? IND_LOOT_ROOM : IND_LOOT_HOUSE; }
    if (score > (_pkN.length < K ? -1 : _pkS[K - 1]) && !lowCeiling(W, n.pos.x, n.pos.y, n.pos.z) && !offShore(W, a, n.pos)) {   // (only a would-be winner pays for the probes)
      let i = _pkN.length;
      while (i > 0 && _pkS[i - 1] < score) i--;          // after the equal scores: the first of equals wins
      _pkS.splice(i, 0, score); _pkN.splice(i, 0, n);
      if (_pkN.length > K) { _pkS.length = K; _pkN.length = K; }
    }
  }
  if (!_pkN.length) return null;
  if (K === 1) return _pkN[0];
  nav.st.picks++;
  let bi = 0, bv = -1e9;
  for (let i = 0; i < _pkN.length; i++) {
    const n = _pkN[i];
    let v = _pkS[i], p = null;
    // the favourite is always priced (its route becomes the bot's); a runner-up only when a longer route could still flip the order: a route is
    // 0.4 points a metre, the walks of a town are rarely more than 30 m longer than the line (a query is 0.1-0.7 MB of garbage: 87 % of all of them
    // were these candidates before this margin)
    if (nav.q > 0 && (i === 0 || _pkS[0] - _pkS[i] <= NAV_PICK_MARGIN) && navBoth(a.pos.x, a.pos.z, n.pos.x, n.pos.z)) {
      nav.q--;
      const gq = n.stand || n.pos;                         // (K2) a house thing is priced by the route to where it is taken from (its stand point)
      p = gridPath(a.pos.x, a.pos.y, a.pos.z, gq.x, gq.z, gq.y, i > 0, true);     // only the straight-line favourite queues its building when it is not baked yet
      if (p) { v += n.d * 0.4 - Math.max(n.d, navLen(a, p)) * 0.4; nav.st.pickPaths++; }
      else if (navMiss) nav.st.pickMiss++;                // the tiles are queued, not baked yet: no verdict
      else { v -= NAV_UNREACHABLE; nav.st.pickNulls++; }
    }
    if (v > bv) { bv = v; bi = i; }
  }
  return _pkN[bi];
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
    if (b.earlyChute) {
      // open the canopy once, at the jump (glideStep: jump toggles it, so only while it is shut and never
      // toggled), then hold over the spot under it instead of circling past it at 8.5 m/s
      if (!a.chute && !a.chuteToggled) inp.jump = true;
      if (a.chute && d < 12) inp.mz = 0;
    }
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

  // PIN DETECTOR (Wave 5): trying to move for most of a half-second and ending it within 15 cm of where it began. stuckT
  // needs a frame under 2 cm, which a bot wiggling a centimetre a frame (a slide that flip-flops, a strafe against a corner)
  // never has, so none of the recovery ran for it; the net displacement of a window cannot be gamed that way.
  if ((inp.mz || inp.mx) && a.onGround && !bb.chestId) bb.pinIntent += dt;
  if (W.t - bb.pinT >= 0.5 || W.t < bb.pinT) {
    const dxp = a.pos.x - bb.pinX, dzp = a.pos.z - bb.pinZ;
    if (bb.pinIntent >= 0.4 && dxp * dxp + dzp * dzp < 0.15 * 0.15) bb.pinN++; else bb.pinN = 0;
    bb.pinT = W.t; bb.pinX = a.pos.x; bb.pinZ = a.pos.z; bb.pinIntent = 0;
    if (bb.pinN >= 2) { bb.pinN = 0; pinRecover(W, b); }
  }

  // (Wave 8 fix round, lane K2) INSIDE A SOLID. A bot whose capsule centre is INSIDE a solid box (not on it: the box spans its body) cannot walk out -
  // player.js lets it leave a box only by not going deeper, and inside two overlapping boxes every heading goes deeper into one of them. Measured: seed
  // 51002 Savanna, a bot that landed inside a diagonal stepped wall at (489.3, -153.2) held there ~200 s, onGround false (so the pin detector, which
  // wants the ground, never ran). Every 0.5 s: if it moved < 15 cm across the ground (and was trying to, or is in the air) and its centre is inside a solid for two
  // windows running, it is put at the nearest spot round it where a standing capsule fits (escapeSolid). Never fires for a bot that is not inside a box.
  if (!a.gliding && (W.t - bb.solidT >= 0.5 || W.t < bb.solidT)) {
    const sx = a.pos.x - bb.solidX, sz = a.pos.z - bb.solidZ;      // (horizontal: the wedged bot bobbed 10.5-11.8 m up and down in place)
    const still = sx * sx + sz * sz < 0.15 * 0.15 && (inp.mz || inp.mx || !a.onGround);
    bb.solidT = W.t; bb.solidX = a.pos.x; bb.solidZ = a.pos.z;
    if (still && insideSolid(W, a.pos.x, a.pos.y, a.pos.z)) { if (++bb.solidN >= 2) { bb.solidN = 0; escapeSolid(W, b); } }
    else bb.solidN = 0;
  }
  // (K2, re-run) PINNED OFF THE ROOM'S FLOOR. A bot that means to move (an intent, or a travelling state held still by the wall guard) but stays off its room's walkable area - on a piece of furniture 0.3-3 m over the
  // floor, or in a floor pocket outside the walk rects - and gets nowhere (< 15 cm across the ground) for FURN_ESC_N windows of 0.5 s running is put at the
  // nearest free spot of that room's walk area, on its floor (escapeToWalk): the push-out the detector above gives a bot inside a box. By then
  // offFurniture has tried its committed headings (0.6 s each). Measured: a bot on a crate stack's top in a Deepwood lakeside house (furntop probe,
  // seed 7) still stood there after 15 s.
  // (K2, re-run 4) ... and a TRAVELLING bot (LOOT / ROTATE / ...) that stays off the walkable area FURN_DWELL_N windows running however much it moves:
  // a floor pocket closed by furniture (the planners answer null from inside it: findPath / findExit start on a blocked cell) where it hops on and off
  // the low pieces round it. Measured (furntop, ashgrid seed 7, cmp09@p4's storage room): a ROTATE bot, path null, bounced between the floor and a drum
  // inside 5 m for 32 s (the previous file) - never still for 0.5 s, so the detector above never ran.
  if (IND.H !== null && (W.t - bb.furnT >= 0.5 || W.t < bb.furnT)) {
    const fx = a.pos.x - bb.furnX, fz = a.pos.z - bb.furnZ;
    const free = !a.gliding && !bb.chestId, travel = free && !!MOVING_STATES[b.state];
    const still = fx * fx + fz * fz < 0.15 * 0.15 && (inp.mz || inp.mx || MOVING_STATES[b.state]) && a.onGround && free;
    bb.furnT = W.t; bb.furnX = a.pos.x; bb.furnZ = a.pos.z;
    const gi = still ? offWalkRoom(W, b, true) : travel ? offWalkRoom(W, b, false) : -1;     // (the travel-only test reads the room without refreshing the brain's cached one)
    if (gi >= 0 && still && ++bb.furnN >= FURN_ESC_N) { bb.furnN = 0; bb.furnD = 0; escapeToWalk(W, b, gi); }
    else if (gi >= 0 && travel && ++bb.furnD >= FURN_DWELL_N) { bb.furnN = 0; bb.furnD = 0; if (escapeToWalk(W, b, gi)) nav.st.furnDwell++; }
    if (!(gi >= 0 && still)) bb.furnN = 0;
    if (!(gi >= 0 && travel)) bb.furnD = 0;
  }

  // PROGRESS BREAKER for the fight and the heal (Wave 5; Unreal's path follower does block detection the same way). The
  // hard breaker below exempts them - standing still is their job - but a bot that is TRYING to move (strafe, back off,
  // retreat) and is pinned solid is not standing still by choice. guardMove keeps most of these from happening; this is
  // what frees the ones it cannot see (a corner the held list missed, a prop that was spawned after it).
  if ((b.state === "ENGAGE" || b.state === "HEAL") && bb.stuckT > FIGHT_UNSTICK_S && W.t - bb.unstickT > FIGHT_UNSTICK_GAP_S) unstickFight(W, b);

  // HARD BREAKER (audit S7: one bot sat in a Coco Village corner for 329 s while
  // every softer recovery kept firing). A bot that has meant to be travelling but
  // stayed inside the same 2 m for 12 s abandons its goal and walks OUT: the
  // nearest reachable open-sky ground (via the stairs, the door, or a drop), found
  // at its own floor height. Fights, heals and chest channels are exempt:
  // standing still is their job. A CAMP bot is exempt only once it is AT its spot
  // (Wave 5): on its way there it is a traveller like any other, and a camp spot
  // behind a wall was a goal it re-tried for the rest of the match.
  const campWalk = b.state === "CAMP" && bb.campSpot && hyp(bb.campSpot.x - a.pos.x, bb.campSpot.z - a.pos.z) > 4;
  if ((MOVING_STATES[b.state] || campWalk) && !bb.chestId && !a.healing && !a.emoting) {
    if (!bb.anchor || hyp(a.pos.x - bb.anchor.x, a.pos.z - bb.anchor.z) > 2) {
      if (!bb.anchor) bb.anchor = { x: 0, z: 0 };
      bb.anchor.x = a.pos.x; bb.anchor.z = a.pos.z; bb.anchorT = W.t;
    } else if (W.t - bb.anchorT > 12) {
      if (campWalk) { bb.path = null; bb.pathGoal = null; bb.progGoal = null; onEnter(W, b, "CAMP"); }   // another spot (seeded draw)
      else breakOut(W, b);
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
/** (K2) the point (x, y = feet, z) lies inside the footprint of a solid box that spans the body above the step-up (a ramp never counts: its own rules hold) */
const _solidCols = [];
function insideSolid(W, x, y, z) {
  const cols = W.map.queryColliders(x, z, 0.6, _solidCols);
  const h = K.PLAYERK.height;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.dead || c.kind === "ramp") continue;
    if (x <= c.minX + 0.02 || x >= c.maxX - 0.02 || z <= c.minZ + 0.02 || z >= c.maxZ - 0.02) continue;
    if (c.maxY > y + NAV_STEP_UP && c.minY < y + h - 0.1) return true;
  }
  return false;
}
const ESC_RINGS = 10, ESC_STEP = 0.4, ESC_DIRS = 16;   // escapeSolid: rings of 0.4 m out to 4 m, 16 headings each (fixed order: deterministic)
const ESC_FACE_M = [0.45, 1.0, 2.0];                    // (K2, re-run 4) how far past a containing box's face: the capsule clear of it, then further out
const ESC_FAR_RINGS = 12, ESC_FAR_STEP = 1.0;           // (K2, re-run 4) last resort: rings of 1 m from 5 m out to 16 m
/** (K2) put a bot that is inside a solid at the nearest spot round it where a standing capsule fits (player.js fitsAt), on the floor there
 *  (supportAt at its own height: never up onto a roof), dry, not more than 4 m below; its path is dropped and re-planned. No spot: nothing changes.
 *  (K2, re-run 4) The rings out to 4 m come first (unchanged). A bot deeper inside a big box than that - a whole block's box: the wedge probe's bot put at
 *  the middle of a 9.7 x 10.2 x 21.6 m box on Savanna seed 51002 was still inside after 20 s, every ring point inside the same box - then steps out
 *  through the faces of the boxes it is inside (nearest face first, 0.45 / 1.0 / 2.0 m past it), and last the far rings (5-16 m). */
function escapeSolid(W, b) {
  const a = b.actor, M = W.map;
  const wy = M.waterY != null ? M.waterY : -1e9;
  const px = a.pos.x, pz = a.pos.z, py = a.pos.y;
  for (let ri = 1; ri <= ESC_RINGS; ri++) {
    const r = ri * ESC_STEP;
    for (let k = 0; k < ESC_DIRS; k++) {
      const an = k * (Math.PI * 2 / ESC_DIRS);
      if (escTry(W, b, px + Math.cos(an) * r, pz + Math.sin(an) * r, wy)) return true;
    }
  }
  // the faces of every box the bot is inside (insideSolid's test), as exits sorted by distance (Array sort is stable: ties keep the collider order).
  // Copied out first: escTry's own queries reuse the shared query array. (Rare path: the bot is inside a solid with no free spot within 4 m.)
  const cols = M.queryColliders(px, pz, 0.6, _solidCols), h = K.PLAYERK.height, ex = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.dead || c.kind === "ramp") continue;
    if (px <= c.minX + 0.02 || px >= c.maxX - 0.02 || pz <= c.minZ + 0.02 || pz >= c.maxZ - 0.02) continue;
    if (!(c.maxY > py + NAV_STEP_UP && c.minY < py + h - 0.1)) continue;
    ex.push([px - c.minX, c.minX, pz, -1, 0], [c.maxX - px, c.maxX, pz, 1, 0], [pz - c.minZ, px, c.minZ, 0, -1], [c.maxZ - pz, px, c.maxZ, 0, 1]);
  }
  ex.sort((p, q) => p[0] - q[0]);
  for (let i = 0; i < ex.length; i++) {
    const e = ex[i];
    for (let k = 0; k < ESC_FACE_M.length; k++) if (escTry(W, b, e[1] + e[3] * ESC_FACE_M[k], e[2] + e[4] * ESC_FACE_M[k], wy)) return true;
  }
  for (let ri = 1; ri <= ESC_FAR_RINGS; ri++) {
    const r = ESC_RINGS * ESC_STEP + ri * ESC_FAR_STEP;
    for (let k = 0; k < ESC_DIRS; k++) {
      const an = k * (Math.PI * 2 / ESC_DIRS);
      if (escTry(W, b, px + Math.cos(an) * r, pz + Math.sin(an) * r, wy)) return true;
    }
  }
  return false;
}
/** (K2) one escapeSolid candidate: the floor at (x, z) under the bot's own height (dry, not more than 4 m below) where a standing capsule fits and is not
 *  inside a solid - the bot is put there (its path dropped and re-planned). false = not this spot. */
function escTry(W, b, x, z, wy) {
  const a = b.actor, bb = b.bb;
  const s = supportAt(W, x, z, a.pos.y);
  if (!(s === s) || s < a.pos.y - 4 || s < wy + 0.2) return false;
  if (insideSolid(W, x, s, z) || !fitsAt(W, x, z, s)) return false;
  a.pos.x = x; a.pos.y = s; a.pos.z = z;
  a.vel.x = 0; a.vel.y = 0; a.vel.z = 0;
  bb.path = null; bb.pathGoal = null; bb.progGoal = null; bb.nextPathT = 0; bb.stuckT = 0;
  bb.solidX = x; bb.solidZ = z;
  nav.st.solidEsc++;
  return true;
}
const FURN_ESC_N = 8;     // (K2, re-run) 0.5 s windows (4 s) pinned off the room's floor before escapeToWalk
const FURN_DWELL_N = 20;  // (K2, re-run 4) 0.5 s windows (10 s) a travelling bot stays off the room's walkable area, moving or not, before escapeToWalk.
                          // (8 s was tried: in Deepwood's real-step matches seeds 14 / 15 / 22 it fired once each, 0.5-1 s before the bot - a LOOT bot hopping in a pocket -
                          // jumped out on its own (the control run, 8-9 s in the pocket); the furntop drum bot stayed 32 s without it)
/** (K2, re-run) The room (IND.R index) the bot stands in when its feet are OFF that room's walkable floor: 0.3-3 m over the floor (a piece of furniture),
 *  or on the floor outside the walk rects (a pocket). -1 = outdoors, on the walk area, on / beside a stair (its own rules), or a room without walk data.
 *  cached: the room from the brain's own cache (myRoom, which refreshes it); false = a fresh lookup that leaves the cache alone. */
function offWalkRoom(W, b, cached) {
  const a = b.actor, gi = cached ? myRoom(W, b) : roomAt(W, a.pos.x, a.pos.y, a.pos.z);
  if (gi < 0) return -1;
  const R = IND.R[gi], dy = a.pos.y - R.y;
  if (dy > 3.0 || dy < -0.3) return -1;
  if (!(R.r.walk && R.r.walk.length)) return -1;
  if (dy < 0.3 && inWalk(R, a.pos.x, a.pos.z, 0.2)) return -1;
  if (onStairOf(R.h, a.pos.x, a.pos.y, a.pos.z)) return -1;
  return gi;
}
/** (K2, re-run) Is (x, y = feet, z) ON one of the house's stairs: within 0.6 m of its footprint AND within 0.6 m of the flight's height there (the
 *  height runs from the foot to the top along the flight, flat past either end)? The footprint test alone (the old rule) also caught a bot on a crate
 *  stack 0.58 m past a stair's top end, 1.8 m under the landing (Deepwood lakeside@p1, seed 7: it stood on the crates for good). */
function onStairOf(h, x, y, z) {
  const st = h.stairs || [];
  for (let k = 0; k < st.length; k++) {
    const s = st[k];
    if (!(x > s.x0 - 0.6 && x < s.x1 + 0.6 && z > s.z0 - 0.6 && z < s.z1 + 0.6)) continue;
    const F = s.foot, T = s.top;
    if (!F || !T) return true;                    // (no flight data: the old footprint rule)
    const ux = T[0] - F[0], uz = T[2] - F[2], L2 = ux * ux + uz * uz;
    let f = L2 > 1e-6 ? ((x - F[0]) * ux + (z - F[2]) * uz) / L2 : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const sy = F[1] + (T[1] - F[1]) * f;
    if (y > sy - 0.6 && y < sy + 0.6) return true;
  }
  return false;
}
/** (K2, re-run) Put a bot pinned off its room's floor at the nearest spot (rings of 0.4 m out to 4 m, 16 headings: deterministic) that lies 0.1 m inside
 *  one of the room's walk rects, on the room's floor (support within 0.35 m of it), where a standing capsule fits. No spot: nothing changes.
 *  (K2, re-run 4) No such spot within 4 m: the walk rects themselves, nearest first - the point of each nearest the bot (0.1 m inside it), then its centre.
 *  Measured (furntop, isla_viva seed 51204): a bot on a carton in the corner of palm_bay@p1's office, whose walkable area is a strip along the far wall
 *  5.1 m away - every ring point lay outside it, the escape fired every 4 s and found nothing for 15 s. */
function escapeToWalk(W, b, gi) {
  const a = b.actor, R = IND.R[gi], px = a.pos.x, pz = a.pos.z;
  for (let ri = 1; ri <= ESC_RINGS; ri++) {
    const r = ri * ESC_STEP;
    for (let k = 0; k < ESC_DIRS; k++) {
      const an = k * (Math.PI * 2 / ESC_DIRS);
      const x = px + Math.cos(an) * r, z = pz + Math.sin(an) * r;
      if (!inWalk(R, x, z, -0.1)) continue;
      if (walkTry(W, b, R, x, z)) return true;
    }
  }
  const wk = R.r.walk || [], ord = [];
  for (let k = 0; k < wk.length; k++) {
    const q = wk[k], dx = Math.max(q[0] - px, 0, px - q[2]), dz = Math.max(q[1] - pz, 0, pz - q[3]);
    ord.push([dx * dx + dz * dz, k]);
  }
  ord.sort((p, q) => p[0] - q[0]);                       // (stable: ties keep the rect order)
  for (let i = 0; i < ord.length; i++) {
    const q = wk[ord[i][1]], cx = (q[0] + q[2]) * 0.5, cz = (q[1] + q[3]) * 0.5;
    const nx = q[2] - q[0] > 0.2 ? Math.min(Math.max(px, q[0] + 0.1), q[2] - 0.1) : cx, nz = q[3] - q[1] > 0.2 ? Math.min(Math.max(pz, q[1] + 0.1), q[3] - 0.1) : cz;
    if (walkTry(W, b, R, nx, nz) || walkTry(W, b, R, cx, cz)) return true;
  }
  return false;
}
/** (K2) one escapeToWalk candidate: the room's floor at (x, z) (support within 0.35 m of it) where a standing capsule fits and is not inside a solid -
 *  the bot is put there (its path dropped and re-planned). false = not this spot. */
function walkTry(W, b, R, x, z) {
  const a = b.actor, bb = b.bb;
  const s = supportAt(W, x, z, R.y + 0.3);
  if (!(s === s) || s > R.y + 0.35 || s < R.y - 0.35) return false;
  if (insideSolid(W, x, s, z) || !fitsAt(W, x, z, s)) return false;
  a.pos.x = x; a.pos.y = s; a.pos.z = z;
  a.vel.x = 0; a.vel.y = 0; a.vel.z = 0;
  bb.path = null; bb.pathGoal = null; bb.progGoal = null; bb.nextPathT = 0; bb.stuckT = 0; bb.offFurnUntil = -99;
  bb.furnX = x; bb.furnZ = z; bb.solidX = x; bb.solidZ = z;
  nav.st.furnEsc++;
  return true;
}
/** (Wave 5) A fighter / healer pinned solid with a move intent for FIGHT_UNSTICK_S. First time: ENGAGE flips its strafe, HEAL
 *  bans the heading that pinned it for 1.5 s (pickRetreat takes the next one). Pinned again within 8 s: ENGAGE closes in on a
 *  PATH for 3 s when its target was seen in the last 3 s (CLOSEIN: moveToward's A* and shoot-on-the-move, the exit the
 *  endgame stalemate breaker already uses), else walks out the way the hard breaker does. */
/** (Wave 5) Pinned for a second (see the pin detector in act). The fight states take their own recovery; every other state
 *  runs moveToward's hard-stuck branch NOW instead of waiting for the 3 s progress test: a fresh A* path (or the nearest exit),
 *  and the sidestep + hop that branch starts with. */
function pinRecover(W, b) {
  const bb = b.bb;
  if (b.state === "ENGAGE" || b.state === "HEAL") { if (W.t - bb.unstickT > FIGHT_UNSTICK_GAP_S) unstickFight(W, b); return; }
  bb.stuckT = Math.max(bb.stuckT, 2.3);
  bb.nextPathT = 0;
  bb.wallSide = 0;
}
function unstickFight(W, b) {
  const bb = b.bb;
  const again = W.t - bb.unstickT < 8;
  bb.unstickT = W.t;
  bb.stuckT = 0;
  if (b.state === "ENGAGE") {
    bb.strafeDir = -bb.strafeDir; bb.strafeT = Math.max(bb.strafeT, 0.8);
    if (again) {
      if (bb.target && W.t - bb.targetSeenT < 3) { bb.closeInUntil = W.t + 3; b.nextThink = 0; }
      else { breakOut(W, b); b.state = "WANDER"; b.nextThink = W.t + 2; }
    }
  } else {
    bb.hdBadX = bb.hdX; bb.hdBadZ = bb.hdZ; bb.hdBadUntil = W.t + 1.5;
    // Pinned again within 8 s: banning one heading did not free it (isla_viva seed 7: a healer tucked beside the tower stair
    // re-picked a blocked retreat for 11.7 s, three heal cycles on the same spot). Walk out the way the hard breaker does;
    // it heals again from the open once the exit is reached.
    if (again) { breakOut(W, b); b.state = "WANDER"; b.nextThink = W.t + 2; }
  }
}
/** (T-tick-actors B4) findExit stops at the FIRST open-sky cell past the door, and
 *  the movers count "arrived" at 1.6-3 m (path shift 1.6, actMove 3, actLoot 1.8):
 *  a bot in a hut corner was told it had arrived while still inside the doorway,
 *  re-planned straight at its far goal and walked back into the corner (deepwood
 *  seed 23 s12, 6 episodes). Carry the escape on 3 m past the exit cell, along
 *  the last leg, when that spot is standable. */
function extendExit(W, a, ex) {
  const n = ex.length, last = ex[n - 1];
  const px = n > 1 ? ex[n - 2].x : a.pos.x, pz = n > 1 ? ex[n - 2].z : a.pos.z;
  let dx = last.x - px, dz = last.z - pz;
  const L = Math.sqrt(dx * dx + dz * dz);
  if (L < 1e-3) return ex;
  dx /= L; dz /= L;
  for (let k = 3; k >= 1; k--) {
    const x = last.x + dx * k, z = last.z + dz * k;
    const s = standAt(W, x, z, last.y != null ? last.y : a.pos.y);
    if (s === s) { ex.push({ x, z, y: s }); return ex; }
  }
  return ex;
}
function breakOut(W, b) {
  const a = b.actor, bb = b.bb;
  bb.breaks = (bb.breaks || 0) + 1;
  if (bb.lootId) {
    if (!bb.badLoot) bb.badLoot = {};
    bb.badLoot[bb.lootId] = W.t + 60;
    bb.lootId = null;
  }
  // (Wave 8) inside a furnished house the way out is the room graph's nearest street door, walked on the grid (houseExitPath); the window planner's
  // exit search (1.5 m cells) reads a furnished room as a maze. Without houses: findExit, as before.
  const hx = IND.H !== null ? houseExitPath(W, b) : null;
  const ex = hx || findExit(W, a.pos.x, a.pos.y, a.pos.z, 6);
  if (ex && ex.length) {
    if (!hx) extendExit(W, a, ex);
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

// (Wave 7b, S1) steerYawQ: the same turn with the wanted yaw in SYQ[0] (a call boxes a double argument)
const SYQ = new Float64Array(1);
function steerYaw(a, want, dt, speed) {
  SYQ[0] = want;
  steerYawQ(a, dt, speed);
}
function steerYawQ(a, dt, speed) {
  const want = SYQ[0];
  let d = want - a.input.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  a.input.yaw += d * Math.min(1, dt * (speed || 6));
}

/** Does a collider WALL block the walk band at (x,z) for someone at height y?
 *  NOT supportAt: that returns walkable surfaces at-or-below y+STEP_UP by
 *  definition, so "supportAt > y+2.2" was mathematically impossible and the
 *  old probe NEVER fired (found by scanning a whole map for hits: zero).
 *  A wall blocks when its box spans the hop-to-headroom band. A ramp blocks by
 *  the C-RAMP contract (rampBlocks): its sides and underside, not its slope. */
function obstacleAt(W, x, z, y) {
  const cols = W.map.queryColliders(x, z, 0.6);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.dead) continue;
    if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
    if (c.kind === "ramp") { if (rampBlocks(c, x, z, y)) return true; continue; }
    if (c.minY < y + 2.0 && c.maxY > y + 0.55) return true;
  }
  return false;
}

/** THE C-RAMP SWITCH (Wave 5, lane 5B). true = the planner and the standing-point probes treat a ramp's sides and underside as
 *  blocked, as the plan's contract says player.js (lane 5C) and the sim's segment tests do. Set it false if 5C's mover does NOT
 *  block them in the merged build: the planner would then refuse routes the mover allows (measured on the Wave-4 maps, where
 *  the mover still lets bots walk under stairs, before the lenient retry in findPath: 2.8-4.2 points of ground and upper
 *  door-walk reachability, all of it barns and huts whose stair starts at the door and stair wedges whose low edge is more than
 *  a step above the ground). Everything else in this file works with either value. */
const C_RAMP = true;
/** sim rampTopAt, inlined here once for the helpers below (the nav inlines its own copy). */
function rampTopAt(c, x, z) {
  let f;
  if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
  else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
  else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
  else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
  return c.minY + (c.maxY - c.minY) * (f < 0 ? 0 : f > 1 ? 1 : f);
}
/** C-RAMP (contract shared with player.js blockedIn and the sim's segment tests, plan Wave 5): a ramp is a 0.3 m sloped slab,
 *  walkable from its low edge; its SIDES and UNDERSIDE block movement. The underside is the WEDGE between the plane of the low
 *  edge (minY) and the slab - not a column down to the ground: the room on the floor below a stair is open. Point form, for a
 *  standing point (x,z) whose floor is y: the wedge reaches the body (minY below the head band, y + 2.0) and the slab there is
 *  above step reach (y + STEP_UP), i.e. the point is under the slope or beside it. A point ON the slab has the slab as its floor
 *  (the caller took supportAt for y), so it is never blocked, and a bot climbing from the low edge is on the slab, not beside it.
 *  Only STANDING points use this (standAt: cover candidates, landing spots); a look-ahead probe 3 m up a ramp is above step
 *  reach by construction, so wallAhead and the steering probes take ramps as floor and leave the contract to the planner. */
function rampBlocks(c, x, z, y) {
  return C_RAMP && c.minY < y + 2.0 && rampTopAt(c, x, z) > y + NAV_STEP_UP;
}

/** Is a wall too tall to hop blocking the path `look` metres along `yaw`?
 *  Probed at the floor height the bot would have THERE, not at its
 *  current feet: walking up a slope under a slab, the head meets the slab only
 *  further on, and the old same-height probe never saw it. Measured 2026-09-30:
 *  bots walked uphill inside an isla_viva house until the 2nd-floor slab pinned
 *  them (blockedHoriz then refuses every direction) for 200+ s. */
function wallAhead(W, a, yaw, look) {
  WAQ[0] = yaw; WAQ[1] = look;
  return wallAheadQ(W, a);
}
// (Wave 7b, S1) wallAhead with yaw = WAQ[0], look = WAQ[1] (the per-frame callers fill the array: a call boxes double arguments)
const WAQ = new Float64Array(2);
function wallAheadQ(W, a) {
  const yaw = WAQ[0], look = WAQ[1];
  /* (Wave 5) The FLOOR is marched, the wall is tested where it always was. This used to test ONE point `look` m out, at
     max(feet, support there): on a stair that point is far above step reach of the feet, so the band was tested at the wrong
     floor (a false wall on the way UP), and on a descent that passes under the slab it came from the feet-height band caught
     the slab above (a false wall on the way DOWN) - 17-22 % / 9-12 % of the samples on the ramps of the 3 maps (research
     probe_verify), and a plan dropped the moment a bot stepped onto a stair. Now the leg is walked in 0.5 m steps (1 m where no
     ramp is near) from the
     feet with the player.js support rule (a step up to STEP_UP, ramps with the allowance a half-metre step needs, any drop),
     so the floor at the END of the leg is the floor a bot following it would stand on - navWalk's walk. The wall test stays
     the end-point test with its 0.3 m margin: testing every step as well (tried, with and without the margin) reads a leg that clips a corner
     the planner's own leg missed by centimetres as a wall and drops good plans (ground-floor door walks 99 % -> 75-93 %).
     A drop is tested at the old height too (a slab edge in that band blocks the capsule before it falls). Ramps are floor
     here, never a wall (see headingBlocked). One query for the whole leg; written inline - it runs for every moving bot
     every frame, and a call with double arguments boxes them. */
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  const ax = a.pos.x, az = a.pos.z, ex = ax + dx * look, ez = az + dz * look;
  // (Wave 8 fix round, lane K1 -> K2) the leg's vertical band (maps.js queryColliders' optional y0 / y1): its floor can fall or climb at most `look` along a <= 45
  // degree stair, the wall band sits 0.55-2.0 m over that floor - every collider the leg's tests read meets [feet - look - 2, feet + look + 2.6]
  const got = W.map.queryColliders((ax + ex) * 0.5, (az + ez) * 0.5, look * 0.5 + 0.9, _wq, a.pos.y - look - 2, a.pos.y + look + 2.6);
  const x0 = (ax < ex ? ax : ex) - 0.35, x1 = (ax < ex ? ex : ax) + 0.35, z0 = (az < ez ? az : ez) - 0.35, z1 = (az < ez ? ez : az) + 0.35;
  // (Wave 8) written by index, the length set once (maps.js queryColliders' rule): `length = 0` then push() dropped the backing store every call - garbage that
  // grows with the colliders of a furnished house
  let ramps = false, nq = 0;
  for (let i = 0; i < got.length; i++) {
    const c = got[i];
    if (c.maxX >= x0 && c.minX <= x1 && c.maxZ >= z0 && c.minZ <= z1) { _mq[nq++] = c; if (c.kind === "ramp") ramps = true; }
  }
  if (_mq.length !== nq) _mq.length = nq;
  if (!nq) return false;
  // 0.5 m steps where a ramp is near (a steep stair rises ~1 m per step at 0.5 m), 1.5 m steps elsewhere (a plain floor)
  const stepM = ramps ? 0.5 : 1.5;
  const n = look > stepM ? Math.ceil(look / stepM) : 1;
  // the floor along the leg, player.js supportIn at every step: the terrain, or the highest collider top within step reach of
  // the floor so far (which may be LOWER than it: a descent along a stair). The terrain must be followed, not just read at
  // the end: a hut on a slope has its floor 1.5 m above its doorstep, and a leg that "drops" 1.5 m in one probe tests the
  // door's lintel at the OLD feet height (as navWalk does for a real drop) and calls the door a wall - a bot looped in such a
  // hut for 80 s.
  let h = a.pos.y;
  for (let k = 1; k < n; k++) {
    const px = ax + dx * look * k / n, pz = az + dz * look * k / n;
    let s = -1e9;
    for (let i = 0; i < _mq.length; i++) {
      const c = _mq[i];
      if (c.dead || px < c.minX - 0.3 || px > c.maxX + 0.3 || pz < c.minZ - 0.3 || pz > c.maxZ + 0.3) continue;
      const ramp = c.kind === "ramp", top = ramp ? rampTopAt(c, px, pz) : c.maxY;
      if (top > s && top <= h + NAV_STEP_UP + (ramp ? NAV_RAMP_EXTRA : 0)) s = top;
    }
    GA[0] = px; GA[1] = pz; groundA(W, GA, 0);
    const tg = GA[2];
    h = s > tg ? s : tg;
  }
  GA[0] = ex; GA[1] = ez; groundA(W, GA, 0);
  let s = GA[2];
  for (let i = 0; i < _mq.length; i++) {
    const c = _mq[i];
    if (c.dead || ex < c.minX - 0.3 || ex > c.maxX + 0.3 || ez < c.minZ - 0.3 || ez > c.maxZ + 0.3) continue;
    const ramp = c.kind === "ramp", top = ramp ? rampTopAt(c, ex, ez) : c.maxY;
    if (top > s && top <= h + NAV_STEP_UP + (ramp ? NAV_RAMP_EXTRA : 0)) s = top;
  }
  for (let i = 0; i < _mq.length; i++) {
    const c = _mq[i];
    if (c.dead || c.kind === "ramp" || ex < c.minX - 0.3 || ex > c.maxX + 0.3 || ez < c.minZ - 0.3 || ez > c.maxZ + 0.3) continue;
    if (c.minY < s + 2.0 && c.maxY > s + 0.55) return true;
    if (s < h && c.minY < h + 2.0 && c.maxY > h + 0.55) return true;
  }
  return false;
}
const _mq = [];                   // wallAhead's swept-box subset

// ── LOCAL WALL PROBE: fight / heal / reload steering (Wave 5, lane 5B) ───────────────────────────────────────
// A grid version of Detour's moveAlongSurface (https://recastnav.com/classdtNavMeshQuery.html): before a state writes raw
// inp.mx / inp.mz, ask whether the WORLD heading that input produces meets a wall within WALL_LOOK metres - probed at the
// floor height THERE, wallAhead's rule - and if it does, try the mirrored strafe, then slide along the wall (its tangent),
// else stand still on that axis. Unreal's path follower does the same block detection
// (https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/AIModule/UPathFollowingComponent).
// Measured on the Wave-4 build (7 storm-on matches, 3 maps): 25.7 % of the indoor ENGAGE + HEAL movement ticks were blocked
// (ENGAGE strafed / backed / hopped into walls, HEAL backed into them) against 1.2 % outdoors, because those states steer
// by raw input and only moveToward ever looked at a wall.
const WALL_LOOK = 0.9;            // metres ahead the steering probes
const WALL_REUSE_S = 0.1;         // a held collider list stays valid this long (sim time) ...
const WALL_REUSE_M = 0.45;        // ... and while the bot has moved less than this
const WALL_QR = 2.4;              // list radius: capsule 0.45 + look 0.9 + margin 0.3 + the reuse drift, with slack
const FIGHT_UNSTICK_S = 0.8;      // pinned this long with a move intent in ENGAGE / HEAL -> recover (the hard breaker skips them)
const FIGHT_UNSTICK_GAP_S = 1.6;
const _wq = [];                   // queryColliders out-param scratch
const _wn = { x: 0, z: 0 };       // wall face normal scratch
const _gh = { x: 0, z: 0 };       // heading scratch

/** This bot's colliders within WALL_QR of it. ONE queryColliders per bot per 0.1 s of sim time (the budget is <= 150 a frame):
 *  every probe of the frame, any number of headings, reads the held list. queryColliders hands back every collider of the
 *  16 m cells its box touches, so the list is cut down to those within reach. A pure function of sim state (the clock is W.t). */
function wallCols(W, b) {
  const a = b.actor, bb = b.bb, list = bb.wallCols;
  const dx = a.pos.x - bb.wallX, dz = a.pos.z - bb.wallZ;
  if (W.t - bb.wallT <= WALL_REUSE_S && W.t >= bb.wallT && dx * dx + dz * dz <= WALL_REUSE_M * WALL_REUSE_M) return list;
  const got = W.map.queryColliders(a.pos.x, a.pos.z, WALL_QR, _wq);
  const x0 = a.pos.x - WALL_QR, x1 = a.pos.x + WALL_QR, z0 = a.pos.z - WALL_QR, z1 = a.pos.z + WALL_QR;
  let n = 0;                       // (Wave 8) by index, the length set once (see wallAheadQ)
  for (let i = 0; i < got.length; i++) {
    const c = got[i];
    if (c.maxX >= x0 && c.minX <= x1 && c.maxZ >= z0 && c.minZ <= z1) list[n++] = c;
  }
  if (list.length !== n) list.length = n;
  bb.wallT = W.t; bb.wallX = a.pos.x; bb.wallZ = a.pos.z;
  return list;
}

const _hd = { x: 0, z: 0 };       // headingBlocked's heading (a call with double arguments boxes them: framecheck allocation)
/** Does walking WALL_LOOK m along the world heading _hd (unit) meet a wall? Probed at the floor height there - never below the
 *  current feet, so a railing at a ledge edge still counts - exactly wallAhead's rule: the floor is the highest top within step
 *  reach of the feet (player.js supportIn: terrain always counts; a ramp's slab with the allowance a half-metre probe step
 *  needs on a steep one), and a wall is a box (0.3 m margin) whose span meets the band from the knee to the head there.
 *  Ramps are floor, never a wall, in THIS wall test and in wallAhead (a climb from the low edge must stay open); their sides and
 *  underside are refused by the second half, rampLegBlocked, which asks the mover's own rule (the heal pocket fix: a heading
 *  into a stair's side read free here while player.js blocked it). Returns the blocking collider or null. Everything inline:
 *  this runs for every fighting bot every frame. */
function headingBlocked(W, list, a) {
  const px = a.pos.x + _hd.x * WALL_LOOK, pz = a.pos.z + _hd.z * WALL_LOOK, y0 = a.pos.y;
  GA[0] = px; GA[1] = pz; groundA(W, GA, 0);
  let s = GA[2];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.dead || px < c.minX - 0.3 || px > c.maxX + 0.3 || pz < c.minZ - 0.3 || pz > c.maxZ + 0.3) continue;
    const top = c.kind === "ramp" ? rampTopAt(c, px, pz) : c.maxY;
    if (top > s && top <= y0 + NAV_STEP_UP + (c.kind === "ramp" ? NAV_RAMP_EXTRA : 0)) s = top;
  }
  const fy = s > y0 ? s : y0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.dead || c.kind === "ramp" || px < c.minX - 0.3 || px > c.maxX + 0.3 || pz < c.minZ - 0.3 || pz > c.maxZ + 0.3) continue;
    if (c.minY < fy + 2.0 && c.maxY > fy + 0.55) return c;
  }
  return rampLegBlocked(W, list, a);
}

/** (heal pocket fix) The RAMP half of headingBlocked: does walking WALL_LOOK m along _hd run into a ramp's SIDE or UNDERSIDE?
 *  The wall test above takes every ramp as floor (right for a climb, and a ramp's slab within a metre of the feet is "floor"
 *  there), so a heading INTO a stair's side read free while player.js blockedIn refuses it (C-RAMP: the sim's rampBlocks): a
 *  healer tucked beside the isla_viva seed 7 tower stair re-picked that heading and ground against the plank (pocket_probe: 0
 *  of 86 side placements got out on the Wave-5 build). This marches the leg the way the mover walks it, in RAMP_STEP m steps:
 *  the floor under each step is player.js supportIn (terrain, or the highest top within STEP_UP of the feet so far; a ramp's
 *  slab included, so a climb from the low edge keeps its floor on the slab and is never blocked), and each ramp is asked the
 *  sim's own rampBlocks at that floor, with blockedIn's "already held" rule: a step that does not go deeper into a zone the
 *  body is ALREADY in is allowed (a bot beside a stair may walk along it, or away). The same rule the standing-point probes
 *  use, applied along the heading. Returns the blocking ramp or null. Cheap exit when no ramp is near the leg. */
const RBQ = new Float64Array(6);          // K.rampBlocksA's numbers [x, z, yd, h, r, stepUp] (unboxed: Wave 7b, S1)
const RAMP_STEP = 0.15;                  // march step (the mover moves < 0.1 m a tick; 0.15 m reads a stair's side the same)
function rampLegBlocked(W, list, a) {
  const ax = a.pos.x, az = a.pos.z, ex = ax + _hd.x * WALL_LOOK, ez = az + _hd.z * WALL_LOOK;
  const rr = K.PLAYERK.radius, hh = K.PLAYERK.height;
  const x0 = (ax < ex ? ax : ex) - rr - 0.3, x1 = (ax < ex ? ex : ax) + rr + 0.3, z0 = (az < ez ? az : ez) - rr - 0.3, z1 = (az < ez ? ez : az) + rr + 0.3;
  let near = false;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.kind === "ramp" && !c.dead && c.maxX >= x0 && c.minX <= x1 && c.maxZ >= z0 && c.minZ <= z1) { near = true; break; }
  }
  if (!near) return null;
  const n = Math.ceil(WALL_LOOK / RAMP_STEP);
  let y = a.pos.y, ox = ax, oz = az;
  for (let k = 1; k <= n; k++) {
    const x = ax + (ex - ax) * k / n, z = az + (ez - az) * k / n;
    // the floor under this step: player.js supportIn over the held list
    GA[0] = x; GA[1] = z; groundA(W, GA, 0);
    let s = GA[2];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.dead || x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      const top = c.kind === "ramp" ? rampTopAt(c, x, z) : c.maxY;
      if (top <= y + NAV_STEP_UP && top > s) s = top;
    }
    const yd = s > y ? s : y;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.kind !== "ramp" || c.dead) continue;
      RBQ[0] = x; RBQ[1] = z; RBQ[2] = yd; RBQ[3] = hh; RBQ[4] = rr; RBQ[5] = NAV_STEP_UP;
      if (!K.rampBlocksA(c, RBQ)) continue;
      RBQ[0] = ox; RBQ[1] = oz; RBQ[2] = y;
      if (K.rampBlocksA(c, RBQ)) {
        // already inside the zone: a step that does not go closer to the footprint is allowed (player.js blockedIn)
        const dx1 = x - (x < c.minX ? c.minX : x > c.maxX ? c.maxX : x), dz1 = z - (z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z);
        const dx0 = ox - (ox < c.minX ? c.minX : ox > c.maxX ? c.maxX : ox), dz0 = oz - (oz < c.minZ ? c.minZ : oz > c.maxZ ? c.maxZ : oz);
        if (dx1 * dx1 + dz1 * dz1 >= dx0 * dx0 + dz0 * dz0) continue;
      }
      return c;
    }
    y = s; ox = x; oz = z;
  }
  return null;
}

/** Outward unit normal (into _wn) of the face of c's 0.3-inflated box that (x,z) is nearest to leaving by. */
function faceNormal(c, x, z) {
  let m = x - (c.minX - 0.3), nx = -1, nz = 0;
  const r = (c.maxX + 0.3) - x, f = z - (c.minZ - 0.3), k = (c.maxZ + 0.3) - z;
  if (r < m) { m = r; nx = 1; nz = 0; }
  if (f < m) { m = f; nx = 0; nz = -1; }
  if (k < m) { nx = 0; nz = 1; }
  _wn.x = nx; _wn.z = nz;
}

/** Wall-aware version of the move input the caller just wrote (inp.mz / inp.mx, in the CURRENT yaw frame; call it AFTER the
 *  yaw has been steered for the frame). Rewrites them in place:
 *    1. the intended heading is free -> untouched;
 *    2. else the MIRRORED strafe (fight states: and the bot's strafeDir flips, so it keeps going that way);
 *    3. else the wall TANGENT (the intent minus its push into the wall), the side it was already leaning to;
 *    4. else stand still: a bot cornered in a closet holds its corner and shoots.
 *  The magnitude of the intent is kept. Returns 0 untouched / 1 mirrored / 2 slid / 3 held. */
function guardMove(W, b, mirror) {
  const a = b.actor, bb = b.bb, inp = a.input;
  const mz0 = inp.mz, mx0 = inp.mx;
  const m = Math.sqrt(mz0 * mz0 + mx0 * mx0);
  if (m < 0.1 || !a.onGround) return 0;
  const B = K.moveBasis(inp.yaw, _mb0);
  const wx = (B.fx * mz0 + B.rx * mx0) / m, wz = (B.fz * mz0 + B.rz * mx0) / m;
  const list = wallCols(W, b);
  if (!list.length) return 0;
  _hd.x = wx; _hd.z = wz;
  const hit = headingBlocked(W, list, a);
  if (!hit) return 0;
  let mode = 3, hx = 0, hz = 0;
  // 2. mirrored strafe
  if (mirror && mx0 !== 0 && Math.abs(mx0) > 0.1) {
    const mxx = (B.fx * mz0 - B.rx * mx0) / m, mzz = (B.fz * mz0 - B.rz * mx0) / m;
    _hd.x = mxx; _hd.z = mzz;
    if (!headingBlocked(W, list, a)) { mode = 1; hx = mxx; hz = mzz; bb.strafeDir = -bb.strafeDir; bb.strafeT = Math.max(bb.strafeT, 0.5); }
  }
  // 3. the wall tangent
  if (mode === 3) {
    const px = a.pos.x + wx * WALL_LOOK, pz = a.pos.z + wz * WALL_LOOK;
    faceNormal(hit, px, pz);
    let tx = -_wn.z, tz = _wn.x;                                  // a tangent of the face
    let side = tx * wx + tz * wz;                                  // lean the way the intent already leans
    if (Math.abs(side) < 0.15) side = (tx * B.rx + tz * B.rz) * (bb.strafeDir || 1);   // head-on: keep the strafe's side
    // COMMIT: a slide, once chosen, is kept for 0.8 s along the same wall until it is blocked. Choosing afresh every frame
    // flip-flopped a bot in a room corner between the two ends of the wall at 60 Hz (measured: 3 s of +-0.01 m jitter that
    // the stuck detectors read as "moving"), because the probe at the corner flips between free and blocked as the bot
    // creeps a centimetre.
    const kept = W.t < bb.slideUntil ? bb.slideX * tx + bb.slideZ * tz : 0;
    if (Math.abs(kept) > 0.5) side = kept;
    if (side < 0) { tx = -tx; tz = -tz; }
    _hd.x = tx; _hd.z = tz;
    if (!headingBlocked(W, list, a)) { mode = 2; hx = tx; hz = tz; }
    else { _hd.x = -tx; _hd.z = -tz; if (!headingBlocked(W, list, a)) { mode = 2; hx = -tx; hz = -tz; } }
    if (mode === 2) {
      // PING-PONG: a slide that has to reverse (the wall ended in a corner) twice inside a few seconds is a bot walking back
      // and forth along a wall with its goal on the far side of it - net displacement ~0 over 3 s although it never stops
      // (probe_match "stuck episodes": 6 for one bot). Reversing again cannot help; it needs a way round: the recovery the
      // pin detector runs (a fresh route / the nearest exit).
      if (W.t < bb.slideUntil + 1.2 && bb.slideX * hx + bb.slideZ * hz < -0.5) {
        if (++bb.slideFlips >= 2) { bb.slideFlips = 0; pinRecover(W, b); }
      } else if (W.t > bb.slideUntil + 2.5) bb.slideFlips = 0;
      bb.slideX = hx; bb.slideZ = hz; bb.slideUntil = W.t + 0.8;
    }
  }
  if (mode === 3) { inp.mz = 0; inp.mx = 0; inp.sprint = false; return 3; }
  inp.mz = (hx * B.fx + hz * B.fz) * m;
  inp.mx = (hx * B.rx + hz * B.rz) * m;
  if (inp.mz <= 0.5) inp.sprint = false;
  return mode;
}

/** Under a roof (indoors): any slab over the bot's footprint 1 m or more above its head, up to a storey and a half. The random
 *  dodge hop is an outdoor move: under a low ceiling the head meets the slab and a capsule jammed under it is blocked in every
 *  direction, and under a high one it is a bot pogo-ing in a house (the plan: "no random fight hop under a roof"). */
function roofedForJump(W, b) {
  const a = b.actor, list = wallCols(W, b);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.dead || c.kind === "ramp") continue;
    if (a.pos.x < c.minX - 0.45 || a.pos.x > c.maxX + 0.45 || a.pos.z < c.minZ - 0.45 || a.pos.z > c.maxZ + 0.45) continue;
    if (c.minY > a.pos.y + 1.0 && c.minY < a.pos.y + 12.0) return true;
  }
  return false;
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
//     at THAT height, and a cell can hold up to NAV_L stacked floors (layers).
//     Drops are legal edges (this game has no fall damage: hardLand is audio and
//     camera only) but cost extra, so stairs win when both exist; drops over
//     6 m and open water are blocked.
// All search state lives in pooled typed arrays validated by a per-search stamp
// (nothing is cleared or allocated per call) with a binary heap for the open set;
// the window's colliders are fetched with ONE query and bucketed per cell.
const CELL = 1.5, GRID_R = 21;           // 43 x 43 cells = a ~64 m window around the bot
const NAV_N = GRID_R * 2 + 1;
const NAV_CELLS = NAV_N * NAV_N;
const NAV_L = 6;                          // stacked floors per cell (a 4-storey tower is terrain + 3 slabs + roof; 3 layers returned null from/to its top floors)
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
    GA[0] = navOX + (ix - GRID_R) * CELL; GA[1] = navOZ + (iz - GRID_R) * CELL; groundA(W, GA, 0);      // W.map.heightAt, unboxed (Wave 7b, S1)
    navTerr[ci] = GA[2];
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
/** Set per search: the START is itself under a ramp slab (a bot that landed, spawned or was left there while the mover still
 *  let it walk under stairs). The contract blocks ENTERING that zone; a bot already in it has to be planned OUT, so this
 *  search treats ramps as it always did (never blocking) rather than returning no path from a start cell it cannot leave. */
let navRampFree = false;
/** The retry switch of findPath / findExit: no route under C-RAMP, so run the search again the way it ran before the contract
 *  (ramps never block) - see findPath. navRampHits counts the ramp blocks a search ran into, so the retry only happens when it
 *  could change the answer. */
let navLenient = false, navRampHits = 0;
const NAV_PULL_PAD = 0.45;
let navPad = 0.3;                 // the wall margin of navWall: 0.3 m everywhere, the string pull on the Savanna asks for the capsule's 0.45 (see navSearch)
/** A wall in the walk band (knee to head) at feet height h. A ramp blocks by the C-RAMP contract: where its slab is above
 *  step reach of the floor this point stands on (h), the point is under the slab or beside it. The slab as a FLOOR is
 *  navSupport's job (it already made h the slab top when the slab is reachable, so a bot climbing it is never blocked). */
function navWall(ci) {
  const x = NF[4], z = NF[5], h = NF[0], pad = navPad;
  for (let k = navBStart[ci], e = navBStart[ci + 1]; k < e; k++) {
    const c = navCols[navBItems[k]];
    if (c.dead) continue;
    if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) continue;
    if (c.kind === "ramp") {
      if (!C_RAMP || navRampFree) continue;
      let f;     // sim rampTopAt, inlined (this runs ~10^5 times per search)
      if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
      else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
      else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
      if (c.minY < h + 2.0 && c.minY + (c.maxY - c.minY) * (f < 0 ? 0 : f > 1 ? 1 : f) > h + NAV_STEP_UP + 0.05) { navRampHits++; return true; }
      continue;
    }
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
    // (T-tick-actors B1) a DROP is walked off at the OLD feet height: a slab edge in
    // that band (the floor above a stair ramp) blocks the capsule before it falls
    if (s < h) { NF[0] = h; const blk = navWall(ci); NF[0] = s; if (blk) return false; }
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
function navSearch(W, sx, sy, sz, tx, tz, ty, mode, minDist, off, offZ) {
  // `off` shifts the whole grid by a fraction of a cell (the bot stays inside the
  // centre cell). See findPath: a 1.5 m grid with the 0.3 m wall margin leaves a
  // 1.4 m doorway an 0.8 m free band, which a grid row hits only about half the
  // time; the half-cell-shifted retry always has a row inside it.
  const o = off || 0, oz = offZ === undefined ? o : offZ;
  // (Wave 7b, S1) navShiftX/Z: the WINDOW centred off the bot (findPathPass's last retry, see there): the search starts in the bot's own cell
  const shX = navShiftX, shZ = navShiftZ, shifted = shX !== 0 || shZ !== 0;
  navPrepare(W, sx + o + shX, sz + oz + shZ);
  navRampFree = navLenient;
  for (let k = 0; k < navCols.length && !navRampFree; k++) {
    const c = navCols[k];
    if (c.kind !== "ramp" || c.dead || sx < c.minX || sx > c.maxX || sz < c.minZ || sz > c.maxZ) continue;
    if (c.minY < sy + 2.0 && rampTopAt(c, sx, sz) > sy + NAV_STEP_UP + 0.05) { navRampFree = true; break; }
  }
  const S = GRID_R * NAV_N + GRID_R;
  const sc = navCellOf(sx, sz);
  NF[4] = sx; NF[5] = sz; NF[6] = sy + NAV_STEP_UP;
  navSupport(W, sc < 0 ? S : sc);
  let sh = NF[0];
  let S0 = S;                       // the start cell (the window's centre, unless shifted)
  if (shifted) {
    // the start is the bot's own cell: walk from the feet to its centre first (the offset rule below); the goal must lie inside the window
    if (sc < 0 || mode !== 0 || navCellOf(tx, tz) < 0) return null;
    S0 = sc;
    NF[8] = sx; NF[9] = sz; NF[10] = sh; NF[11] = navCellX(S0); NF[12] = navCellZ(S0);
    if (!navWalk(W)) return null;
    sh = NF[3];
  } else if (o || oz) {
    // walk from the feet to the centre cell first; if that is walled, no search
    NF[8] = sx; NF[9] = sz; NF[10] = sh; NF[11] = navCellX(S); NF[12] = navCellZ(S);
    if (!navWalk(W)) return null;
    sh = NF[3];
  }
  // goal cell: clamp a far goal onto the window edge along the line to it
  let T = -1, clamped = false;
  if (mode === 0 && shifted) T = navCellOf(tx, tz);
  else if (mode === 0) {
    let gx = tx - sx, gz = tz - sz;
    const m = Math.max(Math.abs(gx), Math.abs(gz)) / CELL;
    if (m > GRID_R - 1) { const k = (GRID_R - 1) / m; gx *= k; gz *= k; clamped = true; }
    T = navCellOf(sx + gx, sz + gz);
    if (T < 0) return null;
  }
  const useTy = mode === 0 && !clamped && ty != null;
  heapN = 0;
  const s = navNodeAt(S0, sh);
  navG[s] = 0;
  heapPush(s, mode === 0 ? navOct(S0, T) : 0);
  let found = -1, bestId = s, bestH = mode === 0 ? navOct(S0, T) : 0, expanded = 0;
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
    if (bestId === s || navOct(S0, T) - bestH < 3) return null;
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
  // (Wave 7, round 2) On the Savanna a pulled shortcut keeps the capsule's whole radius off a wall corner (0.45 m, not the search's 0.3): the legs this pull produced grazed
  // wall ends and fence corners at the 0.3 m margin, and 5.4 % of the FRESH old-planner paths started with a leg that crossed a box of the town (probe_paths' first-blocked
  // test; 0.2 % of the grid's). A shortcut that fails here keeps the raw corner, which the search itself verified at 0.3 m.
  if (W.map.city) navPad = NAV_PULL_PAD;
  for (let i = 0; i < raw.length; i++) {
    const nxt = raw[i + 1];
    if (!nxt) { pulled.push(raw[i]); break; }
    NF[8] = ax; NF[9] = az; NF[10] = ah; NF[11] = nxt.x; NF[12] = nxt.z;
    const ok = navWalk(W);
    // keep the corner when the shortcut is blocked, or lands on another floor
    if (!ok || Math.abs(NF[3] - nxt.y) > 0.6) { pulled.push(raw[i]); ax = raw[i].x; az = raw[i].z; ah = raw[i].y; }
  }
  navPad = 0.3;
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
function findPathOld(W, sx, sy, sz, tx, tz, ty) {
  navRampHits = 0;
  const p = findPathPass(W, sx, sy, sz, tx, tz, ty);
  if (p && !p.partial) return p;
  if (navRampHits === 0) return p;
  /* (Wave 5, C-RAMP) A ramp's sides and underside block the planner now, and the Wave-4 mover does not block them yet: a bot
     can walk in under a stair (a barn's front half, a hut's loft) and then find itself in a pocket the strict planner
     cannot leave - measured: one bot ground against a barn wall for the rest of a 700 s match. When the strict search found
     no COMPLETE route and ramps were what stopped it, search again the way it ran before the contract. The strict answer
     is kept when the retry is no better. Once the mover blocks the same volumes the retry's route simply is not walkable,
     which is no worse than the null it replaces. */
  navLenient = true;
  const q = findPathPass(W, sx, sy, sz, tx, tz, ty);
  navLenient = false;
  return q && !q.partial ? q : (p || q);
}
function findPathPass(W, sx, sy, sz, tx, tz, ty) {
  const p = navSearch(W, sx, sy, sz, tx, tz, ty, 0, 0, 0);
  if (p && !p.partial) return p;
  let best = p;
  // (T-tick-actors B3) the half-cell shift in ALL four diagonal directions: from a
  // bot standing in a room corner the (+,+) shift put the centre cell inside the
  // wall, the walk-to-centre failed and both searches returned null (measured:
  // deepwood seed 13 s25, ashgrid seed 12 s24 - 1.4 m doors, nav null, 6 episodes)
  for (let k = 0; k < 4; k++) {
    const q = navSearch(W, sx, sy, sz, tx, tz, ty, 0, 0, k & 1 ? -NAV_HALF : NAV_HALF, k & 2 ? -NAV_HALF : NAV_HALF);
    if (q && !q.partial) return q;
    if (q && !best) best = q;
  }
  // (Wave 7b, S1) A GOAL ON ANOTHER FLOOR whose way up starts on its FAR side. The window is centred on the bot (+-31.5 m), so a door or stair
  // just past the edge of it (the cliff temples' top floor from the south: the stair foot lies 32.5 m from a bot 25 m away) is invisible, and the
  // search ends on the nearest wrong floor (navcheck top-floor-paths: one of the four starts, on the live build as well). Once more with the
  // window centred between the bot and the goal: both are then 12-16 m from its centre and the detour around the goal fits. Only when
  // everything above found no complete route, the goal is a floor away (a stair is what is missing) and it lies within reach of the window;
  // the route found is the same kind (a search in one window), so nothing else changes.
  if (ty != null && (ty - sy >= ARRIVE_DY || sy - ty >= ARRIVE_DY)) {
    const dx = tx - sx, dz = tz - sz, m = Math.max(Math.abs(dx), Math.abs(dz)) / CELL;
    if (m >= 8 && m <= GRID_R * 1.5) {
      navShiftX = Math.round(dx * 0.5 / CELL) * CELL; navShiftZ = Math.round(dz * 0.5 / CELL) * CELL;
      let q = null;
      try { q = navSearch(W, sx, sy, sz, tx, tz, ty, 0, 0, 0); } finally { navShiftX = 0; navShiftZ = 0; }
      if (q && !q.partial) return q;
    }
  }
  return best;
}
let navShiftX = 0, navShiftZ = 0;         // the window's centre relative to the bot (0 = on the bot): findPathPass's far-side retry only
/** Nearest reachable spot OUTSIDE (on open ground, no roof) at least minDist away. */
function findExit(W, sx, sy, sz, minDist) {
  navRampHits = 0;
  let e = findExitPass(W, sx, sy, sz, minDist);
  if (e || navRampHits === 0) return e;
  navLenient = true;                       // the C-RAMP retry, as in findPath
  e = findExitPass(W, sx, sy, sz, minDist);
  navLenient = false;
  return e;
}
function findExitPass(W, sx, sy, sz, minDist) {
  let e = navSearch(W, sx, sy, sz, 0, 0, null, 1, minDist || 4, 0);
  for (let k = 0; !e && k < 4; k++) e = navSearch(W, sx, sy, sz, 0, 0, null, 1, minDist || 4, k & 1 ? -NAV_HALF : NAV_HALF, k & 2 ? -NAV_HALF : NAV_HALF);
  return e;
}
const NAV_HALF = CELL * 0.5 - 0.01;
// ═════════════════════════════════════════════════════════════════════════════
// THE TOWN NAVIGATION GRID (Wave 7, lane 7B2).
// sim/navgrid.js bakes the Savanna's towns and compounds (towngen's layout, map.city.layout) into a layered grid whose every edge was
// replayed through the REAL mover (doors, rooms, stairs, ramps, drops). Inside those rects findPath asks it (door waypoints first, floors
// and stairs through the grid, a certified straight walk between waypoints) and pickLoot prices candidates by their PATH. Everywhere else
// - open ground between the towns, the other two maps, a match where the module did not load - the 64 m window planner above is in
// charge, unchanged.
// DETERMINISM, AND WHY THE GRID IS LAZY. A building's tile costs 10-190 ms to bake and the whole city has ~620 of them (13 million replayed steps,
// 6-15 s, 5 GB of short-lived garbage): too much for a loading screen and far too much for one frame. The grid is therefore a LAZY world (navgrid
// createWorld({ lazy })): a query never bakes anything - a tile that is not in reads as missing and is only listed (takeWanted) - and the bake
// runs on a fixed SIM-TICK schedule:
//   barrier (before the first tick of a match)  every outdoor tile (463 of them, ~1 ms each; started in attachBrain, run in 12 ms slices in
//                                               the idle time of startMatch's awaits and of the lobby; update() finishes what is left)
//   every tick                                  NAV_STEPS_TICK steps of replay work (~6 ms, counted by navgrid's replay counter, never timed) on the
//                                               building tile in progress; when it is done the next one starts: first the ones a query asked for
//                                               (qNeed, oldest first), then every other building of the towns, nearest to a bot's landing spot first
//                                               (qPre, from assignDrops). A tile is baked and stitched a few hundred steps at a time (navgrid
//                                               beginJob / stepJob), so a 190 ms tile is never one frame; the city is in by ~40 s of match time, during the
//                                               glide and the landing, and after that the schedule costs nothing.
// A bot whose route needs a tile that is not in yet gets null from the grid, falls back to the window planner for that request, and asks
// again; readiness is a function of the tick count and of the queries (all sim state), never of the wall clock. The final graph is the
// same whatever order the tiles come in (equal world hash), and every edge that exists is certified; the wall clock below paces only the
// background slices before the first tick and feeds the stats. `nav.ready` is set by the barrier alone, so a brain attached any other way
// (host hand-over mid-match) keeps the window planner. Grid queries are rationed per frame by COUNT (nav.q, reset in update()).
const nav = { map: null, G: null, world: null, areas: null, ready: false, job: null, cur: null, q: 0, tick: 0, qNeed: [], qPre: [], qKeys: null, st: null };
const NAV_Q_PER_FRAME = 4;        // grid queries per frame over all brains (a query is 1.4-3 ms median; a stuck bot's request is exempt)
const NAV_PICK_K = 3;             // pickLoot keeps the best this-many candidates for pricing by path
const NAV_PICK_MARGIN = 12;       // ... and prices a runner-up only when it is within this many points of the favourite
const NAV_PLAN_MIN_M = 8;         // moveToward plans a route at once for a goal at least this far away inside a town (a nearer one is walked at, and the wall reflexes ask when a wall is in the way)
const NAV_STEPS_TICK = 6000;      // replayed 10 cm steps of tile-bake work per sim tick (~6 ms; a building tile is ~20,000 of them, the whole city ~13 million: in by ~40 s)
// (Wave 8) ... while the DROP lasts (W.phase 'drop': somebody is still in the air) the schedule takes NAV_STEPS_TICK_DROP. The furnished houses made the city's bake
// ~22 million steps on the Savanna (live: 11.6 M), in by ~70 s at 6,000 a tick - past the landing, so the first half-minute of the fight still paid for it. At
// 10,000 during the drop it is in by ~40-45 s again (the Wave-7 design: 'in by the end of the glide'); a step costs ~0.6 us here and makes ~50 B of garbage
// since navgrid's Wave-8 pass (it was ~350 B: the live build's drop already made ~2 MB of bake garbage a frame, this one ~0.5 MB). The phase is sim state.
const NAV_STEPS_TICK_DROP = 10000;
// A* weight 1.6 and the search table's whole 22,000 nodes: on 150 loot-to-loot routes of 10-110 m in the downtown 129 of 150 were found at
// (1.3, 9000) - 15 hit the limit; 144 at (1.3, 22000) and (1.6, 22000) [the other 6 start inside furniture] - at a median 5-7 ms (max 53 ms)
// and routes 1-3 % longer than the optimal ones (7B1 measured hw 1.3; routes of more than ~100 m between upper floors need the larger table)
const NAV_OPTS = { hw: 1.6, maxExpand: 22000 };
const NAV_OPTS_PRICE = { hw: 1.6, maxExpand: 22000, noPull: true };       // pickLoot only needs how long a route is: the node chain, without the string pull (the pull is most of a query's replays and garbage)
const navNow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
const navStats0 = () => ({ queries: 0, ms: 0, maxMs: 0, nulls: 0, misses: 0, fallbacks: 0, skipped: 0, picks: 0, pickPaths: 0, pickNulls: 0, pickMiss: 0,
  exits: 0, coarseMs: 0, coarseJobs: 0, bgMs: 0, barrierMs: 0, req: [0, 0, 0, 0, 0, 0], fineJobs: 0, fineMs: 0, fineMaxMs: 0, slices: 0, sliceMs: 0, sliceMaxMs: 0, jobSlicesMax: 0, ticksWorked: 0, tickMaxMs: 0, prefetch: 0, needJobs: 0, tiles: 0, areas: 0, hops: 0, houseExits: 0, reversed: 0, coverIn: 0, coverInDoor: 0, coverInFail: 0, routedFrames: 0, stairSearch: 0, offFurn: 0, lootParked: 0, solidEsc: 0, furnEsc: 0, furnDwell: 0, error: null });
nav.st = navStats0();

function navReset() {
  if (nav.job && nav.job.timer) clearTimeout(nav.job.timer);
  nav.map = null; nav.G = null; nav.world = null; nav.areas = null; nav.ready = false; nav.job = null; nav.cur = null; nav.q = 0; nav.tick = 0;
  nav.qNeed.length = 0; nav.qPre.length = 0; nav.qKeys = null;
}
function navFail(err) {
  if (!nav.st.error) console.warn("[royale] town nav grid failed (the bots keep the window planner):", err);
  nav.st.error = String(err && err.message || err);
  nav.ready = false; nav.world = null; nav.job = null; nav.cur = null;
}
/** Create the (lazy) grid for this match's map and start baking its outdoor tiles in the background. Savanna only (map.city); a missing
 *  module, a map without a city, or a throw leaves nav.world null and the window planner in charge. */
function startNav(W) {
  if (nav.map === W.map) return;
  navReset();
  nav.map = W.map;
  nav.st = navStats0(); doubleFields(nav.st);      // (Wave 8) ms / maxMs take fractions: double fields from birth (see doubleFields)
  const G = typeof globalThis !== "undefined" && globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.NavGrid;
  const city = W.map && W.map.city;
  if (!G || typeof G.bakeTown !== "function" || typeof G.runJob !== "function" || typeof G.beginJob !== "function" || typeof G.stepJob !== "function" || typeof G.takeWanted !== "function" || !(G.VERSION >= 2) || !city || !city.layout) return;
  try {
    const t0 = navNow(), lay = city.layout;
    // maxMs 0: this call creates the world and bakes ONE tile; the barrier job bakes the rest of the outdoor tiles
    // (Wave 7b, S1) the terrain function the world replays the mover on: the map's own heightAt, carrying the baked lattice it reads, so navgrid's hop
    // reads the ground in place (latFor checks the two agree on 600 points first) instead of a boxed call per 10 cm step
    const M0 = W.map, hfn = (x, z) => M0.heightAt(x, z);
    hfn.ground = M0.ground; hfn.size = M0.size;
    // (Wave 8) the tall furniture of the furnished houses is never a floor of the grid (no routes over tables, beds, counters, shelves) and walls
    // the capsule from a step away (navgrid TALL_LIFT); null on a map without houses: the world of Wave 7b, hash for hash
    const noFloor = typeof G.tallFurniture === "function" ? G.tallFurniture(W.map) : null;
    const town = G.bakeTown(W.map.colliders, hfn, lay.towns.concat(lay.compounds), { waterY: W.map.waterY, portals: W.map.portals, maxMs: 0, lazy: true, noFloor });
    nav.G = G; nav.world = town.world; nav.areas = town.rects; nav.qKeys = new Set();
    nav.st.areas = town.rects.length;
    const jobs = [], seen = new Set();
    for (let i = 0; i < town.rects.length; i++) {
      const js = G.collectJobs(town.world, town.rects[i]);
      for (let k = 0; k < js.length; k++) if (js[k].kind === 0 && !seen.has(js[k].key)) { seen.add(js[k].key); jobs.push(js[k]); }
    }
    nav.job = { jobs, i: 0, done: false, timer: 0, ms: navNow() - t0 };
    navSchedule(nav.job);
  } catch (err) { navFail(err); }
}
/** Bake outdoor tiles until the job is done or `budgetMs` of wall time is spent (< 0: no limit). */
function navPump(job, budgetMs) {
  const G = nav.G, w = nav.world, t0 = navNow();
  while (job.i < job.jobs.length) {
    G.runJob(w, job.jobs[job.i++]);
    if (budgetMs >= 0 && navNow() - t0 >= budgetMs) break;
  }
  if (job.i >= job.jobs.length) job.done = true;
  job.ms += navNow() - t0;
  return job.done;
}
function navSchedule(job) {
  if (job.timer || job.done || typeof setTimeout !== "function") return;
  job.timer = setTimeout(() => {
    job.timer = 0;
    if (nav.job !== job || job.done) return;
    try { navPump(job, 12); } catch (err) { navFail(err); return; }
    if (!job.done) navSchedule(job);
  }, 0);
}
/** THE BARRIER: finish the outdoor bake (synchronously, whatever the background got done), queue the buildings around the landing spots
 *  and arm the grid. update() calls it before the first brain tick of a match; it is exported for a caller that wants the grid armed
 *  earlier (it costs the same wherever it runs). The bots keep the window planner when anything is missing or throws. */
function navArm(W) {
  const job = nav.job;
  if (!job || nav.ready || nav.map !== W.map) return;
  if (job.timer) { clearTimeout(job.timer); job.timer = 0; }
  const tb = navNow(), ms0 = job.ms;
  try {
    if (!job.done) navPump(job, -1);
    navPrefetch();
  } catch (err) { navFail(err); return; }
  if (nav.job === job && job.done) { nav.st.barrierMs = navNow() - tb; nav.st.bgMs = ms0; nav.st.coarseMs = job.ms; nav.st.coarseJobs = job.jobs.length; nav.ready = true; nav.st.tiles = nav.world.slots.length; }
}
/** Every building tile of the towns, in the order the glide needs them (assignDrops has run): nearest to ANY bot's landing spot first. A building cut into
 *  chunks is queued whole (its chunks settle together) at the distance of its nearest chunk; ties break by tile key. The queue is the whole city -
 *  update() works through it at NAV_STEPS_TICK steps a tick, so it is baked by about the end of the glide and the grid never misses after that. */
function navPrefetch() {
  const w = nav.world, A = nav.areas, T = [];
  for (let i = 0; i < brains.length; i++) { const t = brains[i].bb.dropTarget; if (t) T.push(t); }
  const bl = [], seen = new Set();
  for (let i = 0; i < w.fine.length; i++) {
    const r = w.fine[i];
    if (r.tile !== null || seen.has(r.idx)) continue;
    let inTown = false;
    for (let k = 0; k < A.length && !inTown; k++) inTown = r.maxX > A[k].minX && r.minX < A[k].maxX && r.maxZ > A[k].minZ && r.minZ < A[k].maxZ;
    if (!inTown) continue;
    const rs = r.grp !== null ? r.grp.rects : [r];
    let d = 1e18;
    for (let m = 0; m < rs.length; m++) {
      seen.add(rs[m].idx);
      const cx = (rs[m].minX + rs[m].maxX) * 0.5, cz = (rs[m].minZ + rs[m].maxZ) * 0.5;
      for (let k = 0; k < T.length; k++) { const dx = cx - T[k].x, dz = cz - T[k].z, dd = dx * dx + dz * dz; if (dd < d) d = dd; }
    }
    bl.push({ rs, d, key: 100000000 + r.idx });
  }
  bl.sort((p, q) => (p.d - q.d) || (p.key - q.key));
  for (let m = 0; m < bl.length; m++) {
    const rs = bl[m].rs;
    for (let n = 0; n < rs.length; n++) {
      const key = 100000000 + rs[n].idx;
      if (rs[n].tile === null && !nav.qKeys.has(key)) { nav.qKeys.add(key); nav.qPre.push({ kind: 1, key, tx: 0, tz: 0, rect: rs[n] }); nav.st.prefetch++; }
    }
  }
}
/** One tick of the bake schedule (update(), before the brains): slices of the building tile in progress, until NAV_STEPS_TICK replayed steps of work
 *  have been done - the clock is the replay counter navgrid keeps, never the wall clock - then the next tile starts, a requested one first. A tile
 *  is ~20,000 steps (4-5 ticks), so a tick costs about the same whatever the building; with the queue empty it costs nothing. */
function navTick(W) {
  const w = nav.world, G = nav.G, st = nav.st, w0 = G.work(), budget = W.phase === "drop" && IND.H !== null ? NAV_STEPS_TICK_DROP : NAV_STEPS_TICK;      // (a map without furnished houses: the Wave-7b schedule)
  let guard = 0;
  while (G.work() - w0 < budget && guard++ < 48) {
    if (!nav.cur) {
      let j = null;
      while (!j && nav.qNeed.length) { const c = nav.qNeed.shift(); if (c.rect.tile === null) j = c; }
      while (!j && nav.qPre.length) { const c = nav.qPre.shift(); if (c.rect.tile === null) j = c; }
      if (!j) break;
      try { nav.cur = G.beginJob(w, j); } catch (err) { navFail(err); return; }
    }
    let done = false;
    try { done = G.stepJob(w, nav.cur); } catch (err) { navFail(err); return; }
    st.slices++;                      // (Wave 7, round 2) no wall-clock read per slice any more: the job keeps its own total (nav.cur.ms), and two performance.now() per slice were 2.6 % of the whole bake
    if (done) {
      st.fineJobs++; st.fineMs += nav.cur.ms; if (nav.cur.ms > st.fineMaxMs) st.fineMaxMs = nav.cur.ms; if (nav.cur.slices > st.jobSlicesMax) st.jobSlicesMax = nav.cur.slices;
      st.tiles = w.slots.length;
      nav.cur = null;
    }
  }
  if (G.work() > w0) st.ticksWorked++;
}
/** Take what the last query asked for off the world and queue it: a tile new to the queues goes to the back of qNeed, one that was only
 *  queued as a prefetch is promoted to qNeed (a bot is waiting for it). Returns how many unbaked building tiles the query needed. */
function navDrainWanted() {
  const w = nav.world;
  if (!w.wanted.length) return 0;
  const js = nav.G.takeWanted(w);
  let n = 0;
  for (let k = 0; k < js.length; k++) {
    const j = js[k];
    if (j.kind !== 1 || j.rect.tile !== null) continue;       // the outdoor tiles are all in after the barrier
    n++;
    if (nav.cur && nav.cur.j.key === j.key) continue;         // being baked right now
    if (!nav.qKeys.has(j.key)) { nav.qKeys.add(j.key); nav.qNeed.push(j); nav.st.needJobs++; continue; }
    const pi = nav.qPre.findIndex((c) => c.key === j.key);
    if (pi >= 0) nav.qNeed.push(nav.qPre.splice(pi, 1)[0]);
  }
  return n;
}
export async function prepareNav(W) {
  if (brains.length && W.map) { if (nav.map !== W.map) startNav(W); navArm(W); }
  return navInfo();
}
function navInfo() {
  return { ready: nav.ready, areas: nav.st.areas, tiles: nav.world ? nav.world.slots.length : 0, queued: nav.qNeed.length + nav.qPre.length, stats: nav.st, world: nav.world };
}
/** Is (sx,sz) AND (tx,tz) inside one town / compound rect? The grid knows only the tiles of those rects (a hop outside is blocked). */
function navBoth(sx, sz, tx, tz) {
  const A = nav.areas;
  for (let i = 0; i < A.length; i++) {
    const r = A[i];
    if (sx >= r.minX && sx <= r.maxX && sz >= r.minZ && sz <= r.maxZ && tx >= r.minX && tx <= r.maxX && tz >= r.minZ && tz <= r.maxZ) return true;
  }
  return false;
}
/** (Wave 8) navBoth for the planner, one end just OUTSIDE the rect (and the route to / from an upper storey, see navUp): one point inside a town / compound rect, the other within NAV_NEAR_M of that rect and on a
 *  grid tile the world covers (the coarse tiles touching a rect + its margin reach up to a tile past its edge, and they are baked with the rect). A goal in
 *  a furnished house's upper storey asked from the street just outside town got the window planner's partial route (navcheck top-floor-paths: 36 of 36
 *  failures had the start outside the rect, every one of them routed by the grid once both ends are on its tiles). Only findPath asks; the loot pricing and
 *  the exits keep navBoth. Without houses: never asked (the caller tests IND.H). */
const NAV_NEAR_M = 32;
/** ... and only for a route to or from an UPPER storey (an end 1.5 m and more over the terrain under it): a ground-level goal is the window planner's job as before
 *  (it walks the bot to the rect, where the grid takes over), so the outdoor routing of the match does not change. */
function navUp(W, sx, sy, sz, tx, tz, ty) {
  const M = W.map;
  return (ty != null && ty - M.heightAt(tx, tz) > 1.5) || sy - M.heightAt(sx, sz) > 1.5;
}
function navNear(sx, sz, tx, tz) {
  const A = nav.areas, Wd = nav.world;
  if (!A || !Wd || typeof Wd.cover !== "function") return false;
  const ts = Wd.tileSize;
  for (let i = 0; i < A.length; i++) {
    const r = A[i];
    const sIn = sx >= r.minX && sx <= r.maxX && sz >= r.minZ && sz <= r.maxZ, tIn = tx >= r.minX && tx <= r.maxX && tz >= r.minZ && tz <= r.maxZ;
    if (sIn === tIn) continue;                   // both in (navBoth's case) or both out
    const ox = sIn ? tx : sx, oz = sIn ? tz : sz;
    if (ox < r.minX - NAV_NEAR_M || ox > r.maxX + NAV_NEAR_M || oz < r.minZ - NAV_NEAR_M || oz > r.maxZ + NAV_NEAR_M) continue;
    if (Wd.cover(Math.floor(ox / ts), Math.floor(oz / ts))) return true;
  }
  return false;
}
let navMiss = false;               // the last findPath() asked the grid and it came back empty because tiles it needs are not baked yet (not because there is no route)
/** One grid query: waypoints {x, y, z, k} (k = the kind of the leg that arrives there: 0 walk, 1 drop, 2 ramp) or null. NOT rationed here. A null
 *  answer that needed building tiles sets navMiss (and queues them); a route found keeps its asks to itself (a tile beside a street is not needed). */
function gridPath(ax, ay, az, tx, tz, ty, noQueue, price) {
  const t0 = navNow();
  let p = null;
  navMiss = false;
  try { p = nav.G.findPath(nav.world, ax, ay, az, tx, ty == null ? undefined : ty, tz, price ? NAV_OPTS_PRICE : NAV_OPTS); } catch (err) { navFail(err); return null; }
  const d = navNow() - t0, st = nav.st;
  st.queries++; st.ms += d; if (d > st.maxMs) st.maxMs = d;
  if (!p || !p.length) {
    st.nulls++;
    if (noQueue) { if (nav.world.wanted.length > 0) { navMiss = true; st.misses++; nav.world.wanted.length = 0; } }      // a candidate that is not (yet) the bot's choice does not queue its building
    else if (navDrainWanted() > 0) { navMiss = true; st.misses++; }
    // (Wave 8) THE WAY IN, WALKED OUT. Every edge is certified for the direction it was replayed in, and in a furnished room a gap of a few centimetres over the
    // capsule can pass one way only (the mover moves X then Z: a diagonal past a stair's wall end and a cabinet holds going in, not coming back - measured: a
    // Savanna mid-rise whose whole upper floor had a route IN and none OUT, 15 rooms). With the house's tiles in (no miss) and no route this way: the route
    // the other way, reversed, when it has no drop in it (a drop is not climbed back). Not for the pricing queries. Without houses: never reached.
    if (!navMiss && !price && IND.H !== null && nav.world.lastFail === "no-path") {
      const q = reverseRoute(ax, ay, az, tx, tz, ty);
      if (q) { st.reversed++; return q; }
    }
    return null;
  }
  nav.world.wanted.length = 0;
  p.nav = !price;                   // a priced route is a length, not a route to follow
  return p;
}
/** (Wave 8) A grid route from (tx, ty, tz) back to (sx, sy, sz), reversed into one from s to t: the waypoints in the other order, the goal last, each waypoint
 *  carrying the kind of the leg that now arrives at it (the same leg walked the other way). null when there is no such route or it holds a drop. */
function reverseRoute(sx, sy, sz, tx, tz, ty) {
  let q = null;
  const y0 = ty != null ? ty : nav.world.hf(tx, tz);
  try { q = nav.G.findPath(nav.world, tx, y0, tz, sx, sy, sz, NAV_OPTS); } catch (err) { navFail(err); return null; }
  if (!q || !q.length || nav.world.wanted.length) { nav.world.wanted.length = 0; return null; }
  for (let i = 0; i < q.length; i++) if (q[i].k === 1) return null;
  const out = [];
  for (let i = q.length - 2; i >= 0; i--) out.push({ x: q[i].x, y: q[i].y, z: q[i].z, k: q[i + 1].k });
  out.push({ x: tx, y: y0, z: tz, k: q[0].k });
  out.nav = true; out.rev = true;
  return out;
}
/** The planner every caller uses: the grid inside a town / compound, else (or when the grid finds nothing) the window planner. */
function findPath(W, sx, sy, sz, tx, tz, ty) {
  navMiss = false;
  if (IND.map !== W.map) indEnsure(W);       // (a probe plans before the first tick: the room index is built by update() otherwise)
  if (nav.ready && (navBoth(sx, sz, tx, tz) || (IND.H !== null && navUp(W, sx, sy, sz, tx, tz, ty) && navNear(sx, sz, tx, tz)))) {
    const p = gridPath(sx, sy, sz, tx, tz, ty);
    if (p) return p;
    // (Wave 8) no route on the grid (its tiles are in): over the room graph, one door / stair at a time (roomHopPath; null without houses)
    if (!navMiss && IND.H !== null) { const q = roomHopPath(W, sx, sy, sz, tx, tz, ty); if (q) return q; }
    nav.st.fallbacks++;
  }
  // (Wave 8) OUT OF THE HOUSE FIRST. From a room of a furnished house to a goal outside that house that the grid cannot plan (another town, the open
  // ground, the storm's centre): the 64 m window planner reads the furnished rooms as a maze (stuck windows on the housed maps: bots in a room walking at
  // a goal 25-190 m away with no route, or with a window-planner route through the furniture). Walk out through the room graph's street door on the grid,
  // then plan from the street. Without houses: nothing changes.
  if (nav.ready && IND.H !== null) {
    const si = roomAt(W, sx, sy, sz);
    if (si >= 0) {
      const gi = roomAt(W, tx, ty == null ? W.map.heightAt(tx, tz) : ty, tz);
      if (gi < 0 || IND.R[gi].h !== IND.R[si].h) { const q = houseExitFrom(si, sx, sy, sz); if (q) return q; }
    }
  }
  const p = findPathOld(W, sx, sy, sz, tx, tz, ty);
  // (Wave 7, round 2) a START inside a town / compound and a goal outside it: the grid cannot plan out of its rect and the window planner's first leg out of a town crosses a wall
  // end or a fence corner at its 0.3 m margin about once in ten (probe_paths' first-blocked test: 58 % of the old planner's blocked first legs started inside a rect). When that first
  // leg IS blocked (checked on the spot, 0.3 m steps, at the bot's own floor), the grid takes the bot to open ground at the rect's edge toward the goal and the bot walks on from there.
  if (nav.ready && p && p.length && !p.partial && TOWN_EXIT && firstLegBlocked(W, sx, sy, sz, p[0])) {
    const q = townExitPath(W, sx, sy, sz, tx, tz);
    if (q) { nav.st.exits++; return q; }
  }
  return p;
}
const TOWN_EXIT = true;           // switch: false = the window planner alone, as in the Wave-7 build
const TOWN_EXIT_MIN_M = 6;        // the rect's edge toward the goal must be at least this far (a bot nearer the edge is out of the town's clutter anyway)
const _fl = [];
/** Is the straight walk from (sx,sz) at feet height sy to the waypoint wp blocked by a wall in the knee-to-head band (0.35 m margin) within its first 14 m? */
function firstLegBlocked(W, sx, sy, sz, wp) {
  let dx = wp.x - sx, dz = wp.z - sz;
  const L0 = Math.sqrt(dx * dx + dz * dz);
  if (L0 < 0.6) return false;
  const L = L0 > 14 ? 14 : L0;
  dx = dx / L0 * L; dz = dz / L0 * L;
  const ex = sx + dx, ez = sz + dz;
  // (lane K1 -> K2) only the knee-to-head band is tested below (minY < sy + 2.0 && maxY > sy + 0.55): ask maps.js for that band alone
  const got = W.map.queryColliders((sx + ex) * 0.5, (sz + ez) * 0.5, L * 0.5 + 1.0, _fl, sy + 0.55, sy + 2.0);
  const x0 = (sx < ex ? sx : ex) - 0.5, x1 = (sx < ex ? ex : sx) + 0.5, z0 = (sz < ez ? sz : ez) - 0.5, z1 = (sz < ez ? ez : sz) + 0.5;
  const n = Math.ceil(L / 0.3);
  for (let k = 0; k < got.length; k++) {
    const c = got[k];
    if (c.dead || c.kind === "ramp" || c.maxX < x0 || c.minX > x1 || c.maxZ < z0 || c.minZ > z1) continue;
    if (!(c.minY < sy + 2.0 && c.maxY > sy + 0.55)) continue;
    for (let i = 1; i <= n; i++) {
      const x = sx + dx * i / n, z = sz + dz * i / n;
      if (x >= c.minX - 0.35 && x <= c.maxX + 0.35 && z >= c.minZ - 0.35 && z <= c.maxZ + 0.35) return true;
    }
  }
  return false;
}
/** A grid route from inside a town / compound rect to open ground at the rect's edge toward (tx,tz): the candidates are the exit point pulled 1.5 m inside and the points 3 and 6 m to either
 *  side along the edge; one is taken only if no collider stands within 1.5 m of it at its own height (a point inside a building would lead the bot into it). null = no such route. */
function townExitPath(W, sx, sy, sz, tx, tz) {
  const A = nav.areas;
  let r = null;
  for (let i = 0; i < A.length && !r; i++) if (sx >= A[i].minX && sx <= A[i].maxX && sz >= A[i].minZ && sz <= A[i].maxZ) r = A[i];
  if (!r) return null;
  const dx = tx - sx, dz = tz - sz, D = Math.sqrt(dx * dx + dz * dz);
  if (D < 1) return null;
  const ux = dx / D, uz = dz / D;
  const tX = ux > 1e-9 ? (r.maxX - sx) / ux : ux < -1e-9 ? (r.minX - sx) / ux : 1e30, tZ = uz > 1e-9 ? (r.maxZ - sz) / uz : uz < -1e-9 ? (r.minZ - sz) / uz : 1e30;
  const tOut = tX < tZ ? tX : tZ;
  if (tOut < TOWN_EXIT_MIN_M + 1.5 || tOut >= D) return null;
  const ex = sx + ux * (tOut - 1.5), ez = sz + uz * (tOut - 1.5);
  for (let k = 0; k < 5; k++) {
    const side = k === 0 ? 0 : ((k & 1) ? 1 : -1) * (k > 2 ? 6 : 3);
    const cx = ex - uz * side, cz = ez + ux * side;
    if (cx < r.minX || cx > r.maxX || cz < r.minZ || cz > r.maxZ) continue;
    const g = W.map.heightAt(cx, cz);
    if (g < W.map.waterY + 0.5) continue;
    const cols = W.map.queryColliders(cx, cz, 1.6);
    let free = true;
    for (let i = 0; i < cols.length && free; i++) {
      const c = cols[i];
      if (c.dead || c.kind === "ramp") continue;
      if (cx < c.minX - 1.5 || cx > c.maxX + 1.5 || cz < c.minZ - 1.5 || cz > c.maxZ + 1.5) continue;
      if (c.maxY > g - 0.5 && c.minY < g + 4.0) free = false;
    }
    if (!free) continue;
    const q = gridPath(sx, sy, sz, cx, cz, g);
    if (q && q.length) return q;
  }
  return null;
}
/** Length of a grid route from the feet: 3D metres along the waypoints. */
function navLen(a, p) {
  let d = 0, x = a.pos.x, y = a.pos.y, z = a.pos.z;
  for (let i = 0; i < p.length; i++) { const dx = p[i].x - x, dy = p[i].y - y, dz = p[i].z - z; d += Math.sqrt(dx * dx + dy * dy + dz * dz); x = p[i].x; y = p[i].y; z = p[i].z; }
  return d;
}
/** May the follower take waypoint 0 of a grid route now? A waypoint is taken within 0.55 m and on its own floor (the last one within 0.6 m): the legs were
 *  certified for a walker that heads straight at the next waypoint, and moveToward walks exactly that line (see the reprojection there), so the bot passes
 *  through every waypoint it was given. (7B1 measured a looser rule - up to 1.5 m early, but only while navgrid.walkSegment certifies the walk on to
 *  the next waypoint - which saves a few centimetres at a corner and costs four mover replays per frame per bot: 8 MB of garbage in ten seconds.) */
function navConsume(a, path, dwp) {
  const wp = path[0];
  if (wp.y != null && Math.abs(a.pos.y - wp.y) > ARRIVE_DY) return false;
  return dwp < (path.length === 1 ? 0.6 : 0.55);
}

/** The probes' planner: findPath, but a grid miss is settled on the spot - the building tiles the route needs are baked NOW (a probe plans on a
 *  paused world that never ticks, so the tick schedule would never run) and the question is asked again. It answers what the game answers
 *  once its tiles are in; the game itself never does this. */
function findPathSettled(W, sx, sy, sz, tx, tz, ty) {
  if (nav.job && !nav.ready) navArm(W);       // a probe plans before the first tick: arm the grid (the barrier) now
  for (let round = 0; round < 8; round++) {
    const p = findPath(W, sx, sy, sz, tx, tz, ty);
    if (!navMiss || !nav.ready) return p;
    let ran = 0;
    try {
      if (nav.cur) { while (!nav.G.stepJob(nav.world, nav.cur)); nav.cur = null; ran++; }
      while (nav.qNeed.length) { const j = nav.qNeed.shift(); if (j.rect.tile === null) { nav.G.runJob(nav.world, j); ran++; } }
    } catch (err) { navFail(err); return p; }
    if (!ran) return p;
  }
  return findPath(W, sx, sy, sz, tx, tz, ty);
}
/** Test hook for the lane probes: the live pathfinder (findPath settles grid misses at once, see findPathSettled; findPathGame is the game's). */
export function debugNav() {
  return { findPath: findPathSettled, findPathGame: findPath, findExit, findPathOld, CELL, GRID_R, wallAhead, navInfo, navBoth,
    // (Wave 7b, S1) the heal / fight steering probes, for the probes only: headingBlocked's two halves along a world heading (hx, hz)
    headingBlocked: (W, b, hx, hz) => { _hd.x = hx; _hd.z = hz; return headingBlocked(W, wallCols(W, b), b.actor); },
    rampLegBlocked: (W, b, hx, hz) => { _hd.x = hx; _hd.z = hz; return rampLegBlocked(W, wallCols(W, b), b.actor); },
    // (Wave 8) the room graph, for the probes: where a point is (house, room, storey) and the brain's own room
    roomAt: (W, x, y, z) => { const i = roomAt(W, x, y, z); return i < 0 ? null : { house: IND.R[i].h.id, room: IND.R[i].r.id, kind: IND.R[i].r.kind, floor: IND.R[i].f, index: i }; },
    indoors: () => ({ houses: IND.H ? IND.H.length : 0, rooms: IND.R.length, built: IND.built }),
    roomRoute: (from, to) => { const L = roomRoute(from, to); if (!L) return null; linkTarget(from, L); return { to: L.to, door: L.d ? L.d.id : null, stair: L.s ? L.s.id : null, at: [LT[0], LT[1], LT[2]], exitDoor: to === -1 && _bfsEnd && _bfsEnd.d ? _bfsEnd.d.id : null }; },
    occAny: (W, x, z, r) => occAny(W, x, z, r),
    houseExitPath: (W, b) => houseExitPath(W, b), roomHopPath: (W, sx, sy, sz, tx, tz, ty) => roomHopPath(W, sx, sy, sz, tx, tz, ty) };
}

// ═════════════════════════════════════════════════════════════════════════════
// INDOORS: THE ROOM GRAPH OF THE FURNISHED HOUSES (Wave 8, lane I2; plan "Lane 8C").
// maps.js (Wave 8 stage B) builds every parcel building with runtime/3d/royale/housegen.js and lists the records on W.map.houses: rooms (floor, kind,
// rects on the wall centre lines, walkable rects, an anchor), doors (2.26 m, the two rooms or the street), stairs (approach room -> exit room) and the
// nav links between them. What the brains take from it:
//   WHERE AM I   roomAt(x, y, z) -> a room index (or -1 = outdoors): the house, the storey and the room of a point. A spatial table of the houses
//                (16 m cells) and the storey from the floors' heights; no collider query, no allocation. The bots keep their own room (bb.roomI)
//                and, while fighting, the target's (bb.tRoomI), refreshed on the think tick.
//   THE GRAPH    rooms joined by their doors and stairs (and the street through the outer doors). The brains route over it for what the grid
//                cannot do alone: the way OUT of a room (the nearest street door through the graph, walked on the grid; findExit's 64 m window
//                planner reads a furnished room as a maze), a route the grid's search gives up on (a goal several rooms and a storey away: the
//                grid plans to the next door / stair of the graph path instead, and the bot plans on from there), and the door a threat in
//                another room will come through.
//   INSIDE A ROOM the route is ALWAYS the collider grid's (navgrid, the town tiles: every leg replayed through the mover), never a straight line
//                node to node: furniture blocks 15 % of the straight lines between a room's doors (stage-A check).
//   FIGHTS       cover indoors is the wall beside a doorway of the bot's own room (hold the room, then peek); a target in another room is
//                closed on along a route, not by a straight push into the wall between; a lost target on another storey is followed up the stairs
//                (the search walks to HIS floor).
//   LOOT         a candidate in the house the bot is already in is worth a few points more (clear the house, then leave), one in the same room more.
// Without W.map.houses (every build before Wave 8 stage B) none of this runs: roomAt answers -1 and every brain decision is the Wave-7b one, draw for draw.
const IND = { map: null, H: null, R: [], ix: new Map(), grid: null, built: 0 };
const IND_CELL = 16;                       // m: the house table's cells (a house is at most 30 m a side: one to four cells)
const LOOT_NEAR_M = 3.0;                    // actLoot: a loot goal this near and not taken for 2.5 s is parked (houses only)
const LOOT_STAND_M = 0.6;                   // actLoot: a house loot STAND point is reached at this distance (1.8 m from it can be 3 m from the thing: out of the 2.4 m pickup)
/** (Wave 8 fix round, lane K2) the walk goal for loot n: a house item / chest's STAND point (loot.js: the nearest point of its room's walk area, on the room's
 *  floor) - the bot takes it from inside the room, along a clear line; anything else: the thing itself, as before. */
function setLootGoal(bb, n) {
  const s = n.stand;
  bb.moveTo = s ? { x: s.x, z: s.z, y: s.y } : { x: n.pos.x, z: n.pos.z, y: n.pos.y };
  bb.standGoal = s ? bb.moveTo : null;
}
const IND_FLOOR_DY = 0.7;                  // a point counts on storey f from 0.7 m under its floor up to 0.3 m under its ceiling (a roof top is outdoors)
const IND_ROOM_S = 0.25;                   // s: a brain's own room is refreshed at most this often (think tick; the fight reads it every frame)
const IND_LOOT_HOUSE = 5, IND_LOOT_ROOM = 8;   // pickLoot points for a candidate in the house / the room the bot is in (0.4 points a metre: 12.5 / 20 m of walk)
const indKey = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
/** Build (once per map) the house table, the room records and the graph. Every map without houses gets IND.H = null. */
function indEnsure(W) {
  const M = W.map;
  if (IND.map === M) return IND.H !== null;
  IND.map = M; IND.H = null; IND.R.length = 0; IND.ix.clear(); IND.grid = null; IND.built++;
  const HS = M && M.houses;
  if (!Array.isArray(HS) || !HS.length) return false;
  const grid = new Map();
  for (let hi = 0; hi < HS.length; hi++) {
    const h = HS[hi];
    if (!h || !h.aabb || !Array.isArray(h.rooms) || !Array.isArray(h.floors)) continue;
    const doorById = new Map(), roomIx = new Map();
    for (let k = 0; k < (h.doors || []).length; k++) doorById.set(h.doors[k].id, h.doors[k]);
    const first = IND.R.length;
    for (let k = 0; k < h.rooms.length; k++) {
      const r = h.rooms[k], F = h.floors[r.floor];
      if (!F) continue;
      roomIx.set(r.id, IND.R.length);
      IND.R.push({ hi, h, r, f: r.floor, y: F.y, ceil: F.ceil, rects: r.rects || [[r.x0, r.z0, r.x1, r.z1]], doors: [], stairs: [], nb: [] });
    }
    // the graph: a door joins its two rooms (an outer door: the room and the street, to = -1), a stair its approach and exit rooms
    for (let gi = first; gi < IND.R.length; gi++) {
      const R = IND.R[gi];
      for (const did of (R.r.doors || [])) { const d = doorById.get(did); if (d) R.doors.push(d); }
    }
    for (const d of (h.doors || [])) {
      const a = d.rooms && d.rooms[0] != null ? roomIx.get(d.rooms[0]) : undefined, b = d.rooms && d.rooms[1] != null ? roomIx.get(d.rooms[1]) : undefined;
      if (a === undefined) continue;
      if (b === undefined) IND.R[a].nb.push({ to: -1, d, s: null });
      else { IND.R[a].nb.push({ to: b, d, s: null }); IND.R[b].nb.push({ to: a, d, s: null }); }
    }
    for (const s of (h.stairs || [])) {
      const a = s.approachRoom != null ? roomIx.get(s.approachRoom) : undefined, b = s.exitRoom != null ? roomIx.get(s.exitRoom) : undefined;
      if (a === undefined || b === undefined) continue;
      IND.R[a].nb.push({ to: b, d: null, s }); IND.R[b].nb.push({ to: a, d: null, s });
      IND.R[a].stairs.push(s); if (b !== a) IND.R[b].stairs.push(s);
    }
    const x0 = Math.floor(h.aabb.min[0] / IND_CELL), x1 = Math.floor(h.aabb.max[0] / IND_CELL), z0 = Math.floor(h.aabb.min[2] / IND_CELL), z1 = Math.floor(h.aabb.max[2] / IND_CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = indKey(cx, cz);
      let l = grid.get(k);
      if (!l) { l = []; grid.set(k, l); }
      l.push(hi);
    }
  }
  for (let i = 0; i < IND.R.length; i++) IND.ix.set(IND.R[i].r, i);      // (the house records are shared with the view and the gates: never written; these side tables are ours)
  IND.grid = grid; IND.H = HS;
  return true;
}
/** The room (index into IND.R) of the point (x, y feet, z), or -1: outdoors, on a roof, under a house, in a wall. */
function roomAt(W, x, y, z) {
  RAQ[0] = x; RAQ[1] = y; RAQ[2] = z;
  return roomAtQ(W);
}
/** roomAt with the point in RAQ (the per-frame callers: a call boxes double arguments) */
const RAQ = new Float64Array(3);
function roomAtQ(W) {
  const x = RAQ[0], y = RAQ[1], z = RAQ[2];
  if (IND.map !== W.map) indEnsure(W);
  if (IND.H === null) return -1;
  const l = IND.grid.get(indKey(Math.floor(x / IND_CELL), Math.floor(z / IND_CELL)));
  if (!l) return -1;
  for (let i = 0; i < l.length; i++) {
    const h = IND.H[l[i]], mn = h.aabb.min, mx = h.aabb.max;
    if (x < mn[0] || x > mx[0] || z < mn[2] || z > mx[2]) continue;
    let f = -1;          // the highest storey whose floor is at most 0.7 m above the feet, feet under its ceiling - 0.3 (ceil + 0.3 = the slab top: the next floor, or the ROOF)
    for (let k = h.floors.length - 1; k >= 0; k--) { const F = h.floors[k]; if (y >= F.y - IND_FLOOR_DY) { if (y <= F.ceil - 0.3) f = k; break; } }
    if (f < 0) continue;
    for (let k = 0; k < h.rooms.length; k++) {
      const r = h.rooms[k];
      if (r.floor !== f) continue;
      const rs = r.rects;
      for (let q = 0; q < rs.length; q++) {
        const rc = rs[q];
        if (x >= rc[0] && x <= rc[2] && z >= rc[1] && z <= rc[3]) return roomIndexOf(h, r);
      }
    }
  }
  return -1;
}
/** The IND.R index of room record r (house h). */
function roomIndexOf(h, r) {
  const i = IND.ix.get(r);
  return i === undefined ? -1 : i;
}
/** The brain's own room, refreshed at most every IND_ROOM_S (sim time) or when it moved > 1 m. */
function myRoom(W, b) {
  const a = b.actor, bb = b.bb;
  if (IND.map !== W.map) indEnsure(W);
  if (IND.H === null) return -1;
  const dx = a.pos.x - bb.roomX, dz = a.pos.z - bb.roomZ, dy = a.pos.y - bb.roomY;
  if (W.t - bb.roomT < IND_ROOM_S && W.t >= bb.roomT && dx * dx + dz * dz < 1 && dy * dy < 0.36) return bb.roomI;
  RAQ[0] = a.pos.x; RAQ[1] = a.pos.y; RAQ[2] = a.pos.z; bb.roomI = roomAtQ(W); bb.roomT = W.t; bb.roomX = a.pos.x; bb.roomZ = a.pos.z; bb.roomY = a.pos.y;
  return bb.roomI;
}

/** Breadth-first over the room graph from room `from` (index) to room `to` (index, or -1 = the street): the first hop's link { to, d, s } or null.
 *  Costs are door / stair counts (rooms are small; the grid prices the walk itself). Deterministic: the links are visited in the house's own order. */
const _bfsQ = [], _bfsLink = [], _bfsPrev = [];
let _bfsMark = new Int32Array(0), _bfsStamp = 0, _bfsEnd = null;
/** The point just past link L taken from room u, into LT[0..2] (x, y feet, z): through a door 1.0 m into the next room (or 2 m out into the street),
 *  up / down a stair at its exit / approach cell. */
const LT = new Float64Array(3);
function linkTarget(u, L) {
  const R = IND.R;
  if (L.s) {
    const s = L.s, up = R[u].r.id === s.approachRoom;
    if (up) { LT[0] = s.exit[0]; LT[1] = s.top[1]; LT[2] = s.exit[1]; } else { LT[0] = s.approach[0]; LT[1] = s.foot[1]; LT[2] = s.approach[1]; }
    return;
  }
  const d = L.d;
  // the side of the door room u is on: an outer door's normal points out of rooms[0]; an interior door's from rooms[0] to rooms[1]
  const out = d.kind !== "interior" || d.rooms[0] === R[u].r.id ? 1 : -1, k = L.to === -1 ? 2.0 : 1.0;
  LT[0] = d.x + d.nx * out * k; LT[1] = L.to === -1 && d.out ? R[u].h.y0 : d.y; LT[2] = d.z + d.nz * out * k;
}
function roomRoute(from, to) {
  const R = IND.R;
  if (from < 0 || from >= R.length || from === to) return null;
  if (_bfsMark.length < R.length) { _bfsMark = new Int32Array(R.length + 64); _bfsStamp = 0; }
  const st = ++_bfsStamp, h = R[from].h;
  _bfsQ.length = 0; _bfsQ.push(from); _bfsMark[from] = st; _bfsPrev[from] = -1;
  let end = -1, endLink = null;
  for (let qi = 0; qi < _bfsQ.length && end < 0; qi++) {
    const u = _bfsQ[qi], nb = R[u].nb;
    for (let k = 0; k < nb.length; k++) {
      const L = nb[k];
      if (L.to === -1) { if (to === -1) { end = u; endLink = L; break; } continue; }
      if (_bfsMark[L.to] === st || R[L.to].h !== h) continue;
      _bfsMark[L.to] = st; _bfsPrev[L.to] = u; _bfsLink[L.to] = L;
      if (L.to === to) { end = to; break; }
      _bfsQ.push(L.to);
    }
  }
  if (end < 0) return null;
  _bfsEnd = endLink;                                       // (to -1: the street door the route leaves by)
  if (to === -1 && end === from) return endLink;           // this room has a street door
  let v = end;
  while (_bfsPrev[v] !== from) v = _bfsPrev[v];
  return _bfsLink[v];
}

/** (Wave 8) The grid found no route (not a miss: its tiles are in) and a house room is at one end: route over the ROOM GRAPH and plan on the grid to
 *  the far side of the graph route's first door / stair only (from inside a house; from outside it, to just inside the goal house's street door). The
 *  answer is a partial route (.partial, .hop): the bot walks it and plans on from there. null when there is no graph route or the hop does not plan
 *  either. A search the grid gives up on (the 22,000-node table, a goal three rooms and a storey away through furnished rooms) is the case it is for. */
function roomHopPath(W, sx, sy, sz, tx, tz, ty) {
  if (IND.map !== W.map) indEnsure(W);
  if (IND.H === null) return null;
  const si = roomAt(W, sx, sy, sz), gi = roomAt(W, tx, ty == null ? W.map.heightAt(tx, tz) : ty, tz);
  if (si < 0 && gi < 0) return null;
  let L = null, u = -1;
  if (si >= 0) {
    u = si;
    L = gi >= 0 && IND.R[gi].h === IND.R[si].h ? roomRoute(si, gi) : roomRoute(si, -1);
    if (!L) return null;
    linkTarget(u, L);
  } else {
    // from outside: to the goal house's street door (the one the graph leaves the goal room by), a metre inside it
    if (!roomRoute(gi, -1) || !_bfsEnd || !_bfsEnd.d) return null;
    const d = _bfsEnd.d;
    LT[0] = d.x - d.nx * 1.0; LT[1] = d.y; LT[2] = d.z - d.nz * 1.0;
  }
  const hx = LT[0], hy = LT[1], hz = LT[2];
  if ((hx - sx) * (hx - sx) + (hz - sz) * (hz - sz) < 1.0 && Math.abs(hy - sy) < 1.0) return null;      // already there: the hop is no progress
  const p = gridPath(sx, sy, sz, hx, hz, hy);
  if (!p) return null;
  p.partial = true; p.hop = true;
  nav.st.hops++;
  return p;
}
/** (Wave 8) The way OUT of the house the bot is in, through the room graph's nearest street door, on the grid: 2 m past that door into the street
 *  (or, when the grid cannot plan that far, to the far side of the first door / stair of the graph route). null outdoors / no route. */
function houseExitPath(W, b) {
  const a = b.actor;
  if (!nav.ready) return null;
  const gi = myRoom(W, b);
  if (gi < 0) return null;
  return houseExitFrom(gi, a.pos.x, a.pos.y, a.pos.z);
}
function houseExitFrom(gi, sx, sy, sz) {
  const L0 = roomRoute(gi, -1);
  if (!L0 || !_bfsEnd || !_bfsEnd.d) return null;
  const d = _bfsEnd.d, ex = d.x + d.nx * 2.0, ez = d.z + d.nz * 2.0;
  if (!navBoth(sx, sz, ex, ez)) return null;
  let p = gridPath(sx, sy, sz, ex, ez, IND.R[gi].h.y0);
  if (p) { p.partial = true; p.hop = true; }               // (the street is not the goal: the bot plans on from there at once)
  else if (!navMiss) {
    linkTarget(gi, L0);
    p = gridPath(sx, sy, sz, LT[0], LT[2], LT[1]);
    if (p) { p.partial = true; p.hop = true; }
  }
  if (p) nav.st.houseExits++;
  return p;
}

// ── "IS ANYTHING NEAR?" without a collider query (Wave 8, lane I2) ──────────────────────────────────────────────────────────────────────
// coverStepQ asked queryColliders(x, z, 16) to learn ONE boolean (is there any collider round me at all?). On a map of furnished houses that call hands
// back whole houses - every collider of the 5 x 5 cells the 32 m square touches (a house alone is 50-680 boxes) - and stamps each one. occAny answers the
// same question from a table of the same cells (maps.js queryColliders: 8 m cells on a map with a city, 16 m otherwise, a collider listed in every cell
// its box touches): the cells the square [x - r, x + r] x [z - r, z + r] touches, any live collider listed there. Same cells, same live test (c.dead),
// so the same answer as `queryColliders(x, z, r).length > 0`, with no stamping, no output array and no per-call cost that grows with the houses.
const OCC = { map: null, cell: 16, cells: null };
function occBuild(M) {
  OCC.map = M; OCC.cells = new Map();
  OCC.cell = M && typeof M.queryCell === "number" && M.queryCell > 0 ? M.queryCell : (M && M.city ? 8 : 16);
  const C = OCC.cell, cols = (M && M.colliders) || [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const x0 = Math.floor(c.minX / C), x1 = Math.floor(c.maxX / C), z0 = Math.floor(c.minZ / C), z1 = Math.floor(c.maxZ / C);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = (cx + 8192) * 16384 + (cz + 8192);
      let l = OCC.cells.get(k);
      if (!l) { l = []; OCC.cells.set(k, l); }
      l.push(c);
    }
  }
}
function occAny(W, x, z, r) {
  if (W.map.hasCollidersNear) return W.map.hasCollidersNear(x, z, r);      // (Wave 8 maps.js, lane I1: the same test over the map's own cells - no table of ours)
  if (OCC.map !== W.map) occBuild(W.map);
  const C = OCC.cell;
  const x0 = Math.floor((x - r) / C), x1 = Math.floor((x + r) / C), z0 = Math.floor((z - r) / C), z1 = Math.floor((z + r) / C);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const l = OCC.cells.get((cx + 8192) * 16384 + (cz + 8192));
    if (!l) continue;
    for (let i = 0; i < l.length; i++) if (!l[i].dead) return true;
  }
  return false;
}

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
let reqWhy = 0;                   // stats only: who asked (1 progress-stuck, 2 wrong floor, 3 proactive, 4 wall reflex, 5 hard-stuck)
function requestPath(W, b, tx, tz, ty, urgent) {
  const bb = b.bb;
  if ((bb.nextPathT || 0) > W.t) return;
  const a = b.actor;
  if (nav.ready && navBoth(a.pos.x, a.pos.z, tx, tz)) {
    // (Wave 7) a town query is rationed per frame (by count); the request the ration refuses is asked again next frame. A bot that is
    // stuck is never refused.
    if (nav.q <= 0 && !urgent) { nav.st.skipped++; return; }
    nav.q--;
    nav.st.req[reqWhy]++;
  }
  bb.path = findPath(W, a.pos.x, a.pos.y, a.pos.z, tx, tz, ty);
  bb.nextPathT = W.t + (navMiss ? 1.0 : 2.5);       // (Wave 7) a building tile the route needs is queued: ask again soon
  bb.pathGoal = bb.path ? { x: tx, z: tz } : null;
  bb.noRouteT = (!bb.path && !navMiss) ? W.t : -99;       // (Wave 7, round 2) a real "no way": a bot on a roof may walk off it (deckExitPath)
}

// ── ROOF / PERCH EXIT (Wave 7, round 2, lane D4) ─────────────────────────────────────────────────────────────────────────────
// A glide can end on a roof, on the top of a wall or on a ledge: 31 touchdowns on something over 2.5 m in 6 Savanna matches, 7 of them on real roofs 9-13 m up.
// Where the grid or the window planner has a way down (a tower's own stairs, a drop of up to 6 m) the bot takes it. Where neither has - the roof is no part of the
// walkable graph, or the bot stands on the outer face of a wall top with the next storey's wall over its head - it used to STAND: both wall slides were walled, moveToward
// held still, 3 s later the loot was parked and the next goal tried, until a goal happened to lie the open way (measured: seed 26, bot s25 on a 9.4 m wall top, 7.5 s
// still, 10.5 s on the roof). This game has no fall damage (hardLand is audio), so the way down is the way a player takes: walk off the nearest open edge. deckExitPoint
// marches 25 headings, the one toward the goal first, and takes the nearest edge; a wall up to a hop high is hopped (jumpV 7.8: apex 1.38 m), a taller one ends the heading.
const DECK_AGL = 3.5;             // feet this far over the ground = a roof, a deck, a wall top (a car or a container stack is lower)
const DECK_LOOK = 20;             // m: how far an exit heading is marched
const DECK_DROP = 1.4;            // the floor ends where the support under the next step is this much below the floor so far
const DECK_HOP = 1.25;            // a wall up to this high is hopped; a higher one blocks the heading
const DECK_NOROUTE_S = 3.0;       // a path request answered "no route" this recently counts (requestPath sets bb.noRouteT)
const DECK_RETRY_S = 1.0;         // a roof exit is looked for at most this often
const HELD_STUCK_S = 1.0;         // held this long (the wall guard / hold-still, not counting a bot that is walking) = the hard-stuck branch of moveToward, whatever the goal-distance timer says
const HELD_TICKS = 15;             // sim ticks (60 Hz) the wall guard must have held a bot before a route (and on a deck a roof exit) is looked for
const HELD_RETRY_S = 1.0;         // ... and at most this often
const _dkx = { x: 0, z: 0, d: 0 };
/** A wall in the walk band at (x,z) for feet at y that is too tall to hop: its box (0.45 m = the capsule) spans from above y + hop to below the head. */
function tallWallAt(W, x, z, y, hop) {
  const cols = W.map.queryColliders(x, z, 0.8);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.dead || c.kind === "ramp") continue;
    if (x < c.minX - 0.45 || x > c.maxX + 0.45 || z < c.minZ - 0.45 || z > c.maxZ + 0.45) continue;
    if (c.minY < y + 2.0 && c.maxY > y + hop) return true;
  }
  return false;
}
/** Is the bot's own spot under a ceiling: a slab or a wide box whose footprint holds the bot's centre, from 1.8 m (its head) to 6 m over its feet. roofedForJump's test also counts
 *  a thin wall a storey up that the bot's 0.45 m margin touches - which is what a bot on the outer ledge of a wall top has over its head, and it is NOT under a roof. */
function underCeiling(W, b) {
  const a = b.actor, list = wallCols(W, b);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.dead || c.kind === "ramp") continue;
    if (a.pos.x < c.minX || a.pos.x > c.maxX || a.pos.z < c.minZ || a.pos.z > c.maxZ) continue;
    if (c.maxX - c.minX < 1.0 || c.maxZ - c.minZ < 1.0) continue;
    if (c.minY >= a.pos.y + 1.8 && c.minY < a.pos.y + 6.0) return true;
  }
  return false;
}
/** The nearest open edge of the deck the bot stands on, into _dkx ({x, z} = a point 2 m past the edge, d = the distance to the edge), or false. */
function deckExitPoint(W, a, preferYaw) {
  const ax = a.pos.x, az = a.pos.z, y0 = a.pos.y, wy = W.map.waterY;
  let best = 1e9;
  for (let k = 0; k < 25; k++) {
    const off = k === 0 ? 0 : ((k & 1) ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
    const yaw = preferYaw + off, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    let h = y0;
    for (let s = 0.5; s <= DECK_LOOK; s += 0.5) {
      const x = ax + dx * s, z = az + dz * s;
      if (tallWallAt(W, x, z, h, DECK_HOP)) break;
      const sup = supportAt(W, x, z, h);
      if (sup < h - DECK_DROP) {
        if (W.map.heightAt(x + dx * 1.5, z + dz * 1.5) < wy + 0.4) break;      // the ground under the edge is water
        const cost = s + Math.abs(off) * 6;
        if (cost < best) { best = cost; _dkx.x = x + dx * 2.0; _dkx.z = z + dz * 2.0; _dkx.d = s; }
        break;
      }
      h = sup;
    }
  }
  return best < 1e9;
}
/** Give a bot that stands on a roof / wall top / ledge a one-waypoint path 2 m past the nearest open edge. false = it is not on a deck, or no edge is open. The path is
 *  tagged `exit`: moveToward neither re-plans nor drops it for a wall in its leg (a hop-high parapet is hopped), and it ends itself when the bot falls through the waypoint. */
function deckExitPath(W, b, tx, tz) {
  const a = b.actor, bb = b.bb;
  if (!a.onGround || a.pos.y - W.map.heightAt(a.pos.x, a.pos.z) < DECK_AGL) return false;
  if (underCeiling(W, b)) return false;                  // a room under a ceiling is no roof
  if (!deckExitPoint(W, a, Math.atan2(-(tx - a.pos.x), -(tz - a.pos.z)))) return false;
  const p = [{ x: _dkx.x, y: null, z: _dkx.z, k: 1 }];
  p.exit = true;
  bb.path = p; bb.pathGoal = { x: tx, z: tz };
  bb.nextPathT = W.t + 2.5;
  return true;
}

function moveToward(W, b, tx, tz, dt, sprint, ty) {
  MTQ[0] = tx; MTQ[1] = tz;
  moveTowardQ(W, b, dt, sprint, ty);
  return MTQ[2];
}
/** (Wave 7b, S1) moveToward with the goal in MTQ[0] (x), MTQ[1] (z); the distance left comes back in MTQ[2]. The per-frame callers
 *  (actLoot, actMove, actEngage, coverStep) use this form: a call boxes every double argument and the returned double. */
const MTQ = new Float64Array(3);
function moveTowardQ(W, b, dt, sprint, ty) {
  const tx = MTQ[0], tz = MTQ[1];
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
  // (Wave 7b, S1) hyp() and the probes are written so no double crosses a call here: moveToward is past the inliner's budget, and a call boxes
  // every number argument and its result (it was the biggest bots.js garbage site: 3-8 KB a frame). Same arithmetic, term for term.
  let qx = 0, qz = 0;
  if (bb.progGoal) { qx = tx - bb.progGoal.x; qz = tz - bb.progGoal.z; }
  if (!bb.progGoal || Math.sqrt(qx * qx + qz * qz) > 4) {
    if (!bb.progGoal) bb.progGoal = { x: 0, z: 0 };
    bb.progGoal.x = tx; bb.progGoal.z = tz; bb.progBest = null; bb.progT = 0;
  }
  qx = tx - a.pos.x; qz = tz - a.pos.z;
  const goalD = Math.sqrt(qx * qx + qz * qz);
  /* (Wave 5) FLOOR-AWARE. A goal on another floor (ty given, a metre and a half or more above or below the feet) is not
     "near" however close it is on the map, and getting there means walking AWAY from it to the stairs: horizontal
     distance rises on the way. Measured (Wave-4, 3 maps): 3 in 4 upstairs rooms were never reached, and 10 of 13 failed
     walks ended within 0.1 m horizontally of the goal - the bot stood under it. So on the wrong floor the progress is the
     length of the ROUTE left (when there is one), and the test applies however near the goal is. */
  const wrongFloor = ty != null && (ty - a.pos.y >= ARRIVE_DY || a.pos.y - ty >= ARRIVE_DY);
  // (Wave 7) and the same for ANY goal inside a town that has a grid route: the way to a door on the far side of a building leads AWAY from
  // the goal for a while, and "the horizontal distance did not fall for 3 s" read that as stuck and parked a good loot item
  const onRoute = (wrongFloor || (bb.path && bb.path.nav)) && bb.path && bb.path.length > 0;
  const prog = onRoute ? routeLeft(a, bb.path) : goalD;
  const progKind = onRoute ? 1 : 0;
  if (bb.progKind !== progKind) { bb.progKind = progKind; bb.progBest = null; bb.progT = 0; }
  if (bb.progBest == null || prog < bb.progBest - 0.5) { bb.progBest = prog; bb.progT = 0; }
  else bb.progT = (bb.progT || 0) + dt;
  if (bb.progT > 3.0 && (goalD > 2.0 || wrongFloor)) {
    bb.stuckT = Math.max(bb.stuckT || 0, 2.3);   // trip the hard-stuck branch
    bb.progT = 0; bb.progBest = null;
    /* (Wave 5) A bot with NO route that makes no progress has not met an unreachable goal, it has met a missing plan (it
       slid along a wall for 3 s because nothing ever asked the planner, or the last ask came back inside the 2.5 s
       cool-down). Ask now, ignoring the cool-down: a complete route means the goal IS reachable, so keep it. Parking the
       item instead re-picks a goal 8+ m from the one the route was made for, and moveToward drops a route whose goal moved
       (measured: ashgrid seed 12, a bot in a hut's west end got a good route out four times in 20 s and threw each one
       away on the next frame; 36 s indoors). A bot that HAD a route and still made no progress is parked as before. */
    const hadRoute = !!(bb.path && bb.path.length);
    bb.nextPathT = 0;
    reqWhy = 1; requestPath(W, b, tx, tz, ty, true);
    // ... ONCE per item: the same item tripping again is parked, whatever the planner says (a route a bot cannot follow must
    // not keep it on the item for the rest of the match: measured, one bot looped 80 s on one item with a "good" route)
    const routed = !hadRoute && bb.path && !bb.path.partial && !(bb.lootId && bb.lootId === bb.routeId);
    if (routed && bb.lootId) bb.routeId = bb.lootId;
    /* And stop choosing the thing it cannot reach. onEnter('LOOT') re-picked
       the SAME item every time, so the bot escaped the wall and walked straight
       back into it. Park this id for 30 s and let it pick something else. */
    if (bb.lootId && !routed) {
      if (!bb.badLoot) bb.badLoot = {};
      bb.badLoot[bb.lootId] = W.t + 30;
      bb.lootId = null; bb.moveTo = null; b.nextThink = 0;
    }
  }
  // PATH FOLLOW: an active A* waypoint chain overrides the direct line.
  // Drop the plan when the caller's goal has moved well away from the one the
  // path was computed for (a re-planned rotation, a moving target).
  if (bb.path && bb.pathGoal) { qx = tx - bb.pathGoal.x; qz = tz - bb.pathGoal.z; if (Math.sqrt(qx * qx + qz * qz) > 8) { bb.path = null; bb.pathGoal = null; } }
  // (Wave 5) a goal on another floor needs a ROUTE (the stairs), not a straight walk at it: plan one as soon as it is in
  // reach of the planner's window instead of waiting for a wall to stop the bot (requestPath is rate-limited to 2.5 s)
  if (wrongFloor && !bb.path && goalD < WRONG_FLOOR_PLAN_M) { reqWhy = 2; requestPath(W, b, tx, tz, ty); }
  // (Wave 7, round 2) a bot on a roof / wall top whose path request came back with "no route" and whose goal is well below it walks off the nearest open edge
  if (!bb.path && a.onGround && bb.noRouteT > W.t - DECK_NOROUTE_S && W.t >= bb.deckT && (ty != null ? ty : W.map.heightAt(tx, tz)) < a.pos.y - 2.5) {
    bb.deckT = W.t + DECK_RETRY_S;
    deckExitPath(W, b, tx, tz);
  }
  // (Wave 7, lane 7B2) a goal inside the town / compound the bot stands in is planned on the grid AT ONCE (doors first, then the rooms
  // and stairs), not after the bot has walked into the wall in front of it - when the straight walk is blocked within the next 14 m. One
  // look per goal per 6 s: a goal the grid cannot reach is not asked again every frame (the straight walk + wall reflexes below take over, as before).
  if (nav.ready && !bb.path && goalD > NAV_PLAN_MIN_M && (W.t >= bb.navT || ((qx = tx - bb.navGX), (qz = tz - bb.navGZ), Math.sqrt(qx * qx + qz * qz) > 4)) && W.t >= bb.nextPathT &&
      navBoth(a.pos.x, a.pos.z, tx, tz)) {
    bb.navGX = tx; bb.navGZ = tz; bb.navT = W.t + 6;
    // ... when a wall is in the way of the straight walk (the next 14 m of it): a clear line needs no plan until the wall reflexes below find a wall
    WAQ[0] = Math.atan2(-(tx - a.pos.x), -(tz - a.pos.z)); WAQ[1] = Math.min(goalD, 14);
    if (wallAheadQ(W, a)) {
      reqWhy = 3; requestPath(W, b, tx, tz, ty);
      if (navMiss) bb.navT = W.t + 1.0;
    }
  }
  // (Wave 8) inside a furnished house with a goal OUTSIDE it (and out of the grid's reach: the case above did not plan): plan at once - findPath walks
  // the bot out through the street door on the grid (see findPath) - instead of walking straight at the goal through the furniture until a wall stops it
  if (nav.ready && IND.H !== null && !bb.path && W.t >= bb.nextPathT && goalD > 3) {
    const mi = myRoom(W, b);
    if (mi >= 0) {
      RAQ[0] = tx; RAQ[1] = ty == null ? a.pos.y : ty; RAQ[2] = tz;
      const gi = roomAtQ(W);
      if (gi < 0 || IND.R[gi].h !== IND.R[mi].h) { reqWhy = 3; requestPath(W, b, tx, tz, ty); }
    }
  }
  // (T-tick-actors B2) a waypoint is reached on ITS floor: horizontal distance alone
  // consumed the ground-floor waypoint of a stair descent while the bot was upstairs.
  // (Wave 5) and the same on the way UP: the first-floor waypoint of a stair climb is not reached from the room below it.
  if (bb.path && bb.path.length) {
    const wp0 = bb.path[0], wq0x = wp0.x - a.pos.x, wq0z = wp0.z - a.pos.z, dwp = Math.sqrt(wq0x * wq0x + wq0z * wq0z);
    if (bb.path.nav) {
      // (Wave 7) a GRID route: 7B1's follower rule (see navConsume), not the window planner's 1.6 m + wall-probe rule
      if (navConsume(a, bb.path, dwp)) bb.path.shift();
    } else if (dwp < 1.6 && !(wp0.y != null && Math.abs(a.pos.y - wp0.y) > ARRIVE_DY)) {
      // (Wave 5) CORNER-CUT PROTECTION. A waypoint is a corner the planner hugged (0.3 m off the wall), and 1.6 m is a long
      // way from one: shifting it at 1.6 m turned the bot onto the straight line to the NEXT waypoint through the building
      // it was rounding (measured: a bot looting through a hut window threw away a good route at the hut's corner, every
      // time, for 16 s). Keep the corner until the walk to the next waypoint is clear, or the bot is on top of it.
      const nx = bb.path[1];
      let shiftIt = !nx || dwp < 0.6;
      if (!shiftIt) {
        const nqx = nx.x - a.pos.x, nqz = nx.z - a.pos.z;
        WAQ[0] = Math.atan2(-(nx.x - a.pos.x), -(nx.z - a.pos.z)); WAQ[1] = Math.min(3.2, Math.max(0.8, Math.sqrt(nqx * nqx + nqz * nqz)));
        shiftIt = !wallAheadQ(W, a);
      }
      if (shiftIt) bb.path.shift();
    }
  }
  if (bb.path && !bb.path.length) {
    if (bb.path.hop) { bb.navT = 0; bb.nextPathT = 0; }      // (Wave 8) a room-graph hop is walked: plan the next one now, not after the 6 s / 2.5 s cool-downs
    bb.path = null; bb.pathGoal = null;
  }
  // (Wave 7, round 2) A window-planner waypoint a storey and more UNDER the feet and less than a metre away is a drop the planner took at a spot the bot is not at: it stands on the deck
  // above the lower floor's cell (seed 27, s8: loot on the floor below, the route's one waypoint under the bot's own feet; it paced over it until the 3 s progress test parked the goal,
  // 8 s on the deck). It is never taken ("on its floor" needs the feet within 1.5 m), so: off the nearest open edge, as for a roof with no way down.
  if (bb.path && bb.path.length && !bb.path.nav && !bb.path.exit && a.onGround && bb.path[0].y != null && a.pos.y - bb.path[0].y > 2.5 && ((qx = bb.path[0].x - a.pos.x), (qz = bb.path[0].z - a.pos.z), Math.sqrt(qx * qx + qz * qz) < 0.8)) {
    if (!deckExitPath(W, b, tx, tz)) { bb.path = null; bb.pathGoal = null; }
  }
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
  qx = gx - a.pos.x; qz = gz - a.pos.z;
  const legD = Math.sqrt(qx * qx + qz * qz);
  let holdStill = false;
  // The probe sits 3.2 m out, so a THIN wall right in front (a 0.35 m hut wall)
  // falls between the bot and the probe point and is never seen: measured
  // 2026-10-01, deepwood seed 13, a bot inside a hut pushed into the wall beside the
  // door for ~80 s (8 stuck episodes) while every probe landed outside. Once the
  // bot is visibly not moving (stuckT, frozen legs), probe at arm's length too.
  // (Only then: an extra collider query per moving bot per frame would cost more
  // than the whole queryColliders budget saved by L6.)
  // (Wave 7) a leg of a grid route was replayed through the mover itself: the 3.2 m probe does not second-guess it (a stair leg or a door
  // jamb read as a wall by this probe was the reason a good plan got dropped); a bot that really is pinned still trips the arm's-length probe
  if ((!(bb.path && (bb.path.nav || bb.path.exit)) && ((WAQ[0] = want), (WAQ[1] = bb.path ? Math.min(3.2, Math.max(0.8, legD)) : 3.2), wallAheadQ(W, a))) ||
      (bb.stuckT > 0.3 && ((WAQ[0] = want), (WAQ[1] = 0.9), wallAheadQ(W, a)))) {
    if (bb.path) { bb.path = null; bb.pathGoal = null; }
    reqWhy = 4; requestPath(W, b, tx, tz, ty);
    if (!bb.wallSide) bb.wallSide = !((WAQ[0] = want + 0.9), (WAQ[1] = 3.2), wallAheadQ(W, a)) ? 1 : (!((WAQ[0] = want - 0.9), (WAQ[1] = 3.2), wallAheadQ(W, a)) ? -1 : 1);
    if (!bb.path) {
      // The slide itself must not walk the bot somewhere it cannot leave. Sliding
      // uphill along an isla_viva house wall walked bots into the low-ceiling
      // pocket under its first-floor slab, where player.js blockedHoriz then
      // refuses every direction (measured 2026-09-30: 200+ s pinned). Probe the
      // slide heading at floor height; if that is walled too, slide the other way;
      // if both are, hold still and let the path request (every 2.5 s) find a way.
      WAQ[0] = want + bb.wallSide * 1.05; WAQ[1] = 1.6;
      if (wallAheadQ(W, a)) {
        WAQ[0] = want - bb.wallSide * 1.05; WAQ[1] = 1.6;
        if (!wallAheadQ(W, a)) bb.wallSide = -bb.wallSide;
        else bb.wallSide = 0;
      }
      if (bb.wallSide) want += bb.wallSide * 1.05;
      else if (deckExitPath(W, b, tx, tz)) want = Math.atan2(-(bb.path[0].x - a.pos.x), -(bb.path[0].z - a.pos.z));      // (Wave 7, round 2) walled in on a roof / wall top: off the nearest open edge
      else holdStill = true;
    }
  } else bb.wallSide = 0;
  SYQ[0] = want; steerYawQ(a, dt, bb.path && bb.path.nav ? 12 : 7);      // (Wave 7) on a grid route the legs already go where the route goes (see below): the body follows quickly
  inp.mz = holdStill ? 0 : 1;
  inp.sprint = !!sprint && !holdStill;
  // (Wave 7) the grid replayed a stair, a ramp and a drop at WALK speed (6 m/s); sprinting (8) over one carries the feet further in the air
  if (inp.sprint && bb.path && bb.path.nav && (bb.path[0].k > 0 || (bb.path.length > 1 && bb.path[1].k > 0))) inp.sprint = false;
  /* (Wave 7) FOLLOWING A GRID ROUTE. The yaw above is smoothed (a 7 /s lag), so a bot that turns a corner at 6 m/s walks ~1.2 m along its OLD
     heading before the legs follow the new one: it overshot the foot of a stair by a metre and bounced along its side (measured on the
     Savanna: 8 of 80 upper-floor walks failed). The grid certified each leg for a walker that heads straight at the next waypoint, so the
     move direction is that line NOW, expressed in the current yaw's frame (fireOnTheMove's reprojection); the yaw still turns smoothly. */
  if (bb.path && bb.path.nav && !holdStill) {
    const bq = K.moveBasis(inp.yaw, _mb0), wdx = -Math.sin(want), wdz = -Math.cos(want);
    inp.mz = wdx * bq.fx + wdz * bq.fz;
    inp.mx = wdx * bq.rx + wdz * bq.rz;
  }
  // hop obstacles: support ahead higher than feet → jump
  const aheadX = a.pos.x - Math.sin(a.input.yaw) * 1.4;
  const aheadZ = a.pos.z - Math.cos(a.input.yaw) * 1.4;
  SPQ[0] = aheadX; SPQ[1] = aheadZ; SPQ[2] = a.pos.y + 0.6; supportA(W, SPQ, 0);
  const sup = SPQ[3];
  // (Wave 8) NO HOPS INSIDE A FURNISHED HOUSE. "Support ahead higher than the feet" in a room is a bed, a table, a counter, a wardrobe: the hop put bots
  // ON the furniture (stuck windows on the housed maps: bots 1-2.5 m over the floor on a table / a shelf top, one under the ceiling with 0.7 m of
  // headroom, walled in every direction), and the stuck hop below did the same. The grid never asks for a jump (its edges are walks, drops and ramps).
  // (and none at a house from outside it: the hop probe 1.4 m ahead of a bot in a street doorway lands in the room - a bot jumped onto a bathroom sink)
  const inHouse = IND.H !== null && myRoom(W, b) >= 0;
  const hopIndoors = IND.H !== null && (inHouse || ((RAQ[0] = aheadX), (RAQ[1] = a.pos.y), (RAQ[2] = aheadZ), roomAtQ(W)) >= 0);
  if (!hopIndoors && sup > a.pos.y + 0.55 && sup < a.pos.y + 2.2 && a.onGround) inp.jump = true;
  if (bb.stuckT > 0.7) {
    // jump at most once every 0.9s — the old EVERY-FRAME jump while stuck
    // read as a bot pogo-ing in place inside a house for a minute straight
    // (owner witnessed it). One hop per second is a real "try to get over it".
    if (!hopIndoors && (bb.nextJumpT || 0) <= W.t) { inp.jump = true; bb.nextJumpT = W.t + 0.9; }
    // COMMIT to one detour side — the old per-frame random ±1 jittered the bot
    // left-right against the same wall face forever
    if (!bb.detourDir) bb.detourDir = b.rng() < 0.5 ? -1 : 1;
    inp.mx = bb.detourDir;
    if (bb.stuckT > 2.2) {
      // hard-stuck: ask A* for a real route around the blocker. If no path
      // exists (trapped in a blocked pocket — indoors against a wall), walk to
      // the NEAREST OPEN CELL first; the blind detour is the last resort.
      reqWhy = 5; requestPath(W, b, tx, tz, ty, true);
      if (!bb.path) {
        // Escape search at the bot's OWN floor height (the old ring probed cells
        // at terrain height, so on an upper floor it picked a spot 1.5 m away on
        // the ground below that the bot could never reach — audit S7).
        const hx = IND.H !== null ? houseExitPath(W, b) : null;        // (Wave 8) indoors: out through the room graph's street door (see breakOut)
        const ex = hx || findExit(W, a.pos.x, a.pos.y, a.pos.z, 3);
        if (ex && ex.length) {
          if (!hx) extendExit(W, a, ex);
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
  // (Wave 5) The yaw above is STEERED (a turn rate), so for a few frames after every change of mind the bot walks along its
  // old heading: into the wall it has just detected, or into the one beside a doorway it is being routed through. 12-15 % of
  // the indoor loot / rotate / cover-run ticks of the Wave-4 matches were that: pinned for 5-30 ticks, again and again.
  // Same primitive as the fight steering: a heading that meets a wall within 0.9 m slides along it instead. A hop the state
  // asked for (a crate in the way) is its own business.
  if (!inp.jump) {
    const gm = guardMove(W, b, false);
    // (Wave 7, round 2) HELD by the wall guard (the heading is walled and so is every slide) is not "stuck" to act()'s detectors - they need a move intent, and the guard
    // has just cleared it - and the 3.2 m wall probe above cannot see a THIN wall at arm's length (it samples one point, past the wall). Such a bot stood until the 2.5 s
    // path cool-down ran out (measured: 68 of 11,247 goal-seeking samples with no route stood still, 1-4 s each) or the 3 s progress test parked its loot; one that had landed
    // on the outer ledge of a wall top stood 9.5 s (Savanna seed 26, s25). After 0.25 s of it: ask for a route NOW (the cool-down is for a bot that keeps walking), and on a
    // roof / wall top / ledge with still no route, walk off the nearest open edge.
    if ((gm === 3 || holdStill) && a.onGround) { bb.heldN++; bb.heldAcc += dt; } else { bb.heldN = 0; bb.heldAcc = bb.heldAcc > dt * 2 ? bb.heldAcc - dt * 2 : 0; }
    // (Wave 8) HELD ON A PIECE OF FURNITURE (a sink, a table, a shelf top: the feet 0.3-3 m over the room's floor, not on a stair): the wall probes judge the
    // band from the knee to 2 m over the FEET, never below them, so up there the ceiling slab reads as a wall in every direction and the grid refuses the
    // start (1.95 m of headroom asked) - measured: a bot on a bathroom sink 1.82 m under the slab held for 640 s. The mover can step off (a drop): walk it
    // straight at the nearest part of the room's walkable floor.
    // ... and 1 s of it is as stuck as 3 s without the goal getting closer: the goal-distance timer at the top is reset whenever a route appears and is consumed or is asked
    // for again, so a bot beside an item that lies inside a solid never tripped it (measured: Savanna seed 14, s4, 10 s beside a death drop inside a tower's footprint)
    if (bb.heldAcc >= HELD_STUCK_S) { bb.heldAcc = 0; if (bb.progT < 3.0) bb.progT = 3.01; }
    if (bb.heldN >= HELD_TICKS && W.t >= bb.heldT) {
      bb.heldN = 0; bb.heldT = W.t + HELD_RETRY_S;
      if (!bb.path) { reqWhy = 4; bb.nextPathT = 0; requestPath(W, b, tx, tz, ty, true); if (bb.path) bb.path.held = true; }      // (.held: only for the probes - which paths came from here)
      if (!bb.path && a.pos.y - W.map.heightAt(a.pos.x, a.pos.z) >= DECK_AGL) deckExitPath(W, b, tx, tz);
    }
  }
  // (Wave 8) ... and the same for a bot PINNED (pushing, not moving: stuckT) in a pocket of the furniture outside the room's walkable area
  // (pinned: stuckT - frozen legs - or the pin window - a bot jittering 2-3 cm a frame in a nook never runs stuckT up, the 0.5 s net-displacement window sees it)
  // (K2, re-run) ... and every frame of its committed window (offFurnUntil): the flags above come and go frame by frame
  if (inHouse && a.onGround && (bb.heldN > 0 || holdStill || bb.stuckT > 0.3 || bb.pinN >= 1 || W.t < bb.offFurnUntil) && offFurniture(W, b, dt)) { bb.heldN = 0; bb.heldAcc = 0; }
  qx = tx - a.pos.x; qz = tz - a.pos.z;
  MTQ[2] = Math.sqrt(qx * qx + qz * qz);
}

/** (Wave 8) A bot standing on furniture in its room (feet 0.3-3 m over the floor, not over a stair) walks off it: raw input straight at the centre of the
 *  nearest of the room's walkable rects at least 0.8 m away. true = it did (the caller's hold is overridden).
 *  (K2, re-run) COMMITTED: the heading is picked once and held for OFF_FURN_COMMIT_S (the caller keeps calling while the window runs); a window that
 *  ends with the bot < 0.15 m from where it began moves on to the next candidate (the second-nearest rect centre, then 7 headings round the nearest
 *  one's). The pick used to be made afresh every frame, and only on the frames a hold / pin flag was up: a bot on a bathroom sink half over the room's
 *  edge (isla_viva seed 51204, verify_c: stuck 13.1 %) alternated between it and the hard-stuck detour's strafe, frame by frame, and stood there 320 s -
 *  the real mover walks off that spot on 15 of 16 headings (Node, mover_env). */
const OFF_FURN_COMMIT_S = 0.6;
const OFF_FURN_ALT = [0, 0, 0.785, -0.785, 1.571, -1.571, 2.356, -2.356, 3.142];      // candidate k: 0 = nearest centre, 1 = second centre, 2.. = nearest + these
function offFurniture(W, b, dt) {
  const a = b.actor, bb = b.bb, gi = bb.roomI;        // (fresh: the caller's inHouse test read myRoom this frame)
  if (gi < 0) return false;
  const R = IND.R[gi], dy = a.pos.y - R.y;
  if (dy > 3.0 || dy < -0.3) return false;
  // on the floor: only when the bot stands OUTSIDE the room's walkable area (a pocket behind a chair and a plant, a corner the generator's capsule
  // never reached: the grid finds no way out of it and every probe heading is walled)
  if (dy < 0.3 && inWalk(R, a.pos.x, a.pos.z, 0.2)) { bb.offFurnUntil = -99; return false; }
  if (onStairOf(R.h, a.pos.x, a.pos.y, a.pos.z)) return false;
  if (!(W.t < bb.offFurnUntil && bb.offFurnGi === gi)) {
    const wk = R.r.walk || [];
    let bx = 0, bz = 0, bd = 1e9, cx2 = 0, cz2 = 0, bd2 = 1e9;
    for (let k = 0; k < wk.length; k++) {
      const q = wk[k], cx = (q[0] + q[2]) * 0.5, cz = (q[1] + q[3]) * 0.5, dx = cx - a.pos.x, dz = cz - a.pos.z, d = dx * dx + dz * dz;
      if (d < 0.64) continue;
      if (d < bd) { bd2 = bd; cx2 = bx; cz2 = bz; bd = d; bx = cx; bz = cz; } else if (d < bd2) { bd2 = d; cx2 = cx; cz2 = cz; }
    }
    if (bd >= 1e9) {
      // (no centre 0.8 m away: the nearest at any distance, else straight ahead - a room whose walk area is one small rect under / beside the piece)
      for (let k = 0; k < wk.length; k++) {
        const q = wk[k], cx = (q[0] + q[2]) * 0.5, cz = (q[1] + q[3]) * 0.5, dx = cx - a.pos.x, dz = cz - a.pos.z, d = dx * dx + dz * dz;
        if (d > 0.0004 && d < bd) { bd = d; bx = cx; bz = cz; }
      }
    }
    // the window that just ended (a continuing escape) got the bot nowhere: the next candidate; anything else starts again at the nearest centre
    const mx = a.pos.x - bb.offFurnX, mz = a.pos.z - bb.offFurnZ;
    bb.offFurnK = bb.offFurnGi === gi && W.t - bb.offFurnUntil < 0.25 && mx * mx + mz * mz < 0.15 * 0.15 ? (bb.offFurnK + 1) % OFF_FURN_ALT.length : 0;
    if (bb.offFurnK === 1 && bd2 >= 1e9) bb.offFurnK = 2;
    const y0 = bd < 1e9 ? Math.atan2(-(bx - a.pos.x), -(bz - a.pos.z)) : a.input.yaw;
    bb.offFurnYaw = bb.offFurnK === 1 ? Math.atan2(-(cx2 - a.pos.x), -(cz2 - a.pos.z)) : y0 + OFF_FURN_ALT[bb.offFurnK];
    bb.offFurnUntil = W.t + OFF_FURN_COMMIT_S; bb.offFurnGi = gi; bb.offFurnX = a.pos.x; bb.offFurnZ = a.pos.z;
  }
  // a loot goal a few metres off is what led the bot in (an item in the pocket / on the piece): park it, or the bot walks back in the moment it is out
  if (bb.lootId && bb.moveTo && hyp(bb.moveTo.x - a.pos.x, bb.moveTo.z - a.pos.z) < 4) {
    if (!bb.badLoot) bb.badLoot = {};
    bb.badLoot[bb.lootId] = W.t + 30;
    bb.lootId = null; bb.moveTo = null; b.nextThink = 0;
  }
  nav.st.offFurn++;
  SYQ[0] = bb.offFurnYaw; steerYawQ(a, dt, 20);
  // a pocket on the FLOOR is often closed by low pieces (a side table, a chair): pinned there, hop (a 0.85 m table is in reach: then this walks off it)
  if (dy < 0.3 && (bb.stuckT > 0.7 || bb.pinN >= 1) && bb.nextJumpT <= W.t) { a.input.jump = true; bb.nextJumpT = W.t + 0.9; }
  const B = K.moveBasis(a.input.yaw, _mb0), wdx = -Math.sin(bb.offFurnYaw), wdz = -Math.cos(bb.offFurnYaw);
  a.input.mz = wdx * B.fx + wdz * B.fz; a.input.mx = wdx * B.rx + wdz * B.rz; a.input.sprint = false;
  return true;
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
  // (Wave 5) the intent came from moveToward, whose wall probes look along `want`; the legs follow the yaw, which lags
  // `want` through a turn. A hop the state asked for (a crate in the way) is its own business.
  if (!inp.jump) guardMove(W, b, false);
}

function actMove(W, b, dt, sprint) {
  const bb = b.bb;
  if (!bb.moveTo) { onEnter(W, b, b.state); return; }
  // (Wave 5) the goal's floor rides along (CLOSEIN / HUNT carry the enemy's), and "arrived" means on that floor too
  const ty = bb.moveTo.y;
  MTQ[0] = bb.moveTo.x; MTQ[1] = bb.moveTo.z; moveTowardQ(W, b, dt, sprint, ty);
  const d = MTQ[2];
  if (d < 3 && onFloorOf(b.actor, ty)) { bb.moveTo = null; b.nextThink = 0; }
}

/** A goal's floor test: no floor given (the goal is floor-blind) or the feet are within ARRIVE_DY of it. */
function onFloorOf(a, ty) { return ty == null || Math.abs(a.pos.y - ty) < ARRIVE_DY; }
/** Length of the walk left along `path` from the bot (to its first waypoint, then waypoint to waypoint). */
function routeLeft(a, path) {
  let d = hyp(path[0].x - a.pos.x, path[0].z - a.pos.z);
  for (let i = 1; i < path.length; i++) d += hyp(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return d;
}
const ARRIVE_DY = 1.5;            // metres: a goal is on this floor when the feet are this close to its height (nav useTy uses 1.8)
const WRONG_FLOOR_PLAN_M = 40;    // plan a route to a goal on another floor once it is this close (the planner window is ~31 m)

function actLoot(W, b, dt) {
  const a = b.actor, bb = b.bb;
  // grab everything in arm's reach (chests included). Only worth a query near the
  // goal or mid-channel: walkover (loot.js) already takes items passed on the way,
  // and this allocated a sorted result list every frame for every looting bot.
  const mt = bb.moveTo;
  const nearGoal = !mt || bb.chestId || hyp(mt.x - a.pos.x, mt.z - a.pos.z) < 3.5;
  // 2.2 = loot.js REACH_DY (lane 7C): a bot, like the player, does not take the loot of the floor below / above through a slab
  // (Wave 8 fix round, lane K2) los = true: a HOUSE item / chest is taken only along a clear line from the bot's chest (loot.js pickLos, the player's rule) -
  // a bot on the street used to take the gun on a shelf behind the wall. The bot walks to the thing's STAND point (setLootGoal) so the line is clear there.
  const near = nearGoal ? W.nearbyLoot(a.pos, 2.4, 2.2, true) : _noLoot;
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
    const gy = bb.moveTo.y;     // (moveToward can clear moveTo itself: a parked loot id)
    MTQ[0] = bb.moveTo.x; MTQ[1] = bb.moveTo.z; moveTowardQ(W, b, dt, far, gy); // sprint the long hauls
    const d = MTQ[2];
    const arrived = d < (bb.moveTo && bb.moveTo === bb.standGoal ? LOOT_STAND_M : 1.8) && onFloorOf(a, gy);   // (Wave 5) arrived = on the item's floor too
    // (Wave 8) AT THE ITEM AND NOT GETTING IT. A house item on a shelf or a counter 1.3-1.6 m over the floor, or one the pickup's clear-line rule refuses
    // (loot.js: a house item needs a clear line from the chest), is within reach of the bot's feet but never "arrived" (onFloorOf wants 1.5 m) and never
    // taken: the goal-distance test needs > 2 m to trip, so the bot paced round it (measured: 52 s beside one shelf). 2.5 s within 2 m of a loot goal
    // without taking it parks that item for 30 s. Without houses: unchanged. (3 m, not 2: an item on a shelf behind a counter held a bot 2.0-2.5 m from it,
    // under both tests, for 15 s - ashgrid seed 31, crane@p15.)
    // (K2) counted BEFORE the arrival clears the goal: an arrived-but-not-taken goal is re-planned every other frame, and the old order reset the timer
    // on each arrival, so the park never fired within the arrival radius (the 12 s hard breaker did).
    if (IND.H !== null && bb.lootId && bb.moveTo && d < LOOT_NEAR_M) {
      bb.nearLootT += dt;
      if (bb.nearLootT > 2.5) {
        if (!bb.badLoot) bb.badLoot = {};
        bb.badLoot[bb.lootId] = W.t + 30;
        bb.lootId = null; bb.moveTo = null; bb.nearLootT = 0; b.nextThink = 0; nav.st.lootParked++;
      }
    } else if (!(IND.H !== null && bb.lootId && !bb.moveTo)) bb.nearLootT = 0;
    if (arrived && bb.moveTo) bb.moveTo = null;
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
    const ux = dx / d, uz = dz / d;                          // threat -> bot: the way to retreat
    // (Wave 5) This used to write `a.yaw = atan2(-dx/d, -dz/d)` and then `inp.mz = -1` ("face the threat while backing
    // off"). player.js stepActor does `a.yaw = inp.yaw` every tick, so the write never took, and `mz = -1` backed the bot
    // up along its OLD input yaw - TOWARDS the threat whenever the threat was behind it (20 % of the heal ticks of 7
    // Wave-4 matches moved toward a known threat; the same atan2 also faced the wrong way). Fixed in the one place the
    // mover listens: steer INPUT yaw to face the threat (or the way of travel when there is none), pick a heading that is
    // free of walls and not toward the threat, and express that WORLD heading in the yaw frame the mover will use.
    const fan = pickRetreat(W, b, wallCols(W, b), ux, uz);
    const face = bb.targetPos ? Math.atan2(dx, dz) : (fan ? Math.atan2(-_gh.x, -_gh.z) : Math.atan2(-ux, -uz));
    steerYaw(a, face, dt, 8);
    if (fan) {
      const B = K.moveBasis(a.input.yaw, _mb0);
      a.input.mz = _gh.x * B.fx + _gh.z * B.fz;              // backing off at the slowed heal speed
      a.input.mx = _gh.x * B.rx + _gh.z * B.rz;
    } else { a.input.mz = 0; a.input.mx = 0; }               // walled in: hold the corner and finish the heal there
  } else {
    a.input.mz = 0; a.input.mx = 0;
  }
  a.input.sprint = false;                   // the sim blocks it anyway; be explicit
}

const RETREAT_FAN = [0, 0.61, -0.61, 1.22, -1.22, 1.75, -1.75];
const POCKET_PROBE_M = 0.9;      // (K2) pickRetreat: a heading whose point this far ahead is in the room but off its walkable area is a pocket
/** (K2) heading (hx, hz) from a bot on room R's floor leads into a pocket: the point POCKET_PROBE_M ahead lies inside the room's rects but outside its
 *  walkable area (housegen rooms[].walk + 0.2 m: the floor its capsule could stand on), while the bot itself stands on that area. A point that
 *  leaves the room's rects (a doorway) is no pocket (headingBlocked judges its walls); off the floor (a stair) / no walk data: never. */
function retreatPocket(R, a, hx, hz) {
  if (Math.abs(a.pos.y - R.y) > 0.3 || !R.r.walk || !R.r.walk.length) return false;
  if (!inWalk(R, a.pos.x, a.pos.z, 0.2)) return false;     // (already off it: offFurniture's business, any heading may be the way back)
  const px = a.pos.x + hx * POCKET_PROBE_M, pz = a.pos.z + hz * POCKET_PROBE_M;
  let inRoom = false;
  for (let k = 0; k < R.rects.length; k++) { const q = R.rects[k]; if (px >= q[0] && px <= q[2] && pz >= q[1] && pz <= q[3]) { inRoom = true; break; } }
  return inRoom && !inWalk(R, px, pz, 0.2);
}   // radians off straight-away: 0, 35, 70, 100 degrees, both sides
const HEAL_HOLD_S = 0.45;         // (Wave 7b, S1) the longest a healer holds a corner before it takes the way back out (pickRetreat)
/** The heal retreat heading: the first FREE heading in a fan of +-100 degrees around straight-away-from-the-threat (never a
 *  heading with a component toward it). The fan opens on the side last used first, so the choice does not dither. Writes the
 *  unit heading to _gh (and bb.hdX/hdZ, for the pin recovery); false = every heading in the fan is walled. */
function pickRetreat(W, b, list, ux, uz) {
  const a = b.actor, bb = b.bb;
  // COMMIT: the heading chosen last is kept for 0.6 s while it is still free and still a retreat. Choosing afresh every frame
  // flip-flopped a healing bot in a small room between two headings 135 degrees apart (measured: 14 % of the indoor heal
  // ticks blocked, a bot shuffling in place for the whole channel), because each step it takes changes which of the fan's
  // headings is free.
  // (Wave 8 fix round, lane K2) inside a furnished room: no heading into a furniture POCKET (navcheck heal-indoor: a healer backed between a shop
  // cooler and a gondola 0.68 m apart and ground there 64 + 48 + 45 ticks - Savanna seed 7, (422.6, 414.3)); see retreatPocket. Outdoors: unchanged.
  const gi = IND.H !== null ? myRoom(W, b) : -1;
  if (W.t - bb.hdT < 0.6 && bb.hdX * ux + bb.hdZ * uz > -0.17) {
    _hd.x = bb.hdX; _hd.z = bb.hdZ;
    if (!headingBlocked(W, list, a) && !(gi >= 0 && retreatPocket(IND.R[gi], a, bb.hdX, bb.hdZ))) { _gh.x = bb.hdX; _gh.z = bb.hdZ; return true; }
  }
  const side = bb.healSide;
  for (let k = 0; k < RETREAT_FAN.length; k++) {
    const off = RETREAT_FAN[k] * side;
    const c = Math.cos(off), s = Math.sin(off);
    const hx = ux * c - uz * s, hz = ux * s + uz * c;
    if (W.t < bb.hdBadUntil && hx * bb.hdBadX + hz * bb.hdBadZ > 0.9) continue;    // the heading a pin just proved wrong
    _hd.x = hx; _hd.z = hz;
    if (headingBlocked(W, list, a)) continue;
    if (gi >= 0 && retreatPocket(IND.R[gi], a, hx, hz)) continue;
    // a REVERSAL of the retreat inside a second (the way it was going just closed): hold the corner instead of pacing - for at most
    // HEAL_HOLD_S. (Wave 7b, S1) The hold renewed itself (it set hdT, which re-armed the 1 s window on every frame of the hold), so a healer
    // whose only way out lay behind its last heading - under a stair against a wall, the new house stairs of Isla Viva / Deepwood - stood
    // under the slab for the whole heal (navcheck heal-pockets under:2.4: 199 of 298 escaped on Isla Viva); past the hold it takes the way out.
    if (W.t - bb.hdT < 1.0 && bb.hdX * hx + bb.hdZ * hz < -0.3) {
      if (bb.hdHold < 0 || bb.hdHold > W.t) bb.hdHold = W.t;
      if (W.t - bb.hdHold < HEAL_HOLD_S) { bb.hdT = W.t; return false; }
    }
    bb.hdHold = -1;
    _gh.x = hx; _gh.z = hz;
    bb.hdX = hx; bb.hdZ = hz; bb.hdT = W.t;
    if (k > 0) bb.healSide = off < 0 ? -1 : 1;
    return true;
  }
  return false;
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
  CSQ[0] = dist;
  return coverStepQ(W, b, dt, tp, seen);
}
const CSQ = new Float64Array(1);          // coverStepQ's dist (Wave 7b, S1: no boxed argument)
function coverStepQ(W, b, dt, tp, seen) {
  const dist = CSQ[0];
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
    MTQ[0] = cp.x; MTQ[1] = cp.z; moveTowardQ(W, b, dt, d > 6);
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
    // (Wave 8) HOLD THE ROOM: indoors the spot is beside a doorway of the bot's own room and the threat comes through that doorway - face IT (the
    // threat's last position is behind a wall), so the peek / the man stepping through meets a gun already pointing at the opening
    if (bb.coverFace) steerYaw(a, Math.atan2(-(bb.coverFX - a.pos.x), -(bb.coverFZ - a.pos.z)), dt, 6);
    else steerYaw(a, Math.atan2(-(tp.x - a.pos.x), -(tp.z - a.pos.z)), dt, 6);
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
  // test rejects it before any raycast. (Wave 8) occAny answers what queryColliders(x, z, 16).length did, from a cell table: on a map of furnished
  // houses the query handed back whole houses (up to ~680 colliders) to read one boolean.
  if (!occAny(W, a.pos.x, a.pos.z, 16)) { bb.coverFailUntil = W.t + COVER_FAIL_MEMO; return false; }

  _coverBudget--;
  // (Wave 8) indoors (a room of a furnished house): the cover is the wall beside one of this room's doorways, or a tall piece of furniture in it - never
  // the outdoor ring's 7 / 14 m points, which lie in other rooms and outside, through walls
  const gi = myRoom(W, b);
  const found = gi >= 0 ? findCoverIndoor(W, b, gi, tp) : findCover(W, a, tp);
  bb.coverFace = 0;
  if (!found) { if (gi >= 0) nav.st.coverInFail++; bb.coverFailUntil = W.t + COVER_FAIL_MEMO; return false; }
  if (gi >= 0) { nav.st.coverIn++; if (_icDoor) { nav.st.coverInDoor++; bb.coverFace = 1; bb.coverFX = _icDoor.x; bb.coverFZ = _icDoor.z; } }
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

/** (Wave 8) Is (x, z) inside room R's walkable rects (housegen rooms[].walk: where its r 0.6 capsule stood), grown by m? */
function inWalk(R, x, z, m) {
  const wk = R.r.walk;
  if (!wk || !wk.length) return true;                      // (no walk data: no opinion)
  for (let k = 0; k < wk.length; k++) { const q = wk[k]; if (x >= q[0] - m && x <= q[2] + m && z >= q[1] - m && z <= q[3] + m) return true; }
  return false;
}
/** (Wave 8) Cover INSIDE a room (gi): beside each of its doorways, 0.9 m in from the wall and 1.85 m along it from the doorway's centre (the 2.26 m
 *  opening + a capsule and a hand: the bot stands against the wall, out of the line through the door), and a ring of 2.5 / 4.5 m points in the room
 *  (a wardrobe, a shelf, a fridge, a kitchen run between it and the threat). A spot must be in THIS room (roomAt), standable on this floor and break the
 *  line to the threat (losTruncated). Doorways nearer the threat score higher (the one he will come through). Sets _icDoor = the doorway the spot
 *  holds (null for a furniture spot). */
let _icDoor = null;
function findCoverIndoor(W, b, gi, tp) {
  const a = b.actor, R = IND.R[gi], gy = a.pos.y, rid = R.r.id;
  let best = null, bestScore = -1e9;
  _icDoor = null;
  for (let k = 0; k < R.doors.length; k++) {
    const d = R.doors[k];
    // the normal INTO this room: an outer door's normal points out of rooms[0], an interior door's from rooms[0] to rooms[1]
    const into = d.kind === "interior" && d.rooms[1] === rid ? 1 : -1;
    const ix = d.nx * into, iz = d.nz * into, tx = -iz, tz = ix;
    const dd = hyp(d.x - tp.x, d.z - tp.z);
    for (let s = -1; s <= 1; s += 2) {
      const x = d.x + ix * 0.9 + tx * s * 1.85, z = d.z + iz * 0.9 + tz * s * 1.85;
      if (!inWalk(R, x, z, 0) || roomAt(W, x, gy, z) !== gi) continue;      // (in the room's walkable area: never a pocket behind the furniture)
      const h = standAt(W, x, z, gy);
      if (h !== h || h - gy > 0.6 || gy - h > 0.6) continue;
      if (!losTruncated(W, x, h, z, tp)) continue;
      const score = -dd * 0.6 - hyp(x - a.pos.x, z - a.pos.z) * 0.5;
      if (score > bestScore) { bestScore = score; best = { x, z }; _icDoor = d; }
    }
  }
  const toT = Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z);
  for (let ri = 0; ri < 2; ri++) {
    const r = ri === 0 ? 2.5 : 4.5;
    for (let i = 0; i < 6; i++) {
      const ang = toT + Math.PI + (i - 2.5) * 0.62;
      const x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
      if (!inWalk(R, x, z, 0) || roomAt(W, x, gy, z) !== gi) continue;      // (in the room's walkable area: never a pocket behind the furniture)
      const h = standAt(W, x, z, gy);
      if (h !== h || h - gy > 0.6 || gy - h > 0.6) continue;
      if (!losTruncated(W, x, h, z, tp)) continue;
      const score = -r - 4 + Math.min(20, hyp(x - tp.x, z - tp.z)) * 0.2;    // a doorway (above) is the better spot when there is one
      if (score > bestScore) { bestScore = score; best = { x, z }; _icDoor = null; }
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
  CSQ[0] = dist;
  if (coverStepQ(W, b, dt, tp, seen)) return;

  // RELOADING = break for lateral cover, don't stand in the open trading nothing
  if (a.weapon && a.weapon.state === "reloading") {
    inp.mx = bb.strafeDir;
    inp.mz = -0.5;
    inp.sprint = true;
    SYQ[0] = Math.atan2(-(tp.x - a.pos.x), -(tp.z - a.pos.z)); steerYawQ(a, dt, 10);
    guardMove(W, b, true);        // (Wave 5) the strafe / back-off must not go into a wall
    return;
  }
  // BOT_PACE.chaseM: nobody walks 100 m across open ground at a man who has not touched him. Past the tier's
  // chase reach an UN-PROVOKED bot holds its ground and trades fire at range (long, low-hit duels) instead of
  // closing; once he is hit (4 s), or the lobby is nearly down, he closes as before. A short gun out of range
  // HOLDS too and keeps watching him (the fight-fatigue breaker above lets him go after 14 s). Dropping that
  // target for 6 s instead was tried and measured worse: the 6-s avoid made the bot blind to exactly that man,
  // who then walked up on it - isla_viva seed 1 first-minute deaths 8 -> 15, stuck 0.1 % -> 1.7 % (SIM lane, wave 4).
  const chaseOk = dist <= paceAt(PACE.chaseM, a.tier || 3) || W.t - a.lastDamageT < 4 || W.match.aliveCount() <= 6;
  // (Wave 8) INDOORS, THE APPROACH IS A ROUTE. A man seen through a doorway or a window of another room (or from the street into a room, or from a room
  // out) is not closed on by a straight push: that walks into the wall between (guardMove then slides along it) - through the doors, up the stairs, on
  // the grid, the way CLOSEIN goes. The route's world heading is kept and re-expressed in the aim yaw below (fireOnTheMove's reprojection). No strafe
  // while closing in that way (the legs follow the route). Off when there are no houses: the Wave-7b fight, draw for draw.
  let routeX = 0, routeZ = 0, routed = false;
  if (dist > prefer * 1.5 && chaseOk && IND.H !== null) {
    const mi = myRoom(W, b), ti = targetRoom(W, b, tp);
    if ((mi >= 0 || ti >= 0) && mi !== ti) {
      MTQ[0] = tp.x; MTQ[1] = tp.z; moveTowardQ(W, b, dt, dist > prefer * 3, tp.y);
      const B0 = K.moveBasis(inp.yaw, _mb0);
      routeX = B0.fx * inp.mz + B0.rx * inp.mx; routeZ = B0.fz * inp.mz + B0.rz * inp.mx;
      routed = true; nav.st.routedFrames++;
    }
  }
  if (routed) { /* the legs follow the route (re-expressed after the aim, below) */ }
  else if (dist > prefer * 1.5 && chaseOk) { inp.mz = 1; inp.sprint = dist > prefer * 3; }
  else if (dist < prefer * 0.5) inp.mz = -0.7;
  if (!routed) inp.mx = bb.strafeDir * (dist < 50 ? 1 : a.personality === "flanker" ? 0.8 : 0.4);
  // (Wave 5) the dodge hop is for open air: indoors it is a bot pogo-ing in a house, and under a low ceiling the head meets
  // the slab and a capsule jammed under it is blocked in every direction (the draw is kept either way, so the rng stream does
  // not depend on the roof)
  if (a.onGround && b.actor.tier >= 3 && b.rng() < dt * 0.35 && !roofedForJump(W, b)) inp.jump = true;

  // aiming with human error model
  const eye = eyePos(a, _eye_actEngage);
  // Aim as a FRACTION of the target's real capsule instead of a fixed 1.15m,
  // which was hard-coded for a standing 1.8m actor. weapons.js scores a headshot
  // above 0.86 of actorHeight — 1.548m standing — so 1.15m could only ever land
  // on the body. A fixed 1.62m head point would work standing but sits just
  // 0.05m under a crouched capsule's 1.668m ceiling and a full 0.6m OVER a
  // swimmer's 1.02m one, so scale it: 0.94 stays inside the head band at every
  // stance, 0.64 reproduces the old ~1.15m chest point when standing.
  // K.actorHeight(t), inlined (a call returns a boxed double)
  const th = t.swimming ? 0.9 : K.PLAYERK.height * (t && t.crouching && t.hasCrouchClip ? K.CROUCH.heightMult : 1);
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

  SYQ[0] = wantYaw; steerYawQ(a, dt, 10);
  if (routed) {                                   // (Wave 8) the route's world heading in the new aim yaw's frame
    const B1 = K.moveBasis(inp.yaw, _mb1);
    inp.mz = routeX * B1.fx + routeZ * B1.fz;
    inp.mx = routeX * B1.rx + routeZ * B1.rz;
  }
  inp.pitch = Math.max(-1.3, Math.min(1.3, inp.pitch + (wantPitch - inp.pitch) * Math.min(1, dt * 9)));

  // fire discipline: reaction delay, LOS, range, bursts
  const reacted = sinceAcq > b.tierK.reactionMs / 1000;
  const inRange = dist < (def.falloff ? def.falloff[1] * 1.3 : 30);      // fireRangeM(def), inlined          // the same reach ensureGunOut values a gun at
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
  // (Wave 8) PUSH THE STAIRS: with houses the search goes to HIS floor (moveToward is floor-aware: a last-known spot a storey up is reached by
  // the stairs, not by standing under it); without houses the floor-blind search of Wave 7b.
  if (!routed && !seen && bb.targetPos && (bb.coverState === "NONE" || !bb.coverState)) {
    if (IND.H !== null && Math.abs(bb.targetPos.y - a.pos.y) >= ARRIVE_DY) nav.st.stairSearch++;
    MTQ[0] = bb.targetPos.x; MTQ[1] = bb.targetPos.z; moveTowardQ(W, b, dt, false, IND.H !== null ? bb.targetPos.y : undefined);
  }
  // (Wave 5) wall-aware fight steering: the strafe / approach / back-off above are raw input; this is the one place they
  // meet the walls. After the yaw has been steered, so the heading it judges is the one the mover will use this tick.
  guardMove(W, b, !routed);
}

/** (Wave 8) The room the fight's target stands in (from the position the bot knows: tp), refreshed at most every IND_ROOM_S. -1 outdoors. */
function targetRoom(W, b, tp) {
  const bb = b.bb;
  if (W.t - bb.tRoomT < IND_ROOM_S && W.t >= bb.tRoomT) return bb.tRoomI;
  RAQ[0] = tp.x; RAQ[1] = tp.y; RAQ[2] = tp.z; bb.tRoomI = roomAtQ(W); bb.tRoomT = W.t;
  return bb.tRoomI;
}
