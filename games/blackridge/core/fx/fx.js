// core/fx/fx.js [A7] — the combat-VFX registry: pools, event wiring, update.
// Architecture §3.14 (frozen): createFx(ctx) → { attach(bridge), update(dt),
// prewarmables() }. attach registers shot / death / land / hurt plus R13's
// explosion / grenade (and mission:start for the contracted pool clear).
// ALL pools preallocated at construction and permanently in the scene:
//   24 tracers · 12 muzzle sprites · 64-burst particle budget (dust 640 +
//   spark 384 points) · 256 decals (ring buffer, ~20 s) · 96 casings ·
//   ≤4 leased lights (3 muzzle grants + 1 explosion — via A6's
//   lights.lease/dynamicFree ONLY; this lane never constructs a THREE.Light).
// Every handler is epoch-checked (ctx.sim().epoch captured at attach).
// prewarmables() is COMPLETE: one renderable per fx material — a missed
// material is a perfprobe hitch with `programs` attribution.
//
// Event conventions (A1's swept-projectile amendments, wave-1 report):
//   fire-time shot  = neither `impactOnly` nor `pen` → muzzle + tracer +
//                     casing (+ inline hit fx when the pellet resolved
//                     within the fire tick)
//   impactOnly shot = flight-time resolution → impact fx/decal ONLY
//   pen entry/exit  = both-face world impact fx + decals, entity always null
//   firstShot       = §2.8 signature (flash ×1.2 scale, light ×1.25, full
//                     tracer) — multipliers from weapon_data.js FIRST_SHOT
// Flesh puffs dedupe between the shot-hit and hurt events of the same
// bullet (60 ms gate per victim) so one hit never pays two puffs.

import * as THREE from "three";
import { mulberry32 } from "../rng.js";
import { makeParticlePools, makeImpacts, SURFACE_ALIAS } from "./impacts.js";
import { makeMuzzle } from "./muzzle.js";
import { makeTracers } from "./tracers.js";
import { makeDecals, KIND_BLOOD } from "./decals.js";
import { makeCasings } from "./casings.js";
import { makeExplosions } from "./explosions.js";
import { makeGrounding } from "./grounding.js";
import { makeSurfaceIndex, CLS_GLASS, CLS_METAL, CLS_WOOD, CLS_DIRT } from "./surfaceindex.js";
import { playerMuzzle, botMuzzle } from "./muzzle_socket.js";
const _tStart = [0, 0, 0];

const FX_SEED = 0xa7f0c5; // reseeded every mission:start → deterministic batteries
const MISS_TRACER_DIST = 130; // terminal-miss streak length cap (m)
const CASING_MAX_CAM_DIST = 45;

// Impact power (particle counts/sizes) and bullet-hole edge (metres) by weapon
// class. ONE hole per bullet; a shotgun blast is nine small holes, not nine big
// ones. Unknown classes fall back to a generic rifle round.
const IMPACT_BY_CLASS = {
  pistol:  { power: 0.75, size: 0.17 },
  smg:     { power: 0.70, size: 0.16 },
  ar:      { power: 1.00, size: 0.19 },
  dmr:     { power: 1.50, size: 0.27 },
  shotgun: { power: 0.50, size: 0.15 },
  // [feel v153] the HX-60 Bastion fell through to the generic rifle row: a
  // full-power belt round hits harder than the M-72's and leaves a wider hole
  lmg:     { power: 1.20, size: 0.21 },
};
// Collider box kinds that read as a different MATERIAL than their sim surface.
const KIND_RETYPE = {
  sandbags: "fabric",
  car: "vehicle", van: "vehicle", truck: "vehicle",
};
const IMPACT_DEFAULT = { power: 1.0, size: 0.19 };

export function createFx(ctx) {
  const root = new THREE.Group();
  root.name = "fx";
  ctx.scene.add(root);

  let rand = mulberry32(FX_SEED);

  // ---- THE FX CLOCK IS THE SIM CLOCK (iter05, lane D) ---------------------
  // `clock` is the epoch every pool ages against (decal birth, casing TTL,
  // muzzle 55 ms flash life, tracer travel). It used to accumulate the WALL dt
  // handed to update() by boot's rAF loop, which runs viewUpdates every frame
  // whether or not the sim stepped (boot.js frame(): `if (pauseCtl.active) acc
  // = 0` — then viewUpdates(dt) unconditionally). That made every posed
  // battery frame unphotographable by construction, MEASURED live on S1 this
  // session: across the harness's 24-frame settle the sim advanced 0.000 s and
  // the wall clock advanced 3.70 s, and in that gap particlesActive went
  // 49 -> 0, tracersActive 3 -> 0, muzzle activeSprites 4 -> 0, leased flash
  // lights 2 -> 0 and casings flying 9 -> 0. Every critic's "zero combat
  // permanence" tell is that one line of arithmetic.
  //
  // Keying to the sim clock is also the only correct answer during PLAY: a
  // paused game must hold its brass and its smoke, and at this build's frame
  // rate a 0.25 s wall dt teleports a particle a quarter-second down its arc
  // in one step. Sim-delta is both frozen-frame-safe and motion-correct.
  let clock = 0;
  let lastSimT = null;

  function simDt(dtWall) {
    const s = ctx.sim && ctx.sim();
    if (!s) return Math.min(Math.max(dtWall, 0), 0.25); // pre-mission: wall
    const t = s.state.time;
    if (lastSimT === null) { lastSimT = t; return 0; }
    const d = t - lastSimT;
    lastSimT = t;
    if (!(d > 0)) return 0;         // sim held (pause/freeze) or restarted
    return Math.min(d, 0.25);       // clamp a multi-step catch-up frame
  }

  // ---- shared subsystem environment -------------------------------------
  const env = {
    ctx,
    root,
    cam: ctx.camera,
    rng: () => rand(),
    now: () => clock,
    groundY: (x, z) =>
      (ctx.colliders && ctx.colliders.groundY) ? ctx.colliders.groundY(x, z) : 0,
    // The lights lease API (A6). boot does not currently put `lights` on ctx
    // (needsElsewhere filed) — resolve lazily through the test-surface global,
    // which A0 assigns at the end of boot. Flashes are sprite-only until then.
    lights: () =>
      ctx.lights || ((typeof window !== "undefined" && window.__FPS__) ? window.__FPS__.lights : null),
    impacts: null, // set below (explosions composes bursts through it)
  };

  const pools = makeParticlePools(env);
  const decals = makeDecals(env);
  // Visible-surface index (surfaceindex.js): re-resolves each sim hit onto the
  // triangles the player actually sees, so a mark never hangs in the air.
  const surfaceIndex = makeSurfaceIndex();
  decals.setClipper((pos, n, half) => surfaceIndex.supportedScale(pos, n, half));
  const snapOut = { pos: [0, 0, 0], normal: [0, 0, 0], cls: 0 };
  const snapCounters = { snapped: 0, phantom: 0, unbaked: 0, retyped: 0 };
  const impacts = makeImpacts(env, pools, decals);
  env.impacts = impacts;
  const tracers = makeTracers(env);
  const muzzle = makeMuzzle(env);
  const casings = makeCasings(env);
  const explosions = makeExplosions(env, pools, decals);
  const grounding = makeGrounding(env);

  const counters = { shots: 0, impacts: 0, explosions: 0, grenadeFx: 0 };
  let groundingBaked = false;
  const lastFlesh = new Map(); // victim → sim time of last puff (dedupe)

  // Pool-mesh registry for the reparenting self-heal below. THREE's add()
  // REPARENTS: a prewarm pass that adds prewarmables() to a scratch scene
  // silently steals every pool out of this root (observed live against A6's
  // wave-2 prewarm — needsElsewhere filed). Take them back each frame.
  const poolMeshes = [
    ...pools.prewarmables(),
    ...tracers.prewarmables(),
    ...muzzle.prewarmables(),
    ...decals.prewarmables(),
    ...casings.prewarmables(),
    ...explosions.prewarmables(),
    ...grounding.prewarmables(),
  ];

  function healParents() {
    if (root.parent !== ctx.scene) ctx.scene.add(root);
    for (let i = 0; i < poolMeshes.length; i++) {
      if (poolMeshes[i].parent !== root) root.add(poolMeshes[i]);
    }
  }

  // ---- helpers ------------------------------------------------------------
  function simNow() {
    const s = ctx.sim && ctx.sim();
    return s ? s.state.time : clock;
  }

  function fleshGate(victim) {
    const t = simNow();
    const last = lastFlesh.get(victim);
    if (last !== undefined && t - last < 0.06) return false;
    lastFlesh.set(victim, t);
    return true;
  }

  function botPos(id) {
    const s = ctx.sim && ctx.sim();
    if (!s) return null;
    const bots = s.state.bots;
    for (let i = 0; i < bots.length; i++) if (bots[i].id === id) return bots[i].pos;
    return null;
  }

  function whoPos(who) {
    if (who === "P") {
      const s = ctx.sim && ctx.sim();
      return s ? s.state.player.pos : null;
    }
    return botPos(who);
  }

  // Casing floor: shooter's feet when grounded (exact on decks/stairs where
  // terrain-only groundY is not — A3 contract), else terrain below.
  function floorFor(who, origin) {
    const s = ctx.sim && ctx.sim();
    if (s && who === "P") {
      const p = s.state.player;
      return p.grounded ? p.pos[1] : env.groundY(p.pos[0], p.pos[2]);
    }
    if (s && who !== "P") {
      const bp = botPos(who);
      if (bp) return bp[1];
    }
    return env.groundY(origin[0], origin[2]);
  }

  function dist3(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function handleHit(d) {
    const hit = d.hit;
    const surf = SURFACE_ALIAS[hit.surface] || "concrete";
    if (surf === "flesh") {
      // THE LOCAL PLAYER IS THE CAMERA — never burst flesh on "P".
      // ballistics.js:181 sets hit.entity = ah.who, so a bot shooting the
      // player resolves a flesh hit AT THE PLAYER'S OWN CHEST, i.e. ~0.5 m
      // from the lens. impacts.flesh() then spawns 8 dark-red 45–90 mm puffs
      // there, and pools' gl_PointSize = aSize * uProj / d turns each one into
      // a 140–190 px red disc plastered over the frame. MEASURED in the live
      // iter05 S3 pose: 8 dust-pool particles at world [-43.7, 1.7, 48.5],
      // d 0.5–0.7 m, colour (0.26, 0.04, 0.04), 142–189 px each — the "soft
      // red/pink blobs floating at wall height" in the capture. Hiding
      // fx.dust + fx.spark removed every one of them and nothing else.
      // onHurt/onDeath already guard victim === "P" for exactly this reason;
      // the shot-hit path was the hole. Player damage is answered by the HUD
      // (VT §6 damage arc + red vignette), never by a world particle at eye
      // distance.
      if (hit.entity === "P") return;
      const key = hit.entity == null ? "?" : hit.entity;
      // The sim emits `hurt` BEFORE this round's `shot`. [feel v153] onHurt no
      // longer draws its puff at the victim's CHEST straight away (a headshot
      // bled from the sternum): it queues one, and this event — which knows the
      // exact point, the part and the bullet — claims it here. Anything left in
      // the queue at the end of the dispatch (explosion / env damage) is flushed
      // as the old chest puff by update().
      pendingHurt.delete(key);
      const head = hit.part === "head";
      const bloodOn = bloodEnabled();
      // The exit spray + spatter are directional, so they take their own gate
      // (one per shotgun volley) and run even when the puff gate is closed.
      if (bloodOn && d.dir && bloodGate(key)) bloodBehind(hit.pos, d.dir, head ? HEAD_PROF : profFor(d));
      if (!fleshGate(key)) return;
      impacts.spawn(hit.pos, d.dir ? [-d.dir[0], -d.dir[1], -d.dir[2]] : hit.normal,
        !bloodOn ? "fleshMuted" : head ? "fleshHead" : "flesh", d.dir, profFor(d));
      counters.impacts++;
      return;
    }
    // ---- snap the sim's collider hit onto the VISIBLE surface (surfaceindex.js)
    let pos = hit.pos, normal = hit.normal, surface = surf;
    if (surf !== "flesh") {
      let origin = d.origin;
      let hp = hit.pos;
      if (d.pen === "exit") {
        // exit hole: look at the far face from just behind it, back toward the shot
        origin = [hp[0] + d.dir[0] * 0.4, hp[1] + d.dir[1] * 0.4, hp[2] + d.dir[2] * 0.4];
      }
      const r = d.pen === "exit" ? null : surfaceIndex.snap(origin, hp, snapOut);
      if (d.pen === "exit") {
        // the exit face has no sim normal worth trusting; skip the snap, keep the hole
      } else if (r === null) {
        // canal water has no triangle in the index (it is a transparent plane) — a round
        // that hits the water splashes; any other phantom hit is the collider firing on
        // empty air (invisible box corner): no mark, no puff
        if (hit.pos[1] < -1.0 && hit.normal && hit.normal[1] > 0.5) {
          impacts.spawn(hit.pos, [0, 1, 0], "water", d.dir, IMPACT_BY_CLASS[(ctx.sim && ctx.sim() && ctx.sim().weapons[d.weaponId] || {}).class] || IMPACT_DEFAULT);
          snapCounters.splash = (snapCounters.splash || 0) + 1;
          counters.impacts++;
        }
        snapCounters.phantom++;
        return;
      } else if (r === undefined) {
        snapCounters.unbaked++;
      } else {
        snapCounters.snapped++;
        pos = snapOut.pos; normal = snapOut.normal;
        // what the player SEES decides the material: a window reads as glass even
        // when the collider under it is concrete, a car panel as metal, a crate wood
        let vis = null;
        if (snapOut.cls === CLS_GLASS) vis = "glass";
        else if (snapOut.cls === CLS_METAL && surf === "concrete") vis = "metal";
        else if (snapOut.cls === CLS_WOOD && surf === "concrete") vis = "wood";
        else if (snapOut.cls === CLS_DIRT && surf === "concrete") vis = "dirt";
        if (vis) { surface = vis; snapCounters.retyped++; }
      }
    }
    // d.dir is the shot's launch direction — the only evidence available at
    // this layer that a hit normal is a fallback rather than a measurement
    // (decals.js `spawn` header).
    const s = ctx.sim && ctx.sim();
    const wt = s && s.weapons ? s.weapons[d.weaponId] : null;
    const prof = (wt && IMPACT_BY_CLASS[wt.class]) || IMPACT_DEFAULT;
    // [feel v153] material from the collider KIND where the sim surface is too
    // coarse: sandbags are "dirt" boxes (-> fabric), cars/vans/trucks "metal"
    // boxes (-> vehicle). The hit payload carries no box, so look it up with
    // a 0.5 m probe straddling the hit point (one ray, only for these two).
    let box = null;
    if ((surface === "dirt" || surface === "metal") && d.dir && s && s.world && s.world.raycast) {
      const hp = hit.pos;
      _probe[0] = hp[0] - d.dir[0] * 0.25; _probe[1] = hp[1] - d.dir[1] * 0.25; _probe[2] = hp[2] - d.dir[2] * 0.25;
      const h2 = s.world.raycast(_probe, d.dir, 0.5);
      box = h2 && h2.box;
      const kind = box && (box.kind || "");
      if (kind && KIND_RETYPE[kind]) surface = KIND_RETYPE[kind];
      else if (box && box.id && /(^|_)(car|van|truck)(_|~|\d)/.test(box.id)) surface = "vehicle";
      if (surface === "fabric" || surface === "vehicle") snapCounters[surface] = (snapCounters[surface] || 0) + 1;
    }
    // wet streets: a round into the ground (no box, upward normal) splashes —
    // a full crown inside an authored puddle, a small droplet crown elsewhere
    let opts = prof;
    if (normal && normal[1] > 0.7 && !box && (surface === "concrete" || surface === "dirt")) {
      if (inPuddle(pos)) { surface = "water"; snapCounters.puddle = (snapCounters.puddle || 0) + 1; }
      else if (wetStreets()) { _wetProf.power = prof.power; _wetProf.size = prof.size; opts = _wetProf; }
    }
    impacts.spawn(pos, normal, surface, d.dir, opts);
    counters.impacts++;
  }
  const _probe = [0, 0, 0];
  function replayActive() {
    const kc = ctx.killcam || (typeof window !== "undefined" && window.__FPS__ ? window.__FPS__.killcam : null);
    return !!(kc && kc.isReplaying && kc.isReplaying());
  }
  const _wetProf = { power: 1, size: 0.19, wet: true };
  const HEAD_PROF = { power: 1.6, size: 0.2 };
  function puddles() {
    const t = ctx.layout && ctx.layout.terrain;
    return (t && t.heroPuddles) || [];
  }
  function inPuddle(p) {
    const P = puddles();
    for (let i = 0; i < P.length; i++) {
      const h = P[i];
      if (!h || !h.pos) continue;
      const dx = p[0] - h.pos[0], dz = p[2] - h.pos[1];
      if (dx * dx + dz * dz < (h.r || 1) * (h.r || 1)) return true;
    }
    return false;
  }
  // every BLACKRIDGE map is a rain-soaked night street; a map without weather
  // (or a future dry one with no puddles authored) gets no crown
  function wetStreets() { return !!ctx.weather && puddles().length > 0; }
  // Blood respects a `blood` setting ("off" -> neutral hit puffs, no spray, no
  // spatter decals) when one exists; settings.js has none today (hook filed).
  function bloodEnabled() {
    const S = ctx.settings;
    return !(S && (S.blood === "off" || S.blood === false));
  }
  // hurt events wait for their shot event (see handleHit); victim -> sim time
  const pendingHurt = new Map();

  function profFor(d) {
    const s = ctx.sim && ctx.sim();
    const wt = s && s.weapons ? s.weapons[d.weaponId] : null;
    return (wt && IMPACT_BY_CLASS[wt.class]) || IMPACT_DEFAULT;
  }
  const lastBlood = new Map();
  function bloodGate(victim) {
    const t = simNow();
    const last = lastBlood.get(victim);
    if (last !== undefined && t - last < 0.06) return false;   // one per shotgun volley
    lastBlood.set(victim, t);
    return true;
  }

  // Exit spray + spatter on the surface BEHIND a hit soldier (2026-10-14 review:
  // hits on enemies were only red puffs, with no mark anywhere). The ray carries on
  // through the body up to 2.4 m; whatever it meets (wall, crate, floor below a
  // downward shot) takes a KIND_BLOOD decal, snapped to the visible surface the
  // same way bullet holes are.
  const bloodStats = { calls: 0, wall: 0, floor: 0, none: 0, phantom: 0, placed: 0, dropped: 0 };
  function bloodBehind(pos, dir, prof) {
    bloodStats.calls++;
    impacts.spawn(pos, null, "fleshExit", dir, prof);
    const s = ctx.sim && ctx.sim();
    if (!s || !s.world || !s.world.raycast) return;
    const start = [pos[0] + dir[0] * 0.30, pos[1] + dir[1] * 0.30, pos[2] + dir[2] * 0.30];
    const hit = s.world.raycast(start, dir, 2.4);
    let bp = null, bn = null, guardDir = dir;
    if (hit) {
      bloodStats.wall++;
      const r = surfaceIndex.snap(start, hit.pos, snapOut);
      if (r) { bp = snapOut.pos; bn = snapOut.normal; } else if (r === undefined) { bp = hit.pos; bn = hit.normal; } else bloodStats.phantom++;
    } else {
      // nothing behind him: the spray lands on the floor a stride back. Found the
      // way a bullet hole on a floor is: a downward ray onto the colliders, then
      // snapped to the VISIBLE surface (a terrain-only height put it under or off
      // the real floor mesh and the coverage clipper rejected every one).
      const ex = pos[0] + dir[0] * 1.1, ez = pos[2] + dir[2] * 1.1, ey = pos[1] + 0.2;
      const down = s.world.raycast([ex, ey, ez], [0, -1, 0], 3.0);
      if (!down) bloodStats.none++;
      if (down) {
        bloodStats.floor++;
        const r = surfaceIndex.snap([ex, ey, ez], down.pos, snapOut);
        if (r) { bp = snapOut.pos; bn = snapOut.normal; } else if (r === undefined) { bp = down.pos; bn = down.normal; }
        // the floor normal is MEASURED, not a fallback, so decals.spawn's edge-on guard
        // (meant for fallback normals) must not see the near-horizontal bullet here
        guardDir = null;
      }
    }
    if (bp && bn) {
      // coverage clipper: a cobbled floor is many small stone meshes, so a full-size
      // spatter is rarely fully backed — step down until it fits (or give up)
      const big = 0.42 + Math.random() * 0.26;
      let ok = false;
      for (const sz of [big, big * 0.62, big * 0.40]) {
        if (decals.spawn(bp, bn, KIND_BLOOD, sz, guardDir) !== -1) { ok = true; break; }
      }
      if (ok) bloodStats.placed++; else bloodStats.dropped++;
    }
  }

  // ---- event handlers -------------------------------------------------------
  function onShot(d) {
    if (!d) return;
    counters.shots++;
    if (d.pen) { if (d.hit) handleHit(d); return; }        // both-face pen fx
    if (d.impactOnly) {                                    // late flight resolve
      if (d.hit && d.hit.pos && d.origin) tracers.clip(d.origin, d.hit.pos);
      if (d.hit) handleHit(d);
      return;
    }
    // fire-time event: muzzle + tracer + casing (+ inline hit)
    // A SHOTGUN blast arrives as one shot event per pellet (same tick, same origin):
    // the flash, the shell and the report belong to the TRIGGER PULL (pellet 0); only
    // a few pellets draw a tracer, and every pellet still gets its own impact below.
    const first = !(d.pellet > 0);
    if (first) muzzle.spawn(d);
    // [heavy weapons] a rocket launch: the flash + a back-blast dust cloud behind the
    // shooter; no tracer (the rocket itself flies, grenadefx.js) and no casing
    if (d.rocket) {
      if (d.origin && d.dir) {
        _puffPos[0] = d.origin[0] - d.dir[0] * 1.4; _puffPos[1] = d.origin[1] - 0.3; _puffPos[2] = d.origin[2] - d.dir[2] * 1.4;
        impacts.puff(_puffPos, "dust");
      }
      return;
    }
    if ((d.tracer || d.firstShot) && (first || d.pellet < 4)) {
      const dist = d.hit ? dist3(d.origin, d.hit.pos) : MISS_TRACER_DIST;
      // [feel v153] the streak leaves the visible MUZZLE (muzzle_socket.js)
      const ok = d.shooter === "P" ? playerMuzzle(ctx.camera, _tStart) : botMuzzle(d.shooter, _tStart);
      tracers.spawn(d.origin, d.dir, dist, ok ? _tStart : null);
    }
    const cam = ctx.camera.position;
    if (first && Math.hypot(d.origin[0] - cam.x, d.origin[2] - cam.z) < CASING_MAX_CAM_DIST) {
      casings.eject(d.origin, d.dir, d.weaponId, floorFor(d.shooter, d.origin));
    }
    if (d.hit) handleHit(d);
  }

  function onHurt(d) {
    if (!d || d.victim === "P") return;
    pendingHurt.set(d.victim, simNow()); // claimed by this round's shot event, else flushed
  }
  // Called once per frame after the bridge dispatch: hurts no shot claimed
  // (explosions, environment) get the generic chest puff, as before.
  function flushHurt() {
    if (pendingHurt.size === 0) return;
    for (const [victim] of pendingHurt) {
      if (!fleshGate(victim)) continue;
      const p = botPos(victim);
      if (!p) continue;
      _puffPos[0] = p[0]; _puffPos[1] = p[1] + 1.05; _puffPos[2] = p[2];
      impacts.puff(_puffPos, bloodEnabled() ? "flesh" : "dustSmall");
    }
    pendingHurt.clear();
  }

  function onDeath(d) {
    if (!d || d.victim === "P" || !d.pos) return;
    if (!fleshGate(d.victim)) return;
    _puffPos[0] = d.pos[0]; _puffPos[1] = d.pos[1] + 0.9; _puffPos[2] = d.pos[2];
    impacts.puff(_puffPos, "death");
  }

  function onLand(d) {
    if (!d || !(d.height > 1.5)) return; // event-table gate: dust if height>1.5
    const p = whoPos(d.who);
    if (!p) return;
    _puffPos[0] = p[0]; _puffPos[1] = p[1] + 0.05; _puffPos[2] = p[2];
    impacts.puff(_puffPos, "dust");
  }

  function onExplosion(d) {
    if (!d || !d.pos) return;
    explosions.spawn(d.pos, d.radius || 5.5, d.source || "grenade", d.yaw);
    counters.explosions++;
  }

  function onGrenade(d) {
    if (!d || !d.pos) return;
    if (d.phase === "bounce" || d.phase === "land") {
      impacts.puff(d.pos, "dustSmall");
      counters.grenadeFx++;
    }
  }

  const _puffPos = [0, 0, 0];

  // [melee] knife strike: blood through the EXISTING blood system (flesh puff +
  // exit spray + KIND_BLOOD spatter behind the victim, same gates as a bullet), a
  // dust tick where the blade meets a wall; and the strike's sound (sfx.onMelee —
  // audio.js is not this lane's file, so it is reached like boot's zone cue).
  const MELEE_PROF = { power: 0.85, size: 0.0 };
  function onMelee(d) {
    if (!d) return;
    try {
      const core = ctx.__audioCore;
      const sx = core && core.sfx;
      if (sx && sx.onMelee && core.env && core.env.ac && core.env.ac.state === "running") sx.onMelee(d);
    } catch (e) { /* audio never breaks the frame */ }
    if (d.phase === "hit" && d.pos && d.victim !== "P") {   // never blood at the camera (see handleHit)
      const key = d.victim == null ? "?" : d.victim;
      if (fleshGate(key)) impacts.puff(d.pos, "flesh");
      if (d.dir && bloodEnabled() && bloodGate(key)) bloodBehind(d.pos, d.dir, MELEE_PROF);
    } else if (d.phase === "miss" && d.surface && d.pos) {
      impacts.puff(d.pos, "dustSmall");
    }
  }

  function clearAll() {
    pools.clear();
    decals.clear();
    tracers.clear();
    muzzle.clear();
    casings.clear();
    explosions.clear();
    lastFlesh.clear();
    lastBlood.clear();
    pendingHurt.clear();
    // A fresh sim restarts state.time at 0; re-latch so the first simDt() after
    // a mission start is 0 rather than a large negative (which would clamp to
    // 0 anyway, but latching keeps the intent explicit).
    lastSimT = null;
    // Character blobs are owned by soldiers.js, which clears its own cast on
    // mission:start; releasing here would orphan slots it still holds.
    rand = mulberry32(FX_SEED); // deterministic per mission/scenario (R21)
  }

  // ---- frozen surface ---------------------------------------------------------
  const fx = {
    // [fx v152] the kill cam cuts between the live world and a replay of the
    // last seconds: airborne effects (particles, smoke, fireballs, tracers,
    // flashes) belong to one timeline and must not bleed into the other. Marks
    // on surfaces (decals, settled casings) stay — they are the world.
    clearTransient() {
      pools.clear();
      tracers.clear();
      muzzle.clear();
      explosions.clear();
    },
    attach(bridge) {
      // epoch check: attach runs right after boot's epoch++/bridge.clear();
      // any handler still registered for an older sim instance no-ops.
      const epoch0 = ctx.sim && ctx.sim() ? ctx.sim().epoch : -1;
      const guard = (fn, always) => (d, t) => {
        const s = ctx.sim && ctx.sim();
        if (!s || s.epoch !== epoch0) return;
        // [feel v153] while a kill-cam replay owns the screen, the LIVE sim keeps
        // stepping (measured: the final replay on switchyard carried 21-24 live
        // tracers — the whole pool — on top of the replayed fight). Only the
        // replay's own re-emitted events (d.replay) may draw.
        if (!always && !(d && d.replay) && replayActive()) return;
        fn(d, t);
      };
      bridge.register("mission:start", guard(() => {
        clearAll();
        try {
          surfaceIndex.bake([ctx.scene.getObjectByName("level"), ctx.scene.getObjectByName("props")]);
        } catch (e) {
          console.warn("[fx] surface index bake failed — decals fall back to collider points:", e && e.message);
          surfaceIndex.clear();
        }
      }, true));
      bridge.register("shot", guard(onShot));
      bridge.register("hurt", guard(onHurt));
      bridge.register("death", guard(onDeath));
      bridge.register("land", guard(onLand));
      bridge.register("explosion", guard(onExplosion));
      bridge.register("grenade", guard(onGrenade));
      bridge.register("melee", guard(onMelee)); // [melee]
    },

    update(dtWall) {
      let dt = simDt(dtWall);   // sim time, never wall time (see the header)
      // [feel v153] KILL CAM: while a replay owns the screen the effects it
      // re-emits belong to REPLAY time. They used to age on the live clock, so
      // in the 0.3x slow-motion stretch smoke, sparks and tracers ran ~3x ahead
      // of the bodies. killcam.fxDt() is the replay's own advance this frame
      // (rate-scaled, 0 while held or paused). simDt above still runs so the
      // live latch never jumps when the replay hands the screen back.
      const kc = ctx.killcam || (typeof window !== "undefined" && window.__FPS__ ? window.__FPS__.killcam : null);
      if (kc && kc.fxDt && kc.isReplaying && kc.isReplaying()) {
        const r = kc.fxDt();
        if (r >= 0) dt = Math.min(r, 0.25);
      }
      clock += dt;
      flushHurt();
      healParents(); // reclaim pools a prewarm pass reparented (see above)
      // One-time grounding bake, the first frame the level exists in the scene
      // (props are built before boot's rAF loop starts, so this is frame 1).
      if (!groundingBaked) {
        groundingBaked = true;
        const n = grounding.bakeStatics(ctx.scene);
        if (n) poolMeshes.push(...grounding.prewarmables());
      }
      // perspective point-size factor: drawingBufferHeight / (2 tan(vfov/2))
      const h = ctx.renderer.domElement.height || 1080;
      const f = h / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
      pools.setProj(f, ctx.renderer.domElement.width, h);
      pools.update(dt);
      muzzle.update(dt);
      tracers.update(dt);
      decals.update(dt);
      casings.update(dt);
      explosions.update(dt);
    },

    // COMPLETE: one renderable per fx material (dust, spark, tracer, muzzle,
    // explosion flash, explosion ring, decal, casing) — all live in the scene
    // from boot with degenerate instances, so both prewarm passes AND the
    // boot-time compileAsync cover every program this lane can ever ask for.
    prewarmables() { return poolMeshes.slice(); },

    // private extras (allowed by the freeze): probe/testing visibility
    clear: clearAll,
    // The ONE contact-shadow helper (ranked fix 5). soldiers.js leases dynamic
    // slots through here rather than importing grounding.js a second time, so
    // characters, props and vehicles all share one texture and one pool.
    grounding,
    stats() {
      return {
        clock: +clock.toFixed(3),
        grounding: grounding.stats(),
        events: { ...counters },
        particlesActive: pools.active(),
        tracersActive: tracers.active(),
        tracersSpawned: tracers.spawned(),
        muzzle: muzzle.stats(),
        casings: casings.stats(),
        decalsSpawned: decals.spawnedCount(),
        blood: { ...bloodStats },
        decalsRejected: decals.rejectedCount(),
        decalsClipped: decals.clippedCount(),
        surface: { ...surfaceIndex.stats(), ...snapCounters },
        explosions: explosions.stats(),
      };
    },
  };

  return fx;
}
