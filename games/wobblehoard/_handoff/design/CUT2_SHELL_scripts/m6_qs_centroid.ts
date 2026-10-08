// M6: the same defect class in the fold goal QS (softbody.ts ctor: QS = rs * unit rest directions): is its mass-weighted centroid zero?
const G = 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/';
const { buildRest, meshVolume } = await import(G + 'src/physics/shape.ts');
const { buildIcosphere } = await import(G + 'src/physics/mesh.ts');
const { SPECIES } = await import(G + 'src/data/species.ts');
const { speciesTemplateGenome } = await import(G + 'src/data/catalog.ts');
const mesh = buildIcosphere(3);
const out: Array<[string, number]> = [];
for (const sp of SPECIES) {
  const rest = buildRest(speciesTemplateGenome(sp as never), mesh), n = mesh.vertexCount, Q = rest.restLocal, N = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { const l = Math.hypot(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]) || 1; N[i * 3] = Q[i * 3] / l; N[i * 3 + 1] = Q[i * 3 + 1] / l; N[i * 3 + 2] = Q[i * 3 + 2] / l; }
  const rs = Math.cbrt(rest.restVolume / meshVolume(N, mesh.tris));
  let sx = 0, sy = 0, sz = 0, mt = 0;
  for (let i = 0; i < n; i++) { const m = rest.mass[i]; sx += m * N[i * 3] * rs; sy += m * N[i * 3 + 1] * rs; sz += m * N[i * 3 + 2] * rs; mt += m; }
  out.push([sp, Math.hypot(sx, sy, sz) / mt / rest.restRadius]);
}
out.sort((a, b) => b[1] - a[1]);
console.log('mass-weighted centroid of the fold sphere QS, in R0 (0 = momentum free): max ' + out[0][0] + ' ' + out[0][1].toFixed(3) + ', median ' + out[25][1].toFixed(3) + ', min ' + out[49][0] + ' ' + out[49][1].toFixed(3));
console.log('top 5: ' + out.slice(0, 5).map(([s, v]) => s + ' ' + v.toFixed(3)).join(', ') + '   (the chunk flat-face goal: 0.072 R0 for every piece size)');
