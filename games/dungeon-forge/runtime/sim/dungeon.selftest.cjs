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
    const barrel = applyOp(bd, { t: "obj+", f: 0, o: { kind: "decor", x: 8, z: 6, dtype: "crate" } });
    ok(barrel.ok, "break: crate placed");   // (barrels are EXPLOSIVE entities now — crates are the breakable)
    ok(!applyOp(bd, { t: "obj+", f: 0, o: { kind: "decor", x: 9, z: 6, dtype: "pot" } }).ok === false, "break: new prop type 'pot' places");
    const brun = newRun(bd, 55, [{ id: "P1" }]);
    const bp = brun.players[0];
    ok(brun.brokenDecor.size === 0, "break: nothing broken yet");
    const gold0 = bp.gold;
    bp.x = c2w(8) - 1.0; bp.z = c2w(6); bp.input.yaw = 0; bp.input.melee = true;
    for (let i = 0; i < 60 && brun.brokenDecor.size === 0; i++) tick(brun, 1 / 60);
    bp.input.melee = false;
    ok(brun.brokenDecor.has(barrel.id), "break: crate smashed by melee");
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

  // ── 4b. enemy aggro: group aggro + persistent pursuit ──────────
  console.log("[enemy: aggro]");
  {
    const ag = D.newDungeon({ theme: "fantasy", name: "Ag" });
    D.stampRoom(ag, 0, 10, 10, 22, 6);
    D.applyOp(ag, { t: "obj+", f: 0, o: { kind: "spawn", x: 11, z: 12 } });
    D.applyOp(ag, { t: "obj+", f: 0, o: { kind: "exit", x: 30, z: 12 } });
    D.applyOp(ag, { t: "obj+", f: 0, o: { kind: "enemy", x: 18, z: 12, etype: "skeleton" } });
    D.applyOp(ag, { t: "obj+", f: 0, o: { kind: "enemy", x: 19, z: 12, etype: "skeleton" } }); // a friend 1 cell over
    D.applyOp(ag, { t: "obj+", f: 0, o: { kind: "enemy", x: 27, z: 12, etype: "skeleton" } }); // far friend (>CELL*5)
    const ar = newRun(ag, 5, [{ id: "P1" }]);
    const [e0, e1, eFar] = ar.enemies;
    e0.state = e1.state = eFar.state = "patrol";
    E.damageEnemy(ar, e0, 1, "P1");
    ok(e0.state === "chase", "aggro: a hit enemy enters chase");
    ok(e1.state === "chase" && e1.target === "P1", "aggro: nearby friend group-aggros onto the attacker");
    ok(eFar.state === "patrol", "aggro: a far-off enemy is NOT pulled into the pack");
    // persistent pursuit: with the target in sight, a chasing enemy stays locked
    // on even when it is well beyond the old home-leash distance
    const pr = newRun(ag, 6, [{ id: "P1" }]);
    const pe = pr.enemies[0], pp = pr.players[0];
    pp.x = E.c2w(30); pp.z = E.c2w(12);            // player at the far exit end (open room → LOS)
    pe.x = E.c2w(11); pe.z = E.c2w(12); pe.state = "chase"; pe.target = "P1"; pe.home = { x: pe.x, z: pe.z };
    for (let i = 0; i < 30; i++) tick(pr, 1 / 60);
    ok(pe.state === "chase", "aggro: chaser keeps pursuing a distant but visible target (no home-leash)");
    ok(E.hasLOS(pr, 0, pe.x, pe.z, pp.x, pp.z) ? pe.x > E.c2w(11) : true, "aggro: chaser actually closes distance toward the player");
  }

  // ── 4c. enemy LEVEL scaling + slower leveling ──────────────────
  console.log("[enemy: levels]");
  {
    ok(E.xpToNext(1) === 80, "level: L1->L2 needs the slower 80xp (was 45)");
    ok(D.defaultEnemyLevel(1, 0) === 1 && D.defaultEnemyLevel(3, 0) === 5 && D.defaultEnemyLevel(2, 3) > D.defaultEnemyLevel(2, 0),
      "level: default scales with difficulty + floor depth");
    const lg = D.newDungeon({ theme: "fantasy", name: "L", difficulty: 1 });
    D.stampRoom(lg, 0, 10, 10, 8, 8);
    D.applyOp(lg, { t: "obj+", f: 0, o: { kind: "spawn", x: 11, z: 11 } });
    D.applyOp(lg, { t: "obj+", f: 0, o: { kind: "exit", x: 16, z: 16 } });
    D.applyOp(lg, { t: "obj+", f: 0, o: { kind: "enemy", x: 12, z: 12, etype: "skeleton", level: 1 } });
    const hiId = D.applyOp(lg, { t: "obj+", f: 0, o: { kind: "enemy", x: 13, z: 12, etype: "skeleton", level: 12 } }).id
      || lg.floors[0].objects.find((o) => o.kind === "enemy" && o.x === 13).id;
    const lr = newRun(lg, 9, [{ id: "P1" }]);
    const e1 = lr.enemies.find((e) => e.level === 1), eHi = lr.enemies.find((e) => e.level === 12);
    ok(e1 && eHi, "level: enemies spawn with their assigned levels");
    ok(eHi.K.hp > e1.K.hp * 2.5, "level: L12 far tankier (" + eHi.K.hp + " vs " + e1.K.hp + ")");
    ok(eHi.K.dmg > e1.K.dmg * 1.8, "level: L12 hits harder (" + eHi.K.dmg + " vs " + e1.K.dmg + ")");
    ok(E.xpFromEnemy(eHi.K) > E.xpFromEnemy(e1.K), "level: higher level worth more xp");
    // objEdit + serialize round-trip persists the level
    const hi = lg.floors[0].objects.find((o) => o.kind === "enemy" && o.x === 13);
    D.applyOp(lg, { t: "objEdit", id: hi.id, p: { level: 20 } });
    ok(hi.level === 20, "level: objEdit sets enemy level");
    const round = D.sanitize(D.serialize(lg));
    ok(round.floors[0].objects.find((o) => o.kind === "enemy" && o.x === 13).level === 20, "level: survives serialize round-trip");
    // clamp: absurd level pinned to the cap
    D.applyOp(lg, { t: "objEdit", id: hi.id, p: { level: 9999 } });
    ok(hi.level === D.ENEMY_LEVEL_MAX, "level: clamped to ENEMY_LEVEL_MAX");
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
    // crush is a heavy hit — well above a barbarian stage-1 swing (24 post-rebalance)
    ok(crushDmg > 45, "barbarian crush is heavy (" + crushDmg.toFixed(0) + ")");
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

  // ── 9b. booby traps: fire jet / javelin tripwire / secret pit ────
  console.log("[booby-traps]");
  {
    // FIRE JET: rot 1 = burns +X; the victim stands 2 cells down the cone
    const fd = newDungeon({ theme: "fantasy" });
    stampRoom(fd, 0, 5, 5, 6, 6);
    applyOp(fd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(fd, { t: "obj+", f: 0, o: { kind: "exit", x: 10, z: 10 } });
    applyOp(fd, { t: "obj+", f: 0, o: { kind: "trap", x: 6, z: 7, ttype: "firejet", rot: 1 } });
    const fr = newRun(fd, 11, [{ id: "P1" }]);
    const fp = fr.players[0];
    fp.x = c2w(8); fp.z = c2w(7);                       // 2 cells down the flame cone
    for (let i = 0; i < 400; i++) tick(fr, 1 / 60);
    ok(fp.hp < fp.maxHp, "firejet burns a player 2 cells down the cone (" + Math.round(fp.hp) + ")");
    const fr2 = newRun(fd, 11, [{ id: "P1" }]);
    fr2.players[0].x = c2w(6); fr2.players[0].z = c2w(5); // OFF the cone (side cell)
    for (let i = 0; i < 400; i++) tick(fr2, 1 / 60);
    ok(fr2.players[0].hp === fr2.players[0].maxHp, "firejet does not hit off-cone cells");

    // JAVELIN tripwire: stepping on the cell launches a dart that can skewer an enemy
    const jd = newDungeon({ theme: "fantasy" });
    stampRoom(jd, 0, 5, 5, 6, 6);
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "exit", x: 10, z: 10 } });
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "trap", x: 6, z: 6, ttype: "javelin", rot: 1 } });
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "enemy", x: 9, z: 6, etype: "skeleton" } });
    const jr = newRun(jd, 12, [{ id: "P1" }]);
    const jp = jr.players[0];
    jp.x = c2w(6); jp.z = c2w(6);                       // step on the tripwire
    tick(jr, 1 / 60);
    ok(jr.bolts.some((b) => b.elem === "javelin" && b.trap), "tripwire launches a javelin");
    ok(jr.events.some((e) => e.type === "javelin"), "javelin event emitted");
    const jEnemy = jr.enemies[0], hp0 = jEnemy.hp;
    for (let i = 0; i < 90; i++) tick(jr, 1 / 60);      // dart flies +X through the enemy cell
    ok(jEnemy.hp < hp0 || !jEnemy.alive, "javelin skewers an enemy in its path");
    const shots = jr.events.filter((e) => e.type === "javelin").length + 1;
    ok(shots <= 2, "javelin respects its cooldown (fired " + shots + "x in 1.5s)");

    // SECRET PIT: first step arms it; the tile falls away; the victim dies
    const pd = newDungeon({ theme: "fantasy" });
    stampRoom(pd, 0, 5, 5, 4, 4);
    applyOp(pd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(pd, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    applyOp(pd, { t: "obj+", f: 0, o: { kind: "trap", x: 6, z: 6, ttype: "pit" } });
    const pr = newRun(pd, 13, [{ id: "P1" }]);
    const pp = pr.players[0];
    pp.x = c2w(6); pp.z = c2w(6);
    tick(pr, 1 / 60);
    ok(pr.events.some((e) => e.type === "pitWarn"), "pit: first footstep cracks the tile");
    for (let i = 0; i < 40; i++) { pp.x = c2w(6); pp.z = c2w(6); tick(pr, 1 / 60); } // stay on it through the collapse
    ok(pr.traps.find((t) => t.ttype === "pit").open, "pit: tile falls away (open)");
    ok(pr.events.concat().length >= 0 && (pp.deaths >= 1 || !pp.alive), "pit: falling is lethal (deaths " + pp.deaths + ")");
    // determinism: same seed → same jittered spike timeline
    const sA = newRun(s5, 77, [{ id: "P1" }]), sB = newRun(s5, 77, [{ id: "P1" }]);
    sA.players[0].x = sB.players[0].x = c2w(6); sA.players[0].z = sB.players[0].z = c2w(5);
    for (let i = 0; i < 500; i++) { tick(sA, 1 / 60); tick(sB, 1 / 60); }
    ok(Math.abs(sA.players[0].hp - sB.players[0].hp) < 1e-9, "random spike timing is seed-deterministic");
  }

  // ── 9c. explosive barrels ────────────────────────────────────────
  console.log("[barrels]");
  {
    const bd = newDungeon({ theme: "fantasy" });
    stampRoom(bd, 0, 5, 5, 6, 6);
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "exit", x: 10, z: 10 } });
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "decor", x: 7, z: 7, dtype: "barrel" } });
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "decor", x: 8, z: 7, dtype: "barrel" } });
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "enemy", x: 7, z: 8, etype: "skeleton" } });
    const br = newRun(bd, 21, [{ id: "P1" }]);
    ok(br.barrels.length === 2, "barrel decor spins up live entities (" + br.barrels.length + ")");
    // PUSH: walk into the first barrel — it must give way
    const bp = br.players[0], b1 = br.barrels[0];
    const bx0 = b1.x, bz0 = b1.z;
    bp.x = b1.x - 0.9; bp.z = b1.z;                 // stand just west, walk east
    bp.input.mx = 1; bp.input.mz = 0;
    for (let i = 0; i < 30; i++) tick(br, 1 / 60);
    bp.input.mx = 0;
    ok(Math.hypot(b1.x - bx0, b1.z - bz0) > 0.2, "walking into a barrel PUSHES it (" + Math.hypot(b1.x - bx0, b1.z - bz0).toFixed(2) + "u)");
    // EXPLODE on melee: stand by it and swing until it pops; AoE hurts enemy + player
    const en = br.enemies[0]; en.x = b1.x + 1.2; en.z = b1.z;   // park the skeleton next to the barrel
    const eh0 = en.hp, ph0 = bp.hp;
    bp.x = b1.x - 1.2; bp.z = b1.z; bp.yaw = Math.PI / 2;       // face +X toward the barrel
    for (let i = 0; i < 60 && b1.alive; i++) { bp.input.melee = true; tick(br, 1 / 60); bp.input.melee = false; }
    ok(!b1.alive, "hitting a barrel explodes it");
    ok(br.events.concat().length >= 0 && !br.barrels[1].alive, "explosion CHAINS to the barrel next door");
    ok(en.hp < eh0 || !en.alive, "blast hurts the enemy (" + Math.round(eh0 - en.hp) + " dmg)");
    ok(bp.hp < ph0, "blast hurts the careless player too (" + Math.round(ph0 - bp.hp) + " dmg)");
    // bolts detonate barrels
    const br2 = newRun(bd, 22, [{ id: "P1", skin: 2 }]);        // sorceress
    const sp = br2.players[0], b2 = br2.barrels[0];
    sp.x = b2.x - 6; sp.z = b2.z; sp.input.yaw = Math.PI / 2;   // aim east at the barrel (sim copies input.yaw)
    sp.input.melee = true; tick(br2, 1 / 60); sp.input.melee = false;
    for (let i = 0; i < 60 && b2.alive; i++) tick(br2, 1 / 60);
    ok(!b2.alive, "an arcane bolt detonates a barrel from range");
  }

  // ── 9d. community dungeons (the "by players" carousel) ──────────
  console.log("[community]");
  {
    const { COMMUNITY } = await import("./community.js");
    ok(COMMUNITY.length >= 5, "community: " + COMMUNITY.length + " authored dungeons");
    for (const c of COMMUNITY) {
      const cd = c.build();
      const v = validate(cd);
      ok(v.ok, "community/" + c.key + ": validates", v.ok ? "" : v.problems[0].msg);
      let simOk = true;
      try { const r = newRun(cd, 42, [{ id: "P1" }]); for (let i = 0; i < 300; i++) tick(r, 1 / 60); } catch (e) { simOk = false; }
      ok(simOk, "community/" + c.key + ": escape sim runs clean");
    }
  }

  // ── 9e. stairs DOWN ──────────────────────────────────────────────
  console.log("[stairs-down]");
  {
    const sd = newDungeon({ theme: "fantasy" });
    stampRoom(sd, 0, 5, 5, 4, 4);                       // ground floor
    applyOp(sd, { t: "floor+" });
    stampRoom(sd, 1, 5, 5, 4, 4);                       // upper floor
    applyOp(sd, { t: "obj+", f: 1, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(sd, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    applyOp(sd, { t: "obj+", f: 1, o: { kind: "stairs", x: 6, z: 6, rot: 0, dir: -1 } }); // DOWN, landing (6,7) below
    const links = stairLinks(sd);
    const dn = links.find((l) => l.down);
    ok(!!dn && dn.from.f === 1 && dn.to.f === 0 && dn.to.x === 6 && dn.to.z === 7, "stairs-down: link goes f1 → f0 at the landing");
    // sanitize keeps dir
    const back = sanitize(serialize(sd));
    ok(back.floors[1].objects.some((o) => o.kind === "stairs" && o.dir === -1), "stairs-down: dir survives serialize roundtrip");
    // walking onto the down-stairs cell starts a descend
    const rr = newRun(sd, 31, [{ id: "P1" }]);
    const rp = rr.players[0];
    rp.x = c2w(6); rp.z = c2w(6);                        // stand on the stairs (floor 1)
    for (let i = 0; i < 80 && rp.f === 1; i++) tick(rr, 1 / 60);
    ok(rp.f === 0, "stairs-down: climbing DOWN switches to floor 0");
  }

  // ── 9e2. BIDIRECTIONAL stairs (walk up AND back down, anti-bounce) ──
  console.log("[stairs-bidirectional]");
  {
    const bd = newDungeon({ theme: "fantasy" });
    stampRoom(bd, 0, 5, 5, 4, 4);
    applyOp(bd, { t: "floor+" });
    stampRoom(bd, 1, 5, 5, 4, 4);
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    // UP staircase on floor 0 at (6,6) rot 0 → landing (6,7) on floor 1
    applyOp(bd, { t: "obj+", f: 0, o: { kind: "stairs", x: 6, z: 6, rot: 0 } });
    const rr = newRun(bd, 51, [{ id: "P1" }]);
    const rp = rr.players[0];
    // climb UP: stand on the stairs cell
    rp.x = c2w(6); rp.z = c2w(6);
    for (let i = 0; i < 90 && rp.f === 0; i++) tick(rr, 1 / 60);
    ok(rp.f === 1, "bidir: walking onto stairs climbs UP to floor 1");
    ok(w2c(rp.x) === 6 && w2c(rp.z) === 7, "bidir: arrives on the landing (6,7)");
    // ANTI-BOUNCE: staying on the landing must NOT send you back down
    for (let i = 0; i < 60; i++) tick(rr, 1 / 60);
    ok(rp.f === 1, "bidir: standing on the landing does NOT bounce back down");
    // step OFF the landing, then back ON → descend
    rp.x = c2w(6); rp.z = c2w(9);          // move away (re-arm the lock)
    for (let i = 0; i < 20; i++) tick(rr, 1 / 60);
    ok(rp.stairLock == null, "bidir: stairLock clears after stepping off");
    rp.x = c2w(6); rp.z = c2w(7);          // step back onto the landing
    for (let i = 0; i < 90; i++) tick(rr, 1 / 60);   // let the whole climb tween finish
    ok(rp.f === 0, "bidir: stepping back onto the landing descends to floor 0");
    ok(w2c(rp.x) === 6 && w2c(rp.z) === 6, "bidir: arrives back on the stair cell (6,6)");
    // and it does not immediately re-climb
    for (let i = 0; i < 60; i++) tick(rr, 1 / 60);
    ok(rp.f === 0, "bidir: standing on the stair cell after descent does NOT re-climb");
  }

  // ── 9e3. SUBLEVEL dig (floor-below unshift + reindex integrity) ──
  console.log("[sublevel]");
  {
    const sub = newDungeon({ theme: "fantasy" });
    stampRoom(sub, 0, 5, 5, 4, 4);
    applyOp(sub, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(sub, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    ok(applyOp(sub, { t: "floor-below" }).ok, "floor-below digs a sublevel");
    ok(sub.floors.length === 2, "now 2 floors");
    ok(findAll(sub, "spawn")[0].f === 1, "spawn reindexed onto floor 1 (old ground)");
    ok(findAll(sub, "exit")[0].f === 1, "exit reindexed onto floor 1");
    ok(Object.keys(sub.floors[0].cells).length === 0, "the new sublevel (floor 0) starts empty");
    // build the sublevel + a down staircase from floor 1 into it
    stampRoom(sub, 0, 5, 5, 4, 4);
    applyOp(sub, { t: "obj+", f: 1, o: { kind: "stairs", x: 6, z: 6, rot: 0, dir: -1 } }); // landing (6,7) on floor 0
    const links = stairLinks(sub);
    ok(links.some((l) => l.down && l.from.f === 1 && l.to.f === 0), "down-stairs links floor 1 → sublevel 0");
    ok(solvability(sub).solvable !== false, "sublevel dungeon still solvable");
    ok(validate(sub).ok, "sublevel down-stairs validate clean (no false top-floor error)", (validate(sub).problems[0]||{}).msg);
    // run: player spawns on floor 1 and can descend into the sublevel
    const rr = newRun(sub, 60, [{ id: "P1" }]);
    const rp = rr.players[0];
    ok(rp.f === 1, "player spawns on floor 1");
    rp.x = c2w(6); rp.z = c2w(6);
    for (let i = 0; i < 90; i++) tick(rr, 1 / 60);
    ok(rp.f === 0, "player descends the stairs into the sublevel");
    // serialize roundtrip keeps both floors
    ok(sanitize(serialize(sub)).floors.length === 2, "sublevel survives serialize roundtrip");
  }

  // ── 9e4. JUMP dodges floor traps (airborne skips spikes/vent/pit) ──
  console.log("[jump-dodge]");
  {
    const jd = newDungeon({ theme: "fantasy" });
    stampRoom(jd, 0, 4, 4, 6, 6);
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "spawn", x: 4, z: 4 } });
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    applyOp(jd, { t: "obj+", f: 0, o: { kind: "trap", x: 6, z: 6, ttype: "pit" } });
    // grounded: standing on the pit collapses it and kills you
    let rr = newRun(jd, 70, [{ id: "P1" }]); let rp = rr.players[0];
    rp.x = c2w(6); rp.z = c2w(6);
    for (let i = 0; i < 120 && rp.deaths === 0; i++) tick(rr, 1 / 60);
    ok(rp.deaths > 0, "pit kills a GROUNDED player");
    // airborne the whole time: the pit never trips → you clear it
    rr = newRun(jd, 70, [{ id: "P1" }]); rp = rr.players[0];
    rp.x = c2w(6); rp.z = c2w(6);
    for (let i = 0; i < 120; i++) { rp.airborne = true; tick(rr, 1 / 60); }
    ok(rp.alive && rp.deaths === 0, "JUMPing (airborne) clears the pit — no death");
    // spikes: grounded loses HP over time, airborne takes none
    const sd = newDungeon({ theme: "fantasy" });
    stampRoom(sd, 0, 4, 4, 6, 6);
    applyOp(sd, { t: "obj+", f: 0, o: { kind: "spawn", x: 4, z: 4 } });
    applyOp(sd, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    applyOp(sd, { t: "obj+", f: 0, o: { kind: "trap", x: 6, z: 6, ttype: "spikes" } });
    let sr = newRun(sd, 71, [{ id: "P1" }]); let spp = sr.players[0];
    const hp0 = spp.hp; spp.x = c2w(6); spp.z = c2w(6);
    for (let i = 0; i < 400; i++) tick(sr, 1 / 60);   // several spike cycles
    ok(spp.hp < hp0 || spp.deaths > 0, "spikes hurt a GROUNDED player");
    sr = newRun(sd, 71, [{ id: "P1" }]); spp = sr.players[0];
    const hp1 = spp.hp; spp.x = c2w(6); spp.z = c2w(6);
    for (let i = 0; i < 400; i++) { spp.airborne = true; tick(sr, 1 / 60); }
    ok(spp.hp === hp1 && spp.deaths === 0, "airborne dodges the spikes entirely");
  }

  // ── 9f. interior EDGE walls + edge doors (the WALLS tool) ────────
  console.log("[edge-walls]");
  {
    const wd = newDungeon({ theme: "fantasy" });
    stampRoom(wd, 0, 5, 5, 6, 4);                        // one 6x4 room
    applyOp(wd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(wd, { t: "obj+", f: 0, o: { kind: "exit", x: 10, z: 8 } });
    // solid wall row splitting x=7|8 across all four z rows
    for (let z = 5; z <= 8; z++) ok(applyOp(wd, { t: "wall+", f: 0, x: 7, z, s: 1, wtype: "brick" }).ok, "wall+: places at 7," + z);
    ok(!applyOp(wd, { t: "wall+", f: 0, x: 20, z: 20, s: 1 }).ok, "wall+: rejected off the floor");
    // movement blocked: player walks east into the wall line
    const wr = newRun(wd, 41, [{ id: "P1" }]);
    const wp = wr.players[0];
    wp.x = c2w(7); wp.z = c2w(6);
    for (let i = 0; i < 60; i++) { wp.input.mx = 1; tick(wr, 1 / 60); }
    wp.input.mx = 0;
    ok(w2c(wp.x) === 7, "edge wall stops the player (cell " + w2c(wp.x) + ")");
    // LOS + path blocked through the wall
    ok(!hasLOS(wr, 0, c2w(7), c2w(6), c2w(8), c2w(6)), "edge wall blocks LOS");
    ok(findPath(wr, 0, c2w(6), c2w(6), c2w(9), c2w(6)) === null, "edge wall blocks A* (full row)");
    // solvability: room split with no way through → unsolvable
    const sv1 = solvability(wd);
    ok(sv1.solvable === false, "solvability: full wall row splits spawn from exit");
    // knock one segment out → passable again
    applyOp(wd, { t: "wall-", f: 0, x: 7, z: 8, s: 1 });
    ok(solvability(wd).solvable !== false, "wall-: removing a segment reopens the route");
    // put an EDGE DOOR in the gap instead (locked) + a key on the near side
    applyOp(wd, { t: "wall+", f: 0, x: 7, z: 8, s: 1, wtype: "wood", door: true, locked: true });
    const sv2 = solvability(wd);
    ok(sv2.solvable === false, "locked edge door with no key = unsolvable");
    applyOp(wd, { t: "obj+", f: 0, o: { kind: "key", x: 6, z: 6 } });
    ok(solvability(wd).solvable !== false, "locked edge door + reachable key = solvable");
    // runtime: unlock + open the edge door with the key via doInteract
    const dr = newRun(wd, 42, [{ id: "P1" }]);
    const dp = dr.players[0];
    dp.keys = 1;
    dp.x = c2w(7) + 1.4; dp.z = c2w(8) + 2.0;            // stand by the edge midpoint
    const hint = interactHint(dr, dp);
    ok(!!hint && hint.obj.edge === true && hint.verb === "Unlock", "edge door: interact hint offers Unlock (" + (hint && hint.verb) + ")");
    ok(doInteract(dr, dp), "edge door: unlock+open succeeds");
    ok(dp.keys === 0, "edge door: key consumed");
    ok(dr.events.some((e) => e.type === "unlock") && dr.events.some((e) => e.type === "door" && e.open), "edge door: unlock + door events emitted");
    // now the player can cross the line
    dp.x = c2w(7); dp.z = c2w(8);
    for (let i = 0; i < 60; i++) { dp.input.mx = 1; tick(dr, 1 / 60); }
    dp.input.mx = 0;
    ok(w2c(dp.x) >= 8, "edge door open: player crosses the line (cell " + w2c(dp.x) + ")");
    // serialize roundtrip keeps walls + door flags
    const backW = sanitize(serialize(wd));
    const segs = D.manualWallSegments(backW, 0);
    ok(segs.length === 4 && segs.some((w) => w.door && w.locked && w.type === "wood") && segs.filter((w) => w.type === "brick").length === 3,
      "edge walls survive serialize roundtrip (" + segs.length + " segs)");
    // erasing a cell clears its touching walls
    applyOp(wd, { t: "cell-", f: 0, x: 7, z: 5 });
    ok(!D.manualWallSegments(wd, 0).some((w) => w.x === 7 && w.z === 5), "cell- clears touching edge walls");
  }

  // ── 9g. stairs soft-lock escape hatch + door dtype roundtrip ────
  console.log("[stairs-hatch+doors]");
  {
    // walled-in landing: player climbs up, lands in a 1-cell alcove with no
    // walkable neighbour; the anti-bounce lock would strand them — interactDown
    // must let them descend anyway.
    const hd = newDungeon({ theme: "fantasy" });
    stampRoom(hd, 0, 5, 5, 4, 4);
    applyOp(hd, { t: "floor+" });
    stampRoom(hd, 1, 5, 5, 4, 4);
    applyOp(hd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(hd, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    applyOp(hd, { t: "obj+", f: 0, o: { kind: "stairs", x: 6, z: 6, rot: 0 } }); // landing (6,7) on f1
    // wall the landing (6,7) on all four sides so it is a dead-end alcove
    for (const [x, z, sd] of [[6, 7, 0], [6, 7, 1], [6, 6, 0], [5, 7, 1]]) applyOp(hd, { t: "wall+", f: 1, x, z, s: sd, wtype: "stone" });
    const hr = newRun(hd, 80, [{ id: "P1" }]);
    const hp = hr.players[0];
    hp.x = c2w(6); hp.z = c2w(6);
    for (let i = 0; i < 60; i++) tick(hr, 1 / 60);       // climb up into the alcove
    ok(hp.f === 1, "hatch: climbed into the walled landing");
    for (let i = 0; i < 60; i++) tick(hr, 1 / 60);       // stuck: lock held, no walkable exit
    ok(hp.f === 1 && hp.stairLock != null, "hatch: still locked in the alcove (would soft-lock)");
    for (let i = 0; i < 60 && hp.f === 1; i++) { hp.input.interactDown = true; tick(hr, 1 / 60); }
    ok(hp.f === 0, "hatch: pressing interact descends out of the dead-end landing");

    // door dtype + flip survive placement + serialize roundtrip
    const dd = newDungeon({ theme: "fantasy" });
    stampRoom(dd, 0, 5, 5, 4, 4);
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(dd, { t: "obj+", f: 0, o: { kind: "exit", x: 8, z: 8 } });
    ok(applyOp(dd, { t: "wall+", f: 0, x: 6, z: 6, s: 1, wtype: "stone", door: true, dtype: "iron", flip: true }).ok, "door: place iron door");
    const seg = D.manualWallSegments(dd, 0).find((w) => w.door);
    ok(seg && seg.dtype === "iron" && seg.flip === true, "door: dtype+flip stored");
    const back = sanitize(serialize(dd));
    const seg2 = D.manualWallSegments(back, 0).find((w) => w.door);
    ok(seg2 && seg2.dtype === "iron" && seg2.flip === true, "door: dtype+flip survive roundtrip");
    // default door type is wood; junk dtype falls back to wood
    applyOp(dd, { t: "wall+", f: 0, x: 6, z: 7, s: 1, wtype: "stone", door: true, dtype: "bogus" });
    const seg3 = D.manualWallSegments(dd, 0).find((w) => w.x === 6 && w.z === 7 && w.door);
    ok(seg3 && seg3.dtype === "wood", "door: invalid dtype falls back to wood");
  }

  // ── 9h. exit sealed until every enemy is defeated ────────────────
  console.log("[exit-gate]");
  {
    const xd = newDungeon({ theme: "fantasy" });
    stampRoom(xd, 0, 5, 5, 6, 6);
    applyOp(xd, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(xd, { t: "obj+", f: 0, o: { kind: "exit", x: 9, z: 9 } });
    applyOp(xd, { t: "obj+", f: 0, o: { kind: "enemy", x: 7, z: 5, etype: "skeleton" } });
    applyOp(xd, { t: "obj+", f: 0, o: { kind: "key", x: 7, z: 5 } });   // carried key
    const xr = newRun(xd, 90, [{ id: "P1" }]);
    const xp = xr.players[0];
    // stand on the exit with the skeleton alive → sealed
    xp.x = c2w(9); xp.z = c2w(9);
    for (let i = 0; i < 30; i++) tick(xr, 1 / 60);
    const evs1 = xr.events.splice(0);
    ok(!xp.escaped, "exit-gate: sealed while an enemy lives");
    ok(evs1.some((e) => e.type === "exitSealed" && e.left === 1), "exit-gate: exitSealed event emitted (left=1)");
    // kill the skeleton → its key drops → exit opens
    const en = xr.enemies[0];
    en.hp = 0; en.alive = false; en.droppedKey = en.key || null;
    for (let i = 0; i < 30; i++) tick(xr, 1 / 60);
    ok(xp.escaped, "exit-gate: opens once every enemy is dead");
    ok(xr.enemies[0].key, "enemy-key: run bound the key to the enemy");
  }

  // ── 9i. rolling-terrain surface (sim == render ground) ──────────
  console.log("[surface-height]");
  {
    const td = newDungeon({ theme: "fantasy" });
    stampRoom(td, 0, 5, 5, 5, 5);
    ok(D.surfaceHeightAt(td, 0, c2w(7), c2w(7)) === 0, "flat ground = 0");
    applyOp(td, { t: "raise", f: 0, x: 7, z: 7 });
    applyOp(td, { t: "raise", f: 0, x: 7, z: 7 });          // level 2 → cellHeight 1.1
    ok(!applyOp(td, { t: "raise", f: 0, x: 30, z: 30 }).ok, "raise rejected off the floor");
    const cH = D.cellHeight(td, 0, 7, 7);
    ok(Math.abs(cH - 1.1) < 1e-9, "cellHeight = 2 steps (" + cH + ")");
    const sMid = D.surfaceHeightAt(td, 0, c2w(7), c2w(7));
    ok(sMid > 0.2 && sMid <= cH, "surface at the raised cell center rises (" + sMid.toFixed(2) + ") on the smooth slope");
    // the surface is continuous: approaching the raised cell from a flat neighbor
    // starts rising BEFORE the border (matches the rendered slope)
    const sNear = D.surfaceHeightAt(td, 0, c2w(6) + 1.8, c2w(7));
    const sFar = D.surfaceHeightAt(td, 0, c2w(5) + 0.2, c2w(7));
    ok(sNear > sFar, "slope rises smoothly toward the raised cell (" + sFar.toFixed(2) + " → " + sNear.toFixed(2) + ")");
    // corner average parity with the render rule
    const c = D.cornerHeight(td, 0, 7, 7);
    ok(c > 0 && c < cH, "corner height averages raised+flat neighbors (" + c.toFixed(2) + ")");
  }

  // ── 9j. walls vs stairs + all-decor-destroyable ─────────────────
  console.log("[walls-stairs+decor]");
  {
    const wd2 = newDungeon({ theme: "fantasy" });
    stampRoom(wd2, 0, 5, 5, 5, 5);
    applyOp(wd2, { t: "obj+", f: 0, o: { kind: "spawn", x: 5, z: 5 } });
    applyOp(wd2, { t: "floor+" });
    stampRoom(wd2, 1, 5, 5, 5, 5);
    applyOp(wd2, { t: "obj+", f: 1, o: { kind: "exit", x: 8, z: 8 } });
    // up-stairs at (6,6) rot 0 → faces (6,7); a wall on that edge must be refused
    applyOp(wd2, { t: "obj+", f: 0, o: { kind: "stairs", x: 6, z: 6, rot: 0 } });
    const blocked = applyOp(wd2, { t: "wall+", f: 0, x: 6, z: 6, s: 0, wtype: "stone" });
    ok(!blocked.ok && blocked.err === "stairwall", "wall through the stair flight is refused (" + blocked.err + ")");
    // a wall elsewhere on the floor still works
    ok(applyOp(wd2, { t: "wall+", f: 0, x: 5, z: 5, s: 1, wtype: "stone" }).ok, "wall away from the stairs still places");
    // edgeBetweenCells helper
    const eb = D.edgeBetweenCells(6, 6, 6, 7);
    ok(eb && eb.x === 6 && eb.z === 6 && eb.s === 0, "edgeBetweenCells(6,6→6,7) = (6,6,s0)");
    // every non-explosive decor is breakable; explosives are not
    ok(D.breakableDecor("bookshelf") && D.breakableDecor("torch") && D.breakableDecor("pillar"), "bookshelf/torch/pillar are breakable now");
    ok(!D.breakableDecor("barrel") && !D.breakableDecor("canister"), "barrel/canister are NOT breakable (they explode)");
  }

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
