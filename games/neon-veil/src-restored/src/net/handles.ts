/* ForgeFlow Games — random player handles (TypeScript copy of pipeline/templates/shared/ffg_handles.js) for bot-filled seats (owner, 2026-10-13: bot names are ALWAYS random, so a
 * filled seat never reads as a bot). Copied into each game that fills seats; GAME_DOCTRINE.md has the rule.
 *
 *   randomHandles(count, { rng, avoid, maxLen, upper, guest })  →  string[]
 *     rng     () => [0,1)  — pass the match's seeded RNG when every peer must draw the same names; default Math.random
 *     avoid   names already in the match (humans), compared case-insensitively
 *     maxLen  longest handle allowed (default 16)
 *     upper   true → every handle upper-case (games whose name tags are all caps)
 *     guest   share of GUEST-XXXX handles, like an unnamed online player gets (default 0.12; 0 for offline-only games)
 *
 * Shapes people really type into a name box: SaltyPelican · otter42 · marlo / marlo92 · sneaky_squid · Wren2011 ·
 * TURBOGULL · ToastGG · GUEST-7KQ2. Original word lists (no game, brand or celebrity names). Works as an ES module
 * export and as a classic script (window.FFG_HANDLES.randomHandles).
 */
const ADJ = ['salty', 'sunny', 'lazy', 'quick', 'silent', 'lucky', 'fuzzy', 'brave', 'sneaky', 'happy', 'grumpy', 'tiny',
  'mega', 'cosmic', 'rusty', 'frosty', 'spicy', 'sleepy', 'wild', 'neon', 'golden', 'crimson', 'shady', 'jolly', 'swift',
  'clever', 'bouncy', 'dizzy', 'mighty', 'humble', 'odd', 'sly', 'zesty', 'calm', 'stormy', 'misty', 'snappy', 'chill',
  'turbo', 'pixel', 'retro', 'atomic', 'crispy', 'soggy', 'noisy', 'fancy', 'feral', 'gentle', 'savage', 'epic'];
const NOUN = ['pelican', 'otter', 'walrus', 'gecko', 'badger', 'falcon', 'squid', 'lobster', 'panda', 'moose', 'ferret',
  'raven', 'shark', 'crab', 'toast', 'waffle', 'noodle', 'pickle', 'muffin', 'taco', 'potato', 'mango', 'biscuit', 'nugget',
  'comet', 'rocket', 'anchor', 'harbor', 'kelp', 'tide', 'wave', 'reef', 'storm', 'ember', 'frost', 'thunder', 'viper',
  'ninja', 'pirate', 'wizard', 'goblin', 'knight', 'ranger', 'pilot', 'captain', 'drifter', 'sailor', 'gull', 'fox', 'wolf',
  'bear', 'lynx', 'heron', 'marlin', 'tuna', 'clam', 'eel', 'yeti', 'golem', 'sprout', 'cactus', 'bean'];
const NAME = ['marlo', 'tully', 'sable', 'wren', 'quill', 'skerry', 'fathom', 'lark', 'bex', 'rook', 'tamsin', 'nettle',
  'ossie', 'cove', 'jory', 'kaia', 'remy', 'nova', 'milo', 'juno', 'ezra', 'pax', 'indy', 'cleo', 'otis', 'zeke', 'mae',
  'rio', 'nico', 'tess', 'bodhi', 'lou', 'vale', 'ash', 'kit', 'jem', 'sol', 'zara', 'finn', 'ida', 'cass', 'arlo', 'bree'];
const TAGS = ['TV', 'YT', 'GG', 'Pro', 'Jr', 'X', 'ttv'];
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface HandleOpts { rng?: () => number; avoid?: readonly string[]; maxLen?: number; upper?: boolean; guest?: number }
export function randomHandles(count: number, opts?: HandleOpts): string[] {
  const o: HandleOpts = opts || {};
  const rnd = typeof o.rng === 'function' ? o.rng : Math.random;
  const maxLen = o.maxLen || 16, guest = o.guest == null ? 0.12 : o.guest;
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length];
  const num = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
  const taken = new Set((o.avoid || []).map((n) => String(n).trim().toLowerCase()));
  const out: string[] = [];
  for (let guard = 0; out.length < count && guard < count * 60 + 60; guard++) {
    const r = rnd() * (1 - guest);
    let s: string;
    if (rnd() < guest) s = 'GUEST-' + pick([...CODE]) + pick([...CODE]) + pick([...CODE]) + pick([...CODE]);
    else if (r < 0.2) s = cap(pick(ADJ)) + cap(pick(NOUN));
    else if (r < 0.36) s = pick(NOUN) + num(1, 99);
    else if (r < 0.5) s = pick(NAME) + (rnd() < 0.5 ? num(1, 999) : '');
    else if (r < 0.6) s = pick(ADJ) + '_' + pick(NOUN);
    else if (r < 0.7) s = cap(pick(NAME)) + num(1998, 2014);
    else if (r < 0.77) s = (pick(ADJ) + pick(NOUN)).toUpperCase();
    else s = cap(pick(NOUN)) + pick(TAGS);
    if (o.upper) s = s.toUpperCase();
    if (s.length > maxLen) continue;
    const k = s.toLowerCase();
    if (taken.has(k)) continue;
    taken.add(k);
    out.push(s);
  }
  return out;
}

/** a small seeded RNG (mulberry32) for games that need every peer to draw the same names from a match seed */
export function handleRng(seed: number): () => number {
  let a = (seed >>> 0) ^ 0x68616e64;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

