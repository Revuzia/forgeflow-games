// D-103 (g): ONE squishy out must cut exactly as the live build does (commit 6c495e9c1): the piece counts and every piece's share, BIT FOR BIT.
// This script plays a fixed cut script on one squishy (the REAL SoftBody, the app, the Cut tool driven through game.input and the Cut bar's calls, sim time only) and
// prints one JSON line per step with the shares as float64 hex. Run it in two trees and diff the output:
//   node _harness/dump_cut_single.ts            (no life host: the published first-play path)
//   node _harness/dump_cut_single.ts --host     (the life host attached, as in the running game a moment after boot; since D-103 that installs the party cutter)
// The live tree for the comparison: `git archive 6c495e9c1 games/wobblehoard | tar -x -C <dir>` (read-only git), node_modules linked, this file copied in.
import type { SoftBodyCtor, SoftBodyLike, StageLike } from '../src/contracts.ts';
import { createApp } from '../src/app.ts';
import { memoryStorage } from '../src/core/settings.ts';
import { speciesBaseGenome } from '../src/data/catalog.ts';
import { createCollection } from '../src/collection/index.ts';

const HOST = process.argv.includes('--host');
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const THREE = await import('three');
const { SoftBody } = await import('../src/physics/softbody.ts');
const { createMockStage, createMockAudio, createMockHaptics } = await import('./mocks.ts');
const { createProfileStore } = await import('../src/core/save.ts');
type SB = SoftBodyLike;
const W = 1280, H = 800;
const hex = (x: number): string => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b.toString('hex'); };
const out: string[] = [];
const errors: string[] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { errors.push(String(a[0])); };

async function runOne(species: string, seed: number): Promise<void> {
  const st = createMockStage() as ReturnType<typeof createMockStage> & Record<string, unknown>;
  const cam = st.camera as InstanceType<typeof THREE.PerspectiveCamera>;
  cam.fov = 35; cam.aspect = W / H; cam.near = 0.1; cam.far = 200;
  { const dd = Math.max(3.0, 2.4 / (W / H)), pitch = 0.27; cam.position.set(0, 0.42 + dd * Math.sin(pitch) + 1.2, dd * Math.cos(pitch) + 2.5); cam.lookAt(0, 0.42, -0.6); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); }
  let viewId = 100, primary = 1;
  const views = new Map<number, SB>();
  Object.assign(st, {
    primaryBodyId: () => primary,
    setPrimaryBody: (vid: number) => { if (views.has(vid)) primary = vid; },
    setBody: (b: SB) => { views.clear(); primary = ++viewId; views.set(primary, b); },
    addBody: (b: SB) => { const vid = ++viewId; views.set(vid, b); return vid; },
    removeBody: (vid: number) => { views.delete(vid); },
    setBodyTier: () => {}, setFloatMode: () => {},
    matLayout: (n: number) => [[0, 0], [1.3, 0], [-1.3, 0], [2.6, 0], [-2.6, 0]].slice(0, Math.max(1, Math.min(5, n))).map(([x, z]) => ({ x, y: 0, z })),
    visibleTable: (o: Float32Array) => { o[0] = -3.0; o[1] = -2.6; o[2] = 3.0; o[3] = 0.9; return true; },
    stats: () => ({ drawCalls: 0, triangles: 0, tier: 'high', frameMsEma: 0 }),
    emote: () => {}, clearEmote: () => {}, emoteScreen: (_k: number, o: Float32Array) => { o[0] = 600; o[1] = 300; o[2] = 20; return true; },
    loadPlace: async () => true, setPlace: () => true, bindProps: () => {},
  });
  for (const k of ['setHomeThing', 'setAutonomyFraming', 'setBodyPose', 'setBodyGaze', 'setBodyExpression', 'setBodyLook', 'setBodyAsleep', 'setKeepsakes', 'setObstacles', 'setHeatPoint', 'setPlayBounds', 'thingFx']) st[k] = () => {};
  const v3 = new THREE.Vector3();
  const proj = (x: number, y: number, z: number): { x: number; y: number } => { v3.set(x, y, z).project(cam); return { x: (v3.x * 0.5 + 0.5) * W, y: (0.5 - v3.y * 0.5) * H }; };
  st.bodyScreenPoint = (vid: number, o: Float32Array) => { const b = views.get(vid); if (!b) return false; const p = proj(b.center.x, b.center.y, b.center.z); o[0] = p.x; o[1] = p.y; o[2] = 40; return true; };
  const audio = createMockAudio() as ReturnType<typeof createMockAudio> & Record<string, unknown>;
  audio.creature = () => true;
  for (const k of ['setTouching', 'autoThud', 'prop', 'musicBox', 'setAmbience', 'setMusicStyle']) audio[k] = () => {};
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
  if (HOST) {
    const { attachLifeHost } = await import('../src/shell/later-life.ts');
    const lifeParts = { attachJournal: (await import('../src/shell/later-quests.ts')).attachJournal, buildPropWorld: (await import('../src/shell/later-props.ts')).buildPropWorld };
    attachLifeHost(app, { parts: lifeParts, storage: mem, say: () => {}, moment: () => {}, setTimer: () => 0, clearTimer: () => {} });
  }
  const step = (n: number): void => { for (let i = 0; i < n; i++) { clockT += 1000 / 60; app.clock.advance?.(1000 / 60); app.stepOnce(1 / 60); } };
  const stepA = async (n: number): Promise<void> => { for (let i = 0; i < n; i += 10) { step(10); await tick(); } };
  const rec = (what: string): void => {
    const c = app.body.center;
    out.push(JSON.stringify({ species, what, pieces: app.cut.pieces, fracs: app.cut.fracs().map(hex), extras: app.bodies.extras.length, c: [hex(c.x), hex(c.y), hex(c.z)] }));
  };
  await stepA(60);
  app.setGenome(speciesBaseGenome(species as Parameters<typeof speciesBaseGenome>[0], seed));
  await stepA(180);
  rec('settled');
  app.setTool('cut');
  await stepA(30);
  // 1 a mouse stroke, top to bottom, a little right of the middle
  { const b = app.body, p = proj(b.center.x + 0.22 * b.restRadius, b.center.y, b.center.z);
    app.input.pointerDown({ id: 7, x: p.x, y: p.y - 150, t: clockT, type: 'mouse', button: 0 });
    app.input.pointerMove({ id: 7, x: p.x + 2, y: p.y, t: clockT, type: 'mouse' });
    app.input.pointerUp({ id: 7, x: p.x + 4, y: p.y + 150, t: clockT, type: 'mouse' });
    await stepA(240); rec('stroke'); }
  // 2 Split in two, three presses
  for (let k = 0; k < 3; k++) { const r = app.cut.splitInTwo(); await stepA(150); rec('split' + (k + 1) + ':' + r); }
  // 3 a level swipe across the middle of the play body
  { const b = app.body, p = proj(b.center.x, b.center.y, b.center.z); const r = app.cut.swipe(p.x - 160, p.y + 3, p.x + 160, p.y - 2); await stepA(240); rec('level:' + r); }
  // 4 Reconnect all, animated
  { const r = app.cut.reconnectAll(true); await stepA(360); rec('reconnect:' + r); }
  // 5 Minis: a stroke, a split, Reconnect all at once
  app.cut.setStyle('minis');
  { const b = app.body, p = proj(b.center.x - 0.15 * b.restRadius, b.center.y, b.center.z); const r = app.cut.swipe(p.x, p.y - 150, p.x + 3, p.y + 150); await stepA(240); rec('minis:' + r); }
  { const r = app.cut.splitInTwo(); await stepA(150); rec('minis-split:' + r); }
  { const r = app.cut.reconnectAll(false); await stepA(60); rec('minis-reconnect:' + r); }
  app.cut.setStyle('clean');
  // 6 a cut, then leaving by the Hand and a hidden tab over 60 s (whole again)
  { const r = app.cut.splitInTwo(); await stepA(150); rec('again:' + r); app.setTool('hand'); app.setHidden(true); clockT += 61_000; app.setHidden(false); await stepA(30); rec('hidden61'); }
  app.dispose();
}

for (const [sp, seed] of [['dollop', 1], ['crimpo', 3], ['capnap', 4], ['wisplet', 5], ['twangle', 6]] as Array<[string, number]>) await runOne(sp, seed);
console.error = realError;
for (const l of out) console.log(l);
console.log(JSON.stringify({ errors }));
process.exit(0);
