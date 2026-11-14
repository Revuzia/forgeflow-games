/**
 * TAB targeting — the classic MMO/ARPG cycle (owner 2026-08-06).
 *
 * TAB selects the nearest valid enemy. TAB again steps to the next nearest,
 * and so on outward. TAB on the LAST enemy of the cycle DROPS the target —
 * one press of empty selection — and the press after that starts the cycle
 * over from the nearest. So with three enemies the sequence is:
 *
 *     TAB -> A(nearest)  TAB -> B  TAB -> C  TAB -> (none)  TAB -> A ...
 *
 * The order is a DISTANCE SNAPSHOT taken when the cycle begins, not a live
 * re-sort: re-sorting every press makes the cycle jump around as enemies
 * move (press TAB twice and land back on the same body), which is exactly
 * the bug every "closest enemy" implementation ships first. The snapshot is
 * rebuilt when the cycle restarts, when its membership changes (something
 * died, spawned into range, or left range), or after IDLE_DROP_S with no
 * press.
 *
 * A target also drops itself when it dies, is removed, or leaves RANGE_M —
 * the "drop off" the owner asked for applies to the target going away, not
 * only to the end of the cycle.
 *
 * POLLED, not subscribed: `update()` reads the one-frame `input.targetCycle`
 * edge (cleared by `endFrame()`, same contract as `spellPressed`). Sorting
 * touches at most `count` bodies and only on a press. Allocation-free in a
 * steady frame — every buffer is preallocated.
 *
 * Consumers: `ui/enemybars.js` (persistent bar + target frame),
 * `ui/minimap.js` (the target pip), and later the soft-aim assist. Read
 * `targeting.targetId` (-1 = nothing selected).
 */

import { input } from "../core/input.js";

/** Only enemies inside this radius can be cycled (spec §1.1 bolt reach). */
const RANGE_M = 40;
/** A cycle this stale restarts from the nearest on the next press. */
const IDLE_DROP_S = 12;

export class Targeting {
    /**
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     */
    constructor(registry, controller) {
        this.registry = registry;
        this.controller = controller;

        /** Selected registry id, or -1 for nothing. */
        this.targetId = -1;
        /** True on the frame the selection changed (UI ping hook). */
        this.changed = false;

        const cap = registry.x.length;
        /** The cycle snapshot: ids in ascending distance order. */
        this._order = new Int32Array(cap);
        this._orderN = 0;
        /** Index INTO `_order` of the current target; -1 = none/pre-cycle. */
        this._index = -1;
        /** Registry time of the last TAB press — drives the idle restart. */
        this._lastPress = -999;
        /** Scratch for the sort: distances parallel to `_order`. */
        this._dist = new Float32Array(cap);
    }

    /**
     * @param {number} dt unused; kept for the uniform system signature
     * @returns {void}
     */
    update(dt) {
        const reg = this.registry;
        this.changed = false;

        // ---- 1. the live target must stay valid -------------------------
        if (this.targetId >= 0) {
            const s = reg.slot(this.targetId);
            if (s < 0 || reg.hp[s] <= 0 || this._dist2To(s) > RANGE_M * RANGE_M) {
                this.targetId = -1;
                this._index = -1;
                this.changed = true;
            }
        }

        if (!input.targetCycle) return;

        // ---- 2. TAB pressed ---------------------------------------------
        const stale = reg.time - this._lastPress > IDLE_DROP_S;
        this._lastPress = reg.time;

        // Rebuild the snapshot when the cycle is fresh, stale, or its
        // membership no longer matches what is actually targetable.
        if (this._index < 0 || stale || !this._orderStillValid()) {
            this._rebuild();
            // A rebuild mid-cycle keeps the current body if it survived, so
            // the next press advances from where the player actually is.
            this._index = this.targetId >= 0 ? this._indexOf(this.targetId) : -1;
        }

        if (this._orderN === 0) {
            if (this.targetId !== -1) this.changed = true;
            this.targetId = -1;
            this._index = -1;
            return;
        }

        // Advance. Past the last entry is the DROP step: one press of empty
        // selection before the cycle wraps to the nearest again.
        const next = this._index + 1;
        if (next >= this._orderN) {
            this.targetId = -1;
            this._index = -1;             // next press starts over at nearest
            this.changed = true;
            return;
        }
        this.targetId = this._order[next];
        this._index = next;
        this.changed = true;
    }

    /** Clear the selection (death, realm change, menu). @returns {void} */
    clear() {
        if (this.targetId !== -1) this.changed = true;
        this.targetId = -1;
        this._index = -1;
    }

    // ------------------------------------------------------------ internals

    /** Squared distance from the player to a slot's body. */
    _dist2To(slot) {
        const reg = this.registry;
        const p = this.controller.position;
        const dx = reg.x[slot] - p.x;
        const dz = reg.z[slot] - p.z;
        return dx * dx + dz * dz;
    }

    /** Targetable = a live enemy or boss inside RANGE_M. The training dummies
     *  were removed (owner 2026-08-10 — real enemies only), so "dummy" no
     *  longer cycles even if some registrant still claims the kind. */
    _targetable(slot) {
        const reg = this.registry;
        if (reg.hp[slot] <= 0) return false;
        const k = reg.kind[slot];
        if (k !== "enemy" && k !== "boss") return false;
        return this._dist2To(slot) <= RANGE_M * RANGE_M;
    }

    /** Rebuild `_order` as ids sorted by ascending distance (insertion sort:
     *  n is single digits in practice and it is allocation-free). */
    _rebuild() {
        const reg = this.registry;
        let n = 0;
        for (let s = 0; s < reg.count; s++) {
            if (!this._targetable(s)) continue;
            const d = this._dist2To(s);
            let j = n - 1;
            while (j >= 0 && this._dist[j] > d) {
                this._dist[j + 1] = this._dist[j];
                this._order[j + 1] = this._order[j];
                j--;
            }
            this._dist[j + 1] = d;
            this._order[j + 1] = reg.idOf[s];
            n++;
        }
        this._orderN = n;
    }

    /** Does the snapshot still describe the targetable set? (membership only —
     *  distance order is deliberately frozen for the cycle's lifetime). */
    _orderStillValid() {
        const reg = this.registry;
        let live = 0;
        for (let s = 0; s < reg.count; s++) if (this._targetable(s)) live++;
        if (live !== this._orderN) return false;
        for (let i = 0; i < this._orderN; i++) {
            const s = reg.slot(this._order[i]);
            if (s < 0 || !this._targetable(s)) return false;
        }
        return true;
    }

    /** @param {number} id @returns {number} index in `_order`, or -1 */
    _indexOf(id) {
        for (let i = 0; i < this._orderN; i++) {
            if (this._order[i] === id) return i;
        }
        return -1;
    }
}
