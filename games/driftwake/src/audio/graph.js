/**
 * DRIFTWAKE — audio graph primitives.
 *
 * Everything the sound design is built out of, and nothing that knows what a
 * spell or a footstep is. Three ideas carry the whole subsystem:
 *
 *  1. PROCEDURAL — IN THIS FILE. Every sound built here is filtered noise or an
 *     oscillator through an envelope, and the one "sample" is a noise buffer
 *     this file generates from a seeded LCG at unlock time.
 *
 *     This is no longer true of the SUBSYSTEM, and the distinction matters. The
 *     build originally shipped zero asset files and the audio held that line on
 *     principle; the owner then judged that real recordings beat synthetic
 *     purity, which was the right call. `samples.js` now decodes twenty
 *     vendored files — five Kenney CC0 snow footsteps and four impacts, plus
 *     eleven Sonniss GDC 2024 cuts: the spell one-shots (glass/ice cracks,
 *     water surge, eruption, whorl, jump whoosh) and the three loop beds
 *     (wind, surf slide, ribbon stream) the voices adopt into their existing
 *     filter chains. `voices.js` keeps every synthesised version as the
 *     fallback when a fetch or decode fails. So: the primitives below are
 *     still pure, and every shipped sound is a recording arriving through a
 *     graph these primitives shape. `CREDITS.md` is the authority on exactly
 *     what ships and under what licence — believe it over any docblock,
 *     including this one.
 *
 *  2. A FIXED POOL, NOT ONE-SHOT NODES. The idiomatic Web Audio one-shot builds
 *     an OscillatorNode per trigger and throws it away. That is an allocation
 *     per sound, and this frame has no headroom to give the garbage collector.
 *     So every source in this subsystem is created once, `start()`ed once, and
 *     left running forever; a trigger is an envelope written onto a GainNode
 *     that is already connected. Nothing in the per-frame or per-trigger path
 *     allocates.
 *
 *  3. WRITE A PARAM ONLY WHEN IT MOVED. `Smoothed` holds the last value written
 *     to an AudioParam and skips the automation call when the new one is inside
 *     an epsilon. The beds are driven from wind strength and player speed, which
 *     at a walk change by nothing at all for seconds at a time — without the
 *     gate they would schedule an event per param per frame for the life of the
 *     page.
 *
 * MUTE. Nothing here reaches for a private audio path. `game_controls.js` wraps
 * the `AudioContext` constructor at page load so the page-level Mute button can
 * suspend every context a game creates; using the plain constructor through
 * `globalThis` at unlock time (see audio.js) is what buys that for free, and is
 * why this file never captures a reference to the native constructor.
 */

/** Seconds of noise in each generated buffer. Long enough that the loop reads as continuous. */
const NOISE_SECONDS = 3;

/**
 * Samples of head/tail crossfade in a looping noise buffer.
 *
 * A raw noise buffer set to `loop` has a hard discontinuity at the seam, and a
 * discontinuity in a signal is a click — once every three seconds, forever,
 * which is exactly the kind of defect that reads as "cheap" without being
 * identifiable. The generator therefore runs `n + XFADE` samples and folds the
 * overrun back over the head, so sample `n-1` leads continuously into sample 0.
 */
const XFADE = 2048;

/**
 * One deterministic noise buffer, mono.
 *
 * Mono on purpose: a stereo buffer doubles the memory and the per-source mixing
 * cost for a decorrelation the StereoPannerNodes downstream provide anyway, and
 * the wind's stereo image should follow the wind bearing rather than whatever
 * two independent noise channels happen to do.
 *
 * Deterministic on purpose too (ARCHITECTURE.md §6): a seeded LCG rather than
 * `Math.random()`, so two runs of the page produce the identical bed.
 *
 * @param {AudioContext} ctx
 * @param {boolean} pink true for a pink-ish spectrum (the low, bodied layers),
 *                       false for white (the hiss and crunch layers)
 * @param {number} seed
 * @returns {AudioBuffer}
 */
export function noiseBuffer(ctx, pink, seed) {
    const n = Math.max(1024, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const out = buf.getChannelData(0);
    const raw = new Float32Array(n + XFADE);

    let s = (seed >>> 0) || 1;
    // Paul Kellett's three-pole pink approximation. Cheap, and flat enough
    // across the band the wind bed actually occupies.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let peak = 1e-6;

    for (let i = 0; i < raw.length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const w = s / 2147483648 - 1; // -1..1
        let v;
        if (pink) {
            b0 = 0.99765 * b0 + w * 0.0990460;
            b1 = 0.96300 * b1 + w * 0.2965164;
            b2 = 0.57000 * b2 + w * 1.0526913;
            v = (b0 + b1 + b2 + w * 0.1848) * 0.22;
        } else {
            v = w;
        }
        raw[i] = v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
    }

    const norm = 0.9 / peak;
    // Fold the overrun back over the head so the loop seam is continuous:
    // out[n-1] is raw[n-1] and out[0] is raw[n], which were adjacent samples.
    for (let i = 0; i < XFADE; i++) {
        const t = i / XFADE;
        out[i] = (raw[i] * t + raw[n + i] * (1 - t)) * norm;
    }
    for (let i = XFADE; i < n; i++) out[i] = raw[i] * norm;

    return buf;
}

/**
 * A looping source on a shared buffer, started immediately and never stopped.
 *
 * `playbackRate` is the cheap variation knob: it shifts the whole spectrum, so
 * four crunch voices on one buffer at four rates do not read as four copies of
 * the same sound.
 *
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {number} rate
 * @param {AudioNode} dest
 * @returns {AudioBufferSourceNode}
 */
export function looper(ctx, buffer, rate, dest) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(dest);
    // Offset per source so several loopers on one buffer are decorrelated —
    // without it the wind's three layers are the same noise at three filters,
    // which combs rather than thickens.
    src.start(0, (rate * 0.37) % buffer.duration);
    return src;
}

/**
 * A running oscillator whose gain is closed. The pooled equivalent of the
 * one-shot `createOscillator(); start(); stop()` idiom, minus the allocation.
 *
 * @param {AudioContext} ctx
 * @param {OscillatorType} type
 * @param {number} freq
 * @param {AudioNode} dest
 * @returns {OscillatorNode}
 */
export function osc(ctx, type, freq, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start();
    return o;
}

/**
 * A gain node, closed by default.
 * @param {AudioContext} ctx
 * @param {number} value
 * @param {AudioNode} [dest]
 * @returns {GainNode}
 */
export function gain(ctx, value, dest) {
    const g = ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
}

/**
 * A biquad.
 * @param {AudioContext} ctx
 * @param {BiquadFilterType} type
 * @param {number} freq
 * @param {number} q
 * @param {AudioNode} [dest]
 * @returns {BiquadFilterNode}
 */
export function filter(ctx, type, freq, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
}

/**
 * A stereo panner.
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @returns {StereoPannerNode}
 */
export function panner(ctx, dest) {
    const p = ctx.createStereoPanner();
    p.connect(dest);
    return p;
}

/** Smallest gain an envelope is allowed to ramp to; `exponentialRamp` rejects 0. */
const FLOOR = 1e-4;

/**
 * Take over an AudioParam mid-automation without a click.
 *
 * `cancelScheduledValues` alone leaves the param holding whatever the cancelled
 * curve had reached, which is right — but only if the next event starts from
 * that value. Reading `.value` first and re-anchoring is what makes retriggering
 * a voice that is still decaying a re-attack rather than a step.
 *
 * @param {AudioParam} p
 * @param {number} now
 * @returns {number} the value the param was holding
 */
function anchor(p, now) {
    const cur = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(cur, now);
    return cur;
}

/**
 * A percussive two-grain envelope: attack, a fast dip, a second smaller grain,
 * then a decay to silence.
 *
 * The dip is the whole reason this is not a plain AD. A single exponential decay
 * on filtered noise is a "shh"; snow underfoot is two collapses a few tens of
 * milliseconds apart — the crust, then the pack beneath it. One scheduled chain,
 * no second voice, no allocation.
 *
 * @param {AudioParam} p
 * @param {number} now
 * @param {number} peak
 * @param {number} decay seconds to effective silence after the second grain
 * @param {number} [grainAt] seconds to the second grain; 0 disables it
 * @returns {number} the time the envelope is fully closed
 */
export function crunchEnv(p, now, peak, decay, grainAt) {
    const pk = peak > FLOOR ? peak : FLOOR;
    anchor(p, now);
    p.linearRampToValueAtTime(pk, now + 0.004);
    let t = now + 0.004;
    if (grainAt > 0) {
        p.exponentialRampToValueAtTime(pk * 0.12, now + grainAt);
        p.linearRampToValueAtTime(pk * 0.5, now + grainAt + 0.006);
        t = now + grainAt + 0.006;
    }
    p.setTargetAtTime(0, t, decay * 0.3);
    const end = t + decay;
    p.setValueAtTime(0, end);
    return end;
}

/**
 * Attack / decay-to-silence. The workhorse for the one-shot spells.
 * @param {AudioParam} p
 * @param {number} now
 * @param {number} peak
 * @param {number} attack
 * @param {number} decay
 * @returns {number} the time the envelope is fully closed
 */
export function hitEnv(p, now, peak, attack, decay) {
    const pk = peak > FLOOR ? peak : FLOOR;
    anchor(p, now);
    p.linearRampToValueAtTime(pk, now + attack);
    p.setTargetAtTime(0, now + attack, decay * 0.3);
    const end = now + attack + decay;
    p.setValueAtTime(0, end);
    return end;
}

/**
 * Open a sustaining voice. Pairs with `releaseEnv`.
 * @param {AudioParam} p
 * @param {number} now
 * @param {number} peak
 * @param {number} attack
 * @returns {void}
 */
export function holdEnv(p, now, peak, attack) {
    anchor(p, now);
    p.linearRampToValueAtTime(peak > FLOOR ? peak : FLOOR, now + attack);
}

/**
 * Close a sustaining voice.
 * @param {AudioParam} p
 * @param {number} now
 * @param {number} release
 * @returns {number} the time the envelope is fully closed
 */
export function releaseEnv(p, now, release) {
    anchor(p, now);
    p.setTargetAtTime(0, now, release * 0.3);
    const end = now + release;
    p.setValueAtTime(0, end);
    return end;
}

/**
 * Schedule a frequency glide. Exponential, because pitch and filter cutoff are
 * both perceived logarithmically — a linear ramp between 240 Hz and 2400 Hz
 * spends most of its time in the top octave and reads as a step.
 * @param {AudioParam} p
 * @param {number} now
 * @param {number} f0
 * @param {number} f1
 * @param {number} dur
 * @returns {void}
 */
export function glide(p, now, f0, f1, dur) {
    p.cancelScheduledValues(now);
    p.setValueAtTime(f0 > FLOOR ? f0 : FLOOR, now);
    p.exponentialRampToValueAtTime(f1 > FLOOR ? f1 : FLOOR, now + dur);
}

/**
 * A three-point filter glide — up, then settle. One extra ramp, and the
 * difference between "a noise burst" and "something opened and closed".
 * @param {AudioParam} p
 * @param {number} now
 * @param {number} f0
 * @param {number} f1
 * @param {number} f2
 * @param {number} t1
 * @param {number} t2
 * @returns {void}
 */
export function arc(p, now, f0, f1, f2, t1, t2) {
    p.cancelScheduledValues(now);
    p.setValueAtTime(f0, now);
    p.exponentialRampToValueAtTime(f1, now + t1);
    p.exponentialRampToValueAtTime(f2, now + t2);
}

/**
 * A continuously-driven AudioParam that is only written when it has actually
 * moved. See idea 3 in the file docblock.
 *
 * `setTargetAtTime` rather than a direct `.value` write: the beds are driven off
 * `S.windStrength` and the player's speed, which step discontinuously when a
 * slider moves or a surf ends, and a step on a gain is a click.
 */
export class Smoothed {
    /**
     * @param {AudioParam} param
     * @param {number} tau exponential time constant, seconds
     * @param {number} eps smallest change worth an automation event
     */
    constructor(param, tau, eps) {
        this.p = param;
        this.tau = tau;
        this.eps = eps;
        this.last = param.value;
    }

    /**
     * @param {number} v
     * @param {number} now `ctx.currentTime`
     * @returns {void}
     */
    write(v, now) {
        const d = v - this.last;
        if (d < this.eps && d > -this.eps) return;
        this.last = v;
        this.p.setTargetAtTime(v, now, this.tau);
    }

    /** Hard-close, for blur and mute. @returns {void} */
    reset(v, now) {
        this.last = v;
        this.p.cancelScheduledValues(now);
        this.p.setValueAtTime(v, now);
    }
}
