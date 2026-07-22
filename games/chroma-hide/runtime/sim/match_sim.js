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
import { PHASE, ROLE, MODE, MODE_INFO, applyShot, losPoints, checkWin, assignRoles, computeSeekerCount, POSE_IDS, POSE_HEIGHT, BODY_SIZES } from "./match_core.js";
import { makeRng, clamp } from "./util.js";
import { buildNavGrid, findPath } from "./nav.js";

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

/** Visible height of a hider: a posed/crouched body hides behind low cover, a standing
 *  one does not. Drives which obstacles can actually occlude it. */
export { POSE_IDS, POSE_HEIGHT };

export function hiderHeight(h) {
  if (!h) return 1.55;
  const size = h.bodySize || 1.4;   // 1.4 is the standard build, not 1
  const p = POSE_HEIGHT[h.pose];
  // Climbing onto a crate or a desk raises your whole silhouette: cover that used to
  // hide you no longer does. That trade -- better vantage for worse concealment -- is
  // what makes mounting props a real decision rather than a free upgrade.
  return (p != null ? p : 1.55) * (size / 1.4) + (h._elev || 0);   // 1.4 is the standard build
}

/** Is `to` visible from `from`? An obstacle only occludes when it is at least as TALL
 *  as `minH` — otherwise you see straight over it. (Before this, a 0.3m pallet blocked
 *  sight exactly like a 3m shelf, so ~80% of props falsely occluded.) Obstacles with no
 *  height recorded are treated as full-height for safety. */
function hasLOS(fx, fz, tx, tz, obstacles, minH = 0) {
  for (const o of obstacles) {
    if (minH > 0 && o.h != null && o.h < minH) continue;
    if (segHitsBox(fx, fz, tx, tz, o)) return false;
  }
  return true;
}

/** Colour of the nearest cover to (x,z), optionally jittered by +/-`jit` per channel.
 *  Used to give bot hiders an imperfect paint job. */
/** Distance (squared) from a point to an obstacle's RECTANGLE, not its centre. A 12m
 *  wall you are pressed against has its centre 6m away, so centre-distance picked a
 *  small crate across the room as "the thing you are blending with". */
function surfDist2(x, z, o) {
  const dx = Math.max(0, Math.abs(x - o.x) - o.hw);
  const dz = Math.max(0, Math.abs(z - o.z) - o.hd);
  return dx * dx + dz * dz;
}

/** The surface a hider is actually against. */
function nearestSurface(s, x, z) {
  let best = null, bd = Infinity;
  for (const o of s.obstacles) {
    if (o.color == null) continue;
    const d = surfDist2(x, z, o);
    if (d < bd) { bd = d; best = o; }
  }
  return { best, bd };
}

export function coverRGB(s, x, z, jit = 0, rng = null) {
  const { best } = nearestSurface(s, x, z);
  if (!best) return null;
  const j = () => (jit && rng ? (rng() - 0.5) * 2 * jit : 0);
  return {
    r: clamp(Math.round(((best.color >> 16) & 255) + j()), 0, 255),
    g: clamp(Math.round(((best.color >> 8) & 255) + j()), 0, 255),
    b: clamp(Math.round((best.color & 255) + j()), 0, 255),
  };
}

/** How well a hider is camouflaged, 0..1. Colour match against the nearest cover plus
 *  stillness — MOVEMENT breaks camouflage, which is the genre's core counterplay.
 *  An unpainted (white) body scores 0. */
export function blendScore(s, h) {
  if (!h.paintRGB) return 0;
  const { best, bd } = nearestSurface(s, h.x, h.z);
  // within ~1.25m of the surface: you have to actually BE against it
  if (!best || bd > 1.6) return 0;
  const c = best.color;
  const dr = ((c >> 16) & 255) - h.paintRGB.r, dg = ((c >> 8) & 255) - h.paintRGB.g, db = (c & 255) - h.paintRGB.b;
  // steep falloff: colour PRECISION is the skill. ~90 units of RGB error (a visibly
  // wrong shade) already drops you to zero camouflage.
  let blend = clamp(1 - Math.sqrt(dr * dr + dg * dg + db * db) / 90, 0, 1);
  // Material match. The how-to-play tells players that matching a surface's finish
  // matters, and it did nothing at all: a mirror-metal body against matt concrete scored
  // exactly like a matt one. Colour still dominates; finish moves the last 20%.
  if (h.paintRough != null && best.rough != null) {
    const dRough = Math.abs(best.rough - h.paintRough);
    const dMetal = Math.abs((best.metal || 0) - (h.paintMetal || 0));
    const material = clamp(1 - (dRough * 0.7 + dMetal * 1.0), 0, 1);
    blend *= 0.80 + 0.20 * material;
  }
  if (h._moving) blend *= 0.25;                        // walking gives you away
  else if (h.hidden) blend = Math.min(1, blend * 1.06); // posed and still
  return blend;
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

  const nav = buildNavGrid(map.bounds, map.obstacles);
  const spots = (map.spots || []).slice();
  const actors = players.map((p, pi) => {
    const role = p.role || roleInfo.roles[p.id];
    const isSeeker = role === ROLE.SEEKER;
    const base = isSeeker ? map.spawn.seeker : map.spawn.hider;
    return {
      id: p.id, role, isBot: !!p.isBot, isLocal: !!p.isLocal,
      // bodySize drives silhouette height, so bots get a spread of builds too --
      // a lobby of identical mannequins reads as placeholder
      bodySize: p.bodySize || BODY_SIZES[pi % BODY_SIZES.length] || 1.4,
      alive: true, caught: false,
      x: base.x + (rng() - 0.5) * 2, z: base.z + (rng() - 0.5) * 2, yaw: rng() * Math.PI * 2,
      ammo: settings.startAmmo, score: 0,
      // hider state
      spot: null, hidden: false, tauntTimer: settings.tauntIntervalSeconds || 0, pose: "stand",
      paintRGB: null,          // {r,g,b} of the painted body — drives blendScore()
      _moving: false,          // movement breaks camouflage
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
    nav,   // walkability grid for bot pathing through doorways (built above)
    actors, mode: settings.mode, events: [], result: null, elapsed: 0, reverseMark: null,
    // How many hiders the match STARTED with. Infection converts caught hiders into
    // seekers, so the live hider list legitimately empties -- checkWin needs this to
    // tell "everyone has been caught" from "roles are not assigned yet".
    hidersAtStart: actors.filter((a) => a.role === ROLE.HIDER).length,
  };
}

/** Queue a whistle from a human player. Emitted on the next tick so every consumer --
 *  bot lure logic, audio, netcode -- sees it exactly as it sees a bot's. */
export function requestWhistle(s, id) {
  const a = s.actors.find((x) => x.id === id);
  if (!a || a.role !== ROLE.HIDER || !a.alive) return false;
  (s._pendingWhistles || (s._pendingWhistles = [])).push({ t: "whistle", id: a.id, x: a.x, z: a.z });
  return true;
}

export function seekers(s) { return s.actors.filter((a) => a.role === ROLE.SEEKER); }
// hiders() feeds win checks and per-hider stepping, so it must never see a decoy --
// otherwise a dropped clone counts as a survivor and the seekers can never win.
// aliveHiders() is what a SEEKER can perceive, and fooling it is the entire point.
export function hiders(s) { return s.actors.filter((a) => a.role === ROLE.HIDER && !a.isDecoy); }
function aliveHiders(s) { return s.actors.filter((a) => a.role === ROLE.HIDER && a.alive); }

/** Drop a decoy: a frozen, identically-painted copy of you.
 *
 *  The store copy promised "drop decoy clones" and the settings reserved maxClones and
 *  cloneCooldownSeconds, but nothing implemented it. A decoy is a full actor so it
 *  inherits detection, LOS, camouflage scoring and shooting for free -- a seeker cannot
 *  tell it from you without spending a shot, which is exactly the bluff the mechanic is
 *  for. It never moves, never scores, and never counts toward the win.
 */
export function dropDecoy(s, ownerId) {
  const o = s.actors.find((a) => a.id === ownerId);
  if (!o || o.role !== ROLE.HIDER || !o.alive || o.isDecoy) return null;
  const max = s.settings.maxClones | 0;
  if (max <= 0) return null;
  if ((o._clonesUsed || 0) >= max) return { error: "no_clones_left" };
  if ((o._cloneCd || 0) > 0) return { error: "cooling_down", wait: o._cloneCd };
  o._clonesUsed = (o._clonesUsed || 0) + 1;
  o._cloneCd = s.settings.cloneCooldownSeconds || 30;
  const d = {
    id: `${ownerId}~decoy${o._clonesUsed}`, ownerId, isDecoy: true, isBot: true, isLocal: false,
    role: ROLE.HIDER, alive: true, caught: false,
    x: o.x, z: o.z, yaw: o.yaw, pose: o.pose, ammo: 0, score: 0,
    // it wears your paint, so it scores camouflage exactly as you do
    paintRGB: o.paintRGB ? { ...o.paintRGB } : null,
    paintRough: o.paintRough, paintMetal: o.paintMetal,
    spot: null, hidden: true, tauntTimer: 0, _moving: false, _elev: o._elev || 0,
    bodySize: o.bodySize || 1.4,   // a clone that is a different size is no clone at all
    patrol: null, target: null, dwell: 0, cooldown: 0,
    _in: { mx: 0, mz: 0, yaw: null, shoot: false },
  };
  s.actors.push(d);
  s.events.push({ t: "decoy", id: d.id, by: ownerId, x: d.x, z: d.z });
  return d;
}

/** Set a local (human) actor's intent for this tick. */
export function setLocalInput(s, id, input) {
  const a = s.actors.find((x) => x.id === id);
  if (a) a._in = Object.assign(a._in, input);
}

/** Advance the whole match by dt seconds. Returns the events emitted this tick. */
export function stepMatch(s, dt) {
  s.events = [];
  // A human whistle used to be pushed straight onto s.events from the input handler and
  // was wiped by this very line before a single bot could read it -- the hider's one
  // active verb was a no-op. Queue it instead and emit it INSIDE the tick, so it lures
  // seekers by exactly the same 30m-with-jitter rule a bot whistle does.
  if (s._pendingWhistles && s._pendingWhistles.length) {
    for (const w of s._pendingWhistles) s.events.push(w);
    s._pendingWhistles.length = 0;
  }
  s.elapsed += dt;
  s.timeLeft -= dt;
  for (const a of s.actors) { a._px = a.x; a._pz = a.z; }   // for the movement tell

  if (s.phase === PHASE.PREP) {
    for (const a of hiders(s)) stepHiderPrep(s, a, dt);
    if (s.timeLeft <= 0) { s.phase = PHASE.HUNT; s.timeLeft = s.settings.huntSeconds; if (s.mode === MODE.REVERSE) convertReverse(s); else if (s.mode === MODE.DOUBLE) convertDouble(s); s.events.push({ t: "phase", phase: PHASE.HUNT }); }
  } else if (s.phase === PHASE.HUNT) {
    for (const a of hiders(s)) if (a.alive) stepHiderHunt(s, a, dt);
    // resolve the movement tell BEFORE seekers look: a walking hider is easy to spot
    for (const a of hiders(s)) { const dx = a.x - a._px, dz = a.z - a._pz; a._moving = (dx * dx + dz * dz) > 1e-4; }
    for (const a of hiders(s)) if (a._cloneCd > 0) a._cloneCd = Math.max(0, a._cloneCd - dt);
    for (const a of seekers(s)) stepSeeker(s, a, dt);
    accrueScores(s, dt);
    const w = checkWin({ mode: s.mode, timeLeft: s.timeLeft, hiders: hiders(s).map((h) => ({ id: h.id, alive: h.alive })), seekers: seekers(s).map((k) => ({ ammo: k.ammo })), ammoLimit: s.settings.ammoLimit, hidersAtStart: s.hidersAtStart || 0 });
    if (w) { s.result = w; s.phase = PHASE.ANSWER_CHECK;
      // honour the host's setting -- it was clamped to 5..30 in validateSettings and
      // then thrown away for a hard-coded 4, so the reveal was always too short to read
      s.timeLeft = s.settings.answerSeconds || SIM.answerSeconds; s.events.push({ t: "win", winner: w.winner, reason: w.reason }); }
  } else if (s.phase === PHASE.ANSWER_CHECK) {
    if (s.timeLeft <= 0) { s.phase = PHASE.RESULTS; s.events.push({ t: "phase", phase: PHASE.RESULTS }); }
  }
  return s.events;
}

// ── hider behavior ───────────────────────────────────────────────────────────
function stepHiderPrep(s, a, dt) {
  if (!a.isBot) {
    moveLocal(s, a, dt);
    // Parity with bots: `hidden` gates blendScore's stillness bonus, and the human path
    // returned before it was ever set -- so the bonus was literally unreachable for the
    // player. Standing still in a deliberate pose IS being hidden.
    a.hidden = !a._moving && a.pose !== "stand";
    return;
  }
  if (!a.spot) a.spot = pickSpot(s, a);
  const d = dist2(a.x, a.z, a.spot.x, a.spot.z);
  if (d > 0.5) {
    moveToward(s, a, a.spot.x, a.spot.z, SIM.hiderSpeed, dt);
  } else if (!a.hidden) {
    a.hidden = true; a.pose = pickPose(s, a); a.yaw = a.spot.faceYaw != null ? a.spot.faceYaw : a.yaw;
    // a bot "paints" itself to its cover, imperfectly — jitter keeps bots beatable and
    // means a careful human paint job is genuinely better than theirs
    a.paintRGB = coverRGB(s, a.x, a.z, 34, s.rng);
    s.events.push({ t: "hidden", id: a.id });
  }
}

function stepHiderHunt(s, a, dt) {
  // forced-taunt whistle
  if (s.settings.tauntIntervalSeconds > 0) {
    a.tauntTimer -= dt;
    if (a.tauntTimer <= 0) { a.tauntTimer = s.settings.tauntIntervalSeconds; s.events.push({ t: "whistle", id: a.id, x: a.x, z: a.z }); a._whistled = true; }
  }
  if (!a.isBot) {
    moveLocal(s, a, dt);
    a.hidden = !a._moving && a.pose !== "stand";
    // `fleeing` drives the "a shot at a moving, exposed target is free" ammo rule. It was
    // set only on the bot path, so the rule silently did not exist against a human.
    let exposed = false;
    if (a._moving) {
      for (const k of seekers(s)) {
        if (dist2(a.x, a.z, k.x, k.z) < SIM.fleeRange && hasLOS(k.x, k.z, a.x, a.z, s.obstacles, hiderHeight(a))) { exposed = true; break; }
      }
    }
    a.fleeing = exposed;
    return;
  }
  // flee if a seeker is very close and can see us (this exposes us => free shot)
  let threat = null, tb = SIM.fleeRange;
  for (const k of seekers(s)) {
    const d = dist2(a.x, a.z, k.x, k.z);
    if (d < tb && hasLOS(k.x, k.z, a.x, a.z, s.obstacles, hiderHeight(a))) { tb = d; threat = k; }
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
  // FARTHEST-POINT dispersal: each hider claims the unclaimed spot farthest from
  // already-taken ones, so hiders spread across all rooms (different palettes) —
  // the multi-room point — instead of clustering near spawn.
  const avail = s.spots.filter((sp) => !sp._claimed);
  if (avail.length) {
    const claimed = s.spots.filter((sp) => sp._claimed);
    let best = avail[0], bestScore = -1;
    for (const sp of avail) {
      let nearest = Infinity;
      for (const c of claimed) nearest = Math.min(nearest, dist2(sp.x, sp.z, c.x, c.z));
      const score = (claimed.length ? nearest : s.rng() * 10) + s.rng() * 0.5;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    best._claimed = true; return best;
  }
  // fallback: hug a random obstacle edge
  const o = s.obstacles[(s.rng() * s.obstacles.length) | 0] || { x: 0, z: 0, hw: 1, hd: 1 };
  const side = s.rng() * Math.PI * 2;
  return { x: o.x + Math.sin(side) * (o.hw + 0.6), z: o.z + Math.cos(side) * (o.hd + 0.6) };
}
// Bots draw from the SAME pose set a human has. The old literal included "lie",
// which is in neither the height table nor the render table, so those bots stood
// at full height while believing they were hidden.
function pickPose(s, a) { const P = POSE_IDS.filter((p) => p !== "stand" && p !== "stretch"); return P[(s.rng() * P.length) | 0]; }

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
  if (!a.isBot) {
    moveLocal(s, a, dt);
    if (a._in.shoot) {
      // The human path used to fire unconditionally while bots were gated on ammo and
      // cooldown. That made "run dry and the hiders win" (checkWin's all-seekers-at-0
      // branch) unreachable against a human seeker — the whole risk half of the loop.
      const dry = s.settings.ammoLimit && a.ammo <= 0;
      if (dry) s.events.push({ t: "dryfire", by: a.id });
      else if (a.cooldown <= 0) seekerShoot(s, a);
      a._in.shoot = false;
    }
    return;
  }

  // detection: pick the best-seen hider. CAMOUFLAGE COUNTS — a body painted to match
  // its cover has to be approached much closer and takes far longer to pick out. This
  // is what makes the paint mechanic mean anything against bots (they used to detect
  // on range+FOV+LOS alone, so paint quality was cosmetic).
  let seen = null, sBest = Infinity, seenBlend = 0;
  for (const h of aliveHiders(s)) {
    const d = dist2(a.x, a.z, h.x, h.z);
    const b = blendScore(s, h);
    if (d > s.skill.detectRange * (1 - 0.6 * b)) continue;    // good paint shrinks the cone
    const facing = angDiff(a.yaw, yawTo(a.x, a.z, h.x, h.z));
    if (facing > s.skill.fovHalf) continue;
    if (!hasLOS(a.x, a.z, h.x, h.z, s.obstacles, hiderHeight(h))) continue;
    if (d < sBest) { sBest = d; seen = h; seenBlend = b; }
  }

  if (seen) {
    // Dwell belongs to the TARGET, not the seeker. Accumulating it on the seeker meant
    // you could stare at an easy, badly-painted hider to build up the timer, then swing
    // onto a well-camouflaged one and shoot instantly -- tab-targeting straight past the
    // 4x dwell stretch that good paint is supposed to buy.
    if (!a.target || a.target.id !== seen.id) a.dwell = 0;
    a.dwell += dt;
    a.target = seen;
    a.yaw = yawTo(a.x, a.z, seen.x, seen.z);
    // approach until in comfortable shoot range
    if (sBest > 8) moveToward(s, a, seen.x, seen.z, s.skill.seekerSpeed, dt);
    // identified + ready => shoot. Blending stretches the identify dwell up to 4x, so a
    // well-painted hider often survives a seeker walking past.
    const needDwell = s.skill.identifyTime * (1 + 3 * seenBlend);
    if (a.dwell >= needDwell && a.cooldown <= 0 && a.ammo > 0 && sBest <= SIM.shootRange) {
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
    if (a._whistleTarget) {
      moveToward(s, a, a._whistleTarget.x, a._whistleTarget.z, s.skill.seekerSpeed, dt);
      a._whistleAge = (a._whistleAge || 0) + dt;
      // give up on a lure we cannot reach, for the same reason patrol times out
      if (dist2(a.x, a.z, a._whistleTarget.x, a._whistleTarget.z) < 1.5 || a._whistleAge > 10) {
        a._whistleTarget = null; a._whistleAge = 0;
      }
    }
    else {
      // Arrival OR a timeout picks the next waypoint. Without the timeout an
      // unreachable target wedges the bot permanently, because "am I there yet" is the
      // only thing that ever cleared it.
      a._patrolAge = (a._patrolAge || 0) + dt;
      const arrived = a.patrol && dist2(a.x, a.z, a.patrol.x, a.patrol.z) < 1.5;
      const stuck = a._patrolAge > 12;
      if (!a.patrol || arrived || stuck) { a.patrol = patrolPoint(s); a._patrolAge = 0; }
      moveToward(s, a, a.patrol.x, a.patrol.z, s.skill.seekerSpeed, dt);
    }
  }
  // react to whistles emitted this tick
  for (const e of s.events) if (e.t === "whistle") { const d = dist2(a.x, a.z, e.x, e.z); if (d < 30) a._whistleTarget = { x: e.x + (s.rng() - 0.5) * 4, z: e.z + (s.rng() - 0.5) * 4 }; }
}

function seekerShoot(s, a) {
  a.cooldown = (s.settings.shotCooldownMs || 1500) / 1000;
  // The sim is 2D, so a shot used to connect no matter where the crosshair pointed
  // vertically -- you could stare at the ceiling and still tag someone. Bots aim level by
  // construction; a human's pitch is real input, so require it to be roughly level.
  const pitch = a._in && a._in.pitch;
  if (!a.isBot && pitch != null && Math.abs(pitch) > 0.45) {
    a.ammo = applyShot(a.ammo, { hit: false, fleeing: false, ammoLimit: s.settings.ammoLimit, startAmmo: s.settings.startAmmo });
    s.events.push({ t: "miss", by: a.id });
    return;
  }
  // find the hider under the crosshair (closest in a tight cone with LOS)
  let hit = null, best = SIM.shootRange, fleeing = false;
  for (const h of aliveHiders(s)) {
    const d = dist2(a.x, a.z, h.x, h.z);
    if (d > SIM.shootRange) continue;
    if (angDiff(a.yaw, yawTo(a.x, a.z, h.x, h.z)) > 0.14) continue; // tight aim
    if (!hasLOS(a.x, a.z, h.x, h.z, s.obstacles, hiderHeight(h))) continue;
    if (d < best) { best = d; hit = h; fleeing = !!h.fleeing; }
  }
  // A decoy eats the shot. It is destroyed and the seeker pays full price -- scored as a
  // MISS, because being fooled has to cost something or the bluff is free.
  if (hit && hit.isDecoy) {
    const i = s.actors.indexOf(hit);
    if (i >= 0) s.actors.splice(i, 1);
    a.ammo = applyShot(a.ammo, { hit: false, fleeing: false, ammoLimit: s.settings.ammoLimit, startAmmo: s.settings.startAmmo });
    a.dwell = 0; a.target = null;
    s.events.push({ t: "decoy_hit", by: a.id, id: hit.id, owner: hit.ownerId, x: hit.x, z: hit.z });
    return;
  }
  const didHit = !!hit;
  a.ammo = applyShot(a.ammo, { hit: didHit, fleeing, ammoLimit: s.settings.ammoLimit, startAmmo: s.settings.startAmmo });
  if (didHit) {
    hit.alive = false; hit.caught = true; a.dwell = 0; a.target = null;
    // Every catch scores. Only the Reverse mark used to, so Double -- whose stated win
    // condition is "Most finds wins" -- counted nothing and every seeker finished on 0.
    a.score += 1;
    a.finds = (a.finds || 0) + 1;
    if (s.mode === MODE.REVERSE && hit.id === s.reverseMark) a.score += s.settings.reverseFindReward;
    s.events.push({ t: "caught", id: hit.id, by: a.id });
    if (MODE_INFO[s.mode] && MODE_INFO[s.mode].convertOnCatch) { hit.role = ROLE.SEEKER; hit.alive = true; hit.caught = false; hit.ammo = s.settings.startAmmo; s.events.push({ t: "convert", id: hit.id }); }
  } else {
    s.events.push({ t: "miss", by: a.id });
  }
}

/** A patrol waypoint the bot can actually walk to.
 *
 *  Waypoints used to be any random point in bounds. On a dense campus map most random
 *  points land inside a wall, a shelf or a sealed pocket, and the arrival test
 *  (`within 1.5m`) then never fires -- the seeker walks into the obstacle for the rest
 *  of the match. That is the stalemate: hunts ran to the timer with hiders in plain
 *  sight. Prefer a known hiding spot (where hiders actually are), else a walkable nav
 *  cell, and fall back to open bounds only if the grid is missing.
 */
function patrolPoint(s) {
  if (s.spots && s.spots.length && s.rng() < 0.55) {
    const sp = s.spots[(s.rng() * s.spots.length) | 0];
    if (sp) return { x: sp.x, z: sp.z };
  }
  const nav = s.nav;
  if (nav && nav.grid) {
    for (let tries = 0; tries < 40; tries++) {
      const i = (s.rng() * nav.w) | 0, j = (s.rng() * nav.h) | 0;
      if (nav.grid[j * nav.w + i] === 1) {
        return { x: nav.minX + (i + 0.5) * nav.cell, z: nav.minZ + (j + 0.5) * nav.cell };
      }
    }
  }
  return { x: s.bounds.minX + s.rng() * (s.bounds.maxX - s.bounds.minX),
           z: s.bounds.minZ + s.rng() * (s.bounds.maxZ - s.bounds.minZ) };
}

function moveToward(s, a, tx, tz, speed, dt) {
  const d = dist2(a.x, a.z, tx, tz); if (d < 0.12) return;
  // path around interior walls / doorways; recompute when the goal moves or the path goes stale
  a._pathAge = (a._pathAge || 0) + dt;
  if (!a._path || dist2(a._pgx || 0, a._pgz || 0, tx, tz) > 1.5 || a._pathAge > 1.2) {
    a._path = s.nav ? findPath(s.nav, a.x, a.z, tx, tz) : null;
    a._pgx = tx; a._pgz = tz; a._pathAge = 0; a._pi = 0;
  }
  let wx = tx, wz = tz;
  if (a._path && a._path.length) {
    while (a._pi < a._path.length - 1 && dist2(a.x, a.z, a._path[a._pi].x, a._path[a._pi].z) < 0.8) a._pi++;
    wx = a._path[a._pi].x; wz = a._path[a._pi].z;
  }
  a.yaw = yawTo(a.x, a.z, wx, wz);
  const step = Math.min(speed * dt, Math.max(dist2(a.x, a.z, wx, wz), 0.001));
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
      if (!hasLOS(k.x, k.z, h.x, h.z, s.obstacles, hiderHeight(h))) continue;
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
