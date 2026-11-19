// probe_life_selfuse (round 7, R7_LIFE): what squishies use BY THEMSELVES in each place, on the REAL physics and LIFE with the shell's life host (no rendering,
// no input): R6_SHELL's rig (its scratch `scratch_selfuse.ts`, node_checks section 13's host) made a probe. A party of three (Dollop + two) arrives at each place
// and stays STAY s of sim time; every play-event record the host writes BY SELF that names a thing (a USE, a REACT naming the thing, a social moment played
// around it) counts that thing as used. Rows (the round-7 brief): SU-01 at least 3 different things used at EVERY one of Hearthlog, Ripple, Frostbell, Rainleaf,
// Lanternroof and Cloudloft in 300 s with 3 squishies and no input, for at least 4 of 5 parties; SU-02 different families visibly prefer different things;
// SU-03 the attention budget still rules (no squishy has more than USE_MAX by-itself use episodes in a visit: variety, not noise).
// Heavy (about 35 s of wall time per 300 s place-stay; 30 stays): one at a time on the machine.
// (round 8, R8_LIFE) SQ-01 (first, about 15 s of wall time; `--squirt-only` runs it alone, a light job): R7 "A squirt for a friend" by ordinary play on the
// real physics: the player CARRIES Wisplet (a marshmallow) into Ripple Shore's Rock Pool (body.grab: a lift, a carry, a let go), it stays to soak
// (autonomy ON), the player carries Dollop beside the pool and squeezes Wisplet 0.6 s (a finger press): the squirt arc and the SOCIAL SQUIRT record.
//   node _harness/probe_life_selfuse.ts [stay=300] [parties=wisplet+chunkle,puddlo+boingle,...] [places=hearthlog,ripple,...] [--quick] [--squirt-only]
import type { SoftBodyCtor, SoftBodyLike, StageLike, PlayEventRing } from '../src/contracts.ts';
import { createApp } from '../src/app.ts';
import { memoryStorage } from '../src/core/settings.ts';
import { speciesBaseGenome, CATALOG } from '../src/data/catalog.ts';
import { createCollection } from '../src/collection/index.ts';
import { THING_IDS } from '../src/data/places.ts';
import { EV, BY } from '../src/data/quests.ts';
import { USE_VERB, SOCIAL_KIND, SQUIRT } from '../src/data/life.ts';
import { PLACE as RIPPLE } from '../src/data/place_ripple.ts';
import { recorder } from './mocks.ts';

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1) ?? d;
const QUICK = process.argv.includes('--quick'), TRACE = process.argv.includes('--trace'), SQ_ONLY = process.argv.includes('--squirt-only');
const STAY = +arg('stay', QUICK ? '120' : '300');
// (round 9, R9_FIX 2) seed=N: LIFE's world seed (the host's deps.lifeSeed; default the shipped 0x5eed1e) and the party genomes' seed (default 8): another draw of the same parties
const SEED = arg('seed', ''), GSEED = SEED ? (+SEED % 97) + 1 : 8;
const PARTIES = arg('parties', QUICK ? 'wisplet+chunkle' : 'wisplet+chunkle,puddlo+boingle,gloopsy+kneadle,twangle+dimpla,capnap+burrbin').split(',').map((p) => p.split('+'));
const PLACES = arg('places', 'hearthlog,ripple,frostbell,rainleaf,lanternroof,cloudloft').split(',');
/** SU-03: by-itself use episodes per squishy per 300 s visit at most (USES_FULL by B04 + a pass's turn + a nap from real tiredness + the thing it bumps on its
 *  way: a chime, a pad) */
const USE_MAX = 8;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const THREE = await import('three');
const { SoftBody } = await import('../src/physics/softbody.ts');
const { attachLifeHost } = await import('../src/shell/later-life.ts');
const lifeParts = { attachJournal: (await import('../src/shell/later-quests.ts')).attachJournal, buildPropWorld: (await import('../src/shell/later-props.ts')).buildPropWorld };
const { createMockStage, createMockAudio, createMockHaptics } = await import('./mocks.ts');
const { createProfileStore } = await import('../src/core/save.ts');
type SB = SoftBodyLike;
const W = 1280, H = 800;
const FAM: Record<string, string> = {};
for (const c of CATALOG) FAM[c.id] = c.family;
const verbName = (v: number): string => Object.keys(USE_VERB).find((k) => USE_VERB[k as keyof typeof USE_VERB] === v) ?? String(v);

interface Visit { party: string; place: string; ok: boolean; things: string[]; first: Record<string, number>; three: number; bySpecies: Record<string, string[]>; usesPer: Record<string, number>; episodes: Record<string, number>; how: string[]; napShare: number; wallS: number }

/** SQ-01's measurements (round 8). */
interface Sq { carried: boolean; landed: string; inPoolS: number; outAt: number; movedAt: number; soakAt12: number; soak05At: number; dollopCarried: boolean; gap: number; heldFor: number; fx: number; social: number; target: string; place: number; trace: string[] }
let SQ: Sq | null = null;
async function runParty(party: string[], squirt = false): Promise<Visit[]> {
  const st = createMockStage() as ReturnType<typeof createMockStage> & Record<string, unknown>;
  const cam = st.camera as InstanceType<typeof THREE.PerspectiveCamera>;
  cam.fov = 35; cam.aspect = W / H; cam.near = 0.1; cam.far = 200;
  { const dd = Math.max(3.0, 2.4 / (W / H)), pitch = 0.27; cam.position.set(0, 0.42 + dd * Math.sin(pitch) + 1.2, dd * Math.cos(pitch) + 2.5); cam.lookAt(0, 0.42, -0.6); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); }
  let viewId = 100, primary = 1;
  const views = new Map<number, SB>();
  const log = recorder();
  Object.assign(st, {
    primaryBodyId: () => primary,
    setBody: (b: SB) => { views.clear(); primary = ++viewId; views.set(primary, b); },
    addBody: (b: SB) => { const vid = ++viewId; views.set(vid, b); return vid; },
    removeBody: (vid: number) => { views.delete(vid); },
    setBodyTier: () => {},
    matLayout: (n: number) => [[0, 0], [1.3, 0], [-1.3, 0], [2.6, 0], [-2.6, 0]].slice(0, Math.max(1, Math.min(5, n))).map(([x, z]) => ({ x, y: 0, z })),
    visibleTable: (out: Float32Array) => { out[0] = -3.0; out[1] = -2.6; out[2] = 3.0; out[3] = 0.9; return true; },
    stats: () => ({ drawCalls: 0, triangles: 0, tier: 'high', frameMsEma: 0 }),
    emote: () => {}, clearEmote: () => {}, emoteScreen: (_k: number, o: Float32Array) => { o[0] = 600; o[1] = 300; o[2] = 20; return true; },
    loadPlace: async () => true, setPlace: () => true,
  });
  st.bindProps = () => {};
  for (const k of ['setHomeThing', 'setAutonomyFraming', 'setBodyPose', 'setBodyGaze', 'setBodyExpression', 'setBodyLook', 'setBodyAsleep', 'setKeepsakes', 'setObstacles', 'setHeatPoint', 'setPlayBounds', 'thingFx', 'squirtFx']) st[k] = (...a: unknown[]) => log.rec(k, ...a);
  const v3 = new THREE.Vector3();
  const proj = (x: number, y: number, z: number): { x: number; y: number } | null => { v3.set(x, y, z).project(cam); return Math.abs(v3.x) > 1 || Math.abs(v3.y) > 1 ? null : { x: (v3.x * 0.5 + 0.5) * W, y: (0.5 - v3.y * 0.5) * H }; };
  st.bodyScreenPoint = (vid: number, out: Float32Array) => { const b = views.get(vid); const p = b ? proj(b.center.x, b.center.y, b.center.z) : null; if (!p) return false; out[0] = p.x; out[1] = p.y; out[2] = 40; return true; };
  const audio = createMockAudio() as ReturnType<typeof createMockAudio> & Record<string, unknown>;
  audio.creature = () => true;
  for (const k of ['setTouching', 'autoThud', 'prop', 'musicBox', 'setAmbience', 'setMusicStyle']) audio[k] = () => {};
  audio.loadAmbience = async () => true;
  const mem = memoryStorage();
  let clockT = 1000;
  const devSkew = { ms: 0 };
  const profile = createProfileStore(mem);
  const coll = createCollection({ storage: mem, profile: profile.profile, now: () => 1_700_000_000_000 + clockT + devSkew.ms, random: () => 0.4 });
  // the records the host writes, read as they are drained into the journal (by SELF, naming a thing)
  type Rec = { kind: number; thing: number; sp: number; sub: number; t: number };
  const recs: Rec[] = [];
  const socials: Array<{ sub: number; a: number; b: number; place: number }> = [];
  const feed0 = coll.feedPlay?.bind(coll);
  (coll as { feedPlay?: (r: PlayEventRing, t: number) => void }).feedPlay = (ring: PlayEventRing, t: number) => {
    for (let k = 0; k < ring.n; k++) if (ring.kind[k] === EV.SOCIAL) socials.push({ sub: ring.sub[k], a: ring.a[k], b: ring.b[k], place: ring.place[k] });
    for (let k = 0; k < ring.n; k++) if (ring.by[k] === BY.SELF && ring.thing[k] >= 0 && (ring.kind[k] === EV.USE || ring.kind[k] === EV.REACT || ring.kind[k] === EV.SOCIAL)) recs.push({ kind: ring.kind[k], thing: ring.thing[k], sp: ring.a[k], sub: ring.sub[k], t: clockT });
    feed0?.(ring, t);
  };
  const app = createApp({
    createBody: (g, o) => (o?.piece ? new (SoftBody as unknown as SoftBodyCtor)(g, { piece: o.piece }) : o?.at ? new (SoftBody as unknown as SoftBodyCtor)(g, { piece: { frac: 1, chunk: false, at: o.at } }) : new SoftBody(g)),
    createStage: () => st as unknown as StageLike, createAudio: () => audio as unknown as ReturnType<typeof createMockAudio>, haptics: createMockHaptics(), storage: mem, collection: coll, profile, devSkew,
    env: { vibrate: false, reducedMotion: false }, now: () => clockT, epochNow: () => 1_700_000_000_000 + clockT, raf: () => 0, caf: () => {},
  });
  app.resize(W, H, 1); app.setPhase('play');
  const host = attachLifeHost(app, { parts: lifeParts, storage: mem, say: () => {}, moment: () => {}, setTimer: () => 0, clearTimer: () => {}, ...(SEED ? { lifeSeed: +SEED } : {}) })!;
  const step = (n: number): void => { for (let i = 0; i < n; i++) { clockT += 1000 / 60; app.clock.advance?.(1000 / 60); app.stepOnce(1 / 60); } };
  const stepA = async (n: number): Promise<void> => { for (let i = 0; i < n; i += 10) { step(10); await tick(); } };
  type D = { place: number; chars: Array<{ species: string; kind: number; x: number; z: number; flags: number; asleep: boolean; onProp: number }>; life: { chars: Array<{ beh: number; phase: number; moment: number; thing: number; uses: number; play: number }> } };
  const dbg = (): D => host.debug() as unknown as D;
  await stepA(120);
  for (const [k, sp] of party.entries()) { app.mat.add({ genome: speciesBaseGenome(sp as Parameters<typeof speciesBaseGenome>[0], GSEED), itemId: `p-${k}` }, { restore: true }); await stepA(10); }
  await stepA(120);
  type Grabby = SB & { raycast: (o: unknown, d: unknown) => { vertex: number; point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null; grab: (i: number, v: number, p: unknown) => void; grabMove: (i: number, p: unknown) => void; grabRelease: (i: number) => void; fingerDown: (i: number, a: unknown) => void; fingerPressure: (i: number, d: number) => void; fingerUp: (i: number) => void; metrics: { carried: boolean } };
  const bodyOf = (species: string): { b: Grabby; ci: number } => {
    const d = dbg(), ci = d.chars.findIndex((c) => c.species === species), cc = d.chars[ci];
    let b: SB | null = null, bd = 1e9;
    for (const v of views.values()) { const dd = Math.hypot(v.center.x - cc.x, v.center.z - cc.z); if (dd < bd) { bd = dd; b = v; } }
    return { b: b as Grabby, ci };
  };
  /** A player's carry: grab the top, lift 1.3 m, carry over (tx, tz), lower to 0.4 m above the start height, let go. True when physics carried it. */
  const carry = (b: Grabby, tx: number, tz: number): boolean => {
    const h = b.raycast({ x: b.center.x, y: b.center.y + 3, z: b.center.z }, { x: 0, y: -1, z: 0 });
    if (!h) return false;
    b.grab(0, h.vertex, h.point);
    const p0 = { ...h.point };
    let seen = false;
    for (let k = 1; k <= 30; k++) { b.grabMove(0, { x: p0.x, y: p0.y + 1.3 * k / 30, z: p0.z }); step(1); seen ||= b.metrics.carried; }
    for (let k = 1; k <= 60; k++) { const f = k / 60; b.grabMove(0, { x: p0.x + (tx - p0.x) * f, y: p0.y + 1.3, z: p0.z + (tz - p0.z) * f }); step(1); seen ||= b.metrics.carried; }
    for (let k = 1; k <= 30; k++) { b.grabMove(0, { x: tx, y: p0.y + 1.3 - 0.9 * k / 30, z: tz }); step(1); }
    for (let k = 0; k < 10; k++) { b.grabMove(0, { x: tx, y: p0.y + 0.4, z: tz }); step(1); }
    b.grabRelease(0);
    return seen;
  };
  async function squirtScenario(): Promise<Sq> {
    const pool = RIPPLE.zones.find((z) => z.id === 'rockpool')!, pr = pool.r ?? 1.3;
    await host.travel('ripple', true);
    await stepA(20 * 60);
    // set Wisplet in the pool's front half (0.95 m in front of its centre: in the water, clear of the Bob Ring at the centre)
    const wx = pool.x, wz = pool.z + 0.95;
    const W0 = bodyOf('wisplet');
    const carried = carry(W0.b, wx, wz);
    const tRel = clockT, trace: string[] = [];
    let inPool = 0, outAt = -1, movedAt = -1, soakAt12 = 0, soak05At = -1, landed = '';
    for (let k = 1; k <= 40; k++) {   // 20 s (R7_SHELL's browser row waited 24 s), sampled every 0.5 s
      await stepA(30);
      const d = dbg(), c = d.chars[W0.ci] as unknown as { x: number; z: number; looks: number[] }, l = d.life.chars[W0.ci] as unknown as { beh: number; moving: number };
      if (movedAt < 0 && l.moving) movedAt = k * 0.5;   // LIFE holds a mover token for it: a walk (a use, a wander, a bask, a moment) of its own
      const dd = Math.hypot(c.x - pool.x, c.z - pool.z), soak = c.looks?.[2] ?? 0;
      if (k === 1) landed = `${c.x.toFixed(2)},${c.z.toFixed(2)}`;
      if (dd < pr) inPool += 0.5; else if (outAt < 0) outAt = k * 0.5;
      if (soak05At < 0 && soak >= SQUIRT.soakMin) soak05At = k * 0.5;
      soakAt12 = soak;
      if (k % 8 === 0) trace.push(`t ${(k * 0.5).toFixed(1)} beh ${l.beh} at ${c.x.toFixed(2)},${c.z.toFixed(2)} soak ${soak}`);
    }
    // the friend: Dollop carried beside the pool, in front of Wisplet (out of the water), then the squeeze at once
    const D0 = bodyOf('dollop');
    const dollopCarried = carry(D0.b, wx, wz + 0.95);
    await stepA(45);
    const d1 = dbg(), cw = d1.chars[W0.ci], cd = d1.chars[D0.ci];
    const gap = Math.hypot(cw.x - cd.x, cw.z - cd.z);
    const fx0 = log.count('squirtFx'), so0 = socials.length;
    const W1 = bodyOf('wisplet');
    const h = W1.b.raycast({ x: W1.b.center.x, y: W1.b.center.y + 3, z: W1.b.center.z + 0.02 }, { x: 0, y: -1, z: 0 });
    let heldFor = 0;
    if (h) { W1.b.fingerDown(0, { point: h.point, normal: h.normal, dir: { x: 0, y: -1, z: 0 } }); W1.b.fingerPressure(0, 0.6); for (let k = 0; k < 36; k++) { step(1); heldFor += 1 / 60; } W1.b.fingerUp(0); }
    await stepA(90);
    const mine = socials.slice(so0).filter((r) => r.sub === SOCIAL_KIND.SQUIRT);
    const spName = (i: number): string => CATALOG[i]?.id ?? String(i);
    return { carried, landed, inPoolS: inPool, outAt, movedAt, soakAt12, soak05At, dollopCarried, gap: +gap.toFixed(2), heldFor: +heldFor.toFixed(2), fx: log.count('squirtFx') - fx0, social: mine.length, target: mine.map((r) => `${spName(r.a)}->${spName(r.b)}`).join(' '), place: mine[0]?.place ?? -1, trace };
    void tRel;
  }
  if (squirt) { SQ = await squirtScenario(); host.dispose?.(); app.dispose(); return []; }
  const out: Visit[] = [];
  const spName = (i: number): string => CATALOG[i]?.id ?? String(i);
  for (const pl of PLACES) {
    const t0 = Date.now();
    const ok = await host.travel(pl, true);
    await stepA(120);
    const tArr = clockT, r0 = recs.length;
    let three = -1, naps = 0, samples = 0;
    const last: string[] = [];
    for (let t = 10; t <= STAY; t += 10) {
      if (TRACE) for (let q = 0; q < 10; q++) {
        await stepA(60);
        const d = dbg();
        d.life.chars.forEach((c, j) => { const k = `${c.beh}.${c.phase}.${c.thing}`; if (last[j] !== k) { last[j] = k; console.log(`  t ${Math.round((clockT - tArr) / 1000)} ${d.chars[j]?.species} beh ${c.beh} ph ${c.phase} thing ${c.thing} uses ${c.uses} play ${c.play} at ${d.chars[j]?.x},${d.chars[j]?.z} fl ${d.chars[j]?.flags} sl ${d.chars[j]?.asleep ? 1 : 0} op ${d.chars[j]?.onProp}`); } });
      }
      else await stepA(600);
      const seen = new Set(recs.slice(r0).map((r) => r.thing));
      if (three < 0 && seen.size >= 3) three = t;
      for (const c of dbg().life.chars) { samples++; if (c.beh === 6) naps++; }
    }
    const mine = recs.slice(r0);
    const first: Record<string, number> = {}, bySpecies: Record<string, string[]> = {}, usesPer: Record<string, number> = {}, episodes: Record<string, number> = {}, lastUse: Record<string, number> = {}, how: string[] = [];
    for (const r of mine) {
      const th = THING_IDS[r.thing] ?? String(r.thing), sp = spName(r.sp), kind = r.kind === EV.USE ? 'use' : r.kind === EV.REACT ? 'react' : 'social';
      if (!(th in first)) first[th] = Math.round((r.t - tArr) / 1000);
      (bySpecies[sp] ??= []).includes(th) || bySpecies[sp].push(th);
      if (r.kind === EV.USE) { usesPer[sp] = (usesPer[sp] ?? 0) + 1; const key = `${sp}:${th}`; if (!(r.t - (lastUse[key] ?? -1e9) < 10000)) episodes[sp] = (episodes[sp] ?? 0) + 1; lastUse[key] = r.t; }
      const h = `${th}:${kind}${r.kind === EV.USE ? '.' + verbName(r.sub) : ''}`;
      if (!how.includes(h)) how.push(h);
    }
    out.push({ party: ['dollop', ...party].join('+'), place: pl, ok, things: Object.keys(first), first, three, bySpecies, usesPer, episodes, how, napShare: +(naps / Math.max(1, samples)).toFixed(2), wallS: Math.round((Date.now() - t0) / 1000) });
    console.log('visit', JSON.stringify(out[out.length - 1]));
    await host.travel('home', true); await stepA(120);
  }
  host.dispose?.();
  app.dispose();
  return out;
}

let fails = 0;
const check = (id: string, what: string, ok: boolean): void => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}`); };
const info = (id: string, what: string): void => console.log(`info ${id} ${what}`);
// SQ-01 (round 8): the squirt by ordinary play, on the real physics and host, autonomy on
{
  const t0 = Date.now();
  await runParty(['wisplet', 'chunkle'], true);
  const q = SQ as Sq | null;
  if (!q) check('SQ-01', 'the squirt scenario did not run', false);
  else {
    info('SQ-01', `trace: ${q.trace.join(' | ')} (${Math.round((Date.now() - t0) / 1000)} s wall)`);
    check('SQ-01', `(round 8) a squishy the player set in water stays to soak: Wisplet (marshmallow) carried by the player (${q.carried}) into the Rock Pool (landed ${q.landed}) is in the pool for all 20 s after the let go (${q.inPoolS} s; first out at ${q.outAt < 0 ? 'never' : q.outAt + ' s'}) and starts no motion of its own (first at ${q.movedAt < 0 ? 'never' : q.movedAt + ' s'}), its soak ${q.soakAt12} at 20 s (>= ${SQUIRT.soakMin} from ${q.soak05At} s)`,
      q.carried && q.inPoolS >= 20 && q.outAt < 0 && q.movedAt < 0 && q.soakAt12 >= SQUIRT.soakMin);
    check('SQ-01', `(round 8) R7 by ordinary play: Dollop carried beside the pool (${q.dollopCarried}, ${q.gap} m centre to centre), the player squeezes the soaked Wisplet ${q.heldFor} s: the squirt arc drawn (${q.fx}) and a SOCIAL SQUIRT record at Ripple Shore (${q.social}: ${q.target || 'none'}, place ${q.place})`,
      q.dollopCarried && q.fx >= 1 && q.social >= 1 && q.place === 2);
  }
}
const all: Visit[] = [];
if (!SQ_ONLY) for (const p of PARTIES) all.push(...(await runParty(p)));
// (round 9, R9_FIX 2: tightened to EVERY party, the owner's "3 to 5 different things per visit at every place, reliably"; it was 4 of 5)
const nParties = PARTIES.length, need = nParties;
if (SQ_ONLY) { console.log(fails ? `${fails} failed` : 'all selfuse checks passed (SQ-01 only)'); process.exit(fails ? 1 : 0); }
for (const pl of PLACES) {
  const vs = all.filter((v) => v.place === pl), pass = vs.filter((v) => v.ok && v.things.length >= 3);
  check('SU-01', `${pl}: at least 3 different things used by themselves in ${STAY} s with 3 squishies and no input, for ${need} of ${nParties} parties (${pass.length}: ${vs.map((v) => `${v.things.length} [${v.things.join(' ')}]${v.three >= 0 ? ` 3 by ${v.three} s` : ''}`).join('; ')})`, pass.length >= need);
}
// (round 9, R9_FIX 2) per place: the min / median / max of different things used by themselves across the parties (the owner's goal: 3 to 5 at every place)
for (const pl of PLACES) { const ns = all.filter((v) => v.place === pl).map((v) => v.things.length).sort((a, b) => a - b);
  if (ns.length) info('SU-01', `${pl}: different things per visit min ${ns[0]} / median ${ns[ns.length >> 1]} / max ${ns[ns.length - 1]} (${ns.join(' ')})${SEED ? ` seed ${SEED}` : ''}`); }
// SU-02: per place, each family's things; families prefer different things when, at most places, two families' sets of things differ
const famThings: Record<string, Record<string, Set<string>>> = {};
for (const v of all) for (const [sp, th] of Object.entries(v.bySpecies)) { const f = FAM[sp] ?? sp; ((famThings[v.place] ??= {})[f] ??= new Set()); for (const t of th) famThings[v.place][f].add(t); }
let differ = 0;
for (const pl of PLACES) {
  const fams = Object.entries(famThings[pl] ?? {});
  const sigs = new Set(fams.map(([, s]) => [...s].sort().join(' ')));
  if (sigs.size >= 2) differ++;
  info('SU-02', `${pl}: ${fams.map(([f, s]) => `${f} {${[...s].join(' ')}}`).join('; ')}`);
}
check('SU-02', `different families prefer different things: at ${differ} of ${PLACES.length} places the families' sets of things differ (want ${Math.min(PLACES.length, 5)})`, differ >= Math.min(PLACES.length, 5));
// (a use EPISODE: the records of one squishy on one thing less than 10 s apart are one use: a walk along a chime row strikes every part, a pad's run of
// kicks, and a body resting against the lanterns in the Night Breeze is struck again and again: the host writes a USE per strike, see the report)
const over = all.flatMap((v) => Object.entries(v.episodes).filter(([, n]) => n > USE_MAX * STAY / 300).map(([sp, n]) => `${v.place} ${sp} ${n}`));
check('SU-03', `the attention budget rules: no squishy has more than ${USE_MAX} by-itself use episodes in a ${STAY} s visit (${over.length ? over.join(', ') : 'none over'}; most ${Math.max(0, ...all.flatMap((v) => Object.values(v.episodes)))})`, over.length === 0);
info('SU-03', `USE records per squishy and visit (the host's, a strike each): most ${Math.max(0, ...all.flatMap((v) => Object.values(v.usesPer)))}; over 30: ${all.flatMap((v) => Object.entries(v.usesPer).filter(([, n]) => n > 30).map(([sp, n]) => `${v.place} ${sp} ${n}`)).join(', ') || 'none'}`);
console.log(fails ? `${fails} failed` : 'all selfuse checks passed');
process.exit(fails ? 1 : 0);
