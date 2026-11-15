// DYEFIELD — player handles for the runners the game fills (owner, 2026-10-13: "names of the bots should ALWAYS be
// random so it never seems like they are actually bots"). THREE-free, DOM-free, deterministic for a given seed (the
// roster and the Quick Match card draw the same names from the match seed), and every match seed is random, so the
// names differ every match.
//
// The shapes mimic what people type into a name box: two words run together (SaltyPelican), lower case with digits
// (marlo92), an underscore (tide_fox), a short tag with a year-ish number (Wren2011), all caps (KELPKING), and now and
// then the GUEST-XXXX an unnamed online player gets. Original word lists (no game, brand or celebrity names);
// at most 16 characters, unique case-insensitively, never a name in `avoid`.

import { hash32, mulberry32 } from '../rng.ts';

const ADJ = [
  'salty', 'sunny', 'lazy', 'quick', 'silent', 'lucky', 'fuzzy', 'brave', 'sneaky', 'happy', 'grumpy', 'tiny', 'mega',
  'cosmic', 'rusty', 'frosty', 'spicy', 'sleepy', 'wild', 'neon', 'golden', 'crimson', 'shady', 'jolly', 'swift',
  'clever', 'bouncy', 'dizzy', 'mighty', 'humble', 'odd', 'sly', 'zesty', 'calm', 'stormy', 'misty', 'snappy', 'chill',
  'turbo', 'pixel', 'retro', 'atomic', 'crispy', 'soggy', 'noisy', 'fancy', 'feral', 'gentle', 'savage', 'epic',
];
const NOUN = [
  'pelican', 'otter', 'walrus', 'gecko', 'badger', 'falcon', 'squid', 'lobster', 'panda', 'moose', 'ferret', 'raven',
  'shark', 'crab', 'toast', 'waffle', 'noodle', 'pickle', 'muffin', 'taco', 'potato', 'mango', 'biscuit', 'nugget',
  'comet', 'rocket', 'anchor', 'harbor', 'kelp', 'tide', 'wave', 'reef', 'storm', 'ember', 'frost', 'thunder', 'viper',
  'ninja', 'pirate', 'wizard', 'goblin', 'knight', 'ranger', 'pilot', 'captain', 'drifter', 'sailor', 'gull', 'fox',
  'wolf', 'bear', 'lynx', 'heron', 'marlin', 'tuna', 'clam', 'eel', 'yeti', 'golem', 'sprout', 'cactus', 'bean',
];
const NAME = [
  'marlo', 'tully', 'sable', 'wren', 'quill', 'skerry', 'fathom', 'lark', 'bex', 'rook', 'tamsin', 'nettle', 'ossie',
  'cove', 'jory', 'kaia', 'remy', 'nova', 'milo', 'juno', 'ezra', 'pax', 'indy', 'cleo', 'otis', 'zeke', 'mae', 'rio',
  'nico', 'tess', 'bodhi', 'lou', 'vale', 'ash', 'kit', 'jem', 'sol', 'zara', 'finn', 'ida', 'cass', 'arlo', 'bree',
];
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // the GUEST-XXXX alphabet (no I, O, 0, 1)

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** `count` distinct handles for `seed`, none equal (case-insensitively) to a name in `avoid` */
export function randomHandles(seed: number, count: number, avoid: readonly string[] = []): string[] {
  const rnd = mulberry32(hash32(seed | 0, 0x68616e64));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const num = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const taken = new Set(avoid.map((n) => n.trim().toLowerCase()));
  const out: string[] = [];
  for (let guard = 0; out.length < count && guard < count * 50; guard++) {
    const r = rnd();
    let s: string;
    if (r < 0.2) s = cap(pick(ADJ)) + cap(pick(NOUN));                                       // SaltyPelican
    else if (r < 0.36) s = pick(NOUN) + num(1, 99);                                            // otter42
    else if (r < 0.5) s = pick(NAME) + (rnd() < 0.5 ? num(1, 999) : '');                       // marlo / marlo92
    else if (r < 0.6) s = `${pick(ADJ)}_${pick(NOUN)}`;                                        // sneaky_squid
    else if (r < 0.7) s = cap(pick(NAME)) + num(1998, 2014);                                   // Wren2011
    else if (r < 0.77) s = (pick(ADJ) + pick(NOUN)).toUpperCase();                             // TURBOGULL
    else if (r < 0.86) s = `${cap(pick(NOUN))}${pick(['TV', 'YT', 'GG', 'Pro', 'Jr', 'X', 'ttv'])}`; // ToastGG
    else s = `GUEST-${Array.from({ length: 4 }, () => pick([...CODE])).join('')}`;           // an unnamed player
    if (s.length > 16) continue;
    const k = s.toLowerCase();
    if (taken.has(k)) continue;
    taken.add(k);
    out.push(s);
  }
  return out;
}
