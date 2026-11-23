// CARRY probe (round 14, R14_CARRY, owner decision D-105: "make it easier to pick up and move squishies around"). The REAL SoftBody, props, LIFE and the life host
// (probe_partycut.ts's rig, copied), the Hand driven through game.input like a mouse or fingers, sim time only. Rows:
//   K1  Home, three out (a room): a press on the MIDDLE of a squishy dragged up the frame picks it up at once (no stretch), lifts it a little, takes it BACK
//       across the floor on the level plane, and a slow let go sets it down where it hung (no snap)
//   K2  Home, ONE out: the published toy (no carry rule: the same drag is the published rub; carryOn false; the gesture line is the published one)
//   K3  the forgiving grab: a press 10 px outside a squishy's silhouette takes it (a carry); 45 px outside does not
//   K4  two fingers carry two squishies at once (the second finger on another squishy: the host's hand), both set down where they hung
//   K5  a place (Ripple Shore): ONE carry from the front left to the back right of the room (>= 5 m) ends within 0.5 m of the spot
//   K6  passing OVER a thing: a squishy carried across Rainleaf's Moss Bouncer rises over it (its lowest point never under the pad's top while over it) and a
//       slow let go over the pad drops it ON the pad: the pad kicks it (it rises again after landing)
//   K7  Float: a floater is carried >= 1 m and stays where it is put (3 s later within 0.2 m), still floating
//   K8  "Drag to carry" is shown ONCE (a moment), stored; the gesture pill reads the room line in a room and the published line at Home alone
//   E1  the edge scroll (render/roomcam.ts RoomCam, the director's own code): a CARRIED squishy at the back edge of the frame scrolls the view back; the same
//       squishy resting there (no hand) does not
// Usage: node _harness/probe_carry.ts   (exits 1 on a failure)
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

const f3 = (n: number): number => +n.toFixed(3);
/** a world point on the screen, not clipped to the frame (the node rig's camera is fixed: a far spot may be outside it; the pointer goes there all the same) */
const projU = (x: number, y: number, z: number): { x: number; y: number } => { v3.set(x, y, z).project(cam); return { x: (v3.x * 0.5 + 0.5) * W, y: (0.5 - v3.y * 0.5) * H }; };

const { HINT_TEXT, createHintController } = await import('../src/ui/hint.ts');
const { CARRY_TIP, CARRY_TIP_KEY, HINT_ROOM } = await import('../src/shell/later-carry.ts');
const snaps = (): number => app.recentEvents().filter((e) => e.kind === 'snap').length;
const lowest = (b: SB): number => { const P = b.positions; let m = 1e9; for (let i = 1; i < P.length; i += 3) m = Math.min(m, P[i]); return m; };
const carryOn = (): boolean => (app.host as unknown as { carryOn?(): boolean }).carryOn?.() === true;
let pid = 50;
/** one carry by a pointer: press at (x, y), drag to (x1, y1) in n moves (a frame each), hold `hold` frames, let go; returns what the body did */
async function drag(b: SB, x: number, y: number, x1: number, y1: number, o: { n?: number; hold?: number; type?: 'mouse' | 'touch'; id?: number; keep?: boolean } = {}): Promise<{ id: number; liftAt: number; lowMax: number; held: { x: number; z: number }; snaps: number }> {
  const id = o.id ?? ++pid, type = o.type ?? 'mouse', n = o.n ?? 20;
  app.input.pointerDown({ id, x, y, button: 0, type });
  step(1);
  let liftAt = -1, lowMax = -1;
  for (let i = 1; i <= n; i++) {
    app.input.pointerMove({ id, x: x + ((x1 - x) * i) / n, y: y + ((y1 - y) * i) / n, type });
    step(1);
    if (liftAt < 0 && b.metrics.carried === true) liftAt = i;
    if (b.metrics.carried === true) lowMax = Math.max(lowMax, lowest(b));
  }
  for (let i = 0; i < (o.hold ?? 40); i++) { step(1); if (b.metrics.carried === true) lowMax = Math.max(lowMax, lowest(b)); }
  const held = { x: b.center.x, z: b.center.z }, s0 = snaps();
  if (!o.keep) { app.input.pointerUp({ id, x: x1, y: y1, type }); }
  return { id, liftAt, lowMax, held, snaps: s0 };
}
const settle = async (n = 180): Promise<void> => { await stepA(n); };
const moved = (a: { x: number; z: number }, b: SB): number => Math.hypot(b.center.x - a.x, b.center.z - a.z);

// ---- K2 first: Home with ONE squishy out is the published toy ----
{
  const b = app.body, p = pc(b), z0 = b.center.z;
  const on = carryOn();
  const r = await drag(b, p.x, p.y, p.x, p.y - 160);
  await settle(90);
  const hint = createHintController(); hint.interact(0);
  check('K2 Home, ONE squishy out: the published toy: no carry rule (carryOn false); a press on its middle dragged up the frame is the published rub (never carried, nothing moves back); the gesture line is the published one',
    !on && r.liftAt < 0 && Math.abs(b.center.z - z0) < 0.3 && createHintController().line('touch') === HINT_TEXT.touch, JSON.stringify({ carryOn: on, liftAt: r.liftAt, dz: f3(b.center.z - z0) }));
}

// ---- three out at Home: a room ----
app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-carry-crimpo' });
app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: 'g-carry-capnap' });
await stepA(240);
const ext = (id: string): SB => app.bodies.extras.find((x) => x.itemId === id)!.body;
// K1
{
  const b = ext('g-carry-crimpo'), p = pc(b), z0 = b.center.z, s0 = snaps();
  const on = carryOn();
  const r = await drag(b, p.x, p.y, p.x - 40, p.y - 150);
  const hz = r.held.z;
  await settle(150);
  const after = snaps() - s0;
  check('K1 Home, three out (a room): a press on the MIDDLE dragged up the frame picks it up at once (carried within 2 moves), lifts it a little (lowest point 0.04 .. 0.4 m up), takes it BACK across the floor (>= 1 m); a slow let go sets it down where it hung (within 0.3 m), no snap',
    on && r.liftAt >= 1 && r.liftAt <= 2 && r.lowMax >= 0.04 && r.lowMax <= 0.4 && z0 - hz >= 1 && moved(r.held, b) <= 0.3 && after === 0,
    JSON.stringify({ carryOn: on, liftAt: r.liftAt, low: f3(r.lowMax), back: f3(z0 - hz), drift: f3(moved(r.held, b)), snaps: after }));
}
// K3
{
  const b = ext('g-carry-capnap'), p = pc(b), r0 = rPx(b);
  const near = await drag(b, p.x + r0 + 10, p.y, p.x + r0 + 70, p.y - 60);
  await settle(120);
  const b2 = ext('g-carry-capnap'), p2 = pc(b2), r2 = rPx(b2);
  // (45 px outside, on the side away from everybody else)
  const far = await drag(b2, p2.x + r2 + 45, p2.y, p2.x + r2 + 105, p2.y - 60);
  await settle(120);
  check('K3 the forgiving grab: a press 10 px outside a squishy\'s silhouette takes it (carried); 45 px outside does not', near.liftAt > 0 && far.liftAt < 0, JSON.stringify({ rPx: Math.round(r0), near: near.liftAt, far: far.liftAt }));
}
// K4
{
  const a = ext('g-carry-crimpo'), b = ext('g-carry-capnap'), pa = pc(a), pb = pc(b);
  app.input.pointerDown({ id: 801, x: pa.x, y: pa.y, button: 0, type: 'touch' }); step(1);
  app.input.pointerMove({ id: 801, x: pa.x + 20, y: pa.y - 10, type: 'touch' }); step(2);
  app.input.pointerDown({ id: 802, x: pb.x, y: pb.y, button: 0, type: 'touch' }); step(1);
  const a0 = { x: a.center.x, z: a.center.z }, b0 = { x: b.center.x, z: b.center.z };
  let both = 0;
  for (let i = 1; i <= 24; i++) {
    app.input.pointerMove({ id: 801, x: pa.x + 20 - i * 4, y: pa.y - 10 - i * 5, type: 'touch' });
    app.input.pointerMove({ id: 802, x: pb.x + i * 5, y: pb.y - i * 4, type: 'touch' });
    step(1);
    if (a.metrics.carried === true && b.metrics.carried === true) both++;
  }
  step(40);
  const ha = { x: a.center.x, z: a.center.z }, hb = { x: b.center.x, z: b.center.z };
  app.input.pointerUp({ id: 801, x: pa.x - 76, y: pa.y - 130, type: 'touch' }); app.input.pointerUp({ id: 802, x: pb.x + 120, y: pb.y - 96, type: 'touch' });
  await settle(150);
  check('K4 two fingers carry TWO squishies at once (the second finger on another squishy): both in the hand together, both moved >= 0.6 m, both set down where they hung (within 0.3 m)',
    both >= 15 && moved(a0, a) >= 0.6 && moved(b0, b) >= 0.6 && moved(ha, a) <= 0.3 && moved(hb, b) <= 0.3,
    JSON.stringify({ bothFrames: both, movedA: f3(moved(a0, a)), movedB: f3(moved(b0, b)), driftA: f3(moved(ha, a)), driftB: f3(moved(hb, b)) }));
}
// K9 a NAPPING squishy (physics asleep, as the awake budget or a nap puts it) is picked up the same way
{
  const b = ext('g-carry-crimpo');
  // (the rest test passes only at rest with no driver: LIFE is quieted by the Snap tool for a moment, then the Hand comes back with the squishy asleep)
  app.setTool('snap'); await stepA(60);
  let slept = false;
  for (let k = 0; k < 300 && !slept; k++) { step(1); slept = b.sleep?.() === true; }
  app.setTool('hand'); step(1);
  slept = slept && b.metrics.asleep === true;
  const p = pc(b), z0 = b.center.z;
  const r = await drag(b, p.x, p.y, p.x, p.y - 120);
  await settle(120);
  check('K9 a napping squishy (asleep) is picked up by the same drag (carried once the drag passes the 14 px slop) and moved back', slept && r.liftAt >= 1 && r.liftAt <= 3 && z0 - r.held.z >= 0.8, JSON.stringify({ slept, liftAt: r.liftAt, back: f3(z0 - r.held.z) }));
}
// K8 (Home with three out was the first room: the tip once; the pill line in a room)
{
  const tips = said.filter((t) => t === 'MOMENT ' + CARRY_TIP).length;
  const c = createHintController(); c.interact(0); c.toolTried();
  check('K8a "Drag to carry" is shown once (a moment) the first time squishies can be carried, and stored; the gesture pill reads the room line in a room',
    tips === 1 && mem.getItem(CARRY_TIP_KEY) === '1' && createHintController().line('touch') === HINT_ROOM.touch && createHintController().line('pointer') === HINT_ROOM.pointer, JSON.stringify({ tips, stored: mem.getItem(CARRY_TIP_KEY) }));
}
// ---- K5: a place, ONE carry across the room ----
{
  const ok = await host.travel('ripple', true);
  await stepA(240);
  const { PLACE: RIPPLE } = await import('../src/data/place_ripple.ts');
  const B = RIPPLE.bounds as { x: number; z: number; hx: number; hz: number };
  const bs = [app.body, ...app.bodies.extras.filter((x) => !x.piece).map((x) => x.body)];
  const b = bs.reduce((a, c) => (c.center.z - c.center.x > a.center.z - a.center.x ? c : a));
  const tx = B.x + B.hx - 1.6, tz = B.z - B.hz + 1.4;
  const from = { x: b.center.x, z: b.center.z }, p = pc(b), t = proj(tx, 0, tz);
  // the finger goes to where the spot is on the screen, then the player steers so the squishy hangs over it
  let r = { liftAt: -1 } as { liftAt: number };
  if (p && t) {
    const id = ++pid;
    app.input.pointerDown({ id, x: p.x, y: p.y, button: 0, type: 'mouse' }); step(1);
    let px = p.x, py = p.y, lift = -1;
    for (let k = 0; k < 240; k++) {
      const s = projU(b.center.x, 0, b.center.z), tt = projU(tx, 0, tz);
      const ax = b.metrics.carried === true ? px + (tt.x - s.x) : tt.x, ay = b.metrics.carried === true ? py + (tt.y - s.y) : tt.y;
      const dx = ax - px, dy = ay - py, L = Math.hypot(dx, dy);
      if (L < 3) { step(2); continue; }
      const sp = Math.min(16, L); px += (dx / L) * sp; py += (dy / L) * sp;
      app.input.pointerMove({ id, x: px, y: py, type: 'mouse' }); step(2);
      if (lift < 0 && b.metrics.carried === true) lift = k;
    }
    app.input.pointerUp({ id, x: px, y: py, type: 'mouse' });
    r = { liftAt: lift };
  }
  await settle(180);
  const d = Math.hypot(b.center.x - tx, b.center.z - tz), span = Math.hypot(tx - from.x, tz - from.z);
  check('K5 a place (Ripple Shore): ONE carry takes the squishy that stands most to the front left to the back right (>= 5 m across the floor) and it rests within 0.5 m of the spot',
    ok && r.liftAt >= 0 && span >= 5 && d <= 0.5, JSON.stringify({ arrived: ok, liftAt: r.liftAt, span: f3(span), rest: f3(d), at: [f3(b.center.x), f3(b.center.z)] }));
}
// ---- K6: over a thing (Rainleaf's Moss Bouncer: a pad) and set down ON it ----
{
  const ok = await host.travel('rainleaf', true);
  await stepA(240);
  const { PLACE: RAIN } = await import('../src/data/place_rainleaf.ts');
  const pad = RAIN.things.find((t) => t.id === 'mossbouncer')!;
  const bs = [app.body, ...app.bodies.extras.filter((x) => !x.piece).map((x) => x.body)];
  let b = bs.reduce((a, c) => (Math.hypot(c.center.x - pad.x, c.center.z - pad.z) < Math.hypot(a.center.x - pad.x, a.center.z - pad.z) ? c : a));
  const padTop = 0.05 * 2 + 0.02;   // (the pad's collider top: size[1] is its half height, a little travel)
  const id = ++pid, p = pc(b);
  app.input.pointerDown({ id, x: p.x, y: p.y, button: 0, type: 'mouse' }); step(1);
  let px = p.x, py = p.y, minOver = 9, overFrames = 0;
  for (let k = 0; k < 300; k++) {
    // (the squishy in the hand is the one the player carries: a friend standing in front at the press takes it, as it should)
    if (b.metrics.carried !== true) { const h = bs.find((q) => q.metrics.carried === true); if (h) b = h; }
    const s = projU(b.center.x, 0, b.center.z), tt = projU(pad.x, 0, pad.z);
    const ax = b.metrics.carried === true ? px + (tt.x - s.x) : tt.x, ay = b.metrics.carried === true ? py + (tt.y - s.y) : tt.y;
    const dx = ax - px, dy = ay - py, L = Math.hypot(dx, dy);
    if (Math.hypot(b.center.x - pad.x, b.center.z - pad.z) < pad.size[0]) { overFrames++; minOver = Math.min(minOver, lowest(b)); }
    if (L < 3) { step(2); if (overFrames > 30) break; continue; }
    const sp = Math.min(14, L); px += (dx / L) * sp; py += (dy / L) * sp;
    app.input.pointerMove({ id, x: px, y: py, type: 'mouse' }); step(2);
  }
  if (process.argv.includes('--debug')) console.log('K6 debug', JSON.stringify({ from: [f3(p.x), f3(p.y)], ptr: [f3(px), f3(py)], body: [f3(b.center.x), f3(b.center.y), f3(b.center.z)], carried: b.metrics.carried, pad: [pad.x, pad.z] }));
  app.input.pointerUp({ id, x: px, y: py, type: 'mouse' });
  let landed = false, rise = 0, low = 9;
  for (let i = 0; i < 150; i++) { step(1); const y = b.center.y; if (!landed && b.metrics.grounded === true || (b.metrics.onProp ?? -1) >= 0) landed = true; if (landed) { low = Math.min(low, y); rise = Math.max(rise, y - low); } }
  check('K6 passing OVER a thing: carried across Rainleaf\'s Moss Bouncer the squishy rides over it (its lowest point never under the pad\'s top while over it); let go there it drops ON the pad and the pad kicks it (it rises >= 0.1 m after landing)',
    ok && overFrames > 10 && minOver >= padTop - 0.01 && rise >= 0.1, JSON.stringify({ arrived: ok, overFrames, lowestOver: f3(minOver), padTop, rise: f3(rise) }));
}
// ---- K7: Float ----
{
  app.setSetting('gravity', false);
  await stepA(240);
  const b = app.bodies.extras.find((x) => !x.piece)?.body ?? app.body, p = pc(b), y0 = b.center.y;
  const r = await drag(b, p.x, p.y, p.x + 120, p.y - 60, { hold: 40 });
  const from = { x: b.center.x, z: b.center.z };
  await settle(180);
  check('K7 Float: a floater is carried (>= 1 m) and let go it STAYS where it is put (3 s later within 0.2 m), still floating', r.liftAt > 0 && moved(r.held, b) <= 0.2 && b.center.y > 0.45 && Math.hypot(r.held.x - from.x, r.held.z - from.z) < 1e-9 + 9,
    JSON.stringify({ liftAt: r.liftAt, drift: f3(moved(r.held, b)), y: f3(b.center.y), y0: f3(y0) }));
  app.setSetting('gravity', true);
  await stepA(180);
}

// ---- E1: the edge scroll (the room director's own code) ----
{
  const { RoomCam } = await import('../src/render/roomcam.ts');
  const lens = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
  lens.position.set(0, 4.5, 6.5); lens.lookAt(0, 0, 0); lens.updateProjectionMatrix(); lens.updateMatrixWorld(true);
  // (the squishy hangs in the middle of the view; the FINGER that holds it is at the frame's top edge (edge) or in the middle (not): only the finger asks for the scroll)
  const run = (edge: boolean): { scrolled: number; dz: number } => {
    const rc = new RoomCam();
    const body = { center: { x: 0, y: 0.6, z: 0 }, restRadius: 0.4, metrics: { fingers: 0, carried: true, grabbed: true } };
    const views = [{ visible: true, id: 1, growth: 1, frameMode: 0, proxy: body }, { visible: true, id: 2, growth: 1, frameMode: 0, proxy: { center: { x: 1.2, y: 0.4, z: 0 }, restRadius: 0.4, metrics: {} } }];
    // (settled first: the finger in the middle until the view stops easing, then the finger goes where the row puts it)
    for (let i = 0; i < 400; i++) { rc.finger({ x: 0, y: 0 }); rc.place(1 / 60, views, 2, lens, 7.9, 0, 0.6, W, H, 80, 80, 0, 0, 5.5, 3.9); }
    const z0 = rc.z;
    let scrolled = 0;
    for (let i = 0; i < 60; i++) { rc.finger(edge ? { x: 0, y: 0.9 } : { x: 0, y: 0 }); rc.place(1 / 60, views, 2, lens, 7.9, 0, 0.6, W, H, 80, 80, 0, 0, 5.5, 3.9); if (rc.scroll) scrolled++; }
    return { scrolled, dz: rc.z - z0 };
  };
  const c = run(true), s = run(false);
  check('E1 the edge scroll: the finger that carries a squishy at the frame\'s top edge scrolls the view toward the back (>= 0.3 m more in 1 s than the same carry with the finger in the middle, which does not scroll)',
    c.scrolled > 30 && c.dz - s.dz <= -0.3 && s.scrolled === 0, JSON.stringify({ edge: { frames: c.scrolled, dz: f3(c.dz) }, middle: { frames: s.scrolled, dz: f3(s.dz) } }));
}

// ---- K10 (round 15, R15_FIX F9; VERDICT_R14 F9): D-104's float height and toss cap belong to a ROOM (a body with place bounds); Home's lone squishy, the
//      published toy (no place bounds), keeps the published 0.35 m and 6 m/s ----
{
  const measure = (room: boolean): { hover: number; toss: number } => {
    const b = new SoftBody(speciesBaseGenome('dollop', 1)) as unknown as SB & { step(dt: number): void; raycast(o: unknown, d: unknown): { vertex: number; point: { x: number; y: number; z: number } } | null; grab(i: number, v: number, p: unknown): void; grabMove(i: number, p: unknown): void; grabRelease(i: number): void };
    if (room) b.setBounds?.(1, 0, 0, 5.5, 3.9, 0.4);
    const run = (n: number): void => { for (let i = 0; i < n; i++) b.step(1 / 60); };
    run(30);
    const rest = b.center.y;
    b.gravity = false; run(240);
    const hover = b.center.y - rest;
    b.gravity = true; run(240);
    // the fastest toss: picked up (lift), the hand swept 6 m to the side in 0.2 s and let go while it moves
    const h = b.raycast({ x: b.center.x, y: b.center.y + 3, z: b.center.z }, { x: 0, y: -1, z: 0 })!;
    b.grab(0, h.vertex, h.point); b.lift?.(0); run(12);
    for (let i = 1; i <= 12; i++) { b.grabMove(0, { x: h.point.x + i * 0.5, y: h.point.y + 0.3, z: h.point.z }); run(1); }
    const x0 = b.center.x; b.grabRelease(0); run(3);
    return { hover, toss: (b.center.x - x0) / (3 / 60) };
  };
  const toy = measure(false), room = measure(true);
  check('K10 (round 15) the bigger rooms\' numbers belong to a room: a body with place bounds hovers 0.6 m over its rest height in Float and its fastest toss is 7.5 m/s; a body without (Home\'s lone squishy, the published toy) keeps the published 0.35 m and 6 m/s',
    Math.abs(toy.hover - 0.35) < 0.06 && Math.abs(room.hover - 0.6) < 0.06 && toy.toss > 5.4 && toy.toss <= 6.05 && room.toss > 6.9 && room.toss <= 7.55,
    JSON.stringify({ toy: { hover: f3(toy.hover), toss: f3(toy.toss) }, room: { hover: f3(room.hover), toss: f3(room.toss) } }));
}

console.error = realError;
if (errors.length) console.log('console.error during the run:', errors.slice(0, 3).map((a) => String(a[0]).slice(0, 200)));
check('no console.error during the run', errors.length === 0, `${errors.length}`);
console.log(`\n${total - bad}/${total} carry checks passed`);
process.exit(bad ? 1 : 0);
