/**
 * Encounter director — ambient pack spawning for open-realm roaming
 * (_spec/COMBAT_DESIGN.md §6 + §8.2, _spec/PROGRESSION_DESIGN.md §5–§7).
 *
 * One job: keep exactly ONE ambient pack alive around the roaming player.
 * A pack is chosen from the realm's §6.2 table, placed 55–80 m ahead of the
 * player's travel direction, spawned with the §6.1 per-unit stagger
 * (0.5–2 s), and despawned once its members fall beyond 120 m. A pack whose
 * every member DIED marks its anchor as a cleared area: no new pack spawns
 * within 40 m of it (the §4.3 leash-anchor radius) for 90 s. Arena/boss
 * encounters are NOT this file — the arena is its own director (P2.4).
 *
 * POLLED, NOT SUBSCRIBED (crosshair.js pattern, minus the DOM): `update(dt)`
 * runs once per frame from main.js, reads live state, allocates nothing in a
 * steady frame. All member/queue/area storage is preallocated typed arrays;
 * the minimap blip objects are a fixed pool mutated in place. `dt === 0`
 * (S.freezeTime) is a strict no-op per COMBAT_DESIGN §9.2.
 *
 * GATE: polls `S.combatEnemies !== false` — an unregistered plain flag, so
 * the director is ON by default with zero schema edits, and
 * `SNOWFLOW.S.combatEnemies = false` kills and clears everything next frame.
 * (Registering a real overlay toggle = add `combatEnemies: true` to S plus a
 * Systems-group SCHEMA row in core/settings.js; noted for the integrator.)
 * New packs also never START while the FFG shell is off "playing" — same
 * `FFG.shell.phase` poll as crosshair.js; live packs keep simulating.
 *
 * CONTRACTS THIS FILE CODES AGAINST:
 *   registry — combat/damageable.js DamageableRegistry, verbatim: `slot(id)`
 *     (-1 = gone), dense SoA `x/z/hp/kind[slot]`, ids > 0. Kills are
 *     detected by polling (slot gone or hp <= 0), not by draining the event
 *     ring — the ring stays whole for floaters/XP/audio.
 *   enemies — the enemy runtime (combat/enemies.js, sibling build):
 *     `spawn(key, x, z, level) -> id`   registers the body in the registry
 *         at the terrain height for (x, z), stats derived from its L10 row
 *         via HP × 1.10^(L−10) / DMG × 1.07^(L−10) (PROGRESSION §5.2/§10.1);
 *         returns the registry id, or a value <= 0 when full.
 *     `despawn(id)`                     silent removal — no kill event, no
 *         XP, no death VFX (leash/cleanup path).
 *   data — the shared data tables (§10.3, sibling build):
 *     `enemyLevelFor(key, playerLevel) -> level` — PROGRESSION §5.1: clamp
 *         into the realm band (Cold 1–10) with the −1/0/+1 spawn variance,
 *         elite +2 rule applied from the key's roster tier.
 *   controller — character/controller.js: `.position` (Vector3), `.velocity`
 *     (Vector3), `.speed`, `.facing` (forward = (sin f, −cos f), the port
 *     frame minimap.js documents).
 *   minimap — ui/minimap.js: `.blips` array of {x, z, kind}. This file OWNS
 *     that array and rebuilds it every unfrozen frame from the live registry
 *     (kind "enemy" | "boss"; dummies excluded) — other writers must go
 *     through the director or claim their own kinds here.
 *
 * Player level: polled from `SNOWFLOW.progress.level` when the progression
 * system (P1.1) exists, else `this.playerLevel` (default 1, settable by
 * tests).
 *
 * TEST API (console: SNOWFLOW.encounters.…):
 *   spawnPack("The Hunt")            force-spawn a named §6.2 pack ahead of
 *                                    travel — replaces the active pack,
 *                                    bypasses level gates and cleared-area
 *                                    locks, honours the 25 m exclusions.
 *   spawnAt("rimeImp", x, z, level)  one untracked unit at an explicit spot;
 *                                    level omitted -> data.enemyLevelFor.
 *
 * SPEC NUMBERS (owner directive + docs — do not retune here):
 *   spawn 55–80 m ahead · despawn > 120 m · never inside 25 m of the player
 *   or the spawn-shrine dummy arc · cleared area locked 90 s (radius 40 m,
 *   the §4.3 ambient leash-anchor radius) · per-unit stagger 0.5–2 s (§6.1)
 *   · 3–5 s breather between packs (§6.1) · alive cap Cold 6 / Sand 8 /
 *   Ash 8 (§8.2). Placement details the docs do NOT define (scatter ring,
 *   retry bearings, blocked-point push-out) are labelled as implementation
 *   choices at their constants below.
 */

import { S } from "../core/settings.js";

// ---------------------------------------------------------------- spec knobs
/** Owner directive: pack anchor lands 55–80 m ahead of travel. */
const SPAWN_MIN = 55;
const SPAWN_MAX = 80;
/** Owner directive: members beyond 120 m of the player despawn silently. */
const DESPAWN_SQ = 120 * 120;
/** Owner directive: nothing spawns inside 25 m of the player or dummy arc. */
const EXCLUDE_M = 25;
const EXCLUDE_SQ = EXCLUDE_M * EXCLUDE_M;
/** Owner directive: a cleared area stays empty for 90 s. */
const RESPAWN_S = 90;
/** "Area" radius = the §4.3 ambient leash-anchor radius (40 m). */
const AREA_R_SQ = 40 * 40;
/** §6.1 spawn stagger per unit: 0.5–2 s. */
const STAGGER_MIN = 0.5;
const STAGGER_MAX = 2.0;
/** §6.1 breather between waves, reused between ambient packs: 3–5 s. */
const BREATHER_MIN = 3;
const BREATHER_MAX = 5;
/** §8.2 alive caps per realm. */
const ALIVE_CAP = { cold: 6, sand: 8, ash: 8 };

// ------------------------------------------------- implementation constants
/** Pack members scatter on a 3–6 m ring around the anchor (impl choice —
 *  inside the §3.1 4–8 m orbit band so the pack coheres on arrival). */
const SCATTER_MIN = 3;
const SCATTER_MAX = 6;
/** Anchor candidates tried per frame before backing off 1 s (impl choice). */
const PLACE_TRIES = 5;
/** Bearing jitter for retry candidates, radians (impl choice, ≈ ±29°). */
const PLACE_JITTER = 0.5;
/** A queued spawn blocked by the player retries this much later (impl). */
const RETRY_S = 0.5;
/** Blocked spawn points get pushed out to 30 m from the player (impl —
 *  25 m exclusion + 5 m so a step toward it cannot re-violate instantly). */
const PUSH_OUT_M = 30;
/** Anchor-vs-dummy margin: 25 m arc + the 6 m scatter ring, so no member
 *  point can ever land inside the dummy exclusion (derived, not tuned). */
const DUMMY_MARGIN = EXCLUDE_M + SCATTER_MAX;
/** Queue/member slots. Largest §6.2 pack is 6 units; 8 covers Sand/Ash. */
const MAX_PACK = 8;
/** Blip pool size. Registry MAX is 96 but live enemies are capped at 8. */
const BLIP_MAX = 32;
/** Cleared-area ring buffer depth. */
const MAX_AREAS = 8;

/**
 * §6.2 pack tables, verbatim. `gate` = minimum player level, derived from
 * the PROGRESSION §7 unlock-precedes-teacher schedule: Mini-Vortex L2 before
 * the first Frost Stalker pack ("The Hunt"); Spikes L4 before the first
 * Glacier Brute / Hail Guard ("Glacier Line", and Ritual Circle carries the
 * Hail Plate Guard); Great Vortex L6 before the late elite pack. Roster keys
 * must match combat/enemies.js and the data tables exactly.
 * @type {{name:string, realm:string, gate:number, budget:number,
 *         units:string[]}[]}
 */
const PACKS = [
    { name: "Imp Warren", realm: "cold", gate: 1, budget: 8,
        units: ["rimeImp", "rimeImp", "rimeImp", "rimeImp", "rimeImp",
            "hoarfrostSprite"] },
    { name: "The Hunt", realm: "cold", gate: 2, budget: 9,
        units: ["frostStalker", "frostStalker", "rimeImp", "rimeImp",
            "rimeImp"] },
    { name: "Ritual Circle", realm: "cold", gate: 4, budget: 11,
        units: ["rimeboundCultist", "hailPlateGuard", "rimeImp", "rimeImp",
            "rimeImp"] },
    { name: "Glacier Line", realm: "cold", gate: 4, budget: 14,
        units: ["glacierBrute", "rimeboundCultist", "hoarfrostSprite",
            "hoarfrostSprite"] },
    { name: "Scout Screen", realm: "cold", gate: 1, budget: 2,
        units: ["glassRevenant"] },
    { name: "Elite Hunt", realm: "cold", gate: 6, budget: 12,
        units: ["moraineColossus", "blizzardAssassin"] },
];

const TWO_PI = Math.PI * 2;

export class Encounters {
    /**
     * @param {{spawn:(key:string,x:number,z:number,level:number)=>number,
     *          despawn:(id:number)=>void}} enemies  enemy runtime
     * @param {import("./damageable.js").DamageableRegistry} registry
     * @param {import("../character/controller.js").CharacterController} controller
     * @param {{enemyLevelFor:(key:string,playerLevel:number)=>number}} data
     * @param {import("../ui/minimap.js").Minimap} minimap
     */
    constructor(enemies, registry, controller, data, minimap) {
        this.enemies = enemies;
        this.registry = registry;
        this.controller = controller;
        this.data = data;
        this.minimap = minimap;

        /** Active realm — selects the pack table rows and the alive cap.
         *  Cold ships first; Sand/Ash arrive as data rows (P3.2). */
        this.realm = "cold";
        /** Fallback player level while the progression system (P1.1) is not
         *  on SNOWFLOW; tests may set it directly. */
        this.playerLevel = 1;

        /** Director clock, advanced by update(dt) only — frozen frames
         *  advance nothing, matching the registry's own clock discipline. */
        this.time = 0;

        // ---------------------------------------------- pack member slots
        /** Registry ids of live members; -1 = free slot. */
        this._mIds = new Int32Array(MAX_PACK).fill(-1);
        this._live = 0;
        this._dead = 0;
        this._desp = 0;
        this._packActive = false;
        this._packX = 0;
        this._packZ = 0;
        /** @type {string|null} name of the active pack, for probes. */
        this.packName = null;

        // ------------------------------------------- pending spawn queue
        /** @type {(string|null)[]} */
        this._qKey = new Array(MAX_PACK).fill(null);
        this._qX = new Float32Array(MAX_PACK);
        this._qZ = new Float32Array(MAX_PACK);
        this._qAt = new Float64Array(MAX_PACK);
        this._qCount = 0;
        this._qNext = 0;

        // --------------------------------------------- cleared-area ring
        this._areaX = new Float32Array(MAX_AREAS);
        this._areaZ = new Float32Array(MAX_AREAS);
        this._areaUntil = new Float64Array(MAX_AREAS);
        this._areaHead = 0;

        /** Earliest time a new roaming pack may be placed. */
        this._nextSpawnAt = 0;
        /** Gate edge cache — cleanup runs once when the flag flips off. */
        this._wasOn = true;

        // --------------------------------------------------- blip pool
        /** @type {{x:number, z:number, kind:string}[]} */
        this._blipPool = new Array(BLIP_MAX);
        for (let i = 0; i < BLIP_MAX; i++) {
            this._blipPool[i] = { x: 0, z: 0, kind: "enemy" };
        }

        /** Anchor scratch (out-params of _findAnchor; no per-call objects). */
        this._ax = 0;
        this._az = 0;
    }

    /**
     * One frame of the director. Order: gate → member poll (deaths, 120 m
     * despawn) → pack-end bookkeeping → pending-queue fire → roam placement
     * → minimap blips. Allocates nothing in a steady frame.
     * @param {number} dt seconds; 0 = strict no-op (S.freezeTime, §9.2)
     * @returns {void}
     */
    update(dt) {
        if (dt <= 0) return;

        if (S.combatEnemies === false) {
            if (this._wasOn) {
                this._wasOn = false;
                this._clearAll();
                this.minimap.blips.length = 0;
            }
            return;
        }
        this._wasOn = true;

        this.time += dt;
        const c = this.controller;
        const px = c.position.x, pz = c.position.z;

        this._pollMembers(px, pz);

        // Pack over? Every member resolved and nothing left to fire. A pack
        // whose members all DIED clears the area (90 s lock); one the player
        // simply outran (any silent despawn) does not.
        if (this._packActive && this._live === 0 && this._qNext >= this._qCount) {
            if (this._dead > 0 && this._desp === 0) {
                this._recordArea(this._packX, this._packZ);
            }
            this._packActive = false;
            this.packName = null;
            this._qCount = 0;
            this._qNext = 0;
            this._nextSpawnAt = this.time +
                BREATHER_MIN + Math.random() * (BREATHER_MAX - BREATHER_MIN);
        }

        this._fireQueue(px, pz);

        // Roam: keep one pack in the world. New packs never start while the
        // shell menu/pause is up (same poll as crosshair.js); live ones above
        // keep simulating regardless.
        if (!this._packActive && this.time >= this._nextSpawnAt) {
            const shell = globalThis.FFG ? globalThis.FFG.shell : null;
            const shellUp = !!(shell && shell.phase !== "playing");
            if (!shellUp) this._tryRoamSpawn();
        }

        this._rebuildBlips();
    }

    // ------------------------------------------------------------ test API

    /**
     * Force-spawn a named §6.2 pack ahead of travel. Replaces the active
     * pack (silent despawn, no cleared-area record), bypasses level gates
     * and cleared-area locks, still honours the 25 m player/dummy
     * exclusions. Test/console API — never called by the frame.
     * @param {string} name pack name, case-insensitive ("The Hunt")
     * @returns {boolean} true if the pack was queued
     */
    spawnPack(name) {
        const want = String(name).toLowerCase();
        let p = -1;
        for (let i = 0; i < PACKS.length; i++) {
            if (PACKS[i].name.toLowerCase() === want) { p = i; break; }
        }
        if (p < 0) return false;
        if (!this._findAnchor(true)) return false;
        this._clearAll();
        this._queuePack(p, this._ax, this._az);
        return true;
    }

    /**
     * Spawn one untracked unit at an explicit spot. Not a pack member: the
     * director never despawns it and its death clears no area — it exists
     * for combat testing. Refuses the 25 m player exclusion.
     * @param {string} key roster key ("rimeImp", "glacierBrute", …)
     * @param {number} x @param {number} z
     * @param {number} [level] omitted -> data.enemyLevelFor at player level
     * @returns {number} registry id, or -1
     */
    spawnAt(key, x, z, level) {
        const c = this.controller;
        const dx = x - c.position.x, dz = z - c.position.z;
        if (dx * dx + dz * dz < EXCLUDE_SQ) return -1;
        const lv = (typeof level === "number" && level >= 1)
            ? Math.round(level)
            // realm, not the unit key — bands are per-realm (QA #17).
            : this.data.enemyLevelFor(this.realm, this._level());
        const id = this.enemies.spawn(key, x, z, lv);
        return (typeof id === "number" && id > 0) ? id : -1;
    }

    // ------------------------------------------------------------ internals

    /** Player level: progression system when present, else the local field.
     * @returns {number} */
    _level() {
        const sf = globalThis.SNOWFLOW;
        const p = sf ? sf.progress : null;
        const l = (p && typeof p.level === "number") ? p.level : this.playerLevel;
        return l >= 1 ? l : 1;
    }

    /**
     * Poll every tracked member: gone-or-dead resolves the slot as a death;
     * live members beyond 120 m are silently despawned.
     * @param {number} px @param {number} pz @returns {void}
     */
    _pollMembers(px, pz) {
        const reg = this.registry;
        for (let k = 0; k < MAX_PACK; k++) {
            const id = this._mIds[k];
            if (id < 0) continue;
            const s = reg.slot(id);
            if (s < 0 || reg.hp[s] <= 0) {
                // Removed from the registry (or at 0 hp awaiting removal)
                // without this director despawning it: a kill.
                this._mIds[k] = -1;
                this._live--;
                this._dead++;
                continue;
            }
            const dx = reg.x[s] - px, dz = reg.z[s] - pz;
            if (dx * dx + dz * dz > DESPAWN_SQ) {
                this.enemies.despawn(id);
                this._mIds[k] = -1;
                this._live--;
                this._desp++;
            }
        }
    }

    /**
     * Fire due queue entries, in order. A point inside the player's 25 m
     * exclusion is pushed out to 30 m along its own bearing; if the pushed
     * point (or the original) still violates an exclusion the head entry is
     * delayed RETRY_S and the queue holds — the stagger ordering, and the
     * hard "never inside 25 m" rule, both survive every path.
     * @param {number} px @param {number} pz @returns {void}
     */
    _fireQueue(px, pz) {
        const cap = ALIVE_CAP[this.realm] || 8;
        while (this._qNext < this._qCount && this.time >= this._qAt[this._qNext]) {
            const i = this._qNext;
            let x = this._qX[i], z = this._qZ[i];

            let dx = x - px, dz = z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 < EXCLUDE_SQ) {
                const d = Math.sqrt(d2);
                if (d < 1e-3) { // player parked exactly on the point
                    this._qAt[i] = this.time + RETRY_S;
                    break;
                }
                const s = PUSH_OUT_M / d;
                x = px + dx * s;
                z = pz + dz * s;
            }
            if (this._dummyNear(x, z, EXCLUDE_M)) {
                this._qAt[i] = this.time + RETRY_S;
                break;
            }

            this._qNext++;
            if (this._live >= cap) continue; // §8.2 cap: unit is forfeit

            const key = /** @type {string} */ (this._qKey[i]);
            // Band scaling keys off the REALM, not the unit — passing the
            // unit key here read SCALING.bands["rime_imp"] and crashed boot.
            const lv = this.data.enemyLevelFor(this.realm, this._level());
            const id = this.enemies.spawn(key, x, z, lv);
            if (typeof id !== "number" || id <= 0) continue; // runtime full

            for (let k = 0; k < MAX_PACK; k++) {
                if (this._mIds[k] < 0) {
                    this._mIds[k] = id;
                    this._live++;
                    break;
                }
            }
        }
        if (this._qNext >= this._qCount) {
            this._qCount = 0;
            this._qNext = 0;
        }
    }

    /** Pick an eligible pack (level-gated, uniform) and queue it at a fresh
     *  anchor; on placement failure back off 1 s. @returns {void} */
    _tryRoamSpawn() {
        const lv = this._level();
        let n = 0;
        for (let i = 0; i < PACKS.length; i++) {
            if (PACKS[i].realm === this.realm && PACKS[i].gate <= lv) n++;
        }
        if (n === 0) return;
        if (!this._findAnchor(false)) {
            this._nextSpawnAt = this.time + 1;
            return;
        }
        let r = (Math.random() * n) | 0;
        for (let i = 0; i < PACKS.length; i++) {
            if (PACKS[i].realm !== this.realm || PACKS[i].gate > lv) continue;
            if (r === 0) {
                this._queuePack(i, this._ax, this._az);
                return;
            }
            r--;
        }
    }

    /**
     * Find a pack anchor 55–80 m along the travel direction (velocity when
     * moving, facing when planted), jittering the bearing across PLACE_TRIES
     * candidates. Rejects candidates near the dummy arc (with the scatter
     * margin) and — unless `ignoreAreas` — inside a live cleared area.
     * Result in `_ax/_az`.
     * @param {boolean} ignoreAreas test-API path skips the 90 s locks
     * @returns {boolean}
     */
    _findAnchor(ignoreAreas) {
        const c = this.controller;
        let dirX, dirZ;
        if (c.speed > 0.5) {
            dirX = c.velocity.x / c.speed;
            dirZ = c.velocity.z / c.speed;
        } else {
            dirX = Math.sin(c.facing);
            dirZ = -Math.cos(c.facing);
        }
        for (let t = 0; t < PLACE_TRIES; t++) {
            const ang = t === 0 ? 0 : (Math.random() * 2 - 1) * PLACE_JITTER;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const dx = dirX * ca - dirZ * sa;
            const dz = dirX * sa + dirZ * ca;
            const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
            const ax = c.position.x + dx * dist;
            const az = c.position.z + dz * dist;
            if (!ignoreAreas && this._areaBlocked(ax, az)) continue;
            if (this._dummyNear(ax, az, DUMMY_MARGIN)) continue;
            this._ax = ax;
            this._az = az;
            return true;
        }
        return false;
    }

    /**
     * Queue a pack's units on the 3–6 m scatter ring around the anchor with
     * the §6.1 stagger: first unit immediate, each next +0.5–2 s.
     * @param {number} p index into PACKS
     * @param {number} ax @param {number} az
     * @returns {void}
     */
    _queuePack(p, ax, az) {
        const pack = PACKS[p];
        const units = pack.units;
        const phase = Math.random() * TWO_PI;
        let t = this.time;
        this._qCount = 0;
        this._qNext = 0;
        for (let i = 0; i < units.length && this._qCount < MAX_PACK; i++) {
            const a = phase + (i / units.length) * TWO_PI;
            const r = SCATTER_MIN + Math.random() * (SCATTER_MAX - SCATTER_MIN);
            const q = this._qCount++;
            this._qKey[q] = units[i];
            this._qX[q] = ax + Math.cos(a) * r;
            this._qZ[q] = az + Math.sin(a) * r;
            this._qAt[q] = t;
            t += STAGGER_MIN + Math.random() * (STAGGER_MAX - STAGGER_MIN);
        }
        this._packX = ax;
        this._packZ = az;
        this._packActive = true;
        this.packName = pack.name;
        this._dead = 0;
        this._desp = 0;
    }

    /** Any live cleared area within 40 m of (x, z)?
     * @param {number} x @param {number} z @returns {boolean} */
    _areaBlocked(x, z) {
        for (let i = 0; i < MAX_AREAS; i++) {
            if (this.time >= this._areaUntil[i]) continue;
            const dx = x - this._areaX[i], dz = z - this._areaZ[i];
            if (dx * dx + dz * dz < AREA_R_SQ) return true;
        }
        return false;
    }

    /** Record a cleared area (ring buffer, oldest overwritten).
     * @param {number} x @param {number} z @returns {void} */
    _recordArea(x, z) {
        const i = this._areaHead;
        this._areaX[i] = x;
        this._areaZ[i] = z;
        this._areaUntil[i] = this.time + RESPAWN_S;
        this._areaHead = (i + 1) % MAX_AREAS;
    }

    /** Any registered training dummy within r metres of (x, z)? The dummy
     *  arc is read live off the registry (kind "dummy") — no hardcoded
     *  shrine coordinates to drift. Spawn-edge only, never per steady frame.
     * @param {number} x @param {number} z @param {number} r
     * @returns {boolean} */
    _dummyNear(x, z, r) {
        const reg = this.registry;
        const r2 = r * r;
        for (let i = 0; i < reg.count; i++) {
            if (reg.kind[i] !== "dummy") continue;
            const dx = reg.x[i] - x, dz = reg.z[i] - z;
            if (dx * dx + dz * dz < r2) return true;
        }
        return false;
    }

    /** Despawn every tracked member and cancel the queue. No cleared-area
     *  record, no breather — callers set their own follow-up state.
     * @returns {void} */
    _clearAll() {
        for (let k = 0; k < MAX_PACK; k++) {
            const id = this._mIds[k];
            if (id < 0) continue;
            this.enemies.despawn(id);
            this._mIds[k] = -1;
        }
        this._live = 0;
        this._dead = 0;
        this._desp = 0;
        this._qCount = 0;
        this._qNext = 0;
        this._packActive = false;
        this.packName = null;
    }

    /**
     * Rebuild minimap.blips from the live registry: every breathing body of
     * kind "enemy" or "boss" (dummies excluded), positions current-frame.
     * Pool objects are mutated in place and the array is truncated by
     * length — zero allocation once the array has grown to its watermark.
     * @returns {void}
     */
    _rebuildBlips() {
        const reg = this.registry;
        const arr = this.minimap.blips;
        let n = 0;
        for (let i = 0; i < reg.count && n < BLIP_MAX; i++) {
            if (reg.hp[i] <= 0) continue;
            const k = reg.kind[i];
            if (k !== "enemy" && k !== "boss") continue;
            const b = this._blipPool[n];
            b.x = reg.x[i];
            b.z = reg.z[i];
            b.kind = k;
            b.id = reg.idOf[i];      // minimap rings the TAB target's pip
            arr[n] = b;
            n++;
        }
        arr.length = n;
    }
}
