import { v3 } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const { SoftBody } = await import(S + '/c47/games/wobblehoard/src/physics/softbody.ts');
const { speciesTemplateGenome } = await import(S + '/c47/games/wobblehoard/src/data/catalog.ts');
const g = speciesTemplateGenome('dollop');
const test = (name: string, b: any) => {
  for (let i = 0; i < 120; i++) b.step(1 / 60);
  const R = b.restRadius, h = b.raycast(v3(b.center.x + 0.3 * R, 6, b.center.z), v3(0, -1, 0));
  let top = 0; for (let i = 1; i < b.positions.length; i += 3) top = Math.max(top, b.positions[i]);
  b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) });
  let comp = 0; for (let i = 0; i < 90; i++) { b.fingerPressure(0, 1); b.step(1 / 60); comp = Math.max(comp, b.metrics.compression); }
  const tp = b.tip(0);
  b.fingerUp(0); let osc = 0, prev = 0, sgn = 0; const tops: number[] = [];
  for (let i = 0; i < 180; i++) { b.step(1 / 60); let t2 = 0; for (let k = 1; k < b.positions.length; k += 3) t2 = Math.max(t2, b.positions[k]); tops.push(t2); }
  console.log(`${name.padEnd(34)} n ${b.vertexCount} restRadius ${R.toFixed(3)} frac ${(b.frac ?? 1).toFixed(3)} smOmega ${b.params.smOmega.toFixed(1)} top ${top.toFixed(3)} m, full press: compression ${comp.toFixed(2)}, tip r ${tp ? tp.r.toFixed(3) : '-'} m, top after release ${Math.min(...tops).toFixed(3)}..${Math.max(...tops).toFixed(3)}`);
};
test('whole dollop', new SoftBody(g));
const p = new SoftBody(g, { piece: { frac: 0.125, chunk: false, at: v3(0, 0, 0) } }); p.setFrac(1, 0); test('face piece 1/8 regrown to 1', p);
const q = new SoftBody(g, { piece: { frac: 0.4, chunk: false, at: v3(0, 0, 0) } }); q.setFrac(1, 0); test('face piece 0.4 regrown to 1', q);
