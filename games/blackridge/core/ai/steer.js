// core/ai/steer.js [BOT-AI PASS 2026-10] — path planning glue + path following
// (pure-pursuit with capsule-validated lookahead), team-mate separation, and
// the stuck ladder. THREE-free, deterministic, Node-runnable. botfsm.js owns
// WHEN a bot moves (the FSM); this module owns HOW it gets there.
//
// Why a module (nav_probe.mjs baseline on the pre-pass code, 300 random
// routes/map, walking): 80-96% arrival, 18-35% of drive ticks with the capsule
// against a wall, 1.3k-4.2k "waypoint advanced although the straight line to
// the next one was blocked", ~125-300 stuck intervals >3 s per map. Root
// causes, all in the old followPath():
//   1. heading-driven movement: the bot only moved along the direction it was
//      FACING, and facing turns at 2.4-5.6 rad/s, so every corner was an arc
//      of 0.5-2.7 m radius that swung into the wall it was rounding;
//   2. a speed-scaled accept radius (1.15-1.6 m) that skipped corner
//      waypoints outright (hence the cut-through-geometry count);
//   3. string-pulled legs that grazed corners by 0-5 cm (fixed in nav.js with
//      PULL_PAD) and the square mover footprint snagging on them;
//   4. a stuck watchdog that waited 1.5 s at zero speed before doing anything
//      and then walked to a random point.
//
// New contract: followPath() writes a WORLD-SPACE move direction
// (brain.mvx/mvz, unit) and brain.moveYaw; act() converts it into the
// facing frame at the END of the tick (cmd.moveX/moveZ), so facing is free to
// look where the brain wants while the feet follow the path exactly. The
// direction aims at a "carrot" some metres ahead ALONG the path, shrunk until
// a capsule-clear (nav.lineClear) straight leg to it exists — corners are cut
// as far as the geometry allows and never further.

const REACH = 0.5;            // waypoint accept (m): padded legs, so tight is safe
const LOOK_BASE = 1.0, LOOK_PER_SPEED = 0.38, LOOK_MAX = 3.4;
const STEER_PAD = 0.10;       // carrot leg clearance beyond the capsule (m)
const SEP_R = 1.05;           // team-mate separation radius (m)
const SEP_W = 0.85;
const GOAL_ACCEPT = 0.8;      // unchanged contract: flag stands trigger at 1.2
const HEAT_STAMP = 1.0, HEAT_W = 0.28;
const HEAT_DECAY_EVERY = 150, HEAT_DECAY = 0.6; // ticks, factor
export const STUCK_SPEED = 0.35;

function hd(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

// cumulative arc length, cached on the path array (non-index property: JSON
// snapshots ignore it)
function cumOf(path) {
  let c = path._cum;
  if (c && c.length === path.length) return c;
  c = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) {
    c[i] = c[i - 1] + hd(path[i][0], path[i][2], path[i - 1][0], path[i - 1][2]);
  }
  path._cum = c;
  return c;
}

// point at arc length s along the polyline, searching forward from segment i
function pointAt(path, cum, i, s, out) {
  const n = path.length;
  if (s >= cum[n - 1]) { const q = path[n - 1]; out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; return n - 1; }
  while (i < n - 1 && cum[i] < s) i++;
  const A = path[i - 1], B = path[i];
  const seg = cum[i] - cum[i - 1];
  const u = seg > 1e-6 ? (s - cum[i - 1]) / seg : 1;
  out[0] = A[0] + (B[0] - A[0]) * u;
  out[1] = A[1] + (B[1] - A[1]) * u;
  out[2] = A[2] + (B[2] - A[2]) * u;
  return i;
}

// ------------------------------------------------------------- planning
// Per-sim crowd-heat store lives on sim.squad (one squad per sim): the shared
// nav object must stay stateless because matchprobe / ai.selftest run many
// sims against ONE nav.
function navx(sim, nav) {
  const sq = sim.squad;
  if (!sq || !nav || !nav.makeHeat) return null;
  let x = sq._navx;
  if (!x) x = sq._navx = { heat: new Map(), tick: 0, plans: 0, replans: 0 };
  return x;
}

export function tickHeat(sim, nav) {
  const x = navx(sim, nav);
  if (!x) return;
  x.tick++;
  if (x.tick % HEAT_DECAY_EVERY === 0) for (const h of x.heat.values()) nav.decayHeat(h, HEAT_DECAY);
}

// which known threat position (if any) should this bot hide its approach from?
function threatRef(sim, bot, brain) {
  const st = bot.state;
  if (st !== "combat" && st !== "flank" && st !== "suppress" && st !== "retreat" && st !== "suspicious") return null;
  const P = bot.percept;
  const t = sim.state.time;
  if (P && P.lastKnown && t - P.lastSeenT < 15) return P.lastKnown;
  if (st === "suspicious" && brain.investT && brain.investT.target) return brain.investT.target;
  if (P && P.heardAt && t - P.lastHeardT < 8) return P.heardAt;
  return null;
}

export function planPath(sim, nav, bot, brain, goal, band) {
  if (!nav) return null;
  const t = sim.state.time;
  const x = navx(sim, nav);
  const opts = { bias: bot.id, noise: band && band.laneNoise != null ? band.laneNoise : 0.10 };
  if (x) {
    const team = bot.team != null ? bot.team : 1;
    let heat = x.heat.get(team);
    if (!heat) { heat = nav.makeHeat(); x.heat.set(team, heat); }
    opts.heat = heat; opts.heatW = HEAT_W;
  }
  if (brain.avoid && brain.avoidUntil > t) opts.avoid = brain.avoid;
  const expW = band && band.exposeAvoid ? band.exposeAvoid : 0;
  if (expW > 0 && nav.exposure) {
    const ref = threatRef(sim, bot, brain);
    if (ref) {
      const m = nav.exposure(ref, 42);
      if (m) { opts.expose = m; opts.expW = expW; }
    }
  }
  let path = nav.findPath(bot.pos, goal, opts);
  if (!path) {
    // goal off the mesh / on an island: aim for the nearest walkable spot
    const alt = nav.openSpot ? nav.openSpot(goal, 5, 0) : null;
    if (alt) path = nav.findPath(bot.pos, alt, opts);
  }
  if (x && path && path.ids) {
    x.plans++;
    nav.stampHeat(opts.heat, path.ids, HEAT_STAMP);
  }
  return path;
}

// ------------------------------------------------------------- following
// Returns true while the feet should move. Sets: brain.mvActive, mvx, mvz,
// moveYaw, carrot, pathI, arrived (goal accept), needRepath (no usable path).
export function followPath(sim, nav, bot, brain, dt) {
  brain.mvActive = false;
  const goal = brain.goal;
  if (!goal) { brain.arrived = true; return false; }
  const px = bot.pos[0], pz = bot.pos[2];
  const vx = bot.vel ? bot.vel[0] : 0, vz = bot.vel ? bot.vel[2] : 0;
  const speed = Math.sqrt(vx * vx + vz * vz);
  const dGoal = hd(px, pz, goal[0], goal[2]);

  // goal accept — same contract as the pre-pass code: inside 0.8 m, or a
  // closest-approach inside 1.1 m that is now receding (orbit guard)
  // The accept is floor-aware: a goal on a stair top / deck (nav_probe: a goal
  // on a +1.2 m stair run was "reached" from the ground beside it) only counts
  // when the bot stands within 1 m of the goal's height.
  const sameFloor = Math.abs(bot.pos[1] - goal[1]) < 1.0;
  if (brain.goalKey !== goal) { brain.goalKey = goal; brain.goalMinD = sameFloor ? dGoal : 99; }
  else if (sameFloor && dGoal < brain.goalMinD) brain.goalMinD = dGoal;
  if (sameFloor && (dGoal < GOAL_ACCEPT || (brain.goalMinD < 1.1 && dGoal > brain.goalMinD + 0.5))) {
    brain.arrived = true;
    return false;
  }

  let tx = goal[0], tz = goal[2], ty = goal[1];
  const path = brain.path;
  if (path && path.length >= 2) {
    const cum = cumOf(path);
    let i = brain.pathI | 0;
    if (i < 1) i = 1;
    if (i > path.length - 1) i = path.length - 1;
    // advance along the polyline (never the final waypoint: the goal accept
    // above owns the end of the route). Progress is judged by CLOSEST SEGMENT,
    // not by the old segment's projection: a bot that has rounded a corner is
    // past the waypoint but its projection onto the previous leg is still < 1,
    // so a carrot anchored there lands BEHIND the bot and it turns back
    // (nav_probe: a 3-waypoint-long oscillation at a 120 deg final leg).
    // 2026-11 review: a waypoint is only PASSED when the next one is in
    // capsule-clear line from where the bot actually stands. The old rule
    // (projection past B, or within 0.5 m of it) let a bot that had been
    // pushed off the corner line (separation, a nudge, momentum) drop B and
    // aim at C through the very corner B was there to round — nav_probe
    // skipWP 105-505 per 300 routes, and most snag episodes started there.
    // Checked at most once per waypoint per 0.1 s (lineClear is the cost).
    while (i < path.length - 1) {
      const A = path[i - 1], B = path[i];
      const sx = B[0] - A[0], sz = B[2] - A[2];
      const L2 = sx * sx + sz * sz;
      const u = L2 > 1e-6 ? ((px - A[0]) * sx + (pz - A[2]) * sz) / L2 : 1;
      let adv = u >= 1 || hd(px, pz, B[0], B[2]) < REACH;
      // is the NEXT leg clearly closer than this one? (bot already beyond the corner)
      const C = path[i + 1];
      if (!adv) {
        const tx2 = C[0] - B[0], tz2 = C[2] - B[2];
        const M2 = tx2 * tx2 + tz2 * tz2;
        if (M2 > 1e-6) {
          let u2 = ((px - B[0]) * tx2 + (pz - B[2]) * tz2) / M2;
          u2 = u2 < 0 ? 0 : (u2 > 1 ? 1 : u2);
          const d2 = hd(px, pz, B[0] + tx2 * u2, B[2] + tz2 * u2);
          let u1 = u < 0 ? 0 : u;
          const d1 = hd(px, pz, A[0] + sx * u1, A[2] + sz * u1);
          if (d2 + 0.05 < d1 && u2 > 0.02) adv = true;
        }
      }
      if (!adv) break;
      if (nav && nav.lineClear && hd(px, pz, B[0], B[2]) > 0.12) {
        const tNow = sim.state.time;
        const same = brain._advI === i && brain._advPath === path;
        if (!same) brain._advT0 = tNow;
        // safety valve: never hold one waypoint longer than 0.8 s this way
        if (!(same && tNow - brain._advT0 > 0.8)) {
          if (same && tNow < brain._advT) break;
          if (!nav.lineClear(bot.pos, C, 0)) {
            brain._advI = i; brain._advPath = path; brain._advT = tNow + 0.1;
            break;
          }
        }
      }
      i++;
    }
    brain.pathI = i;
    // 2026-11 review: a path can END SHORT of its goal (the goal sits off the
    // mesh / inside a prop's footprint and is not line-reachable from the
    // last node, so findPath does not append it). Standing on that last node
    // the bot used to orbit it forever, 0.8-1.5 m from a goal it could not
    // reach (expert_probe saltmarket ctf: a stand defender, 'stuck' 5 s+ on
    // every visit). At the end of the route, within 2 m of the goal: arrived.
    if (i === path.length - 1) {
      const E = path[i];
      if (hd(px, pz, E[0], E[2]) < 0.35 && hd(E[0], E[2], goal[0], goal[2]) > 0.4 && dGoal < 2.0) {
        brain.arrived = true;
        return false;
      }
    }
    const A = path[i - 1], B = path[i];
    const sx = B[0] - A[0], sz = B[2] - A[2];
    const L2 = sx * sx + sz * sz;
    let u = L2 > 1e-6 ? ((px - A[0]) * sx + (pz - A[2]) * sz) / L2 : 1;
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    const s0 = cum[i - 1] + u * (cum[i] - cum[i - 1]);
    let look = LOOK_BASE + LOOK_PER_SPEED * speed;
    if (look > LOOK_MAX) look = LOOK_MAX;
    const car = brain._carrot || (brain._carrot = [0, 0, 0]);
    let found = false;
    if (nav && nav.lineClear) {
      for (let k = 0; k < 3 && !found; k++) {
        const Lk = look * (k === 0 ? 1 : k === 1 ? 0.55 : 0.3);
        pointAt(path, cum, i, s0 + Lk, car);
        if (hd(px, pz, car[0], car[2]) < 0.25) { found = true; break; } // trivially close
        if (nav.lineClear(bot.pos, car, STEER_PAD)) found = true;
      }
    } else {
      pointAt(path, cum, i, s0 + look, car); found = true;
    }
    // 2026-11 review: when no padded carrot is clear (a door slit / 1 m lane
    // the 0.10 pad cannot fit), try an unpadded one, and failing that steer
    // BACK ONTO THE PATH LINE (a point 0.35 m ahead of the bot's projection)
    // instead of beelining to the next waypoint. Path legs are capsule-clear
    // (nav_probe badSeg 0); the bot standing 5-10 cm beside one is not, and
    // the beeline kept that offset into the gap: the square footprint hit the
    // corner's end face and stopped dead (lanternwalk n_hoard_w / van slit,
    // 0.72 m wide: 98% of snag ticks were this fallback).
    if (!found && nav && nav.lineClear) {
      pointAt(path, cum, i, s0 + look * 0.55, car);
      if (nav.lineClear(bot.pos, car, 0)) found = true;
      else { pointAt(path, cum, i, s0 + 0.35, car); found = true; brain._carLine = true; }
    }
    brain._carOk = found;
    if (found) { tx = car[0]; tz = car[2]; ty = car[1]; }
    else { tx = B[0]; tz = B[2]; ty = B[1]; }
  } else if (path === null && nav) {
    // no route at all (island / unreachable goal): walk straight only if the
    // leg is capsule-clear; otherwise give up rather than push into geometry
    if (!(nav.lineClear && nav.lineClear(bot.pos, goal, 0))) {
      brain.arrived = true;
      brain.goalUnreach = sim.state.time;
      return false;
    }
  }
  void ty;

  let dx = tx - px, dz = tz - pz;
  let dl = Math.sqrt(dx * dx + dz * dz);
  if (dl < 1e-4) { brain.arrived = dGoal < 1.2; return false; }
  dx /= dl; dz /= dl;

  // ---- nudge (stuck stage 1): a short sidestep blended into the heading
  const t = sim.state.time;
  if (brain.nudgeUntil > t) {
    dx = dx * 0.35 + brain.nudgeX * 0.95;
    dz = dz * 0.35 + brain.nudgeZ * 0.95;
    dl = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= dl; dz /= dl;
  }

  // ---- separation from other bodies (no body collision exists, so without
  // this a squad walks THROUGH itself and stacks inside doorways)
  const bots = sim.state.bots;
  let rx = 0, rz = 0;
  // 2026-11 review: the human body counts too (it was invisible to this
  // loop, so team-mates walked through the player and parked in the doorway
  // the player stood in), and a body AHEAD in the same direction of travel is
  // queued behind instead of squeezed past (2026-11: 0.85 m / 0.67 s, was
  // 0.75 m / 0.4 s; meridian squad overlaps while travelling 41 -> 27): a 1-tick hold while a lower-id
  // body (or the player) is < 0.85 m ahead inside a 40 deg cone and not
  // walking toward us. Lower id never yields to higher, so a queue cannot
  // deadlock; head-on meetings are left to the lateral separation below.
  const pl = sim.state.player;
  const nO = bots.length + (pl && pl.alive && pl.pos ? 1 : 0);
  let yieldTo = false;
  for (let i = 0; i < nO; i++) {
    const o = i < bots.length ? bots[i] : pl;
    if (o === bot || !o.alive) continue;
    const ex = px - o.pos[0], ez = pz - o.pos[2];
    if (ex > SEP_R || ex < -SEP_R || ez > SEP_R || ez < -SEP_R) continue;
    if (Math.abs(bot.pos[1] - o.pos[1]) > 1.2) continue;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d >= SEP_R) continue;
    const w = (SEP_R - d) / SEP_R;
    if (d < 0.05) { // exactly stacked: split by id parity, perpendicular to travel
      const sg = (bot.id & 1) ? 1 : -1;
      rx += -dz * sg * w; rz += dx * sg * w;
    } else {
      rx += (ex / d) * w; rz += (ez / d) * w;
      if (!yieldTo && d < 0.85 && (o === pl || o.id < bot.id)) {
        const ahead = -(ex * dx + ez * dz) / d; // cos of the angle to o vs travel
        if (ahead > 0.77) {
          const ov = o.vel || [0, 0, 0];
          if (ov[0] * dx + ov[2] * dz > -0.5) yieldTo = true; // not coming at us
        }
      }
    }
  }
  if (yieldTo && (brain.yieldN | 0) < 40) { // never more than 0.67 s in a row
    brain.yieldN = (brain.yieldN | 0) + 1;
    brain.mvActive = false;
    brain.yielding = true;
    return false;
  }
  if (!yieldTo) brain.yieldN = 0;
  brain.yielding = false;
  if (rx !== 0 || rz !== 0) {
    // only the lateral part may oppose travel (a corridor head-on must not
    // freeze both bots); anything pushing along/against dir is damped
    const along = rx * dx + rz * dz;
    if (along < 0) { rx -= along * dx * 0.85; rz -= along * dz * 0.85; }
    dx += rx * SEP_W; dz += rz * SEP_W;
    dl = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= dl; dz /= dl;
  }

  brain.mvx = dx; brain.mvz = dz;
  brain.moveYaw = Math.atan2(-dx, -dz);
  brain.mvActive = true;
  void dt;
  return true;
}

// short direct hop (peek / lean / return-to-cover): no path planning, the
// caller has already checked the hop is clear. Returns the distance left.
export function stepTo(bot, brain, tx, tz) {
  const dx = tx - bot.pos[0], dz = tz - bot.pos[2];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.05) return d;
  brain.mvx = dx / d; brain.mvz = dz / d;
  brain.moveYaw = Math.atan2(-brain.mvx, -brain.mvz);
  brain.mvActive = true;
  return d;
}

// 2026-11 review: a STANDING bot that has another body (bot or the human)
// inside 0.6 m on its floor steps out to ~0.9 m. Arrival / hold / cover
// points are chosen per bot, and two of them (or the player's own spot) can
// coincide: nav_probe --squad counted ~1/3 of its body overlaps at the
// goals, i.e. two operators parked inside each other. Lower id stays put
// (one of a pair moves), the step must be capsule-clear, never more than
// once per 0.25 s. Returns true when it wrote a move.
export function spaceOut(sim, nav, bot, brain) {
  const t = sim.state.time;
  if (brain.spaceT != null && t < brain.spaceT) return brain.spaceOn === true && t < brain.spaceUntil && stepTo(bot, brain, brain.spaceTo[0], brain.spaceTo[2]) > 0.08;
  brain.spaceT = t + 0.25;
  brain.spaceOn = false;
  const bots = sim.state.bots, pl = sim.state.player;
  const px = bot.pos[0], pz = bot.pos[2];
  let ax = 0, az = 0, n = 0;
  const nO = bots.length + (pl && pl.alive && pl.pos ? 1 : 0);
  for (let i = 0; i < nO; i++) {
    const o = i < bots.length ? bots[i] : pl;
    if (o === bot || !o.alive) continue;
    if (o !== pl && o.id > bot.id) continue;
    const ex = px - o.pos[0], ez = pz - o.pos[2];
    if (ex > 0.6 || ex < -0.6 || ez > 0.6 || ez < -0.6) continue;
    if (Math.abs(bot.pos[1] - o.pos[1]) > 1.2) continue;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d >= 0.6) continue;
    if (d < 0.02) { const a = (bot.id * 2.399963) % 6.283; ax += Math.cos(a); az += Math.sin(a); }
    else { ax += ex / d; az += ez / d; }
    n++;
  }
  if (!n || !nav || !nav.lineClear) return false;
  const l = Math.hypot(ax, az) || 1;
  ax /= l; az /= l;
  for (const rot of [0, 0.9, -0.9, 1.6, -1.6]) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const dx = ax * c - az * s, dz = ax * s + az * c;
    const tp = [px + dx * 0.55, bot.pos[1], pz + dz * 0.55];
    if (nav.lineClear(bot.pos, tp, 0.02)) {
      brain.spaceTo = tp; brain.spaceOn = true; brain.spaceUntil = t + 0.4;
      return stepTo(bot, brain, tp[0], tp[2]) > 0.08;
    }
  }
  return false;
}

// ------------------------------------------------------------- stuck ladder
// Called once per act() after the cmd is final. `cmdMoving` = the cmd asked for
// movement this tick. Stage 0 -> 1 (0.7 s at < STUCK_SPEED): sidestep + local
// replan around the spot; -> 2 (every further 1.2 s): the legacy escalating
// random detour; stuckN >= 3 at zero speed: depenetrate (embed-tomb fix).
// A second, speed-independent detector catches orbit/oscillation: < 0.5 m of
// net displacement over 2.2 s of continuous commanded travel.
export function watchStuck(sim, nav, bot, brain, cmdMoving, dt, hooks) {
  const t = sim.state.time;
  const speed = Math.sqrt(bot.vel[0] * bot.vel[0] + bot.vel[2] * bot.vel[2]);
  let fired = false;
  if (cmdMoving && speed < STUCK_SPEED) {
    brain.stuckT += dt;
    const lim = (brain.stuckN | 0) === 0 ? 0.7 : 1.2;
    if (brain.stuckT > lim) { brain.stuckT = 0; fired = true; }
  } else {
    brain.stuckT = 0;
    if (speed >= 1.0) brain.stuckN = 0; // genuinely moving again
  }
  // displacement detector
  if (cmdMoving) {
    const a = brain.progA;
    if (!a || hd(bot.pos[0], bot.pos[2], a[0], a[1]) > 0.5) brain.progA = [bot.pos[0], bot.pos[2], t];
    else if (t - a[2] > 2.2) { brain.progA = [bot.pos[0], bot.pos[2], t]; fired = true; brain.orbitN = (brain.orbitN | 0) + 1; }
  } else brain.progA = null;
  if (!fired) return;

  brain.stuckN = (brain.stuckN | 0) + 1;
  const n = brain.stuckN;
  // depenetrate (legacy "embed tomb" fix, mover-layer defect recovered here)
  if (speed < 0.05 && n >= 3 && sim.world && sim.world.capsuleBlocked) {
    const h = bot.stance === "crouch" ? 1.35 : 1.8;
    if (sim.world.capsuleBlocked(bot.pos[0], bot.pos[1], bot.pos[2], 0.35, h)) {
      outer:
      for (const rr of [0.12, 0.2, 0.3, 0.45]) {
        for (let k8 = 0; k8 < 8; k8++) {
          const ang = k8 * Math.PI / 4;
          const nx = bot.pos[0] + Math.cos(ang) * rr;
          const nz = bot.pos[2] + Math.sin(ang) * rr;
          if (!sim.world.capsuleBlocked(nx, bot.pos[1], nz, 0.35, h)) {
            bot.pos[0] = nx; bot.pos[2] = nz;
            brain.stuckN = 0;
            brain.needRepath = true;
            return;
          }
        }
      }
    }
  }
  if (!nav) { brain.needRepath = true; return; }
  if (n === 1 || n === 2) {
    // stage 1/2: sidestep to the clear side + replan around this spot
    const dx = brain.mvx || 0, dz = brain.mvz || 0;
    let sx = -dz, sz = dx;
    const sgn0 = ((bot.id + n) & 1) ? 1 : -1;
    let ok = false;
    for (const sg of [sgn0, -sgn0]) {
      const tp = [bot.pos[0] + sx * sg * 0.9, bot.pos[1], bot.pos[2] + sz * sg * 0.9];
      if (nav.lineClear(bot.pos, tp, 0)) { brain.nudgeX = sx * sg; brain.nudgeZ = sz * sg; ok = true; break; }
    }
    if (ok) brain.nudgeUntil = t + 0.5;
    brain.avoid = [bot.pos[0], bot.pos[2], 1.3, 3.0];
    brain.avoidUntil = t + 6;
    brain.needRepath = true;
    if (hooks && hooks.replan) hooks.replan();
    return;
  }
  // stage 3+: legacy escalating detour around the BOT (any reachable node
  // nearby breaks the contact), held via brain.detourUntil so the objective
  // drive cannot re-assert its anchor inside the window
  const esc = nav.randomPoint(bot.pos, 3 + Math.min(9, n * 2), sim.rng.ai, 1);
  if (esc && hd(esc[0], esc[2], bot.pos[0], bot.pos[2]) > 0.6) {
    brain.detourUntil = 0;
    brain.needRepath = true;
    if (hooks && hooks.detour) hooks.detour(esc);
    brain.detourUntil = t + 1.5 + 0.7 * Math.min(6, n);
  } else brain.needRepath = true;
}
