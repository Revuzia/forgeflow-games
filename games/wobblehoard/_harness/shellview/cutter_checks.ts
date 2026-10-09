// CUT-A, task S2 (first half): the Cutter (src/shell/cut.ts) on the REAL SoftBody through the whole game core (createApp), plain node, exits 1 on a failed row.
//   node _harness/shellview/cutter_checks.ts            all rows (about 2 minutes on a busy machine)
//   node _harness/shellview/cutter_checks.ts --only=a,b  sections: first, level, refuse, abort, minis, twin, primary
// Rows are about what the shell DOES (the true cut: two real pieces, the neck, the scripted parting, Reconnect all as a fresh whole; Minis: complete smaller copies); the pure tree is
// cut_checks.ts. Nothing here invents a number: sizes, offsets and shares are read from the real bodies and the physics' own plan.
import type { SoftBodyLike } from '../../src/contracts.ts';
import { createApp } from '../../src/app.ts';
import { createCollection } from '../../src/collection/index.ts';
import { speciesBaseGenome } from '../../src/data/catalog.ts';
import { familyOf } from '../../src/data/catalog.ts';
import { SoftBody } from '../../src/physics/softbody.ts';
import { createBodyManager } from '../../src/shell/bodies.ts';
import { JOIN_HOLD_S, NECK_DEPTH, NECK_DEPTH_DEFAULT, PART_GAP, PART_GAP_DEFAULT, createCutter, supportAlong } from '../../src/shell/cut.ts';
import { createMockWorld } from '../mocks.ts';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const run = (name: string): boolean => only.length === 0 || only.includes(name);
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
  const lim = r.app.cut.splitInTwo();
  check('the clean limit is 2 pieces: the third is refused with "That\'s as many pieces as it can make."; canSplit false; maxPieces 2', cut === 'cut' && lim === 'limit' && r.notices.at(-1) === "That's as many pieces as it can make." && !r.app.cut.canSplit && r.app.cut.maxPieces === 2, `${lim}; ${r.notices.at(-1)}`);
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

console.log(`${total - bad}/${total} cutter checks passed`);
process.exit(bad ? 1 : 0);
