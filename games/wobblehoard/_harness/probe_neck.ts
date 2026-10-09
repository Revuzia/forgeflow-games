// PHYS, CUT2 task P4 (5.4, 11, 13, X19): the neck. Plain node (type stripping); run_probes runs it without arguments (= --mode=all, a few minutes on a busy machine):
//   node _harness/probe_neck.ts [--mode=all|latch|mom|x19|swell|fit] [--species=a,b] [--planes=x0,y0,t50|e<deg>[+off]] [--depths=table|1,0.35,..] [--table=fam:depth,..] [--obl=<cap, 1 = off>] [--shard=i/n] [--json=out.json] [--v]
//   latch  rows: the rest plane is taken once at the first setNeck with t > 0 (a plane passed later is ignored, null releases); depth sets the goal's waist (NECK_WAIST + (1 - depth)(1 - NECK_WAIST)).
//   mom    5.4 (b): 50 species x 3 planes (vertical x0, level y0, tilted 50 degrees at 0.2 r), the shell's flow (physview/swap_flow.ts cutOnce) to the swap at the family depth of src/shell/cut.ts
//          NECK_DEPTH: |v1 - v0| = the momentum the NECK added (bar 0.5 m/s on 48 of 50 at every plane); the lever when more than 2 miss on the tilted plane is NECK_OBL (softbody.ts).
//   x19    swap continuity: the Chamfer distance (R0, both directions) between the necked parent's mesh at the swap and the two true halves in its pose, VISIBLE faces only (the halves' cap faces are
//          left out as samples), the 12 family representatives on the median plane: <= 0.08 R0 for every family except sticky and slime (<= 0.15). Calibrated against the CUT2 5.4 table:
//          12 species at waist 0.30 (depth 1) median 0.136 (table 0.137), at waist 0.755 (depth 0.35) median 0.065 (table 0.065).
//   swell  the highest particle of the squishy and its pieces over 2.5 s after the swap over its settled height (the browser harness' cut-swell, node version): <= x1.25 on all families.
//   fit    the depth sweep behind the per-family table: the Chamfer, the momentum and the swell per species and depth, then the table per family.
import { writeFileSync } from 'node:fs';
import { NECK_OBL, SoftBody } from '../src/physics/softbody.ts';
import { CATALOG, familyOf, speciesBaseGenome } from '../src/data/catalog.ts';
import type { V3 } from '../src/contracts.ts';
import { NECK_DEPTH, NECK_DEPTH_DEFAULT } from '../src/shell/cut.ts';
import { FAM12, f } from './physview/flush_rig.ts';
import { neckSwap } from './physview/neck_rig.ts';
import type { NeckStat } from './physview/neck_rig.ts';

const argv = process.argv.slice(2);
const arg = (k: string): string => (argv.find((a) => a.startsWith('--' + k + '=')) ?? '').slice(k.length + 3);
const mode = arg('mode') || 'all';
const on = (m: string): boolean => mode === 'all' || mode === m;
const ALL = CATALOG.map((c) => c.id as string);
const d2r = Math.PI / 180;
const PLANES: Record<string, [V3, number]> = { x0: [{ x: 1, y: 0, z: 0 }, 0], y0: [{ x: 0, y: 1, z: 0 }, 0], t50: [{ x: Math.cos(50 * d2r), y: Math.sin(50 * d2r), z: 0 }, 0.2], t25: [{ x: Math.cos(25 * d2r), y: Math.sin(25 * d2r), z: 0 }, 0.1], x5: [{ x: 1, y: 0, z: 0 }, 0.5], y3: [{ x: 0, y: 1, z: 0 }, 0.3] };
/** a plane by name: the table above, or `e<deg>[+off]` = the normal at that elevation from the horizontal in the x-y plane (e0 vertical, e90 level), offset `off` r (default 0.2) */
const planeOf = (pn: string): [V3, number] => {
  const m = /^e(\d+(?:\.\d+)?)(?:\+(\d+(?:\.\d+)?))?$/.exec(pn);
  return m ? [{ x: Math.cos(+m[1] * d2r), y: Math.sin(+m[1] * d2r), z: 0 }, m[2] ? +m[2] : 0.2] : PLANES[pn];
};
if (arg('obl')) NECK_OBL.cap = +arg('obl');
/** the family depth table the probe evaluates: src/shell/cut.ts NECK_DEPTH, or a candidate given as --table=jellygel:0.35,putty:0.3,.. (families not named keep the shell's value) */
const TABLE: Record<string, number> = { ...NECK_DEPTH };
for (const kv of (arg('table') ? arg('table').split(',') : [])) { const [k, v] = kv.split(':'); TABLE[k] = +v; }
const tableDepth = (sp: string): number => TABLE[familyOf(sp as never) as string] ?? NECK_DEPTH_DEFAULT;
const t0 = performance.now();
const q = (a: number[], p: number): number => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const med = (a: number[]): number => q(a, 0.5);
const rows: Array<{ ok: boolean; what: string; val: string }> = [];
const row = (ok: boolean, what: string, val: string): void => { rows.push({ ok, what, val }); };
const info = (w: string, v: string): void => { console.log(`INFO  ${w}\n          ${v}`); };
const shard = <T,>(a: T[]): T[] => { if (!arg('shard')) return a; const [i, n] = arg('shard').split('/').map(Number); return a.filter((_, k) => k % n === i); };
const stats: NeckStat[] = [];
const line = (st: NeckStat, secs: number): string => `${st.sp.padEnd(10)} ${st.fam.padEnd(13)} ${st.plane.padEnd(4)} depth ${f(st.depth, 2).toString().padEnd(5)} ${st.ok ? `dv ${f(st.dv, 2)} tilt ${f(st.tilt, 0)} lift ${f(st.lift, 3)}/${f(st.liftMax, 3)} slide ${f(st.disp, 3)} neckTop x${f(st.top, 2)}${st.swell ? ' swell x' + f(st.swell, 2) : ''}${st.ch ? ` ch vis ${f(st.ch.vis, 3)} visBoth ${f(st.ch.visBoth, 3)} all ${f(st.ch.all, 3)}` : ''}` : 'refused ' + st.why} (${secs.toFixed(1)}s)`;
const run = (sp: string, pn: string, depth: number, o: { chamfer?: boolean; full?: boolean }): NeckStat => {
  const [n, off] = planeOf(pn), t1 = performance.now();
  const st = neckSwap(sp, pn, n, off, depth, { ...o, mode: pn === 'x0' && (o.chamfer || o.full) ? 'median' : 'at' });
  stats.push(st);
  if (argv.includes('--v') || mode === 'fit') console.log(line(st, (performance.now() - t1) / 1000));
  return st;
};
const depthArg = (sp: string): number => (arg('depths') && arg('depths') !== 'table' ? +arg('depths').split(',')[0] : tableDepth(sp));

/* ───────────────────────── latch and depth ───────────────────────── */
if (on('latch')) {
  const g = speciesBaseGenome('dollop' as never, 1);
  const mk = (): SoftBody => { const b = new SoftBody(g); for (let i = 0; i < 90; i++) b.step(1 / 60); return b; };
  const pl = (b: SoftBody, nx: number, ny: number, nz: number) => ({ point: { x: b.center.x, y: b.center.y, z: b.center.z }, normal: { x: nx, y: ny, z: nz } });
  // waist height: the extent in y of the particles within 4 cm of the x-plane through the centre
  const waistW = (b: SoftBody): number => { let lo = 1e9, hi = -1e9; const P = b.positions; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i] - b.center.x) < 0.04) { if (P[i + 1] < lo) lo = P[i + 1]; if (P[i + 1] > hi) hi = P[i + 1]; } return hi - lo; };
  // (1) the latch: three bodies pinched along x for 0.5 s; then the caller keeps the plane (A), turns it to z (B: the pinch must NOT follow), releases it (C)
  const A = mk(), B = mk(), C = mk();
  for (let i = 0; i < 30; i++) for (const b of [A, B, C]) { b.setNeck!(pl(b, 1, 0, 0), Math.min(1, i / 20), 1); b.step(1 / 60); }
  for (let i = 0; i < 30; i++) { A.setNeck!(pl(A, 1, 0, 0), 1, 1); B.setNeck!(pl(B, 0, 0, 1), 1, 1); C.setNeck!(null, 0); for (const b of [A, B, C]) b.step(1 / 60); }
  const wA = waistW(A), wB = waistW(B), wC = waistW(C);
  row(Math.abs(wA - wB) < 1e-6, 'the latch: a plane passed after the first setNeck with t > 0 is ignored (waist of the turned plane = waist of the unchanged plane)', `${f(Math.abs(wA - wB), 8)} m (waists ${f(wA, 3)} / ${f(wB, 3)} m)`);
  row(wC > 1.15 * wA, 'setNeck(null, 0) releases the pinch and the latch (the waist opens)', `waist ${f(wC, 3)} m vs ${f(wA, 3)} m held`);
  // (2) depth: the waist at t = 1 for depth 1 / 0.35 / 0 (goal waist 0.30 / 0.755 / 1.0 of the cross-section)
  const wd: number[] = [];
  for (const dp of [1, 0.35, 0]) { const b = mk(), w0 = waistW(b); for (let i = 0; i < 60; i++) { b.setNeck!(pl(b, 1, 0, 0), Math.min(1, i / 15), dp); b.step(1 / 60); } wd.push(waistW(b) / w0); }
  row(wd[0] < wd[1] - 0.1 && wd[1] < wd[2] - 0.1 && wd[2] > 0.95, 'depth: the waist at t = 1 is monotone in depth (1, 0.35, 0) and depth 0 does not pinch', wd.map((x) => f(x, 3)).join(' < ') + ' of the rest height at the plane');
}

/* ───────────────────────── mom: the net momentum of the neck ───────────────────────── */
if (on('mom')) {
  const planes = (arg('planes') || 'x0,y0,t50').split(','), sps = shard(arg('species') ? arg('species').split(',') : ALL);
  const ds = (arg('depths') || 'table').split(',');
  for (const d of ds) for (const pn of planes) {
    const set: NeckStat[] = [];
    for (const sp of sps) set.push(run(sp, pn, d === 'table' ? tableDepth(sp) : +d, {}));
    const ok = set.filter((s) => s.ok), miss = ok.filter((s) => s.dv > 0.5), dv = ok.map((s) => s.dv);
    info(`mom, depth ${d}, plane ${pn}: |v1 - v0| over ${ok.length} species (${set.length - ok.length} refused)`, `median ${f(med(dv), 2)} p95 ${f(q(dv, 0.95), 2)} max ${f(Math.max(...dv), 2)} m/s; over 0.5: ${miss.length}${miss.length ? ' (' + miss.map((s) => `${s.sp} ${f(s.dv, 2)}`).join(', ') + ')' : ''}; parent frame turned at most ${f(Math.max(...ok.map((s) => s.tilt)), 0)} deg, lifted at most ${f(Math.max(...ok.map((s) => s.liftMax)), 3)} m, slid at most ${f(Math.max(...ok.map((s) => s.disp)), 3)} m (median ${f(med(ok.map((s) => s.disp)), 3)}; the 3 cm lever of 5.4 is the shell's moveTo hold)`);
    if (ds.length === 1 && sps.length >= 40) row(miss.length <= 2, `5.4 (b): the momentum the neck adds, |v1 - v0| at the swap, plane ${pn}, ${ok.length} species at the family depths${NECK_OBL.cap !== 1 ? ' (oblique depth cap ' + NECK_OBL.cap + ')' : ''}: species over 0.5 m/s`, `${miss.length} of ${ok.length}${miss.length ? ' (' + miss.map((s) => `${s.sp} ${f(s.dv, 2)}`).join(', ') + ')' : ''}; bar <= 2 of 50`);
  }
}

/* ───────────────────────── x19: swap continuity ───────────────────────── */
if (on('x19')) {
  const sps = shard(arg('species') ? arg('species').split(',') : FAM12);
  const out: string[] = []; let bad = 0;
  for (const sp of sps) {
    const st = run(sp, 'x0', depthArg(sp), { chamfer: true });
    if (!st.ok || !st.ch) { out.push(`${sp} refused`); bad++; continue; }
    const bar = st.fam === 'stickystretch' || st.fam === 'slimegoo' ? 0.15 : 0.08;
    if (st.ch.vis > bar) bad++;
    out.push(`${st.fam} (${sp}, depth ${f(st.depth, 2)}) ${f(st.ch.vis, 3)}${st.ch.vis > bar ? ' > ' + bar : ''}`);
  }
  row(bad === 0 && sps.length > 0, 'X19 swap continuity: Chamfer (R0) between the necked parent at the swap and the two halves, visible faces only, per family at its depth (bar 0.08; sticky and slime 0.15)', out.join('; ') + (bad ? ` [${bad} over]` : ''));
}

/* ───────────────────────── swell ───────────────────────── */
if (on('swell')) {
  const sps = shard(arg('species') ? arg('species').split(',') : FAM12), worst: string[] = []; let mx = 0, bad = 0;
  for (const sp of sps) {
    const st = run(sp, 'x0', depthArg(sp), { full: true });
    if (!st.ok) continue;
    const sw = Math.max(st.swell ?? 0, st.top);
    mx = Math.max(mx, sw); if (sw > 1.25) bad++;
    worst.push(`${st.fam} ${f(sw, 2)}`);
  }
  row(bad === 0 && sps.length > 0, 'cut swell: the highest particle of the squishy and its pieces during the neck and for 2.5 s after the swap, over the settled height, per family at its depth (the old neck: x1.66 to x1.94 on putty, slow-rise, firm silicone)', `max x${f(mx, 2)}: ${worst.join(', ')}; bar <= x1.25${bad ? ' [over: lower that family in src/shell/cut.ts NECK_DEPTH; --table=fam:depth,.. evaluates a candidate]' : ''}`);
}

/* ───────────────────────── fit: the table ───────────────────────── */
if (mode === 'fit') {
  const sps = shard(arg('species') ? arg('species').split(',') : ALL);
  for (const sp of sps) for (const pn of (arg('planes') || 'x0').split(',')) for (const d of (arg('depths') || '1,0.65,0.5,0.35,0.25,0.15').split(',')) run(sp, pn, +d, { chamfer: true });
  const ok = stats.filter((s) => s.ok && s.ch), fams = [...new Set(ok.map((s) => s.fam))], depths = [...new Set(ok.map((s) => s.depth))].sort((a, b) => b - a);
  console.log('\nfit: median visible Chamfer (R0) | max |v1-v0| m/s | max neck-top ratio, per family and depth (plane x0)');
  console.log('family'.padEnd(14) + depths.map((d) => String(d).padStart(17)).join(''));
  const table: string[] = [];
  for (const fam of fams) {
    let ln = fam.padEnd(14), best: number | null = null;
    const bar = fam === 'stickystretch' || fam === 'slimegoo' ? 0.15 : 0.08;
    for (const d of depths) {
      const set = ok.filter((s) => s.fam === fam && s.depth === d);
      if (!set.length) { ln += ''.padStart(17); continue; }
      const ch = med(set.map((s) => s.ch!.vis));
      if (best === null && ch <= bar) best = d;
      ln += `${f(ch)}|${f(Math.max(...set.map((s) => s.dv)), 2)}|${f(Math.max(...set.map((s) => s.top)), 2)}`.padStart(17);
    }
    console.log(ln);
    table.push(`${fam} (bar ${bar}): largest swept depth with median Chamfer <= bar = ${best === null ? 'none' : best}`);
  }
  console.log(table.join('\n'));
}

for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.what}\n          measured: ${r.val}`);
if (rows.length) console.log(`${rows.filter((r) => r.ok).length}/${rows.length} neck rows passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(stats));
process.exit(rows.some((r) => !r.ok) ? 1 : 0);
