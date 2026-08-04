/**
 * DRIFTWAKE — the voices. What each thing in the world sounds like.
 *
 * Every voice in this file is built once, at unlock, and never rebuilt: sources
 * run forever and a "trigger" is an envelope written onto a gain that is already
 * connected (see graph.js). Nothing here allocates after construction.
 *
 * The five families, and what each is trying to be:
 *
 *   WIND     three filtered-noise layers — a low body, a mid band and a thin top
 *            that only opens at speed. It is the bed the whole thing sits on, and
 *            the only voice that is never silent. Band and gain track
 *            `S.windStrength` and the player's speed, because the wind you hear
 *            is the sum of the weather and your own passage through it.
 *
 *   SURF     a sustained hiss over a low body, gated by the surf blend and
 *            scaled by speed. The carve is the interesting part: loading the edge
 *            raises the band and tightens Q, so a hard turn does not just get
 *            louder, it gets narrower and more urgent — the swell the brief asks
 *            for is a resonance change, not a volume change.
 *
 *   CRUNCH   a four-voice round-robin of band-passed noise on a two-grain
 *            envelope. Footfalls, jump take-off and landing are all this synth at
 *            different band, rate, level and decay — a landing IS a heavier
 *            footstep, so it is the same voice, not a second one.
 *
 *   THUMP    two sine voices that glide down. Only landings and the heavier end
 *            of the surf use them; a crunch alone has no weight.
 *
 *   SPELLS   one voice each, deliberately not interchangeable. Sweep, Ribbon and
 *            Bloom are the water family and share a band-passed-noise-over-a-low-
 *            sine construction so they read as three uses of one element.
 *            Crystallise WAS the odd one out — three inharmonic partials, a
 *            struck bell. The owner heard it and said GLASS BREAKING, not a
 *            bell: growing ice spikes are a fracture, not an instrument. The
 *            voice therefore plays recorded glass/ice cracks (Sonniss GDC 2024,
 *            via the shared SampleBank) staggered across the ~1.6 s golden-
 *            spiral growth, with a faint ice-crackle shimmer under them. The
 *            bell synth below is UNREACHABLE while those buffers are decoded —
 *            it survives only as the fallback for a failed fetch.
 *            Vortex is a rising airy whorl — recorded wind gust when decoded,
 *            rising resonant band as the fallback. Sweep and Bloom follow the
 *            same recording-first, synth-fallback pattern.
 *
 * ---------------------------------------------------------------------------
 * RECORDINGS, AND WHERE THEY PLUG IN
 *
 * Two plumbing patterns, matching the two kinds of sound:
 *
 *   ONE-SHOTS (the spells) go through the SampleBank's pooled player exactly
 *   like footsteps do: `bank.play()` at fire time, false -> synth fallback.
 *
 *   BEDS (wind, surf hiss, ribbon stream) each own a looping source built at
 *   construction from generated noise. `adopt(buffer)` — called once, by
 *   audio.js, when the recording's decode settles — starts a new looping
 *   source on the RECORDED buffer into the SAME filter, then stops the noise
 *   source. Every Smoothed gain/frequency schedule, i.e. the entire measured
 *   envelope, survives untouched: only the raw material under the filters
 *   changes. The per-layer `mk` makeup factors exist because a real recording
 *   is not spectrally flat — a bandpass at 2.2 kHz takes far less energy from
 *   recorded wind than from white noise, and the makeups (set by MEASURING
 *   each layer through _harness/windprobe.py --real) put each layer back at
 *   the level the mix was tuned to. `adopt` allocates a handful of nodes ONCE
 *   per page life, off the frame path — the same exemption samples.js already
 *   documents for its per-trigger source.
 *
 * All levels are pre-master and pre-`FFG.sfxVolume`; the caller multiplies.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NOISE LEVELS LOOK WRONG
 *
 * The gain numbers on the band-passed voices are several times those on the
 * oscillator voices, and that is not a mix decision — it is filter insertion
 * loss. A BiquadFilter set to `bandpass` has unity gain AT its centre frequency
 * and discards everything else, so white noise through a Q of 3.6 arrives an
 * order of magnitude quieter than the gain in front of it suggests. Every level
 * here was set by MEASURING the master bus with one voice connected at a time
 * (an AudioWorklet peak meter, so a 100 ms transient is not missed by a page
 * running at 8 fps), not by reading the numbers and judging them by eye. The
 * first pass, set by eye, put the Ribbon and the Vortex below the wind bed.
 */

import {
    noiseBuffer, looper, osc, gain, filter, panner,
    crunchEnv, hitEnv, holdEnv, releaseEnv, glide, arc, Smoothed,
} from "./graph.js";

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------- wind

/**
 * The wind bed. Always running, never silent.
 *
 * ---------------------------------------------------------------------------
 * THE STANDSTILL LEVEL, AND WHY IT IS NOW A SIXTEENTH OF WHAT IT WAS
 *
 * The owner's report was "there is an odd WHITE NOISE playing". It was this, and
 * the obvious suspect was wrong: measurement (`_harness/windprobe.py`, which
 * renders this exact class offline through a replica of audio.js's master chain)
 * put the three layers at a dead stand, default `windStrength` 1.0, at the crest
 * of the gust, at:
 *
 *     low  -47.95 dBFS(A)      mid  -42.12 dBFS(A)      top  -55.16 dBFS(A)
 *
 * So it was NOT the thin top layer — that sits 13 dB under the mid and
 * contributes 0.2 dB to the sum. The hiss was the MID: white noise through a
 * bandpass at 520 Hz with a Q of 0.85, and a Q below 1 is barely a band at all
 * (bandwidth = f/Q, i.e. ~610 Hz wide), so what came through was a broad swathe
 * of white noise straight across the ear's most sensitive octaves. 68.6% of its
 * energy landed between 500 Hz and 2 kHz.
 *
 * The decisive number was the comparison, not the absolute: ONE FOOTFALL measured
 * -48.89 dBFS(A), i.e. 7.9 dB QUIETER than the bed it is supposed to punctuate.
 * A bed louder than the events on top of it is not a bed, it is a noise floor,
 * and that inversion is what makes it read as "white noise playing" rather than
 * as weather.
 *
 * Two things changed, both aimed at the level at rest and neither at the level at
 * speed — the owner did not complain about fast, and fast is the good part:
 *
 *  1. The constant and `windStrength` terms below are cut hard while the `speed01`
 *     terms are raised to compensate, so the bed at full tilt lands within ~1.5 dB
 *     of where it always was but the stand-to-sprint range widens from 8.6 dB to
 *     ~24 dB. That RANGE is what makes a bed read as wind: a level that answers
 *     the player is weather, a level that just sits there is noise.
 *  2. The mid layer's Q is now scheduled — 2.2 at rest, opening to 0.85 at speed.
 *     Narrow is a moan, wide is a hiss; standing still in a light breeze should be
 *     the former. This costs nothing (one more `Smoothed`, written only when it
 *     moves) and changes the character, not just the number.
 */
export class WindBed {
    /**
     * @param {AudioContext} ctx
     * @param {AudioBuffer} white
     * @param {AudioBuffer} pink
     * @param {AudioNode} dest
     */
    constructor(ctx, white, pink, dest) {
        this.ctx = ctx;
        this.pan = panner(ctx, dest);

        this.gLow = gain(ctx, 0, this.pan);
        this.fLow = filter(ctx, "lowpass", 260, 0.5, this.gLow);
        this.srcLow = looper(ctx, pink, 1.0, this.fLow);

        // Q starts at the standstill value, not the old fixed 0.85: the bed is
        // driven from the first frame after unlock, and starting wide would open
        // the page with one audible swoop of exactly the hiss this is removing.
        this.gMid = gain(ctx, 0, this.pan);
        this.fMid = filter(ctx, "bandpass", 520, 2.2, this.gMid);
        this.srcMid = looper(ctx, white, 0.83, this.fMid);

        // The top layer is the one that sells speed. It is nearly shut at a
        // stand — a demo that whistles while you are standing still on a calm
        // day is a demo whose wind is a texture rather than a wind.
        this.gTop = gain(ctx, 0, this.pan);
        this.fTop = filter(ctx, "bandpass", 2200, 1.4, this.gTop);
        this.srcTop = looper(ctx, white, 1.19, this.fTop);

        // Per-layer makeup, 1.0 while the source is generated noise. `adopt`
        // swaps in the measured constants for the recorded wind — see the file
        // docblock and the numbers above the constants in `adopt`. Two values
        // per layer, rest and sprint, interpolated on speed in `drive()`: the
        // mid band's centre frequency climbs 600 Hz with speed, into a region
        // where the recording is weaker than white noise by a growing margin,
        // so no single constant holds both ends of the envelope.
        this.mkLow0 = 1.0; this.mkLow1 = 1.0;
        this.mkMid0 = 1.0; this.mkMid1 = 1.0;
        this.mkTop0 = 1.0; this.mkTop1 = 1.0;

        // The gain epsilons are small because the levels are. `Smoothed` skips a
        // write when the change is under epsilon, and the gust is a slow ripple:
        // at 60 fps it moves these gains by well under a thousandth per frame, so
        // an epsilon set for the old (~16x larger) levels would quantise the gust
        // into about six steps and the bed would pump instead of breathe. These
        // are set so the write RATE is about what it was before — roughly one
        // automation event per param per three or four frames — at levels a
        // sixteenth the size.
        this.sLow = new Smoothed(this.gLow.gain, 0.18, 0.0002);
        this.sMid = new Smoothed(this.gMid.gain, 0.18, 0.0001);
        this.sTop = new Smoothed(this.gTop.gain, 0.12, 0.00005);
        this.sLowF = new Smoothed(this.fLow.frequency, 0.25, 10);
        this.sMidF = new Smoothed(this.fMid.frequency, 0.25, 14);
        this.sMidQ = new Smoothed(this.fMid.Q, 0.30, 0.05);
        this.sTopF = new Smoothed(this.fTop.frequency, 0.18, 25);
        this.sTopQ = new Smoothed(this.fTop.Q, 0.25, 0.06);
        this.sPan = new Smoothed(this.pan.pan, 0.30, 0.02);

        this.level = 0;
    }

    /**
     * Swap the generated-noise sources for a real wind recording. Called once,
     * by audio.js, when `wind_loop.ogg` has decoded; never on the frame path.
     *
     * The three layers keep their own loopers at the constructor's three rates
     * so they stay decorrelated, each into its EXISTING filter — the Smoothed
     * schedules on the gains and frequencies are untouched, which is what
     * keeps the measured rest/sprint envelope.
     *
     * The makeups are set by measurement (`_harness/spellprobe.py calib`,
     * 2026-08-04): per layer, the A-weighted level of the adopted bed at
     * makeup 1 against the same layer on generated noise, at rest and at
     * sprint. The recording's energy is concentrated low, so the bandpasses
     * take much less from it than they took from white noise — the mid
     * arrives 17.8 dB down at rest and 22.9 dB down at sprint (its centre
     * climbs into ever-weaker recorded content, hence the rest/sprint pair),
     * the top ~25.5 dB down, the pink-fed low ~8 dB down. These constants put
     * each layer back on the envelope the mix was tuned to.
     * @param {AudioBuffer} buffer
     * @returns {void}
     */
    adopt(buffer) {
        const ctx = this.ctx;
        const old = [this.srcLow, this.srcMid, this.srcTop];
        this.srcLow = looper(ctx, buffer, 1.0, this.fLow);
        this.srcMid = looper(ctx, buffer, 0.83, this.fMid);
        this.srcTop = looper(ctx, buffer, 1.19, this.fTop);
        for (let i = 0; i < old.length; i++) {
            old[i].stop();
            old[i].disconnect();
        }
        this.mkLow0 = 2.44; this.mkLow1 = 2.75;
        this.mkMid0 = 7.77; this.mkMid1 = 14.04;
        this.mkTop0 = 18.86; this.mkTop1 = 19.09;
    }

    /**
     * @param {number} now `ctx.currentTime`
     * @param {number} t elapsed seconds, for the gust
     * @param {number} strength `S.windStrength`, 0..2
     * @param {number} speed01 player speed, normalised
     * @param {number} surf 0..1 surf blend
     * @param {number} pan -1..1, the wind bearing relative to the camera
     * @param {number} sfx `FFG.sfxVolume`
     * @returns {void}
     */
    drive(now, t, strength, speed01, surf, pan, sfx) {
        const w = clamp(strength, 0, 2);
        const sp = clamp(speed01, 0, 1);

        // Two incommensurable periods, so the gust never audibly repeats. A
        // noise-driven gust would need a third noise source and an LFO chain for
        // a result no one could tell apart from this.
        const gust = 0.62 + 0.38 * (0.6 * Math.sin(t * 0.23) + 0.4 * Math.sin(t * 0.517 + 1.7));

        // The three levels. Read the coefficients as (rest, weather, motion): the
        // first term is what you hear standing still on a calm day and is
        // deliberately almost nothing; the third dominates, which is what makes
        // the bed answer the player. See the class docblock for the measurements
        // these were set from — they are not eyeballed.
        const low = (0.010 + 0.020 * w + 0.150 * sp) * gust * sfx
            * (this.mkLow0 + (this.mkLow1 - this.mkLow0) * sp);
        const mid = (0.004 + 0.008 * w + 0.115 * sp) * gust * sfx
            * (this.mkMid0 + (this.mkMid1 - this.mkMid0) * sp);
        const top = (0.0005 + 0.0015 * w + 0.055 * sp * sp + 0.030 * surf * sp) * sfx
            * (this.mkTop0 + (this.mkTop1 - this.mkTop0) * sp);

        this.sLow.write(low, now);
        this.sMid.write(mid, now);
        this.sTop.write(top, now);
        this.sLowF.write(190 + 210 * w + 250 * sp, now);
        this.sMidF.write(420 + 380 * w + 600 * sp, now);
        // Narrow at rest, opening with speed: the band this passes is f/Q wide, so
        // this is the difference between a moan and a hiss at the same level.
        this.sMidQ.write(2.2 - 1.35 * sp, now);
        this.sTopF.write(1900 + 900 * w + 2200 * sp, now);
        this.sTopQ.write(1.4 + 3.0 * sp, now);
        this.sPan.write(clamp(pan, -1, 1) * 0.55, now);

        this.level = low + mid + top;
    }

    /** @param {number} now @returns {void} */
    silence(now) {
        this.sLow.reset(0, now);
        this.sMid.reset(0, now);
        this.sTop.reset(0, now);
        this.level = 0;
    }

    /** Layers currently audible. @returns {number} */
    get live() {
        return this.level > 0.002 ? 3 : 0;
    }
}

// ---------------------------------------------------------------------- surf

/**
 * The snow-surf bed: a speed- and carve-modulated hiss over a low body.
 */
export class SurfBed {
    /**
     * @param {AudioContext} ctx
     * @param {AudioBuffer} white
     * @param {AudioBuffer} pink
     * @param {AudioNode} dest
     */
    constructor(ctx, white, pink, dest) {
        this.ctx = ctx;
        this.pan = panner(ctx, dest);

        this.gHiss = gain(ctx, 0, this.pan);
        this.fHiss = filter(ctx, "bandpass", 1600, 0.9, this.gHiss);
        this.srcHiss = looper(ctx, white, 1.07, this.fHiss);

        this.gBody = gain(ctx, 0, this.pan);
        this.fBody = filter(ctx, "lowpass", 140, 0.9, this.gBody);
        looper(ctx, pink, 0.71, this.fBody);

        this.sHiss = new Smoothed(this.gHiss.gain, 0.09, 0.0015);
        this.sBody = new Smoothed(this.gBody.gain, 0.09, 0.0015);
        this.sHissF = new Smoothed(this.fHiss.frequency, 0.10, 18);
        this.sHissQ = new Smoothed(this.fHiss.Q, 0.10, 0.06);
        this.sBodyF = new Smoothed(this.fBody.frequency, 0.14, 8);
        this.sPan = new Smoothed(this.pan.pan, 0.12, 0.02);

        /** Written only after `adopt` — playbackRate on the recorded slide. */
        this.sRate = null;
        this.mkHiss = 1.0;

        this.level = 0;
    }

    /**
     * Swap the white-noise hiss for the recorded board-on-snow slide loop.
     * Called once, off the frame path, when `surf_slide_loop.ogg` decodes.
     * The pink-noise low body STAYS — the recording carries the scrape and
     * grain, the body carries the weight, same division as before.
     *
     * playbackRate becomes the speed knob the synth never had: a faster carve
     * is a faster, brighter slide, driven through a Smoothed in `drive()` so
     * it costs writes only when speed actually changes. The carve resonance
     * (frequency + Q on the SAME bandpass) is untouched.
     *
     * mkHiss is measured (`_harness/spellprobe.py calib`, 2026-08-04): the
     * slide recording through the hiss bandpass arrives 10.9 dB quieter than
     * white noise did (10.5 dB in a hard carve — near-constant, so one
     * number), and the makeup restores the tuned carve-swell level.
     * @param {AudioBuffer} buffer
     * @returns {void}
     */
    adopt(buffer) {
        const old = this.srcHiss;
        this.srcHiss = looper(this.ctx, buffer, 1.0, this.fHiss);
        old.stop();
        old.disconnect();
        this.sRate = new Smoothed(this.srcHiss.playbackRate, 0.12, 0.01);
        this.mkHiss = 3.45;
    }

    /**
     * @param {number} now
     * @param {number} surf 0..1, the eased surf blend
     * @param {number} speed01
     * @param {number} carve signed carve, -1..1
     * @param {number} sfx
     * @returns {void}
     */
    drive(now, surf, speed01, carve, sfx) {
        const s = clamp(surf, 0, 1);
        const sp = clamp(speed01, 0, 1);
        const load = clamp(Math.abs(carve) * 1.6, 0, 1);
        // Below a walk the board is not cutting anything, so the bed must not be
        // audible merely because the surf flag is up.
        const v = s * (0.14 + 0.86 * sp) * sfx;

        // The `load` coefficients are large relative to the base because Q and
        // gain pull against each other here: narrowing the band to focus the
        // carve also throws away most of the noise energy passing through it.
        // MEASURED on the master bus with the bed isolated — at Q 0.8 a hard
        // carve with the base coefficients came out QUIETER than no carve at
        // all, which is the exact opposite of the swell this is for.
        this.sHiss.write(v * (0.26 + 0.55 * load) * this.mkHiss, now);
        this.sBody.write(v * (0.13 + 0.09 * load), now);
        // The recorded slide tracks speed with pitch as well as gain: a slow
        // drift is a low soft scrape, a full sprint is up near the recording's
        // native rate. Range set to stay inside natural board-on-snow reading.
        if (this.sRate) this.sRate.write(0.72 + 0.42 * sp + 0.10 * load, now);
        this.sHissF.write(1500 + 2000 * sp + 900 * load, now);
        // Q is the carve: a loaded edge is a narrower, more focused spray note.
        // Deliberately a modest sweep. Q 4+ sounded right in isolation but
        // measured IDENTICAL in level to no carve at all, because the band it
        // throws away is exactly the gain the line above adds back. The focus
        // now comes mostly from the centre frequency rising, which costs no
        // energy, and Q only tightens it.
        this.sHissQ.write(0.8 + 1.6 * load, now);
        this.sBodyF.write(95 + 200 * sp, now);
        this.sPan.write(clamp(carve * 0.55, -0.6, 0.6), now);

        this.level = v;
    }

    /** @param {number} now @returns {void} */
    silence(now) {
        this.sHiss.reset(0, now);
        this.sBody.reset(0, now);
        this.level = 0;
    }

    /** @returns {number} */
    get live() {
        return this.level > 0.002 ? 2 : 0;
    }
}

// -------------------------------------------------------------------- crunch

/** Footfall, jump take-off and landing — one synth, four pooled voices. */
export class CrunchPool {
    /**
     * @param {AudioContext} ctx
     * @param {AudioBuffer} white
     * @param {AudioNode} dest
     * @param {number} [count]
     */
    constructor(ctx, white, dest, count) {
        const n = count || 4;
        /** @type {{g:GainNode,f:BiquadFilterNode,p:StereoPannerNode,src:AudioBufferSourceNode,until:number}[]} */
        this.voices = [];
        for (let i = 0; i < n; i++) {
            const p = panner(ctx, dest);
            const g = gain(ctx, 0, p);
            const f = filter(ctx, "bandpass", 1200, 0.8, g);
            const src = looper(ctx, white, 1 + i * 0.09, f);
            this.voices.push({ g, f, p, src, until: 0 });
        }
        this.next = 0;
        this.ctx = ctx;
    }

    /**
     * @param {number} now
     * @param {number} band bandpass centre, Hz
     * @param {number} q
     * @param {number} rate noise playback rate — the grain-size knob
     * @param {number} peak
     * @param {number} decay
     * @param {number} grainAt seconds to the second grain, 0 for a single hit
     * @param {number} pan
     * @returns {void}
     */
    fire(now, band, q, rate, peak, decay, grainAt, pan) {
        const v = this.voices[this.next];
        this.next = (this.next + 1) % this.voices.length;
        v.f.frequency.setValueAtTime(band, now);
        v.f.Q.setValueAtTime(q, now);
        v.src.playbackRate.setValueAtTime(rate, now);
        v.p.pan.setValueAtTime(clamp(pan, -1, 1), now);
        v.until = crunchEnv(v.g.gain, now, peak, decay, grainAt);
    }

    /** @param {number} now @returns {void} */
    silence(now) {
        for (let i = 0; i < this.voices.length; i++) {
            const v = this.voices[i];
            v.g.gain.cancelScheduledValues(now);
            v.g.gain.setValueAtTime(0, now);
            v.until = 0;
        }
    }

    /** @returns {number} */
    get live() {
        const now = this.ctx.currentTime;
        let n = 0;
        for (let i = 0; i < this.voices.length; i++) if (this.voices[i].until > now) n++;
        return n;
    }
}

// --------------------------------------------------------------------- thump

/** The low end of a landing: a sine that falls. */
export class ThumpPool {
    /**
     * @param {AudioContext} ctx
     * @param {AudioNode} dest
     * @param {number} [count]
     */
    constructor(ctx, dest, count) {
        const n = count || 2;
        /** @type {{g:GainNode,o:OscillatorNode,until:number}[]} */
        this.voices = [];
        for (let i = 0; i < n; i++) {
            const g = gain(ctx, 0, dest);
            const o = osc(ctx, "sine", 70, g);
            this.voices.push({ g, o, until: 0 });
        }
        this.next = 0;
        this.ctx = ctx;
    }

    /**
     * @param {number} now
     * @param {number} f0
     * @param {number} f1
     * @param {number} peak
     * @param {number} dur
     * @returns {void}
     */
    fire(now, f0, f1, peak, dur) {
        const v = this.voices[this.next];
        this.next = (this.next + 1) % this.voices.length;
        glide(v.o.frequency, now, f0, f1, dur * 0.7);
        v.until = hitEnv(v.g.gain, now, peak, 0.006, dur);
    }

    /** @param {number} now @returns {void} */
    silence(now) {
        for (let i = 0; i < this.voices.length; i++) {
            const v = this.voices[i];
            v.g.gain.cancelScheduledValues(now);
            v.g.gain.setValueAtTime(0, now);
            v.until = 0;
        }
    }

    /** @returns {number} */
    get live() {
        const now = this.ctx.currentTime;
        let n = 0;
        for (let i = 0; i < this.voices.length; i++) if (this.voices[i].until > now) n++;
        return n;
    }
}

// -------------------------------------------------------------------- spells

/**
 * Recorded-spell levels, pre-master and pre-`FFG.sfxVolume`, applied through
 * the SampleBank's pooled player. NOT comparable to the synth peaks below them
 * — the synth voices pay ~12 dB of bandpass insertion loss and these do not
 * (see the LEVEL_* block in audio.js for the full argument). Set by measuring
 * each recording through the master-chain replica against the bed at the speed
 * it plays over (`_harness/spellprobe.py`).
 */
const SMP_CRACK0 = 0.42;   // first fracture, the cast lands
const SMP_CRACK1 = 0.34;   // main break as the cluster grows
const SMP_CRACK2 = 0.30;   // debris scatter at full spiral
const SMP_SHIMMER = 0.055; // faint ice-crackle under the growth
const SMP_SWEEP = 0.50;    // surge swell
const SMP_BLOOM = 0.55;    // eruption + fallout
const SMP_VORTEX = 0.60;   // rising whorl

/** Where each crack lands across the ~1.6 s golden-spiral growth, seconds. */
const CRACK_AT_1 = 0.42;
const CRACK_AT_2 = 0.95;

/**
 * The five spell voices.
 *
 * Each is a fixed little graph, retriggerable, sharing one panner-per-voice so
 * a cast sits where the character is facing rather than dead centre. The
 * one-shot spells play recordings through the shared SampleBank when decoded;
 * every synth graph below survives as the fallback (samples.js: `play()`
 * returns false until a buffer is ready, and forever if its fetch failed).
 */
export class SpellVoices {
    /**
     * @param {AudioContext} ctx
     * @param {AudioBuffer} white
     * @param {AudioNode} dest
     * @param {import("./samples.js").SampleBank|null} [bank]
     */
    constructor(ctx, white, dest, bank) {
        this.ctx = ctx;
        this.bank = bank || null;
        this.ribReal = false;

        // ---- 1 Sweep: a crescent of water thrown along the ground -----------
        // A band that collapses from a spray to a rush, over a low sine that
        // gives the crescent mass. Short: it is a flick, not a wave.
        const sweepPan = panner(ctx, dest);
        this.sweepN = gain(ctx, 0, sweepPan);
        this.sweepF = filter(ctx, "bandpass", 2600, 1.5, this.sweepN);
        looper(ctx, white, 1.0, this.sweepF);
        this.sweepO = gain(ctx, 0, sweepPan);
        this.sweepOsc = osc(ctx, "sine", 200, this.sweepO);
        this.sweepPan = sweepPan;

        // ---- 2 Ribbon: the held cast ----------------------------------------
        // Sustained, and the only voice with a real attack/release rather than a
        // decay. The wobble is driven from the frame loop (see `driveRibbon`)
        // rather than from an LFO node: one JS sine is cheaper than an
        // oscillator plus a gain plus a connection, and it lets the wobble
        // follow the spell's own time base.
        const ribPan = panner(ctx, dest);
        this.ribN = gain(ctx, 0, ribPan);
        this.ribF = filter(ctx, "bandpass", 820, 3.6, this.ribN);
        this.ribSrc = looper(ctx, white, 0.93, this.ribF);
        this.ribO = gain(ctx, 0, ribPan);
        this.ribLp = filter(ctx, "lowpass", 320, 0.9, this.ribO);
        this.ribOsc = osc(ctx, "triangle", 108, this.ribLp);
        this.ribFS = new Smoothed(this.ribF.frequency, 0.05, 8);
        this.ribHeld = false;
        this.ribUntil = 0;

        // ---- 3 Bloom: water opening upward ----------------------------------
        // A lowpass that arcs open and settles, plus a descending sine. The arc
        // is what makes it read as a bloom rather than a splash.
        const bloomPan = panner(ctx, dest);
        this.bloomN = gain(ctx, 0, bloomPan);
        this.bloomF = filter(ctx, "lowpass", 400, 1.1, this.bloomN);
        looper(ctx, white, 0.88, this.bloomF);
        this.bloomO = gain(ctx, 0, bloomPan);
        this.bloomOsc = osc(ctx, "sine", 430, this.bloomO);
        this.bloomPan = bloomPan;

        // ---- 4 Crystallise: a struck bell ------------------------------------
        // Three INHARMONIC partials (1 : 2.756 : 5.404, near the classic tubular
        // ratios) with decreasing decay, plus a 12 ms noise tick for the strike.
        // Inharmonicity is the entire point: harmonic partials sound like a
        // flute, inharmonic ones sound like struck ice, and nothing else in this
        // mix is inharmonic.
        const cryPan = panner(ctx, dest);
        this.cryA = gain(ctx, 0, cryPan);
        this.cryB = gain(ctx, 0, cryPan);
        this.cryC = gain(ctx, 0, cryPan);
        this.cryOscA = osc(ctx, "sine", 1180, this.cryA);
        this.cryOscB = osc(ctx, "sine", 3252, this.cryB);
        this.cryOscC = osc(ctx, "sine", 6377, this.cryC);
        this.cryTick = gain(ctx, 0, cryPan);
        this.cryHp = filter(ctx, "highpass", 4800, 0.7, this.cryTick);
        looper(ctx, white, 1.31, this.cryHp);
        this.cryPan = cryPan;

        // ---- 5 Vortex: a rising airy whorl -----------------------------------
        // A high-Q band that climbs two and a half octaves, so it resolves from
        // a rumble into a whistle, with a sine climbing under it.
        const vorPan = panner(ctx, dest);
        this.vorN = gain(ctx, 0, vorPan);
        this.vorF = filter(ctx, "bandpass", 240, 5.0, this.vorN);
        looper(ctx, white, 1.11, this.vorF);
        this.vorO = gain(ctx, 0, vorPan);
        this.vorOsc = osc(ctx, "sine", 130, this.vorO);
        this.vorPan = vorPan;

        this.until = [0, 0, 0, 0, 0]; // per spell key 1..5, index key-1

        // Built here, not in `silence()`: blur and mute are not frame-path calls
        // but they are called from a listener that can fire during a frame, and
        // a twelve-element literal per call is exactly the kind of allocation
        // this build does not leave lying around.
        this._allGains = [
            this.sweepN, this.sweepO, this.ribN, this.ribO, this.bloomN, this.bloomO,
            this.cryA, this.cryB, this.cryC, this.cryTick, this.vorN, this.vorO,
        ];
    }

    /**
     * Swap the ribbon's white-noise band for the recorded stream loop. Called
     * once, off the frame path, when `spell_ribbon_stream.ogg` decodes. The
     * hold/release envelopes and the per-frame wobble on `ribF.frequency` are
     * untouched — the wobble now bends real water. The band WIDENS on adopt:
     * Q 3.6 was tuned to carve a watery voice out of flat noise; a recording
     * that already IS water needs only shaping, and through Q 3.6 it reads as
     * a whistle, not a stream.
     * @param {AudioBuffer} buffer
     * @returns {void}
     */
    adoptRibbon(buffer) {
        const old = this.ribSrc;
        this.ribSrc = looper(this.ctx, buffer, 1.0, this.ribF);
        old.stop();
        old.disconnect();
        this.ribF.Q.value = 1.15;
        this.ribReal = true;
    }

    /**
     * Fire a one-shot spell. Recording first, synth as the fallback — never
     * both: doubling a recording with the synth that imitated it puts two
     * uncorrelated sources in one band, the same mud audio.js documents for
     * the landing thump.
     * @param {number} key 1, 3, 4 or 5 — key 2 (Ribbon) is a hold, see `hold`
     * @param {number} now
     * @param {number} sfx
     * @param {number} pan
     * @returns {void}
     */
    fire(key, now, sfx, pan) {
        const bank = this.bank;
        if (key === 1) {
            if (bank && bank.play("sweep", now, SMP_SWEEP * sfx, 1.04, clamp(pan, -1, 1), 0.05)) {
                this.until[0] = now + 2.3;
                return;
            }
            this.sweepPan.pan.setValueAtTime(clamp(pan, -1, 1), now);
            glide(this.sweepF.frequency, now, 2800, 380, 0.5);
            glide(this.sweepOsc.frequency, now, 205, 78, 0.42);
            const a = hitEnv(this.sweepN.gain, now, 0.30 * sfx, 0.018, 0.46);
            const b = hitEnv(this.sweepO.gain, now, 0.16 * sfx, 0.014, 0.38);
            this.until[0] = a > b ? a : b;
            return;
        }
        if (key === 3) {
            if (bank && bank.play("bloom", now, SMP_BLOOM * sfx, 1.0, clamp(pan, -1, 1) * 0.6, 0.05)) {
                this.until[2] = now + 2.8;
                return;
            }
            this.bloomPan.pan.setValueAtTime(clamp(pan, -1, 1) * 0.6, now);
            arc(this.bloomF.frequency, now, 380, 2700, 620, 0.16, 0.72);
            glide(this.bloomOsc.frequency, now, 430, 112, 0.55);
            const a = hitEnv(this.bloomN.gain, now, 0.26 * sfx, 0.045, 0.70);
            const b = hitEnv(this.bloomO.gain, now, 0.13 * sfx, 0.030, 0.52);
            this.until[2] = a > b ? a : b;
            return;
        }
        if (key === 4) {
            // GLASS BREAKING, not a bell (owner's words). Three recorded
            // fractures staggered as the prism clusters land across the
            // ~1.6 s golden-spiral growth, a faint ice-crackle shimmer under
            // them. The recordings are broadband transients — spectral
            // flatness ~0.2-0.37 against the bell's 0.0000 — which is the
            // measured difference between a crack and a chime. The pitch
            // wander per cast comes from the bank's deterministic
            // scheduling-time jitter, so repeated casts are not one sample
            // on repeat. The bell below is unreachable while crack0 is
            // decoded; it remains only as the fetch-failure fallback.
            if (bank && bank.has("crack0")) {
                const p = clamp(pan, -1, 1) * 0.5;
                bank.play("crack0", now, SMP_CRACK0 * sfx, 1.0, p, 0.08);
                bank.play("shimmer", now + 0.08, SMP_SHIMMER * sfx, 1.0, p, 0.04);
                bank.play("crack1", now + CRACK_AT_1, SMP_CRACK1 * sfx, 0.96, p * 0.6, 0.08);
                bank.play("crack2", now + CRACK_AT_2, SMP_CRACK2 * sfx, 1.0, p * 1.3, 0.08);
                this.until[3] = now + CRACK_AT_2 + 1.4;
                return;
            }
            this.cryPan.pan.setValueAtTime(clamp(pan, -1, 1) * 0.5, now);
            // Detuned a few cents per cast so repeated crystallising is a chime
            // rather than a stuck sample. Deterministic: derived from the
            // scheduling time, not from Math.random.
            const cents = 1 + ((now * 7.13) % 1) * 0.014 - 0.007;
            this.cryOscA.frequency.setValueAtTime(1180 * cents, now);
            this.cryOscB.frequency.setValueAtTime(3252 * cents, now);
            this.cryOscC.frequency.setValueAtTime(6377 * cents, now);
            const a = hitEnv(this.cryA.gain, now, 0.150 * sfx, 0.004, 0.95);
            hitEnv(this.cryB.gain, now, 0.075 * sfx, 0.003, 0.50);
            hitEnv(this.cryC.gain, now, 0.038 * sfx, 0.002, 0.28);
            hitEnv(this.cryTick.gain, now, 0.070 * sfx, 0.001, 0.012);
            this.until[3] = a;
            return;
        }
        if (key === 5) {
            if (bank && bank.play("vortex", now, SMP_VORTEX * sfx, 1.06, 0, 0.05)) {
                this.until[4] = now + 3.1;
                return;
            }
            this.vorPan.pan.setValueAtTime(0, now);
            glide(this.vorF.frequency, now, 240, 2300, 0.92);
            glide(this.vorOsc.frequency, now, 128, 545, 0.92);
            const a = hitEnv(this.vorN.gain, now, 0.90 * sfx, 0.30, 0.68);
            const b = hitEnv(this.vorO.gain, now, 0.105 * sfx, 0.34, 0.60);
            this.until[4] = a > b ? a : b;
        }
    }

    /**
     * The Ribbon hold. Level-triggered, so it is safe to call every frame.
     * @param {boolean} held
     * @param {number} now
     * @param {number} sfx
     * @returns {void}
     */
    hold(held, now, sfx) {
        if (held === this.ribHeld) return;
        this.ribHeld = held;
        if (held) {
            // Two operating points, both measured (spellprobe.py calib,
            // 2026-08-04): the recorded stream through the widened band still
            // arrives ~5 dB under white noise through Q 3.6, so its held level
            // rises to put the real ribbon at the A-weighted level the synth
            // was tuned to; and the stream carries its own low body, so the
            // triangle underlay drops to a shadow of itself rather than
            // humming against real water.
            holdEnv(this.ribN.gain, now, (this.ribReal ? 0.46 : 0.34) * sfx, 0.14);
            holdEnv(this.ribO.gain, now, (this.ribReal ? 0.030 : 0.085) * sfx, 0.18);
            this.ribUntil = Infinity;
        } else {
            const a = releaseEnv(this.ribN.gain, now, 0.34);
            releaseEnv(this.ribO.gain, now, 0.40);
            this.ribUntil = a;
        }
    }

    /**
     * Per-frame wobble on the held Ribbon. No-op while it is closed.
     * @param {number} now
     * @param {number} t elapsed seconds
     * @returns {void}
     */
    driveRibbon(now, t) {
        if (!this.ribHeld) return;
        this.ribFS.write(820 + 260 * Math.sin(t * 3.1) + 120 * Math.sin(t * 7.7), now);
    }

    /** @param {number} now @returns {void} */
    silence(now) {
        const gains = this._allGains;
        for (let i = 0; i < gains.length; i++) {
            gains[i].gain.cancelScheduledValues(now);
            gains[i].gain.setValueAtTime(0, now);
        }
        this.ribHeld = false;
        this.ribUntil = 0;
        for (let i = 0; i < this.until.length; i++) this.until[i] = 0;
    }

    /** @returns {number} */
    get live() {
        const now = this.ctx.currentTime;
        let n = 0;
        for (let i = 0; i < this.until.length; i++) if (this.until[i] > now) n++;
        if (this.ribUntil > now) n++;
        return n;
    }
}
