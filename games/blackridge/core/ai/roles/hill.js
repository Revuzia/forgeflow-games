// core/ai/roles/hill.js [lane modes] — OUTPOST's role system (rotating hill).
//
// Everything read is Tier W (the live hill's position / holder / CONTESTED /
// time left, and the NEXT hill only while the HUD previews it — exactly the
// human's hill marker and timer), Tier R (team contacts from teammates' own
// percepts) or teammate state. Enemy head counts on the hill are never read.
//
// ROLES (closed reason set: HILL_CAPTURE / HILL_HOLD / HILL_ROTATE / HILL_ANCHOR)
//   capture — walk to the hill and stand in it (we do not hold it)
//   hold    — we hold it: a spread spot inside the ring, facing the enemy side
//   rotate  — the next hill is previewed: one or two of us pre-position there
//             early (more when the live hill is lost / nearly over)
//   anchor  — one operator sits on the enemy's approach to the hill (between
//             the hill and their side), cutting off the reinforcements that
//             would contest it; only when we have bodies to spare
// Posture: ahead → hold + anchor; behind or overtime → everyone onto the hill.

const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const NEAR_M = 14;
const ANCHOR_OUT_M = 12;

function bandOf(body) { return BAND_BY_ARCH[body.archetype] || [15, 35]; }

function driveTo(ctx, b, dest) {
  const { api, t } = ctx;
  const rec = b.rec, body = b.body;
  const stale = !rec.route || !rec.route.to || api.hdist(rec.route.to, dest) > 4 ||
    (t - rec.routeAt > ctx.latchS.route && api.hdist(rec.route.to, dest) > 2);
  if (stale) {
    rec.route = api.buildRoute(body.pos, dest, api.routeCost(bandOf(body)));
    rec.routeAt = t;
  }
  const anchor = rec.route ? api.followRoute(rec, body) : null;
  return anchor || dest;
}

export function ringSpot(z, k, rad, faceX, faceZ) {
  let fx = faceX - z.pos[0], fz = faceZ - z.pos[2];
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;
  const ang = (k % 4) * (Math.PI / 2) + Math.floor(k / 4) * 0.7;
  const c = Math.cos(ang), s = Math.sin(ang);
  const rr = Math.min(rad, z.r * 0.6);
  return [z.pos[0] + (fx * c - fz * s) * rr, z.pos[1], z.pos[2] + (fx * s + fz * c) * rr];
}

// the enemy's side of the map: mean of their own-side cluster anchors
function enemySideRef(m, team) {
  const clusters = m.clusters || {};
  const want = team === 0 ? "east" : "west";
  let x = 0, z = 0, n = 0;
  for (const k of Object.keys(clusters).sort()) {
    const c = clusters[k];
    if (!c || !c.anchor || c.side !== want) continue;
    x += c.anchor[0]; z += c.anchor[2]; n++;
  }
  return n ? [x / n, 0, z / n] : null;
}

export function assign(ctx) {
  const { m, api, bots, human, sit } = ctx;
  const R = api.REASONS;
  const team = ctx.team;
  const H = m.state.mode && m.state.mode.hill;
  const zones = (m.state.mode && m.state.mode.zones) || [];
  const live = zones[0];
  if (!H || !live) {
    for (const b of bots) api.write(b.rec, b.body, { role: "lane", reason: R.DUTY, anchor: null, priority: 0, firePolicy: "free", posture: ctx.posture });
    return;
  }
  const next = H.previewOn ? zones.find((z) => z.preview) : null;
  const ours = H.holder === team, contested = !!H.contested;
  const N = bots.length;
  const ot = m.phase === "overtime";
  const behind = sit && sit.us < sit.them;
  const enemyRef = enemySideRef(m, team) || live.pos;

  // the human holding the hill alone frees one more of us to anchor
  let humanOn = false;
  if (human && human.actor.alive) {
    const hp = m.posOf(human.actor);
    if (hp && api.hdist(hp, live.pos) <= live.r + 1) humanOn = true;
  }

  // ---- quotas
  let nRotate = 0, nAnchor = 0;
  if (next) {
    nRotate = H.timeLeftS <= 5 ? Math.min(N, 2 + (ours ? 0 : 2)) : 1;
    if (!ours && !contested && H.timeLeftS <= 8) nRotate = Math.min(N, N - 1); // the live one is gone: get ahead
  }
  if (!ot && !behind && ours && N - nRotate >= (humanOn ? 3 : 4)) nAnchor = 1;
  const nHill = Math.max(0, N - nRotate - nAnchor);

  // ---- slot order: hill (nearest first), then rotate (nearest to next), then anchor
  const free = bots.slice();
  const take = (ref, kind) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const rec = free[i].rec;
      let d = api.navDist(free[i].body.pos, ref);
      if (rec._hillKind === kind && api.latched(rec)) d -= 15; // keep a latched job (no thrash)
      if (d < bd - 1e-9) { bd = d; best = i; }
    }
    return best >= 0 ? free.splice(best, 1)[0] : null;
  };
  const jobs = [];
  for (let i = 0; i < nRotate && next; i++) { const b = take(next.pos, "rotate"); if (b) jobs.push([b, "rotate"]); }
  const anchorPos = (() => {
    const dx = enemyRef[0] - live.pos[0], dz = enemyRef[2] - live.pos[2];
    const L = Math.hypot(dx, dz) || 1;
    return [live.pos[0] + dx / L * (live.r + ANCHOR_OUT_M), live.pos[1], live.pos[2] + dz / L * (live.r + ANCHOR_OUT_M)];
  })();
  for (let i = 0; i < nAnchor; i++) { const b = take(anchorPos, "anchor"); if (b) jobs.push([b, "anchor"]); }
  for (let i = 0; i < nHill; i++) { const b = take(live.pos, "hill"); if (b) jobs.push([b, "hill"]); }

  // ---- orders
  let k = 0, kn = 0;
  const posture = ot || behind ? "press" : ctx.posture;
  for (const [b, kind] of jobs) {
    const rec = b.rec, body = b.body;
    rec._hillKind = kind;
    const engaged = api.engagedNow(body);
    if (kind === "rotate") {
      const d = api.hdist(body.pos, next.pos);
      const spot = ringSpot(next, kn++, 2.0, enemyRef[0], enemyRef[2]);
      const anchor = d <= NEAR_M ? spot : driveTo(ctx, b, spot);
      if (d <= NEAR_M) rec.route = null;
      api.write(rec, body, {
        role: "attack", reason: R.HILL_ROTATE, anchor, anchorKind: d <= NEAR_M ? "station" : "lane", routeUse: d > NEAR_M,
        priority: engaged ? 0.45 : 0.8, firePolicy: "free", posture,
      });
      continue;
    }
    if (kind === "anchor") {
      const d = api.hdist(body.pos, anchorPos);
      const anchor = d <= 6 ? anchorPos : driveTo(ctx, b, anchorPos);
      api.write(rec, body, {
        role: "defend", reason: R.HILL_ANCHOR, anchor, anchorKind: d <= 6 ? "station" : "lane", routeUse: d > 6,
        priority: engaged ? 0.4 : 0.65, firePolicy: "free", posture, noFlank: true,
      });
      continue;
    }
    const d = api.hdist(body.pos, live.pos);
    const reason = ours ? R.HILL_HOLD : R.HILL_CAPTURE;
    if (d <= NEAR_M) {
      rec.route = null;
      const spot = ringSpot(live, k++, ours && !contested ? 2.2 : 1.5, enemyRef[0], enemyRef[2]);
      api.write(rec, body, {
        role: ours ? "defend" : "attack", reason, anchor: spot, anchorKind: "flag",
        priority: contested || !ours ? 0.9 : 0.8, firePolicy: "free", posture,
        noRetreat: d <= live.r, noFlank: true,
      });
    } else {
      const anchor = driveTo(ctx, b, [live.pos[0], live.pos[1], live.pos[2]]);
      api.write(rec, body, {
        role: "attack", reason, anchor, anchorKind: "lane", routeUse: true,
        priority: engaged ? 0.45 : 0.8, firePolicy: "free", posture,
      });
    }
  }
}
