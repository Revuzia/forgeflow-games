/**
 * Frame-time statistics and the graph renderer behind the overlay.
 *
 * Averages hide hitches, so everything here is percentile-based: the headline
 * numbers are the median and the 1% low (the 99th-percentile frame time), which
 * is what actually tells you whether a GC pause or a pipeline compile snuck in.
 *
 * Allocation policy: every buffer is created once at module load. `sample()`
 * runs per frame and allocates nothing; `recompute()` sorts an in-place typed
 * array copy and is throttled to 4 Hz.
 *
 * WebGL2 note — GPU timing. There is no WebGPU-style timestamp query here.
 * `EXT_disjoint_timer_query_webgl2` is the only source of real GPU time on this
 * API, and browsers gate it (Chrome hides it outside developer builds, and it
 * is unavailable in most cross-origin contexts) because it is a timing side
 * channel. So it is used when present and `stats.gpuMs` is simply left at 0
 * when it is not — the overlay renders 0 as a dash rather than inventing a
 * number from the CPU frame time, which would be a lie the moment the frame is
 * GPU-bound.
 */

import { S } from "./settings.js";

const CAP = 512; // ~5.7 s of history at 90 fps

const times = new Float32Array(CAP); // ring buffer of frame times, ms
const sorted = new Float32Array(CAP); // scratch for percentiles
let head = 0;
let count = 0;

/** Per-system timings, in ms, written by systems each frame via `mark()`. */
export const systemMs = Object.create(null);

/** Rolling stats, mutated in place — never reassigned, so consumers can hold a ref. */
export const stats = {
    last: 0,
    median: 0,
    mean: 0,
    p99: 0, // 1% low frame time
    p95: 0,
    max: 0,
    fps: 0,
    fpsLow: 0, // 1% low fps
    drawCalls: 0,
    triangles: 0,
    gpuMs: 0, // 0 = unavailable on this browser, not "free"
    /**
     * True while `S.debugProfile` is on, in which case `gpuMs` is the SUM OF THE
     * TIMED SCOPES rather than one whole-frame query — the two cannot both be
     * open, because TIME_ELAPSED_EXT does not nest. Anything reading `gpuMs` as
     * "the frame" must check this flag.
     */
    gpuProfiled: false,
};

let sinceRecompute = 0;

/**
 * Push one frame time.
 * @param {number} ms
 * @returns {void}
 */
export function sample(ms) {
    times[head] = ms;
    head = (head + 1) % CAP;
    if (count < CAP) count++;
    stats.last = ms;

    sinceRecompute += ms;
    if (sinceRecompute >= 250) {
        sinceRecompute = 0;
        recompute();
    }
}

function recompute() {
    const n = count;
    if (n === 0) return;

    let sum = 0;
    let max = 0;
    for (let i = 0; i < n; i++) {
        const v = times[i];
        sorted[i] = v;
        sum += v;
        if (v > max) max = v;
    }

    // TypedArray sort is in-place and allocation-free.
    const view = n === CAP ? sorted : sorted.subarray(0, n);
    view.sort();

    stats.mean = sum / n;
    stats.max = max;
    stats.median = view[(n * 0.5) | 0];
    stats.p95 = view[Math.min(n - 1, (n * 0.95) | 0)];
    stats.p99 = view[Math.min(n - 1, (n * 0.99) | 0)];
    stats.fps = stats.median > 0 ? 1000 / stats.median : 0;
    stats.fpsLow = stats.p99 > 0 ? 1000 / stats.p99 : 0;
}

// --------------------------------------------------------------- draw counter

/**
 * Three already counts draws for us in `renderer.info.render.calls`, so unlike
 * the reference — which had to wrap Babylon's two draw entry points because
 * `engine._drawCalls` counted something else — there is nothing to monkey-patch.
 *
 * The one thing that does need changing is *when* the counter resets.
 * `info.autoReset` defaults to true, which zeroes the counters at the top of
 * every `renderer.render()`; this frame issues a dozen of those (deform, three
 * cascades, prepass, beauty, the whole post chain), so the overlay would end up
 * reading only the last pass. Turning autoReset off and latching on our own
 * frame boundary is what makes the number mean "draws this frame".
 */

/** @type {{render:{calls:number,triangles:number}, autoReset:boolean, reset:()=>void}|null} */
let info = null;

/** @type {WebGL2RenderingContext|null} */
let gl = null;
/** @type {any} EXT_disjoint_timer_query_webgl2, or null when unavailable. */
let timerExt = null;

// A TIME_ELAPSED result is not readable for a frame or three, and only one
// query may be open at a time, so we round-robin a small fixed pool. Created
// once here; nothing below allocates.
const QUERY_SLOTS = 4;
const QUERY_FREE = 0;
const QUERY_OPEN = 1;
const QUERY_WAITING = 2;
/** @type {WebGLQuery[]|null} */
let queries = null;
const queryState = new Uint8Array(QUERY_SLOTS);
let openSlot = -1;

/**
 * Bind the draw counter (and the GPU timer, if the browser exposes one) to the
 * renderer. Call once, right after the renderer is constructed.
 * @param {import("three").WebGLRenderer} r
 * @returns {void}
 */
export function installDrawCounter(r) {
    info = /** @type {any} */ (r.info);
    info.autoReset = false;
    // Zero it here, not just in endFrameDraws(): warm-up (gfx.warmUp) draws the
    // whole scene behind the boot screen, and with autoReset off those draws
    // would otherwise be counted into the first real frame.
    info.reset();

    gl = /** @type {WebGL2RenderingContext} */ (r.getContext());
    timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (timerExt) {
        queries = [];
        for (let i = 0; i < QUERY_SLOTS; i++) queries.push(gl.createQuery());
        queryState.fill(QUERY_FREE);
        openSlot = -1;
    }
}

/**
 * Latch the frame's draw count and roll the GPU timer. Call once, at the very
 * end of the frame — after the last pass has been submitted.
 * @returns {void}
 */
export function endFrameDraws() {
    if (info) {
        stats.drawCalls = info.render.calls;
        stats.triangles = info.render.triangles;
        info.reset();
    }

    // The profile flag is latched HERE and nowhere else. This is the frame
    // boundary, and a mid-frame flip would leave a scope open across the
    // whole-frame query — which the driver answers with a GL error, not a
    // number.
    const want = !!S.debugProfile || !!S.debugProfileDeep;
    if (want !== profiling) _setProfiling(want);

    if (profiling) {
        // Defensive: a pass that threw between begin and end would otherwise
        // leave the query open forever and stall every later begin.
        wideOpen = false;
        if (scopeOpen >= 0) gpuEnd();
        _pollScopes();
        stats.gpuMs = profileTotal();
        wideFrame = !wideFrame; // alternate: per-pass frame, wide frame, ...
    } else {
        rollGpuTimer();
    }
}

/**
 * Close the query that has been open since the previous frame boundary, harvest
 * whatever has become readable, and open the next one. Measuring boundary to
 * boundary means the query brackets exactly one frame's worth of GL commands.
 */
function rollGpuTimer() {
    if (!timerExt || !gl || !queries) return;

    if (openSlot >= 0) {
        gl.endQuery(timerExt.TIME_ELAPSED_EXT);
        queryState[openSlot] = QUERY_WAITING;
        openSlot = -1;
    }

    // Reading GPU_DISJOINT_EXT clears it, so read it once for the whole sweep.
    // Disjoint means the GPU was reset or descheduled and every timing that
    // straddles it is garbage — discard rather than report a spike that the
    // frame never had.
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);

    let free = -1;
    for (let i = 0; i < QUERY_SLOTS; i++) {
        if (queryState[i] === QUERY_WAITING) {
            const q = queries[i];
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
                if (!disjoint) {
                    const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; // ns -> ms
                    // Light EMA: raw GPU times jitter far more than the CPU
                    // frame time and the overlay is read, not logged.
                    stats.gpuMs = stats.gpuMs > 0 ? stats.gpuMs + (ms - stats.gpuMs) * 0.15 : ms;
                }
                queryState[i] = QUERY_FREE;
            }
        }
        if (free < 0 && queryState[i] === QUERY_FREE) free = i;
    }

    if (free >= 0) {
        gl.beginQuery(timerExt.TIME_ELAPSED_EXT, queries[free]);
        queryState[free] = QUERY_OPEN;
        openSlot = free;
    }
}

// ------------------------------------------------------ per-pass GPU profile

/**
 * `S.debugProfile` — the GPU analogue of the reference's per-system CPU
 * breakdown, and the only way to find out where a fill-bound frame actually
 * goes. Off by default and free when off: `gpuBegin`/`gpuEnd` are a single
 * boolean test, and no query object is created until the toggle is first
 * flipped.
 *
 * ## Why the whole-frame timer is suspended while this runs
 *
 * `TIME_ELAPSED_EXT` is a *singleton* target: exactly one query may be active
 * at a time, and there is no nesting. So the frame-boundary query in
 * `rollGpuTimer` and a per-pass query cannot coexist. While profiling,
 * `endFrameDraws` therefore runs the scopes instead and reports their sum as
 * `stats.gpuMs`, flagged by `stats.gpuProfiled`. The sum is slightly LESS than
 * the whole-frame number — the gaps between scopes (state setup, the clears
 * Three issues outside any scope) are not attributed to anyone. Compare the two
 * across a toggle rather than assuming they are the same number.
 *
 * ## Asynchrony
 *
 * A TIME_ELAPSED result is not readable for a frame or three, so nothing here
 * ever blocks on one: queries are round-robined across a fixed pool and
 * harvested opportunistically at the next frame boundary. `GPU_DISJOINT_EXT` is
 * read once per sweep (reading clears it) and a disjoint discards every result
 * in flight rather than reporting a spike the frame never had.
 *
 * ## Allocation
 *
 * The pool, the name table and the accumulators are typed arrays sized once.
 * The only allocation is the first time a NEW scope name is seen — one string
 * push and one Map insert, on the frame the toggle is flipped, never in steady
 * state. `profileSnapshot()` allocates by definition and is a debug/harness
 * call, never a per-frame one.
 */

/** Distinct timed scopes. 14 coarse + ~10 per-draw leaves plenty of headroom. */
const MAX_SCOPES = 64;
/** Queries in flight. ~25 scopes/frame × ~3 frames of latency, doubled. */
const SCOPE_QUERIES = 160;

/** @type {string[]} scope id -> name, in first-seen (i.e. frame) order */
const scopeNames = [];
/** @type {Map<string, number>} name -> scope id */
const scopeIds = new Map();
/** Light EMA per scope, ms — what the overlay reads. */
const scopeEma = new Float64Array(MAX_SCOPES);
/** Running sum and count since `profileReset()` — what a measurement reads. */
const scopeSum = new Float64Array(MAX_SCOPES);
const scopeCount = new Uint32Array(MAX_SCOPES);
let scopeTotal = 0;

let profiling = false;
/**
 * Alternate frames measure ONE scope spanning the whole frame instead of the
 * per-pass ones — see `profileWide`. Without it the table cannot be checked:
 * a sum of scopes that falls 20 ms short of the frame is either unattributed
 * work between the passes or a measurement artefact, and nothing in a
 * per-pass-only table can tell you which.
 */
let wideFrame = false;
let wideOpen = false;
/** Scope id of the frame-wide row, excluded from `profileTotal`. */
let wideId = -1;
/** @type {WebGLQuery[]|null} created on the first flip, kept for the session. */
let scopeQ = null;
const scopeQName = new Int16Array(SCOPE_QUERIES);
const scopeQBusy = new Uint8Array(SCOPE_QUERIES);
let scopeCursor = 0;
let scopeOpen = -1;
/** Scopes dropped because the pool was saturated. Non-zero invalidates a run. */
let scopeDropped = 0;
/** Results rejected as impossible. Non-zero means the driver glitched. */
let scopeBogus = 0;
/** Ceiling for a believable single-pass timing, ms. */
const BOGUS_MS = 1000;

/**
 * @param {string} name
 * @returns {number} scope id, or -1 if the table is full
 */
function _scopeId(name) {
    const known = scopeIds.get(name);
    if (known !== undefined) return known;
    if (scopeTotal >= MAX_SCOPES) return -1;
    const id = scopeTotal++;
    scopeNames.push(name);
    scopeIds.set(name, id);
    return id;
}

/**
 * @param {boolean} on
 */
function _setProfiling(on) {
    profiling = on;
    stats.gpuProfiled = on;

    if (on) {
        if (!timerExt || !gl) {
            profiling = false;
            stats.gpuProfiled = false;
            return;
        }
        // Close the whole-frame query: it would otherwise still be open when
        // the first scope tries to begin, and the driver rejects that.
        if (openSlot >= 0) {
            gl.endQuery(timerExt.TIME_ELAPSED_EXT);
            queryState[openSlot] = QUERY_WAITING;
            openSlot = -1;
        }
        if (scopeQ === null) {
            scopeQ = [];
            for (let i = 0; i < SCOPE_QUERIES; i++) scopeQ.push(gl.createQuery());
        }
        stats.gpuMs = 0;
        profileReset();
    } else if (gl && timerExt) {
        if (scopeOpen >= 0) {
            gl.endQuery(timerExt.TIME_ELAPSED_EXT);
            scopeOpen = -1;
        }
        wideOpen = false;
        wideFrame = false;
        // Abandon whatever is in flight. A query object with an unread result is
        // legal to re-begin — the result is simply discarded — so freeing the
        // slots here is enough, and it stops a stale timing from landing in the
        // next measurement.
        scopeQBusy.fill(0);
        stats.gpuMs = 0;
    }
}

/**
 * Open a timed GPU scope. Pass a STRING LITERAL — a template or a concatenation
 * would allocate every frame, and the name is used as a map key.
 *
 * Scopes do not nest: opening one closes any scope still open, so a caller that
 * forgets `gpuEnd()` costs itself accuracy and nothing else.
 *
 * @param {string} name
 * @returns {void}
 */
export function gpuBegin(name) {
    if (!profiling || wideOpen) return;
    if (scopeOpen >= 0) gpuEnd();

    const id = _scopeId(name);
    if (id < 0) return;

    let slot = -1;
    for (let i = 0; i < SCOPE_QUERIES; i++) {
        const j = scopeCursor + i < SCOPE_QUERIES
            ? scopeCursor + i
            : scopeCursor + i - SCOPE_QUERIES;
        if (scopeQBusy[j] === 0) { slot = j; break; }
    }
    if (slot < 0) { scopeDropped++; return; }

    scopeCursor = slot + 1 < SCOPE_QUERIES ? slot + 1 : 0;
    scopeQName[slot] = id;
    scopeQBusy[slot] = 1;
    gl.beginQuery(timerExt.TIME_ELAPSED_EXT, scopeQ[slot]);
    scopeOpen = slot;
}

/**
 * Close the open scope. Safe to call unpaired.
 * @returns {void}
 */
export function gpuEnd() {
    // `wideOpen` guards the frame-wide scope from the passes nested inside it.
    // Their `gpuBegin` is suppressed, so their `gpuEnd` must be too — otherwise
    // the first pass to finish closes the wide query and it reports the cost of
    // one pass while claiming to be the frame.
    if (!profiling || wideOpen || scopeOpen < 0) return;
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    scopeOpen = -1;
}

/**
 * Open the frame-wide scope, on the frames that measure it. Every per-pass
 * `gpuBegin` inside it is suppressed, so nothing nests — and the result is one
 * query covering exactly the span the per-pass rows are supposed to add up to.
 * @param {string} name
 * @returns {void}
 */
export function gpuBeginWide(name) {
    if (!profiling || !wideFrame) return;
    wideOpen = false; // let this one through
    wideId = _scopeId(name);
    gpuBegin(name);
    wideOpen = scopeOpen >= 0;
}

/** Close the frame-wide scope. Safe to call unpaired. @returns {void} */
export function gpuEndWide() {
    if (!wideOpen) return;
    wideOpen = false; // drop the guard so gpuEnd will act
    gpuEnd();
}

/**
 * True on the frames that measure one wide scope rather than the per-pass ones.
 * Flips every frame while profiling, so both tables fill at half rate.
 * @returns {boolean}
 */
export function profileWide() {
    return profiling && wideFrame;
}

/** Harvest whatever became readable. Allocation-free; never blocks. */
function _pollScopes() {
    if (!scopeQ) return;

    // Reading clears it, so read once for the whole sweep.
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);

    for (let i = 0; i < SCOPE_QUERIES; i++) {
        if (scopeQBusy[i] === 0 || i === scopeOpen) continue;
        const q = scopeQ[i];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;

        if (!disjoint) {
            const id = scopeQName[i];
            const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; // ns -> ms
            // A pass on this GPU is single-digit milliseconds. Results in the
            // seconds have been observed on ANGLE/D3D11 without the disjoint
            // flag being raised, and one of them poisons a mean beyond repair —
            // so they are rejected and counted rather than averaged in.
            if (ms >= 0 && ms < BOGUS_MS) {
                scopeEma[id] = scopeEma[id] > 0
                    ? scopeEma[id] + (ms - scopeEma[id]) * 0.15
                    : ms;
                scopeSum[id] += ms;
                scopeCount[id]++;
            } else {
                scopeBogus++;
            }
        }
        scopeQBusy[i] = 0;
    }
}

/**
 * Sum of every scope's EMA, ms. Note a scope that has stopped running keeps its
 * last EMA — this is a steady-state number, not a per-frame one.
 * @returns {number}
 */
export function profileTotal() {
    let sum = 0;
    for (let i = 0; i < scopeTotal; i++) {
        if (i !== wideId) sum += scopeEma[i]; // the wide row spans the others
    }
    return sum;
}

/** Number of scopes seen since the page loaded. @returns {number} */
export function profileCount() {
    return scopeTotal;
}

/** Scope names, id-indexed. Live array — do not mutate. @returns {string[]} */
export function profileNames() {
    return scopeNames;
}

/** Scope EMAs in ms, id-indexed. Live array — do not mutate. @returns {Float64Array} */
export function profileEma() {
    return scopeEma;
}

/** True when the per-draw beauty breakdown is on. @returns {boolean} */
export function profileDeep() {
    return profiling && !!S.debugProfileDeep;
}

/** Zero the running means. Call before a measurement window. @returns {void} */
export function profileReset() {
    scopeSum.fill(0);
    scopeCount.fill(0);
    scopeDropped = 0;
    scopeBogus = 0;
}

/**
 * The measurement, as data. Allocates — for the harness and the console, never
 * for the frame.
 * @returns {{enabled:boolean, dropped:number, bogus:number, totalMs:number,
 *            passes:{name:string, ms:number, ema:number, n:number}[]}}
 */
export function profileSnapshot() {
    const passes = [];
    let totalMs = 0;
    for (let i = 0; i < scopeTotal; i++) {
        const n = scopeCount[i];
        const ms = n > 0 ? scopeSum[i] / n : 0;
        totalMs += ms;
        passes.push({ name: scopeNames[i], ms, ema: scopeEma[i], n });
    }
    return {
        enabled: profiling, dropped: scopeDropped, bogus: scopeBogus,
        totalMs, passes,
    };
}

// ----------------------------------------------- per-draw beauty breakdown

/**
 * Deep mode. Three calls `object.onBeforeRender` / `onAfterRender` as methods on
 * the object, immediately around its draw, so a scope opened there brackets
 * exactly one draw call — which is how the beauty pass (one `renderer.render`
 * over sky, terrain, character, cloth, fur and the transparent group) is split
 * without any of those subsystems knowing this exists.
 */
let deepAttached = false;

function _drawBegin() {
    gpuBegin(this.__profName);
}

function _drawEnd() {
    gpuEnd();
}

/**
 * Attach the per-draw hooks to every mesh in `scene`. Cheap enough to call every
 * frame — it is a traversal of a dozen objects and it no-ops entirely unless
 * `S.debugProfileDeep` is on — which is what keeps meshes that attach later
 * (the spell meshes, the crystals) covered without a registration API.
 *
 * @param {import("three").Object3D} scene
 * @returns {void}
 */
export function profileScene(scene) {
    const want = profileDeep();
    if (want) {
        scene.traverse(_attachHooks);
        deepAttached = true;
    } else if (deepAttached) {
        // MUST detach, not just stop attaching. A hook left behind opens a
        // per-draw scope inside the coarse `beauty` scope, which auto-closes it
        // — so coarse mode would silently report the beauty pass as ~0.1 ms
        // from the second measurement onward. Observed, then fixed.
        scene.traverse(_detachHooks);
        deepAttached = false;
    }
}

/** @param {any} o */
function _attachHooks(o) {
    if (!o.isMesh || o.onBeforeRender === _drawBegin) return;
    // Built once per object, on the frame deep mode is first enabled.
    o.__profName = "draw " + (o.name || (o.material && o.material.name) || "mesh");
    o.onBeforeRender = _drawBegin;
    o.onAfterRender = _drawEnd;
}

/** @param {any} o */
function _detachHooks(o) {
    if (o.onBeforeRender !== _drawBegin) return;
    // `delete` rather than assigning a no-op: both are Object3D prototype
    // methods, so removing the own property restores Three's own empty ones.
    delete o.onBeforeRender;
    delete o.onAfterRender;
}

/**
 * Record a per-system cost in ms (overwrites; call once per frame per system).
 * @param {string} name
 * @param {number} ms
 * @returns {void}
 */
export function mark(name, ms) {
    systemMs[name] = ms;
}

/** Number of frames exceeding `median + 4 ms`. */
export const spikes = { count: 0, sinceReset: 0 };

/**
 * @param {number} ms
 * @returns {void}
 */
export function checkSpike(ms) {
    spikes.sinceReset++;
    if (stats.median > 0 && ms > stats.median + 4) spikes.count++;
}

/** @returns {void} */
export function resetSpikes() {
    spikes.count = 0;
    spikes.sinceReset = 0;
}

// --------------------------------------------------------------------- graph

/**
 * Draws the frame-time history into a 2D canvas. Bars are coloured by which
 * budget band they land in, so a red column is instantly readable as a hitch.
 */
export class FrameGraph {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
        this.w = canvas.width;
        this.h = canvas.height;
        this.maxMs = 22; // y-axis top, eased toward the observed max
    }

    /** @returns {void} */
    draw() {
        const ctx = this.ctx;
        const w = this.w;
        const h = this.h;
        if (!ctx) return;

        // Ease the axis so it doesn't jump around while you read it.
        const want = Math.max(22, Math.min(60, stats.max * 1.25));
        this.maxMs += (want - this.maxMs) * 0.08;
        const inv = h / this.maxMs;

        ctx.clearRect(0, 0, w, h);

        // Budget guides: 11.1 ms (90 fps) and 16.7 ms (60 fps).
        ctx.fillStyle = "rgba(143,196,232,0.10)";
        ctx.fillRect(0, h - 11.1 * inv, w, 1);
        ctx.fillStyle = "rgba(232,160,120,0.12)";
        ctx.fillRect(0, h - 16.7 * inv, w, 1);

        const n = count;
        if (n === 0) return;

        const step = w / CAP;
        for (let i = 0; i < n; i++) {
            // Walk oldest→newest so the graph scrolls left.
            const idx = (head - n + i + CAP * 2) % CAP;
            const v = times[idx];
            const bh = Math.min(h, v * inv);

            ctx.fillStyle =
                v > 16.7 ? "#e8734f" : v > 11.1 ? "#e8b04f" : "#6fb2e0";
            ctx.fillRect(i * step, h - bh, Math.max(1, step), bh);
        }

        // Median line on top of the bars.
        ctx.fillStyle = "rgba(219,230,242,0.55)";
        ctx.fillRect(0, h - stats.median * inv, w, 1);
    }
}
