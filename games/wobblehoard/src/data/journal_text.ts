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

/** The 110 quests' [title, hint] by quest idx (QUESTS 6.0 to 6.10 as written; one fix: R9's hint names its count, "two times", as Q7 and
 *  DT-09 require). Home's ten are also in quests.ts HOME_TEXT (the tracker needs them before this chunk). */
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
  ['Bubbles up', 'Go to Fizzwell Tub.'], // T1
  ['One floats, one sits', 'See one squishy float and one sit in the bath.'], // T2
  ['Round the swirl', 'Ride the Swirl Ride twice.'], // T3
  ['Fizz in the bubbles', 'Two squishies fizz in the Bubble Patch.'], // T4
  ['Bath-time hellos', 'Three different pairs say hello in the bath.'], // T5
  ['Bubbly bits', 'Cut a squishy into three in the bath.'], // T6
  ['Run the tap', 'Tap the tap. Watch a floater drift round.'], // T7
  ['Bubble song', 'Three squishies sing in the bath.'], // T8
  ['Whee, soap slide', 'Set a squishy at the top of the Soap Slide two times.'], // T9
  ['Who loves the bath?', 'Find a squishy that loves it here.'], // T10
  ['Tick, tock', 'Go to Cogwhistle Bench.'], // W1
  ['Wind the cog', 'Tap the key. Then ride the cog round.'], // W2
  ['Boing on the plate', 'Bounce on the Spring Plate three times.'], // W3
  ['The marble and the magnet', 'Tap the magnet. Watch the marble roll to it.'], // W4
  ['Copy me', 'Watch a squishy copy a friend, twice.'], // W5
  ['Bits on the cog', 'Cut a squishy into three on the cog.'], // W6
  ['Sing to the clock', 'Tap the Tick Clock. Two squishies sing back.'], // W7
  ['The big machine', 'A squishy rides the cog. Then a bounce and a ding.'], // W8
  ['Ding', 'Ring the Little Bell three times.'], // W9
  ['Who loves the bench?', 'Find a squishy that loves it here.'], // W10
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
  ['Hello, hello, hello', 'Go to Echo Hollow.'], // E1
  ['Glow bath', 'Two squishies glow in the Glow Pool.'], // E2
  ['Ring the crystals', 'Ring three different crystals.'], // E3 (QUESTS 6 wrote the noun "Crystal scale"; Q7: a title says what you do; R2)
  ['Wake the echo', 'Tap the Echo Stone.'], // E4
  ['Echo talk', 'A squishy answers its own echo.'], // E5
  ['Glowing bits', 'Cut a squishy into three in the glow.'], // E6
  ['Peekaboo by the rock', 'Watch two play peekaboo by the Hum Rock.'], // E7
  ['Cave song', 'Three squishies sing in the cave.'], // E8
  ['Stone slide', 'Set a squishy at the top of the Stone Slide two times.'], // E9
  ['Who loves the cave?', 'Find a squishy that loves it here.'], // E10
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
/** The 11 chapter names by chapter idx (QUESTS 6). */
export const CHAPTER_TEXT: readonly string[] = ['First Days', 'By the Fire', 'Sun and Splash', 'Frost and Glide', 'Rainy Day Play', 'Bath Time', 'Tick and Spin',
  'Moon and Lanterns', 'Hello, Hello', 'Above the Clouds', 'Friends Everywhere'];
/** Every thing's name (PLACES 4; the thing id `hearth` is the Fireplace) and its "Tap it yourself" line when a tap moves or switches it
 *  (QUESTS 15, D-93; '' when a tap does nothing). */
export const THING_TEXT: Readonly<Record<ThingId, readonly [string, string]>> = {
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
  bathwater: ['Bath Water', ''], tap: ['Tap', 'Run the tap'], swirlride: ['Swirl Ride', ''], soapslide: ['Soap Slide', ''], spongeraft: ['Sponge Raft', ''], bubblepatch: ['Bubble Patch', ''],
  spinningcog: ['Spinning Cog', ''], windupkey: ['Wind-up Key', 'Wind the key'], springplate: ['Spring Plate', ''], magnet: ['Horseshoe Magnet', 'Tap the magnet'],
  steelmarble: ['Steel Marble', 'Roll the Steel Marble'], tickclock: ['Tick Clock', 'Tap the clock'], littlebell: ['Little Bell', 'Ring the Little Bell'],
  lanternline: ['Lantern Line', 'Light the lanterns'], vanedisc: ['Vane Disc', 'Turn the Vane Disc'], hammock: ['Clothesline Hammock', 'Push the hammock'],
  chimneycorner: ['Chimney Corner', ''], moondish: ['Moon Dish', ''], starscope: ['Star Scope', 'Look through the Star Scope'],
  crystals: ['Singing Crystals', 'Ring the crystals'], glowpool: ['Glow Pool', ''], stoneslide: ['Stone Slide', ''], mossbed: ['Glow Moss Bed', ''], echostone: ['Echo Stone', 'Tap the Echo Stone'],
  humrock: ['Hum Rock', ''],
  puffpads: ['Puff Pads', ''], updraft: ['Updraft', ''], kiteswing: ['Kite Swing', 'Push the Kite Swing'], sunbowarch: ['Sunbow Arch', ''], cloudnest: ['Cloud Nest', ''],
  cloudball: ['Cloud Ball', 'Roll the Cloud Ball'],
};
/** The names of the zones and patches by their id (PLACES 4; an id's part before '.' names a multi-part zone). */
export const AREA_TEXT: Readonly<Record<string, string>> = {
  lampwarmth: 'Lamp Warmth', snoozerug: 'Snooze Rug', firesidewarmth: 'Fireside Warmth', windowchill: 'Window Chill', rug: 'Rug',
  rockpool: 'Rock Pool', surfedge: 'Surf Edge', sun: 'Sun', wetsand: 'Wet Sand', mountaincold: 'Mountain Cold', steampool: 'Steam Pool', windgap: 'Wind Gap', icepond: 'Ice Pond',
  rain: 'Rain', splashspots: 'Splash Spots', leafdrip: 'Leaf Drip', steppingstones: 'Stepping Stones', bathwater: 'Bath Water', tapswirl: 'Tap Swirl', bubblepatch: 'Bubble Patch',
  bathmat: 'Bath Mat', magnetfield: 'Magnet Field', lampwarm: 'Lamp Warm', feltpad: 'Felt Pad', nightbreeze: 'Night Breeze', chimneywarmth: 'Chimney Warmth', moondish: 'Moon Dish',
  chimneycorner: 'Chimney Corner', echo: 'Echo', cavecool: 'Cave Cool', glowpool: 'Glow Pool', drips: 'Drips', mossbed: 'Glow Moss Bed', updraft: 'Updraft', breeze: 'Breeze',
};
/** The 20 keepsakes by bit: [name, how it is found (the dashed outline's hint), what a tap says (a place only while it has shipped: {place})]. */
export const KEEPSAKE_TEXT: readonly (readonly [string, string, string])[] = [
  ['Felt Star', 'A wish comes true at Home.', 'From Home.'],
  ['Ember Pinecone', 'Finish By the Fire.', 'From {place}.'],
  ['Sea-glass Pebble', 'Finish Sun and Splash.', 'From {place}.'],
  ['Tiny Frost Bell', 'Finish Frost and Glide.', 'From {place}.'],
  ['Raindrop Bead', 'Finish Rainy Day Play.', 'From {place}.'],
  ['Bubble Ring', 'Finish Bath Time.', 'From {place}.'],
  ['Little Brass Cog', 'Finish Tick and Spin.', 'From {place}.'],
  ['Paper Lantern', 'Finish Moon and Lanterns.', 'From {place}.'],
  ['Glow Crystal', 'Finish Hello, Hello.', 'From {place}.'],
  ['Cloud Puff', 'Finish Above the Clouds.', 'From {place}.'],
  ['Friendship Frame', 'Finish Friends Everywhere.', 'A photo of friends.'],
  ['Pair Charm', 'Find your first pair of best friends.', 'For your first best friends.'],
  ['Friendship Ribbon', 'Two squishies become close friends.', 'For your first close friends.'],
  ['Ribbon Garland', 'Five pairs become close friends.', 'For five pairs of close friends.'],
  ['Songbook', 'Sing together in five places.', 'For songs in five places.'],
  ['Wish Jar', 'Ten wishes come true.', 'For ten wishes.'],
  ['Little Button', 'Five pages get a gold edge.', 'For five gold pages.'],
  ['Thimble', 'Fifteen pages get a gold edge.', 'For fifteen gold pages.'],
  ['Pocket Map', 'Visit every place.', 'For a trip to every place.'],
  ['Friends Quilt', 'Find all 25 pairs of best friends.', 'For every pair of best friends.'],
];
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
