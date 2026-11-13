// core/meta/progression.selftest.cjs — level curve, award math, save / migrate /
// corrupt-recover / quota, and the unlock-query API. THREE-free and DOM-free.
//   node core/meta/progression.selftest.cjs
const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg); } }

function memStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    m, quota: Infinity, writes: 0,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (String(v).length > this.quota) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } this.writes++; m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const P = await import(pathToFileURL(path.join(root, "core", "meta", "progression.js")).href);
  const KEY = P.SAVE_KEY + ".v" + P.SAVE_VERSION;

  console.log("== curve ==");
  let mono = true, incr = true;
  for (let L = 1; L < P.MAX_LEVEL; L++) {
    if (!(P.levelFloor(L + 1) > P.levelFloor(L))) mono = false;
    if (L > 1 && !(P.xpToNext(L) > P.xpToNext(L - 1))) incr = false;
  }
  ok(mono, "level floors strictly increase 1.." + P.MAX_LEVEL);
  ok(incr, "per-level cost strictly increases");
  ok(P.levelForXp(0) === 1 && P.levelForXp(P.xpToNext(1) - 1) === 1 && P.levelForXp(P.xpToNext(1)) === 2, "level 2 begins exactly at xpToNext(1)");
  ok(P.levelForXp(P.MAX_XP) === P.MAX_LEVEL && P.levelForXp(P.MAX_XP * 10) === P.MAX_LEVEL, "cap at level " + P.MAX_LEVEL);
  let roundTrip = true;
  for (let L = 1; L <= P.MAX_LEVEL; L++) if (P.levelForXp(P.levelFloor(L)) !== L || (L > 1 && P.levelForXp(P.levelFloor(L) - 1) !== L - 1)) roundTrip = false;
  ok(roundTrip, "levelForXp(levelFloor(L)) == L at every boundary");
  ok(P.MAX_XP > 300000 && P.MAX_XP < 800000, "max-level XP in a sane band (" + P.MAX_XP + ")");
  let wmono = true;
  for (let l = 1; l < P.MAX_WEAPON_LEVEL; l++) if (!(P.weaponLevelFloor(l + 1) > P.weaponLevelFloor(l))) wmono = false;
  ok(wmono && P.weaponLevelForXp(P.weaponLevelFloor(P.MAX_WEAPON_LEVEL) + 1e6) === P.MAX_WEAPON_LEVEL, "weapon curve monotone and capped at " + P.MAX_WEAPON_LEVEL);
  ok(P.RANKS.length * 5 === P.MAX_LEVEL && P.rankName(1) === "Deckhand I" && P.rankName(55) === "Harbourmaster V", "55 rank names (11 ranks x 5 grades)");
  const allText = P.RANKS.join(" ") + " " + Object.values(P.UNLOCK_NAMES).join(" ") + " " + Object.values(P.CATEGORY_LABELS).join(" ");
  ok(!/\b(bots?|ai|npc|difficulty)\b/i.test(allText), "no player-facing text mentions bots / AI / NPCs / difficulty");

  console.log("== award math ==");
  let simTime = 0;
  const player = { weapon: { id: "warden" } };
  let match = { sameTeam: (a, b) => b === 99 }; // actor 99 is a teammate
  const matchState = { actors: [{ actorId: 0, kind: "human", assists: 0, bestStreak: 0, score: 0 }] };
  const ctx = { sim: () => ({ state: { time: simTime, player, match: match ? matchState : null }, match, mission: null }) };
  const store = memStorage();
  const handlers = {};
  const bridge = { register: (k, fn) => { (handlers[k] = handlers[k] || []).push(fn); } };
  const prog = P.createProgression(ctx, { storage: store });
  prog.attach(bridge);
  const fire = (k, d) => (handlers[k] || []).forEach((fn) => fn(d));
  const events = [];
  prog.onEvent((e) => events.push(e));
  let changes = 0;
  const unsub = prog.onChange(() => changes++);

  ok(prog.level() === 1 && prog.xp() === 0, "fresh profile: level 1, 0 XP");
  fire("match:start", { mode: "tdm", map: "lanternwalk" });
  fire("mission:start", { missionId: "match:tdm" });
  fire("shot", { shooter: "P", weaponId: "vesper" });
  fire("death", { attacker: "P", victim: 3, headshot: true });
  ok(prog.xp() === 150, "headshot kill = 100 + 50 (" + prog.xp() + ")");
  ok(prog.weaponXp("vesper") === 150 && prog.weaponXp("warden") === 0, "weapon XP goes to the weapon that fired (vesper 150)");
  fire("death", { attacker: "P", victim: 99 });
  ok(prog.xp() === 150, "a teammate kill earns nothing");
  fire("death", { attacker: 7, victim: "P" });
  ok(prog.xp() === 150, "being eliminated earns nothing");
  matchState.actors[0].assists = 2;
  fire("death", { attacker: 7, victim: 5 });
  ok(prog.xp() === 200, "two assists picked up from the roster = +50 (" + prog.xp() + ")");
  fire("medal", { text: "HEADSHOT" });
  ok(prog.xp() === 200, "HEADSHOT medal is not double-paid");
  fire("medal", { text: "TRIPLE KILL" }); fire("medal", { text: "MULTI KILL x6" }); fire("medal", { text: "5 KILL STREAK" });
  ok(prog.xp() === 200 + 100 + 200, "TRIPLE 100 + MULTI x6 200; streak medal 0");
  fire("streak", { phase: "earned", id: "mortar", name: "MORTAR STRIKE" });
  fire("streak", { phase: "call", id: "mortar" });
  ok(prog.xp() === 700, "mortar earned +200, calling it +0");
  fire("flag", { state: "captured", byWho: 4 });
  fire("flag", { state: "captured", byWho: "P" });
  fire("flag", { state: "returned", byWho: "P" });
  ok(prog.xp() === 1100, "your capture +300, return +100, others' capture +0");
  simTime += 5;
  fire("death", { attacker: "P", victim: 8 }); // no recent shot -> no weapon XP
  ok(prog.xp() === 1200 && prog.weaponXp("vesper") === 150, "a kill with no recent shot (call-in) earns player XP, no weapon XP");
  ok(store.m.has(KEY) && JSON.parse(store.m.get(KEY)).xp === 1200, "mid-match progress is saved");
  fire("mission:end", { result: "won", match: { modeId: "tdm", result: "win", winnerTeam: 0, actors: [{ actorId: 0, bestStreak: 4, score: 900 }] } });
  ok(prog.xp() === 2200, "completion +500 and win +500 (" + prog.xp() + ")");
  const rep = prog.lastReport;
  ok(rep && rep.total === 2200 && rep.fromLevel === 1 && rep.toLevel === P.levelForXp(2200), "report totals and levels");
  const sumCats = rep.cats.reduce((s, c) => s + c.xp, 0);
  ok(sumCats === rep.total, "category breakdown sums to the total");
  ok(rep.weapons.length === 1 && rep.weapons[0].id === "vesper" && rep.weapons[0].kills === 1, "weapon list = weapons used");
  ok(rep.highlights.bestStreak === 4 && rep.highlights.kills === 2 && rep.highlights.assists === 2, "highlights (best streak from the roster, kills, assists)");
  ok(rep.levelUps.indexOf(2) >= 0 && events.some((e) => e.type === "levelup" && e.level === 2), "level-up event and report entry");
  ok(changes > 0, "onChange fired");
  unsub();
  const c0 = changes; prog.award("objective", 10); ok(changes === c0, "onChange unsubscribe works");

  // draw / forfeit
  fire("match:start", { mode: "ffa" });
  const x0 = prog.xp();
  fire("mission:end", { result: "lost", match: { modeId: "ffa", result: "forfeit", actors: [] } });
  ok(prog.xp() === x0, "a forfeit earns no completion bonus");
  fire("match:start", { mode: "ctf" });
  const x1 = prog.xp();
  fire("mission:end", { result: "lost", match: { modeId: "ctf", result: "draw", actors: [] } });
  ok(prog.xp() === x1 + 500 + 200, "a draw = completion + 200");

  // campaign
  match = null;
  fire("mission:start", { missionId: "meridian_ward" });
  const x2 = prog.xp();
  fire("objective", { id: "a", state: "active" });
  fire("objective", { id: "a", state: "done", label: "Breach" });
  fire("mission:end", { result: "won" });
  ok(prog.xp() === x2 + 250 + 1500, "campaign: objective +250, operation complete +1500");
  ok(prog.lastReport.kind === "campaign", "campaign report kind");

  // weapon level-ups unlock attachments
  for (let i = 0; i < 10; i++) { simTime += 2; fire("shot", { shooter: "P", weaponId: "corvus" }); fire("death", { attacker: "P", victim: 50 + i }); }
  ok(prog.weaponLevel("corvus") === P.weaponLevelForXp(1000) && prog.weaponLevel("corvus") >= 3, "10 corvus kills -> weapon level " + prog.weaponLevel("corvus"));
  ok(events.some((e) => e.type === "weaponlevel" && e.weapon === "corvus" && e.unlocks.indexOf("attach:corvus:reddot") >= 0), "weapon level 2 announces its red-dot unlock");

  console.log("== unlock queries ==");
  const q = P.createProgression({}, { storage: memStorage() });
  ok(q.isUnlocked("weapon:warden") && q.isUnlocked("weapon:pike"), "AR + pistol unlocked at level 1");
  ok(!q.isUnlocked("weapon:corvus") && q.unlockLevel("weapon:corvus") === 6, "corvus locked until level 6");
  ok(q.isUnlocked("perk:does-not-exist") && q.unlockLevel("perk:does-not-exist") === null, "unknown key -> unlocked, unlockLevel null");
  ok(q.isUnlocked("") && q.isUnlocked(undefined), "empty / undefined key -> unlocked (never throws)");
  ok(!q.isUnlocked("attach:warden:suppressor") && q.unlockLevel("attach:warden:suppressor") === 4, "attachments gate on weapon level");
  ok(q.isUnlocked("attach:warden:mystery"), "unknown attachment -> unlocked");
  for (const k of ["perk:scavenger", "perk:quickfix", "perk:deadsilence", "perk:ghost", "perk:hardline", "perk:fastHands", "perk:doubleTime", "perk:flak",
    "equip:frag", "equip:flash", "equip:smoke", "equip:stun", "equip:claymore", "feature:streakChoice"]) {
    if (typeof q.unlockLevel(k) !== "number") ok(false, "unlock table has " + k);
  }
  ok(true, "unlock table covers every perk, equipment id and the call-in choice");
  q.award("kill", P.levelFloor(12));
  ok(q.level() === 12 && q.isUnlocked("weapon:corvus") && !q.isUnlocked("perk:ghost"), "level 12 opens corvus, not ghost (22)");
  ok(q.nextUnlock() && q.nextUnlock().level > 12, "nextUnlock points past the current level");

  console.log("== save / migrate / corrupt / quota ==");
  // round trip
  const s1 = memStorage();
  const a = P.createProgression({}, { storage: s1 });
  a.award("kill", 5000);
  const b = P.createProgression({}, { storage: s1 });
  ok(b.xp() === 5000 && b.status.load === "ok", "a new instance reads the saved XP back");
  // corrupt
  const s2 = memStorage({ [KEY]: "{not json" });
  const c = P.createProgression({}, { storage: s2 });
  ok(c.xp() === 0 && c.status.load === "corrupt" && s2.m.get(KEY + ".corrupt") === "{not json", "corrupt JSON -> fresh profile, bad bytes kept aside");
  ok(JSON.parse(s2.m.get(KEY)).v === P.SAVE_VERSION, "and a clean record is written");
  const s3 = memStorage({ [KEY]: JSON.stringify({ v: 1, xp: "lots", weapons: { warden: { xp: -40, kills: NaN } }, life: { kills: 1e99 } }) });
  const d3 = P.createProgression({}, { storage: s3 });
  ok(d3.xp() === 0 && d3.weaponXp("warden") === 0 && d3.lifetime.kills <= 1e12, "garbage fields are sanitised, not trusted");
  const s3b = memStorage({ [KEY]: JSON.stringify({ v: 1, xp: 1e15 }) });
  ok(P.createProgression({}, { storage: s3b }).level() === P.MAX_LEVEL, "absurd XP clamps to the cap");
  // migrate v0 (un-versioned key)
  const s4 = memStorage({ [P.SAVE_KEY]: JSON.stringify({ xp: 3000, weaponXp: { pike: 900 } }) });
  const e4 = P.createProgression({}, { storage: s4 });
  ok(e4.status.load === "migrated" && e4.xp() === 3000 && e4.weaponXp("pike") === 900, "v0 record migrates (xp + weapon xp kept)");
  ok(s4.m.has(KEY) && !s4.m.has(P.SAVE_KEY), "migrated record moves to the versioned key");
  // future version: read, never clobber
  const fut = JSON.stringify({ v: 99, xp: 7777 });
  const s5 = memStorage({ [KEY]: fut });
  const f5 = P.createProgression({}, { storage: s5 });
  f5.award("kill", 100);
  ok(f5.status.readOnly && s5.m.get(KEY) === fut && f5.xp() === 7877, "a newer build's record is read but never overwritten");
  // quota
  const s6 = memStorage();
  s6.quota = 10;
  const g6 = P.createProgression({}, { storage: s6 });
  let threw = false;
  try { g6.award("kill", 100); } catch (e) { threw = true; }
  ok(!threw && g6.xp() === 100 && g6.status.saveFailed, "quota exceeded: no throw, progress kept in memory, flagged");
  s6.quota = Infinity;
  g6.award("kill", 1);
  ok(!g6.status.saveFailed && JSON.parse(s6.m.get(KEY)).xp === 101, "recovers once storage frees up");
  // no storage at all
  const h7 = P.createProgression({}, { storage: null });
  ok(h7.award("kill", 100) === 100 && h7.level() === 1, "no storage (private mode): session-only, no throw");
  // getItem throwing
  const s8 = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {} };
  let t8 = false;
  try { const i8 = P.createProgression({}, { storage: s8 }); i8.award("kill", 5); } catch (e) { t8 = true; }
  ok(!t8, "storage that throws on every call never breaks the game");

  console.log(`progression.selftest: ${pass} passed, ${fail} failed`);
  console.log(fail ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("RESULT: FAIL"); process.exit(1); });
