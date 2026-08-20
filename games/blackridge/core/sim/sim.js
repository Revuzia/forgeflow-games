// core/sim/sim.js [A1] — createSim, tick orchestration (architecture §3.5 as
// amended R5/R6/R7/R22/R25). THREE-free, Node-runnable, fixed dt = 1/60
// EXACTLY, deterministic (mulberry32 streams via core/rng.js). The frozen
// export signature and sim.state shape (§3.5.1) are unchanged; private
// members are additions the freeze permits.
//
// Tick order inside step (frozen, §3.5 — probes reason about this):
//   1. player movement + stance        (player.js, from cmd)
//   2. player weapon state machine     (player.js → ballistics fireShot)
//   3. AI                              (ai/botfsm.aiStep — A5's module)
//   4. bot locomotion + weapon fire    (same code paths as the player)
//   5. projectiles + grenades + damage resolution + regen
//   6. mission objective checks + phase transitions (mission.js)
//   7. counters / reverb-zone referee / anim derivation
//
// Private additions (documented for other lanes):
//   sim.mission        — constructed HERE from opts.content; boot calls
//                        sim.mission.start(sim) (needsElsewhere → A0)
//   sim.world/rng/weapons/colliders/nav/squad/flags/internal
//   sim.spawnBotFromSpec(spec)  — content-wave spawns (mission spawner)
//   sim.givePlayerWeapon(id) / sim.grantAmmoMag(class) / sim.setAmmo(n)
//   sim.flags.god / sim.flags.noTarget (A5 must respect noTarget)

import { makeStreams } from "../rng.js";
import { makeWorld } from "./world.js";
import { stepPlayer, stepBotLocomotion, stepActorWeapon, MOVE } from "./player.js";
import { stepProjectiles } from "./ballistics.js";
import { stepGrenades } from "./grenades.js";
import { stepHealth, applyDamage } from "./damage.js";
import { makeMission } from "./mission.js";
import { aiStep } from "../ai/botfsm.js";
import { makeSquad } from "../ai/squad.js";

const DT = 1 / 60;

const NULL_CMD = {
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false,
  sprint: false, fire: false, ads: false, reload: false, switchTo: null,
  interact: false, grenade: false,
};

export function createSim(opts = {}) {
  const {
    content = null,
    colliders = { boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {}, bounds: { min: [-99, -5, -99], max: [99, 30, 99] } },
    nav = null,
    weapons = {},
    seed = 1,
    emit = () => {},
  } = opts;

  const rng = makeStreams(seed);
  const world = makeWorld(colliders);
  const squad = makeSquad();

  const loadoutSlots = (content && content.mission && content.mission.loadout && content.mission.loadout.slots)
    || ["warden", "pike"];
  const primary = loadoutSlots[0];
  const wTable = weapons[primary] || { mag: 30, reserve: 120 };

  const state = {
    tick: 0,
    time: 0,
    phase: "menu", // 'menu'|'infil'|'assault'|'exfil'|'won'|'lost' (R25)
    player: {
      pos: colliders.spawns ? colliders.spawns.player.slice() : [0, 0, 0],
      vel: [0, 0, 0],
      yaw: colliders.spawns ? colliders.spawns.playerYaw || 0 : 0,
      pitch: 0,
      stance: "stand",
      grounded: true,
      hp: 100,
      alive: true,
      weapon: {
        id: primary, mag: wTable.mag, reserve: wTable.reserve, state: "idle",
        ads: false, adsT: 0, recoilIndex: 0, stateT: 0,
      },
      slots: loadoutSlots.slice(0, 2),
      speedNorm: 0,
      grenades: (content && content.mission && content.mission.loadout && content.mission.loadout.grenades) || 2,
      lastDamageT: -999,
      _slotAmmo: null,
      _m: null,
    },
    bots: [],
    objectives: [],
    counters: {
      shotsFired: 0, shotsHit: 0, kills: 0, headshots: 0,
      damageDealt: 0, damageTaken: 0, deaths: 0,
    },
  };
  // per-slot ammo store
  state.player._slotAmmo = {};
  for (const id of state.player.slots) {
    const wt = weapons[id];
    state.player._slotAmmo[id] = { mag: wt ? wt.mag : 0, reserve: wt ? wt.reserve : 0 };
  }

  let nextBotId = 1;

  const internal = {
    projectiles: [],
    grenades: [],
    shotsAnyTotal: 0,   // fire-time pellets by ANYONE (mission contact trigger)
    interactEdge: false,
    prevInteract: false,
    reverbZone: null,
  };

  const sim = {
    state,
    epoch: 0, // caller (boot) sets before first step; sim never changes it

    // ---- private plumbing (additions)
    world, rng, weapons, colliders, nav, squad, internal,
    flags: { god: false, noTarget: false },
    emit: (type, data) => {
      if (type === "shot" && !data.impactOnly && !data.pen) internal.shotsAnyTotal++;
      emit(type, data);
    },
    mission: null, // set below when content present

    // ------------------------------------------------------------- step
    step(cmd) {
      const c = cmd || NULL_CMD;
      state.tick++;
      state.time = state.tick / 60;

      // interact edge for mission/pickups
      internal.interactEdge = !!c.interact && !internal.prevInteract;
      internal.prevInteract = !!c.interact;

      // 1+2. player movement + stance + weapon machine
      stepPlayer(state, c, world, weapons, DT, sim);

      // 3. AI brains (A5) — write bot.cmd only; ≤4 think/tick inside
      aiStep(sim, nav, squad, DT);

      // 4. bot locomotion + weapon fire — the player's code paths
      for (const b of state.bots) {
        if (!b.alive) continue;
        stepBotLocomotion(sim, b, DT);
        const bc = b.cmd || NULL_CMD;
        if (bc.fire && !b._prevFire) b._fireEdgeT = state.time;
        if (bc.reload && !b._prevReload) b._reloadEdgeT = state.time;
        b._prevFire = !!bc.fire;
        b._prevReload = !!bc.reload;
        if (bc.sprint) b._lastSprintT = state.time;
        stepActorWeapon(sim, b.id, {
          fireHeld: !!bc.fire,
          fireBufferedT: b._fireEdgeT ?? null,
          reloadBufferedT: b._reloadEdgeT ?? null,
          switchBufferedT: null,
          switchTo: null,
          ads: !!bc.ads,
          consumeFire: () => { b._fireEdgeT = null; },
          consumeReload: () => { b._reloadEdgeT = null; },
          mantling: false,
          sprintState: bc.sprint ? "sprint" : "none",
          sprintExitT: b._lastSprintT ?? null,
          sprintWasTac: false,
          mantleRaiseUntil: -9,
          adsBlockUntil: -9,
          sliding: false,
        }, DT);
      }

      // 5. projectiles + grenades + damage resolution + regen
      stepProjectiles(sim, DT);
      stepGrenades(sim, world, DT);
      stepHealth(sim, DT);

      // 6. mission objective checks + phase transitions
      if (sim.mission && state.phase !== "menu") sim.mission.tick(sim);

      // 7. referees / zone / anims
      updateReverbZone();
      for (const b of state.bots) deriveBotAnim(b);
    },

    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },

    // ------------------------------------------------------------- mutators
    spawnBot(archetype, x, z, o = {}) {
      // test-surface spawn: bypasses the mission spawn queue (exact placement)
      const y = o.y != null ? o.y : world.sphereGround(x, z);
      return sim.spawnBotFromSpec({
        archetype, pos: [x, y, z], yaw: o.yaw || 0,
        alerted: !!o.alerted, patrol: o.patrol || null, band: o.band || "regular",
      });
    },

    spawnBotFromSpec(spec) {
      const id = nextBotId++;
      const arch = (content && content.archetypes && content.archetypes[spec.archetype]) || null;
      const weaponId = arch ? arch.weapon : (weapons.warden ? "warden" : Object.keys(weapons)[0]);
      const wt = weapons[weaponId] || { mag: 30, reserve: 90 };
      const bot = {
        id,
        archetype: spec.archetype,
        pos: spec.pos.slice(),
        yaw: spec.yaw || 0,
        hp: 100, // R16 — 100 HP at every band, no exceptions
        alive: true,
        state: spec.alerted ? "alert" : "patrol",
        anim: "idle",
        aimAt: null,
        stance: "stand",
        // private fields (A5 reads/writes; deterministic data only)
        band: spec.band || "regular",
        squadId: spec.squad || null,
        wave: spec.wave || null,
        spawnId: spec.id || null,
        patrol: spec.patrol || null,
        vel: [0, 0, 0],
        grounded: true,
        cmd: null,          // A5's brain writes the input struct here
        percept: null,      // A5's perception scratch
        flinchUntil: -9,
        flinchStacks: 0,
        lastHitT: -9,
        weapon: {
          id: weaponId, mag: wt.mag, reserve: wt.reserve, state: "idle",
          ads: false, adsT: 0, recoilIndex: 0, stateT: 0, lastShotT: -9,
        },
      };
      state.bots.push(bot);
      sim.emit("spawn", { botId: id, archetype: bot.archetype, pos: bot.pos.slice(), yaw: bot.yaw });
      return id;
    },

    damage(who, amount, src = "test") {
      applyDamage(sim, who, amount, null, "body", src); // routes through damage.js
    },

    teleport(who, x, y, z) {
      if (who === "P") {
        const p = state.player;
        p.pos[0] = x; p.pos[1] = y; p.pos[2] = z;
        p.vel = [0, 0, 0];
        if (p._m) p._m.fallPeakY = y;
      } else {
        const b = state.bots.find((b) => b.id === who);
        if (b) { b.pos[0] = x; b.pos[1] = y; b.pos[2] = z; b.vel = [0, 0, 0]; }
      }
    },

    aimAt(x, y, z) {
      const p = state.player;
      const ex = p.pos[0], ey = p.pos[1] + (p.stance === "crouch" ? 1.10 : 1.62), ez = p.pos[2];
      const dx = x - ex, dy = y - ey, dz = z - ez;
      const hl = Math.hypot(dx, dz) || 1e-9;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, hl);
    },

    setGod(on) { sim.flags.god = !!on; },
    setNoTarget(on) { sim.flags.noTarget = !!on; },

    // ---- private helpers for pickups / test surface (A11: give/setAmmo)
    givePlayerWeapon(id) {
      const p = state.player;
      const wt = weapons[id];
      if (!wt) return;
      const w = p.weapon;
      if (!p._slotAmmo) p._slotAmmo = {};
      p._slotAmmo[w.id] = { mag: w.mag, reserve: w.reserve };
      let idx = p.slots.indexOf(w.id);
      if (idx < 0) idx = 0;
      const from = w.id;
      p.slots[idx] = id;
      p._slotAmmo[id] = { mag: wt.mag, reserve: wt.reserve };
      w.id = id;
      w.mag = wt.mag;
      w.reserve = wt.reserve;
      w.state = "idle"; w.stateT = 0; w.ads = false; w.adsT = 0;
      w.recoilIndex = 0; w._shotCount = 0;
      sim.emit("switch", { who: "P", from, to: id });
    },

    grantAmmoMag(cls) {
      if (!cls) return;
      const p = state.player;
      for (const slotId of p.slots) {
        const wt = weapons[slotId];
        if (wt && wt.class === cls) {
          if (p.weapon.id === slotId) p.weapon.reserve += wt.mag;
          if (p._slotAmmo && p._slotAmmo[slotId]) p._slotAmmo[slotId].reserve += wt.mag;
          return;
        }
      }
    },

    setAmmo(n) {
      const p = state.player;
      p.weapon.mag = Math.max(0, n | 0);
      if (p._slotAmmo && p._slotAmmo[p.weapon.id]) p._slotAmmo[p.weapon.id].mag = p.weapon.mag;
    },
  };

  // mission (constructed here; boot calls sim.mission.start(sim))
  if (content) sim.mission = makeMission(content, sim.emit);

  // ---- helpers
  function updateReverbZone() {
    if (!content || !content.reverbZones) return;
    const p = state.player;
    const ex = p.pos[0], ey = p.pos[1] + 1.5, ez = p.pos[2];
    let zone = content.reverbZones.default || "exterior";
    for (const v of content.reverbZones.volumes || []) {
      if (ex >= v.min[0] && ex <= v.max[0] && ey >= v.min[1] && ey <= v.max[1] &&
          ez >= v.min[2] && ez <= v.max[2]) { zone = v.zone; break; }
    }
    if (zone !== internal.reverbZone) {
      internal.reverbZone = zone;
      sim.emit("zone", { reverbZone: zone });
    }
  }

  function deriveBotAnim(b) {
    if (!b.alive) return; // death anim latched by damage.js
    const t = state.time;
    const hspeed = b.vel ? Math.hypot(b.vel[0], b.vel[2]) : 0;
    const firing = t - (b.weapon.lastShotT ?? -9) < 0.25;
    const hitRecent = t - (b.lastHitT ?? -9) < 0.4;
    let anim;
    if (hitRecent) anim = "hit";
    else if (firing) anim = "fire";
    else if (b.stance === "crouch") anim = hspeed > 0.5 ? "crouch_walk" : "crouch_idle";
    else if (hspeed > 5.0) anim = "run";
    else if (hspeed > 0.5) anim = "walk";
    else if (b.state === "combat" || b.state === "suppress") anim = "aim";
    else anim = "idle";
    if (anim !== b.anim) {
      b.anim = anim;
    }
  }

  return sim;
}
