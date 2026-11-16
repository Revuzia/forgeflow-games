// RENDER node checks of the eyes and the ember of a PIECE (CUT2.md 8.3; probe rows RP1 / RP2 / RP5 data half; task R1 part 2). Plain node (type stripping):
//   node _harness/renderview/eye_checks.ts [--quick] [--all] [--species=a,b]
// PHYS's pure builder (src/physics/piece.ts) cuts the real species' rest mesh; `wholeRefFor` places the eyes on the whole, `buildPieceEyes` decides what each piece draws. Measured by things
// other than the code under test: the plane's own signed distance to the eye centre, the planes' own sides, the whole mesh's own flat triangles.
import { CATALOG, speciesBaseGenome } from '../../src/data/catalog.ts';
import { buildPieceMesh, isCutPiece } from '../../src/render/pieceBuild.ts';
import { buildPieceEyes, EYE_KEEP_F, pieceSalt } from '../../src/render/pieceEyes.ts';
import { wholeRefFor } from '../../src/render/wholeRef.ts';
import type { PieceInfo, V3 } from '../../src/contracts.ts';
import { physPieces } from './physPieces.ts';
import type { CutSide } from './physPieces.ts';

const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith('--' + k + '='))?.slice(k.length + 3);
const ALL = process.argv.includes('--all'), QUICK = process.argv.includes('--quick');
const SPECIES = arg('species') ? arg('species')!.split(',') : ALL ? CATALOG.map((d) => d.id as string) : QUICK ? ['dollop', 'kneadle', 'granulo'] : ['dollop', 'kneadle', 'capnap', 'munchip', 'granulo', 'marigel', 'petalop', 'puddlo'];
interface Row { what: string; value: string; limit: string; pass: boolean }
const rows: Row[] = [];
const add = (what: string, value: string, limit: string, pass: boolean): void => { rows.push({ what, value, limit, pass }); };
const info = (what: string, value: string): void => { rows.push({ what: 'INFO ' + what, value, limit: '-', pass: true }); };
const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const pct = (a: number[], p: number): number => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

const prov = physPieces();
const nrm = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const PLANES: { n: V3; off: number; label: string }[] = [
  { n: { x: 1, y: 0, z: 0 }, off: 0.2, label: 'x+.2' }, { n: { x: 1, y: 0, z: 0 }, off: -0.2, label: 'x-.2' },
  { n: { x: 0, y: 1, z: 0 }, off: 0, label: 'y0' }, { n: { x: 0, y: 1, z: 0 }, off: 0.3, label: 'y+.3' },
  { n: nrm({ x: 0.667, y: 0.718, z: -0.199 }), off: 0.1, label: 't1' }, { n: nrm({ x: -0.45, y: 0.62, z: 0.64 }), off: -0.2, label: 't2' },
  { n: nrm({ x: 0.2, y: 0.05, z: 1 }), off: 0.15, label: 'z+.15' },
];

const acc: Record<string, number[]> = {};
const push = (k: string, v: number): void => { (acc[k] ??= []).push(v); };
const counts: Record<string, number> = {};
const bump = (k: string, n = 1): void => { counts[k] = (counts[k] ?? 0) + n; };
const crossedRest: string[] = [], crossedReach: string[] = [];
const notes: string[] = [];

function eyesOf(g: ReturnType<typeof speciesBaseGenome>, side: CutSide) {
  const wh = prov.whole(g), r = side.rest;
  const piece: PieceInfo = { whole: wh, offset: r.offset, rayOrigin: r.rayOrigin, cells: r.cells };
  if (!isCutPiece(piece)) throw new Error('not a cut piece');
  const pb = buildPieceMesh(r.restLocal, r.indices, piece, 2);
  const ref = wholeRefFor({ vertexCount: (wh.restLocal.length / 3) | 0, indices: wh.indices, restLocal: wh.restLocal }, wh.radius, g);
  return { piece, pb, ref, eyes: buildPieceEyes(r.restLocal, r.indices, piece, pb, ref) };
}

for (const sp of SPECIES) {
  const g = speciesBaseGenome(sp as never, 1), wh = prov.whole(g);
  const ref = wholeRefFor({ vertexCount: (wh.restLocal.length / 3) | 0, indices: wh.indices, restLocal: wh.restLocal }, wh.radius, g);
  const R0 = wh.radius;
  // ---- the eyes the formulas place: symmetric about x = 0, on the +z front, on the whole's surface
  {
    const [L, Rr] = ref.eyes;
    push('symX', Math.abs(L.centre.x + Rr.centre.x) / R0); push('symY', Math.abs(L.centre.y - Rr.centre.y) / R0);
    bump('wholes');
    if (!(L.centre.x < 0 && Rr.centre.x > 0)) notes.push(sp + ': eye slots are not -x / +x');
    // the bead's centre is `lift` above the Phong surface point: distance of the centre to the whole's nearest flat triangle point, in R0
    const st = ref.style;
    const lift = ref.r * st.sz * 0.12;
    for (const e of ref.eyes) { const d = Math.hypot(e.centre.x - e.q.x, e.centre.y - e.q.y, e.centre.z - e.q.z); push('liftRatio', d / Math.max(1e-9, lift + (st.droop ? ref.r * st.droop : 0))); }
    // reach at the x = 0 plane (the first Split in two, eye-midline plane): crossed at REST size (|x| < r max(sx, sy)) and by reach (rho)
    const restReach = ref.r * Math.max(st.sx, st.sy);
    const half = Math.hypot(Rr.centre.x - L.centre.x, Rr.centre.y - L.centre.y, Rr.centre.z - L.centre.z) / 2;   // each eye's distance to the eye-midline plane
    push('halfSepR0', half / R0);
    if (half < restReach) crossedRest.push(sp);
    if (half < ref.rho) crossedReach.push(sp);
  }
  // ---- the centre cut x = 0 (the eye-midline plane): one eye on each piece, the beads recombine (f_A + f_B = 1 from the unclamped s), both pieces build
  {
    // the eye-midline plane (the first Split in two, CUT2 6.2): the plane through the midpoint of the two eyes whose normal is the line joining them
    const [e0, e1] = ref.eyes, nm = nrm({ x: e1.centre.x - e0.centre.x, y: e1.centre.y - e0.centre.y, z: e1.centre.z - e0.centre.z });
    const dm = nm.x * (e0.centre.x + e1.centre.x) / 2 + nm.y * (e0.centre.y + e1.centre.y) / 2 + nm.z * (e0.centre.z + e1.centre.z) / 2;
    const cut = prov.cut(g, nm, dm);
    if ('refused' in cut) { notes.push(sp + ' midline refused: ' + cut.refused); bump('refusedCentre'); }
    else {
      const A = eyesOf(g, cut.a), B = eyesOf(g, cut.b);
      bump('cuts');
      const slotsA = A.eyes.eyes.map((e) => e.slot), slotsB = B.eyes.eyes.map((e) => e.slot);
      const holdsBoth = (s: number[], t: number[]): boolean => s.includes(0) && s.includes(1) && t.includes(0) && t.includes(1);
      // side A is n . x >= d = the +x side: it holds the +x eye (slot 1), B the slot 0 eye; a crossed eye (f in [0.12, 0.88]) is on both
      const okA = slotsA.includes(1), okB = slotsB.includes(0);
      if (!okA || !okB) { notes.push(`${sp}: centre cut A holds slots [${slotsA}] B [${slotsB}]`); bump('centreWrongSides'); }
      if (A.eyes.eyes.length + B.eyes.eyes.length === 2) bump('centreOnePerHalf');
      else if (holdsBoth(slotsA, slotsB) || A.eyes.eyes.length + B.eyes.eyes.length > 2) bump('centreStraddled');
      // f_A + f_B (unclamped) = 1: from the planes' own numbers
      for (const e of [0, 1]) {
        const c = ref.eyes[e].centre, pa = A.pb.planes[0], pb2 = B.pb.planes[0];
        const sA = pa.n.x * c.x + pa.n.y * c.y + pa.n.z * c.z - pa.d, sB = pb2.n.x * c.x + pb2.n.y * c.y + pb2.n.z * c.z - pb2.d;
        push('fsumErr', Math.abs((ref.rho - sA) / (2 * ref.rho) + (ref.rho - sB) / (2 * ref.rho) - 1));
      }
      push('saltDiffers', pieceSalt(A.piece) !== pieceSalt(B.piece) ? 1 : 0);
    }
  }
  // ---- off-centre and oblique planes: membership by the planes' own sides, offsets, clip planes
  for (const pl of PLANES) {
    const cut = prov.cut(g, pl.n, pl.off * R0);
    if ('refused' in cut) { bump('refusedOther'); continue; }
    for (const side of [cut.a, cut.b]) {
      const E = eyesOf(g, side);
      bump('pieces');
      const planes = E.pb.planes;
      let kept = 0;
      for (const e of [0, 1]) {
        const c = ref.eyes[e].centre;
        let s = -Infinity; for (const p of planes) { const v = p.n.x * c.x + p.n.y * c.y + p.n.z * c.z - p.d; if (v > s) s = v; }
        const fwant = planes.length ? Math.min(1, Math.max(0, (ref.rho - s) / (2 * ref.rho))) : 1;
        const got = E.eyes.eyes.find((q) => q.slot === e);
        const want = fwant >= EYE_KEEP_F;
        if (want !== !!got) { bump('membershipWrong'); notes.push(`${sp} ${pl.label}: slot ${e} want ${want} got ${!!got} (f ${f(fwant)})`); }
        if (got) {
          kept++;
          if (Math.abs(got.f - fwant) > 1e-12) bump('fWrong');
          const nclip = planes.filter((p) => p.n.x * c.x + p.n.y * c.y + p.n.z * c.z - p.d > -ref.rho).length;
          if (got.clip.length !== Math.min(2, nclip)) bump('clipCountWrong');
          bump('keptEyes'); if (got.clip.length > 0) bump('clippedEyes');
          // the anchor: the nearest skin point of the piece to the whole's flat hit point, and the offset the pose would carry
          push('offR0' + (got.clip.length ? 'Clipped' : 'Unclipped'), got.offRaw / R0);
          if (got.hasOff) bump('hasOff');
          bump('footTotal', 4); bump('footInvalid', got.footOk.filter((x) => !x).length);
          // the anchor triangle is a skin triangle
          const skin = new Set(Array.from(E.pb.skinTris));
          if (!skin.has(got.hit.tri)) bump('anchorNotSkin');
          for (const h of got.foot) if (!skin.has(h.tri)) bump('footNotSkin');
        }
      }
      if (kept === 0) bump('eyelessPieces');
    }
  }
}

add('wholes checked', String(counts.wholes ?? 0), '-', (counts.wholes ?? 0) > 0);
info('the eyes against x = 0 on the whole (max |x_L + x_R| / R0, max |y_L - y_R| / R0): the species are not mirror images of themselves, which is why the first Split in two uses the eye-midline plane', `${f(Math.max(...acc.symX), 4)} / ${f(Math.max(...acc.symY), 4)}`);
add('the bead centre is its lift above the surface point (ratio to sz x 0.12 [+ droop]: min / max)', `${f(Math.min(...acc.liftRatio))} / ${f(Math.max(...acc.liftRatio))}`, '0.6 .. 1.4', Math.min(...acc.liftRatio) >= 0.6 && Math.max(...acc.liftRatio) <= 1.4);
add('eye-midline cut: every piece holds the eye on its own side', String(counts.centreWrongSides ?? 0) + ' wrong of ' + (counts.cuts ?? 0), '0 wrong', (counts.centreWrongSides ?? 0) === 0);
info('eye-midline cut: one eye per half / a straddled eye on both / refused', `${counts.centreOnePerHalf ?? 0} / ${counts.centreStraddled ?? 0} / ${counts.refusedCentre ?? 0}`);
info('species whose bead at REST size is crossed by the eye-midline plane (spec X03: {granulo, marigel} +-1) / by the reach rho (x1.24: {munchip, granulo, petalop, marigel})', `${crossedRest.join(',') || '-'} / ${crossedReach.join(',') || '-'}`);
add('f_A + f_B = 1 (unclamped, both sides of the midline cut; max error)', f(Math.max(...(acc.fsumErr ?? [0])), 12), '<= 1e-9', Math.max(...(acc.fsumErr ?? [0])) <= 1e-9);
add('the two halves of a cut have different blink salts', `${(acc.saltDiffers ?? []).reduce((a, b) => a + b, 0)} of ${(acc.saltDiffers ?? []).length}`, 'all', (acc.saltDiffers ?? []).every((x) => x === 1));
add('membership: kept iff f >= 0.12, by the planes\' own signed distances (wrong cases)', `${counts.membershipWrong ?? 0} of ${counts.keptEyes ?? 0} kept eyes in ${counts.pieces ?? 0} pieces`, '0', (counts.membershipWrong ?? 0) === 0);
add('remaining width f and the clip planes (1 to 2, the nearest first) as the spec: wrong cases', `${(counts.fWrong ?? 0)} f, ${(counts.clipCountWrong ?? 0)} clip`, '0', (counts.fWrong ?? 0) === 0 && (counts.clipCountWrong ?? 0) === 0);
add('anchors: the eye\'s hit and its four footprint samples are triangles of the piece\'s SKIN', `${(counts.anchorNotSkin ?? 0)} + ${(counts.footNotSkin ?? 0)} not skin`, '0', (counts.anchorNotSkin ?? 0) === 0 && (counts.footNotSkin ?? 0) === 0);
info('kept eyes / clipped by a cut face / eyeless pieces', `${counts.keptEyes ?? 0} / ${counts.clippedEyes ?? 0} / ${counts.eyelessPieces ?? 0} of ${counts.pieces ?? 0} pieces`);
info('offset anchor -> whole hit, UNCLIPPED eyes (R0): median / p95 / max', `${f(pct(acc.offR0Unclipped ?? [], 0.5), 5)} / ${f(pct(acc.offR0Unclipped ?? [], 0.95), 5)} / ${f(Math.max(...(acc.offR0Unclipped ?? [0])), 5)}  (the 0.01 R0 rule applies it to ${counts.hasOff ?? 0})`);
info('offset anchor -> whole hit, CLIPPED eyes (R0): median / p95 / max (they are calibrated, not offset)', `${f(pct(acc.offR0Clipped ?? [], 0.5), 5)} / ${f(pct(acc.offR0Clipped ?? [], 0.95), 5)} / ${f(Math.max(...(acc.offR0Clipped ?? [0])), 5)}`);
info('footprint samples beyond a cut face (one-sided difference)', `${counts.footInvalid ?? 0} of ${counts.footTotal ?? 0}`);

let fails = 0;
for (const r of rows) { if (!r.pass) fails++; console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.what}: ${r.value}  [${r.limit}]`); }
for (const n of notes.slice(0, 20)) console.log('note ' + n);
console.log(`${rows.length - fails}/${rows.length} ok, ${fails} FAIL (${SPECIES.length} species)`);
process.exit(fails ? 1 : 0);
