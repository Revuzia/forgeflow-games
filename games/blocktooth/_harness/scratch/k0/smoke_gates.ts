// K0 smoke test of the gate pre-wires (not a gate; evidence for the lane report).
import type { GateId, SimEvent } from '../../../src/core/types.ts';
import { GATE_IDS } from '../../../src/core/types.ts';
import { GATES, titanHeightAt } from '../../../src/core/config.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnGate, damageBoss, gateWindup, volleyPoints, laneClearLen, gateUnstick, gateCrushTier, gateAddIds, registerGateAdd, bossH, gateHomeH } from '../../../src/ai/bosses/index.ts';
import { growToRank } from '../../../src/titans/titansim.ts';
import { findTarget } from '../../../src/combat/targeting.ts';
import { damageArea } from '../../../src/combat/damage.ts';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

for (let gi = 0; gi < 3; gi++) {
  const id: GateId = GATE_IDS[gi];
  const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 1337 });
  w.cheats.noSpawns = true;
  // hold the titan at Size gi at the gate level (the ceiling): close the gate above it first
  w.gates.unlocked = gi as 0 | 1 | 2;
  growToRank(w, gi, [7, 16, 27][gi]);
  for (let i = 0; i < 40; i++) stepWorld(w, NO_INPUT);   // settle the tween
  const ev0: SimEvent[] = [];
  spawnGate(w, id, 0);
  for (const e of w.events) ev0.push(e);
  const b = w.boss!;
  console.log(`${id}: rank ${w.titan.rank} LV ${w.titan.level} H(titan) ${w.titan.height.toFixed(2)} bossH ${bossH(w, b).toFixed(3)} home ${gateHomeH(id).toFixed(3)} (titanHeightAt ${titanHeightAt(w.titan.rank, w.titan.level).toFixed(3)})`);
  ok(b.role === 'gate' && b.slot === gi + 1, `${id}: role gate, slot ${b.slot}`);
  ok(b.maxHp === [1000, 4500, 20000][gi], `${id}: HP ${b.maxHp} = GATE_HP_AT_RANK[${w.titan.rank}]`);
  ok(b.introT === GATES.introS, `${id}: intro ${b.introT} s`);
  ok(ev0.some((e) => e.type === 'gateSpawn' && e.gate === id && e.slot === gi + 1 && !e.rematch), `${id}: gateSpawn event`);
  ok(!ev0.some((e) => e.type === 'bossSpawn'), `${id}: no bossSpawn`);
  ok(!w.director.bossSpawned && w.run.phase !== 'boss', `${id}: director.bossSpawned false, phase ${w.run.phase}`);
  const d = Math.hypot(b.x - w.titan.x, b.z - w.titan.z);
  console.log(`    entry distance ${d.toFixed(1)} m (ring × ${GATES.entryRingMul})`);
  ok(gateCrushTier(b) === GATES.crushTier[id], `${id}: crush tier ${gateCrushTier(b)}`);
  // windup: home, unslowed; slowed
  const wu = gateWindup(w, b, 0.5, 0.6, 1.4);
  w.titan.slowT = 1; w.titan.slowMul = 0.65;
  const wuS = gateWindup(w, b, 0.5, 0.6, 1.4);
  w.titan.slowT = 0;
  console.log(`    gateWindup(0.5 H, 0.6, 1.4): ${wu.toFixed(3)} s · slowed 0.65: ${wuS.toFixed(3)} s`);
  ok(wuS >= wu && wu >= 0.6, `${id}: slowed windup ≥ unslowed ≥ min`);
  // volley
  const out = new Float32Array(10);
  const H = bossH(w, b), R = w.titan.radius, r = 0.4 * H;
  const lx = w.titan.x, lz = w.titan.z;
  const n = volleyPoints(w, b, lx, lz, 5, r, out);
  let minD = Infinity, beyond = true;
  const ax = lx - b.x, az = lz - b.z, am = Math.hypot(ax, az);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(out[2 * i] - out[2 * j], out[2 * i + 1] - out[2 * j + 1]));
  for (let i = 1; i < n; i++) { const dx = out[2 * i] - lx, dz = out[2 * i + 1] - lz; if ((dx * ax + dz * az) / am <= 0) beyond = false; }
  console.log(`    volley ${n} points, min spacing ${minD.toFixed(2)} m vs need ${(2 * (r + R) + 0.1 * H).toFixed(2)} m, all beyond the lead: ${beyond}`);
  ok(n >= 2 && minD >= 2 * (r + R) + 0.1 * H - 1e-6, `${id}: volley spacing`);
  const L = laneClearLen(w, b.x, b.z, 1, 0, 10 * H, b.parts[0].r);
  console.log(`    laneClearLen +X 10 H: ${L.toFixed(1)} m of ${(10 * H).toFixed(1)}`);
  ok(L >= 0 && L <= 10 * H + 1e-9, `${id}: laneClearLen in range`);
  // run the intro out, stepWorld with the gate alive
  for (let i = 0; i < 120; i++) stepWorld(w, NO_INPUT);
  ok(!!w.boss && w.boss.alive && w.boss.introT === 0, `${id}: alive after 4 s, intro over`);
  // weak point: mark the drum/pack/dish open → findTarget returns it before enemies
  const weakIx = b.parts.findIndex((p) => p.name === (gi === 0 ? 'drum' : gi === 1 ? 'pack' : 'dishA'));
  b.data.weakMask = 1 << weakIx;
  const tgt = findTarget(w, b.parts[weakIx].x, b.parts[weakIx].z, 2 * H, true);
  ok(!!tgt && tgt.kind === 'boss' && tgt.part === weakIx, `${id}: findTarget prefers the open weak part (${tgt ? tgt.kind + ' ' + (tgt.kind === 'boss' ? tgt.part : '') : 'null'})`);
  // weak split: a big circle over the whole rig → only the weak part is hit
  const hp0 = b.hp;
  w.events.length = 0;
  damageArea(w, { k: 'circle', x: b.x, z: b.z, r: 5 * H }, 10, { src: 'titan', kind: 'bite', noCity: true, noCrit: true });
  const hits = w.events.filter((e) => e.type === 'bossHit') as Extract<SimEvent, { type: 'bossHit' }>[];
  ok(hits.length === 1 && hits[0].part === b.parts[weakIx].name, `${id}: area hit went to the weak part only (${hits.map((h) => h.part).join(',')}), dmg ${(hp0 - b.hp).toFixed(2)}`);
  b.data.weakMask = 0;
  // dps cap: hammer it inside one window
  w.events.length = 0;
  const G = w.gates; G.dpsWin = 0; G.dpsWinT = -10;
  const before = b.hp;
  for (let k = 0; k < 50; k++) damageBoss(w, 0, b.maxHp, { src: 'titan', kind: 'bite' });
  const took = before - b.hp;
  console.log(`    dps cap: 50 max-HP hits in one window took ${took.toFixed(1)} = ${(100 * took / b.maxHp).toFixed(2)} % (cap ${100 * GATES.dpsCapFrac} %)`);
  ok(Math.abs(took - GATES.dpsCapFrac * b.maxHp) < 1e-6, `${id}: per-second cap holds`);
  ok(b.data.lastHitT === w.t, `${id}: lastHitT written`);
  // adds
  registerGateAdd(b, 424242);
  ok(gateAddIds(w).includes(424242), `${id}: gateAddIds registered`);
  // unstick: no progress for 2 s → detour, 4 s → ram
  const ram: SimEvent[] = [];
  for (let k = 0; k < 130; k++) { w.events.length = 0; gateUnstick(w, b); w.t += w.dt; for (const e of w.events) ram.push(e); }
  console.log(`    unstick: stuckN ${b.data.stuckN} detourT ${(b.data.detourT ?? 0).toFixed(2)} ramT ${(b.data.ramT ?? 0).toFixed(2)} gateRam events ${ram.filter((e) => e.type === 'gateRam').length}`);
  ok((b.data.stuckN ?? 0) >= 2 && ram.some((e) => e.type === 'gateRam'), `${id}: stuck rule reached RAMMING THROUGH`);
  // kill → gateDefeated this tick, breach flushed at the end of the tick (stub: no rank change)
  G.dpsWinT = -10; G.dpsWin = 0;
  b.hp = 1e-3;
  const rank0 = w.titan.rank;
  let got: SimEvent[] = [];
  // land the kill inside a tick: put a 1-hit on the tick via a projectile-free path: damage right before stepWorld's flush
  damageBoss(w, 0, 10, { src: 'titan', kind: 'bite' });
  got = w.events.slice();
  ok(!b.alive && got.some((e) => e.type === 'gateDefeated' && e.gate === id && e.slot === gi + 1), `${id}: gateDefeated pushed by defeat()`);
  ok(!got.some((e) => e.type === 'bossDefeated'), `${id}: no bossDefeated for a gate`);
  ok(w.gates.breachDue === gi + 1, `${id}: breachDue ${w.gates.breachDue}`);
  stepWorld(w, NO_INPUT);
  ok(w.gates.breachDue === 0 && w.titan.rank === rank0, `${id}: flushed (stub breach is a no-op: rank ${w.titan.rank})`);
  ok(!w.run.result, `${id}: a gate kill never clears the run (result ${w.run.result})`);
}

// city boss: kill → breachDue 4 → flush → finaleDone → clear with endT = the kill tick
{
  const w = createWorld({ titan: 'hearthback', biome: 'lockwater', seed: 7 });
  w.cheats.god = true;
  w.cheats.noSpawns = true;
  growToRank(w, 4, 35);
  w.director.bossT = w.t;
  w.cheats.noSpawns = false;
  stepWorld(w, NO_INPUT);
  const b = w.boss!;
  ok(!!b && b.alive && b.role === 'main' && b.slot === 4 && w.director.bossSpawned, `city boss via stepGates: ${b.id} role ${b.role} slot ${b.slot}`);
  ok(w.gates.spawnT[4] === w.t, `gates.spawnT[4] telemetry ${w.gates.spawnT[4]}`);
  for (let i = 0; i < 125; i++) stepWorld(w, NO_INPUT);
  b.hp = 1e-3;
  let killT = -1;
  for (let i = 0; i < 600 && !w.run.result; i++) {
    stepWorld(w, { ...NO_INPUT });
    if (!b.alive && killT < 0) killT = w.t;
    if (b.alive) b.hp = 1e-3;   // wait for any titan hit
    if (i === 20 && b.alive) { damageBoss(w, 0, 10, { src: 'titan', kind: 'bite' }); }
  }
  console.log(`city boss: result ${w.run.result} endT ${w.run.endT.toFixed(2)} mainKillT ${w.gates.mainKillT.toFixed(2)} finaleDone ${w.gates.finaleDone}`);
  ok(w.run.result === 'clear' && w.gates.finaleDone && w.run.endT === w.gates.mainKillT, 'clear with endT = mainKillT');
}

console.log(fails === 0 ? '\nsmoke_gates: PASS' : `\nsmoke_gates: ${fails} FAIL`);
process.exitCode = fails ? 1 : 0;
