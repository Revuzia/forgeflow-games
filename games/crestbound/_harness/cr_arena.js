/**
 * CRESTBOUND — _harness/cr_arena.js   (creatures lane test arena; DEV ONLY)
 * ---------------------------------------------------------------------------
 * One flat arena per realm: its two signature enemies in bays at the sides and
 * its realm boss in a ring to the south, plus the boss crest the fight must
 * spawn. Not a course and never shipped: `_cr_arena.py` loads this module in
 * the page and swaps the def into the page's COURSE_CACHE entry for that
 * realm's first course id (in memory only), so every creature is fought inside
 * the real game loop (real Course, real collectibles, real controller, real
 * camera) with real KeyboardEvents.
 *
 *   arenaDef('verdant') -> course def with id 'verdant-1'
 */

const HOST = { verdant: 'verdant-1', ember: 'ember-1', rime: 'rime-1', azure: 'azure-1' };

/** Where each piece stands (the driver reads these too). */
export const ARENA = {
  spawn: [0, 0, 30],
  bayA: [-14, 0, 10],
  bayB: [14, 0, 10],
  boss: [0, 0, -25],
  crest: [0, 1.0, -9],
};

const MAT = { verdant: 'grass', ember: 'obsidian', rime: 'snow', azure: 'marble' };
const TINT = { verdant: 0x6f9a48, ember: 0x3a302c, rime: 0xe8f0f8, azure: 0xdfe6ee };

function floor(realm, p, s) {
  return { kind: 'platform', p, s, mat: MAT[realm], tint: TINT[realm], stripe: true };
}

function enemies(realm) {
  const A = ARENA.bayA, B = ARENA.bayB;
  switch (realm) {
    case 'verdant':
      return [
        { kind: 'burrower', p: A, range: 9 },
        { kind: 'podspitter', p: B, yaw: 0 },
      ];
    case 'ember':
      return [
        { kind: 'slagcrab', path: [[A[0] - 4, 0, A[2]], [A[0] + 4, 0, A[2]]], speed: 1.2 },
        { kind: 'emberimp', p: B },
      ];
    case 'rime':
      return [
        { kind: 'skater', path: [[A[0] - 4, 0, A[2] + 2], [A[0] + 4, 0, A[2] + 2], [A[0] + 4, 0, A[2] - 3]], speed: 1.1 },
        { kind: 'snowcub', p: B, yaw: 0 },
      ];
    case 'azure':
      return [
        { kind: 'sentry', path: [[A[0] - 6, 0, A[2]], [A[0] + 6, 0, A[2]]], speed: 1.3 },
        { kind: 'puffer', p: [B[0], 1.4, B[2]], path: [[B[0] - 2, 1.4, B[2]], [B[0] + 2, 1.4, B[2]]] },
      ];
  }
  return [];
}

function boss(realm) {
  const b = ARENA.boss;
  switch (realm) {
    case 'verdant': return { kind: 'bramblehide', p: b, yaw: 0, arena: { c: [b[0], b[2]], r: 11 } };
    case 'ember': return { kind: 'slagmaw', p: b, yaw: 0, arena: { c: [b[0], b[2]], r: 11 } };
    case 'rime': return { kind: 'hoarhorn', p: b, yaw: 0, arena: { c: [b[0], b[2]], r: 8 }, floe: { half: 7.5, depth: 1.4 } };
    case 'azure': return { kind: 'gyrarch', p: b, yaw: 0, arena: { c: [b[0], b[2]], r: 11 }, hover: 6.2 };
  }
  return null;
}

export function arenaDef(realm) {
  const id = HOST[realm];
  if (!id) throw new Error('unknown realm ' + realm);
  const objects = [];
  if (realm === 'rime') {
    // the north ground ends 3 m short of the floe (a single-jump gap); the sea is below
    objects.push(floor(realm, [0, -0.5, 15.25], [90, 1, 59.5]));
    objects.push({ kind: 'platform', p: [0, -6.5, -30], s: [90, 1, 31], mat: 'stone', tint: 0x40566e });
  } else {
    objects.push(floor(realm, [0, -0.5, 0], [90, 1, 90]));
  }
  // the bays and the ring, marked out so the frames read
  // (behind each bay, off the approach lane: a sign post in the lane stopped the burrower's tunnel)
  objects.push({ kind: 'text', p: [ARENA.bayA[0], 2.6, ARENA.bayA[2] - 7], rot: [0, 0, 0], text: 'BAY A', size: 0.4, color: 0x2a2a2a });
  objects.push({ kind: 'text', p: [ARENA.bayB[0], 2.6, ARENA.bayB[2] - 7], rot: [0, 0, 0], text: 'BAY B', size: 0.4, color: 0x2a2a2a });
  const def = {
    id, realm, theme: realm, name: 'CREATURE ARENA (' + realm.toUpperCase() + ')', subtitle: 'creatures lane test arena',
    order: 1, difficulty: 1,
    spawn: { p: ARENA.spawn.slice(), yaw: 0 },
    killY: -20,
    bounds: { min: [-50, -20, -50], max: [50, 30, 50] },
    checkpoints: [
      { p: [0, 0, 30], yaw: 0, id: 'cp-spawn' },
      { p: [0, 0, 18], yaw: 0, id: 'cp-bays' },
      { p: [0, 0, -9.5], yaw: 0, id: 'cp-ring' },
    ],
    crests: [
      { id: 'boss', type: 'boss', name: 'THE ' + (boss(realm).kind.toUpperCase()) + ' CREST', spawnAt: ARENA.crest.slice() },
    ],
    sigils: [],
    coins: [{ line: { a: [-4, 0.6, 26], b: [4, 0.6, 26], n: 5 } }],
    objects,
    critters: enemies(realm).concat([boss(realm)]),
    music: realm,
  };
  if (realm === 'rime') {
    def.waters = [{ kind: 'water', kind2: 'lake', p: [0, -3.6, -30], s: [90, 4.8, 31] }];
  }
  return def;
}

export default arenaDef;
