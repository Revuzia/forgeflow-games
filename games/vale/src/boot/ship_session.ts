// VALE boot — the session the shipped client runs (W1-E, TECH-09). A LocalSession that can also END a match that the
// engine could not carry on: `interrupt()` drops the host, leaves the phase idle and saves the profile, and books
// nothing: no result, no grants, no rating (a forfeit through leave() would book a loss).
//
// It reaches LocalSession's internals (phase, host, pending, persist) because session/local_session.ts is not this lane's:
// _harness/probe_ship_session.ts pins that coupling against the real class, so a rename there fails a probe rather than
// the ship. When the session lane next opens local_session.ts this method belongs inside it, next to teardownMatch().
import { LocalSession } from '../session/local_session.ts';

interface Internals {
  _phase: string;
  pending: unknown;
  onlineFlow: boolean;
  netDraft: unknown;
  netSeat: unknown;
  teardownMatch(): void;
  persist(): void;
}

export class ShipSession extends LocalSession {
  /** true when a match (or its loading) was running and is now over without a result */
  interrupt(): boolean {
    const me = this as unknown as Internals;
    if (me._phase !== 'match' && me._phase !== 'loading') return false;
    try { me.teardownMatch(); } catch { /* the host may be the thing that broke */ }
    me.onlineFlow = false;
    me.netDraft = null;
    me.netSeat = null;
    me.pending = null;
    me._phase = 'idle';
    me.persist();
    return true;
  }
}
