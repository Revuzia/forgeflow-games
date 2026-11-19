// GENESIS — the automated benchmark's plan and numbers (`?bench=`; the runner and its panel are ui/benchpanel.ts).
//
// A Mac test round used to be 8-16 URLs opened by hand, each landed, settled and recorded by hand; and since the Mac's
// numbers swing 2-3x with the machine's load, single runs said little. `?bench=<plan>` runs a list of VARIANTS (a label
// and a query-string fragment of perf switches) INTERLEAVED and repeated (A B C A B C ...): every step is a page load
// (the switches are read at load, perfswitch.ts), the standard landing, a settle time, a recording window; the end is
// one results text. This file is the pure part (no DOM, no clock): plans and their URL encodings, the step order, a
// step's URL, what is read out of a perf report, the per-variant median / min / max, and the results text.
// Ledger and the owner's instructions: _harness/arc-work/BENCH.md.

export interface BenchVariant {
  label: string;
  /** a query-string fragment ('scene=0&shadows=0'; '' = nothing changed) laid over the run's base parameters */
  params: string;
}

export interface BenchOpts {
  /** interleaved repeats of the whole variant list */
  reps: number;
  /** seconds between the landing and the recording */
  settle: number;
  /** the same for variants with tcache=1 (the cache has to fill) */
  settleTc: number;
  /** seconds recorded */
  rec: number;
  /** seconds a step may take to load its world before it is recorded as failed */
  load: number;
  /** the quality preset every step is forced to (unless a variant names its own `quality=`) */
  preset: string;
  /** 'seq' = A B C A B C; 'rot' = each repeat starts one variant later (A B C, B C A, C A B) */
  order: 'seq' | 'rot';
  /** a step whose window lost the keyboard focus is invalid (a hidden page always is) */
  focus: boolean;
  /** the orbit camera's distance at the landing (m); null = the hand protocol's wheel zoom (BENCH_WHEEL) */
  dist: number | null;
  /** a whole camera spec (JSON of app.ts CameraSpec) in place of the standard landing; '' = none */
  cam: string;
  /** the results file downloads by itself when the run ends (once) */
  auto: boolean;
}

export interface BenchPlan {
  name: string;
  variants: BenchVariant[];
  opts: BenchOpts;
  /** the launch URL's own parameters (scenario, seed, any switch for every step), bench bookkeeping removed */
  base: string;
  /** what was wrong with the URL (an empty plan runs nothing and says why) */
  errors: string[];
}

/** one step's outcome (kept in sessionStorage between page loads) */
export interface BenchResult {
  step: number;
  variant: number;
  rep: number;
  label: string;
  params: string;
  /** the step loaded and recorded */
  ok: boolean;
  /** why not (a load timeout, a crash, a reload) */
  fail?: string;
  /** recorded, but not to be trusted: the page was hidden or lost the focus (left out of the summary) */
  invalid?: string;
  /** from the wall time between requestAnimationFrame callbacks over the window (the numbers the summary uses) */
  fps?: number; p50?: number; p95?: number; frames?: number;
  /** the perf report's own HEADLINE over the same window */
  rfps?: number; rp50?: number; rp95?: number; mainMs?: number;
  fixes?: string;
  /** the terrain cache's stat line at the landing, at the start and at the end of the recording */
  tc0?: string; tc1?: string; tc2?: string;
  heapMB?: number;
  heapOwners?: string;
  gpu?: string;
  canvas?: string;
  alt?: number;
  build?: string;
  /** when the step ended (ISO, UTC) */
  at?: string;
  loadS?: number;
  settleS?: number;
  recS?: number;
  report?: string;
}

/** the hand protocol's world (MAC-TEST-PROTOCOL.md, PERF.md's lead notes) */
export const BENCH_WORLD = 'scenario=babel&seed=307987276';
/**
 * the hand protocol's landing: from the boot camera (orbit over 18 N / 35 W), the wheel 4 x 10 ticks in and 2 back out.
 * Chrome sends a 10-tick scroll as one deltaY of -800 (Mac round 3) and a tick as 80; the orbit camera's distance
 * takes exp(0.0013 deltaY) (render/camera/orbit.ts).
 */
export const BENCH_WHEEL = 4 * -800 + 2 * 80;
export const BENCH_ZOOM = 0.0013;
export const BENCH_LAT = 18, BENCH_LON = -35;
/** the boot camera's distance in planet radii (app.ts start) */
export const BENCH_BOOT_DIST = 2.6;

/** the orbit distance of the standard landing on a planet of radius R (m) */
export function landingDist(radius: number, wheel = BENCH_WHEEL): number {
  return Math.max(2, radius * BENCH_BOOT_DIST * Math.exp(wheel * BENCH_ZOOM));
}

const P = 'scene=0&shadows=0';
const FIX = 'tcache=1&wfast=3&deepbed=1';

/** the built-in plans: the open questions of the current rounds (PERF.md's newest lead notes) */
export const BENCH_PLANS: Record<string, BenchVariant[]> = {
  // water alone (P = no scene pass, no shadows): the fast water, its SSR, the fragment's ceiling, no water at all
  water: [
    { label: 'P', params: P },
    { label: 'P+wfast3', params: `${P}&wfast=3` },
    { label: 'P+wfast3+nossr', params: `${P}&wfast=3&wshade3=nossr` },
    { label: 'P+wfrag0', params: `${P}&wfrag=0` },
    { label: 'P+water0', params: `${P}&water=0` },
  ],
  // the full game: the terrain cache, the combined fix, and what is left of the frame under it (one cut each)
  terrain: [
    { label: 'N', params: '' },
    { label: 'N+tcache', params: 'tcache=1' },
    { label: 'FIX', params: FIX },
    { label: 'FIX+water0', params: `${FIX}&water=0` },
    { label: 'FIX+shadows0', params: `${FIX}&shadows=0` },
    { label: 'FIX+msaa0', params: `${FIX}&msaa=0` },
    { label: 'FIX+hide', params: `${FIX}&hide=veg,cover,life` },
    { label: 'FIX+P', params: `${FIX}&${P}` },
    { label: 'FIX+rscale.5', params: `${FIX}&rscale=0.5` },
  ],
  // the full game as shipped against every fix
  full: [
    { label: 'N', params: '' },
    { label: 'FIX', params: FIX },
  ],
  // the same thing twice: how far apart two runs of ONE build are on this machine right now
  noise: [
    { label: 'N-a', params: '' },
    { label: 'N-b', params: '' },
  ],
};

export const BENCH_DEFAULTS: BenchOpts = { reps: 3, settle: 30, settleTc: 60, rec: 15, load: 240, preset: 'ultra', order: 'seq', focus: true, dist: null, cam: '', auto: true };

/** the launch URL's parameters that belong to the bench (everything else is the steps' base) */
export const BENCH_KEYS = ['bench', 'bv', 'breps', 'bsettle', 'bsettletc', 'brec', 'bload', 'bpreset', 'border', 'bfocus', 'bdist', 'bcam', 'bauto', 'bstep', 'brun'];

// ── encodings ──

function cleanLabel(s: string): string { return s.replace(/[|~\s]+/g, ' ').trim().slice(0, 48); }
function cleanParams(s: string): string {
  // (a fragment as typed: a leading ? or &, spaces, empty pairs)
  return s.trim().replace(/^[?&]+/, '').split('&').map((x) => x.trim()).filter(Boolean).join('&');
}

/**
 * The typed list of `bv=`: variants separated by `|`, each `label~params` (no `~`: the parameters are the label; no
 * parameters: the unchanged game). Inside the parameters `;` stands for `&` and `:` for `=`, so a list needs no
 * percent-encoding: `bv=N~|fast~wfast:3;wshade3:nossr|nowater~water:0`. A literal `&` / `=` (percent-encoded in the
 * URL as %26 / %3D) means the same.
 */
export function parseVariantList(bv: string): BenchVariant[] {
  const out: BenchVariant[] = [];
  for (const part of bv.split('|')) {
    if (!part.trim()) continue;
    const i = part.indexOf('~');
    const raw = cleanParams((i >= 0 ? part.slice(i + 1) : part).replace(/;/g, '&').replace(/:/g, '='));
    // (a bare word without '=' and without '~' is a label for the unchanged game: `bv=N|x~a:1`)
    const bare = i < 0 && !raw.includes('=');
    const label = cleanLabel(i >= 0 ? part.slice(0, i) : part) || (raw ? raw : 'N');
    out.push({ label, params: bare ? '' : raw });
  }
  return uniqueLabels(out);
}

/** the typed list back from variants (the inverse of parseVariantList; the value still goes through encodeURIComponent) */
export function encodeVariantList(vs: BenchVariant[]): string {
  return vs.map((v) => `${cleanLabel(v.label)}~${cleanParams(v.params).replace(/&/g, ';').replace(/=/g, ':')}`).join('|');
}

function uniqueLabels(vs: BenchVariant[]): BenchVariant[] {
  const seen = new Map<string, number>();
  return vs.map((v) => {
    const n = (seen.get(v.label) ?? 0) + 1;
    seen.set(v.label, n);
    return n > 1 ? { label: `${v.label}#${n}`, params: v.params } : v;
  });
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(text: string): string | null {
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

/** a plan as JSON in the URL: a list of [label, params] pairs or { label, params } objects, or { name?, variants, reps?, settle?, settleTc?, rec?, base? } */
export interface BenchJson { name?: string; variants: BenchVariant[]; reps?: number; settle?: number; settleTc?: number; rec?: number; base?: string }

function variantsOf(list: unknown): BenchVariant[] | null {
  if (!Array.isArray(list)) return null;
  const out: BenchVariant[] = [];
  for (const x of list) {
    if (Array.isArray(x) && typeof x[0] === 'string') out.push({ label: cleanLabel(x[0]) || 'N', params: cleanParams(typeof x[1] === 'string' ? x[1] : '') });
    else if (x && typeof x === 'object' && typeof (x as BenchVariant).label === 'string') out.push({ label: cleanLabel((x as BenchVariant).label) || 'N', params: cleanParams(String((x as BenchVariant).params ?? '')) });
    else if (typeof x === 'string') out.push({ label: cleanLabel(x) || 'N', params: cleanParams(x) });
    else return null;
  }
  return uniqueLabels(out);
}

/** JSON text (a list, or an object with `variants`) → the plan it holds, or null */
export function parsePlanJson(text: string): BenchJson | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (Array.isArray(j)) { const v = variantsOf(j); return v ? { variants: v } : null; }
  if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>;
    const v = variantsOf(o.variants);
    if (!v) return null;
    const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) ? (o[k] as number) : undefined);
    return { name: typeof o.name === 'string' ? cleanLabel(o.name) : undefined, variants: v, reps: num('reps'), settle: num('settle'), settleTc: num('settleTc'), rec: num('rec'), base: typeof o.base === 'string' ? cleanParams(o.base) : undefined };
  }
  return null;
}

/** `?bench=<this>`: a plan as base64url of its JSON (no character a chat or a mail client breaks a link at) */
export function encodePlan(plan: BenchJson | BenchVariant[]): string {
  const j = Array.isArray(plan) ? plan.map((v) => [v.label, v.params]) : { ...plan, variants: plan.variants.map((v) => [v.label, v.params]) };
  return b64urlEncode(JSON.stringify(j));
}

/** the value of `?bench=` that is not a plan's name: JSON as typed, or base64url of JSON */
export function decodePlan(value: string): BenchJson | null {
  const v = value.trim();
  if (v.startsWith('[') || v.startsWith('{')) return parsePlanJson(v);
  if (!/^[A-Za-z0-9_-]{8,}$/.test(v)) return null;
  const text = b64urlDecode(v);
  return text ? parsePlanJson(text) : null;
}

// ── the launch URL ──

/** the whole launch URL's search string → the plan, its timings and the steps' base parameters */
export function parseBench(search: string): BenchPlan {
  const p = new URLSearchParams(search);
  const errors: string[] = [];
  const value = (p.get('bench') ?? '').trim();
  const num = (k: string, d: number, lo: number, hi: number) => {
    const raw = p.get(k);
    const v = Number(raw);
    if (raw == null || raw === '') return d;
    if (!Number.isFinite(v)) { errors.push(`${k}=${raw} is not a number (using ${d})`); return d; }
    return Math.min(hi, Math.max(lo, v));
  };
  let name = value;
  let variants: BenchVariant[] = [];
  let json: BenchJson | null = null;
  const lower = value.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(BENCH_PLANS, lower)) { name = lower; variants = BENCH_PLANS[lower].map((v) => ({ ...v })); }
  else if (lower === 'custom' || lower === '' || lower === '1') { name = 'custom'; if (!p.get('bv')) errors.push('bench=custom needs a list: &bv=label~a:1;b:2|label2~...'); }
  else {
    json = decodePlan(value);
    if (json) { name = json.name || 'custom'; variants = json.variants; }
    else errors.push(`unknown plan '${value.slice(0, 40)}' (plans: ${Object.keys(BENCH_PLANS).join(', ')}, custom + bv=, or base64url JSON)`);
  }
  // (`bv=` on top of a named plan adds variants to it)
  const bv = p.get('bv');
  if (bv) variants = uniqueLabels([...variants, ...parseVariantList(bv)]);
  if (!variants.length && !errors.length) errors.push('the plan has no variants');

  const settleGiven = p.has('bsettle') || json?.settle != null;
  const settle = num('bsettle', json?.settle ?? BENCH_DEFAULTS.settle, 0, 3600);
  // (tcache variants: twice the settle time, 60 s by default, unless bsettletc says otherwise)
  const settleTc = num('bsettletc', json?.settleTc ?? (settleGiven ? 2 * settle : BENCH_DEFAULTS.settleTc), 0, 3600);
  const base = new URLSearchParams(search);
  for (const k of BENCH_KEYS) base.delete(k);
  if (json?.base) for (const [k, v] of new URLSearchParams(json.base)) if (!base.has(k)) base.set(k, v);
  if (!base.has('scenario') && !base.has('load')) for (const [k, v] of new URLSearchParams(BENCH_WORLD)) base.set(k, v);
  const bq = base.get('quality');
  const preset = (p.get('bpreset') ?? bq ?? BENCH_DEFAULTS.preset).toLowerCase();
  base.delete('quality');
  const dist = p.has('bdist') ? num('bdist', 0, 2, 6e6) : null;
  let cam = p.get('bcam') ?? '';
  if (cam) { try { const c = JSON.parse(cam) as unknown; if (!c || typeof c !== 'object') throw new Error('not an object'); } catch (e) { errors.push(`bcam is not a JSON camera spec (${String(e)}): the standard landing is used`); cam = ''; } }
  const opts: BenchOpts = {
    reps: Math.round(num('breps', json?.reps ?? BENCH_DEFAULTS.reps, 1, 50)),
    settle, settleTc,
    rec: num('brec', json?.rec ?? BENCH_DEFAULTS.rec, 0.5, 600),
    load: num('bload', BENCH_DEFAULTS.load, 5, 3600),
    preset,
    order: p.get('border') === 'rot' ? 'rot' : 'seq',
    focus: p.get('bfocus') === '1', // lead, after Mac round 21: a window behind other apps still renders; only a HIDDEN page invalidates by default
    dist: dist || null,
    cam,
    auto: p.get('bauto') !== '0',
  };
  return { name, variants, opts, base: base.toString().replace(/%2C/gi, ','), errors };
}

/** the variant of every step, in the order run: interleaved repeats */
export function stepOrder(nVariants: number, reps: number, mode: 'seq' | 'rot' = 'seq'): number[] {
  const out: number[] = [];
  for (let r = 0; r < reps; r++) for (let i = 0; i < nVariants; i++) out.push(mode === 'rot' ? (i + r) % nVariants : i);
  return out;
}

/** does a variant (over the base) run with the terrain cache on? (the longer settle time) */
export function usesTcache(base: string, v: BenchVariant): boolean {
  const q = new URLSearchParams(base);
  for (const [k, val] of new URLSearchParams(v.params)) q.set(k, val);
  return q.get('tcache') === '1';
}

/** a step's settle time (s) */
export function settleFor(plan: { base: string; opts: BenchOpts }, v: BenchVariant): number {
  return usesTcache(plan.base, v) ? plan.opts.settleTc : plan.opts.settle;
}

/**
 * A step's search string: the base, the variant's parameters over it, the forced preset (a variant's own `quality=`
 * wins), then the bench's bookkeeping (`bench=run`, the run's id, the step).
 */
export function stepSearch(base: string, v: BenchVariant, preset: string, run: string, step: number | 'done'): string {
  const q = new URLSearchParams(base);
  for (const [k, val] of new URLSearchParams(v.params)) q.set(k, val);
  if (!q.has('quality')) q.set('quality', preset);
  q.set('bench', 'run');
  q.set('brun', run);
  q.set('bstep', String(step));
  // (commas stay readable: the report's `switches` line prints the search string as it is)
  return '?' + q.toString().replace(/%2C/gi, ',');
}

/** a guess at the whole run's seconds (per step: the load, the settle, the recording), for the progress line */
export function estimateSeconds(plan: { base: string; opts: BenchOpts; variants: BenchVariant[] }, order: number[], from = 0, loadS = 25): number {
  let s = 0;
  for (let i = from; i < order.length; i++) s += loadS + settleFor(plan, plan.variants[order[i]]) + plan.opts.rec + 2;
  return s;
}

// ── numbers ──

const r1 = (x: number) => Math.round(x * 10) / 10;

/** percentile as the perf report takes it (perfreport.ts pct) */
export function percentile(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/**
 * fps and the interval percentiles of a window's frame intervals (ms between requestAnimationFrame callbacks).
 * `spanMs` = from the first callback to the end of the window: fps is then the frames counted over that time, so a
 * frame still in flight when the window closes counts as time without a frame (the mean of the finished intervals
 * alone forgets it: on SwiftShader one 198 ms interval and then an 18 s frame read as "5.1 fps"). Without it, or
 * when it is shorter than the intervals' own sum, fps = 1000 / the mean interval.
 */
export function frameStats(intervals: number[], spanMs = 0): { fps: number; p50: number; p95: number; frames: number } {
  const iv = intervals.filter((x) => Number.isFinite(x) && x > 0);
  if (!iv.length) return { fps: 0, p50: 0, p95: 0, frames: 0 };
  const span = Math.max(iv.reduce((a, b) => a + b, 0), Number.isFinite(spanMs) ? spanMs : 0);
  return { fps: r1((1000 * iv.length) / span), p50: r1(percentile(iv, 0.5)), p95: r1(percentile(iv, 0.95)), frames: iv.length };
}

export function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** `tcstat=...` out of the perf switch line ('' when the terrain cache is off or has not reported yet) */
export function tcstatOf(switchLine: string): string {
  const m = /(?:^|\s)tcstat=(\S+)/.exec(switchLine);
  return m ? m[1] : '';
}

/** what the bench keeps of a perf report's text (perfreport.ts compose) */
export function parseReport(text: string): { fps?: number; p50?: number; p95?: number; mainMs?: number; fixes?: string; tcstat?: string; heapMB?: number; heapOwners?: string; build?: string; gpu?: string; canvas?: string } {
  const out: ReturnType<typeof parseReport> = {};
  const h = /^HEADLINE: fps ([\d.]+) \| interval p50 ([\d.]+) p95 ([\d.]+) ms \| main ([\d.]+) ms\/frame/m.exec(text);
  if (h) { out.fps = Number(h[1]); out.p50 = Number(h[2]); out.p95 = Number(h[3]); out.mainMs = Number(h[4]); }
  const f = /^perf fixes \(A\/B switches, effective\): (.*)$/m.exec(text);
  if (f) { out.fixes = f[1].trim(); out.tcstat = tcstatOf(out.fixes); }
  const hp = /js heap (\d+) MB/.exec(text);
  if (hp) out.heapMB = Number(hp[1]);
  const ho = /^js heap by owner[^\n]*$/m.exec(text);
  if (ho) out.heapOwners = ho[0];
  const b = /· build (.+)$/m.exec(text.split('\n')[0] ?? '');
  if (b) out.build = b[1].trim();
  const g = /^gpu: (.*?) \| preset (\S+) \| canvas (.*?) \| dpr ([\d.]+)/m.exec(text);
  if (g) { out.gpu = g[1]; out.canvas = `${g[3]} dpr ${g[4]} preset ${g[2]}`; }
  return out;
}

export interface BenchRow {
  label: string;
  params: string;
  /** steps planned / run / ok and valid (the ones the numbers are of) */
  planned: number; run: number; n: number;
  failed: number; invalid: number;
  fps: { med: number; min: number; max: number } | null;
  p50: { med: number; min: number; max: number } | null;
  p95med: number | null;
  mainMed: number | null;
  /** median fps over the first variant's median fps */
  vsFirst: number | null;
}

const mmm = (a: number[]) => (a.length ? { med: r1(median(a)), min: r1(Math.min(...a)), max: r1(Math.max(...a)) } : null);

/** per variant: median / min / max of fps and of the interval's p50 across its valid repeats */
export function aggregate(variants: BenchVariant[], results: BenchResult[], reps: number): BenchRow[] {
  const rows: BenchRow[] = variants.map((v, i) => {
    const mine = results.filter((r) => r.variant === i);
    const good = mine.filter((r) => r.ok && !r.invalid && typeof r.fps === 'number' && (r.frames ?? 0) > 0);
    const main = good.map((r) => r.mainMs).filter((x): x is number => typeof x === 'number');
    return {
      label: v.label, params: v.params, planned: reps, run: mine.length, n: good.length,
      failed: mine.filter((r) => !r.ok).length, invalid: mine.filter((r) => r.ok && !!r.invalid).length,
      fps: mmm(good.map((r) => r.fps as number)), p50: mmm(good.map((r) => r.p50 as number)),
      p95med: good.length ? r1(median(good.map((r) => r.p95 as number))) : null,
      mainMed: main.length ? r1(median(main)) : null,
      vsFirst: null,
    };
  });
  const first = rows[0]?.fps?.med;
  if (first) for (const r of rows) if (r.fps) r.vsFirst = Math.round((r.fps.med / first) * 100) / 100;
  return rows;
}

// ── the results text ──

export interface BenchRun {
  name: string;
  launch: string;
  base: string;
  variants: BenchVariant[];
  opts: BenchOpts;
  order: number[];
  results: BenchResult[];
  /** ISO times */
  startedAt: string;
  endedAt: string;
  aborted: boolean;
  ua?: string;
}

/** rows as aligned text columns: numbers to the right, the `left` columns (words) to the left */
function table(rows: string[][], left: number[]): string[] {
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length)));
  return rows.map((r) => r.map((x, c) => (left.includes(c) ? (x ?? '').padEnd(w[c]) : (x ?? '').padStart(w[c]))).join('  ').trimEnd());
}
const num = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '-' : String(x));

/** a window with fewer frame intervals than this is too short to say much (a warning, not a failure) */
export const BENCH_FEW_FRAMES = 10;

/** things about a finished run that make its numbers doubtful, in words */
export function benchWarnings(run: BenchRun): string[] {
  const W: string[] = [];
  const R = run.results;
  if (run.aborted) W.push(`ABORTED after ${R.length} of ${run.order.length} steps`);
  const failed = R.filter((r) => !r.ok), invalid = R.filter((r) => r.ok && r.invalid);
  if (failed.length) W.push(`${failed.length} step(s) FAILED: ${failed.map((r) => `#${r.step + 1} ${r.label} (${r.fail ?? '?'})`).join('; ')}`);
  if (invalid.length) W.push(`${invalid.length} step(s) INVALID, left out of the summary: ${invalid.map((r) => `#${r.step + 1} ${r.label} (${r.invalid})`).join('; ')}`);
  const few = R.filter((r) => r.ok && !r.invalid && (r.frames ?? 0) < BENCH_FEW_FRAMES);
  if (few.length) W.push(`${few.length} step(s) with fewer than ${BENCH_FEW_FRAMES} frames in the window (use a longer brec): ${few.map((r) => `#${r.step + 1} ${r.label} (${r.frames ?? 0})`).join('; ')}`);
  const uniq = (k: 'build' | 'canvas' | 'gpu') => [...new Set(R.filter((r) => r.ok && r[k]).map((r) => r[k] as string))];
  if (uniq('build').length > 1) W.push(`the build CHANGED during the run: ${uniq('build').join(' / ')}`);
  // (rscale and msaa change the render size inside the canvas line: only the canvas's own size is compared)
  const sizes = [...new Set(uniq('canvas').map((c) => c.split(' ')[0]))];
  if (sizes.length > 1) W.push(`the canvas size CHANGED during the run (window resized?): ${sizes.join(' / ')}`);
  const alts = R.filter((r) => r.ok && typeof r.alt === 'number').map((r) => r.alt as number);
  if (alts.length && Math.max(...alts) - Math.min(...alts) > 1) W.push(`the landing altitude differs between steps: ${r1(Math.min(...alts))} - ${r1(Math.max(...alts))} m`);
  return W;
}

/** the one results file: the summary table, the order run, failures, then every step's raw perf report */
export function resultsText(run: BenchRun): string {
  const L: string[] = [];
  const R = run.results;
  const builds = [...new Set(R.map((r) => r.build).filter(Boolean))];
  const o = run.opts;
  L.push(`GENESIS BENCH · plan ${run.name} · ${run.variants.length} variants x ${o.reps} repeats = ${run.order.length} steps (${R.length} run) · build ${builds.join(' / ') || '?'}`);
  L.push(`started ${run.startedAt} · ended ${run.endedAt} · preset ${o.preset} · settle ${o.settle} s (tcache ${o.settleTc} s) · record ${o.rec} s · order ${o.order}${run.aborted ? ' · ABORTED' : ''}`);
  L.push(`launch: ${run.launch}`);
  L.push(`base: ${run.base || '(none)'}`);
  const firstOk = R.find((r) => r.ok);
  if (firstOk?.gpu) L.push(`gpu: ${firstOk.gpu} | canvas ${firstOk.canvas ?? '?'}`);
  if (run.ua) L.push(`ua: ${run.ua}`);
  L.push('');
  const W = benchWarnings(run);
  L.push(W.length ? 'WARNINGS:' : 'WARNINGS: none');
  for (const w of W) L.push(`  - ${w}`);
  L.push('');
  L.push('SUMMARY (per variant across its valid repeats; fps = frames over the window, p50 = median ms between requestAnimationFrame callbacks):');
  const rows = aggregate(run.variants, R, o.reps);
  L.push(...table([
    ['variant', 'n', 'fps med', 'min', 'max', 'p50 ms med', 'min', 'max', 'p95 med', 'main ms', 'x first', 'params'],
    ...rows.map((r) => [r.label, `${r.n}/${r.planned}`, num(r.fps?.med), num(r.fps?.min), num(r.fps?.max), num(r.p50?.med), num(r.p50?.min), num(r.p50?.max), num(r.p95med), num(r.mainMed), num(r.vsFirst), r.params || '(none)']),
  ], [0, 11]).map((x) => '  ' + x));
  L.push('');
  L.push('STEPS in the order run (raf = this page\'s own requestAnimationFrame callbacks; report = the perf report\'s HEADLINE over the same window):');
  L.push(...table([
    ['#', 'rep', 'variant', 'status', 'raf fps', 'p50', 'p95', 'frames', 'report fps', 'p50', 'p95', 'main ms', 'heap MB', 'alt m', 'load s', 'ended (UTC)'],
    ...R.map((r) => [String(r.step + 1), String(r.rep + 1), r.label, !r.ok ? `FAILED: ${r.fail ?? '?'}` : r.invalid ? `INVALID: ${r.invalid}` : 'ok',
      num(r.fps), num(r.p50), num(r.p95), num(r.frames), num(r.rfps), num(r.rp50), num(r.rp95), num(r.mainMs), num(r.heapMB), num(r.alt == null ? null : r1(r.alt)), num(r.loadS), (r.at ?? '').slice(11, 19)]),
  ], [2, 3]).map((x) => '  ' + x));
  const tc = R.filter((r) => r.tc0 || r.tc1 || r.tc2);
  if (tc.length) {
    L.push('');
    L.push('TERRAIN CACHE (tcstat at the landing / at the start of the recording / at its end):');
    for (const r of tc) { L.push(`  #${r.step + 1} ${r.label}`); L.push(`    landing: ${r.tc0 || '-'}`); L.push(`    start:   ${r.tc1 || '-'}`); L.push(`    end:     ${r.tc2 || '-'}`); }
  }
  L.push('');
  L.push('RAW REPORTS (every step, in the order run)');
  for (const r of R) {
    L.push('');
    L.push(`===== step ${r.step + 1} of ${run.order.length} · rep ${r.rep + 1} · ${r.label} · ${r.params || '(none)'} · ${!r.ok ? `FAILED: ${r.fail ?? '?'}` : r.invalid ? `INVALID: ${r.invalid}` : 'ok'} =====`);
    if (r.ok) L.push(`bench: raf fps ${num(r.fps)} | interval p50 ${num(r.p50)} p95 ${num(r.p95)} ms | ${num(r.frames)} frames in ${num(r.recS)} s | settled ${num(r.settleS)} s | loaded in ${num(r.loadS)} s | altitude ${num(r.alt == null ? null : r1(r.alt))} m | ended ${r.at ?? '?'}`);
    L.push(r.report ? r.report : '(no perf report)');
  }
  return L.join('\n') + '\n';
}
