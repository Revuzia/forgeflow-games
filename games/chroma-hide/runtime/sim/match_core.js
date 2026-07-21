/**
 * CHROMA HIDE — runtime/sim/match_core.js
 * PURE match rules: phases, timers, role assignment, ammo economy, line-of-sight
 * scoring, win checks, mode definitions. No three, no DOM, no networking — the
 * host drives this and the selftest exercises it headlessly.
 *
 * Every tunable here is a DESIGN DEFAULT ([D] in the build plan): the source
 * game never disclosed its exact timers / ammo counts / LOS formula, so these
 * are balanced starting points, all host-overridable at runtime.
 */
import { clamp } from "./util.js";

export const PHASE = Object.freeze({
  LOBBY: "lobby",
  ROLE_ASSIGN: "role_assign",
  PREP: "prep",
  HUNT: "hunt",
  ANSWER_CHECK: "answer_check",
  RESULTS: "results",
});

export const ROLE = Object.freeze({ HIDER: "hider", SEEKER: "seeker" });

export const MODE = Object.freeze({
  NORMAL: "normal",
  INFECTION: "infection",
  DOUBLE: "double",
  REVERSE: "reverse", // Reverse Chicken Race
});

/** Default lobby/match settings — all host-tunable (see build plan §12). */
export const DEFAULTS = Object.freeze({
  mode: MODE.NORMAL,
  prepSeconds: 90,        // range 30..180 step 15
  huntSeconds: 150,       // range 90..300 step 30
  answerSeconds: 12,
  ammoLimit: true,        // the post-launch ammo economy, on by default
  startAmmo: 8,           // range 4..999 (999 ≈ launch "unlimited")
  shotCooldownMs: 1500,   // ~1.5s between shots
  forcedTaunt: true,
  tauntIntervalSeconds: 45, // off | 15..120
  maxClones: 2,
  cloneCooldownSeconds: 30,
  botFill: true,          // fill empty slots with AI (our platform adaptation)
  losMaxDist: 25,         // metres a hider still scores within a seeker's cone
  losBasePerSec: 10,      // base LOS points/sec
  reverseFindReward: 500, // Reverse Chicken Race find reward (post-nerf value)
});

export const BODY_SIZES = Object.freeze([1.0, 1.4, 1.7]);

/** Clamp a settings object to legal ranges (host UI + net-received settings). */
export function sanitizeSettings(s) {
  s = Object.assign({}, DEFAULTS, s || {});
  s.prepSeconds = clamp(Math.round(s.prepSeconds / 15) * 15, 30, 180);
  s.huntSeconds = clamp(Math.round(s.huntSeconds / 30) * 30, 90, 300);
  s.answerSeconds = clamp(s.answerSeconds | 0, 5, 30);
  s.startAmmo = clamp(s.startAmmo | 0, 1, 999);
  s.tauntIntervalSeconds = s.forcedTaunt ? clamp(s.tauntIntervalSeconds | 0, 15, 120) : 0;
  s.maxClones = clamp(s.maxClones | 0, 0, 4);
  return s;
}

/** Recommended seeker count for a lobby size: 1 per 4 players, min 1. */
export function computeSeekerCount(playerCount) {
  return Math.max(1, Math.round(playerCount / 4));
}

/**
 * Assign roles for a round. players = array of ids. seekerCount seekers are
 * chosen, avoiding anyone in lastSeekers when possible (anti-repeat). rng is a
 * ()=>[0,1) so assignment is deterministic from the match seed.
 * Returns { seekers:Set, hiders:Set, roles:{id:ROLE} }.
 */
export function assignRoles(players, seekerCount, lastSeekers, rng) {
  rng = rng || Math.random;
  const ids = players.slice();
  const last = new Set(lastSeekers || []);
  seekerCount = clamp(seekerCount | 0, 1, Math.max(1, ids.length - 1));
  // Prefer players who did NOT seek last round.
  const fresh = ids.filter((id) => !last.has(id));
  const stale = ids.filter((id) => last.has(id));
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const pool = shuffle(fresh).concat(shuffle(stale));
  const seekers = new Set(pool.slice(0, seekerCount));
  const roles = {};
  for (const id of ids) roles[id] = seekers.has(id) ? ROLE.SEEKER : ROLE.HIDER;
  const hiders = new Set(ids.filter((id) => !seekers.has(id)));
  return { seekers, hiders, roles };
}

/**
 * Ammo economy step. Returns the new ammo count given a shot outcome.
 * Rule [V]: miss -1, hit +1, shooting a FLEEING (moving) target costs nothing.
 * A seeker at 0 ammo cannot fire (enforced by caller); all seekers at 0 => hiders win.
 */
export function applyShot(ammo, { hit, fleeing, ammoLimit, startAmmo }) {
  if (!ammoLimit) return ammo;
  if (fleeing) return ammo;            // free shot at a moving target
  if (hit) return Math.min(startAmmo, ammo + 1);
  return Math.max(0, ammo - 1);
}

/**
 * LOS points a hider accrues this dt while inside a seeker's cone & unoccluded.
 * [D] formula — closer = more: base * (1 + (1 - dist/maxDist)), scaled by dt.
 * Caller is responsible for the cone test + occlusion raycast; this is the reward.
 */
export function losPoints(dist, dt, opts) {
  const o = opts || DEFAULTS;
  if (dist > o.losMaxDist) return 0;
  const prox = 1 + (1 - dist / o.losMaxDist);
  return o.losBasePerSec * prox * dt;
}

/**
 * Win check for a round in progress. state = {
 *   mode, timeLeft, hiders:[{id,alive}], seekers:[{id,ammo}], ammoLimit
 * }. Returns null (ongoing) or { winner:'hiders'|'seekers', reason }.
 */
export function checkWin(state) {
  const aliveHiders = state.hiders.filter((h) => h.alive).length;
  // Seekers catch everyone.
  if (aliveHiders === 0 && state.hiders.length > 0) {
    return { winner: "seekers", reason: "all_found" };
  }
  // All seekers exhausted (ammo economy).
  if (state.ammoLimit && state.seekers.length > 0 && state.seekers.every((s) => s.ammo <= 0)) {
    return { winner: "hiders", reason: "seekers_out_of_ammo" };
  }
  // Timer expired with a survivor.
  if (state.timeLeft <= 0) {
    return aliveHiders > 0
      ? { winner: "hiders", reason: "time_survived" }
      : { winner: "seekers", reason: "all_found" };
  }
  return null;
}

/** Static per-mode descriptors used by the lobby UI and the orchestrator. */
export const MODE_INFO = Object.freeze({
  [MODE.NORMAL]: {
    name: "Normal", blurb: "Fixed teams. Hiders win if one survives.",
    convertOnCatch: false, everyoneHides: false, reveal: false,
  },
  [MODE.INFECTION]: {
    name: "Infection", blurb: "Caught hiders join the hunt. Snowballs to the last hider.",
    convertOnCatch: true, everyoneHides: false, reveal: false,
  },
  [MODE.DOUBLE]: {
    name: "Double", blurb: "Everyone paints & hides, then everyone hunts. Most finds wins.",
    convertOnCatch: false, everyoneHides: true, reveal: false,
  },
  [MODE.REVERSE]: {
    name: "Reverse Chicken Race", blurb: "One painted hider is revealed — race to find them.",
    convertOnCatch: false, everyoneHides: true, reveal: true,
  },
});

/** The canonical pose set. Single source of truth: the renderer's scale table, the
 *  sim's silhouette heights and the wire codec's index all key off THIS order, so a
 *  pose can never mean one thing locally and another over the network. */
export const POSE_IDS = Object.freeze([
  "stand", "crouch", "curl", "ball", "flat", "stretch", "lean", "wide",
]);

/** Silhouette height per pose, metres. Drives LOS occlusion. */
export const POSE_HEIGHT = Object.freeze({
  stand: 1.55, crouch: 0.96, curl: 0.81, ball: 0.70, flat: 0.40,
  stretch: 2.17, lean: 1.63, wide: 1.32,
});
