// Verifier: is HEAD's DOLLOP the 6dff62e DOLLOP? restPoint (every mesh direction + 20000 dense dirs), floppy weights, struts, softW,
// mass, rest volume; for detail 3 and 4 and 5 genomes. Also: the same SoftBody pressed on both trees (first-frame divergence).
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const NEW = S + '/head/games/wobblehoard', OLD = S + '/old/games/wobblehoard';
const nShape = await import(NEW + '/src/physics/shape.ts');
const oShape = await import(OLD + '/src/physics/shape.ts');
const nMesh = await import(NEW + '/src/physics/mesh.ts');
const oMesh = await import(OLD + '/src/physics/mesh.ts');
const nSB = (await import(NEW + '/src/physics/softbody.ts')).SoftBody;
const oSB = (await import(OLD + '/src/physics/softbody.ts')).SoftBody;
const ge = await import(NEW + '/src/core/genome.ts');
const st = ge.makeStarterGenome();
const corner = (f: number, b: number, s: number, z: number) => ge.quantizeGenome({ ...st, firmness: f, bounce: b, stretch: s, size: z });
const G: Record<string, any> = { starter: st, f0b0s0z0: corner(0, 0, 0, 0), f1b1s1z1: corner(1, 1, 1, 1), f0b0s1z1: corner(0, 0, 1, 1), z1: corner(0.5, 0.5, 0.5, 1) };

// 1) restPoint over 20000 dense directions, R0 = 0.5
{
  const a = new Float64Array(3), b = new Float64Array(3);
  let maxP = 0, maxF = 0;
  const N = 20000, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), ph = i * golden, x = Math.cos(ph) * r, z = Math.sin(ph) * r;
    const fn = nShape.restPoint('dollop', x, y, z, 0.5, a, 0), fo = oShape.restPoint('dollop', x, y, z, 0.5, b, 0);
    maxP = Math.max(maxP, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 0.5);
    maxF = Math.max(maxF, Math.abs(fn - fo));
  }
  console.log(`restPoint dense 20000 dirs: max |dp| ${maxP.toExponential(2)} R0, max |dfloppy| ${maxF.toExponential(2)}`);
  // unknown species falls back to dollop in both
  let mx = 0;
  for (const sp of ['nonexistent', undefined, '__proto__', 42]) { nShape.restPoint(sp as any, 0.3, 0.8, 0.52, 0.5, a, 0); oShape.restPoint(sp as any, 0.3, 0.8, 0.52, 0.5, b, 0); mx = Math.max(mx, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
  console.log(`unknown/hostile species -> dollop on both: max |dp| ${mx.toExponential(2)}`);
}
// 2) buildRest per genome and detail
for (const [gn, g] of Object.entries(G)) for (const detail of [3, 4]) {
  const mn = nMesh.buildIcosphere(detail);
  const mo = oMesh.buildIcosphere(detail);
  const rn = nShape.buildRest(g, mn), ro = oShape.buildRest(g, mo);
  let dp = 0, df = 0, dm = 0;
  for (let i = 0; i < rn.restLocal.length; i++) dp = Math.max(dp, Math.abs(rn.restLocal[i] - ro.restLocal[i]));
  for (let i = 0; i < rn.floppy.length; i++) { df = Math.max(df, Math.abs(rn.floppy[i] - ro.floppy[i])); dm = Math.max(dm, Math.abs(rn.mass[i] - ro.mass[i])); }
  let dsw = 0; for (let i = 0; i < rn.floppy.length; i++) dsw = Math.max(dsw, Math.abs(rn.strutW[i] - rn.floppy[i]));
  const feats = new Set(Array.from(rn.feature));
  console.log(`buildRest ${gn} d${detail}: n ${rn.floppy.length}/${ro.floppy.length} max|dpos| ${dp.toExponential(2)} m, max|dfloppy| ${df.toExponential(2)}, max|dmass| ${dm.toExponential(2)}, vol ${rn.restVolume.toFixed(6)} vs ${ro.restVolume.toFixed(6)}, height ${rn.height.toFixed(5)} vs ${ro.height.toFixed(5)}, peakVertex ${rn.peakVertex}/${ro.peakVertex}, strutW==floppy max diff ${dsw.toExponential(2)}, feature ids ${[...feats].join(',')}`);
  // struts and softW via the SoftBody (private fields)
  const bn: any = new nSB(g, { detail }), bo: any = new oSB(g, { detail });
  let same = bn.ns === bo.ns, dl = 0;
  if (same) for (let k = 0; k < bn.ns * 2; k++) if (bn.S3[k] !== bo.S3[k]) { same = false; break; }
  if (same) for (let k = 0; k < bn.ns; k++) dl = Math.max(dl, Math.abs(bn.SL[k] - bo.SL[k]));
  let dsoft = 0; for (let i = 0; i < bn.n; i++) dsoft = Math.max(dsoft, Math.abs(bn.softW[i] - bo.softW[i]));
  let dQ = 0; for (let i = 0; i < bn.Q.length; i++) dQ = Math.max(dQ, Math.abs(bn.Q[i] - bo.Q[i]));
  // params that differ
  const pd: string[] = [];
  for (const k of Object.keys(bo.params)) if (typeof bo.params[k] === 'number' && Math.abs(bn.params[k] - bo.params[k]) > 1e-12 * Math.max(1, Math.abs(bo.params[k]))) pd.push(`${k} ${bo.params[k].toPrecision(5)}->${bn.params[k].toPrecision(5)}`);
  console.log(`  SoftBody ${gn} d${detail}: struts ${bn.ns}/${bo.ns} identical ends ${same}, max|dlen| ${dl.toExponential(2)}, max|dsoftW| ${dsoft.toExponential(2)}, max|dQ| ${dQ.toExponential(2)}, family ${bn.family}; params changed: ${pd.join(', ') || 'none'}`);
}
