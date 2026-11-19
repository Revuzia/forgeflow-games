// FLOAT probe (R10_PLAYUX item 1; D-97, owner 2026-11-19: "float doesnt actually make them float" -> Float floats everyone everywhere; it replaced D-83).
// The REAL SoftBody, props, LIFE, journal and life host (the rig of node_checks section 13, trimmed), sim time only, so every row is repeatable.
//   F1 one squishy at Home: Float lifts it off the table (it used to stay glued: the tack layer held the foot, the hover only stretched it 5 cm up)
//   F2 three at Home: every body rises where it stands (the hover used to pull every body to the world origin: a party collapsed into the middle;
//      D-83 hid that by forcing the table with a party) and the party stays apart; Home's things stay shown with their colliders
//   F3 Table: everyone comes down gently (fall speed <= 1 m/s) and rests on the ground within 3 s
//   F4 a place (the cabin, and Ripple Shore by the dev path): every body rises, stays inside the place's area for 20 s, a hard shove in the air does not carry
//      it out; LIFE starts no walk while floating and its autonomy is back on Table
//   F5 feelings and voices go on while floating (emotes / voices through the host); F6 cut pieces float at their own spots
//   (round 12, R12_INTEGRATE: lanes met) F7 Float meets the crawl (D-100): a squishy crawling when Float comes on stops crawling at once and does not turn
//      while it floats; F8 Float while one squishy of a party of three is cut (D-99): every whole and every piece floats, Table brings them all down
//   (round 12) F3 / F4 Table: LIFE takes up its motion only once the party has landed and is still (later-life.ts LAND_V): it used to start a crawl walk the
//      moment a body touched down, mid landing squash, so the party never came to rest
// Usage: node _harness/probe_float.ts   (exits 1 on a failure)
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
const { loadPlaceDef } = await import('../src/data/places.ts');
const { createMockStage, createMockAudio, createMockHaptics } = await import('./mocks.ts');
const { createProfileStore } = await import('../src/core/save.ts');
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
type Dbg = { place: number; autonomy: boolean; floatParked: boolean; counts: Record<string, number>; things: Array<{ id: string; shown: boolean; parked: boolean | null }> };
const dbg = (): Dbg => host.debug() as unknown as Dbg;
const all = (): Array<{ b: SB; off: { x: number; y: number; z: number } }> => [{ b: app.body, off: { x: 0, y: 0, z: 0 } }, ...app.bodies.extras.map((x) => ({ b: x.body, off: x.position }))];
const pos = (): Array<{ x: number; y: number; z: number }> => all().map(({ b, off }) => ({ x: b.center.x + off.x, y: b.center.y + off.y, z: b.center.z + off.z }));
const f3 = (n: number): number => +n.toFixed(3);
const setFloat = (on: boolean): void => { app.setSetting('gravity', !on); };
// (the life chunk's first frames; the player is idle)
await stepA(120);

/** Float for `secs` (20 s): every body's lowest rise over its table rest, its widest horizontal drift from where it started, the closest pair, the gravity of every body */
async function floatTrial(secs = 20): Promise<{ rest: number[]; minRise: number; maxDrift: number; minPair: number; grav: boolean[]; scoot0: number; scoot1: number; floatOn: boolean }> {
  await stepA(180);
  const rest = pos();
  const scoot0 = dbg().counts.scoot ?? 0;
  setFloat(true);
  await stepA(180);
  let minRise = Infinity, maxDrift = 0, minPair = Infinity;
  for (let s = 0; s < secs; s++) {
    await stepA(60);
    const p = pos();
    p.forEach((q, i) => { minRise = Math.min(minRise, q.y - rest[i].y); maxDrift = Math.max(maxDrift, Math.hypot(q.x - rest[i].x, q.z - rest[i].z)); });
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) minPair = Math.min(minPair, Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z));
  }
  return { rest: rest.map((q) => f3(q.y)), minRise: f3(minRise), maxDrift: f3(maxDrift), minPair: f3(minPair), grav: all().map(({ b }) => b.gravity), scoot0, scoot1: dbg().counts.scoot ?? 0, floatOn: dbg().floatParked };
}
/** Table: the time until every body is back within 3 cm of its table rest and still, and the fastest fall of any body until then (after it LIFE's own hops may land faster) */
async function tableTrial(rest: number[]): Promise<{ vmin: number; tRest: number; grav: boolean[]; at: string }> {
  setFloat(false);
  let prev = pos().map((q) => q.y), vmin = 0, tRest = -1, at = '';
  for (let k = 1; k <= 300; k++) {
    step(1);
    const p = pos(), y = p.map((q) => q.y);
    if (tRest < 0) y.forEach((v, i) => { const vv = (v - prev[i]) * 60; if (vv < vmin) { vmin = vv; at = `body ${i} at ${(k / 60).toFixed(2)} s (${f3(p[i].x)}, ${f3(v)}, ${f3(p[i].z)})`; } });
    if (tRest < 0 && y.every((v, i) => Math.abs(v - rest[i]) < 0.03 && Math.abs(v - prev[i]) * 60 < 0.05)) tRest = k / 60;
    prev = y;
    if (k % 10 === 0) await tick();
  }
  return { vmin: f3(vmin), tRest, grav: all().map(({ b }) => b.gravity), at };
}

// F1: one at Home
{
  const f = await floatTrial();
  check('F1 Float, one squishy at Home: it rises off the table (>= 0.25 m over its rest, all 20 s), stays over its spot (drift <= 0.3 m), the body\'s gravity is off and the host says Float is on (LIFE autonomy off)',
    f.minRise >= 0.25 && f.maxDrift <= 0.3 && f.grav.every((g) => g === false) && f.floatOn && dbg().autonomy === false && floatCalls.includes(true), JSON.stringify(f));
  const t = await tableTrial(f.rest);
  check('F1 Table, one at Home: it comes down gently (fall <= 1.0 m/s) and rests on the table within 3 s; gravity on, LIFE autonomy back',
    t.vmin >= -1.0 && t.tRest > 0 && t.tRest <= 3 && t.grav.every((g) => g === true) && dbg().autonomy === true, JSON.stringify(t));
}
// F2 / F3: three at Home
app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-floatcrimpo1' });
app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: 'g-floatcapnap1' });
await stepA(120);
{
  const f = await floatTrial();
  const th = dbg().things.filter((x) => x.shown);
  check('F2 Float, three at Home (D-97: no longer forced to the table): every body rises (>= 0.25 m, all 20 s), each stays over where it stood (drift <= 0.35 m: no collapse into the middle), the party stays apart (closest pair >= 0.9 m), every body\'s gravity is off, LIFE starts no walk while floating',
    app.mat.count === 3 && f.minRise >= 0.25 && f.maxDrift <= 0.35 && f.minPair >= 0.9 && f.grav.every((g) => g === false) && f.scoot1 === f.scoot0, JSON.stringify(f));
  check('F2 Float at Home keeps Home\'s things where they are: those shown before stay shown, every one with a collider keeps it (not parked; the Snooze Rug has none), and the props stay bound to the stage',
    th.length >= 1 && th.filter((x) => x.parked !== null).length >= 1 && th.every((x) => x.parked !== true) && bound.count > 0 && !said.some((s) => /stand on the ground/.test(s)), JSON.stringify({ th, bound: bound.count, said: said.filter((s) => /ground/.test(s)) }));
  // F5: feelings and voices go on (60 s more floating)
  const c0 = dbg().counts, v0 = voices;
  await stepA(3600);
  const c1 = dbg().counts;
  check('F5 while floating LIFE\'s feelings and voices go on: emotes, looks or voices still reach the stage and the voice bus over 60 s with three out (only motion pauses)',
    (c1.emote - c0.emote) + (c1.voice - c0.voice) + (c1.gaze - c0.gaze) > 0 && c1.scoot === c0.scoot && c1.hop === c0.hop, JSON.stringify({ emote: c1.emote - c0.emote, voice: c1.voice - c0.voice, gaze: c1.gaze - c0.gaze, creature: voices - v0, scoot: c1.scoot - c0.scoot, hop: c1.hop - c0.hop }));
  const t = await tableTrial(f.rest);
  check('F3 Table, three at Home: everyone comes down gently (fall <= 1.0 m/s) and rests on the table within 3 s',
    t.vmin >= -1.0 && t.tRest > 0 && t.tRest <= 3 && t.grav.every((g) => g === true), JSON.stringify(t));
}
// F4: places
for (const [id, dev] of [['hearthlog', true], ['ripple', true]] as const) {
  const ok = await host.travel(id, dev);
  await stepA(240);
  const def = await loadPlaceDef(id);
  const bd = def.bounds;
  const outside = (q: { x: number; z: number }): number => (bd.shape === 'disc' ? Math.hypot(q.x - bd.x, q.z - bd.z) - (bd.r ?? 3) : Math.max(Math.abs(q.x - bd.x) - (bd.hx ?? 3), Math.abs(q.z - bd.z) - (bd.hz ?? 2.4)));
  const f = await floatTrial();
  let worst = -Infinity;
  for (const q of pos()) worst = Math.max(worst, outside(q));
  // a hard shove outward in the air (6 m/s toward the nearest edge) of the body nearest the edge: it is caught inside (or at most 0.3 m past the edge)
  const p0 = pos(); let k = 0; for (let i = 1; i < p0.length; i++) if (outside(p0[i]) > outside(p0[k])) k = i;
  const shoved = all()[k].b, ex = Math.abs(p0[k].x - bd.x) - (bd.hx ?? 3), ez = Math.abs(p0[k].z - bd.z) - (bd.hz ?? 2.4);
  shoved.nudge(ex >= ez ? { x: Math.sign(p0[k].x - bd.x || 1) * 6, y: 0, z: 0 } : { x: 0, y: 0, z: Math.sign(p0[k].z - bd.z || 1) * 6 });
  let shoveOut = -Infinity;
  for (let s = 0; s < 120; s++) { step(1); shoveOut = Math.max(shoveOut, outside(pos()[k])); if (s % 10 === 0) await tick(); }
  await stepA(300);
  for (const q of pos()) worst = Math.max(worst, outside(q));
  check(`F4 Float at ${id} with three out: every body rises (>= 0.2 m, all 20 s: the hover is restRadius + 0.35 m up, so a tall species rises less), stays inside the place's area (worst ${f3(worst)} m past the edge <= 0), the party stays apart (>= 0.6 m), LIFE starts no walk while floating`,
    ok && dbg().place !== 0 && f.minRise >= 0.2 && worst <= 0 && f.minPair >= 0.6 && f.scoot1 === f.scoot0 && f.grav.every((g) => g === false), JSON.stringify({ ok, f, worst: f3(worst) }));
  check(`F4 at ${id}: a 6 m/s shove in the air is caught by the place's bounds (at most 0.3 m past the edge, back inside 5 s later)`, shoveOut <= 0.3 && outside(pos()[k]) <= 0, `peak ${f3(shoveOut)} m, after ${f3(outside(pos()[k]))} m`);
  const t = await tableTrial(f.rest);
  check(`F4 Table at ${id}: everyone back on the ground within 3 s (fall <= 1.0 m/s) and LIFE's autonomy is back`, t.tRest > 0 && t.tRest <= 3 && t.vmin >= -1.0 && dbg().autonomy === true, JSON.stringify(t));
}
await host.travel('home'); await stepA(120);
// F6: cut pieces float at their own spots (one out: the extras go back first)
{
  app.mat.clear(); await stepA(120);
  setFloat(true); await stepA(180);
  const ok = app.cut.splitInTwo?.();
  await stepA(240);
  const ps = all().filter(({ b }) => app.cut.isPiece(b));
  const p = ps.map(({ b, off }) => ({ x: b.center.x + off.x, y: b.center.y + off.y, z: b.center.z + off.z, g: b.gravity, R: b.restRadius }));
  await stepA(300);
  const q = ps.map(({ b, off }) => ({ x: b.center.x + off.x, y: b.center.y + off.y, z: b.center.z + off.z }));
  const apart = p.length >= 2 ? Math.hypot(q[0].x - q[1].x, q[0].z - q[1].z) : 0;
  check('F6 cut while floating: the pieces float (gravity off, every piece over 0.2 m up) and keep apart at their own spots (they used to be pulled together into the world origin)',
    !!ok && p.length >= 2 && p.every((x) => x.g === false && x.y > 0.2 + 0.5 * x.R) && apart >= 0.25, JSON.stringify({ ok, pieces: p.map((x) => [f3(x.x), f3(x.y), f3(x.z)]), apart: f3(apart) }));
  app.cut.reconnectAll(false); await stepA(120);
  setFloat(false); await stepA(240);
}
// F7 (round 12): Float meets the crawl (D-100). One out at Home: a walk that crawls (the prop world's crawl on), then Float: the walk ends and the crawl lets go
// within the touch gate's time (0.15 s), and while it floats the body does not turn (its facing, the fitted rotation's +Z on the floor, moves under 2 degrees)
{
  app.mat.clear(); await stepA(120);
  const b = app.body as unknown as { crawlOn: boolean; qr: Float64Array; center: { x: number; z: number }; scootTo(x: number, z: number, v: number): boolean };
  const facing = (): number => { const q = b.qr; return Math.atan2(2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])); };
  let crawled = false;
  b.scootTo(b.center.x + 1.2, b.center.z - 0.6, 0.25);
  for (let k = 0; k < 90; k++) { step(1); if (b.crawlOn) crawled = true; if (k % 10 === 0) await tick(); }
  setFloat(true);
  let offAt = -1;
  for (let k = 1; k <= 30; k++) { step(1); if (offAt < 0 && !b.crawlOn) offAt = k / 60; }
  // (round 13, R13_FIX 6, re-specified: the owner asked that "when Float starts each squishy slowly turns to face the camera so none floats edge-on with its face
  //  hidden" (VERDICT_R12 (4a): Granulo floated edge-on 20 s). The row's "does not turn" becomes: its facing turns only TOWARD the camera's side (+Z), never away
  //  from it by more than 2 degrees, slowly (under 90 degrees a second), and faces it within 10 degrees after 4 s; the crawl part is unchanged)
  const awayZ = (): number => Math.abs(facing());   // (the facing's angle from +Z, 0..pi)
  const a0 = awayZ(); let grew = 0, crawlAgain = false, fastest = 0, last = a0;
  for (let k = 0; k < 240; k++) { step(1); if (b.crawlOn) crawlAgain = true; const a = awayZ(); grew = Math.max(grew, a - a0); fastest = Math.max(fastest, Math.abs(a - last) * 60); last = a; if (k % 10 === 0) await tick(); }
  const aEnd = awayZ();
  check('F7 Float meets the crawl (D-97 x D-100): a squishy crawling when Float comes on stops crawling within 0.15 s and never crawls again while it floats; (R13) while floating it turns slowly to face the camera (+Z): never away by over 2 degrees, under 90 degrees a second, within 10 degrees of +Z after 4 s',
    crawled && offAt > 0 && offAt <= 0.15 && !crawlAgain && grew * 180 / Math.PI < 2 && fastest * 180 / Math.PI < 90 && aEnd * 180 / Math.PI <= 10,
    JSON.stringify({ crawled, offAt: offAt > 0 ? f3(offAt) : -1, crawlAgain, startDeg: f3(a0 * 180 / Math.PI), endDeg: f3(aEnd * 180 / Math.PI), awayDeg: f3(grew * 180 / Math.PI), maxDegPerS: f3(fastest * 180 / Math.PI) }));
  setFloat(false); await stepA(240);
}
// F8 (round 12): Float while one squishy of a party of three is cut (D-99: the stroke cut the play squishy; the other two stay whole): every whole and piece
// floats (gravity off, over 0.2 m up for 10 s), and Table brings all of them down gently and to rest within 3 s
{
  app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-floatcrimpo2' });
  app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: 'g-floatcapnap2' });
  await stepA(180);
  const ok = app.cut.splitInTwo?.();
  await stepA(240);
  const rest = pos(), n = rest.length, pieces = all().filter(({ b }) => app.cut.isPiece(b)).length;
  setFloat(true); await stepA(180);
  let minRise = Infinity;
  for (let s2 = 0; s2 < 10; s2++) { await stepA(60); pos().forEach((q, i) => { minRise = Math.min(minRise, q.y - rest[i].y); }); }
  const grav = all().map(({ b }) => b.gravity);
  const t = await tableTrial(rest.map((q) => q.y));
  check('F8 Float while one of a party of three is cut (D-97 x D-99): its two pieces and the two wholes all float (gravity off, every one over 0.2 m up for 10 s); Table brings every one down gently (fall <= 1.0 m/s) and to rest within 3 s',
    !!ok && n === 4 && pieces === 2 && minRise >= 0.2 && grav.every((g) => g === false) && t.tRest > 0 && t.tRest <= 3 && t.vmin >= -1.0 && t.grav.every((g) => g === true),
    JSON.stringify({ ok, n, pieces, minRise: f3(minRise), grav, table: t }));
  app.cut.reconnectAll(false); await stepA(120);
  app.mat.clear(); await stepA(120);
}
check('no console.error during the probe', errors.length === 0, errors.slice(0, 3).map((e) => String(e[0])).join(' | '));
console.error = realError;
console.log(`\n${total - bad}/${total} float checks passed`);
app.dispose();
process.exit(bad ? 1 : 0);
