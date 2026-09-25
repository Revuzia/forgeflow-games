// BLOCKTOOTH v2 — map objectives + power-ups probe (FEATURES_V2 §5, §6, §15.3; lane L4 MAP-SIM). Node, THREE-free.
//
//   node _harness/probe_map.ts              # unit checks + 15 full bot runs (5 seeds × 3 biomes, ~1 min)
//   node _harness/probe_map.ts --quick      # unit checks only
//
// Asserts (exit 1 on any failure, 2 if the sim cannot load):
//   A. placement (every spawn of the full runs): Size I OVERLOAD SITE → a live STATIC prop of the biome's
//      overloadPropsS1 in [0.8, 1.8] × spawnRing; Size II+ OVERLOAD / ANNEX → a standing building of tier
//      canFlatten (or canFlatten − 1) in [0.8, 1.8] / [1.0, 2.2] × spawnRing; RELIEF → a free-standing crate in
//      [0.5, 1.4] × spawnRing; every biome places an OVERLOAD SITE in Size I on all 5 seeds
//   B. OVERLOAD payout: completion on the SAME tick as the bound prop's credited `propDestroyed`; +35 UPROAR;
//      XP = xpFrac × xpToNext(level) as ONE scrap pickup collected on the NEXT tick, whose level-up fires a
//      levelUp-triggered card (upgradeProc) that tick; a guaranteed power-up at the site, never BACK PAY
//   C. RELIEF DEPOT: walk-in completes; 3 heal pickups when hurt; +8 UPROAR at ≥ 95 % HP
//   D. RECORDS ANNEX: building band/tier, guard (Size II PICKET SQUAD ×5, Size III BULWARK), chest payout
//   E. a site collapsed by a TRIGGER SHOCKWAVE (a card proc in processTriggers, MOLO Septic Burp on the hook)
//      pays out that same tick
//   F. a TRIGGER kill drops a power-up that same tick
//   G. expiry + state sweep: a boss-crushed site expires (never pays); life; strand; MASS BREACH re-validation
//      (a prop site expires at the breach into Size II, an ANNEX is owed 20 s later)
//   H. RED LIGHT: enemies, enemy shots and enemy paint freeze; the director holds waves; the boss does not;
//      4.5 s with a boss alive; everything resumes after `powerupEnd`
//   I. DEMOLITION NOTICE: non-elites in 1.0 × spawnRing die, elites −25 %, hostile non-boss shots in the ring
//      deleted, boss −2 % and meter +0.1 exactly, banked pickups ≤ ULT.bankPickupsPerTick per tick, XP conserved
//   J. CLEANUP / RUSH HOUR / BACK PAY effects; spawn gap + cap rules
//   K. full runs (gate bot + bot_map, 5 seeds × 3 biomes): per-biome medians OVERLOAD done 5–12, ANNEX placed
//      = breaches reached (owed before the run ended), power-ups 4–12, random-drop gap ≥ minGapS, ≤ maxAlive
//      alive; no bound objective ever outlives its target; every building/prop completion matches a credited
//      event that tick; OVERLOAD XP collected the next tick
//   L. determinism: the same seed twice ⇒ identical map + titan digests every 30 s
//   M. placeObjectiveNear (harness helper): a Size I prop site placed 2 H ahead is shed by walking at it ≤ 15 s

import type { BiomeId, Building, EnemyKind, Objective, PowerUpKind, Prop, SimEvent, TitanId, TitanInput, World } from '../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../src/core/types.ts';
import { OBJECTIVES, POWERUPS, RANKS, RANK_LEVELS, ULT, xpToNext } from '../src/core/config.ts';

type Mods = {
  world: typeof import('../src/core/world.ts');
  obj: typeof import('../src/meta/objectives.ts');
  pu: typeof import('../src/meta/powerups.ts');
  dir: typeof import('../src/ai/director.ts');
  en: typeof import('../src/ai/enemies.ts');
  ts: typeof import('../src/titans/titansim.ts');
  pk: typeof import('../src/combat/pickups.ts');
  pj: typeof import('../src/combat/projectiles.ts');
  tg: typeof import('../src/combat/telegraphs.ts');
  cs: typeof import('../src/city/citysim.ts');
  boss: typeof import('../src/ai/bosses/index.ts');
  eng: typeof import('../src/upgrades/engine.ts');
  st: typeof import('../src/upgrades/stats.ts');
  draft: typeof import('../src/upgrades/draft.ts');
  dobj: typeof import('../src/data/objectives.ts');
  den: typeof import('../src/data/enemies.ts');
  bot: typeof import('./bot.ts');
};
let S: Mods;

async function load(): Promise<string | null> {
  try {
    S = {
      world: await import('../src/core/world.ts'),
      obj: await import('../src/meta/objectives.ts'),
      pu: await import('../src/meta/powerups.ts'),
      dir: await import('../src/ai/director.ts'),
      en: await import('../src/ai/enemies.ts'),
      ts: await import('../src/titans/titansim.ts'),
      pk: await import('../src/combat/pickups.ts'),
      pj: await import('../src/combat/projectiles.ts'),
      tg: await import('../src/combat/telegraphs.ts'),
      cs: await import('../src/city/citysim.ts'),
      boss: await import('../src/ai/bosses/index.ts'),
      eng: await import('../src/upgrades/engine.ts'),
      st: await import('../src/upgrades/stats.ts'),
      draft: await import('../src/upgrades/draft.ts'),
      dobj: await import('../src/data/objectives.ts'),
      den: await import('../src/data/enemies.ts'),
      bot: await import('./bot.ts'),
    };
    return null;
  } catch (e) {
    return (e as Error)?.stack ?? String(e);
  }
}

// ─────────────────────────────── reporting ───────────────────────────────
let fails = 0, passes = 0;
const failLines: string[] = [];
function check(ok: boolean, label: string, detail = ''): boolean {
  if (ok) { passes++; console.log(`  ok   ${label}${detail ? '  — ' + detail : ''}`); }
  else { fails++; const l = `  FAIL ${label}${detail ? '  — ' + detail : ''}`; failLines.push(l); console.log(l); }
  return ok;
}
const f1 = (x: number) => x.toFixed(1), f2 = (x: number) => x.toFixed(2);
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };

const IDLE: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
function step(w: World, inp: TitanInput = IDLE): SimEvent[] { S.world.stepWorld(w, inp); return w.events.slice(); }
function fresh(titan: TitanId, biome: BiomeId, seed = 1337, noSpawns = true): World {
  const w = S.world.createWorld({ titan, biome, seed });
  w.cheats.noSpawns = noSpawns;
  step(w);
  return w;
}
function toward(w: World, x: number, z: number): TitanInput {
  const dx = x - w.titan.x, dz = z - w.titan.z, d = Math.hypot(dx, dz) || 1;
  return { mx: dx / d, mz: dz / d, ability: false, abilityHeld: false, dash: false };
}
/** stand the titan `gap` metres from (x,z) (outside), facing it */
function standNear(w: World, x: number, z: number, gap: number): void {
  const T = w.titan;
  let dx = T.x - x, dz = T.z - z;
  let d = Math.hypot(dx, dz);
  if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
  T.x = T.px = x + (dx / d) * gap; T.z = T.pz = z + (dz / d) * gap;
  T.heading = T.pheading = Math.atan2(x - T.x, z - T.z);
  T.vx = 0; T.vz = 0;
}
function killAllEnemies(w: World): void { for (const e of w.enemies) e.alive = false; }
/** jump to Size `rank` and let the MASS BREACH tween + the camera framing (spawnRing) settle (2 s) */
function growSettle(w: World, rank: number): void { S.ts.growToRank(w, rank); for (let i = 0; i < 60; i++) step(w); }

// ─────────────────────────────── B. OVERLOAD payout (Size I prop) ───────────────────────────────
function testOverloadPayout(): void {
  console.log('\nB. OVERLOAD SITE payout (Size I prop, MOLO / GRID-EAST)');
  const w = fresh('molo', 'grideast');
  S.eng.applyUpgrade(w, 'growth_spurt_memo');   // on levelUp, chance 1 → upgradeProc on the payout's level-up
  const o = S.obj.spawnObjective(w, 'overloadSite');
  if (!check(!!o && o.target === 'prop', 'spawnObjective(overloadSite) at Size I binds a prop', o ? `${o.target}#${o.targetId}` : 'null')) return;
  const p = w.city.props[o!.targetId];
  p.hp = 0.01;
  const T = w.titan;
  standNear(w, p.x, p.z, T.radius + 0.9);
  const need = xpToNext(T.level);
  const pay = S.obj.MAP_TUNE.overloadXpFrac * need;
  T.xp = Math.max(0, T.xpToNext - 0.5 * pay);   // the payout crosses the level
  const c0 = w.ult.charge;
  let doneTick = -1, destroyedTick = -1, ev: SimEvent[] = [];
  for (let i = 0; i < 120 && doneTick < 0; i++) {
    ev = step(w, toward(w, p.x, p.z));
    if (ev.some((e) => e.type === 'propDestroyed' && e.id === p.id && !(e as { noCredit?: boolean }).noCredit)) destroyedTick = w.tick;
    if (ev.some((e) => e.type === 'objectiveDone' && e.id === o!.id)) doneTick = w.tick;
  }
  check(doneTick > 0 && doneTick === destroyedTick, 'completes on the same tick as its credited propDestroyed', `done @${doneTick} destroyed @${destroyedTick}`);
  const dc = w.ult.charge - c0;
  check(dc >= OBJECTIVES.overload.uproar - 1e-6 && dc <= OBJECTIVES.overload.uproar + 3, `+${OBJECTIVES.overload.uproar} UPROAR on completion`, `charge +${f2(dc)} (incl. this tick's trickle / prop points)`);
  const spawned = ev.filter((e) => e.type === 'powerupSpawn');
  check(spawned.length === 1 && spawned[0].type === 'powerupSpawn' && Math.hypot(spawned[0].x - o!.x, spawned[0].z - o!.z) < 1.5 && spawned[0].kind !== 'backPay',
    'one guaranteed power-up at the site (not BACK PAY)', spawned.map((e) => e.type === 'powerupSpawn' ? e.kind : '').join(','));
  check(Math.abs(w.map.overloadXp - pay) < 1e-6 && w.map.overloadsDone === 1, 'map.overloadXp / overloadsDone recorded', `${f2(w.map.overloadXp)} vs ${f2(pay)}`);
  const lv0 = T.level;
  const ev2 = step(w, IDLE);
  const pick = ev2.find((e) => e.type === 'pickup' && e.kind === 'scrap' && Math.abs(e.xp - pay) < 1e-6);
  check(!!pick, 'the XP pickup (one scrap, xpFrac × xpToNext) is collected on the NEXT tick', `xp ${f2(pay)} = ${S.obj.MAP_TUNE.overloadXpFrac} × ${f1(need)}`);
  check(T.level === lv0 + 1 && ev2.some((e) => e.type === 'levelUp'), 'its level-up lands that tick', `LV ${lv0} → ${T.level}`);
  check(ev2.some((e) => e.type === 'upgradeProc' && e.id === 'growth_spurt_memo'), 'a levelUp-triggered card procs on that level-up (processTriggers saw it)');
  // guaranteed kind never BACK PAY (200 rolls)
  let bp = 0;
  for (let i = 0; i < 200; i++) if (S.pu.rollKind(w, true) === 'backPay') bp++;
  check(bp === 0, 'rollKind(noBackPay) never yields BACK PAY (200 rolls)');
}

// ─────────────────────────────── M. harness helper: a site straight ahead, walked in ───────────────────────────────
function testPlaceNear(): void {
  console.log('\nM. placeObjectiveNear (playtest_v2 step 4 helper): a Size I prop site 2 H ahead, walked in and shed');
  for (const titan of TITAN_IDS) {
    const w = fresh(titan, 'grideast');
    const T = w.titan;
    const ax = T.x + Math.sin(T.heading) * 2 * T.height, az = T.z + Math.cos(T.heading) * 2 * T.height;
    const o = S.obj.placeObjectiveNear(w, 'overloadSite', ax, az);
    if (!check(!!o && o.target === 'prop', `${titan}: bound to the nearest listed static prop`, o ? `${w.city.props[o.targetId].kind} ${f1(Math.hypot(o.x - ax, o.z - az))} m from the point` : 'none')) continue;
    const t0 = w.t;
    let done = false;
    for (let i = 0; i < 30 * 15 && !done; i++) done = step(w, toward(w, o!.x, o!.z)).some((e) => e.type === 'objectiveDone' && e.id === o!.id);
    check(done, `${titan}: walking at it sheds it within 15 s (real prop HP, auto-attack + contact)`, done ? `${f1(w.t - t0)} s` : 'not done');
  }
}

// ─────────────────────────────── C. RELIEF DEPOT ───────────────────────────────
function testRelief(): void {
  console.log('\nC. RELIEF DEPOT');
  const w = fresh('briarwick', 'whitestacks');
  const T = w.titan;
  T.hp = 0.5 * T.maxHp;
  const o = S.obj.spawnObjective(w, 'reliefDepot');
  if (!check(!!o && o.target === 'none' && o.r >= 0.6 * OBJECTIVES.relief.sizeMinM - 1e-9, 'spawnObjective(reliefDepot): free-standing crate', o ? `r ${f2(o.r)} m` : 'null')) return;
  o!.x = T.x + Math.sin(T.heading) * 3 * T.height; o!.z = T.z + Math.cos(T.heading) * 3 * T.height;
  let done = false, heals = 0;
  for (let i = 0; i < 150 && !done; i++) {
    const n0 = w.pickups.length;
    const ev = step(w, toward(w, o!.x, o!.z));
    if (ev.some((e) => e.type === 'objectiveDone' && e.id === o!.id)) {
      done = true;
      for (let k = n0; k < w.pickups.length; k++) if (w.pickups[k].kind === 'heal') heals++;
    }
  }
  check(done, 'walking into the crate completes it');
  check(heals === OBJECTIVES.relief.heals, `${OBJECTIVES.relief.heals} heal pickups burst when hurt`, `${heals}`);
  // full HP → +8 UPROAR
  T.hp = T.maxHp;
  const o2 = S.obj.spawnObjective(w, 'reliefDepot');
  if (!o2) { check(false, 'second RELIEF placed'); return; }
  o2.x = T.x + Math.sin(T.heading) * 2 * T.height; o2.z = T.z + Math.cos(T.heading) * 2 * T.height;
  let dc = -1;
  for (let i = 0; i < 150 && dc < 0; i++) {
    const c0 = w.ult.charge, n0 = w.pickups.length;
    const ev = step(w, toward(w, o2.x, o2.z));
    if (ev.some((e) => e.type === 'objectiveDone' && e.id === o2.id)) {
      dc = w.ult.charge - c0;
      let h = 0; for (let k = n0; k < w.pickups.length; k++) if (w.pickups[k].kind === 'heal') h++;
      check(h === 0, 'no heal pickups at ≥ 95 % HP');
    }
  }
  check(dc >= OBJECTIVES.relief.fullHpUproar - 1e-6 && dc <= OBJECTIVES.relief.fullHpUproar + 1, `+${OBJECTIVES.relief.fullHpUproar} UPROAR instead at ≥ 95 % HP`, `+${f2(dc)}`);
}

// ─────────────────────────────── D. RECORDS ANNEX ───────────────────────────────
function testAnnex(): void {
  console.log('\nD. RECORDS ANNEX');
  for (const rank of [1, 2] as const) {
    const w = fresh('hearthback', 'grideast', 1337, false);
    w.cheats.noSpawns = true;
    growSettle(w, rank);
    killAllEnemies(w);
    w.cheats.noSpawns = false;
    const ring = S.dir.spawnRing(w);
    const e0 = new Set(w.enemies.filter((e) => e.alive).map((e) => e.id));
    const o = S.obj.spawnObjective(w, 'recordsAnnex');
    if (!check(!!o && o.target === 'building', `Size ${rank + 1}: ANNEX binds a building`)) continue;
    const b = w.city.buildings[o!.targetId];
    const can = RANKS[w.titan.rank].canFlatten;
    const d = Math.hypot(b.x - w.titan.x, b.z - w.titan.z);
    check((b.tier === can || b.tier === can - 1) && !b.collapsed, `Size ${rank + 1}: tier canFlatten (or −1)`, `tier ${b.tier}, canFlatten ${can}`);
    check(d >= OBJECTIVES.annex.bandMin * ring - 1e-6 && d <= OBJECTIVES.annex.bandMax * ring + 1e-6, `Size ${rank + 1}: centre in [${OBJECTIVES.annex.bandMin}, ${OBJECTIVES.annex.bandMax}] × spawnRing`, `${f1(d)} m, ring ${f1(ring)}`);
    const guards = w.enemies.filter((e) => e.alive && !e0.has(e.id));
    if (rank === 1) check(guards.length === 5 && guards.every((e) => e.kind === 'squad'), 'Size II guard = one PICKET SQUAD (5)', guards.map((e) => e.kind).join(','));
    else check(guards.length === 1 && guards[0].kind === 'apc', 'Size III guard = one BULWARK', guards.map((e) => e.kind).join(','));
    // payout: bring it down (1 weak floor), titan walks in
    killAllEnemies(w); w.cheats.noSpawns = true;
    b.alive = 1; b.floorHp = 0.01;
    standNear(w, b.x, b.z, 0.5 * Math.max(b.w, b.d) + w.titan.radius + 0.5);
    let chest = false, done = false;
    for (let i = 0; i < 150 && !done; i++) {
      const n0 = w.pickups.length;
      const ev = step(w, toward(w, b.x, b.z));
      if (ev.some((e) => e.type === 'objectiveDone' && e.id === o!.id)) {
        done = true;
        for (let k = n0; k < w.pickups.length; k++) if (w.pickups[k].kind === 'chest') chest = true;
      }
    }
    check(done && chest, `Size ${rank + 1}: collapsing it pays one chest pickup`);
  }
}

// ─────────────────────────────── E + F. trigger procs ───────────────────────────────
function setupProcWorld(): World {
  const w = fresh('molo', 'grideast');
  growSettle(w, 1);
  S.eng.applyUpgrade(w, 'molo_septic_burp');   // on 'ability', chance 1: shockwave r 2 H
  return w;
}
function pressHook(w: World): SimEvent[] {
  const all: SimEvent[] = [];
  w.titan.abilityCd = 0;
  for (let i = 0; i < 8; i++) {
    w.titan.autoCd = 99;   // no auto-attack: only the proc can do it
    const ev = step(w, { mx: 0, mz: 0, ability: i === 0, abilityHeld: true, dash: false });
    for (const e of ev) all.push(e);
    if (ev.some((e) => e.type === 'upgradeProc' && e.id === 'molo_septic_burp')) return ev;
  }
  return [];
}
function testTriggerShockwave(): void {
  console.log('\nE. a site collapsed by a TRIGGER SHOCKWAVE pays out that tick');
  const w = setupProcWorld();
  const o = S.obj.spawnObjective(w, 'overloadSite');
  if (!check(!!o && o.target === 'building', 'Size II OVERLOAD SITE binds a building')) return;
  const b = w.city.buildings[o!.targetId];
  b.alive = 1; b.floorHp = 0.01;
  const H = w.titan.height;
  standNear(w, b.x, b.z, 0.5 * Math.hypot(b.w, b.d) + 0.8 * H);   // outside contact, inside the 2 H shockwave
  const ev = pressHook(w);
  const proc = ev.some((e) => e.type === 'upgradeProc' && e.id === 'molo_septic_burp');
  const col = ev.some((e) => e.type === 'buildingCollapse' && e.id === b.id && !(e as { noCredit?: boolean }).noCredit);
  const done = ev.some((e) => e.type === 'objectiveDone' && e.id === o!.id);
  check(proc && col && done, 'Septic Burp proc + the bound building\'s collapse + objectiveDone on ONE tick', `proc ${proc} · collapse ${col} · done ${done}`);
}
function testTriggerKillDrop(): void {
  console.log('\nF. a TRIGGER kill drops a power-up that tick');
  const w = setupProcWorld();
  const save = { ...S.pu.PU_TUNE.dropByKill };
  S.pu.PU_TUNE.dropByKill.android = 1;
  w.map.lastDropT = -1e9;
  const T = w.titan;
  const e = S.en.spawnEnemy(w, 'android', T.x + Math.sin(T.heading) * 1.2 * T.height, T.z + Math.cos(T.heading) * 1.2 * T.height);
  e.hp = 0.01;
  const ev = pressHook(w);
  Object.assign(S.pu.PU_TUNE.dropByKill, save);
  const proc = ev.some((q) => q.type === 'upgradeProc' && q.id === 'molo_septic_burp');
  const kill = ev.find((q) => q.type === 'enemyKilled' && q.id === e.id);
  const drop = ev.find((q) => q.type === 'powerupSpawn');
  check(proc && !!kill && !!drop && kill.type === 'enemyKilled' && drop.type === 'powerupSpawn' && Math.hypot(drop.x - kill.x, drop.z - kill.z) < 1.5,
    'Septic Burp kill + a powerupSpawn at the kill, same tick', `proc ${proc} · kill ${!!kill} · drop ${drop && drop.type === 'powerupSpawn' ? drop.kind : 'none'}`);
}

// ─────────────────────────────── G. expiry + sweep + breach ───────────────────────────────
function testExpiry(): void {
  console.log('\nG. expiry, state sweep, MASS BREACH re-validation');
  {
    const w = fresh('voltkite', 'lockwater');
    growSettle(w, 1);
    const o = S.obj.spawnObjective(w, 'overloadSite');
    if (o && o.target === 'building') {
      S.cs.damageBuilding(w, o.targetId, 1e12, { src: 'boss', kind: 'slam' });
      const pk0 = w.pickups.filter((p) => p.alive && p.kind === 'scrap').length;
      const ev = step(w);
      check(ev.some((e) => e.type === 'objectiveExpire' && e.id === o.id) && !ev.some((e) => e.type === 'objectiveDone') && w.map.overloadsDone === 0 && w.map.overloadXp === 0,
        'a boss-crushed site (no credited event) EXPIRES and pays nothing', `scrap before ${pk0}`);
      check(!w.map.objectives.some((q) => q.alive && q.id === o.id), '… and is not left alive (never sticks)');
    } else check(false, 'Size II building OVERLOAD placed for the sweep test');
  }
  {
    const w = fresh('voltkite', 'lockwater');
    const o = S.obj.spawnObjective(w, 'reliefDepot')!;
    o.t = o.life - 0.5 * w.dt;
    const ev = step(w);
    check(ev.some((e) => e.type === 'objectiveExpire' && e.id === o.id), 'life runs out → objectiveExpire');
    const o2 = S.obj.spawnObjective(w, 'reliefDepot')!;
    const ring = S.dir.spawnRing(w);
    w.titan.x = o2.x + (OBJECTIVES.strandMul + 0.3) * ring; w.titan.z = o2.z;
    const B = w.city.bounds; w.titan.x = Math.min(B.maxX - 5, w.titan.x);
    const far = Math.hypot(w.titan.x - o2.x, w.titan.z - o2.z) > OBJECTIVES.strandMul * S.dir.spawnRing(w);
    const ev2 = step(w);
    check(!far || ev2.some((e) => e.type === 'objectiveExpire' && e.id === o2.id), 'left behind (> strandMul × spawnRing) → objectiveExpire', far ? '' : 'could not place the titan far enough (skipped)');
  }
  {
    const w = fresh('molo', 'whitestacks');
    let o: Objective | null = null;
    for (let i = 0; i < 30 * 30 && !o; i++) { step(w); o = w.map.objectives.find((q) => q.alive && q.kind === 'overloadSite') ?? null; }
    if (!check(!!o && o.target === 'prop' && w.t >= OBJECTIVES.overload.firstAtS - 0.05, `the scheduler places the first OVERLOAD SITE at ${OBJECTIVES.overload.firstAtS} s (a prop at Size I)`, o ? `t ${f1(w.t)}` : 'none')) return;
    const T = w.titan;
    T.level = RANK_LEVELS[1] - 1; T.xpToNext = xpToNext(T.level); T.xp = T.xpToNext - 1e-3;
    S.pk.spawnPickup(w, 'scrap', T.x, T.z, 1, 0);
    const p = w.pickups[w.pickups.length - 1]; p.t = 0.2; p.magnet = true;
    let ev: SimEvent[] = [];
    for (let i = 0; i < 6; i++) { ev = step(w); if (ev.some((e) => e.type === 'rankUp')) break; }
    const t0 = w.t;
    check(ev.some((e) => e.type === 'rankUp') && ev.some((e) => e.type === 'objectiveExpire' && e.id === o!.id), 'breach into Size II expires the Size I prop site that tick');
    check(w.map.annexDue.length === 1 && Math.abs(w.map.annexDue[0] - (t0 + OBJECTIVES.annex.delayAfterBreachS)) < 1e-6, `an ANNEX is owed ${OBJECTIVES.annex.delayAfterBreachS} s after the breach`, `due ${w.map.annexDue.map(f1).join(',')} @t ${f1(t0)}`);
    let placed: Objective | null = null;
    const tries: number[] = [];
    for (let i = 0; i < 30 * 40 && !placed; i++) {
      const n0 = w.map.nextOverloadT;
      step(w);
      if (w.map.nextOverloadT !== n0) tries.push(w.t - t0);
      placed = w.map.objectives.find((q) => q.alive && q.kind === 'overloadSite') ?? null;
    }
    const cadence = tries.length > 0 && Math.abs(tries[0] - S.obj.MAP_TUNE.retryS) < 0.2 && tries.every((t, i) => i === 0 || Math.abs(t - tries[i - 1] - S.obj.MAP_TUNE.retryS) < 0.2);
    check(!!placed && placed.target === 'building' && cadence, 're-placed as a BUILDING site: first try 3 s after the breach, then a retry every 3 s until a candidate exists',
      placed ? `${placed.target} after ${f1(w.t - t0)} s (tries at ${tries.map(f1).join(', ')} s)` : 'none');
  }
}

// ─────────────────────────────── H. RED LIGHT ───────────────────────────────
function testRedLight(): void {
  console.log('\nH. RED LIGHT');
  for (const withBoss of [false, true]) {
    const w = fresh('hearthback', 'grideast', 1337, true);
    growSettle(w, 1);
    w.cheats.noSpawns = false;
    killAllEnemies(w);
    const T = w.titan;
    const H = T.height;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      S.en.spawnEnemy(w, i % 2 ? 'android' : 'buggy', T.x + Math.sin(a) * 6 * H, T.z + Math.cos(a) * 6 * H);
    }
    for (let i = 0; i < 20; i++) step(w);   // let them start moving / shooting
    if (withBoss) { S.boss.spawnBoss(w, 'caisson4'); step(w); }
    const shot = S.pj.spawnProjectile(w, { owner: 'enemy', kind: 'pellet', x: T.x + 20, z: T.z, vx: -8, vz: 0, dmg: 1, life: 10 });
    const paint = S.tg.spawnTelegraph(w, { owner: 'enemy', style: 'circle', shape: { k: 'circle', x: T.x + 30, z: T.z + 30, r: 3 }, windup: 30, dmg: 1, kind: 'mortar' });
    S.pu.spawnPowerup(w, 'redLight', T.x, T.z, true);
    const ev = step(w);
    check(ev.some((e) => e.type === 'powerup' && e.kind === 'redLight'), `${withBoss ? 'boss alive' : 'no boss'}: token collected on the titan`);
    const want = withBoss ? POWERUPS.redLightBossS : POWERUPS.redLightS;
    check(Math.abs(w.map.redLightT - (want - w.dt)) < 1e-6 || Math.abs(w.map.redLightT - want) < 1e-6, `RED LIGHT runs ${want} s`, `${f2(w.map.redLightT)} s left`);
    const snap = w.enemies.filter((e) => e.alive).map((e) => ({ e, x: e.x, z: e.z, t: e.t, cd: e.cd }));
    const sx = shot.x, sl = shot.life, pt = paint.t;
    const b = w.boss;
    const bs = b ? { x: b.x, z: b.z, intro: b.introT, at: b.attackT, cd: b.cd, h: b.heading } : null;
    let spawns = 0;
    for (let i = 0; i < 60; i++) { const e2 = step(w); spawns += e2.filter((e) => e.type === 'enemySpawn').length; }
    const frozen = snap.every((s) => !s.e.alive || (s.e.x === s.x && s.e.z === s.z && s.e.t === s.t && s.e.cd === s.cd));
    check(frozen, `${withBoss ? 'boss alive' : 'no boss'}: ${snap.length} enemies: position, AI timer and weapon cooldown frozen for 2 s`);
    check(shot.alive && shot.x === sx && shot.life === sl, 'enemy projectile hangs in the air (no move, no ageing)');
    check(paint.alive && paint.t === pt, 'enemy-owned paint does not count down');
    check(spawns === 0, 'the director holds its waves', `${spawns} enemySpawn`);
    if (bs && b) check(b.x !== bs.x || b.z !== bs.z || b.introT !== bs.intro || b.attackT !== bs.at || b.cd !== bs.cd || b.heading !== bs.h, 'the boss ignores it');
    let ended = false;
    for (let i = 0; i < 30 * 7 && !ended; i++) ended = step(w).some((e) => e.type === 'powerupEnd' && e.kind === 'redLight');
    check(ended && !S.pu.redLightActive(w), '`powerupEnd redLight` after the timer');
    const snap2 = w.enemies.filter((e) => e.alive).map((e) => ({ e, x: e.x, z: e.z }));
    for (let i = 0; i < 30; i++) step(w);
    check(snap2.some((s) => s.e.alive && (s.e.x !== s.x || s.e.z !== s.z)), 'enemies move again afterwards');
  }
}

// ─────────────────────────────── I. DEMOLITION ───────────────────────────────
function testDemolition(): void {
  console.log('\nI. DEMOLITION NOTICE');
  const w = fresh('briarwick', 'lockwater');
  S.boss.spawnBoss(w, 'irongully');
  growSettle(w, 1);
  const T = w.titan;
  const b = w.boss!;
  b.introT = 0;
  killAllEnemies(w);
  const ring = S.dir.spawnRing(w);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  const inside: number[] = [], outside: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = (0.25 + 0.6 * rnd()) * ring;
    const e = S.en.spawnEnemy(w, i % 3 ? 'android' : 'drone', T.x + Math.sin(a) * d, T.z + Math.cos(a) * d);
    inside.push(e.id);
  }
  const eliteE = S.en.spawnEnemy(w, 'elite', T.x + 0.4 * ring, T.z, { elite: true });
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const e = S.en.spawnEnemy(w, 'android', T.x + Math.sin(a) * 1.4 * ring, T.z + Math.cos(a) * 1.4 * ring);
    outside.push(e.id);
  }
  const inShots = [0, 1, 2].map((i) => S.pj.spawnProjectile(w, { owner: 'enemy', kind: 'rocket', x: T.x + (0.3 + 0.1 * i) * ring, z: T.z, vx: 0, vz: 0.1, dmg: 1, life: 20 }));
  const outShot = S.pj.spawnProjectile(w, { owner: 'enemy', kind: 'rocket', x: T.x + 1.5 * ring, z: T.z, vx: 0, vz: 0.1, dmg: 1, life: 20 });
  // positions after spawnEnemy's push-out: re-measure who is actually inside
  const byId = new Map(w.enemies.map((e) => [e.id, e]));
  const inNow = inside.filter((id) => { const e = byId.get(id)!; return Math.hypot(e.x - T.x, e.z - T.z) <= ring; });
  const outNow = outside.filter((id) => { const e = byId.get(id)!; return Math.hypot(e.x - T.x, e.z - T.z) > ring; });
  const eliteHp = eliteE.hp;
  const bossHp = b.hp, bossMeter = b.meter;
  const xpEach = (k: EnemyKind) => S.den.ENEMIES[k].xp;
  const wantXp = inNow.reduce((s, id) => s + xpEach(byId.get(id)!.kind), 0);
  T.autoCd = 99;
  S.pu.spawnPowerup(w, 'demolition', T.x, T.z, true);
  // the collect happens inside this step
  const pk0 = new Set(w.pickups.map((p) => p.id));
  T.autoCd = 99;
  const ev = step(w);
  check(ev.some((e) => e.type === 'powerup' && e.kind === 'demolition'), 'token collected');
  const deadIn = inNow.filter((id) => !byId.get(id)!.alive).length;
  check(deadIn === inNow.length, 'every non-elite within 1.0 × spawnRing dies', `${deadIn}/${inNow.length}`);
  check(outNow.every((id) => byId.get(id)!.alive), 'foes outside the ring survive', `${outNow.length} outside`);
  check(eliteE.alive && Math.abs(eliteE.hp - (eliteHp - POWERUPS.demolitionEliteFrac * eliteE.maxHp)) < 1e-6, `the elite takes ${POWERUPS.demolitionEliteFrac * 100} % of max HP`, `${f1(eliteHp)} → ${f1(eliteE.hp)}`);
  check(inShots.every((p) => !p.alive) && outShot.alive, 'hostile non-boss shots in the ring deleted, the one outside kept');
  check(w.map.demolitionKills === inNow.length, 'map.demolitionKills counts them', `${w.map.demolitionKills}`);
  check(Math.abs((bossHp - b.hp) - POWERUPS.demolitionBossFrac * b.maxHp) < 1e-6, `boss −${POWERUPS.demolitionBossFrac * 100} % of max HP exactly`, `${f1(bossHp - b.hp)} of ${f1(b.maxHp)}`);
  check(Math.abs((b.meter - bossMeter) - POWERUPS.demolitionBossMeter) < 1e-9 || b.meter === 1, `boss meter +${POWERUPS.demolitionBossMeter} exactly`, `${f2(bossMeter)} → ${f2(b.meter)}`);
  const killsNow = ev.filter((e) => e.type === 'enemyKilled').length;
  const perKill = w.pickups.filter((p) => !pk0.has(p.id) && p.kind === 'scrap' && inNow.some((id) => { const e = byId.get(id)!; return p.x === e.x && p.z === e.z; })).length;
  check(perKill === 0 && killsNow >= inNow.length, 'no per-kill scrap spawned at the dead foes on the collect tick (the kills banked)', `${killsNow} kills, ${perKill} scrap at their positions`);
  let maxPer = 0, got = 0;
  for (let i = 0; i < 5; i++) {
    const before = new Set(w.pickups.map((p) => p.id));
    T.autoCd = 99;
    step(w);
    const fresh1 = w.pickups.filter((p) => !before.has(p.id) && p.kind === 'scrap');
    maxPer = Math.max(maxPer, fresh1.length);
    for (const p of fresh1) got += p.xp;
  }
  check(maxPer <= ULT.bankPickupsPerTick, `banked pickups ≤ ${ULT.bankPickupsPerTick} per tick`, `max ${maxPer}`);
  check(Math.abs(got - wantXp) < 1e-6, 'banked XP conserved (normal kill XP, no multiplier)', `${f2(got)} vs ${f2(wantXp)}`);
}

// ─────────────────────────────── J. other effects + spawn rules ───────────────────────────────
function testEffects(): void {
  console.log('\nJ. CLEANUP / RUSH HOUR / BACK PAY, gap + cap');
  const w = fresh('molo', 'lockwater');
  const T = w.titan;
  for (let i = 0; i < 12; i++) S.pk.spawnPickup(w, 'scrap', T.x + 150 + i, T.z + 150, 1, 0);
  for (let i = 0; i < 40; i++) step(w);
  S.pu.spawnPowerup(w, 'cleanup', T.x, T.z, true);
  step(w);
  const far = w.pickups.filter((p) => p.alive && Math.hypot(p.x - T.x, p.z - T.z) > 20);
  check(far.length > 0 ? far.every((p) => p.magnet) : true, 'CLEANUP CREW: every pickup on the map homes in', `${far.length} far pickups, all magnet`);
  const a0 = S.st.stat(w, 'attackRate'), m0 = S.st.stat(w, 'moveSpeed'), s0 = S.st.stat(w, 'smashDamage');
  S.pu.spawnPowerup(w, 'rushHour', T.x, T.z, true);
  step(w);
  const ra = S.st.stat(w, 'attackRate') / a0, rm = S.st.stat(w, 'moveSpeed') / m0, rs = S.st.stat(w, 'smashDamage') / s0;
  check(Math.abs(ra - (1 + POWERUPS.rushAttackRate)) < 1e-6 && Math.abs(rm - (1 + POWERUPS.rushMoveSpeed)) < 1e-6 && Math.abs(rs - (1 + POWERUPS.rushSmash)) < 1e-6,
    'RUSH HOUR: attack speed ×1.5, move speed ×1.2, smash ×2', `${f2(ra)} / ${f2(rm)} / ${f2(rs)}`);
  let ended = false;
  for (let i = 0; i < 30 * 11 && !ended; i++) ended = step(w).some((e) => e.type === 'powerupEnd' && e.kind === 'rushHour');
  step(w); step(w);   // buff timers tick in stepUpgrades; allow the float-rounding tick
  const buffsLeft = w.upgrades.buffs.length;
  check(ended && buffsLeft === 0 && w.map.rushHourT === 0, 'RUSH HOUR ends (powerupEnd) and its buffs lapse', `ended ${ended} · buffs left ${buffsLeft} · attackRate ×${f2(S.st.stat(w, 'attackRate') / a0)}`);
  w.ult.charge = 0; w.ult.ready = false;
  S.pu.spawnPowerup(w, 'backPay', T.x, T.z, true);
  const ev = step(w);
  check(w.ult.charge === ULT.max && w.ult.ready && ev.some((e) => e.type === 'ultCharged'), 'BACK PAY: UPROAR to full');
  // gap + cap
  const g = fresh('molo', 'grideast');
  const a = S.pu.spawnPowerup(g, null, g.titan.x + 50, g.titan.z, false);
  const b2 = S.pu.spawnPowerup(g, null, g.titan.x + 60, g.titan.z, false);
  check(!!a && !b2, `a second random drop inside ${POWERUPS.minGapS} s is refused`);
  for (let i = 0; i < 5; i++) S.pu.spawnPowerup(g, 'cleanup', g.titan.x + 70 + 10 * i, g.titan.z, true);
  const alive = g.map.powerups.filter((p) => p.alive).length;
  check(alive <= POWERUPS.maxAlive, `never more than ${POWERUPS.maxAlive} tokens on the ground (forced drops retire the oldest)`, `${alive}`);
  g.map.lastDropT = -1e9;
  check(S.pu.spawnPowerup(g, null, g.titan.x + 50, g.titan.z, false) === null, 'a random drop at the cap is refused');
}

// ─────────────────────────────── K. full runs ───────────────────────────────
interface RunRec {
  titan: TitanId; biome: BiomeId; seed: number; result: string; endT: number;
  overloadDone: number; overloadSpawn: number; reliefDone: number; reliefSpawn: number; annexSpawn: number; annexDone: number;
  annexOwed: number; breaches: number; powerups: number; collected: number; firstS1Overload: boolean;
  bad: string[];
}
function fullRun(titan: TitanId, biome: BiomeId, seed: number): RunRec {
  const w = S.world.createWorld({ titan, biome, seed });
  const r: RunRec = { titan, biome, seed, result: '', endT: 0, overloadDone: 0, overloadSpawn: 0, reliefDone: 0, reliefSpawn: 0, annexSpawn: 0, annexDone: 0, annexOwed: 0, breaches: 0, powerups: 0, collected: 0, firstS1Overload: false, bad: [] };
  const breachT: number[] = [];
  let lastRandomT = -1e9;
  const pendingXp: { tick: number; xp: number }[] = [];
  const bad = (s: string) => { if (r.bad.length < 8) r.bad.push(s); };
  const cfgB = S.dobj.OBJECTIVE_BIOME[biome];
  while (!w.run.result && w.t < 900) {
    while (S.draft.hasPendingDraft(w)) {
      const off = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : S.draft.rollOffer(w, w.upgrades.chestDrafts > 0);
      S.draft.pickUpgrade(w, S.bot.botPickUpgrade(w, off));
    }
    S.world.stepWorld(w, S.bot.botInput(w));
    const ev = w.events;
    const ring = S.dir.spawnRing(w);
    const T = w.titan;
    const credited = (type: string, id: number) => ev.some((e) => e.type === type && (e as { id?: number }).id === id && !(e as { noCredit?: boolean }).noCredit);
    // expected OVERLOAD XP pickups owed this tick
    for (let i = pendingXp.length - 1; i >= 0; i--) {
      const q = pendingXp[i];
      if (w.tick === q.tick) {
        const ok = ev.some((e) => e.type === 'pickup' && e.kind === 'scrap' && Math.abs(e.xp - q.xp) < 1e-6);
        const full = w.pickups.filter((p) => p.alive).length >= 590;
        if (!ok && !full) bad(`OVERLOAD XP ${f2(q.xp)} not collected the next tick (t ${f1(w.t)})`);
        pendingXp.splice(i, 1);
      }
    }
    let elite = false, overloadDoneTick = false;
    for (const e of ev) {
      if (e.type === 'enemyKilled' && e.kind === 'elite') elite = true;
      if (e.type === 'objectiveDone' && e.kind === 'overloadSite') overloadDoneTick = true;
    }
    for (const e of ev) {
      switch (e.type) {
        case 'rankUp': r.breaches++; breachT.push(w.t); break;
        case 'objectiveSpawn': {
          const o = w.map.objectives.find((q) => q.id === e.id);
          if (!o) { bad(`objectiveSpawn ${e.id} not in map.objectives`); break; }
          const d = Math.hypot(o.x - T.x, o.z - T.z) / ring;
          if (e.kind === 'overloadSite') {
            r.overloadSpawn++;
            if (o.rank === 0) {
              const p: Prop = w.city.props[o.targetId];
              if (o.target !== 'prop' || !p || p.lane !== -1 || !cfgB.overloadPropsS1.includes(p.kind)) bad(`Size I OVERLOAD not on a static listed prop (${o.target} ${p?.kind})`);
              if (d < OBJECTIVES.overload.bandMin - 1e-6 || d > OBJECTIVES.overload.bandMax + 1e-6) bad(`Size I OVERLOAD at ${f2(d)} × ring`);
              if (!r.firstS1Overload) r.firstS1Overload = true;
            } else {
              const b: Building = w.city.buildings[o.targetId];
              const can = RANKS[o.rank].canFlatten;
              if (o.target !== 'building' || !b || (b.tier !== can && b.tier !== can - 1)) bad(`Size ${o.rank + 1} OVERLOAD tier ${b?.tier} vs canFlatten ${can}`);
              if (d < OBJECTIVES.overload.bandMin - 1e-6 || d > OBJECTIVES.overload.bandMax + 1e-6) bad(`OVERLOAD at ${f2(d)} × ring`);
            }
          } else if (e.kind === 'recordsAnnex') {
            r.annexSpawn++;
            const b: Building = w.city.buildings[o.targetId];
            const can = RANKS[o.rank].canFlatten;
            if (o.target !== 'building' || !b || (b.tier !== can && b.tier !== can - 1)) bad(`ANNEX tier ${b?.tier} vs canFlatten ${can}`);
            if (d < OBJECTIVES.annex.bandMin - 1e-6 || d > OBJECTIVES.annex.bandMax + 1e-6) bad(`ANNEX at ${f2(d)} × ring`);
          } else {
            r.reliefSpawn++;
            if (o.target !== 'none') bad('RELIEF bound to a target');
            if (d < OBJECTIVES.relief.bandMin - 1e-6 || d > OBJECTIVES.relief.bandMax + 1e-6) bad(`RELIEF at ${f2(d)} × ring`);
          }
          break;
        }
        case 'objectiveDone': {
          const o = w.map.objectives.find((q) => q.id === e.id);
          if (o && o.target === 'building' && !credited('buildingCollapse', o.targetId)) bad(`building objective ${o.id} done without a credited collapse that tick`);
          if (o && o.target === 'prop' && !credited('propDestroyed', o.targetId)) bad(`prop objective ${o.id} done without a credited propDestroyed that tick`);
          if (e.kind === 'overloadSite') {
            r.overloadDone++;
            if (T.alive) pendingXp.push({ tick: w.tick + 1, xp: S.obj.MAP_TUNE.overloadXpFrac * xpToNext(T.level) });
          } else if (e.kind === 'reliefDepot') r.reliefDone++;
          else r.annexDone++;
          break;
        }
        case 'powerupSpawn': {
          r.powerups++;
          const forced = elite || overloadDoneTick;
          if (!forced) {
            if (w.t - lastRandomT < POWERUPS.minGapS - 1e-6) bad(`random drops ${f1(w.t - lastRandomT)} s apart`);
            lastRandomT = w.t;
          }
          break;
        }
        case 'powerup': r.collected++; break;
        default: break;
      }
    }
    // pendingXp level taken at done-tick is AFTER this tick's level-ups; re-evaluate next tick with ±
    // tolerance by matching on the recorded value only (a level-up earlier in the done tick is fine)
    const alivePU = w.map.powerups.filter((p) => p.alive).length;
    if (alivePU > POWERUPS.maxAlive) bad(`${alivePU} power-ups alive`);
    for (const o of w.map.objectives) {
      if (!o.alive) continue;
      if (o.target === 'building') { const b = w.city.buildings[o.targetId]; if (!b || b.collapsed) bad(`objective ${o.id} alive on a collapsed building`); }
      if (o.target === 'prop') { const p = w.city.props[o.targetId]; if (!p || !p.alive) bad(`objective ${o.id} alive on a dead prop`); }
    }
  }
  r.result = w.run.result ?? 'timeout';
  r.endT = w.run.result ? w.run.endT : w.t;
  const retry = S.obj.MAP_TUNE.retryS;
  for (const t of breachT) if (t + OBJECTIVES.annex.delayAfterBreachS + 2 * retry < r.endT) r.annexOwed++;
  return r;
}

function testFullRuns(): void {
  console.log('\nK. full runs (gate bot + bot_map detours, fresh meta)');
  const seeds = [1337, 7, 42, 2024, 99];
  const recs: RunRec[] = [];
  for (const biome of BIOME_IDS) {
    for (let i = 0; i < seeds.length; i++) {
      const titan = TITAN_IDS[i % TITAN_IDS.length];
      const r = fullRun(titan, biome, seeds[i]);
      recs.push(r);
      console.log(`    ${biome.padEnd(11)} ${titan.padEnd(10)} seed ${String(seeds[i]).padEnd(5)} ${r.result.padEnd(5)} @${r.endT.toFixed(0).padStart(4)}s  OVERLOAD ${r.overloadDone}/${r.overloadSpawn}  RELIEF ${r.reliefDone}/${r.reliefSpawn}  ANNEX ${r.annexDone}/${r.annexSpawn} (owed ${r.annexOwed}, breaches ${r.breaches})  power-ups ${r.powerups} (collected ${r.collected})${r.bad.length ? '  BAD: ' + r.bad.join(' | ') : ''}`);
    }
  }
  for (const biome of BIOME_IDS) {
    const rs = recs.filter((r) => r.biome === biome);
    const mo = median(rs.map((r) => r.overloadDone)), mp = median(rs.map((r) => r.powerups));
    const mr = median(rs.map((r) => r.reliefDone)), ma = median(rs.map((r) => r.annexSpawn));
    console.log(`  ${biome}: medians OVERLOAD done ${mo} (placed ${median(rs.map((r) => r.overloadSpawn))}) · RELIEF done ${mr} (placed ${median(rs.map((r) => r.reliefSpawn))}) · ANNEX placed ${ma} (done ${median(rs.map((r) => r.annexDone))}) · power-ups ${mp} (collected ${median(rs.map((r) => r.collected))})`);
    check(rs.every((r) => r.firstS1Overload), `${biome}: an OVERLOAD SITE placed in Size I on all ${rs.length} seeds`);
    check(mo >= 5 && mo <= 12, `${biome}: OVERLOAD SITE median 5–12 per run`, `${mo}`);
    check(mp >= 4 && mp <= 12, `${biome}: power-up median 4–12 per run`, `${mp}`);
    check(rs.every((r) => r.annexSpawn >= r.annexOwed && r.annexSpawn <= Math.max(0, r.breaches)), `${biome}: ANNEX placed = breaches reached (every one owed before the run ended)`,
      rs.map((r) => `${r.annexSpawn}/${r.annexOwed}/${r.breaches}`).join(' '));
    check(rs.every((r) => r.bad.length === 0), `${biome}: placement bands/tiers, credited completions, next-tick XP, gap, cap, no stuck objective`);
  }
}

// ─────────────────────────────── L. determinism ───────────────────────────────
function digest(w: World): string {
  let h = 2166136261 >>> 0;
  const num = (x: number) => { const s = Number.isFinite(x) ? x.toFixed(6) : String(x); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  const m = w.map;
  num(w.tick); num(w.titan.x); num(w.titan.z); num(w.titan.hp); num(w.titan.level); num(w.titan.xp); num(w.nextId);
  for (const o of m.objectives) { num(o.id); num(o.x); num(o.z); num(o.t); num(o.targetId); num(o.alive ? 1 : 0); }
  for (const p of m.powerups) { num(p.id); num(p.x); num(p.z); num(p.t); num(p.alive ? 1 : 0); num(['cleanup', 'demolition', 'redLight', 'rushHour', 'backPay'].indexOf(p.kind as PowerUpKind)); }
  num(m.nextOverloadT); num(m.nextReliefT); num(m.lastDropT); num(m.redLightT); num(m.rushHourT);
  num(m.overloadsDone); num(m.reliefsDone); num(m.annexesDone); num(m.overloadXp); num(m.demolitionKills);
  for (const t of m.annexDue) num(t);
  return (h >>> 0).toString(16).padStart(8, '0');
}
function testDeterminism(): void {
  console.log('\nL. determinism');
  const run = (): string[] => {
    const w = S.world.createWorld({ titan: 'voltkite', biome: 'grideast', seed: 1337 });
    const out: string[] = [];
    while (!w.run.result && w.t < 300) {
      while (S.draft.hasPendingDraft(w)) {
        const off = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : S.draft.rollOffer(w, w.upgrades.chestDrafts > 0);
        S.draft.pickUpgrade(w, S.bot.botPickUpgrade(w, off));
      }
      S.world.stepWorld(w, S.bot.botInput(w));
      if (w.tick % 900 === 0) out.push(digest(w));
    }
    out.push(digest(w));
    return out;
  };
  const a = run(), b = run();
  check(a.length > 5 && a.join() === b.join(), `same seed twice ⇒ identical map + titan digests at ${a.length} checkpoints`, a[a.length - 1]);
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<void> {
  const err = await load();
  if (err) { console.error('could not load the sim:\n' + err); process.exit(2); }
  const quick = process.argv.includes('--quick');
  console.log(`BLOCKTOOTH probe_map — objectives + power-ups (L4). MAP_TUNE ${JSON.stringify(S.obj.MAP_TUNE)}`);
  console.log(`  PU_TUNE dropByKill ${JSON.stringify(S.pu.PU_TUNE.dropByKill)} · dropByCollapse ${S.pu.PU_TUNE.dropByCollapse} · weights ${JSON.stringify(S.pu.PU_TUNE.weights)}`);
  const t0 = performance.now();
  const tests: [string, () => void][] = [
    ['B', testOverloadPayout], ['M', testPlaceNear], ['C', testRelief], ['D', testAnnex], ['E', testTriggerShockwave], ['F', testTriggerKillDrop],
    ['G', testExpiry], ['H', testRedLight], ['I', testDemolition], ['J', testEffects], ['L', testDeterminism],
  ];
  if (!quick) tests.push(['K', testFullRuns]);
  for (const [name, fn] of tests) {
    try { fn(); } catch (e) { check(false, `${name} threw`, (e as Error)?.stack ?? String(e)); }
  }
  console.log(`\n${passes} passed · ${fails} failed · wall ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (fails) { console.log('\nFAILURES:'); for (const l of failLines) console.log(l); console.log('\nPROBE_MAP: FAIL'); process.exit(1); }
  console.log('\nPROBE_MAP: PASS');
}
main();
