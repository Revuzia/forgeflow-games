// Catalog probe: the 50-species roster as DATA must satisfy the design (DESIGN 5.2, 5.3, 9) and the engineering rules (append-only idx,
// share-string round trips, star-convex shapes, distinct silhouettes and palettes, originality and language safety).
// Plain node:  node _harness/probe_catalog.ts      (exit 1 on any failure; thresholds below are STATED, never loosened to pass)
//
// Every GATE here reads only src/core and src/data (colours through the palette contract src/data/palette.ts, the DOLLOP shape through a
// frozen snapshot), so a change in another lane can never turn this probe red by itself. Section 10 runs SEAM checks against the render
// and physics lanes' live code (does the renderer still draw the contract colours? does the physics DOLLOP still match the snapshot?);
// drift there is reported as SEAM-DRIFT and fails the run only with WH_STRICT_SEAMS=1 (integration runs), because the fix belongs to
// whichever side moved.
import { readFileSync } from 'node:fs';
import {
  CATALOG, SPECIES, SPECIES_BY_ID, SPECIES_BY_TIER, LANES, SIGNATURE_BIAS, speciesBaseGenome, speciesTemplateGenome, tierOf, familyOf, tierIndexOf, speciesIdx, getSpecies, isSpeciesId,
} from '../src/data/catalog.ts';
import type { SpeciesDef, SpeciesId, LaneId } from '../src/data/catalog.ts';
import {
  SHAPE_R_MIN, SHAPE_R_MAX, SHAPE_MIN_WIDTH, evalShape, shapeVolumeRatio, shapeBounds, shapeSlope, shapeDistance, forEachDirection, DOLLOP_RECIPE,
} from '../src/data/shapes.ts';
import { MATERIAL_FAMILY_IDS, MATERIAL_FAMILIES, MATERIAL_LIST, isMaterialFamilyId, materialDistance, resolveMaterial } from '../src/data/materials.ts';
import { TIERS, TIER_SPECIES_COUNTS, TOTAL_SPECIES, TIER_ODDS, TIER_NAMES, TIER_ODDS_PERCENT, TIER_STYLE, TIER_STYLES, oddsPerSpecies, oddsLabel, nextTier, tierFromIndex, isTierId } from '../src/core/rarity.ts';
import { quantizeGenome, encodeGenome, decodeGenome, genomeEquals, makeStarterGenome, randomGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { TASK_DEFS } from '../src/core/drops.ts';
import { bodyLab as paletteBodyLab, bodyLinear, coreLinear, labDistance } from '../src/data/palette.ts';
import { renderCatalogDoc, CATALOG_DOC_PATH } from './gen_catalog_doc.ts';

let bad = 0, seamDrift = 0;
const STRICT_SEAMS = process.env.WH_STRICT_SEAMS === '1';
const check = (name: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
/** A cross-lane contract check: printed always, counted as a failure only with WH_STRICT_SEAMS=1. */
const seam = (name: string, ok: boolean, extra = ''): void => { if (!ok) { seamDrift++; if (STRICT_SEAMS) bad++; } console.log(`${ok ? 'ok  ' : 'SEAM-DRIFT'} [seam] ${name}${extra ? '  ' + extra : ''}`); };
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
  dollopFitRms: 0.02, dollopFitMax: 0.1, // evalShape(DOLLOP_RECIPE) against the frozen physics DOLLOP snapshot below, units of R0
  lineageMargin: 0.01,        // OKLab margin by which a lineage-tinted merge result must stay nearer its own species centre (merge.ts)
};

/* ───────────────────────────── the locked registry (append-only!) ───────────────────────────── */
// When a species is APPENDED to SPECIES, append its id here in the same commit. Existing positions must never change.
// (idx 20 and 36 were re-slugged once, before launch, by the language-safety review: see src/data/species.ts rule 3.)
const IDX_LOCK: readonly string[] = [
  'dollop', 'plumpet', 'twangle', 'puddlo', 'glubbin', 'crumbit', 'chunkle', 'munchip', 'wisplet', 'cushlet', 'crimpo', 'thumbly', 'sproink', 'dimpla',
  'nuzzo', 'flickum', 'swishel', 'granulo', 'peakum', 'wrigglo', 'acornel', 'capnap', 'knubby', 'kneadle', 'hooplet',
  'spirelo', 'zingle', 'petalop', 'burrbin', 'marigel', 'gloopsy', 'hushpuff', 'drowsel', 'thudge', 'diademo',
  'taffelin', 'rattlebead', 'cindergoo', 'selenuff', 'pastrel', 'flipdome', 'caromel',
  'ambrosel', 'tidelume', 'glimglop', 'somnuff', 'fossilo',
  'skeinara', 'constello', 'prismelo',
];

/* ───────────────────────────── DESIGN 5.2 family-by-tier grid ───────────────────────────── */
// rows = lane, columns = Common Uncommon Rare Epic Legendary Mythic
const DESIGN_GRID: Record<LaneId, number[]> = {
  jelly: [3, 2, 2, 1, 1, 1], fill: [3, 2, 2, 1, 1, 1], chew: [2, 2, 2, 1, 1, 1], foam: [2, 2, 2, 1, 1, 0], dough: [2, 2, 1, 1, 1, 0], rubber: [2, 1, 1, 2, 0, 0],
};

/* ───────────────────────────── colour maths: the palette contract (src/data/palette.ts) ───────────────────────────── */
const dE = labDistance;
const centreGenome = (d: SpeciesDef): Genome => speciesTemplateGenome(d.id);
const bodyLab = (g: Genome): [number, number, number] => paletteBodyLab(g);

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
  'youtube', 'tiktok', 'instagram', 'snapchat', 'discord', 'twitch', 'xbox', 'playstation', 'atari', 'sega', 'fluffernutter', 'marshmallowfluff'];
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
const ORDINARY_WORDS = new Set(['golden', 'wobble', 'wobbles', 'twenty']); // golden~Goldeen, wobble~Sobble, twenty~Tweety: everyday English
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

/** Multi-word brands: a name that runs the START of the first word (>= 4 letters, or all of a shorter word, which must then begin the name)
 *  straight into the start of the second word (>= 3 letters) evokes the brand even though it contains neither word whole
 *  ("Fluffnut" -> "Fluffer Nutter", "Sillyputt" -> "Silly Putty"). Space-separated, lowercase. */
const DENY_COMPOUND = ['fluffer nutter', 'marshmallow fluff', 'silly putty', 'thinking putty', 'kinetic sand', 'play doh', 'nee doh', 'pop it', 'hello kitty', 'jolly rancher',
  'hot wheels', 'beanie babies', 'beanie boo', 'care bears', 'build a bear', 'fisher price', 'pop mart', 'skull panda', 'my little pony', 'polly pocket', 'cabbage patch',
  'peppa pig', 'paw patrol', 'sponge bob', 'hush puppies', 'kit kat', 'jelly cat', 'squish mallow', 'slime rancher', 'animal crossing', 'baby yoda', 'mr potato head',
  'huggy wuggy', 'kissy missy', 'poppy playtime', 'fall guys', 'candy crush', 'angry birds', 'among us', 'adopt me', 'my melody', 'tuxedo sam', 'moshi monsters',
  'lol surprise', 'little tikes', 'teddy ruxpin', 'buzz lightyear', 'winnie the pooh', 'peter rabbit', 'tom and jerry', 'bugs bunny', 'scooby doo', 'charlie brown',
  'play foam', 'jolly rancher', 'little twin stars', 'my little pony', 'sylvanian families', 'calico critters', 'thomas the tank', 'baby shark'];
/** Why `word` (a name or id) runs a multi-word brand's word starts together, or ''. */
function compoundReason(word: string): string {
  const w = norm(word);
  for (const c of DENY_COMPOUND) {
    const [a, b] = c.split(' ');
    const minA = Math.min(4, a.length), minB = Math.min(3, b.length);
    for (let i = 0; i < w.length; i++) {
      if (a.length < 4 && i > 0) break; // a short first word only counts at the start of the name
      for (let la = minA; la <= a.length && w.slice(i, i + la) === a.slice(0, la); la++) if (w.slice(i + la, i + la + minB) === b.slice(0, minB)) return `runs "${a.slice(0, la)}" into "${b.slice(0, minB)}" ("${c}")`;
    }
  }
  return '';
}

// ── Language safety ──
// Names are read aloud by players of every language, so the gate is MULTILINGUAL: profanity, sexual terms, slurs, violence and drugs in
// English plus Spanish (es, incl. Latin American usage), Portuguese (pt, incl. Brazilian), French (fr), Italian (it), German (de), Dutch (nl),
// Tagalog / Filipino (tl) and common internet slang (net). The multilingual lists and the harshest English entries are stored REVERSED
// (one space-separated string per language) so this file and code search stay clean; rev() restores them at load.
// Matching for a NAME or ID (one invented word, normalised to letters):
//   term of <= 3 letters  equal to the whole name, or (a short strong root) at its very start or end (SAFE_ROOTS);
//   4 letters             contained anywhere;
//   5 letters             contained anywhere, or the whole name SOUNDS within one edit of it;
//   6+ letters            any stretch of the name SOUNDS within one edit of it (substitution, insertion or deletion).
// "Sounds within one edit": a substitution only counts when the two letters sound alike (vowel for vowel, c/k/q, s/z/c, b/v/w, f/v, g/j, d/t,
// p/b, m/n); an inserted or deleted letter always counts. That catches respellings (a vowel swapped or a letter doubled inside a slur)
// without flagging ordinary English ("chunk", "clatter", "munch"). BLURBS, tags, silhouettes, family names/blurbs and task texts are
// English prose: a word fails if it equals a term (or contains one of 6+ letters), except a few ordinary English homographs.
const rev = (s: string): string => [...s].reverse().join('');
const SAFE_PLAIN = ['damn', 'hell', 'crap', 'piss', 'shit', 'fuck', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'boob', 'tits', 'sexy', 'sex', 'porn', 'nude', 'naked', 'rape', 'kill', 'murder', 'suicide', 'death', 'dead', 'die', 'blood', 'gore', 'gun',
  'shoot', 'bomb', 'terror', 'nazi', 'slave', 'drug', 'weed', 'pot', 'meth', 'cocaine', 'heroin', 'beer', 'wine', 'vodka', 'whisky', 'booze', 'drunk', 'smoke', 'cigar', 'vape', 'poop', 'pee', 'fart', 'butt', 'anus', 'penis', 'vagina', 'idiot',
  'stupid', 'dumb', 'retard', 'moron', 'ugly', 'fat', 'hate', 'devil', 'satan', 'demon', 'curse', 'hang', 'noose', 'knife', 'stab', 'abuse', 'cum', 'jizz', 'slut', 'whore', 'screw', 'wank', 'twat', 'prick'];
const SAFE_REVERSED = ['reggin', 'toggaf', 'tnuc', 'ssa'].map(rev);
const SAFE_LANG_REVERSED: Readonly<Record<string, string>> = {
  es: 'atup otup satup adreim redoj odidoj onoc norbac anorbac ojednep ajednep ragnihc adagnihc odagnihc agnihc ognihc agrev allop ehcnip oreluc oluc aciram nociram ocaram acaram nomam adamam ahconap ohcohc ahcnoc ajip agnip ojarac regoc rallof arroz arrep sallopilig ollupac aitsoh atupeujih odiraplam aerronog noveuh odulob odutolep oailuc noew acadus atargen otoj arellitrot arellob ajipapuhc oveugamam atenup senojoc nojoc etejo otro olort eteros',
  pt: 'ohlarac arrop adrem adof redof esadof atecub atecob atoxox atox acorip acip alor etecac atehnup odaiv daiv ahcib oatapas oazuc odabmorra acabab oirato onroc atsob acargsed adnubagav adafas ocacam ohletnep ocoirb olerg aciriris uconuap',
  fr: 'edrem drem niatup etup epolas dualas drannoc essannoc ennoc elucne relucne etib elliuoc selliuoc ettahc euqin reuqin relnarb ruelnarb ertuof ledrob edep ettepat eniuog ergen eluonguob aluobmab reihc buet erbihc essaiffuop essatep ecrag dratab buobz ettoif ezuolrat',
  it: 'ozzac zzac izzac aihcnim oznorts aznorts anattup aiort olucnaffav olucnaf agif acif enoilgoc inoilgoc oicorf oihcconif enoihccir oidocrop odratsab attongim aloccoz erapocs onipmop orgen enorret eragac eraicsip arrobs enniz enottaluc',
  de: 'essiehcs ssiehcs hcsra hcolhcsra nekcif kcif eztof znawhcs eruh reshciw eshciw lethcuwhcs regen ekcak essip nettit ihcsum ettun tsaps itsaps ognom ekanak trubegssim nhosneruh toidillov nesmub lemmip neztof eztarbkcak',
  nl: 'tuk lul kaztoolk reknak gniret sufyt emmodrevdog reoh rekkilf nekuen tnorts loognom rejilreknak tels feet omoh thcin fjiwtuk siruelp reteimedos fjiwekkat etolk revdog erelok rejiltsep rejilsufyt rejilgniret gnojnereoh turt eireols lons rekkur nepjip neffeb dniktuk ejteim seenihcpeop lekie reohreknak',
  tl: 'anignatup anignat ogag agnat lolu odatnarat totnak natutnak ekup itit tarub gayab kepkep lokaj alkab kopkop todnih uykap tehskap lapuk totu stite toyi laslas gobil gobilam domat talib away epep yadup toyab',
  net: 'ftw ufts oftg lmf flim flid toht wfsn iatneh ffiy oafml syk smk lecni kcuc paf yssub tayg ttayg noog gninoog remooc oageha atuf ilol atohs odep norp snafylno hautkwah zeed amgil amgus kcuhp kuf kcf quf hctb zza boob aboob sedun txes gnitxes pmis dms cciht kcid tun dettun anignam',
  en: 'lana esra elohesra elohssa renob odlid ynroh ygro msagro citore tcere pmuh krewt ytoob elppin nemes mreps hctorc elcitset mutorcs reggub skcollob reknaw ressot gals knaks knups nooc cips knihc koog ekik kcabtew ynnart ekyd zaps ikap daehlewot daehgar renaeb yknoh niksder wauqs aggin reltih kkk dahij tselom trevrep vrep tsecni ytilaitseb eniacoc dsl ysatsce muipo timov frab aehrraid drut eikood oopoop eeweew kcasllab kcastun yttit eittit seittit sboob mub elohmub gulpttub elohttub tilc avluv aibal modnoc argaiv sebup cibup latineg slatineg lauxes reppirts rekooh pmip lehtorb eporg eldnof knaps yknik msdb hsitef',
};
const SAFE_LANGS = Object.keys(SAFE_LANG_REVERSED);
const SAFE_BY_LANG: Readonly<Record<string, string[]>> = Object.fromEntries(SAFE_LANGS.map((k) => [k, SAFE_LANG_REVERSED[k].split(' ').map(rev)]));
const SAFE = [...new Set([...SAFE_PLAIN, ...SAFE_REVERSED, ...SAFE_LANGS.flatMap((k) => SAFE_BY_LANG[k])].map(norm))].filter((t) => t.length >= 2);
/** Short strong roots that may not begin (or end) a name even inside a longer word. */
const SAFE_ROOTS = /^(cum|ass|sex|tit|poo|pee|fag|nig|fap|kys|wtf|fuk|fck|kut|cul)|(cum|ass|sex|tit|poo|pee|fag|nig|fap|kys|wtf|fuk|fck|kut)$/;
/** Ordinary English words that equal a term from another list (Tagalog/Dutch slang, internet slang): allowed in English PROSE only, never in a name. */
const ENGLISH_HOMOGRAPHS = new Set(['nut', 'hump', 'bite']);
const VOWELS = 'aeiouy';
const SOUND_ALIKE = ['ckq', 'scz', 'bvw', 'fv', 'gj', 'dt', 'pb', 'mn'];
const alike = (x: string, y: string): boolean => (VOWELS.includes(x) && VOWELS.includes(y)) || SOUND_ALIKE.some((g) => g.includes(x) && g.includes(y));
/** Edit distance <= 1 where a substitution only counts between letters that sound alike. */
function soundsWithin1(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === b.length) { let d = -1; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { if (d >= 0) return false; d = i; } return alike(a[d], b[d]); }
  return within1(a, b);
}
/** Some stretch of `w` (length L-1..L+1 for a term of length L) sounds within one edit of `t`. */
function soundsInside(w: string, t: string): boolean {
  for (let len = t.length - 1; len <= t.length + 1; len++) for (let i = 0; i + len <= w.length; i++) if (soundsWithin1(w.slice(i, i + len), t)) return true;
  return false;
}
/** Name or id: why it is unsafe in any screened language, or ''. */
function unsafeReason(word: string): string {
  const w = norm(word);
  for (const t of SAFE) {
    if (t.length <= 3) { if (w === t) return `equals "${t}"`; continue; }
    if (w.includes(t)) return `contains "${t}"`;
    if (t.length === 5 && soundsWithin1(w, t)) return `sounds like "${t}"`;
    if (t.length >= 6 && soundsInside(w, t)) return `contains something that sounds like "${t}"`;
  }
  const m = SAFE_ROOTS.exec(w);
  return m ? `begins or ends with "${m[0]}"` : '';
}
/** English prose (blurb, tag, silhouette, family text, task text): any whole word equal to a term, or a word containing a term of 6+ letters. */
function unsafeReasonText(text: string): string {
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (!raw || ENGLISH_HOMOGRAPHS.has(raw)) continue;
    for (const t of SAFE) { if (raw === t) return `word "${raw}"`; if (t.length >= 6 && raw.includes(t)) return `word "${raw}" contains "${t}"`; }
  }
  return '';
}

/* ───────────────────────────── the frozen physics DOLLOP ───────────────────────────── */
// restPoint('dollop', u, R0 = 1) of src/physics/shape.ts at DOLLOP_SNAPSHOT_N fixed directions (forEachDirection), frozen on 2026-10-05
// (identical to the version the catalog recipe was first fitted against). Int16 little-endian, x/y/z * 10000, base64. The section-4 gate
// fits DOLLOP_RECIPE against these numbers, so a physics rewrite cannot move the catalog gate; section 10 reports (SEAM) when the live
// physics no longer matches. Refresh after an INTENDED physics shape change:  node _harness/probe_catalog.ts --freeze-dollop
const DOLLOP_SNAPSHOT_N = 400;
const DOLLOP_SNAPSHOT =
  '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';
function dollopSnapshot(): Float64Array {
  const buf = Buffer.from(DOLLOP_SNAPSHOT, 'base64');
  const out = new Float64Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 10000;
  return out;
}
type RestPointFn = (species: string, dx: number, dy: number, dz: number, R0: number, out: number[], o: number) => number;
function sampleDollop(restPoint: RestPointFn): Float64Array {
  const out = [0, 0, 0], pts = new Float64Array(DOLLOP_SNAPSHOT_N * 3);
  forEachDirection(DOLLOP_SNAPSHOT_N, (x, y, z, i) => { restPoint('dollop', x, y, z, 1, out, 0); pts[i * 3] = out[0]; pts[i * 3 + 1] = out[1]; pts[i * 3 + 2] = out[2]; });
  return pts;
}
if (process.argv.includes('--freeze-dollop')) {
  const { restPoint } = (await import('../src/physics/shape.ts')) as unknown as { restPoint: RestPointFn };
  const pts = sampleDollop(restPoint), buf = Buffer.alloc(pts.length * 2);
  pts.forEach((v, i) => buf.writeInt16LE(Math.round(v * 10000), i * 2));
  console.log(buf.toString('base64'));
  process.exit(0);
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
// The wire format, pinned end to end: these literal share strings were written once (the starter genome with its species byte set to
// 0 / 7 / 20 / 36 / 47 / 49) and must decode to these species forever. A reorder, a deleted entry or a slug change in SPECIES fails here.
{
  const WIRE: Array<[string, string]> = [
    ['g1.AQAAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA', 'dollop'], ['g1.AQcAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA', 'munchip'], ['g1.ARQAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA', 'acornel'],
    ['g1.ASQAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA', 'rattlebead'], ['g1.AS8AAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA', 'skeinara'], ['g1.ATEAAAkQAQ0gAAoA0aPMx-BhvZ6ATQCAgIA', 'prismelo'],
  ];
  const got = WIRE.map(([code]) => decodeGenome(code)?.species ?? 'null');
  check('pinned share strings decode to their species (idx byte 0/7/20/36/47/49 -> dollop/munchip/acornel/rattlebead/skeinara/prismelo) and re-encode to the same text',
    WIRE.every(([code, id], i) => got[i] === id && encodeGenome(decodeGenome(code) as Genome) === code), got.join(' '));
}
check('lookup is safe against hostile ids', getSpecies('__proto__') === undefined && getSpecies('constructor') === undefined && getSpecies(7) === undefined && !isSpeciesId('toString') && SPECIES_BY_ID['dollop'].idx === 0);
check('SPECIES_BY_TIER matches', SPECIES_BY_TIER.every((l, t) => l.length === TIER_SPECIES_COUNTS[t] && l.every((d) => tierIndexOf(d.id) === t)));
{
  let threw = 0; for (const x of ['', 'nope', '__proto__', 'DOLLOP']) { try { tierOf(x as SpeciesId); } catch (e) { if (e instanceof RangeError) threw++; } try { familyOf(x as SpeciesId); } catch (e) { if (e instanceof RangeError) threw++; } }
  check('tierOf / familyOf answer for known species (dollop common jellygel, rattlebead epic beadsqueeze, prismelo mythic gummy) and throw RangeError for unknown ids',
    (() => { try { return tierOf('dollop') === 'common' && familyOf('dollop') === 'jellygel' && tierOf('rattlebead') === 'epic' && familyOf('rattlebead') === 'beadsqueeze' && tierOf('prismelo') === 'mythic' && familyOf('prismelo') === 'gummy'; } catch { return false; } })() && threw === 8);
}
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
// dollop against the FROZEN physics DOLLOP (see DOLLOP_SNAPSHOT below; section 10 checks the live physics against the same snapshot)
{
  const pts = dollopSnapshot();
  let s = 0, mx = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const l = Math.hypot(pts[i], pts[i + 1], pts[i + 2]);
    const e = evalShape(DOLLOP_RECIPE, pts[i] / l, pts[i + 1] / l, pts[i + 2] / l) - l;
    s += e * e; mx = Math.max(mx, Math.abs(e));
  }
  const rms = Math.sqrt(s / (pts.length / 3));
  check(`DOLLOP recipe reproduces the frozen physics rest shape (${pts.length / 3} points; RMS <= ${T.dollopFitRms}, worst <= ${T.dollopFitMax} R0)`, rms <= T.dollopFitRms && mx <= T.dollopFitMax, `RMS ${f3(rms)}, worst ${f3(mx)} (at the peak tip)`);
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
// "Rarity is in the material" is judged on the RESOLVED look: resolveMaterial(family, the species' template genome).look, the numbers a
// consumer draws with (src/data/materials.ts passes the genome's translucency / gloss / coreGlow / glitter through, so the family can never
// flatten a tier's look). The raw catalog means are printed next to them.
const resolved = (d: SpeciesDef): ReturnType<typeof resolveMaterial>['look'] => resolveMaterial(d.family, centreGenome(d)).look;
const glow = byTier((d) => resolved(d).coreGlow), glit = byTier((d) => resolved(d).glitter), trans = byTier((d) => resolved(d).translucency), chroma = byTier((d) => d.look.chroma);
const rawGlow = byTier((d) => d.look.coreGlow), rawTrans = byTier((d) => d.look.translucency);
console.log(`tier means (resolved)  coreGlow ${glow.map(f2).join(' ')} | glitter ${glit.map(f2).join(' ')} | translucency ${trans.map(f2).join(' ')} | chroma ${chroma.map(f2).join(' ')}`);
console.log(`tier means (raw catalog) coreGlow ${rawGlow.map(f2).join(' ')} | translucency ${rawTrans.map(f2).join(' ')}`);
check('rarity is in the material: mean RESOLVED coreGlow rises strictly with tier', glow.every((g, i) => i === 0 || g > glow[i - 1]));
check('rarity is in the material: mean RESOLVED glitter rises strictly with tier', glit.every((g, i) => i === 0 || g > glit[i - 1]));
check('rarity is in the material: mean RESOLVED translucency never falls with tier', trans.every((g, i) => i === 0 || g >= trans[i - 1] - 1e-9));
check('resolution keeps every species\' own look: resolved translucency / gloss / coreGlow / glitter equal the template genome\'s (no family override)',
  CATALOG.every((d) => { const g = centreGenome(d), r = resolved(d); return r.translucency === g.translucency && r.gloss === g.gloss && r.coreGlow === g.coreGlow && r.glitter === g.glitter; }));
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
  const r1 = denyReason(d.name), r2 = denyReason(d.id), r3 = denyReasonText(d.blurb), r4 = compoundReason(d.name) || compoundReason(d.id);
  if (r1 || r2 || r3 || r4) { origOk = false; origMsg.push(`${d.id}: ${r1 || r2 || r3 || r4}`); }
}
check('no species name, id or blurb contains or is within edit distance 1 of a real brand, character, toy line or game, or runs a multi-word brand together', origOk, origMsg.join(' | '));
// the gate itself must bite: known bad examples are caught, innocent words are not
check('the gate catches known near-misses (Squirmle~Squirtle, Dumplo~Duplo, Prongo~Pongo, Pikachi, Squishmellow, Labubo, Plortz, Kirbi, Funkoo)', ['Squirmle', 'Pikachi', 'Squishmellow', 'Labubo', 'Plortz', 'Kirbi', 'Funkoo', 'Jellycats', 'Mariooo', 'Dumplo', 'Prongo'].every((n) => denyReason(n) !== ''));
check('the multi-word brand rule bites (Fluffnut ~ Fluffer Nutter, Sillyputt, Hellokit, Jellycato, Peppapigs, Kitkatto) and spares look-alikes (Jellycap, Hushpuff, Caromel, Constello)',
  ['Fluffnut', 'Sillyputt', 'Hellokit', 'Jellycato', 'Peppapigs', 'Kitkatto'].every((n) => compoundReason(n) !== '') && ['Jellycap', 'Hushpuff', 'Caromel', 'Constello', 'Dollop'].every((n) => compoundReason(n) === ''),
  ['Fluffnut', 'Jellycap'].map((n) => `${n}: ${compoundReason(n) || 'ok'}`).join('; '));
check('the gate does not cry wolf on innocent words (Dollop, Gloopsy, Munchip, Plumpet, Jelly, Squish)', ['Dollop', 'Gloopsy', 'Munchip', 'Plumpet', 'Jelly', 'Squish'].every((n) => denyReason(n) === ''));

// language safety over EVERY player-facing or design-facing string the data layer owns
const LANG_COVERAGE = ['es', 'pt', 'fr', 'it', 'de', 'nl', 'tl', 'net', 'en'];
check(`the language list covers English, Spanish, Portuguese, French, Italian, German, Dutch, Tagalog and internet slang (${SAFE.length} terms; >= 25 per language)`,
  LANG_COVERAGE.every((k) => (SAFE_BY_LANG[k] ?? []).length >= 25), LANG_COVERAGE.map((k) => `${k} ${(SAFE_BY_LANG[k] ?? []).length}`).join(' '));
let safeOk = true; const safeMsg: string[] = [];
for (const d of CATALOG) {
  const r = unsafeReason(d.name) || unsafeReason(d.id) || unsafeReasonText(d.blurb) || [...d.tags, d.silhouette].map((x) => unsafeReasonText(x)).find((x) => x) || '';
  if (r) { safeOk = false; safeMsg.push(`${d.id}: ${r}`); }
}
check(`language safety (9 language lists, substring + sound-alike edit distance 1): no unsafe species name, id, blurb, tag or silhouette text`, safeOk, safeMsg.join(' | '));
{
  const other: Array<[string, string]> = [];
  for (const f of MATERIAL_LIST) other.push([`family ${f.id} name`, f.name], [`family ${f.id} blurb`, f.blurb]);
  for (const l of LANES) other.push([`lane ${l.id}`, l.name]);
  for (const t of TIERS) other.push([`tier ${t}`, TIER_NAMES[t]]);
  for (const t of TASK_DEFS) other.push([`task ${t.id}`, t.text]);
  const hits = other.map(([where, text]) => [where, unsafeReasonText(text) || denyReasonText(text)]).filter(([, r]) => r);
  check(`language safety and originality of the other data strings (${other.length}: family names and blurbs, lane and tier names, daily task texts)`, hits.length === 0, hits.map(([w, r]) => `${w}: ${r}`).join(' | '));
}
{
  // the gate must bite in every language and on respellings, and must not cry wolf on ordinary words. Bad examples stored reversed.
  const BAD = 'nocaram nokiram anociram legnatup olozzac olodrem olagrev ojednep ognihc uhlarac atecub iznawhcs oreknak oanignat elkcif ystuk ottayg anignam eltoop ekatihs oetup odrannoc leznorts orekkilf okepkep lekuen ohnidaiv einoog'.split(' ').map(rev);
  const missed = BAD.filter((n) => unsafeReason(n) === '');
  const INNOCENT = ['Dollop', 'Munchip', 'Chunkle', 'Clatterbead', 'Acornel', 'Rattlebead', 'Diademo', 'Constello', 'Marigel', 'Caromel', 'Puddlo', 'Pastrel', 'Hushpuff', 'Peakum', 'Flickum', 'Mangolo', 'Twinkle'];
  const wolf = INNOCENT.filter((n) => unsafeReason(n) !== '');
  check(`the language gate bites: ${BAD.length} respelled unsafe names across es/pt/fr/it/de/nl/tl/slang are all rejected`, missed.length === 0, missed.length ? `missed ${missed.length}` : '');
  check('the language gate does not cry wolf on ordinary-sounding names (Munchip, Chunkle, Clatterbead, Acornel, Diademo, Constello, Mangolo, Twinkle ...)', wolf.length === 0, wolf.map((n) => `${n}: ${unsafeReason(n)}`).join(' | '));
  check('prose screening: an unsafe word is caught, an ordinary English homograph is not', unsafeReasonText('what the hell') !== '' && unsafeReasonText(`una ${rev('adreim')}`) !== '' && unsafeReasonText('A soft round friend.') === '' && unsafeReasonText('Take a bite of this nut-brown hump.') === '');
}
check('every name is also a safe, plain reading: no name begins or ends with an unsafe short root (cum, ass, sex, tit, poo, pee, kut ...)', CATALOG.every((d) => !SAFE_ROOTS.test(d.id)));

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

/* ═══════════════════════════════════ 9. the generated doc cannot go stale ═══════════════════════════════════ */
header('9. _spec/CATALOG.md is exactly what the data generates');
{
  let onDisk = '';
  try { onDisk = readFileSync(CATALOG_DOC_PATH, 'utf8'); } catch { onDisk = ''; }
  const want = renderCatalogDoc();
  const a = onDisk.split('\n'), b = want.split('\n');
  let first = -1; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { first = i; break; }
  check('_spec/CATALOG.md matches renderCatalogDoc() byte for byte (if not: node _harness/gen_catalog_doc.ts, never a hand edit)', onDisk === want,
    first >= 0 ? `first difference at line ${first + 1}: on disk "${(a[first] ?? '<missing>').slice(0, 70)}" vs generated "${(b[first] ?? '<missing>').slice(0, 70)}"` : '');
}

/* ═══════════════════════════════════ 10. SEAMS with other lanes (informative unless WH_STRICT_SEAMS=1) ═══════════════════════════════════ */
header(`10. seams: the render lane draws the palette contract, the physics DOLLOP is the frozen snapshot${STRICT_SEAMS ? ' (STRICT)' : ''}`);
{
  type PaletteFn = (g: Genome) => { body: number[]; core: number[] };
  let genomePalette: PaletteFn | null = null, why = '';
  try { genomePalette = ((await import('../src/render/oklch.ts')) as unknown as { genomePalette: PaletteFn }).genomePalette; } catch (e) { why = String(e).slice(0, 120); }
  if (!genomePalette) seam('render lane module src/render/oklch.ts loads (genomePalette)', false, why);
  else {
    const gs: Genome[] = [...CATALOG.map(centreGenome), ...CATALOG.flatMap((d) => [1, 2, 3].map((k) => speciesBaseGenome(d.id, k * 7919))), ...Array.from({ length: 200 }, (_, i) => randomGenome(i))];
    let worst = 0, where = '';
    for (const g of gs) {
      const p = genomePalette(g), b = bodyLinear(g), c = coreLinear(g);
      const d = Math.max(...b.map((v, i) => Math.abs(v - p.body[i])), ...c.map((v, i) => Math.abs(v - p.core[i])));
      if (d > worst) { worst = d; where = encodeGenome(g); }
    }
    seam(`the renderer's genomePalette body and core colours equal the palette contract src/data/palette.ts (${gs.length} genomes, max linear-RGB difference <= 1e-9)`, worst <= 1e-9, worst > 1e-9 ? `max ${worst.toExponential(2)} at ${where}: the render lane changed the drawn colour; it should import src/data/palette.ts, or the catalog colour gates must be re-run against the new formula` : '');
  }
  let restPoint: RestPointFn | null = null; why = '';
  try { restPoint = ((await import('../src/physics/shape.ts')) as unknown as { restPoint: RestPointFn }).restPoint; } catch (e) { why = String(e).slice(0, 120); }
  if (!restPoint) seam('physics lane module src/physics/shape.ts loads (restPoint)', false, why);
  else {
    const live = sampleDollop(restPoint), snap = dollopSnapshot();
    let mx = 0; for (let i = 0; i < live.length; i++) mx = Math.max(mx, Math.abs(live[i] - snap[i]));
    seam(`the physics DOLLOP rest shape still equals the frozen snapshot (${DOLLOP_SNAPSHOT_N} points, max difference <= 1e-4 R0)`, mx <= 1e-4, mx > 1e-4 ? `max ${mx.toFixed(4)} R0: physics changed the DOLLOP shape; refit DOLLOP_RECIPE (src/data/shapes.ts) and refresh the snapshot with --freeze-dollop` : '');
  }
  if (seamDrift) console.log(`(${seamDrift} seam check(s) drifted${STRICT_SEAMS ? ' and count as failures' : '; informative here, set WH_STRICT_SEAMS=1 to make them fail'})`);
}

console.log(`\n${bad ? bad + ' check(s) FAILED' : 'all catalog checks passed'}${seamDrift && !STRICT_SEAMS ? ` (${seamDrift} seam drift(s) reported above)` : ''}`);
process.exit(bad ? 1 : 0);
