// core/ai/roles/tags.js [lane modes] — RECLAIM's role layer (tag collection).
//
// The base is the SKIRMISH (tdm) commander — lanes, quotas, posture — and on
// top of it every live tag (Tier W: the world shows every tag to everyone) is
// offered to ONE nearby teammate who is free to fetch it:
//   enemy tag → TAG_CONFIRM, our own fallen teammate's tag → TAG_DENY.
// "Without suiciding for tags": a tag is skipped when the walk is long
// (> FETCH_M of graph distance), when two or more of us died near it in the
// last 12 s (the public killfeed — it is a bait spot), or when team contacts
// sit on it (Tier R); a bot in a live fight is not pulled off it unless the
// tag is right under its feet. A tag that will expire before we can reach it
// is skipped too (walk speed from the commander's own constant).
// One fetcher per tag; at most half the team fetching at once.

import { assign as assignTdm } from "./tdm.js";

const FETCH_M = 28;           // farther than this is not worth the walk
const UNDERFOOT_M = 5;        // engaged bots still grab a tag this close
const DEATH_WINDOW_S = 12, DEATH_NEAR_M = 8;
const CONTACT_NEAR_M = 10;

export function assign(ctx) {
  assignTdm(ctx); // the base shape first (lanes / posture); fetchers override it
  overlay(ctx);
}

// the fetch overlay alone (selftest entry point: no lane graph needed)
export function overlay(ctx) {
  const { m, t, api, bots } = ctx;
  const R = api.REASONS;
  const team = ctx.team;
  const tags = (m.state.mode && m.state.mode.tags) || [];
  if (!tags.length || !bots.length) return;
  const maxFetch = Math.max(1, Math.floor(bots.length / 2));
  const busy = new Set();
  const walk = (ctx.speeds && ctx.speeds.walk) || 4.6;

  const deathsNear = (p) => {
    let n = 0;
    for (const d of api.deathRing) {
      if (d.team !== team || t - d.t > DEATH_WINDOW_S) continue;
      if (api.hdist(d.pos, p) <= DEATH_NEAR_M) n++;
    }
    return n;
  };
  const contactsNear = (p) => (ctx.gid ? api.comms.contactWeightNear(ctx.gid, t, p[0], p[2], CONTACT_NEAR_M) : 0);

  // nearest tags first (to our team's centroid) — deterministic order
  let cx = 0, cz = 0;
  for (const b of bots) { cx += b.body.pos[0]; cz += b.body.pos[2]; }
  cx /= bots.length; cz /= bots.length;
  const order = tags.slice().sort((a, b) =>
    (Math.hypot(a.pos[0] - cx, a.pos[2] - cz) - Math.hypot(b.pos[0] - cx, b.pos[2] - cz)) || (a.id - b.id));

  for (const g of order) {
    if (busy.size >= maxFetch) break;
    const confirm = g.team !== team;
    let best = null, bd = Infinity;
    for (const b of bots) {
      if (busy.has(b)) continue;
      const d = api.navDist(b.body.pos, g.pos);
      const engaged = api.engagedNow(b.body);
      if (engaged && d > UNDERFOOT_M) continue;
      if (d > FETCH_M) continue;
      if (d / walk > g.expiresT - t - 0.5) continue; // gone before we get there
      // a latched fetcher keeps its tag (no thrash)
      const keep = b.rec._tagId === g.id ? -8 : 0;
      if (d + keep < bd) { bd = d + keep; best = b; }
    }
    if (!best) continue;
    const dd = api.hdist(best.body.pos, g.pos);
    if (dd > UNDERFOOT_M && (deathsNear(g.pos) >= 2 || contactsNear(g.pos) >= 1.5)) continue; // bait
    busy.add(best);
    best.rec._tagId = g.id;
    best.rec.route = null;
    api.write(best.rec, best.body, {
      role: "attack", reason: confirm ? R.TAG_CONFIRM : R.TAG_DENY,
      anchor: [g.pos[0], g.pos[1], g.pos[2]], anchorKind: "flag",
      priority: api.engagedNow(best.body) ? 0.5 : (confirm ? 0.85 : 0.75),
      firePolicy: "free", posture: ctx.posture, holdS: 2.0,
    });
  }
  for (const b of bots) if (!busy.has(b)) b.rec._tagId = null;
}

export { overlay as _overlay };
