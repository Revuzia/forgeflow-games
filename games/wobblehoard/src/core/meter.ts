// WOBBLEHOARD Squish meter: touch -> squish points (SP) -> free capsules. A serializable, pure state machine (_spec/DESIGN.md 5.4).
//
//   addInteraction(state, { kind, amount, heldS?, tMs })  ->  { state, spGained, capsulesEarned, detail }
//   previewInteraction(state, { kind, amount, heldS?, tMs })  ->  the spGained that touch would get (no new state, no allocation)
//
// Time is a PARAMETER (`tMs`, EPOCH milliseconds); nothing here reads a clock or a random number. Epoch, not any monotonic clock: the
// default day key is floor(tMs / 86400000) (a UTC day), and a saved state compares the next touch against its stored lastEventMs, so a
// page clock such as performance.now() would put every touch on day 0 and, after a reload, refuse every touch as 'out-of-order'.
// The state is plain JSON (numbers, null and arrays only): it survives JSON.stringify / JSON.parse and can be stored in a save or a server row.
// Hostile input (NaN, negative, huge, out-of-order times, unknown kinds) never throws and never corrupts the state: the call is refused
// (spGained 0, state returned unchanged) or the number is clamped, and `detail.refused` says why.
//
// WHO OWNS THE TIME (_spec/COLLECTION.md section 7.5, "What time it is: never trusted"). The SERVER is the authority and never replays
// client timestamps. The client reports touches as [kind, amount, dtMs] (a pull adds its hold: [2, level, dtMs, heldS]) where dtMs are
// only RELATIVE offsets inside a batch; the host lays the batch out so its last touch is the database's "now", drops what would land at
// or before the last accepted touch or outside the 5-minute bank, and only then calls addInteraction with those server-placed epoch
// times. So freshness, the per-minute valve, the daily cap and the capsule thresholds are server-side facts. The CLIENT meter is a
// PREVIEW for the HUD ring: it runs the same addInteraction on its own touches with Date.now() times and is reconciled with the server's
// meter on every reply (fold the unacknowledged touches over the server state). Pass sanitizeMeter(saved, Date.now()) when loading a saved preview so a state from a skewed clock cannot freeze it.
//
// The rules (every number below is DESIGN 5.4 and is the reference behaviour of _harness/sim_economy.ts). Owner direction 2026-10-06
// (_spec/FUN.md 2): every touch earns visibly, and holding earns per second, a squeeze and a stretch alike.
//   poke                    0.8 SP. Needs a distinct contact: a poke less than 250 ms after the previous poke pays nothing (double tap).
//                           Ordinary tapping always pays a little: with the poke freshness (tau 0.75 s, floor 0.25, below) a poke 0.25 s
//                           or more after the last one pays at least 0.2 SP (2 taps a second pay 0.36 SP each, 3 or 4 a second 0.2 SP each).
//   squeeze-and-release     0.7 SP + 0.45 SP per second held (hold counted up to 3 s); a soft pop of +0.5 SP if held 1.8 s or more.
//                           (a "squeeze" held under 0.4 s is just a poke: SoftEvent mapping, DESIGN 5.4)
//   pull-and-let-go (snap)  stretch-and-hold pays per second held, like a squeeze: 1.0 SP + 0.55 SP per second held (hold counted up to
//                           3 s, so 1.55 SP at 1 s, 2.1 at 2 s, 2.65 at 3 s and more), when the pull stretched (snap intensity 0.35 or
//                           more); 0.5 SP flat, whatever the hold, if it never stretched (under 0.35). The hold is Interaction.heldS = the
//                           snap's heldFor, the seconds from the grab to the release (softbody.ts grab/updateGrabs/grabRelease).
//                           Since physics round 2 the snap intensity is the pull level (grab distance / the body's own family maxPull;
//                           1.0 = pulled to its limit, measured 1.000 on a full pull and 0.500 on a half pull for all 12 families), so 0.35
//                           means "pulled about a third of the way to its limit". The stretch test is the level AT THE RELEASE: the event
//                           does not say how long the level was over 0.35, so the whole hold counts once the release is stretched.
//   medley                  +2 SP when three different kinds land within 12 s, then a 25 s cooldown.
//   freshness (anti-mash)   pay x clamp((seconds since your last touch of the SAME kind / tau)^2, floor, 1); tau poke 0.75, squeeze 2.4,
//                           pull 3.0 s; floor poke 0.25, squeeze and pull 0.03 (mashing squeezes or pulls stays worthless).
//   valve                   at most 40 SP credited in any rolling minute (checked at 500 ms resolution over a 60.5 s window, so it is never looser than 60 s).
//                           Fast tapping is bounded here: steady tapping at 2 or 4 a second would pay 43 or 48 SP/min and is held to 40,
//                           as is a script at the fastest paid rate (a poke every 250 ms) or full stretches held 3 s back to back.
//   capsule thresholds      the 1st, 2nd and 3rd capsule cost 30, 50, 75 SP; every later one 100 SP.
//   daily cap               8 capsules a day at full rate, the next 4 at 25% rate, then a hard stop at 12 a day from play ("squishies need rest":
//                           nothing is lost, the meter simply fills slowly and then waits for tomorrow). The day is a UTC day unless the caller passes `dayKey`.
// previewInteraction(state, ev) is the same pay sum without the new state (allocation-free): what a touch would pay if it ended now, for
// the HUD's pending arc while a squeeze or a stretch is held (Collection.previewTouch).

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
  /** A pull that stretched (snap intensity >= pullFullIntensity) pays pullBase + pullPerSecond x its hold (Interaction.heldS). */
  pullBase: 1.0,
  pullPerSecond: 0.55,
  /** A pull counts at most this many seconds of hold (the same cap as a squeeze). */
  pullHoldCapSeconds: 3,
  /** @deprecated Until 2026-10-06 a stretched pull paid this flat. It is now the pull BASE (= pullBase); read pullBase and pullPerSecond. */
  pull: 1.0,
  /** What a pull pays when it never stretched (flat, whatever the hold). */
  pullFail: 0.5,
  /** Snap intensity (pull level, 1.0 = the family's maxPull) at or above which a pull pays per second held (see the header). */
  pullFullIntensity: 0.35,
  medley: 2,
} as const;

/** A poke closer than this to the previous poke is not a distinct contact and pays nothing. */
export const POKE_MIN_GAP_MS = 250;
/** Freshness time constants, seconds, by kind index (poke, squeeze, pull). */
export const FRESHNESS_TAU_SECONDS: readonly number[] = [0.75, 2.4, 3.0];
/** Freshness floors by kind index (poke, squeeze, pull): ordinary tapping always pays at least a quarter of a fresh poke; mashing
 *  squeezes or pulls stays worthless. */
export const FRESHNESS_FLOORS: readonly number[] = [0.25, 0.03, 0.03];
/** The squeeze and pull freshness floor (FRESHNESS_FLOORS[1] and [2]); the poke floor is FRESHNESS_FLOORS[0]. */
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
   * pull: the snap intensity 0..1 (SoftEvent.intensity); 0.35 or more pays per second held (`heldS`), less pays the "never stretched" rate.
   */
  amount: number;
  /**
   * pull only (ignored for poke and squeeze, whose hold is `amount`): seconds the pull was held, grab to release (SoftEvent.heldFor of
   * the snap). Counted up to PAY.pullHoldCapSeconds when the pull stretched. Omitted, negative or not finite = 0 (the pull base only).
   */
  heldS?: number;
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

/**
 * The pay sum of one touch, shared by addInteraction and previewInteraction so the two can never disagree. Allocation-free: it reads
 * the state and writes the module scratch CALC (single-threaded JS; nothing keeps a reference to it). Returns why the touch is refused,
 * or null.
 */
interface PayCalc {
  paid: TouchKind; ki: number; t: number; dayKey: number; dayCapsules: number; base: number; doubleTap: boolean; freshness: number;
  medley: number; medleyReadyMs: number; dailyRate: number; bucket: number; pay: number; valveClamped: boolean;
}
const CALC: PayCalc = {
  paid: 'poke', ki: 0, t: 0, dayKey: 0, dayCapsules: 0, base: 0, doubleTap: false, freshness: 1, medley: 0, medleyReadyMs: 0, dailyRate: 1, bucket: 0, pay: 0, valveClamped: false,
};
function computePay(state: MeterState, ev: Interaction, c: PayCalc): NonNullable<InteractionDetail['refused']> | null {
  // ---- validate (never throw) ----
  const kind = ev && ev.kind;
  if (kind !== 'poke' && kind !== 'squeeze' && kind !== 'pull') return 'bad-kind';
  const t = ev.tMs;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > MAX_T_MS) return 'bad-time';
  if (state.lastEventMs !== null && t < state.lastEventMs) return 'out-of-order';
  const amountRaw = typeof ev.amount === 'number' && Number.isFinite(ev.amount) ? ev.amount : 0;

  // a short squeeze is a poke (DESIGN 5.4 SoftEvent mapping)
  let paid: TouchKind = kind;
  if (kind === 'squeeze' && amountRaw < PAY.minSqueezeHoldSeconds) paid = 'poke';
  const ki = KIND_INDEX[paid];

  // ---- day rollover ----
  const dayKey = typeof ev.dayKey === 'number' && Number.isFinite(ev.dayKey) ? Math.floor(ev.dayKey) : Math.floor(t / DAY_MS);
  // (a dayKey that goes BACK while the same time moves forward is treated as a new day: the server owns the clock, the client cannot gain by lying)
  const dayCapsules = state.day === dayKey ? state.dayCapsules : 0;

  // ---- base pay ----
  let base: number;
  let doubleTap = false;
  if (paid === 'poke') {
    base = PAY.poke;
    const lastPoke = state.lastMs[0];
    if (lastPoke !== null && t - lastPoke < POKE_MIN_GAP_MS) { base = 0; doubleTap = true; }
  } else if (paid === 'squeeze') {
    const hold = clamp(amountRaw, 0, PAY.squeezeHoldCapSeconds);
    base = PAY.squeezeBase + PAY.squeezePerSecond * hold;
    // the soft pop is judged on the REAL hold (above the 3 s counting cap too)
    if (amountRaw >= PAY.softPopHoldSeconds) base += PAY.softPop; // multiplied by freshness below, like the base (the reference sim does the same)
  } else if (clamp(amountRaw, 0, 1) >= PAY.pullFullIntensity) {
    // stretch-and-hold: per second held, like a squeeze (the hold of a pull rides in heldS; amount is the pull level)
    const h = ev.heldS;
    const held = typeof h === 'number' && Number.isFinite(h) ? clamp(h, 0, PAY.pullHoldCapSeconds) : 0;
    base = PAY.pullBase + PAY.pullPerSecond * held;
  } else {
    base = PAY.pullFail;
  }

  // ---- freshness ----
  let freshness = 1;
  const lastSame = state.lastMs[ki];
  if (lastSame !== null) {
    const x = (t - lastSame) / 1000 / FRESHNESS_TAU_SECONDS[ki];
    freshness = clamp(x * x, FRESHNESS_FLOORS[ki], 1);
  }
  let pay = base * freshness;

  // ---- medley (the window as addInteraction keeps it: the touches of the last 12 s plus this one) ----
  let medley = 0;
  let medleyReadyMs = state.medleyReadyMs;
  if (t >= medleyReadyMs) {
    let mask = 1 << ki;
    const rec = state.recent, from = t - MEDLEY_WINDOW_MS;
    for (let i = 0; i < rec.length; i++) if (rec[i][0] >= from) mask |= 1 << rec[i][1];
    if (mask === 7) { medley = PAY.medley; medleyReadyMs = t + MEDLEY_COOLDOWN_MS; }
  }
  pay += medley;

  // ---- daily rate, then the valve ----
  const dailyRate = dailyRateFor(dayCapsules);
  pay *= dailyRate;
  const bucket = Math.floor(t / VALVE_BUCKET_MS);
  let used = 0;
  const vl = state.valve;
  for (let i = 0; i < vl.length; i++) if (vl[i][0] > bucket - VALVE_BUCKETS) used += vl[i][1];
  const room = Math.max(0, VALVE_SP_PER_MINUTE - used);
  let valveClamped = false;
  if (pay > room) { pay = room; valveClamped = true; }

  c.paid = paid; c.ki = ki; c.t = t; c.dayKey = dayKey; c.dayCapsules = dayCapsules; c.base = base; c.doubleTap = doubleTap; c.freshness = freshness;
  c.medley = medley; c.medleyReadyMs = medleyReadyMs; c.dailyRate = dailyRate; c.bucket = bucket; c.pay = pay; c.valveClamped = valveClamped;
  return null;
}

export function addInteraction(state: MeterState, ev: Interaction): InteractionResult {
  const c = CALC;
  const refused = computePay(state, ev, c);
  if (refused !== null) return refuse(state, refused);
  const { paid, ki, t, dayKey, bucket, pay } = c;
  let dayCapsules = c.dayCapsules;

  // ---- the medley window and the valve ledger (new arrays: the input state is never mutated) ----
  const recent: Array<[number, number]> = [];
  for (const r of state.recent) if (r[0] >= t - MEDLEY_WINDOW_MS) recent.push(r);
  recent.push([t, ki]);
  const valve: Array<[number, number]> = [];
  for (const r of state.valve) if (r[0] > bucket - VALVE_BUCKETS) valve.push([r[0], r[1]]);
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
    v: METER_STATE_VERSION, sp, earned, lastMs, lastEventMs: t, recent, medleyReadyMs: c.medleyReadyMs, valve, day: dayKey, dayCapsules,
  };
  return {
    state: next, spGained: pay, capsulesEarned: capsules,
    detail: { paidAs: paid, base: c.base, freshness: c.freshness, medley: c.medley, dailyRate: c.dailyRate, doubleTap: c.doubleTap, valveClamped: c.valveClamped },
  };
}

/**
 * What addInteraction(state, ev).spGained would be, without building the new state: pay, freshness, the medley bonus this touch would
 * complete, the daily rate and the valve's room, all included (so a pending arc banks exactly what it showed, if nothing else happens
 * before the release). 0 for a refused touch. Pure and allocation-free: the HUD calls it every frame while a squeeze or a stretch is held.
 */
export function previewInteraction(state: MeterState, ev: Interaction): number {
  return computePay(state, ev, CALC) === null ? CALC.pay : 0;
}

/* ───────────────────────────────────────────────── helpers for the UI ───────────────────────────────────────────────── */

/** 0..1 fill of the HUD ring toward the next capsule. */
export const meterFill = (s: MeterState): number => clamp(s.sp / capsuleThreshold(s.earned), 0, 1);

/** What the daily cap looks like for a day: the rate now, how many capsules are left at that rate, whether the day is over. */
export function dailyStatus(s: MeterState, dayKey: number): { capsulesToday: number; rate: number; atFullRate: number; hardStopped: boolean } {
  const n = s.day === Math.floor(dayKey) ? s.dayCapsules : 0;
  return { capsulesToday: n, rate: dailyRateFor(n), atFullRate: Math.max(0, DAILY_FULL_RATE_CAPSULES - n), hardStopped: n >= DAILY_HARD_STOP_CAPSULES };
}
