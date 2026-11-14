/**
 * CRESTBOUND — runtime/data/index.js
 * CONTRACT §29. The course registry: four REALMS, thirteen COURSES, THE KEEP.
 * ---------------------------------------------------------------------------
 * Pure data plus a lazy loader. Nothing here touches Three.js or the DOM, so it is
 * safe to import from the UI, the harnesses (`reachcheck.mjs`, `loopcheck.py`)
 * and plain Node. Every course module — the Keep included — is reached through
 * `getCourse(id)`, a dynamic import behind a cache, so importing this file never
 * pulls a single course into the module graph (contract hard rule 6: side-effect
 * free at import). That is also what lets `modulecheck.mjs` link this module
 * before any course file exists.
 *
 * Exports (contract §29): REALMS, COURSE_META, KEEP_ID, getCourse(id).
 * Conveniences for the Keep, the UI and the validators (all derived, nothing
 * duplicated): ALL_COURSE_IDS, COURSE_COUNT, CREST_TOTAL, realmOf(courseId),
 * getRealm(realmId), courseIndex(id), isCourseId(id), prefetchCourse(id),
 * clearCourseCache().
 *
 * Naming law (contract header): never Nintendo names — hero NIM, collectible
 * CREST, marked coins SIGILS, hub THE KEEP, realms VERDANT BAILEY · EMBER FOUNDRY
 * · RIME SPIRE · AZURE SANCTUM.
 *
 * ---------------------------------------------------------------------------
 * COURSE AUTHORING RULES — bind every file in runtime/data/courses/ (contract §25)
 * ---------------------------------------------------------------------------
 *  1. OPEN DIORAMA. Courses are not linear corridors; `bounds` is authoritative for
 *     culling and the minimap. Multiple routes, verticality, a secret, a set-piece.
 *  2. REACH. A REQUIRED path uses only single-jump-safe gaps (REACH_TABLE in
 *     core/tuning.js) unless the approach gives the run-up the move needs.
 *     `_harness/reachcheck.mjs` fails the build on a violation.
 *  3. CONTENT. ≥ 3 checkpoints, 8 sigils, ≥ 100 coins, 7 crests; non-tutorial
 *     courses use ≥ 6 hazard/critter families.
 *  4. READABILITY. Every landable surface a jump reaches is `stripe:true`;
 *     decorative geometry is never mistakable for a platform.
 *  5. YAW. Radians; yaw 0 faces −Z, +yaw counter-clockwise from above. One
 *     conversion, `headingFromYaw` in core/util.js.
 */

/* -------------------------------------------------------------------------- */
/* REALMS                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ordered progression. `courses` are course ids in play order and MUST match the
 * filenames under ./courses/ and the keys of COURSE_LOADERS below.
 *
 * `accent` is the realm's signature colour (hex number) — the Keep tints each
 * painting frame, the course card and the HUD with it. Deliberately duplicated
 * from the theme palette so pure-data consumers never import the Three.js-flavoured
 * themes module.
 */
export const REALMS = [
  {
    id: 'verdant',
    name: 'VERDANT BAILEY',
    subtitle: 'Meadows, ramparts and a very old windmill',
    theme: 'verdant',
    accent: 0x8ee06a,
    blurb: 'Sunlit hills around a tumbledown fort. Learn to move, then learn to fly.',
    courses: ['verdant-1', 'verdant-2', 'verdant-3'],
  },
  {
    id: 'ember',
    name: 'EMBER FOUNDRY',
    subtitle: 'Magma, pistons and a buried sun',
    theme: 'ember',
    accent: 0xff8a3c,
    blurb: 'The machines still run and the floor is still molten.',
    courses: ['ember-1', 'ember-2', 'ember-3', 'ember-4'],
  },
  {
    id: 'rime',
    name: 'RIME SPIRE',
    subtitle: 'Snow, ice and a mountain that leans',
    theme: 'rime',
    accent: 0xa8e4ff,
    blurb: 'Nothing here holds still, least of all your footing.',
    courses: ['rime-1', 'rime-2', 'rime-3'],
  },
  {
    id: 'azure',
    name: 'AZURE SANCTUM',
    subtitle: 'Tide, clockwork and the colour of the sky',
    theme: 'azure',
    accent: 0x6ec0ff,
    blurb: 'Everything the Keep taught you, asked for all at once.',
    courses: ['azure-1', 'azure-2', 'azure-3'],
  },
];

/** The hub. Theme id `keep`; loaded through getCourse(KEEP_ID) from ./keep.js. */
export const KEEP_ID = 'keep';

/* -------------------------------------------------------------------------- */
/* COURSE META — static, for the Keep and the UI without loading course modules */
/* -------------------------------------------------------------------------- */

/**
 * `gateCrests` is the crest TOTAL (Save.crestTotal()) the Keep gate for that
 * course requires. The Keep authors its gates' `requires.crests` from this table
 * (contract §26), and Save.unlockedGates() reads the same numbers, so the sign on
 * the door, the card and the unlock cinematic never disagree.
 *
 * Progression: 13 courses × 7 crests = 91 crests. The gate totals and the
 * difficulty ramp are the COURSES.md brief's, verbatim: 0 / 1 / 3 / 5 / 8 / 12
 * / 15 / 18 / 22 / 26 / 30 / 35 / 40, with the Keep's CRESTWAY seal at 60
 * (keep.js authors the same numbers; drift between the two was fixed
 * 2026-09-04). `difficulty` is 1..10.
 */
export const COURSE_META = {
  'verdant-1': {
    realm: 'verdant', theme: 'verdant', order: 1,
    name: 'BAILEY MEADOW', subtitle: 'Open hills and a fort with a hole in it',
    difficulty: 1, gateCrests: 0,
    hook: 'Hills, a chained Gnasher and a fort interior — the tutorial that never says so.',
  },
  'verdant-2': {
    realm: 'verdant', theme: 'verdant', order: 2,
    name: 'GNASHER FORT', subtitle: 'Precision over the ramparts',
    difficulty: 2, gateCrests: 1,
    hook: 'Fortress precision: moving geometry, narrow walks, and the Gnasher wants its post back.',
  },
  'verdant-3': {
    realm: 'verdant', theme: 'verdant', order: 3,
    name: 'WINDMILL HEIGHTS', subtitle: 'Sails, platforms and the first race',
    difficulty: 3, gateCrests: 3,
    hook: 'Ride the mill arms up, chain moving platforms across, then beat the clock.',
  },
  'ember-1': {
    realm: 'ember', theme: 'ember', order: 1,
    name: 'MAGMA WORKS', subtitle: 'Catwalks over a molten floor',
    difficulty: 4, gateCrests: 5,
    hook: 'Lava below, sinking platforms ahead, catwalks that do not care whether you make it.',
  },
  'ember-2': {
    realm: 'ember', theme: 'ember', order: 2,
    name: 'PISTON HALLS', subtitle: 'Crushers, pistons and conveyors',
    difficulty: 5, gateCrests: 8,
    hook: 'Everything in the halls moves on a beat; learn the beat or learn the ceiling.',
  },
  'ember-3': {
    realm: 'ember', theme: 'ember', order: 3,
    name: 'CINDER CHASE', subtitle: 'Rising lava, rotating bars, a cannon',
    difficulty: 6, gateCrests: 12,
    hook: 'The lava is climbing and the only way up is a cannon you have to aim yourself.',
  },
  'ember-4': {
    realm: 'ember', theme: 'ember', order: 4,
    name: 'SUNSCAR NECROPOLIS', subtitle: 'A pyramid drowned in sand',
    difficulty: 6, gateCrests: 15,
    hook: 'Desert pyramid, quicksand, a sandboard run and a cannon into the tomb.',
  },
  'rime-1': {
    realm: 'rime', theme: 'rime', order: 1,
    name: 'FROST COTTAGE', subtitle: 'Snow slopes and a frozen pond',
    difficulty: 5, gateCrests: 18,
    hook: 'Slope slides, ice underfoot and a cottage roof that is the only warm thing for miles.',
  },
  'rime-2': {
    realm: 'rime', theme: 'rime', order: 2,
    name: 'GLACIER SLIDE', subtitle: 'The long ice race',
    difficulty: 6, gateCrests: 22,
    hook: 'One glacier, one timer, no brakes — the slide race the whole realm is named for.',
  },
  'rime-3': {
    realm: 'rime', theme: 'rime', order: 3,
    name: 'BLIZZARD PEAK', subtitle: 'Pendulums, mills and the Warden',
    difficulty: 7, gateCrests: 26,
    hook: 'A mountain of pendulums and mills, and a Warden waiting at the summit.',
  },
  'azure-1': {
    realm: 'azure', theme: 'azure', order: 1,
    name: 'TIDEWELL TEMPLE', subtitle: 'Swim tunnels and currents',
    difficulty: 7, gateCrests: 30,
    hook: 'Flooded temple: swim the tunnels, ride the currents, surface before the timer does.',
  },
  'azure-2': {
    realm: 'azure', theme: 'azure', order: 2,
    name: 'GEARHEART TOWER', subtitle: 'Clockwork rooms that turn',
    difficulty: 8, gateCrests: 35,
    hook: 'Rotating rooms, seesaws and beams inside a tower that is itself a clock.',
  },
  'azure-3': {
    realm: 'azure', theme: 'azure', order: 3,
    name: 'PRISM RIDE', subtitle: 'Sky rails and the rainbow gauntlet',
    difficulty: 10, gateCrests: 40,
    hook: 'Sky rails, wing rings and air currents into a finale that combines every family at once.',
  },
};

/* -------------------------------------------------------------------------- */
/* DERIVED INDEX                                                               */
/* -------------------------------------------------------------------------- */

/** Every course id in play order (realm by realm). Does not include the Keep. */
export const ALL_COURSE_IDS = REALMS.flatMap((r) => r.courses);

/** Total courses (13). The Keep is never "cleared" and is not counted. */
export const COURSE_COUNT = ALL_COURSE_IDS.length;

/** Crests per course (contract: 7) and the grand total (91). */
export const CRESTS_PER_COURSE = 7;
export const CREST_TOTAL = COURSE_COUNT * CRESTS_PER_COURSE;

/** Sigils per course (8 → 1 crest) and coins per course (100 → 1 crest). */
export const SIGILS_PER_COURSE = 8;
export const COINS_FOR_CREST = 100;

const REALM_BY_ID = new Map(REALMS.map((r) => [r.id, r]));

const COURSE_POS = new Map();
for (const r of REALMS) {
  for (let i = 0; i < r.courses.length; i++) COURSE_POS.set(r.courses[i], { realmId: r.id, idx: i });
}

/* Referential integrity is a gate, not a hope (doctrine §4): every course id in
   REALMS has meta, every meta entry is in a realm, and the meta's realm agrees. */
for (const id of ALL_COURSE_IDS) {
  const m = COURSE_META[id];
  if (!m) throw new Error(`[data] course "${id}" is listed in REALMS but has no COURSE_META entry`);
  if (m.realm !== COURSE_POS.get(id).realmId) {
    throw new Error(`[data] COURSE_META["${id}"].realm is "${m.realm}" but REALMS puts it in "${COURSE_POS.get(id).realmId}"`);
  }
}
for (const id of Object.keys(COURSE_META)) {
  if (!COURSE_POS.has(id)) throw new Error(`[data] COURSE_META has "${id}" but no realm lists it`);
}

/** Realm def by id, or null. */
export function getRealm(realmId) {
  return REALM_BY_ID.get(realmId) || null;
}

/** Realm def that owns a course id, or null (null for the Keep). */
export function realmOf(courseId) {
  const pos = COURSE_POS.get(courseId);
  return pos ? REALM_BY_ID.get(pos.realmId) : null;
}

/** True if `id` is a known course id or the Keep. Cheap guard for ?course= links. */
export function isCourseId(id) {
  return id === KEEP_ID || COURSE_POS.has(id);
}

/**
 * Where a course sits in the game.
 * @returns {{realm:string, realmDef:object, realmIndex:number, idx:number, globalIdx:number,
 *            count:number, next:string|null, prev:string|null, nextInRealm:string|null,
 *            prevInRealm:string|null, isFirstOfRealm:boolean, isLastOfRealm:boolean,
 *            meta:object}|null}
 */
export function courseIndex(id) {
  const pos = COURSE_POS.get(id);
  if (!pos) return null;
  const realmDef = REALM_BY_ID.get(pos.realmId);
  const realmIndex = REALMS.indexOf(realmDef);
  const globalIdx = ALL_COURSE_IDS.indexOf(id);
  const isFirstOfRealm = pos.idx === 0;
  const isLastOfRealm = pos.idx === realmDef.courses.length - 1;
  return {
    realm: pos.realmId,
    realmDef,
    realmIndex,
    idx: pos.idx,
    globalIdx,
    count: realmDef.courses.length,
    next: globalIdx < COURSE_COUNT - 1 ? ALL_COURSE_IDS[globalIdx + 1] : null,
    prev: globalIdx > 0 ? ALL_COURSE_IDS[globalIdx - 1] : null,
    nextInRealm: isLastOfRealm ? null : realmDef.courses[pos.idx + 1],
    prevInRealm: isFirstOfRealm ? null : realmDef.courses[pos.idx - 1],
    isFirstOfRealm,
    isLastOfRealm,
    meta: COURSE_META[id],
  };
}

/** Course ids whose gate opens at or below a crest total, in play order. */
export function coursesUnlockedAt(crestTotal) {
  const n = crestTotal | 0;
  return ALL_COURSE_IDS.filter((id) => COURSE_META[id].gateCrests <= n);
}

/* -------------------------------------------------------------------------- */
/* LOADER                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Static specifier map — one literal entry per course file so the browser (and any
 * future bundler) resolves them with no build step. Adding a course means adding a
 * file, a line here, an id in REALMS and a COURSE_META entry (the integrity check
 * above catches a missing one at import time).
 */
const COURSE_LOADERS = {
  [KEEP_ID]: () => import('./keep.js'),
  'verdant-1': () => import('./courses/verdant-1.js'),
  'verdant-2': () => import('./courses/verdant-2.js'),
  'verdant-3': () => import('./courses/verdant-3.js'),
  'ember-1': () => import('./courses/ember-1.js'),
  'ember-2': () => import('./courses/ember-2.js'),
  'ember-3': () => import('./courses/ember-3.js'),
  'ember-4': () => import('./courses/ember-4.js'),
  'rime-1': () => import('./courses/rime-1.js'),
  'rime-2': () => import('./courses/rime-2.js'),
  'rime-3': () => import('./courses/rime-3.js'),
  'azure-1': () => import('./courses/azure-1.js'),
  'azure-2': () => import('./courses/azure-2.js'),
  'azure-3': () => import('./courses/azure-3.js'),
};

/** Resolved defs, so re-entering a course costs nothing. */
const COURSE_CACHE = new Map();

/** In-flight promises, so two simultaneous loads share one request. */
const COURSE_PENDING = new Map();

/**
 * Load a course definition ('keep' → ./keep.js, otherwise ./courses/<id>.js).
 * Resolves to the plain def object (the module's default export), never the
 * module namespace. The def is stamped with its registry meta (`realm`, `theme`,
 * `name`, `subtitle`, `difficulty`, `order`) wherever the file left a field blank,
 * so every consumer sees one complete record.
 *
 * @param {string} id
 * @returns {Promise<object>}
 * @throws if the id is unknown, the file fails to parse, or it declares another id
 */
export async function getCourse(id) {
  const cached = COURSE_CACHE.get(id);
  if (cached) return cached;

  const pending = COURSE_PENDING.get(id);
  if (pending) return pending;

  const loader = COURSE_LOADERS[id];
  if (!loader) {
    throw new Error(`[data] unknown course id "${id}". Known: ${Object.keys(COURSE_LOADERS).join(', ')}`);
  }

  const p = loader()
    .then((mod) => {
      const def = mod && mod.default;
      if (!def || typeof def !== 'object') throw new Error(`[data] course "${id}" has no default export`);
      if (def.id !== undefined && def.id !== id) {
        throw new Error(`[data] course file for "${id}" declares id "${def.id}"`);
      }
      if (def.id === undefined) def.id = id;
      if (id === KEEP_ID) {
        if (def.isHub === undefined) def.isHub = true;
        if (!def.theme) def.theme = 'keep';
        if (!def.name) def.name = 'THE KEEP';
      } else {
        const m = COURSE_META[id];
        if (!def.realm) def.realm = m.realm;
        if (!def.theme) def.theme = m.theme;
        if (!def.name) def.name = m.name;
        if (!def.subtitle) def.subtitle = m.subtitle;
        if (typeof def.difficulty !== 'number') def.difficulty = m.difficulty;
        if (typeof def.order !== 'number') def.order = m.order;
        if (typeof def.gateCrests !== 'number') def.gateCrests = m.gateCrests;
      }
      COURSE_CACHE.set(id, def);
      COURSE_PENDING.delete(id);
      return def;
    })
    .catch((err) => {
      COURSE_PENDING.delete(id);
      throw err;
    });

  COURSE_PENDING.set(id, p);
  return p;
}

/** Warm the cache for a course without using it (call while a transition plays). */
export function prefetchCourse(id) {
  if (!COURSE_CACHE.has(id) && COURSE_LOADERS[id]) getCourse(id).catch(() => {});
}

/** Drop cached defs (dev harness hot-reload). */
export function clearCourseCache() {
  COURSE_CACHE.clear();
}

export default {
  REALMS, COURSE_META, KEEP_ID, ALL_COURSE_IDS, COURSE_COUNT, CREST_TOTAL,
  getCourse, getRealm, realmOf, isCourseId, courseIndex, coursesUnlockedAt, prefetchCourse,
};
