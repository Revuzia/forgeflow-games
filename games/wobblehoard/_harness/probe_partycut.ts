// PARTY CUT probe (R10_PLAYUX item 4; D-99, owner 2026-11-19: "if i have multiple squishies out i should be able to cut any/all of them"). The REAL SoftBody, props, LIFE
// and life host (probe_float.ts's rig), the Cut tool driven through game.input like a mouse, sim time only.
//   C1 three out: a stroke across a squishy that is NOT the play one cuts THAT one (it becomes the play squishy where it stands; nobody is rebuilt or moved; the other two stay whole)
//   C2 its pieces are its own: Reconnect all gives it back whole at ITS spot (not into the squishy at the middle); everyone else whole, apart
//   C3 while one is cut, a stroke across another whole squishy is refused in words ("One squishy at a time ...") and cuts nothing
//   C4 after Reconnect all a stroke across the third squishy cuts it (any of them, one at a time)
//   C5 one squishy out: the published cut (a stroke across it cuts it, its pieces rejoin at the middle)
//   (round 12, R12_INTEGRATE: the lanes of rounds 10 and 11 met; rows for where they cross)
//   C6 a right-button drag with the Cut tool while a party of three is out and one of them is in pieces turns the view (D-98) and cuts nothing, refuses nothing
//   C7 the + Friends picker (src/ui/partyPick.ts) while one squishy is in pieces (D-99): a friend comes out whole beside the pieces; Reconnect all, the friend stays out
//   C8 the + Friends picker at a place (the cabin, by the dev path): the friends that come out stand inside the place's area, apart, and are LIFE's characters
//   C9 a stroke across a squishy that is crawling (D-100) mid-walk cuts it; its pieces stay sane (no runaway: under 1.5 m/s, finite, on the table), whole again on Reconnect all
// Usage: node _harness/probe_partycut.ts   (exits 1 on a failure)
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
const wholes = (): Array<{ id: string | null; x: number; z: number; b: SB }> => [{ id: app.identity.itemId, b: app.body, off: ox }, ...app.bodies.extras.filter((x) => !x.piece).map((x) => ({ id: x.itemId, b: x.body, off: x.position }))]
  .map((e) => ({ id: e.id, x: e.b.center.x + e.off.x, z: e.b.center.z + e.off.z, b: e.b }));
/** a mouse stroke across body b (vertical on screen through its centre, 240 px long) with the Cut tool */
async function strokeAcross(b: SB): Promise<void> {
  const p = proj(b.center.x, b.center.y, b.center.z)!;
  app.input.pointerDown({ id: 7, x: p.x, y: p.y - 120, t: clockT, type: 'mouse', button: 0 });
  app.input.pointerMove({ id: 7, x: p.x + 4, y: p.y, t: clockT, type: 'mouse' });
  app.input.pointerUp({ id: 7, x: p.x + 8, y: p.y + 120, t: clockT, type: 'mouse' });
  await stepA(240);
}
const minGap = (): number => { const w = wholes(); let m = Infinity; for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) m = Math.min(m, Math.hypot(w[i].x - w[j].x, w[i].z - w[j].z)); return m; };
const f3 = (n: number): number => +n.toFixed(3);

app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-pcutcrimpo1' });
app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: 'g-pcutcapnap1' });
await stepA(180);
app.setTool('cut');
const play0 = app.identity.itemId;
const crimpo = app.bodies.extras.find((x) => x.itemId === 'g-pcutcrimpo1')!;
const at0 = { x: crimpo.body.center.x, z: crimpo.body.center.z };
const dollop0 = app.body;
// C1
await strokeAcross(crimpo.body);
const c1 = { play: app.identity.itemId, pieces: app.cut.pieces, out: app.mat.count, dollopOut: app.bodies.extras.some((x) => x.body === dollop0 && !x.piece), capnapWhole: app.bodies.extras.some((x) => x.itemId === 'g-pcutcapnap1' && !x.piece) };
check('C1 three out: a stroke across Crimpo (not the play squishy) cuts Crimpo: it is the play squishy now, in 2 pieces; Dollop (the play squishy before) stays out whole, its own body; Capnap stays whole',
  c1.play === 'g-pcutcrimpo1' && c1.pieces === 2 && c1.dollopOut && c1.capnapWhole && play0 !== c1.play, JSON.stringify(c1));
// C3
const capnap = app.bodies.extras.find((x) => x.itemId === 'g-pcutcapnap1')!;
const n3 = notices.length;
await strokeAcross(capnap.body);
check('C3 while Crimpo is cut, a stroke across Capnap cuts nothing and says why in words ("One squishy at a time: Reconnect all, then cut another.")',
  app.cut.pieces === 2 && app.identity.itemId === 'g-pcutcrimpo1' && notices.slice(n3).some((t) => /One squishy at a time/.test(t)), JSON.stringify(notices.slice(n3)));
// C2
app.cut.reconnectAll(true);
await stepA(300);
const cw = wholes().find((w) => w.id === 'g-pcutcrimpo1')!;
check('C2 Reconnect all gives Crimpo back whole at ITS spot (within 0.3 m of where it stood), never into Dollop at the middle; three wholes out, at least 0.6 m apart',
  app.cut.pieces === 1 && !!cw && Math.hypot(cw.x - at0.x, cw.z - at0.z) <= 0.3 && wholes().length === 3 && minGap() >= 0.6, JSON.stringify({ at0, now: cw && [f3(cw.x), f3(cw.z)], gap: f3(minGap()), n: wholes().length }));
// C4
const cap2 = app.bodies.extras.find((x) => x.itemId === 'g-pcutcapnap1')!;
await strokeAcross(cap2.body);
const c4 = { play: app.identity.itemId, pieces: app.cut.pieces };
app.cut.reconnectAll(true); await stepA(300);
check('C4 then a stroke across Capnap cuts Capnap (any of them, one at a time), and it goes back together whole; three wholes out, apart',
  c4.play === 'g-pcutcapnap1' && c4.pieces === 2 && app.cut.pieces === 1 && wholes().length === 3 && minGap() >= 0.6, JSON.stringify({ c4, gap: f3(minGap()) }));
// C5 one out: the published path
app.mat.clear(); await stepA(120);
app.setTool('hand'); app.setTool('cut');
await strokeAcross(app.body);
const one = app.cut.pieces;
app.cut.reconnectAll(false); await stepA(60);
check('C5 one squishy out: a stroke across it cuts it (the published cut) and Reconnect all makes it whole', one === 2 && app.cut.pieces === 1 && app.mat.count === 1, `pieces ${one}`);
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
  check('C6 (round 12; D-98 x D-99) with the Cut tool, three out and Dollop in pieces, a right-button drag across Capnap turns the view (orbit) and cuts nothing: the same pieces, Capnap whole, no "one at a time" refusal',
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
  check('C7 (round 12; the + Friends picker x D-99) while Dollop is in pieces, a friend tapped in the picker comes out whole (the pieces stay pieces); Reconnect all makes Dollop whole and the friend stays out',
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
