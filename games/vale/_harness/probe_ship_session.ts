// VALE harness (lane W1-E, TECH-09): ShipSession.interrupt() against the real LocalSession: a running match ends with
// no result, no grants, no history entry and no rating change; the profile is saved; the session is idle and can
// queue again. Also pins the LocalSession internals ship_session.ts reaches (a rename fails here, not in the ship).
//   node _harness/probe_ship_session.ts
import { check, finish } from './fixtures/sim_fixture.ts';
import { PROBE_TIME_LIMIT, sessionCatalog, waitFor, probeBots } from './fixtures/session_fixture.ts';
import { ManualClock } from '../src/session/clock.ts';
import { ShipSession } from '../src/boot/ship_session.ts';
import { MemoryProfileStore } from '../src/session/profile_store.ts';
import type { DraftAction, DraftState, SessionEvent } from '../src/contracts/session.ts';

const cat = sessionCatalog({ timeLimit: PROBE_TIME_LIMIT });
const clock = new ManualClock();
const store = new MemoryProfileStore();
const events: SessionEvent[] = [];
const s = new ShipSession({ catalog: cat, store, clock, seed: 11, bots: probeBots });
s.on((e) => events.push(e));
const h = { session: s, clock, events, catalog: cat, store } as unknown as Parameters<typeof waitFor>[0];

check('interrupt with no match is a no-op (false)', s.interrupt() === false);
const internals = s as unknown as Record<string, unknown>;
check('LocalSession internals are where ship_session.ts expects them', ['_phase', 'pending', 'onlineFlow', 'netDraft', 'netSeat'].every((k) => k in internals) && typeof internals.teardownMatch === 'function' && typeof internals.persist === 'function');

// a practice (unranked) match and a ranked one: drive to 'match', interrupt, compare
function driver(): (st: DraftState) => DraftAction | null {
  let banned = false, fin = 0;
  return (st) => {
    const me = st.seats.find((x) => x.isYou);
    if (!me) return null;
    const turn = !!st.turn?.players.includes(me.player);
    if (st.phase === 'ban' && turn && !banned) { banned = true; return { a: 'ban', fighter: st.available[0] }; }
    if (st.phase === 'pick' && !me.locked) return !me.hover || !st.available.includes(me.hover) ? { a: 'hover', fighter: st.available[st.available.length - 1] } : turn ? { a: 'lock' } : null;
    if (st.phase === 'finalize' && me.locked && ++fin === 1) return null;
    return null;
  };
}
for (const q of ['fx_s_ranked', 'fx_s_standard']) {
  const before = s.profile();
  const drv = driver();
  s.on((e) => { if (e.type === 'draft') { const a = drv(e.state); if (a) s.draft(a); } if (e.type === 'queue' && e.state === 'found') s.acceptMatch(); if (e.type === 'loading' && e.progress >= 1) s.matchReady(); });
  const n0 = events.length;
  s.queue({ queue: q });
  const inMatch = waitFor(h, () => s.phase === 'match', 600_000);
  check(`${q}: reaches a running match`, inMatch, s.phase);
  if (!inMatch) continue;
  const m = s.currentMatch()!;
  m.pump(2);
  check(`${q}: interrupt() ends it`, s.interrupt() === true && s.phase === 'idle' && s.currentMatch() === null);
  const after = s.profile();
  check(`${q}: rating unchanged`, JSON.stringify(after.ratings) === JSON.stringify(before.ratings), after.ratings);
  check(`${q}: no history entry, wallet and xp unchanged`, after.history.length === before.history.length && JSON.stringify(after.wallet) === JSON.stringify(before.wallet) && after.xp === before.xp && after.level === before.level);
  check(`${q}: no post-game was emitted`, !events.slice(n0).some((e) => e.type === 'postgame'));
  const saved = JSON.parse(store.raw()!);
  check(`${q}: the profile was saved`, saved.identity.id === after.identity.id && saved.history.length === after.history.length);
  check(`${q}: the dead host is gone (a second interrupt is false)`, s.interrupt() === false);
}
s.queue({ queue: 'fx_s_quick', preset: { fighter: cat.fighters[0].id } } as never);
check('the session can queue again afterwards (no "busy" error)', !events.some((e) => e.type === 'error' && /busy/.test(e.message)));
finish('probe_ship_session');
