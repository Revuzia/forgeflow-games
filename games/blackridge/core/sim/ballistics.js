// core/sim/ballistics.js [A1] — swept sub-stepped projectiles (R5: combat_spec
// §3.1 — Warden 700 m/s, Corvus 850, Vesper/Pike 999 "hitscan"), penetration
// per combat_spec §3.2, spread via THE shared effectiveSpread (§2.5), falloff
// (§3.3), whiz-by (§7.2). Frozen signature fireShot(sim, shooter, weapon,
// origin, aimDir, rng) kept (architecture §3.7); private exports added.
//
// EVENT CONVENTION (flagged to A0 as a freeze-amendment request; additive
// fields only, no new event types):
//   - The pellet's `shot` event is emitted at FIRE time (muzzle flash / bang /
//     vm kick are on time). If the swept projectile resolves within the fire
//     tick, `hit` rides inline. Otherwise `hit:null` at fire time and the
//     RESOLUTION emits a second `shot` event with `impactOnly:true` — muzzle/
//     bang/kick/fire-anim consumers MUST ignore impactOnly events; impact-fx/
//     hitmarker consumers process them.
//   - Penetration (§3.2: FX on BOTH faces) emits `impactOnly` events with
//     `pen:'entry'|'exit'` and a world-surface hit; the pellet's terminal
//     event is separate. hit.entity is always null on pen events.
// Counters: shotsFired increments at fire time (player pellets); shotsHit at
// resolution when hit.entity is a bot.

import { applyDamage } from "./damage.js";
import { rayBox } from "./world.js";

// ---------------------------------------------------------------- constants
const SUBSTEP_M = 2.5;          // §3.1 sub-step cap
const MAX_RANGE_M = 180;        // > map diagonal; terminal miss beyond this
const TRACER_COLOR = 0xffd9a0;  // §3.1 (view-side reference)
const WHIZ_DIST_M = 3.0;        // §7.2 rounds passing < 3 m of the camera
const PEN_DEVIATION_RAD = 0.8 * Math.PI / 180; // §3.2 +0.8° after penetration
const HEAD_TOP_FRAC = 0.86;     // head = top 14% of capsule ...
const HEAD_AXIAL_M = 0.20;      // ... AND within 0.20 m of the capsule axis
const ACTOR_RADIUS = 0.35;
const ACTOR_SLOP = 0.05;

// §3.2 penetration table (weapon-id keyed; class fallback for safety).
export const PENETRATION = {
  warden: { classes: ["soft", "metal_thin"], retain: 0.70, maxThick: 0.25 },
  vesper: { classes: ["soft"], retain: 0.45, maxThick: 0.15 },
  corvus: { classes: ["soft", "metal_thin"], retain: 0.85, maxThick: 0.40 },
  pike: null,
  _byClass: { ar: "warden", smg: "vesper", dmr: "corvus", pistol: "pike" },
};

export function penFor(weaponId, weapon) {
  if (Object.prototype.hasOwnProperty.call(PENETRATION, weaponId)) return PENETRATION[weaponId];
  const alias = weapon && PENETRATION._byClass[weapon.class];
  return alias ? PENETRATION[alias] : null;
}

// ---------------------------------------------------------------- spread
// §2.5 — ONE function used by firing AND the crosshair (A10 imports this).
// Returns the cone HALF-ANGLE in RADIANS (weapon_data stores spread.hip/.ads
// in radians per architecture §3.10).
// state: { ads:bool, adsProgress:0..1, speed:m/s, airborne, sliding,
//          crouched, steady (stationary ≥0.4s AND no shot ≥0.45s),
//          landedRecently (within 0.4 s of a ≥4 m landing) }
// Full ADS (progress ≥ 1) returns weapon.spread.ads — 0 for Warden/Vesper/
// Pike per §2.4, small non-zero for Corvus ("except Corvus" clause).
// The per-weapon moveMult/crouchMult data fields are NOT used: §2.5's graded
// speed term and fixed multipliers are THE spec (BUILD_PLAN names §2.5 as the
// single shared function; probe_spread asserts these multipliers exactly).
export function effectiveSpread(weapon, s = {}) {
  if (s.ads && (s.adsProgress ?? 0) >= 1) return weapon.spread.ads;
  let spread = weapon.spread.hip;
  if (s.ads) spread *= Math.max(0, 1 - 0.8 * (s.adsProgress ?? 0));
  spread *= 1 + Math.min(0.65, (s.speed || 0) * 0.06);
  if (s.airborne) spread *= 1.9;
  if (s.sliding) spread *= 1.6;
  if (s.crouched) spread *= 0.75;
  if (s.steady) spread *= 0.55;
  if (s.landedRecently) spread *= 1.35;
  return spread;
}

// ---------------------------------------------------------------- falloff
// §3.3 — linear lerp body→min between falloffStart→falloffEnd, flat beyond.
export function falloffDamage(weapon, dist, part = "body") {
  const d = weapon.damage;
  let dmg;
  if (dist <= d.falloffStart) dmg = d.body;
  else if (dist >= d.falloffEnd) dmg = d.min;
  else dmg = d.body + (d.min - d.body) * ((dist - d.falloffStart) / (d.falloffEnd - d.falloffStart));
  if (part === "head") dmg *= d.headMult;
  else if (part === "limb") dmg *= d.limbMult ?? 1;
  return dmg;
}

// ---------------------------------------------------------------- aim math
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function anglesFromDir(d) {
  const yaw = Math.atan2(-d[0], -d[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
  return { yaw, pitch };
}

function rotateDir(d, dYaw, dPitch) {
  const a = anglesFromDir(d);
  return dirFromAngles(a.yaw + dYaw, a.pitch + dPitch);
}

// ---------------------------------------------------------------- actors
function actorHeight(sim, who) {
  if (who === "P") return sim.state.player.stance === "crouch" ? 1.35 : 1.80;
  const b = sim.state.bots.find((b) => b.id === who);
  return b && b.stance === "crouch" ? 1.35 : 1.80;
}

// Nearest actor hit along segment a→b. Skips owner + dead. Returns
// {who, u (0..1 along segment), pos:[3], part} | null.
function actorHitOnSegment(sim, ownerId, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let best = null;
  const testOne = (who, pos, stance) => {
    const feetY = pos[1];
    const h = stance === "crouch" ? 1.35 : 1.80;
    const headY = feetY + h;
    let u = len2 > 0 ? ((pos[0] - ax) * dx + (pos[2] - az) * dz) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + dx * u, pz = az + dz * u, py = ay + (by - ay) * u;
    const axial = Math.hypot(px - pos[0], pz - pos[2]);
    if (axial >= ACTOR_RADIUS + ACTOR_SLOP + 0.07) return;
    if (py < feetY - 0.05 || py > headY + 0.07) return;
    if (best && u >= best.u) return;
    const part = (py > feetY + (headY - feetY) * HEAD_TOP_FRAC && axial < HEAD_AXIAL_M) ? "head" : "body";
    best = { who, u, pos: [px, py, pz], part };
  };
  if (ownerId !== "P" && sim.state.player.alive && !sim.flags.noTarget) {
    testOne("P", sim.state.player.pos, sim.state.player.stance);
  }
  for (const b of sim.state.bots) {
    if (!b.alive || b.id === ownerId) continue;
    testOne(b.id, b.pos, b.stance);
  }
  return best;
}

// ---------------------------------------------------------------- events
function shotEvent(sim, proj, hit, impactOnly, extra) {
  const ev = {
    shooter: proj.who, weaponId: proj.weaponId,
    origin: proj.origin.slice(), dir: proj.launchDir.slice(),
    hit, tracer: proj.tracer, pellet: proj.pellet,
  };
  if (impactOnly) ev.impactOnly = true;
  if (extra) Object.assign(ev, extra);
  sim.emit("shot", ev);
}

function resolveHitPayload(pos, normal, surface, entity, part) {
  return { pos: pos.slice(), normal: normal ? normal.slice() : [0, 1, 0], surface, entity, part };
}

// ---------------------------------------------------------------- projectile
// Advances proj by `dist` metres. Returns true when the projectile resolved
// (event emitted, damage applied). fireTick=true suppresses the impactOnly
// flag (the hit rides the fire-time event instead).
function advance(sim, proj, dist, fireTick) {
  const world = sim.world;
  let remaining = dist;
  const segStartX = proj.pos[0], segStartY = proj.pos[1], segStartZ = proj.pos[2];
  let resolved = false, resolvedHit = null;

  while (remaining > 0 && !resolved) {
    const seg = Math.min(SUBSTEP_M, remaining);
    const o = proj.pos, d = proj.dir;
    const wh = world.raycast(o, d, seg);
    const bx = o[0] + d[0] * seg, by = o[1] + d[1] * seg, bz = o[2] + d[2] * seg;
    const ah = actorHitOnSegment(sim, proj.who, o[0], o[1], o[2], bx, by, bz);
    const aDist = ah ? ah.u * seg : Infinity;
    const wDist = wh ? wh.dist : Infinity;

    if (ah && aDist <= wDist) {
      // actor hit — nearest wins, world was solved first (§3.1 arbitration)
      const travel = proj.traveled + aDist;
      const dmg = falloffDamage(proj.weapon, travel, ah.part) * proj.dmgMult;
      resolvedHit = resolveHitPayload(ah.pos, [-d[0], -d[1], -d[2]],
        ah.who === "P" ? "flesh" : "flesh", ah.who, ah.part);
      if (proj.who === "P") sim.state.counters.shotsHit++;
      applyDamage(sim, ah.who, dmg, proj.who, ah.part, "shot");
      resolved = true;
      proj.pos = ah.pos.slice();
      proj.traveled = travel;
    } else if (wh) {
      // world hit — penetration check (§3.2)
      const pen = penFor(proj.weaponId, proj.weapon);
      const mat = wh.box ? (wh.box.matClass || "hard") : "hard";
      let penetrated = false;
      if (!proj.penUsed && pen && wh.box && pen.classes.indexOf(mat) >= 0) {
        const rb = rayBox(o, d, wh.box);
        const thick = rb ? rb.tOut - Math.max(0, rb.tIn) : Infinity;
        if (thick <= pen.maxThick) {
          const exitT = rb.tOut + 0.001;
          const entryPos = wh.pos;
          const exitPos = [o[0] + d[0] * exitT, o[1] + d[1] * exitT, o[2] + d[2] * exitT];
          shotEvent(sim, proj, resolveHitPayload(entryPos, wh.normal, wh.surface, null, null), true, { pen: "entry" });
          shotEvent(sim, proj, resolveHitPayload(exitPos, [d[0], d[1], d[2]], wh.surface, null, null), true, { pen: "exit" });
          proj.penUsed = true;
          proj.dmgMult *= pen.retain;
          // +0.8° deviation, random azimuth (weapons/spread stream)
          const az = sim.rng.spread() * Math.PI * 2;
          proj.dir = rotateDir(d, Math.cos(az) * PEN_DEVIATION_RAD, Math.sin(az) * PEN_DEVIATION_RAD);
          proj.pos = exitPos;
          proj.traveled += exitT;
          remaining -= exitT;
          penetrated = true;
        }
      }
      if (!penetrated) {
        resolvedHit = resolveHitPayload(wh.pos, wh.normal, wh.surface, null, null);
        resolved = true;
        proj.pos = wh.pos.slice();
        proj.traveled += wh.dist;
      }
    } else {
      proj.pos = [bx, by, bz];
      proj.traveled += seg;
      remaining -= seg;
    }
    if (!resolved && proj.traveled >= MAX_RANGE_M) {
      resolved = true;
      resolvedHit = null; // terminal miss
    }
  }

  // §7.2 whiz-by: bot rounds passing < 3 m of the player's eye — once per
  // pellet, tested against this tick's whole travel segment.
  if (proj.who !== "P" && !proj.whizzed && sim.state.player.alive) {
    const p = sim.state.player;
    const eye = [p.pos[0], p.pos[1] + (p.stance === "crouch" ? 1.10 : 1.62), p.pos[2]];
    const cx = eye[0] - segStartX, cy = eye[1] - segStartY, cz = eye[2] - segStartZ;
    const ex = proj.pos[0] - segStartX, ey = proj.pos[1] - segStartY, ez = proj.pos[2] - segStartZ;
    const l2 = ex * ex + ey * ey + ez * ez;
    let t = l2 > 0 ? (cx * ex + cy * ey + cz * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = segStartX + ex * t, qy = segStartY + ey * t, qz = segStartZ + ez * t;
    const miss = Math.hypot(qx - eye[0], qy - eye[1], qz - eye[2]);
    if (miss < WHIZ_DIST_M) {
      proj.whizzed = true;
      sim.emit("whiz", { pos: [qx, qy, qz], dist: miss });
    }
  }

  if (resolved) {
    if (fireTick) proj.fireTickHit = resolvedHit; // ride the fire-time event
    else shotEvent(sim, proj, resolvedHit, true);
    proj.dead = true;
  }
  return resolved;
}

// ---------------------------------------------------------------- fireShot
// Frozen signature (architecture §3.7). shooter 'P'|botId. weapon = the
// WEAPONS entry. origin [3] (eye). aimDir [3] normalized base aim (recoil
// pattern + spread applied HERE). rng = the spread/weapons stream.
// Emits the fire-time `shot` event(s); returns the first pellet's inline hit
// or null.
export function fireShot(sim, shooter, weapon, origin, aimDir, rng) {
  const actor = shooter === "P" ? sim.state.player
    : sim.state.bots.find((b) => b.id === shooter);
  if (!actor) return null;
  const w = actor.weapon;
  const weaponId = w.id;
  const pellets = weapon.pellets || 1;

  // spread state — the crosshair draws THIS number (§2.5 shared model)
  const st = shooter === "P" ? playerSpreadState(sim) : botSpreadState(sim, actor);
  const spread = effectiveSpread(weapon, st);
  w._lastSpread = spread; // probe hook: shared-model identity

  // ---------------------------------------------------------------- §2.3
  // RECOIL AIM AUTHORITY — "aim and camera are one ray ... exactly one
  // recoil" (combat_spec §2.3, first line). The pattern step is added to THE
  // AIM, and the round that triggers the kick leaves along the PRE-kick aim.
  //
  // WAVE-10 AIM-TRUTH FIX (owner report: "where i aim is where it hits").
  // This block used to add the step to the BULLET as well, on top of the
  // camera climb weapons/recoil.js already applies through input.addLook —
  // two recoils, which is the third-person anti-pattern §2.3 opens by
  // forbidding. MEASURED in the live page before the fix (16 single shots,
  // stationary, full ADS, spread 0, angle between the RENDERED camera
  // forward at trigger-down and the bullet's launch direction):
  //     warden  mean 0.436° / p50 0.413°  =  5.3 px high at 1280x720
  //     pike    mean 0.855°               = 10.6 px high
  //     corvus  mean 1.894°               = 34.9 px high  (1.65 m at 50 m)
  // i.e. every FIRST shot of every burst — the one §2.4 promises is a laser
  // at full ADS — left the barrel one whole pattern row above the crosshair.
  //
  // The player's climb is view-side: it is already inside cmd.yaw/pitch by
  // the time the sim sees it, so the bullet must follow that cmd EXACTLY.
  // BOTS have no view-side recoil module, so for them the sim stays the
  // recoil authority and applies the step here, unchanged.
  // sim.flags.simRecoil makes the sim the authority for the player too —
  // headless probes (sim.selftest probe_recoil) have no recoil.js and set it
  // to model the same climb. It is FALSE in the live game, always.
  const pat = weapon.recoil && weapon.recoil.pattern && weapon.recoil.pattern.length
    ? weapon.recoil.pattern : [[0, 0]];
  let idx = w.recoilIndex || 0;
  if (idx >= pat.length) {
    const tail = Math.min(4, pat.length);
    idx = pat.length - tail + ((idx - pat.length) % tail);
  }
  const jit = weapon.recoil && weapon.recoil.jitter != null ? weapon.recoil.jitter : 0.12;
  const scale = (weapon.recoil && weapon.recoil.scale) || 1;
  // The jitter rolls are drawn UNCONDITIONALLY: the `weapons` rng stream's
  // position is part of the determinism contract (probe_determinism hashes
  // 3000 ticks), so skipping the draws would reseed every later spread roll.
  const jy = 1 + (rng() * 2 - 1) * jit;
  const jp = 1 + (rng() * 2 - 1) * jit;
  const simOwnsRecoil = shooter !== "P" || !!(sim.flags && sim.flags.simRecoil);
  const stepYaw = simOwnsRecoil ? pat[idx][0] * jy * scale : 0;
  const stepPitch = simOwnsRecoil ? pat[idx][1] * jp * scale : 0;

  const base = anglesFromDir(aimDir);
  let firstHit = null;

  for (let p = 0; p < pellets; p++) {
    // uniform sample inside the cone
    const ang = spread * Math.sqrt(rng());
    const az = rng() * Math.PI * 2;
    const dir = dirFromAngles(
      base.yaw + stepYaw + ang * Math.cos(az),
      base.pitch + stepPitch + ang * Math.sin(az),
    );
    // v2.2 (A0 wave-3) execution-level muzzle discipline for AI shooters:
    // A5's 1.4 m fire-AUTH gate checks the pre-move AIM line, but a
    // post-spread PELLET ray can still clip a hard occluder corner within
    // the 1.2 m fairness bound (combat_spec §5.7; measured 2/thousands of
    // shots over 30 seeds after the nav-route change). Suppress exactly
    // those pellets at fire time — bots never visibly shoot cover
    // point-blank, and the probe-level invariant holds by construction.
    if (shooter !== "P" && sim.world && sim.world.raycast) {
      const mb = sim.world.raycast(origin, dir, 1.2);
      if (mb && mb.box && (mb.box.matClass || "hard") === "hard") continue;
    }
    const shotIdx = (w._shotCount = (w._shotCount || 0) + 1);
    const te = weapon.tracerEvery | 0;
    const firstOfBurst = (w.recoilIndex || 0) === 0;
    // §2.8 first-shot signature: one full tracer even on non-tracer rounds
    const tracer = firstOfBurst || (te > 0 && shotIdx % te === 0);
    const proj = {
      who: shooter, weaponId, weapon,
      pos: origin.slice(), origin: origin.slice(),
      dir, launchDir: dir.slice(),
      speed: weapon.muzzleVel || 999,
      traveled: 0, dmgMult: 1, penUsed: false, whizzed: false,
      dead: false, tracer, pellet: p, fireTickHit: null,
      firstShot: firstOfBurst,
    };
    if (shooter === "P") sim.state.counters.shotsFired++;
    // advance one tick of flight NOW (999 ⇒ CQB resolves inline = "hitscan")
    advance(sim, proj, proj.speed * (1 / 60), true);
    shotEvent(sim, proj, proj.fireTickHit, false, proj.firstShot ? { firstShot: true } : null);
    if (p === 0) firstHit = proj.fireTickHit;
    if (!proj.dead) sim.internal.projectiles.push(proj);
  }
  return firstHit;
}

// player/bot spread-state builders (private exports — player.js + probes use)
export function playerSpreadState(sim) {
  const p = sim.state.player;
  const m = p._m || {};
  const t = sim.state.time;
  const speed = Math.hypot(p.vel[0], p.vel[2]);
  return {
    ads: !!p.weapon.ads,
    adsProgress: p.weapon.adsT || 0,
    speed,
    airborne: !p.grounded,
    sliding: !!m.sliding,
    crouched: p.stance === "crouch" && !m.sliding,
    steady: (t - (m.lastMovedT ?? -999) >= 0.4) && (t - (m.lastShotT ?? -999) >= 0.45),
    landedRecently: t < (m.landPenaltyUntil ?? -999),
  };
}

export function botSpreadState(sim, bot) {
  const speed = bot.vel ? Math.hypot(bot.vel[0], bot.vel[2]) : 0;
  return {
    ads: !!(bot.cmd && bot.cmd.ads),
    adsProgress: bot.weapon.adsT || 0,
    speed,
    airborne: false,
    sliding: false,
    crouched: bot.stance === "crouch",
    steady: speed < 0.1 && sim.state.time - (bot.weapon.lastShotT ?? -999) >= 0.45,
    landedRecently: false,
  };
}

// Ticked once per sim step (tick-order slot 5).
export function stepProjectiles(sim, dt) {
  const list = sim.internal.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const proj = list[i];
    if (!proj.dead) advance(sim, proj, proj.speed * dt, false);
    if (proj.dead) list.splice(i, 1);
  }
}
