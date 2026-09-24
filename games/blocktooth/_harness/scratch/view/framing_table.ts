// BLOCKTOOTH — prints the auto camera framing per level (node; view-lane probe).
//   node _harness/scratch/view/framing_table.ts
import { RANK_LEVELS, rankForLevel, titanHeightAt } from '../../../src/core/config.ts';
import { autoDistance, autoFrameFrac, framingTable } from '../../../src/render/camera.ts';

const K = 2 * Math.tan((30 * Math.PI) / 360);
console.log('rank table:', framingTable().map((f, r) => `${r}: H0 ${f.H0.toFixed(2)} k ${f.k.toFixed(3)}`).join(' | '));
console.log('LV  rank   H(m)     D(m)   frac   viewH(m)');
for (let L = 1; L <= 44; L++) {
  const r = rankForLevel(L);
  const H = titanHeightAt(r, L);
  const D = autoDistance(H, r);
  const mark = RANK_LEVELS.includes(L) && L > 1 ? '  <- BREACH' : '';
  console.log(`${String(L).padStart(2)}  ${r}   ${H.toFixed(2).padStart(6)}  ${D.toFixed(1).padStart(7)}  ${(autoFrameFrac(H, r) * 100).toFixed(1).padStart(5)}%  ${(D * K).toFixed(1).padStart(7)}${mark}`);
}
