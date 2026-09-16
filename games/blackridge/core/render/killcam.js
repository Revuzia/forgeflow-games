// core/render/killcam.js — the respawn kill cam.
//
// Owner request (2026-09-16): "getting killed and respawning should also show
// you the KILL CAM during the wait."
//
// WHY THIS MODULE IS SMALL, AND WHY IT DOES NOT FIGHT FOR THE CAMERA.
// core/weapons/viewmodel.js only drives the camera while the local player is
// ALIVE — its guard reads
//     driving = visible && !ctx.cameraDetached && p && p.alive && LIVE_PHASES…
// so the frame you die the rig has ALREADY released the camera and nothing is
// writing it. Before this module, that window was simply a frozen frame
// wherever you happened to be looking when you died. So there is no ownership
// contest here: this fills a gap, it does not take anything away. In
// particular it never touches input.state, so the tick-interpolation work that
// fixed the "skating" complaint is untouched.
//
// IT DOES HAVE TO HIDE THE VIEWMODEL. `rig.visible` (viewmodel.js) gates on
// cameraDetached but NOT on p.alive, so without raising that flag your own
// arms and rifle hang in the middle of the kill-cam shot, welded to a camera
// that is now somewhere across the map. ctx.cameraDetached is the documented
// seam for exactly this case (viewmodel.js header: a detached scenario
// "releases the camera completely"), so the cam raises it while it drives and
// restores the previous value the moment it stops.
//
// EDGE CASES, all of which resolve to "show something sane, never throw":
//   - suicide / zone / world death  → no attacker: orbit the death spot.
//   - killer dies before you respawn → m.posOf() falls back to their _lastPos,
//     so the shot holds on where they fell instead of snapping to the origin.
//   - killer leaves the roster       → treated as no killer.
//   - match ends during the wait     → phase leaves the live set, cam releases.
//   - overtime (no respawns)         → same; the cam is phase-gated, not
//     respawn-gated, so it cannot strand the camera.
//
// NPC IDENTITY: this module deals only in positions. The killer's NAME is
// rendered by core/hud/match_hud.js through actorName(), which returns a plain
// roster name with no bot marker — the owner's standing rule that players must
// never be able to tell a bot from a human is preserved by construction.

const LIVE_PHASES = new Set(["live", "warmup", "overtime"]);

// Framing. Distances in metres.
const ORBIT_RATE = 0.22;   // rad/s — slow drift, enough to read depth
const DIST = 4.6;          // how far back from the killer
const HEIGHT = 1.55;       // camera rise above the killer's feet
const FOCUS_Y = 1.35;      // aim at the chest, not the feet
const NEAR_CLAMP = 1.25;   // never pull closer than this when occluded
const SKIN = 0.35;         // stand-off from whatever the pull-in ray hit
const EASE_S = 0.45;       // blend from the death pose into the shot
const NO_KILLER_DIST = 5.4;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len2(v) { return Math.hypot(v[0], v[2]); }

export function createKillCam(ctx) {
  let killerActorId = null;
  let deathPos = null;
  let fromPos = null;      // camera position at the instant of death
  let orbit = 0;
  let since = 0;
  let driving = false;
  let prevDetached = false;
  const _p = [0, 0, 0];

  function sim() { return ctx.sim ? ctx.sim() : null; }

  function matchOf(s) {
    // sim.match is the match object; .m is its public surface (posOf/actors).
    return s && s.match && s.match.m ? s.match.m : null;
  }

  function release() {
    if (!driving) return;
    driving = false;
    ctx.cameraDetached = prevDetached;
  }

  function onDeath(d) {
    // Only OUR death opens a kill cam. victimActor 0 is the human slot, but
    // prefer the explicit who tag when the event carries one.
    if (!d) return;
    const mine = d.victim === "P" || d.who === "P" || d.victimActor === 0;
    if (!mine) return;
    killerActorId = (d.attackerActor != null && d.attackerActor !== 0)
      ? d.attackerActor : null;
    deathPos = Array.isArray(d.pos) ? d.pos.slice() : null;
    const c = ctx.camera;
    fromPos = c ? [c.position.x, c.position.y, c.position.z] : null;
    orbit = 0;
    since = 0;
  }

  function attach(bridge) {
    if (bridge && bridge.register) bridge.register("death", onDeath);
  }

  // Where the killer is RIGHT NOW (live body), else where they fell.
  //
  // DELIBERATELY LIVE, not a snapshot taken at the moment of death. We have no
  // replay buffer, so a frozen anchor would hold the shot on the patch of
  // ground the killer has already run off, with the rest of the world still
  // moving around it — worse than useless. Tracking them live is the honest
  // approximation and is what a modern death cam actually shows.
  //
  // HAZARD for anyone editing this: m.posOf returns the LIVE body array
  // (match.js `if (b) return b.pos;`), which locomotion mutates in place. It is
  // safe to READ per frame as we do, but it must never be stored — an
  // unsliced "snapshot" would silently keep tracking. deathPos is .slice()d in
  // onDeath for exactly this reason.
  function killerPos(m) {
    if (m == null || killerActorId == null) return null;
    const a = m.actors && m.actors[killerActorId];
    if (!a) return null;
    const p = m.posOf(a);
    return Array.isArray(p) ? p : null;
  }

  function update(dt) {
    const s = sim();
    const st = s && s.state;
    const p = st && st.player;
    const ms = st && st.match;
    const camera = ctx.camera;

    const shouldDrive = !!(camera && p && !p.alive && ms && LIVE_PHASES.has(ms.phase));
    if (!shouldDrive) { release(); return false; }

    if (!driving) {
      driving = true;
      prevDetached = !!ctx.cameraDetached;
      ctx.cameraDetached = true;   // releases the rig AND hides the floating gun
      if (!fromPos) fromPos = [camera.position.x, camera.position.y, camera.position.z];
    }

    // boot.js zeroes the sim accumulator while paused but still calls
    // viewUpdates with the real frame dt, so without this the orbit keeps
    // sweeping behind a static dimmed frame and the shot has visibly moved by
    // the time the player resumes. Keep ownership, stop advancing.
    if (ctx.pauseCtl && ctx.pauseCtl.active) { camera.updateMatrixWorld(); return true; }

    since += dt;
    orbit += dt * ORBIT_RATE;

    const m = matchOf(s);
    const kp = killerPos(m);
    const anchor = kp || deathPos || [camera.position.x, 0, camera.position.z];
    const focus = [anchor[0], (anchor[1] || 0) + FOCUS_Y, anchor[2]];

    // Bearing: look at the killer from roughly where the victim fell, so the
    // shot reads as "this is the angle they got you from" rather than a random
    // side-on. With no killer, just orbit the death spot.
    let bx = 1, bz = 0;
    if (kp && deathPos) {
      const d = sub(deathPos, kp);
      const L = len2(d);
      if (L > 0.5) { bx = d[0] / L; bz = d[2] / L; }
    }
    const ca = Math.cos(orbit), sa = Math.sin(orbit);
    const dirX = bx * ca - bz * sa;
    const dirZ = bx * sa + bz * ca;

    const dist = kp ? DIST : NO_KILLER_DIST;
    let wantX = focus[0] + dirX * dist;
    let wantY = focus[1] + HEIGHT;
    let wantZ = focus[2] + dirZ * dist;

    // Occlusion pull-in: cast from the focus outwards and stop short of the
    // first wall, so the cam never ends up inside geometry looking at black.
    const world = s && s.world;
    if (world && world.raycast) {
      const vx = wantX - focus[0], vy = wantY - focus[1], vz = wantZ - focus[2];
      const L = Math.hypot(vx, vy, vz) || 1;
      const hit = world.raycast(focus, [vx / L, vy / L, vz / L], L);
      if (hit && hit.dist != null && hit.dist < L) {
        const t = Math.max(NEAR_CLAMP, hit.dist - SKIN) / L;
        wantX = focus[0] + vx * t;
        wantY = focus[1] + vy * t;
        wantZ = focus[2] + vz * t;
      }
    }
    // and never sink through the floor
    if (world && world.supportAt) {
      const g = world.supportAt(wantX, wantZ, wantY, 0.3);
      if (Number.isFinite(g) && wantY < g + 0.45) wantY = g + 0.45;
    }

    // Ease out of the death pose so the cut is not a hard teleport.
    let k = 1;
    if (fromPos && since < EASE_S) {
      const u = since / EASE_S;
      k = u * u * (3 - 2 * u); // smoothstep
    }
    _p[0] = fromPos ? fromPos[0] + (wantX - fromPos[0]) * k : wantX;
    _p[1] = fromPos ? fromPos[1] + (wantY - fromPos[1]) * k : wantY;
    _p[2] = fromPos ? fromPos[2] + (wantZ - fromPos[2]) * k : wantZ;

    camera.position.set(_p[0], _p[1], _p[2]);
    camera.lookAt(focus[0], focus[1], focus[2]);
    // REQUIRED, and easy to assume is handled. viewmodel.js does call
    // camera.updateMatrixWorld(), but that line sits BELOW its
    // `if (!rig.visible) { ...; return; }` early-out — and rig.visible is false
    // for exactly the window this cam drives. So during the kill cam nothing
    // else in viewUpdates refreshes the camera's world matrix.
    camera.updateMatrixWorld();
    return true;
  }

  return {
    attach,
    update,
    isActive() { return driving; },
    reset() { release(); killerActorId = null; deathPos = null; fromPos = null; since = 0; orbit = 0; },
    // read-only surface for the HUD and for automated checks
    state() {
      return { active: driving, killerActorId, deathPos, since };
    },
  };
}
