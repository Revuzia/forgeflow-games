// Catalog probe: the 50-species roster as DATA must satisfy the design (DESIGN 5.2, 5.3, 9) and the engineering rules (append-only idx,
// share-string round trips, star-convex shapes, distinct silhouettes and palettes, originality and language safety).
// Plain node:  node _harness/probe_catalog.ts      (exit 1 on any failure; thresholds below are STATED, never loosened to pass)
import {
  CATALOG, SPECIES, SPECIES_BY_ID, SPECIES_BY_TIER, LANES, SIGNATURE_BIAS, speciesBaseGenome, speciesTemplateGenome, tierOf, familyOf, tierIndexOf, speciesIdx, getSpecies, isSpeciesId,
} from '../src/data/catalog.ts';
import type { SpeciesDef, SpeciesId, LaneId } from '../src/data/catalog.ts';
import {
  SHAPE_R_MIN, SHAPE_R_MAX, SHAPE_MIN_WIDTH, evalShape, shapeVolumeRatio, shapeBounds, shapeSlope, shapeDistance, forEachDirection, DOLLOP_RECIPE,
} from '../src/data/shapes.ts';
import { MATERIAL_FAMILY_IDS, MATERIAL_FAMILIES, isMaterialFamilyId, materialDistance } from '../src/data/materials.ts';
import { TIERS, TIER_SPECIES_COUNTS, TOTAL_SPECIES, TIER_ODDS, TIER_NAMES, TIER_ODDS_PERCENT, TIER_STYLE, TIER_STYLES, oddsPerSpecies, oddsLabel, nextTier, tierFromIndex, isTierId } from '../src/core/rarity.ts';
import { quantizeGenome, encodeGenome, decodeGenome, genomeEquals, makeStarterGenome, randomGenome, GENOME_VERSION, SPECIES as GENOME_SPECIES } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { genomePalette } from '../src/render/oklch.ts';
import { restPoint } from '../src/physics/shape.ts';

let bad = 0;
const check = (name: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const header = (t: string): void => console.log(`\n== ${t} ==`);
const f2 = (x: number): string => x.toFixed(2);
const f3 = (x: number): string => x.toFixed(3);
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);

/* ───────────────────────────── stated thresholds ───────────────────────────── */
const T = {
  nameMin: 4, nameMax: 12, blurbMax: 90,
  silhouetteMin: 0.08,        // RMS of volume-normalised radius difference, fraction of body radius (shapes.ts shapeDistance)
  rMin: 0.4, rMax: 1.85,      // clear of the evaluator's clamp (0.35 / 1.9)
  volMin: 0.55, volMax: 1.5,  // volume relative to a unit sphere
  tiltMax: 65, tiltFrontMax: 50, // degrees between surface normal and radial direction: whole body / the eye zone on +Z
  paletteSameTier: 0.075,     // OKLab distance between the BODY colours of two species of the same tier
  paletteAll: 0.045,          // ... of any two species
  bandRadiusMax: 0.035,       // largest OKLab deviation of an instance from its species' centre colour
  pastelL: 0.8, pastelC: 0.09, // "pastel-kawaii default" = body L >= 0.80 and chroma < 0.09: none allowed
  dollopFitRms: 0.02, dollopFitMax: 0.1, // evalShape(DOLLOP_RECIPE) against the live physics restPoint('dollop'), units of R0
};

/* ───────────────────────────── the locked registry (append-only!) ───────────────────────────── */
// When a species is APPENDED to SPECIES, append its id here in the same commit. Existing positions must never change.
const IDX_LOCK: readonly string[] = [
  'dollop', 'plumpet', 'twangle', 'puddlo', 'glubbin', 'crumbit', 'chunkle', 'munchip', 'wisplet', 'cushlet', 'crimpo', 'thumbly', 'sproink', 'dimpla',
  'nuzzo', 'flickum', 'swishel', 'granulo', 'peakum', 'wrigglo', 'fluffnut', 'capnap', 'knubby', 'kneadle', 'hooplet',
  'spirelo', 'zingle', 'petalop', 'burrbin', 'marigel', 'gloopsy', 'hushpuff', 'drowsel', 'thudge', 'diademo',
  'taffelin', 'maracon', 'cindergoo', 'selenuff', 'pastrel', 'flipdome', 'caromel',
  'ambrosel', 'tidelume', 'glimglop', 'somnuff', 'fossilo',
  'skeinara', 'constello', 'prismelo',
];

/* ───────────────────────────── DESIGN 5.2 family-by-tier grid ───────────────────────────── */
// rows = lane, columns = Common Uncommon Rare Epic Legendary Mythic
const DESIGN_GRID: Record<LaneId, number[]> = {
  jelly: [3, 2, 2, 1, 1, 1], fill: [3, 2, 2, 1, 1, 1], chew: [2, 2, 2, 1, 1, 1], foam: [2, 2, 2, 1, 1, 0], dough: [2, 2, 1, 1, 1, 0], rubber: [2, 1, 1, 2, 0, 0],
};

/* ───────────────────────────── colour maths ───────────────────────────── */
const toOklab = (lin: readonly number[]): [number, number, number] => {
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const dE = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centreGenome = (d: SpeciesDef): Genome => speciesTemplateGenome(d.id);
const bodyLab = (g: Genome): [number, number, number] => toOklab(genomePalette(g).body);

/* ───────────────────────────── originality + language safety ───────────────────────────── */
// Real brands, characters, toy lines, games and trademarks (and the original 151 Pokemon + common later ones). Lowercase, letters only after
// normalisation (spaces and hyphens are removed). A species NAME or ID, or any word of a BLURB, fails if it equals, contains (term of 6+ letters)
// or sits within edit distance 1 of any entry; short entries (4-5 letters) must be within edit distance 1 of the WHOLE name; 3 letters: equal only.
const DENY_TOYS = ['squishmallow', 'squishmallows', 'jellycat', 'labubu', 'smiski', 'funko', 'funkopop', 'sanrio', 'tamagotchi', 'popit', 'playdoh', 'needoh', 'orbeez', 'sillyputty', 'thinkingputty', 'kineticsand', 'floam',
  'lego', 'duplo', 'barbie', 'hotwheels', 'transformers', 'furby', 'beaniebabies', 'mattel', 'hasbro', 'fisherprice', 'playmobil', 'bratz', 'lolsurprise', 'shopkins', 'lalaloopsy', 'littlestpetshop', 'mylittlepony',
  'pollypocket', 'carebears', 'cabbagepatch', 'teddyruxpin', 'buildabear', 'webkinz', 'neopets', 'slinky', 'rubikscube', 'nerf', 'monchhichi', 'sylvanian', 'calicocritters', 'pusheen', 'molang', 'rilakkuma',
  'sumikkogurashi', 'kewpie', 'hellokitty', 'kuromi', 'mymelody', 'cinnamoroll', 'pompompurin', 'keroppi', 'gudetama', 'badtzmaru', 'pochacco', 'hangyodon', 'aggretsuko', 'littletwinstars', 'chococat', 'tuxedosam',
  'popmart', 'skullpanda', 'dimoo', 'crybaby', 'hirono', 'hacipupu', 'moshimonsters', 'moshi', 'beanieboo', 'ty', 'gund', 'tonka', 'playskool', 'littletikes', 'melissaanddoug', 'crayola', 'playfoam', 'mrpotatohead'];
const DENY_GAMES = ['nintendo', 'mario', 'luigi', 'kirby', 'zelda', 'metroid', 'pikmin', 'animalcrossing', 'splatoon', 'sonic', 'minecraft', 'enderman', 'mojang', 'roblox', 'robux', 'bloxburg', 'brookhaven', 'fortnite', 'amongus',
  'tetris', 'pacman', 'thesims', 'slimerancher', 'plort', 'plorts', 'largo', 'largos', 'tarr', 'adoptme', 'meganeon', 'neonpet', 'pokemongo', 'pokemon', 'digimon', 'yugioh', 'dragonball', 'naruto', 'sailormoon', 'ghibli', 'totoro', 'ponyo',
  'huggywuggy', 'kissymissy', 'poppyplaytime', 'skibidi', 'sprunki', 'fnaf', 'overwatch', 'genshin', 'zootopia', 'fallguys', 'candycrush', 'angrybirds', 'flappybird', 'clashroyale', 'brawlstars', 'pikminbloom'];
const DENY_NEOPETS = ['kacheek', 'blumaroo', 'gelert', 'grundo', 'hissi', 'jubjub', 'kyrii', 'meerca', 'moehog', 'mynci', 'poogle', 'quiggle', 'scorchio', 'shoyru', 'xweetok', 'yurble', 'zafara', 'skeith', 'peophin', 'tuskaninny',
  'krawk', 'draik', 'elephante', 'cybunny', 'korbat', 'wocky', 'acara', 'aisha', 'eyrie', 'ixi', 'kau', 'lupe', 'nimmo', 'pteri', 'ruki', 'tonu', 'usul', 'uni', 'flotsam', 'jetsam'];
const DENY_POKEMON = ['bulbasaur', 'ivysaur', 'venusaur', 'charmander', 'charmeleon', 'charizard', 'squirtle', 'wartortle', 'blastoise', 'caterpie', 'metapod', 'butterfree', 'weedle', 'kakuna', 'beedrill', 'pidgey', 'pidgeotto',
  'pidgeot', 'rattata', 'raticate', 'spearow', 'fearow', 'ekans', 'arbok', 'pikachu', 'raichu', 'sandshrew', 'sandslash', 'nidoran', 'nidorina', 'nidoqueen', 'nidorino', 'nidoking', 'clefairy', 'clefable', 'vulpix', 'ninetales',
  'jigglypuff', 'wigglytuff', 'zubat', 'golbat', 'oddish', 'gloom', 'vileplume', 'paras', 'parasect', 'venonat', 'venomoth', 'diglett', 'dugtrio', 'meowth', 'persian', 'psyduck', 'golduck', 'mankey', 'primeape', 'growlithe',
  'arcanine', 'poliwag', 'poliwhirl', 'poliwrath', 'abra', 'kadabra', 'alakazam', 'machop', 'machoke', 'machamp', 'bellsprout', 'weepinbell', 'victreebel', 'tentacool', 'tentacruel', 'geodude', 'graveler', 'golem', 'ponyta',
  'rapidash', 'slowpoke', 'slowbro', 'magnemite', 'magneton', 'farfetchd', 'doduo', 'dodrio', 'seel', 'dewgong', 'grimer', 'muk', 'shellder', 'cloyster', 'gastly', 'haunter', 'gengar', 'onix', 'drowzee', 'hypno', 'krabby',
  'kingler', 'voltorb', 'electrode', 'exeggcute', 'exeggutor', 'cubone', 'marowak', 'hitmonlee', 'hitmonchan', 'lickitung', 'koffing', 'weezing', 'rhyhorn', 'rhydon', 'chansey', 'tangela', 'kangaskhan', 'horsea', 'seadra',
  'goldeen', 'seaking', 'staryu', 'starmie', 'mrmime', 'scyther', 'jynx', 'electabuzz', 'magmar', 'pinsir', 'tauros', 'magikarp', 'gyarados', 'lapras', 'ditto', 'eevee', 'vaporeon', 'jolteon', 'flareon', 'porygon', 'omanyte',
  'omastar', 'kabuto', 'kabutops', 'aerodactyl', 'snorlax', 'articuno', 'zapdos', 'moltres', 'dratini', 'dragonair', 'dragonite', 'mewtwo', 'mew',
  // common later ones
  'togepi', 'pichu', 'lugia', 'hooh', 'celebi', 'rayquaza', 'groudon', 'kyogre', 'gardevoir', 'blaziken', 'mudkip', 'torchic', 'treecko', 'piplup', 'chimchar', 'turtwig', 'lucario', 'greninja', 'mimikyu', 'sylveon', 'umbreon',
  'espeon', 'snivy', 'tepig', 'oshawott', 'froakie', 'fennekin', 'chespin', 'rowlet', 'litten', 'popplio', 'grookey', 'scorbunny', 'sobble', 'sprigatito', 'fuecoco', 'quaxly', 'bidoof', 'lopunny', 'zoroark', 'hoopa', 'cleffa'];
const DENY_CHARACTERS = ['disney', 'pixar', 'marvel', 'dccomics', 'mickey', 'minnie', 'donald', 'goofy', 'elsa', 'olaf', 'simba', 'nala', 'mufasa', 'bambi', 'thumper', 'dumbo', 'pinocchio', 'aladdin', 'moana', 'maui', 'mulan', 'cinderella',
  'rapunzel', 'tiana', 'stitch', 'lilo', 'nemo', 'marlin', 'woody', 'buzzlightyear', 'sulley', 'wazowski', 'ratatouille', 'merida', 'baymax', 'judyhopps', 'shrek', 'toothless', 'madagascar', 'minions', 'snoopy', 'charliebrown',
  'garfield', 'winniethepooh', 'pooh', 'tigger', 'eeyore', 'piglet', 'paddington', 'peterrabbit', 'bluey', 'peppapig', 'pawpatrol', 'spongebob', 'squidward', 'scoobydoo', 'tomandjerry', 'bugsbunny', 'tweety', 'yoda', 'grogu',
  'babyyoda', 'chewbacca', 'vader', 'harrypotter', 'hogwarts', 'hermione', 'dobby', 'hagrid', 'gandalf', 'frodo', 'hobbit', 'gollum', 'godzilla', 'kingkong', 'mothra', 'batman', 'superman', 'spiderman', 'ironman', 'avengers',
  'pongo', 'tamagotchi', 'thomasthetank', 'teletubbies', 'muppets', 'kermit', 'elmo', 'barney', 'dora', 'clifford', 'pingu', 'moomin', 'hellokitty', 'astroboy', 'doraemon', 'pompompurin', 'hamtaro', 'sailorscouts', 'popples'];
const DENY_BRANDS = ['google', 'apple', 'samsung', 'tesla', 'nike', 'adidas', 'haribo', 'skittles', 'starburst', 'twizzlers', 'jollyrancher', 'tootsie', 'snickers', 'kitkat', 'oreo', 'nutella', 'pringles', 'doritos', 'cheetos', 'hersheys',
  'twix', 'reeses', 'fanta', 'pepsi', 'cocacola', 'nestle', 'pillsbury', 'doughboy', 'hushpuppies', 'kleenex', 'tupperware', 'velcro', 'lavalamp', 'ikea', 'amazon', 'netflix', 'spotify',
  'youtube', 'tiktok', 'instagram', 'snapchat', 'discord', 'twitch', 'xbox', 'playstation', 'atari', 'sega'];
const DENY_ALL = [...DENY_TOYS, ...DENY_GAMES, ...DENY_NEOPETS, ...DENY_POKEMON, ...DENY_CHARACTERS, ...DENY_BRANDS];
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
const DENY = [...new Set(DENY_ALL.map(norm))].filter((x) => x.length >= 2);

/** Edit distance <= 1 (substitution, insertion or deletion). */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) i++; else j++;
  }
  return edits + (la - i) + (lb - j) <= 1;
}
/** Why `word` (a species name or id, one whole token) is too close to a real name, or '' if it is fine. */
function denyReason(word: string): string {
  const w = norm(word);
  for (const t of DENY) {
    if (t.length <= 3) { if (w === t) return `equals "${t}"`; continue; }
    if (t.length >= 6 && w.includes(t)) return `contains "${t}"`;
    if (t.length === 5 && w.includes(t)) return `contains "${t}"`;
    if (within1(w, t)) return `within edit distance 1 of "${t}"`;
  }
  return '';
}
// Ordinary English words that merely resemble a denylist entry (Pokemon "Goldeen" vs "golden"): allowed inside BLURBS only, never as a name.
const ORDINARY_WORDS = new Set(['golden']);
/** The same for a blurb: word by word, plus long phrases against the letters-only text. */
function denyReasonText(text: string): string {
  const flat = norm(text);
  for (const t of DENY) if (t.length >= 8 && flat.includes(t)) return `contains "${t}"`;
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 4 || ORDINARY_WORDS.has(raw)) continue;
    for (const t of DENY) { if (t.length <= 3) continue; if (within1(raw, t) && !(raw.length <= 5 && t.length <= 5 && raw !== t)) return `word "${raw}" ~ "${t}"`; }
  }
  return '';
}

// Language safety: profanity, sexual terms, violence, drugs and hate. The harshest entries are stored REVERSED so this file itself stays clean.
const rev = (s: string): string => [...s].reverse().join('');
const SAFE_PLAIN = ['damn', 'hell', 'crap', 'piss', 'shit', 'fuck', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'boob', 'tits', 'sexy', 'sex', 'porn', 'nude', 'naked', 'rape', 'kill', 'murder', 'suicide', 'death', 'dead', 'die', 'blood', 'gore', 'gun',
  'shoot', 'bomb', 'terror', 'nazi', 'slave', 'drug', 'weed', 'pot', 'meth', 'cocaine', 'heroin', 'beer', 'wine', 'vodka', 'whisky', 'booze', 'drunk', 'smoke', 'cigar', 'vape', 'poop', 'pee', 'fart', 'butt', 'anus', 'penis', 'vagina', 'idiot',
  'stupid', 'dumb', 'retard', 'moron', 'ugly', 'fat', 'hate', 'devil', 'satan', 'demon', 'curse', 'hang', 'noose', 'knife', 'stab', 'abuse', 'cum', 'jizz', 'slut', 'whore', 'screw', 'wank', 'twat', 'prick'];
const SAFE_REVERSED = ['reggin', 'toggaf', 'tnuc', 'ssa'].map(rev);
const SAFE = [...new Set([...SAFE_PLAIN, ...SAFE_REVERSED].map(norm))];
/** Name or id: contains a term of 4+ letters, or equals a term of 3 or fewer letters. */
function unsafeReason(word: string): string {
  const w = norm(word);
  for (const t of SAFE) { if (t.length <= 3) { if (w === t) return `equals "${t}"`; } else if (w.includes(t)) return `contains "${t}"`; }
  return '';
}
/** Blurb: any whole word equal to a term, or a word containing a term of 6+ letters. (Names and ids are stricter: they are single invented words.) */
function unsafeReasonText(text: string): string {
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (!raw) continue;
    for (const t of SAFE) { if (raw === t) return `word "${raw}"`; if (t.length >= 6 && raw.includes(t)) return `word "${raw}" contains "${t}"`; }
  }
  return '';
}

/* ═══════════════════════════════════ 1. roster, counts, registry ═══════════════════════════════════ */
header('1. roster, tier counts, idx registry');
check(`exactly ${TOTAL_SPECIES} species`, CATALOG.length === TOTAL_SPECIES && CATALOG.length === 50, `${CATALOG.length}`);
const counts = TIERS.map((t) => CATALOG.filter((d) => d.tier === t).length);
check('tier counts match DESIGN 5.2', counts.every((n, i) => n === TIER_SPECIES_COUNTS[i]), `${counts.join('/')} (want ${TIER_SPECIES_COUNTS.join('/')})`);
check('public tier odds sum to 1', Math.abs(TIER_ODDS.reduce((a, b) => a + b, 0) - 1) < 1e-12);
check('unique ids', new Set(CATALOG.map((d) => d.id)).size === CATALOG.length);
check('unique names (case-insensitive)', new Set(CATALOG.map((d) => d.name.toLowerCase())).size === CATALOG.length);
check('unique idx', new Set(CATALOG.map((d) => d.idx)).size === CATALOG.length);
check('idx is contiguous and equals the position in CATALOG and SPECIES', CATALOG.every((d, i) => d.idx === i && SPECIES[i] === d.id && speciesIdx(d.id) === i));
check('idx within one byte', CATALOG.every((d) => d.idx >= 0 && d.idx <= 255));
check("'dollop' is idx 0, Common, jelly gel", CATALOG[0].id === 'dollop' && CATALOG[0].tier === 'common' && CATALOG[0].family === 'jellygel');
check('IDX_LOCK: existing positions never change (append-only)', IDX_LOCK.every((id, i) => CATALOG[i] && CATALOG[i].id === id) && CATALOG.length >= IDX_LOCK.length,
  CATALOG.length > IDX_LOCK.length ? `${CATALOG.length - IDX_LOCK.length} appended since the lock: append them to IDX_LOCK` : '');
check('IDX_LOCK covers every species (append new ones to the lock)', CATALOG.length === IDX_LOCK.length);
check('genome.ts SPECIES is the catalog order', GENOME_SPECIES.length === SPECIES.length && GENOME_SPECIES.every((id, i) => id === SPECIES[i]));
check('lookup is safe against hostile ids', getSpecies('__proto__') === undefined && getSpecies('constructor') === undefined && getSpecies(7) === undefined && !isSpeciesId('toString') && SPECIES_BY_ID['dollop'].idx === 0);
check('SPECIES_BY_TIER matches', SPECIES_BY_TIER.every((l, t) => l.length === TIER_SPECIES_COUNTS[t] && l.every((d) => tierIndexOf(d.id) === t)));
check('tierOf / familyOf agree with the entries', CATALOG.every((d) => tierOf(d.id) === d.tier && familyOf(d.id) === d.family));
check('tier names exist for display', TIERS.every((t) => typeof TIER_NAMES[t] === 'string' && TIER_NAMES[t].length > 3));

/* ═══════════════════════════════════ 2. names, blurbs, tags ═══════════════════════════════════ */
header('2. names, blurbs, tags, signature touch');
check(`names ${T.nameMin}-${T.nameMax} letters, capitalised, letters only`, CATALOG.every((d) => /^[A-Z][a-z]+$/.test(d.name) && d.name.length >= T.nameMin && d.name.length <= T.nameMax),
  CATALOG.filter((d) => !/^[A-Z][a-z]+$/.test(d.name) || d.name.length < T.nameMin || d.name.length > T.nameMax).map((d) => d.name).join(' '));
check('id is the lowercase name', CATALOG.every((d) => d.id === d.name.toLowerCase()));
const longest = CATALOG.reduce((m, d) => (d.blurb.length > m.blurb.length ? d : m), CATALOG[0]);
check(`blurbs 1-${T.blurbMax} characters`, CATALOG.every((d) => d.blurb.length >= 20 && d.blurb.length <= T.blurbMax), `longest ${longest.blurb.length} (${longest.name})`);
check('blurbs are plain ASCII, one sentence-ish, end with a full stop, no double spaces', CATALOG.every((d) => /^[\x20-\x7e]+$/.test(d.blurb) && d.blurb.endsWith('.') && !d.blurb.includes('  ')));
check('unique blurbs', new Set(CATALOG.map((d) => d.blurb)).size === CATALOG.length);
check('tags: 2-6 lowercase words each, silhouette text present', CATALOG.every((d) => d.tags.length >= 2 && d.tags.length <= 6 && d.tags.every((x) => /^[a-z]+$/.test(x)) && d.silhouette.length > 8));
const sig = ['poke', 'squeeze', 'pull'].map((k) => CATALOG.filter((d) => d.signature === k).length);
check('signature touches are spread (each at least 10 species)', sig.every((n) => n >= 10), `poke ${sig[0]} / squeeze ${sig[1]} / pull ${sig[2]}`);
check('signature fits the feel: pull species stretch >= 0.45 or are sticky/slime; poke species bounce >= 0.45 or are rubber/dome/gummy',
  CATALOG.filter((d) => d.signature === 'pull').every((d) => d.look.stretch >= 0.45 || ['stickystretch', 'slimegoo'].includes(d.family))
  && CATALOG.filter((d) => d.signature === 'poke').every((d) => d.look.bounce >= 0.45 || ['firmsilicone', 'popdome', 'gummy', 'mochidough', 'waterfill'].includes(d.family)));

/* ═══════════════════════════════════ 3. families and the DESIGN 5.2 grid ═══════════════════════════════════ */
header('3. material families and the DESIGN 5.2 family-by-tier grid');
check('every family id is a real MaterialFamilyId', CATALOG.every((d) => isMaterialFamilyId(d.family)));
const famCount: Record<string, number[]> = {};
for (const f of MATERIAL_FAMILY_IDS) famCount[f] = TIERS.map((t) => CATALOG.filter((d) => d.family === f && d.tier === t).length);
check(`every one of the ${MATERIAL_FAMILY_IDS.length} families is used`, MATERIAL_FAMILY_IDS.every((f) => famCount[f].some((n) => n > 0)));
console.log('family          | C  U  R  E  L  M | total tiers  mean-tier  distinctiveness');
const famDist: Record<string, number> = {};
for (const f of MATERIAL_FAMILY_IDS) {
  const ds = MATERIAL_FAMILY_IDS.filter((g) => g !== f).map((g) => materialDistance(MATERIAL_FAMILIES[f].physics, MATERIAL_FAMILIES[g].physics));
  famDist[f] = mean(ds);
}
const meanTierOf = (f: string): number => { const sp = CATALOG.filter((d) => d.family === f); return mean(sp.map((d) => tierIndexOf(d.id))); };
for (const f of MATERIAL_FAMILY_IDS) {
  const row = famCount[f];
  console.log(`${f.padEnd(15)} | ${row.map((n) => String(n).padStart(2)).join(' ')} | ${String(row.reduce((a, b) => a + b, 0)).padStart(5)} ${String(row.filter((n) => n > 0).length).padStart(5)}  ${f2(meanTierOf(f)).padStart(9)}  ${f3(famDist[f])}`);
}
check('each family has 3 to 6 species, in at least 3 tiers', MATERIAL_FAMILY_IDS.every((f) => { const n = famCount[f].reduce((a, b) => a + b, 0); return n >= 3 && n <= 6 && famCount[f].filter((x) => x > 0).length >= 3; }));
check('no tier is more than 40% one family (DESIGN 5.2)', TIERS.every((_, t) => Math.max(...MATERIAL_FAMILY_IDS.map((f) => famCount[f][t])) / TIER_SPECIES_COUNTS[t] <= 0.4));
console.log('lane   | families (everyday -> signature)      | C  U  R  E  L  M  | DESIGN grid');
let gridOk = true;
for (const lane of LANES) {
  const row = TIERS.map((t) => CATALOG.filter((d) => d.lane === lane.id && d.tier === t).length);
  const want = DESIGN_GRID[lane.id];
  const ok = row.every((n, i) => n === want[i]);
  gridOk &&= ok;
  console.log(`${lane.letter} ${lane.name.padEnd(6)}| ${(lane.everyday + ' -> ' + lane.signature).padEnd(38)}| ${row.map((n) => String(n).padStart(2)).join(' ')}  | ${want.join(' ')} ${ok ? '' : ' <-- MISMATCH'}`);
}
check('family-by-tier grid matches DESIGN 5.2 cell by cell (6 lanes x 6 tiers)', gridOk);
check('every species uses a family of its own lane', CATALOG.every((d) => { const l = LANES.find((x) => x.id === d.lane); return !!l && (d.family === l.everyday || d.family === l.signature); }));
check('lane totals 10/10/9/8/7/6', LANES.map((l) => CATALOG.filter((d) => d.lane === l.id).length).join('/') === '10/10/9/8/7/6');
check('in every lane the SIGNATURE family has the higher mean tier ("higher tiers favour the more distinctive feel")',
  LANES.every((l) => meanTierOf(l.signature) > meanTierOf(l.everyday)), LANES.map((l) => `${l.signature} ${f2(meanTierOf(l.signature))} > ${l.everyday} ${f2(meanTierOf(l.everyday))}`).join('; '));
check('signature families are the more distinctive of their lane (larger mean materialDistance to the other families)', LANES.every((l) => famDist[l.signature] > famDist[l.everyday]));
const tierDist = TIERS.map((_, t) => mean(CATALOG.filter((d) => tierIndexOf(d.id) === t).map((d) => famDist[d.family])));
console.log('mean family distinctiveness by tier: ' + TIERS.map((t, i) => `${TIER_NAMES[t]} ${f3(tierDist[i])}`).join('  '));
const lowBand = mean(CATALOG.filter((d) => tierIndexOf(d.id) <= 1).map((d) => famDist[d.family])), highBand = mean(CATALOG.filter((d) => tierIndexOf(d.id) >= 3).map((d) => famDist[d.family]));
check('Epic+ species are on average more distinctive in feel than Common+Uncommon (by at least 0.015)', highBand >= lowBand + 0.015, `${f3(highBand)} vs ${f3(lowBand)}`);
const rankX = CATALOG.map((d) => tierIndexOf(d.id)), rankY = CATALOG.map((d) => famDist[d.family]);
const corr = ((): number => { const mx = mean(rankX), my = mean(rankY); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < rankX.length; i++) { sxy += (rankX[i] - mx) * (rankY[i] - my); sxx += (rankX[i] - mx) ** 2; syy += (rankY[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); })();
check('tier and feel-distinctiveness correlate positively (Pearson r >= 0.2)', corr >= 0.2, `r = ${f2(corr)}`);
const distinctFam = TIERS.map((t) => new Set(CATALOG.filter((d) => d.tier === t).map((d) => d.family)).size);
check('each tier shelf is varied in feel: distinct families Common>=9 Uncommon>=10 Rare>=9 Epic=7 Legendary=5 Mythic=3', distinctFam[0] >= 9 && distinctFam[1] >= 10 && distinctFam[2] >= 9 && distinctFam[3] === 7 && distinctFam[4] === 5 && distinctFam[5] === 3, distinctFam.join('/'));
const opaque = (f: string): boolean => MATERIAL_FAMILIES[f as keyof typeof MATERIAL_FAMILIES].look.translucency < 0.2;
const opaqueByTier = TIERS.map((t) => CATALOG.filter((d) => d.tier === t && opaque(d.family)).length);
check('opaque-bodied families (foam, marshmallow, dough, putty hide inner light): at most 2 Epic, 2 Legendary, 0 Mythic', opaqueByTier[3] <= 2 && opaqueByTier[4] <= 2 && opaqueByTier[5] === 0, `Epic ${opaqueByTier[3]} Legendary ${opaqueByTier[4]} Mythic ${opaqueByTier[5]}`);
check('Mythic families are translucent and glow (look translucency >= 0.25, coreGlow multiplier >= 0.5)', CATALOG.filter((d) => d.tier === 'mythic').every((d) => MATERIAL_FAMILIES[d.family].look.translucency >= 0.25 && MATERIAL_FAMILIES[d.family].look.coreGlow >= 0.5));

/* ═══════════════════════════════════ 4. shapes ═══════════════════════════════════ */
header('4. rest shapes: star-convex, resolvable, bounded, distinct');
const rows: Array<{ d: SpeciesDef; rMin: number; rMax: number; vol: number; tilt: number; tiltFront: number; lowAngle: number; feats: number }> = [];
let recipeOk = true; const recipeProblems: string[] = [];
const prob = (d: SpeciesDef, msg: string): void => { recipeOk = false; recipeProblems.push(`${d.id}: ${msg}`); };
for (const d of CATALOG) {
  const s = d.shape;
  if (!(s.radii.length === 3 && s.radii.every((x) => Number.isFinite(x) && x >= 0.45 && x <= 1.6))) prob(d, 'radii out of 0.45..1.6');
  s.features.forEach((f, i) => {
    const L = Math.hypot(f.dir[0], f.dir[1], f.dir[2]);
    if (Math.abs(L - 1) > 1e-6) prob(d, `feature ${i} dir not unit (${L})`);
    if (!(f.amp > 0 && f.amp <= 1.1)) prob(d, `feature ${i} amp ${f.amp} not in (0, 1.1]`);
    if (!(f.width >= SHAPE_MIN_WIDTH - 1e-9)) prob(d, `feature ${i} width ${f.width} < ${SHAPE_MIN_WIDTH} rad`);
    if (f.width > 1.3) prob(d, `feature ${i} width ${f.width} > 1.3 rad (not a feature any more)`);
    if (!['bump', 'dent', 'ridge'].includes(f.kind)) prob(d, `feature ${i} bad kind`);
    if (f.mirrorX && Math.abs(f.dir[0]) < 0.25) prob(d, `feature ${i} mirrorX with |dir.x| < 0.25 (copies would pile up)`);
    if (f.kind === 'ridge') {
      const n = f.n;
      if (!n || Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) > 1e-6) prob(d, `ridge ${i} normal not unit`);
      else if (Math.abs(n[0] * f.dir[0] + n[1] * f.dir[1] + n[2] * f.dir[2]) > 1e-6) prob(d, `ridge ${i} normal not perpendicular to dir`);
      if (!(f.len !== undefined && f.len >= f.width && f.len <= 3.2)) prob(d, `ridge ${i} len ${f.len} not in [width, 3.2]`);
    } else if (f.n || f.len) prob(d, `non-ridge ${i} carries ridge fields`);
  });
  if (s.swirl) { const w = s.swirl; if (!(w.amp > 0 && w.amp <= 0.06 && Number.isInteger(w.lobes) && w.lobes >= 1 && w.lobes <= 6 && w.twist >= 0 && w.twist <= 9)) prob(d, 'swirl out of range (amp<=0.06, lobes 1..6, twist<=9: wavelength >= 0.7 rad)'); }
  const b = shapeBounds(s);
  let tilt = 0, tiltFront = 0, lowY = Infinity, lowU = [0, -1, 0];
  forEachDirection(2000, (x, y, z) => {
    const sl = shapeSlope(s, x, y, z);
    if (sl > tilt) tilt = sl;
    if (z > 0.75 && y > -0.45 && y < 0.55 && sl > tiltFront) tiltFront = sl;
    const r = evalShape(s, x, y, z);
    if (y * r < lowY) { lowY = y * r; lowU = [x, y, z]; }
  });
  const deg = (t: number): number => (Math.atan(t) * 180) / Math.PI;
  rows.push({ d, rMin: b.rMin, rMax: b.rMax, vol: shapeVolumeRatio(s), tilt: deg(tilt), tiltFront: deg(tiltFront), lowAngle: Math.acos(Math.max(-1, Math.min(1, -lowU[1]))), feats: s.features.length + (s.swirl ? 1 : 0) });
}
check('every recipe is well formed (unit dirs, amp, width >= 0.35 rad, mirrors, ridges, swirl)', recipeOk, recipeProblems.slice(0, 4).join(' | '));
const worst = (key: 'rMin' | 'rMax' | 'vol' | 'tilt' | 'tiltFront' | 'lowAngle', hi: boolean): string => { const r = rows.slice().sort((a, b) => (hi ? b[key] - a[key] : a[key] - b[key]))[0]; return `${r.d.id} ${f2(r[key])}`; };
check(`star-convex bounds: r stays within ${T.rMin}..${T.rMax} (the evaluator clamps at ${SHAPE_R_MIN}/${SHAPE_R_MAX}; no recipe touches it)`, rows.every((r) => r.rMin >= T.rMin && r.rMax <= T.rMax), `min ${worst('rMin', false)}, max ${worst('rMax', true)}`);
check(`volume relative to a unit sphere within ${T.volMin}..${T.volMax}`, rows.every((r) => r.vol >= T.volMin && r.vol <= T.volMax), `min ${worst('vol', false)}, max ${worst('vol', true)}`);
check(`surface tilt <= ${T.tiltMax} degrees everywhere (a 642-vertex mesh can follow it)`, rows.every((r) => r.tilt <= T.tiltMax), `worst ${worst('tilt', true)} deg`);
check(`surface tilt <= ${T.tiltFrontMax} degrees in the eye zone (front, +Z)`, rows.every((r) => r.tiltFront <= T.tiltFrontMax), `worst ${worst('tiltFront', true)} deg`);
check('stands upright: the lowest point of every body is within 0.9 rad of straight down', rows.every((r) => r.lowAngle <= 0.9), `worst ${worst('lowAngle', true)} rad`);
const featMean = TIERS.map((_, t) => mean(rows.filter((r) => tierIndexOf(r.d.id) === t).map((r) => r.feats)));
check('silhouette complexity (feature count) never decreases with tier', featMean.every((m, i) => i === 0 || m >= featMean[i - 1] - 1e-9), featMean.map(f2).join(' <= '));
check('Common shapes are simple (at most 2 features each, the swirl ripple not counted, one cube-pillow aside)', rows.filter((r) => r.d.tier === 'common').every((r) => r.d.shape.features.length <= 2 || r.d.id === 'cushlet'));
// silhouettes pairwise
const sil: Array<[number, string, string]> = [];
for (let i = 0; i < CATALOG.length; i++) for (let j = i + 1; j < CATALOG.length; j++) sil.push([shapeDistance(CATALOG[i].shape, CATALOG[j].shape), CATALOG[i].id, CATALOG[j].id]);
sil.sort((a, b) => a[0] - b[0]);
console.log('closest silhouettes: ' + sil.slice(0, 6).map((p) => `${p[1]}/${p[2]} ${f3(p[0])}`).join(', '));
check(`silhouettes pairwise distinct (volume-normalised RMS radius difference >= ${T.silhouetteMin})`, sil[0][0] >= T.silhouetteMin, `closest ${sil[0][1]} / ${sil[0][2]} = ${f3(sil[0][0])}, median pair ${f3(sil[Math.floor(sil.length / 2)][0])}`);
// dollop against the live physics function
{
  const out = [0, 0, 0]; let s = 0, mx = 0, n = 0;
  forEachDirection(3000, (x, y, z) => {
    restPoint('dollop', x, y, z, 1, out, 0);
    const l = Math.hypot(out[0], out[1], out[2]);
    const e = evalShape(DOLLOP_RECIPE, out[0] / l, out[1] / l, out[2] / l) - l;
    s += e * e; mx = Math.max(mx, Math.abs(e)); n++;
  });
  const rms = Math.sqrt(s / n);
  check(`DOLLOP recipe reproduces the physics lane's rest shape (RMS <= ${T.dollopFitRms}, worst <= ${T.dollopFitMax} R0)`, rms <= T.dollopFitRms && mx <= T.dollopFitMax, `RMS ${f3(rms)}, worst ${f3(mx)} (at the peak tip)`);
  check("CATALOG's dollop uses DOLLOP_RECIPE", CATALOG[0].shape === DOLLOP_RECIPE);
}
// evaluator hot path: no allocation, deterministic, never NaN
{
  let nan = 0;
  for (const d of CATALOG) forEachDirection(500, (x, y, z) => { const r = evalShape(d.shape, x, y, z); if (!Number.isFinite(r)) nan++; });
  check('evalShape never returns NaN or Infinity', nan === 0);
  const a = evalShape(CATALOG[7].shape, 0.3, 0.5, Math.sqrt(1 - 0.34)), b = evalShape(CATALOG[7].shape, 0.3, 0.5, Math.sqrt(1 - 0.34));
  check('evalShape is deterministic', a === b);
  const d = CATALOG[30].shape;
  const t0 = performance.now(); let acc = 0; for (let i = 0; i < 400000; i++) acc += evalShape(d, 0.6, 0.0, 0.8);
  const ms = performance.now() - t0;
  check('evalShape speed: 400000 calls in under 400 ms (about 1 us each; a body build needs ~650)', ms < 400 && acc > 0, `${ms.toFixed(0)} ms`);
}

/* ═══════════════════════════════════ 5. palettes ═══════════════════════════════════ */
header('5. palettes: distinct, tier-coded, not pastel');
const labs = CATALOG.map((d) => bodyLab(centreGenome(d)));
const radius: number[] = CATALOG.map((d, i) => { let mx = 0; for (let s = 0; s < 200; s++) mx = Math.max(mx, dE(bodyLab(speciesBaseGenome(d.id, s * 7919 + 13)), labs[i])); return mx; });
let minSame = 9, minAll = 9, minSameP = '', minAllP = '', minGap = 9, minGapP = '';
for (let i = 0; i < CATALOG.length; i++) for (let j = i + 1; j < CATALOG.length; j++) {
  const d = dE(labs[i], labs[j]); const same = CATALOG[i].tier === CATALOG[j].tier;
  if (d < minAll) { minAll = d; minAllP = `${CATALOG[i].id}/${CATALOG[j].id}`; }
  if (same && d < minSame) { minSame = d; minSameP = `${CATALOG[i].id}/${CATALOG[j].id}`; }
  if (same && d - radius[i] - radius[j] < minGap) { minGap = d - radius[i] - radius[j]; minGapP = `${CATALOG[i].id}/${CATALOG[j].id}`; }
}
check(`body colours of two species of one tier are >= ${T.paletteSameTier} apart in OKLab`, minSame >= T.paletteSameTier, `closest ${minSameP} ${f3(minSame)}`);
check(`body colours of ANY two species are >= ${T.paletteAll} apart`, minAll >= T.paletteAll, `closest ${minAllP} ${f3(minAll)}`);
check(`cosmetic band stays small: no instance strays more than ${T.bandRadiusMax} (OKLab) from its species colour`, Math.max(...radius) <= T.bandRadiusMax, `max ${f3(Math.max(...radius))}, mean ${f3(mean(radius))}`);
check('colour clusters of one tier never overlap (centre distance minus both band radii > 0)', minGap > 0, `tightest ${minGapP} gap ${f3(minGap)}`);
const lch = labs.map((l) => ({ L: l[0], C: Math.hypot(l[1], l[2]) }));
check(`not pastel-kawaii: no body with L >= ${T.pastelL} and chroma < ${T.pastelC}`, lch.every((x) => !(x.L >= T.pastelL && x.C < T.pastelC)), `lightest ${f2(Math.max(...lch.map((x) => x.L)))}`);
check('palette has range: lightness spans at least 0.2 and chroma at least 0.12 across the roster', Math.max(...lch.map((x) => x.L)) - Math.min(...lch.map((x) => x.L)) >= 0.2 && Math.max(...lch.map((x) => x.C)) - Math.min(...lch.map((x) => x.C)) >= 0.12);
const byTier = (f: (d: SpeciesDef) => number): number[] => TIERS.map((_, t) => mean(CATALOG.filter((d) => tierIndexOf(d.id) === t).map(f)));
const glow = byTier((d) => d.look.coreGlow), glit = byTier((d) => d.look.glitter), trans = byTier((d) => d.look.translucency), chroma = byTier((d) => d.look.chroma);
console.log(`tier means  coreGlow ${glow.map(f2).join(' ')} | glitter ${glit.map(f2).join(' ')} | translucency ${trans.map(f2).join(' ')} | chroma ${chroma.map(f2).join(' ')}`);
check('rarity is in the material: mean coreGlow rises strictly with tier', glow.every((g, i) => i === 0 || g > glow[i - 1]));
check('rarity is in the material: mean glitter rises strictly with tier', glit.every((g, i) => i === 0 || g > glit[i - 1]));
check('rarity is in the material: mean translucency never falls with tier', trans.every((g, i) => i === 0 || g >= trans[i - 1] - 1e-9));
check('rarity is in the colour: mean chroma never falls with tier', chroma.every((g, i) => i === 0 || g >= chroma[i - 1] - 1e-9));
check('Common has no sparkle beyond the starter (glitter <= 0.3)', CATALOG.filter((d) => d.tier === 'common').every((d) => d.look.glitter <= 0.3));
check('Rare and above carry a speckle / swirl / bands layer (pattern not plain, speckle >= 0.3)', CATALOG.filter((d) => tierIndexOf(d.id) >= 2).every((d) => d.look.pattern !== 'plain' && d.look.speckle >= 0.3));
check('Epic and above are strongly patterned (speckle >= 0.5, glitter >= 0.5)', CATALOG.filter((d) => tierIndexOf(d.id) >= 3).every((d) => d.look.speckle >= 0.5 && d.look.glitter >= 0.5));
check('Common and Uncommon are plain or lightly marked (pattern plain)', CATALOG.filter((d) => tierIndexOf(d.id) <= 1).every((d) => d.look.pattern === 'plain'));
const TELL: Record<string, number> = { common: 56, uncommon: 172, rare: 272, epic: 2, legendary: 42 };
const angle = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
check('the inner light is the tier\'s tell colour (cream / lagoon / dusk violet / ember coral / sodium amber, within 50 degrees) for every non-Mythic species',
  CATALOG.filter((d) => d.tier !== 'mythic').every((d) => angle(d.look.coreHue, TELL[d.tier]) <= 50 || d.id === 'dollop'),
  CATALOG.filter((d) => d.tier !== 'mythic' && d.id !== 'dollop' && angle(d.look.coreHue, TELL[d.tier]) > 50).map((d) => d.id).join(' '));
check('the stored coreHue is the rendered one: within 110 degrees of the body hue (renderer clamps beyond that)', CATALOG.every((d) => angle(d.look.coreHue, d.look.hue) <= 110), CATALOG.filter((d) => angle(d.look.coreHue, d.look.hue) > 110).map((d) => d.id).join(' '));
check('the core stands out from the body (hue differs by at least 25 degrees; the hand-made starter is exempt)', CATALOG.every((d) => d.id === 'dollop' || angle(d.look.coreHue, d.look.hue) >= 25), CATALOG.filter((d) => d.id !== 'dollop' && angle(d.look.coreHue, d.look.hue) < 25).map((d) => d.id).join(' '));
// A blurb that names a colour must be telling the truth about the palette (words in a small lexicon of OKLab hue ranges, degrees, wrapping when lo > hi).
const HUE_WORDS: Record<string, [number, number]> = {
  apricot: [40, 80], mustard: [80, 120], teal: [170, 225], terracotta: [25, 65], sandy: [55, 100], tomato: [15, 45], red: [345, 45], green: [120, 175], mauve: [320, 15], gold: [65, 115], golden: [65, 115],
  lagoon: [170, 215], sage: [110, 155], sky: [215, 255], emerald: [120, 175], ocean: [195, 245], sunshine: [80, 115], yellow: [80, 115], lime: [105, 140], aqua: [170, 210], periwinkle: [255, 295],
  indigo: [265, 300], khaki: [90, 120], slate: [235, 285], cobalt: [240, 275], violet: [270, 325], magenta: [315, 355], pink: [330, 40], royal: [245, 285], blue: [215, 285], plum: [300, 340],
  marigold: [35, 70], lilac: [285, 335], brick: [340, 30], rose: [335, 30], crimson: [340, 25], amber: [50, 85], ember: [20, 60], orange: [25, 70], bronze: [50, 90], citrus: [95, 130], sunflower: [70, 110],
  copper: [30, 65], turquoise: [175, 215], orchid: [315, 360], ruby: [340, 30], azure: [205, 250], seafoam: [150, 190], mint: [150, 190],
};
const inHue = (h: number, [lo, hi]: [number, number]): boolean => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);
{
  const wrong: string[] = [];
  CATALOG.forEach((d, i) => {
    const h = ((Math.atan2(labs[i][2], labs[i][1]) * 180) / Math.PI + 360) % 360, C = Math.hypot(labs[i][1], labs[i][2]);
    for (const w of d.blurb.toLowerCase().split(/[^a-z]+/)) {
      if (w === 'ash') { if (C >= 0.06) wrong.push(`${d.id}: "ash" but chroma ${f3(C)}`); continue; }
      const r = HUE_WORDS[w];
      if (r && !inHue(h, r)) wrong.push(`${d.id}: "${w}" but hue ${h.toFixed(0)}`);
    }
  });
  check('blurb colour words tell the truth about the palette (hue of the rendered body inside the word\'s range)', wrong.length === 0, wrong.join(' | '));
}
check('Mythic cores cover different hues (pairwise >= 40 degrees apart)', (() => { const m = CATALOG.filter((d) => d.tier === 'mythic'); for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) if (angle(m[i].look.coreHue, m[j].look.coreHue) < 40) return false; return true; })());
const eyeUse = ['dot', 'oval', 'sleepy', 'wide'].map((e) => CATALOG.filter((d) => d.look.eyeStyle === e).length);
check('all four eye styles are used at least 8 times', eyeUse.every((n) => n >= 8), eyeUse.join('/'));
check('all four patterns are used', ['plain', 'speckle', 'swirl', 'bands'].every((p) => CATALOG.some((d) => d.look.pattern === p)));
check('size spread: smallest <= 0.35 and largest >= 0.65 (some small, some big)', Math.min(...CATALOG.map((d) => d.look.size)) <= 0.35 && Math.max(...CATALOG.map((d) => d.look.size)) >= 0.65);

/* ═══════════════════════════════════ 6. instance genomes ═══════════════════════════════════ */
header('6. speciesBaseGenome: deterministic, quantised, share-string round trip');
const KEYS = ['chroma', 'lightness', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size', 'glitter', 'speckle', 'eyeSpacing', 'eyeSize', 'eyeHeight'] as const;
{
  let det = true, rt = true, fixed = true, inBand = true, sameSpecies = true, fixedFields = true, n = 0, firstBad = '';
  const q = 1 / 255 + 1e-9;
  for (const d of CATALOG) for (let s = 0; s < 200; s++) {
    const seed = Math.imul(s + 1, 0x9e3779b1) >>> 0;
    const g = speciesBaseGenome(d.id, seed), g2 = speciesBaseGenome(d.id, seed);
    n++;
    if (JSON.stringify(g) !== JSON.stringify(g2)) det = false;
    const back = decodeGenome(encodeGenome(g));
    if (!back || !genomeEquals(back, g) || JSON.stringify(Object.entries(back).sort()) !== JSON.stringify(Object.entries(g).sort())) { rt = false; firstBad ||= `${d.id}@${seed}`; }
    if (JSON.stringify(quantizeGenome(g)) !== JSON.stringify(g)) fixed = false;
    if (g.species !== d.id || g.seed !== seed || g.v !== 1) sameSpecies = false;
    if (g.pattern !== d.look.pattern || g.eyeStyle !== d.look.eyeStyle) fixedFields = false;
    const bias = SIGNATURE_BIAS[d.signature];
    for (const k of KEYS) {
      const shift = (k === 'firmness' ? bias.firmness : k === 'bounce' ? bias.bounce : k === 'stretch' ? bias.stretch : 0) ?? 0;
      const lo = Math.max(0, d.look[k] + shift - d.bands[k] - q), hi = Math.min(1, d.look[k] + shift + d.bands[k] + q);
      if (g[k] < lo - 1e-9 || g[k] > hi + 1e-9) { inBand = false; firstBad ||= `${d.id}.${k}`; }
    }
    const dh = Math.abs(((g.hue - d.look.hue + 540) % 360) - 180);
    if (dh > d.bands.hue + 1) { inBand = false; firstBad ||= `${d.id}.hue`; }
    if ((d.look.glitter === 0 && g.glitter !== 0) || (d.look.speckle === 0 && g.speckle !== 0)) fixedFields = false;
  }
  check(`deterministic for all ${CATALOG.length} species x 200 seeds (${n} genomes)`, det);
  check('every genome round-trips encodeGenome -> decodeGenome losslessly', rt, firstBad);
  check('every genome is already quantised (quantizeGenome is a fixed point)', fixed);
  check('genome.species / seed / version are set as documented', sameSpecies);
  check('instances differ from the species look only inside the cosmetic bands (plus the signature-touch shift)', inBand, firstBad);
  check('pattern and eye style never vary; zero glitter / zero speckle stay zero', fixedFields);
  const seeds = new Set(Array.from({ length: 100 }, (_, i) => encodeGenome(speciesBaseGenome('plumpet', i + 1))));
  check('different seeds give different instances', seeds.size >= 95, `${seeds.size}/100 distinct`);
  const hs = Array.from({ length: 400 }, (_, i) => speciesBaseGenome('twangle', i + 1));
  check('signature bias applies (a pull species has stretch centred at base + 0.04)', Math.abs(mean(hs.map((g) => g.stretch)) - (CATALOG[2].look.stretch + 0.04)) < 0.02);
  const dDiff = JSON.stringify(Object.entries(speciesBaseGenome('dollop', 5)).sort()) !== JSON.stringify(Object.entries(makeStarterGenome()).sort());
  check("makeStarterGenome is unchanged: 'g1.AQAAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA' and randomGenome(7) = 'g1.AQAAAF8NYyBhAT8Ap4vqd66h45hz4zx7vss'",
    encodeGenome(makeStarterGenome()) === 'g1.AQAAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA' && encodeGenome(randomGenome(7)) === 'g1.AQAAAF8NYyBhAT8Ap4vqd66h45hz4zx7vss' && dDiff);
  let threw = 0; for (const bad2 of ['', '__proto__', 'nope', 'DOLLOP']) { try { speciesBaseGenome(bad2 as SpeciesId, 1); } catch { threw++; } }
  check('speciesBaseGenome throws RangeError for an unknown species (never a silent fallback)', threw === 4);
  const hostile = [NaN, Infinity, -5, 1e30, 3.7];
  check('hostile seeds never throw and still round-trip', hostile.every((s) => { try { const g = speciesBaseGenome('dollop', s); return genomeEquals(decodeGenome(encodeGenome(g)) as Genome, g); } catch { return false; } }));
}
{
  // decodeGenome: unknown species index still returns null; every catalog species decodes; index byte is the idx
  const g = speciesBaseGenome('constello', 1), code = encodeGenome(g);
  const b = Uint8Array.from(atob(code.slice(3).replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - ((code.length - 3) % 4)) % 4)), (c) => c.charCodeAt(0));
  check('the species byte in a share string is the idx', b[1] === speciesIdx('constello'));
  const tampered = (idx: number): string => { const arr = Uint8Array.from(b); arr[1] = idx; let bin = ''; for (const x of arr) bin += String.fromCharCode(x); return 'g1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  check('decodeGenome returns null for an unknown species index (50, 99, 255) and a species for 0..49', [50, 99, 255].every((i) => decodeGenome(tampered(i)) === null) && [0, 25, 49].every((i) => decodeGenome(tampered(i)) !== null));
}

/* ═══════════════════════════════════ 7. originality and language safety ═══════════════════════════════════ */
header('7. originality gate and language safety');
check(`denylist has at least 200 distinct real names (${DENY.length})`, DENY.length >= 200);
check('denylist covers the required families (squishmallow, jellycat, labubu, smiski, funko, sanrio, pokemon, nintendo/mario/kirby/zelda, plort/largo, adopt me, neopets, tamagotchi, pop it, play-doh, nee-doh, orbeez, silly putty, lego, minecraft, roblox)',
  ['squishmallow', 'jellycat', 'labubu', 'smiski', 'funko', 'sanrio', 'hellokitty', 'pokemon', 'pikachu', 'nintendo', 'mario', 'kirby', 'zelda', 'plort', 'largo', 'adoptme', 'neopets', 'tamagotchi', 'popit', 'playdoh', 'needoh', 'orbeez', 'sillyputty', 'lego', 'minecraft', 'roblox'].every((x) => DENY.includes(x)));
check('denylist includes the original 151 Pokemon (bulbasaur .. mew)', ['bulbasaur', 'charizard', 'pikachu', 'jigglypuff', 'snorlax', 'eevee', 'mewtwo', 'mew', 'psyduck', 'gengar', 'magikarp'].every((x) => DENY.includes(x)) && DENY_POKEMON.length >= 190);
let origOk = true; const origMsg: string[] = [];
for (const d of CATALOG) {
  const r1 = denyReason(d.name), r2 = denyReason(d.id), r3 = denyReasonText(d.blurb);
  if (r1 || r2 || r3) { origOk = false; origMsg.push(`${d.id}: ${r1 || r2 || r3}`); }
}
check('no species name, id or blurb contains or is within edit distance 1 of a real brand, character, toy line or game', origOk, origMsg.join(' | '));
// the gate itself must bite: known bad examples are caught, innocent words are not
check('the gate catches known near-misses (Squirmle~Squirtle, Dumplo~Duplo, Prongo~Pongo, Pikachi, Squishmellow, Labubo, Plortz, Kirbi, Funkoo)', ['Squirmle', 'Pikachi', 'Squishmellow', 'Labubo', 'Plortz', 'Kirbi', 'Funkoo', 'Jellycats', 'Mariooo', 'Dumplo', 'Prongo'].every((n) => denyReason(n) !== ''));
check('the gate does not cry wolf on innocent words (Dollop, Gloopsy, Munchip, Plumpet, Jelly, Squish)', ['Dollop', 'Gloopsy', 'Munchip', 'Plumpet', 'Jelly', 'Squish'].every((n) => denyReason(n) === ''));
let safeOk = true; const safeMsg: string[] = [];
for (const d of CATALOG) {
  const r = unsafeReason(d.name) || unsafeReason(d.id) || unsafeReasonText(d.blurb) || [...d.tags, d.silhouette].map((x) => unsafeReasonText(x)).find((x) => x) || '';
  if (r) { safeOk = false; safeMsg.push(`${d.id}: ${r}`); }
}
check(`language safety: no profanity, sexual, violent, drug or hate terms in names, ids, blurbs, tags or silhouette text (${SAFE.length} terms)`, safeOk, safeMsg.join(' | '));
check('the safety gate bites (rejects an obvious bad word, accepts innocent ones)', unsafeReason('Shitty') !== '' && unsafeReasonText('what the hell') !== '' && unsafeReason('Dollop') === '' && unsafeReasonText('A soft round friend.') === '');
check('every name is also a safe, plain reading: no name begins or ends with an unsafe 3-letter root (cum, ass, sex, tit, poo, pee)', CATALOG.every((d) => !/^(cum|ass|sex|tit|poo|pee|fag|nig)|(ass|sex|tit|poo|pee|fag|nig)$/.test(d.id)));

/* ═══════════════════════════════════ 8. rarity data (src/core/rarity.ts) ═══════════════════════════════════ */
header('8. rarity tables: odds, visual language, reveal budgets, haptics');
{
  check('public odds as percent numbers agree with the fractions (76.3 / 13 / 6 / 2.8 / 1.4 / 0.5)', TIER_ODDS_PERCENT.join('/') === '76.3/13/6/2.8/1.4/0.5' && TIER_ODDS_PERCENT.every((p, i) => Math.abs(p / 100 - TIER_ODDS[i]) < 1e-12));
  check('per-species odds and display labels', Math.abs(oddsPerSpecies('common') - 0.763 / 14) < 1e-12 && oddsLabel('common') === 'Common 76.3%' && oddsLabel('uncommon') === 'Uncommon 13%' && oddsLabel('mythic') === 'Mythic 0.5%');
  check('tier helpers: order, next tier (Mythic has none), type guard', TIERS.join() === 'common,uncommon,rare,epic,legendary,mythic' && nextTier('epic') === 'legendary' && nextTier('mythic') === undefined && tierFromIndex(5) === 'mythic' && isTierId('rare') && !isTierId('Rare') && !isTierId('__proto__'));
  check('every tier has a style entry whose id matches', TIER_STYLES.length === 6 && TIERS.every((t, i) => TIER_STYLE[t].id === t && TIER_STYLES[i] === TIER_STYLE[t] && TIER_STYLE[t].name === TIER_NAMES[t]));
  check('rarity is never colour-only: six distinct gem shapes, distinct frame colours, distinct tell colours, gem points 0/4/6/4/6/8', new Set(TIER_STYLES.map((x) => x.gem)).size === 6 && new Set(TIER_STYLES.map((x) => x.frameHex)).size === 6 && new Set(TIER_STYLES.map((x) => x.tellHex)).size === 6 && TIER_STYLES.every((x) => /^#[0-9a-f]{6}$/.test(x.frameHex) && /^#[0-9a-f]{6}$/.test(x.tellHex)) && TIER_STYLES.map((x) => x.gemPoints).join() === '0,4,6,4,6,8');
  check('the template genome is the species look, quantised, and round-trips', CATALOG.every((d) => { const g = speciesTemplateGenome(d.id); return g.species === d.id && g.seed === 0 && genomeEquals(decodeGenome(encodeGenome(g)) as Genome, g); }));
  const lum = (h: string): number => { const n = parseInt(h.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  check('every UI frame colour reads on the ink background #14102a (contrast >= 3:1)', TIER_STYLES.every((x) => contrast(x.frameHex, '#14102a') >= 3), TIER_STYLES.map((x) => contrast(x.frameHex, '#14102a').toFixed(1)).join(' '));
  check('flash budget: core pulses and table rings stay under 0.5 Hz (DESIGN 6.6), pillar only on Legendary, iridescence and satellites only on Mythic', TIER_STYLES.every((x) => x.fx.corePulseHz < 0.5 && x.fx.ringPulseHz < 0.5) && TIER_STYLES.filter((x) => x.fx.pillar).map((x) => x.id).join() === 'legendary' && TIER_STYLES.filter((x) => x.fx.iridescence > 0).map((x) => x.id).join() === 'mythic' && TIER_STYLES.filter((x) => x.fx.satellites > 0).map((x) => x.id).join() === 'mythic');
  const inc = (f: (x: typeof TIER_STYLES[number]) => number, strict = true): boolean => TIER_STYLES.every((x, i) => i === 0 || (strict ? f(x) > f(TIER_STYLES[i - 1]) : f(x) >= f(TIER_STYLES[i - 1])));
  check('reveal budgets rise with tier: capsule 1.6/2.0/2.6/3.2/3.9/4.5 s, merge 2.2/2.6/3.2/3.8/4.5/5.2 s (DESIGN 6.1)', TIER_STYLES.map((x) => x.reveal.openSeconds).join() === '1.6,2,2.6,3.2,3.9,4.5' && TIER_STYLES.map((x) => x.reveal.mergeSeconds).join() === '2.2,2.6,3.2,3.8,4.5,5.2');
  check('reveal escalation: pre-roll, burst motes, rings and camera arc never decrease; slow-motion only from Epic; audio duck only Mythic (DESIGN 6.3)', inc((x) => x.reveal.preRollSeconds, false) && inc((x) => x.reveal.motes) && inc((x) => x.reveal.rings, false) && inc((x) => x.reveal.cameraArcDegrees, false) && TIER_STYLES.filter((x) => x.reveal.timeScale < 1).map((x) => x.id).join() === 'epic,legendary,mythic' && TIER_STYLES.filter((x) => x.reveal.audioDuckMs > 0).map((x) => x.id).join() === 'mythic' && TIER_STYLE.mythic.reveal.audioDuckMs === 250);
  check('haptic patterns get longer with tier (DESIGN 6.7) and are positive whole milliseconds', inc((x) => x.haptic.length) && TIER_STYLES.every((x) => x.haptic.every((v) => Number.isInteger(v) && v > 0)) && TIER_STYLE.rare.haptic.join() === '10,50,14,50,18');
  check('every tier has a distinct sound key and the repeat-short open (0.8 s) exists only for Common and Uncommon', new Set(TIER_STYLES.map((x) => x.soundKey)).size === 6 && TIER_STYLES.map((x) => x.reveal.openSecondsRepeat).join() === '0.8,0.8,0,0,0,0');
  check('species per tier constants add up to 50', TIER_SPECIES_COUNTS.reduce((a, b) => a + b, 0) === 50 && TOTAL_SPECIES === 50);
}

console.log(`\n${bad ? bad + ' check(s) FAILED' : 'all catalog checks passed'}`);
process.exit(bad ? 1 : 0);
void speciesBaseGenome;
