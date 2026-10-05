/**
 * WAKE TRIALS — surf challenges laid on real lines of the realm's own ground
 * (_spec/QUEST_DESIGN.md §3.2). "Journey: the traversal verb IS the joy —
 * reward the surf, don't just allow it."
 *
 * THE LINE IS GENERATED FROM THE TERRAIN, AND VALIDATED, OR IT IS NOT PLACED.
 *   - Trial k of a realm runs past an instance of the landmark type its STORY
 *     entry names (`STORY.trials[realm][k].landmark` — "the name lies"
 *     otherwise). Candidate starts sit 70 m out from each instance of that
 *     type on 12 bearings, aimed to pass ~30 m BESIDE the monument, on either
 *     side; a finished line whose closest approach to every instance of that
 *     type is more than PASS_MAX_M (60 m) is rejected — the downhill walk may
 *     not wander off and keep the name.
 *   - From each start a DOWNHILL-BIASED WALK lays gates GATE_SPACING m apart:
 *     at every step seven headings (0, ±12, ±24, ±36 deg off the current one)
 *     are tried, best descent (less a turn penalty) first, depth-first WITH
 *     BACKTRACKING — a dead end backs up to the next-best heading instead of
 *     ending the line (bounded: WALK_EXPANSIONS per start). Where the plain
 *     greedy walk reaches the gate count this is exactly the greedy walk; on
 *     Sand's Sunken Colonnade the greedy walk reached 8 gates from 1 of 90
 *     starts, which is why it backtracks.
 *   - EVERY consecutive gate pair is validated before it is accepted — the
 *     GRADE (a sliding 4 m window evaluated every 1 m along the segment: no
 *     uphill steeper than MAX_UP rise/run, no drop steeper than MAX_DOWN —
 *     a dune face counts, a 2 m sastrugi ridge the board rides over does
 *     not), the CLEARANCE (no
 *     landmark shaft within 6 m, no shrine within 25 m, no cache within 10 m,
 *     no other trial's gate within 30 m, nothing in the storm band), and the
 *     RING itself (the cross-slope under a 3 m ring must not rise into it).
 *   - A finished line is then run through a 1-D replay of the controller's own
 *     surf model (SURF_THRUST, the grade term, the thrust floor, the drag and
 *     the 13.65 m/s cap — controller.js, transcribed) and must be GOLD-ABLE:
 *     the ideal time must beat par by 3%. The grade term is taken at its
 *     WORSE sign (see _replayGen), so the proof holds whichever way
 *     controller.js resolves its slope sign. A line that fails any of this is
 *     never placed. Gate count is 8-12 per trial, deterministic per trial.
 *   - THE SHIPPED LINE IS RE-VALIDATED: before its replay, a candidate is
 *     re-checked exactly as it will ship — Float32-rounded gates, every pair
 *     on the same 1 m grid, every ring across the heading it is DRAWN with
 *     (`_shippedOK`). qa_worldact_node.mjs re-validates on that same grid.
 *   - Selection: each candidate start walks once (its deepest valid line of
 *     at least 8 gates is kept) in a fixed scan order, which stops once
 *     POOL_ENOUGH lines reached the trial's gate count; the pool is ranked —
 *     reached the gate count, then longer, then more descent — and the
 *     replay runs top-down until a line proves gold-able. Ties keep scan
 *     order. Pure function of the heightfield, the landmark layout, the
 *     shrine anchors and the cache spots.
 *   - Other trials: a new line keeps OTHER_TRIAL_PAD off every earlier
 *     line's whole gate polyline (symmetric), not just off its gates.
 *   - FAIL LOUDLY: a realm that cannot host one of its trials NEVER gets an
 *     unsurfable stand-in — the trial is left out, `console.error` names it
 *     and the landform, and `stats.failed` counts it (the LATEST build's
 *     count; `stats.lastBuild` holds the per-trial record). It does not THROW: the
 *     build runs inside the frame loop (it needs the realm's re-baked ground
 *     and settled landmarks), and a throw there would kill every frame after
 *     it. `_build(true)` does throw, for a caller that builds off the frame
 *     path; qa_worldact_node.mjs and qa_worldact.py assert `failed === 0`
 *     in all three realms.
 *
 * RUNNING ONE. Surf (RMB) through gate 1 and the timer starts. Each later gate
 * is passed by crossing its plane; crossing it more than MISS_M (4 m) outside
 * the ring is a miss and fails the run (QUEST §3.2), as do straying 160 m from
 * the next gate, a gate-to-gate timeout, death and a realm change. A failed
 * run restarts at gate 1. Par = path length / 11 m/s; medals at 1.35x / 1.15x
 * / 1.0x of par. The crossing instant is interpolated inside the frame, so the
 * time does not depend on the frame rate.
 *
 * REWARDS (first time each medal, QUEST §3.2): bronze 20 Wake Glass, silver 40
 * + a wake-trail colour, gold 60 + (the realm's THIRD trial) a relic. A run
 * that lands gold on the first try pays all three tiers. Every reward is a
 * 'reward' event — this module credits nothing itself. The six colours are
 * paired to the realms in STORY order (Cold: Frostlight, Aurora; Sand:
 * Brassglow, Duskveil; Ash: Emberline, Garnet) and paid by trials 1 and 2;
 * trial 3's silver carries no id, so the shop grants the next colour the
 * player does not own yet (shop.js ownTrail) — nine silvers, six colours,
 * no duplicate while any colour is left.
 *
 * DRAWING: every gate of the realm's three trials is one instance of one torus
 * lattice — ONE additive draw (shaders/worldact.glsl.js GATE). Idle, each
 * trial's start gate reads from 320 m and the rest of its line from 200 m;
 * running, only the active line shows, the next gate swollen and hot.
 *
 * HUD: a small frost-glass timer top-centre (QUEST §3.2), and near an idle
 * start gate the trial's name and "surf through the gate to begin".
 *
 * SAVE: 'quest.trials' → `{ <trialId>: { best: <s>, medal: 0|1|2|3 } }`.
 *
 * Steady-frame allocation: none (the timer text is rebuilt only when the
 * shown tenth of a second changes).
 */

import * as THREE from "three";

import { shader } from "../core/glsl.js";
import { input as coreInput } from "../core/input.js";
import { REALM_ORDER, realmToken } from "./realms.js";
import { STORY } from "../quests/storyText.js";
import { bus as coreBus } from "../quests/events.js";
import { sfx as coreSfx } from "../audio/sfx.js";
import {
    hash3, relicFor, realmTint, ensureWorldActCss, hudVisible,
} from "./caches.js";
import {
    gateVertex, gateFragment, GATE_MAX, GATE_SEG, GATE_SIDES, REF_EXPOSURE, emissionGain,
} from "../shaders/worldact.glsl.js";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const TRIALS_PER_REALM = 3;
export const MIN_GATES = 8;
export const MAX_GATES = 12;
/** Ring radius, m. */
export const GATE_R = 3.0;
/** Ring bottom clearance over the ground at its centre, m. */
const GATE_LIFT = 0.45;
/** Distance between consecutive gates, m. */
const GATE_SPACING = 40;
/** QUEST §3.2: missing a gate by more than this fails the run, m. */
export const MISS_M = 4;
/** Par speed, m/s (QUEST §3.2). */
export const PAR_SPEED = 11;
/** Medal thresholds as multiples of par: bronze, silver, gold. */
export const MEDAL_MULT = [1.35, 1.15, 1.0];

/** Walk and validation. */
const START_OUT = 70;               // start distance from the landmark, m
const START_BEARINGS = 12;
const PASS_OFFSET = 0.42;           // rad off the anchor bearing: ~30 m beside
/** A line must come this close to an instance of its named landmark type, m
 *  (closest approach of the gate polyline to the anchor). */
export const PASS_MAX_M = 60;
const TURNS = [0, 12, -12, 24, -24, 36, -36].map((d) => d * Math.PI / 180);
const TURN_PENALTY = 3.0;           // score per radian of turn
/** Grade is judged as the mean rise over a sliding GRADE_WIN_M window (a
 *  0.3 s stretch at surf speed — a dune face, not a 2 m sastrugi ridge the
 *  board rides over), evaluated every SAMPLE_M along the segment.
 *  Clearance is tested at every sample too. SAMPLE_M is 1 m — the same 1 m
 *  grid qa_worldact_node.mjs re-validates every shipped pair on: at 2 m the
 *  build passed a Sand pair whose 1 m sample in between dropped 0.87 > 0.85,
 *  i.e. a shipped line broke its own limit. */
const SAMPLE_M = 1;
/** Gate expansions one start's backtracking walk may spend. */
const WALK_EXPANSIONS = 40;
/** The start scan stops once this many full-length lines passed. */
const POOL_ENOUGH = 8;
const GRADE_WIN_M = 4;
const MAX_UP = 0.30;                // rise/run over the window, uphill
const MAX_DOWN = 0.85;              // drop/run over the window, downhill
const PLAY_R = 520;                 // stay out of the 540 m storm band
const PRISM_PAD = 6;
const SHRINE_PAD = 25;
const CACHE_PAD = 10;
const OTHER_TRIAL_PAD = 30;
/** Cross-slope limits under the ring at 0.5R and 0.8R across, m. */
const RING_SIDE = [[0.5, 0.8], [0.8, 1.6]];
/** A line must be gold-able with margin: ideal time <= par * this. */
const GOLDABLE = 0.97;

/** Per-frame CPU budget for the time-sliced line build, ms. */
const BUILD_BUDGET_MS = 3;

/** Run failure limits. */
const STRAY_M = 160;
const SEG_TIMEOUT_BASE = 8;         // s, plus segment length / 2.5 m/s

/** Controller surf model, transcribed from character/controller.js
 *  (SURF_MAX 13.65, SURF_THRUST 11.0, floor 3.0, slope term x26, drag
 *  0.42*0.02*s^2 + 0.9). Used ONLY to prove a line is gold-able. */
const SURF = { max: 13.65, thrust: 11.0, floor: 3.0, slope: 26, dragK: 0.42 * 0.02, drag0: 0.9 };

/** Idle read ranges, m. */
const START_FAR = 320;
const LINE_FAR = 200;
/** How long a result message stays up, s. */
const MSG_S = 4;

/** Display-unit emission gain of the rings (worldact.glsl.js EMISSION). */
export const GATE_GAIN = 0.3;

/** The six trail colours in STORY order (QUEST §4.3). */
const TRAILS = Object.keys(STORY.trails);

/* ------------------------------------------------------------------ *
 * The system
 * ------------------------------------------------------------------ */

export class WakeTrials {
    /**
     * @param {object} ctx meaning-layer context: terrain, landmarks, shrine,
     *   character, progression, bus, spells (globals), crystals (scene),
     *   rig, overlay, sfx, getRealm, and optionally `caches` (RelicCaches —
     *   lines keep 10 m off every cache when it is present).
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.terrain = ctx.terrain;
        this.landmarks = ctx.landmarks;
        this.character = ctx.character;
        this.bus = ctx.bus || coreBus;
        this.sfx = ctx.sfx || coreSfx;
        this.input = ctx.input || coreInput;
        this.progression = ctx.progression || null;

        this.realm = realmToken(ctx.getRealm ? ctx.getRealm() : "cold");
        /** Realm the three lines are built for (null = waiting). */
        this.readyRealm = null;
        this.showHud = true;

        /** The live realm's trials. @type {TrialLine[]} */
        this.trials = [];
        /** Lines built this session, per realm, for list(). */
        this._lines = { cold: null, sand: null, ash: null };
        /** Persisted: { id: {best, medal} }. */
        this.records = {};

        // -------------------------------------------------- run state
        this.activeIdx = -1;
        this.next = 0;
        this.time = 0;
        this._segT = 0;
        this._prevNextS = 0;
        this._prevStartS = new Float32Array(TRIALS_PER_REALM);
        this._startArmed = new Uint8Array(TRIALS_PER_REALM);
        this._passedT = new Float32Array(GATE_MAX);   // passed-flash clock per slot
        this._msg = "";
        this._msgCls = "";
        this._msgT = 0;
        this._buildWait = 0;
        /** The in-flight time-sliced build (a generator), or null. */
        this._gen = null;
        /** `failed` / `rejectedPass` / `lastBuild` describe the LATEST build
         *  (the live realm's); `built` / `failedTotal` are session totals. */
        this.stats = { built: 0, failed: 0, failedTotal: 0, runs: 0, finishes: 0, fails: 0,
            rejectedPass: 0, lastBuild: null, buildCpuMs: 0, buildFrames: 0, buildMaxSliceMs: 0 };

        // ------------------------------------------------------ gates mesh
        this._gA = new Float32Array(GATE_MAX * 4);
        this._gB = new Float32Array(GATE_MAX * 4);
        this._tint = { value: new THREE.Vector3(0.6, 1, 1.6) };
        this._hot = { value: new THREE.Vector3(2.4, 1.7, 0.6) };
        /** Emission gain in display units; the uniform is gain / S.exposure. */
        this.gain = GATE_GAIN;
        this._gain = { value: emissionGain(this.gain, ctx.S) };
        const crystals = ctx.crystals;
        const g = ctx.spells && ctx.spells.globals ? ctx.spells.globals
            : crystals.material.uniforms;
        this.material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: shader(gateVertex),
            fragmentShader: shader(gateFragment),
            uniforms: {
                uCameraPos: g.uCameraPos, uViewProj: g.uViewProj, uTime: g.uTime,
                uGateA: { value: this._gA },
                uGateB: { value: this._gB },
                uGateTint: this._tint,
                uGateHot: this._hot,
                uGateGain: this._gain,
            },
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        this.mesh = new THREE.Mesh(buildTorusPool(GATE_MAX), this.material);
        this.mesh.name = "wakeTrialGates";
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 3;
        this.mesh.visible = false;
        crystals.scene.add(this.mesh);

        // ------------------------------------------------------------ DOM
        this._el = null;
        this._shown = false;
        this._txtKey = "";
        if (typeof document !== "undefined") {
            ensureWorldActCss();
            const el = document.createElement("div");
            el.id = "wa-trial";
            el.className = "wa-glass";
            el.innerHTML = '<div class="wa-t-name"></div><div class="wa-t-time"></div>' +
                '<div class="wa-t-sub"></div>';
            document.body.appendChild(el);
            this._el = el;
            this._elName = el.querySelector(".wa-t-name");
            this._elTime = el.querySelector(".wa-t-time");
            this._elSub = el.querySelector(".wa-t-sub");
        }

        // ------------------------------------------------------------ save
        this._unregister = null;
        const P = this.progression;
        if (P && typeof P.registerSaveSection === "function") {
            this._unregister = P.registerSaveSection("quest.trials", {
                serialize: () => {
                    const out = {};
                    for (const id in this.records) {
                        const r = this.records[id];
                        out[id] = { best: r.best, medal: r.medal };
                    }
                    return out;
                },
                deserialize: (v) => {
                    this.records = {};
                    if (!v || typeof v !== "object") return;
                    for (const id in v) {
                        const r = v[id];
                        if (!r || typeof r !== "object") continue;
                        const best = +r.best;
                        const medal = Math.max(0, Math.min(3, r.medal | 0));
                        this.records[id] = {
                            best: Number.isFinite(best) && best > 0 ? best : null,
                            medal,
                        };
                    }
                },
            });
        } else {
            console.warn("trials.js: progression.registerSaveSection missing — " +
                "best times will not persist");
        }

        // Every realm — Cold included — builds at runtime, once the landmark
        // layer has settled and the caches are placed (their spots are
        // obstacles). A throw from inside the frame loop would kill every
        // frame after it, so a failed build is loud (console.error +
        // stats.failed), never fatal; qa_worldact.py asserts failed === 0 in
        // all three realms.
        this.setRealm(this.realm);
    }

    /* -------------------------------------------------------------- *
     * Public API
     * -------------------------------------------------------------- */

    /** Realm swap (enterRealm hook). @param {string} token */
    setRealm(token) {
        const t = realmToken(token);
        if (this.activeIdx >= 0) this._fail("realm");
        this.realm = t;
        this.readyRealm = null;
        this.trials = [];
        this._gen = null;               // abandon any in-flight build
        this._buildWait = 7;
        this.mesh.visible = false;
        realmTint(t, this._tint.value);
        const v = this._tint.value;
        // Ice-light in the realm's hue, bright enough to bloom.
        v.set(0.35 + v.x * 0.55, 0.45 + v.y * 0.55, 0.65 + v.z * 0.55);
    }

    /** Record for a trial id (never null). @param {string} id */
    record(id) {
        return this.records[id] || { best: null, medal: 0 };
    }

    /**
     * Live run state for any HUD: null when idle.
     * @returns {{id:string, name:string, time:number, gate:number, of:number,
     *   par:number}|null}
     */
    get status() {
        if (this.activeIdx < 0) return null;
        const tr = this.trials[this.activeIdx];
        return { id: tr.id, name: tr.name, time: this.time, gate: this.next,
            of: tr.n, par: tr.par };
    }

    /**
     * Journal / map surface. Allocates. Lines not built this session report
     * `built: false` and no position.
     * @param {string} [realm]
     */
    list(realm) {
        const t = realmToken(realm || this.realm);
        const lines = this._lines[t];
        const defs = STORY.trials[t] || [];
        const out = [];
        for (let k = 0; k < defs.length; k++) {
            const d = defs[k];
            const L = lines ? lines[k] : null;
            const r = this.record(d.id);
            out.push({
                id: d.id, name: d.name, desc: d.desc, landmark: d.landmark,
                built: !!L,
                x: L ? L.gx[0] : null, z: L ? L.gz[0] : null,
                gates: L ? L.n : 0, par: L ? L.par : null,
                passes: L ? L.passLabel : "", passD: L ? L.passD : null,
                best: r.best, medal: r.medal,
                relic: k === 2 ? (relicFor(t, "trial") || {}).id || null : null,
            });
        }
        return out;
    }

    /** Medal code for a time on a trial (0 none, 1 bronze, 2 silver, 3 gold). */
    medalFor(time, par) {
        return medalFor(time, par);
    }

    get warmUpMeshes() { return [this.mesh]; }
    get draws() { return this.mesh.visible ? 1 : 0; }

    /** One real ring at (x, z) for the warm-up draws; undo with finishWarmUp().
     *  @param {number} x @param {number} z */
    warmUpSeed(x, z) {
        const A = this._gA, B = this._gB;
        A[0] = x; A[1] = this.terrain.heightAt(x, z) + GATE_R + GATE_LIFT; A[2] = z; A[3] = 0;
        B[0] = 1; B[1] = 1; B[2] = GATE_R; B[3] = 0;
        this.mesh.visible = true;
    }

    finishWarmUp() {
        this._gB.fill(0);
        this.mesh.visible = false;
    }

    /* -------------------------------------------------------------- *
     * Frame
     * -------------------------------------------------------------- */

    /** @param {number} dt @returns {void} */
    update(dt) {
        if (dt === 0) { this._syncHud(false); return; }

        if (this.ctx.getRealm) {
            // EDGE-triggered: follow getRealm() only when IT changes. main.js
            // publishes its token after `await sky.solve()`, i.e. AFTER the
            // setRealm hooks ran -- a level test would flip back to the old realm.
            const live = this.ctx.getRealm();
            if (this._lastLive === undefined) this._lastLive = live;
            if (live !== this._lastLive) {
                this._lastLive = live;
                if (live && realmToken(live) !== this.realm) this.setRealm(live);
            }
        }
        if (this.readyRealm !== this.realm) {
            if (this._buildWait > 0) this._buildWait--;
            else if (!this._gen && this._buildable()) {
                this._gen = this._buildSteps(false);
                this.stats.buildCpuMs = 0;
                this.stats.buildFrames = 0;
                this.stats.buildMaxSliceMs = 0;
            }
            if (this._gen) this._stepBuild();
            this._syncHud(false);
            if (this.readyRealm !== this.realm) return;
        }

        const p = this.character.position;
        // THE RIDER'S CLOCK, not the frame's: controller.js integrates
        // h = min(dt, 1/30), so below 30 fps a raw-dt timer would run faster
        // than the surf and a slow machine could never make par.
        const h = Math.min(dt, 1 / 30);
        this._dt = h;
        if (this._msgT > 0) this._msgT = Math.max(0, this._msgT - dt);

        // No computed double crosses a call on the frame path (a call the
        // JIT declines to inline boxes it: 16 B/frame, measured) — the step
        // reads `this._dt`, and the plane / lateral tests below are inline.
        if (this.activeIdx < 0) this._idleStep(p);
        else this._runStep(p);

        // Display-unit emission at the live (realm-graded) exposure.
        const S = this.ctx.S;
        const gain = this.gain / (S && S.exposure > 0 ? S.exposure : REF_EXPOSURE);
        if (this._gain.value !== gain) this._gain.value = gain;

        this._writeGates(dt, p);
        this._syncHud(true);
    }

    /* -------------------------------------------------------------- *
     * Running
     * -------------------------------------------------------------- */

    /** Watch every start gate for a surf crossing. */
    _idleStep(p) {
        const surfing = this.character.surf > 0.5 || !!this.character.surfActive;
        const px = p.x, pz = p.z;
        for (let k = 0; k < this.trials.length; k++) {
            const tr = this.trials[k];
            // _planeS / _lateral of gate 0, inline (see update).
            const dx = px - tr.gx[0], dz = pz - tr.gz[0];
            const s = dx * tr.nx[0] + dz * tr.nz[0];
            const lat = Math.abs(dx * tr.nz[0] - dz * tr.nx[0]);
            const prev = this._prevStartS[k];
            // Armed only once seen on the approach side, near the ring.
            if (s < 0 && lat < GATE_R + MISS_M + 6 && s > -40) this._startArmed[k] = 1;
            else if (s < -60 || lat > 40) this._startArmed[k] = 0;
            if (this._startArmed[k] && prev < 0 && s >= 0) {
                this._startArmed[k] = 0;
                if (surfing && lat <= GATE_R + 1.0) {
                    this._start(k, s / Math.max(1e-6, s - prev));
                    break;
                } else if (lat <= GATE_R + 1.0) {
                    this._message("Surf through the gate to begin", "", 2.5);
                }
            }
            this._prevStartS[k] = s;
        }
    }

    /** @param {number} k @param {number} over fraction of the frame past the plane */
    _start(k, over) {
        const tr = this.trials[k];
        this.activeIdx = k;
        this.next = 1;
        // The clock starts AT the crossing: the part of this frame already
        // spent past the plane is on it.
        this.time = Math.max(0, Math.min(1, over)) * (this._dt || 0);
        this._segT = this.time;
        this._prevNextS = this._planeS(tr, 1, this.character.position);
        this._msgT = 0;
        this.stats.runs++;
        for (let i = 0; i < GATE_MAX; i++) this._passedT[i] = 0;
        this._passedT[tr.slot0] = 0.0001;
        this.bus.emit("trial:started", { id: tr.id, name: tr.name, gates: tr.n, par: tr.par });
        // Passing gate 1 IS the start: it is reported like every other gate,
        // so a listener sees gates 1..n, one event each.
        this.bus.emit("trial:gate", { id: tr.id, gate: 1, of: tr.n, time: this.time });
        this._chime("trial_start", tr.gx[0], tr.gy[0], tr.gz[0]);
    }

    /** One running frame (the controller step h is `this._dt`, see update). */
    _runStep(p) {
        const tr = this.trials[this.activeIdx];
        const dt = this._dt;
        this.time += dt;
        this._segT += dt;

        const c = this.character;
        if (c.health <= 0 || (this.progression && this.progression.dead)) {
            this._fail("fell");
            return;
        }
        const i = this.next;
        const s = (p.x - tr.gx[i]) * tr.nx[i] + (p.z - tr.gz[i]) * tr.nz[i];   // _planeS, inline
        const prev = this._prevNextS;
        this._prevNextS = s;
        if (prev < 0 && s >= 0) {
            const lat = this._lateral(tr, i, p);
            if (lat > GATE_R + MISS_M) { this._fail("missed"); return; }
            // Interpolated crossing instant — frame-rate independent.
            const f = s / Math.max(1e-6, s - prev);
            const tCross = this.time - dt * f;
            this._passedT[tr.slot0 + i] = 0.0001;
            this.bus.emit("trial:gate", { id: tr.id, gate: i + 1, of: tr.n, time: tCross });
            this._chime("trial_gate", tr.gx[i], tr.gy[i], tr.gz[i]);
            if (i === tr.n - 1) { this._finish(tCross); return; }
            this.next = i + 1;
            this._segT = 0;
            this._prevNextS = this._planeS(tr, this.next, p);
            return;
        }
        const dx = p.x - tr.gx[i], dz = p.z - tr.gz[i];
        if (dx * dx + dz * dz > STRAY_M * STRAY_M) { this._fail("strayed"); return; }
        if (this._segT > SEG_TIMEOUT_BASE + GATE_SPACING / 2.5) this._fail("timeout");
    }

    /** @param {number} time */
    _finish(time) {
        const tr = this.trials[this.activeIdx];
        const prev = this.record(tr.id);
        const medal = this.medalFor(time, tr.par);
        const newBest = prev.best === null || time < prev.best;
        const best = newBest ? time : prev.best;
        const firstMedal = medal > prev.medal;
        this.records[tr.id] = { best, medal: Math.max(prev.medal, medal) };
        this.activeIdx = -1;
        this.stats.finishes++;

        this.bus.emit("trial:finished", {
            id: tr.id, name: tr.name, time, medal, best, firstMedal,
            prevMedal: prev.medal, newBest, par: tr.par,
        });

        // First time each medal: pay every tier newly reached.
        let glass = 0;
        let trail = null, relic = null, silver = false;
        // tr.k is the STORY index (0..2) — the position in `this.trials`
        // differs if a sibling line failed to build; index 2 is the relic trial.
        for (let m = prev.medal + 1; m <= medal; m++) {
            if (m === 1) glass += 20;
            if (m === 2) { glass += 40; silver = true; trail = this._trailFor(tr.k); }
            if (m === 3) {
                glass += 60;
                if (tr.k === 2) relic = relicFor(this.realm, "trial");
            }
        }
        const medalName = medal > 0 ? STORY.ui.medals[medal - 1] : "";
        if (glass > 0) {
            this.bus.emit("reward", {
                kind: "glass", id: "glass", name: "Wake Glass",
                desc: medalName + " Medal — " + tr.name, amount: glass, source: "trial",
            });
        }
        if (silver) {
            const t = trail ? STORY.trails[trail] : null;
            // id null = "the next colour you do not own" (shop.js ownTrail
            // resolves it and writes the granted id back onto this payload).
            this.bus.emit("reward", {
                kind: "trail", id: trail, name: t ? t.name : "Wake Trail",
                desc: t ? t.desc : "A new wake colour", amount: 1, source: "trial",
            });
        }
        if (relic) {
            this.bus.emit("reward", {
                kind: "relic", id: relic.id, name: relic.name, desc: relic.effect,
                amount: 1, source: "trial", realm: this.realm,
            });
        }
        this._message(medal > 0 ? medalName.toUpperCase() + "  " + fmt(time)
            : "Finished  " + fmt(time), medal > 0 ? "win" : "", MSG_S, medal);
        if (this.progression && this.progression.save) this.progression.save();
    }

    /** @param {string} reason */
    _fail(reason) {
        const tr = this.trials[this.activeIdx];
        this.activeIdx = -1;
        this.stats.fails++;
        if (tr) this.bus.emit("trial:failed", { id: tr.id, reason });
        const txt = reason === "missed" ? "Missed a gate — back to the first gate"
            : reason === "timeout" ? "Too slow — back to the first gate"
            : reason === "strayed" ? "Off the line — back to the first gate"
            : "Trial abandoned";
        this._message(txt, "fail", 3);
    }

    /** Trail granted by trial k's silver (see the header): the realm's own
     *  pair of the six STORY colours for trials 0 and 1; null for trial 2 —
     *  the shop grants the next colour not yet owned. */
    _trailFor(k) {
        return trailFor(this.realm, k);
    }

    /** Signed distance past gate i's plane (positive = through). */
    _planeS(tr, i, p) {
        return (p.x - tr.gx[i]) * tr.nx[i] + (p.z - tr.gz[i]) * tr.nz[i];
    }

    /** Horizontal distance from gate i's centre, across the track. */
    _lateral(tr, i, p) {
        return Math.abs((p.x - tr.gx[i]) * tr.nz[i] - (p.z - tr.gz[i]) * tr.nx[i]);
    }

    /* -------------------------------------------------------------- *
     * Building the lines
     * -------------------------------------------------------------- */

    /** The build needs the landmark layer settled and (if present) the
     *  caches placed for this realm. */
    _buildable() {
        if (this.landmarks && this.landmarks._regroundIn > 0) return false;
        const cs = this.ctx.caches;
        if (cs && cs.readyRealm !== this.realm) return false;
        return true;
    }

    /**
     * Build the live realm's three lines synchronously — for a caller OFF the
     * frame path (a tool, a test). The game uses the time-sliced path in
     * `update()` (`_buildSteps` under BUILD_BUDGET_MS per frame).
     * @param {boolean} strict throw on failure vs log
     */
    _build(strict) {
        const t0 = typeof performance !== "undefined" ? performance.now() : 0;
        const g = this._buildSteps(strict);
        while (!g.next().done) { /* run to completion */ }
        this.stats.buildCpuMs = typeof performance !== "undefined"
            ? +(performance.now() - t0).toFixed(1) : 0;
    }

    /** One frame's slice of the in-flight build (event-scoped). */
    _stepBuild() {
        const t0 = performance.now();
        this.stats.buildFrames++;
        while (performance.now() - t0 < BUILD_BUDGET_MS) {
            if (this._gen.next().done) { this._gen = null; break; }
        }
        const ms = performance.now() - t0;
        this.stats.buildCpuMs = +(this.stats.buildCpuMs + ms).toFixed(1);
        if (ms > this.stats.buildMaxSliceMs) this.stats.buildMaxSliceMs = +ms.toFixed(2);
    }

    /**
     * The build as a generator: yields after every candidate walk and every
     * replay, so a realm's three lines cost at most BUILD_BUDGET_MS of any one
     * frame. Abandoned (the realm changed under it) = returns without writing.
     * @param {boolean} strict throw on failure vs log
     */
    *_buildSteps(strict) {
        const t = this.realm;
        const ri = REALM_ORDER.indexOf(t);
        const defs = STORY.trials[t] || [];
        const inst = (this.landmarks.instances || []).filter((s) => s.realm === t);
        const obs = this._obstacles(t, inst);
        const built = [];
        let slot = 0;
        let failed = 0;
        let rejected = 0;
        /** Per-trial build record (diagnostics; read by the probes). */
        const report = [];

        for (let k = 0; k < defs.length && k < TRIALS_PER_REALM; k++) {
            const def = defs[k];
            const want = MIN_GATES + Math.floor(hash3(k, ri, 907) * (MAX_GATES - MIN_GATES + 1));
            const cands = inst.filter((s) => s.type === def.landmark);
            cands.sort((a, b) => hash3(Math.round(a.x), ri, 500 + k)
                - hash3(Math.round(b.x), ri, 500 + k));
            const rec = { id: def.id, landmark: def.landmark, want, instances: cands.length,
                walks: 0, pool: 0, full: 0, rejectedPass: 0, rejectedRevalidate: 0, replays: 0,
                bestRatio: null, gates: 0 };
            report.push(rec);
            // ONE walk per candidate start; each keeps its deepest valid line
            // (>= MIN_GATES). The scan stops early once POOL_ENOUGH lines
            // reached the wanted gate count (scan order is fixed, so this is
            // still a pure function of the ground). Ranked: reached the
            // wanted count first, then longer, then the walk's descent score;
            // ties keep scan order (Array.prototype.sort is stable). Only
            // then is the costly surf-model replay run, top-down, until a
            // line proves gold-able.
            const pool = [];
            scan:
            for (let c = 0; c < cands.length; c++) {
                const li = cands[c];
                for (let b = 0; b < START_BEARINGS; b++) {
                    const a = (b / START_BEARINGS) * Math.PI * 2 + hash3(k, ri, 77) * 0.5;
                    const sx = li.x + Math.sin(a) * START_OUT;
                    const sz = li.z - Math.cos(a) * START_OUT;
                    // Heading from the start TOWARD the anchor, port frame.
                    const toA = Math.atan2(li.x - sx, -(li.z - sz));
                    for (let side = -1; side <= 1; side += 2) {
                        const line = yield* this._walkGen(sx, sz, toA + side * PASS_OFFSET,
                            want, obs, built);
                        rec.walks++;
                        if (line) {
                            // It must actually ride PAST the monument it is named for.
                            const pass = passOf(line.gx, line.gz, cands);
                            if (pass.d <= PASS_MAX_M) {
                                line.passD = pass.d;
                                line.passLabel = pass.label;
                                pool.push(line);
                                if (line.n === want && ++rec.full >= POOL_ENOUGH) break scan;
                            } else {
                                rec.rejectedPass++;
                                rejected++;
                            }
                        }
                        yield;
                    }
                }
            }
            rec.pool = pool.length;
            pool.sort((p, q) => ((q.n === want) - (p.n === want)) || (q.n - p.n)
                || (q.score - p.score));
            let best = null;
            for (let i = 0; i < pool.length && !best; i++) {
                const L = pool[i];
                // THE SHIPPED LINE IS THE ONE VALIDATED: gates are stored as
                // Float32 (`_finalize`), so the pairs and rings are re-checked
                // on the Float32-rounded positions and the headings the ring
                // is DRAWN with. A line that fails is skipped, never placed.
                if (!this._shippedOK(L, obs, built)) { rec.rejectedRevalidate++; continue; }
                L.ideal = yield* this._replayGen(L.gx, L.gz);
                rec.replays++;
                const ratio = L.ideal / L.par;
                if (rec.bestRatio === null || ratio < rec.bestRatio) rec.bestRatio = +ratio.toFixed(4);
                if (L.ideal <= L.par * GOLDABLE) best = L;
                yield;
            }
            if (this.realm !== t) return;       // swapped away mid-build
            if (!best) {
                failed++;
                const msg = "trials.js: " + t + " trial " + def.id + " (" + def.landmark +
                    ") — no valid, gold-able surf line of " + MIN_GATES + "+ gates on this landform " +
                    JSON.stringify(rec);
                if (strict) throw new Error(msg);
                console.error(msg);
                continue;
            }
            this._finalize(best, def, k, slot);
            rec.gates = best.n;
            slot += best.n;
            built.push(best);
        }

        if (this.realm !== t) return;
        this.trials = built;
        this._lines[t] = defs.map((d) => built.find((b) => b.id === d.id) || null);
        this.readyRealm = t;
        this.stats.built += built.length;
        // Per-BUILD counts (the live realm's): a probe reading them after a
        // realm swap must not see the previous realm's failures.
        this.stats.failed = failed;
        this.stats.rejectedPass = rejected;
        this.stats.failedTotal += failed;
        this.stats.lastBuild = report;
        for (let k = 0; k < TRIALS_PER_REALM; k++) {
            this._prevStartS[k] = 0;
            this._startArmed[k] = 0;
        }
        this.mesh.visible = built.length > 0;
    }

    /**
     * Static obstacles for the realm, as circles (x, z, r): every landmark
     * shaft (base + a point 3 m up its lean), grouped per landmark behind a
     * bounding circle so a sample far from every monument costs 15 tests;
     * then the shrine anchors and the cache spots. Allocates (build-time).
     */
    _obstacles(t, inst) {
        const groups = [];           // {bx, bz, br, c: Float32Array}
        const lm = this.landmarks;
        const d = lm && lm._texData;
        if (d) {
            const w = lm.prismCount * 4;
            for (let n = 0; n < inst.length; n++) {
                const li = inst[n];
                const c = [];
                let br = 0;
                for (let p = li.prism0; p < li.prism0 + li.prisms; p++) {
                    const o = p * 4;
                    const ay = Math.max(d[w + o + 1], 0.15);
                    const up = Math.min(d[o + 3], 3 / ay);
                    const r = d[w + o + 3] + PRISM_PAD;
                    const x1 = d[o], z1 = d[o + 2];
                    const x2 = x1 + d[w + o] * up, z2 = z1 + d[w + o + 2] * up;
                    c.push(x1, z1, r, x2, z2, r);
                    br = Math.max(br, Math.hypot(x1 - li.x, z1 - li.z) + r,
                        Math.hypot(x2 - li.x, z2 - li.z) + r);
                }
                groups.push({ bx: li.x, bz: li.z, br, c: new Float32Array(c) });
            }
        }
        const misc = [];
        const sh = this.ctx.shrine && this.ctx.shrine.positions ? this.ctx.shrine.positions : [];
        for (let i = 0; i < sh.length; i++) misc.push(sh[i].x, sh[i].z, SHRINE_PAD);
        const cs = this.ctx.caches;
        if (cs && cs.readyRealm === t) {
            for (let s = 0; s < cs.x.length; s++) misc.push(cs.x[s], cs.z[s], CACHE_PAD);
        }
        return { groups, misc: new Float32Array(misc) };
    }

    /**
     * The downhill-biased walk from one start, up to `target` gates: a
     * BEST-FIRST DEPTH-FIRST SEARCH over the seven headings. At every gate
     * the valid headings are ordered by descent less a turn penalty and the
     * best is taken first — so where the plain greedy walk reaches `target`,
     * this IS the greedy walk — but a dead end backs up and tries the
     * next-best heading instead of stopping. Bounded by WALK_EXPANSIONS gate
     * expansions per start. Returns the deepest valid line found (the first
     * found at that depth) if it has at least MIN_GATES gates, else null.
     * Not yet proven gold-able — `_buildSteps` runs the replay on the
     * ranked pool.
     * @returns {TrialLine|null}
     */
    *_walkGen(sx, sz, h0, target, obs, built) {
        const T = this.terrain;
        if (!this._pointOK(sx, sz, obs, built)) return null;
        if (!this._ringOK(sx, sz, h0)) return null;
        const gx = [sx], gz = [sz], hd = [h0], sc = [0];
        const own = { gx, gz };
        let best = null;            // { gx, gz, hd, score } deepest so far
        let bestN = 0;
        let budget = WALK_EXPANSIONS;
        // stack[d] = the untried options for gate d+1, best first.
        const stack = [this._options(sx, sz, h0, obs, built, own)];
        budget--;
        for (;;) {
            if (gx.length > bestN) {
                bestN = gx.length;
                let s = 0;
                for (let i = 1; i < sc.length; i++) s += sc[i];
                best = { gx: gx.slice(), gz: gz.slice(), hd: hd.slice(), score: s };
                if (bestN >= target) break;
            }
            const top = stack[stack.length - 1];
            if (top.length === 0) {
                // Dead end: back up one gate (never past the start).
                stack.pop();
                if (stack.length === 0) break;
                gx.pop(); gz.pop(); hd.pop(); sc.pop();
                continue;
            }
            if (budget <= 0) break;
            const o = top.shift();
            gx.push(o.qx); gz.push(o.qz); hd.push(o.hh); sc.push(o.sc);
            stack.push(gx.length < target ? this._options(o.qx, o.qz, o.hh, obs, built, own) : []);
            budget--;
            yield;                          // one gate expansion per slice step
        }
        if (!best || bestN < MIN_GATES) return null;
        const n = bestN;
        let len = 0;
        for (let i = 0; i + 1 < n; i++) {
            len += Math.hypot(best.gx[i + 1] - best.gx[i], best.gz[i + 1] - best.gz[i]);
        }
        void T;
        return { gx: best.gx, gz: best.gz, hd: best.hd, n, len, par: len / PAR_SPEED,
            ideal: Infinity, score: best.score };
    }

    /**
     * The valid next gates from (px, pz) heading h, best first (descent less
     * the turn penalty; ties keep TURNS order). Build-time; allocates.
     * @returns {{qx:number, qz:number, hh:number, sc:number}[]}
     */
    _options(px, pz, h, obs, built, own) {
        const T = this.terrain;
        const out = [];
        for (let j = 0; j < TURNS.length; j++) {
            const hh = h + TURNS[j];
            const qx = px + Math.sin(hh) * GATE_SPACING;
            const qz = pz - Math.cos(hh) * GATE_SPACING;
            if (!this._segmentOK(px, pz, qx, qz, obs, built, own)) continue;
            if (!this._ringOK(qx, qz, hh)) continue;
            const s = (T.heightAt(px, pz) - T.heightAt(qx, qz)) - Math.abs(TURNS[j]) * TURN_PENALTY;
            out.push({ qx, qz, hh, sc: s });
        }
        out.sort((a, b) => b.sc - a.sc);    // stable: ties keep TURNS order
        return out;
    }

    /** Point-level clearance (no segment grade). */
    _pointOK(x, z, obs, built) {
        if (Math.hypot(x, z) > PLAY_R) return false;
        const T = this.terrain;
        if (T.edge01 && T.edge01(x, z) > 0) return false;
        const G = obs.groups;
        for (let g = 0; g < G.length; g++) {
            const gr = G[g];
            const bx = x - gr.bx, bz = z - gr.bz;
            if (bx * bx + bz * bz > gr.br * gr.br) continue;
            const c = gr.c;
            for (let i = 0; i < c.length; i += 3) {
                const dx = x - c[i], dz = z - c[i + 1];
                if (dx * dx + dz * dz < c[i + 2] * c[i + 2]) return false;
            }
        }
        const m = obs.misc;
        for (let i = 0; i < m.length; i += 3) {
            const dx = x - m[i], dz = z - m[i + 1];
            if (dx * dx + dz * dz < m[i + 2] * m[i + 2]) return false;
        }
        // Another trial's LINE (its whole gate polyline, not just its gates):
        // symmetric — a new gate 30 m off an old line's segment also keeps
        // every point of that segment 30 m off the new gate.
        const P2 = OTHER_TRIAL_PAD * OTHER_TRIAL_PAD;
        for (let t = 0; t < built.length; t++) {
            const L = built[t];
            for (let i = 0; i < L.n; i++) {
                const ax = L.gx[i], az = L.gz[i];
                let dx = x - ax, dz = z - az;
                if (i + 1 < L.n) {
                    const sx = L.gx[i + 1] - ax, sz = L.gz[i + 1] - az;
                    const l2 = sx * sx + sz * sz;
                    let f = l2 > 0 ? (dx * sx + dz * sz) / l2 : 0;
                    f = f < 0 ? 0 : (f > 1 ? 1 : f);
                    dx -= sx * f; dz -= sz * f;
                }
                if (dx * dx + dz * dz < P2) return false;
            }
        }
        return true;
    }

    /**
     * Validate one gate-to-gate segment: grade every SAMPLE_M, clearance at
     * every sample, and (while walking) no doubling back onto the line's own
     * earlier gates.
     * @param {{gx:number[], gz:number[]}|null} own the line so far, or null
     */
    _segmentOK(ax, az, bx, bz, obs, built, own) {
        const T = this.terrain;
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const steps = Math.max(2, Math.ceil(len / SAMPLE_M));
        for (let s = 1; s <= steps; s++) {
            const f = s / steps;
            const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
            // The window reaches back GRADE_WIN_M along the travel line (into
            // the previous segment near the start — the rider is there too).
            const g = (T.heightAt(x, z)
                - T.heightAt(x - ux * GRADE_WIN_M, z - uz * GRADE_WIN_M)) / GRADE_WIN_M;
            if (g > MAX_UP || g < -MAX_DOWN) return false;
            if (!this._pointOK(x, z, obs, built)) return false;
        }
        if (own) {
            // No loops and no crossings: the new gate keeps 0.9 of a spacing
            // from every earlier gate but the one it leaves from.
            const lim = GATE_SPACING * 0.9;
            for (let i = 0; i + 1 < own.gx.length; i++) {
                const dx = bx - own.gx[i], dz = bz - own.gz[i];
                if (dx * dx + dz * dz < lim * lim) return false;
            }
        }
        return true;
    }

    /**
     * The line AS IT WILL SHIP: Float32-rounded gates (what `_finalize`
     * stores and every consumer reads), every consecutive pair re-validated
     * with the walk's own `_segmentOK`, every ring re-checked across the
     * heading it is DRAWN with (`_finalize`'s central difference, not the
     * walk's arriving heading). Build-time; allocates.
     * @param {{gx:number[], gz:number[], n:number}} L
     * @returns {boolean}
     */
    _shippedOK(L, obs, built) {
        const n = L.n;
        const fx = Float32Array.from(L.gx), fz = Float32Array.from(L.gz);
        if (!this._pointOK(fx[0], fz[0], obs, built)) return false;
        for (let i = 0; i + 1 < n; i++) {
            if (!this._segmentOK(fx[i], fz[i], fx[i + 1], fz[i + 1], obs, built, null)) return false;
        }
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
            const hd = Math.fround(Math.atan2(fx[b] - fx[a], -(fz[b] - fz[a])));   // = L.heading[i]
            if (!this._ringOK(fx[i], fz[i], hd)) return false;
        }
        return true;
    }

    /** The ring must stand clear of the cross-slope under it. */
    _ringOK(x, z, h) {
        const T = this.terrain;
        const g0 = T.heightAt(x, z);
        const tx = Math.cos(h), tz = Math.sin(h);   // across-track, port frame
        for (let i = 0; i < RING_SIDE.length; i++) {
            const u = RING_SIDE[i][0] * GATE_R, lim = RING_SIDE[i][1];
            if (T.heightAt(x + tx * u, z + tz * u) - g0 > lim) return false;
            if (T.heightAt(x - tx * u, z - tz * u) - g0 > lim) return false;
        }
        return true;
    }

    /**
     * 1-D replay of the controller's surf model along the line, from a
     * running start at 9 m/s through gate 1, turning losses ignored — the
     * IDEAL time a perfect rider could post. Used to prove gold is possible.
     */
    *_replayGen(gx, gz) {
        const T = this.terrain;
        let v = 9, t = 0;
        const dt = 1 / 30;
        for (let i = 0; i + 1 < gx.length; i++) {
            const len = Math.hypot(gx[i + 1] - gx[i], gz[i + 1] - gz[i]);
            const ux = (gx[i + 1] - gx[i]) / len, uz = (gz[i + 1] - gz[i]) / len;
            let d = 0;
            let guard = 0;
            while (d < len && guard++ < 4000) {
                const x = gx[i] + ux * d, z = gz[i] + uz * d;
                const e = 1;
                const hx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
                const hz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
                // normal (-hx, 1, -hz)/|..|; slopeAssist = -(n . f) * 26
                const nl = Math.hypot(hx, 1, hz);
                const assist = -((-hx) * ux + (-hz) * uz) / nl * SURF.slope;
                // PESSIMISTIC in the slope's SIGN: measured 2026-09-30 (lane W
                // report), controller.js's term currently ACCELERATES uphill
                // and brakes downhill, against its own comment. Taking the
                // worse of the two conventions proves the line gold-able under
                // the shipped controller AND under a future sign fix.
                let thrust = SURF.thrust - Math.abs(assist);
                if (thrust < SURF.floor) thrust = SURF.floor;
                v += thrust * dt;
                v -= (SURF.dragK * v * v + SURF.drag0) * dt;
                if (v > SURF.max) v = SURF.max;
                if (v < 0) v = 0;
                d += v * dt;
                t += dt;
            }
            yield;                          // one segment per slice step
        }
        return t;
    }

    /** Freeze a line into its runtime form: heights, normals, slots. */
    _finalize(L, def, k, slot0) {
        const T = this.terrain;
        const n = L.n;
        L.id = def.id;
        L.name = def.name;
        L.k = k;
        L.slot0 = slot0;
        // Round FIRST: normals, headings and heights derive from the stored
        // Float32 gates — the exact values `_shippedOK` validated.
        L.gx = Float32Array.from(L.gx);
        L.gz = Float32Array.from(L.gz);
        L.gy = new Float32Array(n);
        L.nx = new Float32Array(n);
        L.nz = new Float32Array(n);
        L.heading = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
            let dx = L.gx[b] - L.gx[a], dz = L.gz[b] - L.gz[a];
            L.heading[i] = Math.atan2(dx, -dz);
            const l = Math.hypot(dx, dz) || 1;
            dx /= l; dz /= l;
            L.nx[i] = dx; L.nz[i] = dz;
            L.gy[i] = T.heightAt(L.gx[i], L.gz[i]) + GATE_R + GATE_LIFT;
        }
    }

    /* -------------------------------------------------------------- *
     * Presentation
     * -------------------------------------------------------------- */

    /** Per-frame gate uniforms: 36 slots, no allocation. */
    _writeGates(dt, p) {
        const A = this._gA, B = this._gB;
        for (let i = 0; i < GATE_MAX; i++) B[i * 4] = 0;
        const running = this.activeIdx;
        let any = false;
        for (let k = 0; k < this.trials.length; k++) {
            const tr = this.trials[k];
            if (running >= 0 && running !== k) continue;
            for (let i = 0; i < tr.n; i++) {
                const slot = tr.slot0 + i;
                const o = slot * 4;
                A[o] = tr.gx[i]; A[o + 1] = tr.gy[i]; A[o + 2] = tr.gz[i];
                A[o + 3] = tr.heading[i];
                const dx = p.x - tr.gx[i], dz = p.z - tr.gz[i];
                const d = Math.sqrt(dx * dx + dz * dz);
                let I = 0, hot = 0, passed = 0;
                if (running < 0) {
                    const far = i === 0 ? START_FAR : LINE_FAR;
                    // 1 - smooth(far * 0.8, far, d), inline (see update)
                    let u = (d - far * 0.8) / (far * 0.2);
                    u = u < 0 ? 0 : (u > 1 ? 1 : u);
                    I = (i === 0 ? 1.1 : 0.32) * (1 - u * u * (3 - 2 * u));
                    hot = i === 0 ? 0.55 : 0;
                } else if (i < this.next) {
                    // Passed: a white flash that dies over 0.5 s.
                    let pt = this._passedT[slot];
                    if (pt > 0) {
                        pt = Math.min(1, pt + dt / 0.5);
                        this._passedT[slot] = pt;
                        I = 1.4 * (1 - pt);
                        passed = pt;
                    }
                } else if (i === this.next) {
                    I = 1.5; hot = 1;
                } else if (i <= this.next + 2) {
                    I = 0.75;
                } else {
                    let u = (d - LINE_FAR * 0.8) / (LINE_FAR * 0.2);
                    u = u < 0 ? 0 : (u > 1 ? 1 : u);
                    I = 0.4 * (1 - u * u * (3 - 2 * u));
                }
                B[o] = I; B[o + 1] = hot; B[o + 2] = GATE_R; B[o + 3] = passed;
                if (I > 0.001) any = true;
            }
        }
        this.mesh.visible = any;
    }

    /** @param {string} text @param {string} cls @param {number} s @param {number} [medal] */
    _message(text, cls, s, medal) {
        this._msg = text;
        this._msgCls = cls;
        this._msgT = s;
        this._msgMedal = medal || 0;
        this._txtKey = "";
    }

    /** Timer / hint DOM, written only when the shown text changes. */
    _syncHud(live) {
        const el = this._el;
        if (!el) return;
        let mode = 0;       // 0 hidden, 1 running, 2 message, 3 near-start hint
        let hintK = -1;
        if (live && this.showHud) {
            if (this.activeIdx >= 0) mode = 1;
            else if (this._msgT > 0) mode = 2;
            else {
                const p = this.character.position;
                for (let k = 0; k < this.trials.length; k++) {
                    const tr = this.trials[k];
                    const dx = p.x - tr.gx[0], dz = p.z - tr.gz[0];
                    if (dx * dx + dz * dz < 30 * 30) { mode = 3; hintK = k; break; }
                }
            }
        }
        const show = mode > 0 && hudVisible(this.input, this.ctx.overlay);
        // Key: mode + the shown tenth — the only thing that changes the text.
        let key = "";
        if (mode === 1) key = "1|" + this.activeIdx + "|" + Math.floor(this.time * 10) + "|" + this.next;
        else if (mode === 2) key = "2|" + this._msg;
        else if (mode === 3) key = "3|" + hintK;
        if (key !== this._txtKey && mode > 0) {
            this._txtKey = key;
            if (mode === 1) {
                const tr = this.trials[this.activeIdx];
                this._elName.textContent = tr.name;
                this._elTime.textContent = fmt(this.time);
                this._elSub.innerHTML = "Gate " + (this.next + 1) + " / " + tr.n +
                    ' &nbsp;·&nbsp; <span class="wa-m3">Gold ' + fmt(tr.par * MEDAL_MULT[2]) +
                    '</span> &nbsp;<span class="wa-m2">Silver ' + fmt(tr.par * MEDAL_MULT[1]) +
                    '</span> &nbsp;<span class="wa-m1">Bronze ' + fmt(tr.par * MEDAL_MULT[0]) + "</span>";
                el.classList.remove("fail", "win");
            } else if (mode === 2) {
                const tr = this.trials[Math.max(0, Math.min(this.trials.length - 1, this.activeIdx))];
                this._elName.textContent = "Wake Trial";
                this._elTime.textContent = this._msg;
                this._elSub.textContent = "";
                void tr;
                el.classList.toggle("fail", this._msgCls === "fail");
                el.classList.toggle("win", this._msgCls === "win");
            } else {
                const tr = this.trials[hintK];
                const r = this.record(tr.id);
                this._elName.textContent = "Wake Trial";
                this._elTime.textContent = tr.name;
                this._elSub.innerHTML = "Surf through the gate to begin" +
                    (r.best ? " &nbsp;·&nbsp; Best " + fmt(r.best) +
                        (r.medal ? ' <span class="wa-m' + r.medal + '">' +
                            STORY.ui.medals[r.medal - 1] + "</span>" : "") : "");
                el.classList.remove("fail", "win");
            }
        }
        if (show !== this._shown) {
            this._shown = show;
            el.classList.toggle("show", show);
        }
    }

    _chime(name, x, y, z) {
        const sfx = this.sfx;
        if (!sfx || !sfx.trigger) return;
        const has = sfx.counts && Object.prototype.hasOwnProperty.call(sfx.counts, name);
        sfx.trigger(has ? name : "pickup_mote", x, y, z);
    }

    dispose() {
        if (this._unregister) this._unregister();
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.material.dispose();
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    }
}

/**
 * @typedef {{id:string, name:string, k:number, n:number, slot0:number,
 *   gx:Float32Array, gy:Float32Array, gz:Float32Array, nx:Float32Array,
 *   nz:Float32Array, heading:Float32Array, len:number, par:number,
 *   ideal:number, score:number}} TrialLine
 */

/**
 * The wake-trail colour trial k of a realm pays at silver: the realm's pair of
 * the six STORY colours (STORY order) for k = 0, 1; null for k = 2 ("the next
 * colour not yet owned", resolved by the shop).
 * @param {string} realm @param {number} k @returns {string|null}
 */
export function trailFor(realm, k) {
    if (k < 0 || k > 1) return null;
    const ri = REALM_ORDER.indexOf(realmToken(realm));
    return TRAILS[ri * 2 + k] || null;
}

/**
 * The medal a time earns on a par (0 none, 1 bronze, 2 silver, 3 gold) —
 * QUEST §3.2: at or under 1.35x / 1.15x / 1.0x of par.
 * @param {number} time @param {number} par @returns {number}
 */
export function medalFor(time, par) {
    if (time <= par * MEDAL_MULT[2] + 1e-9) return 3;
    if (time <= par * MEDAL_MULT[1] + 1e-9) return 2;
    if (time <= par * MEDAL_MULT[0] + 1e-9) return 1;
    return 0;
}

/**
 * Closest approach of a gate polyline to any of a set of landmark anchors.
 * @param {ArrayLike<number>} gx @param {ArrayLike<number>} gz
 * @param {{x:number, z:number, label:string}[]} lms
 * @returns {{d:number, label:string}}
 */
export function passOf(gx, gz, lms) {
    let best = Infinity, label = "";
    for (let m = 0; m < lms.length; m++) {
        const px = lms[m].x, pz = lms[m].z;
        for (let i = 0; i + 1 < gx.length; i++) {
            const ax = gx[i], az = gz[i];
            const dx = gx[i + 1] - ax, dz = gz[i + 1] - az;
            const l2 = dx * dx + dz * dz;
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
            const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
            if (d < best) { best = d; label = lms[m].label; }
        }
    }
    return { d: best, label };
}

/** Seconds -> "12.4". */
function fmt(s) {
    return (Math.round(s * 10) / 10).toFixed(1);
}

/**
 * A pool of n torus rings, position = (theta01, phi01, ring index).
 * @param {number} n @returns {THREE.BufferGeometry}
 */
function buildTorusPool(n) {
    const S = GATE_SEG, D = GATE_SIDES;
    const vPer = (S + 1) * (D + 1);
    const pos = new Float32Array(n * vPer * 3);
    const idx = new Uint32Array(n * S * D * 6);
    let vi = 0, ii = 0;
    for (let r = 0; r < n; r++) {
        const base = r * vPer;
        for (let a = 0; a <= S; a++) {
            for (let b = 0; b <= D; b++) {
                pos[vi++] = a / S; pos[vi++] = b / D; pos[vi++] = r;
            }
        }
        for (let a = 0; a < S; a++) {
            for (let b = 0; b < D; b++) {
                const i0 = base + a * (D + 1) + b;
                const i1 = i0 + D + 1;
                idx[ii++] = i0; idx[ii++] = i1; idx[ii++] = i0 + 1;
                idx[ii++] = i1; idx[ii++] = i1 + 1; idx[ii++] = i0 + 1;
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geo;
}
