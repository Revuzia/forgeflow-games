// SHELL-2a node checks (plain node, exits 1 on failure; browser_shell.mjs runs it as its 'node-core' section).
// The game core (src/shell/**) driven with the recording mocks of _harness/mocks.ts plus a FAKE round-2 stage and audio that follow the
// render handover's protocol (beats in time order, done, skip, resultBody) closely enough to check the shell's side of it:
//   fatal-frame path, context-loss suspend, atomic body swap, resultBody adoption, the ceremony beat -> sound map, the 350 ms skip gate,
//   input lock during ceremonies, settings resolution + migration + calm, the press-driven squelch, the capsule table, the meter mapping,
//   keyboard focus rules, audio disposal on a failed boot, and the body CALIBRATION measured on the REAL SoftBody.
import type { CapsuleHandle, CapsuleRevealSpec, CeremonyBeat, CeremonyHandle, CeremonyHooks, MergeCeremonySpec, SoftBodyLike, SoftEvent, StageLike, TierName } from '../../src/contracts.ts';
import { createApp } from '../../src/app.ts';
import type { App } from '../../src/app.ts';
import { makeStarterGenome, encodeGenome } from '../../src/core/genome.ts';
import type { Genome } from '../../src/core/genome.ts';
import { SETTINGS_KEY, defaultSettings, loadSettings, memoryStorage, resolveSettings, saveSettings } from '../../src/core/settings.ts';
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
  const { createCutter, PIECE_MIN, JOIN_ALL_S, JOIN_HOLD_S, JOIN_S, NECK_DEFAULT_S, NECK_HOLD_S, HOME_MAX_S, SETTLE_S } = await import('../../src/shell/cut.ts');
  const { createBodyManager } = await import('../../src/shell/bodies.ts');
  const { createMockBody } = await import('../mocks.ts');
  type V = { x: number; y: number; z: number };
  type CutMock = ReturnType<typeof createMockBody> & { frac: number; piece: { frac: number; chunk: boolean; cutNormal?: V; at?: V } | null; necks: number; lastNeck: number; trembles: number[]; fracCalls: Array<[number, number]>; moved: number; whole: boolean; held: boolean };
  /** a mock body that can be cut: a sphere of radius 0.5 cbrt(frac) at its centre; measureCut is the exact sphere-cap share */
  const cutBody = (g: Genome, o: { at?: V; piece?: { frac: number; chunk: boolean; cutNormal?: V; at?: V } } = {}): CutMock => {
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
    m.setFrac = (f: number, sec: number) => { b.fracCalls.push([f, sec]); b.frac = Math.min(1, Math.max(PIECE_MIN, f)); };
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

  // X01: a centre cut (Split in two) makes two pieces whose shares sum to 1; the face piece is the play body, the other an eyeless chunk
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
    check('X03 shell: the face piece is the PLAY body (same identity, no chunk), the other piece is an eyeless chunk on the mat (AddBodyOpts.chunk); partPieces(a, b) once',
      play !== playBefore && play.piece?.chunk === false && xs.length === 1 && xs[0].piece === true && (xs[0].body as CutMock).piece?.chunk === true && r.chunks.at(-1) === true && r.parts.length === 1 && r.app.identity.itemId === idBefore.itemId && r.app.identity.genome === idBefore.genome,
      JSON.stringify({ chunks: r.chunks, parts: r.parts, extras: xs.length }));
    check('CUT audio: cut({ start }) and cut({ separate }) carry the smaller piece\'s share of the WHOLE, the family and calm; no strand() for the parting (NOTES_FOR_SHELL_CUT)',
      Math.abs((seps[0][1].frac as number) - Math.min(...fr)) < 1e-9 && typeof starts[0][1].family === 'string' && typeof starts[0][1].neckS === 'number' && starts[0][1].calm === false && !r.audioCalls.some((c) => c[0] === 'strand'));
    check('CUT: the cut says it in the live region ("Cut into 2 pieces."), a haptic tick, and the Hoard, the mat and the history do not see a piece',
      notices.includes('Cut into 2 pieces.') && r.w.haptics.rec.count('poke') >= 1 && r.app.hoard.items().length === items0 && r.app.mat.count === 1 && r.app.history.current === null,
      JSON.stringify({ notices, items: r.app.hoard.items().length, mat: r.app.mat.count }));
    // X06: cutting paid nothing; a poke (a tap) on the chunk pays nothing, like a tap on a whole squishy; a squeeze held 1.2 s and released on it pays through collection.feed like one on a whole squishy
    // RE-SPECIFIED (owner decision 2026-10-06, "short taps pay nothing"): this row used a poke and asserted it paid ("sp > 0"); a tap pays 0 now, so the row proves the chunk's feed path with a held
    // squeeze instead and adds that its poke pays 0 (same intent: the chunk's touches reach the meter exactly like the whole squishy's).
    const fill0 = r.app.hoard.meter().sp;
    const chunk = xs[0].body as CutMock;
    chunk.queue({ kind: 'poke', intensity: 0.5 });
    run2(r.w, r.app, 50);
    const afterPoke = r.app.hoard.meter().sp;
    chunk.queue({ kind: 'release', intensity: 0.5, heldFor: 1.2 });
    run2(r.w, r.app, 50);
    check('X06 shell: cutting fed the meter nothing; a poke (a tap) on a chunk pays nothing and a squeeze held 1.2 s on it pays through collection.feed, both like on a whole squishy', fill0 === 0 && afterPoke === 0 && r.app.hoard.meter().sp > 0, `sp before ${fill0}, after the poke ${afterPoke}, after the squeeze ${r.app.hoard.meter().sp}`);
    // the stopgap for checkpoint 47's self-launching chunks: a new chunk is held at its spot (moveTo) and let go after SETTLE_S
    const heldNow = chunk.held, facePiece = r.app.body as unknown as CutMock;
    run2(r.w, r.app, (SETTLE_S + 0.1) * 1000);
    check('CUT: a new chunk is held at its spot (moveTo, a little apart from its twin) and let go after SETTLE_S; the face piece is not held',
      heldNow && chunk.moved >= 1 && !chunk.held && !facePiece.held, `held ${heldNow} -> ${chunk.held}, face held ${facePiece.held}`);
    // the touch-to-join: a finger on the chunk held against the face piece for JOIN_HOLD_S joins them (a bridge, setFrac up / down, rejoin)
    const C = chunk.center as V, F = play.center as V;
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
    const notices: string[] = [];
    const body0 = W.w.deps.createBody(g0);
    const bm = createBodyManager({ createBody: W.w.deps.createBody, stage: st, initial: { body: body0, identity: { genome: g0, tier: 'common', itemId: 'it-1', nickname: null } }, beforeSwap() {}, afterSwap() {}, report: (e) => { throw e; } });
    const ct = createCutter({
      bodies: bm, stage: st, audio: W.w.audio, haptics: W.w.haptics, createBody: W.w.deps.createBody, quality: () => 'low', calm: () => false, gravity: () => true,
      simTime: () => t, viewport: () => ({ w: 800, h: 600 }), activeBody: () => active ?? bm.body, touching: () => touching, beforeChange() {}, clearMat: () => { const n = matOut; matOut = 0; return n; },
      panOf: () => 0, say: (s2) => notices.push(s2), report: (e) => { throw e; },
    });
    const step = (sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) { t += 1 / 60; ct.update(1 / 60); } };
    // X02: an edge cut that would leave under 1/8 is refused (a wobble, a line), nothing changes
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
    check('X02 shell: a cut that would leave a piece under 1/8 of the whole is refused ("Too small to cut there..."), with a wobble; nothing is replaced and the mat is not touched',
      fEdge < PIECE_MIN && rEdge === 'small' && ct.pieces === 1 && b0.trembles.length === 1 && notices.some((n) => /Too small/.test(n)) && matOut === 2, `${rEdge}; share ${fEdge.toFixed(3)}; ${notices.join(' | ')}`);
    step(0.4);
    check('CUT: the refusal wobble ends by itself (tremble back to 0)', b0.trembles.at(-1) === 0, b0.trembles.join());
    // a short swipe and a miss
    check('CUT: a swipe shorter than 24 px is not a cut; a swipe beside the squishy misses', ct.swipe(400, 300, 410, 300) === 'short' && ct.swipe(20, 20, 20, 120) === 'miss');
    // cut down to the low-quality limit of 4 pieces: each Split in two cuts the largest piece; the 5th is refused
    const res: string[] = [];
    for (let i = 0; i < 4; i++) { res.push(ct.splitInTwo()); step(NECK_DEFAULT_S + NECK_HOLD_S + 0.05); }
    check('X02 shell (limits): at low quality the squishy makes at most 4 pieces; the next cut is refused ("That\'s as many pieces as it can make."); the first cut put the mat squishies back',
      res.slice(0, 3).join() === 'cut,cut,cut' && res[3] === 'limit' && ct.pieces === 4 && notices.some((n) => /as many pieces/.test(n)) && matOut === 0 && notices.some((n) => /went back on the shelf/.test(n)), `${res.join()} pieces ${ct.pieces} ${ct.fracs().map((f) => f.toFixed(3)).join('+')}`);
    const sum = ct.fracs().reduce((a2, b2) => a2 + b2, 0);
    check('X01 shell: after three cuts the shares still sum to exactly 1, every piece at least 1/8, one face piece (the play body) and three chunks',
      Math.abs(sum - 1) < 1e-9 && ct.fracs().every((f) => f >= PIECE_MIN - 1e-9) && bm.extras.filter((x) => x.piece).length === 3 && (bm.body as CutMock).piece?.chunk === false, `sum ${sum}`);
    // X03: the face goes with the side holding the eyes' anchor (the body's front, +z): a cut across z puts the face on the front piece
    // the touch-to-join: a finger on a chunk held against the face piece for JOIN_HOLD_S starts the join; the bridge rises; rejoin at the end
    const face = bm.body as CutMock, chunk = bm.extras.find((x) => x.piece)!.body as CutMock;
    (chunk.center as V).x = (face.center as V).x + 0.55; (chunk.center as V).y = (face.center as V).y; (chunk.center as V).z = (face.center as V).z;
    active = chunk; touching = true;
    const contactsBefore = bm.contactBodies;
    step(JOIN_HOLD_S * 0.5);
    const early = ct.busy;
    step(JOIN_HOLD_S * 0.6);
    const joining = ct.busy;
    const contactsJoining = bm.contactBodies;
    touching = false;
    step(JOIN_S + 0.05);
    const rj = W.audioCalls.filter((c) => c[0] === 'rejoin');
    check('CUT reconnect: the piece flowing in is a ghost (out of body-to-body contact, so it cannot shove the receiver away); the rest still collide',
      contactsBefore === 4 && contactsJoining === 3 && bm.contactBodies === 3, `contacts ${contactsBefore} -> ${contactsJoining} -> ${bm.contactBodies}`);
    check('CUT reconnect: a chunk held against the face piece for 0.4 s flows in (bridge, setFrac up on the face piece and down on the chunk, moveTo); then 3 pieces, rejoin({ frac: the merged share })',
      !early && joining && ct.pieces === 3 && W.bridges.some((b2) => b2[2] > 0.5) && face.fracCalls.length >= 1 && chunk.fracCalls.length >= 1 && chunk.moved > 0 && rj.length === 1 && Math.abs((rj[0][1].frac as number) - ct.fracs()[0]) < 1e-9,
      `pieces ${ct.pieces}, rejoin ${JSON.stringify(rj.map((c) => c[1].frac))}, fracs ${ct.fracs().map((f) => f.toFixed(3)).join('+')}`);
    // let go while touching: joins at once (no 0.4 s wait)
    const c2 = bm.extras.find((x) => x.piece)!.body as CutMock;
    (c2.center as V).x = (bm.body.center as V).x - 0.5; (c2.center as V).y = (bm.body.center as V).y; (c2.center as V).z = (bm.body.center as V).z;
    active = c2; touching = true; step(0.1); touching = false; step(1 / 60);
    const letGo = ct.busy;
    step(JOIN_S + 0.05);
    check('CUT reconnect: letting go of a piece while it touches another joins them at once', letGo && ct.pieces === 2, `pieces ${ct.pieces}`);
    // X04: Reconnect all flows every piece into the face piece over 1.2 s; the result is a fresh WHOLE body of the same genome
    const before = bm.body;
    const okAll = ct.reconnectAll(true);
    step(JOIN_ALL_S * 0.5);
    const mid = ct.busy && ct.pieces === 2;
    step(JOIN_ALL_S * 0.5 + 0.05);
    const all = W.audioCalls.filter((c) => c[0] === 'rejoin' && c[1].all === true);
    // the face piece ended up off the middle (the mock's pieces sit at their lobes): it glides home first, then the swap happens there
    const gliding = ct.busy && (ct.pieces as number) === 1 && bm.extras.length === 0 && bm.body === before;
    const offBy = Math.hypot((bm.body.center as V).x, (bm.body.center as V).z);
    step(HOME_MAX_S + 0.05);
    const fresh = bm.body as CutMock;
    check('X04 shell: Reconnect all (1.2 s) ends whole: one body, a FRESH whole body of the same genome (no piece options), frac 1; rejoin({ frac: 1, all: true }) once; "Whole again."',
      okAll && mid && (ct.pieces as number) === 1 && fresh !== before && fresh.piece === null && fresh.frac === 1 && bm.identity.genome === g0 && bm.extras.length === 0 && all.length === 1 && all[0][1].frac === 1 && notices.at(-1) === 'Whole again.',
      `pieces ${ct.pieces}, extras ${bm.extras.length}, notices ${notices.slice(-2).join(' | ')}`);
    check('CUT: whole again at the MIDDLE of the table: an off-centre face piece glides home (moveTo, busy, still the same body) before the swap; the whole body is built without `at`',
      gliding && offBy > 0.06 && !ct.busy && Math.hypot((fresh.center as V).x, (fresh.center as V).z) < 1e-9 && fresh.piece === null,
      `gliding ${gliding}, off ${offBy.toFixed(3)}, busy ${ct.busy}`);
    check('CUT: nothing to reconnect when whole (reconnectAll answers false)', ct.reconnectAll(true) === false && !ct.busy);
    // X03: the face goes with the side that holds the eyes' anchor (the front, a little above the middle): a level swipe above the eyes
    // makes the TOP a chunk and the bottom the face piece; a swipe right of the middle keeps the face on the (left) side holding the anchor
    const cw = { ...(bm.body.center as V) };
    const hi1 = proj({ x: cw.x - 0.6, y: cw.y + 0.22, z: cw.z }), hi2 = proj({ x: cw.x + 0.6, y: cw.y + 0.22, z: cw.z });
    const rTop = ct.swipe(hi1.x, hi1.y, hi2.x, hi2.y);
    step(NECK_DEFAULT_S + NECK_HOLD_S + 0.05);
    const faceT = bm.body as CutMock, chunkT = bm.extras.find((x) => x.piece)?.body as CutMock | undefined;
    const topOk = rTop === 'cut' && !!chunkT && faceT.piece?.chunk === false && chunkT.piece?.chunk === true && (faceT.piece?.at?.y ?? 9) < (chunkT.piece?.at?.y ?? -9);
    ct.reconnectAll(false);
    const cr = { ...(bm.body.center as V) };
    const r1 = proj({ x: cr.x + 0.16, y: cr.y + 0.45, z: cr.z }), r2 = proj({ x: cr.x + 0.16, y: cr.y - 0.45, z: cr.z });
    const dbg = { c: cr, frac: (bm.body as CutMock).frac };
    const rRight = ct.swipe(r1.x, r1.y, r2.x, r2.y);
    step(NECK_DEFAULT_S + NECK_HOLD_S + 0.05);
    const faceR = bm.body as CutMock, chunkR = bm.extras.find((x) => x.piece)?.body as CutMock | undefined;
    const rightOk = rRight === 'cut' && !!chunkR && faceR.piece?.chunk === false && (faceR.piece?.at?.x ?? 9) < (chunkR.piece?.at?.x ?? -9) && (faceR.piece?.frac ?? 0) > (chunkR.piece?.frac ?? 1);
    check('X03 shell: the face piece is the side holding the eyes\' anchor: a level cut above the eyes makes the top a chunk; a cut right of the middle keeps the face on the left (larger) side',
      topOk && rightOk, JSON.stringify({ rTop, faceAtY: faceT.piece?.at?.y, chunkAtY: chunkT?.piece?.at?.y, rRight, faceX: faceR.piece?.at?.x, chunkX: chunkR?.piece?.at?.x, dbg, notice: notices.at(-1) }));
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
      r.app.hoard.items().length === items.length && stored.length > 0 && !/piece|chunk|frac/i.test(stored), `items ${items.length} -> ${r.app.hoard.items().length}; ${stored.length} chars stored`);
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
  check('migration: the first save writes v: 2 with the chosen round-2 field only', s1.v === 2 && s1.calm === false && !('music' in s1) && s1.volume === 0.3);
  const v3 = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ v: 3, volume: 0.5, futureThing: { a: 1 } }) });
  const l3 = loadSettings(v3, env);
  saveSettings(v3, { ...l3, music: 0.2 });
  const s3 = JSON.parse(v3.getItem(SETTINGS_KEY)!);
  check('a blob from a NEWER build (v: 3): known fields read, its unknown keys and version survive our save', l3.volume === 0.5 && s3.v === 3 && s3.futureThing?.a === 1 && s3.music === 0.2);
  const r = rig({ env, storage: memoryStorage() });
  check('boot under reduced motion: Calm on (stage.setCalmEffects(true)), shake scale 0, music bed on at 0.45 via setMusic',
    r.fake.log.of('setCalmEffects').at(-1)?.args[0] === true && r.w.stage.rec.of('setShakeScale').at(-1)!.args[0] === 0 && JSON.stringify(r.fake.log.of('setMusic').at(-1)?.args[0]) === '{"on":true,"volume":0.45}');
  r.app.setSetting('music', 0);
  check('music 0 = off: setMusic({ on: false, volume: 0 })', JSON.stringify(r.fake.log.of('setMusic').at(-1)?.args[0]) === '{"on":false,"volume":0}');
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
  const { createCutter, SETTLE_GAP, SETTLE_S, supportAlong, JOIN_ALL_S, BRIDGE_HOLD_S } = await import('../../src/shell/cut.ts');
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
  check('X01 real physics (node, through the whole game): Split in two necks (the real setNeck), then two real pieces whose shares sum to 1 (0.5 %); the face piece is the PLAY body (a new SoftBody built as a piece, same identity), the other an eyeless chunk on the mat (AddBodyOpts.chunk)',
    r1 === 'cut' && necking && f2.length === 2 && Math.abs(f2[0] + f2[1] - 1) < 0.005 && face !== whole0 && Math.abs((frameFace ?? 0) - f2[0]) < 1e-6 && xs.length === 1 && chunkFlags.at(-1) === true && app.identity.itemId === id0.itemId && app.identity.genome === id0.genome,
    `${r1}; fracs ${f2.map((f) => f.toFixed(3)).join(' + ')}; neck ${necking}; extras ${xs.length}`);
  // the parting gap: a chunk is steered to SETTLE_GAP of room from its twin (the strands need it) and let go after SETTLE_S
  const gapOf = (): number => { const a = app.body, b = xs[0].body; const dx = a.center.x - b.center.x, dy = a.center.y - b.center.y, dz = a.center.z - b.center.z, d = Math.hypot(dx, dy, dz), u = { x: dx / d, y: dy / d, z: dz / d }; return d - supportAlong(b, u) - supportAlong(a, { x: -u.x, y: -u.y, z: -u.z }); };
  go(0.5 * 1000);
  const gapHeld = gapOf();
  go(SETTLE_S * 1000);
  check(`parting gap: the new chunk is steered to a surface gap of ${SETTLE_GAP} m from its twin (strands need room: it was 0 .. 0.03 m with a fixed 0.06 m offset from the lobes); measured ${gapHeld.toFixed(3)} m 0.5 s after the cut, then it is let go after SETTLE_S`,
    Math.abs(gapHeld - SETTLE_GAP) < 0.04 && !(xs[0].body as unknown as { moveOn?: boolean }).moveOn, `gap ${gapHeld.toFixed(3)} m, still steered after SETTLE_S: ${(xs[0].body as unknown as { moveOn?: boolean }).moveOn}`);
  check('X06 real physics: cutting paid the meter nothing and the Hoard saw no piece', app.hoard.meter().sp === fill0 && app.hoard.items().length === items0 && app.mat.count === 1, `sp ${fill0} -> ${app.hoard.meter().sp}`);
  // more cuts, then the refusal numbers on the real physics (a cut that would leave a piece under 1/8 is refused: the whole's edge)
  const r2 = app.cut.splitInTwo(); settleIdle(); go(500);
  const f3 = app.cut.fracs();
  check('X01 real physics: a second Split in two (the biggest piece) makes 3 pieces, shares sum to 1, none under 1/8', r2 === 'cut' && f3.length === 3 && Math.abs(f3.reduce((s, f) => s + f, 0) - 1) < 0.005 && f3.every((f) => f >= 0.125 - 1e-6), `${r2}; ${f3.map((f) => f.toFixed(3)).join(' + ')}`);
  // Reconnect all: the bridge is held in view (the chunks' skins stay apart BRIDGE_HOLD_S), every chunk flows into the face piece, a FRESH whole body of the same genome replaces it
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
  check(`Reconnect all keeps the glowing bridge in view: the skins of some chunk stay more than 2 % of the radius apart for ${apart.toFixed(2)} s (>= BRIDGE_HOLD_S ${BRIDGE_HOLD_S} s; it was 0.02 s when the pieces were already overlapping at the start of the join)`, apart >= BRIDGE_HOLD_S - 0.02, `${apart.toFixed(2)} s of ${gaps.length / 60} s`);
  // leaving reconnects, on the real physics: a switch to another genome while cut
  app.cut.splitInTwo(); settleIdle(); go(300);
  const cutAgain = app.cut.pieces;
  app.setGenome(speciesBaseGenome('twangle', 1));
  check('X05 real physics: a switch of squishy while cut reconnects first (the new squishy is whole, nothing left on the mat, the Hoard unchanged)', cutAgain === 2 && app.cut.pieces === 1 && app.bodies.extras.length === 0 && app.hoard.items().length === items0, `pieces ${cutAgain} -> ${app.cut.pieces}`);
  app.dispose();
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

console.error = realError;
check('no console.error from the shell during these checks', errors.length === 0, errors.slice(0, 2).map((e) => String(e[0])).join(' | '));
console.log(`\n${total - bad}/${total} shell-core node checks passed`);
process.exit(bad ? 1 : 0);
