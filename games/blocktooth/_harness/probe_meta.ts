// BLOCKTOOTH v2 — META probe: goals, unlocks, profile, tally, perks (FEATURES_V2 §8, §15.3; lane L5).
// Node, THREE-free.
//
//   node _harness/probe_meta.ts               # everything (unit checks + 12 gate runs + 24 perk runs, ~3–5 min)
//   node _harness/probe_meta.ts --quick       # unit checks only (no full runs)
//   node _harness/probe_meta.ts --seed 7
//
// Asserts (exit 1 on any failure, 2 if the sim cannot load):
//   A. catalogue: ≥ 30 goals (40 expected: 15 general · 16 titan · 9 city), unique ids and names, every
//      metric known; the 44 unlock items (every `locked` card incl. the 6 locked evolutions, the 6 perks,
//      the 8 palettes) are each referenced by exactly ONE goal, and every reference resolves; the perk
//      cards of data/perks.ts exist and are `perk: true` hidden cards
//   B. profile sanitize fuzz: corrupt JSON, wrong types, huge / negative / NaN numbers, unknown ids and
//      2 000 seeded random blobs → never throws, always structurally valid, idempotent
//      (sanitize(sanitize(x)) = sanitize(x)); core/save.ts loadProfile / saveProfile over a working, a
//      missing, a throwing and a full localStorage (in-memory fallback for the session), corrupt stored JSON
//   C. applyRunToProfile: input untouched; idempotent (f(f(p)) = f(p) on every counter, best and done key);
//      an EXTENDED COVERAGE run filed twice (clear, then death) counts the run and the clear once;
//      runMetaFor gates perks / palettes on their goals; markSeen; unlockLabel resolves every unlock
//   D. nextUnlock ranking: by progress fraction, ties by list order, titan / biome filtering, lower-is-better,
//      fallback when the relevant set is filed, null when all 40 are filed
//   E. tally vs a scripted event run (every counter), the HOOK window, SIX-WAY SPLICE / FULL BLOOM
//      exclusions (only GRIDLOCK SURGE wires / GREENBELT DECREE blooms → 0), HAIRLINE counts the city
//      fight only (a rematch fielded in endless does not update staggersBestFightBy)
//   F. perks: sanitizeRunMeta; each perk's effect at createWorld; STAY OF DEMOLITION revives once, at 25 %
//      HP, blocks discrete AND dot damage for 2 s, then the second lethal hit ends the run
//   G. goal reachability on seed 1337 (§8.2): (a) every run-scope target ≤ what one full gate-bot run can
//      physically supply (props, boats, tier-4 buildings, OVERLOAD SITES placed, power-ups dropped,
//      objectives placed, foes fielded); (b) ≥ 10 run-scope goals met by the gate bot somewhere in the
//      12-run matrix (fresh meta)
//   H. perk rank bands: 4 titans × GRID-EAST × 6 perks, seed 1337: every Size reached inside its GATE-2
//      band (II 60–150 · III 150–300 · IV 280–450 · V 400–560 s), boss ≤ 560 s; plus a determinism
//      re-run (same seed + same RunMeta + same inputs ⇒ same hash)

import type { BiomeId, GoalDef, PerkId, Profile, RunMeta, RunTally, SimEvent, TitanId, TitanInput, World } from '../src/core/types.ts';
import { BIOME_IDS, PERK_IDS, TITAN_IDS } from '../src/core/types.ts';
import { PERKS, SIM_HZ, ULT } from '../src/core/config.ts';

type Mods = {
  world: typeof import('../src/core/world.ts');
  draft: typeof import('../src/upgrades/draft.ts');
  bot: typeof import('./bot.ts');
  goals: typeof import('../src/meta/goals.ts');
  profile: typeof import('../src/meta/profile.ts');
  tally: typeof import('../src/meta/tally.ts');
  perks: typeof import('../src/meta/perks.ts');
  save: typeof import('../src/core/save.ts');
  titansim: typeof import('../src/titans/titansim.ts');
  stats: typeof import('../src/upgrades/stats.ts');
  GOALS: GoalDef[];
  PERKS_DEF: typeof import('../src/data/perks.ts')['PERKS_DEF'];
  TITAN_PALETTES: typeof import('../src/data/palettes.ts')['TITAN_PALETTES'];
  UPGRADES: typeof import('../src/data/upgrades.ts')['UPGRADES'];
  UPGRADE_BY_ID: typeof import('../src/data/upgrades.ts')['UPGRADE_BY_ID'];
};
let M: Mods;

async function load(): Promise<string | null> {
  try {
    M = {
      world: await import('../src/core/world.ts'),
      draft: await import('../src/upgrades/draft.ts'),
      bot: await import('./bot.ts'),
      goals: await import('../src/meta/goals.ts'),
      profile: await import('../src/meta/profile.ts'),
      tally: await import('../src/meta/tally.ts'),
      perks: await import('../src/meta/perks.ts'),
      save: await import('../src/core/save.ts'),
      titansim: await import('../src/titans/titansim.ts'),
      stats: await import('../src/upgrades/stats.ts'),
      GOALS: (await import('../src/data/goals.ts')).GOALS,
      PERKS_DEF: (await import('../src/data/perks.ts')).PERKS_DEF,
      TITAN_PALETTES: (await import('../src/data/palettes.ts')).TITAN_PALETTES,
      UPGRADES: (await import('../src/data/upgrades.ts')).UPGRADES,
      UPGRADE_BY_ID: (await import('../src/data/upgrades.ts')).UPGRADE_BY_ID,
    };
    return null;
  } catch (e) {
    return (e as Error)?.stack ?? String(e);
  }
}

// ─────────────────────────────── harness ───────────────────────────────
const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, what: string): boolean {
  checks++;
  if (!cond) { fails.push(what); console.log('  FAIL ' + what); }
  return cond;
}
function section(s: string): void { console.log('\n' + s); }

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const RANK_BANDS: readonly (readonly [number, number])[] = [[0, 0], [60, 150], [150, 300], [280, 450], [400, 560]];
const BOSS_BY_S = 560;
const NO_INPUT: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const QUICK = process.argv.includes('--quick');
const SEED = (() => { const s = arg('--seed'); const n = s === null ? 1337 : Number(s) >>> 0; return Number.isFinite(n) ? n : 1337; })();

/** seeded PRNG (mulberry32) for the fuzz */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepEq(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

const META_FRESH: RunMeta = { unlocked: [], perk: null, palette: 0, reviveUsed: false };

// ─────────────────────────────── A. catalogue ───────────────────────────────
const METRICS = new Set([
  'runsFinished', 'peakRank', 'clears', 'biomesCleared', 'kills', 'cleanClear', 'ults', 'banishesLife',
  'blocks', 'endlessS', 'bossesInRun', 'evolutionsLife', 'powerups', 'objectives', 'vacuumBest', 'crushed',
  'titanClears', 'titanBiomesCleared', 'wiresBest', 'hookKillsBest', 'fullVents', 'bloomsBest', 'healed',
  'props', 'overloadSites', 'tier4CollapseFrac', 'bossKillsLife', 'staggersBestFight', 'boats', 'fastClearS',
]);

function checkCatalogue(): void {
  section('A. catalogue');
  const G = M.GOALS;
  ok(G.length >= 30, `≥ 30 goals (have ${G.length})`);
  ok(G.length === 40, `40 goals per §8.2 (have ${G.length})`);
  const by = { general: 0, titan: 0, city: 0 };
  for (const g of G) by[g.group]++;
  ok(by.general === 15 && by.titan === 16 && by.city === 9, `groups 15/16/9 (have ${by.general}/${by.titan}/${by.city})`);
  ok(new Set(G.map((g) => g.id)).size === G.length, 'unique goal ids');
  ok(new Set(G.map((g) => g.name)).size === G.length, 'unique goal names');
  for (const g of G) {
    ok(METRICS.has(g.metric), `${g.id}: known metric '${g.metric}'`);
    ok(Number.isFinite(g.target) && g.target > 0, `${g.id}: positive target`);
    ok(g.desc.length > 0, `${g.id}: has a desc`);
    ok(g.unlocks.length >= 1, `${g.id}: unlocks something`);
    if (g.group === 'titan') ok(!!g.titan, `${g.id}: titan goal names its titan`);
    if (g.group === 'city') ok(!!g.biome, `${g.id}: city goal names its biome`);
    if (g.lowerIsBetter) ok(g.metric === 'fastClearS', `${g.id}: lowerIsBetter only on fastClearS`);
  }
  // unlock items
  const refs = new Map<string, number>();
  const key = (u: GoalDef['unlocks'][number]): string => u.kind === 'palette' ? `palette:${u.titan}:${u.index}` : `${u.kind}:${u.id}`;
  for (const g of G) for (const u of g.unlocks) {
    refs.set(key(u), (refs.get(key(u)) ?? 0) + 1);
    if (u.kind === 'card') { const d = M.UPGRADE_BY_ID[u.id]; ok(!!d && d.locked === true, `${g.id}: unlock card ${u.id} exists and is locked`); }
    else if (u.kind === 'perk') ok(!!M.PERKS_DEF[u.id], `${g.id}: unlock perk ${u.id} exists`);
    else ok(!!M.TITAN_PALETTES[u.titan] && !!M.TITAN_PALETTES[u.titan][u.index - 1], `${g.id}: unlock palette ${u.titan} #${u.index} exists`);
  }
  const items: string[] = [];
  const lockedCards = M.UPGRADES.filter((u) => u.locked);
  for (const u of lockedCards) items.push(`card:${u.id}`);
  for (const p of PERK_IDS) items.push(`perk:${p}`);
  for (const t of TITAN_IDS) for (const i of [1, 2]) items.push(`palette:${t}:${i}`);
  const evos = lockedCards.filter((u) => u.evo).length;
  ok(lockedCards.length - evos === 24 && evos === 6, `24 locked cards + 6 locked evolutions (have ${lockedCards.length - evos} + ${evos})`);
  ok(items.length === 44, `44 unlock items (have ${items.length})`);
  let once = 0;
  for (const it of items) {
    const n = refs.get(it) ?? 0;
    if (ok(n === 1, `unlock item ${it} referenced exactly once (have ${n})`)) once++;
  }
  ok(refs.size === items.length, `no goal references an item outside the 44 (refs ${refs.size})`);
  console.log(`  ${G.length} goals · ${items.length} unlock items · ${once} referenced exactly once`);
  for (const p of PERK_IDS) {
    const d = M.PERKS_DEF[p];
    if (d.card) { const c = M.UPGRADE_BY_ID[d.card]; ok(!!c && c.perk === true, `perk ${p}: card ${d.card} is a hidden perk card`); }
  }
  for (const g of G) for (const u of g.unlocks) {
    const l = M.goals.unlockLabel(u);
    ok(typeof l === 'string' && l.length > 0 && !/undefined/.test(l), `${g.id}: unlockLabel '${l}'`);
  }
}

// ─────────────────────────────── B. profile sanitize fuzz + save.ts ───────────────────────────────
function validProfile(p: Profile, tag: string): boolean {
  const bad: string[] = [];
  const num = (v: unknown, k: string, max = 1e9): void => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) bad.push(`${k}=${String(v)}`); };
  if (p.v !== 1) bad.push('v');
  const goalIds = new Set(M.GOALS.map((g) => g.id));
  for (const k of Object.keys(p.done)) { if (!goalIds.has(k)) bad.push('done.' + k); num(p.done[k], 'done.' + k, 1e13); }
  for (const k of Object.keys(p.best)) { if (!goalIds.has(k)) bad.push('best.' + k); num(p.best[k], 'best.' + k); }
  for (const k of ['runs', 'clears', 'banishes', 'evolutions'] as const) { num(p.life[k], 'life.' + k); if (!Number.isInteger(p.life[k])) bad.push('life.' + k + ' int'); }
  for (const t of TITAN_IDS) {
    const l = p.life.clearedBy[t];
    if (!Array.isArray(l) || new Set(l).size !== l.length || l.some((b) => !(BIOME_IDS as readonly string[]).includes(b))) bad.push('clearedBy.' + t);
    const pal = p.palette[t];
    if (!Number.isInteger(pal) || pal < 0 || pal > 2) bad.push('palette.' + t);
  }
  if (Object.keys(p.life.clearedBy).length !== 4) bad.push('clearedBy keys');
  for (const k of Object.keys(p.life.bossKills)) { if (!['caisson4', 'irongully', 'parkade6'].includes(k)) bad.push('bossKills.' + k); num(p.life.bossKills[k as 'caisson4'], 'bossKills.' + k); }
  if (p.perk !== null && !(PERK_IDS as readonly string[]).includes(p.perk)) bad.push('perk');
  for (const k of Object.keys(p.cineSeen)) { const [t, b] = k.split('.'); if (!(TITAN_IDS as readonly string[]).includes(t) || !(BIOME_IDS as readonly string[]).includes(b) || p.cineSeen[k] !== 1) bad.push('cineSeen.' + k); }
  if (!Array.isArray(p.newUnlocks) || new Set(p.newUnlocks).size !== p.newUnlocks.length) bad.push('newUnlocks');
  for (const id of p.newUnlocks) { const u = M.UPGRADE_BY_ID[id]; if (!u || !u.locked) bad.push('newUnlocks.' + id); }
  return ok(bad.length === 0, `${tag}: valid profile${bad.length ? ' — ' + bad.slice(0, 6).join(', ') : ''}`);
}

function randomBlob(r: () => number, depth: number): unknown {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const leaf = (): unknown => pick<() => unknown>([
    () => null, () => undefined, () => r() < 0.5, () => r() * 1e6 - 5e5, () => NaN, () => Infinity, () => -Infinity,
    () => 1e308, () => -1, () => 'x', () => String(Math.floor(r() * 50)), () => '', () => 'NaN',
    () => pick(['molo', 'grideast', 'caisson4', 'perk_red_tape', 'u_psa', 'g_first_broadcast', 'molo.grideast', 'evo_third_rail', 'bogus']),
    () => [], () => ({}),
  ])();
  if (depth <= 0 || r() < 0.3) return leaf();
  if (r() < 0.3) { const n = Math.floor(r() * 5); const a: unknown[] = []; for (let i = 0; i < n; i++) a.push(randomBlob(r, depth - 1)); return a; }
  const keys = ['v', 'done', 'best', 'life', 'runs', 'clears', 'banishes', 'evolutions', 'clearedBy', 'bossKills', 'perk', 'palette',
    'cineSeen', 'newUnlocks', 'molo', 'voltkite', 'hearthback', 'briarwick', 'grideast', 'caisson4', 'parkade6', 'g_first_broadcast',
    'g_zoning_change', 'g_bogus', 'molo.grideast', 'x.y', '__proto__', 'constructor'];
  const o: Record<string, unknown> = {};
  const n = 1 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) o[pick(keys)] = randomBlob(r, depth - 1);
  return o;
}

function checkProfileFuzz(): void {
  section('B. profile sanitize fuzz + save.ts');
  const S = M.profile.sanitizeProfile;
  const cases: [string, unknown][] = [
    ['null', null], ['undefined', undefined], ['number', 42], ['string', 'profile'], ['array', [1, 2]], ['bool', true],
    ['JSON.parse fail (as stored string)', '{"done": {"g_first_broadcast": 17'],
    ['wrong types', { v: 'one', done: 'x', best: [], life: 7, perk: 5, palette: 'no', cineSeen: [], newUnlocks: {} }],
    ['huge + negative + NaN', {
      done: { g_first_broadcast: 1e308, g_zoning_change: -5, g_crowd_control: NaN, g_bogus: 1 },
      best: { g_crowd_control: 'NaN', g_kills: 5, g_live_coverage: '7', g_ge_curb_appeal: Infinity, g_one_take: -1 },
      life: { runs: 1e308, clears: -3, banishes: '4', evolutions: 2.7, clearedBy: { molo: ['grideast', 'nope', 'grideast', 5], bogus: ['lockwater'], voltkite: 'x' }, bossKills: { parkade6: 3, godzilla: 9, caisson4: -1, irongully: '2' } },
      perk: 'perk_bogus', palette: { molo: 99, voltkite: -2, hearthback: 1.4, briarwick: 'x' },
      cineSeen: { 'molo.grideast': 1, 'molo.nowhere': 1, bad: 1, 'voltkite.lockwater': 0 },
      newUnlocks: ['u_psa', 'u_psa', 'airtime_ledger', 'bogus', 7, 'evo_third_rail'],
    }],
  ];
  for (const [tag, v] of cases) {
    let p: Profile | null = null;
    try { p = S(v); } catch (e) { ok(false, `sanitize(${tag}) threw: ${String(e)}`); continue; }
    validProfile(p, `sanitize(${tag})`);
    ok(deepEq(S(p), p), `sanitize(${tag}) is idempotent`);
  }
  const hp = S(cases[cases.length - 1][1]);
  ok(hp.life.runs === 1e9 && hp.life.clears === 0 && hp.life.banishes === 4 && hp.life.evolutions === 2, `counters coerced (runs ${hp.life.runs} clears ${hp.life.clears} banishes ${hp.life.banishes} evolutions ${hp.life.evolutions})`);
  ok(deepEq(hp.life.clearedBy.molo, ['grideast']) && hp.life.clearedBy.voltkite.length === 0, 'clearedBy filtered + deduped');
  ok(hp.life.bossKills.parkade6 === 3 && hp.life.bossKills.irongully === 2 && hp.life.bossKills.caisson4 === undefined, 'bossKills filtered');
  ok(hp.palette.molo === 2 && hp.palette.voltkite === 0 && hp.palette.hearthback === 1 && hp.palette.briarwick === 0, 'palette clamped 0..2');
  ok(deepEq(hp.newUnlocks, ['u_psa', 'evo_third_rail']), `newUnlocks = locked cards only, deduped (${hp.newUnlocks.join(',')})`);
  ok(hp.done.g_first_broadcast === 1e13 && hp.done.g_zoning_change === undefined && hp.done.g_crowd_control === undefined, 'done timestamps coerced');
  ok(hp.cineSeen['molo.grideast'] === 1 && Object.keys(hp.cineSeen).length === 1, 'cineSeen keys validated');

  const r = prng(SEED ^ 0x5eed);
  let threw = 0, invalid = 0, nonIdem = 0;
  const f0 = fails.length;
  for (let i = 0; i < 2000; i++) {
    const v = randomBlob(r, 4);
    let p: Profile;
    try { p = S(v); } catch { threw++; continue; }
    const before = fails.length;
    if (!validProfile(p, `fuzz #${i}`)) invalid++;
    if (fails.length > before) fails.length = before, checks--;   // count, report once below
    try { if (!deepEq(S(JSON.parse(JSON.stringify(p))), p)) nonIdem++; } catch { nonIdem++; }
  }
  fails.length = Math.max(f0, fails.length);
  ok(threw === 0 && invalid === 0 && nonIdem === 0, `2000 random blobs: ${threw} threw · ${invalid} invalid · ${nonIdem} not idempotent`);

  // save.ts over fake storages
  const G = globalThis as unknown as { localStorage?: unknown };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = new Map<string, string>();
  const good = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
  const full = { getItem: (k: string) => mem.get(k) ?? null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
  const setLS = (v: unknown, throwing = false): void => {
    Object.defineProperty(globalThis, 'localStorage', throwing
      ? { configurable: true, get() { throw new Error('SecurityError'); } }
      : { configurable: true, writable: true, value: v });
  };
  try {
    const p = M.profile.emptyProfile();
    p.done.g_first_broadcast = 1700000000000; p.life.runs = 3; p.perk = 'perk_red_tape'; p.newUnlocks = ['u_block_captain'];
    setLS(good);
    ok(M.save.saveProfile(p) === true, 'saveProfile → true on working storage');
    ok(mem.has('blocktooth.profile.v1'), "written under 'blocktooth.profile.v1'");
    const back = M.save.loadProfile();
    ok(back.life.runs === 3 && back.done.g_first_broadcast === 1700000000000 && back.perk === 'perk_red_tape', 'loadProfile round-trips');
    mem.set('blocktooth.profile.v1', '{"done": {"g_first_broad');
    let cp: Profile | null = null;
    try { cp = M.save.loadProfile(); } catch { cp = null; }
    ok(!!cp && cp.life.runs === 0 && Object.keys(cp.done).length === 0, 'corrupt stored JSON → empty profile, no throw');
    // full storage → in-memory for the session
    setLS(full);
    const p2 = M.profile.cloneProfile(p); p2.life.runs = 9;
    let r2: boolean | null = null;
    try { r2 = M.save.saveProfile(p2); } catch { r2 = null; }
    ok(r2 === false, 'saveProfile on a full storage → false, no throw');
    ok(M.save.loadProfile().life.runs === 9, 'after a failed save, loadProfile returns the in-memory profile');
    // throwing storage getter (sandboxed iframe)
    setLS(null, true);
    const p3 = M.profile.cloneProfile(p); p3.life.runs = 11;
    let r3: boolean | null = null, l3: Profile | null = null;
    try { r3 = M.save.saveProfile(p3); l3 = M.save.loadProfile(); } catch { r3 = null; }
    ok(r3 === false && !!l3 && l3.life.runs === 11, 'throwing localStorage getter → false + in-memory profile');
    // no storage at all
    setLS(undefined);
    const p4 = M.profile.cloneProfile(p); p4.life.runs = 12;
    ok(M.save.saveProfile(p4) === false && M.save.loadProfile().life.runs === 12, 'no localStorage → in-memory profile');
    // storage comes back → a successful save clears the in-memory copy
    setLS(good);
    const p5 = M.profile.cloneProfile(p); p5.life.runs = 13;
    ok(M.save.saveProfile(p5) === true && M.save.loadProfile().life.runs === 13, 'working storage again → saved + read back from storage');
    mem.clear();
    ok(M.save.loadProfile().life.runs === 0, 'in-memory copy dropped after a successful save');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete G.localStorage;
  }
}

// ─────────────────────────────── C. ledger ───────────────────────────────
function mkWorld(titan: TitanId, biome: BiomeId, meta: RunMeta = META_FRESH, seed = SEED): World {
  return M.world.createWorld({ titan, biome, seed, meta: { ...meta, unlocked: meta.unlocked.slice() } });
}

function checkLedger(): void {
  section('C. applyRunToProfile / runMetaFor / markSeen');
  const G = M.goals;
  const w = mkWorld('molo', 'grideast');
  M.world.stepN(w, 30);
  const t = w.tally;
  t.kills = 1200; t.banishes = 3; t.evolutions = 1; t.ults = 4; t.props = 410; t.bossDefeatedBy.parkade6 = 1; t.bossesDefeated = 1;
  M.tally.tallyV2(t).peakRank = 4;
  w.run.result = 'clear'; w.run.phase = 'clear'; w.run.endT = 600;
  const p0 = M.profile.emptyProfile();
  const snap = JSON.stringify(p0);
  const a = G.applyRunToProfile(p0, w, 'clear');
  ok(JSON.stringify(p0) === snap, 'applyRunToProfile leaves its input untouched');
  const q = a.profile;
  ok(q.life.runs === 1 && q.life.clears === 1 && deepEq(q.life.clearedBy.molo, ['grideast']), `life: runs ${q.life.runs} clears ${q.life.clears} clearedBy.molo ${q.life.clearedBy.molo}`);
  ok(q.life.banishes === 3 && q.life.evolutions === 1 && q.life.bossKills.parkade6 === 1, 'life: banishes / evolutions / bossKills');
  const want = ['g_first_broadcast', 'g_zoning_change', 'g_skyline_adjusted', 'g_city_got_smaller', 'g_crowd_control', 'g_change_order',
    'g_molo_bite_sized', 'g_ge_curb_appeal', 'g_ge_parking_violation'];
  for (const id of want) ok(a.newly.includes(id), `newly met: ${id}`);
  ok(!a.newly.includes('g_live_coverage') && !a.newly.includes('g_paperwork'), 'not met: LIVE COVERAGE (4/10), PAPERWORK (3/5)');
  ok(q.newUnlocks.includes('u_block_captain') && q.newUnlocks.includes('evo_municipal_stomach') && q.newUnlocks.includes('u_after_hours_permit'), 'card unlocks queued in newUnlocks');
  ok(q.best.g_crowd_control === 1200 && q.best.g_live_coverage === 4, 'run-goal bests filed');
  // idempotent
  const b = G.applyRunToProfile(q, w, 'clear');
  const strip = (p: Profile): string => JSON.stringify({ ...p, done: Object.keys(p.done).sort() });
  ok(strip(b.profile) === strip(q) && b.newly.length === 0, `idempotent: f(f(p)) = f(p) (newly on re-apply: ${b.newly.length})`);
  // endless: the same World filed again as a death after KEEP GOING
  t.banishes = 5; t.bossDefeatedBy.caisson4 = 1; t.bossesDefeated = 2; t.endlessS = 320;
  (w as { endless: World['endless'] }).endless = { startT: 600, rematches: 1, nextBossT: 900, bossIx: 2, nextEliteT: 700, killsAt: 1200, tonsAt: 0, score: 0 };
  w.run.result = 'dead'; w.run.endT = 930;
  const c = G.applyRunToProfile(q, w, 'dead');
  ok(c.profile.life.runs === 1 && c.profile.life.clears === 1, `endless death: run + clear counted once (runs ${c.profile.life.runs} clears ${c.profile.life.clears})`);
  ok(c.profile.life.banishes === 5 && c.profile.life.bossKills.caisson4 === 1 && c.profile.life.bossKills.parkade6 === 1, 'endless death: only the deltas added');
  for (const id of ['g_paperwork', 'g_still_on_air', 'g_double_feature', 'g_lw_port_closed']) ok(c.newly.includes(id), `endless death newly: ${id}`);
  ok(c.profile.done.g_city_got_smaller === q.done.g_city_got_smaller, 'done timestamps are never rewritten');
  const c2 = G.applyRunToProfile(c.profile, w, 'dead');
  ok(strip(c2.profile) === strip(c.profile) && c2.newly.length === 0, 'endless death re-applied: no change');
  // a death that never cleared: no clear, run counted
  const wd = mkWorld('voltkite', 'lockwater');
  M.world.stepN(wd, 10);
  wd.run.result = 'dead'; wd.run.endT = 200;
  const d = G.applyRunToProfile(M.profile.emptyProfile(), wd, 'dead');
  ok(d.profile.life.runs === 1 && d.profile.life.clears === 0 && d.newly.includes('g_first_broadcast') && !d.newly.includes('g_one_take'), 'a death: run counted, no clear, ONE TAKE not met');
  // cleanClear / fastClearS
  const wc = mkWorld('briarwick', 'lockwater');
  M.world.stepN(wc, 10);
  wc.tally.hpLowFrac = 0.3; wc.run.result = 'clear'; wc.run.endT = 530;
  const e = G.applyRunToProfile(M.profile.emptyProfile(), wc, 'clear');
  ok(e.newly.includes('g_one_take') && e.newly.includes('g_lw_early_closing'), 'ONE TAKE (low 30 %) + EARLY CLOSING (8:50) met');
  ok(e.profile.best.g_lw_early_closing === 530, 'EARLY CLOSING best = 530 s');
  const wc2 = mkWorld('briarwick', 'lockwater');
  M.world.stepN(wc2, 10);
  wc2.tally.hpLowFrac = 0.2; wc2.run.result = 'clear'; wc2.run.endT = 560;
  const e2 = G.applyRunToProfile(M.profile.emptyProfile(), wc2, 'clear');
  ok(!e2.newly.includes('g_one_take') && !e2.newly.includes('g_lw_early_closing'), 'ONE TAKE (low 20 %) + EARLY CLOSING (9:20) not met');
  const e3 = G.applyRunToProfile(e.profile, wc2, 'clear');
  ok(e3.profile.best.g_lw_early_closing === 530, 'lower-is-better best keeps the lower time');
  // evalGoals (live)
  const pl = M.profile.emptyProfile();
  const wl = mkWorld('molo', 'grideast');
  M.world.stepN(wl, 5);
  wl.tally.kills = 1000; wl.tally.ults = 10;
  const ids = G.evalGoals(pl, wl.tally, { titan: 'molo', biome: 'grideast', result: null, endT: -1 });
  ok(deepEq(ids, ['g_crowd_control', 'g_live_coverage']), `evalGoals live → ${ids.join(',')}`);
  ok(pl.newUnlocks.includes('u_rolling_closure') && pl.newUnlocks.includes('u_psa'), 'evalGoals queues the NEW ribbon ids');
  for (const id of ids) pl.done[id] = 1;
  ok(G.evalGoals(pl, wl.tally, { titan: 'molo', biome: 'grideast', result: null, endT: -1 }).length === 0, 'evalGoals: stamped goals are not repeated');
  ok(G.evalGoals(pl, wl.tally, { titan: 'voltkite', biome: 'grideast', result: null, endT: -1 }).length === 0, 'evalGoals: life goals never evaluated live');
  // runMetaFor / unlockedIds / markSeen
  const fresh = M.profile.emptyProfile();
  const m0 = G.runMetaFor(fresh, 'molo', 'perk_red_tape', 2);
  ok(m0.perk === null && m0.palette === 0 && m0.unlocked.length === 0 && m0.reviveUsed === false, 'fresh profile: no perk, palette 0, nothing unlocked');
  const pu = M.profile.emptyProfile();
  pu.done.g_paperwork = 1; pu.done.g_molo_curbside_pickup = 1; pu.done.g_full_programming = 1; pu.done.g_first_broadcast = 1;
  const m1 = G.runMetaFor(pu, 'molo', 'perk_red_tape', 1);
  ok(m1.perk === 'perk_red_tape' && m1.palette === 1, `unlocked perk + palette honoured (perk ${m1.perk} palette ${m1.palette})`);
  ok(G.runMetaFor(pu, 'molo', 'perk_warm_mic', 2).perk === null && G.runMetaFor(pu, 'molo', null, 2).palette === 0, 'locked perk / palette refused');
  ok(G.runMetaFor(pu, 'voltkite', null, 1).palette === 0, 'palette unlock is per titan');
  ok(deepEq(m1.unlocked, ['evo_citywide_blackout', 'u_block_captain']), `unlockedIds sorted (${m1.unlocked.join(',')})`);
  const ps = M.profile.emptyProfile(); ps.newUnlocks = ['u_psa', 'u_block_captain', 'evo_third_rail'];
  const ps2 = G.markSeen(ps, ['u_psa', 'evo_third_rail']);
  ok(deepEq(ps2.newUnlocks, ['u_block_captain']) && ps.newUnlocks.length === 3, 'markSeen returns a new profile without the seen ids');
}

// ─────────────────────────────── D. nextUnlock ───────────────────────────────
function checkNextUnlock(): void {
  section('D. nextUnlock ranking');
  const G = M.goals;
  const p = M.profile.emptyProfile();
  p.best.g_crowd_control = 900;            // 0.9
  p.best.g_live_coverage = 5;              // 0.5
  p.best.g_vk_power_outage = 24;           // 0.96, VOLT-KITE only
  p.best.g_ge_curb_appeal = 380;           // 0.95, GRID-EAST only
  let n = G.nextUnlock(p, 'molo', null);
  ok(n?.goal.id === 'g_crowd_control' && n.value === 900, `molo, no city → CROWD CONTROL (got ${n?.goal.id} ${n?.value})`);
  n = G.nextUnlock(p, 'voltkite', null);
  ok(n?.goal.id === 'g_vk_power_outage', `voltkite → POWER OUTAGE (got ${n?.goal.id})`);
  n = G.nextUnlock(p, 'molo', 'grideast');
  ok(n?.goal.id === 'g_ge_curb_appeal', `molo + GRID-EAST → CURB APPEAL (got ${n?.goal.id})`);
  n = G.nextUnlock(p, 'molo', 'lockwater');
  ok(n?.goal.id === 'g_crowd_control', `molo + LOCKWATER → CROWD CONTROL (got ${n?.goal.id})`);
  const tie = M.profile.emptyProfile();
  tie.best.g_crowd_control = 500; tie.best.g_live_coverage = 5;   // both 0.5
  n = G.nextUnlock(tie, 'molo', null);
  ok(n?.goal.id === 'g_crowd_control', `tie → list order (got ${n?.goal.id})`);
  const lb = M.profile.emptyProfile();
  lb.best.g_lw_early_closing = 600;          // 540/600 = 0.9
  lb.best.g_crowd_control = 800;             // 0.8
  n = G.nextUnlock(lb, 'molo', 'lockwater');
  ok(n?.goal.id === 'g_lw_early_closing' && n.value === 600, `lower-is-better ranks by target / best (got ${n?.goal.id})`);
  ok(Math.abs(G.goalFrac(M.GOALS.find((g) => g.id === 'g_lw_early_closing')!, 600) - 0.9) < 1e-9, 'goalFrac(EARLY CLOSING, 600) = 0.9');
  const lf = M.profile.emptyProfile(); lf.life.clears = 0; lf.life.runs = 0;
  n = G.nextUnlock(lf, 'briarwick', null);
  ok(!!n && (n.goal.group === 'general' || n.goal.titan === 'briarwick'), `empty profile → a general or BRIARWICK goal (got ${n?.goal.id})`);
  // every relevant goal filed → fallback to any remaining; all filed → null
  const all = M.profile.emptyProfile();
  for (const g of M.GOALS) if (!g.titan || g.titan === 'molo') { if (!g.biome) all.done[g.id] = 1; }
  n = G.nextUnlock(all, 'molo', null);
  ok(!!n && (n.goal.titan !== undefined && n.goal.titan !== 'molo' || n.goal.biome !== undefined), `relevant set filed → fallback to a remaining goal (got ${n?.goal.id})`);
  for (const g of M.GOALS) all.done[g.id] = 1;
  ok(G.nextUnlock(all, 'molo', 'grideast') === null, 'all 40 filed → null (EVERY PERMIT ISSUED)');
  // goalProgress of a filed goal reads at least the target
  const pd = M.profile.emptyProfile(); pd.done.g_crowd_control = 1;
  ok(G.goalProgress(M.GOALS.find((g) => g.id === 'g_crowd_control')!, pd, null, null) >= 1000, 'a filed goal reports ≥ its target');
  // tier-4 display parts
  const w = mkWorld('molo', 'whitestacks');
  M.world.stepN(w, 2);
  const g4 = M.GOALS.find((g) => g.id === 'g_ws_cold_storage')!;
  w.tally.collapsesByTier[4] = 3;
  const parts = M.goals.goalParts(g4, M.profile.emptyProfile(), w.tally, { titan: 'molo', biome: 'whitestacks', result: null, endT: -1 });
  ok(w.tally.tier4Total > 0 && parts.x === 3 && parts.y === Math.ceil(0.6 * w.tally.tier4Total), `COLD STORAGE parts ${parts.x} / ${parts.y} (tier4Total ${w.tally.tier4Total})`);
}

// ─────────────────────────────── E. tally ───────────────────────────────
function checkTally(): void {
  section('E. tally vs a scripted event run');
  const w = mkWorld('molo', 'lockwater');
  M.world.stepN(w, 1);
  const T = M.tally;
  const t = T.tallyV2(w.tally);
  let tier4 = 0; for (const b of w.city.buildings) if (b.tier === 4) tier4++;
  ok(t.tier4Total === tier4, `tier4Total = city tier-4 count (${t.tier4Total} vs ${tier4})`);
  // reset to a clean tally and drive stepTally with scripted events only
  const fresh = T.createTally(); fresh.tier4Total = tier4; Object.assign(t, fresh);
  w.enemies.length = 0; w.hazards.length = 0;
  const step = (evs: SimEvent[], dt = w.dt): void => { w.t += dt; w.tick++; w.events.length = 0; for (const e of evs) w.events.push(e); T.stepTally(w); };
  step([
    { type: 'enemyKilled', id: 1, kind: 'android', x: 0, z: 0, crushed: true },
    { type: 'enemyKilled', id: 2, kind: 'tank', x: 0, z: 0, crushed: false },
    { type: 'propDestroyed', id: 3, kind: 'boat', x: 0, z: 0, crushed: false },
    { type: 'propDestroyed', id: 4, kind: 'car', x: 0, z: 0, crushed: true },
    { type: 'floorBreak', id: 5, remaining: 2, x: 0, z: 0, tier: 2 },
    { type: 'buildingCollapse', id: 6, x: 0, z: 0, tier: 4, w: 1, d: 1, h: 1 },
    { type: 'ultFire', titan: 'molo', x: 0, z: 0, r: 5 },
    { type: 'ultEnd', titan: 'molo', kills: 17 },
    { type: 'objectiveDone', id: 7, kind: 'overloadSite', x: 0, z: 0 },
    { type: 'objectiveDone', id: 8, kind: 'reliefDepot', x: 0, z: 0 },
    { type: 'powerup', id: 9, kind: 'rushHour', x: 0, z: 0 },
    { type: 'titanHeal', amount: 12.5 },
    { type: 'vent', x: 0, z: 0, r: 1, power: 0.96 },
    { type: 'vent', x: 0, z: 0, r: 1, power: 0.5 },
  ]);
  ok(t.kills === 2 && t.crushed === 1 && t.killsBy.android === 1 && t.killsBy.tank === 1, `kills ${t.kills} crushed ${t.crushed}`);
  ok(t.props === 2 && t.propsBy.boat === 1 && t.propsBy.car === 1, `props ${t.props} boats ${t.propsBy.boat}`);
  ok(t.floors === 1 && t.collapses === 1 && t.collapsesByTier[4] === 1, 'floors / collapses by tier');
  ok(t.ults === 1 && t.ultKillsBest === 17, 'ults / ultKillsBest');
  ok(t.objectives.overloadSite === 1 && t.objectives.reliefDepot === 1 && t.powerups.rushHour === 1, 'objectives / power-ups');
  ok(Math.abs(t.healed - 12.5) < 1e-9 && t.fullVents === 1, 'healed / fullVents');
  // hpLowFrac
  w.titan.hp = 0.4 * w.titan.maxHp; step([]);
  w.titan.hp = w.titan.maxHp; step([]);
  ok(Math.abs(t.hpLowFrac - 0.4) < 1e-9, `hpLowFrac 0.4 (got ${t.hpLowFrac.toFixed(3)})`);
  // HOOK window: ability, 3 pickups + 2 kills inside, 5 more after the window
  const k = (id: number): SimEvent => ({ type: 'enemyKilled', id, kind: 'android', x: 0, z: 0, crushed: false });
  const pk: SimEvent = { type: 'pickup', kind: 'scrap', xp: 1, x: 0, z: 0 };
  step([{ type: 'ability', titan: 'molo', x: 0, z: 0, power: 1 }]);
  step([pk, pk, k(10)]);
  step([pk, k(11)], 1.0);
  step([pk, pk, pk, k(12), k(13), k(14)], 0.5);   // 1.5 s after the hook: outside HOOK_WINDOW_S (1.4)
  ok(t.vacuumBest === 3 && t.hookKillsBest === 2, `HOOK window: vacuumBest ${t.vacuumBest} (3) hookKillsBest ${t.hookKillsBest} (2)`);
  step([{ type: 'ability', titan: 'molo', x: 0, z: 0, power: 1 }, pk, pk, pk, pk, k(15), k(16), k(17)]);
  ok(t.vacuumBest === 4 && t.hookKillsBest === 3, `a second, bigger window → ${t.vacuumBest} / ${t.hookKillsBest}`);
  // SIX-WAY SPLICE: only GRIDLOCK SURGE wires → 0
  const wires = (n: number): SimEvent => ({ type: 'wireDetonate', pts: new Array(n * 4).fill(0) });
  t.ultWireUntilT = w.t + 5;
  step([wires(8)]);
  ok(t.wiresBest === 0, `SIX-WAY SPLICE exclusion: ult wires only → wiresBest ${t.wiresBest}`);
  step([wires(7)], 6);
  ok(t.wiresBest === 7, `after the ult wires expire, a 7-wire detonation counts (wiresBest ${t.wiresBest})`);
  // FULL BLOOM: only GREENBELT DECREE blooms (data.wild) → 0
  const bloom = (id: number, wild: boolean) => ({
    id, alive: true, owner: 'titan' as const, kind: 'bloom' as const, shape: { k: 'circle' as const, x: 0, z: 0, r: 1 },
    t: 0, life: 10, dps: 0, tickT: 0, data: (wild ? { wild: 1 } : {}) as Record<string, number>,
  });
  for (let i = 0; i < 9; i++) w.hazards.push(bloom(100 + i, true));
  step([]);
  ok(t.bloomsBest === 0, `FULL BLOOM exclusion: 9 ult blooms → bloomsBest ${t.bloomsBest}`);
  for (let i = 0; i < 5; i++) w.hazards.push(bloom(200 + i, false));
  step([]);
  ok(t.bloomsBest === 5, `5 kit blooms among them → bloomsBest ${t.bloomsBest}`);
  w.hazards.length = 0;
  // HAIRLINE: city fight counts, a rematch (fielded in endless) does not
  const fakeBoss = { id: 'irongully', alive: true, data: {} } as unknown as World['boss'];
  (w as { boss: World['boss'] }).boss = fakeBoss;
  step([{ type: 'bossSpawn', boss: 'irongully' }]);
  step([{ type: 'bossStagger' }]); step([{ type: 'bossStagger' }]); step([{ type: 'bossStagger' }]);
  ok((t.staggersBestFightBy.irongully ?? 0) === 3, `city fight: 3 staggers (got ${t.staggersBestFightBy.irongully})`);
  step([{ type: 'bossDefeated', x: 0, z: 0 }]);
  ok(t.bossesDefeated === 1 && t.bossDefeatedBy.irongully === 1, 'bossDefeated counted by id');
  (w as { endless: World['endless'] }).endless = { startT: w.t, rematches: 0, nextBossT: Infinity, bossIx: 1, nextEliteT: 1e9, killsAt: 0, tonsAt: 0, score: 0 };
  step([{ type: 'bossSpawn', boss: 'irongully' }]);
  for (let i = 0; i < 5; i++) step([{ type: 'bossStagger' }]);
  ok((t.staggersBestFightBy.irongully ?? 0) === 3 && t.fightIsRematch, `rematch: 5 staggers do not count (best stays ${t.staggersBestFightBy.irongully})`);
  step([], 2);
  ok(t.endlessS > 0, `endlessS follows w.endless (${t.endlessS.toFixed(2)} s)`);
  // HAIRLINE through the goal: only WHITE STACKS
  const gH = M.GOALS.find((g) => g.id === 'g_ws_hairline')!;
  ok(M.goals.goalProgress(gH, M.profile.emptyProfile(), t, { titan: 'molo', biome: 'whitestacks', result: null, endT: -1 }) === 3, 'HAIRLINE progress 3 in WHITE STACKS');
  ok(M.goals.goalProgress(gH, M.profile.emptyProfile(), t, { titan: 'molo', biome: 'lockwater', result: null, endT: -1 }) === 0, 'HAIRLINE progress 0 outside WHITE STACKS');
  // the real sim: a run's tally matches the titan's own counters
  const wr = mkWorld('hearthback', 'grideast');
  runBot(wr, 180 * SIM_HZ, null);
  ok(wr.tally.kills === wr.titan.kills && wr.tally.crushed === wr.titan.crushed, `180 s bot run: tally kills ${wr.tally.kills} = titan.kills ${wr.titan.kills}, crushed ${wr.tally.crushed} = ${wr.titan.crushed}`);
  ok(M.tally.tallyV2(wr.tally).peakRank === wr.titan.rank || M.tally.tallyV2(wr.tally).peakRank === wr.run.peakRank, 'tally peakRank follows the run');
}

// ─────────────────────────────── F. perks ───────────────────────────────
function checkPerks(): void {
  section('F. perks');
  const P = M.perks;
  const sm = P.sanitizeRunMeta({ unlocked: ['u_psa', 'u_psa', 'bogus', 'airtime_ledger', 7, 'evo_third_rail'], perk: 'perk_bogus', palette: 7.4, reviveUsed: 'yes' });
  ok(deepEq(sm, { unlocked: ['evo_third_rail', 'u_psa'], perk: null, palette: 2, reviveUsed: false }), `sanitizeRunMeta coerces (${JSON.stringify(sm)})`);
  ok(deepEq(P.sanitizeRunMeta(undefined), META_FRESH) && deepEq(P.sanitizeRunMeta('x'), META_FRESH), 'sanitizeRunMeta(undefined / junk) = EMPTY_RUN_META');
  const base = mkWorld('molo', 'grideast');
  const S = (w: World, k: 'rerolls' | 'armor'): number => M.stats.stat(w, k);
  const mk = (perk: PerkId): World => mkWorld('molo', 'grideast', { unlocked: [], perk, palette: 0, reviveUsed: false });
  const pc = mk('perk_petty_cash');
  ok(S(pc, 'rerolls') === S(base, 'rerolls') + PERKS.pettyCashRerolls && pc.upgrades.owned.perk_card_petty_cash === 1, `PETTY CASH: rerolls ${S(base, 'rerolls')} → ${S(pc, 'rerolls')}`);
  const rt = mk('perk_red_tape');
  ok(rt.upgrades.banishLeft === base.upgrades.banishLeft + PERKS.redTapeBanish && rt.upgrades.lockLeft === base.upgrades.lockLeft + PERKS.redTapeLock, `RED TAPE: banish ${rt.upgrades.banishLeft} lock ${rt.upgrades.lockLeft}`);
  const wm = mk('perk_warm_mic');
  ok(wm.ult.ready && wm.ult.charge === ULT.max && !base.ult.ready, 'WARM MIC: UPROAR full at the start');
  const si = mk('perk_safety_inspection');
  ok(S(si, 'armor') === S(base, 'armor') + PERKS.safetyArmor && si.titan.hp === si.titan.maxHp, `SAFETY INSPECTION: armor ${S(base, 'armor')} → ${S(si, 'armor')}`);
  const tl = mk('perk_tip_line');
  ok(tl.meta.perk === 'perk_tip_line', 'ADVANCE TIP-LINE is on w.meta.perk (read by the map sim / marker view)');
  // determinism of perk worlds: same seed + meta + inputs ⇒ same state
  const d1 = mk('perk_warm_mic'), d2 = mk('perk_warm_mic');
  runBot(d1, 90 * SIM_HZ, null); runBot(d2, 90 * SIM_HZ, null);
  ok(hashWorld(d1) === hashWorld(d2), `WARM MIC 90 s bot run twice → same hash (${hashWorld(d1)} / ${hashWorld(d2)})`);

  // STAY OF DEMOLITION
  const sd = mk('perk_stay_of_demolition');
  M.world.stepN(sd, 30);
  const T = sd.titan;
  M.titansim.hurtTitan(sd, T.hp * 5 + 1e4, 'shell', T.x, T.z);
  ok(!T.alive, 'lethal hit: the titan is down');
  M.world.stepWorld(sd, NO_INPUT);
  let revived = false; for (const e of sd.events) if (e.type === 'revive') revived = true;
  ok(T.alive && sd.run.result === null && revived && sd.meta.reviveUsed, 'STAY OF DEMOLITION: revived (revive event, reviveUsed)');
  ok(Math.abs(T.hp - PERKS.stayHpFrac * T.maxHp) < 1e-6, `revived at 25 % HP (${T.hp.toFixed(1)} / ${T.maxHp.toFixed(1)})`);
  ok(sd.ult.invulnT >= PERKS.stayInvulnS - 1e-9, `invulnerable window ${sd.ult.invulnT.toFixed(2)} s`);
  sd.cheats.noSpawns = true;
  for (const e of sd.enemies) e.alive = false;
  const hp0 = T.hp;
  let took = 0, ticks = 0;
  while (sd.ult.invulnT > 0 && ticks < 200) {
    took += M.titansim.hurtTitan(sd, 50, 'breath', T.x, T.z, true);     // dot
    took += M.titansim.hurtTitan(sd, 50, 'shell', T.x, T.z, false);   // discrete
    M.world.stepWorld(sd, NO_INPUT); ticks++;
  }
  ok(took === 0 && T.hp >= hp0 - 1e-6, `no damage of any kind (dot included) during the window (took ${took}, ${ticks} ticks ≈ ${(ticks / SIM_HZ).toFixed(2)} s)`);
  ok(Math.abs(ticks / SIM_HZ - PERKS.stayInvulnS) <= 2 / SIM_HZ, `window lasts ${PERKS.stayInvulnS} s (${(ticks / SIM_HZ).toFixed(2)} s)`);
  T.iframeT = 0;
  const dotAfter = M.titansim.hurtTitan(sd, 5, 'breath', T.x, T.z, true);
  ok(dotAfter > 0, `after the window dot damage lands again (${dotAfter.toFixed(2)})`);
  M.titansim.hurtTitan(sd, 1e6, 'shell', T.x, T.z);
  M.world.stepWorld(sd, NO_INPUT);
  ok(sd.run.result === 'dead', 'the second lethal hit ends the run (once per run)');
  // no perk → death ends
  const np = mkWorld('molo', 'grideast');
  M.world.stepN(np, 30);
  M.titansim.hurtTitan(np, 1e6, 'shell', np.titan.x, np.titan.z);
  M.world.stepWorld(np, NO_INPUT);
  ok(np.run.result === 'dead', 'without the perk a lethal hit ends the run');
}

// ─────────────────────────────── bot runner ───────────────────────────────
function runBot(w: World, maxTicks: number, onTick: ((w: World) => void) | null): void {
  const D = M.draft;
  for (let i = 0; i < maxTicks && !w.run.result; i++) {
    let guard = 0;
    while (D.hasPendingDraft(w) && ++guard < 200) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : D.rollOffer(w, chest);
      if (!offer || offer.length === 0) break;
      D.pickUpgrade(w, M.bot.botPickUpgrade(w, offer));
    }
    M.world.stepWorld(w, M.bot.botInput(w));
    if (onTick) onTick(w);
  }
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
function hashWorld(w: World): string {
  let h = 0x811c9dc5 >>> 0;
  const u = (x: number): void => { for (let s = 0; s < 32; s += 8) { h ^= (x >>> s) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } };
  const n = (x: number): void => { F64[0] = x; u(U32[0]); u(U32[1]); };
  const T = w.titan;
  for (const v of [w.tick, w.t, w.nextId, T.x, T.z, T.hp, T.maxHp, T.xp, T.level, T.rank, T.kills, w.ult.charge, w.ult.fired, w.tally.kills, w.tally.props, w.tally.healed]) n(v);
  for (const e of w.enemies) if (e.alive) { n(e.x); n(e.z); n(e.hp); }
  for (const k of Object.keys(w.upgrades.owned).sort()) { for (let i = 0; i < k.length; i++) u(k.charCodeAt(i)); n(w.upgrades.owned[k]); }
  if (w.boss) { n(w.boss.hp); n(w.boss.x); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface GateRun {
  titan: TitanId; biome: BiomeId; perk: PerkId | null;
  rankT: number[]; bossT: number; result: 'clear' | 'dead' | 'timeout'; endT: number;
  tally: RunTally; supply: Record<string, number>; met: string[]; hash: string; error: string | null;
}

function gateRun(titan: TitanId, biome: BiomeId, perk: PerkId | null, minutes = 13): GateRun {
  const out: GateRun = { titan, biome, perk, rankT: [0, NaN, NaN, NaN, NaN], bossT: NaN, result: 'timeout', endT: NaN, tally: null as unknown as RunTally, supply: {}, met: [], hash: '', error: null };
  let w: World;
  try { w = mkWorld(titan, biome, { unlocked: [], perk, palette: 0, reviveUsed: false }); } catch (e) { out.error = String((e as Error)?.stack ?? e); return out; }
  const sup: Record<string, number> = { props: w.city.props.length, boats: 0, tier4: 0, blocks: 0, overloadPlaced: 0, powerupsDropped: 0, objectivesPlaced: 0, foes: 0, ultReady: 0, vents: 0, pickupsSpawnedXp: 0 };
  for (const p of w.city.props) if (p.kind === 'boat') sup.boats++;
  for (const b of w.city.buildings) if (b.tier === 4) sup.tier4++;
  sup.blocks = new Set(w.city.buildings.map((b) => b.block)).size;
  const ctx = { titan, biome, result: null as 'clear' | 'dead' | null, endT: -1 };
  const met = new Set<string>();
  const profile = M.profile.emptyProfile();
  try {
    runBot(w, Math.round(minutes * 60 * SIM_HZ), (ww) => {
      for (const e of ww.events) {
        if (e.type === 'rankUp' && Number.isNaN(out.rankT[e.rank])) out.rankT[e.rank] = ww.t;
        else if (e.type === 'bossSpawn' && Number.isNaN(out.bossT)) out.bossT = ww.t;
        else if (e.type === 'objectiveSpawn') { sup.objectivesPlaced++; if (e.kind === 'overloadSite') sup.overloadPlaced++; }
        else if (e.type === 'powerupSpawn') sup.powerupsDropped++;
        else if (e.type === 'enemySpawn') sup.foes++;
        else if (e.type === 'ultCharged') sup.ultReady++;
        else if (e.type === 'vent') sup.vents++;
      }
      if (ww.tick % SIM_HZ === 0 || ww.run.result) {
        ctx.result = ww.run.result; ctx.endT = ww.run.endT;
        for (const id of M.goals.evalGoals(profile, ww.tally, ctx)) { met.add(id); profile.done[id] = 1; }
      }
    });
  } catch (e) { out.error = `threw @t=${w.t.toFixed(1)}: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`; }
  out.result = w.run.result ?? 'timeout';
  out.endT = w.run.result ? w.run.endT : w.t;
  out.tally = w.tally; out.supply = sup; out.met = [...met]; out.hash = hashWorld(w);
  return out;
}

function bandViolations(r: GateRun): string[] {
  const v: string[] = [];
  const id = `${r.titan}/${r.biome}/${r.perk ?? 'none'}`;
  if (r.error) v.push(`${id}: ${r.error}`);
  for (let k = 1; k <= 4; k++) {
    const [lo, hi] = RANK_BANDS[k];
    const t = r.rankT[k];
    if (Number.isNaN(t)) { if (r.endT > hi) v.push(`${id}: Size ${ROMAN[k]} not reached by ${hi} s${r.result === 'dead' ? ` (died at ${r.endT.toFixed(0)} s)` : ''}`); }
    else if (t < lo || t > hi) v.push(`${id}: Size ${ROMAN[k]} at ${t.toFixed(0)} s, outside ${lo}–${hi} s`);
  }
  if (Number.isNaN(r.bossT)) { if (r.endT > BOSS_BY_S && r.result !== 'dead') v.push(`${id}: boss never spawned by ${BOSS_BY_S} s`); }
  else if (r.bossT > BOSS_BY_S) v.push(`${id}: boss at ${r.bossT.toFixed(0)} s (> ${BOSS_BY_S})`);
  return v;
}

const fmt = (t: number): string => Number.isNaN(t) ? '   —' : t.toFixed(0).padStart(4);

// ─────────────────────────────── G. reachability ───────────────────────────────
function checkReachability(): void {
  section(`G. goal reachability (seed ${SEED}, 12-run gate matrix, fresh meta)`);
  const runs: GateRun[] = [];
  for (const t of TITAN_IDS) for (const b of BIOME_IDS) {
    const t0 = performance.now();
    const r = gateRun(t, b, null);
    runs.push(r);
    const s = r.supply;
    console.log(`  ${t.padEnd(10)} ${b.padEnd(11)} ${r.result.padEnd(7)} @${r.endT.toFixed(0).padStart(4)} s · props ${s.props} boats ${s.boats} tier4 ${s.tier4} blocks ${s.blocks} · overload placed ${s.overloadPlaced} · objectives ${s.objectivesPlaced} · power-ups ${s.powerupsDropped} · foes ${s.foes} · UPROAR ready ${s.ultReady} · met ${r.met.length} · ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
    if (r.error) ok(false, `${t}/${b}: ${r.error}`);
  }
  // (a) supply ≥ target for every run-scope goal, per biome × titan it applies to
  const L4 = runs.some((r) => r.supply.objectivesPlaced > 0 || r.supply.powerupsDropped > 0);
  if (!L4) console.log('  NOTE: no objective / power-up was placed in any run — the L4 map sim is not merged yet; the OVERLOAD / objectives / power-up supply checks below FAIL until it is');
  const supplyOf: Record<string, (r: GateRun) => number> = {
    props: (r) => r.supply.props, boats: (r) => r.supply.boats, overloadSites: (r) => r.supply.overloadPlaced,
    powerups: (r) => r.supply.powerupsDropped, objectives: (r) => r.supply.objectivesPlaced, kills: (r) => r.supply.foes,
    crushed: (r) => r.supply.foes, hookKillsBest: (r) => r.supply.foes, blocks: (r) => r.supply.blocks,
    ults: (r) => r.supply.ultReady, fullVents: (r) => r.supply.vents,
    tier4CollapseFrac: (r) => (r.supply.tier4 > 0 ? 1 : 0),
  };
  for (const g of M.GOALS) {
    if (g.scope !== 'run') continue;
    const f = supplyOf[g.metric];
    if (!f) continue;
    const rs = runs.filter((r) => (!g.titan || r.titan === g.titan) && (!g.biome || r.biome === g.biome));
    for (const r of rs) {
      const s = f(r);
      const need = g.metric === 'tier4CollapseFrac' ? 1 : g.target;
      ok(s >= need, `(a) ${g.id} ${r.titan}/${r.biome}: supply ${s} ≥ target ${g.metric === 'tier4CollapseFrac' ? `${g.target} of ${r.supply.tier4} tier-4` : g.target}`);
    }
  }
  // (b) ≥ 10 run-scope goals met somewhere
  const metAll = new Map<string, string[]>();
  for (const r of runs) for (const id of r.met) { const a = metAll.get(id) ?? []; a.push(`${r.titan}/${r.biome}`); metAll.set(id, a); }
  const runGoals = M.GOALS.filter((g) => g.scope === 'run');
  console.log(`  run-scope goals met by the gate bot (${metAll.size} of ${runGoals.length}):`);
  for (const g of runGoals) {
    const where = metAll.get(g.id);
    const best = Math.max(0, ...runs.map((r) => (g.titan && r.titan !== g.titan) || (g.biome && r.biome !== g.biome) ? 0 : M.goals.goalProgress(g, M.profile.emptyProfile(), r.tally, { titan: r.titan, biome: r.biome, result: r.result === 'timeout' ? null : r.result, endT: r.endT })));
    console.log(`    ${where ? 'MET ' : '    '} ${g.id.padEnd(26)} best ${Number.isInteger(best) ? best : best.toFixed(2)} / ${g.target}${where ? '  (' + where.slice(0, 4).join(', ') + (where.length > 4 ? ', …' : '') + ')' : ''}`);
  }
  ok(metAll.size >= 10, `(b) ≥ 10 run-scope goals met in the 12-run matrix (${metAll.size})`);
}

// ─────────────────────────────── H. perk bands ───────────────────────────────
function checkPerkBands(): void {
  section(`H. perk rank bands (4 titans × GRID-EAST × 6 perks + none, seed ${SEED})`);
  console.log(`  ${'titan'.padEnd(10)} ${'perk'.padEnd(24)}   II  III   IV    V bossT result   endT`);
  let vio = 0;
  for (const t of TITAN_IDS) {
    for (const p of [null, ...PERK_IDS] as (PerkId | null)[]) {
      const r = gateRun(t, 'grideast', p);
      const v = bandViolations(r);
      console.log(`  ${t.padEnd(10)} ${(p ?? 'none').padEnd(24)} ${fmt(r.rankT[1])} ${fmt(r.rankT[2])} ${fmt(r.rankT[3])} ${fmt(r.rankT[4])} ${fmt(r.bossT)}  ${r.result.padEnd(7)}${r.endT.toFixed(0).padStart(5)}${v.length ? '   ← ' + v.join('; ') : ''}`);
      if (p === null) { if (v.length) console.log(`    (baseline without a perk already outside a band — reported, not counted against the perks)`); continue; }
      for (const s of v) { ok(false, `perk band: ${s}`); vio++; }
      checks++;
    }
  }
  console.log(`  perk band violations: ${vio}`);
  // determinism with a perk
  const a = gateRun('briarwick', 'grideast', 'perk_petty_cash', 4), b = gateRun('briarwick', 'grideast', 'perk_petty_cash', 4);
  ok(a.hash === b.hash, `determinism: briarwick/grideast/PETTY CASH 4 min twice → ${a.hash} / ${b.hash}`);
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  const err = await load();
  if (err) { console.log('probe_meta: FAIL — could not load the sim:'); for (const l of err.split(/\r?\n/).slice(0, 8)) console.log('  ' + l); return 2; }
  console.log(`BLOCKTOOTH probe_meta — seed ${SEED}${QUICK ? ' (--quick: unit checks only)' : ''}`);
  const wall0 = performance.now();
  const steps: [string, () => void][] = [
    ['catalogue', checkCatalogue], ['profile', checkProfileFuzz], ['ledger', checkLedger], ['nextUnlock', checkNextUnlock],
    ['tally', checkTally], ['perks', checkPerks],
  ];
  if (!QUICK) steps.push(['reachability', checkReachability], ['perkBands', checkPerkBands]);
  for (const [name, fn] of steps) {
    try { fn(); } catch (e) { ok(false, `${name} threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`); }
  }
  console.log(`\n${checks} checks · ${fails.length} failed · ${((performance.now() - wall0) / 1000).toFixed(1)} s wall`);
  if (fails.length) {
    console.log('probe_meta: FAIL');
    for (const f of fails.slice(0, 40)) console.log('  - ' + f);
    if (fails.length > 40) console.log(`  … ${fails.length - 40} more`);
    return 1;
  }
  console.log('probe_meta: PASS');
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
