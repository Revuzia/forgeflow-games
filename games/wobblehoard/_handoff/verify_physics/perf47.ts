// Verifier perf (phys_verify): per family, its heaviest catalog species (most struts), two workloads, step(1/60) timed per frame.
//  A = probe_species' workload (template genome, one finger pressed at 0.7, held)
//  B = active: soft corner genome (f0 b1 s1 z1), one finger holding the top at 1.0, the other rubbing a flank (fingerMove every frame)
// Best of 3 batches of 400 frames (mean and p99 of that batch). Starter (DOLLOP template) before and after. Load average printed.
import { readFileSync } from 'node:fs';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = S + '/c47/games/wobblehoard';
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { CATALOG, speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const { MATERIAL_FAMILY_IDS } = await import(root + '/src/data/materials.ts');
const { quantizeGenome } = await import(root + '/src/core/genome.ts');
const DT = 1 / 60;
const load = (): string => readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
const v3 = (x: number, y: number, z: number) => ({ x, y, z });
function bench(id: string, work: 'A' | 'B'): { mean: number; p99: number } {
  const t = speciesTemplateGenome(id);
  const g = work === 'A' ? t : quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 });
  const b: any = new SoftBody(g);
  b.warmUp?.();
  for (let i = 0; i < 60; i++) b.step(DT);
  const R = b.restRadius;
  const h = b.raycast(v3(b.center.x + 0.1 * R, 6 * R, b.center.z), v3(0, -1, 0));
  if (h) { b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) }); b.fingerPressure(0, work === 'A' ? 0.7 : 1); }
  let h2: any = null;
  if (work === 'B') { h2 = b.raycast(v3(b.center.x, b.center.y, b.center.z + 4 * R), v3(0, 0, -1)); if (h2) { b.fingerDown(1, { point: h2.point, normal: h2.normal, dir: v3(0, 0, -1) }); b.fingerPressure(1, 0.7); } }
  let k = 0;
  const frame = (): void => {
    if (h2) { const a = k * 0.05; const hq = b.raycast(v3(b.center.x + Math.sin(a) * 0.5 * R, b.center.y + Math.cos(a * 0.7) * 0.3 * R, b.center.z + 4 * R), v3(0, 0, -1)); if (hq) b.fingerMove(1, hq.point); }
    k++; b.step(DT);
  };
  for (let i = 0; i < 300; i++) frame();
  let best = { mean: Infinity, p99: Infinity };
  const ts = new Float64Array(400);
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 400; i++) { const t0 = performance.now(); frame(); ts[i] = performance.now() - t0; }
    const s = Array.from(ts).sort((a, c) => a - c), mean = s.reduce((a, c) => a + c, 0) / s.length, p99 = s[Math.floor(0.99 * s.length)];
    if (mean < best.mean) best = { mean, p99 };
  }
  return best;
}
const heavy = (fam: string): string => {
  const ids = CATALOG.filter((d: any) => d.family === fam).map((d: any) => d.id);
  let bestId = ids[0], bestN = -1;
  for (const id of ids) { const n = (new SoftBody(speciesTemplateGenome(id)) as any).ns; if (n > bestN) { bestN = n; bestId = id; } }
  return bestId;
};
console.log(`load at start ${load()}`);
const ref0 = bench('dollop', 'A');
const rows: string[] = [];
let worst = { f: '', ms: 0 };
for (const fam of MATERIAL_FAMILY_IDS) {
  const id = heavy(fam), a = bench(id, 'A'), bb = bench(id, 'B');
  rows.push(`${fam.padEnd(13)} ${id.padEnd(10)} A ${a.mean.toFixed(3)} ms (p99 ${a.p99.toFixed(2)})  B ${bb.mean.toFixed(3)} ms (p99 ${bb.p99.toFixed(2)})  load ${load()}`);
  if (Math.max(a.mean, bb.mean) > worst.ms) worst = { f: fam, ms: Math.max(a.mean, bb.mean) };
  console.log(rows[rows.length - 1]);
}
const ref1 = bench('dollop', 'A');
console.log(`starter (dollop template, A) before ${ref0.mean.toFixed(3)} after ${ref1.mean.toFixed(3)} ms; worst family ${worst.f} ${worst.ms.toFixed(3)} ms; load at end ${load()}`);

// ---- multi-body frames (collide every frame, then step every body): 1 whole, 2 whole, 2 / 4 / 6 pieces, 5 whole mixed-family bodies
{
  const v = (x: number, y: number, z: number) => ({ x, y, z });
  const benchMulti = (name: string, mk: () => any[]): void => {
    const bs = mk();
    for (const b of bs) b.warmUp?.();
    const fr = (): void => { for (const b of bs) b.collide(bs); for (const b of bs) b.step(DT); };
    // a finger pressing the first body, as a player would
    const b0 = bs[0], R = b0.restRadius, h = b0.raycast(v(b0.center.x + 0.1 * R, 6 * R, b0.center.z), v(0, -1, 0));
    if (h) { b0.fingerDown(0, { point: h.point, normal: h.normal, dir: v(0, -1, 0) }); b0.fingerPressure(0, 0.7); }
    for (let i = 0; i < 300; i++) fr();
    let best = { mean: Infinity, p99: Infinity };
    const ts = new Float64Array(300);
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 300; i++) { const t0 = performance.now(); fr(); ts[i] = performance.now() - t0; }
      const s = Array.from(ts).sort((a, c) => a - c), mean = s.reduce((a, c) => a + c, 0) / s.length;
      if (mean < best.mean) best = { mean, p99: s[Math.floor(0.99 * s.length)] };
    }
    console.log(`MULTI ${name.padEnd(46)} ${best.mean.toFixed(3)} ms per frame (p99 ${best.p99.toFixed(2)})  load ${load()}`);
  };
  const g = speciesTemplateGenome('dollop');
  const ring = (k: number, n: number) => v(0.9 * Math.cos((k * 2 * Math.PI) / n), 0, 0.9 * Math.sin((k * 2 * Math.PI) / n));
  benchMulti('1 whole dollop (collide with nothing)', () => [new SoftBody(g)]);
  benchMulti('2 whole dollops, collide', () => [new SoftBody(g, { piece: { frac: 1, chunk: false, at: v(-0.6, 0, 0) } }), new SoftBody(g, { piece: { frac: 1, chunk: false, at: v(0.6, 0, 0) } })]);
  for (const np of [2, 4, 6]) benchMulti(`${np} pieces of a dollop (face 1/${np} ... equal shares), collide`, () => {
    const f = 1 / np, out: any[] = [new SoftBody(g, { piece: { frac: f, chunk: false, at: v(0, 0, 0) } })];
    for (let k = 1; k < np; k++) out.push(new SoftBody(g, { piece: { frac: f, chunk: true, cutNormal: v(1, 0, 0), at: ring(k, np) } }));
    return out;
  });
  benchMulti('6 pieces (face 0.375 + 5 x 0.125), collide', () => {
    const out: any[] = [new SoftBody(g, { piece: { frac: 0.375, chunk: false, at: v(0, 0, 0) } })];
    for (let k = 1; k < 6; k++) out.push(new SoftBody(g, { piece: { frac: 0.125, chunk: true, cutNormal: v(1, 0, 0), at: ring(k, 6) } }));
    return out;
  });
  benchMulti('5 whole mixed-family bodies on the mat, collide', () => ['dollop', 'somnuff', 'fossilo', 'granulo', 'skeinara'].map((id, k) => new SoftBody(speciesTemplateGenome(id), { piece: { frac: 1, chunk: false, at: ring(k, 5) } })));
  benchMulti('5 whole bodies stacked in a pile, collide', () => ['puddlo', 'plumpet', 'boingle', 'wisplet', 'kneadle'].map((id, k) => new SoftBody(speciesTemplateGenome(id), { piece: { frac: 1, chunk: false, at: v(0.02 * k, 0.3 + 0.9 * k, 0) } })));
  console.log(`load at end ${load()}`);
}
