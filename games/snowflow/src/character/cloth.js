/**
 * Garment simulation — Verlet cloth on coarse grids.
 *
 * Port of `snowflow_demo/src/character/cloth.js`. 100% CPU; there is no compute
 * shader to port and there must not be one — the Gauss-Seidel sweep order below
 * is not reproducible in a parallel pass, and the whole solve is 788 particles.
 *
 * Each garment is a closed tube of particles, `cols` around by `rows` down. The
 * grids are deliberately coarse (36 x 12 for the robe) because the render mesh
 * does not use them directly: the vertex shader reconstructs a smooth surface
 * from them with Catmull-Rom (`lib/charSkin`), so tessellation and simulation
 * cost are completely decoupled. Doubling the visible smoothness costs nothing.
 *
 * Every particle carries a bind-pose position and one bone. Its kinematic target
 * each frame is that bind position pushed through the bone's skinning matrix —
 * exactly what a rigidly-skinned vertex would do. A per-particle `pinRate`
 * decides how hard it is pulled toward that target, in units of 1/second:
 *
 *   Infinity   the waistband, the collar, the shoulder of a sleeve. Welded.
 *   10-60      follows the body closely, with a frame or two of give.
 *   1-5        follows loosely — where a garment starts to read as cloth.
 *   0.2-0.5    shape memory only. Stops a free hem from slowly collapsing into
 *              a rope without meaningfully resisting motion.
 *
 * Expressing the pull as a RATE rather than a per-frame blend is not a detail: a
 * "0.05 blend" applied 165 times a second is a 12 ms time constant, which is a
 * weld. There is no separate shape-memory solver — shape memory IS a very low
 * pinRate toward the skinned rest shape, which is why the pleats authored into
 * `bindPos` are recovered rather than damped out.
 *
 * Folds live in the REST SHAPE, not in a normal map. `finalise()` measures every
 * rest length from the bind pose, so the ring lengths around a pleated tube are
 * unequal — long across a fold crest, short in a valley — and the distance
 * constraint actively preserves the fold. A normal map would slide the fold
 * across the surface as the garment moves; here the fold is a property of the
 * particle grid and travels with it.
 *
 * Wind is APPARENT wind — the field wind minus the character's own velocity —
 * with quadratic drag, which is the single line that lays the robe out flat
 * behind a snow-surf run with no special case anywhere.
 *
 * Allocation: none per frame. All state is typed arrays sized at construction.
 *
 * ===========================================================================
 * HANDEDNESS — the mirror, and the one extra thing it needs here
 * ===========================================================================
 *
 * As everywhere in this port, the world is the reference's mirrored in z. The
 * rest-shape generators below are transcribed VERBATIM in the reference frame
 * (+z forward) and `ClothPanel.setNode` applies the mirror as it stores.
 *
 * But `setNode` does one thing more than negate z: it stores reference column
 * `ic` at port column `(cols - ic) % cols`, i.e. it REVERSES the order of the
 * columns around the tube. That is required, and it is required in exactly one
 * other place — `sampleCloth`'s `cross(pv, pu)` in `lib/charSkin`.
 *
 * Mirroring flips the sign of every cross product, so a straight z-negation
 * would make `cross(pv, pu)` point INTO the body and every garment would light
 * inside-out. Reversing the columns flips the sign of `pu` as well, and the two
 * flips cancel exactly: cross(M*pv, -M*pu) = M*cross(pv, pu) = the mirrored
 * outward normal. Neither half may move without the other.
 *
 * Reversal is free everywhere else: it relabels indices without moving a
 * particle, so `finalise()` measures identical rest lengths, the render lattice
 * still maps u = 0 to node column 0, and only the direction the weave UV runs
 * around the tube changes — which is invisible.
 */

import { S } from "../core/settings.js";
import {
    B_ROOT, B_CHEST, B_NECK,
    B_UPPER_L, B_FORE_L, B_HAND_L,
    B_UPPER_R, B_FORE_R, B_HAND_R,
    B_THIGH_L, B_SHIN_L, B_FOOT_L,
    B_THIGH_R, B_SHIN_R, B_FOOT_R,
} from "./figure.js";
import { M_ROBE, M_MANTLE } from "./build.js";

/** Which body capsules a panel is allowed to collide against. */
const C_TORSO = 1;
const C_LEGS = 2;
const C_ARM_L = 4;
const C_ARM_R = 8;

export class ClothPanel {
    constructor(spec) {
        this.name = spec.name;
        this.cols = spec.cols;
        this.rows = spec.rows;
        this.matId = spec.matId;
        this.renderCols = spec.renderCols;
        this.renderRows = spec.renderRows;
        this.weaveU = spec.weaveU;
        this.weaveV = spec.weaveV;
        this.aoTop = spec.aoTop;
        this.aoBottom = spec.aoBottom;
        this.collide = spec.collide;
        /** Rows at the bottom that check the snow surface. */
        this.groundRows = spec.groundRows || 0;
        /** Row in the shared transform texture where this panel's grid starts. */
        this.nodeRow = 0;

        const n = this.cols * this.rows;
        this.count = n;
        this.bindPos = new Float32Array(n * 3);
        this.pos = new Float32Array(n * 3);
        this.prev = new Float32Array(n * 3);
        this.target = new Float32Array(n * 3);
        this.bone = new Int32Array(n);
        this.pinRate = new Float32Array(n);

        // Rest lengths: around the ring, down the panel, and the bending pair two
        // rows apart. Measured from the bind pose, so the garment's rest shape
        // *is* its authored shape.
        this.restU = new Float32Array(n);
        this.restV = new Float32Array(n);
        this.restB = new Float32Array(n);
    }

    /**
     * Store one authored node, converting the reference frame to the port's.
     *
     * `ic` is the REFERENCE column index; the node lands at port column
     * `(cols - ic) % cols` with z negated. See the handedness note in the file
     * header — this is one half of a two-part trade with `sampleCloth`.
     *
     * @param {number} ic reference column
     * @param {number} j row
     * @param {number} x @param {number} y @param {number} z reference-frame metres
     * @param {number} bone @param {number} rate pinRate, 1/s (may be Infinity)
     * @returns {void}
     */
    setNode(ic, j, x, y, z, bone, rate) {
        const ip = (this.cols - ic) % this.cols;
        const k = j * this.cols + ip;
        this.bindPos[k * 3] = x;
        this.bindPos[k * 3 + 1] = y;
        this.bindPos[k * 3 + 2] = -z;
        this.bone[k] = bone;
        this.pinRate[k] = rate;
    }

    /** Called once the bind positions are filled in. */
    finalise() {
        const cols = this.cols, rows = this.rows, bindPos = this.bindPos;
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const a = (j * cols + i) * 3;
                const bu = (j * cols + ((i + 1) % cols)) * 3;
                this.restU[j * cols + i] = dist3(bindPos, a, bindPos, bu);
                if (j + 1 < rows) {
                    const bv = ((j + 1) * cols + i) * 3;
                    this.restV[j * cols + i] = dist3(bindPos, a, bindPos, bv);
                }
                if (j + 2 < rows) {
                    const bb = ((j + 2) * cols + i) * 3;
                    this.restB[j * cols + i] = dist3(bindPos, a, bindPos, bb);
                }
            }
        }
        // The simulation starts exactly on the authored shape with zero velocity.
        this.pos.set(bindPos);
        this.prev.set(bindPos);
    }
}

function dist3(a, ia, b, ib) {
    return Math.hypot(a[ia] - b[ib], a[ia + 1] - b[ib + 1], a[ia + 2] - b[ib + 2]);
}

// -----------------------------------------------------------------------------
//  Garment shapes — all in the REFERENCE frame; setNode applies the mirror
// -----------------------------------------------------------------------------

/** Piecewise-linear lookup over a table of `[t, a, b]` control points. */
function curve(table, t) {
    let i = 0;
    while (i < table.length - 2 && t > table[i + 1][0]) i++;
    const A = table[i], Bb = table[i + 1];
    const s = Bb[0] > A[0] ? (t - A[0]) / (Bb[0] - A[0]) : 0;
    const k = Math.min(1, Math.max(0, s));
    return [A[1] + (Bb[1] - A[1]) * k, A[2] + (Bb[2] - A[2]) * k];
}

/**
 * The robe: a long tube from the waist, flaring to a hem cut high at the front
 * so the boots read, and trailing behind. The asymmetry is what makes the
 * silhouette move when the figure turns — and with the boots hidden all the way
 * round, the entire foot-planting solve would be invisible.
 *
 * Front hem 0.4729 m, back hem 0.1271 m: a 34.6 cm difference, and that is the
 * train. The back also flares 27% further than the front.
 */
function makeRobe() {
    const p = new ClothPanel({
        // Thirty-six columns is set by the FOLD COUNT, not by smoothness: nine
        // pleats need four samples each to survive the grid at all, and the
        // Catmull-Rom reconstruction turns four samples per fold into a clean
        // wave. Twenty columns aliased them into a wobble.
        name: "robe", cols: 36, rows: 12, matId: M_ROBE,
        renderCols: 72, renderRows: 32,
        // Metres of surface, so the shader's weave and slub scales are physical.
        weaveU: 1.75, weaveV: 1.05,
        aoTop: 0.55, aoBottom: 0.42,
        collide: C_TORSO | C_LEGS, groundRows: 2,
    });

    // Row 0 welded to the waistband; rows 9-11 are the shape-memory band
    // (0.3 /s is a 3.3 s time constant).
    const RATE = [Infinity, 30, 10, 4, 1.6, 0.9, 0.55, 0.4, 0.35, 0.3, 0.3, 0.3];

    for (let j = 0; j < p.rows; j++) {
        const v = j / (p.rows - 1);
        for (let i = 0; i < p.cols; i++) {
            const a = (i / p.cols) * Math.PI * 2;
            const sa = Math.sin(a), ca = Math.cos(a);
            // The flare accelerates downward, and the back flares furthest —
            // that extra fabric is what becomes the train.
            const f = Math.pow(v, 1.25);

            // Pleats. A garment cut as a smooth cone stays a smooth cone: the
            // solver has nothing to break the symmetry with, and a robe with no
            // vertical folds reads as a traffic cone no matter how good the
            // shading is. Putting the folds in the REST SHAPE means the
            // constraints preserve them, they deepen toward the hem where the
            // fabric is loose, and they travel with the garment rather than
            // sliding across it the way a normal map would.
            //
            // Three incommensurate frequencies, so no two folds are alike and the
            // pattern never repeats around the tube. `f = v^1.25` makes them
            // exactly zero at the waistband and deepest at the hem.
            const fold =
                0.118 * Math.sin(a * 7 + 0.6) +
                0.055 * Math.sin(a * 12 + 2.1) +
                0.026 * Math.sin(a * 19 + 4.4);
            const pleat = 1 + f * fold;

            // ca = +1 at the front, -1 at the back. The hem hangs LOWEST at the
            // crest of a fold, where there is most fabric to hang; the other sign
            // produced a row of hard spikes.
            const hemY = 0.300 + 0.200 * ca - 0.048 * Math.sin(a * 7 + 0.6);
            const y = 0.990 + (hemY - 0.990) * v;

            const rx = (0.158 + (0.345 - 0.158) * f) * pleat;
            const rz = (0.128 + (0.318 - 0.128) * f * (1 - 0.12 * ca)) * pleat;

            p.setNode(i, j, rx * sa, y, rz * ca - 0.010 * v, B_ROOT, RATE[j]);
        }
    }
    p.finalise();
    return p;
}

/**
 * The over-mantle: a short cape that clears the shoulders and falls to the small
 * of the back. Its job is to break up the vertical line of the robe and to catch
 * the light on the shoulders, which is the read that says "layered" from fifteen
 * metres. Front edge 1.1945 m, back edge 0.8955 m.
 */
function makeMantle() {
    const p = new ClothPanel({
        name: "mantle", cols: 28, rows: 7, matId: M_MANTLE,
        renderCols: 64, renderRows: 22,
        weaveU: 1.35, weaveV: 0.72,
        aoTop: 0.85, aoBottom: 0.6,
        collide: C_TORSO | C_ARM_L | C_ARM_R,
    });

    const RATE = [Infinity, 40, 12, 4, 1.5, 0.8, 0.45];
    // The collar has to clear the torso it sits on: starting it INSIDE the
    // shoulders (0.176 across) is what stops the mantle reading as a flat plate
    // bolted to the chest.
    const RAD = [
        [0.00, 0.176, 0.148],
        [0.20, 0.222, 0.176],
        [0.55, 0.235, 0.196],
        [1.00, 0.246, 0.214],
    ];
    // Stops around the elbow, so the sleeves and their fur cuffs stay visible
    // below it. A mantle long enough to cover the forearms swallows the whole
    // silhouette into one dark mass.
    const YT = [
        [0.00, 1.442, 0],
        [0.20, 1.352, 0],
        [0.55, 1.220, 0],
        [1.00, 0.000, 0], // filled per COLUMN below
    ];

    for (let j = 0; j < p.rows; j++) {
        const v = j / (p.rows - 1);
        // RAD is column-independent and is hoisted, exactly as the reference
        // hoists it.
        const rr = curve(RAD, v);
        const rx = rr[0], rz = rr[1];
        for (let i = 0; i < p.cols; i++) {
            const a = (i / p.cols) * Math.PI * 2;
            const sa = Math.sin(a), ca = Math.cos(a);
            // ORDERING HAZARD: YT[3][1] is written inside the column loop and
            // read by the very next curve() call, so the mantle's bottom edge is
            // a function of the column. Hoisting curve(YT, v) out of this loop
            // gives a flat circular hem and loses the scallop entirely.
            YT[3][1] = 1.045 + 0.115 * ca + 0.035 * Math.sin(a * 7 + 1.4);
            const y = curve(YT, v)[0];
            const pleat =
                1 + v * (0.062 * Math.sin(a * 7 + 1.4) + 0.026 * Math.sin(a * 11 + 3.0));

            p.setNode(i, j, rx * sa * pleat, y, rz * ca * pleat - 0.012, B_CHEST, RATE[j]);
        }
    }
    p.finalise();
    return p;
}

/**
 * A sleeve. Pinned tightly along the arm and genuinely loose only past the
 * wrist, where the cuff drapes. A fully free sleeve looks wonderful for about
 * four seconds and then slides off the elbow.
 */
function makeSleeve(side) {
    const s = side === 0 ? -1 : 1;
    const p = new ClothPanel({
        name: "sleeve" + side, cols: 10, rows: 8, matId: M_ROBE,
        renderCols: 26, renderRows: 20,
        weaveU: 0.46, weaveV: 0.66,
        aoTop: 0.6, aoBottom: 0.5,
        collide: side === 0 ? C_ARM_L : C_ARM_R,
    });

    // Reference-frame arm anchors; setNode mirrors them.
    const UP = [s * 0.185, 1.400, 0.000];
    const EL = [s * 0.230, 1.123, 0.000];
    const WR = [s * 0.243, 0.866, 0.016];

    // Beyond the wrist, continuing the forearm's direction.
    let dx = WR[0] - EL[0], dy = WR[1] - EL[1], dz = WR[2] - EL[2];
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;

    // (segment, t, radius) per row. Segment 0 = upper arm, 1 = forearm,
    // 2 = past the wrist, where `t` is an ABSOLUTE distance in metres.
    // Row 6 -> 7 is where the radius jumps 0.072 -> 0.098, a 36% flare: that is
    // the drape of the cuff. Segment 1 starts at t = 0.40, not 0, so there is a
    // deliberate gap in ring density right at the elbow.
    const ROWS = [
        [0, 0.00, 0.084], [0, 0.45, 0.076], [0, 1.00, 0.072],
        [1, 0.40, 0.068], [1, 0.75, 0.064], [1, 1.00, 0.061],
        [2, 0.045, 0.072], [2, 0.125, 0.098],
    ];
    const BONE = [
        B_UPPER_L, B_UPPER_L, B_UPPER_L,
        B_FORE_L, B_FORE_L, B_FORE_L, B_FORE_L, B_HAND_L,
    ];
    const BONE_R = [
        B_UPPER_R, B_UPPER_R, B_UPPER_R,
        B_FORE_R, B_FORE_R, B_FORE_R, B_FORE_R, B_HAND_R,
    ];
    // Deliberately NON-MONOTONIC: row 3 (40) is pinned harder than row 2 (26).
    // The sleeve is re-anchored at the top of the forearm so it cannot slide off
    // the elbow. Only rows 6 and 7 are genuinely loose.
    const RATE = [Infinity, 50, 26, 40, 18, 9, 5, 1.2];

    for (let j = 0; j < p.rows; j++) {
        const seg = ROWS[j][0], t = ROWS[j][1], r = ROWS[j][2];
        let cx, cy, cz;
        if (seg === 0) {
            cx = UP[0] + (EL[0] - UP[0]) * t;
            cy = UP[1] + (EL[1] - UP[1]) * t;
            cz = UP[2] + (EL[2] - UP[2]) * t;
        } else if (seg === 1) {
            cx = EL[0] + (WR[0] - EL[0]) * t;
            cy = EL[1] + (WR[1] - EL[1]) * t;
            cz = EL[2] + (WR[2] - EL[2]) * t;
        } else {
            cx = WR[0] + dx * t; cy = WR[1] + dy * t; cz = WR[2] + dz * t;
        }
        const bone = (side === 0 ? BONE : BONE_R)[j];
        for (let i = 0; i < p.cols; i++) {
            const a = (i / p.cols) * Math.PI * 2;
            // The arm is near-vertical in the bind pose, so the ring lies flat
            // in XZ — there is no parallel-transport frame here.
            p.setNode(i, j, cx + Math.sin(a) * r, cy, cz + Math.cos(a) * r, bone, RATE[j]);
        }
    }
    p.finalise();
    return p;
}

/** Panel order is fixed and is the panel index used everywhere. */
export function makePanels() {
    return [makeRobe(), makeMantle(), makeSleeve(0), makeSleeve(1)];
}

// -----------------------------------------------------------------------------
//  Solver
// -----------------------------------------------------------------------------

/** Constraint relaxation iterations. Six is where the robe stops looking rubbery. */
const ITERATIONS = 6;

/** Capsule table: [boneA, boneB, radius, mask]. Rebuilt from joints each frame. */
const CAPSULES = [
    [B_ROOT, B_NECK, 0.175, C_TORSO],
    [B_THIGH_L, B_SHIN_L, 0.125, C_LEGS],
    [B_SHIN_L, B_FOOT_L, 0.098, C_LEGS],
    [B_THIGH_R, B_SHIN_R, 0.125, C_LEGS],
    [B_SHIN_R, B_FOOT_R, 0.098, C_LEGS],
    [B_UPPER_L, B_FORE_L, 0.078, C_ARM_L],
    [B_FORE_L, B_HAND_L, 0.068, C_ARM_L],
    [B_UPPER_R, B_FORE_R, 0.078, C_ARM_R],
    [B_FORE_R, B_HAND_R, 0.068, C_ARM_R],
];

export class ClothSolver {
    /**
     * @param {ClothPanel[]} panels
     * @param {{heightAt(x:number,z:number):number}} terrain
     */
    constructor(panels, terrain) {
        this.panels = panels;
        this.terrain = terrain;
        this._wind = new Float32Array(3);
        this._t = 0;
    }

    /**
     * @param {number} dt
     * @param {import("./figure.js").Figure} fig
     * @param {import("./controller.js").CharacterController} ch
     * @returns {void}
     */
    update(dt, fig, ch) {
        // Two sub-steps at 30 Hz and below. Verlet with hard pins is stable, but
        // collision runs once per substep at the END, and a long step lets the
        // hem overshoot through the legs before the collision pass sees it.
        let h = Math.min(dt, 1 / 30);
        let steps = 1;
        if (h > 1 / 55) { steps = 2; h *= 0.5; }
        // Advanced by the FULL dt, once, before the substep loop — so wind and
        // turbulence sample the same `_t` in both substeps of a frame.
        this._t += dt;

        // ---- apparent wind ------------------------------------------------
        // Field wind 3.2 m/s at defaults, gusting 0.47x to 1.53x at two
        // incommensurate rates (0.111 Hz and 0.366 Hz), so a standing figure's
        // robe is never dead still. Subtracting the character's own velocity is
        // what makes it *apparent* wind, and is the single line that lays the
        // robe out flat behind a surf run.
        const a = (S.windDirection * Math.PI) / 180;
        const ws = 3.2 * S.windStrength;
        const gust = 1 + 0.35 * Math.sin(this._t * 0.7) + 0.18 * Math.sin(this._t * 2.3 + 1.1);
        // PORT FRAME: bearing a = 0 blows toward the reference's +z, which is the
        // port's -z, hence the minus on the z component. `ch.velocity` is already
        // in the port frame and is subtracted as-is.
        this._wind[0] = Math.sin(a) * ws * gust - ch.velocity.x;
        this._wind[1] = 0.35 * Math.sin(this._t * 1.9);
        this._wind[2] = -Math.cos(a) * ws * gust - ch.velocity.z;

        for (let s = 0; s < steps; s++) {
            for (let i = 0; i < this.panels.length; i++) {
                this._step(this.panels[i], h, fig);
            }
        }
    }

    _step(p, h, fig) {
        const n = p.count;
        const pos = p.pos;
        const prev = p.prev;
        const target = p.target;
        const skin = fig.skin;

        // ---- kinematic targets, from the skeleton -------------------------
        // skin is column-major: [b+0..3] is column 0, [b+4..7] column 1, etc.
        for (let k = 0; k < n; k++) {
            const b = p.bone[k] * 16;
            const o = k * 3;
            const x = p.bindPos[o], y = p.bindPos[o + 1], z = p.bindPos[o + 2];
            target[o] = skin[b] * x + skin[b + 4] * y + skin[b + 8] * z + skin[b + 12];
            target[o + 1] = skin[b + 1] * x + skin[b + 5] * y + skin[b + 9] * z + skin[b + 13];
            target[o + 2] = skin[b + 2] * x + skin[b + 6] * y + skin[b + 10] * z + skin[b + 14];
        }

        // ---- integrate ----------------------------------------------------
        // The drag is NOT a relative-velocity drag: it is wind * (0.085 * |wind|),
        // an acceleration along the wind direction whose magnitude is quadratic
        // in wind speed. The cloth's own velocity never enters. At |w| = 19 m/s
        // that is 30.7 m/s^2, about 3.1 g on every free particle.
        //
        // This is plain, non-time-corrected Verlet: `v` is a raw displacement
        // carried from the previous step, not a velocity divided by the previous
        // h. Do not "fix" it — the visible damping character changes.
        const wx = this._wind[0], wy = this._wind[1], wz = this._wind[2];
        const wmag = Math.hypot(wx, wy, wz);
        const drag = 0.085 * wmag;
        const damp = Math.pow(0.90, h * 60);
        const h2 = h * h;

        for (let k = 0; k < n; k++) {
            if (!isFinite(p.pinRate[k])) continue; // welded; skip the integrator
            const o = k * 3;
            // Turbulence, hashed off the particle index so it does not pulse in
            // unison across the garment. PORT FRAME: the z component is negated,
            // which is the mirror of the reference's vector.
            const ph = k * 1.7 + this._t * 4.5;
            const tx = Math.sin(ph) * 0.9;
            const ty = Math.sin(ph * 1.31 + 2.1) * 0.7;
            const tz = -Math.cos(ph * 0.87 + 0.4) * 0.9;

            const ax = wx * drag + tx * drag * 0.25;
            const ay = wy * drag - 9.81 + ty * drag * 0.25;
            const az = wz * drag + tz * drag * 0.25;

            const vx = (pos[o] - prev[o]) * damp;
            const vy = (pos[o + 1] - prev[o + 1]) * damp;
            const vz = (pos[o + 2] - prev[o + 2]) * damp;

            prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
            pos[o] += vx + ax * h2;
            pos[o + 1] += vy + ay * h2;
            pos[o + 2] += vz + az * h2;
        }

        // ---- constraints ---------------------------------------------------
        for (let it = 0; it < ITERATIONS; it++) {
            this._anchors(p, h);
            this._distance(p, it);
        }
        // ONCE, after all six iterations — not interleaved.
        this._collide(p, fig);
    }

    /** Pull each particle toward its skinned target at its own rate. */
    _anchors(p, h) {
        const n = p.count;
        const pos = p.pos;
        const target = p.target;
        for (let k = 0; k < n; k++) {
            const rate = p.pinRate[k];
            const o = k * 3;
            if (!isFinite(rate)) {
                pos[o] = target[o];
                pos[o + 1] = target[o + 1];
                pos[o + 2] = target[o + 2];
                continue;
            }
            if (rate <= 0) continue;
            // Divided by the iteration count so the total pull over one frame is
            // the rate the table asks for, not six times it.
            const w = (1 - Math.exp(-rate * h)) / ITERATIONS;
            pos[o] += (target[o] - pos[o]) * w;
            pos[o + 1] += (target[o + 1] - pos[o + 1]) * w;
            pos[o + 2] += (target[o + 2] - pos[o + 2]) * w;
        }
    }

    /**
     * Distance and bending constraints, Gauss-Seidel and in place.
     *
     * The row-major sweep order is load-bearing: at only six iterations a
     * different order gives a measurably different drape. Bending is solved
     * softly (0.22) and only on iterations 3, 4 and 5 — solved hard it fights
     * the distance constraints and the garment goes stiff.
     */
    _distance(p, iteration) {
        const cols = p.cols, rows = p.rows;
        const pos = p.pos, restU = p.restU, restV = p.restV, restB = p.restB;
        const pinRate = p.pinRate;
        const bendK = iteration >= ITERATIONS - 3 ? 0.22 : 0;

        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < cols; i++) {
                const k = j * cols + i;

                // around the ring — wraps, so every panel is a closed tube
                solveLink(pos, k, j * cols + ((i + 1) % cols), restU[k], pinRate, 1);
                // down the panel
                if (j + 1 < rows) {
                    solveLink(pos, k, (j + 1) * cols + i, restV[k], pinRate, 1);
                }
                // bending, two rows apart
                if (bendK > 0 && j + 2 < rows) {
                    solveLink(pos, k, (j + 2) * cols + i, restB[k], pinRate, bendK);
                }
            }
        }
    }

    /** Push particles out of the body capsules and off the snow. */
    _collide(p, fig) {
        const n = p.count;
        const pos = p.pos;
        const joint = fig.joint;

        for (let c = 0; c < CAPSULES.length; c++) {
            const cap = CAPSULES[c];
            if ((p.collide & cap[3]) === 0) continue;
            const a = cap[0] * 3, b = cap[1] * 3;
            const ax = joint[a], ay = joint[a + 1], az = joint[a + 2];
            const bx = joint[b], by = joint[b + 1], bz = joint[b + 2];
            const ex = bx - ax, ey = by - ay, ez = bz - az;
            const elen2 = ex * ex + ey * ey + ez * ez || 1e-6;
            const r = cap[2];

            for (let k = 0; k < n; k++) {
                if (!isFinite(p.pinRate[k])) continue; // welded = immovable
                const o = k * 3;
                let t = ((pos[o] - ax) * ex + (pos[o + 1] - ay) * ey + (pos[o + 2] - az) * ez)
                    / elen2;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                const cx = ax + ex * t, cy = ay + ey * t, cz = az + ez * t;
                const dx = pos[o] - cx, dy = pos[o + 1] - cy, dz = pos[o + 2] - cz;
                const d = Math.hypot(dx, dy, dz);
                if (d >= r || d < 1e-6) continue;
                // Places the particle exactly ON the capsule surface. `prev` is
                // deliberately NOT updated, so the Verlet velocity absorbs the
                // correction — that implicit impulse is why cloth "sticks"
                // briefly to a limb it was pushed off.
                const push = (r - d) / d;
                pos[o] += dx * push;
                pos[o + 1] += dy * push;
                pos[o + 2] += dz * push;
            }
        }

        // The hem rides ON the snow rather than through it, with 1.2 cm of
        // clearance. Only the bottom rows check, because that is the only place
        // it can happen and `heightAt` is a filtered lookup, not free.
        //
        // Note `heightAt` reads the baked macro heightfield, NOT the deformation
        // buffer, so the hem rides the undeformed surface and does not descend
        // into a trench the player has just carved. That is correct behaviour,
        // not a bug.
        if (p.groundRows > 0) {
            const start = (p.rows - p.groundRows) * p.cols;
            for (let k = start; k < n; k++) {
                const o = k * 3;
                const g = this.terrain.heightAt(pos[o], pos[o + 2]) + 0.012;
                if (pos[o + 1] < g) pos[o + 1] = g;
            }
        }
    }
}

/**
 * One distance constraint. Mass weighting is BINARY — `isFinite(pinRate)` means
 * movable (unit mass), Infinity means infinite mass and the particle takes none
 * of the correction. There are no inverse masses. So a hem cannot drag the
 * waistband off the hips, and a free particle linked to a welded one takes the
 * FULL correction rather than half of it.
 */
function solveLink(pos, ka, kb, rest, pinRate, stiffness) {
    const a = ka * 3, b = kb * 3;
    const dx = pos[b] - pos[a];
    const dy = pos[b + 1] - pos[a + 1];
    const dz = pos[b + 2] - pos[a + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-7) return;
    const diff = ((d - rest) / d) * stiffness;

    const fa = isFinite(pinRate[ka]);
    const fb = isFinite(pinRate[kb]);
    if (fa && fb) {
        const h = diff * 0.5;
        pos[a] += dx * h; pos[a + 1] += dy * h; pos[a + 2] += dz * h;
        pos[b] -= dx * h; pos[b + 1] -= dy * h; pos[b + 2] -= dz * h;
    } else if (fa) {
        pos[a] += dx * diff; pos[a + 1] += dy * diff; pos[a + 2] += dz * diff;
    } else if (fb) {
        pos[b] -= dx * diff; pos[b + 1] -= dy * diff; pos[b + 2] -= dz * diff;
    }
}
