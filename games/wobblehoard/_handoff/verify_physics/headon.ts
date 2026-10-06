import { argOf, v3 } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/c47/games/wobblehoard');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const DT = 1 / 60;
function inside(P: ArrayLike<number>, tris: ArrayLike<number>, x: number, y: number, z: number): boolean {
  const dx = 1, dy = 1e-4, dz = 2.3e-4; let c = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, cc = tris[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const id = 1 / det, tx = x - P[a], ty = y - P[a + 1], tz = z - P[a + 2], u = (tx * px + ty * py + tz * pz) * id; if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * id; if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * id > 0) c++;
  }
  return (c & 1) === 1;
}
const deepest = (A: any, B: any): number => { let w = 0; const P = A.positions, Q = B.positions; for (let j = 0; j < P.length; j += 3) { if (!inside(Q, B.indices, P[j], P[j + 1], P[j + 2])) continue; let md = 1e9; for (let k = 0; k < Q.length; k += 3) md = Math.min(md, Math.hypot(P[j] - Q[k], P[j + 1] - Q[k + 1], P[j + 2] - Q[k + 2])); w = Math.max(w, md / B.restRadius); } return w; };
for (const mode of ['float', 'airborne toss']) for (const sp of [3, 6, 12]) for (const fr of [0.125, 0.3, 1]) for (const pair of [['tadpolo', 'boingle'], ['twangle', 'munchip']]) {
  const A: any = new SoftBody(speciesTemplateGenome(pair[0]), { piece: { frac: fr, chunk: fr < 1, at: v3(-0.9, 0, 0) } }), B: any = new SoftBody(speciesTemplateGenome(pair[1]), { piece: { frac: fr, chunk: fr < 1, at: v3(0.9, 0, 0) } });
  const two = [A, B];
  if (mode === 'float') { A.gravity = false; B.gravity = false; }
  for (let i = 0; i < 30; i++) { for (const b of two) b.collide(two); for (const b of two) b.step(DT); }
  const vy = mode === 'float' ? 0 : 2.5;
  A.nudge(v3(sp, vy, 0)); B.nudge(v3(-sp, vy, 0));
  let crossed = false, minGap = 9, deep = 0;
  for (let i = 0; i < 120; i++) { for (const b of two) b.collide(two); for (const b of two) b.step(DT); const gap = B.center.x - A.center.x; minGap = Math.min(minGap, gap); if (gap < 0) crossed = true; if (i % 2 === 0) deep = Math.max(deep, deepest(A, B), deepest(B, A)); }
  console.log(`${mode.padEnd(13)} ${sp} m/s each ${pair.join('/')} frac ${fr}: crossed ${crossed}, min centre gap ${minGap.toFixed(3)} m (radii ${A.restRadius.toFixed(2)}+${B.restRadius.toFixed(2)}), deepest particle inside the other ${deep.toFixed(2)} R`);
}
