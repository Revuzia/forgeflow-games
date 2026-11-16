// M3: the keyboard player's route to 6 pieces.  "Split in two" repeated on the largest piece, on all 50 species' REST shapes, with exact nested regions
// (a piece = the rest silhouette AND a list of half-spaces; volumes and second moments by exact integration along x over a 96 x 96 grid of
// columns).  Three rules:
//   A  the plane through the piece's CENTRE OF MASS, always the camera-vertical plane (normal +x)         (what the shell did before SHELL-4 fix 1)
//   B  the MEDIAN plane (exactly half the piece's volume), same normal                                      (parallel slabs)
//   C  the median plane, normal chosen among 4 vertical planes (0, 45, 90, 135 degrees from the camera's right) for the most compact halves
// A press is refused when a part would be under 1/8 of the WHOLE (or the limit 6 is reached).  Reports pieces reached, the smallest piece, and the
// worst "aspect" (sqrt(smallest / largest eigenvalue of the piece's covariance): 1 = ball, 0.2 = a pancake) over the final pieces.
const G = 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/';
const { buildRest } = await import(G + 'src/physics/shape.ts');
const { buildIcosphere } = await import(G + 'src/physics/mesh.ts');
const { SPECIES } = await import(G + 'src/data/species.ts');
const { speciesTemplateGenome } = await import(G + 'src/data/catalog.ts');

const NY = 96, NZ = 96;
type HS = { n: [number, number, number]; d: number };
interface Shape { cols: Array<Float64Array>; y: Float64Array; z: Float64Array; dA: number }
function columns(P: Float64Array, tris: Uint32Array): Shape {
  let y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 3) { y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  const hy = (y1 - y0) / NY, hz = (z1 - z0) / NZ;
  const y = new Float64Array(NY), z = new Float64Array(NZ);
  for (let i = 0; i < NY; i++) y[i] = y0 + (i + 0.5) * hy;
  for (let k = 0; k < NZ; k++) z[k] = z0 + (k + 0.5) * hz;
  const xs: number[][] = Array.from({ length: NY * NZ }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ay = P[a + 1], az = P[a + 2], by = P[b + 1], bz = P[b + 2], cy = P[c + 1], cz = P[c + 2];
    const det = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    if (Math.abs(det) < 1e-15) continue;
    const iy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / hy - 0.5)), iy1 = Math.min(NY - 1, Math.ceil((Math.max(ay, by, cy) - y0) / hy));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / hz - 0.5)), iz1 = Math.min(NZ - 1, Math.ceil((Math.max(az, bz, cz) - z0) / hz));
    for (let i = iy0; i <= iy1; i++) for (let k = iz0; k <= iz1; k++) {
      const py = y[i], pz = z[k];
      const u = ((py - ay) * (cz - az) - (pz - az) * (cy - ay)) / det, v = ((by - ay) * (pz - az) - (bz - az) * (py - ay)) / det;
      if (u < 0 || v < 0 || u + v >= 1) continue;
      xs[i * NZ + k].push(P[a] + u * (P[b] - P[a]) + v * (P[c] - P[a]));
    }
  }
  const cols = xs.map((l) => { l.sort((p, q) => p - q); return Float64Array.from(l); });
  return { cols, y, z, dA: hy * hz };
}
interface Mom { V: number; S: [number, number, number]; C: number[] }   // volume, first moments, second moments xx yy zz xy xz yz
function moments(sh: Shape, region: HS[]): Mom {
  let V = 0, Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Syy = 0, Szz = 0, Sxy = 0, Sxz = 0, Syz = 0;
  for (let i = 0; i < NY; i++) for (let k = 0; k < NZ; k++) {
    const c = sh.cols[i * NZ + k]; if (c.length < 2) continue;
    const y = sh.y[i], z = sh.z[k];
    let lo = -1e9, hi = 1e9, ok = true;
    for (const h of region) {
      const rhs = h.d - h.n[1] * y - h.n[2] * z, a = h.n[0];
      if (Math.abs(a) < 1e-12) { if (rhs > 0) { ok = false; break; } } else if (a > 0) lo = Math.max(lo, rhs / a); else hi = Math.min(hi, rhs / a);
    }
    if (!ok || lo >= hi) continue;
    for (let j = 0; j + 1 < c.length; j += 2) {
      const a = Math.max(lo, c[j]), b = Math.min(hi, c[j + 1]); if (b <= a) continue;
      const L = b - a, m1 = (b * b - a * a) / 2, m2 = (b * b * b - a * a * a) / 3, dA = sh.dA;
      V += L * dA; Sx += m1 * dA; Sy += y * L * dA; Sz += z * L * dA;
      Sxx += m2 * dA; Syy += y * y * L * dA; Szz += z * z * L * dA; Sxy += y * m1 * dA; Sxz += z * m1 * dA; Syz += y * z * L * dA;
    }
  }
  return { V, S: [Sx, Sy, Sz], C: [Sxx, Syy, Szz, Sxy, Sxz, Syz] };
}
function aspect(m: Mom): number {
  if (!(m.V > 0)) return 0;
  const cx = m.S[0] / m.V, cy = m.S[1] / m.V, cz = m.S[2] / m.V;
  const a = m.C[0] / m.V - cx * cx, b = m.C[1] / m.V - cy * cy, c = m.C[2] / m.V - cz * cz, d = m.C[3] / m.V - cx * cy, e = m.C[4] / m.V - cx * cz, f = m.C[5] / m.V - cy * cz;
  // eigenvalues of the symmetric 3x3 [[a d e],[d b f],[e f c]] (trigonometric form)
  const p1 = d * d + e * e + f * f, q = (a + b + c) / 3;
  const p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
  if (p < 1e-15) return 1;
  const B = [[(a - q) / p, d / p, e / p], [d / p, (b - q) / p, f / p], [e / p, f / p, (c - q) / p]];
  const detB = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
  const r = Math.max(-1, Math.min(1, detB / 2)), phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return Math.sqrt(Math.max(1e-12, e3) / Math.max(1e-12, e1));
}
interface Piece { region: HS[]; m: Mom }
const unitN = (deg: number): [number, number, number] => [Math.cos(((deg + 7) * Math.PI) / 180), 0, Math.sin(((deg + 7) * Math.PI) / 180)];
function medianPlane(sh: Shape, p: Piece, n: [number, number, number]): HS {
  let lo = -1.5, hi = 1.5;
  const share = (d: number): number => moments(sh, [...p.region, { n, d }]).V / p.m.V;   // share on the +n side
  for (let it = 0; it < 34; it++) { const mid = 0.5 * (lo + hi); if (share(mid) > 0.5) lo = mid; else hi = mid; }
  return { n, d: 0.5 * (lo + hi) };
}
function comPlane(p: Piece, n: [number, number, number]): HS {
  const cx = p.m.S[0] / p.m.V, cy = p.m.S[1] / p.m.V, cz = p.m.S[2] / p.m.V;
  return { n, d: n[0] * cx + n[1] * cy + n[2] * cz };
}
const flip = (h: HS): HS => ({ n: [-h.n[0], -h.n[1], -h.n[2]], d: -h.d });
function run(sh: Shape, rule: 'A' | 'B' | 'C' | 'D'): { pieces: number; minFrac: number; minAspect: number; presses: number; stalledAt: number | null; firstShare: number } {
  const whole: Piece = { region: [], m: moments(sh, []) };
  const V0 = whole.m.V;
  let pieces: Piece[] = [whole], stalledAt: number | null = null, presses = 0, firstShare = 0.5;
  for (let press = 1; press <= 8; press++) {
    if (pieces.length >= 6) break;
    let ti = 0; pieces.forEach((q, i) => { if (q.m.V > pieces[ti].m.V + 1e-12) ti = i; });
    const p = pieces[ti];
    let h: HS;
    if (rule === 'A') h = comPlane(p, unitN(0));
    else if (rule === 'B' || (rule === 'D' && pieces.length === 1)) h = medianPlane(sh, p, unitN(0));
    else {
      let best: HS | null = null, bestA = -1;
      for (const deg of [0, 45, 90, 135]) {
        const hh = medianPlane(sh, p, unitN(deg));
        const a1 = aspect(moments(sh, [...p.region, hh])), a2 = aspect(moments(sh, [...p.region, flip(hh)])), a = Math.min(a1, a2);
        if (a > bestA + 1e-3) { bestA = a; best = hh; }
      }
      h = best!;
    }
    const A: Piece = { region: [...p.region, h], m: moments(sh, [...p.region, h]) }, B: Piece = { region: [...p.region, flip(h)], m: moments(sh, [...p.region, flip(h)]) };
    if (press === 1) firstShare = A.m.V / V0;
    if (Math.min(A.m.V, B.m.V) / V0 < 0.125 - 2e-3) { if (stalledAt === null) stalledAt = pieces.length; break; }
    pieces = pieces.flatMap((q, i) => (i === ti ? [A, B] : [q]));
    presses++;
  }
  return { pieces: pieces.length, minFrac: Math.min(...pieces.map((q) => q.m.V / V0)), minAspect: Math.min(...pieces.map((q) => aspect(q.m))), presses, stalledAt, firstShare };
}

const rows: Record<string, ReturnType<typeof run>[]> = { D: [] };
const names: string[] = [];
const t0 = Date.now();
for (const sp of SPECIES) {
  const mesh = buildIcosphere(3), rest = buildRest(speciesTemplateGenome(sp as never), mesh);
  const Pr = new Float64Array(rest.restLocal.length), ca = Math.cos(0.12), sa = Math.sin(0.12); for (let i = 0; i < Pr.length; i += 3) { const x = rest.restLocal[i], z = rest.restLocal[i + 2]; Pr[i] = ca * x + sa * z; Pr[i + 1] = rest.restLocal[i + 1]; Pr[i + 2] = -sa * x + ca * z; }
  const sh = columns(Pr, mesh.tris);
  names.push(sp);
  rows.D.push(run(sh, 'D'));
}
const f = (x: number, d = 3): string => x.toFixed(d);
for (const r of ['D'] as const) {
  const R = rows[r];
  const reach6 = R.filter((x) => x.pieces >= 6).length;
  const hist: Record<number, number> = {}; R.forEach((x) => { hist[x.pieces] = (hist[x.pieces] ?? 0) + 1; });
  const asp = R.map((x) => x.minAspect).sort((a, b) => a - b);
  console.log(`rule ${r}: reach 6 pieces on ${reach6}/50 species; pieces reached histogram ${JSON.stringify(hist)}; smallest piece anywhere (grid allowance 0.002) ${f(Math.min(...R.map((x) => x.minFrac)), 4)};`
    + ` worst aspect (final pieces) min ${f(asp[0], 2)} median ${f(asp[25], 2)} p90-best ${f(asp[45], 2)}`);
}
const worstD = names.map((n, i) => [n, rows.D[i].minAspect] as const).sort((a, b) => a[1] - b[1]).slice(0, 6).map(([n, a]) => n + ' ' + f(a, 2)).join(', ');
console.log('thinnest final pieces, rule D: ' + worstD);
