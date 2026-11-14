// BLOCKTOOTH — prints the auto camera framing per level (node; view-lane probe).
//   node _harness/scratch/view/framing_table.ts
// One run-long curve (config FRAMING): D must be non-decreasing and the share must rise at every level,
// including every MASS BREACH. "screen" = the analytic share × cos(pitch) — the foot → head share the
// growth sequence measures through the live camera (≈ 0.59 × H / (D·K) at 54°).
import { RANK_LEVELS, RANKS, rankForLevel, titanHeightAt } from '../../../src/core/config.ts';
import { autoDistance, autoFrameFrac, framingCurve } from '../../../src/render/camera.ts';

const K = 2 * Math.tan((30 * Math.PI) / 360);
const c = framingCurve();
console.log(`curve: ln D = ln ${c.D1.toFixed(2)} + ${c.k.toFixed(4)}·x + ${c.c.toFixed(5)}·x², x = ln(H / ${c.h1})  (slope at Size V ${c.kV.toFixed(3)})`);
console.log('LV  rank   H(m)     D(m)   frac   screen  viewH(m)');
let prevD = 0, prevF = 0, bad = 0;
for (let L = 1; L <= 44; L++) {
  const r = rankForLevel(L);
  const H = titanHeightAt(r, L);
  const D = autoDistance(H, r);
  const fr = autoFrameFrac(H, r);
  const scr = fr * Math.cos((RANKS[r].pitchDeg * Math.PI) / 180);
  const mark = RANK_LEVELS.includes(L) && L > 1 ? '  <- BREACH' : '';
  const flag = L > 1 && (D < prevD - 1e-9 || fr < prevF - 1e-12) ? '  !! NOT MONOTONIC' : '';
  if (flag) bad++;
  console.log(`${String(L).padStart(2)}  ${r}   ${H.toFixed(2).padStart(6)}  ${D.toFixed(1).padStart(7)}  ${(fr * 100).toFixed(1).padStart(5)}%  ${(scr * 100).toFixed(1).padStart(5)}%  ${(D * K).toFixed(1).padStart(7)}${mark}${flag}`);
  prevD = D; prevF = fr;
}
console.log(bad ? `FRAMING: ${bad} non-monotonic step(s) — FAIL` : 'FRAMING: D non-decreasing and share rising at every level — PASS');
