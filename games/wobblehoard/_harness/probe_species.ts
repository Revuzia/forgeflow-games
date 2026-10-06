// WOBBLEHOARD physics probe: ALL 50 CATALOG SPECIES (physics round 2). Every species is built from its catalog recipe and its material family
// (new SoftBody(genome), exactly what the game does) for three genomes: the species template and two rolled instances (speciesBaseGenome
// seeds 1 and 2). Checks, with the limits of probe_softbody.ts (never relaxed per species):
//   * settle 3 s on the table: no hop (lowest particle never more than 1 mm up), no creep (centre drift <= 5 mm after the first 0.5 s), at
//     rest (kinetic < 0.02), rest fold <= 60 degrees (FOLD_REST_MAX);
//   * press matrix (the shell's pressure profile: 0.55 at contact, smoothstep to 1 over 0.9 s after 0.18 s; held 1.2 s, then 1.5 s): the
//     top, the four flanks at mid-height, and the tip of EVERY bump and ridge of the recipe (mirrored ones on both sides; features under
//     the body are skipped: the table covers them), each from outside along the feature's own direction. The template genome gets the
//     whole matrix, the two instances the top and two flanks. Limits: the dense press matrix of probe_softbody (sharpest crease <= 115 deg,
//     0 frames over 120), left at rest <= own rest fold + 10 deg, the volume inside its family's band (CONTRACT 4.2), every ray hits;
//   * a short fuzz (600 frames: fingers anywhere on the body, pressure flicker, slides, grab-pulls, nudges, dt 1/120..1/20): every frame
//     finite, not inverted, not under the table (> -1% R), and settled (kinetic < 0.02) within 6 s of the release;
//   * determinism (one fuzz replayed per family) and perf: step() mean per family on its heaviest species (most struts) while pressed.
// Physics fix round 2 (the round-2 verifier's MAJOR-1..3: the round-5 sliding, release and hop fixes had been tuned on the gel only, and
// these rows did not exist), on every species, per material family:
//   * HOP AFTER RELEASE: a top press (x + 0.1 R, straight down) held 1.2 s with the shell's profile and with pressure 1 at once, released,
//     2 s after, on the template and on the soft (f0 b1 s1 z1) and hard (f1 b0 s0 z0) corner genomes: no particle more than 10 mm above
//     the table, during the press or after it (the verifier's hop.ts: 64 of 300 presses left the table, ambrosel by 211 mm);
//   * FULL PULL AND RELEASE ("stretch it as far as it will go"): grab the top, the +x and +z flanks, every feature tip and the peak, drag
//     the target straight out to 1.1 x the body's maxPull over 0.8 s, hold 0.7 s, release, 2 s after (the verifier's pullset.ts: 111 of
//     608 pulls creased the foot rim at the release);
//   * RUBS (the shell's camera-plane rub of probe_softbody's round-5 rows: the game camera's ray, the shell's pressure capped at 0.7, a
//     straight 2.5 m/s slide in the screen plane, outward drags skipped since the shell makes them pulls) at 4 contact points x 4 screen
//     angles, and SLIDES toward the table from the lower half of the visible body (3 points x 3 downward / sideways angles x 1 and 2.5 m/s),
//     both on the template and the soft corner (the verifier's rubset.ts: 35 of 445 template rubs over 120 degrees, slime 14 of 37).
//   Limits: probe_softbody's round-5 sliding limits (sharpest crease <= 120 deg, 0 frames over 120), left at rest <= 60 deg (plastic or
//   slow families <= 90, as the press matrix). Per family, so a family that creases is named.
//   node _harness/probe_species.ts [--quick] [--only id,id] [--list] [--rows=hop,pull,rub,base]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { SoftBody } from '../src/physics/softbody.ts';
import { CATALOG, speciesBaseGenome, speciesTemplateGenome } from '../src/data/catalog.ts';
import type { SpeciesId } from '../src/data/catalog.ts';
import { MATERIAL_FAMILIES, MATERIAL_FAMILY_IDS, recoverySeconds95 } from '../src/data/materials.ts';
import { evalShape } from '../src/data/shapes.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import type { V3 } from '../src/contracts.ts';

const DT = 1 / 60;
const QUICK = process.argv.includes('--quick');
const LIST = process.argv.includes('--list');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? null;
const FOLD_REST_MAX = 60, PRESS_WORST_MAX = 115, FUZZ_FRAMES = QUICK ? 300 : 600;
/** `--rows=hop,pull,rub,base`: only those groups of rows (all by default; `base` = settle, press matrix, fuzz, perf). */
const ROWS = (process.argv.find((a) => a.startsWith('--rows='))?.slice(7) ?? 'base,hop,pull,rub').split(',');
/** Physics fix round 2 limits: the hop bound (lowest particle above the table, m) and the sliding-contact limits of probe_softbody round 5. */
const HOP_MAX = 0.01, SLIDE_WORST_MAX = 120;
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

interface Meter { pairs: Int32Array; N: Float64Array }
function meter(b: SoftBody): Meter {
  const tris = b.indices, first = new Map<number, number>(), out: number[] = [];
  for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = tris[t * 3 + k], c = tris[t * 3 + ((k + 1) % 3)], key = a < c ? a * 65536 + c : c * 65536 + a, o = first.get(key);
    if (o === undefined) first.set(key, t); else out.push(o, t);
  }
  return { pairs: Int32Array.from(out), N: new Float64Array(tris.length) };
}
function fold(b: SoftBody, m: Meter): number {
  const P = b.positions, I = b.indices, N = m.N;
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1e-12; nx /= l; ny /= l; nz /= l;
    N[t * 3] = nx; N[t * 3 + 1] = ny; N[t * 3 + 2] = nz;
  }
  let mn = 1;
  for (let k = 0; k < m.pairs.length; k += 2) { const t1 = m.pairs[k] * 3, t2 = m.pairs[k + 1] * 3; const d = N[t1] * N[t2] + N[t1 + 1] * N[t2 + 1] + N[t1 + 2] * N[t2 + 2]; if (d < mn) mn = d; }
  return (Math.acos(Math.max(-1, Math.min(1, mn))) * 180) / Math.PI;
}
const minY = (b: SoftBody): number => { let m = 1e9; for (let i = 1; i < b.positions.length; i += 3) if (b.positions[i] < m) m = b.positions[i]; return m; };
const shellP = (t: number): number => { const x = Math.min(1, Math.max(0, (t - 0.18) / 0.9)); return 0.55 + 0.45 * x * x * (3 - 2 * x); };
function volumeOf(P: Float32Array, tris: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
  return v / 6;
}

interface Press { label: string; from: V3; dir: V3 }
/** The press matrix of a species, in body-relative coordinates (origin and direction; the origin is offset by the settled centre). */
function pressesOf(id: SpeciesId, full: boolean): Press[] {
  const d = CATALOG.find((x) => x.id === id)!;
  const out: Press[] = [{ label: 'top', from: v3(0.03, 6, 0.05), dir: v3(0, -1, 0) }];
  const flanks: Array<[string, V3]> = [['flank +x', v3(1, 0, 0)], ['flank -z', v3(0, 0, -1)], ['flank -x', v3(-1, 0, 0)], ['flank +z', v3(0, 0, 1)]];
  for (const [l, u] of full ? flanks : flanks.slice(0, 2)) out.push({ label: l, from: v3(u.x * 6, 0, u.z * 6), dir: v3(-u.x, 0, -u.z) });
  if (full) {
    // a parametric recipe's peak (DOLLOP's pinched swirl-peak since the round-2 fix round; it is no longer a `features` bump): straight down onto it
    const pk = d.shape.peak;
    if (pk && pk.dir[1] > -0.3) {
      const r = evalShape(d.shape, pk.dir[0], pk.dir[1], pk.dir[2]);
      out.push({ label: `peak (${pk.dir.map((x) => x.toFixed(2)).join(',')})`, from: v3(pk.dir[0] * (r + 4), pk.dir[1] * (r + 4), pk.dir[2] * (r + 4)), dir: v3(-pk.dir[0], -pk.dir[1], -pk.dir[2]) });
    }
    d.shape.features.forEach((f, k) => {
      if (f.kind === 'dent') return;
      for (const sx of f.mirrorX ? [1, -1] : [1]) {
        const ux = f.dir[0] * sx, uy = f.dir[1], uz = f.dir[2];
        if (uy < -0.3) continue;   // under the body: the table covers it
        const r = evalShape(d.shape, ux, uy, uz);
        out.push({ label: `feature ${k}${sx < 0 ? "'" : ''} (${f.kind} ${ux.toFixed(2)},${uy.toFixed(2)},${uz.toFixed(2)})`, from: v3(ux * (r + 4), uy * (r + 4), uz * (r + 4)), dir: v3(-ux, -uy, -uz) });
      }
    });
  }
  return out;
}

interface PressRes { label: string; missed: boolean; worst: number; f120: number; rest: number; volMin: number; volMax: number; nan: boolean }
interface GenomeRes {
  id: string; family: string; genome: string; hop: number; creep: number; kinetic: number; restFold: number; settleNaN: boolean;
  presses: PressRes[];
  fuzz: { fails: string[]; settled: boolean; hash: number; minPen: number };
}

function runGenome(id: SpeciesId, gi: number, full: boolean): GenomeRes {
  const g: Genome = gi === 0 ? speciesTemplateGenome(id) : speciesBaseGenome(id, gi);
  const mk = (): SoftBody => new SoftBody(g);
  const b0 = mk(), m = meter(b0), R = b0.restRadius;
  const res: GenomeRes = { id, family: (b0 as unknown as { family: string }).family, genome: gi === 0 ? 'template' : `seed ${gi}`, hop: 0, creep: 0, kinetic: 0, restFold: 0, settleNaN: false, presses: [], fuzz: { fails: [], settled: false, hash: 0, minPen: 0 } };
  // settle
  let c0: V3 | null = null;
  for (let i = 0; i < 180; i++) {
    b0.step(DT);
    if (!Number.isFinite(b0.center.x + b0.center.y + b0.center.z)) { res.settleNaN = true; break; }
    res.hop = Math.max(res.hop, minY(b0));
    if (i === 29) c0 = { ...b0.center };
  }
  if (c0) res.creep = Math.hypot(b0.center.x - c0.x, b0.center.y - c0.y, b0.center.z - c0.z);
  res.kinetic = b0.metrics.kinetic; res.restFold = fold(b0, m);
  // presses
  const rv0 = volumeOf(b0.positions, b0.indices);
  for (const pr of pressesOf(id, full)) {
    const b = mk();
    for (let i = 0; i < 30; i++) b.step(DT);
    const c = b.center;
    const h = b.raycast(v3(c.x + pr.from.x * R, (pr.from.y === 0 ? c.y : pr.from.y === 6 ? 6 : c.y + pr.from.y * R), c.z + pr.from.z * R), pr.dir);
    const r: PressRes = { label: pr.label, missed: !h, worst: 0, f120: 0, rest: 0, volMin: 9, volMax: 0, nan: false };
    if (h) {
      b.fingerDown(0, { point: h.point, normal: h.normal, dir: pr.dir });
      for (let s = 0, t = 0; t < 2.7; s++) {
        if (t < 1.2) b.fingerPressure(0, shellP(t)); else if (t < 1.2 + DT) b.fingerUp(0);
        b.step(DT); t = (s + 1) * DT;
        const fo = fold(b, m);
        if (!Number.isFinite(fo)) { r.nan = true; break; }
        if (fo > r.worst) r.worst = fo;
        if (fo > 120) r.f120++;
        const v = b.metrics.volume; if (v < r.volMin) r.volMin = v; if (v > r.volMax) r.volMax = v;
      }
      r.rest = fold(b, m);
    }
    res.presses.push(r);
  }
  // fuzz
  const fz = (): { fails: string[]; settled: boolean; hash: number; minPen: number } => {
    const b = mk(), rng = mulberry32(0xf00d0000 + CATALOG.findIndex((x) => x.id === id) * 977 + gi * 31);
    const fails: string[] = [];
    let minPen = 0;
    const down = [false, false];
    for (let s = 0; s < FUZZ_FRAMES && fails.length === 0; s++) {
      for (const id2 of [0, 1] as const) {
        const r = rng(), c = b.center;
        if (r < 0.04) {
          const a = rng() * Math.PI * 2, el = (rng() - 0.2) * 1.4, u = v3(Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a));
          const h = b.raycast(v3(c.x + u.x * 4 * R, c.y + u.y * 4 * R, c.z + u.z * 4 * R), v3(-u.x, -u.y, -u.z));
          if (h) { b.fingerDown(id2, { point: h.point, normal: h.normal, dir: v3(-u.x, -u.y, -u.z) }); down[id2] = true; }
        } else if (r < 0.1) b.fingerPressure(id2, rng() < 0.7 ? rng() : 1);
        else if (r < 0.14 && down[id2]) { const h = b.raycast(v3(c.x + (rng() - 0.5) * R, c.y + 4 * R, c.z + (rng() - 0.5) * R), v3(0, -1, 0)); if (h) b.fingerMove(id2, h.point); }
        else if (r < 0.17) { b.fingerUp(id2); down[id2] = false; }
        else if (r < 0.18 && !down[0] && !down[1]) { const v = Math.floor(rng() * b.vertexCount); const P = b.positions; b.grab(0, v, v3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])); b.grabMove(0, v3(P[v * 3] + (rng() - 0.5) * 2 * R, P[v * 3 + 1] + rng() * R, P[v * 3 + 2] + (rng() - 0.5) * 2 * R)); }
        else if (r < 0.19) b.grabRelease(0);
        else if (r < 0.195) b.nudge(v3((rng() - 0.5) * 6, rng() * 2, (rng() - 0.5) * 6));
      }
      b.step(1 / 120 + rng() * (1 / 20 - 1 / 120));
      const P = b.positions;
      for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) { fails.push(`NaN @${s}`); break; }
      if (fails.length) break;
      if (!(volumeOf(P, b.indices) / rv0 > 0)) fails.push(`inverted @${s}`);
      const my = minY(b) / R; if (my < minPen) minPen = my;
      if (my < -0.01) fails.push(`table penetration ${(my * 100).toFixed(2)}% R @${s}`);
    }
    b.fingerUp(0); b.fingerUp(1); b.grabRelease(0); b.grabRelease(1);
    let settled = false;
    for (let i = 0; i < 360 && !settled; i++) { b.step(DT); if (i > 30 && b.metrics.kinetic < 0.02) settled = true; }
    return { fails, settled, hash: b.stateHash(), minPen };
  };
  res.fuzz = fz();
  if (full && gi === 0 && res.id === firstOfFamily(res.family)) { const again = fz(); if (again.hash !== res.fuzz.hash) res.fuzz.fails.push('fuzz replay differs (determinism)'); }
  return res;
}
const firstOfFamily = (fam: string): string => CATALOG.find((d) => d.family === fam)!.id;

/** Mean step() time per family on its heaviest species (most struts) with a finger pressed, best of 3 batches of 300 steps. */
function perfOf(id: SpeciesId): number {
  const b = new SoftBody(speciesTemplateGenome(id));
  for (let i = 0; i < 60; i++) b.step(DT);
  const R = b.restRadius, h = b.raycast(v3(b.center.x + 0.1 * R, 6 * R, b.center.z), v3(0, -1, 0));
  if (h) { b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) }); b.fingerPressure(0, 0.7); }
  for (let i = 0; i < 200; i++) b.step(DT);
  let best = Infinity;
  for (let k = 0; k < 3; k++) { const t0 = performance.now(); for (let i = 0; i < 300; i++) b.step(DT); best = Math.min(best, (performance.now() - t0) / 300); }
  return best;
}

// ------------------------------------------------------------------------------------------------ physics fix round 2 rows
/** The template genome and the two corners these rows use (the verifier's: soft = firmness 0, bounce 1, stretch 1, size 1; hard = the opposite). */
function cornerOf(id: SpeciesId, gn: string): Genome {
  const t = speciesTemplateGenome(id);
  return gn === 'soft' ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : gn === 'hard' ? quantizeGenome({ ...t, firmness: 1, bounce: 0, stretch: 0, size: 0 }) : t;
}
const norm3 = (x: number, y: number, z: number): V3 => { const l = Math.hypot(x, y, z) || 1; return v3(x / l, y / l, z / l); };
const towards = (from: V3, p: V3): V3 => norm3(p.x - from.x, p.y - from.y, p.z - from.z);
/** The shell's pressure profile; a rub caps it at 0.7 (gestures.ts). */
const shellRub = (t: number, rub: boolean): number => { const p = shellP(t); return rub && t > 0.15 ? Math.min(p, 0.7) : p; };
const slowOrPlastic = (fam: string): boolean => { const ph = MATERIAL_FAMILIES[fam as keyof typeof MATERIAL_FAMILIES].physics; return ph.yieldStrain > 0 || recoverySeconds95(ph) > 3; };

interface HopRes { id: string; family: string; rows: Array<{ g: string; prof: string; during: number; after: number; missed: boolean }> }
/** HOP AFTER RELEASE: the verifier's hop.ts on one species (3 genomes x 2 pressure profiles). */
function hopOf(id: SpeciesId): HopRes {
  const out: HopRes = { id, family: '', rows: [] };
  for (const gn of ['template', 'soft', 'hard']) for (const prof of ['shell', 'instant']) {
    const b = new SoftBody(cornerOf(id, gn));
    out.family = (b as unknown as { family: string }).family;
    for (let i = 0; i < 30; i++) b.step(DT);
    const R = b.restRadius, h = b.raycast(v3(b.center.x + 0.1 * R, 6 * R, b.center.z), v3(0, -1, 0));
    const r = { g: gn, prof, during: 0, after: 0, missed: !h };
    if (h) {
      b.fingerDown(0, { point: h.point, normal: h.normal, dir: v3(0, -1, 0) });
      for (let s = 0, t = 0; t < 3.2; s++) {
        if (t < 1.2) b.fingerPressure(0, prof === 'instant' ? 1 : shellP(t)); else if (t < 1.2 + DT) b.fingerUp(0);
        b.step(DT); t = (s + 1) * DT;
        const my = minY(b);
        if (t < 1.2) { if (my > r.during) r.during = my; } else if (my > r.after) r.after = my;
      }
    }
    out.rows.push(r);
  }
  return out;
}

interface Pt { label: string; u: V3 }
/** Pull points: the top, the +x and +z flanks, the peak, every feature tip that is not under the body (the verifier's pullset.ts). */
function pullPointsOf(id: SpeciesId): Pt[] {
  const d = CATALOG.find((x) => x.id === id)!;
  const out: Pt[] = [{ label: 'top', u: v3(0.03, 1, 0.05) }, { label: 'flank +x', u: v3(1, 0, 0) }, { label: 'flank +z', u: v3(0, 0, 1) }];
  const pk = d.shape.peak;
  if (pk) out.push({ label: 'peak', u: v3(pk.dir[0], pk.dir[1], pk.dir[2]) });
  d.shape.features.forEach((f, k) => {
    if (f.kind === 'dent') return;
    for (const sx of f.mirrorX ? [1, -1] : [1]) { const u = v3(f.dir[0] * sx, f.dir[1], f.dir[2]); if (u.y >= -0.3) out.push({ label: `f${k}${sx < 0 ? "'" : ''} tip`, u }); }
  });
  return out;
}
interface SlideRes { label: string; missed: boolean; skipped: boolean; worst: number; f120: number; rest: number; restN90: number }
interface ContactRes { id: string; family: string; kind: 'pull' | 'rub'; g: string; res: SlideRes[] }
/** FULL PULL AND RELEASE on one body: grab the surface under the point, target straight out to 1.1 x maxPull over 0.8 s, hold 0.7 s, let go. */
function pullOne(g: Genome, id: SpeciesId, p: Pt): SlideRes {
  const d = CATALOG.find((x) => x.id === id)!;
  const b = new SoftBody(g), m = meter(b);
  for (let i = 0; i < 30; i++) b.step(DT);
  const R = b.restRadius, c = b.center, r = Math.min(1.9, evalShape(d.shape, p.u.x, p.u.y, p.u.z)) + 3;
  const o = v3(c.x + p.u.x * r * R, Math.max(0.02, c.y + p.u.y * r * R), c.z + p.u.z * r * R), tg = v3(c.x + p.u.x * 0.5 * R, c.y + p.u.y * 0.5 * R, c.z + p.u.z * 0.5 * R);
  const h = b.raycast(o, towards(o, tg));
  const res: SlideRes = { label: p.label, missed: !h, skipped: false, worst: 0, f120: 0, rest: 0, restN90: 0 };
  if (!h) return res;
  const D = 1.1 * b.params.maxPull * R, P0 = h.point;
  b.grab(0, h.vertex, P0);
  for (let s = 0, t = 0; t < 3.5; s++) {
    if (t < 0.8) { const k = D * (t / 0.8); b.grabMove(0, v3(P0.x + p.u.x * k, Math.max(0.03, P0.y + p.u.y * k), P0.z + p.u.z * k)); }
    else if (t >= 1.5 && t < 1.5 + DT) b.grabRelease(0);
    b.step(DT); t = (s + 1) * DT;
    const fo = fold(b, m);
    if (!Number.isFinite(fo)) { res.worst = 999; res.f120++; break; }
    if (fo > res.worst) res.worst = fo;
    if (fo > 120) res.f120++;
  }
  res.rest = fold(b, m);
  return res;
}
/** One camera-plane rub (probe_softbody slidePress, the verifier's rubset.ts): the game camera's ray through c + (u.x R, u.y 1.3 R (u.y <= 0:
 *  u.y R), u.z R), from 0.15 s a straight slide in the screen plane at `ang` degrees and `sp` m/s, lifted at 1.2 s, 2.3 s after. */
function rubOne(g: Genome, u: V3, ang: number, sp: number, label: string): SlideRes {
  const b = new SoftBody(g), m = meter(b);
  for (let i = 0; i < 30; i++) b.step(DT);
  const R = b.restRadius, c = b.center, k0 = R / 0.5125, cam = v3(0, 1.6 * k0, 2.6 * k0);
  const at = (q: V3): V3 => v3(c.x + q.x * R, q.y > 0 ? c.y + q.y * 1.3 * R : c.y + q.y * R, c.z + q.z * R);
  const d0 = towards(cam, at(u)), h = b.raycast(cam, d0);
  const res: SlideRes = { label, missed: !h, skipped: false, worst: 0, f120: 0, rest: 0, restN90: 0 };
  if (!h) return res;
  const rl = Math.hypot(d0.z, d0.x), right = v3(-d0.z / rl, 0, d0.x / rl);
  const up = v3(right.y * d0.z - right.z * d0.y, right.z * d0.x - right.x * d0.z, right.x * d0.y - right.y * d0.x);
  const a = (ang * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const mv = v3(right.x * ca + up.x * sa, right.y * ca + up.y * sa, right.z * ca + up.z * sa);
  const o = v3(h.point.x - c.x, h.point.y - c.y, h.point.z - c.z), ox = o.x * right.x + o.y * right.y + o.z * right.z, oy = o.x * up.x + o.y * up.y + o.z * up.z;
  if ((ca * ox + sa * oy) / (Math.hypot(ox, oy) || 1) > 0.2) { res.skipped = true; return res; }   // outward: a pull in the shell
  b.fingerDown(0, { point: h.point, normal: h.normal, dir: d0 });
  for (let s = 0, t = 0; t < 3.5; s++) {
    if (t < 1.2) {
      b.fingerPressure(0, shellRub(t, true));
      if (t > 0.15) { const k = sp * (t - 0.15), q = v3(h.point.x + mv.x * k, h.point.y + mv.y * k, h.point.z + mv.z * k), hq = b.raycast(cam, towards(cam, q)); if (hq) b.fingerMove(0, hq.point); }
    } else if (t < 1.2 + DT) b.fingerUp(0);
    b.step(DT); t = (s + 1) * DT;
    const fo = fold(b, m);
    if (!Number.isFinite(fo)) { res.worst = 999; res.f120++; break; }
    if (fo > res.worst) res.worst = fo;
    if (fo > 120) res.f120++;
  }
  res.rest = fold(b, m);
  return res;
}
const RUB_PTS: Array<[string, V3]> = [['top-front', v3(0.05, 0.83, 0.56)], ['front-mid', v3(0, 0.3, 0.95)], ['front-left', v3(-0.6, 0.45, 0.65)], ['front-right-low', v3(0.6, -0.1, 0.8)]];
const SLIDE_PTS: Array<[string, V3]> = [['low-left', v3(-0.55, -0.05, 0.8)], ['low-mid', v3(0.05, -0.2, 0.95)], ['low-right', v3(0.7, 0.1, 0.7)]];
function contactOf(id: SpeciesId, kind: 'pull' | 'rub', gn: string): ContactRes {
  const g = cornerOf(id, gn);
  const out: ContactRes = { id, family: (new SoftBody(g) as unknown as { family: string }).family, kind, g: gn, res: [] };
  if (kind === 'pull') for (const p of pullPointsOf(id)) out.res.push(pullOne(g, id, p));
  else {
    for (const [l, u] of RUB_PTS) for (const ang of QUICK ? [0, 180] : [0, 90, 180, 270]) out.res.push(rubOne(g, u, ang, 2.5, `rub ${l} ${ang}`));
    for (const [l, u] of SLIDE_PTS) for (const ang of [180, 270, 315]) for (const sp of QUICK ? [2.5] : [1, 2.5]) out.res.push(rubOne(g, u, ang, sp, `slide ${l} ${ang} ${sp}`));
  }
  return out;
}

type Job = { kind: 'genome'; id: SpeciesId; gi: number; full: boolean } | { kind: 'hop'; id: SpeciesId } | { kind: 'pull' | 'rub'; id: SpeciesId; g: string };
type Res = { kind: 'genome'; r: GenomeRes } | { kind: 'hop'; r: HopRes } | { kind: 'contact'; r: ContactRes };
function runJob(j: Job): Res {
  if (j.kind === 'genome') return { kind: 'genome', r: runGenome(j.id, j.gi, j.full) };
  if (j.kind === 'hop') return { kind: 'hop', r: hopOf(j.id) };
  return { kind: 'contact', r: contactOf(j.id, j.kind, j.g) };
}

if (!isMainThread) {
  const jobs = workerData as Job[];
  for (const j of jobs) parentPort!.postMessage(runJob(j));
  parentPort!.postMessage(null);
} else {
  const t0 = performance.now();
  const species = CATALOG.filter((d) => !ONLY || ONLY.includes(d.id)).map((d) => d.id);
  const jobs: Job[] = [];
  if (ROWS.includes('base')) for (const id of species) for (const gi of [0, 1, 2]) jobs.push({ kind: 'genome', id, gi, full: gi === 0 });
  if (ROWS.includes('hop')) for (const id of species) jobs.push({ kind: 'hop', id });
  for (const kind of ['pull', 'rub'] as const) if (ROWS.includes(kind)) for (const id of species) for (const g of ['template', 'soft']) jobs.push({ kind, id, g });
  // heaviest first (a rub job is ~3x a genome job), round robin, so the workers finish together
  const weight = (j: Job): number => (j.kind === 'rub' ? 6 : j.kind === 'pull' ? 3 : j.kind === 'hop' ? 2 : 1);
  const order = jobs.map((j, i) => ({ j, i })).sort((a, b) => weight(b.j) - weight(a.j) || a.i - b.i).map((x) => x.j);
  const NW = 3, results: GenomeRes[] = [], hops: HopRes[] = [], contacts: ContactRes[] = [];
  await Promise.all(Array.from({ length: NW }, (_, w) => new Promise<void>((resolve, reject) => {
    const mine = order.filter((_, i) => i % NW === w);
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: mine, argv: process.argv.slice(2) });
    wk.on('message', (m: Res | null) => {
      if (m === null) { void wk.terminate(); resolve(); } else if (m.kind === 'genome') results.push(m.r); else if (m.kind === 'hop') hops.push(m.r); else contacts.push(m.r);
    });
    wk.on('error', reject);
  })));
  results.sort((a, b) => species.indexOf(a.id as SpeciesId) - species.indexOf(b.id as SpeciesId) || a.genome.localeCompare(b.genome));
  if (LIST) for (const r of results) {
    const w = r.presses.reduce((a, c) => (c.worst > a.worst ? c : a), r.presses[0]);
    console.log(`${r.id.padEnd(11)} ${r.family.padEnd(13)} ${r.genome.padEnd(8)} hop ${(r.hop * 1000).toFixed(1)} mm creep ${(r.creep * 1000).toFixed(1)} mm kin ${r.kinetic.toFixed(3)} rest ${r.restFold.toFixed(0)} | ${r.presses.length} presses, worst ${w.worst.toFixed(0)} (${w.label}) f120 ${r.presses.reduce((a, c) => a + c.f120, 0)} missed ${r.presses.filter((p) => p.missed).length} | fuzz ${r.fuzz.fails.length ? r.fuzz.fails.join('; ') : 'ok'} settled ${r.fuzz.settled}`);
  }
  interface Row { what: string; value: string; limit: string; pass: boolean }
  const rows: Row[] = [];
  const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
  const worstBy = <T>(xs: T[], f: (x: T) => number): T => xs.reduce((a, c) => (f(c) > f(a) ? c : a));
  const n = results.length;
  if (n > 0) {
    const bad = results.filter((r) => r.settleNaN || r.hop > 0.001 || r.creep > 0.005 || r.kinetic >= 0.02 || r.restFold > FOLD_REST_MAX);
    const wh = worstBy(results, (r) => r.hop), wc = worstBy(results, (r) => r.creep), wf = worstBy(results, (r) => r.restFold);
    add(`settle 3 s on the table (${n} bodies: ${species.length} species x template + 2 seeds): no hop, no creep, at rest, rest fold`, `hop max ${(wh.hop * 1000).toFixed(2)} mm (${wh.id} ${wh.genome}), creep max ${(wc.creep * 1000).toFixed(2)} mm (${wc.id} ${wc.genome}), rest fold max ${wf.restFold.toFixed(0)} deg (${wf.id}); failing: ${bad.map((r) => `${r.id} ${r.genome}`).join(', ') || 'none'}`, `hop <= 1 mm, creep <= 5 mm, kinetic < 0.02, rest <= ${FOLD_REST_MAX} deg`, bad.length === 0);
  }
  if (n > 0) {
    const all = results.flatMap((r) => r.presses.map((p) => ({ r, p })));
    const done = all.filter((x) => !x.p.missed);
    const w = worstBy(done, (x) => x.p.worst), f120 = done.reduce((a, x) => a + x.p.f120, 0), missed = all.filter((x) => x.p.missed);
    const rest = worstBy(done, (x) => x.p.rest - x.r.restFold);
    add(`press matrix (${all.length} presses: top, flanks, every feature tip; the shell's pressure profile, held 1.2 s): sharpest crease (${w.r.id} ${w.r.genome} ${w.p.label}), frames over 120 deg, missed rays`, `${w.p.worst.toFixed(0)} deg, ${f120} frames, ${missed.length} missed${missed.length ? ' (' + missed.slice(0, 3).map((x) => `${x.r.id} ${x.p.label}`).join('; ') + ')' : ''}`, `<= ${PRESS_WORST_MAX} deg, 0, 0`, w.p.worst <= PRESS_WORST_MAX && f120 === 0 && missed.length === 0 && done.every((x) => !x.p.nan));
    // a plastic family (a yield: putty, mochi dough, bead squeeze) KEEPS a dent by design (dentHoldDepth), and the rim of a kept dent is a
    // sharper bend than the rest shape: for those the limit is the probe_softbody one for a tucked-under flap (no edge past 90 degrees)
    // ... and so does a SLOW family 1.5 s after the lift (recoverySeconds95 > 3 s: slow rise, mochi, putty, slime, beads are still recovering
    // their dent by design, materials.ts): same limit
    const slowOrPlastic = (fam: string): boolean => { const ph = MATERIAL_FAMILIES[fam as keyof typeof MATERIAL_FAMILIES].physics; return ph.yieldStrain > 0 || recoverySeconds95(ph) > 3; };
    const restBad = done.filter((x) => x.p.rest > (slowOrPlastic(x.r.family) ? 90 : FOLD_REST_MAX));
    add(`press matrix: left at rest 1.5 s after the lift (worst: ${rest.r.id} ${rest.r.genome} ${rest.p.label}, own rest ${rest.r.restFold.toFixed(0)} deg)`, `${rest.p.rest.toFixed(0)} deg${restBad.length ? '; over: ' + restBad.slice(0, 4).map((x) => `${x.r.id} ${x.p.label} ${x.p.rest.toFixed(0)}`).join('; ') : ''}`, `<= ${FOLD_REST_MAX} deg (plastic or slow families, which keep or are still healing a dent by design: <= 90)`, restBad.length === 0);
    const vb = done.filter((x) => { const lo = Math.min(0.85, 1 - MATERIAL_FAMILIES[x.r.family as keyof typeof MATERIAL_FAMILIES].physics.volBleedMax - 0.05); return x.p.volMin < lo || x.p.volMax > 1.15; });
    add('press matrix: volume inside the family band (CONTRACT 4.2: min(0.85, 1 - volBleedMax - 0.05) .. 1.15)', vb.length ? vb.slice(0, 4).map((x) => `${x.r.id} ${x.p.label} ${x.p.volMin.toFixed(2)}..${x.p.volMax.toFixed(2)}`).join('; ') : `all ${done.length} in band`, 'all', vb.length === 0);
  }
  if (n > 0) {
    const bad = results.filter((r) => r.fuzz.fails.length || !r.fuzz.settled);
    const wp = results.reduce((a, c) => (c.fuzz.minPen < a.fuzz.minPen ? c : a));
    add(`short fuzz (${n} bodies x ${FUZZ_FRAMES} frames: fingers anywhere, pressure flicker, slides, grab-pulls, nudges, dt 1/120..1/20): finite, not inverted, never under the table (> -1% R), settled within 6 s; one replay per family identical`, bad.length ? bad.slice(0, 5).map((r) => `${r.id} ${r.genome}: ${r.fuzz.fails.join('; ') || 'not settled'}`).join(' | ') : `0 failures (deepest ${(wp.fuzz.minPen * 100).toFixed(2)}% R, ${wp.id})`, '0 failures', bad.length === 0);
  }
  if (ROWS.includes('base')) {
    const fams = MATERIAL_FAMILY_IDS.filter((f) => species.some((id) => CATALOG.find((d) => d.id === id)!.family === f));
    const heavy = (f: string): SpeciesId => {
      const ids = species.filter((id) => CATALOG.find((d) => d.id === id)!.family === f);
      return ids.reduce((a, c) => (((new SoftBody(speciesTemplateGenome(c)) as unknown as { ns: number }).ns > (new SoftBody(speciesTemplateGenome(a)) as unknown as { ns: number }).ns) ? c : a));
    };
    const ref = perfOf('dollop');
    const perf = fams.map((f) => { const id = heavy(f); return { f, id, ms: perfOf(id) }; });
    const ref2 = perfOf('dollop'), refMs = Math.min(ref, ref2);
    const w = worstBy(perf, (x) => x.ms);
    add(`perf: step() mean at 60 Hz frames per family on its heaviest species (most thin-part struts), a finger pressed (best of 3 x 300 steps; the machine is shared, so the DOLLOP starter is measured before and after in the same process: ${refMs.toFixed(2)} ms)`, perf.map((x) => `${x.f} ${x.ms.toFixed(2)} (${x.id}, x${(x.ms / refMs).toFixed(2)})`).join(', '), `most expensive (${w.f}) <= 2.0 ms`, w.ms <= 2.0);
  }
  // ---- physics fix round 2 rows
  if (hops.length) {
    const all = hops.flatMap((h) => h.rows.map((r) => ({ h, r })));
    const bad = all.filter((x) => x.r.missed || x.r.during > HOP_MAX || x.r.after > HOP_MAX);
    const wa = worstBy(all, (x) => x.r.after), wd = worstBy(all, (x) => x.r.during);
    const fams = MATERIAL_FAMILY_IDS.filter((f) => hops.some((h) => h.family === f));
    add(`HOP AFTER RELEASE (${all.length} presses: ${hops.length} species x template / soft / hard corner x the shell's profile and pressure 1 at once; a top press held 1.2 s, released, 2 s after; was 64 of 300 off the table, ambrosel 211 mm): lowest particle above the table after the release (worst ${wa.h.id} ${wa.r.g} ${wa.r.prof}) and during the press (worst ${wd.h.id} ${wd.r.g} ${wd.r.prof}); per family the worst after: ${fams.map((f) => `${f} ${(Math.max(...all.filter((x) => x.h.family === f).map((x) => x.r.after)) * 1000).toFixed(1)}`).join(', ')} mm`, `${(wa.r.after * 1000).toFixed(1)} mm, ${(wd.r.during * 1000).toFixed(1)} mm; ${bad.length} presses over${bad.length ? ': ' + bad.slice(0, 5).map((x) => `${x.h.id} ${x.r.g} ${x.r.prof} ${(x.r.after * 1000).toFixed(0)} / ${(x.r.during * 1000).toFixed(0)} mm${x.r.missed ? ' MISSED' : ''}`).join('; ') : ''}`, `<= ${HOP_MAX * 1000} mm each, none missed`, bad.length === 0);
  }
  for (const kind of ['pull', 'rub'] as const) {
    const cs = contacts.filter((c) => c.kind === kind);
    if (!cs.length) continue;
    const fams = MATERIAL_FAMILY_IDS.filter((f) => cs.some((c) => c.family === f));
    for (const f of fams) {
      const all = cs.filter((c) => c.family === f).flatMap((c) => c.res.map((r) => ({ c, r }))).filter((x) => !x.r.skipped);
      const done = all.filter((x) => !x.r.missed), lim = slowOrPlastic(f) ? 90 : FOLD_REST_MAX;
      const w = worstBy(done, (x) => x.r.worst), rw = worstBy(done, (x) => x.r.rest);
      const bad = done.filter((x) => x.r.worst > SLIDE_WORST_MAX || x.r.f120 > 0 || x.r.rest > lim);
      const f120 = done.reduce((a, x) => a + x.r.f120, 0), sp = new Set(all.map((x) => x.c.id)).size;
      const what = kind === 'pull'
        ? `FULL PULL AND RELEASE, ${f} (${done.length} pulls on ${sp} species x template / soft corner: top, +x / +z flanks, peak, every feature tip; to 1.1 x maxPull over 0.8 s, held 0.7 s, let go, 2 s after)`
        : `RUBS AND SLIDES, ${f} (${done.length} on ${sp} species x template / soft corner: the shell's camera-plane rub at 4 points x ${QUICK ? 2 : 4} screen angles at 2.5 m/s, slides toward the table from 3 low points x 3 angles; outward drags skipped)`;
      add(`${what}: sharpest crease (${w.c.id} ${w.c.g} ${w.r.label}), frames over 120 deg, left at rest (${rw.c.id} ${rw.c.g} ${rw.r.label}), missed rays`, `${w.r.worst.toFixed(0)} deg, ${f120} frames${bad.length ? ` (${bad.length} failing: ${bad.slice(0, 3).map((x) => `${x.c.id} ${x.c.g} ${x.r.label} ${x.r.worst.toFixed(0)}/${x.r.f120}/${x.r.rest.toFixed(0)}`).join('; ')})` : ''}, rest ${rw.r.rest.toFixed(0)} deg, ${all.length - done.length} missed`, `<= ${SLIDE_WORST_MAX} deg, 0 frames, rest <= ${lim} deg${lim > FOLD_REST_MAX ? ' (slow or plastic family)' : ''}, 0 missed`, bad.length === 0 && all.length === done.length);
    }
  }
  let failed = 0;
  for (const r of rows) { if (!r.pass) failed++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.value}    threshold: ${r.limit}`); }
  console.log(`${rows.length - failed}/${rows.length} species checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failed ? 1 : 0);
}
