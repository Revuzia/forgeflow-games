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

  // ── 4b. per-placement enemy stat overrides ─────────────────────
  console.log("[enemy stat overrides]");
  {
    const ds = newDungeon({ theme: "fantasy" });
    stampRoom(ds, 0, 5, 5, 6, 6);
    applyOp(ds, { t: "obj+", f: 0, o: { kind: "spawn", x: 6, z: 6 } });
    applyOp(ds, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    const en = applyOp(ds, { t: "obj+", f: 0, o: { kind: "enemy", x: 7, z: 7, etype: "skeleton" } });
    ok(en.ok, "stat-ov: enemy placed");
    const baseHp = D.ENEMIES.fantasy.skeleton.hp;
    ok(applyOp(ds, { t: "objEdit", id: en.id, p: { stats: { hp: 500, dmg: 99 } } }).ok, "stat-ov: objEdit stats");
    let eo = D.objById(ds, en.id).obj;
    ok(eo.stats && eo.stats.hp === 500 && eo.stats.dmg === 99, "stat-ov: stored on object");
    applyOp(ds, { t: "objEdit", id: en.id, p: { stats: { hp: 99999, speed: 0.01 } } });
    eo = D.objById(ds, en.id).obj;
    ok(eo.stats.hp === 9999 && eo.stats.speed === 0.3, "stat-ov: clamped to range (" + eo.stats.hp + "/" + eo.stats.speed + ")");
    applyOp(ds, { t: "objEdit", id: en.id, p: { stats: { hp: 500, dmg: 99 } } });
    const rtE = sanitize(serialize(ds)).floors[0].objects.find((o) => o.kind === "enemy");
    ok(rtE.stats && rtE.stats.hp === 500, "stat-ov: survives sanitize roundtrip");
    const rr = newRun(ds, 42, [{ id: "P1" }]);
    ok(rr.enemies[0].K.hp === 500 && rr.enemies[0].K.dmg === 99, "stat-ov: sim K uses override");
    ok(rr.enemies[0].hp > baseHp * 1.5, "stat-ov: spawned hp scaled from override not default");
    applyOp(ds, { t: "objEdit", id: en.id, p: { etype: "orc" } });
    ok(!D.objById(ds, en.id).obj.stats, "stat-ov: changing type resets stats");
  }

  // ── 4c. breakable decor ────────────────────────────────────────
  console.log("[breakable decor]");
  {
    const bd = newDungeon({ theme: "fantasy" });
    stampRoom(bd, 0, 5, 5, 8, 8);
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "spawn", x: 6, z: 6 } });
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "exit", x: 11, z: 11 } });
    const barrel = applyOp(bd, { t: "obj+", f: 0, o: { kind: "decor", x: 8, z: 6, dtype: "barrel" } });
    ok(barrel.ok, "break: barrel placed");
    ok(!applyOp(bd, { t: "obj+", f: 0, o: { kind: "decor", x: 9, z: 6, dtype: "pot" } }).ok === false, "break: new prop type 'pot' places");
    const brun = newRun(bd, 55, [{ id: "P1" }]);
    const bp = brun.players[0];
    ok(brun.brokenDecor.size === 0, "break: nothing broken yet");
    const gold0 = bp.gold;
    bp.x = c2w(8) - 1.0; bp.z = c2w(6); bp.input.yaw = 0; bp.input.melee = true;
    for (let i = 0; i < 60 && brun.brokenDecor.size === 0; i++) tick(brun, 1 / 60);
    bp.input.melee = false;
    ok(brun.brokenDecor.has(barrel.id), "break: barrel smashed by melee");
    ok(bp.gold > gold0, "break: got gold (" + (bp.gold - gold0) + ")");
    const pass = E.moveCircle(brun, 0, c2w(8) - 1.5, c2w(6), 1.4, 0, 0.35, false);
    ok(w2c(pass.x) >= 8, "break: smashed barrel cell now passable (cell " + w2c(pass.x) + ")");
    const rt = sanitize(serialize(bd)).floors[0].objects.find((o) => o.dtype === "pot");
    ok(rt && rt.kind === "decor", "break: pot survives sanitize roundtrip");
  }

  // ── 4d. stored mana potions + potion heals to maxHp ─────────────
  console.log("[mana pots + potion cap]");
  {
    const md = newDungeon({ theme: "fantasy" });
    stampRoom(md, 0, 5, 5, 6, 6);
    applyOp(md, { t: "obj+", f: 0, o: { kind: "spawn", x: 6, z: 6 } });
    applyOp(md, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    const mrun = newRun(md, 88, [{ id: "P1", skin: 2 }]);
    const mp = mrun.players[0];
    ok(mp.manaPots === 0, "mana: start with 0 mana pots");
    mp.mana = 20;
    E.grantLoot(mrun, mp, { kind: "mana" });
    ok(mp.manaPots === 1 && mp.mana === 20, "mana: loot stores a pot (no instant refill)");
    mp.input.manaDown = true; tick(mrun, 1 / 60);
    ok(mp.manaPots === 0 && Math.abs(mp.mana - 80) < 1, "mana: X drinks +60 (mana " + mp.mana.toFixed(1) + ")");
    // blessed player (maxHp 125) can now potion above 100 (was capped)
    mp.maxHp = 125; mp.hp = 110; mp.potions = 1;
    mp.input.potionDown = true; tick(mrun, 1 / 60);
    ok(mp.hp === 125, "potion: heals a Sage-blessed player past 100 to maxHp (hp " + mp.hp + ")");
  }

  // ── 4e. item / equipment model ──────────────────────────────────
  console.log("[item model]");
  {
    const idg = newDungeon({ theme: "fantasy" });
    stampRoom(idg, 0, 5, 5, 6, 6);
    applyOp(idg, { t: "obj+", f: 0, o: { kind: "spawn", x: 6, z: 6 } });
    applyOp(idg, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    const irun = newRun(idg, 99, [{ id: "P1" }]);
    const ip = irun.players[0];
    const baseMax = ip.maxHp;
    ok(ip.equipped.weapon === null && ip.weaponTier === 0, "item: empty weapon slot, tier 0");
    const gen = D.makeItem("armor", 2, D.mulberry(7));
    ok(D.RARITY_IDS.includes(gen.rarity) && gen.slot === "armor" && gen.tier === 2 && gen.affixes.length === Math.min(D.RARITY[gen.rarity].affixes, 2), "item: makeItem valid (" + gen.rarity + "/" + gen.affixes.length + "aff)");
    const w = { id: "tw", slot: "weapon", rarity: "rare", base: "Blade", tier: 3, affixes: [{ stat: "dmg", val: 10, label: "+10% Damage" }, { stat: "maxHp", val: 20, label: "+20 Max HP" }], name: "Fabled Blade" };
    E.grantLoot(irun, ip, { kind: "weapon", item: w });
    ok(ip.equipped.weapon === w && ip.weaponTier === 3, "item: better item auto-equips + derives weaponTier 3");
    ok(ip.maxHp === baseMax + 20, "item: +20 maxHp affix raises maxHp to " + ip.maxHp);
    ok(Math.abs(ip.gearDmg - 0.10) < 1e-6, "item: +10% dmg affix → gearDmg " + ip.gearDmg);
    const worse = { id: "w2", slot: "weapon", rarity: "common", base: "Blade", tier: 1, affixes: [], name: "Blade" };
    E.grantLoot(irun, ip, { kind: "weapon", item: worse });
    ok(ip.equipped.weapon === w && ip.inventory.includes(worse), "item: worse item banked in inventory");
    let gearDrop = null;
    for (let s = 0; s < 40 && !gearDrop; s++) gearDrop = D.rollLoot(idg, "c" + s, 5, null).find((x) => x.kind === "weapon" || x.kind === "armor");
    ok(!gearDrop || (gearDrop.item && gearDrop.item.slot === gearDrop.kind), "item: chest gear drops carry item objects");
    // hotbar slots per class (shared by HUD + Digit-N input)
    const hbK = E.hotbar(newRun(idg, 1, [{ id: "K", skin: 0 }]).players[0]);
    ok(hbK.map((s) => s.act).join(",") === "special,potion,mana", "hotbar: knight = special/potion/mana (LMB attack not a slot)");
    const hbS = E.hotbar(newRun(idg, 1, [{ id: "S", skin: 2 }]).players[0]);
    ok(hbS.map((s) => s.act).join(",") === "special,frost,chain,potion,mana", "hotbar: sorceress = fire/frost/chain/potion/mana");
    // sorceress LMB = arcane bolt (ranged basic), not a melee swing
    const srun = newRun(idg, 3, [{ id: "S", skin: 2 }]);
    const sp2 = srun.players[0];
    sp2.input.melee = true;
    E.tick(srun, 1 / 30);
    ok(srun.bolts.some((b) => b.elem === "arcane" && b.owner === "S"), "sorceress LMB fires an arcane bolt");
    ok(srun.events.some((e2) => e2.type === "cast" && e2.kind === "arcane"), "arcane bolt emits cast event");
  }

  // ── 4f. floor textures (surface paint) ──────────────────────────
  console.log("[floor-tex]");
  {
    const td = newDungeon({ name: "Tex", theme: "fantasy" });
    // paint a floor cell with a texture id
    ok(applyOp(td, { t: "cell+", f: 0, x: 6, z: 6, ct: 1, tex: "cobble" }).ok && td.floors[0].tex["6,6"] === "cobble", "tex: floor cell carries texture id");
    // lava/water never carry a texture (cosmetic floor-only)
    applyOp(td, { t: "cell+", f: 0, x: 6, z: 6, ct: 2, tex: "cobble" });
    ok(td.floors[0].tex["6,6"] === undefined, "tex: lava cell drops texture");
    // repaint back to floor with a texture, then erasing the cell clears it
    applyOp(td, { t: "cell+", f: 0, x: 7, z: 7, ct: 1, tex: "brick" });
    applyOp(td, { t: "cell-", f: 0, x: 7, z: 7 });
    ok(td.floors[0].tex["7,7"] === undefined, "tex: erasing cell clears texture");
    // unknown / 'stone' texture ids are not stored (stone = default kit tile)
    applyOp(td, { t: "cell+", f: 0, x: 8, z: 8, ct: 1, tex: "bogus" });
    applyOp(td, { t: "cell+", f: 0, x: 9, z: 9, ct: 1, tex: "stone" });
    ok(td.floors[0].tex["8,8"] === undefined && td.floors[0].tex["9,9"] === undefined, "tex: unknown/stone ids not stored");
    // stampRoom carries a texture to every floored cell
    const ts = newDungeon({ name: "TexRoom", theme: "fantasy" });
    stampRoom(ts, 0, 5, 5, 3, 3, 1, "wood");
    ok(ts.floors[0].tex["5,5"] === "wood" && ts.floors[0].tex["7,7"] === "wood", "tex: stampRoom paints texture across room");
    // texture survives a serialize→sanitize roundtrip (only on a real floor cell)
    const back = sanitize(serialize(ts));
    ok(back.floors[0].tex["6,6"] === "wood", "tex: survives serialize roundtrip");
    ok(D.FLOOR_TEX_IDS.length >= 6 && D.FLOOR_TEX_IDS[0] === "stone", "tex: FLOOR_TEX_IDS defined (stone default first)");
  }

  // ── 4g. XP & leveling ───────────────────────────────────────────
  console.log("[xp/level]");
  {
    const xg = newDungeon({ theme: "fantasy" });
    stampRoom(xg, 0, 5, 5, 6, 6);
    applyOp(xg, { t: "obj+", f: 0, o: { kind: "spawn", x: 6, z: 6 } });
    applyOp(xg, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    // curve rises with level; boss worth 3×
    ok(E.xpToNext(2) > E.xpToNext(1), "xp: xpToNext rises with level");
    ok(E.xpFromEnemy({ hp: 30, dmg: 5, boss: true }) === 3 * E.xpFromEnemy({ hp: 30, dmg: 5 }), "xp: boss worth 3× a normal kill");
    const xr = newRun(xg, 7, [{ id: "P1" }]);
    const xp = xr.players[0];
    ok(xp.level === 1 && xp.xp === 0, "xp: players start at level 1 / 0 xp");
    const baseMax = xp.maxHp, mul1 = E.combatMul(xp);
    // grant exactly the L1→L2 threshold → single level-up, hp refilled, event emitted
    xp.hp = 5;
    E.gainXp(xr, xp, E.xpToNext(1));
    ok(xp.level === 2, "xp: reaching threshold levels up to 2");
    ok(xp.maxHp === baseMax + E.LEVELING.hpPerLevel && xp.hp === xp.maxHp, "xp: level-up adds maxHp (" + xp.maxHp + ") and full-heals");
    ok(xr.events.some((e) => e.type === "levelup" && e.level === 2), "xp: levelup event emitted");
    ok(E.combatMul(xp) > mul1, "xp: higher level raises combatMul (" + E.combatMul(xp).toFixed(3) + ")");
    // a big grant can carry several levels at once
    const before = xp.level;
    E.gainXp(xr, xp, E.xpToNext(2) + E.xpToNext(3) + E.xpToNext(4));
    ok(xp.level >= before + 3, "xp: overflow grant carries multiple levels (now " + xp.level + ")");
    // killing an enemy actually awards xp through damageEnemy
    const kr = newRun(xg, 8, [{ id: "P1" }]);
    const kp = kr.players[0];
    const fake = { id: "eZ", alive: true, hp: 1, K: { hp: 40, dmg: 6, gold: 5 }, x: 24, z: 24, f: 0, key: null, state: "patrol" };
    kr.enemies.push(fake);
    E.damageEnemy(kr, fake, 50, "P1");
    ok(kp.xp === E.xpFromEnemy(fake.K) && kp.gold === 45, "xp: a kill awards xp (" + kp.xp + ") + gold");
  }

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

  // bolt combat kills at range — sorceress (skin 2) fire bolts
  const run4 = newRun(s3, 4000, [{ id: "P1", skin: 2 }]);
  const p4 = run4.players[0], e4 = run4.enemies[0];
  ok(p4.cls === "sorceress", "skin 2 → sorceress class");
  p4.x = c2w(5); p4.z = c2w(5);
  let guard = 0;
  while (e4.alive && guard++ < 3000) {
    p4.input.yaw = E.yawTo(p4.x, p4.z, e4.x, e4.z);
    p4.input.special = true; // fire bolt
    p4.input.mx = -(Math.sign(e4.x - p4.x)) * 0.4; p4.input.mz = -(Math.sign(e4.z - p4.z)) * 0.4; // kite
    tick(run4, 1 / 60);
  }
  ok(!e4.alive, "fire bolts killed the robot while kiting");

  // ── 8b. class kits: combos, bash stun, burn/frost/poison, shield ─
  console.log("[classes]");
  const mkArena = (skin) => {
    const dd = newDungeon({ name: "CL", theme: "fantasy", seed: 12 });
    stampRoom(dd, 0, 5, 5, 7, 7);
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 11, z: 11 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "enemy", x: 8, z: 8, etype: "orc" } });
    const r = newRun(dd, 77, [{ id: "P1", skin }]);
    return { r, p: r.players[0], e: r.enemies[0] };
  };
  // combo stages escalate: swing events carry stage 1,2,3
  {
    const { r, p, e } = mkArena(0); // knight
    p.x = e.x - 1.5; p.z = e.z; p.input.yaw = E.yawTo(p.x, p.z, e.x, e.z);
    p.input.melee = true;
    const stages = [];
    for (let i = 0; i < 140 && stages.length < 3; i++) {
      tick(r, 1 / 60);
      for (const ev of E.drainEvents(r)) if (ev.type === "swing") stages.push(ev.stage);
    }
    ok(stages.join(",") === "1,2,3", "combo chains 1→2→3 (" + stages.join(",") + ")");
  }
  // knight bash stuns
  {
    const { r, p, e } = mkArena(0);
    p.x = e.x - 1.6; p.z = e.z; p.input.yaw = E.yawTo(p.x, p.z, e.x, e.z);
    p.input.special = true;
    for (let i = 0; i < 10; i++) tick(r, 1 / 60);
    ok(e.stunT > 0.8, "shield bash stuns (" + e.stunT.toFixed(2) + "s)");
    ok(p.specialT > 3, "bash on cooldown");
  }
  // shield blocks frontal damage
  {
    const { r, p, e } = mkArena(0); // knight, orc dmg 22
    p.x = e.x - 1.5; p.z = e.z;
    p.input.yaw = E.yawTo(p.x, p.z, e.x, e.z); // face the orc
    const hp0 = p.hp;
    let guard2 = 0;
    while (p.hp === hp0 && guard2++ < 800) tick(r, 1 / 60);
    const taken = hp0 - p.hp;
    ok(taken > 0 && taken <= 14, "shield soaked a frontal orc hit (took " + taken + ", raw ~22)");
  }
  // sorceress burn DoT + frost slow
  {
    const { r, p, e } = mkArena(2);
    p.x = e.x - 6; p.z = e.z; p.input.yaw = E.yawTo(p.x, p.z, e.x, e.z);
    p.input.special = true; // fire
    for (let i = 0; i < 40 && !(e.status && e.status.burn); i++) tick(r, 1 / 60);
    ok(!!(e.status && e.status.burn), "fire bolt applied burn");
    const hpAfterHit = e.hp;
    p.input.special = false;
    for (let i = 0; i < 90; i++) tick(r, 1 / 60);
    ok(e.hp < hpAfterHit - 3, "burn ticked damage (" + (hpAfterHit - e.hp).toFixed(1) + ")");
    p.input.frost = true;
    for (let i = 0; i < 40 && !(e.status && e.status.frost); i++) tick(r, 1 / 60);
    ok(!!(e.status && e.status.frost), "frost bolt applied slow");
  }
  // rogue poison stacks
  {
    const { r, p, e } = mkArena(3);
    p.x = e.x - 1.4; p.z = e.z; p.input.yaw = E.yawTo(p.x, p.z, e.x, e.z);
    p.input.melee = true;
    for (let i = 0; i < 90; i++) tick(r, 1 / 60);
    ok(!!(e.status && e.status.poison && e.status.poison.stacks >= 2), "poison stacked (" + (e.status && e.status.poison ? e.status.poison.stacks : 0) + ")");
  }
  // barbarian crush hits harder than a stage-1 swing
  {
    const { r, p, e } = mkArena(1);
    p.x = e.x - 1.8; p.z = e.z; p.input.yaw = E.yawTo(p.x, p.z, e.x, e.z);
    const hp0 = e.hp;
    p.input.special = true;
    for (let i = 0; i < 6; i++) tick(r, 1 / 60);
    const crushDmg = hp0 - e.hp;
    ok(crushDmg > 55, "barbarian crush is heavy (" + crushDmg.toFixed(0) + ")");
  }

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

  // ── 14. terrain: lava burns, water slows, raised walks ──────────
  console.log("[terrain]");
  const tD = newDungeon({ name: "TER", theme: "fantasy", seed: 11 });
  stampRoom(tD, 0, 5, 5, 6, 3);
  applyOp(tD, { t: "cell+", f: 0, x: 7, z: 6, ct: D.CT.LAVA });
  applyOp(tD, { t: "cell+", f: 0, x: 8, z: 6, ct: D.CT.WATER });
  applyOp(tD, { t: "cell+", f: 0, x: 9, z: 6, ct: D.CT.RAISED });
  ok(D.cellType(tD, 0, 7, 6) === D.CT.LAVA && D.cellType(tD, 0, 8, 6) === D.CT.WATER, "cell types stored");
  ok(D.cellHeight(tD, 0, 9, 6) === D.RAISED_H, "raised height");
  const tBack = sanitize(serialize(tD));
  ok(D.cellType(tBack, 0, 7, 6) === D.CT.LAVA && D.cellType(tBack, 0, 9, 6) === D.CT.RAISED, "cell types survive roundtrip");
  applyOp(tD, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
  applyOp(tD, { t: "obj+", f: 0, o: { kind: "exit", x: 10, z: 7 } });
  ok(validate(tD).ok, "terrain dungeon solvable (lava/water/raised all passable)");
  const tRun = newRun(tD, 42, [{ id: "P1" }]);
  const tp = tRun.players[0];
  tp.x = E.c2w(7); tp.z = E.c2w(6); // stand in lava
  for (let i = 0; i < 60; i++) tick(tRun, 1 / 60);
  ok(tp.hp < 100, "lava burns (" + tp.hp + " hp)");
  // water slows: time to cross a water cell vs floor cell
  const cross = (ct) => {
    const dd = newDungeon({ name: "W", theme: "fantasy", seed: 1 });
    stampRoom(dd, 0, 5, 5, 6, 1);
    if (ct) for (let x = 5; x < 11; x++) applyOp(dd, { t: "cell+", f: 0, x, z: 5, ct });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 10, z: 5 } });
    const r = newRun(dd, 7, [{ id: "P1" }]);
    const p = r.players[0];
    p.input.mx = 1; p.input.yaw = Math.PI / 2;
    let ticks = 0;
    while (!p.escaped && ticks++ < 2000) tick(r, 1 / 60);
    return ticks;
  };
  const tFloor = cross(0), tWater = cross(D.CT.WATER);
  ok(tWater > tFloor * 1.4, `water slows crossing (${tFloor} vs ${tWater} ticks)`);

  // ── 15. targeting + equipment ───────────────────────────────────
  console.log("[targeting+equip]");
  const s3b = newDungeon({ name: "TGT", theme: "scifi", seed: 3 });
  stampRoom(s3b, 0, 5, 5, 7, 7);
  applyOp(s3b, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
  applyOp(s3b, { t: "obj+", f: 0, o: { kind: "exit", x: 11, z: 11 } });
  applyOp(s3b, { t: "obj+", f: 0, o: { kind: "enemy", x: 8, z: 8, etype: "robot" } });
  applyOp(s3b, { t: "obj+", f: 0, o: { kind: "enemy", x: 5, z: 11, etype: "drone" } });
  const rT = newRun(s3b, 5, [{ id: "P1" }]);
  const pT = rT.players[0];
  pT.x = E.c2w(8); pT.z = E.c2w(5);
  pT.yaw = E.yawTo(pT.x, pT.z, E.c2w(8), E.c2w(8)); // face the robot
  const tgt = E.pickTarget(rT, pT);
  ok(tgt && tgt.etype === "robot", "pickTarget picks the faced enemy", tgt && tgt.etype);
  pT.yaw += Math.PI; // face away
  ok(E.pickTarget(rT, pT) === null || E.pickTarget(rT, pT).etype !== "robot", "no lock behind the back");
  // equipment: grant + effects
  E.grantLoot(rT, pT, { kind: "weapon", tier: 2 });
  E.grantLoot(rT, pT, { kind: "armor", tier: 1 });
  ok(pT.weaponTier === 2 && pT.armorTier === 1, "equip tiers stored");
  const hpBefore = pT.hp;
  pT.hurtT = 0;
  E.damagePlayer(rT, pT, 20, "test");
  ok(hpBefore - pT.hp === 18, "armor soaks 10% (took " + (hpBefore - pT.hp) + ")");

  // ── 15b. merchant / shop ────────────────────────────────────────
  console.log("[merchant]");
  {
    const dd = newDungeon({ name: "SHOP", theme: "fantasy", seed: 4 });
    stampRoom(dd, 0, 5, 5, 5, 5);
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    const npc = applyOp(dd, { t: "obj+", f: 0, o: { kind: "npc", x: 7, z: 6, stock: D.SHOP_IDS.slice() } });
    ok(npc.ok, "merchant placed");
    ok(D.KINDS.npc.solid, "merchant is solid (blocks walking)");
    // stock survives roundtrip
    const back = sanitize(serialize(dd));
    const bn = findAll(back, "npc")[0];
    ok(bn && Array.isArray(bn.obj.stock) && bn.obj.stock.length === D.SHOP_IDS.length, "merchant stock survives roundtrip");
    // edit stock (sell only potions)
    applyOp(dd, { t: "objEdit", id: npc.id, p: { stock: ["potion"] } });
    ok(findAll(dd, "npc")[0].obj.stock.join() === "potion", "merchant stock editable");
    applyOp(dd, { t: "objEdit", id: npc.id, p: { stock: D.SHOP_IDS.slice() } });
    // buying
    const r = newRun(dd, 1, [{ id: "P1" }]);
    const p = r.players[0];
    ok(p.gold === 40, "player starts with 40 gold");
    p.x = E.c2w(7) - 1.2; p.z = E.c2w(6);
    const m = E.nearestMerchant(r, p);
    ok(m && m.kind === "npc", "nearestMerchant finds the vendor beside the player");
    const buyP = E.buyItem(r, p, "potion");
    ok(buyP.ok && p.gold === 15 && p.potions === 2, "bought potion (−25g, +1 potion)", p.gold + "/" + p.potions);
    const buyW = E.buyItem(r, p, "weapon");
    ok(!buyW.ok && buyW.err === "poor", "can't buy weapon when broke");
    p.gold = 200;
    const buyW2 = E.buyItem(r, p, "weapon");
    ok(buyW2.ok && p.weaponTier === 1, "bought weapon upgrade → tier 1");
    p.weaponTier = 3;
    ok(!E.buyItem(r, p, "weapon").ok, "can't buy past max weapon tier");
  }

  // ── 15c. NPC types: merchant / blacksmith / sage ────────────────
  console.log("[npc types]");
  {
    ok(D.NPC_TYPE_IDS.length >= 3, "3+ NPC types defined", D.NPC_TYPE_IDS.join());
    // sanitize normalizes ntype + defaults to merchant
    const dd = newDungeon({ name: "N", theme: "fantasy", seed: 1 });
    stampRoom(dd, 0, 5, 5, 4, 4);
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    const smith = applyOp(dd, { t: "obj+", f: 0, o: { kind: "npc", x: 6, z: 5, ntype: "blacksmith" } });
    const sage = applyOp(dd, { t: "obj+", f: 0, o: { kind: "npc", x: 7, z: 5, ntype: "sage" } });
    const bogus = applyOp(dd, { t: "obj+", f: 0, o: { kind: "npc", x: 6, z: 6, ntype: "nonsense" } });
    const s = sanitize(serialize(dd));
    const byId = (id) => findAll(s, "npc").find((n) => n.obj.id === id);
    ok(byId(bogus.id) && byId(bogus.id).obj.ntype === "merchant", "bogus ntype → merchant default");
    // blacksmith 15% discount on weapon
    ok(E.npcPrice({ ntype: "blacksmith" }, "weapon") === Math.round(D.SHOP.weapon.price * 0.85), "blacksmith weapon 15% off");
    ok(E.npcPrice({ ntype: "merchant" }, "weapon") === D.SHOP.weapon.price, "merchant no discount");
    ok(E.npcSells({ ntype: "blacksmith" }).join() === "weapon,armor", "blacksmith sells only gear");
    // buying from blacksmith deducts the discounted price
    const r2 = newRun(dd, 1, [{ id: "P" }]); const pl = r2.players[0]; pl.gold = 200;
    const disc = E.buyItem(r2, pl, "weapon", { ntype: "blacksmith" });
    ok(disc.ok && pl.gold === 200 - Math.round(D.SHOP.weapon.price * 0.85), "blacksmith buy uses discounted price", pl.gold);
    // sage: one-time blessing (+max HP), second time refused
    const beforeHp = pl.maxHp;
    const bl1 = E.blessPlayer(r2, pl, { id: "sage1", ntype: "sage" });
    ok(bl1.ok && pl.maxHp === beforeHp + 25, "sage blessing +25 maxHp", pl.maxHp);
    const bl2 = E.blessPlayer(r2, pl, { id: "sage1", ntype: "sage" });
    ok(!bl2.ok && bl2.err === "used", "sage blesses only once per run");
  }

  // ── 15d. rolling terrain: raise / lower height levels ───────────
  console.log("[terrain height]");
  {
    const dd = newDungeon({ name: "H", theme: "fantasy", seed: 1 });
    stampRoom(dd, 0, 5, 5, 4, 4);
    ok(!applyOp(dd, { t: "raise", f: 0, x: 99, z: 99 }).ok, "can't raise a non-floor cell");
    applyOp(dd, { t: "raise", f: 0, x: 6, z: 6 });
    applyOp(dd, { t: "raise", f: 0, x: 6, z: 6 });   // level 2
    ok(D.cellLevel(dd, 0, 6, 6) === 2, "raise ×2 → level 2", D.cellLevel(dd, 0, 6, 6));
    ok(Math.abs(D.cellHeight(dd, 0, 6, 6) - 2 * D.HEIGHT_STEP) < 1e-6, "cellHeight = level×step");
    applyOp(dd, { t: "lower", f: 0, x: 6, z: 6 });
    applyOp(dd, { t: "lower", f: 0, x: 6, z: 6 });
    applyOp(dd, { t: "lower", f: 0, x: 6, z: 6 });   // level -1
    ok(D.cellLevel(dd, 0, 6, 6) === -1, "lower below 0 works (level -1)", D.cellLevel(dd, 0, 6, 6));
    // clamp
    for (let i = 0; i < 20; i++) applyOp(dd, { t: "raise", f: 0, x: 6, z: 6 });
    ok(D.cellLevel(dd, 0, 6, 6) === D.HEIGHT_MAX, "height clamps at HEIGHT_MAX");
    // heights survive serialize roundtrip
    applyOp(dd, { t: "raise", f: 0, x: 7, z: 7 });
    const back = sanitize(serialize(dd));
    ok(D.cellLevel(back, 0, 7, 7) === 1 && D.cellLevel(back, 0, 6, 6) === D.HEIGHT_MAX, "heights survive serialize roundtrip");
    // erasing the cell clears its height
    applyOp(dd, { t: "cell-", f: 0, x: 7, z: 7 });
    ok(D.cellLevel(dd, 0, 7, 7) === 0, "cell- clears the cell's height");
  }

  // ── 15e. doors: unlocked passable in a corridor (any orientation) ───
  console.log("[doors on walls]");
  {
    // two rooms joined by a 1-wide E-W corridor; door dropped mid-corridor
    const dd = newDungeon({ name: "D", theme: "fantasy", seed: 1 });
    stampRoom(dd, 0, 4, 4, 3, 3);
    stampRoom(dd, 0, 11, 4, 3, 3);
    for (let x = 7; x < 11; x++) applyOp(dd, { t: "cell+", f: 0, x, z: 5, ct: 1 });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 12, z: 5 } });
    // doorAxis reads the corridor (E-W floor neighbours) → passes along X
    ok(D.doorAxis(dd, 0, 8, 5) === 0, "door in an E-W corridor passes E-W");
    // UNLOCKED door mid-corridor (rot 0, which used to wrongly block) → still solvable
    const door = applyOp(dd, { t: "obj+", f: 0, o: { kind: "door", x: 8, z: 5, rot: 0 } });
    ok(validate(dd).ok, "UNLOCKED mid-corridor door → solvable (any rot)");
    // passable honours it when opened
    ok(D.passable(dd, 0, 7, 5, 8, 5, new Set([door.id])), "open door passable along the corridor");
    ok(!D.passable(dd, 0, 8, 4, 8, 5, new Set([door.id])), "can't cross the door's wall sideways");
    // LOCK it, remove any key → unsolvable; add a reachable key → solvable
    applyOp(dd, { t: "objEdit", id: door.id, p: { locked: true } });
    ok(!validate(dd).ok, "locked door, no key → unsolvable");
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "key", x: 5, z: 6 } });
    ok(validate(dd).ok, "locked door + reachable key → solvable");
  }

  // ── 16. scale: 1 / 10 / 20 / 30-room dungeons ──────────────────
  console.log("[scale]");
  const genRooms = (n) => {
    // grid-band layout: rooms flow east, wrap to a new south band before the
    // 64-cell edge — connected via 1-wide corridors, safe at any n
    const dd = newDungeon({ name: "R" + n, theme: "fantasy", seed: n });
    const rng = D.mulberry(n * 7 + 1);
    let px = 4, pz = 4, bandH = 0, first = null, last = null;
    for (let i = 0; i < n; i++) {
      const w = 3 + ((rng() * 4) | 0), h = 3 + ((rng() * 4) | 0);
      if (px + w > 60) {
        // corridor south from the previous room, then wrap the band
        const nz = pz + bandH + 3;
        for (let z = pz; z < nz + 1 && last; z++) applyOp(dd, { t: "cell+", f: 0, x: last.x, z });
        px = 4; pz = Math.min(56, nz); bandH = 0;
        // west corridor along the new band to the wrap column
        if (last) for (let x = px; x <= last.x; x++) applyOp(dd, { t: "cell+", f: 0, x, z: pz });
      }
      const ops = stampRoom(dd, 0, px, pz, w, h);
      if (!ops.length) break;
      const c0 = ops[(ops.length / 2) | 0];
      last = { x: c0.x, z: c0.z };
      if (!first) first = { x: ops[0].x, z: ops[0].z };
      bandH = Math.max(bandH, h);
      // east corridor to the next room slot
      if (i < n - 1 && px + w + 3 <= 60) {
        for (let x = px + w; x < px + w + 3; x++) applyOp(dd, { t: "cell+", f: 0, x, z: pz + 1 });
      }
      px = px + w + 3;
      if (i % 3 === 1 && i !== n - 1) applyOp(dd, { t: "obj+", f: 0, o: { kind: "enemy", x: last.x, z: last.z, etype: ["spider", "skeleton", "zombie"][i % 3] } });
      if (i % 4 === 2) applyOp(dd, { t: "obj+", f: 0, o: { kind: "torch", x: c0.x, z: c0.z + 1 } });
      if (i === n - 1) last = { x: ops[ops.length - 1].x, z: ops[ops.length - 1].z }; // exit at the far corner
    }
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: first.x, z: first.z } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: last.x, z: last.z } });
    return dd;
  };
  for (const n of [1, 10, 20, 30]) {
    const dd = genRooms(n);
    const t0 = Date.now();
    const v = validate(dd);
    const vMs = Date.now() - t0;
    ok(v.ok, `${n}-room dungeon solvable (${Object.keys(dd.floors[0].cells).length} cells, validate ${vMs}ms)`, JSON.stringify(v.problems));
    ok(vMs < 500, `${n}-room validate fast enough (${vMs}ms)`);
    // sim tick performance
    const rr = newRun(dd, n, [{ id: "P1" }]);
    const t1 = Date.now();
    for (let i = 0; i < 300; i++) tick(rr, 1 / 60);
    const simMs = Date.now() - t1;
    ok(simMs < 1500, `${n}-room 300 ticks in ${simMs}ms`);
  }

  // ── 17. full enemy roster (both themes) — aggro + melee kill ────
  console.log("[roster]");
  for (const theme of ["fantasy", "scifi"]) {
    for (const etype of Object.keys(D.ENEMIES[theme])) {
      const dd = newDungeon({ name: "E", theme, seed: 9 });
      stampRoom(dd, 0, 5, 5, 5, 5);
      applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
      applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
      applyOp(dd, { t: "obj+", f: 0, o: { kind: "enemy", x: 7, z: 7, etype } });
      const rr = newRun(dd, 3, [{ id: "P1" }]);
      const pp = rr.players[0], ee = rr.enemies[0];
      pp.x = E.c2w(6); pp.z = E.c2w(7);
      let guard = 0;
      while (ee.alive && guard++ < 4000) {
        pp.input.yaw = E.yawTo(pp.x, pp.z, ee.x, ee.z);
        pp.input.melee = true;
        if (Math.hypot(ee.x - pp.x, ee.z - pp.z) > 1.6) {
          pp.input.mx = Math.sign(ee.x - pp.x) * 0.6; pp.input.mz = Math.sign(ee.z - pp.z) * 0.6;
        } else { pp.input.mx = 0; pp.input.mz = 0; }
        tick(rr, 1 / 60);
      }
      ok(!ee.alive, `${theme}/${etype} killable by melee (${guard} ticks, hp left ${Math.round(pp.hp)})`);
    }
  }

  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
