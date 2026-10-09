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
import { JOIN_HOLD_S, MAX_PIECES_CLEAN, NECK_DEPTH, NECK_DEPTH_DEFAULT, PART_GAP, PART_GAP_DEFAULT, PART_S, PART_S_DEFAULT, createCutter, supportAlong } from '../../src/shell/cut.ts';
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

/* ───────── refusals, the limit of 2, the style lock ───────── */
if (run('refuse')) {
  const r = rig('dollop');
  r.go(1500);
  const s = r.app.host.bodyScreen()!;
  const b0 = r.app.body as SoftBodyLike & { trembles?: number };
  const small = r.app.cut.swipe(s.x + 0.9 * s.r, s.y - 1.6 * s.r, s.x + 0.9 * s.r + 3, s.y + 1.6 * s.r);
  check('a swipe that would leave a piece under 1/8 is refused with the line and nothing is replaced', (small === 'small' || small === 'miss') && r.app.cut.pieces === 1 && r.app.body === b0 && (small === 'miss' || r.notices.at(-1) === 'Too small to cut there. Try nearer the middle.'), `${small} ${r.notices.at(-1) ?? ''}`);
  const short = r.app.cut.swipe(400, 300, 410, 300);
  check('a swipe under 24 px is not a cut', short === 'short');
  const cut = r.app.cut.splitInTwo(); r.go(100);
  check('busy: a second request during the neck answers busy', r.app.cut.busy && r.app.cut.splitInTwo() === 'busy');
  r.idle(); r.go(500);
  for (let i = 2; i < MAX_PIECES_CLEAN; i++) { r.app.cut.splitInTwo(); r.idle(); r.go(500); }   // (the limit is the constant: more presses when it is above 2)
  const lim = r.app.cut.splitInTwo();
  check(`the clean limit is MAX_PIECES_CLEAN (${MAX_PIECES_CLEAN}) pieces: the next one is refused with "That's as many pieces as it can make."; canSplit false; maxPieces ${MAX_PIECES_CLEAN}`, cut === 'cut' && lim === 'limit' && r.notices.at(-1) === "That's as many pieces as it can make." && !r.app.cut.canSplit && r.app.cut.maxPieces === MAX_PIECES_CLEAN && r.app.cut.pieces === MAX_PIECES_CLEAN, `${lim}; ${r.notices.at(-1)}`);
  check('the cut style cannot change while the squishy is cut ("Reconnect first to change the cut style"); the default style is clean', r.app.cut.style === 'clean' && r.app.cut.setStyle('minis') === false && r.notices.at(-1) === 'Reconnect first to change the cut style' && !r.app.cut.canChangeStyle);
  r.app.cut.reconnectAll(false);
  check('whole again: the style can be changed', r.app.cut.canChangeStyle && r.app.cut.setStyle('minis') === true && r.app.cut.style === 'minis' && r.app.cut.maxPieces === 6);
  r.app.dispose();
}

/* ───────── CUT2.md 6.6: a piece of 0.249985 can be split (the exact half of a quarter is 0.125 +- 2.5e-6), one under 0.2498 cannot ───────── */
if (run('refuse')) {
  const { createMockBody } = await import('../mocks.ts');
  const canSplitAt = (frac: number): boolean => {
    const w = createMockWorld({ storage: null });
    const st = w.stage as unknown as Record<string, unknown>;
    st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.addBody = () => 1; st.removeBody = () => {};
    const b = createMockBody() as unknown as Record<string, unknown>;
    b.frac = frac; b.measureCut = () => 0.5; b.setNeck = () => {}; b.setFrac = () => {};
    const g = speciesBaseGenome('dollop' as never, 1);
    const bm = createBodyManager({ createBody: () => b as unknown as SoftBodyLike, stage: w.stage, initial: { body: b as unknown as SoftBodyLike, identity: { genome: g, tier: 'common', itemId: null, nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
    const ct = createCutter({
      bodies: bm, stage: w.stage, audio: w.audio, haptics: w.haptics, createBody: () => b as unknown as SoftBodyLike, quality: () => 'high', calm: () => false, gravity: () => true, simTime: () => 0, viewport: () => ({ w: 800, h: 600 }),
      activeBody: () => bm.body, touching: () => false, drag: () => false, beforeChange() {}, clearMat: () => 0, panOf: () => 0, say: () => {}, report: (e) => { throw e; },
    });
    return ct.canSplit;
  };
  check('canSplit: a piece of 0.249985 can be split (guard 2/8 - 2e-4 = 0.2498), one of 0.2497 cannot', canSplitAt(0.249985) && !canSplitAt(0.2497) && canSplitAt(0.5));
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
  for (let i = 0; i < 6; i++) { res.push(r.app.cut.splitInTwo()); r.idle(300); r.go(300); }
  const fr = r.app.cut.fracs(), all = [r.app.body, ...r.app.bodies.extras.map((x) => x.body)];
  check('Minis: five Split in two presses make six minis, the sixth press is the limit; "Cut into 6 minis."', res.slice(0, 5).every((x) => x === 'cut') && res[5] === 'limit' && r.app.cut.pieces === 6 && r.notices.includes('Cut into 6 minis.'), `${res.join()} ${fr.map(f3).join(' ')}`);
  check('Minis: every piece is a complete scaled copy (built the legacy way: no PieceInfo), shares sum to 1, none under 1/8 (a quarter splits into two eighths)', all.every((b) => b.piece === undefined) && Math.abs(fr.reduce((a, b) => a + b, 0) - 1) < 0.01 && Math.min(...fr) >= 0.124 && fr.filter((x) => x < 0.13).length >= 2);
  check('Minis: measured mesh volumes within 3 % of the share of each body (body.frac) of the whole', all.every((b) => Math.abs(volOf(b) / ((b.frac ?? 0) * V0) - 1) < 0.03), all.map((b) => f3(volOf(b) / ((b.frac ?? 0) * V0))).join(' '));
  r.go(1500);
  const ok = r.app.cut.reconnectAll(true); r.idle();
  check('Minis: Reconnect all from six ends in a FRESH whole (original genome, no piece, frac 1, nothing on the mat)', ok && r.app.cut.pieces === 1 && r.app.body.piece === undefined && r.app.body.frac === 1 && r.app.bodies.extras.length === 0 && r.app.identity.genome === r.g && r.notices.at(-1) === 'Whole again.');
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
function rig2(species: string, o: { maxClean?: number; eyes?: boolean; calm?: boolean } = {}) {
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
  let t = 0, active: SoftBodyLike | null = null, touching = false;
  const mk = (g: unknown, op?: { at?: V; piece?: unknown }): SoftBodyLike => {
    const b = op?.piece ? new Ctor(g, { piece: op.piece }) : op?.at ? new Ctor(g, { piece: { frac: 1, chunk: false, at: op.at } }) : new Ctor(g);
    const mv = b.moveTo?.bind(b);
    if (mv) (b as unknown as { moveTo: unknown }).moveTo = (p: V | null, k?: number) => { moves.push({ b, t, p: p ? { ...p } : null }); mv(p, k); };
    const sn = b.setNeck?.bind(b);
    if (sn) (b as unknown as { setNeck: unknown }).setNeck = (pl: { point: V; normal: V } | null, tt: number, depth?: number) => { if (pl) necks.push({ n: { ...pl.normal }, p: { ...pl.point } }); sn(pl as never, tt, depth); };
    return b;
  };
  const body0 = mk(g0);
  const bm = createBodyManager({ createBody: (g) => mk(g), stage: w.stage, initial: { body: body0, identity: { genome: g0, tier: 'common', itemId: 'it-1', nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
  const notices: string[] = [];
  const ct = createCutter({
    bodies: bm, stage: w.stage, audio: w.audio, haptics: w.haptics, createBody: mk, quality: () => 'high', calm: () => !!o.calm, gravity: () => true, simTime: () => t, viewport: () => ({ w: 800, h: 600 }),
    activeBody: () => active ?? bm.body, touching: () => touching, drag: () => false, beforeChange() {}, clearMat: () => 0, panOf: () => 0, say: (s) => notices.push(s), report: (e) => { throw e; }, maxClean: o.maxClean,
  });
  const step = (sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; const all = [bm.body, ...bm.extras.map((x) => x.body)]; for (const b of all) b.collide?.(all.filter((q) => q !== b)); bm.step(1 / 60); ct.update(1 / 60); } };
  const idle = (max = 6): void => { for (let i = 0; i < max * 60 && ct.busy; i++) step(1 / 60); };
  const bodies = (): SoftBodyLike[] => [bm.body, ...bm.extras.map((x) => x.body)];
  const cam = (w.stage as unknown as { camera: THREE.PerspectiveCamera }).camera;
  const proj = (p: V): { x: number; y: number } => { const v = new THREE.Vector3(p.x, p.y, p.z).project(cam); return { x: (v.x + 1) * 400, y: (1 - v.y) * 300 }; };
  /** screen radius in px of a body of rest radius R at p */
  const projR = (p: V, R: number): number => Math.abs(proj({ x: p.x + R, y: p.y, z: p.z }).x - proj(p).x);
  return { w, bm, ct, g0, eyes, moves, necks, notices, step, idle, bodies, proj, projR, setFinger(b: SoftBodyLike | null) { active = b; touching = b !== null; }, now: () => t };
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
    if (res === 'small') { refused.push(sp); r.ct.reconnectAll(false); continue; }   // the eye sits so near the edge that the plane through it leaves under 1/8: refused with a line, which is the rule, not a miss of the eye
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

/* ───────── X04 / X10 / X12: nested cuts, Reconnect all is the exact original (the test dep maxClean lifts the limit of 2) ───────── */
if (run('nested')) {
  const bad04: string[] = [], bad10: string[] = [], bad12: string[] = [];
  let worstVol = 0, vols = 0, trees = 0, cutsDone = 0;
  const seen: Record<number, number> = {};
  for (let si = 0; si < SPECIES_ALL.length; si++) {
    const sp = SPECIES_ALL[si];
    // ---- X10: five presses of Split in two reach six pieces; the sixth press says the limit line
    {
      const r = rig2(sp, { maxClean: 6, eyes: true }); r.step(1.3);
      const never = new Ctor(r.g0), V0 = volOf(r.bm.body);
      const res: string[] = [];
      for (let i = 0; i < 6; i++) { res.push(r.ct.splitInTwo()); r.idle(8); r.step(0.8); }
      const fr = r.ct.fracs();
      if (!(res.slice(0, 5).every((x) => x === 'cut') && res[5] === 'limit')) bad10.push(`${sp}: ${res.join()}`);
      else if (Math.abs(fr.reduce((a, b) => a + b, 0) - 1) > 1e-9 || Math.min(...fr) < 1 / 8 - 1e-4 || r.ct.pieces !== 6) bad10.push(`${sp}: ${fr.map(f3).join('+')}`);
      else if (r.notices.at(-1) !== "That's as many pieces as it can make.") bad10.push(`${sp}: the sixth press said "${r.notices.at(-1)}"`);
      // every piece is a leaf of one tree: six regions, one cell each, all cells distinct
      const regs = r.ct.regions();
      if (regs.length !== 6 || new Set(regs.map((x) => JSON.stringify(x.cells.slice().sort()))).size !== 6 || regs.filter((x) => x.anchor).length !== 1) bad10.push(`${sp}: regions ${JSON.stringify(regs.map((x) => x.cells))}`);
      // ---- X04 from six pieces: Reconnect all is the exact original
      const ok = r.ct.reconnectAll(true); r.idle(10); r.step(2);
      const W = r.bm.body;
      const same = ok && r.ct.pieces === 1 && r.bm.extras.length === 0 && W.piece === undefined && W.frac === 1 && r.bm.identity.genome === r.g0 && hashRest(W) === hashRest(never) && Math.hypot(W.center.x, W.center.z) < 1e-9 && Math.abs(volOf(W) / V0 - 1) < 0.005 && r.notices.at(-1) === 'Whole again.';
      if (!same) bad04.push(`${sp}: from 6: pieces ${r.ct.pieces}, piece ${W.piece === undefined ? 'undefined' : 'set'}, frac ${W.frac}, hash ${hashRest(W) === hashRest(never)}, vol ${f3(volOf(W) / V0)}, say ${r.notices.at(-1)}`);
      // ... from 2 and 4 pieces
      for (const n of [2, 4]) {
        const q = rig2(sp, { maxClean: 6 }); q.step(1.3);
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
      const r = rig2(sp, { maxClean: 6 }); r.step(1.3);
      const rnd = mulberry(1000 + si), V0 = volOf(r.bm.body);
      let made = 1;
      for (let k = 0; k < 5; k++) {
        let did = false;
        for (let tries = 0; tries < 10 && !did; tries++) {
          const cands = r.bodies().filter((b) => (b.frac ?? 1) >= 0.26);
          if (!cands.length) break;
          const tgt = cands[Math.floor(rnd() * cands.length)], c = tgt.center, Rb = tgt.restRadius * Math.cbrt(Math.max(tgt.frac ?? 1, 0.125));
          const p = r.proj(c), pr = r.projR(c, Rb) * 1.0, th = rnd() * Math.PI, off = (rnd() - 0.5) * 0.7 * pr;
          const dx = Math.cos(th), dy = Math.sin(th), px = -dy, py = dx;
          const res = r.ct.swipe(p.x + px * off - 1.7 * pr * dx, p.y + py * off - 1.7 * pr * dy, p.x + px * off + 1.7 * pr * dx, p.y + py * off + 1.7 * pr * dy);
          if (res === 'cut') { r.idle(8); r.step(1.5); did = true; cutsDone++; made++; }
          else r.step(0.4);
        }
        if (!did) break;
        const fr = r.ct.fracs();
        if (Math.abs(fr.reduce((a, b) => a + b, 0) - 1) > 1e-9 || Math.min(...fr) < 1 / 8 - 1e-4) bad12.push(`${sp}: cut ${k + 1}: ${fr.map(f3).join('+')}`);
      }
      seen[made] = (seen[made] ?? 0) + 1; trees++;
      const ps = r.bodies();
      r.step(1);
      if (VERBOSE) { const early = ps.map((b) => volOf(b) / ((b.frac ?? 1) * V0)); r.step(4); console.log(`   ${sp} volumes / share at +1 s: ${early.map(f3).join(' ')}  at +5 s: ${ps.map((b) => f3(volOf(b) / ((b.frac ?? 1) * V0))).join(' ')}`); }
      ps.forEach((b, i) => { const v = Math.abs(volOf(b) / ((b.frac ?? 1) * V0) - 1); vols++; worstVol = Math.max(worstVol, v); if (v > 0.03) bad12.push(`${sp}: piece ${i} (${f3(b.frac ?? 0)}) volume off by ${(v * 100).toFixed(1)} %`); });
      r.ct.reconnectAll(false);
    }
  }
  check(`X10: five presses of Split in two reach six pieces on ${SPECIES_ALL.length} species (the first press is the eye-midline plane), every share >= 1/8 - 1e-4 and the sum 1 (1e-9), six regions (one cell each, one anchor), the sixth press says "That's as many pieces as it can make."`, bad10.length === 0, bad10.slice(0, 3).join('; '));
  check(`X04: Reconnect all from 2, 4 and 6 pieces ends as the exact original on ${SPECIES_ALL.length} species: restLocal hash equal to a never-cut body's, the original genome object, no PieceInfo, frac 1, volume within 0.5 %, at the middle (1e-9), "Whole again."`, bad04.length === 0, bad04.slice(0, 3).join('; '));
  check(`X12: ${trees} random trees (one per species, ${cutsDone} swipes at random angles and offsets, a piece at a time, 1.5 s of parting after each; pieces made: ${JSON.stringify(seen)}): shares sum to 1 (1e-9), each >= 1/8 - 1e-4, every piece's mesh volume within 3 % of its share (worst ${(worstVol * 100).toFixed(2)} % over ${vols} pieces)`, bad12.length === 0, bad12.slice(0, FULL ? 12 : 12).join('; '));
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
