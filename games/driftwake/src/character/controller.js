/**
 * Character locomotion + snow-surf physics.
 *
 * Port of `snowflow_demo/src/character/controller.js`.
 *
 * This owns motion only — the visual rig, the cloth, the fur, the wake, the
 * camera and the contact system all read the state it produces. Two modes share
 * one integrator:
 *
 *  - WALK: camera-relative desired velocity, eased facing, and a gait phase
 *    driven by DISTANCE TRAVELLED so footfalls land where the feet actually are.
 *  - SURF: momentum-carrying. Thrust along facing, steering from mouse yaw,
 *    strong lateral grip that bleeds into a drift as the carve is pushed, and
 *    slope-driven acceleration so dropping down a dune face feels like a gain.
 *
 * Blending between them is eased in both directions; there is no snap.
 *
 * This object is what `SNOWFLOW.character` must point at (ARCHITECTURE.md §2):
 * the harness writes `position`, `velocity` and `surfActive` on it directly, so
 * `surfActive` is re-read from `input.surf` every frame rather than cached, and
 * `position` / `velocity` are never reassigned — only mutated in place.
 *
 * ===========================================================================
 * HANDEDNESS
 * ===========================================================================
 *
 * The port's world is the reference's mirrored in z (see `core/camera.js`), with
 * the same yaw parameter. So wherever the reference writes
 *
 *     forward = ( sin f, 0,  cos f )      right = ( cos f, 0, -sin f )
 *
 * this file writes
 *
 *     forward = ( sin f, 0, -cos f )      right = ( cos f, 0,  sin f )
 *
 * which is exactly `CameraRig.getFlatForward` / `getFlatRight`, so `facing` and
 * `rig.yaw` are directly comparable and the surf steer's `angleDelta(facing,
 * rig.yaw)` means what it says. Five lines carry it and each is marked
 * PORT FRAME. `atan2(wish.x, wish.z)` becomes `atan2(wish.x, -wish.z)` for the
 * same reason: it is the inverse of the forward formula.
 */

import * as THREE from "three";
import { input } from "../core/input.js";
import { expDamp } from "../core/camera.js";

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _n = new THREE.Vector3();

const WALK_SPEED = 2.5;
const RUN_SPEED = 5.4;
const WALK_ACCEL = 26;
const WALK_DECEL = 30;

/**
 * Jump. Tuned as a pair, because only the pair is meaningful: the apex is
 * `JUMP_VEL^2 / (2*GRAVITY)` = 0.63 m and the hang time is `2*JUMP_VEL/GRAVITY`
 * = 0.50 s. That is a deliberate, readable hop — high enough that the trail
 * clearly stops and restarts, short enough that it never reads as floating.
 * Gravity is well above the real 9.81: a physically-scaled jump of this height
 * hangs for 0.72 s and feels like the moon.
 */
const JUMP_VEL = 5.0;
const GRAVITY = 20.0;
/**
 * Surf ollie impulse, as a multiplier on JUMP_VEL — OWNER DECISION 2026-08-04.
 * At 1.35 the take-off velocity is 6.75 m/s: apex 1.14 m against the walk
 * jump's 0.63 m, hang 0.675 s against 0.50 s. The arc reads bigger than the
 * multiplier suggests because the carve's full horizontal velocity (up to
 * 19.5 m/s) is carried through the air — see `_surfAirStep`. Scaled by the
 * eased surf blend at take-off so a jump taken mid-transition gets an
 * intermediate boost rather than a step at the 0.5 threshold.
 */
const OLLIE_MULT = 1.35;
/** Releasing SPACE early clips the remaining rise — a variable-height hop. */
const JUMP_CUT = 0.45;
/**
 * Fraction of ground acceleration available in the air. Deliberately small: at
 * 1.0 the character steers mid-flight like a camera, which is the single
 * fastest way to make a jump feel weightless.
 */
const AIR_CONTROL = 0.24;
/** Descent rate, m/s, that reads as a full-strength landing. */
const LAND_REF = 7.0;

const SURF_MAX = 19.5;
const SURF_THRUST = 11.0;
const SURF_DRAG = 0.42;
const SURF_TURN = 2.35; // rad/s at full steer
const SURF_GRIP = 7.5;  // 1/s lateral velocity kill rate

/** Gait: metres of travel per full stride cycle, scaled by speed. */
const STRIDE_BASE = 1.55;

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

export class CharacterController {
    /**
     * @param {{heightAt(x:number,z:number):number,
     *          normalAt(x:number,z:number,out:THREE.Vector3):THREE.Vector3}} terrain
     */
    constructor(terrain) {
        this.terrain = terrain;

        this.position = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.prevVelocity = new THREE.Vector3(0, 0, 0);
        this.acceleration = new THREE.Vector3(0, 0, 0);

        /** Yaw, radians. Deliberately never wrapped. */
        this.facing = 0;
        this.speed = 0;
        /** Normalised against SURF_MAX, for FOV, wind and streaks. */
        this.speed01 = 0;

        /** 0 = walking, 1 = fully surfing. Eased, asymmetrically. */
        this.surf = 0;
        this.surfActive = false;

        /**
         * 0 = not casting, 1 = fully in the bending stance. Written by the spell
         * system, read by the figure. It lives here rather than on the spell
         * system because the figure already reads the controller for everything
         * else it poses from, and a second source of "what is this character
         * doing" is how the arms and the legs end up disagreeing about which
         * frame it is.
         */
        this.cast = 0;
        this.castAimX = 0;
        this.castAimY = 0;
        this.castAimZ = 1;

        /** Signed lean, -1..1 (right positive), from lateral acceleration. */
        this.lean = 0;
        /** Signed carve amount for wake shaping. Positive = turning right. */
        this.carve = 0;
        /**
         * 0..1, how hard the screen-space speed streaks read. Deadbanded well
         * above walking pace: streaks at a jog make the demo feel cheap.
         */
        this.streak01 = 0;

        // ------------------------------------------------------------- gait
        this.gaitPhase = 0;
        /**
         * True when the legs should be running a gait at all. ONE flag, read by
         * the figure and by the contact system, because three copies of "is this
         * character walking" is three chances for the feet to disagree with the
         * footprints.
         */
        this.stepping = true;
        /** Set true for exactly one frame when a foot plants. */
        this.footfall = false;
        /** 0 = left foot, 1 = right foot — which foot just planted. */
        this.footIndex = 0;
        /** World position of the foot that just planted. */
        this.footPos = new THREE.Vector3();
        /** Impact strength, scales spray and deformation depth. */
        this.footImpact = 0;
        /**
         * True while the mesh rider owns the footstep clock (main.js sets it
         * with `S.meshCharacter`). The distance-driven gait below then stops
         * emitting footfalls — meshChar.js writes the same footfall contract
         * from its clips' measured plant phases instead, so the sound and the
         * prints follow the feet the player actually sees.
         */
        this.clipGait = false;
        /** One frame true when the mesh body starts a landing roll —
         *  meshChar.js raises it; the audio layer voices the second contact. */
        this.rolled = false;

        // -------------------------------------------------------------- jump
        /** True from the take-off frame until the landing frame, inclusive of neither end's ambiguity. */
        this.airborne = false;
        /** Seconds since take-off. 0 while grounded. */
        this.airTime = 0;
        /** Vertical velocity, m/s, +ve up. 0 while grounded. */
        this.vertVel = 0;
        /**
         * Height above the ground surface, metres. **Exactly** 0 while grounded,
         * which is what lets `figure.js` add it to a terrain-derived root height
         * without perturbing the grounded pose by so much as a float ulp.
         */
        this.airHeight = 0;
        /** True for exactly one frame, on the frame the character touches down. */
        this.landed = false;
        /** 0..1 from the descent rate at touchdown. Latched at each landing. */
        this.landImpact = 0;
        /** Latches the release-cut so a rise can only be clipped once. */
        this._jumpCut = false;

        this.groundY = 0;
        this.groundNormal = new THREE.Vector3(0, 1, 0);

        this._prevSpeed = 0;
    }

    /**
     * ARCHITECTURE.md §2 names this member `yaw` — "radians, the figure's
     * facing; readable and writable" — and the comparison harness poses the
     * character through `SNOWFLOW.character`. Internally the field is `facing`,
     * which is the reference's name and the one every consumer in this port
     * already reads, so the contract is satisfied with an alias rather than by
     * renaming and touching five files. Deliberately not wrapped, exactly like
     * `facing`: a pose that writes 3*PI must not snap the figure round the
     * short way on the next `angleDamp`.
     * @returns {number}
     */
    get yaw() {
        return this.facing;
    }

    set yaw(v) {
        this.facing = v;
    }

    /**
     * @param {number} dt
     * @param {import("../core/camera.js").CameraRig} rig
     * @returns {void}
     */
    update(dt, rig) {
        const h = Math.min(dt, 1 / 30);

        this.prevVelocity.copy(this.velocity);
        // Re-read every frame: the harness pins `input.surf` with a getter and a
        // cached local would never see it (ARCHITECTURE.md §2).
        this.surfActive = input.surf;

        // Ease the surf blend — entering and exiting are transitions, not
        // switches, and the two directions are deliberately different rates.
        this.surf = expDamp(this.surf, this.surfActive ? 1 : 0, this.surfActive ? 2.6 : 3.4, h);

        // One-frame edge; every consumer gates on it, so it must be cleared
        // before anything can set it this frame.
        this.landed = false;

        // TAKE-OFF. Ground only. Off the board it is a SURF OLLIE — higher and
        // faster than the walk jump, carrying the carve's horizontal velocity
        // through the air. (Owner decision 2026-08-04, reversing the earlier
        // hard block on jumping out of a carve.)
        if (input.jumpPressed && !this.airborne) {
            this.vertVel = JUMP_VEL * (1 + (OLLIE_MULT - 1) * this.surf);
            this.airborne = true;
            this.airTime = 0;
            this._jumpCut = false;
        }

        rig.getFlatForward(_fwd);
        rig.getFlatRight(_right);

        // Airborne on the board (the ollie), `_surfAirStep` carries the carve's
        // momentum untouched; airborne off it, `_walkStep` runs and scales
        // itself by AIR_CONTROL.
        if (this.surf > 0.5) {
            if (this.airborne) this._surfAirStep(h, rig);
            else this._surfStep(h, rig);
        } else {
            this._walkStep(h);
        }

        // ---------------------------------------------------- integrate + snap
        this.position.x += this.velocity.x * h;
        this.position.z += this.velocity.z * h;

        this.groundY = this.terrain.heightAt(this.position.x, this.position.z);
        this.terrain.normalAt(this.position.x, this.position.z, this.groundNormal);

        if (this.airborne) {
            // Variable height: releasing SPACE on the way up clips the rest of
            // the rise. Latched, so it can only ever cost one multiplication.
            if (!input.jump && this.vertVel > 0 && !this._jumpCut) {
                this.vertVel *= JUMP_CUT;
                this._jumpCut = true;
            }

            this.vertVel -= GRAVITY * h;
            this.airHeight += this.vertVel * h;
            this.airTime += h;

            // The descent test is `vertVel <= 0`, not just `airHeight <= 0`.
            // With `S.freezeTime` the step `h` is exactly 0, so `airHeight` never
            // leaves 0 on the take-off frame — without the velocity term the
            // character would "land" the instant it jumped, every frozen frame,
            // firing a landing brush and a spray burst on each one.
            if (this.airHeight <= 0 && this.vertVel <= 0) {
                this.airHeight = 0;
                this.landed = true;
                this.landImpact = clamp(-this.vertVel / LAND_REF, 0, 1);
                this.airborne = false;
                this.vertVel = 0;
                this.airTime = 0;
                this._jumpCut = false;
                this.position.y = this.groundY;
            } else {
                // Exact, not damped: the arc is the point, and smoothing it
                // would cost apex height and blur the take-off.
                this.position.y = this.groundY + this.airHeight;
            }
        } else {
            // Snap with a little softness, so micro-ripples do not jitter the rig.
            this.position.y = expDamp(this.position.y, this.groundY, 26, h);
        }

        // --------------------------------------------------------- bookkeeping
        this.speed = Math.hypot(this.velocity.x, this.velocity.z);
        this.speed01 = clamp(this.speed / SURF_MAX, 0, 1);

        // `S.freezeTime` makes dt — and therefore h — exactly 0, and with the
        // step frozen the velocity delta is exactly 0 too, so this division is
        // 0/0 = NaN on the freeze frame. The NaN is not local: it reaches
        // `lean` and `carve` through `leanWant` below (expDamp cannot repair it
        // — `target + (cur - target) * 1` is NaN when the target is), then
        // `rig.roll` and the camera quaternion, and the whole frame stops
        // rasterising. It is also STICKY — unfreezing never clears it, because
        // every consumer now damps toward a value that is already NaN.
        //
        // Over a zero-length step the acceleration is undefined, and the value
        // that makes freezing a no-op is the one the last real step measured:
        // `figure` and the fur droop read `acceleration` directly, undamped, so
        // zeroing it would visibly change the pose at the instant of the freeze.
        // Holding it means the frozen frame is the running frame.
        //
        // The WebGPU reference has the identical division (reference
        // `src/character/controller.js:142-143`) and the identical failure —
        // measured on https://snowflow-lilac.vercel.app/, where setting
        // `S.freezeTime` drops the frame to a mean of 1.5/255 with
        // `character.acceleration` reading NaN. This is a port-side fix to a
        // shared defect, not a divergence from a working reference behaviour.
        if (h > 0) {
            this.acceleration.x = (this.velocity.x - this.prevVelocity.x) / h;
            this.acceleration.z = (this.velocity.z - this.prevVelocity.z) / h;
        }

        // Lateral acceleration -> lean. Project accel onto the character's right.
        // PORT FRAME: right = (cos f, 0, sin f).
        const rx = Math.cos(this.facing);
        const rz = Math.sin(this.facing);
        const latAcc = this.acceleration.x * rx + this.acceleration.z * rz;
        const leanWant = clamp(latAcc / 26, -1, 1) * (0.35 + 0.65 * this.surf);
        this.lean = expDamp(this.lean, leanWant, 6.5, h);
        this.carve = expDamp(this.carve, leanWant, 9, h);

        this.streak01 = this.surf * clamp((this.speed - 7) / 11, 0, 1);

        this._gait(h);
    }

    _walkStep(h) {
        const maxSpeed = input.sprint ? RUN_SPEED : WALK_SPEED;
        // Exactly 1 on the ground, so every grounded number below is unchanged.
        const air = this.airborne ? AIR_CONTROL : 1;

        _wish.set(
            _fwd.x * input.moveZ + _right.x * input.moveX,
            0,
            _fwd.z * input.moveZ + _right.z * input.moveX
        );

        const wishLen = Math.hypot(_wish.x, _wish.z);
        if (wishLen > 0.001) {
            _wish.x = (_wish.x / wishLen) * maxSpeed;
            _wish.z = (_wish.z / wishLen) * maxSpeed;

            const a = WALK_ACCEL * air * h;
            this.velocity.x += clamp(_wish.x - this.velocity.x, -a, a);
            this.velocity.z += clamp(_wish.z - this.velocity.z, -a, a);

            // Face the direction of travel, eased. Slower in the air, where a
            // body has nothing to turn against — an 11/s yaw mid-flight lets the
            // player pirouette on the way up.
            // PORT FRAME: the inverse of forward = (sin f, 0, -cos f).
            const want = Math.atan2(_wish.x, -_wish.z);
            this.facing = angleDamp(this.facing, want, this.airborne ? 3.2 : 11, h);
        } else {
            // Air drag, not braking: releasing the stick mid-flight should not
            // stop the character dead over the take-off point.
            const d = WALK_DECEL * air * h;
            const s = Math.hypot(this.velocity.x, this.velocity.z);
            if (s > 0.0001) {
                const k = Math.max(0, s - d) / s;
                this.velocity.x *= k;
                this.velocity.z *= k;
            }
        }
    }

    _surfStep(h, rig) {
        // Steer from the mouse (camera yaw drift) plus explicit A/D.
        const steer = clamp(
            input.moveX * 0.85 + angleDelta(this.facing, rig.yaw) * 1.25,
            -1, 1
        );
        this.facing += steer * SURF_TURN * h;

        // Camera shake, and only from the one thing that earns it: an edge loaded
        // up at speed. Added as a RATE rather than an impulse, so it reaches an
        // equilibrium against the rig's own decay — a hard carve at top speed
        // settles around 0.4 trauma, a couple of centimetres of rig movement.
        const load = Math.abs(steer) * (this.speed / SURF_MAX);
        if (load > 0.25) rig.addTrauma((load - 0.25) * 1.35 * h);

        // PORT FRAME: forward = (sin f, 0, -cos f).
        const fx = Math.sin(this.facing);
        const fz = -Math.cos(this.facing);

        // Slope: heading downhill adds speed, uphill scrubs it. `_n` is already
        // in the port frame, so this dot product needs no sign change.
        this.terrain.normalAt(this.position.x, this.position.z, _n);
        const slopeAssist = -(_n.x * fx + _n.z * fz) * 26;

        let thrust = SURF_THRUST + slopeAssist;
        if (input.moveZ < 0) thrust -= 14; // pull back to scrub speed

        this.velocity.x += fx * thrust * h;
        this.velocity.z += fz * thrust * h;

        // Lateral grip: kill sideways velocity, but not entirely — the residual
        // is what reads as a drift when the turn is overcooked.
        // PORT FRAME: right = (cos f, 0, sin f).
        const rx = Math.cos(this.facing);
        const rz = Math.sin(this.facing);
        const lat = this.velocity.x * rx + this.velocity.z * rz;
        const grip = Math.min(1, SURF_GRIP * h);
        this.velocity.x -= rx * lat * grip;
        this.velocity.z -= rz * lat * grip;

        // Quadratic drag -> a natural terminal speed.
        const s = Math.hypot(this.velocity.x, this.velocity.z);
        if (s > 0.0001) {
            const drag = SURF_DRAG * s * s * 0.02 + 0.9;
            const k = Math.max(0, s - drag * h) / s;
            this.velocity.x *= k;
            this.velocity.z *= k;
        }
        if (s > SURF_MAX) {
            const k = SURF_MAX / s;
            this.velocity.x *= k;
            this.velocity.z *= k;
        }
    }

    /**
     * The ollie's flight — airborne with the board still under the feet.
     *
     * The horizontal velocity vector is deliberately NOT touched: no thrust
     * (nothing to push against), no lateral grip (no edge in the snow), no
     * drag — the carve's speed at take-off is the speed at landing, which is
     * what "continues the effect" means. The only authority left is a sliver
     * of the surf turn rate (AIR_CONTROL, the same fraction the walk jump
     * uses) so the arc is committed rather than steerable. Landing with RMB
     * still held drops straight back into `_surfStep`, whose grip then
     * resolves any facing/velocity mismatch the air turn built up — the same
     * drift mechanic an overcooked grounded carve already uses.
     */
    _surfAirStep(h, rig) {
        const steer = clamp(
            input.moveX * 0.85 + angleDelta(this.facing, rig.yaw) * 1.25,
            -1, 1
        );
        this.facing += steer * SURF_TURN * AIR_CONTROL * h;
    }

    /**
     * Distance-driven gait. Phase advances with ground TRAVELLED, not with time,
     * which is what keeps feet planted instead of sliding: stride length and
     * ground speed become the same number by construction, at any frame rate.
     */
    _gait(h) {
        this.footfall = false;
        this.rolled = false;

        // Feet stay on the board while surfing — and for the run-out afterwards.
        // The surf blend eases to zero in a fifth of a second, but the momentum
        // takes two thirds of one to bleed off, and in between the character is
        // travelling at nineteen metres a second. A distance-driven gait answered
        // that with a twelve-hertz cadence and the legs blurred. A sprint is the
        // fastest anyone walks; above it, glide.
        // Airborne there is no gait at all — nothing to step on. This is the ONE
        // flag the figure and the contact system both read, so gating it here
        // gates the pose and the footprints from a single decision.
        this.stepping =
            !this.airborne && this.surf <= 0.5 && this.speed <= RUN_SPEED * 1.2;
        if (!this.stepping) {
            this.gaitPhase = 0;
            return;
        }

        // The mesh rider owns the footstep clock: its clips' measured plant
        // phases emit the footfall events (meshChar._emitFootfalls), so the
        // distance-driven clock below would double-fire every step. `stepping`
        // above stays live — it is the shared is-the-gait-running gate.
        if (this.clipGait) {
            this.gaitPhase = 0;
            return;
        }

        const dist = this.speed * h;
        const stride = STRIDE_BASE * (0.72 + 0.28 * Math.min(1, this.speed / RUN_SPEED));
        const prev = this.gaitPhase;
        this.gaitPhase = (this.gaitPhase + dist / stride) % 1;   // <- the whole point

        if (this.speed < 0.15) return;

        // Two plants per cycle, at phase 0.0 and 0.5.
        const crossed = (prev < 0.5 && this.gaitPhase >= 0.5) || this.gaitPhase < prev;
        if (!crossed) return;

        this.footfall = true;
        this.footIndex = this.gaitPhase < 0.5 ? 0 : 1;
        this.footImpact = clamp(0.35 + this.speed / RUN_SPEED, 0, 1.3);

        // Offset the plant to the correct side of the body.
        // PORT FRAME: right = (cos f, 0, sin f).
        const side = this.footIndex === 0 ? -0.17 : 0.17;
        const rx = Math.cos(this.facing);
        const rz = Math.sin(this.facing);
        this.footPos.set(
            this.position.x + rx * side,
            this.position.y,
            this.position.z + rz * side
        );
    }
}

// ------------------------------------------------------------------ helpers

/** Shortest signed delta from a to b, wrapped to [-PI, PI]. */
export function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

/** Framerate-independent easing across the shortest arc. */
export function angleDamp(cur, target, rate, dt) {
    return cur + angleDelta(cur, target) * (1 - Math.exp(-rate * dt));
}
