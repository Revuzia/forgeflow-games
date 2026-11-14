#!/usr/bin/env node
/* core/sim/attachments.selftest.cjs — GUNSMITH (attachments + camos).
 *   table integrity vs progression · validation / repair of builds · the
 *   progression gate · every attachment's effect MEASURED in the live sim
 *   (ADS time, mag + reload, recoil, hip spread, range, fire rate, move speed,
 *   sprint-to-fire, suppressed/tracer flags) · legacy classes unchanged ·
 *   opponent builds valid + deterministic · same seed -> same result.
 * Run:  node core/sim/attachments.selftest.cjs     (exit 0 = all pass)
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
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

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

async function main() {
  const A = await import(u("core/sim/attachments.js"));
  const C = await import(u("core/sim/classes.js"));
  const S = await import(u("core/sim/sim.js"));
  const B = await import(u("core/sim/ballistics.js"));
  const PR = await import(u("core/meta/progression.js"));
  const LS = await import(u("core/meta/loadouts.js"));
  const MATCH = await import(u("core/match/match.js"));
  const TDM = await import(u("core/match/modes/tdm.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const WEAPONS = WD.WEAPONS;
  const live = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  MATCH.registerMode("tdm", TDM.createMode);
  const content = syntheticContent(live.archetypes);
  const run = (sim, n, c) => { for (let i = 0; i < n; i++) sim.step(c || null); };
  const matchSim = (seed, classes) => {
    const events = [];
    const sim = S.createSim({ content, colliders: flat(), weapons: WEAPONS, seed, mode: "tdm", tuning: "pvp",
      classes, emit: (type, data) => events.push({ type, data }) });
    sim.mission.start(sim);
    return { sim, events };
  };
  // campaign sim with a hand-set kit: the cheapest stage to measure one gun
  const gunSim = (weaponId, attach, seed) => {
    const events = [];
    const sim = S.createSim({ colliders: flat(), weapons: WEAPONS, seed: seed || 5, emit: (type, data) => events.push({ type, data }) });
    const p = sim.state.player;
    p.kit = { builds: attach && attach.length ? { [weaponId]: { attach, camo: null } } : {} };
    const wt = sim.weaponOf(p, weaponId);
    p.slots = [null, null, null, null, null];
    p.slots[WD.slotOf(weaponId)] = weaponId;
    p._slotAmmo = { [weaponId]: { mag: wt.mag, reserve: wt.reserve } };
    Object.assign(p.weapon, { id: weaponId, mag: wt.mag, reserve: wt.reserve, state: "idle", stateT: 0, ads: false, adsT: 0, recoilIndex: 0 });
    sim.flags.simRecoil = true; // headless: the sim owns the player's climb (no recoil.js)
    return { sim, events, p, wt };
  };

  // ========================================================== 1. the table
  section("table integrity (one table, every id known to progression)");
  {
    const G = A.GUNSMITH;
    let bad = [];
    for (const w of Object.keys(G.weapons)) {
      const s = G.weapons[w];
      if (!WEAPONS[w]) bad.push(w + ": not a weapon");
      for (const sl of A.SLOTS) {
        for (const id of s.slots[sl] || []) {
          const isFactory = s.factory[sl] === id;
          if (!A.ATTACHMENTS[id] && !(isFactory && A.FACTORY_NAMES[id])) bad.push(w + "." + sl + ": unknown " + id);
          if (A.ATTACHMENTS[id] && A.ATTACHMENTS[id].slot !== sl) bad.push(w + ": " + id + " in the wrong slot");
        }
      }
      for (const o of s.slots.optic) if (!s.optics[o]) bad.push(w + ": optic " + o + " has no zoom entry");
      const f = s.optics[s.factory.optic];
      if (!f || f.adsFov !== WEAPONS[w].adsFov || f.adsTime !== 1) bad.push(w + ": factory optic is not identity");
      if (s.slots.mag.indexOf("extmag") >= 0 && !(s.extmag > WEAPONS[w].mag)) bad.push(w + ": extmag not larger");
    }
    ok(bad.length === 0, "every compat entry resolves; factory optics are identity (" + (bad.join("; ") || "clean") + ")");
    const gated = A.ATTACH_IDS.filter((id) => id !== "irons");
    ok(gated.every((id) => id in PR.ATTACH_UNLOCKS) && Object.keys(PR.ATTACH_UNLOCKS).every((id) => A.ATTACHMENTS[id]),
      "attachment ids == progression ATTACH_UNLOCKS (" + gated.length + " gated + folding irons)");
    const wc = Object.keys(PR.WEAPON_CAMO_UNLOCKS), pc = Object.keys(PR.UNLOCKS).filter((k) => /^camo:/.test(k)).map((k) => k.slice(5));
    ok(A.CAMO_IDS.length === 9 && wc.every((id) => A.CAMOS[id] && A.CAMOS[id].scope === "weapon") &&
      pc.every((id) => A.CAMOS[id] && A.CAMOS[id].scope === "player"), "the 9 camo ids match progression's weapon + player camo keys");
    ok(A.camoKey("warden", "gunmetal") === "camo:warden:gunmetal" && A.camoKey("pike", "ember") === "camo:ember", "camo keys route to the right ladder");
    ok(A.attachKey("warden", "reddot") === null && A.attachKey("vesper", "suppressor") === null && A.attachKey("pike", "reddot") === "attach:pike:reddot",
      "factory parts are never locked; the same id on another gun is");
    const lines = A.describeAttachment("warden", "suppressor", WEAPONS.warden);
    ok(lines.some((l) => l.good) && lines.some((l) => !l.good), "every attachment shows a pro AND a con (suppressor: " + lines.map((l) => l.text).join(" / ") + ")");
    let allTrade = true;
    for (const w of Object.keys(G.weapons)) for (const sl of A.SLOTS) for (const id of G.weapons[w].slots[sl]) {
      if (G.weapons[w].factory[sl] === id || !A.ATTACHMENTS[id]) continue;
      const d = A.describeAttachment(w, id, WEAPONS[w]);
      if (sl !== "optic" && !(d.some((l) => l.good) && d.some((l) => !l.good))) { allTrade = false; console.error("   no trade-off: " + w + " " + id); }
    }
    ok(allTrade, "every non-optic attachment on every weapon has an honest trade-off");
  }

  // ===================================================== 2. legacy unchanged
  section("legacy: no build = the weapon exactly as weapon_data ships it");
  {
    ok(A.effectiveWeapon(WEAPONS.warden, "warden", []) === WEAPONS.warden, "empty build returns THE base table (same object)");
    ok(A.weaponForBody(WEAPONS, {}, "warden") === WEAPONS.warden && A.weaponForBody(WEAPONS, null, "pike") === WEAPONS.pike &&
      A.weaponForBody(WEAPONS, { kit: { builds: {} } }, "corvus") === WEAPONS.corvus, "bodies without a build fire the shared table");
    const legacy = { ...C.DEFAULT_CLASSES[0] }; delete legacy.builds;
    ok(C.validateClass(legacy, 0).fixed === 0, "a pre-gunsmith class record validates with nothing to repair");
    ok(C.DEFAULT_CLASSES.every((c, i) => C.validateClass(c, i).fixed === 0), "the five defaults still validate clean");
    // player state from a legacy class == from the same class with an explicit empty build
    const h = (cls) => { const { sim } = matchSim(77, { enabled: true, classId: 0, player: cls }); run(sim, 120);
      return djb2(JSON.stringify(sim.state.player.weapon) + JSON.stringify(sim.state.player._slotAmmo)); };
    ok(h(legacy) === h({ ...legacy, builds: {} }) && h(legacy) === h({ ...legacy, builds: { warden: { attach: [], camo: null } } }),
      "legacy class, builds:{} and an empty warden build deploy identically");
    const camp = gunSim("warden", []);
    ok(camp.wt === WEAPONS.warden, "campaign stage: no kit build -> base warden");
  }

  // ============================================================ 3. validation
  section("validation + progression gate");
  {
    const r = A.validateBuild("warden", { attach: ["laser", "holo", "grip", "reddot", "railgun", "suppressor", "compensator", "extmag", "rapidfire"], camo: "plaid" });
    ok(r.fixed > 0 && r.build.attach.join(",") === "holo,suppressor,laser,extmag" && r.build.camo === null,
      "dup slot / factory / unknown dropped, slot order, cap " + A.MAX_ATTACH + ", bad camo -> none (" + r.build.attach.join(",") + ")");
    ok(A.validateBuild("pike", { attach: ["scope", "grip"] }).build.attach.length === 0, "incompatible parts (pistol scope / grip) rejected");
    ok(A.validateBuild("vesper", { attach: ["compensator"], camo: "ember" }).fixed === 0, "a legal build validates clean");
    const cls = { ...C.DEFAULT_CLASSES[0], builds: { warden: { attach: ["holo", "suppressor", "extmag"], camo: "gunmetal" }, pike: { attach: ["reddot"], camo: "harbour" }, railgun: { attach: [] } } };
    const v = C.validateClass(cls, 0);
    ok(v.fixed === 1 && !v.cls.builds.railgun && v.cls.builds.warden.attach.length === 3, "class: unknown weapon build dropped, legal ones kept");
    const lv = { "attach:warden:holo": false, "camo:warden:gunmetal": false };
    const kit = C.resolveKit(cls, { isUnlocked: (k) => lv[k] !== false });
    ok(kit.builds.warden.attach.join(",") === "suppressor,extmag" && kit.builds.warden.camo === null && kit.builds.pike.camo === "harbour",
      "resolveKit drops a locked holo + locked camo, keeps the rest");
    const prog = PR.createProgression({}, { storage: null });
    const k2 = C.resolveKit(cls, { isUnlocked: prog.isUnlocked });
    ok(!k2.builds.warden && !k2.builds.pike, "a fresh level-1 profile: every attachment + camo locked -> stock guns");
    const k3 = C.resolveKit({ ...C.DEFAULT_CLASSES[2], builds: { corvus: { attach: ["holo"] } } }, {});
    ok(k3.builds.corvus.attach[0] === "holo", "no gate (opponents / tests) -> build as written");
    // store round trip
    const mem = new Map(); const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, x) => mem.set(k, String(x)) };
    const L = LS.createLoadouts({ storage: st });
    ok(L.update(0, { build: { weapon: "warden", attach: ["holo", "grip"], camo: "slate" } }) && L.get(0).builds.warden.attach.join(",") === "holo,grip",
      "store: set a build");
    ok(!L.update(0, { build: { weapon: "warden", attach: ["scope", "holo"] } }) || L.get(0).builds.warden.attach.join(",") !== "scope,holo",
      "store: an illegal build is never saved as written");
    const L2 = LS.createLoadouts({ storage: st });
    ok(L2.get(0).builds.warden.camo === "slate" && L2.get(0).builds.warden.attach.join(",") === "holo,grip", "store: build + camo survive a reload");
    ok(L2.matchSpec(null).player.builds.warden.attach.length === 2, "store: the match spec carries the build");
  }

  // ===================================================== 4. measured effects
  section("every attachment's effect, measured in the sim");
  const adsTicks = (w, a) => { const { sim, p } = gunSim(w, a); let n = 0; while (p.weapon.adsT < 1 && n < 200) { sim.step(cmd({ ads: true })); n++; } return n; };
  const fireFor = (w, a, ticks, extra) => { const g = gunSim(w, a); g.p.weapon.mag = 999; run(g.sim, ticks, cmd(Object.assign({ fire: true }, extra || {}))); return g; };
  const shotsOf = (g) => g.events.filter((e) => e.type === "shot" && e.data.shooter === "P" && !e.data.impactOnly && !(e.data.pellet > 0));
  {
    // ADS time
    const base = adsTicks("warden", []), holo = adsTicks("warden", ["holo"]), irons = adsTicks("warden", ["irons"]), scope = adsTicks("warden", ["scope"]);
    ok(irons < base && base < holo && holo < scope, `warden ADS ticks: irons ${irons} < dot ${base} < holo ${holo} < scope ${scope}`);
    const cs = adsTicks("corvus", []), cd = adsTicks("corvus", ["reddot"]);
    ok(cd < cs * 0.85, `corvus: swapping the scope for a red dot shoulders faster (${cs} -> ${cd} ticks)`);
    const adsAfter = (a, n) => { const { sim, p } = gunSim("warden", a); run(sim, n, cmd({ ads: true })); return p.weapon.adsT; };
    const c0 = adsAfter([], 9), c1 = adsAfter(["compensator"], 9);
    ok(c1 < c0 && near(c0 / c1, 1.06, 0.001), `compensator +6% ADS time (adsT after 9 ticks ${c0.toFixed(3)} -> ${c1.toFixed(3)})`);
  }
  {
    // magazine + reload
    const g = gunSim("warden", ["extmag"]);
    ok(g.p.weapon.mag === 40 && g.p.weapon.reserve === 160 && g.wt.reloadS > WEAPONS.warden.reloadS, `warden EXT MAG: 40 rounds (reserve 160), reload ${g.wt.reloadS}s vs ${WEAPONS.warden.reloadS}s`);
    g.p.weapon.mag = 10;
    g.sim.step(cmd({ reload: true }));
    let n = 0; while (g.p.weapon.state === "reloading" && n < 600) { g.sim.step(cmd({})); n++; }
    const b = gunSim("warden", []); b.p.weapon.mag = 10; b.sim.step(cmd({ reload: true }));
    let m = 0; while (b.p.weapon.state === "reloading" && m < 600) { b.sim.step(cmd({})); m++; }
    ok(g.p.weapon.mag === 40 && n > m, `reload refills to 40 and takes longer (${n} vs ${m} ticks)`);
    const sh = gunSim("breaker", ["extmag"]);
    ok(sh.p.weapon.mag === 8 && sh.wt.reload.perShellS === WEAPONS.breaker.reload.perShellS, "breaker tube extension: 8 shells, same per-shell cadence");
    ok(gunSim("pike", ["extmag"]).p.weapon.mag === 17 && gunSim("corvus", ["extmag"]).p.weapon.mag === 20 && gunSim("vesper", ["extmag"]).p.weapon.mag === 45,
      "pike 17 / corvus 20 / vesper 45 with EXT MAG");
  }
  {
    // fire rate
    for (const w of ["warden", "vesper"]) {
      const a = shotsOf(fireFor(w, [], 600)).length, b = shotsOf(fireFor(w, ["rapidfire"], 600)).length;
      const ea = A.cadenceRpm(WEAPONS[w]) / 6, eb = A.cadenceRpm(A.effectiveWeapon(WEAPONS[w], w, ["rapidfire"])) / 6;
      ok(b > a && Math.abs(a - ea) <= 1 && Math.abs(b - eb) <= 1,
        `RAPID FIRE ${w}: ${a} -> ${b} rounds in 10 s held (cadence ${A.cadenceRpm(WEAPONS[w])} -> ${A.cadenceRpm(A.effectiveWeapon(WEAPONS[w], w, ["rapidfire"]))} rpm, as the UI states)`);
    }
  }
  {
    // [polish v149] RAPID FIRE's REAL gain (delivered rounds, 60 Hz) is +8-12% on every gun
    for (const w of ["warden", "vesper", "breaker", "corvus", "pike"]) {
      const c0 = A.cadenceRpm(WEAPONS[w]), c1 = A.cadenceRpm(A.effectiveWeapon(WEAPONS[w], w, ["rapidfire"]));
      const g = c1 / c0 - 1;
      ok(g >= 0.08 && g <= 0.12, `RAPID FIRE ${w}: delivered ${c0.toFixed(1)} -> ${c1.toFixed(1)} rpm (+${(g * 100).toFixed(1)}%, band 8-12%)`);
    }
  }
  {
    // recoil: the sim owns the climb headless (simRecoil) -> measure the bullet's pitch drift over a burst
    // full ADS (warden ads spread 0): each bullet leaves along aim + its pattern step
    const climb = (a) => { const g = gunSim("warden", a); g.p.weapon.mag = 999; run(g.sim, 40, cmd({ ads: true }));
      run(g.sim, 60, cmd({ ads: true, fire: true })); const s = shotsOf(g);
      let v = 0, h = 0; for (const e of s) { v += Math.asin(e.data.dir[1]); h += Math.abs(Math.atan2(-e.data.dir[0], -e.data.dir[2])); }
      return { v: v / s.length, h: h / s.length }; };
    // recoil kicks the AIM in the sim only for bots; with simRecoil the step lands on the bullet, so
    // compare the pattern the sim applies via the effective table directly as well
    const e0 = A.effectiveWeapon(WEAPONS.warden, "warden", ["compensator"]), e1 = A.effectiveWeapon(WEAPONS.warden, "warden", ["grip"]);
    const sum = (w, k) => w.recoil.pattern.reduce((s, r) => s + Math.abs(r[k]), 0);
    ok(near(sum(e0, 1) / sum(WEAPONS.warden, 1), 0.80) && near(sum(e0, 0), sum(WEAPONS.warden, 0)), "COMPENSATOR: pattern pitch x0.80, yaw untouched");
    ok(near(sum(e1, 0) / sum(WEAPONS.warden, 0), 0.70) && near(sum(e1, 1) / sum(WEAPONS.warden, 1), 0.95), "FORE GRIP: pattern yaw x0.70, pitch x0.95");
    const rf = A.effectiveWeapon(WEAPONS.warden, "warden", ["rapidfire"]);
    ok(near(sum(rf, 1) / sum(WEAPONS.warden, 1), 1.15), "RAPID FIRE: pattern x1.15");
    // measured on a firing bot-path shooter? the player probe is enough: bullets follow the pattern with simRecoil
    const c0 = climb([]), c1 = climb(["compensator"]);
    const c2 = climb(["grip"]);
    ok(near(c1.v / c0.v, 0.80, 0.03) && near(c1.h / c0.h, 1, 0.03), `measured ADS kick per round: pitch ${(c0.v * 57.3).toFixed(3)} -> ${(c1.v * 57.3).toFixed(3)} deg with COMPENSATOR, yaw unchanged`);
    ok(near(c2.h / c0.h, 0.70, 0.03), `measured yaw per round ${(c0.h * 57.3).toFixed(3)} -> ${(c2.h * 57.3).toFixed(3)} deg with FORE GRIP`);
  }
  {
    // hip spread (shared crosshair model) + laser sprint-to-fire
    const hip = (a) => { const g = fireFor("warden", a, 2); return g.p.weapon._lastSpread; };
    const h0 = hip([]), h1 = hip(["laser"]);
    ok(near(h1 / h0, 0.75, 1e-6), `LASER: live hip cone ${(h0 * 57.3).toFixed(3)} -> ${(h1 * 57.3).toFixed(3)} deg (x0.75)`);
    const firstShotAfterSprint = (a) => {
      const g = gunSim("warden", a); g.p.weapon.mag = 999;
      run(g.sim, 60, cmd({ moveZ: 1, sprint: true }));
      let n = 0; while (!shotsOf(g).length && n < 120) { g.sim.step(cmd({ fire: true })); n++; }
      return n; };
    const s0 = firstShotAfterSprint([]), s1 = firstShotAfterSprint(["laser"]);
    ok(s1 < s0, `LASER: first round out of a sprint after ${s1} ticks vs ${s0}`);
  }
  {
    // range (fall-off) and the suppressed / tracer flags
    const sup = A.effectiveWeapon(WEAPONS.warden, "warden", ["suppressor"]);
    ok(near(sup.damage.falloffEnd, WEAPONS.warden.damage.falloffEnd * 0.85) &&
      B.falloffDamage(sup, 45) < B.falloffDamage(WEAPONS.warden, 45) && B.falloffDamage(sup, 10) === B.falloffDamage(WEAPONS.warden, 10),
      `SUPPRESSOR: fall-off ${WEAPONS.warden.damage.falloffStart}-${WEAPONS.warden.damage.falloffEnd} m -> ${sup.damage.falloffStart}-${sup.damage.falloffEnd} m (45 m: ${B.falloffDamage(WEAPONS.warden, 45).toFixed(1)} -> ${B.falloffDamage(sup, 45).toFixed(1)}), close range untouched`);
    const s = shotsOf(fireFor("warden", ["suppressor"], 30)), n = shotsOf(fireFor("warden", [], 30));
    ok(s.length > 3 && s.every((e) => e.data.suppressed === true && e.data.tracer === false), "suppressed warden: every shot event suppressed:true, no tracers");
    ok(n.every((e) => e.data.suppressed === false) && n.some((e) => e.data.tracer), "stock warden: suppressed false, tracers as before");
    const v = shotsOf(fireFor("vesper", [], 30)), vc = shotsOf(fireFor("vesper", ["compensator"], 30));
    ok(v.every((e) => e.data.suppressed === true) && v.some((e) => e.data.tracer), "stock vesper: integral can -> suppressed:true, tracers unchanged");
    ok(vc.every((e) => e.data.suppressed === false), "vesper + COMPENSATOR: the can is gone -> not suppressed");
  }
  {
    // movement
    const speed = (a, extra) => { const g = gunSim("warden", a); run(g.sim, 90, cmd(Object.assign({ moveZ: 1 }, extra || {}))); return Math.hypot(g.p.vel[0], g.p.vel[2]); };
    const v0 = speed([]), v1 = speed(["grip"]);
    ok(near(v1 / v0, 0.96, 0.002), `FORE GRIP: walk ${v0.toFixed(3)} -> ${v1.toFixed(3)} m/s (x${(v1 / v0).toFixed(3)})`);
    const a0 = speed([], { ads: true }), a1 = speed(["scope"], { ads: true });
    ok(near(a1 / a0, 0.85, 0.003), `SCOPE: aimed walk ${a0.toFixed(3)} -> ${a1.toFixed(3)} m/s`);
  }
  {
    // optic view fields (the sim ignores them; the view reads them)
    const s = A.effectiveWeapon(WEAPONS.warden, "warden", ["scope"]);
    const d = A.effectiveWeapon(WEAPONS.corvus, "corvus", ["reddot"]);
    ok(s.adsFov === 30 && s.view.scope === true && s.gunsmith.optic === "scope", "warden + SCOPE: 30 deg ADS FOV, full lens");
    ok(d.adsFov === 52 && d.view.scope === false && d.view.adsZoom === undefined && WEAPONS.corvus.view.scope === true, "corvus + RED DOT: no lens, base table untouched");
    ok(A.effectiveWeapon(WEAPONS.warden, "warden", ["holo", "grip"]) === A.effectiveWeapon(WEAPONS.warden, "warden", ["holo", "grip"]), "effective tables are memoised (same object)");
  }

  // ===================================================== 5. class matches
  section("class matches: the human's build + every operator's build");
  {
    const cls = { ...C.DEFAULT_CLASSES[0], builds: { warden: { attach: ["extmag", "suppressor"], camo: "slate" } } };
    const { sim, events } = matchSim(13, { enabled: true, classId: 0, player: cls });
    run(sim, 2);
    const p = sim.state.player;
    ok(p.weapon.id === "warden" && p.weapon.mag === 40 && p._slotAmmo.warden.mag === 40 && p.kit.builds.warden.camo === "slate",
      "deploys with the build: 40-round warden, camo on the kit");
    const bots = sim.state.bots.filter((b) => b.alive);
    const withB = bots.filter((b) => b.kit.builds && Object.keys(b.kit.builds).length);
    ok(withB.length >= 4, `operators carry builds (${withB.length}/9: ${withB.map((b) => b.kit.primary + "[" + ((b.kit.builds[b.kit.primary] || {}).attach || []).join("+") + "]").join(" ")})`);
    ok(bots.every((b) => b.weapon.mag === sim.weaponOf(b, b.weapon.id).mag), "each operator's mag matches its own effective table");
    let allValid = true;
    for (let s = 1; s <= 60; s++) for (const arch of ["cqb_a", "rifleman_b", "marksman_a"]) {
      const k = C.opponentClass(s, s % 9 + 1, arch);
      if (C.validateClass(k, 0).fixed !== 0) { allValid = false; console.error("   invalid opponent class", s, arch, JSON.stringify(k.builds)); }
    }
    ok(allValid, "opponentClass builds always validate clean (180 draws)");
    ok(JSON.stringify(C.opponentClass(5, 3, "rifleman_a")) === JSON.stringify(C.opponentClass(5, 3, "rifleman_a")), "opponent build is a pure function of (seed, actor)");
    // a suppressed operator's shots carry the flag
    run(sim, 60 * 20);
    const supIds = new Set(sim.state.bots.filter((b) => sim.weaponOf(b, b.weapon.id).suppressed).map((b) => b.id));
    const botShots = events.filter((e) => e.type === "shot" && e.data.shooter !== "P" && !e.data.impactOnly);
    ok(botShots.every((e) => !!e.data.suppressed === supIds.has(e.data.shooter) || !sim.state.bots.find((b) => b.id === e.data.shooter)),
      `operator shot events carry suppressed exactly when their gun is (${botShots.length} shots, ${supIds.size} suppressed shooters)`);
  }
  {
    const h = (seed) => {
      const cls = { ...C.DEFAULT_CLASSES[1], builds: { vesper: { attach: ["laser", "extmag", "rapidfire"], camo: "ember" }, pike: { attach: ["reddot"] } } };
      const { sim } = matchSim(seed, { enabled: true, classId: 1, player: cls });
      run(sim, 60 * 12, cmd({ moveZ: 1, fire: true }));
      return djb2(JSON.stringify(sim.snapshot()));
    };
    const h1 = h(91), h2 = h(91), h3 = h(92);
    ok(h1 === h2, "12 s of a gunsmith class match twice: identical snapshot hash (" + h1 + ")");
    ok(h1 !== h3, "a different seed diverges (" + h3 + ")");
  }

  console.log("\n" + "=".repeat(64));
  console.log(`attachments.selftest: ${passed} passed, ${failed} failed`);
  console.log(failed ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
