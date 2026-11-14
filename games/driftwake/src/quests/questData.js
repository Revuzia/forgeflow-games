/**
 * THE MAIN QUEST SPINE, AS DATA (_spec/QUEST_DESIGN.md §2, §6, §9).
 *
 * Pure data: no imports, no game logic, nothing on a frame path. The engine
 * that walks this table is `quests/questSystem.js`; the words the Echo SPEAKS
 * live in `quests/storyText.js` and are referenced here by ID only
 * ('echo.cold.1'), never inlined.
 *
 * WHAT A STEP IS (QUEST §2: "id, realm, title (<= 40 chars), tracker text
 * (<= 60 chars), completion event, optional waypoint target"):
 *
 *   id        'cold.1' .. 'ash.6'   — stable, persisted as a chain INDEX
 *   realm     the shard whose chain it belongs to
 *   index     position in that chain — `quest.main.<realm>` in the v4 save
 *             is the index of the CURRENT (first incomplete) step; the
 *             chain's length means "chain complete"
 *   title     QUEST §2 verbatim
 *   tracker   the one-line "what now" (identical to storyText.js
 *             STORY.steps[id].tracker — questSystem warns at construction if
 *             the two ever drift)
 *   rule      completion rule, see RULE below
 *   waypoint  waypoint rule, see WAYPOINT below
 *   xpFrac    objective XP, fraction of the CURRENT level's XP_to_next
 *             (PROGRESSION §3.5 "objective step complete" 15%; QUEST §2 "25%
 *             for a Warden step")
 *   echo      storyText.js dialogue id played when the step COMPLETES, or null
 *   unlocks   'mini' | 'realm' — completing this step opens that boss's arena
 *             (QUEST §2 GATING); read by bossEncounters through the
 *             questSystem's `bossUnlocked()` gate
 *   hints     onboarding prompts shown while the step is current (QUEST §6)
 *   forcePack true = the step spawns its own small imp pack (QUEST §6.4)
 *
 * STEP COUNT. The first draft of QUEST §2's heading said "18 steps, 6 per
 * realm", but its own table gave Cold EIGHT steps and said so in words ("Cold
 * has 8 steps (the first three are the onboarding)"). The enumerated table is
 * the more specific statement and is what this file encodes: 8 + 6 + 6 = 20;
 * the heading now reads "20 steps (Cold 8, Sand 6, Ash 6)". storyText.js
 * (lane N) reached the same reading independently.
 *
 * WARDEN STEPS. QUEST §1: each shard is "guarded by two WARDENS" — the mini
 * boss AND the realm boss are both Wardens, so both boss-kill steps pay the
 * 25% Warden rate. (The alternative reading, realm boss only, contradicts the
 * premise's "two".)
 *
 * THE WARDENS ARE THE LIVE BOSSES (orchestrator decision 2026-09-30). The
 * boss steps name exactly what combat/bossEncounters.js spawns — its
 * BOSS_BY_REALM table, read off combat/roster.js bossKind rows:
 *   cold.5 mini  The Icewall            cold.7 realm  Shrinebreaker
 *   sand.3 mini  Gatekeeper of Brass    sand.5 realm  Warden of the Sundered Gate
 *   ash.3  mini  Furnace Guardian       ash.5  realm  Volcanic Plate Knight
 * (The first spec draft's "Break the Shrinebreaker" for the Cold MINI and
 * "The Moraine Elder" for the Cold REALM boss named no live boss.) A step's
 * rule is by KIND ('mini'|'realm'), never by boss key, so the completion
 * fact and the title can only drift if the roster rows change — and then
 * only the title, which _harness/qa_questmachine_node.mjs cross-checks.
 */

/** Chain order across the world. */
export const REALM_ORDER = Object.freeze(["cold", "sand", "ash"]);

/**
 * The first stone of every realm. world/shrine.js SHRINE_IDS are shared by all
 * three realms (the anchors are frozen for the run), so the Sand and Ash spawn
 * shrines are also id "cold_spawn" — storyText.js keys them the same way.
 */
export const SPAWN_SHRINE = "cold_spawn";

/** The six ring anchors — world/shrine.js SHRINE_IDS[1..6]. */
export const RING_SHRINE_IDS = Object.freeze([
    "shrine_e", "shrine_ne", "shrine_nw", "shrine_w", "shrine_sw", "shrine_se",
]);

/** Completion rule types. */
export const RULE = Object.freeze({
    /** shrine:activated for `shrine` in the step's realm (or already lit). */
    SHRINE: "shrine",
    /** quest.surfM >= `meters` — integrated character speed while surfing
     *  (RMB held) and grounded. */
    SURF: "surf",
    /** quest.killsForOnboarding >= `count` — enemy:killed while current. */
    KILLS: "kills",
    /** >= `count` of the six ring shrines lit in the step's realm. */
    RING: "ring",
    /** progression.bossesKilled['<realm>:<kind>'] — the boss:killed fact. */
    BOSS: "boss",
    /** portal:entered from the step's realm (or `to` already unlocked). */
    PORTAL: "portal",
    /** QUEST §9: touch the Cold spawn shrine with the ending condition met. */
    ENDING: "ending",
});

/** Waypoint rule types (QUEST §2 table, last column). */
export const WAYPOINT = Object.freeze({
    NONE: "none",
    SPAWN_SHRINE: "spawnShrine",
    NEAREST_PACK: "nearestPack",
    DORMANT_SHRINE: "dormantShrine",
    BOSS_ARENA: "bossArena",
    PORTAL: "portal",
    /** Ash portal while in Ash, then the Cold spawn shrine (QUEST §9). */
    ENDING: "ending",
});

/** Waypoint labels for targets that have no name of their own (shrines are
 *  named from storyText.js STORY.shrines, bosses from the roster row). */
export const WAYPOINT_LABEL = Object.freeze({
    pack: "The Drift",
    portal: "Portal",
    arena: "Arena",
    shrine: "Shrine",
});

/** Objective XP (PROGRESSION §3.5 / QUEST §2), fractions of XP_to_next. */
export const XP = Object.freeze({
    step: 0.15,
    warden: 0.25,
    /**
     * PROGRESSION §3.5 "Training dummy first-blood (tutorial, once) — 20 XP
     * flat". The dummy arc was removed (owner 2026-08-10); the tutorial is now
     * QUEST §6, so the grant moves to the tutorial's first kill (the first
     * enemy:killed while cold.3 is current). Without it, PROGRESSION §2.1's
     * first-ding arithmetic (which itemises this 20) cannot reach the L1 50 XP
     * inside the onboarding: 8 + 8 + 5 imps x 3 + 8 = 39.
     */
    firstBlood: 20,
});

/** QUEST §6 onboarding numbers. */
export const ONBOARDING = Object.freeze({
    /** cold.2 — "surf 150 m total (RMB held, grounded)". */
    surfM: 150,
    /** §6.3 — the surf prompt hides once the player has surfed this far. */
    surfHintClearM: 20,
    /** cold.3 — "kill 5 enemies". */
    kills: 5,
    /** §6.4 — "a small imp pack is spawned 40 m ahead". Rime Imp is Cold's
     *  fodder swarm unit (combatData ENEMIES), and the realm's priority body
     *  (main.js awaits it at boot), so it is always streamed in. Five = the
     *  kill count the step asks for. */
    packKey: "rimeImp",
    packSize: 5,
    packAheadM: 40,
    /** Members stand on a ring of this radius around the pack centre. */
    packSpreadM: 2.5,
    /** If the forced pack is despawned (realm change, cleanup) before the
     *  step completes, it is re-forced after this long. */
    packRetryS: 6,
});

/** QUEST §6 prompts. `clear` says when the prompt hides:
 *    'surf'  — surfM >= ONBOARDING.surfHintClearM (§6.3)
 *    'step'  — the step completes (§6.4 "appear once")
 *    'ttl'   — after `ttl` seconds (§6.5 one-time panel hint)
 *  Text is storyText.js STORY.hints[id].text; `text` here is the QUEST §6
 *  spelling, used only if storyText lacks the id. */
export const HINTS = Object.freeze({
    "hint.surf": { id: "hint.surf", text: "Hold RMB to surf", clear: "surf" },
    "hint.bolt": { id: "hint.bolt", text: "LMB — Bolt", clear: "step" },
    "hint.arc": { id: "hint.arc", text: "1 — Frost Arc", clear: "step" },
    "hint.journal": { id: "hint.journal", text: "J — Journal, M — Map, E — Interact",
        clear: "ttl", ttl: 12 },
});

/** QUEST §2 GATING: "Grow stronger — reach level 6" (template). */
export const UNDER_LEVEL_TRACKER = "Grow stronger — reach level {level}";

/** QUEST §9.4 — the post-game tracker once the ending has played. The title
 *  is §9.3's text card ("The Drift is mended."), the tracker §9.4 verbatim. */
export const POST_GAME = Object.freeze({
    id: "post",
    title: "The Drift Is Mended",
    tracker: "The world is whole. Ride on.",
});

/** QUEST §9 — "all 21 shrines lit (or the 3 spawn shrines + both bosses of
 *  every realm, whichever is reached)". */
export const ENDING = Object.freeze({ allShrines: 21 });

// ------------------------------------------------------------------ chains

/**
 * @param {string} realm @param {number} index
 * @param {object} s step fields
 * @returns {object} frozen step
 */
function step(realm, index, s) {
    return Object.freeze(Object.assign({
        realm, index, xpFrac: XP.step, echo: "echo." + s.id,
        unlocks: null, hints: null, forcePack: false,
    }, s));
}

const COLD = [
    // ---- §6 onboarding --------------------------------------------------
    { id: "cold.1", title: "The Last Wakecaster", tracker: "Touch the shrine.",
        rule: { type: RULE.SHRINE, shrine: SPAWN_SHRINE },
        waypoint: WAYPOINT.SPAWN_SHRINE },
    { id: "cold.2", title: "Carve Your Wake",
        tracker: "Hold RMB to surf. Carve 150 m of wake.",
        rule: { type: RULE.SURF, meters: ONBOARDING.surfM },
        waypoint: WAYPOINT.NONE, hints: ["hint.surf"] },
    { id: "cold.3", title: "Answer the Drift",
        tracker: "Defeat 5 creatures of the Drift.",
        rule: { type: RULE.KILLS, count: ONBOARDING.kills },
        waypoint: WAYPOINT.NEAREST_PACK, hints: ["hint.bolt", "hint.arc"],
        forcePack: true },
    // ---- the realm shape: kindle 3 -> mini -> all 6 -> realm -> portal ---
    { id: "cold.4", title: "Kindle the Ring",
        tracker: "Awaken 3 of the 6 ring shrines.",
        rule: { type: RULE.RING, count: 3 },
        waypoint: WAYPOINT.DORMANT_SHRINE, unlocks: "mini",
        hints: ["hint.journal"] },
    { id: "cold.5", title: "Break the Icewall",
        tracker: "Find its arena and break it.",
        rule: { type: RULE.BOSS, kind: "mini" },
        waypoint: WAYPOINT.BOSS_ARENA, xpFrac: XP.warden },
    { id: "cold.6", title: "Wake the Anchors",
        tracker: "Awaken all 6 ring shrines.",
        rule: { type: RULE.RING, count: 6 },
        waypoint: WAYPOINT.DORMANT_SHRINE, unlocks: "realm" },
    { id: "cold.7", title: "The Shrinebreaker",
        tracker: "Face the Warden of the Cold in its arena.",
        rule: { type: RULE.BOSS, kind: "realm" },
        waypoint: WAYPOINT.BOSS_ARENA, xpFrac: XP.warden },
    { id: "cold.8", title: "Cross the Drift",
        tracker: "Step through the portal.",
        rule: { type: RULE.PORTAL, to: "sand" },
        waypoint: WAYPOINT.PORTAL },
];

const SAND = [
    { id: "sand.1", title: "Where the Sand Remembers",
        tracker: "Touch the first shrine of the Sand.",
        rule: { type: RULE.SHRINE, shrine: SPAWN_SHRINE },
        waypoint: WAYPOINT.SPAWN_SHRINE },
    { id: "sand.2", title: "Kindle the Ring",
        tracker: "Awaken 3 of the 6 ring shrines.",
        rule: { type: RULE.RING, count: 3 },
        waypoint: WAYPOINT.DORMANT_SHRINE, unlocks: "mini" },
    { id: "sand.3", title: "The Gatekeeper of Brass",
        tracker: "Find the Gatekeeper's arena and break him.",
        rule: { type: RULE.BOSS, kind: "mini" },
        waypoint: WAYPOINT.BOSS_ARENA, xpFrac: XP.warden },
    { id: "sand.4", title: "Wake the Anchors",
        tracker: "Awaken all 6 ring shrines.",
        rule: { type: RULE.RING, count: 6 },
        waypoint: WAYPOINT.DORMANT_SHRINE, unlocks: "realm" },
    { id: "sand.5", title: "Warden of the Sundered Gate",
        tracker: "Face the Warden and his last command.",
        rule: { type: RULE.BOSS, kind: "realm" },
        waypoint: WAYPOINT.BOSS_ARENA, xpFrac: XP.warden },
    { id: "sand.6", title: "Onward, Into Ash",
        tracker: "Step through the portal.",
        rule: { type: RULE.PORTAL, to: "ash" },
        waypoint: WAYPOINT.PORTAL },
];

const ASH = [
    { id: "ash.1", title: "The Burning Shard",
        tracker: "Touch the first shrine of the Ash.",
        rule: { type: RULE.SHRINE, shrine: SPAWN_SHRINE },
        waypoint: WAYPOINT.SPAWN_SHRINE },
    { id: "ash.2", title: "Kindle the Ring",
        tracker: "Awaken 3 of the 6 ring shrines.",
        rule: { type: RULE.RING, count: 3 },
        waypoint: WAYPOINT.DORMANT_SHRINE, unlocks: "mini" },
    { id: "ash.3", title: "The Furnace Guardian",
        tracker: "Douse the Furnace Guardian's fire.",
        rule: { type: RULE.BOSS, kind: "mini" },
        waypoint: WAYPOINT.BOSS_ARENA, xpFrac: XP.warden },
    { id: "ash.4", title: "Wake the Anchors",
        tracker: "Awaken all 6 ring shrines.",
        rule: { type: RULE.RING, count: 6 },
        waypoint: WAYPOINT.DORMANT_SHRINE, unlocks: "realm" },
    { id: "ash.5", title: "The Volcanic Plate Knight",
        tracker: "Face the last Warden in his arena.",
        rule: { type: RULE.BOSS, kind: "realm" },
        waypoint: WAYPOINT.BOSS_ARENA, xpFrac: XP.warden },
    // QUEST §9: the Ash portal leads back to Cold (bossEncounters ringNext);
    // touching the Cold spawn shrine with the ending condition met completes
    // this step and begins the ending. Its echo (the Echo's last three lines)
    // is played BY the ending sequence — storyText.js makes echo.ash.6 the
    // same array as ending.echo "so play it once" — so the engine does not
    // also emit it as ordinary dialogue.
    { id: "ash.6", title: "Mend the Drift",
        tracker: "Pass through the portal. Touch the first shrine.",
        rule: { type: RULE.ENDING },
        waypoint: WAYPOINT.ENDING },
];

/** The spine: realm -> frozen step array, index = chain position. */
export const MAIN = Object.freeze({
    cold: Object.freeze(COLD.map((s, i) => step("cold", i, s))),
    sand: Object.freeze(SAND.map((s, i) => step("sand", i, s))),
    ash: Object.freeze(ASH.map((s, i) => step("ash", i, s))),
});

/** Every step by id. */
export const STEP_BY_ID = Object.freeze((() => {
    const out = {};
    for (const r of REALM_ORDER) for (const s of MAIN[r]) out[s.id] = s;
    return out;
})());

/** Total main steps (20). */
export const MAIN_TOTAL = MAIN.cold.length + MAIN.sand.length + MAIN.ash.length;

/**
 * Per realm, the index of the step whose COMPLETION unlocks each boss —
 * `bossUnlocked(realm, kind)` is `quest.main[realm] > UNLOCK_INDEX[realm][kind]`.
 */
export const UNLOCK_INDEX = Object.freeze((() => {
    const out = {};
    for (const r of REALM_ORDER) {
        out[r] = { mini: Infinity, realm: Infinity };
        for (const s of MAIN[r]) if (s.unlocks) out[r][s.unlocks] = s.index;
        Object.freeze(out[r]);
    }
    return out;
})());

/**
 * Chain index of a step id, or -1.
 * @param {string} id @returns {number}
 */
export function stepIndex(id) {
    const s = STEP_BY_ID[id];
    return s ? s.index : -1;
}

// Build-time sanity: the §2 length limits are part of the contract (the
// tracker panel is sized for them). Fail the import loudly, not the layout.
for (const id in STEP_BY_ID) {
    const s = STEP_BY_ID[id];
    if (s.title.length > 40 || s.tracker.length > 60) {
        throw new Error("questData: " + id + " exceeds the QUEST §2 text limits");
    }
}
