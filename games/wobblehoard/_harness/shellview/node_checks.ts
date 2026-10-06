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

/* ───────────────────────── 8. the collection module through the port: meter feed, events, table cap ───────────────────────── */
{
  const r = rig();
  const notices: string[] = [];
  r.app.on('notice', (t) => notices.push(t));
  const c = r.app.input.screenCentre()!;
  for (let i = 0; i < 3; i++) { r.app.input.pointerDown({ id: 40 + i, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 60); r.app.input.pointerUp({ id: 40 + i, x: c.x, y: c.y, t: r.w.clock.t }); run(r, 1200); }
  check('feed: real pokes through the frame loop move the collection\'s practice meter (collection.feed with the drained SoftEvents)', r.app.collection.meter().fill > 0, JSON.stringify(r.app.collection.meter()));
  r.app.debug.shell.grant(WH_QUEUE_MAX + 2);
  const m = r.app.collection.meter();
  check(`table cap: at ${WH_QUEUE_MAX} play capsules the table is full, the ring stays full and "Table full" is announced once (COLLECTION C-5, 9.7)`,
    m.credits === WH_QUEUE_MAX && m.tableFull && notices.filter((t) => /Table full/.test(t)).length === 1, JSON.stringify({ m, notices }));
  check('table full: one capsule on the table, one meter-full plink per capsule earned', r.fake.log.count('dropCapsule') === 1 && r.fake.log.count('meterFull') === WH_QUEUE_MAX, `drops ${r.fake.log.count('dropCapsule')}, plinks ${r.fake.log.count('meterFull')}`);
  check('the starter ghost keeps the shell\'s starter id (the collection was given no profile here: its own starter)', r.app.hoard.items().length === 1 && r.app.hoard.items()[0].species === 'dollop');
}

/* ───────────────────────── 8b. visible XP (FUN.md 2): the gain cue and the pending gain of a hold (xp.ts) ───────────────────────── */
{
  const { gainOf, createPending, heldPay, LEVEL_STEP } = await import('../../src/shell/xp.ts');
  const { PAY } = await import('../../src/core/meter.ts');
  type MV = Parameters<typeof gainOf>[0];
  const mv = (sp: number, credits: number, threshold = 30): MV => ({ ledger: 'practice', fill: sp / threshold, sp, threshold, credits, playCredits: credits, resting: false, doneToday: false, tableFull: false, offline: false });
  check('xp gainOf: the squish points one touch added (across a capsule too; nothing when the meter did not move)',
    Math.abs(gainOf(mv(10, 0), mv(10.8, 0)) - 0.8) < 1e-9 && Math.abs(gainOf(mv(29.5, 0), mv(0.7, 1, 50)) - 1.2) < 1e-9 && gainOf(mv(5, 0), mv(5, 0)) === 0);
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
  check('xp pending: nothing pends when the table is full or the day is done',
    pend.fill({ ...mv(0, 5), tableFull: true }, 0) === 0 && pend.fill({ ...mv(0, 0), doneToday: true }, 0) === 0);
  // through the game with the real collection (its previewTouch): a 1.2 s press shows a pending arc; its release pays a squeeze, emits one
  // 'gain' with the SP, and the arc it showed matches what banked; a poke emits a 'poke' gain
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
  check('xp through the game: a held press shows a pending arc (the collection preview), the release pays a squeeze (one gain event with its SP) and the arc matched what banked (within 10%); the press\'s first contact paid a poke',
    r.app.pendingSource === 'collection' && shown > 0 && r.app.pendingFill() === 0 && !!sq && Math.abs(sq.sp / th - shown) <= 0.1 * shown && gains.some((g) => g.kind === 'poke'),
    `shown ${(shown * th).toFixed(2)} SP, banked ${sq ? sq.sp.toFixed(2) : 'none'} SP; gains ${gains.map((g) => g.kind).join(',')}`);
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
