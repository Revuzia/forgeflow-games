/**
 * Third-person spring-arm rig — action-MMO framing.
 *
 * The arm is deliberately *not* rigid: the pivot chases the character through a
 * critically-damped spring, so hard acceleration pulls the camera back and the
 * character drifts forward in frame. FOV widens with speed, the rig banks into
 * carves, and everything eases. Nothing here snaps.
 *
 * Open snow field, so there is no obstacle collision solve — only the ground
 * itself pushes the arm up, which buys a rig that never pops through a drift.
 *
 * ===========================================================================
 * HANDEDNESS — the one thing in this file that is not a straight transcription
 * ===========================================================================
 *
 * The reference is Babylon, **left-handed, +y up**, and its rig basis is
 *
 *     fwd_ref   = ( sin(yaw)*cos(pitch), -sin(pitch),  cos(yaw)*cos(pitch) )
 *     right_ref = ( cos(yaw),             0,          -sin(yaw)            )
 *
 * Three is **right-handed**. There is no camera orientation that reproduces a
 * left-handed camera's image of the same world — chirality is not a rotation —
 * so exactly one world axis has to be negated somewhere. This port negates
 * **z**, which is the conventional Babylon-to-Three conversion and the one that
 * makes yaw = pitch = roll = 0 come out as Three's identity camera (looking down
 * -z, right = +x, up = +y). So:
 *
 *     fwd   = ( sin(yaw)*cos(pitch), -sin(pitch), -cos(yaw)*cos(pitch) )
 *     right = ( cos(yaw),             0,           sin(yaw)            )
 *     up    = cross(right, fwd)
 *
 * Two consequences, both verified by hand and both load-bearing:
 *
 *  1. `cross(_right, _fwd)` is the reference's own expression, and in ITS
 *     left-handed frame it evaluates to the NEGATED up vector — the shipped rig
 *     therefore lowers the eye by 0.22 m, not raises it, despite the reference
 *     calling the term an "eye rise". Mirroring z flips the sign of every cross
 *     product, so the identical expression here yields the TRUE up. To reproduce
 *     the reference's shipped framing the eye offset below is written
 *     `up * -0.22`. (This rig publishes `up` as the true up, because that is what
 *     every other subsystem in a right-handed engine will expect from it.)
 *
 *  2. The shoulder offset uses `right`, which after the mirror is still the
 *     camera's on-screen right — so the character sits on the same side of frame
 *     as in the reference shots, which is what `_shots/ref/01-hero.png` shows.
 *
 * THE PROJECT-WIDE COROLLARY, stated once here because this file is where the
 * convention is written down: the port's world is the reference's world with z
 * negated. Anything transcribed from the reference that consumes a world-space
 * direction — the sun bearing, the wind bearing, the terrain's dune orientation,
 * the character's facing — has to be negated in z as well, or it will disagree
 * with this camera about which way "north" is.
 */

import * as THREE from "three";
import { input } from "./input.js";

// ------------------------------------------------------- module-scope scratch
const _pivot = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rightRolled = new THREE.Vector3();
const _upRolled = new THREE.Vector3();
const _back = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/** Height probes taken along the spring arm each frame. */
const ARM_SAMPLES = 5;

const PITCH_MIN = -0.62; // looking up
const PITCH_MAX = 1.05; // looking down
const DIST_MIN = 2.6;
const DIST_MAX = 11.0;

const RAD_TO_DEG = 180 / Math.PI;

export class CameraRig {
    /**
     * @param {number} [aspect] viewport aspect ratio; update with `setAspect`
     */
    constructor(aspect = 16 / 9) {
        // fov is stored in radians here (the reference's unit) and pushed to the
        // camera in degrees, which is what Three stores.
        const cam = new THREE.PerspectiveCamera(1.02 * RAD_TO_DEG, aspect, 0.12, 4200);
        // Mirrored from the reference's (0, 3, -6): with z negated, "behind the
        // origin at yaw 0" is +z. Overwritten on the first update anyway.
        cam.position.set(0, 3, 6);
        cam.rotation.set(0, 0, 0);
        cam.updateProjectionMatrix();

        this.camera = cam;

        this.yaw = 2.4;
        this.pitch = 0.17;

        this.distance = 6.2;
        this.distanceTarget = 6.2;

        /** Smoothed pivot position (the thing the spring chases). */
        this.pivot = new THREE.Vector3(0, 0, 0);
        this.pivotVel = new THREE.Vector3(0, 0, 0);

        /** Over-the-shoulder offset, in camera space. */
        this.shoulder = 0.85;
        this.pivotHeight = 1.62;

        this.baseFov = 1.02; // radians, ~58.4 deg vertical
        this.fov = 1.02;

        this.roll = 0;
        this.rollTarget = 0;

        /**
         * The rig's basis, republished every frame. The spells aim with the same
         * three vectors, so there is only one place the convention for "forward"
         * is written down. All three are in Three's right-handed world space —
         * see the handedness note at the top of the file.
         */
        this.forward = new THREE.Vector3(0, 0, -1);
        this.right = new THREE.Vector3(1, 0, 0);
        this.up = new THREE.Vector3(0, 1, 0);

        // Trauma-based shake (Squirrel Eiserloh style): shake = trauma^2, so it
        // falls off perceptually rather than linearly.
        this.trauma = 0;
        this.shakeTime = 0;

        // Impact punch (core/hitstop.js feeds this on kills and player hits):
        // an instantaneous angular kick that decays over ~0.15 s. Applied on
        // the same angle path the shake uses — it never accumulates into
        // `yaw`/`pitch` and it composes with the rig's own damping. The decay
        // runs on the frame's (possibly hit-stop-dilated) dt, so the kick
        // HOLDS through a stop and releases with it, which is the feel.
        this.punchPitch = 0;
        this.punchYaw = 0;

        /**
         * Height sampler, injected once the terrain exists:
         * `rig.groundAt = (x, z) => terrain.heightAt(x, z)`.
         * @type {((x:number, z:number) => number)|null}
         */
        this.groundAt = null;
        /** Metres of snow the camera must keep beneath it. */
        this.groundClearance = 1.35;
        /** Eased lift currently being applied to stay above the surface. */
        this.groundLift = 0;

        this._first = true;
    }

    /**
     * @param {number} aspect
     * @returns {void}
     */
    setAspect(aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    /** @param {number} amount 0..1 */
    addTrauma(amount) {
        this.trauma = Math.min(1, this.trauma + amount);
    }

    /**
     * One-frame angular kick (impact punch). Additive so a kill landing on
     * top of a hurt reaction stacks, clamped so no burst can wrench the view.
     * Deterministic — magnitudes come from the caller, no noise here.
     * @param {number} pitchKick radians; negative looks up
     * @param {number} yawKick radians
     * @returns {void}
     */
    punch(pitchKick, yawKick) {
        this.punchPitch = clamp(this.punchPitch + pitchKick, -0.12, 0.12);
        this.punchYaw = clamp(this.punchYaw + yawKick, -0.12, 0.12);
    }

    /**
     * @param {number} dt seconds
     * @param {THREE.Vector3} targetPos character world position (feet)
     * @param {THREE.Vector3} targetVel character world velocity
     * @param {number} lean signed lean amount, -1..1 (right positive), for banking
     * @param {number} speed01 normalised speed for FOV widening
     * @returns {void}
     */
    update(dt, targetPos, targetVel, lean, speed01) {
        // ------------------------------------------------------------- look
        // Additive, and consumed UNSCALED by dt — mouse look is displacement-
        // based, not rate-based. The harness writes `yaw`/`pitch` directly and
        // relies on this line starting from the written value.
        this.yaw += input.lookX;
        this.pitch = clamp(this.pitch + input.lookY, PITCH_MIN, PITCH_MAX);

        // ------------------------------------------------------------- zoom
        // Proportional, so zoom feels the same at any arm length.
        this.distanceTarget = clamp(
            this.distanceTarget + input.zoomDelta * (this.distanceTarget * 0.35),
            DIST_MIN,
            DIST_MAX
        );
        this.distance = expDamp(this.distance, this.distanceTarget, 9, dt);

        // ------------------------------------------------------------ pivot
        _pivot.copy(targetPos);
        _pivot.y += this.pivotHeight;

        // Lead the camera slightly into the direction of travel so fast motion
        // shows more of what's ahead.
        const lead = Math.min(1, speed01) * 1.35;
        _pivot.x += targetVel.x * lead * 0.09;
        _pivot.z += targetVel.z * lead * 0.09;

        if (this._first) {
            this.pivot.copy(_pivot);
            this._first = false;
        } else {
            // Softer spring under acceleration = the arm stretches, then recovers.
            springDamp(this.pivot, this.pivotVel, _pivot, 7.5, 1.0, dt);
        }

        // -------------------------------------------------------------- fov
        const fovWant = this.baseFov * (1 + speed01 * 0.19);
        this.fov = expDamp(this.fov, fovWant, 3.2, dt);

        // ------------------------------------------------------------- bank
        this.rollTarget = -lean * 0.085;
        this.roll = expDamp(this.roll, this.rollTarget, 5.0, dt);

        // ------------------------------------------------------------ shake
        this.trauma = Math.max(0, this.trauma - dt * 1.15);
        this.shakeTime += dt;
        const shake = this.trauma * this.trauma;

        // ------------------------------------------------------ compose xform
        // Right-handed, z negated from the reference — see the file docblock.
        const cp = Math.cos(this.pitch);
        _fwd.set(
            Math.sin(this.yaw) * cp,
            -Math.sin(this.pitch),
            -Math.cos(this.yaw) * cp
        );
        _right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
        // The reference's own expression. Because z is mirrored it comes out as
        // the TRUE up here, where in the reference it was the negated up.
        _up.crossVectors(_right, _fwd).normalize();

        this.forward.copy(_fwd);
        this.right.copy(_right);
        this.up.copy(_up);

        _desired.copy(this.pivot);
        _desired.addScaledVector(_fwd, -this.distance);
        _desired.addScaledVector(_right, this.shoulder);
        // -0.22, not +0.22: the reference adds 0.22 along an expression that
        // evaluates to the *negated* up in its left-handed frame, so the shipped
        // eye sits 0.22 m BELOW the end of the arm. See the file docblock.
        _desired.addScaledVector(_up, -0.22);

        // ---- keep the arm out of the snow --------------------------------
        // The lift rises quickly and relaxes slowly: snapping down the instant a
        // crest passes under the arm reads as a jolt, while being slow to rise
        // means a frame or two actually inside the snow.
        if (this.groundAt) {
            // Worst case over the whole arm, not just the eye: a crest between
            // the player and the camera can fill the view while the eye itself
            // is legally above the snow.
            let need = 0;
            for (let i = 0; i <= ARM_SAMPLES; i++) {
                const t = i / ARM_SAMPLES;
                const x = this.pivot.x + (_desired.x - this.pivot.x) * t;
                const z = this.pivot.z + (_desired.z - this.pivot.z) * t;
                const y = this.pivot.y + (_desired.y - this.pivot.y) * t;
                // Clearance eases in along the arm so it does not shove the
                // camera up merely for being near the player's own feet.
                const gh = this.groundAt(x, z) + this.groundClearance * (0.35 + 0.65 * t);
                const d = gh - y;
                if (d > need) need = d;
            }

            this.groundLift = expDamp(
                this.groundLift, need, need > this.groundLift ? 26 : 4.5, dt
            );
            _desired.y += this.groundLift;
        }

        let shakePitch = 0;
        let shakeYaw = 0;
        let shakeRoll = 0;
        // ---- impact punch: ride the shake's angle path, decay ~0.15 s -----
        if (this.punchPitch !== 0 || this.punchYaw !== 0) {
            shakePitch += this.punchPitch;
            shakeYaw += this.punchYaw;
            // Rate 20 ≈ 5% left after 0.15 s; snapped to exact zero below so
            // the steady state re-enters the untouched fast path.
            this.punchPitch = expDamp(this.punchPitch, 0, 20, dt);
            this.punchYaw = expDamp(this.punchYaw, 0, 20, dt);
            if (Math.abs(this.punchPitch) < 1e-4) this.punchPitch = 0;
            if (Math.abs(this.punchYaw) < 1e-4) this.punchYaw = 0;
        }
        if (shake > 0.0001) {
            const t = this.shakeTime * 26;
            _desired.x += (noise1(t) * 2 - 1) * shake * 0.16;
            _desired.y += (noise1(t + 31.7) * 2 - 1) * shake * 0.16;
            _desired.z += (noise1(t + 71.3) * 2 - 1) * shake * 0.10;
            // Symmetric noise about zero, so the mirror leaves these unchanged.
            shakePitch = (noise1(this.shakeTime * 31 + 11) * 2 - 1) * shake * 0.02;
            shakeYaw = (noise1(this.shakeTime * 29 + 53) * 2 - 1) * shake * 0.02;
            shakeRoll = (noise1(this.shakeTime * 23 + 97) * 2 - 1) * shake * 0.05;
        }

        // ------------------------------------------------- write the camera
        const cam = this.camera;
        cam.position.copy(_desired);

        // Shake is applied to the angles rather than to the stored state, so it
        // decays cleanly instead of accumulating into `yaw`/`pitch`.
        if (shakePitch !== 0 || shakeYaw !== 0) {
            const cp2 = Math.cos(this.pitch + shakePitch);
            const y2 = this.yaw + shakeYaw;
            _fwd.set(Math.sin(y2) * cp2, -Math.sin(this.pitch + shakePitch), -Math.cos(y2) * cp2);
            _right.set(Math.cos(y2), 0, Math.sin(y2));
            _up.crossVectors(_right, _fwd).normalize();
        }

        // Roll about the view direction. This is the reference's own rotation
        // (its RotationZ turns local +x toward local +y) applied to the mirrored
        // basis, which is what keeps the bank leaning the same way on screen as
        // it does in the reference.
        const rr = this.roll + shakeRoll;
        const cr = Math.cos(rr);
        const sr = Math.sin(rr);
        _rightRolled.copy(_right).multiplyScalar(cr).addScaledVector(_up, sr);
        _upRolled.copy(_up).multiplyScalar(cr).addScaledVector(_right, -sr);
        _back.copy(_fwd).multiplyScalar(-1);

        // Three's camera basis is (right, up, backward) — a right-handed triple,
        // which (right, up, -fwd) is: right x up = -fwd. Verified at
        // yaw=pitch=roll=0, where it degenerates to the identity.
        _basis.makeBasis(_rightRolled, _upRolled, _back);
        cam.quaternion.setFromRotationMatrix(_basis);

        const fovDeg = this.fov * RAD_TO_DEG;
        if (cam.fov !== fovDeg) {
            cam.fov = fovDeg;
            // The post chain recomputes this again before it writes the jitter;
            // doing it here as well keeps the rig usable on its own.
            cam.updateProjectionMatrix();
        }
        cam.updateMatrixWorld(true);
    }

    /**
     * Flat camera-space forward on the XZ plane, for movement. Writes to `out`.
     * @param {THREE.Vector3} out
     * @returns {THREE.Vector3}
     */
    getFlatForward(out) {
        return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }

    /**
     * @param {THREE.Vector3} out
     * @returns {THREE.Vector3}
     */
    getFlatRight(out) {
        return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    }
}

// ------------------------------------------------------------------ helpers

/** Framerate-independent exponential approach. */
export function expDamp(cur, target, rate, dt) {
    return target + (cur - target) * Math.exp(-rate * dt);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Semi-implicit damped spring toward `target`, mutating `pos` and `vel`.
 * @param {THREE.Vector3} pos @param {THREE.Vector3} vel @param {THREE.Vector3} target
 * @param {number} freq natural frequency (rad/s-ish)
 * @param {number} damping 1 = critical
 * @param {number} dt
 */
function springDamp(pos, vel, target, freq, damping, dt) {
    const k = freq * freq;
    const c = 2 * damping * freq;
    // Clamp dt so a hitch can't blow the integrator up.
    const h = Math.min(dt, 1 / 45);
    vel.x += (k * (target.x - pos.x) - c * vel.x) * h;
    vel.y += (k * (target.y - pos.y) - c * vel.y) * h;
    vel.z += (k * (target.z - pos.z) - c * vel.z) * h;
    pos.x += vel.x * h;
    pos.y += vel.y * h;
    pos.z += vel.z * h;
}

/** Cheap smooth 1D value noise for shake. Deterministic, no allocation. */
function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

function hash1(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
}
