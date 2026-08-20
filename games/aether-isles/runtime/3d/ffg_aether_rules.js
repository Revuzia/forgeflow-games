/**
 * FFG — Aether Isles RULES CORE (pure logic, no THREE, no DOM).
 * Hex resource/build game (Catan-reimagined): flat-top hex board on axial coords, a
 * geometric vertex/edge graph (settlements sit on vertices, roads on edges), the no-adjacent
 * settlement distance rule, dice production, and a seeded balanced board generator. Framework
 * free so it is unit-testable in Node and reused by the renderer, AI, and MP determinism.
 *
 * MILESTONE M1-b: board gen + graph + adjacency + distance rule + production lookup.
 * Building costs / trading / longest-road / Storm Spirit are M2.
 */
export const RESOURCES = ["lumber", "ore", "grain", "wool", "brick"]; // producing
export const WILD = "aether";                                          // desert-equivalent (no yield)

// mulberry32 seeded PRNG (shared convention with Elysium for MP determinism)
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

const SQRT3 = Math.sqrt(3);
export const HEX = 1;                       // unit hex; renderer scales
const RK = (x, z) => (Math.round(x * 100) / 100) + "|" + (Math.round(z * 100) / 100); // vertex de-dup key

// flat-top hex center for axial (q,r)
function hexCenter(q, r) { return [HEX * 1.5 * q, HEX * SQRT3 * (r + q / 2)]; }
// 6 corners of a flat-top hex, clockwise from angle 0
function corners(cx, cz) {
  const out = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; out.push([cx + HEX * Math.cos(a), cz + HEX * Math.sin(a)]); }
  return out;
}

// Axial ring of radius R -> list of {q,r}
export function hexCoords(R) {
  const out = [];
  for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) out.push({ q, r });
  return out;
}

// Standard Catan-style token multiset for 18 producing hexes (2..12, no 7). Pip weight favors 6/8.
const TOKENS18 = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
export function pips(n) { return n === 7 ? 0 : 6 - Math.abs(7 - n); }

/**
 * Generate a balanced board from a seed. 19 hexes (radius 2): 1 wild (aether) + 18 producing,
 * resources spread evenly, tokens dealt to producing hexes. Returns { hexes, vertices, edges }.
 * hexes[i] = { q,r, cx,cz, res, token, corners:[vId..] }.
 */
export function makeBoard(seed) {
  const rng = makeRng((seed >>> 0) || 1);
  const coords = hexCoords(2);                      // 19
  // resource bag: 1 wild + spread 18 producing across the 5 resources (Catan-ish 4/4/4/3/3)
  const counts = [4, 4, 4, 3, 3];
  let bag = [WILD];
  RESOURCES.forEach((res, i) => { for (let k = 0; k < counts[i]; k++) bag.push(res); });
  bag = shuffle(bag, rng);
  const tokens = shuffle(TOKENS18, rng);

  const vmap = new Map();                            // RK -> {id,x,z,hexes:[],adj:Set}
  const vertOf = (x, z) => { const k = RK(x, z); let v = vmap.get(k); if (!v) { v = { id: vmap.size, x, z, hexes: [], adj: new Set() }; vmap.set(k, v); } return v; };
  const edgeSet = new Map();                         // "a-b"(sorted) -> {a,b}

  const hexes = coords.map((c, i) => {
    const [cx, cz] = hexCenter(c.q, c.r);
    const res = bag[i];
    const cs = corners(cx, cz).map(([x, z]) => vertOf(x, z));
    // corner-hex adjacency + vertex-vertex adjacency along hex edges
    for (let e = 0; e < 6; e++) {
      const a = cs[e], b = cs[(e + 1) % 6];
      a.hexes.indexOf(i) < 0 && a.hexes.push(i);
      a.adj.add(b.id); b.adj.add(a.id);
      const ek = a.id < b.id ? a.id + "-" + b.id : b.id + "-" + a.id;
      if (!edgeSet.has(ek)) edgeSet.set(ek, { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id) });
    }
    return { q: c.q, r: c.r, cx, cz, res, token: 0, corners: cs.map(v => v.id) };
  });
  // deal tokens to producing hexes (skip wild)
  let ti = 0;
  for (const h of hexes) if (h.res !== WILD) h.token = tokens[ti++];

  const vertices = [...vmap.values()].map(v => ({ id: v.id, x: v.x, z: v.z, hexes: v.hexes.slice(), adj: [...v.adj] }));
  const edges = [...edgeSet.values()];
  return { hexes, vertices, edges };
}

// Distance rule: a settlement may go on vertex v only if v and all its adjacent vertices are empty.
export function canSettle(board, buildings, vId) {
  if (buildings[vId]) return false;
  const v = board.vertices[vId];
  for (const a of v.adj) if (buildings[a]) return false;
  return true;
}

// Production on a dice roll: returns [{ seat, res, amount }]. buildings[vId] = { seat, kind:'settlement'|'city' }.
// stormHex = index of a hex blocked by the Storm Spirit (no production), or -1.
export function produce(board, buildings, roll, stormHex = -1) {
  const out = [];
  board.hexes.forEach((h, hi) => {
    if (h.res === WILD || h.token !== roll || hi === stormHex) return;
    for (const vId of h.corners) {
      const b = buildings[vId];
      if (!b) continue;
      out.push({ seat: b.seat, res: h.res, amount: b.kind === "city" ? 2 : 1 });
    }
  });
  return out;
}

// A road may go on an edge only if it connects to the player's own network (settlement/road) —
// simplified for the initial-placement slice: any empty edge touching one of the player's vertices.
export function canRoad(board, buildings, roads, edge, seat, myVertices) {
  const ek = edge.a + "-" + edge.b;
  if (roads[ek] !== undefined) return false;   // presence check — seat 0 is falsy, so never use truthiness on road ownership
  return myVertices.has(edge.a) || myVertices.has(edge.b);
}

/* ============================ BUILDING + VICTORY (M2) ============================ */
export const COSTS = {
  road: { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, grain: 1, wool: 1 },
  city: { grain: 2, ore: 3 },   // upgrade an existing settlement
};
export function canAfford(res, kind) { const c = COSTS[kind]; return Object.keys(c).every((k) => (res[k] || 0) >= c[k]); }
export function pay(res, kind) { const c = COSTS[kind]; for (const k in c) res[k] -= c[k]; }

// Victory points for a seat: settlement 1, city 2.
export function vpFor(buildings, seat) { let v = 0; for (const id in buildings) if (buildings[id].seat === seat) v += buildings[id].kind === "city" ? 2 : 1; return v; }

// Vertices a seat's road network reaches (for connectivity of play-phase settlements/roads).
export function roadNetwork(roads, seat) {
  const verts = new Set();
  for (const ek in roads) { if (roads[ek] !== seat) continue; const p = ek.split("-"); verts.add(+p[0]); verts.add(+p[1]); }
  return verts;
}

// A play-phase settlement needs the distance rule AND a touching own-road (network connectivity).
export function canBuildSettlement(board, buildings, roads, vId, seat) {
  if (!canSettle(board, buildings, vId)) return false;
  return roadNetwork(roads, seat).has(vId);
}
// Upgrade: a settlement the seat owns.
export function canBuildCity(buildings, vId, seat) { const b = buildings[vId]; return !!b && b.seat === seat && b.kind === "settlement"; }

/* ============================ AETHER RELICS (development cards) ============================
 * Catan-style dev cards ("Relics"), TUNED FOR THIS GAME'S 8-VP WIN (Catan is 10). Per the
 * design's own adversarial critique, the 5-hidden-VP Crown deck is a runaway-leader defect at
 * 8 VP, so the deck is rescaled: sigil (hidden VP) cut to 2 (max +2 hidden), Storm Warden (+2)
 * is earned through VISIBLE stormWard plays. Max relic VP = 4 of 8; buildings still dominate.
 * All randomness routes through makeRng and is carried in mv.rng so ffg_seatplay MP stays in
 * lockstep (the steal uses an ISOLATED stream so it never advances the shared dice rng). */
export const RELIC_BAG = [
  ...Array(10).fill("stormWard"),   // Knight — move Storm Spirit + steal
  ...Array(2).fill("sigil"),        // hidden Victory Point (+1)
  ...Array(3).fill("leyLine"),      // Road Building — 2 free roads
  ...Array(3).fill("bounty"),       // Year of Plenty — take any 2
  ...Array(2).fill("levy"),         // Monopoly — name a resource
];                                  // 20 cards
export const RELIC_SALT = 0x5EEDA37E;
export const RELIC_TYPES = ["stormWard", "sigil", "leyLine", "bounty", "levy"];
export const STORM_WARDEN_MIN = 3, STORM_WARDEN_VP = 2;
COSTS.relic = { ore: 1, grain: 1, wool: 1 };   // extends COSTS; canAfford/pay are generic over it

// Deterministic, seed-derived deck on a distinct sub-stream (so board layout & deck order don't correlate).
export function makeRelicDeck(seed) { const rng = makeRng((((seed >>> 0) ^ RELIC_SALT) >>> 0) || 1); return shuffle(RELIC_BAG, rng); }
export function emptyRelicPlayed() { return { stormWard: 0, sigil: 0, leyLine: 0, bounty: 0, levy: 0 }; }

// May this seat ACTIVELY play this card right now? sigil is passive; can't play the turn bought; one/turn.
// `rolled=false` is the pre-roll window — only stormWard is playable pre-roll (Catan-faithful for the Knight).
export function canPlayRelic(state, seat, card, rolled) {
  if (!card || card.type === "sigil") return false;
  if (card.boughtTurn >= state.turn) return false;                 // bought this turn -> locked
  if (state.relicPlayedTurn[seat] === state.turn) return false;    // one relic per turn
  if (!rolled && card.type !== "stormWard") return false;
  return true;
}

// The stolen resource, drawn from an ISOLATED per-move stream that never touches the shared dice rng
// (critique #4: reusing the dice stream desyncs every later roll). Returns { stolen: resKey|null }.
export function rollSteal(state, victimSeat, seed, turn, idx) {
  const pool = [], vr = state.res[victimSeat] || {};
  for (const r of RESOURCES) for (let i = 0; i < (vr[r] || 0); i++) pool.push(r);
  if (!pool.length) return { stolen: null };
  const rng = makeRng((((seed >>> 0) ^ RELIC_SALT ^ (((turn | 0) * 2654435761) >>> 0) ^ (((idx | 0) * 40503) >>> 0)) >>> 0) || 1);
  return { stolen: pool[(rng() * pool.length) | 0] };
}

// Knight: move the Storm Spirit to a chosen hex, steal 1 (carried in rng.stolen). choices:{toHex,victimSeat}.
export function playStormWard(state, seat, choices, rng) {
  state.stormHex = choices.toHex;
  const v = choices.victimSeat;
  if (v >= 0 && v !== seat && rng && rng.stolen) {
    const k = rng.stolen, had = (state.res[v][k] || 0) > 0;       // only move a card the victim actually holds (critique #7 — no phantom mint)
    if (had) { state.res[v][k] -= 1; state.res[seat][k] = (state.res[seat][k] || 0) + 1; }
  }
  state.relicPlayed[seat].stormWard += 1;
  updateStormWarden(state);
}
// Road Building: place up to 2 free roads; connectivity still enforced via canRoad/roadNetwork. Returns # placed.
export function playLeyLine(state, board, buildings, seat, choices) {
  const myV = roadNetwork(state.roads, seat);
  for (const vId in buildings) if (buildings[vId].seat === seat) myV.add(+vId);   // seed with own settled vertices so road 1 can attach
  let placed = 0;
  for (const e of (choices.edges || []).slice(0, 2)) {
    if (!canRoad(board, buildings, state.roads, e, seat, myV)) continue;          // skip illegal, no cost
    state.roads[e.a + "-" + e.b] = seat; myV.add(e.a); myV.add(e.b); placed++;    // presence check inside canRoad handles seat 0
  }
  state.relicPlayed[seat].leyLine += 1;
  return placed;
}
// Year of Plenty: gain any 2 resource units from the bank. choices:{picks:[r,r]}.
export function playBounty(state, seat, choices) {
  for (const r of (choices.picks || []).slice(0, 2)) if (RESOURCES.includes(r)) state.res[seat][r] = (state.res[seat][r] || 0) + 1;
  state.relicPlayed[seat].bounty += 1;
}
// Monopoly: name a resource; every other seat hands you all of it. choices:{res}. Returns # taken.
export function playLevy(state, seat, choices) {
  const r = choices.res; if (!RESOURCES.includes(r)) return 0;
  let taken = 0;
  for (const s in state.res) { const o = +s; if (o === seat) continue; const amt = state.res[o][r] || 0; state.res[seat][r] = (state.res[seat][r] || 0) + amt; state.res[o][r] = 0; taken += amt; }
  state.relicPlayed[seat].levy += 1;
  return taken;
}
// Largest-Army equivalent: +2 VP to the first seat with 3 stormWard plays; moves only on a STRICT lead (ties keep).
export function updateStormWarden(state) {
  const cur = state.stormWardenSeat, curCount = cur >= 0 ? state.relicPlayed[cur].stormWard : 0;
  let bestSeat = cur, bestCount = curCount;
  for (const s in state.relicPlayed) { const seat = +s, n = state.relicPlayed[seat].stormWard; if (n < STORM_WARDEN_MIN) continue; if (n > bestCount) { bestCount = n; bestSeat = seat; } }
  state.stormWardenSeat = (bestCount >= STORM_WARDEN_MIN) ? bestSeat : -1;
  return state.stormWardenSeat;
}
// Total VP = buildings (existing vpFor) + hidden sigils + Storm Warden bonus. Win check uses THIS.
export function totalVpFor(state, buildings, seat) {
  return vpFor(buildings, seat)
    + (state.relicPlayed[seat] ? state.relicPlayed[seat].sigil : 0)
    + (state.stormWardenSeat === seat ? STORM_WARDEN_VP : 0);
}

/* ============================ SKYPORTS + BANK TRADE ============================
 * Catan's harbours, reimagined as SKYPORTS on the rim of the isle cluster.
 * Canonical rules this follows:
 *   - Default bank trade is 4:1 — four identical resources for one of your choice.
 *   - 9 ports ring the coast: 4 generic "any 3:1", plus 5 specialist 2:1 ports,
 *     one for each resource (lumber, ore, grain, wool, brick).
 *   - A port is only usable by a player who owns a settlement/city on one of the
 *     two rim vertices that port sits on. Best available rate wins.
 * A vertex is COASTAL when it touches fewer than 3 hexes (interior corners touch 3).
 */
export const BANK_RATE = 4;
export const PORT_BAG = ["any", "any", "any", "any", "lumber", "ore", "grain", "wool", "brick"];
export const PORT_SALT = 0x504F5254;   // "PORT" — its own rng sub-stream
export function portRatio(type) { return type === "any" ? 3 : 2; }

/** Coastal vertex ids (rim of the cluster), ordered clockwise around the centre. */
export function coastalVertices(board) {
  const rim = board.vertices.filter((v) => v.hexes.length < 3);
  return rim.slice().sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)).map((v) => v.id);
}

/**
 * Deterministically place the 9 skyports around the rim. Each port occupies a pair of
 * ADJACENT coastal vertices, and pairs are spread evenly so ports never touch.
 * Returns [{ id, type, ratio, vertices:[a,b] }].
 */
export function makePorts(board, seed) {
  const rng = makeRng((((seed >>> 0) ^ PORT_SALT) >>> 0) || 1);
  const rim = coastalVertices(board);
  const bag = shuffle(PORT_BAG, rng);
  const out = [];
  if (rim.length < bag.length * 2) return out;             // tiny board -> no ports
  const step = rim.length / bag.length;                     // even spacing around the rim
  for (let i = 0; i < bag.length; i++) {
    const a = rim[Math.floor(i * step) % rim.length];
    const b = rim[(Math.floor(i * step) + 1) % rim.length];
    if (a === b) continue;
    out.push({ id: i, type: bag[i], ratio: portRatio(bag[i]), vertices: [a, b] });
  }
  return out;
}

/** Ports this seat can actually use (owns a building on one of the port's vertices). */
export function portsFor(ports, buildings, seat) {
  return (ports || []).filter((p) => p.vertices.some((v) => buildings[v] && buildings[v].seat === seat));
}

/** Best trade-in rate this seat gets for GIVING `res`: 2 (specialist), 3 (any-port), else 4. */
export function tradeRate(ports, buildings, seat, res) {
  let rate = BANK_RATE;
  for (const p of portsFor(ports, buildings, seat)) {
    if (p.type === res) rate = Math.min(rate, 2);
    else if (p.type === "any") rate = Math.min(rate, 3);
  }
  return rate;
}

/** May this seat trade `give` -> `get` right now? */
export function canBankTrade(res, ports, buildings, seat, give, get) {
  if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) return false;
  return (res[give] || 0) >= tradeRate(ports, buildings, seat, give);
}

/** Apply the trade. Returns the rate paid, or 0 if it was illegal. */
export function doBankTrade(res, ports, buildings, seat, give, get) {
  if (!canBankTrade(res, ports, buildings, seat, give, get)) return 0;
  const rate = tradeRate(ports, buildings, seat, give);
  res[give] -= rate; res[get] = (res[get] || 0) + 1;
  return rate;
}

/* ============================ PLAYER-TO-PLAYER TRADING ============================
 * A trade is: proposer GIVES `give` and WANTS `want` (both {res:count} maps).
 * Pure + side-effect-free until applyTrade, so the AI can score a deal before taking it.
 */
export function bagTotal(bag) { let n = 0; for (const k in bag) n += bag[k] | 0; return n; }
export function holds(resSeat, bag) { for (const k in bag) if ((resSeat[k] || 0) < bag[k]) return false; return true; }
/** Legal offer: proposer owns what they're giving, both sides non-empty, no overlap. */
export function canOfferTrade(res, seat, give, want) {
  if (!res[seat] || bagTotal(give) < 1 || bagTotal(want) < 1) return false;
  for (const k in give) if (want[k]) return false;              // don't trade a resource for itself
  return holds(res[seat], give);
}
/** The responder must actually hold everything the proposer wants. */
export function canAcceptTrade(res, seat, want) { return !!res[seat] && holds(res[seat], want); }
/** Move the goods. `from` gives `give` and receives `want` from `to`. */
export function applyTrade(res, from, to, give, want) {
  for (const k in give) { res[from][k] -= give[k]; res[to][k] = (res[to][k] || 0) + give[k]; }
  for (const k in want) { res[to][k] -= want[k]; res[from][k] = (res[from][k] || 0) + want[k]; }
}

/* ---- AI trade intelligence -------------------------------------------------------
 * The AI scores an offer on three axes and refuses deals that mostly help a rival:
 *   gain  — how much the incoming goods close ITS OWN nearest build gap
 *   cost  — what giving the goods away costs it (worse if it breaks an affordable build)
 *   help  — how much the deal advances the PROPOSER (inferred from what they receive),
 *           weighted harder when that rival is the VP leader or near the win.
 * Difficulty sets how strategic it is: gentle barely models the rival, fierce fully does.
 */
export const TRADE_PERSONA = {
  gentle:   { help: 0.15, greed: 0.55, leaderFear: 0.2, minScore: -0.6 },   // trades freely, rarely suspicious
  balanced: { help: 0.60, greed: 0.90, leaderFear: 1.0, minScore: 0.0 },
  fierce:   { help: 1.15, greed: 1.15, leaderFear: 1.8, minScore: 0.25 },   // hard-nosed; won't feed a leader
};
/** The cheapest build this seat is closest to, plus what it still lacks. */
export function nearestGoal(resSeat, kinds = ["city", "settlement", "road", "relic"]) {
  let best = null;
  for (const kind of kinds) {
    const c = COSTS[kind]; if (!c) continue;
    let missing = 0, need = {};
    for (const k in c) { const short = Math.max(0, c[k] - (resSeat[k] || 0)); if (short) { missing += short; need[k] = short; } }
    const worth = kind === "city" ? 2 : kind === "settlement" ? 1 : kind === "relic" ? 0.9 : 0.35;
    const score = worth / (1 + missing);
    if (!best || score > best.score) best = { kind, missing, need, worth, score };
  }
  return best;
}
/** How much does receiving `bag` close this seat's nearest gap? 0..1-ish per unit. */
export function gapClosed(resSeat, bag) {
  const before = nearestGoal(resSeat);
  const after = { ...resSeat };
  for (const k in bag) after[k] = (after[k] || 0) + bag[k];
  const g2 = nearestGoal(after);
  let v = (g2.score - before.score) * 3;
  for (const k in bag) if (before.need && before.need[k]) v += 0.5 * Math.min(bag[k], before.need[k]);  // exactly what it lacked
  return v;
}
/**
 * Score an offer from the AI's seat. `give` = what the proposer hands the AI,
 * `want` = what the AI must hand back. Returns { accept, score, reason }.
 */
export function evaluateTrade(state, buildings, aiSeat, proposerSeat, give, want, difficulty = "balanced") {
  const P = TRADE_PERSONA[difficulty] || TRADE_PERSONA.balanced;
  const res = state.res;
  if (!canAcceptTrade(res, aiSeat, want)) return { accept: false, score: -99, reason: "I don't have that to spare." };
  const gain = gapClosed(res[aiSeat], give);
  const afterGive = { ...res[aiSeat] };
  for (const k in want) afterGive[k] = (afterGive[k] || 0) - want[k];
  const cost = Math.max(0, nearestGoal(res[aiSeat]).score - nearestGoal(afterGive).score) * 3 + bagTotal(want) * 0.12;
  // what the rival gets out of it (they receive `want`)
  const help = gapClosed(res[proposerSeat] || {}, want);
  const myVp = vpFor(buildings, aiSeat), theirVp = vpFor(buildings, proposerSeat);
  const leading = Math.max(0, theirVp - myVp);
  const fear = 1 + P.leaderFear * leading * 0.35;
  const score = gain * P.greed - cost - help * P.help * fear;
  const accept = score >= P.minScore;
  let reason;
  if (accept) reason = gain > 1 ? "That's exactly what I need — deal." : "Fine, I can work with that.";
  else if (help * P.help * fear > gain) reason = leading > 0 ? "You're already ahead. No deal." : "That helps you more than me.";
  else if (cost > gain) reason = "I need those myself.";
  else reason = "Not worth it to me.";
  return { accept, score: +score.toFixed(3), reason };
}
/** The AI's own best ask: what it most needs, and the spare it can most afford to give. */
export function aiTradeWish(resSeat) {
  const goal = nearestGoal(resSeat);
  const need = goal && goal.need ? Object.keys(goal.need)[0] : null;
  let spare = null, most = 1;
  for (const r of RESOURCES) {
    const have = resSeat[r] || 0;
    if (r === need) continue;
    if (have > most && (!goal.need || !goal.need[r])) { most = have; spare = r; }
  }
  return need && spare ? { want: { [need]: 1 }, give: { [spare]: 1 } } : null;
}
