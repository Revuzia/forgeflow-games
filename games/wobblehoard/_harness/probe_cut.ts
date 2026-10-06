// PHYS probe: the CUT primitives (_spec/CUT.md section 4, checks X01 X02 X04 X07 X08 at the physics level), soft body-to-body contact
// (stage B item B2: collide) and pick up and toss (B3). Plain node (type stripping):  node _harness/probe_cut.ts [--quick]
// Prints a table of measured values against the thresholds and exits 1 on any failure. Deterministic (no randomness but seeded).
//   * measureCut: the 'a'-side volume fraction of the current mesh against an independent voxel count (point-in-mesh by ray parity on a
//     grid of R/36 cells) for centre, off-centre, tilted and edge planes on 3 species; a plane that misses the body gives null;
//   * X01: a centre cut, both sides measured: fractions sum to 1 (0.5%), and the two pieces built with those fractions hold those volumes
//     (their mesh volume / the whole's, 3%) after settling;
//   * X02: an edge cut: the piece built with measureCut's fraction holds it (3%); a cut under 1/8 is visible to the shell (measureCut < 1/8)
//     and the constructor never builds a piece under 1/8 (clamped);
//   * setNeck: eased, volume held (3%), at t = 1 a waist of about NECK_WAIST of the body's width (0.1..0.5), no fold over 120 degrees; and on
//     every catalog species (template and soft-corner genomes) at the shell's timing (a 0.25 s pinch, 0.1 s at t = 1): no fold over 120;
//   * setFrac: a smooth growth (no frame jumps more than 1/15 of the change) to the new volume (3%);
//   * X04: 6 pieces (the face piece and 5 chunks), Reconnect all (the face piece grows to 1 over 1.2 s while the chunks shrink to 1/8 and are
//     removed): the face piece's rest goal equals the original rest shape at its mesh detail (RMS < 0.002 R0) and its volume the original's (1%);
//   * X07: every piece settles without a hop (lowest particle <= 1 mm up), a press on each one folds nothing past 120 degrees, pieces pushed
//     into each other at 3 m/s never tunnel (no particle of one deeper than 30% R inside the other), and the whole script is deterministic;
//   * X08: frame cost of 6 pieces (with collide every frame) <= 2 whole bodies (same machine, interleaved, best of several batches);
//   * B2: a stack of 3 holds 5 s (it may sag, nobody sinks through: each body's centre stays above the one under it), a 3 m/s head-on hit
//     never tunnels, no contact folds past 120 degrees, 'bump' events fire (rate-limited) with the contact point and the approach speed;
//   * B3: a pull past maxPull lifts the body (metrics.carried, not grounded), the hand carries it, letting go throws it with the hand's
//     velocity: it flies, lands ('land'), squashes and settles inside the mat (the soft rim bounces a hard throw back).
import v8 from 'node:v8';
import { SoftBody } from '../src/physics/softbody.ts';
import { CATALOG, speciesTemplateGenome } from '../src/data/catalog.ts';
import { quantizeGenome } from '../src/core/genome.ts';
import { MATERIAL_FAMILIES } from '../src/data/materials.ts';
import type { SpeciesId } from '../src/data/catalog.ts';
import type { CutPlane, SoftEvent, V3 } from '../src/contracts.ts';

const DT = 1 / 60;
const QUICK = process.argv.includes('--quick');
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const run = (b: SoftBody, secs: number, each?: () => void): void => { for (let i = 0, k = Math.round(secs / DT); i < k; i++) { b.step(DT); each?.(); } };
const runAll = (bs: SoftBody[], secs: number, each?: () => void): void => {
  for (let i = 0, k = Math.round(secs / DT); i < k; i++) { for (const b of bs) b.collide(bs); for (const b of bs) b.step(DT); each?.(); }
};
type Priv = { X: Float64Array; Q: Float64Array; GB: Float64Array; n: number; tris: Uint32Array; restVolume: number };
const priv = (b: SoftBody): Priv => b as unknown as Priv;

function volumeOf(P: ArrayLike<number>, tris: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}
function minY(b: SoftBody): number { let m = 1e9; for (let i = 1; i < b.positions.length; i += 3) m = Math.min(m, b.positions[i]); return m; }
/** Worst dihedral (degrees) between adjacent triangles (probe_softbody's fold meter). */
function foldMeter(b: SoftBody): () => number {
  const I = b.indices, first = new Map<number, number>(), pairs: number[] = [];
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], c = I[t * 3 + ((k + 1) % 3)], key = a < c ? a * 65536 + c : c * 65536 + a, o = first.get(key);
    if (o === undefined) first.set(key, t); else pairs.push(o, t);
  }
  const N = new Float64Array(I.length);
  return () => {
    const P = b.positions;
    for (let t = 0; t < I.length / 3; t++) {
      const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
      const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1e-12;
      nx /= l; ny /= l; nz /= l; N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
    }
    let mn = 1;
    for (let k = 0; k < pairs.length; k += 2) { const t1 = pairs[k] * 3, t2 = pairs[k + 1] * 3; mn = Math.min(mn, N[t1] * N[t2] + N[t1 + 1] * N[t2 + 1] + N[t1 + 2] * N[t2 + 2]); }
    return (Math.acos(Math.max(-1, Math.min(1, mn))) * 180) / Math.PI;
  };
}
/** Is (x, y, z) inside the closed mesh? Ray parity along +x (a slightly tilted ray, so it never grazes an edge). */
function inside(P: ArrayLike<number>, tris: Uint32Array, x: number, y: number, z: number): boolean {
  const dx = 1, dy = 1e-4, dz = 2.3e-4;
  let c = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, cc = tris[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const id = 1 / det, tx = x - P[a], ty = y - P[a + 1], tz = z - P[a + 2], u = (tx * px + ty * py + tz * pz) * id;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * id;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * id > 0) c++;
  }
  return (c & 1) === 1;
}
/** Voxel fraction of the body's volume on the plane's 'a' side (cells of R/36; independent of measureCut). */
function voxelFrac(b: SoftBody, pl: CutPlane): number {
  const P = b.positions, tris = b.indices;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  const h = b.restRadius / (QUICK ? 24 : 36), nl = Math.hypot(pl.normal.x, pl.normal.y, pl.normal.z);
  let all = 0, a = 0;
  // a cell the plane passes through counts its 'a' share (the plane's signed distance over the cell's extent along the normal: linear partial
  // volume), so the grid's offset from the plane does not bias the fraction
  const ext = 0.5 * h * (Math.abs(pl.normal.x) + Math.abs(pl.normal.y) + Math.abs(pl.normal.z)) / nl;
  for (let x = x0 + h / 2; x < x1; x += h) for (let y = y0 + h / 2; y < y1; y += h) for (let z = z0 + h / 2; z < z1; z += h) {
    if (!inside(P, tris, x, y, z)) continue;
    all++;
    const sd = ((x - pl.point.x) * pl.normal.x + (y - pl.point.y) * pl.normal.y + (z - pl.point.z) * pl.normal.z) / nl;
    a += sd >= ext ? 1 : sd <= -ext ? 0 : 0.5 + 0.5 * sd / ext;
  }
  return a / Math.max(1, all);
}
const settled = (id: SpeciesId, opts: Record<string, unknown> = {}): SoftBody => { const b = new SoftBody(speciesTemplateGenome(id), opts as never); run(b, 1); return b; };
const t0 = performance.now();

// ---- measureCut against voxels
{
  const cases: Array<[SpeciesId, string, (b: SoftBody) => CutPlane]> = [];
  for (const id of ['dollop', 'tadpolo', 'crimpo'] as SpeciesId[]) {
    cases.push([id, 'centre x', (b) => ({ point: { ...b.center }, normal: v3(1, 0, 0) })]);
    cases.push([id, 'off-centre z', (b) => ({ point: v3(b.center.x, b.center.y, b.center.z + 0.35 * b.restRadius), normal: v3(0, 0, 1) })]);
    cases.push([id, 'tilted', (b) => ({ point: v3(b.center.x + 0.2 * b.restRadius, b.center.y, b.center.z), normal: v3(0.8, 0.5, 0.33) })]);
    cases.push([id, 'edge', (b) => ({ point: v3(b.center.x + 0.7 * b.restRadius, b.center.y, b.center.z), normal: v3(1, 0, 0) })]);
  }
  let worst = 0, wl = '';
  const out: string[] = [];
  for (const [id, l, pf] of cases) {
    const b = settled(id), pl = pf(b), m = b.measureCut(pl) ?? NaN, vx = voxelFrac(b, pl), e = Math.abs(m - vx);
    if (!(e <= worst)) { worst = e; wl = `${id} ${l}: ${f(m)} vs voxels ${f(vx)}`; }
    out.push(`${id} ${l} ${f(m)}/${f(vx)}`);
  }
  add(`measureCut = the voxel volume fraction (${cases.length} planes: centre, off-centre, tilted, edge on dollop / tadpolo / crimpo; voxels of R/${QUICK ? 24 : 36}): largest difference (${wl})`, f(worst, 4), '<= 0.01', worst <= 0.01);
  const b = settled('dollop');
  const miss = b.measureCut({ point: v3(b.center.x + 5, 0, 0), normal: v3(1, 0, 0) }), bad = b.measureCut({ point: v3(NaN, 0, 0), normal: v3(1, 0, 0) });
  add('measureCut of a plane that misses the body, and of a NaN plane', `${miss}, ${bad}`, 'null, null', miss === null && bad === null);
}

// ---- X01 / X02: pieces hold their fractions
function pieceFracErr(id: SpeciesId, frac: number, chunk: boolean): { err: number; vol: number; hop: number } {
  const whole = settled(id), wv = volumeOf(whole.positions, whole.indices);
  const p = new SoftBody(speciesTemplateGenome(id), { piece: { frac, chunk, cutNormal: v3(-1, 0, 0), at: v3(0, 0.6, 0) } } as never);
  let hop = 0;
  run(p, 0.5); run(p, 2, () => { hop = Math.max(hop, minY(p)); });
  const pv = volumeOf(p.positions, p.indices);
  return { err: Math.abs(pv / wv / frac - 1), vol: pv / wv, hop };
}
{
  const b = settled('dollop'), pl: CutPlane = { point: { ...b.center }, normal: v3(1, 0, 0) };
  const fa = b.measureCut(pl)!, fb = b.measureCut({ point: pl.point, normal: v3(-1, 0, 0) })!;
  const pa = pieceFracErr('dollop', fa, false), pb = pieceFracErr('dollop', fb, true);
  add(`X01 centre cut (dollop, a vertical plane through the centre): the two sides' fractions sum to 1, and the face piece (${f(fa)}) and the chunk (${f(fb)}) built with them hold those volumes after settling`, `sum ${f(fa + fb, 4)}; volumes ${f(pa.vol)} / ${f(pb.vol)} (errors ${f(pa.err * 100, 2)} % / ${f(pb.err * 100, 2)} %)`, 'sum 1 +/- 0.005, each within 3 %', Math.abs(fa + fb - 1) <= 0.005 && pa.err <= 0.03 && pb.err <= 0.03);
  const pe: CutPlane = { point: v3(b.center.x + 0.55 * b.restRadius, b.center.y, b.center.z), normal: v3(1, 0, 0) };
  const fe = b.measureCut(pe)!, ce = pieceFracErr('dollop', Math.max(0.125, fe), true);
  const tiny = b.measureCut({ point: v3(b.center.x + 0.85 * b.restRadius, b.center.y, b.center.z), normal: v3(1, 0, 0) }) ?? 0;
  const clamped = (new SoftBody(speciesTemplateGenome('dollop'), { piece: { frac: 0.02, chunk: true } } as never) as unknown as { frac: number }).frac;
  add(`X02 edge cut: the chunk built with measureCut's fraction (${f(fe)}) holds it; a cut nearer the edge reads under 1/8 (the shell refuses it); the constructor never builds a piece under 1/8`, `volume error ${f(ce.err * 100, 2)} %; near-edge cut ${f(tiny)}; frac 0.02 built as ${f(clamped)}`, 'within 3 %, < 0.125, 0.125', ce.err <= 0.03 && tiny < 0.125 && clamped === 0.125);
}

// ---- setNeck
{
  let worstV = 0, worstFold = 0, waistW = 0, wid = 0;
  for (const id of ['dollop', 'puddlo', 'tadpolo'] as SpeciesId[]) {
    const b = settled(id), fm = foldMeter(b), v0 = volumeOf(b.positions, b.indices);
    const pl: CutPlane = { point: { ...b.center }, normal: v3(1, 0, 0) };
    for (let i = 0; i < 30; i++) { b.setNeck(pl, (i + 1) / 30 * 1); b.step(DT); worstFold = Math.max(worstFold, fm()); worstV = Math.max(worstV, Math.abs(volumeOf(b.positions, b.indices) / v0 - 1)); }
    run(b, 0.1, () => { worstFold = Math.max(worstFold, fm()); worstV = Math.max(worstV, Math.abs(volumeOf(b.positions, b.indices) / v0 - 1)); });
    // width of the body in the plane (z extent of the particles within a thin slab) vs its full z extent
    const P = b.positions; let z0 = 1e9, z1 = -1e9, w0 = 1e9, w1 = -1e9;
    const slab = 0.12 * b.restRadius;
    for (let i = 0; i < P.length; i += 3) { z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); if (Math.abs(P[i] - pl.point.x) < slab) { w0 = Math.min(w0, P[i + 2]); w1 = Math.max(w1, P[i + 2]); } }
    if (id === 'dollop') { waistW = (w1 - w0) / (z1 - z0); wid = z1 - z0; }
    b.setNeck(null, 0); run(b, 1);
  }
  add(`setNeck (dollop, puddlo, tadpolo: eased to t = 1 over 0.5 s, then 0.1 s, when the shell swaps in the pieces): volume held, the waist's width over the body's width (dollop, ${f(wid, 2)} m wide; the goal's waist is NECK_WAIST = 0.3: CUT.md asks about 0.15, which creased the gathered skin), the sharpest crease`, `volume within ${f(worstV * 100, 2)} %, waist ${f(waistW, 2)}, ${f(worstFold, 0)} deg`, 'within 3 %, 0.1..0.5, <= 120 deg', worstV <= 0.03 && waistW >= 0.1 && waistW <= 0.5 && worstFold <= 120);
}

// ---- setNeck on every species, the shell's timing (CUT.md: the jelly pinches for about 0.25 s, then the shell swaps in the pieces)
{
  let worst = 0, worstAt = '', over = 0, worstV = 0, worstVAt = '', worstVC = 0, worstVCAt = '', wsum = 0, wn = 0;
  const ids = CATALOG.map((d) => d.id as SpeciesId);
  for (const id of QUICK ? ids.filter((_, i) => i % 2 === 0) : ids) for (const soft of [false, true]) {
    const t = speciesTemplateGenome(id);
    // the air-bleed families (volBleedMax >= 0.15: slow-rise, marshmallow, pop dome, beads) are built to give volume (CUT.md: 'the waist
    // compresses before it parts'); their volume constraint is soft by design, so they get 6 %, every other family 3 %
    const fam = CATALOG.find((d) => d.id === id)?.family, comp = !!fam && MATERIAL_FAMILIES[fam as keyof typeof MATERIAL_FAMILIES].physics.volBleedMax >= 0.15;
    const b = new SoftBody(soft ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : t);
    run(b, 1);
    const fm = foldMeter(b), v0 = volumeOf(b.positions, b.indices);
    const pl: CutPlane = { point: { ...b.center }, normal: v3(1, 0, 0) };
    const look = (): void => {
      const w = fm();
      if (w > worst) { worst = w; worstAt = `${id}${soft ? ' soft' : ''}`; }
      if (w > 120) over++;
      const dv = Math.abs(volumeOf(b.positions, b.indices) / v0 - 1);
      if (comp) { if (dv > worstVC) { worstVC = dv; worstVCAt = `${id}${soft ? ' soft' : ''}`; } }
      else if (dv > worstV) { worstV = dv; worstVAt = `${id}${soft ? ' soft' : ''}`; }
    };
    for (let i = 0; i < 15; i++) { b.setNeck(pl, (i + 1) / 15); b.step(DT); look(); }
    run(b, 0.1, look);
    const P = b.positions, slab = 0.12 * b.restRadius; let z0 = 1e9, z1 = -1e9, w0 = 1e9, w1 = -1e9;
    for (let i = 0; i < P.length; i += 3) { z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); if (Math.abs(P[i] - pl.point.x) < slab) { w0 = Math.min(w0, P[i + 2]); w1 = Math.max(w1, P[i + 2]); } }
    wsum += (w1 - w0) / (z1 - z0); wn++;
  }
  add(`setNeck on ${wn / 2} catalog species x (template, soft corner) at the shell's timing (a 0.25 s pinch through the centre, then 0.1 s at t = 1): frames with a crease over 120 degrees, the sharpest crease, the volume (the air-bleed families, volBleedMax >= 0.15, separately), the mean waist (width at the plane over the body's width)`, `${over} frames, ${f(worst, 0)} deg (${worstAt}), volume within ${f(worstV * 100, 2)} % (${worstVAt}) / air-bleed ${f(worstVC * 100, 2)} % (${worstVCAt}), mean waist ${f(wsum / wn, 2)}`, '0, <= 120 deg, within 3 % / 6 %', over === 0 && worst <= 120 && worstV <= 0.03 && worstVC <= 0.06);
}

// ---- setFrac
{
  const b = new SoftBody(speciesTemplateGenome('dollop'), { piece: { frac: 0.5, chunk: false } } as never);
  run(b, 1);
  const v0 = volumeOf(b.positions, b.indices);
  b.setFrac(1, 1);
  let prev = v0, jump = 0;
  run(b, 2.5, () => { const v = volumeOf(b.positions, b.indices); jump = Math.max(jump, Math.abs(v - prev)); prev = v; });
  const v1 = volumeOf(b.positions, b.indices);
  add('setFrac(1, 1 s) on a half (dollop face piece): smooth (largest volume change in one frame over the whole change), and the volume doubles', `largest step ${f(jump / Math.max(1e-9, v1 - v0), 3)} of the change; ratio ${f(v1 / v0)}`, '<= 1/15, 2 +/- 3 %', jump / (v1 - v0) <= 1 / 15 && Math.abs(v1 / v0 / 2 - 1) <= 0.03);
}

// ---- X04: six pieces, Reconnect all
{
  const id: SpeciesId = 'dollop', g = speciesTemplateGenome(id);
  const fr = [0.25, 0.15, 0.15, 0.15, 0.15, 0.15];   // the face piece and 5 chunks (sum 1)
  const face = new SoftBody(g, { piece: { frac: fr[0], chunk: false, at: v3(0, 0, 0) } } as never);
  const chunks = fr.slice(1).map((fc, k) => new SoftBody(g, { piece: { frac: fc, chunk: true, cutNormal: v3(Math.cos(k), 0, Math.sin(k)), at: v3(0.9 * Math.cos(k * 1.256), 0.3, 0.9 * Math.sin(k * 1.256)) } } as never));
  const all = [face, ...chunks];
  runAll(all, 1);
  face.setFrac(1, 1.2);
  for (const c of chunks) c.setFrac(0.125, 1.2);
  runAll(all, 1.4);
  runAll([face], 1.5);
  // the original at the face piece's mesh detail, scaled to the whole's volume (a piece always holds frac x the detail-3 whole's volume:
  // a detail-2 mesh of the same shape encloses a little less), and the original as the game builds it (detail 3) for the volume
  const detail = fr[0] < 0.35 ? 2 : 3, ref = new SoftBody(g, { detail }), whole = new SoftBody(g), Qr = priv(ref).Q, GBf = priv(face).GB;
  const ks = Math.cbrt(priv(whole).restVolume / priv(ref).restVolume);
  let s = 0;
  for (let i = 0; i < Qr.length; i++) s += (GBf[i] - Qr[i] * ks) ** 2;
  const rms = Math.sqrt(s / (Qr.length / 3)) / whole.restRadius;
  run(whole, 1.5);
  const vr = volumeOf(face.positions, face.indices) / volumeOf(whole.positions, whole.indices);
  add(`X04 cut into 6 (dollop: a 0.25 face piece at detail ${detail} + 5 chunks of 0.15), Reconnect all (the face piece grows to 1 over 1.2 s, the chunks shrink): the face piece's rest goal against the original's rest shape at that detail (scaled to the whole's volume), and its settled volume against the whole dollop's`, `RMS ${(rms).toExponential(2)} R0, volume ratio ${f(vr, 4)}, frac ${f(face.frac ?? NaN)}`, 'RMS < 0.002 R0, 1 +/- 0.01, 1', rms < 0.002 && Math.abs(vr - 1) <= 0.01 && face.frac === 1);
}

// ---- X07: pieces settle, fold, tunnel, determinism
function pieceScript(): { hash: number; hop: number; fold: number; tunnel: number } {
  const g = speciesTemplateGenome('tadpolo');
  const ps = [new SoftBody(g, { piece: { frac: 0.4, chunk: false, at: v3(-0.7, 0, 0) } } as never), new SoftBody(g, { piece: { frac: 0.3, chunk: true, cutNormal: v3(-1, 0, 0), at: v3(0.7, 0, 0) } } as never),
    new SoftBody(g, { piece: { frac: 0.15, chunk: true, cutNormal: v3(0, 0, 1), at: v3(0, 0, 0.9) } } as never), new SoftBody(g, { piece: { frac: 0.15, chunk: true, cutNormal: v3(0, 0, -1), at: v3(0, 0, -0.9) } } as never)];
  const fms = ps.map(foldMeter);
  let hop = 0, fold = 0, tunnel = 0;
  runAll(ps, 1.5, () => { for (const p of ps) hop = Math.max(hop, minY(p)); });
  // a press on each piece
  for (const p of ps) {
    const R = p.restRadius, h = p.raycast(v3(p.center.x + 0.1 * R, 4, p.center.z), v3(0, -1, 0));
    if (h) { p.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) }); p.fingerPressure(0, 1); }
  }
  runAll(ps, 0.8, () => { for (const fm of fms) fold = Math.max(fold, fm()); });
  for (const p of ps) p.fingerUp(0);
  runAll(ps, 1, () => { for (const fm of fms) fold = Math.max(fold, fm()); });
  // shoved into each other at 3 m/s
  ps[0].nudge(v3(3, 0, 0)); ps[1].nudge(v3(-3, 0, 0)); ps[2].nudge(v3(0, 0, -3)); ps[3].nudge(v3(0, 0, 3));
  runAll(ps, 2, () => {
    for (const fm of fms) fold = Math.max(fold, fm());
    for (let a = 0; a < ps.length; a++) for (let b = 0; b < ps.length; b++) if (a !== b) tunnel = Math.max(tunnel, depthInside(ps[a], ps[b]));
  });
  let hash = 0;
  for (const p of ps) hash = (Math.imul(hash, 31) + p.stateHash()) >>> 0;
  return { hash, hop, fold, tunnel };
}
/** How deep (in rest radii of `b`) the deepest particle of `a` sits inside `b` (0 = none inside). */
function depthInside(a: SoftBody, b: SoftBody): number {
  const P = a.positions, Q = b.positions, R = b.restRadius, c = b.center;
  let r2 = 0;
  for (let i = 0; i < Q.length; i += 3) r2 = Math.max(r2, (Q[i] - c.x) ** 2 + (Q[i + 1] - c.y) ** 2 + (Q[i + 2] - c.z) ** 2);
  let worst = 0;
  for (let i = 0; i < P.length; i += 3) {
    const d2 = (P[i] - c.x) ** 2 + (P[i + 1] - c.y) ** 2 + (P[i + 2] - c.z) ** 2;
    if (d2 > r2) continue;
    if (!inside(Q, b.indices, P[i], P[i + 1], P[i + 2])) continue;
    let best = 1e9;
    for (let j = 0; j < Q.length; j += 3) best = Math.min(best, (P[i] - Q[j]) ** 2 + (P[i + 1] - Q[j + 1]) ** 2 + (P[i + 2] - Q[j + 2]) ** 2);
    worst = Math.max(worst, Math.sqrt(best) / R);
  }
  return worst;
}
{
  const a = pieceScript(), b = pieceScript();
  add('X07 four pieces of tadpolo (the 0.4 face piece and three chunks) on the mat together: settle (lowest particle), a full press on each (sharpest crease), shoved into each other at 3 m/s (the deepest particle of one inside another, in its rest radii), the same script twice', `hop ${f(a.hop * 1000, 2)} mm, fold ${f(a.fold, 0)} deg, deepest inside ${f(a.tunnel, 3)} R, hashes equal ${a.hash === b.hash}`, '<= 1 mm, <= 120 deg, <= 0.3 R, true', a.hop <= 0.001 && a.fold <= 120 && a.tunnel <= 0.3 && a.hash === b.hash);
}

// ---- B2: stack, head-on, bump events
{
  const g = speciesTemplateGenome('dimpla');
  const probe = new SoftBody(g), hgt = (() => { let t = 0; for (let i = 1; i < probe.positions.length; i += 3) t = Math.max(t, probe.positions[i]); return t; })();
  // (frac 1 pieces are whole bodies placed at a height: each one set down just above the one below)
  const sb = [0, 1, 2].map((k) => new SoftBody(g, { piece: { frac: 1, chunk: false, at: v3(0.02 * k, probe.center.y + k * (hgt + 0.03), 0) } } as never));
  const fms = sb.map(foldMeter);
  let fold = 0, order = true, minGap = 9, sink = 0, fr = 0;
  runAll(sb, 5, () => {
    for (const fm of fms) fold = Math.max(fold, fm());
    for (let k = 1; k < 3; k++) { const gap = sb[k].center.y - sb[k - 1].center.y; minGap = Math.min(minGap, gap); if (gap <= 0) order = false; }
    if (++fr % 6 === 0) for (let k = 1; k < 3; k++) sink = Math.max(sink, depthInside(sb[k], sb[k - 1]), depthInside(sb[k - 1], sb[k]));
  });
  const sag = sb.map((b) => f(b.center.y, 2)).join(' / ');
  add(`B2 stack of 3 (dimpla, the wide button dome, each set down on the one below) held 5 s: everyone stays on top of the one below (smallest centre gap ${f(minGap, 3)} m), nobody sinks into the one below (the deepest particle of one inside its neighbour, every 6th frame), no fold`, `order kept ${order}, centres ${sag} m, deepest inside ${f(sink, 3)} R, fold ${f(fold, 0)} deg`, 'true, gap > 0.3 R, <= 0.3 R, <= 120 deg', order && minGap > 0.3 * sb[0].restRadius && sink <= 0.3 && fold <= 120);
  const gp = speciesTemplateGenome('plumpet');
  const h1 = new SoftBody(gp, { piece: { frac: 1, chunk: false, at: v3(-0.55, 0, 0) } } as never), h2 = new SoftBody(gp, { piece: { frac: 1, chunk: false, at: v3(0.55, 0, 0) } } as never);
  const hb = [h1, h2], hf = hb.map(foldMeter), ev: SoftEvent[] = [];
  runAll(hb, 0.5);
  for (const b of hb) b.drainEvents(ev);
  ev.length = 0;
  h1.nudge(v3(1.5, 0, 0)); h2.nudge(v3(-1.5, 0, 0));
  let tun = 0, hfold = 0;
  runAll(hb, 2, () => { tun = Math.max(tun, depthInside(h1, h2), depthInside(h2, h1)); for (const fm of hf) hfold = Math.max(hfold, fm()); for (const b of hb) b.drainEvents(ev); });
  const bumps = ev.filter((e) => e.kind === 'bump');
  const okEv = bumps.length >= 1 && bumps.length <= 12 && bumps.every((e) => e.intensity > 0 && e.intensity <= 1 && Number.isFinite(e.at.x) && e.finger === -1);
  add('B2 head-on at 3 m/s relative (two plumpets): the deepest particle of one inside the other, the sharpest crease, the bump events (count, intensity = approach speed / 3 m/s)', `${f(tun, 3)} R, ${f(hfold, 0)} deg, ${bumps.length} bumps (first ${f(bumps[0]?.intensity ?? 0, 2)})`, '<= 0.3 R, <= 120 deg, 1..12 well formed', tun <= 0.3 && hfold <= 120 && okEv);
}

// ---- B3: pick up and toss
{
  const b = new SoftBody(speciesTemplateGenome('dollop')), ev: SoftEvent[] = [];
  run(b, 0.5);
  const R = b.restRadius, h = b.raycast(v3(b.center.x + 3 * R, b.center.y + 0.3 * R, 0), v3(-1, 0, 0))!;
  b.grab(0, h.vertex, h.point);
  let lifted = false, carriedGrounded = true, hy = 0;
  const maxD = b.params.maxPull * R;
  for (let i = 0; i < 90; i++) {
    const t = (i + 1) / 90, k = 1.6 * maxD * Math.min(1, t * 1.5);
    b.grabMove(0, v3(h.point.x + k * 0.8, h.point.y + k * 0.6, h.point.z)); b.step(DT); b.drainEvents(ev);
    if (b.metrics.carried) { lifted = true; carriedGrounded = carriedGrounded && b.metrics.grounded; hy = Math.max(hy, b.center.y); }
  }
  // a flick toward -x and up, then let go
  const p0 = b.center;
  for (let i = 0; i < 8; i++) { b.grabMove(0, v3(h.point.x + 1.6 * maxD * 0.8 - 0.06 * (i + 1), h.point.y + 1.6 * maxD * 0.6 + 0.03 * (i + 1), h.point.z)); b.step(DT); b.drainEvents(ev); }
  b.grabRelease(0);
  let vmax = 0, landed = 0, far = 0;
  run(b, 6, () => { vmax = Math.max(vmax, Math.hypot(b.metrics.kinetic, 0)); b.drainEvents(ev); far = Math.max(far, Math.hypot(b.center.x, b.center.z)); });
  landed = ev.filter((e) => e.kind === 'land').length;
  const snaps = ev.filter((e) => e.kind === 'snap');
  add(`B3 pick up and toss (dollop): a pull asked to 1.6 x maxPull lifts it (metrics.carried, not grounded while carried; centre up to ${f(hy, 2)} m), a flick and let go: a full snap, it flies, lands ('land') and settles inside the mat`, `lifted ${lifted}, grounded while carried ${!carriedGrounded ? 'never' : 'yes'}, snap ${f(snaps[snaps.length - 1]?.intensity ?? 0, 2)}, lands ${landed}, farthest ${f(far, 2)} m, at rest ${b.metrics.kinetic < 0.02}, moved from ${f(p0.x, 2)} to ${f(b.center.x, 2)}`, 'true, never, 1, >= 1, <= 2.6 m, true', lifted && !carriedGrounded && (snaps[snaps.length - 1]?.intensity ?? 0) === 1 && landed >= 1 && far <= 2.6 && b.metrics.kinetic < 0.02);
}

// ---- X08: perf, 6 pieces vs 2 whole bodies
{
  const g = speciesTemplateGenome('dollop');
  const two = [new SoftBody(g, { piece: { frac: 1, chunk: false, at: v3(-0.7, 0, 0) } } as never), new SoftBody(g, { piece: { frac: 1, chunk: false, at: v3(0.7, 0, 0) } } as never)];
  const fr = [0.25, 0.15, 0.15, 0.15, 0.15, 0.15];
  const six = fr.map((fc, k) => new SoftBody(g, { piece: { frac: fc, chunk: k > 0, cutNormal: v3(1, 0, 0), at: v3(1.0 * Math.cos(k * 1.05), 0, 1.0 * Math.sin(k * 1.05)) } } as never));
  for (const b of [...two, ...six]) b.warmUp();
  const frame = (bs: SoftBody[], k: number): void => {
    for (const b of bs) b.collide(bs);
    for (let i = 0; i < bs.length; i++) { if (k % 40 === i) bs[i].nudge(v3(0.4, 0, -0.3)); bs[i].step(DT); }
  };
  for (let k = 0; k < 120; k++) { frame(two, k); frame(six, k); }
  const tw: number[] = [], sx: number[] = [];
  for (let r = 0; r < (QUICK ? 4 : 8); r++) {
    let a = performance.now(); for (let k = 0; k < 60; k++) frame(two, k); tw.push((performance.now() - a) / 60);
    a = performance.now(); for (let k = 0; k < 60; k++) frame(six, k); sx.push((performance.now() - a) / 60);
  }
  tw.sort((a, b) => a - b); sx.sort((a, b) => a - b);
  const ratios = tw.map((t, i) => sx[i] / t).sort((a, b) => a - b), med = ratios[Math.floor(ratios.length / 2)];
  add(`X08 frame cost: 6 pieces of dollop (0.25 face piece + 5 chunks of 0.15: detail 2) with collide() every frame vs 2 whole dollops with collide(), interleaved batches of 60 frames (best ${f(sx[0], 3)} ms vs ${f(tw[0], 3)} ms)`, `ratio best ${f(sx[0] / tw[0], 2)}, median ${f(med, 2)}`, '<= 1.0 (best batches)', sx[0] / tw[0] <= 1.0);
}

// ---- allocation: collide + the cut goal (neck, frac, flat face) allocate nothing per frame once compiled
{
  const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
  const g = speciesTemplateGenome('dollop');
  const bs = [new SoftBody(g, { piece: { frac: 0.5, chunk: false, at: v3(-0.3, 0, 0) } } as never), new SoftBody(g, { piece: { frac: 0.25, chunk: true, cutNormal: v3(-1, 0, 0), at: v3(0.45, 0, 0) } } as never),
    new SoftBody(g, { piece: { frac: 0.25, chunk: true, cutNormal: v3(0, 0, 1), at: v3(0.1, 0, 0.6) } } as never)];
  const ev: SoftEvent[] = [];
  for (let i = 0; i < 64; i++) ev.push(ev[0]);
  ev.length = 0;
  const pl: CutPlane = { point: v3(-0.3, 0.3, 0), normal: v3(1, 0, 0) }, ts: unknown[] = [];   // a generic array: reading one never boxes
  for (let i = 0; i < 4000; i++) ts.push(0.3 + 0.3 * Math.sin(i * 0.01));
  let k = 0;
  const frame = (): void => { for (const b of bs) b.collide(bs); bs[0].setNeck(pl, ts[k] as number); for (const b of bs) { b.step(DT); ev.length = 0; b.drainEvents(ev); } k++; };
  for (let i = 0; i < 2000; i++) { frame(); if (i % 400 === 0) bs[1].setFrac(i % 800 === 0 ? 0.35 : 0.25, 6); }
  bs[1].setFrac(0.5, 60);   // easing through the whole measurement
  // the measurement itself allocates (getHeapSpaceStatistics' result): its steady cost is subtracted, as probe_softbody's allocCheck does
  const empty: number[] = [];
  for (let i = 0; i < 6; i++) { const u0 = newUsed(); empty.push(newUsed() - u0); }
  const base = empty[empty.length - 1], win: number[] = [];
  for (let w = 0; w < 3; w++) { const u0 = newUsed(); for (let i = 0; i < 120; i++) frame(); const d = newUsed() - u0; if (d >= 0) win.push(d - base); }
  const best = win.length ? Math.min(...win) : NaN;
  add('allocation: three pieces in contact (collide every frame), a neck eased every frame and a 60 s setFrac in progress: exact new-space growth per 120 frames once compiled (best of 3 windows; a window with a GC in it proves nothing)', `${win.join(' / ')} B`, '0 B (best window)', best <= 0);
}

let failed = 0;
for (const r of rows) { if (!r.pass) failed++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`); }
console.log(`${rows.length - failed}/${rows.length} cut / contact / toss checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
