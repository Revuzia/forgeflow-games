// The attention budget, the motion gate and the character caps (LIFE.md 10; PLAYGROUND_BUILD 14.2, D-17, D-61, D-84, D-85). Pure: no clock
// but the snapshot's sim time `t`, zero allocation after createAttention. lifeStep runs attentionFilter on its own world's Attention (so the
// host must not filter the same intents again); the host reaches that Attention with lifeAttention(w) for the motion gate, the over-budget
// rule (unitCap) and the budgeted `auto` sounds and particles (attentionSound, attentionParticles). Owned by PG_LIFE.
import type { LifeSnapshot, LifeIntents } from '../contracts.ts';
import { INTENT, LIFE_FLAG } from '../data/life.ts';

/* ───────────────────────────── the motion gate (10.3) ───────────────────────────── */

/** The phone factor F (PF-00, T13). PF-00 has not reported: F = 4 as PLAYGROUND_BUILD 14.2 says until it does. Recompute, never type caps. */
export const PHONE_FACTOR = 4;
/** The phone's physics budget per tier (ms a frame: low, med, high) and the props' share near an awake body (PLAYGROUND_BUILD 14.2). */
export const PHYS_BUDGET_MS = [4.0, 6.0, 10.0] as const;
export const PROPS_MS = 0.2;
/** An awake detail-3 whole, pressed (ms, this container; PHYS map 4). */
export const C_WHOLE_MS = 0.87;
/** The unit weights (PF-00 replaces them): an awake whole, an awake piece, a sleeping body, a touching pair of awake bodies. */
export const UNIT = { whole: 1.0, piece: 0.22, sleeper: 0.03, pair: 0.25 } as const;
/** What a start adds for each sleeping body it wakes (LIFE 10.3: 0.97 a whole, 0.19 a piece). */
export const WAKE = { whole: UNIT.whole - UNIT.sleeper, piece: UNIT.piece - UNIT.sleeper } as const;
/** Every gate comparison's tolerance (D-85). */
export const GATE_TOL = 0.001;
/** Character caps (LIFE 10.4; the shell reads them): wholes out, pieces of the one cut squishy, characters, brains; by tier low / med / high. */
export const CHAR_CAP = { wholes: [3, 4, 5], pieces: [4, 6, 6], chars: [6, 8, 10], brains: [3, 4, 5] } as const;

/** unitCap = max((B / F - props) / c_whole, 1.0 + sleeper x (wholes cap - 1)) (D-61, D-85): the formula, never under the floor. */
export function unitCapOf(tier: number, f: number = PHONE_FACTOR): number {
  const t = tier < 0 ? 0 : tier > 2 ? 2 : tier | 0;
  const formula = (PHYS_BUDGET_MS[t] / f - PROPS_MS) / C_WHOLE_MS;
  const floor = UNIT.whole + UNIT.sleeper * (CHAR_CAP.wholes[t] - 1);
  return formula > floor ? formula : floor;
}
/** moverCap = max(1, floor(unitCap)) (with the tolerance, so 1.999.. counts as 2). */
export function moverCapOf(tier: number, f: number = PHONE_FACTOR): number {
  const m = Math.floor(unitCapOf(tier, f) + GATE_TOL);
  return m < 1 ? 1 : m;
}

/* ───────────────────────────── the caps of 10.1 ───────────────────────────── */

/** Columns: 0 phone, 1 phone Calm, 2 desktop, 3 desktop Calm. */
export const CAPS = {
  bubbles: [2, 1, 4, 2], wishSlot: [1, 1, 1, 1], bubbleRate: [0.8, 0.4, 1.5, 0.7], bubbleBurst: [2, 1, 3, 2], gapS: [2.5, 4, 2.5, 4],
  voices: [2, 1, 3, 1], sylRate: [3, 1.5, 4, 2], sylBurst: [4, 2, 6, 3], groupBubbles: [1, 1, 1, 1], groupVoices: [1, 1, 1, 1],
  autoSounds: [2, 1, 3, 1.5], particles: [24, 8, 48, 16], haptics: [0, 0, 0, 0], camera: [0, 0, 0, 0],
} as const;
export function capColumn(s: LifeSnapshot): number { return (s.phone ? 0 : 2) + (s.calm ? 1 : 0); }

/** EMOTE styles: 0 say, 1 think (a wish), 2 group (pieces); 3 = a wish shown only as its still 14 px dot (the wish slot is taken: 10.1, 7.2). */
export const STYLE = { SAY: 0, THINK: 1, GROUP: 2, WISH_DOT: 3 } as const;
/** A bubble's time on screen (in 0.15 + hold 1.6 + out 0.25 s, LIFE 7.2) and the P1 wait (10.2). */
export const BUBBLE_S = 2.0;
export const P1_WAIT_S = 2.0;
/** The touch duck lasts until 0.6 s after the release (8.4, 10.2). */
export const DUCK_AFTER_S = 0.6;
const PEND = 4;

export interface Attention {
  t: number; bubTok: number; bubT: number; sylTok: number; sylT: number; sndTok: number; sndT: number; partTok: number; partT: number;
  /** say / group bubble on screen until (per character slot), whether it is a group bubble, the wish slot's owner, wish dots on screen */
  bubUntil: Float64Array; bubGroup: Int16Array; wishOwner: number; wishDot: Uint8Array;
  voiceUntil: Float64Array; voiceGroup: Uint8Array; lastSylT: number;
  charGapT: Float64Array; iconT: Float64Array; touchUntil: number;
  /** P1 requests waiting (at most 2 s) */
  pN: number; pWho: Int8Array; pUntil: Float64Array; pF: Float32Array; pB: Uint8Array; pKind: Uint8Array;
  /** written by lifeStep each tick: LIFE's movers, the tier's caps and the ride allowance (D-85) */
  movers: number; moverCap: number; unitCap: number; allowance: number;
  /** scratch */
  keep: Uint8Array; order: Int8Array;
  /** counters (dev hook and probes) */
  granted: number; dropped: number;
}

export function createAttention(): Attention {
  return {
    t: -1e9, bubTok: 3, bubT: -1e9, sylTok: 6, sylT: -1e9, sndTok: 3, sndT: -1e9, partTok: 48, partT: -1e9,
    bubUntil: new Float64Array(16).fill(-1e9), bubGroup: new Int16Array(16).fill(-1), wishOwner: -1, wishDot: new Uint8Array(16),
    voiceUntil: new Float64Array(8).fill(-1e9), voiceGroup: new Uint8Array(8), lastSylT: -1e9,
    charGapT: new Float64Array(16).fill(-1e9), iconT: new Float64Array(16 * 25).fill(-1e9), touchUntil: -1e9,
    pN: 0, pWho: new Int8Array(PEND), pUntil: new Float64Array(PEND), pF: new Float32Array(PEND * 8), pB: new Uint8Array(PEND * 5), pKind: new Uint8Array(PEND),
    movers: 0, moverCap: 1, unitCap: 1.06, allowance: 0,
    keep: new Uint8Array(64), order: new Int8Array(64),
    granted: 0, dropped: 0,
  };
}

/** May LIFE start moving k more characters? movers + k <= moverCap (a start that wakes nobody needs only this, LF-10). */
export function motionGate(a: Attention, s: LifeSnapshot, k: number): boolean {
  a.moverCap = moverCapOf(s.tier);
  return a.movers + k <= a.moverCap;
}
/** The full start test: the mover tokens, and units + delta <= unitCap + allowance (the ride allowance while a ride moment runs). */
export function motionGateWake(a: Attention, s: LifeSnapshot, k: number, units: number, delta: number, allowance: number): boolean {
  if (!motionGate(a, s, k)) return false;
  if (delta <= 0) return true;
  a.unitCap = unitCapOf(s.tier);
  return units + delta <= a.unitCap + allowance + GATE_TOL;
}

/* ───────────────────────────── the filter (10.1, 10.2) ───────────────────────────── */

function refill(a: Attention, s: LifeSnapshot, col: number): void {
  const t = s.t;
  if (t > a.bubT) { a.bubTok = Math.min(CAPS.bubbleBurst[col], a.bubTok + (t - a.bubT) * CAPS.bubbleRate[col]); a.bubT = t; }
  if (t > a.sylT) { a.sylTok = Math.min(CAPS.sylBurst[col], a.sylTok + (t - a.sylT) * CAPS.sylRate[col]); a.sylT = t; }
  if (a.bubTok > CAPS.bubbleBurst[col]) a.bubTok = CAPS.bubbleBurst[col];
  if (a.sylTok > CAPS.sylBurst[col]) a.sylTok = CAPS.sylBurst[col];
}

function onScreen(a: Attention, t: number): number {
  let n = 0;
  for (let i = 0; i < 16; i++) { if (a.bubUntil[i] > t) n += 1; if (a.wishDot[i]) n += 0.25; }
  return n;
}

function emoteOk(a: Attention, s: LifeSnapshot, out: LifeIntents, k: number, col: number, touching: boolean): boolean {
  const who = out.who[k], t = s.t, icon = out.icon[k], style = out.style[k], cls = out.e[k];
  if (icon === 0) { // a clear
    if (style === STYLE.THINK || style === STYLE.WISH_DOT) { if (a.wishOwner === who) a.wishOwner = -1; a.wishDot[who] = 0; }
    else a.bubUntil[who] = -1e9;
    return true;
  }
  if (who < s.n && (s.flags[who] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED)) !== 0) return false; // L2: no bubble while held
  if (who < s.n && !(s.sx[who] === s.sx[who])) return false; // off screen: no bubble
  if (style === STYLE.THINK || style === STYLE.WISH_DOT) {
    const o = a.wishOwner;
    if (o < 0 || o === who || o >= s.n || !(s.sx[o] === s.sx[o])) {
      if (a.wishOwner !== who) { if (a.bubTok < 1) return false; a.bubTok -= 1; }
      a.wishOwner = who; a.wishDot[who] = 0; out.style[k] = STYLE.THINK;
      return true;
    }
    // the wish slot is taken: its still dot (0.25 of a bubble, inside the at-once cap)
    if (a.wishDot[who]) return false;
    if (onScreen(a, t) + 0.25 > CAPS.bubbles[col] + 1e-9) return false;
    a.wishDot[who] = 1; out.style[k] = STYLE.WISH_DOT;
    return true;
  }
  if (touching && cls >= 2) return false; // the player is touching: P2 and P3 bubbles stop (never a lock alone)
  if (t - a.iconT[who * 25 + icon] < 4) return false; // the same icon from the same character within 4 s
  if (t - a.charGapT[who] < CAPS.gapS[col]) return false;
  if (style === STYLE.GROUP) { // one piece-group bubble on screen everywhere
    for (let i = 0; i < 16; i++) if (a.bubUntil[i] > t && a.bubGroup[i] >= 0 && i !== who) return false;
  }
  if (a.bubUntil[who] > t) return false; // at most one bubble per character
  if (onScreen(a, t) + 1 > CAPS.bubbles[col] + 1e-9) return false;
  if (a.bubTok < 1) return false;
  a.bubTok -= 1; a.bubUntil[who] = t + BUBBLE_S; a.bubGroup[who] = style === STYLE.GROUP ? out.groupKey[k] : -1;
  a.charGapT[who] = t; a.iconT[who * 25 + icon] = t;
  return true;
}

function voiceOk(a: Attention, s: LifeSnapshot, out: LifeIntents, k: number, col: number, touching: boolean): boolean {
  const who = out.who[k], t = s.t, nSyl = out.d[k] > 0 ? out.d[k] : 1, dur = out.e[k] > 0 ? out.e[k] : 0.4, group = out.b[k] === 1;
  if (who < s.n && (s.flags[who] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.LOCKED)) !== 0) return false;
  let live = 0, liveG = 0, free = -1;
  for (let v = 0; v < 8; v++) { if (a.voiceUntil[v] > t) { live++; if (a.voiceGroup[v]) liveG++; } else if (free < 0) free = v; }
  if (free < 0 || live + 1 > CAPS.voices[col]) return false;
  if (group && liveG >= CAPS.groupVoices[col]) return false;
  if (touching) { if (t - a.lastSylT < nSyl) return false; } // ducked: one syllable a second
  else if (a.sylTok < nSyl) return false;
  a.sylTok -= nSyl; if (a.sylTok < 0) a.sylTok = 0;
  a.lastSylT = t; a.voiceUntil[free] = t + out.delayS[k] + dur; a.voiceGroup[free] = group ? 1 : 0;
  return true;
}

function pend(a: Attention, s: LifeSnapshot, out: LifeIntents, k: number): void {
  if (a.pN >= PEND) return;
  const p = a.pN++;
  a.pWho[p] = out.who[k]; a.pUntil[p] = s.t + P1_WAIT_S; a.pKind[p] = out.kind[k];
  a.pF[p * 8] = out.a[k]; a.pF[p * 8 + 1] = out.b[k]; a.pF[p * 8 + 2] = out.c[k]; a.pF[p * 8 + 3] = out.d[k]; a.pF[p * 8 + 4] = out.e[k];
  a.pF[p * 8 + 5] = out.prio[k]; a.pF[p * 8 + 6] = out.delayS[k]; a.pF[p * 8 + 7] = out.groupKey[k];
  a.pB[p * 5] = out.icon[k]; a.pB[p * 5 + 1] = out.style[k]; a.pB[p * 5 + 2] = out.dots[k];
}

function unpend(a: Attention, s: LifeSnapshot, out: LifeIntents): void {
  let w = 0;
  for (let p = 0; p < a.pN; p++) {
    if (a.pUntil[p] < s.t) continue; // dropped after 2 s
    if (out.n < out.kind.length) {
      const k = out.n++;
      out.kind[k] = a.pKind[p]; out.who[k] = a.pWho[p];
      out.a[k] = a.pF[p * 8]; out.b[k] = a.pF[p * 8 + 1]; out.c[k] = a.pF[p * 8 + 2]; out.d[k] = a.pF[p * 8 + 3]; out.e[k] = a.pF[p * 8 + 4];
      out.prio[k] = a.pF[p * 8 + 5]; out.delayS[k] = a.pF[p * 8 + 6]; out.groupKey[k] = a.pF[p * 8 + 7];
      out.icon[k] = a.pB[p * 5]; out.style[k] = a.pB[p * 5 + 1]; out.dots[k] = a.pB[p * 5 + 2];
      continue;
    }
    if (w !== p) {
      a.pWho[w] = a.pWho[p]; a.pUntil[w] = a.pUntil[p]; a.pKind[w] = a.pKind[p];
      for (let j = 0; j < 8; j++) a.pF[w * 8 + j] = a.pF[p * 8 + j];
      for (let j = 0; j < 5; j++) a.pB[w * 5 + j] = a.pB[p * 5 + j];
    }
    w++;
  }
  a.pN = w;
}

/** Drop (never queue: a P1 waits up to 2 s) the EMOTE and VOICE intents the caps of LIFE 10.1 have no room for, highest priority first;
 *  every other intent passes. Compacts `out` in place (the kept intents keep their order). Zero allocation. EMOTE `e` = the class (1 P1,
 *  2 P2, 3 P3); VOICE `d` = its syllable count, `e` its length (s), `b` = 1 for a piece group's voice. */
export function attentionFilter(a: Attention, s: LifeSnapshot, out: LifeIntents): void {
  const col = capColumn(s);
  refill(a, s, col);
  let touchNow = false;
  for (let i = 0; i < s.n; i++) if ((s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) { touchNow = true; break; }
  if (touchNow) a.touchUntil = s.t + DUCK_AFTER_S;
  const touching = touchNow || s.t < a.touchUntil;
  unpend(a, s, out);
  const n = out.n, keep = a.keep;
  // non-expressive intents pass; expressive ones are judged highest priority first
  let m = 0;
  for (let k = 0; k < n; k++) {
    const kd = out.kind[k];
    if (kd === INTENT.EMOTE || kd === INTENT.VOICE) { keep[k] = 0; a.order[m++] = k; } else keep[k] = 1;
  }
  for (let pass = 0; pass < m; pass++) {
    let best = -1, bp = -1e9;
    for (let j = 0; j < m; j++) { const k = a.order[j]; if (k >= 0 && out.prio[k] > bp) { bp = out.prio[k]; best = j; } }
    if (best < 0) break;
    const k = a.order[best]; a.order[best] = -1;
    const ok = out.kind[k] === INTENT.EMOTE ? emoteOk(a, s, out, k, col, touching) : voiceOk(a, s, out, k, col, touching);
    if (ok) { keep[k] = 1; a.granted++; }
    else { a.dropped++; if (out.e[k] === 1 && out.kind[k] === INTENT.EMOTE) pend(a, s, out, k); }
  }
  // free dots of wishes no longer shown (the owner gone or cleared) are LIFE's: it sends a clear (icon 0)
  let w = 0;
  for (let k = 0; k < n; k++) {
    if (!keep[k]) continue;
    if (w !== k) {
      out.kind[w] = out.kind[k]; out.who[w] = out.who[k]; out.delayS[w] = out.delayS[k];
      out.a[w] = out.a[k]; out.b[w] = out.b[k]; out.c[w] = out.c[k]; out.d[w] = out.d[k]; out.e[w] = out.e[k];
      out.icon[w] = out.icon[k]; out.style[w] = out.style[k]; out.prio[w] = out.prio[k]; out.groupKey[w] = out.groupKey[k]; out.dots[w] = out.dots[k];
    }
    w++;
  }
  out.n = w;
  a.t = s.t;
}

/** A budgeted `auto` land, bump or prop sound (10.1: 2 / 1 / 3 / 1.5 a second): true when it may play. Never a haptic, never a shake. */
export function attentionSound(a: Attention, s: LifeSnapshot): boolean {
  const col = capColumn(s), rate = CAPS.autoSounds[col];
  if (s.t > a.sndT) { a.sndTok = Math.min(rate, a.sndTok + (s.t - a.sndT) * rate); a.sndT = s.t; }
  if (a.sndTok < 1) return false;
  a.sndTok -= 1;
  return true;
}
/** How many of `n` autonomous effect particles may spawn now (10.1: 24 / 8 / 48 / 16 a second). */
export function attentionParticles(a: Attention, s: LifeSnapshot, n: number): number {
  const col = capColumn(s), rate = CAPS.particles[col];
  if (s.t > a.partT) { a.partTok = Math.min(rate, a.partTok + (s.t - a.partT) * rate); a.partT = s.t; }
  const g = Math.min(n, Math.floor(a.partTok));
  a.partTok -= g;
  return g;
}
