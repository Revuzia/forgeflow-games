// BLOCKTOOTH — upgrades lane probe. Run: node _harness/probe_upgrades.ts   (Node 22 strips types)
//
//   A. DATA   — catalogue size, unique ids + names, category / titan counts, kit-stat coverage,
//               every StatKey + every TriggerAction covered, forbidden-name scan (CONTRACT §1),
//               desc == describe(effects) and desc numbers vs effect numbers.
//   B. STATS  — hand-built World: baseStatBlock (§8), recomputeStats (add/mul/stacks, cooldown floor
//               0.35, rank hp× + HP-ratio keep, idempotence), stat() with frenzy buffs.
//   C. ENGINE — real world (createWorld): applyUpgrade (stacks/order/cap/titan filter/dash refill),
//               event → TriggerOn mapping incl. smash de-dupe, chance × luck, icd, every TriggerAction
//               executed with an observed effect, self-retrigger guard, sparkChance free sparks,
//               interval triggers, frenzy decay; then a 90 s auto-drafting sim per titan (no NaN,
//               same-seed determinism, procs observed).
//   D. DRAFTS — determinism, distinct + eligible offers, rarity histogram over 10,000 rolls at luck 0
//               and luck 3 vs the analytic expectation, chest drafts rare+ only, thin-pool fallback,
//               reroll / pick bookkeeping.
//
// Parallel-build fallback: if (and only if) a module another lane owns does not exist on disk yet, a
// PROBE-LOCAL stub stands in for it (see STUBS) and the run is labelled STUBBED. Once the real modules
// exist the hooks never fire and the probe runs 100 % real code.
// Exit code: 0 ok, 1 assertion failure, 2 = the sim cannot load at all.

import nodeModule from 'node:module';
import { pathToFileURL } from 'node:url';
import type {
  Rarity, RankIndex, SimEvent, StatKey, TitanId, TriggerAction, TriggerOn, UpgradeDef, World,
} from '../src/core/types.ts';

// ─────────────────────────────── missing-module stubs (probe-local) ───────────────────────────────
const SRC = pathToFileURL(process.cwd().replace(/\\/g, '/') + '/src/').href;
const STUBS: Record<string, string> = {
  'ai/director.ts': `
    export function createDirector() {
      return { wave: 0, nextWaveT: 4, spawnBudget: 0, eliteT: Infinity, elitesSpawned: 0,
               bossT: Infinity, bossSpawned: false, squadSeq: 0, data: {} };
    }
    export function spawnRing(w) { return Math.max(14, 5 * w.titan.height); }
    let SE = null;
    export async function __init() { SE = await import('${SRC}ai/enemies.ts'); }
    export function stepDirector(w) {
      const D = w.director;
      if (w.cheats.noSpawns || w.t < D.nextWaveT) return;
      D.wave++; D.nextWaveT = w.t + 4;
      w.events.push({ type: 'waveStart', wave: D.wave });
      if (!SE) return;
      const r = spawnRing(w);
      for (let i = 0; i < 5; i++) {
        const a = w.rng.spawn() * Math.PI * 2;
        SE.spawnEnemy(w, 'android', w.titan.x + Math.sin(a) * r, w.titan.z + Math.cos(a) * r);
      }
    }`,
  'ai/bosses/index.ts': `
    export function spawnBoss(w, id) {}
    export function stepBoss(w) {}
    export function damageBoss(w, part, dmg, opts) {}`,
};
const stubbed = new Set<string>();
type ResolveFn = (s: string, c: { parentURL?: string }) => { url: string; format?: string | null; shortCircuit?: boolean };
type LoadFn = (u: string, c: object) => { format?: string | null; source?: string | ArrayBuffer | null; shortCircuit?: boolean };
const reg = (nodeModule as unknown as {
  registerHooks?: (h: {
    resolve?: (s: string, c: { parentURL?: string }, next: ResolveFn) => ReturnType<ResolveFn>;
    load?: (u: string, c: object, next: LoadFn) => ReturnType<LoadFn>;
  }) => unknown;
}).registerHooks;
if (typeof reg === 'function') {
  reg({
    resolve(spec, ctx, next) {
      try { return next(spec, ctx); } catch (err) {
        if (ctx.parentURL && (spec.startsWith('.') || spec.startsWith('file:'))) {
          const href = new URL(spec, ctx.parentURL).href;
          for (const key of Object.keys(STUBS)) {
            if (href === SRC + key) { stubbed.add(key); return { url: href + '?probe-stub', format: 'module', shortCircuit: true }; }
          }
        }
        throw err;
      }
    },
    load(url, ctx, next) {
      if (url.endsWith('?probe-stub')) {
        const key = url.slice(SRC.length, -'?probe-stub'.length);
        return { format: 'module', source: STUBS[key], shortCircuit: true };
      }
      return next(url, ctx);
    },
  });
}

// ─────────────────────────────── assertion helpers ───────────────────────────────
let fails = 0;
let passes = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) passes++;
  else { fails++; console.log(`  FAIL  ${msg}`); }
}
function near(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)); }
function section(t: string): void { console.log(`\n== ${t} ==`); }

// ─────────────────────────────── load modules ───────────────────────────────
const DATA = await import('../src/data/upgrades.ts');
const STATS = await import('../src/upgrades/stats.ts');
const { TITANS } = await import('../src/data/titans.ts');
const CFG = await import('../src/core/config.ts');
const TYPES = await import('../src/core/types.ts');

const { UPGRADES, UPGRADE_BY_ID, describe, fmtNum } = DATA;
const { baseStatBlock, recomputeStats, stat, createUpgradeState, STAT_KEYS } = STATS;

const TITAN_IDS: readonly TitanId[] = TYPES.TITAN_IDS;
const ALL_ACTIONS: readonly TriggerAction[] = [
  'spark', 'shockwave', 'heal', 'shield', 'mass', 'xp', 'magnet', 'rubbleShot', 'frenzy', 'cdReduce',
  'dashRefund', 'meteor', 'arc', 'magma', 'bloom', 'slowField',
];
const ALL_ONS: readonly TriggerOn[] = [
  'smash', 'floorBreak', 'collapse', 'kill', 'crush', 'hit', 'crit', 'dash', 'ability', 'hurt', 'pickup',
  'rankUp', 'levelUp', 'interval',
];
const KIT_STATS: Record<TitanId, readonly StatKey[]> = {
  molo: ['biteCleave', 'pulseEvery', 'vacuumRadius'],
  voltkite: ['arcForks', 'wireDuration', 'wireDamage'],
  hearthback: ['shellCapacity', 'stompDelay', 'magmaDuration'],
  briarwick: ['turretCap', 'turretRate', 'sporeHeal', 'vineLength'],
};

// ═══════════════════════════════ A. DATA ═══════════════════════════════
section('A. DATA');
{
  const n = UPGRADES.length;
  const generic = UPGRADES.filter((u) => !u.titan);
  const byTag = (t: string) => generic.filter((u) => u.tags.includes(t)).length;
  const survival = byTag('survival');
  const growthMob = generic.filter((u) => u.tags.includes('growth') || u.tags.includes('mobility')).length;
  const offense = byTag('offense');
  const smash = byTag('smash');
  const legendary = UPGRADES.filter((u) => u.rarity === 'legendary');
  const mutations = legendary.filter((u) => u.tags.includes('mutation'));
  const rar: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
  for (const u of UPGRADES) rar[u.rarity]++;
  console.log(`total ${n} · generic ${generic.length} (survival ${survival}, growth/mobility ${growthMob}, offense ${offense}, smash ${smash}) · mutations ${mutations.length}`);
  console.log(`rarity counts: ${JSON.stringify(rar)}`);
  ok(n >= 120, `>= 120 upgrades (got ${n})`);
  ok(generic.length >= 64, `>= 64 generic (got ${generic.length})`);
  ok(survival >= 16 && growthMob >= 16 && offense >= 16 && smash >= 16, 'each generic category >= 16');
  ok(mutations.length >= 4, `several legendary mutations (got ${mutations.length})`);

  const perTitan: string[] = [];
  for (const tid of TITAN_IDS) {
    const own = UPGRADES.filter((u) => u.titan === tid);
    const readsKit = own.filter((u) => u.effects.some((e) => e.stat && KIT_STATS[tid].includes(e.stat)));
    perTitan.push(`${tid} ${own.length} (kit-stat ${readsKit.length})`);
    ok(own.length >= 14, `${tid}: >= 14 titan cards (got ${own.length})`);
    ok(readsKit.length === own.length, `${tid}: every titan card reads a kit stat (${readsKit.length}/${own.length})`);
    for (const k of KIT_STATS[tid]) ok(own.some((u) => u.effects.some((e) => e.stat === k)), `${tid}: kit stat ${k} touched by a ${tid} card`);
    // titan-locked cards must not touch ANOTHER titan's kit stats
    for (const u of own) for (const e of u.effects) {
      if (!e.stat) continue;
      for (const other of TITAN_IDS) if (other !== tid && KIT_STATS[other].includes(e.stat)) ok(false, `${u.id} touches ${other}'s kit stat ${e.stat}`);
    }
  }
  console.log(`per titan: ${perTitan.join(' · ')}`);
  // generic cards must not touch kit-only stats (they would be dead picks for 3 of 4 titans)
  for (const u of generic) for (const e of u.effects) if (e.stat) {
    for (const tid of TITAN_IDS) if (KIT_STATS[tid].includes(e.stat)) ok(false, `generic ${u.id} touches kit stat ${e.stat}`);
  }

  // ids + names unique
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const u of UPGRADES) {
    ok(!ids.has(u.id), `duplicate id ${u.id}`); ids.add(u.id);
    const nm = u.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    ok(!names.has(nm), `duplicate name ${u.name}`); names.add(nm);
    ok(UPGRADE_BY_ID[u.id] === u, `UPGRADE_BY_ID[${u.id}]`);
    ok(u.maxStacks >= 1 && u.maxStacks <= 5 && Number.isInteger(u.maxStacks), `${u.id}: maxStacks 1..5`);
    ok(['common', 'rare', 'epic', 'legendary'].includes(u.rarity), `${u.id}: rarity`);
    ok(u.effects.length > 0 && u.tags.length > 0, `${u.id}: effects + tags`);
    ok(u.desc.length > 0 && !u.desc.includes('\n'), `${u.id}: one-line desc`);
    ok(u.desc === describe(u.effects, u.maxStacks), `${u.id}: desc generated from effects`);
    if (u.minRank !== undefined) ok(u.minRank >= 0 && u.minRank <= 4, `${u.id}: minRank`);
    for (const e of u.effects) {
      if (e.stat) {
        ok(STAT_KEYS.includes(e.stat), `${u.id}: stat ${e.stat} is a StatKey`);
        ok((e.add ?? 0) !== 0 || (e.mul ?? 0) !== 0, `${u.id}: stat effect has add or mul`);
      }
      if (e.trigger) {
        const g = e.trigger;
        ok(ALL_ACTIONS.includes(g.action), `${u.id}: action ${g.action}`);
        ok(ALL_ONS.includes(g.on), `${u.id}: on ${g.on}`);
        ok(g.chance > 0 && g.chance <= 1, `${u.id}: chance in (0,1]`);
        ok(g.icd >= 0, `${u.id}: icd >= 0`);
        if (g.on === 'interval') ok(typeof g.p.every === 'number' && (g.p.every as number) > 0, `${u.id}: interval has p.every`);
        if (g.action === 'frenzy') ok(STAT_KEYS.includes(g.p.stat as StatKey), `${u.id}: frenzy stat valid`);
      }
    }
    if (u.titan) ok(TITAN_IDS.includes(u.titan), `${u.id}: titan id`);
  }

  // coverage: every StatKey, every TriggerAction
  const statsUsed = new Set<string>();
  const actionsUsed = new Set<string>();
  const onsUsed = new Set<string>();
  for (const u of UPGRADES) for (const e of u.effects) {
    if (e.stat) statsUsed.add(e.stat);
    if (e.trigger) { actionsUsed.add(e.trigger.action); onsUsed.add(e.trigger.on); if (e.trigger.action === 'frenzy') statsUsed.add(String(e.trigger.p.stat)); }
  }
  const missingStats = STAT_KEYS.filter((k) => !statsUsed.has(k));
  const missingActions = ALL_ACTIONS.filter((a) => !actionsUsed.has(a));
  const missingOns = ALL_ONS.filter((o) => !onsUsed.has(o));
  console.log(`stat coverage ${STAT_KEYS.length - missingStats.length}/${STAT_KEYS.length}${missingStats.length ? ' missing ' + missingStats.join(',') : ''}`);
  console.log(`action coverage ${ALL_ACTIONS.length - missingActions.length}/${ALL_ACTIONS.length}${missingActions.length ? ' missing ' + missingActions.join(',') : ''}`);
  console.log(`trigger-on coverage ${ALL_ONS.length - missingOns.length}/${ALL_ONS.length}${missingOns.length ? ' missing ' + missingOns.join(',') : ''}`);
  ok(missingStats.length === 0, 'every StatKey touched by >= 1 upgrade');
  ok(missingActions.length === 0, 'every TriggerAction used by >= 1 upgrade');

  // forbidden-name scan (CONTRACT §1 + common survivor-like item names)
  const FORBID = [
    'godzilla', 'gojira', 'kong', 'gamera', 'mothra', 'rodan', 'ghidorah', 'mechagodzilla', 'anguirus', 'ultraman',
    'jaeger', 'pacific rim', 'rampage', 'george', 'lizzie', 'ralph', 'kaiju', 'colossal', 'dawn of the monsters',
    'nhk', 'cnn', 'bbc', 'fox', 'spinach', 'hollow heart', 'empty tome', 'clover', 'attractorb', 'candelabrador',
    'duplicator', 'spellbinder', 'pummarola', 'bracer', 'tougher times', 'syringe', 'ukulele', 'behemoth',
    'hopoo', 'warbanner', 'medkit', 'glass cannon', 'crock-pot', 'crock pot', 'rush hour', 'short circuit',
  ];
  let hits = 0;
  for (const u of UPGRADES) {
    const hay = `${u.name} ${u.desc}`.toLowerCase();
    for (const f of FORBID) if (new RegExp(`\\b${f.replace(/[-]/g, '\\-')}\\b`).test(hay)) { hits++; ok(false, `${u.id}: forbidden word "${f}"`); }
  }
  console.log(`forbidden-name scan: ${hits} hit(s) over ${UPGRADES.length} names/descs`);

  // desc numbers vs effect numbers (spot-check every card)
  let numChecks = 0;
  for (const u of UPGRADES) for (const e of u.effects) {
    if (e.stat && e.mul) { numChecks++; ok(u.desc.includes(`${fmtNum(Math.abs(e.mul) * 100)}%`), `${u.id}: desc shows ${e.stat} mul ${e.mul}`); }
    if (e.stat && e.add) {
      numChecks++;
      const v = Math.abs(e.add);
      const variants = [fmtNum(v), `${fmtNum(v * 100)}%`, `${fmtNum(v * 10)}°`];
      ok(variants.some((s) => u.desc.includes(s)), `${u.id}: desc shows ${e.stat} add ${e.add}`);
    }
    if (e.trigger) {
      const g = e.trigger;
      if (g.chance < 1) { numChecks++; ok(u.desc.includes(`${fmtNum(g.chance * 100)}% chance`), `${u.id}: desc shows chance ${g.chance}`); }
      if (g.icd > 0) { numChecks++; ok(u.desc.includes(`${fmtNum(g.icd)} s cooldown`), `${u.id}: desc shows icd ${g.icd}`); }
      for (const k of ['dmg', 'dps', 'r', 'dur', 'count', 'every']) {
        const v = g.p[k];
        if (typeof v === 'number') { numChecks++; ok(u.desc.includes(fmtNum(v)), `${u.id}: desc shows p.${k}=${v}`); }
      }
      for (const k of ['amount', 'mul']) {
        const v = g.p[k];
        if (typeof v === 'number') {
          numChecks++;
          const asPct = `${fmtNum(v * 100)}%`;
          ok(u.desc.includes(fmtNum(v)) || u.desc.includes(asPct), `${u.id}: desc shows p.${k}=${v}`);
        }
      }
    }
  }
  console.log(`desc/effect number checks: ${numChecks}`);
  // show a few cards so a human can read the copy
  for (const id of ['load_bearing_gut', 'insurance_adjuster', 'faulty_wiring', 'falling_facade_advisory', 'condemned_structure', 'molo_septic_burp', 'hb_thermal_vent', 'bw_pollinator_corridor']) {
    const u = UPGRADE_BY_ID[id];
    if (u) console.log(`  [${u.rarity}] ${u.name} ×${u.maxStacks}: ${u.desc}`);
  }
}

// ═══════════════════════════════ B. STATS (hand-built World) ═══════════════════════════════
section('B. STATS');
/** Minimal World: exactly the fields stats.ts reads/writes. */
function handWorld(tid: TitanId, rank: RankIndex = 0): World {
  const base = TITANS[tid].base;
  const titan = {
    id: tid, rank, stats: { ...base }, maxHp: base.maxHp * CFG.RANKS[rank].hpMul, hp: base.maxHp * CFG.RANKS[rank].hpMul,
    alive: true, dashCharges: base.dashCharges, dashRecharge: 0, height: CFG.RANKS[rank].height,
  };
  return { titanId: tid, titan, upgrades: createUpgradeState() } as unknown as World;
}
{
  const EXPECT: Record<StatKey, number> = {
    maxHp: 100, regen: 0.5, armor: 0, iframes: 0, thorns: 0, lifesteal: 0, rubbleHeal: 0, moveSpeed: 1, dashCharges: 1,
    dashCooldown: 1, dashDistance: 2.2, pickupRadius: 1.6, massGain: 1, xpGain: 1, luck: 0, rerolls: 1, damage: 1,
    attackRate: 1, attackRange: 1, area: 1, critChance: 0.05, critMult: 1.6, knockback: 1, chains: 0, chainRange: 1,
    projectiles: 0, buildingDamage: 1, smashDamage: 1, smashRadius: 1, sparkChance: 0, abilityCooldown: 1,
    abilityPower: 1, biteCleave: 0, pulseEvery: 4, vacuumRadius: 1, arcForks: 3, wireDuration: 4, wireDamage: 1,
    shellCapacity: 1, stompDelay: 0.6, magmaDuration: 0, turretCap: 4, turretRate: 1, sporeHeal: 1, vineLength: 1,
  };
  const b = baseStatBlock();
  const keys = Object.keys(EXPECT) as StatKey[];
  ok(Object.keys(b).length === keys.length && STAT_KEYS.length === keys.length, `baseStatBlock has all ${keys.length} keys`);
  let bad = 0;
  for (const k of keys) if (b[k] !== EXPECT[k]) { bad++; ok(false, `baseStatBlock.${k} = ${b[k]} (want ${EXPECT[k]})`); }
  console.log(`baseStatBlock: ${keys.length - bad}/${keys.length} keys match CONTRACT §8`);

  // no upgrades → exactly the titan base (rank I)
  for (const tid of TITAN_IDS) {
    const w = handWorld(tid);
    recomputeStats(w);
    let diff = 0;
    for (const k of STAT_KEYS) if (!near(w.titan.stats[k], TITANS[tid].base[k])) { diff++; ok(false, `${tid}: bare ${k} ${w.titan.stats[k]} vs base ${TITANS[tid].base[k]}`); }
    ok(w.titan.stats !== TITANS[tid].base, `${tid}: stats block is not the shared TITANS base object`);
    ok(near(w.titan.maxHp, TITANS[tid].base.maxHp), `${tid}: maxHp = base at Size I`);
    if (!diff) console.log(`${tid}: bare recompute == TITANS.base (maxHp ${w.titan.maxHp}, armor ${w.titan.stats.armor}, moveSpeed ${w.titan.stats.moveSpeed})`);
  }

  // add + mul with stacks (molo: base armor 10, maxHp 140)
  {
    const w = handWorld('molo');
    const B0 = TITANS.molo.base;
    w.upgrades.owned = { rebar_molars: 3, seismic_retrofit: 2, condemned_structure: 1 };
    recomputeStats(w);
    const s = w.titan.stats;
    const wantDmg = B0.damage * (1 + 0.08 * 3) * (1 + 0.5);
    const wantHp = B0.maxHp * (1 + 0.06 * 2) * (1 - 0.25);
    ok(near(s.damage, wantDmg), `damage ${s.damage} = base×(1+0.08·3)×1.5 = ${wantDmg}`);
    ok(near(s.armor, B0.armor + 4 * 2), `armor ${s.armor} = base ${B0.armor} + 4·2`);
    ok(near(s.maxHp, wantHp) && near(w.titan.maxHp, wantHp), `maxHp ${s.maxHp} = 140×1.12×0.75 = ${wantHp}`);
    console.log(`molo rebar_molars×3 + seismic_retrofit×2 + condemned_structure: damage ${s.damage.toFixed(4)} armor ${s.armor} maxHp ${s.maxHp.toFixed(2)}`);
    // stacks above maxStacks are clamped
    w.upgrades.owned = { rebar_molars: 99 };
    recomputeStats(w);
    ok(near(w.titan.stats.damage, B0.damage * (1 + 0.08 * 5)), 'owned stacks above maxStacks clamp to maxStacks');
  }

  // cooldown floor 0.35 (voltkite base dashCooldown 0.75)
  {
    const w = handWorld('voltkite');
    w.upgrades.owned = { green_wave: 5, commuter_pass: 4, vk_rolling_blackout: 4 };
    recomputeStats(w);
    const raw = TITANS.voltkite.base.dashCooldown * (1 - 0.5) * (1 - 0.24) * (1 - 0.32);
    ok(raw < 0.35 && near(w.titan.stats.dashCooldown, 0.35), `dashCooldown raw ${raw.toFixed(3)} floored to ${w.titan.stats.dashCooldown}`);
    const floored = w.titan.stats.dashCooldown;
    w.upgrades.owned = { fast_track_permit: 4 };
    recomputeStats(w);
    ok(near(w.titan.stats.abilityCooldown, TITANS.voltkite.base.abilityCooldown * 0.72), `abilityCooldown ${w.titan.stats.abilityCooldown} = ×0.72`);
    w.upgrades.buffs.push({ stat: 'abilityCooldown', mul: -0.9, t: 1 });
    ok(near(stat(w, 'abilityCooldown'), 0.35), `frenzy cannot push abilityCooldown under the floor (${stat(w, 'abilityCooldown')})`);
    console.log(`voltkite dashCooldown floor: raw ${raw.toFixed(3)} → ${floored}; abilityCooldown ×0.72 → ${w.titan.stats.abilityCooldown.toFixed(3)}; frenzy −90 % → ${stat(w, 'abilityCooldown')}`);
  }

  // rank hp× + HP ratio keep + idempotence
  {
    const w = handWorld('molo');
    recomputeStats(w);
    w.titan.hp = w.titan.maxHp * 0.5;
    (w.titan as { rank: RankIndex }).rank = 2;
    recomputeStats(w);
    const want = TITANS.molo.base.maxHp * CFG.RANKS[2].hpMul;
    ok(near(w.titan.maxHp, want), `rank III maxHp ${w.titan.maxHp} = 140 × ${CFG.RANKS[2].hpMul}`);
    ok(near(w.titan.hp / w.titan.maxHp, 0.5), `HP ratio kept across the maxHp change (${(w.titan.hp / w.titan.maxHp).toFixed(3)})`);
    w.upgrades.owned = { load_bearing_gut: 2 };
    recomputeStats(w);
    ok(near(w.titan.maxHp, want * 1.24) && near(w.titan.hp / w.titan.maxHp, 0.5), 'upgrade maxHp change keeps HP ratio');
    const snap = JSON.stringify([w.titan.stats, w.titan.hp, w.titan.maxHp]);
    recomputeStats(w); recomputeStats(w);
    ok(JSON.stringify([w.titan.stats, w.titan.hp, w.titan.maxHp]) === snap, 'recomputeStats is idempotent');
    console.log(`molo rank III: maxHp ${want.toFixed(1)} → with load_bearing_gut×2 ${w.titan.maxHp.toFixed(1)}, hp ${w.titan.hp.toFixed(1)} (ratio 0.5 kept both times)`);
    // dash pool shrinks with a stat drop
    w.titan.dashCharges = 3;
    recomputeStats(w);
    ok(w.titan.dashCharges <= w.titan.stats.dashCharges, 'dash charges clamp to the (lower) cap');
  }

  // frenzy buffs in stat()
  {
    const w = handWorld('briarwick');
    w.upgrades.owned = { rebar_molars: 2 };
    recomputeStats(w);
    const fin = w.titan.stats.damage;
    ok(near(stat(w, 'damage'), fin), 'stat() == titan.stats without buffs');
    w.upgrades.buffs.push({ stat: 'damage', mul: 0.4, t: 3 });
    ok(near(stat(w, 'damage'), fin * 1.4), `one frenzy ×1.4 → ${stat(w, 'damage').toFixed(4)}`);
    w.upgrades.buffs.push({ stat: 'damage', mul: 0.25, t: 3 }, { stat: 'moveSpeed', mul: 0.5, t: 3 });
    ok(near(stat(w, 'damage'), fin * 1.4 * 1.25), 'two frenzies multiply');
    ok(near(w.titan.stats.damage, fin), 'buffs never write titan.stats');
    ok(near(stat(w, 'area'), w.titan.stats.area), 'unbuffed stat unaffected');
    console.log(`briarwick damage final ${fin.toFixed(3)} → with buffs ${stat(w, 'damage').toFixed(4)}`);
  }
}

// ═══════════════════════════════ C. ENGINE (real world) ═══════════════════════════════
section('C. ENGINE');
type WorldMod = typeof import('../src/core/world.ts');
type EngineMod = typeof import('../src/upgrades/engine.ts');
type DraftMod = typeof import('../src/upgrades/draft.ts');
let WM: WorldMod, EN: EngineMod, DR: DraftMod;
let enemiesMod: typeof import('../src/ai/enemies.ts');
let spatialMod: typeof import('../src/combat/spatial.ts');
let pickupsMod: typeof import('../src/combat/pickups.ts');
try {
  WM = await import('../src/core/world.ts');
  EN = await import('../src/upgrades/engine.ts');
  DR = await import('../src/upgrades/draft.ts');
  enemiesMod = await import('../src/ai/enemies.ts');
  spatialMod = await import('../src/combat/spatial.ts');
  pickupsMod = await import('../src/combat/pickups.ts');
  if (stubbed.has('ai/director.ts')) {
    const dm = await import('../src/ai/director.ts') as unknown as { __init?: () => Promise<void> };
    if (dm.__init) await dm.__init();
  }
} catch (err) {
  console.log('SKIP C/D: the sim cannot load yet (another lane\'s module is missing or broken):');
  console.log('  ' + String((err as Error).stack ?? err).split('\n').slice(0, 4).join('\n  '));
  console.log(`RESULT: ${passes} checks passed, ${fails} failed (sections C/D skipped)`);
  process.exit(fails ? 1 : 2);
}
console.log(stubbed.size ? `NOTE: STUBBED (missing on disk, probe-local stand-ins): ${[...stubbed].join(', ')}` : 'NOTE: all sim modules real (no stubs)');

const { applyUpgrade, stepUpgrades, processTriggers } = EN;

function fresh(tid: TitanId, seed = 11): World {
  const w = WM.createWorld({ titan: tid, biome: 'grideast', seed });
  w.cheats.noSpawns = true;
  w.events.length = 0;
  return w;
}
function procs(w: World, id?: string): number {
  let n = 0;
  for (const e of w.events) if (e.type === 'upgradeProc' && (id === undefined || e.id === id)) n++;
  return n;
}
function countEv(w: World, type: SimEvent['type']): number { let n = 0; for (const e of w.events) if (e.type === type) n++; return n; }
/** Put `n` enemies of `kind` on a ring of radius r around (x,z) and refresh the broadphase. */
function ringEnemies(w: World, kind: 'android' | 'tank', n: number, r: number, x = w.titan.x, z = w.titan.z): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    enemiesMod.spawnEnemy(w, kind, x + Math.sin(a) * r, z + Math.cos(a) * r);
  }
  spatialMod.rebuildEnemyGrid(w);
}
/** Register a probe-only synthetic card (in-memory; never offered — probe removes it from drafts by not listing it in UPGRADES). */
function synth(id: string, on: TriggerOn, action: TriggerAction, p: Record<string, number | string>, chance = 1, icd = 0, titan?: TitanId): string {
  const d: UpgradeDef = { id, name: id, desc: '', rarity: 'common', maxStacks: 1, tags: ['probe'], effects: [{ trigger: { on, chance, icd, action, p } }] };
  if (titan) d.titan = titan;
  (UPGRADE_BY_ID as Record<string, UpgradeDef>)[id] = d;
  return id;
}
const NOOP = { stat: 'luck', mul: 0, dur: 0.05 };   // frenzy that changes nothing but always "succeeds"

// ── applyUpgrade ──
{
  const w = fresh('molo');
  for (let i = 0; i < 7; i++) applyUpgrade(w, 'rebar_molars');
  ok(w.upgrades.owned.rebar_molars === 5, `stacks cap at maxStacks (${w.upgrades.owned.rebar_molars})`);
  ok(w.upgrades.order.filter((x) => x === 'rebar_molars').length === 1, 'pick order lists a card once');
  ok(near(w.titan.stats.damage, TITANS.molo.base.damage * 1.4), 'applyUpgrade recomputes stats');
  applyUpgrade(w, 'vk_extra_outlet');
  ok(!w.upgrades.owned.vk_extra_outlet, 'another titan\'s card is ignored');
  applyUpgrade(w, 'no_such_card');
  ok(!('no_such_card' in w.upgrades.owned), 'unknown id is ignored');
  w.titan.dashCharges = 0;
  applyUpgrade(w, 'carpool_permit');
  ok(w.titan.stats.dashCharges === TITANS.molo.base.dashCharges + 1 && w.titan.dashCharges === w.titan.stats.dashCharges,
    `dash-charge card refills every charge (${w.titan.dashCharges}/${w.titan.stats.dashCharges})`);
  const r0 = w.upgrades.rerolls;
  applyUpgrade(w, 'appeals_process');
  ok(w.upgrades.rerolls === r0 + 1, 'reroll card grants its reroll immediately');
  w.titan.hp = w.titan.maxHp * 0.5;
  applyUpgrade(w, 'load_bearing_gut');
  ok(near(w.titan.hp / w.titan.maxHp, 0.5), 'maxHp card keeps the HP ratio');
  console.log(`applyUpgrade: owned ${JSON.stringify(w.upgrades.owned)} order ${w.upgrades.order.join(',')}`);
}

// ── event → TriggerOn mapping (incl. smash de-dupe) ──
{
  const w = fresh('molo');
  const ons: TriggerOn[] = ['smash', 'floorBreak', 'collapse', 'kill', 'crush', 'hit', 'crit', 'dash', 'ability', 'hurt', 'pickup', 'rankUp', 'levelUp'];
  for (const o of ons) { synth(`__on_${o}`, o, 'frenzy', NOOP); w.upgrades.owned[`__on_${o}`] = 1; }
  const T = w.titan;
  const cases: { name: string; ev: SimEvent[]; want: Partial<Record<TriggerOn, number>> }[] = [
    { name: 'propDestroyed', ev: [{ type: 'propDestroyed', id: 1, kind: 'car', x: T.x, z: T.z, crushed: true }], want: { smash: 1 } },
    { name: 'floorBreak', ev: [{ type: 'floorBreak', id: 1, remaining: 2, x: T.x, z: T.z, tier: 0 }], want: { floorBreak: 1, smash: 1 } },
    { name: 'smash alone', ev: [{ type: 'smash', x: T.x, z: T.z, tier: 0 }], want: { smash: 1 } },
    { name: 'floorBreak+smash', ev: [{ type: 'floorBreak', id: 1, remaining: 2, x: T.x, z: T.z, tier: 0 }, { type: 'smash', x: T.x, z: T.z, tier: 0 }], want: { floorBreak: 1, smash: 1 } },
    { name: '3×propDestroyed+smash', ev: [0, 1, 2].map((i): SimEvent => ({ type: 'propDestroyed', id: i, kind: 'car', x: T.x, z: T.z, crushed: true })).concat([{ type: 'smash', x: T.x, z: T.z, tier: 0 }]), want: { smash: 3 } },
    { name: 'buildingCollapse', ev: [{ type: 'buildingCollapse', id: 1, x: T.x, z: T.z, tier: 1, w: 8, d: 8, h: 8 }], want: { collapse: 1 } },
    { name: 'enemyKilled', ev: [{ type: 'enemyKilled', id: 1, kind: 'android', x: T.x, z: T.z, crushed: false }], want: { kill: 1 } },
    { name: 'enemyKilled crushed', ev: [{ type: 'enemyKilled', id: 1, kind: 'android', x: T.x, z: T.z, crushed: true }], want: { kill: 1, crush: 1 } },
    { name: 'enemyHit', ev: [{ type: 'enemyHit', id: 1, x: T.x, z: T.z, dmg: 3, crit: false }], want: { hit: 1 } },
    { name: 'enemyHit crit', ev: [{ type: 'enemyHit', id: 1, x: T.x, z: T.z, dmg: 3, crit: true }], want: { hit: 1, crit: 1 } },
    { name: 'bossHit', ev: [{ type: 'bossHit', part: 'body', dmg: 3, x: T.x, z: T.z }], want: { hit: 1 } },
    { name: 'dash', ev: [{ type: 'dash', x0: T.x, z0: T.z, x1: T.x + 2, z1: T.z }], want: { dash: 1 } },
    { name: 'ability', ev: [{ type: 'ability', titan: 'molo', x: T.x, z: T.z, power: 1 }], want: { ability: 1 } },
    { name: 'titanHurt', ev: [{ type: 'titanHurt', dmg: 1, x: T.x, z: T.z, src: 'bullet' }], want: { hurt: 1 } },
    { name: 'pickup', ev: [{ type: 'pickup', kind: 'rubble', xp: 1, x: T.x, z: T.z }], want: { pickup: 1 } },
    { name: 'rankUp', ev: [{ type: 'rankUp', rank: 0 }], want: { rankUp: 1 } },
    { name: 'levelUp', ev: [{ type: 'levelUp', level: 2 }], want: { levelUp: 1 } },
    { name: 'footstep (unmapped)', ev: [{ type: 'footstep', x: T.x, z: T.z, heavy: 0 }], want: {} },
  ];
  let good = 0;
  for (const c of cases) {
    w.events.length = 0;
    for (const e of c.ev) w.events.push(e);
    processTriggers(w);
    const got: Partial<Record<TriggerOn, number>> = {};
    for (const o of ons) { const n = procs(w, `__on_${o}`); if (n) got[o] = n; }
    const same = JSON.stringify(got) === JSON.stringify(Object.fromEntries(ons.filter((o) => c.want[o]).map((o) => [o, c.want[o]])));
    ok(same, `${c.name} → ${JSON.stringify(got)} (want ${JSON.stringify(c.want)})`);
    if (same) good++;
  }
  console.log(`event mapping: ${good}/${cases.length} cases exact (smash de-dupe incl.)`);
  for (const o of ons) delete w.upgrades.owned[`__on_${o}`];
}

// ── chance × (1 + 0.1·luck), icd ──
{
  const w = fresh('molo');
  const id = synth('__chance', 'hit', 'frenzy', NOOP, 0.5, 0);
  w.upgrades.owned[id] = 1;
  const rate = (luck: number): number => {
    w.titan.stats.luck = luck;
    let n = 0;
    for (let i = 0; i < 4000; i++) {
      w.events.length = 0;
      w.events.push({ type: 'enemyHit', id: 1, x: 0, z: 0, dmg: 1, crit: false });
      processTriggers(w);
      n += procs(w, id);
    }
    return n / 4000;
  };
  const r0 = rate(0), r5 = rate(5), r10 = rate(10);
  console.log(`chance 0.5: luck 0 → ${r0.toFixed(3)} · luck 5 → ${r5.toFixed(3)} (want 0.75) · luck 10 → ${r10.toFixed(3)} (cap 1)`);
  ok(Math.abs(r0 - 0.5) < 0.03 && Math.abs(r5 - 0.75) < 0.03 && r10 === 1, 'chance scales with luck and caps at 1');
  delete w.upgrades.owned[id];
  w.titan.stats.luck = 0;

  const ic = synth('__icd', 'hit', 'frenzy', NOOP, 1, 1.0);
  w.upgrades.owned[ic] = 1;
  let n = 0;
  const at: number[] = [];
  for (let t = 0; t < 90; t++) {
    w.events.length = 0;
    stepUpgrades(w);
    w.events.push({ type: 'enemyHit', id: 1, x: 0, z: 0, dmg: 1, crit: false });
    processTriggers(w);
    const k = procs(w, ic);
    if (k) at.push(t);
    n += k;
  }
  console.log(`icd 1.0 s, a hit every tick for 3 s → ${n} procs at ticks ${at.join(',')}`);
  ok(n === 3, `icd limits procs (${n} == 3)`);
  delete w.upgrades.owned[ic];
}

// ── every TriggerAction: observed effect ──
{
  const results: string[] = [];
  const hpSum = (w: World): number => { let s = 0; for (const e of w.enemies) if (e.alive) s += e.hp; return s; };
  const aliveCount = (w: World): number => w.enemies.filter((e) => e.alive).length;
  const runAction = (tid: TitanId, action: TriggerAction, p: Record<string, number | string>, setup: (w: World) => void, check: (w: World, before: Record<string, number>) => string | null): void => {
    const w = fresh(tid, 23);
    setup(w);
    const id = synth(`__act_${action}_${tid}`, 'hit', action, p);
    w.upgrades.owned[id] = 1;
    const T = w.titan;
    const before: Record<string, number> = {
      hp: T.hp, shield: w.upgrades.shield, mass: T.mass, xp: T.xp + T.level * 1e6, proj: w.projectiles.filter((q) => q.alive).length,
      haz: w.hazards.filter((h) => h.alive).length, ehp: hpSum(w), alive: aliveCount(w), cd: T.abilityCd, dash: T.dashCharges,
      dmg: stat(w, 'damage'),
    };
    w.events.length = 0;
    w.events.push({ type: 'enemyHit', id: 0, x: T.x, z: T.z, dmg: 1, crit: false });
    processTriggers(w);
    const pr = procs(w, id);
    const err = pr === 1 ? check(w, before) : `procs ${pr}`;
    ok(err === null, `action ${action} (${tid}): ${err}`);
    results.push(`${action}${err === null ? '' : '✗'}`);
  };
  const ENEMY_R = 3;
  runAction('molo', 'spark', { dmg: 50, chains: 2 }, (w) => ringEnemies(w, 'android', 5, ENEMY_R),
    (w, b) => { const arc = w.events.find((e) => e.type === 'arc' && e.kind === 'upgrade'); return arc && arc.type === 'arc' && arc.pts.length >= 4 && hpSum(w) < b.ehp ? null : 'no upgrade arc / no damage'; });
  runAction('molo', 'shockwave', { r: 3, dmg: 50 }, (w) => ringEnemies(w, 'android', 4, ENEMY_R),
    (w, b) => countEv(w, 'explosion') > 0 && aliveCount(w) < b.alive ? null : 'no explosion / kill');
  runAction('molo', 'heal', { amount: 0.1, frac: 1 }, (w) => { w.titan.hp = w.titan.maxHp * 0.5; },
    (w, b) => near(w.titan.hp - b.hp, 0.1 * w.titan.maxHp) ? null : `healed ${w.titan.hp - b.hp}`);
  runAction('molo', 'shield', { amount: 0.1 }, () => {},
    (w) => near(w.upgrades.shield, 0.1 * w.titan.maxHp) ? null : `shield ${w.upgrades.shield}`);
  runAction('molo', 'mass', { amount: 2 }, () => {},
    (w, b) => w.titan.mass - b.mass >= 2 * CFG.TIERS[0].floorMass - 1e-9 ? null : `mass +${w.titan.mass - b.mass}`);
  runAction('molo', 'xp', { amount: 2 }, () => {},
    (w, b) => w.titan.xp + w.titan.level * 1e6 > b.xp ? null : 'no xp');
  runAction('molo', 'magnet', { r: 10 }, (w) => {
    for (let i = 0; i < 6; i++) pickupsMod.spawnPickup(w, 'rubble', w.titan.x + 6 + i, w.titan.z, 1, 1);
    for (const p of w.pickups) p.magnet = false;
  }, (w) => w.pickups.some((p) => p.alive && p.magnet) ? null : 'nothing magnetised');
  runAction('molo', 'rubbleShot', { count: 2, dmg: 10 }, (w) => ringEnemies(w, 'android', 3, ENEMY_R),
    (w, b) => {
      const n = w.projectiles.filter((q) => q.alive && q.kind === 'rubbleShot' && q.owner === 'titan').length;
      return n - b.proj >= 2 && (w.upgrades.icd[`__act_rubbleShot_molo`] ?? 0) > 0 ? null : `rubbleShots ${n}, linger icd ${w.upgrades.icd['__act_rubbleShot_molo']}`;
    });
  runAction('molo', 'frenzy', { stat: 'damage', mul: 0.5, dur: 2 }, () => {},
    (w, b) => {
      if (!near(stat(w, 'damage'), b.dmg * 1.5)) return `damage ${stat(w, 'damage')} vs ${b.dmg * 1.5}`;
      for (let i = 0; i < 63; i++) stepUpgrades(w);
      return w.upgrades.buffs.length === 0 && near(stat(w, 'damage'), b.dmg) ? null : 'buff did not decay after 2.1 s';
    });
  runAction('molo', 'cdReduce', { amount: 2 }, (w) => { w.titan.abilityCd = 5; },
    (w) => near(w.titan.abilityCd, 3) ? null : `abilityCd ${w.titan.abilityCd}`);
  runAction('molo', 'dashRefund', {}, (w) => { w.titan.dashCharges = 0; },
    (w) => w.titan.dashCharges === 1 ? null : `charges ${w.titan.dashCharges}`);
  runAction('molo', 'meteor', { r: 4, dmg: 30, aoe: 0.6 }, (w) => ringEnemies(w, 'android', 3, ENEMY_R),
    (w) => w.projectiles.some((q) => q.alive && q.lob && q.owner === 'titan') ? null : 'no lobbed meteor');
  runAction('molo', 'arc', { count: 3, dmg: 20 }, (w) => ringEnemies(w, 'android', 5, ENEMY_R),
    (w, b) => w.events.filter((e) => e.type === 'arc' && e.kind === 'upgrade').length === 3 && hpSum(w) < b.ehp ? null : 'want 3 upgrade arcs + damage');
  runAction('hearthback', 'magma', { r: 1, dps: 10, dur: 3 }, () => {},
    (w) => w.hazards.some((h) => h.alive && h.kind === 'magma' && h.owner === 'titan' && h.dps > 0 && h.data.upg === 1) ? null : 'no magma pool');
  for (const tid of ['molo', 'briarwick'] as TitanId[]) {
    runAction(tid, 'bloom', { dur: 10 }, (w) => ringEnemies(w, 'tank', 2, 3.5),
      (w) => {
        const h = w.hazards.find((q) => q.alive && q.kind === 'bloom');
        if (!h || !('cd' in h.data && 'spore' in h.data && 'h' in h.data && h.data.upg === 1)) return 'bloom hazard / data keys {cd,spore,h,upg}';
        if (countEv(w, 'bloomSpawn') !== 1) return 'no bloomSpawn event';
        // the bloom must actually fire seeds: tick the real world ~1.5 s (kit for BRIARWICK, engine otherwise)
        const seeds0 = w.projectiles.filter((q) => q.kind === 'seed').length;
        let seeded = 0;
        for (let i = 0; i < 45 && !w.run.result; i++) {
          WM.stepWorld(w, WM.NO_INPUT);
          seeded += w.projectiles.filter((q) => q.alive && q.kind === 'seed').length > seeds0 ? 1 : 0;
        }
        return seeded > 0 ? null : 'bloom never fired a seed';
      });
  }
  runAction('molo', 'slowField', { r: 2, dur: 3, dps: 4 }, () => {},
    (w) => {
      const h = w.hazards.find((q) => q.alive && q.kind === 'frost' && q.owner === 'titan');
      return h && h.dps > 0 && (w.upgrades.icd['__act_slowField_molo'] ?? 0) >= 3 - 1e-9 ? null : 'no damaging frost field / linger icd';
    });
  console.log(`actions executed with observed effect: ${results.join(' ')}`);
  const covered = new Set(results.map((r) => r.replace('✗', '')));
  ok(ALL_ACTIONS.every((a) => covered.has(a)), 'all 16 TriggerActions exercised');
}

// ── 'mass' / 'xp' pricing: triggering building's tier, capped at canFlatten; else canFlatten ──
{
  const w = fresh('molo', 61);
  (w.titan as { rank: RankIndex }).rank = 2;          // canFlatten 2 (no rankUp event → stats untouched)
  const id = synth('__massprice', 'collapse', 'mass', { amount: 1 });
  const lv = synth('__massprice_lv', 'levelUp', 'mass', { amount: 1 });
  w.upgrades.owned[id] = 1; w.upgrades.owned[lv] = 1;
  const gm = stat(w, 'massGain');
  const gain = (ev: SimEvent): number => { const m0 = w.titan.mass; w.events.length = 0; w.events.push(ev); processTriggers(w); return w.titan.mass - m0; };
  const g1 = gain({ type: 'buildingCollapse', id: 1, x: 0, z: 0, tier: 1, w: 8, d: 8, h: 8 });
  const g4 = gain({ type: 'buildingCollapse', id: 2, x: 0, z: 0, tier: 4, w: 8, d: 8, h: 8 });
  const gl = gain({ type: 'levelUp', level: 5 });
  console.log(`mass pricing @Size III: tier-1 collapse +${g1.toFixed(2)} · tier-4 collapse (capped) +${g4.toFixed(2)} · level-up +${gl.toFixed(2)} (massGain ${gm})`);
  ok(near(g1, CFG.TIERS[1].floorMass * gm) && near(g4, CFG.TIERS[2].floorMass * gm) && near(gl, CFG.TIERS[2].floorMass * gm),
    'mass proc priced by the event tier (capped at canFlatten), else canFlatten');
  delete w.upgrades.owned[id]; delete w.upgrades.owned[lv];
}

// ── self-retrigger guard + cross-feeding ──
{
  const w = fresh('voltkite', 31);
  ringEnemies(w, 'tank', 6, 3);
  const self = synth('__self', 'hit', 'spark', { dmg: 1, chains: 4 });
  const feed = synth('__feed', 'hit', 'frenzy', NOOP);
  w.upgrades.owned[self] = 1; w.upgrades.owned[feed] = 1;
  w.events.length = 0;
  w.events.push({ type: 'enemyHit', id: 0, x: w.titan.x, z: w.titan.z, dmg: 1, crit: false });
  processTriggers(w);
  const hitsBySpark = countEv(w, 'enemyHit') - 1;
  console.log(`self-guard: __self (hit→spark) procs ${procs(w, self)}; spark produced ${hitsBySpark} enemyHit; __feed procs ${procs(w, feed)}`);
  ok(procs(w, self) === 1, 'a spark\'s own hits never re-trigger the spark card');
  ok(hitsBySpark > 0 && procs(w, feed) === 1 + hitsBySpark, 'another card IS fed by the spark\'s hits (cross-feeding)');
  delete w.upgrades.owned[self]; delete w.upgrades.owned[feed];
}

// ── sparkChance (free sparks on smash) ──
{
  const w = fresh('molo', 41);
  ringEnemies(w, 'tank', 6, 3);
  applyUpgrade(w, 'faulty_wiring'); applyUpgrade(w, 'faulty_wiring'); applyUpgrade(w, 'faulty_wiring');
  let opp = 0, sp = 0, arcs = 0;
  for (let t = 0; t < 900; t++) {
    w.events.length = 0;
    stepUpgrades(w);
    w.events.push({ type: 'propDestroyed', id: t, kind: 'hydrant', x: w.titan.x, z: w.titan.z, crushed: true });
    opp++;
    processTriggers(w);
    sp += procs(w, 'faulty_wiring');
    arcs += w.events.filter((e) => e.type === 'arc' && e.kind === 'upgrade').length;
  }
  console.log(`sparkChance ${w.titan.stats.sparkChance.toFixed(2)}: ${sp} free sparks over ${opp} smash events (0.1 s icd), ${arcs} upgrade arcs`);
  ok(sp > 60 && sp < 250 && arcs === sp, 'sparkChance throws free sparks at a plausible rate');
}

// ── interval trigger + shield pool ──
{
  const w = fresh('molo', 51);
  applyUpgrade(w, 'storm_cellar');   // every 18 s: shield 10 % maxHp
  let n = 0;
  const times: string[] = [];
  let maxShield = 0;
  for (let t = 0; t < 60 * 30; t++) {
    w.events.length = 0;
    w.t += w.dt;
    stepUpgrades(w);
    processTriggers(w);
    const k = procs(w, 'storm_cellar');
    if (k) times.push(w.t.toFixed(1));
    n += k;
    maxShield = Math.max(maxShield, w.upgrades.shield);
  }
  console.log(`storm_cellar (every 18 s) over 60 s: ${n} procs at t=${times.join(',')} · peak shield ${maxShield.toFixed(1)} (${(maxShield / w.titan.maxHp * 100).toFixed(1)} % maxHp) · now ${w.upgrades.shield.toFixed(1)}`);
  ok(n === 3, 'interval trigger fires every p.every seconds');
  ok(maxShield >= 0.1 * w.titan.maxHp - 1e-6 && maxShield <= 0.5 * w.titan.maxHp + 1e-6, 'shield pool within cap');
}

// ── full sim with auto-drafting (all 4 titans) + determinism ──
// Driver: walk to the nearest flattenable prop/building (re-picked every 0.5 s), dash every ~1.7 s, hook
// every 3 s; pending drafts auto-picked through rollOffer/pickUpgrade. Variant "kit": the titan also
// starts with a fixed set of generic trigger cards so every trigger path runs inside the REAL tick.
{
  const SECONDS = 90;
  const KIT = ['permit_denied', 'jackhammer_hours', 'brownout', 'night_shift_nurse', 'insurance_adjuster',
    'sinkhole_stride', 'town_hall_rally', 'faulty_wiring', 'salvage_rights', 'spare_parts_bin', 'lost_and_found'];
  const goal = { x: 0, z: 0 };
  const pickGoal = (w: World): void => {
    const T = w.titan;
    const cf = CFG.RANKS[T.rank].canFlatten;
    let best = Infinity;
    goal.x = T.x + 30; goal.z = T.z;
    for (const p of w.city.props) {
      if (!p.alive || p.tier > cf) continue;
      const d = (p.x - T.x) ** 2 + (p.z - T.z) ** 2;
      if (d < best) { best = d; goal.x = p.x; goal.z = p.z; }
    }
    for (const b of w.city.buildings) {
      if (b.collapsed || b.tier > cf) continue;
      const d = ((b.x - T.x) ** 2 + (b.z - T.z) ** 2) * 0.6;   // buildings are worth more
      if (d < best) { best = d; goal.x = b.x; goal.z = b.z; }
    }
  };
  const runSim = (tid: TitanId, seed: number, kit: boolean): { hash: string; line: string; nan: boolean; procs: number; owned: number; byId: Map<string, number> } => {
    const w = WM.createWorld({ titan: tid, biome: 'grideast', seed });
    if (kit) for (const id of KIT) applyUpgrade(w, id);
    let totalProcs = 0;
    let nan = false;
    const byId = new Map<string, number>();
    for (let tick = 0; tick < SECONDS * 30 && !w.run.result; tick++) {
      if (tick % 15 === 0) pickGoal(w);
      const dx = goal.x - w.titan.x, dz = goal.z - w.titan.z;
      const m = Math.hypot(dx, dz) || 1;
      const input = { mx: dx / m, mz: dz / m, ability: tick % 90 === 45, abilityHeld: false, dash: tick % 50 === 25 };
      WM.stepWorld(w, input);
      for (const e of w.events) if (e.type === 'upgradeProc') { totalProcs++; byId.set(e.id, (byId.get(e.id) ?? 0) + 1); }
      let guard = 0;
      while (DR.hasPendingDraft(w) && guard++ < 20) {
        const offer = DR.rollOffer(w, w.upgrades.pendingDrafts === 0 && w.upgrades.chestDrafts > 0);
        if (!offer.length) break;
        DR.pickUpgrade(w, offer[tick % offer.length]);
      }
      const T = w.titan;
      if (![T.x, T.z, T.hp, T.maxHp, T.mass, T.xp, w.upgrades.shield].every(Number.isFinite)) nan = true;
      for (const k of STAT_KEYS) if (!Number.isFinite(T.stats[k])) nan = true;
    }
    const T = w.titan;
    const owned = Object.values(w.upgrades.owned).reduce((s2, v) => s2 + v, 0);
    const hash = JSON.stringify([T.x.toFixed(6), T.z.toFixed(6), T.hp.toFixed(6), T.mass.toFixed(6), T.level, T.rank, w.upgrades.owned, w.upgrades.order, totalProcs, w.enemies.length, w.tick]);
    const top = [...byId.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 7).map(([k, v]) => `${k}:${v}`).join(' ');
    const line = `${(tid + (kit ? '+kit' : '')).padEnd(14)} t ${w.t.toFixed(0)}s ${T.alive ? 'alive' : 'DEAD '} LV ${String(T.level).padStart(2)} SIZE ${T.rank + 1} hp ${T.hp.toFixed(0)}/${T.maxHp.toFixed(0)} floors ${T.floorsEaten} props ${T.propsEaten} kills ${T.kills} cards ${w.upgrades.order.length} (stacks ${owned}) procs ${totalProcs} [${top}]`;
    return { hash, line, nan, procs: totalProcs, owned, byId };
  };
  const kitProcIds = new Set<string>();
  for (const tid of TITAN_IDS) {
    for (const kit of [false, true]) {
      const a = runSim(tid, 777, kit), b = runSim(tid, 777, kit);
      console.log(a.line);
      ok(!a.nan, `${tid}${kit ? '+kit' : ''}: no NaN in titan state / stats`);
      ok(a.hash === b.hash, `${tid}${kit ? '+kit' : ''}: same seed => identical state hash`);
      ok(a.owned > (kit ? KIT.length : 0), `${tid}${kit ? '+kit' : ''}: drafts happened (${a.owned} stacks)`);
      if (kit) { ok(a.procs > 0, `${tid}+kit: triggers proc inside the real tick (${a.procs})`); for (const id of a.byId.keys()) kitProcIds.add(id); }
    }
  }
  console.log(`kit cards that procced in real play (any titan): ${[...kitProcIds].filter((x) => KIT.includes(x)).sort().join(', ')}`);
}

// ═══════════════════════════════ D. DRAFTS ═══════════════════════════════
section('D. DRAFTS');
{
  const { rollOffer, pickUpgrade, rerollOffer, hasPendingDraft } = DR;
  const eligible = (w: World, u: UpgradeDef): boolean =>
    (!u.titan || u.titan === w.titanId) && (u.minRank ?? 0) <= w.titan.rank && (w.upgrades.owned[u.id] ?? 0) < u.maxStacks;
  const RB: Record<Rarity, number> = { common: 60, rare: 28, epic: 10, legendary: 2 };
  const RL: Record<Rarity, number> = { common: 0, rare: 0.5, epic: 1, legendary: 1.5 };
  const RARS: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

  // determinism: same seed ⇒ same offer sequence (with picks in between)
  const seq = (seed: number): string => {
    const w = fresh('hearthback', seed);
    const out: string[] = [];
    for (let i = 0; i < 40; i++) {
      w.upgrades.pendingDrafts = 1;
      const o = rollOffer(w);
      out.push(o.join('+'));
      pickUpgrade(w, o[i % o.length]);
    }
    return out.join('|');
  };
  const s1 = seq(99), s2 = seq(99), s3 = seq(100);
  ok(s1 === s2, 'same seed ⇒ identical 40-draft offer/pick sequence');
  ok(s1 !== s3, 'different seed ⇒ different sequence');
  console.log(`determinism: seed 99 twice identical (${s1.length} chars), seed 100 differs; first offers: ${s1.split('|').slice(0, 2).join(' / ')}`);

  // histogram over 10,000 rolls at luck 0 and luck 3 (molo, Size I) + distinct/eligible every roll
  const hist = (luck: number, chest: boolean): { all: Record<Rarity, number>; first: Record<Rarity, number>; exp: Record<Rarity, number>; bad: number; minRankLeak: number; titanLeak: number } => {
    const w = fresh('molo', 5);
    w.titan.stats.luck = luck;
    const all: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const first: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    let bad = 0, minRankLeak = 0, titanLeak = 0;
    for (let i = 0; i < 10000; i++) {
      w.upgrades.offer = null;
      const o = rollOffer(w, chest);
      if (o.length !== 3 || new Set(o).size !== 3) bad++;
      for (let j = 0; j < o.length; j++) {
        const u = UPGRADE_BY_ID[o[j]];
        if (!u || !eligible(w, u)) bad++;
        if (u && (u.minRank ?? 0) > w.titan.rank) minRankLeak++;
        if (u && u.titan && u.titan !== 'molo') titanLeak++;
        if (u) { all[u.rarity]++; if (j === 0) first[u.rarity]++; }
      }
    }
    // analytic first-card expectation (per-slot rarity roll): w_r(luck) / Σ over rarities with cards left
    const n: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const u of UPGRADES) if (eligible(w, u) && !(chest && u.rarity === 'common')) n[u.rarity]++;
    let tot = 0;
    const exp: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const r of RARS) { exp[r] = n[r] > 0 ? RB[r] * (1 + luck * RL[r]) : 0; tot += exp[r]; }
    for (const r of RARS) exp[r] /= tot;
    return { all, first, exp, bad, minRankLeak, titanLeak };
  };
  const pct1 = (x: number, t: number) => `${(100 * x / t).toFixed(1)}%`;
  for (const luck of [0, 3]) {
    const h = hist(luck, false);
    const allTot = RARS.reduce((s0, r) => s0 + h.all[r], 0);
    console.log(`luck ${luck}: all 30k cards ${RARS.map((r) => `${r} ${pct1(h.all[r], allTot)}`).join(' · ')}`);
    console.log(`         first card    ${RARS.map((r) => `${r} ${pct1(h.first[r], 10000)} (exp ${(100 * h.exp[r]).toFixed(1)}%)`).join(' · ')}`);
    ok(h.bad === 0, `luck ${luck}: every offer = 3 distinct eligible ids (${h.bad} bad)`);
    ok(h.minRankLeak === 0 && h.titanLeak === 0, `luck ${luck}: no minRank / other-titan leaks`);
    for (const r of RARS) ok(Math.abs(h.first[r] / 10000 - h.exp[r]) < 0.02, `luck ${luck}: first-card ${r} share ${pct1(h.first[r], 10000)} ≈ expected ${(100 * h.exp[r]).toFixed(1)}%`);
  }
  {
    const h0 = hist(0, false), h3 = hist(3, false);
    ok(h3.all.legendary > h0.all.legendary * 2 && h3.all.epic > h0.all.epic && h3.all.common < h0.all.common, 'luck 3 shifts the draft toward rarer cards');
  }
  // chest drafts: rare+ only
  {
    const h = hist(0, true);
    const tot = RARS.reduce((s0, r) => s0 + h.all[r], 0);
    console.log(`chest 10k: ${RARS.map((r) => `${r} ${h.all[r]}`).join(' · ')} (of ${tot}); first card ${RARS.slice(1).map((r) => `${r} ${pct1(h.first[r], 10000)} (exp ${(100 * h.exp[r]).toFixed(1)}%)`).join(' · ')}`);
    ok(h.all.common === 0 && h.bad === 0, 'chest offers are rare+ only, 3 distinct eligible');
    for (const r of RARS) ok(Math.abs(h.first[r] / 10000 - h.exp[r]) < 0.02, `chest: first-card ${r} share ≈ expected`);
  }

  // minRank gating flips on at Size II
  {
    const w = fresh('molo', 8);
    (w.titan as { rank: RankIndex }).rank = 1;
    let seen = 0;
    for (let i = 0; i < 3000; i++) { w.upgrades.offer = null; for (const id of rollOffer(w)) if ((UPGRADE_BY_ID[id].minRank ?? 0) === 1) seen++; }
    ok(seen > 0, `minRank-1 cards appear once the titan is Size II (${seen} over 3000 offers)`);
  }

  // thin pools
  {
    const w = fresh('briarwick', 9);
    const elig = UPGRADES.filter((u) => eligible(w, u));
    const keep = elig.filter((u) => u.rarity === 'common').slice(0, 2).map((u) => u.id);
    for (const u of elig) if (!keep.includes(u.id)) w.upgrades.owned[u.id] = u.maxStacks;
    w.upgrades.pendingDrafts = 1;
    const o = rollOffer(w);
    ok(o.length === 2 && o.every((id) => keep.includes(id)), `thin pool (2 left) → offer of 2 (${o.join(',')})`);
    ok(hasPendingDraft(w), 'hasPendingDraft true while cards remain');
    // chest with only one rare+ left → topped up with commons (graceful, never short when commons exist)
    w.upgrades.offer = null;
    const lastRare = elig.find((u) => u.rarity !== 'common')!;
    w.upgrades.owned[lastRare.id] = 0;
    w.upgrades.chestDrafts = 1;
    const c = rollOffer(w, true);
    ok(c.length === 3 && c.includes(lastRare.id), `thin chest pool → rare+ first, then commons (${c.join(',')})`);
    pickUpgrade(w, lastRare.id);
    ok(w.upgrades.chestDrafts === 0 && w.upgrades.pendingDrafts === 1, 'chest pick consumed the chest draft, not the level-up draft');
    // empty pool → [] and no pending draft reported (the app never blocks on an impossible draft)
    for (const u of elig) w.upgrades.owned[u.id] = u.maxStacks;
    w.upgrades.offer = null;
    const e = rollOffer(w);
    ok(e.length === 0 && w.upgrades.offer === null && !hasPendingDraft(w), 'empty pool → [] and hasPendingDraft false');
    console.log(`thin pools: 2-card offer ${o.join(',')} · chest top-up ${c.join(',')} · empty → [${e.join(',')}]`);
  }

  // reroll + pick bookkeeping
  {
    const w = fresh('voltkite', 12);
    ok(!hasPendingDraft(w), 'no draft owed at start');
    w.upgrades.pendingDrafts = 2;
    ok(hasPendingDraft(w), 'hasPendingDraft with pendingDrafts > 0');
    const o1 = rollOffer(w);
    ok(w.upgrades.rerolls === Math.floor(stat(w, 'rerolls')), `new draft refills rerolls to the stat (${w.upgrades.rerolls})`);
    ok(rollOffer(w).join() === o1.join(), 're-opening an open draft returns the same offer');
    const o2 = rerollOffer(w);
    ok(!!o2 && o2.length === 3 && o2.every((id) => !o1.includes(id)), `reroll gives 3 fresh cards (${o1.join(',')} → ${o2 ? o2.join(',') : 'null'})`);
    ok(w.upgrades.rerolls === 0 && rerollOffer(w) === null, 'reroll consumes one; none left → null');
    const pick = w.upgrades.offer![0];
    pickUpgrade(w, pick);
    ok(w.upgrades.pendingDrafts === 1 && w.upgrades.offer === null && (w.upgrades.owned[pick] ?? 0) === 1, 'pick applies, consumes one level-up draft, clears the offer');
    // a no-op pick (maxed card, not on offer) consumes nothing
    applyUpgrade(w, 'carpool_permit'); applyUpgrade(w, 'carpool_permit');   // maxStacks 2
    const pend = w.upgrades.pendingDrafts;
    pickUpgrade(w, 'carpool_permit');
    pickUpgrade(w, 'molo_hinge_variance');
    pickUpgrade(w, 'no_such_card');
    ok(w.upgrades.pendingDrafts === pend && (w.upgrades.owned.carpool_permit ?? 0) === 2 && !w.upgrades.owned.molo_hinge_variance,
      'maxed / other-titan / unknown picks consume no draft');
    applyUpgrade(w, 'appeals_process');
    rollOffer(w);
    ok(w.upgrades.rerolls === 2, `the rerolls stat sets rerolls per draft (${w.upgrades.rerolls})`);
    // chest flag omitted: chest draft exactly when only a chest is owed
    w.upgrades.offer = null; w.upgrades.pendingDrafts = 0; w.upgrades.chestDrafts = 1;
    let commons = 0;
    for (let i = 0; i < 300; i++) { w.upgrades.offer = null; for (const id of rollOffer(w)) if (UPGRADE_BY_ID[id].rarity === 'common') commons++; }
    ok(commons === 0, `rollOffer(w) with only a chest owed → rare+ only (${commons} commons)`);
    const co = w.upgrades.offer![0];
    pickUpgrade(w, co);
    ok(w.upgrades.chestDrafts === 0 && w.upgrades.pendingDrafts === 0 && !hasPendingDraft(w), 'chest pick consumed the chest draft');
    console.log(`reroll/pick: ${o1.join(',')} → reroll → ${o2 ? o2.join(',') : 'null'} · picked ${pick} · pending ${w.upgrades.pendingDrafts} · rerolls next draft ${w.upgrades.rerolls}`);
  }
}

// ═══════════════════════════════ summary ═══════════════════════════════
console.log(`\n${stubbed.size ? `NOTE: STUBBED (missing on disk, probe-local stand-ins): ${[...stubbed].join(', ')}` : 'NOTE: all sim modules real (no stubs)'}`);
console.log(`RESULT: ${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
