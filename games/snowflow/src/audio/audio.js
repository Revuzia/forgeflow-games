/**
 * DRIFTWAKE — the audio subsystem.
 *
 * One export, one hook: `audio.update(dt, character, spells, rig)` is called
 * once per frame from `main.js` and everything else follows from what it reads.
 * Nothing in this subsystem is driven by an event fired out of game code, which
 * is deliberate — the alternative is a callback in the controller, the spell
 * system and the wake, i.e. three files this owner does not own.
 *
 * ---------------------------------------------------------------------------
 * WHY IT POLLS INSTEAD OF SUBSCRIBING
 *
 * Every trigger in here is an EDGE found by comparing this frame's state to last
 * frame's, held in fixed scalar fields:
 *
 *   footfall     `character.footfall` is already a one-frame flag.
 *   land / jump  `character.landed` / `character.jumped` when [JUMP] publishes
 *                them, with a fallback edge on `character.airborne` so this file
 *                works either side of that landing.
 *   spells 1/3/4/5  `spell.active` rising, OR `spell.t` going backwards while it
 *                is still active. The second clause is what catches a re-cast
 *                during an animation that has not finished — a rising edge alone
 *                silently drops every key mash after the first.
 *   spell 2      `spells.ribbon.held` is level-triggered, so it is simply
 *                mirrored onto a sustaining voice.
 *
 * That keeps `spells.cast(n)` and `SNOWFLOW.spells.cast(n)` on exactly the same
 * path — the harness and the console get sound for free, with no wrapper around
 * anyone else's method.
 *
 * ---------------------------------------------------------------------------
 * THE THREE HOUSE RULES THIS FILE IS SHAPED BY
 *
 *  · MUTE IS THE SHELL'S. `game_controls.js` wraps the `AudioContext`
 *    constructor before any game code runs, so the page-level Mute button
 *    suspends whatever a game creates. This file therefore constructs the
 *    context through `globalThis.AudioContext` AT UNLOCK TIME and calls the
 *    context's own `resume()` — never a cached native constructor and never a
 *    stashed `__ffResume`, both of which would route around the wrap and give
 *    the player a Mute button that does not mute.
 *
 *  · `FFG.sfxVolume` IS READ FRESH. The shell publishes it and the settings
 *    panel moves it; a cached copy is a slider that does nothing. It is read on
 *    every trigger and every frame, never stored.
 *
 *  · A CONTEXT NEEDS A GESTURE. Nothing exists until the first real pointer or
 *    key event, at which point the graph is built and the context resumed. Until
 *    then `update()` is a single boolean test. This is also why the shot battery
 *    is unaffected: `bootcheck.py` and `shoot.py` never dispatch a gesture, so no
 *    context is ever created during a screenshot run.
 *
 * ---------------------------------------------------------------------------
 * COST
 *
 * Roughly 75 nodes, all built once and left running. The audio graph itself
 * renders on the browser's audio thread, not the frame thread; what this file
 * costs the frame is ~20 float comparisons and, typically, two or three
 * `setTargetAtTime` calls — `Smoothed` suppresses the rest (graph.js). Nothing
 * allocates after `_build()`, which runs once, on a click.
 */

import { S } from "../core/settings.js";
import { noiseBuffer, gain } from "./graph.js";
import { WindBed, SurfBed, CrunchPool, ThumpPool, SpellVoices } from "./voices.js";
import { SampleBank } from "./samples.js";

const DEG = Math.PI / 180;

/**
 * Levels for the recorded one-shots (samples.js), pre-`FFG.sfxVolume`.
 *
 * These are NOT comparable to the synthesised levels a few lines down in
 * `update()` and must not be "tidied" to match them. The synth voices are white
 * noise through a bandpass, which throws away everything outside the band and
 * costs about 12 dB of insertion loss, so their gains are written post-loss and
 * look large. A decoded sample has no such loss: it arrives at the gain node at
 * the level it was recorded at (these decode at about -1.4 dBFS peak). A number
 * here therefore means roughly ten times what the same number means there.
 *
 * Set by measurement, not by eye — see `_harness/levelprobe.py`, which renders
 * each of these through a replica of the master chain below and reports the
 * A-weighted momentary level against the wind bed they have to sit on top of.
 *
 * They are measured against the bed AT THE SPEED THEY OCCUR, which is the only
 * comparison that means anything: `controller.js` ties `footImpact` to the same
 * speed that drives the bed (line 462), so a footfall is never heard over the
 * standstill bed — checking it against that number would be checking it against a
 * bed that cannot be playing at the time. Measured, at `windStrength` 1.0:
 *
 *     footfall at a walk   -35.37 dBFS(A)  =  +5.9 dB over the walk bed
 *     landing, hard        -34.16 dBFS(A)  =  +7.1 dB over the walk bed
 *     footfall at a sprint -32.35 dBFS(A)  =  +0.8 dB over the run bed
 *
 * and the worst case the limiter ever sees — a hard landing and a sprinting
 * footfall in the same 20 ms — peaks at -10.4 dBFS, i.e. it does not clip.
 *
 * That last one is not a mistake: at a full sprint the wind is supposed to be
 * winning. The number that matters is the walk, which is where a player spends
 * their time and where the old mix put the footfall just +1.6 dB clear.
 */
const LEVEL_STEP = 0.58;    // one footfall
const LEVEL_LAND = 0.88;    // the body hitting snow
const LEVEL_CRUST = 0.57;   // the crust breaking under it, layered over the body

/** Gesture events any one of which is enough to start a context. */
const GESTURES = ["pointerdown", "mousedown", "keydown", "touchstart"];

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The shell's SFX scale, read fresh every time (house rule 2 above).
 * @returns {number}
 */
function sfxVolume() {
    const F = /** @type {{sfxVolume?:number}|undefined} */ (globalThis.FFG);
    const v = F && typeof F.sfxVolume === "number" ? F.sfxVolume : 1;
    return v > 0 ? (v > 1 ? 1 : v) : 0;
}

class AudioSystem {
    constructor() {
        /** @type {AudioContext|null} */
        this.ctx = null;
        /** @type {string|null} last construction failure, for the debug surface */
        this.error = null;

        this._built = false;
        this._listening = false;
        this._muted = false;
        this._volume = 0.8;
        this._suspended = false;
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._sleepTimer = null;

        this._time = 0;

        /**
         * Frames left to keep looking for the globals to attach to. Not once:
         * `SNOWFLOW` is published at the end of boot and `DRIFTWAKE` may be
         * aliased later still by the shell owner, so the check runs for the
         * first few seconds and then costs one integer compare forever.
         */
        this._publishFrames = 240;

        // ---- edge-detection state. Fixed fields, never reallocated. --------
        this._prevAirborne = false;
        this._prevSurf = 0;
        /** Alternates the two impact recordings per weight, landing to landing. */
        this._impactAlt = false;
        // Per spell key 1,3,4,5 -> slots 0..3: last frame's `active` and `t`.
        this._spellActive = [false, false, false, false];
        this._spellT = [0, 0, 0, 0];

        /** @type {WindBed|null} */ this.wind = null;
        /** @type {SurfBed|null} */ this.surf = null;
        /** @type {CrunchPool|null} */ this.crunch = null;
        /** @type {ThumpPool|null} */ this.thump = null;
        /** @type {SpellVoices|null} */ this.spellVoices = null;

        /**
         * The recorded one-shots. Constructed here rather than in `_build()`
         * because it must start FETCHING before there is a context — see
         * `_listen()`. It holds no audio nodes until `attach()`.
         */
        this.samples = new SampleBank(8);

        this._onGesture = () => this.unlock();
        this._onSleep = () => this._sleep();
        this._onWake = () => this._wake();
        this._onMuteChange = (e) => {
            // The shell's own Mute button. Mirrored so `SNOWFLOW.audio.muted`
            // reports the truth rather than this subsystem's private opinion.
            const d = e && e.detail;
            if (d && typeof d.muted === "boolean") this._applyMute(d.muted);
        };
    }

    // ------------------------------------------------------------ lifecycle

    /**
     * Attach to the harness global(s).
     *
     * Done from here rather than by adding a member to `main.js`'s object
     * literal, because that literal is the ARCHITECTURE §2 contract the
     * comparison harness pins against and this owner does not edit it.
     * @returns {void}
     */
    _publish() {
        this._publishFrames--;
        const SF = globalThis.SNOWFLOW;
        if (SF && !SF.audio) SF.audio = this;
        const DW = globalThis.DRIFTWAKE;
        if (DW && DW !== SF && !DW.audio) DW.audio = this;
    }

    /**
     * Install the gesture and focus listeners. Called from the first `update()`
     * rather than at import, so importing this module (as `modulecheck.html`
     * does, with no page behind it) has no side effects.
     * @returns {void}
     */
    _listen() {
        if (this._listening) return;
        this._listening = true;
        // Start the downloads here, on the first frame, NOT at unlock: the four
        // hundred milliseconds between the page being interactive and the player
        // clicking it are free, and 37 KB of .ogg fetched in that window means
        // the first footstep after unlock is already a recording rather than the
        // synthesised fallback. No AudioContext is created or needed by this —
        // decoding happens later, in `_build()`.
        this.samples.prefetch();
        for (let i = 0; i < GESTURES.length; i++) {
            window.addEventListener(GESTURES[i], this._onGesture, { passive: true });
        }
        window.addEventListener("blur", this._onSleep);
        window.addEventListener("focus", this._onWake);
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) this._sleep();
            else this._wake();
        });
        window.addEventListener("mutechange", this._onMuteChange);
    }

    /**
     * Create the context and the graph. Safe to call repeatedly; the first call
     * with a live user gesture behind it is the one that does the work.
     * @returns {void}
     */
    unlock() {
        if (this._built) {
            // Already up. A later gesture is not wasted: it re-resumes, which is
            // how a context the browser suspended on its own (an idle tab, an
            // audio-device change) comes back without a reload. The listeners
            // are therefore never removed. Skipped while asleep, because `_wake`
            // owns that transition and owns the master ramp that goes with it.
            if (!this._suspended) this._resume();
            return;
        }
        try {
            const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!Ctor) {
                this.error = "no Web Audio in this browser";
                this._built = true; // stop retrying on every gesture
                return;
            }
            this.ctx = new Ctor();
            this._build();
            this._built = true;
            this._resume();
        } catch (err) {
            // Audio is not load-bearing: a browser that refuses a context must
            // still get the demo. Recorded on the debug surface rather than sent
            // through `loading.fail()`, which would replace the running scene
            // with the hard-failure panel over a missing bed of wind.
            this.error = err && err.message ? err.message : String(err);
            this.ctx = null;
            this._built = true;
        }
    }

    /** @returns {void} */
    _build() {
        const ctx = /** @type {AudioContext} */ (this.ctx);

        // Master chain: everything -> master gain -> soft limiter -> out.
        // The limiter is not colour, it is insurance: five spells, a surf bed and
        // four crunch voices can in principle all peak inside 30 ms, and clipping
        // the destination is the one audio failure a player unambiguously hears.
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -8;
        lim.knee.value = 6;
        lim.ratio.value = 6;
        lim.attack.value = 0.004;
        lim.release.value = 0.18;
        lim.connect(ctx.destination);

        // Opens from silence over 300 ms so unlocking mid-gust is not a thud.
        this.master = gain(ctx, 0, lim);
        this.master.gain.setValueAtTime(0, ctx.currentTime);
        this.master.gain.linearRampToValueAtTime(
            this._muted ? 0 : this._volume, ctx.currentTime + 0.3
        );

        const white = noiseBuffer(ctx, false, 0x5f3a91c7);
        const pink = noiseBuffer(ctx, true, 0x1d7be40b);

        this.wind = new WindBed(ctx, white, pink, this.master);
        this.surf = new SurfBed(ctx, white, pink, this.master);
        this.crunch = new CrunchPool(ctx, white, this.master, 4);
        this.thump = new ThumpPool(ctx, this.master, 2);
        this.spellVoices = new SpellVoices(ctx, white, this.master);

        // Decode whatever `prefetch()` has landed and build the pooled output
        // stage. Not awaited: `attach` returns immediately and the decodes
        // complete on their own, with `samples.play()` returning false — and the
        // synthesised voice taking over — until they do.
        this.samples.attach(ctx, this.master);
    }

    /** @returns {void} */
    _resume() {
        const ctx = this.ctx;
        if (!ctx) return;
        // The context's OWN resume — the shell replaced it with a wrapper that
        // holds off while the page is muted, and that wrapper is the point.
        if (ctx.state !== "running") ctx.resume();
        this._suspended = false;
        if (this._sleepTimer !== null) {
            clearTimeout(this._sleepTimer);
            this._sleepTimer = null;
        }
    }

    /**
     * Tab blurred or hidden: ramp out, silence every voice, then suspend so the
     * page costs nothing while it is not being looked at.
     * @returns {void}
     */
    _sleep() {
        const ctx = this.ctx;
        if (!ctx || this._suspended) return;
        this._suspended = true;
        const now = ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(this.master.gain.value, now);
        this.master.gain.linearRampToValueAtTime(0, now + 0.06);
        this._silenceAll(now);
        if (this._sleepTimer !== null) clearTimeout(this._sleepTimer);
        // After the ramp, not during it: suspending mid-ramp freezes the audio
        // clock with the master still open, and the tail is then still there on
        // the next focus.
        this._sleepTimer = setTimeout(() => {
            this._sleepTimer = null;
            if (this._suspended && ctx.state === "running") ctx.suspend();
        }, 120);
    }

    /** @returns {void} */
    _wake() {
        const ctx = this.ctx;
        if (!ctx || !this._suspended) return;
        this._resume();
        const now = ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(0, now);
        this.master.gain.linearRampToValueAtTime(this._muted ? 0 : this._volume, now + 0.25);
    }

    /** @param {number} now @returns {void} */
    _silenceAll(now) {
        this.wind?.silence(now);
        this.surf?.silence(now);
        this.crunch?.silence(now);
        this.thump?.silence(now);
        this.spellVoices?.silence(now);
        this.samples?.silence(now);
    }

    /** @param {boolean} m @returns {void} */
    _applyMute(m) {
        this._muted = !!m;
        const ctx = this.ctx;
        if (!ctx) return;
        const now = ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(this.master.gain.value, now);
        this.master.gain.linearRampToValueAtTime(this._muted ? 0 : this._volume, now + 0.08);
        if (this._muted) this._silenceAll(now + 0.09);
    }

    // -------------------------------------------------------------- the frame

    /**
     * The one hook `main.js` carries.
     *
     * @param {number} dt seconds
     * @param {import("../character/controller.js").CharacterController} character
     * @param {import("../spells/spellSystem.js").SpellSystem} spells
     * @param {import("../core/camera.js").CameraRig} rig
     * @returns {void}
     */
    update(dt, character, spells, rig) {
        if (!this._listening) this._listen();
        if (this._publishFrames > 0) this._publish();
        // The overwhelmingly common early-out: nothing has been clicked yet.
        const ctx = this.ctx;
        if (!ctx || this._suspended || ctx.state !== "running") return;

        this._time += dt;
        const now = ctx.currentTime;
        const t = this._time;
        const sfx = sfxVolume();

        const yaw = rig ? rig.yaw : 0;
        const speed01 = character ? character.speed01 : 0;
        const surfBlend = character ? character.surf : 0;

        // ------------------------------------------------------------- beds
        //
        // Wind bearing -> stereo. PORT FRAME (controller.js): forward is
        // (sin y, 0, -cos y) and right is (cos y, 0, sin y), so a wind blowing
        // along bearing w has direction (sin w, 0, -cos w) and its component on
        // the camera's right is sin(w)cos(y) - cos(w)sin(y) = sin(w - y).
        // Positive is therefore to the right, which is what StereoPanner wants.
        const windPan = Math.sin(S.windDirection * DEG - yaw);
        this.wind.drive(now, t, S.windStrength, speed01, surfBlend, windPan, sfx);
        this.surf.drive(now, surfBlend, speed01, character ? character.carve : 0, sfx);

        // Facing relative to the camera, used to place body-local one-shots in
        // the stereo field. Same identity as above.
        const facePan = character ? Math.sin(character.facing - yaw) : 0;

        // -------------------------------------------------------- footsteps
        if (character && character.footfall) {
            const imp = clamp(character.footImpact || 1, 0.2, 1.4);
            const side = character.footIndex === 0 ? -0.22 : 0.22;
            const pan = clamp(side + facePan * 0.25, -1, 1);

            // A recording of a boot in snow, five of them in rotation, or the
            // synthesised crunch if they have not decoded yet. `step()` returns
            // false rather than throwing or going silent, which is what lets the
            // fallback below be the whole of the error handling.
            //
            // A heavier footfall is SLOWER, not just louder: playbackRate carries
            // pitch and duration together, so dropping it deepens the crunch and
            // lengthens it at the same time, which is what a heavy boot does.
            const stepped = this.samples.step(
                now, LEVEL_STEP * imp * sfx, 1.06 - 0.10 * imp, pan
            );

            if (!stepped) {
                // The left/right alternation is also a timbre alternation — two
                // feet are not the same foot, and a strictly identical crunch on
                // both reads as a loop after four steps.
                const odd = character.footIndex === 1 ? 1 : 0;
                // The peak looks large next to the beds'. It is not: a band-pass
                // on white noise throws away everything outside the band, and
                // this one measured ~12 dB of insertion loss on the master bus.
                // At the "obvious" 0.105 a footfall came out at a peak of 0.027 —
                // i.e. inaudible under the bed it is supposed to punctuate. Every
                // crunch level here is post-loss.
                this.crunch.fire(
                    now,
                    1000 + 420 * odd + 260 * imp,      // band
                    0.75 + 0.15 * odd,                 // Q
                    0.92 + 0.22 * odd,                 // noise rate: grain size
                    0.40 * imp * sfx,                  // peak
                    0.115 + 0.03 * imp,                // decay
                    0.028,                             // second grain
                    pan
                );
            }
        }

        // ------------------------------------------------- jump and landing
        //
        // [JUMP] is adding `landed` / `landImpact` this phase. Both spellings are
        // handled: the explicit one-frame flags when they exist, and an edge on
        // `airborne` when they do not, so this file is correct either side of
        // that landing and needs no second visit.
        const airborne = character ? character.airborne === true : false;
        if (character) {
            const tookOff = character.jumped === true || (airborne && !this._prevAirborne);
            const landed = character.landed === true || (!airborne && this._prevAirborne);

            if (tookOff) {
                // Take-off is the crust letting go: brighter, shorter, no second
                // grain — the foot leaves, it does not settle.
                this.crunch.fire(now, 1450, 0.95, 1.05, 0.32 * sfx, 0.10, 0, facePan * 0.2);
            }
            if (landed) {
                const imp = clamp(
                    typeof character.landImpact === "number" ? character.landImpact : 1,
                    0.25, 1.6
                );
                const pan = facePan * 0.2;

                // A landing in snow is two events, and the recordings split along
                // exactly that line: Kenney's impactSoft files measured 100% of
                // their energy below 300 Hz with a spectral centroid of 68-93 Hz
                // — they ARE the body, with no crust in them at all — while the
                // footstep files carry the crust and almost nothing under 100 Hz.
                // So the landing is a soft impact with a slowed-down footstep
                // layered over it, which is what a body arriving in snow is.
                //
                // Two impact files per weight, alternated, so a run of landings
                // is not one sample on repeat.
                // 0.55, not 1.0: `controller.js` clamps `landImpact` to 0..1
                // (line 271), so a threshold up near the top of the range would
                // leave every ordinary jump landing on the light sample.
                const heavy = imp >= 0.55;
                const name = (heavy ? "heavy" : "medium") + (this._impactAlt ? 1 : 0);
                this._impactAlt = !this._impactAlt;

                if (this.samples.play(name, now, LEVEL_LAND * imp * sfx,
                    heavy ? 1.04 - 0.14 * imp : 1.16 - 0.16 * imp, pan, 0.07)) {
                    // The crust, over the body. Slowed well down: the same boot,
                    // arriving with a whole body behind it.
                    this.samples.step(now, LEVEL_CRUST * imp * sfx, 0.74, pan);
                    // NO `thump` here on purpose. The synthesised thump is a
                    // 78 -> 44 Hz sine, which is the same octave the impactSoft
                    // recording already occupies; firing both put two uncorrelated
                    // sources in one narrow band and the sum was mud, not weight.
                    // The recording is the thump now.
                } else {
                    // Not decoded yet — the original synthesised landing, intact.
                    // A landing is a heavier footstep — same synth, lower band,
                    // slower grain, longer tail — plus the low end a footstep has
                    // no business having.
                    this.crunch.fire(
                        now, 560 + 180 * imp, 0.6, 0.68, 0.60 * imp * sfx,
                        0.26 + 0.08 * imp, 0.042, pan
                    );
                    // The thump is a bare sine, so it loses almost nothing to a
                    // filter and its number is NOT scaled like the crunch above it.
                    this.thump.fire(now, 78, 44, 0.17 * imp * sfx, 0.20 + 0.06 * imp);
                }
            }
            this._prevAirborne = airborne;
        }

        // ------------------------------------------------------- surf entry
        // A carve starting is an event, not just a bed opening. One low scuff at
        // the moment the board bites.
        if (surfBlend > 0.5 && this._prevSurf <= 0.5 && speed01 > 0.1) {
            this.crunch.fire(now, 720, 0.8, 0.75, 0.42 * sfx, 0.30, 0.05, facePan * 0.3);
        }
        this._prevSurf = surfBlend;

        // ----------------------------------------------------------- spells
        if (spells) {
            this.spellVoices.hold(spells.ribbon ? spells.ribbon.held === true : false, now, sfx);
            this.spellVoices.driveRibbon(now, t);

            this._spellEdge(0, 1, spells.sweep, now, sfx, facePan);
            this._spellEdge(1, 3, spells.bloom, now, sfx, facePan);
            this._spellEdge(2, 4, spells.crystallize, now, sfx, facePan);
            this._spellEdge(3, 5, spells.vortex, now, sfx, facePan);
        }
    }

    /**
     * Fire a spell voice on a cast edge.
     *
     * Two clauses, and the second is the one that matters: a spell re-cast while
     * its animation is still running never drops `active`, but it does reset
     * `t` to zero. Watching only the rising edge of `active` loses every cast
     * after the first in a key mash, which is exactly how a player tests a spell.
     *
     * @param {number} slot 0..3, this voice's edge-state index
     * @param {number} key the spell key the voice answers
     * @param {{active:boolean,t:number}|undefined} spell
     * @param {number} now
     * @param {number} sfx
     * @param {number} pan
     * @returns {void}
     */
    _spellEdge(slot, key, spell, now, sfx, pan) {
        if (!spell) return;
        const active = spell.active === true;
        const t = typeof spell.t === "number" ? spell.t : 0;
        const fired = active && (!this._spellActive[slot] || t < this._spellT[slot]);
        this._spellActive[slot] = active;
        this._spellT[slot] = t;
        if (fired) this.spellVoices.fire(key, now, sfx, pan);
    }

    // ---------------------------------------------------- the debug surface

    /** `AudioContext.state`, or why there is no context. @returns {string} */
    get state() {
        if (this.error) return "failed: " + this.error;
        if (!this.ctx) return "locked";
        return this.ctx.state;
    }

    /** Voices currently sounding. @returns {number} */
    get voices() {
        if (!this.ctx || this.ctx.state !== "running") return 0;
        return (this.wind ? this.wind.live : 0) +
            (this.surf ? this.surf.live : 0) +
            (this.crunch ? this.crunch.live : 0) +
            (this.thump ? this.thump.live : 0) +
            (this.spellVoices ? this.spellVoices.live : 0) +
            (this.samples ? this.samples.live : 0);
    }

    /**
     * How the recorded one-shots are getting on, e.g. `"9/9 loaded"`. A silent
     * footstep is otherwise indistinguishable from a quiet one, and this is the
     * difference between "the assets 404ed" and "the mix is wrong".
     * @returns {string}
     */
    get sampleStatus() {
        return this.samples ? this.samples.status : "none";
    }

    /** @returns {boolean} */
    get muted() {
        return this._muted;
    }

    set muted(v) {
        this._applyMute(!!v);
    }

    /** @returns {number} */
    get masterVolume() {
        return this._volume;
    }

    set masterVolume(v) {
        this._volume = clamp(typeof v === "number" ? v : 0, 0, 1);
        const ctx = this.ctx;
        if (!ctx || this._muted) return;
        const now = ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setValueAtTime(this.master.gain.value, now);
        this.master.gain.linearRampToValueAtTime(this._volume, now + 0.06);
    }
}

/**
 * The subsystem. One instance, published on the harness global so the shell and
 * the debug overlay can drive it (`SNOWFLOW.audio.muted`,
 * `SNOWFLOW.audio.masterVolume`) and so a verification run can read
 * `SNOWFLOW.audio.state` and `SNOWFLOW.audio.voices`.
 *
 * Attached from here rather than added to `main.js`'s object literal because
 * that literal is the ARCHITECTURE §2 contract the comparison harness pins
 * against, and this owner does not edit it. `SNOWFLOW` is published in the same
 * synchronous block that schedules the first frame, so it exists by the time the
 * first `update()` runs; `DRIFTWAKE` is mirrored when the shell owner adds it.
 */
export const audio = new AudioSystem();
