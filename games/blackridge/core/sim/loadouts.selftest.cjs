#!/usr/bin/env node
/* core/sim/loadouts.selftest.cjs — PVP LOADOUT CLASSES + PERKS.
 *   class validation (classes.js) · saved-class store (meta/loadouts.js) ·
 *   spawn kits for the human AND every opponent · class change on respawn ·
 *   pistol-start playlist unchanged · map pick-ups still work · every perk's
 *   effect, measured · determinism (same seed -> same kits, same snapshot).
 * Run:  node core/sim/loadouts.selftest.cjs     (exit 0 = all pass)
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

const CMD0 = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false,
  ads: false, reload: false, switchTo: null, interact: false, grenade: false, streak: 0 };
const cmd = (o) => Object.assign({}, CMD0, o);
const flat = () => ({ boxes: [], groundY: () => 0, spawns: { player: [0, 0, 0], playerYaw: 0 },
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
    modes: { tdm: { scoreLimit: 40, timeLimitS: 120, respawnS: 1.0, protectS: 0.5 },
             ctf: { captureLimit: 3, timeLimitS: 120, respawnS: 1.0, protectS: 0.5 },
             ffa: { scoreLimit: 40, timeLimitS: 120, respawnS: 1.0, protectS: 0.5 } },
    archetypes,
    pvp: { loadout: { slots: ["pike", null], grenades: 1 } },
    pickups: [], scenarios: {},
  };
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

async function main() {
  const C = await import(u("core/sim/classes.js"));
  const LS = await import(u("core/meta/loadouts.js"));
  const S = await import(u("core/sim/sim.js"));
  const MATCH = await import(u("core/match/match.js"));
  const TDM = await import(u("core/match/modes/tdm.js"));
  const FFA = await import(u("core/match/modes/ffa.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const D = await import(u("core/sim/damage.js"));
  const G = await import(u("core/sim/grenades.js"));
  const PER = await import(u("core/ai/perception.js"));
  const WEAPONS = WD.WEAPONS;
  const live = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  MATCH.registerMode("tdm", TDM.createMode);
  MATCH.registerMode("ffa", FFA.createMode);
  const content = syntheticContent(live.archetypes);

  const matchSim = (seed, classes, mode) => {
    const events = [];
    const sim = S.createSim({ content, colliders: flat(), weapons: WEAPONS, seed, mode: mode || "tdm", tuning: "pvp",
      classes, emit: (type, data) => events.push({ type, data }) });
    sim.mission.start(sim);
    return { sim, events };
  };
  const flatSim = (seed) => {
    const events = [];
    const sim = S.createSim({ colliders: flat(), weapons: WEAPONS, seed: seed || 5, emit: (type, data) => events.push({ type, data }) });
    return { sim, events };
  };
  const run = (sim, n, c) => { for (let i = 0; i < n; i++) sim.step(c || null); };

  // =========================================================== 1. validation
  section("class validation");
  {
    ok(C.PERK_IDS.length === 8 && ["scavenger", "quickfix", "deadsilence", "ghost", "hardline", "fastHands", "doubleTime", "flak"]
      .every((id) => C.PERKS[id]), "the eight agreed perk ids exist");
    ok(C.PERKS_BY_TIER.every((t) => t.length >= 2), "every tier offers a choice (" + C.PERKS_BY_TIER.map((t) => t.length).join("/") + ")");
    ok(C.DEFAULT_CLASSES.length === 5 && C.DEFAULT_CLASSES.every((c, i) => C.validateClass(c, i).fixed === 0),
      "five defaults, each one valid as written");
    const bad = C.validateClass({ name: "<b>x</b>!!", primary: "railgun", secondary: "warden", lethal: "nuke",
      perks: ["ghost", "scavenger", "deadsilence"] }, 1);
    ok(bad.cls.primary === "vesper" && bad.cls.secondary === "pike" && bad.cls.lethal === "frag", "illegal weapons/lethal repaired to the slot default");
    ok(bad.cls.perks[0] === "doubleTime" && bad.cls.perks[1] === "hardline" && bad.cls.perks[2] === "deadsilence",
      "a perk in the wrong tier is repaired, a legal one kept");
    ok(bad.cls.name === "BX B" || /^[A-Z0-9 \-]+$/.test(bad.cls.name), "name sanitised to A-Z 0-9 (" + bad.cls.name + ")");
    ok(C.validateClass(null, 2).cls.name === "MARKSMAN" && C.validateClass("junk", 2).fixed > 0, "non-objects become the default");
    ok(C.validateClass({ ...C.DEFAULT_CLASSES[0], name: "A".repeat(40) }, 0).cls.name.length === C.NAME_MAX, "name capped at " + C.NAME_MAX);
    const empty = C.validateClass({ ...C.DEFAULT_CLASSES[0], lethal: null, perks: [null, null, "quickfix"] }, 0);
    ok(empty.fixed === 0 && empty.cls.perks[0] === null && empty.cls.lethal === null, "null = an empty slot, legal");
    // unlock gate: level-1 profile (warden, pike, frag only)
    const lv1 = new Set(["weapon:warden", "weapon:pike", "equip:frag"]);
    const kit = C.resolveKit(C.DEFAULT_CLASSES[3], { isUnlocked: (k) => lv1.has(k) });
    ok(kit.primary === "warden" && kit.secondary === "pike" && kit.lethal === "frag" && kit.perks.every((p) => p === null),
      "locked BREACHER resolves to warden + no perks at level 1");
    const kit2 = C.resolveKit(C.DEFAULT_CLASSES[1], { isUnlocked: (k) => k !== "perk:hardline" });
    ok(kit2.perks[1] === "ghost", "a locked perk falls back to the first unlocked perk of its tier");
  }

  // ================================================================ 2. store
  section("saved classes: one versioned record, validated on load");
  {
    const st = memStorage();
    const a = LS.createLoadouts({ storage: st });
    ok(a.classes().length === 5 && a.selected() === 0 && a.playlist() === "classes", "fresh store = 5 defaults, class 1 active");
    ok(JSON.parse(st.getItem(LS.STORE_KEY)).v === LS.STORE_VERSION, "record written with its version");
    ok(a.update(2, { primary: "breaker" }) && a.get(2).primary === "breaker", "edit a primary");
    ok(!a.update(2, { primary: "railgun" }) && a.get(2).primary === "breaker", "illegal edit rejected, class unchanged");
    ok(!a.update(2, { perk: { tier: 1, id: "ghost" } }), "a perk in the wrong tier is rejected");
    ok(a.update(2, { perk: { tier: 2, id: "hardline" } }) && a.get(2).perks[1] === "hardline", "set a tier-2 perk");
    ok(a.update(2, { name: "long range one" }) && a.get(2).name === "LONG RANGE ONE", "rename (cleaned to caps)");
    a.select(2); a.setPlaylist("pistol");
    const b = LS.createLoadouts({ storage: st });
    ok(b.selected() === 2 && b.get(2).primary === "breaker" && b.playlist() === "pistol", "survives a reload");
    ok(b.matchSpec(null).enabled === false, "pistol playlist -> match spec disabled");
    b.setPlaylist("classes");
    ok(b.reset(2) && b.get(2).primary === "corvus", "reset restores the default");
    // corrupted records
    st.setItem(LS.STORE_KEY, "{not json");
    ok(LS.createLoadouts({ storage: st }).classes()[0].name === "ASSAULT", "unparsable record -> defaults");
    st.setItem(LS.STORE_KEY, JSON.stringify({ v: 1, selected: 9, playlist: "x", classes: [{ name: "OK", primary: "corvus", secondary: "pike", lethal: "frag", perks: ["flak", "ghost", "quickfix"] }, 7] }));
    const c = LS.createLoadouts({ storage: st });
    ok(c.get(0).name === "OK" && c.get(0).primary === "corvus", "good class kept from a partial record");
    ok(c.get(1).name === "RUNNER" && c.classes().length === 5 && c.selected() === 0 && c.playlist() === "classes", "bad / missing fields repaired");
    ok(JSON.parse(st.getItem(LS.STORE_KEY)).classes.length === 5, "repaired record written back");
    const prog = { isUnlocked: (k) => k === "weapon:warden" || k === "weapon:pike" || k === "equip:frag" };
    const spec = c.matchSpec(prog, 0);
    ok(spec.enabled && spec.player.primary === "warden" && spec.player.perks.every((p) => p === null),
      "match spec is gated by progression (locked corvus -> warden, locked perks -> empty)");
    ok(LS.createLoadouts({ storage: null }).classes().length === 5, "no storage (private mode) still works");
  }

  // ============================================================ 3. spawn kits
  section("spawn kits: the human and every opponent deploy from a class");
  const RUNNER = C.DEFAULT_CLASSES[1];
  {
    const { sim, events } = matchSim(11, { enabled: true, classId: 1, player: RUNNER });
    run(sim, 2);
    const p = sim.state.player;
    ok(p.weapon.id === "vesper" && p.slots[1] === "vesper" && p.slots[4] === "pike" && p.slots[0] === null,
      "human: Runner -> vesper in slot 2 + pike in slot 5 (" + p.slots.join(",") + ")");
    ok(p.grenades === 1 && p.perks.doubleTime && p.perks.hardline && p.perks.deadsilence && !p.perks.ghost, "lethal x1 + the three Runner perks");
    ok(p._slotAmmo.vesper.mag === WEAPONS.vesper.mag && p._slotAmmo.pike.reserve === WEAPONS.pike.reserve, "both guns full");
    const bots = sim.state.bots.filter((b) => b.alive);
    ok(bots.length === 9 && bots.every((b) => b.kit && b.perks && b.slots[4] === "pike" && b.grenades === 1),
      "all 9 opponents/teammates spawn with a class kit (primary + pike + frag)");
    ok(bots.every((b) => b.weapon.id === b.kit.primary && b.weapon.id !== "pike"), "each operator holds their class primary, not a pistol");
    const names = new Set(bots.map((b) => b.kit.name)), prims = new Set(bots.map((b) => b.kit.primary));
    ok(names.size >= 4 && prims.size >= 3, `classes vary across the lobby (${[...names].join("/")}; ${[...prims].join("/")})`);
    const marks = sim.state.match.actors.filter((a) => /marksman/.test(a.archetype || ""));
    ok(marks.every((a) => { const b = sim.state.bots.find((x) => x.actorId === a.actorId); return b && b.kit.primary === "corvus"; }),
      "marksman-role operators run DMR classes");
    ok(bots.every((b) => b.kit.perks.length === 3 && b.kit.perks.every((id, ti) => C.PERKS[id].tier === ti + 1)), "one perk per tier for every opponent");
    ok(events.some((e) => e.type === "respawn" && e.data.who === "P" && e.data.kit === "RUNNER"), "respawn event carries the class name (additive field)");
  }
  {
    // pistol start playlist + no option at all = original rule, byte for byte
    const a = matchSim(11, { enabled: false }), b = matchSim(11, undefined);
    run(a.sim, 2); run(b.sim, 2);
    ok(a.sim.state.player.weapon.id === "pike" && a.sim.state.bots.every((x) => x.weapon.id === "pike" && !x.kit),
      "PISTOL START playlist: everyone on the Pike, no kits");
    ok(!a.sim.state.player.perks && !b.sim.state.player.perks && b.sim.state.player.weapon.id === "pike", "no classes option -> pistol start, no perks");
    ok(djb2(JSON.stringify(a.sim.snapshot())) === djb2(JSON.stringify(b.sim.snapshot())), "pistol playlist == legacy path (identical snapshot)");
    const camp = flatSim(3);
    ok(camp.sim.state.player.weapon.id === "warden" && camp.sim.state.player.slots[4] === "pike" && !camp.sim.state.player.perks && !camp.sim.classes.on,
      "campaign sim untouched (warden + pike, classes off)");
    ok(camp.sim.setPlayerClass(RUNNER) === null, "setPlayerClass is inert outside a class match");
  }

  section("class change takes effect on the next respawn; pick-ups still work");
  {
    const { sim } = matchSim(21, { enabled: true, classId: 0, player: C.DEFAULT_CLASSES[0] });
    run(sim, 2);
    const p = sim.state.player;
    ok(p.weapon.id === "warden" && p.kit.name === "ASSAULT", "deployed as ASSAULT");
    const kit = sim.setPlayerClass(C.DEFAULT_CLASSES[2], { classId: 2 });
    ok(kit && kit.primary === "corvus" && p.weapon.id === "warden", "picking MARKSMAN mid-life changes nothing yet");
    // loot: a dropped vesper is still picked up into its fixed slot
    sim.loot.spawn("vesper", [p.pos[0], p.pos[1], p.pos[2]], { ttl: 0 });
    run(sim, 5);
    ok(p.slots[1] === "vesper" && p.slots[0] === "warden", "walk-over pick-up fills slot 2 on top of the class kit");
    let guard = 0;
    while (sim.match.isProtected("P") && guard++ < 900) run(sim, 1);
    D.applyDamage(sim, "P", 9999, null, "body", "test");
    ok(!p.alive, "killed");
    guard = 0;
    while (!p.alive && guard++ < 600) run(sim, 1);
    ok(p.alive && p.weapon.id === "corvus" && p.slots[3] === "corvus" && p.slots[1] === null && p.kit.name === "MARKSMAN",
      "respawned as MARKSMAN, the looted vesper gone (" + p.slots.join(",") + ")");
    ok(p.perks.flak && p.perks.ghost && p.perks.quickfix && !p.perks.scavenger, "perks swapped with the class");
    const k2 = sim.setPlayerClass(C.DEFAULT_CLASSES[3], { classId: 3, immediate: true });
    ok(k2 && p.weapon.id === "breaker" && p.kit.name === "BREACHER", "immediate pick (warm-up picker) re-kits at once");
    const k3 = sim.setPlayerClass({ name: "X", primary: "railgun", secondary: "nope", lethal: "nuke", perks: ["ghost", 1, null] }, { classId: 4, immediate: true });
    ok(k3.primary === "warden" && k3.secondary === "pike" && k3.lethal === "frag" && k3.perks[0] === "scavenger", "a malformed class can never put an illegal kit in the sim");
  }

  // ================================================================ 4. perks
  section("perk: SALVAGER (scavenger) — ammo + lethal from every enemy you drop");
  {
    const cls = { ...C.DEFAULT_CLASSES[0], perks: ["scavenger", "fastHands", "quickfix"] };
    const { sim, events } = matchSim(31, { enabled: true, classId: 0, player: cls });
    run(sim, 2);
    const p = sim.state.player;
    p.weapon.reserve = 0; p._slotAmmo.warden.reserve = 0; p._slotAmmo.pike.reserve = 0; p.grenades = 0;
    const enemy = sim.state.match.actors.find((a) => a.kind === "bot" && a.team === 1 && a.alive);
    let guard = 0;
    while (sim.match.isProtected(enemy.who) && guard++ < 900) run(sim, 1);
    p.weapon.reserve = 0; p._slotAmmo.warden.reserve = 0; p._slotAmmo.pike.reserve = 0; p.grenades = 0;
    D.applyDamage(sim, enemy.who, 9999, "P", "body", "test");
    // the base kill-resupply rule also refills the HELD gun; SALVAGER is the pike + the frag + the extra mag
    ok(p._slotAmmo.pike.reserve >= WEAPONS.pike.mag, "the stowed pistol got a mag (" + p._slotAmmo.pike.reserve + ")");
    ok(p.grenades === 1, "frag restocked to the kit count");
    ok(events.some((e) => e.type === "resupply" && e.data.reason === "scavenger" && e.data.who === "P"), "existing 'resupply' event, reason scavenger");
    // without the perk: no pistol mag, no frag
    const b = matchSim(31, { enabled: true, classId: 0, player: { ...cls, perks: ["flak", "fastHands", "quickfix"] } });
    run(b.sim, 2);
    const q = b.sim.state.player;
    const en2 = b.sim.state.match.actors.find((a) => a.kind === "bot" && a.team === 1 && a.alive);
    guard = 0; while (b.sim.match.isProtected(en2.who) && guard++ < 900) run(b.sim, 1);
    q._slotAmmo.pike.reserve = 0; q.grenades = 0;
    D.applyDamage(b.sim, en2.who, 9999, "P", "body", "test");
    ok(q._slotAmmo.pike.reserve === 0 && q.grenades === 0, "control (no perk): stowed pistol + frag untouched");
    // a teammate's death never pays
    p.grenades = 0;
    const mate = sim.state.match.actors.find((a) => a.kind === "bot" && a.team === 0 && a.alive);
    D.applyDamage(sim, mate.who, 9999, null, "body", "test");
    ok(p.grenades === 0, "no salvage from a death you did not cause");
  }

  section("perk: BLAST WEAVE (flak) — explosive damage x0.6");
  {
    const dmgAt = (perks) => {
      const { sim } = flatSim(7);
      sim.state.player.perks = perks;
      G.detonateAt(sim, null, [2, 0.3, 0], "grenade");
      return sim.tuning.maxHp - sim.state.player.hp;
    };
    const a = dmgAt(null), b = dmgAt({ flak: true });
    ok(a > 10 && Math.abs(b / a - C.PERK_FX.flak.explosiveMult) < 1e-9, `frag at 2 m: ${a.toFixed(1)} -> ${b.toFixed(1)} (x${(b / a).toFixed(2)})`);
    const { sim } = flatSim(7);
    const id = sim.spawnBot("rifleman", 3, 0, {});
    const bot = sim.state.bots.find((x) => x.id === id);
    bot.perks = { flak: true };
    sim.streaks.give(2, 1);
    G.detonateAt(sim, "P", [3, 0.3, 1], "streak", { radius: 6, dmgCenter: 135, dmgEdge: 18, noSelf: true });
    ok(bot.alive && bot.hp > 0, "an operator with BLAST WEAVE survives a near call-in shell (hp " + bot.hp.toFixed(1) + ")");
  }

  section("perk: STIM LACE (quickfix) — regen starts in half the time");
  {
    const regenStart = (perks) => {
      const { sim } = flatSim(7);
      const p = sim.state.player;
      p.perks = perks;
      run(sim, 2);
      sim.damage("P", 40);
      const hp0 = p.hp, t0 = sim.state.time;
      let guard = 0;
      while (p.hp <= hp0 + 1e-9 && guard++ < 900) run(sim, 1);
      return sim.state.time - t0;
    };
    const a = regenStart(null), b = regenStart({ quickfix: true });
    ok(Math.abs(a - 4.5) < 0.05 && Math.abs(b - 2.25) < 0.05, `regen begins after ${a.toFixed(2)} s -> ${b.toFixed(2)} s`);
  }

  section("perk: DEFT HANDS (fastHands) — reload + swap x0.75");
  {
    const timeReload = (perks) => {
      const { sim, events } = flatSim(7);
      const p = sim.state.player;
      p.perks = perks;
      run(sim, 40);
      p.weapon.mag = 10;
      sim.step(cmd({ reload: true }));
      const t0 = sim.state.time;
      let guard = 0;
      while (p.weapon.state === "reloading" && guard++ < 600) run(sim, 1);
      const ev = events.find((e) => e.type === "reload" && e.data.phase === "start");
      return { dt: sim.state.time - t0, ev: ev ? ev.data.duration : null, mag: p.weapon.mag };
    };
    const a = timeReload(null), b = timeReload({ fastHands: true });
    ok(Math.abs(a.dt - 2.1) < 0.04 && Math.abs(b.dt - 2.1 * 0.75) < 0.04 && b.mag === 30,
      `warden tactical reload ${a.dt.toFixed(2)} s -> ${b.dt.toFixed(2)} s, mag refilled`);
    ok(Math.abs(b.ev - 2.1 * 0.75) < 1e-6, "the reload event reports the shortened duration for the viewmodel");
    const timeSwap = (perks) => {
      const { sim } = flatSim(7);
      const p = sim.state.player;
      p.perks = perks;
      run(sim, 40);
      sim.step(cmd({ switchTo: "slot5" }));
      const t0 = sim.state.time;
      let guard = 0;
      while (p.weapon.id !== "pike" && guard++ < 600) run(sim, 1);
      return sim.state.time - t0;
    };
    const s0 = timeSwap(null), s1 = timeSwap({ fastHands: true });
    ok(s1 < s0 && Math.abs(s1 / s0 - 0.75) < 0.12, `swap to pike ${s0.toFixed(3)} s -> ${s1.toFixed(3)} s`);
  }

  section("perk: LONG STRIDE (doubleTime) — 2x tac-sprint, faster crouch-walk");
  {
    const tacAfter1s = (perks) => {
      const { sim } = flatSim(7);
      const p = sim.state.player;
      p.perks = perks;
      run(sim, 2, cmd({ moveZ: 1, sprint: true }));
      p._m.sprintState = "tac"; p._m.tacLeft = 4.0;
      run(sim, 60, cmd({ moveZ: 1, sprint: true }));
      return p._m.tacLeft;
    };
    const a = tacAfter1s(null), b = tacAfter1s({ doubleTime: true });
    ok(Math.abs(a - 3.0) < 0.05 && Math.abs(b - 3.5) < 0.05, `tac tank after 1 s: ${a.toFixed(2)} vs ${b.toFixed(2)} (4 s -> 8 s of tac)`);
    const crouchV = (perks) => {
      const { sim } = flatSim(7);
      sim.state.player.perks = perks;
      run(sim, 90, cmd({ moveZ: 1, crouch: true }));
      return Math.hypot(sim.state.player.vel[0], sim.state.player.vel[2]);
    };
    const c0 = crouchV(null), c1 = crouchV({ doubleTime: true });
    ok(Math.abs(c0 - 2.4) < 0.05 && Math.abs(c1 - 3.0) < 0.05, `crouch-walk ${c0.toFixed(2)} -> ${c1.toFixed(2)} m/s`);
  }

  section("perk: SOFT STEP (deadsilence) — opponents hear your footsteps at 0.35x range");
  {
    const heard = (perks, dist) => {
      const { sim, events } = flatSim(7);
      const id = sim.spawnBot("rifleman", 0, -dist, { yaw: 0 }); // facing -z: the player at z=0 is BEHIND it
      const bot = sim.state.bots.find((x) => x.id === id);
      const p = sim.state.player;
      p.perks = perks;
      run(sim, 2);
      p.vel = [0, 0, -4.6]; p.grounded = true; p.stance = "stand";
      PER.perceive(bot, sim, sim.world, 1 / 60, () => 0.5);
      const rec = bot.percept && bot.percept.byTarget && bot.percept.byTarget.P;
      void events;
      return !!(rec && rec.heardKind === "steps");
    };
    ok(heard(null, 5) && heard(null, 2), "walking 5 m behind an operator: heard");
    ok(!heard({ deadsilence: true }, 5) && heard({ deadsilence: true }, 2), "with SOFT STEP: silent at 5 m, still audible at 2 m (radius 2.45 m)");
    const { sim, events } = flatSim(7);
    sim.state.player.perks = { deadsilence: true };
    run(sim, 120, cmd({ moveZ: 1 }));
    const steps = events.filter((e) => e.type === "step" && e.data.who === "P");
    ok(steps.length > 0 && steps.every((e) => e.data.quiet === true), "step events carry quiet:true for the audio layer");
  }

  section("perk: COLD SIGNAL (ghost) — not a Signal Sweep contact");
  {
    const { sim, events } = flatSim(7);
    const a = sim.spawnBot("rifleman", 12, -25, {}), b = sim.spawnBot("rifleman", -18, -35, {});
    sim.state.bots.find((x) => x.id === b).perks = { ghost: true };
    sim.streaks.give(1, 1);
    sim.step(cmd({ streak: 1 }));
    run(sim, 60 * 3);
    const sw = events.filter((e) => e.type === "streak" && e.data.phase === "sweep");
    const ids = new Set(sw.flatMap((e) => (e.data.contacts || []).map((c) => c.id)));
    ok(sw.length >= 1 && ids.has(a) && !ids.has(b), "sweep pings the plain operator, never the COLD SIGNAL one");
  }

  section("perk: PRIORITY LINE (hardline) — call-ins one kill sooner");
  {
    const streakAfter = (perks, n) => {
      const { sim } = flatSim(7);
      sim.setGod(true);
      sim.state.player.perks = perks;
      for (let i = 0; i < n; i++) { const id = sim.spawnBot("rifleman", 0, -40, {}); sim.damage(id, 999, "test", "P"); }
      return sim.state.streak.stock.slice();
    };
    ok(streakAfter(null, 2)[0] === 0 && streakAfter({ hardline: true }, 2)[0] === 1, "2 kills: sweep only with PRIORITY LINE");
    const h = streakAfter({ hardline: true }, 9);
    ok(h[1] === 1 && h[2] === 1 && h[3] === 1, "9 kills with PRIORITY LINE: mortar (4), airstrike (6) and orbital (9) all earned");
    ok(streakAfter(null, 9)[3] === 0, "control: no orbital at 9 kills");
  }

  section("opponent kits respect the lethal count (AI hook)");
  {
    const { sim } = matchSim(41, { enabled: true, classId: 0, player: C.DEFAULT_CLASSES[0] });
    run(sim, 2);
    const bot = sim.state.bots[0];
    ok(bot.grenades === 1, "operators carry their class frag count");
    bot.grenades = 0;
    // with 0 frags the eligibility gate is closed — exercised by botfsm via (bot.grenades == null || > 0)
    const src = fs.readFileSync(path.join(GAME_DIR, "core/ai/botfsm.js"), "utf8");
    ok(/bot\.grenades == null \|\| bot\.grenades > 0/.test(src) && /bot\.grenades = Math\.max\(0, bot\.grenades - 1\)/.test(src),
      "botfsm gates and decrements the kit frag count");
  }

  // ========================================================== 5. determinism
  section("determinism: same seed -> same kits, same match");
  {
    const kitsOf = (seed, mode) => {
      const { sim } = matchSim(seed, { enabled: true, classId: 1, player: RUNNER }, mode);
      run(sim, 2);
      return sim.state.bots.map((b) => b.actorId + ":" + b.kit.name + ":" + b.kit.primary + ":" + b.kit.perks.join("+")).sort().join("|");
    };
    ok(kitsOf(77) === kitsOf(77), "same seed -> identical opponent classes");
    ok(kitsOf(77) !== kitsOf(78), "a different seed deals a different lobby");
    ok(kitsOf(77, "ffa") === kitsOf(77, "ffa") && kitsOf(77, "ffa").split("|").length === 9, "FFA: 9 operators, deterministic kits");
    const h = (seed) => {
      const { sim } = matchSim(seed, { enabled: true, classId: 1, player: RUNNER });
      run(sim, 60 * 15, cmd({ moveZ: 1, sprint: true }));
      return djb2(JSON.stringify(sim.snapshot()));
    };
    const h1 = h(91), h2 = h(91);
    ok(h1 === h2, "15 s of a class match twice: identical snapshot hash (" + h1 + ")");
    for (let s = 1; s <= 40; s++) {
      const k = C.opponentClass(s, 3, "rifleman_b");
      if (C.validateClass(k, 0).fixed !== 0) { ok(false, "opponentClass produced an invalid class for seed " + s); break; }
      if (s === 40) ok(true, "opponentClass always yields a valid class (40 seeds)");
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log(`loadouts.selftest: ${passed} passed, ${failed} failed`);
  console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
