// GENESIS — the creature is gone (LIVING.md §0.1 decision 6, §3.5).
//
// The giant learning creature (a pet titan that learned from slaps and strokes, leashed to a village) was fantasy and
// Black & White's signature; it pinned the people's love and fear at 1.0 and changed nothing they did (LIVING §0.3).
// The god's lever of influence is now PEOPLE and SIGNS: prophets whose word the god makes true or false, omens made with
// the god's own powers, sacred places and real, life-size sacred animals (god/prophets.ts, god/omens.ts, god/sacred.ts).
//
// This file is kept only so old saves load: it drops the creature state a save from before 1.5 may carry (the 1.5
// migration step, core/migrate15.ts, and GodState.fromJson). The DOCS lane may delete it once no save needs it.

/** the god part of a save header (only what the creature touched) */
interface GodHeader {
  creatures?: unknown[];
  hands?: { held?: { kind?: string } | null; pose?: string }[];
  projectiles?: { payload?: { kind?: string } }[];
  laws?: Record<string, number>;
}

/**
 * Drop every trace of the creature from a save header's god state: the creatures, a creature held by a hand (the hand
 * opens), creatures in flight, and the creature laws. Returns how many creatures there were.
 */
export function dropCreatures(header: Record<string, unknown>): number {
  const g = header.god as GodHeader | null | undefined;
  if (!g || typeof g !== 'object') return 0;
  const n = Array.isArray(g.creatures) ? g.creatures.length : 0;
  delete g.creatures;
  for (const h of g.hands ?? []) if (h.held && h.held.kind === 'creature') { h.held = null; h.pose = 'open'; }
  if (Array.isArray(g.projectiles)) g.projectiles = g.projectiles.filter((pr) => pr.payload?.kind !== 'creature');
  if (g.laws) for (const k of Object.keys(g.laws)) if (k.startsWith('creature.')) delete g.laws[k];
  return n;
}

/** what the game says to anyone who asks for a creature (freeform, the creature words of lexicon.json) */
export const NO_CREATURE = "There is no great creature in this world. Choose a prophet: 'make Hesh my prophet'.";
