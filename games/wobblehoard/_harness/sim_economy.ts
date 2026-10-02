// WOBBLEHOARD economy Monte-Carlo. Plain node (type stripping):  node _harness/sim_economy.ts [--quick] [--n 5000] [--days 60]
//
// It answers the questions _spec/DESIGN.md section 5 makes claims about:
//   * how many days a player needs to fill a 12-species shelf alone vs with trading
//   * what fraction of capsule drops are duplicates (the trade fuel), week by week
//   * whether the blend sink (plus the hoard cap) keeps item supply from inflating
//   * whether playstyle affinity really creates complementary gaps between players of different styles
//   * what a trade lock costs honest players, and what it does and does not stop in an exploit ring
//
// EVERYTHING here is a model with guessed behaviour (how long people play, how many friends they have, how willing they are to
// trade). The economy rules (earn rates, odds, caps) are the proposals under test; the behaviour is an assumption and is
// flagged as such in DESIGN.md section 5.8. Deterministic: same args => same output. No Math.random(), no Date.now().
// Only repo import: the seeded PRNG from src/core/rng.ts.
import { mulberry32 } from '../src/core/rng.ts';

/* ───────────────────────────── world constants (the proposed shelf) ───────────────────────────── */

const NS = 12;                                   // species on the launch shelf
const groupOf = (s: number): number => s >> 2;   // 0 = bounce (poke), 1 = plush (squeeze), 2 = stretch (pull); 4 species each
const slotOf = (s: number): number => s & 3;     // 0,1 = common, 2 = uncommon, 3 = heirloom (rare)
const tierOf = (s: number): number => (slotOf(s) === 3 ? 2 : slotOf(s) === 2 ? 1 : 0);
const BASE_W = [1.0, 1.0, 0.6, 0.15];            // base capsule weight by slot (before affinity)
const TIER_NAMES = ['casual', 'regular', 'devoted'];
const ARCHE_NAMES = ['poker', 'squeezer', 'puller', 'mixed'];
const JOURNAL_PAIRS = NS + (NS * (NS - 1)) / 2;  // 78 distinct (primary, secondary) blend lineages

interface Params {
  nPlayers: number;
  days: number;
  seed: number;
  // earning (the Squish meter)
  spPerMin: number;        // squish points per minute of play, deliberately equal for every style
  capsuleCost: number;     // SP per capsule
  softCap: number;         // SP/day paid at full rate
  overRate: number;        // rate above the soft cap
  welcomeCapsules: number; // day-0 onboarding capsules (neutral odds)
  // odds + affinity
  beta: number;            // affinity sharpness: style factor = exp(beta * recent share of that style). 0 = affinity off
  lambda: number;          // EMA step per active day for the style profile (0.12 ~ 5-day half-life)
  shieldAt: number;        // dupe shield: if the roll is a species you hold >= shieldAt copies of, roll once more (0 = off)
  // daily restock
  restock: boolean;
  restockOffered: number;
  restockUncommonW: number;
  // tasks
  tasksOffered: number;
  taskFocus: number;       // how far a task capsule is bent towards the task's style (0..1)
  taskWeeklyMax: number;
  // hoard + blend
  hoardCap: number;
  blendEnabled: boolean;
  // trade
  trade: boolean;
  lockDays: number;        // received items cannot be traded or blended for this many days
  dailyTradeCap: number;
  maxSwapsPerTrade: number;
  boardSample: number;     // how many board listings a player looks at per day
  acceptProb: number;      // friction: chance a feasible swap actually happens that day
  // population (BEHAVIOUR ASSUMPTIONS)
  archeShare: [number, number, number, number]; // poker, squeezer, puller, mixed
  tierShare: [number, number, number];          // casual, regular, devoted
  pActive: [number, number, number];            // chance of playing on a given day
  minutes: [number, number, number];            // median minutes on an active day
  churn: [number, number, number];              // daily hazard of leaving for good
  traderProb: [number, number, number];         // share willing to trade at all
  boardProb: number;                            // of traders: share who use the public board (rest = friends only)
  friendHomophily: number;                      // chance a friend has the same archetype
  adaptiveShare: number;                        // share of players who deliberately rotate styles to fill gaps
  snapshotDays: number[];
}

const DEFAULTS: Params = {
  nPlayers: 5000, days: 60, seed: 0x5eed1234,
  spPerMin: 20, capsuleCost: 100, softCap: 400, overRate: 0.25, welcomeCapsules: 2,
  beta: 3.2, lambda: 0.12, shieldAt: 0,
  restock: true, restockOffered: 3, restockUncommonW: 0.5,
  tasksOffered: 2, taskFocus: 0.35, taskWeeklyMax: 5,
  hoardCap: 60, blendEnabled: true,
  trade: false, lockDays: 1, dailyTradeCap: 3, maxSwapsPerTrade: 3, boardSample: 25, acceptProb: 0.85,
  archeShare: [0.38, 0.27, 0.15, 0.20],
  tierShare: [0.40, 0.40, 0.20],
  pActive: [0.35, 0.65, 0.90],
  minutes: [3, 6, 11],
  churn: [0.015, 0.007, 0.003],
  traderProb: [0.30, 0.55, 0.75], boardProb: 0.7, friendHomophily: 0.5,
  adaptiveShare: 0,
  snapshotDays: [14, 30],
};

/* ───────────────────────────── small helpers ───────────────────────────── */

type Rng = () => number;
const gauss = (r: Rng): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const pickIdx = (w: ArrayLike<number>, tot: number, r: Rng): number => {
  let x = r() * tot;
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; }
  return w.length - 1;
};
const median = (a: number[]): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a: number[], q: number): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '  -');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '  -');
const pc = (x: number): string => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '  -');
const pc0 = (x: number): string => (Number.isFinite(x) ? Math.round(x * 100) + '%' : '-');
const pad = (s: string | number, n: number): string => String(s).padStart(n);
const lpad = (s: string | number, n: number): string => String(s).padEnd(n);

/* ───────────────────────────── population ───────────────────────────── */

interface Pop {
  n: number;
  arche: Uint8Array;       // 0 poker 1 squeezer 2 puller 3 mixed
  tier: Uint8Array;        // 0 casual 1 regular 2 devoted
  trader: Uint8Array;
  usesBoard: Uint8Array;
  adaptive: Uint8Array;
  blendLove: Float32Array; // chance per active day of blending on purpose
  friends: number[][];
}

function makePop(P: Params): Pop {
  const r = mulberry32(P.seed ^ 0x9e3779b9);
  const n = P.nPlayers;
  const pop: Pop = {
    n, arche: new Uint8Array(n), tier: new Uint8Array(n), trader: new Uint8Array(n), usesBoard: new Uint8Array(n),
    adaptive: new Uint8Array(n), blendLove: new Float32Array(n), friends: Array.from({ length: n }, () => []),
  };
  const byArche: number[][] = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    pop.arche[i] = pickIdx(P.archeShare, 1, r);
    pop.tier[i] = pickIdx(P.tierShare, 1, r);
    pop.trader[i] = r() < P.traderProb[pop.tier[i]] ? 1 : 0;
    pop.usesBoard[i] = pop.trader[i] && r() < P.boardProb ? 1 : 0;
    pop.adaptive[i] = r() < P.adaptiveShare ? 1 : 0;
    const u = r();
    pop.blendLove[i] = u < 0.2 ? 0 : u < 0.7 ? 0.08 : 0.3;
    byArche[pop.arche[i]].push(i);
  }
  for (let i = 0; i < n; i++) {
    const u = r();
    const f = u < 0.35 ? 0 : u < 0.65 ? 1 + Math.floor(r() * 2) : u < 0.9 ? 3 + Math.floor(r() * 3) : 6 + Math.floor(r() * 5);
    for (let k = 0; k < f; k++) {
      let j: number;
      if (r() < P.friendHomophily) { const pool = byArche[pop.arche[i]]; j = pool[Math.floor(r() * pool.length)]; }
      else j = Math.floor(r() * n);
      if (j === i || pop.friends[i].includes(j)) continue;
      pop.friends[i].push(j); pop.friends[j].push(i);
    }
  }
  return pop;
}

/* ───────────────────────────── players ───────────────────────────── */

const ARCHE_MIX: number[][] = [
  [0.70, 0.18, 0.12],   // poker
  [0.14, 0.72, 0.14],   // squeezer
  [0.12, 0.18, 0.70],   // puller
  [1 / 3, 1 / 3, 1 / 3] // mixed
];

interface Player {
  id: number; rng: Rng; arche: number; tier: number; alive: boolean; trader: boolean; usesBoard: boolean; adaptive: boolean;
  blendLove: number;
  aff: number[];                 // recent share of SP by style (EMA)
  meter: number;
  count: Uint16Array;            // copies held per species
  lockedCopies: Uint16Array;     // of those, how many were received recently
  lockUntil: Int16Array;         // day the received copies unlock (conservative: extended by each new receipt)
  firstDay: Int16Array;          // day each species was first obtained (-1 = never)
  viaTrade: Uint8Array;          // species first obtained by trade
  hybrids: number; pairsSeen: Set<number>;
  owned: number; ownedCore: number;
  fullDay: number; coreDay: number; finalViaTrade: boolean;
  activeDays: number; lastDayAlive: number;
  trades: number; tradesToday: number; tradeDay: number;
  blends: number; blendParents: number;
  capsules: number; dupCapsules: number;
  taskWeek: number; taskDone: number;
  weekItems: number;
}

function makePlayers(P: Params, pop: Pop): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < pop.n; i++) {
    const p: Player = {
      id: i, rng: mulberry32((P.seed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0), arche: pop.arche[i], tier: pop.tier[i], alive: true,
      trader: pop.trader[i] === 1, usesBoard: pop.usesBoard[i] === 1, adaptive: pop.adaptive[i] === 1, blendLove: pop.blendLove[i],
      aff: [1 / 3, 1 / 3, 1 / 3], meter: 0,
      count: new Uint16Array(NS), lockedCopies: new Uint16Array(NS), lockUntil: new Int16Array(NS), firstDay: new Int16Array(NS).fill(-1),
      viaTrade: new Uint8Array(NS), hybrids: 0, pairsSeen: new Set<number>(), owned: 0, ownedCore: 0,
      fullDay: -1, coreDay: -1, finalViaTrade: false, activeDays: 0, lastDayAlive: -1,
      trades: 0, tradesToday: 0, tradeDay: -1, blends: 0, blendParents: 0, capsules: 0, dupCapsules: 0, taskWeek: -1, taskDone: 0, weekItems: 0,
    };
    out.push(p);
  }
  return out;
}

const total = (p: Player): number => { let t = p.hybrids; for (let s = 0; s < NS; s++) t += p.count[s]; return t; };
const lockedNow = (p: Player, s: number, day: number): number => (p.lockedCopies[s] > 0 && day < p.lockUntil[s] ? p.lockedCopies[s] : 0);
/** spare copies you may trade or blend today: keep one unlocked copy on the shelf, locked copies cannot move. */
const spareOf = (p: Player, s: number, day: number): number => Math.max(0, p.count[s] - lockedNow(p, s, day) - 1);

interface Weekly {
  src: number[]; sinkBlend: number[]; sinkRelease: number[]; capsules: number[]; dupCapsules: number[];
  acq: number[]; dupAcq: number[]; hoardSum: number[]; hoardN: number[]; atCap: number[]; ownedSum: number[];
  blends: number[]; trades: number[];
}
const mkWeekly = (weeks: number): Weekly => {
  const z = (): number[] => new Array(weeks).fill(0);
  return { src: z(), sinkBlend: z(), sinkRelease: z(), capsules: z(), dupCapsules: z(), acq: z(), dupAcq: z(), hoardSum: z(), hoardN: z(), atCap: z(), ownedSum: z(), blends: z(), trades: z() };
};

interface Snapshot { day: number; pairs: Record<string, [number, number]>; } // class -> [feasible, sampled]

interface Result { P: Params; players: Player[]; weekly: Weekly; snaps: Snapshot[]; label: string; }

/* ───────────────────────────── the loop ───────────────────────────── */

const W = new Float64Array(NS);

function rollSpecies(p: Player, a: number[], P: Params): number {
  const f0 = Math.exp(P.beta * a[0]), f1_ = Math.exp(P.beta * a[1]), f2_ = Math.exp(P.beta * a[2]);
  let tot = 0;
  for (let s = 0; s < NS; s++) { const g = groupOf(s); W[s] = BASE_W[slotOf(s)] * (g === 0 ? f0 : g === 1 ? f1_ : f2_); tot += W[s]; }
  let s = pickIdx(W, tot, p.rng);
  if (P.shieldAt > 0 && p.count[s] >= P.shieldAt) s = pickIdx(W, tot, p.rng);
  return s;
}

function runScenario(P: Params, pop: Pop, label: string): Result {
  const players = makePlayers(P, pop);
  const weeks = Math.ceil(P.days / 7);
  const wk = mkWeekly(weeks);
  const snaps: Snapshot[] = [];
  const sys = mulberry32(P.seed ^ 0xabcdef01);

  const onOwnedChange = (p: Player, s: number, day: number, viaTrade: boolean): void => {
    p.owned++; p.firstDay[s] = day; p.viaTrade[s] = viaTrade ? 1 : 0;
    if (tierOf(s) < 2) p.ownedCore++;
    if (p.ownedCore === 9 && p.coreDay < 0) p.coreDay = day + 1;
    if (p.owned === NS && p.fullDay < 0) { p.fullDay = day + 1; p.finalViaTrade = viaTrade; }
  };

  const release = (p: Player, w: number): boolean => {
    let best = -1, bestSp = 0;
    for (let s = 0; s < NS; s++) { const sp = p.count[s] - 1; if (sp > bestSp && tierOf(s) < 2) { best = s; bestSp = sp; } }
    if (best < 0) return false;
    p.count[best]--; wk.sinkRelease[w]++; return true;
  };

  const tryBlend = (p: Player, day: number, forced: boolean): boolean => {
    const w = Math.min(weeks - 1, Math.floor(day / 7));
    const cand: number[] = [];
    for (let t = 0; t <= 2; t++) {
      if (t === 2 && !forced && p.trader) continue; // keep heirloom spares as trade stock
      for (let s = 0; s < NS; s++) if (tierOf(s) === t) for (let k = spareOf(p, s, day); k > 0; k--) cand.push(s);
    }
    if (cand.length < 2) return false;
    const u = p.rng();
    let n = u < 0.45 ? 2 : u < 0.70 ? 3 : u < 0.85 ? 4 : u < 0.93 ? 5 : 6;
    if (forced) n = Math.max(n, 3);
    n = Math.min(n, cand.length);
    // prefer a lineage the journal has not seen yet
    let parents: number[] | null = null;
    const distinct = [...new Set(cand)];
    outer: for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
      const a = distinct[i], b = distinct[j];
      if (!p.pairsSeen.has(Math.min(a, b) * NS + Math.max(a, b))) { parents = [a, b]; break outer; }
    }
    if (!parents) parents = cand.slice(0, 2);
    const used = parents.slice();
    const pool = cand.slice();
    for (const s of parents) pool.splice(pool.indexOf(s), 1);
    while (used.length < n && pool.length) used.push(pool.shift() as number);
    for (const s of used) p.count[s]--;
    const a = used[0], b = used.length > 1 ? used[1] : used[0];
    p.pairsSeen.add(Math.min(a, b) * NS + Math.max(a, b));
    p.hybrids++; p.blends++; p.blendParents += used.length;
    // lock the fresh hybrid? hybrids are not modelled as trade stock, so the lock only matters for the parents' removal
    wk.sinkBlend[w] += used.length - 1; wk.blends[w]++;
    return true;
  };

  const makeRoom = (p: Player, day: number, w: number): void => {
    if (total(p) < P.hoardCap) return;
    if (P.blendEnabled && tryBlend(p, day, true)) return;
    release(p, w);
  };

  const acquire = (p: Player, s: number, day: number, kind: 'capsule' | 'restock', viaTrade = false): void => {
    const w = Math.min(weeks - 1, Math.floor(day / 7));
    makeRoom(p, day, w);
    const dup = p.count[s] > 0;
    p.count[s]++;
    wk.src[w]++; wk.acq[w]++; if (dup) wk.dupAcq[w]++;
    if (kind === 'capsule') { wk.capsules[w]++; p.capsules++; if (dup) { wk.dupCapsules[w]++; p.dupCapsules++; } }
    if (!dup) onOwnedChange(p, s, day, viaTrade);
  };

  const feasibleSwaps = (A: Player, B: Player, day: number, ignoreLocks: boolean, maxSwaps: number, out: number[] | null): number => {
    let swaps = 0;
    for (let t = 0; t <= 2 && swaps < maxSwaps; t++) {
      let xs = 0, ys = 0;
      const xl: number[] = [], yl: number[] = [];
      for (let s = 0; s < NS; s++) {
        if (tierOf(s) !== t) continue;
        const sa = ignoreLocks ? Math.max(0, A.count[s] - 1) : spareOf(A, s, day);
        const sb = ignoreLocks ? Math.max(0, B.count[s] - 1) : spareOf(B, s, day);
        if (sa > 0 && B.count[s] === 0) { xs++; xl.push(s); }
        if (sb > 0 && A.count[s] === 0) { ys++; yl.push(s); }
      }
      const k = Math.min(xs, ys, maxSwaps - swaps);
      for (let i = 0; i < k; i++) { swaps++; if (out) { out.push(xl[i], yl[i]); } }
    }
    return swaps;
  };

  const needsAny = (p: Player): boolean => p.owned < NS;
  const hasStock = (p: Player, day: number): boolean => { for (let s = 0; s < NS; s++) if (spareOf(p, s, day) > 0) return true; return false; };

  for (let day = 0; day < P.days; day++) {
    const w = Math.min(weeks - 1, Math.floor(day / 7));
    const active: Player[] = [];
    // ── pass 1: earn ──
    for (const p of players) {
      if (!p.alive) continue;
      if (day > 0 && p.rng() < P.churn[p.tier]) { p.alive = false; continue; }
      if (day > 0 && p.rng() >= P.pActive[p.tier]) continue;
      active.push(p); p.activeDays++; p.lastDayAlive = day;
      const rng = p.rng;
      if (day === 0) { p.count[0]++; p.owned++; p.firstDay[0] = 0; p.ownedCore++; wk.src[w]++; }
      const wkIdx = Math.floor(day / 7);
      if (p.taskWeek !== wkIdx) { p.taskWeek = wkIdx; p.taskDone = 0; }
      // today's style mix: archetype with day-to-day wobble; adaptive players chase the group they are weakest in
      const base = ARCHE_MIX[p.arche];
      const mix = [0, 0, 0];
      let ms = 0;
      for (let g = 0; g < 3; g++) { mix[g] = base[g] * Math.exp(0.35 * gauss(rng)); ms += mix[g]; }
      for (let g = 0; g < 3; g++) mix[g] /= ms;
      if (p.adaptive && p.owned >= 4 && rng() < 0.7) {
        let worst = 0, worstCov = 9;
        for (let g = 0; g < 3; g++) {
          let c = 0; for (let k = 0; k < 4; k++) if (p.count[g * 4 + k] > 0) c++;
          c += rng() * 0.1;
          if (c < worstCov) { worstCov = c; worst = g; }
        }
        for (let g = 0; g < 3; g++) mix[g] = g === worst ? 0.8 : 0.1;
      }
      for (let g = 0; g < 3; g++) p.aff[g] = (1 - P.lambda) * p.aff[g] + P.lambda * mix[g];
      // the Squish meter
      const minutes = P.minutes[p.tier] * Math.exp(0.5 * gauss(rng) - 0.125);
      const raw = minutes * P.spPerMin;
      const sp = Math.min(raw, P.softCap) + Math.max(0, raw - P.softCap) * P.overRate;
      p.meter += sp;
      let nCaps = Math.floor(p.meter / P.capsuleCost);
      p.meter -= nCaps * P.capsuleCost;
      if (day === 0) nCaps += P.welcomeCapsules;
      for (let k = 0; k < nCaps; k++) acquire(p, rollSpecies(p, day === 0 ? [1 / 3, 1 / 3, 1 / 3] : p.aff, P), day, 'capsule');
      // daily restock: pick one of N neutral offers (commons and uncommons only)
      if (P.restock) {
        const rw = new Float64Array(NS);
        let rt = 0;
        for (let s = 0; s < NS; s++) { rw[s] = tierOf(s) === 0 ? 1 : tierOf(s) === 1 ? P.restockUncommonW : 0; rt += rw[s]; }
        const offered: number[] = [];
        for (let k = 0; k < P.restockOffered; k++) {
          const s = pickIdx(rw, rt, rng);
          offered.push(s); rt -= rw[s]; rw[s] = 0;
        }
        const fresh = offered.filter((s) => p.count[s] === 0).sort((a, b) => tierOf(b) - tierOf(a));
        acquire(p, fresh.length ? fresh[0] : offered[Math.floor(rng() * offered.length)], day, 'restock');
      }
      // tasks
      const taskP = [0.4, 0.6, 0.8][p.tier];
      let main = 0; for (let g = 1; g < 3; g++) if (p.aff[g] > p.aff[main]) main = g;
      for (let k = 0; k < P.tasksOffered; k++) {
        const t = Math.floor(rng() * 3);
        if (p.taskDone >= P.taskWeeklyMax) break;
        if (rng() < taskP * (t === main ? 1 : 0.55)) {
          p.taskDone++;
          const a2 = [0, 0, 0];
          for (let g = 0; g < 3; g++) a2[g] = (g === t ? P.taskFocus : 0) + (1 - P.taskFocus) * p.aff[g];
          acquire(p, rollSpecies(p, a2, P), day, 'capsule');
        }
      }
    }
    // ── snapshot of complementary gaps (before any trading this day) ──
    if (P.snapshotDays.includes(day + 1)) {
      const pairs: Record<string, [number, number]> = {};
      const bump = (k: string, ok: boolean): void => { const e = (pairs[k] ??= [0, 0]); e[1]++; if (ok) e[0]++; };
      const live = players.filter((p) => p.alive && p.activeDays >= 5);
      for (let i = 0; i < 20000 && live.length > 2; i++) {
        const A = live[Math.floor(sys() * live.length)], B = live[Math.floor(sys() * live.length)];
        if (A === B) continue;
        const ok = feasibleSwaps(A, B, day, true, 1, null) > 0;
        const pure = A.arche < 3 && B.arche < 3;
        bump('all pairs', ok);
        if (pure && A.arche === B.arche) bump('same style', ok);
        else if (pure) bump('different style', ok);
        else bump('involves mixed', ok);
      }
      snaps.push({ day: day + 1, pairs });
    }
    // ── pass 2: trading (each trader looks at friends + a sample of the public board) ──
    if (P.trade) {
      const board = active.filter((p) => p.trader && p.usesBoard);
      const order = active.filter((p) => p.trader);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(sys() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const todayActive = new Set<number>(active.map((p) => p.id));
      const out: number[] = [];
      for (const A of order) {
        if (A.tradeDay !== day) { A.tradeDay = day; A.tradesToday = 0; }
        if (A.tradesToday >= P.dailyTradeCap || !needsAny(A) || !hasStock(A, day)) continue;
        if (A.rng() > 0.7) continue; // does not open the trade screen every session
        let bestB: Player | null = null, bestN = 0;
        const consider = (B: Player): void => {
          if (B === A || !B.trader) return;
          if (B.tradeDay !== day) { B.tradeDay = day; B.tradesToday = 0; }
          if (B.tradesToday >= P.dailyTradeCap) return;
          const n = feasibleSwaps(A, B, day, false, P.maxSwapsPerTrade, null);
          if (n > bestN) { bestN = n; bestB = B; }
        };
        for (const fid of pop.friends[A.id]) if (todayActive.has(fid)) consider(players[fid]);
        if (A.usesBoard && board.length > 1) for (let k = 0; k < P.boardSample; k++) consider(board[Math.floor(sys() * board.length)]);
        if (!bestB || A.rng() > P.acceptProb) continue;
        const B: Player = bestB;
        out.length = 0;
        const n = feasibleSwaps(A, B, day, false, P.maxSwapsPerTrade, out);
        for (let k = 0; k < n; k++) {
          const x = out[2 * k], y = out[2 * k + 1]; // A gives x, receives y
          A.count[x]--; B.count[x]++; B.lockedCopies[x] += 1; B.lockUntil[x] = Math.max(B.lockUntil[x], day + P.lockDays);
          B.count[y]--; A.count[y]++; A.lockedCopies[y] += 1; A.lockUntil[y] = Math.max(A.lockUntil[y], day + P.lockDays);
          if (B.firstDay[x] < 0) onOwnedChange(B, x, day, true);
          if (A.firstDay[y] < 0) onOwnedChange(A, y, day, true);
        }
        A.trades++; B.trades++; A.tradesToday++; B.tradesToday++;
        wk.trades[w]++;
      }
    }
    // ── pass 3: blend on purpose ──
    if (P.blendEnabled) for (const p of active) if (p.rng() < p.blendLove) tryBlend(p, day, false);
    // ── end of day bookkeeping (lock expiry housekeeping) ──
    for (const p of active) for (let s = 0; s < NS; s++) if (p.lockedCopies[s] > 0 && day + 1 >= p.lockUntil[s]) p.lockedCopies[s] = 0;
    if ((day + 1) % 7 === 0 || day === P.days - 1) {
      for (const p of players) if (p.alive) {
        const t = total(p);
        wk.hoardSum[w] += t; wk.hoardN[w]++; wk.ownedSum[w] += p.owned; if (t >= P.hoardCap - 2) wk.atCap[w]++;
      }
    }
  }
  return { P, players, weekly: wk, snaps, label };
}

/* ───────────────────────────── exploit ring (does a trade lock stop dupe-laundering?) ───────────────────────────── */

interface Policy { name: string; lockH: number; capPerDay: number; pairPerDay: number; }
interface RingOut { copies: number; innocents: number; maxHop: number; accounts: number; }

/**
 * Hourly toy model of a hostile ring. R mule accounts bot-trade a tainted item among themselves and "cash out" 25% of hops
 * to random innocent accounts. 'dupe' = a hypothetical server bug where the GIVER KEEPS the item and the receiver also gets
 * a copy. 'steal' = no bug: the ring moves 20 items stolen from hacked hoards. Detection (supply reconciliation / a report)
 * happens at hour D. Reports what had spread by then.
 */
function ring(policy: Policy, bug: 'dupe' | 'steal', detectH: number): RingOut {
  const r = mulberry32(0xbad0 + policy.lockH * 7 + policy.capPerDay * 13 + policy.pairPerDay * 31 + (bug === 'dupe' ? 1 : 2));
  const R = 6, HONEST = 4000, BOT_TRADES_PER_H = 30, CASHOUT = 0.25, ONWARD_H = 0.01;
  interface It { holder: number; unlock: number; hop: number; }
  const items: It[] = [];
  const start = bug === 'dupe' ? 1 : 20;
  for (let i = 0; i < start; i++) items.push({ holder: i % R, unlock: 0, hop: 0 });
  const dayTrades = new Map<string, number>();
  const key = (d: number, a: string): string => d + ':' + a;
  let guard = 0;
  for (let h = 0; h < detectH; h++) {
    const d = Math.floor(h / 24);
    const budget = new Array(R).fill(BOT_TRADES_PER_H);
    const snapshot = items.length;
    for (let idx = 0; idx < snapshot; idx++) {
      const it = items[idx];
      if (it.unlock > h) continue;
      if (it.holder >= R) { // innocent holder: slow, honest onward trades
        if (r() < ONWARD_H) { it.holder = R + Math.floor(r() * HONEST); it.unlock = h + policy.lockH; it.hop++; }
        continue;
      }
      while (budget[it.holder] > 0 && ++guard < 5e6) {
        budget[it.holder]--;
        const toInnocent = r() < CASHOUT;
        const to = toInnocent ? R + Math.floor(r() * HONEST) : (it.holder + 1 + Math.floor(r() * (R - 1))) % R;
        const gk = key(d, 'a' + it.holder);
        if ((dayTrades.get(gk) ?? 0) >= policy.capPerDay) { budget[it.holder] = 0; break; }
        const pk = key(d, 'p' + Math.min(it.holder, to) + '-' + Math.max(it.holder, to));
        if (!toInnocent && (dayTrades.get(pk) ?? 0) >= policy.pairPerDay) continue;
        dayTrades.set(gk, (dayTrades.get(gk) ?? 0) + 1);
        if (!toInnocent) dayTrades.set(pk, (dayTrades.get(pk) ?? 0) + 1);
        if (bug === 'dupe') { items.push({ holder: to, unlock: h + policy.lockH, hop: it.hop + 1 }); }
        else { it.holder = to; it.unlock = h + policy.lockH; it.hop++; break; }
        if (items.length > 400000) break;
      }
      if (items.length > 400000) break;
    }
    if (items.length > 400000) break;
  }
  const holders = new Set<number>(items.map((i) => i.holder));
  let innocents = 0, maxHop = 0;
  const inn = new Set<number>();
  for (const it of items) { if (it.holder >= R) inn.add(it.holder); if (it.hop > maxHop) maxHop = it.hop; }
  innocents = inn.size;
  return { copies: items.length - start, innocents, maxHop, accounts: holders.size };
}

/* ───────────────────────────── reporting ───────────────────────────── */

const argv = process.argv.slice(2);
const argNum = (name: string, dflt: number): number => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const QUICK = argv.includes('--quick');
const BASE: Params = { ...DEFAULTS, nPlayers: argNum('--n', QUICK ? 1500 : DEFAULTS.nPlayers), days: argNum('--days', DEFAULTS.days) };

const compl = (res: Result, pred: (p: Player) => boolean, byDay: number): number => {
  const sel = res.players.filter(pred);
  return sel.length ? sel.filter((p) => p.fullDay > 0 && p.fullDay <= byDay).length / sel.length : NaN;
};
const days12 = (res: Result, pred: (p: Player) => boolean): number[] => res.players.filter((p) => pred(p) && p.fullDay > 0).map((p) => p.fullDay);
const days9 = (res: Result, pred: (p: Player) => boolean): number[] => res.players.filter((p) => pred(p) && p.coreDay > 0).map((p) => p.coreDay);

function header(t: string): void { console.log('\n' + '='.repeat(100) + '\n' + t + '\n' + '='.repeat(100)); }

function section_time(solo: Result, trade: Result): void {
  header('A. TIME TO A FULL 12-SPECIES SHELF  (day 60, churn on; "stayers" = still playing at day 60)');
  const groups: Array<[string, (p: Player) => boolean]> = [
    ['all players', () => true],
    ['stayers (all tiers)', (p) => p.alive],
    ['stayers casual', (p) => p.alive && p.tier === 0],
    ['stayers regular', (p) => p.alive && p.tier === 1],
    ['stayers devoted', (p) => p.alive && p.tier === 2],
    ['stayers poker', (p) => p.alive && p.arche === 0],
    ['stayers squeezer', (p) => p.alive && p.arche === 1],
    ['stayers puller', (p) => p.alive && p.arche === 2],
    ['stayers mixed', (p) => p.alive && p.arche === 3],
  ];
  console.log(lpad('group', 22) + '| ' + pad('n', 5) + ' | SOLO: done@D30 D45 D60   med-day | TRADE: done@D30 D45 D60   med-day | 9/12 med-day solo -> trade');
  for (const [name, f] of groups) {
    const n = solo.players.filter(f).length;
    const row = (r: Result): string => `${pad(pc0(compl(r, f, 30)), 5)} ${pad(pc0(compl(r, f, 45)), 4)} ${pad(pc0(compl(r, f, 60)), 4)}   ${pad(f1(median(days12(r, f))), 6)}`;
    console.log(`${lpad(name, 22)}| ${pad(n, 5)} | ${row(solo)}            | ${row(trade)}            | ${pad(f1(median(days9(solo, f))), 5)} -> ${f1(median(days9(trade, f)))}`);
  }
  console.log('("med-day" = median over players who finished by day 60 only; a bigger gap in done@D60 is the honest signal when most do not finish.)');
}

function section_long(solo: Result, trade: Result): void {
  header(`B. UNCENSORED TIME TO FULL SHELF  (no churn, ${solo.P.days} days; median over ALL players of that tier, never-finishers count as "> ${solo.P.days}")`);
  console.log(lpad('tier', 10) + '| SOLO  done%  median  p25 p75 | TRADE done%  median  p25 p75');
  for (let t = 0; t < 3; t++) {
    const f = (p: Player): boolean => p.tier === t;
    const cell = (r: Result): string => {
      const sel = r.players.filter(f);
      const ds = sel.map((p) => (p.fullDay > 0 ? p.fullDay : 9999));
      const done = sel.filter((p) => p.fullDay > 0).length / sel.length;
      const m = median(ds), a = quantile(ds, 0.25), b = quantile(ds, 0.75);
      const sh = (x: number): string => (x >= 9999 ? '>' + r.P.days : String(Math.round(x)));
      return `${pad(pc0(done), 5)} ${pad(sh(m), 7)} ${pad(sh(a), 5)} ${pad(sh(b), 4)}`;
    };
    console.log(`${lpad(TIER_NAMES[t], 10)}| ${cell(solo)} | ${cell(trade)}`);
  }
}

function section_dupes(solo: Result, trade: Result): void {
  header('C. DUPLICATES: share of CAPSULE drops that repeat a species the player already holds (60-day main scenario)');
  const weeks = solo.weekly.src.length;
  console.log(lpad('week', 6) + '| capsule dup SOLO   TRADE | all-acquisition dup SOLO   TRADE | mean species owned (of 12) SOLO  TRADE');
  for (let w = 0; w < weeks; w++) {
    const a = solo.weekly, b = trade.weekly;
    console.log(`${lpad(w + 1, 6)}| ${pad(pc(a.dupCapsules[w] / a.capsules[w]), 18)} ${pad(pc(b.dupCapsules[w] / b.capsules[w]), 7)} | ${pad(pc(a.dupAcq[w] / a.acq[w]), 25)} ${pad(pc(b.dupAcq[w] / b.acq[w]), 7)} | ${pad(f1(a.ownedSum[w] / a.hoardN[w]), 31)} ${pad(f1(b.ownedSum[w] / b.hoardN[w]), 6)}`);
  }
  const tot = (r: Result): string => pc(r.weekly.dupCapsules.reduce((x, y) => x + y, 0) / r.weekly.capsules.reduce((x, y) => x + y, 0));
  console.log(`whole 60 days: capsule dup rate SOLO ${tot(solo)}   TRADE ${tot(trade)}`);
}

function section_supply(main: Result, noCap: Result, noBlend: Result): void {
  header('D. SUPPLY: items minted (sources) vs destroyed (sinks), per ALIVE player per week, and hoard size');
  const wk = (r: Result, w: number): [number, number, number, number, number] => {
    const alive = r.weekly.hoardN[w] || 1;
    const sm = r.weekly.src[w] / alive, sb = r.weekly.sinkBlend[w] / alive, sr = r.weekly.sinkRelease[w] / alive;
    return [sm, sb, sr, r.weekly.hoardSum[w] / alive, r.weekly.atCap[w] / alive];
  };
  for (const [name, r] of [['MAIN (cap 60, blend on)', main], ['NO CAP, blend on', noCap], ['NO CAP, NO BLEND (control)', noBlend]] as Array<[string, Result]>) {
    console.log(name);
    console.log(lpad('  week', 8) + '| minted/pl  blend-sink  release-sink  sink/minted | mean hoard  at-cap');
    for (let w = 0; w < r.weekly.src.length; w++) {
      const [s, b, rl, h, c] = wk(r, w);
      console.log(`${lpad('  ' + (w + 1), 8)}| ${pad(f1(s), 9)} ${pad(f1(b), 11)} ${pad(f1(rl), 13)} ${pad(pc0((b + rl) / s), 12)} | ${pad(f1(h), 10)} ${pad(pc0(c), 7)}`);
    }
  }
}

function section_blend(main: Result): void {
  header('E. BLENDING (main scenario, trade on)');
  const all = main.players;
  const per = all.map((p) => p.blends);
  const stay = all.filter((p) => p.alive).map((p) => p.blends);
  const ever = all.filter((p) => p.blends > 0).length / all.length;
  const parents = all.reduce((a, p) => a + p.blendParents, 0) / Math.max(1, all.reduce((a, p) => a + p.blends, 0));
  console.log(`blends per player over 60 days: mean ${f1(mean(per))}  median ${f1(median(per))}  p90 ${f1(quantile(per, 0.9))}   (stayers: mean ${f1(mean(stay))} median ${f1(median(stay))})`);
  console.log(`share who ever blend ${pc0(ever)}   mean parents per blend ${f2(parents)}   journal entries found: mean ${f1(mean(all.map((p) => p.pairsSeen.size)))} of ${JOURNAL_PAIRS} (stayers ${f1(mean(all.filter((p) => p.alive).map((p) => p.pairsSeen.size)))})`);
  const hy = all.map((p) => p.hybrids);
  console.log(`hybrids held per player at day 60: mean ${f1(mean(hy))} median ${f1(median(hy))}`);
}

function section_trade(trade: Result, solo: Result): void {
  header('F. TRADING BEHAVIOUR (main scenario, lock 1 day)');
  const all = trade.players;
  const everT = all.filter((p) => p.trades > 0);
  const active14 = all.filter((p) => p.activeDays >= 14);
  console.log(`players who ever completed a trade: ${pc0(everT.length / all.length)} of all   ${pc0(active14.filter((p) => p.trades > 0).length / active14.length)} of players with >= 14 active days   (willing-to-trade flag: ${pc0(all.filter((p) => p.trader).length / all.length)})`);
  console.log(`trades per trader who traded: mean ${f1(mean(everT.map((p) => p.trades)))}  median ${f1(median(everT.map((p) => p.trades)))}   total trades/day (avg over 60d, per 1000 players): ${f1((trade.weekly.trades.reduce((a, b) => a + b, 0) / trade.P.days) / (all.length / 1000))}`);
  const comp = all.filter((p) => p.fullDay > 0);
  const viaT = comp.map((p) => { let c = 0; for (let s = 0; s < NS; s++) if (p.viaTrade[s]) c++; return c; });
  console.log(`completed shelves: ${comp.length}   of those: needed >= 1 traded-in species ${pc0(viaT.filter((v) => v > 0).length / Math.max(1, comp.length))}, final species arrived by trade ${pc0(comp.filter((p) => p.finalViaTrade).length / Math.max(1, comp.length))}, mean traded-in species ${f2(mean(viaT))}`);
  const rareDone = (r: Result, pr: (p: Player) => boolean): number => { const sel = r.players.filter(pr); return sel.filter((p) => p.count[3] + p.count[7] + p.count[11] > 0 && p.owned >= 0).length / sel.length; };
  void rareDone;
  const heir = (r: Result, pr: (p: Player) => boolean): number => {
    const sel = r.players.filter(pr);
    return mean(sel.map((p) => (p.count[3] > 0 ? 1 : 0) + (p.count[7] > 0 ? 1 : 0) + (p.count[11] > 0 ? 1 : 0)));
  };
  console.log('heirlooms held (of 3) at day 60, stayers:   ' + ARCHE_NAMES.map((n, a) => `${n} ${f2(heir(solo, (p) => p.alive && p.arche === a))} -> ${f2(heir(trade, (p) => p.alive && p.arche === a))}`).join('   ') + '   (solo -> trade)');
  console.log('trades by week: ' + trade.weekly.trades.join(' '));
}

function section_affinity(on: Result, off: Result): void {
  header('G. DOES AFFINITY CREATE COMPLEMENTARY GAPS?  P(two random players have >= 1 feasible same-tier 1:1 swap), solo inventories, ignoring locks and willingness');
  console.log(lpad('pair class', 18) + '| ' + on.snaps.map((s) => `day ${s.day}: affinity ON   OFF `).join(' | '));
  for (const k of ['all pairs', 'same style', 'different style', 'involves mixed']) {
    const cells = on.snaps.map((s, i) => {
      const a = s.pairs[k], b = off.snaps[i].pairs[k];
      return `${pad(pc0(a ? a[0] / a[1] : NaN), 18)} ${pad(pc0(b ? b[0] / b[1] : NaN), 5)}`;
    });
    console.log(`${lpad(k, 18)}| ${cells.join(' | ')}`);
  }
}

function section_lock(rows: Array<[string, Result]>): void {
  header('H. WHAT A RECEIVE-LOCK COSTS HONEST PLAYERS  (trade on, 60 days, churn on)');
  console.log(lpad('lock', 16) + '| trades/1000pl/day | players who trade | stayers done@D60 | stayers regular med-day | heirlooms held (stayers)');
  for (const [name, r] of rows) {
    const all = r.players;
    const t = (r.weekly.trades.reduce((a, b) => a + b, 0) / r.P.days) / (all.length / 1000);
    const heirM = mean(all.filter((p) => p.alive).map((p) => (p.count[3] > 0 ? 1 : 0) + (p.count[7] > 0 ? 1 : 0) + (p.count[11] > 0 ? 1 : 0)));
    console.log(`${lpad(name, 16)}| ${pad(f1(t), 17)} | ${pad(pc0(all.filter((p) => p.trades > 0).length / all.length), 17)} | ${pad(pc0(compl(r, (p) => p.alive, 60)), 16)} | ${pad(f1(median(days12(r, (p) => p.alive && p.tier === 1))), 23)} | ${f2(heirM)}`);
  }
}

function section_ring(): void {
  header('I. EXPLOIT RING TOY MODEL: what had spread when it was detected?  (6 bot mules, 30 trades/hour each, 25% of hops cash out to innocents)');
  const policies: Policy[] = [
    { name: 'no limits', lockH: 0, capPerDay: 1e9, pairPerDay: 1e9 },
    { name: 'lock 24h only', lockH: 24, capPerDay: 1e9, pairPerDay: 1e9 },
    { name: 'daily cap 5 only', lockH: 0, capPerDay: 5, pairPerDay: 1e9 },
    { name: 'cap 5 + pair 1/day', lockH: 0, capPerDay: 5, pairPerDay: 1 },
    { name: 'lock24+cap5+pair1', lockH: 24, capPerDay: 5, pairPerDay: 1 },
  ];
  console.log(lpad('policy', 20) + '| DUPE BUG (giver keeps item): extra copies / innocents / max hop   | STOLEN 20 ITEMS (no bug): innocents holding / max hop');
  console.log(lpad('', 20) + '|   detected at 6h        detected at 24h                              |   at 6h            at 24h');
  for (const pol of policies) {
    const d6 = ring(pol, 'dupe', 6), d24 = ring(pol, 'dupe', 24), s6 = ring(pol, 'steal', 6), s24 = ring(pol, 'steal', 24);
    const c = (o: RingOut): string => `${o.copies >= 400000 ? '>400k' : o.copies}/${o.innocents}/${o.maxHop}`;
    console.log(`${lpad(pol.name, 20)}| ${pad(c(d6), 12)}   ${pad(c(d24), 18)}                          | ${pad(s6.innocents + '/' + s6.maxHop, 9)}        ${pad(s24.innocents + '/' + s24.maxHop, 9)}`);
  }
}

function section_sens(rows: Array<[string, Result, Result]>): void {
  header('J. SENSITIVITY: do the headline results survive different behaviour assumptions?  (stayers, day 60)');
  console.log(lpad('variant', 38) + '| SOLO done@D60 | TRADE done@D60 | capsule dup (60d) | players who trade | heirlooms held solo -> trade');
  for (const [name, s, t] of rows) {
    const dup = (r: Result): number => r.weekly.dupCapsules.reduce((a, b) => a + b, 0) / r.weekly.capsules.reduce((a, b) => a + b, 0);
    const heir = (r: Result): number => mean(r.players.filter((p) => p.alive).map((p) => (p.count[3] > 0 ? 1 : 0) + (p.count[7] > 0 ? 1 : 0) + (p.count[11] > 0 ? 1 : 0)));
    console.log(`${lpad(name, 38)}| ${pad(pc0(compl(s, (p) => p.alive, 60)), 13)} | ${pad(pc0(compl(t, (p) => p.alive, 60)), 14)} | ${pad(pc0(dup(t)), 17)} | ${pad(pc0(t.players.filter((p) => p.trades > 0).length / t.players.length), 17)} | ${f2(heir(s))} -> ${f2(heir(t))}`);
  }
}

/* ───────────────────────────── main ───────────────────────────── */

const t0 = process.hrtime.bigint();
const popMain = makePop(BASE);
console.log(`WOBBLEHOARD economy sim  players=${BASE.nPlayers} days=${BASE.days} seed=0x${BASE.seed.toString(16)}${QUICK ? '  (--quick)' : ''}`);
console.log(`shelf: ${NS} species = 3 style groups x (2 common, 1 uncommon, 1 heirloom); base weights ${BASE_W.join('/')}; affinity beta=${BASE.beta} lambda=${BASE.lambda}`);
console.log(`economy: ${BASE.capsuleCost} SP/capsule, ${BASE.spPerMin} SP/min (all styles), soft cap ${BASE.softCap} SP/day, restock pick 1 of ${BASE.restockOffered}, ${BASE.tasksOffered} tasks/day (max ${BASE.taskWeeklyMax}/wk), hoard cap ${BASE.hoardCap}`);
console.log(`population (ASSUMED): archetypes poker/squeezer/puller/mixed ${BASE.archeShare.join('/')}; tiers casual/regular/devoted ${BASE.tierShare.join('/')}; active-day chance ${BASE.pActive.join('/')}; daily churn ${BASE.churn.join('/')}; willing traders ${BASE.traderProb.join('/')}; friends-homophily ${BASE.friendHomophily}`);

const solo = runScenario({ ...BASE, trade: false }, popMain, 'solo');
const trade = runScenario({ ...BASE, trade: true, lockDays: 1 }, popMain, 'trade L1');
section_time(solo, trade);
section_dupes(solo, trade);

const noCap = runScenario({ ...BASE, trade: true, hoardCap: 99999 }, popMain, 'nocap');
const noBlend = runScenario({ ...BASE, trade: true, hoardCap: 99999, blendEnabled: false }, popMain, 'noblend');
section_supply(trade, noCap, noBlend);
section_blend(trade);
section_trade(trade, solo);

const affOff = runScenario({ ...BASE, trade: false, beta: 0 }, popMain, 'solo beta0');
section_affinity(solo, affOff);

const L0 = runScenario({ ...BASE, trade: true, lockDays: 0 }, popMain, 'L0');
const L3 = runScenario({ ...BASE, trade: true, lockDays: 3 }, popMain, 'L3');
section_lock([['none (0 days)', L0], ['1 day (proposed)', trade], ['3 days', L3]]);
section_ring();

// uncensored: nobody leaves, run long
const longDays = argNum('--long', QUICK ? 150 : 240);
const longSolo = runScenario({ ...BASE, trade: false, days: longDays, churn: [0, 0, 0], snapshotDays: [] }, popMain, 'long solo');
const longTrade = runScenario({ ...BASE, trade: true, days: longDays, churn: [0, 0, 0], snapshotDays: [] }, popMain, 'long trade');
section_long(longSolo, longTrade);

// sensitivity
const sens: Array<[string, Result, Result]> = [['BASE (skewed styles, as above)', solo, trade]];
const variant = (name: string, o: Partial<Params>, popOverride?: Partial<Params>): void => {
  const pop = popOverride ? makePop({ ...BASE, ...popOverride }) : popMain;
  const s = runScenario({ ...BASE, ...o, ...popOverride, trade: false }, pop, name + ' solo');
  const t = runScenario({ ...BASE, ...o, ...popOverride, trade: true }, pop, name + ' trade');
  sens.push([name, s, t]);
};
variant('balanced style mix 25/25/25/25', {}, { archeShare: [0.25, 0.25, 0.25, 0.25] });
variant('25% of players rotate styles on purpose', {}, { adaptiveShare: 0.25 });
variant('no daily restock', { restock: false });
variant('task capsules not style-bent (focus 0)', { taskFocus: 0 });
variant('affinity off (beta 0)', { beta: 0 });
variant('fewer willing traders (half)', {}, { traderProb: [0.15, 0.275, 0.375] });
variant('no friends (board only)', {}, { friendHomophily: 0, boardProb: 1 });
variant('dupe shield (reroll if holding >= 3)', { shieldAt: 3 });
section_sens(sens);

console.log(`\n(elapsed ${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1)} s)`);
