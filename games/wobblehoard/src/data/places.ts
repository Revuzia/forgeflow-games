// PLAYGROUND world data: the place and thing id tables, the mechanism and zone library ids, the shared PlaceDef types, PLACE_INFO, THING_KINDS,
// MECH_RANGES and loadPlaceDef (specs: _spec/PLACES.md, _spec/PLAYGROUND_BUILD.md 6). Owned by the DATA lane (PG_DATA).
//
// LOADING (D-69): this module ships in the post-play LIFE CHUNK with life.ts, quests.ts and place_home.ts. Each other place's PlaceDef is its own
// lazy module src/data/place_<id>.ts (flat in src/data, probe_genome lists it non-recursively), loaded with its place through loadPlaceDef(id).
// journal_text.ts is never imported from here. Every id list is APPEND-ONLY (its index is saved): DT-14 freezes them in a lock list.
// Pure data: no DOM, no three, no clock. Relative imports end in .ts; `as const` objects, no enums (erasableSyntaxOnly).

/* ───────────────────────────── ids (append-only: idx is saved) ───────────────────────────── */

export const PLACE_IDS = ['home', 'hearthlog', 'ripple', 'frostbell', 'rainleaf', 'fizzwell', 'cogwhistle', 'lanternroof', 'echohollow', 'cloudloft'] as const;
export const THING_IDS = ['feltball', 'musicbox', 'snoozerug', 'warmlamp', 'keepsakeshelf', 'bouncepad',              // Home 0..5
  'hearth', 'rockerboard', 'yarnball', 'pillowswing', 'snugbasket', 'kettle',                                           // Hearthlog 6..11
  'rockpool', 'bobring', 'driftlog', 'shellchimes', 'pebbleball', 'sandmound',                                          // Ripple 12..17
  'icepond', 'glideramp', 'steampool', 'iciclebells', 'snowdriftnest', 'snowball', 'shakepine',                         // Frostbell 18..24
  'splashspots', 'leafteeter', 'mossbouncer', 'dripleaf', 'steppingstones', 'seedpod',                                  // Rainleaf 25..30
  'bathwater', 'tap', 'swirlride', 'soapslide', 'spongeraft', 'bubblepatch',                                           // Fizzwell 31..36
  'spinningcog', 'windupkey', 'springplate', 'magnet', 'steelmarble', 'tickclock', 'littlebell',                       // Cogwhistle 37..43
  'lanternline', 'vanedisc', 'hammock', 'chimneycorner', 'moondish', 'starscope',                                      // Lanternroof 44..49
  'crystals', 'glowpool', 'stoneslide', 'mossbed', 'echostone', 'humrock',                                             // Echo Hollow 50..55
  'puffpads', 'updraft', 'kiteswing', 'sunbowarch', 'cloudnest', 'cloudball'] as const;                                // Cloudloft 56..61
export type PlaceId = (typeof PLACE_IDS)[number];
export type ThingId = (typeof THING_IDS)[number];

/** The 14 mechanisms (PLACES 2.1). 0 = a patch or zone thing with no collider (the Ice Pond, the Updraft, the Snooze Rug). */
export const MECH = { block: 1, bar: 2, mound: 3, ring: 4, ramp: 5, pool: 6, seesaw: 7, swing: 8, turntable: 9, chime: 10, pad: 11, floater: 12, ball: 13, switch: 14 } as const;
/** The 9 zone kinds (PLACES 2.2). Physics zones: water, current, wind, updraft, magnet. Flag zones: warm, cold, wet, echo. */
export const ZONE = { water: 1, current: 2, wind: 3, updraft: 4, magnet: 5, warm: 6, cold: 7, wet: 8, echo: 9 } as const;
/** Ground marks (PLACES 2.2; StageLike.stampMark). */
export const MARK = { print: 1, trail: 2, dust: 3, dent: 4, glow: 5 } as const;
/** A thing's sound kind (SquishAudio.prop). */
export const PROP_SOUND = { ball: 1, creak: 2, chime: 3, splash: 4, crunch: 5, crackle: 6, boing: 7, bell: 8, tick: 9, kettle: 10, rustle: 11, whoosh: 12 } as const;
