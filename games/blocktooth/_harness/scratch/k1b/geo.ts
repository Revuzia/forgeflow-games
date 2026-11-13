// K1b scratch — geometry unit checks of the three gatekeeper modules (the §5.4 case 5 / 6b ideas, on the real code).
//   node _harness/scratch/k1b/geo.ts
import type { GateId, World } from '../../../src/core/types.ts';
import { GATE_IDS } from '../../../src/core/types.ts';
import { RANK_LEVELS, titanHeightAt } from '../../../src/core/config.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnGate, bossH, stepBoss, gateWindup, ESCAPE_K, REACT_S, ACCEL_LOSS_S, titanWalk } from '../../../src/ai/bosses/index.ts';
import { growToRank } from '../../../src/titans/titansim.ts';
import { findTarget } from '../../../src/combat/targeting.ts';
import { BOSSES, bossSubtitle } from '../../../src/data/bosses.ts';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const DEG = Math.PI / 180;

function fresh(gi: number, titan = 'molo'): World {
  const w = createWorld({ titan: titan as never, biome: 'grideast', seed: 1337 });
  w.cheats.noSpawns = true;
  w.cheats.god = true;
  w.gates.unlocked = gi as 0 | 1 | 2;
  growToRank(w, gi, RANK_LEVELS[gi + 1]);
  for (let i = 0; i < 40; i++) stepWorld(w, NO_INPUT);
  return w;
}

/** stand the titan at (angle a from the rig's facing, centre distance d), facing the rig; returns findTarget */
function place(w: World, a: number, d: number): void {
  const b = w.boss!, T = w.titan;
  const h = b.heading + a;
  T.x = b.x + Math.sin(h) * d; T.z = b.z + Math.cos(h) * d;
  T.heading = Math.atan2(b.x - T.x, b.z - T.z);
}

for (let gi = 0; gi < 3; gi++) {
  const id: GateId = GATE_IDS[gi];
  const w = fresh(gi);
  spawnGate(w, id, 0);
  const b = w.boss!;
  b.introT = 0;
  const H = bossH(w, b), R = w.titan.radius;
  console.log(`${id}: H ${H.toFixed(3)} (home ${titanHeightAt(gi as 0 | 1 | 2, RANK_LEVELS[gi + 1]).toFixed(3)}) R ${R.toFixed(2)} (${(R / H).toFixed(2)} H) band ${b.data.bandMinH}–${b.data.bandMaxH} H`);
  ok(BOSSES[id].attacks.length >= 4, `${id}: ${BOSSES[id].attacks.map((a) => a.id + '@P' + a.phase).join(' · ')}`);
  const reach = 0.9 * w.titan.height * Math.max(0.5, w.titan.stats.attackRange || 1);
  if (id === 'stencil1') {
    // open the drum (REFILL beat) and stand MOLO behind it at the eased push-out distance
    b.attack = 'refill'; b.attackT = 0; b.data.beatS = 3;
    stepBoss(w);
    ok(b.data.drumOpen === 1 && b.data.weakMask === 1 << 3, `drum open during REFILL (weakMask ${b.data.weakMask})`);
    ok(bossSubtitle(id, b.attack) === 'REFILLING — HIT THE DRUM', `REFILL subtitle '${b.subtitle}'`);
    const drum = b.parts[3];
    const dD = Math.hypot(drum.x - b.x, drum.z - b.z) + drum.r + R;   // titan touching the drum from behind
    place(w, Math.PI, dD);
    const tg = findTarget(w, w.titan.x, w.titan.z, reach, true);
    ok(!!tg && tg.kind === 'boss' && tg.part === 3, `MOLO behind the open drum → findTarget ${tg ? tg.kind + (tg.kind === 'boss' ? ' ' + b.parts[tg.part].name : '') : 'null'} (reach ${(reach / H).toFixed(2)} H)`);
    ok(b.parts[0].r * 2 / H > 1.699 && b.parts[0].r * 2 / H < 1.701, `STRIPE RUN lane width 1.7 H = 2 × parts[0].r (${(2 * b.parts[0].r / H).toFixed(3)} H)`);
    b.attack = null; b.data.beatS = 0; stepBoss(w);
    ok(b.data.drumOpen === 0 && b.data.weakMask === 0, 'drum shut after REFILL');
  }
  if (id === 'cordon2') {
    const keep = 1.2 * H + R;
    place(w, Math.PI, keep);
    stepBoss(w);
    ok(b.data.weakMask === 1 << 4, `pack open from behind (weakMask ${b.data.weakMask})`);
    const tg = findTarget(w, w.titan.x, w.titan.z, reach, true);
    ok(!!tg && tg.kind === 'boss' && tg.part === 4, `MOLO at the wall behind → findTarget ${tg ? tg.kind + (tg.kind === 'boss' ? ' ' + b.parts[tg.part].name : '') : 'null'}`);
    // pack-nearest window (planar nearestBossPart from the keep-out)
    let win = 0;
    for (let deg = 0; deg <= 90; deg++) {
      place(w, Math.PI + deg * DEG, keep);
      let bi = -1, bd = Infinity;
      for (let i = 0; i < b.parts.length; i++) { const p = b.parts[i]; const dd = Math.hypot(p.x - w.titan.x, p.z - w.titan.z) - p.r; if (dd < bd) { bd = dd; bi = i; } }
      const nm = bi >= 0 ? b.parts[bi].name : '';
      if (nm !== 'pack') break;
      win = deg;
    }
    ok(win >= 40, `pack is the nearest part over ±${win}° behind (need ≥ ±40°)`);
    place(w, 0, keep);
    b.data.overheated = 0; b.attack = null;
    stepBoss(w);
    ok(b.data.weakMask === 0, `pack shut from the front (weakMask ${b.data.weakMask})`);
    const packSurf = Math.hypot(b.parts[4].x - b.x, b.parts[4].z - b.z) + b.parts[4].r;
    console.log(`    pack surface ${(packSurf / H).toFixed(2)} H from centre; titan centre at the wall ${(keep / H).toFixed(2)} H → gap ${((keep - packSurf) / H).toFixed(2)} H (MOLO bite 0.9 H)`);
  }
  if (id === 'switchboard5') {
    const keep = 1.25 * H + R;
    // face dishA: its world angle is heading + crown
    stepBoss(w);
    ok(b.data.folded === 0 && b.data.weakMask === 0b1110, `dishes out while planted (weakMask ${b.data.weakMask})`);
    const a = (b.data.crown ?? 0);
    place(w, a, keep);
    stepBoss(w);
    const tg = findTarget(w, w.titan.x, w.titan.z, reach, true);
    ok(!!tg && tg.kind === 'boss' && b.parts[tg.part].name.startsWith('dish'), `MOLO facing a dish at the wall → findTarget ${tg ? tg.kind + (tg.kind === 'boss' ? ' ' + b.parts[tg.part].name : '') : 'null'}`);
  }
  // windups ≥ fair at every phase (the escape of each lead tell) — the §3.0 clamp rule, home Size
  const escapes: Record<GateId, [string, number, number, number][]> = {
    stencil1: [['stripe', 0.85, 1.1, 1.9], ['buckets', 0.45, 1.0, 1.8], ['doubleLine', 0.25, 1.0, 1.8]],
    cordon2: [['shove', 1.2, 1.2, 2.2], ['sawhorse', 0.25, 1.1, 2.0]],
    switchboard5: [['callIn', 0.5, 1.1, 2.0]],
  };
  for (const slow of id === 'stencil1' ? [1, 0.65] : [1]) {
    for (let ph = 1; ph <= 3; ph++) {
      b.phase = ph as 1 | 2 | 3;
      w.titan.slowT = slow < 1 ? 1 : 0; w.titan.slowMul = slow;
      const parts: string[] = [];
      let allOk = true;
      for (const [nm, e, mn, mx] of escapes[id]) {
        const wu = gateWindup(w, b, e + R / H, mn, mx);
        const fair = REACT_S + ACCEL_LOSS_S + ((e * H + R) / (titanWalk(w) * slow)) * Math.min(1, ESCAPE_K[ph]);
        if (wu < fair - 1e-9) allOk = false;
        parts.push(`${nm} ${wu.toFixed(2)}/${fair.toFixed(2)}`);
      }
      ok(allOk, `P${ph}${slow < 1 ? ' slowed' : ''} windup ≥ fair: ${parts.join(' · ')}`);
    }
  }
  w.titan.slowT = 0;
}
console.log(fails ? `\nFAIL ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
