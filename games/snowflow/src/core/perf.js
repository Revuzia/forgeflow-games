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
    rollGpuTimer();
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
