// core/hud/callouts.js [identity lane] — the team channel in TEXT.
// "Call every move aloud": every radio line a TEAMMATE keys (the bark events
// from core/ai/squad.js + roles, plus throws, kills, objective swings) becomes
// a short line in a team-chat strip and the subtitle strip, in that
// operator's own phrasing style (core/ai/personality.js), with the radio
// babble (core/audio/sfx.js onBark) keyed at the SAME moment the text lands.
// Enemy lines are never shown (their radio stays the existing spatial babble).
//
// Rate limits (CALLOUT below; pure, selftested — callouts.selftest.cjs):
//   - one line per MIN_GAP_S (2.5 s) on the strip; only priority ≥ 5 (incoming
//     grenade) may cut that to URGENT_GAP_S (1.25 s)
//   - per-speaker cooldown 6 s + 6 s × (1 − chattiness)  (urgent lines exempt)
//   - the same KIND team-wide at most once per KIND_CD_S (6 s)
//   - a priority queue (≤ MAX_Q) whose lines go stale after TTL_S[kind]: a
//     call that could not be said in time is dropped, never said late
//   - low-priority chatter is skipped by quiet operators (chattiness roll)
//   - phrasing never repeats the last two variants used for that kind
//
// Pure core (Node-safe, DOM-free): CALLOUT, KIND_PRI, PHRASES, makeQueue,
// bearingDeg, bearingWord, landmarkName, buildLandmarks, phrase, isClean.
// View: createCallouts(ctx, {hud}) → {attach(bridge), update(dt), log, stats()}

import { personalityOf } from "../ai/personality.js";

/** roster actor for a combatant id ('P' or a bot id) — via the match facade (sim.match.m) */
export function actorOfWho(sim, who) {
  if (!sim || who == null) return null;
  const f = sim.match && sim.match.m;
  if (f && typeof f.actorOf === "function") { const a = f.actorOf(who); if (a) return a; }
  const M = sim.state && sim.state.match;
  if (!M || !M.actors) return null;
  if (who === "P") return M.actors[0] || null;
  const bots = sim.state.bots;
  for (let i = 0; i < bots.length; i++) if (bots[i].id === who) return bots[i].actorId != null ? M.actors[bots[i].actorId] || null : null;
  return null;
}

export const CALLOUT = {
  MIN_GAP_S: 2.5, URGENT_GAP_S: 1.25, URGENT_PRI: 5,
  SPEAKER_CD_BASE_S: 6, SPEAKER_CD_QUIET_S: 6,
  KIND_CD_S: 6, SPEAKER_KIND_CD_S: 18, MAX_Q: 6,
  STRIP_LINES: 4, LINE_S: 7,
};
export const KIND_PRI = {
  grenwarn: 5, mandown: 3, lastman: 4, ourflag: 4, zonelost: 4, flagtaken: 4,
  contact: 3, flank: 3, frag: 3, flash: 3, smoke: 3, stun: 3, mine: 3, carrier: 3, escortme: 3,
  returning: 3, intercept: 3, zonecap: 3, zoneours: 3, contested: 3, streak: 3,
  hit: 2, backup: 2, push: 2, kill: 2, reload: 1, idle: 0,
};
export const TTL_S = { grenwarn: 1.5, contact: 2.5, reload: 2.5, kill: 3, hit: 2.5, backup: 3, flank: 3 };
const DEFAULT_TTL = 4;

// ---------------------------------------------------------------- phrasing
// {dir} compass word, {where} " by the <landmark>" or "", {count}/{Count}
// "one/two/three plus", {side} left/right, {zone} zone label, {name} a
// teammate's callsign, {streak} call-in name. Kept short: a line is read in
// under a second.
export const PHRASES = {
  contact: {
    terse: ["Contact {dir}{where}.", "{Count}, {dir}{where}.", "Eyes {dir}{where}."],
    pro: ["Contact {dir}{where}, {count}.", "Enemy {dir}{where}.", "{Count} hostile {dir}{where}."],
    casual: ["Got someone {dir}{where}.", "Heads up, {count} {dir}{where}.", "Movement {dir}{where}."],
    hype: ["Contact {dir}! {Count}{where}!", "They're {dir}{where}, {count}!", "Found 'em, {dir}{where}!"],
  },
  flank: {
    terse: ["Flanking {side}.", "Going {side}."],
    pro: ["Moving {side} flank.", "Taking the {side} side, cover me."],
    casual: ["I'll swing round {side}.", "Going round the {side}."],
    hype: ["Swinging {side}, keep 'em busy!", "Going {side}, watch this!"],
  },
  reload: {
    terse: ["Reloading.", "Changing mag."],
    pro: ["Reloading, cover.", "Mag change, cover me."],
    casual: ["Hang on, reloading.", "Reloading, one sec."],
    hype: ["Reloading! Cover me!", "I'm dry! Reloading!"],
  },
  frag: {
    terse: ["Frag out.", "Frag."], pro: ["Frag out{where}.", "Throwing frag."],
    casual: ["Frag going in.", "Cooking a frag."], hype: ["Frag out! Eat that!", "Nade out!"],
  },
  flash: {
    terse: ["Flash out.", "Flashing."], pro: ["Flash out{where}.", "Flashbang out, push."],
    casual: ["Flash going in.", "Popping a flash."], hype: ["Flash out, go go!", "Flashing 'em!"],
  },
  smoke: {
    terse: ["Smoke out.", "Smoking."], pro: ["Smoke out{where}.", "Popping smoke."],
    casual: ["Throwing smoke.", "Smoke going down."], hype: ["Smoke out, move!", "Smoking it, go!"],
  },
  stun: {
    terse: ["Stun out.", "Concussion."], pro: ["Concussion out{where}.", "Stun out, push."],
    casual: ["Stun going in.", "Throwing a stun."], hype: ["Stun out, go!", "Rattling 'em, push!"],
  },
  hit: {
    terse: ["Taking fire.", "Hit."], pro: ["Taking fire{where}.", "I'm hit, falling back."],
    casual: ["Ow, taking fire.", "I'm getting lit up."], hype: ["I'm hit! They're on me!", "Taking fire, taking fire!"],
  },
  backup: {
    terse: ["Need backup{where}.", "Help{where}."], pro: ["Need backup{where}.", "Pinned{where}, need support."],
    casual: ["Could use a hand{where}.", "Someone help me out{where}."], hype: ["Need backup now!", "Get over here, I'm pinned!"],
  },
  mandown: {
    terse: ["{name}'s down.", "Lost {name}."], pro: ["Man down, {name}.", "{name} is down{where}."],
    casual: ["We lost {name}.", "{name} got dropped."], hype: ["They got {name}!", "{name}'s down, get 'em!"],
  },
  lastman: {
    terse: ["Last one up.", "Just me."], pro: ["I'm last one up.", "On my own here."],
    casual: ["Uh, it's just me now.", "Anyone? Just me left."], hype: ["Last man, I got this!", "One versus all, let's go!"],
  },
  push: {
    terse: ["Push.", "Pushing."], pro: ["Push now, together.", "Collapse on them."],
    casual: ["Let's push.", "Alright, let's go."], hype: ["Push push push!", "Go now, all in!"],
  },
  kill: {
    terse: ["One down.", "Down."], pro: ["Enemy down{where}.", "Tango down."],
    casual: ["Got 'im.", "Nailed one."], hype: ["Got him!", "Dropped one!"],
  },
  mine: {
    terse: ["Tripmine{where}.", "Mine{where}."], pro: ["Tripmine{where}, watch it.", "Claymore spotted{where}."],
    casual: ["Careful, tripmine{where}.", "There's a mine{where}."], hype: ["Mine{where}, don't walk in!", "Tripmine, heads up!"],
  },
  carrier: {
    terse: ["Got their flag.", "Carrying."], pro: ["I have their flag, heading home.", "Flag secured, moving."],
    casual: ["Got the flag, bringing it back.", "Flag's mine, coming home."], hype: ["Got their flag! Cover me!", "Flag's ours, let's go!"],
  },
  flagtaken: {
    terse: ["Got their flag.", "Flag up."], pro: ["Enemy flag taken.", "I have the enemy flag."],
    casual: ["Grabbed their flag.", "Got their flag, nice."], hype: ["Got their flag!", "Flag's up, let's go!"],
  },
  escortme: {
    terse: ["On me.", "Escort."], pro: ["Carrying, escort me.", "On me, I have the flag."],
    casual: ["Stick with me, I've got the flag.", "Cover me home."], hype: ["On me, flag's here!", "Escort me, go!"],
  },
  returning: {
    terse: ["Getting our flag.", "Returning."], pro: ["Moving to return our flag.", "Recovering our flag."],
    casual: ["I'll grab our flag back.", "Going for our flag."], hype: ["Getting our flag back!", "Our flag, on it!"],
  },
  intercept: {
    terse: ["Cutting off their carrier.", "On the carrier."], pro: ["Intercepting their carrier.", "Moving to cut the carrier."],
    casual: ["I'll cut their carrier off.", "Going after their carrier."], hype: ["Hunting their carrier!", "Their carrier's mine!"],
  },
  ourflag: {
    terse: ["They took our flag.", "Flag's gone."], pro: ["Our flag is taken.", "Enemy has our flag."],
    casual: ["They've got our flag!", "Flag's gone, they took it."], hype: ["They took our flag, get it back!", "Our flag! Go go!"],
  },
  zonecap: {
    terse: ["Taking {zone}.", "On {zone}."], pro: ["Capturing {zone}.", "Taking {zone}, cover."],
    casual: ["I'm on {zone}.", "Grabbing {zone}."], hype: ["Taking {zone}, let's go!", "{zone}'s mine!"],
  },
  zoneours: {
    terse: ["{zone} ours.", "Got {zone}."], pro: ["{zone} secured.", "We hold {zone}."],
    casual: ["Got {zone}.", "{zone}'s ours now."], hype: ["{zone} is ours!", "Locked {zone} down!"],
  },
  zonelost: {
    terse: ["Lost {zone}.", "{zone} gone."], pro: ["We lost {zone}.", "{zone} is theirs."],
    casual: ["They took {zone}.", "Ah, lost {zone}."], hype: ["They took {zone}, take it back!", "Lost {zone}! Go!"],
  },
  contested: {
    terse: ["{zone} contested.", "Fight on {zone}."], pro: ["{zone} contested.", "Enemy on {zone}."],
    casual: ["Someone's on {zone}.", "{zone}'s contested."], hype: ["They're on {zone}!", "Fight on {zone}, go!"],
  },
  streak: {
    terse: ["{streak} inbound.", "Copy, {streak}."], pro: ["{streak} inbound, keep clear.", "Copy {streak}, clearing."],
    casual: ["Nice, {streak} coming in.", "Oh, {streak}, nice."], hype: ["{streak} inbound, let's go!", "Here comes the {streak}!"],
  },
  grenwarn: {
    terse: ["Grenade!", "Nade!"], pro: ["Grenade, move!", "Grenade, clear out!"],
    casual: ["Grenade, look out!", "Nade, nade!"], hype: ["Grenade! Move!", "Nade, get out!"],
  },
  idle: {
    terse: ["Clear{where}.", "Holding{where}."], pro: ["Holding{where}, all clear.", "Quiet{where}."],
    casual: ["Nothing here{where}.", "All quiet{where}."], hype: ["Where are they?", "Come on, where'd they go?"],
  },
};

// nothing player-facing may name the machinery
const FORBIDDEN = /\b(bots?|ai|a\.i\.|npcs?|difficulty|skill|adaptive|cpu|computer)\b/i;
export function isClean(text) { return typeof text === "string" && text.length > 0 && !FORBIDDEN.test(text); }

// ---------------------------------------------------------------- geometry
const DIRS8 = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/** Compass bearing in degrees: 0 = north (world −Z), 90 = east (world +X). */
export function bearingDeg(dx, dz) {
  const d = Math.atan2(dx, -dz) * 180 / Math.PI;
  return (d + 360) % 360;
}
export function bearingWord(dx, dz) {
  return DIRS8[Math.round(bearingDeg(dx, dz) / 45) % 8];
}

const DIR_TOK = { north: "north", south: "south", east: "east", west: "west", n: "north", s: "south", e: "east", w: "west",
  ne: "north-east", nw: "north-west", se: "south-east", sw: "south-west" };
const DROP_TOK = { mid: 1, center: 1, centre: 1, ground: 1, poi: 1 };
const QUAL_TOK = { upper: 1, lower: 1, inner: 1, outer: 1, old: 1 };
/** "gallery_north" → "north gallery"; "plaza_center" → "plaza"; "cs1_mid" → null. */
export function landmarkName(key) {
  const toks = String(key || "").toLowerCase().split("_").filter(Boolean);
  if (!toks.length || toks.some((t) => /\d/.test(t))) return null;
  let dir = null, qual = null;
  const rest = [];
  for (const t of toks) {
    if (DIR_TOK[t]) { if (!dir) dir = DIR_TOK[t]; continue; }
    if (QUAL_TOK[t]) { if (!qual) qual = t; continue; }
    if (DROP_TOK[t]) continue;
    rest.push(t);
  }
  if (!rest.length) return null;
  return (dir ? dir + " " : "") + (qual ? qual + " " : "") + rest.join(" ");
}
/** [{name, x, z}] from a colliders.nodes table ({key: [x,y,z]}). */
export function buildLandmarks(nodes) {
  const out = [];
  if (!nodes) return out;
  for (const k of Object.keys(nodes)) {
    const p = nodes[k];
    const name = landmarkName(k);
    if (!name || !p || p.length < 3) continue;
    out.push({ name, x: p[0], z: p[2] });
  }
  return out;
}
/** " by the <landmark>" for the nearest landmark within maxD metres, else "". */
export function whereOf(marks, x, z, maxD = 14) {
  let best = null, bd = maxD;
  for (const m of marks) {
    const d = Math.hypot(m.x - x, m.z - z);
    if (d < bd) { bd = d; best = m; }
  }
  return best ? " by the " + best.name : "";
}

const COUNT = ["one", "one", "two", "three plus"];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Fill a phrase. `mem` (per kind → last two indices) keeps variety; `rng`
 * picks among the rest. Returns null when nothing clean can be said.
 */
export function phrase(kind, style, vars, rng, mem) {
  const bank = PHRASES[kind];
  if (!bank) return null;
  const list = bank[style] || bank.pro;
  if (!list || !list.length) return null;
  const recent = (mem && mem[kind]) || [];
  const keyOf = (i) => (style || "pro") + i;
  let cands = [];
  for (let i = 0; i < list.length; i++) if (!recent.includes(keyOf(i))) cands.push(i);
  if (!cands.length) cands = list.map((_, i) => i);
  const ix = cands[Math.floor((rng ? rng() : 0) * cands.length) % cands.length];
  if (mem) { mem[kind] = recent.concat([keyOf(ix)]).slice(-2); }
  const v = vars || {};
  const n = Math.max(1, Math.min(3, v.count | 0 || 1));
  let s = list[ix]
    .replace(/\{dir\}/g, v.dir || "ahead")
    .replace(/\{where\}/g, v.where || "")
    .replace(/\{count\}/g, COUNT[n])
    .replace(/\{Count\}/g, cap(COUNT[n]))
    .replace(/\{side\}/g, v.side || "left")
    .replace(/\{zone\}/g, v.zone || "the point")
    .replace(/\{name\}/g, v.name ? cap(String(v.name).toLowerCase()) : "Man")
    .replace(/\{streak\}/g, v.streak || "Strike");
  s = cap(s.replace(/\s+([,.!?])/g, "$1"));
  return isClean(s) ? s : null;
}

// ---------------------------------------------------------------- the queue
export function makeQueue(opts = {}) {
  const C = Object.assign({}, CALLOUT, opts);
  const q = [];
  const lastBySpeaker = new Map();
  const lastByKind = new Map();
  const lastBySpeakerKind = new Map(); // "NAME|kind" → t: one operator does not repeat one call
  let lastLineT = -1e9;
  const stats = { offered: 0, queued: 0, shown: 0, droppedCd: 0, droppedKind: 0, droppedStale: 0, droppedFull: 0 };
  const priOf = (k) => (KIND_PRI[k] != null ? KIND_PRI[k] : 1);
  const ttlOf = (k) => (TTL_S[k] != null ? TTL_S[k] : DEFAULT_TTL);
  const cdOf = (chat) => C.SPEAKER_CD_BASE_S + C.SPEAKER_CD_QUIET_S * (1 - Math.max(0, Math.min(1, chat == null ? 0.5 : chat)));
  function speakerBusy(it, t) {
    if (it.pri >= C.URGENT_PRI) return false;
    const ls = lastBySpeaker.get(it.speaker);
    return ls != null && t - ls < cdOf(it.chat);
  }
  function kindBusy(it, t) {
    if (it.pri >= 4) return false;
    const lk = lastByKind.get(it.kind);
    if (lk != null && t - lk < C.KIND_CD_S) return true;
    const ls = lastBySpeakerKind.get(it.speaker + "|" + it.kind);
    return ls != null && t - ls < C.SPEAKER_KIND_CD_S;
  }
  return {
    stats,
    get length() { return q.length; },
    /** item: {kind, speaker, t, chat?, data?} → true when queued */
    offer(item) {
      stats.offered++;
      const it = Object.assign({ pri: priOf(item.kind) }, item);
      if (speakerBusy(it, it.t)) { stats.droppedCd++; return false; }
      if (kindBusy(it, it.t)) { stats.droppedKind++; return false; }
      // one pending line per speaker+kind: the newer replaces the older
      for (let i = 0; i < q.length; i++) {
        if (q[i].speaker === it.speaker && q[i].kind === it.kind) { q.splice(i, 1); break; }
      }
      q.push(it);
      if (q.length > C.MAX_Q) {
        let worst = 0;
        for (let i = 1; i < q.length; i++) if (q[i].pri < q[worst].pri || (q[i].pri === q[worst].pri && q[i].t < q[worst].t)) worst = i;
        q.splice(worst, 1);
        stats.droppedFull++;
        if (worst === q.length) return false;
      }
      stats.queued++;
      return true;
    },
    /** the line to say now, or null (rate limited / nothing fresh) */
    pull(t) {
      for (let i = q.length - 1; i >= 0; i--) {
        if (t - q[i].t > ttlOf(q[i].kind)) { q.splice(i, 1); stats.droppedStale++; }
      }
      if (!q.length) return null;
      let best = -1;
      for (let i = 0; i < q.length; i++) {
        const it = q[i];
        if (speakerBusy(it, t) || kindBusy(it, t)) continue;
        if (best < 0 || it.pri > q[best].pri || (it.pri === q[best].pri && it.t < q[best].t)) best = i;
      }
      if (best < 0) return null;
      const it = q[best];
      const gap = it.pri >= C.URGENT_PRI ? C.URGENT_GAP_S : C.MIN_GAP_S;
      if (t - lastLineT < gap) return null;
      q.splice(best, 1);
      lastLineT = t;
      lastBySpeaker.set(it.speaker, t);
      lastByKind.set(it.kind, t);
      lastBySpeakerKind.set(it.speaker + "|" + it.kind, t);
      stats.shown++;
      return it;
    },
    clear() { q.length = 0; lastBySpeaker.clear(); lastByKind.clear(); lastBySpeakerKind.clear(); lastLineT = -1e9; },
  };
}

// small deterministic view-side rng (never touches the sim's streams)
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================================================================== view
const CSS = `
#co-strip{position:absolute;left:18px;bottom:30%;width:min(400px,58vw);pointer-events:none;
  display:flex;flex-direction:column;gap:3px;font:600 13px/1.25 "Rajdhani","Segoe UI",system-ui,sans-serif;
  letter-spacing:.02em;z-index:6;scale:var(--br-hud-s,1);transform-origin:0 100%;}
#co-strip .co-l{align-self:flex-start;max-width:100%;padding:2px 8px 2px 6px;border-radius:3px;
  background:rgba(8,10,14,.46);color:#e8ecef;text-shadow:0 1px 2px rgba(0,0,0,.9);
  border-left:2px solid var(--co-c,#d9a441);transition:opacity .6s linear;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;}
#co-strip .co-n{font-weight:800;letter-spacing:.06em;margin-right:5px;}
#co-strip .co-t{opacity:.55;font-weight:600;font-size:10px;margin-right:4px;letter-spacing:.08em;}
body.kc-on #co-strip{visibility:hidden}
@media (max-width:700px){#co-strip{bottom:38%;font-size:12px;left:10px;}}
`;

function friendColor(sim) {
  try {
    const pal = globalThis.__BR_SETTINGS__ && globalThis.__BR_SETTINGS__.teamColors ? globalThis.__BR_SETTINGS__.teamColors() : null;
    if (pal && pal.friend) return pal.friend;
  } catch (_) { /* default below */ }
  const m = sim && sim.state && sim.state.match;
  const t0 = m && m.teams && m.teams[0];
  return (t0 && t0.tint) || "#d9a441";
}

export function createCallouts(ctx, deps = {}) {
  const hud = deps.hud || ctx.hud || null;
  const getSim = () => (typeof ctx.sim === "function" ? ctx.sim() : ctx.sim) || null;
  const hasDom = typeof document !== "undefined";
  let strip = null;
  if (hasDom) {
    if (!document.getElementById("co-css")) {
      const st = document.createElement("style");
      st.id = "co-css"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    strip = document.createElement("div");
    strip.id = "co-strip";
    const parent = (hud && hud._root) || document.body;
    parent.appendChild(strip);
  }

  let queue = makeQueue();
  let rng = mulberry32(1);
  let mem = {};
  let marks = [];
  let marksSrc = null;
  let simRef = null;
  let lastMateDown = null; // {name, t}
  const lines = [];          // DOM rows on the strip {el, t}
  const log = [];            // ring of shown lines (tests / diagnostics)
  const stats = { shown: 0, offered: 0, enemyIgnored: 0, cleanDrops: 0 };

  function resetFor(sim) {
    simRef = sim;
    queue = makeQueue();
    const seed = (sim && sim.state && sim.state.match && sim.state.match.actors ? 0x5eed : 1) ^ ((sim && sim.epoch) | 0) * 7919;
    rng = mulberry32(seed);
    mem = {};
    lastMateDown = null;
    for (const l of lines) l.el.remove();
    lines.length = 0;
    marks = buildLandmarks(sim && sim.colliders && sim.colliders.nodes);
    marksSrc = sim && sim.colliders;
  }

  const nowT = () => { const s = getSim(); return s && s.state ? s.state.time : 0; };

  // is `who` (a bot id) a bot TEAMMATE of the human in a team match?
  function mateOf(sim, who) {
    const P = sim && sim.state && sim.state.player;
    if (!sim || !sim.match || !P || who == null || who === "P") return null;
    const a = actorOfWho(sim, who);
    if (!a || a.kind !== "bot") return null;
    if (a.team === a.actorId) return null; // FFA: ten teams of one, nobody to talk to
    if (a.team !== P.team) return null;
    return a;
  }
  function bodyOf(sim, who) {
    const bots = sim.state.bots;
    for (let i = 0; i < bots.length; i++) if (bots[i].id === who) return bots[i];
    return null;
  }
  function nearestMate(sim, pos, list) {
    let best = null, bd = Infinity;
    for (const who of list || []) {
      const a = mateOf(sim, who);
      if (!a) continue;
      const b = bodyOf(sim, who);
      if (!b || !b.alive) continue;
      const d = pos ? Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[2]) : 0;
      if (d < bd) { bd = d; best = who; }
    }
    return best;
  }
  function lastStanding(sim, who) {
    const P = sim.state.player;
    if (P && P.alive) return false;
    for (const b of sim.state.bots) if (b.alive && b.id !== who && mateOf(sim, b.id)) return false;
    return true;
  }
  function anyMateNear(sim, pos, maxD) {
    const list = [];
    for (const b of sim.state.bots) if (b.alive) list.push(b.id);
    const who = nearestMate(sim, pos, list);
    if (who == null) return null;
    const b = bodyOf(sim, who);
    return b && (!pos || Math.hypot(b.pos[0] - pos[0], b.pos[2] - pos[2]) <= maxD) ? who : null;
  }

  // offer a line from teammate `who`; vars are resolved at SAY time (fresh)
  function offer(sim, who, kind, data, bark) {
    const a = mateOf(sim, who);
    if (!a) { stats.enemyIgnored++; return false; }
    const p = personalityOf(a.name);
    const pri = KIND_PRI[kind] != null ? KIND_PRI[kind] : 1;
    // quiet operators skip small talk (pri ≤ 2) more often
    if (pri <= 2 && rng() > 0.35 + 0.65 * p.chat) return false;
    if (kind === "idle" && rng() > p.chat * 0.5) return false;
    stats.offered++;
    const ok = queue.offer({ kind, speaker: a.name, who, t: sim.state.time, chat: p.chat, data: data || null });
    if (bark) bark.coSkip = true; // this teammate's babble is keyed when (if) the line is said
    return ok;
  }

  function varsFor(sim, it) {
    const b = bodyOf(sim, it.who);
    const d = it.data || {};
    const v = {};
    const at = d.pos || (b && b.pos) || null;
    if (it.kind === "contact" && b) {
      const P = b.percept;
      const rec = P && P.target != null && P.byTarget ? P.byTarget[P.target] : null;
      const tp = (rec && rec.lastKnown) || (P && P.lastKnown) || null;
      if (tp) {
        v.dir = bearingWord(tp[0] - b.pos[0], tp[2] - b.pos[2]);
        v.where = whereOf(marks, tp[0], tp[2]);
        let n = 0;
        const t = sim.state.time;
        for (const k of Object.keys(P.byTarget || {})) {
          const r = P.byTarget[k];
          if (!r || !r.lastKnown || t - r.lastSeenT > 2.0) continue;
          if (Math.hypot(r.lastKnown[0] - tp[0], r.lastKnown[2] - tp[2]) <= 10) n++;
        }
        v.count = Math.max(1, n);
        v._bearing = bearingDeg(tp[0] - b.pos[0], tp[2] - b.pos[2]);
        v._from = [b.pos[0], b.pos[2]]; v._to = [tp[0], tp[2]];
      } else return null; // nothing honest to say about where
    } else if (at) {
      v.where = whereOf(marks, at[0], at[2], 12);
    }
    if (it.kind === "flank" && b && b._brain) v.side = b._brain.flankSide === "R" ? "right" : "left";
    if (d.zone) v.zone = d.zone;
    if (d.name) v.name = d.name;
    if (d.streak) v.streak = d.streak;
    return v;
  }

  function say(sim, it) {
    const a = mateOf(sim, it.who);
    if (!a) return false;
    const b = bodyOf(sim, it.who);
    if (!b || (!b.alive && it.kind !== "mandown")) return false; // the dead do not talk
    let kind = it.kind;
    if (kind === "hit" && b.hp < 30) kind = "backup";
    const p = personalityOf(a.name);
    const v = varsFor(sim, it);
    if (!v) return false;
    const text = phrase(kind, p.style, v, rng, mem);
    if (!text || !isClean(text)) { stats.cleanDrops++; return false; }
    const name = a.name;
    stats.shown++;
    log.push({ t: sim.state.time, speaker: name, kind, text, style: p.style, bearing: v._bearing, from: v._from, to: v._to });
    if (log.length > 400) log.shift();
    // text strip
    if (strip) {
      const el = document.createElement("div");
      el.className = "co-l";
      const col = friendColor(sim);
      el.style.setProperty("--co-c", col);
      const tag = document.createElement("span"); tag.className = "co-t"; tag.textContent = "TEAM";
      const n = document.createElement("span"); n.className = "co-n"; n.textContent = name + ":"; n.style.color = col;
      const tx = document.createElement("span"); tx.textContent = text;
      el.appendChild(tag); el.appendChild(n); el.appendChild(tx);
      strip.appendChild(el);
      lines.push({ el, t: sim.state.time });
      while (lines.length > CALLOUT.STRIP_LINES) lines.shift().el.remove();
    }
    // subtitle strip (honours Subtitles on/off + size)
    try { if (hud && hud.subtitle) hud.subtitle(text, { speaker: name, dur: 2.4, priority: it.pri >= 4 }); } catch (_) { /* HUD optional */ }
    // the radio babble, keyed now — sized to the line
    try {
      const core = ctx.__audioCore;
      const sx = core && core.sfx;
      if (sx && sx.onBark && core.env && core.env.ac && core.env.ac.state === "running") {
        sx.onBark({ botId: it.who, kind, text, urgent: it.pri >= 4 });
      }
    } catch (_) { /* audio never breaks the frame */ }
    return true;
  }

  // ---------------------------------------------------------------- events
  function onBark(d) {
    const sim = getSim();
    if (!sim || !d || !sim.match) return;
    let kind = d.kind;
    if (kind === "grenade") kind = d.warn ? "grenwarn" : "frag";
    else if (kind === "down") { if (mateOf(sim, d.botId)) d.coSkip = true; return; } // said from the death event (it has the name)
    else if (kind === "lastman") {
      // squads are pairs: "last one up" only when the whole side is down but this operator
      if (!lastStanding(sim, d.botId)) { if (mateOf(sim, d.botId)) d.coSkip = true; return; }
    }
    if (!PHRASES[kind]) return;
    const data = d.pos ? { pos: d.pos } : null;
    offer(sim, d.botId, kind, data, d);
  }
  function onEquip(d) {
    const sim = getSim();
    if (!sim || !d || !sim.match || d.phase !== "out") return;
    if (d.kind === "flash" || d.kind === "smoke" || d.kind === "stun") offer(sim, d.who, d.kind, { pos: d.pos });
  }
  function onDeath(d) {
    const sim = getSim();
    if (!sim || !d || !sim.match) return;
    const victimMate = mateOf(sim, d.victim);
    if (victimMate) {
      lastMateDown = { name: victimMate.name, t: sim.state.time };
      // the nearest living teammate who could see it calls the name
      const list = [];
      for (const b of sim.state.bots) if (b.alive && b.id !== d.victim) list.push(b.id);
      const who = nearestMate(sim, d.pos, list);
      const wb = who != null ? bodyOf(sim, who) : null;
      if (wb && d.pos && Math.hypot(wb.pos[0] - d.pos[0], wb.pos[2] - d.pos[2]) <= 45) offer(sim, who, "mandown", { name: victimMate.name, pos: d.pos });
    }
    const v = actorOfWho(sim, d.victim);
    const P = sim.state.player;
    if (v && P && v.team !== P.team && mateOf(sim, d.attacker)) offer(sim, d.attacker, "kill", { pos: d.pos });
  }
  function onZone(d) {
    const sim = getSim();
    if (!sim || !d || !sim.match) return;
    const P = sim.state.player;
    const zone = d.label || d.zone || "the point";
    const us = P ? P.team : 0;
    if (d.state === "capturing" && d.team === us) {
      const who = nearestMate(sim, d.pos, d.byWho);
      if (who != null) offer(sim, who, "zonecap", { zone, pos: d.pos });
    } else if (d.state === "captured" && d.team === us) {
      const who = nearestMate(sim, d.pos, d.byWho) ?? anyMateNear(sim, d.pos, 40);
      if (who != null) offer(sim, who, "zoneours", { zone, pos: d.pos });
    } else if ((d.state === "captured" || d.state === "neutralised") && d.team !== us && d.prevOwner === us) {
      const who = anyMateNear(sim, d.pos, 60);
      if (who != null) offer(sim, who, "zonelost", { zone, pos: d.pos });
    } else if (d.state === "contested" && d.owner === us) {
      const who = anyMateNear(sim, d.pos, 30);
      if (who != null) offer(sim, who, "contested", { zone, pos: d.pos });
    }
  }
  function onFlag(d) {
    const sim = getSim();
    if (!sim || !d || !sim.match) return;
    const P = sim.state.player;
    if (d.state === "taken" && P && d.team === P.team && d.byWho !== "P") {
      const who = anyMateNear(sim, d.pos, 80);
      if (who != null) offer(sim, who, "ourflag", { pos: d.pos });
    }
  }
  function onStreak(d) {
    const sim = getSim();
    if (!sim || !d || !sim.match || d.phase !== "call") return;
    const P = sim.state.player;
    const who = anyMateNear(sim, P ? P.pos : null, 200);
    if (who != null) {
      const nm = String(d.name || "Strike").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      offer(sim, who, "streak", { streak: nm });
    }
  }

  const api = {
    attach(bridge) {
      resetFor(getSim());
      bridge.register("bark", (d) => { try { onBark(d); } catch (e) { /* view only */ } });
      bridge.register("equip", (d) => { try { onEquip(d); } catch (e) { /* view only */ } });
      bridge.register("death", (d) => { try { onDeath(d); } catch (e) { /* view only */ } });
      bridge.register("zonecap", (d) => { try { onZone(d); } catch (e) { /* view only */ } });
      bridge.register("flag", (d) => { try { onFlag(d); } catch (e) { /* view only */ } });
      bridge.register("streak", (d) => { try { onStreak(d); } catch (e) { /* view only */ } });
      bridge.register("mission:start", () => resetFor(getSim()));
    },
    update() {
      const sim = getSim();
      if (!sim || !sim.state) return;
      if (sim !== simRef || sim.colliders !== marksSrc) resetFor(sim);
      const t = sim.state.time;
      const it = queue.pull(t);
      if (it) say(sim, it);
      // fade + retire strip rows
      for (let i = lines.length - 1; i >= 0; i--) {
        const age = t - lines[i].t;
        if (age > CALLOUT.LINE_S || age < 0) { lines[i].el.remove(); lines.splice(i, 1); }
        else if (age > CALLOUT.LINE_S - 1.2) lines[i].el.style.opacity = "0";
      }
    },
    log,
    stats() { return Object.assign({ queue: Object.assign({}, queue.stats), pending: queue.length, landmarks: marks.length }, stats); },
    _strip: strip,
  };
  return api;
}
