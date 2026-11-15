/**
 * DRIFTWAKE — sample loading and one-shot playback.
 *
 * The one place in this subsystem that DECODES a recording. Two consumers:
 * the one-shots (footsteps, landings, jump whoosh, the spell cracks and
 * splashes) play through this bank's pooled player via `play()`; the loop
 * beds (wind, surf slide, ribbon stream) only take their decoded buffer via
 * `bufferOrNull()` and own their looping source in voices.js, so a bed's loop
 * lives on its Smoothed-gain schedule, not on this one-shot pool. Every
 * consumer keeps a synthesised fallback in voices.js for the buffers that
 * never arrive.
 *
 * The assets are Kenney's CC0 "Impact Sounds" plus cuts from the Sonniss GDC
 * 2024 bundle, vendored under `assets/audio/` — see FILES below and CREDITS.md.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS POOLED AND WHAT IS NOT — the one allocation, and why it is unavoidable
 *
 * The rest of this subsystem allocates NOTHING after `_build()`: every source is
 * started once and left running, and a trigger is an envelope written onto a gain
 * that is already connected (graph.js, idea 2). Sample playback cannot fully hold
 * that line, and it is worth being exact about why rather than quietly breaking
 * the rule: an `AudioBufferSourceNode` is single-use by specification — `start()`
 * throws `InvalidStateError` if called a second time on the same node — so a
 * played sample MUST come from a fresh node.
 *
 * What this file does instead is pool everything downstream. Each voice owns a
 * GainNode and a StereoPannerNode built once at attach and connected once; a
 * trigger creates only the source, connects it to its voice's existing gain, and
 * hands the old source in that slot an explicit `stop()` + `disconnect()` first,
 * so the graph never grows and nothing is left for a finaliser to find. There is
 * no `onended` closure — that would be a second allocation per trigger, and a
 * closure allocated on the audio callback's schedule is exactly the kind of
 * garbage this frame has no headroom for.
 *
 * Net cost per footfall: one node. Footfalls happen about twice a second. Nothing
 * here runs per frame at all — `update()` never calls into this file unless an
 * edge fired.
 *
 * ---------------------------------------------------------------------------
 * LOADING, AND WHY IT CANNOT BLOCK
 *
 * Two phases, because they need different things:
 *
 *   `prefetch()` needs a page but NOT an AudioContext, so it runs at the first
 *   frame, alongside the gesture listeners. It issues the fetches and keeps the
 *   ArrayBuffers.
 *
 *   `attach(ctx, dest)` needs the context, so it runs at unlock — i.e. on the
 *   first click, by which time the network is usually already done. It chains
 *   `decodeAudioData` onto whatever each fetch resolves to.
 *
 * Nothing is awaited on the frame path. `play()` before a buffer is decoded
 * returns false and the caller falls back to the synthesised voice, so the game
 * is never silent while it loads and never stalls waiting to be loud. A missing
 * or corrupt file is the same story: `ready` stays false for that name forever,
 * the fallback stays in place, and the failure is visible on `SNOWFLOW.audio`
 * rather than thrown at a player.
 *
 * DETERMINISM (ARCHITECTURE.md §6). The per-trigger pitch jitter is derived from
 * the scheduling time, not `Math.random()` — the same convention the Crystallise
 * voice already uses for its per-cast detune.
 */

/**
 * The vendored set. Resolved against this module's own URL so the paths survive
 * the game being served from a sub-path, which is how it is deployed.
 *
 * Two provenances now, and CREDITS.md is the authority on both: the footsteps
 * and impacts are Kenney CC0; everything below the comment line is cut from the
 * Sonniss GDC 2024 bundle (royalty-free, embedding permitted, no attribution
 * required — credited anyway).
 */
const FILES = {
    step0: "footstep_snow_0.ogg",
    step1: "footstep_snow_1.ogg",
    step2: "footstep_snow_2.ogg",
    step3: "footstep_snow_3.ogg",
    step4: "footstep_snow_4.ogg",
    heavy0: "impact_heavy_0.ogg",
    heavy1: "impact_heavy_1.ogg",
    medium0: "impact_medium_0.ogg",
    medium1: "impact_medium_1.ogg",
    // ---- Sonniss GDC 2024 one-shots ------------------------------------
    crack0: "spell_crystal_crack_0.ogg",
    crack1: "spell_crystal_crack_1.ogg",
    crack2: "spell_crystal_crack_2.ogg",
    shimmer: "spell_crystal_shimmer.ogg",
    sweep: "spell_sweep_surge.ogg",
    bloom: "spell_bloom_splash.ogg",
    vortex: "spell_vortex_whoosh.ogg",
    whoosh: "jump_whoosh.ogg",
    // ---- Sonniss GDC 2024 loop beds ------------------------------------
    // Decoded like the one-shots but PLAYED nothing like them: `play()` never
    // fires these. The beds in voices.js take the decoded buffer via
    // `bufferOrNull()` and own their looping source, so the loop lives on the
    // bed's Smoothed-gain schedule, not on this bank's one-shot pool.
    windloop: "wind_loop.ogg",
    ribbonloop: "spell_ribbon_stream.ogg",
    surfloop: "surf_slide_loop.ogg",
};

/** How many footstep variants exist, for the round-robin. */
export const STEP_COUNT = 5;

/**
 * Round-robin stride. Co-prime with 5, so it still visits all five before
 * repeating, but the order is 0,2,4,1,3 rather than 0,1,2,3,4 — five samples
 * played in file order read as a five-step loop, which is the exact thing having
 * five samples was supposed to prevent.
 */
const STEP_STRIDE = 2;

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

export class SampleBank {
    /**
     * @param {number} [voices] pooled output slots
     */
    constructor(voices) {
        /** @type {Map<string, AudioBuffer>} decoded, keyed by the names in FILES */
        this.buffers = new Map();
        /** @type {Map<string, ArrayBuffer>} fetched, awaiting a context to decode with */
        this._raw = new Map();

        this._voiceCount = voices || 8;
        /** @type {{g:GainNode,p:StereoPannerNode,src:AudioBufferSourceNode|null,until:number}[]} */
        this.voices = [];
        this.next = 0;

        /** @type {AudioContext|null} */
        this.ctx = null;
        this._prefetched = false;
        this._attached = false;

        this._step = 0;

        // Counters, for the debug surface and for the harness to assert against.
        this.loaded = 0;
        this.failed = 0;
        /** @type {Set<string>} names whose fetch or decode failed for good */
        this._failedNames = new Set();
        /** @type {string|null} first load failure, whatever it was */
        this.error = null;
    }

    // ------------------------------------------------------------------ load

    /**
     * Start the downloads. No AudioContext needed and none created — this is
     * safe to call from the first frame, long before the player has clicked.
     * @returns {void}
     */
    prefetch() {
        if (this._prefetched) return;
        this._prefetched = true;
        const names = Object.keys(FILES);
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            let url;
            try {
                url = new URL("../../assets/audio/" + FILES[name], import.meta.url).href;
            } catch (err) {
                // No `import.meta.url` (a bundler that inlined this badly, a
                // non-module context). Relative to the document is the next best
                // guess and is right for the shipped layout.
                url = "assets/audio/" + FILES[name];
            }
            fetch(url).then((r) => {
                if (!r.ok) throw new Error(name + ": HTTP " + r.status);
                return r.arrayBuffer();
            }).then((buf) => {
                this._raw.set(name, buf);
                // The context may already exist — the player can click before a
                // 4 KB file lands on a cold cache. Decode straight away if so.
                if (this.ctx) this._decode(name);
            }).catch((err) => this._fail(name, err));
        }
    }

    /**
     * Give the bank a context and an output, and decode everything fetched so
     * far. Called once, from `audio.js`'s `_build()`.
     * @param {AudioContext} ctx
     * @param {AudioNode} dest
     * @returns {void}
     */
    attach(ctx, dest) {
        if (this._attached) return;
        this._attached = true;
        this.ctx = ctx;

        // The pooled output stage: source -> gain -> panner -> dest. Built once,
        // connected once, never rebuilt. Only the source is per-trigger.
        for (let i = 0; i < this._voiceCount; i++) {
            const p = ctx.createStereoPanner();
            p.connect(dest);
            const g = ctx.createGain();
            g.gain.value = 0;
            g.connect(p);
            this.voices.push({ g, p, src: null, until: 0 });
        }

        const names = Object.keys(FILES);
        for (let i = 0; i < names.length; i++) {
            if (this._raw.has(names[i])) this._decode(names[i]);
        }
    }

    /**
     * @param {string} name
     * @returns {void}
     */
    _decode(name) {
        const ctx = this.ctx;
        const raw = this._raw.get(name);
        if (!ctx || !raw) return;
        // Dropped before the call, not after: `decodeAudioData` DETACHES the
        // ArrayBuffer it is handed, so a second decode of the same name would be
        // handed a zero-length buffer and fail in a way that looks like a corrupt
        // asset. Removing it first makes a double-decode impossible instead.
        this._raw.delete(name);
        ctx.decodeAudioData(raw).then((buf) => {
            this.buffers.set(name, buf);
            this.loaded++;
        }).catch((err) => this._fail(name, err));
    }

    /**
     * @param {string} name
     * @param {*} err
     * @returns {void}
     */
    _fail(name, err) {
        this.failed++;
        this._failedNames.add(name);
        if (!this.error) this.error = name + ": " + (err && err.message ? err.message : String(err));
    }

    /**
     * A decoded buffer, or null. How the beds in voices.js collect their loop
     * material — they own the looping source; this bank only decodes.
     * @param {string} name
     * @returns {AudioBuffer|null}
     */
    bufferOrNull(name) {
        return this.buffers.get(name) || null;
    }

    /**
     * True once `name` has either decoded or definitively failed — i.e. there is
     * no point polling it again. What lets audio.js's loop-attach poll terminate
     * instead of testing a dead fetch every frame forever.
     * @param {string} name
     * @returns {boolean}
     */
    settled(name) {
        return this.buffers.has(name) || this._failedNames.has(name);
    }

    /** True once at least one buffer is playable. @returns {boolean} */
    get ready() {
        return this.buffers.size > 0;
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this.buffers.has(name);
    }

    // ------------------------------------------------------------------ play

    /**
     * Fire a one-shot.
     *
     * @param {string} name a key of FILES
     * @param {number} now `ctx.currentTime`
     * @param {number} level linear gain, already scaled by `FFG.sfxVolume` by the
     *                       caller (audio.js reads it fresh every trigger)
     * @param {number} rate playbackRate — pitch and duration together
     * @param {number} pan -1..1
     * @param {number} [jitter] fractional pitch spread, e.g. 0.06 for +/-3%
     * @returns {boolean} false if the sound is not loaded, so the caller can fall
     *                    back to the synthesised voice
     */
    play(name, now, level, rate, pan, jitter) {
        const ctx = this.ctx;
        const buf = this.buffers.get(name);
        if (!ctx || !buf || level <= 0) return false;

        const v = this.voices[this.next];
        this.next = (this.next + 1) % this.voices.length;

        // Reclaim the slot. Explicit rather than left to `onended`: a listener is
        // an allocation per trigger, and this is deterministic — by the time a
        // slot comes round again its sound is almost always finished anyway, and
        // when it is not, cutting it is the correct behaviour for a pool.
        if (v.src) {
            try { v.src.stop(); } catch (err) { /* already ended; not an error */ }
            v.src.disconnect();
            v.src = null;
        }

        // Deterministic jitter from the scheduling clock (ARCHITECTURE.md §6),
        // the same trick the Crystallise voice uses for its per-cast detune. A
        // round-robin of five identical-pitch footsteps still reads as five
        // footsteps; a few percent of wander is what stops the ear cataloguing
        // them. It shifts duration too, which is the point — a slower step is
        // also a longer one.
        const j = jitter || 0;
        const u = j > 0 ? ((now * 137.51) % 1) - 0.5 : 0;
        const r = clamp(rate * (1 + u * j), 0.25, 4);

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = r;
        src.connect(v.g);

        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setValueAtTime(level, now);
        v.p.pan.setValueAtTime(clamp(pan, -1, 1), now);
        src.start(now);

        const dur = buf.duration / r;
        // Bounded explicitly: a slot that is never re-used would otherwise hold a
        // finished source alive until the next trigger of the same index.
        src.stop(now + dur + 0.02);
        v.src = src;
        v.until = now + dur;
        return true;
    }

    /**
     * The next footstep in the round-robin.
     * @param {number} now
     * @param {number} level
     * @param {number} rate
     * @param {number} pan
     * @returns {boolean}
     */
    step(now, level, rate, pan) {
        this._step = (this._step + STEP_STRIDE) % STEP_COUNT;
        return this.play("step" + this._step, now, level, rate, pan, 0.09);
    }

    // ----------------------------------------------------------- housekeeping

    /**
     * Cut everything. Called on blur and on mute, alongside every other voice.
     * @param {number} now
     * @returns {void}
     */
    silence(now) {
        for (let i = 0; i < this.voices.length; i++) {
            const v = this.voices[i];
            v.g.gain.cancelScheduledValues(now);
            v.g.gain.setValueAtTime(0, now);
            if (v.src) {
                try { v.src.stop(now); } catch (err) { /* already ended */ }
                v.src.disconnect();
                v.src = null;
            }
            v.until = 0;
        }
    }

    /** Samples currently sounding. @returns {number} */
    get live() {
        if (!this.ctx) return 0;
        const now = this.ctx.currentTime;
        let n = 0;
        for (let i = 0; i < this.voices.length; i++) if (this.voices[i].until > now) n++;
        return n;
    }

    /** One line for the debug surface. @returns {string} */
    get status() {
        const total = Object.keys(FILES).length;
        if (this.error) return this.loaded + "/" + total + " loaded, failed: " + this.error;
        if (!this._prefetched) return "idle";
        if (!this._attached) return "fetching " + total;
        return this.loaded + "/" + total + " loaded";
    }
}
