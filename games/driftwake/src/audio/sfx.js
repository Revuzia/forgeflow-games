/**
 * DRIFTWAKE — the combat/spell SFX layer.
 *
 * What this file exists for: the never-locked filler pair (LMB bolt, key-1
 * frost arc), every impact, the enemy telegraph/death cues and the player hurt
 * thud had NO sound at all — audio.js's SpellVoices only answers the four
 * unlockable water spells (internal keys 1/3/4/5) and the ribbon. On a fresh
 * save those four are locked, so the two spells a new player actually has were
 * completely silent, which is exactly the owner's report ("spells have no
 * sound effects").
 *
 * SHAPE. A pooled one-shot player: VOICES (8) pooled output chains under one
 * master gain, plus one dedicated looping voice (the Great Vortex churn). An
 * EVENTS table maps event names to a recipe — recorded sample (assets/sfx/,
 * Kenney CC0, see LICENSES.md there) with a synthesized fallback, or synth
 * only. Generators call `sfx.trigger(name, x, y, z)` at the moment the thing
 * happens; world-positioned events attenuate 1/d against the character's
 * position and pan by bearing relative to the camera yaw.
 *
 * Events whose sound ALREADY ships in the calibrated SpellVoices layer
 * (wave ignite, bloom burst, spikes plant — voices.js, measured levels) are
 * `legacy: true`: this layer counts the trigger (so `sfx.stats` is the whole
 * combat-audio truth for a probe) and plays nothing, because doubling a
 * recording with a second source in the same band is the documented mud
 * audio.js already refuses to make (see its landing-thump note).
 *
 * HOUSE RULES HONOURED:
 *  · Lives UNDER audio.js's master chain: `attach()` receives audio.js's own
 *    master gain, so the shell Mute wrap, blur/sleep ramps and the soft
 *    limiter all apply. No second AudioContext is ever created.
 *  · `FFG.sfxVolume` (the shell's SOUND FX slider, ffg_shell.js) is applied
 *    at THIS layer's master gain and refreshed every frame — never cached
 *    across a slider move. `stats.masterGain` exposes the applied value.
 *  · DETERMINISTIC jitter: pitch wander is hashed off a trigger counter
 *    (imul/golden-ratio), never Math.random — same convention as samples.js.
 *  · Allocation: nothing on steady frames. A trigger allocates exactly one
 *    AudioBufferSourceNode on the sample path (single-use by spec — the same
 *    documented exemption samples.js carries); the synth path allocates
 *    nothing at all.
 *  · A trigger before unlock (menu, harness without a gesture) COUNTS and
 *    plays nothing — the counters are event truth, not audibility truth.
 *
 * Realm variation is pitch + a lowpass tilt (REALM table), not new samples:
 * Sand sits lower and duller, Ash lower and duller still, per the palette
 * doctrine that the mechanic is constant and only the fiction changes.
 */

import {
    noiseBuffer, looper, osc, gain, filter, panner,
    hitEnv, holdEnv, releaseEnv, glide,
} from "./graph.js";

/** The vendored recordings (assets/sfx/ — Kenney CC0, LICENSES.md there). */
const FILES = {
    hit_bolt_0: "hit_bolt_0.ogg",
    hit_bolt_1: "hit_bolt_1.ogg",
    hit_wave_0: "hit_wave_0.ogg",
    hit_wave_1: "hit_wave_1.ogg",
    hurt_0: "hurt_0.ogg",
    detonate_0: "detonate_0.ogg",
    death_0: "death_0.ogg",
    death_1: "death_1.ogg",
    arc_0: "arc_0.ogg",
    arc_1: "arc_1.ogg",
};

/**
 * The event table. Fields:
 *   legacy  counted here, VOICED by audio.js's SpellVoices (see file docblock)
 *   sample  recorded variants, round-robined by trigger count
 *   gain    linear, pre-master (master carries FFG.sfxVolume)
 *   rate    playbackRate base for the sample
 *   jitter  fractional deterministic pitch spread (±jitter/2)
 *   synth   noise recipe {band, q, rate, peak, decay} — the fallback when the
 *           sample has not decoded (or the whole voice, when no sample)
 *   tone    sine underlay {f0, f1, peak, dur} — weight under the noise
 *   world   attenuate/pan against the listener (events at the player skip it)
 */
const EVENTS = {
    // ---- casts ---------------------------------------------------------
    spell_bolt: {
        gain: 0.85,
        synth: { band: 1500, q: 1.1, rate: 1.30, peak: 0.42, decay: 0.10 },
        tone: { f0: 540, f1: 190, peak: 0.045, dur: 0.11 },
        jitter: 0.10,
    },
    spell_arc: {
        sample: ["arc_0", "arc_1"], gain: 0.40, rate: 1.12, jitter: 0.08,
        synth: { band: 3400, q: 2.4, rate: 1.25, peak: 0.26, decay: 0.16 },
    },
    spell_wave: { legacy: true },          // voiced: SpellVoices.fire(1)
    spell_bloom_burst: { legacy: true },   // voiced: SpellVoices.fire(3)
    spell_spikes_plant: { legacy: true },  // voiced: the crack stagger (key 4)
    spell_spikes_detonate: {               // Sand Explosion — no legacy voice
        sample: ["detonate_0"], gain: 0.62, rate: 0.72, jitter: 0.06, world: true,
        synth: { band: 320, q: 0.7, rate: 0.62, peak: 0.50, decay: 0.30 },
        tone: { f0: 120, f1: 46, peak: 0.20, dur: 0.30 },
    },
    /** The Great Vortex churn — the LOOP voice, see loopStart/loopStop. */
    spell_vortex: { loop: true },
    // ---- impacts -------------------------------------------------------
    hit_bolt: {
        sample: ["hit_bolt_0", "hit_bolt_1"], gain: 0.46, rate: 1.30,
        jitter: 0.12, world: true,
        synth: { band: 950, q: 1.0, rate: 1.05, peak: 0.34, decay: 0.10 },
    },
    hit_wave: {
        sample: ["hit_wave_0", "hit_wave_1"], gain: 0.52, rate: 0.92,
        jitter: 0.09, world: true,
        synth: { band: 520, q: 0.8, rate: 0.80, peak: 0.36, decay: 0.16 },
    },
    // ---- enemies -------------------------------------------------------
    enemy_windup: {                        // subtle — a cue, not an alarm
        gain: 0.30, world: true, jitter: 0.06,
        synth: { band: 2500, q: 6.0, rate: 1.0, peak: 0.20, decay: 0.11 },
        tone: { f0: 620, f1: 930, peak: 0.045, dur: 0.13 },
    },
    enemy_death: {
        sample: ["death_0", "death_1"], gain: 0.50, rate: 0.90,
        jitter: 0.09, world: true,
        synth: { band: 2400, q: 1.4, rate: 1.15, peak: 0.30, decay: 0.26 },
    },
    // ---- player --------------------------------------------------------
    player_hurt: {
        sample: ["hurt_0"], gain: 0.58, rate: 0.95, jitter: 0.07,
        tone: { f0: 92, f1: 50, peak: 0.16, dur: 0.20 },
        synth: { band: 420, q: 0.8, rate: 0.75, peak: 0.30, decay: 0.15 },
    },
    // ---- pickups -------------------------------------------------------
    /**
     * Health mote (combat/motes.js pickup edge) — the heal was completely
     * silent, the one piece of positive combat feedback with no sound on it.
     *
     * Synth only: no recording in FILES fits a chime, and the whole point of
     * the synth path is that a recipe is cheaper than a new asset. The grammar
     * is `enemy_windup` inverted — that cue RISES to warn (620 -> 930 Hz), and
     * this one rises further and brighter (700 -> 1240) to reward, which is
     * the pickup idiom every player already reads. Levels sit under
     * `enemy_windup`'s 0.30: a heal you walked into should be noticed, not
     * announced, and the boss payout drops eight of these at once — at 0.34
     * with the tone carrying most of it, eight overlapping picks stay inside
     * the master's headroom instead of hammering the limiter.
     *
     * `world: true` for the same reason every impact has it. At pickup range
     * (PICKUP_R = 0.85 m) the 1/d attenuation is unity by construction, so the
     * flag costs nothing here and keeps this row honest with the table.
     */
    pickup_mote: {
        gain: 0.34, world: true, jitter: 0.05,
        synth: { band: 5200, q: 3.2, rate: 1.45, peak: 0.14, decay: 0.08 },
        tone: { f0: 700, f1: 1240, peak: 0.085, dur: 0.17 },
    },
};

/** Realm timbre: pitch multiplier + lowpass tilt (Hz) on the sample chain. */
const REALM = {
    cold: { pitch: 1.0, tilt: 16000 },
    sand: { pitch: 0.94, tilt: 7200 },
    ash: { pitch: 0.88, tilt: 5400 },
};

const VOICES = 8;
/** 1/d falloff reference: full level inside this many metres. */
const REF_D = 7;
/** Beyond this, a world event is inaudible — skip the nodes, keep the count. */
const CULL_D = 60;

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

class SfxSystem {
    constructor() {
        /** @type {AudioContext|null} */
        this.ctx = null;
        this._attached = false;
        this._prefetched = false;

        /** Trigger counters, one fixed slot per event name. */
        this.counts = {};
        const names = Object.keys(EVENTS);
        for (let i = 0; i < names.length; i++) this.counts[names[i]] = 0;

        /** @type {Map<string, AudioBuffer>} */
        this._buffers = new Map();
        /** @type {Map<string, ArrayBuffer>} */
        this._raw = new Map();
        this.loaded = 0;
        this.failed = 0;
        /** @type {string|null} */
        this.error = null;

        /** @type {{p:StereoPannerNode,f:BiquadFilterNode,sg:GainNode,ng:GainNode,nf:BiquadFilterNode,og:GainNode,o:OscillatorNode,src:AudioBufferSourceNode|null,until:number}[]} */
        this.voices = [];
        this._next = 0;
        this._n = 0;               // global trigger counter — the jitter seed

        // Listener state, written each frame by update().
        this._lx = 0; this._ly = 0; this._lz = 0;
        this._yaw = 0;
        this._realm = REALM.cold;

        // The loop voice (vortex churn).
        this._loopG = null;
        this._loopF = null;
        this._loopOn = false;

        this._applied = 1;         // masterGain value last written
        this.master = null;
    }

    // ------------------------------------------------------------------ load

    /** Fetch the recordings. Needs no context; called from audio.js _listen. */
    prefetch() {
        if (this._prefetched) return;
        this._prefetched = true;
        const names = Object.keys(FILES);
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            let url;
            try {
                url = new URL("../../assets/sfx/" + FILES[name], import.meta.url).href;
            } catch (err) {
                url = "assets/sfx/" + FILES[name];
            }
            fetch(url).then((r) => {
                if (!r.ok) throw new Error(name + ": HTTP " + r.status);
                return r.arrayBuffer();
            }).then((buf) => {
                this._raw.set(name, buf);
                if (this.ctx) this._decode(name);
            }).catch((err) => this._fail(name, err));
        }
    }

    /** @param {string} name */
    _decode(name) {
        const raw = this._raw.get(name);
        if (!this.ctx || !raw) return;
        this._raw.delete(name);    // decodeAudioData detaches the buffer
        this.ctx.decodeAudioData(raw).then((buf) => {
            this._buffers.set(name, buf);
            this.loaded++;
        }).catch((err) => this._fail(name, err));
    }

    _fail(name, err) {
        this.failed++;
        if (!this.error) {
            this.error = name + ": " + (err && err.message ? err.message : String(err));
        }
    }

    // ----------------------------------------------------------------- graph

    /**
     * Build the pool under audio.js's master chain. Called once from
     * audio.js `_build()` — i.e. behind the same user-gesture unlock the rest
     * of the audio stack waits for.
     * @param {AudioContext} ctx
     * @param {AudioNode} dest audio.js's master gain (pre-limiter)
     */
    attach(ctx, dest) {
        if (this._attached) return;
        this._attached = true;
        this.ctx = ctx;

        const F = /** @type {{sfxVolume?:number}|undefined} */ (globalThis.FFG);
        this._applied = F && typeof F.sfxVolume === "number"
            ? clamp(F.sfxVolume, 0, 1) : 1;
        this.master = gain(ctx, this._applied, dest);

        const white = noiseBuffer(ctx, false, 0x7c3fb2e5);

        for (let i = 0; i < VOICES; i++) {
            const p = panner(ctx, this.master);
            // Sample chain: src -> sg -> f(lowpass, realm tilt) -> pan.
            const f = filter(ctx, "lowpass", 16000, 0.5, p);
            const sg = gain(ctx, 0, f);
            // Synth chain: noise -> nf(bandpass) -> ng -> pan, sine -> og -> pan.
            const ng = gain(ctx, 0, p);
            const nf = filter(ctx, "bandpass", 1200, 1.0, ng);
            const nsrc = looper(ctx, white, 1 + i * 0.07, nf);
            const og = gain(ctx, 0, p);
            const o = osc(ctx, "sine", 200, og);
            this.voices.push({ p, f, sg, ng, nf, nsrc, og, o, src: null, until: 0 });
        }

        // The vortex churn: noise through a mid band, gain closed until held.
        this._loopF = filter(ctx, "bandpass", 430, 2.2, this.master);
        this._loopG = gain(ctx, 0, this._loopF);
        // Order note: gain feeds filter here so the wobble-free band shapes the
        // held noise; source runs forever like every bed in voices.js.
        looper(ctx, white, 0.9, this._loopG);
        if (this._loopOn) this._holdLoop();   // vortex was up before unlock

        const names = Object.keys(FILES);
        for (let i = 0; i < names.length; i++) {
            if (this._raw.has(names[i])) this._decode(names[i]);
        }
    }

    // ----------------------------------------------------------------- frame

    /**
     * Per-frame follow, called from audio.js `update()` while the context is
     * running: master gain tracks the shell's SOUND FX slider, listener pose
     * tracks the character, realm timbre tracks the spell system.
     * @param {number} dt
     * @param {{position:{x:number,y:number,z:number}}|null} character
     * @param {number} yaw camera yaw (rig.yaw)
     * @param {string} realmKey "cold" | "sand" | "ash"
     */
    update(dt, character, yaw, realmKey) {
        const ctx = this.ctx;
        if (!ctx || !this.master) return;
        if (character && character.position) {
            this._lx = character.position.x;
            this._ly = character.position.y;
            this._lz = character.position.z;
        }
        this._yaw = yaw || 0;
        this._realm = REALM[realmKey] || REALM.cold;

        const F = /** @type {{sfxVolume?:number}|undefined} */ (globalThis.FFG);
        const v = F && typeof F.sfxVolume === "number" ? clamp(F.sfxVolume, 0, 1) : 1;
        if (Math.abs(v - this._applied) > 0.001) {
            this._applied = v;
            this.master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
        }
    }

    // --------------------------------------------------------------- trigger

    /**
     * One combat-audio event. ALWAYS counts; plays only with a running
     * context, a non-legacy recipe, and (for world events) an audible range.
     * @param {string} name a key of EVENTS
     * @param {number} [x] world position (omit for player-anchored events)
     * @param {number} [y]
     * @param {number} [z]
     */
    trigger(name, x, y, z) {
        const e = EVENTS[name];
        if (!e) return;
        this.counts[name]++;
        this._n++;
        if (e.legacy || e.loop) return;   // counted; voiced elsewhere / via loop
        const ctx = this.ctx;
        if (!ctx || ctx.state !== "running") return;

        // World placement: 1/d attenuation + bearing pan (port frame — the
        // same sin(bearing - yaw) identity audio.js uses for the wind).
        let att = 1;
        let pan = 0;
        if (e.world && x !== undefined) {
            const dx = x - this._lx;
            const dy = (y === undefined ? this._ly : y) - this._ly;
            const dz = z - this._lz;
            const d = Math.hypot(dx, dy, dz);
            if (d > CULL_D) return;
            att = d <= REF_D ? 1 : REF_D / d;
            if (d > 1.5) pan = Math.sin(Math.atan2(dx, -dz) - this._yaw) * 0.6;
        }

        // Deterministic per-trigger jitter (no Math.random on any path here).
        const h = (Math.imul(this._n ^ 0x9e3779b9, 2654435761) >>> 0);
        const u = ((h >>> 9) & 1023) / 1023 - 0.5;
        const jit = 1 + u * (e.jitter || 0);
        const R = this._realm;

        const now = ctx.currentTime;
        const v = this.voices[this._next];
        this._next = (this._next + 1) % VOICES;
        v.p.pan.setValueAtTime(clamp(pan, -1, 1), now);

        const level = e.gain * att;

        // Recording first, synth as the fallback — never both (voices.js rule).
        const smp = e.sample
            ? this._buffers.get(e.sample[this.counts[name] % e.sample.length])
            : null;
        if (smp) {
            if (v.src) {
                try { v.src.stop(); } catch (err) { /* already ended */ }
                v.src.disconnect();
                v.src = null;
            }
            const rate = clamp((e.rate || 1) * jit * R.pitch, 0.25, 4);
            const src = ctx.createBufferSource();   // single-use by spec
            src.buffer = smp;
            src.playbackRate.value = rate;
            src.connect(v.sg);
            v.f.frequency.setValueAtTime(R.tilt, now);
            v.sg.gain.cancelScheduledValues(now);
            v.sg.gain.setValueAtTime(level, now);
            src.start(now);
            const dur = smp.duration / rate;
            src.stop(now + dur + 0.02);
            v.src = src;
            v.until = now + dur;
        } else if (e.synth) {
            const s = e.synth;
            v.nf.frequency.setValueAtTime(s.band * R.pitch, now);
            v.nf.Q.setValueAtTime(s.q, now);
            v.nsrc.playbackRate.setValueAtTime(s.rate * jit, now);
            // `peak` is authored post-insertion-loss (the voices.js argument):
            // a bandpass on white noise costs ~12 dB, so these look large next
            // to the sample levels and must not be "tidied" to match them.
            v.until = hitEnv(v.ng.gain, now, s.peak * att, 0.006, s.decay);
        }
        if (e.tone) {
            const t = e.tone;
            glide(v.o.frequency, now, t.f0 * R.pitch * jit, t.f1 * R.pitch, t.dur * 0.7);
            const tu = hitEnv(v.og.gain, now, t.peak * att, 0.006, t.dur);
            if (tu > v.until) v.until = tu;
        }
    }

    // ------------------------------------------------------------------ loop

    /** @returns {void} */
    _holdLoop() {
        const ctx = this.ctx;
        if (!ctx || !this._loopG) return;
        holdEnv(this._loopG.gain, ctx.currentTime, 0.34, 0.45);
    }

    /**
     * Start a looping voice (the Great Vortex churn). Counted as a trigger.
     * @param {string} name
     */
    loopStart(name) {
        const e = EVENTS[name];
        if (!e || !e.loop) return;
        this.counts[name]++;
        this._n++;
        if (this._loopOn) return;
        this._loopOn = true;
        this._holdLoop();
    }

    /** @param {string} name */
    loopStop(name) {
        const e = EVENTS[name];
        if (!e || !e.loop || !this._loopOn) return;
        this._loopOn = false;
        const ctx = this.ctx;
        if (!ctx || !this._loopG) return;
        releaseEnv(this._loopG.gain, ctx.currentTime, 0.7);
    }

    // ---------------------------------------------------------- housekeeping

    /** Cut everything. Called from audio.js's `_silenceAll`. @param {number} now */
    silence(now) {
        for (let i = 0; i < this.voices.length; i++) {
            const v = this.voices[i];
            v.sg.gain.cancelScheduledValues(now);
            v.sg.gain.setValueAtTime(0, now);
            v.ng.gain.cancelScheduledValues(now);
            v.ng.gain.setValueAtTime(0, now);
            v.og.gain.cancelScheduledValues(now);
            v.og.gain.setValueAtTime(0, now);
            if (v.src) {
                try { v.src.stop(now); } catch (err) { /* already ended */ }
                v.src.disconnect();
                v.src = null;
            }
            v.until = 0;
        }
        if (this._loopG) {
            this._loopG.gain.cancelScheduledValues(now);
            this._loopG.gain.setValueAtTime(0, now);
        }
        // A silenced vortex loop re-opens only on the next loopStart edge.
        this._loopOn = false;
    }

    /** One-shot voices currently sounding, plus the loop while held. */
    get voicesActive() {
        if (!this.ctx) return 0;
        const now = this.ctx.currentTime;
        let n = this._loopOn ? 1 : 0;
        for (let i = 0; i < this.voices.length; i++) {
            if (this.voices[i].until > now) n++;
        }
        return n;
    }

    /**
     * The probe surface: trigger counters by name, live voices, the applied
     * master gain (which must equal the shell's SOUND FX slider), context
     * state, and sample-decode progress.
     */
    get stats() {
        return {
            triggers: this.counts,
            voicesActive: this.voicesActive,
            loopActive: this._loopOn,
            masterGain: this._applied,
            context: this.ctx ? this.ctx.state : "locked",
            samples: this.loaded + "/" + Object.keys(FILES).length +
                (this.error ? " failed: " + this.error : ""),
        };
    }
}

/**
 * The layer. One instance, imported by the generators (spellSystem, dart,
 * spellHits, bloom, crystallize, vortex, enemies) and by audio.js, which owns
 * its lifecycle (prefetch/attach/update/silence) and publishes it as
 * `SNOWFLOW.sfx`. Importing this module has no side effects.
 */
export const sfx = new SfxSystem();
