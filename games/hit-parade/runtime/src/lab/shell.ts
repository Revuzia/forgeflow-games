// HIT PARADE - lab page for lane SHELL (CONTRACT §16 lab pages: dev-only, never linked from index.html, never built).
// Proves the SHELL modules in isolation (no sim / view / menus needed):
//   * app/loop.ts   ticks at 60 Hz on real rAF; pause gates the step and discards the accumulator (no burst on
//                   resume); the ~60 fps render cap on simulated 90 / 120 / 144 Hz rAF timestamps
//   * input.ts      real key presses -> 16-bit words (per-tick latching, SOCD, P1 / P2 bindings), gamepads through a
//                   replaceable navigator.getGamepads (the harness injects synthetic pads), START -> pause UI action
//   * settings.ts / save.ts   set -> reload -> read back (the harness reloads the page), corrupt / blocked storage
//   * testsurface.ts          window.__HP__ with lab hooks (dev functions throw unless ?dev=1)
//   * app/flow.ts             legal / illegal transitions, THE SEASON / PILOT ladders
// window.__LAB__ is the harness API (_harness/bootcheck.py --lab drives it).

import { GameLoop, SIM_DT } from '../app/loop.ts';
import { Flow, SeasonRun, type SeasonRoster } from '../app/flow.ts';
import { Input, describeWord, socd, stickBits, BIT, type UiAction } from '../input.ts';
import { SettingsStore, sanitizeSettings, viewSettings, type Settings } from '../ui/settings.ts';
import { SaveStore, SAVE_KEY } from '../ui/save.ts';
import { installTestSurface } from '../testsurface.ts';

const params = new URLSearchParams(location.search);
const dev = params.get('dev') === '1';
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const logLines: string[] = [];
function log(s: string): void {
  logLines.push(s);
  if (logLines.length > 200) logLines.shift();
  $('logtext').textContent = logLines.slice(-40).join('\n');
}

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String((e as PromiseRejectionEvent).reason)));

// ── stores
const save = new SaveStore();
const settings = new SettingsStore(save);
const flow = new Flow();
flow.go('loading', 'lab');

// ── input (always live in the lab: every word the sim would see is recorded)
const c0 = settings.get().controls;
const input = new Input({ keys: [c0[0].keys, c0[1].keys], pads: [c0[0].pad, c0[1].pad] });
input.live = true;
settings.on((s, keys) => {
  if (keys.includes('controls')) {
    input.setBindings(0, s.controls[0].keys, s.controls[0].pad);
    input.setBindings(1, s.controls[1].keys, s.controls[1].pad);
    log('bindings applied live');
  }
});
const uiEvents: Array<{ a: UiAction; p: number; tick: number; via: string }> = [];

// ── the loop: one input sample per tick, a change log of the words
const words: [number, number] = [0, 0];
const hist: Array<[number, number, number]> = [];
let prev0 = -1, prev1 = -1;
let ticks = 0;
/** per rendered frame: [rAF gap ms (exact), ticks run, sim enabled 1/0] (the last 240) */
const frameLog: Array<[number, number, number]> = [];
const loop = new GameLoop(() => {
  input.sampleAll(words);
  ticks++;
  if (words[0] !== prev0 || words[1] !== prev1) {
    hist.push([ticks, words[0], words[1]]);
    if (hist.length > 2000) hist.shift();
    prev0 = words[0]; prev1 = words[1];
  }
}, () => {
  frameLog.push([loop.lastRawMs, loop.lastTicks, loop.simEnabled ? 1 : 0]);
  if (frameLog.length > 240) frameLog.shift();
  if ((loop.counters.frames - 1) % 6 !== 0) return;   // paint on the first frame, then every 6th
  const st = loop.stats();
  $('loop').textContent = `ticks ${loop.ticks}  frames ${loop.counters.frames}  dropped ${loop.counters.dropped}  capSkips ${loop.counters.capSkips}\n`
    + `fps ${st.fps.toFixed(1)}  tickRate ${st.tickRate.toFixed(1)}/s  p50 ${st.p50.toFixed(2)} ms  p99 ${st.p99.toFixed(2)} ms\n`
    + `sim ${loop.simEnabled ? 'ON' : 'PAUSED'}  flow ${flow.phase}`;
  $('words').textContent = `P1 ${words[0].toString(2).padStart(13, '0')}  ${describeWord(words[0])}\n`
    + `P2 ${words[1].toString(2).padStart(13, '0')}  ${describeWord(words[1])}\n`
    + `held: ${input.heldCodes().join(' ') || '-'}   devices: ${input.lastDevice(0)} / ${input.lastDevice(1)}`;
  $('pads').textContent = JSON.stringify(input.padInfo().map((p) => ({ i: p.index, player: p.player, id: p.id.slice(0, 24),
    down: p.buttons.map((b, i) => (b ? i : -1)).filter((i) => i >= 0), axes: p.axes.slice(0, 2) })), null, 0) || '-';
  const s = settings.get();
  $('store').textContent = `gore ${s.gore}  shake ${s.screenShake}  flash ${s.reduceFlashing ? 'reduced' : 'full'}  cine ${s.cinematics}\n`
    + `schemes ${s.controls[0].scheme}/${s.controls[1].scheme}  P1 L=${s.controls[0].keys.l.join(',')}  quality ${s.quality}\n`
    + `persisted ${settings.persisted}  storage ${save.available ? 'yes' : 'NO'}  unlocks ${JSON.stringify(save.get().unlocks)}`;
});
input.onUi((a, p, e) => {
  uiEvents.push({ a, p, tick: ticks, via: e ? 'key' : 'pad' });
  log(`ui ${a} from P${p + 1} (${e ? 'key' : 'pad'}) at tick ${ticks}`);
});
loop.start();
flow.go('menu', 'lab ready');
flow.setScreen('lab');

// ── __HP__ with lab hooks
installTestSurface({
  version: 'hit-parade-lab-shell', dev, flow,
  loop: () => loop, input: () => input, settings: () => settings, save: () => save,
  match: () => null, fighters: () => null, events: () => [],
  extra: () => ({ lab: 'shell', labTicks: ticks }),
  canvas: () => document.getElementById('game') as HTMLCanvasElement,
  render: () => undefined, renderInfo: () => null, audio: () => null, net: () => null,
  touch: () => ({ mode: input.mode, pinned: input.pinned, touch: { ...input.touch } }),
  step: (n) => loop.stepSync(n),
  freeze: (on) => { loop.simEnabled = !on; },
  goto: (screen) => { flow.setScreen(screen); },
});

// ── helpers the harness calls
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function rafWait(): Promise<number> { return new Promise((r) => requestAnimationFrame(r)); }

/** run a GameLoop on SIMULATED rAF timestamps at `hz` for `seconds`: rendered frames + ticks (the frame cap) */
function capSim(hz: number, seconds: number, capMs?: number): { hz: number; frames: number; ticks: number; skips: number; fps: number; tickRate: number } {
  let st = 0;
  const l = new GameLoop(() => { st++; }, () => undefined);
  if (capMs !== undefined) l.frameCapMs = capMs;
  const raw = l as unknown as { running: boolean; raf: (cb: (t: number) => void) => number; frame: (now: number) => void };
  raw.running = true;
  raw.raf = () => 0;                                   // no real rAF: the calls below are the rAFs
  const n = Math.round(hz * seconds);
  const dt = 1000 / hz;
  let t = 1000;
  for (let i = 0; i < n; i++) {
    // +-0.3 ms jitter, deterministic
    const j = ((i * 7919) % 13 - 6) * 0.05;
    raw.frame(t + j);
    t += dt;
  }
  return { hz, frames: l.counters.frames, ticks: st, skips: l.counters.capSkips, fps: l.counters.frames / seconds, tickRate: st / seconds };
}

const ROSTER: SeasonRoster = {
  playable: ['johnny', 'patch', 'bruno', 'zambini', 'krane', 'lotus', 'boneyard', 'spin', 'gazza', 'rerun'],
  miniboss: 'freak', boss: 'ricky',
  rival: (id) => ({ johnny: 'boneyard', patch: 'spin', bruno: 'krane', zambini: 'gazza', krane: 'bruno', lotus: 'rerun',
    boneyard: 'johnny', spin: 'patch', gazza: 'zambini', rerun: 'lotus' } as Record<string, string>)[id] ?? null,
};

const lab = {
  errors,
  frameLog: (n = 60) => frameLog.slice(-n),
  ticks: () => loop.ticks,
  words: () => [words[0], words[1]],
  history: (since = 0) => hist.filter((h) => h[0] >= since),
  uiEvents: () => uiEvents.slice(),
  stats: () => ({ ...loop.stats(), counters: { ...loop.counters }, simEnabled: loop.simEnabled, SIM_DT }),
  /** wall-clock tick rate over `ms` of real rAF */
  async measureTicks(ms = 3000) {
    await rafWait();
    const t0 = performance.now(), k0 = loop.ticks, f0 = loop.counters.frames;
    await wait(ms);
    await rafWait();
    const t1 = performance.now(), k1 = loop.ticks, f1 = loop.counters.frames;
    return { ms: t1 - t0, ticks: k1 - k0, frames: f1 - f0, rate: ((k1 - k0) * 1000) / (t1 - t0), fps: ((f1 - f0) * 1000) / (t1 - t0) };
  },
  /** pause for `ms`: no tick may run; after resume the first 250 ms must hold ~15 ticks (no fast-forward burst) */
  async pauseTest(ms = 1000) {
    loop.simEnabled = false;
    await rafWait();
    const k0 = loop.ticks;
    await wait(ms);
    const during = loop.ticks - k0;
    loop.simEnabled = true;
    await rafWait();
    const k1 = loop.ticks, t1 = performance.now();
    await wait(250);
    await rafWait();
    const after = loop.ticks - k1, t2 = performance.now();
    return { pausedMs: ms, ticksWhilePaused: during, ticksAfterResume: after, windowMs: t2 - t1, expected: ((t2 - t1) / 1000) * 60 };
  },
  capSim,
  capSuite: () => [60, 90, 120, 144, 240].map((hz) => capSim(hz, 10)),
  pure: {
    socd: (w: number) => socd(w),
    stick: (x: number, y: number) => stickBits(x, y),
    BIT,
  },
  settings: {
    get: () => settings.get(),
    set: (patch: Partial<Settings>) => settings.set(patch),
    bindKey: (p: 0 | 1, a: Parameters<SettingsStore['bindKey']>[1], code: string, slot = 0) => settings.bindKey(p, a, code, slot),
    bindPad: (p: 0 | 1, a: Parameters<SettingsStore['bindPad']>[1], b: number, slot = 0) => settings.bindPad(p, a, b, slot),
    setScheme: (p: 0 | 1, s: 0 | 1) => settings.setScheme(p, s),
    resetControls: (p?: 0 | 1) => settings.resetControls(p),
    persisted: () => settings.persisted,
    view: () => viewSettings(settings.get()),
    sanitize: (raw: unknown) => sanitizeSettings(raw),
  },
  save: {
    get: () => save.get(),
    recordClear: (r: Parameters<SaveStore['recordClear']>[0]) => save.recordClear(r),
    addScore: (r: Parameters<SaveStore['addScore']>[0]) => save.addScore(r),
    setOnlineName: (n: string) => save.setOnlineName(n),
    markSeen: (f: string) => save.markSeen(f),
    reset: () => save.reset(),
    raw: () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return 'THROWS: ' + String(e); } },
    available: () => save.available,
    persisted: () => save.persisted,
  },
  flowTest() {
    const f = new Flow();
    const steps: Array<[string, boolean]> = [];
    const go = (p: Parameters<Flow['go']>[0]): void => { steps.push([p, f.go(p)]); };
    go('loading'); go('title'); go('menu'); go('loading'); go('ready'); go('bout'); go('paused'); go('bout'); go('results');
    go('loading'); go('bout'); go('paused'); go('menu');
    go('bout');            // illegal: menu -> bout (must go through loading)
    go('error'); go('menu');   // error is terminal
    f.setScreen('main'); f.setScreen('settings');
    return { steps, final: f.phase, violations: f.violations.map((v) => `${v.from}->${v.to}`), screen: f.screen, screenBefore: f.screenBefore };
  },
  seasonTest(seed = 7) {
    const mk = (length: 'season' | 'pilot', difficulty: number, fighter = 'johnny') => new SeasonRun({ fighter, color: 0, scheme: 0, length, difficulty, seed }, ROSTER, null);
    const s = mk('season', 0);
    const again = mk('season', 0);
    const p = mk('pilot', 2);
    const e = mk('season', -2, 'bruno');
    // play the season: lose bout 2 once (continue), win the rest
    const trail: string[] = [];
    while (!s.done) {
      const slot = s.current()!;
      const lose = s.index === 1 && s.continues === 0;
      const r = s.record(!lose);
      trail.push(`${slot.kind}:${slot.opponent ?? '-'}:L${slot.level}:${r}`);
      if (r === 'retry') s.continueSlot();
    }
    return {
      season: again.slots, pilot: p.slots, easyBruno: e.slots.map((x) => `${x.kind}:${x.opponent}:L${x.level}`),
      deterministic: JSON.stringify(again.slots) === JSON.stringify(mk('season', 0).slots),
      trail, cleared: s.cleared, continues: s.continues, seeds: [0, 1, 2].map(() => s.slotSeed()),
    };
  },
  /** swap the gamepad source to window.__PADS__ (the harness may also patch navigator.getGamepads) */
  usePadGlobal() {
    input.setPadSource(() => ((window as unknown as { __PADS__?: Gamepad[] }).__PADS__ ?? []));
  },
  pinPad: (p: 0 | 1, i: number | null) => input.setPadSlot(p, i),
};
(window as unknown as { __LAB__: typeof lab }).__LAB__ = lab;
log(`lab ready: dev=${dev}, storage=${save.available ? 'yes' : 'NO'}, settings persisted=${settings.persisted}`);
