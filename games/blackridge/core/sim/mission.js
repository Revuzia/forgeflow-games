// core/sim/mission.js [A1] — objective state machine, data-driven from
// content.json (architecture §3.8, amended R22 beat-checkpoint respawn,
// R25 phases↔beats, R26 pickups). Frozen exports makeMission(content, emit)
// {start, tick, forfeit}; private members/exports added per the freeze rules.
//
// Contract gate (the Colosseum empty-bout lesson): validateContent() checks
// EVERY spawn/wave/objective/archetype/node/weapon/scenario reference and the
// A2-documented trigger vocabulary. makeMission() runs the content-internal
// half immediately (throws on dangling); the node/weapon half needs
// colliders+weapons and runs at mission.start(sim) — plus standalone via
// `node core/sim/sim.selftest.cjs --contract` (A2's official gate).
//
// Trigger vocabulary (content.json _contract, A2):
//   {kind:'missionStart'} | {kind:'beat',beat} | {kind:'reach',node|area,
//   radius?} | {kind:'contact',beat} | {kind:'waveAlive',wave,lte} |
//   {kind:'objective',id} | {kind:'anyOf',of:[...]}
// Beats advance STRICTLY in order — only the NEXT beat's trigger is armed.
// Wave triggers arm when their owning beat starts and stay armed until fired.
// Spawn queue: alive bots ≤ 12 (R23 engine cap); overflow spawns as slots
// free. Radio lines + set-pieces are queued on private drains pending the
// `radio`/`setpiece` freeze amendments (see lane report needsElsewhere).

import { resolveDifficulty } from "../pvp/pvp_tuning.js";

const ENGINE_BOT_CAP = 12;
const TRIGGER_KINDS = ["missionStart", "beat", "reach", "contact", "waveAlive", "objective", "anyOf"];
const DEFAULT_REACH_RADIUS = 3;

// H2 campaign difficulty — combat_spec §5.5 band ladder, ordered soft→hard.
// bandShift moves each AUTHORED spawn band one rung down (casual; hard = 0,
// the authored mix — identity with pre-difficulty builds),
// clamped to the ladder — bands stay honest per GAME_DOCTRINE §2 (a shifted
// bot is exactly an authored band, never an invented one).
const BAND_ORDER = ["recruit", "regular", "hardened", "veteran"];

// ---------------------------------------------------------------- validation
export function validateContent(content, opts = {}) {
  const errors = [];
  const M = content && content.mission;
  if (!M) return { ok: false, errors: ["content.mission missing"] };
  const waves = (M.spawns && M.spawns.waves) || [];
  const waveIds = new Set(waves.map((w) => w.id));
  const objIds = new Set((M.objectives || []).map((o) => o.id));
  const beatNums = new Set((M.beats || []).map((b) => b.beat));
  const archetypes = content.archetypes || {};
  const nodes = opts.nodes || null;
  const weapons = opts.weapons || null;

  const checkNode = (n, where) => {
    if (nodes && !Object.prototype.hasOwnProperty.call(nodes, n)) {
      errors.push(`${where}: unknown node '${n}'`);
    }
  };
  const checkWeapon = (w, where) => {
    if (weapons && !Object.prototype.hasOwnProperty.call(weapons, w)) {
      errors.push(`${where}: unknown weapon '${w}'`);
    }
  };
  const checkTrigger = (t, where) => {
    if (!t || TRIGGER_KINDS.indexOf(t.kind) < 0) {
      errors.push(`${where}: bad trigger kind '${t && t.kind}'`);
      return;
    }
    if (t.kind === "beat" && !beatNums.has(t.beat)) errors.push(`${where}: trigger beat ${t.beat} unknown`);
    if (t.kind === "contact" && !beatNums.has(t.beat)) errors.push(`${where}: contact beat ${t.beat} unknown`);
    if (t.kind === "waveAlive" && !waveIds.has(t.wave)) errors.push(`${where}: waveAlive wave '${t.wave}' unknown`);
    if (t.kind === "objective" && !objIds.has(t.id)) errors.push(`${where}: objective '${t.id}' unknown`);
    if (t.kind === "reach") {
      if (t.node) checkNode(t.node, where);
      else if (!t.area) errors.push(`${where}: reach trigger needs node or area`);
    }
    if (t.kind === "anyOf") {
      if (!Array.isArray(t.of) || !t.of.length) errors.push(`${where}: anyOf.of empty`);
      else t.of.forEach((s, i) => checkTrigger(s, `${where}.of[${i}]`));
    }
  };

  // beats: strictly ordered, refs resolve
  const beats = M.beats || [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (b.beat !== i + 1) errors.push(`beats[${i}]: beat number ${b.beat} not strictly ordered`);
    checkTrigger(b.trigger, `beat ${b.beat} trigger`);
    if (!b.checkpoint || !Array.isArray(b.checkpoint.pos)) errors.push(`beat ${b.beat}: checkpoint.pos missing`);
    for (const w of b.waves || []) if (!waveIds.has(w)) errors.push(`beat ${b.beat}: wave '${w}' unknown`);
    if (b.objective && !objIds.has(b.objective)) errors.push(`beat ${b.beat}: objective '${b.objective}' unknown`);
    if (b.truck && b.truck.throughNode) checkNode(b.truck.throughNode, `beat ${b.beat} truck`);
    for (const sp of b.setPieces || []) {
      if (sp.trigger) checkTrigger(sp.trigger, `setPiece ${sp.id}`);
    }
  }
  // phases (R25)
  for (const ph of M.phases || []) {
    for (const bn of ph.beats || []) if (!beatNums.has(bn)) errors.push(`phase ${ph.id}: beat ${bn} unknown`);
  }
  // objectives
  for (const o of M.objectives || []) {
    if (o.kind === "clear") {
      for (const w of o.waves || []) if (!waveIds.has(w)) errors.push(`objective ${o.id}: wave '${w}' unknown`);
    } else if (o.kind === "reach" || o.kind === "interact") {
      if (o.node) checkNode(o.node, `objective ${o.id}`);
      if (!o.node && !o.pos) errors.push(`objective ${o.id}: needs node or pos`);
    } else errors.push(`objective ${o.id}: unknown kind '${o.kind}'`);
    for (const u of o.unlocks || []) if (!objIds.has(u)) errors.push(`objective ${o.id}: unlocks '${u}' unknown`);
  }
  // waves + spawns
  for (const w of waves) {
    checkTrigger(w.trigger, `wave ${w.id} trigger`);
    for (const s of w.bots || []) {
      if (!archetypes[s.archetype]) errors.push(`wave ${w.id} spawn ${s.id}: archetype '${s.archetype}' unknown`);
      if (!Array.isArray(s.pos) || s.pos.length !== 3) errors.push(`wave ${w.id} spawn ${s.id}: bad pos`);
    }
  }
  // archetypes → weapons
  for (const [id, a] of Object.entries(archetypes)) {
    if (id.startsWith("_")) continue;
    checkWeapon(a.weapon, `archetype ${id}`);
  }
  // loadout
  for (const w of (M.loadout && M.loadout.slots) || []) checkWeapon(w, "loadout");
  // path nodes
  for (const n of M.path || []) checkNode(n, "mission.path");
  // pickups (R26)
  for (const pk of content.pickups || []) {
    if (pk.kind === "weapon") {
      checkWeapon(pk.weapon, `pickup ${pk.id}`);
      if (pk.spawnOn) checkTrigger(pk.spawnOn, `pickup ${pk.id} spawnOn`);
    }
  }
  // scenarios (R10): spawn refs + nearNode
  const spawnIds = new Set();
  for (const w of waves) for (const s of w.bots || []) spawnIds.add(s.id);
  for (const [sid, sc] of Object.entries(content.scenarios || {})) {
    if (sid.startsWith("_")) continue;
    for (const b of sc.bots || []) {
      if (b.spawn && !spawnIds.has(b.spawn)) errors.push(`scenario ${sid}: spawn ref '${b.spawn}' unknown`);
      if (b.archetype && !archetypes[b.archetype]) errors.push(`scenario ${sid}: archetype '${b.archetype}' unknown`);
    }
    if (sc.player && sc.player.nearNode) checkNode(sc.player.nearNode, `scenario ${sid}`);
    if (sc.player && sc.player.weapon) checkWeapon(sc.player.weapon, `scenario ${sid}`);
    if (sc.extends && !content.scenarios[sc.extends]) errors.push(`scenario ${sid}: extends '${sc.extends}' unknown`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- mission
export function makeMission(content, emit) {
  // content-internal gate NOW (throw on dangling — dev boot catches it)
  const gate = validateContent(content);
  if (!gate.ok) {
    throw new Error("content contract gate failed:\n  " + gate.errors.join("\n  "));
  }
  // tolerate A0's minimal inline-fallback content (boots without content.json
  // must not crash — the fallback has no beats/objectives/spawns.player)
  const M = content.mission;
  const beats = M.beats || [];
  const OBJECTIVES = M.objectives || [];
  const WAVES = (M.spawns && M.spawns.waves) || [];
  const wavesById = {};
  for (const w of WAVES) wavesById[w.id] = w;
  const objById = {};
  for (const o of OBJECTIVES) objById[o.id] = o;
  const beatOfWave = {};
  for (const b of beats) for (const w of b.waves || []) beatOfWave[w] = b.beat;

  // H2: campaign difficulty. content.difficultySelected is written by the
  // briefing screen (menu.js) before deploy; headless probes never set it,
  // so diffCfg is null there and every pre-H2 expectation holds byte-for-byte.
  const diffId = (content.difficultySelected && typeof content.difficultySelected === "string")
    ? content.difficultySelected : null;
  const diffCfg = resolveDifficulty(diffId, content.difficulty);

  function shiftBand(band) {
    if (!diffCfg || !diffCfg.bandShift) return band;
    const i = BAND_ORDER.indexOf(band || "regular");
    if (i < 0) return band;
    return BAND_ORDER[Math.max(0, Math.min(BAND_ORDER.length - 1, i + diffCfg.bandShift))];
  }

  const ms = {
    started: false,
    beatIdx: 0,             // 1-based current beat number
    beatStartT: 0,
    beatContact: false,
    armedWaves: [],         // wave ids armed, not yet fired
    firedWaves: {},         // waveId → true once its spawns were queued
    spawnQueue: [],         // pending bot specs (R23 ≤12 alive)
    obj: {},                // id → 'locked'|'active'|'done'
    objDoneT: {},
    checkpoint: null,       // {beat, loadout, grenades}
    deadFadeUntil: -1,
    truckArrivedT: -1,
    radioQueue: [],         // pending {speaker, line} — private drain
    radioSchedule: [],      // [{atT, entry}]
    setPiecesFired: {},
    pickupsSpawned: {},
    pickupsTaken: {},
    won: false,
  };

  function objState(sim) {
    // frozen sim.state.objectives shape (content order) — built once,
    // mutated in place after (no per-tick allocation)
    if (sim.state.objectives.length !== OBJECTIVES.length) {
      sim.state.objectives = OBJECTIVES.map((o) => ({
        id: o.id, label: o.label, state: ms.obj[o.id] || "locked",
      }));
    } else {
      for (let i = 0; i < OBJECTIVES.length; i++) {
        sim.state.objectives[i].state = ms.obj[OBJECTIVES[i].id] || "locked";
      }
    }
  }

  function setPhase(sim, phase) {
    const prev = sim.state.phase;
    if (prev === phase) return;
    sim.state.phase = phase;
    emit("mission:phase", { phase, prev });
  }

  function queueRadio(sim, beat, key) {
    for (const r of beat.radio || []) {
      if (r.at === key) ms.radioQueue.push({ speaker: r.speaker, line: r.line, beat: beat.beat, at: r.at });
      else if (key === "start" && /^start\+\d+$/.test(r.at)) {
        const n = parseInt(r.at.slice(6), 10);
        ms.radioSchedule.push({ atT: sim.state.time + n, entry: { speaker: r.speaker, line: r.line, beat: beat.beat, at: r.at } });
      }
    }
  }

  function activateObjective(sim, id) {
    if (ms.obj[id] === "locked") {
      ms.obj[id] = "active";
      const o = objById[id];
      emit("objective", { id, state: "active", label: o.label });
    }
  }

  function completeObjective(sim, id) {
    if (ms.obj[id] !== "active") return;
    ms.obj[id] = "done";
    ms.objDoneT[id] = sim.state.time;
    const o = objById[id];
    emit("objective", { id, state: "done", label: o.label });
    for (const u of o.unlocks || []) activateObjective(sim, u);
    // radio keyed objective:<id> (any beat's table)
    for (const b of beats) {
      for (const r of b.radio || []) {
        if (r.at === "objective:" + id) ms.radioQueue.push({ speaker: r.speaker, line: r.line, beat: b.beat, at: r.at });
      }
    }
    if (id === "obj_exfil") {
      ms.won = true;
      setPhase(sim, "won");
      emit("mission:end", { result: "won", stats: JSON.parse(JSON.stringify(sim.state.counters)) });
    }
  }

  function armWavesOfBeat(sim, beatNum) {
    const b = beats[beatNum - 1];
    for (const wid of b.waves || []) {
      if (!ms.firedWaves[wid] && ms.armedWaves.indexOf(wid) < 0) ms.armedWaves.push(wid);
    }
  }

  function enterBeat(sim, beatNum, { fromCheckpoint = false } = {}) {
    const b = beats[beatNum - 1];
    ms.beatIdx = beatNum;
    ms.beatStartT = sim.state.time;
    ms.beatContact = false;
    ms.shotsAtBeatStart = sim.internal.shotsAnyTotal;
    setPhase(sim, b.phase);
    if (!fromCheckpoint) {
      // R22 checkpoint: loadout as at beat entry
      const p = sim.state.player;
      ms.checkpoint = {
        beat: beatNum,
        weaponId: p.weapon.id,
        slots: p.slots.slice(),
        slotAmmo: JSON.parse(JSON.stringify(p._slotAmmo || {})),
        weapon: { mag: p.weapon.mag, reserve: p.weapon.reserve },
        grenades: p.grenades || 0,
      };
    }
    armWavesOfBeat(sim, beatNum);
    queueRadio(sim, b, "start");
  }

  function evalTrigger(sim, t) {
    switch (t.kind) {
      case "missionStart": return true;
      case "beat": return ms.beatIdx >= t.beat;
      case "reach": {
        const p = sim.state.player.pos;
        if (t.node) {
          const n = sim.colliders.nodes[t.node];
          const r = t.radius != null ? t.radius : DEFAULT_REACH_RADIUS;
          return Math.hypot(p[0] - n[0], p[2] - n[2]) <= r;
        }
        const [[x0, z0], [x1, z1]] = t.area;
        return p[0] >= x0 && p[0] <= x1 && p[2] >= z0 && p[2] <= z1;
      }
      case "contact": return ms.beatIdx === t.beat && ms.beatContact;
      case "waveAlive": {
        const w = wavesById[t.wave];
        if (!ms.firedWaves[t.wave]) return false;
        // fully spawned = nothing of this wave still queued
        for (const q of ms.spawnQueue) if (q.wave === t.wave) return false;
        let alive = 0;
        for (const b of sim.state.bots) if (b.wave === t.wave && b.alive) alive++;
        void w;
        return alive <= t.lte;
      }
      case "objective": return ms.obj[t.id] === "done";
      case "anyOf": return t.of.some((s) => evalTrigger(sim, s));
      default: return false;
    }
  }

  function fireWave(sim, wid) {
    ms.firedWaves[wid] = true;
    const w = wavesById[wid];
    // v2.2 (A0 wave-3, measured): a beat RESTART replays its waves in
    // beat-ENTRY state — alerted stripped. Authored `alerted:true` models
    // mid-combat contact when the beat first fires; on a checkpoint respawn
    // it spawn-camped the player (sp_arc_2 spawns alerted 2.8 m from the
    // beat-4 checkpoint: measured death every ~2.4 s, 371 deaths / 0 kills
    // in one e2e). R22's "restart current beat" = the beat as ENTERED:
    // perception re-acquires naturally through A5's pipeline instead.
    const stealth = ms.stealthReplayWaves && ms.stealthReplayWaves.has(wid);
    if (stealth) ms.stealthReplayWaves.delete(wid);
    for (const spec of w.bots) {
      // H2: per-difficulty band shift — applied at queue time so restarts,
      // checkpoint replays and the waveAlive triggers all see one consistent
      // roster for the selected difficulty.
      const band = shiftBand(spec.band);
      ms.spawnQueue.push(stealth
        ? { ...spec, band, alerted: false, wave: wid }
        : { ...spec, band, wave: wid });
    }
  }

  function drainSpawnQueue(sim) {
    let alive = 0;
    for (const b of sim.state.bots) if (b.alive) alive++;
    while (ms.spawnQueue.length && alive < ENGINE_BOT_CAP) {
      const spec = ms.spawnQueue.shift();
      sim.spawnBotFromSpec(spec);
      alive++;
    }
  }

  function waveCleared(sim, wid) {
    if (!ms.firedWaves[wid]) return false;
    for (const q of ms.spawnQueue) if (q.wave === wid) return false;
    for (const b of sim.state.bots) if (b.wave === wid && b.alive) return false;
    return true;
  }

  function checkObjectives(sim) {
    const p = sim.state.player;
    for (const o of OBJECTIVES) {
      if (ms.obj[o.id] !== "active") continue;
      if (o.kind === "clear") {
        if (o.holdUntilTruckS != null) {
          // the truck IS the clock — completes at truck arrival even if
          // waves cleared early (A2 design note; doctrine §2)
          if (sim.state.time - ms.beatStartT >= o.holdUntilTruckS) {
            ms.truckArrivedT = sim.state.time;
            const b = beats[ms.beatIdx - 1];
            if (b) queueRadio(sim, b, "truck");
            completeObjective(sim, o.id);
          }
        } else if ((o.waves || []).every((wid) => waveCleared(sim, wid))) {
          completeObjective(sim, o.id);
        }
      } else if (o.kind === "reach") {
        const n = o.node ? sim.colliders.nodes[o.node] : o.pos;
        const r = o.radius != null ? o.radius : DEFAULT_REACH_RADIUS;
        if (Math.hypot(p.pos[0] - n[0], p.pos[2] - n[2]) <= r) completeObjective(sim, o.id);
      } else if (o.kind === "interact") {
        const n = o.pos || sim.colliders.nodes[o.node];
        const r = o.radius != null ? o.radius : 1.6;
        const d3 = Math.hypot(p.pos[0] - n[0], (p.pos[1] + 1.0) - n[1], p.pos[2] - n[2]);
        if (d3 <= r + 1.2 && sim.internal.interactEdge) completeObjective(sim, o.id);
      }
    }
  }

  function checkSetPieces(sim) {
    const b = beats[ms.beatIdx - 1];
    if (!b) return;
    for (const sp of b.setPieces || []) {
      if (ms.setPiecesFired[sp.id] || !sp.trigger) continue;
      if (evalTrigger(sim, sp.trigger)) {
        ms.setPiecesFired[sp.id] = sim.state.time;
        ms.setPieceQueue.push({ id: sp.id, beat: b.beat });
        queueRadio(sim, b, "setpiece:" + sp.id);
      }
    }
  }

  function checkPickups(sim) {
    const p = sim.state.player;
    for (const pk of content.pickups || []) {
      if (pk.kind !== "weapon" || ms.pickupsTaken[pk.id]) continue;
      if (!ms.pickupsSpawned[pk.id]) {
        if (!pk.spawnOn || evalTrigger(sim, pk.spawnOn)) ms.pickupsSpawned[pk.id] = true;
        else continue;
      }
      const d = Math.hypot(p.pos[0] - pk.pos[0], p.pos[2] - pk.pos[2]);
      if (d <= (pk.radius || 1.2) + 0.6 && Math.abs(p.pos[1] - pk.pos[1]) < 2.0 &&
          (!pk.interact || sim.internal.interactEdge)) {
        ms.pickupsTaken[pk.id] = true;
        sim.givePlayerWeapon(pk.weapon);
      }
    }
    // R26/§2.2 systemic ammo walkover: +1 mag of that bot's weapon class
    for (const b of sim.state.bots) {
      if (b.alive || b._ammoTaken) continue;
      const d = Math.hypot(p.pos[0] - b.pos[0], p.pos[2] - b.pos[2]);
      if (d <= 1.2 && Math.abs(p.pos[1] - b.pos[1]) < 1.5) {
        b._ammoTaken = true;
        sim.grantAmmoMag(sim.weapons[b.weapon.id] ? sim.weapons[b.weapon.id].class : null);
      }
    }
  }

  const mission = {
    // ------------------------------------------------------------ frozen
    start(sim) {
      // full gate with colliders + weapons now available
      const full = validateContent(content, { nodes: sim.colliders.nodes, weapons: sim.weapons });
      if (!full.ok) throw new Error("content contract gate failed at start():\n  " + full.errors.join("\n  "));
      ms.started = true;
      ms.setPieceQueue = [];
      for (const o of OBJECTIVES) ms.obj[o.id] = o.initial ? "active" : "locked";
      const p = sim.state.player;
      if (M.spawns && M.spawns.player) {
        p.pos = M.spawns.player.pos.slice();
        p.yaw = M.spawns.player.yaw;
      }
      p.grenades = (M.loadout && M.loadout.grenades) || 0;
      emit("mission:start", { missionId: M.id, epoch: sim.epoch });
      if (beats.length) enterBeat(sim, 1);
      for (const o of OBJECTIVES) {
        if (o.initial) emit("objective", { id: o.id, state: "active", label: o.label });
      }
      objState(sim);
    },

    tick(sim) {
      if (!ms.started || ms.won || sim.state.phase === "lost") return;
      const S = sim.state;

      // R22 death → 1.2 s fade → beat-checkpoint restore
      if (!S.player.alive) {
        if (ms.deadFadeUntil < 0) ms.deadFadeUntil = S.time + (M.death && M.death.fadeS || 1.2);
        if (S.time >= ms.deadFadeUntil) {
          ms.deadFadeUntil = -1;
          mission.checkpointRestore(sim);
        }
        objState(sim);
        return;
      }

      // contact tracking (first shot by anyone OR first bot confirm)
      if (!ms.beatContact) {
        if (sim.internal.shotsAnyTotal > ms.shotsAtBeatStart) ms.beatContact = true;
        else for (const b of S.bots) {
          if (b.alive && b.state === "combat") { ms.beatContact = true; break; }
        }
      }

      // armed wave triggers
      for (let i = ms.armedWaves.length - 1; i >= 0; i--) {
        const wid = ms.armedWaves[i];
        if (evalTrigger(sim, wavesById[wid].trigger)) {
          ms.armedWaves.splice(i, 1);
          fireWave(sim, wid);
        }
      }
      drainSpawnQueue(sim);

      // next beat trigger (strictly ordered — only the NEXT beat is armed)
      if (ms.beatIdx < beats.length) {
        const nb = beats[ms.beatIdx];
        if (evalTrigger(sim, nb.trigger)) enterBeat(sim, nb.beat);
      }

      checkSetPieces(sim);
      checkObjectives(sim);
      checkPickups(sim);

      // scheduled radio (start+N)
      for (let i = ms.radioSchedule.length - 1; i >= 0; i--) {
        if (S.time >= ms.radioSchedule[i].atT) {
          ms.radioQueue.push(ms.radioSchedule[i].entry);
          ms.radioSchedule.splice(i, 1);
        }
      }
      objState(sim);
    },

    forfeit(sim) {
      // Real loss path — doctrine §6.
      if (sim.state.phase === "lost" || ms.won) return;
      setPhase(sim, "lost");
      emit("mission:end", { result: "lost", stats: JSON.parse(JSON.stringify(sim.state.counters)) });
    },

    // ------------------------------------------------------------ private
    onPlayerDeath(sim) {
      ms.deadFadeUntil = -1; // tick() sets the fade window
    },

    checkpointRestore(sim) {
      const cp = ms.checkpoint;
      const S = sim.state;
      const beatNum = cp ? cp.beat : ms.beatIdx;
      const b = beats[beatNum - 1];
      // remove ALL bots of the current beat's waves; reset those waves
      const beatWaves = new Set(b.waves || []);
      S.bots = S.bots.filter((bot) => !(bot.wave && beatWaves.has(bot.wave)));
      ms.spawnQueue = ms.spawnQueue.filter((q) => !beatWaves.has(q.wave));
      // waves replayed by this restore spawn UN-alerted (see fireWave)
      ms.stealthReplayWaves = new Set(beatWaves);
      for (const wid of beatWaves) {
        delete ms.firedWaves[wid];
        const ix = ms.armedWaves.indexOf(wid);
        if (ix >= 0) ms.armedWaves.splice(ix, 1);
      }
      // reset the beat's set-pieces so they can replay
      for (const sp of b.setPieces || []) delete ms.setPiecesFired[sp.id];
      // player restore: checkpoint pos/yaw, full HP, loadout as at beat entry
      const p = S.player;
      p.pos = b.checkpoint.pos.slice();
      // v2.2 (A0 wave-3, measured): snap to the support surface nearest the
      // AUTHORED checkpoint height — sphereGround returns the TOPMOST box
      // top, and the beat-4 checkpoint sits under an arcade roof slab, so
      // every death respawned the player ON THE ROOF at y 8.5 (kills froze,
      // deaths climbed 1-per-10 s in the first full e2e). supportAt clamps
      // to tops within STEP_UP of the authored y, else terrain.
      p.pos[1] = typeof sim.world.supportAt === "function"
        ? sim.world.supportAt(p.pos[0], p.pos[2], b.checkpoint.pos[1] || 0, 0.4)
        : sim.world.sphereGround(p.pos[0], p.pos[2]);
      p.yaw = b.checkpoint.yaw || 0;
      p.pitch = 0;
      p.vel = [0, 0, 0];
      p.hp = sim.tuning ? sim.tuning.maxHp : 100; // H2: was hardcoded 100 (sp maxHp IS 100 — identity)
      p.alive = true;
      p.lastDamageT = -999;
      if (cp) {
        p.slots = cp.slots.slice();
        p._slotAmmo = JSON.parse(JSON.stringify(cp.slotAmmo));
        p.weapon.id = cp.weaponId;
        p.weapon.mag = cp.weapon.mag;
        p.weapon.reserve = cp.weapon.reserve;
        p.grenades = cp.grenades;
      }
      p.weapon.state = "idle";
      p.weapon.stateT = 0;
      p.weapon.ads = false;
      p.weapon.adsT = 0;
      p.weapon.recoilIndex = 0;
      if (p._m) p._m = null; // movement state resets (re-init next tick)
      sim.internal.projectiles.length = 0;
      sim.internal.grenades.length = 0;
      enterBeat(sim, beatNum, { fromCheckpoint: true });
    },

    // subtitle/VO drains — pending the `radio`/`setpiece` freeze amendments
    drainRadio() { const q = ms.radioQueue; ms.radioQueue = []; return q; },
    drainSetPieces() { const q = ms.setPieceQueue || []; ms.setPieceQueue = []; return q; },
    get beat() { return ms.beatIdx; },
    get beatStartT() { return ms.beatStartT; },
    // H2: difficulty surface — damage.js reads diffCfg via sim.mission (the
    // match driver exposes the same pair, so the read is driver-agnostic).
    difficulty: diffId,
    diffCfg,
    get objectives() { return { ...ms.obj }; },
    get pickups() { return { spawned: { ...ms.pickupsSpawned }, taken: { ...ms.pickupsTaken } }; },
    _ms: ms,
  };
  return mission;
}
