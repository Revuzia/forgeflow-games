// The merge odds digest (_spec/MERGE.md M-1, M-7): a short summary of EXACTLY what a merge preview showed (the cost, the input species,
// the effective tier-up chance and why, and every candidate with its NEW tag and its probability to 1e-9). The merge request carries it;
// if the odds computed at merge time differ (another tab, a trade or a merge changed ownership or pity), the merge is refused with
// 'odds_changed' and the fresh preview, and nothing is consumed. It is a staleness check, not a security feature.
//
// Lives in src/core (MERGE M-7) so the server host can import it verbatim with the rest of core; pure, imports only core.
import { hashString } from './rng.ts';
import type { MergePreviewOk } from './merge.ts';

export const ODDS_DIGEST_PREFIX = 'od1.';

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/** The canonical text the digest hashes (exported for probes and for the server's audit log). */
export function oddsDigestText(p: MergePreviewOk): string {
  let s = `${p.cost}|${p.inputSpecies}|${p.basis}|${p.tierUpChance.toFixed(9)}`;
  for (const o of p.outcomes) s += `|${o.species}:${o.isNew ? 'n' : 'o'}:${o.probability.toFixed(9)}`;
  return s;
}

/** 'od1.' + 16 hex characters (two FNV-1a hashes of the canonical text). Deterministic on every machine. */
export function oddsDigest(p: MergePreviewOk): string {
  const s = oddsDigestText(p);
  return ODDS_DIGEST_PREFIX + hex8(hashString(s)) + hex8(hashString('#' + s));
}
