/**
 * CHROMA HIDE — runtime/sim/match_sim.js
 * PURE match simulation (no three, no DOM). Advances a match through its phases
 * on a 2D top-down model (x,z): bot hiders pick spots & hide, bot seekers patrol,
 * detect via a view cone + line-of-sight occlusion, and shoot under the ammo
 * economy; LOS scoring accrues; catches resolve; win is checked. game.js maps its
 * 3D actors onto this state each frame and reads results; the selftest drives a
 * full all-bot match headlessly to both a Hider-win and a Seeker-win (the M2 gate).
 *
 * Local (human) actors set their own x/z/yaw/shoot each tick via setLocalInput();
 * everything else is bot-driven here so single-player and headless share one brain.
 */
import { PHASE, ROLE, MODE, MODE_INFO, applyShot, losPoints, checkWin, assignRoles, computeSeekerCount } from "./match_core.js";
import { makeRng, clamp } from "./util.js";

// ── 2D geometry helpers ─────────────────────────────────────────────────────
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.hypot(dx, dz); }
function yawTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); } // forward = (sin,cos)
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); }

/** Segment (x0,z0)->(x1,z1) intersects an AABB {x,z,hw,hd}? (slab method) */
function segHitsBox(x0, z0, x1, z1, box) {
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  const lo = [box.x - box.hw, box.z - box.hd], hi = [box.x + box.hw, box.z + box.hd];
  const p = [x0, z0], d = [dx, dz];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) return false; }
    else {
      let t1 = (lo[i] - p[i]) / d[i], t2 = (hi[i] - p[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/** Is `to` visible from `from` (no obstacle blocks the segment)? */
function hasLOS(fx, fz, tx, tz, obstacles) {
  for (const o of obstacles) if (segHitsBox(fx, fz, tx, tz, o)) return false;
  return true;
}

/** Push a point out of any obstacle it's inside + clamp to bounds. */
function resolveCollision(x, z, r, bounds, obstacles) {
  x = clamp(x, bounds.minX + r, bounds.maxX - r);
  z = clamp(z, bounds.minZ + r, bounds.maxZ - r);
  for (const o of obstacles) {
    const nx = clamp(x, o.x - o.hw, o.x + o.hw), nz = clamp(z, o.z - o.hd, o.z + o.hd);
    const dx = x - nx, dz = z - nz, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d > 1e-4) { x = nx + (dx / d) * r; z = nz + (dz / d) * r; }
      else { x = o.x + (o.hw + r) * Math.sign(x - o.x || 1); } // dead-centre: shove out on x
    }
  }
  return { x, z };
}

// ── tunables (all [D] design defaults; skill fields let tests force outcomes) ─
export const SIM = Object.freeze({
  hiderSpeed: 3.2, seekerSpeed: 3.3, actorRadius: 0.5,
  fovHalf: 0.92,          // ~105° cone
  detectRange: 22,
  identifyTime: 1.1,      // continuous-LOS dwell before a bot locks & shoots
  shootRange: 32,
  fleeRange: 4.5,         // a hider bot flees a seeker this close (=> free shot for seeker)
  answerSeconds: 4,
});

/**
 * Create a match. config = {
 *   players:[{id,isBot,isLocal,role?}], settings, map:{bounds,obstacles,spawn,spots},
 *   seed, seekerCount?, skill?:{identifyTime,detectRange,fovHalf}  // skill overrides for bots
 * }
 */
export function createMatch(config) {
  const rng = makeRng(config.seed || 1);
  const settings = config.settings;
  const map = config.map;
  const players = config.players;
  const seekerCount = config.seekerCount != null ? config.seekerCount : computeSeekerCount(players.length);
  const roleInfo = assignRoles(players.map((p) => p.id), seekerCount, config.lastSeekers || [], rng);

  const spots = (map.spots || []).slice();
  const actors = players.map((p) => {
    const role = p.role || roleInfo.roles[p.id];
    const isSeeker = role === ROLE.SEEKER;
    const base = isSeeker ? map.spawn.seeker : map.spawn.hider;
    return {
      id: p.id, role, isBot: !!p.isBot, isLocal: !!p.isLocal,
      alive: true, caught: false,
      x: base.x + (rng() - 0.5) * 2, z: base.z + (rng() - 0.5) * 2, yaw: rng() * Math.PI * 2,
      ammo: settings.startAmmo, score: 0,
      // hider state
      spot: null, hidden: false, tauntTimer: settings.tauntIntervalSeconds || 0, pose: "stand",
      // seeker state
      patrol: null, target: null, dwell: 0, cooldown: 0,
      _in: { mx: 0, mz: 0, yaw: null, shoot: false }, // local input
    };
  });

  // Reverse & Double: everyone paints & hides in prep; roles are (re)assigned at
  // hunt start (Reverse reveals one "mark"; Double activates ~half as seekers).
  if (settings.mode === MODE.REVERSE || settings.mode === MODE.DOUBLE) for (const a of actors) a.role = ROLE.HIDER;

  const skill = Object.assign({ identifyTime: SIM.identifyTime, detectRange: SIM.detectRange, fovHalf: SIM.fovHalf, seekerSpeed: SIM.seekerSpeed }, config.skill || {});

  return {
    phase: PHASE.PREP, timeLeft: settings.prepSeconds, settings, map, rng, skill,
    bounds: map.bounds, obstacles: map.obstacles, spots,
    actors, mode: settings.mode, events: [], result: null, elapsed: 0, reverseMark: null,
  };
}

export function seekers(s) { return s.actors.filter((a) => a.role === ROLE.SEEKER); }
export function hiders(s) { return s.actors.filter((a) => a.role === ROLE.HIDER); }
function aliveHiders(s) { return s.actors.filter((a) => a.role === ROLE.HIDER && a.alive); }

/** Set a local (human) actor's intent for this tick. */
export function setLocalInput(s, id, input) {
  const a = s.actors.find((x) => x.id === id);
  if (a) a._in = Object.assign(a._in, input);
}

/** Advance the whole match by dt seconds. Returns the events emitted this tick. */
export function stepMatch(s, dt) {
  s.events = [];
  s.elapsed += dt;
  s.timeLeft -= dt;

  if (s.phase === PHASE.PREP) {
    for (const a of hiders(s)) stepHiderPrep(s, a, dt);
    if (s.timeLeft <= 0) { s.phase = PHASE.HUNT; s.timeLeft = s.settings.huntSeconds; if (s.mode === MODE.REVERSE) convertReverse(s); else if (s.mode === MODE.DOUBLE) convertDouble(s); s.events.push({ t: "phase", phase: PHASE.HUNT }); }
  } else if (s.phase === PHASE.HUNT) {
    for (const a of hiders(s)) if (a.alive) stepHiderHunt(s, a, dt);
    for (const a of seekers(s)) stepSeeker(s, a, dt);
    accrueScores(s, dt);
    const w = checkWin({ mode: s.mode, timeLeft: s.timeLeft, hiders: hiders(s).map((h) => ({ id: h.id, alive: h.alive })), seekers: seekers(s).map((k) => ({ ammo: k.ammo })), ammoLimit: s.settings.ammoLimit });
    if (w) { s.result = w; s.phase = PHASE.ANSWER_CHECK; s.timeLeft = SIM.answerSeconds; s.events.push({ t: "win", winner: w.winner, reason: w.reason }); }
  } else if (s.phase === PHASE.ANSWER_CHECK) {
    if (s.timeLeft <= 0) { s.phase = PHASE.RESULTS; s.events.push({ t: "phase", phase: PHASE.RESULTS }); }
  }
  return s.events;
}

// ── hider behavior ───────────────────────────────────────────────────────────
function stepHiderPrep(s, a, dt) {
  if (!a.isBot) { moveLocal(s, a, dt); return; }
  if (!a.spot) a.spot = pickSpot(s, a);
  const d = dist2(a.x, a.z, a.spot.x, a.spot.z);
  if (d > 0.4) {
    const step = SIM.hiderSpeed * dt;
    a.yaw = yawTo(a.x, a.z, a.spot.x, a.spot.z);
    const nx = a.x + Math.sin(a.yaw) * step, nz = a.z + Math.cos(a.yaw) * step;
    const c = resolveCollision(nx, nz, SIM.actorRadius, s.bounds, s.obstacles); a.x = c.x; a.z = c.z;
  } else if (!a.hidden) {
    a.hidden = true; a.pose = pickPose(s, a); a.yaw = a.spot.faceYaw != null ? a.spot.faceYaw : a.yaw;
    s.events.push({ t: "hidden", id: a.id });
  }
}

function stepHiderHunt(s, a, dt) {
  // forced-taunt whistle
  if (s.settings.tauntIntervalSeconds > 0) {
    a.tauntTimer -= dt;
    if (a.tauntTimer <= 0) { a.tauntTimer = s.settings.tauntIntervalSeconds; s.events.push({ t: "whistle", id: a.id, x: a.x, z: a.z }); a._whistled = true; }
  }
  if (!a.isBot) { moveLocal(s, a, dt); return; }
  // flee if a seeker is very close and can see us (this exposes us => free shot)
  let threat = null, tb = SIM.fleeRange;
  for (const k of seekers(s)) {
    const d = dist2(a.x, a.z, k.x, k.z);
    if (d < tb && hasLOS(k.x, k.z, a.x, a.z, s.obstacles)) { tb = d; threat = k; }
  }
  if (threat) {
    a.fleeing = true;
    const away = yawTo(threat.x, threat.z, a.x, a.z);
    const step = SIM.hiderSpeed * dt;
    const nx = a.x + Math.sin(away) * step, nz = a.z + Math.cos(away) * step;
    const c = resolveCollision(nx, nz, SIM.actorRadius, s.bounds, s.obstacles); a.x = c.x; a.z = c.z;
  } else { a.fleeing = false; }
}

function pickSpot(s, a) {
  if (s.spots.length) {
    // claim the nearest unclaimed authored spot
    let best = null, bd = Infinity;
    for (const sp of s.spots) { if (sp._claimed) continue; const d = dist2(a.x, a.z, sp.x, sp.z); if (d < bd) { bd = d; best = sp; } }
    if (best) { best._claimed = true; return best; }
  }
  // fallback: hug a random obstacle edge
  const o = s.obstacles[(s.rng() * s.obstacles.length) | 0] || { x: 0, z: 0, hw: 1, hd: 1 };
  const side = s.rng() * Math.PI * 2;
  return { x: o.x + Math.sin(side) * (o.hw + 0.6), z: o.z + Math.cos(side) * (o.hd + 0.6) };
}
function pickPose(s, a) { return ["stand", "crouch", "ball", "lie"][(s.rng() * 4) | 0]; }

/** Reverse Chicken Race: reveal one hider as the mark; everyone else hunts it. */
function convertReverse(s) {
  const alive = hiders(s).filter((h) => h.alive);
  if (!alive.length) return;
  const mark = alive[(s.rng() * alive.length) | 0];
  s.reverseMark = mark.id; mark._revealed = true;
  for (const a of s.actors) if (a.id !== mark.id) { a.role = ROLE.SEEKER; a.ammo = s.settings.startAmmo; a.dwell = 0; a.cooldown = 0; }
  s.events.push({ t: "reveal", id: mark.id, x: mark.x, z: mark.z });
}

/** Double: everyone hid & painted in prep; ~half are now activated as seekers,
 *  the rest stay hidden. Roles are decided at hunt start, so you prepare a
 *  disguise not knowing whether you'll hunt or hide. Resolves as a team verdict. */
function convertDouble(s) {
  const all = s.actors.slice();
  for (let i = all.length - 1; i > 0; i--) { const j = (s.rng() * (i + 1)) | 0; const t = all[i]; all[i] = all[j]; all[j] = t; }
  const nSeekers = Math.max(1, Math.floor(all.length / 2));
  all.forEach((a, i) => {
    if (i < nSeekers) { a.role = ROLE.SEEKER; a.ammo = s.settings.startAmmo; a.dwell = 0; a.cooldown = 0; }
    else { a.role = ROLE.HIDER; }
  });
  s.events.push({ t: "double_start", seekers: nSeekers });
}

// ── seeker behavior ──────────────────────────────────────────────────────────
function stepSeeker(s, a, dt) {
  if (a.cooldown > 0) a.cooldown -= dt;
  if (!a.isBot) { moveLocal(s, a, dt); if (a._in.shoot) { seekerShoot(s, a); a._in.shoot = false; } return; }

  // detection: pick the best-seen hider
  let seen = null, sBest = Infinity;
  for (const h of aliveHiders(s)) {
    const d = dist2(a.x, a.z, h.x, h.z);
    if (d > s.skill.detectRange) continue;
    const facing = angDiff(a.yaw, yawTo(a.x, a.z, h.x, h.z));
    if (facing > s.skill.fovHalf) continue;
    if (!hasLOS(a.x, a.z, h.x, h.z, s.obstacles)) continue;
    if (d < sBest) { sBest = d; seen = h; }
  }

  if (seen) {
    a.dwell += dt;
    a.target = seen;
    a.yaw = yawTo(a.x, a.z, seen.x, seen.z);
    // approach until in comfortable shoot range
    if (sBest > 8) moveToward(s, a, seen.x, seen.z, s.skill.seekerSpeed, dt);
    // identified + ready => shoot
    if (a.dwell >= s.skill.identifyTime && a.cooldown <= 0 && a.ammo > 0 && sBest <= SIM.shootRange) {
      seekerShoot(s, a);
    }
  } else {
    a.dwell = Math.max(0, a.dwell - dt * 0.5);
    a.target = null;
    // Reverse Chicken Race: the mark is revealed, so bots beeline toward it.
    if (s.mode === MODE.REVERSE && s.reverseMark) {
      const mark = s.actors.find((x) => x.id === s.reverseMark && x.alive);
      if (mark) { moveToward(s, a, mark.x, mark.z, s.skill.seekerSpeed, dt); return; }
    }
    // patrol toward last whistle, else a roaming waypoint
    if (a._whistleTarget) { moveToward(s, a, a._whistleTarget.x, a._whistleTarget.z, s.skill.seekerSpeed, dt); if (dist2(a.x, a.z, a._whistleTarget.x, a._whistleTarget.z) < 1.5) a._whistleTarget = null; }
    else {
      if (!a.patrol || dist2(a.x, a.z, a.patrol.x, a.patrol.z) < 1.5) a.patrol = { x: s.bounds.minX + s.rng() * (s.bounds.maxX - s.bounds.minX), z: s.bounds.minZ + s.rng() * (s.bounds.maxZ - s.bounds.minZ) };
      moveToward(s, a, a.patrol.x, a.patrol.z, s.skill.seekerSpeed, dt);
    }
  }
  // react to whistles emitted this tick
  for (const e of s.events) if (e.t === "whistle") { const d = dist2(a.x, a.z, e.x, e.z); if (d < 30) a._whistleTarget = { x: e.x + (s.rng() - 0.5) * 4, z: e.z + (s.rng() - 0.5) * 4 }; }
}

function seekerShoot(s, a) {
  a.cooldown = (s.settings.shotCooldownMs || 1500) / 1000;
  // find the hider under the crosshair (closest in a tight cone with LOS)
  let hit = null, best = SIM.shootRange, fleeing = false;
  for (const h of aliveHiders(s)) {
    const d = dist2(a.x, a.z, h.x, h.z);
    if (d > SIM.shootRange) continue;
    if (angDiff(a.yaw, yawTo(a.x, a.z, h.x, h.z)) > 0.14) continue; // tight aim
    if (!hasLOS(a.x, a.z, h.x, h.z, s.obstacles)) continue;
    if (d < best) { best = d; hit = h; fleeing = !!h.fleeing; }
  }
  const didHit = !!hit;
  a.ammo = applyShot(a.ammo, { hit: didHit, fleeing, ammoLimit: s.settings.ammoLimit, startAmmo: s.settings.startAmmo });
  if (didHit) {
    hit.alive = false; hit.caught = true; a.dwell = 0; a.target = null;
    if (s.mode === MODE.REVERSE && hit.id === s.reverseMark) a.score += s.settings.reverseFindReward;
    s.events.push({ t: "caught", id: hit.id, by: a.id });
    if (MODE_INFO[s.mode] && MODE_INFO[s.mode].convertOnCatch) { hit.role = ROLE.SEEKER; hit.alive = true; hit.caught = false; hit.ammo = s.settings.startAmmo; s.events.push({ t: "convert", id: hit.id }); }
  } else {
    s.events.push({ t: "miss", by: a.id });
  }
}

function moveToward(s, a, tx, tz, speed, dt) {
  const d = dist2(a.x, a.z, tx, tz); if (d < 1e-3) return;
  a.yaw = yawTo(a.x, a.z, tx, tz);
  const step = Math.min(speed * dt, d);
  const nx = a.x + Math.sin(a.yaw) * step, nz = a.z + Math.cos(a.yaw) * step;
  const c = resolveCollision(nx, nz, SIM.actorRadius, s.bounds, s.obstacles); a.x = c.x; a.z = c.z;
}

function moveLocal(s, a, dt) {
  const inp = a._in; if (inp.yaw != null) a.yaw = inp.yaw;
  const speed = a.role === ROLE.SEEKER ? SIM.seekerSpeed : SIM.hiderSpeed;
  const mvLen = Math.hypot(inp.mx || 0, inp.mz || 0);
  if (mvLen > 0.01) {
    const nx = a.x + (inp.mx / mvLen) * speed * dt, nz = a.z + (inp.mz / mvLen) * speed * dt;
    const c = resolveCollision(nx, nz, SIM.actorRadius, s.bounds, s.obstacles); a.x = c.x; a.z = c.z;
  }
}

// ── scoring ──────────────────────────────────────────────────────────────────
function accrueScores(s, dt) {
  for (const h of aliveHiders(s)) {
    let bestPts = 0;
    for (const k of seekers(s)) {
      const d = dist2(k.x, k.z, h.x, h.z);
      if (d > s.settings.losMaxDist) continue;
      if (angDiff(k.yaw, yawTo(k.x, k.z, h.x, h.z)) > s.skill.fovHalf) continue;
      if (!hasLOS(k.x, k.z, h.x, h.z, s.obstacles)) continue;
      bestPts = Math.max(bestPts, losPoints(d, dt, s.settings));
    }
    h.score += bestPts;
  }
}

/** Run a whole match headlessly to RESULTS (test + bot-vs-bot fallback). */
export function runToEnd(s, dt = 1 / 30, maxSeconds = 1200) {
  let guard = 0;
  while (s.phase !== PHASE.RESULTS && guard < maxSeconds / dt) { stepMatch(s, dt); guard++; }
  return s.result;
}
