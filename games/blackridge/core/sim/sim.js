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
import { makeMatch } from "../match/match.js";
import { getTuning, applyTuning } from "../pvp/pvp_tuning.js";
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
    weapons: weaponsIn = {},
    seed = 1,
    emit = () => {},
    // PVP seam (PVP_BUILD_PLAN W1):
    //   mode    — 'tdm'|'ctf'|'ffa' constructs the MATCH driver instead of
    //             the campaign mission driver. Exactly ONE driver per sim
    //             (A1: the two coexist in the codebase, never in one sim).
    //   tuning  — 'sp'|'pvp' balance table (C25 — identity delta set in wave 1)
    //   matchOpts — {difficulty, veteran, spawnDirector} forwarded to makeMatch
    mode = null,
    tuning = "sp",
    matchOpts = {},
  } = opts;

  const rng = makeStreams(seed);
  const world = makeWorld(colliders);
  const squad = makeSquad();
  const tun = getTuning(tuning);
  // C25/W11: per-weapon tuning deltas ride the sim's own weapons table. 'sp'
  // has no deltas, so the campaign path gets the INPUT REFERENCE back —
  // bit-identical to the untuned WEAPONS export (pvp_design §4.5).
  const weapons = applyTuning(weaponsIn, tun);

  // PVP and the campaign no longer share one loadout. The campaign keeps
  // mission.loadout (["warden","pike"]) — RAVEN 2-1 is designed around it and
  // mission.js validates it. PVP reads content.pvp.loadout, which is a PISTOL
  // START: every combatant spawns with the Pike and the three primaries are
  // fought over on the map (see the weapon_pad racks in content.json). Falling
  // back to mission.loadout means an absent pvp block changes nothing.
  const pvpLoadout = (content && content.pvp && content.pvp.loadout) || null;
  const loadoutSlots = (mode && pvpLoadout && pvpLoadout.slots)
    || (content && content.mission && content.mission.loadout && content.mission.loadout.slots)
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
      hp: tun.maxHp,
      alive: true,
      team: 0, // mirrored int (Part 3.4) — written by roster.bindBody in matches;
               // 0 in the campaign so generalized team reads stay coherent
      weapon: {
        id: primary, mag: wTable.mag, reserve: wTable.reserve, state: "idle",
        ads: false, adsT: 0, recoilIndex: 0, stateT: 0,
      },
      slots: loadoutSlots.slice(0, 2),
      speedNorm: 0,
      grenades: (content && content.mission && content.mission.loadout && content.mission.loadout.grenades) || tun.grenades,
      lastDamageT: -999,
      _slotAmmo: null,
      _m: null,
    },
    bots: [],
    objectives: [],
    match: null, // filled by match.start() in PVP (Part 3.2); null in campaign
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
    // simRecoil (wave-10 aim-truth fix, ballistics §2.3 block): FALSE in the
    // live game — the player's recoil climb is owned by weapons/recoil.js,
    // which kicks input.state, so it is already inside cmd.yaw/pitch and the
    // bullet leaves along the crosshair ray EXACTLY. Headless probes have no
    // recoil.js; they set this true so the sim models the same climb.
    flags: { god: false, noTarget: false, simRecoil: false },
    tuning: tun, // C25 balance seam — identity in wave 1; W11 flips the data
    emit: (type, data) => {
      if (type === "shot" && !data.impactOnly && !data.pen) internal.shotsAnyTotal++;
      emit(type, data);
    },
    mission: null, // set below when content present (campaign driver, A1)
    match: null,   // set below when opts.mode requests a PVP match; when set,
                   // sim.match === sim.mission (ONE object, two names — C29a)

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

      // 3.5 warm-up freeze (C14): during match warm-up the noTarget lever
      // (V9) stops perception/fire, and bot movement/fire cmds are zeroed
      // here — between the brains writing cmd and locomotion consuming it.
      if (sim.match && sim.match.botsFrozen && sim.match.botsFrozen()) {
        for (const b of state.bots) {
          if (b.cmd) { b.cmd.fire = false; b.cmd.moveX = 0; b.cmd.moveZ = 0; b.cmd.sprint = false; b.cmd.grenade = false; }
        }
      }

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
      // SPAWN SYMMETRY. In PVP every combatant starts on the same weapon as the
      // player. Without this the human spawns with a Pike while nine bots spawn
      // with Wardens/Vespers/Corvuses off their archetype, which is not a
      // difficulty setting, it is an unwinnable match. The archetype still
      // drives BEHAVIOUR (rifleman/cqb/marksman positioning) — only the starting
      // gun is equalised, and bots pick up racks by walkover like anyone else.
      const startWeapon = (mode && pvpLoadout && pvpLoadout.slots && pvpLoadout.slots[0]) || null;
      const weaponId = startWeapon || (arch ? arch.weapon : (weapons.warden ? "warden" : Object.keys(weapons)[0]));
      const wt = weapons[weaponId] || { mag: 30, reserve: 90 };
      const bot = {
        id,
        archetype: spec.archetype,
        pos: spec.pos.slice(),
        yaw: spec.yaw || 0,
        hp: tun.maxHp, // R16/AC-38 — ONE hp value at every band, no exceptions
        alive: true,
        // mirrored team int (Part 3.4; written by roster.bindBody in matches).
        // Campaign default 1 = hostile to the team-0 player, so generalized
        // team reads keep today's everyone-is-an-enemy semantics.
        team: spec.team != null ? spec.team : 1,
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
        // Bots carry slots too now, so a rack pickup has somewhere to land and
        // giveBodyWeapon can treat every combatant identically. Campaign bots get
        // their archetype weapon in slot 0 exactly as before.
        slots: startWeapon ? [startWeapon, null] : [weaponId, null],
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
    givePlayerWeapon(id, opts) { return sim.giveBodyWeapon(state.player, id, opts, "P"); },

    /** Rebuild a body's starting loadout — used on respawn so a picked-up
     *  weapon does not persist across lives. */
    resetBodyLoadout(body) {
      if (!body) return;
      const slots = loadoutSlots.slice(0, 2);
      const id = slots[0];
      const wt = weapons[id] || { mag: 30, reserve: 120 };
      body.slots = slots.length > 1 ? slots.slice() : [id, null];
      body._slotAmmo = {};
      for (const sId of body.slots) {
        if (!sId) continue;
        const t2 = weapons[sId];
        if (t2) body._slotAmmo[sId] = { mag: t2.mag, reserve: t2.reserve };
      }
      const w = body.weapon;
      w.id = id; w.mag = wt.mag; w.reserve = wt.reserve;
      w.state = "idle"; w.stateT = 0; w.ads = false; w.adsT = 0;
      w.recoilIndex = 0; w._shotCount = 0;
    },

    /**
     * Put weapon `id` in `body`'s hands. Works for the player and for a bot, so
     * a map rack is one world rule applied to all ten combatants rather than a
     * player-only privilege.
     *
     * Fixes two defects the old player-only version had:
     *  - SLOT CLOBBER. It did `idx = slots.indexOf(heldId); if (idx<0) idx=0;
     *    slots[idx] = id` with no check that `id` was ALREADY in the other slot.
     *    Holding warden with slots ["warden","pike"], granting pike produced
     *    ["pike","pike"] and orphaned _slotAmmo.warden for the rest of the life.
     *    It never fired in the campaign because neither crate weapon is in the
     *    campaign loadout — with racks as the PVP weapon economy it would have
     *    fired constantly.
     *  - Unconditional full mag+reserve, which strictly dominated the tuned kill
     *    refill. Racks now pass their own `reserve`.
     */
    giveBodyWeapon(body, id, opts, whoTag) {
      if (!body) return false;
      const wt = weapons[id];
      if (!wt) return false;
      const w = body.weapon;
      const from = w.id;
      if (from === id) return false;                  // already holding it
      if (!body.slots) body.slots = [from, null];
      if (!body._slotAmmo) body._slotAmmo = {};
      body._slotAmmo[from] = { mag: w.mag, reserve: w.reserve };   // stow what we hold

      // Prefer an empty slot, then the slot this weapon already occupies, then
      // the slot we are holding. Never write the same id into both slots.
      let idx = body.slots.indexOf(id);
      if (idx < 0) idx = body.slots.indexOf(null);
      if (idx < 0) idx = body.slots.indexOf(from);
      if (idx < 0) idx = 0;
      const dropped = body.slots[idx];
      if (dropped && dropped !== id && dropped !== from) delete body._slotAmmo[dropped];
      body.slots[idx] = id;

      const reserve = opts && typeof opts.reserve === "number" ? opts.reserve : wt.reserve;
      body._slotAmmo[id] = { mag: wt.mag, reserve };
      w.id = id;
      w.mag = wt.mag;
      w.reserve = reserve;
      w.state = "idle"; w.stateT = 0; w.ads = false; w.adsT = 0;
      w.recoilIndex = 0; w._shotCount = 0;
      sim.emit("switch", { who: whoTag || (body === state.player ? "P" : body.id), from, to: id });
      return true;
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

  // Driver selection (A1 — the campaign and the match COEXIST; exactly one
  // is constructed per sim, so exactly one ticks at slot 6):
  //   opts.mode set   → the PVP match driver (frozen triple, Part 3.1)
  //   opts.mode unset → the campaign mission driver, byte-for-byte as before
  if (mode) {
    sim.match = makeMatch(content, sim.emit, {
      mode, rng, seed,
      difficulty: matchOpts.difficulty,
      veteran: matchOpts.veteran,
      spawnDirector: matchOpts.spawnDirector,
      spawnDirectorFactory: matchOpts.spawnDirectorFactory,
    });
    sim.mission = sim.match; // ONE object, two names — boot.js/damage.js unchanged
  } else if (content) {
    sim.mission = makeMission(content, sim.emit);
  }

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
