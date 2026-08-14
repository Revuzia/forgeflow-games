/**
 * Encounter director — ambient pack spawning for open-realm roaming
 * (_spec/COMBAT_DESIGN.md §6 + §8.2, _spec/PROGRESSION_DESIGN.md §5–§7).
 *
 * One job: keep the roaming player supplied with ambient packs. The director
 * runs TWO pack slots (owner density directive 2026-08-13 — one pack with
 * long breathers read as sparse): slot 0 always roams; slot 1 arms once the
 * player's band-clamped level reaches the realm floor + 2, and its packs
 * anchor on the FAR bearing (behind travel) so density comes from
 * surrounding pressure, not a doubled wall ahead. A pack is chosen from the
 * realm's §6.2 table, placed 55–80 m from the player along its slot's
 * bearing, spawned with the §6.1 per-unit stagger (0.5–2 s), and despawned
 * once its members fall beyond 120 m. A pack whose every member DIED marks
 * its anchor as a cleared area: no new pack spawns within 40 m of it (the
 * §4.3 leash-anchor radius) for 90 s. Arena/boss encounters are NOT this
 * file — the arena is its own director (P2.4).
 *
 * POLLED, NOT SUBSCRIBED (crosshair.js pattern, minus the DOM): `update(dt)`
 * runs once per frame from main.js, reads live state, allocates nothing in a
 * steady frame. All member/queue/area storage is preallocated typed arrays
 * per slot; the minimap blip objects are a fixed pool mutated in place.
 * `dt === 0` (S.freezeTime) is a strict no-op per COMBAT_DESIGN §9.2.
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
 *         into the realm band (Cold 1–10, Sand 8–20, Ash 18–30) with the
 *         −1/0/+1 spawn variance, elite +2 rule applied from the key's
 *         roster tier.
 *   controller — character/controller.js: `.position` (Vector3), `.velocity`
 *     (Vector3), `.speed`, `.facing` (forward = (sin f, −cos f), the port
 *     frame minimap.js documents).
 *   minimap — ui/minimap.js: `.blips` array of {x, z, kind}. This file OWNS
 *     that array and rebuilds it every unfrozen frame from the live registry
 *     (kind "enemy" | "boss") — other writers must go
 *     through the director or claim their own kinds here.
 *
 * Player level: polled from `SNOWFLOW.progress.level` or
 * `SNOWFLOW.progression.level` when a progression system is exported
 * (main.js exports the P1.1 system as `progression` — the old
 * `sf.progress`-only read never matched it, so the live director sat at
 * level 1 forever and sand/ash gates could never open; fixed 2026-08-13),
 * else `this.playerLevel` (default 1, settable by tests). Pack GATES compare
 * against the level clamped up to the realm band floor (Cold 1 / Sand 8 /
 * Ash 18): the band already clamps every spawned enemy's level up to its
 * floor, so a low-level player walking a sand portal must still meet
 * entry-gate packs, not an empty realm.
 *
 * TEST API (console: SNOWFLOW.encounters.…):
 *   spawnPack("The Hunt")            force-spawn a named §6.2 pack ahead of
 *                                    travel (slot 0) — replaces all active
 *                                    packs, bypasses level gates and
 *                                    cleared-area locks, honours the 25 m
 *                                    exclusions.
 *   spawnAt("rimeImp", x, z, level)  one untracked unit at an explicit spot;
 *                                    level omitted -> data.enemyLevelFor.
 *   packsSpawned                     lifetime count of packs queued — the
 *                                    density probe's spawn counter.
 *   _nextSpawnAt / _nextSpawnAt2     slot 0 / slot 1 roam timers (probes
 *                                    zero them to restore the director).
 *
 * SPEC NUMBERS (owner directive + docs — do not retune here):
 *   spawn 55–80 m ahead · despawn > 120 m · never inside 25 m of the player
 *   or the spawn shrine · cleared area locked 90 s (radius 40 m,
 *   the §4.3 ambient leash-anchor radius) · per-unit stagger 0.5–2 s (§6.1)
 *   · 1.5–2.5 s breather between packs (owner density directive 2026-08-13:
 *   half the §6.1 3–5 s band) · alive cap Cold 10 / Sand 12 / Ash 12 (owner
 *   density directive, raised from §8.2's 6/8/8 — two concurrent packs need
 *   the headroom; enemies.js ENEMY_MAX is 24, so worst-case 12 stays well
 *   under). Placement details the docs do NOT define (scatter ring, retry
 *   bearings, blocked-point push-out) are labelled as implementation
 *   choices at their constants below.
 */

import { S } from "../core/settings.js";

// ---------------------------------------------------------------- spec knobs
/** Owner directive: pack anchor lands 55–80 m from the player. */
const SPAWN_MIN = 55;
const SPAWN_MAX = 80;
/** Owner directive: members beyond 120 m of the player despawn silently. */
const DESPAWN_SQ = 120 * 120;
/** Owner directive: nothing spawns inside 25 m of the player or shrine. */
const EXCLUDE_M = 25;
const EXCLUDE_SQ = EXCLUDE_M * EXCLUDE_M;
/** Owner directive: a cleared area stays empty for 90 s. */
const RESPAWN_S = 90;
/** "Area" radius = the §4.3 ambient leash-anchor radius (40 m). */
const AREA_R_SQ = 40 * 40;
/** §6.1 spawn stagger per unit: 0.5–2 s. */
const STAGGER_MIN = 0.5;
const STAGGER_MAX = 2.0;
/** Breather between ambient packs. §6.1 said 3–5 s; the owner found the
 *  resulting field sparse — halved 2026-08-13 (density directive). */
const BREATHER_MIN = 1.5;
const BREATHER_MAX = 2.5;
/** Alive caps per realm — owner density directive 2026-08-13, raised from
 *  §8.2's 6/8/8 so two concurrent packs fit (ENEMY_MAX 24; never near it). */
const ALIVE_CAP = { cold: 10, sand: 12, ash: 12 };
/** Realm band floors (PROGRESSION §5.1: Cold 1–10, Sand 8–20, Ash 18–30).
 *  Pack gates and the two-pack threshold compare against the player level
 *  clamped up to this floor — see the header. */
const REALM_FLOOR = { cold: 1, sand: 8, ash: 18 };
/** Slot 1 arms at band-clamped level >= floor + this margin (owner density
 *  directive: "at or above the realm gate + 2"). */
const TWO_PACK_MARGIN = 2;
/** Concurrent pack slots. Slot 0 = travel bearing, slot 1 = far bearing. */
const SLOT_N = 2;

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
/** Anchor-vs-shrine margin: 25 m exclusion + the 6 m scatter ring, so no
 *  member point can ever land at the spawn shrine (derived, not tuned). */
const SHRINE_MARGIN = EXCLUDE_M + SCATTER_MAX;
/** Queue/member slots per pack. Largest §6.2 pack is 6 units; 8 is margin. */
const MAX_PACK = 8;
/** Blip pool size. Registry MAX is 96 but live enemies cap at 12. */
const BLIP_MAX = 32;
/** Cleared-area ring buffer depth. */
const MAX_AREAS = 8;

/**
 * §6.2 pack tables. Cold and the Sand/Ash rows are transcribed from
 * _spec/COMBAT_DESIGN.md §6.2 verbatim (compositions and budgets); the one
 * addition is Sand's "Shroud Hunt" — §4.3 names the Dust Stalker as Sand's
 * designated pursuer but no §6.2 sand row fields him, which would leave
 * Sand's anti-kite mechanic unreachable in ambient play, so it mirrors
 * Cold's "The Hunt" composition grammar at matched budget.
 *
 * `gate` = minimum band-clamped player level. Cold gates derive from the
 * PROGRESSION §7 unlock-precedes-teacher schedule (Mini-Vortex L2 before
 * "The Hunt"; Spikes L4 before "Glacier Line"/"Ritual Circle"; Great Vortex
 * L6 before the late elite pack). Sand/Ash gates are laid across their
 * bands (Sand 8–20, Ash 18–30) the way Cold's span 1–10: entry packs at the
 * floor, the flagship/teaching packs a step in, elites late. All spells are
 * unlocked by L8, so no Sand/Ash gate waits on a teacher — only on band
 * depth. Roster keys must match combat/enemies.js and the data tables
 * exactly (scourScout, hourglassAutomaton and scorpionHusk render through
 * their MESH_REUSE hosts — roster.js BODY_BY_KEY resolves all three).
 * @type {{name:string, realm:string, gate:number, budget:number,
 *         units:string[]}[]}
 */
const PACKS = [
    // ---- Cold (§6.2, budgets 6→14) ----
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

    // ---- Sand (§6.2, budgets 8→17) ----
    { name: "Mound Field", realm: "sand", gate: 8, budget: 8,
        units: ["duneImp", "duneImp", "duneImp", "duneImp", "duneImp",
            "scorpionHusk"] },
    { name: "Shroud Hunt", realm: "sand", gate: 9, budget: 9,
        units: ["dustStalker", "dustStalker", "duneImp", "duneImp",
            "duneImp"] },
    { name: "Glass Patrol", realm: "sand", gate: 9, budget: 10,
        units: ["hourglassAutomaton", "duneImp", "duneImp"] },
    { name: "Bandit Doctrine", realm: "sand", gate: 10, budget: 15,
        units: ["windscourBandit", "windscourBandit", "windscourBandit",
            "windscourBandit", "dustMage"] },
    { name: "Watch Post", realm: "sand", gate: 12, budget: 14,
        units: ["duneSentinel", "scourScout", "scourScout"] },
    { name: "Brass Wall", realm: "sand", gate: 12, budget: 14,
        units: ["duneBrute", "windscourBandit", "windscourBandit",
            "dustMage"] },

    // ---- Ash (§6.2, budgets 10→22; Slope Chase is the sub-floor
    //      "handshake" arrival pack by design) ----
    { name: "Slope Chase", realm: "ash", gate: 18, budget: 9,
        units: ["scorchRaider", "scorchRaider", "scorchRaider",
            "smokeMage"] },
    { name: "Pall Trap", realm: "ash", gate: 19, budget: 12,
        units: ["smokeMage", "sootStalker", "sootStalker", "cinderImp",
            "cinderImp", "cinderImp"] },
    { name: "Beacon Route", realm: "ash", gate: 20, budget: 12,
        units: ["cinderSentinel", "scorchRaider", "scorchRaider"] },
    { name: "Jailer Camp", realm: "ash", gate: 22, budget: 12,
        units: ["scorchWarden", "smokeMage", "cinderImp", "cinderImp",
            "cinderImp", "cinderImp"] },
    { name: "Widowmaker", realm: "ash", gate: 24, budget: 12,
        units: ["sootAssassin", "slagBrute", "smokeMage"] },
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

        /** Active realm — selects the pack table rows and the alive cap. */
        this.realm = "cold";
        /** Fallback player level while no progression system is on
         *  SNOWFLOW; tests may set it directly. */
        this.playerLevel = 1;

        /** Director clock, advanced by update(dt) only — frozen frames
         *  advance nothing, matching the registry's own clock discipline. */
        this.time = 0;

        /** Lifetime packs queued — the density probe's spawn counter. */
        this.packsSpawned = 0;

        // ------------------------------------------------------ pack slots
        /** Two independent pack slots, fully preallocated. Slot 0 roams the
         *  travel bearing; slot 1 (armed at floor+2) roams the far bearing.
         *  Fields mirror the old single-pack members/queue verbatim.
         *  @type {{mIds:Int32Array, live:number, dead:number, desp:number,
         *          active:boolean, x:number, z:number, name:(string|null),
         *          qKey:(string|null)[], qX:Float32Array, qZ:Float32Array,
         *          qAt:Float64Array, qCount:number, qNext:number,
         *          nextAt:number}[]} */
        this._slots = [];
        for (let i = 0; i < SLOT_N; i++) {
            this._slots.push({
                mIds: new Int32Array(MAX_PACK).fill(-1),
                live: 0, dead: 0, desp: 0,
                active: false, x: 0, z: 0, name: null,
                qKey: new Array(MAX_PACK).fill(null),
                qX: new Float32Array(MAX_PACK),
                qZ: new Float32Array(MAX_PACK),
                qAt: new Float64Array(MAX_PACK),
                qCount: 0, qNext: 0,
                nextAt: 0,
            });
        }

        // --------------------------------------------- cleared-area ring
        this._areaX = new Float32Array(MAX_AREAS);
        this._areaZ = new Float32Array(MAX_AREAS);
        this._areaUntil = new Float64Array(MAX_AREAS);
        this._areaHead = 0;

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

        /** The spawn shrine (world/shrine.js), for the 25 m spawn exclusion.
         *  Wired by main.js after construction; null is a valid state.
         *  @type {{x:number, z:number}|null} */
        this.shrine = null;
    }

    /** Name of a live pack (slot 0 first), for probes and the realm audit.
     * @returns {string|null} */
    get packName() {
        const s = this._slots;
        return s[0].name !== null ? s[0].name : s[1].name;
    }

    /** Slot 0 roam timer — probes zero it to restore the director. */
    get _nextSpawnAt() { return this._slots[0].nextAt; }
    set _nextSpawnAt(v) { this._slots[0].nextAt = v; }
    /** Slot 1 roam timer, same contract. */
    get _nextSpawnAt2() { return this._slots[1].nextAt; }
    set _nextSpawnAt2(v) { this._slots[1].nextAt = v; }

    /**
     * One frame of the director. Order per slot: gate → member poll (deaths,
     * 120 m despawn) → pack-end bookkeeping → pending-queue fire; then roam
     * placement for each idle slot → minimap blips. Allocates nothing in a
     * steady frame.
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

        for (let i = 0; i < SLOT_N; i++) {
            const sl = this._slots[i];
            this._pollMembers(sl, px, pz);

            // Pack over? Every member resolved and nothing left to fire. A
            // pack whose members all DIED clears the area (90 s lock); one
            // the player simply outran (any silent despawn) does not.
            if (sl.active && sl.live === 0 && sl.qNext >= sl.qCount) {
                if (sl.dead > 0 && sl.desp === 0) {
                    this._recordArea(sl.x, sl.z);
                }
                sl.active = false;
                sl.name = null;
                sl.qCount = 0;
                sl.qNext = 0;
                sl.nextAt = this.time +
                    BREATHER_MIN +
                    Math.random() * (BREATHER_MAX - BREATHER_MIN);
            }

            this._fireQueue(sl, px, pz);
        }

        // Roam: keep the slots filled. New packs never start while the shell
        // menu/pause is up (same poll as crosshair.js); live ones above keep
        // simulating regardless. Slot 1 only arms past the two-pack margin.
        const shell = globalThis.FFG ? globalThis.FFG.shell : null;
        const shellUp = !!(shell && shell.phase !== "playing");
        if (!shellUp) {
            const s0 = this._slots[0];
            if (!s0.active && this.time >= s0.nextAt) {
                this._tryRoamSpawn(s0, false);
            }
            const s1 = this._slots[1];
            if (this._twoAllowed() && !s1.active && this.time >= s1.nextAt) {
                this._tryRoamSpawn(s1, true);
            }
        }

        this._rebuildBlips();
    }

    // ------------------------------------------------------------ test API

    /**
     * Force-spawn a named §6.2 pack ahead of travel (slot 0). Replaces all
     * active packs (silent despawn, no cleared-area record), bypasses level
     * gates and cleared-area locks, still honours the 25 m player/shrine
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
        if (!this._findAnchor(true, false)) return false;
        this._clearAll();
        this._queuePack(this._slots[0], p, this._ax, this._az);
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
     *  main.js exports the system as `progression`; `progress` is kept for
     *  the older probe spelling this file documented first.
     * @returns {number} */
    _level() {
        const sf = globalThis.SNOWFLOW;
        const p = sf ? (sf.progress || sf.progression) : null;
        const l = (p && typeof p.level === "number") ? p.level : this.playerLevel;
        return l >= 1 ? l : 1;
    }

    /** Player level clamped UP to the realm band floor — what pack gates and
     *  the two-pack threshold compare against (see the header: the band
     *  floor-clamps every spawned enemy anyway, so a below-band player must
     *  meet the realm's entry packs, not an empty realm).
     * @returns {number} */
    _effLevel() {
        const lv = this._level();
        const floor = REALM_FLOOR[this.realm] || 1;
        return lv < floor ? floor : lv;
    }

    /** Is the second pack slot armed? Owner density directive: two packs at
     *  band-clamped level >= realm floor + 2. @returns {boolean} */
    _twoAllowed() {
        const floor = REALM_FLOOR[this.realm] || 1;
        return this._effLevel() >= floor + TWO_PACK_MARGIN;
    }

    /** Total live members across both slots — the §8.2 cap input.
     * @returns {number} */
    _totalLive() {
        return this._slots[0].live + this._slots[1].live;
    }

    /**
     * Poll every tracked member of one slot: gone-or-dead resolves the slot
     * as a death; live members beyond 120 m are silently despawned.
     * @param {{mIds:Int32Array, live:number, dead:number, desp:number}} sl
     * @param {number} px @param {number} pz @returns {void}
     */
    _pollMembers(sl, px, pz) {
        const reg = this.registry;
        for (let k = 0; k < MAX_PACK; k++) {
            const id = sl.mIds[k];
            if (id < 0) continue;
            const s = reg.slot(id);
            if (s < 0 || reg.hp[s] <= 0) {
                // Removed from the registry (or at 0 hp awaiting removal)
                // without this director despawning it: a kill.
                sl.mIds[k] = -1;
                sl.live--;
                sl.dead++;
                continue;
            }
            const dx = reg.x[s] - px, dz = reg.z[s] - pz;
            if (dx * dx + dz * dz > DESPAWN_SQ) {
                this.enemies.despawn(id);
                sl.mIds[k] = -1;
                sl.live--;
                sl.desp++;
            }
        }
    }

    /**
     * Fire one slot's due queue entries, in order. A point inside the
     * player's 25 m exclusion is pushed out to 30 m along its own bearing;
     * if the pushed point (or the original) still violates an exclusion the
     * head entry is delayed RETRY_S and the queue holds — the stagger
     * ordering, and the hard "never inside 25 m" rule, both survive every
     * path.
     * @param {{qKey:(string|null)[], qX:Float32Array, qZ:Float32Array,
     *          qAt:Float64Array, qCount:number, qNext:number,
     *          mIds:Int32Array, live:number}} sl
     * @param {number} px @param {number} pz @returns {void}
     */
    _fireQueue(sl, px, pz) {
        const cap = ALIVE_CAP[this.realm] || 8;
        while (sl.qNext < sl.qCount && this.time >= sl.qAt[sl.qNext]) {
            const i = sl.qNext;
            let x = sl.qX[i], z = sl.qZ[i];

            let dx = x - px, dz = z - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 < EXCLUDE_SQ) {
                const d = Math.sqrt(d2);
                if (d < 1e-3) { // player parked exactly on the point
                    sl.qAt[i] = this.time + RETRY_S;
                    break;
                }
                const s = PUSH_OUT_M / d;
                x = px + dx * s;
                z = pz + dz * s;
            }
            if (this._shrineNear(x, z, EXCLUDE_M)) {
                sl.qAt[i] = this.time + RETRY_S;
                break;
            }

            sl.qNext++;
            if (this._totalLive() >= cap) continue; // §8.2 cap: unit forfeit

            const key = /** @type {string} */ (sl.qKey[i]);
            // MESH_ENEMY_CONTRACT §5.8.4: never spawn a unit whose body has
            // not streamed in — it would stand invisible until the GLB lands.
            // Requeue with the standard retry; stream() delivers within a few
            // seconds of a realm entering.
            const vis = this.enemies.vis;
            if (vis && vis.ready && !vis.ready(key)) {
                sl.qNext--;   // undo the take; this entry fires next pass
                sl.qAt[i] = this.time + RETRY_S;
                break;
            }
            // Band scaling keys off the REALM, not the unit — passing the
            // unit key here read SCALING.bands["rime_imp"] and crashed boot.
            const lv = this.data.enemyLevelFor(this.realm, this._level());
            const id = this.enemies.spawn(key, x, z, lv);
            if (typeof id !== "number" || id <= 0) continue; // runtime full

            for (let k = 0; k < MAX_PACK; k++) {
                if (sl.mIds[k] < 0) {
                    sl.mIds[k] = id;
                    sl.live++;
                    break;
                }
            }
        }
        if (sl.qNext >= sl.qCount) {
            sl.qCount = 0;
            sl.qNext = 0;
        }
    }

    /** Pick an eligible pack (gate vs band-clamped level, uniform) and queue
     *  it into `sl` at a fresh anchor; on placement failure back off 1 s.
     *  `far` = anchor on the reverse bearing (slot 1). @returns {void} */
    _tryRoamSpawn(sl, far) {
        const lv = this._effLevel();
        let n = 0;
        for (let i = 0; i < PACKS.length; i++) {
            if (PACKS[i].realm === this.realm && PACKS[i].gate <= lv) n++;
        }
        if (n === 0) return;
        if (!this._findAnchor(false, far)) {
            sl.nextAt = this.time + 1;
            return;
        }
        let r = (Math.random() * n) | 0;
        for (let i = 0; i < PACKS.length; i++) {
            if (PACKS[i].realm !== this.realm || PACKS[i].gate > lv) continue;
            if (r === 0) {
                this._queuePack(sl, i, this._ax, this._az);
                return;
            }
            r--;
        }
    }

    /**
     * Find a pack anchor 55–80 m along the travel direction (velocity when
     * moving, facing when planted) — or the REVERSE of it when `far` is set
     * (slot 1's far-bearing placement) — jittering the bearing across
     * PLACE_TRIES candidates. Rejects candidates near the spawn shrine
     * (with the scatter margin) and — unless `ignoreAreas` — inside a live
     * cleared area. Result in `_ax/_az`.
     * @param {boolean} ignoreAreas test-API path skips the 90 s locks
     * @param {boolean} far reverse the bearing (second-pack placement)
     * @returns {boolean}
     */
    _findAnchor(ignoreAreas, far) {
        const c = this.controller;
        let dirX, dirZ;
        if (c.speed > 0.5) {
            dirX = c.velocity.x / c.speed;
            dirZ = c.velocity.z / c.speed;
        } else {
            dirX = Math.sin(c.facing);
            dirZ = -Math.cos(c.facing);
        }
        if (far) { dirX = -dirX; dirZ = -dirZ; }
        for (let t = 0; t < PLACE_TRIES; t++) {
            const ang = t === 0 ? 0 : (Math.random() * 2 - 1) * PLACE_JITTER;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const dx = dirX * ca - dirZ * sa;
            const dz = dirX * sa + dirZ * ca;
            const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
            const ax = c.position.x + dx * dist;
            const az = c.position.z + dz * dist;
            if (!ignoreAreas && this._areaBlocked(ax, az)) continue;
            if (this._shrineNear(ax, az, SHRINE_MARGIN)) continue;
            this._ax = ax;
            this._az = az;
            return true;
        }
        return false;
    }

    /**
     * Queue a pack's units into a slot on the 3–6 m scatter ring around the
     * anchor with the §6.1 stagger: first unit immediate, each next
     * +0.5–2 s.
     * @param {{qKey:(string|null)[], qX:Float32Array, qZ:Float32Array,
     *          qAt:Float64Array, qCount:number, qNext:number,
     *          active:boolean, x:number, z:number, name:(string|null),
     *          dead:number, desp:number}} sl
     * @param {number} p index into PACKS
     * @param {number} ax @param {number} az
     * @returns {void}
     */
    _queuePack(sl, p, ax, az) {
        const pack = PACKS[p];
        const units = pack.units;
        const phase = Math.random() * TWO_PI;
        let t = this.time;
        sl.qCount = 0;
        sl.qNext = 0;
        for (let i = 0; i < units.length && sl.qCount < MAX_PACK; i++) {
            const a = phase + (i / units.length) * TWO_PI;
            const r = SCATTER_MIN + Math.random() * (SCATTER_MAX - SCATTER_MIN);
            const q = sl.qCount++;
            sl.qKey[q] = units[i];
            sl.qX[q] = ax + Math.cos(a) * r;
            sl.qZ[q] = az + Math.sin(a) * r;
            sl.qAt[q] = t;
            t += STAGGER_MIN + Math.random() * (STAGGER_MAX - STAGGER_MIN);
        }
        sl.x = ax;
        sl.z = az;
        sl.active = true;
        sl.name = pack.name;
        sl.dead = 0;
        sl.desp = 0;
        this.packsSpawned++;
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

    /** Is (x, z) within r metres of the spawn shrine? `this.shrine` is the
     *  world/shrine.js formation main.js wires in (null in bare-harness
     *  boots, in which case nothing is excluded). The training-dummy arc this
     *  scan used to protect was removed 2026-08-10 (owner: real enemies
     *  only). Spawn-edge only, never per steady frame.
     * @param {number} x @param {number} z @param {number} r
     * @returns {boolean} */
    _shrineNear(x, z, r) {
        const sh = this.shrine;
        if (!sh) return false;
        const dx = sh.x - x, dz = sh.z - z;
        return dx * dx + dz * dz < r * r;
    }

    /** Despawn every tracked member of every slot and cancel the queues. No
     *  cleared-area record, no breather — callers set their own follow-up
     *  state. @returns {void} */
    _clearAll() {
        for (let i = 0; i < SLOT_N; i++) {
            const sl = this._slots[i];
            for (let k = 0; k < MAX_PACK; k++) {
                const id = sl.mIds[k];
                if (id < 0) continue;
                this.enemies.despawn(id);
                sl.mIds[k] = -1;
            }
            sl.live = 0;
            sl.dead = 0;
            sl.desp = 0;
            sl.qCount = 0;
            sl.qNext = 0;
            sl.active = false;
            sl.name = null;
        }
    }

    /**
     * Realm switch (main.enterRealm): drop every tracked member and the
     * queues so the new realm opens with a clean field, cleared pack names
     * (audit 2026-08-10: sand still reported cold's "Ritual Circle") and a
     * short breather before the first roam of the new table — slot 1 a beat
     * behind slot 0 so the arrival is a pack, then pressure, not a pincer on
     * frame one. The runtime's own clear() sweeps untracked spawns; this is
     * the director's half.
     * @returns {void}
     */
    onRealmChange() {
        this._clearAll();
        this._slots[0].nextAt = this.time + 4;
        this._slots[1].nextAt = this.time + 8;
        this._rebuildBlips();
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
