// DYEFIELD — window.__NET__ (CONTRACT_ONLINE §O12.2 "testsurface additions as window.__NET__"). Browser only; installed by
// main.ts when the online module loads (lazy, so the offline page has no __NET__). Read-backs for _harness/netplay.py and
// the dev hooks the test plan names: dropSocket (B3 reconnect), forceHandoff (H graceful migration).

import type { NetApi } from './api.ts';

export interface NetSurface {
  /** OnlineApi.status() */
  status(): unknown;
  /** the session / host / client / transport counters (desyncs, keyframes, migrations, prediction error p50 / p95, RTT,
   *  frames sent, intent rates, painter hash, result) */
  stats(): Record<string, unknown>;
  /** OnlineApi.hud() */
  hud(): unknown;
  /** drop the room socket as a network failure would (it reconnects with its token) */
  dropSocket(): void;
  /** the host hands off as if its page went hidden (SNAP + HANDOFF + handoff) */
  forceHandoff(): void;
  /** restart the prediction-error measurement window (after the warm-up hitches) */
  markSteady(): void;
  /** the API itself (dev consoles) */
  readonly api: NetApi;
}

declare global {
  interface Window { __NET__?: NetSurface }
}

export function installNetSurface(api: NetApi): NetSurface {
  const s: NetSurface = {
    status: () => api.status(),
    stats: () => api.stats(),
    hud: () => api.hud(),
    dropSocket: () => api.dropSocket(),
    forceHandoff: () => api.forceHandoff(),
    markSteady: () => api.markSteady(),
    api,
  };
  window.__NET__ = s;
  return s;
}
