// M1: why does a chunk push itself off its cut face?  Hypothesis: flatPoints() (shape.ts) does not re-centre the flat-face goal, so the goal's
// mass-weighted centroid sits away from the rest centre and the shape-matching goal (softbody.ts substep: GOAL = c + R * QG) drags the
// whole body's centre of mass along -cutNormal every substep while flatK > 0 (ROUND_TAU 2 s; putty 6 s).
// Independent test: (a) the pure geometry: mass-weighted centroid of the flat goal, in R0; (b) the REAL SoftBody: a chunk built as the shell builds
// it, 1.5 s of stepping, peak centre speed; (c) the same chunk with its FLAT goal re-centred in place (the one-line fix) -> if the launch vanishes,
// that is the cause.  (d) the face piece (chunk:false) as a control.
const G = 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/';
const { SoftBody } = await import(G + 'src/physics/softbody.ts');
const { buildChunkRest, flatPoints } = await import(G + 'src/physics/shape.ts');
const { buildIcosphere } = await import(G + 'src/physics/mesh.ts');
const { speciesTemplateGenome } = await import(G + 'src/data/catalog.ts');

const f = (x: number, d = 3): string => x.toFixed(d);
// (a) pure geometry
console.log('--- (a) mass-weighted centroid of the flat-face goal, in units of the piece radius R0 (cut face toward -x)');
for (const frac of [0.125, 0.25, 0.5, 0.75]) {
  const detail = frac < 0.35 ? 2 : 3;
  const mesh = buildIcosphere(detail);
  const R0 = 0.5 * Math.cbrt(frac);
  const rest = buildChunkRest(mesh, R0);
  const FL = new Float64Array(rest.restLocal.length);
  flatPoints(rest.restLocal, mesh.tris, rest.restRadius, -1, 0, 0, FL);
  let sx = 0, sy = 0, sz = 0, mt = 0;
  const n = mesh.vertexCount;
  for (let i = 0; i < n; i++) { const m = rest.mass[i]; sx += m * FL[i * 3]; sy += m * FL[i * 3 + 1]; sz += m * FL[i * 3 + 2]; mt += m; }
  let rx = 0; for (let i = 0; i < n; i++) rx += rest.mass[i] * rest.restLocal[i * 3];
  console.log(`frac ${frac} detail ${detail}: centroid of FLAT = (${f(sx / mt / R0)}, ${f(sy / mt / R0)}, ${f(sz / mt / R0)}) R0 = ${f(sx / mt, 4)} m;   centroid of the rest shape = ${f(rx / mt / R0, 6)} R0`);
}

// (b)(c)(d) the real SoftBody
type Priv = { FLAT: Float64Array; M: Float64Array; Mtot: number; n: number };
function trial(species: string, frac: number, chunk: boolean, recentre: boolean, normal = { x: -1, y: 0, z: 0 }): { peak: number; peakAt: number; far: number; y: number; vAt1: number } {
  const b = new SoftBody(speciesTemplateGenome(species as never), { piece: { frac, chunk, cutNormal: normal, at: { x: 0, y: 0.6, z: 0 } } } as never);
  if (recentre && chunk) {
    const p = b as unknown as Priv;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < p.n; i++) { sx += p.M[i] * p.FLAT[i * 3]; sy += p.M[i] * p.FLAT[i * 3 + 1]; sz += p.M[i] * p.FLAT[i * 3 + 2]; }
    sx /= p.Mtot; sy /= p.Mtot; sz /= p.Mtot;
    for (let i = 0; i < p.n; i++) { p.FLAT[i * 3] -= sx; p.FLAT[i * 3 + 1] -= sy; p.FLAT[i * 3 + 2] -= sz; }
  }
  let peak = 0, peakAt = 0, far = 0, ymax = 0, vAt1 = 0, prev = { ...b.center };
  const x0 = b.center.x, z0 = b.center.z;
  for (let s = 1; s <= 90; s++) {
    b.step(1 / 60);
    const c = b.center, v = Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z) * 60;
    prev = { x: c.x, y: c.y, z: c.z };
    if (v > peak) { peak = v; peakAt = s / 60; }
    far = Math.max(far, Math.hypot(c.x - x0, c.z - z0)); ymax = Math.max(ymax, c.y);
    if (s === 60) vAt1 = v;
  }
  return { peak, peakAt, far, y: ymax, vAt1 };
}
console.log('--- (b)(c)(d) the real SoftBody, 1.5 s, piece built at (0, 0.6, 0), v = 0 (the shell adds a 0.22 m/s push; left out here to see the pure effect)');
console.log('species  frac  kind                  peak speed (m/s)  at (s)   farthest drift (m)   highest centre (m)');
for (const sp of ['dollop', 'kneadle', 'chunkle', 'thudge', 'prismelo', 'diademo', 'dimpla']) {
  for (const frac of [0.5, 0.25]) {
    const a = trial(sp, frac, true, false), c = trial(sp, frac, true, true), d = trial(sp, frac, false, false);
    console.log(`${sp.padEnd(8)} ${f(frac, 2)}  chunk (as built)      ${f(a.peak, 2).padStart(8)}          ${f(a.peakAt, 2)}     ${f(a.far, 3).padStart(8)}             ${f(a.y, 3)}`);
    console.log(`${sp.padEnd(8)} ${f(frac, 2)}  chunk, FLAT recentred ${f(c.peak, 2).padStart(8)}          ${f(c.peakAt, 2)}     ${f(c.far, 3).padStart(8)}             ${f(c.y, 3)}`);
    console.log(`${sp.padEnd(8)} ${f(frac, 2)}  face piece (control)  ${f(d.peak, 2).padStart(8)}          ${f(d.peakAt, 2)}     ${f(d.far, 3).padStart(8)}             ${f(d.y, 3)}`);
  }
}
