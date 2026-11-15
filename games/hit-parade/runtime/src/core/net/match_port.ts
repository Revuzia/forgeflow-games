// HIT PARADE - core/net/match_port.ts (lane NET). Adapts a core/sim Match (CONTRACT §4.1) to the
// structural SimPort the rollback session drives (CONTRACT §19.1). The only core/net file that imports
// the sim, so the session and the probes stay testable against the toy sim.

import { checksum, load, save, step, type Match } from '../sim/match.ts';
import type { SimPort } from './rollback.ts';

export function matchPort(m: Match): SimPort {
  return {
    stateInts: m.s.length,
    step: (in1: number, in2: number) => step(m, in1, in2),
    save: (slot: Int32Array) => save(m, slot),
    load: (slot: Int32Array) => load(m, slot),
    checksum: () => checksum(m) | 0,           // signed int32 everywhere in core/net (the sim may return u32)
  };
}
