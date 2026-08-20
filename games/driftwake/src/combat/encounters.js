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
 * RHYTHM (owner directive 2026-08-16: "today it is one identical pack, always
 * dead ahead"). Three variations, all on the SPAWN EDGE, none on a frame path:
 *   BEARING   — slot 0's anchor no longer sits on the travel bearing. Each
 *     spawn takes the next step of a golden-ratio wheel across ±120°, so
 *     consecutive packs arrive from genuinely different quarters and six
 *     spawns span most of the band by construction rather than by luck. Slot 1
 *     keeps its FAR anchor (the density directive's surrounding pressure) with
 *     its own ±60° wheel.
 *   COMPOSITION — one or two members of every pack are swapped for a
 *     different unit OF THE SAME §6.1 COST from the same realm's pack pool, so
 *     the budget the §6.2 row was authored at is preserved exactly while the
 *     silhouette mix changes.
 *   CADENCE   — the breather between packs is no longer a flat 1.5–2.5 s. An
 *     "excitement" scalar in [-1, 1] decays toward 0 and is nudged on every
 *     pack END: a FAST, CLEAN clear (inside FAST_CLEAR_S with little damage
 *     taken) pushes it up and the next pack comes sooner (down to
 *     BREATHER_HOT); a clear that cost the player heavy damage pushes it down
 *     and buys a real breather (out to BREATHER_COLD). The owner's 1.5–2.5 s
 *     band is the NEUTRAL centre of that range, not its whole extent.
 *
 * FODDER PRESSURE (owner directive 2026-08-16, spec pillar "standing still
 * must be dangerous"): cold's two entry packs each carry +2 fodder, and every
 * MELEE fodder unit's post-attack cooldown is cut by `PRESSURE.fodderAttackCd`
 * so its share of the §4.2 two-melee-token pool recycles ~25% faster. See
 * `_applyFodderPressure` for how that one number reaches the enemy runtime and
 * where it really belongs.
 *
 * TEST API (console: SNOWFLOW.encounters.…):
 *   spawnPack("The Hunt")            force-spawn a named §6.2 pack ahead of
 *                                    travel (slot 0) — replaces all active
 *                                    packs, bypasses level gates and
 *                                    cleared-area locks, honours the 25 m
 *                                    exclusions.
 *   spawnRoam(far)                   run the REAL roam path once (bearing
 *                                    wheel + composition jitter + gates), the
 *                                    way the frame would — the rhythm probe's
 *                                    entry point.
 *   spawnAt("rimeImp", x, z, level)  one untracked unit at an explicit spot;
 *                                    level omitted -> data.enemyLevelFor.
 *   packsSpawned                     lifetime count of packs queued — the
 *                                    density probe's spawn counter.
 *   rhythm                           the last 8 spawns' bearings/offsets/
 *                                    compositions and the last 8 breathers.
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
import { TIER, PRESSURE } from "./combatData.js";

/** TEST mode's effective level: opens every realm's pack table at once for a
 *  testing session (owner 2026-08-16). */
const TEST_LEVEL = 10;

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
 *  resulting field sparse — halved 2026-08-13 (density directive). This band
 *  is now the NEUTRAL centre of the rhythm range below (owner 2026-08-16). */
const BREATHER_MIN = 1.5;
const BREATHER_MAX = 2.5;
/** Rhythm extremes (owner 2026-08-16): the breather after a fast, clean clear
 *  and after a clear that cost the player heavy damage. */
const BREATHER_HOT = 1.1;
const BREATHER_COLD = 4.6;
/** A pack cleared inside this, having cost less than HEAVY_DMG_FRAC of the
 *  player's max health, counts as a fast clean clear. */
const FAST_CLEAR_S = 12;
const HEAVY_DMG_FRAC = 0.18;
/** Excitement moves by these per pack END and decays this fast per second. */
const EXCITE_UP = 0.40;
const EXCITE_DOWN = 0.50;
const EXCITE_DECAY = 0.03;
/** Bearing wheels, radians: slot 0 spans ±120° of travel (owner), slot 1 ±60°
 *  of the FAR bearing so the surrounding pressure still comes from behind. */
const BEAR_SPREAD_0 = 2.0944;
const BEAR_SPREAD_1 = 1.0472;
/** Members swapped per pack, and the rhythm ring's depth. */
const MIX_MIN = 1;
const MIX_MAX = 2;
const RHYTHM_LOG = 8;
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
    // FODDER PRESSURE (owner 2026-08-16): cold's two ENTRY packs each carry
    // +2 rime imps over the §6.2 row, budget +2 each — the spec pillar is
    // "standing still must be dangerous" and the entry band was the one place
    // a planted player could out-trade the field without moving.
    { name: "Imp Warren", realm: "cold", gate: 1, budget: 10,
        units: ["rimeImp", "rimeImp", "rimeImp", "rimeImp", "rimeImp",
            "hoarfrostSprite", "rimeImp", "rimeImp"] },
    { name: "The Hunt", realm: "cold", gate: 2, budget: 11,
        units: ["frostStalker", "frostStalker", "rimeImp", "rimeImp",
            "rimeImp", "rimeImp", "rimeImp"] },
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

/** Hashed 0..1 from an integer — the deterministic stand-in for Math.random
 *  on the rhythm's choices, so two runs of the probe see the same wheel.
 *  @param {number} n @returns {number} */
function hash01(n) {
    const h = Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0;
    return ((h >>> 8) & 0xffff) / 65535;
}

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
                // Rhythm bookkeeping: when this pack was queued and how much
                // damage the player had taken by then.
                startedAt: 0, dmgAt0: 0,
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

        // ------------------------------------------------------- rhythm
        /** Excitement, [-1, 1]: >0 = the field presses (shorter breathers),
         *  <0 = the field backs off. Decays toward 0. */
        this.excitement = 0;
        /** A live boss owns the field: slot 1 holds while this is set
         *  (combat/bossEncounters.js writes it; §7 caps a boss's adds). */
        this.bossLive = false;
        /** Monotonic player damage taken, metres of HP — the cadence input.
         *  Polled off the controller, so EVERY damage path counts. */
        this._dmgTotal = 0;
        this._lastHp = -1;
        /** Bearing wheel step, per slot. */
        this._bearSeq = [0, 0];
        /** Composition-jitter step. */
        this._mixSeq = 0;
        /** Scratch member list for the composition jitter (no per-spawn
         *  array allocation). @type {(string|null)[]} */
        this._mix = new Array(MAX_PACK).fill(null);
        /** Per-realm cost buckets: cost -> keys drawn from THAT realm's own
         *  §6.2 rows, so a swap can never field a unit the realm's tables do
         *  not already use. Built once. @type {Record<string, string[][]>} */
        this._costPool = this._buildCostPool();
        /** The rhythm log the probe reads — fixed-size, mutated in place. */
        this.rhythm = {
            n: 0,
            bearing: new Float32Array(RHYTHM_LOG),   // world angle, rad
            offset: new Float32Array(RHYTHM_LOG),    // vs travel bearing, rad
            comp: new Array(RHYTHM_LOG).fill(""),    // composition signature
            slot: new Int8Array(RHYTHM_LOG),
            cadence: new Float32Array(RHYTHM_LOG).fill(-1),
            cadenceN: 0,
            excitement: 0,
        };

        this._applyFodderPressure();
    }

    /**
     * FODDER PRESSURE, the runtime half (owner 2026-08-16: "fodder melee
     * tokens regenerating ~25% faster"). The §4.2 token a fodder unit holds is
     * released at the end of its recovery; what gates its NEXT swing — and so
     * how fast that unit recycles through the two-melee-token pool — is the
     * unit record's post-attack cooldown, which `combat/enemies.js` derives
     * from its role profile. Multiplying it by `PRESSURE.fodderAttackCd`
     * (0.8 = 1.25× the swings per second) is the whole change.
     *
     * It is applied HERE, once, at construction, to the MELEE fodder records
     * only (casters keep their cadence — the directive is about melee), and it
     * is idempotent: a record already stamped is skipped, so a second director
     * (or a hot reload) cannot compound it.
     *
     * RECOMMENDED (enemies.js owner): the honest home for this is `buildUnits`
     * reading `PRESSURE.fodderAttackCd` when it writes `cd: p.cd`. This pass
     * exists because the enemy runtime is not this lane's file; it is a
     * boot-edge stamp, never a frame path, and it is one line to delete once
     * the table reads the number itself.
     * @returns {void}
     */
    _applyFodderPressure() {
        const mult = PRESSURE && PRESSURE.fodderAttackCd;
        const units = this.enemies && this.enemies.units;
        if (!(mult > 0) || mult === 1 || !Array.isArray(units)) return;
        let n = 0;
        for (let i = 0; i < units.length; i++) {
            const u = units[i];
            if (!u || u._fodderPressure) continue;
            if (u.tier !== TIER.FODDER || u.caster) continue;
            u.cd = u.cd * mult;
            u._fodderPressure = mult;
            n++;
        }
        /** Records stamped — the probe's proof the pass ran. */
        this.fodderPressureUnits = n;
    }

    /**
     * Cost buckets per realm, from the pack tables themselves: every key any
     * of that realm's §6.2 rows fields, grouped by its combatData cost. A
     * composition swap draws from the bucket of the member it replaces, so the
     * pack's authored budget is unchanged by construction.
     * @returns {Record<string, string[][]>}
     */
    _buildCostPool() {
        const rows = (this.data && this.data.ENEMIES) || [];
        const costOf = Object.create(null);
        for (let i = 0; i < rows.length; i++) costOf[rows[i].key] = rows[i].cost;
        /** @type {Record<string, string[][]>} */
        const pool = { cold: [], sand: [], ash: [] };
        for (let p = 0; p < PACKS.length; p++) {
            const realm = PACKS[p].realm;
            const bucket = pool[realm];
            if (!bucket) continue;
            const units = PACKS[p].units;
            for (let u = 0; u < units.length; u++) {
                const key = units[u];
                const c = costOf[key];
                if (!(c > 0)) continue;
                if (!bucket[c]) bucket[c] = [];
                if (bucket[c].indexOf(key) < 0) bucket[c].push(key);
            }
        }
        this._costOf = costOf;
        return pool;
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

        // Rhythm inputs: the player's damage ledger and the excitement decay.
        // Polled off the controller so every damage path (melee, projectile,
        // hazard) counts without any system having to report it.
        if (typeof c.health === "number") {
            if (this._lastHp < 0) this._lastHp = c.health;
            else if (c.health < this._lastHp) this._dmgTotal += this._lastHp - c.health;
            this._lastHp = c.health;
        }
        if (this.excitement !== 0) {
            const d = EXCITE_DECAY * dt;
            this.excitement = this.excitement > 0
                ? Math.max(0, this.excitement - d)
                : Math.min(0, this.excitement + d);
        }

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
                sl.nextAt = this.time + this._breatherFor(sl);
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
            // A live boss owns the field: its arena keeps ONE ambient pack for
            // pressure and holds the second (§7 "adds capped at 2-4 fodder").
            if (this._twoAllowed() && !this.bossLive && !s1.active &&
                this.time >= s1.nextAt) {
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
        // EXACT: the force path delivers the NAMED row verbatim. The roam
        // path's composition jitter would quietly swap a member for another
        // unit of the same cost, and a probe that asked for "The Hunt"
        // because it needs its two stalkers must get its two stalkers
        // (_harness/qa_flee.py). Rhythm is for the field, not for the fixture.
        this._queuePack(this._slots[0], p, this._ax, this._az, true);
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
        // TEST mode lifts the level gates too (owner 2026-08-16: "limits
        // nothing by levels") — every realm's pack table opens at once.
        if (p && p.testMode) return Math.max(l, TEST_LEVEL);
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

    /**
     * The breather after a pack END — the rhythm's cadence half. A fast,
     * clean clear presses (BREATHER_HOT); a clear that cost heavy damage buys
     * air (BREATHER_COLD); anything else lands in the owner's 1.5–2.5 s
     * neutral band. The excitement it moves is what carries the read across
     * packs instead of each clear being judged alone.
     * @param {{startedAt:number, dmgAt0:number}} sl
     * @returns {number} seconds
     */
    _breatherFor(sl) {
        const c = this.controller;
        const hpMax = (c && c.healthMax > 0) ? c.healthMax : 100;
        const took = this._dmgTotal - sl.dmgAt0;
        const clearS = this.time - sl.startedAt;
        // The step ACCUMULATES (repeat fast clears keep pressing toward
        // BREATHER_HOT, repeat maulings keep buying air) but it also SETS a
        // floor/ceiling, so one bad fight always earns a real breather even
        // when the player was on a hot streak a moment earlier. Without the
        // clamp a decayed positive scalar can swallow the whole read.
        if (took >= HEAVY_DMG_FRAC * hpMax) {
            this.excitement = Math.max(-1,
                Math.min(this.excitement - EXCITE_DOWN, -EXCITE_DOWN));
        } else if (clearS <= FAST_CLEAR_S) {
            this.excitement = Math.min(1,
                Math.max(this.excitement + EXCITE_UP, EXCITE_UP));
        }
        const mid = (BREATHER_MIN + BREATHER_MAX) * 0.5;
        const e = this.excitement;
        let b = e >= 0
            ? mid + (BREATHER_HOT - mid) * e
            : mid + (BREATHER_COLD - mid) * -e;
        // A hair of hashed jitter so identical clears do not metronome.
        b += (hash01(this.rhythm.cadenceN * 17 + 3) - 0.5) *
            (BREATHER_MAX - BREATHER_MIN) * 0.4;
        if (b < BREATHER_HOT) b = BREATHER_HOT;
        if (b > BREATHER_COLD) b = BREATHER_COLD;

        const k = this.rhythm.cadenceN % RHYTHM_LOG;
        this.rhythm.cadence[k] = b;
        this.rhythm.cadenceN++;
        this.rhythm.excitement = this.excitement;
        return b;
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
     * Run the real roam path once — the rhythm probe's entry point. Honours
     * every gate the frame honours (realm table, level, exclusions, cleared
     * areas); it only skips the roam TIMER.
     * @param {boolean} [far] use slot 1 (far bearing) instead of slot 0
     * @returns {boolean} true if a pack was queued
     */
    spawnRoam(far) {
        const sl = this._slots[far ? 1 : 0];
        const before = this.packsSpawned;
        if (sl.active) this._endSlot(sl);
        this._tryRoamSpawn(sl, !!far);
        return this.packsSpawned > before;
    }

    /** Silently drop a slot's pack (test path — no cleared area, no
     *  breather). @param {object} sl @returns {void} */
    _endSlot(sl) {
        for (let k = 0; k < MAX_PACK; k++) {
            const id = sl.mIds[k];
            if (id < 0) continue;
            this.enemies.despawn(id);
            sl.mIds[k] = -1;
        }
        sl.live = 0; sl.dead = 0; sl.desp = 0;
        sl.qCount = 0; sl.qNext = 0;
        sl.active = false; sl.name = null;
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

        // RHYTHM, bearing half (owner 2026-08-16): step the slot's wheel. The
        // golden-ratio sequence never repeats a quarter twice running and
        // spans its band within a handful of spawns — which a uniform random
        // draw only does on average.
        const slot = far ? 1 : 0;
        const spread = far ? BEAR_SPREAD_1 : BEAR_SPREAD_0;
        const seq = this._bearSeq[slot]++;
        const wheel = (((seq + 1) * 0.618034) % 1) * 2 - 1;   // -1..1
        const bear = wheel * spread;
        {
            const cb = Math.cos(bear), sb = Math.sin(bear);
            const nx = dirX * cb - dirZ * sb;
            const nz = dirX * sb + dirZ * cb;
            dirX = nx; dirZ = nz;
        }
        this._lastBearOffset = bear;

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
            this._lastBearWorld = Math.atan2(dx, dz);
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
     * @param {boolean} [exact] true = the row's composition verbatim (the
     *   `spawnPack` fixture path); omitted = the roam path's jitter
     * @returns {void}
     */
    _queuePack(sl, p, ax, az, exact) {
        const pack = PACKS[p];
        const n = Math.min(pack.units.length, MAX_PACK);
        const units = exact ? pack.units : this._jitterComposition(pack, n);
        const phase = Math.random() * TWO_PI;
        let t = this.time;
        sl.qCount = 0;
        sl.qNext = 0;
        for (let i = 0; i < n && sl.qCount < MAX_PACK; i++) {
            const a = phase + (i / n) * TWO_PI;
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
        sl.startedAt = this.time;
        sl.dmgAt0 = this._dmgTotal;
        this.packsSpawned++;
        this._logSpawn(sl, n);
    }

    /**
     * RHYTHM, composition half: copy the row's units into the scratch list and
     * swap MIX_MIN..MIX_MAX of them for a different unit of the SAME §6.1
     * cost from the same realm's pool. Same budget, different pack.
     * @param {{units:string[], realm:string}} pack @param {number} n
     * @returns {(string|null)[]} the scratch list (valid until the next call)
     */
    _jitterComposition(pack, n) {
        const mix = this._mix;
        for (let i = 0; i < n; i++) mix[i] = pack.units[i];
        const pool = this._costPool[pack.realm];
        if (!pool) return mix;
        const seq = this._mixSeq++;
        const swaps = MIX_MIN +
            ((hash01(seq * 5 + 1) * (MIX_MAX - MIX_MIN + 1)) | 0);
        for (let s = 0; s < swaps; s++) {
            const at = (hash01(seq * 11 + s * 3 + 7) * n) | 0;
            const key = mix[at];
            const bucket = pool[this._costOf[key]];
            if (!bucket || bucket.length < 2) continue;
            // Walk from a hashed start to the first key that differs — a
            // rejection loop would be unbounded, this one is O(bucket).
            const start = (hash01(seq * 23 + s * 13 + 2) * bucket.length) | 0;
            for (let b = 0; b < bucket.length; b++) {
                const cand = bucket[(start + b) % bucket.length];
                if (cand !== key) { mix[at] = cand; break; }
            }
        }
        return mix;
    }

    /** Record one spawn in the rhythm log (bearing, offset, composition).
     *  @param {object} sl @param {number} n @returns {void} */
    _logSpawn(sl, n) {
        const r = this.rhythm;
        const k = r.n % RHYTHM_LOG;
        r.bearing[k] = this._lastBearWorld || 0;
        r.offset[k] = this._lastBearOffset || 0;
        r.slot[k] = sl === this._slots[1] ? 1 : 0;
        let sig = "";
        for (let i = 0; i < n; i++) sig += (i ? "," : "") + sl.qKey[i];
        r.comp[k] = sig;
        r.n++;
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
