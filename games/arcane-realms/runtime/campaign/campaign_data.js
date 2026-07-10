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

// ── final boss: a deck fused from ALL FIVE realms (AI decks skip legality) ──
const DECK_CONVERGENCE = expand([
  ['ef19', 1], ['tc18', 1], ['wg18', 1], ['dw16', 1], ['gm18', 1], // one legendary per realm
  ['ef15', 1], ['tc16', 1], ['wg17', 1], ['dw13', 1], ['gm14', 1], // one epic per realm
  ['ef12', 2], ['tc11', 2], ['wg13', 2], ['dwc5', 2], ['gm09', 2], // rares
  ['ef10', 1], ['tc03', 1], ['wg07', 1], ['dw06', 1], ['gm06', 1], // utility spread
  ['nt13', 1], ['nt14', 1], ['ntc10', 1],                         // neutral heavies
  ['ef03', 1], ['tc02', 1],
]);

// pv = player voice (your hero), cm = commander/boss, goon = the battle's minion
const D = (who, text) => ({ who, text });

export const CHAPTERS = [
  {
    id: 'ch1', name: 'The Verdant Marches', realm: 'grove',
    commander: { name: 'Thornqueen Lyseth', portrait: 'cm_thornqueen', hero: 'grove' },
    deck: DECK_THORNQUEEN,
    blurb: 'The Arcane Nexus — the heart that binds all five realms — is coming apart at the seams. Its five Wardens have sealed their borders and turned every traveler away. You cross the first, the forest realm, to reach the Nexus before it tears the world in two.',
    battles: [
      {
        id: 'ch1b1', name: 'The Bramble Gate', difficulty: 'squire', mods: { enemyHp: 22 },
        goon: { name: 'Sylvan Archer', portrait: 'wg05' },
        dialogue: [
          D('goon', 'Halt! The Thornqueen has sealed the Marches. No Nexus-seeker passes the Bramble Gate.'),
          D('pv', 'The Nexus is failing, archer. I mean to reach it before your forest comes apart with it.'),
          D('goon', 'Pretty words for a trespasser. Loose the thorns!'),
        ],
        winLine: 'The gate splinters. A snapped arrow marks where the queen\'s scout once stood.',
        rewards: { gold: 50, cards: ['wgc1', 'ntc1'], pack: 0 },
      },
      {
        id: 'ch1b2', name: 'Wolfsong Hollow', difficulty: 'squire', mods: { enemyHp: 26 },
        goon: { name: 'Packleader of the Vale', portrait: 'wg09' },
        dialogue: [
          D('goon', 'You cut my queen\'s hedge like a butcher. The pack does not forgive butchers.'),
          D('pv', 'Then call them off. I\'ve played against worse than wolves — and your queen is losing her realm.'),
          D('goon', 'Losing? The Marches do not LOSE. Hunt!'),
        ],
        winLine: 'The hollow falls silent. The pack bows, and parts — a road, grudgingly given.',
        rewards: { gold: 60, cards: ['wgc2', 'wgc4'], pack: 1 },
      },
      {
        id: 'ch1b3', name: 'The Elder Grove', difficulty: 'knight', mods: { enemyHp: 28 },
        goon: { name: 'Elderwood Shaman', portrait: 'wg12' },
        dialogue: [
          D('goon', 'The elder trees whisper your name now, seeker. Even they feel the Nexus fraying.'),
          D('pv', 'Then help me reach it. Whatever is unmaking the realms started here — at the heart.'),
          D('goon', 'The queen forbids it. The elders will judge you first.'),
        ],
        winLine: 'The elder trees creak their approval. "Go to her," the shaman breathes. "She has seen it too."',
        rewards: { gold: 70, cards: ['wgc5', 'wgc9'], pack: 1 },
      },
      {
        id: 'ch1b4', name: 'Throne of Thorns', boss: true, difficulty: 'knight',
        mods: { enemyHp: 32, enemyBoard: ['tk_sapling'] },
        dialogue: [
          D('cm', 'So. The seeker my scouts could not stop. I sealed the Marches to hold back what leaks from the Nexus — not to spite you.'),
          D('pv', 'Then we want the same thing, Lyseth. Test me, and let me pass.'),
          D('cm', 'Oh, I will test you. If you cannot beat a queen, you will not survive what waits at the heart. The grove fights BESIDE me!'),
        ],
        winLine: '"Enough." The Thornqueen lowers her crown and presses a seed of jade into your hand — the Seal of Root. "The Marches are yours to cross. Beware the deep realm below; its king hears everything."',
        rewards: { gold: 120, cards: ['wgc7', 'wgc6', 'wgc8'], pack: 1, cardback: 'cb_verdant' },
      },
    ],
  },
  {
    id: 'ch2', name: 'The Sunken Crypts', realm: 'grave',
    commander: { name: 'Lich-Lord Maros', portrait: 'cm_lichlord', hero: 'grave' },
    deck: DECK_LICHLORD,
    blurb: 'Beneath the marches lie the drowned dead — and a king who never accepted his funeral. Maros felt the Nexus crack from the inside; his Seal is the second you must claim.',
    battles: [
      {
        id: 'ch2b1', name: 'The Drowned Door', difficulty: 'knight', mods: { enemyHp: 28 },
        goon: { name: 'Tomb Spider', portrait: 'gm06' },
        dialogue: [
          D('goon', 'A living heartbeat, in the crypts? My king will want it. Preserved. Twitching.'),
          D('pv', 'I carry the Seal of Root. Let me down to Maros — the Nexus is dying above you.'),
          D('goon', 'Everything dies above us. That is why we live below. Skitter, little webs!'),
        ],
        winLine: 'The drowned door grinds open on hinges of bone.',
        rewards: { gold: 60, cards: ['gmc1', 'gmc2'], pack: 1 },
      },
      {
        id: 'ch2b2', name: 'Hall of Whispers', difficulty: 'knight', mods: { enemyHp: 30 },
        goon: { name: 'Bonepile Necromancer', portrait: 'gm09' },
        dialogue: [
          D('goon', 'Every whisper here is a seeker who thought themselves clever. Now they only rattle.'),
          D('pv', 'Then listen closely, necromancer. You may learn something the dead forgot.'),
        ],
        winLine: 'The whispers change key — from mockery to murmurs of respect.',
        rewards: { gold: 70, cards: ['gmc3', 'gmc7'], pack: 1 },
      },
      {
        id: 'ch2b3', name: 'The Ossuary', difficulty: 'knight', mods: { enemyHp: 30, enemyBoard: ['tk_skeleton', 'tk_skeleton'] },
        goon: { name: 'Vampiric Noble', portrait: 'gm17' },
        dialogue: [
          D('goon', 'Bones upon bones upon bones. Do you know what my king builds with them?'),
          D('pv', 'A wall, I\'d guess. Against whatever\'s pouring out of the Nexus. It won\'t be enough.'),
          D('goon', 'No wall is ever enough. That is why we make more. And YOU.'),
        ],
        winLine: 'The ossuary settles — ten thousand skulls conceding at once.',
        rewards: { gold: 80, cards: ['gmc4', 'ntc2'], pack: 1 },
      },
      {
        id: 'ch2b4', name: 'The Deathless Court', boss: true, difficulty: 'knight',
        mods: { enemyHp: 34, extraCards: 1 },
        dialogue: [
          D('cm', 'I have died four times, seeker. Each time I returned to find the Nexus a little more… wrong. A thing is waking inside it. You get ONE attempt to prove you can face it.'),
          D('pv', 'One is all a good deck needs, Maros. Give me your Seal.'),
        ],
        winLine: '"Remarkable." Maros bows, joints creaking, and lays a shard of black iron in your palm — the Seal of Rot. "Take the deep road up, into the fire. Tell the Khan the dead are afraid. He\'ll understand what THAT costs me to say."',
        rewards: { gold: 130, cards: ['gmc5', 'gmc6', 'gmc8'], pack: 1, cardback: 'cb_crypts' },
      },
    ],
  },
  {
    id: 'ch3', name: 'The Ashen Peaks', realm: 'ember',
    commander: { name: 'Flame-Khan Vurgor', portrait: 'cm_flamekhan', hero: 'ember' },
    deck: DECK_FLAMEKHAN,
    blurb: 'The deep road climbs into fire. The war-khan duels for the joy of it — but even his laughter has an edge now. The mountain has been shaking since the Nexus first cracked.',
    battles: [
      {
        id: 'ch3b1', name: 'The Cinder Steps', difficulty: 'knight', mods: { enemyHp: 30 },
        goon: { name: 'Raging Firebrand', portrait: 'ef08' },
        dialogue: [
          D('goon', 'HA! Fresh sport climbs the Khan\'s mountain! Name yourself so I can shout it as you fall!'),
          D('pv', 'I carry two Seals and I\'m collecting a third. Step aside, or burn — your choice, firebrand.'),
          D('goon', 'BOLD! Wrong answer, but BOLD! BURN ANYWAY!'),
        ],
        winLine: 'Laughter rolls down from higher up the peak. The Khan is watching.',
        rewards: { gold: 70, cards: ['efc1', 'efc2'], pack: 1 },
      },
      {
        id: 'ch3b2', name: 'The Forgeworks', difficulty: 'knight', mods: { enemyHp: 30, tempManaStart: 1 },
        goon: { name: 'Forgefire Ritualist', portrait: 'ef11' },
        dialogue: [
          D('goon', 'The forges never cool. We arm the peaks against the day the Nexus finally breaks.'),
          D('pv', 'That day is close, ritualist. Your Khan should be helping me, not testing me.'),
        ],
        winLine: 'The forgemasters stamp their hammers — the peaks\' highest honor, grudgingly earned.',
        rewards: { gold: 80, cards: ['efc3', 'efc5'], pack: 1 },
      },
      {
        id: 'ch3b3', name: 'The Meteor Yard', difficulty: 'archmage', mods: { enemyHp: 30 },
        goon: { name: 'Ashland Warlord', portrait: 'ef12' },
        dialogue: [
          D('goon', 'The sky has thrown fire at us for a month. Not meteors — pieces of the OTHER realms, falling wrong.'),
          D('pv', 'The Nexus is bleeding the realms into each other. That\'s exactly why I\'m climbing.'),
        ],
        winLine: 'A shard of frozen sea-glass falls burning into the ash — the realms are already mixing.',
        rewards: { gold: 90, cards: ['efc7', 'ntc3'], pack: 1 },
      },
      {
        id: 'ch3b4', name: 'The Khan\'s Cauldron', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 36, tempManaStart: 1 },
        dialogue: [
          D('cm', 'The dead sent word: they are AFRAID. I have never known Maros to be afraid! So I must know — are you strong enough to matter? Show me, seeker!'),
          D('pv', 'Sing loud, Vurgor. Here comes your answer.'),
        ],
        winLine: '"MAGNIFICENT!" The Khan crushes you in a one-armed hug and thrusts a smouldering coin into your fist — the Seal of Flame. "The ocean is below the fire — go, before I demand a rematch! And seeker… whatever wakes down there, hit it TWICE for me."',
        rewards: { gold: 150, cards: ['efc9', 'efc8', 'efc6'], pack: 1, cardback: 'cb_volcanic' },
      },
    ],
  },
  {
    id: 'ch4', name: 'The Drowned Depths', realm: 'tide',
    commander: { name: 'Tidecaller Nymue', portrait: 'cm_tidecaller', hero: 'tide' },
    deck: DECK_TIDECALLER,
    blurb: 'Beneath the fire, an ocean without a sky. Its oracle has watched a single future flood every tide-pool for a month — the same ending, over and over. She has been waiting for you.',
    battles: [
      {
        id: 'ch4b1', name: 'The Glass Reef', difficulty: 'archmage', mods: { enemyHp: 30 },
        goon: { name: 'Riptide Conjurer', portrait: 'tc06' },
        dialogue: [
          D('goon', 'The oracle dreamed you\'d come. She dreamed it a thousand times. She dreamed you drowning here.'),
          D('pv', 'Then she dreamed wrong once. I have three Seals and no time for reefs.'),
          D('goon', 'No one argues with the oracle\'s dreams. Down you go!'),
        ],
        winLine: 'The reef chimes — a thousand glass bells, every one of them surprised.',
        rewards: { gold: 80, cards: ['tcc1', 'tcc2'], pack: 1 },
      },
      {
        id: 'ch4b2', name: 'The Whale Road', difficulty: 'archmage', mods: { enemyHp: 32 },
        goon: { name: 'Leviathan Calf', portrait: 'tc12' },
        dialogue: [
          D('goon', 'The leviathans sing of a stranger walking their road — and of a shadow that swallows the song entirely.'),
          D('pv', 'That shadow is what I\'m marching toward. Sing while you still can.'),
        ],
        winLine: 'Far below, something vast and ancient hums — approval, and warning both.',
        rewards: { gold: 90, cards: ['tcc3', 'tcc5'], pack: 1 },
      },
      {
        id: 'ch4b3', name: 'The Mirror Trench', difficulty: 'archmage', mods: { enemyHp: 32, extraCards: 1 },
        goon: { name: 'Illusionist of Veils', portrait: 'tc11' },
        dialogue: [
          D('goon', 'In the trench you duel your own reflection. Tell me — does it carry five Seals too? Or only four?'),
          D('pv', 'Four, and about to be five. Watch how a reflection loses, illusionist.'),
        ],
        winLine: 'Your reflection bows first — then dissolves into a smiling veil.',
        rewards: { gold: 100, cards: ['tcc6', 'tcc9'], pack: 1 },
      },
      {
        id: 'ch4b4', name: 'The Abyssal Throne', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 38, extraCards: 1 },
        dialogue: [
          D('cm', 'This is the one duel I cannot dream past. Beyond it, every future is the same darkness. The thing in the Nexus has a name now, seeker — Aetherion. It is the world, before it was ever divided into five.'),
          D('pv', 'Then let\'s give it a future worth dreaming. Your Seal, oracle.'),
        ],
        winLine: '"So THAT is how it ends." Nymue laughs like rain and offers a drop of black pearl — the Seal of Tide. "Rise. The spires burn bright above you, and the last Warden already knows what you carry."',
        rewards: { gold: 170, cards: ['tcc7', 'tcc4', 'tcc8'], pack: 1, cardback: 'cb_depths' },
      },
    ],
  },
  {
    id: 'ch5', name: 'The Celestial Spires', realm: 'dawn',
    commander: { name: 'Lightwarden Serathiel', portrait: 'cm_lightwarden', hero: 'dawn' },
    deck: DECK_LIGHTWARDEN,
    blurb: 'The Nexus crowns the spires, behind the last and brightest blade in the realms. Serathiel has held the final Seal the longest — and she alone knows what the five Seals were ever FOR.',
    battles: [
      {
        id: 'ch5b1', name: 'The Thousand Stairs', difficulty: 'archmage', mods: { enemyHp: 32 },
        goon: { name: 'Paladin of the Dawn', portrait: 'dw09' },
        dialogue: [
          D('goon', 'Four realms let you pass. The Warden bids me be certain the fifth should too.'),
          D('pv', 'I carry four Seals, paladin. I only need the fifth — and the truth behind them.'),
          D('goon', 'The truth is heavy. Prove your arm before you ask for it.'),
        ],
        winLine: 'The stairs kindle beneath your feet, lighting the long way up.',
        rewards: { gold: 100, cards: ['dwc1', 'dwc2'], pack: 1 },
      },
      {
        id: 'ch5b2', name: 'The Choir Bastion', difficulty: 'archmage', mods: { enemyHp: 34 },
        goon: { name: 'Dawnwing Herald', portrait: 'dwc7' },
        dialogue: [
          D('goon', 'The choir has sung the world\'s whole history — including the day it was torn into five. That song is why the Warden fears your quest.'),
          D('pv', 'Because gathering the Seals could put it back together — or let the tear finish the job.'),
        ],
        winLine: 'The choir falters, then — magnificently — improvises a hymn with your name in it.',
        rewards: { gold: 110, cards: ['dwc3', 'dwc4'], pack: 1 },
      },
      {
        id: 'ch5b3', name: 'The Judgment Court', difficulty: 'archmage', mods: { enemyHp: 34, enemyBoard: ['tk_squire'], extraCards: 1 },
        goon: { name: 'Oathkeeper Captain', portrait: 'dwc5' },
        dialogue: [
          D('goon', 'Here we have judged kings, dragons, and gods. Today we judge whether a single duelist should hold all five Seals at once.'),
          D('pv', 'Then judge fast, captain. Aetherion is not waiting for your verdict.'),
        ],
        winLine: 'The court\'s verdict, written in dawn-light: WORTHY — and afraid on your behalf.',
        rewards: { gold: 120, cards: ['dwc7', 'dwc8'], pack: 1 },
      },
      {
        id: 'ch5b4', name: 'The Last Seal', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 40, enemyBoard: ['tk_defender'], extraCards: 1 },
        dialogue: [
          D('cm', 'Four Seals you carry, and I hold the fifth. Understand what that means: the Seals never held the realms APART. They held Aetherion, the first-world, from clawing them back into one. Take all five, and the door to it opens. There is no other way down.'),
          D('pv', 'Then open it, Serathiel. I didn\'t cross five realms to stop at the last door. Show me everything you have.'),
          D('cm', 'Every realm. Every scar. Every card. If you cannot beat ME, you cannot survive IT. BEGIN!'),
        ],
        winLine: 'Serathiel\'s blade dims to morning-gold. She presses the Seal of Dawn into your hand — the last. Beneath the spires, an ancient door grinds open onto endless swirling dark. "Go, Champion. Face what we five could only cage."',
        rewards: { gold: 250, cards: ['dwc5', 'dwc6', 'dwc9'], pack: 2, cardback: 'cb_celestial' },
      },
    ],
  },
  {
    id: 'ch6', name: 'The Sundered Nexus', realm: 'neutral',
    commander: { name: 'Aetherion, the Convergence', portrait: 'cm_convergence', hero: 'neutral' },
    deck: DECK_CONVERGENCE,
    blurb: 'Beyond the last door, the Nexus core — where the five realms bleed into one screaming light. Aetherion, the world-before-the-world, is remaking creation in its own image. Only the five Seals, and the one who gathered them, stand between it and everything.',
    battles: [
      {
        id: 'ch6b1', name: 'Echo of Ash and Root', difficulty: 'archmage', mods: { enemyHp: 34, extraCards: 1 },
        goon: { name: 'The First Sundering', portrait: 'nt13' },
        dialogue: [
          D('goon', 'You wear five Seals like a crown, little thing. I am the memory of the day the world FIRST broke. Aetherion sends its echoes to greet you.'),
          D('pv', 'Then I\'ll answer them one at a time — starting with you.'),
        ],
        winLine: 'The echo unravels into five colored threads, screaming back toward the core.',
        rewards: { gold: 150, cards: ['ntc4', 'ntc7'], pack: 1 },
      },
      {
        id: 'ch6b2', name: 'The Hollow Crown', difficulty: 'archmage', mods: { enemyHp: 36, enemyBoard: ['tk_defender'], extraCards: 1 },
        goon: { name: 'Warden of the Broken Seal', portrait: 'nt14' },
        dialogue: [
          D('goon', 'I was a Warden once, in a realm that no longer has a name. Aetherion kept me. It keeps EVERYONE, in the end.'),
          D('pv', 'Not everyone. Not today. Rest, Warden — I\'ll carry it from here.'),
        ],
        winLine: 'The hollow guardian bows — free at last — and crumbles into quiet light.',
        rewards: { gold: 170, cards: ['ntc8', 'ntc9'], pack: 1 },
      },
      {
        id: 'ch6b3', name: 'The Fivefold Mirror', difficulty: 'archmage', mods: { enemyHp: 38, extraCards: 2 },
        goon: { name: 'Aspect of the Convergence', portrait: 'ntc10' },
        dialogue: [
          D('goon', 'Look upon me: fire and tide and root and dawn and rot, all at ONCE. This is what the world was meant to be. This is what you will become.'),
          D('pv', 'The world was meant to be five. I\'ve seen all five. They\'re worth keeping apart.'),
        ],
        winLine: 'The mirror shatters into five perfect shards — and the way to the core lies open.',
        rewards: { gold: 200, cards: ['ntc5', 'ntc6'], pack: 1 },
      },
      {
        id: 'ch6b4', name: 'Aetherion, the Convergence', boss: true, difficulty: 'archmage',
        mods: { enemyHp: 46, enemyBoard: ['tk_defender'], extraCards: 2, tempManaStart: 1 },
        dialogue: [
          D('cm', 'CHAMPION OF THE FIVE. You gathered the Seals I have wanted for an age — and carried them straight to me. How thoughtful. Now give them back to the world they were CUT from.'),
          D('pv', 'The Seals aren\'t yours, Aetherion. Neither is the world. Five realms. Five Wardens. One duelist standing in your way.'),
          D('cm', 'Then I shall be all five realms at once — and you shall be NONE. Let the Convergence BEGIN!'),
        ],
        winLine: 'The five Seals blaze white in your hand and slam shut around Aetherion, folding the first-world back into sleep. The Nexus steadies. Fire, tide, root, dawn, and rot spin gently apart — five realms, whole again, and a single duelist at their heart. You are the Warden of the Nexus now.',
        rewards: { gold: 500, cards: ['ntc10', 'efc10', 'tcc10', 'wgc10'], pack: 2, cardback: 'cb_champion' },
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
  { id: 'a_campaign', name: 'Champion of the Nexus', desc: 'Complete all 24 Campaign battles', check: (p) => p.battlesCleared >= 24, rewards: { gold: 300, cards: ['ntc10', 'efc10'], cardback: 'cb_champion' } },
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
export const PACK_SIZE = 5;
export const PACK_WEIGHTS = { common: 46, uncommon: 30, rare: 15, epic: 6, legendary: 3 };
// an already-owned card is this much less likely than an unowned one of the same
// rarity — so packs still favour progress but duplicates trickle in to sell.
export const DUPE_FACTOR = 0.22;
// gold refunded when selling a duplicate copy, by rarity. Tuned against PACK_COST
// (100): a legendary dupe nearly buys a pack; a handful of commons does too.
export const SELL_VALUES = { common: 5, uncommon: 10, rare: 20, epic: 45, legendary: 90, token: 0 };

export function allBattles() {
  return CHAPTERS.flatMap((c) => c.battles.map((b) => ({ ...b, chapter: c })));
}
