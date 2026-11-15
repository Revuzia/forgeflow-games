#!/usr/bin/env node
/* core/ai/identity.selftest.cjs — operator identity (DOM-free).
 *   personality  same callsign → same traits (and same frozen object); the 12
 *                roster callsigns all differ; generated names stable; ranges sane
 *   roles        assignRoles keeps each team's archetype multiset, deterministic,
 *                long-range callsigns take the marksman slot
 *   kit          personalClass keeps the role's weapon family; DMR for marksmen
 *   knobs        applyPersonality bounded, never touches non-skill fields,
 *                mistakes paid for (reaction edge)
 *   adaptive     matchPerf range, tierFor edges + hysteresis + ≤1 step,
 *                foldMatch smoothing (≤ MAX_STEP per match), first match = tier 3,
 *                applyTier(…, 4) is the identity (same object), tiers monotonic
 *   record       core/meta/skill.js save/load round trip on a fake storage,
 *                corrupt record → first-match defaults
 * Run: node core/ai/identity.selftest.cjs   (exit 0 = all pass)
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }

(async () => {
  const P = await import(u("core/ai/personality.js"));
  const A = await import(u("core/ai/adaptive.js"));
  const SK = await import(u("core/meta/skill.js"));
  const R = await import(u("core/match/roster.js"));
  const BF = await import(u("core/ai/botfsm.js"));

  section("personality determinism");
  const names = R.CALLSIGNS;
  ok(names.length === 12, "12 roster callsigns");
  for (const n of names) {
    const a = P.personalityOf(n), b = P.personalityOf(n.toLowerCase());
    ok(a === b && JSON.stringify(a) === JSON.stringify(P.personalityOf(n)), `${n}: same traits every call`);
  }
  const sig = (p) => JSON.stringify([p.aggression, p.patience, p.range, p.move, p.style, p.mistakes, p.tactical, p.lethal, p.chat]);
  const sigs = new Set(names.map((n) => sig(P.personalityOf(n))));
  ok(sigs.size === names.length, `all 12 callsigns have distinct trait sets (${sigs.size})`);
  const g1 = P.personalityOf("ZEPHYR"), g2 = P.personalityOf("ZEPHYR"), g3 = P.personalityOf("BRANT");
  ok(g1 === g2 && !g1.authored, "a non-roster name gets a stable generated personality");
  ok(sig(g1) !== sig(g3), "two generated names differ");
  for (const n of names.concat(["ZEPHYR", "BRANT", "X1"])) {
    const p = P.personalityOf(n);
    const sane = p.aggression >= -1 && p.aggression <= 1 && p.patience >= 0 && p.patience <= 1 && p.chat >= 0 && p.chat <= 1 &&
      P.STYLES.includes(p.style) && P.MOVES.includes(p.move) && p.mistakes.length >= 1 && p.mistakes.every((m) => P.MISTAKES.includes(m));
    if (!sane) ok(false, `${n}: traits in range`);
  }
  ok(true, "every personality's traits are in range");
  const styles = new Set(names.map((n) => P.personalityOf(n).style));
  ok(styles.size === 4, "all four phrasing styles are used by the roster");

  section("roles (archetype re-deal inside each team)");
  const content = { archetypes: null };
  for (const seed of [1, 7, 42, 99, 1234]) {
    let s = seed >>> 0;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const ros = R.makeRoster(content, { rng, difficulty: "expert" });
    const before = {};
    for (const a of ros.actors) if (a.kind === "bot") (before[a.team] = before[a.team] || []).push(a.archetype);
    const copy = JSON.parse(JSON.stringify(ros.actors));
    P.assignRoles(ros.actors);
    P.assignRoles(copy);
    const after = {};
    for (const a of ros.actors) if (a.kind === "bot") (after[a.team] = after[a.team] || []).push(a.archetype);
    const same = Object.keys(before).every((k) => before[k].slice().sort().join() === after[k].slice().sort().join());
    ok(same, `seed ${seed}: each team keeps its archetype multiset`);
    ok(JSON.stringify(copy.map((a) => a.archetype)) === JSON.stringify(ros.actors.map((a) => a.archetype)), `seed ${seed}: deterministic`);
    for (const team of [0, 1]) {
      const mates = ros.actors.filter((a) => a.kind === "bot" && a.team === team);
      const mk = mates.find((a) => a.archetype.startsWith("marksman"));
      const longs = mates.filter((a) => P.personalityOf(a.name).range === "long");
      if (mk && longs.length) ok(P.personalityOf(mk.name).range === "long", `seed ${seed} team ${team}: marksman slot → a long-range callsign (${mk.name})`);
    }
    const ffa = R.makeRoster(content, { rng, difficulty: "expert", teamCount: "perActor" });
    const fb = ffa.actors.filter((a) => a.kind === "bot").map((a) => a.archetype).sort().join();
    P.assignRoles(ffa.actors);
    ok(ffa.actors.filter((a) => a.kind === "bot").map((a) => a.archetype).sort().join() === fb, `seed ${seed}: FFA multiset kept`);
  }

  section("class kit hook");
  const base = { name: "ASSAULT", primary: "warden", secondary: "pike", lethal: "frag", tactical: "flash", perks: ["a", "b", "c"], builds: { warden: { attach: ["x"] }, pike: { attach: ["y"] } } };
  const k1 = P.personalClass(base, P.personalityOf("KESTREL"), "marksman_a");
  ok(k1.primary === "corvus" && k1.tactical === "smoke" && k1.lethal === "claymore", "KESTREL as marksman: DMR + smoke + tripmine");
  ok(!k1.builds.warden && k1.builds.pike, "builds keep only the kit's guns");
  const k2 = P.personalClass(base, P.personalityOf("RASK"), "cqb_b");
  ok(k2.primary === "breaker" && k2.lethal === "frag", "RASK as entry man: shotgun + frag (no tripmines on cqb)");
  const k3 = P.personalClass(base, P.personalityOf("HOLT"), "rifleman");
  ok(k3.primary === "warden" && k3.perks === base.perks, "HOLT as rifleman: rifle, perks untouched");
  ok(JSON.stringify(P.personalClass(base, P.personalityOf("KESTREL"), "marksman_a")) === JSON.stringify(k1), "kit hook deterministic");

  section("FSM knobs");
  const vet = Object.assign({ name: "veteran" }, BF.BANDS.veteran);
  for (const n of names) {
    const p = P.personalityOf(n);
    const o = P.applyPersonality(vet, p);
    const bounded = o.reactMin >= 0.12 && o.reactMin <= vet.reactMin && o.jitter <= vet.jitter * 1.0001 &&
      o.flankP >= 0 && o.flankP <= 1 && o.rangeMul >= 0.7 && o.rangeMul <= 1.25 && o.pushReload >= 0 && o.pushReload <= 1;
    ok(bounded, `${n}: knobs bounded, mistakes paid for (react ${o.reactMin.toFixed(3)}, jitter ${o.jitter.toFixed(4)}, range x${o.rangeMul.toFixed(2)})`);
    ok(o.name === "veteran" && o.persona === p && vet.reactMin === BF.BANDS.veteran.reactMin, `${n}: band name kept, source not mutated`);
  }
  const ke = P.applyPersonality(vet, P.personalityOf("KESTREL")), ra = P.applyPersonality(vet, P.personalityOf("RASK"));
  ok(ke.huntAfterS > ra.huntAfterS && ke.flankP < ra.flankP && ke.holdWhenSeen === true, "KESTREL waits, RASK hunts and flanks");
  ok(P.applyPersonality(vet, P.personalityOf("HOLT")).missRounds >= 1, "HOLT's whiffed first shot (missRounds ≥ 1)");

  const fsim = { match: {}, state: { match: { actors: [{ actorId: 0, kind: "human", name: "YOU" }, { actorId: 1, kind: "bot", name: "KESTREL" }] } } };
  ok(P.personaOfBot(fsim, { actorId: 1 }) === P.personalityOf("KESTREL") && P.personaOfBot(fsim, { actorId: 0 }) === null &&
    P.personaOfBot({ state: {} }, { actorId: 1 }) === null, "personaOfBot reads the roster on sim.state.match (human / no match → none)");

  section("adaptive mapping");
  ok(A.startTier(null) === 3 && A.START_TIER === A.EXPERT_TIER - 1, "first-ever match: one notch below expert (tier 3)");
  ok(A.matchPerf({ kd: 0, spm: 0, acc: 0, win: false }) === 0 && Math.abs(A.matchPerf({ kd: 9, spm: 999, acc: 1, win: true }) - 1) < 1e-9, "matchPerf spans [0,1]");
  ok(A.matchPerf({ kd: 1.1, spm: 150, acc: 0.24, win: true }) > A.matchPerf({ kd: 1.1, spm: 150, acc: 0.24, win: false }), "a win counts");
  ok(A.tierFor(0.9, 3) === 4 && A.tierFor(0.9, 1) === 2, "climbs at most one tier per match");
  ok(A.tierFor(0.05, 3) === 2 && A.tierFor(0.0, 4) === 3, "drops at most one tier per match");
  ok(A.tierFor(0.67, 3) === 3 && A.tierFor(0.70, 3) === 4, "hysteresis: must pass the edge by 0.03 to climb");
  ok(A.tierFor(0.48, 3) === 3 && A.tierFor(0.46, 3) === 2, "hysteresis: must fall 0.03 under the edge to drop");
  let rec = null;
  let maxMove = 0;
  for (let i = 0; i < 30; i++) {
    const prev = rec ? rec.est : A.START_EST;
    rec = A.foldMatch(rec, { kd: 3, spm: 400, acc: 0.5, win: true });
    maxMove = Math.max(maxMove, Math.abs(rec.est - prev));
  }
  ok(maxMove <= A.MAX_STEP + 1e-9, `one match moves the estimate ≤ ${A.MAX_STEP} (max seen ${maxMove.toFixed(3)})`);
  ok(rec.tier === 4 && rec.hist.length === A.HISTORY_N, "a dominant player reaches expert; history capped at 10");
  const r1 = A.foldMatch(null, { kd: 0, spm: 0, acc: 0, win: false });
  ok(r1.tier === 3 && r1.est >= A.START_EST - A.MAX_STEP - 1e-9, "one awful first match does not drop a tier");
  let low = null;
  for (let i = 0; i < 40; i++) low = A.foldMatch(low, { kd: 0.3, spm: 30, acc: 0.08, win: false });
  ok(low.tier === 0, "a struggling player settles at tier 0");
  const det = JSON.stringify(A.foldMatch(A.foldMatch(null, { kd: 1, spm: 120, acc: 0.2, win: true }), { kd: 0.5, spm: 60, acc: 0.15, win: false }));
  ok(det === JSON.stringify(A.foldMatch(A.foldMatch(null, { kd: 1, spm: 120, acc: 0.2, win: true }), { kd: 0.5, spm: 60, acc: 0.15, win: false })), "deterministic given the same history");
  const ex = Object.assign({}, vet);
  ok(A.applyTier(ex, 4) === ex && A.applyTier(ex, undefined) === ex, "tier 4 (and no tier) is the identity: today's expert profile");
  let prevReact = 0, mono = true;
  for (let ti = 4; ti >= 0; ti--) {
    const o = A.applyTier(ex, ti);
    if (o.reactMin < prevReact || o.jitter < (ti < 4 ? ex.jitter : 0)) mono = false;
    prevReact = o.reactMin;
    ok(o.hpMult === undefined && o.damage === undefined && o.name === "veteran", `tier ${ti}: only perception/aim/tactics knobs (react ${o.reactMin.toFixed(3)}-${o.reactMax.toFixed(3)}, jitter ${o.jitter.toFixed(4)}, miss ${o.missRounds})`);
  }
  ok(mono, "lower tiers react slower and aim looser, monotonically");

  section("saved record (core/meta/skill.js)");
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const s1 = SK.createSkillRecord({ storage });
  ok(s1.record() === null && s1.startTier() === 3, "no record → tier 3");
  s1.fold({ kd: 2, spm: 250, acc: 0.3, win: true });
  const s2 = SK.createSkillRecord({ storage });
  ok(s2.record() && s2.record().n === 1 && s2.record().hist.length === 1, "record persists across instances");
  mem[SK.SKILL_KEY] = "{not json";
  ok(SK.createSkillRecord({ storage }).startTier() === 3, "corrupt record → first-match defaults");
  const st = SK.statsFromEnd({ result: "won", stats: { shotsFired: 100, shotsHit: 25 }, match: { actors: [{ kind: "human", kills: 12, deaths: 6, score: 1400 }] } }, 480);
  ok(st && Math.abs(st.kd - 2) < 1e-9 && Math.abs(st.spm - 175) < 1e-9 && Math.abs(st.acc - 0.25) < 1e-9 && st.win === true, "mission:end → kd/spm/acc/win");

  console.log(`\nidentity selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
