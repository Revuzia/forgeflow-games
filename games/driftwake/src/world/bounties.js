/**
 * BOUNTIES — named elites with a price on them (_spec/QUEST_DESIGN.md §3.3).
 * "Diablo IV / Destiny: bounties and a clear next thing to do at all times."
 *
 * WHO. Three per realm, straight from `STORY.bounties[realm]` (lane N's
 * roster: id 'bounty.<realm>.<1..3>', a real combatData ENEMIES `unit` of that
 * realm, a `name`, a `desc`). Names are read at runtime from STORY by id and
 * never duplicated here.
 *
 * WHAT MAKES ONE A BOUNTY (QUEST §3.3):
 *   - level: the level the realm's pack director would give that unit
 *     (`combatData.enemyLevelFor(realm, playerLevel, 0.5)` — a fixed NEUTRAL
 *     roll passed in, so its platform-RNG fallback never runs) PLUS 3,
 *     clamped to 30;
 *   - 2.5x the unit's HP at that level (the registry's hp and hpMax);
 *   - its STORY name on the registry slot (the overhead bar and the floaters
 *     read it), promoted to ELITE tier if its row is lighter (a named elite:
 *     elite CC resistance, elite XP, elite mote drop);
 *   - a unique tint per bounty, written into the mesh body's dress-up tint box
 *     (`meshEnemies` inst.tint + state[3] — the same channel MESH_REUSE
 *     dress-ups use), re-asserted every frame it lives because the body binds
 *     asynchronously when its mesh type is still streaming.
 *
 * WHERE. Each bounty haunts a landmark ("last seen near the Frozen Crest"):
 * a deterministic pick of the realm's 15 sites (hashed per bounty, distinct
 * per bounty, preferring sites 90 m clear of every Wake Trial gate so a fight
 * never lands on a surf line), stood 32 m off the monument on the first clear,
 * walkable bearing. It SPAWNS when the player comes within 80 m (QUEST §3.3),
 * emits 'bounty:revealed', and is silently despawned (full health again on
 * return) if the player leaves it 300 m behind.
 *
 * REWARD (QUEST §3.3): 40 Wake Glass (a 'reward' event — credited by the
 * rewards lane's listener, never here), objective XP = 15% of the current
 * level's XP_to_next (PROGRESSION §3.5 — granted HERE through
 * `progression.addXP`, and announced as a 'reward' of kind 'xp' with
 * `granted: true` so no listener pays it twice), and the realm's THIRD bounty
 * drops the realm's fourth relic. Killed bounties stay dead — persisted.
 *
 * KILL DETECTION: the 'enemy:killed' bus event progression.js emits (the one
 * place the registry kill ring becomes bus events), with an hp<=0 poll as a
 * backstop. This module also installs `progression.bountyOf(id)` so that
 * event's `bounty` field names the bounty.
 *
 * SAVE: 'quest.bounties' → `{ <bountyId>: true }` (QUEST §8).
 *
 * No draw calls of its own — a bounty is a real enemy body.
 * Steady-frame allocation: none.
 */

import { REALM_ORDER, realmToken } from "./realms.js";
import { gradeAt } from "./shrine.js";
import { STORY } from "../quests/storyText.js";
import { bus as coreBus } from "../quests/events.js";
import { TIER } from "../combat/damageable.js";
import * as combatData from "../combat/combatData.js";
import { hash3, relicFor, landmarkClearance } from "./caches.js";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const BOUNTIES_PER_REALM = 3;
/** QUEST §3.3. */
export const REVEAL_R = 80;
export const LEVEL_BONUS = 3;
export const HP_MULT = 2.5;
const GLASS = 40;
const XP_FRAC = 0.15;
/** Leave it this far behind and it goes back to waiting (full HP). */
const FORGET_R = 300;
/** Stand-off from the monument, m, and the clearances around the spot. */
const STAND_OFF = [32, 26, 40, 20, 48];
const BEARINGS = 12;
const PRISM_CLEAR = 8;
const CACHE_CLEAR = 15;
const TRIAL_CLEAR = 40;
const TRIAL_SITE_CLEAR = 90;
const MAX_GRADE = 0.35;
const PLAY_R = 520;
/** Frames after a realm swap before siting (caches + trials go first). */
const SITE_WAIT = 8;
/** Seconds between spawn retries when the enemy pool is full. */
const RETRY_S = 1.0;

/** Unique tint per bounty (albedo multiplier, meshEnemies TINT convention). */
const TINTS = {
    "bounty.cold.1": [0.72, 0.62, 1.45],     // Frostfang: starved violet
    "bounty.cold.2": [0.45, 1.15, 1.30],     // Hollowdrift: under-powder teal
    "bounty.cold.3": [1.30, 1.18, 0.78],     // Old Hoarback: old rime, yellowed
    "bounty.sand.1": [1.45, 0.62, 0.48],     // Kesh: rust red
    "bounty.sand.2": [0.62, 1.20, 0.80],     // the Steward: verdigris
    "bounty.sand.3": [1.30, 1.28, 1.40],     // the Oathbone Knight: bleached
    "bounty.ash.1": [1.55, 0.95, 0.42],      // Emberheel: burning orange
    "bounty.ash.2": [0.55, 0.52, 0.78],      // the Soot Widow: soot violet
    "bounty.ash.3": [1.65, 0.50, 0.32],      // Slagmaw: molten red
};
const TINT_MIX = 0.85;

/* ------------------------------------------------------------------ *
 * The system
 * ------------------------------------------------------------------ */

export class Bounties {
    /**
     * @param {object} ctx meaning-layer context: terrain, landmarks,
     *   character, enemies + registry (or combat.{enemies, registry}),
     *   progression, bus, getRealm; optionally `caches` and `trials` (the
     *   sites keep clear of them when present).
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.terrain = ctx.terrain;
        this.landmarks = ctx.landmarks;
        this.character = ctx.character;
        this.enemies = ctx.enemies || (ctx.combat && ctx.combat.enemies) || null;
        this.registry = ctx.registry || (ctx.combat && ctx.combat.registry) || null;
        this.bus = ctx.bus || coreBus;
        this.progression = ctx.progression || null;
        if (!this.enemies || !this.registry) {
            throw new Error("bounties.js: ctx needs enemies and registry");
        }

        this.realm = realmToken(ctx.getRealm ? ctx.getRealm() : "cold");
        this.readyRealm = null;

        // ---- live-realm slots (index k = 0..2)
        this.sx = new Float32Array(BOUNTIES_PER_REALM);
        this.sz = new Float32Array(BOUNTIES_PER_REALM);
        this.place = ["", "", ""];
        /** Registry id of each bounty's live body, -1 = not spawned. */
        this.liveId = new Int32Array(BOUNTIES_PER_REALM).fill(-1);
        /** Registry id of the body each bounty DIED in — so `bountyFor` still
         *  names it if the hp poll saw the kill before progression's drain
         *  emitted 'enemy:killed' (frame-order independent). */
        this._deadId = new Int32Array(BOUNTIES_PER_REALM).fill(-1);
        this._retry = new Float32Array(BOUNTIES_PER_REALM);
        /** Per-realm remembered sites for list(). */
        this._sites = { cold: null, sand: null, ash: null };
        /** Persisted: killed bounty ids. */
        this.killed = {};
        this._wait = 0;
        this.stats = { spawned: 0, killed: 0, despawned: 0, sited: 0 };

        // ---- kill feed
        this._offKill = this.bus.on("enemy:killed", (p) => {
            if (!p) return;
            for (let k = 0; k < BOUNTIES_PER_REALM; k++) {
                if (this.liveId[k] >= 0 && this.liveId[k] === p.id) this._onKilled(k);
            }
        });
        // progression.js fills 'enemy:killed'.bounty through this hook.
        const P = this.progression;
        if (P && typeof P.bountyOf !== "function") P.bountyOf = (id) => this.bountyFor(id);

        // ---- save
        this._unregister = null;
        if (P && typeof P.registerSaveSection === "function") {
            this._unregister = P.registerSaveSection("quest.bounties", {
                serialize: () => {
                    const out = {};
                    for (const id in this.killed) if (this.killed[id]) out[id] = true;
                    return out;
                },
                deserialize: (v) => {
                    this.killed = {};
                    if (v && typeof v === "object") {
                        for (const id in v) if (v[id] === true) this.killed[id] = true;
                    }
                    // A reload/new run must not leave a stale body standing.
                    for (let k = 0; k < BOUNTIES_PER_REALM; k++) {
                        const def = this._def(k);
                        if (def && this.killed[def.id] && this.liveId[k] >= 0) {
                            this.enemies.despawn(this.liveId[k]);
                            this.liveId[k] = -1;
                        }
                    }
                },
            });
        } else {
            console.warn("bounties.js: progression.registerSaveSection missing — " +
                "killed bounties will not persist");
        }

        this.setRealm(this.realm);
    }

    /* -------------------------------------------------------------- *
     * Public API
     * -------------------------------------------------------------- */

    /** Realm swap (enterRealm hook). @param {string} token */
    setRealm(token) {
        for (let k = 0; k < BOUNTIES_PER_REALM; k++) {
            // enterRealm's `enemies.clear()` usually beat us to it; harmless.
            if (this.liveId[k] >= 0) this.enemies.despawn(this.liveId[k]);
            this.liveId[k] = -1;
            this._retry[k] = 0;
        }
        this.realm = realmToken(token);
        this.readyRealm = null;
        this._wait = SITE_WAIT;
    }

    /** Which bounty a registry id is, or null (the `progression.bountyOf`
     *  hook). @param {number} id @returns {string|null} */
    bountyFor(id) {
        if (!(id >= 0)) return null;
        for (let k = 0; k < BOUNTIES_PER_REALM; k++) {
            if (this.liveId[k] === id || this._deadId[k] === id) {
                const def = this._def(k);
                return def ? def.id : null;
            }
        }
        return null;
    }

    /** Is a bounty dead for good? @param {string} id */
    isKilled(id) { return !!this.killed[id]; }

    /**
     * The bounty board (journal / map). Allocates.
     * @param {string} [realm]
     */
    list(realm) {
        const t = realmToken(realm || this.realm);
        const defs = STORY.bounties[t] || [];
        const sites = this._sites[t];
        const out = [];
        for (let k = 0; k < defs.length; k++) {
            const d = defs[k];
            const s = sites ? sites[k] : null;
            out.push({
                id: d.id, name: d.name, desc: d.desc, unit: d.unit,
                place: s ? s.place : "",
                lastSeen: s ? STORY.trackers.bountyLastSeen.text.replace("{place}", s.place) : "",
                x: s ? s.x : null, z: s ? s.z : null,
                killed: !!this.killed[d.id],
                live: t === this.realm && this.liveId[k] >= 0,
                relic: k === 2 ? (relicFor(t, "bounty") || {}).id || null : null,
            });
        }
        return out;
    }

    get draws() { return 0; }

    /* -------------------------------------------------------------- *
     * Frame
     * -------------------------------------------------------------- */

    /** @param {number} dt @returns {void} */
    update(dt) {
        if (dt === 0) return;
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
            if (this._wait > 0) this._wait--;
            else if (this._sitable()) this._site();
            if (this.readyRealm !== this.realm) return;
        }

        const p = this.character.position;
        const reg = this.registry;
        const dead = this.progression && this.progression.dead;
        for (let k = 0; k < BOUNTIES_PER_REALM; k++) {
            const def = this._def(k);
            if (!def || this.killed[def.id]) continue;
            const dx = p.x - this.sx[k], dz = p.z - this.sz[k];
            const d2 = dx * dx + dz * dz;
            const id = this.liveId[k];
            if (id < 0) {
                if (this._retry[k] > 0) { this._retry[k] -= dt; continue; }
                if (!dead && d2 < REVEAL_R * REVEAL_R) this._spawn(k, def);
                continue;
            }
            const s = reg.slot(id);
            if (s < 0) {
                // Removed without a kill (realm sweep, director clear): it
                // goes back to waiting at its site.
                this.liveId[k] = -1;
                this.stats.despawned++;
                continue;
            }
            if (reg.hp[s] <= 0) { this._onKilled(k); continue; }
            if (d2 > FORGET_R * FORGET_R) {
                this.enemies.despawn(id);
                this.liveId[k] = -1;
                this.stats.despawned++;
                continue;
            }
            this._applyTint(id, def.id);
        }
    }

    /* -------------------------------------------------------------- *
     * Internals
     * -------------------------------------------------------------- */

    /** @param {number} k */
    _def(k) {
        const a = STORY.bounties[this.realm];
        return a ? a[k] || null : null;
    }

    _sitable() {
        if (this.landmarks && this.landmarks._regroundIn > 0) return false;
        const cs = this.ctx.caches, tr = this.ctx.trials;
        if (cs && cs.readyRealm !== this.realm) return false;
        if (tr && tr.readyRealm !== this.realm) return false;
        return true;
    }

    /** Choose the live realm's three sites. Event-scoped; allocates. */
    _site() {
        const t = this.realm;
        const ri = REALM_ORDER.indexOf(t);
        const inst = (this.landmarks.instances || []).filter((s) => s.realm === t);
        const trials = this.ctx.trials && this.ctx.trials.readyRealm === t
            ? this.ctx.trials.trials : [];
        const cs = this.ctx.caches && this.ctx.caches.readyRealm === t ? this.ctx.caches : null;
        const T = this.terrain;
        const used = new Set();
        /** Landmark LABELS already haunted — "last seen near the Rime Circle"
         *  twice on one board reads as a bug, so passes 0-1 want a new name. */
        const usedLabel = new Set();
        const sites = [];

        const nearTrial = (x, z, r) => {
            for (let i = 0; i < trials.length; i++) {
                const L = trials[i];
                for (let g = 0; g < L.n; g++) {
                    const dx = x - L.gx[g], dz = z - L.gz[g];
                    if (dx * dx + dz * dz < r * r) return true;
                }
            }
            return false;
        };
        const spotOK = (li, si, x, z) => {
            if (Math.hypot(x, z) > PLAY_R) return false;
            if (T.edge01 && T.edge01(x, z) > 0) return false;
            if (gradeAt(T, x, z) > MAX_GRADE) return false;
            if (landmarkClearance(this.landmarks, li, T, x, z) < PRISM_CLEAR) return false;
            if (cs) {
                for (let s = 0; s < cs.x.length; s++) {
                    if (Math.hypot(x - cs.x[s], z - cs.z[s]) < CACHE_CLEAR) return false;
                }
            }
            if (nearTrial(x, z, TRIAL_CLEAR)) return false;
            void si;
            return true;
        };

        for (let k = 0; k < BOUNTIES_PER_REALM; k++) {
            const order = [];
            for (let s = 0; s < inst.length; s++) order.push(s);
            order.sort((a, b) => hash3(a, ri, 300 + k) - hash3(b, ri, 300 + k));
            let got = null;
            // Pass 0: a landmark name not yet on the board, far from every
            // trial line. Pass 1: new name, any distance. Pass 2: anything.
            for (let pass = 0; pass < 3 && !got; pass++) {
                for (let n = 0; n < order.length && !got; n++) {
                    const si = order[n];
                    if (used.has(si)) continue;
                    const li = inst[si];
                    if (pass < 2 && usedLabel.has(li.label)) continue;
                    if (pass === 0 && nearTrial(li.x, li.z, TRIAL_SITE_CLEAR)) continue;
                    const a0 = hash3(si, ri, 1777 + k) * Math.PI * 2;
                    for (let r = 0; r < STAND_OFF.length && !got; r++) {
                        for (let b = 0; b < BEARINGS; b++) {
                            const a = a0 + b * (Math.PI * 2 / BEARINGS);
                            const x = li.x + Math.cos(a) * STAND_OFF[r];
                            const z = li.z + Math.sin(a) * STAND_OFF[r];
                            if (spotOK(li, si, x, z)) {
                                got = { x, z, place: li.label, site: si };
                                break;
                            }
                        }
                    }
                    if (got) { used.add(si); usedLabel.add(li.label); }
                }
            }
            if (!got) {
                console.error("bounties.js: no site for bounty " + k + " in " + t +
                    " — standing it at the first landmark");
                const li = inst[k] || { x: 200, z: 0, label: "" };
                got = { x: li.x + 32, z: li.z, place: li.label, site: -1 };
            }
            sites.push(got);
            this.sx[k] = got.x;
            this.sz[k] = got.z;
            this.place[k] = got.place;
        }
        this._sites[t] = sites;
        this.readyRealm = t;
        this.stats.sited++;
    }

    /** Spawn bounty k's body. @param {number} k @param {any} def */
    _spawn(k, def) {
        const en = this.enemies, reg = this.registry;
        if (en.unitIndex && en.unitIndex(def.unit) < 0) {
            console.error("bounties.js: unknown unit '" + def.unit + "' for " + def.id);
            this._retry[k] = 1e9;
            return;
        }
        const P = this.progression;
        const pl = P && typeof P.level === "number" ? P.level : 1;
        let base = pl;
        try {
            // Neutral roll (0.5): the director's own level, deterministic —
            // a null roll would fall back to the platform RNG (combatData:860).
            base = combatData.enemyLevelFor(this.realm, pl, 0.5);
        } catch (e) { /* band table missing: the player's level */ }
        const level = Math.max(1, Math.min(30, (base | 0) + LEVEL_BONUS));
        const id = en.spawn(def.unit, this.sx[k], this.sz[k], level);
        if (id < 0) { this._retry[k] = RETRY_S; return; }
        const s = reg.slot(id);
        if (s >= 0) {
            reg.hpMax[s] = reg.hpMax[s] * HP_MULT;
            reg.hp[s] = reg.hpMax[s];
            reg.name[s] = def.name;
            if (reg.tier[s] < TIER.ELITE) reg.tier[s] = TIER.ELITE;
        }
        this.liveId[k] = id;
        this.stats.spawned++;
        this._applyTint(id, def.id);
        this.bus.emit("bounty:revealed", {
            id: def.id, realm: this.realm, x: this.sx[k], z: this.sz[k],
            name: def.name, unit: def.unit, level, registryId: id,
        });
    }

    /** Write the bounty's tint into its mesh body (no allocation). */
    _applyTint(id, bid) {
        const en = this.enemies;
        const vis = en.vis;
        if (!vis) return;
        const tint = TINTS[bid];
        if (!tint) return;
        for (let i = 0; i < en.id.length; i++) {
            if (!en.alive[i] || en.id[i] !== id) continue;
            if (typeof vis.setTint === "function") {
                vis.setTint(i, tint[0], tint[1], tint[2], TINT_MIX);
                return;
            }
            const inst = vis._slotInst ? vis._slotInst[i] : null;
            if (inst && inst.tint && inst.state) {
                inst.tint[0] = tint[0]; inst.tint[1] = tint[1]; inst.tint[2] = tint[2];
                inst.state[3] = TINT_MIX;
            }
            return;
        }
    }

    /** Bounty k is dead: persist, announce, pay. @param {number} k */
    _onKilled(k) {
        const def = this._def(k);
        const id = this.liveId[k];
        this.liveId[k] = -1;
        this._deadId[k] = id;
        if (!def || this.killed[def.id]) return;
        this.killed[def.id] = true;
        this.stats.killed++;
        const bus = this.bus;
        bus.emit("bounty:killed", {
            id: def.id, realm: this.realm, name: def.name,
            x: this.sx[k], z: this.sz[k], registryId: id,
        });
        bus.emit("reward", {
            kind: "glass", id: "glass", name: "Wake Glass",
            desc: "Bounty — " + def.name, amount: GLASS, source: "bounty",
        });
        const P = this.progression;
        if (P && typeof P.addXP === "function") {
            const need = typeof P._need === "function" ? P._need() : (P.xpNeed || 0);
            const xp = Math.round(XP_FRAC * need);
            if (xp > 0) {
                P.addXP(xp, "bounty");
                bus.emit("reward", {
                    kind: "xp", id: "xp", name: "Experience", desc: "Bounty — " + def.name,
                    amount: xp, source: "bounty", granted: true,
                });
            }
        }
        if (k === 2) {
            const r = relicFor(this.realm, "bounty");
            if (r) {
                bus.emit("reward", {
                    kind: "relic", id: r.id, name: r.name, desc: r.effect,
                    amount: 1, source: "bounty", realm: this.realm,
                });
            }
        }
        if (P && P.save) P.save();
    }

    dispose() {
        if (this._offKill) this._offKill();
        if (this._unregister) this._unregister();
    }
}
