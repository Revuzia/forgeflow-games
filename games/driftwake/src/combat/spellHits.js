/**
 * The damage pass — every spell's hit volume resolved against the Damageable
 * registry (COMBAT_DESIGN §9.3, mapped onto the shipping spell objects).
 *
 * Runs AFTER `spells.update()` and AFTER `registry.update(dt)` in the frame
 * (main.js order: spells -> registry.update -> spellHits.update -> consumers
 * -> registry.endFrame). It never patches the spells: each spell's live state
 * (sweep's travelling crescent, bloom's burst flag, crystallize's plant
 * counter, vortex's ring, ribbon's thrown head) is READ here and turned into
 * registry queries + `damage()` calls. All tests gate on the spell's own
 * `active` / `_burst` state, never on input or cast attempt (§9.2) — a spell
 * cancelled by `S.showSpells = false` takes its volumes with it.
 *
 * One-hit-per-cast latches, per-enemy DoT accumulators and every query
 * callback are PREALLOCATED in the constructor; steady frames allocate
 * nothing. `dt === 0` (freeze) is a strict no-op (§9.2).
 *
 * Numbers come from `combatData.js` (the COMBAT_DESIGN §1.1 tables); tier
 * scaling of CC (knockback fractions, stun multipliers, liftability) lives in
 * the registry's §5.2 matrix and is NOT duplicated here.
 *
 * Two §5.2/§5.1 readings are resolved here, flagged for the tuning pass:
 *   - Vortex poise "8/tick" is applied as 8 poise PER SECOND of contact: at
 *     the 45 Hz tick mirror, a literal 8-per-tick would be 360 poise/s and
 *     break §5.1's own break-cadence arithmetic (its rotation sum excludes
 *     vortex entirely).
 *   - §5.2 lists Light/Med as fully liftable but the registry's LIFTABLE
 *     table (the canonical §5.2 implementation, per damageable.js) lifts
 *     fodder/light only. The registry wins: medium takes the heavy-row 50%
 *     slow instead.
 */

import { clamp01, smooth01, bell, rand } from "../spells/bending.js";
import { BOLT_MAX } from "../spells/dart.js";
import { TIER } from "./damageable.js";
import { combatData } from "./combatData.js";

export class SpellHits {
    /**
     * @param {import("../spells/spellSystem.js").SpellSystem} spells
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {typeof combatData} [data] override for tests; defaults to combatData
     */
    constructor(spells, registry, controller, data) {
        this.spells = spells;
        this.registry = registry;
        this.controller = controller;
        this.data = data || combatData;

        /**
         * Progression hook (PROGRESSION_DESIGN §4): the L10 anchor is 1.0;
         * the XP layer sets this to the player's compounded damage multiplier.
         * Applied to every damage amount, never to poise or CC.
         */
        this.damageMult = 1;

        const cap = registry.x.length;

        // ---- one-hit-per-cast latches (registry ids, linear-scanned) -------
        this._waveIds = new Int32Array(cap);
        this._waveN = 0;
        this._spikeIds = new Int32Array(cap);
        this._spikeN = 0;
        /** Ids currently held aloft by the Great Vortex. */
        this._liftIds = new Int32Array(cap);
        this._liftN = 0;

        // ---- per-enemy DoT accumulators (slot-keyed, id-checked) -----------
        // Slots remap on swap-remove, so each accumulator remembers which id
        // it belongs to and resets on mismatch — allocation-free and safe.
        this._vOwedId = new Int32Array(cap).fill(-1);
        this._vOwed = new Float32Array(cap);
        this._cOwedId = new Int32Array(cap).fill(-1);
        this._cOwed = new Float32Array(cap);

        // ---- cast-edge tracking --------------------------------------------
        this._sweepT = Infinity;
        this._sweepActive = false;
        this._bloomT = Infinity;
        this._bloomActive = false;
        this._bloomBurstDone = false;
        this._crysT = Infinity;
        this._crysActive = false;
        this._crysSeen = 0;
        this._vorT = Infinity;
        this._vorActive = false;
        this._vorHolding = false;

        // ---- bolt pool state, one entry per slot ----------------------------
        // Parallel to `spells.bolt`'s SoA. Everything the old single-throw
        // implementation kept as one scalar is now per PROJECTILE: with up to
        // twelve in the air at once, a shared latch would let one bolt's hit
        // silence the other eleven.
        /** The `gen` counter this entry was captured against. `dart.fire()`
         *  bumps `gen[i]` on every shot, so a mismatch is how "a new
         *  projectile in a recycled slot" is told from "the same projectile,
         *  next frame" — which is what makes the anti-kite capture
         *  per-projectile rather than per-slot. */
        this._bGen = new Int32Array(BOLT_MAX).fill(-1);
        /** Captured AT SPAWN (§1.1 moved in timing, not in substance): was the
         *  player above the 12 m/s gate within the last 0.4 s when this bolt
         *  left the hand. There is no release frame to read it on any more. */
        this._bMoving = new Uint8Array(BOLT_MAX);
        /** One direct hit per projectile. */
        this._bSpent = new Uint8Array(BOLT_MAX);
        /** One splash per projectile. */
        this._bSplashed = new Uint8Array(BOLT_MAX);
        /** Who took the direct hit — excluded from that bolt's own splash. */
        this._bHitId = new Int32Array(BOLT_MAX).fill(-1);
        /** Scratch: the id the splash callback must skip, for the bolt whose
         *  `forEachInSphere` is running right now. */
        this._boltHitId = -1;
        /** Registry-time until which the falloff applies (§1.1: gate + 0.4 s). */
        this._fastUntil = -1;

        // ---- whip tick timer -----------------------------------------------
        this._whipOwed = 0;

        // ---- prebound query callbacks (never rebuilt per frame) ------------
        // Parameters ride in the _q* scratch fields set just before the call.
        this._qEnv = 0;
        this._qKx = 0; this._qKz = 0;
        this._qDx = 0; this._qDz = 1;
        this._qWx = 0; this._qWz = 0;
        this._qArc = 0;
        /** @type {(slot:number, id:number, d:number)=>void} */
        this._waveCb = (slot, id, d) => this._waveHit(slot, id);
        /** @type {(slot:number, id:number, d:number)=>void} */
        this._waveBirthCb = (slot, id, d) => this._waveBirthHit(slot, id);
        this._waveBirth = false;
        this._qPx = 0; this._qPz = 0;
        /** @type {(slot:number, id:number, d2:number)=>void} */
        this._burstCb = (slot, id, d2) => this._bloomBurstHit(slot, id, d2);
        /** @type {(slot:number, id:number, d2:number)=>void} */
        this._splashCb = (slot, id, d2) => this._boltSplashHit(id);

        // ---- frost arc (cold LMB) ------------------------------------------
        /** Last `spells.arcGen` consumed — the cast-edge latch. */
        this._arcGenSeen = 0;
        /** @type {(slot:number, id:number, d:number)=>void} */
        this._arcCb = (slot, id, d) => this._arcHit(slot, id);
    }

    /** @param {number} dt */
    update(dt) {
        if (dt === 0) return;              // §9.2: freeze is a strict no-op

        // The speed-falloff clock runs continuously so the release read is
        // "was the player above 12 m/s within the last 0.4 s", exactly §1.1.
        const D = this.data;
        if (this.controller.speed > D.bolt.speedGate) {
            this._fastUntil = this.registry.time + D.bolt.regrace;
        }

        this._bolt();
        this._frostArc();
        this._whip(dt);
        this._wave();
        this._bloom(dt);
        this._spikes();
        this._vortex(dt);
    }

    // =====================================================================
    // LMB — the primary bolt pool (engine key 6) + splash
    // =====================================================================

    /**
     * Every live projectile in `spells.bolt`, resolved against the registry.
     *
     * ONE SWEPT SEGMENT PER SLOT PER FRAME, and that is the §9.3
     * anti-tunnelling rule, kept verbatim from the single-throw version it
     * replaces: `segmentHit` is a true segment-vs-capsule test, and at 21 m/s
     * and 13 fps a bolt moves ~1.6 m per frame, so a point test at the head
     * would step straight over a body. `dart.js` seeds `px/py/pz` to the
     * muzzle on spawn, so a bolt's first test is a point test at the hand
     * rather than a sweep from the origin.
     *
     * ONLY OWN-ID-0 BOLTS DAMAGE. A carrier head (`own === 1` — the Ash
     * fireball's travel phase) draws and trails but never hits: its payload is
     * the crescent it detonates into, and the crescent runs its own §1.1 test.
     * Damaging both would double-charge the Ash player for one cast.
     */
    _bolt() {
        const pool = this.spells.bolt;
        if (!pool) return;
        const reg = this.registry;
        const D = this.data.bolt;

        for (let i = 0; i < BOLT_MAX; i++) {
            const alive = pool.alive[i];
            const impact = pool.impact[i];
            if (!alive && !impact) continue;

            // New projectile in this slot? Capture the anti-kite state now,
            // once, for this shot only.
            if (pool.gen[i] !== this._bGen[i]) {
                this._bGen[i] = pool.gen[i];
                this._bMoving[i] = reg.time < this._fastUntil ? 1 : 0;
                this._bSpent[i] = 0;
                this._bSplashed[i] = 0;
                this._bHitId[i] = -1;
            }

            if (pool.own[i] === 1) continue;     // carrier: draws, never hits

            if (alive && !this._bSpent[i]) {
                const id = reg.segmentHit(
                    pool.px[i], pool.py[i], pool.pz[i],
                    pool.x[i], pool.y[i], pool.z[i],
                    D.padRadius
                );
                if (id >= 0) {
                    const moving = this._bMoving[i] === 1;
                    const base = moving ? D.damageMoving : D.damage;
                    const dmg = base * (1 + (rand() * 2 - 1) * D.variance)
                              * this.damageMult;
                    reg.damage(id, dmg, {
                        poise: D.poise,
                        // §1.1: no Chill stack above the speed gate.
                        chill: D.chill && !moving,
                        tag: "bolt",
                    });
                    this._bSpent[i] = 1;         // one direct hit per bolt
                    this._bHitId[i] = id;
                    // Terminate the projectile HERE, at the body it hit, so
                    // the damage and the impact FX are one event and the bolt
                    // is never seen flying on through what it killed. This is
                    // the single write from the damage pass into the pool.
                    pool.hitAt(i);
                    this._splash(i);
                    continue;
                }
            }

            // Ground or leash termination — `dart.update()` sets `impact` for
            // exactly one frame and clears it at the top of the next, so this
            // read needs no latch of its own beyond the per-shot one.
            if (impact && !this._bSplashed[i]) this._splash(i);
        }
    }

    /**
     * 4 damage to adjacent targets only (§1.1), the direct hit excluded.
     * Fires ONCE per projectile, on the frame it terminates — whether that
     * was a body, the ground or the end of its leash.
     * @param {number} i pool slot
     */
    _splash(i) {
        const pool = this.spells.bolt;
        const D = this.data.bolt;
        this._bSplashed[i] = 1;
        this._boltHitId = this._bHitId[i];
        this.registry.forEachInSphere(
            pool.x[i], pool.y[i], pool.z[i], D.splashRadius, this._splashCb
        );
    }

    /** @param {number} id */
    _boltSplashHit(id) {
        if (id === this._boltHitId) return;
        this.registry.damage(
            id, this.data.bolt.splashDamage * this.damageMult, { tag: "splash" }
        );
    }

    // =====================================================================
    // LMB (cold) — the FROST ARC (owner redesign 2026-08-11)
    // =====================================================================

    /**
     * One forgiving frontal cone per cast, replacing the projectile in the
     * cold realm only (`REALM_PALETTE.cold.boltArc`; the spell layer bumps
     * `spells.arcGen` exclusively on that path, so this pass needs no realm
     * check of its own). The wave's `forEachInCone` precedent, resolved once
     * on the cast edge — a single query IS the one-hit-per-cast latch.
     *
     * Every body inside takes the dart's own per-hit damage/poise/chill
     * (`combatData.bolt`) plus the arc's 40% × 2.5 s chill-slow through the
     * registry's "slow" channel (bloom's precedent — tier and §5.3 DR
     * scaling are the registry's job). The §1.1 anti-kite falloff does NOT
     * apply: an 8 m arc cannot kite, its reach is the tax.
     *
     * A `dt === 0` freeze frame returns before this runs, but the edge is
     * not lost — `arcGen` persists and the next live frame consumes it.
     */
    _frostArc() {
        const sp = this.spells;
        if (sp.arcGen === undefined || sp.arcGen === this._arcGenSeen) return;
        this._arcGenSeen = sp.arcGen;
        const D = this.data.bolt.arc;
        this.registry.forEachInCone(
            sp.arcX, sp.arcZ, sp.arcDirX, sp.arcDirZ,
            0, D.reach, D.halfAngle, this._arcCb
        );
    }

    /** @param {number} slot @param {number} id */
    _arcHit(slot, id) {
        const reg = this.registry;
        const D = this.data.bolt;
        // The cone test is horizontal; the arc is a ground fan, so an
        // AIRBORNE body (vortex-lifted) sails over it. Airborne is measured
        // against the body's OWN ground, exactly like the wave's crest gate
        // sinks with the terrain under the ENEMY — a caster-relative gate
        // rejected a ground-standing imp 3.6 m uphill at 8 m
        // (`_harness/qa_arcdiag.py`, 2026-08-11).
        const gy = this.spells.ctx.terrain.heightAt(reg.x[slot], reg.z[slot]);
        if (reg.y[slot] > gy + D.arc.heightGate) return;
        const dmg = D.damage * (1 + (rand() * 2 - 1) * D.variance)
                  * this.damageMult;
        reg.damage(id, dmg, {
            poise: D.poise,
            chill: D.chill,            // 1 stack per hit, exactly like the dart
            cc: "slow",
            ccDur: D.arc.slowDur,
            ccMag: D.arc.slowFrac,
            tag: "bolt",
        });
    }

    // =====================================================================
    // KEY 1 — the held stream's whip capsule ticks
    // =====================================================================

    /**
     * 6 damage per tick at 4 Hz to every enemy the held chain touches, plus a
     * 1 m nudge (§1.1). The chain is the ribbon's live spine: tip + committed
     * samples, 0.20 m apart with a 0.205 m tube — sample-sphere tests at that
     * spacing ARE the capsule, no gaps.
     * @param {number} dt
     */
    _whip(dt) {
        const rib = this.spells.ribbon;
        const D = this.data.whip;
        if (!rib.active || !rib.held || rib._count < 3) {
            this._whipOwed = 0;
            return;
        }
        const period = 1 / D.tickRate;
        this._whipOwed += dt;
        if (this._whipOwed < period) return;
        // A hitch never banks extra ticks: one tick fires, the debt clears.
        this._whipOwed = 0;

        const reg = this.registry;
        const ch = this.controller;
        const sx = rib._x, sy = rib._y, sz = rib._z;
        const ring = sx.length;
        const n = Math.min(rib._count, ring);

        for (let i = 0; i < reg.count; i++) {
            if (reg.hp[i] <= 0) continue;
            const rr = D.radius + reg.radius[i];
            const rr2 = rr * rr;
            const ex = reg.x[i], ey = reg.y[i], ez = reg.z[i];
            const et = ey + reg.height[i];

            // Walk the spine: j = -1 is the live tip, 0.. the committed ring.
            let touched = false;
            for (let j = -1; j < n; j++) {
                let px, py, pz;
                if (j < 0) {
                    px = rib.tipX; py = rib.tipY; pz = rib.tipZ;
                } else {
                    const k = (rib._head - j + ring * 2) % ring;
                    px = sx[k]; py = sy[k]; pz = sz[k];
                }
                const dx = px - ex;
                const dz = pz - ez;
                const qy = py < ey ? ey : (py > et ? et : py);
                const dy = py - qy;
                if (dx * dx + dy * dy + dz * dz <= rr2) {
                    touched = true;
                    break;
                }
            }
            if (!touched) continue;

            // Nudge away from the caster — the whip pushes, never pulls.
            let nx = ex - ch.position.x;
            let nz = ez - ch.position.z;
            const nl = Math.hypot(nx, nz) || 1;
            reg.damage(reg.idOf[i], D.damage * this.damageMult, {
                cc: "knockback",
                ccMag: D.nudge,
                dirX: nx / nl,
                dirZ: nz / nl,
                tag: "whip",
            });
        }
    }

    // =====================================================================
    // 1 — Frost Wave (sweep's travelling crescent)
    // =====================================================================

    _wave() {
        const sw = this.spells.sweep;
        const D = this.data.wave;

        // New cast = activation edge or the spell's clock rewinding (a recast
        // RESTARTS the same object). Either clears the hit latch.
        const newCast = sw.active && (!this._sweepActive || sw.t < this._sweepT);
        if (newCast) {
            this._waveN = 0;
        }
        this._sweepActive = sw.active;
        this._sweepT = sw.active ? sw.t : Infinity;
        if (!sw.active) return;
        this._waveBirth = newCast ? true : this._waveBirth;

        // The envelope, exactly as sweep.update computes it — the crest that
        // is drawn is the crest that hits.
        const life01 = sw.t / D.life;
        const rise = smooth01(sw.t / 0.26);
        const fall = 1 - clamp01((life01 - 0.55) / 0.45);
        let env = rise * fall * fall;
        // BIRTH SWELL (QA battery C): a point-blank enemy is crossed by the
        // newborn crest while the rise envelope is still ~0 — it was gated
        // to zero damage and then left behind the traveling annulus forever,
        // so melee-range waves whiffed. The wave is the kit's space-maker
        // (§0 pillar 1: face-tanking must be punishable BY the player too):
        // during the first 0.30 s the effective envelope floors at 0.45, so
        // a shove at the feet lands as a real hit instead of a phantom.
        if (sw.t < 0.30) env = Math.max(env, 0.45);
        if (env < D.envGate) return;       // §9.3: same gate as _plough

        // Crescent geometry, mirrored from sweep.update: circle centre one
        // curvature radius behind the leading point, arc opening with spread.
        const spread = clamp01((sw.reach - 1.4) / 14);
        const arc = D.arc0 + (D.arc1 - D.arc0) * spread;
        const kx = sw.ox + sw.dx * (sw.reach - D.curve);
        const kz = sw.oz + sw.dz * (sw.reach - D.curve);

        this._qEnv = env;
        this._qKx = kx; this._qKz = kz;
        this._qDx = sw.dx; this._qDz = sw.dz;
        this._qWx = sw.dz; this._qWz = -sw.dx;   // sweep's own crest-right
        this._qArc = arc;

        this.registry.forEachInCone(
            kx, kz, sw.dx, sw.dz,
            D.curve - D.thick, D.curve + D.thick, arc,
            this._waveCb
        );

        // BIRTH PASS (QA battery C, second finding): the crest is born at
        // reach 1.4 and only travels OUT — an enemy inside that radius at
        // the strike is behind the crescent forever and could never be hit.
        // One extra sweep on the first active frame covers the birth swell.
        //
        // ANCHORED ON THE CASTER, not the ignite origin (live-fix
        // gap_fireball.py): for the cold feet-born cast the two differ by
        // 1.1 m and the origin anchor left a 0-0.9 m dead ring; for the Ash
        // THROWN cast the origin is `waveThrowM` out and the origin anchor
        // turned the whole caster->landing corridor (~7 m) into a dead zone
        // — a body 0.4 m behind the landing could never be hit by anything.
        // The swell covers everything from the caster to the newborn crest,
        // in front of the caster, which is exactly what a feet-born cast
        // sweeps — the realm-invariant reading of owner directive 4.
        if (this._waveBirth) {
            this._waveBirth = false;
            const ch = this.controller.position;
            this._qPx = ch.x; this._qPz = ch.z;
            const originD = Math.hypot(sw.ox - ch.x, sw.oz - ch.z);
            this.registry.forEachInCone(
                ch.x, ch.z, sw.dx, sw.dz,
                0, originD + sw.reach + D.thick, arc,
                this._waveBirthCb
            );
        }
    }

    /** Birth-swell hit: same damage/CC as _waveHit, but the geometry is the
     *  CAST CORRIDOR — the body must be ahead of the CASTER, and the bell
     *  taper is the lateral offset from the cast axis mapped onto the
     *  newborn crescent's half-span. For the feet-born cast this matches
     *  the arc parametrisation (centre ~3 m behind the caster, so axis
     *  offset and arc angle agree); for the thrown cast the arc centre sits
     *  AHEAD of the caster and the arc parametrisation would put corridor
     *  bodies on the horns (bell 0) — the axis form is the one that is the
     *  same spell in every realm. Knockback pushes away from the CASTER,
     *  which is also what the old centre-radial did in cold (centre behind
     *  the caster) — not away from a landing point behind the target.
     *  @param {number} slot @param {number} id */
    _waveBirthHit(slot, id) {
        const reg = this.registry;
        const D = this.data.wave;
        const ex = reg.x[slot] - this._qPx;
        const ez = reg.z[slot] - this._qPz;
        if (ex * this._qDx + ez * this._qDz < -0.2) return;
        const halfSpan = D.curve * Math.sin(this._qArc);
        const lat = ex * this._qWx + ez * this._qWz;
        const w = bell(clamp01(0.5 + lat / (2 * halfSpan)));
        this._waveApply(slot, id, w, this._qPx, this._qPz);
    }

    /** @param {number} slot @param {number} id */
    _waveHit(slot, id) {
        const reg = this.registry;

        // Angular position on the arc -> the bell taper (§1.1: damage matches
        // bell(u), 20 at centre, 0 at the horns).
        const dx = reg.x[slot] - this._qKx;
        const dz = reg.z[slot] - this._qKz;
        const along = dx * this._qDx + dz * this._qDz;
        const lateral = dx * this._qWx + dz * this._qWz;
        const th = Math.atan2(lateral, along);
        const u = clamp01(th / (2 * this._qArc) + 0.5);
        this._waveApply(slot, id, bell(u), this._qKx, this._qKz);
    }

    /** The wave's damage+CC, shared by the travelling-crest and birth-swell
     *  geometries. `cx/cz` is the radial origin the knockback pushes away
     *  from: the arc centre for the travelling crest, the caster for the
     *  birth swell.
     *  @param {number} slot @param {number} id @param {number} w bell taper
     *  @param {number} cx @param {number} cz */
    _waveApply(slot, id, w, cx, cz) {
        if (this._has(this._waveIds, this._waveN, id)) return;
        if (w <= 1e-3) return;             // a horn graze is a miss, not a latch
        const reg = this.registry;
        const D = this.data.wave;

        // Base below crest height (§1.1): the crest rides the terrain, so the
        // gate compares against the ground under the ENEMY, sunk like the
        // crest is — a lifted body above PEAK×env sails over the wave.
        const ex = reg.x[slot], ez = reg.z[slot];
        const crestBase =
            this.spells.ctx.terrain.heightAt(ex, ez) - D.sink;
        if (reg.y[slot] > crestBase + D.peak * this._qEnv) return;

        const dx = ex - cx;
        const dz = ez - cz;
        const d = Math.hypot(dx, dz) || 1;
        const dmg = D.damage * w * this._qEnv * this.damageMult;
        reg.damage(id, dmg, {
            poise: D.poise,
            cc: "knockback",               // registry adds the 0.4 s stagger
            ccMag: D.kbMag,                // tier fractions applied in-registry
            dirX: dx / d,                  // outward radial: the wave ploughs
            dirZ: dz / d,
            tag: "wave",
        });
        this._waveN = this._add(this._waveIds, this._waveN, id);
    }

    // =====================================================================
    // 2 — Mini-Vortex (bloom burst + lingering column)
    // =====================================================================

    /** @param {number} dt */
    _bloom(dt) {
        const bl = this.spells.bloom;
        const D = this.data.bloom;

        if (bl.active && (!this._bloomActive || bl.t < this._bloomT)) {
            this._bloomBurstDone = false;
        }
        this._bloomActive = bl.active;
        this._bloomT = bl.active ? bl.t : Infinity;
        if (!bl.active) return;

        // The one-shot sphere rides the spell's OWN burst frame (§9.3: it
        // inherits the t >= 0.10 timing for free — crater, throw and damage
        // are the same event).
        if (bl._burst && !this._bloomBurstDone) {
            this._bloomBurstDone = true;
            this.registry.forEachInSphere(
                bl.x, bl.y, bl.z, D.burstRadius, this._burstCb
            );
        }

        // Lingering column: tube r 0.66 × 5.6 m ×env for LIFE — 8 DPS
        // contact (§1.1). Envelope mirrored from bloom._column so the tube
        // that damages is the tube that renders.
        if (!bl._burst || bl.t >= D.columnLife) return;
        const rise = smooth01((bl.t - 0.10) / 0.34);
        const drop = 1 - smooth01((bl.t - 0.95) / 0.80);
        const env = rise * drop;
        if (env <= 0.002) return;

        const reg = this.registry;
        const top = D.columnHeight * env;
        for (let i = 0; i < reg.count; i++) {
            if (reg.hp[i] <= 0) continue;
            const dx = reg.x[i] - bl.x;
            const dz = reg.z[i] - bl.z;
            const rr = D.columnRadius + reg.radius[i];
            if (dx * dx + dz * dz > rr * rr) continue;
            if (reg.y[i] > bl.y + top) continue;
            if (reg.y[i] + reg.height[i] < bl.y) continue;

            // Contact DoT through the id-checked accumulator; damage is
            // DPS × contact time, banked so a slow frame pays what it owes.
            if (this._cOwedId[i] !== reg.idOf[i]) {
                this._cOwedId[i] = reg.idOf[i];
                this._cOwed[i] = 0;
            }
            this._cOwed[i] += dt;
            if (this._cOwed[i] < 1 / this.data.vortex.tickHz) continue;
            // Catch-up clamp: 0.25 s of owed ticks, NOT one tick-interval —
            // at 7-15 fps the old 0.05 cap silently halved vortex damage
            // (QA battery A measured 8.1 of the designed 15 DPS).
            const k = Math.min(this._cOwed[i], 0.25);
            this._cOwed[i] = 0;
            reg.damage(reg.idOf[i], D.columnDps * k * this.damageMult, {
                tag: "bloom",
            });
        }
    }

    /** @param {number} slot @param {number} id @param {number} d2 */
    _bloomBurstHit(slot, id, d2) {
        const reg = this.registry;
        const D = this.data.bloom;
        // 35 at the epicentre, 100% inside the inner 40% of the radius, then
        // linear to 18 at the rim (§1.1).
        const dist = Math.sqrt(d2);
        const inner = D.burstRadius * D.innerFrac;
        const f = clamp01((dist - inner) / (D.burstRadius - inner));
        const dmg = (D.burstDamage + (D.burstRim - D.burstDamage) * f)
                  * this.damageMult;
        reg.damage(id, dmg, {
            poise: D.poise,
            cc: "slow",
            ccDur: D.slowDur,
            ccMag: D.slowFrac,
            tag: "bloom",
        });
        // 0.7 s stagger (§1.1). The registry's damage() has no bare-stagger
        // channel — knockback and poisebreak own staggerUntil — so the burst
        // writes the SoA directly, the same array spellHits already queries.
        reg.staggerUntil[slot] =
            Math.max(reg.staggerUntil[slot], reg.time + D.stagger);
    }

    // =====================================================================
    // 3 — Crystal Spikes (per-prism plant test on the expanding disc)
    // =====================================================================

    _spikes() {
        const cr = this.spells.crystallize;
        const D = this.data.spikes;

        if (cr.active && (!this._crysActive || cr.t < this._crysT)) {
            this._spikeN = 0;
            this._crysSeen = 0;
        }
        this._crysActive = cr.active;
        this._crysT = cr.active ? cr.t : Infinity;
        if (!cr.active || cr._planted <= this._crysSeen) return;

        // Test on the frames prisms actually plant: the disc radius the
        // newest prism reached is the spiral's own r(i) (§1.1: r 0.18→2.23
        // over PLANT_TIME) — the outward wave is free from planting order,
        // and the latch makes re-testing the full disc idempotent (§9.3).
        this._crysSeen = cr._planted;
        const n01 = Math.min(1, (cr._planted - 1) / (D.count - 1));
        const R = D.r0 + Math.sqrt(n01) * (D.r1 - D.r0);

        const reg = this.registry;
        for (let i = 0; i < reg.count; i++) {
            if (reg.hp[i] <= 0) continue;
            const id = reg.idOf[i];
            if (this._has(this._spikeIds, this._spikeN, id)) continue;
            const dx = reg.x[i] - cr.x;
            const dz = reg.z[i] - cr.z;
            const rr = R + reg.radius[i];
            if (dx * dx + dz * dz > rr * rr) continue;
            // Vertical: the formation stands prism-height above the drift —
            // a body has to actually be down among the ice.
            if (reg.y[i] > cr.y + D.prismHeight) continue;
            if (reg.y[i] + reg.height[i] < cr.y - D.baseSink) continue;

            reg.damage(id, D.damage * this.damageMult, {
                poise: D.poise,            // 60 — the stance-break tool
                cc: "stun",
                ccDur: D.stunDur,          // tier scaling is the registry's job
                tag: "spikes",
            });
            this._spikeN = this._add(this._spikeIds, this._spikeN, id);
        }
    }

    // =====================================================================
    // 4 — Great Vortex (ring DoT + lift + release fling)
    // =====================================================================

    /** @param {number} dt */
    _vortex(dt) {
        const vx = this.spells.vortex;
        const D = this.data.vortex;
        const reg = this.registry;

        if (!vx.active) {
            // Cancel path (§9.2: volumes die with cancel): a vortex that
            // ended while still holding was cancelled — bodies drop where
            // they are, no fling. The natural end already flung at the
            // hold->fade edge and emptied the list.
            if (this._liftN > 0) this._dropLift();
            this._vorActive = false;
            this._vorHolding = false;
            this._vorT = Infinity;
            return;
        }
        this._vorActive = true;
        this._vorT = vx.t;

        const holding = vx.t < D.ramp + D.hold;
        const env = smooth01(vx.t / D.ramp)
                  * (1 - smooth01((vx.t - D.ramp - D.hold) / D.fade));

        // The release: the moment the hold ends, everything lifted is flung
        // 8–12 m along the player's aim, +20 impact (§1.1).
        if (this._vorHolding && !holding) this._fling();
        this._vorHolding = holding;

        // Ring DoT — player-following cylinder at this.ring × TOP·env, per-
        // enemy accumulator mirroring the 45 Hz _strip throttle (§9.3).
        const gy = this.spells.ctx.terrain.heightAt(vx.x, vx.z);
        const top = D.top * env;
        const canLift = holding && env >= D.liftEnvGate;

        for (let i = 0; i < reg.count; i++) {
            if (reg.hp[i] <= 0) continue;
            const dx = reg.x[i] - vx.x;
            const dz = reg.z[i] - vx.z;
            const rr = vx.ring + reg.radius[i];
            if (dx * dx + dz * dz > rr * rr) continue;
            if (reg.y[i] > gy + top) continue;
            if (reg.y[i] + reg.height[i] < gy) continue;

            const id = reg.idOf[i];
            if (this._vOwedId[i] !== id) {
                this._vOwedId[i] = id;
                this._vOwed[i] = 0;
            }
            this._vOwed[i] += dt;
            if (this._vOwed[i] < 1 / D.tickHz) continue;
            // 0.25 s catch-up, not one tick-interval: the 0.05 cap halved
            // vortex damage below ~20 fps (QA battery A: 8.1 of 15 DPS).
            const k = Math.min(this._vOwed[i], 0.25);
            this._vOwed[i] = 0;

            const liftable = reg.tier[i] <= TIER.LIGHT;
            if (liftable && canLift) {
                reg.damage(id, D.dps * env * k * this.damageMult, {
                    poise: D.poisePerSec * k,
                    cc: "lift",
                    tag: "vortex",
                });
                if (reg.lifted[i] &&
                    !this._has(this._liftIds, this._liftN, id)) {
                    this._liftN = this._add(this._liftIds, this._liftN, id);
                }
            } else {
                // Non-liftable tiers: slow only — heavy/elite 50%, boss 25%
                // (§5.2), renewed while inside the ring.
                const frac = reg.tier[i] === TIER.BOSS
                    ? D.bossSlowFrac : D.slowFrac;
                reg.damage(id, D.dps * env * k * this.damageMult, {
                    poise: D.poisePerSec * k,
                    cc: liftable ? null : "slow",
                    ccDur: D.slowRenew,
                    ccMag: frac,
                    tag: "vortex",
                });
            }
        }
    }

    /** Release: fling every lifted body along the player's aim. */
    _fling() {
        const reg = this.registry;
        const D = this.data.vortex;

        // Horizontal aim; a skyward camera still flings ALONG the ground.
        const aim = this.spells.aim;
        let ax = aim.x, az = aim.z;
        let l = Math.hypot(ax, az);
        if (l < 1e-4) {
            const f = this.controller.facing;   // controller frame fallback
            ax = Math.sin(f); az = -Math.cos(f); l = 1;
        }
        ax /= l; az /= l;

        for (let k = 0; k < this._liftN; k++) {
            const id = this._liftIds[k];
            const slot = reg.slot(id);
            if (slot < 0) continue;
            reg.lifted[slot] = 0;          // clear BEFORE the impulse lands
            if (reg.hp[slot] <= 0) continue;
            const mag = D.flingMin + rand() * (D.flingMax - D.flingMin);
            reg.damage(id, D.flingDamage * this.damageMult, {
                cc: "knockback",
                ccMag: mag,
                dirX: ax,
                dirZ: az,
                tag: "fling",
            });
        }
        this._liftN = 0;
    }

    /** Cancel: clear every lift flag without damage or impulse. */
    _dropLift() {
        const reg = this.registry;
        for (let k = 0; k < this._liftN; k++) {
            const slot = reg.slot(this._liftIds[k]);
            if (slot >= 0) reg.lifted[slot] = 0;
        }
        this._liftN = 0;
    }

    // =====================================================================
    // Latch helpers — linear scans over preallocated id arrays
    // =====================================================================

    /**
     * @param {Int32Array} arr @param {number} n @param {number} id
     * @returns {boolean}
     */
    _has(arr, n, id) {
        for (let k = 0; k < n; k++) if (arr[k] === id) return true;
        return false;
    }

    /**
     * @param {Int32Array} arr @param {number} n @param {number} id
     * @returns {number} new count
     */
    _add(arr, n, id) {
        if (n < arr.length) arr[n++] = id;
        return n;
    }
}
