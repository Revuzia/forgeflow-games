// BLOCKTOOTH v2 — the persistent profile's shape guard (FEATURES_V2 §8.3). APP-PURE: DOM-free and
// storage-free (core/save.ts does the storage).
//
// ── L0 SKELETON STUB ── exact exports of `ModProfile`; lane L5 fills sanitizeProfile (field-by-field
// coercion). The stub accepts nothing from storage: every load is an empty profile.

import type { Profile } from '../core/types.ts';

export function emptyProfile(): Profile {
  return {
    v: 1,
    done: {},
    best: {},
    life: {
      runs: 0, clears: 0, banishes: 0, evolutions: 0,
      clearedBy: { molo: [], voltkite: [], hearthback: [], briarwick: [] },
      bossKills: {},
    },
    perk: null,
    palette: { molo: 0, voltkite: 0, hearthback: 0, briarwick: 0 },
    cineSeen: {},
    newUnlocks: [],
  };
}

/** STUB: always a fresh empty profile (L5 coerces the stored blob field by field). */
export function sanitizeProfile(_v: unknown): Profile {
  return emptyProfile();
}
