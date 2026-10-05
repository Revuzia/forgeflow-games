/**
 * Progression — XP, levels, unlocks, Driftmarks, rested XP, death/respawn and
 * the versioned save blob (_spec/PROGRESSION_DESIGN.md; P1.1 + P1.2 + the
 * §8.1 respawn rule, built against the Damageable registry's event ring).
 *
 * CONSUMES, per damageable.js's contract: the registry's per-frame EVENT RING
 * ("kill" events, type 1), drained by polling — `update()` runs once per frame
 * from `main.js`, AFTER combat updates and BEFORE `registry.endFrame()`
 * clears the ring. Same polled philosophy as the rest of the engine; the
 * steady-frame path allocates nothing (saving allocates, but a save is an
 * event — ding, death, the 30 s timer — never a frame).
 *
 * EVERY NUMBER here traces to _spec/PROGRESSION_DESIGN.md:
 *   §2.1  XP curve: 50 at L1 (flat override), round(85·L^1.9) for 2..29, cap 30
 *   §3.1  BaseKillXP = round(10·L^1.25); min(enemyL, playerL) con base;
 *         per-kill cap = max(12.5% of XP_to_next, BaseKillXP(playerL)) — the
 *         floor is what exempts the early levels (it only binds at L1)
 *   §3.2  tier mults = budget cost ÷ 3 (fodder 1/3 … elite 8/3, boss 10);
 *         boss FIRST kills pay flat 20% (miniboss) / 35% (realm boss) of
 *         XP_to_next, once, tracked in `bossesKilled`, exempt from the cap
 *   §3.3  con colors/multipliers, one table (×1.5 … ×0.05 gray floor)
 *   §3.4  streak +3%/kill from the 5th, 4 s window, cap ×1.5; rested banks
 *         50% of XP_to_next per 8 h away, cap 150%, ×2 pay draining 1:1
 *   §4    ding: full heal+mana; +9% dmg / +7% HP / +5% mana / +3% regen per
 *         level, compounding, anchored at L10 = 100 HP / 100 mana / 9 regen
 *   §7    unlock schedule (internal spell ids per ui/spellbar.js):
 *         L1 Bolt(2)+Wave(1) · L2 Mini-Vortex(3) · L4 Spikes(4) · L6 Great
 *         Vortex(5)
 *   §8.1  death: knockdown fade 1.5 s → respawn at last ACTIVATED shrine
 *         (cold spawn defaults, never null), full pools, 2 s grace; no XP
 *         loss. Activation is BY TOUCH — `update()` scans the registered
 *         network every frame and the first frame inside SHRINE_TOUCH_R of a
 *         new shrine makes it the target and saves, once. The respawn lands
 *         on that shrine's STAND POINT (`world/shrine.js`), never its anchor:
 *         the anchor is the monolith's own axis.
 *   §9    Driftmarks: overflow at cap, cost(n) = round(20000·1.05^(n-1)),
 *         cap 100
 *
 * Multiplier stacking order (§3.4): base × tier × con × streak × rested,
 * then the §3.1 per-kill cap. Boss first-kill flat grants are the single
 * cap exemption (§3.2).
 *
 * SAVE BLOB v2 — localStorage `driftwake_save` (P1.2, schema bumped to 2 for
 * the `deaths` counter): {schemaVer, level, xp, driftmarks, spellsUnlocked,
 * boons, realmsUnlocked, bossesKilled, lastShrineId, restedBank, lastSeenTs,
 * objectiveState, deaths}. Loaded on construct; saved on ding, death, boss
 * first-kill, SHRINE ACTIVATION (the touch edge, once per new shrine) and
 * every 30 s. v3 added `pos`, so CONTINUE resumes the exact stand; a v1/v2
 * blob has none and resumes at the shrine.
 *
 * The shrine network itself is NOT persisted — only `lastShrineId` is. The
 * positions are derived state, republished from `world/shrine.js` on every
 * boot and after every realm re-ground, so a save can name a shrine without
 * pinning coordinates that the landform may have re-chosen.
 *
 * ---------------------------------------------------------------------------
 * SAVE BLOB v4 — THE MEANING LAYER (_spec/QUEST_DESIGN.md §8, lane Q)
 *
 * v4 = v3's core fields + two new core fields this file owns + any number of
 * SAVE SECTIONS other systems register without editing this file:
 *
 *   shrinesLit  {cold:[id…], sand:[id…], ash:[id…]} — which shrines have ever
 *               been ACTIVATED, per realm. QUEST §8 does not list it, but §2
 *               ("activate 3 of the 6 ring shrines"), §5 (fast travel "to any
 *               other activated shrine") and §7 (map: "activated vs dormant
 *               shrines") are all impossible without it, and the activation
 *               fact is this file's (the touch edge lives here).
 *   playTime    seconds of GAME time across the run — the journal's "play
 *               time" stat (QUEST §7). Frozen frames add nothing.
 *
 *   registerSaveSection(name, {serialize() -> JSON value, deserialize(v, info)})
 *     `name` is a top-level blob key ("quest", "relics", "wakeGlass") or a
 *     DOTTED path ("quest.caches") that nests under another section — which
 *     is how side content lands exactly where §8 draws it (quest.caches,
 *     quest.trials, quest.bounties, quest.lore) without the quest engine
 *     owning it. Core field names are reserved (the call throws).
 *     `deserialize(value, info)` runs IMMEDIATELY on registration (with the
 *     blob this file already loaded), again on every `load()` (CONTINUE) and
 *     on `newGame()` (PLAY) with `value === undefined`. A section missing
 *     from the blob — every v1-v3 save — also arrives as `undefined`: it must
 *     default. `info = {reason: "register"|"load"|"new", schemaVer, legacy}`;
 *     `legacy` is true for a blob written before v4 (a veteran character).
 *   Saved on every `save()`; a section that was LOADED but whose owner has
 *   not registered (yet) is written back verbatim, so construction order can
 *   never drop data, and a throwing serialize() keeps its last loaded value.
 *
 *   `boons` left the core list in v4: v1-v3 wrote an always-empty array
 *   (nothing ever read it — QUEST §0), and §8 gives the key to the boon
 *   system's `[{bossKey, pick}]`. An old `[]` reaches that section intact.
 *
 * EVENTS this file emits on the meaning-layer bus (quests/events.js):
 *   'shrine:activated' {realm, id, x, z, first} — the touch edge below.
 *       first = this shrine had never been lit IN THIS REALM.
 *   'enemy:killed'     {realm, key, id, x, z, tier, bounty} — one per kill
 *       event drained from the registry (training dummies excluded). This
 *       file is the ONE place the kill ring is turned into bus events, so no
 *       other system has to sit inside the registry drain window.
 *       key = the enemy runtime's combatData key when `attach({enemies})`
 *       has been called (else the registry display name); bounty = whatever
 *       `this.bountyOf(id)` returns (null when no bounty system hooks it).
 *   'player:levelup'   {level} — once per level gained.
 *   'player:died'      {realm, x, z} — the hp<=0 edge.
 */

import { TIER } from "../combat/damageable.js";
import { bus } from "../quests/events.js";

/** The one localStorage key. */
export const SAVE_KEY = "driftwake_save";
/** Current save schema. v1-v3 blobs load with defaulted new fields.
 *  v3 added `pos` (auto-save position, owner 2026-08-10); v4 added
 *  `shrinesLit`, `playTime` and registered save sections (QUEST §8). */
export const SCHEMA_VER = 4;

/**
 * Core blob keys this file writes itself. A save section may not claim one —
 * `registerSaveSection` throws — so no system can clobber the character.
 */
export const CORE_KEYS = Object.freeze([
    "schemaVer", "level", "xp", "driftmarks", "spellsUnlocked",
    "realmsUnlocked", "bossesKilled", "bossGates", "lastShrineId",
    "restedBank", "lastSeenTs", "objectiveState", "deaths", "pos",
    "shrinesLit", "playTime",
]);

/** Realm tokens the lit-shrine map is keyed by. */
const REALMS = ["cold", "sand", "ash"];

/**
 * §8.1 ACTIVATION RADIUS, m (owner 2026-08-19). Come within this of any
 * registered shrine and it becomes the respawn target — silently, no modal,
 * no prompt. The activation edge is the only thing that saves; standing at a
 * shrine for a minute writes once, not once per frame.
 *
 * This is the trigger the network shipped WITHOUT: `addShrine()` — the only
 * writer of `lastShrineId` besides the `"cold_spawn"` default and the save
 * blob — had zero call sites, because `world/shrine.js`'s `register()`
 * deliberately goes through `registerShrine()` ("WITHOUT touching
 * lastShrineId", shrine.js) and nothing else ever detected a touch. Six of
 * the seven shrines were therefore decorative: every death in every realm
 * resolved through the `|| this.shrines.cold_spawn` fallback in `_respawn()`
 * and landed on the spawn monument.
 */
export const SHRINE_TOUCH_R = 6.0;

/** PROGRESSION §3.5 — the tutorial first-blood grant, flat XP, once a run. */
export const FIRST_BLOOD_XP = 20;

/**
 * Spell unlock levels by INTERNAL spell id (§7 mapped through the owner
 * binds — combat doc §1.1: LMB/id 2 = Frost Bolt, key 1/id 1 = Wave,
 * key 2/id 3 = Mini-Vortex, key 3/id 4 = Spikes, key 4/id 5 = Great Vortex).
 * The spellbar renders its `.locked` level tags from this same table, so the
 * tag and the gate can never disagree.
 * @type {Record<number, number>}
 */
/** Owner ladder 2026-08-13: wave L2, bloom L4, spikes L6, vortex L8.
 *  (id 2 = the unbound stream; kept at 1 so a re-bind never locks.) */
export const UNLOCK_LEVEL = { 2: 1, 1: 2, 3: 4, 4: 6, 5: 8 };

/**
 * Every tunable in one bag, so a data override (or a future realm variant)
 * swaps numbers without touching logic. Values are the spec's, cited above.
 */
export const DEFAULT_DATA = {
    levelCap: 30,                       // §1
    xpL1: 50,                           // §2.1 flat override
    xpCoef: 85, xpExp: 1.9,             // §2.1
    killXP: {
        baseCoef: 10, baseExp: 1.25,    // §3.1
        /** §3.2 — budget cost ÷ 3, indexed by TIER; BOSS row = repeat mult. */
        tierMult: [1 / 3, 2 / 3, 1, 5 / 3, 8 / 3, 10],
        capFrac: 0.125,                 // §3.1 per-kill cap (EQ 1/8 rule)
        firstKill: { miniboss: 0.20, boss: 0.35 },  // §3.2 / §3.5
        streak: { start: 5, per: 0.03, window: 4, cap: 1.5 },  // §3.4
        rested: { hours: 8, frac: 0.5, capFrac: 1.5 },         // §3.4
    },
    growth: {                           // §4, anchored at L10 (§1)
        anchor: 10,
        hp: 1.07, hpAnchor: 100,
        mana: 1.05, manaAnchor: 100,
        regen: 1.03, regenAnchor: 9,
        dmg: 1.09,
    },
    driftmarks: { baseCost: 20000, growth: 1.05, cap: 100 },   // §9
    deathFadeSec: 1.5,                  // §8.1 knockdown fade
    respawnGraceSec: 2,                 // §8.1 i-frame grace
    autosaveSec: 30,                    // P1.2 interval
};

/**
 * XP required to leave level L (§2.1). Undefined past the cap by design; the
 * cap's analog for grants/caps is the Driftmark cost (§9 — "Driftmark XP
 * still obeys con/gray rules"), served by Progression._need().
 * @param {number} L @param {typeof DEFAULT_DATA} [d] @returns {number}
 */
export function xpToNext(L, d) {
    const dd = d || DEFAULT_DATA;
    if (L <= 1) return dd.xpL1;
    return Math.round(dd.xpCoef * Math.pow(L, dd.xpExp));
}

/**
 * Base kill value at a level (§3.1) — medium tier, even con.
 * @param {number} L @param {typeof DEFAULT_DATA} [d] @returns {number}
 */
export function baseKillXP(L, d) {
    const dd = d || DEFAULT_DATA;
    return Math.round(dd.killXP.baseCoef * Math.pow(L, dd.killXP.baseExp));
}

/**
 * Con multiplier from level difference (§3.3 — the same table the UI colors
 * from, so the color can never lie). diff = enemyLevel − playerLevel.
 * @param {number} diff @returns {number}
 */
export function conMult(diff) {
    if (diff >= 5) return 1.5;      // skull
    if (diff >= 3) return 1.25;     // orange
    if (diff >= -3) return 1.0;     // yellow / white
    if (diff === -4) return 0.75;   // green
    if (diff === -5) return 0.5;    // green
    if (diff === -6) return 0.25;   // green
    return 0.05;                    // gray — 5% floor, never 0 (D2 rule)
}

/**
 * Driftmark n's cost (§9), n = 1-based mark index.
 * @param {number} n @param {typeof DEFAULT_DATA} [d] @returns {number}
 */
export function driftmarkCost(n, d) {
    const dm = (d || DEFAULT_DATA).driftmarks;
    return Math.round(dm.baseCost * Math.pow(dm.growth, n - 1));
}

export class Progression {
    /**
     * @param {import("../character/controller.js").CharacterController} controller
     *   Owns the pools this system grows (`healthMax`/`manaMax`/`manaRegen`)
     *   and the position the respawn writes. `controller.terrain` supplies
     *   the respawn ground height.
     * @param {import("../combat/damageable.js").DamageableRegistry|null} registry
     *   Kill-event source. Null is legal (enemies not built yet) — every
     *   registry read is guarded, so this file ships ahead of the substrate.
     * @param {typeof DEFAULT_DATA} [data] Number overrides; defaults to the
     *   spec table above.
     */
    constructor(controller, registry, data) {
        this.controller = controller;
        this.registry = registry || null;
        this.data = data || DEFAULT_DATA;

        // ------------------------------------------------- persisted state
        this.level = 1;
        /** XP into the current level (overflow-to-Driftmarks at cap, §9). */
        this.xp = 0;
        this.driftmarks = 0;
        this.deaths = 0;
        /**
         * Unlocked INTERNAL spell ids. IDENTITY IS STABLE — `attach()` hands
         * this exact Set to the spell system's dispatch gate and the spellbar,
         * so it is only ever mutated, never reassigned.
         * @type {Set<number>}
         */
        this.unlocked = new Set();
        /** Level limits lifted for testing? See `setTestMode`. */
        this.testMode = false;

        /** Where the run last stood: {x, z, facing, realm} or null. Written
         *  into every save via `_posFor` (main.js wires it to the live
         *  controller) and read back by the CONTINUE flow so a run resumes
         *  exactly where it ended — not at the spawn (owner 2026-08-10).
         *  v1/v2 blobs have no `pos`; null falls back to the shrine spawn.
         *  @type {{x:number, z:number, facing:number, realm:string}|null} */
        this.savedPos = null;
        /** Live position provider, set by main.js. Null in bare harnesses.
         *  @type {(() => {x:number, z:number, facing:number, realm:string})|null} */
        this._posFor = null;
        /** @type {string[]} shrine boon picks (§8.3; P3.3 populates). */
        this.boons = [];
        /** @type {string[]} */
        this.realmsUnlocked = ["cold"];
        /** @type {Record<string, boolean>} first-kill flags, by boss name (§3.2). */
        this.bossesKilled = {};
        /**
         * INTEGRATION HOOK — realm-gate persistence (lane F3).
         * `bossEncounters` mirrors each raised realm gate here beside the
         * killed flag (bossEncounters.js:941) and reads it back through
         * `_gateFor()` (:489). Declared here so it is never `undefined`, and
         * carried by `save()`/`load()` below so a gate survives a RELOAD, not
         * only a realm change.
         * @type {Record<string, {x:number,z:number,token:string}>}
         */
        this.bossGates = {};
        /** §8.1 — defaults to the cold spawn shrine, never null. */
        this.lastShrineId = "cold_spawn";
        /** Banked rested XP (§3.4), drained 1:1 while it pays ×2. */
        this.restedBank = 0;
        /** Wall-clock ms of the last save; rested accrual reads the delta. */
        this.lastSeenTs = Date.now();
        /** @type {Record<string, number>} per-realm objective chain node (P3.1). */
        this.objectiveState = {};
        /**
         * v4 — shrines ever ACTIVATED, per realm (see the header). Arrays
         * of SHRINE_IDS; mutated in place, never reassigned per realm, so the
         * touch scan reads them without allocating.
         * @type {Record<string, string[]>}
         */
        this.shrinesLit = { cold: [], sand: [], ash: [] };
        /** v4 — game seconds played across the run (journal stat). */
        this.playTime = 0;

        // ------------------------------------------------- meaning layer (v4)
        /** The realm the player is standing in — kept current by the
         *  'realm:entered' bus event (main.js enterRealm) and by
         *  `setRealm()`. Labels shrine activations and deaths. */
        this.realm = "cold";
        /** Registered save sections, sorted shallow-first so a nested
         *  section ("quest.caches") is written into its parent's value.
         *  @type {{name:string, path:string[], impl:{serialize:()=>any,
         *          deserialize:(v:any, info:object)=>void}}[]} */
        this._sections = [];
        /** The last blob read from storage (null on a fresh/new run). Kept
         *  so a section registered AFTER the load still gets its data, and so
         *  an unregistered section is written back verbatim. */
        this._blob = null;
        /** schemaVer of the blob last READ from storage (0 = none). */
        this._loadedVer = 0;
        /** Enemy runtime, for 'enemy:killed' combatData keys (attach()). */
        this.enemies = null;
        /** Optional bounty hook: `(registryId) => bountyId|null`, set by the
         *  bounty system; fills 'enemy:killed'.bounty. */
        this.bountyOf = null;
        this._unsubRealm = bus.on("realm:entered", (p) => {
            if (p && typeof p.realm === "string") this.setRealm(p.realm);
        });

        // ------------------------------------------------- live state
        /**
         * Known shrines: id → {anchor, stand point}. `x, z` is the monument's
         * axis (the identity, what `lastShrineId` names); `sx, sz` is the
         * STAND POINT `_respawn()` actually drops the player on — see
         * `world/shrine.js`'s `_setStand`. The cold spawn is the origin area
         * where main.js places the character; `shrine.register()` fills in
         * the rest through `registerShrine()`, and re-publishes the stand
         * points after every realm re-ground.
         * @type {Record<string, {x:number, z:number, sx:number, sz:number}>}
         */
        this.shrines = {};
        /**
         * The same network as three index-aligned flat arrays. The per-frame
         * touch scan walks THESE, never `Object.keys(this.shrines)` — the
         * steady-frame path allocates nothing, and a `for…in` over a growing
         * object is exactly the kind of thing that quietly starts to.
         * @type {string[]} */
        this._shrineIds = [];
        /** @type {number[]} */
        this._shrineX = [];
        /** @type {number[]} */
        this._shrineZ = [];
        /** Monotonic count of touch ACTIVATIONS this session — the edge, not
         *  the frames spent inside the radius. Live state, never persisted;
         *  it exists so a probe can prove the edge guard saves once. */
        this.shrineActivations = 0;
        this.registerShrine("cold_spawn", 0, 0);
        /** Player spell-damage multiplier, 1.09^(L−10) (§4). SpellSystem
         *  scales outgoing damage by this — pushed into `spells.damageMult`
         *  on attach and on every ding. */
        this.damageMult = 1;
        /** Game-time i-frame deadline after a respawn (§8.1). The enemy
         *  runtime must skip player damage while `isInvulnerable()`. */
        this.graceUntil = 0;
        /** True from hp≤0 until the respawn lands (the §8.1 fade window). */
        this.dead = false;
        /** Monotonic ding counter — the XP HUD polls it for the flash edge. */
        this.dingCount = 0;
        /** Current level's XP requirement (or next Driftmark cost at cap) —
         *  maintained here so the HUD polls two numbers, no formulas. */
        this.xpNeed = xpToNext(1, this.data);
        /** Last grant, for debug probes and the future floater layer. */
        this.lastXP = 0;
        this.lastXPWhy = "";

        /** @type {{unlocked?:Set<number>, damageMult?:number}|null} */
        this.spells = null;
        /** @type {{ding?:() => void}|null} */
        this.hud = null;

        this.time = 0;
        this._saveTimer = 0;
        this._deathT = 0;
        this._streak = 0;
        this._streakAt = -Infinity;
        /** PROGRESSION §3.5 tutorial first-blood already paid this run? One
         *  flag for both payers — a training dummy's kill and the quest
         *  engine's first onboarding kill (QUEST §6.4) — so it pays once. */
        this._dummyFirstBlood = false;

        this.load();
        // Fresh session restore: pools at the loaded level, filled (P1.2
        // restores at the shrine with full pools; position is the integrator's
        // spawn placement, which IS the cold spawn shrine).
        this._applyLevelStats(true);
    }

    /**
     * Late-bind the systems that consume progression state.
     * @param {{spells?: any, hud?: any}} refs `spells` gets the live
     *   `unlocked` Set and `damageMult` pushed onto it (its dispatch gate and
     *   damage scaling read them); `hud` is the XP HUD — its `ding()` hook is
     *   optional because it also polls `dingCount`.
     * @returns {void}
     */
    attach(refs) {
        if (refs.spells) {
            this.spells = refs.spells;
            refs.spells.unlocked = this.unlocked;
            refs.spells.damageMult = this.damageMult;
        }
        if (refs.hud) this.hud = refs.hud;
        // v4: the enemy runtime, so 'enemy:killed' can carry the combatData
        // key (the registry only knows the display name).
        if (refs.enemies) this.enemies = refs.enemies;
    }

    /**
     * The realm the player now stands in. Called by the 'realm:entered' bus
     * listener (and safe to call directly — idempotent). Only labels events
     * and picks the lit-shrine list; it moves nothing.
     * @param {string} token @returns {void}
     */
    setRealm(token) {
        if (typeof token === "string" && REALMS.indexOf(token) >= 0) this.realm = token;
    }

    // --------------------------------------------------------- lit shrines

    /** Has shrine `id` ever been activated in `realm`?
     *  @param {string} realm @param {string} id @returns {boolean} */
    isShrineLit(realm, id) {
        const l = this.shrinesLit[realm];
        return !!l && l.indexOf(id) >= 0;
    }

    /** The lit list for a realm (live array — read, never mutate).
     *  @param {string} realm @returns {string[]} */
    litShrines(realm) {
        let l = this.shrinesLit[realm];
        if (!l) { l = []; this.shrinesLit[realm] = l; }
        return l;
    }

    // ------------------------------------------------------- save sections

    /**
     * v4 SAVE SECTIONS — let a system persist without editing this file (see
     * the header for the whole contract). Registering an existing name
     * replaces it. `deserialize` runs immediately with this file's already-
     * loaded blob.
     * @param {string} name top-level key or dotted path ("quest.caches")
     * @param {{serialize: () => any,
     *          deserialize: (v: any, info: {reason:string, schemaVer:number,
     *                        legacy:boolean}) => void}} impl
     * @returns {() => void} unregister
     */
    registerSaveSection(name, impl) {
        if (typeof name !== "string" || !name) {
            throw new Error("registerSaveSection: name must be a non-empty string");
        }
        const path = name.split(".");
        for (let i = 0; i < path.length; i++) {
            if (!/^[A-Za-z_$][\w$]*$/.test(path[i])) {
                throw new Error("registerSaveSection: bad section name '" + name + "'");
            }
        }
        if (CORE_KEYS.indexOf(path[0]) >= 0) {
            throw new Error("registerSaveSection: '" + path[0] +
                "' is a core progression field");
        }
        if (!impl || typeof impl.serialize !== "function" ||
            typeof impl.deserialize !== "function") {
            throw new Error("registerSaveSection: impl needs serialize() and deserialize()");
        }
        const at = this._sectionIndex(name);
        if (at >= 0) this._sections.splice(at, 1);
        const entry = { name, path, impl };
        this._sections.push(entry);
        // Shallow-first, so a child section writes into its parent's value.
        this._sections.sort((a, b) => a.path.length - b.path.length);
        this._deserializeOne(entry, "register");
        return () => {
            const i = this._sections.indexOf(entry);
            if (i >= 0) this._sections.splice(i, 1);
        };
    }

    /**
     * The value a (possibly dotted) section had in the blob last READ or
     * WRITTEN — undefined if none. A parent section's serializer (the quest
     * engine's `quest`) starts from this so a child it does not own
     * (`quest.caches`, `quest.trials` …) keeps its newest value even while
     * that child's owner is not registered.
     * @param {string} name @returns {any}
     */
    lastSaved(name) {
        return pathGet(this._blob, String(name).split("."));
    }

    /** @param {string} name @returns {number} */
    _sectionIndex(name) {
        for (let i = 0; i < this._sections.length; i++) {
            if (this._sections[i].name === name) return i;
        }
        return -1;
    }

    /** Hand one section its slice of the current blob.
     *  @param {{path:string[], name:string, impl:any}} s
     *  @param {string} reason @returns {void} */
    _deserializeOne(s, reason) {
        const b = this._blob;
        // The version READ from storage (a save since then does not make an
        // old character new). 0 = no stored run at all.
        const ver = b ? this._loadedVer : 0;
        const info = { reason, schemaVer: ver, legacy: ver > 0 && ver < SCHEMA_VER };
        try {
            s.impl.deserialize(pathGet(b, s.path), info);
        } catch (e) {
            console.error("[progression] save section '" + s.name +
                "' failed to deserialize:", e);
        }
    }

    /** Re-deserialize every registered section (load / new game).
     *  @param {string} reason @returns {void} */
    _deserializeAll(reason) {
        // Snapshot: a deserializer may (legally) register another section.
        const list = this._sections.slice();
        for (let i = 0; i < list.length; i++) this._deserializeOne(list[i], reason);
    }

    /**
     * Register a shrine and mark it as the respawn target (§8.1 activation
     * by touch — P0.2's network calls this).
     * @param {string} id @param {number} x @param {number} z
     * @returns {void}
     */
    addShrine(id, x, z) {
        this.registerShrine(id, x, z);
        this.lastShrineId = id;
        this.save();
    }

    /**
     * [INTEGRATOR] Register a shrine as a respawn TARGET without activating
     * it — the other half of §8.1, and the method `world/shrine.js`'s
     * `register(progression)` has always called (shrine.js:360). It did not
     * exist: Progression shipped only `addShrine`, which sets
     * `lastShrineId`. The two are genuinely different operations and neither
     * substitutes for the other —
     *
     *   addShrine       = "the player TOUCHED this one": it becomes the
     *                     respawn point (§8.1 activation by touch).
     *   registerShrine  = "this one EXISTS": it joins the network so a later
     *                     activation, or a save blob naming it, can resolve.
     *
     * Registering the network through `addShrine` would have made the LAST
     * shrine written the respawn point, which is exactly what shrine.js's
     * own contract says must not happen ("WITHOUT touching `lastShrineId`").
     * So the spawn stays the respawn target until a touch moves it, and
     * `_respawn()` can resolve any of the seven ids instead of always
     * falling through to `cold_spawn`.
     *
     * No `save()` here: registration is derived state rebuilt from the world
     * on every boot, and saving on each of the seven would be seven
     * localStorage writes during construction.
     * Re-callable: `world/shrine.js` calls this again after every post-swap
     * re-ground, because the anchors are frozen but the STAND POINTS are
     * re-chosen against the new realm's landform. Re-registering an existing
     * id updates it in place and never grows the flat arrays.
     *
     * @param {string} id @param {number} x @param {number} z
     * @param {number} [sx] stand point x — where a respawn actually lands.
     *   Defaults to the anchor, which is what a caller that has no formation
     *   around its shrine (a test, a future non-monument checkpoint) wants.
     * @param {number} [sz] stand point z
     * @returns {void}
     */
    registerShrine(id, x, z, sx, sz) {
        const stx = Number.isFinite(sx) ? sx : x;
        const stz = Number.isFinite(sz) ? sz : z;
        const known = this.shrines[id];
        if (known) {
            known.x = x; known.z = z; known.sx = stx; known.sz = stz;
        } else {
            this.shrines[id] = { x, z, sx: stx, sz: stz };
        }
        // Keep the scan arrays index-aligned with the map.
        const at = this._shrineIds.indexOf(id);
        if (at < 0) {
            this._shrineIds.push(id);
            this._shrineX.push(x);
            this._shrineZ.push(z);
        } else {
            this._shrineX[at] = x;
            this._shrineZ[at] = z;
        }
    }

    /**
     * §8.1 ACTIVATION BY TOUCH — one frame of the shrine proximity scan.
     * Called from `update()`; allocation-free (flat arrays, squared
     * distances, no `Math.hypot`, no iterator).
     *
     * EDGE-GUARDED, and the guard is `id !== lastShrineId`: coming within
     * SHRINE_TOUCH_R of a NEW shrine writes the target and saves ONCE, and
     * every subsequent frame inside that radius is a compare and a return.
     * Walking away and back is not a new activation either — same id. That
     * also makes the post-respawn frames free: a respawn lands on its own
     * shrine's stand point, 4.5 m from the anchor and therefore inside the
     * radius, but the id already matches.
     *
     * No modal and no XP by owner decision (2026-08-19). v4 (QUEST §5/§8):
     * the edge is ALSO "not yet lit in this realm" — the spawn shrine is the
     * default respawn target from frame one (§8.1, `lastShrineId` never null)
     * but it is not LIT until touched, and touching it is quest step cold.1.
     * So the edge fires when the nearest in-radius shrine is either unlit in
     * the current realm (first: true — it joins `shrinesLit`) or lit but not
     * the current respawn target (first: false — the §8.1 re-target). Both
     * save once and emit 'shrine:activated'; every other frame inside the
     * radius is a compare and a return, as before.
     * @returns {void}
     */
    _touchShrines() {
        const c = this.controller;
        const p = c && c.position;
        if (!p) return;
        const ids = this._shrineIds;
        let best = -1;
        let bestD2 = SHRINE_TOUCH_R * SHRINE_TOUCH_R;
        for (let i = 0; i < ids.length; i++) {
            const dx = p.x - this._shrineX[i];
            const dz = p.z - this._shrineZ[i];
            const d2 = dx * dx + dz * dz;
            // `<` not `<=`, and nearest-wins, so two shrines that ever came
            // within 12 m of each other would still resolve deterministically.
            if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        if (best < 0) return;
        const id = ids[best];
        const lit = this.litShrines(this.realm);
        const first = lit.indexOf(id) < 0;
        if (!first && id === this.lastShrineId) return;
        if (first) lit.push(id);
        this.lastShrineId = id;
        this.shrineActivations++;
        this.save();
        bus.emit("shrine:activated", {
            realm: this.realm, id,
            x: this._shrineX[best], z: this._shrineZ[best], first,
        });
    }

    /** §8.1 respawn grace / death window — enemies must not damage through
     *  it. @returns {boolean} */
    isInvulnerable() {
        return this.dead || this.time < this.graceUntil;
    }

    /**
     * One frame: drain kill events, watch for death, tick the autosave.
     * Runs AFTER combat updates and BEFORE `registry.endFrame()` (the
     * damageable.js consumer contract). Allocates nothing.
     * @param {number} dt @returns {void}
     */
    update(dt) {
        this.time += dt;
        this.playTime += dt;

        // ---- kill events → XP (registry may not exist yet; guarded).
        const r = this.registry;
        if (r) {
            const n = r.eventCount;
            for (let e = 0; e < n; e++) {
                if (r.evType[e] !== 1) continue;
                // Training dummies pay NO kill XP — the respawning totems
                // were an infinite farm (QA exploit #1). One-time 20 XP
                // first-blood grant, then silence. evKind is stamped at
                // emit time, so this survives slot removal.
                if (r.evKind[e] === "dummy") {
                    this.grantFirstBlood();
                    continue;
                }
                const id = r.evId[e];
                // Read the key BEFORE the XP grant: a ding inside addXP saves
                // but never removes bodies, so the order is only for clarity.
                const key = bus.count("enemy:killed") > 0 ? this._keyOf(id) : null;
                this._onKill(id, r.evTier[e]);
                // v4: the meaning layer's kill fact. Payload built only when
                // something listens — kills are events, never a frame path.
                if (bus.count("enemy:killed") > 0) {
                    bus.emit("enemy:killed", {
                        realm: this.realm, key, id,
                        x: r.evX[e], z: r.evZ[e], tier: r.evTier[e],
                        bounty: this.bountyOf ? (this.bountyOf(id) || null) : null,
                    });
                }
            }
        }

        // ---- §8.1 shrine activation by touch. BEFORE the death block, so a
        // player who dies standing on a shrine has already activated it and
        // respawns there rather than at whatever they touched last. Skipped
        // while dead: the corpse must not re-target the network during the
        // fade, and `_respawn()` teleports through the radius.
        if (!this.dead) this._touchShrines();

        // ---- death → fade → respawn (§8.1).
        const c = this.controller;
        if (!this.dead && c.health <= 0) {
            this.dead = true;
            this._deathT = 0;
            this.deaths++;
            bus.emit("player:died", {
                realm: this.realm, x: c.position.x, z: c.position.z,
            });
        }
        if (this.dead) {
            this._deathT += dt;
            if (this._deathT >= this.data.deathFadeSec) this._respawn();
        }

        // ---- autosave (30 s of game time; frozen frames don't count).
        this._saveTimer += dt;
        if (this._saveTimer >= this.data.autosaveSec) {
            this._saveTimer = 0;
            this.save();
        }
    }

    /**
     * Grant XP. Kills arrive here pre-multiplied and pre-capped from
     * `_onKill`; objective/shrine grants (§3.5) call this directly. Handles
     * level-ups (the ding), the cap overflow into Driftmarks, and saving.
     * @param {number} n whole XP
     * @param {string} [why] provenance tag ("kill", "boss-first", "shrine"…)
     * @returns {void}
     */
    addXP(n, why) {
        if (!(n > 0)) return;
        this.lastXP = n;
        this.lastXPWhy = why || "";
        this.xp += n;

        const cap = this.data.levelCap;
        if (this.level >= cap) {
            this._mintDriftmarks();
            return;
        }
        const from = this.level;
        let dinged = false;
        while (this.level < cap && this.xp >= this.xpNeed) {
            this.xp -= this.xpNeed;
            this.level++;
            dinged = true;
            this._refreshNeed();
            this._unlockCheck();
        }
        if (dinged) {
            // §4 — full heal + full mana, stat growth, no modal.
            this._applyLevelStats(true);
            this.dingCount++;
            if (this.hud && this.hud.ding) this.hud.ding();
            if (this.level >= cap) this._mintDriftmarks();
            this.save();
            // v4: one event per level gained, AFTER the stats and the save,
            // so a listener reading the controller sees the new pools.
            for (let L = from + 1; L <= this.level; L++) {
                bus.emit("player:levelup", { level: L });
            }
        }
    }

    /**
     * PROGRESSION §3.5 "Training dummy first-blood (tutorial, once) — 20 XP
     * flat". Objective income (§3.5), so it is outside the per-kill cap. The
     * dummies left the game (owner 2026-08-10); the tutorial is now QUEST §6,
     * whose engine pays this on the first onboarding kill. Once per run,
     * whichever payer asks first.
     * @returns {boolean} true if it paid now
     */
    grantFirstBlood() {
        if (this._dummyFirstBlood) return false;
        this._dummyFirstBlood = true;
        this.addXP(FIRST_BLOOD_XP, "first-blood");
        return true;
    }

    /** Unlock level for an internal spell id (spellbar lock badges). */
    unlockLevelOf(id) {
        return UNLOCK_LEVEL[id] || 1;
    }

    /**
     * Is there a saved run to continue? Read-only — the title screen asks
     * this before drawing CONTINUE.
     * @returns {boolean}
     */
    hasSave() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return false;
            const b = JSON.parse(raw);
            return !!b && typeof b.level === "number";
        } catch (e) {
            return false;
        }
    }

    /** One-line summary of the save, for the CONTINUE caption.
     *  @returns {string} */
    saveSummary() {
        try {
            const b = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
            if (!b || typeof b.level !== "number") return "";
            const deaths = b.deaths || 0;
            return "Level " + b.level + (deaths ? "  ·  " + deaths +
                (deaths === 1 ? " death" : " deaths") : "");
        } catch (e) {
            return "";
        }
    }

    /**
     * Start a NEW run: wipe the saved blob and reset every persisted field to
     * a level-1 character, then re-apply the level-1 pools to the controller.
     * The title screen's PLAY calls this (its confirm gate is the shell's).
     * @returns {void}
     */
    newGame() {
        try {
            localStorage.removeItem(SAVE_KEY);
        } catch (e) { /* storage denied: the reset below still holds */ }
        this.level = 1;
        this.xp = 0;
        this.driftmarks = 0;
        this.deaths = 0;
        this.restedBank = 0;
        this.lastSeenTs = Date.now();
        this.boons = [];
        // A MAP, not an array — the field is keyed by boss name everywhere
        // that touches it (`_onKill` line ~603, `bossEncounters.js:444/674`).
        // As `[]` those writes land as non-index properties, which
        // `JSON.stringify` DROPS, so every boss first-kill flag earned after a
        // NEW RUN was lost on the next load: the boss re-armed and its
        // cap-exempt §3.2 flat grant could be re-earned on every reload.
        this.bossesKilled = {};
        // Gates are earned by the kills above, so they clear with them — a NEW
        // RUN must not inherit the previous run's raised realm gates.
        this.bossGates = {};
        this.realmsUnlocked = ["cold"];
        this.objectiveState = {};
        this.lastShrineId = "cold_spawn";   // §8.1 default, never null
        this.savedPos = null;                // a new run starts at the shrine
        this._dummyFirstBlood = false;
        // v4: nothing lit (the spawn shrine is the respawn DEFAULT, not lit —
        // touching it is quest step cold.1), no play time, and every save
        // section back to its defaults. Lists are cleared in place so any
        // holder of `litShrines(realm)` stays valid.
        for (let i = 0; i < REALMS.length; i++) this.litShrines(REALMS[i]).length = 0;
        this.playTime = 0;
        this._blob = null;
        this._deserializeAll("new");
        // This run is a v4 run from its first save on: a section registered
        // after PLAY must not be told it is reading the PREVIOUS character's
        // legacy blob (the `_loadedVer` of whatever was loaded at boot).
        this._loadedVer = SCHEMA_VER;
        this.unlocked.clear();
        this._refreshNeed();
        this._unlockCheck();
        this._applyLevelStats(true);
        this.save();
    }

    /**
     * Resume the saved run. The blob was already read at construction, so
     * this re-applies it (a NEW RUN may have overwritten live state) and
     * hands the player back their pools.
     * @returns {void}
     */
    continueRun() {
        this.load();
        this._applyLevelStats(true);
    }

    save() {
        this.lastSeenTs = Date.now();
        // v4: start from whatever the loaded blob carried beyond the core —
        // sections whose owner has not registered (yet), and v3's `boons` —
        // so nothing is dropped by construction order. Core fields and
        // registered sections overwrite below.
        const blob = {};
        const old = this._blob;
        if (old && typeof old === "object") {
            for (const k in old) {
                if (CORE_KEYS.indexOf(k) < 0) blob[k] = old[k];
            }
        }
        Object.assign(blob, {
            schemaVer: SCHEMA_VER,
            level: this.level,
            xp: this.xp,
            driftmarks: this.driftmarks,
            // `_earnedUnlocks` and not the live set: a TEST session must not
            // write its granted kit into a real character's save.
            spellsUnlocked: this._earnedUnlocks(),
            realmsUnlocked: this.realmsUnlocked,
            bossesKilled: this.bossesKilled,
            // Realm gates ride the same blob as the kills that raised them
            // (lane F3): without this key a standing gate is lost on reload
            // and the realm re-locks behind a boss that is already dead.
            bossGates: this.bossGates || {},
            lastShrineId: this.lastShrineId,
            restedBank: Math.round(this.restedBank),
            lastSeenTs: this.lastSeenTs,
            objectiveState: this.objectiveState,
            deaths: this.deaths,
            // v3: the exact stand the run ended on. Provider over stored
            // state so every save — level ding, boss flag, autosave tick —
            // carries the CURRENT position without a second call site.
            pos: this._posFor ? this._posFor() : this.savedPos,
            // v4 core.
            shrinesLit: {
                cold: this.litShrines("cold").slice(),
                sand: this.litShrines("sand").slice(),
                ash: this.litShrines("ash").slice(),
            },
            playTime: Math.round(this.playTime),
        });
        // v4 sections, shallow-first (a dotted child lands inside its
        // parent's value). A throwing serializer keeps its loaded value.
        for (let i = 0; i < this._sections.length; i++) {
            const s = this._sections[i];
            let v;
            try {
                v = s.impl.serialize();
            } catch (e) {
                console.error("[progression] save section '" + s.name +
                    "' failed to serialize:", e);
                v = pathGet(old, s.path);
            }
            if (v !== undefined) pathSet(blob, s.path, v);
        }
        // What was just written becomes the blob a late registrant reads.
        this._blob = blob;
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
        } catch (e) {
            // Storage denied/full: play continues, persistence degrades.
        }
    }

    /**
     * Load the blob (v1 or v2 — v1 lacks `deaths`/`objectiveState`, which
     * default). A missing or corrupt blob is a fresh character; a corrupt one
     * is never partially applied. Rested accrual (§3.4) runs here off the
     * `lastSeenTs` delta: 50% of XP_to_next per 8 h away, capped at 150%.
     * @returns {void}
     */
    load() {
        let b = null;
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (raw) b = JSON.parse(raw);
        } catch (e) {
            b = null;
        }
        if (!b || typeof b !== "object" || typeof b.level !== "number") {
            // No run (or a corrupt one, never partially applied): sections
            // still get their defaults, exactly as on a new game.
            this._blob = null;
            this._loadedVer = 0;
            this._refreshNeed();
            this._unlockCheck();
            this._deserializeAll("load");
            return;
        }
        this._blob = b;
        this._loadedVer = typeof b.schemaVer === "number" ? b.schemaVer : 1;

        const cap = this.data.levelCap;
        this.level = Math.max(1, Math.min(cap, Math.floor(b.level)));
        this.xp = Math.max(0, +b.xp || 0);
        this.driftmarks = Math.max(0, Math.min(this.data.driftmarks.cap,
            Math.floor(+b.driftmarks || 0)));
        this.deaths = Math.max(0, Math.floor(+b.deaths || 0));
        this.boons = Array.isArray(b.boons) ? b.boons : [];
        this.realmsUnlocked = Array.isArray(b.realmsUnlocked) && b.realmsUnlocked.length
            ? b.realmsUnlocked : ["cold"];
        this.bossesKilled = (b.bossesKilled && typeof b.bossesKilled === "object")
            ? b.bossesKilled : {};
        // Lane F3: gates restore like the kills. A v1/v2 blob has no key, so
        // an old save simply comes back gateless rather than corrupt.
        this.bossGates = (b.bossGates && typeof b.bossGates === "object")
            ? b.bossGates : {};
        this.lastShrineId = typeof b.lastShrineId === "string" && b.lastShrineId
            ? b.lastShrineId : "cold_spawn";
        this.objectiveState = (b.objectiveState && typeof b.objectiveState === "object")
            ? b.objectiveState : {};
        // v3 pos — all four fields or nothing; a partial blob resumes at the
        // shrine rather than at (0, NaN).
        const bp = b.pos;
        this.savedPos = (bp && typeof bp === "object" &&
            Number.isFinite(+bp.x) && Number.isFinite(+bp.z) &&
            Number.isFinite(+bp.facing) && typeof bp.realm === "string")
            ? { x: +bp.x, z: +bp.z, facing: +bp.facing, realm: bp.realm }
            : null;

        this._refreshNeed();

        // Rested accrual from time away (§3.4). Continuous, pro-rated.
        const rest = this.data.killXP.rested;
        const then = +b.lastSeenTs || Date.now();
        const hoursAway = Math.max(0, (Date.now() - then) / 3600000);
        const accrued = (hoursAway / rest.hours) * rest.frac * this.xpNeed;
        this.restedBank = Math.min(
            Math.max(0, +b.restedBank || 0) + accrued,
            rest.capFrac * this.xpNeed
        );

        // Schedule unlocks for the loaded level, then union the saved list
        // (future boon/augment grants outside the schedule survive).
        this._unlockCheck();
        if (Array.isArray(b.spellsUnlocked)) {
            for (let i = 0; i < b.spellsUnlocked.length; i++) {
                const id = +b.spellsUnlocked[i];
                if (id >= 1 && id <= 5) this.unlocked.add(id);
            }
        }

        // v4 core. A v1-v3 blob has neither key: nothing lit, no play time.
        // Lists refilled IN PLACE (their identity is what the touch scan and
        // any `litShrines()` holder read). Only string ids survive.
        const sl = b.shrinesLit && typeof b.shrinesLit === "object" ? b.shrinesLit : null;
        for (let i = 0; i < REALMS.length; i++) {
            const list = this.litShrines(REALMS[i]);
            list.length = 0;
            const src = sl && Array.isArray(sl[REALMS[i]]) ? sl[REALMS[i]] : null;
            if (!src) continue;
            for (let k = 0; k < src.length; k++) {
                if (typeof src[k] === "string" && list.indexOf(src[k]) < 0) list.push(src[k]);
            }
        }
        this.playTime = Math.max(0, +b.playTime || 0);

        // Sections last: they may read the core fields restored above.
        this._deserializeAll("load");
    }

    /**
     * The enemy runtime's combatData key for a registry id — a scan of its
     * 24-slot pool (event edge only). Falls back to the registry's display
     * name when no enemy runtime is attached or the body is already gone.
     * @param {number} id @returns {string|null}
     */
    _keyOf(id) {
        const en = this.enemies;
        if (en && en.id && en.unitOf && en.units) {
            for (let i = 0; i < en.id.length; i++) {
                if (en.id[i] === id && en.alive[i]) {
                    const u = en.units[en.unitOf[i]];
                    if (u) return u.key || u.name || null;
                }
            }
        }
        const r = this.registry;
        const s = r ? r.slot(id) : -1;
        return s >= 0 ? r.name[s] : null;
    }

    // ------------------------------------------------------------- internals

    /**
     * One kill event → one XP grant, the full §3 pipeline:
     * base(min level) × tier × con × streak × rested, then the per-kill cap —
     * except a boss FIRST kill, which pays the flat §3.2 grant, uncapped.
     * @param {number} id registry id @param {number} tier evTier
     * @returns {void}
     */
    _onKill(id, tier) {
        const r = this.registry;
        const k = this.data.killXP;
        const pl = this.level;

        // The slot usually still exists on the kill frame (removal is the
        // owning body's, later). If it is already gone, the honest fallback
        // is an even-con non-boss kill at the event's recorded tier.
        let el = pl, kind = null, name = null;
        const s = r.slot(id);
        if (s >= 0) {
            el = r.level[s];
            kind = r.kind[s];
            name = r.name[s];
        }

        // Streak window (§3.4): chained kills within 4 s; expiry resets.
        if (this.time - this._streakAt <= k.streak.window) this._streak++;
        else this._streak = 1;
        this._streakAt = this.time;

        // Boss first kill → flat percentage grant, once, cap-exempt (§3.2).
        if (kind === "boss") {
            const key = name || "boss#" + id;
            if (!this.bossesKilled[key]) {
                this.bossesKilled[key] = true;
                // [INTEGRATOR] laneB seam. TIER alone cannot tell the two
                // grants apart: a §2.4 arena variant is BOSS tier for BOTH
                // kinds, so reading tier only paid every mini boss the realm
                // boss's 35% instead of §3.2's 20%. `bossEncounters` writes
                // `bossKindHint` at EMERGENCE (bossEncounters.js:578), which
                // is before the kill can land and outlives `_onDeath` (that
                // clears its own `kind`, not this hint) — so the hint is
                // still standing when this drain runs, one frame later in
                // main.js's order. Non-BOSS tiers keep the miniboss rate,
                // exactly as before.
                const frac =
                    (this.bossKindHint === "mini" || tier !== TIER.BOSS)
                        ? k.firstKill.miniboss : k.firstKill.boss;
                this.addXP(Math.round(frac * this._need()), "boss-first");
                this.save(); // the flag itself must not be lost to a crash
                return;
            }
        }

        // §3.1 formula. min() base: above-level enemies pay YOUR base.
        const base = baseKillXP(Math.min(el, pl), this.data);
        const tm = k.tierMult[tier] !== undefined ? k.tierMult[tier] : 1;
        const cm = conMult(el - pl);
        const sm = this._streak >= k.streak.start
            ? Math.min(k.streak.cap,
                1 + k.streak.per * (this._streak - k.streak.start + 1))
            : 1;
        let xp = base * tm * cm * sm;

        // Rested (§3.4): ×2 while the bank holds, draining 1:1 — implemented
        // as a bonus equal to the pre-rested pay, clipped to the bank, so the
        // last charge pays a partial double instead of a cliff.
        if (this.restedBank > 0) {
            const bonus = Math.min(this.restedBank, xp);
            this.restedBank -= bonus;
            xp += bonus;
        }

        // §3.1 per-kill cap with the BaseKillXP floor (the floor is why an
        // even-con medium kill is never capped, and why L1 works at all).
        const capAmt = Math.max(k.capFrac * this._need(), baseKillXP(pl, this.data));
        this.addXP(Math.round(Math.min(xp, capAmt)), "kill");
    }

    /**
     * The level's XP requirement — or, at cap, the next Driftmark's cost,
     * which is §9's analog for every percentage grant and cap.
     * @returns {number}
     */
    _need() {
        return this.xpNeed;
    }

    /** Recompute `xpNeed` for the current level / mark. @returns {void} */
    _refreshNeed() {
        const d = this.data;
        this.xpNeed = this.level >= d.levelCap
            ? driftmarkCost(Math.min(this.driftmarks + 1, d.driftmarks.cap), d)
            : xpToNext(this.level, d);
    }

    /** Convert overflow XP into Driftmarks at cap (§9). @returns {void} */
    _mintDriftmarks() {
        const dm = this.data.driftmarks;
        let minted = false;
        while (this.driftmarks < dm.cap) {
            const cost = driftmarkCost(this.driftmarks + 1, this.data);
            if (this.xp < cost) break;
            this.xp -= cost;
            this.driftmarks++;
            minted = true;
        }
        if (minted) {
            this._refreshNeed();
            this.dingCount++; // the bar flashes for a mark too (§9 UI)
            if (this.hud && this.hud.ding) this.hud.ding();
            this.save();
        }
    }

    /** Add every schedule unlock at or below the current level (§7).
     *  Mutates the live Set — never reassigns it. @returns {void} */
    _unlockCheck() {
        // TEST MODE (owner 2026-08-16: "for testing I want to be able to use
        // ALL spells, so implement a TEST that limits nothing by levels").
        // Everything opens regardless of level, and it re-asserts here so a
        // level-up, a CONTINUE or a NEW RUN cannot quietly re-lock the kit.
        if (this.testMode) {
            for (const idStr in UNLOCK_LEVEL) this.unlocked.add(+idStr);
            return;
        }
        for (const idStr in UNLOCK_LEVEL) {
            const id = +idStr;
            if (UNLOCK_LEVEL[id] <= this.level) this.unlocked.add(id);
        }
    }

    /**
     * Turn the level limits off (or back on) for a testing session.
     *
     * Deliberately NOT persisted: `save()` writes the unlocks this character
     * has actually EARNED, so a test session cannot inflate a real run's save
     * blob. Reachable as `SNOWFLOW.test(true)` and via the `?test` URL flag.
     * @param {boolean} on @returns {{testMode:boolean, unlocked:number[]}}
     */
    setTestMode(on) {
        this.testMode = !!on;
        if (!this.testMode) {
            // Fall back to what the level actually grants.
            this.unlocked.clear();
        }
        this._unlockCheck();
        return { testMode: this.testMode, unlocked: Array.from(this.unlocked) };
    }

    /** The spells this character has legitimately earned, test mode aside.
     *  @returns {number[]} */
    _earnedUnlocks() {
        if (!this.testMode) return Array.from(this.unlocked);
        const out = [];
        for (const idStr in UNLOCK_LEVEL) {
            const id = +idStr;
            if (UNLOCK_LEVEL[id] <= this.level) out.push(id);
        }
        return out;
    }

    /**
     * Apply §4 growth to the controller's pools, anchored at L10 (§1: at 10
     * the game IS the combat doc — 100 HP, 100 mana, 9 regen, ×1.0 damage).
     * Spec snapshots hold: L1 = 54 HP ×0.46 dmg, L20 = 197 ×2.37,
     * L30 = 387 ×5.60.
     * @param {boolean} heal true = the ding's full heal + mana refill
     * @returns {void}
     */
    _applyLevelStats(heal) {
        const g = this.data.growth;
        const c = this.controller;
        const dL = this.level - g.anchor;
        c.healthMax = Math.round(g.hpAnchor * Math.pow(g.hp, dL));
        c.manaMax = Math.round(g.manaAnchor * Math.pow(g.mana, dL));
        c.manaRegen = g.regenAnchor * Math.pow(g.regen, dL);
        this.damageMult = Math.pow(g.dmg, dL);
        if (this.spells) this.spells.damageMult = this.damageMult;
        if (heal) {
            c.health = c.healthMax;
            c.mana = c.manaMax;
        } else {
            c.health = Math.min(c.health, c.healthMax);
            c.mana = Math.min(c.mana, c.manaMax);
        }
    }

    /**
     * §8.1 respawn: at the last activated shrine (cold spawn by default),
     * full pools, velocity zeroed, 2 s grace. No XP or currency loss.
     * @returns {void}
     */
    _respawn() {
        const c = this.controller;
        const sh = this.shrines[this.lastShrineId] || this.shrines.cold_spawn;
        // The STAND POINT, never the anchor. The anchor IS the monolith's
        // axis — `shrine.js:_buildFormation` puts a 0.34 m radius, 3.6 m tall
        // prism at exactly (x, z) — so writing it verbatim (the shipped
        // `c.position.x = sh.x`) materialised the player INSIDE the ice on
        // every single death. `sx, sz` is the flattest point on a 4.5 m ring,
        // outside the whole 12-prism formation, re-chosen per realm.
        const rx = Number.isFinite(sh.sx) ? sh.sx : sh.x;
        const rz = Number.isFinite(sh.sz) ? sh.sz : sh.z;
        c.position.x = rx;
        c.position.z = rz;
        if (c.terrain && c.terrain.heightAt) {
            c.position.y = c.terrain.heightAt(rx, rz);
        }
        c.velocity.set(0, 0, 0);
        c.vertVel = 0;
        c.airborne = false;
        c.airHeight = 0;
        c.health = c.healthMax;
        c.mana = c.manaMax;
        this.graceUntil = this.time + this.data.respawnGraceSec;
        this.dead = false;
        this._deathT = 0;
        this._streak = 0; // a death breaks the chain
        this.save();
    }
}

// ------------------------------------------------------ save-section paths

/**
 * Read a (possibly dotted) section path out of a blob.
 * @param {any} obj @param {string[]} path @returns {any} undefined if absent
 */
function pathGet(obj, path) {
    let o = obj;
    for (let i = 0; i < path.length; i++) {
        if (!o || typeof o !== "object") return undefined;
        o = o[path[i]];
    }
    return o;
}

/**
 * Write a section value at a (possibly dotted) path. Every parent on the way
 * is SHALLOW-COPIED before the child is written, so a serializer that handed
 * back its live state object never has a sibling section written into it.
 * @param {object} blob @param {string[]} path @param {any} value
 * @returns {void}
 */
function pathSet(blob, path, value) {
    let o = blob;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        const cur = o[k];
        o[k] = (cur && typeof cur === "object" && !Array.isArray(cur))
            ? Object.assign({}, cur) : {};
        o = o[k];
    }
    o[path[path.length - 1]] = value;
}
