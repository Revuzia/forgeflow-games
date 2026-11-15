/**
 * Compass bearing -> world angle, in the port's mirrored frame.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * The reference is Babylon (left-handed, +y up); this port is Three
 * (right-handed). Chirality is not a rotation, so exactly one world axis has to
 * be negated. `core/camera.js` negates **z**, which is the conventional
 * Babylon-to-Three conversion and the only choice that leaves the rig basis
 * proper right-handed — `up = cross(right, fwd)` comes out `+y`, and the camera
 * at yaw = pitch = 0 is Three's identity camera. `character/controller.js`,
 * `character/cloth.js` and `character/character.js` follow it (their "PORT
 * FRAME" comments), so the camera and everything attached to the character
 * already live in the mirrored frame.
 *
 * The world bearings did NOT follow: `render/sky.js`, `vfx/particles.js` and the
 * terrain's `windAngle` transcribed the reference formula verbatim, putting the
 * sun and the wind in the UN-mirrored frame. The two halves then disagreed by a
 * z-flip, which is measurable: at shot 14's pose (`rig.yaw` = 2.06 rad = the
 * 118 degree sun bearing, i.e. aimed straight into the sun) the angle between
 * the camera forward and `sky.sunDir` was **53.9 degrees** instead of the
 * reference's ~0, so the sun disc fell outside a 90 degree horizontal frustum
 * entirely. That single defect removed the sun, its glare and most of the aerial
 * haze from every shot in the battery.
 *
 * ===========================================================================
 * THE CONVERSION
 * ===========================================================================
 *
 * A compass bearing `t` (degrees; 0 = +z, 90 = +x) is the world direction
 * `(sin t, cos t)` in x/z. Mirroring z sends that to `(sin t, -cos t)`, and
 *
 *     (sin t', cos t') = (sin t, -cos t)   <=>   t' = PI - t
 *
 * so mirroring a bearing is exactly `PI - t`. Applying it to EVERY bearing
 * preserves every *relative* angle, which is what the look actually depends on:
 * the 76 degree separation between `S.windDirection` (42) and `S.sunAzimuth`
 * (118) survives as |62 - 138| = 76. That separation is what stops the sun
 * raking straight down the sastrugi ridges and flattening the fine structure,
 * so it is load-bearing for `detail_energy`, not cosmetic.
 *
 * Because `t' = PI - t` yields `sin t' = sin t` and `cos t' = -cos t`, call
 * sites keep the reference's formula shape unchanged — `(sin a, cos a)` still
 * reads as written — and only the angle fed into it moves. That is why this is a
 * one-line change per site rather than a re-derivation.
 *
 * Use this for every bearing that comes out of the settings object and becomes a
 * world direction or a sample-domain rotation. Do not hand-negate a cosine at a
 * call site: the drift between hand-negated and not is the bug this file fixes.
 */

/** Degrees -> radians. */
export const DEG2RAD = Math.PI / 180;

/**
 * Convert a settings compass bearing (degrees) to a world angle (radians) in the
 * port's z-mirrored frame.
 *
 * Valid both for directions built as `(sin a, cos a)` and for rotations of a
 * noise sample domain (`windMat`), because both consume the same angle.
 *
 * @param {number} deg compass bearing in degrees, 0 = +z, 90 = +x
 * @returns {number} world angle in radians, z-mirrored
 */
export function bearingRad(deg) {
    return Math.PI - deg * DEG2RAD;
}
