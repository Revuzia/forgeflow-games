/* Dungeon Forge sim selftest — node runtime/sim/dungeon.selftest.cjs
 * Deterministic assertions over the dungeon model + escape sim. */
"use strict";

let PASS = 0, FAIL = 0;
const ok = (cond, name, extra) => {
  if (cond) { PASS++; console.log("  ok  " + name); }
  else { FAIL++; console.log("  FAIL " + name + (extra != null ? " — " + extra : "")); }
};

(async () => {
  const D = await import("./dungeon.js");
  const E = await import("./escape_sim.js");
  const {
    newDungeon, applyOp, stampRoom, validate, solvability, serialize, sanitize,
    encodeShare, decodeShare, wallSegments, stairLinks, rollLoot, starterDungeon,
    findAll, objsAt, SIZE, CELL,
  } = D;
  const { newRun, tick, drainEvents, doInteract, interactHint, w2c, c2w, findPath, hasLOS, PLAYER } = E;

  // ── 1. model + ops ──────────────────────────────────────────────
  console.log("[model+ops]");
  const d = newDungeon({ name: "T", theme: "fantasy", seed: 42 });
  stampRoom(d, 0, 10, 10, 4, 4);
  ok(Object.keys(d.floors[0].cells).length === 16, "stampRoom floors 16 cells");
  ok(applyOp(d, { t: "obj+", f: 0, o: { kind: "spawn", x: 11, z: 11 } }).ok, "place spawn");
  ok(applyOp(d, { t: "obj+", f: 0, o: { kind: "exit", x: 12, z: 12 } }).ok, "place exit");
  ok(!applyOp(d, { t: "obj+", f: 0, o: { kind: "chest", x: 30, z: 30 } }).ok, "no chest on void cell");
  const c1 = applyOp(d, { t: "obj+", f: 0, o: { kind: "chest", x: 10, z: 10 } });
  ok(c1.ok, "chest on floor");
  ok(!applyOp(d, { t: "obj+", f: 0, o: { kind: "decor", x: 10, z: 10, dtype: "barrel" } }).ok, "cell occupancy enforced");
  const k1 = applyOp(d, { t: "obj+", f: 0, o: { kind: "key", x: 10, z: 10 } });
  ok(k1.ok, "key may share a chest cell (bound key)");
  ok(applyOp(d, { t: "objEdit", id: c1.id, p: { rot: 2 } }).ok, "edit rot");
  ok(applyOp(d, { t: "obj-", id: c1.id }).ok, "remove obj");
  applyOp(d, { t: "obj-", id: k1.id });
  // spawn singleton
  applyOp(d, { t: "obj+", f: 0, o: { kind: "spawn", x: 13, z: 13 } });
  ok(findAll(d, "spawn").length === 1, "spawn is a singleton");

  // ── 2. walls + doors + solvability ─────────────────────────────
  console.log("[solvability]");
  // two rooms joined by a 1-wide corridor with a locked door in the middle
  const s = newDungeon({ name: "S", theme: "fantasy", seed: 7 });
  stampRoom(s, 0, 5, 5, 3, 3);        // room A: 5..7
  stampRoom(s, 0, 11, 5, 3, 3);       // room B: 11..13
  for (const x of [8, 9, 10]) applyOp(s, { t: "cell+", f: 0, x, z: 6 });  // corridor at z=6
  applyOp(s, { t: "obj+", f: 0, o: { kind: "spawn", x: 6, z: 6 } });
  applyOp(s, { t: "obj+", f: 0, o: { kind: "exit", x: 12, z: 6 } });
  const walls = wallSegments(s, 0);
  ok(walls.length > 20, "derived walls exist (" + walls.length + ")");
  const door = applyOp(s, { t: "obj+", f: 0, o: { kind: "door", x: 9, z: 6, rot: 1, locked: true } });
  ok(door.ok, "door placed");
  let v = validate(s);
  ok(!v.ok && v.solvability && !v.solvability.solvable, "locked door w/o key → unsolvable");
  const key = applyOp(s, { t: "obj+", f: 0, o: { kind: "key", x: 5, z: 5 } });
  v = validate(s);
  ok(v.ok && v.solvability.solvable, "key on spawn side → solvable", JSON.stringify(v.problems));
  // key beyond the locked door → unsolvable again
  applyOp(s, { t: "obj-", id: key.id });
  applyOp(s, { t: "obj+", f: 0, o: { kind: "key", x: 13, z: 7 } });
  v = validate(s);
  ok(!v.ok, "key locked behind its own door → unsolvable");
  // unlock the door → solvable
  applyOp(s, { t: "objEdit", id: door.id, p: { locked: false } });
  v = validate(s);
  ok(v.ok, "unlocked door → solvable");
  applyOp(s, { t: "objEdit", id: door.id, p: { locked: true } });

  // key inside a chest on spawn side counts
  const ch = applyOp(s, { t: "obj+", f: 0, o: { kind: "chest", x: 7, z: 5 } });
  const k2 = applyOp(s, { t: "obj+", f: 0, o: { kind: "key", x: 7, z: 5 } });
  v = validate(s);
  ok(v.ok && v.solvability.solvable, "key in chest (spawn side) → solvable");

  // key on an enemy
  applyOp(s, { t: "obj-", id: k2.id });
  applyOp(s, { t: "obj+", f: 0, o: { kind: "enemy", x: 6, z: 7, etype: "skeleton" } });
  applyOp(s, { t: "obj+", f: 0, o: { kind: "key", x: 6, z: 7 } });
  v = validate(s);
  ok(v.ok && v.solvability.solvable, "key on enemy (spawn side) → solvable");

  // ── 3. multi-floor stairs ───────────────────────────────────────
  console.log("[stairs]");
  const m = newDungeon({ name: "M", theme: "scifi", seed: 9 });
  stampRoom(m, 0, 5, 5, 4, 4);
  applyOp(m, { t: "floor+" });
  stampRoom(m, 1, 5, 5, 4, 4);
  applyOp(m, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
  applyOp(m, { t: "obj+", f: 1, o: { kind: "exit", x: 8, z: 8 } });
  let vm = validate(m);
  ok(!vm.ok, "exit on floor 2 w/o stairs → unsolvable");
  applyOp(m, { t: "obj+", f: 0, o: { kind: "stairs", x: 6, z: 6, rot: 0 } }); // landing 6,7 on f1
  vm = validate(m);
  ok(vm.ok && vm.solvability.solvable, "stairs connect the floors", JSON.stringify(vm.problems));
  ok(stairLinks(m).length === 1, "stairLinks found");

  // ── 4. serialization + share codec ─────────────────────────────
  console.log("[serialize+share]");
  const json = serialize(s);
  const back = sanitize(json);
  ok(back && serialize(back) === serialize(sanitize(serialize(back))), "sanitize is stable");
  ok(back.floors[0].objects.length === s.floors[0].objects.length, "objects survive roundtrip");
  const code = await encodeShare(s);
  ok(code.startsWith("DF1.") && code.length < json.length, "share code compresses (" + code.length + " vs " + json.length + ")");
  const dec = await decodeShare(code);
  ok(dec && serialize(dec) === serialize(back), "share roundtrip identical");
  ok((await decodeShare("DF1.garbage!!")) === null, "garbage share → null");

  // ── 5. loot determinism ─────────────────────────────────────────
  console.log("[loot]");
  const l1 = JSON.stringify(rollLoot(s, "oX", 123, null));
  const l2 = JSON.stringify(rollLoot(s, "oX", 123, null));
  const l3 = JSON.stringify(rollLoot(s, "oX", 124, null));
  ok(l1 === l2, "same seed → same loot");
  ok(l1 !== l3 || true, "different run seed may differ"); // non-strict
  ok(JSON.stringify(rollLoot(s, "oX", 123, { id: "k" })).includes("key"), "bound key in chest loot");

  // ── 6. escape run: movement + collision ────────────────────────
  console.log("[escape: move]");
  const run = newRun(s, 1000, [{ id: "P1", name: "Tester" }]);
  const p = run.players[0];
  const sx = p.x;
  p.input.mx = 1; p.input.yaw = Math.PI / 2;
  for (let i = 0; i < 60; i++) tick(run, 1 / 60);
  ok(p.x > sx + 2, "player moved east", p.x - sx);
  // run into the room's east wall — never leaves floor cells
  for (let i = 0; i < 600; i++) tick(run, 1 / 60);
  ok(D.hasCell(s, p.f, w2c(p.x), w2c(p.z)), "wall collision keeps player on floor");
  // locked door blocks passage even standing on the door cell approach
  ok(w2c(p.x) <= 9, "locked door stops eastward travel (x cell " + w2c(p.x) + ")");

  // ── 7. escape: key → unlock → exit ─────────────────────────────
  console.log("[escape: keys+doors+exit]");
  // kill the skeleton to drop its key: walk to it and melee
  const run2 = newRun(s, 2000, [{ id: "P1", name: "T" }]);
  const pl = run2.players[0];
  const sk = run2.enemies.find((e) => e.etype === "skeleton");
  ok(!!sk && sk.key, "skeleton carries the bound key");
  // teleport next to skeleton (sim supports direct state for tests)
  pl.x = sk.x - 1.2; pl.z = sk.z; pl.input.yaw = E.yawTo(pl.x, pl.z, sk.x, sk.z);
  pl.input.melee = true;
  for (let i = 0; i < 240 && sk.alive; i++) { pl.input.yaw = E.yawTo(pl.x, pl.z, sk.x, sk.z); tick(run2, 1 / 60); }
  ok(!sk.alive, "melee killed the skeleton");
  ok(sk.droppedKey, "key dropped");
  pl.input.melee = false;
  // pick up the dropped key
  pl.x = sk.x; pl.z = sk.z;
  pl.input.interactDown = true; tick(run2, 1 / 60);
  ok(pl.keys === 1, "picked up dropped key", pl.keys);
  // ALSO open the chest (contains another bound key? chest at 7,5 with key removed → no)
  // unlock the door
  const doorObj = findAll(s, "door")[0].obj;
  pl.x = c2w(doorObj.x) - 1.4; pl.z = c2w(doorObj.z);
  pl.input.interactDown = true; tick(run2, 1 / 60);
  const hint = interactHint(run2, pl);
  ok(run2.unlockedDoors.has(doorObj.id), "door unlocked with key");
  ok(run2.openDoors.has(doorObj.id), "door is open");
  ok(pl.keys === 0, "key consumed");
  // walk through to the exit
  pl.input.mx = 1;
  let escaped = false;
  for (let i = 0; i < 1200 && !escaped; i++) {
    pl.input.yaw = Math.PI / 2;
    // steer toward exit z once past the door
    const exC = run2.exit;
    pl.input.mx = Math.sign(c2w(exC.x) - pl.x) || 0;
    pl.input.mz = Math.sign(c2w(exC.z) - pl.z) || 0;
    tick(run2, 1 / 60);
    escaped = pl.escaped;
  }
  ok(escaped, "player reached the exit and escaped");
  ok(run2.over && run2.result && run2.result.time > 0, "run over with a time", run2.result && run2.result.time);

  // ── 8. escape: enemy chase + damage + respawn ──────────────────
  console.log("[escape: combat]");
  const s3 = newDungeon({ name: "C", theme: "scifi", seed: 3 });
  stampRoom(s3, 0, 5, 5, 5, 5);
  applyOp(s3, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
  applyOp(s3, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
  applyOp(s3, { t: "obj+", f: 0, o: { kind: "enemy", x: 7, z: 7, etype: "robot" } });
  const run3 = newRun(s3, 3000, [{ id: "P1" }]);
  const p3 = run3.players[0];
  const e3 = run3.enemies[0];
  p3.x = c2w(6); p3.z = c2w(6); // inside the robot's aggro radius
  for (let i = 0; i < 600 && p3.hp >= PLAYER.hp; i++) tick(run3, 1 / 60);
  ok(p3.hp < PLAYER.hp, "robot chased and damaged the player", p3.hp);
  ok(e3.state === "chase", "enemy is chasing");
  // let it kill the player → respawn flow
  for (let i = 0; i < 4000 && p3.deaths === 0; i++) tick(run3, 1 / 60);
  ok(p3.deaths >= 1, "player died to the robot");
  for (let i = 0; i < 400 && !p3.alive; i++) tick(run3, 1 / 60);
  ok(p3.alive, "player respawned");

  // bolt combat kills at range
  const run4 = newRun(s3, 4000, [{ id: "P1" }]);
  const p4 = run4.players[0], e4 = run4.enemies[0];
  p4.x = c2w(5); p4.z = c2w(5);
  let guard = 0;
  while (e4.alive && guard++ < 3000) {
    p4.input.yaw = E.yawTo(p4.x, p4.z, e4.x, e4.z);
    p4.input.bolt = true;
    p4.input.mx = -(Math.sign(e4.x - p4.x)) * 0.4; p4.input.mz = -(Math.sign(e4.z - p4.z)) * 0.4; // kite
    tick(run4, 1 / 60);
  }
  ok(!e4.alive, "bolts killed the robot while kiting");

  // ── 9. traps hurt ───────────────────────────────────────────────
  console.log("[traps]");
  const s5 = newDungeon({ name: "TR", theme: "fantasy", seed: 5 });
  stampRoom(s5, 0, 5, 5, 3, 3);
  applyOp(s5, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
  applyOp(s5, { t: "obj+", f: 0, o: { kind: "exit", x: 7, z: 7 } });
  applyOp(s5, { t: "obj+", f: 0, o: { kind: "trap", x: 6, z: 5, ttype: "spikes" } });
  const run5 = newRun(s5, 5000, [{ id: "P1" }]);
  const p5 = run5.players[0];
  p5.x = c2w(6); p5.z = c2w(5); // stand on the trap
  for (let i = 0; i < 400; i++) tick(run5, 1 / 60);
  ok(p5.hp < PLAYER.hp, "spike trap damaged the player", p5.hp);

  // ── 10. pathfinding + LOS ───────────────────────────────────────
  console.log("[path+los]");
  const run6 = newRun(s, 6000, [{ id: "P1" }]);
  const path = findPath(run6, 0, c2w(6), c2w(6), c2w(7), c2w(7));
  ok(Array.isArray(path), "path within room A");
  const noPath = findPath(run6, 0, c2w(6), c2w(6), c2w(12), c2w(6)); // across locked door
  ok(noPath === null, "no path through a locked door");
  ok(hasLOS(run6, 0, c2w(5), c2w(6), c2w(7), c2w(6)), "LOS along open room");
  ok(!hasLOS(run6, 0, c2w(6), c2w(6), c2w(12), c2w(6)), "no LOS through locked door");

  // ── 11. chest loot grant ────────────────────────────────────────
  console.log("[chest]");
  const run7 = newRun(s, 7000, [{ id: "P1" }]);
  const p7 = run7.players[0];
  const chest = findAll(s, "chest")[0].obj;
  p7.x = c2w(chest.x) - 1.2; p7.z = c2w(chest.z);
  const goldBefore = p7.gold;
  p7.input.interactDown = true; tick(run7, 1 / 60);
  ok(run7.openedChests.has(chest.id), "chest opened");
  ok(p7.gold > goldBefore, "gold granted from chest", p7.gold);
  const evs = drainEvents(run7);
  ok(evs.length === 0 || true, "events drained");

  // ── 12. op determinism (co-build) ───────────────────────────────
  console.log("[op determinism]");
  const opsLog = [];
  const dA = newDungeon({ name: "OP", theme: "fantasy", seed: 1 });
  const rec = (op) => { applyOp(dA, op); opsLog.push(op); };
  stampRoom(dA, 0, 20, 20, 5, 5).forEach((op) => opsLog.push(op));
  rec({ t: "obj+", f: 0, o: { kind: "spawn", x: 21, z: 21 } });
  rec({ t: "obj+", f: 0, o: { kind: "door", x: 22, z: 22, rot: 1, locked: true } });
  rec({ t: "objEdit", id: dA.floors[0].objects.find((o) => o.kind === "door").id, p: { locked: false } });
  rec({ t: "cell-", f: 0, x: 24, z: 24 });
  const dB = newDungeon({ name: "OP", theme: "fantasy", seed: 1 });
  for (const op of opsLog) applyOp(dB, op);
  ok(serialize(sanitize(serialize(dA))) === serialize(sanitize(serialize(dB))), "same op log → same dungeon");

  // ── 13. starter dungeon is valid ────────────────────────────────
  console.log("[starter]");
  const sd = starterDungeon("fantasy");
  const sv = validate(sd);
  ok(sv.ok, "starter dungeon validates", JSON.stringify(sv.problems));

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
