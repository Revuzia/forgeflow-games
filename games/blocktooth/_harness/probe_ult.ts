// BLOCKTOOTH v2 — UPROAR probe (FEATURES_V2 §3, §15.3; lane L1). Node, THREE-free.
//
//   node _harness/probe_ult.ts                 # everything (unit checks + 12 full bot runs, ~1–2 min)
//   node _harness/probe_ult.ts --quick         # unit checks only (no full runs)
//   node _harness/probe_ult.ts --seed 7
//
// Asserts (exit 1 on any failure, 2 if the sim cannot load):
//   A. the R table printed from the merged config (first/last level of each Size) and R = max(3 H, 0.95 × spawnRing)
//   B. ≥ 90 % of the non-elite foes inside 0.9 R killed by one UPROAR at Size I and Size V, all 4 titans
//      (damage stat 1, foes spawned at the band's latest time: HP × (1 + 0.18·min) × rank mul)
//   C. roar invulnerability: 0 damage of any kind (a hostile dot hazard + an ACTIVE enemy telegraph on the titan
//      + direct discrete and dot hurtTitan calls) for the whole roar, damage resumes after it; the 30 % move from
//      the fire tick (standing start, move held); a WINCH / TOW leash snaps on the fire tick
//   D. at roar end: hostile NON-boss projectiles and UNFIRED enemy-owned telegraphs inside R deleted (a lob's own
//      telegraph too); outside R and boss-owned ones untouched (counts before/after)
//   E. boss −6 % of max HP exactly and meter +0.30 exactly per fire (3 bosses × 4 titans); nothing during the intro
//   F. per-fire XP ≤ the cap (ULT.xpCapLevelFrac × the level's XP need at fire), unit and in full runs
//   G. ≤ ULT.bankPickupsPerTick scrap pickups spawned per tick at a Size V fire (250 foes in view)
//   H. full runs (fire-on-ready bot, 4 titans × 3 biomes): median gap between ultCharged edges in ULT_GAP_BAND_S
//      per rank band; time to first readiness (reported; tuning target 45–75 s); median boss-fight length
//      70–170 s with UPROAR in use, per boss id (clears only)
//   I. determinism: the same seed run twice ⇒ identical UPROAR + titan digests at every 30 s checkpoint
//   J. (critic F2-a) BACK PAY respects the lockout: collected mid-roar, mid-blast and mid-lockout it BANKS the
//      charge (full meter, not ready, no ultCharged) and UPROAR cannot fire again until ULT.lockoutS after the
//      fire (ultimate held every tick); the ready edge lands on the tick the lockout ends; with a boss in reach and
//      BACK PAY re-dropped through every lockout, 14 s hold exactly 3 fires ≥ 6 s apart and 3 × 6 % of the boss
//   K. (critic F2-b) boss-framed coverage: a boss whose body centre is ON SCREEN in the settled boss framing
//      (config bossFrameNeed → the director's framing state; projected through the default-zoom camera by this
//      probe's own math) is hit by one UPROAR — exactly −6 % / +0.30 — at Size III / IV / V, 3 bosses, 16
//      headings × 8 distances; no boss → R is exactly the spec formula; and in the full runs every fire with an
//      on-screen boss has its body centre inside R + part r
//   L. (critic F2-c) a fire on a tick that ends with a draft granted that tick (a level-up) is taken back: no ultFire
//      left in the tick's events, phase idle, meter full + READY, no lockout; after the draft the next press fires.
//      The fire STANDS when the tick also ranks up (game.ts plays on through the MASS BREACH sting) or a draft was
//      already owed at the press (the app running on). Full runs: no tick ends with an ultFire and a freezing
//      draft; level-ups mid-UPROAR are reported

import type { BiomeId, BossId, EnemyKind, RankIndex, SimEvent, TitanId, TitanInput, World } from '../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../src/core/types.ts';
import { RANK_LEVELS, RANK_V_GROWTH_LEVELS, TITAN_RADIUS_PER_H, ULT, ULT_GAP_BAND_S, titanHeightAt, xpToNext } from '../src/core/config.ts';

type WorldMod = typeof import('../src/core/world.ts');
let M: {
  createWorld: WorldMod['createWorld']; stepWorld: WorldMod['stepWorld']; NO_INPUT: TitanInput;
  stepUltimate: typeof import('../src/meta/ultimate.ts')['stepUltimate'];
  addUproar: typeof import('../src/meta/ultimate.ts')['addUproar'];
  ultRadius: typeof import('../src/meta/ultimate.ts')['ultRadius'];
  ultMoveMul: typeof import('../src/meta/ultimate.ts')['ultMoveMul'];
  spawnRing: typeof import('../src/ai/director.ts')['spawnRing'];
  rebuildEnemyGrid: typeof import('../src/combat/spatial.ts')['rebuildEnemyGrid'];
  spawnEnemy: typeof import('../src/ai/enemies.ts')['spawnEnemy'];
  growToRank: typeof import('../src/titans/titansim.ts')['growToRank'];
  hurtTitan: typeof import('../src/titans/titansim.ts')['hurtTitan'];
  titanMaxSpeed: typeof import('../src/titans/titansim.ts')['titanMaxSpeed'];
  spawnProjectile: typeof import('../src/combat/projectiles.ts')['spawnProjectile'];
  spawnTelegraph: typeof import('../src/combat/telegraphs.ts')['spawnTelegraph'];
  spawnHazard: typeof import('../src/combat/hazards.ts')['spawnHazard'];
  spawnBoss: typeof import('../src/ai/bosses/index.ts')['spawnBoss'];
  refreshParts: typeof import('../src/ai/bosses/index.ts')['refreshParts'];
  ENEMIES: typeof import('../src/data/enemies.ts')['ENEMIES'];
  ULTS: typeof import('../src/data/ultimates.ts')['ULTS'];
  BIOMES: typeof import('../src/data/biomes.ts')['BIOMES'];
  hasPendingDraft: typeof import('../src/upgrades/draft.ts')['hasPendingDraft'];
  pickUpgrade: typeof import('../src/upgrades/draft.ts')['pickUpgrade'];
  rollOffer: typeof import('../src/upgrades/draft.ts')['rollOffer'];
  botInput: typeof import('./bot.ts')['botInput'];
  botPickUpgrade: typeof import('./bot.ts')['botPickUpgrade'];
  spawnPowerup: typeof import('../src/meta/powerups.ts')['spawnPowerup'];
  spawnPickup: typeof import('../src/combat/pickups.ts')['spawnPickup'];
  cfg: typeof import('../src/core/config.ts');
};

async function load(): Promise<string | null> {
  try {
    const wm = await import('../src/core/world.ts');
    const um = await import('../src/meta/ultimate.ts');
    const dm = await import('../src/ai/director.ts');
    const sp = await import('../src/combat/spatial.ts');
    const em = await import('../src/ai/enemies.ts');
    const tm = await import('../src/titans/titansim.ts');
    const pm = await import('../src/combat/projectiles.ts');
    const tg = await import('../src/combat/telegraphs.ts');
    const hz = await import('../src/combat/hazards.ts');
    const bm = await import('../src/ai/bosses/index.ts');
    const de = await import('../src/data/enemies.ts');
    const du = await import('../src/data/ultimates.ts');
    const db = await import('../src/data/biomes.ts');
    const dr = await import('../src/upgrades/draft.ts');
    const bot = await import('./bot.ts');
    M = {
      createWorld: wm.createWorld, stepWorld: wm.stepWorld, NO_INPUT: wm.NO_INPUT,
      stepUltimate: um.stepUltimate, addUproar: um.addUproar, ultRadius: um.ultRadius, ultMoveMul: um.ultMoveMul,
      spawnRing: dm.spawnRing, rebuildEnemyGrid: sp.rebuildEnemyGrid, spawnEnemy: em.spawnEnemy,
      growToRank: tm.growToRank, hurtTitan: tm.hurtTitan, titanMaxSpeed: tm.titanMaxSpeed,
      spawnProjectile: pm.spawnProjectile, spawnTelegraph: tg.spawnTelegraph, spawnHazard: hz.spawnHazard,
      spawnBoss: bm.spawnBoss, refreshParts: bm.refreshParts,
      ENEMIES: de.ENEMIES, ULTS: du.ULTS, BIOMES: db.BIOMES,
      hasPendingDraft: dr.hasPendingDraft, pickUpgrade: dr.pickUpgrade, rollOffer: dr.rollOffer,
      botInput: bot.botInput, botPickUpgrade: bot.botPickUpgrade,
      spawnPowerup: (await import('../src/meta/powerups.ts')).spawnPowerup,
      spawnPickup: (await import('../src/combat/pickups.ts')).spawnPickup,
      cfg: await import('../src/core/config.ts'),
    };
    return null;
  } catch (e) { return (e as Error)?.stack ?? String(e); }
}

// ─────────────────────────────── helpers ───────────────────────────────
const fails: string[] = [];
function check(ok: boolean, what: string): boolean {
  if (!ok) fails.push(what);
  return ok;
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** deterministic local LCG (probe placement only; never touches world.rng) */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function input(p: Partial<TitanInput> = {}): TitanInput { return { ...M.NO_INPUT, ...p }; }

/** A world with the titan grown to (rank, level), height settled, nothing fielded. */
function worldAt(titan: TitanId, rank: RankIndex, level: number, biome: BiomeId = 'grideast', seed = 1337): World {
  const w = M.createWorld({ titan, biome, seed });
  w.cheats.noSpawns = true;
  if (rank > 0 || level > 1) M.growToRank(w, rank, level);
  const T = w.titan;
  T.growT = 0;
  T.height = titanHeightAt(T.rank, T.level);
  T.radius = T.height * TITAN_RADIUS_PER_H;
  w.upgrades.pendingDrafts = 0;
  return w;
}

/** Isolated UPROAR: charge to full, press, then step ONLY the ult (+ the grid) until it is idle again.
 *  Returns the per-tick counts of NEW scrap pickups. Enemies/boss stand still (no AI step). */
function isolatedFire(w: World): { scrapPerTick: number[]; ticks: number } {
  const u = w.ult;
  M.addUproar(w, ULT.max, true);
  const perTick: number[] = [];
  let maxId = w.nextId;
  let ticks = 0;
  for (let i = 0; i < 400; i++) {
    w.events.length = 0;
    w.input = input({ ultimate: i === 0 });
    M.rebuildEnemyGrid(w);
    M.stepUltimate(w);
    let n = 0;
    for (const p of w.pickups) if (p.id >= maxId && p.kind === 'scrap') n++;
    maxId = w.nextId;
    perTick.push(n);
    ticks++;
    if (i > 0 && u.phase === 'idle') break;
  }
  // one more tick flushes anything banked on the last tick
  w.events.length = 0; w.input = input(); M.rebuildEnemyGrid(w); M.stepUltimate(w);
  let n = 0; for (const p of w.pickups) if (p.id >= maxId && p.kind === 'scrap') n++;
  perTick.push(n);
  return { scrapPerTick: perTick, ticks };
}

// ─────────────────────────────── A. R table ───────────────────────────────
function partA(): void {
  console.log('\n── A. blast radius R from the merged config (auto framing, zoom 1) ──');
  console.log('Size | first level: LV  H → R (R/H)          | last level: LV  H → R (R/H)');
  for (let r = 0 as RankIndex; r <= 4; r = (r + 1) as RankIndex) {
    const first = RANK_LEVELS[r];
    const last = r < 4 ? RANK_LEVELS[r + 1] - 1 : RANK_LEVELS[4] + RANK_V_GROWTH_LEVELS;
    const cells: string[] = [];
    for (const lv of [first, last]) {
      const w = worldAt('molo', r, lv);
      const H = w.titan.height;
      const R = M.ultRadius(w);
      const want = Math.max(ULT.rFloorH * H, ULT.rFrac * M.spawnRing(w));   // no boss: the spec formula exactly
      check(Math.abs(R - want) < 1e-9, `A: R formula at Size ${ROMAN[r]} LV ${lv}: ${R} vs ${want}`);
      check(R >= ULT.rFloorH * H - 1e-9, `A: R < 3 H at Size ${ROMAN[r]} LV ${lv}`);
      cells.push(`LV ${String(lv).padStart(2)} ${H.toFixed(2).padStart(6)} m → ${R.toFixed(1).padStart(6)} m (${(R / H).toFixed(1).padStart(4)} H)`);
    }
    console.log(`  ${ROMAN[r].padEnd(3)}| ${cells[0]}  | ${cells[1]}`);
  }
}

// ─────────────────────────────── B + F + G. kill share, XP cap, bank spike ───────────────────────────────
function killTest(titan: TitanId, rank: RankIndex, n: number, tMin: number): { frac: number; inside: number; killed: number; xp: number; cap: number; maxScrap: number } {
  const lv = RANK_LEVELS[rank];
  const w = worldAt(titan, rank, lv);
  w.t = tMin;                                  // foe HP scales with elapsed minutes at spawn
  const T = w.titan;
  const R = M.ultRadius(w);
  const kinds = (Object.keys(M.ENEMIES) as EnemyKind[]).filter((k) => {
    const d = M.ENEMIES[k];
    return k !== 'elite' && d.cost > 0 && d.minRank <= rank;
  });
  const rnd = lcg(0xC0FFEE + rank * 97 + titan.length);
  for (let i = 0; i < n; i++) {
    const k = kinds[i % kinds.length];
    const rr = 0.9 * R * Math.sqrt(0.02 + 0.98 * rnd());
    const a = rnd() * Math.PI * 2;
    M.spawnEnemy(w, k, T.x + Math.sin(a) * rr, T.z + Math.cos(a) * rr);
  }
  const inside = new Set<number>();
  for (const e of w.enemies) if (e.alive && !e.elite && Math.hypot(e.x - T.x, e.z - T.z) <= 0.9 * R) inside.add(e.id);
  const cap = ULT.xpCapLevelFrac * T.xpToNext;
  const xp0 = w.ult.xpTotal;
  const r = isolatedFire(w);
  let killed = 0;
  for (const e of w.enemies) if (inside.has(e.id) && !e.alive) killed++;
  return { frac: inside.size ? killed / inside.size : 0, inside: inside.size, killed, xp: w.ult.xpTotal - xp0, cap, maxScrap: Math.max(...r.scrapPerTick) };
}

function partB(): void {
  console.log('\n── B/F/G. one UPROAR vs a field of foes inside 0.9 R (damage stat 1) ──');
  for (const titan of TITAN_IDS) {
    for (const [rank, tMin, n] of [[0, 150, 60], [4, 540, 250]] as [RankIndex, number, number][]) {
      const k = killTest(titan, rank, n, tMin);
      const ok = check(k.frac >= 0.9 && k.inside >= 20, `B: ${titan} Size ${ROMAN[rank]}: killed ${k.killed}/${k.inside} (${(100 * k.frac).toFixed(1)} %) of the non-elite foes inside 0.9 R (need ≥ 90 %, ≥ 20 foes)`);
      const okXp = check(k.xp <= k.cap + 1e-6, `F: ${titan} Size ${ROMAN[rank]}: banked ${k.xp.toFixed(2)} XP > cap ${k.cap.toFixed(2)}`);
      const okSp = check(k.maxScrap <= ULT.bankPickupsPerTick, `G: ${titan} Size ${ROMAN[rank]}: ${k.maxScrap} scrap pickups spawned in one tick (cap ${ULT.bankPickupsPerTick})`);
      console.log(`  ${titan.padEnd(10)} Size ${ROMAN[rank].padEnd(2)} t=${tMin}s: killed ${String(k.killed).padStart(3)}/${String(k.inside).padStart(3)} = ${(100 * k.frac).toFixed(1).padStart(5)} %  ${ok ? 'ok' : 'FAIL'} · XP banked ${k.xp.toFixed(1)} ≤ cap ${k.cap.toFixed(1)} ${okXp ? 'ok' : 'FAIL'} · max scrap/tick ${k.maxScrap} ${okSp ? 'ok' : 'FAIL'}`);
    }
  }
}

// ─────────────────────────────── C. roar: invulnerability, 30 % move, leash snap ───────────────────────────────
function partC(): void {
  console.log('\n── C. ROAR: invulnerability (dot + active telegraph + direct hits), 30 % move, leash snap ──');
  for (const titan of TITAN_IDS) {
    const roarS = M.ULTS[titan].roarS;
    const roarTicks = Math.round(roarS * 30);
    // (1) damage of every kind is zero for the whole roar
    {
      const w = worldAt(titan, 1, RANK_LEVELS[1]);
      const T = w.titan;
      for (let i = 0; i < 10; i++) M.stepWorld(w, input());
      M.spawnHazard(w, { owner: 'enemy', kind: 'fire', shape: { k: 'circle', x: T.x, z: T.z, r: 3 * T.height }, life: 60, dps: 0.02 * T.maxHp });
      M.spawnTelegraph(w, { owner: 'enemy', style: 'circle', shape: { k: 'circle', x: T.x, z: T.z, r: 3 * T.height }, windup: 0.05, active: 30, dmg: 0.01 * T.maxHp, kind: 'breath' });
      for (let i = 0; i < 12; i++) M.stepWorld(w, input());
      const pre = T.damageTaken;
      check(pre > 0, `C: ${titan}: the hostile dot/telegraph did no damage BEFORE the fire (test is vacuous)`);
      M.addUproar(w, ULT.max, true);
      const hp0 = T.damageTaken;
      let direct = 0;
      let tickDmg = 0;
      for (let i = 0; i < roarTicks; i++) {
        M.stepWorld(w, input({ ultimate: i === 0 }));
        if (i === 0) check(w.ult.phase === 'roar', `C: ${titan}: fire tick did not start the roar (phase ${w.ult.phase})`);
        T.iframeT = 0;
        if (w.ult.phase === 'roar') {
          direct += M.hurtTitan(w, 0.05 * T.maxHp, 'bullet', T.x, T.z, false);
          direct += M.hurtTitan(w, 0.05 * T.maxHp, 'magma', T.x, T.z, true);
        }
      }
      tickDmg = T.damageTaken - hp0;
      const phaseAfter = w.ult.phase;
      for (let i = 0; i < 20; i++) M.stepWorld(w, input());
      const after = T.damageTaken - hp0;
      const ok = check(tickDmg === 0 && direct === 0, `C: ${titan}: took ${tickDmg.toFixed(3)} (ticks) + ${direct.toFixed(3)} (direct) damage during the ${roarS}s roar`);
      check(after > 0, `C: ${titan}: no damage after the roar ended (phase ${phaseAfter}) — invulnerability leaked past the roar`);
      console.log(`  ${titan.padEnd(10)} roar ${roarS}s (${roarTicks} ticks): damage during roar ${tickDmg.toFixed(3)} + direct ${direct.toFixed(3)} ${ok ? 'ok' : 'FAIL'} · after roar ${after.toFixed(1)} (>0 ok)`);
    }
    // (2) 30 % move from the fire tick (standing start, move held) + (3) leash snap
    {
      const w = worldAt(titan, 0, 1);
      const T = w.titan;
      for (let i = 0; i < 5; i++) M.stepWorld(w, input());
      M.addUproar(w, ULT.max, true);
      T.leash = { t: 5, lx: T.x + 10, lz: T.z, strength: 2 };
      let maxFrac = 0, mulOk = true;
      for (let i = 0; i < roarTicks; i++) {
        M.stepWorld(w, input({ mx: 1, mz: 0, ultimate: i === 0 }));
        if (i === 0) {
          check(T.leash === null, `C: ${titan}: the leash did not snap on the fire tick`);
          check(w.events.some((e) => e.type === 'leash' && !e.on), `C: ${titan}: no 'leash off' event on the fire tick`);
          check(w.events.some((e) => e.type === 'ultFire'), `C: ${titan}: no ultFire event on the fire tick`);
        }
        if (w.ult.phase === 'roar' && M.ultMoveMul(w) !== ULT.roarMove) mulOk = false;
        const f = T.speed / Math.max(1e-6, M.titanMaxSpeed(w));
        if (f > maxFrac) maxFrac = f;
      }
      const ok = check(maxFrac <= ULT.roarMove + 1e-6 && mulOk, `C: ${titan}: speed reached ${(100 * maxFrac).toFixed(1)} % of max during the roar (cap ${100 * ULT.roarMove} %)`);
      console.log(`  ${titan.padEnd(10)} move during roar ≤ ${(100 * maxFrac).toFixed(1)} % of max ${ok ? 'ok' : 'FAIL'} · leash snapped ${T.leash === null ? 'ok' : 'FAIL'}`);
    }
  }
}

// ─────────────────────────────── D. projectile / telegraph clear at roar end ───────────────────────────────
function partD(): void {
  console.log('\n── D. roar end: hostile non-boss projectiles + unfired enemy telegraphs inside R deleted ──');
  for (const titan of TITAN_IDS) {
    const w = worldAt(titan, 0, 1);
    const T = w.titan;
    for (let i = 0; i < 5; i++) M.stepWorld(w, input());
    const R = M.ultRadius(w);
    const at = (f: number, a: number) => ({ x: T.x + Math.sin(a) * f * R, z: T.z + Math.cos(a) * f * R });
    const mk = { inE: [] as number[], outE: [] as number[], inB: [] as number[], tInE: [] as number[], tOutE: [] as number[], tInB: [] as number[], lobTg: -1 };
    for (let i = 0; i < 5; i++) { const p = at(0.35 + 0.1 * i, i * 1.3); mk.inE.push(M.spawnProjectile(w, { owner: 'enemy', kind: 'pellet', x: p.x, z: p.z, vx: 0, vz: 0, dmg: 1, life: 30 }).id); }
    for (let i = 0; i < 3; i++) { const p = at(1.3 + 0.1 * i, i * 2.1); mk.outE.push(M.spawnProjectile(w, { owner: 'enemy', kind: 'pellet', x: p.x, z: p.z, vx: 0, vz: 0, dmg: 1, life: 30 }).id); }
    for (let i = 0; i < 2; i++) { const p = at(0.5, 0.7 + i * 3); mk.inB.push(M.spawnProjectile(w, { owner: 'boss', kind: 'plate', x: p.x, z: p.z, vx: 0, vz: 0, dmg: 1, life: 30 }).id); }
    { const p = at(0.6, 4.0); const lob = M.spawnProjectile(w, { owner: 'enemy', kind: 'mortar', x: p.x, z: p.z, vx: 0, vz: 0, dmg: 1, life: 30, lob: true, tx: p.x, tz: p.z, aoe: 2 }); mk.inE.push(lob.id); mk.lobTg = lob.tg; }
    for (let i = 0; i < 4; i++) { const p = at(0.4 + 0.1 * i, 0.4 + i); mk.tInE.push(M.spawnTelegraph(w, { owner: 'enemy', style: 'circle', shape: { k: 'circle', x: p.x, z: p.z, r: 1 }, windup: 30, dmg: 1, kind: 'shell' }).id); }
    for (let i = 0; i < 2; i++) { const p = at(1.4, 2 + i); mk.tOutE.push(M.spawnTelegraph(w, { owner: 'enemy', style: 'circle', shape: { k: 'circle', x: p.x, z: p.z, r: 1 }, windup: 30, dmg: 1, kind: 'shell' }).id); }
    for (let i = 0; i < 2; i++) { const p = at(0.5, 5 + i); mk.tInB.push(M.spawnTelegraph(w, { owner: 'boss', style: 'circle', shape: { k: 'circle', x: p.x, z: p.z, r: 1 }, windup: 30, dmg: 1, kind: 'slam' }).id); }
    const aliveP = (ids: number[]) => ids.filter((id) => w.projectiles.some((p) => p.id === id && p.alive)).length;
    const aliveT = (ids: number[]) => ids.filter((id) => w.telegraphs.some((t) => t.id === id && t.alive)).length;
    const snap = () => [aliveP(mk.inE), aliveP(mk.outE), aliveP(mk.inB), aliveT(mk.tInE), aliveT(mk.tOutE), aliveT(mk.tInB), mk.lobTg >= 0 ? aliveT([mk.lobTg]) : -1];
    M.addUproar(w, ULT.max, true);
    let before: number[] = [];
    let after: number[] = [];
    for (let i = 0; i < 60; i++) {
      const was = w.ult.phase;
      if (was === 'roar' || i === 0) before = snap();
      M.stepWorld(w, input({ ultimate: i === 0 }));
      if (was === 'roar' && w.ult.phase !== 'roar') { after = snap(); break; }
    }
    const ok = check(after.length > 0 && after[0] === 0 && after[1] === before[1] && after[2] === before[2] && after[3] === 0 && after[4] === before[4] && after[5] === before[5] && after[6] <= 0,
      `D: ${titan}: before [enemyIn, enemyOut, bossIn, tgEnemyIn, tgEnemyOut, tgBossIn, lobTg] = [${before}] → after [${after}] (want [0, ${before[1]}, ${before[2]}, 0, ${before[4]}, ${before[5]}, ≤0])`);
    console.log(`  ${titan.padEnd(10)} R ${R.toFixed(1)} m: [projE in, out, projB in, tgE in, out, tgB in, lobTg] ${JSON.stringify(before)} → ${JSON.stringify(after)} ${ok ? 'ok' : 'FAIL'}`);
  }
}

// ─────────────────────────────── E. boss: −6 % exactly, meter +0.30 exactly, nothing in the intro ───────────────────────────────
function partE(): void {
  console.log('\n── E. boss per fire: −' + (100 * ULT.bossCapFrac) + ' % max HP and meter +' + ULT.bossMeter + ' exactly (body-only) ──');
  const bosses: BossId[] = ['caisson4', 'irongully', 'parkade6'];
  for (const id of bosses) {
    const row: string[] = [];
    for (const titan of TITAN_IDS) {
      try {
        for (const intro of [false, true]) {
          const w = worldAt(titan, 2, RANK_LEVELS[2], id === 'irongully' ? 'whitestacks' : 'grideast');
          const T = w.titan;
          M.spawnBoss(w, id);
          const b = w.boss!;
          const R = M.ultRadius(w);
          b.x = T.x + 0.3 * R; b.z = T.z; b.introT = intro ? 3 : 0; b.meter = 0; b.staggerT = 0;
          M.refreshParts(b);
          const hp0 = b.hp;
          isolatedFire(w);
          const lost = (hp0 - b.hp) / b.maxHp;
          if (intro) {
            check(lost === 0 && b.meter === 0, `E: ${titan} vs ${id} (intro): boss lost ${(100 * lost).toFixed(3)} % / meter ${b.meter} during the intro (want 0 / 0)`);
          } else {
            const ok = check(Math.abs(lost - ULT.bossCapFrac) < 1e-9 && Math.abs(b.meter - ULT.bossMeter) < 1e-9,
              `E: ${titan} vs ${id}: boss lost ${(100 * lost).toFixed(6)} % (want ${100 * ULT.bossCapFrac}), meter ${b.meter} (want ${ULT.bossMeter})`);
            row.push(`${titan} ${(100 * lost).toFixed(2)}%/${b.meter.toFixed(2)} ${ok ? 'ok' : 'FAIL'}`);
          }
        }
      } catch (e) {
        check(false, `E: ${titan} vs ${id}: threw ${(e as Error)?.message ?? e}`);
        row.push(`${titan} THREW`);
      }
    }
    console.log(`  ${id.padEnd(10)} ${row.join(' · ')} · intro: 0 %/0 checked`);
  }
}

// ─────────────────────────────── H + F + I. full bot runs ───────────────────────────────
interface Run {
  titan: TitanId; biome: BiomeId; result: string; endT: number;
  edges: { t: number; rank: number }[]; fires: number; firstReady: number;
  bossId: string | null; bossT: number; fight: number;
  capViol: string[]; unbanked: number; midKills: number;
  digests: string[];
  bossFires: number; bossOnScreen: number; bossOnScreenMiss: string[];
  unfired: number; fireWithDraft: number; fireRankTick: number; lvlMidUlt: number;
}

function digest(w: World): string {
  const u = w.ult, T = w.titan;
  return [w.tick, u.charge.toFixed(6), u.phase, u.fired, u.kills, u.killsBest, u.xpTotal.toFixed(6), u.lockT.toFixed(6),
    T.x.toFixed(6), T.z.toFixed(6), T.hp.toFixed(6), T.level, T.xp.toFixed(6), w.enemies.filter((e) => e.alive).length, w.nextId].join('|');
}

function fullRun(titan: TitanId, biome: BiomeId, seed: number, maxS: number): Run {
  const w = M.createWorld({ titan, biome, seed });
  const r: Run = { titan, biome, result: 'timeout', endT: 0, edges: [], fires: 0, firstReady: NaN, bossId: null, bossT: NaN, fight: NaN, capViol: [], unbanked: 0, midKills: 0, digests: [],
    bossFires: 0, bossOnScreen: 0, bossOnScreenMiss: [], unfired: 0, fireWithDraft: 0, fireRankTick: 0, lvlMidUlt: 0 };
  let fireXp0 = 0, fireCap = 0, inFire = false;
  const maxTicks = Math.round(maxS * 30);
  for (let i = 0; i < maxTicks && !w.run.result; i++) {
    let guard = 0;
    while (M.hasPendingDraft(w) && guard++ < 200) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : M.rollOffer(w, chest);
      if (!offer || offer.length === 0) break;
      M.pickUpgrade(w, M.botPickUpgrade(w, offer));
    }
    const phase0 = w.ult.phase;
    const xpBefore = w.ult.xpTotal;
    const kills0 = w.ult.kills;
    const ready0 = w.ult.ready;
    const inp = M.botInput(w);
    M.stepWorld(w, inp);
    const evs: readonly SimEvent[] = w.events;
    // L: a press on READY that left the ult idle + READY with no ultFire and a draft owed = a fire taken back
    const firedNow = evs.some((e) => e.type === 'ultFire');
    const owed = M.hasPendingDraft(w);
    const rankTick = evs.some((e) => e.type === 'rankUp');
    if (inp.ultimate && ready0 && phase0 === 'idle' && !firedNow && w.ult.ready && w.ult.phase === 'idle' && owed) r.unfired++;
    // the bot resolves every draft before it steps, so a draft owed here was granted THIS tick: it freezes the app
    // on this tick unless the tick also ranked up (game.ts plays on through the MASS BREACH sting)
    if (firedNow && owed && !rankTick) r.fireWithDraft++;
    if (firedNow && owed && rankTick) r.fireRankTick++;
    if (phase0 !== 'idle' && evs.some((e) => e.type === 'levelUp')) r.lvlMidUlt++;
    // K (full runs): every fire with a live, entered boss whose body centre is on screen reaches it
    if (firedNow && w.boss && w.boss.alive && w.boss.introT <= 0 && w.boss.parts.length > 0) {
      r.bossFires++;
      const bp = w.boss.parts[0];
      if (onScreenNdc(w, bp.x, bp.z) <= 1) {
        r.bossOnScreen++;
        const d = Math.hypot(bp.x - w.ult.x, bp.z - w.ult.z);
        if (d > w.ult.r + bp.r + 1e-6) r.bossOnScreenMiss.push(`@${w.t.toFixed(1)}s boss ${d.toFixed(0)} m > R ${w.ult.r.toFixed(0)} + ${bp.r.toFixed(0)}`);
      }
    }
    for (const e of evs) {
      if (e.type === 'ultCharged') { r.edges.push({ t: w.t, rank: w.titan.rank }); if (Number.isNaN(r.firstReady)) r.firstReady = w.t; }
      else if (e.type === 'ultFire') {
        r.fires++; inFire = true; fireXp0 = xpBefore;
        fireCap = w.ult.xpCap + (w.ult.xpTotal - xpBefore);   // the cap latched at fire
      } else if (e.type === 'ultEnd') {
        const got = w.ult.xpTotal - fireXp0;
        if (inFire && got > fireCap + 1e-6) r.capViol.push(`fire #${r.fires} @${w.t.toFixed(1)}s banked ${got.toFixed(2)} > cap ${fireCap.toFixed(2)}`);
        inFire = false;
      } else if (e.type === 'bossSpawn') { if (Number.isNaN(r.bossT)) { r.bossT = w.t; r.bossId = e.boss; } }
    }
    // G (full runs): every kill of a tick spent wholly inside an UPROAR goes through the bank (so the only
    // scrap it spawns is the ≤ bankPickupsPerTick merged flush); DEMOLITION ticks bank by bankOpen instead
    if (phase0 !== 'idle' && w.ult.phase !== 'idle' && !evs.some((e) => e.type === 'powerup' && e.kind === 'demolition')) {
      let k = 0; for (const e of evs) if (e.type === 'enemyKilled') k++;
      r.midKills += k;
      r.unbanked += Math.max(0, k - (w.ult.kills - kills0));
    }
    if ((i + 1) % 900 === 0) r.digests.push(digest(w));
  }
  r.result = w.run.result ?? 'timeout';
  r.endT = w.run.result ? w.run.endT : w.t;
  if (r.result === 'clear' && !Number.isNaN(r.bossT)) r.fight = r.endT - r.bossT;
  r.digests.push(digest(w));
  return r;
}

function partH(seed: number): void {
  console.log(`\n── H. full runs (fire-on-ready bot, seed ${seed}, fresh meta): cadence, first readiness, boss fights, XP cap ──`);
  const runs: Run[] = [];
  const t0 = Date.now();
  for (const titan of TITAN_IDS) for (const biome of BIOME_IDS) {
    const r = fullRun(titan, biome, seed, 13 * 60);
    runs.push(r);
    const gaps: string[] = [];
    for (let i = 1; i < r.edges.length; i++) gaps.push((r.edges[i].t - r.edges[i - 1].t).toFixed(0));
    console.log(`  ${titan.padEnd(10)} ${biome.padEnd(12)} ${r.result.padEnd(7)} @${r.endT.toFixed(0).padStart(4)}s · fires ${String(r.fires).padStart(2)} · first ready ${r.firstReady.toFixed(0)}s · boss ${r.bossId ?? '—'} fight ${Number.isNaN(r.fight) ? '—' : r.fight.toFixed(0) + 's'} · gaps ${gaps.join(',')}`);
    for (const v of r.capViol) check(false, `F: ${titan}/${biome}: ${v}`);
    check(r.unbanked === 0, `G: ${titan}/${biome}: ${r.unbanked} of ${r.midKills} kills during an UPROAR dropped their own scrap instead of banking`);
  }
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)} s wall)`);
  // cadence per rank band (the rank at the later edge)
  const byRank: number[][] = [[], [], [], [], []];
  for (const r of runs) for (let i = 1; i < r.edges.length; i++) byRank[r.edges[i].rank].push(r.edges[i].t - r.edges[i - 1].t);
  const line: string[] = [];
  for (let k = 0; k < 5; k++) {
    const m = median(byRank[k]);
    line.push(`${ROMAN[k]} ${Number.isNaN(m) ? '—' : m.toFixed(1)} s (n ${byRank[k].length})`);
    if (byRank[k].length >= 3) check(m >= ULT_GAP_BAND_S[0] && m <= ULT_GAP_BAND_S[1], `H: median gap between UPROAR ready edges at Size ${ROMAN[k]} = ${m.toFixed(1)} s (band ${ULT_GAP_BAND_S[0]}–${ULT_GAP_BAND_S[1]} s)`);
  }
  console.log(`  cadence (median gap between ultCharged edges, by Size): ${line.join(' · ')}  [band ${ULT_GAP_BAND_S[0]}–${ULT_GAP_BAND_S[1]} s]`);
  const fr = runs.map((r) => r.firstReady).filter((x) => !Number.isNaN(x));
  const frM = median(fr);
  console.log(`  time to first readiness: median ${frM.toFixed(1)} s (min ${Math.min(...fr).toFixed(0)}, max ${Math.max(...fr).toFixed(0)}) [tuning target 45–75 s, reported]`);
  check(fr.length === runs.length, `H: ${runs.length - fr.length} run(s) never charged UPROAR`);
  // boss fights per boss id (clears only)
  const byBoss: Record<string, number[]> = {};
  for (const r of runs) if (r.bossId && !Number.isNaN(r.fight)) (byBoss[r.bossId] ??= []).push(r.fight);
  const bl: string[] = [];
  for (const id of Object.keys(byBoss).sort()) {
    const m = median(byBoss[id]);
    bl.push(`${id} ${m.toFixed(0)} s [${byBoss[id].map((x) => x.toFixed(0)).join(',')}]`);
    check(m >= 70 && m <= 170, `H: median ${id} fight with UPROAR in use = ${m.toFixed(1)} s (band 70–170 s)`);
  }
  console.log(`  boss fight (spawn → clear, clears only): ${bl.join(' · ')}  [band 70–170 s]`);
  const bossesSeen = new Set(runs.map((r) => r.bossId).filter((x) => x));
  const expected = new Set(BIOME_IDS.map((b) => M.BIOMES[b].boss as string));
  for (const id of expected) check(bossesSeen.has(id), `H: boss ${id} (a biome's boss) never spawned in the full runs`);
  for (const id of expected) check((byBoss[id]?.length ?? 0) > 0, `H: boss ${id}: no clear to measure a fight length`);
  // K + L over the full runs
  const bf = runs.reduce((a, r) => a + r.bossFires, 0), bos = runs.reduce((a, r) => a + r.bossOnScreen, 0);
  const miss = runs.flatMap((r) => r.bossOnScreenMiss.map((m) => `${r.titan}/${r.biome} ${m}`));
  for (const m of miss) check(false, `K: an UPROAR missed an ON-SCREEN boss: ${m}`);
  console.log(`  K (full runs): fires with an entered boss ${bf}, boss body on screen ${bos}, on-screen boss outside R + r ${miss.length}`);
  const unf = runs.reduce((a, r) => a + r.unfired, 0), fwd = runs.reduce((a, r) => a + r.fireWithDraft, 0), lmu = runs.reduce((a, r) => a + r.lvlMidUlt, 0);
  const frt = runs.reduce((a, r) => a + r.fireRankTick, 0);
  check(fwd === 0, `L: ${fwd} tick(s) ended with an ultFire AND a draft granted that tick without a rankUp (the roar would play behind the draft)`);
  console.log(`  L (full runs): fires taken back for a same-tick draft ${unf} · ticks ending with ultFire + a freezing draft ${fwd} (want 0) · fires standing on a rankUp tick (sting defers the draft) ${frt} · level-ups while an UPROAR is in flight ${lmu} (reported: that draft pauses the ult — view wire)`);
  const fires = runs.reduce((a, r) => a + r.fires, 0);
  console.log(`  fires ${fires} over ${runs.length} runs · per-fire XP cap violations ${runs.reduce((a, r) => a + r.capViol.length, 0)} · kills mid-UPROAR ${runs.reduce((a, r) => a + r.midKills, 0)}, unbanked ${runs.reduce((a, r) => a + r.unbanked, 0)}`);
  // I. determinism: rerun two configs, compare digests
  console.log('\n── I. determinism ──');
  for (const [titan, biome] of [['molo', 'grideast'], ['voltkite', 'lockwater']] as [TitanId, BiomeId][]) {
    const a = runs.find((r) => r.titan === titan && r.biome === biome)!;
    const b = fullRun(titan, biome, seed, 13 * 60);
    const same = a.digests.length === b.digests.length && a.digests.every((d, i) => d === b.digests[i]);
    check(same, `I: ${titan}/${biome}: digests differ between two identical runs`);
    console.log(`  ${titan}/${biome}: ${a.digests.length} checkpoints ${same ? 'identical' : 'DIFFER'}`);
  }
}

// ─────────────────────────────── shared: default-zoom projection (this probe's own math) ───────────────────────────────
/** max(|ndc x|, |ndc y|) of the ground point (x, z) through the default-zoom camera the sim frames (config
 *  spawnView: distance + look-target offset from the titan; the rank's pitch, CAMERA yaw / fov, 16:9, target at
 *  CAMERA.targetYFrac · H; the velocity lead ignored). ≤ 1 = on screen; Infinity = behind the camera. */
function onScreenNdc(w: World, x: number, z: number): number {
  const C = M.cfg, T = w.titan;
  const V = C.spawnView(w);
  const p = (C.RANKS[T.rank].pitchDeg * Math.PI) / 180, yaw = (C.CAMERA.yawDeg * Math.PI) / 180;
  const o = [Math.cos(p) * Math.sin(yaw), Math.sin(p), Math.cos(p) * Math.cos(yaw)];
  const up = [-Math.sin(p) * Math.sin(yaw), Math.cos(p), -Math.sin(p) * Math.cos(yaw)];
  const rt = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const cam = [T.x + V.ox + V.d * o[0], T.height * C.CAMERA.targetYFrac + V.d * o[1], T.z + V.oz + V.d * o[2]];
  const d = [x - cam[0], -cam[1], z - cam[2]];
  const depth = -(d[0] * o[0] + d[1] * o[1] + d[2] * o[2]);
  if (!(depth > 0.1)) return Infinity;
  const tv = Math.tan((C.CAMERA.fovDeg * Math.PI) / 360);
  const sx = (d[0] * rt[0] + d[2] * rt[2]) / depth / (tv * 16 / 9);
  const sy = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / depth / tv;
  return Math.max(Math.abs(sx), Math.abs(sy));
}

/** Settle the director's boss framing on what bossFrameNeed asks for right now (held distance, eased offset and the
 *  rig replica all AT the need — the state the director converges to while the boss holds still). */
function settleBossFrame(w: World): void {
  const need = M.cfg.bossFrameNeed(w);
  const dat = w.director.data as Record<string, number>;
  const curve = M.cfg.cameraDistance(w.titan.height);
  const d = Math.max(curve, need.d);
  dat.bossFrameHeld = d; dat.bossFrameD = d; dat.bossFrameHoldT = 0;
  dat.bossFrameOx = need.ox; dat.bossFrameOz = need.oz;
  dat.camOx = need.ox; dat.camOz = need.oz; dat.camD = d; dat.camDv = 0;
}

// ─────────────────────────────── J. BACK PAY respects the lockout ───────────────────────────────
function partJ(): void {
  console.log(`\n── J. BACK PAY vs the ${ULT.lockoutS}s lockout (ultimate held every tick): banked, never a double fire ──`);
  const lockTicks = Math.round(ULT.lockoutS * 30);
  for (const titan of TITAN_IDS) {
    for (const when of ['roar', 'blast', 'lockout'] as const) {
      const w = worldAt(titan, 2, RANK_LEVELS[2]);
      const T = w.titan, u = w.ult;
      for (let i = 0; i < 5; i++) M.stepWorld(w, input());
      M.addUproar(w, ULT.max, true);
      const fires: number[] = [], readies: number[] = [];
      let collectedAt = -1, bankedOk = true, pre = '';
      for (let i = 0; i < lockTicks + 90; i++) {
        // drop BACK PAY on the titan in the wanted phase (collected in this tick's stepPowerups)
        if (collectedAt < 0 && fires.length === 1 && (when === 'lockout' ? u.phase === 'idle' && u.lockT > 0 && u.lockT < ULT.lockoutS - 2 : u.phase === when)) {
          M.spawnPowerup(w, 'backPay', T.x, T.z, true);
          collectedAt = w.tick + 1;
          pre = `${u.phase} lockT ${u.lockT.toFixed(2)}`;
        }
        M.stepWorld(w, input({ ultimate: true }));
        for (const e of w.events) {
          if (e.type === 'ultFire') fires.push(w.tick);
          if (e.type === 'ultCharged') readies.push(w.tick);
        }
        if (collectedAt === w.tick) {
          const got = w.events.some((e) => e.type === 'powerup' && e.kind === 'backPay');
          if (!got || u.ready || u.charge !== ULT.max || w.events.some((e) => e.type === 'ultCharged')) bankedOk = false;
        }
        if (fires.length >= 2) break;
      }
      const gap = fires.length >= 2 ? (fires[1] - fires[0]) / 30 : NaN;
      const readyTick = readies.length ? readies[readies.length - 1] : -1;
      const ok = check(collectedAt > 0 && bankedOk && fires.length === 2 && gap >= ULT.lockoutS - 1e-6 && gap <= ULT.lockoutS + 2 / 30 && readyTick >= fires[0] + lockTicks - 1,
        `J: ${titan} BACK PAY in ${when} (${pre}): banked ${bankedOk}, fires at ticks [${fires}] (gap ${gap.toFixed(3)} s, want ≥ ${ULT.lockoutS} s and at most 2 ticks more), ready edge tick ${readyTick}`);
      console.log(`  ${titan.padEnd(10)} BACK PAY in ${when.padEnd(7)} (${pre}): banked (full, not ready) ${bankedOk ? 'ok' : 'FAIL'} · 2nd fire ${gap.toFixed(2)} s after the 1st ${ok ? 'ok' : 'FAIL'}`);
    }
  }
  // boss in reach, BACK PAY re-dropped through every flight + lockout, ultimate held: 6 % per fire, fires ≥ 6 s apart
  {
    const w = worldAt('hearthback', 3, RANK_LEVELS[3]);
    const T = w.titan, u = w.ult;
    M.spawnBoss(w, 'caisson4');
    const b = w.boss!;
    b.x = T.x + 0.3 * M.ultRadius(w); b.z = T.z; b.introT = 0; M.refreshParts(b);
    b.hp = b.maxHp; b.meter = 0;
    M.addUproar(w, ULT.max, true);
    const fireT: number[] = [];
    let lost = 0, tokens = 0;
    for (let i = 0; i < Math.round(14 * 30); i++) {
      const hp0 = b.hp;
      w.events.length = 0;
      w.input = input({ ultimate: true });
      M.rebuildEnemyGrid(w);
      M.stepUltimate(w);
      lost += (hp0 - b.hp) / b.maxHp;
      if (w.events.some((e) => e.type === 'ultFire')) fireT.push(i / 30);
      // BACK PAY collected while the ult is in flight or locked (what stepPowerups' collect does: addUproar raw)
      if (u.phase !== 'idle' || u.lockT > 0) { M.addUproar(w, ULT.max, true); tokens++; }
    }
    const gaps = fireT.slice(1).map((t, i) => t - fireT[i]);
    const ok = check(fireT.length === 3 && gaps.every((g) => g >= ULT.lockoutS - 1e-6) && Math.abs(lost - fireT.length * ULT.bossCapFrac) < 1e-9,
      `J: BACK PAY spam vs CAISSON-4 over 14 s: ${fireT.length} fires (want 3), gaps [${gaps.map((g) => g.toFixed(2))}] s, boss lost ${(100 * lost).toFixed(3)} % (want ${(100 * fireT.length * ULT.bossCapFrac).toFixed(1)} %)`);
    console.log(`  BACK PAY on every locked tick (${tokens} fills) vs CAISSON-4, 14 s, ultimate held: ${fireT.length} fires, gaps ${gaps.map((g) => g.toFixed(2)).join(' / ')} s, boss −${(100 * lost).toFixed(2)} % ${ok ? 'ok' : 'FAIL'}`);
  }
}

// ─────────────────────────────── K. boss-framed coverage ───────────────────────────────
function partK(): void {
  console.log('\n── K. boss framing: an ON-SCREEN boss (settled framing, default zoom) is always inside UPROAR ──');
  const bosses: BossId[] = ['caisson4', 'irongully', 'parkade6'];
  const K = 2 * Math.tan((M.cfg.CAMERA.fovDeg * Math.PI) / 360);
  for (const rank of [2, 3, 4] as RankIndex[]) {
    const row: string[] = [];
    for (const id of bosses) {
      let onScreen = 0, hit = 0, exact = 0, maxRatio = 0, geoMiss = 0, maxFrame = 0;
      for (let hi = 0; hi < 16; hi++) {
        for (const f of [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.2, 2.8]) {
          const w = worldAt('molo', rank, RANK_LEVELS[rank], id === 'irongully' ? 'whitestacks' : 'grideast');
          const T = w.titan;
          M.spawnBoss(w, id);
          const b = w.boss!;
          const a = (hi * Math.PI * 2) / 16;
          const dist = f * M.cfg.cameraDistance(T.height) * K;
          b.x = T.x + Math.sin(a) * dist; b.z = T.z + Math.cos(a) * dist; b.heading = a + Math.PI;
          b.introT = 0; b.meter = 0; b.staggerT = 0;
          M.refreshParts(b);
          settleBossFrame(w);
          const bp = b.parts[0];
          if (!(onScreenNdc(w, bp.x, bp.z) <= 1)) continue;
          onScreen++;
          maxFrame = Math.max(maxFrame, M.cfg.spawnView(w).d / M.cfg.cameraDistance(T.height));
          const R = M.ultRadius(w);
          const dd = Math.hypot(bp.x - T.x, bp.z - T.z);
          if (dd > R + bp.r) geoMiss++;
          maxRatio = Math.max(maxRatio, dd / R);
          const hp0 = b.hp, m0 = b.meter;
          isolatedFire(w);
          const lost = (hp0 - b.hp) / b.maxHp;
          if (lost > 0) hit++;
          if (Math.abs(lost - ULT.bossCapFrac) < 1e-9 && Math.abs(b.meter - m0 - ULT.bossMeter) < 1e-9) exact++;
        }
      }
      const ok = check(onScreen >= 20 && hit === onScreen && exact === onScreen && geoMiss === 0,
        `K: Size ${ROMAN[rank]} vs ${id}: ${onScreen} on-screen boss placements, hit ${hit}, exact −${100 * ULT.bossCapFrac} % / +${ULT.bossMeter} ${exact}, outside R + r ${geoMiss}`);
      row.push(`${id} on-screen ${onScreen} hit ${hit} exact ${exact} (frame ≤ ${maxFrame.toFixed(2)}× curve, boss dist ≤ ${maxRatio.toFixed(2)} R) ${ok ? 'ok' : 'FAIL'}`);
    }
    console.log(`  Size ${ROMAN[rank].padEnd(3)} ${row.join(' · ')}`);
  }
  // no boss: R is exactly the spec formula (the framed-view term applies only while a boss is alive)
  const w = worldAt('molo', 4, RANK_LEVELS[4]);
  const want = Math.max(ULT.rFloorH * w.titan.height, ULT.rFrac * M.spawnRing(w));
  const okNb = check(Math.abs(M.ultRadius(w) - want) < 1e-9, `K: no boss: R ${M.ultRadius(w)} ≠ the spec formula ${want}`);
  console.log(`  no boss (Size V LV ${RANK_LEVELS[4]}): R ${M.ultRadius(w).toFixed(1)} m = max(3 H, 0.95 × spawnRing) ${okNb ? 'ok' : 'FAIL'}`);
}

// ─────────────────────────────── L. a fire on a draft tick is taken back ───────────────────────────────
function partL(): void {
  console.log('\n── L. UPROAR pressed on the tick a level-up is granted: taken back (no ultFire behind the draft) ──');
  for (const titan of TITAN_IDS) {
    for (const mode of ['level', 'control', 'rankUp', 'owed'] as const) {
      // a scrap pickup worth one level dropped on the titan is collected after MIN_COLLECT_AGE: a dry run finds
      // the tick of that level-up, the identical (deterministic) second world presses UPROAR on exactly that tick.
      // rankUp: the level reached is the next Size's threshold (game.ts plays on through the MASS BREACH sting and
      // opens the draft after it — the fire must stand). owed: a draft already owed when UPROAR is pressed (the
      // app running on through that sting) — the fire must stand too.
      const lv = mode === 'rankUp' ? RANK_LEVELS[2] - 1 : RANK_LEVELS[1] + 1;
      const make = (): World => {
        const w = worldAt(titan, 1, lv);
        for (let i = 0; i < 5; i++) M.stepWorld(w, input());
        M.addUproar(w, ULT.max, true);
        if (mode === 'level' || mode === 'rankUp') M.spawnPickup(w, 'scrap', w.titan.x, w.titan.z, Math.max(1, w.titan.xpToNext - w.titan.xp) + 1, 0);
        return w;
      };
      let at = 0;
      if (mode === 'level' || mode === 'rankUp') {
        const dry = make();
        for (let i = 0; i < 90; i++) { M.stepWorld(dry, input()); if (dry.events.some((e) => e.type === 'levelUp')) { at = i; break; } }
      }
      const w = make();
      const T = w.titan, u = w.ult;
      for (let i = 0; i < at; i++) M.stepWorld(w, input());
      if (mode === 'owed') w.upgrades.pendingDrafts = 1;
      const owed0 = M.hasPendingDraft(w);
      const fired0 = u.fired, lv0 = T.level, rk0 = T.rank;
      M.stepWorld(w, input({ ultimate: true }));
      const ev = w.events;
      const levelled = T.level > lv0 && ev.some((e) => e.type === 'levelUp');
      const ranked = T.rank > rk0 && ev.some((e) => e.type === 'rankUp');
      const draft = M.hasPendingDraft(w);
      const hasFire = ev.some((e) => e.type === 'ultFire');
      const fires = hasFire && u.phase === 'roar' && u.fired === fired0 + 1;
      if (mode === 'level') {
        const ok1 = check(levelled && !ranked && draft && !hasFire && u.phase === 'idle' && u.ready && u.charge === ULT.max && u.lockT === 0 && u.fired === fired0,
          `L: ${titan}: level-up tick — levelled ${levelled}, rankUp ${ranked}, draft ${draft}, ultFire ${hasFire}, phase ${u.phase}, ready ${u.ready}, charge ${u.charge}, lockT ${u.lockT}, fired ${u.fired} (was ${fired0})`);
        // resolve the draft like the app, then the next press fires
        let g = 0;
        while (M.hasPendingDraft(w) && g++ < 20) { const off = M.rollOffer(w, w.upgrades.chestDrafts > 0); if (!off || !off.length) break; M.pickUpgrade(w, M.botPickUpgrade(w, off)); }
        M.stepWorld(w, input({ ultimate: true }));
        const ok2 = check(w.events.some((e) => e.type === 'ultFire') && u.phase === 'roar' && u.fired === fired0 + 1, `L: ${titan}: the press after the draft did not fire (phase ${u.phase})`);
        console.log(`  ${titan.padEnd(10)} level-up tick: fire taken back (idle, READY, no lockout, no ultFire) ${ok1 ? 'ok' : 'FAIL'} · next press after the draft fires ${ok2 ? 'ok' : 'FAIL'}`);
      } else if (mode === 'control') {
        const ok = check(!draft && fires, `L: ${titan}: control (no level-up) did not fire (phase ${u.phase}, draft ${draft})`);
        console.log(`  ${titan.padEnd(10)} control (no level-up): fires ${ok ? 'ok' : 'FAIL'}`);
      } else if (mode === 'rankUp') {
        const ok = check(levelled && ranked && draft && fires, `L: ${titan}: rank-up tick (sting, app plays on) — levelled ${levelled}, rankUp ${ranked}, draft ${draft}, fired ${fires} (phase ${u.phase})`);
        console.log(`  ${titan.padEnd(10)} level-up + rankUp tick (MASS BREACH sting defers the draft): fire stands ${ok ? 'ok' : 'FAIL'}`);
      } else {
        const ok = check(owed0 && draft && fires, `L: ${titan}: draft already owed at the press — owed ${owed0}, fired ${fires} (phase ${u.phase})`);
        console.log(`  ${titan.padEnd(10)} draft already owed at the press (app running on): fire stands ${ok ? 'ok' : 'FAIL'}`);
      }
    }
  }
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const quick = argv.includes('--quick');
  const si = argv.indexOf('--seed');
  const seed = si >= 0 ? Number(argv[si + 1]) : 1337;
  const err = await load();
  if (err) { console.log('probe_ult: FAIL — could not load the sim:\n' + err); return 2; }
  console.log(`BLOCKTOOTH probe_ult — UPROAR (FEATURES_V2 §3) · ULT max ${ULT.max}, lockout ${ULT.lockoutS}s, R = max(${ULT.rFloorH} H, ${ULT.rFrac} × spawnRing), xpCap ${ULT.xpCapLevelFrac} × level need, bank ≤ ${ULT.bankPickupsPerTick}/tick, boss ${100 * ULT.bossCapFrac} % + ${ULT.bossMeter}`);
  const parts: [string, () => void][] = [['A', partA], ['B', partB], ['C', partC], ['D', partD], ['E', partE], ['J', partJ], ['K', partK], ['L', partL]];
  for (const [name, fn] of parts) {
    try { fn(); } catch (e) { check(false, `${name}: threw ${(e as Error)?.stack ?? e}`); }
  }
  if (!quick) {
    try { partH(seed); } catch (e) { check(false, `H: threw ${(e as Error)?.stack ?? e}`); }
  } else console.log('\n(--quick: full runs H/I skipped)');
  if (fails.length) {
    console.log(`\nprobe_ult: FAIL — ${fails.length} failure(s):`);
    for (const f of fails) console.log('  - ' + f);
    return 1;
  }
  console.log('\nprobe_ult: PASS');
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.log('probe_ult: FAIL — ' + ((e as Error)?.stack ?? e)); process.exit(2); });

// keep xpToNext referenced (the cap in the report is ULT.xpCapLevelFrac × xpToNext(level))
void xpToNext;
