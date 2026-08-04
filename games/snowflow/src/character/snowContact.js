/**
 * Where the character meets the snow.
 *
 * Translates locomotion state into brushes on the terrain state buffer. This is
 * the only thing standing between the physics in `controller.js` and the marks
 * left on the field, and it is deliberately separate from both: the controller
 * should not know a deformation buffer exists, and the buffer should not know
 * what a foot is.
 *
 * Three writers:
 *
 *   footfall   one splat per plant, frame-accurate with the gait event. A boot is
 *              longer than it is wide and oriented with the body, so the brush is
 *              elongated and yawed rather than round.
 *   body drag  a shallow continuous scuff under a walking character, so the trail
 *              is a trail and not a row of disconnected prints.
 *   surf wake  a deep continuous groove with berms thrown to the outside of the
 *              turn. This is the centrepiece's mark on the world.
 *
 * Runs BEFORE `deformation.update()` in the frame — the brushes it queues have to
 * be in the staging array when the simulation pass runs, or every print lands a
 * frame late.
 *
 * Zero allocation: brushes are pushed straight into the field's staging array.
 *
 * ---------------------------------------------------------------------------
 * Handedness (ARCHITECTURE §6, `core/bearing.js`). The port negates world **z**
 * against the reference's left-handed frame, so every direction built from the
 * character's `facing` is the reference's formula with its z term negated:
 *
 *     PORT FRAME: forward = ( sin(facing), -cos(facing) )   in world XZ
 *                 right   = ( cos(facing),  sin(facing) )   +ve to the right
 *
 * That is what CHARACTER actually publishes — `controller.js` ("PORT FRAME:
 * right = (cos f, 0, sin f)" / "forward = (sin f, 0, -cos f)"), `figure.js` and
 * `vfx/surfWake.js` all build their bases exactly this way. This file used to
 * carry the reference's un-mirrored `forward = (sin, cos)` / `lateral =
 * (cos, -sin)` instead, which is the failure the reference's own comment warns
 * about: the wake mesh and the mark it leaves resolved their sides from opposite
 * signs, so a right turn piled its heavy wall on the wrong side of the trench
 * (acceptance criterion 4) and the boot kick threw its spray across the trail
 * rather than behind the heel.
 *
 * The brush shader's yaw is mirrored the same way, and it is the one conversion
 * that is not simply "negate the cosine" — see `brushYaw()` below.
 */

/**
 * CHARACTER's mesh yaw -> the deformation brush's world-direction angle.
 *
 * `deformSim` rotates a brush by building its LONG axis as `(cos yaw, sin yaw)`
 * in world XZ — an atan2(z, x) direction angle, not a mesh yaw. The reference
 * hands `facing` straight in, so in the reference the print's long axis is the
 * world direction `(cos f, sin f)`. Mirroring z sends that to `(cos f, -sin f)`,
 * and `(cos y, sin y) = (cos f, -sin f)` exactly when `y = -f`.
 *
 * Passing `facing` raw into the port's mirrored world is not a small error: the
 * port's forward is `(sin f, -cos f)`, whose dot with `(cos f, sin f)` is
 * identically **zero at every heading**, so every mark — boot print, walking
 * scuff and the surf groove — was stamped exactly crosswise to travel. A boot
 * print laid across the path is only 0.20 m long in the direction of travel
 * instead of 0.34 m, so consecutive prints stop touching and the trail reads as
 * a chain of separate gashes; the surf groove is worse, 0.6 m along travel
 * instead of 1.56 m, which is shorter than the distance the board covers in one
 * frame and turns a continuous carve into a row of periodic scallops.
 *
 * Spell brushes are unaffected and must not be routed through this: they build
 * their yaw as `atan2(dz, dx)` from a direction that is already in port space,
 * which is the angle the shader wants.
 *
 * @param {number} facing radians, CHARACTER's mesh yaw
 * @returns {number} radians, the brush's world-direction angle
 */
/**
 * OWNER DECISION PENDING — the print's long axis is not the direction of travel,
 * in EITHER engine.
 *
 * `deformSim` builds the brush's long axis as `(cos yaw, sin yaw)`, but `facing`
 * is a MESH yaw whose forward is `(sin f, cos f)`. Those two differ by a
 * reflection about the 45-degree line, not a rotation — so the print aligns with
 * travel only near f = PI/4 (+ n*PI/2) and lies PERPENDICULAR to it at every
 * cardinal heading. Verified top-down at f = 0 in both builds (2026-08-03): the
 * reference's prints lie across the path exactly as this port's do.
 *
 * So this is a faithful reproduction of an upstream bug, not a porting error, and
 * `brushYaw()` below is provably equivalent to the reference's raw `facing` once
 * the frame mirror is accounted for — axis-vs-travel matches the reference to the
 * degree at every heading tested (0, PI/4, PI/2, 2.4, PI).
 *
 * It went unseen through six blind critic rounds because every walking shot in the
 * battery uses heading 2.4 rad, which is 5 degrees off aligned. The owner spotted
 * it by eye in the live window.
 *
 * Fixing it means DIVERGING from the reference — deliberately, and visibly, since
 * a critic comparing the two would then prefer the port. The one-line change is to
 * pass the travel-direction angle rather than the mesh yaw:
 *     atan2(sin(facing), -cos(facing))   // port frame forward, as an XZ direction
 * Left unfixed pending that call, because ARCHITECTURE.md forbids "improving" on
 * the reference without an explicit decision.
 */
function brushYaw(facing) {
    return -facing;
}

/**
 * Boot geometry, metres. `WIDTH` is the short-axis radius, so the print is 20 cm
 * across and 34 cm long — a boot plus the collapse of the snow around it, which
 * is what a print in deep snow actually measures. Narrower than this and the
 * print is only six texels wide and the rim detail has nowhere to live.
 */
const BOOT_WIDTH = 0.10;
const BOOT_ELONG = 1.7;

/** Surf groove geometry, metres. */
const SURF_WIDTH = 0.30;
const SURF_ELONG = 2.6;

/**
 * Seeded jitter for the kicked spray.
 *
 * The reference used `Math.random()` here. ARCHITECTURE §6 forbids it anywhere
 * the shot battery can observe, and airborne grains are very much observable, so
 * this is a plain xorshift32 seeded at module load: identical input history
 * yields an identical plume, run after run. Nothing else in this file is random
 * — the brush rim wobble is a position hash inside the deformation buffer, which
 * is what keeps a re-stamped print from shimmering.
 */
let _rng = 0x9e3779b9 >>> 0;
function rand01() {
    let x = _rng;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    _rng = x;
    return x / 4294967296;
}

export class SnowContact {
    /**
     * @param {any} character the controller: position, velocity, speed, facing,
     *   surf 0..1, carve (+ve turning right), stepping, footfall/footIndex/footPos
     * @param {import("../terrain/deformation.js").DeformationField} field
     * @param {any} [figure] posed skeleton, if built: `touchdown[2]`, `plant[6]`
     * @param {any} [spray] the spray field, if built: `emit(x,y,z,vx,vy,vz,size,life,kind)`
     */
    constructor(character, field, figure, spray) {
        this.character = character;
        this.field = field;
        this.spray = spray || null;
        /**
         * The posed figure, when there is one.
         *
         * The controller also produces footfall events, and they are close enough
         * to be tempting. But "close enough" is exactly what a footprint cannot
         * be: the print has to be under the boot, and only the figure knows where
         * the boot actually planted, because it is the thing that decided. Taking
         * the event from the same state machine that freezes the stance foot makes
         * the two agree by construction rather than by matching two sets of
         * constants.
         */
        this.figure = figure || null;

        /** Distance travelled since the last continuous splat, metres. */
        this._sinceSplat = 0;
        this._prevX = character.position.x;
        this._prevZ = character.position.z;
    }

    /** @param {number} dt seconds */
    update(dt) {
        const ch = this.character;
        const f = this.field;

        // Updated UNCONDITIONALLY, before any airborne gate. If the tracker were
        // frozen during a flight, the first grounded frame would see `moved` =
        // the whole horizontal distance of the jump and lay one enormous brush
        // from the take-off point to the landing point — the exact smear the
        // gate exists to prevent, reintroduced by the gate itself.
        const dx = ch.position.x - this._prevX;
        const dz = ch.position.z - this._prevZ;
        const moved = Math.hypot(dx, dz);
        this._prevX = ch.position.x;
        this._prevZ = ch.position.z;

        // ===================================================================
        // GROUND CONTACT GATE
        // ===================================================================
        // A foot in the air marks nothing. EVERY writer below is gated on this
        // one flag — the footfall stamp, the body-drag scuff and the surf groove
        // alike — so the trail simply stops at the take-off point and resumes at
        // the landing point, with clean ends at both.
        //
        // The failure this is written against is specific and is described in
        // this file's own contract with `figure.js`: a planted foot's position is
        // written EXACTLY ONCE, on touchdown, and merely copied for the rest of
        // the stance. So a stale plant — the one recorded before take-off —
        // remains a perfectly valid-looking coordinate for the whole flight, and
        // any writer that runs while airborne stamps a crisp print on ground the
        // boot is nowhere near. `figure.js` additionally refuses to raise
        // `touchdown` while airborne, so this gate and that one have to BOTH fail
        // before a print can land mid-flight.
        const grounded = !ch.airborne;

        if (grounded && ch.surf > 0.02) this._surf(dt, moved);
        if (grounded && ch.surf < 0.98) this._walk(dt, moved);

        // The landing, before the footfall loop: the compression brush is the
        // ground taking the body's weight, and the boot prints of the recovery
        // stance are stamped on top of it.
        if (ch.landed) this._land();

        // Footfalls fire regardless of mode; the gait suppresses them while
        // surfing because the feet are on the board, and `grounded` suppresses
        // them outright while there is no ground under the boot.
        const fig = this.figure;
        for (let i = 0; grounded && i < 2; i++) {
            let px, pz;
            if (fig) {
                if (!fig.touchdown[i] || !ch.stepping) continue;
                px = fig.plant[i * 3];
                pz = fig.plant[i * 3 + 2];
            } else {
                if (!ch.footfall || i !== ch.footIndex) continue;
                px = ch.footPos.x;
                pz = ch.footPos.z;
            }

            // Recomputed here rather than read off the controller, so it cannot
            // be a frame stale relative to the plant it is describing.
            const impact = Math.min(1.3, 0.35 + ch.speed / 5.4);
            f.brush(
                px, pz,
                BOOT_WIDTH,
                // Depth: a boot sinks 13-27 cm into unpacked snow depending on
                // how hard it lands. Deeper than that and the character is
                // wading, which is a different animation problem.
                0.17 + 0.14 * impact,
                // The berm is the whole point. Mass pushed out of the hole has to
                // go somewhere, and seeing it pile at the rim is what makes the
                // print read as displaced snow rather than as a dark decal.
                0.10 + 0.08 * impact,
                0.9,                    // compression: trodden snow is dense
                0,                      // no ice
                brushYaw(ch.facing),
                BOOT_ELONG,
                1.0                     // full rim roughness — boots tear edges
            );

            const py = fig ? fig.plant[i * 3 + 1] : ch.position.y;
            this._kick(px, py, pz, impact);
        }
    }

    /**
     * Touchdown from a jump.
     *
     * A landing with no snow response reads as floating, and it is the single
     * cheapest tell that a jump is fake — the arc can be perfect and the frame
     * still lies if the ground does not answer. Two things answer here: one
     * compression brush deeper and wider than any footfall, and a burst through
     * the same `spray.emit` path the footfall kick uses.
     *
     * Both boots arrive together, so this is nearly round (elongation 1.25)
     * rather than boot-shaped, and it is stamped at the body's position rather
     * than at either foot's.
     */
    _land() {
        const ch = this.character;
        const imp = ch.landImpact; // 0..1, from the descent rate at touchdown

        this.field.brush(
            ch.position.x, ch.position.z,
            // Wider than a boot: this is the whole stance, plus the collapse of
            // the snow around a body arriving with its full weight behind it.
            BOOT_WIDTH * (1.9 + 0.7 * imp),
            // Deeper than the 0.17-0.31 m a walking footfall sinks. A landing is
            // the one contact in the demo that should visibly punch the surface.
            0.21 + 0.28 * imp,
            // And it throws a correspondingly heavier rim.
            0.13 + 0.17 * imp,
            1.0,   // compression: fully packed, harder than a footfall's 0.9
            0,     // no ice
            brushYaw(ch.facing),
            1.25,
            1.0    // full rim roughness — the edge tears
        );

        // `true` bypasses the kick's minimum-speed gate: a jump straight up
        // lands with zero horizontal speed, and that is exactly the landing that
        // most needs the spray, since nothing else in frame is moving.
        this._kick(ch.position.x, ch.position.y, ch.position.z, 0.85 + 0.5 * imp, true);
    }

    /**
     * Snow thrown by a boot landing.
     *
     * Fired from the same branch that stamps the print, so the grains leave the
     * ground on the exact frame the foot arrives — one event, rather than two
     * systems agreeing about when it happened.
     *
     * The kick goes up and *backward* relative to travel. A boot in deep snow
     * scoops: it enters forward, compresses, and throws the displaced snow out
     * behind the heel as the weight rolls over it.
     *
     * A LANDING is the one caller that does not want that backward scoop: two
     * boots arriving flat throw snow outward in a ring, and it is the only
     * caller that can legitimately fire at zero speed.
     *
     * @param {number} x @param {number} y @param {number} z @param {number} impact
     * @param {boolean} [fromLanding] radial burst, and no minimum-speed gate
     */
    _kick(x, y, z, impact, fromLanding) {
        const sp = this.spray;
        if (!sp || typeof sp.emit !== "function") return;
        const ch = this.character;
        // A walking kick at a standstill would be snow thrown by a foot that is
        // not going anywhere. A landing at a standstill is a body hitting snow.
        if (!fromLanding && ch.speed < 0.4) return;

        // Forward in world XZ — PORT FRAME, see the handedness note at the top of
        // the file. The reference, being left-handed, writes (sin f, cos f); with
        // that sign here the kick left the heel sideways instead of behind it.
        const fx = Math.sin(ch.facing);
        const fz = -Math.cos(ch.facing);
        // Many small grains rather than a few large ones. The size at which a
        // puff stops reading as powder and starts reading as a cotton ball is
        // somewhere around five centimetres, and it is a hard threshold.
        const n = 6 + ((impact * 14) | 0);

        for (let k = 0; k < n; k++) {
            // A landing throws its grains out sideways in a low ring rather than
            // back from a heel, so the horizontal spread widens and the
            // directional term all but disappears.
            const spread = fromLanding ? 2.2 : 0.9;
            const rx = (rand01() - 0.5) * spread;
            const rz = (rand01() - 0.5) * spread;
            // Lower and faster off the deck than a footfall puff: the snow is
            // squeezed out from under the boots, not lofted by them.
            const up = fromLanding
                ? 0.5 + rand01() * 1.3
                : 0.9 + rand01() * 1.9;
            const back = (0.5 + rand01() * 1.6 * impact) * (fromLanding ? 0.2 : 1);
            // A fifth of it is heavier stuff that flies further and falls faster.
            const clod = rand01() < 0.22 ? 1 : 0;

            sp.emit(
                x + rx * 0.09, y + 0.03 + rand01() * 0.05, z + rz * 0.09,
                -fx * back + rx * 1.3 + ch.velocity.x * 0.25,
                up * (clod ? 1.25 : 1.0),
                -fz * back + rz * 1.3 + ch.velocity.z * 0.25,
                clod ? 0.014 + rand01() * 0.012 : 0.020 + rand01() * 0.030,
                clod ? 0.55 + rand01() * 0.35 : 0.55 + rand01() * 0.60,
                clod
            );
        }
    }

    /**
     * Walking scuff. Very shallow, and only while actually moving — a standing
     * character should not slowly bore a hole.
     * @param {number} dt @param {number} moved metres travelled this frame
     */
    _walk(dt, moved) {
        const ch = this.character;
        if (ch.speed < 0.25) return;

        const w = 1 - ch.surf;
        // Scaled by distance travelled, not by dt, so the groove has the same
        // depth per metre at any speed or frame rate. A given patch of ground
        // sits under the brush for (2 * radius / moved) frames, so the depth it
        // ends up at is roughly rate * 2 * radius * profile — independent of both
        // speed and frame rate, which is the point.
        const k = Math.min(moved, 0.35);
        // Compression stays deliberately below saturation here. If the scuff
        // packed the whole path to 1.0, the boot prints stamped on top would have
        // nothing left to darken and the trail would read as one flat ribbon
        // instead of as a line of prints in a churned path.
        //
        // Shallower and narrower than the boot prints it links, on purpose. It
        // was originally deep enough to dominate them, which turned a line of
        // footprints into one continuous ski track — fine while the feet were
        // hidden under a floor-length robe, wrong now that they are not.
        this.field.brush(
            ch.position.x, ch.position.z,
            0.22,
            0.20 * k * w,
            0.22 * k * w,
            0.8 * k * w,
            0,
            brushYaw(ch.facing),
            1.5,
            0.85
        );
    }

    /**
     * The surf wake.
     *
     * Three brushes: the groove the board cuts, and one berm on each side
     * weighted by the carve, so the outside of a turn throws a much heavier wall
     * of snow than the inside. That asymmetry is what makes a carve read as a
     * carve rather than as a straight furrow.
     * @param {number} dt @param {number} moved metres travelled this frame
     */
    _surf(dt, moved) {
        const ch = this.character;
        const f = this.field;
        const s = ch.surf;

        // Below a walking pace there is no wake to speak of; splatting anyway
        // would just dig a pit wherever the player coasted to a stop.
        const speedK = Math.min(1, ch.speed / 6);
        if (speedK < 0.05) return;

        const k = Math.min(moved, 0.6) * s * speedK;
        if (k <= 0) return;

        // Past the point where the trench stops deepening, extra speed still
        // means extra snow moved — it goes into width and into the walls, which
        // is what makes a fast run's scar read as bigger rather than just longer.
        const fast = Math.min(1, Math.max(0, ch.speed - 6) / 12);

        // The brush's world-direction angle, not the mesh yaw — see brushYaw().
        const yaw = brushYaw(ch.facing);
        // The character's RIGHT axis, world XZ — PORT FRAME (cos f, sin f), the
        // same basis `vfx/surfWake.js` stores for the airborne wave, so the wall
        // and the mark it leaves resolve their sides from one sign. See the
        // handedness note at the top of the file: this is the line that decides
        // which side of the turn takes the heavy wall.
        const rx = Math.cos(ch.facing);
        const rz = Math.sin(ch.facing);

        // --- the groove ------------------------------------------------------
        // The board rides the inside edge in a turn, so the trench offsets
        // slightly toward the lean.
        const lean = ch.carve;
        const gx = ch.position.x + rx * lean * 0.12;
        const gz = ch.position.z + rz * lean * 0.12;

        f.brush(
            gx, gz,
            SURF_WIDTH * (1 + 0.35 * fast),
            1.20 * k,   // deep — a run should be visible from across the field
            0.30 * k,
            4.0 * k,    // the board packs the trench floor hard
            0,
            yaw,
            SURF_ELONG,
            0.55        // the board's edge is cleaner than a boot's
        );

        // --- thrown mass -----------------------------------------------------
        // The outside of the turn takes most of it, and the outside of a *right*
        // turn is the left-hand side — the board resists the turn and throws snow
        // away from its centre, the same way a carving snowboard's spray arcs out
        // of the turn rather than into it. `carve` is positive turning right, so
        // the weights run against it.
        //
        // The wake mesh in `src/vfx/surfWake.js` resolves its sides from the same
        // sign, so the airborne wave and the mark it leaves agree.
        //
        // Both of these write ZERO depression — pure displaced mass. They are the
        // isolated-berm case the simulation's slump term protects with its min():
        // with no depression under them they cannot slump away, only diffuse.
        const outside = Math.min(1, Math.abs(lean));
        const sideL = 0.5 + lean * 0.5; // weight on the left berm
        const sideR = 0.5 - lean * 0.5;

        const off = SURF_WIDTH * (1.5 + 0.5 * fast);
        const throwK = 0.75 * k * (0.55 + 0.9 * outside) * (1 + 0.5 * fast);

        f.brush(
            ch.position.x - rx * off, ch.position.z - rz * off,
            SURF_WIDTH * 0.95,
            0, throwK * sideL * 2.0, 0, 0,
            yaw, SURF_ELONG * 0.8, 1.0
        );
        f.brush(
            ch.position.x + rx * off, ch.position.z + rz * off,
            SURF_WIDTH * 0.95,
            0, throwK * sideR * 2.0, 0, 0,
            yaw, SURF_ELONG * 0.8, 1.0
        );
    }
}
