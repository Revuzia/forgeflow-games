/**
 * ASCENDANT — WORLD REGISTRY
 * runtime/data/index.js
 *
 * The single index of every playable place in the game: the four worlds, the twelve
 * stages inside them, and the HUB. Nothing here touches Three.js — this module is pure
 * data plus a lazy loader, so it is safe to import from the UI, the harness or Node.
 *
 * CONTRACT §22. Exports: WORLDS, HUB, getStage(id), stageIndex(id), STAGE_COUNT.
 *
 * THERE IS NO GLOBAL STAGE NUMBERING HERE, deliberately. A WORLD holds three
 * STAGES; a CHECKPOINT is a waypoint inside a stage and is never numbered as
 * one. The old obby-convention helpers (loadStageNumbering / stageNumbering /
 * globalStageOf / worldStageRange) counted every checkpoint as a stage and made
 * Neon Dojo look like 21 levels; they are deleted, not orphaned.
 *
 * ---------------------------------------------------------------------------------
 * STAGE AUTHORING RULES  —  these bind EVERY stage file in runtime/data/stages/.
 * ---------------------------------------------------------------------------------
 *
 * 1. AXIS.        A stage runs along +X. Start at x = 0 (the spawn deck may hang back
 *                 to negative X). Height climbs with +Y. Lateral play is on Z, centred
 *                 on z = 0. The progress bar, the minimap and the camera framing all
 *                 assume this. Never build a stage that runs along Z.
 *
 * 2. LENGTH.      A full stage is 180–320 m of travel containing 45–90 distinct
 *                 obstacles. A first-of-world tutorial stage may be shorter and
 *                 sparser (neon-1 is ~185 m / 44 obstacles) because it teaches.
 *
 * 3. REACH.       Respect the envelope in CONTRACT §0. It is not a suggestion —
 *                 _harness/reachcheck.mjs fails the build on a violation.
 *
 *                   run  (8.6 m/s)   flat gap SAFE 4.4 m   (hard max 5.29)
 *                                    +1.0 m up SAFE 3.8    +1.8 m up SAFE 3.0
 *                                    -2.0 m down SAFE 5.2
 *                   sprint (12.2)    flat gap SAFE 6.4 m   (hard max 7.50)
 *                                    +1.0 m up SAFE 5.4    +1.8 m up SAFE 4.4
 *
 *                 Never place a jump that REQUIRES a sprint unless (a) the approach
 *                 has >= 8 m of straight, unobstructed run-up and (b) the stage has
 *                 already taught sprinting with signage. Gaps are measured edge to
 *                 edge between the two landable top surfaces, not centre to centre.
 *
 * 4. CHECKPOINTS. 3–5 per stage. Place one so that no death costs more than about
 *                 25 s of replay, and place it IMMEDIATELY BEFORE a difficulty spike,
 *                 never after one. A checkpoint that sits after the hard bit is a
 *                 checkpoint that never gets used.
 *
 * 5. RHYTHM.      Teach a mechanic in isolation -> repeat it with a twist -> combine
 *                 it with one earlier mechanic -> a short breather with a coin ->
 *                 the next mechanic. Never six identical obstacles in a row; change
 *                 the height, the width, the lateral offset or the phase.
 *
 * 6. SET-PIECE.   Every stage ends with a distinct set-piece before the finish — a
 *                 launch, an ascent, a collapse, a gauntlet. Something the player
 *                 will describe out loud afterwards.
 *
 * 7. DRESSING.    Dress the stage with kind:'deco', kind:'light' and background
 *                 architecture until it reads as a PLACE and not a test rig. Decor
 *                 must NEVER sit where it could be mistaken for a landable platform:
 *                 keep it below the walk line, above head height, or clearly outside
 *                 the play corridor (|z| > 6 at the corridor's width).
 *
 * 8. COINS.       3–5 per stage. A coin always rewards a risky OPTIONAL line — a side
 *                 ledge, a vanishing detour, a longer jump. Never put a coin on the
 *                 main path; a coin the player cannot miss is not a reward.
 *
 * 9. COMMENTS.    A short banner comment above each section naming the beat, e.g.
 *                 `// BEAT 3 — FIRST MOVING PLATFORM`. Include the measured gap on
 *                 every jump you are not certain about. Future you is the reviewer.
 *
 * ---------------------------------------------------------------------------------
 * SHARED CONVENTIONS  —  assumed by every stage file and by the builders.
 * ---------------------------------------------------------------------------------
 *
 *   UNITS       1 unit = 1 metre. +Y is up. Right-handed.
 *
 *   p           CENTRE of the object, [x, y, z]. Not a corner, not the top face.
 *   s           FULL size, [sx, sy, sz]. Not half-extents.
 *               => a platform's walkable top surface is  p[1] + s[1] / 2.
 *               => it spans x from p[0] - s[0]/2 to p[0] + s[0]/2.
 *
 *   rot         Euler angles in RADIANS, [rx, ry, rz], applied XYZ order
 *               (i.e. `mesh.rotation.fromArray(def.rot)`). Written as expressions
 *               of Math.PI in these files so the unit is never ambiguous.
 *
 *   yaw         RADIANS. yaw = atan2(dz, dx): yaw 0 faces +X, yaw +PI/2 faces +Z,
 *               yaw PI faces -X. A stage runs +X, so a stage spawn is almost always
 *               yaw 0 — which is exactly why this convention was chosen.
 *
 *   colours     Hex NUMBERS (0x7ef0ff), never CSS strings. Feed straight to
 *               new THREE.Color(v).
 *
 *   text        kind:'text' is built in the local XY plane facing local +Z. To face a
 *               player walking +X, use rot [0, -Math.PI/2, 0].
 *
 *   player      pos is the FEET. Eye height is TUNE.eye (1.62) above pos. A spawn or
 *               checkpoint point therefore sits ~0.1 m above the surface top.
 *
 *   deco        kindOf is drawn from this shared vocabulary so builders/index.js can
 *               keep one prop table. Extend it here, in this list, before using a new
 *               one in a stage:
 *
 *                 structure : 'pillar' 'arch' 'buttress' 'monolith' 'stair' 'rail'
 *                             'post' 'fence' 'panel' 'grate' 'vent' 'pipe' 'cable'
 *                 fixture   : 'brazier' 'lantern' 'beacon' 'antenna' 'screen' 'sign'
 *                             'banner' 'emblem' 'ring'
 *                 natural   : 'rock' 'plant' 'crystal' 'shard' 'cloud'
 *                 figure    : 'statue'
 *
 *               Any deco with `count` scatters `count` instances inside a box of
 *               `spread` around p, deterministically seeded by `seed`.
 *
 *   tint        OPTIONAL additive field on kind:'deco' — a hex colour that overrides
 *               the prop's palette colour (portal panels, banners, brazier flame,
 *               world beacons). Builders that do not implement it may ignore it; a
 *               deco must still read correctly from its `kindOf` and `mat` alone.
 *
 *   stripe      `stripe: true` on a platform marks a surface the player has to JUMP to
 *               reach, and earns the bright leading-edge highlight. Floors you merely
 *               walk along do NOT get one — if everything is highlighted, nothing is.
 *
 *   mover       `p` is the mover's HOME pose and `motion.to` its far pose, EXCEPT for
 *               motion.type 'circle' and 'orbit', where `p` is the ORBIT CENTRE and
 *               the platform starts at phase 0 on the +X side of it, sweeping toward
 *               +Z. A circle mover therefore occupies
 *                 x in [p.x - radius - s.x/2, p.x + radius + s.x/2]
 *               and there is no `to`. neon-2 BEAT 4 puts a coin post at the hub of one
 *               with 0.3 m of clearance, so this is load-bearing, not cosmetic.
 *
 * ---------------------------------------------------------------------------------
 * NOTE FOR _harness/reachcheck.mjs
 * ---------------------------------------------------------------------------------
 * Three legitimate patterns look like impossible jumps to a naive nearest-predecessor
 * scan. A checker must model them or it will flag good stages:
 *
 *   1. OBSTACLES THAT STAND ON A HOST. A hurdle, a safe island or a coin post sits
 *      inside its host platform's footprint, so the host's far edge is AFTER the
 *      obstacle's near edge and gets skipped as a predecessor. Reach for these is a
 *      standing hop from the host (rise only, apex 2.09 m), not a jump from the last
 *      thing down-course. neon-1 BEAT 7 and neon-2 BEAT 8 both do this.
 *   2. CIRCLE MOVERS. See above — sample the orbit's extremes, not `p`.
 *   3. ELEVATORS AND JUMP PADS. Both intentionally exceed the walking envelope; the
 *      route is the pad, and the landing must be checked against the ballistic arc
 *      (v0 = sqrt(2 * gravRise * power), then gravFall to the target top) rather than
 *      against the jump table.
 *
 *   HUB         The hub is a stage def like any other with two differences, both
 *               declared on the def: `isHub: true` and `finish: null`. Stage/Game MUST
 *               skip finish-trigger construction when `finish` is null. It also carries
 *               a top-level `portals: [{world, p, yaw}]` array so Game can wire each
 *               arch to a world without pattern-matching the object list.
 */

import HUB_DEF from './stages/hub.js';

/* -------------------------------------------------------------------------------- */
/* WORLDS                                                                            */
/* -------------------------------------------------------------------------------- */

/**
 * Ordered progression. `stages` are stage ids in play order and MUST match the
 * filenames under ./stages/ and the keys of STAGE_LOADERS below.
 *
 * `accent` is the world's signature colour — the UI tints stage-select cards, the
 * HUD and the hub's portal arch with it. It is deliberately duplicated from the
 * theme palette so pure-data consumers (stage select, minimap) never have to import
 * the Three.js-flavoured themes module.
 */
export const WORLDS = [
  {
    id: 'neon',
    name: 'NEON DOJO',
    subtitle: 'Rain, glass and reflected light',
    theme: 'neon',
    accent: 0x7ef0ff,
    blurb: 'A rooftop dojo suspended in the rain. Learn to move.',
    stages: ['neon-1', 'neon-2', 'neon-3'],
  },
  {
    id: 'foundry',
    name: 'LAVA FOUNDRY',
    subtitle: 'Iron, heat and a rising tide',
    theme: 'foundry',
    accent: 0xff8a3c,
    blurb: 'The floor is molten and it is coming up to meet you.',
    stages: ['foundry-1', 'foundry-2', 'foundry-3'],
  },
  {
    id: 'spire',
    name: 'FROZEN SPIRE',
    subtitle: 'Ice, wind and a very long drop',
    theme: 'spire',
    accent: 0xa8e4ff,
    blurb: 'Nothing here holds still, least of all your footing.',
    stages: ['spire-1', 'spire-2', 'spire-3'],
  },
  {
    id: 'temple',
    name: 'SKY TEMPLE',
    subtitle: 'Gold, dust and old machinery',
    theme: 'temple',
    accent: 0xffd27a,
    blurb: 'Everything the dojo taught you, asked for all at once.',
    stages: ['temple-1', 'temple-2', 'temple-3'],
  },
];

/** The lobby. Re-exported from ./stages/hub.js so there is exactly one definition. */
export const HUB = HUB_DEF;

/* -------------------------------------------------------------------------------- */
/* STAGE INDEX                                                                       */
/* -------------------------------------------------------------------------------- */

/** Every playable stage id, in global play order. Does not include 'hub'. */
export const ALL_STAGE_IDS = WORLDS.flatMap((w) => w.stages);

/** Total playable stages (12). The hub is not counted — it is never "cleared". */
export const STAGE_COUNT = ALL_STAGE_IDS.length;

/** id -> world def, built once. */
const WORLD_BY_ID = new Map(WORLDS.map((w) => [w.id, w]));

/** stage id -> {worldId, idx} lookup, built once. */
const STAGE_POS = new Map();
for (const w of WORLDS) {
  for (let i = 0; i < w.stages.length; i++) STAGE_POS.set(w.stages[i], { worldId: w.id, idx: i });
}

/**
 * Where a stage sits in the game.
 *
 * @param {string} id stage id, e.g. 'neon-2'
 * @returns {{world:string, worldDef:object, worldIndex:number, idx:number,
 *            globalIdx:number, count:number, next:string|null, prev:string|null,
 *            nextInWorld:string|null, prevInWorld:string|null,
 *            isFirstOfWorld:boolean, isLastOfWorld:boolean}|null}
 *
 * `world` is the world ID STRING (matches Save.worldCleared(worldId)); `worldDef` is
 * the object. `idx` is 0-based within the world, `count` is that world's stage count.
 * `next`/`prev` cross world boundaries (neon-3 -> foundry-1) because that is what
 * Game.nextStage() wants; `nextInWorld`/`prevInWorld` do not, because that is what a
 * world's stage-select grid wants. Unknown id -> null.
 */
export function stageIndex(id) {
  const pos = STAGE_POS.get(id);
  if (!pos) return null;
  const worldDef = WORLD_BY_ID.get(pos.worldId);
  const worldIndex = WORLDS.indexOf(worldDef);
  const globalIdx = ALL_STAGE_IDS.indexOf(id);
  const isFirstOfWorld = pos.idx === 0;
  const isLastOfWorld = pos.idx === worldDef.stages.length - 1;
  return {
    world: pos.worldId,
    worldDef,
    worldIndex,
    idx: pos.idx,
    globalIdx,
    count: worldDef.stages.length,
    next: globalIdx < STAGE_COUNT - 1 ? ALL_STAGE_IDS[globalIdx + 1] : null,
    prev: globalIdx > 0 ? ALL_STAGE_IDS[globalIdx - 1] : null,
    nextInWorld: isLastOfWorld ? null : worldDef.stages[pos.idx + 1],
    prevInWorld: isFirstOfWorld ? null : worldDef.stages[pos.idx - 1],
    isFirstOfWorld,
    isLastOfWorld,
  };
}

/** World def by id, or null. */
export function getWorld(worldId) {
  return WORLD_BY_ID.get(worldId) || null;
}

/** World def that owns a stage id, or null. */
export function worldOf(stageId) {
  const pos = STAGE_POS.get(stageId);
  return pos ? WORLD_BY_ID.get(pos.worldId) : null;
}

/** True if `id` is a known stage id or 'hub'. Cheap guard for deep links / ?goto=. */
export function isStageId(id) {
  return id === HUB.id || STAGE_POS.has(id);
}

/* -------------------------------------------------------------------------------- */
/* LOADER                                                                            */
/* -------------------------------------------------------------------------------- */

/**
 * Static specifier map — one entry per stage file. The specifiers must be literal
 * strings so the browser (and any future bundler) can resolve them without a build
 * step. Adding a stage means adding a file, a line here, and an id in WORLDS.
 */
const STAGE_LOADERS = {
  'neon-1': () => import('./stages/neon-1.js'),
  'neon-2': () => import('./stages/neon-2.js'),
  'neon-3': () => import('./stages/neon-3.js'),
  'foundry-1': () => import('./stages/foundry-1.js'),
  'foundry-2': () => import('./stages/foundry-2.js'),
  'foundry-3': () => import('./stages/foundry-3.js'),
  'spire-1': () => import('./stages/spire-1.js'),
  'spire-2': () => import('./stages/spire-2.js'),
  'spire-3': () => import('./stages/spire-3.js'),
  'temple-1': () => import('./stages/temple-1.js'),
  'temple-2': () => import('./stages/temple-2.js'),
  'temple-3': () => import('./stages/temple-3.js'),
};

/** Resolved defs, so a re-entry to a stage costs nothing. */
const STAGE_CACHE = new Map([[HUB_DEF.id, HUB_DEF]]);

/** In-flight promises, so two simultaneous loads share one network request. */
const STAGE_PENDING = new Map();

/**
 * Load a stage definition. Resolves to the plain def object (the module's default
 * export), never the module namespace.
 *
 * @param {string} id 'hub' or a stage id from WORLDS
 * @returns {Promise<object>}
 * @throws if the id is unknown or the file fails to parse
 */
export async function getStage(id) {
  const cached = STAGE_CACHE.get(id);
  if (cached) return cached;

  const pending = STAGE_PENDING.get(id);
  if (pending) return pending;

  const loader = STAGE_LOADERS[id];
  if (!loader) {
    throw new Error(
      `[data] unknown stage id "${id}". Known: ${['hub', ...Object.keys(STAGE_LOADERS)].join(', ')}`
    );
  }

  const p = loader()
    .then((mod) => {
      const def = mod && mod.default;
      if (!def || typeof def !== 'object') {
        throw new Error(`[data] stage "${id}" has no default export`);
      }
      if (def.id !== id) {
        throw new Error(`[data] stage file for "${id}" declares id "${def.id}"`);
      }
      STAGE_CACHE.set(id, def);
      STAGE_PENDING.delete(id);
      return def;
    })
    .catch((err) => {
      STAGE_PENDING.delete(id);
      throw err;
    });

  STAGE_PENDING.set(id, p);
  return p;
}

/** Warm the cache for a stage without using it (call while a fade-out is playing). */
export function prefetchStage(id) {
  if (!STAGE_CACHE.has(id) && STAGE_LOADERS[id]) getStage(id).catch(() => {});
}

/** Prefetch whatever comes after `id`, so stage-to-stage transitions never stall. */
export function prefetchNext(id) {
  const ix = stageIndex(id);
  if (ix && ix.next) prefetchStage(ix.next);
}

/** Drop cached defs (used by the dev harness when hot-reloading stage data). */
export function clearStageCache() {
  STAGE_CACHE.clear();
  STAGE_CACHE.set(HUB_DEF.id, HUB_DEF);
}

export default {
  WORLDS, HUB, STAGE_COUNT, ALL_STAGE_IDS, getStage, stageIndex, getWorld, worldOf,
};
