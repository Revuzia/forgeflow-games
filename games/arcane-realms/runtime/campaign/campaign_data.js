// Arcane Realms TCG — Campaign "Trials of the Realms": 5 chapters × 4 battles.
// Each chapter has a commander, a themed enemy deck, dialogue, a difficulty
// ramp, and card rewards. Guaranteed unlocks cover most of the expansion;
// achievements + Arcane Packs (gold) cover the rest. Validated by selftest.

function expand(pairs) {
  const out = [];
  for (const [id, n] of pairs) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

// ── commander decks (may freely use expansion cards) ──
const DECK_THORNQUEEN = expand([
  ['wg01', 2], ['wg02', 2], ['wg04', 2], ['wg05', 2], ['wg07', 2],
  ['wgc1', 2], ['wgc2', 2], ['wg08', 2], ['wg09', 2], ['wg10', 2],
  ['wgc5', 2], ['wg13', 2], ['wgc7', 2], ['wg16', 1], ['wgc3', 2], ['wgc10', 1],
]);
const DECK_LICHLORD = expand([
  ['gm01', 2], ['gm02', 2], ['gm04', 2], ['gmc1', 2], ['gm05', 2],
  ['gm06', 2], ['gm07', 2], ['gmc3', 2], ['gm08', 2], ['gm09', 2],
  ['gmc4', 2], ['gm11', 2], ['gmc9', 2], ['gm14', 1], ['gm17', 2], ['gm18', 1],
]);
const DECK_FLAMEKHAN = expand([
  ['ef01', 2], ['ef02', 2], ['efc1', 2], ['ef03', 2], ['ef05', 2],
  ['efc2', 2], ['ef08', 2], ['ef09', 2], ['efc3', 2], ['ef10', 2],
  ['ef12', 2], ['efc9', 2], ['ef13', 2], ['efc8', 1], ['ef20', 1], ['efc10', 1], ['ef16', 1],
]);
const DECK_TIDECALLER = expand([
  ['tc01', 2], ['tcc1', 2], ['tc02', 2], ['tcc2', 2], ['tc03', 2],
  ['tc04', 2], ['tcc5', 2], ['tc06', 2], ['tcc6', 2], ['tc08', 2],
  ['tcc7', 2], ['tc10', 2], ['tc12', 2], ['tc13', 1], ['tcc8', 1], ['tc16', 1], ['tc18', 1],
]);
const DECK_LIGHTWARDEN = expand([
  ['dw01', 2], ['dwc1', 2], ['dw02', 2], ['dwc2', 2], ['dw04', 2],
  ['dw06', 2], ['dwc3', 2], ['dw07', 2], ['dwc7', 2], ['dw09', 2],
  ['dwc5', 2], ['dw11', 2], ['dwc6', 2], ['dw13', 1], ['dwc9', 1], ['dw16', 1], ['dwc10', 1],
]);

// pv = player voice (your hero), cm = commander
const D = (who, text) => ({ who, text });

export const CHAPTERS = [
  {
    id: 'ch1', name: 'The Verdant Marches', realm: 'grove',
    commander: { name: 'Thornqueen Lyseth', portrait: 'cm_thornqueen', hero: 'grove' },
    deck: DECK_THORNQUEEN,
    blurb: 'The forest realm has sealed its borders. Its queen does not believe you come in peace.',
    battles: [
      {
        id: 'ch1b1', name: 'The Bramble Gate', difficulty: 'squire', mods: { enemyHp: 22 },
        dialogue: [
          D('cm', 'Turn back, duelist. The Marches answer to thorns now — and thorns answer to me.'),
          D('pv', 'I seek the Arcane Nexus. Your gate is in my way.'),
          D('cm', 'Then let the brambles take your measure.'),
        ],
        winLine: 'The gate splinters. Somewhere deeper, the Thornqueen laughs.',
        rewards: { gold: 50, cards: ['wgc1', 'ntc1'], pack: 0 },
      },
      {
        id: 'ch1b2', name: 'Wolfsong Hollow', difficulty: 'squire', mods: { enemyHp: 26 },
        dialogue: [
          D('cm', 'You cut through my hedge like a butcher. The pack will teach you manners.'),
          D('pv', 'Send them. I have played against worse than wolves.'),
        ],
        winLine: 'The hollow falls silent — the pack bows and parts.',
        rewards: { gold: 60, cards: ['wgc2', 'wgc4'], pack: 1 },
      },
      {
        id: 'ch1b3', name: 'The Elder Grove', difficulty: 'knight', mods: { enemyHp: 28 },
        dialogue: [
          D('cm', 'The elders whisper your name now. It sounds like a warning.'),
          D('pv', 'Or a welcome. Your forest is learning my rhythm.'),
          D('cm', 'Then I shall change the song.'),
        ],
        winLine: 'The elder trees creak their grudging approval.',
        rewards: { gold: 70, cards: ['wgc5', 'wgc9'], pack: 1 },
      },
      {
        id: 'ch1b4', name: 'Throne of Thorns', boss: true, difficulty: 'knight',
        mods: { enemyHp: 32, enemyBoard: ['tk_sapling'] },
        dialogue: [
          D('cm', 'You stand before the Throne of Thorns. Kneel, and the forest forgets you kindly.'),
          D('pv', 'I did not come this far to kneel, Lyseth.'),
          D('cm', 'Then come. The grove itself fights beside me!'),
        ],
        winLine: '"Enough." The Thornqueen lowers her crown. "The Marches are yours to pass — Nexus-seeker."',
        rewards: { gold: 120, cards: ['wgc7', 'wgc6', 'wgc8'], pack: 1, cardback: 'cb_verdant' },
      },
    ],
  },
  {
    id: 'ch2', name: 'The Sunken Crypts', realm: 'grave',
    commander: { name: 'Lich-Lord Maros', portrait: 'cm_lichlord', hero: 'grave' },
    deck: DECK_LICHLORD,
    blurb: 'Beneath the marches lie the drowned dead — and a king who never accepted his funeral.',
    battles: [
      {
        id: 'ch2b1', name: 'The Drowned Door', difficulty: 'knight', mods: { enemyHp: 28 },
        dialogue: [
          D('cm', 'A living heartbeat, in MY crypts? How… nostalgic.'),
          D('pv', 'I need passage below, Maros. The dead can spare a corridor.'),
          D('cm', 'The dead spare nothing. That is rather the point of us.'),
        ],
        winLine: 'The drowned door grinds open on hinges of bone.',
        rewards: { gold: 60, cards: ['gmc1', 'gmc2'], pack: 1 },
      },
      {
        id: 'ch2b2', name: 'Hall of Whispers', difficulty: 'knight', mods: { enemyHp: 30 },
        dialogue: [
          D('cm', 'Hear them? Every whisper is a duelist who thought themselves clever.'),
          D('pv', 'Then listen closely. You may learn something new tonight.'),
        ],
        winLine: 'The whispers change key — from mockery to murmurs of respect.',
        rewards: { gold: 70, cards: ['gmc3', 'gmc7'], pack: 1 },
      },
      {
        id: 'ch2b3', name: 'The Ossuary', difficulty: 'knight', mods: { enemyHp: 30, enemyBoard: ['tk_skeleton', 'tk_skeleton'] },
        dialogue: [
          D('cm', 'Bones upon bones upon bones. Do you know what I build with them?'),
          D('pv', 'Armies, I expect. You lot are predictable that way.'),
          D('cm', 'Armies, yes. And thrones. And YOU.'),
        ],
        winLine: 'The ossuary settles — ten thousand skulls conceding at once.',
        rewards: { gold: 80, cards: ['gmc4', 'ntc2'], pack: 1 },
      },
      {
        id: 'ch2b4', name: 'The Deathless Court', boss: true, difficulty: 'knight',
        mods: { enemyHp: 34, extraCards: 1 },
        dialogue: [
          D('cm', 'I have died four times, duelist. Each time I returned wiser. You get ONE attempt.'),
          D('pv', 'One is all a good deck needs.'),
        ],
        winLine: '"Remarkable." Maros bows, joints creaking. "Take the deep road. Tell the flame I said nothing kind."',
        rewards: { gold: 130, cards: ['gmc5', 'gmc6', 'gmc8'], pack: 1, cardback: 'cb_crypts' },
      },
    ],
  },
  {
    id: 'ch3', name: 'The Ashen Peaks', realm: 'ember',
    commander: { name: 'Flame-Khan Vurgor', portrait: 'cm_flamekhan', hero: 'ember' },
    deck: DECK_FLAMEKHAN,
    blurb: 'The deep road climbs into fire. The war-khan of the peaks duels for the joy of it.',
    battles: [
      {
        id: 'ch3b1', name: 'The Cinder Steps', difficulty: 'knight', mods: { enemyHp: 30 },
        dialogue: [
          D('cm', 'HA! Fresh sport climbs my mountain! Tell me your name so I may roar it properly.'),
          D('pv', 'Names after the duel, Khan. You may not want to remember mine.'),
          D('cm', 'BOLD! I like you already. BURN ANYWAY!'),
        ],
        winLine: 'Vurgor\'s laughter shakes soot from the cliffs. "AGAIN! No — onward! BETTER!"',
        rewards: { gold: 70, cards: ['efc1', 'efc2'], pack: 1 },
      },
      {
        id: 'ch3b2', name: 'The Forgeworks', difficulty: 'knight', mods: { enemyHp: 30, tempManaStart: 1 },
        dialogue: [
          D('cm', 'My forges never cool. My warriors never tire. My hammer NEVER misses.'),
          D('pv', 'Your card game, however, is about to.'),
        ],
        winLine: 'The forgemasters stamp their hammers — the peaks\' highest honor.',
        rewards: { gold: 80, cards: ['efc3', 'efc5'], pack: 1 },
      },
      {
        id: 'ch3b3', name: 'The Meteor Yard', difficulty: 'archmage', mods: { enemyHp: 30 },
        dialogue: [
          D('cm', 'The sky throws stones at my yard. I throw them BACK. What do you throw, little duelist?'),
          D('pv', 'Everything you\'re about to lose to.'),
        ],
        winLine: 'A meteor cracks overhead like applause.',
        rewards: { gold: 90, cards: ['efc7', 'ntc3'], pack: 1 },
      },
      {
        id: 'ch3b4', name: 'The Khan\'s Cauldron', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 36, tempManaStart: 1 },
        dialogue: [
          D('cm', 'FINAL ROUND! Win, and the peaks sing your name in avalanche! Lose, and — well. Ash needs no name!'),
          D('pv', 'Sing loud, Vurgor. Here it comes.'),
        ],
        winLine: '"MAGNIFICENT!" The Khan crushes you in a one-armed hug. "The depths await, friend. Go — before I demand a rematch!"',
        rewards: { gold: 150, cards: ['efc9', 'efc8', 'efc6'], pack: 1, cardback: 'cb_volcanic' },
      },
    ],
  },
  {
    id: 'ch4', name: 'The Drowned Depths', realm: 'tide',
    commander: { name: 'Tidecaller Nymue', portrait: 'cm_tidecaller', hero: 'tide' },
    deck: DECK_TIDECALLER,
    blurb: 'Below the fire, an ocean without a sky. Its oracle already knows how this ends — she says.',
    battles: [
      {
        id: 'ch4b1', name: 'The Glass Reef', difficulty: 'archmage', mods: { enemyHp: 30 },
        dialogue: [
          D('cm', 'I dreamed you would come on the seventh tide. You are early. How rude.'),
          D('pv', 'I make my own timing. Your reef, oracle — shall we?'),
          D('cm', 'We already have. You simply haven\'t lost yet.'),
        ],
        winLine: 'The reef chimes — a thousand glass bells, all surprised.',
        rewards: { gold: 80, cards: ['tcc1', 'tcc2'], pack: 1 },
      },
      {
        id: 'ch4b2', name: 'The Whale Road', difficulty: 'archmage', mods: { enemyHp: 32 },
        dialogue: [
          D('cm', 'The leviathans sing of a stranger walking their road. They are… curious. Do not disappoint them.'),
          D('pv', 'I don\'t intend to disappoint anyone but you.'),
        ],
        winLine: 'Far below, something vast and ancient hums approval.',
        rewards: { gold: 90, cards: ['tcc3', 'tcc5'], pack: 1 },
      },
      {
        id: 'ch4b3', name: 'The Mirror Trench', difficulty: 'archmage', mods: { enemyHp: 32, extraCards: 1 },
        dialogue: [
          D('cm', 'In the trench you duel your reflection. I merely hold the mirror.'),
          D('pv', 'Then watch closely. Even my reflection plays better than you.'),
        ],
        winLine: 'Your reflection bows first. Nymue\'s veil ripples — was that a smile?',
        rewards: { gold: 100, cards: ['tcc6', 'tcc9'], pack: 1 },
      },
      {
        id: 'ch4b4', name: 'The Abyssal Throne', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 38, extraCards: 1 },
        dialogue: [
          D('cm', 'This is the duel I could not dream past. The current holds its breath, stranger.'),
          D('pv', 'Then let\'s give the ocean something to remember.'),
        ],
        winLine: '"So THAT is how it ends." Nymue laughs like rain. "Rise, Nexus-seeker. The spires burn bright above you."',
        rewards: { gold: 170, cards: ['tcc7', 'tcc4', 'tcc8'], pack: 1, cardback: 'cb_depths' },
      },
    ],
  },
  {
    id: 'ch5', name: 'The Celestial Spires', realm: 'dawn',
    commander: { name: 'Lightwarden Serathiel', portrait: 'cm_lightwarden', hero: 'dawn' },
    deck: DECK_LIGHTWARDEN,
    blurb: 'The Nexus crowns the spires — behind the last and brightest blade in the realms.',
    battles: [
      {
        id: 'ch5b1', name: 'The Thousand Stairs', difficulty: 'archmage', mods: { enemyHp: 32 },
        dialogue: [
          D('cm', 'Four realms let you pass. I am not the first four.'),
          D('pv', 'No. You\'re the last one. That\'s why I saved my best.'),
        ],
        winLine: 'The stairs kindle beneath your feet, lighting the way up.',
        rewards: { gold: 100, cards: ['dwc1', 'dwc2'], pack: 1 },
      },
      {
        id: 'ch5b2', name: 'The Choir Bastion', difficulty: 'archmage', mods: { enemyHp: 34 },
        dialogue: [
          D('cm', 'The choir sings of every duelist who fell here. Your verse is already written.'),
          D('pv', 'Good. Have them practice the key change — I win in the third act.'),
        ],
        winLine: 'The choir falters, then — magnificently — improvises.',
        rewards: { gold: 110, cards: ['dwc3', 'dwc4'], pack: 1 },
      },
      {
        id: 'ch5b3', name: 'The Judgment Court', difficulty: 'archmage', mods: { enemyHp: 34, enemyBoard: ['tk_squire'], extraCards: 1 },
        dialogue: [
          D('cm', 'Here I have judged kings, dragons, and gods. You will be a footnote.'),
          D('pv', 'Footnotes are where they hide the good stories.'),
        ],
        winLine: 'The court\'s verdict, written in dawn-light: WORTHY.',
        rewards: { gold: 120, cards: ['dwc7', 'dwc8'], pack: 1 },
      },
      {
        id: 'ch5b4', name: 'The Arcane Nexus', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 40, enemyBoard: ['tk_defender'], extraCards: 1 },
        dialogue: [
          D('cm', 'Beyond me burns the Nexus — the heart of every realm you crossed. Show me ALL of it, duelist. Every realm. Every scar. Every card.'),
          D('pv', 'With pleasure, Warden. This one\'s for the whole road.'),
        ],
        winLine: 'Serathiel\'s blade dims to morning-gold. "The Nexus knows you now — Champion of the Arcane Realms." The five realms sing at once.',
        rewards: { gold: 250, cards: ['dwc5', 'dwc6', 'dwc9'], pack: 2, cardback: 'cb_celestial' },
      },
    ],
  },
];

// ── achievements (checked after matches + collection changes) ──
export const ACHIEVEMENTS = [
  { id: 'a_first', name: 'First Blood', desc: 'Win your first Campaign battle', check: (p) => p.campaignWins >= 1, rewards: { gold: 50, cards: ['ntc4'] } },
  { id: 'a_wins8', name: 'Realm Wanderer', desc: 'Win 8 Campaign battles', check: (p) => p.campaignWins >= 8, rewards: { gold: 100, cards: ['ntc5'] } },
  { id: 'a_wins20', name: 'Trialmaster', desc: 'Win 20 Campaign battles', check: (p) => p.campaignWins >= 20, rewards: { gold: 150, cards: ['dwc10'] } },
  { id: 'a_rares10', name: 'Rare Curator', desc: 'Own 10 or more Rare cards', check: (p) => p.raresOwned >= 10, rewards: { gold: 80, cards: ['gmc9'] } },
  { id: 'a_epics5', name: 'Epic Archivist', desc: 'Own 5 or more Epic cards', check: (p) => p.epicsOwned >= 5, rewards: { gold: 120, cards: ['gmc10'], cardback: 'cb_collector' } },
  { id: 'a_anywins10', name: 'Duelist of Renown', desc: 'Win 10 matches in any mode', check: (p) => p.totalWins >= 10, rewards: { gold: 80, cards: ['ntc6'] } },
  { id: 'a_campaign', name: 'Champion of the Nexus', desc: 'Complete all 20 Campaign battles', check: (p) => p.battlesCleared >= 20, rewards: { gold: 300, cards: ['ntc10', 'efc10'], cardback: 'cb_champion' } },
  { id: 'a_legend3', name: 'Legend Keeper', desc: 'Own 10 or more Legendary cards', check: (p) => p.legendariesOwned >= 10, rewards: { gold: 150, cards: ['tcc10', 'wgc10'] } },
];

export const CARDBACK_INFO = {
  default:      { name: 'Arcane Star', file: 'cardback.jpg', hint: 'The classic.' },
  cb_verdant:   { name: 'Verdant Marches', file: 'cb_verdant.jpg', hint: 'Clear Chapter 1' },
  cb_crypts:    { name: 'Sunken Crypts', file: 'cb_crypts.jpg', hint: 'Clear Chapter 2' },
  cb_volcanic:  { name: 'Ashen Peaks', file: 'cb_volcanic.jpg', hint: 'Clear Chapter 3' },
  cb_depths:    { name: 'Drowned Depths', file: 'cb_depths.jpg', hint: 'Clear Chapter 4' },
  cb_celestial: { name: 'Celestial Spires', file: 'cb_celestial.jpg', hint: 'Clear Chapter 5' },
  cb_champion:  { name: 'Nexus Champion', file: 'cb_champion.jpg', hint: 'Complete the Campaign' },
  cb_collector: { name: 'The Collector', file: 'cb_collector.jpg', hint: 'Own 5 Epic cards' },
};

export const PACK_COST = 100;
export const PACK_SIZE = 3;
export const PACK_WEIGHTS = { common: 46, uncommon: 30, rare: 15, epic: 6, legendary: 3 };

export function allBattles() {
  return CHAPTERS.flatMap((c) => c.battles.map((b) => ({ ...b, chapter: c })));
}
