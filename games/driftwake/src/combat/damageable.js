/**
 * The Damageable registry — the combat system's single source of "what can
 * be hit and what state is it in" (_spec/COMBAT_DESIGN.md §9, the SoA).
 *
 * Everything hittable registers a slot here: training dummies, enemies,
 * later destructibles. Spell hit tests (combat/spellHits.js) query the
 * arrays and call `damage()`; consumers (floaters, audio, XP, enemy AI)
 * drain the per-frame EVENT RING instead of subscribing — same polled
 * philosophy as the rest of the engine, allocation-free steady frames.
 *
 * CONTRACT (every builder codes against this — do not drift):
 *   register(desc) -> id        desc: {x,y,z, radius, height, tier, level,
 *                               hp, poiseMax, name, kind}
 *   move(id, x, y, z)           bodies own their position updates
 *   damage(id, amount, opts)    opts: {poise=0, cc=null, ccDur=0, dirX/dirZ
 *                               (knock direction), tag (floater styling),
 *                               fromPlayer=true}
 *   remove(id)
 *   Queries: forEachInSphere / forEachInCone / forEachSegment — capsule
 *   tests against (x, y..y+height, radius).
 *
 * CC + tier rules are §5.2's matrix, implemented HERE so every spell gets
 * them for free: fodder/light take full CC; medium takes 70% knockback,
 * full stun; heavy 30% knockback, stun 0.75×; brute/boss immune to
 * knockback/lift, stun converts to poise damage ×1.5. Chill stacks and
 * Brittle (+20% damage taken at 5 stacks, 4 s) also live here.
 *
 * The event ring records {type, id, amount, x, y, z, tag, tier} per event:
 *   "hit" | "kill" | "poisebreak" | "ccapply"
 * Consumers read events[0..eventCount) AFTER combat updates and BEFORE
 * endFrame() clears it (main.js order: spells -> combat -> floaters/xp).
 */

const MAX = 96;
const EVT_MAX = 128;

/** Tier ids — indices into the CC rule tables. */
export const TIER = { FODDER: 0, LIGHT: 1, MEDIUM: 2, HEAVY: 3, ELITE: 4, BOSS: 5 };

/** §5.2 CC matrix: knockback fraction, stun multiplier, liftable. */
const KB_FRAC = [1.0, 1.0, 0.7, 0.3, 0.0, 0.0];
const STUN_MULT = [1.0, 1.0, 1.0, 0.75, 0.0, 0.0];
const LIFTABLE = [true, true, false, false, false, false];
/** Stun converts to bonus poise damage at tiers that resist it (×1.5). */
const STUN_TO_POISE = [0, 0, 0, 0, 1.5, 1.5];

export class DamageableRegistry {
    constructor() {
        this.count = 0;
        /** Dense SoA; `alive[i]` false = free slot (swap-remove keeps dense). */
        this.alive = new Uint8Array(MAX);
        this.x = new Float32Array(MAX);
        this.y = new Float32Array(MAX);
        this.z = new Float32Array(MAX);
        this.radius = new Float32Array(MAX);
        this.height = new Float32Array(MAX);
        this.hp = new Float32Array(MAX);
        this.hpMax = new Float32Array(MAX);
        this.tier = new Uint8Array(MAX);
        this.level = new Uint8Array(MAX);
        this.poise = new Float32Array(MAX);
        this.poiseMax = new Float32Array(MAX);
        /** Absolute game-time until which each state holds. */
        this.stunUntil = new Float32Array(MAX);
        this.staggerUntil = new Float32Array(MAX);
        this.slowUntil = new Float32Array(MAX);
        this.slowFrac = new Float32Array(MAX);
        /** Chill: stack count + last-applied time (3 s refresh window). */
        this.chill = new Uint8Array(MAX);
        this.chillAt = new Float32Array(MAX);
        this.brittleUntil = new Float32Array(MAX);
        /** Knockback impulse accumulated this frame; bodies consume it. */
        this.kbX = new Float32Array(MAX);
        this.kbZ = new Float32Array(MAX);
        /** Lift flag (Great Vortex): body is airborne-disabled while set. */
        this.lifted = new Uint8Array(MAX);
        /** @type {(string|null)[]} display names for bars/floaters. */
        this.name = new Array(MAX).fill(null);
        /** @type {(string|null)[]} kind: 'dummy' | 'enemy' | 'boss'. */
        this.kind = new Array(MAX).fill(null);
        /** Monotonic ids -> slot; slot -> id. */
        this.idOf = new Int32Array(MAX).fill(-1);
        this._slotOf = new Map();
        this._nextId = 1;

        // Event ring (flat SoA, cleared by endFrame()).
        this.eventCount = 0;
        this.evType = new Uint8Array(EVT_MAX);      // 0 hit, 1 kill, 2 poisebreak, 3 cc
        this.evId = new Int32Array(EVT_MAX);
        this.evAmount = new Float32Array(EVT_MAX);
        this.evX = new Float32Array(EVT_MAX);
        this.evY = new Float32Array(EVT_MAX);
        this.evZ = new Float32Array(EVT_MAX);
        this.evTier = new Uint8Array(EVT_MAX);
        /** @type {(string|null)[]} */
        this.evTag = new Array(EVT_MAX).fill(null);

        /** Game time, advanced by update(). */
        this.time = 0;
    }

    /**
     * @param {{x:number,y:number,z:number,radius:number,height:number,
     *          tier:number,level?:number,hp:number,poiseMax?:number,
     *          name?:string,kind?:string}} d
     * @returns {number} id (-1 if full)
     */
    register(d) {
        if (this.count >= MAX) return -1;
        const i = this.count++;
        this.alive[i] = 1;
        this.x[i] = d.x; this.y[i] = d.y; this.z[i] = d.z;
        this.radius[i] = d.radius; this.height[i] = d.height;
        this.hp[i] = this.hpMax[i] = d.hp;
        this.tier[i] = d.tier;
        this.level[i] = d.level ?? 10;
        this.poise[i] = this.poiseMax[i] = d.poiseMax ?? 100;
        this.stunUntil[i] = this.staggerUntil[i] = this.slowUntil[i] = 0;
        this.slowFrac[i] = 0;
        this.chill[i] = 0; this.chillAt[i] = 0; this.brittleUntil[i] = 0;
        this.kbX[i] = this.kbZ[i] = 0;
        this.lifted[i] = 0;
        this.name[i] = d.name || null;
        this.kind[i] = d.kind || "enemy";
        const id = this._nextId++;
        this.idOf[i] = id;
        this._slotOf.set(id, i);
        return id;
    }

    /** @param {number} id @returns {number} slot or -1 */
    slot(id) {
        const s = this._slotOf.get(id);
        return s === undefined ? -1 : s;
    }

    /** @param {number} id @param {number} x @param {number} y @param {number} z */
    move(id, x, y, z) {
        const i = this.slot(id);
        if (i < 0) return;
        this.x[i] = x; this.y[i] = y; this.z[i] = z;
    }

    /** @param {number} id @returns {void} */
    remove(id) {
        const i = this.slot(id);
        if (i < 0) return;
        this._slotOf.delete(id);
        const last = this.count - 1;
        if (i !== last) {
            // swap-remove every column; remap the moved id
            const cols = [this.alive, this.x, this.y, this.z, this.radius,
                this.height, this.hp, this.hpMax, this.tier, this.level,
                this.poise, this.poiseMax, this.stunUntil, this.staggerUntil,
                this.slowUntil, this.slowFrac, this.chill, this.chillAt,
                this.brittleUntil, this.kbX, this.kbZ, this.lifted, this.idOf];
            for (const c of cols) c[i] = c[last];
            this.name[i] = this.name[last];
            this.kind[i] = this.kind[last];
            this._slotOf.set(this.idOf[i], i);
        }
        this.alive[last] = 0;
        this.name[last] = null;
        this.kind[last] = null;
        this.count = last;
    }

    /**
     * Apply damage + CC through the tier matrix. THE single entry point —
     * spells, hazards and later enemies-vs-player all come through here (a
     * negative `fromPlayer` path is added with the enemy runtime).
     * @param {number} id
     * @param {number} amount
     * @param {{poise?:number, cc?:"stun"|"knockback"|"lift"|"slow"|null,
     *          ccDur?:number, ccMag?:number, dirX?:number, dirZ?:number,
     *          chill?:boolean, tag?:string}} [o]
     * @returns {number} damage actually dealt (0 if id dead/invalid)
     */
    damage(id, amount, o) {
        const i = this.slot(id);
        if (i < 0 || this.hp[i] <= 0) return 0;
        const t = this.tier[i];
        let dmg = amount;
        // Brittle: +20% damage taken (§1.1 Chill/Brittle).
        if (this.time < this.brittleUntil[i]) dmg *= 1.2;
        this.hp[i] -= dmg;
        this._event(0, i, dmg, o && o.tag);

        // Chill stacks (not applied when the caller suppressed them).
        if (o && o.chill) {
            if (this.time - this.chillAt[i] > 3) this.chill[i] = 0;
            this.chillAt[i] = this.time;
            if (this.chill[i] < 5) this.chill[i]++;
            if (this.chill[i] >= 5 && this.time >= this.brittleUntil[i]) {
                this.brittleUntil[i] = this.time + 4;
                this.chill[i] = 0;
                this._event(3, i, 0, "brittle");
            }
        }

        // Poise, with stun-conversion for CC-immune tiers.
        let poiseDmg = (o && o.poise) || 0;
        if (o && o.cc === "stun" && STUN_TO_POISE[t] > 0) {
            poiseDmg += ((o.ccMag ?? 0) || 30) * STUN_TO_POISE[t];
        }
        if (poiseDmg > 0 && this.poiseMax[i] > 0) {
            this.poise[i] -= poiseDmg;
            if (this.poise[i] <= 0) {
                this.poise[i] = this.poiseMax[i];
                this.staggerUntil[i] = Math.max(this.staggerUntil[i], this.time + 1.2);
                this._event(2, i, poiseDmg, "poisebreak");
            }
        }

        // CC through the matrix.
        if (o && o.cc) {
            const dur = o.ccDur || 0;
            if (o.cc === "stun" && STUN_MULT[t] > 0) {
                this.stunUntil[i] = Math.max(this.stunUntil[i], this.time + dur * STUN_MULT[t]);
                this._event(3, i, dur, "stun");
            } else if (o.cc === "knockback" && KB_FRAC[t] > 0) {
                const m = ((o.ccMag ?? 4) || 4) * KB_FRAC[t];
                this.kbX[i] += (o.dirX || 0) * m;
                this.kbZ[i] += (o.dirZ || 0) * m;
                this.staggerUntil[i] = Math.max(this.staggerUntil[i], this.time + 0.4);
            } else if (o.cc === "lift" && LIFTABLE[t]) {
                this.lifted[i] = 1;
            } else if (o.cc === "slow") {
                this.slowUntil[i] = Math.max(this.slowUntil[i], this.time + dur);
                this.slowFrac[i] = Math.max(this.slowFrac[i], (o.ccMag ?? 0.4) || 0.4);
            }
        }

        if (this.hp[i] <= 0) {
            this.hp[i] = 0;
            this._event(1, i, dmg, o && o.tag);
        }
        return dmg;
    }

    /** Effective move-speed multiplier for a body (chill + slow + stagger). */
    speedMult(id) {
        const i = this.slot(id);
        if (i < 0) return 1;
        let m = 1;
        if (this.time - this.chillAt[i] <= 3) m *= 1 - 0.06 * this.chill[i];
        if (this.time < this.slowUntil[i]) m *= 1 - this.slowFrac[i];
        if (this.time < this.stunUntil[i] || this.lifted[i]) m = 0;
        return m;
    }

    /**
     * @param {number} cx @param {number} cy @param {number} cz
     * @param {number} r
     * @param {(slot:number, id:number, distSq:number)=>void} fn
     */
    forEachInSphere(cx, cy, cz, r, fn) {
        const r2 = r * r;
        for (let i = 0; i < this.count; i++) {
            const dx = this.x[i] - cx;
            const dy = Math.max(0, Math.abs(this.y[i] + this.height[i] * 0.5 - cy) - this.height[i] * 0.5);
            const dz = this.z[i] - cz;
            const rr = r + this.radius[i];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= rr * rr && d2 <= r2 + 2 * r * this.radius[i] + this.radius[i] * this.radius[i]) {
                fn(i, this.idOf[i], d2);
            }
        }
    }

    /**
     * Horizontal cone/arc from (cx,cz) along (dirX,dirZ): bodies between
     * rMin..rMax whose bearing is within halfAngle. For the Wave crescent.
     */
    forEachInCone(cx, cz, dirX, dirZ, rMin, rMax, halfAngle, fn) {
        for (let i = 0; i < this.count; i++) {
            const dx = this.x[i] - cx;
            const dz = this.z[i] - cz;
            const d = Math.hypot(dx, dz);
            if (d + this.radius[i] < rMin || d - this.radius[i] > rMax) continue;
            const ang = Math.acos(Math.min(1, Math.max(-1,
                (dx * dirX + dz * dirZ) / Math.max(1e-6, d))));
            // widen by the body's angular radius so edges clip fairly
            const width = Math.atan2(this.radius[i], Math.max(0.5, d));
            if (ang <= halfAngle + width) fn(i, this.idOf[i], d);
        }
    }

    /**
     * Swept segment (projectile step) vs capsules. Returns first id hit or -1.
     * @returns {number}
     */
    segmentHit(x0, y0, z0, x1, y1, z1, padR) {
        let best = -1, bestT = Infinity;
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const len2 = dx * dx + dy * dy + dz * dz;
        for (let i = 0; i < this.count; i++) {
            if (this.hp[i] <= 0) continue;
            const r = this.radius[i] + padR;
            // closest approach of segment to the body's vertical axis segment
            const cx = this.x[i], cz = this.z[i];
            const cy0 = this.y[i], cy1 = this.y[i] + this.height[i];
            let t = len2 > 1e-9 ?
                ((cx - x0) * dx + (Math.min(Math.max(y0, cy0), cy1) - y0) * dy + (cz - z0) * dz) / len2 : 0;
            t = Math.min(1, Math.max(0, t));
            const px = x0 + dx * t, py = y0 + dy * t, pz = z0 + dz * t;
            const qy = Math.min(Math.max(py, cy0), cy1);
            const ddx = px - cx, ddy = py - qy, ddz = pz - cz;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= r * r && t < bestT) {
                bestT = t;
                best = this.idOf[i];
            }
        }
        return best;
    }

    _event(type, slot, amount, tag) {
        if (this.eventCount >= EVT_MAX) return;
        const e = this.eventCount++;
        this.evType[e] = type;
        this.evId[e] = this.idOf[slot];
        this.evAmount[e] = amount;
        this.evX[e] = this.x[slot];
        this.evY[e] = this.y[slot] + this.height[slot] * 0.8;
        this.evZ[e] = this.z[slot];
        this.evTier[e] = this.tier[slot];
        this.evTag[e] = tag || null;
    }

    /** Advance time; expire lift when nothing renews it. @param {number} dt */
    update(dt) {
        this.time += dt;
    }

    /** Clear the event ring — main.js calls this LAST in the frame. */
    endFrame() {
        for (let e = 0; e < this.eventCount; e++) this.evTag[e] = null;
        this.eventCount = 0;
    }
}
