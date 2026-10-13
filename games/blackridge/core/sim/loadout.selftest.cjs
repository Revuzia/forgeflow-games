#!/usr/bin/env node
/* core/sim/loadout.selftest.cjs — five-slot inventory, ground loot, shell-by-shell
 * reload, shotgun pellets, kill streaks + call-ins + medals, oriented colliders.
 * Run:  node core/sim/loadout.selftest.cjs     (exit 0 = all pass)
 * Headless / THREE-free, like sim.selftest.cjs.
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }

const CMD0 = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false,
  ads: false, reload: false, switchTo: null, interact: false, grenade: false, streak: 0 };
const cmd = (o) => Object.assign({}, CMD0, o);
const box = (x0, x1, y0, y1, z0, z1, surface, mat) => ({
  min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
  surface: surface || "concrete", matClass: mat || "hard" });
const flat = (boxes) => ({ boxes: boxes || [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 },
  cover: [], nodes: {}, bounds: { min: [-200, -5, -200], max: [200, 60, 200] } });

async function main() {
  const S = await import(u("core/sim/sim.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const W = await import(u("core/sim/world.js"));
  const L = await import(u("core/sim/loadout.js"));
  const ST = await import(u("core/sim/streaks.js"));
  const WEAPONS = WD.WEAPONS;

  const mk = (opts) => {
    const events = [];
    const sim = S.createSim(Object.assign({ colliders: flat(), weapons: WEAPONS, seed: 5,
      emit: (type, data) => events.push({ type, data }) }, opts || {}));
    sim.setGod(true);
    return { sim, events };
  };
  const run = (sim, n, c) => { for (let i = 0; i < n; i++) sim.step(c || cmd({})); };

  section("slot table");
  ok(WD.SLOT_COUNT === 5, "five slots");
  ok(WD.WEAPON_SLOT.warden === 1 && WD.WEAPON_SLOT.vesper === 2 && WD.WEAPON_SLOT.breaker === 3 &&
     WD.WEAPON_SLOT.corvus === 4 && WD.WEAPON_SLOT.pike === 5, "fixed class slots 1..5");
  ok(WEAPONS.breaker && WEAPONS.breaker.pellets === 9 && WEAPONS.breaker.class === "shotgun", "breaker is a 9-pellet shotgun");

  section("switching: keys 1-5, next/prev, last");
  {
    const { sim } = mk();
    const p = sim.state.player;
    ok(p.slots.length === 5 && p.slots[0] === "warden" && p.slots[4] === "pike" && p.slots[1] === null,
      "campaign loadout lands warden->slot1, pike->slot5");
    sim.step(cmd({ switchTo: "slot5" })); run(sim, 60);
    ok(p.weapon.id === "pike", "key 5 raises the Pike");
    sim.step(cmd({ switchTo: "slot2" })); run(sim, 60);
    ok(p.weapon.id === "pike", "key 2 on an EMPTY slot does nothing");
    sim.step(cmd({ switchTo: "last" })); run(sim, 60);
    ok(p.weapon.id === "warden", "Q swaps back to the last weapon");
    sim.step(cmd({ switchTo: "next" })); run(sim, 60);
    ok(p.weapon.id === "pike", "wheel next skips empty slots (warden -> pike)");
    sim.step(cmd({ switchTo: "prev" })); run(sim, 60);
    ok(p.weapon.id === "warden", "wheel prev wraps back");
  }

  section("loot: drop on kill, walk-over pick-up fills the weapon's own slot");
  {
    const { sim, events } = mk();
    const p = sim.state.player;
    const id = sim.spawnBot("rifleman", 0, -30, {});
    const bot = sim.state.bots.find((b) => b.id === id);
    bot.weapon.id = "vesper"; bot.weapon.mag = 11; bot.weapon.reserve = 90;
    sim.damage(id, 999, "test", "P");
    ok(sim.state.loot.length === 1 && sim.state.loot[0].weapon === "vesper", "a killed bot drops the gun it held");
    ok(sim.state.loot[0].mag === 11 && sim.state.loot[0].reserve === 64, "drop carries its remaining mag + <=2 mags of reserve");
    const it = sim.state.loot[0];
    sim.teleport("P", it.pos[0], 0, it.pos[2]);
    run(sim, 10);
    ok(!p.slots[1] && sim.state.loot.length === 1, "not armed for the first fraction of a second");
    run(sim, 40);
    ok(p.slots[1] === "vesper", "walking over it fills slot 2 (vesper)");
    ok(p.weapon.id === "warden", "...without yanking the rifle out of your hands (vesper is not better)");
    ok(sim.state.loot.length === 0, "the item is consumed");
    ok(events.some((e) => e.type === "pickup" && e.data.who === "P" && e.data.weaponId === "vesper"), "pickup event emitted");
    sim.step(cmd({ switchTo: "slot2" })); run(sim, 60);
    ok(p.weapon.id === "vesper" && p.weapon.mag === 11, "key 2 raises the looted vesper with ITS ammo (11 in the mag)");
  }

  section("loot: owned weapon -> ammo only, never past the cap, full -> item stays");
  {
    const { sim } = mk();
    const p = sim.state.player;
    sim.loot.spawn("warden", [0, 0, 0], { mag: 30, reserve: 60, ttl: 0 });
    sim.state.loot[0].armedAt = 0;
    p.weapon.reserve = 10; p._slotAmmo.warden = { mag: p.weapon.mag, reserve: 10 };
    run(sim, 5);
    ok(sim.state.loot.length === 0 && p.weapon.reserve > 10, "walking over a gun you own tops up its ammo");
    ok(p.weapon.reserve <= WEAPONS.warden.reserve + WEAPONS.warden.mag, "never past the weapon's reserve cap");
    p.weapon.reserve = WEAPONS.warden.reserve + WEAPONS.warden.mag; p._slotAmmo.warden.reserve = p.weapon.reserve;
    sim.loot.spawn("warden", [0, 0, 0], { ttl: 0 });
    sim.state.loot[0].armedAt = 0;
    run(sim, 5);
    ok(sim.state.loot.length === 1, "full on ammo -> the item is left on the floor");
  }

  section("shotgun: nine pellets per shell, pump cadence");
  {
    const { sim, events } = mk({ colliders: flat([box(-20, 20, 0, 10, -8.0, -7.5, "concrete", "hard")]) });
    sim.givePlayerWeapon("breaker");
    const p = sim.state.player;
    ok(p.weapon.id === "breaker" && p.slots[2] === "breaker", "give(breaker) equips it in slot 3");
    run(sim, 40);
    sim.step(cmd({ fire: true })); run(sim, 2);
    const shots = events.filter((e) => e.type === "shot" && e.data.shooter === "P" && !e.data.impactOnly && !e.data.pen);
    ok(shots.length === 9, "one trigger pull = 9 pellet shot events (got " + shots.length + ")");
    const impacts = events.filter((e) => e.type === "shot" && e.data.hit && e.data.hit.surface === "concrete");
    ok(impacts.length >= 8, "pellets land on the wall (" + impacts.length + " impacts)");
    ok(p.weapon.mag === 5, "one shell spent");
    const before = p.weapon.mag;
    sim.step(cmd({ fire: true })); // too soon: pump cycle 0.77 s
    ok(p.weapon.mag === before, "cannot fire again inside the pump cycle");
  }

  section("shotgun: shell-by-shell reload, interruptible");
  {
    const { sim, events } = mk();
    sim.givePlayerWeapon("breaker");
    const p = sim.state.player;
    p.weapon.mag = 2; p._slotAmmo.breaker = { mag: 2, reserve: p.weapon.reserve };
    run(sim, 40);
    sim.step(cmd({ reload: true }));
    ok(p.weapon.state === "reloading", "reload starts");
    run(sim, 40); // 0.67 s: first shell lands at 0.55 s
    ok(p.weapon.mag === 3, "first shell is in at ~0.55 s (mag " + p.weapon.mag + ")");
    run(sim, 35); // 1.25 s: second shell at 0.97 s
    ok(p.weapon.mag === 4, "next shell ~0.42 s later (mag " + p.weapon.mag + ")");
    const shellEvents = events.filter((e) => e.type === "reload" && e.data.phase === "shell").length;
    ok(shellEvents === 2, "one 'shell' reload event per shell (" + shellEvents + ")");
    sim.step(cmd({ fire: true })); run(sim, 2);
    ok(p.weapon.state !== "reloading" && p.weapon.mag === 3, "firing mid-reload cuts it short with the loaded shells (mag " + p.weapon.mag + ")");
    ok(events.some((e) => e.type === "reload" && e.data.phase === "done" && e.data.canceled), "cancel event emitted for the viewmodel");
    // full reload completes
    run(sim, 80);
    sim.step(cmd({ reload: true })); run(sim, 60 * 4);
    ok(p.weapon.mag === 6 && p.weapon.state === "idle", "left alone it finishes at a full tube (mag " + p.weapon.mag + ")");
  }

  section("kill streaks 3 / 5 / 10, medals, call-ins");
  {
    const { sim, events } = mk({ colliders: flat() });
    const p = sim.state.player;
    const kill = (n) => { for (let i = 0; i < n; i++) { const id = sim.spawnBot("rifleman", 0, -40, {}); sim.damage(id, 999, "test", "P"); } };
    kill(1); run(sim, 5);
    ok(sim.state.streak.count === 1 && sim.state.streak.stock.join() === "0,0,0", "1 kill: streak 1, nothing earned");
    kill(1);
    const medals = events.filter((e) => e.type === "medal").map((e) => e.data.text);
    ok(medals.indexOf("DOUBLE KILL") >= 0, "two kills inside 3.5 s -> DOUBLE KILL");
    kill(1);
    ok(sim.state.streak.stock[0] === 1 && events.some((e) => e.type === "streak" && e.data.phase === "earned" && e.data.id === "mortar"),
      "3rd kill earns the MORTAR STRIKE");
    ok(medals.concat(events.filter((e) => e.type === "medal").map((e) => e.data.text)).indexOf("3 KILL STREAK") >= 0, "3 KILL STREAK banner");
    kill(2);
    ok(sim.state.streak.stock[1] === 1, "5th kill earns the AIRSTRIKE");
    kill(5);
    ok(sim.state.streak.count === 10 && sim.state.streak.stock[2] === 1, "10th kill earns the ORBITAL BARRAGE (count " + sim.state.streak.count + ")");
    // call in the mortar on a bot standing 30 m ahead
    const victim = sim.spawnBot("rifleman", 0, -30, {});
    sim.aimAt(0, 0.0, -30);
    const hp0 = sim.state.bots.find((b) => b.id === victim).hp;
    const killsBefore = sim.state.streak.count;
    sim.step(cmd({ streak: 1, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    ok(sim.state.streak.stock[0] === 0, "using the mortar spends it");
    ok(events.some((e) => e.type === "streak" && e.data.phase === "call" && e.data.id === "mortar"), "call event with a target + ETA");
    run(sim, 60 * 6);
    const b = sim.state.bots.find((x) => x.id === victim);
    ok(!b.alive, "the mortar salvo kills the bot it was called on (hp " + hp0 + " -> " + b.hp + ")");
    ok(sim.state.streak.count === killsBefore, "a call-in's kills do NOT feed the streak");
    ok(p.hp === sim.tuning.maxHp, "your own strike never hurts you");
    const imp = events.filter((e) => e.type === "streak" && e.data.phase === "impact" && e.data.id === "mortar").length;
    ok(imp === 4, "4 mortar shells (" + imp + ")");
    // death resets the streak but keeps the earned call-ins
    sim.setGod(false);
    sim.damage("P", 9999, "test", null);
    ok(sim.state.streak.count === 0 && sim.state.streak.stock[1] === 1 && sim.state.streak.stock[2] === 1,
      "dying resets the count but keeps earned call-ins");
  }

  section("airstrike + orbital geometry");
  {
    const { sim, events } = mk({ colliders: flat() });
    sim.streaks.give(2, 1); sim.streaks.give(3, 1);
    sim.aimAt(0, 0, -30);
    sim.step(cmd({ streak: 2, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    sim.step(cmd({ streak: 3, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    run(sim, 60 * 10);
    const air = events.filter((e) => e.type === "streak" && e.data.phase === "impact" && e.data.id === "airstrike");
    const orb = events.filter((e) => e.type === "streak" && e.data.phase === "impact" && e.data.id === "orbital");
    ok(air.length === 7, "airstrike = 7 bombs (" + air.length + ")");
    const zs = air.map((e) => e.data.pos[2]);
    ok(Math.min(...zs) < -26 && Math.max(...zs) < -60 + 40 && (Math.max(...zs) - Math.min(...zs)) > 25, "bombs walk away from the player along the view line");
    ok(orb.length === 18, "orbital = 18 rounds (" + orb.length + ")");
    ok(events.filter((e) => e.type === "streak" && e.data.phase === "done").length === 2, "both flights finish");
  }

  section("oriented colliders (rotated props)");
  {
    // a 4.4 x 1.9 m car yawed 38 deg: its AABB owns empty corners, the OBB does not
    const rot = 38 * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
    const hx = 0.95, hz = 2.2;
    const ac = Math.abs(c), as = Math.abs(s);
    const ex = (ac * hx + as * hz), ez = (as * hx + ac * hz);
    const car = { min: [10 - ex, 0, 0 - ez], max: [10 + ex, 1.5, 0 + ez], surface: "metal", matClass: "metal_thin",
      kind: "car", obb: { cx: 10, cz: 0, c, s, hx, hz } };
    const world = W.makeWorld(flat([car]));
    // aim at the AABB corner: inside the bound, outside the car
    const corner = [10 + ex - 0.05, 0.7, 0 + ez - 0.05];
    const miss = world.raycast([corner[0] - 0.1, 0.7, corner[2] + 6], [0, 0, -1], 20);
    const hitC = world.raycast([10, 0.7, 6], [0, 0, -1], 20);
    // the ray enters the AABB's empty corner at z ~ ez; the OBB's own edge is ~1 m further in
    ok(!miss || Math.abs(miss.pos[2] - ez) > 0.5, "a ray through the empty AABB corner does not stop at the AABB face (hit z " + (miss ? miss.pos[2].toFixed(2) : "none") + " vs AABB face " + ez.toFixed(2) + ")");
    ok(hitC && hitC.box === car && Math.abs(hitC.normal[0] * hitC.normal[0] + hitC.normal[2] * hitC.normal[2] - 1) < 1e-6, "a ray through the car's middle hits it with a unit, rotated face normal");
    ok(world.capsuleBlocked(corner[0], 0, corner[2], 0.35, 1.8) === null, "a capsule can stand in the empty corner");
    ok(world.capsuleBlocked(10, 0, 0, 0.35, 1.8) !== null, "...but not through the car's middle");
  }

  console.log("\n" + "=".repeat(64));
  console.log(`loadout.selftest: ${passed} passed, ${failed} failed`);
  console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
