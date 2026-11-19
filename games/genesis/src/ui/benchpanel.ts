// GENESIS — the automated benchmark's runner and panels (`?bench=`; plans and numbers: render/bench.ts; ledger:
// _harness/arc-work/BENCH.md). Loaded by main.ts ONLY when the URL carries `bench=`: normal play never sees this file.
//
// One link runs a whole Mac test round. The launch page (`?bench=water`) writes the plan into sessionStorage and goes
// to step 1; every step is a page load of the base parameters + one variant's switches + the forced preset, which
//   waits for the world, puts the camera at the standard landing (the hand protocol's wheel zoom, as a camera spec),
//   waits the settle time, records the window (requestAnimationFrame intervals + the perf report over the same
//   seconds), stores the numbers and the report, and replaces itself with the next step;
// the last step goes to the results page (no world is booted there): the summary table, the order run, failed and
// invalid steps, every raw report, "Download results (.txt)" and "Copy". A step whose world does not load in time, or
// that is reloaded or crashes, is recorded as failed and the run goes on. A step during which the page was hidden or
// lost the focus is marked invalid and left out of the summary.

import {
  BENCH_LAT, BENCH_LON, aggregate, benchWarnings, estimateSeconds, frameStats, landingDist, parseBench, parseReport, resultsText, settleFor,
  stepOrder, stepSearch, tcstatOf, type BenchOpts, type BenchResult, type BenchRun, type BenchVariant,
} from '../render/bench.ts';
import { perfSwitchLine } from '../render/perfswitch.ts';
import { perfmon } from '../render/perfmon.ts';
import { BUILD_STAMP } from '../render/perfreport.ts';

const KEY = 'genesis.bench.v1';
const LAST_KEY = 'genesis.bench.last';

interface BenchState {
  v: 1;
  run: string;
  name: string;
  launch: string;
  base: string;
  variants: BenchVariant[];
  opts: BenchOpts;
  order: number[];
  /** the next step to run */
  step: number;
  /** the step in flight (a page that finds its own step here was reloaded, or crashed) */
  started: number;
  results: BenchResult[];
  startedAt: string;
  endedAt: string;
  done: boolean;
  aborted: boolean;
  downloaded: boolean;
  /** seconds the steps' loads took so far (the progress line's estimate) */
  loadSum: number;
  ua: string;
}

/** the automation surface's part the bench uses (testsurface.ts) */
interface Surface {
  state(): Record<string, unknown>;
  camera(spec: Record<string, unknown>): Promise<void>;
  frames(n: number): Promise<void>;
  perfReport(ms?: number): Promise<string>;
}

function load(): BenchState | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as BenchState | null;
    return s && s.v === 1 && Array.isArray(s.results) ? s : null;
  } catch { return null; }
}

function save(s: BenchState): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); return; } catch { /* full: drop the oldest raw reports, keep the numbers */ }
  for (const r of s.results) {
    if (!r.report) continue;
    r.report = '(the raw report was dropped: the browser\'s session storage was full)';
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); return; } catch { /* the next one */ }
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
function within<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((ok) => setTimeout(() => ok('timeout'), ms))]);
}
const iso = () => new Date().toISOString().slice(0, 19) + 'Z';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (text != null) e.textContent = text;
  return e;
}
const FONT = 'font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;';
const BTN = `${FONT}color:#fff;background:#2a4d7a;border:1px solid #6d93c4;border-radius:5px;padding:5px 12px;cursor:pointer;`;

function hideBoot(): void { document.getElementById('boot')?.classList.add('gone'); }

function goto(search: string): void { location.replace(location.pathname + search); }

function runOf(s: BenchState): BenchRun {
  return { name: s.name, launch: s.launch, base: s.base, variants: s.variants, opts: s.opts, order: s.order, results: s.results, startedAt: s.startedAt, endedAt: s.endedAt || iso(), aborted: s.aborted, ua: s.ua };
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`;
}

// ── the progress line ──

class Progress {
  private root: HTMLDivElement;
  private line: HTMLSpanElement;
  constructor(onAbort: () => void) {
    this.root = el('div', `${FONT}position:fixed;z-index:2147483000;left:50%;top:6px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;max-width:94vw;`
      + 'padding:5px 8px 5px 12px;border-radius:7px;color:#e9f1ff;background:rgba(8,14,26,0.88);border:1px solid #47648e;white-space:nowrap;');
    this.root.id = 'bench-progress';
    this.line = el('span', 'overflow:hidden;text-overflow:ellipsis;');
    const b = el('button', BTN + 'background:#7a2a2a;border-color:#c46d6d;', 'Abort');
    b.id = 'bench-abort';
    b.addEventListener('click', onAbort);
    this.root.append(this.line, b);
    document.body.appendChild(this.root);
  }
  set(text: string): void { if (this.line.textContent !== text) this.line.textContent = text; }
}

// ── a step ──

/** the page was hidden, or the window lost the focus, while `on` */
class Watch {
  on = false;
  hidden = false;
  blurred = false;
  private timer = 0;
  private focus: boolean;
  constructor(focus: boolean) {
    this.focus = focus;
    document.addEventListener('visibilitychange', () => this.sample());
    window.addEventListener('blur', () => { if (this.on && this.focus) this.blurred = true; });
  }
  sample(): void {
    if (!this.on) return;
    if (document.hidden) this.hidden = true;
    if (this.focus && !document.hasFocus()) this.blurred = true;
  }
  start(): void { this.on = true; this.hidden = false; this.blurred = false; this.sample(); this.timer = window.setInterval(() => this.sample(), 250); }
  stop(): string { this.sample(); this.on = false; clearInterval(this.timer); return this.hidden ? 'page hidden' : this.blurred ? 'window lost focus' : ''; }
}

function fatalText(): string {
  for (const id of ['fatal', 'retry', 'nogpu']) {
    const c = document.getElementById(id);
    if (c && !c.hidden) return `${id} card: ${(document.getElementById(`${id}-msg`)?.textContent ?? document.getElementById(`${id}-sub`)?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160)}`;
  }
  return '';
}

async function placeCamera(G: Surface, opts: BenchOpts): Promise<number> {
  if (opts.cam) await G.camera({ blend: 0, ...(JSON.parse(opts.cam) as Record<string, unknown>) });
  else {
    const st = G.state() as { camera?: { planet?: number }; planets?: { id: number; radius: number }[] };
    const id = st.camera?.planet ?? st.planets?.[0]?.id ?? 0;
    const radius = st.planets?.find((p) => p.id === id)?.radius ?? st.planets?.[0]?.radius ?? 0;
    if (!(radius > 0)) throw new Error('no planet to land on');
    // the hand protocol's landing: the boot camera's place and heading, its automatic tilt, the wheel zoom's distance
    await G.camera({ mode: 'orbit', planet: id, lat: BENCH_LAT, lon: BENCH_LON, dist: opts.dist ?? landingDist(radius), yaw: 0, blend: 0 });
  }
  await within(G.frames(3), 60000);
  return Number((G.state() as { camera?: { altitude?: number } }).camera?.altitude ?? NaN);
}

async function runStep(S: BenchState, k: number, ready: Promise<void>, prog: Progress): Promise<BenchResult> {
  const vi = S.order[k], v = S.variants[vi];
  const rep = S.order.slice(0, k).filter((x) => x === vi).length;
  const res: BenchResult = { step: k, variant: vi, rep, label: v.label, params: v.params, ok: false, build: BUILD_STAMP, at: iso() };
  const n = S.order.length;
  const settle = settleFor(S, v);
  const avgLoad = S.results.length ? S.loadSum / S.results.length : 25;
  const left = (extra: number) => mmss(extra + estimateSeconds(S, S.order, k + 1, avgLoad));
  const head = `BENCH ${S.name} · step ${k + 1} of ${n} · rep ${rep + 1}/${S.opts.reps} · ${v.label}`;
  document.title = `BENCH ${k + 1}/${n} ${v.label}`;
  prog.set(`${head} · loading the world · about ${left(settle + S.opts.rec)} left`);

  let lost = false;
  document.getElementById('game')?.addEventListener('webglcontextlost', () => { lost = true; });
  const r = await within(ready.then(() => 'ok' as const, (e: unknown) => `the world did not begin: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`), S.opts.load * 1000);
  res.loadS = Math.round(performance.now() / 100) / 10;
  if (r === 'timeout') { res.fail = `not loaded after ${S.opts.load} s${fatalText() ? ` (${fatalText()})` : ''}`; return res; }
  if (r !== 'ok') { res.fail = r; return res; }
  const G = (window as unknown as { __GENESIS__?: Surface }).__GENESIS__;
  if (!G) { res.fail = 'no automation surface'; return res; }
  try { res.alt = await placeCamera(G, S.opts); } catch (e) { res.fail = `camera: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`; return res; }

  // (a page in the background draws nothing: the step waits for the window to come back before it counts anything)
  while (document.hidden) { prog.set(`${head} · WAITING: this window is hidden — bring it to the front`); await sleep(500); }
  const watch = new Watch(S.opts.focus);
  res.tc0 = tcstatOf(perfSwitchLine());
  const t0 = performance.now();
  watch.start();
  for (;;) {
    const s = settle - (performance.now() - t0) / 1000;
    if (s <= 0) break;
    prog.set(`${head} · settling ${Math.ceil(s)} s · about ${left(s + S.opts.rec)} left`);
    await sleep(Math.min(1000, s * 1000));
  }
  const settleBad = watch.stop();
  res.settleS = Math.round((performance.now() - t0) / 100) / 10;
  res.tc1 = tcstatOf(perfSwitchLine());

  // the recording: this window's own requestAnimationFrame intervals, and the perf report over the same seconds
  // (the progress line is written once and left alone until the window ends). An interval is the wall time between
  // two callbacks, not the difference of their frame timestamps: after a frame that held the main thread for seconds
  // the browser hands out timestamps a few ms apart (seen on SwiftShader: one "66.7 ms" interval in a 20 s window)
  prog.set(`${head} · RECORDING ${S.opts.rec} s — do not touch · about ${left(S.opts.rec)} left`);
  const iv: number[] = [];
  let last = 0, first = 0, on = true;
  const tick = () => { if (!on) return; const t = performance.now(); if (last > 0) iv.push(t - last); else first = t; last = t; requestAnimationFrame(tick); };
  watch.start();
  const t1 = performance.now();
  requestAnimationFrame(tick);
  const recMs = S.opts.rec * 1000;
  const report = within(G.perfReport(recMs), recMs + 30000);
  await sleep(recMs);
  on = false;
  const span = first > 0 ? performance.now() - first : 0;
  res.recS = Math.round((performance.now() - t1) / 100) / 10;
  const recBad = watch.stop();
  res.tc2 = tcstatOf(perfSwitchLine());
  prog.set(`${head} · writing the report`);
  let text = await report;
  // (no frame ended the report in time: stop it by hand; its GPU timer results take a moment)
  if (text === 'timeout') { try { perfmon.recorder.stop(); } catch { /* none */ } await sleep(400); text = perfmon.recorder.report || ''; }
  const fs = frameStats(iv, span);
  res.fps = fs.fps; res.p50 = fs.p50; res.p95 = fs.p95; res.frames = fs.frames;
  if (text) {
    const p = parseReport(text);
    res.report = text;
    res.rfps = p.fps; res.rp50 = p.p50; res.rp95 = p.p95; res.mainMs = p.mainMs;
    res.fixes = p.fixes; res.heapMB = p.heapMB; res.heapOwners = p.heapOwners; res.gpu = p.gpu; res.canvas = p.canvas;
    if (p.tcstat) res.tc2 = p.tcstat;
  }
  if (!res.fixes) res.fixes = perfSwitchLine();
  if (res.heapMB == null) {
    const pm = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (pm) res.heapMB = Math.round(pm.usedJSHeapSize / 1e6);
  }
  res.at = iso();
  const fatal = fatalText();
  if (lost) { res.fail = 'the WebGL context was lost'; return res; }
  if (fatal) { res.fail = fatal; return res; }
  if (!fs.frames) { res.fail = 'no frames in the window'; return res; }
  res.ok = true;
  const bad = recBad ? `${recBad} during the recording` : settleBad ? `${settleBad} during the settle time` : '';
  if (bad) res.invalid = bad;
  return res;
}

function nextSearch(S: BenchState): string {
  if (S.done || S.step >= S.order.length) return stepSearch(S.base, { label: '', params: '' }, S.opts.preset, S.run, 'done');
  return stepSearch(S.base, S.variants[S.order[S.step]], S.opts.preset, S.run, S.step);
}

function finishStep(S: BenchState, res: BenchResult): void {
  S.results.push(res);
  S.loadSum += res.loadS ?? 0;
  S.step = res.step + 1;
  S.started = -1;
  if (S.step >= S.order.length) { S.done = true; S.endedAt = iso(); }
  save(S);
  goto(nextSearch(S));
}

// ── the results page ──

function download(name: string, text: string): void {
  const a = el('a', 'display:none');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function fileName(run: BenchRun): string {
  const build = (run.results.find((r) => r.build)?.build ?? 'build').split(' ')[0].replace(/[^A-Za-z0-9+._-]+/g, '');
  return `genesis-bench-${run.name.replace(/[^A-Za-z0-9._-]+/g, '_')}-${build}-${run.startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 13)}.txt`;
}

function showMessage(title: string, lines: string[], launch?: string): void {
  hideBoot();
  const root = el('div', `${FONT}position:fixed;inset:0;z-index:2147483000;overflow:auto;padding:28px;color:#e9f1ff;background:#0a101c;`);
  root.id = 'bench-results';
  root.append(el('h1', 'font:600 20px/1.3 system-ui,sans-serif;margin:0 0 12px;', title));
  for (const l of lines) root.append(el('div', 'margin:3px 0;white-space:pre-wrap;', l));
  if (launch) { const a = el('a', 'color:#9cc4ff;display:inline-block;margin-top:14px;', 'Start the run again'); a.href = launch; root.append(a); }
  document.body.appendChild(root);
}

function showResults(run: BenchRun, text: string, autoDownload: boolean): void {
  hideBoot();
  document.title = run.aborted ? 'BENCH ABORTED' : 'BENCH DONE';
  const root = el('div', `${FONT}position:fixed;inset:0;z-index:2147483000;overflow:auto;padding:22px 26px;color:#e9f1ff;background:#0a101c;box-sizing:border-box;`);
  root.id = 'bench-results';
  const R = run.results;
  root.append(el('h1', 'font:600 20px/1.3 system-ui,sans-serif;margin:0 0 4px;', `GENESIS bench: ${run.name}${run.aborted ? ' (ABORTED)' : ''}`));
  root.append(el('div', 'color:#9fb3cf;margin-bottom:12px;', `${run.variants.length} variants x ${run.opts.reps} repeats · ${R.length} of ${run.order.length} steps run · build ${[...new Set(R.map((r) => r.build).filter(Boolean))].join(' / ') || '?'} · ${run.startedAt} to ${run.endedAt}`));

  const bar = el('div', 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;');
  const dl = el('button', BTN, 'Download results (.txt)');
  dl.id = 'bench-download';
  dl.addEventListener('click', () => download(fileName(run), text));
  const cp = el('button', BTN, 'Copy');
  cp.id = 'bench-copy';
  const note = el('span', 'color:#9fb3cf;');
  const again = el('a', 'color:#9cc4ff;', 'Run again');
  again.href = run.launch;
  bar.append(dl, cp, again, note);
  root.append(bar);

  const W = benchWarnings(run);
  if (W.length) {
    const box = el('div', 'border:1px solid #c49a3c;background:#2a2210;color:#ffe2a1;border-radius:6px;padding:8px 12px;margin-bottom:14px;');
    box.id = 'bench-warnings';
    for (const w of W) box.append(el('div', 'white-space:pre-wrap;', w));
    root.append(box);
  }

  const TH = 'text-align:right;padding:4px 10px;border-bottom:1px solid #47648e;color:#9fb3cf;font-weight:600;';
  const TD = 'text-align:right;padding:4px 10px;border-bottom:1px solid #1c2a40;';
  const tbl = el('table', 'border-collapse:collapse;margin-bottom:8px;');
  tbl.id = 'bench-table';
  const hr = el('tr', '');
  for (const [i, h] of ['variant', 'n', 'fps median', 'min', 'max', 'p50 ms median', 'min', 'max', 'p95 med', 'main ms', 'x first', 'params'].entries()) hr.append(el('th', TH + (i === 0 || i === 11 ? 'text-align:left;' : ''), h));
  tbl.append(hr);
  const n = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '-' : String(x));
  for (const r of aggregate(run.variants, R, run.opts.reps)) {
    const tr = el('tr', '');
    const cells = [r.label, `${r.n}/${r.planned}`, n(r.fps?.med), n(r.fps?.min), n(r.fps?.max), n(r.p50?.med), n(r.p50?.min), n(r.p50?.max), n(r.p95med), n(r.mainMed), n(r.vsFirst), r.params || '(none)'];
    for (const [i, c] of cells.entries()) tr.append(el('td', TD + (i === 0 || i === 11 ? 'text-align:left;' : '') + (i === 2 || i === 5 ? 'color:#fff;font-weight:700;' : '') + (i === 1 && r.n < r.planned ? 'color:#ffb37a;' : ''), c));
    tbl.append(tr);
  }
  root.append(tbl);
  root.append(el('div', 'color:#9fb3cf;margin-bottom:12px;', 'fps = frames over the recording window, p50 = median ms between requestAnimationFrame callbacks; per variant across its valid repeats (n). Failed and invalid steps are left out.'));
  root.append(el('div', 'margin-bottom:14px;white-space:pre-wrap;', `order run: ${R.map((r) => `${r.label}${!r.ok ? ' [FAILED]' : r.invalid ? ' [INVALID]' : ''}`).join('  ·  ')}`));

  const pre = el('textarea', `${FONT}display:block;width:100%;height:60vh;box-sizing:border-box;color:#d5e2f5;background:#060a12;border:1px solid #2b3d5c;border-radius:6px;padding:10px;white-space:pre;overflow:auto;resize:vertical;`);
  pre.id = 'bench-text';
  pre.readOnly = true;
  pre.wrap = 'off';
  pre.value = text;
  root.append(pre);
  cp.addEventListener('click', () => {
    const fallback = () => { pre.focus(); pre.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } note.textContent = ok ? 'copied' : 'the text is selected: press Cmd+C'; };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => { note.textContent = 'copied'; }, fallback); else fallback();
  });
  document.body.appendChild(root);
  if (autoDownload) { try { download(fileName(run), text); note.textContent = 'the results file was downloaded'; } catch { /* the button is there */ } }
}

// ── boot ──

/**
 * main.ts calls this when the URL has `bench=`. 'run': the world boots and this page runs a step on it; 'stop': this
 * page shows a panel or is on its way to another URL, and boots no world.
 */
export function benchBoot(ready: Promise<void>): 'run' | 'stop' {
  const q = new URLSearchParams(location.search);
  const stepArg = q.get('bstep');
  let S = load();

  // the last finished run's text, kept across tabs (`?bench=last`)
  if (q.get('bench') === 'last' && stepArg == null) {
    let text = '';
    try { text = localStorage.getItem(LAST_KEY) ?? ''; } catch { text = ''; }
    showMessage('GENESIS bench: the last finished run', text ? text.split('\n') : ['No finished run is stored in this browser.']);
    return 'stop';
  }

  // the launch page: write the plan, go to step 1
  if (stepArg == null) {
    const plan = parseBench(location.search);
    if (!plan.variants.length) { showMessage('GENESIS bench: nothing to run', plan.errors); return 'stop'; }
    const order = stepOrder(plan.variants.length, plan.opts.reps, plan.opts.order);
    S = {
      v: 1, run: Math.floor(performance.timeOrigin).toString(36), name: plan.name, launch: location.href, base: plan.base, variants: plan.variants, opts: plan.opts, order,
      step: 0, started: -1, results: [], startedAt: iso(), endedAt: '', done: false, aborted: false, downloaded: false, loadSum: 0, ua: navigator.userAgent.replace(/\s+/g, ' ').slice(0, 200),
    };
    save(S);
    if (!load()) { showMessage('GENESIS bench: cannot run here', ['This browser gives the page no session storage (a private window with storage blocked?): the bench keeps its plan and results there.']); return 'stop'; }
    const s0 = S;
    showMessage(`GENESIS bench: ${plan.name}`, [
      `${plan.variants.length} variants x ${plan.opts.reps} repeats = ${order.length} steps, about ${mmss(estimateSeconds(s0, order))}.`,
      'Keep this window in front and do not touch it until the results page appears.',
      ...plan.errors.map((e) => `note: ${e}`),
      '', 'Starting…',
    ]);
    setTimeout(() => goto(nextSearch(s0)), 1500);
    return 'stop';
  }

  if (!S || S.run !== q.get('brun')) {
    showMessage('GENESIS bench: this run is not in this tab', ['A bench keeps its plan and results in the tab that started it. Open the launch link again to start a run.'], S?.launch);
    return 'stop';
  }
  const run = S;
  if (stepArg === 'done' || run.done) {
    if (!run.done) { run.done = true; run.endedAt = run.endedAt || iso(); }
    const r = runOf(run);
    const text = resultsText(r);
    const auto = run.opts.auto && !run.downloaded && run.results.length > 0;
    run.downloaded = true;
    save(run);
    try { localStorage.setItem(LAST_KEY, text); } catch { /* the page has it */ }
    showResults(r, text, auto);
    return 'stop';
  }
  const k = Number(stepArg);
  if (!Number.isInteger(k) || k !== run.step) { goto(nextSearch(run)); return 'stop'; }
  if (run.started === k) {
    // this step was already in flight: the page was reloaded, or the tab crashed and came back
    const vi = run.order[k], v = run.variants[vi];
    finishStep(run, { step: k, variant: vi, rep: run.order.slice(0, k).filter((x) => x === vi).length, label: v.label, params: v.params, ok: false, fail: 'the page was reloaded or crashed during the step', build: BUILD_STAMP, at: iso() });
    return 'stop';
  }
  run.started = k;
  save(run);

  let over = false;
  const prog = new Progress(() => {
    if (over) return;
    over = true;
    run.aborted = true; run.done = true; run.started = -1; run.endedAt = iso();
    save(run);
    goto(nextSearch(run));
  });
  // (a long run: ask the display to stay awake; a sleeping display hides the page and voids the step)
  try { void (navigator as unknown as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen').catch(() => { /* not granted */ }); } catch { /* none */ }
  void runStep(run, k, ready, prog).then(
    (res) => { if (!over) { over = true; finishStep(run, res); } },
    (e: unknown) => {
      if (over) return;
      over = true;
      const vi = run.order[k], v = run.variants[vi];
      finishStep(run, { step: k, variant: vi, rep: run.order.slice(0, k).filter((x) => x === vi).length, label: v.label, params: v.params, ok: false, fail: `bench error: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, build: BUILD_STAMP, at: iso() });
    },
  );
  return 'run';
}
