// mover_env.mjs - the REAL mover (player.js tick) in Node, for the gates that WALK something (Wave 7b, lane B2; the helpers of probe_navtown.mjs factored out
// so probe_endgame.mjs walks the Deepwood bridge with exactly the mover the nav-town rows use).  NO browser, NO server, NO file edited.
//
//   import { makeEnv } from "./world_env.mjs";
//   import { loadPlayer, makeGameW, makeMover, follow, walkLine } from "./mover_env.mjs";
//   const E = await makeEnv({ root, vendor }); const { buildMap } = await E.importMaps();
//   const Pmod = await loadPlayer(root);                       // runtime/3d/royale/player.js (imports three through the resolve hook)
//   const M = await buildMap(E.makeW(seed), "deepwood");
//   const GW = await makeGameW(E, Pmod, M, seed);              // a W the real player.js can run on (no renderer, no input)
//   const mover = makeMover(GW, E.THREE);                      // { a: the actor, place(x, y, z) }
//   follow(Pmod, mover, GW, start, waypoints)                  // steer at each waypoint in turn (navtown's closed loop)
//   walkLine(Pmod, mover, GW, start, goal)                     // a straight walk: stops on arrival, a stall, swimming or the time budget
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadPlayer(ROOT) {
  return import(pathToFileURL(path.join(path.resolve(ROOT), "runtime", "3d", "royale", "player.js")).href);
}

/** a W the real player.js can run on (no renderer, no input): the way probe_navtown.mjs / navgrid's phase3 build it */
export async function makeGameW(E, Pmod, M, seed) {
  const noop = () => {};
  const dom = new Proxy({ style: {}, addEventListener: noop, removeEventListener: noop, requestPointerLock: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }), clientWidth: 1, clientHeight: 1 },
    { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
  globalThis.addEventListener = noop; globalThis.removeEventListener = noop;
  if (!globalThis.document.addEventListener) { globalThis.document.addEventListener = noop; globalThis.document.removeEventListener = noop; globalThis.document.body = dom; globalThis.document.documentElement = dom; globalThis.document.getElementById = () => dom; globalThis.document.querySelector = () => dom; }
  if (!globalThis.navigator) try { globalThis.navigator = { userAgent: "node", maxTouchPoints: 0 }; } catch (e) { /* node 22 has navigator */ }
  const W = E.makeW(seed);
  W.map = M; W.actors = []; W.kernel.renderer = { domElement: dom }; W.mapId = M.id;
  W.settings = W.settings || {}; W.settings.keys = {}; W.settings.remap = {};
  Pmod.init(W);
  return W;
}

export function makeMover(W, THREE) {
  const a = {
    alive: true, isBot: true, netRemote: false, isDummy: false, id: 1,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
    input: { yaw: 0, pitch: 0, mx: 0, mz: 0, sprint: false, ads: false, crouch: false, jump: false, emote: null, fire: false },
    onGround: true, gliding: false, swimming: false, inWater: false, crouching: false, healing: null, emoting: null, mantleT: null,
    _pp: new THREE.Vector3(), _pyaw: 0, _ppT: 0, _vmode: 0, _stepAcc: 0, hasCrouchClip: false, chute: null, _portalBoost: false,
    _portalT: 0, _adsT: 0, _agl: 0, sprinting: false, lastDamageT: -999,
  };
  W.actors = [a]; W.t = 0; W.phase = "match";
  const place = (x, y, z) => {
    a.pos.set(x, y, z); a.vel.set(0, 0, 0); a.onGround = true; a.swimming = false; a.inWater = false; a.gliding = false; a.mantleT = null; a.alive = true;
    a.input.mx = 0; a.input.mz = 0; a.input.jump = false; a.input.sprint = false;
  };
  return { a, place };
}

/** follow `wp` (waypoints {x, y, z}) with the real mover: steer at the next waypoint, advance on arrival, give up on a stall (2.5 s without progress), swimming or the time budget */
export function follow(Pmod, mover, GW, start, wp) {
  const a = mover.a;
  mover.place(start.x, start.y, start.z);
  const DT = 1 / 60;
  let wi = 0, ticks = 0, total = 0, px = start.x, pz = start.z;
  for (const w of wp) { total += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z; }
  const cap = Math.ceil((total / 4.5 + 12) * 60);
  let lastProg = 0, bestD = Infinity;
  while (ticks < cap) {
    const w = wp[wi];
    const dx = w.x - a.pos.x, dz = w.z - a.pos.z, d = Math.hypot(dx, dz);
    const last = wi === wp.length - 1;
    if (d <= (last ? 0.45 : 0.55) && Math.abs(a.pos.y - w.y) < 1.4) {
      if (last) return { ok: true, ticks, total };
      wi++; bestD = Infinity; lastProg = ticks; continue;
    }
    a.input.yaw = Math.atan2(-dx, -dz); a.input.mz = 1; a.input.mx = 0;
    Pmod.tick(GW, DT); GW.t += DT; ticks++;
    if (d < bestD - 0.05) { bestD = d; lastProg = ticks; }
    if (ticks - lastProg > 150) return { ok: false, why: "stuck", wi, of: wp.length, at: [a.pos.x, a.pos.y, a.pos.z], toward: [w.x, w.y, w.z], total };
    if (a.swimming) return { ok: false, why: "swim", wi, of: wp.length, at: [a.pos.x, a.pos.y, a.pos.z], toward: [w.x, w.y, w.z], total };
  }
  return { ok: false, why: "time", wi, of: wp.length, at: [a.pos.x, a.pos.y, a.pos.z], toward: [wp[wi].x, wp[wi].y, wp[wi].z], total };
}

/**
 * a STRAIGHT walk start -> goal (both {x, z}, start also {y}); the mover keeps the heading the whole way, the walk succeeds when the feet are within `tol` of the goal
 * (horizontally) and ON THE GROUND there. Fails on: swimming (the crossing needed water), a launch portal (`portal`), a stall (2.5 s without 5 cm of progress) or the time budget.
 * Returns { ok, why, ticks, at, maxY, minY, left }.
 */
export function walkLine(Pmod, mover, GW, start, goal, opt) {
  const o = opt || {};
  const a = mover.a, DT = 1 / 60, tol = o.tol || 0.9;
  mover.place(start.x, start.y, start.z);
  const total = Math.hypot(goal.x - start.x, goal.z - start.z);
  const cap = Math.ceil((total / 4.5 + 10) * 60);
  let ticks = 0, lastProg = 0, bestD = Infinity, maxY = a.pos.y, minY = a.pos.y;
  while (ticks < cap) {
    const dx = goal.x - a.pos.x, dz = goal.z - a.pos.z, d = Math.hypot(dx, dz);
    if (a._portalBoost) return { ok: false, why: "portal", ticks, at: [a.pos.x, a.pos.y, a.pos.z], maxY, minY, left: d };        // a launch ring flung the walker: not a walk
    if (d <= tol && a.onGround) return { ok: true, ticks, at: [a.pos.x, a.pos.y, a.pos.z], maxY, minY };               // arrived ON THE GROUND (never in the air above the goal)
    a.input.yaw = Math.atan2(-dx, -dz); a.input.mz = 1; a.input.mx = 0; a.input.sprint = !!o.sprint;
    Pmod.tick(GW, DT); GW.t += DT; ticks++;
    if (a.pos.y > maxY) maxY = a.pos.y;
    if (a.pos.y < minY) minY = a.pos.y;
    if (d < bestD - 0.05) { bestD = d; lastProg = ticks; }
    if (a.swimming) return { ok: false, why: "swim", ticks, at: [a.pos.x, a.pos.y, a.pos.z], maxY, minY, left: d };
    if (ticks - lastProg > 150) return { ok: false, why: "stuck", ticks, at: [a.pos.x, a.pos.y, a.pos.z], maxY, minY, left: d };
  }
  return { ok: false, why: "time", ticks, at: [a.pos.x, a.pos.y, a.pos.z], maxY, minY, left: Math.hypot(goal.x - a.pos.x, goal.z - a.pos.z) };
}
