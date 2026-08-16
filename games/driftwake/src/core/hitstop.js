/**
 * Hit-stop — a global time-dilation envelope over the frame clock.
 *
 * THE GAP THIS CLOSES (owner 2026-08-14): kills, heavy hits and the player
 * being struck all read at full speed — no impact frame, no "the world
 * noticed". _spec/COMBAT_DESIGN.md §9.4 specifies hit-stop at timeScale 0.05
 * with a global anti-strobe cap; this module is that system, tuned in the
 * owner's ms terms for the 60 fps target (at the 13–17 fps floor a stop is
 * simply one whole dilated frame, which is §9.4's frame-count floor).
 *
 * HOW IT PLUGS IN (main.js, three lines — construction, dt, update):
 *
 *     const hitstop = new HitStop(registry, enemies, rig);   // construction
 *     const dt = S.freezeTime ? 0 : hitstop.scale(dtMs / 1000);  // frame dt
 *     hitstop.update(dtMs / 1000);   // AFTER enemies.update, BEFORE endFrame
 *
 * `scale()` multiplies the raw wall dt by the envelope's current time scale;
 * every subsystem downstream (registry clock, AI, mixers, spells, audio)
 * dilates together, which is what makes a stop read as impact rather than a
 * dropped frame. The envelope itself advances on WALL time inside `update()`
 * — an envelope that consumed dilated time would stretch a 60 ms stop into
 * 1.2 s of wall clock at scale 0.05.
 *
 * EVENT FEEDS (both read-only):
 *   - the registry's per-frame event ring (kills, heavy hits, poise breaks).
 *     `update()` must therefore run after the combat pass has emitted this
 *     frame's events and before `registry.endFrame()` clears them — the same
 *     drain window floaters and XP already use.
 *   - `enemies.playerHurtPulse` / `playerHurtDirX/Z` — the player-hit
 *     counter enemies.js increments in `_hurtPlayer` (registry events only
 *     cover enemies; player health lives on the controller).
 *
 * THE RULES (owner numbers, verbatim):
 *   kill        60 ms at timeScale 0.05   (+ camera punch + micro-trauma)
 *   heavy hit   40 ms at 0.25             (damage >= 20, or a poise break)
 *   player hit  45 ms at 0.30             (+ camera punch away from source)
 *   - Ease-out: the scale recovers along a smoothstep over the envelope, so
 *     the release is a ramp, not a snap.
 *   - Never stacks past 90 ms: triggers landing mid-envelope may extend it
 *     only up to 90 ms measured from the burst's first trigger.
 *   - 250 ms cooldown after an envelope ends before a new one may begin —
 *     §9.4's anti-strobe rule; a multi-hit spell gets ONE stop, not five.
 *   - The scale never drops below 0.05, so the combat freeze rule
 *     (`dt === 0` strict no-op paths in enemies/meshEnemies) cannot trigger
 *     from a hit-stop: dt stays a small positive number.
 *
 * Allocation-free: all state is scalar; `update()` allocates nothing.
 */

// ------------------------------------------------------------- the numbers
const KILL_S = 0.060, KILL_SCALE = 0.05;
const HEAVY_S = 0.040, HEAVY_SCALE = 0.25;
const PLAYER_S = 0.045, PLAYER_SCALE = 0.30;
/** A single burst of stop may never exceed this, however many triggers. */
const STACK_CAP_S = 0.090;
/** Quiet time after a burst ends before the next may begin (§9.4 cap). */
const COOLDOWN_S = 0.250;
/** A hit event at or above this damage counts as heavy. Matches the flinch
 *  threshold in enemies.js (chip damage — bolt 6, arc 7 — stays fluid). */
const HEAVY_DMG = 20;
/** The combat freeze rule's floor: scale() output stays strictly positive. */
const SCALE_FLOOR = 0.05;
/** §9.4 kill micro-shake through the existing trauma hook. */
const KILL_TRAUMA = 0.08;
/** Camera punch magnitudes, radians (owner band 0.06–0.10). */
const KILL_KICK_PITCH = -0.07;
const HURT_KICK_PITCH = 0.05;
const HURT_KICK_YAW = 0.07;

export class HitStop {
    /**
     * @param {import("../combat/damageable.js").DamageableRegistry} registry
     * @param {import("../combat/enemies.js").Enemies} enemies
     * @param {import("./camera.js").CameraRig|null} rig punch/trauma sink;
     *        null keeps the module usable headless (tools, tests)
     */
    constructor(registry, enemies, rig) {
        this.registry = registry;
        this.enemies = enemies;
        this.rig = rig || null;

        /** Wall-clock seconds accumulated by update(). */
        this._wall = 0;
        /** Seconds of envelope left; 0 = inactive. */
        this._remaining = 0;
        /** Full length of the current envelope, for the ease curve. */
        this._dur = 0;
        /** Deepest scale any trigger of this burst asked for. */
        this._minScale = 1;
        /** Wall time the current burst began (the 90 ms cap's anchor). */
        this._burstStart = 0;
        /** No new burst before this wall time. */
        this._cooldownUntil = 0;
        /** Last playerHurtPulse consumed from enemies. */
        this._pulseSeen = enemies ? enemies.playerHurtPulse | 0 : 0;
        /** Scale applied by scale() this frame. */
        this._scaleNow = 1;

        /** Probe surface — every counter is an accepted trigger. */
        this.stats = {
            triggers: { kill: 0, heavy: 0, player: 0 },
            rejected: 0,          // cooldown / cap refusals
            active: false,
            scaleNow: 1,
        };
    }

    /**
     * Dilate one frame's dt. Called at the top of the frame with the RAW wall
     * seconds; returns the game seconds the frame integrates. Identity while
     * no envelope is active.
     * @param {number} dt raw wall seconds (already hitch-clamped by main)
     * @returns {number}
     */
    scale(dt) {
        return dt * this._scaleNow;
    }

    /**
     * Advance the envelope on wall time and drain this frame's event feeds.
     * Call AFTER the combat pass (events exist) and BEFORE registry.endFrame()
     * (events still exist). Read-only on the registry and on enemies.
     * @param {number} dt raw wall seconds
     * @returns {void}
     */
    update(dt) {
        this._wall += dt;

        // ---- advance / release --------------------------------------------
        if (this._remaining > 0) {
            this._remaining -= dt;
            if (this._remaining <= 0) {
                this._remaining = 0;
                this._dur = 0;
                this._minScale = 1;
                this._cooldownUntil = this._wall + COOLDOWN_S;
            }
        }

        // ---- registry ring: kills, poise breaks, heavy hits ---------------
        const reg = this.registry;
        for (let e = 0; e < reg.eventCount; e++) {
            if (reg.evKind[e] === "dummy") continue;   // practice targets
            const type = reg.evType[e];
            if (type === 1) {
                if (this._trigger("kill", KILL_S, KILL_SCALE) && this.rig) {
                    this.rig.punch(KILL_KICK_PITCH, 0);
                    this.rig.addTrauma(KILL_TRAUMA);
                }
            } else if (type === 2 ||
                       (type === 0 && reg.evAmount[e] >= HEAVY_DMG)) {
                this._trigger("heavy", HEAVY_S, HEAVY_SCALE);
            }
        }

        // ---- player-hit pulse from enemies.js -----------------------------
        const en = this.enemies;
        if (en && en.playerHurtPulse !== this._pulseSeen) {
            this._pulseSeen = en.playerHurtPulse;
            if (this._trigger("player", PLAYER_S, PLAYER_SCALE) && this.rig) {
                // Kick AWAY from the source: the hurt direction's screen-right
                // component signs the yaw kick, so the view shoves off the
                // attacker's side. Deterministic — no noise on this path.
                const r = this.rig.right;
                const side = (en.playerHurtDirX * r.x + en.playerHurtDirZ * r.z)
                    >= 0 ? 1 : -1;
                this.rig.punch(HURT_KICK_PITCH, HURT_KICK_YAW * side);
            }
        }

        // ---- current scale: smoothstep ease-out over the envelope ---------
        if (this._remaining > 0 && this._dur > 0) {
            const u = this._remaining / this._dur;      // 1 at impact -> 0
            const k = u * u * (3 - 2 * u);
            let s = 1 - (1 - this._minScale) * k;
            if (s < SCALE_FLOOR) s = SCALE_FLOOR;
            this._scaleNow = s;
        } else {
            this._scaleNow = 1;
        }
        this.stats.active = this._remaining > 0;
        this.stats.scaleNow = this._scaleNow;
    }

    /**
     * One trigger through the stack-cap + cooldown rules.
     * @param {"kill"|"heavy"|"player"} kind
     * @param {number} dur seconds
     * @param {number} minScale deepest dilation this trigger asks for
     * @returns {boolean} accepted
     */
    _trigger(kind, dur, minScale) {
        if (this._remaining > 0) {
            // Mid-burst: extend, but never past 90 ms from the burst start.
            const allowed = STACK_CAP_S - (this._wall - this._burstStart);
            if (allowed <= 0) { this.stats.rejected++; return false; }
            const want = Math.min(dur, allowed);
            if (want > this._remaining) this._remaining = want;
            if (want > this._dur) this._dur = want;
            if (minScale < this._minScale) this._minScale = minScale;
        } else {
            if (this._wall < this._cooldownUntil) {
                this.stats.rejected++;
                return false;
            }
            this._remaining = dur;
            this._dur = dur;
            this._minScale = minScale;
            this._burstStart = this._wall;
        }
        this.stats.triggers[kind]++;
        return true;
    }
}
