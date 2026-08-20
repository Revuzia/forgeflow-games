/**
 * Boss encounters — the ARENA director (owner 2026-08-16: "we have a mini boss
 * and a main boss in each realm, it should be a real encounter. Mini boss at
 * level 6+, main realm boss at 8+. Once the realm boss dies, a portal opens for
 * the next realm").
 *
 * This is the second director. `combat/encounters.js` keeps the roaming player
 * supplied with ambient PACKS; this file runs at most ONE boss EVENT at a time
 * and owns everything about it: where the arena is, when the boss emerges, its
 * two phases, its leash, its death, and the realm portal that death opens
 * (`world/portal.js`).
 *
 * THE EVENT, END TO END
 *   1. ELIGIBLE  — band-clamped player level >= 6 (mini) / >= 8 (realm boss),
 *      that realm's boss of that kind not already killed this run. The mini
 *      boss is always offered first: it is the realm's mid-gate.
 *   2. PENDING   — an arena spot is chosen 60-90 m along the travel bearing,
 *      scored for LOCAL FLATNESS with the same grade instrument the shrine
 *      network nudges on (`world/shrine.js` exports `gradeAt`, imported here
 *      rather than re-derived), clear of every shrine and inside the play
 *      radius. Nothing is spawned yet — the arena is a marked place.
 *   3. LIVE      — the player walks within 45 m and the boss EMERGES: a
 *      shockwave ring + a powder burst through the existing pools, the low
 *      detonate cue, and the bottom-centre boss bar lights up with its name
 *      (ui/enemybars.js shows any registry body of kind "boss" from first
 *      sight — the arena variant registers as one, so the bar is free).
 *   4. PHASE 2   — at the phase threshold the boss opens the REST of its own
 *      damage table and gains +15% move speed.
 *   5. LEASH     — dragged more than 30 m from the arena, it disengages,
 *      re-seats at the arena and regenerates 20% of its max HP.
 *   6. DEAD      — flagged in `progression.bossesKilled` (never re-fires this
 *      run) and, for a REALM boss, the portal rises at the arena.
 *
 * NUMBERS AND WHERE THEY COME FROM (nothing here is invented):
 *   level gates 6 / 8, arena 60-90 m, leash 30 m, leash regen 20%, phase-2
 *   floor 55% HP, phase-2 speed +15%   — owner directive 2026-08-16.
 *   boss identity, arena HP, arena stance                — `combat/roster.js`
 *      rows (`bossKind` / `bossName` / `arenaHp` / `arenaStance`), which are
 *      _spec/COMBAT_DESIGN.md §2.4's field-vs-boss variant table as the
 *      mesh-anchored board resolved it.
 *   phase threshold                    — `combatData.BOSSES[].phasePct[0]`
 *      where the row states one, floored by the owner's 55%: the boss enters
 *      phase 2 at `max(rowPct, 55)`% so a row that escalates EARLIER (Warden
 *      70%, Plate Knight 65%, Furnace 60%) keeps its own beat and a row that
 *      escalates later (Gatekeeper 50%) meets the owner's floor. Rows with no
 *      phasePct (Icewall has no BOSSES row; the Shrinebreaker is core-gated)
 *      take the 55% floor.
 *   boss LEVEL                         — `combatData.BOSSES[].fixedLevel` when
 *      the row fixes one (§7 capstones), else `data.enemyLevelFor(realm, L,
 *      roll, "boss"|"miniboss")` — the same band table the pack director uses.
 *
 * WHAT "PHASE 2 OPENS THE SECOND PATTERN" MEANS, EXACTLY. A unit's usable
 * attacks are the damage-table entries that state a damage number (three of
 * the six boss rows deliberately state `dmg: null` for their signature
 * attacks, and inventing numbers for them is precisely what this codebase
 * forbids). Phase 1 therefore runs the FIRST HALF of the row's usable entries
 * (`ceil(n/2)`, minimum one) and phase 2 restores the row's full mask. Nothing
 * new is authored; the fight simply does not show you its whole hand at once.
 * Where a row has only one usable entry (Volcanic Plate Knight), phase 2 is
 * speed-only and `stats.patternOpened` reports 0 rather than pretending.
 *
 * THE ARENA VARIANT IS A CLONE, NOT A MUTATION. `combat/enemies.js` builds one
 * shared unit record per roster key; the field Glacier Brute in an ambient
 * "Glacier Line" pack and the arena Icewall are the same record. Rather than
 * mutate it (which would hand every ambient brute the boss's HP, tier and
 * phase-2 speed), this file pushes ONE clone per boss identity onto
 * `enemies.units` — cached, so a session creates at most six — carrying the
 * §2.4 arena numbers (`hp` = arenaHp, `poise` = arenaStance, `tier` = BOSS,
 * name = the boss's own) and its own `aUsable` mask. `enemies.spawn()` accepts
 * a unit INDEX, so the clone spawns through the public contract with no edit
 * to the enemy runtime. Clones are marked `bossVariant: true`.
 *   RECOMMENDED (enemies.js owner): a first-class `enemies.spawnVariant(key,
 *   overrides, x, z, level)` would retire the clone push entirely.
 *
 * ALLOCATION: none in a steady frame. Arena scoring, clone creation and the
 * emergence burst are event edges. No `Math.random` anywhere — the arena
 * bearing/distance wheel is a hashed integer sequence, so two runs of the same
 * probe pick the same arena.
 *
 * TEST API (console: SNOWFLOW.combat.bosses.…):
 *   spawnBoss("mini"|"realm")  force this realm's event NOW at the arena spot
 *                              (bypasses the level gate and the killed flags;
 *                              still honours flatness/shrine/play-area rules)
 *   clearBoss()                despawn the live boss, close the portal
 *   stats                      the whole event state, for probes
 */

import { TIER } from "./damageable.js";
import { BOSSES } from "./combatData.js";
import { ROSTER } from "./roster.js";
import { gradeAt } from "../world/shrine.js";
import { PLAY_RADIUS } from "../terrain/terrain.js";
import { sfx } from "../audio/sfx.js";

/** TEST mode's effective level: opens the mini boss (6) and the realm boss (8) at once for a
 *  testing session (owner 2026-08-16). */
const TEST_LEVEL = 10;

// ------------------------------------------------------------- owner numbers
/** Band-clamped player level that arms each event (owner 2026-08-16). */
const MINI_LEVEL = 6;
const REALM_LEVEL = 8;
/** The arena lands this far along the travel bearing (owner). */
const ARENA_MIN = 60;
const ARENA_MAX = 90;
/** The boss emerges when the player closes to this (impl choice: inside the
 *  55-80 m pack band, so the arena reads as "the next thing ahead"). */
const EMERGE_M = 45;
/** Arena leash: past this from the arena centre the boss disengages (owner).
 *  §7's authored arenas are 25-40 m CLOSED spaces; this open-world event
 *  approximates them with the owner's 30 m tether. */
const LEASH_M = 30;
/** Fraction of max HP a leashed boss regenerates on re-seating (owner). */
const LEASH_REGEN = 0.20;
/** Phase-2 HP fraction floor, and the speed it gains (owner). */
const PHASE2_FLOOR = 0.55;
const PHASE2_SPEED = 1.15;
/** Walking within this of the portal enters the next realm (owner). */
const PORTAL_ENTER_M = 2.5;

// --------------------------------------------------------- impl constants
/** Realm band floors — the same table encounters.js gates against. */
const REALM_FLOOR = { cold: 1, sand: 8, ash: 18 };
/** Realm ring: cold -> sand -> ash -> cold (owner). */
const NEXT_REALM = { cold: "sand", sand: "ash", ash: "cold" };
/** First arena attempt this long after a realm settles, then retry cadence. */
const FIRST_TRY_S = 6;
const RETRY_S = 4;
/** Arena candidates scored per attempt, and the bearing spread they span. */
const ARENA_TRIES = 6;
const ARENA_SPREAD = 1.4;          // rad, +-80 deg around travel
/** Flatness scan: mean |grade| over the centre + four points at this radius. */
const FLAT_R = 8;
/** A candidate this steep is only accepted if nothing flatter was found. */
const FLAT_MAX = 0.35;
/** Arena keeps this clear of any shrine, and of the play-area edge. */
const SHRINE_CLEAR = 45;
const EDGE_PAD = 50;
/** The pending arena is re-picked if the player strays this far from it. */
const REPICK_M = 160;
/** Emergence burst: grains and ring radius. */
const BURST_GRAINS = 28;
const BURST_RING_M = 7;

/**
 * The six boss identities, keyed by realm and kind, read straight off the
 * roster rows. Built once at module load; deterministic (ROSTER iterates in
 * MESH declaration order, and the FIRST row of a kind in a realm wins).
 * @type {Record<string, {mini: object|null, realm: object|null}>}
 */
const BOSS_BY_REALM = { cold: { mini: null, realm: null },
    sand: { mini: null, realm: null }, ash: { mini: null, realm: null } };
for (const slug in ROSTER) {
    const r = ROSTER[slug];
    if (!r.bossKind || r.bossKind === "none") continue;
    const kind = r.bossKind === "realm_boss" ? "realm" : "mini";
    const bucket = BOSS_BY_REALM[r.realm];
    if (!bucket || bucket[kind]) continue;
    bucket[kind] = r;
}

/** BOSSES rows by key, for phase thresholds and fixed levels. */
const BOSS_ROW = Object.create(null);
for (let i = 0; i < BOSSES.length; i++) BOSS_ROW[BOSSES[i].key] = BOSSES[i];

/**
 * Display name for the bar: the roster's `bossName` up to its parenthetical.
 * "The Icewall (field 520 → arena 1200)" -> "The Icewall". Derivation, not a
 * new authored string.
 * @param {object} row roster row @returns {string}
 */
function bossTitle(row) {
    const n = row.bossName || row.name || "Boss";
    const cut = n.indexOf(" (");
    return (cut > 0 ? n.slice(0, cut) : n).trim();
}

/** Hashed 0..1 from an integer — the deterministic stand-in for Math.random
 *  on every choice this director makes. @param {number} n @returns {number} */
function hash01(n) {
    const h = Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0;
    return ((h >>> 8) & 0xffff) / 65535;
}

export class BossEncounters {
    /**
     * @param {{spawn:(key:string|number,x:number,z:number,level:number)=>number,
     *          despawn:(id:number)=>void, units:object[],
     *          unitIndex:(k:string|number)=>number, vis?:object}} enemies
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {{enemyLevelFor:(realm:string,pl:number,roll?:number,kind?:string)=>number}} data
     * @param {{heightAt:(x:number,z:number)=>number}} terrain
     * @param {{spray?:object, shockwave?:object}} [fx] existing pools, used
     *   read-only through their public `emit`/`spawn` entry points
     */
    constructor(enemies, registry, controller, data, terrain, fx) {
        this.enemies = enemies;
        this.registry = registry;
        this.controller = controller;
        this.data = data;
        this.terrain = terrain;
        this.fx = fx || null;

        /** Active realm — main.js's enterRealm hook keeps this in step. */
        this.realm = "cold";
        /** Fallback player level while no progression system is attached. */
        this.playerLevel = 1;

        /** Wired by main.js after construction; all three may stay null in a
         *  bare harness and every use is guarded.
         *  @type {object|null} */
        this.progression = null;
        /** @type {import("../world/portal.js").RealmPortal|null} */
        this.portal = null;
        /** @type {{positions:{x:number,z:number}[]}|null} */
        this.shrine = null;
        /** @type {((realm:string)=>Promise<any>)|null} main.js enterRealm. */
        this.enterRealm = null;
        /** The pack director, so a live boss can hold its second slot. */
        this.encounters = null;

        /** Director clock — update(dt) only, frozen frames advance nothing. */
        this.time = 0;
        /** Next arena attempt. */
        this._tryAt = FIRST_TRY_S;

        // ------------------------------------------------------ event state
        /** "idle" | "pending" | "live" */
        this.state = "idle";
        /** "mini" | "realm" | null — the event kind in flight. */
        this.kind = null;
        /** The roster row of the boss in flight. @type {object|null} */
        this.row = null;
        /** Arena centre. */
        this.ax = 0;
        this.az = 0;
        this.ay = 0;
        this.arenaGrade = 0;
        /** Registry id of the live boss; -1 when none. */
        this.bossId = -1;
        /** Phase 1 or 2 while live. */
        this.phase = 1;
        this.phase2Pct = PHASE2_FLOOR;
        /** Level the boss spawned at. */
        this.bossLevel = 10;

        /** Killed flags for THIS run, "<realm>:<kind>". Mirrored into
         *  progression.bossesKilled so a save carries them. */
        this._killed = Object.create(null);
        /** Cached arena-variant clones, by roster combat key. */
        this._clones = Object.create(null);
        /** Deterministic choice counter (arena bearing/distance wheel). */
        this._seq = 0;
        /** Why the last placement/emergence refused — diagnosis, not state.
         *  @type {string|null} */
        this.lastRefusal = null;

        // ------------------------------------------------------ probe stats
        this.eventsFired = 0;
        this.kills = 0;
        this.leashReturns = 0;
        this.regenTicks = 0;
        this.lastRegenFrac = 0;
        this.patternP1 = 0;
        this.patternAll = 0;
        this.patternOpened = 0;
        this.speedBase = 0;
        this.phase2At = 0;
    }

    // --------------------------------------------------------------- frame

    /**
     * One frame. Order: gate/level poll -> live-boss upkeep (phase, leash,
     * death) -> pending emergence -> arena placement. Allocation-free in a
     * steady frame; `dt <= 0` (S.freezeTime) is a strict no-op, matching every
     * other combat system.
     * @param {number} dt seconds
     * @returns {void}
     */
    update(dt) {
        if (dt <= 0) return;
        this.time += dt;

        if (this.state === "live") {
            this._updateLive();
            return;
        }
        if (this.state === "pending") {
            const c = this.controller;
            const dx = this.ax - c.position.x, dz = this.az - c.position.z;
            const d2 = dx * dx + dz * dz;
            if (d2 <= EMERGE_M * EMERGE_M) {
                this._emerge();
            } else if (d2 > REPICK_M * REPICK_M && this.time >= this._tryAt) {
                // The player went the other way — the arena follows them.
                this.state = "idle";
                this._tryAt = this.time + RETRY_S;
            }
            return;
        }

        // Idle: try to arm an event.
        if (this.time < this._tryAt) return;
        this._tryAt = this.time + RETRY_S;
        const kind = this._eligibleKind();
        if (!kind) return;
        const row = BOSS_BY_REALM[this.realm] && BOSS_BY_REALM[this.realm][kind];
        if (!row) return;
        if (!this._pickArena()) return;
        this.kind = kind;
        this.row = row;
        this.state = "pending";
    }

    // ------------------------------------------------------------ test API

    /**
     * Force this realm's event of `kind` immediately: pick the arena, spawn
     * the boss at once (no walk-up). Bypasses the level gate and the killed
     * flags; still refuses if the arena cannot be placed or the body has not
     * streamed in. Console/probe only — never called by the frame.
     * @param {"mini"|"realm"} kind
     * @returns {boolean}
     */
    spawnBoss(kind) {
        const row = BOSS_BY_REALM[this.realm] && BOSS_BY_REALM[this.realm][kind];
        if (!row) { this.lastRefusal = "no " + kind + " row for " + this.realm; return false; }
        this.clearBoss();
        this.lastRefusal = null;
        if (!this._pickArena()) return false;
        this.kind = kind;
        this.row = row;
        this.state = "pending";
        return this._emerge();
    }

    /** Despawn the live boss, close the portal, return to idle. Killed flags
     *  are NOT cleared — a cleared boss stays cleared. @returns {void} */
    clearBoss() {
        if (this.bossId > 0) this.enemies.despawn(this.bossId);
        this.bossId = -1;
        this.state = "idle";
        this.kind = null;
        this.row = null;
        this.phase = 1;
        this._setBossLive(false);
        if (this.portal && this.portal.isOpen) this.portal.close();
        this._tryAt = this.time + RETRY_S;
    }

    /**
     * Realm switch (main.enterRealm): a boss belongs to its realm. Drops the
     * live event and the portal, and re-arms the clock so the new realm gets a
     * breather before its own boss is offered.
     * @param {"cold"|"sand"|"ash"} token
     * @returns {void}
     */
    setRealm(token) {
        this.clearBoss();
        this.realm = token;
        this._tryAt = this.time + FIRST_TRY_S;
    }

    /** Everything a probe needs, in one read. */
    get stats() {
        const r = this.registry;
        const s = this.bossId > 0 ? r.slot(this.bossId) : -1;
        const hpMax = s >= 0 ? r.hpMax[s] : 0;
        const clone = this.row ? this._clones[this.row.combatKey] : null;
        return {
            state: this.state,
            kind: this.kind,
            key: this.row ? this.row.combatKey : null,
            name: this.row ? bossTitle(this.row) : null,
            id: this.bossId,
            slot: s,
            level: this.bossLevel,
            hp: s >= 0 ? r.hp[s] : 0,
            hpMax,
            hpFrac: hpMax > 0 ? r.hp[s] / hpMax : 0,
            poiseMax: s >= 0 ? r.poiseMax[s] : 0,
            tier: s >= 0 ? r.tier[s] : -1,
            registryKind: s >= 0 ? r.kind[s] : null,
            barName: s >= 0 ? r.name[s] : null,
            phase: this.phase,
            phase2Pct: this.phase2Pct,
            phase2At: this.phase2At,
            arenaX: this.ax, arenaZ: this.az, arenaGrade: this.arenaGrade,
            arenaDist: s >= 0
                ? Math.hypot(r.x[s] - this.ax, r.z[s] - this.az) : 0,
            leashM: LEASH_M,
            leashReturns: this.leashReturns,
            regenTicks: this.regenTicks,
            lastRegenFrac: this.lastRegenFrac,
            speedBase: this.speedBase,
            speedNow: clone ? clone.speed : 0,
            patternP1: this.patternP1,
            patternAll: this.patternAll,
            patternOpened: this.patternOpened,
            patternNow: clone ? this._countUsable(clone.aUsable) : 0,
            eventsFired: this.eventsFired,
            kills: this.kills,
            killed: Object.assign({}, this._killed),
            refusal: this.lastRefusal || null,
            portalOpen: !!(this.portal && this.portal.isOpen),
            nextRealm: NEXT_REALM[this.realm],
            level6: MINI_LEVEL, level8: REALM_LEVEL,
        };
    }

    // ------------------------------------------------------------ internals

    /** Player level: the progression system when present, else the local
     *  fallback — the same read encounters.js does. @returns {number} */
    _level() {
        const sf = globalThis.SNOWFLOW;
        const p = this.progression ||
            (sf ? (sf.progress || sf.progression) : null);
        const l = (p && typeof p.level === "number") ? p.level : this.playerLevel;
        // TEST mode: both boss tiers become reachable immediately (mini gates
        // at 6, the realm boss at 8) — owner 2026-08-16.
        if (p && p.testMode) return Math.max(l, TEST_LEVEL);
        return l >= 1 ? l : 1;
    }

    /** Level clamped up to the realm band floor — the gate input (a player
     *  who portals into Sand under-levelled still meets Sand's bosses, the
     *  same rule the pack director uses). @returns {number} */
    _effLevel() {
        const lv = this._level();
        const floor = REALM_FLOOR[this.realm] || 1;
        return lv < floor ? floor : lv;
    }

    /** Has this realm's boss of `kind` already died this run? Reads the
     *  director's own flags first, then the persisted progression map.
     *  @param {string} kind @returns {boolean} */
    _isKilled(kind) {
        const k = this.realm + ":" + kind;
        if (this._killed[k]) return true;
        const p = this.progression;
        return !!(p && p.bossesKilled && p.bossesKilled[k]);
    }

    /** Which event, if any, is armed right now. Mini first — it is the
     *  realm's mid-gate. @returns {"mini"|"realm"|null} */
    _eligibleKind() {
        const lv = this._effLevel();
        const b = BOSS_BY_REALM[this.realm];
        if (!b) return null;
        if (b.mini && lv >= MINI_LEVEL && !this._isKilled("mini")) return "mini";
        if (b.realm && lv >= REALM_LEVEL && !this._isKilled("realm")) return "realm";
        return null;
    }

    /**
     * Choose the arena: ARENA_TRIES candidates 60-90 m out, spread across the
     * travel bearing, each scored by the mean terrain grade of its centre and
     * four points at FLAT_R — the flattest legal one wins. Rejects candidates
     * outside the play area or near a shrine. Writes ax/az/ay/arenaGrade.
     * @returns {boolean} false if nothing legal was found
     */
    _pickArena() {
        const c = this.controller;
        let dirX, dirZ;
        if (c.speed > 0.5) {
            dirX = c.velocity.x / c.speed;
            dirZ = c.velocity.z / c.speed;
        } else {
            dirX = Math.sin(c.facing);
            dirZ = -Math.cos(c.facing);
        }
        const edge = PLAY_RADIUS - EDGE_PAD;
        const px = c.position.x, pz = c.position.z;
        // Inward radial — a player fighting at the rim still gets an arena:
        // an out-of-bounds candidate is REFLECTED back into the field rather
        // than dropped, or the whole event could never place itself out there.
        const pr = Math.hypot(px, pz);
        const inX = pr > 1e-3 ? -px / pr : 0;
        const inZ = pr > 1e-3 ? -pz / pr : 1;
        let bx = 0, bz = 0, bg = Infinity;
        for (let t = 0; t < ARENA_TRIES; t++) {
            const seq = this._seq++;
            const ang = (hash01(seq * 7 + 11) * 2 - 1) * ARENA_SPREAD;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            let dx = dirX * ca - dirZ * sa;
            let dz = dirX * sa + dirZ * ca;
            const dist = ARENA_MIN + hash01(seq * 13 + 5) * (ARENA_MAX - ARENA_MIN);
            let x = px + dx * dist;
            let z = pz + dz * dist;
            if (x * x + z * z > edge * edge) {
                const d = dx * inX + dz * inZ;
                const rx = dx - 2 * d * inX, rz = dz - 2 * d * inZ;
                x = px + rx * dist;
                z = pz + rz * dist;
                if (x * x + z * z > edge * edge) {
                    x = px + inX * dist;      // last resort: straight inward
                    z = pz + inZ * dist;
                }
                if (x * x + z * z > edge * edge) continue;
                dx = (x - px) / dist;
                dz = (z - pz) / dist;
            }
            if (this._shrineNear(x, z, SHRINE_CLEAR)) continue;
            const g = this._flatness(x, z);
            if (g < bg) { bg = g; bx = x; bz = z; }
            if (g <= FLAT_MAX * 0.5) break;   // flat enough, stop scoring
        }
        if (bg === Infinity) { this.lastRefusal = "no legal arena"; return false; }
        this.ax = bx;
        this.az = bz;
        this.ay = this.terrain.heightAt(bx, bz);
        this.arenaGrade = bg;
        return true;
    }

    /** Mean |∇h| over the centre and four points at FLAT_R — `gradeAt` is
     *  world/shrine.js's, reused rather than re-derived.
     *  @param {number} x @param {number} z @returns {number} */
    _flatness(x, z) {
        const t = this.terrain;
        return (gradeAt(t, x, z) +
            gradeAt(t, x + FLAT_R, z) + gradeAt(t, x - FLAT_R, z) +
            gradeAt(t, x, z + FLAT_R) + gradeAt(t, x, z - FLAT_R)) / 5;
    }

    /** Is (x, z) within r of any shrine in the network?
     *  @param {number} x @param {number} z @param {number} r @returns {boolean} */
    _shrineNear(x, z, r) {
        const sh = this.shrine;
        if (!sh || !sh.positions) return false;
        const r2 = r * r;
        for (let i = 0; i < sh.positions.length; i++) {
            const p = sh.positions[i];
            const dx = p.x - x, dz = p.z - z;
            if (dx * dx + dz * dz < r2) return true;
        }
        return false;
    }

    /**
     * The intro moment: spawn the arena variant at the arena and announce it.
     * @returns {boolean} true if the boss stood up
     */
    _emerge() {
        const row = this.row;
        if (!row) return false;
        const vis = this.enemies.vis;
        if (vis && vis.ready && !vis.ready(row.combatKey)) {
            // The body has not streamed in — a boss that stands invisible is
            // worse than a boss that arrives a moment late. The event stays
            // PENDING and re-tests each frame the player is inside the
            // emergence radius; `stream()` lands within seconds of a realm
            // opening, and the re-test is one Map lookup.
            this.lastRefusal = "body not streamed: " + row.combatKey;
            this._tryAt = this.time + 2;
            return false;
        }
        const clone = this._cloneFor(row);
        if (!clone) { this.lastRefusal = "no unit record for " + row.combatKey; return false; }

        // Reset the variant to phase 1 before every emergence.
        this._resetPhase(clone);
        this.phase = 1;
        this.phase2At = 0;
        this.phase2Pct = this._phase2Pct(row);

        this.bossLevel = this._bossLevel(row);
        const id = this.enemies.spawn(clone.index, this.ax, this.az, this.bossLevel);
        if (typeof id !== "number" || id <= 0) {
            this.lastRefusal = "enemy pool or registry full";
            this._tryAt = this.time + RETRY_S;
            return false;
        }
        this.bossId = id;
        this.state = "live";
        // XP SEAM (progression.js owner): the §3.2 first-kill grants differ by
        // KIND — miniboss 20% of xpToNext, realm boss 35% — but `_onKill`
        // reads only the registry TIER, and a §2.4 arena variant is BOSS tier
        // whichever kind it is, so a mini boss currently pays the realm-boss
        // grant. This hint is written before the kill can land; the one-line
        // hook that consumes it is in the report.
        if (this.progression) this.progression.bossKindHint = this.kind;
        this.eventsFired++;
        this._setBossLive(true);
        this._burst(this.ax, this.az, 1);
        return true;
    }

    /** One frame of a live boss: phase gate, leash, death. @returns {void} */
    _updateLive() {
        const r = this.registry;
        const s = r.slot(this.bossId);
        if (s < 0) { this._onDeath(); return; }
        const hpMax = r.hpMax[s];
        const hp = r.hp[s];
        if (hp <= 0) { this._onDeath(); return; }

        // ---- phase 2 -----------------------------------------------------
        if (this.phase === 1 && hpMax > 0 && hp / hpMax <= this.phase2Pct) {
            this._openPhase2();
        }

        // ---- arena leash -------------------------------------------------
        const dx = r.x[s] - this.ax, dz = r.z[s] - this.az;
        if (dx * dx + dz * dz > LEASH_M * LEASH_M) this._leashHome(hp, hpMax);
    }

    /** Open the second pattern and the +15% speed. @returns {void} */
    _openPhase2() {
        const clone = this._clones[this.row.combatKey];
        if (!clone) return;
        const base = clone._baseUsable;
        for (let d = 0; d < clone.aUsable.length; d++) clone.aUsable[d] = base[d];
        clone.speed = clone._baseSpeed * PHASE2_SPEED;
        this.phase = 2;
        this.phase2At = this.time;
        this.patternOpened = this.patternAll - this.patternP1;
        this._burst(this.ax, this.az, 0.7);
    }

    /**
     * Leash: re-seat at the arena and regenerate LEASH_REGEN of max HP. The
     * enemy runtime's own leash is disabled for BOSS tier by design (§4.3
     * "the arena IS the leash"), so the director owns this one. Re-seating is
     * a despawn + respawn through the public API, with the carried HP written
     * once — an event edge, never a frame path.
     * @param {number} hp @param {number} hpMax @returns {void}
     */
    _leashHome(hp, hpMax) {
        const want = Math.min(hpMax, hp + LEASH_REGEN * hpMax);
        this.enemies.despawn(this.bossId);
        this.bossId = -1;
        const clone = this._clones[this.row.combatKey];
        const id = this.enemies.spawn(clone.index, this.ax, this.az, this.bossLevel);
        if (typeof id !== "number" || id <= 0) {
            // Could not re-seat (pool full): the event ends rather than
            // leaving a phantom.
            this.state = "idle";
            this._setBossLive(false);
            this._tryAt = this.time + RETRY_S;
            return;
        }
        this.bossId = id;
        const s = this.registry.slot(id);
        if (s >= 0) {
            this.registry.hp[s] = want;
            this.lastRegenFrac = hpMax > 0 ? (want - hp) / hpMax : 0;
        }
        this.leashReturns++;
        this.regenTicks++;
        this._burst(this.ax, this.az, 0.8);
    }

    /** The boss died: flag it, drop the event, open the portal on a realm
     *  boss. @returns {void} */
    _onDeath() {
        const kind = this.kind;
        const row = this.row;
        this.bossId = -1;
        this.kills++;
        this._setBossLive(false);

        if (kind) {
            const k = this.realm + ":" + kind;
            this._killed[k] = true;
            const p = this.progression;
            if (p && p.bossesKilled) {
                // progression._onKill already flags the boss by DISPLAY NAME
                // on its first kill; this second, realm-keyed flag is what
                // this director gates on, and it rides the same save blob.
                p.bossesKilled[k] = true;
                if (typeof p.save === "function") p.save();
            }
        }

        if (kind === "realm" && row && this.portal) {
            this.portal.onEnter = (token) => this._onPortalEnter(token);
            this.portal.open(this.ax, this.az, NEXT_REALM[this.realm]);
        }

        this.kind = null;
        this.row = null;
        this.phase = 1;
        this.state = "idle";
        this._tryAt = this.time + FIRST_TRY_S;
    }

    /** The player walked into the portal. @param {string} token @returns {void} */
    _onPortalEnter(token) {
        const p = this.progression;
        if (p && Array.isArray(p.realmsUnlocked) &&
            p.realmsUnlocked.indexOf(token) < 0) {
            p.realmsUnlocked.push(token);
            if (typeof p.save === "function") p.save();
        }
        if (this.enterRealm) this.enterRealm(token);
    }

    /** Tell the pack director a boss owns the field (it holds its second
     *  slot: §7's "adds capped at 2-4 fodder"). @param {boolean} on */
    _setBossLive(on) {
        if (this.encounters) this.encounters.bossLive = on;
    }

    // -------------------------------------------------- the arena variant

    /**
     * The cached §2.4 arena clone for a boss row. Built once per identity.
     * @param {object} row roster row @returns {object|null}
     */
    _cloneFor(row) {
        const key = row.combatKey;
        const had = this._clones[key];
        if (had) return had;
        const units = this.enemies.units;
        const bi = this.enemies.unitIndex(key);
        if (bi < 0) return null;
        const base = units[bi];

        const c = Object.assign({}, base);
        c.index = units.length;
        c.bossVariant = true;
        c.bossKind = row.bossKind;              // meshEnemies reads this for
        c.name = bossTitle(row);                // the boss cascade budget
        c.tier = TIER.BOSS;                     // §2.4: the arena variant IS a boss
        if (row.arenaHp > 0) c.hp = row.arenaHp;
        if (row.arenaStance != null) c.poise = row.arenaStance;
        c.leash = 1e9;                          // the director owns the leash
        c.aUsable = new Uint8Array(base.aUsable);
        c._baseUsable = new Uint8Array(base.aUsable);
        c._baseSpeed = base.speed;
        units.push(c);
        this._clones[key] = c;
        return c;
    }

    /** Phase-1 mask + base speed on a clone. @param {object} c @returns {void} */
    _resetPhase(c) {
        const base = c._baseUsable;
        const n = this._countUsable(base);
        const keep = Math.max(1, Math.ceil(n / 2));
        let seen = 0;
        for (let d = 0; d < base.length; d++) {
            if (!base[d]) { c.aUsable[d] = 0; continue; }
            seen++;
            c.aUsable[d] = seen <= keep ? 1 : 0;
        }
        c.speed = c._baseSpeed;
        this.patternAll = n;
        this.patternP1 = keep;
        this.patternOpened = 0;
        this.speedBase = c._baseSpeed;
    }

    /** @param {Uint8Array} m @returns {number} */
    _countUsable(m) {
        let n = 0;
        for (let d = 0; d < m.length; d++) if (m[d]) n++;
        return n;
    }

    /** Phase-2 HP fraction: the row's own first phase step, floored by the
     *  owner's 55%. @param {object} row @returns {number} */
    _phase2Pct(row) {
        const b = BOSS_ROW[row.bossKey];
        const pct = b && Array.isArray(b.phasePct) && b.phasePct.length
            ? b.phasePct[0] / 100 : 0;
        return pct > PHASE2_FLOOR ? pct : PHASE2_FLOOR;
    }

    /** Spawn level: the row's fixed capstone, else the realm band.
     *  @param {object} row @returns {number} */
    _bossLevel(row) {
        const b = BOSS_ROW[row.bossKey];
        if (b && b.fixedLevel > 0) return b.fixedLevel;
        const kind = row.bossKind === "realm_boss" ? "boss" : "miniboss";
        const lv = this.data && this.data.enemyLevelFor
            ? this.data.enemyLevelFor(this.realm, this._level(), 0.5, kind)
            : this._level();
        return Math.max(1, Math.min(30, Math.round(lv)));
    }

    // ------------------------------------------------------------------ fx

    /**
     * The emergence/phase/re-seat beat, through the pools that already exist:
     * one shockwave ring, a powder ring through the spray pool, and the low
     * detonate cue. All three are null-guarded — a bare harness runs the whole
     * event with no FX at all.
     * @param {number} x @param {number} z @param {number} scale
     * @returns {void}
     */
    _burst(x, z, scale) {
        const y = this.terrain.heightAt(x, z);
        const fx = this.fx;
        if (fx && fx.shockwave && fx.shockwave.spawn) {
            fx.shockwave.spawn(x, y + 0.15, z,
                BURST_RING_M * scale, 0.75, 0.72, 0.86, 1.0);
        }
        if (fx && fx.spray && fx.spray.emit) {
            for (let i = 0; i < BURST_GRAINS; i++) {
                const a = (i / BURST_GRAINS) * Math.PI * 2;
                const sp = 4.5 * scale + hash01(i * 31 + this.eventsFired) * 3;
                fx.spray.emit(x + Math.cos(a) * 0.7, y + 0.2, z + Math.sin(a) * 0.7,
                    Math.cos(a) * sp, 3.6 * scale, Math.sin(a) * sp,
                    0.14, 0.9, 0, 3.4);
            }
        }
        sfx.trigger("spell_spikes_detonate", x, y + 1, z);
    }
}
