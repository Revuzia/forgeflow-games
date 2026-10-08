// M4: random player-like swipes (a plane through the camera that contains a random screen line over the squishy): how often is a cut refused (smaller part under 1/8), and how thin are the pieces it makes?
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
function run(sh: Shape, rule: 'A' | 'B' | 'C'): { pieces: number; minFrac: number; minAspect: number; presses: number; stalledAt: number | null; firstShare: number } {
  const whole: Piece = { region: [], m: moments(sh, []) };
  const V0 = whole.m.V;
  let pieces: Piece[] = [whole], stalledAt: number | null = null, presses = 0, firstShare = 0.5;
  for (let press = 1; press <= 8; press++) {
    if (pieces.length >= 6) break;
    let ti = 0; pieces.forEach((q, i) => { if (q.m.V > pieces[ti].m.V + 1e-12) ti = i; });
    const p = pieces[ti];
    let h: HS;
    if (rule === 'A') h = comPlane(p, unitN(0));
    else if (rule === 'B') h = medianPlane(sh, p, unitN(0));
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


// deterministic RNG
let seed = 12345; const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const C = [0, 0.86, 2.87], T = [0, 0.4, 0];
const sub3 = (a: number[], b: number[]): number[] => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross3 = (a: number[], b: number[]): number[] => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm3 = (a: number[]): number[] => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0]/l, a[1]/l, a[2]/l]; };
const view = norm3(sub3(T, C)), right = norm3(cross3(view, [0, 1, 0])), up = cross3(right, view);
let total = 0, refused = 0, cuts = 0; const asp: number[] = [], shares: number[] = [];
const perSpecies: string[] = [];
const t0 = Date.now();
for (const sp of SPECIES) {
  const mesh = buildIcosphere(3), rest = buildRest(speciesTemplateGenome(sp as never), mesh);
  const sh = columns(rest.restLocal, mesh.tris);
  const whole: Piece = { region: [], m: moments(sh, []) };
  const R = rest.restRadius;
  const yc = rest.restCenterY;   // rest local origin is the centroid; the squishy stands on the table at y = restCenterY
  let sRef = 0, sCut = 0;
  for (let k = 0; k < 120; k++) {
    // a random point on the squishy's screen disc (within 0.95 R of its centre) and a random screen direction
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.95 * R, th = rnd() * Math.PI;
    const P0 = [right[0]*rr*Math.cos(a) + up[0]*rr*Math.sin(a), yc - yc + right[1]*rr*Math.cos(a) + up[1]*rr*Math.sin(a), right[2]*rr*Math.cos(a) + up[2]*rr*Math.sin(a)];
    const d = [right[0]*Math.cos(th) + up[0]*Math.sin(th), right[1]*Math.cos(th) + up[1]*Math.sin(th), right[2]*Math.cos(th) + up[2]*Math.sin(th)];
    // the squishy's centre in this local frame is the origin; the camera looks at (0, 0.4, 0) in the table frame: shift the camera by the centre height
    const Cc = [C[0], C[1] - yc, C[2]];
    const n = norm3(cross3(sub3(P0, Cc), d));
    const dd = n[0]*P0[0] + n[1]*P0[1] + n[2]*P0[2];
    const A = moments(sh, [{ n: n as [number, number, number], d: dd }]), B = moments(sh, [{ n: [-n[0], -n[1], -n[2]], d: -dd }]);
    total++;
    const small = Math.min(A.V, B.V) / whole.m.V;
    if (small < 0.125) { refused++; sRef++; continue; }
    cuts++; sCut++;
    shares.push(small);
    asp.push(Math.min(aspect(A), aspect(B)));
  }
  perSpecies.push(sp + ':' + sCut + '/' + (sCut + sRef));
}
asp.sort((x, y) => x - y);
const q = (p: number): number => asp[Math.min(asp.length - 1, Math.floor(p * asp.length))];
const f = (x: number, d = 3): string => x.toFixed(d);
console.log('swipes sampled ' + total + ' (50 species x 120); refused as under 1/8: ' + refused + ' (' + f(100 * refused / total, 1) + ' %); accepted ' + cuts);
console.log('accepted cuts, the smaller piece share: median ' + f(shares.sort((x, y) => x - y)[Math.floor(shares.length / 2)], 3) + ';  aspect of the thinner part (1 = ball): min ' + f(asp[0], 2) + ', p5 ' + f(q(0.05), 2) + ', p10 ' + f(q(0.10), 2) + ', median ' + f(q(0.5), 2));
console.log('share of accepted cuts whose thinner part has aspect < 0.10: ' + f(100 * asp.filter((x) => x < 0.10).length / asp.length, 1) + ' %,  < 0.15: ' + f(100 * asp.filter((x) => x < 0.15).length / asp.length, 1) + ' %,  < 0.20: ' + f(100 * asp.filter((x) => x < 0.20).length / asp.length, 1) + ' %');
console.log('accepted per species (first 20): ' + perSpecies.slice(0, 20).join(' '));
console.log('(' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
