// core/ai/personality.js [identity lane] — a stable playstyle per CALLSIGN.
// THREE-free, DOM-free, Node-safe, deterministic (no rng stream is consumed:
// every choice is a pure function of the callsign string).
//
// "Kestrel camps the gallery with a DMR." Each roster name (roster.js
// CALLSIGNS) maps to the SAME personality every match, so a player can learn
// the nine operators they share a server with. A personality:
//   - biases WHICH role the operator takes inside its team (assignRoles: the
//     team's role multiset — one marksman, one entry man, riflemen — is kept;
//     only who-gets-which changes, so team composition / C23 is untouched),
//   - biases the class kit inside that role (personalClass: shotgun vs SMG
//     entry man, SMG vs rifle skirmisher, smoke vs flash, frag vs tripmine),
//   - nudges the FSM knobs INSIDE the band (applyPersonality) — aggression,
//     patience, preferred range, grenade habit, movement — and adds one or two
//     humanlike MISTAKES, each paid for by a small compensating edge so the
//     overall competence of the band is unchanged,
//   - sets how chatty the operator is on the team channel and the phrasing
//     style of their callouts (core/hud/callouts.js reads `chat` + `style`).
//
// Nothing here grants sight, speed, HP, damage or ammo (bot_ai.md §2.2), and
// nothing here is ever shown to the player as a number.

// ---------------------------------------------------------------- hashing
// FNV-1a over the callsign, then a splitmix finaliser per salt. Pure.
export function nameHash(name, salt = 0) {
  let h = 0x811c9dc5;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= Math.imul((salt | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const unit = (name, salt) => nameHash(name, salt) / 4294967296; // [0,1)

export const STYLES = ["terse", "pro", "casual", "hype"];
export const MISTAKES = ["overpeek", "badReload", "flashLost", "whiff"];
export const MOVES = ["anchor", "strafer", "slicer", "rusher"];

// ---------------------------------------------------------------- authored
// The twelve roster callsigns are AUTHORED so the cast is varied on purpose
// (a hash could hand out four snipers). Fields:
//   aggression -1..1   push / chase / flank appetite (− = holds and waits)
//   patience    0..1   holds an angle once it has one, waits out a hidden enemy
//   range       close | mid | long  — role preference + preferred fight band
//   objective   0..1   objective focus (published for the objective lane)
//   grenade     0..1   how readily it reaches for a frag
//   move        anchor | strafer | slicer | rusher
//   chat        0..1   how often it talks on the team channel
//   style       terse | pro | casual | hype — callout phrasing
//   tactical    preferred tactical (used when the role allows it)
//   lethal      frag | claymore preference (claymore only where the role allows)
//   mistakes    1–2 humanlike habits from MISTAKES
const AUTHORED = {
  NAVE:    { aggression: 0.8,  patience: 0.1, range: "close", objective: 0.5, grenade: 0.9, move: "rusher",  chat: 0.85, style: "hype",   tactical: "flash", lethal: "frag",     mistakes: ["badReload"] },
  HOLT:    { aggression: 0.1,  patience: 0.5, range: "mid",   objective: 0.9, grenade: 0.5, move: "strafer", chat: 0.6,  style: "pro",    tactical: "flash", lethal: "frag",     mistakes: ["whiff"] },
  KESTREL: { aggression: -0.7, patience: 0.95, range: "long", objective: 0.3, grenade: 0.2, move: "anchor",  chat: 0.4,  style: "terse",  tactical: "smoke", lethal: "claymore", mistakes: ["overpeek"] },
  MARLOW:  { aggression: 0.4,  patience: 0.3, range: "mid",   objective: 0.4, grenade: 0.5, move: "slicer",  chat: 0.55, style: "casual", tactical: "stun",  lethal: "frag",     mistakes: ["flashLost"] },
  ODESSA:  { aggression: 0.4,  patience: 0.4, range: "close", objective: 0.6, grenade: 0.6, move: "slicer",  chat: 0.6,  style: "pro",    tactical: "flash", lethal: "frag",     mistakes: ["overpeek"] },
  PRYOR:   { aggression: -0.3, patience: 0.7, range: "long",  objective: 0.5, grenade: 0.3, move: "anchor",  chat: 0.75, style: "pro",    tactical: "smoke", lethal: "frag",     mistakes: ["badReload"] },
  QUILL:   { aggression: -0.2, patience: 0.6, range: "mid",   objective: 0.75, grenade: 0.4, move: "anchor", chat: 0.35, style: "terse",  tactical: "smoke", lethal: "frag",     mistakes: ["whiff"] },
  RASK:    { aggression: 0.95, patience: 0.0, range: "close", objective: 0.3, grenade: 1.0, move: "rusher",  chat: 0.8,  style: "hype",   tactical: "stun",  lethal: "frag",     mistakes: ["overpeek", "badReload"] },
  SABLE:   { aggression: 0.5,  patience: 0.35, range: "mid",  objective: 0.35, grenade: 0.4, move: "slicer", chat: 0.2,  style: "terse",  tactical: "stun",  lethal: "claymore", mistakes: ["flashLost"] },
  TALLOW:  { aggression: -0.4, patience: 0.8, range: "mid",   objective: 0.85, grenade: 0.5, move: "anchor", chat: 0.5,  style: "casual", tactical: "smoke", lethal: "claymore", mistakes: ["whiff"] },
  VANE:    { aggression: 0.5,  patience: 0.3, range: "long",  objective: 0.4, grenade: 0.3, move: "strafer", chat: 0.65, style: "hype",   tactical: "flash", lethal: "frag",     mistakes: ["overpeek"] },
  WREN:    { aggression: 0.3,  patience: 0.25, range: "close", objective: 0.55, grenade: 0.6, move: "strafer", chat: 0.6, style: "casual", tactical: "flash", lethal: "frag",     mistakes: ["flashLost"] },
};

function generated(name) {
  // any other name (authored botRoster names, test names): hash-derived, same
  // field set, same ranges — still stable per name
  const pickOf = (arr, salt) => arr[nameHash(name, salt) % arr.length];
  const m1 = pickOf(MISTAKES, 9);
  const m2 = unit(name, 10) < 0.3 ? pickOf(MISTAKES, 11) : null;
  return {
    aggression: Math.round((unit(name, 1) * 2 - 1) * 100) / 100,
    patience: Math.round(unit(name, 2) * 100) / 100,
    range: pickOf(["close", "mid", "mid", "long"], 3),
    objective: Math.round(unit(name, 4) * 100) / 100,
    grenade: Math.round(unit(name, 5) * 100) / 100,
    move: pickOf(MOVES, 6),
    chat: Math.round((0.2 + unit(name, 7) * 0.7) * 100) / 100,
    style: pickOf(STYLES, 8),
    tactical: pickOf(["flash", "smoke", "stun"], 12),
    lethal: unit(name, 13) < 0.3 ? "claymore" : "frag",
    mistakes: m2 && m2 !== m1 ? [m1, m2] : [m1],
  };
}

const CACHE = new Map();
/** The personality for a callsign — same object (frozen) every call. */
export function personalityOf(name) {
  const key = String(name || "").toUpperCase();
  let p = CACHE.get(key);
  if (p) return p;
  const src = AUTHORED[key] || generated(key);
  p = Object.freeze(Object.assign({ name: key, authored: !!AUTHORED[key] }, src,
    { mistakes: Object.freeze(src.mistakes.slice()) }));
  CACHE.set(key, p);
  return p;
}

// ---------------------------------------------------------------- roles
const baseRole = (arch) => String(arch || "rifleman").replace(/_[ab]$/, "");
const ROLE_OF_RANGE = { close: "cqb", mid: "rifleman", long: "marksman" };
// affinity of a personality for a role (higher = wants it more)
function affinity(p, role) {
  if (role === "marksman") return (p.range === "long" ? 2 : p.range === "mid" ? 0.4 : 0) + p.patience * 0.5 - p.aggression * 0.2;
  if (role === "cqb") return (p.range === "close" ? 2 : p.range === "mid" ? 0.4 : 0) + p.aggression * 0.5;
  return (p.range === "mid" ? 1.2 : 0.5) + 0.2 * p.objective;
}

/**
 * Re-deal the archetypes INSIDE each team by personality: the team keeps its
 * exact multiset of archetype strings (so one marksman stays one marksman);
 * scarce roles (marksman, then cqb) go to the operators who want them most.
 * Deterministic: ties break on the callsign. Mutates actor.archetype on bot
 * actors only; returns the number of actors whose archetype changed.
 */
export function assignRoles(actors) {
  if (!actors || !actors.length) return 0;
  const byTeam = new Map();
  const ffa = actors.every((a) => a.team === a.actorId);
  for (const a of actors) {
    if (!a || a.kind !== "bot") continue;
    const k = ffa ? "ffa" : a.team;
    if (!byTeam.has(k)) byTeam.set(k, []);
    byTeam.get(k).push(a);
  }
  let changed = 0;
  for (const list of byTeam.values()) {
    const slots = list.map((a) => a.archetype);
    const order = ["marksman", "cqb", "rifleman"];
    const left = list.slice().sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : x.actorId - y.actorId));
    const out = new Map();
    for (const role of order) {
      const roleSlots = slots.filter((s) => baseRole(s) === role || (role === "rifleman" && !order.slice(0, 2).includes(baseRole(s))));
      for (const s of roleSlots) {
        let best = null, bestV = -Infinity;
        for (const a of left) {
          if (out.has(a)) continue;
          const v = affinity(personalityOf(a.name), role);
          if (v > bestV + 1e-9) { bestV = v; best = a; }
        }
        if (best) out.set(best, s);
      }
    }
    for (const a of list) {
      const s = out.get(a);
      if (s && s !== a.archetype) { a.archetype = s; changed++; }
    }
  }
  return changed;
}

// ---------------------------------------------------------------- class kit
// The opponent-class HOOK: classes.js opponentClass() builds the base kit for
// (seed, actorId, archetype); this re-points the parts a personality owns.
// Roles stay believable (the same pools classes.js uses).
const ROLE_TACTICALS = { cqb: ["flash", "stun"], rifleman: ["flash", "smoke", "stun"], marksman: ["smoke", "stun"] };
export function personalClass(base, p, archetype) {
  if (!base || !p) return base;
  const role = baseRole(archetype);
  const out = Object.assign({}, base);
  if (role === "cqb") {
    out.primary = p.range === "close" && p.aggression > 0.5 ? "breaker" : "vesper";
    out.name = out.primary === "breaker" ? "BREACHER" : (p.move === "rusher" ? "RUNNER" : "CLOSE QUARTERS");
  } else if (role === "rifleman") {
    out.primary = p.range === "close" ? "vesper" : "warden";
    out.name = out.primary === "vesper" ? "SKIRMISHER" : (p.objective > 0.7 ? "LINE" : p.aggression > 0.3 ? "ASSAULT" : "RECON");
  } else if (role === "marksman") {
    out.primary = "corvus";
    out.name = p.patience > 0.6 ? "OVERWATCH" : "MARKSMAN";
  }
  if (ROLE_TACTICALS[role] && ROLE_TACTICALS[role].includes(p.tactical)) out.tactical = p.tactical;
  out.lethal = role !== "cqb" && p.lethal === "claymore" ? "claymore" : "frag";
  // builds are per weapon id; keep only those that still match the kit
  if (base.builds) {
    const b = {};
    for (const k of Object.keys(base.builds)) if (k === out.primary || k === out.secondary) b[k] = base.builds[k];
    out.builds = b;
  }
  return out;
}

// ---------------------------------------------------------------- FSM knobs
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/**
 * Personality over a resolved skill profile (botfsm skillOf output). Returns a
 * NEW object; `k` is not mutated. Every change stays inside the band: knobs
 * move by bounded fractions, and each mistake is paid for by a small edge.
 * Adds: rangeMul (preferred fight band scale), persona (the personality).
 */
export function applyPersonality(k, p) {
  if (!k || !p) return k;
  const o = Object.assign({}, k);
  const a = clamp(p.aggression, -1, 1), pat = clamp(p.patience, 0, 1), g = clamp(p.grenade, 0, 1);
  // aggression: chase, flank, push reloads, accept exposure
  o.flankP = clamp(k.flankP * (1 + 0.3 * a), 0, 1);
  o.flankEvery = k.flankEvery * (1 - 0.25 * a) * (1 + 0.35 * pat);
  o.pushReload = clamp(k.pushReload + 0.3 * a, 0, 1);
  o.huntAfterS = Math.max(0.5, k.huntAfterS * (1 - 0.35 * a) + 4 * pat);
  o.retreatHp = clamp(k.retreatHp - 10 * a, 15, 60);
  o.exposureAvoid = Math.max(0, k.exposureAvoid * (1 - 0.3 * a));
  o.loudP = clamp(Math.max(k.loudP, 0.2 * a), 0, 0.3);
  // patience: hold the angle you have
  if (pat >= 0.6) o.holdWhenSeen = true;
  o.coverRescoreS = k.coverRescoreS * (1 + 0.4 * pat);
  // preferred range: aggressive operators fight closer than their gun's book
  o.rangeMul = clamp(1 - 0.18 * a + (p.range === "long" ? 0.1 : p.range === "close" ? -0.1 : 0), 0.7, 1.25);
  // grenade habit
  o.grenStaticS = k.grenStaticS * (1.3 - 0.6 * g);
  o.grenCdS = k.grenCdS * (1.25 - 0.5 * g);
  // movement style
  if (p.move === "anchor") { o.strafeP = clamp(k.strafeP * 0.5, 0, 1); o.peek = clamp(k.peek * 0.7, 0, 1); }
  else if (p.move === "strafer") { o.strafeP = 1; }
  else if (p.move === "slicer") { o.lookCorners = 1; o.peek = 1; }
  else if (p.move === "rusher") { o.strafeP = 1; o.loudP = clamp(o.loudP + 0.1, 0, 0.3); }
  // mistakes — each with its compensating edge (net competence unchanged)
  let reactEdge = 0, jitterEdge = 1;
  for (const m of p.mistakes || []) {
    if (m === "overpeek") { o.peek = 1; o.exposureAvoid *= 0.75; reactEdge += 0.015; }
    else if (m === "badReload") { o.reloadBreak = clamp(k.reloadBreak * 0.45, 0, 1); jitterEdge *= 0.96; }
    else if (m === "flashLost") { o.memory = k.memory * 1.35; o.flashLost = true; o.notice = k.notice * 1.05; }
    else if (m === "whiff") {
      o.missRounds = Math.max(1, k.missRounds | 0);
      o.missMin = Math.max(k.missMin || 0, 0.8); o.missMax = Math.max(k.missMax || 0, 1.4);
      reactEdge += 0.02; jitterEdge *= 0.95;
    }
  }
  if (reactEdge) { o.reactMin = Math.max(0.12, k.reactMin - reactEdge); o.reactMax = Math.max(o.reactMin + 0.04, k.reactMax - reactEdge); }
  if (jitterEdge !== 1) o.jitter = k.jitter * jitterEdge;
  o.persona = p;
  return o;
}

/** Personality of a live bot body in a match (null outside matches / for the human). */
export function personaOfBot(sim, bot) {
  // the roster lives on the match state block (sim.state.match.actors)
  const M = sim && sim.match && sim.state && sim.state.match;
  if (!M || !bot || bot.actorId == null) return null;
  const a = M.actors && M.actors[bot.actorId];
  if (!a || a.kind !== "bot" || !a.name) return null;
  return personalityOf(a.name);
}
