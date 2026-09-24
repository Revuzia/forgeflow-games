// DoT vs i-frames check with the REAL titansim/combat modules.
import { createWorld, stepWorld, NO_INPUT } from '../../src/core/world.ts';
import { spawnHazard } from '../../src/combat/hazards.ts';
import { spawnTelegraph } from '../../src/combat/telegraphs.ts';
import { damageTitanArea } from '../../src/combat/damage.ts';
const mk = () => { const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 3 }); w.cheats.noSpawns = true; w.titan.stats.regen = 0; return w; };
const count = (w: any, n: number, inp = NO_INPUT) => { let k = 0, d = 0; for (let i = 0; i < n; i++) { stepWorld(w, inp); for (const e of w.events) if (e.type === 'titanHurt') { k++; d += e.dmg; } } return { k, d: +d.toFixed(2) }; };
{ // hostile hazard 10 dps for 2 s → 10 ticks of 2
  const w = mk(); const T = w.titan;
  spawnHazard(w, { owner: 'boss', kind: 'magma', shape: { k: 'circle', x: T.x, z: T.z, r: 6 }, life: 2.05, dps: 10 });
  console.log('hazard 10dps 2s:', JSON.stringify(count(w, 62)), '(expect 10 ticks, 20 dmg pre-armor)');
}
{ // discrete hit first (grants 0.35 s i-frames), then hazard ticks must still land
  const w = mk(); const T = w.titan;
  damageTitanArea(w, { k: 'circle', x: T.x, z: T.z, r: 3 }, 5, 'shell');
  spawnHazard(w, { owner: 'boss', kind: 'magma', shape: { k: 'circle', x: T.x, z: T.z, r: 6 }, life: 1.05, dps: 10 });
  console.log('iframeT after hit', T.iframeT.toFixed(2), 'hazard ticks during hurt i-frames:', JSON.stringify(count(w, 31)), '(expect 5)');
  const again = damageTitanArea(w, { k: 'circle', x: T.x, z: T.z, r: 3 }, 5, 'shell');
  console.log('discrete hit right after DoT ticks lands (DoT grants no i-frames):', T.damageTaken.toFixed(2));
}
{ // active telegraph (breath) 50 dps × 1.0 s → 5 ticks
  const w = mk(); const T = w.titan;
  spawnTelegraph(w, { owner: 'boss', style: 'cone', shape: { k: 'cone', x: T.x, z: T.z - 20, dir: 0, half: 0.6, r: 60 }, windup: 0.5, active: 1.0, dmg: 50, kind: 'breath' });
  console.log('breath 50dps 1s:', JSON.stringify(count(w, 50)), '(expect 5 ticks)');
}
{ // dash i-frames block DoT ticks
  const w = mk(); const T = w.titan;
  spawnHazard(w, { owner: 'boss', kind: 'magma', shape: { k: 'circle', x: T.x, z: T.z, r: 200 }, life: 1.05, dps: 10 });
  const dashIn = { ...NO_INPUT, dash: true, mx: 1, mz: 0 };
  let k = 0; for (let i = 0; i < 31; i++) { stepWorld(w, i === 2 ? dashIn : NO_INPUT); for (const e of w.events) if (e.type === 'titanHurt') k++; }
  console.log('hazard with a dash at tick 2:', k, 'ticks (expect 5 minus the 1–2 inside the 0.3 s dash i-frames)');
}
