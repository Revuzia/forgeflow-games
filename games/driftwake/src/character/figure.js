/**
 * The figure — skeleton, bind pose, and the procedural locomotion that poses it.
 *
 * Port of `snowflow_demo/src/character/figure.js` (plus the four functions of
 * `core/mat4.js` it is the only consumer of, folded in here because this port
 * has no `core/mat4.js` and this is the only file that would import it).
 *
 * There is no rig file and no animation data. Everything is solved from the
 * motion state `controller.js` already produces. The one thing that buys has to
 * be paid for in exchange: **feet plant rather than slide.**
 *
 * Planting is not approximated. When a foot enters stance its world position is
 * recorded and then held absolutely fixed while the body travels over it; the
 * leg is solved by two-bone IK to reach that fixed point. A foot in this rig
 * cannot slide, because during stance nothing in the code is capable of moving
 * it — the only write to `footPos` in stance is a straight copy of `plant`, and
 * `plant` is written on exactly one frame. The gait phase is driven by distance
 * travelled, not by a clock, so stride length and ground speed are the same
 * number by construction.
 *
 * Bone convention: a bone's local +Y runs from its own joint toward its child,
 * so a hanging arm has +Y pointing at the floor. The two foot bones are the
 * exception and are documented in the bind table. Geometry is authored in
 * bind-pose world space and skinned by `world * inverseBind`, so there is no
 * model matrix anywhere in the character.
 *
 * Allocation: none per frame. Everything lives in flat arrays sized here.
 *
 * ===========================================================================
 * HANDEDNESS
 * ===========================================================================
 *
 * `core/camera.js` fixes the project convention: the port's world is the
 * reference's world **mirrored in z** (M = diag(1, 1, -1)), with the same yaw
 * parameter, so
 *
 *     forward(f) = ( sin f, 0, -cos f )      right(f) = ( cos f, 0,  sin f )
 *
 * against the reference's `( sin f, 0, cos f )` / `( cos f, 0, -sin f )`. Three
 * places in this file carry that, and only three:
 *
 *  1. `BIND` — every z in the table (joint z, direction z, reference z) is
 *     negated against `_spec/character.md` §2.2. The geometry those matrices
 *     skin is mirrored the same way in `build.js`.
 *  2. `composeBasis` — the yaw basis is seeded with z negated. Everything after
 *     that (the pitch and roll steps) is linear in the axes, so mirroring
 *     commutes with it and the code is transcribed unchanged.
 *  3. `_updateFeet` / the `fwdAcc` projection — the two places a forward or
 *     right vector is written out longhand from `facing`.
 *
 * `setFrameFromDir` itself is transcribed verbatim, cross products and all. It
 * is fed mirrored inputs, and a mirror flips the sign of a cross product, so the
 * frames it produces are `M * (reference frame) * diag(-1,1,1)` — the local +X
 * axis comes out negated. That is harmless and is *why* it can be transcribed
 * unchanged: both the bind matrices and the world matrices are built by this one
 * function, so the extra `diag(-1,1,1)` is a common right-multiplication and
 * cancels exactly in `world * invBind`. What reaches the GPU is precisely
 * `M * skin_reference * M`, which is what mirrored geometry needs. Nothing reads
 * a bone's local +X.
 */

import * as THREE from "three";

// --------------------------------------------------------------- bone indices
export const B_ROOT = 0;
export const B_SPINE = 1;
export const B_CHEST = 2;
export const B_NECK = 3;
export const B_HEAD = 4;
export const B_HOOD = 5;
export const B_UPPER_L = 6;
export const B_FORE_L = 7;
export const B_HAND_L = 8;
export const B_UPPER_R = 9;
export const B_FORE_R = 10;
export const B_HAND_R = 11;
export const B_THIGH_L = 12;
export const B_SHIN_L = 13;
export const B_FOOT_L = 14;
export const B_THIGH_R = 15;
export const B_SHIN_R = 16;
export const B_FOOT_R = 17;
export const BONE_COUNT = 18;

/**
 * Bind pose, nine floats per bone: joint position, bone direction, front
 * reference. A 1.79 m figure with the pelvis at 0.95 — deliberately a little
 * long in the leg and narrow in the shoulder, because the silhouette is read at
 * fifteen metres through a robe and slightly heroic proportions survive that
 * better than accurate ones.
 *
 * There is no parent index and no parent-relative offset: every joint is an
 * absolute world position and the hierarchy exists only in the arithmetic of
 * `update()`. Do not rebuild this as a THREE.Skeleton.
 *
 * Every z is negated against the reference table — see the handedness note at
 * the top of the file. HOOD is co-located with HEAD so it can carry its own
 * lagged rotation; the feet use dir = (0,0,-1) (local +Y at the toes, port
 * frame) and ref = (0,1,0), unlike every other bone.
 */
const BIND = new Float32Array([
    /* ROOT    */ 0, 0.95, 0, 0, 1, 0, 0, 0, -1,
    /* SPINE   */ 0, 1.06, 0, 0, 1, 0, 0, 0, -1,
    /* CHEST   */ 0, 1.26, 0, 0, 1, 0, 0, 0, -1,
    /* NECK    */ 0, 1.46, 0, 0, 1, 0, 0, 0, -1,
    /* HEAD    */ 0, 1.55, 0, 0, 1, 0, 0, 0, -1,
    /* HOOD    */ 0, 1.55, 0, 0, 1, 0, 0, 0, -1,

    /* UPPER_L */ -0.185, 1.400, 0.000, -0.16, -0.987, 0, 0, 0, -1,
    /* FORE_L  */ -0.230, 1.123, 0.000, -0.05, -0.997, -0.06, 0, 0, -1,
    /* HAND_L  */ -0.243, 0.866, -0.016, -0.02, -0.992, -0.12, 0, 0, -1,
    /* UPPER_R */ 0.185, 1.400, 0.000, 0.16, -0.987, 0, 0, 0, -1,
    /* FORE_R  */ 0.230, 1.123, 0.000, 0.05, -0.997, -0.06, 0, 0, -1,
    /* HAND_R  */ 0.243, 0.866, -0.016, 0.02, -0.992, -0.12, 0, 0, -1,

    /* THIGH_L */ -0.100, 0.900, 0, 0, -1, 0, 0, 0, -1,
    /* SHIN_L  */ -0.100, 0.460, 0, 0, -1, 0, 0, 0, -1,
    /* FOOT_L  */ -0.100, 0.090, 0, 0, 0, -1, 0, 1, 0,
    /* THIGH_R */ 0.100, 0.900, 0, 0, -1, 0, 0, 0, -1,
    /* SHIN_R  */ 0.100, 0.460, 0, 0, -1, 0, 0, 0, -1,
    /* FOOT_R  */ 0.100, 0.090, 0, 0, 0, -1, 0, 1, 0,
]);

/** Segment lengths implied by the bind table, metres. */
const THIGH_LEN = 0.44;
const SHIN_LEN = 0.37;
const UPPER_LEN = 0.28;
const FORE_LEN = 0.26;

/** Pelvis height above the feet in the bind pose. */
const HIP_HEIGHT = 0.95;

/**
 * Airborne leg tuck.
 *
 * `TUCK_DROP` is how far the ankle hangs below the hips at full tuck — well
 * inside the 0.81 m the leg can actually reach, so the knee is visibly bent
 * rather than dangling straight.
 *
 * `TUCK_HEIGHT` is the height at which the legs are fully tucked. Because it is
 * read off HEIGHT rather than off a timer, the extension is symmetric for free:
 * the legs are extended at take-off (a push-off), tuck through the middle of the
 * arc, and extend again into the landing — and, more importantly, the tuck blend
 * is exactly 0 at both ends of the flight, so the pose is continuous with the
 * stance machine at take-off AND at touchdown without either end being a special
 * case. The jump's apex is 0.63 m, so at 0.45 the tuck reaches full.
 */
const TUCK_DROP = 0.46;
const TUCK_HEIGHT = 0.45;
/** How fast the airborne foot chases its target. See `_updateFeet`. */
const TUCK_RATE = 14;

// --------------------------------------------------- flat-array 4x4 transforms
//
// Layout: column-major, 16 floats per matrix. Elements 0-2 are the X axis, 4-6
// the Y axis, 8-10 the Z axis, 12-14 the translation, so `M * vec4(p,1)` in the
// shader is the local-to-world transform and the `skin` array uploads to the
// data texture unmodified. Wrapping each of 54 matrices in a THREE.Matrix4 would
// mean 54 objects plus a flatten copy per bone per frame.

/** Write a rigid frame: three orthonormal axes and an origin. */
function setFrame(out, o, px, py, pz, xx, xy, xz, yx, yy, yz, zx, zy, zz) {
    out[o] = xx; out[o + 1] = xy; out[o + 2] = xz; out[o + 3] = 0;
    out[o + 4] = yx; out[o + 5] = yy; out[o + 6] = yz; out[o + 7] = 0;
    out[o + 8] = zx; out[o + 9] = zy; out[o + 10] = zz; out[o + 11] = 0;
    out[o + 12] = px; out[o + 13] = py; out[o + 14] = pz; out[o + 15] = 1;
}

/**
 * Build a frame from a bone direction and a reference "front".
 *
 * `dir` becomes the local +Y axis. `ref` only has to be roughly perpendicular;
 * it is re-orthogonalised here and swapped for a fallback when it is not.
 *
 * Transcribed verbatim including both cross products — see the handedness note
 * at the top of the file for why that is correct under the z mirror.
 */
function setFrameFromDir(out, o, px, py, pz, dx, dy, dz, rx, ry, rz) {
    let l = Math.hypot(dx, dy, dz) || 1;
    const yx = dx / l, yy = dy / l, yz = dz / l;

    // X = Y x ref, the axis both are perpendicular to.
    let ax = yy * rz - yz * ry;
    let ay = yz * rx - yx * rz;
    let az = yx * ry - yy * rx;
    l = Math.hypot(ax, ay, az);
    if (l < 1e-5) {
        // `ref` was parallel to the bone. Any perpendicular will do — cross with
        // world +X, which cannot also be parallel unless `ref` was zero.
        ax = 0;
        ay = yz;
        az = -yy;
        l = Math.hypot(ax, ay, az) || 1;
    }
    ax /= l; ay /= l; az /= l;

    setFrame(
        out, o, px, py, pz,
        ax, ay, az,
        yx, yy, yz,
        ay * yz - az * yy, az * yx - ax * yz, ax * yy - ay * yx  // Z = X x Y
    );
}

/** `out = a * b`, both rigid. Aliasing `out` with either input is not allowed. */
function mul(out, oo, a, oa, b, ob) {
    for (let c = 0; c < 4; c++) {
        const bx = b[ob + c * 4], by = b[ob + c * 4 + 1];
        const bz = b[ob + c * 4 + 2], bw = b[ob + c * 4 + 3];
        out[oo + c * 4] = a[oa] * bx + a[oa + 4] * by + a[oa + 8] * bz + a[oa + 12] * bw;
        out[oo + c * 4 + 1] = a[oa + 1] * bx + a[oa + 5] * by + a[oa + 9] * bz + a[oa + 13] * bw;
        out[oo + c * 4 + 2] = a[oa + 2] * bx + a[oa + 6] * by + a[oa + 10] * bz + a[oa + 14] * bw;
        out[oo + c * 4 + 3] = a[oa + 3] * bx + a[oa + 7] * by + a[oa + 11] * bz + a[oa + 15] * bw;
    }
}

/**
 * Inverse of a rigid transform: transpose the rotation, negate the rotated
 * translation. A general inverse would work and would be slower and less
 * accurate; nothing in the rig ever scales.
 */
function invertRigid(out, oo, m, om) {
    const xx = m[om], xy = m[om + 1], xz = m[om + 2];
    const yx = m[om + 4], yy = m[om + 5], yz = m[om + 6];
    const zx = m[om + 8], zy = m[om + 9], zz = m[om + 10];
    const tx = m[om + 12], ty = m[om + 13], tz = m[om + 14];

    out[oo] = xx; out[oo + 1] = yx; out[oo + 2] = zx; out[oo + 3] = 0;
    out[oo + 4] = xy; out[oo + 5] = yy; out[oo + 6] = zy; out[oo + 7] = 0;
    out[oo + 8] = xz; out[oo + 9] = yz; out[oo + 10] = zz; out[oo + 11] = 0;
    out[oo + 12] = -(xx * tx + xy * ty + xz * tz);
    out[oo + 13] = -(yx * tx + yy * ty + yz * tz);
    out[oo + 14] = -(zx * tx + zy * ty + zz * tz);
    out[oo + 15] = 1;
}

/** Transform a point. Writes three floats into `dst` at `od`. */
function xformPoint(m, om, x, y, z, dst, od) {
    dst[od] = m[om] * x + m[om + 4] * y + m[om + 8] * z + m[om + 12];
    dst[od + 1] = m[om + 1] * x + m[om + 5] * y + m[om + 9] * z + m[om + 13];
    dst[od + 2] = m[om + 2] * x + m[om + 6] * y + m[om + 10] * z + m[om + 14];
}

// ------------------------------------------------------- module-scope scratch
const _axes = new Float32Array(9);   // X, Y, Z of a composed basis
const _p = new Float32Array(3);
const _knee = new Float32Array(3);
const _hip = new Float32Array(3);
const _sh = new Float32Array(3);

/**
 * Compose an orthonormal basis from yaw, then pitch about its own right axis,
 * then roll about its own forward axis. Writes X, Y, Z into `_axes`.
 *
 * Positive pitch leans forward, positive roll tips the figure to its own right —
 * the sign `controller.lean` already uses.
 *
 * PORT FRAME: the yaw seed is the reference's with z negated, so
 * X = right = (cos y, 0, sin y) and Z = forward = (sin y, 0, -cos y), matching
 * `CameraRig.getFlatRight` / `getFlatForward` exactly. The pitch and roll steps
 * below are linear in the axes, so the mirror commutes with them and they are
 * transcribed unchanged.
 */
function composeBasis(yaw, pitch, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    let xx = cy, xy = 0, xz = sy;
    let yx = 0, yy = 1, yz = 0;
    let zx = sy, zy = 0, zz = -cy;

    if (pitch !== 0) {
        const c = Math.cos(pitch), s = Math.sin(pitch);
        const nyx = yx * c + zx * s, nyy = yy * c + zy * s, nyz = yz * c + zz * s;
        const nzx = zx * c - yx * s, nzy = zy * c - yy * s, nzz = zz * c - yz * s;
        yx = nyx; yy = nyy; yz = nyz; zx = nzx; zy = nzy; zz = nzz;
    }
    if (roll !== 0) {
        const c = Math.cos(roll), s = Math.sin(roll);
        const nxx = xx * c - yx * s, nxy = xy * c - yy * s, nxz = xz * c - yz * s;
        const nyx = yx * c + xx * s, nyy = yy * c + xy * s, nyz = yz * c + xz * s;
        xx = nxx; xy = nxy; xz = nxz; yx = nyx; yy = nyy; yz = nyz;
    }

    _axes[0] = xx; _axes[1] = xy; _axes[2] = xz;
    _axes[3] = yx; _axes[4] = yy; _axes[5] = yz;
    _axes[6] = zx; _axes[7] = zy; _axes[8] = zz;
}

/**
 * Two-bone IK. Given a root joint, an end target and a pole direction, writes
 * the middle joint's world position into `out`.
 *
 * The target is pulled INSIDE reach rather than clamped at it (0.995): a fully
 * extended leg reads as a stiff peg, and the last centimetre of reach is where
 * all the knee-lock artefacts live.
 *
 * Handedness-neutral: everything here is dot products, a normalisation and two
 * scaled additions. No cross product, so it transcribes unchanged.
 */
function solveTwoBone(rx, ry, rz, tx, ty, tz, px, py, pz, l1, l2, out) {
    let dx = tx - rx, dy = ty - ry, dz = tz - rz;
    let dist = Math.hypot(dx, dy, dz);
    const maxReach = (l1 + l2) * 0.995;
    if (dist < 1e-4) { dx = 0; dy = -1; dz = 0; dist = 1e-4; }
    if (dist > maxReach) dist = maxReach;
    // Note: normalised by its ORIGINAL length; `dist` then carries the
    // (possibly shortened) chord length into the cosine rule below.
    const inv = 1 / Math.hypot(dx, dy, dz);
    dx *= inv; dy *= inv; dz *= inv;

    // Cosine rule: how far along the root->target axis the middle joint projects.
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

    // Pole, orthogonalised against the axis. This is what decides which way the
    // knee or elbow bends, and it has to be re-derived every frame because the
    // axis swings through it during a stride.
    const d = px * dx + py * dy + pz * dz;
    let ox = px - dx * d, oy = py - dy * d, oz = pz - dz * d;
    let ol = Math.hypot(ox, oy, oz);
    if (ol < 1e-5) { ox = 0; oy = 0; oz = 1; ol = 1; }
    ox /= ol; oy /= ol; oz /= ol;

    out[0] = rx + dx * a + ox * h;
    out[1] = ry + dy * a + oy * h;
    out[2] = rz + dz * a + oz * h;
}

/** Framerate-independent exponential approach. */
function damp(cur, target, rate, dt) {
    return target + (cur - target) * Math.exp(-rate * dt);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

export class Figure {
    /**
     * @param {{heightAt(x:number,z:number):number}} terrain
     */
    constructor(terrain) {
        this.terrain = terrain;

        /** World matrix per bone. */
        this.world = new Float32Array(BONE_COUNT * 16);
        /** Bind-pose world matrix per bone. */
        this.bind = new Float32Array(BONE_COUNT * 16);
        /** Inverse of the above. */
        this.invBind = new Float32Array(BONE_COUNT * 16);
        /** `world * invBind` — the matrix geometry is actually skinned by. */
        this.skin = new Float32Array(BONE_COUNT * 16);

        /** World joint positions, 3 floats per bone. Cloth collision reads these. */
        this.joint = new Float32Array(BONE_COUNT * 3);

        for (let b = 0; b < BONE_COUNT; b++) {
            const o = b * 9;
            setFrameFromDir(
                this.bind, b * 16,
                BIND[o], BIND[o + 1], BIND[o + 2],
                BIND[o + 3], BIND[o + 4], BIND[o + 5],
                BIND[o + 6], BIND[o + 7], BIND[o + 8]
            );
            invertRigid(this.invBind, b * 16, this.bind, b * 16);
        }

        // ------------------------------------------------------------- gait
        /** Where each foot is planted, world. Frozen for the whole stance phase. */
        this.plant = new Float32Array(6);
        /** Live foot position (equals `plant` during stance). */
        this.footPos = new Float32Array(6);
        /** Ground normal under each planted foot. */
        this.footNormal = new Float32Array([0, 1, 0, 0, 1, 0]);
        /** 1 while the foot carries weight, 0 mid-swing. Eased. */
        this.footWeight = new Float32Array([1, 1]);
        this._wasStance = [true, true];
        /** Set for exactly one frame when a foot touches down. */
        this.touchdown = [false, false];

        // ------------------------------------------------- smoothed pose state
        this.hipY = HIP_HEIGHT;
        this.pitch = 0;
        this.roll = 0;
        this.bob = 0;
        this.headYaw = 0;
        this.headPitch = 0;
        this.hoodYaw = 0;
        this.hoodPitch = 0;
        this.armPhase = 0;
        /** How far the figure has settled into the snow, metres. */
        this.sink = 0.04;

        this._t = 0;
        this._prevGait = 0;
    }

    /**
     * Pose the skeleton for this frame.
     * @param {number} dt
     * @param {import("./controller.js").CharacterController} ch
     * @returns {void}
     */
    update(dt, ch) {
        const h = Math.min(dt, 1 / 30);
        this._t += h;

        const surf = ch.surf;
        const speed = ch.speed;
        const run = Math.min(1, speed / 5.4);

        // ---------------------------------------------------------- footfalls
        // First, so that the stance/swing decision and the snow splat are the
        // same instant by construction.
        this._updateFeet(h, ch);

        // -------------------------------------------------------- body attitude
        // Lean forward with speed, and *into* acceleration — the classic read
        // that a figure is pushing rather than being dragged.
        //
        // PORT FRAME: forward = (sin f, 0, -cos f), hence the minus on the z term.
        const fwdAcc =
            ch.acceleration.x * Math.sin(ch.facing) - ch.acceleration.z * Math.cos(ch.facing);
        // Clamped, because the accelerations at either end of a surf run are an
        // order of magnitude larger than anything walking produces: letting go at
        // top speed decelerates at 30 m/s^2, which unclamped throws the torso
        // twenty degrees backwards and reads as a fall rather than a scrub.
        const pitchWant =
            0.10 * run
            + 0.012 * clamp(fwdAcc, -9, 22)
            + surf * (0.30 + 0.16 * ch.speed01);
        this.pitch = damp(this.pitch, pitchWant, 7, h);

        const rollWant = ch.lean * (0.16 + 0.34 * surf);
        this.roll = damp(this.roll, rollWant, 8, h);

        // Vertical bob: the pelvis drops through each stance and rises over the
        // supporting leg, twice per stride. Suppressed while surfing, where the
        // stance is a static crouch.
        const bobWant =
            (1 - surf) * (-0.028 * run * (0.5 - 0.5 * Math.cos(4 * Math.PI * ch.gaitPhase)));
        this.bob = damp(this.bob, bobWant, 18, h);

        // Crouch: a little at running speed, a lot on the board.
        const crouch = 0.035 * run + surf * (0.13 + 0.05 * ch.speed01);
        this.hipY = damp(this.hipY, HIP_HEIGHT - crouch, 9, h);

        // The figure settles into the snow it is standing on. Reading the real
        // depth would mean a GPU readback; this is the same number the contact
        // brushes write, held on the CPU.
        //
        // Airborne there is no snow to settle into, so the target is 0 — and the
        // slow rate (0.25 s) means the recovery after a landing reads as the
        // body settling into the snow it just punched.
        this.sink = damp(this.sink, ch.airborne ? 0 : 0.045 + surf * 0.055, 4, h);

        // ------------------------------------------------------------- spine
        const gx = ch.position.x;
        const gz = ch.position.z;
        const groundY = this.terrain.heightAt(gx, gz);

        // `airHeight` is the ONLY term that lifts the body off the terrain, and
        // it is exactly 0 whenever the character is grounded — so every grounded
        // frame produces a bit-identical root to the one it produced before jump
        // existed. The root is derived from `heightAt` rather than from
        // `ch.position.y` deliberately: `position.y` is exponentially damped
        // toward the ground while walking, and swapping it in here would feed
        // that smoothing into the pose and shift every grounded frame in the
        // comparison battery.
        const rootY = groundY - this.sink + this.hipY + this.bob + ch.airHeight;

        composeBasis(ch.facing, this.pitch, this.roll);
        const rX = _axes[0], rY = _axes[1], rZ = _axes[2];
        const uX = _axes[3], uY = _axes[4], uZ = _axes[5];
        const fX = _axes[6], fY = _axes[7], fZ = _axes[8];

        // Pelvis. Its yaw counter-rotates against the shoulders during a stride,
        // which is most of what stops a procedural walk reading as a shop dummy.
        const twist = (1 - surf) * 0.13 * run * Math.sin(2 * Math.PI * ch.gaitPhase);
        composeBasis(ch.facing + twist, this.pitch, this.roll);
        this._setBone(
            B_ROOT, gx, rootY, gz,
            _axes[3], _axes[4], _axes[5], _axes[6], _axes[7], _axes[8]
        );

        // Spine and chest lift along the pelvis up-axis, with the chest twisting
        // the opposite way and leaning a little further forward.
        const spineY = rootY + uY * 0.11;
        this._setBone(
            B_SPINE, gx + uX * 0.11, spineY, gz + uZ * 0.11,
            uX, uY, uZ, fX, fY, fZ
        );

        const chestTwist = -twist * 1.5;
        const chestPitch = this.pitch + 0.05 * run + surf * 0.10;
        composeBasis(ch.facing + chestTwist, chestPitch, this.roll * 1.15);
        const cRx = _axes[0], cRy = _axes[1], cRz = _axes[2];
        const cUx = _axes[3], cUy = _axes[4], cUz = _axes[5];
        const cFx = _axes[6], cFy = _axes[7], cFz = _axes[8];

        const chestX = gx + uX * 0.31, chestY = rootY + uY * 0.31, chestZ = gz + uZ * 0.31;
        this._setBone(B_CHEST, chestX, chestY, chestZ, cUx, cUy, cUz, cFx, cFy, cFz);

        const neckX = chestX + cUx * 0.20, neckY = chestY + cUy * 0.20, neckZ = chestZ + cUz * 0.20;
        this._setBone(B_NECK, neckX, neckY, neckZ, cUx, cUy, cUz, cFx, cFy, cFz);

        // ------------------------------------------------------------- head
        // Head stabilisation: the head stays much closer to level than the chest
        // it sits on. Real necks do this and it is very obvious when missing.
        this.headPitch = damp(this.headPitch, -chestPitch * 0.62 + surf * 0.10, 9, h);
        this.headYaw = damp(this.headYaw, ch.lean * -0.22, 6, h);
        composeBasis(
            ch.facing + chestTwist + this.headYaw,
            chestPitch + this.headPitch,
            this.roll * 0.5
        );
        const headX = neckX + cUx * 0.09, headY = neckY + cUy * 0.09, headZ = neckZ + cUz * 0.09;
        this._setBone(
            B_HEAD, headX, headY, headZ,
            _axes[3], _axes[4], _axes[5], _axes[6], _axes[7], _axes[8]
        );

        // The hood is a lagged copy, at the SAME position as the head. A hood
        // that tracks the skull exactly reads as a helmet; a few frames of lag
        // reads as fabric.
        this.hoodYaw = damp(this.hoodYaw, ch.facing + chestTwist + this.headYaw, 11, h);
        this.hoodPitch = damp(this.hoodPitch, chestPitch + this.headPitch + 0.05, 9, h);
        composeBasis(this.hoodYaw, this.hoodPitch, this.roll * 0.5);
        this._setBone(
            B_HOOD, headX, headY, headZ,
            _axes[3], _axes[4], _axes[5], _axes[6], _axes[7], _axes[8]
        );

        // -------------------------------------------------------------- arms
        this._poseArms(h, ch, chestX, chestY, chestZ, cRx, cRy, cRz, cUx, cUy, cUz, cFx, cFy, cFz);

        // -------------------------------------------------------------- legs
        this._poseLeg(0, gx, rootY, gz, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ);
        this._poseLeg(1, gx, rootY, gz, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ);

        // ------------------------------------------------------------- skin
        for (let b = 0; b < BONE_COUNT; b++) {
            mul(this.skin, b * 16, this.world, b * 16, this.invBind, b * 16);
            this.joint[b * 3] = this.world[b * 16 + 12];
            this.joint[b * 3 + 1] = this.world[b * 16 + 13];
            this.joint[b * 3 + 2] = this.world[b * 16 + 14];
        }
    }

    _setBone(b, px, py, pz, yx, yy, yz, zx, zy, zz) {
        setFrameFromDir(this.world, b * 16, px, py, pz, yx, yy, yz, zx, zy, zz);
    }

    /**
     * Advance the stance/swing state machine and place both ankles.
     *
     * Stance is the whole point. `plant` is written exactly once, on touchdown,
     * and read unchanged for the rest of the stance — so no amount of body
     * motion, camera motion or frame-rate variation can move a planted foot.
     */
    _updateFeet(h, ch) {
        const surf = ch.surf;
        const speed = ch.speed;
        const run = Math.min(1, speed / 5.4);
        // Duty factor: a walk keeps both feet down for a moment (0.66), a run has
        // a flight phase (0.46). Interpolating between them is what makes the
        // transition from walk to run read as a gait change and not a speed
        // change.
        const duty = 0.66 - 0.20 * run;

        // PORT FRAME: forward = (sin f, 0, -cos f), right = (cos f, 0, sin f).
        const fwdX = Math.sin(ch.facing), fwdZ = -Math.cos(ch.facing);
        const rgtX = Math.cos(ch.facing), rgtZ = Math.sin(ch.facing);

        // Half a stride ahead, scaled by speed — this is the step length, and it
        // has to match the controller's stride or the feet skate.
        const half = 0.34 + 0.42 * run;
        // The CONTROLLER owns this decision. Re-deriving it from `surf` here is
        // how the feet and the footprints end up disagreeing about whether the
        // character is walking.
        const moving = speed > 0.2 && ch.stepping;

        // ===================================================================
        // AIRBORNE
        // ===================================================================
        // Note what `moving` is at this moment: the controller drops `stepping`
        // the instant it leaves the ground, so `moving` is false, so `stance`
        // below computes TRUE for both feet — and the stance path would then
        // raise `touchdown` on the transition and damp both plants along the
        // ground under the hips. That is precisely the mid-flight stamp this
        // system must not produce. The airborne branch below `continue`s past
        // the whole state machine rather than trying to teach it about flight.
        const air = ch.airborne;
        // Hips in world Y, so the tuck hangs off the body rather than off the
        // terrain. `bob` is omitted: the gait is stopped, so it is already ~0.
        const bodyY = air
            ? this.terrain.heightAt(ch.position.x, ch.position.z)
                - this.sink + this.hipY + ch.airHeight
            : 0;
        // 0 at full tuck, 1 at the deck — see TUCK_HEIGHT.
        const near = air ? clamp(1 - ch.airHeight / TUCK_HEIGHT, 0, 1) : 0;

        for (let f = 0; f < 2; f++) {
            const side = f === 0 ? -0.105 : 0.105;
            // Left foot leads; the right is half a cycle behind.
            const ph = (ch.gaitPhase + (f === 0 ? 0 : 0.5)) % 1;
            const stance = !moving || ph < duty;

            // Where this foot would land if it touched down right now. Keeps
            // updating during swing, so the foot is always aimed at where the
            // body will actually be when it gets there.
            const nx = ch.position.x + fwdX * half + rgtX * side;
            const nz = ch.position.z + fwdZ * half + rgtZ * side;

            if (air) {
                // No plant, no touchdown, no gait — for the whole flight.
                this.touchdown[f] = false;

                // Tucked: drawn up under the hips, marginally forward.
                const tx = ch.position.x + rgtX * side + fwdX * 0.06;
                const tz = ch.position.z + rgtZ * side + fwdZ * 0.06;
                const ty = bodyY - TUCK_DROP;
                // Extended: the landing target. These three are character-for-
                // character the expressions the TOUCHDOWN branch writes into
                // `plant`, which is what makes the re-entry seamless — as
                // `near` reaches 1 the foot is already standing exactly where
                // the stance machine is about to declare it planted, so there
                // is nothing left to snap to and nothing to slide to catch up.
                const gy = this.terrain.heightAt(nx, nz) - this.sink * 0.7;

                // Damped rather than assigned, so TAKE-OFF is smooth too: the
                // foot leaves from wherever the stride had it, instead of
                // teleporting onto the tuck curve on the first airborne frame.
                const o = f * 3;
                this.footPos[o] = damp(this.footPos[o], tx + (nx - tx) * near, TUCK_RATE, h);
                this.footPos[o + 1] = damp(this.footPos[o + 1], ty + (gy - ty) * near, TUCK_RATE, h);
                this.footPos[o + 2] = damp(this.footPos[o + 2], tz + (nz - tz) * near, TUCK_RATE, h);
                // Weightless: the cloth and fur solvers read this, and a foot
                // carrying load in mid-air stiffens the garments against a
                // ground contact that is not happening.
                this.footWeight[f] = damp(this.footWeight[f], 0, 22, h);

                // Leave the machine in SWING, so the first grounded frame is a
                // genuine stance transition and fires exactly one touchdown.
                this._wasStance[f] = false;
                continue;
            }

            if (stance) {
                if (!this._wasStance[f]) {
                    // TOUCHDOWN. These are the only lines in the file that write
                    // a plant position.
                    this.plant[f * 3] = nx;
                    this.plant[f * 3 + 1] = this.terrain.heightAt(nx, nz) - this.sink * 0.7;
                    this.plant[f * 3 + 2] = nz;
                    this.touchdown[f] = true;
                } else {
                    this.touchdown[f] = false;
                }
                if (!moving) {
                    // STANDING ONLY: ease the feet back under the hips rather
                    // than leaving them wherever the last stride dropped them.
                    const sx = ch.position.x + rgtX * side + fwdX * 0.02;
                    const sz = ch.position.z + rgtZ * side + fwdZ * 0.02;
                    this.plant[f * 3] = damp(this.plant[f * 3], sx, 7, h);
                    this.plant[f * 3 + 2] = damp(this.plant[f * 3 + 2], sz, 7, h);
                    this.plant[f * 3 + 1] = damp(
                        this.plant[f * 3 + 1],
                        this.terrain.heightAt(this.plant[f * 3], this.plant[f * 3 + 2])
                            - this.sink * 0.7,
                        7, h
                    );
                }
                // Copy, never recompute. This is the line the whole design rests
                // on: during stance there is no code path that can move the foot.
                this.footPos[f * 3] = this.plant[f * 3];
                this.footPos[f * 3 + 1] = this.plant[f * 3 + 1];
                this.footPos[f * 3 + 2] = this.plant[f * 3 + 2];
                this.footWeight[f] = damp(this.footWeight[f], 1, 22, h);
            } else {
                this.touchdown[f] = false;
                // Swing: from the plant it is LEAVING (read, never written) to
                // the plant it is heading for, on an arc. At s -> 1 the swing
                // endpoint and the next frame's touchdown plant are the same
                // expression, so the handover is continuous.
                const s = (ph - duty) / (1 - duty);
                const e = s * s * (3 - 2 * s);
                const ny = this.terrain.heightAt(nx, nz) - this.sink * 0.7;
                const px = this.plant[f * 3], py = this.plant[f * 3 + 1], pz = this.plant[f * 3 + 2];
                this.footPos[f * 3] = px + (nx - px) * e;
                this.footPos[f * 3 + 2] = pz + (nz - pz) * e;
                this.footPos[f * 3 + 1] =
                    py + (ny - py) * e + Math.sin(Math.PI * s) * (0.055 + 0.12 * run);
                this.footWeight[f] = damp(this.footWeight[f], 0, 22, h);
            }

            this._wasStance[f] = stance;
        }

        // Surfing: both feet ride the board, wide across the direction of travel
        // for lateral stability and staggered along it. Blended in, never
        // snapped. (The blend is a per-frame lerp by `surf` rather than a rate —
        // mildly frame-rate dependent by construction; reproduced as written.)
        // `!air` because a jump taken as the surf blend is still bleeding out
        // would otherwise drag both feet back onto a board that is no longer
        // under them.
        if (surf > 0.001 && !air) {
            for (let f = 0; f < 2; f++) {
                const lateral = f === 0 ? -0.17 : 0.17;
                const along = f === 0 ? 0.11 : -0.11;
                const sx = ch.position.x + fwdX * along + rgtX * lateral;
                const sz = ch.position.z + fwdZ * along + rgtZ * lateral;
                // Full sink here, not sink * 0.7 — the board rides lower.
                const sy = this.terrain.heightAt(sx, sz) - this.sink;
                const o = f * 3;
                this.footPos[o] += (sx - this.footPos[o]) * surf;
                this.footPos[o + 1] += (sy - this.footPos[o + 1]) * surf;
                this.footPos[o + 2] += (sz - this.footPos[o + 2]) * surf;
                this.footWeight[f] = Math.max(this.footWeight[f], surf);
            }
        }
    }

    /**
     * Solve one leg. `f` is 0 for left, 1 for right.
     *
     * The knee pole tilts outward as well as forward, because a knee that bends
     * in a perfectly sagittal plane looks mechanical — real legs track slightly
     * wide of the hip.
     */
    _poseLeg(f, rootX, rootY, rootZ, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ) {
        const side = f === 0 ? -0.10 : 0.10;
        const hipB = f === 0 ? B_THIGH_L : B_THIGH_R;
        const shinB = f === 0 ? B_SHIN_L : B_SHIN_R;
        const footB = f === 0 ? B_FOOT_L : B_FOOT_R;

        // Hip joint, carried by the pelvis frame.
        _hip[0] = rootX + rX * side - uX * 0.05;
        _hip[1] = rootY + rY * side - uY * 0.05;
        _hip[2] = rootZ + rZ * side - uZ * 0.05;

        const ax = this.footPos[f * 3];
        const ay = this.footPos[f * 3 + 1] + 0.09; // the ankle sits above the sole
        const az = this.footPos[f * 3 + 2];

        const outward = f === 0 ? -0.22 : 0.22;
        solveTwoBone(
            _hip[0], _hip[1], _hip[2], ax, ay, az,
            fX + rX * outward, fY + rY * outward, fZ + rZ * outward,
            THIGH_LEN, SHIN_LEN, _knee
        );

        this._setBone(
            hipB, _hip[0], _hip[1], _hip[2],
            _knee[0] - _hip[0], _knee[1] - _hip[1], _knee[2] - _hip[2],
            fX, fY, fZ
        );
        this._setBone(
            shinB, _knee[0], _knee[1], _knee[2],
            ax - _knee[0], ay - _knee[1], az - _knee[2],
            fX, fY, fZ
        );

        // The foot rolls: flat while loaded, toe-down through the swing.
        const w = this.footWeight[f];
        const toeDown = (1 - w) * 0.55;
        const c = Math.cos(toeDown), s = Math.sin(toeDown);
        // Rotate the foot's forward axis down about the body's right axis. Both
        // axes are already in the port frame, so this needs no sign change.
        const dx = fX * c - uX * s, dy = fY * c - uY * s, dz = fZ * c - uZ * s;
        this._setBone(footB, ax, ay, az, dx, dy, dz, uX, uY, uZ);
    }

    /**
     * Arms. Counter-swing against the legs while walking, a blended cast pose,
     * and a wide, low stance while surfing — hands out and forward, which is
     * what a person does at twenty metres a second.
     *
     * Every offset here is kept comfortably inside the arm's 0.54 m reach. Put a
     * target at or past full extension and the IK does exactly what it is told —
     * locks the elbow — and the figure walks around with two straight poles.
     */
    _poseArms(h, ch, cx, cy, cz, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ) {
        const surf = ch.surf;
        const run = Math.min(1, ch.speed / 5.4);
        const swing = Math.sin(2 * Math.PI * ch.gaitPhase) * (0.20 + 0.42 * run) * (1 - surf);
        // Slow idle drift, so a standing figure is never perfectly still.
        const idle = Math.sin(this._t * 0.9) * 0.02 + Math.sin(this._t * 1.7 + 1.3) * 0.012;

        for (let a = 0; a < 2; a++) {
            const sgn = a === 0 ? -1 : 1;
            const upperB = a === 0 ? B_UPPER_L : B_UPPER_R;
            const foreB = a === 0 ? B_FORE_L : B_FORE_R;
            const handB = a === 0 ? B_HAND_L : B_HAND_R;

            // Shoulder, on the chest frame.
            _sh[0] = cx + rX * (sgn * 0.185) + uX * 0.14;
            _sh[1] = cy + rY * (sgn * 0.185) + uY * 0.14;
            _sh[2] = cz + rZ * (sgn * 0.185) + uZ * 0.14;

            // ---- walk target: the hand swings fore and aft below the hip ----
            const sw = swing * -sgn;   // counter-swing against the legs
            let tx = _sh[0] + fX * (sw * 0.38) - uX * 0.43 + rX * (sgn * 0.11);
            let ty = _sh[1] + fY * (sw * 0.38) - uY * 0.43 + rY * (sgn * 0.11);
            let tz = _sh[2] + fZ * (sw * 0.38) - uZ * 0.43 + rZ * (sgn * 0.11);
            ty += idle * sgn;

            // ---- cast target: blended, not switched, so it composes with the
            //      walk swing — a character casting while walking still walks.
            //      The RIGHT hand leads, because that is the ribbon emitter.
            const cast = ch.cast;
            if (cast > 0.001) {
                const aimX = ch.castAimX, aimY = ch.castAimY, aimZ = ch.castAimZ;
                const lead = a === 1 ? 1 : 0;
                const outward = lead ? 0.30 : -0.16;
                const along = lead ? 0.52 : 0.16;
                const lift = lead ? 0.26 : 0.02;
                // Verbatim asymmetry: the Y line omits `outward * sgn` on the
                // right-axis term and adds an extra world-space `lift * 0.6`.
                // Reproduced exactly — it is what the pose was tuned against.
                const ctx = _sh[0] + rX * (sgn * 0.30 + outward * sgn) + aimX * along + uX * lift;
                const cty = _sh[1] + rY * (sgn * 0.30) + aimY * along + uY * lift + lift * 0.6;
                const ctz = _sh[2] + rZ * (sgn * 0.30 + outward * sgn) + aimZ * along + uZ * lift;
                tx += (ctx - tx) * cast;
                ty += (cty - ty) * cast;
                tz += (ctz - tz) * cast;
            }

            // ---- surf target: out, forward and a little down ----------------
            if (surf > 0.001) {
                const carve = ch.carve;
                // Trailing arm rises, leading arm drops into the turn — the same
                // asymmetry a snowboarder holds through a carve.
                const rise = 0.02 + carve * sgn * 0.22;
                const sx = _sh[0] + rX * (sgn * 0.33) + fX * 0.24 + uX * rise;
                const sy = _sh[1] + rY * (sgn * 0.33) + fY * 0.24 + uY * rise;
                const sz = _sh[2] + rZ * (sgn * 0.33) + fZ * 0.24 + uZ * rise;
                tx += (sx - tx) * surf;
                ty += (sy - ty) * surf;
                tz += (sz - tz) * surf;
            }

            // Elbows point back and out.
            const px = -fX + rX * (sgn * 0.55);
            const py = -fY + rY * (sgn * 0.55) - 0.35;
            const pz = -fZ + rZ * (sgn * 0.55);
            solveTwoBone(
                _sh[0], _sh[1], _sh[2], tx, ty, tz, px, py, pz,
                UPPER_LEN, FORE_LEN, _p
            );

            this._setBone(
                upperB, _sh[0], _sh[1], _sh[2],
                _p[0] - _sh[0], _p[1] - _sh[1], _p[2] - _sh[2],
                fX, fY, fZ
            );
            this._setBone(
                foreB, _p[0], _p[1], _p[2],
                tx - _p[0], ty - _p[1], tz - _p[2],
                fX, fY, fZ
            );
            // The hand continues the forearm.
            let hx = tx - _p[0], hy = ty - _p[1], hz = tz - _p[2];
            const hl = Math.hypot(hx, hy, hz) || 1;
            hx /= hl; hy /= hl; hz /= hl;
            this._setBone(handB, tx, ty, tz, hx, hy, hz, fX, fY, fZ);
        }
    }

    /**
     * World position of a hand, for spell emitters: 9 cm down the hand bone's
     * own axis. Writes 3 floats to `out` at `od`.
     * @param {number} which 0 = left, 1 = right
     * @param {Float32Array|number[]} out
     * @param {number} od
     * @returns {void}
     */
    handPosition(which, out, od) {
        const b = which === 0 ? B_HAND_L : B_HAND_R;
        xformPoint(this.world, b * 16, 0, 0.09, 0, out, od || 0);
    }
}

export { HIP_HEIGHT };

// Re-exported for the few consumers that want a THREE-flavoured read of a joint
// without knowing the flat layout. Nothing in this subsystem calls it.
/**
 * @param {Figure} fig
 * @param {number} bone
 * @param {THREE.Vector3} out
 * @returns {THREE.Vector3}
 */
export function jointPosition(fig, bone, out) {
    return out.set(fig.joint[bone * 3], fig.joint[bone * 3 + 1], fig.joint[bone * 3 + 2]);
}
