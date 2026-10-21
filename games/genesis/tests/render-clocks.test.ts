// GENESIS — the client's clocks at the living-world pace (LIVING §1.1): 1 tick = 1 game minute, and 1x is
// TICKS_PER_SECOND_1X ticks per real second — one since the living-world program, ten before it. A clock written for the
// old pace turned ticks into "seconds at 1x" by dividing by ten (or × 0.1, or SEC_PER_TICK = 0.1), or counted a
// render-only duration in ticks tuned for ten a second; at the new 1x it plays at a tenth of its speed (limbs that
// moonwalk under walking bodies, launch smoke that ages four seconds over a forty-second climb, a camera that stares at a
// wreck for seventy seconds) and at 10x like the old 1x. Without a GPU:
//   * no client code (render, audio, ui, client) converts ticks to seconds by a literal ten — every such clock reads
//     TICKS_PER_SECOND_1X (allow-list below for real game-time or wall-time uses, each with its reason);
//   * the clocks reachable without WebGL advance one second per real second at 1x: the people's and animals' gait
//     clock, the launch FX clock (and its emitters at 60 frames a second), the ships' sim-paced clock, the world events'
//     ring, vents and burst timeline, the camera's hold over an unmade world, the render clock after a small rewind;
//     the god layer's FX clock (godfx.ts) is the reference: real time at 1x, never faster, frozen when paused;
//   * what was tuned in seconds at 1x stays so: the engines light 1.2 s before lift-off, the lookdev stand-in's people
//     walk at a walk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, Quaternion, Scene, Vector3, type IUniform } from 'three';
import { Sim } from '../src/sim/sim.ts';
import { AnimState, TICKS_PER_SECOND_1X, type Snapshot } from '../src/sim/types.ts';
import { PAD_TICKS } from '../src/sim/space/transit.ts';
import { WorldView } from '../src/client/worldview.ts';
import { LookdevBackend } from '../src/client/lookdev.ts';
import { makePlanetUniforms } from '../src/render/planet/terrainmat.ts';
import { LifeLayer } from '../src/render/life/life.ts';
import { IGNITE_AT, RELEASE_AT, ShipLayer } from '../src/render/life/ships.ts';
import { LaunchFx, PUFF, SEC_PER_TICK, type EngineFire, type LaunchPlanetCtx } from '../src/render/fx/launch.ts';
import { WorldFx, type WorldPlanetRef } from '../src/render/fx/worlds.ts';
import { CameraRig } from '../src/render/camera/rig.ts';
import { newInput } from '../src/render/camera/common.ts';
import type { CameraPose } from '../src/render/frame.ts';

const TPS = TICKS_PER_SECOND_1X;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── the scan ─────────────────────────────

/** what a tick-to-seconds conversion by the old literal ten looks like in code */
const OLD_PACE: { name: string; re: RegExp }[] = [
  // tick / 10, (renderTick - tick0) / 10, dTick * 0.1 …
  { name: 'ticks / 10 or ticks × 0.1', re: /\b\w*[Tt]icks?\w*\b[^;,]{0,40}?(?:\/\s*10(?:\.0*)?(?![\d.])|\*\s*0?\.10*(?![\d.]))/ },
  // 0.1 * tick
  { name: '0.1 × ticks', re: /(?<![\w.])0?\.10*\s*\*\s*\(?\s*[\w.]*[Tt]ick/ },
  // SEC_PER_TICK = 0.1, TICKS_PER_SECOND = 10
  { name: 'a local pace constant', re: /\b\w*(?:SEC|SECOND)S?_PER_TICKS?\w*\s*=\s*0?\.10*(?![\d.])|\b\w*TICKS?_PER_SEC\w*\s*=\s*10(?![\d.])|\bconst\s+\w*(?:TPS|Tps|tps)\w*\s*=\s*10(?![\d.])/ },
  // a per-tick rate made per-second: altRate * 10
  { name: 'a per-tick rate × 10', re: /\b\w*(?:[Rr]ate|[Pp]erTick)\b[^;,]{0,30}?\*\s*10(?![\d.])/ },
  // tps / 10: a tick rate made an old-1x multiple
  { name: 'tps / 10', re: /\b\w*(?:tps|Tps|TPS)\w*\b[^;,]{0,30}?(?:\/\s*10(?:\.0*)?|\*\s*0?\.10*)(?![\d.])/ },
  // seconds × 10 → ticks
  { name: 'seconds × 10 as ticks', re: /\b\w*(?:[Ss]ecs?|[Ss]econds?)\b[^;,]{0,20}?\*\s*10(?![\d.])/ },
];
/** comments that state the old pace as the current one (a comment may tell the history: allow-listed with a reason) */
const OLD_PACE_DOC = /\bticks?\s*\/\s*10\b|\b10 ticks (?:per|a) (?:real )?second|\b1[x×]\s*=\s*10 ticks/i;

/**
 * Lines that match on purpose. Each: the file, a piece of the line, the reason. An entry that no longer matches
 * anything fails the test too (so the list never outlives what it excuses).
 */
const ALLOW: { file: string; has: string; reason: string }[] = [
  {
    file: 'src/render/fx/launch.ts', has: 'pace it was ticks / 10, written when 1× was ten ticks a second',
    reason: 'history in a comment: what the launch FX clock was before the living-world pace and why it changed',
  },
];

const SCANNED = ['src/render', 'src/audio', 'src/ui', 'src/client'];

function sources(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(join(ROOT, d))) {
      const p = join(d, n);
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.(?:ts|mts|js|mjs)$/.test(n)) out.push(p);
    }
  };
  for (const r of SCANNED) walk(r);
  return out;
}

/** a file split into code (comments blanked, line numbers kept) and comment text per line */
function split(src: string): { code: string[]; doc: string[] } {
  const code: string[] = [], doc: string[] = [];
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const blocks = src.split('\n').map(() => '');
  src.replace(/\/\*[\s\S]*?\*\//g, (m, at: number) => {
    const first = src.slice(0, at).split('\n').length - 1;
    m.split('\n').forEach((l, i) => { blocks[first + i] += l; });
    return m;
  });
  blanked.split('\n').forEach((l, i) => {
    const c = l.match(/(^|[^:'"\\])(\/\/.*)$/);
    code.push(c ? l.slice(0, l.length - c[2].length) : l);
    doc.push((c ? c[2] : '') + blocks[i]);
  });
  return { code, doc };
}

function hits(file: string, src: string): { line: number; text: string; why: string }[] {
  const out: { line: number; text: string; why: string }[] = [];
  const { code, doc } = split(src);
  code.forEach((l, i) => { for (const p of OLD_PACE) if (p.re.test(l)) out.push({ line: i + 1, text: src.split('\n')[i].trim(), why: p.name }); });
  doc.forEach((l, i) => { if (OLD_PACE_DOC.test(l)) out.push({ line: i + 1, text: src.split('\n')[i].trim(), why: 'a comment stating the old pace' }); });
  void file;
  return out;
}

test('the scan knows the old pace when it sees it', () => {
  // (the very lines this program found: a scan that flags none of them proves nothing)
  const old = [
    'if (dTick > 1e-6) this.animClock += Math.min(dt, dTick / 10 + 1e-3);',
    'const SEC_PER_TICK = 0.1;',
    'u.uT.value = (tick / 10) % 1e5;',
    'u.uT.value = (view.renderTick / 10) % 1e4;',
    'const t = Math.max(0, Math.min(time - b.t0, (view.renderTick - b.tick0) / 10));',
    "p2: Math.max(50, (st.altRate === 0 ? 1000 : -st.altRate) * 10 / down)",
    'const fx = 0.1 * renderTick;',
    'const sec = tps / 10;',
    'const holdTicks = seconds * 10;',
    '// 1x = 10 ticks per real second: the clock never runs faster than real time',
  ];
  for (const l of old) assert.ok(hits('fixture.ts', l).length > 0, `not flagged: ${l}`);
  // and game time / wall time is left alone
  const fine = [
    'const da = h.drift + tick * 0.0004;',
    'u.uHeat.value = Math.max(0, 1 - (tick - ca) / 2880) * 0.8;',
    'const st = hashFloat(h.group, k, Math.floor(tick / 300) + 19);',
    'this.animClock += Math.min(dt, dTick / TICKS_PER_SECOND_1X + 1e-3);',
    'const k = 1 - Math.min(1, alt / 100);',
    'cam.rotateX(k * Math.sin(time * 31.0));',
  ];
  for (const l of fine) assert.equal(hits('fixture.ts', l).length, 0, `flagged: ${l}`);
});

test('no client clock converts ticks to seconds by the old literal ten', () => {
  const bad: string[] = [];
  const used = new Set<number>();
  for (const f of sources()) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const rel = relative(ROOT, join(ROOT, f)).split('\\').join('/');
    for (const h of hits(rel, src)) {
      const a = ALLOW.findIndex((x) => x.file === rel && h.text.includes(x.has));
      if (a >= 0) { used.add(a); continue; }
      bad.push(`${rel}:${h.line} (${h.why}): ${h.text.slice(0, 140)}`);
    }
  }
  assert.deepEqual(bad, [], `1x is TICKS_PER_SECOND_1X ticks a second (LIVING §1.1) — import it (src/sim/types.ts), never a literal ten:\n  ${bad.join('\n  ')}`);
  const stale = ALLOW.filter((_, i) => !used.has(i)).map((x) => `${x.file}: "${x.has}"`);
  assert.deepEqual(stale, [], 'allow-list entries that match nothing any more');
});

// ───────────────────────────── the clocks at 1x ─────────────────────────────

function sandbox(): { sim: Sim; view: WorldView } {
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 12 } });
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  view.updateBodies(sim.u.tick);
  view.renderTick = sim.u.tick;
  return { sim, view };
}

test("the people's gait clock runs a real second per second at 1x, never faster, and stops when paused", () => {
  const { view } = sandbox();
  const pv = view.planets[0];
  const life = new LifeLayer(makePlanetUniforms() as unknown as Record<string, IUniform>);
  const cam = new Vector3(0, pv.params.radius + 400, 0);
  let time = 0;
  const clock = (): number => (life as unknown as { animClock: number }).animClock;
  /** `seconds` of real time at `speed` (presets are ticks per second: speed × TICKS_PER_SECOND_1X), 60 frames a second */
  const run = (seconds: number, speed: number): number => {
    const c0 = clock();
    for (let i = 0; i < seconds * 60; i++) {
      time += 1 / 60;
      pv.renderTick = (pv.renderTick ?? 0) + (speed * TPS) / 60;
      life.update({ pv, camBody: cam, frame: i, time, animTime: 0, primary: true, shadows: false, lightBudget: 4, particleBudget: 500, crowdDensity: 1 });
    }
    return clock() - c0;
  };
  pv.renderTick = view.renderTick;
  run(0.1, 1);
  const at1 = run(2, 1);
  assert.ok(Math.abs(at1 - 2) < 0.1, `2 s at 1x: the limbs' clock gained ${at1.toFixed(3)} s (dTick / 10 gained ~0.3)`);
  const at100 = run(1, 100);
  assert.ok(at100 <= 1.0001 && at100 > 0.95, `1 s at 100x: ${at100.toFixed(3)} s (never faster than real time)`);
  const paused = run(1, 0);
  assert.equal(paused, 0, 'paused: frozen');
});

/** a launch site on a small world: the pad at +y */
const R = 3000, AIR = 600;
function launchCtx(): LaunchPlanetCtx {
  const uniforms: Record<string, IUniform> = { uSunE: { value: new Vector3(8, 8, 8) }, uSunDirBody: { value: new Vector3(0, 1, 0) }, uMoonE: { value: new Vector3() } };
  return { group: new Group(), uniforms, camBody: new Vector3(0, R + 10, 400), wind: new Vector3(), airTop: AIR, radius: R, hasAir: true };
}
function birthsOf(fx: LaunchFx): number[] {
  const P = (fx as unknown as { planets: Map<number, { puffs: { aA: { array: Float32Array }; aB: { array: Float32Array }; cap: number } }> }).planets.get(0);
  if (!P) return [];
  const A = P.puffs.aA.array, B = P.puffs.aB.array, out: number[] = [];
  for (let i = 0; i < P.puffs.cap; i++) if (A[i * 4 + 3] < 1e8) out.push(Math.floor(B[i * 4 + 3] + 0.5));
  return out;
}
const count = (kinds: number[], k: number): number => kinds.filter((x) => x === k).length;

test('the launch FX clock is a real second per second at 1x, and its emitters pour at their rates at 60 frames a second', () => {
  assert.equal(SEC_PER_TICK, 1 / TPS, 'fx seconds are ticks / TICKS_PER_SECOND_1X');
  const fx = new LaunchFx();
  fx.begin(500);
  const n0 = fx.now;
  fx.begin(500 + TPS);
  assert.ok(Math.abs(fx.now - n0 - 1) < 1e-9, `one second of ticks at 1x is ${fx.now - n0} fx s`);
  // a vent boiling off at 12 puffs a second and a small rocket's hold-down, watched at 60 frames a second at 1x for a
  // second: rounded frame by frame (a sixtieth of an fx second each) they poured nothing
  const c = launchCtx();
  const live = new LaunchFx();
  const pad = new Vector3(0, R, 0);
  const still = (_tk: number, out: Vector3): Vector3 => out.copy(pad);
  let tick = 1000;
  const frame = (): void => {
    live.begin(tick);
    live.vent(0, c, new Vector3(20, R + 10, 0), new Vector3(1, 0, 0), 12, 1);
    live.engine({ key: 'small:0', planet: 0, pos: pad.clone(), dir: new Vector3(0, -1, 0), radius: 0.4, count: 1, thrust: 1, vacuum: false, fuel: 'kerolox', alt: 0, path: still, trail: false, since: 1000, fromPad: true });
    live.update(() => c, [0, 0, 0], 0, tick / TPS, 1 / 60);
  };
  frame();
  const first = birthsOf(live);
  for (let i = 0; i < 60; i++) { tick += TPS / 60; frame(); }
  const all = birthsOf(live);
  const vents = count(all, PUFF.vent) - count(first, PUFF.vent);
  const fires = count(all, PUFF.fireball) - count(first, PUFF.fireball);
  assert.ok(vents >= 11 && vents <= 13, `a 12/s vent poured ${vents} puffs in a second`);
  // (26 tongues per thrust-second × the cluster's scale 0.6)
  assert.ok(fires >= 13 && fires <= 17, `the trench's fire poured ${fires} tongues in a second (15.6 expected)`);
});

test('a pad launch first seen late pours the ground cloud of its whole low phase, as a watched one does', () => {
  // the sim's climb (transit.ts: altitude × f^1.4 over ASCENT_TICKS = 40), a slow one: 60 m up ~8 ticks after lift-off
  const A = 600, L = 100, H = (1 - IGNITE_AT) * PAD_TICKS;
  const path = (tk: number, out: Vector3): Vector3 => out.set(0, R + A * Math.pow(Math.max(0, Math.min(1, (tk - L) / 40)), 1.4), 0);
  const fire = (tick: number): EngineFire => {
    const pos = path(tick, new Vector3());
    return { key: 'r:0', planet: 0, pos, dir: new Vector3(0, -1, 0), radius: 0.9, count: 3, thrust: 1, vacuum: false, fuel: 'kerolox', alt: pos.length() - R, path, trail: true, since: L - H, fromPad: true };
  };
  const c = launchCtx();
  const watched = new LaunchFx();
  const end = L + 14 * TPS;
  for (let tick = L - H; tick <= end + 1e-9; tick += TPS / 60) {
    watched.begin(tick); watched.engine(fire(tick)); watched.update(() => c, [0, 0, 0], 0, tick / TPS, 1 / 60);
  }
  const late = new LaunchFx();
  late.begin(end); late.engine(fire(end)); late.update(() => c, [0, 0, 0], 0, end / TPS, 1 / 60);
  const w = count(birthsOf(watched), PUFF.padCloud), f = count(birthsOf(late), PUFF.padCloud);
  assert.ok(w > 100, `${w} pad-cloud puffs watched`);
  // (the window was 4.4 fx s — 44 ticks at the old pace, 4.4 at the new: a late sight poured half the cloud)
  assert.ok(f >= 0.8 * w && f <= 1.25 * w, `first seen late: ${f} pad-cloud puffs, watched: ${w}`);
});

test('the engines light 1.2 s of 1x before lift-off and the hoses let go after; the ships’ own clock is real time', () => {
  const hold = ((1 - IGNITE_AT) * PAD_TICKS) / TPS;
  assert.ok(Math.abs(hold - 1.2) < 1e-9, `the hold-down lasts ${hold.toFixed(2)} s at 1x (12 ticks: twelve seconds)`);
  assert.ok(RELEASE_AT > IGNITE_AT && RELEASE_AT < 1, `the umbilicals let go at ${RELEASE_AT.toFixed(3)} of the countdown, the engines light at ${IGNITE_AT.toFixed(3)}`);
  const ships = new ShipLayer();
  const view = new WorldView();
  const scene = new Scene();
  const pose: CameraPose = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 50, planet: 0 };
  let time = 0;
  const clock = (): number => (ships as unknown as { fxClock: number }).fxClock;
  const run = (seconds: number, speed: number): number => {
    const c0 = clock();
    for (let i = 0; i < seconds * 60; i++) {
      time += 1 / 60; view.renderTick += (speed * TPS) / 60;
      ships.update(view, pose, new Map(), scene, time, 1 / 60, 0, false);
    }
    return clock() - c0;
  };
  run(0.1, 1);
  const at1 = run(1, 1), at300 = run(1, 300), paused = run(1, 0);
  assert.ok(Math.abs(at1 - 1) < 0.05, `1 s at 1x: ${at1.toFixed(3)} s (a stranded ship tumbles 0.04 rad a second)`);
  assert.ok(at300 <= 1.0001 && at300 > 0.95, `1 s at 300x: ${at300.toFixed(3)} s`);
  assert.equal(paused, 0, 'paused: frozen');
});

class WorldHarness {
  readonly fx = new WorldFx();
  readonly scene = new Scene();
  readonly refs = new Map<number, WorldPlanetRef>();
  readonly pose: CameraPose = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 50, planet: 0 };
  time = 0;
  readonly sim: Sim;
  readonly view: WorldView;
  constructor(sim: Sim, view: WorldView) { this.sim = sim; this.view = view; }
  /** a snapshot from the sim (the render clock where the sim is) */
  snap(): void {
    this.view.apply(this.sim.snapshot({ full: true }), this.time * 1000);
    this.view.renderTick = this.sim.u.tick;
    this.frame(0);
  }
  /** a frame `dt` real seconds on, the render clock `dTick` on */
  frame(dt: number, dTick = 0): void {
    this.time += dt;
    this.view.renderTick += dTick;
    this.view.updateBodies(this.view.renderTick);
    for (const pv of this.view.planets) {
      if (!this.refs.has(pv.id)) this.refs.set(pv.id, { group: new Group(), uniforms: makePlanetUniforms() as unknown as Record<string, IUniform>, pv });
      this.refs.get(pv.id)!.pv = pv;
    }
    for (const id of [...this.refs.keys()]) if (!this.view.planet(id)) this.refs.delete(id);
    const p0 = this.view.planets[0];
    this.pose.pos = [p0.center[0] + p0.params.radius * 4, p0.center[1], p0.center[2]];
    this.fx.update(this.view, this.pose, this.refs, this.scene, this.time, new Quaternion());
  }
  /** `seconds` of real time at `speed`, 30 frames a second */
  run(seconds: number, speed: number): void { for (let i = 0; i < seconds * 30; i++) this.frame(1 / 30, (speed * TPS) / 30); }
}

test("a cracked world's ring turns with the world's time in seconds at 1x; its vents' steam at real time, never faster", () => {
  const { sim, view } = sandbox();
  const h = new WorldHarness(sim, view);
  h.snap(); h.snap();
  assert.ok(sim.applyNow({ k: 'world.crack', world: 0 }).ok);
  h.snap(); h.run(0.2, 1);
  let ringT: IUniform | null = null;
  h.scene.getObjectByName('ring-frame-0')!.traverse((o) => { const m = o as unknown as { isInstancedMesh?: boolean; material: { uniforms: Record<string, IUniform> } }; if (m.isInstancedMesh && m.material.uniforms.uT) ringT = m.material.uniforms.uT; });
  assert.ok(ringT, 'the ring rocks');
  const vent = (h.fx as unknown as { cracks: Map<number, { ventMat: { uniforms: Record<string, IUniform> } | null }> }).cracks.get(0)?.ventMat?.uniforms.uT;
  assert.ok(vent, 'the rift vents');
  const sample = (): [number, number] => [ringT!.value as number, vent!.value as number];
  let a = sample(); h.run(2, 1); let b = sample();
  assert.ok(Math.abs(b[0] - a[0] - 2) < 0.05, `2 s at 1x: the ring's clock gained ${(b[0] - a[0]).toFixed(3)} s (tick / 10: 0.2)`);
  assert.ok(Math.abs(b[1] - a[1] - 2) < 0.1, `2 s at 1x: the steam's clock gained ${(b[1] - a[1]).toFixed(3)} s`);
  a = sample(); h.run(1, 300); b = sample();
  assert.ok(Math.abs(b[0] - a[0] - 300) < 3, `1 s at 300x: the ring turns with the world (${(b[0] - a[0]).toFixed(1)} s)`);
  assert.ok(b[1] - a[1] <= 1.0001 && b[1] - a[1] > 0.9, `1 s at 300x: the steam keeps real time (${(b[1] - a[1]).toFixed(3)} s)`);
  a = sample(); h.run(1, 0); b = sample();
  assert.deepEqual(b, a, 'paused: both frozen');
});

test("an erased world's collapse plays out in its twelve seconds at 1x, and the camera holds over it for seven", () => {
  const { sim, view } = sandbox();
  const h = new WorldHarness(sim, view);
  h.snap(); h.snap();
  const rig = new CameraRig();
  const input = newInput();
  (rig as unknown as { orbit: { setFromLatLon(p: number, la: number, lo: number, d: number): void } }).orbit.setFromLatLon(1, 0, 0, 3000);
  for (let i = 0; i < 5; i++) rig.update(1 / 30, view, input);
  assert.ok(sim.applyNow({ k: 'world.erase', world: 1 }).ok);
  // the world goes as the lookdev sends it: one snapshot with alive = false, then none
  h.snap();
  const s = sim.snapshot({ full: true }) as Snapshot;
  s.planets = s.planets.filter((p) => p.alive !== false);
  view.apply(s, h.time * 1000);
  assert.equal(view.planet(1), undefined, 'the world is gone from the view');
  const bursts = (): string[] => (h.fx.detail().bursts as { kind: string }[]).map((b) => b.kind);
  const gone = (): boolean => (rig as unknown as { goneTick: number }).goneTick < 0;
  let held = -1, done = -1;
  for (let t = 0; t < 20 * 30 && (held < 0 || done < 0); t++) {
    h.frame(1 / 30, TPS / 30);
    rig.update(1 / 30, view, input);
    const sec = (t + 1) / 30;
    if (t === 0) assert.ok(bursts().includes('erase') && !gone(), 'the collapse begins and the eye holds');
    if (held < 0 && gone()) held = sec;
    if (done < 0 && !bursts().includes('erase')) done = sec;
  }
  assert.ok(done > 11.5 && done < 13, `the erasure ran ${done.toFixed(1)} s at 1x (12; on the old ten, 120)`);
  assert.ok(held > 6.5 && held < 8, `the eye held ${held.toFixed(1)} s at 1x (7; seventy ticks were seventy)`);
});

test('a small rewind at 1x moves the render clock back at once (it stood still until the sim caught up)', () => {
  const view = new WorldView();
  const snap = (tick: number): Snapshot => ({
    tick, speed: 1, achievedSpeed: 1, star: { name: 'Sun', kind: 'G', luminosity: 1, temperature: 5800, radius: 1e4, color: [1, 1, 1], activity: 0 },
    planets: [], ships: [], creatures: [], hand: null, events: [], chronicle: [], content: [], msPerTick: 0, restraint: false, worship: [],
  });
  let now = 0, simT = 500;
  const run = (ms: number): void => {
    for (const end = now + ms; now < end;) {
      now += 1000 / 60;
      simT += TPS / 60;
      if (Math.round(now / (1000 / 60)) % 2 === 0) view.apply(snap(Math.floor(simT)), now);
      view.update(now);
    }
  };
  run(10_000);
  const before = view.renderTick;
  assert.ok(Math.abs(before - simT) < 2, `the clock follows the sim (${before.toFixed(2)} vs ${simT.toFixed(2)})`);
  // the toast's Undo a few seconds after the act: a few ticks back
  simT -= 6 * TPS;
  run(200);
  assert.ok(view.renderTick < before - 4 * TPS, `200 ms after a 6 s rewind the clock is at ${view.renderTick.toFixed(2)} (was ${before.toFixed(2)})`);
  const t0 = view.renderTick;
  run(1000);
  assert.ok(view.renderTick - t0 > 0.8 * TPS, 'and runs on at 1x');
});

test("the lookdev stand-in's people walk at a walk at 1x (m/s, not the old m per tenth of a second)", async () => {
  const b = new LookdevBackend();
  await b.init('lookdev', 1, {}, () => { /* snapshots unused */ });
  const lp = (b as unknown as { planets: { snap: { params: { radius: number } }; life: { snapshot(t: number): { agents: { count: number; vel: Float32Array; anim: Uint8Array; flags: Uint16Array } } } | null }[] }).planets[0];
  assert.ok(lp.life, 'the lookdev home world has people');
  const { agents } = lp.life!.snapshot(1000);
  const speeds: number[] = [];
  for (let i = 0; i < agents.count; i++) {
    if (agents.anim[i] !== AnimState.walk) continue;
    // vel: unit-vector change per tick → metres per real second at 1x
    const v = Math.hypot(agents.vel[i * 3], agents.vel[i * 3 + 1], agents.vel[i * 3 + 2]) * lp.snap.params.radius * TPS;
    if (v > 0) speeds.push(v);
  }
  speeds.sort((x, y) => x - y);
  assert.ok(speeds.length > 50, `${speeds.length} walkers`);
  const med = speeds[speeds.length >> 1];
  // (the gait's ~1 Hz stride covers ~1.5–2 m: a walk; 0.14–0.19 m/tick at one tick a second was a tenth of one)
  assert.ok(med > 1.1 && med < 2.4, `median walker ${med.toFixed(2)} m/s at 1x`);
});
