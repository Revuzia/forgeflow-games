// The name gate as an importable module (PG_DATA, task T6): the gate functions of _harness/probe_catalog.ts lines 76-297 (`denyReason`,
// `compoundReason`, `unsafeReason`, `denyReasonText`, `unsafeReasonText` and their lists), copied UNCHANGED between the two markers below.
// _harness/probe_pg_data.ts row T6 checks that the copied block still equals probe_catalog.ts's text byte for byte, so a later change to the
// gate there is noticed here. Never edit the block by hand: re-copy it from probe_catalog.ts. Never loosen it.
// Split of use (PLACES 7): coined single words go through the NAME rules (denyReason, compoundReason, unsafeReason); every other name and all
// copy through the PROSE rules (denyReasonText, unsafeReasonText).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ==== BEGIN COPY OF probe_catalog.ts 76-297 ====
/* ───────────────────────────── originality + language safety ───────────────────────────── */
// Real brands, characters, toy lines, games and trademarks, in two kinds of list. Lowercase, letters only after normalisation (spaces,
// hyphens, punctuation and accents are removed).
//   CURATED (inline below): toys, games, characters, brands, 40 Neopets species and the 190 best-known Pokemon (the original 151 + common
//     later ones). Hand-picked: a kid would recognise a near-respelling of any of them even in a sentence.
//   WIDE (generated from a named source, never hand-edited; _harness/data/): EVERY official English Pokemon species name (deny_pokemon.json:
//     National Pokedex 1..1025, generations 1-9, from PokeAPI), the main Digimon, all 55 Neopets species and the six Moshi Monsters
//     (deny_creatures.json).
// A species NAME or ID is screened against BOTH kinds with every rule: it fails if it equals an entry, contains it (entry of 5+ letters)
// or sits within edit distance 1 of it, as SPELLED or as READ ALOUD (spoken() below: "Drowsel" reads "drowsel", one sound from "Drowzee"
// read "drowsee"); an entry of 4 letters only counts against the WHOLE name (or its sound), 3 letters or fewer: equal only.
// BLURBS and the other prose are English: a word fails by edit distance 1 against the CURATED lists (as before), by whole-word equality
// against the WIDE lists, and the letters-only text fails if it contains any entry of 8+ letters. The wide lists are mostly coined from
// English words one letter away (Flittle / little, Swellow / swallow, Starly / starry, Nymble / nimble, Vullaby / lullaby, Palmon /
// salmon), so edit distance 1 in prose would reject plain English; a NAME is what a trademark protects, and names get every rule.
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
const norm = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const DENY_CURATED = [...new Set([...DENY_TOYS, ...DENY_GAMES, ...DENY_NEOPETS, ...DENY_POKEMON, ...DENY_CHARACTERS, ...DENY_BRANDS].map(norm))].filter((x) => x.length >= 2);
// the WIDE lists, read from their generated files (sources and dates inside each file)
const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
interface NameList { source?: string; count: number; names: string[] }
const POKEMON_FILE = JSON.parse(readFileSync(resolve(HARNESS_DIR, 'data/deny_pokemon.json'), 'utf8')) as NameList & { species: number; multiword: string[] };
const CREATURES_FILE = JSON.parse(readFileSync(resolve(HARNESS_DIR, 'data/deny_creatures.json'), 'utf8')) as Record<'digimon' | 'neopets' | 'moshi', NameList>;
const DENY_POKEMON_ALL: readonly string[] = POKEMON_FILE.names;
const DENY_DIGIMON: readonly string[] = CREATURES_FILE.digimon.names, DENY_NEOPETS_ALL: readonly string[] = CREATURES_FILE.neopets.names, DENY_MOSHI: readonly string[] = CREATURES_FILE.moshi.names;
const DENY_WIDE = [...new Set([...DENY_POKEMON_ALL, ...DENY_DIGIMON, ...DENY_NEOPETS_ALL, ...DENY_MOSHI].map(norm))].filter((x) => x.length >= 2);
/** Wide-list entries that are themselves everyday English words (a Neopet called Buzz, a Moshi Monster called Poppet, the Digimon Daemon):
 *  screened in NAMES with every rule, never in prose ("a little buzz" is English). */
const WIDE_NAME_ONLY = new Set(['buzz', 'bruce', 'chia', 'koi', 'lenny', 'techo', 'poppet', 'daemon']);
const WIDE_PROSE = new Set(DENY_WIDE.filter((t) => !WIDE_NAME_ONLY.has(t)));
/** Every entry (names are screened against all of them). */
const DENY = [...new Set([...DENY_CURATED, ...DENY_WIDE])];
/** The same entries as they sound (spoken() is defined with the language gate below; function declarations are hoisted). */
const DENY_SPOKEN = DENY.map((t) => spoken(t));

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
/** Why `word` (a species name or id, one whole token) is too close to a real name, as spelled or as read aloud, or '' if it is fine. */
function denyReason(word: string): string {
  const w = norm(word), sw = spoken(w);
  for (let k = 0; k < DENY.length; k++) {
    const t = DENY[k], st = DENY_SPOKEN[k];
    if (t.length <= 3) { if (w === t) return `equals "${t}"`; if (sw === st) return `read aloud, equals "${t}"`; continue; }
    if (t.length >= 5 && w.includes(t)) return `contains "${t}"`;
    if (within1(w, t)) return `within edit distance 1 of "${t}"`;
    if (st.length >= 5 && sw.includes(st)) return `read aloud, contains "${t}" ("${sw}" holds "${st}")`;
    if (within1(sw, st)) return `read aloud, within one sound of "${t}" ("${sw}" ~ "${st}")`;
  }
  return '';
}
// Ordinary English words that merely resemble a CURATED entry (Pokemon "Goldeen" vs "golden"): allowed inside prose only, never as a name.
// golden~Goldeen, wobble~Sobble, twenty~Tweety, mitten~Litten: everyday English
const ORDINARY_WORDS = new Set(['golden', 'wobble', 'wobbles', 'twenty', 'mitten', 'kitten']);
/** The same for prose (a blurb, tag, silhouette, family or task text): long entries against the letters-only text, then word by word
 *  (edit distance 1 against the CURATED lists, whole-word equality against the WIDE lists; see the rules above DENY_TOYS). */
function denyReasonText(text: string): string {
  const flat = norm(text);
  for (const t of DENY) if (t.length >= 8 && !WIDE_NAME_ONLY.has(t) && flat.includes(t)) return `contains "${t}"`;
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length < 4 || ORDINARY_WORDS.has(raw)) continue;
    if (WIDE_PROSE.has(raw)) return `word "${raw}" is a listed name`;
    for (const t of DENY_CURATED) { if (t.length <= 3) continue; if (within1(raw, t) && !(raw.length <= 5 && t.length <= 5 && raw !== t)) return `word "${raw}" ~ "${t}"`; }
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
  'play foam', 'little twin stars', 'sylvanian families', 'calico critters', 'thomas the tank', 'baby shark',
  // every two-word official Pokemon name (Mr. Mime, Tapu Koko, Iron Moth, Roaring Moon ...), from the generated list
  ...POKEMON_FILE.multiword];
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
// Tagalog / Filipino (tl) and common internet slang (net) as the required core, and the next largest player languages in romanised form:
// Japanese (ja), Polish (pl), Russian (ru), Turkish (tr), Indonesian / Malay (id), Finnish (fi), Hindi (hi) and Arabic (ar). The multilingual
// lists and the harshest English entries are stored REVERSED (one space-separated string per language) so this file and code search stay
// clean; rev() restores them at load.
// Matching for a NAME or ID (one invented word, normalised to letters):
//   term of <= 3 letters  equal to the whole name, or (a short strong root) at its very start or end as it SOUNDS (SAFE_ROOTS on spoken());
//   4 letters             contained anywhere, as spelled or as it sounds (spoken(): "Phart" contains "fart", "Kunt" ...);
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
  ja: 'oknam oknamo oknihc opnihc oknu osuk orayosuk akab orayakab iappo ihcce namiray amatnik nakihc iagihcik eamijnihs oha ustek',
  pl: 'awruk juhc juh adzip cabej ynabej satuk elodreip cilodreip apud apic nysywruks atamzs atoic jaladreips bejz libed lewc',
  ru: 'taylb daylb dajlb akus cedzip yuhk yuh iuh kadum tabe tabey nalbe onvog rodip sarodip radip apohz apulaz ahkuylhs beoblod iuhan yuhan',
  tr: 'kma anima miyokanima ritkis sikis mirekis upsoro karray karay enbi tavag ephak knevezep katlak ilakezireg kis',
  id: 'lotnok kemem totnegn totne tasgnab tubmej kolbog lolot gnijna ibab terpmak tatnap kamikup ikup uacnal ladnus rucalep nagnijab tarapek kocnaj kucnaj usa',
  fi: 'elekrep uttiv anataas aksap aapisuk ittevleh arouh esrep apryk ukklum ataknur',
  hi: 'ayituhc aituhc tuhc dohcnehb dohcneheb dohcradam dohcredam dnaag dnag dnul adual adval idnar idsohb ekidsohb adsohb imarah attuk animak yenimak tnaahj ittat',
  ar: 'atuomrahs atumrahs toomrahs ssuk kamosok kamossuk ibbez erya irya arahk kaynam kantem blak ramh blaknbi sahlet lemaz abhak abhag',
};
const SAFE_LANGS = Object.keys(SAFE_LANG_REVERSED);
const SAFE_BY_LANG: Readonly<Record<string, string[]>> = Object.fromEntries(SAFE_LANGS.map((k) => [k, SAFE_LANG_REVERSED[k].split(' ').map(rev)]));
const SAFE = [...new Set([...SAFE_PLAIN, ...SAFE_REVERSED, ...SAFE_LANGS.flatMap((k) => SAFE_BY_LANG[k])].map(norm))].filter((t) => t.length >= 2);
/**
 * How a word SOUNDS, as a spelling: ph -> f, ck / q / hard c -> k, soft c (before e, i, y) -> s, x -> ks, z -> s, ea -> ee. Kid humour
 * reads names aloud, so "Peakum" is "pee" + "kum" and "Phartlo" holds "fart" even though neither spells the word.
 */
function spoken(w: string): string {
  return norm(w).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/ch/g, '\u0001').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/\u0001/g, 'ch').replace(/x/g, 'ks').replace(/z/g, 's').replace(/ea/g, 'ee');
}
/** Short strong roots that may not begin (or end) a name even inside a longer word, matched on the SPOKEN form of the name. */
const SAFE_ROOT_LIST = ['cum', 'ass', 'sex', 'tit', 'poo', 'pee', 'fag', 'nig', 'fap', 'kys', 'wtf', 'fuk', 'fck', 'kut', 'cul', 'gay'].map(spoken);
const SAFE_ROOTS = new RegExp(`^(${SAFE_ROOT_LIST.join('|')})|(${SAFE_ROOT_LIST.filter((r) => r !== 'kul').join('|')})$`);
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
  const sw = spoken(w);
  for (const t of SAFE) {
    if (t.length <= 3) { if (w === t) return `equals "${t}"`; continue; }
    if (w.includes(t)) return `contains "${t}"`;
    if (t.length === 4 && spoken(t).length >= 4 && sw.includes(spoken(t))) return `sounds like it contains "${t}"`; // (a term that shrinks, "dick" -> "dik", is left to the literal rule)
    if (t.length === 5 && soundsWithin1(w, t)) return `sounds like "${t}"`;
    if (t.length >= 6 && soundsInside(w, t)) return `contains something that sounds like "${t}"`;
  }
  const m = SAFE_ROOTS.exec(sw);
  return m ? `begins or ends with the sound "${m[0]}"` : '';
}
/** English prose (blurb, tag, silhouette, family text, task text): any whole word equal to a term, or a word containing a term of 6+ letters. */
function unsafeReasonText(text: string): string {
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (!raw || ENGLISH_HOMOGRAPHS.has(raw)) continue;
    for (const t of SAFE) { if (raw === t) return `word "${raw}"`; if (t.length >= 6 && raw.includes(t)) return `word "${raw}" contains "${t}"`; }
  }
  return '';
}
// ==== END COPY ====

export { norm, within1, spoken, denyReason, compoundReason, unsafeReason, denyReasonText, unsafeReasonText, DENY, DENY_CURATED, DENY_WIDE, SAFE };
/** The NAME rules on one coined word: '' when it passes, else the first reason. */
export function nameReason(word: string): string { return denyReason(word) || compoundReason(word) || unsafeReason(word); }
/** The PROSE rules on any text: '' when it passes, else the first reason. */
export function proseReason(text: string): string { return denyReasonText(text) || unsafeReasonText(text); }
