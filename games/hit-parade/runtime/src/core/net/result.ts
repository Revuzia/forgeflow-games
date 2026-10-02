// HIT PARADE - core/net/result.ts (lane NET). The RESULT a peer reports for an online match (NETCODE 3.6 / 3.9).
// THREE-free, DOM-free, clock-free: shared by net/online_flow.ts (the browser) and _harness/probe_netsim.ts (node), so the
// probe exercises the exact rule the game ships.
//
// CHANGED(wf7 online) (evidence: _harness/_reports/progress_wf7_online.md): both peers report {winner, frame, csFrame, cs}; the match is AGREED when every field
// matches and cs is not null. `frame` = the MATCH_END event's own frame E (deterministic), csFrame = the newest checksum
// frame <= E, cs = this peer's FINAL checksum of state[csFrame]. The flow asks between two session ticks (after the render
// that drained MATCH_END, then every 250 ms); rollback.ts guarantees that between ticks checksumAt(f) answers for every
// checksum frame f <= confirmedFrame(), so the result is ready on the first ask once confirmedFrame() >= E. (P1-WF6 sent
// whatever checksumAt returned at that moment: null for E % 15 == 0 and, a tick earlier, for E % 15 == 1.)

import { CHECKSUM_EVERY } from './sync.ts';

/** what readyResult needs from a RollbackSession */
export interface ResultSession {
  confirmedFrame(): number;
  checksumAt(f: number): number | null;
}

export interface MatchResultMsg { winner: number; frame: number; csFrame: number; cs: number | null }

/**
 * Defensive only: with the session invariant the checksum is there on the first ask. Should it ever be missing (a desync
 * snapshot that jumped over csFrame on the guest), the result still goes out - with cs null, i.e. UNRATED - once the
 * session is this many frames past E, instead of holding the results card for the 10 s result timeout.
 */
export const RESULT_CS_GRACE = 2 * CHECKSUM_EVERY;

/** the checksum frame a result for MATCH_END frame `endFrame` carries */
export function resultChecksumFrame(endFrame: number, every = CHECKSUM_EVERY): number {
  return Math.floor(endFrame / every) * every;
}

/** The result for a match whose MATCH_END fired at `endFrame`, or null while it is not final on this peer yet. */
export function readyResult(s: ResultSession, endFrame: number, winner: number, every = CHECKSUM_EVERY): MatchResultMsg | null {
  const confirmed = s.confirmedFrame();
  if (confirmed < endFrame) return null;
  const csFrame = resultChecksumFrame(endFrame, every);
  const cs = s.checksumAt(csFrame);
  if (cs === null && confirmed < endFrame + RESULT_CS_GRACE) return null;
  return { winner, frame: endFrame, csFrame, cs };
}
