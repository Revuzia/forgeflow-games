// PLAYGROUND player text: every quest title and hint, the chapter, thing, zone, patch and keepsake names, the fact lines (templates per fact
// and family, the name filled in), the family lines (F4..F7), the wish, gift and screen lines. Specs: _spec/QUESTS.md (6, 8, 9, 10, 15),
// _spec/PLACES.md (3, 5, 7), _spec/LIFE.md 5.6. Owned by the DATA lane (PG_DATA).
// LOADING (D-42, D-69): LAZY: the screens chunk and the away chunk import it; it is never imported from places.ts, life.ts, quests.ts or a
// place module. The words of PLACES 4's per-thing cells do not ship (their channels do, D-80); the only reaction words a player reads are
// FAMILY_LINES. Plain, kind words a seven-year-old can read (QUESTS Q10); "kind" only ever means a family (D-82); a line names a place only
// while it has shipped (PLACE_INFO.shipped). DT-02 (the name gate split, the copy words, CS-05 on names) and DT-08 (lengths) screen it all.
import type { PlaceId, ThingId } from './places.ts';
import type { MaterialFamilyId } from './materials.ts';

/** Fill a template's {keys} (a missing key leaves '{key}', which DT-08 would flag in a probe line). */
export function fill(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** The 110 quest idx' [title, hint] (QUESTS 6.0 to 6.10 as written; one fix: R9's hint names its count, "two times", as Q7 and DT-09 require).
 *  Home's ten are also in quests.ts HOME_TEXT (the tracker needs them before this chunk). D-96: the 30 quests of the dropped places (idx 50..69,
 *  80..89) are empty tombstones: no line names a dropped place or its things. */
export const QUEST_TEXT: readonly (readonly [string, string])[] = [
  ['A gentle squeeze', 'Press and hold your squishy for a moment.'], // H1
  ['Watch it play', 'Let go and wait a little.'], // H2
  ['A big stretch', 'Pull it out, then let go.'], // H3
  ['Open a capsule', 'Squeeze and stretch to fill the meter.'], // H4
  ['Say hello', 'Two squishies out together will say hello.'], // H5
  ['Tap a bubble', 'Tap a bubble to see what it means.'], // H6
  ['A first wish', 'Tap the thought bubble to read it.'], // H7
  ['A wish comes true', 'Go to the place on the postcard.'], // H8
  ['Roll the felt ball', 'Flick the Felt Ball three times.'], // H9
  ['Nap time', 'Two squishies nap on the Snooze Rug.'], // H10
  ['Come in from the snow', 'Go to Hearthlog Cabin.'], // C1
  ['Cozy by the fire', 'Two squishies warm up by the fire.'], // C2
  ['A push on the swing', 'Set one on the swing. A friend may push it.'], // C3
  ['Chase the yarn', 'Two squishies chase the Yarn Ball.'], // C4
  ['Two on the rocker', 'Set two squishies on the Rocker Board.'], // C5
  ['Little bits by the fire', 'Cut a squishy into three, near the fire.'], // C6
  ['Answer the kettle', 'When the kettle whistles, someone sings back.'], // C7
  ['Fireside song', 'Tap the fireplace. Then three sing together.'], // C8
  ['Toasty and golden', 'A marshmallow toasts, or a mochi rises.'], // C9
  ['Who loves the cabin?', 'Find a squishy that loves it here.'], // C10
  ['Sand and sea', 'Go to Ripple Shore.'], // R1
  ['Three in the pool', 'See three kinds of squishy in the Rock Pool.'], // R2
  ['Ring the shells', 'Ring three different shells.'], // R3
  ['Pass the pebble', 'Two squishies pass the Pebble Ball.'], // R4
  ['Peekaboo by the log', 'Watch two play peekaboo by the log.'], // R5
  ['Bits in the pool', 'Cut a squishy into three in the pool.'], // R6
  ['A squirt for a friend', 'Soak a marshmallow, then squeeze it at a friend.'], // R7
  ['Sunset snuggle', 'Squeeze one on the sand. Then three snuggle.'], // R8
  ['Slide off the mound', 'Set squishies on the Sand Mound two times.'], // R9
  ['Who loves the shore?', 'Find a squishy that loves it here.'], // R10
  ['Hello, snow', 'Go to Frostbell Ridge.'], // I1
  ['Frosty friends', 'Two squishies get frosty.'], // I2
  ['Zoom on the ice', 'Two kinds of squishy glide on the Ice Pond.'], // I3
  ['Snow from the pine', 'A bump on the pine drops snow on a friend.'], // I4
  ['Snug in the snow', 'Watch two squishies nuzzle in the snow.'], // I5
  ['Bits on the ice', 'Cut a squishy into three on the ice.'], // I6
  ['Down the glide ramp', 'Set a squishy at the top of the ramp two times.'], // I7
  ['Stars over a snuggle', 'Grant a wish here. Then three nap together.'], // I8
  ['Ring the icicles', 'Ring the Icicle Bells five times.'], // I9
  ['Who loves the snow?', 'Find a squishy that loves it here.'], // I10
  ['Pitter-patter', 'Go to Rainleaf Garden.'], // G1
  ['Splash, splash', 'Three squishies splash in the Splash Spots.'], // G2
  ['Teeter on a leaf', 'Set two squishies on the Leaf Teeter.'], // G3
  ['Boing on the moss', 'Bounce on the Moss Bouncer three times.'], // G4
  ['Follow the leader', 'Three squishies follow one another.'], // G5
  ['Splashy bits', 'Cut a squishy into three in a Splash Spot.'], // G6
  ['A shower from the leaf', 'Tap the Drip Leaf over a squishy.'], // G7
  ['When the rain stops', 'Take a photo in the garden. Then three sing.'], // G8
  ['Soak it up', 'A foam squishy soaks up the rain.'], // G9
  ['Who loves the rain?', 'Find a squishy that loves it here.'], // G10
  ['', ''], // T1 (dropped, D-96)
  ['', ''], // T2 (dropped, D-96)
  ['', ''], // T3 (dropped, D-96)
  ['', ''], // T4 (dropped, D-96)
  ['', ''], // T5 (dropped, D-96)
  ['', ''], // T6 (dropped, D-96)
  ['', ''], // T7 (dropped, D-96)
  ['', ''], // T8 (dropped, D-96)
  ['', ''], // T9 (dropped, D-96)
  ['', ''], // T10 (dropped, D-96)
  ['', ''], // W1 (dropped, D-96)
  ['', ''], // W2 (dropped, D-96)
  ['', ''], // W3 (dropped, D-96)
  ['', ''], // W4 (dropped, D-96)
  ['', ''], // W5 (dropped, D-96)
  ['', ''], // W6 (dropped, D-96)
  ['', ''], // W7 (dropped, D-96)
  ['', ''], // W8 (dropped, D-96)
  ['', ''], // W9 (dropped, D-96)
  ['', ''], // W10 (dropped, D-96)
  ['Up on the roof', 'Go to Lanternroof.'], // L1
  ['Moon watchers', 'Two squishies gaze at the moon.'], // L2
  ['Light the lanterns', 'Light three different lanterns.'], // L3
  ['Ride the vane', 'Ride the Vane Disc when the breeze turns it.'], // L4
  ['Hold on, breeze', 'Two squishies hold on in a gust.'], // L5
  ['Bits in the breeze', 'Cut a squishy into three on the roof.'], // L6
  ['A shooting star', 'Look through the Star Scope.'], // L7
  ['Lantern song', 'Three squishies sing on the roof.'], // L8
  ['Hammock push', 'A friend pushes the hammock.'], // L9
  ['Who loves the night?', 'Find a squishy that loves it here.'], // L10
  ['', ''], // E1 (dropped, D-96)
  ['', ''], // E2 (dropped, D-96)
  ['', ''], // E3 (dropped, D-96)
  ['', ''], // E4 (dropped, D-96)
  ['', ''], // E5 (dropped, D-96)
  ['', ''], // E6 (dropped, D-96)
  ['', ''], // E7 (dropped, D-96)
  ['', ''], // E8 (dropped, D-96)
  ['', ''], // E9 (dropped, D-96)
  ['', ''], // E10 (dropped, D-96)
  ['Above the clouds', 'Go to Cloudloft.'], // U1
  ['Boing on the puffs', 'Bounce on the Puff Pads three times.'], // U2
  ['Float down slowly', 'Two squishies float down in the updraft.'], // U3
  ['Kite swing', 'A friend pushes the Kite Swing.'], // U4
  ['Bounce in turn', 'Watch squishies bounce one after another.'], // U5
  ['Bouncy bits', 'Cut a squishy into three on the pads.'], // U6
  ['Roll the cloud ball', 'Two squishies pass the Cloud Ball.'], // U7
  ['Sunrise parade', 'Three squishies parade under the arch.'], // U8
  ['Cloud nap', 'Two squishies nap by the Cloud Nest.'], // U9
  ['Who loves the sky?', 'Find a squishy that loves it here.'], // U10
  ['Three hellos', 'Three different pairs say hello.'], // X1
  ['Real friends', 'Two squishies become friends.'], // X2
  ['Best friends found', 'Find a pair of best friends.'], // X3
  ['A song in three places', 'Sing together in three places.'], // X4
  ['Little travellers', 'Visit three places beyond Home.'], // X5
  ['Every way is fine', 'Watch four kinds of squishy react to a place.'], // X6
  ['Water, snow and fire', 'One squishy in water, in the cold and by a fire.'], // X7
  ['Picture of friends', 'Take a photo of three, with best friends in it.'], // X8
  ['A nap in three places', 'Nap piles in three different places.'], // X9
  ['Wishes come true', 'Grant five wishes.'], // X10
];
/** The 11 chapter names by chapter idx (QUESTS 6; D-96: chapters 5, 6 and 8 are dropped, '' tombstones). */
export const CHAPTER_TEXT: readonly string[] = ['First Days', 'By the Fire', 'Sun and Splash', 'Frost and Glide', 'Rainy Day Play', '', '',
  'Moon and Lanterns', '', 'Above the Clouds', 'Friends Everywhere'];
/** Every kept thing's name (PLACES 4; the thing id `hearth` is the Fireplace) and its "Tap it yourself" line when a tap moves or switches it
 *  (QUESTS 15, D-93; '' when a tap does nothing). D-96: the dropped places' things have no name here. */
export const THING_TEXT: Readonly<Partial<Record<ThingId, readonly [string, string]>>> = {
  feltball: ['Felt Ball', 'Roll the Felt Ball'], musicbox: ['Music Box', 'Play the Music Box'], snoozerug: ['Snooze Rug', ''], warmlamp: ['Warm Lamp', 'Tap the lamp'],
  keepsakeshelf: ['Keepsake Shelf', 'Ring a keepsake'], bouncepad: ['Bounce Pad', ''],
  hearth: ['Fireplace', 'Tap the fireplace'], rockerboard: ['Rocker Board', 'Rock the Rocker Board'], yarnball: ['Yarn Ball', 'Roll the Yarn Ball'],
  pillowswing: ['Pillow Swing', 'Push the Pillow Swing'], snugbasket: ['Snug Basket', ''], kettle: ['Singing Kettle', 'Tap the kettle'],
  rockpool: ['Rock Pool', ''], bobring: ['Bob Ring', ''], driftlog: ['Driftwood Log', ''], shellchimes: ['Shell Chimes', 'Ring the shells'], pebbleball: ['Pebble Ball', 'Roll the Pebble Ball'],
  sandmound: ['Sand Mound', ''],
  icepond: ['Ice Pond', ''], glideramp: ['Glide Ramp', ''], steampool: ['Steam Pool', ''], iciclebells: ['Icicle Bells', 'Ring the bells'], snowdriftnest: ['Snowdrift Nest', ''],
  snowball: ['Snowball', 'Roll the Snowball'], shakepine: ['Shake Pine', 'Shake the pine'],
  splashspots: ['Splash Spots', ''], leafteeter: ['Leaf Teeter', 'Rock the Leaf Teeter'], mossbouncer: ['Moss Bouncer', ''], dripleaf: ['Drip Leaf', 'Tap the Drip Leaf'],
  steppingstones: ['Stepping Stones', ''], seedpod: ['Seed Pod', 'Roll the Seed Pod'],
  lanternline: ['Lantern Line', 'Light the lanterns'], vanedisc: ['Vane Disc', 'Turn the Vane Disc'], hammock: ['Clothesline Hammock', 'Push the hammock'],
  chimneycorner: ['Chimney Corner', ''], moondish: ['Moon Dish', ''], starscope: ['Star Scope', 'Look through the Star Scope'],
  puffpads: ['Puff Pads', ''], updraft: ['Updraft', ''], kiteswing: ['Kite Swing', 'Push the Kite Swing'], sunbowarch: ['Sunbow Arch', ''], cloudnest: ['Cloud Nest', ''],
  cloudball: ['Cloud Ball', 'Roll the Cloud Ball'],
};
/** The names of the zones and patches by their id (PLACES 4; an id's part before '.' names a multi-part zone). */
export const AREA_TEXT: Readonly<Record<string, string>> = {
  lampwarmth: 'Lamp Warmth', snoozerug: 'Snooze Rug', firesidewarmth: 'Fireside Warmth', windowchill: 'Window Chill', rug: 'Rug',
  rockpool: 'Rock Pool', surfedge: 'Surf Edge', sun: 'Sun', wetsand: 'Wet Sand', mountaincold: 'Mountain Cold', steampool: 'Steam Pool', windgap: 'Wind Gap', icepond: 'Ice Pond',
  rain: 'Rain', splashspots: 'Splash Spots', leafdrip: 'Leaf Drip', steppingstones: 'Stepping Stones', nightbreeze: 'Night Breeze', chimneywarmth: 'Chimney Warmth', moondish: 'Moon Dish',
  chimneycorner: 'Chimney Corner', updraft: 'Updraft', breeze: 'Breeze',
};   // (D-96: the dropped places' zones and patches have no name)
/** The keepsakes by bit: [name, how it is found (the dashed outline's hint), what a tap says (a place only while it has shipped: {place})].
 *  D-96: bits 5, 6 and 8 (Bubble Ring, Little Brass Cog, Glow Crystal: the dropped places' finale keepsakes) are retired: HOLES in this array
 *  (forEach and the Journal's Keepsakes tab skip them), so the 17 that ship keep their bit as their index. The Pocket Map's line: every place.
 *  (Round 6) a finale keepsake's tap line names its own place outright: it is found only by finishing that place's chapter, so the place has
 *  shipped (the screens filled {place} from bit + 1, which named the NEXT place: request to the screens in R6_DATA.md). */
export const KEEPSAKE_TEXT: readonly (readonly [string, string, string])[] = /* @__PURE__ */ (() => {
  const t: (readonly [string, string, string])[] = [];
  t[0] = ['Felt Star', 'A wish comes true at Home.', 'From Home.'];
  t[1] = ['Ember Pinecone', 'Finish By the Fire.', 'From Hearthlog Cabin.'];
  t[2] = ['Sea-glass Pebble', 'Finish Sun and Splash.', 'From Ripple Shore.'];
  t[3] = ['Tiny Frost Bell', 'Finish Frost and Glide.', 'From Frostbell Ridge.'];
  t[4] = ['Raindrop Bead', 'Finish Rainy Day Play.', 'From Rainleaf Garden.'];
  t[7] = ['Paper Lantern', 'Finish Moon and Lanterns.', 'From Lanternroof.'];
  t[9] = ['Cloud Puff', 'Finish Above the Clouds.', 'From Cloudloft.'];
  t[10] = ['Friendship Frame', 'Finish Friends Everywhere.', 'A photo of friends.'];
  t[11] = ['Pair Charm', 'Find your first pair of best friends.', 'For your first best friends.'];
  t[12] = ['Friendship Ribbon', 'Two squishies become close friends.', 'For your first close friends.'];
  t[13] = ['Ribbon Garland', 'Five pairs become close friends.', 'For five pairs of close friends.'];
  t[14] = ['Songbook', 'Sing together in five places.', 'For songs in five places.'];
  t[15] = ['Wish Jar', 'Ten wishes come true.', 'For ten wishes.'];
  t[16] = ['Little Button', 'Five pages get a gold edge.', 'For five gold pages.'];
  t[17] = ['Thimble', 'Fifteen pages get a gold edge.', 'For fifteen gold pages.'];
  t[18] = ['Pocket Map', 'Visit every place.', 'For a trip to every place.'];
  t[19] = ['Friends Quilt', 'Find all 25 pairs of best friends.', 'For every pair of best friends.'];
  return t;
})();
/** The facts' found lines and hints by fact bit (QUESTS 9). Keys: {name} the species, {place} its favourite place, {thing} its favourite
 *  thing, {friend} its best friend, {family} a family name (MATERIAL_FAMILIES[f].name), {line} its family's FAMILY_LINES entry, {touch} its
 *  loved touch (TOUCH_WORDS), {wish} the WISH_DONE line of its granted wish. F3's hint: `friendPlace` while the friend's favourite place
 *  has shipped, else `friendFamily`. */
export const FACT_LINES = {
  found: ['You met {name}.', '{name} loves {place}.', 'Its favourite thing is the {thing}.', 'Its best friend is {friend}.', 'In water, {name} {line}.',
    'By the fire, it {line}.', 'In the cold, it {line}.', 'On ice, it {line}.', "{name}'s song", 'It loves {touch}.', 'It wished {wish}.', 'Two {name}s dance alike!'],
  hint: ['Bring it out to meet it.', 'Take it on a trip to find the place it loves.', 'Watch what it plays with in the place it loves.', '',
    'Find out what it does in water.', 'Find out what it does by something warm.', 'Find out what it does in the cold.', 'Find out what it does on ice or snow.',
    'Let it sing with friends.', 'Try a squeeze, a stretch or a poke.', 'Grant one of its wishes.', 'Bring out two {name}s.'],
  friendPlace: 'Its best friend loves {place}.',
  friendFamily: 'Its best friend is a {family} squishy.',
} as const;
/** A species' loved touch (catalog signature) in F9's line. */
export const TOUCH_WORDS = { poke: 'a poke', squeeze: 'a slow squeeze', pull: 'a big stretch' } as const;
/** F4 water, F5 warm, F6 cold, F7 ground: each family's line (PLACES 3, its cells made into one short line; true to the float table, DT-10). */
export const FAMILY_LINES: Readonly<Record<MaterialFamilyId, readonly [string, string, string, string]>> = {
  slowrise: ['floats, then soaks and settles', 'dries out and dozes', 'sinks low and dozes', 'glides a little way'],
  marshmallow: ['floats highest and drifts', 'toasts golden, never burnt', 'stands tall with a little frost', 'glides a little and spins'],
  mochidough: ['wades with a tacky shine', 'rises like dough', 'goes stiff and slow', 'sticks and glides a little'],
  jellygel: ['wades and glints through the water', 'relaxes a little flatter', 'shivers', 'glides a long way'],
  waterfill: ['wades and sloshes', 'sends up little wisps of steam', 'shivers with frost on its rim', 'glides and sloshes'],
  putty: ['wades like a rock', 'softens a little', 'goes stiff and slow', 'barely slides'],
  stickystretch: ['wades and drops cling to it', 'sags a little', 'shivers', 'clings and hardly slides'],
  slimegoo: ['wades and spreads a slick ring', 'oozes flat', 'oozes very slowly', 'hardly slides and leaves a trail'],
  firmsilicone: ['wades and splashes', 'basks with slow, deep breaths', 'gets zippy', 'glides fastest of all'],
  popdome: ['floats upright like a little boat', 'basks with slow, deep breaths', 'gets zippy', 'glides fast'],
  gummy: ['wades with a little shine', 'goes glossy and relaxed', 'shivers', 'glides'],
  beadsqueeze: ['wades with a muffled rattle', 'basks with a softer rattle', 'rattles, crisp and tinkly', 'spins and rattles'],
};
/** Wish cards (QUESTS 8): the card line by wish kind, the thing kinds' words, the rest lines, the buttons and the live line. */
export const WISH_LINES = {
  place: '{name} wishes to visit {place}.',
  firstWish: '{name} wishes for a warm place: {place}.',
  firstWishRest: 'A wish for a warm place: {place}. It can wait.',
  thing: '{name} wants to play with {kind}.',
  kinds: { ball: 'a ball', bell: 'a bell', droplet: 'some water', note: 'a tune', flame: 'a warm fire', sun: 'something warm' },
  ride: '{name} wants a ride on the {thing}.',
  friend: '{name} wants to see {friend}.',
  squeeze: '{name} wishes for a slow squeeze.',
  stretch: '{name} wishes for a big stretch.',
  nap: '{name} is sleepy.',
  song: '{name} wants to sing.',
  warm: '{name} wants to warm up.',
  dry: '{name} wants to dry off.',
  rest: '{name} still wishes to visit {place}. It can wait.',
  restAny: '{name} still has a wish. It can wait.',
  live: '{name} has a wish: {short}',
  go: "Let's go", notNow: 'Not now', bring: 'Bring {friend}', goTo: 'Go to {place}', setOn: 'Set {name} on the {thing}',
  /** F10's {wish} by wish kind. */
  done: { place: 'to visit {place}', thing: 'to play with {kind}', ride: 'for a ride', friend: 'to see {friend}', touch: 'for {touch}', nap: 'for a nap',
    song: 'to sing', warm: 'to warm up' },
} as const;
/** The gift card (QUESTS 11, 15; PLACES 5): a line names a place only while it has shipped, else `unshipped`. */
export const GIFT_LINES = {
  loves: 'All three love {place}.',
  unshipped: 'Three new friends for you.',
  hardToFind: 'Three squishies that are hard to find.',
  ask: 'Bring {name} home?', yes: 'Yes', notYet: 'Not yet', see: 'See your gift', isNew: 'New', bestOf: "{name}'s best friend",
  wait: 'Your gift will wait here.', full: 'Your shelf is full. Your gift will wait here.', oneADay: 'One gift a day. This one will wait for you.',
  later: 'Your gift will wait here for now.', origin: 'Gift',
} as const;
/** The screens' other lines (QUESTS 15, LIFE 5.6 and 10.4, PLACES P12). */
export const UI_TEXT = {
  tabs: ['Stamps', 'Squishies', 'Friends', 'Keepsakes'], wishesNow: 'Wishes now', journal: 'Journal', journalNew: 'Journal, something new', places: 'Places',
  newStamp: 'New stamp: {title}', newStamps: '{n} new stamps', ofN: '{a} of {b}', opensAt: 'Opens at {n} stamps', needsAutonomy: 'Needs: Squishies move on their own',
  found: 'Found: {name}', newFact: 'New: {line}', chapterDone: '{chapter} is done.', wishCame: 'A wish came true!',
  placeOpen: '{place} is open. Find it in Places.', placeHere: 'You are at {place}.', packing: 'Packing up...', loadFailed: '{place} did not load. Try again.',
  goTo: 'Go to {place}', coming: "Who's coming?", change: 'Change', here: 'Here', fans: '{n} of yours love it', stampsOf: '{a} of {b} stamps',
  levels: ['Met', 'Friends', 'Close friends'], bestFriends: 'Best friends', itsSong: 'Its song', play: 'Play',
  voices: 'Voices', placeSounds: 'Place sounds', autonomy: 'Squishies move on their own',
  autonomyHelp: 'When off, they stay where you put them. They still look around and chirp, and play when you ask.',
  bubbleWords: 'Words under bubbles', bubblesInPhoto: 'Bubbles in photo', pose: 'Pose!', save: 'Save', close: 'Close',
  ground: 'Here your squishies stand on the ground.', busy: "It's busy here. Put one squishy back on the shelf to cut.", backToShelf: '{name} went back to the shelf for a rest.',
  goPlay: 'Go play with...', tapYourself: 'Tap it yourself',
} as const;
