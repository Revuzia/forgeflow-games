// BLOCKTOOTH v2 — EXTENDED COVERAGE probe (FEATURES_V2 §9, §15.3; lane L5). Node, THREE-free.
//
//   node _harness/probe_endless.ts                     # molo/grideast (+ a short run per city), seed 1337
//   node _harness/probe_endless.ts --titan hearthback --biome lockwater --seed 7
//   node _harness/probe_endless.ts --minutes 12
//
// Scenario A (the §9.3 run): the gate bot plays until the city's boss is fielded, the boss is killed the way
// the dev cheat does it (intro skipped, bossUltHit(w, 1, 0)), the next tick files `runEnd clear`, then
// continueEndless → 12 sim minutes with the gate bot (no god), then death (natural, or forced at the end).
// Scenario B (rematch bookkeeping): the same clear, then every rematch is dev-killed as soon as its intro
// ends, so 4+ rematches happen inside the window whatever the bot's damage output.
//
// Asserts (exit 1 on any failure, 2 if the sim cannot load):
//   1. continueEndless refuses before a clear and twice; after it: result null, phase 'endless', endT −1,
//      boss null, EndlessState per §9.1 (rematches 0, nextBossT +150, bossIx 1, nextEliteT +30, killsAt, tonsAt)
//   2. no NaN / no throw; run.phase stays 'endless' on every endless tick; no runEnd clear in endless
//   3. multipliers at m = 1 / 5 / 10 equal the formulas (direct), and are the ratios the pre-wired call sites
//      actually apply: director budgetRate, spawnEnemy HP, hurtTitan damage, bossHostile (rematch step)
//   4. rematches: the first at KEEP GOING + 150 s, each next one 150 s after the previous rematch dies (±1 tick),
//      in rematchOrder(biome) starting at bossIx 1 (GRID-EAST: CAISSON-4 → IRON GULLY → PARKADE-6 → …), HP =
//      BOSSES[id].hp × BOSS_HP_SCALE[rank] × (1 + 0.5 n); `endlessBoss` + ONE `alert rematch` (no `alert boss`);
//      a dead rematch drops a chest (+ a forced power-up once the L4 map sim is merged) and rematches++
//   5. RAMRODs: the first 30 s after KEEP GOING, then ≥ 60 s apart
//   6. the score is monotone (every tick) and equals floor(10·s + 2·kills + 5000·rematches + tons/500)
//   7. death ends the run: result 'dead', runEnd dead, w.endless still set; stepWorld after it is a no-op
//   8. determinism: scenario A run twice (same seed, same decision tick) → identical hashes at every 60 s checkpoint

import type { BiomeId, BossId, SimEvent, TitanId, TitanInput, World } from '../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../src/core/types.ts';
import { BOSS_HP_SCALE, ENDLESS, SIM_HZ } from '../src/core/config.ts';

type Mods = {
  world: typeof import('../src/core/world.ts');
  draft: typeof import('../src/upgrades/draft.ts');
  bot: typeof import('./bot.ts');
  endless: typeof import('../src/meta/endless.ts');
  bosses: typeof import('../src/ai/bosses/index.ts');
  director: typeof import('../src/ai/director.ts');
  enemies: typeof import('../src/ai/enemies.ts');
  titansim: typeof import('../src/titans/titansim.ts');
  BOSSES: typeof import('../src/data/bosses.ts')['BOSSES'];
  BIOMES: typeof import('../src/data/biomes.ts')['BIOMES'];
};
let M: Mods;

async function load(): Promise<string | null> {
  try {
    M = {
      world: await import('../src/core/world.ts'),
      draft: await import('../src/upgrades/draft.ts'),
      bot: await import('./bot.ts'),
      endless: await import('../src/meta/endless.ts'),
      bosses: await import('../src/ai/bosses/index.ts'),
      director: await import('../src/ai/director.ts'),
      enemies: await import('../src/ai/enemies.ts'),
      titansim: await import('../src/titans/titansim.ts'),
      BOSSES: (await import('../src/data/bosses.ts')).BOSSES,
      BIOMES: (await import('../src/data/biomes.ts')).BIOMES,
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
function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const TITAN = (arg('--titan') ?? 'molo') as TitanId;
const BIOME = (arg('--biome') ?? 'grideast') as BiomeId;
const SEED = (() => { const s = arg('--seed'); const n = s === null ? 1337 : Number(s) >>> 0; return Number.isFinite(n) ? n : 1337; })();
const MINUTES = (() => { const s = arg('--minutes'); const n = s === null ? 12 : Number(s); return Number.isFinite(n) && n > 0 ? n : 12; })();
const NO_INPUT: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const TICK = 1 / SIM_HZ;
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

function mkWorld(titan: TitanId, biome: BiomeId, seed = SEED): World {
  return M.world.createWorld({ titan, biome, seed, meta: { unlocked: [], perk: null, palette: 0, reviveUsed: false } });
}

function drafts(w: World): void {
  const D = M.draft;
  let guard = 0;
  while (D.hasPendingDraft(w) && ++guard < 200) {
    const chest = w.upgrades.chestDrafts > 0;
    const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : D.rollOffer(w, chest);
    if (!offer || offer.length === 0) break;
    D.pickUpgrade(w, M.bot.botPickUpgrade(w, offer));
  }
}

function botStep(w: World): void { drafts(w); M.world.stepWorld(w, M.bot.botInput(w)); }

function nanCheck(w: World): string | null {
  const T = w.titan;
  const f = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));
  if (!f(T.x, T.z, T.hp, T.maxHp, T.xp, T.height)) return `titan non-finite @${w.t.toFixed(1)}`;
  for (const e of w.enemies) if (e.alive && !f(e.x, e.z, e.hp)) return `enemy ${e.kind} non-finite @${w.t.toFixed(1)}`;
  if (w.boss && !f(w.boss.x, w.boss.z, w.boss.hp, w.boss.maxHp)) return `boss non-finite @${w.t.toFixed(1)}`;
  if (w.endless && !f(w.endless.score, w.endless.startT)) return `endless non-finite @${w.t.toFixed(1)}`;
  return null;
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
function hashWorld(w: World): string {
  let h = 0x811c9dc5 >>> 0;
  const u = (x: number): void => { for (let s = 0; s < 32; s += 8) { h ^= (x >>> s) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } };
  const n = (x: number): void => { F64[0] = x; u(U32[0]); u(U32[1]); };
  const T = w.titan;
  for (const v of [w.tick, w.t, w.nextId, T.x, T.z, T.hp, T.maxHp, T.xp, T.level, T.rank, T.kills, w.run.tonnage]) n(v);
  for (const e of w.enemies) if (e.alive) { n(e.x); n(e.z); n(e.hp); }
  if (w.boss) { n(w.boss.hp); n(w.boss.maxHp); n(w.boss.x); n(w.boss.z); }
  if (w.endless) { n(w.endless.score); n(w.endless.rematches); n(w.endless.bossIx); n(Number.isFinite(w.endless.nextBossT) ? w.endless.nextBossT : -1); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** play with the gate bot until the city boss is fielded and its intro is over (≤ 600 s), then dev-kill it
 *  (the cheat's path) and step once: the run files `runEnd clear`. Returns false when no clear happened. */
function playToClear(w: World): boolean {
  const cap = 600 * SIM_HZ;
  for (let i = 0; i < cap && !w.run.result; i++) {
    botStep(w);
    if (w.boss && w.boss.alive && w.boss.introT <= 0) break;
  }
  if (w.run.result) return false;
  if (!w.boss || !w.boss.alive) {
    M.bosses.spawnBoss(w, M.BIOMES[w.biomeId].boss);
  }
  const b = w.boss;
  if (!b) return false;
  b.introT = 0;
  M.bosses.bossUltHit(w, 1, 0);
  botStep(w);
  return w.run.result === 'clear';
}

// ─────────────────────────────── 3. multipliers ───────────────────────────────
function checkMultipliers(): void {
  console.log('\n3. multipliers (formula + the pre-wired call sites)');
  const E = M.endless;
  for (const m of [1, 5, 10]) {
    const fake = { t: 1000 + 60 * m, endless: { startT: 1000, rematches: 0, nextBossT: Infinity, bossIx: 1, nextEliteT: 0, killsAt: 0, tonsAt: 0, score: 0 }, boss: null } as unknown as World;
    const bud = Math.min(ENDLESS.budgetMax, 1 + ENDLESS.budgetPerMin * m);
    const hp = 1 + ENDLESS.hpPerMin * m;
    const dmg = Math.min(ENDLESS.dmgMax, 1 + ENDLESS.dmgPerMin * m);
    ok(near(E.endlessBudgetMul(fake), bud) && near(E.endlessHpMul(fake), hp) && near(E.endlessDmgMul(fake), dmg),
      `m=${m}: budget ${E.endlessBudgetMul(fake).toFixed(3)} (${bud.toFixed(3)}) · HP ${E.endlessHpMul(fake).toFixed(3)} (${hp.toFixed(3)}) · dmg ${E.endlessDmgMul(fake).toFixed(3)} (${dmg.toFixed(3)})`);
    console.log(`  m=${String(m).padStart(2)}: budget ×${bud.toFixed(2)} · spawn HP ×${hp.toFixed(2)} · hostile dmg ×${dmg.toFixed(2)}`);
  }
  const off = { t: 500, endless: null, boss: null } as unknown as World;
  ok(E.endlessBudgetMul(off) === 1 && E.endlessHpMul(off) === 1 && E.endlessDmgMul(off) === 1 && E.endlessBossDmgMul(off) === 1 && E.endlessScore(off) === 0, 'outside endless every multiplier is 1 and the score 0');
  ok(near(E.endlessBudgetMul({ t: 60 * 30, endless: { startT: 0 } } as unknown as World), ENDLESS.budgetMax) && near(E.endlessDmgMul({ t: 60 * 30, endless: { startT: 0 } } as unknown as World), ENDLESS.dmgMax), 'budget and damage cap at m = 30');

  // the call sites apply them: two identical worlds, one with w.endless at m = 5
  const mk = (): World => { const w = mkWorld(TITAN, BIOME); w.cheats.noSpawns = true; M.world.stepN(w, 60); return w; };
  const a = mk(), b = mk();
  (b as { endless: World['endless'] }).endless = { startT: b.t - 300, rematches: 2, nextBossT: Infinity, bossIx: 1, nextEliteT: 1e9, killsAt: 0, tonsAt: 0, score: 0 };
  ok(near(M.director.budgetRate(b) / M.director.budgetRate(a), 1 + 5 * ENDLESS.budgetPerMin, 1e-9), `budgetRate ratio ${(M.director.budgetRate(b) / M.director.budgetRate(a)).toFixed(4)} = ${(1 + 5 * ENDLESS.budgetPerMin).toFixed(4)}`);
  const ea = M.enemies.spawnEnemy(a, 'android', a.titan.x + 30, a.titan.z);
  const eb = M.enemies.spawnEnemy(b, 'android', b.titan.x + 30, b.titan.z);
  ok(near(eb.hp / ea.hp, 1 + 5 * ENDLESS.hpPerMin, 1e-9), `spawnEnemy HP ratio ${(eb.hp / ea.hp).toFixed(4)} = ${(1 + 5 * ENDLESS.hpPerMin).toFixed(4)}`);
  a.titan.iframeT = 0; b.titan.iframeT = 0;
  const da = M.titansim.hurtTitan(a, 10, 'bullet', a.titan.x, a.titan.z);
  const db = M.titansim.hurtTitan(b, 10, 'bullet', b.titan.x, b.titan.z);
  ok(da > 0 && near(db / da, 1 + 5 * ENDLESS.dmgPerMin, 1e-9), `hurtTitan ratio ${(db / Math.max(1e-9, da)).toFixed(4)} = ${(1 + 5 * ENDLESS.dmgPerMin).toFixed(4)}`);
  const bossId = M.BIOMES[BIOME].boss;
  M.bosses.spawnBoss(a, bossId); M.bosses.spawnBoss(b, bossId);
  const ha = M.bosses.bossHostile(a, 10), hb = M.bosses.bossHostile(b, 10);
  ok(near(hb / ha, 1 + 2 * ENDLESS.rematchDmgStep, 1e-9), `bossHostile ratio with 2 rematches won ${(hb / ha).toFixed(4)} = ${(1 + 2 * ENDLESS.rematchDmgStep).toFixed(4)}`);
  ok(M.endless.endlessBossDmgMul(b) === 1 + 2 * ENDLESS.rematchDmgStep, 'endlessBossDmgMul while a rematch is alive');
  b.boss!.alive = false;
  ok(M.endless.endlessBossDmgMul(b) === 1, 'endlessBossDmgMul = 1 with no live boss');
  // rematch order
  const want: Record<BiomeId, BossId[]> = { grideast: ['parkade6', 'caisson4', 'irongully'], whitestacks: ['irongully', 'caisson4', 'parkade6'], lockwater: ['caisson4', 'irongully', 'parkade6'] };
  for (const bi of BIOME_IDS) ok(JSON.stringify(M.endless.rematchOrder(bi)) === JSON.stringify(want[bi]), `rematchOrder(${bi}) = ${M.endless.rematchOrder(bi).join(' → ')}`);
}

// ─────────────────────────────── scenario A ───────────────────────────────
interface RunLog {
  hashes: string[]; finalHash: string; rematchT: number[]; rematchIds: string[]; rematchHp: string[]; bossDeathT: number[];
  eliteT: number[]; startT: number; endT: number; result: string | null; forcedDeath: boolean; rematchesWon: number; score: number;
}

function scenarioA(titan: TitanId, biome: BiomeId, minutes: number, verbose: boolean, devKillRematches: boolean): RunLog {
  const log: RunLog = { hashes: [], finalHash: '', rematchT: [], rematchIds: [], rematchHp: [], bossDeathT: [], eliteT: [], startT: NaN, endT: NaN, result: null, forcedDeath: false, rematchesWon: 0, score: 0 };
  const tag = `${titan}/${biome}${devKillRematches ? ' (dev-killed rematches)' : ''}`;
  const w = mkWorld(titan, biome);
  ok(!M.endless.continueEndless(w), `${tag}: continueEndless refused before a clear`);
  if (!ok(playToClear(w), `${tag}: the dev boss kill files runEnd clear (result ${w.run.result} @${w.t.toFixed(0)} s)`)) return log;
  let sawClear = false; for (const e of w.events) if (e.type === 'runEnd' && e.result === 'clear') sawClear = true;
  ok(sawClear, `${tag}: runEnd clear event`);
  const kills0 = w.titan.kills, tons0 = w.run.tonnage, t0 = w.t;
  ok(M.endless.continueEndless(w), `${tag}: continueEndless accepted after the clear`);
  const E = w.endless!;
  ok(w.run.result === null && w.run.phase === 'endless' && w.run.endT === -1 && w.boss === null, `${tag}: run reopened (result ${w.run.result} phase ${w.run.phase} endT ${w.run.endT} boss ${w.boss})`);
  ok(E.startT === t0 && E.rematches === 0 && near(E.nextBossT, t0 + ENDLESS.bossEveryS) && E.bossIx === 1 && near(E.nextEliteT, t0 + 30) && E.killsAt === kills0 && E.tonsAt === tons0 && E.score === 0,
    `${tag}: EndlessState per §9.1 (${JSON.stringify(E)})`);
  ok(!M.endless.continueEndless(w), `${tag}: continueEndless refused a second time`);
  log.startT = t0;
  const order = M.endless.rematchOrder(biome);
  const maxTicks = Math.round(minutes * 60 * SIM_HZ);
  let lastScore = -1, monotone = true, phaseOk = true, clearInEndless = false, nan: string | null = null, threw: string | null = null;
  let alerts = { boss: 0, rematch: 0 };
  const chestsBefore = (ww: World): number => { let n = 0; for (const p of ww.pickups) if (p.alive && p.kind === 'chest') n++; return n; };
  // a rematch death → its reward (chest + forced power-up) lands in stepEndless on the SAME tick when the
  // titan's own attack (stepTitan, before stepEndless) killed it, or on the NEXT tick otherwise (stepBoss /
  // projectiles / a dev kill after the tick): watched over the death tick + 2 more, against the chest count
  // from before the death tick
  let pendingDeath: { chests: number; pu: number; ticks: number } | null = null;
  let chestOk = 0, chestChecks = 0, puSeen = 0, puAll = 0;
  const hpChecks: string[] = [];
  const mChecks: string[] = [];
  const mAt = new Set([1, 5, 10].map((m) => Math.round((t0 + 60 * m) * SIM_HZ)));
  let i = 0;
  try {
    for (; i < maxTicks && !w.run.result; i++) {
      const chests = chestsBefore(w);
      botStep(w);
      const evs: readonly SimEvent[] = w.events;
      let puSpawn = 0;
      for (const e of evs) {
        if (e.type === 'endlessBoss') {
          const b = w.boss!;
          log.rematchT.push(w.t); log.rematchIds.push(e.boss);
          const n = log.rematchT.length - 1;
          const wantId = order[(1 + n) % order.length];
          ok(e.boss === wantId, `${tag}: rematch #${n + 1} is ${e.boss} (want ${wantId})`);
          const wantHp = M.BOSSES[e.boss].hp * BOSS_HP_SCALE[w.titan.rank] * (1 + ENDLESS.rematchHpStep * E.rematches);
          hpChecks.push(`${e.boss} ${b.maxHp.toFixed(0)}/${wantHp.toFixed(0)}`);
          ok(near(b.maxHp, wantHp, 1e-9) && near(b.hp, b.maxHp), `${tag}: rematch #${n + 1} HP ${b.maxHp.toFixed(0)} = ${M.BOSSES[e.boss].hp} × ${BOSS_HP_SCALE[w.titan.rank]} × (1 + 0.5·${E.rematches})`);
          const due = n === 0 ? t0 + ENDLESS.bossEveryS : log.bossDeathT[log.bossDeathT.length - 1] + ENDLESS.bossEveryS;
          ok(Math.abs(w.t - due) <= 2 * TICK + 1e-9, `${tag}: rematch #${n + 1} at ${w.t.toFixed(2)} s (due ${due.toFixed(2)} s)`);
        } else if (e.type === 'alert' && e.key === 'boss') alerts.boss++;
        else if (e.type === 'alert' && e.key === 'rematch') alerts.rematch++;
        else if (e.type === 'bossDefeated') { log.bossDeathT.push(w.t); pendingDeath = { chests, pu: 0, ticks: 0 }; }
        else if (e.type === 'eliteSpawn') log.eliteT.push(w.t);
        else if (e.type === 'runEnd' && e.result === 'clear') clearInEndless = true;
        else if (e.type === 'powerupSpawn') { puSpawn++; puAll++; }
      }
      // the reward lands the tick after the death (stepEndless runs before stepBoss)
      if (pendingDeath) {
        pendingDeath.pu += puSpawn;
        const got = chestsBefore(w) >= pendingDeath.chests + 1 || w.upgrades.chestDrafts > 0;
        if (got || ++pendingDeath.ticks > 2) {
          chestChecks++;
          if (got) chestOk++;
          if (pendingDeath.pu > 0) puSeen++;
          pendingDeath = null;
        }
      }
      if (!w.run.result && w.run.phase !== 'endless') phaseOk = false;
      const sc = w.endless ? w.endless.score : -1;
      if (sc < lastScore) monotone = false;
      lastScore = sc;
      if (mAt.has(w.tick)) {
        const m = (w.t - t0) / 60;
        const okM = near(M.endless.endlessBudgetMul(w), Math.min(ENDLESS.budgetMax, 1 + ENDLESS.budgetPerMin * m)) && near(M.endless.endlessHpMul(w), 1 + ENDLESS.hpPerMin * m) && near(M.endless.endlessDmgMul(w), Math.min(ENDLESS.dmgMax, 1 + ENDLESS.dmgPerMin * m));
        mChecks.push(`m=${m.toFixed(2)} ${okM ? 'ok' : 'WRONG'}`);
        ok(okM, `${tag}: in-run multipliers at m = ${m.toFixed(2)}`);
      }
      if (devKillRematches && !w.run.result && w.boss && w.boss.alive && w.boss.introT <= 0) {
        M.bosses.bossUltHit(w, 1, 0);          // outside stepWorld: its bossDefeated event is not in the next scan
        if (!w.boss.alive) { log.bossDeathT.push(w.t); pendingDeath = { chests: chestsBefore(w), pu: 0, ticks: 0 }; }
      }
      if (i % 15 === 0) { const bad = nanCheck(w); if (bad) { nan = bad; break; } }
      if ((i + 1) % (60 * SIM_HZ) === 0) log.hashes.push(hashWorld(w));
      if (verbose && (i + 1) % (60 * SIM_HZ) === 0) {
        const T = w.titan;
        console.log(`  ${tag} +${((w.t - t0) / 60).toFixed(0)} min  Size ${['I', 'II', 'III', 'IV', 'V'][T.rank]} LV ${T.level} hp ${T.hp.toFixed(0)}/${T.maxHp.toFixed(0)} enemies ${w.enemies.filter((e) => e.alive).length} ${w.boss && w.boss.alive ? `boss ${w.boss.id} ${(100 * w.boss.hp / w.boss.maxHp).toFixed(0)}%` : ''} rematches ${E.rematches} score ${E.score}`);
      }
    }
  } catch (e) { threw = String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | '); }
  ok(threw === null, `${tag}: no throw${threw ? ' — ' + threw : ''}`);
  ok(nan === null, `${tag}: no NaN${nan ? ' — ' + nan : ''}`);
  ok(phaseOk, `${tag}: run.phase 'endless' on every endless tick`);
  ok(!clearInEndless, `${tag}: no runEnd clear in endless`);
  ok(monotone, `${tag}: score monotone`);
  ok(alerts.boss === 0 && alerts.rematch === log.rematchT.length, `${tag}: one 'alert rematch' per rematch, no 'alert boss' (rematch ${alerts.rematch}, boss ${alerts.boss}, rematches ${log.rematchT.length})`);
  ok(E.rematches === log.bossDeathT.length, `${tag}: rematches won ${E.rematches} = rematch deaths ${log.bossDeathT.length}`);
  if (chestChecks > 0) ok(chestOk === chestChecks, `${tag}: a chest after every rematch death (${chestOk}/${chestChecks})`);
  if (chestChecks > 0 && puAll > 0) ok(puSeen === chestChecks, `${tag}: a forced power-up after every rematch death (${puSeen}/${chestChecks}; the map sim drops power-ups)`);
  if (log.eliteT.length) {
    ok(Math.abs(log.eliteT[0] - (t0 + 30)) <= 2 * TICK + 1e-9 || log.eliteT[0] > t0 + 30, `${tag}: first RAMROD at +${(log.eliteT[0] - t0).toFixed(2)} s (≥ 30)`);
    let gapOk = true; for (let k = 1; k < log.eliteT.length; k++) if (log.eliteT[k] - log.eliteT[k - 1] < ENDLESS.eliteEveryS - 2 * TICK) gapOk = false;
    ok(gapOk, `${tag}: RAMRODs ≥ ${ENDLESS.eliteEveryS} s apart (${log.eliteT.length} fielded)`);
  } else ok(w.t - t0 < 30 + TICK, `${tag}: a RAMROD 30 s after KEEP GOING`);
  // score formula
  const S = ENDLESS.score;
  const want = Math.floor(S.perSecond * (w.t - t0) + S.perKill * (w.titan.kills - kills0) + S.perRematch * E.rematches + (w.run.tonnage - tons0) * S.perTons);
  ok(w.run.result === 'dead' || E.score === want, `${tag}: score ${E.score} = formula ${want}`);
  // death
  if (!w.run.result) {
    log.forcedDeath = true;
    w.titan.iframeT = 0; w.ult.invulnT = 0;
    M.titansim.hurtTitan(w, 1e9, 'shell', w.titan.x, w.titan.z);
    botStep(w);
  }
  let deadEv = false; for (const e of w.events) if (e.type === 'runEnd' && e.result === 'dead') deadEv = true;
  ok(w.run.result === 'dead' && w.run.phase === 'dead' && deadEv && w.endless !== null, `${tag}: death ends the run (result ${w.run.result}, runEnd dead ${deadEv}, endless kept ${w.endless !== null})${log.forcedDeath ? ' [forced at the end of the window]' : ''}`);
  const tk = w.tick; M.world.stepWorld(w, NO_INPUT);
  ok(w.tick === tk, `${tag}: stepWorld after the death is a no-op`);
  log.endT = w.t; log.result = w.run.result; log.rematchesWon = E.rematches; log.score = E.score; log.finalHash = hashWorld(w);
  console.log(`  ${tag}: KEEP GOING @${t0.toFixed(0)} s → ${log.forcedDeath ? 'alive at the window end (forced death)' : 'died'} @${w.t.toFixed(0)} s (+${((w.t - t0) / 60).toFixed(1)} min) · rematches fielded ${log.rematchT.length} [${log.rematchIds.join(', ')}] at +${log.rematchT.map((t) => (t - t0).toFixed(0)).join('/')} s · won ${E.rematches} · RAMRODs ${log.eliteT.length} · chests ${chestOk}/${chestChecks} · forced power-ups seen ${puSeen}/${chestChecks} · score ${E.score}`);
  if (hpChecks.length) console.log(`    rematch HP (got/want): ${hpChecks.join(' · ')}`);
  if (mChecks.length) console.log(`    in-run multiplier samples: ${mChecks.join(' · ')}`);
  return log;
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  const err = await load();
  if (err) { console.log('probe_endless: FAIL — could not load the sim:'); for (const l of err.split(/\r?\n/).slice(0, 8)) console.log('  ' + l); return 2; }
  if (!(TITAN_IDS as readonly string[]).includes(TITAN) || !(BIOME_IDS as readonly string[]).includes(BIOME)) { console.log('unknown --titan / --biome'); return 2; }
  console.log(`BLOCKTOOTH probe_endless — ${TITAN}/${BIOME}, seed ${SEED}, ${MINUTES} sim-min of EXTENDED COVERAGE`);
  const wall0 = performance.now();
  try { checkMultipliers(); } catch (e) { ok(false, `multipliers threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`); }

  console.log(`\nA. gate bot, ${MINUTES} min of EXTENDED COVERAGE (no god)`);
  const a1 = scenarioA(TITAN, BIOME, MINUTES, true, false);
  console.log('\n8. determinism (scenario A again)');
  const a2 = scenarioA(TITAN, BIOME, MINUTES, false, false);
  const same = a1.hashes.length === a2.hashes.length && a1.hashes.every((h, k) => h === a2.hashes[k]) && a1.finalHash === a2.finalHash;
  ok(same, `determinism: ${a1.hashes.length} checkpoints + final ${a1.finalHash} / ${a2.finalHash}`);

  console.log('\nB. rematch bookkeeping (every rematch dev-killed after its intro), per city');
  for (const bi of BIOME_IDS) scenarioA(TITAN, bi, MINUTES, false, true);

  console.log(`\n${checks} checks · ${fails.length} failed · ${((performance.now() - wall0) / 1000).toFixed(1)} s wall`);
  if (fails.length) {
    console.log('probe_endless: FAIL');
    for (const f of fails.slice(0, 40)) console.log('  - ' + f);
    return 1;
  }
  console.log('probe_endless: PASS');
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
