// core/meta/migration.selftest.cjs — a RETURNING player's first load after an
// update (polish v149, gap 14). Old saves from before each lane landed must
// load with nothing lost:
//   - settings: a v1 flat record and a v2 record written before the newer keys
//     (colorblind, teamChat, kbAds, ...) existed
//   - classes: a record from before the tactical slot and the gunsmith builds
//   - progress: a v1 record from before challenges existed (no challenge save);
//     challenges seed their career from it WITHOUT paying retroactive XP
//   - mmr: no record at all → the start tier; a record keeps its history
// THREE-free, DOM-free.   node core/meta/migration.selftest.cjs
const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg); } }
function memStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  const SET = await imp("core/settings.js");
  const L = await imp("core/meta/loadouts.js");
  const P = await imp("core/meta/progression.js");
  const C = await imp("core/meta/challenges.js");
  const SK = await imp("core/meta/skill.js");

  console.log("== settings ==");
  {
    // a v2 record saved by a build that predates the newer keys
    const old = { v: 2, values: { quality: "high", fov: 88, sens: 0.6, subtitles: "off", killcam: "off", minimap: "off" } };
    const r = SET.loadRecord(memStorage({ [SET.RECORD_KEY]: JSON.stringify(old) }));
    let kept = true;
    for (const [k, v] of Object.entries(old.values)) if (r.values[k] !== v) { kept = false; console.log("    lost", k, v, "->", r.values[k]); }
    ok(r.from === "v2" && kept, "a pre-update v2 record keeps every value it had (6 keys)");
    ok(r.values.colorblind === "off" && r.values.teamChat === "strip", "keys added since then take their defaults (colour-blind off, callouts in the chat strip)");
    const v1 = { quality: "low", fov: 80, sens: 0.4 };
    const r1 = SET.loadRecord(memStorage({ [SET.LEGACY_KEY_V1]: JSON.stringify(v1) }));
    ok(r1.from === "v1" && r1.values.fov === 80 && r1.values.sens === 0.4 && r1.values.quality === "low" && r1.values.teamChat === "strip",
      "a v1 flat record migrates, values kept, new keys defaulted");
  }

  console.log("== classes (before tactical + gunsmith) ==");
  {
    const oldRec = {
      v: 1, selected: 3, playlist: "classes",
      classes: [
        { name: "MY RIFLE", primary: "warden", secondary: "pike", lethal: "frag", perks: ["doubleTime", "fastHands", "quickfix"] },
        { name: "CLOSE", primary: "vesper", secondary: "pike", lethal: "claymore", perks: ["scavenger", "hardline", "deadsilence"] },
        { name: "LONG", primary: "corvus", secondary: "pike", lethal: "frag", perks: ["flak", "ghost", "quickfix"] },
        { name: "DOOR", primary: "breaker", secondary: "pike", lethal: "frag", perks: ["doubleTime", "fastHands", "deadsilence"] },
        { name: "SCOUT", primary: "warden", secondary: "pike", lethal: "frag", perks: ["scavenger", "ghost", "deadsilence"] },
      ],
    };
    const st = memStorage({ [L.STORE_KEY]: JSON.stringify(oldRec) });
    const lo = L.createLoadouts({ storage: st });
    const cls = lo.classes();
    let same = true;
    cls.forEach((c, i) => {
      const o = oldRec.classes[i];
      if (c.name !== o.name || c.primary !== o.primary || c.secondary !== o.secondary || c.lethal !== o.lethal || c.perks.join() !== o.perks.join()) { same = false; console.log("    changed", i, JSON.stringify(c)); }
    });
    ok(same, "all five classes keep name, guns, lethal and perks");
    ok(lo.selected() === 3 && lo.playlist() === "classes", "the selected class (4) and playlist survive");
    ok(cls.every((c) => typeof c.tactical === "string" && c.tactical.length > 0), "each class gains a tactical slot (" + cls.map((c) => c.tactical).join(",") + ")");
    ok(cls.every((c) => c.builds && Object.keys(c.builds).length === 0), "no gunsmith build invented (factory guns)");
    const saved = JSON.parse(st.getItem(L.STORE_KEY));
    ok(saved.classes[1].name === "CLOSE" && saved.classes[1].lethal === "claymore" && saved.selected === 3, "the repaired record is written back with the old choices in it");
  }

  console.log("== progress before challenges ==");
  {
    const KEY = P.SAVE_KEY + ".v" + P.SAVE_VERSION;
    const old = { v: 1, xp: 41000, weapons: { warden: { xp: 9000, kills: 140, heads: 30 }, vesper: { xp: 1200, kills: 20, heads: 2 } },
      life: { matches: 31, wins: 17, missions: 2, kills: 260, heads: 44, assists: 50, caps: 9, bestStreak: 12 }, seen: ["weapon:vesper"], updated: 1 };
    const st = memStorage({ [KEY]: JSON.stringify(old) });
    const ctx = { sim: () => null };
    const prog = P.createProgression(ctx, { storage: st });
    ok(prog.xp() === 41000 && prog.weaponXp("warden") === 9000 && prog.status.load === "ok", "XP and weapon XP load unchanged (41000 / warden 9000)");
    const awards = [];
    const fakeP = { award: (c, n) => awards.push(n), isUnlocked: () => true, onSessionEnd() {}, onEvent() {},
      get lifetime() { return prog.lifetime; }, get state() { return prog.state; } };
    const ch = C.createChallenges(ctx, fakeP, { storage: st, now: () => Date.UTC(2026, 10, 13, 12) });
    const kills = ch.career().find((c) => c.id === "c_kills");
    ok(kills && kills.value >= 260, "career kills seeded from the old lifetime total (" + (kills && kills.value) + ")");
    ok(awards.length === 0, "seeding pays no retroactive XP");
    ok(prog.xp() === 41000, "progress untouched by the challenges' first load");
    ok(st.m.has(KEY) && JSON.parse(st.getItem(KEY)).life.kills === 260, "the progress record on disk still holds the old lifetime");
  }

  console.log("== matchmaking record ==");
  {
    const none = SK.createSkillRecord({ storage: memStorage() });
    ok(none.record() === null && Number.isInteger(none.startTier()), "no record → the start tier, nothing written");
    const st = memStorage({ [SK.SKILL_KEY]: JSON.stringify({ v: 1, n: 7, hist: [0.5, 0.6], est: 0.58, tier: 3 }) });
    const r = SK.createSkillRecord({ storage: st });
    ok(r.record().n === 7 && r.record().tier === 3 && r.record().hist.length === 2, "an existing record keeps its history and tier");
  }

  console.log(`migration selftest: ${pass} passed, ${fail} failed`);
  console.log(fail ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("RESULT: FAIL"); process.exit(1); });
