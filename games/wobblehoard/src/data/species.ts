// WOBBLEHOARD species registry: the append-only list of species ids. A LEAF module (it imports nothing), so both src/core/genome.ts
// (which writes the idx byte into share strings) and src/data/catalog.ts (which holds the species data) can import it without an
// import cycle between them. Everything else should keep importing SPECIES / SpeciesId from catalog.ts or genome.ts (both re-export it).
//
// ═══════════════════════════════════ IDX STABILITY: APPEND-ONLY, FOREVER ═══════════════════════════════════
// A species' position in SPECIES (== its `idx`) is written into every share string (one byte), every save and, later, every server row.
//   1. NEVER reorder, delete or reuse an entry. A species that must disappear stays here with its idx.
//   2. New species are APPENDED at the end (idx = previous length, max MAX_SPECIES_IDX), in any tier, together with their CATALOG entry.
//   3. The id (slug) of an existing entry is frozen once anything outside this repository stores it (a save, a server row, a trade).
//      The one pre-release exception (2026-10, before any save or server row held a catalog species): idx 20 and idx 36 were given new
//      slugs and names by the language-safety review (see _harness/probe_catalog.ts section 7). Their idx bytes did not change, so every
//      share string ever written still decodes to the same species. After launch a rename needs a legacy-id alias in getSpecies().
//   4. _harness/probe_catalog.ts holds a locked copy of this list (IDX_LOCK) and pins a few share strings byte for byte.

/** Species ids in IDX ORDER. APPEND ONLY. Position = idx = the byte stored in share strings. */
export const SPECIES = [
  // common (0..13)
  'dollop', 'plumpet', 'twangle', 'puddlo', 'glubbin', 'crumbit', 'chunkle', 'munchip', 'wisplet', 'cushlet', 'crimpo', 'thumbly', 'sproink', 'dimpla',
  // uncommon (14..24)
  'nuzzo', 'flickum', 'swishel', 'granulo', 'peakum', 'wrigglo', 'acornel', 'capnap', 'knubby', 'kneadle', 'hooplet',
  // rare (25..34)
  'spirelo', 'zingle', 'petalop', 'burrbin', 'marigel', 'gloopsy', 'hushpuff', 'drowsel', 'thudge', 'diademo',
  // epic (35..41)
  'taffelin', 'rattlebead', 'cindergoo', 'selenuff', 'pastrel', 'flipdome', 'caromel',
  // legendary (42..46)
  'ambrosel', 'tidelume', 'glimglop', 'somnuff', 'fossilo',
  // mythic (47..49)
  'skeinara', 'constello', 'prismelo',
] as const;
export type SpeciesId = (typeof SPECIES)[number];
export const SPECIES_COUNT = SPECIES.length;
/** Highest idx a share string can carry (one byte). */
export const MAX_SPECIES_IDX = 255;
