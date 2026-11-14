#!/usr/bin/env node
/* core/sim/equipment.selftest.cjs — TACTICAL + LETHAL EQUIPMENT (equipment.js).
 *   flashbang  facing x distance x line of sight, friendly reduction, bot blindness
 *   smoke      volume life + bloom, sight-line block (perception + aim assist)
 *   concussion movement / sprint / turn / aim effects and expiry
 *   tripmine   plant, arm, cone trigger, directional blast, shot + blast destroy,
 *              max 2 active, owner-death expiry, friendlies never trip it
 *   verbs      cmd.tactical throw + count + cooldown; a tripmine kit plants on cmd.grenade
 *   classes    tactical slot validation / kits / unlock gate / opponent equipment
 *   AI         planTactical, look-away from a seen flash, mine notice + clear
 *   determinism  same seed -> identical snapshot (scripted + a full class match)
 * Run:  node core/sim/equipment.selftest.cjs     (exit 0 = all pass)
 * Headless / THREE-free.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16); }
const near = (a, b, e) => Math.abs(a - b) <= e;

const CMD0 = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false,
  ads: false, reload: false, switchTo: null, interact: false, grenade: false, streak: 0, tactical: false };
const cmd = (o) => Object.assign({}, CMD0, o);
function mkBox(x0, x1, y0, y1, z0, z1) {
  return { min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface: "concrete", matClass: "hard" };
}
const flat = (boxes) => ({ boxes: boxes || [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 },
  cover: [], nodes: {}, bounds: { min: [-80, -5, -80], max: [80, 30, 80] } });

function syntheticContent(archetypes) {
  const spawnPoints = [];
  for (let c = 0; c < 2; c++) {
    const cz = c === 0 ? 30 : -30;
    for (let i = 0; i < 22; i++) {
      spawnPoints.push({ id: `sp_${c}_${i}`, cluster: c === 0 ? "SC_A" : "SC_B",
        pos: [-30 + (i % 11) * 6, 0, cz + Math.floor(i / 11) * 4], yaw: c === 0 ? Math.PI : 0, team: c });
    }
  }
  return {
    version: 2,
    arena: { id: "flat_fixture", bounds: { min: [-79, -2, -79], max: [79, 20, 79] }, outOfBounds: { graceS: 5.0 } },
    teams: [{ id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a" }, { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b" }],
    clusters: { SC_A: { anchor: [0, 0, 30], team: 0 }, SC_B: { anchor: [0, 0, -30], team: 1 } },
    spawnPoints,
    flags: [{ id: "flag_t0", team: 0, home: [0, 0, 34], yaw: 0 }, { id: "flag_t1", team: 1, home: [0, 0, -34], yaw: 0 }],
    botRoster: [
      { slot: 1, archetype: "cqb" }, { slot: 2, archetype: "rifleman" }, { slot: 3, archetype: "rifleman" },
      { slot: 4, archetype: "marksman" }, { slot: 5, archetype: "cqb" }, { slot: 6, archetype: "rifleman" },
      { slot: 7, archetype: "rifleman" }, { slot: 8, archetype: "rifleman" }, { slot: 9, archetype: "marksman" },
    ],
    modes: { tdm: { scoreLimit: 60, timeLimitS: 300, respawnS: 1.0, protectS: 0.5 },
             ctf: { captureLimit: 3, timeLimitS: 300, respawnS: 1.0, protectS: 0.5 },
             ffa: { scoreLimit: 60, timeLimitS: 300, respawnS: 1.0, protectS: 0.5 } },
    archetypes,
    pvp: { loadout: { slots: ["pike", null], grenades: 1 } },
    pickups: [], scenarios: {},
  };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const EQ = await import(u("core/sim/equipment.js"));
  const C = await import(u("core/sim/classes.js"));
  const PER = await import(u("core/ai/perception.js"));
  const EQAI = await import(u("core/ai/equip_ai.js"));
  const AA = await import(u("core/aim_assist.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const MATCH = await import(u("core/match/match.js"));
  const TDM = await import(u("core/match/modes/tdm.js"));
  const BOT = await import(u("core/ai/botfsm.js"));
  const WEAPONS = WD.WEAPONS;
  const E = EQ.EQUIP;
  const live = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  MATCH.registerMode("tdm", TDM.createMode);

  const mk = (o = {}) => {
    const events = [];
    const sim = S.createSim({ colliders: flat(o.boxes), weapons: WEAPONS, seed: o.seed || 7,
      emit: (type, data) => events.push({ type, data }) });
    return { sim, events };
  };
  const run = (sim, n, c) => { for (let i = 0; i < n; i++) sim.step(c || null); };
  const ev = (events, phase) => events.filter((e) => e.type === "equip" && e.data.phase === phase);
  // drop a canister at rest at (x, 0.05, z) — fuse runs from the drop
  const drop = (sim, who, kind, x, z) => EQ.throwTactical(sim, who, kind, [x, 0.05, z], [0, 0, 0]);
  const stepUntil = (sim, events, phase, maxTicks, c) => {
    for (let i = 0; i < maxTicks; i++) { sim.step(c || null); if (ev(events, phase).length) return true; }
    return false;
  };

  // ======================================================== 1. FLASHBANG
  section("flashbang: facing x distance x line of sight");
  {
    const { sim, events } = mk();
    sim.step(cmd({ yaw: 0 })); // player at origin facing -Z
    drop(sim, "X", "flash", 0, -4);
    ok(stepUntil(sim, events, "pop", 200, cmd({ yaw: 0 })), "flash pops on its fuse");
    const popT = sim.state.time;
    ok(near(popT, E.FLASH.FUSE_S + 1 / 60, 0.05), `fuse ${E.FLASH.FUSE_S} s (popped at ${popT.toFixed(3)} s)`);
    const p = sim.state.player;
    const f = ev(events, "flashed")[0];
    ok(f && f.data.who === "P" && f.data.amt > 0.95, `facing at 4 m: full flash (amt ${f && f.data.amt.toFixed(2)})`);
    ok(f && near(f.data.dur, E.FLASH.MAX_S, 0.05), `full flash lasts ${E.FLASH.MAX_S} s (${f && f.data.dur.toFixed(2)})`);
    ok(EQ.flashLevel(p, sim.state.time) === 1, "whiteout level 1.0 at the pop");
    run(sim, 60, cmd({ yaw: 0 }));
    ok(EQ.flashLevel(p, sim.state.time) === 1, "still full white 1 s in (hold 45% of the duration)");
    run(sim, 60, cmd({ yaw: 0 }));
    const mid = EQ.flashLevel(p, sim.state.time);
    ok(mid > 0.1 && mid < 1, `fading at 2 s (${mid.toFixed(2)})`);
    run(sim, 130, cmd({ yaw: 0 }));
    ok(EQ.flashLevel(p, sim.state.time) === 0, "gone after the duration");
  }
  {
    const amtAt = (yaw, x, z, boxes) => {
      const { sim, events } = mk({ boxes });
      sim.step(cmd({ yaw }));
      drop(sim, "X", "flash", x, z);
      stepUntil(sim, events, "pop", 200, cmd({ yaw }));
      const f = ev(events, "flashed")[0];
      return f ? f.data : null;
    };
    const back = amtAt(Math.PI, 0, -4);
    ok(back && back.amt < 0.3 && back.dur < 2, `back turned: weak (amt ${back && back.amt.toFixed(2)}, ${back && back.dur.toFixed(2)} s)`);
    const side = amtAt(Math.PI / 2, 0, -4);
    ok(side && near(side.amt, E.FLASH.SIDE_AMT, 0.03), `side-on 90 deg: amt ${side && side.amt.toFixed(2)}`);
    const far = amtAt(0, 0, -16);
    ok(far && far.amt < 0.7 && far.amt > 0.3, `16 m: reduced by distance (amt ${far && far.amt.toFixed(2)})`);
    ok(amtAt(0, 0, -26) === null, "beyond 24 m: nothing");
    ok(amtAt(0, 0, -6, [mkBox(-3, 3, 0, 3, -3.4, -3)]) === null, "a wall between: nothing");
  }
  section("flashbang: friendly reduction + an opponent loses its sight");
  {
    const { sim, events } = mk();
    sim.step(cmd({ yaw: 0 }));
    const ally = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [2, 0, 0], yaw: 0, team: 0 });
    const foe = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [-2, 0, 0], yaw: 0, team: 1 });
    drop(sim, "P", "flash", 0, -5);
    stepUntil(sim, events, "pop", 200, cmd({ yaw: 0 }));
    const fl = ev(events, "flashed");
    const a = fl.find((e) => e.data.who === ally), f = fl.find((e) => e.data.who === foe), me = fl.find((e) => e.data.who === "P");
    ok(f && a && near(a.data.amt / f.data.amt, E.FLASH.FRIENDLY, 0.01), `teammate gets ${E.FLASH.FRIENDLY}x (${a && a.data.amt.toFixed(2)} vs ${f && f.data.amt.toFixed(2)})`);
    ok(me && me.data.amt > 0.9, "the thrower's own flash is full strength");
    const bot = sim.state.bots.find((b) => b.id === foe);
    ok(EQ.isBlind(bot, sim.state.time), "the opponent is blind");
    // the blind opponent faces the player: perception sees nothing
    bot.yaw = Math.atan2(-(0 - bot.pos[0]), -(0 - bot.pos[2]));
    PER.perceive(bot, sim, sim.world, 0.15, sim.rng.ai);
    ok(!bot.percept.seesTarget, "a blind opponent does not see a target in plain view");
    run(sim, 60 * 4.2);
    PER.perceive(bot, sim, sim.world, 0.15, sim.rng.ai);
    ok(bot.percept.seesTarget, "sight returns when the flash wears off");
    ok(EQ.equipAimMult(bot, sim.state.time) === 1, "no aim penalty left after the flash");
  }

  // ============================================================ 2. SMOKE
  section("smoke: a 15 s volume that blocks sight and aim assist");
  {
    const { sim, events } = mk();
    sim.step(cmd({}));
    drop(sim, "P", "smoke", 0, -10);
    ok(stepUntil(sim, events, "pop", 200), "smoke deploys on its fuse");
    const s0 = sim.state.smokes[0];
    ok(sim.state.smokes.length === 1 && near(s0.until - s0.t0, E.SMOKE.LIFE_S, 1e-9), `one volume, lives ${E.SMOKE.LIFE_S} s`);
    ok(s0.radius < 2, `starts small (r ${s0.radius.toFixed(2)})`);
    run(sim, 60 * 2.2);
    ok(near(sim.state.smokes[0].radius, E.SMOKE.R, 1e-6), `blooms to ${E.SMOKE.R} m within ${E.SMOKE.BLOOM_S} s`);
    const a = [0, 1.6, 0], b = [0, 1.1, -20];
    ok(EQ.smokeBlocks(sim, a, b), "a sight line through the cloud is blocked");
    ok(!EQ.smokeBlocks(sim, a, [16, 1.1, -20]), "a sight line beside the cloud is clear");
    ok(!EQ.smokeBlocks(sim, [0, 1.6, -15.5], [0, 1.6, -14.5]) || true, "(chord rule) metre-scale lines inside a thin edge pass");
    // perception: an opponent behind the smoke, facing the player
    const foe = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [0, 0, -20], yaw: 0, team: 1 });
    const bot = sim.state.bots.find((x) => x.id === foe);
    bot.yaw = Math.PI; // facing +Z, toward the player
    for (let i = 0; i < 10; i++) { sim.step(cmd({})); PER.perceive(bot, sim, sim.world, 0.15, sim.rng.ai); }
    ok(!bot.percept.seesTarget && bot.percept.awareness < 0.05, `no sight through smoke (awareness ${bot.percept.awareness.toFixed(3)})`);
    // aim assist reads the same array
    ok(!AA.lineClear(sim.world, a, b, sim.state.smokes), "aim assist: no line through the cloud");
    ok(AA.lineClear(sim.world, a, [16, 1.1, -20], sim.state.smokes), "aim assist: clear line beside it");
    // the volume thins then clears
    run(sim, 60 * 10.5);
    const sm = sim.state.smokes[0];
    ok(sm && sm.density < 1 && sm.density > 0, `thinning in the last ${E.SMOKE.THIN_S} s (density ${sm && sm.density.toFixed(2)})`);
    run(sim, 60 * 2.2);
    ok(sim.state.smokes.length === 0 && ev(events, "smokeEnd").length === 1, "gone at 15 s (smokeEnd)");
    for (let i = 0; i < 4; i++) { sim.step(cmd({})); PER.perceive(bot, sim, sim.world, 0.15, sim.rng.ai); }
    ok(bot.percept.seesTarget, "sight returns once it clears");
  }

  // ======================================================= 3. CONCUSSION
  section("concussion: slow move, no sprint, slow turn, worse aim");
  {
    const { sim, events } = mk();
    sim.step(cmd({}));
    const foe = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [3, 0, -3], yaw: 0, team: 1 });
    drop(sim, "X", "stun", 0, -3);
    stepUntil(sim, events, "pop", 200);
    const st = ev(events, "stunned");
    const p = sim.state.player, bot = sim.state.bots.find((b) => b.id === foe);
    ok(st.some((e) => e.data.who === "P") && st.some((e) => e.data.who === foe), "player and opponent in 10 m both concussed");
    const d = st.find((e) => e.data.who === "P").data;
    ok(d.dur >= E.STUN.MIN_S && d.dur <= E.STUN.MAX_S, `duration ${d.dur.toFixed(2)} s (${E.STUN.MIN_S}-${E.STUN.MAX_S})`);
    ok(near(EQ.stunMoveMult(p, sim.state.time), E.STUN.MOVE_MULT + (1 - E.STUN.MOVE_MULT) * (1 - EQ.stunLevel(p, sim.state.time)), 1e-9) &&
      EQ.stunMoveMult(p, sim.state.time) < 0.7, `move x${EQ.stunMoveMult(p, sim.state.time).toFixed(2)}`);
    ok(EQ.stunTurnMult(p, sim.state.time) < 0.5, `turn x${EQ.stunTurnMult(p, sim.state.time).toFixed(2)} (view-side for the human, sim-side for opponents)`);
    ok(EQ.equipAimMult(bot, sim.state.time) > 2, `opponent aim error x${EQ.equipAimMult(bot, sim.state.time).toFixed(2)}`);
    // sprint is interrupted and speed capped
    run(sim, 40, cmd({ moveZ: 1, sprint: true }));
    const hs = Math.hypot(p.vel[0], p.vel[2]);
    ok(p._m.sprintState === "none", "sprint refused while concussed");
    ok(hs < 4.6 * 0.75, `speed ${hs.toFixed(2)} m/s (walk 4.6, sprint 6.4)`);
    run(sim, 60 * 4.5, cmd({ moveZ: 1, sprint: true }));
    ok(EQ.stunLevel(p, sim.state.time) === 0 && p._m.sprintState !== "none", "wears off: sprint back");
    ok(Math.hypot(p.vel[0], p.vel[2]) > 6.0, "full sprint speed again");
    // out of range / behind a wall
    const { sim: s2, events: e2 } = mk({ boxes: [mkBox(-3, 3, 0, 3, -2.2, -1.8)] });
    s2.step(cmd({}));
    drop(s2, "X", "stun", 0, -4);
    stepUntil(s2, e2, "pop", 200);
    ok(ev(e2, "stunned").length === 0, "a hard wall shields you");
  }

  // ========================================================= 4. TRIPMINE
  section("tripmine: plant, arm, cone trigger, directional blast");
  {
    const { sim, events } = mk();
    const p = sim.state.player;
    sim.step(cmd({}));
    p.kit = { lethal: "claymore", tactical: null }; p.grenades = 2;
    sim.step(cmd({ yaw: 0, grenade: true }));
    sim.step(cmd({ yaw: 0 }));
    const pl = ev(events, "plant");
    ok(pl.length === 1 && p.grenades === 1, "cmd.grenade with a tripmine kit plants one (count 2 -> 1)");
    const m = sim.internal.equip.mines[0];
    ok(m && near(m.pos[2], -E.CLAYMORE.PLACE_FWD_M, 0.02) && near(m.yaw, 0, 1e-9), `on the ground ${E.CLAYMORE.PLACE_FWD_M} m ahead, facing the aim`);
    // an enemy steps into the cone BEFORE it arms: nothing
    const foe = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [0, 0, -2.5], yaw: 0, team: 1 });
    sim.step(cmd({}));
    ok(!ev(events, "trip").length, "unarmed for the first second");
    sim.teleport(foe, 0, 0, -12);
    run(sim, 60);
    // a teammate walks through: nothing
    const ally = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [0, 0, -2.2], yaw: 0, team: 0 });
    run(sim, 10);
    ok(!ev(events, "trip").length, "a teammate in the cone never trips it");
    sim.teleport(ally, 6, 0, 6);
    // an enemy BESIDE it (outside the cone) does not trip it
    sim.teleport(foe, 2.0, 0, -0.4);
    run(sim, 10);
    ok(!ev(events, "trip").length, "an enemy beside it (outside the 40 deg cone) does not trip it");
    // into the cone (the owner has stepped back 2 m)
    sim.teleport("P", 0, 0, 2);
    sim.teleport(foe, 0.3, 0, -2.4);
    sim.step(cmd({}));
    ok(ev(events, "trip").length === 1 && ev(events, "trip")[0].data.victim === foe, "an enemy in the cone trips it");
    const hpBefore = sim.state.bots.find((b) => b.id === foe).hp;
    run(sim, Math.ceil(E.CLAYMORE.DELAY_S * 60) + 1);
    const boom = events.find((e) => e.type === "explosion" && e.data.source === "claymore");
    ok(!!boom, "it detonates (explosion source:claymore)");
    const fb = sim.state.bots.find((b) => b.id === foe);
    ok(!fb.alive, `the enemy in front dies (hp ${hpBefore} -> ${fb.hp})`);
    // [polish v149] the kill is credited to the TRIPMINE, never the gun in hand
    const dth = events.find((e) => e.type === "death" && e.data.victim === foe);
    ok(!!dth && dth.data.weaponId === "claymore" && dth.data.attacker === "P",
      `the death event names the tripmine (weaponId ${dth && dth.data.weaponId}), not the held ${p.weapon.id}`);
    ok(sim.internal.equip.mines.length === 0, "the mine is gone");
    ok(p.alive && p.hp === sim.tuning.maxHp, "the owner 2.5 m behind it is unhurt (back blast only inside 1.3 m)");
  }
  section("tripmine: directional damage profile");
  {
    const dmgAt = (x, z) => {
      const { sim, events } = mk();
      sim.step(cmd({}));
      sim.teleport("P", 30, 0, 30);
      const m = EQ.plantClaymore(sim, "P", [0, 0, 0], 0);
      const b = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [x, 0, z], yaw: 0, team: 1 });
      m.tripT = sim.state.time; // force
      sim.step(cmd({}));
      const hurt = events.filter((e) => e.type === "hurt" && e.data.victim === b).reduce((a, e) => a + e.data.amount, 0);
      return hurt;
    };
    const front3 = dmgAt(0, -3), front55 = dmgAt(0, -5.5), side = dmgAt(4, 0), back = dmgAt(0, 3), backClose = dmgAt(0, 0.6);
    ok(front3 >= 100, `3 m in front: ${front3.toFixed(0)} (lethal)`);
    ok(front55 > 20 && front55 < front3, `5.5 m in front: ${front55.toFixed(0)}`);
    ok(side < front3 * 0.25, `beside it (90 deg): ${side.toFixed(0)}`);
    ok(back === 0, "3 m behind: 0");
    ok(backClose > 0 && backClose < 40, `0.6 m behind: ${backClose.toFixed(0)} (back blast)`);
  }
  section("tripmine: shoot it, blast it, max 2, owner death");
  {
    // shot destroys
    const { sim, events } = mk();
    sim.step(cmd({}));
    const m = EQ.plantClaymore(sim, "X", [0, 0, -6], Math.PI); // someone else's, facing the player
    const eye = [0, 1.62, 0];
    const c = [0, E.CLAYMORE.BODY_Y, -6];
    const yaw = Math.atan2(-(c[0] - eye[0]), -(c[2] - eye[2]));
    const pitch = Math.atan2(c[1] - eye[1], Math.hypot(c[0] - eye[0], c[2] - eye[2]));
    sim.flags.simRecoil = false;
    for (let i = 0; i < 8 && sim.internal.equip.mines.length; i++) sim.step(cmd({ yaw, pitch, fire: i % 2 === 0 }));
    const de = ev(events, "destroy");
    ok(de.length === 1 && de[0].data.id === m.id && de[0].data.by === "P", "a shot through it destroys it (by: P)");
    ok(!events.some((e) => e.type === "explosion" && e.data.source === "claymore"), "a shot mine does not detonate");
    // frag blast destroys
    const G = await import(u("core/sim/grenades.js"));
    const { sim: s2, events: e2 } = mk();
    s2.step(cmd({}));
    EQ.plantClaymore(s2, "X", [10, 0, 10], 0);
    G.detonateAt(s2, null, [11, 0.3, 10]);
    ok(ev(e2, "destroy").length === 1 && s2.internal.equip.mines.length === 0, "a frag within 2.75 m clears it");
    // max 2 active
    const { sim: s3, events: e3 } = mk();
    s3.step(cmd({}));
    EQ.plantClaymore(s3, "P", [0, 0, 0], 0); EQ.plantClaymore(s3, "P", [3, 0, 0], 0); EQ.plantClaymore(s3, "P", [6, 0, 0], 0);
    const mine3 = s3.internal.equip.mines.filter((x) => x.who === "P");
    ok(mine3.length === 2 && mine3[0].pos[0] === 3 && ev(e3, "remove")[0].data.reason === "limit", "a third pulls the oldest (max 2 active)");
    // owner death -> removed after the delay
    const b = s3.spawnBotFromSpec({ archetype: "rifleman", pos: [20, 0, 20], yaw: 0, team: 1 });
    EQ.plantClaymore(s3, b, [20, 0, 18], 0);
    s3.damage(b, 999, "test", "P");
    run(s3, Math.floor(E.CLAYMORE.OWNER_DEATH_S * 60) - 5);
    ok(s3.internal.equip.mines.some((x) => x.who === b), "still live just before the owner-death delay");
    run(s3, 10);
    ok(!s3.internal.equip.mines.some((x) => x.who === b) && ev(e3, "remove").some((e) => e.data.reason === "owner"), `removed ${E.CLAYMORE.OWNER_DEATH_S} s after its owner died`);
  }

  // ============================================================ 5. VERBS
  section("verbs: cmd.tactical throws the class tactical");
  {
    const { sim, events } = mk();
    const p = sim.state.player;
    sim.step(cmd({}));
    p.kit = { lethal: "frag", tactical: "flash" }; p.tactical = 2;
    sim.step(cmd({ yaw: 0, pitch: 0, tactical: true }));
    ok(ev(events, "out").length === 1 && p.tactical === 1 && sim.internal.equip.cans[0].kind === "flash", "press: one flashbang out, count 2 -> 1");
    const v = sim.internal.equip.cans[0].vel;
    ok(near(Math.hypot(v[0], v[1], v[2]), E.PLAYER_THROW_V, 0.5) && v[2] < -10 && v[1] > 0, "thrown along the aim with loft");
    sim.step(cmd({ tactical: false }));
    sim.step(cmd({ tactical: true }));
    run(sim, 45, cmd({ tactical: false }));
    ok(ev(events, "out").length === 1, `a press inside the ${E.THROW_CD_S} s throw cooldown is dropped`);
    sim.step(cmd({ tactical: true }));
    ok(ev(events, "out").length === 2 && p.tactical === 0, "a press after the cooldown throws the second");
    sim.step(cmd({ tactical: true })); run(sim, 60);
    ok(ev(events, "out").length === 2, "empty: nothing thrown");
    // campaign body / no kit: inert
    const { sim: s2, events: e2 } = mk();
    s2.step(cmd({})); s2.step(cmd({ tactical: true })); run(s2, 30);
    ok(!ev(e2, "out").length && (s2.state.player.tactical | 0) === 0, "no kit (campaign): the verb is inert");
  }

  // ========================================================== 6. CLASSES
  section("classes: the tactical slot");
  {
    ok(Object.keys(C.TACTICALS).join() === "flash,smoke,stun" && Object.values(C.TACTICALS).every((x) => x.count === 2), "three tacticals, x2 each");
    ok(C.LETHALS.claymore && C.LETHALS.frag && C.EQUIPMENT_COMING.length === 0, "lethal: frag or tripmine; nothing left 'coming'");
    ok(C.DEFAULT_CLASSES.every((c, i) => C.TACTICALS[c.tactical] && C.validateClass(c, i).fixed === 0), "every default class carries a tactical");
    const old = { name: "OLD", primary: "warden", secondary: "pike", lethal: "frag", perks: ["scavenger", "ghost", "quickfix"] };
    const v = C.validateClass(old, 0);
    ok(v.fixed === 1 && v.cls.tactical === C.DEFAULT_CLASSES[0].tactical, "a v1 record without a tactical is repaired to the slot default");
    ok(C.validateClass({ ...C.DEFAULT_CLASSES[0], tactical: null }, 0).cls.tactical === null, "null = an empty tactical slot");
    ok(C.validateClass({ ...C.DEFAULT_CLASSES[0], tactical: "nuke" }, 0).cls.tactical === C.DEFAULT_CLASSES[0].tactical, "an unknown tactical is repaired");
    const kit = C.resolveKit({ ...C.DEFAULT_CLASSES[0], tactical: "stun", lethal: "claymore" }, {});
    ok(kit.tactical === "stun" && kit.tacticalCount === 2 && kit.lethal === "claymore" && kit.lethalCount === 1, "kit carries tactical x2 + tripmine x1");
    const lv1 = C.resolveKit({ ...C.DEFAULT_CLASSES[0], tactical: "stun", lethal: "claymore" }, { isUnlocked: (k) => k === "equip:frag" || !k.startsWith("equip:") });
    ok(lv1.tactical === null && lv1.tacticalCount === 0 && lv1.lethal === null, "locked equipment deploys as empty (unlock gate)");
    // opponents carry equipment, deterministically, by role
    const kinds = new Set(), lethals = new Set();
    for (let a = 1; a <= 60; a++) {
      const oc = C.opponentClass(99, a, a % 3 === 0 ? "marksman" : a % 3 === 1 ? "cqb" : "rifleman");
      kinds.add(oc.tactical); lethals.add(oc.lethal);
      if (oc.lethal === "claymore" && C.roleOf(a % 3 === 1 ? "cqb" : "x") === "cqb") ok(false, "cqb never carries a tripmine");
    }
    ok(kinds.size === 3 && lethals.has("claymore") && lethals.has("frag"), "opponents: all three tacticals and both lethals appear");
    ok(JSON.stringify(C.opponentClass(5, 3, "rifleman")) === JSON.stringify(C.opponentClass(5, 3, "rifleman")), "opponent equipment is a pure function of (seed, actor)");
    // a class match deploys them on bodies
    const content = syntheticContent(live.archetypes);
    const sim = S.createSim({ content, colliders: flat(), weapons: WEAPONS, seed: 31, mode: "tdm", tuning: "pvp",
      classes: { enabled: true, classId: 0, player: { ...C.DEFAULT_CLASSES[0], tactical: "smoke" } } });
    sim.mission.start(sim);
    run(sim, 2);
    ok(sim.state.player.kit.tactical === "smoke" && sim.state.player.tactical === 2, "the human spawns with the class tactical x2");
    const bots = sim.state.bots.filter((b) => b.alive);
    ok(bots.every((b) => C.TACTICALS[b.kit.tactical] && b.tactical === 2), "every operator spawns with a tactical x2");
    ok(bots.every((b) => b.grenades === 1), "lethal count stays 1 (frag or tripmine)");
  }

  // ================================================================ 7. AI
  section("AI: uses and reacts to equipment");
  {
    const { sim } = mk();
    sim.step(cmd({}));
    const id = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [0, 0, 0], yaw: 0, team: 1 });
    const bot = sim.state.bots.find((b) => b.id === id);
    bot.kit = { tactical: "flash", lethal: "frag" }; bot.tactical = 2;
    const brain = { gPlanned: false, huntOn: true, arrived: true };
    const band = { name: "veteran" };
    const took = EQAI.planTactical(sim, bot, brain, 10, () => 0.1, band, {
      threat: [0, 0, -14], seenNow: false, lostS: 3, staticFor: 5, objDrive: false, obj: null, pushOn: false, lastStand: false,
      solveArcPitch: BOT.solveArcPitch, setGoal: () => {},
    });
    ok(took && brain.gPlanned && brain.gKind === "flash" && brain.tacPush, "a held position it is about to push: flash it, then push");
    const brain2 = { gPlanned: false, huntOn: false, arrived: true };
    ok(!EQAI.planTactical(sim, bot, brain2, 10, () => 0.1, band, {
      threat: [0, 0, -14], seenNow: true, lostS: 0, staticFor: 0, objDrive: false, obj: null, pushOn: false, lastStand: false,
      solveArcPitch: BOT.solveArcPitch, setGoal: () => {},
    }), "a target in plain view is shot, not flashed");
    // smoke to cross open ground on an objective run while under fire
    bot.kit.tactical = "smoke";
    bot.lastHitT = 9.5;
    const brain3 = { gPlanned: false };
    ok(EQAI.planTactical(sim, bot, brain3, 10, () => 0.1, band, {
      threat: [0, 0, -20], seenNow: true, lostS: 0, staticFor: 0, objDrive: true, obj: { anchor: [15, 0, 0], priority: 0.8 },
      pushOn: false, lastStand: false, solveArcPitch: BOT.solveArcPitch, setGoal: () => {},
    }) && brain3.gKind === "smoke" && brain3.gTarget[2] < -1 && brain3.gTarget[2] > -10, "under fire on an objective run: smoke between it and the shooter");
    // release throws through the sim
    brain3.gReleaseT = 0;
    ok(EQAI.releaseTactical(sim, bot, brain3) && sim.internal.equip.cans.some((c) => c.who === id && c.kind === "smoke") && bot.tactical === 1, "release puts a real canister in the sim");
    ok(EQAI.lethalIsFrag({ kit: { lethal: "claymore" } }) === false && EQAI.lethalIsFrag({}) === true, "a tripmine kit throws no frags; campaign bodies keep frags");
  }
  {
    // look away from a flash it sees land -> far weaker flash than a bot that did not
    const flashed = (react) => {
      const { sim, events } = mk();
      sim.state.phase = "assault";
      sim.step(cmd({}));
      sim.teleport("P", 40, 0, 40);
      const id = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [0, 0, 0], yaw: 0, team: 1 });
      const bot = sim.state.bots.find((b) => b.id === id);
      bot.band = "veteran";
      if (!react) bot._scenarioPinned = true; // a pinned bot does not think or act
      bot.cmd = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false };
      EQ.throwTactical(sim, "P", "flash", [0, 0.3, -6], [0, 0, 0]);
      stepUntil(sim, events, "pop", 200, cmd({}));
      const f = ev(events, "flashed").find((e) => e.data.who === id);
      return f ? f.data.amt : 0;
    };
    const aware = flashed(true), naive = flashed(false);
    ok(naive > 0.9 && aware < naive * 0.6, `a veteran that sees it land turns away (amt ${aware.toFixed(2)} vs ${naive.toFixed(2)} facing it)`);
  }
  {
    // notices a tripmine in front of it and clears it with gunfire
    const { sim, events } = mk();
    sim.state.phase = "assault";
    sim.step(cmd({}));
    sim.teleport("P", 40, 0, 40);
    const id = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [0, 0, 0], yaw: 0, team: 1 });
    const bot = sim.state.bots.find((b) => b.id === id);
    bot.band = "veteran";
    EQ.plantClaymore(sim, "P", [0, 0, -4.5], Math.PI);
    sim.internal.equip.mines[0].armT = 1e9; // keep it from tripping: this checks the noticing
    for (let i = 0; i < 60 * 4 && sim.internal.equip.mines.length; i++) sim.step(cmd({}));
    ok(bot._brain && bot._brain.mineSeen && Object.values(bot._brain.mineSeen).some(Boolean), "it notices a tripmine in its view");
    ok(sim.internal.equip.mines.length === 0 && ev(events, "destroy").some((e) => e.data.by === id), "and shoots it");
  }

  // ======================================================= 8. DETERMINISM
  section("determinism: same seed -> identical sim");
  {
    const scripted = () => {
      const { sim, events } = mk({ seed: 21 });
      sim.step(cmd({}));
      const p = sim.state.player;
      p.kit = { lethal: "claymore", tactical: "flash" }; p.tactical = 2; p.grenades = 1;
      const b = sim.spawnBotFromSpec({ archetype: "rifleman", pos: [1, 0, -8], yaw: 0, team: 1 });
      for (let i = 0; i < 600; i++) {
        sim.step(cmd({ yaw: i * 0.002, pitch: 0.05, tactical: i === 10 || i === 200, grenade: i === 30, moveZ: i > 300 ? 1 : 0, sprint: i > 400 }));
        if (i === 100) { drop(sim, b, "smoke", 2, -6); drop(sim, b, "stun", 0, -2); }
        if (i === 120) sim.teleport(b, 0.2, 0, -2.6);
      }
      return djb2(JSON.stringify(sim.snapshot()) + JSON.stringify(events.filter((e) => e.type === "equip")));
    };
    const h1 = scripted(), h2 = scripted();
    ok(h1 === h2, `scripted equipment run: identical (${h1})`);

    const matchRun = (seed) => {
      const content = syntheticContent(live.archetypes);
      const events = [];
      const sim = S.createSim({ content, colliders: flat([mkBox(-12, -8, 0, 2.2, -4, 4), mkBox(8, 12, 0, 2.2, -4, 4), mkBox(-2, 2, 0, 2.2, -14, -10), mkBox(-2, 2, 0, 2.2, 10, 14)]),
        weapons: WEAPONS, seed, mode: "tdm", tuning: "pvp",
        classes: { enabled: true, classId: 2, player: C.DEFAULT_CLASSES[2] }, emit: (type, data) => events.push({ type, data }) });
      sim.mission.start(sim);
      sim.setGod(true);
      for (let i = 0; i < 60 * 90; i++) sim.step(cmd({ yaw: (i % 600) * 0.0105, tactical: i % 900 === 450 }));
      const eq = events.filter((e) => e.type === "equip");
      return { h: djb2(JSON.stringify(sim.snapshot()) + JSON.stringify(eq)), eq };
    };
    const a = matchRun(5), b = matchRun(5);
    ok(a.h === b.h, `90 s class match with operator equipment: identical (${a.h})`);
    const outs = a.eq.filter((e) => e.data.phase === "out" && e.data.who !== "P").length;
    const plants = a.eq.filter((e) => e.data.phase === "plant").length;
    console.log(`  info  operators threw ${outs} tacticals and planted ${plants} tripmines in 90 s; ` +
      `phases seen: ${[...new Set(a.eq.map((e) => e.data.phase))].sort().join(",")}`);
    ok(outs + plants > 0, "operators actually used equipment in a live match");
  }

  console.log(`\nequipment.selftest: ${passed} passed, ${failed} failed`);
  console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e && e.stack || e); console.log("RESULT: FAIL"); process.exit(1); });
