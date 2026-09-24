// DYEFIELD — paint/coverage probe (CONTRACT §7 gate G1). Plain node, exit code.
//
//   node _harness/probe_paint.ts            # synthetic soup checks + map_pier18.glb checks
//   node _harness/probe_paint.ts --synth    # synthetic checks only
//   node _harness/probe_paint.ts --glb <file> # map section on another GLB (as map pier18; debugging)
//
// Synthetic soup (built in code, atlas 256², 10 texels/m unless noted):
//   floor 10×10 m (y=0) · shelf 2×2 m over the floor (y=1) · 30° ramp 4×5 m on a UV island
//   rotated 30° · 70° steep face 2×3 m at 15 texels/m · a 10×3 m wall pair back to back 0.2 m
//   apart (front −Z, back +Z) with its top and two ends. Every island is separate in UV2.
// Checks: analytic areas (±1 %), floor/wall flags and weights, texel positions and normals,
// noise bytes, the raster tie rule (no overlaps on a shared diagonal through texel centres),
// gutter mirrors vs a brute-force nearest search, splat radius (exact and noisy), the facing
// filter (a thin wall is not painted through), capsules, incremental totals vs a full recount,
// onFlip, dirty spans incl. mirrors, surfaceAt vs brute force, teamUnder, reset, hash
// determinism, splat cost, and the minimap (ownership, top-most, incremental == rebuild).
// Map section (art/gltf/map_pier18.glb): every G1 map check plus timings.
//
// Exit: 0 = every check passed (map section may be SKIPPED only when the GLB does not exist
// yet) · 1 = a check failed · 2 = the modules could not be loaded.
// Harness code: performance.now() is used only for timings.

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type RngMod = typeof import('../runtime/src/core/rng.ts');
type AtlasMod = typeof import('../runtime/src/core/paint/atlas.ts');
type PainterMod = typeof import('../runtime/src/core/paint/painter.ts');
type MinimapMod = typeof import('../runtime/src/core/paint/minimap.ts');
type MapgeoMod = typeof import('../runtime/src/core/mapgeo.ts');
type GlbMod = typeof import('../runtime/src/core/glb.ts');
type DataMod = typeof import('../runtime/src/core/data.ts');
type TriSoup = import('../runtime/src/core/mapgeo.ts').TriSoup;
type PaintAtlas = import('../runtime/src/core/paint/atlas.ts').PaintAtlas;
type TeamId = import('../runtime/src/core/types.ts').TeamId;

let R: RngMod, AT: AtlasMod, PA: PainterMod, MM: MinimapMod, MG: MapgeoMod, GL: GlbMod, DA: DataMod;

async function loadModules(): Promise<string | null> {
  try {
    R = await import('../runtime/src/core/rng.ts');
    AT = await import('../runtime/src/core/paint/atlas.ts');
    PA = await import('../runtime/src/core/paint/painter.ts');
    MM = await import('../runtime/src/core/paint/minimap.ts');
    MG = await import('../runtime/src/core/mapgeo.ts');
    GL = await import('../runtime/src/core/glb.ts');
    DA = await import('../runtime/src/core/data.ts');
    return null;
  } catch (e) {
    return (e as Error)?.stack ?? String(e);
  }
}

// ── reporting ──────────────────────────────────────────────────────────────────────────────────
let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): boolean {
  if (ok) passes++; else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}
let warnings = 0;
/** Beyond-G1 data checks (MAP-lane data vs maps.json): printed and counted, never fail the gate. */
function warn(name: string, ok: boolean, detail = ''): boolean {
  if (!ok) warnings++;
  console.log(`${ok ? 'PASS' : 'WARN'}  ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}
function section(title: string): void { console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 86 - title.length))}`); }
const f3 = (v: number): string => v.toFixed(3);
const pct = (a: number, b: number): string => `${(((a - b) / b) * 100).toFixed(3)} %`;
function relErr(a: number, b: number): number { return Math.abs(a - b) / Math.max(1e-12, Math.abs(b)); }
function percentile(v: number[], p: number): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
}

// ── synthetic soup ─────────────────────────────────────────────────────────────────────────────
type V3 = [number, number, number];
type V2 = [number, number];
const S_SYN = 256;

interface Group { name: string; area: number; floor: boolean; pos: V3[]; uv: V2[] }

function buildSyntheticSoup(): { soup: TriSoup; groups: Group[] } {
  const groups: Group[] = [];
  const T = (u: number, v: number): V2 => [u / S_SYN, v / S_SYN]; // texel coords → UV
  const quad = (name: string, area: number, floor: boolean, pos: V3[], uv: V2[]): void => {
    groups.push({ name, area, floor, pos, uv });
  };
  // floor: x→u, z→v; normal +Y (p0→p1 = +z, p0→p3 = +x)
  quad('floor', 100, true,
    [[0, 0, 0], [0, 0, 10], [10, 0, 10], [10, 0, 0]],
    [T(4, 4), T(4, 104), T(104, 104), T(104, 4)]);
  quad('shelf', 4, true,
    [[7, 1, 7], [7, 1, 9], [9, 1, 9], [9, 1, 7]],
    [T(112, 4), T(112, 24), T(132, 24), T(132, 4)]);
  // 30° ramp: x 12..16, rises along +z to y 2.5 over 5 m of surface; UV island 40×50 rotated 30°
  {
    const L = 5, rise = L * Math.sin(Math.PI / 6), run = L * Math.cos(Math.PI / 6);
    const th = Math.PI / 6, c = Math.cos(th), s = Math.sin(th);
    const rot = (sx: number, ty: number): V2 => {
      const a = sx - 20, b = ty - 25;
      return T(175 + a * c - b * s, 40 + a * s + b * c);
    };
    quad('ramp', 20, true,
      [[12, 0, 0], [12, rise, run], [16, rise, run], [16, 0, 0]],
      [rot(0, 0), rot(0, 50), rot(40, 50), rot(40, 0)]);
  }
  // 70° steep face: x 18..20, 3 m long up the slope; 15 texels/m (30×45 texels)
  {
    const th = (70 * Math.PI) / 180, L = 3;
    const dy = L * Math.sin(th), dz = L * Math.cos(th);
    quad('steep', 6, false,
      [[18, 0, 0], [18, dy, dz], [20, dy, dz], [20, 0, 0]],
      [T(212, 8), T(212, 53), T(242, 53), T(242, 8)]);
  }
  // wall pair: front face z=12 (normal −Z), back face z=12.2 (normal +Z)
  quad('front', 30, false,
    [[0, 0, 12], [0, 3, 12], [10, 3, 12], [10, 0, 12]],
    [T(4, 112), T(4, 142), T(104, 142), T(104, 112)]);
  quad('back', 30, false,
    [[0, 0, 12.2], [10, 0, 12.2], [10, 3, 12.2], [0, 3, 12.2]],
    [T(4, 150), T(104, 150), T(104, 180), T(4, 180)]);
  quad('top', 2, true,
    [[0, 3, 12], [0, 3, 12.2], [10, 3, 12.2], [10, 3, 12]],
    [T(4, 188), T(4, 190), T(104, 190), T(104, 188)]);
  quad('endL', 0.6, false,
    [[0, 0, 12], [0, 0, 12.2], [0, 3, 12.2], [0, 3, 12]],
    [T(112, 112), T(114, 112), T(114, 142), T(112, 142)]);
  quad('endR', 0.6, false,
    [[10, 0, 12], [10, 3, 12], [10, 3, 12.2], [10, 0, 12.2]],
    [T(120, 112), T(120, 142), T(122, 142), T(122, 112)]);

  const nq = groups.length;
  const positions = new Float32Array(nq * 4 * 3);
  const normals = new Float32Array(nq * 4 * 3);
  const uv1 = new Float32Array(nq * 4 * 2);
  const indices = new Uint32Array(nq * 6);
  const triMaterial = new Uint16Array(nq * 2);
  groups.forEach((g, q) => {
    const [p0, p1, , p3] = g.pos;
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 4; k++) {
      positions.set(g.pos[k], (q * 4 + k) * 3);
      normals.set([nx, ny, nz], (q * 4 + k) * 3);
      uv1.set(g.uv[k], (q * 4 + k) * 2);
    }
    // quads mix UV orientations (e.g. floor maps CW in UV, back CCW), so both raster paths run
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    triMaterial[q * 2] = q; triMaterial[q * 2 + 1] = q;
  });
  return { soup: { positions, normals, uv1, indices, triMaterial, materials: groups.map((g) => `M_${g.name}`) }, groups };
}

const SYN_OPTS = { wallWeight: 0.35, floorMinNy: 0.45 };

/** Which synthetic group a texel belongs to (by world position + normal). */
function groupOf(A: PaintAtlas, id: number): string {
  const x = A.px[id], y = A.py[id], z = A.pz[id], nx = A.nx[id], ny = A.ny[id], nz = A.nz[id];
  if (ny > 0.99 && Math.abs(y) < 1e-4) return 'floor';
  if (ny > 0.99 && Math.abs(y - 1) < 1e-4) return 'shelf';
  if (ny > 0.99 && Math.abs(y - 3) < 1e-4) return 'top';
  if (x > 11.9 && x < 16.1) return 'ramp';
  if (x > 17.9 && x < 20.1) return 'steep';
  if (nz < -0.99) return 'front';
  if (nz > 0.99) return 'back';
  if (nx < -0.99) return 'endL';
  if (nx > 0.99) return 'endR';
  return '?';
}

function bruteNearest(A: PaintAtlas, x: number, y: number, z: number, maxDist: number, kind: 'floor' | 'wall' | 'any'): number {
  let best = -1, bd = maxDist * maxDist;
  for (let i = 0; i < A.count; i++) {
    if (kind === 'floor' && A.floor[i] !== 1) continue;
    if (kind === 'wall' && A.floor[i] !== 0) continue;
    const dx = A.px[i] - x, dy = A.py[i] - y, dz = A.pz[i] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bd || (d2 === bd && (best < 0 || i < best))) { best = i; bd = d2; }
  }
  return best;
}

/** Brute-force gutter/mirror validation over the whole atlas. Returns [ok, detail]. */
function validateMirrors(A: PaintAtlas, gutter: number): [boolean, string] {
  const S = A.size, N = S * S;
  let bad = 0, gutterTexels = 0, firstBad = '';
  for (let l = 0; l < N; l++) {
    const own = A.idOf[l];
    if (own >= 0) {
      if (A.srcOf[l] !== own) { bad++; if (!firstBad) firstBad = `surface lin ${l} srcOf ${A.srcOf[l]} != ${own}`; }
      continue;
    }
    const row = (l / S) | 0, x = l - row * S;
    let best = -1, bd = Infinity;
    for (let dy = -gutter; dy <= gutter; dy++) {
      for (let dx = -gutter; dx <= gutter; dx++) {
        const qx = x + dx, qy = row + dy;
        if (qx < 0 || qy < 0 || qx >= S || qy >= S) continue;
        const j = A.idOf[qy * S + qx];
        if (j < 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bd || (d === bd && j < best)) { best = j; bd = d; }
      }
    }
    if (best >= 0) gutterTexels++;
    if (A.srcOf[l] !== best) { bad++; if (!firstBad) firstBad = `gutter lin ${l} srcOf ${A.srcOf[l]} expected ${best}`; }
  }
  // CSR consistency
  let listed = 0;
  const seen = new Uint8Array(N);
  for (let id = 0; id < A.count; id++) {
    let prev = -1;
    for (let k = A.mirrorStart[id]; k < A.mirrorStart[id + 1]; k++) {
      const l = A.mirrorItems[k];
      listed++;
      if (A.idOf[l] >= 0 || A.srcOf[l] !== id || l <= prev || seen[l]) { bad++; if (!firstBad) firstBad = `mirror CSR id ${id} item ${l}`; }
      seen[l] = 1; prev = l;
    }
  }
  if (listed !== gutterTexels) { bad++; if (!firstBad) firstBad = `mirror items ${listed} != gutter texels ${gutterTexels}`; }
  if (A.mirrorStart[A.count] !== A.mirrorItems.length) { bad++; if (!firstBad) firstBad = 'mirrorStart[count] != mirrorItems.length'; }
  return [bad === 0 && gutterTexels > 0, `${gutterTexels} gutter texels, ${listed} mirror items, ${bad} mismatches${firstBad ? ' (first: ' + firstBad + ')' : ''}`];
}

/** Runs a fixed random splat program; returns the painter. */
function randomProgram(A: PaintAtlas, seed: number, n: number, box: { min: V3; max: V3 }, onEach?: (i: number) => void) {
  const P = new PA.Painter(A);
  const rnd = R.mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const x = box.min[0] + rnd() * (box.max[0] - box.min[0]);
    const y = box.min[1] + rnd() * (box.max[1] - box.min[1]);
    const z = box.min[2] + rnd() * (box.max[2] - box.min[2]);
    const r = 0.3 + rnd() * 1.2;
    const tsel = rnd();
    const team = (tsel < 0.45 ? 1 : tsel < 0.9 ? 2 : 0) as TeamId;
    const useN = rnd() < 0.5;
    const cap = rnd() < 0.25;
    const opts = useN ? { radius: r, team, nx: 0, ny: 1, nz: 0, seed: i } : { radius: r, team, seed: i };
    if (cap) P.capsule(x, y, z, x + (rnd() - 0.5) * 3, y, z + (rnd() - 0.5) * 3, opts);
    else P.splat(x, y, z, opts);
    onEach?.(i);
  }
  return P;
}

function syntheticChecks(): void {
  section('synthetic soup');
  const { soup, groups } = buildSyntheticSoup();
  const t0 = performance.now();
  const A = AT.buildAtlas(soup, S_SYN, SYN_OPTS);
  const buildMs = performance.now() - t0;
  console.log(`atlas ${A.size}² built in ${buildMs.toFixed(1)} ms: ${A.count} texels, ${A.mirrorItems.length} gutter, grid ${A.grid.nx}×${A.grid.ny}×${A.grid.nz} @ ${A.grid.cell} m, overlaps ${A.overlaps}`);

  // ── raster + areas ──
  check('no UV overlaps (shared diagonals pass through texel centres: tie rule)', A.overlaps === 0, `overlaps=${A.overlaps}`);
  const byGroup = new Map<string, { n: number; area: number; floorBad: number; weightBad: number }>();
  for (let id = 0; id < A.count; id++) {
    const g = groupOf(A, id);
    const e = byGroup.get(g) ?? { n: 0, area: 0, floorBad: 0, weightBad: 0 };
    e.n++; e.area += A.area[id];
    const grp = groups.find((q) => q.name === g);
    if (grp) {
      if ((A.floor[id] === 1) !== grp.floor) e.floorBad++;
      if (Math.abs(A.weight[id] - (grp.floor ? 1 : SYN_OPTS.wallWeight)) > 1e-6) e.weightBad++;
    }
    byGroup.set(g, e);
  }
  check('every texel maps to a known surface', !byGroup.has('?'), `unknown=${byGroup.get('?')?.n ?? 0}`);
  let analyticTotal = 0, analyticWeighted = 0;
  for (const g of groups) {
    analyticTotal += g.area;
    analyticWeighted += g.area * (g.floor ? 1 : SYN_OPTS.wallWeight);
    const e = byGroup.get(g.name) ?? { n: 0, area: 0, floorBad: 0, weightBad: 0 };
    check(`area ${g.name.padEnd(5)} within 1 %`, e.n > 0 && relErr(e.area, g.area) <= 0.01,
      `${f3(e.area)} m² vs ${g.area} analytic (${pct(e.area, g.area)}), ${e.n} texels`);
    check(`flags ${g.name.padEnd(5)} floor=${g.floor ? 1 : 0} weight=${g.floor ? 1 : SYN_OPTS.wallWeight}`, e.floorBad === 0 && e.weightBad === 0,
      `floorBad=${e.floorBad} weightBad=${e.weightBad}`);
  }
  check('floor island texel count is exact (100×100)', (byGroup.get('floor')?.n ?? 0) === 10000, `${byGroup.get('floor')?.n}`);
  check('totalArea within 1 % of analytic', relErr(A.totalArea, analyticTotal) <= 0.01, `${f3(A.totalArea)} vs ${f3(analyticTotal)} (${pct(A.totalArea, analyticTotal)})`);
  check('totalWeighted within 1 % of analytic', relErr(A.totalWeighted, analyticWeighted) <= 0.01, `${f3(A.totalWeighted)} vs ${f3(analyticWeighted)} (${pct(A.totalWeighted, analyticWeighted)})`);
  {
    const [w0, w1, w2] = AT.recountWeighted(A);
    check('totalWeighted equals a recount over the arrays', relErr(w0 + w1 + w2, A.totalWeighted) < 1e-12, `${w0 + w1 + w2}`);
  }

  // ── texel positions, normals, noise ──
  {
    let maxErr = 0, nChecked = 0, normBad = 0;
    for (let id = 0; id < A.count; id++) {
      const l = A.lin[id], row = (l / A.size) | 0, x = l - row * A.size;
      const g = groupOf(A, id);
      let ex: V3 | null = null;
      if (g === 'floor') ex = [(x + 0.5 - 4) / 10, 0, (row + 0.5 - 4) / 10];
      else if (g === 'front') ex = [(x + 0.5 - 4) / 10, (row + 0.5 - 112) / 10, 12];
      else if (g === 'back') ex = [(x + 0.5 - 4) / 10, (row + 0.5 - 150) / 10, 12.2];
      else if (g === 'shelf') ex = [7 + (x + 0.5 - 112) / 10, 1, 7 + (row + 0.5 - 4) / 10];
      if (ex) {
        nChecked++;
        maxErr = Math.max(maxErr, Math.abs(A.px[id] - ex[0]), Math.abs(A.py[id] - ex[1]), Math.abs(A.pz[id] - ex[2]));
      }
      if (Math.abs(Math.hypot(A.nx[id], A.ny[id], A.nz[id]) - 1) > 1e-5) normBad++;
    }
    check('texel centres interpolate to the analytic world position', nChecked === 16400 && maxErr < 1e-4, `${nChecked} texels, max err ${maxErr.toExponential(2)} m`);
    check('texel normals are unit length', normBad === 0, `bad=${normBad}`);
    const g = (name: string): number => { for (let i = 0; i < A.count; i++) if (groupOf(A, i) === name) return i; return -1; };
    const fr = g('front'), bk = g('back'), rp = g('ramp');
    check('normals: front −Z, back +Z, ramp ny=cos30°', A.nz[fr] < -0.999 && A.nz[bk] > 0.999 && Math.abs(A.ny[rp] - Math.cos(Math.PI / 6)) < 1e-4,
      `front nz=${f3(A.nz[fr])} back nz=${f3(A.nz[bk])} ramp ny=${f3(A.ny[rp])}`);
    let noiseBad = 0;
    const hist = new Set<number>();
    for (let id = 0; id < A.count; id++) {
      const l = A.lin[id], row = (l / A.size) | 0, x = l - row * A.size;
      if (A.noise[id] !== (R.hash32(x, row, AT.TEXEL_NOISE_SEED) & 255)) noiseBad++;
      hist.add(A.noise[id]);
    }
    check('noise byte = stable hash of texel coords, well spread', noiseBad === 0 && hist.size > 240, `mismatch=${noiseBad}, distinct=${hist.size}`);
  }

  // ── gutter mirrors ──
  {
    const [ok, detail] = validateMirrors(A, 2);
    check('gutter mirrors = nearest surface texel within 2 px (brute force), CSR consistent', ok, detail);
  }

  // ── splat radius ──
  {
    const P = new PA.Painter(A);
    const n = P.splat(5, 0, 5, { radius: 1, team: 1, edgeNoise: 0 });
    let inside = 0, wrong = 0, paintedArea = 0;
    for (let id = 0; id < A.count; id++) {
      const d = Math.hypot(A.px[id] - 5, A.py[id], A.pz[id] - 5);
      const want = d <= 1 ? 1 : 0;
      if (want) inside++;
      if (A.team[id] !== want) wrong++;
      if (A.team[id] === 1) paintedArea += A.area[id];
    }
    check('splat r=1 (no noise) paints exactly the texels within r', n === inside && wrong === 0 && n > 0, `flipped=${n}, expected=${inside}, mismatches=${wrong}`);
    check('splat r=1 painted area ≈ π r² (±3 %)', relErr(paintedArea, Math.PI) < 0.03, `${f3(paintedArea)} m²`);
    P.reset();
    const r = 1.2, e = 0.18;
    const n2 = P.splat(3, 0, 3, { radius: r, team: 2, edgeNoise: e, seed: 7 });
    let innerMiss = 0, outerHit = 0, band = 0, bandHit = 0;
    for (let id = 0; id < A.count; id++) {
      const d = Math.hypot(A.px[id] - 3, A.py[id], A.pz[id] - 3);
      const hit = A.team[id] === 2;
      if (d <= r * (1 - e) && !hit) innerMiss++;
      if (d > r * (1 + e) && hit) outerHit++;
      if (d > r * (1 - e) && d <= r * (1 + e)) { band++; if (hit) bandHit++; }
    }
    check('noisy splat: all texels ≤ r(1−e) painted, none > r(1+e)', n2 > 0 && innerMiss === 0 && outerHit === 0, `flipped=${n2} innerMiss=${innerMiss} outerHit=${outerHit}`);
    check('noisy splat: the edge band is partially painted (organic edge)', band > 0 && bandHit / band > 0.1 && bandHit / band < 0.9, `${bandHit}/${band} band texels painted`);
    const h1 = P.hash();
    P.reset();
    P.splat(3, 0, 3, { radius: r, team: 2, edgeNoise: e, seed: 7 });
    const h2 = P.hash();
    P.reset();
    P.splat(3, 0, 3, { radius: r, team: 2, edgeNoise: e, seed: 8 });
    const h3 = P.hash();
    check('noisy splat is deterministic per seed (and the seed matters)', h1 === h2 && h1 !== h3, `seed7 ${h1}/${h2}, seed8 ${h3}`);
    P.reset();
  }

  // ── facing filter ──
  {
    const P = new PA.Painter(A);
    P.splat(5, 1.5, 12, { radius: 0.6, team: 1, nx: 0, ny: 0, nz: -1 });
    let front = 0, back = 0;
    for (let id = 0; id < A.count; id++) {
      if (A.team[id] !== 1) continue;
      const g = groupOf(A, id);
      if (g === 'front') front++;
      if (g === 'back') back++;
    }
    check('facing filter: splat on the front face paints it and NOT the back face 0.2 m behind', front > 0 && back === 0, `front=${front} back=${back}`);
    P.reset();
    P.splat(5, 1.5, 12, { radius: 0.6, team: 1 });
    let backCtl = 0;
    for (let id = 0; id < A.count; id++) if (A.team[id] === 1 && groupOf(A, id) === 'back') backCtl++;
    check('facing control: without a normal the same splat reaches the back face', backCtl > 0, `back=${backCtl}`);
    P.reset();
    P.splat(5, 1.5, 12.2, { radius: 0.6, team: 2, nx: 0, ny: 0, nz: 1 });
    let f2 = 0, b2 = 0;
    for (let id = 0; id < A.count; id++) {
      if (A.team[id] !== 2) continue;
      const g = groupOf(A, id);
      if (g === 'front') f2++;
      if (g === 'back') b2++;
    }
    check('facing filter from the back side paints only the back face', b2 > 0 && f2 === 0, `front=${f2} back=${b2}`);
    P.reset();
  }

  // ── capsule ──
  {
    const P = new PA.Painter(A);
    const n = P.capsule(2, 0, 2, 8, 0, 2, { radius: 0.5, team: 1, edgeNoise: 0, nx: 0, ny: 1, nz: 0 });
    let expect = 0, wrong = 0;
    for (let id = 0; id < A.count; id++) {
      const x = A.px[id], y = A.py[id], z = A.pz[id];
      const t = Math.max(0, Math.min(1, (x - 2) / 6));
      const d = Math.hypot(x - (2 + 6 * t), y, z - 2);
      const want = d <= 0.5 && A.ny[id] > -0.1 ? 1 : 0;
      if (want) expect++;
      if (A.team[id] !== want) wrong++;
    }
    check('capsule paints exactly the texels within r of the segment', n === expect && wrong === 0 && n > 0, `flipped=${n} expected=${expect} mismatches=${wrong}`);
    P.reset();
  }

  // ── incremental totals, onFlip, coverage ──
  {
    const box = { min: [-1, -0.2, -1] as V3, max: [21, 3.4, 13.2] as V3 };
    const P0 = new PA.Painter(A);
    const shadow = new Uint8Array(A.count);
    let events = 0, badEvents = 0;
    P0.onFlip = (id, from, to) => {
      events++;
      if (shadow[id] !== from || A.team[id] !== to || from === to) badEvents++;
      shadow[id] = to;
    };
    let maxRel = 0, checkpoints = 0;
    const rnd = R.mulberry32(1234);
    for (let i = 0; i < 400; i++) {
      const x = box.min[0] + rnd() * (box.max[0] - box.min[0]);
      const y = box.min[1] + rnd() * (box.max[1] - box.min[1]);
      const z = box.min[2] + rnd() * (box.max[2] - box.min[2]);
      const team = (rnd() < 0.45 ? 1 : rnd() < 0.85 ? 2 : 0) as TeamId;
      P0.splat(x, y, z, { radius: 0.3 + rnd() * 1.2, team, seed: i });
      if (i % 25 === 24) {
        const rc = AT.recountWeighted(A);
        for (const t of [0, 1, 2] as TeamId[]) maxRel = Math.max(maxRel, Math.abs(P0.weighted(t) - rc[t]) / A.totalWeighted);
        checkpoints++;
      }
    }
    const rc = AT.recountWeighted(A);
    const cov = P0.coverage();
    const sum = cov.sun + cov.gulf + cov.neutral;
    check('incremental weighted totals == full recount (16 checkpoints, 400 splats)', maxRel < 1e-9 && checkpoints === 16, `max |Δ|/total = ${maxRel.toExponential(2)}`);
    check('coverage = weighted fractions, sums to 1', Math.abs(sum - 1) < 1e-12 && Math.abs(cov.sun - rc[1] / A.totalWeighted) < 1e-9 && Math.abs(cov.gulf - rc[2] / A.totalWeighted) < 1e-9,
      `sun=${cov.sun.toFixed(4)} gulf=${cov.gulf.toFixed(4)} neutral=${cov.neutral.toFixed(4)} sum=${sum}`);
    let shadowBad = 0;
    for (let id = 0; id < A.count; id++) if (shadow[id] !== A.team[id]) shadowBad++;
    check('onFlip fires once per real change with correct from/to', events === P0.flips && badEvents === 0 && shadowBad === 0 && events > 0,
      `events=${events} flips=${P0.flips} bad=${badEvents} shadowMismatch=${shadowBad}`);
    P0.onFlip = null;
    P0.reset();
    let nonNeutral = 0;
    for (let id = 0; id < A.count; id++) if (A.team[id] !== 0) nonNeutral++;
    check('reset → all neutral, coverage neutral=1, flips=0', nonNeutral === 0 && P0.coverage().neutral === 1 && P0.flips === 0 && P0.weighted(1) === 0,
      `nonNeutral=${nonNeutral} neutral=${P0.coverage().neutral} flips=${P0.flips}`);
  }

  // ── dirty spans incl. mirrors ──
  {
    const P = new PA.Painter(A);
    P.takeDirty(() => { /* drain the reset */ });
    const S = A.size;
    const must = new Uint8Array(S * S);
    let flippedIds = 0, mirrorLins = 0;
    P.onFlip = (id) => {
      flippedIds++;
      must[A.lin[id]] = 1;
      for (let k = A.mirrorStart[id]; k < A.mirrorStart[id + 1]; k++) { must[A.mirrorItems[k]] = 1; mirrorLins++; }
    };
    P.splat(0.2, 0, 0.2, { radius: 0.8, team: 1 });          // floor corner: island edge → mirrors
    P.splat(10, 1.5, 12.1, { radius: 0.7, team: 2 });        // wall end + both faces
    P.capsule(7, 1, 7, 9, 1, 9, { radius: 0.4, team: 1, nx: 0, ny: 1, nz: 0 }); // shelf diagonal
    const covered = new Uint8Array(S * S);
    let spans = 0, lastRow = -1, orderBad = 0, rangeBad = 0;
    P.takeDirty((row, x0, x1) => {
      spans++;
      if (row <= lastRow) orderBad++;
      lastRow = row;
      if (x0 < 0 || x1 >= S || x0 > x1 || row < 0 || row >= S) { rangeBad++; return; }
      for (let x = x0; x <= x1; x++) covered[row * S + x] = 1;
    });
    let missing = 0;
    for (let l = 0; l < S * S; l++) if (must[l] && !covered[l]) missing++;
    let again = 0;
    P.takeDirty(() => { again++; });
    check('takeDirty spans cover every flipped texel AND its gutter mirrors', flippedIds > 0 && mirrorLins > 0 && missing === 0,
      `flipped=${flippedIds}, mirror texels=${mirrorLins}, spans=${spans}, missing=${missing}`);
    check('takeDirty: rows ascending + unique, spans in range (x1 inclusive), then cleared', orderBad === 0 && rangeBad === 0 && again === 0,
      `orderBad=${orderBad} rangeBad=${rangeBad} secondCall=${again}`);
    P.onFlip = null;
    P.reset();
    P.takeDirty(() => { /* drain */ });
  }

  // ── surfaceAt / teamUnder ──
  {
    const P = new PA.Painter(A);
    P.splat(5, 0, 5, { radius: 1, team: 1, nx: 0, ny: 1, nz: 0 });
    P.splat(8, 1, 8, { radius: 0.5, team: 2, nx: 0, ny: 1, nz: 0 }); // shelf only (floor is 1 m below)
    const a = P.teamUnder(5, 0.02, 5), b = P.teamUnder(1, 0.02, 9), c = P.teamUnder(5, 2, 5);
    const d = P.teamUnder(8, 1.02, 8), e = P.teamUnder(8, 0.03, 8);
    check('teamUnder: painted floor → 1, clean floor → 0, 2 m in the air → null', a === 1 && b === 0 && c === null, `a=${a} b=${b} c=${c}`);
    check('teamUnder: on the shelf → 2, on the floor under the shelf → 0', d === 2 && e === 0, `shelf=${d} under=${e}`);
    const w = P.surfaceAt(5, 1.5, 11.9, 0.3, 'wall');
    const wf = P.surfaceAt(5, 1.5, 11.9, 0.3, 'floor');
    const top = P.surfaceAt(5, 3.05, 12.1, 0.3, 'floor');
    check('surfaceAt: wall query hits the front face, floor query there → null, wall top is floor',
      !!w && groupOf(A, w.id) === 'front' && A.floor[w.id] === 0 && Math.abs(w.dist - Math.hypot(w.x - 5, w.y - 1.5, w.z - 11.9)) < 1e-9 && wf === null && !!top && groupOf(A, top.id) === 'top',
      `wall=${w ? groupOf(A, w.id) + ' d=' + f3(w.dist) : 'null'} floor=${wf ? 'hit' : 'null'} top=${top ? groupOf(A, top.id) : 'null'}`);
    const rnd = R.mulberry32(99);
    let mism = 0;
    const kinds = ['any', 'floor', 'wall'] as const;
    for (let i = 0; i < 300; i++) {
      const x = -1 + rnd() * 22, y = -0.3 + rnd() * 3.8, z = -1 + rnd() * 14.4;
      const kind = kinds[i % 3];
      const md = 0.2 + rnd() * 0.8;
      const got = P.nearest(x, y, z, md, kind), want = bruteNearest(A, x, y, z, md, kind);
      if (got !== want) mism++;
    }
    check('surfaceAt/nearest via the grid == brute force over all texels (300 random queries)', mism === 0, `mismatches=${mism}`);
    P.reset();
  }

  // ── determinism ──
  {
    const box = { min: [-1, -0.2, -1] as V3, max: [21, 3.4, 13.2] as V3 };
    const run = (seed: number): string => {
      const B = AT.buildAtlas(buildSyntheticSoup().soup, S_SYN, SYN_OPTS);
      return randomProgram(B, seed, 300, box).hash();
    };
    const h1 = run(42), h2 = run(42), h3 = run(43);
    check('hash(): identical across two full runs (fresh atlas + 300 splats/capsules)', h1 === h2 && /^[0-9a-f]{8}$/.test(h1), `${h1} / ${h2}`);
    check('hash(): a different seed gives a different state', h1 !== h3, `seed43 ${h3}`);
    const fresh = new PA.Painter(AT.buildAtlas(buildSyntheticSoup().soup, S_SYN, SYN_OPTS));
    const hEmpty = fresh.hash();
    fresh.splat(5, 0, 5, { radius: 1, team: 1 });
    fresh.reset();
    check('hash() after reset equals the fresh-atlas hash', fresh.hash() === hEmpty, hEmpty);
  }

  // ── splat cost ──
  {
    const P = new PA.Painter(A);
    const rnd = R.mulberry32(5);
    const times: number[] = [];
    let maxVisited = 0, sumFlipped = 0;
    for (let i = 0; i < 2200; i++) {
      const x = rnd() * 10, z = rnd() * 10;
      const t0 = performance.now();
      const n = P.splat(x, 0, z, { radius: 1.0, team: (1 + (i & 1)) as TeamId, nx: 0, ny: 1, nz: 0, seed: i });
      const dt = performance.now() - t0;
      if (i >= 200) { times.push(dt); maxVisited = Math.max(maxVisited, P.lastVisited); sumFlipped += n; }
    }
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    check('synthetic splat r=1 cost: p99 < 2 ms, visits only touched cells (≪ atlas)', percentile(times, 0.99) < 2 && maxVisited < A.count / 4,
      `avg ${(avg * 1000).toFixed(1)} µs, p99 ${(percentile(times, 0.99) * 1000).toFixed(1)} µs, max ${(Math.max(...times) * 1000).toFixed(1)} µs, max visited ${maxVisited}/${A.count}, avg flipped ${(sumFlipped / times.length).toFixed(0)}`);
    P.reset();
  }

  // ── minimap ──
  {
    const P = new PA.Painter(A);
    const colors = { base: [200, 190, 170] as V3, sun: [255, 138, 31] as V3, gulf: [91, 75, 240] as V3 };
    const M = new MM.MinimapRaster(A, { min: [-2, -2], max: [22, 14], pxPerMeter: 2, colors });
    P.onFlip = (id) => M.apply(id);
    const px = (x: number, z: number): number[] => {
      const [c, r] = M.worldToPixel(x, z).map(Math.floor);
      const q = (r * M.w + c) * 4;
      return [M.rgba[q], M.rgba[q + 1], M.rgba[q + 2], M.rgba[q + 3]];
    };
    const lum = (p: number[]): number => p[0] + p[1] + p[2];
    const [c0, r0] = M.worldToPixel(21.9, 13.9).map(Math.floor), [c1, r1] = M.worldToPixel(-1.9, -1.9).map(Math.floor);
    check('minimap orientation: (max x, max z) → pixel (0,0), (min x, min z) → (w−1, h−1)', c0 === 0 && r0 === 0 && c1 === M.w - 1 && r1 === M.h - 1 && M.w === 48 && M.h === 32,
      `(${c0},${r0}) (${c1},${r1}) size ${M.w}×${M.h}`);
    const shelfBase = px(8, 8), floorBase = px(1, 9), empty = px(15, 12.9);
    const [sc, sr] = M.worldToPixel(8, 8).map(Math.floor);
    const ownShelf = M.ownerAt(sc, sr);
    check('minimap: shelf (y=1) owns its pixels over the floor and reads lighter; empty pixels transparent',
      ownShelf >= 0 && Math.abs(A.py[ownShelf] - 1) < 1e-4 && lum(shelfBase) > lum(floorBase) && floorBase[3] === 255 && empty[3] === 0,
      `shelf owner y=${ownShelf >= 0 ? f3(A.py[ownShelf]) : 'none'} lum ${lum(shelfBase)} vs floor ${lum(floorBase)}, empty alpha ${empty[3]}`);
    P.splat(5, 0, 5, { radius: 1.5, team: 1, nx: 0, ny: 1, nz: 0 });
    const sunPx = px(5, 5);
    check('minimap: pixel under a SUNCREW splat turns SUNCREW', sunPx[0] > 200 && sunPx[2] < 60 && sunPx[3] === 255, `rgba=${sunPx.join(',')}`);
    P.splat(8, 0, 8, { radius: 0.6, team: 2, nx: 0, ny: 1, nz: 0 }); // floor under the shelf only
    const underShelf = px(8, 8);
    check('minimap: painting the floor under the shelf does not change the shelf pixel', underShelf.join() === shelfBase.join(), `rgba=${underShelf.join(',')}`);
    P.splat(8, 1, 8, { radius: 0.6, team: 2, nx: 0, ny: 1, nz: 0 });
    const gulfPx = px(8, 8);
    check('minimap: painting the shelf turns its pixel GULF CREW', gulfPx[2] > 200 && gulfPx[0] < 120, `rgba=${gulfPx.join(',')}`);
    const snapshot = M.rgba.slice();
    M.rebuild();
    let diff = 0;
    for (let i = 0; i < snapshot.length; i++) if (snapshot[i] !== M.rgba[i]) diff++;
    check('minimap: incremental apply() == full rebuild()', diff === 0, `differing bytes=${diff}`);
    P.onFlip = null;
    P.reset();
  }
}

// ── map section ───────────────────────────────────────────────────────────────────────────────
async function mapChecks(glbPath: string, custom: boolean): Promise<void> {
  const loadGeo = async (): Promise<import('../runtime/src/core/mapgeo.ts').MapGeometry> =>
    custom ? MG.extractMapGeometry(await GL.loadGlb(glbPath), DA.mapById('pier18')) : MG.loadMapGeometry(DA.mapById('pier18'));
  section('map_pier18.glb');
  const def = DA.mapById('pier18');
  const scoring = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const st = statSync(glbPath);
  console.log(`file ${glbPath} (${(st.size / 1e6).toFixed(2)} MB, modified ${st.mtime.toISOString()})`);

  let t = performance.now();
  const geo = await loadGeo(); // default: the game's real path (artUrl → file:// → loadGlb)
  const loadMs = performance.now() - t;
  const paintTris = geo.paint.indices.length / 3, colTris = geo.collision.indices.length / 3;
  console.log(`load+parse+extract ${loadMs.toFixed(1)} ms · paint tris ${paintTris} · collision tris ${colTris} · atlas ${geo.atlasSize}² · tpm ${geo.texelsPerMeter} · df_paint_area ${f3(geo.paintArea)} m²`);
  console.log(`spawn A (${f3(geo.spawns.A.x)}, ${f3(geo.spawns.A.y)}, ${f3(geo.spawns.A.z)}) yaw ${f3(geo.spawns.A.yaw)} · spawn B (${f3(geo.spawns.B.x)}, ${f3(geo.spawns.B.y)}, ${f3(geo.spawns.B.z)}) yaw ${f3(geo.spawns.B.yaw)}`);
  console.log(`mapinfo extras: ${JSON.stringify(geo.info)}`);
  check('map: GLB parsed with paint + collision geometry', paintTris > 0 && colTris >= paintTris, `paint ${paintTris}, collision ${colTris}`);
  check('map: mapinfo carries df_atlas_size / df_texels_per_meter / df_paint_area', typeof geo.info.df_atlas_size === 'number' && typeof geo.info.df_texels_per_meter === 'number' && typeof geo.info.df_paint_area === 'number',
    `keys=${Object.keys(geo.info).join(',')}`);
  const soupA = MG.soupArea(geo.paint.positions, geo.paint.indices);
  const sA = def.spawns?.A, sB = def.spawns?.B;
  if (sA && sB) {
    const dA = Math.hypot(geo.spawns.A.x - sA.pos[0], geo.spawns.A.y - sA.pos[1], geo.spawns.A.z - sA.pos[2]);
    const dB = Math.hypot(geo.spawns.B.x - sB.pos[0], geo.spawns.B.y - sB.pos[1], geo.spawns.B.z - sB.pos[2]);
    const yawErr = (a: number, bDeg: number): number => Math.abs(Math.atan2(Math.sin(a - bDeg * DA_DEG), Math.cos(a - bDeg * DA_DEG)));
    const hA = Math.hypot(geo.spawns.A.x - sA.pos[0], geo.spawns.A.z - sA.pos[2]);
    const hB = Math.hypot(geo.spawns.B.x - sB.pos[0], geo.spawns.B.z - sB.pos[2]);
    warn('map (data): spawn empties match maps.json (xz ≤ 0.05 m, |Δ| ≤ 0.15 m, yaw ≤ 2°)', hA <= 0.05 && hB <= 0.05 && dA <= 0.15 && dB <= 0.15 && yawErr(geo.spawns.A.yaw, sA.yaw) <= 2 * DA_DEG && yawErr(geo.spawns.B.yaw, sB.yaw) <= 2 * DA_DEG,
      `ΔA=${f3(dA)} m ΔB=${f3(dB)} m, yawA=${(geo.spawns.A.yaw / DA_DEG).toFixed(1)}° (want ${sA.yaw}), yawB=${(geo.spawns.B.yaw / DA_DEG).toFixed(1)}° (want ${sB.yaw})`);
  }

  t = performance.now();
  const A = AT.buildAtlas(geo.paint, geo.atlasSize, scoring);
  const buildMs = performance.now() - t;
  const ovPct = (A.overlaps / Math.max(1, A.count)) * 100;
  let floorN = 0, floorArea = 0;
  for (let i = 0; i < A.count; i++) if (A.floor[i]) { floorN++; floorArea += A.area[i]; }
  const achieved = Math.sqrt(A.count / Math.max(1e-9, A.totalArea));
  console.log(`atlas build ${buildMs.toFixed(1)} ms · texels ${A.count} (${((A.count / (A.size * A.size)) * 100).toFixed(1)} % of ${A.size}²) · gutter ${A.mirrorItems.length} · overlaps ${A.overlaps} (${ovPct.toFixed(3)} %)`);
  console.log(`totalArea ${f3(A.totalArea)} m² vs df_paint_area ${f3(geo.paintArea)} (${pct(A.totalArea, geo.paintArea)}) vs soup ${f3(soupA)} · floor ${floorN} texels / ${f3(floorArea)} m² · weighted ${f3(A.totalWeighted)} · achieved ${achieved.toFixed(2)} texels/m · grid ${A.grid.nx}×${A.grid.ny}×${A.grid.nz}`);
  check('map: atlas builds in < 1.5 s', A.count > 0 && buildMs < 1500, `${buildMs.toFixed(1)} ms`);
  check('map: overlaps ≤ 0.5 % of count', ovPct <= 0.5, `${A.overlaps} = ${ovPct.toFixed(3)} %`);
  check('map: totalArea within 10 % of df_paint_area', relErr(A.totalArea, geo.paintArea) <= 0.10, pct(A.totalArea, geo.paintArea));
  warn('map (data): totalArea within 2 % of the paint soup triangle area', relErr(A.totalArea, soupA) <= 0.02, pct(A.totalArea, soupA));
  {
    const b = def.bounds;
    let outside = 0;
    if (b) for (let i = 0; i < A.count; i++) {
      if (A.px[i] < b.min[0] - 0.01 || A.px[i] > b.max[0] + 0.01 || A.py[i] < b.min[1] - 0.01 || A.py[i] > b.max[1] + 0.01 || A.pz[i] < b.min[2] - 0.01 || A.pz[i] > b.max[2] + 0.01) outside++;
    }
    warn('map (data): every texel lies inside maps.json bounds', outside === 0, `outside=${outside}`);
  }
  {
    t = performance.now();
    const [ok, detail] = validateMirrors(A, 2);
    check('map: gutter mirrors == brute-force nearest, CSR consistent', ok, `${detail} (${(performance.now() - t).toFixed(0)} ms)`);
  }

  // spawn splats
  const P = new PA.Painter(A);
  const colorsFromTeams = (): { base: V3; sun: V3; gulf: V3 } => {
    const c = (hex: string): V3 => DA.hexToRgb01(hex).map((v) => Math.round(v * 255)) as V3;
    return { base: [214, 206, 188], sun: c(DA.teamById(1).dye), gulf: c(DA.teamById(2).dye) };
  };
  const mm = def.minimap ?? { min: [-30, -44] as [number, number], max: [30, 44] as [number, number] };
  const M = new MM.MinimapRaster(A, { min: mm.min, max: mm.max, pxPerMeter: 3, colors: colorsFromTeams() });
  P.onFlip = (id) => M.apply(id);
  const sA2 = geo.spawns.A, sB2 = geo.spawns.B;
  // (1) G1 (CONTRACT §7, CHANGED(integrator)): the spawn pad is solid_ (§3.1, maps.json
  //     brushKinds.spawnpad "NOT paintable"), so a splat AT spawn_A must leave the pad unpainted:
  //     teamUnder(spawn_A) stays null (no paintable floor texel within 0.35 m), same for B.
  const before = P.teamUnder(sA2.x, sA2.y, sA2.z);
  const nA = P.splat(sA2.x, sA2.y, sA2.z, { radius: 1.0, team: 1 });
  const underA = P.teamUnder(sA2.x, sA2.y, sA2.z);
  P.splat(sB2.x, sB2.y, sB2.z, { radius: 1.0, team: 2 });
  const underB = P.teamUnder(sB2.x, sB2.y, sB2.z);
  let diag = '';
  {
    // explain: which non-paintable meshes stand on the spawn, and how far the nearest paintable floor is
    const doc = await GL.loadGlb(glbPath);
    const over: string[] = [];
    for (const part of doc.parts) {
      if (!part.node.startsWith('solid_') && !part.node.startsWith('col_')) continue;
      let hit = false;
      const p = part.positions, ix = part.indices;
      for (let k = 0; k + 2 < ix.length && !hit; k += 3) {
        const a = ix[k] * 3, b = ix[k + 1] * 3, c = ix[k + 2] * 3;
        const d1 = (p[b] - p[a]) * (sA2.z - p[a + 2]) - (p[b + 2] - p[a + 2]) * (sA2.x - p[a]);
        const d2 = (p[c] - p[b]) * (sA2.z - p[b + 2]) - (p[c + 2] - p[b + 2]) * (sA2.x - p[b]);
        const d3 = (p[a] - p[c]) * (sA2.z - p[c + 2]) - (p[a + 2] - p[c + 2]) * (sA2.x - p[c]);
        const inside = (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
        const ymax = Math.max(p[a + 1], p[b + 1], p[c + 1]);
        if (inside && Math.abs(ymax - sA2.y) <= 0.35) hit = true;
      }
      if (hit && !over.includes(part.node)) over.push(part.node);
    }
    const far = P.surfaceAt(sA2.x, sA2.y, sA2.z, 10, 'floor');
    diag = ` · spawn_A stands on ${over.join(', ') || 'no solid_/col_ mesh'};`
      + ` nearest paintable floor texel ${far ? f3(far.dist) : '> 10'} m away`;
    if (!over.some((n) => n.startsWith('solid_pad'))) diag += ' · expected solid_pad_A under the spawn';
  }
  check('map: the spawn pad is unpaintable — a splat at spawn_A leaves teamUnder(spawn_A) === null (and spawn_B)', before === null && underA === null && underB === null,
    `before=${before} after A=${underA} B=${underB}, flipped ${nA}${diag}`);

  // (2) the gate's intent where a runner can actually paint: the base deck just off the pad
  //     (3 m ahead along the spawn yaw; the pad radius is 2.2 m in maps.json)
  const off = (s: { x: number; y: number; z: number; yaw: number }): [number, number, number] => [s.x + Math.sin(s.yaw) * 3, s.y, s.z + Math.cos(s.yaw) * 3];
  const [ax, ay, az] = off(sA2), [bx, by, bz] = off(sB2);
  const beforeOff = P.teamUnder(ax, ay, az);
  t = performance.now();
  const nOff = P.splat(ax, ay, az, { radius: 1.0, team: 1 });
  const oneMs = performance.now() - t;
  const visitedOff = P.lastVisited;
  const underOffA = P.teamUnder(ax, ay, az);
  P.splat(bx, by, bz, { radius: 1.0, team: 2 });
  const underOffB = P.teamUnder(bx, by, bz);
  check('map: a splat on the base deck 3 m ahead of spawn_A (off the pad) → teamUnder === 1 (B side → 2)', beforeOff === 0 && underOffA === 1 && underOffB === 2,
    `at (${f3(ax)}, ${f3(ay)}, ${f3(az)}): before=${beforeOff} after=${underOffA}; B side=${underOffB}; flipped ${nOff}`);
  check('map: one splat < 2 ms (the off-pad deck splat, first real one on this atlas)', oneMs < 2 && nOff > 0, `${oneMs.toFixed(3)} ms, ${nOff} texels flipped, ${visitedOff} visited`);
  {
    const [cA, rA] = M.worldToPixel(ax, az).map(Math.floor);
    const q = (rA * M.w + cA) * 4;
    const pxA = [M.rgba[q], M.rgba[q + 1], M.rgba[q + 2], M.rgba[q + 3]];
    const sun = colorsFromTeams().sun;
    const near = Math.abs(pxA[0] - sun[0] * 0.93) < 25 && Math.abs(pxA[1] - sun[1] * 0.93) < 25 && Math.abs(pxA[2] - sun[2] * 0.93) < 25;
    check('map: minimap pixel under that deck point is SUNCREW', near && pxA[3] === 255, `pixel (${cA},${rA}) rgba=${pxA.join(',')} sun=${sun.join(',')}`);
  }

  // batch splat timing at deterministic floor texels
  {
    const rnd = R.mulberry32(18);
    const floorIds: number[] = [];
    for (let i = 0; i < A.count; i += 97) if (A.floor[i]) floorIds.push(i);
    const times: number[] = [], flipsN: number[] = [], visited: number[] = [];
    for (let i = 0; i < 600; i++) {
      const id = floorIds[Math.floor(rnd() * floorIds.length)];
      const team = (1 + (i % 2)) as TeamId;
      const t1 = performance.now();
      const n = P.splat(A.px[id], A.py[id], A.pz[id], { radius: 1.0, team, nx: A.nx[id], ny: A.ny[id], nz: A.nz[id], seed: i });
      times.push(performance.now() - t1);
      flipsN.push(n); visited.push(P.lastVisited);
    }
    const warm = times.slice(50);
    const avg = warm.reduce((s, v) => s + v, 0) / warm.length;
    const p99 = percentile(warm, 0.99), mx = Math.max(...warm);
    console.log(`splat r=1.0 ×600: avg ${(avg * 1000).toFixed(1)} µs · p50 ${(percentile(warm, 0.5) * 1000).toFixed(1)} µs · p99 ${(p99 * 1000).toFixed(1)} µs · max ${(mx * 1000).toFixed(1)} µs · flipped p50 ${percentile(flipsN, 0.5)} · visited p50 ${percentile(visited, 0.5)} / max ${Math.max(...visited)} of ${A.count}`);
    check('map: splat r=1 p99 < 2 ms and never scans the atlas', p99 < 2 && Math.max(...visited) < A.count / 20, `p99 ${(p99 * 1000).toFixed(1)} µs, max visited ${Math.max(...visited)}`);
    const tc = performance.now();
    const n = P.capsule(-10, 0.05, -20, 10, 0.05, -20, { radius: 1.2, team: 1, nx: 0, ny: 1, nz: 0 });
    console.log(`capsule 20 m × r1.2: ${(performance.now() - tc).toFixed(3)} ms, ${n} flipped, ${P.lastVisited} visited`);
    const rc = AT.recountWeighted(A);
    let maxRel = 0;
    for (const tm of [0, 1, 2] as TeamId[]) maxRel = Math.max(maxRel, Math.abs(P.weighted(tm) - rc[tm]) / A.totalWeighted);
    const cov = P.coverage();
    check('map: incremental totals == full recount after 600 splats', maxRel < 1e-9, `max rel ${maxRel.toExponential(2)}; coverage sun ${(cov.sun * 100).toFixed(2)} % gulf ${(cov.gulf * 100).toFixed(2)} %`);
    const snap = M.rgba.slice();
    M.rebuild();
    let diff = 0;
    for (let i = 0; i < snap.length; i++) if (snap[i] !== M.rgba[i]) diff++;
    check('map: minimap incremental == rebuild after 600 splats', diff === 0, `diff bytes ${diff}, minimap ${M.w}×${M.h}`);
  }

  // surfaceAt vs brute force (sampled)
  {
    const rnd = R.mulberry32(77);
    let mism = 0;
    const kinds = ['any', 'floor', 'wall'] as const;
    for (let i = 0; i < 60; i++) {
      const id = Math.floor(rnd() * A.count);
      const x = A.px[id] + (rnd() - 0.5) * 0.6, y = A.py[id] + (rnd() - 0.5) * 0.6, z = A.pz[id] + (rnd() - 0.5) * 0.6;
      const kind = kinds[i % 3];
      if (P.nearest(x, y, z, 0.5, kind) !== bruteNearest(A, x, y, z, 0.5, kind)) mism++;
    }
    check('map: surfaceAt via the grid == brute force (60 queries)', mism === 0, `mismatches=${mism}`);
  }

  // determinism on the real map
  {
    const hash1 = P.hash();
    const replay = async (): Promise<string> => {
      const geo2 = await loadGeo();
      const B = AT.buildAtlas(geo2.paint, geo2.atlasSize, scoring);
      const Q = new PA.Painter(B);
      Q.splat(geo2.spawns.A.x, geo2.spawns.A.y, geo2.spawns.A.z, { radius: 1.0, team: 1 });
      Q.splat(geo2.spawns.B.x, geo2.spawns.B.y, geo2.spawns.B.z, { radius: 1.0, team: 2 });
      const [qax, qay, qaz] = off(geo2.spawns.A), [qbx, qby, qbz] = off(geo2.spawns.B);
      Q.splat(qax, qay, qaz, { radius: 1.0, team: 1 });
      Q.splat(qbx, qby, qbz, { radius: 1.0, team: 2 });
      const rnd = R.mulberry32(18);
      const floorIds: number[] = [];
      for (let i = 0; i < B.count; i += 97) if (B.floor[i]) floorIds.push(i);
      for (let i = 0; i < 600; i++) {
        const id = floorIds[Math.floor(rnd() * floorIds.length)];
        Q.splat(B.px[id], B.py[id], B.pz[id], { radius: 1.0, team: (1 + (i % 2)) as TeamId, nx: B.nx[id], ny: B.ny[id], nz: B.nz[id], seed: i });
      }
      Q.capsule(-10, 0.05, -20, 10, 0.05, -20, { radius: 1.2, team: 1, nx: 0, ny: 1, nz: 0 });
      return Q.hash();
    };
    const hash2 = await replay();
    check('map: hash() identical across two independent load+build+paint runs', hash1 === hash2, `${hash1} / ${hash2}`);
  }
}

const DA_DEG = Math.PI / 180;

async function main(): Promise<number> {
  const err = await loadModules();
  if (err) {
    console.log('could not load the paint modules:\n' + err);
    console.log('RESULT: FAIL');
    return 2;
  }
  const t0 = performance.now();
  syntheticChecks();
  const synthFailures = failures;
  const synthOnly = process.argv.includes('--synth');
  const gi = process.argv.indexOf('--glb');
  const custom = gi > 0 && !!process.argv[gi + 1];
  const glbPath = custom ? process.argv[gi + 1] : fileURLToPath(new URL('../art/gltf/map_pier18.glb', import.meta.url));
  let skipped = false;
  if (synthOnly) {
    console.log('\nmap section not requested (--synth)');
    skipped = true;
  } else if (!existsSync(glbPath)) {
    console.log('\nSKIP map section: map_pier18.glb not built yet');
    skipped = true;
  } else {
    try {
      await mapChecks(glbPath, custom);
    } catch (e) {
      check('map section ran without throwing', false, (e as Error)?.stack ?? String(e));
    }
  }
  console.log(`\n${passes} passed, ${failures} failed (${synthFailures} synthetic), ${warnings} data warnings in ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  if (failures > 0) { console.log('RESULT: FAIL'); return 1; }
  console.log(skipped ? 'RESULT: OK (synthetic only; map section skipped)' : 'RESULT: OK');
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.log((e as Error)?.stack ?? String(e)); console.log('RESULT: FAIL'); process.exitCode = 1; });
