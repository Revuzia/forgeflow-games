// WOBBLEHOARD Squish meter: touch -> squish points (SP) -> free capsules. A serializable, pure state machine (_spec/DESIGN.md 5.4).
//
//   addInteraction(state, { kind, amount, tMs })  ->  { state, spGained, capsulesEarned, detail }
//
// Time is a PARAMETER (`tMs`, EPOCH milliseconds); nothing here reads a clock or a random number. Epoch, not any monotonic clock: the
// default day key is floor(tMs / 86400000) (a UTC day), and a saved state compares the next touch against its stored lastEventMs, so a
// page clock such as performance.now() would put every touch on day 0 and, after a reload, refuse every touch as 'out-of-order'.
// The state is plain JSON (numbers, null and arrays only): it survives JSON.stringify / JSON.parse and can be stored in a save or a server row.
// Hostile input (NaN, negative, huge, out-of-order times, unknown kinds) never throws and never corrupts the state: the call is refused
// (spGained 0, state returned unchanged) or the number is clamped, and `detail.refused` says why.
//
// WHO OWNS THE TIME (_spec/COLLECTION.md section 7.5, "What time it is: never trusted"). The SERVER is the authority and never replays
// client timestamps. The client reports touches as [kind, amount, dtMs] where dtMs are only RELATIVE offsets inside a batch; the host lays
// the batch out so its last touch is the database's "now", drops what would land at or before the last accepted touch or outside the
// 5-minute bank, and only then calls addInteraction with those server-placed epoch times. So freshness, the per-minute valve, the daily
// cap and the capsule thresholds are server-side facts. The CLIENT meter is a PREVIEW for the HUD ring: it runs the same addInteraction
// on its own touches with Date.now() times and is reconciled with the server's meter on every reply (fold the unacknowledged touches
// over the server state). Pass sanitizeMeter(saved, Date.now()) when loading a saved preview so a state from a skewed clock cannot freeze it.
//
// The rules (every number below is DESIGN 5.4 and is the reference behaviour of _harness/sim_economy.ts):
//   poke                    0.8 SP. Needs a distinct contact: a poke less than 250 ms after the previous poke pays nothing.
//   squeeze-and-release     0.7 SP + 0.45 SP per second held (hold counted up to 3 s); a soft pop of +0.5 SP if held 1.8 s or more.
//                           (a "squeeze" held under 0.4 s is just a poke: SoftEvent mapping, DESIGN 5.4)
//   pull-and-let-go (snap)  1.8 SP; 0.5 SP if it never stretched (snap intensity under 0.35). PROVISIONAL threshold: the slice body was
//                           measured to top out near 0.3 snap intensity even on a hard pull (src/app.ts stretchFull note), which would pay
//                           every pull the 0.5 rate and undo the Puller pace. The physics rewrite decides the real figure; then set this
//                           from measured gestures (or rescale snap intensity in the contract) and re-run the sim. probe_economy.ts prints
//                           the snap intensity the live body reaches on scripted pulls next to this threshold (informative, not a gate).
//   medley                  +2 SP when three different kinds land within 12 s, then a 25 s cooldown.
//   freshness (anti-mash)   pay x clamp((seconds since your last touch of the SAME kind / tau)^2, 0.03, 1); tau poke 0.9, squeeze 2.4, pull 3.0 s.
//   valve                   at most 40 SP credited in any rolling minute (checked at 500 ms resolution over a 60.5 s window, so it is never looser than 60 s).
//   capsule thresholds      the 1st, 2nd and 3rd capsule cost 30, 50, 75 SP; every later one 100 SP.
//   daily cap               8 capsules a day at full rate, the next 4 at 25% rate, then a hard stop at 12 a day from play ("squishies need rest":
//                           nothing is lost, the meter simply fills slowly and then waits for tomorrow). The day is a UTC day unless the caller passes `dayKey`.

export const METER_STATE_VERSION = 1 as const;

export type TouchKind = 'poke' | 'squeeze' | 'pull';
export const TOUCH_KINDS: readonly TouchKind[] = ['poke', 'squeeze', 'pull'];
const KIND_INDEX: Readonly<Record<TouchKind, number>> = { poke: 0, squeeze: 1, pull: 2 };

/** Payouts in SP (DESIGN 5.4). */
export const PAY = {
  poke: 0.8,
  squeezeBase: 0.7,
  squeezePerSecond: 0.45,
  /** A squeeze counts at most this many seconds of hold. */
  squeezeHoldCapSeconds: 3,
  softPop: 0.5,
  /** Hold (seconds) that earns the soft pop. */
  softPopHoldSeconds: 1.8,
  /** A "squeeze" held shorter than this is a poke (SoftEvent mapping: release with heldFor >= 0.4 s is a squeeze). */
  minSqueezeHoldSeconds: 0.4,
  pull: 1.8,
  /** What a pull pays when it never stretched. */
  pullFail: 0.5,
  /** Snap intensity at or above which a pull pays in full. PROVISIONAL until measured on the rewritten body (see the header). */
  pullFullIntensity: 0.35,
  medley: 2,
} as const;

/** A poke closer than this to the previous poke is not a distinct contact and pays nothing. */
export const POKE_MIN_GAP_MS = 250;
/** Freshness time constants, seconds, by kind index (poke, squeeze, pull). */
export const FRESHNESS_TAU_SECONDS: readonly number[] = [0.9, 2.4, 3.0];
export const FRESHNESS_FLOOR = 0.03;
export const MEDLEY_WINDOW_MS = 12000;
export const MEDLEY_COOLDOWN_MS = 25000;
export const VALVE_SP_PER_MINUTE = 40;
const VALVE_BUCKET_MS = 500;
const VALVE_BUCKETS = 121; // current bucket + 120 before it = a window of 60.0 to 60.5 s
/** Capsule costs for the first capsules; later ones cost CAPSULE_COST. */
export const CAPSULE_RAMP: readonly number[] = [30, 50, 75];
export const CAPSULE_COST = 100;
export const DAILY_FULL_RATE_CAPSULES = 8;
export const DAILY_REDUCED_RATE = 0.25;
export const DAILY_HARD_STOP_CAPSULES = 12;
export const DAY_MS = 86_400_000;
/** Largest time the meter accepts (the end of the JS Date range). */
export const MAX_T_MS = 8.64e15;

/** SP needed for the capsule number `earned` (0-based count of capsules already earned from play): 30, 50, 75, then 100. */
export const capsuleThreshold = (earned: number): number => (earned >= 0 && earned < CAPSULE_RAMP.length ? CAPSULE_RAMP[earned | 0] : CAPSULE_COST);

/* ───────────────────────────────────────────────── state ───────────────────────────────────────────────── */

export interface MeterState {
  v: typeof METER_STATE_VERSION;
  /** SP collected toward the next capsule, 0 <= sp < capsuleThreshold(earned). Carries over past a capsule and past midnight. */
  sp: number;
  /** Capsules earned from play, lifetime (drives the 30/50/75/100 ramp). Task and restock capsules are not counted here. */
  earned: number;
  /** Time of the last touch of each kind (poke, squeeze, pull), ms; null = never. */
  lastMs: [number | null, number | null, number | null];
  /** Time of the last accepted interaction; later calls with an earlier time are refused. null = none yet. */
  lastEventMs: number | null;
  /** Touches inside the medley window, as [tMs, kind index]. At most a few dozen entries. */
  recent: Array<[number, number]>;
  /** Earliest time the next medley bonus can pay (ms); 0 = ready. */
  medleyReadyMs: number;
  /** The valve ledger: [bucket index (tMs / 500), SP credited in that bucket], oldest first, at most 121 entries. */
  valve: Array<[number, number]>;
  /** Day key of the daily counter (UTC day number unless the caller supplies dayKey); null = none yet. */
  day: number | null;
  /** Capsules earned from play on `day`. */
  dayCapsules: number;
}

export function createMeter(): MeterState {
  return { v: METER_STATE_VERSION, sp: 0, earned: 0, lastMs: [null, null, null], lastEventMs: null, recent: [], medleyReadyMs: 0, valve: [], day: null, dayCapsules: 0 };
}

/**
 * Parse untrusted JSON into a valid MeterState, or a fresh one if it is not valid. Never throws.
 * `nowMs` (optional, epoch ms): the caller's current time. When given, every stored time later than it (the last touch, the per-kind
 * times, the medley window and cooldown, the valve buckets) is pulled back to it, so a state saved under a clock that was ahead (or
 * written with the wrong clock) cannot refuse every new touch as 'out-of-order' until real time catches up. The server passes its own
 * now; a client preview passes Date.now(). Without `nowMs` the state is only validated, never moved.
 */
export function sanitizeMeter(x: unknown, nowMs?: number): MeterState {
  try {
    const o = x as Partial<MeterState> | null;
    if (!o || typeof o !== 'object' || o.v !== METER_STATE_VERSION) return createMeter();
    const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const now = typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs >= 0 && nowMs <= MAX_T_MS ? nowMs : null;
    const cap = (t: number): number => (now !== null && t > now ? now : t);
    const tOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_T_MS ? cap(v) : null);
    const earned = Math.floor(num(o.earned, 0, 1e9, 0));
    const lm = Array.isArray(o.lastMs) ? o.lastMs : [];
    const recent: Array<[number, number]> = [];
    if (Array.isArray(o.recent)) for (const r of o.recent.slice(-64)) if (Array.isArray(r) && typeof r[0] === 'number' && Number.isFinite(r[0]) && (r[1] === 0 || r[1] === 1 || r[1] === 2)) recent.push([cap(r[0]), r[1]]);
    const valve: Array<[number, number]> = [];
    const nowBucket = now !== null ? Math.floor(now / VALVE_BUCKET_MS) : Infinity;
    if (Array.isArray(o.valve)) for (const r of o.valve.slice(-VALVE_BUCKETS)) if (Array.isArray(r) && typeof r[0] === 'number' && Number.isFinite(r[0]) && typeof r[1] === 'number' && Number.isFinite(r[1]) && r[1] >= 0) {
      const b = Math.min(r[0], nowBucket), tail = valve.length ? valve[valve.length - 1] : null;
      if (tail && tail[0] === b) tail[1] += r[1]; else valve.push([b, r[1]]);
    }
    const medleyMax = now !== null ? now + MEDLEY_COOLDOWN_MS : MAX_T_MS * 2;
    return {
      v: METER_STATE_VERSION, sp: num(o.sp, 0, capsuleThreshold(earned) - 1e-9, 0), earned,
      lastMs: [tOrNull(lm[0]), tOrNull(lm[1]), tOrNull(lm[2])], lastEventMs: tOrNull(o.lastEventMs), recent,
      medleyReadyMs: num(o.medleyReadyMs, 0, medleyMax, 0), valve,
      day: typeof o.day === 'number' && Number.isFinite(o.day) ? Math.floor(o.day) : null, dayCapsules: Math.floor(num(o.dayCapsules, 0, 1e6, 0)),
    };
  } catch {
    return createMeter();
  }
}

/* ───────────────────────────────────────────────── the machine ───────────────────────────────────────────────── */

export interface Interaction {
  kind: TouchKind;
  /**
   * poke: ignored.
   * squeeze: seconds the finger was held (SoftEvent.heldFor of the release), counted up to 3 s.
   * pull: the snap intensity 0..1 (SoftEvent.intensity); 0.35 or more pays in full, less pays the "never stretched" rate.
   */
  amount: number;
  /** EPOCH time of the touch in ms (the moment the finger lifted or the pull was let go): server-placed on the server, Date.now() in the
   *  client preview. Must not go backwards between calls. */
  tMs: number;
  /** Optional day key for the daily cap (default: UTC day number floor(tMs / 86400000)). The server decides what a day is. */
  dayKey?: number;
}

export interface InteractionDetail {
  /** Set when the call was refused: the state is unchanged and nothing was paid. */
  refused?: 'bad-kind' | 'bad-time' | 'out-of-order';
  /** The kind that was actually paid (a squeeze held under 0.4 s is paid as a poke). */
  paidAs?: TouchKind;
  /** SP before freshness, daily rate and valve (soft pop included). */
  base: number;
  freshness: number;
  /** Medley bonus included in spGained. */
  medley: number;
  /** Daily rate applied: 1, 0.25 or 0. */
  dailyRate: number;
  /** True when the poke came within POKE_MIN_GAP_MS of the previous poke and so paid nothing. */
  doubleTap: boolean;
  /** True when the valve cut the payout. */
  valveClamped: boolean;
}

export interface InteractionResult {
  /** The new state (the input state is never mutated). */
  state: MeterState;
  spGained: number;
  /** Capsules that became ready with this touch (usually 0, sometimes 1, never more than a couple). */
  capsulesEarned: number;
  detail: InteractionDetail;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const refuse = (state: MeterState, why: NonNullable<InteractionDetail['refused']>): InteractionResult =>
  ({ state, spGained: 0, capsulesEarned: 0, detail: { refused: why, base: 0, freshness: 0, medley: 0, dailyRate: 0, doubleTap: false, valveClamped: false } });

/** The daily rate for a counter value: full up to 8 capsules, 25% for the next 4, then nothing. */
export const dailyRateFor = (dayCapsules: number): number =>
  (dayCapsules >= DAILY_HARD_STOP_CAPSULES ? 0 : dayCapsules >= DAILY_FULL_RATE_CAPSULES ? DAILY_REDUCED_RATE : 1);

export function addInteraction(state: MeterState, ev: Interaction): InteractionResult {
  // ---- validate (never throw) ----
  const kind = ev && ev.kind;
  if (kind !== 'poke' && kind !== 'squeeze' && kind !== 'pull') return refuse(state, 'bad-kind');
  const t = ev.tMs;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > MAX_T_MS) return refuse(state, 'bad-time');
  if (state.lastEventMs !== null && t < state.lastEventMs) return refuse(state, 'out-of-order');
  const amountRaw = typeof ev.amount === 'number' && Number.isFinite(ev.amount) ? ev.amount : 0;

  // a short squeeze is a poke (DESIGN 5.4 SoftEvent mapping)
  let paid: TouchKind = kind;
  if (kind === 'squeeze' && amountRaw < PAY.minSqueezeHoldSeconds) paid = 'poke';
  const ki = KIND_INDEX[paid];

  // ---- day rollover ----
  const dayKey = typeof ev.dayKey === 'number' && Number.isFinite(ev.dayKey) ? Math.floor(ev.dayKey) : Math.floor(t / DAY_MS);
  let dayCapsules = state.day === dayKey ? state.dayCapsules : 0;
  // (a dayKey that goes BACK while the same time moves forward is treated as a new day: the server owns the clock, the client cannot gain by lying)

  // ---- base pay ----
  let base: number;
  let doubleTap = false;
  const lastSame = state.lastMs[ki];
  if (paid === 'poke') {
    base = PAY.poke;
    const lastPoke = state.lastMs[0];
    if (lastPoke !== null && t - lastPoke < POKE_MIN_GAP_MS) { base = 0; doubleTap = true; }
  } else if (paid === 'squeeze') {
    const hold = clamp(amountRaw, 0, PAY.squeezeHoldCapSeconds);
    base = PAY.squeezeBase + PAY.squeezePerSecond * hold;
    // the soft pop is judged on the REAL hold (above the 3 s counting cap too)
    if (amountRaw >= PAY.softPopHoldSeconds) base += PAY.softPop; // multiplied by freshness below, like the base (the reference sim does the same)
  } else {
    base = clamp(amountRaw, 0, 1) >= PAY.pullFullIntensity ? PAY.pull : PAY.pullFail;
  }

  // ---- freshness ----
  let freshness = 1;
  if (lastSame !== null) {
    const x = (t - lastSame) / 1000 / FRESHNESS_TAU_SECONDS[ki];
    freshness = clamp(x * x, FRESHNESS_FLOOR, 1);
  }
  let pay = base * freshness;

  // ---- medley ----
  const recent: Array<[number, number]> = [];
  for (const r of state.recent) if (r[0] >= t - MEDLEY_WINDOW_MS) recent.push(r);
  recent.push([t, ki]);
  let medley = 0;
  let medleyReadyMs = state.medleyReadyMs;
  if (t >= medleyReadyMs) {
    let mask = 0;
    for (const r of recent) mask |= 1 << r[1];
    if (mask === 7) { medley = PAY.medley; medleyReadyMs = t + MEDLEY_COOLDOWN_MS; }
  }
  pay += medley;

  // ---- daily rate, then the valve ----
  const dailyRate = dailyRateFor(dayCapsules);
  pay *= dailyRate;
  const bucket = Math.floor(t / VALVE_BUCKET_MS);
  const valve: Array<[number, number]> = [];
  let used = 0;
  for (const r of state.valve) if (r[0] > bucket - VALVE_BUCKETS) { valve.push([r[0], r[1]]); used += r[1]; }
  const room = Math.max(0, VALVE_SP_PER_MINUTE - used);
  let valveClamped = false;
  if (pay > room) { pay = room; valveClamped = true; }
  if (pay > 0) {
    const tail = valve.length ? valve[valve.length - 1] : null;
    if (tail && tail[0] === bucket) tail[1] += pay; else valve.push([bucket, pay]);
  }

  // ---- fill the meter, pay out capsules ----
  let sp = state.sp + pay;
  let earned = state.earned;
  let capsules = 0;
  while (sp >= capsuleThreshold(earned) - 1e-12) {
    sp -= capsuleThreshold(earned);
    if (sp < 0) sp = 0;
    earned++;
    capsules++;
    dayCapsules++;
  }

  const lastMs: [number | null, number | null, number | null] = [state.lastMs[0], state.lastMs[1], state.lastMs[2]];
  lastMs[ki] = t;
  const next: MeterState = {
    v: METER_STATE_VERSION, sp, earned, lastMs, lastEventMs: t, recent, medleyReadyMs, valve, day: dayKey, dayCapsules,
  };
  return { state: next, spGained: pay, capsulesEarned: capsules, detail: { paidAs: paid, base, freshness, medley, dailyRate, doubleTap, valveClamped } };
}

/* ───────────────────────────────────────────────── helpers for the UI ───────────────────────────────────────────────── */

/** 0..1 fill of the HUD ring toward the next capsule. */
export const meterFill = (s: MeterState): number => clamp(s.sp / capsuleThreshold(s.earned), 0, 1);

/** What the daily cap looks like for a day: the rate now, how many capsules are left at that rate, whether the day is over. */
export function dailyStatus(s: MeterState, dayKey: number): { capsulesToday: number; rate: number; atFullRate: number; hardStopped: boolean } {
  const n = s.day === Math.floor(dayKey) ? s.dayCapsules : 0;
  return { capsulesToday: n, rate: dailyRateFor(n), atFullRate: Math.max(0, DAILY_FULL_RATE_CAPSULES - n), hardStopped: n >= DAILY_HARD_STOP_CAPSULES };
}
