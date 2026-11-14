/**
 * Spell 1 — Sweep.
 *
 * A crescent of slush rises out of the ground ahead of the player and runs
 * outward, ploughing a channel and throwing berms to either side.
 *
 * It is the wake's cross-section on a different spine, and that is not a
 * shortcut. A carve's wall of snow and a bent wave of slush are the same object —
 * mass thrown out of the ground and held up by its own momentum — so they are
 * drawn by the same section integral, reached through the water material's SHEET
 * profile. What differs is what the spine is: the wake's is a record of where the
 * board went, and this one is an arc that grows outward from where the spell was
 * cast.
 *
 * The channel is not a decal chased after the fact. Each frame the live crest
 * writes brushes into the terrain state buffer at the position the mesh is
 * actually drawing, so the mark and the wave cannot disagree.
 *
 * THE THREE REALMS. Cold "Frost Wave", Sand "Dune Surge", Ash "FIREBALL". The
 * first two are pure reskins — milkiness, light colour and spray treatment,
 * all of them arguments this file was already passing. Ash is the ONE place in
 * the whole kit where the presentation needed a mechanic-preserving detour:
 * the owner asked for a thrown fireball, and a plain projectile would delete
 * this spell's actual combat job, which is the kit's knockback tool
 * (`cc: {type:"knockback", dur:0.4, mag:4}`). So the Ash cast THROWS A CARRIER
 * HEAD through the bolt pool and detonates THIS SAME CRESCENT where it lands:
 * the travel reads as a fireball, and the blast keeps the crescent's
 * knockback, its bell-tapered arc damage and its poise, unaltered. Every
 * number below is realm-invariant (owner directive 4).
 */

import { PROFILE_SHEET } from "./waterBody.js";
import { clamp01, smooth01, bell, rand } from "./bending.js";

/**
 * Muzzle scratch for the Ash throw. Module scope: a cast is a rare edge, but
 * this file allocates nothing per frame and will not start now.
 */
const _hand = new Float32Array(3);

/**
 * The Ash carrier's flight, m/s. FASTER than the bolt's 21 so the detour costs
 * as little of the spell's feel as possible: 5 m at 24 m/s is 0.21 s on top of
 * the 0.71 s strike delay. FLAGGED FOR THE OWNER — this is the one place the
 * realm swap changes when the damage lands, and the contract says to say so
 * rather than silently drop the knockback or silently absorb the delay.
 */
const THROW_SPEED = 24;
/** Hard backstop: detonate anyway if the carrier has not landed by here. */
const THROW_TIMEOUT = 1.2;

/** Spine samples across the crescent. */
const COLS = 48;

/**
 * Curvature radius of the crescent, metres — *fixed*, and this is the whole
 * shape of the spell.
 *
 * Not the distance travelled. Using that as the radius makes the wave an arc of a
 * circle centred on the caster, and ten metres out the crescent is twenty metres
 * wide — a ridge in the terrain rather than something thrown. A wave front has a
 * curvature of its own that has nothing to do with how far it has run, so the arc
 * keeps its shape and *translates*, and only its span opens up as the ends spread.
 */
const CURVE = 5.5;
/** Half-angle of the arc at cast and at full spread, radians. */
const ARC0 = 0.52;
const ARC1 = 0.96;
/** Seconds from cast to fully collapsed. */
const LIFE = 2.4;
/**
 * Peak crest height at the centre of the arc, metres.
 *
 * Taller than the character, on the same reasoning as the surf wake's 2.4 m: at
 * the distance this demo actually frames from, a crest the height of the relief
 * the terrain already has does not read as thrown mass, it reads as a dune.
 */
const PEAK = 2.15;

export class Sweep {
    /** @param {import("./spellSystem.js").SpellContext} ctx */
    constructor(ctx) {
        this.ctx = ctx;
        this.active = false;
        this.strand = -1;

        this.t = 0;
        this.ox = 0;
        this.oz = 0;
        this.dx = 0;
        this.dz = 1;
        /** Metres the crest has travelled from the origin. */
        this.reach = 0;
        this._brushOwed = 0;
        this._sprayOwed = 0;

        // ---- Ash fireball carrier ------------------------------------------
        /** Bolt-pool slot the carrier is riding, or -1 when nothing is in
         *  flight. `active` stays FALSE for the whole flight, so `spellHits`
         *  runs no test until the crescent actually exists. */
        this._pendSlot = -1;
        /** The pool's `gen` at launch — a recycled slot is not our carrier. */
        this._pendGen = -1;
        this._pendT = 0;
        this._pendAx = 0;
        this._pendAz = 1;
    }

    /**
     * @param {number} ax @param {number} az flat aim direction. Flattening is done
     *   by the caller (SpellSystem.cast): a camera pointed at the sky must not
     *   launch the crescent upward.
     */
    trigger(ax, az) {
        const ctx = this.ctx;
        const fl = Math.hypot(ax, az) || 1;
        const nx = ax / fl;
        const nz = az / fl;

        // ASH: throw first, detonate on landing. Falls through to the direct
        // cast if the throw could not be launched (pool full), because a spell
        // that silently does nothing is worse than one that skips its travel.
        if (ctx.realm.waveThrowM > 0 && this._pendSlot < 0 && ctx.bolt) {
            if (this._throw(nx, nz)) return;
        }

        const ch = ctx.controller;
        this._ignite(
            ch.position.x + nx * 1.1, ch.position.z + nz * 1.1, nx, nz
        );
    }

    /**
     * Light the crescent at a point. The whole of `trigger`'s old body, with
     * the origin passed in rather than derived — which is the entire mechanism
     * behind the Ash fireball: the blast is not a new effect, it is this one,
     * born where the carrier landed instead of at the caster's feet.
     * @param {number} ox @param {number} oz @param {number} nx @param {number} nz
     */
    _ignite(ox, oz, nx, nz) {
        const ctx = this.ctx;
        // A recast RESTARTS rather than stacking: two crescents from the same
        // point are one crescent with a seam in it.
        if (this.strand < 0) this.strand = ctx.water.acquire();
        if (this.strand < 0) return;

        this.dx = nx;
        this.dz = nz;
        // Born a little ahead of the feet, so the player is never inside it.
        this.ox = ox;
        this.oz = oz;
        this.t = 0;
        this.reach = 1.4;
        this._brushOwed = 0;
        this._sprayOwed = 0;
        this.active = true;

        // The detonation shell (vfx/burst.js) — the ignition IS the wave's
        // detonation, and in Ash this is exactly the fireball's landing.
        // Squashed to a ground dome; realm-tinted off the palette row.
        if (ctx.fx) {
            ctx.fx.burst.spawn(
                ox, ctx.terrain.heightAt(ox, oz) + 0.15, oz,
                3.4, 0.7, 0.55, ctx.realm
            );
        }
    }

    /**
     * Launch the Ash carrier: a fat, short-leashed bolt aimed to meet the
     * ground at `realm.waveThrowM`.
     *
     * `own = 1` marks it a CARRIER — `spellHits._bolt()` skips those entirely,
     * so the travel phase deals no damage and the Ash player is not charged
     * twice for one cast. It also makes `dart._terminate` skip the bolt's own
     * ground brush and camera trauma: the landing IS the crescent's cast, and
     * the crescent writes its own ground.
     * @param {number} nx @param {number} nz unit flat heading
     * @returns {boolean} true if a carrier is now in flight
     */
    _throw(nx, nz) {
        const ctx = this.ctx;
        const reach = ctx.realm.waveThrowM;
        ctx.handPosition(1, _hand, 0);

        // Aim to MEET the ground at `reach` metres out. There is no gravity in
        // the bolt pool (a ballistic primary is a different weapon), so the
        // arc has to be in the heading.
        const gy = ctx.terrain.heightAt(_hand[0] + nx * reach, _hand[2] + nz * reach);
        const dy = (gy + 0.05 - _hand[1]) / reach;
        const l = Math.hypot(nx, dy, nz) || 1;

        const slot = ctx.bolt.fire(
            _hand[0], _hand[1], _hand[2],
            nx / l, dy / l, nz / l,
            THROW_SPEED, reach * 1.6, 1, 2.2
        );
        if (slot < 0) return false;

        this._pendSlot = slot;
        this._pendGen = ctx.bolt.gen[slot];
        this._pendT = 0;
        this._pendAx = nx;
        this._pendAz = nz;
        return true;
    }

    /**
     * Poll the carrier. Detonates on the frame it dies — by ground contact, by
     * leash, or by the timeout backstop — at wherever it got to.
     * @param {number} dt
     */
    _pollThrow(dt) {
        const ctx = this.ctx;
        const b = ctx.bolt;
        const i = this._pendSlot;
        this._pendT += dt;

        const gone = !b || b.gen[i] !== this._pendGen || !b.alive[i];
        if (!gone && this._pendT < THROW_TIMEOUT) return;

        this._pendSlot = -1;
        const x = b ? b.x[i] : ctx.controller.position.x;
        const z = b ? b.z[i] : ctx.controller.position.z;
        this._ignite(x, z, this._pendAx, this._pendAz);
    }

    /** @param {number} dt */
    update(dt) {
        // BEFORE the active gate: a carrier in flight is a cast that has not
        // become a crescent yet, and the crescent is what sets `active`.
        if (this._pendSlot >= 0) this._pollThrow(dt);
        if (!this.active) return;
        const ctx = this.ctx;
        const water = ctx.water;
        const terrain = ctx.terrain;
        const s = this.strand;
        if (s < 0) {
            this.active = false;
            return;
        }

        this.t += dt;
        const life01 = this.t / LIFE;
        if (life01 >= 1) {
            this._end();
            return;
        }

        // Speed decays: the wave is launched, not driven. Twelve and a bit metres
        // a second down to a walking pace, which is what makes it read as
        // something that was thrown rather than something being pushed.
        const speed = 11.5 * Math.exp(-this.t * 1.15) + 1.2;
        const travelled = speed * dt;
        this.reach += travelled;

        // Rise fast, hold, fall. The fall is QUADRATIC, to exactly zero, so the
        // last frame of the wave is flat rather than a step.
        const rise = smooth01(this.t / 0.26);
        const fall = 1 - clamp01((life01 - 0.55) / 0.45);
        const env = rise * fall * fall;

        // A wave spreads as it runs: the arc opens up and the crest thins, so the
        // same mass covers more ground.
        const spread = clamp01((this.reach - 1.4) / 14);
        const arc = ARC0 + (ARC1 - ARC0) * spread;
        const height = PEAK * env / (1 + spread * 0.45);

        // Circle centre, one curvature radius behind the leading point.
        const kx = this.ox + this.dx * (this.reach - CURVE);
        const kz = this.oz + this.dz * (this.reach - CURVE);
        // The crest's own right, for the arc parametrisation. This is the 90-degree
        // rotation of (dx, dz) about +Y in the port's right-handed frame; which of
        // the two senses it is does not matter, because the arc runs symmetrically
        // from -arc to +arc and bell(u) is symmetric, so the crescent is identical
        // under a flip.
        const wx = this.dz;
        const wz = -this.dx;

        let px = 0, py = 0, pz = 0;
        for (let c = 0; c < COLS; c++) {
            const u = c / (COLS - 1);
            const th = (u - 0.5) * 2 * arc;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            // Outward radial at this angle: the direction the section faces, and
            // the direction the horn at that end of the crescent is running.
            const rx = this.dx * cs + wx * sn;
            const rz = this.dz * cs + wz * sn;

            const x = kx + rx * CURVE;
            const z = kz + rz * CURVE;
            // SUNK, so the base of the wall meets the trench floor it is cutting
            // rather than floating on the undisturbed surface.
            const y = terrain.heightAt(x, z) - 0.13;

            // Horns taper to nothing. The bell is on `u` rather than on the angle
            // so the two ends close symmetrically however wide the arc has opened,
            // and the sheet degenerates onto its own spine there instead of ending
            // on a cut edge.
            const amp = height * bell(u);

            // The crest curls harder in the middle, where the mass is. Pushed most
            // of the way to the section integral's plunging limit (0.48..0.95): at
            // the low end the sheet is a bank, and a bank lying on a dune field is
            // indistinguishable from the dune field. It has to hook over its own
            // face to read as a wave at all, and it hooks harder once it is up.
            const curl = 0.48 + 0.47 * bell(u) * (0.45 + 0.55 * rise);
            // Foam along the whole leading edge, heaviest at the centre.
            const foam = 0.30 + 0.45 * bell(u);

            // The right vector is the outward radial, FLAT (ry = 0), and `curl`
            // rides in the twist slot — for the SHEET profile that field is the
            // wakeSection curl parameter, not a section roll.
            water.column(
                s, c, x, y, z, amp,
                rx, 0, rz, curl,
                this.reach + u * 2.0, life01, foam, 1
            );

            if (c === (COLS >> 1)) { px = x; py = y; pz = z; }
        }

        // Slush: mostly water, with enough entrained snow to be opaque at the
        // crest. Cold is 0.48 — below about 0.4 it stops reading as slush and
        // starts reading as a glass sculpture; above about 0.6 the water
        // disappears entirely and it is just a snow berm that happens to be
        // moving. Sand (0.88) and Ash (0.80) deliberately live in that upper
        // band, because a dry-sand slipface and a pyroclastic front transmit
        // essentially nothing and SHOULD read as moving walls of material.
        const R = ctx.realm;
        water.setParams(s, PROFILE_SHEET, R.milk.sweep, clamp01(env * 1.4), COLS);

        // Light rides the middle of the crest, LOW, so it grazes the channel it is
        // cutting rather than lighting it from above. The realm multiplies the
        // rgb and the intensity: sand does not glow (x0.85), a pyroclastic
        // front is the brightest thing in the frame (x1.45).
        const L = R.light;
        ctx.lights.add(
            px, py + height * 0.55, pz,
            9.5, 0.42 * L.r, 0.74 * L.g, 1.0 * L.b, 13.0 * env * L.mult
        );

        this._plough(travelled, env);
        this._spray(travelled, env, height);
    }

    /**
     * The channel and its berms.
     *
     * Written per METRE TRAVELLED rather than per second, so the trench has the
     * same depth at any speed or frame rate: a patch of ground sits under the
     * brush for (2 * radius / travelled) frames, and the depth it ends at is
     * therefore independent of both.
     */
    _plough(travelled, env) {
        if (env < 0.05) return;
        const f = this.ctx.deform;
        if (!f) return;

        this._brushOwed += travelled;
        // One rank of brushes every 25 cm of advance. Denser than that just
        // re-cuts the same trench; sparser leaves it scalloped.
        if (this._brushOwed < 0.25) return;
        const k = Math.min(this._brushOwed, 0.7);   // a frame spike cannot gouge
        this._brushOwed = 0;

        const spread = clamp01((this.reach - 1.4) / 14);
        const arc = ARC0 + (ARC1 - ARC0) * spread;
        const N = 13;

        // Half a metre BEHIND the crest: the channel is what the wave has already
        // passed over, not what it is about to.
        const kx = this.ox + this.dx * (this.reach - 0.5 - CURVE);
        const kz = this.oz + this.dz * (this.reach - 0.5 - CURVE);
        const wx = this.dz;
        const wz = -this.dx;

        for (let i = 0; i < N; i++) {
            const u = i / (N - 1);
            const w = bell(u);
            if (w < 0.06) continue;
            const th = (u - 0.5) * 2 * arc;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const rx = this.dx * cs + wx * sn;
            const rz = this.dz * cs + wz * sn;

            const x = kx + rx * CURVE;
            const z = kz + rz * CURVE;

            // The brush's long axis runs ALONG the arc, so the trench is
            // continuous rather than a row of round pits.
            const yaw = Math.atan2(rz, -rx);

            f.brush(
                x, z,
                0.34,
                0.95 * k * env * w,   // channel
                0.62 * k * env * w,   // berms at the rim
                0.55 * k * env * w,   // slush packs what it runs over
                // ...and refreezes a little of it. The ICE channel is the one
                // brush argument that is genuinely realm-dependent: cold
                // glazes (1), sand sinters to glass (0.55), fire scorches and
                // glazes nothing at all (0).
                0.16 * k * env * w * this.ctx.realm.ice,
                yaw,
                2.2,
                0.9
            );
        }
    }

    /** Spray thrown forward and up off the FRONT of the crest. */
    _spray(travelled, env, height) {
        const ctx = this.ctx;
        const sp = ctx.spray;
        if (!sp || env < 0.08) return;

        const perMetre = 120 * ctx.sprayScale;
        this._sprayOwed += travelled;
        let count = (this._sprayOwed * perMetre) | 0;
        if (count <= 0) return;
        this._sprayOwed -= count / perMetre;
        if (count > 150) count = 150;

        const spread = clamp01((this.reach - 1.4) / 14);
        const arc = ARC0 + (ARC1 - ARC0) * spread;
        const terrain = ctx.terrain;
        const wx = this.dz;
        const wz = -this.dx;
        const kx = this.ox + this.dx * (this.reach - CURVE);
        const kz = this.oz + this.dz * (this.reach - CURVE);

        for (let k = 0; k < count; k++) {
            const u = rand();
            const w = bell(u);
            if (w < 0.12) continue;
            const th = (u - 0.5) * 2 * arc;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            const rx = this.dx * cs + wx * sn;
            const rz = this.dz * cs + wz * sn;

            const amp = height * w;
            // Slight bias OUTBOARD of the crest line.
            const d = CURVE + (rand() - 0.2) * 0.6;
            const x = kx + rx * d;
            const z = kz + rz * d;
            const y = terrain.heightAt(x, z) + amp * (0.55 + 0.6 * rand());

            const out = 1.4 + rand() * 3.2;
            // The realm decides how much of the veil is HARD-EDGED. Cold water
            // throws mostly droplets; grit and cinder are clods, which is what
            // makes the sand crest read as an airborne veil torn off the lip
            // and the ash crest as a shower of embers.
            const S = ctx.realm.spray;
            const clod = rand() < 0.2 + S.clodBias ? 1 : 0;
            sp.emit(
                x, y, z,
                rx * out + (rand() - 0.5) * 1.4,
                1.5 + rand() * 3.2 + amp * 1.6,   // a taller crest throws higher
                rz * out + (rand() - 0.5) * 1.4,
                (clod ? 0.022 + rand() * 0.024 : 0.050 + rand() * 0.075) * S.sizeMul,
                (clod ? 0.6 + rand() * 0.5 : 0.55 + rand() * 0.7) * S.lifeMul,
                clod,
                (clod ? 0.8 : 1.6 + rand() * 1.4) * S.grainDragMul
            );
        }
    }

    /**
     * Realm swap, per-object side. Nothing to migrate: every realm read in
     * this file is a LIVE read of `ctx.realm` in the frame that uses it, so a
     * crescent mid-flight re-skins on the next frame with no state to carry.
     * Present so `SpellSystem._writeRealm`'s uniform fan-out finds a hook here
     * if one is ever needed.
     */
    setRealm() {}

    _end() {
        this.active = false;
        if (this.strand >= 0) {
            this.ctx.water.release(this.strand);
            this.strand = -1;
        }
    }

    cancel() {
        // A carrier in flight is part of this cast and dies with it (§9.2:
        // a cancelled spell takes its volumes with it). The bolt pool's own
        // `cancel()` drops the projectile; this just forgets it, so the poll
        // does not detonate a crescent for a spell the player switched off.
        this._pendSlot = -1;
        this._end();
    }
}
