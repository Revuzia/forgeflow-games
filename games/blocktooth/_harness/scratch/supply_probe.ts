import { createWorld } from '../../src/core/world.ts';
import { BIOME_IDS } from '../../src/core/types.ts';
for (const b of BIOME_IDS) {
  const w = createWorld({ titan: 'molo', biome: b, seed: 1337 });
  const c = w.city;
  const nb = [0,0,0,0,0], nf = [0,0,0,0,0], area=[0,0,0,0,0];
  for (const B of c.buildings) { nb[B.tier]++; nf[B.tier] += B.floors; area[B.tier]+=B.w*B.d; }
  const np = [0,0]; let traffic = 0;
  for (const p of c.props) { np[p.tier]++; if (p.lane >= 0) traffic++; }
  const W = c.bounds.maxX - c.bounds.minX, D = c.bounds.maxZ - c.bounds.minZ;
  console.log(`${b}: ${c.blocksX}x${c.blocksZ} bounds ${W.toFixed(0)}x${D.toFixed(0)} m · buildings/tier ${nb.join('/')} · floors/tier ${nf.join('/')} · area k m2 ${area.map(a=>(a/1000).toFixed(0)).join('/')} · props t0 ${np[0]} t1 ${np[1]} (traffic ${traffic}) lanes ${c.lanes.length}`);
}
