// core/ai/roles/ladder.js [lane modes] — ASCENT's solo pass (weapon ladder).
//
// The FFA solo pass (roles/ffa.js: hunt / lane / evade from the bot's OWN
// percept + the public scoreboard) with the ladder's rung as the score. One
// addition: on the KNIFE rung (the gun carried empty) a bot that has a fresh
// percept of a target CLOSES on it (LADDER_CLOSE: anchor on its own lastKnown,
// no retreat) — the melee block in the FSM then makes the strike. Nothing else
// is read: a bot's own percept is Tier P, its own rung is its own state.

import { assign as assignFfa } from "./ffa.js";

const FRESH_S = 3.0;

export function assign(ctx) {
  assignFfa(ctx);
  overlay(ctx);
}

// the knife-rung overlay alone (selftest entry point: no lane graph needed)
export function overlay(ctx) {
  const { t, api, bots } = ctx;
  const R = api.REASONS;
  for (const b of bots) {
    const body = b.body;
    if (!body._knifeOnly) continue;
    const P = body.percept;
    if (!P || P.target == null || !P.lastKnown || t - (P.lastSeenT != null ? P.lastSeenT : -1e9) > FRESH_S) continue;
    b.rec.route = null;
    api.write(b.rec, body, {
      role: "attack", reason: R.LADDER_CLOSE,
      anchor: [P.lastKnown[0], P.lastKnown[1] || 0, P.lastKnown[2]], anchorKind: "flag",
      priority: 0.9, firePolicy: "free", posture: "press", noRetreat: true, holdS: 1.5,
    });
  }
}

export { overlay as _overlay };
