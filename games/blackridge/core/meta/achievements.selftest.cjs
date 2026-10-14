// core/meta/achievements.selftest.cjs — achievements.json <-> detectors contract,
// and every detector fires on the event that should fire it (and only that one).
//   node core/meta/achievements.selftest.cjs
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg); } }

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const json = JSON.parse(fs.readFileSync(path.join(root, "achievements.json"), "utf8"));
  const rows = json.achievements;
  const calls = [];
  globalThis.window = { ForgeFlow: { unlockAchievement: (s) => calls.push(s) } };
  const A = await import(pathToFileURL(path.join(root, "core", "meta", "achievements.js")).href);

  console.log("== contract ==");
  const jsonSlugs = rows.map((r) => r.slug).sort();
  const detSlugs = Object.keys(A.DETECTORS).sort();
  ok(JSON.stringify(jsonSlugs) === JSON.stringify(detSlugs),
    "achievements.json slugs == DETECTORS slugs (" + jsonSlugs.length + ")");
  const PTS = { bronze: 5, silver: 15, gold: 30, diamond: 60 };
  ok(rows.every((r) => PTS[r.tier] === r.points), "points match tier (bronze 5 / silver 15 / gold 30 / diamond 60)");
  ok(new Set(jsonSlugs).size === jsonSlugs.length, "slugs unique");
  ok(!rows.some((r) => /\b(bots?|ai|npc|difficulty)\b/i.test(r.name + " " + r.description)),
    "no achievement text mentions bots / AI / NPCs / difficulty");

  console.log("== detectors ==");
  let simTime = 0;
  const player = { weapon: { id: "warden" } };
  let mission = null;
  const ctx = { sim: () => ({ state: { time: simTime, player }, match: null, mission }) };
  const handlers = {};
  const bridge = { register: (k, fn) => { (handlers[k] = handlers[k] || []).push(fn); } };
  const ach = A.createAchievements(ctx);
  ach.attach(bridge);
  const fire = (k, d) => (handlers[k] || []).forEach((fn) => fn(d));
  const got = () => new Set(calls);

  fire("death", { attacker: 7, victim: "P" });
  ok(!got().has("first_kill"), "being killed unlocks nothing");
  fire("shot", { shooter: "P", weaponId: "vesper" });
  fire("death", { attacker: "P", victim: 3, headshot: true });
  ok(got().has("first_kill") && got().has("first_headshot"), "a headshot kill -> first_kill + first_headshot");
  fire("medal", { text: "LONGSHOT" }); fire("medal", { text: "REVENGE" }); fire("medal", { text: "FIRST BLOOD" });
  ok(["medal_longshot", "medal_revenge", "medal_firstblood"].every((s) => got().has(s)), "LONGSHOT / REVENGE / FIRST BLOOD medals");
  fire("medal", { text: "DOUBLE KILL" });
  ok(!got().has("multi_triple"), "a DOUBLE KILL is not a triple");
  fire("medal", { text: "QUAD KILL" });
  ok(got().has("multi_triple") && got().has("multi_quad"), "QUAD KILL -> triple + quad");
  for (const id of ["recon", "mortar", "airstrike", "orbital"]) fire("streak", { phase: "earned", id });
  ok(["streak_sweep", "streak_mortar", "streak_airstrike", "streak_orbital"].every((s) => got().has(s)), "every streak tier");
  ok(!got().has("call_in"), "earning is not calling in");
  fire("streak", { phase: "call", id: "recon" });
  ok(!got().has("call_in"), "launching the sweep is not a call-in");
  fire("streak", { phase: "call", id: "mortar" });
  ok(got().has("call_in"), "calling the mortar -> call_in");
  fire("flag", { state: "captured", byWho: 4 });
  ok(!got().has("ctf_capture"), "someone else's capture does not count");
  fire("flag", { state: "captured", byWho: "P" });
  ok(got().has("ctf_capture"), "your capture -> ctf_capture");

  // weapons: one kill with each
  for (const w of ["warden", "breaker", "corvus", "pike"]) {
    simTime += 2; fire("shot", { shooter: "P", weaponId: w }); fire("death", { attacker: "P", victim: 9 });
  }
  ok(got().has("full_kit"), "a kill with all five weapons -> full_kit");

  // wins: 3 modes x 3 arenas
  for (const map of ["lanternwalk", "switchyard", "saltmarket"]) {
    for (const mode of ["tdm", "ctf", "ffa"]) {
      fire("match:start", { mode, map });
      fire("mission:end", { result: mode === "ffa" && map === "saltmarket" ? "lost" : "won", match: { modeId: mode } });
    }
  }
  ok(got().has("win_skirmish") && got().has("win_ctf") && got().has("win_ffa"), "a win in each mode");
  ok(got().has("all_arenas"), "wins on all three arenas -> all_arenas");
  ok(!got().has("grand_tour"), "8 of 9 mode x arena wins is not the grand tour");
  fire("match:start", { mode: "ffa", map: "saltmarket" });
  fire("mission:end", { result: "won", match: { modeId: "ffa" } });
  ok(got().has("grand_tour"), "the ninth -> grand_tour");

  // campaign
  mission = { difficulty: "standard" };
  fire("mission:end", { result: "won" });
  ok(got().has("campaign_clear") && !got().has("campaign_hard"), "campaign clear on standard");
  mission = { difficulty: "hard" };
  fire("mission:end", { result: "won" });
  ok(got().has("campaign_hard"), "campaign clear on HARD");

  // lifetime counters
  for (let i = 0; i < 110; i++) fire("death", { attacker: "P", victim: 20 + i, headshot: i < 30 });
  ok(got().has("kills_100") && got().has("headshots_25") && !got().has("headshots_100") && !got().has("kills_500"),
    "lifetime thresholds fire at 100 kills / 25 headshots, not before 500 / 100");

  const n = calls.length;
  fire("medal", { text: "LONGSHOT" });
  ok(calls.length === n, "an achievement is sent at most once per session");
  ok(detSlugs.filter((s) => got().has(s)).length === detSlugs.length - 2, "all but kills_500 / headshots_100 reached in this run");

  console.log(`achievements.selftest: ${pass} passed, ${fail} failed`);
  console.log(fail ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("RESULT: FAIL"); process.exit(1); });
