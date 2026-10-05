// BLOCKTOOTH VS — PUBLIC TENDER life cycle. The engine lives in src/meta/tender.ts (lane B-WORLD: marker, spawn, hunt
// bookkeeping, payout / BID WITHDRAWN on top of the boss framework). B-VS owns the hook that drives it: vsBeginTick calls
// stepTenders once per tick, unbound. It reads only World.vs + VS.tender (the match clock = w.t - w.vs.startT).
export { stepTenders } from '../meta/tender.ts';
