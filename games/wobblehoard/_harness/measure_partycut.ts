// D-103, the party's piece budget: the MEASURED cost per piece (R14_MULTICUT.md "Budget"). The REAL SoftBody, props, LIFE and life host (probe_partycut.ts's rig), three squishies out at
// Home, the Cut bar's Split in two up to 12 pieces. For each state (3 wholes; 3 squishies in 6, 9, 12 pieces) it times, per 60 Hz frame on this machine:
//   sim    the whole simulation step (game.stepOnce: gestures, LIFE, physics of every body with contact, the cutters)
//   phys   the physics alone (bodies.step: collide + step of every body)
// both AT REST (what sleeps is asleep) and with EVERY body kept AWAKE (each one nudged every 20 frames: the worst case, everything jiggling at once).
// The physics is the same at every quality tier (D-101), so these are the low tier's numbers too; the phone factor F of PLAYGROUND_BUILD 14.2 turns them into phone ms.
// Usage: node _harness/measure_partycut.ts   (prints a table; no pass / fail)
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


app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: CRIMPO });
app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: CAPNAP });
app.setTool('cut');
await stepA(240);
const allBodies = (): SB[] => [app.body, ...app.bodies.extras.map((x) => x.body)];
const time = (fn: () => void, n: number): number => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };
const med = (xs: number[]): number => xs.slice().sort((a, c) => a - c)[Math.floor(xs.length / 2)];
function measure(label: string): void {
  const bs = allBodies();
  // at rest
  step(180);
  const simRest = med([0, 1, 2, 3, 4].map(() => time(() => step(1), 120)));
  const physRest = med([0, 1, 2, 3, 4].map(() => time(() => app.bodies.step(1 / 60), 120)));
  const asleep = bs.filter((b) => b.metrics.asleep === true).length;
  // every body awake: a small nudge to each every 20 frames
  let f = 0;
  const awake = (): void => { if (f++ % 20 === 0) for (const b of allBodies()) { try { b.wake?.(); b.nudge({ x: 0.15 * Math.sin(f), y: 0.25, z: 0.15 * Math.cos(f) }); } catch { /* a body without it */ } } };
  for (let i = 0; i < 60; i++) { awake(); step(1); }
  const simAwake = med([0, 1, 2, 3, 4].map(() => time(() => { awake(); step(1); }, 120)));
  const physAwake = med([0, 1, 2, 3, 4].map(() => time(() => { awake(); app.bodies.step(1 / 60); }, 120)));
  const st = app.bodies.contactStats;
  console.log(`${label.padEnd(26)} bodies ${String(bs.length).padStart(2)}  asleep at rest ${String(asleep).padStart(2)}  particles ${String(bs.reduce((s2, b) => s2 + b.vertexCount, 0)).padStart(5)}  rest: sim ${simRest.toFixed(2)} phys ${physRest.toFixed(2)} ms   all awake: sim ${simAwake.toFixed(2)} phys ${physAwake.toFixed(2)} ms   contact pairs ${st.pairs}/${st.naivePairs}`);
  step(120);
}
measure('3 wholes');
for (const target of [6, 9, 12]) {
  let guard = 0;
  while (app.cut.pieces < target && guard++ < 16) { app.cut.splitInTwo(); await stepA(150); }
  measure(`3 squishies, ${app.cut.pieces} pieces`);
}
console.log('rows', JSON.stringify(rows().map((r) => [r.name, r.pieces])), 'budget', app.cut.budget, 'LIFE characters', lifeChars().length);
console.error = realError;
app.dispose();
process.exit(0);
