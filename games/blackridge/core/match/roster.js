// core/match/roster.js [W1] — teams, the actor roster, and the ONE enemy
// truth (PVP_BUILD_PLAN Part 3.3–3.4, C2, C11, C21, C29d).
// THREE-free, Node-safe, deterministic (draws only from the stream it is
// handed — rng.match).
//
// A `botId` is a body; an `actorId` is a player. Bots die, the corpse is
// reaped by the view on its own (V5 — zero soldiers.js edits), and a NEW
// botId is spawned for the same actorId. The human is always actorId 0,
// always who 'P', always team 0 (AMBER). In FFA team === actorId, so the
// human is still team 0 — the same rule, no special case.

// ---------------------------------------------------------------- the truth
// The ONLY place this rule exists (Part 3.4). A second inline team comparison
// anywhere in the codebase is a defect — it is how the AI and the damage
// system drift apart. FFA is ten teams of one (team === actorId), so every
// pair differs and this same line serves all three modes with zero branches.
export function areEnemies(a, b) {
  return a != null && b != null && a !== b && a.team !== b.team;
}

// ---------------------------------------------------------------- constants
// C2: AMBER/SLATE with the authored rim-tint rationale. AMBER = WEST side,
// SLATE = EAST side (spawn-side remap lives in arena data, not here).
export const DEFAULT_TEAMS = [
  { id: 0, name: "AMBER", tint: "#d9a441", archetypeSuffix: "_a" },
  { id: 1, name: "SLATE", tint: "#7c9fd0", archetypeSuffix: "_b" },
];

// modes.md §1.1 — 12 originals; a deterministic draw of 9 via rng.match
// (C26: modes.md's `rng.bots` draw is re-pointed at the match stream).
export const CALLSIGNS = [
  "NAVE", "HOLT", "KESTREL", "MARLOW", "ODESSA", "PRYOR",
  "QUILL", "RASK", "SABLE", "TALLOW", "VANE", "WREN",
];

// C11 / modes.md §1.7 — mixed bands per preset, fixed at spawn-in, printed on
// the scoreboard. No adaptive difficulty, no rubber-banding, no HP or damage
// multipliers; band affects reaction/jitter/forced-miss/burst-pause/headshot
// intent only (AC-38). `veteran` appears ONLY inside HARD, capped at 1, and
// only when opts.veteran === true (owner decision, Part 8 item 2 — default
// OFF; the slot falls back to hardened).
export const DIFFICULTY_PRESETS = {
  casual: {
    friendly: ["recruit", "recruit", "regular", "hardened"],
    enemy: ["recruit", "recruit", "regular", "regular", "hardened"],
    ffa: ["recruit", "recruit", "recruit", "recruit", "regular", "regular", "regular", "regular", "hardened"],
  },
  standard: {
    friendly: ["hardened", "regular", "regular", "recruit"],
    enemy: ["hardened", "regular", "regular", "regular", "recruit"],
    ffa: ["recruit", "recruit", "regular", "regular", "regular", "regular", "hardened", "hardened", "hardened"],
  },
  hard: {
    friendly: ["regular", "regular", "hardened", "hardened"],
    enemy: ["VETERAN_SLOT", "regular", "regular", "hardened", "hardened"],
    ffa: ["regular", "regular", "regular", "hardened", "hardened", "hardened", "hardened", "hardened", "VETERAN_SLOT"],
  },
};

// C23 archetype spread: the arena has exactly one long lane, so one marksman
// per team, maximum. Per enemy team of 5: 1 cqb, 3 rifleman, 1 marksman.
// The human counts as one of their team's five, so their 4 bots drop one
// rifleman. FFA's 9: 3 cqb, 4 rifleman, 2 marksman.
const ARCH_FRIENDLY = ["cqb", "rifleman", "rifleman", "marksman"];
const ARCH_ENEMY = ["cqb", "rifleman", "rifleman", "rifleman", "marksman"];
const ARCH_FFA = ["cqb", "rifleman", "marksman", "cqb", "rifleman", "rifleman", "cqb", "rifleman", "marksman"];

// ---------------------------------------------------------------- helpers
function resolveArchetype(base, team, teams, archetypes) {
  // §2.6 team read: per-team suffixed archetype entries (rifleman_a/_b …)
  // when the data lane has authored them; base entry otherwise. FFA and the
  // pre-W4 fallback both land on the base names, which exist today.
  const t = teams[team];
  if (t && t.archetypeSuffix && archetypes &&
      Object.prototype.hasOwnProperty.call(archetypes, base + t.archetypeSuffix)) {
    return base + t.archetypeSuffix;
  }
  return base;
}

function drawNames(rng) {
  // deterministic 9-of-12 draw, no replacement (Fisher–Yates prefix)
  const pool = CALLSIGNS.slice();
  const out = [];
  for (let i = 0; i < 9; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    out.push(pool[i]);
  }
  return out;
}

function mkActor(actorId, name, kind, team, archetype, band) {
  // Part 3.3 — frozen actor shape. duty is the MODE's channel (C9);
  // bot._obj is the AI's and lives on the body, not here.
  return {
    actorId, name, kind, team, archetype, band,
    who: kind === "human" ? "P" : null,
    alive: kind === "human",
    score: 0, kills: 0, deaths: 0, assists: 0, streak: 0, bestStreak: 0,
    captures: 0, returns: 0,
    respawnAtT: -1, protectedUntilT: -1, spawnPointId: null,
    duty: null,
  };
}

// ---------------------------------------------------------------- roster
// makeRoster(content, opts) → { teams, actors, squadIdOf(actorId) }
//   opts: { teamCount: 2|'perActor', rng, difficulty:'casual'|'standard'|'hard',
//           veteran:false }
// Deterministic: identical (content, seed, difficulty) → identical roster.
// content.botRoster (W4, authored) supplies per-slot archetype (and name, if
// authored); BAND comes from the difficulty preset (C11 — modes.md's mixed
// bands upheld); the preset's band list is positional over each side's slots.
export function makeRoster(content, opts = {}) {
  const teamCount = opts.teamCount === "perActor" ? "perActor" : 2;
  const rng = opts.rng || (() => 0.5);
  const presetId = DIFFICULTY_PRESETS[opts.difficulty] ? opts.difficulty : "standard";
  const preset = DIFFICULTY_PRESETS[presetId];
  const archetypes = (content && content.archetypes) || null;
  const authored = (content && content.botRoster && content.botRoster.length === 9)
    ? content.botRoster : null;

  const baseTeams = (content && content.teams && content.teams.length === 2)
    ? content.teams : DEFAULT_TEAMS;

  const names = drawNames(rng);
  const band = (list, i) => {
    const b = list[i % list.length];
    if (b === "VETERAN_SLOT") return opts.veteran === true ? "veteran" : "hardened";
    return b;
  };

  const actors = [];
  const human = mkActor(0, "YOU", "human", 0, null, null);
  actors.push(human);

  if (teamCount === 2) {
    // arch 2.1: actors 1–4 join team 0 (the human's team), 5–9 form team 1.
    for (let i = 1; i <= 9; i++) {
      const friendly = i <= 4;
      const team = friendly ? 0 : 1;
      const sideIx = friendly ? i - 1 : i - 5;
      const baseArch = authored ? authored[i - 1].archetype
        : (friendly ? ARCH_FRIENDLY[sideIx] : ARCH_ENEMY[sideIx]);
      const a = mkActor(
        i,
        (authored && authored[i - 1].name) || names[i - 1],
        "bot", team,
        resolveArchetype(baseArch, team, baseTeams, archetypes),
        band(friendly ? preset.friendly : preset.enemy, sideIx),
      );
      actors.push(a);
    }
    const teams = baseTeams.map((t, ix) => ({
      id: ix, name: t.name, tint: t.tint, score: 0, captures: 0,
      actors: actors.filter((a) => a.team === ix).map((a) => a.actorId),
    }));
    return { teams, actors, squadIdOf: squadIdOfTeamModes(actors) };
  }

  // FFA — ten teams of one; team === actorId (Part 3.4).
  for (let i = 1; i <= 9; i++) {
    const baseArch = authored ? authored[i - 1].archetype : ARCH_FFA[i - 1];
    actors.push(mkActor(
      i,
      (authored && authored[i - 1].name) || names[i - 1],
      "bot", i,
      resolveArchetype(baseArch, 0, baseTeams, archetypes),
      band(preset.ffa, i - 1),
    ));
  }
  const amber = baseTeams[0] || DEFAULT_TEAMS[0];
  const teams = actors.map((a) => ({
    id: a.actorId,
    name: a.kind === "human" ? amber.name : a.name,
    tint: a.kind === "human" ? amber.tint : "#9aa4b0",
    score: 0, captures: 0, actors: [a.actorId],
  }));
  return { teams, actors, squadIdOf: squadIdOfFFA() };
}

// C21 squad ids: t0_a/t0_b/t1_a/t1_b in team modes (one squad.js instance,
// keyed by squadId — V6); ffa_<actorId> in FFA (each bot its own squad).
function squadIdOfTeamModes(actors) {
  return (actorId) => {
    const a = actors[actorId];
    if (!a || a.kind === "human") return null;
    const mates = actors.filter((x) => x.team === a.team && x.kind === "bot");
    const ix = mates.indexOf(a);
    return `t${a.team}_${ix < Math.ceil(mates.length / 2) ? "a" : "b"}`;
  };
}

function squadIdOfFFA() {
  return (actorId) => (actorId === 0 ? null : `ffa_${actorId}`);
}

// ---------------------------------------------------------------- bindBody
// The ONE function that writes the team mirror (Part 3.4): `bot.team` and
// `sim.state.player.team` are mirrored ints for the hot loops (perception /
// ballistics compare ints without a roster lookup). Written here and nowhere
// else.
export function bindBody(actor, body) {
  if (actor.kind === "human") {
    actor.who = "P";
    body.team = actor.team;
    body.actorId = actor.actorId;
  } else {
    actor.who = body.id;
    body.team = actor.team;
    body.actorId = actor.actorId;
  }
  actor.alive = true;
  return actor;
}
