// PARTY CUT probe, RE-SPECIFIED FOR D-103 (owner 2026-11-23: "allow ability to cut multiple squishies at the same time - now i can only cut 1 squishy at a time before being told
// to recombine to be able to cut another"). It was D-99's probe (R10_PLAYUX item 4: cut ANY ONE squishy of a party; rows C1 to C5). WHY THE ROWS CHANGED: D-103 replaces D-99's
// rule 3 ("one cut squishy at a time", refused in words) and its device (the crossed squishy became the play squishy): the old C1 (the crossed squishy becomes the play
// squishy), C3 (a stroke across another whole squishy is refused with "One squishy at a time ...") and C4 (another only after Reconnect all) asserted exactly what the owner
// asked to remove. They are replaced by M1 to M14 below; C2 (back together at its own spot) lives on in M6 / M7, C5 (one squishy out = the published cut) is kept as C5, and
// round 12's crossing rows C6 to C9 are kept (C6 only loses its "no one-at-a-time refusal" words: there is no such refusal any more).
// The REAL SoftBody, props, LIFE and life host (probe_float.ts's rig), the Cut tool driven through game.input like a mouse, sim time only.
//   M1  three out, ONE stroke across TWO of them cuts both (each into its own pieces); the third stays whole; the play squishy stays who it was; a cut sound and a line per squishy
//   M2  each cut squishy is its own piece group in LIFE (a face piece and its chunks, grouped by the slot it had as a whole); the whole one stays a whole character
//   M3  cut B while A is in pieces: a stroke across the third squishy cuts it too; nothing is refused, nothing says "one at a time"
//   M4  a piece of one squishy can be pressed, carried and tossed on its own (the Hand): every squishy keeps its pieces
//   M5  pieces of DIFFERENT squishies never merge: a piece carried into a piece of another squishy and held there 1.5 s joins nothing; the SAME drag into its own twin joins (the control)
//   M6  Reconnect ONE (Cutter.reconnect, the Cut bar's chip): only that squishy goes back together, at ITS spot; the others stay in pieces
//   M7  Reconnect all: every cut squishy whole again, each at its own spot (within 0.3 m of where it stood), apart; three whole LIFE characters
//   M8  ONE stroke across all THREE cuts all three
//   M9  Split in two (the keyboard's cut) reaches every squishy: three presses on three wholes cut three squishies
//   M10 the budget: Split in two up to the party's budget (PARTY_PIECES, 12 with three out); one more press cuts nothing and SAYS the party's line (the Cut bar shows it: cutText.isShown)
//   M11 a stroke that would pass the budget cuts WHAT FITS: at budget - 1 a stroke across several squishies cuts one, refuses the rest, and says the line ONCE
//   M12 allocation per frame with three cut squishies: the cutter's per-step path (Cutter.update: three sets, the rows, the sweep) allocates nothing
//   M13 Float floats every piece of every cut squishy; Table brings them down
//   M14 leaving: hidden 30 s keeps every set; hidden over 60 s brings every squishy back whole; a cut party member sent back to the shelf takes its pieces with it
//   M15 trophies count per cut squishy (core/achievements.ts pieces(n, busy, key)): two squishies cut = two cuts, each joined = two joins
//   M17 the Snap tool and the Hand with two squishies in pieces: tool changes reconnect nobody
//   M18 five out: the budget is 11 (LIFE's 16 slots less the five out); Split in two cuts all five
//   M16 Minis (the other cut style) with two squishies cut at once: each has its own minis; Reconnect all brings both back at their own spots
//   C5  one squishy out: the published cut (a stroke across it cuts it, its pieces rejoin at the middle)
//   (round 12, R12_INTEGRATE: the lanes of rounds 10 and 11 met; rows for where they cross)
//   C6 a right-button drag with the Cut tool while a party of three is out and one of them is in pieces turns the view (D-98) and cuts nothing, refuses nothing
//   C7 the + Friends picker (src/ui/partyPick.ts) while one squishy is in pieces: a friend comes out whole beside the pieces; Reconnect all, the friend stays out
//   C8 the + Friends picker at a place (the cabin, by the dev path): the friends that come out stand inside the place's area, apart, and are LIFE's characters
//   C9 a stroke across a squishy that is crawling (D-100) mid-walk cuts it; its pieces stay sane (no runaway: under 1.5 m/s, finite, on the table), whole again on Reconnect all
// Usage: node _harness/probe_partycut.ts   (exits 1 on a failure)
import v8 from 'node:v8';
import type { SoftBodyCtor, SoftBodyLike, StageLike } from '../src/contracts.ts';
import { createApp } from '../src/app.ts';
import { memoryStorage } from '../src/core/settings.ts';
import { speciesBaseGenome } from '../src/data/catalog.ts';
import { createCollection } from '../src/collection/index.ts';
import { recorder } from './mocks.ts';

let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const errors: unknown[][] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { errors.push(a); };

const THREE = await import('three');
const { SoftBody } = await import('../src/physics/softbody.ts');
const { attachLifeHost } = await import('../src/shell/later-life.ts');
const lifeParts = { attachJournal: (await import('../src/shell/later-quests.ts')).attachJournal, buildPropWorld: (await import('../src/shell/later-props.ts')).buildPropWorld };
const { createMockStage, createMockAudio, createMockHaptics } = await import('./mocks.ts');
const { createProfileStore } = await import('../src/core/save.ts');
const { bringFriends, toggleOut } = await import('../src/ui/partyPick.ts');
const { loadPlaceDef } = await import('../src/data/places.ts');
type SB = SoftBodyLike;
const W = 1280, H = 800;
const st = createMockStage() as ReturnType<typeof createMockStage> & Record<string, unknown>;
const cam = st.camera as InstanceType<typeof THREE.PerspectiveCamera>;
cam.fov = 35; cam.aspect = W / H; cam.near = 0.1; cam.far = 200;
{ const dd = Math.max(3.0, 2.4 / (W / H)), pitch = 0.27; cam.position.set(0, 0.42 + dd * Math.sin(pitch) + 1.2, dd * Math.cos(pitch) + 2.5); cam.lookAt(0, 0.42, -0.6); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); }
let viewId = 100, primary = 1;
const views = new Map<number, SB>();
const log = recorder();
const floatCalls: boolean[] = [];
Object.assign(st, {
  primaryBodyId: () => primary,
  setPrimaryBody: (vid: number) => { if (views.has(vid)) primary = vid; },   // (the real stage re-points its primary view: bodies.exchange / promote)
  setBody: (b: SB) => { views.clear(); primary = ++viewId; views.set(primary, b); },
  addBody: (b: SB) => { const vid = ++viewId; views.set(vid, b); return vid; },
  removeBody: (vid: number) => { views.delete(vid); },
  setBodyTier: () => {},
  setFloatMode: (on: boolean) => { floatCalls.push(!!on); },
  matLayout: (n: number) => [[0, 0], [1.3, 0], [-1.3, 0], [2.6, 0], [-2.6, 0]].slice(0, Math.max(1, Math.min(5, n))).map(([x, z]) => ({ x, y: 0, z })),
  visibleTable: (out: Float32Array) => { out[0] = -3.0; out[1] = -2.6; out[2] = 3.0; out[3] = 0.9; return true; },
  stats: () => ({ drawCalls: 0, triangles: 0, tier: 'high', frameMsEma: 0 }),
  emote: () => {}, clearEmote: () => {}, emoteScreen: (_k: number, o: Float32Array) => { o[0] = 600; o[1] = 300; o[2] = 20; return true; },
  loadPlace: async () => true, setPlace: () => true,
  dropCapsule: (o?: { onLand?: () => void }) => { const c = { landed: false, removed: false }; setTimeout(() => { c.landed = true; o?.onLand?.(); }, 0);
    return { id: 1, get landed() { return c.landed && !c.removed; }, screenPoint: () => (c.landed && !c.removed ? { x: 700, y: 400, r: 40 } : null), hitTest: () => false, setSqueeze: () => {}, wobble: () => {}, remove: () => { c.removed = true; } }; },
});
let bound: { poses: Float32Array | null; count: number } = { poses: null, count: 0 };
st.bindProps = (poses: Float32Array | null, count: number) => { bound = { poses, count }; };
for (const k of ['setHomeThing', 'setAutonomyFraming', 'setBodyPose', 'setBodyGaze', 'setBodyExpression', 'setBodyLook', 'setBodyAsleep', 'setKeepsakes', 'setObstacles', 'setHeatPoint', 'setPlayBounds', 'thingFx']) st[k] = (...a: unknown[]) => log.rec(k, ...a);
const v3 = new THREE.Vector3();
const proj = (x: number, y: number, z: number): { x: number; y: number } | null => { v3.set(x, y, z).project(cam); return Math.abs(v3.x) > 1 || Math.abs(v3.y) > 1 ? null : { x: (v3.x * 0.5 + 0.5) * W, y: (0.5 - v3.y * 0.5) * H }; };
st.bodyScreenPoint = (vid: number, out: Float32Array) => { const b = views.get(vid); const p = b ? proj(b.center.x, b.center.y, b.center.z) : null; if (!p) return false; out[0] = p.x; out[1] = p.y; out[2] = 40; return true; };
const audio = createMockAudio() as ReturnType<typeof createMockAudio> & Record<string, unknown>;
let voices = 0;
audio.creature = () => { voices++; return true; };
for (const k of ['setTouching', 'autoThud', 'prop', 'musicBox', 'setAmbience', 'setMusicStyle']) audio[k] = (...a: unknown[]) => log.rec('a.' + k, ...a);
audio.loadAmbience = async () => true;
const mem = memoryStorage();
let clockT = 1000;
const devSkew = { ms: 0 };
const profile = createProfileStore(mem);
const coll = createCollection({ storage: mem, profile: profile.profile, now: () => 1_700_000_000_000 + clockT + devSkew.ms, random: () => 0.4 });
const app = createApp({
  createBody: (g, o) => (o?.piece ? new (SoftBody as unknown as SoftBodyCtor)(g, { piece: o.piece }) : o?.at ? new (SoftBody as unknown as SoftBodyCtor)(g, { piece: { frac: 1, chunk: false, at: o.at } }) : new SoftBody(g)),
  createStage: () => st as unknown as StageLike, createAudio: () => audio as unknown as ReturnType<typeof createMockAudio>, haptics: createMockHaptics(), storage: mem, collection: coll, profile, devSkew,
  env: { vibrate: false, reducedMotion: false }, now: () => clockT, epochNow: () => 1_700_000_000_000 + clockT, raf: () => 0, caf: () => {},
});
app.resize(W, H, 1); app.setPhase('play');
const said: string[] = [];
const host = attachLifeHost(app, { parts: lifeParts, storage: mem, say: (t) => said.push(t), moment: (t) => said.push('MOMENT ' + t), setTimer: () => 0, clearTimer: () => {} })!;
const step = (n: number): void => { for (let i = 0; i < n; i++) { clockT += 1000 / 60; app.clock.advance?.(1000 / 60); app.stepOnce(1 / 60); } };
const stepA = async (n: number): Promise<void> => { for (let i = 0; i < n; i += 10) { step(10); await tick(); } };
void host; void recorder; void floatCalls; void log;
const notices: string[] = [];
app.on('notice', (t) => notices.push(t));
await stepA(120);
const ox = { x: 0, y: 0, z: 0 };
/** every squishy out as the player sees it: the play squishy and the mat's squishies (a cut one stands for itself by its anchor piece) */
const squishies = (): Array<{ id: string | null; b: SB }> => [{ id: app.identity.itemId, b: app.body }, ...app.bodies.extras.filter((x) => !x.piece).map((x) => ({ id: x.itemId, b: x.body }))];
const wholes = (): Array<{ id: string | null; x: number; z: number; b: SB }> => squishies().filter((q) => !app.cut.isPiece(q.b)).map((q) => ({ id: q.id, x: q.b.center.x, z: q.b.center.z, b: q.b }));
const rows = (): Array<{ key: string; play: boolean; name: string; pieces: number; busy: boolean }> => (app.cut.sets ?? []).map((r) => ({ key: r.key, play: r.play, name: r.name, pieces: r.pieces, busy: r.busy }));
const piecesOf = (key: string | null): number => rows().find((r) => r.key === (key ?? ''))?.pieces ?? 1;
/** the bodies of one squishy now: its anchor (or whole) first, then its other pieces */
const bodiesOf = (id: string | null): SB[] => {
  const play = id === app.identity.itemId;
  const anchor = play ? app.body : app.bodies.extras.find((x) => !x.piece && x.itemId === id)?.body;
  const rest = app.bodies.extras.filter((x) => x.piece && (play ? x.of === undefined : x.of === id)).map((x) => x.body);
  return anchor ? [anchor, ...rest] : rest;
};
const pc = (b: SB): { x: number; y: number } => proj(b.center.x, b.center.y, b.center.z)!;
const rPx = (b: SB): number => { const r = b.restRadius * Math.cbrt(Math.max(1e-6, b.frac ?? 1)), a = proj(b.center.x, b.center.y, b.center.z)!, q = proj(b.center.x + r, b.center.y, b.center.z); return q ? Math.abs(q.x - a.x) : 60; };
async function stroke(x0: number, y0: number, x1: number, y1: number, steps = 240): Promise<void> {
  app.input.pointerDown({ id: 7, x: x0, y: y0, t: clockT, type: 'mouse', button: 0 });
  app.input.pointerMove({ id: 7, x: (x0 + x1) / 2, y: (y0 + y1) / 2, t: clockT, type: 'mouse' });
  app.input.pointerUp({ id: 7, x: x1, y: y1, t: clockT, type: 'mouse' });
  await stepA(steps);
}
/** a mouse stroke across body b (vertical on screen through its centre, 240 px long) with the Cut tool */
async function strokeAcross(b: SB): Promise<void> { const p = pc(b); await stroke(p.x, p.y - 120, p.x + 8, p.y + 120); }
/** ONE straight mouse stroke through the centres of several bodies (from 80 px before the first to 80 px past the last, left to right) */
async function strokeThrough(bs: SB[]): Promise<{ off: number }> {
  const pts = bs.map(pc).sort((a, c) => a.x - c.x), a = pts[0], z = pts[pts.length - 1];
  const L = Math.hypot(z.x - a.x, z.y - a.y) || 1, ux = (z.x - a.x) / L, uy = (z.y - a.y) / L;
  let off = 0;
  for (const p of pts) off = Math.max(off, Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux));   // how far the farthest centre is from the line (px)
  await stroke(a.x - 80 * ux, a.y - 80 * uy, z.x + 80 * ux, z.y + 80 * uy);
  return { off };
}
const minGap = (): number => { const w = wholes(); let m = Infinity; for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) m = Math.min(m, Math.hypot(w[i].x - w[j].x, w[i].z - w[j].z)); return m; };
const f3 = (n: number): number => +n.toFixed(3);
type LChar = { slot: number; kind: number; group: number; itemId: string | null };
const lifeChars = (): LChar[] => (host.debug() as { chars: LChar[] }).chars;
const sounds = { start: 0, separate: 0, rejoin: 0 };
audio.cut = (p: { phase: string }) => { if (p.phase === 'start') sounds.start++; else if (p.phase === 'separate') sounds.separate++; };
audio.rejoin = () => { sounds.rejoin++; };
const { PARTY_PIECES } = await import('../src/shell/later-cut.ts');
const T = await import('../src/shell/cutText.ts');
const CRIMPO = 'g-pcutcrimpo1', CAPNAP = 'g-pcutcapnap1';

app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: CRIMPO });
app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: CAPNAP });
app.setTool('cut');   // (LIFE is quiet with a tool in hand: the three stay on their spots)
await stepA(180);
const play0 = app.identity.itemId;
const spot = new Map<string | null, { x: number; z: number }>();
const noteSpot = (id: string | null): void => { const b = bodiesOf(id)[0]; spot.set(id, { x: b.center.x, z: b.center.z }); };
for (const id of [play0, CRIMPO, CAPNAP]) noteSpot(id);
const offOf = (id: string | null): number => { const w = wholes().find((q) => q.id === id), s0 = spot.get(id)!; return w ? Math.hypot(w.x - s0.x, w.z - s0.z) : Infinity; };

// M1: one stroke across two
{
  const n0 = notices.length, s0 = { ...sounds };
  const g = await strokeThrough([app.body, bodiesOf(CRIMPO)[0]]);
  const said1 = notices.slice(n0);
  const m1 = { play: app.identity.itemId, rows: rows(), total: app.cut.pieces, out: app.mat.count, capnapWhole: !app.cut.isPiece(bodiesOf(CAPNAP)[0]) && bodiesOf(CAPNAP).length === 1, starts: sounds.start - s0.start, parts: sounds.separate - s0.separate, off: f3(g.off) };
  check('M1 three out: ONE stroke across Dollop (the play squishy) and Crimpo cuts BOTH, each into its own 2 pieces (4 pieces in all); Capnap stays whole; the play squishy is still Dollop; three out; a cut sound and a "Cut <name> into 2 pieces." line for each',
    m1.play === play0 && piecesOf(play0) === 2 && piecesOf(CRIMPO) === 2 && m1.total === 4 && m1.out === 3 && m1.capnapWhole && m1.starts === 2 && m1.parts === 2 && said1.filter((t) => /^Cut \w+ into 2 pieces\.$/.test(t)).length === 2,
    JSON.stringify({ ...m1, said: said1 }));
  // M2
  const ch = lifeChars();
  const grp = (id: string | null): { face: number; chunks: number; groups: number } => { const mine = ch.filter((c) => c.itemId === id && c.kind !== 0); return { face: mine.filter((c) => c.kind === 1).length, chunks: mine.filter((c) => c.kind === 2).length, groups: new Set(mine.map((c) => c.group)).size }; };
  const gp = grp(play0), gc = grp(CRIMPO), wholeCap = ch.filter((c) => c.itemId === CAPNAP && c.kind === 0).length;
  const keyP = ch.find((c) => c.itemId === play0 && c.kind === 1)?.group, keyC = ch.find((c) => c.itemId === CRIMPO && c.kind === 1)?.group;
  check('M2 LIFE: each cut squishy is its own piece group (one face piece and one chunk each, two different group keys, neither key a live slot); Capnap is still one whole character; nobody else',
    gp.face === 1 && gp.chunks === 1 && gp.groups === 1 && gc.face === 1 && gc.chunks === 1 && gc.groups === 1 && keyP !== keyC && keyP !== undefined && keyC !== undefined && !ch.some((c) => c.slot === keyP || c.slot === keyC) && wholeCap === 1 && ch.length === 5,
    JSON.stringify({ gp, gc, keyP, keyC, chars: ch.map((c) => [c.slot, c.kind, c.group, c.itemId]) }));
}
// M3: cut B while A is in pieces
{
  const n0 = notices.length;
  await strokeAcross(bodiesOf(CAPNAP)[0]);
  const said3 = notices.slice(n0);
  check('M3 while Dollop and Crimpo are in pieces, a stroke across Capnap cuts Capnap too (6 pieces in all, three squishies cut); nothing is refused: no "One squishy at a time", no budget line',
    piecesOf(CAPNAP) === 2 && piecesOf(play0) === 2 && piecesOf(CRIMPO) === 2 && app.cut.pieces === 6 && !said3.some((t) => /One squishy at a time|most at once|lot of pieces/.test(t)) && app.identity.itemId === play0,
    JSON.stringify({ rows: rows(), said: said3 }));
}
// M4: a piece of one squishy pressed, carried, tossed with the Hand
{
  app.setTool('hand');
  const c2 = bodiesOf(CRIMPO)[1], p = pc(c2), r = rPx(c2);
  let fingers = 0, carried = false;
  app.input.pointerDown({ id: 3, x: p.x + 0.1 * r, y: p.y - 0.3 * r, t: clockT, type: 'mouse', button: 0 }); step(6);
  fingers = c2.metrics.fingers;
  for (let k = 1; k <= 30; k++) { app.input.pointerMove({ id: 3, x: p.x + 0.1 * r + k * 5, y: p.y - 0.3 * r - k * 9, t: clockT, type: 'mouse' }); step(2); if (c2.metrics.carried === true) carried = true; }
  const lifted = c2.center.y;
  app.input.pointerUp({ id: 3, x: p.x + 0.1 * r + 150, y: p.y - 0.3 * r - 270, t: clockT, type: 'mouse', button: 0 });
  await stepA(180);
  check('M4 with the Hand, a piece of Crimpo (not the play squishy) is pressed (a finger on it), carried up (lifted over 0.25 m) and let go: every squishy keeps its 2 pieces, nothing joined',
    (fingers > 0 || carried) && carried && lifted > 0.25 && piecesOf(CRIMPO) === 2 && piecesOf(play0) === 2 && piecesOf(CAPNAP) === 2 && app.cut.pieces === 6, JSON.stringify({ fingers, carried, lifted: f3(lifted), rows: rows() }));
}
// M5: pieces of different squishies never merge (and the same drag into its own twin does)
{
  /** press piece `a` a little toward `to`, carry it into `to` (X15's recipe: the press 0.1 radius toward the other, the hand ends 0.15 radius short of the other's centre), hold, let go */
  const dragInto = async (a: SB, to: SB, hold: number): Promise<{ busy: boolean }> => {
    const pa = pc(a), pt = pc(to), ra = rPx(a), rt = rPx(to), L = Math.hypot(pt.x - pa.x, pt.y - pa.y) || 1, ux = (pt.x - pa.x) / L, uy = (pt.y - pa.y) / L;
    const fx = pa.x + ux * 0.1 * ra, fy = pa.y + uy * 0.1 * ra - 0.1 * ra, tx = pt.x - ux * 0.15 * rt, ty = pt.y - uy * 0.15 * rt - 0.1 * ra;
    let busy = false;
    app.input.pointerDown({ id: 3, x: fx, y: fy, t: clockT, type: 'mouse', button: 0 }); step(8);
    const K = Math.max(36, Math.ceil(L / 8));
    for (let k = 1; k <= K; k++) { app.input.pointerMove({ id: 3, x: fx + (tx - fx) * k / K, y: fy + (ty - fy) * k / K, t: clockT, type: 'mouse' }); step(2); if (app.cut.busy) busy = true; }
    for (let k = 0; k < hold; k++) { step(1); if (app.cut.busy) busy = true; if (k % 10 === 0) await tick(); }
    app.input.pointerUp({ id: 3, x: tx, y: ty, t: clockT, type: 'mouse', button: 0 });
    for (let k = 0; k < 180; k++) { step(1); if (app.cut.busy) busy = true; if (k % 10 === 0) await tick(); }
    return { busy };
  };
  const n0 = notices.length;
  // a piece of Capnap into the nearest piece of the play squishy
  const cap2 = bodiesOf(CAPNAP)[1];
  const near = bodiesOf(play0).slice().sort((a, c) => Math.hypot(a.center.x - cap2.center.x, a.center.z - cap2.center.z) - Math.hypot(c.center.x - cap2.center.x, c.center.z - cap2.center.z))[0];
  const d0 = Math.hypot(near.center.x - cap2.center.x, near.center.z - cap2.center.z);
  const cross = await dragInto(cap2, near, 90);
  const d1 = Math.hypot(near.center.x - cap2.center.x, near.center.z - cap2.center.z);
  const crossRows = rows(), crossSaid = notices.slice(n0);
  check('M5 a piece of Capnap carried INTO a piece of Dollop and held there 1.5 s joins nothing (it really got there: under 0.6 m from it, from over 0.8 m): no join plays, every squishy still has its 2 pieces, no "Joining" / "Joined" line',
    d0 > 0.8 && d1 < 0.6 && !cross.busy && piecesOf(CAPNAP) === 2 && piecesOf(play0) === 2 && piecesOf(CRIMPO) === 2 && !crossSaid.some((t) => /Join|Whole again|whole again/.test(t)), JSON.stringify({ d0: f3(d0), d1: f3(d1), ...cross, rows: crossRows, said: crossSaid }));
  // the control: the same drag, the same piece, into its OWN twin
  const own = await dragInto(bodiesOf(CAPNAP)[1], bodiesOf(CAPNAP)[0], 90);
  await stepA(240);
  check('M5 control: the same drag of that piece into its OWN twin joins them (a join plays; Capnap is whole again, the other two still in 2 pieces)', own.busy && piecesOf(CAPNAP) === 1 && piecesOf(play0) === 2 && piecesOf(CRIMPO) === 2, JSON.stringify({ ...own, rows: rows() }));
  app.setTool('cut');
}
// M6: Reconnect one
{
  const n0 = notices.length;
  const did = app.cut.reconnect?.(CRIMPO, true);
  await stepA(300);
  const said6 = notices.slice(n0);
  check('M6 Reconnect ONE (the Cut bar\'s chip): Crimpo goes back together at ITS spot (within 0.3 m of where it stood), Dollop stays in its 2 pieces; "Whole again." is said',
    did === true && piecesOf(CRIMPO) === 1 && offOf(CRIMPO) <= 0.3 && piecesOf(play0) === 2 && app.cut.pieces === 2 && said6.some((t) => /hole again\./.test(t)) && lifeChars().filter((c) => c.itemId === CRIMPO && c.kind === 0).length === 1,
    JSON.stringify({ did, off: f3(offOf(CRIMPO)), rows: rows(), said: said6 }));
}
// M7: Reconnect all, each at its own spot
{
  // A clean start (M4 and M5 carried pieces about with the Hand, so pieces of one squishy lie on another's spot: a whole that comes back onto another squishy's pieces is pushed off them, which is
  // physics, not the rule under test): everyone whole at once, then each cut by its own stroke. LIFE sends the most curious whole over to look at a fresh cut (LIFE 9), so each squishy's spot is
  // noted right before its own stroke; a stroke cuts every squishy it crosses, so the row needs every squishy in 2 pieces or more, not exactly 2.
  app.cut.reconnectAll(false); await stepA(120);
  for (const id of [play0, CRIMPO, CAPNAP]) { noteSpot(id); await strokeAcross(bodiesOf(id)[0]); }
  const before = rows().map((r) => r.pieces), r0 = sounds.rejoin;
  // (push one of Crimpo's pieces a metre away first: it must come back to Crimpo's spot, not stay there and not go to the middle)
  { const far = bodiesOf(CRIMPO)[1]; try { far.placeAt?.({ x: far.center.x + 0.9, y: far.center.y + 0.05, z: far.center.z + 0.5 }, { x: 0, y: 0, z: 0 }, far.frame); } catch { /* a body without placeAt */ } await stepA(60); }
  const did = app.cut.reconnectAll(true);
  await stepA(420);
  const offs = [play0, CRIMPO, CAPNAP].map((id) => f3(offOf(id)));
  const ch = lifeChars();
  check('M7 Reconnect all with three squishies in pieces: every one is whole again at ITS OWN spot (each within 0.3 m of where it stood, never into another at the middle), three wholes at least 0.6 m apart, no piece left on the mat, three whole LIFE characters, a rejoin sound per squishy',
    did && before.every((n) => n >= 2) && before.length === 3 && app.cut.pieces === 1 && wholes().length === 3 && offs.every((d) => d <= 0.3) && minGap() >= 0.6 && !app.bodies.extras.some((x) => x.piece) && app.mat.count === 3 && ch.length === 3 && ch.every((c) => c.kind === 0) && sounds.rejoin - r0 === 3,
    JSON.stringify({ before, offs, gap: f3(minGap()), extras: app.bodies.extras.length, chars: ch.map((c) => [c.slot, c.kind, c.itemId]), rejoins: sounds.rejoin - r0 }));
}
// M8: one stroke across all three
{
  for (const id of [play0, CRIMPO, CAPNAP]) noteSpot(id);
  const s0 = sounds.start;
  const g = await strokeThrough([app.body, bodiesOf(CRIMPO)[0], bodiesOf(CAPNAP)[0]]);
  const groups = new Set(lifeChars().filter((c) => c.kind !== 0).map((c) => c.group)).size;
  check('M8 ONE stroke across all THREE squishies cuts all three (2 pieces each, 6 in all, three cut sounds), the play squishy unchanged; LIFE has three piece groups',
    piecesOf(play0) === 2 && piecesOf(CRIMPO) === 2 && piecesOf(CAPNAP) === 2 && app.cut.pieces === 6 && sounds.start - s0 === 3 && app.identity.itemId === play0 && groups === 3, JSON.stringify({ rows: rows(), starts: sounds.start - s0, groups, off: f3(g.off) }));
  app.cut.reconnectAll(false); await stepA(90);
}
// M9: Split in two reaches every squishy
{
  const res: string[] = [];
  for (let k = 0; k < 3; k++) { res.push(app.cut.splitInTwo()); await stepA(150); }
  check('M9 Split in two (the keyboard\'s cut) halves the biggest piece out: three presses with three wholes out cut all three squishies (2 pieces each), the play squishy first',
    res.every((r) => r === 'cut') && piecesOf(play0) === 2 && piecesOf(CRIMPO) === 2 && piecesOf(CAPNAP) === 2 && app.cut.pieces === 6, JSON.stringify({ res, rows: rows() }));
}
// M11 (before M10: it needs budget - 1 pieces) and M10: the budget
{
  const B = app.cut.budget ?? -1;
  const res: string[] = [];
  while (app.cut.pieces < B - 1 && res.length < 12) { res.push(app.cut.splitInTwo()); await stepA(150); }
  const at = app.cut.pieces, n0 = notices.length;
  // one stroke across every squishy: a level line through the middle of everything that is out
  const all = [play0, CRIMPO, CAPNAP].flatMap((id) => bodiesOf(id)).map(pc), ys = all.map((p) => p.y).sort((a, c) => a - c), y = ys[Math.floor(ys.length / 2)];
  const xs = all.map((p) => p.x);
  await stroke(Math.min(...xs) - 120, y, Math.max(...xs) + 120, y + 2, 300);
  const said11 = notices.slice(n0), lines = said11.filter((t) => T.isShown(t));
  check(`M11 the party's budget is ${PARTY_PIECES} pieces with three out; at ${B - 1} pieces ONE stroke across the squishies cuts WHAT FITS (one more piece: ${B} in all), refuses the rest, and says the party's line ONCE ("${T.partyFull(B)}"), a line the Cut bar shows (cutText.isShown)`,
    B === PARTY_PIECES && at === B - 1 && app.cut.pieces === B && lines.length === 1 && lines[0] === T.partyFull(B), JSON.stringify({ B, at, now: app.cut.pieces, said: said11, rows: rows() }));
  const n1 = notices.length;
  const r10 = app.cut.splitInTwo(); await stepA(150);
  const said10 = notices.slice(n1);
  const n2 = notices.length;
  await stroke(Math.min(...xs) - 120, y, Math.max(...xs) + 120, y + 2, 300);
  const said10b = notices.slice(n2).filter((t) => T.isShown(t));
  check(`M10 at the budget (${B} pieces across three cut squishies) Split in two cuts nothing and answers 'limit' with the party's line; a stroke across all of them cuts nothing and says it once; canSplit is false, maxPieces is the budget; every squishy still out`,
    r10 === 'limit' && app.cut.pieces === B && said10.filter((t) => T.isShown(t)).length === 1 && said10b.length === 1 && app.cut.canSplit === false && app.cut.maxPieces === B && app.mat.count === 3 && rows().filter((r) => r.pieces > 1).length === 3,
    JSON.stringify({ r10, now: app.cut.pieces, said: said10, stroke: said10b, canSplit: app.cut.canSplit, max: app.cut.maxPieces, rows: rows() }));
}
// M12: allocation per frame with three cut squishies
/** new-space growth of 1000 calls of fn, 8 windows, after 20000 warm calls (LF-02's method; a window with a GC is negative). In a function: a loop in this module's top-level code is never optimised and boxes numbers itself. */
const newUsed = (): number => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
function allocOf(fn: () => void): number[] {
  for (let k = 0; k < 20000; k++) fn();
  const base: number[] = []; for (let k = 0; k < 6; k++) { const u0 = newUsed(); base.push(newUsed() - u0); }
  const b0 = base[5], wins: number[] = [];
  for (let wdw = 0; wdw < 8; wdw++) { const u0 = newUsed(); for (let k = 0; k < 1000; k++) fn(); wins.push(newUsed() - u0 - b0); }
  return wins;
}
const cutUpdate = (): void => { app.cut.update(1 / 60); };
{
  await stepA(240);
  const wins = allocOf(cutUpdate), pos = wins.filter((d) => d >= 0);
  check(`M12 allocation per frame with three cut squishies (${app.cut.pieces} pieces): the cutter's per-step path (three sets' update, the rows, the sweep) allocates 0 B (new-space growth per 1000 steps: ${wins.join(', ')} B; a window with a GC is negative)`,
    rows().filter((r) => r.pieces > 1).length === 3 && pos.length >= 3 && pos.filter((d) => d <= 64).length >= pos.length - 1, `max ${Math.max(...pos)} B`);
  // the frame cost (printed for the report, R14_MULTICUT "Budget"): the whole sim step with three squishies in pieces
  const t0 = performance.now(); step(240); const ms = (performance.now() - t0) / 240;
  console.log(`     (info) sim step with 3 squishies in ${app.cut.pieces} pieces, node on this machine: ${ms.toFixed(2)} ms`);
}
// M13: Float with several cut
{
  const ps = (): SB[] => [play0, CRIMPO, CAPNAP].flatMap((id) => bodiesOf(id));
  const y0 = ps().map((b) => b.center.y);
  app.setSetting('gravity', false);
  await stepA(360);
  const rise = ps().map((b, i) => b.center.y - y0[i]);
  app.setSetting('gravity', true);
  await stepA(300);
  const down = ps().map((b) => b.center.y);
  check('M13 Float with three squishies in pieces: EVERY piece rises (each at least 0.12 m over where it rested) and all are still pieces of their own squishy; Table brings every piece down again',
    rise.length === app.cut.pieces && rise.every((d) => d >= 0.12) && down.every((v, i) => v < y0[i] + 0.12) && rows().filter((r) => r.pieces > 1).length === 3, JSON.stringify({ rise: rise.map(f3), down: down.map(f3) }));
}
// M14: leaving
{
  const n = app.cut.pieces;
  app.setHidden(true); clockT += 30_000; app.setHidden(false); await stepA(30);
  const short = app.cut.pieces;
  app.setHidden(true); clockT += 61_000; app.setHidden(false); await stepA(60);
  const long = { pieces: app.cut.pieces, wholes: wholes().length, extras: app.bodies.extras.length, offs: [play0, CRIMPO, CAPNAP].map((id) => f3(offOf(id))), stored: Object.values(mem.dump()).filter((v) => /"(piece|pieces|chunk|cutNormal|region|cells|planes)"/.test(v)).length };
  check('M14 leaving with three squishies in pieces: a tab hidden 30 s keeps every piece; hidden over 60 s brings EVERY squishy back whole (three wholes, each at its own spot, no piece left on the mat); nothing about pieces is ever stored',
    short === n && long.pieces === 1 && long.wholes === 3 && long.extras === 2 && long.offs.every((d) => d <= 0.3) && long.stored === 0, JSON.stringify({ n, short, long }));
  // a cut party member sent back to the shelf takes its pieces with it
  await strokeAcross(app.body); await strokeAcross(bodiesOf(CRIMPO)[0]);
  const b4 = { play: piecesOf(play0), crimpo: piecesOf(CRIMPO) };
  app.mat.remove(CRIMPO); await stepA(30);
  const left = app.bodies.extras.filter((x) => x.of === CRIMPO || x.itemId === CRIMPO).length;
  check('M14 a party member in pieces that is sent back to the shelf takes ALL its pieces with it (none left on the mat); the play squishy keeps its pieces; the mat counts two out',
    b4.play === 2 && b4.crimpo === 2 && left === 0 && piecesOf(play0) === 2 && piecesOf(CRIMPO) === 1 && app.mat.count === 2 && app.cut.pieces === 2, JSON.stringify({ b4, left, rows: rows(), out: app.mat.count }));
  app.cut.reconnectAll(false); await stepA(60);
}
// M15: trophies per cut squishy
{
  const { createEvaluator, emptyAchSave } = await import('../src/core/achievements.ts');
  const save = emptyAchSave(0);
  const ev = createEvaluator({ save, now: () => 1, onUnlock: () => {} });
  const feed = (p: [number, boolean], m?: [number, boolean]): void => { ev.pieces(p[0], p[1]); if (m) ev.pieces(m[0], m[1], 'member'); };
  feed([1, true]); feed([2, false], [1, true]); feed([2, false], [2, false]);      // the play squishy is cut, then a party member
  const cuts = save.counters.cuts;
  feed([2, true], [2, true]); feed([1, false], [2, true]); feed([1, false], [1, false]);   // both join (animated), one after the other
  const joins = save.counters.joins;
  feed([1, false]); feed([1, false], [1, true]); feed([1, false], [2, false]);       // the member is cut again (its stream starts fresh)
  check('M15 trophies count per cut squishy: the play squishy and a party member cut at the same time are TWO cuts, each put back together is a join (two joins), and the member cut again is a third cut',
    cuts === 2 && joins === 2 && save.counters.cuts === 3, JSON.stringify({ cuts, joins, after: save.counters.cuts }));
}
// M17: the Snap tool (a photo) and the Hand with two squishies in pieces: changing tools reconnects nobody
{
  await strokeThrough([app.body, bodiesOf(CAPNAP)[0]]);
  const b4 = [piecesOf(play0), piecesOf(CAPNAP)];
  app.setTool('snap'); await stepA(60);
  const snap = [piecesOf(play0), piecesOf(CAPNAP)];
  app.setTool('hand'); await stepA(60);
  const hand = [piecesOf(play0), piecesOf(CAPNAP)];
  app.setTool('cut'); await stepA(30);
  check('M17 two squishies in pieces, then the Snap tool (a photo) and the Hand: every squishy keeps its pieces through the tool changes (leaving a tool reconnects nobody); back with the Cut tool they are still cut',
    b4.every((n) => n >= 2) && String(snap) === String(b4) && String(hand) === String(b4) && app.cut.pieces === b4[0] + b4[1], JSON.stringify({ b4, snap, hand, total: app.cut.pieces }));
  app.cut.reconnectAll(false); await stepA(60);
}
// M16: Minis with two squishies cut
{
  for (const id of [play0, CAPNAP]) noteSpot(id);
  const set = app.cut.setStyle('minis');
  const n0 = notices.length;
  await strokeThrough([app.body, bodiesOf(CAPNAP)[0]]);
  const cutM = { play: piecesOf(play0), capnap: piecesOf(CAPNAP), fr: app.cut.fracs().map(f3), locked: app.cut.canChangeStyle === false, said: notices.slice(n0) };
  // a third cut on the play squishy alone (its own minis), then everything back
  await strokeAcross(bodiesOf(play0).slice().sort((a, c) => (c.frac ?? 1) - (a.frac ?? 1))[0]);
  const more = { play: piecesOf(play0), capnap: piecesOf(CAPNAP) };
  app.cut.reconnectAll(true); await stepA(420);
  const offs = [play0, CAPNAP].map((id) => f3(offOf(id)));
  const back = app.cut.setStyle('clean');
  check('M16 Minis (the other cut style) with two squishies out: one stroke across both makes two minis of each (each pair\'s shares sum to 1; "Cut <name> into 2 minis." twice), the style is locked while they are cut, a further stroke across one of Dollop\'s minis cuts Dollop again (3 minis; Capnap keeps its own), and Reconnect all makes both whole again at their own spots; the style changes back',
    set === true && cutM.play === 2 && cutM.capnap === 2 && cutM.fr.length === 4 && Math.abs(cutM.fr[0] + cutM.fr[1] - 1) < 0.01 && Math.abs(cutM.fr[2] + cutM.fr[3] - 1) < 0.01 && cutM.locked && cutM.said.filter((t) => /^Cut \w+ into 2 minis\.$/.test(t)).length === 2
    && more.play === 3 && more.capnap >= 2 && app.cut.pieces === 1 && wholes().length === 2 && offs.every((d) => d <= 0.3) && !app.bodies.extras.some((x) => x.piece) && back === true && app.cut.style === 'clean',
    JSON.stringify({ set, cutM, more, offs, pieces: app.cut.pieces, wholes: wholes().length, back }));
}
// M18: five out (the high tier's cap): the budget follows LIFE's room, and Split in two still reaches everyone
{
  const b2 = app.cut.budget;   // (Dollop + Capnap)
  app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-pcutcrimpo18' });
  app.mat.add({ genome: speciesBaseGenome('wisplet', 5), itemId: 'g-pcutwisp18' });
  const b4 = app.cut.budget;
  app.mat.add({ genome: speciesBaseGenome('twangle', 6), itemId: 'g-pcuttwang18' });
  await stepA(180);
  const b5 = app.cut.budget, out5 = app.mat.count;
  const res: string[] = [];
  for (let k = 0; k < 5; k++) { res.push(app.cut.splitInTwo()); await stepA(150); }
  const cutN = rows().filter((r) => r.pieces > 1).length, chars = lifeChars().length;
  app.cut.reconnectAll(false); await stepA(90);
  check('M18 the budget follows LIFE\'s room: 12 pieces with two and with four out, 11 with five out (16 character slots less the squishies out); with five out, five presses of Split in two cut all five squishies (10 pieces, 10 LIFE characters), and Reconnect all (at once) leaves five wholes',
    b2 === 12 && b4 === 12 && b5 === 11 && out5 === 5 && res.every((r) => r === 'cut') && cutN === 5 && chars === 10 && app.cut.pieces === 1 && wholes().length === 5 && !app.bodies.extras.some((x) => x.piece),
    JSON.stringify({ b2, b4, b5, out5, res, cutN, chars, wholes: wholes().length }));
}
// C5 one out: the published path
app.mat.clear(); await stepA(120);
app.setTool('hand'); app.setTool('cut');
await strokeAcross(app.body);
const one = app.cut.pieces;
app.cut.reconnectAll(false); await stepA(60);
check('C5 one squishy out: a stroke across it cuts it (the published cut) and Reconnect all makes it whole', one === 2 && app.cut.pieces === 1 && app.mat.count === 1 && app.cut.budget === null, `pieces ${one}`);
{
  // (D-103: the party cutter rides on every step of the published toy too: with ONE squishy out, whole, its per-step path must allocate nothing)
  const wins = allocOf(cutUpdate), pos = wins.filter((d) => d >= 0);
  check(`C5 one squishy out, whole: the cutter's per-step path with the party cutter installed allocates 0 B (per 1000 steps: ${wins.join(', ')} B)`, pos.length >= 3 && pos.filter((d) => d <= 64).length >= pos.length - 1, `max ${Math.max(...pos)} B`);
}
app.setTool('hand');
// ---- round 12 (R12_INTEGRATE): where the lanes cross ----
/** a picker game on the REAL mat and identity (the picker's choices only read the hoard; what it does goes through app.mat as the Friends strip's does) */
type PG = Parameters<typeof bringFriends>[0];
const hoardOf = (ids: Array<[string, string]>): PG['hoard'] => {
  const items = ids.map(([id, sp], k) => ({ id, species: sp, name: sp[0].toUpperCase() + sp.slice(1), fav: false, genome: speciesBaseGenome(sp as Parameters<typeof speciesBaseGenome>[0], 3 + k), tier: 'common' })) as unknown as ReturnType<PG['hoard']['items']>;
  return { items: () => items, item: (id: string) => items.find((x) => x.id === id) ?? null };
};
const pg = (ids: Array<[string, string]>): PG => ({ identity: app.identity, mat: app.mat, hoard: hoardOf(ids), history: { recent: () => [] } }) as unknown as PG;
// C6: a right drag while cutting, with a party and one of them in pieces
{
  app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-pcutcrimpo6' });
  app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: 'g-pcutcapnap6' });
  await stepA(180);
  app.setTool('cut');
  await strokeAcross(app.body);
  const p0 = app.cut.pieces, o0 = (st as unknown as { rec: { count(k: string): number } }).rec.count('orbit'), n0 = notices.length;
  const other = app.bodies.extras.find((x) => x.itemId === 'g-pcutcapnap6')!;
  const q = proj(other.body.center.x + other.position.x, other.body.center.y, other.body.center.z + other.position.z)!;
  app.input.pointerDown({ id: 9, x: q.x - 120, y: q.y, t: clockT, type: 'mouse', button: 2 });
  for (let k = 1; k <= 8; k++) { app.input.pointerMove({ id: 9, x: q.x - 120 + k * 30, y: q.y + k * 2, t: clockT, type: 'mouse' }); step(2); }
  app.input.pointerUp({ id: 9, x: q.x + 120, y: q.y + 16, t: clockT, type: 'mouse', button: 2 });
  await stepA(120);
  const o1 = (st as unknown as { rec: { count(k: string): number } }).rec.count('orbit');
  // (RE-SPECIFIED for D-103, 2026-11-23: the row's words "no one at a time refusal" are gone with D-99's refusal; what it asserts is unchanged: the view turns, nothing is cut, nothing is said)
  check('C6 (round 12; D-98 x a party cut) with the Cut tool, three out and Dollop in pieces, a right-button drag across Capnap turns the view (orbit) and cuts nothing: the same pieces, Capnap whole, nothing said',
    p0 === 2 && o1 > o0 && app.cut.pieces === p0 && !app.cut.isPiece(other.body) && notices.length === n0, JSON.stringify({ p0, orbits: o1 - o0, pieces: app.cut.pieces, notices: notices.slice(n0) }));
  // C7: + Friends while one squishy is in pieces
  app.setTool('hand');
  app.mat.remove('g-pcutcapnap6'); await stepA(60);
  const n7 = app.mat.count, pieces7 = app.cut.pieces;
  const r = toggleOut(pg([['g-pcutwisp7', 'wisplet']]), hoardOf([['g-pcutwisp7', 'wisplet']]).items()[0]);
  await stepA(180);
  const wisp = app.bodies.extras.find((x) => x.itemId === 'g-pcutwisp7');
  const whole7 = !!wisp && !wisp.piece && !app.cut.isPiece(wisp.body), stillPieces = app.cut.pieces === pieces7;
  app.cut.reconnectAll(true); await stepA(300);
  check('C7 (round 12; the + Friends picker x a cut) while Dollop is in pieces, a friend tapped in the picker comes out whole (the pieces stay pieces); Reconnect all makes Dollop whole and the friend stays out',
    r.out && r.refused === null && whole7 && stillPieces && app.mat.count === n7 + 1 && app.cut.pieces === 1 && app.mat.has('g-pcutwisp7'), JSON.stringify({ r, whole7, stillPieces, count: app.mat.count, n7, pieces: app.cut.pieces }));
  app.mat.clear(); await stepA(120);
}
// C8: + Friends at a place (the cabin)
{
  const ok = await host.travel('hearthlog', true);
  await stepA(240);
  const def = await loadPlaceDef('hearthlog');
  const bd = def.bounds;
  const r = bringFriends(pg([['g-pcutcrimpo8', 'crimpo'], ['g-pcutcapnap8', 'capnap']]));
  await stepA(300);
  const w = wholes(), out = w.map((q) => Math.max(Math.abs(q.x - bd.x) - (bd.hx ?? 3), Math.abs(q.z - bd.z) - (bd.hz ?? 2.4)));
  const party = (host.partyNow?.() ?? []).map((x: { itemId: string | null }) => x.itemId);
  check('C8 (round 12; the + Friends picker x a place) in the cabin, "Bring friends" brings two (the mat\'s count 3); every squishy stands inside the cabin\'s area, at least 0.6 m apart, and both friends are LIFE\'s characters there',
    ok && r.came.length === 2 && app.mat.count === 3 && out.every((v) => v <= 0) && minGap() >= 0.6 && party.includes('g-pcutcrimpo8') && party.includes('g-pcutcapnap8'),
    JSON.stringify({ ok, came: r.came, why: r.why, worst: f3(Math.max(...out)), gap: f3(minGap()), party }));
  app.mat.clear(); await stepA(60);
  await host.travel('home'); await stepA(180);
}
// C9: a stroke across a squishy mid-crawl
{
  const b = app.body as unknown as SB & { crawlOn: boolean; scootTo(x: number, z: number, v: number): boolean };
  let crawled = false;
  b.scootTo(b.center.x + 1.2, b.center.z - 0.5, 0.25);
  // (the stroke comes while the crawl is on: the first frame 0.4 s into the walk with the wave running)
  for (let k = 0; k < 180 && !(crawled && k >= 24); k++) { step(1); crawled = b.crawlOn; if (k % 10 === 0) await tick(); }
  const wasCrawling = b.crawlOn;
  app.setTool('cut');
  await strokeAcross(app.body);
  const pieces = app.cut.pieces;
  const ps = () => app.bodies.extras.filter((x) => x.piece).map((x) => ({ b: x.body, off: x.position })).concat(app.cut.isPiece(app.body) ? [{ b: app.body, off: ox }] : []);
  let vmax = 0, finite = true, low = Infinity; const prev = ps().map(({ b: q, off }) => ({ x: q.center.x + off.x, z: q.center.z + off.z }));
  for (let k = 0; k < 120; k++) { step(1); ps().forEach(({ b: q, off }, i) => { const x = q.center.x + off.x, z = q.center.z + off.z; if (!Number.isFinite(x + z + q.center.y)) finite = false; if (prev[i]) { vmax = Math.max(vmax, Math.hypot(x - prev[i].x, z - prev[i].z) * 60); prev[i] = { x, z }; } low = Math.min(low, q.center.y); }); if (k % 10 === 0) await tick(); }
  app.cut.reconnectAll(true); await stepA(300);
  check('C9 (round 12; D-100 x the cut) a stroke across Dollop while it crawls mid-walk cuts it in two; its pieces stay sane for 2 s (finite, under 1.5 m/s, on the table), and Reconnect all makes it whole',
    crawled && wasCrawling && pieces === 2 && finite && vmax < 1.5 && low > 0 && app.cut.pieces === 1, JSON.stringify({ crawled, wasCrawling, pieces, finite, vmax: f3(vmax), low: f3(low), after: app.cut.pieces }));
  app.setTool('hand');
}
check('no console.error during the probe', errors.length === 0, errors.slice(0, 3).map((e) => String(e[0])).join(' | '));
console.error = realError;
console.log(`\n${total - bad}/${total} party cut checks passed`);
app.dispose();
process.exit(bad ? 1 : 0);
