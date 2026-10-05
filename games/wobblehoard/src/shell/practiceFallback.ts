// TEMPORARY in-shell practice economy, so the capsule loop is playable before src/collection/index.ts lands.
// DELETE THIS FILE when the shell switches to the collection module (COLLECTION.md 3.2: on the client only src/collection/ghost.ts may call
// rollCapsule / rollMerge; probe_collection_imports.ts will enforce it). It is deliberately small and memory-only: it writes NO storage key
// (the v2 Hoard save belongs to the collection lane), so a reload starts a fresh practice meter.
//
// Rules it keeps (DESIGN 5.4 through core/meter.ts, COLLECTION 9.7 mapping, COLLECTION C-5 table cap):
//   poke -> poke; release with heldFor >= 0.4 s -> squeeze(heldFor); snap -> pull(intensity); at 5 unopened capsules touches are not paid.
import type { SoftEvent } from '../contracts.ts';
import { capsuleGenome, rollCapsule } from '../core/drops.ts';
import type { Interaction } from '../core/meter.ts';
import { addInteraction, createMeter, dailyStatus, DAY_MS, meterFill, PAY } from '../core/meter.ts';
import type { MeterState } from '../core/meter.ts';
import type { CapsuleOutcome, MeterReading, ShellCollection } from './collectionPort.ts';

export const TABLE_MAX = 5;

export interface FallbackOptions {
  /** random source in [0, 1) (default: crypto.getRandomValues) */
  random?: () => number;
  /** species already owned (the starter) */
  owned?: string[];
}

function cryptoRandom(): () => number {
  const buf = new Uint32Array(1);
  return () => {
    try { globalThis.crypto.getRandomValues(buf); return buf[0] / 4294967296; } catch { return Math.random(); }
  };
}

/** The DESIGN 5.4 SoftEvent -> Interaction mapping (the collection lane's meterfeed.ts owns the real one). */
export function interactionOf(ev: SoftEvent, tMs: number): Interaction | null {
  if (ev.kind === 'poke') return { kind: 'poke', amount: 0, tMs };
  if (ev.kind === 'release' && ev.heldFor >= PAY.minSqueezeHoldSeconds) return { kind: 'squeeze', amount: ev.heldFor, tMs };
  if (ev.kind === 'snap') return { kind: 'pull', amount: ev.intensity, tMs };
  return null;
}

export function createPracticeFallback(o: FallbackOptions = {}): ShellCollection {
  const random = o.random ?? cryptoRandom();
  let meter: MeterState = createMeter();
  let credits = 0;
  let lastT = 0;
  let seq = 0;
  const owned = new Map<string, number>();
  for (const s of o.owned ?? ['dollop']) owned.set(s, (owned.get(s) ?? 0) + 1);
  const listeners = new Set<() => void>();
  const changed = (): void => { for (const f of [...listeners]) { try { f(); } catch { /* a listener never breaks the meter */ } } };

  const reading = (): MeterReading => {
    const day = lastT > 0 ? Math.floor(lastT / DAY_MS) : 0;
    const st = dailyStatus(meter, day);
    return { fill: credits >= TABLE_MAX ? 1 : meterFill(meter), credits, resting: !st.hardStopped && st.rate < 1, doneToday: st.hardStopped, tableFull: credits >= TABLE_MAX, offline: false };
  };

  return {
    source: 'fallback',
    meter: reading,
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    feed(ev, tMs) {
      if (credits >= TABLE_MAX) return;              // COLLECTION C-5: a full table pauses accrual
      const t = Math.max(tMs, lastT);                 // never backwards (meter.ts refuses out-of-order times)
      const i = interactionOf(ev, t);
      if (!i) return;
      lastT = t;
      const before = meter.sp;
      const r = addInteraction(meter, i);
      meter = r.state;
      if (r.capsulesEarned > 0) credits = Math.min(TABLE_MAX, credits + r.capsulesEarned);
      if (r.capsulesEarned > 0 || meter.sp !== before) changed();
    },
    async openCapsule(): Promise<CapsuleOutcome> {
      if (credits <= 0) return { ok: false, error: 'no_capsule', message: 'That one fizzled. Keep squishing.' };
      credits--;
      const roll = rollCapsule(random);
      const genome = capsuleGenome(roll);
      const copies = (owned.get(roll.species) ?? 0) + 1;
      owned.set(roll.species, copies);
      changed();
      return { ok: true, itemId: `p-${(++seq).toString(36)}`, genome, tier: roll.tier, isNew: copies === 1, copies, nickname: null };
    },
    devGrant(n) {
      const k = Math.max(0, Math.min(TABLE_MAX - credits, Math.floor(n)));
      if (k > 0) { credits += k; changed(); }
    },
    devFill(target) {
      // the REAL meter path, accelerated: pokes 2 s apart on a clock running ahead of the wall clock (2 s keeps the valve open)
      const goal = Math.min(1, Math.max(0, target));
      const c0 = credits;
      for (let i = 0; i < 400 && credits === c0 && credits < TABLE_MAX && meterFill(meter) < goal; i++) {
        lastT = Math.max(lastT, Date.now()) + 2000;
        const r = addInteraction(meter, { kind: 'poke', amount: 0, tMs: lastT });
        meter = r.state;
        if (r.capsulesEarned > 0) credits = Math.min(TABLE_MAX, credits + r.capsulesEarned);
      }
      changed();
    },
  };
}
