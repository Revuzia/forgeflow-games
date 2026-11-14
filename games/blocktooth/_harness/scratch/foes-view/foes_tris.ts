import { buildFoeModel, buildFoeFar } from '../../../src/ai/foemodels.ts';
import { ENEMY_KINDS } from '../../../src/core/types.ts';
for (const k of ENEMY_KINDS) {
  const m = buildFoeModel(k);
  let tris = 0;
  for (const p of m.parts) tris += p.geo.getAttribute('position').count / 3 * p.count;
  const out = [8, 10, 12, 14].map((c) => c + ':' + buildFoeFar(m, c).getAttribute('position').count / 3);
  console.log(k.padEnd(8), 'near', tris, 'far', out.join(' '));
}
