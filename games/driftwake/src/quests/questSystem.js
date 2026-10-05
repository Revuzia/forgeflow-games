/**
 * THE QUEST ENGINE — the main-quest state machine of the meaning layer
 * (_spec/QUEST_DESIGN.md §2, §6, §8, §9; numbers from PROGRESSION_DESIGN §3.5).
 *
 * WHAT IT OWNS
 *   - the current step of each realm's chain (`main.cold/sand/ash` = index of
 *     the first incomplete step in quests/questData.js MAIN),
 *   - completion detection: bus FACTS (shrine:activated, enemy:killed,
 *     boss:killed, portal:entered) plus the few facts no event carries — the
 *     surf distance (character speed integrated while surfing AND grounded)
 *     and the ending touch (the Cold spawn shrine at step ash.6),
 *   - objective XP (15% of the current level's XP_to_next per step, 25% for a
 *     Warden step), granted through `progression.addXP`,
 *   - the QUEST §6 onboarding: one-time hints, the tutorial first-blood, and a
 *     small imp pack FORCED 40 m ahead for cold.3 through `enemies.spawn`,
 *   - the boss QUEST GATE it installs on `bossEncounters.questGate`,
 *   - the waypoint target (re-emitted on CHANGE, never per frame),
 *   - the ending trigger ('ending:begin') and the post-game tracker,
 *   - its own persistence: `progression.registerSaveSection('quest', …)`.
 *
 * WHAT IT EMITS (quests/events.js catalogue)
 *   'quest:step'      {realm, stepId, title, tracker, index, total, progress,
 *                      underLevel, reason} — whenever the TRACKED step, its
 *                      tracker text or its progress changes. `reason` =
 *                      'register'|'load'|'new'|'state'|'progress' (a realm
 *                      change re-evaluates, so it arrives as 'state').
 *                      realm null + stepId 'post' = the post-game line.
 *   'quest:complete'  {realm, stepId, title, xp, rewards:[{kind:'xp', id, amount}]}
 *   'quest:waypoint'  {x, z, realm, label, kind, stepId} | null
 *                      kind = 'shrine'|'pack'|'boss'|'portal'
 *   'dialogue'        {speaker, lines, id[, shrine:{realm,id,name}]} — the
 *                      Echo on each step's completion (storyText echo.<step>)
 *                      and on each shrine's FIRST activation per realm
 *                      (storyText shrine.<realm>.<id>). Lines are looked up by
 *                      ID in storyText.js; none are written here.
 *   'hint'            {id, text, ttl} — ttl 0 = until 'hint:clear'
 *   'hint:clear'      {id}
 *   'ending:begin'    {echoId, lines} — the ending sequence plays the Echo's
 *                      last lines itself (storyText: "play it once"), so
 *                      ash.6 emits NO ordinary 'dialogue'.
 *
 * KILL EVENTS. 'enemy:killed' is emitted by progression.js — the one place
 * the registry's kill ring is drained into the bus (it already sits in the
 * drain window). This file does NOT drain the registry; it only listens.
 *
 * FRAME CONTRACT. `update(dt)` once per frame (after progression.update);
 * `dt === 0` (S.freezeTime) is a strict no-op. The steady frame allocates
 * nothing: completion checks run only when an event marked the state dirty,
 * the waypoint is re-evaluated 4x a second into a preallocated scratch and
 * emitted only when its target changed, and no Math.random is used anywhere
 * (the forced pack stands on a fixed ring).
 *
 * TEST MODE (?test) lifts the bosses' LEVEL floors (bossEncounters reads
 * progression.testMode) but NOT the quest gate — QUEST §2's "?test mode lifts
 * both" is read as both FLOORS (mini 6, realm 8). `bosses.spawnBoss(kind)`
 * remains the force path that bypasses every gate.
 */

import { bus as sharedBus } from "./events.js";
import { STORY } from "./storyText.js";
import {
    REALM_ORDER, SPAWN_SHRINE, RING_SHRINE_IDS, RULE, WAYPOINT, WAYPOINT_LABEL,
    XP, ONBOARDING, HINTS, UNDER_LEVEL_TRACKER, POST_GAME, ENDING, MAIN,
    STEP_BY_ID, MAIN_TOTAL, UNLOCK_INDEX,
} from "./questData.js";
import { enemyLevelFor } from "../combat/combatData.js";
import { SHRINE_TOUCH_R } from "../progression/progression.js";
import { PLAY_RADIUS } from "../terrain/terrain.js";

/** Waypoint re-evaluation period, s of game time. */
const WP_PERIOD = 0.25;
/** A moving waypoint (a pack) re-emits once its target moved this far, m. */
const WP_MOVE_EPS = 6;
/** Pack search radius for pack waypoints, m. */
const PACK_SEARCH_M = 260;
/** Neighbour radius for the "densest nearby pack" (under-level) target, m. */
const PACK_CLUSTER_M = 15;
/** Surf progress is announced in steps of this many metres. */
const SURF_STEP_M = 10;
/** Forced-pack placement keeps this far inside the play-area edge, m. */
const PACK_EDGE_PAD = 60;

/**
 * Tracker lines that are not a step's own. storyText.js (lane N) is the
 * authority for every word shown; questData's copies are only the fallback
 * if a key is missing. The two level floors are pre-filled once here, so an
 * under-level tracker never builds a string on an event either.
 */
const TXT_POST_GAME = (STORY.trackers && STORY.trackers.postGame &&
    STORY.trackers.postGame.text) || POST_GAME.tracker;
const TXT_UNDER = (STORY.trackers && STORY.trackers.underLevel &&
    STORY.trackers.underLevel.text) || UNDER_LEVEL_TRACKER;
const TXT_UNDER_6 = TXT_UNDER.replace("{level}", "6");
const TXT_UNDER_8 = TXT_UNDER.replace("{level}", "8");

/** Chain positions the engine reacts to by identity. */
const IDX_COLD2 = STEP_BY_ID["cold.2"].index;
const IDX_COLD3 = STEP_BY_ID["cold.3"].index;
const IDX_COLD4 = STEP_BY_ID["cold.4"].index;

/** Precomputed `bossesKilled` keys ('<realm>:<kind>', the key
 *  bossEncounters writes) — so no check ever concatenates a string. */
const BOSS_KEY = {
    cold: { mini: "cold:mini", realm: "cold:realm" },
    sand: { mini: "sand:mini", realm: "sand:realm" },
    ash: { mini: "ash:mini", realm: "ash:realm" },
};

/** The quest section's own keys; everything else in `quest` is preserved. */
const OWN_KEYS = ["main", "surfM", "killsForOnboarding", "hintsSeen", "endingSeen"];

/** Hints that belong to the onboarding (marked seen for a veteran save). */
const ONBOARDING_HINTS = ["hint.surf", "hint.bolt", "hint.arc", "hint.journal"];

export class QuestSystem {
    /**
     * @param {object} ctx the shared module ctx (see the lane contract).
     *   Uses: progression (required), character, registry, enemies, bosses,
     *   portal, shrine, getRealm, bus. Everything but progression is
     *   optional and every use is guarded.
     */
    constructor(ctx) {
        if (!ctx || !ctx.progression) {
            throw new Error("QuestSystem: ctx.progression is required");
        }
        this.ctx = ctx;
        this.bus = ctx.bus || sharedBus;
        this.progression = ctx.progression;
        this.character = ctx.character || ctx.progression.controller || null;
        this.registry = ctx.registry || ctx.progression.registry || null;
        this.enemies = ctx.enemies || null;
        this.bosses = ctx.bosses || null;
        this.portal = ctx.portal || null;
        this.shrine = ctx.shrine || null;
        /** @type {(() => string)|null} */
        this._getRealm = typeof ctx.getRealm === "function" ? ctx.getRealm : null;
        /** The realm the player stands in. */
        this.realm = this._readRealm();

        // ------------------------------------------------ persisted (§8)
        /** Current step index per realm chain. */
        this.main = { cold: 0, sand: 0, ash: 0 };
        /** Metres surfed (RMB held, grounded), whole run. */
        this.surfM = 0;
        /** Kills counted while cold.3 was current. */
        this.killsForOnboarding = 0;
        /** @type {Record<string, boolean>} one-time prompts already done. */
        this.hintsSeen = {};
        this.endingSeen = false;
        /** Other `quest.*` keys (caches/trials/bounties/lore, owned by the
         *  side-content systems) — preserved verbatim. @type {object|null} */
        this._extra = null;

        // ------------------------------------------------ live
        this._dirty = true;
        this._wpT = 0;
        /** Scratch the waypoint is computed into, and the last emitted one. */
        this._wp = { valid: false, x: 0, z: 0, realm: "", label: "", kind: "", stepId: "" };
        this._wpOut = { valid: false, x: 0, z: 0, realm: "", label: "", kind: "", stepId: "" };
        this._wpEmitted = false;
        /** The last emitted 'quest:waypoint' payload (UI may poll it). */
        this.waypoint = null;
        /** The last emitted 'quest:step' payload (UI may poll it). */
        this.tracked = null;
        /** The last announced tracker key — compared, never reallocated. */
        this._trk = { realm: "", stepId: "", tracker: "", have: -2 };
        /** Active hints: parallel arrays, at most HINTS' size. */
        this._hintIds = [];
        this._hintTtl = [];
        /** Forced onboarding pack, registry ids (-1 = empty). */
        this._forced = new Int32Array(ONBOARDING.packSize).fill(-1);
        this._packWanted = false;
        this._packT = 0;
        /** Session facts no save needs (the portal step completes the same
         *  frame, and realmsUnlocked then carries the fact). */
        this._portalFrom = { cold: false, sand: false, ash: false };
        this._endingTouched = false;
        /** Cached boss label (the roster row's display name). */
        this._bossRow = null;
        this._bossLabel = WAYPOINT_LABEL.arena;

        /** The 10 m surf bucket last announced (cold.2 progress edge). */
        this._surfBucket = -1;
        /** Last seen boss level-floor answer (1 met, 0 under, -1 unknown). */
        this._floorKey = -1;

        // ------------------------------------------------ probe counters
        this.packSpawns = 0;
        this.packX = 0;
        this.packZ = 0;
        this.completed = 0;
        this.lastComplete = null;

        // Discoverable the way lane R's systems are (ctx.boons, ctx.shop):
        // the journal/tracker UI reads `ctx.quests.journal()` / `.tracked`.
        ctx.quests = this;

        // ------------------------------------------------ wiring
        const B = this.bus;
        this._unsubs = [
            B.on("shrine:activated", (p) => this._onShrine(p)),
            B.on("enemy:killed", (p) => this._onKill(p)),
            B.on("boss:killed", () => { this._dirty = true; }),
            B.on("portal:entered", (p) => this._onPortal(p)),
            B.on("player:levelup", () => { this._dirty = true; }),
            B.on("realm:entered", (p) => {
                if (p && typeof p.realm === "string") this.setRealm(p.realm);
            }),
        ];
        // QUEST §2 GATING: the arena director asks this before arming.
        if (this.bosses) {
            this.bosses.questGate = (realm, kind) => this.bossUnlocked(realm, kind);
        }
        // 'enemy:killed' carries the combatData key once progression can see
        // the enemy runtime.
        if (this.enemies && typeof this.progression.attach === "function") {
            this.progression.attach({ enemies: this.enemies });
        }
        this._checkText();

        // Persistence. deserialize runs NOW with the blob progression loaded.
        this._unsubSave = this.progression.registerSaveSection("quest", {
            serialize: () => this._serialize(),
            deserialize: (v, info) => this._deserialize(v, info),
        });
    }

    // ================================================================ frame

    /**
     * One frame. Strict no-op at dt === 0. Allocation-free unless an event
     * edge (a completion, a waypoint change, a hint) fires this frame.
     * @param {number} dt seconds of game time
     * @returns {void}
     */
    update(dt) {
        if (!(dt > 0)) return;
        if (this._getRealm) {
            const r = this._getRealm();
            if (r !== this.realm) this.setRealm(r);
        }
        this._tickSurf(dt);
        this._tickHints(dt);
        this._tickPack(dt);
        this._tickEnding();
        if (this._dirty) this._evaluate();
        this._wpT -= dt;
        if (this._wpT <= 0) {
            this._wpT = WP_PERIOD;
            this._refreshWaypoint();
        }
    }

    /**
     * The player changed realm (main.js enterRealm, or the 'realm:entered'
     * bus event — either is enough; idempotent).
     * @param {string} token @returns {void}
     */
    setRealm(token) {
        if (REALM_ORDER.indexOf(token) < 0 || token === this.realm) return;
        this.realm = token;
        if (typeof this.progression.setRealm === "function") {
            this.progression.setRealm(token);
        }
        this._dirty = true;
        this._wpT = 0;
    }

    /**
     * QUEST §2 GATING — may this realm's `kind` boss arm? The mini boss after
     * "Kindle the Ring", the realm boss after "Wake the Anchors".
     * Allocation-free (bossEncounters reads it every pending frame).
     * @param {string} realm @param {string} kind @returns {boolean}
     */
    bossUnlocked(realm, kind) {
        const u = UNLOCK_INDEX[realm];
        if (!u) return true;
        const idx = kind === "realm" ? u.realm : u.mini;
        if (!(idx < Infinity)) return true;
        return this.main[realm] > idx;
    }

    /** Ring shrines lit in `realm` (0..6). @param {string} realm @returns {number} */
    ringLit(realm) {
        const P = this.progression;
        let n = 0;
        for (let i = 0; i < RING_SHRINE_IDS.length; i++) {
            if (P.isShrineLit(realm, RING_SHRINE_IDS[i])) n++;
        }
        return n;
    }

    /**
     * QUEST §9: "all 21 shrines lit (or the 3 spawn shrines + both bosses of
     * every realm, whichever is reached — do NOT require 100% shrines)".
     * @returns {boolean}
     */
    endingEligible() {
        const P = this.progression;
        let lit = 0, spawns = 0;
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const l = P.litShrines(REALM_ORDER[r]);
            lit += l.length;
            if (l.indexOf(SPAWN_SHRINE) >= 0) spawns++;
        }
        if (lit >= ENDING.allShrines) return true;
        if (spawns < REALM_ORDER.length) return false;
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const realm = REALM_ORDER[r];
            if (!this._bossDead(realm, "mini") || !this._bossDead(realm, "realm")) return false;
        }
        return true;
    }

    /**
     * Journal snapshot (QUEST §7 Main tab + completion). Allocates — call it
     * when a panel opens, never per frame.
     * @returns {object}
     */
    journal() {
        let done = 0;
        const realms = REALM_ORDER.map((realm) => {
            const open = this._chainOpen(realm);
            const cur = this.main[realm];
            done += Math.min(cur, MAIN[realm].length);
            return {
                realm, open, current: cur, complete: cur >= MAIN[realm].length,
                steps: MAIN[realm].map((s) => ({
                    id: s.id, title: s.title, tracker: s.tracker,
                    status: s.index < cur ? "done"
                        : (s.index === cur && open ? "current" : "locked"),
                })),
            };
        });
        return {
            realms, mainDone: done, mainTotal: MAIN_TOTAL,
            endingSeen: this.endingSeen,
            playerTitle: this.endingSeen && STORY.ending ? STORY.ending.playerTitle : null,
            surfM: this.surfM,
        };
    }

    /** Everything a probe needs, in one read (allocates). */
    get stats() {
        return {
            realm: this.realm,
            main: { cold: this.main.cold, sand: this.main.sand, ash: this.main.ash },
            surfM: this.surfM,
            killsForOnboarding: this.killsForOnboarding,
            tracked: this.tracked ? this.tracked.stepId : null,
            tracker: this.tracked ? this.tracked.tracker : null,
            waypoint: this.waypoint,
            hintsActive: this._hintIds.slice(),
            hintsSeen: Object.assign({}, this.hintsSeen),
            forced: Array.from(this._forced),
            packSpawns: this.packSpawns, packX: this.packX, packZ: this.packZ,
            completed: this.completed,
            endingSeen: this.endingSeen,
            gateMini: this.bossUnlocked(this.realm, "mini"),
            gateRealm: this.bossUnlocked(this.realm, "realm"),
        };
    }

    /** Detach from the bus, the boss director and the save. @returns {void} */
    dispose() {
        for (let i = 0; i < this._unsubs.length; i++) this._unsubs[i]();
        this._unsubs.length = 0;
        if (this.bosses && this.bosses.questGate) this.bosses.questGate = null;
        if (this._unsubSave) this._unsubSave();
        this._unsubSave = null;
    }

    // ============================================================ handlers

    /** @param {{realm:string, id:string, first:boolean}} p */
    _onShrine(p) {
        if (!p) return;
        if (p.first) this._speakShrine(p.realm, p.id);
        this._dirty = true;
    }

    /** Count onboarding kills (cold.3), pay the tutorial first-blood.
     *  @param {object} p enemy:killed payload */
    _onKill(p) {
        if (!p || this.main.cold !== IDX_COLD3) return;
        const before = this.killsForOnboarding;
        this.killsForOnboarding = before + 1;
        if (before === 0) {
            // PROGRESSION §3.5 tutorial first-blood, re-homed from the removed
            // dummies to the tutorial's first kill (questData XP.firstBlood).
            // progression owns the once-flag, so it can never pay twice.
            const P = this.progression;
            if (typeof P.grantFirstBlood === "function") P.grantFirstBlood();
            else if (!P._dummyFirstBlood) {
                P._dummyFirstBlood = true;
                P.addXP(XP.firstBlood, "first-blood");
            }
        }
        if (this.killsForOnboarding >= ONBOARDING.kills) this._dirty = true;
        this._announce("progress");
    }

    /** @param {{from:string|null, to:string}} p */
    _onPortal(p) {
        if (p && typeof p.from === "string" && p.from in this._portalFrom) {
            this._portalFrom[p.from] = true;
        }
        this._dirty = true;
    }

    // ============================================================== ticks

    /** Integrate the surf distance (cold.2's fact). @param {number} dt */
    _tickSurf(dt) {
        const c = this.character;
        if (!c || !c.surfActive || c.airborne) return;
        const d = c.speed * dt;
        if (!(d > 0)) return;
        this.surfM += d;
        if (this.main.cold !== IDX_COLD2) return;
        if (this.surfM >= ONBOARDING.surfHintClearM && this._hintIds.length > 0) {
            this._clearHint("hint.surf", true);
        }
        if (this.surfM >= ONBOARDING.surfM) this._dirty = true;
        // Progress is announced on a 10 m crossing only — one integer
        // compare per surfing frame, never a string built per frame.
        const b = Math.floor(this.surfM / SURF_STEP_M);
        if (b !== this._surfBucket) {
            this._surfBucket = b;
            this._announce("progress");
        }
    }

    /** Count down ttl hints. @param {number} dt */
    _tickHints(dt) {
        for (let i = this._hintIds.length - 1; i >= 0; i--) {
            if (this._hintTtl[i] < 0) continue;
            this._hintTtl[i] -= dt;
            if (this._hintTtl[i] <= 0) this._clearHint(this._hintIds[i], true);
        }
    }

    /**
     * QUEST §6.4: while cold.3 is current in Cold, keep ONE forced imp pack
     * in the world — spawned 40 m ahead the first frame the step runs, and
     * re-forced only if it vanished without finishing the step.
     * @param {number} dt
     */
    _tickPack(dt) {
        if (!this._packWanted) return;
        if (this.main.cold !== IDX_COLD3 || this.realm !== "cold") return;
        if (this.killsForOnboarding >= ONBOARDING.kills) return;
        const reg = this.registry;
        if (!reg || !this.enemies || !this.character) return;
        let alive = 0;
        for (let i = 0; i < this._forced.length; i++) {
            const id = this._forced[i];
            if (id <= 0) continue;
            const s = reg.slot(id);
            if (s >= 0 && reg.hp[s] > 0) alive++;
            else this._forced[i] = -1;
        }
        if (alive > 0) return;
        this._packT -= dt;
        if (this._packT > 0) return;
        this._packT = ONBOARDING.packRetryS;
        this._spawnPack();
    }

    /** Stand the forced pack up 40 m ahead of the player's travel. */
    _spawnPack() {
        const c = this.character;
        let dx, dz;
        if (c.speed > 0.5) {
            dx = c.velocity.x / c.speed;
            dz = c.velocity.z / c.speed;
        } else {
            // Controller forward = (sin f, -cos f) — the frame bossEncounters
            // and the minimap use.
            dx = Math.sin(c.facing);
            dz = -Math.cos(c.facing);
        }
        let cx = c.position.x + dx * ONBOARDING.packAheadM;
        let cz = c.position.z + dz * ONBOARDING.packAheadM;
        const lim = PLAY_RADIUS - PACK_EDGE_PAD;
        const r = Math.hypot(cx, cz);
        if (r > lim) { cx *= lim / r; cz *= lim / r; }
        const lvl = enemyLevelFor("cold", this.progression.level || 1, 0.5, "regular");
        const n = this._forced.length;
        for (let i = 0; i < n; i++) {
            // A fixed ring (no RNG): one at the centre, the rest around it.
            const a = i * (Math.PI * 2 / n) + 0.35;
            const rr = i === 0 ? 0 : ONBOARDING.packSpreadM;
            const id = this.enemies.spawn(ONBOARDING.packKey,
                cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, lvl);
            this._forced[i] = (typeof id === "number" && id > 0) ? id : -1;
        }
        this.packSpawns++;
        this.packX = cx;
        this.packZ = cz;
        this._wpT = 0;   // point at it this frame
    }

    /** QUEST §9: at ash.6, standing on the Cold spawn shrine with the ending
     *  condition met completes the step (and begins the ending). */
    _tickEnding() {
        if (this._endingTouched || this.realm !== "cold") return;
        const s = MAIN.ash[this.main.ash];
        if (!s || s.rule.type !== RULE.ENDING || !this._chainOpen("ash")) return;
        const sh = this.shrine;
        const a = sh && sh.positions ? sh.positions[0] : null;
        const c = this.character;
        if (!a || !c) return;
        const dx = c.position.x - a.x, dz = c.position.z - a.z;
        if (dx * dx + dz * dz >= SHRINE_TOUCH_R * SHRINE_TOUCH_R) return;
        if (!this.endingEligible()) return;
        this._endingTouched = true;
        this._dirty = true;
    }

    // ========================================================= state machine

    /** Complete every satisfied current step (a step can already be
     *  satisfied when it BECOMES current — e.g. all six rings lit before the
     *  mini boss fell), then re-announce. Event-driven, never per frame. */
    _evaluate() {
        this._dirty = false;
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const realm = REALM_ORDER[r];
            if (!this._chainOpen(realm)) continue;
            for (let guard = 0; guard < 12; guard++) {
                const s = MAIN[realm][this.main[realm]];
                if (!s || !this._satisfied(s)) break;
                this._complete(s);
            }
        }
        this._announce("state");
        this._refreshWaypoint();
    }

    /** @param {object} s step @returns {boolean} */
    _satisfied(s) {
        const P = this.progression;
        const rule = s.rule;
        switch (rule.type) {
            case RULE.SHRINE: return P.isShrineLit(s.realm, rule.shrine);
            case RULE.SURF: return this.surfM >= rule.meters;
            case RULE.KILLS: return this.killsForOnboarding >= rule.count;
            case RULE.RING: return this.ringLit(s.realm) >= rule.count;
            case RULE.BOSS: return this._bossDead(s.realm, rule.kind);
            case RULE.PORTAL:
                return this._portalFrom[s.realm] ||
                    (Array.isArray(P.realmsUnlocked) && P.realmsUnlocked.indexOf(rule.to) >= 0);
            case RULE.ENDING: return this._endingTouched;
            default: return false;
        }
    }

    /**
     * Complete step `s`: advance, pay, announce, speak, enter the next step,
     * save (QUEST §8: "Saving follows … quest step").
     * @param {object} s
     */
    _complete(s) {
        const P = this.progression;
        const need = typeof P._need === "function" ? P._need() : (P.xpNeed || 0);
        const xp = Math.round(s.xpFrac * need);
        this.main[s.realm] = s.index + 1;
        this._exitStep(s);
        if (xp > 0) P.addXP(xp, "quest");
        this.completed++;
        const payload = {
            realm: s.realm, stepId: s.id, title: s.title, xp,
            rewards: xp > 0 ? [{ kind: "xp", id: s.id, amount: xp }] : [],
        };
        this.lastComplete = payload;
        this.bus.emit("quest:complete", payload);
        if (s.rule.type !== RULE.ENDING) this._speak(s.echo);
        const next = MAIN[s.realm][s.index + 1];
        if (next) this._enterStep(next);
        if (s.rule.type === RULE.ENDING) this._beginEnding();
        P.save();
    }

    /** A step became current: its prompts and its forced pack. */
    _enterStep(s) {
        if (s.hints) for (let i = 0; i < s.hints.length; i++) this._showHint(s.hints[i]);
        if (s.forcePack) {
            this._packWanted = true;
            this._packT = 0;
        }
    }

    /** A step finished: its step-scoped prompts end (and are never shown
     *  again), its forced pack is no longer maintained. */
    _exitStep(s) {
        if (s.hints) {
            for (let i = 0; i < s.hints.length; i++) {
                const h = HINTS[s.hints[i]];
                if (h && h.clear !== "ttl") this._clearHint(h.id, true);
            }
        }
        if (s.forcePack) this._packWanted = false;
    }

    /** QUEST §9: the ending begins. */
    _beginEnding() {
        this.endingSeen = true;
        this.bus.emit("ending:begin", {
            echoId: "echo.ash.6",
            lines: STORY.ending && STORY.ending.echo ? STORY.ending.echo : [],
        });
    }

    // ============================================================ tracker

    /** Which chain the tracker shows: the current realm's if it has a step,
     *  else the first open chain that does (null = everything done). */
    _trackedRealm() {
        const cur = this.realm;
        if (this._chainOpen(cur) && MAIN[cur][this.main[cur]]) return cur;
        for (let r = 0; r < REALM_ORDER.length; r++) {
            const realm = REALM_ORDER[r];
            if (this._chainOpen(realm) && MAIN[realm][this.main[realm]]) return realm;
        }
        return null;
    }

    /**
     * Emit 'quest:step' if the tracked step, its tracker text or its
     * progress changed. Event-rate only (evaluate, a kill, a 10 m surf step).
     * @param {string} reason
     */
    _announce(reason) {
        const realm = this._trackedRealm();
        let stepId, title, tracker, index = -1, total = 0;
        let have = -1, need = -1, under = 0;
        if (!realm) {
            stepId = POST_GAME.id; title = POST_GAME.title; tracker = TXT_POST_GAME;
        } else {
            const s = MAIN[realm][this.main[realm]];
            stepId = s.id; title = s.title; tracker = s.tracker;
            index = s.index; total = MAIN[realm].length;
            const rule = s.rule;
            if (rule.type === RULE.SURF) {
                need = rule.meters;
                have = Math.floor(Math.min(this.surfM, need) / SURF_STEP_M) * SURF_STEP_M;
            } else if (rule.type === RULE.KILLS) {
                need = rule.count; have = Math.min(this.killsForOnboarding, need);
            } else if (rule.type === RULE.RING) {
                need = rule.count; have = Math.min(this.ringLit(realm), need);
            } else if (rule.type === RULE.BOSS && realm === this.realm && this.bosses &&
                       typeof this.bosses.meetsFloor === "function" &&
                       this.bossUnlocked(realm, rule.kind) &&
                       !this.bosses.meetsFloor(rule.kind)) {
                // QUEST §2: under-level when the quest unlocks the boss.
                under = this.bosses.levelFloor(rule.kind);
                tracker = under === 6 ? TXT_UNDER_6 : under === 8 ? TXT_UNDER_8
                    : TXT_UNDER.replace("{level}", String(under));
            }
        }
        const k = this._trk;
        const rk = realm || "";
        if (k.realm === rk && k.stepId === stepId && k.tracker === tracker && k.have === have) {
            return;
        }
        k.realm = rk; k.stepId = stepId; k.tracker = tracker; k.have = have;
        const payload = {
            realm, stepId, title, tracker, index, total,
            progress: need > 0 ? { have, need } : null,
            underLevel: under, reason,
        };
        this.tracked = payload;
        this.bus.emit("quest:step", payload);
    }

    // =========================================================== waypoint

    /** Recompute the target into the scratch; emit only on a change. */
    _refreshWaypoint() {
        const w = this._wp;
        w.valid = false;
        const realm = this._trackedRealm();
        if (realm) {
            const s = MAIN[realm][this.main[realm]];
            if (realm === this.realm) {
                this._wpForStep(s, w);
            } else if (s.rule.type === RULE.ENDING && this.realm === "cold") {
                this._wpShrine(w, s, 0);
            } else {
                // Tracking another realm's chain: this realm's gate leads on.
                this._wpPortal(w, s);
            }
        }
        const o = this._wpOut;
        let changed = !this._wpEmitted || w.valid !== o.valid;
        if (!changed && w.valid) {
            const dx = w.x - o.x, dz = w.z - o.z;
            changed = w.kind !== o.kind || w.label !== o.label ||
                w.realm !== o.realm || w.stepId !== o.stepId ||
                dx * dx + dz * dz > WP_MOVE_EPS * WP_MOVE_EPS;
        }
        if (!changed) return;
        o.valid = w.valid; o.x = w.x; o.z = w.z; o.realm = w.realm;
        o.label = w.label; o.kind = w.kind; o.stepId = w.stepId;
        this._wpEmitted = true;
        const payload = w.valid ? {
            x: w.x, z: w.z, realm: w.realm, label: w.label, kind: w.kind, stepId: w.stepId,
        } : null;
        this.waypoint = payload;
        this.bus.emit("quest:waypoint", payload);
    }

    /** @param {object} s @param {object} w */
    _wpForStep(s, w) {
        switch (s.waypoint) {
            case WAYPOINT.SPAWN_SHRINE: this._wpShrine(w, s, 0); break;
            case WAYPOINT.NEAREST_PACK: this._wpPack(w, s, false); break;
            case WAYPOINT.DORMANT_SHRINE: this._wpDormant(w, s); break;
            case WAYPOINT.BOSS_ARENA: {
                const kind = s.rule.kind;
                const B = this.bosses;
                if (!B || !this.bossUnlocked(s.realm, kind)) break;
                const floorOk = typeof B.meetsFloor !== "function" || B.meetsFloor(kind);
                // The floor can flip with no bus event (SNOWFLOW.test() at
                // run time, a band floor on a realm change): re-announce the
                // tracker on the flip. One compare per 0.25 s poll.
                const fk = floorOk ? 1 : 0;
                if (fk !== this._floorKey) { this._floorKey = fk; this._dirty = true; }
                if (!floorOk) {
                    // QUEST §2: under-level -> the densest nearby pack.
                    this._wpPack(w, s, true);
                    break;
                }
                if (typeof B.armedArena === "function" && B.armedArena(kind)) {
                    if (B.row !== this._bossRow) {
                        this._bossRow = B.row;
                        this._bossLabel = bossTitle(B.row);
                    }
                    this._wpSet(w, s, B.ax, B.az, "boss", this._bossLabel);
                }
                break;
            }
            case WAYPOINT.PORTAL: this._wpPortal(w, s); break;
            case WAYPOINT.ENDING:
                if (this.realm === "cold") this._wpShrine(w, s, 0);
                else this._wpPortal(w, s);
                break;
            default: break;   // WAYPOINT.NONE — the teach step points nowhere
        }
    }

    /** @param {object} w @param {object} s @param {number} x @param {number} z
     *  @param {string} kind @param {string} label */
    _wpSet(w, s, x, z, kind, label) {
        w.valid = true; w.x = x; w.z = z; w.realm = this.realm;
        w.kind = kind; w.label = label; w.stepId = s.id;
    }

    /** Shrine `index` of the network. */
    _wpShrine(w, s, index) {
        const sh = this.shrine;
        const p = sh && sh.positions ? sh.positions[index] : null;
        if (!p) return;
        this._wpSet(w, s, p.x, p.z, "shrine", this._shrineName(this.realm, p.id));
    }

    /** The nearest ring shrine not yet lit in the step's realm. */
    _wpDormant(w, s) {
        const sh = this.shrine;
        const c = this.character;
        if (!sh || !sh.positions || !c) return;
        const P = this.progression;
        let best = -1, bestD2 = Infinity;
        for (let i = 1; i < sh.positions.length; i++) {
            const p = sh.positions[i];
            if (P.isShrineLit(s.realm, p.id)) continue;
            const dx = p.x - c.position.x, dz = p.z - c.position.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; best = i; }
        }
        if (best >= 0) this._wpShrine(w, s, best);
    }

    /** The open realm gate, if any. */
    _wpPortal(w, s) {
        const g = this.portal;
        if (!g || !g.isOpen) return;
        this._wpSet(w, s, g.x, g.z, "portal", WAYPOINT_LABEL.portal);
    }

    /**
     * A live pack: the nearest enemy, or (densest) the enemy with the most
     * neighbours inside PACK_CLUSTER_M, nearest breaking ties. Registry SoA
     * scan, allocation-free.
     */
    _wpPack(w, s, densest) {
        const reg = this.registry;
        const c = this.character;
        if (!reg || !c) return;
        const px = c.position.x, pz = c.position.z;
        const R2 = PACK_SEARCH_M * PACK_SEARCH_M;
        const C2 = PACK_CLUSTER_M * PACK_CLUSTER_M;
        let best = -1, bestScore = -Infinity;
        for (let i = 0; i < reg.count; i++) {
            if (!reg.alive[i] || reg.hp[i] <= 0 || reg.kind[i] !== "enemy") continue;
            const dx = reg.x[i] - px, dz = reg.z[i] - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 > R2) continue;
            let score = -d2;
            if (densest) {
                let n = 0;
                for (let j = 0; j < reg.count; j++) {
                    if (j === i || !reg.alive[j] || reg.hp[j] <= 0 || reg.kind[j] !== "enemy") continue;
                    const ex = reg.x[j] - reg.x[i], ez = reg.z[j] - reg.z[i];
                    if (ex * ex + ez * ez <= C2) n++;
                }
                score = n * 1e7 - d2;
            }
            if (score > bestScore) { bestScore = score; best = i; }
        }
        if (best >= 0) this._wpSet(w, s, reg.x[best], reg.z[best], "pack", WAYPOINT_LABEL.pack);
    }

    // ============================================================== hints

    /** @param {string} id */
    _showHint(id) {
        const h = HINTS[id];
        if (!h || this.hintsSeen[id]) return;
        if (id === "hint.surf" && this.surfM >= ONBOARDING.surfHintClearM) {
            this.hintsSeen[id] = true;   // already surfed: nothing to teach
            return;
        }
        if (this._hintIds.indexOf(id) >= 0) return;
        const ttl = h.clear === "ttl" ? (h.ttl || 0) : -1;
        this._hintIds.push(id);
        this._hintTtl.push(ttl);
        // A timed prompt is one-time the moment it shows (QUEST §6.5).
        if (h.clear === "ttl") this.hintsSeen[id] = true;
        const st = STORY.hints && STORY.hints[id];
        this.bus.emit("hint", {
            id, text: (st && st.text) || h.text, ttl: ttl > 0 ? ttl : 0,
        });
    }

    /** @param {string} id @param {boolean} markSeen */
    _clearHint(id, markSeen) {
        if (markSeen) this.hintsSeen[id] = true;
        const i = this._hintIds.indexOf(id);
        if (i < 0) return;
        this._hintIds.splice(i, 1);
        this._hintTtl.splice(i, 1);
        this.bus.emit("hint:clear", { id });
    }

    // ============================================================ dialogue

    /** The Echo's lines for a storyText echo id. @param {string|null} id */
    _speak(id) {
        const e = id && STORY.echo ? STORY.echo[id] : null;
        if (!e || !e.lines || !e.lines.length) return;
        this.bus.emit("dialogue", { speaker: STORY.ui.speaker, lines: e.lines, id });
    }

    /** QUEST §5: one line on a shrine's first activation in a realm. */
    _speakShrine(realm, id) {
        const r = STORY.shrines ? STORY.shrines[realm] : null;
        const e = r ? r[id] : null;
        if (!e || !e.line) return;
        this.bus.emit("dialogue", {
            speaker: STORY.ui.speaker, lines: [e.line], id: e.id,
            shrine: { realm, id, name: e.name },
        });
    }

    /** @param {string} realm @param {string} id @returns {string} */
    _shrineName(realm, id) {
        const r = STORY.shrines ? STORY.shrines[realm] : null;
        const e = r ? r[id] : null;
        return (e && e.name) || WAYPOINT_LABEL.shrine;
    }

    // ============================================================= helpers

    /** @returns {string} */
    _readRealm() {
        const r = this._getRealm ? this._getRealm() : this.progression.realm;
        return REALM_ORDER.indexOf(r) >= 0 ? r : "cold";
    }

    /** Is a realm's chain in play? Cold always; another once unlocked (its
     *  portal was walked) or while the player stands in it.
     *  @param {string} realm @returns {boolean} */
    _chainOpen(realm) {
        if (realm === "cold" || realm === this.realm) return true;
        const u = this.progression.realmsUnlocked;
        return Array.isArray(u) && u.indexOf(realm) >= 0;
    }

    /** @param {string} realm @param {string} kind @returns {boolean} */
    _bossDead(realm, kind) {
        const bk = this.progression.bossesKilled;
        const keys = BOSS_KEY[realm];
        return !!(bk && keys && bk[kind === "realm" ? keys.realm : keys.mini]);
    }

    /** Did this character play before the quest layer existed?
     *  @returns {boolean} */
    _isVeteran() {
        const P = this.progression;
        if ((P.level | 0) > 1) return true;
        if (P.bossesKilled && Object.keys(P.bossesKilled).length > 0) return true;
        return Array.isArray(P.realmsUnlocked) && P.realmsUnlocked.length > 1;
    }

    /** Loud, not fatal: questData's titles/trackers must equal storyText's. */
    _checkText() {
        if (!STORY || !STORY.steps) return;
        for (const id in STEP_BY_ID) {
            const s = STEP_BY_ID[id];
            const t = STORY.steps[id];
            if (!t || t.title !== s.title || t.tracker !== s.tracker) {
                console.warn("[quests] questData and storyText disagree on " + id);
            }
            if (s.echo && s.rule.type !== RULE.ENDING && !(STORY.echo && STORY.echo[s.echo])) {
                console.warn("[quests] storyText has no dialogue " + s.echo);
            }
        }
    }

    // ============================================================ save (§8)

    /** @returns {object} the `quest` section */
    _serialize() {
        // Foreign keys (quest.caches, quest.trials, …) start from their NEWEST
        // saved value — the blob progression last wrote — so a child section
        // whose owner is not registered at this save keeps what it last wrote
        // (its registered owner overwrites it right after, shallow-first).
        // `_extra` (what the last load carried) is the fallback.
        const P = this.progression;
        const prev = typeof P.lastSaved === "function" ? P.lastSaved("quest") : undefined;
        const base = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : this._extra;
        const o = base ? Object.assign({}, base) : {};
        o.main = { cold: this.main.cold, sand: this.main.sand, ash: this.main.ash };
        o.surfM = Math.round(this.surfM * 10) / 10;
        o.killsForOnboarding = this.killsForOnboarding;
        o.hintsSeen = Object.assign({}, this.hintsSeen);
        o.endingSeen = !!this.endingSeen;
        // §8's side-content slots, present even before their systems exist
        // (a registered 'quest.caches' etc. overwrites them on save).
        if (!o.caches || typeof o.caches !== "object") o.caches = {};
        if (!o.trials || typeof o.trials !== "object") o.trials = {};
        if (!o.bounties || typeof o.bounties !== "object") o.bounties = {};
        if (!Array.isArray(o.lore)) o.lore = [];
        return o;
    }

    /**
     * Restore (or default) the section. `v` is undefined for a new game and
     * for every save that predates the section; a VETERAN character (level
     * > 1, a boss down, or a second realm open) then skips the onboarding it
     * has effectively played, and any already-true step completes on the
     * first frame (QUEST §8: "old saves never break").
     * @param {any} v @param {{reason?:string}} [info]
     */
    _deserialize(v, info) {
        const reason = info && info.reason ? info.reason : "load";
        this.main.cold = 0; this.main.sand = 0; this.main.ash = 0;
        this.surfM = 0;
        this.killsForOnboarding = 0;
        this.hintsSeen = {};
        this.endingSeen = false;
        this._extra = null;

        if (v && typeof v === "object") {
            const m = v.main && typeof v.main === "object" ? v.main : {};
            for (let r = 0; r < REALM_ORDER.length; r++) {
                const realm = REALM_ORDER[r];
                const n = Math.floor(+m[realm] || 0);
                this.main[realm] = Math.max(0, Math.min(MAIN[realm].length, n));
            }
            this.surfM = Math.max(0, +v.surfM || 0);
            this.killsForOnboarding = Math.max(0, Math.floor(+v.killsForOnboarding || 0));
            const hs = v.hintsSeen && typeof v.hintsSeen === "object" ? v.hintsSeen : {};
            for (const k in hs) if (hs[k] === true) this.hintsSeen[k] = true;
            this.endingSeen = v.endingSeen === true;
            const extra = {};
            let any = false;
            for (const k in v) {
                if (OWN_KEYS.indexOf(k) >= 0) continue;
                extra[k] = v[k];
                any = true;
            }
            this._extra = any ? extra : null;
        } else if (reason !== "new" && this._isVeteran()) {
            this.main.cold = IDX_COLD4;
            this.surfM = ONBOARDING.surfM;
            this.killsForOnboarding = ONBOARDING.kills;
            for (let i = 0; i < ONBOARDING_HINTS.length; i++) {
                this.hintsSeen[ONBOARDING_HINTS[i]] = true;
            }
        }

        // Live state belongs to the run that was just replaced.
        this._portalFrom.cold = this._portalFrom.sand = this._portalFrom.ash = false;
        this._endingTouched = false;
        for (let i = this._hintIds.length - 1; i >= 0; i--) {
            this._clearHint(this._hintIds[i], false);
        }
        this._packWanted = false;
        this._packT = 0;
        const reg = this.registry;
        for (let i = 0; i < this._forced.length; i++) {
            const id = this._forced[i];
            if (id > 0 && this.enemies && reg && reg.slot(id) >= 0) this.enemies.despawn(id);
            this._forced[i] = -1;
        }

        // Re-enter the current onboarding step (its prompts, its forced pack
        // — which only spawns on the first real frame, where the player is).
        const cs = MAIN.cold[this.main.cold];
        if (cs) this._enterStep(cs);

        this._trk.stepId = "";
        this._surfBucket = -1;
        this._wpEmitted = false;
        this._dirty = true;
        this._wpT = 0;
        this._announce(reason);
        this._refreshWaypoint();
    }
}

/** The roster row's display name up to its parenthetical — bossEncounters'
 *  own derivation ("The Icewall (field 520 → arena 1200)" -> "The Icewall").
 *  @param {object|null} row @returns {string} */
function bossTitle(row) {
    const n = row ? (row.bossName || row.name || "") : "";
    const cut = n.indexOf(" (");
    const t = (cut > 0 ? n.slice(0, cut) : n).trim();
    return t || WAYPOINT_LABEL.arena;
}
