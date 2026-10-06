// The merge odds digest now lives in src/core/oddsDigest.ts (MERGE M-7: shared verbatim with the server host). Re-exported here so
// collection code and probes keep one import path.
export { ODDS_DIGEST_PREFIX, oddsDigest, oddsDigestText } from '../core/oddsDigest.ts';
