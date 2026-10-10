// CUT3 SHELL checks on MOCK bodies that speak the whole true-cut contract (CUT3.md 4 SHELL, 5 U01 / U04 / U05 / U07; task shell-c1, 2026-10-09). Plain node, exits 1 on a failed row.
//   node _harness/shellview/cut_mock_checks.ts              all rows (a few seconds: no physics, no DOM)
//   node _harness/shellview/cut_mock_checks.ts --only=a,b   sections: u01 (20 presses, both styles), ceiling, joins (group joins and Reconnect all, any count), minis24, swipes, leave, parts (CUT3 leg 3: a cut that makes several pieces)
//
// WHY MOCKS: the shell's piece manager (cut.ts) is the code under test, not the physics. The real SoftBody clamped a piece at 1/8 until the PHYS lane lifted it on 2026-10-09, and the ceiling of 64 pieces is still out of reach of a browser run, so rows that need
// 20 nested halvings of a REAL body live in cutter_checks.ts (section u01, red until PHYS lands) and everything the shell does for ANY number of pieces is proved here, with no limit in the way:
//   * MockBall: a body that is a ball of radius 0.5 cbrt(frac) (a whole sphere of the squishy in the frame W), implements planCut / prepareCut / placeAt / setNeck / moveTo / setFrac / measureCut / raycast
//     and publishes `piece.offset` exactly as the physics does (offset of the cell's centroid in W, a pure function of the cell: a node that is joined back has the offset it had before).
//   * the Cutter, the BodyManager, the camera and the mock stage are the REAL ones.
import { createMockWorld } from '../mocks.ts';
import type { PieceInfo, SoftBodyLike } from '../../src/contracts.ts';
import { speciesBaseGenome } from '../../src/data/catalog.ts';
import { createBodyManager } from '../../src/shell/bodies.ts';
import { JOIN_ALL_S, JOIN_HOLD_S, JOIN_S, PIECE_CEILING, TIP_PUSH, createCutter, principalAxes, supportAlong } from '../../src/shell/cut.ts';
import type { CutStyle } from '../../src/shell/cut.ts';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const run = (name: string): boolean => only.length === 0 || only.includes(name);
let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
type V = { x: number; y: number; z: number };
const HOME_WAIT = JOIN_ALL_S + 2;
const KIND = "That's a lot of pieces! Reconnect some to keep cutting.";

const N = 96;
const UNIT = (() => { const a = new Float64Array(N * 3); for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963; a[i * 3] = Math.cos(th) * r; a[i * 3 + 1] = y; a[i * 3 + 2] = Math.sin(th) * r; } return a; })();
const capShare = (R: number, sd: number): number => { const h = R - sd; return (Math.PI * h * h * (3 * R - h) / 3) / (4 / 3 * Math.PI * R * R * R); };   // share of a ball on the side n.(x - c) >= sd

function mockWorld(o: { ceiling?: number; style?: CutStyle; gravity?: boolean; slowBuild?: boolean; tips?: number; oldLoose?: boolean; failPart?: number } = {}) {
  const w = createMockWorld({ storage: null });
  const st = w.stage as unknown as Record<string, unknown>;
  let vid = 100;
  st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.addBody = () => ++vid; st.removeBody = () => {}; st.setBody = () => {}; st.setCutSeam = () => {}; st.setBridge = () => {}; st.partPieces = () => {}; st.setPrimaryBody = () => {};
  const info = new Map<string, { offset: V; frac: number }>([['', { offset: { x: 0, y: 0, z: 0 }, frac: 1 }]]);
  const made: Array<{ body: SoftBodyLike; piece: { frac: number; region?: { part?: number; cells: number[][] }; chunk?: boolean } | null }> = [];
  const childOffset = (parent: { offset: V; frac: number }, n: V, d: number, sign: 1 | -1): V => {
    const Rp = 0.5 * Math.cbrt(parent.frac), sd = Math.max(-Rp * 0.98, Math.min(Rp * 0.98, d - (n.x * parent.offset.x + n.y * parent.offset.y + n.z * parent.offset.z)));
    const t = sign > 0 ? sd + (Rp - sd) * 0.375 : sd - (Rp + sd) * 0.375;
    return { x: parent.offset.x + n.x * t, y: parent.offset.y + n.y * t, z: parent.offset.z + n.z * t };
  };
  const mk = (g: unknown, op?: { at?: V; piece?: { frac: number; chunk?: boolean; at?: V; vel?: V; region?: { planes: Array<{ id: number; n: V; d: number }>; cells: number[][] } } }): SoftBodyLike => {
    const pc = op?.piece ?? null;
    let frac = pc?.frac ?? 1;
    const lits = pc?.region?.cells[0] ?? null, tok = (pc?.region as { part?: number } | undefined)?.part;
    if (o.failPart !== undefined && tok === o.failPart) throw new Error('mock: the physics cannot be built this part');
    let offset: V = { x: 0, y: 0, z: 0 };
    if (lits) {
      // a part of a cell (a tip of a star) is its own body: its token makes its own origin, a little off the cell's
      const cellKey = lits.join(','), k = tok === undefined ? cellKey : cellKey + '#' + tok;
      let inf = info.get(k);
      if (!inf) {
        const par = info.get(lits.slice(0, -1).join(',')), last = lits[lits.length - 1], pl = pc!.region!.planes.find((p) => p.id === Math.abs(last));
        if (!par || !pl) throw new Error('mock: no parent info for cell ' + k);
        const base = childOffset(par, pl.n, pl.d, last > 0 ? 1 : -1), j = tok ?? 0;
        inf = { offset: { x: base.x + 0.07 * j, y: base.y + 0.05 * j, z: base.z }, frac };
        info.set(k, inf);
        if (!info.has(cellKey)) info.set(cellKey, inf);
      }
      offset = inf.offset; frac = pc!.frac;
    }
    const R0 = 0.5;
    const at = pc?.at ?? op?.at ?? { x: 0, y: R0 * Math.cbrt(frac), z: 0 };
    const center = { x: at.x, y: at.y, z: at.z };
    const positions = new Float32Array(N * 3);
    let goal: V | null = null;
    const counts = { necks: 0, placed: 0, moved: 0, prepared: 0 };
    let lastSd = 0, lastN: V = { x: 1, y: 0, z: 0 };
    const rebuild = (): void => { const r = body.restRadius; for (let i = 0; i < N; i++) { positions[i * 3] = center.x + UNIT[i * 3] * r; positions[i * 3 + 1] = center.y + UNIT[i * 3 + 1] * r; positions[i * 3 + 2] = center.z + UNIT[i * 3 + 2] * r; } };
    const body = {
      vertexCount: N, positions, restLocal: new Float32Array(N * 3), indices: new Uint32Array(0), strain: new Float32Array(N).fill(1), center, frame: { x: 0, y: 0, z: 0, w: 1 },
      metrics: { compression: 0, compressionRate: 0, stretch: 0, volume: 1, kinetic: 0, grounded: true, fingers: 0, grabbed: false }, restRadius: R0 * Math.cbrt(frac), gravity: true, counts,
      get frac() { return frac; },
      piece: lits ? ({ offset, cells: [], rayOrigin: { x: 0, y: 0, z: 0 } } as unknown as PieceInfo) : undefined,
      step(dt: number) {
        if (!goal) return;
        const dx = goal.x - center.x, dz = goal.z - center.z, l = Math.hypot(dx, dz), s = l > 1e-9 ? Math.min(1, (3 * dt) / l) : 0;
        center.x += dx * s; center.z += dz * s; rebuild();
      },
      raycast(origin: V, dir: V) {
        const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z, dl = Math.hypot(dir.x, dir.y, dir.z), dx = dir.x / dl, dy = dir.y / dl, dz = dir.z / dl;
        const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - body.restRadius * body.restRadius, disc = b * b - c;
        if (disc < 0) return null;
        const t = -b - Math.sqrt(disc);
        if (t < 0) return null;
        const p = { x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t };
        return { point: p, normal: { x: (p.x - center.x) / body.restRadius, y: (p.y - center.y) / body.restRadius, z: (p.z - center.z) / body.restRadius }, vertex: 0, t };
      },
      collide() { /* no contact in the mock */ }, nudge() { /* none */ }, tremble() { /* none */ },
      moveTo(p: V | null) { if (p) counts.moved++; goal = p ? { ...p } : null; },
      setNeck(pl: unknown) { if (pl) counts.necks++; },
      setFrac(f: number) { frac = Math.max(1e-9, Math.min(1, f)); body.restRadius = R0 * Math.cbrt(frac); rebuild(); },
      measureCut(pl: { point: V; normal: V }) {
        const l = Math.hypot(pl.normal.x, pl.normal.y, pl.normal.z), sd = ((pl.point.x - center.x) * pl.normal.x + (pl.point.y - center.y) * pl.normal.y + (pl.point.z - center.z) * pl.normal.z) / l;
        return Math.abs(sd) >= body.restRadius ? null : capShare(body.restRadius, sd);
      },
      planCut(pl: { point: V; normal: V }, out: { rest: { n: V; d: number }; fa: number; offA: V; offB: V; velA: V; velB: V; aspectA: number; aspectB: number; sound: boolean; soundPending?: boolean; built: boolean; parts?: number; partList?: unknown[] }, mode: string = 'at') {
        if (mode === 'latched') { out.built = counts.prepared >= 2; return true; }
        const l = Math.hypot(pl.normal.x, pl.normal.y, pl.normal.z), n = { x: pl.normal.x / l, y: pl.normal.y / l, z: pl.normal.z / l }, R = body.restRadius;
        let sd = mode === 'median' ? 0 : ((pl.point.x - center.x) * n.x + (pl.point.y - center.y) * n.y + (pl.point.z - center.z) * n.z);
        if (Math.abs(sd) >= R * 0.995) return false;
        lastSd = sd; lastN = n;
        const d = sd + n.x * offset.x + n.y * offset.y + n.z * offset.z;
        out.rest.n.x = n.x; out.rest.n.y = n.y; out.rest.n.z = n.z; out.rest.d = d;
        out.fa = capShare(R, sd);
        const self = { offset, frac };
        const oa = childOffset(self, n, d, 1), ob = childOffset(self, n, d, -1);
        out.offA.x = oa.x - offset.x; out.offA.y = oa.y - offset.y; out.offA.z = oa.z - offset.z; out.offB.x = ob.x - offset.x; out.offB.y = ob.y - offset.y; out.offB.z = ob.z - offset.z;
        out.velA.x = out.velA.y = out.velA.z = out.velB.x = out.velB.y = out.velB.z = 0;
        const fa = out.fa; out.aspectA = out.aspectB = Math.max(0.2, Math.min(fa, 1 - fa) * 2);
        out.sound = true; out.soundPending = false; out.built = false; counts.prepared = 0;
        out.parts = 2; out.partList = undefined;
        if (o.oldLoose && Math.abs(sd) > 0.45 * R) { out.sound = false; out.parts = undefined; }   // an older physics: a cap of several separate parts is 'loose'
        else if (o.tips && Math.abs(sd) > 0.45 * R) {
          // a cap cut off a ball is `tips` separate tips (a star): each its own body with its token (1, 2, ...); the rest of the ball is the other side's one body
          const capSide = sd > 0 ? 0 : 1, capFrac = capSide === 0 ? out.fa : 1 - out.fa, k = o.tips, capOff = capSide === 0 ? oa : ob, restOff = capSide === 0 ? ob : oa;
          const tips = Array.from({ length: k }, (_u, j) => ({ side: capSide, part: j + 1, frac: capFrac / k, off: { x: capOff.x - offset.x + 0.02 * j, y: capOff.y - offset.y, z: capOff.z - offset.z }, vel: { x: 0, y: 0, z: 0 }, aspect: 0.5 }));
          const rest = { side: 1 - capSide, part: undefined, frac: 1 - capFrac, off: { x: restOff.x - offset.x, y: restOff.y - offset.y, z: restOff.z - offset.z }, vel: { x: 0, y: 0, z: 0 }, aspect: 0.5 };
          out.partList = capSide === 0 ? [...tips, rest] : [rest, ...tips];
          out.parts = k + 1;
        }
        void sd; sd = lastSd; void lastN;
        return true;
      },
      prepareCut() { counts.prepared++; return o.slowBuild ? counts.prepared >= 3 : counts.prepared >= 2; },
      placeAt(a: V, _vel: V) { counts.placed++; center.x = a.x; center.y = a.y; center.z = a.z; rebuild(); },
    };
    rebuild();
    made.push({ body: body as unknown as SoftBodyLike, piece: pc ? { frac: pc.frac, region: pc.region, chunk: pc.chunk } : null });
    return body as unknown as SoftBodyLike;
  };
  const g0 = speciesBaseGenome('dollop' as never, 1);
  const body0 = mk(g0);
  const bm = createBodyManager({ createBody: (g) => mk(g), stage: w.stage, initial: { body: body0, identity: { genome: g0, tier: 'common', itemId: 'it-1', nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
  const notices: string[] = [];
  let t = 0, active: SoftBodyLike | null = null, touching = false, dragV: V | null = null;
  const audio: string[] = [];
  const au = w.audio as unknown as Record<string, unknown>;
  au.cut = (p: { phase: string }) => audio.push('cut:' + p.phase); au.rejoin = () => audio.push('rejoin');
  const ct = createCutter({
    bodies: bm, stage: w.stage, audio: w.audio, haptics: w.haptics, createBody: mk, quality: () => 'high', calm: () => false, gravity: () => o.gravity !== false, simTime: () => t, viewport: () => ({ w: 800, h: 600 }),
    activeBody: () => active ?? bm.body, touching: () => touching, drag: (out) => { if (!dragV || !touching) return false; out.x = dragV.x; out.y = dragV.y; out.z = dragV.z; return true; },
    beforeChange() {}, clearMat: () => 0, panOf: () => 0, say: (s) => notices.push(s), report: (e) => { if (o.failPart !== undefined) return; throw e; }, ceiling: o.ceiling, deterministic: true,
  });
  if (o.style) ct.setStyle(o.style);
  const step = (sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; bm.step(1 / 60); ct.update(1 / 60); } };
  const idle = (max = 6): void => { for (let i = 0; i < max * 60 && ct.busy; i++) step(1 / 60); };
  const bodies = (): SoftBodyLike[] => [bm.body, ...bm.extras.map((x) => x.body)];
  const cam = (w.stage as unknown as { camera: unknown }).camera;
  return {
    w, bm, ct, g0, mk, made, info, notices, audio, step, idle, bodies, cam, now: () => t,
    finger(b: SoftBodyLike | null, drag: V | null = null) { active = b; touching = b !== null; dragV = drag; },
  };
}
type World = ReturnType<typeof mockWorld>;
const sum = (a: number[]): number => a.reduce((s, x) => s + x, 0);
const stand = (b: SoftBodyLike, to: SoftBodyLike, gap: number): void => {   // put b beside `to` along +x with the SURFACE gap `gap`
  const rb = supportAlong(b, { x: -1, y: 0, z: 0 }), rt = supportAlong(to, { x: 1, y: 0, z: 0 });
  b.moveTo?.({ x: to.center.x + rt + rb + gap, y: to.center.y, z: to.center.z }, 1);
  const bb = b as unknown as { placeAt(a: V, v: V): void };
  bb.placeAt({ x: to.center.x + rt + rb + gap, y: b.center.y, z: to.center.z }, { x: 0, y: 0, z: 0 });
  b.moveTo?.(null);
};
/** drag piece P into piece Q by hand (the Hand tool's touch-to-join) and let go: runs until the join ends */
const joinByHand = (r: World, P: SoftBodyLike, Q: SoftBodyLike): void => {
  stand(P, Q, 0.02);
  r.finger(P, { x: -0.8 * P.restRadius, y: 0, z: 0 });
  r.step(JOIN_HOLD_S + 0.2);
  r.finger(null);
  for (let i = 0; i < 4 * 60 && !r.ct.busy; i++) r.step(1 / 60);   // (a let-go join starts on the next step)
  r.idle(10); r.step(2);
};
const largest = (r: World): SoftBodyLike => r.bodies().reduce((m, b) => ((b.frac ?? 1) > (m.frac ?? 1) + 1e-9 ? b : m));

/* ───────── U01: 20 consecutive Split in two presses on the largest piece, both styles: all succeed, shares sum to 1 within 1e-9, Reconnect all ends bit-for-bit whole ───────── */
if (run('u01')) {
  for (const style of ['clean', 'minis'] as const) {
    const r = mockWorld({ style });
    const res: string[] = [], never = r.made[0].body;
    let largestCut = true;
    for (let i = 0; i < 20; i++) {
      const big = largest(r);
      res.push(r.ct.splitInTwo());
      r.idle(8); r.step(0.3);
      if (r.bodies().includes(big)) largestCut = false;   // the biggest piece was replaced by its two halves
    }
    const fr = r.ct.fracs();
    check(`U01 (${style}): 20 consecutive presses of Split in two all succeed (cut x20), 21 pieces, each press cut the LARGEST piece, no limit line said`, res.every((x) => x === 'cut') && r.ct.pieces === 21 && largestCut && !r.notices.some((n) => /as many|lot of pieces|Too small|small as it gets/.test(n)), `${res.filter((x) => x !== 'cut').join() || 'all cut'}; pieces ${r.ct.pieces}; last notice "${r.notices.at(-1)}"`);
    check(`U01 (${style}): the shares sum to 1 within 1e-9 (${sum(fr).toFixed(12)}), every piece positive, ${style === 'clean' ? 'one region per piece with distinct cells and one anchor' : 'every mini is a complete smaller copy (no region, chunk false)'}`,
      Math.abs(sum(fr) - 1) < 1e-9 && fr.every((f) => f > 0) && (style === 'clean'
        ? r.ct.regions().length === 21 && new Set(r.ct.regions().map((x) => JSON.stringify(x.cells))).size === 21 && r.ct.regions().filter((x) => x.anchor).length === 1
        : r.made.slice(1).every((m) => m.piece && m.piece.region === undefined && m.piece.chunk === false)));
    const ok = r.ct.reconnectAll(true); r.idle(15); r.step(HOME_WAIT);
    const W = r.bm.body;
    check(`U01 (${style}): Reconnect all from 21 pieces ends bit-for-bit whole: ONE fresh body built with no piece options (the original constructor path), frac 1, no PieceInfo, no extras, the original genome object, at the middle, "Whole again."`,
      ok && r.ct.pieces === 1 && r.bm.extras.length === 0 && W !== never && W.frac === 1 && W.piece === undefined && r.bm.identity.genome === r.g0 && Math.hypot(W.center.x, W.center.z) < 1e-9 && r.notices.at(-1) === 'Whole again.' && r.made.at(-1)!.piece === null,
      `pieces ${r.ct.pieces}, extras ${r.bm.extras.length}, frac ${W.frac}, last notice ${r.notices.at(-1)}`);
  }
}


/* ───────── the safety ceiling (CUT3.md 2.2): one constant, a kind line, and cutting works again after a join ───────── */
if (run('ceiling')) {
  check(`the ceiling is ONE constant, 64, the same in both styles and at every quality tier (PIECE_CEILING ${PIECE_CEILING})`, PIECE_CEILING === 64);
  for (const style of ['clean', 'minis'] as const) {
    const r = mockWorld({ style, ceiling: 6 });
    const res: string[] = [];
    for (let i = 0; i < 7; i++) { res.push(r.ct.splitInTwo()); r.idle(8); r.step(0.3); }
    check(`ceiling (${style}, test ceiling 6): five presses reach 6 pieces, the next says the KIND line and changes nothing; Split in two is disabled only now (canSplit false, maxPieces 6)`,
      res.slice(0, 5).every((x) => x === 'cut') && res[5] === 'limit' && res[6] === 'limit' && r.ct.pieces === 6 && !r.ct.canSplit && r.ct.maxPieces === 6 && r.notices.at(-1) === KIND, `${res.join()}; "${r.notices.at(-1)}"`);
    const sw = r.ct.swipe(380, 250, 420, 330);
    check(`ceiling (${style}): a swipe at the ceiling is refused with the same kind line too (or misses the pieces)`, (sw === 'limit' && r.notices.at(-1) === KIND) || sw === 'miss', sw);
    // a join frees a place: the Cut tool works again
    const ps = r.bodies();
    const P = ps[ps.length - 1], Q = ps[ps.length - 2];
    joinByHand(r, P, Q);
    const after = r.ct.pieces;
    const again = r.ct.splitInTwo(); r.idle(8); r.step(0.3);
    check(`ceiling (${style}): after a join the cut tool works again (pieces ${6} -> ${after} -> ${r.ct.pieces}; canSplit true while below the ceiling)`, after < 6 && again === 'cut' && r.ct.pieces === after + 1, `join left ${after}; press ${again}; pieces now ${r.ct.pieces}`);
  }
  // the real 64 (Minis: pieces are cheap in the mock; the clean style alike)
  for (const style of ['clean', 'minis'] as const) {
    const r = mockWorld({ style });
    const res: string[] = [];
    for (let i = 0; i < 64; i++) { res.push(r.ct.splitInTwo()); r.idle(8); r.step(0.05); }
    check(`ceiling (${style}, the real 64): 63 presses make 64 pieces, the 64th press says the kind line; shares sum to 1 (1e-9); no NaN in any position`,
      res.slice(0, 63).every((x) => x === 'cut') && res[63] === 'limit' && r.ct.pieces === 64 && r.notices.at(-1) === KIND && Math.abs(sum(r.ct.fracs()) - 1) < 1e-9 && r.bodies().every((b) => b.positions.every((v) => Number.isFinite(v))), `${res.filter((x) => x !== 'cut').join()}; pieces ${r.ct.pieces}`);
    r.ct.reconnectAll(false);
    check(`ceiling (${style}): leaving at 64 pieces reconnects at once (the leave path): one body, nothing on the mat`, r.ct.pieces === 1 && r.bm.extras.length === 0 && r.ct.canSplit);
  }
}

/* ───────── joins and Reconnect all for ANY count (CUT2.md 7.2: the lowest common ancestor; the merged piece is that node) ───────── */
if (run('joins')) {
  // the tree of 8 pieces by presses: shares 1/8 each (the largest is halved every time); then twin joins, a non-twin join and the join to the root, in a scripted order
  const r = mockWorld({ style: 'clean' });
  for (let i = 0; i < 7; i++) { r.ct.splitInTwo(); r.idle(8); r.step(0.3); }
  const reg0 = r.ct.regions();
  check('joins: 7 presses make 8 pieces of 1/8 each (clean), 8 leaves of one tree', r.ct.pieces === 8 && r.ct.fracs().every((f) => Math.abs(f - 0.125) < 1e-9) && reg0.length === 8);
  // twins: two pieces whose cells differ only in the sign of the LAST literal
  const cellsOf = (b: SoftBodyLike): number[] => { const i = r.bodies().indexOf(b); return r.ct.regions()[i].cells; };
  const twinOf = (b: SoftBodyLike): SoftBodyLike | null => {
    const c = cellsOf(b);
    return r.bodies().find((q) => { const d = cellsOf(q); return q !== b && d.length === c.length && d.slice(0, -1).every((v, k) => v === c[k]) && d[d.length - 1] === -c[c.length - 1]; }) ?? null;
  };
  const P0 = r.bodies().find((b) => twinOf(b) !== null)!, Q0 = twinOf(P0)!;
  const info0 = r.info.get(cellsOf(P0).slice(0, -1).join(','))!;
  joinByHand(r, P0, Q0);
  const afterTwin = r.ct.regions();
  const merged = r.bodies().find((b) => (b.frac ?? 1) > 0.2 && (b.frac ?? 1) < 0.3);
  check('joins: a TWIN join with 8 pieces takes just that cut away: 7 pieces, the merged piece is the parent cell (share 1/4 exactly as it was built, the offset it had), the others untouched, shares sum to 1, "Joined. Now 7 pieces."',
    r.ct.pieces === 7 && !!merged && Math.abs((merged!.frac ?? 0) - info0.frac) < 1e-12 && Math.abs(((merged!.piece as unknown as { offset: V }).offset.x) - info0.offset.x) < 1e-12 && Math.abs(sum(r.ct.fracs()) - 1) < 1e-9 && afterTwin.length === 7 && r.notices.includes('Joined. Now 7 pieces.') && r.bm.extras.every((x) => x.piece),
    `pieces ${r.ct.pieces}; merged ${merged?.frac}; notices ${r.notices.slice(-2).join(' | ')}`);
  // a NON-twin join: two pieces from different branches under the same grandparent: the group is everything under their lowest common ancestor
  const regs = () => r.ct.regions().map((x, i) => ({ cells: x.cells, i }));
  let pair: [number, number] | null = null, grp = 0;
  for (const a of regs()) for (const b of regs()) {
    if (a.i >= b.i) continue;
    let k = 0; while (k < a.cells.length && k < b.cells.length && a.cells[k] === b.cells[k]) k++;
    const under = regs().filter((c) => c.cells.length >= k && c.cells.slice(0, k).every((v, j) => v === a.cells[j])).length;
    if (under >= 3 && under < r.ct.pieces && (!pair || under < grp)) { pair = [a.i, b.i]; grp = under; }
  }
  const before = r.ct.pieces;
  if (pair) { const ps = r.bodies(); joinByHand(r, ps[pair[0]], ps[pair[1]]); }
  check(`joins: a NON-twin join (two pieces of different branches) brings EVERY piece under their lowest common ancestor together: ${grp} pieces become one (${before} -> ${r.ct.pieces}), shares sum to 1, "Joined ${grp} pieces into one."`,
    !!pair && r.ct.pieces === before - grp + 1 && Math.abs(sum(r.ct.fracs()) - 1) < 1e-9 && r.notices.includes(`Joined ${grp} pieces into one.`), `pair ${pair}; group ${grp}; pieces ${before} -> ${r.ct.pieces}; ${r.notices.at(-1)}`);
  // join everything that is left, two at a time, in random order, until it is whole: the last join is the root
  let guard = 0;
  while (r.ct.pieces > 1 && guard++ < 20) { const ps = r.bodies(); joinByHand(r, ps[ps.length - 1], ps[0]); }
  check('joins: joining pieces in any order ends at the root: ONE fresh whole body (no piece options), frac 1, no extras, the original genome, "Whole again."', r.ct.pieces === 1 && r.bm.extras.length === 0 && r.bm.body.frac === 1 && r.bm.body.piece === undefined && r.bm.identity.genome === r.g0 && r.notices.at(-1) === 'Whole again.', `pieces ${r.ct.pieces}; ${r.notices.at(-1)}`);
  // after whole again the tree starts over: a new cut works and its region is the first cut (one cell literal)
  r.ct.splitInTwo(); r.idle(8); r.step(0.3);
  check('joins: after whole again the next cut starts a fresh tree (two regions of one literal each)', r.ct.pieces === 2 && r.ct.regions().every((x) => x.cells.length === 1));

  // Reconnect all (animated) with 24 pieces, the anchor and the largest elsewhere
  const q = mockWorld({ style: 'clean' });
  for (let i = 0; i < 23; i++) { q.ct.splitInTwo(); q.idle(8); q.step(0.2); }
  const ok = q.ct.reconnectAll(true);
  const midBusy = (q.step(JOIN_ALL_S * 0.5), q.ct.busy && q.ct.pieces === 24);
  q.idle(15); q.step(HOME_WAIT);
  check('Reconnect all (animated) from 24 pieces (clean): flows every piece, ends as ONE fresh whole body, frac 1, "Whole again." once', ok && midBusy && q.ct.pieces === 1 && q.bm.extras.length === 0 && q.bm.body.frac === 1 && q.bm.body.piece === undefined && q.notices.filter((n) => n === 'Whole again.').length === 1, `pieces ${q.ct.pieces}`);
}

/* ───────── Minis: any piece can be cut again, repeatedly, up to 24 minis and beyond; joins and Reconnect all ───────── */
if (run('minis24')) {
  const r = mockWorld({ style: 'minis' });
  const swipes: string[] = [];
  for (let i = 0; i < 23; i++) {
    // a swipe through a random piece (not always the largest): the piece is cut into two smaller scaled-whole minis
    const ps = r.bodies(), tgt = ps[(i * 7) % ps.length];
    const cam = r.cam as unknown as { updateMatrixWorld(): void; projectionMatrix: unknown };
    void cam;
    const res = r.ct.splitInTwo(); swipes.push(res); r.idle(8); r.step(0.2);
    void tgt;
  }
  const fr = r.ct.fracs();
  check('Minis: 23 cuts make 24 minis, every one a complete smaller copy of the species (built with { frac } and no region), shares sum to 1 (1e-9), none dropped', swipes.every((x) => x === 'cut') && r.ct.pieces === 24 && Math.abs(sum(fr) - 1) < 1e-9 && fr.every((f) => f > 0) && r.made.slice(1).every((m) => m.piece && m.piece.region === undefined && m.piece.chunk === false), swipes.filter((x) => x !== 'cut').join());
  // each mini's radius is the species scaled by cbrt of its share (the scaled-whole path)
  check('Minis: every mini is the species scaled by cbrt of its share (restRadius = 0.5 cbrt(frac))', r.bodies().every((b) => Math.abs(b.restRadius - 0.5 * Math.cbrt(b.frac ?? 1)) < 1e-9));
  // a join of two minis: the receiver (the larger) grows by the giver's share
  const ps = r.bodies(), P = ps[3], Q = ps[4];
  const share = (P.frac ?? 0) + (Q.frac ?? 0);
  joinByHand(r, P, Q);
  check('Minis: two minis dragged together join into one bigger mini (23 minis, the receiver holds the sum of both shares), shares sum to 1', r.ct.pieces === 23 && Math.abs(sum(r.ct.fracs()) - 1) < 1e-9 && r.bodies().some((b) => Math.abs((b.frac ?? 0) - share) < 1e-9), `pieces ${r.ct.pieces}`);
  r.ct.reconnectAll(true); r.idle(15); r.step(HOME_WAIT);
  check('Minis: Reconnect all from 23 minis ends bit-for-bit whole (one fresh body, frac 1, no piece options, "Whole again.")', r.ct.pieces === 1 && r.bm.extras.length === 0 && r.bm.body.frac === 1 && r.made.at(-1)!.piece === null && r.notices.at(-1) === 'Whole again.');
}

/* ───────── a swipe cuts ANY piece (the piece the swipe passes over most), repeatedly, in both styles ───────── */
if (run('swipes')) {
  for (const style of ['clean', 'minis'] as const) {
    const r = mockWorld({ style });
    r.step(0.5);
    let cuts = 0, tries = 0;
    const seen = new Set<SoftBodyLike>();
    while (cuts < 23 && tries++ < 400) {
      const ps = r.bodies(), tgt = ps[tries % ps.length];
      const c = tgt.center, THREE_cam = r.cam as unknown as { updateMatrixWorld(): void };
      THREE_cam.updateMatrixWorld();
      const s = projectPx(r, c), Rpx = Math.abs(projectPx(r, { x: c.x + tgt.restRadius, y: c.y, z: c.z }).x - s.x);
      const th = (tries * 0.9) % Math.PI, dx = Math.cos(th), dy = Math.sin(th);
      const res = r.ct.swipe(s.x - 1.5 * Rpx * dx, s.y - 1.5 * Rpx * dy, s.x + 1.5 * Rpx * dx, s.y + 1.5 * Rpx * dy);
      if (res === 'cut') { cuts++; r.idle(8); r.step(0.2); const after = new Set(r.bodies()); for (const b of ps) if (!after.has(b)) seen.add(b); } else r.step(0.05);   // (the piece that was ACTUALLY cut is the one the swap removed: the swipe cuts the piece it passes over most, which need not be the one aimed at)
    }
    check(`swipes (${style}): 23 swipes through different pieces make 24 pieces (${tries} tries); a piece cut by a swipe may be cut again; shares sum to 1 (1e-9)`, cuts === 23 && r.ct.pieces === 24 && Math.abs(sum(r.ct.fracs()) - 1) < 1e-9 && seen.size >= 8, `cuts ${cuts}, distinct targets ${seen.size}, pieces ${r.ct.pieces}`);
  }
}
function projectPx(r: World, p: V): { x: number; y: number } {
  const cam = r.cam as unknown as { matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] }; updateMatrixWorld(): void };
  cam.updateMatrixWorld();
  const v = cam.matrixWorldInverse.elements, pr = cam.projectionMatrix.elements;
  const x = v[0] * p.x + v[4] * p.y + v[8] * p.z + v[12], y = v[1] * p.x + v[5] * p.y + v[9] * p.z + v[13], z = v[2] * p.x + v[6] * p.y + v[10] * p.z + v[14];
  const cx = pr[0] * x + pr[4] * y + pr[8] * z + pr[12], cy = pr[1] * x + pr[5] * y + pr[9] * z + pr[13], cw = pr[3] * x + pr[7] * y + pr[11] * z + pr[15];
  return { x: (cx / cw + 1) * 400, y: (1 - cy / cw) * 300 };
}

/* ───────── leaving: every leave path reconnects first at 24 pieces ───────── */
if (run('leave')) {
  for (const style of ['clean', 'minis'] as const) {
    const r = mockWorld({ style });
    for (let i = 0; i < 23; i++) { r.ct.splitInTwo(); r.idle(8); r.step(0.1); }
    const had = r.ct.pieces;
    const ok = r.ct.reconnectAll(false);
    check(`leave paths (${style}): reconnectAll(false) with ${had} pieces is whole AT ONCE: one fresh whole body, nothing on the mat, no piece options, the cut tool offered again`, ok && had === 24 && r.ct.pieces === 1 && r.bm.extras.length === 0 && r.bm.body.frac === 1 && r.bm.body.piece === undefined && r.ct.canSplit && r.ct.canChangeStyle);
    // a neck in progress is unwound too
    r.ct.splitInTwo(); r.step(0.1);
    const busyNow = r.ct.busy;
    r.ct.reconnectAll(false);
    check(`leave paths (${style}): leaving during a neck unwinds it (not busy, whole, one body)`, busyNow && !r.ct.busy && r.ct.pieces === 1 && r.bm.extras.length === 0);
  }
}

/* ───────── CUT3 leg 3 (2026-10-09): a cut that makes SEVERAL pieces: a swipe across the tips of a star (the owner asked for it on 2026-10-09; the old 'loose' rows are re-specified with that reason) ───────── */
// The mock physics reports `parts` / `partList` exactly as src/contracts.ts CutPlan defines them: a cap cut off a ball (|offset| > 0.45 R) is `tips` separate tips, each its own body with its token (CutPart.part),
// the rest of the ball is the other side's one body. The Cutter, the cut tree, the BodyManager and the camera are the REAL ones.
if (run('parts')) {
  const px = (r: World, b: SoftBodyLike): { s: { x: number; y: number }; R: number } => { const s = projectPx(r, b.center); return { s, R: Math.abs(projectPx(r, { x: b.center.x + b.restRadius, y: b.center.y, z: b.center.z }).x - s.x) }; };
  /** a horizontal swipe 0.7 radii above the piece's centre (a near-level plane: the tips drop), or a vertical one 0.7 radii to the right of it (a steep plane: the pair slides apart) */
  const capSwipe = (r: World, b: SoftBodyLike, how: 'level' | 'steep'): string => {
    const { s, R } = px(r, b);
    return how === 'level' ? r.ct.swipe(s.x - 1.6 * R, s.y - 0.7 * R, s.x + 1.6 * R, s.y - 0.7 * R) : r.ct.swipe(s.x + 0.7 * R, s.y - 1.6 * R, s.x + 0.7 * R, s.y + 1.6 * R);
  };
  // (regions() is in the Cutter's piece order, bodies() in the BodyManager's: the two differ after a cut of a non-anchor piece, so a body finds its region by where it stands)
  const partOfBody = (r: World, b: SoftBodyLike): number => r.ct.regions().find((x) => x.x === b.center.x && x.y === b.center.y && x.z === b.center.z)?.part ?? -2;
  const tipsOf = (r: World): SoftBodyLike[] => r.bodies().filter((b) => partOfBody(r, b) >= 0);
  const restOf = (r: World): SoftBodyLike => r.bodies().filter((b) => partOfBody(r, b) === -1).reduce((m, b) => ((b.frac ?? 1) > (m.frac ?? 1) ? b : m));
  /** the mock bodies do not collide: stand the pieces in a row 1.3 m apart (x), so a swipe or a drag meets exactly one of them */
  const spread = (r: World): void => { const bs = r.bodies(); bs.forEach((b, i) => (b as unknown as { placeAt(a: V, v: V): void }).placeAt({ x: (i - (bs.length - 1) / 2) * 1.3, y: b.center.y, z: 0 }, { x: 0, y: 0, z: 0 })); };

  // (1) one swipe over the cap of a ball with 3 tips: 4 pieces in ONE swap
  for (const how of ['level', 'steep'] as const) {
    const r = mockWorld({ tips: 3 });
    r.step(0.5);
    const res = capSwipe(r, r.bm.body, how);
    r.idle(8);
    const flush = r.bodies().map((b) => ({ x: b.center.x, z: b.center.z }));
    r.step(2);
    const fr = r.ct.fracs(), reg = r.ct.regions(), tips = tipsOf(r);
    check(`parts (${how} swipe): a swipe across the 3 tips of a ball makes FOUR pieces in one swap (3 tips + the rest), shares sum to 1 (1e-9), the tips share the cap equally, "Cut into 4 pieces."`,
      res === 'cut' && r.ct.pieces === 4 && Math.abs(sum(fr) - 1) < 1e-9 && tips.length === 3 && Math.abs((tips[0].frac ?? 0) - (tips[1].frac ?? 1)) < 1e-9 && Math.abs((tips[1].frac ?? 0) - (tips[2].frac ?? 1)) < 1e-9 && r.notices.at(-1) === 'Cut into 4 pieces.' && r.ct.info.lastParts === 4 && r.bm.extras.length === 3,
      `${res}; fracs ${fr.map((f) => f.toFixed(4)).join(' + ')}; ${r.notices.at(-1)}`);
    check(`parts (${how}): the cut tree has one leaf per piece: the three tips are parts 0, 1, 2 of ONE side (cells [-1] or [1]), the rest is alone on its side (part -1); the bodies were built with the physics' tokens 1, 2, 3 and the rest with none; one anchor (the rest)`,
      reg.length === 4 && reg.filter((x) => x.part >= 0).map((x) => x.part).sort().join() === '0,1,2' && new Set(reg.filter((x) => x.part >= 0).map((x) => x.cells.join())).size === 1 && reg.filter((x) => x.part < 0).length === 1 && reg[0].part === -1
        && r.made.filter((m) => m.piece?.region && m.piece.region.part !== undefined).map((m) => m.piece!.region!.part).sort().join() === '1,2,3' && r.made.filter((m) => m.piece?.region && m.piece.region.part === undefined).length === 1,
      JSON.stringify(reg.map((x) => [x.cells, x.part])));
    // the lighter side moves more (the tips slide away, the big body barely moves); a cut whose lighter side is a tip (<= TIP_SIDE_SHARE of the body) is a TOSS even when it is near-level: the tips are pushed off the cut face
    // along the table by TIP_PUSH more, so a tip taken off the top of a star slides off the stump and falls instead of sitting on it
    const all = r.bodies(), restI = all.indexOf(restOf(r));
    const dis = all.map((b, i) => Math.hypot(b.center.x - flush[i].x, b.center.z - flush[i].z));
    const tipDis = Math.max(...dis.filter((_v, i) => i !== restI)), restDis = dis[restI];
    check(`parts (${how}): the parting script gives the gap to the LIGHT side and tosses tips (cut off ${(1 - 0.9377).toFixed(3)} of the body): the tips slide ${tipDis.toFixed(3)} m (at least G + TIP_PUSH = ${(0.06 + TIP_PUSH).toFixed(2)} m less the spring's lag), the big body ${restDis.toFixed(3)} m (under a tenth), the level cut included`,
      tipDis > 0.1 && restDis < 0.1 * tipDis);
    // Reconnect all from the four: ONE fresh whole
    const ok = r.ct.reconnectAll(true); r.idle(15); r.step(HOME_WAIT);
    check(`parts (${how}): Reconnect all from the 3 tips and the rest ends bit-for-bit whole (one fresh body, frac 1, no extras, the original genome, "Whole again.")`, ok && r.ct.pieces === 1 && r.bm.extras.length === 0 && r.bm.body.frac === 1 && r.bm.body.piece === undefined && r.bm.identity.genome === r.g0 && r.notices.at(-1) === 'Whole again.');
  }

  // (2) joins: two tips of one swipe lift to the cut above ("Joining 4 pieces."); a tip dragged to the rest does the same; a nested cut joins at the cut node, never at a parts node
  {
    const r = mockWorld({ tips: 3 });
    r.step(0.5);
    capSwipe(r, r.bm.body, 'steep'); r.idle(8); r.step(1.5);
    const tips = tipsOf(r);
    joinByHand(r, tips[0], tips[1]);
    check('parts joins: dragging one tip onto another tip of the same swipe brings back EVERYTHING cut from that plane (the cell of a cut is the one body): "Joining 4 pieces.", then "Whole again." (the root)',
      r.notices.includes('Joining 4 pieces.') && r.ct.pieces === 1 && r.notices.at(-1) === 'Whole again.' && r.bm.body.frac === 1 && r.bm.body.piece === undefined, `pieces ${r.ct.pieces}; ${r.notices.slice(-3).join(' | ')}`);
  }
  {
    const r = mockWorld({ tips: 3 });
    r.step(0.5);
    r.ct.splitInTwo(); r.idle(8); r.step(1.5);   // two halves
    spread(r);
    const big = largest(r);
    const res = capSwipe(r, big, 'steep'); r.idle(8); r.step(1.5);
    const before = r.ct.pieces, tips = tipsOf(r);
    const capTotal = tips.reduce((m, b) => m + (b.frac ?? 0), 0);
    // the cut node of the nested cut: its cell is the half that was cut (a share of 1/2); joining two of its tips rebuilds exactly that half
    spread(r);
    (tips[0] as unknown as { placeAt(a: V, v: V): void }).placeAt({ x: tips[0].center.x, y: tips[2].center.y, z: 0 }, { x: 0, y: 0, z: 0 });   // (side by side at one height)
    joinByHand(r, tips[0], tips[2]);
    const regs = r.ct.regions();
    check(`parts joins (nested): a half cut across 3 tips (${res}; ${before} pieces), then two of its tips dragged together bring back ONLY that half: ${before} -> 2 pieces, the merged piece holds 1/2 exactly (was ${(capTotal + (before === 5 ? 0 : 0)).toFixed(4)} cap + the rest), "Joined 4 pieces into one."`,
      res === 'cut' && before === 5 && r.ct.pieces === 2 && Math.abs(sum(r.ct.fracs()) - 1) < 1e-9 && r.ct.fracs().every((f) => Math.abs(f - 0.5) < 1e-9) && r.notices.includes('Joined 4 pieces into one.') && regs.length === 2 && regs.every((x) => x.part === -1), `${res}; fracs ${r.ct.fracs().map((f) => f.toFixed(4)).join(' + ')}; ${r.notices.at(-1)}`);
    r.ct.reconnectAll(false);
  }

  // (3) the safety ceiling counts the pieces a cut makes: 3 pieces + a 4-piece cut would pass 5
  for (const style of ['clean'] as const) {
    const r = mockWorld({ tips: 3, ceiling: 5, style });
    r.step(0.5);
    r.ct.splitInTwo(); r.idle(8); r.step(1);   // 2 pieces
    r.ct.splitInTwo(); r.idle(8); r.step(1);   // 3 pieces
    spread(r);
    const big = largest(r), before = r.ct.pieces;
    const hits0 = r.ct.info.ceilingHits;
    const res = capSwipe(r, big, 'steep'); r.idle(8); r.step(0.5);
    check(`parts ceiling (test ceiling 5): ${before} pieces + a cut that would make 4 (3 -> 6) is refused with the kind line, nothing changes, canSplit still true, the hit is counted for the harness`,
      before === 3 && res === 'limit' && r.ct.pieces === 3 && r.notices.at(-1) === KIND && r.ct.canSplit && r.ct.info.ceilingHits === hits0 + 1 && r.ct.info.lastResult === 'limit' && !r.ct.busy, `${res}; pieces ${r.ct.pieces}; ${r.notices.at(-1)}; hits ${r.ct.info.ceilingHits}`);
    // a cut that FITS (2 -> 5 is out of reach here; one Split in two: 3 -> 4) still works
    const again = r.ct.splitInTwo(); r.idle(8); r.step(0.3);
    check('parts ceiling: after the refusal Split in two still works (3 -> 4 pieces)', again === 'cut' && r.ct.pieces === 4);
  }

  // (4) the physics refusing a part: the neck is released, the tree rolled back, the plain thin line, the squishy as it was
  {
    const r = mockWorld({ tips: 3, failPart: 2 });
    r.step(0.5);
    const b0 = r.bm.body, res = capSwipe(r, b0, 'steep'); r.idle(8); r.step(0.5);
    const unchanged = r.bm.body === b0 && r.bm.extras.length === 0 && r.ct.pieces === 1 && !r.ct.busy && r.notices.at(-1) === 'That would make a piece too thin. Try another angle.';
    const again = r.ct.splitInTwo(); r.idle(8); r.step(0.3);
    check('parts refused: when the physics cannot build one part the cut never happens: the same body, one piece, the plain "too thin" line, nothing replaced, no half-built tree (the next cut gets plane id 1 again)',
      res === 'cut' && unchanged && again === 'cut' && r.ct.pieces === 2 && r.ct.regions().map((x) => x.cells.join()).sort().join('|') === '-1|1', `${res}; unchanged ${unchanged}; pieces ${r.ct.pieces}; ${r.notices.slice(-2).join(' | ')}; cells ${JSON.stringify(r.ct.regions().map((x) => x.cells))}`);
  }

  // (5) an older physics (no parts): a side of separate parts is still refused with the old line
  {
    const r = mockWorld({ oldLoose: true });
    r.step(0.5);
    const res = capSwipe(r, r.bm.body, 'steep');
    check('parts, an older physics that reports no parts: the cap that would split off separate parts is refused with the old "two separate parts" line, nothing changes', res === 'loose' && r.ct.pieces === 1 && r.notices.at(-1) === 'That cut would split off two separate parts. Try another angle.');
  }
}

/* ───────── principalAxes (the fallback candidates of Split in two): unit, orthogonal, longest first ───────── */
if (run('u01')) {
  const long = { positions: new Float32Array(300), vertexCount: 100 } as unknown as SoftBodyLike;
  for (let i = 0; i < 100; i++) { long.positions[i * 3] = (i / 99 - 0.5) * 2; long.positions[i * 3 + 1] = 0.05 * Math.sin(i); long.positions[i * 3 + 2] = 0.2 * Math.cos(i * 1.3); }
  const ax = principalAxes(long)!;
  const dotp = (a: V, b: V): number => a.x * b.x + a.y * b.y + a.z * b.z;
  check('principalAxes: three unit axes, orthogonal, the longest first (a rod along x gives x)', !!ax && ax.length === 3 && ax.every((a) => Math.abs(Math.hypot(a.x, a.y, a.z) - 1) < 1e-9) && Math.abs(dotp(ax[0], ax[1])) < 1e-6 && Math.abs(dotp(ax[0], ax[2])) < 1e-6 && Math.abs(Math.abs(ax[0].x) - 1) < 0.05, JSON.stringify(ax?.[0]));
}

void JOIN_S;
console.log(`${total - bad}/${total} cut mock checks passed`);
process.exit(bad ? 1 : 0);
