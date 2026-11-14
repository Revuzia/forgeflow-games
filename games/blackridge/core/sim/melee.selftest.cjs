#!/usr/bin/env node
/* core/sim/melee.selftest.cjs [melee lane] — the quick knife strike, headless.
 *
 * Covers: reach + lunge, cone, line of sight, timing (windup 0.12 s, recovery
 * 0.60 s), the damage rule (back-stab lethal / front 55% max HP = two hits),
 * kill credit (weaponId "knife", melee:true on the death event), interaction
 * with fire / ADS / reload / sprint / grenade cook, bot melee through cmd.melee,
 * no friendly lock, determinism (same script twice -> identical snapshot).
 *
 * Run: node core/sim/melee.selftest.cjs   (exit 0 = all pass)
 * The sims here have no content (phase "menu"): the AI is dormant, so bot.cmd is
 * exactly what the test writes — the bot melee path is the sim's, not a brain's.
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(16); }

const CMD0 = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false,
  ads: false, reload: false, switchTo: null, interact: false, grenade: false, melee: false };
const cmd = (o) => Object.assign({}, CMD0, o || {});
function cols(boxes) {
  return { boxes: boxes || [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 }, cover: [], nodes: {},
    bounds: { min: [-200, -5, -200], max: [200, 60, 200] } };
}

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const ML = await import(u("core/sim/melee.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const M = ML.MELEE;

  function mk(o) {
    const ev = [];
    const sim = S.createSim(Object.assign({ colliders: cols(), weapons: WD.WEAPONS, seed: 7,
      emit: (type, data) => ev.push({ t: sim ? sim.state.time : 0, type, data }) }, o || {}));
    return { sim, ev };
  }
  // player yaw 0 faces -Z. A bot at (0, 0, -d) is straight ahead.
  function bot(sim, x, z, yaw) { const id = sim.spawnBot("rifleman", x, z, { yaw }); const b = sim.state.bots.find((q) => q.id === id); b.cmd = Object.assign(cmd(), { yaw }); return b; }
  const of = (ev, type, ph) => ev.filter((e) => e.type === type && (!ph || (e.data && e.data.phase === ph)));
  function run(sim, n, c) { for (let i = 0; i < n; i++) sim.step(c ? (typeof c === "function" ? c(i) : c) : cmd()); }
  const press = (sim) => { sim.step(cmd({ melee: true })); };

  // ---------------------------------------------------------------- reach + back-stab
  section("reach + lunge + back-stab (lethal)");
  {
    const { sim, ev } = mk();
    const b = bot(sim, 0, -2.4, 0);            // facing -Z = AWAY from the player: we are behind him
    run(sim, 2);
    const t0 = sim.state.time;
    press(sim);
    const sw = of(ev, "melee", "swing")[0];
    ok(sw && sw.data.who === "P" && sw.data.target === b.id, "swing event on the press tick, target locked at 2.4 m (reach " + M.REACH_M + " m)");
    run(sim, 10);
    const hit = of(ev, "melee", "hit")[0];
    ok(hit && hit.data.victim === b.id && hit.data.backstab === true && hit.data.lethal === true, "strike from behind: back-stab, lethal");
    ok(hit && Math.abs(hit.t - t0 - (1 / 60) - M.WINDUP_S) <= 1 / 60 + 1e-9, `strike lands ${(hit ? hit.t - t0 - 1 / 60 : -1).toFixed(3)} s after the press (windup ${M.WINDUP_S} s)`);
    const dz = Math.abs(sim.state.player.pos[2] - b.pos[2]);
    ok(dz < 1.2 && dz > 0.6, `lunge closed 2.4 m to ${dz.toFixed(2)} m (stop ${M.STOP_M} m)`);
    ok(!b.alive, "victim dead after ONE strike from behind");
    const de = of(ev, "death")[0];
    ok(de && de.data.weaponId === "knife" && de.data.melee === true && de.data.attacker === "P" && de.data.backstab === true,
      "death event: weaponId 'knife', melee:true, backstab:true, attacker 'P'");
    const hu = of(ev, "hurt").find((e) => e.data.victim === b.id);
    ok(hu && hu.data.melee === true, "hurt event carries melee:true");
    ok(sim.state.counters.kills === 1, "kill counted for the human");
    ok(of(ev, "death").every((e) => "weaponId" in e.data), "every death event carries weaponId (additive)");
  }

  // ---------------------------------------------------------------- front: two hits
  section("front: 55% max HP per strike -> two strikes, recovery gates the second");
  {
    const { sim, ev } = mk();
    const b = bot(sim, 0, -1.8, Math.PI);       // facing +Z, toward the player
    run(sim, 2);
    const t0 = sim.state.time + 1 / 60;
    press(sim);
    run(sim, 10);
    const h1 = of(ev, "melee", "hit")[0];
    ok(h1 && h1.data.backstab === false && h1.data.lethal === false, "frontal strike: not a back-stab, not lethal from full");
    ok(b.alive && Math.abs(b.hp - (100 - 100 * M.FRONT_FRAC)) < 1e-6, `victim at ${b.hp} HP (100 - ${100 * M.FRONT_FRAC})`);
    // a press during recovery is buffered and fires the instant recovery ends
    while (sim.state.time < t0 + 0.50) sim.step(cmd());
    sim.step(cmd({ melee: true }));
    const swings = () => of(ev, "melee", "swing");
    ok(swings().length === 1, "no second swing inside the recovery window");
    while (sim.state.time < t0 + M.WINDUP_S + M.RECOVER_S + 0.02) sim.step(cmd());
    ok(swings().length === 2 && Math.abs(swings()[1].t - (t0 + M.WINDUP_S + M.RECOVER_S)) <= 1 / 60 + 1e-9,
      `buffered press lands at recovery end (${swings()[1] ? (swings()[1].t - t0).toFixed(3) : "-"} s; expected ${(M.WINDUP_S + M.RECOVER_S).toFixed(2)})`);
    run(sim, 10);
    ok(!b.alive, "second frontal strike kills (two hits from the front)");
  }

  // ---------------------------------------------------------------- pvp tuning: 110 HP
  section("pvp tuning (110 HP): still exactly two from the front");
  {
    const { sim } = mk({ tuning: "pvp" });
    const b = bot(sim, 0, -1.2, Math.PI);
    run(sim, 2); press(sim); run(sim, 50);
    ok(b.alive && Math.abs(b.hp - 110 * (1 - M.FRONT_FRAC)) < 1e-6, `first strike leaves ${b.hp.toFixed(1)} of 110 HP`);
    press(sim); run(sim, 12);
    ok(!b.alive, "second strike kills at 110 HP");
  }

  // ---------------------------------------------------------------- out of reach
  section("reach limit, cone limit, line of sight");
  {
    const { sim, ev } = mk();
    const b = bot(sim, 0, -(M.REACH_M + 0.4), Math.PI);
    run(sim, 2);
    const z0 = sim.state.player.pos[2];
    press(sim); run(sim, 12);
    ok(of(ev, "melee", "swing")[0].data.target === null, `${(M.REACH_M + 0.4).toFixed(1)} m: no lock`);
    ok(of(ev, "melee", "miss").length === 1 && b.hp === 100, "strike whiffs (miss event), no damage");
    ok(Math.abs(sim.state.player.pos[2] - z0) < 1e-6, "no lunge without a lock");
  }
  {
    const { sim, ev } = mk();
    const ang = (M.CONE_DEG + 8) * Math.PI / 180;     // 36 deg off the facing
    const b = bot(sim, -Math.sin(ang) * 2.0, -Math.cos(ang) * 2.0, Math.PI);
    run(sim, 2); press(sim); run(sim, 12);
    ok(of(ev, "melee", "swing")[0].data.target === null && b.hp === 100, `2.0 m but ${(M.CONE_DEG + 8)} deg off-axis: outside the ${M.CONE_DEG} deg cone, no lock, no hit`);
  }
  {
    const { sim, ev } = mk();
    const ang = (M.CONE_DEG - 8) * Math.PI / 180;
    const b = bot(sim, -Math.sin(ang) * 2.0, -Math.cos(ang) * 2.0, Math.PI);
    run(sim, 2); press(sim); run(sim, 12);
    ok(of(ev, "melee", "swing")[0].data.target === b.id && of(ev, "melee", "hit").length === 1, `${M.CONE_DEG - 8} deg off-axis: inside the cone, locked and hit`);
  }
  {
    // a wall (thin box, full height) between the player and a bot 1.2 m away
    const wall = { min: [-2, 0, -0.75], max: [2, 3, -0.6], surface: "concrete", matClass: "hard" };
    const { sim, ev } = mk({ colliders: cols([wall]) });
    const b = bot(sim, 0, -1.4, Math.PI);
    run(sim, 2); press(sim); run(sim, 12);
    const mi = of(ev, "melee", "miss")[0];
    ok(of(ev, "melee", "swing")[0].data.target === null && !of(ev, "melee", "hit").length && b.hp === 100,
      "wall between: no lock through it, no hit through it (LOS)");
    ok(mi && mi.data.surface === "concrete", "the miss reports the wall the blade met (surface 'concrete')");
  }

  // ---------------------------------------------------------------- interactions
  section("interactions: fire / ADS / reload / sprint / grenade");
  {
    const { sim, ev } = mk();
    run(sim, 2);
    const t0 = sim.state.time + 1 / 60;
    press(sim);
    let firedEarly = false, adsDuring = false;
    // hold fire + ADS through the whole strike; nothing may fire before recovery ends
    while (sim.state.time + 1 / 60 < t0 + M.WINDUP_S + M.RECOVER_S - 1e-6) {
      sim.step(cmd({ fire: true, ads: true }));
      if (of(ev, "shot").length) firedEarly = true;
      if (sim.state.player.weapon.ads) adsDuring = true;
    }
    ok(!firedEarly, "held trigger: no round during windup + recovery (0.72 s)");
    ok(!adsDuring, "ADS held: forced off for the whole strike");
    run(sim, 3, cmd({ fire: true, ads: true }));
    ok(of(ev, "shot").length >= 1, "the held trigger fires as soon as recovery ends");
  }
  {
    const { sim, ev } = mk();
    run(sim, 2);
    sim.setAmmo(3);
    sim.step(cmd({ reload: true }));
    run(sim, 5);
    ok(sim.state.player.weapon.state === "reloading", "reload started");
    press(sim);
    const can = of(ev, "reload").find((e) => e.data.canceled);
    ok(can && sim.state.player.weapon.state === "idle", "melee interrupts the reload (reload done/canceled event, weapon idle)");
    // a reload press late in the recovery (inside the 0.35 s buffer) waits for the
    // strike to finish, then starts
    const tp = sim.state.time;
    while (sim.state.time < tp + 0.45) sim.step(cmd());
    sim.step(cmd({ reload: true }));
    ok(sim.state.player.weapon.state !== "reloading", "no reload start during the strike");
    run(sim, 30);
    ok(sim.state.player.weapon.state === "reloading", "the buffered reload press starts as soon as recovery ends");
  }
  {
    const { sim } = mk();
    run(sim, 30, cmd({ moveZ: 1, sprint: true }));
    ok(sim.state.player._m.sprintState === "sprint", "sprinting");
    sim.step(cmd({ moveZ: 1, sprint: true, melee: true }));
    let sprintDuring = false;
    for (let i = 0; i < 40; i++) { sim.step(cmd({ moveZ: 1, sprint: true })); if (sim.state.player._m.sprintState !== "none") sprintDuring = true; }
    ok(!sprintDuring, "melee drops sprint and holds it off through recovery");
    run(sim, 10, cmd({ moveZ: 1, sprint: true }));
    ok(sim.state.player._m.sprintState === "sprint", "sprint resumes after the strike");
  }
  {
    const { sim, ev } = mk();
    run(sim, 2);
    sim.step(cmd({ grenade: true }));      // pin pulled: the frag is in the hand
    sim.step(cmd({ grenade: true, melee: true }));
    run(sim, 3, cmd({ grenade: true }));
    ok(of(ev, "melee").length === 0, "no knife while a cooked frag is in hand");
  }

  // ---------------------------------------------------------------- bots
  section("opponents: the same verb through bot.cmd.melee");
  {
    const { sim, ev } = mk();
    const b = bot(sim, 0, -2.0, Math.PI);   // facing the player
    run(sim, 2);
    b.cmd.melee = true;
    run(sim, 12);
    const sw = of(ev, "melee", "swing").find((e) => e.data.who === b.id);
    const hit = of(ev, "melee", "hit").find((e) => e.data.who === b.id);
    ok(sw && sw.data.target === "P", "bot swing locks the player");
    ok(hit && hit.data.victim === "P" && sim.state.player.hp === 100 - 100 * M.FRONT_FRAC, `bot strike: player at ${sim.state.player.hp} HP (front rule)`);
    const hu = of(ev, "hurt").find((e) => e.data.victim === "P");
    ok(hu && hu.data.melee === true && hu.data.attacker === b.id, "player hurt event: melee:true, attacker = the bot");
    run(sim, 60);
    ok(of(ev, "melee", "swing").filter((e) => e.data.who === b.id).length === 1, "held cmd.melee = one swing (edge-triggered)");
    b.cmd.melee = false; sim.step(cmd()); b.cmd.melee = true; run(sim, 12);
    ok(sim.state.player.alive === false, "second bot strike kills the player");
    const de = of(ev, "death").find((e) => e.data.victim === "P");
    ok(de && de.data.weaponId === "knife" && de.data.melee === true, "player death: weaponId 'knife', melee:true");
  }
  {
    const { sim, ev } = mk();
    const a = bot(sim, 5, 0, 0), c = bot(sim, 5, -1.5, 0);   // same team (campaign bots are team 1)
    run(sim, 2);
    a.cmd.melee = true; run(sim, 12);
    ok(of(ev, "melee", "swing")[0].data.target === null && c.hp === 100, "no lock on, no damage to, a teammate");
  }
  {
    const { sim, ev } = mk();
    sim.setGod(true);
    const b = bot(sim, 0, -1.0, Math.PI);
    run(sim, 2); b.cmd.melee = true; run(sim, 12);
    ok(of(ev, "melee", "hit").length === 1 && sim.state.player.hp === 100 && sim.state.player.alive, "god mode: the strike lands, no damage");
  }

  // ---------------------------------------------------------------- determinism
  section("determinism");
  function script(seed) {
    const { sim, ev } = mk({ seed });
    const b1 = bot(sim, 0.4, -2.2, 0.3), b2 = bot(sim, -1.5, -4.0, Math.PI);
    for (let i = 0; i < 240; i++) {
      if (i === 100) { b2.cmd.moveZ = 1; }
      if (i === 150) { b2.cmd.melee = true; }
      sim.step(cmd({ moveZ: i < 40 ? 0.5 : 0, melee: i === 5 || i === 60 || i === 120, fire: i > 200 && i % 9 === 0 }));
    }
    return { hash: djb2(JSON.stringify(sim.snapshot())), n: ev.filter((e) => e.type === "melee").map((e) => e.data.phase).join(","), b1 };
  }
  const A = script(3), B = script(3);
  ok(A.hash === B.hash && A.n === B.n, `same script twice -> identical snapshot hash (${A.hash}) and melee event sequence (${A.n})`);
  ok(!A.b1.alive, "scripted back-stab landed");

  console.log(`\nmelee.selftest: ${passed} passed, ${failed} failed`);
  console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
