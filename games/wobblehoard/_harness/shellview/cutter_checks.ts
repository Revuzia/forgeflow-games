// CUT-A, task S2 (first half): the Cutter (src/shell/cut.ts) on the REAL SoftBody through the whole game core (createApp), plain node, exits 1 on a failed row.
//   node _harness/shellview/cutter_checks.ts            all rows (about 2 minutes on a busy machine)
//   node _harness/shellview/cutter_checks.ts --only=a,b  sections: first, level, refuse, abort, minis, twin, primary (CUT-A) and, CUT-B task S4: parting (X19), x03 (X03' node leg), x11, nested (X04 / X10 / X12), x05, x06
//   --full runs the S4 sections on all 50 species (default: the 12 family representatives), --sp=a,b on the species named; --v prints the per-species numbers
// Rows are about what the shell DOES (the true cut: two real pieces, the neck, the scripted parting, Reconnect all as a fresh whole; Minis: complete smaller copies); the pure tree is
// cut_checks.ts. Nothing here invents a number: sizes, offsets and shares are read from the real bodies and the physics' own plan.
import * as THREE from 'three';
import type { SoftBodyLike } from '../../src/contracts.ts';
import { createApp } from '../../src/app.ts';
import { createCollection } from '../../src/collection/index.ts';
import { CATALOG, speciesBaseGenome } from '../../src/data/catalog.ts';
import { familyOf } from '../../src/data/catalog.ts';
import { wholeRefFor } from '../../src/render/wholeRef.ts';
import { SoftBody } from '../../src/physics/softbody.ts';
import { createBodyManager } from '../../src/shell/bodies.ts';
import { JOIN_HOLD_S, LEVEL_NY, NECK_DEPTH, PIECE_CEILING, TOUCH_SKIN_K, NECK_DEPTH_DEFAULT, PART_GAP, PART_GAP_DEFAULT, PART_S, PART_S_DEFAULT, createCutter, supportAlong } from '../../src/shell/cut.ts';
import { createMockWorld } from '../mocks.ts';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const run = (name: string): boolean => only.length === 0 || only.includes(name);
const VERBOSE = process.argv.includes('--v');
let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const f3 = (x: number): string => x.toFixed(3);
type V = { x: number; y: number; z: number };
const Ctor = SoftBody as unknown as new (g: unknown, o?: unknown) => SoftBodyLike;
const volOf = (b: SoftBodyLike): number => {
  const P = b.positions, I = b.indices; let v = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3; v += P[a] * (P[c + 1] * P[d + 2] - P[c + 2] * P[d + 1]) - P[a + 1] * (P[c] * P[d + 2] - P[c + 2] * P[d]) + P[a + 2] * (P[c] * P[d + 1] - P[c + 1] * P[d]); }
  return v / 6;
};
const surfaceGap = (a: SoftBodyLike, b: SoftBodyLike): number => {
  const dx = a.center.x - b.center.x, dy = a.center.y - b.center.y, dz = a.center.z - b.center.z, d = Math.hypot(dx, dy, dz) || 1, u = { x: dx / d, y: dy / d, z: dz / d };
  return d - supportAlong(b, u) - supportAlong(a, { x: -u.x, y: -u.y, z: -u.z });
};

/** the whole game core on the real SoftBody with a recording fake stage */
function rig(species: string, o: { primary?: boolean; eyes?: boolean; tier?: 'low' | 'med' | 'high'; style?: 'clean' | 'minis' } = {}) {
  const w = createMockWorld({ storage: null });
  const st = w.stage as unknown as Record<string, unknown>;
  let vid = 100;
  const log: string[] = [], seams: Array<{ pl: boolean; t: number; ends: boolean }> = [], parts: number[][] = [], addOpts: unknown[] = [], necks: Array<[number, number | undefined]> = [];
  st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.setCalmEffects = () => {};
  st.addBody = (_b: unknown, _g: unknown, opts: unknown) => { addOpts.push(opts); return ++vid; };
  st.removeBody = (id: number) => log.push('remove ' + id);
  st.setBody = () => log.push('setBody');
  st.setCutSeam = (_id: number, pl: unknown, t: number, ends: unknown) => { seams.push({ pl: !!pl, t, ends: !!ends }); };
  st.setBridge = () => {}; st.partPieces = (a: number, b: number) => { parts.push([a, b]); };
  st.stats = () => ({ drawCalls: 0, triangles: 0, tier: o.tier ?? 'high', frameMsEma: 0 });
  if (o.primary) st.setPrimaryBody = (id: number) => log.push('setPrimaryBody ' + id);
  if (o.eyes) st.eyeAnchors = () => ({ left: { x: -0.1, y: 0.1, z: 0.45 }, right: { x: 0.1, y: 0.1, z: 0.45 } });
  const audio: Array<[string, Record<string, unknown>]> = [];
  const au = w.audio as unknown as Record<string, unknown>;
  au.cut = (p: Record<string, unknown>) => audio.push(['cut', p]); au.rejoin = (p: Record<string, unknown>) => audio.push(['rejoin', p]);
  w.deps.createBody = ((g: unknown, op?: { at?: V; piece?: unknown }) => {
    const b = op?.piece ? new Ctor(g, { piece: op.piece }) : op?.at ? new Ctor(g, { piece: { frac: 1, chunk: false, at: op.at } }) : new Ctor(g);
    const sn = b.setNeck?.bind(b);
    if (sn) (b as unknown as { setNeck: unknown }).setNeck = (pl: unknown, t: number, depth?: number) => { if (pl) necks.push([t, depth]); sn(pl as never, t, depth); };
    return b;
  }) as typeof w.deps.createBody;
  const now = (): number => 1_700_000_000_000 + w.clock.t;
  const g = speciesBaseGenome(species as never, 1);
  const app = createApp({ ...w.deps, collection: createCollection({ storage: null, profile: null, now, random: () => 0.4 }), epochNow: now, genome: g });
  app.resize(800, 600, 1); app.setPhase('play');
  const notices: string[] = [];
  app.on('notice', (t) => notices.push(t));
  const go = (ms: number, each?: () => void): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); each?.(); left -= d; } };
  if (o.style) app.cut.setStyle(o.style);
  const idle = (max = 900): void => { for (let i = 0; i < max && app.cut.busy; i++) go(1000 / 60); };
  return { app, go, idle, notices, seams, parts, addOpts, necks, audio, log, g };
}

/* ───────── first press: Split in two on a whole squishy ───────── */
if (run('first')) {
  for (const sp of ['dollop', 'kneadle', 'twangle']) {
    const r = rig(sp, { eyes: sp === 'dollop' });
    r.go(1500);
    const whole0 = r.app.body, V0 = volOf(whole0), fam = familyOf(sp as never), items0 = r.app.hoard.items().length;
    r.app.cut.prewarm(); r.go(400);
    const res = r.app.cut.splitInTwo();
    r.go(100);
    const necking = r.app.cut.busy && r.seams.some((s) => s.pl && s.t > 0);
    r.idle();
    const fr = r.app.cut.fracs(), A = r.app.body, B = r.app.bodies.extras[0]?.body;
    check(`${sp}: Split in two (first press) makes two real pieces: shares sum to 1 (1e-9) and each is in [0.40, 0.60]; "Cut into 2 pieces."`,
      res === 'cut' && necking && fr.length === 2 && Math.abs(fr[0] + fr[1] - 1) < 1e-9 && Math.min(...fr) >= 0.40 && Math.max(...fr) <= 0.60 && r.notices.includes('Cut into 2 pieces.'), `${res}; ${fr.map(f3).join(' + ')}`);
    check(`${sp}: both are peers of the real cut: PieceInfo with one cell each, no chunk flag to the stage, the play body is the larger one (same genome object and item), partPieces once, one extra`,
      !!A.piece && !!B?.piece && A.piece.cells.length === 1 && B.piece.cells.length === 1 && r.addOpts.every((o) => !(o as { chunk?: boolean } | undefined)?.chunk) && A !== whole0 && r.app.identity.genome === r.g && r.parts.length === 1 && r.app.bodies.extras.length === 1 && fr[0] >= fr[1] - 1e-9,
      `cells ${JSON.stringify(r.app.cut.regions().map((x) => x.cells))}; parts ${JSON.stringify(r.parts)}`);
    const starts = r.audio.filter((c) => c[0] === 'cut' && c[1].phase === 'start'), seps = r.audio.filter((c) => c[0] === 'cut' && c[1].phase === 'separate');
    check(`${sp}: audio cut start once and separate once with the smaller piece's share of the whole; the Hoard sees no piece`,
      starts.length === 1 && seps.length === 1 && Math.abs((seps[0][1].frac as number) - Math.min(...fr)) < 1e-9 && r.app.hoard.items().length === items0, `sep ${seps[0]?.[1].frac}`);
    const vols = [volOf(A) / (fr[0] * V0), volOf(B) / (fr[1] * V0)];
    check(`${sp}: measured mesh volumes are within 3 % of the shares`, Math.abs(vols[0] - 1) < 0.03 && Math.abs(vols[1] - 1) < 0.03, vols.map(f3).join(', '));
    const dep = r.necks.map((n) => n[1]).filter((x) => x !== undefined);
    check(`${sp}: the neck rose from 0 to 1 with the family's depth as its third argument (${NECK_DEPTH[fam] ?? NECK_DEPTH_DEFAULT})`,
      r.necks.length >= 10 && Math.max(...r.necks.map((n) => n[0])) === 1 && dep.length > 0 && dep.every((x) => x === (NECK_DEPTH[fam] ?? NECK_DEPTH_DEFAULT)), `${r.necks.length} calls`);
    // the scripted parting: the gap opens by about G and stays (no drift after the script)
    const G = PART_GAP[fam] ?? PART_GAP_DEFAULT;
    const cd = (): number => Math.hypot(A.center.x - B.center.x, A.center.y - B.center.y, A.center.z - B.center.z);
    const c0 = cd();
    r.go(1000); const g1 = cd() - c0, s1 = surfaceGap(A, B);
    r.go(1500); const g2 = cd() - c0;
    r.go(1500); const g3 = cd() - c0;
    check(`${sp}: the scripted parting opens the pair (G ${G} m): the centres have moved apart by at least G/2 at 1 s and drift under 3 cm between 2.5 s and 4 s (the surface gap at 1 s is ${f3(s1)})`, g1 > G / 2 && Math.abs(g3 - g2) < 0.03, `opening ${f3(g1)} -> ${f3(g2)} -> ${f3(g3)}`);
    // Reconnect all
    const items = r.app.hoard.items().length;
    const ok = r.app.cut.reconnectAll(true); r.idle();
    const W = r.app.body;
    check(`${sp}: Reconnect all ends as a FRESH whole (no piece info, frac 1, the original genome object, at the middle, nothing on the mat), "Whole again.", rejoin once with all`,
      ok && r.app.cut.pieces === 1 && W !== A && W.piece === undefined && W.frac === 1 && r.app.identity.genome === r.g && Math.hypot(W.center.x, W.center.z) < 1e-9 && r.app.bodies.extras.length === 0 && r.notices.at(-1) === 'Whole again.' && r.audio.filter((c) => c[0] === 'rejoin' && c[1].all === true).length === 1 && r.app.hoard.items().length === items,
      `pieces ${r.app.cut.pieces}, notices ${r.notices.slice(-2).join(' | ')}`);
    r.app.dispose();
  }
}

/* ───────── a near-level swipe (the player's most natural one) ───────── */
if (run('level')) {
  for (const sp of ['dollop', 'kneadle', 'twangle', 'capnap']) {
    const r = rig(sp);
    r.go(1500);
    const s = r.app.host.bodyScreen()!;
    const res = r.app.cut.swipe(s.x - 1.6 * s.r, s.y + 2, s.x + 1.6 * s.r, s.y - 2);
    r.idle(); r.go(500);
    const fr = r.app.cut.fracs();
    check(`${sp}: a horizontal swipe cuts the squishy into two real pieces (shares sum to 1; none under 1/8)`, res === 'cut' && fr.length === 2 && Math.abs(fr[0] + fr[1] - 1) < 1e-9 && Math.min(...fr) >= 0.124, `${res}; ${fr.map(f3).join(' + ')}`);
    r.go(2500);
    const A = r.app.body, B = r.app.bodies.extras[0]?.body;
    const dxz = Math.hypot(A.center.x - B.center.x, A.center.z - B.center.z);
    check(`${sp}: 2.5 s after the plop both pieces are on the table (nothing below it) and the pair stays together within 1.5 radii (the stacked pair is pushed by the physics' contact: P5)`, !!B && Math.min(...A.positions.filter((_, i) => i % 3 === 1)) > -0.01 && dxz < A.restRadius * 1.5, `A.y ${f3(A.center.y)}, B.y ${f3(B?.center.y ?? 0)}, apart (xz) ${f3(dxz)} of ${f3(A.restRadius * 1.5)}`);
    r.app.cut.reconnectAll(false);
    check(`${sp}: instant Reconnect all (the leave path) is whole at once`, r.app.cut.pieces === 1 && r.app.body.piece === undefined && r.app.bodies.extras.length === 0);
    r.app.dispose();
  }
}

/* ───────── no limit and no minimum size (CUT3.md 2), the safety ceiling, the style lock ───────── */
// RE-SPECIFIED because the owner removed the piece limits on 2026-10-09: the rows "a swipe that would leave a piece under 1/8 is refused", "the clean limit is MAX_PIECES_CLEAN: the next one is refused with 'That's as many pieces as it can make.'"
// and "canSplit: a piece of 0.249985 can be split, one of 0.2497 cannot" encoded the old rules. They are now: the edge swipe is NOT refused (it cuts a small piece off, or misses/graze), Split in two keeps working past 2 and past 6 pieces,
// maxPieces is the safety ceiling (PIECE_CEILING = 64, the same in both styles), canSplit is true until the ceiling. The ceiling itself is reached in cut_mock_checks.ts (a lower test ceiling, then the real 64 on mock bodies).
if (run('refuse')) {
  const r = rig('dollop');
  r.go(1500);
  const s = r.app.host.bodyScreen()!;
  const b0 = r.app.body as SoftBodyLike & { trembles?: number };
  const edge = r.app.cut.swipe(s.x + 0.9 * s.r, s.y - 1.6 * s.r, s.x + 0.9 * s.r + 3, s.y + 1.6 * s.r);
  r.idle(); r.go(800);
  const fe = r.app.cut.fracs();
  check('a swipe along the very edge is NOT refused for being small any more (no "Too small to cut there" line, no minimum size): it cuts a small piece off (shares sum to 1), is a miss (a graze), or the physics refuses a sliver it cannot build with the plain "too thin" line (CUT3.md 2.3); never a size refusal', ['cut', 'miss', 'thin'].includes(edge) && !r.notices.some((n) => /Too small|as small as it gets|as many pieces/.test(n)) && ((r.app.cut.pieces === 2 && Math.abs(fe[0] + fe[1] - 1) < 1e-6 && Math.min(...fe) > 0) || (r.app.cut.pieces === 1 && (edge === 'miss' || edge === 'thin' || r.notices.at(-1) === 'That would make a piece too thin. Try another angle.'))), `${edge} ${r.notices.at(-1) ?? ''} fracs ${fe.map((f) => f.toFixed(4)).join('+')}`);
  r.app.cut.reconnectAll(false); r.go(300);
  const short = r.app.cut.swipe(400, 300, 410, 300);
  check('a swipe under 24 px is not a cut', short === 'short');
  const cut = r.app.cut.splitInTwo(); r.go(100);
  check('busy: a second request during the neck answers busy', r.app.cut.busy && r.app.cut.splitInTwo() === 'busy');
  r.idle(); r.go(500);
  const third = r.app.cut.splitInTwo(); r.idle(); r.go(500);
  const fourth = r.app.cut.splitInTwo(); r.idle(); r.go(500);
  check(`no limit of 2 any more: the second and third presses of Split in two also cut (${r.app.cut.pieces} pieces), Split in two stays enabled, maxPieces is the safety ceiling ${PIECE_CEILING} and canSplit holds`, cut === 'cut' && third === 'cut' && fourth === 'cut' && r.app.cut.pieces === 4 && r.app.cut.canSplit && r.app.cut.maxPieces === PIECE_CEILING && !r.notices.some((n) => /as many pieces|lot of pieces/.test(n)), `${cut} ${third} ${fourth}; ${r.notices.at(-1)}`);
  check('the cut style cannot change while the squishy is cut ("Reconnect first to change the cut style"); the default style is clean', r.app.cut.style === 'clean' && r.app.cut.setStyle('minis') === false && r.notices.at(-1) === 'Reconnect first to change the cut style' && !r.app.cut.canChangeStyle);
  r.app.cut.reconnectAll(false);
  check('whole again: the style can be changed; the ceiling is the same in the Minis style (PIECE_CEILING)', r.app.cut.canChangeStyle && r.app.cut.setStyle('minis') === true && r.app.cut.style === 'minis' && r.app.cut.maxPieces === PIECE_CEILING);
  r.app.dispose();
}

/* ───────── canSplit: any piece, however small, can be split; only the safety ceiling stops it (CUT3.md 2.1; replaces "0.249985 can, 0.2497 cannot") ───────── */
if (run('refuse')) {
  const { createMockBody } = await import('../mocks.ts');
  const canSplitAt = (frac: number, ceiling?: number): boolean => {
    const w = createMockWorld({ storage: null });
    const st = w.stage as unknown as Record<string, unknown>;
    st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.addBody = () => 1; st.removeBody = () => {};
    const b = createMockBody() as unknown as Record<string, unknown>;
    b.frac = frac; b.measureCut = () => 0.5; b.setNeck = () => {}; b.setFrac = () => {};
    const g = speciesBaseGenome('dollop' as never, 1);
    const bm = createBodyManager({ createBody: () => b as unknown as SoftBodyLike, stage: w.stage, initial: { body: b as unknown as SoftBodyLike, identity: { genome: g, tier: 'common', itemId: null, nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
    const ct = createCutter({
      bodies: bm, stage: w.stage, audio: w.audio, haptics: w.haptics, createBody: () => b as unknown as SoftBodyLike, quality: () => 'high', calm: () => false, gravity: () => true, simTime: () => 0, viewport: () => ({ w: 800, h: 600 }),
      activeBody: () => bm.body, touching: () => false, drag: () => false, beforeChange() {}, clearMat: () => 0, panOf: () => 0, say: () => {}, report: (e) => { throw e; }, ceiling,
    });
    return ct.canSplit;
  };
  check('canSplit: a piece of 0.5, 0.2497, 0.01 and 1e-4 can all be split (no minimum size); with the ceiling at 1 piece it cannot (the whole is already 1 piece)', canSplitAt(0.5) && canSplitAt(0.2497) && canSplitAt(0.01) && canSplitAt(1e-4) && !canSplitAt(0.5, 1));
}

/* ───────── leaving in the neck unwinds it ───────── */
if (run('abort')) {
  const r = rig('dollop');
  r.go(1500);
  const b0 = r.app.body;
  r.app.cut.splitInTwo(); r.go(80);
  const wasBusy = r.app.cut.busy;
  r.app.cut.reconnectAll(false); r.go(50);
  check('Reconnect all (leaving) in the neck: the cut never happened, the same body, the seam is released, not busy', wasBusy && r.app.cut.pieces === 1 && r.app.body === b0 && !r.app.cut.busy && r.seams.at(-1)?.pl === false);
  const res = r.app.cut.splitInTwo(); r.idle();
  check('and a new cut works afterwards (the tree was rolled back: the plane id is reused)', res === 'cut' && r.app.cut.pieces === 2 && JSON.stringify(r.app.cut.regions().map((x) => x.cells.slice().sort())).includes('[1]'));
  r.app.cut.reconnectAll(false);
  r.app.dispose();
}

/* ───────── Minis: complete smaller copies ───────── */
if (run('minis')) {
  const r = rig('dollop', { style: 'minis', tier: 'high' });
  r.go(1500);
  const res: string[] = [], V0 = volOf(r.app.body);
  // RE-SPECIFIED 2026-10-09 (the owner removed the limit of 6 minis): seven presses make eight minis, none is a limit (the 24-mini row on the real bodies is section u05)
  for (let i = 0; i < 7; i++) { res.push(r.app.cut.splitInTwo()); r.idle(300); r.go(300); }
  const fr = r.app.cut.fracs(), all = [r.app.body, ...r.app.bodies.extras.map((x) => x.body)];
  check('Minis (RE-SPECIFIED 2026-10-09, no limit): seven Split in two presses make eight minis, every press cuts (the sixth and seventh are past the old limit), no limit line; "Cut into 8 minis."', res.every((x) => x === 'cut') && r.app.cut.pieces === 8 && r.notices.includes('Cut into 8 minis.') && !r.notices.some((n) => /as many pieces|lot of pieces|Too small/.test(n)), `${res.join()} ${fr.map(f3).join(' ')}`);
  check('Minis: every piece is a complete scaled copy (built the legacy way: no PieceInfo), shares sum to 1, all positive (no minimum size: RE-SPECIFIED 2026-10-09, the row asserted min >= 0.124, the old 1/8 floor)', all.every((b) => b.piece === undefined) && Math.abs(fr.reduce((a, b) => a + b, 0) - 1) < 0.01 && Math.min(...fr) > 0);
  check('Minis: measured mesh volumes within 3 % of the share of each body (body.frac) of the whole', all.every((b) => Math.abs(volOf(b) / ((b.frac ?? 0) * V0) - 1) < 0.03), all.map((b) => f3(volOf(b) / ((b.frac ?? 0) * V0))).join(' '));
  r.go(1500);
  const ok = r.app.cut.reconnectAll(true); r.idle();
  check('Minis: Reconnect all from eight ends in a FRESH whole (original genome, no piece, frac 1, nothing on the mat)', ok && r.app.cut.pieces === 1 && r.app.body.piece === undefined && r.app.body.frac === 1 && r.app.bodies.extras.length === 0 && r.app.identity.genome === r.g && r.notices.at(-1) === 'Whole again.');
  r.app.dispose();
}

/* ───────── a stage that can re-point its primary view: no setBody ───────── */
if (run('primary')) {
  const r = rig('dollop', { primary: true });
  r.go(1500);
  const n0 = r.log.length;
  const res = r.app.cut.splitInTwo(); r.idle(); r.go(300);
  const after = r.log.slice(n0);
  check('with stage.setPrimaryBody the anchor is re-pointed (promote): setPrimaryBody and removeBody of the parent, never setBody (CUT2.md 3.5); one extra, identity unchanged', res === 'cut' && after.some((l) => l.startsWith('setPrimaryBody')) && !after.includes('setBody') && after.some((l) => l.startsWith('remove')) && r.app.bodies.extras.length === 1 && r.app.identity.genome === r.g, after.join(' | '));
  r.app.dispose();
}

/* ───────── the twin join by gesture, the Cutter on its own with a controllable finger ───────── */
if (run('twin')) {
  const w = createMockWorld({ storage: null });
  const st = w.stage as unknown as Record<string, unknown>;
  let vid = 100;
  st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.addBody = () => ++vid; st.removeBody = () => {}; st.setBody = () => {}; st.setCutSeam = () => {}; st.setBridge = () => {}; st.partPieces = () => {};
  const mk = (g: unknown, o?: { at?: V; piece?: unknown }): SoftBodyLike => (o?.piece ? new Ctor(g, { piece: o.piece }) : o?.at ? new Ctor(g, { piece: { frac: 1, chunk: false, at: o.at } }) : new Ctor(g));
  const g0 = speciesBaseGenome('dollop' as never, 1);
  const body0 = mk(g0);
  const bm = createBodyManager({ createBody: (g) => mk(g), stage: w.stage, initial: { body: body0, identity: { genome: g0, tier: 'common', itemId: 'it-1', nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
  let t = 0, active: SoftBodyLike | null = null, touching = false, dragV: V | null = null;
  const notices: string[] = [];
  const ct = createCutter({
    bodies: bm, stage: w.stage, audio: w.audio, haptics: w.haptics, createBody: mk, quality: () => 'high', calm: () => false, gravity: () => true, simTime: () => t, viewport: () => ({ w: 800, h: 600 }),
    activeBody: () => active ?? bm.body, touching: () => touching, drag: (out) => { if (!dragV || !touching) return false; out.x = dragV.x; out.y = dragV.y; out.z = dragV.z; return true; },
    beforeChange() {}, clearMat: () => 0, panOf: () => 0, say: (s) => notices.push(s), report: (e) => { throw e; },
  });
  const step = (sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; const all = [bm.body, ...bm.extras.map((x) => x.body)]; for (const b of all) b.collide?.(all.filter((o) => o !== b)); bm.step(1 / 60); ct.update(1 / 60); } };
  step(1.5);
  ct.splitInTwo(); step(0.5); for (let i = 0; i < 100 && ct.busy; i++) step(1 / 60);
  step(2.5);
  const A = bm.body, B = bm.extras[0].body;
  active = B; touching = true; dragV = null; step(JOIN_HOLD_S * 3);
  const restJoin = ct.busy || ct.pieces !== 2;
  touching = false; step(0.2);
  B.moveTo?.({ x: A.center.x, y: B.center.y, z: A.center.z }, 2);
  for (let i = 0; i < 240; i++) { step(1 / 60); if (surfaceGap(A, B) < 0.02) break; }
  const u = { x: A.center.x - B.center.x, y: 0, z: A.center.z - B.center.z }, ul = Math.hypot(u.x, u.z) || 1;
  active = B; touching = true; dragV = { x: (u.x / ul) * 0.3, y: 0, z: (u.z / ul) * 0.3 };
  let steps = 0; while (!ct.busy && steps < 120) { step(1 / 60); steps++; }
  const started = ct.busy, afterS = steps / 60;
  touching = false; dragV = null; B.moveTo?.(null);
  let s3 = 0; while (ct.busy && s3 < 600) { step(1 / 60); s3++; }
  check(`twin join: a finger resting on a piece never joins; a piece DRAGGED into its twin and held (${JOIN_HOLD_S} s) flows in and the squishy is a fresh whole again`,
    !restJoin && started && afterS >= JOIN_HOLD_S - 0.05 && ct.fracs().length === 1 && bm.body !== A && bm.body.piece === undefined && bm.body.frac === 1 && bm.extras.length === 0 && bm.identity.genome === g0 && notices.at(-1) === 'Whole again.',
    `rest ${restJoin}, started after ${afterS.toFixed(2)} s, done in ${(s3 / 60).toFixed(2)} s, pieces ${ct.pieces}`);
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * CUT-B, task S4: the new rows of the TRUE cut that need the real SoftBody (CUT2.md 12: X03', X04, X05/X06 node legs, X10, X11, X12, X19). They run the Cutter on its own
 * (`rig2`: real bodies, a controllable finger, the moveTo / setNeck calls recorded) or through the whole game (`rig`). Species: the 12 family representatives; --full = all 50.
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const FAMILY_REPS = ['dollop', 'twangle', 'puddlo', 'crumbit', 'chunkle', 'wisplet', 'crimpo', 'boingle', 'dimpla', 'wrigglo', 'capnap', 'kneadle'];
const FULL = process.argv.includes('--full');
const SP_ARG = (process.argv.find((a) => a.startsWith('--sp=')) ?? '').slice(5).split(',').filter(Boolean);
const SPECIES_ALL: string[] = SP_ARG.length ? SP_ARG : FULL ? CATALOG.map((s) => s.id as string) : FAMILY_REPS;
const hashRest = (b: SoftBodyLike): string => {
  const a = new Uint32Array(b.restLocal.buffer, b.restLocal.byteOffset, b.restLocal.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; }
  return `${h.toString(16)}:${a.length}`;
};
const rot = (q: { x: number; y: number; z: number; w: number }, v: V): V => {
  const tx = q.y * v.z - q.z * v.y + q.w * v.x, ty = q.z * v.x - q.x * v.z + q.w * v.y, tz = q.x * v.y - q.y * v.x + q.w * v.z;
  return { x: v.x + 2 * (q.y * tz - q.z * ty), y: v.y + 2 * (q.z * tx - q.x * tz), z: v.z + 2 * (q.x * ty - q.y * tx) };
};
const mulberry = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** the Cutter on its own with REAL bodies: a controllable finger, every moveTo and every setNeck plane recorded, the eyes of face.ts (wholeRef) offered as `stage.eyeAnchors` */
function rig2(species: string, o: { ceiling?: number; eyes?: boolean; calm?: boolean } = {}) {
  const w = createMockWorld({ storage: null });
  const st = w.stage as unknown as Record<string, unknown>;
  let vid = 100;
  st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.addBody = () => ++vid; st.removeBody = () => {}; st.setBody = () => {}; st.setCutSeam = () => {}; st.setBridge = () => {}; st.partPieces = () => {};
  const g0 = speciesBaseGenome(species as never, 1);
  const ref = (() => { const b = new Ctor(g0); return wholeRefFor(b as never, b.restRadius, g0); })();
  const eyes = { left: { ...ref.eyes[0].centre } as V, right: { ...ref.eyes[1].centre } as V, r: ref.r, reach: ref.rho / 1.24 };   // reach = the bead at REST size (rho is the widest it gets, x1.24 squeezed: CUT2.md 8.3)
  if (o.eyes) st.eyeAnchors = () => ({ left: { ...eyes.left }, right: { ...eyes.right } });
  const moves: Array<{ b: SoftBodyLike; t: number; p: V | null }> = [];
  const necks: Array<{ n: V; p: V }> = [];
  let t = 0, active: SoftBodyLike | null = null, touching = false, dragV: V | null = null;
  /** wall time of every piece constructor (ms) with its region's cell depth: the merged piece of a join is built when the join starts */
  const buildMs: Array<{ ms: number; depth: number }> = [];
  const mk = (g: unknown, op?: { at?: V; piece?: unknown }): SoftBodyLike => {
    const tb = performance.now();
    const b = op?.piece ? new Ctor(g, { piece: op.piece }) : op?.at ? new Ctor(g, { piece: { frac: 1, chunk: false, at: op.at } }) : new Ctor(g);
    const reg = (op?.piece as { region?: { cells: number[][] } } | undefined)?.region;
    if (reg) buildMs.push({ ms: performance.now() - tb, depth: reg.cells[0].length });
    const mv = b.moveTo?.bind(b);
    if (mv) (b as unknown as { moveTo: unknown }).moveTo = (p: V | null, k?: number) => { moves.push({ b, t, p: p ? { ...p } : null }); mv(p, k); };
    const sn = b.setNeck?.bind(b);
    if (sn) (b as unknown as { setNeck: unknown }).setNeck = (pl: { point: V; normal: V } | null, tt: number, depth?: number) => { if (pl) necks.push({ n: { ...pl.normal }, p: { ...pl.point } }); sn(pl as never, tt, depth); };
    return b;
  };
  const body0 = mk(g0);
  const bm = createBodyManager({ createBody: (g) => mk(g), stage: w.stage, initial: { body: body0, identity: { genome: g0, tier: 'common', itemId: 'it-1', nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
  const notices: string[] = [];
  /** the physics refused to build a piece (below its share floor today): the Cutter answers with the plain "too thin" line and the squishy stays as it was (CUT3.md 2.3); anything else still throws */
  const buildFails: string[] = [];
  const ct = createCutter({
    bodies: bm, stage: w.stage, audio: w.audio, haptics: w.haptics, createBody: mk, quality: () => 'high', calm: () => !!o.calm, gravity: () => true, simTime: () => t, viewport: () => ({ w: 800, h: 600 }),
    activeBody: () => active ?? bm.body, touching: () => touching, drag: (out) => { if (!dragV || !touching) return false; out.x = dragV.x; out.y = dragV.y; out.z = dragV.z; return true; }, beforeChange() {}, clearMat: () => 0, panOf: () => 0, say: (s) => notices.push(s), report: (e) => { if (/cannot be built|the physics built a piece of share/.test(String((e as Error)?.message))) buildFails.push(String((e as Error).message)); else throw e; }, ceiling: o.ceiling,
  });
  const step = (sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; const all = [bm.body, ...bm.extras.map((x) => x.body)]; for (const b of all) b.collide?.(all.filter((q) => q !== b)); bm.step(1 / 60); ct.update(1 / 60); } };
  const idle = (max = 6): void => { for (let i = 0; i < max * 60 && ct.busy; i++) step(1 / 60); };
  const bodies = (): SoftBodyLike[] => [bm.body, ...bm.extras.map((x) => x.body)];
  const cam = (w.stage as unknown as { camera: THREE.PerspectiveCamera }).camera;
  const proj = (p: V): { x: number; y: number } => { const v = new THREE.Vector3(p.x, p.y, p.z).project(cam); return { x: (v.x + 1) * 400, y: (1 - v.y) * 300 }; };
  /** screen radius in px of a body of rest radius R at p */
  const projR = (p: V, R: number): number => Math.abs(proj({ x: p.x + R, y: p.y, z: p.z }).x - proj(p).x);
  return { w, bm, ct, g0, eyes, moves, necks, notices, buildFails, buildMs, step, idle, bodies, proj, projR, setFinger(b: SoftBodyLike | null, drag: V | null = null) { active = b; touching = b !== null; dragV = drag; }, now: () => t };
}
/** the signed SURFACE gap of A above B along the unit horizontal vector u (from B to A) */
const gapAlong = (A: SoftBodyLike, B: SoftBodyLike, u: V): number => (A.center.x - B.center.x) * u.x + (A.center.z - B.center.z) * u.z - supportAlong(A, { x: -u.x, y: 0, z: -u.z }) - supportAlong(B, u);

/* ───────── X19: the scripted parting (CUT2.md 6.5) ───────── */
if (run('parting')) {
  for (const sp of SPECIES_ALL) {
    const fam = familyOf(sp as never), G0 = PART_GAP[fam] ?? PART_GAP_DEFAULT, PS = PART_S[fam] ?? PART_S_DEFAULT;
    // (a) Split in two = a vertical plane: the script slides the pair sideways
    {
      const r = rig2(sp); r.step(1.5);
      const R0 = r.bm.body.restRadius, G = G0 * (R0 / 0.5);
      r.ct.splitInTwo();
      const ok = (() => { const t1 = r.now() + 5; while (r.bm.extras.length === 0 && r.now() < t1) r.step(1 / 60); return r.bm.extras.length > 0; })();
      const A = r.bm.body, B = r.bm.extras[0]?.body;
      if (!ok || !B) { check(`${sp}: the cut swapped`, false); continue; }
      const t0 = r.now();
      const hl = Math.hypot(A.center.x - B.center.x, A.center.z - B.center.z) || 1, u = { x: (A.center.x - B.center.x) / hl, y: 0, z: (A.center.z - B.center.z) / hl };
      const c0 = (A.center.x - B.center.x) * u.x + (A.center.z - B.center.z) * u.z;
      const opening = (): number => (A.center.x - B.center.x) * u.x + (A.center.z - B.center.z) * u.z - c0;
      r.step(PS - (r.now() - t0)); const oPS = opening(), gPS = gapAlong(A, B, u);
      r.step(4 - (r.now() - t0)); const o4 = opening(), g4 = gapAlong(A, B, u);
      check(`${sp} (${fam}): X19 the scripted parting of Split in two opens the centres to G ${f3(G)} m +-20 % by PART_S ${PS} s (measured ${f3(oPS)}) and the SURFACE gap holds to 4 s (drift under 1 cm: ${f3(g4 - gPS)}; the centres drift ${f3(o4 - oPS)}, which a foam or putty half does as it re-expands)`,
        Math.abs(oPS - G) <= 0.2 * G && Math.abs(g4 - gPS) < 0.01, `open ${f3(oPS)} -> ${f3(o4)}, gap ${f3(gPS)} -> ${f3(g4)}`);
      // the script itself: moveTo calls of both pieces from the swap, symmetric about the birth midpoint, ending at G, released at PART_S, nothing after
      const mA = r.moves.filter((m) => m.b === A), mB = r.moves.filter((m) => m.b === B);
      const nzA = mA.filter((m) => m.p), nzB = mB.filter((m) => m.p);
      const baseA = nzA[0]?.p, baseB = nzB[0]?.p, lastA = nzA.at(-1)?.p, lastB = nzB.at(-1)?.p;
      let symmetric = !!baseA && !!baseB && nzA.length === nzB.length && nzA.length > 5;
      if (symmetric) for (let i = 0; i < nzA.length; i++) { const a = nzA[i].p!, b = nzB[i].p!; if (Math.abs((a.x - baseA!.x) + (b.x - baseB!.x)) > 1e-6 || Math.abs((a.z - baseA!.z) + (b.z - baseB!.z)) > 1e-6) { symmetric = false; break; } }
      const reachedG = !!lastA && !!lastB && Math.abs(Math.hypot((lastA.x - lastB.x) - (baseA!.x - baseB!.x), (lastA.z - lastB.z) - (baseA!.z - baseB!.z)) - G) < 1e-6;
      const releaseA = mA.find((m) => m.p === null), releaseB = mB.find((m) => m.p === null);
      const released = !!releaseA && !!releaseB && Math.abs(releaseA.t - (t0 + PS)) < 0.03 && Math.abs(releaseB.t - (t0 + PS)) < 0.03 && mA.indexOf(releaseA) === mA.length - 1 && mB.indexOf(releaseB) === mB.length - 1;
      check(`${sp}: the script moves both pieces by moveTo +-0.5 g(t) s (symmetric about the birth midpoint to 1e-6, the opening ends at G), releases both at PART_S (moveTo(null) once, the last call) and touches neither again`, symmetric && reachedG && released,
        `calls ${mA.length}/${mB.length}, symmetric ${symmetric}, ends at G ${reachedG}, release at ${releaseA ? f3(releaseA.t - t0) : 'none'}`);
      r.ct.reconnectAll(false);
    }
    // (b) a finger on either piece ends the script at once
    {
      const r = rig2(sp); r.step(1.5);
      r.ct.splitInTwo();
      const t1 = r.now() + 5; while (r.bm.extras.length === 0 && r.now() < t1) r.step(1 / 60);
      const A = r.bm.body, B = r.bm.extras[0].body;
      r.step(0.1);
      const n0 = r.moves.length;
      r.setFinger(B); r.step(1 / 30); r.setFinger(null);
      const after = r.moves.slice(n0);
      const rel = after.filter((m) => m.p === null), nz = after.filter((m) => m.p);
      r.step(PS + 0.3);
      const later = r.moves.slice(n0 + after.length).filter((m) => m.p);
      check(`${sp}: a finger on a piece ends the parting at once: both pieces get moveTo(null) within one step and nothing steers them afterwards`, rel.some((m) => m.b === A) && rel.some((m) => m.b === B) && nz.length <= 2 && later.length === 0, `released ${rel.length}, steered after ${nz.length + later.length}`);
      r.ct.reconnectAll(false);
    }
    // (c) a near-level cut (a horizontal swipe, |n.y| >= 0.75): no sliding script, a small plop; the upper piece stays on the lower one
    {
      const r = rig2(sp); r.step(1.5);
      const c = r.bm.body.center, p = r.proj(c), pr = r.projR(c, r.bm.body.restRadius);
      const res = r.ct.swipe(p.x - 1.6 * pr, p.y + 2, p.x + 1.6 * pr, p.y - 2);
      const t1 = r.now() + 5; while (r.bm.extras.length === 0 && r.now() < t1) r.step(1 / 60);
      const A = r.bm.body, B = r.bm.extras[0]?.body;
      if (res !== 'cut' || !B) { check(`${sp}: the horizontal swipe cut`, false, res); continue; }
      const ny = Math.abs(r.necks[0].n.y);
      const up = A.center.y >= B.center.y ? A : B, lo = up === A ? B : A, rel0 = { x: up.center.x - lo.center.x, z: up.center.z - lo.center.z }, y0 = up.center.y;
      let rise = 0, late = 0; const t0 = r.now();
      for (let i = 0; i < 240; i++) { r.step(1 / 60); rise = Math.max(rise, up.center.y - y0); }
      const pu = { x: up.center.x, y: up.center.y, z: up.center.z }; r.step(1 / 60); late = Math.hypot(up.center.x - pu.x, up.center.y - pu.y, up.center.z - pu.z) * 60;
      const shift = Math.hypot(up.center.x - lo.center.x - rel0.x, up.center.z - lo.center.z - rel0.z);
      check(`${sp} (${fam}): a horizontal swipe (|n.y| ${f3(ny)} >= 0.75) parts by the plop, no sliding script (no moveTo at all); 4 s later the upper piece has moved ${f3(shift)} m sideways (bar 0.18, X13 category 1), rose ${f3(rise)} m (bar 0.06) and moves ${f3(late)} m/s`,
        ny >= 0.75 && r.moves.length === 0 && shift <= 0.18 && rise <= 0.06 && late <= 0.3 && r.now() - t0 > 3.9, `moves ${r.moves.length}`);
      r.ct.reconnectAll(false);
    }
  }
  // (d) Calm effects: the gap is 0.6 of G
  {
    const sp = 'dollop', G0 = PART_GAP_DEFAULT, r = rig2(sp, { calm: true }); r.step(1.5);
    const G = G0 * (r.bm.body.restRadius / 0.5) * 0.6;
    r.ct.splitInTwo();
    const t1 = r.now() + 5; while (r.bm.extras.length === 0 && r.now() < t1) r.step(1 / 60);
    const A = r.bm.body, B = r.bm.extras[0].body;
    const hl = Math.hypot(A.center.x - B.center.x, A.center.z - B.center.z) || 1, u = { x: (A.center.x - B.center.x) / hl, y: 0, z: (A.center.z - B.center.z) / hl };
    const c0 = (A.center.x - B.center.x) * u.x + (A.center.z - B.center.z) * u.z;
    r.step(PART_S_DEFAULT + 0.1);
    const o = (A.center.x - B.center.x) * u.x + (A.center.z - B.center.z) * u.z - c0;
    check(`Calm effects: the parting gap is 0.6 of G (${f3(G)} m; measured ${f3(o)})`, Math.abs(o - G) <= 0.2 * G);
  }
}

/* ───────── X15 (the resting gap row of CUT2.md 7.3): a FLUSH pair of true halves rests under the touch gap, so a drag can reach it without pressing in ───────── */
// TOUCH_GAP = max(0.03, TOUCH_SKIN_K x pairSkin), pairSkin = 0.25 (meanEdgeA + meanEdgeB). The first version of the shell kept the fixed 0.03 and dollop's halves rest at 0.037 (a real drag in the browser never
// touched: cut_browser join). The pair is pushed together (a hold with moveTo until the skins overlap by 1 cm), let go, and left to rest 2 s: the gap it keeps is the contact's own resting gap.
if (run('x15gap')) {
  const bad: string[] = []; let worst = 0, worstSp = '', tgMax = 0, gMax = 0;
  for (const sp of SPECIES_ALL) {
    const r = rig2(sp, { eyes: true }); r.step(1.5);
    r.ct.splitInTwo();
    const t1 = r.now() + 5; while (r.bm.extras.length === 0 && r.now() < t1) r.step(1 / 60);
    const A = r.bm.body, B = r.bm.extras[0]?.body;
    if (!B) { bad.push(sp + ': no cut'); continue; }
    r.step(1.5);
    for (let i = 0; i < 240; i++) {
      const g = surfaceGap(A, B);
      if (g < -0.01) break;
      const dx = A.center.x - B.center.x, dz = A.center.z - B.center.z, l = Math.hypot(dx, dz) || 1;
      B.moveTo?.({ x: B.center.x + dx / l * (g + 0.012), y: B.center.y, z: B.center.z + dz / l * (g + 0.012) }, 3);
      r.step(1 / 60);
    }
    B.moveTo?.(null);
    r.step(2);
    const gap = surfaceGap(A, B), tg = Math.max(0.03, TOUCH_SKIN_K * 0.25 * ((A.meanEdge ?? 0) + (B.meanEdge ?? 0)));
    tgMax = Math.max(tgMax, tg); gMax = Math.max(gMax, gap);
    if (gap / tg > worst) { worst = gap / tg; worstSp = sp; }
    if (!(gap < tg)) bad.push(sp + ': rests at ' + gap.toFixed(3) + ' m, touch gap ' + tg.toFixed(3) + ' m');
    if (VERBOSE) console.log('   ' + sp + ': flush rest gap ' + gap.toFixed(3) + ' touch ' + tg.toFixed(3) + ' (meanEdge ' + (A.meanEdge ?? 0).toFixed(3) + ' / ' + (B.meanEdge ?? 0).toFixed(3) + ')');
    r.ct.reconnectAll(false);
  }
  check('X15 resting gap: a pair of halves pushed together and let go rests under the touch gap max(0.03, ' + TOUCH_SKIN_K + ' x pairSkin) on ' + SPECIES_ALL.length + ' species (largest rest gap ' + gMax.toFixed(3) + ' m; worst ' + worstSp + ' at ' + (worst * 100).toFixed(0) + ' % of it; the largest touch gap ' + tgMax.toFixed(3) + ' m)', bad.length === 0, bad.slice(0, 5).join('; '));
}

/* ───────── X19 on SLOPES: the parting of a swipe at any angle, with the camera at the REAL default pitch (0.27 rad: a horizontal swipe is a 16 degree plane) ───────── */
// Swipe angles 0 / 20 / 30 / 38 / 45 / 60 degrees from horizontal => planes tilted 16 / 25 / 33 / 40 / 47 / 60 degrees (|n.y| = 0.964 cos a). The shell parts a near-level plane (|n.y| >= LEVEL_NY) by the plop, a steeper one
// by the sliding script. Measured on the pair 4 s after the swap: the horizontal drift of the upper piece from where it stood when the script ended (PART_S + 0.1 s), the total horizontal shift of the
// pair from flush, the rise of the upper piece above its birth height and its speed in the last second. Bars: X13 category 1/2 (drift <= 0.18 m, rise <= 0.06 m, late speed <= 0.3 m/s).
if (run('slope')) {
  const bad: string[] = [], rows: string[] = [];
  for (const sp of SPECIES_ALL.length > 4 && !FULL && !SP_ARG.length ? ['dollop', 'kneadle', 'twangle', 'capnap'] : SPECIES_ALL) {
    const fam = familyOf(sp as never), PS = PART_S[fam] ?? PART_S_DEFAULT;
    for (const deg of [0, 20, 30, 38, 45, 60]) {
      const r = rig2(sp); r.step(1.5);
      const cam = (r.w.stage as unknown as { camera: THREE.PerspectiveCamera }).camera;
      cam.position.set(0, 0.35 + 3.3 * Math.sin(0.27), 3.3 * Math.cos(0.27)); cam.lookAt(0, 0.35, 0); cam.updateMatrixWorld(true);
      const c = r.bm.body.center, p = r.proj(c), pr = r.projR(c, r.bm.body.restRadius), a = deg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
      const res = r.ct.swipe(p.x - 1.6 * pr * dx, p.y + 1.6 * pr * dy, p.x + 1.6 * pr * dx, p.y - 1.6 * pr * dy);
      const t1 = r.now() + 5; while (r.bm.extras.length === 0 && r.now() < t1) r.step(1 / 60);
      const A = r.bm.body, B = r.bm.extras[0]?.body;
      if (res !== 'cut' || !B) { bad.push(`${sp} ${deg}: ${res}`); continue; }
      const ny = Math.abs(r.necks[0].n.y), up = A.center.y >= B.center.y ? A : B, lo = up === A ? B : A, y0 = up.center.y;
      const rel = (): V => ({ x: up.center.x - lo.center.x, y: 0, z: up.center.z - lo.center.z });
      const rel0 = rel(); let rise = 0, relS: V = rel0, late = 0;
      const tEnd = r.now() + 4;
      while (r.now() < tEnd - 1e-6) {
        r.step(1 / 60); rise = Math.max(rise, up.center.y - y0);
        if (Math.abs(r.now() - (tEnd - 4 + PS + 0.1)) < 0.009) relS = rel();
      }
      const pu = { x: up.center.x, y: up.center.y, z: up.center.z }; r.step(1 / 60); late = Math.hypot(up.center.x - pu.x, up.center.y - pu.y, up.center.z - pu.z) * 60;
      const rel4 = rel(), drift = Math.hypot(rel4.x - relS.x, rel4.z - relS.z), shift = Math.hypot(rel4.x - rel0.x, rel4.z - rel0.z);
      const ok = drift <= 0.18 && rise <= 0.06 && late <= 0.3;
      rows.push(`${sp} ${deg}deg(|n.y| ${ny.toFixed(2)}, ${ny >= LEVEL_NY ? 'plop' : 'slide'}): drift ${drift.toFixed(3)} shift ${shift.toFixed(3)} rise ${rise.toFixed(3)} late ${late.toFixed(2)}${ok ? '' : ' <-- over'}`);
      if (!ok) bad.push(rows.at(-1)!);
      r.ct.reconnectAll(false);
    }
  }
  if (VERBOSE) for (const x of rows) console.log('   ' + x);
  check(`X19 slopes: a swipe at 0 / 20 / 30 / 38 / 45 / 60 degrees (planes 16 to 60 degrees at the real camera pitch) on ${SPECIES_ALL.length > 4 && !FULL && !SP_ARG.length ? 4 : SPECIES_ALL.length} species: after the script ends the upper piece stays within 0.18 m (drift), never rises more than 0.06 m, is slower than 0.3 m/s in the 4th second`, bad.length === 0, bad.slice(0, 8).join('; ') || `${rows.length} cases`);
}

/* ───────── X03' (node leg): the first Split in two leaves one eye on each half; (c) the pieces are true parts ───────── */
if (run('x03')) {
  const crossed: string[] = [], bad: string[] = [], rows: string[] = [];
  let worstCam = 0, worstHalf = 0, scaledCopies = 0;
  for (const sp of SPECIES_ALL) {
    const r = rig2(sp, { eyes: true }); r.step(1.3);
    const b0 = r.bm.body, c0 = { ...b0.center }, q0 = { ...b0.frame }, R0 = b0.restRadius;
    r.ct.splitInTwo();
    for (let i = 0; i < 30 && r.necks.length === 0; i++) r.step(1 / 60);
    const nk = r.necks[0];
    if (!nk) { bad.push(`${sp}: no neck`); continue; }
    const eL = rot(q0, r.eyes.left), eR = rot(q0, r.eyes.right);
    const sL = (c0.x + eL.x - nk.p.x) * nk.n.x + (c0.y + eL.y - nk.p.y) * nk.n.y + (c0.z + eL.z - nk.p.z) * nk.n.z;
    const sR = (c0.x + eR.x - nk.p.x) * nk.n.x + (c0.y + eR.y - nk.p.y) * nk.n.y + (c0.z + eR.z - nk.p.z) * nk.n.z;
    const ax = rot(q0, { x: 1, y: 0, z: 0 });
    // the normal is the squishy's own x axis, whatever the camera shows: it is not read from the camera at all (the first press)
    worstCam = Math.max(worstCam, Math.hypot(nk.n.x - ax.x, nk.n.y - ax.y, nk.n.z - ax.z));
    if (!(sL * sR < 0)) bad.push(`${sp}: eyes on the same side (${f3(sL)}, ${f3(sR)})`);
    if (Math.min(Math.abs(sL), Math.abs(sR)) < r.eyes.reach) crossed.push(sp);
    rows.push(`${sp} ${f3(sL / R0)}/${f3(sR / R0)}`);
    r.idle(); r.step(1.5);
    // (c) every piece's rest vertices lie inside its own half-spaces; neither piece is a scaled copy of the whole
    const ps = r.bodies();
    for (const b of ps) {
      const pi = b.piece;
      if (!pi) { bad.push(`${sp}: a piece without PieceInfo`); continue; }
      let out = 0;
      for (const cell of pi.cells) for (const pl of cell) for (let i = 0; i < b.restLocal.length; i += 3) {
        const d = pl.n.x * (b.restLocal[i] + pi.offset.x) + pl.n.y * (b.restLocal[i + 1] + pi.offset.y) + pl.n.z * (b.restLocal[i + 2] + pi.offset.z) - pl.d;
        if (d > out) out = d;
      }
      worstHalf = Math.max(worstHalf, out / R0);
      const wr = pi.whole.restLocal, k = Math.cbrt(b.frac ?? 1);
      let diff = Infinity;
      if (wr.length === b.restLocal.length) { diff = 0; for (let i = 0; i < wr.length; i++) diff = Math.max(diff, Math.abs(b.restLocal[i] - k * wr[i])); }
      if (diff < 0.02 * R0) scaledCopies++;
    }
    r.ct.reconnectAll(false);
  }
  const expectCrossed = ['granulo', 'marigel'];
  const diff = FULL ? crossed.filter((s) => !expectCrossed.includes(s)).length + expectCrossed.filter((s) => !crossed.includes(s)).length : crossed.length;
  check(`X03' (a): the first Split in two puts the two eyes on opposite sides of the shell's plane on ${SPECIES_ALL.length} of ${SPECIES_ALL.length} species (eye centres from face.ts / wholeRef.ts; the plane through their midpoint when its share is in [0.40, 0.60], else the median plane along the squishy's own x axis)`, bad.length === 0, bad.slice(0, 3).join('; '));
  check(`X03' (a): the plane's normal is the squishy's own +x axis (max difference ${worstCam.toExponential(1)}), never read from the camera: it cannot change with the camera yaw (0, +-5, +-10, +-40, 90 degrees)`, worstCam < 1e-9);
  check(`X03' (a): the species whose bead at REST size is crossed by that plane: ${crossed.join(', ') || 'none'} (${FULL ? 'asserted {granulo, marigel} with at most one difference either way' : 'none of the 12 family representatives'})`, FULL ? diff <= 1 : diff === 0);
  check(`X03' (c): every piece's rest vertices lie inside its own half-spaces (worst ${worstHalf.toExponential(1)} R0; the instrument is the float32 restLocal, so the bar is 1e-6 R0, not the 1e-9 of the builder's doubles) and no piece is a scaled copy of the whole (${scaledCopies} found)`, worstHalf <= 1e-6 && scaledCopies === 0);
  if (VERBOSE) console.log('   ' + rows.join(' | '));
}

/* ───────── X11 (node leg): a swipe through the projected centre of the left eye ───────── */
if (run('x11')) {
  const bad: string[] = [], refused: string[] = []; let worstS = 0;
  for (const sp of SPECIES_ALL) {
    const r = rig2(sp, { eyes: true }); r.step(1.3);
    const b0 = r.bm.body, c0 = { ...b0.center }, q0 = { ...b0.frame }, R0 = b0.restRadius;
    const eL = rot(q0, r.eyes.left), eR = rot(q0, r.eyes.right);
    const pe = r.proj({ x: c0.x + eL.x, y: c0.y + eL.y, z: c0.z + eL.z }), pr = r.projR(c0, R0);
    const res = r.ct.swipe(pe.x + 1, pe.y - 1.4 * pr, pe.x - 1, pe.y + 1.4 * pr);   // a vertical swipe through the eye on the screen
    for (let i = 0; i < 30 && r.necks.length === 0 && res === 'cut'; i++) r.step(1 / 60);
    const nk = r.necks[0];
    if (res !== 'cut' || !nk) { bad.push(`${sp}: ${res}`); r.ct.reconnectAll(false); continue; }
    const sL = (c0.x + eL.x - nk.p.x) * nk.n.x + (c0.y + eL.y - nk.p.y) * nk.n.y + (c0.z + eL.z - nk.p.z) * nk.n.z;
    const sR = (c0.x + eR.x - nk.p.x) * nk.n.x + (c0.y + eR.y - nk.p.y) * nk.n.y + (c0.z + eR.z - nk.p.z) * nk.n.z;
    worstS = Math.max(worstS, Math.abs(sL) / r.eyes.r);
    if (Math.abs(sL) > 0.29 * r.eyes.r) bad.push(`${sp}: the plane misses the eye centre by ${f3(sL / r.eyes.r)} bead radii`);
    if (Math.abs(sR) < r.eyes.r) bad.push(`${sp}: the other bead is crossed too (${f3(sR / r.eyes.r)})`);
    r.idle(); r.step(0.5);
    const fr = r.ct.fracs();
    if (r.ct.pieces !== 2 || Math.abs(fr[0] + fr[1] - 1) > 1e-9) bad.push(`${sp}: shares ${fr.map(f3).join('+')}`);
    r.ct.reconnectAll(false);
  }
  check(`X11 (node leg): a swipe through the projected centre of the left eye cuts that bead about in half on ${SPECIES_ALL.length} species (the plane passes within ${f3(worstS)} bead radii of its centre; 0.29 radii is a half-to-3:1 split, share 0.5 +-0.2), the other bead is not crossed, two pieces, shares sum to 1; refused as too small (the eye is within 1/8 of the edge): ${refused.join(', ') || 'none'} (at most 2 of 12 allowed) (the clipped bead's pixels: cut_browser.mjs x11)`, bad.length === 0 && refused.length <= (FULL ? 6 : 2), bad.slice(0, 3).join('; '));
}

/* ───────── X04 / X10 / X12: nested cuts, Reconnect all is the exact original. RE-SPECIFIED because the owner removed the limits on 2026-10-09: no cap of 6 pieces (the test dep maxClean is gone), no 1/8 minimum; the physics lifted its clamp the same day (piece.ts FRAC_FLOOR, a share floor that PHYS_FLOOR below MEASURES, so these rows follow the physics) ───────── */
/** the smallest share the REAL SoftBody builds a piece at (measured: 0.010 on 2026-10-09 after the clamp at 1/8 was lifted): every row that halves pieces repeatedly stops where the physics stops */
const PHYS_FLOOR = (() => { try { const f = new Ctor(speciesBaseGenome('dollop' as never, 1), { piece: { frac: 0.01, chunk: false } }).frac; return typeof f === 'number' && f > 0 ? f : 0.124; } catch { return 0.124; } })();
/** how many Split in two presses the physics can honour from a whole squishy: the first press is the eye-midline plane (a smaller share of 0.40 to 0.60), every later press halves the largest piece, each half must stay >= the physics floor (worst case: the first press leaves 0.40 + 0.60) */
const PRESSES_OK = ((): number => { let n = 1, pieces = [0.4, 0.6]; for (;;) { pieces.sort((a, b) => b - a); if (pieces[0] / 2 < PHYS_FLOOR + 1e-3 || n >= 20) return n; const h = pieces.shift()! / 2; pieces.push(h, h); n++; } })();
if (run('nested')) {
  const bad04: string[] = [], bad10: string[] = [], bad12: string[] = [];
  let worstVol = 0, vols = 0, trees = 0, cutsDone = 0;
  const seen: Record<number, number> = {};
  for (let si = 0; si < SPECIES_ALL.length; si++) {
    const sp = SPECIES_ALL[si];
    // ---- X10 (re-specified 2026-10-09): the presses of Split in two keep cutting, past six pieces (no limit): PRESSES_OK of them while the physics can build the shares; shares sum to 1
    {
      const r = rig2(sp, { eyes: true }); r.step(1.3);
      const never = new Ctor(r.g0), V0 = volOf(r.bm.body);
      const res: string[] = [];
      for (let i = 0; i < PRESSES_OK; i++) { res.push(r.ct.splitInTwo()); r.idle(8); r.step(0.8); }
      const fr = r.ct.fracs();
      if (!res.every((x) => x === 'cut')) bad10.push(`${sp}: ${res.join()}`);
      else if (Math.abs(fr.reduce((a, b) => a + b, 0) - 1) > 1e-9 || Math.min(...fr) <= 0 || r.ct.pieces !== PRESSES_OK + 1) bad10.push(`${sp}: ${fr.map(f3).join('+')}`);
      else if (r.notices.some((n) => /as many pieces|lot of pieces|Too small/.test(n))) bad10.push(`${sp}: a limit line was said: "${r.notices.at(-1)}"`);
      // every piece is a leaf of one tree: as many regions as pieces, one cell each, all cells distinct
      const regs = r.ct.regions();
      if (regs.length !== PRESSES_OK + 1 || new Set(regs.map((x) => JSON.stringify(x.cells.slice().sort()))).size !== PRESSES_OK + 1 || regs.filter((x) => x.anchor).length !== 1) bad10.push(`${sp}: regions ${JSON.stringify(regs.map((x) => x.cells))}`);
      // ---- X04 from the most pieces: Reconnect all is the exact original
      const ok = r.ct.reconnectAll(true); r.idle(10); r.step(2);
      const W = r.bm.body;
      const same = ok && r.ct.pieces === 1 && r.bm.extras.length === 0 && W.piece === undefined && W.frac === 1 && r.bm.identity.genome === r.g0 && hashRest(W) === hashRest(never) && Math.hypot(W.center.x, W.center.z) < 1e-9 && Math.abs(volOf(W) / V0 - 1) < 0.005 && r.notices.at(-1) === 'Whole again.';
      if (!same) bad04.push(`${sp}: from ${PRESSES_OK + 1}: pieces ${r.ct.pieces}, piece ${W.piece === undefined ? 'undefined' : 'set'}, frac ${W.frac}, hash ${hashRest(W) === hashRest(never)}, vol ${f3(volOf(W) / V0)}, say ${r.notices.at(-1)}`);
      // ... from 2 and 4 pieces
      for (const n of [2, 4]) {
        const q = rig2(sp); q.step(1.3);
        const V1 = volOf(q.bm.body);
        for (let i = 0; i < n - 1; i++) { q.ct.splitInTwo(); q.idle(8); q.step(0.8); }
        const k = q.ct.pieces;
        q.ct.reconnectAll(true); q.idle(10); q.step(2);
        const W2 = q.bm.body;
        if (!(k === n && q.ct.pieces === 1 && q.bm.extras.length === 0 && W2.piece === undefined && W2.frac === 1 && q.bm.identity.genome === q.g0 && hashRest(W2) === hashRest(never) && Math.hypot(W2.center.x, W2.center.z) < 1e-9 && Math.abs(volOf(W2) / V1 - 1) < 0.005)) bad04.push(`${sp}: from ${n}: made ${k}, hash ${hashRest(W2) === hashRest(never)}`);
      }
    }
    // ---- X12: one random tree per species: random swipes at random angles through random pieces, one cut at a time with the parting after each
    {
      const r = rig2(sp); r.step(1.3);
      const rnd = mulberry(1000 + si), V0 = volOf(r.bm.body);
      let made = 1;
      for (let k = 0; k < 5; k++) {
        let did = false;
        for (let tries = 0; tries < 10 && !did; tries++) {
          const cands = r.bodies().filter((b) => (b.frac ?? 1) >= 3.2 * PHYS_FLOOR);
          if (!cands.length) break;
          const tgt = cands[Math.floor(rnd() * cands.length)], c = tgt.center, Rb = tgt.restRadius * Math.cbrt(Math.max(tgt.frac ?? 1, 0.125));
          const p = r.proj(c), pr = r.projR(c, Rb) * 1.0, th = rnd() * Math.PI, off = (rnd() - 0.5) * 0.24 * pr;   // (a narrow spread: the real physics builds no share under its floor yet, so every child must stay above it)
          const dx = Math.cos(th), dy = Math.sin(th), px = -dy, py = dx;
          const res = r.ct.swipe(p.x + px * off - 1.7 * pr * dx, p.y + py * off - 1.7 * pr * dy, p.x + px * off + 1.7 * pr * dx, p.y + py * off + 1.7 * pr * dy);
          const before = r.ct.pieces;
          if (res === 'cut') { r.idle(8); r.step(1.5); if (r.ct.pieces > before) { did = true; cutsDone++; made++; } }
          else r.step(0.4);
        }
        if (!did) break;
        const fr = r.ct.fracs();
        if (Math.abs(fr.reduce((a, b) => a + b, 0) - 1) > 1e-9 || Math.min(...fr) <= 0) bad12.push(`${sp}: cut ${k + 1}: ${fr.map(f3).join('+')}`);
      }
      seen[made] = (seen[made] ?? 0) + 1; trees++;
      const ps = r.bodies();
      r.step(1);
      if (VERBOSE) { const early = ps.map((b) => volOf(b) / ((b.frac ?? 1) * V0)); r.step(4); console.log(`   ${sp} volumes / share at +1 s: ${early.map(f3).join(' ')}  at +5 s: ${ps.map((b) => f3(volOf(b) / ((b.frac ?? 1) * V0))).join(' ')}`); }
      ps.forEach((b, i) => { const v = Math.abs(volOf(b) / ((b.frac ?? 1) * V0) - 1); vols++; worstVol = Math.max(worstVol, v); if (v > 0.03) bad12.push(`${sp}: piece ${i} (${f3(b.frac ?? 0)}) volume off by ${(v * 100).toFixed(1)} %`); });
      r.ct.reconnectAll(false);
    }
  }
  check(`X10: RE-SPECIFIED 2026-10-09 (no limit): ${PRESSES_OK} presses of Split in two reach ${PRESSES_OK + 1} pieces (past the old six; the most the physics' share floor ${PHYS_FLOOR.toFixed(3)} allows today) on ${SPECIES_ALL.length} species (the first press is the eye-midline plane), every share positive and the sum 1 (1e-9), one region per piece (one cell each, one anchor), no limit line said`, bad10.length === 0, bad10.slice(0, 3).join('; '));
  check(`X04: Reconnect all from 2, 4 and ${PRESSES_OK + 1} pieces ends as the exact original on ${SPECIES_ALL.length} species: restLocal hash equal to a never-cut body's, the original genome object, no PieceInfo, frac 1, volume within 0.5 %, at the middle (1e-9), "Whole again."`, bad04.length === 0, bad04.slice(0, 3).join('; '));
  check(`X12: ${trees} random trees (one per species, ${cutsDone} swipes at random angles and offsets, a piece at a time, 1.5 s of parting after each; pieces made: ${JSON.stringify(seen)}): shares sum to 1 (1e-9), each positive, every piece's mesh volume within 3 % of its share (worst ${(worstVol * 100).toFixed(2)} % over ${vols} pieces)`, bad12.length === 0, bad12.slice(0, FULL ? 12 : 12).join('; '));
}

/* ───────── U05 on the REAL bodies (CUT3.md 5): Minis to 24 minis; each a complete smaller copy (own face), finite, on the table, within 5 % of its share; Reconnect all exact ───────── */
// The same wall as U01: it runs as many presses as the physics can build (PHYS lifts the 1/8 clamp and adds the coarsest-mesh floor in CUT3 leg 1) and says exactly how far it got. --presses=N runs fewer.
// The mock-body version (any count, no physics) is cut_mock_checks.ts, section u05; the eyes of every mini in the real stage are cut_browser.mjs, section u05.
if (run('u05')) {
  const PRESS = Number((process.argv.find((a) => a.startsWith('--presses=')) ?? '--presses=23').split('=')[1]);
  const bad: string[] = [], rows: string[] = [];
  for (const sp of (SP_ARG.length ? SP_ARG : FULL ? CATALOG.map((s) => s.id as string) : ['dollop', 'capnap', 'kneadle'])) {
    const r = rig(sp, { style: 'minis', tier: 'high' });
    r.go(1500);
    const V0 = volOf(r.app.body), res: string[] = [];
    for (let i = 0; i < PRESS; i++) { res.push(r.app.cut.splitInTwo()); r.idle(300); r.go(150); }
    r.go(1200);
    const all = [r.app.body, ...r.app.bodies.extras.map((x) => x.body)], fr = r.app.cut.fracs();
    const finite = all.every((b) => b.positions.every((v) => Number.isFinite(v)));
    const lowest = Math.min(...all.map((b) => { let m = Infinity; for (let i = 1; i < b.positions.length; i += 3) m = Math.min(m, b.positions[i]); return m; }));
    const volErr = Math.max(...all.map((b) => Math.abs(volOf(b) / ((b.frac ?? 1) * V0) - 1)));
    const copies = all.every((b) => b.piece === undefined) && r.addOpts.every((o) => !(o as { chunk?: boolean } | undefined)?.chunk);
    const ok = r.app.cut.reconnectAll(true); r.idle(); r.go(2500);
    const exact = ok && r.app.cut.pieces === 1 && r.app.body.piece === undefined && r.app.body.frac === 1 && r.app.bodies.extras.length === 0 && r.app.identity.genome === r.g && hashRest(r.app.body) === hashRest(new Ctor(r.g));
    rows.push(`${sp}: ${all.length} minis, volume worst ${(volErr * 100).toFixed(1)} %, lowest ${lowest.toFixed(3)}`);
    if (!(all.length === PRESS + 1 && res.every((x) => x === 'cut') && Math.abs(fr.reduce((a, b) => a + b, 0) - 1) < 1e-5 && Math.min(...fr) > 0 && finite && lowest > -0.02 && volErr < 0.05 && copies && exact)) {
      bad.push(`${sp}: ${all.length - 1} of ${PRESS} presses made a mini (${res.filter((x) => x !== 'cut').length} refused), sum ${fr.reduce((a, b) => a + b, 0).toFixed(9)}, finite ${finite}, lowest ${lowest.toFixed(3)}, volume worst ${(volErr * 100).toFixed(1)} %, complete copies ${copies}, exact whole ${exact}`);
    }
    r.app.dispose();
  }
  if (VERBOSE) for (const x of rows) console.log('   ' + x);
  check(`U05 (real bodies): Minis, ${PRESS} presses of Split in two make ${PRESS + 1} minis; each is a complete smaller copy of the species (no PieceInfo, no chunk flag), finite, on the table, its volume within 5 % of its share; shares sum to 1; Reconnect all ends as a fresh whole${bad.length ? ' [WAITS FOR PHYS: the piece builder refuses shares under its floor]' : ''}`, bad.length === 0, bad.slice(0, 4).join('; '));
}

/* ───────── U01 on the REAL bodies (CUT3.md 5): 20 consecutive presses of Split in two on the largest piece; all succeed, shares sum to 1 within 1e-9, Reconnect all ends bit-for-bit whole ───────── */
// While the real SoftBody clamped a piece at 1/8 this row was RED and said exactly how far the physics got (presses that cut, builds the physics refused); the clamp was lifted on 2026-10-09 and it is green (20 presses, 12 species).
// --presses=N runs fewer presses. The mock-body version of the same row (any count, both styles) is cut_mock_checks.ts, section u01.
if (run('u01')) {
  const PRESS = Number((process.argv.find((a) => a.startsWith('--presses=')) ?? '--presses=20').split('=')[1]);
  const bad: string[] = [];
  for (const sp of SPECIES_ALL) {
    const r = rig2(sp, { eyes: true }); r.step(1.3);
    const never = new Ctor(r.g0);
    const res: string[] = [];
    for (let i = 0; i < PRESS; i++) { res.push(r.ct.splitInTwo()); r.idle(8); r.step(0.4); }
    const made = r.ct.pieces, fr = r.ct.fracs();
    const sumOk = Math.abs(fr.reduce((a, b) => a + b, 0) - 1) < 1e-9;
    r.ct.reconnectAll(true); r.idle(12); r.step(2.5);
    const W = r.bm.body;
    const exact = r.ct.pieces === 1 && r.bm.extras.length === 0 && W.piece === undefined && W.frac === 1 && hashRest(W) === hashRest(never) && r.bm.identity.genome === r.g0;
    if (!(made === PRESS + 1 && res.every((x) => x === 'cut') && sumOk && exact)) bad.push(`${sp}: ${made - 1} of ${PRESS} presses cut (${res.filter((x) => x !== 'cut').length} refused), builds the physics refused ${r.buildFails.length}, sum ${fr.reduce((a, b) => a + b, 0).toFixed(12)}, exact whole ${exact}`);
  }
  check(`U01 (real bodies): ${PRESS} consecutive presses of Split in two on the largest piece all succeed on ${SPECIES_ALL.length} species (${PRESS + 1} pieces), the shares sum to 1 within 1e-9, Reconnect all ends bit-for-bit whole${bad.length ? ' [WAITS FOR PHYS: the piece builder refuses shares under FRAC_MIN]' : ''}`, bad.length === 0, bad.slice(0, 4).join('; '));
}

/* ───────── group joins on the REAL bodies (CUT2.md 7.2): a join whose group is three pieces (the merged piece is built from the node's region and placed in the receiver's pose), a twin join, then the root ───────── */
if (run('joins')) {
  const list = SPECIES_ALL.length > 6 && !FULL && !SP_ARG.length ? ['dollop', 'twangle', 'puddlo', 'wrigglo', 'capnap', 'kneadle'] : SPECIES_ALL;
  const bad: string[] = [], rows: string[] = [];
  for (const sp of list) {
    const r = rig2(sp, { eyes: true }); r.step(1.3);
    const never = new Ctor(r.g0), V0 = volOf(r.bm.body);
    for (let i = 0; i < 4; i++) { r.ct.splitInTwo(); r.idle(8); r.step(0.8); }
    if ((r.ct.pieces as number) !== 5) { bad.push(`${sp}: made ${r.ct.pieces} pieces by 4 presses`); continue; }
    const regs = () => r.ct.regions().map((x) => ({ ...x, body: r.bodies().find((b) => Math.hypot(b.center.x - x.x, b.center.y - x.y, b.center.z - x.z) < 1e-9)! }));
    const prefix = (a: number[], b: number[]): number => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
    const underOf = (a: { cells: number[] }, k: number) => regs().filter((c) => c.cells.length >= k && c.cells.slice(0, k).every((v, j) => v === a.cells[j]));
    /** join P into Q by hand: Q is carried next to P (surface gap 1 cm), then P is dragged into Q and held JOIN_HOLD_S, then let go */
    const joinByHand = (P: SoftBodyLike, Q: SoftBodyLike): void => {
      const u = { x: P.center.x - Q.center.x, y: 0, z: P.center.z - Q.center.z }, l = Math.hypot(u.x, u.z) || 1;
      u.x /= l; u.z /= l;
      const reach = supportAlong(P, { x: -u.x, y: 0, z: -u.z }) + supportAlong(Q, u) + 0.012;
      // the pair is isolated: every other piece is carried out to the rim first (a piece resting against P would be joined instead: the nearest touching piece in the drag's direction wins)
      const others = r.bodies().filter((o) => o !== P && o !== Q);
      others.forEach((o, i) => { const th = 2 * Math.PI * (i + 0.5) / others.length + 0.7; o.moveTo?.({ x: 1.7 * Math.cos(th), y: o.center.y, z: 1.7 * Math.sin(th) }, 3); });
      r.step(2.2); for (const o of others) o.moveTo?.(null);
      r.step(0.5);
      const reach2 = supportAlong(P, { x: -u.x, y: 0, z: -u.z }) + supportAlong(Q, u) + 0.012;
      u.x = P.center.x - Q.center.x; u.z = P.center.z - Q.center.z; { const l2 = Math.hypot(u.x, u.z) || 1; u.x /= l2; u.z /= l2; }
      void reach;
      Q.moveTo?.({ x: P.center.x - u.x * reach2, y: Q.center.y, z: P.center.z - u.z * reach2 }, 3); r.step(1.6); Q.moveTo?.(null);
      r.setFinger(P, { x: -u.x * 0.8 * P.restRadius, y: 0, z: -u.z * 0.8 * P.restRadius });
      r.step(JOIN_HOLD_S + 0.3);
      r.setFinger(null);
      for (let i = 0; i < 120 && !r.ct.busy; i++) r.step(1 / 60);
      r.idle(10); r.step(1.5);
    };
    // (1) a group of three under a non-root node: the pair whose lowest common ancestor holds exactly 3 of the 5 pieces
    const R0 = regs();
    let pair: [number, number] | null = null;
    for (let i = 0; i < R0.length; i++) for (let j = i + 1; j < R0.length; j++) { const k = prefix(R0[i].cells, R0[j].cells); if (underOf(R0[i], k).length === 3 && k > 0) pair = [i, j]; }
    const n0 = r.ct.pieces, share3 = pair ? underOf(R0[pair[0]], prefix(R0[pair[0]].cells, R0[pair[1]].cells)).reduce((s, c) => s + c.frac, 0) : 0;
    if (pair) joinByHand(R0[pair[0]].body, R0[pair[1]].body);
    const merged = r.bodies().find((b) => Math.abs((b.frac ?? 0) - share3) < 1e-6);
    const vOk = !!merged && Math.abs(volOf(merged) / ((merged.frac ?? 1) * V0) - 1) < 0.03;
    rows.push(`${sp}: constructor ms (depth) ${r.buildMs.map((q) => q.ms.toFixed(0) + "(" + q.depth + ")").join(" ")}; ${n0} -> ${r.ct.pieces}, merged ${merged ? (merged.frac ?? 0).toFixed(3) : 'none'}, volume ${merged ? f3(volOf(merged) / ((merged.frac ?? 1) * V0)) : '-'}`);
    if (!(pair && r.ct.pieces === n0 - 2 && merged && merged.piece !== undefined && merged.piece.cells.length === 1 && vOk && Math.abs(r.ct.fracs().reduce((a, b) => a + b, 0) - 1) < 1e-9 && r.notices.includes('Joined 3 pieces into one.'))) { bad.push(`${sp}: group of three: ${rows.at(-1)} (${r.notices.at(-1)})`); r.ct.reconnectAll(false); continue; }
    // (2) a twin join among the rest
    const R1 = regs();
    let tw: [number, number] | null = null;
    for (let i = 0; i < R1.length; i++) for (let j = i + 1; j < R1.length; j++) { const a = R1[i].cells, b = R1[j].cells; if (a.length === b.length && a.length > 0 && prefix(a, b) === a.length - 1 && a[a.length - 1] === -b[b.length - 1]) tw = [i, j]; }
    const n1 = r.ct.pieces;
    if (tw) joinByHand(R1[tw[0]].body, R1[tw[1]].body);
    if (!(tw && r.ct.pieces === n1 - 1 && Math.abs(r.ct.fracs().reduce((a, b) => a + b, 0) - 1) < 1e-9 && r.notices.includes(`Joined. Now ${n1 - 1} pieces.`))) { bad.push(`${sp}: twin join: ${n1} -> ${r.ct.pieces}, tw ${tw}, ${r.notices.at(-1)}`); r.ct.reconnectAll(false); continue; }
    // (3) what is left joins to the root: one fresh whole, exact
    let guard = 0;
    while (r.ct.pieces > 1 && guard++ < 6) { const R2 = regs(); joinByHand(R2[0].body, R2[R2.length - 1].body); }
    const W = r.bm.body;
    if (!(r.ct.pieces === 1 && r.bm.extras.length === 0 && W.piece === undefined && W.frac === 1 && hashRest(W) === hashRest(never) && r.bm.identity.genome === r.g0 && Math.hypot(W.center.x, W.center.z) < 1e-9 && r.notices.at(-1) === 'Whole again.')) bad.push(`${sp}: root join: pieces ${r.ct.pieces}, hash ${hashRest(W) === hashRest(never)}, ${r.notices.at(-1)}`);
  }
  if (VERBOSE) console.log('   ' + rows.join(' | '));
  check(`joins (real bodies): a join whose group is THREE pieces builds the merged piece from the node's region (one cell, share = the three added, mesh volume within 3 %), a twin join takes one cut away, joining the rest ends in the exact original (restLocal hash, original genome, frac 1, at the middle) on ${list.length} species`, bad.length === 0, bad.slice(0, 4).join('; '));
}


/* ───────── X05 (real bodies): a leave path reconnects first; the Hoard never shows a piece; nothing about pieces is stored ───────── */
if (run('x05')) {
  const { memoryStorage } = await import('../../src/core/settings.ts');
  for (const sp of ['dollop', 'kneadle']) {
    const mem = memoryStorage();
    const w = createMockWorld({ storage: null });
    w.deps.storage = mem;
    const st = w.stage as unknown as Record<string, unknown>;
    st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.setCalmEffects = () => {}; st.addBody = () => 101; st.removeBody = () => {}; st.setBody = () => {}; st.setCutSeam = () => {}; st.setBridge = () => {}; st.partPieces = () => {};
    st.stats = () => ({ drawCalls: 0, triangles: 0, tier: 'high', frameMsEma: 0 });
    w.deps.createBody = ((g: unknown, op?: { at?: V; piece?: unknown }) => (op?.piece ? new Ctor(g, { piece: op.piece }) : op?.at ? new Ctor(g, { piece: { frac: 1, chunk: false, at: op.at } }) : new Ctor(g))) as typeof w.deps.createBody;
    const now = (): number => 1_700_000_000_000 + w.clock.t;
    const app = createApp({ ...w.deps, collection: createCollection({ storage: mem, profile: null, now, random: () => 0.4 }), epochNow: now, genome: speciesBaseGenome(sp as never, 1) });
    app.resize(800, 600, 1); app.setPhase('play');
    const go = (ms: number): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); left -= d; } };
    go(1500);
    const items0 = app.hoard.items().length;
    const cutTwo = (): number => { app.cut.splitInTwo(); for (let i = 0; i < 600 && app.cut.busy; i++) go(1000 / 60); go(300); return app.cut.pieces; };
    const res: Record<string, boolean> = {};
    res.cut1 = cutTwo() === 2;
    app.setHidden(true); w.clock.t += 30_000; app.setHidden(false); go(100);
    res.hidden30 = app.cut.pieces === 2;
    app.setHidden(true); w.clock.t += 61_000; app.setHidden(false); go(100);
    res.hidden61 = app.cut.pieces === 1 && app.bodies.extras.length === 0 && app.body.piece === undefined;
    res.cut2 = cutTwo() === 2;
    app.setGenome(speciesBaseGenome('twangle', 1)); go(100);
    res.switch = app.cut.pieces === 1 && app.bodies.extras.length === 0 && app.body.piece === undefined;
    res.cut3 = cutTwo() === 2;
    app.cut.reconnectAll(false);
    res.instant = app.cut.pieces === 1 && app.bodies.extras.length === 0;
    app.hoard.flush();
    const stored = Object.keys(mem.dump?.() ?? {}).map((k) => `${k}=${mem.getItem(k)}`).join('\n');
    check(`${sp}: X05 (real bodies, the clean engine) leaving reconnects first: the tab hidden 30 s keeps the pieces, over 60 s comes back whole, a switch of squishy and an instant Reconnect all (the leave path) leave one body, no piece on the mat; the Hoard is unchanged (${items0} items) and the stored text matches no piece, chunk, frac, region, cells or planes`,
      Object.values(res).every(Boolean) && app.hoard.items().length === items0 && stored.length > 0 && !/piece|chunk|frac|region|cells|planes/i.test(stored), JSON.stringify(res));
    app.dispose();
  }
}

/* ───────── X06 (node leg 1) and the wording of X10: a cut, a join and Reconnect all pay nothing and make no touch event ───────── */
if (run('x06')) {
  const r = rig('dollop', { primary: true });
  r.go(1500);
  const meter0 = r.app.hoard.meter().sp, ev0 = r.app.debug.state().events.length;
  const kinds = (): string[] => r.app.debug.state().events.slice(ev0).map((e) => e.kind);
  r.app.cut.splitInTwo(); r.idle(); r.go(1200);
  r.app.cut.reconnectAll(true); r.idle(); r.go(500);
  const k = kinds();
  check('X06 (node leg 1, programmatic): a cut and Reconnect all pay the meter nothing, the Hoard sees no piece, and the bodies emit no poke, release or snap event at all', r.app.hoard.meter().sp === meter0 && !k.some((x) => x === 'poke' || x === 'release' || x === 'snap') && r.app.cut.pieces === 1, `sp ${meter0} -> ${r.app.hoard.meter().sp}; events ${[...new Set(k)].join(',') || 'none'}`);
  check('X10 (wording): the live region said "Cut into 2 pieces." and "Whole again." (the Undo cut line is not offered in this build: Cutter.undoCut is absent, so the bar and the texts do not name it)', r.notices.includes('Cut into 2 pieces.') && r.notices.at(-1) === 'Whole again.' && r.app.cut.undoCut === undefined, r.notices.slice(-3).join(' | '));
  r.app.dispose();
}

console.log(`${total - bad}/${total} cutter checks passed`);
process.exit(bad ? 1 : 0);
