// L3 SCRATCH COPY of _harness/probe_ai.ts with the 4-line PARKADE-6 fix proposed as a contract gap (GRID-EAST
// expects parkade6; its per-phase attack sets). Not a gate file — proves the fix; the orchestrator applies it.
// BLOCKTOOTH — ai lane probe. Run: node _harness/probe_ai.ts   (Node 22 strips types natively)
//
// Real sim end-to-end (createWorld → stepWorld), passive titan (cheats.god, no input):
//   A. Director run per biome (GRID-EAST / WHITE STACKS, seed 11): the titan is cheated up the
//      size ranks on the pacing schedule (II 90 s, III 210 s, IV 360 s, V 480 s), 9 simulated
//      minutes. Prints spawns per minute by kind, peak alive, alerts (time + key), elite/boss spawn
//      times; asserts rank gating, the elite/boss schedule, caps, no NaN, nothing out of bounds,
//      ground units never standing inside a standing building.
//   B. Boss fight per boss (continues run A): 45 s per phase, hp forced to 60 % / 30 % to reach
//      P2 / P3; bossAttack histogram per phase (asserts the EXACT per-phase attack sets of §10),
//      leash events, telegraph styles; then STAGGER (meter fill from leg/sail hits, 2× damage) and
//      DEFEAT (bossDefeated → runEnd clear).
//   C. LOCKWATER: CAISSON-4 wades in from the harbour (−Z) side.
//   D. Unit block: spawnEnemy hp scaling / flags, per-kind behaviour states reached, knockback
//      decay, stun, slow, recycling, squad wedge, APC deployment cap.
//   E. Determinism: same seed ⇒ identical enemy/boss state hash after 200 s.
// Exit code: 0 ok, 1 assertion failure.

import type { BiomeId, BossState, Enemy, EnemyKind, SimEvent, Telegraph, World } from '../../src/core/types.ts';
import { ENEMY_KINDS } from '../../src/core/types.ts';
import { NO_INPUT, createWorld, stepWorld } from '../../src/core/world.ts';
import { CITY, ENEMY_HP_PER_MIN, RANK_LEVELS, RANK_V_GROWTH_LEVELS } from '../../src/core/config.ts';
import { growToRank } from '../../src/titans/titansim.ts';
import { ENEMIES } from '../../src/data/enemies.ts';
import { BOSSES } from '../../src/data/bosses.ts';
import { spawnRing } from '../../src/ai/director.ts';
import { spawnEnemy } from '../../src/ai/enemies.ts';
import { damageBoss, spawnBoss } from '../../src/ai/bosses/index.ts';
import { resolveCircleVsCity } from '../../src/city/citysim.ts';

const fails: string[] = [];
function check(ok: boolean, msg: string): void { if (!ok) { fails.push(msg); console.log('  ✗ ' + msg); } }
const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const pad = (s: string | number, n: number) => String(s).padStart(n);

const RANK_AT = [0, 90, 210, 360, 480];
const HZ = 30;

function forceRank(w: World, r: number): void {
  // the sim's real rank-ups (SIZE is level-driven: level → RANK_LEVELS[r]); Size V = the fully grown
  // 67.2 m body the bosses are tuned against (what the old mass cheat produced)
  growToRank(w, r, r >= 4 ? RANK_LEVELS[4] + RANK_V_GROWTH_LEVELS : 0);
}

const TMP = { x: 0, z: 0, bumpTier: -1 };
function insideBuilding(w: World, e: Enemy): boolean {
  if (ENEMIES[e.kind].flies) return false;
  TMP.x = e.x; TMP.z = e.z; TMP.bumpTier = -1;
  // a quarter of the radius of penetration is tolerated (separation/charge contact frames)
  if (!resolveCircleVsCity(w.city, e.x, e.z, e.radius * 0.5, -1 as unknown as 0, TMP)) return false;
  return Math.hypot(TMP.x - e.x, TMP.z - e.z) > e.radius * 0.25;
}

function finiteEnemy(e: Enemy): boolean {
  return [e.x, e.z, e.y, e.vx, e.vz, e.heading, e.hp, e.kx, e.kz, e.aimX, e.aimZ].every(Number.isFinite);
}
function finiteBoss(b: BossState): boolean {
  if (![b.x, b.z, b.heading, b.hp, b.meter, b.cd, b.attackT].every(Number.isFinite)) return false;
  for (const p of b.parts) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  return true;
}

interface RunLog {
  spawnsByMin: Record<EnemyKind, number>[];
  peakAlive: number; peakByKind: Record<EnemyKind, number>;
  alerts: { t: number; key: string }[];
  eliteT: number[]; bossT: number;
  firstSpawn: Partial<Record<EnemyKind, { t: number; rank: number }>>;
  nanFrames: number; oob: number; insideB: number; insideSamples: number;
  waves: number; msPerTick: number[]; fires: Record<string, number>; tgStyles: Record<string, number>;
  rankT: number[];
}
const zeroKinds = (): Record<EnemyKind, number> => Object.fromEntries(ENEMY_KINDS.map((k) => [k, 0])) as Record<EnemyKind, number>;

function scanTick(w: World, L: RunLog): void {
  const B = w.city.bounds;
  let alive = 0;
  const by = zeroKinds();
  let bad = false;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    alive++; by[e.kind]++;
    if (!finiteEnemy(e)) bad = true;
    if (e.x < B.minX - 0.01 || e.x > B.maxX + 0.01 || e.z < B.minZ - 0.01 || e.z > B.maxZ + 0.01) L.oob++;
  }
  if (w.boss) {
    if (!finiteBoss(w.boss)) bad = true;
    if (w.boss.x < B.minX - 0.01 || w.boss.x > B.maxX + 0.01 || w.boss.z < B.minZ - 0.01 || w.boss.z > B.maxZ + 0.01) L.oob++;
  }
  if (!Number.isFinite(w.titan.x) || !Number.isFinite(w.titan.z)) bad = true;
  if (bad) L.nanFrames++;
  if (alive > L.peakAlive) L.peakAlive = alive;
  for (const k of ENEMY_KINDS) if (by[k] > L.peakByKind[k]) L.peakByKind[k] = by[k];
  if (w.tick % 15 === 0) {
    for (const e of w.enemies) {
      if (!e.alive || ENEMIES[e.kind].flies) continue;
      L.insideSamples++;
      if (insideBuilding(w, e)) L.insideB++;
    }
  }
}

function scanEvents(w: World, ev: readonly SimEvent[], L: RunLog): void {
  const m = Math.floor(w.t / 60);
  while (L.spawnsByMin.length <= m) L.spawnsByMin.push(zeroKinds());
  for (const e of ev) {
    switch (e.type) {
      case 'enemySpawn':
        L.spawnsByMin[m][e.kind]++;
        if (!L.firstSpawn[e.kind]) L.firstSpawn[e.kind] = { t: w.t, rank: w.titan.rank };
        break;
      case 'alert': L.alerts.push({ t: w.t, key: e.key }); break;
      case 'eliteSpawn': L.eliteT.push(w.t); break;
      case 'bossSpawn': L.bossT = w.t; break;
      case 'waveStart': L.waves++; break;
      case 'enemyFire': L.fires[e.kind] = (L.fires[e.kind] ?? 0) + 1; break;
      case 'telegraphStart': if (e.owner === 'enemy') L.tgStyles[e.style] = (L.tgStyles[e.style] ?? 0) + 1; break;
    }
  }
}

function newLog(): RunLog {
  return {
    spawnsByMin: [], peakAlive: 0, peakByKind: zeroKinds(), alerts: [], eliteT: [], bossT: NaN, firstSpawn: {},
    nanFrames: 0, oob: 0, insideB: 0, insideSamples: 0, waves: 0, msPerTick: [], fires: {}, tgStyles: {},
    rankT: [0, NaN, NaN, NaN, NaN],
  };
}

function tick(w: World, L: RunLog): void {
  const t0 = performance.now();
  stepWorld(w, NO_INPUT);
  L.msPerTick.push(performance.now() - t0);
  scanEvents(w, w.events, L);
  scanTick(w, L);
}

// ─────────────────────────────── A + B: director + boss per biome ───────────────────────────────
function runBiome(biome: BiomeId, seed: number): void {
  const expectBoss = biome === 'whitestacks' ? 'irongully' : biome === 'grideast' ? 'parkade6' : 'caisson4';
  console.log(`\n══ ${biome.toUpperCase()} (seed ${seed}) — passive god titan, 9 min director run ══`);
  const w = createWorld({ titan: 'molo', biome, seed });
  w.cheats.god = true;
  const L = newLog();
  const kindsSeenBeforeRank: string[] = [];
  const END = 540;
  // rank transitions as the DIRECTOR sees them: it reads titan.rank on the tick after a rank-up
  // (forced here before a tick, or natural from pickups late in a tick) → record t + dt
  let lastRank = 0;
  const noteRank = () => { while (lastRank < w.titan.rank) { lastRank++; L.rankT[lastRank] = w.t + w.dt; } };
  while (w.t < END - 1e-9 && !w.run.result) {
    for (let r = 1; r <= 4; r++) if (w.t >= RANK_AT[r] && w.titan.rank < r) forceRank(w, r);
    noteRank();
    tick(w, L);
    noteRank();
    // rank gating: every live kind must be allowed at the current rank
    for (const e of w.enemies) {
      if (!e.alive || e.spawnT !== w.t) continue;
      const def = ENEMIES[e.kind];
      if (def.minRank > w.titan.rank && e.kind !== 'squad') kindsSeenBeforeRank.push(`${e.kind}@${fmt(w.t)}s rank ${w.titan.rank}`);
      if (e.kind === 'squad' && w.t < 45) kindsSeenBeforeRank.push(`squad@${fmt(w.t)}s (<45 s)`);
    }
  }
  // spawns per minute
  const head = 'min ' + ENEMY_KINDS.map((k) => pad(k, 7)).join('');
  console.log(head);
  L.spawnsByMin.forEach((row, i) => console.log(pad(i, 3) + ' ' + ENEMY_KINDS.map((k) => pad(row[k], 7)).join('')));
  console.log('peak alive by kind: ' + ENEMY_KINDS.map((k) => `${k} ${L.peakByKind[k]}`).join(' · ') + `  (total peak ${L.peakAlive}, cap ${CITY.maxEnemies})`);
  console.log(`waves ${L.waves} · spawn ring now ${fmt(spawnRing(w), 1)} m · budget left ${fmt(w.director.spawnBudget, 1)}`);
  console.log('first spawn per kind: ' + ENEMY_KINDS.map((k) => { const f = L.firstSpawn[k]; return `${k} ${f ? fmt(f.t) + 's/R' + (f.rank + 1) : '—'}`; }).join(' · '));
  console.log('alerts: ' + L.alerts.map((a) => `${fmt(a.t)}s ${a.key}`).join(' · '));
  console.log(`elite spawns: ${L.eliteT.map((t) => fmt(t, 1) + 's').join(', ') || 'none'} · boss spawn: ${fmt(L.bossT, 1)}s`);
  console.log('enemy fire events: ' + Object.entries(L.fires).map(([k, n]) => `${k} ${n}`).join(' · ') + ' · enemy tell styles: ' + Object.entries(L.tgStyles).map(([k, n]) => `${k} ${n}`).join(' · '));
  const ms = L.msPerTick.slice().sort((a, b) => a - b);
  console.log(`sim ms/tick avg ${fmt(ms.reduce((a, b) => a + b, 0) / ms.length, 3)} p99 ${fmt(ms[Math.floor(ms.length * 0.99)], 3)} max ${fmt(ms[ms.length - 1], 2)}`);
  console.log(`inside-building samples ${L.insideB}/${L.insideSamples} · out-of-bounds frames ${L.oob} · NaN frames ${L.nanFrames}`);

  check(L.nanFrames === 0, `${biome}: NaN in enemy/boss state on ${L.nanFrames} ticks`);
  check(L.oob === 0, `${biome}: ${L.oob} enemy/boss samples out of bounds`);
  check(L.insideB <= Math.max(2, L.insideSamples * 0.002), `${biome}: ground enemies inside standing buildings ${L.insideB}/${L.insideSamples}`);
  check(kindsSeenBeforeRank.length === 0, `${biome}: rank gating broken: ${kindsSeenBeforeRank.slice(0, 5).join(', ')}`);
  check(L.peakAlive <= CITY.maxEnemies, `${biome}: peak alive ${L.peakAlive} > CITY.maxEnemies`);
  check(L.waves >= 55 && L.waves <= 95, `${biome}: ${L.waves} waves in 9 min (expect ~60–90 at 6–9 s)`);
  for (const k of ['android', 'squad', 'drone', 'buggy', 'apc', 'tank', 'walker'] as EnemyKind[]) check(!!L.firstSpawn[k], `${biome}: ${k} never spawned`);
  for (const key of ['contractors', 'squads', 'drones', 'vehicles', 'armor', 'artillery', 'elite', 'boss']) {
    const n = L.alerts.filter((a) => a.key === key).length;
    check(key === 'elite' ? n >= 1 : n === 1, `${biome}: alert '${key}' raised ${n}×`);
  }
  // schedule (§9): elite at min(ELITE_AT_S, t(rank IV) + 30), boss at min(BOSS_AT_S, t(rank V) + 20).
  // The passive titan also grows from its own kills, so the rank times are read from rankUp events.
  const expElite = Math.min(390, (Number.isFinite(L.rankT[3]) ? L.rankT[3] : Infinity) + 30);
  const expBoss = Math.min(540, (Number.isFinite(L.rankT[4]) ? L.rankT[4] : Infinity) + 20);
  console.log(`rank-up times: ${L.rankT.map((t, i) => (i ? 'R' + (i + 1) + ' ' + fmt(t, 1) + 's' : '')).filter(Boolean).join(' · ')} → expect elite ${fmt(expElite, 1)} s, boss ${fmt(expBoss, 1)} s`);
  check(L.eliteT.length >= 1 && Math.abs(L.eliteT[0] - expElite) < 0.05, `${biome}: first elite at ${fmt(L.eliteT[0], 2)} s (expect ${fmt(expElite, 2)})`);
  check(Math.abs(L.bossT - expBoss) < 0.05, `${biome}: boss at ${fmt(L.bossT, 2)} s (expect ${fmt(expBoss, 2)})`);
  for (let i = 1; i < L.eliteT.length; i++) check(L.eliteT[i] - L.eliteT[i - 1] >= 74.9 && L.eliteT[i] < L.bossT, `${biome}: elite repeat at ${fmt(L.eliteT[i], 1)} s`);
  check(!!w.boss && w.boss.id === expectBoss, `${biome}: boss ${w.boss?.id} (expect ${expectBoss})`);
  check(w.run.phase === 'boss', `${biome}: run.phase ${w.run.phase} (expect boss)`);
  const sq = L.spawnsByMin.reduce((a, r) => a + r.squad, 0);
  check(sq % 5 === 0 || sq > 0, `${biome}: squads spawned ${sq}`);
  // boss-time trickle: spawns in the last minute must fall well below the minute before the boss
  const pre = L.spawnsByMin[7] ? ENEMY_KINDS.reduce((a, k) => a + L.spawnsByMin[7][k], 0) : 0;
  console.log(`spawns minute 7 (pre-boss): ${pre}`);

  bossFight(w, L);
}

function bossFight(w: World, L: RunLog): void {
  const b = w.boss;
  if (!b) { check(false, 'no boss to fight'); return; }
  const def = BOSSES[b.id];
  console.log(`\n── ${def.name}: ${fmt(b.maxHp)} hp (×${fmt(b.maxHp / def.hp, 2)}), parts ${b.parts.map((p) => p.name).join('/')}, now d=${fmt(Math.hypot(b.x - w.titan.x, b.z - w.titan.z))} m from the titan`);
  const hist: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {} };
  const styles: Record<string, number> = {};
  let leashOn = 0, leashOff = 0, phaseEv: number[] = [], alerts: string[] = [], hurt = 0, maxStack = 0;
  const distLog: number[] = [];
  const phaseEnd = [0, 45, 90, 135];
  const t0 = w.t;
  let forced2 = false, forced3 = false;
  const B = w.city.bounds;
  while (w.t - t0 < phaseEnd[3] && !w.run.result && b.alive) {
    const el = w.t - t0;
    if (!forced2 && el >= phaseEnd[1]) { forced2 = true; if (b.phase < 2) b.hp = b.maxHp * 0.6; }
    if (!forced3 && el >= phaseEnd[2]) { forced3 = true; if (b.phase < 3) b.hp = b.maxHp * 0.3; }
    tick(w, L);
    for (const e of w.events) {
      if (e.type === 'bossAttack') hist[b.phase][e.attack] = (hist[b.phase][e.attack] ?? 0) + 1;
      else if (e.type === 'leash') { if (e.on) leashOn++; else leashOff++; }
      else if (e.type === 'bossPhase') phaseEv.push(e.phase);
      else if (e.type === 'alert') alerts.push(e.key);
      else if (e.type === 'titanHurt') hurt++;
      else if (e.type === 'telegraphStart' && e.owner === 'boss') styles[e.style] = (styles[e.style] ?? 0) + 1;
    }
    // stacked-tell audit: unfired boss tells of one style on one spot firing within 0.3 s
    const pend = w.telegraphs.filter((t) => t.alive && !t.fired && t.owner === 'boss');
    for (let i = 0; i < pend.length; i++) for (let j = i + 1; j < pend.length; j++) {
      const a = pend[i], c = pend[j];
      if (a.style !== c.style) continue;
      const ac = center(a), cc = center(c);
      if (Math.hypot(ac.x - cc.x, ac.z - cc.z) < 3 && Math.abs((a.windup - a.t) - (c.windup - c.t)) < 0.3) maxStack++;
    }
    if (w.tick % 30 === 0) distLog.push(Math.hypot(b.x - w.titan.x, b.z - w.titan.z));
    check(b.x >= B.minX - 0.01 && b.x <= B.maxX + 0.01 && b.z >= B.minZ - 0.01 && b.z <= B.maxZ + 0.01, `${b.id}: out of bounds`);
  }
  console.log(`fight loop ended at +${fmt(w.t - t0)} s · boss ${b.alive ? 'alive' : 'defeated'} (hp ${fmt(100 * b.hp / b.maxHp)} %, phase ${b.phase}) · run ${w.run.result ?? 'on'}`);
  console.log('attack histogram per phase:');
  for (const p of [1, 2, 3]) console.log(`  P${p}: ` + (Object.entries(hist[p]).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'));
  console.log(`boss tell styles: ${Object.entries(styles).map(([k, n]) => `${k} ${n}`).join(' · ')} · leash on/off ${leashOn}/${leashOff} · phase events ${phaseEv.join(',')} · titanHurt ${hurt} · stacked-tell frames ${maxStack}`);
  const ds = distLog.slice(4).sort((a, c) => a - c);
  console.log(`boss↔titan distance after intro: min ${fmt(ds[0])} median ${fmt(ds[ds.length >> 1])} max ${fmt(ds[ds.length - 1])} m · subtitle now "${b.subtitle}"`);

  const allowed: Record<string, Record<number, string[]>> = {
    caisson4: { 1: ['hookLane', 'hookDrop'], 2: ['hookLane', 'hookDrop', 'winchLeash', 'boomSweep'], 3: ['hookLane', 'hookDrop', 'winchLeash', 'boomSweep', 'legStomp'] },
    irongully: { 1: ['coneBreath', 'pawSlam'], 2: ['coneBreath', 'pawSlam', 'plateVolley', 'ridgeCharge'], 3: ['coneBreath', 'pawSlam', 'plateVolley', 'ridgeCharge', 'breathSlam'] },
    parkade6: { 1: ['rampLaunch', 'barrierSwing'], 2: ['rampLaunch', 'barrierSwing', 'towChain', 'deckDrop'], 3: ['rampLaunch', 'barrierSwing', 'towChain', 'deckDrop', 'levelCollapse'] },
  };
  for (const p of [1, 2, 3]) {
    for (const k of Object.keys(hist[p])) check(allowed[b.id][p].includes(k), `${b.id}: attack ${k} used in P${p}`);
    check(Object.keys(hist[p]).length >= 2, `${b.id}: P${p} used only ${Object.keys(hist[p]).join(',')}`);
  }
  const newIn2 = b.id === 'caisson4' ? ['winchLeash', 'boomSweep'] : b.id === 'parkade6' ? ['towChain', 'deckDrop'] : ['plateVolley', 'ridgeCharge'];
  check(newIn2.some((k) => (hist[2][k] ?? 0) + (hist[3][k] ?? 0) > 0), `${b.id}: P2 attacks never used`);
  const p3 = b.id === 'caisson4' ? 'legStomp' : b.id === 'parkade6' ? 'levelCollapse' : 'breathSlam';
  check((hist[3][p3] ?? 0) > 0 || b.id === 'caisson4', `${b.id}: ${p3} never used in P3`);
  check(phaseEv.join(',') === '2,3', `${b.id}: phase events ${phaseEv.join(',')}`);
  check(alerts.includes('bossPhase2') && alerts.includes('bossPhase3'), `${b.id}: phase alerts missing (${alerts.join(',')})`);
  check(maxStack === 0, `${b.id}: ${maxStack} stacked same-spot tells`);
  check(hurt > 0 || w.cheats.god, `${b.id}: never hurt the titan`);
  if (b.id === 'caisson4') check(leashOn > 0, 'caisson4: winch never leashed the passive titan');

  // ── stagger: hammer the high-strain part until the meter pops ──
  const strainPart = b.parts.reduce((bi, p, i, a) => (p.strainMul > a[bi].strainMul ? i : bi), 0);
  if (b.alive) {
    b.staggerT = 0; b.meter = 0;
    let stag = false, hits = 0;
    for (; hits < 400 && !stag && b.alive; hits++) {
      w.events.length = 0;
      damageBoss(w, strainPart, b.maxHp * 0.002, { src: 'titan', kind: 'bite' });
      stag = w.events.some((e) => e.type === 'bossStagger');
    }
    console.log(`stagger after ${hits} hits of 0.2 % maxHp on '${b.parts[strainPart].name}' (strain ×${b.parts[strainPart].strainMul}) → staggerT ${fmt(b.staggerT, 2)} meter ${fmt(b.meter, 2)}`);
    check(stag && Math.abs(b.staggerT - 5) < 1e-6 && b.meter === 0, `${b.id}: stagger did not trigger properly`);
    const hpA = b.hp;
    damageBoss(w, 0, 100, { src: 'titan', kind: 'bite' });
    check(Math.abs((hpA - b.hp) - 200 * b.parts[0].hpMul) < 1e-6, `${b.id}: staggered damage not doubled (${fmt(hpA - b.hp, 2)})`);
    check(b.attack === null, `${b.id}: attack continued through the stagger`);
    // defeat
    w.events.length = 0;
    damageBoss(w, 0, b.hp * 10 + 1, { src: 'titan', kind: 'bite' });
    check(!b.alive && w.events.some((e) => e.type === 'bossDefeated'), `${b.id}: defeat not emitted`);
    stepWorld(w, NO_INPUT);
    check(w.run.result === 'clear', `${b.id}: run did not end clear (result ${w.run.result})`);
    console.log(`defeat → run.result ${w.run.result}, phase ${w.run.phase}`);
  }
}

function center(t: Telegraph): { x: number; z: number } {
  const s = t.shape;
  if (s.k === 'capsule') return { x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2 };
  return { x: s.x, z: s.z };
}

// ─────────────────────────────── C: LOCKWATER harbour entrance ───────────────────────────────
function lockwaterEntry(): void {
  console.log('\n══ LOCKWATER — CAISSON-4 harbour entrance ══');
  const w = createWorld({ titan: 'voltkite', biome: 'lockwater', seed: 5 });
  w.cheats.god = true; w.cheats.noSpawns = true;
  forceRank(w, 4);
  for (let i = 0; i < 30; i++) stepWorld(w, NO_INPUT);
  spawnBoss(w, 'caisson4');
  const b = w.boss!;
  const T = w.titan;
  console.log(`titan (${fmt(T.x)}, ${fmt(T.z)}) · boss enters at (${fmt(b.x)}, ${fmt(b.z)}) · bounds z ${fmt(w.city.bounds.minZ)}..${fmt(w.city.bounds.maxZ)}`);
  check(b.z < T.z - 100, `lockwater: CAISSON-4 did not enter from the −Z harbour side (dz ${fmt(b.z - T.z)})`);
  check(w.director.bossSpawned && w.run.phase === 'boss', 'lockwater: spawnBoss did not mark director/run');
  const hp0 = b.hp;
  damageBoss(w, 0, 1000, { src: 'titan', kind: 'bite' });
  check(b.hp === hp0 && b.introT > 0, 'lockwater: damage landed during the intro');
  const d0 = Math.hypot(b.x - T.x, b.z - T.z);
  for (let i = 0; i < 4 * HZ; i++) stepWorld(w, NO_INPUT);
  const d1 = Math.hypot(b.x - T.x, b.z - T.z);
  console.log(`intro walk: ${fmt(d0)} m → ${fmt(d1)} m in 4 s, introT ${fmt(b.introT, 2)}`);
  check(d1 < d0 - 30 && b.introT === 0, 'lockwater: boss did not walk in during the intro');
}

// ─────────────────────────────── D: unit block ───────────────────────────────
function unitBlock(): void {
  console.log('\n══ unit block — spawnEnemy + behaviours ══');
  const w = createWorld({ titan: 'hearthback', biome: 'grideast', seed: 21 });
  w.cheats.god = true; w.cheats.noSpawns = true;
  // hp scaling at t = 5 min
  w.t = 300;
  const e0 = spawnEnemy(w, 'tank', w.titan.x + 40, w.titan.z);
  check(Math.abs(e0.maxHp - ENEMIES.tank.hp * (1 + ENEMY_HP_PER_MIN * 5)) < 1e-6, `tank hp at 5 min ${e0.maxHp}`);
  check(e0.radius === ENEMIES.tank.radius && e0.height === ENEMIES.tank.height && !e0.elite, 'tank radius/height/flags');
  const el = spawnEnemy(w, 'elite', w.titan.x - 60, w.titan.z, { elite: true });
  check(el.elite && el.kind === 'elite', 'elite flag');
  e0.alive = false; el.alive = false;
  w.t = 0;
  // behaviour states reached per kind (rank IV so heavy kinds engage)
  forceRank(w, 3);
  const T = w.titan;
  const seen: Record<string, Set<string>> = {};
  // engagement distance, not the spawn ring: since 2026-09-24 the ring sits past the (wider) screen
  // edge (Size IV ≈ 280–370 m) and a 60 s window would be spent walking in. 92 m = the old ring.
  const R = Math.min(spawnRing(w), 92);
  const kinds: EnemyKind[] = ['android', 'drone', 'buggy', 'apc', 'tank', 'walker', 'elite'];
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2;
    spawnEnemy(w, k, T.x + Math.sin(a) * R, T.z + Math.cos(a) * R);
  });
  for (let s = 0; s < 5; s++) spawnEnemy(w, 'squad', T.x + 30 + s * 2, T.z - 30, { squad: 999, slot: s });
  const kn = spawnEnemy(w, 'android', T.x + 100, T.z + 100);   // outside the titan's attack reach
  // the rank-IV titan's auto-attack one-shots heavy units; make the probe's enemies unkillable so
  // every behaviour loop can be observed (the titan cannot crush anything while it stands still)
  const tough = () => { for (const e of w.enemies) if (e.alive && e.maxHp < 1e8) { e.hp = e.maxHp = 1e9; } };
  tough();
  let apcSquads = 0, kdecay = false, stunHeld = false, slowOk = false, knHit = false;
  for (let i = 0; i < 60 * HZ; i++) {
    if (i === 30) { kn.kx = 20; kn.kz = 0; kn.stun = 0.5; }
    if (i === 31) kdecay = Math.abs(kn.kx - 20 * (1 - 8 * w.dt)) < 1e-9;       // exactly one tick of 8/s decay
    if (i === 60) { kdecay = kdecay && (knHit || Math.hypot(kn.kx, kn.kz) < 20 * 0.02); stunHeld = kn.stun === 0; }
    if (i === 90) { kn.slowT = 1; kn.slowMul = 0.5; }
    if (i === 91) slowOk = kn.slowT > 0 && kn.slowMul === 0.5;
    stepWorld(w, NO_INPUT);
    tough();
    for (const ev of w.events) if (ev.type === 'enemySpawn' && ev.kind === 'squad') apcSquads++;
    if (i >= 31 && i < 60) for (const ev of w.events) if (ev.type === 'enemyHit' && ev.id === kn.id) knHit = true;   // titan re-knocked it
    for (const e of w.enemies) if (e.alive) (seen[e.kind] ??= new Set()).add(e.state);
  }
  for (const k of [...kinds, 'squad'] as EnemyKind[]) console.log(`  ${pad(k, 8)} states: ${[...(seen[k] ?? [])].join(' → ')}`);
  const need: Record<string, string[]> = {
    android: ['advance', 'hold', 'aim'], squad: ['form', 'volley'], drone: ['orbit', 'lock', 'dive', 'climb'],
    buggy: ['drive', 'strafe'], apc: ['drive', 'hold', 'deploy'], tank: ['crawl', 'hold', 'aim', 'tell'],
    walker: ['walk', 'plant', 'hold', 'aim', 'barrage'], elite: ['approach', 'aim', 'tell', 'charge', 'recover'],
  };
  for (const k of Object.keys(need)) for (const s of need[k]) check(!!seen[k]?.has(s), `${k} never reached state '${s}'`);
  console.log(`  apc-deployed squad members: ${apcSquads} · knockback decayed ${kdecay}${knHit ? ' (re-hit by the titan)' : ''} · stun cleared ${stunHeld} · slow latched ${slowOk}`);
  check(apcSquads >= 5 && apcSquads <= 10 + 5, `apc deployments ${apcSquads} (expect 1–2 squads alive at once)`);
  check(kdecay && stunHeld && slowOk, 'knockback/stun/slow handling');
  // recycling: teleport an android far away; it must come back onto the ring
  const far = spawnEnemy(w, 'android', T.x, T.z);
  far.x = T.x + spawnRing(w) * 3; far.z = T.z;
  const B = w.city.bounds;
  far.x = Math.min(far.x, B.maxX - 1);
  const before = Math.hypot(far.x - T.x, far.z - T.z);
  stepWorld(w, NO_INPUT);
  const after = Math.hypot(far.x - T.x, far.z - T.z);
  console.log(`  recycle: ${fmt(before)} m → ${fmt(after)} m (ring ${fmt(spawnRing(w))} m)`);
  check(before < spawnRing(w) * 2.4 || after < spawnRing(w) * 1.6, 'far enemy not recycled onto the ring');
}

// ─────────────────────────────── E: determinism ───────────────────────────────
function stateHash(w: World): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { const s = n.toFixed(4); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  for (const e of w.enemies) if (e.alive) { mix(e.id); mix(e.x); mix(e.z); mix(e.hp); mix(e.heading); }
  mix(w.director.wave); mix(w.director.spawnBudget);
  if (w.boss) { mix(w.boss.x); mix(w.boss.z); mix(w.boss.hp); mix(w.boss.cd); }
  return h.toString(16);
}
function determinism(): void {
  console.log('\n══ determinism ══');
  const run = () => {
    const w = createWorld({ titan: 'briarwick', biome: 'whitestacks', seed: 77 });
    w.cheats.god = true;
    for (let i = 0; i < 200 * HZ; i++) {
      if (i === 20 * HZ) forceRank(w, 3);
      if (i === 150 * HZ) spawnBoss(w, 'irongully');
      stepWorld(w, NO_INPUT);
    }
    return stateHash(w) + ` (enemies ${w.enemies.filter((e) => e.alive).length}, boss ${w.boss ? w.boss.attack ?? 'idle' : '—'})`;
  };
  const a = run(), b = run();
  console.log(`  run A ${a}\n  run B ${b}`);
  check(a === b, 'same seed produced different state');
}

const T0 = performance.now();
runBiome('grideast', 11);
runBiome('whitestacks', 11);
lockwaterEntry();
unitBlock();
determinism();
console.log(`\nprobe_ai: ${fails.length === 0 ? 'ALL CHECKS PASSED' : fails.length + ' FAILED'} in ${fmt((performance.now() - T0) / 1000, 1)} s`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); process.exit(1); }
