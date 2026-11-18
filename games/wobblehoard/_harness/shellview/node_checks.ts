// SHELL-2a node checks (plain node, exits 1 on failure; browser_shell.mjs runs it as its 'node-core' section).
// The game core (src/shell/**) driven with the recording mocks of _harness/mocks.ts plus a FAKE round-2 stage and audio that follow the
// render handover's protocol (beats in time order, done, skip, resultBody) closely enough to check the shell's side of it:
//   fatal-frame path, context-loss suspend, atomic body swap, resultBody adoption, the ceremony beat -> sound map, the 350 ms skip gate,
//   input lock during ceremonies, settings resolution + migration + calm, the press-driven squelch, the capsule table, the meter mapping,
//   keyboard focus rules, audio disposal on a failed boot, and the body CALIBRATION measured on the REAL SoftBody.
import type { CapsuleHandle, CapsuleRevealSpec, CeremonyBeat, CeremonyHandle, CeremonyHooks, MergeCeremonySpec, SoftBodyCtor, SoftBodyLike, SoftEvent, StageLike, TierName, V3 } from '../../src/contracts.ts';
import { createApp } from '../../src/app.ts';
import type { App } from '../../src/app.ts';
import { makeStarterGenome, encodeGenome } from '../../src/core/genome.ts';
import type { Genome } from '../../src/core/genome.ts';
import { SETTINGS_KEY, SETTINGS_VERSION, defaultSettings, loadSettings, memoryStorage, resolveSettings, saveSettings } from '../../src/core/settings.ts';
import * as settingsV2 from './settings_v2_frozen.ts';
import { speciesBaseGenome, tierOf } from '../../src/data/catalog.ts';
import * as cat2 from '../../src/data/catalog.ts';
import { KEY_POINTER_ID, attachKeyboard } from '../../src/input/keyboard.ts';
import { CALIBRATION, pressDirection, releaseFxLevel, snapPullLevel, squeezeDepth } from '../../src/shell/feel.ts';
import { createCollection, WH_QUEUE_MAX } from '../../src/collection/index.ts';
import { BURST_SPACING_MS, SKIP_GATE_MS } from '../../src/shell/ceremonies.ts';
import { createMockWorld, recorder } from '../mocks.ts';
import type { MockWorld } from '../mocks.ts';

let bad = 0, total = 0;
const check = (name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const errors: unknown[][] = [];
const realError = console.error;
console.error = (...a: unknown[]) => { errors.push(a); };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/* ───────────────────────── a fake round-2 stage and audio ───────────────────────── */
const CAP_BUDGET: Record<TierName, number> = { common: 1.6, uncommon: 2.0, rare: 2.6, epic: 3.2, legendary: 3.9, mythic: 4.5 };
const MERGE_BUDGET: Record<TierName, number> = { common: 2.2, uncommon: 2.6, rare: 3.2, epic: 3.8, legendary: 4.5, mythic: 5.2 };
const PREROLL: Record<TierName, number> = { common: 0, uncommon: 0, rare: 0.3, epic: 0.5, legendary: 0.8, mythic: 1.0 };
const CHARGE: Record<TierName, number> = { common: 1.3, uncommon: 1.5, rare: 1.8, epic: 2.1, legendary: 2.4, mythic: 2.8 };

interface FakeRun { t: number; beats: Array<[number, CeremonyBeat]>; fired: Set<CeremonyBeat>; hooks?: CeremonyHooks; tier: TierName; duration: number; resolve(): void; active: boolean; result: SoftBodyLike }

function upgrade(w: MockWorld): { log: ReturnType<typeof recorder>; runs: FakeRun[]; capsule: { landed: boolean; squeeze: number; removed: boolean } | null } {
  const st = w.stage as unknown as StageLike & Record<string, unknown>;
  const log = recorder();
  const state: { log: typeof log; runs: FakeRun[]; capsule: { landed: boolean; squeeze: number; removed: boolean } | null } = { log, runs: [], capsule: null };
  let calm = false;
  let primary = 1;
  const baseUpdate = st.update.bind(st);
  st.setCalmEffects = (on: boolean) => { calm = on; log.rec('setCalmEffects', on); };
  st.setBodyTier = (id: number, t: TierName) => log.rec('setBodyTier', id, t);
  st.primaryBodyId = () => primary;
  let viewId = 100;
  st.addBody = (_b: SoftBodyLike, _g: Genome, opts?: { position?: { x: number; y: number; z: number } }) => { log.rec('addBody', opts?.position ?? null); return ++viewId; };
  st.removeBody = (id: number) => log.rec('removeBody', id);
  st.dropCapsule = (o?: { onLand?: () => void }) => {
    log.rec('dropCapsule');
    const c = { landed: false, squeeze: 0, removed: false };
    state.capsule = c;
    setTimeout(() => { c.landed = true; o?.onLand?.(); }, 0);
    const h: CapsuleHandle = {
      id: 1, get landed() { return c.landed && !c.removed; },
      screenPoint: () => (c.landed && !c.removed ? { x: 700, y: 400, r: 40 } : null),
      hitTest: (x, y) => c.landed && !c.removed && Math.hypot(x - 700, y - 400) < 54,
      setSqueeze: (p) => { c.squeeze = p; log.rec('setSqueeze', p); }, wobble: () => {}, remove: () => { c.removed = true; },
    };
    return h;
  };
  const start = (kind: 'capsule' | 'merge', tier: TierName, genome: Genome, createBody: (g: Genome) => SoftBodyLike, hooks: CeremonyHooks | undefined, quick: boolean): CeremonyHandle => {
    const k = calm ? 0.65 : 1;
    let beats: Array<[number, CeremonyBeat]>;
    let duration: number;
    if (kind === 'capsule') {
      duration = (quick ? 0.8 : CAP_BUDGET[tier]) * k;
      const pre = quick ? 0 : PREROLL[tier];
      const burstAt = ((quick ? 0.4 : 0.65) + pre) * k;
      beats = [[0, 'grab'], [0.35 * k * (quick ? 0.5 : 1), 'crack']];
      if (pre > 0) beats.push([0.65 * k, 'preroll']);
      beats.push([burstAt, 'burst'], [burstAt + 0.35 * k, 'reveal'], [duration, 'settle']);
    } else {
      duration = MERGE_BUDGET[tier] * k;
      const b = CHARGE[tier] * k;
      beats = [[0, 'press'], [0.4 * k, 'fold'], [0.9 * k, 'charge'], [b, 'burst'], [b + 0.2 * k, 'reveal'], [duration, 'settle']];
    }
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    const run: FakeRun = { t: 0, beats, fired: new Set(), hooks, tier, duration, resolve, active: true, result: createBody(genome) };
    state.runs.push(run);
    const fire = (b: CeremonyBeat): void => { if (run.fired.has(b)) return; run.fired.add(b); run.hooks?.onBeat?.(b, { t: run.t, tier }); };
    for (const [t, b] of beats) if (t <= 0) fire(b);
    const handle: CeremonyHandle = {
      done, get active() { return run.active; }, duration, get resultBody() { return run.result; }, resultBodyId: 99,
      skip() { if (!run.active) return; fire('reveal'); fire('settle'); run.active = false; primary = 99; run.resolve(); },
    };
    (run as unknown as { fire: typeof fire }).fire = fire;
    log.rec(kind === 'capsule' ? 'playCapsuleReveal' : 'playMergeCeremony', tier, duration);
    return handle;
  };
  st.playCapsuleReveal = (spec: CapsuleRevealSpec, hooks?: CeremonyHooks) => start('capsule', spec.result.tier, spec.result.genome, spec.createBody, hooks, !!spec.quick);
  st.playMergeCeremony = (spec: MergeCeremonySpec, hooks?: CeremonyHooks) => start('merge', spec.result.tier, spec.result.genome, spec.createBody, hooks, false);
  st.update = (dt: number, input: unknown) => {
    baseUpdate(dt, input as never);
    for (const r of state.runs) {
      if (!r.active) continue;
      r.t += dt;
      for (const [t, b] of r.beats) if (r.t >= t) (r as unknown as { fire(b: CeremonyBeat): void }).fire(b);
      if (r.t >= r.duration) { r.active = false; primary = 99; r.resolve(); }
    }
  };
  // audio round 2 / 3 members, recorded
  const a = w.audio as unknown as Record<string, unknown>;
  a.meterFull = (p: unknown) => log.rec('meterFull', p);
  a.capsuleBeat = (p: unknown) => log.rec('capsuleBeat', p);
  a.reveal = (p: unknown) => log.rec('reveal', p);
  a.setMusic = (p: unknown) => log.rec('setMusic', p);
  a.mergeStart = (p: unknown) => { log.rec('mergeStart', p); return { burst: (q: unknown) => log.rec('mergeBurst', q), stop: () => log.rec('mergeStop') }; };
  return state;
}

interface Rig { w: MockWorld; app: App; fake: ReturnType<typeof upgrade> }
function rig(o: { storage?: ReturnType<typeof memoryStorage> | null; env?: { vibrate: boolean; reducedMotion: boolean }; round2?: boolean; random?: () => number } = {}): Rig {
  const w = createMockWorld({ storage: o.storage ?? null });
  if (o.env) w.deps.env = o.env;
  const fake = o.round2 === false ? { log: recorder(), runs: [], capsule: null } : upgrade(w);
  // the REAL collection module (practice ledger, in memory), on the mock clock + a dev skew the meter accelerator pushes ahead
  const devSkew = { ms: 0 };
  const now = (): number => 1_700_000_000_000 + w.clock.t + devSkew.ms;
  const collection = createCollection({ storage: o.storage ?? null, profile: null, now, random: o.random ?? (() => 0.4) });
  const app = createApp({ ...w.deps, collection, devSkew, epochNow: now });
  app.resize(800, 600, 1);
  app.setPhase('play');
  return { w, app, fake };
}
const run = (r: Rig, ms: number): void => r.w.run(r.app, ms);
async function settle(r: Rig, ms = 0): Promise<void> { for (let i = 0; i < 4; i++) { await tick(); if (ms) run(r, ms / 4); } await tick(); }

/* ───────────────────────── 0. the real SoftBody: CALIBRATION is still needed (or can be retired) ───────────────────────── */
{
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const THREE = await import('three');
  const { createBodyHost } = await import('../../src/input/camera.ts');
  const g = makeStarterGenome();
  const W = 1280, H = 800;
  const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
  const d = Math.max(3.0, 2.4 / (W / H)), pitch = 0.27;
  cam.position.set(0, 0.42 + d * Math.sin(pitch), d * Math.cos(pitch)); cam.lookAt(0, 0.42, 0); cam.updateMatrixWorld(true);
  const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const pts: Array<[number, number]> = [[0, -0.8], [0, -0.5], [0, -0.2], [0, 0], [0, 0.3], [0, 0.6], [-0.5, -0.4], [0.5, -0.4], [-0.6, 0], [0.6, 0], [-0.4, 0.4], [0.4, 0.4], [0.2, -0.65]];
  const releases = (bend: boolean): { n: number; of: number; hasPress: boolean } => {
    let n = 0, of = 0, hasPress = false;
    for (const [px, py] of pts) {
      const b = new SoftBody(g);
      for (let i = 0; i < 30; i++) b.step(1 / 60);
      hasPress = typeof b.metrics.press === 'number';
      const host = createBodyHost({ camera: () => cam, body: () => b, viewport: () => ({ w: W, h: H }) });
      const disc = host.bodyScreen()!;
      const hit = host.hitTest(disc.x + px * disc.r, disc.y + py * disc.r);
      if (!hit) continue;
      of++;
      const dir = bend ? pressDirection(hit.normal, hit.dir, false) : hit.dir;
      b.fingerDown(0, { point: hit.point, normal: hit.normal, dir });
      for (let i = 0; i < 84; i++) { b.fingerPressure(0, 0.55 + 0.45 * smooth((i / 60 - 0.18) / 0.9)); b.step(1 / 60); }
      const out: SoftEvent[] = [];
      b.drainEvents(out); b.fingerUp(0); b.step(1 / 60); b.drainEvents(out);
      if (out.some((e) => e.kind === 'release')) n++;
    }
    return { n, of, hasPress };
  };
  const withBend = releases(true), without = releases(false);
  check(`calibration (real SoftBody): with the press bend a 1.4 s squeeze releases on ${withBend.n}/${withBend.of} hit points, without it on ${without.n}/${without.of}`,
    withBend.of >= 10 && withBend.n >= without.n, `body reports press: ${withBend.hasPress}`);
  const bendStillNeeded = without.n < Math.ceil(0.75 * without.of);
  // Re-specified 2026-10-06 (SHELL-3): the bend was kept only for the release events; physics fix round 2 releases on max(compression,
  // press), so the releases no longer need it (13/13 without it). It stays for the FEEL: a press on the dome goes down and squashes the toy
  // into the table (the browser checks 'held squish' / 'hook hold': compression 0.00 without the bend). So: the bend may stay on; it may
  // be off only when the releases happen without it.
  check(`calibration: CALIBRATION.bendWithPress=${CALIBRATION.bendWithPress} is allowed by the measurement (releases without the bend: ${!bendStillNeeded}; the bend stays for the squash into the table)`,
    CALIBRATION.bendWithPress || !bendStillNeeded || !withBend.hasPress);
  // physics checkpoint 47 re-check: a press on the top of the dome, held 1.4 s, with and without the bend: compression and press peaks, and
  // the release events (ONE release per press either way: the meter is fed one event, its intensity max(compression, press), never a sum)
  const domePress = (bend: boolean): { comp: number; press: number; releases: number; relI: number } => {
    const b = new SoftBody(g);
    for (let i = 0; i < 30; i++) b.step(1 / 60);
    const host = createBodyHost({ camera: () => cam, body: () => b, viewport: () => ({ w: W, h: H }) });
    const disc = host.bodyScreen()!;
    const hit = host.hitTest(disc.x, disc.y - 0.8 * disc.r)!;
    b.fingerDown(0, { point: hit.point, normal: hit.normal, dir: bend ? pressDirection(hit.normal, hit.dir, false) : hit.dir });
    let comp = 0, press = 0;
    for (let i = 0; i < 84; i++) { b.fingerPressure(0, 0.55 + 0.45 * smooth((i / 60 - 0.18) / 0.9)); b.step(1 / 60); comp = Math.max(comp, b.metrics.compression); press = Math.max(press, b.metrics.press ?? 0); }
    const out: SoftEvent[] = [];
    b.drainEvents(out); b.fingerUp(0); for (let i = 0; i < 3; i++) b.step(1 / 60); b.drainEvents(out);
    const rel = out.filter((e) => e.kind === 'release');
    return { comp, press, releases: rel.length, relI: rel[0]?.intensity ?? 0 };
  };
  const domeBend = domePress(true), domeFlat = domePress(false);
  check(`calibration (checkpoint 47): a dome-top press peaks at compression ${domeBend.comp.toFixed(2)} / press ${domeBend.press.toFixed(2)} with the bend, ${domeFlat.comp.toFixed(2)} / ${domeFlat.press.toFixed(2)} without; one release each (intensity ${domeBend.relI.toFixed(2)} / ${domeFlat.relI.toFixed(2)})`,
    domeBend.releases === 1 && domeFlat.releases === 1 && domeBend.relI <= Math.max(domeBend.comp, domeBend.press) + 0.05);
  // THE PULL SIGNAL (feel.ts): a round-2 snap carries the contract's pull level; the shell uses it as is, and the driver's live measure
  // (requested distance from the grab's start over the learned maximum) lands on the same scale
  const pullTo = (dist: number): { snap: number; stretch: number } => {
    const b = new SoftBody(g);
    for (let i = 0; i < 60; i++) b.step(1 / 60);
    let v = 0, mx = -1e9;
    for (let i = 0; i < b.vertexCount; i++) { const x = b.positions[i * 3]; if (x > mx) { mx = x; v = i; } }
    const p0 = { x: b.positions[v * 3], y: b.positions[v * 3 + 1], z: b.positions[v * 3 + 2] };
    b.grab(0, v, p0);
    let maxS = 0;
    for (let i = 1; i <= 90; i++) { b.grabMove(0, { x: p0.x + dist * b.restRadius * Math.min(1, i / 60), y: p0.y, z: p0.z }); b.step(1 / 60); maxS = Math.max(maxS, b.metrics.stretch); }
    const out: SoftEvent[] = []; b.drainEvents(out); b.grabRelease(0); b.step(1 / 60); b.drainEvents(out);
    return { snap: out.find((e) => e.kind === 'snap')?.intensity ?? -1, stretch: maxS };
  };
  const full = pullTo(2.2), half = pullTo(0.85);
  check(`pull signal: a full pull snaps at pull level ${full.snap.toFixed(3)} and a half pull (0.85 R of the gel's 1.7 R) at ${half.snap.toFixed(3)}; metrics.stretch reads only ${full.stretch.toFixed(2)} at the full pull, so the shell takes the snap as is (snapPullLevel = intensity, no 1/stretchFull)`,
    full.snap >= 0.95 && half.snap > 0.35 && half.snap < 0.65 && snapPullLevel(full.snap, true) === full.snap && snapPullLevel(half.snap, true) === half.snap);
  // the press-driven path is the live one: the real body reports press and reaction, and the squelch depth follows press past compression
  {
    const b = new SoftBody(g);
    for (let i = 0; i < 30; i++) b.step(1 / 60);
    const host = createBodyHost({ camera: () => cam, body: () => b, viewport: () => ({ w: W, h: H }) });
    const disc = host.bodyScreen()!;
    const hit = host.hitTest(disc.x, disc.y - 0.5 * disc.r)!;
    b.fingerDown(0, { point: hit.point, normal: hit.normal, dir: pressDirection(hit.normal, hit.dir, true) });
    for (let i = 0; i < 40; i++) { b.fingerPressure(0, 0.8); b.step(1 / 60); }
    const m = b.metrics;
    check(`press-driven path: the real body reports press ${typeof m.press === 'number' ? m.press.toFixed(2) : 'n/a'} and reaction ${typeof m.reaction === 'number' ? m.reaction.toFixed(2) : 'n/a'}; the squelch depth is max(compression ${m.compression.toFixed(2)}, press), bubbles key off press (bubbleAt unused)`,
      typeof m.press === 'number' && typeof m.reaction === 'number' && squeezeDepth(m) === Math.max(m.compression, m.press) && releaseFxLevel(0.9, 0, true) === releaseFxLevel(0, 0.9, true));
  }
}

/* ───────────────────────── 1. fatal-frame path (audit finding 0) ───────────────────────── */
{
  const w = createMockWorld();
  const cbs: Array<(t: number) => void> = [];
  w.deps.raf = (cb) => { cbs.push(cb); return cbs.length; };
  let fatal: unknown = null;
  const app = createApp({ ...w.deps, onFatal: (e) => { fatal = e; } });
  app.resize(800, 600, 1); app.setPhase('play');
  const c = app.input.screenCentre()!;
  app.input.pointerDown({ id: 1, x: c.x, y: c.y, t: w.clock.t });
  w.run(app, 300);
  const body = w.body as unknown as Record<string, unknown>;
  body.step = () => { throw new Error('physics NaN (step)'); };
  body.fingerUp = () => { throw new Error('physics NaN (fingerUp)'); };
  body.grabRelease = () => { throw new Error('physics NaN (grabRelease)'); };
  app.start();
  let escaped = 0;
  for (let i = 0; i < 8; i++) { const cb = cbs.shift(); if (!cb) break; try { cb(1000 + i * 16); } catch { escaped++; } }
  check('fatal: finger down, then body.step AND body.fingerUp throw: nothing escapes the rAF callback, onFatal is called, phase is error, the loop stopped',
    escaped === 0 && fatal instanceof Error && app.phase === 'error' && cbs.length === 0, `escaped ${escaped}, phase ${app.phase}, pending rAF ${cbs.length}`);
  let threw = false;
  try { app.setPhase('title'); app.setPhase('play'); app.setPhase('error'); } catch { threw = true; }
  check('fatal: setPhase with a body whose finger calls throw never throws (cleanup is guarded)', !threw);
}

/* ───────────────────────── 2. context loss: suspend / unsuspend (audit finding 1) ───────────────────────── */
{
  const r = rig({ round2: false });
  const pausedCalls: boolean[] = [];
  (r.w.audio as unknown as { setPaused: (p: boolean) => void }).setPaused = (p) => { pausedCalls.push(p); };
  const c = r.app.input.screenCentre()!;
  r.app.input.pointerDown({ id: 1, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 600);
  const live0 = r.w.audio.live.size;
  r.app.suspend('context');
  const steps0 = r.w.body.stepCalls;
  run(r, 500);
  r.app.input.pointerDown({ id: 2, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 200);
  check('context lost: the held squelch ends, the finger is released, audio.setPaused(true), the sim does not step, new pointers are refused',
    live0 === 1 && r.w.audio.live.size === 0 && !r.w.body.fingerIsDown(0) && pausedCalls.join() === 'true' && r.w.body.stepCalls === steps0 && r.w.body.rec.count('fingerDown') === 1,
    `live ${live0}->${r.w.audio.live.size}, setPaused ${pausedCalls.join()}, steps +${r.w.body.stepCalls - steps0}`);
  r.app.unsuspend('context');
  r.w.clock.t += 16; r.app.frame(r.w.clock.t);
  const last = r.w.body.rec.of('step').at(-1)!.args[0] as number;
  check('context restored: audio resumes, the sim steps again with a normal dt (no spike), input works', pausedCalls.join() === 'true,false' && Math.abs(last - 1 / 60) < 1e-9 && r.app.input.live);
  r.app.suspend('hidden'); r.app.suspend('context'); r.app.unsuspend('hidden');
  check('pause reasons stack: hidden + context, one lifted, still paused', r.app.pauseReasons.join() === 'context' && pausedCalls.at(-1) === true);
}

/* ───────────────────────── 3. atomic swap + adoption (audit finding 3) ───────────────────────── */
{
  const r = rig();
  let ids = 0;
  r.app.on('identity', () => ids++);
  const sb = r.w.stage.rec.count('setBody'), b0 = r.app.body;
  const ok = r.app.setGenome(speciesBaseGenome('dollop', 6));
  check('swap: a successful setGenome changes body, genome and identity together and fires one identity event', ok && r.app.body !== b0 && ids === 1 && r.w.stage.rec.count('setBody') === sb + 1);
  const w = createMockWorld();
  const app3 = createApp({ ...w.deps, createBody: (g) => { if (g.seed === 12345) throw new Error('bad genome'); return w.deps.createBody(g); } });
  app3.resize(800, 600, 1);
  let n3 = 0;
  app3.on('identity', () => n3++);
  const g3 = app3.genome, b3 = app3.body, sb3 = w.stage.rec.count('setBody');
  const res3 = app3.setGenome({ ...speciesBaseGenome('dollop', 1), seed: 12345 });
  check('swap: createBody throws -> setGenome returns false; genome, body, identity and the stage unchanged; no identity event (atomic)',
    res3 === false && app3.genome === g3 && app3.body === b3 && n3 === 0 && w.stage.rec.count('setBody') === sb3);
  errors.length = 0; // the failed build was reported on purpose
}

/* ───────────────────────── 4. capsule loop with the fake round-2 stage ───────────────────────── */
{
  const r = rig();
  // credits arrive (dev grant) while a finger squishes: the plink is quiet
  const c = r.app.input.screenCentre()!;
  r.app.input.pointerDown({ id: 1, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 300);
  r.app.debug.shell.grant(1);
  const mf = r.fake.log.of('meterFull');
  check('meter full: audio.meterFull({ quiet: true }) mid-squish, one stage.dropCapsule()', mf.length === 1 && (mf[0].args[0] as { quiet: boolean }).quiet === true && r.fake.log.count('dropCapsule') === 1);
  r.app.input.pointerUp({ id: 1, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 300);
  await settle(r);
  r.app.debug.shell.grant(2);
  check('queue: more credits do not replace the capsule on the table (one dropCapsule), the reading counts 3', r.fake.log.count('dropCapsule') === 1 && r.app.capsules.reading.credits === 3);
  // hold to open: a press on the capsule belongs to the capsule (no body finger), squeeze rises, capsuleBeat grab
  const fd0 = r.w.body.rec.count('fingerDown');
  r.app.input.pointerDown({ id: 7, x: 700, y: 400, t: r.w.clock.t });
  run(r, 250);
  const sq = r.fake.log.of('setSqueeze').map((x) => x.args[0] as number);
  check('hold-to-open: the press goes to the capsule (no fingerDown on the body), setSqueeze rises, capsuleBeat grab at the press and at 0.18 s',
    r.w.body.rec.count('fingerDown') === fd0 && sq.length > 3 && sq.at(-1)! > 0.4 && r.fake.log.of('capsuleBeat').filter((x) => (x.args[0] as { beat: string }).beat === 'grab').length === 2, `squeeze ${sq.at(-1)?.toFixed(2)}`);
  run(r, 300);
  await settle(r);
  check('hold-to-open: at 0.5 s the capsule opens: playCapsuleReveal with the collection\'s result (result first)', r.fake.log.count('playCapsuleReveal') === 1 && r.app.ceremonies.active);
  // input lock: a pointer on the body during the ceremony is a skip, never a finger
  const fd1 = r.w.body.rec.count('fingerDown');
  r.app.input.pointerDown({ id: 8, x: c.x, y: c.y, t: r.w.clock.t });
  r.app.input.pointerUp({ id: 8, x: c.x, y: c.y, t: r.w.clock.t });
  check('ceremony: input is locked (a tap reaches no body finger)', r.w.body.rec.count('fingerDown') === fd1);
  const run0 = r.fake.runs[0];
  check('ceremony: a tap before 350 ms does not skip', run0.active && r.app.ceremonies.elapsedMs() < SKIP_GATE_MS);
  const beatsBefore = r.fake.log.calls.filter((x) => x.name === 'capsuleBeat').map((x) => (x.args[0] as { beat: string }).beat);
  run(r, 3000);
  await settle(r, 100);
  const beats = r.fake.log.calls.filter((x) => ['capsuleBeat', 'reveal'].includes(x.name)).map((x) => x.name === 'reveal' ? 'reveal' : (x.args[0] as { beat: string }).beat);
  const tier = run0.tier;
  check(`ceremony (${tier}): sounds in the time-map order grab, crack, burst{tier}, then the reveal motif (Common/Uncommon) or reveal at preroll (Rare+)`,
    tier === 'common' || tier === 'uncommon' ? beats.slice(-4).join() === 'grab,crack,burst,reveal' : beats.join().includes('crack,reveal,burst'), beats.join());
  void beatsBefore;
  check('after the reveal: the play body IS the stage\'s resultBody (adopted, no new setBody), identity = the result, credits 2',
    r.app.body === run0.result && r.w.stage.rec.count('setBody') === 1 && r.app.identity.tier === tier && r.app.capsules.reading.credits === 2, `tier ${r.app.identity.tier}`);
  check('after the reveal: the next queued capsule drops', r.fake.log.count('dropCapsule') === 2);
  // the adopted body takes fingers
  const nb = run0.result as unknown as { rec: ReturnType<typeof recorder> };
  r.app.input.pointerDown({ id: 9, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 50);
  check('the adopted result body receives the next poke', nb.rec.count('fingerDown') === 1);
  r.app.input.pointerUp({ id: 9, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 300);
}

/* ───────────────────────── 5. skip gate, Rare+ preroll, calm, merge, skip before burst ───────────────────────── */
{
  const r = rig();
  const rare = speciesBaseGenome('dollop', 3);
  const rareSpecies = (await import('../../src/data/catalog.ts')).SPECIES_BY_TIER[2][0].id;
  const g = speciesBaseGenome(rareSpecies, 77);
  void rare;
  const p = r.app.ceremonies.playReveal({ itemId: 'x', genome: g, tier: tierOf(g.species), isNew: true, copies: 1, nickname: null });
  run(r, 200);
  r.app.input.skip();
  check('skip gate: a key at 200 ms is consumed but does not skip', r.fake.runs[0].active);
  run(r, 200);
  const pre = r.fake.log.of('reveal').length;
  r.app.input.skip();
  await p;
  const rev = r.fake.log.of('reveal');
  check('skip gate: a key at 400 ms skips; a Rare skipped before its pre-roll still plays its motif once (short)', !r.fake.runs[0].active && rev.length === pre + 1 && typeof (rev.at(-1)!.args[0] as { durationS?: number }).durationS === 'number');
  // Rare natural run: reveal() at preroll, burst after
  const r2 = rig();
  const p2 = r2.app.ceremonies.playReveal({ itemId: 'y', genome: g, tier: 'rare', isNew: false, copies: 2, nickname: null });
  run(r2, 3000); await p2;
  const seq = r2.fake.log.calls.filter((x) => ['capsuleBeat', 'reveal'].includes(x.name)).map((x) => x.name === 'reveal' ? 'reveal' : (x.args[0] as { beat: string }).beat);
  check('Rare: reveal() starts at preroll (its swell), burst after it, no second motif at the reveal beat', seq.join() === 'grab,crack,reveal,burst', seq.join());
  // calm: setCalmEffects(true) before the start, calm on every sound, durations x0.65, shake scale 0
  const r3 = rig();
  r3.app.setSetting('calm', true);
  const shake = r3.w.stage.rec.of('setShakeScale').at(-1)!.args[0];
  const p3 = r3.app.ceremonies.playReveal({ itemId: 'z', genome: g, tier: 'rare', isNew: true, copies: 1, nickname: null });
  const calmBefore = r3.fake.log.of('setCalmEffects').at(-1)!.args[0];
  run(r3, 3000); await p3;
  const calmFlags = r3.fake.log.calls.filter((x) => ['capsuleBeat', 'reveal'].includes(x.name)).map((x) => (x.args[0] as { calm?: boolean }).calm);
  check('calm: setCalmEffects(true) before the ceremony, calm: true on every ceremony sound, duration x0.65, screen shake scale 0',
    calmBefore === true && calmFlags.length >= 3 && calmFlags.every((x) => x === true) && Math.abs(r3.fake.runs[0].duration - 2.6 * 0.65) < 1e-9 && shake === 0, `${calmFlags.join()} shake ${shake}`);
  // merge: mergeStart at press, burst at burst, adopt; skip before burst -> stop + motif
  const r4 = rig();
  const parents = [speciesBaseGenome('dollop', 1), speciesBaseGenome('dollop', 2)].map((x) => ({ genome: x, tier: 'common' as TierName }));
  const pm = r4.app.playMerge(parents, { itemId: 'm1', genome: g, tier: 'rare', isNew: true, copies: 1, nickname: null, tierUp: true });
  run(r4, 6000); await pm;
  const ml = r4.fake.log.calls.filter((x) => x.name.startsWith('merge')).map((x) => x.name);
  const burstArg = r4.fake.log.of('mergeBurst')[0]?.args[0] as { tier: string; tierUp: boolean } | undefined;
  check('merge: mergeStart at press, burst({ tier, tierUp }) at T3, no stop, the result adopted', ml.join() === 'mergeStart,mergeBurst' && burstArg?.tier === 'rare' && burstArg.tierUp === true && r4.app.body === r4.fake.runs[0].result, ml.join());
  const r5 = rig();
  const pm5 = r5.app.playMerge(parents, { itemId: 'm2', genome: g, tier: 'rare', isNew: false, copies: 3, nickname: null, tierUp: false });
  run(r5, 500);
  r5.app.input.skip();
  await pm5;
  const ml5 = r5.fake.log.calls.filter((x) => x.name.startsWith('merge') || x.name === 'reveal').map((x) => x.name);
  check('merge skipped before T3: the hum is stopped, no burst, the motif plays instead, the result is adopted', ml5.join() === 'mergeStart,mergeStop,reveal' && r5.app.body === r5.fake.runs[0].result, ml5.join());
  // Skip animations: skip right after the start
  const r6 = rig();
  r6.app.setSetting('skipAnimations', true);
  const p6 = r6.app.ceremonies.playReveal({ itemId: 's', genome: g, tier: 'rare', isNew: true, copies: 1, nickname: null });
  await p6;
  check('Skip animations: the ceremony ends at once (skip right after the start), the result adopted', !r6.fake.runs[0].active && r6.app.body === r6.fake.runs[0].result);
  // Fast open: repeat Uncommon -> quick; repeat Common always quick (DESIGN 6.1)
  const r7 = rig();
  const unc = (await import('../../src/data/catalog.ts')).SPECIES_BY_TIER[1][0].id;
  const pu = r7.app.ceremonies.playReveal({ itemId: 'u', genome: speciesBaseGenome(unc, 1), tier: 'uncommon', isNew: false, copies: 2, nickname: null });
  run(r7, 3000); await pu;
  r7.app.setSetting('fastOpen', true);
  const pu2 = r7.app.ceremonies.playReveal({ itemId: 'u2', genome: speciesBaseGenome(unc, 2), tier: 'uncommon', isNew: false, copies: 3, nickname: null });
  run(r7, 3000); await pu2;
  const pc = r7.app.ceremonies.playReveal({ itemId: 'c', genome: speciesBaseGenome('dollop', 9), tier: 'common', isNew: false, copies: 2, nickname: null });
  run(r7, 3000); await pc;
  const durs = r7.fake.log.of('playCapsuleReveal').map((x) => x.args[1] as number);
  check('quick pop: a repeat Uncommon is full length without Fast open, 0.8 s with it; a repeat Common is always 0.8 s', durs.join() === '2,0.8,0.8', durs.join());
}

/* ───────────────────────── 5b. flash safety: no ceremony starts within 1 s of the previous burst (DESIGN 6.6) ───────────────────────── */
{
  const r = rig();
  const cat = await import('../../src/data/catalog.ts');
  const mythic = speciesBaseGenome(cat.SPECIES_BY_TIER[5][0].id, 5);
  const common = speciesBaseGenome(cat.SPECIES_BY_TIER[0][1].id, 6);
  // step in slices and let the promise continuations run between them (a ceremony ends in `await handle.done`)
  const runAsync = async (ms: number, slice = 50): Promise<void> => { for (let t = 0; t < ms; t += slice) { run(r, slice); await tick(); await tick(); } };
  const p1 = r.app.ceremonies.playReveal({ itemId: 'm1', genome: mythic, tier: 'mythic', isNew: true, copies: 1, nickname: null });
  let guard = 0;
  while (!r.app.ceremonies.recentBeats().some((b) => b.beat === 'burst') && guard++ < 200) await runAsync(20, 20);
  r.app.input.skip();                                   // skipped right after its burst (past the 350 ms gate)
  const repeat = { genome: common, tier: 'common' as TierName, isNew: false, copies: 3, nickname: null, quickEligible: true };
  const p2 = r.app.ceremonies.playReveal({ ...repeat, itemId: 'c1' });   // the next open, at once
  const p3 = r.app.ceremonies.playReveal({ ...repeat, itemId: 'c2' });   // and a back-to-back quick pop behind it
  const pendingAtOnce = r.app.ceremonies.pending;
  await runAsync(6000);
  await p1; await p2; await p3;
  const bs = r.app.ceremonies.recentBeats();
  const bursts = bs.filter((b) => b.beat === 'burst').map((b) => b.t);
  const starts = bs.filter((b) => b.beat === 'grab').map((b) => b.t);
  const gaps = bursts.slice(1).map((t, i) => t - bursts[i]);
  const startGaps = starts.slice(1).map((t, i) => t - bursts[i]);
  check(`spacing: a Mythic skipped right after its burst, then two quick pops requested at once: each starts >= ${BURST_SPACING_MS} ms after the previous burst, none is lost`,
    pendingAtOnce && bursts.length === 3 && starts.length === 3 && startGaps.every((g) => g >= BURST_SPACING_MS) && !r.app.ceremonies.pending && r.app.identity.itemId === 'c2',
    `burst gaps ${gaps.map((g) => g.toFixed(0)).join(', ')} ms; start after previous burst ${startGaps.map((g) => g.toFixed(0)).join(', ')} ms`);
  check('spacing: the wait is no longer than needed (each start within one step slice of the 1 s mark)', startGaps.every((g) => g < BURST_SPACING_MS + 60), startGaps.map((g) => g.toFixed(0)).join(', '));
  check('spacing: consecutive bursts are >= 1 s apart', gaps.length === 2 && gaps.every((g) => g >= BURST_SPACING_MS), gaps.map((g) => g.toFixed(0)).join(', '));
}

/* ───────────────────────── 5c. switch anytime + the play mat (SHELL-2b) ───────────────────────── */
{
  const { createPlayHistory, PLAY_KEY } = await import('../../src/shell/playHistory.ts');
  const mem = memoryStorage();
  const h1 = createPlayHistory(mem);
  h1.note('g-aaaaaaaaaaaa'); h1.note('g-bbbbbbbbbbbb'); h1.note('g-aaaaaaaaaaaa'); h1.note('bad id!');
  const h2 = createPlayHistory(mem);
  check('play history: the play item and the recent list (newest first, no repeats, junk refused) survive a reload of the store', h2.current === 'g-aaaaaaaaaaaa' && h2.recent().join() === 'g-aaaaaaaaaaaa,g-bbbbbbbbbbbb' && !!mem.getItem(PLAY_KEY), `${h2.current} [${h2.recent().join()}]`);
  mem.setItem(PLAY_KEY, '{"play": 42, "recent": ["ok-id", {"x":1}, "no spaces allowed"]}');
  const h3 = createPlayHistory(mem);
  check('play history: a hand-edited blob keeps only valid ids', h3.current === null && h3.recent().join() === 'ok-id', `${h3.current} [${h3.recent().join()}]`);

  // switchTo through the real collection: at once when idle, queued during a ceremony and applied right after it
  const r = rig();
  const runAsync = async (ms: number, slice = 50): Promise<void> => { for (let t = 0; t < ms; t += slice) { run(r, slice); await tick(); await tick(); } };
  for (let i = 0; i < 3; i++) {
    (r.app as unknown as { debug: { shell: { grant(n: number): boolean } } }).debug.shell.grant(1);
    await runAsync(300);
    const op = r.app.capsules.openNext();   // resolves when its reveal ends: the stage must be stepped meanwhile
    await runAsync(3500);
    await op;
  }
  const items = r.app.hoard.items();
  const cur = r.app.identity.itemId;
  const other = items.find((it) => it.id !== cur)!;
  const d1 = r.app.switchTo(other.id);
  check('switchTo: an item of the collection becomes the play body at once (identity and history follow)', d1 === 'done' && r.app.identity.itemId === other.id && r.app.history.current === other.id, `${d1} -> ${r.app.identity.itemId}`);
  const third = items.find((it) => it.id !== other.id)!;
  const cat = await import('../../src/data/catalog.ts');
  const g = speciesBaseGenome(cat.SPECIES_BY_TIER[0][2].id, 9);
  const p = r.app.ceremonies.playReveal({ itemId: 'zz', genome: g, tier: 'common', isNew: false, copies: 2, nickname: null });
  run(r, 100);
  const q = r.app.switchTo(third.id);
  const during = r.app.identity.itemId;
  await runAsync(3000); await p; await tick(); await tick();
  check('switchTo during a reveal: queued, then applied right after the ceremony (the reveal result first, then the asked-for one)', q === 'queued' && during !== third.id && r.app.identity.itemId === third.id, `${q}; during ${during}; after ${r.app.identity.itemId}`);
  check('switchTo: an unknown item is refused and nothing changes', r.app.switchTo('g-nothere00000') === 'missing' && r.app.identity.itemId === third.id);

  // the play mat: limit by quality (the mock stage reports med: 4), offsets apart, put back
  const out1 = r.app.mat.add({ genome: items[0].genome, itemId: items[0].id });
  const out2 = r.app.mat.add({ genome: items[1].genome, itemId: items[1].id });
  const out3 = r.app.mat.add({ genome: items[2]?.genome ?? g, itemId: items[2]?.id ?? 'x-3' });
  const out4 = r.app.mat.add({ genome: g, itemId: 'x-4' });
  const pos = r.app.bodies.extras.map((x) => x.position);
  const apart = pos.every((a, i) => pos.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.z - b.z) > 0.5)) && pos.every((a) => Math.hypot(a.x, a.z) > 0.5);
  check('play mat: med quality holds 4 (the play body and three brought out); a fourth is refused as "full"; every body has its own spot', out1 === null && out2 === null && out3 === null && out4 === 'full' && r.app.mat.count === 4 && apart, `${[out1, out2, out3, out4].join()} count ${r.app.mat.count} ${JSON.stringify(pos)}`);
  const stepped = r.app.bodies.extras.map((x) => x.body);
  r.app.mat.clear();
  check('play mat: put back clears every extra (count 1)', r.app.mat.count === 1 && stepped.length === 3);

  // stage B2 (body-to-body contact, feature-detected): a physics whose bodies offer collide() and can be built at a point. The extras are
  // built AT their mat spot (shared space, drawn at the origin), every body calls collide(others) once per frame BEFORE any body steps,
  // and a 'bump' event goes to audio.bump and a light haptic (not twice inside 0.12 s); the meter pays nothing for it.
  {
    const w2 = createMockWorld({ storage: null });
    upgrade(w2);
    const order: string[] = [];
    const base = w2.deps.createBody;
    let seq = 0;
    w2.deps.createBody = (gg, o) => {
      const b = base(gg) as ReturnType<typeof base> & { stepCalls: number; center: { x: number; y: number; z: number } };
      const name = `b${seq++}`;
      if (o?.at) { b.center.x = o.at.x; b.center.y = o.at.y; b.center.z = o.at.z; }
      (b as SoftBodyLike & { collide?: (others: readonly SoftBodyLike[]) => void }).collide = (others) => { order.push(`collide ${name} ${others.length}`); };
      const st = b.step.bind(b);
      b.step = (dt: number) => { order.push(`step ${name}`); st(dt); };
      return b;
    };
    const audioRec = w2.audio as unknown as Record<string, unknown>;
    const bumps: unknown[] = [];
    audioRec.bump = (pp: unknown) => { bumps.push(pp); };
    const coll2 = createCollection({ storage: null, profile: null, now: () => 1_700_000_000_000 + w2.clock.t, random: () => 0.4 });
    const app2 = createApp({ ...w2.deps, collection: coll2, epochNow: () => 1_700_000_000_000 + w2.clock.t });
    app2.resize(800, 600, 1); app2.setPhase('play');
    const ga = speciesBaseGenome(cat.SPECIES_BY_TIER[0][3].id, 11), gb = speciesBaseGenome(cat.SPECIES_BY_TIER[1][0].id, 12);
    const a1 = app2.mat.add({ genome: ga, itemId: 'mat-a' }), a2 = app2.mat.add({ genome: gb, itemId: 'mat-b' });
    const xs = app2.bodies.extras;
    const placed = xs.every((x) => x.shared && x.position.x === 0 && x.position.z === 0 && Math.hypot(x.body.center.x, x.body.center.z) > 0.5);
    order.length = 0;
    w2.run(app2, 1000 / 60);
    const firstStep = order.findIndex((e) => e.startsWith('step'));
    const collides = order.filter((e) => e.startsWith('collide'));
    check('stage B2: with collide() and placement the extras are built at their mat spots (shared space, drawn where they simulate); each of the 3 bodies calls collide(the 2 others) once per frame, before any body steps',
      a1 === null && a2 === null && placed && app2.bodies.contactBodies === 3 && collides.length === 3 && collides.every((e) => e.endsWith(' 2')) && firstStep === 3, order.join(' | '));
    const fill0 = app2.collection.meter().fill;
    const pops0 = w2.haptics.rec.count('pop');
    const xb = xs[0].body as unknown as { queue(ev: Partial<SoftEvent> & { kind: SoftEvent['kind'] }): void };
    xb.queue({ kind: 'bump', intensity: 0.6 });
    (app2.body as unknown as { queue(ev: Partial<SoftEvent> & { kind: SoftEvent['kind'] }): void }).queue({ kind: 'bump', intensity: 0.6 });
    w2.run(app2, 1000 / 60);
    check('stage B2: a bump event (from either body) plays audio.bump with its intensity, one light haptic tick for the pair, and pays nothing',
      bumps.length === 2 && (bumps[0] as { intensity: number }).intensity === 0.6 && w2.haptics.rec.count('pop') === pops0 + 1 && app2.collection.meter().fill === fill0,
      `bumps ${bumps.length}, haptic ticks +${w2.haptics.rec.count('pop') - pops0}, fill ${fill0} -> ${app2.collection.meter().fill}`);
    // a physics with collide but without placement (the body comes back at the origin): kept apart, never collides inside another body
    const w3 = createMockWorld({ storage: null });
    upgrade(w3);
    const base3 = w3.deps.createBody;
    let collided = 0;
    w3.deps.createBody = (gg) => { const b = base3(gg); (b as SoftBodyLike & { collide?: () => void }).collide = () => { collided++; }; return b; };
    const app3 = createApp({ ...w3.deps, collection: createCollection({ storage: null, profile: null, now: () => 1_700_000_000_000 + w3.clock.t }), epochNow: () => 1_700_000_000_000 + w3.clock.t });
    app3.resize(800, 600, 1); app3.setPhase('play');
    app3.mat.add({ genome: ga, itemId: 'mat-a' });
    w3.run(app3, 50);
    check('stage B2: collide() without placement keeps the extra apart (render offset, no contact) instead of colliding two bodies at one spot',
      app3.bodies.extras.length === 1 && !app3.bodies.extras[0].shared && Math.hypot(app3.bodies.extras[0].position.x, app3.bodies.extras[0].position.z) > 0.5 && collided === 0 && app3.bodies.contactBodies === 0, `collided ${collided}`);
    app2.dispose(); app3.dispose();
  }
  // the mat's frame-time guard: with the stage's frame time average over FRAME_BUSY_MS a second squishy is refused as 'busy' (the browser
  // harness lifts it through the dev hook because SwiftShader is always over it)
  {
    const { FRAME_BUSY_MS } = await import('../../src/shell/mat.ts');
    const r4 = rig();
    const st = r4.w.stage as unknown as { stats: () => { drawCalls: number; triangles: number; tier: string; frameMsEma: number } };
    const base = st.stats.bind(st);
    st.stats = () => ({ ...base(), tier: 'high', frameMsEma: FRAME_BUSY_MS + 15 });
    const ga = speciesBaseGenome(cat.SPECIES_BY_TIER[0][3].id, 11), gb = speciesBaseGenome(cat.SPECIES_BY_TIER[1][0].id, 12);
    const b1 = r4.app.mat.add({ genome: ga, itemId: 'busy-a' }), b2 = r4.app.mat.add({ genome: gb, itemId: 'busy-b' });
    r4.app.mat.setBusyLimit(1e9);
    const b3 = r4.app.mat.add({ genome: gb, itemId: 'busy-b' });
    check(`play mat: over ${FRAME_BUSY_MS} ms a frame the next squishy is refused as "busy" (the first always comes out); lifting the guard lets it out`, b1 === null && b2 === 'busy' && b3 === null, `${b1}, ${b2}, ${b3}`);
    r4.app.dispose();
  }
}

/* ───────────────────────── 5d. CUT & RECONNECT, the shell side (CUT.md 1, 2, 4; cut.ts) against cut-capable mock bodies ───────────────────────── */
{
  const { createCutter, SHARE_EPS, JOIN_ALL_S, JOIN_HOLD_S, JOIN_S, NECK_DEFAULT_S, NECK_HOLD_S, HOME_MAX_S, supportAlong } = await import('../../src/shell/cut.ts');
  const { createBodyManager } = await import('../../src/shell/bodies.ts');
  const { createMockBody } = await import('../mocks.ts');
  type V = { x: number; y: number; z: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the mock keeps the PieceOpts it was built with in `piece`; CUT2 gave SoftBodyLike its own `piece?: PieceInfo`, so this field is untyped here (the whole cut mock is replaced by S4)
  type CutMock = ReturnType<typeof createMockBody> & { frac: number; piece: any; necks: number; lastNeck: number; trembles: number[]; fracCalls: Array<[number, number]>; moved: number; whole: boolean; held: boolean };
  /** a mock body that can be cut: a sphere of radius 0.5 cbrt(frac) at its centre; measureCut is the exact sphere-cap share */
  const cutBody = (g: Genome, o: { at?: V; piece?: { frac: number; chunk?: boolean; cutNormal?: V; at?: V } } = {}): CutMock => {
    const b = createMockBody(g) as CutMock;
    const frac = o.piece?.frac ?? 1, at = o.piece?.at ?? o.at ?? null;
    const k = Math.cbrt(frac);
    const c = b.center as V;
    const nx = at ? at.x : 0, ny = at ? at.y : 0.4, nz = at ? at.z : 0;
    const P = b.positions;
    for (let i = 0; i < b.vertexCount; i++) { P[i * 3] = nx + P[i * 3] * k; P[i * 3 + 1] = ny + (P[i * 3 + 1] - 0.4) * k; P[i * 3 + 2] = nz + P[i * 3 + 2] * k; }
    c.x = nx; c.y = ny; c.z = nz;
    (b as unknown as { restRadius: number }).restRadius = 0.5 * k;
    b.frac = frac; b.piece = o.piece ?? null; b.necks = 0; b.lastNeck = 0; b.trembles = []; b.fracCalls = []; b.moved = 0; b.whole = !o.piece || (o.piece.frac >= 1 && !o.piece.chunk);
    const m = b as unknown as Record<string, unknown>;
    m.measureCut = (pl: { point: V; normal: V }) => {
      const l = Math.hypot(pl.normal.x, pl.normal.y, pl.normal.z);
      const sd = ((c.x - pl.point.x) * pl.normal.x + (c.y - pl.point.y) * pl.normal.y + (c.z - pl.point.z) * pl.normal.z) / l;
      const R = 0.5 * Math.cbrt(b.frac);
      if (sd >= R || sd <= -R) return null;
      const hgt = R + sd;
      return (Math.PI * hgt * hgt * (3 * R - hgt) / 3) / (4 / 3 * Math.PI * R * R * R);
    };
    m.setNeck = (pl: unknown, t: number) => { if (pl) { b.necks++; b.lastNeck = t; } else b.lastNeck = 0; };
    m.setFrac = (f: number, sec: number) => { b.fracCalls.push([f, sec]); b.frac = Math.min(1, Math.max(SHARE_EPS, f)); };
    m.tremble = (a: number) => { b.trembles.push(a); };
    // moveTo: a spring toward the point on the table (the mock slides 1.5 m/s while stepped, horizontally, like the physics on the table)
    let goal: V | null = null;
    m.collide = () => { /* stage B2 contact: the manager's contact lists are what the checks read */ };
    b.held = false;
    m.moveTo = (pt: V | null) => { if (pt) b.moved++; goal = pt ? { ...pt } : null; b.held = !!pt; };
    const baseStep = b.step.bind(b);
    m.step = (dt: number) => {
      baseStep(dt);
      if (!goal) return;
      const dx = goal.x - c.x, dz = goal.z - c.z, l = Math.hypot(dx, dz), s2 = l > 1e-9 ? Math.min(1, (1.5 * dt) / l) : 0;
      const mx = dx * s2, mz = dz * s2;
      c.x += mx; c.z += mz;
      for (let i = 0; i < b.vertexCount; i++) { P[i * 3] += mx; P[i * 3 + 2] += mz; }
    };
    return b;
  };
  const g0 = makeStarterGenome();
  const world = (o: { tier?: 'low' | 'med' | 'high' } = {}) => {
    const w = createMockWorld({ storage: null });
    upgrade(w);
    const st = w.stage as unknown as Record<string, unknown>;
    const seams: Array<[number, number]> = [], bridges: Array<[number, number, number]> = [], parts: Array<[number, number]> = [], chunks: boolean[] = [];
    st.setCutSeam = (id: number, pl: unknown, t: number) => { seams.push([id, pl ? t : 0]); };
    st.setBridge = (a: number, b2: number, t: number) => { bridges.push([a, b2, t]); };
    st.partPieces = (a: number, b2: number) => { parts.push([a, b2]); };
    const baseAdd = st.addBody as (b: SoftBodyLike, g: Genome, o?: { chunk?: boolean }) => number;
    st.addBody = (b: SoftBodyLike, g: Genome, o?: { chunk?: boolean }) => { chunks.push(!!o?.chunk); return baseAdd(b, g, o); };
    if (o.tier) { const base = (w.stage.stats as () => { drawCalls: number; triangles: number; tier: string; frameMsEma: number }).bind(w.stage); (w.stage as unknown as { stats: () => unknown }).stats = () => ({ ...base(), tier: o.tier }); }
    const audioCalls: Array<[string, Record<string, unknown>]> = [];
    const a = w.audio as unknown as Record<string, unknown>;
    a.cut = (p: Record<string, unknown>) => audioCalls.push(['cut', p]);
    a.rejoin = (p: Record<string, unknown>) => audioCalls.push(['rejoin', p]);
    a.strand = (p: Record<string, unknown>) => audioCalls.push(['strand', p]);
    const made: CutMock[] = [];
    w.deps.createBody = (g, op) => { const b = cutBody(g, op ?? {}); made.push(b); w.bodies.push(b); return b; };
    return { w, seams, bridges, parts, chunks, audioCalls, made };
  };
  const run2 = (w: ReturnType<typeof createMockWorld>, app: { frame(ts: number): void }, ms: number): void => w.run(app, ms);
  const rigCut = (o: { tier?: 'low' | 'med' | 'high'; storage?: ReturnType<typeof memoryStorage> } = {}) => {
    const W = world(o);
    if (o.storage) W.w.deps.storage = o.storage;
    const coll = createCollection({ storage: o.storage ?? null, profile: null, now: () => 1_700_000_000_000 + W.w.clock.t, random: () => 0.4 });
    const app = createApp({ ...W.w.deps, collection: coll, epochNow: () => 1_700_000_000_000 + W.w.clock.t, genome: g0 });
    app.resize(800, 600, 1); app.setPhase('play');
    return { ...W, app, coll };
  };
  const neckMs = (NECK_DEFAULT_S + NECK_HOLD_S) * 1000 + 120;

  // X01: a centre cut (Split in two) makes two pieces whose shares sum to 1; the anchor is the play body, the other an eyeless twin
  {
    const r = rigCut();
    const notices: string[] = [];
    r.app.on('notice', (t) => notices.push(t));
    const playBefore = r.app.body, idBefore = r.app.identity;
    const items0 = r.app.hoard.items().length;
    check('CUT: the Cut tool is offered only when the physics can cut (the mock world without the members: not supported; with them: supported)',
      r.app.cut.supported && !(() => { const w0 = createMockWorld({ storage: null }); upgrade(w0); const a0 = createApp({ ...w0.deps, collection: createCollection({ storage: null, profile: null }) }); const s0 = a0.cut.supported; a0.setTool('cut'); const t0 = a0.tool; a0.dispose(); return s0 || t0 !== 'hand'; })());
    const res = r.app.cut.splitInTwo();
    run2(r.w, r.app, 60);
    const necking = (playBefore as unknown as CutMock).necks > 0 && r.seams.length > 0 && r.app.cut.busy;
    run2(r.w, r.app, neckMs);
    const fr = r.app.cut.fracs();
    const play = r.app.body as unknown as CutMock;
    const xs = r.app.bodies.extras;
    const starts = r.audioCalls.filter((c) => c[0] === 'cut' && c[1].phase === 'start'), seps = r.audioCalls.filter((c) => c[0] === 'cut' && c[1].phase === 'separate');
    check('X01 shell: Split in two necks (setNeck + setCutSeam every step, audio cut start), then two pieces whose shares sum to 1 (0.5 %); built with PieceOpts of those shares',
      res === 'cut' && necking && fr.length === 2 && Math.abs(fr[0] + fr[1] - 1) < 0.005 && starts.length === 1 && seps.length === 1 && play.piece !== null && Math.abs(play.piece.frac - fr[0]) < 1e-9,
      `${res}; fracs ${fr.map((f) => f.toFixed(3)).join(' + ')}; seams ${r.seams.length}; audio ${r.audioCalls.map((c) => `${c[0]}:${c[1].phase ?? ''}`).join(',')}`);
    // RE-SPECIFIED because the owner changed the design on 2026-10-08 (CUT2.md 14): there is no face piece and no chunk. Both are peers: no chunk flag reaches the stage; the play body is the larger child; identity unchanged; partPieces once.
    check('X03 shell: both pieces are peers: no chunk flag reaches the stage (AddBodyOpts.chunk is never passed), the play body is the LARGER child (a new body, same identity and genome), the other is the one extra on the mat; partPieces(a, b) once',
      play !== playBefore && play.piece?.chunk === false && xs.length === 1 && xs[0].piece === true && (xs[0].body as CutMock).piece?.chunk === false && r.chunks.length >= 1 && r.chunks.every((c) => c === false) && fr[0] >= fr[1] - 1e-9 && r.parts.length === 1 && r.app.identity.itemId === idBefore.itemId && r.app.identity.genome === idBefore.genome,
      JSON.stringify({ chunkFlags: r.chunks, parts: r.parts, extras: xs.length, fracs: fr }));
    check('CUT audio: cut({ start }) and cut({ separate }) carry the smaller piece\'s share of the WHOLE, the family and calm; no strand() for the parting (NOTES_FOR_SHELL_CUT)',
      Math.abs((seps[0][1].frac as number) - Math.min(...fr)) < 1e-9 && typeof starts[0][1].family === 'string' && typeof starts[0][1].neckS === 'number' && starts[0][1].calm === false && !r.audioCalls.some((c) => c[0] === 'strand'));
    check('CUT: the cut says it in the live region ("Cut into 2 pieces."), a haptic tick, and the Hoard, the mat and the history do not see a piece',
      notices.includes('Cut into 2 pieces.') && r.w.haptics.rec.count('poke') >= 1 && r.app.hoard.items().length === items0 && r.app.mat.count === 1 && r.app.history.current === null,
      JSON.stringify({ notices, items: r.app.hoard.items().length, mat: r.app.mat.count }));
    // X06: cutting paid nothing; a poke (a tap) on the twin pays nothing, like a tap on a whole squishy; a squeeze held 1.2 s and released on it pays through collection.feed like one on a whole squishy
    // RE-SPECIFIED (owner decision 2026-10-06, "short taps pay nothing"): this row used a poke and asserted it paid ("sp > 0"); a tap pays 0 now, so the row proves the twin's feed path with a held
    // squeeze instead and adds that its poke pays 0 (same intent: the twin's touches reach the meter exactly like the whole squishy's).
    const fill0 = r.app.hoard.meter().sp;
    const twin = xs[0].body as CutMock;
    twin.queue({ kind: 'poke', intensity: 0.5 });
    run2(r.w, r.app, 50);
    const afterPoke = r.app.hoard.meter().sp;
    twin.queue({ kind: 'release', intensity: 0.5, heldFor: 1.2 });
    run2(r.w, r.app, 50);
    check('X06 shell: cutting fed the meter nothing; a poke (a tap) on a twin pays nothing and a squeeze held 1.2 s on it pays through collection.feed, both like on a whole squishy', fill0 === 0 && afterPoke === 0 && r.app.hoard.meter().sp > 0, `sp before ${fill0}, after the poke ${afterPoke}, after the squeeze ${r.app.hoard.meter().sp}`);
    // DELETED + REPLACED (CUT2.md 6.5, 14): 'a new chunk is held at its spot (moveTo ...) and let go after SETTLE_S' - the owner changed the design on 2026-10-08: the closed loop of the chunk build is gone.
    // This mock world cuts Minis (the mock has no planCut): the minis are born with an outward velocity and nobody holds them. The clean style's scripted parting (both pieces moveTo +-0.5 g s for PART_S, symmetric, released
    // after, none when |n.y| >= 0.75, a finger ends it) is checked on the real SoftBody in cutter_checks.ts, section parting, and in node_checks 7g (X19).
    const anchorBody = r.app.body as unknown as CutMock;
    run2(r.w, r.app, 900);
    check('CUT (Minis): the new minis are not steered: no moveTo on either piece (the closed loop of the chunk build is gone; the scripted parting is the clean style\'s)', twin.moved === 0 && !twin.held && anchorBody.moved === 0 && !anchorBody.held, `moved ${twin.moved}/${anchorBody.moved}, held ${twin.held}/${anchorBody.held}`);
    // the touch-to-join: a finger on the twin held against the anchor for JOIN_HOLD_S joins them (a bridge, setFrac up / down, rejoin)
    const C = twin.center as V, F = play.center as V;
    C.x = F.x + 0.6; C.y = F.y; C.z = F.z;
    r.app.input.pointerDown({ id: 70, x: 400, y: 300, t: r.w.clock.t });   // a press somewhere: the cutter is asked about the active body below
    r.app.input.pointerUp({ id: 70, x: 400, y: 300, t: r.w.clock.t });
    run2(r.w, r.app, 30);
    r.app.cut.dispose(); void JOIN_HOLD_S; void JOIN_S;
    r.app.dispose();
  }

  // the cutter on its own (the touch-to-join and the limits need control over the finger)
  {
    const W = world({ tier: 'low' });
    const st = W.w.stage;
    let active: SoftBodyLike | null = null, touching = false, t = 0, matOut = 0;
    let dragV: V | null = null;   // the drag of the finger's grab on the active body (null = no grab: a tap, a press, a squeeze or a rub)
    const notices: string[] = [];
    const body0 = W.w.deps.createBody(g0);
    const bm = createBodyManager({ createBody: W.w.deps.createBody, stage: st, initial: { body: body0, identity: { genome: g0, tier: 'common', itemId: 'it-1', nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
    const ct = createCutter({
      bodies: bm, stage: st, audio: W.w.audio, haptics: W.w.haptics, createBody: W.w.deps.createBody, quality: () => 'low', calm: () => false, gravity: () => true,
      simTime: () => t, viewport: () => ({ w: 800, h: 600 }), activeBody: () => active ?? bm.body, touching: () => touching, drag: (out) => { if (!dragV || !touching) return false; out.x = dragV.x; out.y = dragV.y; out.z = dragV.z; return true; }, beforeChange() {}, clearMat: () => { const n = matOut; matOut = 0; return n; },
      panOf: () => 0, say: (s2) => notices.push(s2), report: (e) => { throw e; }, ceiling: 4,
    });
    const step = (sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; ct.update(1 / 60); } };
    // X02, RE-SPECIFIED because the owner removed the limit on 2026-10-09 (CUT3.md 2.1): an edge cut that leaves under 1/8 is no longer refused ("Too small to cut there"): it CUTS, the smaller part is a crumb
    const b0 = bm.body as CutMock;
    const edge = { point: { x: 0.5 * 0.9, y: 0.4, z: 0 }, normal: { x: 1, y: 0, z: 0 } };
    const fEdge = (b0 as unknown as { measureCut(p: unknown): number }).measureCut(edge);
    const cutPlane = (pl: { point: V; normal: V }) => (ct as unknown as { swipe: unknown }) && (() => { /* through splitInTwo's path: a direct plane cut via the private API is not exposed */ })();
    void cutPlane;
    // a swipe needs the camera: aim one at the body's right edge (a vertical swipe at screen x of the edge)
    const cam = st.camera;
    const proj = (p: V): { x: number; y: number } => { const v = new (cam.position.constructor as unknown as new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } })(p.x, p.y, p.z).project(cam); return { x: (v.x + 1) * 400, y: (1 - v.y) * 300 }; };
    const top = proj({ x: 0.47, y: 0.85, z: 0 }), bot = proj({ x: 0.47, y: -0.05, z: 0 });
    matOut = 2;
    const rEdge = ct.swipe(top.x, top.y, bot.x, bot.y);
    step(NECK_DEFAULT_S + NECK_HOLD_S + 0.05);
    const fEdgeKept = ct.fracs().slice().sort((p, q) => p - q);
    check('X02 shell (RE-SPECIFIED, the owner removed the limit on 2026-10-09): a swipe along the very edge that leaves under 1/8 of the whole is NO LONGER refused: it cuts a small piece off (no "Too small" line, no wobble), the shares sum to 1',
      fEdge < 0.125 && rEdge === 'cut' && ct.pieces === 2 && b0.trembles.length === 0 && !notices.some((n) => /Too small|as small as it gets|as many pieces/.test(n)) && Math.abs(fEdgeKept[0] - fEdge) < 0.02 && Math.abs(fEdgeKept[0] + fEdgeKept[1] - 1) < 1e-9, `${rEdge}; share ${fEdge.toFixed(3)}; fracs ${fEdgeKept.map((f) => f.toFixed(4)).join('+')}; ${notices.join(' | ')}`);
    // a short swipe and a miss
    check('CUT: a swipe shorter than 24 px is not a cut; a swipe beside the squishy misses', ct.swipe(400, 300, 410, 300) === 'short' && ct.swipe(20, 20, 20, 120) === 'miss');
    // (this mock world cuts MINIS: the mock bodies have no planCut.) The safety ceiling is lowered to 4 by the test dep `ceiling` (the real one is 64, checked in cutter_checks): each Split in two cuts the largest
    // piece after the edge crumb above; the one past the ceiling is refused with the kind line. RE-SPECIFIED, the owner removed the limits (6 pieces, 4 on low, no piece under 1/8) on 2026-10-09.
    const res: string[] = [];
    for (let i = 0; i < 3; i++) { res.push(ct.splitInTwo()); step(NECK_DEFAULT_S + NECK_HOLD_S + 0.05); }
    check('X02 shell (the ceiling, test dep ceiling 4; RE-SPECIFIED 2026-10-09): the pieces stop at the ceiling; the next cut is refused with the KIND line ("That is a lot of pieces" kind line, cutText.lotOfPieces), with a wobble; the first cut put the mat squishies back',
      res.slice(0, 2).join() === 'cut,cut' && res[2] === 'limit' && ct.pieces === 4 && ct.maxPieces === 4 && !ct.canSplit && notices.at(-1) === "That's a lot of pieces! Reconnect some to keep cutting." && matOut === 0 && notices.some((n) => /went back on the shelf/.test(n)), `${res.join()} pieces ${ct.pieces} ${ct.fracs().map((f) => f.toFixed(3)).join('+')}`);
    step(0.4);
    check('CUT: the refusal wobble ends by itself (tremble back to 0)', ct.fracs().length === 4 && [bm.body, ...bm.extras.map((x) => x.body)].some((b3) => (b3 as CutMock).trembles.length > 0) && [bm.body, ...bm.extras.map((x) => x.body)].every((b3) => (b3 as CutMock).trembles.length === 0 || (b3 as CutMock).trembles.at(-1) === 0));
    const sum = ct.fracs().reduce((a2, b2) => a2 + b2, 0);
    check('X01 shell: after three cuts the shares still sum to exactly 1 and every piece is positive (the edge crumb included; no 1/8 minimum since 2026-10-09); RE-SPECIFIED 2026-10-08: four peers (the play body is the one anchor, three extra pieces), none built with a chunk flag (the regions as leaves of one tree: cutter_checks.ts, section nested, on the real clean engine)',
      Math.abs(sum - 1) < 1e-9 && ct.fracs().every((f) => f > 0) && bm.extras.filter((x) => x.piece).length === 3 && (bm.body as CutMock).piece?.chunk === false && bm.extras.every((x) => (x.body as CutMock).piece?.chunk === false), `sum ${sum}`);
    // the touch-to-join: a finger on a twin held against the anchor for JOIN_HOLD_S starts the join; the bridge rises; rejoin at the end
    const anchor = bm.body as CutMock, twin = bm.extras.find((x) => x.piece)!.body as CutMock;
    /** stand a mock piece with its centre at `at`, its skin (the vertices) carried along; the SURFACE gap to `to` along +x is then `gap` (the first version of this check moved only the centre, so the support read -1 m) */
    const standBeside = (b: CutMock, to: CutMock, sign: 1 | -1, gap: number): void => {
      const rb = supportAlong(b, { x: -sign, y: 0, z: 0 }), rt = supportAlong(to, { x: sign, y: 0, z: 0 });
      const nx = (to.center as V).x + sign * (rt + rb + gap), ny = (to.center as V).y, nz = (to.center as V).z;
      const c = b.center as V, dx = nx - c.x, dy = ny - c.y, dz = nz - c.z;
      for (let i = 0; i < b.vertexCount; i++) { b.positions[i * 3] += dx; b.positions[i * 3 + 1] += dy; b.positions[i * 3 + 2] += dz; }
      c.x = nx; c.y = ny; c.z = nz;
    };
    standBeside(twin, anchor, 1, 0.02);
    active = twin; touching = true;
    const contactsBefore = bm.contactBodies;
    // A-F2 (SHELL-4 fix 1, VERIFY_SHELL4_A): a finger that merely RESTS on a piece lying against its twin must never join them, however long it stays
    // (the pieces close up to touching within ~3 s of a cut on most species): no grab at all (a tap, a press, a squeeze, a rub), a pull AWAY from the other
    // piece, and a pull across or upward; only a drag TOWARD the other piece (below) starts the 0.4 s hold
    const gap0 = (() => { const a = twin.center as V, b = anchor.center as V; return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - supportAlong(anchor, { x: 1, y: 0, z: 0 }) - supportAlong(twin, { x: -1, y: 0, z: 0 }); })();
    const radiusTwin = supportAlong(twin, { x: -1, y: 0, z: 0 });
    dragV = null;
    step(JOIN_HOLD_S * 3);
    const restJoin = ct.busy;
    dragV = { x: 0.3, y: 0, z: 0 };
    step(JOIN_HOLD_S * 3);
    const awayJoin = ct.busy;
    dragV = { x: 0, y: 0.3, z: 0.25 };
    step(JOIN_HOLD_S * 3);
    const acrossJoin = ct.busy;
    dragV = { x: -0.1 * radiusTwin, y: 0, z: 0 };
    step(JOIN_HOLD_S * 3);
    const nudgeJoin = ct.busy;
    touching = false; dragV = null; step(0.2);
    const letGoRest = ct.busy;
    check(`A-F2 shell: a finger resting on a piece that TOUCHES its twin (skin gap ${gap0.toFixed(3)} m, under TOUCH_GAP) for 1.2 s never joins them: no grab (tap, press, squeeze, rub), a pull away, a pull across and up, and a nudge of a tenth of its radius toward it all leave 4 pieces; neither does letting go`,
      gap0 > 0.005 && gap0 < 0.03 && !restJoin && !awayJoin && !acrossJoin && !nudgeJoin && !letGoRest && ct.pieces === 4, JSON.stringify({ gap0: +gap0.toFixed(3), restJoin, awayJoin, acrossJoin, nudgeJoin, letGoRest, pieces: ct.pieces }));
    touching = true;
    dragV = { x: -0.8 * radiusTwin, y: 0.1, z: 0 };   // a drag INTO the anchor: the hand moved 0.8 of the twin's radius toward it
    step(JOIN_HOLD_S * 0.5);
    const early = ct.busy;
    step(JOIN_HOLD_S * 0.6);
    const joining = ct.busy;
    const contactsJoining = bm.contactBodies;
    touching = false; dragV = null;
    step(JOIN_S + 0.05);
    const rj = W.audioCalls.filter((c) => c[0] === 'rejoin');
    check('CUT reconnect: the piece flowing in is a ghost (out of body-to-body contact, so it cannot shove the receiver away); the rest still collide',
      contactsBefore === 4 && contactsJoining === 3 && bm.contactBodies === 3, `contacts ${contactsBefore} -> ${contactsJoining} -> ${bm.contactBodies}`);
    check('CUT reconnect: a twin DRAGGED into the anchor and held against it for 0.4 s flows in (bridge, setFrac up on the anchor and down on the twin, moveTo); then 3 pieces, rejoin({ frac: the merged share })',
      !early && joining && ct.pieces === 3 && W.bridges.some((b2) => b2[2] > 0.5) && anchor.fracCalls.length >= 1 && twin.fracCalls.length >= 1 && twin.moved > 0 && rj.length === 1 && Math.abs((rj[0][1].frac as number) - ct.fracs()[0]) < 1e-9,
      `pieces ${ct.pieces}, rejoin ${JSON.stringify(rj.map((c) => c[1].frac))}, fracs ${ct.fracs().map((f) => f.toFixed(3)).join('+')}`);
    // let go while touching: joins at once (no 0.4 s wait)
    const c2 = bm.extras.find((x) => x.piece)!.body as CutMock;
    standBeside(c2, bm.body as CutMock, -1, 0.02);
    active = c2; touching = true; dragV = { x: 0.8 * supportAlong(c2, { x: 1, y: 0, z: 0 }), y: 0, z: 0 }; step(0.1); touching = false; dragV = null; step(1 / 60);
    const letGo = ct.busy;
    step(JOIN_S + 0.05);
    check('CUT reconnect: letting go of a piece that was DRAGGED into another, while they touch, joins them at once', letGo && ct.pieces === 2, `pieces ${ct.pieces}`);
    // X04: Reconnect all flows every piece into the anchor over 1.2 s; the result is a fresh WHOLE body of the same genome
    const before = bm.body;
    const okAll = ct.reconnectAll(true);
    step(JOIN_ALL_S * 0.5);
    const mid = ct.busy && ct.pieces === 2;
    step(JOIN_ALL_S * 0.5 + 0.05);
    const all = W.audioCalls.filter((c) => c[0] === 'rejoin' && c[1].all === true);
    // the anchor ended up off the middle (the mock's pieces sit at their lobes): it glides home first, then the swap happens there
    const gliding = ct.busy && (ct.pieces as number) === 1 && bm.extras.length === 0 && bm.body === before;
    const offBy = Math.hypot((bm.body.center as V).x, (bm.body.center as V).z);
    step(HOME_MAX_S + 0.05);
    const fresh = bm.body as CutMock;
    check('X04 shell: Reconnect all (1.2 s) ends whole: one body, a FRESH whole body of the same genome (no piece options), frac 1; rejoin({ frac: 1, all: true }) once; "Whole again."',
      okAll && mid && (ct.pieces as number) === 1 && fresh !== before && fresh.piece === null && fresh.frac === 1 && bm.identity.genome === g0 && bm.extras.length === 0 && all.length === 1 && all[0][1].frac === 1 && notices.at(-1) === 'Whole again.',
      `pieces ${ct.pieces}, extras ${bm.extras.length}, notices ${notices.slice(-2).join(' | ')}`);
    check('CUT: whole again at the MIDDLE of the table: an off-centre anchor glides home (moveTo, busy, still the same body) before the swap; the whole body is built without `at`',
      gliding && offBy > 0.06 && !ct.busy && Math.hypot((fresh.center as V).x, (fresh.center as V).z) < 1e-9 && fresh.piece === null,
      `gliding ${gliding}, off ${offBy.toFixed(3)}, busy ${ct.busy}`);
    check('CUT: nothing to reconnect when whole (reconnectAll answers false)', ct.reconnectAll(true) === false && !ct.busy);
    // DELETED (CUT2.md 14): 'X03 shell: the face piece is the side holding the eyes anchor' - the owner changed the design on 2026-10-08: pieces are peers, no piece is "the face". Both halves carry the eyes that sit on their side:
    // X03' (the first Split in two leaves one eye on each half) is in cut_checks.ts (node, the plane the shell computes against the eye centres) and cut_browser.mjs (the real stage).
    ct.reconnectAll(false);
  }

  // X05: every leave path reconnects first; the Hoard never sees a piece; hidden over 60 s reconnects, under it does not
  {
    const mem = memoryStorage();
    const r = rigCut({ storage: mem });
    const cutTwo = (): void => { r.app.cut.splitInTwo(); run2(r.w, r.app, neckMs); };
    for (let i = 0; i < 3; i++) { r.app.debug.shell.grant(1); run2(r.w, r.app, 300); const op = r.app.capsules.openNext(); for (let k = 0; k < 70; k++) { run2(r.w, r.app, 50); await tick(); } await op; }
    const items = r.app.hoard.items();
    const results: Record<string, boolean> = {};
    cutTwo();
    const cutOk = r.app.cut.pieces === 2;
    r.app.setHidden(true); r.w.clock.t += 30_000; r.app.setHidden(false);
    results.hidden30 = r.app.cut.pieces === 2;
    r.app.setHidden(true); r.w.clock.t += 61_000; r.app.setHidden(false);
    results.hidden61 = r.app.cut.pieces === 1 && r.app.bodies.extras.length === 0;
    cutTwo();
    const other = items.find((it) => it.id !== r.app.identity.itemId)!;
    r.app.switchTo(other.id);
    results.switch = r.app.cut.pieces === 1 && r.app.bodies.extras.length === 0 && r.app.identity.itemId === other.id;
    cutTwo();
    r.app.focusInstance({ genome: items[0].genome, itemId: items[0].id });
    results.card = r.app.cut.pieces === 1 && r.app.bodies.extras.length === 0;
    r.app.restorePrimary();
    cutTwo();
    const pr = r.app.ceremonies.playReveal({ itemId: 'zz-cut', genome: speciesBaseGenome(cat2.SPECIES_BY_TIER[0][1].id, 5), tier: 'common', isNew: false, copies: 2, nickname: null });
    run2(r.w, r.app, 50);
    results.ceremony = r.app.cut.pieces === 1;
    for (let k = 0; k < 80; k++) { run2(r.w, r.app, 50); await tick(); }
    await pr;
    check('X05 shell: leaving reconnects first: a switch, a card preview, a ceremony, the tab hidden over 60 s (not 30 s); after each the squishy is whole and no piece is left on the mat',
      cutOk && Object.values(results).every(Boolean), JSON.stringify(results));
    r.app.hoard.flush();
    const stored = Object.keys(mem.dump?.() ?? {}).map((k) => `${k}=${mem.getItem(k)}`).join('\n');
    check('X05 shell: the Hoard never sees a piece (items unchanged through every cut and reconnect), and nothing about pieces or fractions is stored',
      r.app.hoard.items().length === items.length && stored.length > 0 && !/piece|chunk|frac|region|cells|planes/i.test(stored), `items ${items.length} -> ${r.app.hoard.items().length}; ${stored.length} chars stored`);
    // U07 / CUT3.md 5 (2026-10-09, no piece limit): the leave paths reconnect first at 24 pieces too, the meter pays nothing for 23 cuts and the Hoard never sees a piece
    {
      const sp0 = r.app.hoard.meter().sp, n0 = r.app.hoard.items().length;
      for (let i = 0; i < 23; i++) { r.app.cut.splitInTwo(); run2(r.w, r.app, neckMs); }
      const had = r.app.cut.pieces, paid = r.app.hoard.meter().sp, itemsDuring = r.app.hoard.items().length;
      const res24: Record<string, boolean> = {};
      r.app.setHidden(true); r.w.clock.t += 61_000; r.app.setHidden(false);
      res24.hidden = r.app.cut.pieces === 1 && r.app.bodies.extras.length === 0;
      for (let i = 0; i < 23; i++) { r.app.cut.splitInTwo(); run2(r.w, r.app, neckMs); }
      res24.again = r.app.cut.pieces === 24;
      const other2 = items.find((it) => it.id !== r.app.identity.itemId)!;
      r.app.switchTo(other2.id);
      res24.switch = r.app.cut.pieces === 1 && r.app.bodies.extras.length === 0 && r.app.identity.itemId === other2.id;
      check('U07 shell (CUT3): 23 cuts make 24 pieces, the meter paid nothing and the Hoard saw none; the tab hidden over 60 s and a switch of squishy each reconnect all 24 first (one body, nothing on the mat)',
        had === 24 && paid === sp0 && itemsDuring === n0 && Object.values(res24).every(Boolean), JSON.stringify({ had, sp: [sp0, paid], items: [n0, itemsDuring], res24 }));
    }
    // tool state: Cut and Snap route the pointer away from the gestures; Escape-level setTool('hand') restores them
    r.app.setTool('cut');
    const fd0 = (r.app.body as CutMock).rec.count('fingerDown');
    const c = r.app.input.screenCentre()!;
    r.app.input.pointerDown({ id: 81, x: c.x - 60, y: c.y - 120, t: r.w.clock.t }); r.app.input.pointerMove({ id: 81, x: c.x - 40, y: c.y + 120, t: r.w.clock.t }); r.app.input.pointerUp({ id: 81, x: c.x - 40, y: c.y + 120, t: r.w.clock.t });
    run2(r.w, r.app, neckMs);
    const swiped = r.app.cut.pieces;
    r.app.setTool('snap');
    r.app.input.pointerDown({ id: 82, x: c.x, y: c.y, t: r.w.clock.t }); r.app.input.pointerMove({ id: 82, x: c.x + 40, y: c.y, t: r.w.clock.t }); r.app.input.pointerUp({ id: 82, x: c.x + 40, y: c.y, t: r.w.clock.t });
    const orbits = r.w.stage.rec.count('orbit');
    check('tools: with Cut a swipe over the squishy cuts it (no finger reaches a body); with Snap a drag orbits the camera (no finger either)',
      r.app.tool === 'snap' && swiped === 2 && (r.app.body as CutMock).rec.count('fingerDown') === 0 && fd0 === 0 && orbits >= 1, `pieces after the swipe ${swiped}, orbits ${orbits}`);
    r.app.setTool('hand');
    // SHELL-4 fix round 1 (VERIFY_SHELL4_A F5 / F6 / F4, B F1 / F2): src/input/pointer.ts forwards a pointermove to the game only while input.isDown(id); isDown used to answer for the Hand's gesture
    // machine alone, so with REAL pointer events Snap's drag-to-turn and pinch did nothing and the Cut blade stayed a dot (the hook and these rows call game.input directly and never saw it). Every owner of a
    // pressed pointer must answer: the Cut blade, a Snap drag (not a left mouse button), and a release (hidden tab, panel) must clear the stale ones.
    {
      r.app.setTool('cut');
      const blades: Array<{ x1: number; y1: number } | null> = [];
      r.app.on('blade', (b) => blades.push(b ? { x1: b.x1, y1: b.y1 } : null));
      r.app.input.pointerDown({ id: 91, x: c.x - 60, y: c.y - 50, t: r.w.clock.t, type: 'mouse', button: 0 });
      const bladeDown = r.app.input.isDown(91);
      r.app.input.pointerMove({ id: 91, x: c.x + 40, y: c.y + 30, t: r.w.clock.t, type: 'mouse' });
      const followed = blades.at(-1)?.x1 === c.x + 40;
      r.app.suspend('hidden'); r.app.unsuspend('hidden');   // the shell's own release, no pointerup
      const bladeAfterRelease = r.app.input.isDown(91), bladeCleared = blades.at(-1) === null;
      r.app.input.pointerDown({ id: 92, x: c.x - 60, y: c.y - 50, t: r.w.clock.t, type: 'mouse', button: 2 });
      const rightMouseInCut = r.app.input.isDown(92);   // a right drag in the Cut tool is nothing: not a blade
      r.app.setTool('snap');
      r.app.input.pointerDown({ id: 93, x: c.x, y: c.y, t: r.w.clock.t, type: 'mouse', button: 0 });
      const leftMouse = r.app.input.isDown(93);
      r.app.input.pointerDown({ id: 94, x: c.x, y: c.y, t: r.w.clock.t, type: 'mouse', button: 2 });
      const rightMouse = r.app.input.isDown(94);
      r.app.input.pointerUp({ id: 94, x: c.x, y: c.y, t: r.w.clock.t, type: 'mouse' });
      const afterUp = r.app.input.isDown(94);
      r.app.input.pointerDown({ id: 95, x: c.x, y: c.y, t: r.w.clock.t, type: 'touch' });
      const finger = r.app.input.isDown(95);
      const o0 = r.w.stage.rec.count('orbit');
      r.app.input.pointerMove({ id: 95, x: c.x + 30, y: c.y, t: r.w.clock.t, type: 'touch' });
      const orbited = r.w.stage.rec.count('orbit') > o0;
      r.app.suspend('hidden'); r.app.unsuspend('hidden');
      const afterRelease = r.app.input.isDown(95);
      r.app.setTool('hand');
      check('input.isDown answers for every owner of a pressed pointer (pointer.ts forwards moves only while it does): the Cut blade (and its line follows the move), a Snap right-mouse drag and a finger but not a left mouse button; up, cancel and a release (hidden tab) clear them',
        bladeDown && followed && !bladeAfterRelease && bladeCleared && !rightMouseInCut && !leftMouse && rightMouse && finger && orbited && !afterUp && !afterRelease,
        JSON.stringify({ bladeDown, followed, bladeAfterRelease, bladeCleared, rightMouseInCut, leftMouse, rightMouse, finger, orbited, afterUp, afterRelease }));
    }
    // SHELL-4 fix round 2 (VERIFY_SHELL4_A_R1 N1): a swipe in progress when a Reconnect all (or a join, or a parting) animation ends must not be dropped. The swap that ends the animation calls beforeChange /
    // beforeSwap (fingers off the bodies), and since fix round 1 that also cleared the blade: the line vanished at that moment and the finished swipe cut nothing. The shell's own releases (hidden tab, a
    // panel, a ceremony, a switch) still clear it (the row above).
    {
      r.app.setTool('cut');
      r.app.cut.reconnectAll(false);   // (the rows above left it cut: start from a whole squishy)
      cutTwo();
      const two = r.app.cut.pieces === 2;
      r.app.cut.reconnectAll(true);
      run2(r.w, r.app, 300);
      const blades2: Array<{ x1: number; y1: number } | null> = [];
      const cuts: string[] = [];
      r.app.on('blade', (b) => blades2.push(b ? { x1: b.x1, y1: b.y1 } : null));
      r.app.on('cut', (res) => cuts.push(String(res)));
      r.app.input.pointerDown({ id: 96, x: c.x - 60, y: c.y - 120, t: r.w.clock.t, type: 'mouse', button: 0 });
      const downWhileBusy = r.app.cut.busy && r.app.input.isDown(96) && blades2.at(-1) !== null;
      let waited = 0;
      while (r.app.cut.busy && waited < 6000) { run2(r.w, r.app, 100); waited += 100; }   // the join, the glide home and the swap to a whole body
      const survived = !r.app.cut.busy && r.app.cut.pieces === 1 && r.app.input.isDown(96) && blades2.at(-1) !== null && !blades2.includes(null);
      r.app.input.pointerMove({ id: 96, x: c.x - 40, y: c.y + 120, t: r.w.clock.t, type: 'mouse' });
      r.app.input.pointerUp({ id: 96, x: c.x - 40, y: c.y + 120, t: r.w.clock.t, type: 'mouse' });
      run2(r.w, r.app, neckMs);
      check('N1 shell: a swipe that is in progress when a Reconnect all animation ends is NOT dropped: the blade line stays through the swap to the whole body, and the finished swipe cuts it (2 pieces)',
        two && downWhileBusy && survived && cuts.at(-1) === 'cut' && r.app.cut.pieces === 2,
        JSON.stringify({ two, downWhileBusy, survived, waitedMs: waited, cuts, bladeEvents: blades2.map((b) => (b ? 'line' : 'null')), pieces: r.app.cut.pieces }));
      r.app.setTool('hand');
    }
    r.app.dispose();
  }
}

/* ───────────────────────── 6. settings: resolution, migration, newer blobs, calm default, music ───────────────────────── */
{
  const env = { vibrate: false, reducedMotion: true };
  const d = defaultSettings(env);
  const res = resolveSettings(d, env);
  check('settings: optional fields resolve to their defaults (music 0.45, calm = reduced motion, shortcuts on, the rest off)',
    res.music === 0.45 && res.calm === true && res.shortcuts === true && !res.extraSquish && !res.skipAnimations && !res.fastOpen);
  const v1 = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ volume: 0.3, squishBoost: 1, haptics: false, shake: 0.2, gravity: false, quality: 'low' }) });
  const l1 = loadSettings(v1, env);
  check('migration: a slice-1 blob (no v) loads its six fields; the round-2 fields stay unset (they follow their defaults)', l1.volume === 0.3 && l1.quality === 'low' && l1.music === undefined && l1.calm === undefined && resolveSettings(l1, env).calm === true);
  saveSettings(v1, { ...l1, calm: false });
  const s1 = JSON.parse(v1.getItem(SETTINGS_KEY)!);
  // RE-SPECIFIED by PG_SHELL round 3 (2026-11-17): the format is v3 now (PLAYGROUND_BUILD.md 11.9: raised from 2 so the published v2 build carries the PLAYGROUND
  // keys through its saves); the row checks the same rule against the build's own version, which is 3
  check('migration: the first save writes v: 3 (SETTINGS_VERSION) with the chosen round-2 field only', SETTINGS_VERSION === 3 && s1.v === 3 && s1.calm === false && !('music' in s1) && s1.volume === 0.3);
  // RE-SPECIFIED with the same reason: a NEWER build is now v: 4 (a v: 3 blob is this build's own format)
  const v3 = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ v: 4, volume: 0.5, futureThing: { a: 1 } }) });
  const l3 = loadSettings(v3, env);
  saveSettings(v3, { ...l3, music: 0.2 });
  const s3 = JSON.parse(v3.getItem(SETTINGS_KEY)!);
  check('a blob from a NEWER build (v: 4): known fields read, its unknown keys and version survive our save', l3.volume === 0.5 && s3.v === 4 && s3.futureThing?.a === 1 && s3.music === 0.2);
  // PLAYGROUND (PG_SHELL round 3, PLAYGROUND_BUILD.md 11.9): Voices, Place sounds and autonomy
  check('PLAYGROUND settings: Voices 0.6, Place sounds 0.5 and "Squishies move on their own" on by default (resolveSettings fills them by absence)',
    res.chatter === 0.6 && res.ambience === 0.5 && res.autonomy === true);
  const v2 = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ v: 2, volume: 0.4, squishBoost: 0.4, haptics: false, shake: 0.35, gravity: true, quality: 'auto', music: 0.3, calm: false }) });
  const l2 = loadSettings(v2, env), r2 = resolveSettings(l2, env);
  check('migration: a v2 blob (the published build) reads as v3: its fields kept, the three PLAYGROUND settings at their defaults',
    l2.volume === 0.4 && l2.music === 0.3 && l2.calm === false && l2.chatter === undefined && r2.chatter === 0.6 && r2.ambience === 0.5 && r2.autonomy === true);
  saveSettings(v2, { ...l2, chatter: 0.25, ambience: 0, autonomy: false });
  const s2 = JSON.parse(v2.getItem(SETTINGS_KEY)!);
  const l2b = loadSettings(v2, env);
  check('a v3 save keeps the chosen PLAYGROUND values (Voices 0.25, Place sounds 0 = off, autonomy off) and reads them back',
    s2.v === 3 && s2.chatter === 0.25 && s2.ambience === 0 && s2.autonomy === false && l2b.chatter === 0.25 && l2b.ambience === 0 && l2b.autonomy === false);
  const bad = loadSettings(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ v: 3, chatter: 'loud', ambience: 7, autonomy: 'yes' }) }), env);
  check('a hostile v3 blob: a non-number Voices and a non-boolean autonomy stay unset (defaults), Place sounds 7 is clamped to 1', bad.chatter === undefined && bad.ambience === 1 && bad.autonomy === undefined);
  // the OLD code (the published v2 build, frozen in shellview/settings_v2_frozen.ts) saving over our v3 blob: it carries the three keys (it keeps unknown keys of a v > 2 blob)
  const old = settingsV2.loadSettings(v2, env);
  settingsV2.saveSettings(v2, { ...old, volume: 0.9 });
  const sOld = JSON.parse(v2.getItem(SETTINGS_KEY)!);
  check('rollback: the published v2 code reads our v3 blob and its save CARRIES Voices, Place sounds and autonomy (and keeps v: 3), so a rollback or an older tab never erases them',
    settingsV2.SETTINGS_VERSION === 2 && sOld.v === 3 && sOld.volume === 0.9 && sOld.chatter === 0.25 && sOld.ambience === 0 && sOld.autonomy === false && loadSettings(v2, env).autonomy === false,
    JSON.stringify(sOld));
  const r = rig({ env, storage: memoryStorage() });
  check('boot under reduced motion: Calm on (stage.setCalmEffects(true)), shake scale 0, music bed on at 0.45 via setMusic',
    r.fake.log.of('setCalmEffects').at(-1)?.args[0] === true && r.w.stage.rec.of('setShakeScale').at(-1)!.args[0] === 0 && JSON.stringify(r.fake.log.of('setMusic').at(-1)?.args[0]) === '{"on":true,"volume":0.45}');
  r.app.setSetting('music', 0);
  check('music 0 = off: setMusic({ on: false, volume: 0 })', JSON.stringify(r.fake.log.of('setMusic').at(-1)?.args[0]) === '{"on":false,"volume":0}');
  {
    const first = r.w.audio.rec.of('setSettings')[0]?.args[0] as { chatter?: number; ambience?: number } | undefined;
    r.app.setSetting('chatter', 0.3);
    const a1 = r.w.audio.rec.of('setSettings').at(-1)?.args[0] as { chatter?: number; ambience?: number } | undefined;
    r.app.setSetting('ambience', 0);
    const a2 = r.w.audio.rec.of('setSettings').at(-1)?.args[0] as { chatter?: number; ambience?: number } | undefined;
    const n0 = r.w.audio.rec.of('setSettings').length;
    r.app.setSetting('autonomy', false);
    check('PLAYGROUND settings live: Voices and Place sounds reach audio.setSettings (chatter / ambience: 0.6 / 0.5 at boot, then 0.3, then 0); autonomy changes no audio call',
      first?.chatter === 0.6 && first?.ambience === 0.5 && a1?.chatter === 0.3 && a2?.ambience === 0 && a2?.chatter === 0.3 && r.w.audio.rec.of('setSettings').length === n0 && r.app.settings.autonomy === false,
      JSON.stringify({ first, a1, a2 }));
  }
  r.app.setSetting('extraSquish', true);
  const c = r.app.input.screenCentre()!;
  r.app.input.pointerDown({ id: 3, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 50);
  const pr = r.w.body.rec.of('fingerPressure').at(-1)!.args[1] as number;
  check('Extra squish: the tap pressure 0.55 is pushed toward full depth (0.75)', Math.abs(pr - 0.7525) < 1e-6, pr.toFixed(4));
  r.app.input.pointerUp({ id: 3, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 300);
}

/* ───────────────────────── 7. press-driven squelch (contracts.ts SoftMetrics.press; audit finding 4) ───────────────────────── */
{
  const r = rig({ round2: false });
  const m = r.w.body.metrics as unknown as { press?: number };
  m.press = 0;
  const c = r.app.input.screenCentre()!;
  r.app.input.pointerDown({ id: 1, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 400);
  r.w.body.auto = true;
  // simulate a deep single-finger dent: press 0.8 while compression stays small
  const origStep = r.w.body.step.bind(r.w.body);
  (r.w.body as unknown as { step: (dt: number) => void }).step = (dt) => { origStep(dt); r.w.body.metrics.compression = 0.02; m.press = 0.8; };
  run(r, 200);
  const v = r.w.audio.allVoices[0];
  check('squelch: with metrics.press the voice is driven by max(compression, press) (0.8, not 0.02)', !!v && Math.abs(v.updates.at(-1)!.compression - 0.8) < 1e-9, String(v?.updates.at(-1)?.compression));
  const up = { x: 0, y: 0.9, z: 0.436 }, ray = { x: 0, y: -0.27, z: -0.963 };
  const bentP = pressDirection(up, ray, true), bentN = pressDirection(up, ray, false);
  check('press direction: an up-facing hit is bent toward straight down for a body without press, and for a press-reporting body exactly while CALIBRATION.bendWithPress',
    bentN.y < -0.99 && (CALIBRATION.bendWithPress ? bentP.y < -0.99 : bentP === ray), `with press ${bentP.y.toFixed(3)}, without ${bentN.y.toFixed(3)}`);
  r.app.input.pointerUp({ id: 1, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 300);
}

/* ───────────────────────── 7a. release FX: press depth gates the bubbles on a press body; intensity only as the fallback ───────────────────────── */
{
  const lv = [releaseFxLevel(0.25, 0.5, true), releaseFxLevel(0.25, 0.8, true), releaseFxLevel(0.9, 0, true), releaseFxLevel(0.25, 0.9, false), releaseFxLevel(0.35, 0, false)];
  check('release FX: with metrics.press a gentle press (peak 0.5) stays quiet and a deep one (0.8) bubbles; without press, intensity 0.25 stays quiet and 0.35 bubbles',
    lv[0] === 0 && lv[1] > 0 && lv[2] > 0 && lv[3] === 0 && lv[4] > 0, lv.map((v) => v.toFixed(3)).join(', '));
}

/* ───────────────────────── 7c. the driver's live pull level (feel.ts THE PULL SIGNAL) ───────────────────────── */
{
  const { createDriver } = await import('../../src/shell/driver.ts');
  const fakeBody = { restRadius: 0.5, metrics: { press: 0 } as Record<string, number>, grab() {}, grabMove() {}, grabRelease() {}, fingerDown() {}, fingerUp() {}, fingerMove() {}, fingerPressure() {} };
  const drv = createDriver({ body: () => fakeBody as never, stage: {} as never, simTime: () => 0, stepCount: () => 0, panOfPoint: () => 0, extraSquish: () => false, interact: () => {}, dirty: () => {}, report: () => {} });
  const at = (x: number) => ({ x, y: 0.5, z: 0 });
  drv.onAction({ type: 'grab', slot: 0, vertex: 1, target: at(0) } as never);
  drv.onAction({ type: 'grabMove', slot: 0, target: at(0.425) } as never);
  const before = drv.touch.pull(0);                     // 0.425 over the default 1.7 R x 0.5 = 0.85: 0.5
  drv.onAction({ type: 'grabRelease', slot: 0 } as never);
  drv.touch.learnPull(0, 0.25);                          // the body said: that was a quarter of its maximum (its max is 1.7 world units)
  drv.onAction({ type: 'grab', slot: 0, vertex: 1, target: at(0) } as never);
  drv.onAction({ type: 'grabMove', slot: 0, target: at(0.85) } as never);
  const after = drv.touch.pull(0);                       // 0.85 of 1.7: 0.5
  drv.onAction({ type: 'grabMove', slot: 0, target: at(3) } as never);
  const clamped = drv.touch.pull(0);
  fakeBody.metrics.pull = 0.42;
  const reported = drv.touch.pull(0);
  check('pull signal (driver): before any snap the default maximum (1.7 R); a snap teaches the body\'s own maximum; 1 at the limit; a body that reports metrics.pull is read directly',
    Math.abs(before - 0.5) < 1e-9 && Math.abs(after - 0.5) < 1e-9 && clamped === 1 && reported === 0.42, [before, after, clamped, reported].map((x) => x.toFixed(3)).join(', '));
}

/* ───────────────────────── 7b. round 3: the strand voice follows metrics.strands when the body reports it ───────────────────────── */
{
  const r = rig({ round2: false });
  const calls: Array<{ tension: number; snap?: boolean }> = [];
  (r.w.audio as unknown as Record<string, unknown>).strand = (p: { tension: number; snap?: boolean }) => { calls.push(p); };
  const m = r.w.body.metrics as unknown as { strands?: number };
  const origStep = r.w.body.step.bind(r.w.body);
  let target = 0;
  (r.w.body as unknown as { step: (dt: number) => void }).step = (dt) => { origStep(dt); m.strands = target; };
  run(r, 100);
  const quiet = calls.length;
  target = 0.5; run(r, 200);
  const held = calls.length - quiet;
  const steady = calls.slice(quiet).every((c) => Math.abs(c.tension - 0.5) < 1e-9 && !c.snap);
  target = 0; run(r, 100);
  const snapCall = calls.at(-1);
  const broke = snapCall?.snap === true && Math.abs(snapCall.tension - 0.5) < 1e-9 && calls.filter((c) => c.snap).length === 1;
  const n1 = calls.length;
  target = 0.1; run(r, 100); target = 0; run(r, 100);
  const weak = calls.slice(n1);
  check('strand (metrics.strands): one call per step while the strings hold (tension = strands), ONE snap when strong strings let go, silent at rest',
    quiet === 0 && held >= 10 && steady && broke, `rest ${quiet}, held ${held}, last ${JSON.stringify(snapCall)}`);
  check('strand (metrics.strands): weak strings (< 0.3) that let go just stop calling (no snap)', weak.length >= 5 && weak.every((c) => !c.snap), `${weak.length} calls, snaps ${weak.filter((c) => c.snap).length}`);
}

/* ───────────────────────── 7d. physics B3 toss: lift on the rising edge of metrics.carried, toss on the throw's snap ───────────────────────── */
{
  const r = rig({ round2: false });
  const lifts: unknown[] = [], tosses: Array<{ speed: number }> = [];
  const au = r.w.audio as unknown as Record<string, unknown>;
  au.lift = (p: unknown) => { lifts.push(p); };
  au.toss = (p: { speed: number }) => { tosses.push(p); };
  const b = r.w.body;
  const m = b.metrics as unknown as { carried?: boolean };
  const c = b.center as { x: number; y: number; z: number };
  m.carried = false; run(r, 100);
  const rest = lifts.length + tosses.length;
  m.carried = true; run(r, 50);
  const lifted = lifts.length;
  run(r, 200);
  const once = lifts.length === 1;
  for (let i = 0; i < 6; i++) { c.x += 0.05; run(r, 1000 / 60); }   // the hand swings it: 3 m/s
  b.queue({ kind: 'snap', intensity: 1, finger: 0 });
  c.x += 0.05; m.carried = false; run(r, 50);
  const toss = tosses.at(-1);
  check('toss (physics B3): lift once on the rising edge of metrics.carried; the snap that ends the carry plays toss with the throw speed (|v| / 4 m/s)',
    rest === 0 && lifted === 1 && once && tosses.length === 1 && !!toss && toss.speed > 0.5 && toss.speed <= 1, `lifts ${lifts.length}, tosses ${JSON.stringify(tosses)}`);
  // carried, then put down without a throw: a later plain pull's snap is not a toss
  m.carried = true; run(r, 50); m.carried = false; run(r, 50);
  for (let i = 0; i < 6; i++) { c.x += 0.05; run(r, 1000 / 60); }
  b.queue({ kind: 'snap', intensity: 0.6, finger: 0 }); run(r, 50);
  check('toss (physics B3): a carry that ends without a throw clears the lift, so a later plain pull is not tossed', lifts.length === 2 && tosses.length === 1, `lifts ${lifts.length}, tosses ${tosses.length}`);
}

/* ───────────────────────── 7e. Shift + drag pulls both sides (owner decision 2026-10-06): the pointer glue, then the whole game on the REAL SoftBody ───────────────────────── */
{
  // ---- src/input/pointer.ts: Shift rides on mouse and pen pointer events, never on touch
  const { attachPointerInput } = await import('../../src/input/pointer.ts');
  const handlers = new Map<string, (e: unknown) => void>();
  const canvas = { addEventListener: (t: string, fn: (e: unknown) => void) => { handlers.set(t, fn); }, removeEventListener: () => {}, getBoundingClientRect: () => ({ left: 10, top: 20 }), setPointerCapture: () => {}, clientHeight: 600 } as unknown as HTMLCanvasElement;
  const g = globalThis as unknown as { document?: unknown };
  const hadDocument = 'document' in g;
  if (!hadDocument) g.document = { addEventListener: () => {}, removeEventListener: () => {} };
  const calls: Array<[string, Record<string, unknown>]> = [];
  const app = { input: { pointerDown: (p: Record<string, unknown>) => calls.push(['down', p]), pointerMove: (p: Record<string, unknown>) => calls.push(['move', p]), pointerUp: (p: Record<string, unknown>) => calls.push(['up', p]), pointerCancel: () => {}, isDown: () => true, hover: () => {}, hoverEnd: () => {}, wheel: () => {} }, unlockAudio: () => {} };
  const detach = attachPointerInput(canvas, app as never);
  const pev = (o: Record<string, unknown>): Record<string, unknown> => ({ pointerId: 1, clientX: 110, clientY: 120, timeStamp: 5, button: 0, buttons: 1, pointerType: 'mouse', shiftKey: false, preventDefault: () => {}, ...o });
  const drive = (o: Record<string, unknown>): Array<[string, Record<string, unknown>]> => {
    calls.length = 0;
    handlers.get('pointerdown')!(pev(o)); handlers.get('pointermove')!(pev(o)); handlers.get('pointerup')!(pev(o));
    return calls.slice();
  };
  const mouse = drive({ shiftKey: true }), plain = drive({}), pen = drive({ shiftKey: true, pointerType: 'pen' }), touch = drive({ shiftKey: true, pointerType: 'touch' });
  const moveGone = (() => { calls.length = 0; handlers.get('pointermove')!(pev({ shiftKey: true, buttons: 0 })); return calls.slice(); })();
  check('pointer glue: a mouse with Shift down passes shift: true on pointerdown, pointermove and pointerup (canvas-local coordinates)',
    mouse.length === 3 && mouse.every(([, p]) => p.shift === true && p.type === 'mouse' && p.x === 100 && p.y === 100), JSON.stringify(mouse.map(([k, p]) => [k, p.shift])));
  check('pointer glue: no Shift = no `shift` key at all (the sample is what it always was)', plain.length === 3 && plain.every(([, p]) => !('shift' in p)));
  check('pointer glue: a pen with Shift mirrors like a mouse', pen.length === 3 && pen.every(([, p]) => p.shift === true && p.type === 'pen'));
  check('pointer glue: a TOUCH never carries Shift, even with a keyboard\'s Shift down', touch.length === 3 && touch.every(([, p]) => !('shift' in p) && p.type === 'touch'));
  check('pointer glue: a mouse button lost outside the window ends the press (pointerup) and still reports Shift', moveGone.length === 1 && moveGone[0][0] === 'up' && moveGone[0][1].shift === true);
  detach();
  if (!hadDocument) delete g.document;

  // ---- the whole game on the real SoftBody and the real collection
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const { speciesTemplateGenome } = await import('../../src/data/catalog.ts');
  const makeReal = (): { w: MockWorld; app: App; lifts: number[]; tosses: number[] } => {
    const w = createMockWorld({ storage: null });
    w.deps.createBody = (gg) => new SoftBody(gg) as unknown as SoftBodyLike;
    const now = (): number => 1_700_000_000_000 + w.clock.t;
    const collection = createCollection({ storage: null, profile: null, now, random: () => 0.4 });
    const app = createApp({ ...w.deps, collection, epochNow: now });
    app.resize(800, 600, 1);
    app.setPhase('play');
    const lifts: number[] = [], tosses: number[] = [];
    const au = w.audio as unknown as Record<string, unknown>;
    au.lift = () => { lifts.push(1); };
    au.toss = () => { tosses.push(1); };
    return { w, app, lifts, tosses };
  };
  interface RealPull { carried: boolean; grabs: number[]; snaps: Array<{ finger: number; I: number; held: number }>; sp: number; voices: number; releases: number; pops: number; hapticRelease: number; hapticPoke: number; lifts: number; tosses: number; stats: { pulls: number; releases: number }; minYR: number; finite: boolean; sidesOut: [number, number] }
  const realPull = (type: 'mouse' | 'touch', shift: boolean, reach = 1.8): RealPull => {
    const { w, app, lifts, tosses } = makeReal();
    const go = (ms: number, each?: () => void): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); each?.(); left -= d; } };
    go(1500);
    const body = app.body as unknown as InstanceType<typeof SoftBody>;
    const disc = app.host.bodyScreen()!, R = body.restRadius, maxD = body.params.maxPull * R;
    const px0 = disc.x + 0.75 * disc.r, py0 = disc.y + 0.05 * disc.r, drag = reach * maxD * (disc.r / R), x0 = body.center.x;
    let carried = false, minY = 1e9, mnX = 1e9, mxX = -1e9, finite = true;
    const probe = (): void => {
      if (body.metrics.carried) carried = true;
      const P = body.positions;
      for (let i = 0; i < P.length; i += 3) { if (!Number.isFinite(P[i]) || !Number.isFinite(P[i + 1])) finite = false; if (P[i + 1] < minY) minY = P[i + 1]; if (P[i] < mnX) mnX = P[i]; if (P[i] > mxX) mxX = P[i]; }
    };
    app.input.pointerDown({ id: 7, x: px0, y: py0, t: w.clock.t, button: 0, type });
    go(40);
    for (let i = 1; i <= 50; i++) { app.input.pointerMove({ id: 7, x: px0 + (drag * i) / 50, y: py0, t: w.clock.t, type, shift }); go(16.7, probe); }
    go(1000, probe);
    // a flick (the hand swings it, 8 frames) and let go: a lone hand throws the body it carries (the toss voice), two hands never carried it
    for (let i = 1; i <= 8; i++) { app.input.pointerMove({ id: 7, x: px0 + drag + 30 * i, y: py0 - 12 * i, t: w.clock.t, type, shift }); go(16.7, probe); }
    app.input.pointerUp({ id: 7, x: px0 + drag + 240, y: py0 - 96, t: w.clock.t, type, shift });
    go(3000, probe);
    const ev = app.recentEvents();
    const m = app.hoard.meter();
    return {
      carried, grabs: ev.filter((e) => e.kind === 'grab').map((e) => e.finger), snaps: ev.filter((e) => e.kind === 'snap').map((e) => ({ finger: e.finger, I: e.intensity, held: e.heldFor })),
      sp: m.sp + m.credits * 1e3, voices: w.audio.rec.count('squishStart'), releases: w.audio.rec.count('release'), pops: w.audio.rec.count('pop'), hapticRelease: w.haptics.rec.count('release'), hapticPoke: w.haptics.rec.count('poke'),
      lifts: lifts.length, tosses: tosses.length, stats: { pulls: app.profile.profile.stats.pulls, releases: app.profile.profile.stats.releases }, minYR: minY / R, finite,
      sidesOut: [(x0 - mnX - R) / maxD, (mxX - x0 - R) / maxD],
    };
  };
  const shiftPull = realPull('mouse', true), plainPull = realPull('mouse', false), touchPull = realPull('touch', true);
  check('Shift pull (real SoftBody, through the game): two grabs (fingers 0 and 1), two snaps at the full pull level, the body stretches out on both sides and is NEVER carried (no lift, no toss) although it was asked 1.8 x maxPull',
    !shiftPull.carried && shiftPull.grabs.join() === '0,1' && shiftPull.snaps.length === 2 && shiftPull.snaps.every((s) => s.I >= 0.95) && shiftPull.sidesOut[0] >= 0.4 && shiftPull.sidesOut[1] >= 0.4 && shiftPull.lifts === 0 && shiftPull.tosses === 0 && shiftPull.finite && shiftPull.minYR >= -0.01,
    `carried ${shiftPull.carried}, grabs ${shiftPull.grabs}, snaps ${shiftPull.snaps.map((s) => s.I.toFixed(2))}, sides ${shiftPull.sidesOut.map((x) => x.toFixed(2))} maxPull, lifts ${shiftPull.lifts}, tosses ${shiftPull.tosses}`);
  check('plain pull (real SoftBody, through the game): the same drag without Shift still picks the body up (metrics.carried, the lift voice once, a toss on the let-go)',
    plainPull.carried && plainPull.grabs.join() === '0' && plainPull.snaps.length === 1 && plainPull.lifts === 1 && plainPull.tosses >= 1, `carried ${plainPull.carried}, lifts ${plainPull.lifts}, tosses ${plainPull.tosses}`);
  // (the press itself ticks once: the real body reports a 'poke' event when a pull starts, so the Shift pull, which never lifts, has 1 tick and the lone pull has 1 + the lift's)
  check('SHELL-4 haptics: the lift plays ONE light tick (haptics.poke) more than the same pull that never lifts (the Shift pull) and the snap that throws it the thump (haptics.release, once)',
    plainPull.hapticPoke - shiftPull.hapticPoke === 1 && plainPull.hapticRelease === 1 && shiftPull.hapticRelease === 1, `lone pull: ticks ${plainPull.hapticPoke}, thumps ${plainPull.hapticRelease}; Shift pull (no lift): ticks ${shiftPull.hapticPoke}, thumps ${shiftPull.hapticRelease}`);
  check('touch with Shift (real SoftBody, through the game): never mirrors: one grab, one snap, and it lifts like any lone finger',
    touchPull.carried && touchPull.grabs.join() === '0' && touchPull.snaps.length === 1);
  check('Shift pull feedback: ONE stretch voice, ONE release sound, ONE thump, 1 to 3 pops, one pull and one release in the stats (as the plain pull)',
    shiftPull.voices === 1 && shiftPull.releases === 1 && shiftPull.hapticRelease === 1 && shiftPull.pops >= 1 && shiftPull.pops <= 3 && shiftPull.stats.pulls === 1 && shiftPull.stats.releases === 1
      && plainPull.voices === 1 && plainPull.releases === 1 && plainPull.pops === shiftPull.pops && plainPull.stats.pulls === 1,
    `voices ${shiftPull.voices}, release ${shiftPull.releases}, thump ${shiftPull.hapticRelease}, pops ${shiftPull.pops}, stats ${JSON.stringify(shiftPull.stats)}`);
  // THE METER: what the pair pays. The second hand's snap, fed, is a second pull inside the freshness window (tau 3 s, floor 0.03): measured here
  // on the real collection feed with the current pay constants, then the game's own number (it feeds the pair once).
  const extra = (gapMs: number | null): number => {
    const snap = (finger: number, held: number): SoftEvent => ({ kind: 'snap', at: { x: 0, y: 0.4, z: 0.5 }, normal: { x: 0, y: 1, z: 0 }, intensity: 1, heldFor: held, finger });
    const T0 = 1_700_000_000_000;
    const sp = (second: boolean): number => {
      let cur = T0;
      const c = createCollection({ storage: null, profile: null, now: () => cur, random: () => 0.4 });
      if (gapMs !== null) c.feed(snap(0, 1), T0);
      const before = c.meter().sp;
      cur = T0 + (gapMs ?? 0) + 10;
      c.feed(snap(0, 1.9), cur); if (second) c.feed(snap(1, 1.9), cur);
      const v = c.meter().sp - before; c.dispose(); return v;
    };
    return (sp(true) - sp(false)) / sp(false);
  };
  const exFresh = extra(null), ex2 = extra(2000), ex1 = extra(1000);
  check('Shift pull meter: the pair pays ONCE: exactly the squish points of the same pull without Shift (the second hand is no touch of its own)',
    shiftPull.sp > 0.5 && Math.abs(shiftPull.sp - plainPull.sp) < 1e-6,
    `${shiftPull.sp.toFixed(4)} SP vs ${plainPull.sp.toFixed(4)} SP. Why: fed as a second pull the mirror would pay +${(exFresh * 100).toFixed(1)} % on a fresh pull, +${(ex2 * 100).toFixed(1)} % at a 2 s cadence, +${(ex1 * 100).toFixed(1)} % at 1 s (freshness floor 0.03 of the second pull; it would also double the pull count of a Tasks goal)`);
}

/* ───────────────────────── 7f. SHELL-4: CALIBRATION.bendWithPress, measured through the whole game on the REAL SoftBody (a dome-top press, held 1.3 s) ───────────────────────── */
{
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const { CALIBRATION } = await import('../../src/shell/feel.ts');
  const mut = CALIBRATION as unknown as { bendWithPress: boolean };
  const T0 = 1_700_000_000_000;
  const domeGame = (bend: boolean): { comp: number; press: number; releases: number; relI: number; held: number; sp: number; direct: number; statReleases: number; squelchVoices: number; audioReleases: number } => {
    const was = mut.bendWithPress;
    mut.bendWithPress = bend;
    try {
      const w = createMockWorld({ storage: null });
      w.deps.createBody = (gg) => new SoftBody(gg) as unknown as SoftBodyLike;
      const now = (): number => T0 + w.clock.t;
      const collection = createCollection({ storage: null, profile: null, now, random: () => 0.4 });
      const app = createApp({ ...w.deps, collection, epochNow: now });
      app.resize(1280, 800, 1);
      app.setPhase('play');
      const go = (ms: number, each?: () => void): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); each?.(); left -= d; } };
      go(1500);
      const body = app.body as unknown as InstanceType<typeof SoftBody>;
      const disc = app.host.bodyScreen()!;
      let comp = 0, press = 0;
      app.input.pointerDown({ id: 7, x: disc.x, y: disc.y - 0.8 * disc.r, t: w.clock.t, button: 0, type: 'touch' });
      go(1300, () => { comp = Math.max(comp, body.metrics.compression); press = Math.max(press, body.metrics.press ?? 0); });
      app.input.pointerUp({ id: 7, x: disc.x, y: disc.y - 0.8 * disc.r, t: w.clock.t, button: 0, type: 'touch' });
      go(1500);
      const rel = app.recentEvents().filter((e) => e.kind === 'release');
      const sp = app.hoard.meter().sp;
      // what ONE feed of that very release pays on a fresh collection (the reference: a second payment would show as 2 x)
      const ref = createCollection({ storage: null, profile: null, now: () => T0 + 5000, random: () => 0.4 });
      if (rel[0]) ref.feed(rel[0], T0 + 5000);
      const direct = ref.meter().sp; ref.dispose();
      const out = { comp, press, releases: rel.length, relI: rel[0]?.intensity ?? 0, held: rel[0]?.heldFor ?? 0, sp, direct, statReleases: app.profile.profile.stats.releases, squelchVoices: w.audio.rec.count('squishStart'), audioReleases: w.audio.rec.count('release') };
      app.dispose();
      return out;
    } finally { mut.bendWithPress = was; }
  };
  const withB = domeGame(true), without = domeGame(false);
  const f2 = (x: number): string => x.toFixed(2);
  check(`CALIBRATION.bendWithPress (decision: KEEP while the flat press reads compression ~0): a dome-top press held 1.3 s peaks at compression ${f2(withB.comp)} / press ${f2(withB.press)} with the bend and compression ${f2(without.comp)} / press ${f2(without.press)} without it (the bend is what squashes the toy into the table); the flag is true exactly while the flat press reads under 0.1`,
    without.comp < 0.1 && withB.comp > without.comp && withB.press >= 0.9 && without.press >= 0.9 && CALIBRATION.bendWithPress === true);
  check(`the meter is never paid twice for one press, with the bend or without it: one release event (intensity ${f2(withB.relI)} / ${f2(without.relI)}), one release sound, one release in the stats, one squelch voice, and the meter holds exactly ONE feed of that release (${withB.sp.toFixed(4)} / ${without.sp.toFixed(4)} SP against ${withB.direct.toFixed(4)} / ${without.direct.toFixed(4)} SP fed once to a fresh collection)`,
    withB.releases === 1 && without.releases === 1 && withB.audioReleases === 1 && without.audioReleases === 1 && withB.statReleases === 1 && without.statReleases === 1 && withB.squelchVoices === 1 && without.squelchVoices === 1
    && withB.sp > 0.5 && Math.abs(withB.sp - withB.direct) < 1e-9 && Math.abs(without.sp - without.direct) < 1e-9 && Math.abs(withB.sp - without.sp) < 0.05 * withB.sp);
}

/* ───────────────────────── 7g. SHELL-4: the Cut tool on the REAL SoftBody (the mock bodies of 5d prove the logic; this proves it against the real physics' measureCut / setNeck / pieces / setFrac) ───────────────────────── */
{
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const { createCutter, PART_GAP_DEFAULT, PART_S_DEFAULT, supportAlong, JOIN_ALL_S, BRIDGE_HOLD_S } = await import('../../src/shell/cut.ts');
  void createCutter;
  const g = makeStarterGenome();
  const w = createMockWorld({ storage: null });
  const fake = upgrade(w);
  void fake;
  const st = w.stage as unknown as Record<string, unknown>;
  const bridges: Array<[number, number, number]> = [], seams: number[] = [], chunkFlags: boolean[] = [];
  st.setCutSeam = (_id: number, pl: unknown, t: number) => { seams.push(pl ? t : 0); };
  st.setBridge = (a: number, b: number, t: number) => { bridges.push([a, b, t]); };
  st.partPieces = () => {};
  const baseAdd = st.addBody as (b: SoftBodyLike, gg: Genome, o?: { chunk?: boolean }) => number;
  st.addBody = (b: SoftBodyLike, gg: Genome, o?: { chunk?: boolean }) => { chunkFlags.push(!!o?.chunk); return baseAdd(b, gg, o); };
  const au = w.audio as unknown as Record<string, unknown>;
  const calls: Array<[string, Record<string, unknown>]> = [];
  au.cut = (p: Record<string, unknown>) => calls.push(['cut', p]);
  au.rejoin = (p: Record<string, unknown>) => calls.push(['rejoin', p]);
  w.deps.createBody = ((gg: Genome, o?: { at?: { x: number; y: number; z: number }; piece?: unknown }) => (o?.piece ? new (SoftBody as unknown as new (g: Genome, o: unknown) => SoftBodyLike)(gg, { piece: o.piece })
    : o?.at ? new (SoftBody as unknown as new (g: Genome, o: unknown) => SoftBodyLike)(gg, { piece: { frac: 1, chunk: false, at: o.at } }) : new SoftBody(gg) as unknown as SoftBodyLike)) as typeof w.deps.createBody;
  const now = (): number => 1_700_000_000_000 + w.clock.t;
  const collection = createCollection({ storage: null, profile: null, now, random: () => 0.4 });
  const app = createApp({ ...w.deps, collection, epochNow: now, genome: g });
  app.resize(800, 600, 1);
  app.setPhase('play');
  const go = (ms: number, each?: () => void): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); each?.(); left -= d; } };
  const notices: string[] = [];
  app.on('notice', (t) => notices.push(t));
  go(1500);
  const whole0 = app.body as unknown as InstanceType<typeof SoftBody>;
  const id0 = app.identity, items0 = app.hoard.items().length, fill0 = app.hoard.meter().sp;
  const settleIdle = (max = 3000): void => { for (let t = 0; t < max && app.cut.busy; t += 1000 / 60) go(1000 / 60); };
  const r1 = app.cut.splitInTwo();
  go(120);
  const necking = app.cut.busy && seams.length > 0 && Math.max(...seams) > 0;
  settleIdle();
  const f2 = app.cut.fracs();
  const face = app.body as unknown as InstanceType<typeof SoftBody>;
  const xs = app.bodies.extras.filter((x) => x.piece);
  const frameFace = (face as unknown as { frac?: number }).frac;
  check('X01 real physics (node, through the whole game): Split in two necks (the real setNeck), then two real pieces whose shares sum to 1 (0.5 %); RE-SPECIFIED 2026-10-08: both are peers built as pieces of the cut (PieceInfo, no chunk flag ever reaches the stage), the play body is the LARGER one (a new SoftBody, same identity), the other is the one extra',
    r1 === 'cut' && necking && f2.length === 2 && Math.abs(f2[0] + f2[1] - 1) < 0.005 && face !== whole0 && Math.abs((frameFace ?? 0) - f2[0]) < 1e-6 && f2[0] >= f2[1] - 1e-9 && xs.length === 1 && chunkFlags.every((c) => c === false) && !!face.piece && !!xs[0].body.piece && app.identity.itemId === id0.itemId && app.identity.genome === id0.genome,
    `${r1}; fracs ${f2.map((f) => f.toFixed(3)).join(' + ')}; neck ${necking}; extras ${xs.length}; stage chunk flags ${JSON.stringify(chunkFlags)}`);
  // X19, RE-SPECIFIED because the owner changed the design on 2026-10-08 (the closed loop of SETTLE_GAP / SETTLE_S is gone, CUT2.md 6.5): the scripted parting opens the pair by G = PART_GAP x (R0 / 0.5) +-20 % by PART_S and holds to 4 s (drift under 1 cm)
  const relXZ = (): { x: number; z: number } => { const a = app.body.center, b = xs[0].body.center; return { x: a.x - b.x, z: a.z - b.z }; };
  const rel0 = relXZ(), hl0 = Math.hypot(rel0.x, rel0.z) || 1, hd = { x: rel0.x / hl0, z: rel0.z / hl0 };
  const openNow = (): number => { const r = relXZ(); return (r.x - rel0.x) * hd.x + (r.z - rel0.z) * hd.z; };
  const Gw = PART_GAP_DEFAULT * (whole0.restRadius / 0.5);
  go(PART_S_DEFAULT * 1000);
  const openAtPS = openNow();
  go(4000 - PART_S_DEFAULT * 1000);
  const open4 = openNow();
  check(`X19 parting: the scripted parting opens the pair to G ${Gw.toFixed(3)} m +-20 % by PART_S ${PART_S_DEFAULT} s (measured ${openAtPS.toFixed(3)} m) and holds to 4 s (drift under 1 cm; measured ${(open4 - openAtPS).toFixed(3)} m)`,
    Math.abs(openAtPS - Gw) <= 0.2 * Gw && Math.abs(open4 - openAtPS) < 0.01, `G ${Gw.toFixed(3)}, at PART_S ${openAtPS.toFixed(3)}, at 4 s ${open4.toFixed(3)}`);
  check('X06 real physics: cutting paid the meter nothing and the Hoard saw no piece', app.hoard.meter().sp === fill0 && app.hoard.items().length === items0 && app.mat.count === 1, `sp ${fill0} -> ${app.hoard.meter().sp}`);
  // a second Split in two on the real physics. RE-SPECIFIED because the owner removed the piece limit on 2026-10-09 (it was the limit of 2 pieces, refused in words, from 2026-10-08): the second press now just makes 3 pieces
  // (the largest piece halved: 0.5 + 0.25 + 0.25); deeper nesting: cutter_checks.ts, section nested and u01
  const r2 = app.cut.splitInTwo(); settleIdle(); go(500);
  const f3 = app.cut.fracs(), sum3 = f3.reduce((s, f) => s + f, 0);
  check('X01 real physics (RE-SPECIFIED 2026-10-09, no limit): a second Split in two (the biggest piece) makes 3 pieces, shares sum to 1, all positive, the biggest piece was the one halved (0.5 + 0.25 + 0.25 within a few percent)',
    Math.abs(sum3 - 1) < 0.005 && f3.every((f) => f > 0)&& r2 === 'cut' && f3.length === 3 && Math.max(...f3) < 0.56 && Math.min(...f3) > 0.2, `${r2}; ${f3.map((f) => f.toFixed(3)).join(' + ')}`);
  // Reconnect all: the bridge is held in view (the pieces' skins stay apart BRIDGE_HOLD_S), every piece flows into the anchor, a FRESH whole body of the same genome replaces it
  const bridgeCalls0 = bridges.length;
  const started = app.cut.reconnectAll(true);
  const gaps: number[] = [];
  for (let t = 0; t < JOIN_ALL_S * 1000 + 200; t += 1000 / 60) {
    go(1000 / 60);
    const ex = app.bodies.extras.filter((x) => x.piece);
    if (ex.length) gaps.push(Math.max(...ex.map((x) => { const a = app.body, b = x.body; const dx = a.center.x - b.center.x, dy = a.center.y - b.center.y, dz = a.center.z - b.center.z, d = Math.hypot(dx, dy, dz) || 1, u = { x: dx / d, y: dy / d, z: dz / d }; return d - supportAlong(b, u) - supportAlong(a, { x: -u.x, y: -u.y, z: -u.z }); })));
  }
  settleIdle(); go(300);
  const apart = gaps.filter((x) => x > 0.02 * whole0.restRadius).length / 60;
  const fw = app.body as unknown as InstanceType<typeof SoftBody>;
  check(`X04 real physics: Reconnect all ends whole: one body, a FRESH whole SoftBody (frac 1, not a piece) of the same genome, no piece on the mat; "Whole again."; rejoin({ all }) once; the bridge was drawn every step (${bridges.length - bridgeCalls0} setBridge calls)`,
    started && app.cut.pieces === 1 && app.bodies.extras.length === 0 && fw !== face && (fw as unknown as { frac?: number }).frac === 1 && app.identity.genome === id0.genome && notices.includes('Whole again.') && calls.filter((c) => c[0] === 'rejoin' && c[1].all === true).length === 1 && bridges.length - bridgeCalls0 >= 20,
    `pieces ${app.cut.pieces}, extras ${app.bodies.extras.length}, notices ${notices.join(' | ')}`);
  check(`Reconnect all keeps the glowing bridge in view: the skins of some piece stay more than 2 % of the radius apart for ${apart.toFixed(2)} s (>= BRIDGE_HOLD_S ${BRIDGE_HOLD_S} s; it was 0.02 s when the pieces were already overlapping at the start of the join)`, apart >= BRIDGE_HOLD_S - 0.02, `${apart.toFixed(2)} s of ${gaps.length / 60} s`);
  // leaving reconnects, on the real physics: a switch to another genome while cut
  app.cut.splitInTwo(); settleIdle(); go(300);
  const cutAgain = app.cut.pieces;
  app.setGenome(speciesBaseGenome('twangle', 1));
  check('X05 real physics: a switch of squishy while cut reconnects first (the new squishy is whole, nothing left on the mat, the Hoard unchanged)', cutAgain === 2 && app.cut.pieces === 1 && app.bodies.extras.length === 0 && app.hoard.items().length === items0, `pieces ${cutAgain} -> ${app.cut.pieces}`);
  app.dispose();
}

/* ───────────────────────── 7h. SHELL-4 fix round 2 (VERIFY_SHELL4 A-F3 / A-F7), RE-SPECIFIED because the owner changed the design on 2026-10-08: where do the pieces of a cut GO, and how big are they, on the REAL physics (the TRUE cut) ───────────────────────── */
// Both verifiers measured the same failures with the shell untouched by them: a level swipe threw the top piece up to 55 m on putty, gummy, firm silicone, pop dome, slow-rise and bead families, the first
// Split in two left some pieces 6 .. 13 % off their share, and the neck of a firm / putty body threw the whole body up 3x its height. The legacy chunk rows are gone (CUT2.md 14: replaced by X13 and L9 in PHYS's
// probe_flush.ts); what stays runs the TRUE cut through the whole game: the highest centre of any piece after a level swipe and after Split in two, and the volumes against the shares.
{
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const Ctor = SoftBody as unknown as new (g: Genome, o?: unknown) => SoftBodyLike & { center: { x: number; y: number; z: number } };
  const volOf = (b: SoftBodyLike): number => {
    const P = b.positions as Float32Array, I = b.indices as Uint32Array; let v = 0;
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3; v += P[a] * (P[c + 1] * P[d + 2] - P[c + 2] * P[d + 1]) - P[a + 1] * (P[c] * P[d + 2] - P[c + 2] * P[d]) + P[a + 2] * (P[c] * P[d + 1] - P[c + 1] * P[d]); }
    return v / 6;
  };
  // (1) DELETED: 'A-F3 real physics: a chunk alone with its flat cut face down, up or sideways stays on the table' built the legacy chunk (PieceOpts.chunk with cutNormal). The owner changed the design on 2026-10-08:
  //     there is no chunk any more; CUT2.md 14 says section 7h is replaced by X13 and L9 (PHYS: _harness/probe_flush.ts L1 = the swap flow on 50 species x 3 planes, L9 nested) and the legacy chunk rows are deleted, not left green on a scaled whole.
  // (2) through the whole game: a level swipe through the middle (the top piece is the one that flew) and Split in two; the highest centre of any piece in 8 s, and (Split in two) the pieces' volumes against their shares 1.8 s after
  const through = (id: string, mode: 'level' | 'split'): { hi: number; pieces: number; volErr: number } => {
    const w = createMockWorld({ storage: null });
    const st = w.stage as unknown as Record<string, unknown>;
    let vid = 100;
    st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.setCalmEffects = () => {}; st.addBody = () => ++vid; st.removeBody = () => {}; st.setCutSeam = () => {}; st.setBridge = () => {}; st.partPieces = () => {};
    st.stats = () => ({ drawCalls: 0, triangles: 0, tier: 'high', frameMsEma: 0 });
    const au = w.audio as unknown as Record<string, unknown>; au.cut = () => {}; au.rejoin = () => {};
    w.deps.createBody = ((gg: Genome, o?: { at?: { x: number; y: number; z: number }; piece?: unknown }) => (o?.piece ? new Ctor(gg, { piece: o.piece }) : o?.at ? new Ctor(gg, { piece: { frac: 1, chunk: false, at: o.at } }) : new Ctor(gg))) as typeof w.deps.createBody;
    const now = (): number => 1_700_000_000_000 + w.clock.t;
    const app = createApp({ ...w.deps, collection: createCollection({ storage: null, profile: null, now, random: () => 0.4 }), epochNow: now, genome: speciesBaseGenome(id as never, 1) });
    app.resize(800, 600, 1); app.setPhase('play');
    const go = (ms: number): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); left -= d; } };
    go(1500);
    const V0 = volOf(app.body);
    const b = app.host.bodyScreen()!;
    const r = mode === 'level' ? app.cut.swipe(b.x - 1.6 * b.r, b.y, b.x + 1.6 * b.r, b.y + 6) : app.cut.splitInTwo();
    if (r !== 'cut') { app.dispose(); return { hi: -1, pieces: 0, volErr: -1 }; }
    let hi = 0, volErr = 0;
    for (let t = 0; t < 8000; t += 1000 / 60) {
      go(1000 / 60);
      for (const bb of [app.body, ...app.bodies.extras.map((x) => x.body)]) hi = Math.max(hi, bb.center.y);
      if (mode === 'split' && Math.abs(t - 2200) < 9) {   // about 1.8 s after the parting (the neck takes 0.3 s)
        const bodies = [app.body, ...app.bodies.extras.filter((x) => x.piece).map((x) => x.body)], fr = app.cut.fracs();
        volErr = Math.max(...bodies.map((bb, i) => Math.abs(volOf(bb) / (fr[i] * V0) - 1)));
      }
    }
    const pieces = app.cut.pieces;
    app.dispose();
    return { hi, pieces, volErr };
  };
  const rowsL: string[] = [];
  let hiLevel = 0, badL = '';
  for (const id of ['kneadle', 'thudge', 'prismelo', 'boingle', 'diademo']) {
    const o = through(id, 'level');
    rowsL.push(`${id} ${o.hi.toFixed(2)}`);
    if (o.hi < 0 || o.pieces !== 2) badL += ` ${id}: no cut`;
    if (o.hi > hiLevel) hiLevel = o.hi;
  }
  check('A-F3 real physics (node, through the whole game): after a LEVEL swipe through the middle no piece of kneadle / thudge (putty), prismelo (gummy), boingle (firm silicone) or diademo (pop dome) rises above 2.5 m in 8 s (the highest centre of any piece)',
    hiLevel < 2.5 && badL === '', `${rowsL.join(', ')} m${badL}; as found kneadle 12.74, prismelo 24.5, boingle 14.66, diademo 45.98`);
  const rowsS: string[] = [], vrows: string[] = [];
  let hiSplit = 0, vWorst = 0, badS = '';
  for (const id of ['dollop', 'boingle', 'caromel', 'chunkle', 'thudge', 'capnap', 'burrbin', 'crumbit', 'slumbrel', 'rattlebead']) {
    const o = through(id, 'split');
    rowsS.push(`${id} ${o.hi.toFixed(2)}`); vrows.push(`${id} ${(o.volErr * 100).toFixed(1)} %`);
    if (o.hi < 0 || o.pieces !== 2) badS += ` ${id}: no cut`;
    if (o.hi > hiSplit) hiSplit = o.hi;
    if (o.volErr > vWorst) vWorst = o.volErr;
  }
  // (the neck: the whole body, still one body, was thrown up 3 x its height by the goal's centroid drift; the highest centre of any body in the 8 s after Split in two)
  check('A-F3 real physics (node, through the whole game): after Split in two nothing rises above 1.0 m in 8 s on boingle / caromel (firm silicone), chunkle (gummy), thudge (putty), capnap, slumbrel (slow-rise), burrbin, crumbit, rattlebead (beads) and dollop: the neck no longer throws the body up',
    hiSplit < 1.0 && badS === '', `${rowsS.join(', ')} m${badS}; as found boingle 1.65, capnap 1.59, caromel 1.29, chunkle 1.16`);
  check('A-F7 real physics (node, through the whole game): 1.8 s after Split in two the mesh volume of each piece is within 6 % of its share (X01) on the bead-squeeze and slow-rise species that were 6.6 .. 11.4 % off (capnap, burrbin, crumbit, slumbrel, rattlebead) and on dollop and the firm / putty / gummy ones',
    vWorst <= 0.06, `${vrows.join(', ')}; as found capnap 6.7, burrbin 11.4, crumbit 9.4, slumbrel 9.1, rattlebead 10.5`);
}

/* ───────────────────────── 8. the collection module through the port: meter feed, events, table cap ───────────────────────── */
{
  const r = rig();
  const notices: string[] = [];
  r.app.on('notice', (t) => notices.push(t));
  const c = r.app.input.screenCentre()!;
  for (let i = 0; i < 3; i++) { r.app.input.pointerDown({ id: 40 + i, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 60); r.app.input.pointerUp({ id: 40 + i, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 1200); }
  // RE-SPECIFIED (owner decision 2026-10-06, "short taps pay nothing"): three real taps used to move the ring (fill > 0, a poke paid 0.8 SP); a tap pays nothing now, so they leave it at 0, and the
  // same wiring is then shown with a held press (1.2 s) that does pay: the feed path is the same (collection.feed with the drained SoftEvents), only the pay differs.
  const tapsPokes = r.app.profile.profile.stats.pokes;
  check('feed: three real taps through the frame loop are counted (stats.pokes) and fed to the collection but pay nothing: the practice meter stays at 0', r.app.collection.meter().fill === 0 && r.app.hoard.meter().sp === 0 && tapsPokes >= 3, JSON.stringify({ meter: r.app.collection.meter(), pokes: tapsPokes }));
  r.app.input.pointerDown({ id: 43, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 1300); r.app.input.pointerUp({ id: 43, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 1200);
  check('feed: a held press (1.2 s) through the frame loop does move the collection\'s practice meter (collection.feed with the drained SoftEvents)', r.app.collection.meter().fill > 0, JSON.stringify(r.app.collection.meter()));
  r.app.debug.shell.grant(WH_QUEUE_MAX + 2);
  const m = r.app.collection.meter();
  check(`table cap: at ${WH_QUEUE_MAX} play capsules the table is full, the ring stays full and "Table full" is announced once (COLLECTION C-5, 9.7)`,
    m.credits === WH_QUEUE_MAX && m.tableFull && notices.filter((t) => /Table full/.test(t)).length === 1, JSON.stringify({ m, notices }));
  check('table full: one capsule on the table, one meter-full plink per capsule earned', r.fake.log.count('dropCapsule') === 1 && r.fake.log.count('meterFull') === WH_QUEUE_MAX, `drops ${r.fake.log.count('dropCapsule')}, plinks ${r.fake.log.count('meterFull')}`);
  check('the starter ghost keeps the shell\'s starter id (the collection was given no profile here: its own starter)', r.app.hoard.items().length === 1 && r.app.hoard.items()[0].species === 'dollop');
}

/* ───────────────────────── 8b. visible XP (FUN.md 2): the gain cue and the pending gain of a hold (xp.ts) ───────────────────────── */
{
  const { gainOf, createPending, heldPay, LEVEL_STEP, GAIN_EPS } = await import('../../src/shell/xp.ts');
  const { PAY } = await import('../../src/core/meter.ts');
  type MV = Parameters<typeof gainOf>[0];
  const mv = (sp: number, credits: number, threshold = 30): MV => ({ ledger: 'practice', fill: sp / threshold, sp, threshold, credits, playCredits: credits, resting: false, doneToday: false, tableFull: false, offline: false });
  check('xp gainOf: the squish points one touch added (across a capsule too; nothing when the meter did not move)',
    Math.abs(gainOf(mv(10, 0), mv(10.8, 0)) - 0.8) < 1e-9 && Math.abs(gainOf(mv(29.5, 0), mv(0.7, 1, 50)) - 1.2) < 1e-9 && gainOf(mv(5, 0), mv(5, 0)) === 0);
  // OWNER DECISION 2026-10-06 ("short taps pay nothing"): a tap pays 0 SP, so the meter view does not move and gainOf is 0 (a bit of float noise or a backwards step is no gain either)
  check('xp gainOf: a touch that paid nothing (a tap) has no gain: an unchanged meter, float noise under GAIN_EPS and a meter that went back all read 0, and the smallest real pay (a 0.028 SP freshness-floor squeeze) still reads as a gain',
    gainOf(mv(7, 2), mv(7, 2)) === 0 && gainOf(mv(7, 2), mv(7 + GAIN_EPS / 2, 2)) === 0 && gainOf(mv(7, 2), mv(6.9, 2)) === 0 && Math.abs(gainOf(mv(7, 2), mv(7.028, 2)) - 0.028) < 1e-9 && GAIN_EPS === 1e-6);
  const calls: Array<[string, number, number]> = [];
  let lv = 0.503;
  const pend = createPending({ preview: (k, h, l) => { calls.push([k, h, l]); return 1.5; }, heldFor: (f) => (f === 0 ? 1.2 : 0), pullFor: (f) => (f === 1 ? 2 : 0), pullLevel: () => lv });
  const fr = pend.fill(mv(0, 0), 0);
  lv = 0.506; pend.fill(mv(0, 0), 0);
  lv = 0.531; pend.fill(mv(0, 0), 0);
  const pulls = calls.filter((c) => c[0] === 'pull');
  check('xp pending: Collection.previewTouch is called positionally (kind, heldS, level); the level stays the same number until it moves by LEVEL_STEP; the arc = summed SP / threshold',
    calls[0][0] === 'squeeze' && calls[0][1] === 1.2 && pulls[0][1] === 2 && pulls[0][2] === pulls[1][2] && pulls[2][2] !== pulls[1][2] && Math.abs(pulls[2][2] - 0.53) < LEVEL_STEP && Math.abs(fr - 3 / 30) < 1e-9 && pend.source === 'collection',
    JSON.stringify(calls));
  check('xp pending (no preview: the published constants): a squeeze from 0.4 s (base + per second + the soft pop), a stretched pull pullBase + pullPerSecond x hold, an unstretched one flat, none under 0.05',
    heldPay('squeeze', 0.3, 0) === 0 && Math.abs(heldPay('squeeze', 2, 0) - (PAY.squeezeBase + 2 * PAY.squeezePerSecond + PAY.softPop)) < 1e-9 && Math.abs(heldPay('pull', 2, 0.6) - (PAY.pullBase + 2 * PAY.pullPerSecond)) < 1e-9 && heldPay('pull', 2, 0.2) === PAY.pullFail && heldPay('pull', 2, 0.03) === 0 && heldPay('pull', 9, 0.6) === heldPay('pull', PAY.pullHoldCapSeconds, 0.6));
  // OWNER DECISION: a tap has no pending arc and the two sources agree on it. The constants path (no previewTouch) and the collection's own previewTouch must give the same pending
  // gain at a fresh meter for every hold and level, with 0 for a squeeze under 0.4 s (a tap) and for a pull at 0.05 or less, and the arc starts at the 0.4 s squeeze threshold
  {
    const cc = createCollection({ storage: null, profile: null });
    const holds = [0, 0.1, 0.39, 0.3999, 0.4, 0.41, 1, 1.79, 1.8, 2.5, 3, 9], levels = [0, 0.04, 0.05, 0.06, 0.34, 0.35, 0.6, 1];
    let worst = 0, n = 0;
    for (const h of holds) {
      worst = Math.max(worst, Math.abs(cc.previewTouch!('squeeze', h, 0) - heldPay('squeeze', h, 0))); n++;
      for (const l of levels) { worst = Math.max(worst, Math.abs(cc.previewTouch!('pull', h, l) - heldPay('pull', h, l))); n++; }
    }
    const arcAt = (heldS: number, withPreview: boolean): number => createPending({ preview: withPreview ? (k, h, l) => cc.previewTouch!(k, h, l) : null, heldFor: (f) => (f === 0 ? heldS : 0), pullFor: () => 0, pullLevel: () => 0 }).fill(mv(0, 0, 100), 0);
    check('xp pending: a tap pends nothing, and the constants path agrees with Collection.previewTouch (a squeeze held 0.39 s: no arc by either; 0.41 s: the same arc by both), over all holds and levels',
      worst < 1e-9 && heldPay('squeeze', 0.39, 0) === 0 && cc.previewTouch!('poke', 0, 0) === 0 && cc.previewTouch!('squeeze', 0.39, 0) === 0 && arcAt(0.39, true) === 0 && arcAt(0.39, false) === 0
      && arcAt(0.41, true) > 0 && Math.abs(arcAt(0.41, true) - arcAt(0.41, false)) < 1e-12 && Math.abs(arcAt(0.41, true) - (PAY.squeezeBase + PAY.squeezePerSecond * 0.41) / 100) < 1e-12, `${n} (hold, level) pairs, worst difference ${worst}`);
    cc.dispose();
  }
  check('xp pending: nothing pends when the table is full or the day is done',
    pend.fill({ ...mv(0, 5), tableFull: true }, 0) === 0 && pend.fill({ ...mv(0, 0), doneToday: true }, 0) === 0);
  // through the game with the real collection (its previewTouch): a 1.2 s press shows a pending arc; its release pays a squeeze, emits one
  // 'gain' with the SP, and the arc it showed matches what banked; a poke (a tap) emits NO gain (it pays nothing: owner decision 2026-10-06)
  const r = rig();
  const gains: Array<{ kind: string; sp: number }> = [];
  r.app.on('gain', (g) => gains.push({ kind: g.kind, sp: g.sp }));
  const c = r.app.input.screenCentre()!;
  run(r, 3000);
  r.app.input.pointerDown({ id: 60, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 1200);
  const shown = r.app.pendingFill();
  const th = r.app.hoard.meter().threshold;
  r.app.input.pointerUp({ id: 60, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 300);
  const sq = gains.find((g) => g.kind === 'squeeze');
  // RE-SPECIFIED (owner decision 2026-10-06, "short taps pay nothing"): the last clause said "the press's first contact paid a poke" (gains.some poke); the first contact of a press is a tap (a poke SoftEvent),
  // which pays nothing now, so it must emit no gain: the clause is inverted, the rest of the row (pending arc, one squeeze gain, the arc matched what banked) is unchanged.
  check('xp through the game: a held press shows a pending arc (the collection preview), the release pays a squeeze (one gain event with its SP) and the arc matched what banked (within 10%); the press\'s first contact (a poke, a tap) paid nothing and emitted no gain',
    r.app.pendingSource === 'collection' && shown > 0 && r.app.pendingFill() === 0 && !!sq && Math.abs(sq.sp / th - shown) <= 0.1 * shown && !gains.some((g) => g.kind === 'poke') && gains.length === 1,
    `shown ${(shown * th).toFixed(2)} SP, banked ${sq ? sq.sp.toFixed(2) : 'none'} SP; gains ${gains.map((g) => g.kind).join(',')}`);
  // OWNER DECISION 2026-10-06: real quick taps through the game (the frame loop, collection.feed, the gain read): no gain event (so no spark and no ring glow, the HUD acts on 'gain' only), no pending arc at
  // any moment, the ring does not move, and they still count as taps (stats.pokes)
  {
    const t2 = rig();
    const g2: Array<{ kind: string; sp: number }> = [];
    t2.app.on('gain', (g) => g2.push({ kind: g.kind, sp: g.sp }));
    const c2 = t2.app.input.screenCentre()!;
    run(t2, 3000);
    const m0 = JSON.stringify(t2.app.hoard.meter());
    let pendMax = 0;
    for (let i = 0; i < 8; i++) {
      t2.app.input.pointerDown({ id: 80 + i, x: c2.x, y: c2.y, t: t2.w.clock.t });
      for (let k = 0; k < 4; k++) { run(t2, 15); pendMax = Math.max(pendMax, t2.app.pendingFill()); }
      t2.app.input.pointerUp({ id: 80 + i, x: c2.x, y: c2.y, t: t2.w.clock.t });
      for (let k = 0; k < 8; k++) { run(t2, 100); pendMax = Math.max(pendMax, t2.app.pendingFill()); }
    }
    check('xp through the game: eight quick taps emit no gain event (no sparks, no ring glow), show no pending arc at any moment, leave the ring exactly where it was, and still count as taps (stats.pokes)',
      g2.length === 0 && pendMax === 0 && JSON.stringify(t2.app.hoard.meter()) === m0 && t2.app.hoard.meter().sp === 0 && t2.app.profile.profile.stats.pokes >= 8,
      `gains ${g2.length}, pending max ${pendMax}, meter ${JSON.stringify(t2.app.hoard.meter())}, pokes ${t2.app.profile.profile.stats.pokes}`);
  }
}

/* ───────────────────────── 9. keyboard focus rules (audit findings 12, 13) ───────────────────────── */
{
  const r = rig({ round2: false });
  let shortcuts = true;
  const target = new EventTarget();
  attachKeyboard(target, r.app, { onEscape: () => false, shortcutsEnabled: () => shortcuts });
  const key = (k: string, t: object | null = null): Event => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key: k, code: k === ' ' ? 'Space' : 'Key' + k.toUpperCase(), repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    if (t) Object.defineProperty(e, 'target', { value: t });
    target.dispatchEvent(e);
    return e;
  };
  const select = { tagName: 'SELECT', getAttribute: () => null };
  const slider = { tagName: 'INPUT', getAttribute: () => null };
  const play = { tagName: 'DIV', getAttribute: (a: string) => (a === 'role' ? 'application' : null) };
  const g0 = r.app.settings.gravity, m0 = r.app.muted;
  key('m', select); key('g', slider);
  check('keyboard: M on the Quality select and G on a slider do nothing (WCAG 2.1.4: shortcuts stay out of form controls)', r.app.muted === m0 && r.app.settings.gravity === g0);
  key('g', play);
  check('keyboard: G on the squishy\'s play target (role=application) toggles gravity', r.app.settings.gravity === !g0);
  shortcuts = false;
  key('g', play); key('m', play);
  check('keyboard: with Keyboard shortcuts off, G and M do nothing anywhere', r.app.settings.gravity === !g0 && r.app.muted === m0);
  const sp = key(' ', play);
  r.w.run(r.app, 60);
  check('keyboard: Space on the play target presses the squishy (synthetic pointer through the gesture code)', sp.defaultPrevented && r.app.input.isDown(KEY_POINTER_ID));
  target.dispatchEvent(Object.assign(new Event('keyup'), { key: ' ', code: 'Space' }));
  r.w.run(r.app, 300);
  // [ and ] (the quick switcher): only on a play surface, only with shortcuts on, never in a form control
  const sw: number[] = [];
  const t2 = new EventTarget();
  const on2 = { v: true };
  attachKeyboard(t2, r.app, { onEscape: () => false, shortcutsEnabled: () => on2.v, onSwitch: (d) => sw.push(d) });
  const key2 = (k: string, t: object): void => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key: k, code: k === ']' ? 'BracketRight' : 'BracketLeft', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    Object.defineProperty(e, 'target', { value: t });
    t2.dispatchEvent(e);
  };
  const input = { tagName: 'INPUT', getAttribute: () => null };
  key2(']', select); key2('[', input);
  const inControls = sw.length;
  key2(']', play); key2('[', play);
  on2.v = false; key2(']', play);
  check('keyboard: ] and [ switch the squishy on the play target (newest +1, oldest -1), never in a form control, and not with shortcuts off',
    inControls === 0 && sw.join() === '1,-1', `in controls ${inControls}, calls ${sw.join()}`);
}

/* ───────────────────────── 10. boot failure part-way disposes audio and stage (audit finding 7) ───────────────────────── */
{
  for (const which of ['stage', 'body'] as const) {
    const w = createMockWorld();
    let audioDisposed = 0;
    (w.audio as unknown as { dispose: () => void }).dispose = () => { audioDisposed++; };
    if (which === 'stage') w.deps.createStage = () => { throw new Error('no webgl'); };
    else w.deps.createBody = () => { throw new Error('bad genome'); };
    let msg = '';
    try { createApp(w.deps); } catch (e) { msg = (e as Error).message; }
    check(`boot failure in create${which === 'stage' ? 'Stage' : 'Body'}: the error propagates, audio.dispose() ran${which === 'body' ? ', stage.dispose() ran' : ''}`,
      msg !== '' && audioDisposed === 1 && (which === 'stage' || w.stage.rec.count('dispose') === 1));
  }
}

/* ───────────────────────── 11. the HUD label is the catalog species name (audit finding 19) ───────────────────────── */
{
  const r = rig();
  const other = (await import('../../src/data/catalog.ts')).SPECIES_BY_TIER[3][1];
  r.app.setGenome(speciesBaseGenome(other.id, 3));
  check(`label: a ${other.tier} genome shows its catalog name "${other.name}" and tier, no invented nickname`, r.app.label.species === other.name && r.app.label.tier === other.tier && r.app.label.nickname === null);
  check('label: the starter shows "Dollop", Common', rig().app.label.species === 'Dollop' && rig().app.label.tier === 'common');
  void encodeGenome;
}

/* ───────────────────────── 12. PLAYGROUND: the LIFE host (PG_SHELL round 3; PLAYGROUND_BUILD.md 11.1, 11.2, 11.5, 11.14; SH-05 / SH-06 / EC-03 on mock bodies) ───────────────────────── */
{
  const { attachLifeHost } = await import('../../src/shell/later-life.ts');
  // (round 5, C1: the host takes the journal store and the prop world builder from their own lazy chunks, as boot.ts hands them in)
  const lifeParts = { attachJournal: (await import('../../src/shell/later-quests.ts')).attachJournal, buildPropWorld: (await import('../../src/shell/later-props.ts')).buildPropWorld };
  const mem = memoryStorage();
  const r = rig({ storage: mem });
  const before = r.app.life === null && r.app.earlyLog.n === 0;
  // a 1.2 s squeeze through the real input path BEFORE the life chunk lands: the early log keeps it
  const c = r.app.input.screenCentre()!;
  r.app.input.pointerDown({ id: 7, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 1200);
  r.app.input.pointerUp({ id: 7, x: c.x, y: c.y, t: r.w.clock.t });
  run(r, 200);
  const early = r.app.earlyLog.n;
  check('LIFE host: before the life chunk lands the game is today\'s toy (no host) and the early log keeps the player\'s squeeze (11.14: "the ring keeps the player\'s events")',
    before && r.app.life === null && early >= 1 && r.app.earlyLog.kind[0] === 1 && r.app.earlyLog.v[0] >= 1, `early ${early}`);
  const host = attachLifeHost(r.app, { parts: lifeParts, storage: mem, setTimer: () => 0, clearTimer: () => {} })!;
  run(r, 100);
  const dbg0 = host.debug() as { chars: Array<{ slot: number }>; journal: { done: string[] } | null };
  check('LIFE host: attachLifeHost attaches it (game.life), the early squeeze becomes a TOUCH record the journal counts (H1 "A gentle squeeze" done) and the log is emptied',
    r.app.life === host && r.app.earlyLog.n === 0 && !!dbg0.journal && dbg0.journal.done.includes('H1'), JSON.stringify(dbg0.journal));
  const items = r.app.hoard.items();
  const g2 = items[0]?.genome ?? speciesBaseGenome('crimpo', 3);
  r.app.mat.add({ genome: speciesBaseGenome('crimpo', 3), itemId: 'g-nodecrimpo1' });
  r.app.mat.add({ genome: speciesBaseGenome('capnap', 4), itemId: 'g-nodecapnap1' });
  void g2;
  run(r, 100);
  const dbg1 = host.debug() as { chars: Array<{ slot: number; species: string; itemId: string | null }> };
  const slots = [r.app.body, ...r.app.bodies.extras.map((x) => x.body)].map((b) => (b as unknown as { contactSlot?: number }).contactSlot);
  check('LIFE host: the party is LIFE\'s characters by stable slot (the play body and the two brought out), each body carries its contactSlot (D-65)',
    dbg1.chars.length === 3 && JSON.stringify(slots) === '[0,1,2]' && dbg1.chars.map((x) => x.species).join() === 'dollop,crimpo,capnap', JSON.stringify({ chars: dbg1.chars.map((x) => x.species), slots }));
  // SH-05 / SH-06: an `auto` land and an `auto` bump never reach feedback.handle (no land / bump sound, no shake, no haptic) nor the meter (EC-03)
  const land0 = r.w.audio.rec.count('land'), shake0 = r.w.stage.rec.count('shake'), pop0 = r.w.haptics.rec.count('pop'), dust0 = r.w.stage.rec.of('spawnFx').length;
  const fed: string[] = [];
  const realFeed = r.app.hoard.feed.bind(r.app.hoard);
  (r.app.hoard as unknown as { feed: typeof realFeed }).feed = (e, t) => { fed.push(e.kind); return realFeed(e, t); };
  const xb = r.app.bodies.extras[0].body as unknown as { queue(e: Record<string, unknown>): void };
  xb.queue({ kind: 'land', auto: true, intensity: 0.7 });
  xb.queue({ kind: 'bump', auto: true, intensity: 0.4, finger: -1 });
  run(r, 50);
  const autoOk = r.w.audio.rec.count('land') === land0 && r.w.stage.rec.count('shake') === shake0 && r.w.haptics.rec.count('pop') === pop0 && r.w.stage.rec.of('spawnFx').length === dust0 && !fed.includes('land') && !fed.includes('bump');
  check('LIFE host (SH-05, SH-06, EC-03): an auto land and an auto bump go to the attention budget only: no land sound, no dust, no shake, no haptic, and never collection.feed',
    autoOk, JSON.stringify({ land: r.w.audio.rec.count('land') - land0, shake: r.w.stage.rec.count('shake') - shake0, pop: r.w.haptics.rec.count('pop') - pop0, fed }));
  // ... and a land LIFE did not cause (no physics flag, no LIFE drive: a toss, a ceremony drop) is the published path, bit for bit: the land sound and the dust
  xb.queue({ kind: 'land', intensity: 0.7 });
  run(r, 50);
  check('LIFE host: a land LIFE did not cause still takes the published path (feedback.handle: the land sound and its dust)', r.w.audio.rec.count('land') === land0 + 1 && fed.includes('land'), `land +${r.w.audio.rec.count('land') - land0}`);
  (r.app.hoard as unknown as { feed: typeof realFeed }).feed = realFeed;
  // quiet: any non-Hand tool; autonomy off reaches the snapshot
  r.app.setTool('snap');
  run(r, 50);
  const q1 = (host.debug() as { quiet: boolean }).quiet;
  r.app.setTool('hand');
  run(r, 50);
  const q0 = (host.debug() as { quiet: boolean }).quiet;
  r.app.setSetting('autonomy', false);
  run(r, 50);
  const a0 = (host.debug() as { autonomy: boolean }).autonomy;
  r.app.setSetting('autonomy', true);
  run(r, 50);
  check('LIFE host: quiet while Snap is in hand (any non-Hand tool) and not with the Hand; "Squishies move on their own" off reaches LIFE (snapshot.autonomy false)', q1 && !q0 && a0 === false && (host.debug() as { autonomy: boolean }).autonomy === true);
  // the ring: the Journal's UI record and the travel refusal of a place that is not open
  const okHome = await host.travel('ripple');
  check('LIFE host: travel refuses a place that has not shipped or is not open (the player stays where they were)', okHome === false && host.place === 0);
  r.app.dispose();
  check('LIFE host: dispose detaches it (game.life null after the game is disposed)', r.app.life === null);
}

/* ───────────── 13. PLAYGROUND on the REAL SoftBody (PG_SHELL round 3): FN-01, the party through a ceremony (11.3, D-52), thing taps, the cabin's kettle, coming home ─────────────
 * The real physics (props.ts and softbody.ts) and the real LIFE, journal and reducer, with a recording stage that projects through a real camera and drops a capsule at once
 * (no round-2 reveal: the ceremony's own swapTo path). Sim time only (the stepping below), so every row is repeatable. */
{
  const THREE = await import('three');
  const { SoftBody } = await import('../../src/physics/softbody.ts');
  const { attachLifeHost } = await import('../../src/shell/later-life.ts');
  // (round 5, C1: the host takes the journal store and the prop world builder from their own lazy chunks, as boot.ts hands them in)
  const lifeParts = { attachJournal: (await import('../../src/shell/later-quests.ts')).attachJournal, buildPropWorld: (await import('../../src/shell/later-props.ts')).buildPropWorld };
  const { buildPropWorld } = await import('../../src/physics/props.ts');
  const { PLACE: HOME } = await import('../../src/data/place_home.ts');
  const { createMockStage, createMockAudio, createMockHaptics } = await import('../mocks.ts');
  const { createProfileStore } = await import('../../src/core/save.ts');
  type SB = SoftBodyLike;
  // R4b: a place's framing reaches its front things (setPlayBounds' front edge = max(bounds, the things' footprints) + 0.1 m): the cabin's TALL Rocker Board
  // (z 3.0, half width 0.3) lay on the bounds' front edge, under the phone's bottom HUD rows; the wide cabin is unchanged (every thing inside its bounds)
  {
    const { frontReach } = await import('../../src/shell/later-life.ts');
    const { loadPlaceDef } = await import('../../src/data/places.ts');
    const cab = await loadPlaceDef('hearthlog');
    const tallF = frontReach(cab, 1), wideF = frontReach(cab, 0);
    check('PLAYGROUND a place\'s framing reaches its front things: the cabin\'s tall layout frames to the Rocker Board\'s front edge (3.3 m, past the bounds\' 3.0); the wide layout\'s things all lie inside its bounds (2.4 m)',
      Math.abs(tallF - 3.3) < 0.01 && wideF <= 2.4, `tall ${tallF.toFixed(3)} m, wide ${wideF.toFixed(3)} m`);
  }
  // Home's one-part things shown and parked by physics' own setParked (R4b re-specification, written reason: PG_PHYS round 4 fixed the prop count, so the
  // shell's parkThing FALLBACK is gone; the row asserts the same outcomes on setParked alone, plus that the physics' first call already shows the ball)
  {
    const pw = buildPropWorld(HOME, 'wide', 1);
    const ray = (k: number): number => pw.raycast(0, 3, 6, pw.poses[k * 8], pw.poses[k * 8 + 1] - 3, pw.poses[k * 8 + 2] - 6);
    const hidden = ray(0) === -1 && ray(1) === -1;
    pw.setParked(0, false); pw.setParked(1, false);
    pw.beginFrame(); pw.endFrame(1 / 60);
    const shown = ray(0) === 0 && ray(1) === 1;
    pw.poke(0, 1.2, 0, 0);
    for (let i = 0; i < 30; i++) { pw.beginFrame(); pw.endFrame(1 / 60); }
    const rolled = pw.poses[0] - 0.85;
    pw.setParked(1, true);
    check('PLAYGROUND Home\'s things by physics\' setParked (no shell fallback): built parked (no collider), the Felt Ball and Music Box shown get a collider (the ray hits them), the ball rolls from a poke, and parking takes the collider away again',
      hidden && shown && rolled > 0.2 && ray(1) === -1, `built parked ${hidden}; shown ${shown}; rolled ${rolled.toFixed(3)} m in 0.5 s; parked again ${ray(1) === -1}`);
  }
  const W = 1280, H = 800;
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
    dropCapsule: (o?: { onLand?: () => void }) => { const c = { landed: false, removed: false }; setTimeout(() => { c.landed = true; o?.onLand?.(); }, 0);
      return { id: 1, get landed() { return c.landed && !c.removed; }, screenPoint: () => (c.landed && !c.removed ? { x: 700, y: 400, r: 40 } : null), hitTest: () => false, setSqueeze: () => {}, wobble: () => {}, remove: () => { c.removed = true; } }; },
  });
  let bound: { poses: Float32Array | null; count: number; thing: Int16Array | null } = { poses: null, count: 0, thing: null };
  st.bindProps = (poses: Float32Array | null, count: number, thing: Int16Array | null) => { bound = { poses, count, thing }; };
  for (const k of ['setHomeThing', 'setAutonomyFraming', 'setBodyPose', 'setBodyGaze', 'setBodyExpression', 'setBodyLook', 'setBodyAsleep', 'setKeepsakes', 'setObstacles', 'setHeatPoint', 'setPlayBounds', 'thingFx']) st[k] = (...a: unknown[]) => log.rec(k, ...a);
  const v3 = new THREE.Vector3();
  const proj = (x: number, y: number, z: number): { x: number; y: number } | null => { v3.set(x, y, z).project(cam); return Math.abs(v3.x) > 1 || Math.abs(v3.y) > 1 ? null : { x: (v3.x * 0.5 + 0.5) * W, y: (0.5 - v3.y * 0.5) * H }; };
  st.bodyScreenPoint = (vid: number, out: Float32Array) => { const b = views.get(vid); const p = b ? proj(b.center.x, b.center.y, b.center.z) : null; if (!p) return false; out[0] = p.x; out[1] = p.y; out[2] = 40; return true; };
  const audio = createMockAudio() as ReturnType<typeof createMockAudio> & Record<string, unknown>;
  audio.creature = () => true;
  for (const k of ['setTouching', 'autoThud', 'prop', 'musicBox', 'setAmbience', 'setMusicStyle']) audio[k] = (...a: unknown[]) => log.rec('a.' + k, ...a);
  audio.loadAmbience = async () => true;
  const mem = memoryStorage();
  let clockT = 1000;
  const devSkew = { ms: 0 };
  const profile = createProfileStore(mem);   // (boot.ts: the profile and the collection share the starter id)
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
  type Dbg = { chars: Array<{ slot: number; species: string; itemId: string }>; party: { held: boolean }; tune: { on: boolean; kind: number; kettle: number; kettleNext: number | null }; place: number; tap: string; firstPlaySent: boolean; things: Array<{ id: string; shown: boolean; parked: boolean | null; x: number | null; z: number | null }> };
  const dbg = (): Dbg => host.debug() as Dbg;
  const done = (): string[] => ((app.debug.quests?.() as { quests: Array<{ id: string; done: boolean }> } | null)?.quests ?? []).filter((q) => q.done).map((q) => q.id);
  const thingPt = (thing: number, dy = 0): { x: number; y: number } | null => { if (!bound.poses || !bound.thing) return null; for (let p = 0; p < bound.count; p++) if (bound.thing[p] === thing) return proj(bound.poses[p * 8], bound.poses[p * 8 + 1] + dy, bound.poses[p * 8 + 2]); return null; };
  const tap = async (pt: { x: number; y: number } | null): Promise<void> => { if (!pt) return; app.input.pointerDown({ id: 7, x: pt.x, y: pt.y, type: 'mouse', button: 0 }); await stepA(6); app.input.pointerUp({ id: 7, x: pt.x, y: pt.y, type: 'mouse', button: 0 }); await stepA(2); };
  step(30);
  // FN-01: a held squeeze (H1), then the player lets go and Dollop plays by itself 6 s later (FIRST_PLAY -> a USE by SELF: H2)
  const cc = app.input.screenCentre()!;
  app.input.pointerDown({ id: 1, x: cc.x, y: cc.y, type: 'touch' }); step(75); app.input.pointerUp({ id: 1, x: cc.x, y: cc.y, type: 'touch' });
  await stepA(720);
  check('PLAYGROUND FN-01 (real body): a held squeeze is H1; 6 s after the player lets go Dollop plays by itself (FIRST_PLAY, a USE by SELF at Home: H2); the Felt Ball is shown with its collider',
    done().includes('H1') && done().includes('H2') && dbg().firstPlaySent && dbg().things[0].shown && dbg().things[0].parked === false, JSON.stringify({ done: done(), ball: dbg().things[0] }));
  // R4: with the host attached, a drag by ANY pointer id still reaches the gesture machine (the dev hook's pointers are NEGATIVE, -1 for its pointer 0; round 4's
  // first hand-slot version used -1 as "free" and swallowed that pointer's moves: no squishy could be lifted through the dev hook)
  {
    let lifted = false;
    const p0 = app.input.screenCentre()!;
    app.input.pointerDown({ id: -1, x: p0.x + 40, y: p0.y, type: 'touch' }); step(7);
    for (let i = 1; i <= 24; i++) { app.input.pointerMove({ id: -1, x: p0.x + 40 + i * 4, y: p0.y - i * 16, type: 'touch' }); step(2); if (app.body.metrics.carried) lifted = true; }
    const owned = (host as { holds?(id: number): boolean }).holds?.(-1) === true;
    app.input.pointerUp({ id: -1, x: p0.x + 136, y: p0.y - 384, type: 'touch' }); await stepA(180);
    check('PLAYGROUND the host never takes a pointer it does not hold: a drag by pointer id -1 (the dev hook\'s pointer 0) far up out of the squishy lifts it (metrics.carried), as without the host', lifted && !owned, `carried ${lifted}, host holds -1: ${owned}`);
  }
  // the player's taps on the Felt Ball (one squishy out: nothing in front of it): three flicks roll it (H9)
  const b0 = { ...dbg().things[0] };
  for (let k = 0; k < 3; k++) { await tap(thingPt(0)); await stepA(120); }
  const b1 = dbg().things[0];
  check('PLAYGROUND thing taps: three still clicks on the Felt Ball roll it away from the camera (USE ROLL by PLAYER x3: H9 "Roll the ball")',
    done().includes('H9') && Math.hypot((b1.x ?? 0) - (b0.x ?? 0), (b1.z ?? 0) - (b0.z ?? 0)) > 0.3, `${JSON.stringify(done())}; ball ${b0.x},${b0.z} -> ${b1.x},${b1.z}`);
  // the first capsule: the newcomer in play, Dollop back beside it in its LIFE slot (11.3, D-52), the newcomer NEW (its hello: H5)
  const dollopSlot = dbg().chars[0]?.slot;
  app.debug.shell.grant(1);
  await stepA(30);
  const op1 = app.capsules.openNext();
  for (let k = 0; k < 60 && app.ceremonies.active; k++) await stepA(10);
  await op1;
  await stepA(30);
  const d1 = dbg();
  check('PLAYGROUND party through a ceremony (11.3, D-52): after the first capsule two are out (the newcomer in play, Dollop beside it), Dollop kept its LIFE slot, nothing is held',
    app.mat.count === 2 && d1.chars.some((c) => c.species === 'dollop' && c.slot === dollopSlot) && !d1.party.held && app.identity.itemId !== null && d1.chars.some((c) => c.itemId === app.identity.itemId),
    JSON.stringify({ count: app.mat.count, chars: d1.chars.map((c) => [c.slot, c.species]) }));
  await stepA(300);
  check('PLAYGROUND the newcomer arrives NEW (B09) and says hello within 5 s: "Say hello" (H5) done, and "New stamp: Open a capsule" (H4) said', done().includes('H5') && said.includes('MOMENT New stamp: Open a capsule'), JSON.stringify({ done: done(), said: said.slice(-4) }));
  // the Music Box (shown from 2 out): a tap plays its tune (LIFE hears musicBoxOn), a second tap stops it
  const mb = thingPt(1);
  await tap(mb);
  const t1 = { ...dbg().tune }, tap1 = dbg().tap;
  await stepA(30);
  await tap(mb);
  const t2 = dbg().tune;
  check('PLAYGROUND thing taps: a click on the Music Box plays its tune (audio.musicBox tune 0); a second click stops it', tap1 === 'musicbox' && t1.on && t1.kind === 0 && !t2.on && log.of('a.musicBox').length >= 2, JSON.stringify({ tap1, t1, t2 }));
  // 60 s after the first reveal the first wish opens Hearthlog; the trip; the kettle
  for (let k = 0; k < 40 && !(host.openPlaces() & 2); k++) await stepA(300);
  const okC = await host.travel('hearthlog');
  await stepA(60);
  const dc = dbg();
  check('PLAYGROUND travel: the first wish opens Hearthlog ("Hearthlog Cabin is open. Find it in Places."); the trip arrives ("You are at Hearthlog Cabin.": VISIT -> H8, C1) with the kettle armed 45..90 s ahead',
    okC && dc.place === 1 && said.includes('Hearthlog Cabin is open. Find it in Places.') && said.includes('You are at Hearthlog Cabin.') && done().includes('H8') && done().includes('C1')
      && dc.tune.kettle >= 0 && dc.tune.kettleNext !== null && dc.tune.kettleNext - app.simTime >= 40 && dc.tune.kettleNext - app.simTime <= 91, JSON.stringify({ tune: dc.tune, done: done() }));
  {
    // R4: Home's things leave with Home (the stage draws a shown Home thing at the bound prop of ITS index: in a place it followed the place's things 0..2)
    const last = new Map<number, boolean>(); for (const c of log.of('setHomeThing')) last.set(c.args[0] as number, c.args[1] as boolean);
    const shownBefore = [...last.keys()];
    check('PLAYGROUND Home\'s things leave with Home: in the cabin every Home thing the stage was showing is parked (setHomeThing false), none follows the cabin\'s props',
      shownBefore.length >= 3 && [...last.values()].every((v) => v === false), JSON.stringify([...last.entries()]));
  }
  check('PLAYGROUND stamp moments outside Home carry their titles (journal_text, loaded lazily): "New stamp: Come in from the snow" (C1)', said.some((t) => t === 'MOMENT New stamp: Come in from the snow'), JSON.stringify(said.filter((t) => t.startsWith('MOMENT')).slice(-3)));
  await stepA(Math.ceil(((dc.tune.kettleNext ?? 0) - app.simTime + 1) * 60));
  check('PLAYGROUND the kettle whistles by itself (audio.musicBox tune 1 for its one bar, the steam puff thingFx)', log.of('a.musicBox').some((c) => (c.args[0] as { on: boolean; tune?: number }).on && (c.args[0] as { tune?: number }).tune === 1) && log.of('thingFx').length > 0,
    JSON.stringify(log.of('a.musicBox').slice(-2).map((c) => c.args[0])));
  const fx0 = log.of('thingFx').length;
  await tap(thingPt(0, 0.2));
  check('PLAYGROUND thing taps: a click on the cabin\'s fireplace switches it (its puff; a USE SWITCH by PLAYER, C8\'s first clause)', dbg().tap === 'hearth' && log.of('thingFx').length > fx0, dbg().tap);
  // D-95 (revised, PG_SHELL round 4): the AUTO control's host side (ui/thingAuto.ts places one chip per hinge ride from autoThings) and the hand on the seat
  {
    const SWING = 3;   // the cabin's things: hearth 0, rockerboard 1, yarnball 2, pillowswing 3, snugbasket 4, kettle 5
    const seatX = (): number => { if (!bound.poses || !bound.thing) return NaN; for (let p = 0; p < bound.count; p++) if (bound.thing[p] === SWING) return bound.poses[p * 8]; return NaN; };
    const range = async (sec: number): Promise<number> => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < sec * 6; i++) { await stepA(10); const x = seatX(); lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo; };
    const rows = host.autoThings();
    const api = (host.debug() as { auto: { api: boolean } }).auto.api;
    const sw = rows.find((r) => r.id === 'pillowswing'), rk = rows.find((r) => r.id === 'rockerboard');
    const propCalls: Array<{ kind: number; key?: number; held?: number }> = [];   // (copies: the host reuses one object per call kind)
    const prop0 = audio.prop; audio.prop = (q: { kind: number; key?: number; held?: number }) => { propCalls.push({ ...q }); };
    // (R4b: physics always has setAuto / grabProp now; the round-4 FALLBACK branch is gone, so a world without them FAILS here)
    if (!api) check('PLAYGROUND D-95 the host sees physics\' AUTO and hand (PropWorld setAuto / grabProp)', false, JSON.stringify(rows));
    else {
      await stepA(600);   // (whatever the arrival stirred dies down first)
      const r0 = await range(3);
      const okOn = !!sw && host.setThingAuto(sw.k, true);
      await stepA(120);
      const r1 = await range(10);
      const onRow = host.autoThings().find((r) => r.id === 'pillowswing');
      const okOff = !!sw && host.setThingAuto(sw.k, false);
      await stepA(1800);
      const r2 = await range(3);
      check('PLAYGROUND D-95 AUTO (the player\'s toggle): the cabin offers one control each for the Pillow Swing and the Rocker Board, both OFF by default and on screen; AUTO on keeps the resting seat swinging a steady arc by itself; AUTO off lets it die down by its own damping',
        !!sw && !!rk && !sw.on && !rk.on && sw.x > 0 && sw.x < W && sw.y > 0 && sw.y < H && okOn && onRow?.on === true && r0 < 0.02 && r1 > 0.25 && okOff && r2 < 0.25 * r1,
        `seat x range at rest ${r0.toFixed(3)} m, AUTO on ${r1.toFixed(3)} m, 30 s after off ${r2.toFixed(3)} m; chips ${JSON.stringify(rows.map((r) => [r.id, r.on, Math.round(r.x), Math.round(r.y)]))}`);
      // the hand: a mouse press on the seat takes it (the gesture machine never sees the press), a drag pulls it, the release lets it swing on (AUTO off: it dies down)
      const pt = thingPt(SWING);
      const x0 = seatX();
      if (pt) app.input.pointerDown({ id: 9, x: pt.x, y: pt.y, type: 'mouse', button: 0 });
      await stepA(2);
      const took = dbg().tap, owned = app.input.isDown(9);
      for (let k = 1; k <= 8 && pt; k++) { app.input.pointerMove({ id: 9, x: pt.x + k * 14, y: pt.y, type: 'mouse' }); await stepA(4); }
      const x1 = seatX();
      if (pt) app.input.pointerUp({ id: 9, x: pt.x + 112, y: pt.y, type: 'mouse', button: 0 });
      const r3 = await range(2);
      check('PLAYGROUND D-95 the hand on the seat: a mouse press on the Pillow Swing\'s seat is the host\'s (not a camera drag), a drag to the right pulls the seat that way, and on release it swings on from the hand',
        took === 'hand:pillowswing' && owned && x1 - x0 > 0.08 && r3 > 0.05 && !app.input.isDown(9), `took ${took}, owned ${owned}, seat ${x0.toFixed(3)} -> ${x1.toFixed(3)} m, then a ${r3.toFixed(3)} m range in 2 s`);
      // its creak is a held voice (key = the prop, held = speed) while it moves
      const creaks = propCalls.filter((c) => c.kind === 2 && typeof c.held === 'number' && typeof c.key === 'number');
      check('PLAYGROUND held voices (PG_AUDIO): a moving hinge creaks as a held voice (prop kind creak with key and held 0..1) and stops with held 0', creaks.some((c) => (c.held ?? 0) > 0.05) && creaks.some((c) => c.held === 0),
        `${creaks.length} creak calls, largest held ${Math.max(0, ...creaks.map((c) => c.held ?? 0)).toFixed(2)}`);
    }
    audio.prop = prop0;
  }
  // R4b: "Go play with..." a ride (the host's playWith: LIFE's PLAY_WITH, its USE intent, physics' carryTo; round 4's FALLBACK did nothing): the play squishy is
  // lifted onto the Pillow Swing's seat and stays on it as a rider, and the lift pays nothing (no collection event on the way)
  {
    const SWING = 3;
    let seat = -1; if (bound.thing) for (let p = 0; p < bound.count; p++) if (bound.thing[p] === SWING) seat = p;
    const ride0 = (host.debug() as { counts: { ride: number } }).counts.ride;
    const sp0 = app.hoard.meter().sp, cr0 = app.hoard.meter().credits;
    const asked = host.playWith?.(app.identity.itemId ?? '', SWING) === true;
    let onAt = -1;
    for (let k = 0; k < 60 && onAt < 0; k++) { await stepA(10); if ((app.body.metrics.onProp ?? -1) === seat && !(app.body as { carryingTo?: boolean }).carryingTo) onAt = k; }
    await stepA(120);
    const ride1 = (host.debug() as { counts: { ride: number } }).counts.ride;
    const paid = app.hoard.meter().sp !== sp0 || app.hoard.meter().credits !== cr0;
    // round 5 (tightened, written reason): "riding" is ON the seat, not touching it: the squishy's centre within 0.15 m of the seat's centre across the floor and
    // above it. The seat here still swings from the hand row above (0.29 m when asked); round 4 aimed the lift at the seat where it was when asked, so the squishy
    // came down beside a seat that had swung on: with round 4's physics it leaned on the seat from the floor (0.53 m off its centre, onProp still the seat: the row
    // passed by contact), with round 5's swing damping it slid off (onProp -1). The lift now aims at the seat's rest spot and a steadying hand holds it there.
    const sx = bound.poses ? bound.poses[seat * 8] : NaN, sy = bound.poses ? bound.poses[seat * 8 + 1] : NaN, sz = bound.poses ? bound.poses[seat * 8 + 2] : NaN;
    const off = Math.hypot(app.body.center.x - sx, app.body.center.z - sz), above = app.body.center.y - sy;
    check('PLAYGROUND "Go play with..." a ride (playWith -> LIFE\'s USE -> physics carryTo): the play squishy is lifted onto the Pillow Swing\'s seat (still swinging from the push) and is still riding it 2 s later, ON it (its centre within 0.15 m of the seat\'s, above it); the lift pays nothing',
      asked && seat >= 0 && ride1 === ride0 + 1 && onAt >= 0 && (app.body.metrics.onProp ?? -1) === seat && off < 0.15 && above > 0.1 && !paid,
      `asked ${asked}, seat prop ${seat}, lifts ${ride0} -> ${ride1}, on the seat after ${onAt < 0 ? 'never' : `${(onAt + 1) * 10} frames`}, onProp now ${app.body.metrics.onProp}, centre ${off.toFixed(3)} m from the seat's, ${above.toFixed(3)} m above it, meter sp ${sp0} -> ${app.hoard.meter().sp}`);
    // round 5: the lift's steadying hand lets go once the squishy sits (the seat is free again: AUTO, which a hand would override, swings it with its rider holding on)
    {
      const swk = host.autoThings().find((r) => r.id === 'pillowswing')?.k ?? -1;
      const onA = swk >= 0 && host.setThingAuto(swk, true);
      await stepA(240);
      let lo = Infinity, hi = -Infinity, onN = 0, n = 0, offMax = 0;
      for (let k = 0; k < 24; k++) {
        await stepA(10);
        const x = bound.poses ? bound.poses[seat * 8] : NaN, z = bound.poses ? bound.poses[seat * 8 + 2] : NaN;
        lo = Math.min(lo, x); hi = Math.max(hi, x); n++;
        if ((app.body.metrics.onProp ?? -1) === seat) onN++;
        offMax = Math.max(offMax, Math.hypot(app.body.center.x - x, app.body.center.z - z));
      }
      const offA = swk >= 0 && host.setThingAuto(swk, false);
      await stepA(600);
      check('PLAYGROUND (round 5) after a "Go play with..." lift the steadying hand has let go: AUTO turned on swings the seat its arc WITH the squishy riding it (on the seat in every sample, within 0.2 m of its centre); AUTO off again',
        onA && offA && hi - lo > 0.25 && onN === n && offMax < 0.2, `seat range with the rider ${(hi - lo).toFixed(3)} m, on the seat ${onN}/${n}, at most ${offMax.toFixed(3)} m off its centre; hands ${(host.debug() as { auto: { hands: number } }).auto.hands}`);
    }
  }
  // R4 (5): the S2 places through the dev path only (data/places.ts says shipped: false, so the Travel sheet's path refuses them): each place's data loads,
  // the party arrives in it, its things that physics builds are bound with colliders, and the next trip leaves it
  // RE-SPECIFIED in round 8 (R8_SHELL 0; R7_LIFE section 5's request; written reason): the row asserted `shut === false` (the sheet's path refuses each),
  // true while the S1 build shipped only Home and the cabin. From round 7 Ripple, Frostbell and Rainleaf ship (R6_SHELL_open_s2.patch) and from round 8
  // all seven places do (R7_SHELL_open_s3.patch), so the sheet's path takes a place exactly when it ships AND its stamps opened it (QUESTS 7, 15:
  // later-life.ts travel); how many stamps the party has earned by this row depends on LIFE's trajectory. So: the sheet's path's answer equals
  // "shipped and open by stamps" (read from PLACE_INFO and the host's own open mask just before), the dev path loads each, the rest unchanged.
  {
    const rows: Array<Record<string, unknown>> = [];
    const { PLACE_INFO: PI8 } = await import('../../src/data/places.ts');
    for (const id of ['ripple', 'frostbell', 'rainleaf']) {
      const info = PI8.find((p) => p.id === id)!;
      const openMask = (host as unknown as { openPlaces(): number }).openPlaces();
      const want = info.shipped && (openMask & (1 << info.idx)) !== 0;
      const shut = await host.travel(id);
      const wantOk = shut === want;
      const ok = await host.travel(id, true);
      await stepA(60);
      const d = dbg();
      rows.push({ id, shut, want, wantOk, ok, place: d.place, chars: d.chars.length, things: d.things.length, bound: d.things.filter((t) => t.parked === false).length, noProp: d.things.filter((t) => t.parked === null).map((t) => t.id) });
      if (id === 'rainleaf') {
        // R4b: the Drip Leaf (a 'shower' switch, PLACES 2.1 M14): its Leaf Drip zone is dry on arrival; a click tips a shower (the zone on, a USE SWITCH by PLAYER);
        // SHOWER_S (4 s) later it is dry again
        const zOf = (): number => ((dbg() as unknown as { zones: Array<[string, number]> }).zones.find((z) => z[0] === 'leafdrip')?.[1] ?? -1);
        const z0 = zOf(), rec0 = (host.debug() as { counts: { records: number } }).counts.records;
        await tap(thingPt(3, 0.3));
        const z1 = zOf(), tapD = dbg().tap, rec1 = (host.debug() as { counts: { records: number } }).counts.records;
        await stepA(300);
        const z2 = zOf();
        check('PLAYGROUND the Drip Leaf (Rainleaf, dev path): its Leaf Drip zone is dry on arrival, a click tips a shower (the zone on, one more record: USE SWITCH by PLAYER), and it is dry again 4 s later',
          z0 === 0 && tapD === 'dripleaf' && z1 === 1 && rec1 > rec0 && z2 === 0, JSON.stringify({ z0, tap: tapD, z1, records: [rec0, rec1], z2 }));
      }
    }
    check('PLAYGROUND S2 by the dev path (the sheet\'s path takes a place only when it ships and its stamps opened it): Ripple Shore, Frostbell Ridge and Rainleaf Garden load, the party arrives in each, the things physics builds are bound (the ones it does not build are listed)',
      rows.every((r) => r.wantOk === true && r.ok === true && r.chars === app.mat.count && (r.bound as number) >= 3), JSON.stringify(rows));
  }
  const okH = await host.travel('home');
  await stepA(60);
  const L = (st.matLayout as (n: number) => V3[])(app.mat.count), xs = app.bodies.extras.filter((x) => !x.piece);
  check('PLAYGROUND home again: "You are at Home."; the play body at mat slot 0 and each squishy out at its mat order\'s slot (as mat.ts built them)',
    okH && dbg().place === 0 && said.includes('You are at Home.') && Math.hypot(app.body.center.x - L[0].x, app.body.center.z - L[0].z) < 0.35 && xs.every((x, j) => Math.hypot(x.body.center.x - L[j + 1].x, x.body.center.z - L[j + 1].z) < 0.35),
    `play ${app.body.center.x.toFixed(2)},${app.body.center.z.toFixed(2)}; extras ${xs.map((x) => `${x.body.center.x.toFixed(2)},${x.body.center.z.toFixed(2)}`).join(' ')}`);
  // a cut (LIFE.md 9, step.ts: lifeRemove the whole, lifeAdd each piece with group = the whole's old slot): Split in two makes a face piece and a chunk of ONE group; Reconnect all, one whole again
  type CDbg = { chars: Array<{ slot: number; kind: number; group: number; species: string; itemId: string | null; asleep?: boolean }> };
  const before = (host.debug() as CDbg).chars.find((c) => c.itemId === app.identity.itemId)!;
  // round 5 (VERDICT_PG B2; PLAYGROUND_BUILD 11.4, D-16, SH-03): the party is out (2 here) when the play squishy is cut
  const notes: string[] = [];
  const offNote = app.on('notice', (t: string) => { notes.push(t); });
  const matB = app.mat.count, idsB = [...app.mat.itemIds].join(), capB = app.cut.maxPieces;
  const wholesB = (host.debug() as CDbg).chars.filter((c) => c.kind === 0).map((c) => c.itemId).sort().join();
  const sr = app.cut.splitInTwo();
  for (let k = 0; k < 120 && app.cut.busy; k++) await stepA(10);
  await stepA(30);
  const cutC = (host.debug() as CDbg).chars.filter((c) => c.kind !== 0);
  const othersCut = (host.debug() as CDbg).chars.filter((c) => c.kind === 0 && c.itemId !== app.identity.itemId);
  const matCut = app.mat.count, idsCut = [...app.mat.itemIds].join();
  app.cut.reconnectAll(false);
  await stepA(30);
  const after = (host.debug() as CDbg).chars.filter((c) => c.itemId === app.identity.itemId);
  const wholesA = (host.debug() as CDbg).chars.filter((c) => c.kind === 0).map((c) => c.itemId).sort().join();
  offNote();
  check('PLAYGROUND a cut with LIFE: Split in two gives the squishy\'s pieces as LIFE characters of ONE group (the face piece kind 1 and a chunk kind 2, group = the whole\'s old slot); Reconnect all makes it one whole character again',
    sr === 'cut' && app.cut.pieces === 1 && cutC.length === 2 && cutC.every((c) => c.group === before.slot) && cutC.some((c) => c.kind === 1) && cutC.some((c) => c.kind === 2) && after.length === 1 && after[0].kind === 0,
    JSON.stringify({ sr, before: [before.slot, before.kind], pieces: cutC.map((c) => [c.slot, c.kind, c.group]), after: after.map((c) => [c.slot, c.kind]) }));
  check('PLAYGROUND (round 5, B2; 11.4, D-16, SH-03) a cut with a party keeps the party out: the squishy brought out stays on the mat and stays a LIFE character while the play squishy is in pieces (no "went back on the shelf" line); the pieces join as ONE group; Reconnect all gives one whole among the others (the same wholes as before the cut)',
    matB === 2 && sr === 'cut' && matCut === matB && idsCut === idsB && othersCut.length === matB - 1 && !notes.some((t) => /went back on the shelf/.test(t)) && cutC.length === 2 && new Set(cutC.map((c) => c.group)).size === 1
      && app.mat.count === matB && wholesA === wholesB && after.length === 1,
    JSON.stringify({ mat: [matB, matCut, app.mat.count], ids: [idsB, idsCut], others: othersCut.map((c) => [c.slot, c.species, c.asleep]), notes, wholes: [wholesB, wholesA] }));
  check('PLAYGROUND (round 5, B2; SH-03) the piece limit with a party: min(the tier\'s pieces cap, the characters cap - (wholes - 1)) = min(6, 10 - 1) = 6 on high with 2 out (one squishy out keeps the published safety ceiling, 64)',
    capB === 6, `maxPieces with 2 out on high: ${capB}`);
  // round 5 (VERDICT_PG B7; SH-22, D-61, D-85): 5 out on high, nobody touching: the over-budget rule brings the awake units back under unitCap (sleeping untouched
  // wholes, farthest first) and keeps them there; the verifier saw 3.06 to 4.28 units against 2.494 for 20 s
  {
    const { speciesBaseGenome } = await import('../../src/data/catalog.ts');
    for (const sp of ['crimpo', 'wisplet', 'thudge', 'capnap']) { if (app.mat.count >= 5) break; try { app.mat.add({ genome: speciesBaseGenome(sp as never, 7), itemId: null }, { restore: true }); } catch { /* none */ } await stepA(10); }
    await stepA(120);
    type UDbg = { units: number; life: { unitCap: number; allowance: number }; chars: Array<{ kind: number; asleep: boolean }> };
    const samples: Array<[number, number, number]> = [];
    // (round 5, second engineer: the same stepping as stepA(60), six steps of 10 frames, read at each: the fine samples for the wake gate's row below)
    const held0 = (host.debug() as { counts: { held?: number } }).counts.held ?? 0;
    let fineN = 0, fineOver = 0;
    for (let k = 0; k < 30; k++) {
      for (let q = 0; q < 6; q++) { await stepA(10); if (k >= 6) { const d = host.debug() as UDbg; fineN++; if (d.units > d.life.unitCap + d.life.allowance + 0.001) fineOver++; } }
      const d = host.debug() as UDbg; samples.push([+d.units.toFixed(2), +(d.life.unitCap + d.life.allowance).toFixed(3), d.chars.filter((c) => c.kind === 0 && c.asleep).length]);
    }
    const late = samples.slice(6), over = late.filter(([u, c]) => u > c + 0.001).length;
    let run = 0, maxRun = 0; for (const [u, c] of late) { run = u > c + 0.001 ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    check('PLAYGROUND (round 5, B7; SH-22) 5 out on high and no touch: after 6 s the awake units stay at or under unitCap (+ the ride allowance) in at least 22 of the next 24 one-second samples and never over it 3 s in a row (untouched wholes put to sleep, farthest first)',
      app.mat.count === 5 && over <= 2 && maxRun < 3, `${app.mat.count} out; over the cap in ${over} of ${late.length}, longest run ${maxRun} s; [units, cap, asleep] ${JSON.stringify(samples)}`);
    // round 5, second engineer (B7, SH-22): over the budget nothing wakes. LIFE keeps a mover's token while the over-budget rule puts its body to sleep, and its
    // next scoot or hop woke it straight back (this window: 13 such wakes, over the cap in 270 of 1800 frames); the host now holds a motion intent for a sleeping
    // body while waking it would pass the cap (never one the player asked for)
    const held = ((host.debug() as { counts: { held?: number } }).counts.held ?? 0) - held0;
    check('PLAYGROUND (round 5, B7; SH-22) the budget\'s wake gate: in the same window LIFE\'s motion for a sleeping squishy is held while waking it would pass unitCap, and the awake units are over the cap in at most 10 % of 6-a-second samples',
      held > 0 && fineOver <= 0.1 * fineN, `${held} motion intents held; over the cap in ${fineOver} of ${fineN} samples (${(100 * fineOver / Math.max(1, fineN)).toFixed(1)} %)`);
  }
  // round 6 (VERDICT_PG2 N1; LIFE PLAY_WITH, D-79, SH-22): "Go play with..." on the MED tier (unitCap 1.48, one mover token) with 3 out: the squishy the player asked
  // (not the play squishy) must go to the thing and use it (a USE BY PLAYER), never be put to sleep by the over-budget rule on the way (another sleeps instead).
  // The verifier saw it asleep where it stood for the Music Box and the Warm Lamp at Home (works on high and in the cabin); the same at Home and in the cabin here.
  {
    const stats0 = st.stats;
    app.mat.clear(); await stepA(10);
    { const { speciesBaseGenome } = await import('../../src/data/catalog.ts'); for (const [sp, id] of [['crimpo', 'gp-a'], ['thudge', 'gp-b']] as const) { app.mat.add({ genome: speciesBaseGenome(sp, 8), itemId: id }, { restore: true }); await stepA(10); } }
    st.stats = () => ({ ...stats0(), tier: 'med' as const });
    await stepA(300);
    type GDbg = { units: number; life: { unitCap: number }; counts: { askedUse: number }; chars: Array<{ slot: number; kind: number; itemId: string | null; asleep: boolean; x: number; z: number }>; things: Array<{ id: string; x: number | null; z: number | null }> };
    const gd = (): GDbg => host.debug() as GDbg;
    type LDbg = { life: { chars: Array<{ slot: number; beh: number; phase: number }> } };
    const trial = async (where: string): Promise<Array<Record<string, unknown>>> => {
      const rows: Array<Record<string, unknown>> = [];
      const others = (host.partyNow?.() ?? []).filter((r) => !r.play);
      const things = (host.thingsNow?.() ?? []).filter((r) => !r.ride);
      for (let j = 0; j < things.length; j++) {
        const who = others[j % Math.max(1, others.length)]?.itemId ?? '';
        const u0 = gd().counts.askedUse;
        const asked = host.playWith?.(who, things[j].k) === true;
        const at = (): { me: GDbg['chars'][number] | undefined; d: number; lc: LDbg['life']['chars'][number] | undefined } => {
          const d = gd(), me = d.chars.find((c) => c.kind === 0 && c.itemId === who), th = d.things.find((t) => t.id === things[j].id);
          return { me, d: me && th && th.x !== null && th.z !== null ? Math.hypot(me.x - th.x, me.z - th.z) : NaN, lc: (d as unknown as LDbg).life.chars.find((q) => q.slot === me?.slot) };
        };
        const d0 = at().d, x0 = at().me?.x ?? NaN, z0 = at().me?.z ?? NaN;
        let usedAt = -1, walkAt = -1, walkEnd = false, sleptOnWalk = 0, dMin = d0, moved = 0;
        for (let f = 0; f < 150 && usedAt < 0; f++) {
          await stepA(10);
          const a = at();
          dMin = Math.min(dMin, a.d); if (a.me) moved = Math.max(moved, Math.hypot(a.me.x - x0, a.me.z - z0));
          if (gd().counts.askedUse > u0) { usedAt = (f + 1) * 10; break; }
          const walking = a.lc?.beh === 4 && a.lc.phase >= 1;
          if (walkAt < 0 && walking) walkAt = (f + 1) * 10;
          else if (walkAt >= 0 && !walking) walkEnd = true;
          if (walkAt >= 0 && !walkEnd && a.me?.asleep) sleptOnWalk++;
        }
        rows.push({ where, thing: things[j].id, asked, usedAt, walkAt, sleptOnWalk, d0: +d0.toFixed(2), dMin: +dMin.toFixed(2), moved: +moved.toFixed(2), units: +gd().units.toFixed(2) });
        await stepA(180);
      }
      return rows;
    };
    const home = await trial('home');
    const okC = await host.travel('hearthlog');
    await stepA(120);
    const cabin = okC ? await trial('hearthlog') : [];
    const all = [...home, ...cabin];
    check('PLAYGROUND (round 6, VERDICT_PG2 N1; PLAY_WITH, SH-22) "Go play with..." on the MED tier with 3 out, at Home and in the cabin: for every thing asked of a squishy that is not the play squishy, it starts its walk within 8 s (or uses the thing), is never asleep on that walk (the over-budget rule sleeps another), and its walk takes it 0.3 m or more (or it uses the thing, or it was already within 0.8 m of it; a thing with no physics prop, the Snooze Rug, has no position to measure)',
      app.mat.count === 3 && okC && home.length >= 3 && cabin.length >= 3 && all.every((r) => r.asked === true && ((r.usedAt as number) > 0 || ((r.walkAt as number) > 0 && (r.walkAt as number) <= 480)) && r.sleptOnWalk === 0
        && ((r.usedAt as number) > 0 || (r.moved as number) >= 0.3 || (r.d0 as number) <= 0.8 || Number.isNaN(r.d0))), JSON.stringify(all));
    st.stats = stats0;
    await host.travel('home'); await stepA(60);
  }
  // round 6 (R6_SHELL 2): what the S2 places need from the host, on the REAL physics, through the dev path (they hold with or without the data flip that ships them).
  // (After every published row, so none of them starts from the state these trips leave: the N1 row above asks for uses in the cabin.)
  {
    type ZDbg = { zones: Array<[string, number, number]> | null; chars: Array<{ slot: number; itemId: string | null; x: number; z: number; looks: number[] }> };
    const zd = (): ZDbg => host.debug() as unknown as ZDbg;
    // (the host hands the bed ONE reused params object, zero allocation per frame: the weather is read at each call, not from the recorded reference)
    const wLog: number[] = [];
    const amb0 = audio.setAmbience as (...a: unknown[]) => unknown;
    audio.setAmbience = (...a: unknown[]) => { const o = a[0] as { weather?: number } | undefined; if (o && typeof o.weather === 'number') wLog.push(o.weather); return amb0(...a); };
    const weathers = (from: number): number[] => wLog.slice(from);
    // Ripple Shore: the Surf Edge's waves (physics' own clock, 7 to 10 s apart) are heard by the bed: one weather event per wave as it rises
    const a0 = wLog.length;
    const okR = await host.travel('ripple', true);
    let waveMax = 0;
    for (let i = 0; i < 24; i++) { await stepA(60); const z = zd().zones?.find((q) => q[0] === 'surfedge'); if (z) waveMax = Math.max(waveMax, z[2]); }
    const rW = weathers(a0);
    check('PLAYGROUND (round 6) Ripple Shore: each wave of the Surf Edge (physics, 7 to 10 s apart) reaches the bed as it rises (setAmbience weather 0.8): 24 s, at least 2 waves heard, the wave level read from the world',
      okR && rW.filter((v) => v === 0.8).length >= 2 && waveMax > 0.5, JSON.stringify({ okR, weathers: rW, waveMax }));
    // Frostbell Ridge: the Wind Gap's gusts follow LIFE's gust clock (world.setGust from lifeGustOn: the push, LIFE's HOLD_ON and the sound agree) and each gust's start
    // is heard (weather = its strength 0.6); the Shake Pine tapped (a still press on its trunk) shakes its branch: the snow puff falls on a squishy under it
    const a1 = wLog.length;
    const okF = await host.travel('frostbell', true);
    let gustMax = 0, gustOnSamples = 0;
    for (let i = 0; i < 30; i++) { await stepA(60); const z = zd().zones?.find((q) => q[0] === 'windgap'); if (z) { gustMax = Math.max(gustMax, z[2]); if (z[2] > 0.5) gustOnSamples++; } }
    const fW = weathers(a1);
    check('PLAYGROUND (round 6) Frostbell Ridge: the Wind Gap\'s gusts are driven from LIFE\'s gust clock (world.setGust: its level rises to 1 while one blows) and each gust\'s start is heard (setAmbience weather 0.6); 30 s: at least 2 gusts',
      okF && fW.filter((v) => v === 0.6).length >= 2 && gustMax > 0.9 && gustOnSamples >= 2, JSON.stringify({ okF, weathers: fW, gustMax, gustOnSamples }));
    const pineK = 6;   // (Frostbell's things: icepond, glideramp, steampool, iciclebells, snowdriftnest, snowball, shakepine)
    let branch = -1, seen = 0;
    if (bound.thing) for (let p = 0; p < bound.count; p++) if (bound.thing[p] === pineK && seen++ === 1) branch = p;
    // (the play body set 0.45 m in front of the branch's centre: inside the puff's reach, clear of the trunk and the branch; 1.5 s for any bump's puff and the
    // one-a-second limit to pass; then the snow of THAT body)
    let bx = NaN, bz = NaN;
    if (branch >= 0 && bound.poses) { bx = bound.poses[branch * 8]; bz = bound.poses[branch * 8 + 2] + 0.45; try { app.body.placeAt?.({ x: bx, y: app.body.center.y, z: bz }, { x: 0, y: 0, z: 0 }); } catch { /* none */ } }
    await stepA(90);
    const me = zd().chars.filter((c) => c.itemId === app.identity.itemId)[0];
    const rec0 = (host.debug() as { counts: { records: number } }).counts.records, fx0 = log.of('thingFx').filter((x) => x.args[0] === pineK && x.args[1] === 1).length;
    const snow0 = me?.looks?.[4] ?? 0;
    await tap(thingPt(pineK, 0));
    await stepA(10);
    const after = zd().chars.find((c) => c.slot === me?.slot), tapP = dbg().tap;
    const fx1 = log.of('thingFx').filter((x) => x.args[0] === pineK && x.args[1] === 1).length, rec1 = (host.debug() as { counts: { records: number } }).counts.records;
    check('PLAYGROUND (round 6) the Shake Pine (PLACES 4.4 "tap it: it shakes"): a still click on its trunk is a thing tap (one more record: USE SHAKE by PLAYER) that pokes its branch; the branch\'s strike drops the snow puff (its puff drawn) on the squishy under it (snow +0.5, the pine as its source)',
      branch >= 0 && tapP === 'shakepine' && rec1 > rec0 && fx1 > fx0 && (after?.looks?.[4] ?? 0) - snow0 >= 0.4, JSON.stringify({ branch, set: [+bx.toFixed(2), +bz.toFixed(2)], tap: tapP, records: [rec0, rec1], puff: [fx0, fx1], snow: [snow0, after?.looks?.[4] ?? null], at: after && [after.x, after.z] }));
    // Rainleaf Garden: the Rain's shower envelope (40 s on, 30 s off, from the arrival) is heard by the bed as it turns on (1) and off (0)
    const a2 = wLog.length;
    const okG = await host.travel('rainleaf', true);
    for (let i = 0; i < 44; i++) await stepA(60);
    const gW = weathers(a2);
    check('PLAYGROUND (round 6) Rainleaf Garden: the Rain\'s shower envelope reaches the bed: on at the arrival (setAmbience weather 1), off 40 s later (weather 0)',
      okG && gW[0] === 1 && gW.includes(0) && gW.indexOf(0) > 0, JSON.stringify({ okG, weathers: gW }));
    // (round 8, R8_SHELL; later-life.ts leafTap) the Drip Leaf's DRAWN leaf takes a tap: with a squishy set under it (G7), a still click on the middle of the big leaf
    // (render/places/rainleaf.ts: from the stalk's top toward the drip zone, tipped 0.32 rad down; it has no prop, the stalk is the thing's prop) tips the shower.
    // R7's final1b2 G7 tap went to the stalk's middle behind the squishy and never reached the leaf; a player taps the leaf (a click there was a miss before round 8)
    {
      const { PLACE: RL } = await import('../../src/data/place_rainleaf.ts');
      const dk = RL.things.findIndex((t) => t.id === 'dripleaf'), dzn = RL.zones.find((z) => z.id === 'leafdrip')!, s0 = RL.things[dk];
      app.body.placeAt?.({ x: dzn.x, y: app.body.center.y, z: dzn.z }, { x: 0, y: 0, z: 0 });
      await stepA(60);
      const ux = dzn.x - s0.x, uz = dzn.z - s0.z, dl = Math.hypot(ux, uz) || 1, half = 0.5 * (Math.max(0.3, dl) + 0.35);
      const lp = proj(s0.x + (ux / dl) * Math.cos(0.32) * half, 1.58 - Math.sin(0.32) * half, s0.z + (uz / dl) * Math.cos(0.32) * half);
      const zOn = (): number => ((dbg() as unknown as { zones: Array<[string, number]> }).zones.find((z) => z[0] === 'leafdrip')?.[1] ?? -1);
      const z0 = zOn();
      await tap(lp);
      const tapL = dbg().tap, z1 = zOn();
      check('PLAYGROUND (round 8) the Drip Leaf\'s drawn leaf takes a tap: with a squishy set under it, a still click on the middle of the big leaf (no prop of its own) tips the shower: a thing tap "dripleaf", its Leaf Drip zone on',
        okG && dk >= 0 && !!lp && z0 === 0 && tapL === 'dripleaf' && z1 === 1, JSON.stringify({ lp, z0, tap: tapL, z1, at: [+app.body.center.x.toFixed(2), +app.body.center.z.toFixed(2)] }));
    }
    // round 7 (R7_SHELL 2): Lanternroof and Cloudloft, the same way (the dev path, the REAL physics; with or without the data flip that ships them)
    type R7Dbg = { zones: Array<[string, number, number]> | null; tap: string; comet: boolean; selfUsed: string[]; selfReacted: string[]; counts: { records: number };
      vane: { turning: boolean; riders: number; poked: boolean } | null; chars: Array<{ slot: number; itemId: string | null; x: number; z: number }> };
    const r7 = (): R7Dbg => host.debug() as unknown as R7Dbg;
    const meSet = (x: number, y: number, z: number): void => { try { app.body.placeAt?.({ x, y, z }, { x: 0, y: 0, z: 0 }); } catch { /* none */ } };
    // Lanternroof: the Night Breeze's gusts on LIFE's clock reach the bed (weather 0.8) and the LOOK (thingFx(-1, 3, level): the lanterns sway, the streaks drift, the
    // Vane Disc turns); a squishy standing on the Vane Disc rides it round while a gust turns it (USE SPIN, by itself here)
    const a3 = wLog.length, fxW = log.of('thingFx').length;
    const okL = await host.travel('lanternroof', true);
    // (the Vane Disc has no prop: its spot from the wide layout, Lanternroof's things[1]; the play body set at rest on it)
    meSet(2.3, app.body.center.y, -0.7);
    let lvMax = 0, turned = 0;
    for (let i = 0; i < 26; i++) { await stepA(60); const z = r7().zones?.find((q) => q[0] === 'nightbreeze'); if (z) lvMax = Math.max(lvMax, z[2]); if (r7().vane?.turning) turned++; }
    const lW = weathers(a3), sent = log.of('thingFx').slice(fxW).filter((x) => x.args[0] === -1 && x.args[1] === 3).map((x) => x.args[2] as number);
    check('PLAYGROUND (round 7) Lanternroof: the Night Breeze\'s gusts on LIFE\'s clock are heard (setAmbience weather 0.8, at least 2 in 26 s) and drive the LOOK with physics\' gust level (stage.thingFx(-1, 3, level): up to 1 and back to 0, the lanterns\' sway and the streaks); the Vane Disc turns while one blows and the squishy standing on it rides it (a USE SPIN)',
      okL && lW.filter((v) => v === 0.8).length >= 2 && sent.length > 4 && Math.max(...sent) > 0.9 && sent.includes(0) && lvMax > 0.9 && turned > 0 && r7().selfUsed.includes('vanedisc'),
      JSON.stringify({ okL, weathers: lW, sentN: sent.length, sentMax: sent.length ? Math.max(...sent) : null, lvMax, turned, used: r7().selfUsed, vane: r7().vane }));
    // the Star Scope (things[5]): a still click is a thing tap: the comet (stage.thingFx(5, 1, 1)), a USE SWITCH by PLAYER and LIFE's GAZE_SKY for the squishy on
    // screen (two more records); a second tap while it flies is taken and adds nothing; the Chimney Corner (things[3]): a tap breathes deeper (thingFx(3, 1, 1))
    meSet(0.3, app.body.center.y, 0.6); await stepA(60);
    const sc0 = log.of('thingFx').filter((x) => x.args[0] === 5 && x.args[1] === 1).length, rc0 = r7().counts.records;
    await tap(thingPt(5));
    await stepA(10);
    const sc1 = log.of('thingFx').filter((x) => x.args[0] === 5 && x.args[1] === 1).length, rc1 = r7().counts.records, tap1 = r7().tap, comet1 = r7().comet;
    await tap(thingPt(5));
    await stepA(10);
    const sc2 = log.of('thingFx').filter((x) => x.args[0] === 5 && x.args[1] === 1).length;
    const ch0 = log.of('thingFx').filter((x) => x.args[0] === 3 && x.args[1] === 1).length;
    // (the chimney stands at x -2.6, at the edge of this rig's fixed Home camera: its right face, 0.22 m in from its centre, is in view)
    let chPt: { x: number; y: number } | null = null;
    if (bound.poses && bound.thing) for (let p = 0; p < bound.count; p++) if (bound.thing[p] === 3) { chPt = proj(bound.poses[p * 8] + 0.22, bound.poses[p * 8 + 1], bound.poses[p * 8 + 2]); break; }
    await tap(chPt);
    await stepA(10);
    const ch1 = log.of('thingFx').filter((x) => x.args[0] === 3 && x.args[1] === 1).length, tapC = r7().tap;
    check('PLAYGROUND (round 7) Lanternroof\'s taps: the Star Scope sends the comet (thingFx(5, 1, 1)) with a USE SWITCH by PLAYER and LIFE\'s GAZE_SKY (2 or more records), one comet at a time (a tap while it flies adds nothing); the Chimney Corner breathes deeper (thingFx(3, 1, 1))',
      tap1 === 'starscope' && comet1 && sc1 === sc0 + 1 && rc1 - rc0 >= 2 && sc2 === sc1 && tapC === 'chimneycorner' && ch1 === ch0 + 1,
      JSON.stringify({ tap1, comet1, comet: [sc0, sc1, sc2], records: [rc0, rc1], tapC, chimney: [ch0, ch1] }));
    // (round 7) a squishy set down on top of the Chimney Corner (a block 1.4 m tall, wide layout (-2.6, 0.6)) hops down beside it, toward the middle (the host's
    // perchDown after 1.5 s: up there it stood above the place camera's frame on a phone, s3run2)
    meSet(-2.6, 2.0, 0.6);
    for (let i = 0; i < 5; i++) await stepA(60);
    const pY = app.body.center.y, pX = app.body.center.x, pD = Math.hypot(pX + 2.6, app.body.center.z - 0.6);
    check('PLAYGROUND (round 7) Lanternroof: a squishy set on top of the Chimney Corner (1.4 m) hops down beside it, toward the middle, within 5 s (the host\'s perchDown)',
      okL && pY < 0.9 && pD > 0.5 && pX > -2.6, JSON.stringify({ y: +pY.toFixed(3), x: +pX.toFixed(3), d: +pD.toFixed(3) }));
    // Cloudloft: the Breeze's gusts are heard (weather 0.4); a squishy dropped onto a Puff Pad bounces (a USE BOUNCE by itself); one let go 1.3 m up in the Updraft
    // floats down (LIFE's LIFT, its thing the Updraft)
    const a4 = wLog.length;
    const okU = await host.travel('cloudloft', true);
    await stepA(60);
    meSet(2.61, 1.0, -0.52);   // (over the first Puff Pad, the wide layout's things[0] spot)
    for (let i = 0; i < 4; i++) await stepA(60);
    meSet(2.2, 1.3, -0.8);     // (in the Updraft's column, its centre)
    for (let i = 0; i < 22; i++) await stepA(60);
    const uW = weathers(a4);
    check('PLAYGROUND (round 7) Cloudloft: the Breeze\'s gusts are heard (setAmbience weather 0.4, at least 1 in 26 s); a squishy dropped onto a Puff Pad bounces (USE BOUNCE by itself) and one let go 1.3 m up in the Updraft floats down (LIFE\'s LIFT naming the Updraft)',
      okU && uW.filter((v) => v === 0.4).length >= 1 && r7().selfUsed.includes('puffpads') && r7().selfReacted.includes('updraft'),
      JSON.stringify({ okU, weathers: uW, used: r7().selfUsed, reacted: r7().selfReacted }));
    // (round 8, R8_SHELL 3) a squishy set on top of the Sunbow Arch (a STATIC bar: its top bar 1.3 m up, wide layout (-1.75, -1.95)) is set down on the floor beside it,
    // toward the middle, within 5 s: perchDown now covers every static bar's top (round 7's covered blocks only; R7_SHELL's list: one left up there stayed above the frame)
    meSet(-1.75, 2.0, -1.95);
    let onArch = 0;
    for (let i = 0; i < 30; i++) { await stepA(10); if (app.body.center.y > 1.3 && (app.body.metrics.onProp ?? -1) >= 0) onArch++; }
    const aY = app.body.center.y, aX = app.body.center.x, aZ = app.body.center.z;
    check('PLAYGROUND (round 8) Cloudloft: a squishy set on top of the Sunbow Arch (its top bar 1.3 m up) rests on it, then is set down on the floor beside it, toward the middle, within 5 s (perchDown covers static bars)',
      okU && onArch >= 3 && aY < 0.9 && Math.hypot(aX + 1.75, aZ + 1.95) > 0.3 && aZ > -1.95, JSON.stringify({ onArch, y: +aY.toFixed(3), x: +aX.toFixed(3), z: +aZ.toFixed(3) }));
    // (round 8, R8_SHELL 3) in a place a CARRIED squishy moves over the ground (later-life.ts carryPoint): lifted by a pull from its upper part, then a drag straight up
    // the frame (120 px) takes it BACK, at about the height it was picked up at. Round 7's carries to things at the back ran out of frame (the camera-facing plane: a
    // drag up lifted more than it took back). At Home the same drag keeps the published plane (below, after the trip home): it rises more than it goes back.
    const carryUp = async (): Promise<Record<string, number | boolean>> => {
      meSet(0, app.body.center.y, 0.6);
      for (let i = 0; i < 3; i++) await stepA(60);
      const d0 = app.host.bodyScreen();
      if (!d0) return { carried: false, dz: 0, dy: 0 };
      const x0 = d0.x, y0 = d0.y - 0.55 * d0.r;
      app.input.pointerDown({ id: 31, x: x0, y: y0, type: 'touch' });
      step(6);
      let k = 0, carried = false;
      for (; k < 48 && !carried; k++) { app.input.pointerMove({ id: 31, x: x0, y: y0 - 6 * (k + 1), type: 'touch' }); step(2); carried = app.body.metrics.carried === true; }
      step(20);
      const ya = app.body.center.y, za = app.body.center.z, yp = y0 - 6 * k;
      for (let j = 1; j <= 20; j++) { app.input.pointerMove({ id: 31, x: x0, y: yp - 6 * j, type: 'touch' }); step(2); }
      step(40);
      const held = app.body.metrics.carried === true, yb = app.body.center.y, zb = app.body.center.z;
      app.input.pointerUp({ id: 31, x: x0, y: yp - 120, type: 'touch' });
      for (let i = 0; i < 3; i++) await stepA(60);
      return { carried, held, liftPx: 6 * k, dz: +(za - zb).toFixed(3), dy: +(yb - ya).toFixed(3) };
    };
    const cuP = await carryUp();
    check('PLAYGROUND (round 8) Cloudloft: a squishy carried in a place moves over the ground: picked up by a pull, a drag straight up the frame (120 px) takes it back 0.8 m or more at about the height it was picked up at (within 0.25 m)',
      okU && cuP.carried === true && cuP.held === true && (cuP.dz as number) >= 0.8 && Math.abs(cuP.dy as number) <= 0.25, JSON.stringify(cuP));
    audio.setAmbience = amb0;
    await host.travel('home'); await stepA(60);
    // (round 8) ... and at Home the published carry is unchanged: the same pick-up and drag up the frame lifts the squishy more than it takes it back (camera-facing plane)
    const cuH = await carryUp();
    check('PLAYGROUND (round 8) Home keeps the published carry: the same pick-up and 120 px drag up the frame lifts the squishy more than it takes it back (the camera-facing plane through the press)',
      cuH.carried === true && (cuH.dy as number) > 0.15 && (cuH.dy as number) > (cuH.dz as number), JSON.stringify(cuH));
  }
  app.dispose();
  // round 6 (D-96, the brief's rule "a save that already holds a stamp, wish or fact of a dropped place must still load without error"): the HOST on such a save
  // (probe_journal CO-13's blob: Fizzwell Tub 5, Cogwhistle Bench 6 and Echo Hollow 8 in its places, visits, keepsakes, song places, a wish for 5, a gift row,
  // the current place 8, done tombstones T1 / W3 / E10): it attaches, nothing of the three reaches its view, no open line names them, no trip goes there
  {
    const { journalDefs, createJournal } = await import('../../src/collection/journal.ts');
    const { JOURNAL_KEY } = await import('../../src/collection/constants.ts');
    const { QUESTS } = await import('../../src/data/quests.ts');
    const { CATALOG } = await import('../../src/data/catalog.ts');
    const { WISH_KIND } = await import('../../src/data/life.ts');
    const qIdx = (id: string): number => QUESTS.findIndex((q) => q.id === id), spI = (id: string): number => CATALOG.findIndex((c) => c.id === id);
    const st0 = createJournal(journalDefs(), 'dev-r6').st;
    for (const id of ['H1', 'C1', 'R1', 'T1', 'W3', 'E10']) { const q = qIdx(id); if (q >= 0) st0.done[q >>> 5] |= 1 << (q & 31); }
    const qd = Buffer.from(new Uint8Array(new Uint32Array(Array.from(st0.done)).buffer)).toString('base64');
    const blob = { v: 1, dev: 'dev-r6', bf: 1, st: 6, qd, qp: [[qIdx('T1') + 1, 0, 1], [qIdx('E2'), 0, 1, [3, 4]]], fx: [[0, 3]], fr: [], ids: [], real: [], wm: [], wday: 20407,
      ks: (1 << 0) | (1 << 1) | (1 << 5) | (1 << 6) | (1 << 8), pl: 1 | 2 | 4 | (1 << 5) | (1 << 6) | (1 << 8), pv: [3, 2, 1, 0, 0, 4, 5, 0, 6, 0],
      wi: [[spI('plumpet'), WISH_KIND.PLACE, 5, 20407], [spI('dollop'), WISH_KIND.PLACE, 2, 20407]],
      gift: [[5, 1, spI('plumpet'), 20407]], gday: -1, fw: [2, 0], sg: 1 | 2 | (1 << 5) | (1 << 8), wg: 1, cur: { p: 8, party: [] }, day: 20407 };
    const mem2 = memoryStorage({ [JOURNAL_KEY]: JSON.stringify(blob) });
    const errs0 = errors.length;
    const profile2 = createProfileStore(mem2);
    const coll2 = createCollection({ storage: mem2, profile: profile2.profile, now: () => 1_700_000_000_000 + clockT, random: () => 0.4 });
    const app2 = createApp({
      createBody: (g) => new SoftBody(g), createStage: () => st as unknown as StageLike, createAudio: () => audio as unknown as ReturnType<typeof createMockAudio>, haptics: createMockHaptics(),
      storage: mem2, collection: coll2, profile: profile2, devSkew: { ms: 0 }, env: { vibrate: false, reducedMotion: false }, now: () => clockT, epochNow: () => 1_700_000_000_000 + clockT, raf: () => 0, caf: () => {},
    });
    app2.resize(W, H, 1); app2.setPhase('play');
    const said2: string[] = [];
    let threw = '', host2: ReturnType<typeof attachLifeHost> | null = null;
    try { host2 = attachLifeHost(app2, { parts: lifeParts, storage: mem2, say: (t) => said2.push(t), moment: (t) => said2.push('MOMENT ' + t), setTimer: () => 0, clearTimer: () => {} }); } catch (e) { threw = String(e); }
    for (let i = 0; i < 120; i++) { clockT += 1000 / 60; app2.clock.advance?.(1000 / 60); app2.stepOnce(1 / 60); if (i % 10 === 9) await tick(); }
    await new Promise((r) => setTimeout(r, 1700));   // (the load-time open lines wait 1.5 s for the play UI)
    const drop = (1 << 5) | (1 << 6) | (1 << 8);
    const open2 = host2?.openPlaces?.() ?? -1, j2 = host2?.journal?.() ?? null;
    const tripRefused = host2 ? (await host2.travel('fizzwell', true)) === false && (await host2.travel('echohollow', true)) === false : false;
    const named = said2.filter((t) => /Fizzwell|Cogwhistle|Echo Hollow/.test(t));
    const d2 = host2?.debug() as { place?: number } | undefined;
    check('PLAYGROUND (round 6, D-96) a save naming Fizzwell Tub, Cogwhistle Bench and Echo Hollow (its places, visits, keepsakes, song places, a wish, a gift row, the current place, done tombstones) loads in the host without an error: none of the three in its open places or the journal\'s view, no line names them, a trip there is refused, the party at Home',
      !!host2 && !threw && open2 >= 0 && (open2 & drop) === 0 && !!j2 && (j2.places & drop) === 0 && (j2.keepsakes & drop) === 0 && named.length === 0 && tripRefused && d2?.place === 0 && errors.length === errs0,
      JSON.stringify({ threw, open: open2, places: j2?.places, keepsakes: j2?.keepsakes, stamps: j2?.stamps, said: said2.slice(0, 4), named, tripRefused, place: d2?.place, errors: errors.slice(errs0).map((e) => String(e[0])).slice(0, 2) }));
    try { host2?.dispose(); } catch { /* gone */ }
    app2.dispose();
  }
}

console.error = realError;
check('no console.error from the shell during these checks', errors.length === 0, errors.slice(0, 2).map((e) => String(e[0])).join(' | '));
console.log(`\n${total - bad}/${total} shell-core node checks passed`);
process.exit(bad ? 1 : 0);
