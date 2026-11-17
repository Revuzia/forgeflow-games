#!/usr/bin/env node
/* core/sim/heavy.selftest.cjs — [heavy weapons] the HX-60 Bastion (belt-fed LMG) and
 * the KR-5 Anvil (shoulder-fired launcher), end to end on the THREE-free side:
 *   weapon table + shared slots (Bastion on key 1, Anvil on key 5), grant/walkover
 *   rules, the rocket as a travelling projectile (flight, wall + body impact, dud
 *   inside the arming distance, splash, self-damage, BLAST WEAVE, kill attribution),
 *   class validation (old saves unchanged, new options legal, locks fall back),
 *   opponent kits, gunsmith fit, progression gates, challenges, ASCENT order, the
 *   operator launcher policy, and the frozen event vocabulary.
 * Run:  node core/sim/heavy.selftest.cjs     (exit 0 = all pass)
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
  const L = await import(u("core/sim/loadout.js"));
  const C = await import(u("core/sim/classes.js"));
  const A = await import(u("core/sim/attachments.js"));
  const G = await import(u("core/sim/grenades.js"));
  const P = await import(u("core/meta/progression.js"));
  const CH = await import(u("core/meta/challenges.js"));
  const LAD = await import(u("core/match/modes/ladder.js"));
  const BF = await import(u("core/ai/botfsm.js"));
  const WEAPONS = WD.WEAPONS;

  const mk = (boxes, god) => {
    const events = [];
    const sim = S.createSim({ colliders: flat(boxes), weapons: WEAPONS, seed: 11,
      emit: (type, data) => events.push({ type, data }) });
    sim.setGod(god !== false);
    sim.setNoTarget(true);
    return { sim, events };
  };
  // hold a bot still (the test is about the rocket, not the bot's footwork)
  const pin = (sim, id, pos) => { const b = sim.state.bots.find((x) => x.id === id); b.pos[0] = pos[0]; b.pos[1] = pos[1]; b.pos[2] = pos[2]; b.vel = [0, 0, 0]; return b; };
  const run = (sim, n, c, each) => { for (let i = 0; i < n; i++) { sim.step(c || cmd({})); if (each) each(); } };

  // ============================================================ weapon table
  section("weapon table + shared slots");
  {
    const b = WEAPONS.bastion, a = WEAPONS.anvil, w = WEAPONS.warden;
    ok(b && b.name === "HX-60 Bastion" && b.class === "lmg" && b.auto, "Bastion: belt-fed LMG, full auto");
    ok(b.mag >= 75 && b.mag <= 100 && b.reloadS > w.reloadS * 2 && b.adsTime > w.adsTime && b.moveMult < 1 &&
       b.spread.hip > w.spread.hip, `Bastion: ${b.mag}-rd box, slow reload ${b.reloadS}s, slow ADS, heavy, wide hip`);
    const pat = b.recoil.pattern;
    ok(pat[0][1] > pat[pat.length - 1][1] * 4 && pat.slice(-4).every((r) => r[1] < pat[0][1] * 0.25),
      "Bastion recoil settles: loop rows < 25% of the first kick");
    ok(a && a.name === "KR-5 Anvil" && a.class === "launcher" && a.projectile === "rocket" && a.mag === 1 &&
       a.reserve >= 1 && a.reserve <= 2 && a.reloadS >= 3, "Anvil: one rocket loaded, 1-2 spare, long reload");
    ok(WD.WEAPON_NAMES.bastion === b.name && WD.WEAPON_NAMES.anvil === a.name, "display names registered");
    ok(WD.SLOT_COUNT === 5 && WD.slotOf("bastion") === 0 && WD.slotOf("anvil") === 4,
      "shared slots: Bastion on key 1 (with the Warden), Anvil on key 5 (with the Pike); still five keys");
    ok(WD.SLOT_ORDER.join() === "warden,vesper,breaker,corvus,pike", "the five slot defaults never moved");
    ok(WD.ALL_WEAPON_IDS.length === 7 && WD.ALL_WEAPON_IDS.every((id) => WEAPONS[id]), "ALL_WEAPON_IDS lists all seven");
    for (const n of Object.values(WD.WEAPON_NAMES)) {
      ok(!/\b(AK|M4|M16|MG ?42|M249|RPG|AT-?4|LAW|Carl|Javelin|Stinger|PKM|Minimi|Negev)\b/i.test(n), `original name: ${n}`);
    }
  }

  // ============================================================ grant / walkover
  section("shared slots: explicit grant replaces, walkover never silently swaps");
  {
    const { sim } = mk();
    const p = sim.state.player;
    ok(p.weapon.id === "warden" && p.slots[0] === "warden" && p.slots[4] === "pike", "campaign loadout: Warden + Pike");
    ok(!L.walkoverTakes(p, "bastion"), "walking over a Bastion does NOT take it while the Warden is loaded");
    ok(L.walkoverTakes(p, "vesper"), "an empty slot is still a free pick-up");
    sim.givePlayerWeapon("bastion");
    ok(p.weapon.id === "bastion" && p.slots[0] === "bastion" && !p._slotAmmo.warden, "grant(bastion) replaces the Warden in slot 1 and raises it");
    ok(p.weapon.mag === WEAPONS.bastion.mag, "full box");
    sim.step(cmd({ switchTo: "slot1" })); run(sim, 5);
    ok(p.weapon.id === "bastion", "key 1 is now the Bastion");
    sim.step(cmd({ switchTo: "slot5" })); run(sim, 60);
    ok(p.weapon.id === "pike", "key 5 still the Pike");
    sim.givePlayerWeapon("anvil", { equip: false });
    ok(p.weapon.id === "anvil" && p.slots[4] === "anvil", "replacing the gun IN HAND forces the new one up (no gun-not-in-slots state)");
    ok(p._lastWeapon !== "pike", "`last` (Q) never points at a replaced gun");
    p.weapon.mag = 0; p.weapon.reserve = 0;
    ok(L.walkoverTakes(p, "pike"), "a DRY rival is swapped on a walkover");
  }

  // ============================================================ the rocket
  section("rocket: a travelling projectile through the frag explosion path");
  {
    const wall = [box(-30, 30, 0, 12, -30.6, -30.0, "concrete", "hard")];
    const { sim, events } = mk(wall);
    const p = sim.state.player;
    sim.givePlayerWeapon("anvil");
    run(sim, 60);
    sim.step(cmd({ fire: true }));
    const shot = events.find((e) => e.type === "shot" && e.data.shooter === "P");
    ok(shot && shot.data.rocket === true && shot.data.weaponId === "anvil" && shot.data.hit === null && !shot.data.tracer,
      "fire-time `shot` event: rocket, no hit, no tracer");
    const rl = sim.internal.rockets;
    ok(rl && rl.length === 1 && p.weapon.mag === 0, "one rocket in flight, tube empty");
    const z0 = rl[0].pos[2];
    run(sim, 6);
    ok(rl.length === 1 && rl[0].pos[2] < z0 - 4, `it TRAVELS (~${(z0 - rl[0].pos[2]).toFixed(1)} m in 0.1 s)`);
    run(sim, 60);
    const ex = events.find((e) => e.type === "explosion");
    ok(ex && ex.data.source === "rocket" && Math.abs(ex.data.pos[2] - (-30)) < 0.4 && ex.data.who === "P" && ex.data.radius === WEAPONS.anvil.splash.radius,
      "explodes ON the wall (" + (ex ? ex.data.pos.map((v) => v.toFixed(2)).join(",") : "none") + "), source rocket, who P");
    ok(!rl.length, "rocket removed after impact");
    ok(!events.some((e) => e.type === "grenade" && e.data.phase === "detonate"), "no frag-only grenade:detonate for a rocket");
  }
  {
    // direct body hit + kill attribution
    const { sim, events } = mk();
    sim.givePlayerWeapon("anvil");
    const id = sim.spawnBot("rifleman", 0, -18, {});
    run(sim, 60, null, () => pin(sim, id, [0, 0, -18]));
    sim.step(cmd({ fire: true }));
    run(sim, 40, null, () => { const b = sim.state.bots.find((x) => x.id === id); if (b.alive) pin(sim, id, [0, 0, -18]); });
    const d = events.find((e) => e.type === "death" && e.data.victim === id);
    ok(!!d, "a direct hit kills an operator");
    ok(d && d.data.weaponId === "anvil" && d.data.attacker === "P", "death event names the launcher (weaponId anvil)");
  }
  {
    // dud: a wall inside the arming distance
    const { sim, events } = mk([box(-5, 5, 0, 12, -2.6, -2.2, "concrete", "hard")], false);
    sim.givePlayerWeapon("anvil");
    run(sim, 60);
    const hp0 = sim.state.player.hp;
    sim.step(cmd({ fire: true })); run(sim, 20);
    ok(!events.some((e) => e.type === "explosion"), "inside the " + WEAPONS.anvil.splash.armM + " m arming distance: a dud, no blast");
    ok(events.some((e) => e.type === "grenade" && e.data.phase === "bounce"), "the dud clanks (grenade:bounce, reused vocabulary)");
    ok(sim.state.player.hp === hp0, "a dud does not hurt the shooter");
  }
  const selfDmg = (perks) => {
    const { sim } = mk([box(-5, 5, 0, 12, -4.6, -4.2, "concrete", "hard")], false);
    sim.givePlayerWeapon("anvil");
    sim.state.player.perks = perks;
    run(sim, 60);
    sim.step(cmd({ fire: true })); run(sim, 20);
    return sim.tuning.maxHp - sim.state.player.hp;
  };
  {
    const a = selfDmg(null), b = selfDmg({ flak: true });
    ok(a > 20, `self-damage ON: a rocket into a wall 4.2 m away costs the shooter ${a.toFixed(1)} hp`);
    ok(b > 0 && Math.abs(b / a - C.PERK_FX.flak.explosiveMult) < 1e-6, `BLAST WEAVE cuts it exactly like a frag: ${a.toFixed(1)} -> ${b.toFixed(1)} (x${(b / a).toFixed(2)})`);
  }
  {
    // splash through the generic helper with the launcher's numbers; flak on a bot
    const { sim } = mk();
    const id = sim.spawnBot("rifleman", 3, 0, {});
    const bot = pin(sim, id, [3, 0, 0]);
    bot.perks = { flak: true };
    const sp = WEAPONS.anvil.splash;
    G.detonateAt(sim, "P", [3, 0.3, 2.2], "rocket", { radius: sp.radius, dmgCenter: sp.dmgCenter, dmgEdge: sp.dmgEdge, weaponId: "anvil", quiet: true });
    ok(bot.alive && bot.hp < 100, "an operator with BLAST WEAVE survives a near rocket (hp " + bot.hp.toFixed(1) + ")");
  }
  {
    // reload: one at a time, long, from the reserve
    const { sim } = mk();
    const p = sim.state.player;
    sim.givePlayerWeapon("anvil");
    run(sim, 60);
    sim.step(cmd({ fire: true })); run(sim, 30);
    ok(p.weapon.state === "reloading", "the empty tube starts reloading on its own once the rocket is away");
    run(sim, Math.ceil(WEAPONS.anvil.reloadS * 60) + 30);
    ok(p.weapon.mag === 1 && p.weapon.reserve === WEAPONS.anvil.reserve - 1, `reloaded one rocket (${p.weapon.mag} + ${p.weapon.reserve})`);
  }

  // ============================================================ LMG fire
  section("Bastion: sustained fire");
  {
    const { sim, events } = mk();
    const p = sim.state.player;
    sim.givePlayerWeapon("bastion");
    run(sim, 60);
    run(sim, 120, cmd({ fire: true }));
    const n = events.filter((e) => e.type === "shot" && e.data.shooter === "P" && !e.data.impactOnly && !e.data.pen).length;
    ok(n >= 18 && n <= 22, `two seconds of held trigger = ${n} rounds (640 rpm on a 60 Hz sim)`);
    ok(p.weapon.mag === WEAPONS.bastion.mag - n, "the box counts down, no reload needed");
  }

  // ============================================================ classes
  section("classes: old saves unchanged, new options legal, locks fall back");
  {
    ok(C.PRIMARIES[C.PRIMARIES.length - 1] === "bastion" && C.SECONDARIES.join() === "pike,anvil", "Bastion primary, Anvil secondary (appended)");
    const old = { name: "DOOR", primary: "breaker", secondary: "pike", lethal: "frag", tactical: "flash", perks: ["doubleTime", "fastHands", "deadsilence"] };
    const v = C.validateClass(old, 3);
    ok(v.fixed === 0 && v.cls.primary === "breaker" && v.cls.secondary === "pike", "a class saved before these weapons validates with ZERO repairs");
    const k0 = C.resolveKit(old, { weapons: WEAPONS });
    ok(k0.primary === "breaker" && k0.secondary === "pike", "...and resolves to the same kit");
    const nw = { name: "HEAVY", primary: "bastion", secondary: "anvil", lethal: "frag", tactical: "smoke", perks: ["flak", "fastHands", "quickfix"] };
    ok(C.validateClass(nw, 0).fixed === 0, "Bastion + Anvil is a legal class");
    const locked = C.resolveKit(nw, { weapons: WEAPONS, isUnlocked: (k) => k !== "weapon:bastion" && k !== "weapon:anvil" });
    ok(locked.primary === "warden" && locked.secondary === "pike", "locked heavy kit deploys the first unlocked (Warden + Pike)");
    for (const d of C.DEFAULT_CLASSES) ok(C.validateClass(d, C.DEFAULT_CLASSES.indexOf(d)).fixed === 0, "default class " + d.name + " still clean");
    // opponents: some carry them, entry men never carry the launcher
    let nb = 0, na = 0, cqbA = 0, n = 0;
    for (let seed = 1; seed <= 40; seed++) for (let id = 1; id <= 10; id++) for (const arch of ["rifleman", "cqb", "marksman"]) {
      const c = C.opponentClass(seed, id, arch); n++;
      if (c.primary === "bastion") nb++;
      if (c.secondary === "anvil") { na++; if (arch === "cqb") cqbA++; }
      if (C.validateClass(c, 0).fixed !== 0) ok(false, "opponent class not legal: " + JSON.stringify(c));
    }
    ok(nb > n * 0.03 && nb < n * 0.15, `opponents SOMETIMES run the Bastion (${nb}/${n})`);
    ok(na > n * 0.04 && na < n * 0.2 && cqbA === 0, `opponents SOMETIMES carry the Anvil (${na}/${n}), never an entry man`);
    const r1 = C.opponentClass(7, 3, "rifleman"), r2 = C.opponentClass(7, 3, "rifleman");
    ok(JSON.stringify(r1) === JSON.stringify(r2), "opponent classes stay a pure function of (seed, actor, archetype)");
  }

  // ============================================================ gunsmith
  section("gunsmith: the launcher takes almost nothing, the LMG a short list");
  {
    const an = A.validateBuild("anvil", { attach: ["suppressor", "extmag", "rapidfire", "holo", "laser"] });
    ok(an.build.attach.join() === "laser" && an.fixed === 4, "Anvil: only the laser fits (4 illegal parts dropped)");
    ok(A.SLOTS.filter((s) => A.slotOptions("anvil", s).length).length <= 2, "Anvil has at most two slots with any option");
    const bb = A.validateBuild("bastion", { attach: ["holo", "suppressor", "grip", "extmag"] });
    ok(bb.fixed === 0 && bb.build.attach.length === 4, "Bastion: holo / suppressor / grip / extended box all fit");
    const ext = A.effectiveWeapon(WEAPONS.bastion, "bastion", ["extmag"]);
    ok(ext.mag === 150 && ext.reloadS > WEAPONS.bastion.reloadS, "Bastion extended box: 150 rounds, slower reload");
    const gr = A.effectiveWeapon(WEAPONS.bastion, "bastion", ["grip"]);
    ok(Math.abs(gr.moveMult - WEAPONS.bastion.moveMult * 0.96) < 1e-6, "a fore grip's weight stacks ON the LMG's own (move x0.88 x0.96)");
    ok(A.statLine(WEAPONS.anvil).damage.raw === 150 && A.statLine(WEAPONS.bastion).mag.raw === 100, "stat bars read the new tables");
    for (const id of ["bastion", "anvil"]) {
      const ob = A.opponentBuild(C.hash32, 5, 2, id, "rifleman", 0);
      ok(A.validateBuild(id, ob).fixed === 0, id + ": opponent builds are legal");
    }
  }

  // ============================================================ meta
  section("progression, challenges, ASCENT");
  {
    ok(P.UNLOCKS["weapon:bastion"] === 10 && P.UNLOCKS["weapon:anvil"] === 14, "unlocks: Bastion at level 10, Anvil at 14");
    ok(P.WEAPON_IDS.includes("bastion") && P.WEAPON_IDS.includes("anvil") && P.WEAPON_NAMES.anvil === "KR-5 Anvil", "weapon levels / names tracked");
    const blank = P.blankRecord();
    ok(blank.weapons.bastion && blank.weapons.anvil, "fresh record has weapon XP rows for both");
    const oldRec = P.sanitize({ v: blank.v, xp: 5000, weapons: { warden: { xp: 900, kills: 12, heads: 3 } } });
    ok(oldRec.weapons.warden.xp === 900 && oldRec.weapons.bastion && oldRec.weapons.bastion.xp === 0, "an old save gains empty rows, keeps its own");
    ok(CH.DAILY.some((c) => c.where.weapon === "bastion" && c.req === "weapon:bastion") &&
       CH.DAILY.some((c) => c.where.weapon === "anvil" && c.req === "weapon:anvil"), "daily drills for both, gated by the unlock");
    ok(CH.CAREER.some((t) => t.metric === "kills_bastion") && CH.CAREER.some((t) => t.metric === "kills_anvil"), "career service tracks for both");
    const order = LAD.LADDER_TIERS.map((t) => t.weapon);
    ok(order.includes("bastion") && order.includes("anvil") && order[order.length - 1] === "pike", "ASCENT carries both (pistol still last): " + order.join(" > "));
  }

  // ============================================================ AI
  section("operators: when a rocket is worth it");
  {
    const { sim } = mk();
    const a = sim.spawnBot("rifleman", 0, 0, {});
    const bot = sim.state.bots.find((x) => x.id === a);
    const t1 = sim.spawnBot("rifleman", 0, -25, {}), t2 = sim.spawnBot("rifleman", 2, -26, {});
    pin(sim, t1, [0, 0, -25]); pin(sim, t2, [2, 0, -26]);
    const hostile = { sameTeam: (x, y) => x === y };
    const prevMatch = sim.match;
    sim.match = Object.assign({}, prevMatch || {}, hostile);
    ok(BF.rocketValue(sim, bot, [0, 0, -25], 25) > 0, "a GROUP of two at 25 m: worth a rocket");
    ok(BF.rocketValue(sim, bot, [0, 0, -8], 8) === 0, "inside " + BF.LAUNCHER_MIN_M + " m: never (point blank)");
    pin(sim, t2, [20, 0, -26]);
    ok(BF.rocketValue(sim, bot, [0, 0, -25], 25) === 0, "a lone operator off any objective: not worth a rocket");
    bot._obj = { anchor: [1, 0, -24] };
    ok(BF.rocketValue(sim, bot, [0, 0, -25], 25) > 0, "...unless he is on the objective");
    bot._obj = null;
    ok(BF.rocketValue(sim, bot, [0, 0, -25], 90) === 0, "beyond " + BF.LAUNCHER_MAX_M + " m: no");
    sim.match = prevMatch;
    ok(BF.rocketPathClear(sim, [0, 1.6, 0], [0, 0, -1]), "open lane: the rocket's first 7 m are clear");
  }

  // ============================================================ vocabulary
  section("event vocabulary: nothing new");
  {
    const FROZEN = new Set(["mission:start", "mission:phase", "mission:end", "objective", "shot", "hurt", "death", "spawn",
      "reload", "switch", "ads", "step", "land", "botstate", "bark", "empty", "explosion", "grenade", "whiz", "zone",
      "loot", "pickup", "streak", "medal", "score", "jump", "equip", "melee"]);
    const { sim, events } = mk([box(-30, 30, 0, 12, -30.6, -30.0)], false);
    sim.givePlayerWeapon("bastion");
    run(sim, 40); run(sim, 30, cmd({ fire: true })); sim.step(cmd({ reload: true })); run(sim, 400);
    sim.givePlayerWeapon("anvil");
    run(sim, 60); sim.step(cmd({ fire: true })); run(sim, 300);
    const bad = [...new Set(events.map((e) => e.type))].filter((t) => !FROZEN.has(t));
    ok(bad.length === 0, "LMG + launcher fire/reload/explode emit only frozen event types" + (bad.length ? " (" + bad.join(",") + ")" : ""));
  }

  console.log(`\nheavy.selftest: ${passed} passed, ${failed} failed`);
  console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("RESULT: FAIL"); process.exit(1); });
