// Arcane Realms TCG — complete card database.
// Structured effect fields drive the engine; `text` is what the player reads.
// Effect DSL ops are interpreted in engine.js (see resolveOps).
//
// Card shape:
//  { id, name, realm, type:'creature'|'spell'|'trap', cost, atk, hp, rarity,
//    tribe, kw:[...keywords], target:{...} (if the card chooses a target),
//    rally:[ops], rites:[ops], fx:[ops] (spells), trap:{on, fx:[ops]},
//    aura:{...}, text, flavor }
//
// Target selectors used by ops:
//  'chosen'                — the target the player picked when playing the card
//  'self'                  — the creature itself (rally/rites)
//  'self-hero','enemy-hero'
//  'all-enemy-creatures','all-friendly-creatures','all-other-creatures','all-creatures'
//  'random-enemy-creature','trigger-attacker'
//
// target (choice) spec: {kind:'creature'|'any'|'friendly-creature'|'enemy-creature',
//                        filter:{maxCost,minAtk,damaged}}  — 'any' = creature or hero

export const REALMS = {
  ember:  { name: 'Emberforge', color: 0xe8542f, css: '#e8542f' },
  tide:   { name: 'Tidecall',   color: 0x2f7fe8, css: '#2f7fe8' },
  grove:  { name: 'Wildgrove',  color: 0x3fae52, css: '#3fae52' },
  dawn:   { name: 'Dawnward',   color: 0xe8b93a, css: '#e8b93a' },
  grave:  { name: 'Gravemire',  color: 0x8a3fd4, css: '#8a3fd4' },
  neutral:{ name: 'Neutral',    color: 0x8d99ae, css: '#8d99ae' },
};

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const KEYWORD_INFO = {
  guard:      'Guard — enemies must attack this creature first.',
  swift:      'Swift — can attack the turn it is summoned.',
  flying:     'Flying — can only be attacked by Flying creatures. Guarding or tapped Flyers lose this evasion.',
  stealth:    'Stealth — cannot be attacked or targeted until it attacks.',
  ward:       'Ward — negates the first enemy spell or effect that targets this.',
  lifesteal:  'Lifesteal — combat damage this deals also heals your hero.',
  venomous:   'Venomous — destroys any creature it damages.',
  cleave:     'Cleave — attacks also hit the creatures adjacent to the target.',
  piercing:   'Piercing — excess lethal damage vs creatures hits the enemy hero.',
  regenerate: 'Regenerate X — restores X health at the start of your turn.',
  frenzy:     'Frenzy +X — has +X attack while damaged.',
};

function C(id, name, realm, cost, atk, hp, rarity, tribe, extra = {}) {
  return { id, name, realm, type: 'creature', cost, atk, hp, rarity, tribe, kw: [], ...extra };
}
function S(id, name, realm, cost, rarity, extra = {}) {
  return { id, name, realm, type: 'spell', cost, rarity, ...extra };
}
function T(id, name, realm, cost, rarity, extra = {}) {
  return { id, name, realm, type: 'trap', cost, rarity, ...extra };
}

// ───────────────────────────── EMBERFORGE (19) ─────────────────────────────
const EMBER = [
  C('ef01', 'Cinder Whelp', 'ember', 1, 2, 1, 'common', 'Dragon', {
    text: 'A hatchling of the forge-flame.',
    flavor: 'Small sparks start great fires.',
  }),
  C('ef02', 'Goblin Torchrunner', 'ember', 1, 1, 1, 'common', 'Goblin', {
    kw: ['swift'],
    text: 'Swift.',
    flavor: 'First into battle, first out of patience.',
  }),
  S('ef03', 'Emberbolt', 'ember', 1, 'common', {
    target: { kind: 'any' },
    fx: [{ op: 'damage', amount: 2, target: 'chosen' }],
    text: 'Deal 2 damage.',
    flavor: 'The forge answers all questions.',
  }),
  C('ef04', 'Forge Acolyte', 'ember', 2, 2, 2, 'common', 'Wizard', {
    target: { kind: 'friendly-creature', optional: true },
    rally: [{ op: 'buff', atk: 1, hp: 0, target: 'chosen' }],
    text: 'Rally: give a friendly creature +1 Attack.',
    flavor: 'Every blade is a prayer to the flame.',
  }),
  C('ef05', 'Flamefist Brawler', 'ember', 2, 3, 2, 'common', 'Mercenary', {
    kw: ['frenzy'], frenzy: 2,
    text: 'Frenzy +2.',
    flavor: 'Pain is just fuel.',
  }),
  C('ef06', 'Wyrmling Skirmisher', 'ember', 2, 2, 1, 'uncommon', 'Dragon', {
    kw: ['flying'],
    text: 'Flying.',
    flavor: 'Too young to hoard, old enough to burn.',
  }),
  S('ef07', 'Scorching Volley', 'ember', 2, 'uncommon', {
    fx: [{ op: 'aoe', amount: 1, side: 'enemy' }],
    text: 'Deal 1 damage to all enemy creatures.',
    flavor: 'The sky rains cinders.',
  }),
  C('ef08', 'Raging Firebrand', 'ember', 3, 4, 2, 'uncommon', 'Goblin', {
    kw: ['swift'],
    text: 'Swift.',
    flavor: 'He signed the contract in soot.',
  }),
  C('ef09', 'Drake of the Ashpeaks', 'ember', 3, 3, 2, 'common', 'Dragon', {
    kw: ['flying'],
    text: 'Flying.',
    flavor: 'Nesting season closes the mountain passes.',
  }),
  S('ef10', 'Fireball', 'ember', 4, 'common', {
    target: { kind: 'any' },
    fx: [{ op: 'damage', amount: 5, target: 'chosen' }],
    text: 'Deal 5 damage.',
    flavor: 'The classic. Accept no substitute.',
  }),
  C('ef11', 'Forgefire Ritualist', 'ember', 4, 3, 3, 'uncommon', 'Wizard', {
    rally: [{ op: 'damage', amount: 2, target: 'enemy-hero' }],
    text: 'Rally: deal 2 damage to the enemy hero.',
    flavor: 'Her sermons leave scorch marks.',
  }),
  C('ef12', 'Ashland Warlord', 'ember', 4, 4, 3, 'rare', 'Mercenary', {
    kw: ['cleave'],
    text: 'Cleave.',
    flavor: 'One swing, three funerals.',
  }),
  C('ef13', 'Magma Elemental', 'ember', 5, 5, 4, 'uncommon', 'Elemental', {
    rally: [{ op: 'aoe', amount: 1, side: 'enemy' }],
    text: 'Rally: deal 1 damage to all enemy creatures.',
    flavor: 'It does not walk. It erupts, repeatedly.',
  }),
  S('ef14', 'Dragonfire Blast', 'ember', 5, 'rare', {
    target: { kind: 'enemy-creature' },
    fx: [{ op: 'damage', amount: 4, target: 'chosen' }, { op: 'damage', amount: 2, target: 'adjacent-to-chosen' }],
    text: 'Deal 4 damage to an enemy creature and 2 to its neighbors.',
    flavor: 'Dragons do not aim. They gesture.',
  }),
  C('ef15', 'Phoenix of the Second Dawn', 'ember', 5, 4, 3, 'epic', 'Elemental', {
    kw: ['flying'],
    rites: [{ op: 'summon', token: 'tk_phoenix', count: 1, who: 'owner' }],
    text: 'Flying. Last Rites: rises again as a 2/2 Reborn Phoenix.',
    flavor: 'Death is merely its favorite entrance.',
  }),
  S('ef16', 'Twin Salamanders', 'ember', 3, 'uncommon', {
    fx: [{ op: 'summon', token: 'tk_salamander', count: 2, who: 'owner' }],
    text: 'Summon two 2/1 Salamanders.',
    flavor: 'They always come in pairs. Nobody knows why.',
  }),
  S('ef17', 'Volcanic Rampage', 'ember', 7, 'epic', {
    fx: [{ op: 'aoe', amount: 4, side: 'enemy', includeHero: true }],
    text: 'Deal 4 damage to the enemy hero and all enemy creatures.',
    flavor: 'The mountain filed its grievances in person.',
  }),
  T('ef18', 'Flame Ward', 'ember', 2, 'uncommon', {
    trap: { on: 'hero-attacked', fx: [{ op: 'damage', amount: 3, target: 'trigger-attacker' }] },
    text: 'Trap: when an enemy creature attacks your hero, deal 3 damage to it.',
    flavor: 'Knock first.',
  }),
  C('ef19', 'Pyraxis, the Worldflame', 'ember', 8, 8, 6, 'legendary', 'Dragon', {
    kw: ['flying'],
    rally: [{ op: 'aoe', amount: 3, side: 'enemy' }],
    text: 'Flying. Rally: deal 3 damage to all enemy creatures.',
    flavor: 'When Pyraxis wakes, the world remembers what it was forged from.',
  }),
  C('ef20', 'Hellforged Berserker', 'ember', 6, 6, 4, 'epic', 'Demon', {
    kw: ['swift', 'frenzy'], frenzy: 3,
    text: 'Swift. Frenzy +3.',
    flavor: 'The forge rejected him. He took that personally.',
  }),
];

// ───────────────────────────── TIDECALL (19) ─────────────────────────────
const TIDE = [
  C('tc01', 'Tidepool Adept', 'tide', 1, 1, 3, 'common', 'Wizard', {
    text: 'A patient student of the currents.',
    flavor: 'Still waters study you back.',
  }),
  S('tc02', 'Frost Nip', 'tide', 1, 'common', {
    target: { kind: 'enemy-creature' },
    fx: [{ op: 'damage', amount: 1, target: 'chosen' }, { op: 'freeze', target: 'chosen' }],
    text: 'Deal 1 damage to an enemy creature and Freeze it.',
    flavor: 'A polite suggestion to stop.',
  }),
  C('tc03', 'Mistral Sprite', 'tide', 2, 2, 1, 'common', 'Elemental', {
    kw: ['flying'],
    text: 'Flying.',
    flavor: 'Made of sea-spray and spite.',
  }),
  C('tc04', 'Arcane Scholar', 'tide', 2, 1, 2, 'uncommon', 'Wizard', {
    rally: [{ op: 'draw', count: 1, who: 'self' }],
    text: 'Rally: draw a card.',
    flavor: 'Knowledge is the only tide that never ebbs.',
  }),
  S('tc05', 'Tidal Shield', 'tide', 2, 'common', {
    target: { kind: 'friendly-creature' },
    fx: [{ op: 'buff', atk: 0, hp: 2, kw: ['ward'], target: 'chosen' }],
    text: 'Give a friendly creature +0/+2 and Ward.',
    flavor: 'The sea protects its own.',
  }),
  C('tc06', 'Riptide Conjurer', 'tide', 3, 2, 3, 'uncommon', 'Wizard', {
    target: { kind: 'enemy-creature', filter: { maxCost: 3 }, optional: true },
    rally: [{ op: 'bounce', target: 'chosen' }],
    text: 'Rally: return an enemy creature costing 3 or less to its owner’s hand.',
    flavor: 'The undertow negotiates for her.',
  }),
  T('tc07', 'Counterspell Sigil', 'tide', 3, 'rare', {
    trap: { on: 'enemy-spell', fx: [{ op: 'negate-spell' }] },
    text: 'Trap: when the enemy casts a spell, negate it.',
    flavor: '"No." — inscription, roughly translated',
  }),
  C('tc08', 'Deep Current Elemental', 'tide', 4, 3, 5, 'common', 'Elemental', {
    kw: ['guard'],
    text: 'Guard.',
    flavor: 'You do not cross the deep. The deep permits.',
  }),
  S('tc09', 'Insight of the Depths', 'tide', 3, 'common', {
    fx: [{ op: 'draw', count: 2, who: 'self' }],
    text: 'Draw 2 cards.',
    flavor: 'The abyss also gazes helpfully.',
  }),
  S('tc10', 'Frostbind', 'tide', 4, 'uncommon', {
    fx: [{ op: 'freeze-all', side: 'enemy' }],
    text: 'Freeze all enemy creatures.',
    flavor: 'Winter arrives when she says it does.',
  }),
  C('tc11', 'Illusionist of Veils', 'tide', 4, 3, 3, 'rare', 'Wizard', {
    kw: ['ward'],
    rally: [{ op: 'draw', count: 1, who: 'self' }],
    text: 'Ward. Rally: draw a card.',
    flavor: 'Which one is real? Wrong question.',
  }),
  C('tc12', 'Leviathan Calf', 'tide', 5, 4, 6, 'uncommon', 'Leviathan', {
    text: 'A juvenile of the great deeps.',
    flavor: 'Its mother is the reason sailors pray.',
  }),
  S('tc13', 'Maelstrom', 'tide', 6, 'rare', {
    fx: [{ op: 'aoe', amount: 2, side: 'enemy' }, { op: 'freeze-all', side: 'enemy' }],
    text: 'Deal 2 damage to all enemy creatures and Freeze them.',
    flavor: 'The sea opened one eye.',
  }),
  C('tc14', 'Depthsage Oracle', 'tide', 5, 3, 4, 'rare', 'Wizard', {
    rally: [{ op: 'draw', count: 2, who: 'self' }],
    text: 'Rally: draw 2 cards.',
    flavor: 'She reads futures in the wave-foam. Mostly footnotes.',
  }),
  S('tc15', 'Twin Reflections', 'tide', 2, 'uncommon', {
    fx: [{ op: 'summon', token: 'tk_reflection', count: 2, who: 'owner' }],
    text: 'Summon two 0/2 Reflections with Guard.',
    flavor: 'Mirrors of salt water and moonlight.',
  }),
  C('tc16', 'Tempest Serpent', 'tide', 6, 5, 5, 'epic', 'Leviathan', {
    kw: ['flying'],
    rally: [{ op: 'freeze-random', count: 2, side: 'enemy' }],
    text: 'Flying. Rally: Freeze two random enemy creatures.',
    flavor: 'Storms are just its wake.',
  }),
  T('tc17', 'Undertow Trap', 'tide', 2, 'uncommon', {
    trap: { on: 'creature-attacked', fx: [{ op: 'bounce', target: 'trigger-attacker' }] },
    text: 'Trap: when an enemy creature attacks, return it to its owner’s hand.',
    flavor: 'The current keeps what it likes and returns the rest.',
  }),
  C('tc18', 'Nerivia, Tide Empress', 'tide', 8, 6, 7, 'legendary', 'Leviathan', {
    rally: [{ op: 'freeze-all', side: 'enemy' }, { op: 'draw', count: 2, who: 'self' }],
    text: 'Rally: Freeze all enemy creatures and draw 2 cards.',
    flavor: 'Her court is the ocean floor. Attendance is mandatory.',
  }),
  C('tc19', 'Mirrorplane Archon', 'tide', 7, 5, 7, 'epic', 'Elemental', {
    kw: ['flying', 'ward'],
    target: { kind: 'enemy-creature', optional: true },
    rally: [{ op: 'bounce', target: 'chosen' }],
    text: 'Flying, Ward. Rally: return an enemy creature to its owner’s hand.',
    flavor: 'It reflects everything except mercy.',
  }),
];

// ───────────────────────────── WILDGROVE (19) ─────────────────────────────
const GROVE = [
  C('wg01', 'Grove Sproutling', 'grove', 1, 1, 2, 'common', 'Treant', {
    kw: ['regenerate'], regenerate: 1,
    text: 'Regenerate 1.',
    flavor: 'Stubborn as spring.',
  }),
  C('wg02', 'Elvish Pathfinder', 'grove', 1, 2, 1, 'common', 'Elf', {
    text: 'She knows every trail worth walking.',
    flavor: 'The forest moves its paths for her.',
  }),
  S('wg03', 'Verdant Growth', 'grove', 2, 'common', {
    fx: [{ op: 'ramp', amount: 1 }],
    text: 'Gain an empty mana crystal.',
    flavor: 'All great things begin as seeds.',
  }),
  C('wg04', 'Thornhide Boar', 'grove', 2, 3, 2, 'common', 'Beast', {
    text: 'Do not pet.',
    flavor: 'Its bristles have opinions.',
  }),
  C('wg05', 'Sylvan Archer', 'grove', 2, 2, 2, 'uncommon', 'Elf', {
    target: { kind: 'enemy-creature', optional: true },
    rally: [{ op: 'damage', amount: 1, target: 'chosen' }],
    text: 'Rally: deal 1 damage to an enemy creature.',
    flavor: 'One arrow, one answer.',
  }),
  S('wg06', "Nature's Bounty", 'grove', 3, 'common', {
    fx: [{ op: 'heal', amount: 4, target: 'self-hero' }, { op: 'draw', count: 1, who: 'self' }],
    text: 'Restore 4 health to your hero and draw a card.',
    flavor: 'The grove provides. The grove also invoices.',
  }),
  C('wg07', 'Bramblewall', 'grove', 3, 2, 5, 'common', 'Treant', {
    kw: ['guard', 'regenerate'], regenerate: 1,
    text: 'Guard. Regenerate 1.',
    flavor: 'Grows back twice as spiteful.',
  }),
  S('wg08', 'Titan Growth', 'grove', 4, 'uncommon', {
    target: { kind: 'friendly-creature' },
    fx: [{ op: 'buff', atk: 3, hp: 3, target: 'chosen' }],
    text: 'Give a friendly creature +3/+3.',
    flavor: 'The grove does not do things by halves.',
  }),
  C('wg09', 'Packleader of the Vale', 'grove', 4, 3, 3, 'rare', 'Beast', {
    aura: { atk: 1, filter: { tribe: 'Beast' } },
    rally: [{ op: 'summon', token: 'tk_wolf', count: 1, who: 'owner' }],
    text: 'Rally: summon a 2/2 Wolf. Your other Beasts have +1 Attack.',
    flavor: 'The pack is her argument.',
  }),
  C('wg10', 'Moss Giant', 'grove', 5, 5, 6, 'common', 'Giant', {
    text: 'Patient as stone, angrier.',
    flavor: 'He sat down for a century. The forest grew a coat on him.',
  }),
  C('wg11', 'Thicket Ambusher', 'grove', 3, 4, 2, 'uncommon', 'Beast', {
    kw: ['stealth'],
    text: 'Stealth.',
    flavor: 'The last thing poachers never see.',
  }),
  C('wg12', 'Elderwood Shaman', 'grove', 5, 4, 4, 'uncommon', 'Elf', {
    fxNote: 'ramp',
    rally: [{ op: 'ramp', amount: 1 }],
    text: 'Rally: gain an empty mana crystal.',
    flavor: 'He speaks tree fluently.',
  }),
  C('wg13', 'Stampeding Mammothorn', 'grove', 6, 6, 5, 'rare', 'Beast', {
    kw: ['piercing'],
    text: 'Piercing.',
    flavor: 'Walls are a rumor it refuses to believe.',
  }),
  T('wg14', 'Entangling Roots', 'grove', 2, 'uncommon', {
    trap: { on: 'creature-attacked', fx: [{ op: 'freeze', target: 'trigger-attacker' }] },
    text: 'Trap: when an enemy creature attacks, Freeze it.',
    flavor: 'The ground is hungrier than it looks.',
  }),
  S('wg15', 'Feral Awakening', 'grove', 5, 'rare', {
    fx: [{ op: 'buff', atk: 2, hp: 2, target: 'all-friendly-creatures' }],
    text: 'Give your creatures +2/+2.',
    flavor: 'The wild remembers what it is.',
  }),
  C('wg16', 'Ancient Treant', 'grove', 7, 6, 8, 'uncommon', 'Treant', {
    kw: ['guard'],
    text: 'Guard.',
    flavor: 'It measures time in forests.',
  }),
  C('wg17', 'Primal Colossus', 'grove', 8, 8, 8, 'epic', 'Giant', {
    kw: ['piercing', 'regenerate'], regenerate: 2,
    text: 'Piercing. Regenerate 2.',
    flavor: 'The mountains taught it to stand. Nothing taught it to stop.',
  }),
  C('wg18', 'Verdance, Heart of the Grove', 'grove', 9, 8, 8, 'legendary', 'Treant', {
    kw: ['guard', 'regenerate'], regenerate: 3,
    rally: [{ op: 'heal', amount: 8, target: 'self-hero' }, { op: 'buff', atk: 1, hp: 1, target: 'all-other-friendly-creatures' }],
    text: 'Guard, Regenerate 3. Rally: restore 8 health to your hero and give your other creatures +1/+1.',
    flavor: 'Every forest is one of her heartbeats.',
  }),
  S('wg19', "Predator's Pounce", 'grove', 3, 'common', {
    target: { kind: 'friendly-creature' },
    target2: { kind: 'enemy-creature' },
    fx: [{ op: 'fight' }],
    text: 'A friendly creature fights an enemy creature.',
    flavor: 'Nature resolves disputes directly.',
  }),
];

// ───────────────────────────── DAWNWARD (19) ─────────────────────────────
const DAWN = [
  C('dw01', 'Novice Cleric', 'dawn', 1, 1, 1, 'common', 'Cleric', {
    rally: [{ op: 'heal', amount: 2, target: 'self-hero' }],
    text: 'Rally: restore 2 health to your hero.',
    flavor: 'Her faith is small and absolutely unbreakable.',
  }),
  C('dw02', 'Shieldbearer Recruit', 'dawn', 1, 1, 2, 'common', 'Paladin', {
    kw: ['guard'],
    text: 'Guard.',
    flavor: 'The shield is bigger than he is. He grew into the job.',
  }),
  S('dw03', 'Healing Light', 'dawn', 1, 'common', {
    target: { kind: 'friendly-any' },
    fx: [{ op: 'heal', amount: 4, target: 'chosen' }],
    text: 'Restore 4 health to a friendly character.',
    flavor: 'Dawn asks nothing back.',
  }),
  C('dw04', 'Knight-Aspirant', 'dawn', 2, 2, 3, 'common', 'Paladin', {
    text: 'Sworn, polished, and eager.',
    flavor: 'The oath came first. The sword was a formality.',
  }),
  S('dw05', "Acolyte's Blessing", 'dawn', 2, 'uncommon', {
    target: { kind: 'friendly-creature' },
    fx: [{ op: 'buff', atk: 1, hp: 2, kw: ['lifesteal'], target: 'chosen' }],
    text: 'Give a friendly creature +1/+2 and Lifesteal.',
    flavor: 'Light shared is light doubled.',
  }),
  C('dw06', 'Temple Guardian', 'dawn', 3, 2, 5, 'common', 'Construct', {
    kw: ['guard'],
    text: 'Guard.',
    flavor: 'Carved from the temple. Still part of it.',
  }),
  C('dw07', 'Radiant Priestess', 'dawn', 3, 2, 3, 'uncommon', 'Cleric', {
    rally: [{ op: 'heal', amount: 4, target: 'self-hero' }],
    text: 'Rally: restore 4 health to your hero.',
    flavor: 'Her hymns close wounds and open hearts.',
  }),
  S('dw08', 'Call the Faithful', 'dawn', 3, 'common', {
    fx: [{ op: 'summon', token: 'tk_squire', count: 2, who: 'owner' }],
    text: 'Summon two 1/1 Squires.',
    flavor: 'The dawn never marches alone.',
  }),
  C('dw09', 'Paladin of the Dawn', 'dawn', 4, 3, 4, 'uncommon', 'Paladin', {
    kw: ['lifesteal'],
    text: 'Lifesteal.',
    flavor: 'Every blow struck for the light returns as grace.',
  }),
  S('dw10', 'Blessing of Dawn', 'dawn', 4, 'rare', {
    fx: [{ op: 'buff', atk: 1, hp: 1, target: 'all-friendly-creatures' }, { op: 'heal', amount: 2, target: 'self-hero' }],
    text: 'Give your creatures +1/+1 and restore 2 health to your hero.',
    flavor: 'Sunrise, weaponized.',
  }),
  C('dw11', 'Aegis Sentinel', 'dawn', 5, 4, 6, 'rare', 'Construct', {
    kw: ['guard', 'ward'],
    text: 'Guard, Ward.',
    flavor: 'Built by artificers, blessed by clerics, feared by siege engineers.',
  }),
  S('dw12', 'Judgment of Light', 'dawn', 5, 'rare', {
    target: { kind: 'enemy-creature', filter: { minAtk: 4 } },
    fx: [{ op: 'destroy', target: 'chosen' }],
    text: 'Destroy an enemy creature with 4 or more Attack.',
    flavor: 'The light weighs. The light decides.',
  }),
  C('dw13', 'Seraph of Mercy', 'dawn', 6, 4, 5, 'epic', 'Celestial', {
    kw: ['flying', 'lifesteal'],
    rally: [{ op: 'heal', amount: 5, target: 'self-hero' }],
    text: 'Flying, Lifesteal. Rally: restore 5 health to your hero.',
    flavor: 'Mercy, it turns out, has a wingspan.',
  }),
  T('dw14', 'Sanctuary Ward', 'dawn', 2, 'uncommon', {
    trap: { on: 'hero-attacked', fx: [{ op: 'summon', token: 'tk_defender', count: 1, who: 'owner' }] },
    text: 'Trap: when an enemy attacks your hero, summon a 2/3 Squire Defender with Guard.',
    flavor: 'The dawn keeps a spare shield for everyone.',
  }),
  S('dw15', 'Banner of the Dawn', 'dawn', 6, 'uncommon', {
    fx: [{ op: 'summon', token: 'tk_squire', count: 3, who: 'owner' }, { op: 'buff', atk: 1, hp: 0, target: 'all-friendly-creatures' }],
    text: 'Summon three 1/1 Squires, then give your creatures +1 Attack.',
    flavor: 'Raise it high enough and hope follows.',
  }),
  C('dw16', 'Seraphine, High Justicar', 'dawn', 7, 5, 6, 'legendary', 'Paladin', {
    kw: ['flying'],
    rally: [{ op: 'buff', atk: 2, hp: 2, target: 'all-other-friendly-creatures' }],
    text: 'Flying. Rally: give your other creatures +2/+2.',
    flavor: 'Her verdicts are read aloud by trumpets.',
  }),
  C('dw17', 'Zealous Crusader', 'dawn', 5, 5, 5, 'common', 'Paladin', {
    text: 'Faith, plate armor, and momentum.',
    flavor: 'Doubt has never caught up with her.',
  }),
  T('dw18', 'Retribution Sigil', 'dawn', 3, 'rare', {
    trap: { on: 'friendly-killed-by-attack', fx: [{ op: 'destroy', target: 'trigger-attacker' }] },
    text: 'Trap: when an enemy creature kills one of your creatures in combat, destroy the attacker.',
    flavor: 'The light keeps precise accounts.',
  }),
  S('dw19', 'Celestial Phalanx', 'dawn', 7, 'epic', {
    fx: [{ op: 'summon', token: 'tk_celestial', count: 2, who: 'owner' }],
    text: 'Summon two 3/4 Celestial Guardians with Guard and Lifesteal.',
    flavor: 'Heaven holds the line.',
  }),
];

// ───────────────────────────── GRAVEMIRE (19) ─────────────────────────────
const GRAVE = [
  C('gm01', 'Restless Skeleton', 'grave', 1, 1, 1, 'common', 'Undead', {
    rites: [{ op: 'damage', amount: 1, target: 'enemy-hero' }],
    text: 'Last Rites: deal 1 damage to the enemy hero.',
    flavor: 'It has one grudge left and excellent aim.',
  }),
  C('gm02', 'Plague Rat', 'grave', 1, 1, 1, 'uncommon', 'Beast', {
    kw: ['venomous'],
    text: 'Venomous.',
    flavor: 'Small teeth. Large consequences.',
  }),
  S('gm03', 'Dark Pact', 'grave', 1, 'uncommon', {
    target: { kind: 'friendly-creature' },
    fx: [{ op: 'destroy', target: 'chosen', friendly: true }, { op: 'draw', count: 2, who: 'self' }],
    text: 'Destroy a friendly creature. Draw 2 cards.',
    flavor: 'The mire always pays promptly.',
  }),
  C('gm04', 'Grave Acolyte', 'grave', 2, 2, 2, 'common', 'Cleric', {
    rites: [{ op: 'summon', token: 'tk_skeleton', count: 1, who: 'owner' }],
    text: 'Last Rites: summon a 1/1 Restless Skeleton.',
    flavor: 'Death is a promotion in her congregation.',
  }),
  S('gm05', 'Drain Life', 'grave', 2, 'common', {
    target: { kind: 'creature' },
    fx: [{ op: 'damage', amount: 2, target: 'chosen' }, { op: 'heal', amount: 2, target: 'self-hero' }],
    text: 'Deal 2 damage to a creature. Restore 2 health to your hero.',
    flavor: 'Waste not.',
  }),
  C('gm06', 'Tomb Spider', 'grave', 3, 2, 3, 'uncommon', 'Beast', {
    kw: ['venomous'],
    text: 'Venomous.',
    flavor: 'It webs the crypt doors from the inside.',
  }),
  C('gm07', 'Cursed Revenant', 'grave', 3, 3, 2, 'common', 'Undead', {
    rites: [{ op: 'damage', amount: 2, target: 'enemy-hero' }],
    text: 'Last Rites: deal 2 damage to the enemy hero.',
    flavor: 'Vengeance survives most things. Including him.',
  }),
  S('gm08', 'Wither', 'grave', 3, 'common', {
    target: { kind: 'enemy-creature' },
    fx: [{ op: 'debuff', atk: -3, hp: -3, target: 'chosen' }],
    text: 'Give an enemy creature -3/-3.',
    flavor: 'Everything returns to the mire eventually.',
  }),
  C('gm09', 'Bonepile Necromancer', 'grave', 4, 3, 3, 'rare', 'Wizard', {
    rally: [{ op: 'resurrect', count: 1, filter: { maxCost: 3 }, who: 'self' }],
    text: 'Rally: resummon a random friendly creature costing 3 or less that died this game.',
    flavor: 'Retirement is negotiable.',
  }),
  C('gm10', 'Shadow Assassin', 'grave', 4, 4, 2, 'uncommon', 'Mercenary', {
    kw: ['stealth'],
    text: 'Stealth.',
    flavor: 'The contract never specifies how.',
  }),
  S('gm11', 'Deathgrip', 'grave', 4, 'uncommon', {
    target: { kind: 'enemy-creature', filter: { damaged: true } },
    fx: [{ op: 'destroy', target: 'chosen' }],
    text: 'Destroy a damaged enemy creature.',
    flavor: 'The mire finishes what others start.',
  }),
  C('gm12', 'Abyssal Fiend', 'grave', 5, 6, 6, 'uncommon', 'Demon', {
    rally: [{ op: 'damage', amount: 3, target: 'self-hero' }],
    text: 'Rally: your hero takes 3 damage.',
    flavor: 'Power always names its price. Pay it or step aside.',
  }),
  S('gm13', 'Soul Harvest', 'grave', 6, 'rare', {
    target: { kind: 'enemy-creature' },
    fx: [{ op: 'destroy', target: 'chosen' }, { op: 'heal', amountFromTargetHp: true, target: 'self-hero' }],
    text: 'Destroy an enemy creature. Restore health to your hero equal to its health.',
    flavor: 'Nothing in the mire is wasted. Especially not souls.',
  }),
  C('gm14', 'Plaguebringer Lich', 'grave', 6, 4, 5, 'epic', 'Undead', {
    rally: [{ op: 'aoe', amount: 2, side: 'all-others' }],
    text: 'Rally: deal 2 damage to all other creatures.',
    flavor: 'He considers plague a love language.',
  }),
  T('gm15', 'Grave Betrayal', 'grave', 2, 'rare', {
    trap: { on: 'enemy-death', fx: [{ op: 'steal-corpse' }] },
    text: 'Trap: when an enemy creature dies, resummon it under your control.',
    flavor: 'The mire holds no funerals. Only auditions.',
  }),
  T('gm16', 'Curse of Weakness', 'grave', 2, 'uncommon', {
    trap: { on: 'creature-attacked', fx: [{ op: 'debuff', atk: -2, hp: 0, target: 'trigger-attacker' }] },
    text: 'Trap: when an enemy creature attacks, it gets -2 Attack.',
    flavor: 'Strength leaks out through the hex-marks.',
  }),
  C('gm17', 'Vampiric Noble', 'grave', 5, 4, 4, 'uncommon', 'Undead', {
    kw: ['lifesteal'],
    text: 'Lifesteal.',
    flavor: 'Old money. Older appetites.',
  }),
  C('gm18', 'Morthul, the Deathless King', 'grave', 9, 7, 7, 'legendary', 'Undead', {
    target: { kind: 'enemy-creature', optional: true },
    rally: [{ op: 'destroy', target: 'chosen' }],
    rites: [{ op: 'summon', token: 'tk_morthul', count: 1, who: 'owner' }],
    text: 'Rally: destroy an enemy creature. Last Rites: returns as the 4/4 Deathless One.',
    flavor: 'He conquered death by boring it into submission.',
  }),
  S('gm19', 'Ritual of the Damned', 'grave', 7, 'epic', {
    fx: [{ op: 'resurrect', count: 3, filter: { maxCost: 4 }, who: 'self' }],
    text: 'Resummon 3 random friendly creatures costing 4 or less that died this game.',
    flavor: 'The dead RSVP promptly.',
  }),
];

// ───────────────────────────── NEUTRAL (21) ─────────────────────────────
const NEUTRAL = [
  C('nt01', 'Sellsword Initiate', 'neutral', 1, 2, 1, 'common', 'Mercenary', {
    text: 'Cheap, cheerful, expendable.',
    flavor: 'Payment up front. Heroism extra.',
  }),
  C('nt02', 'Cave Bat', 'neutral', 1, 1, 1, 'common', 'Beast', {
    kw: ['flying'],
    text: 'Flying.',
    flavor: 'The dungeon’s unofficial doorbell.',
  }),
  C('nt03', 'Hired Blade', 'neutral', 2, 2, 3, 'common', 'Mercenary', {
    text: 'Loyal to the coin, friendly to its owner.',
    flavor: 'His rates double after dark.',
  }),
  C('nt04', 'Wandering Mimic', 'neutral', 2, 3, 2, 'uncommon', 'Mimic', {
    kw: ['stealth'],
    text: 'Stealth.',
    flavor: 'The treasure chest that dreams bigger.',
  }),
  C('nt05', 'Gelatinous Ooze', 'neutral', 3, 2, 4, 'uncommon', 'Ooze', {
    kw: ['guard'],
    target: { kind: 'enemy-creature', optional: true },
    rally: [{ op: 'silence', target: 'chosen' }],
    text: 'Guard. Rally: Silence an enemy creature.',
    flavor: 'It absorbs magic, weapons, and dignity alike.',
  }),
  C('nt06', 'Dungeon Adventurer', 'neutral', 3, 3, 4, 'common', 'Mercenary', {
    text: 'Ten-foot pole sold separately.',
    flavor: 'Her map is wrong in three exciting ways.',
  }),
  C('nt07', 'Stone Golem', 'neutral', 4, 4, 5, 'common', 'Construct', {
    text: 'Instructions: point at problem.',
    flavor: 'It has one job and infinite patience.',
  }),
  C('nt08', 'Shield Construct', 'neutral', 2, 0, 4, 'common', 'Construct', {
    kw: ['guard'],
    text: 'Guard.',
    flavor: 'A door that walks.',
  }),
  C('nt09', 'Battle-Scarred Veteran', 'neutral', 5, 5, 6, 'common', 'Mercenary', {
    text: 'Survived everything, including retirement.',
    flavor: 'Each scar has a story. Most end with "and that’s why we ran."',
  }),
  C('nt10', 'Rust Monster', 'neutral', 3, 2, 3, 'rare', 'Beast', {
    target: { kind: 'enemy-creature', optional: true },
    rally: [{ op: 'debuff', atk: -2, hp: 0, target: 'chosen' }],
    text: 'Rally: an enemy creature gets -2 Attack.',
    flavor: 'It considers swords a delicacy.',
  }),
  C('nt11', 'Owl Griffin', 'neutral', 4, 3, 3, 'uncommon', 'Beast', {
    kw: ['flying'],
    text: 'Flying.',
    flavor: 'Wise enough to fly above the argument.',
  }),
  C('nt12', 'Arena Champion', 'neutral', 6, 6, 5, 'uncommon', 'Mercenary', {
    kw: ['frenzy'], frenzy: 2,
    text: 'Frenzy +2.',
    flavor: 'The crowd chants her name. She chants it louder.',
  }),
  C('nt13', 'Ancient Sphinx', 'neutral', 6, 4, 6, 'rare', 'Celestial', {
    rally: [{ op: 'draw', count: 1, who: 'self' }, { op: 'draw', count: 1, who: 'enemy' }],
    text: 'Rally: both players draw a card.',
    flavor: 'Every answer costs a riddle.',
  }),
  C('nt14', 'Colossus of the Ruins', 'neutral', 7, 7, 7, 'uncommon', 'Construct', {
    text: 'The civilization fell. Its doorman did not.',
    flavor: 'Still waiting for someone with an appointment.',
  }),
  S('nt15', "Adventurer's Map", 'neutral', 1, 'common', {
    fx: [{ op: 'draw', count: 1, who: 'self' }],
    text: 'Draw a card.',
    flavor: '"X" marks several dozen spots.',
  }),
  S('nt16', 'Healing Potion', 'neutral', 2, 'common', {
    fx: [{ op: 'heal', amount: 5, target: 'self-hero' }],
    text: 'Restore 5 health to your hero.',
    flavor: 'Tastes like cherries and second chances.',
  }),
  S('nt17', 'Explosive Barrel', 'neutral', 3, 'uncommon', {
    target: { kind: 'creature' },
    fx: [{ op: 'damage', amount: 3, target: 'chosen' }],
    text: 'Deal 3 damage to a creature.',
    flavor: 'Conveniently placed, suspiciously red.',
  }),
  S('nt18', 'Mercenary Contract', 'neutral', 4, 'uncommon', {
    fx: [{ op: 'summon', token: 'tk_sellsword', count: 2, who: 'owner' }],
    text: 'Summon two 2/2 Sellswords.',
    flavor: 'Terms: gold now, glory maybe.',
  }),
  T('nt19', 'Spike Pit', 'neutral', 2, 'common', {
    trap: { on: 'hero-attacked', fx: [{ op: 'damage', amount: 2, target: 'trigger-attacker' }] },
    text: 'Trap: when an enemy creature attacks your hero, deal 2 damage to it.',
    flavor: 'Classic. Effective. Slightly rude.',
  }),
  C('nt20', 'Zanzibar, Planar Merchant', 'neutral', 5, 4, 4, 'legendary', 'Mercenary', {
    rally: [{ op: 'add-random', count: 2, who: 'self' }],
    text: 'Rally: add 2 random cards to your hand.',
    flavor: 'He accepts gold, gems, and interesting favors.',
  }),
  C('nt21', 'Chronarch Vex, the Timeless', 'neutral', 7, 6, 6, 'legendary', 'Wizard', {
    rally: [{ op: 'untap-all', who: 'self' }],
    text: 'Rally: untap all your other creatures.',
    flavor: 'For Vex, "again" is a place.',
  }),
];

// ───────────────────────────── TOKENS ─────────────────────────────
export const TOKENS = {
  tk_phoenix:    C('tk_phoenix', 'Reborn Phoenix', 'ember', 2, 2, 2, 'token', 'Elemental', { kw: ['flying'], text: 'Flying.', flavor: 'Ash is just an intermission.' }),
  tk_salamander: C('tk_salamander', 'Salamander', 'ember', 1, 2, 1, 'token', 'Elemental', { text: '', flavor: 'Warm to the touch. Very.' }),
  tk_reflection: C('tk_reflection', 'Reflection', 'tide', 1, 0, 2, 'token', 'Elemental', { kw: ['guard'], text: 'Guard.', flavor: 'Salt water and moonlight.' }),
  tk_wolf:       C('tk_wolf', 'Vale Wolf', 'grove', 2, 2, 2, 'token', 'Beast', { text: '', flavor: 'The pack provides.' }),
  tk_squire:     C('tk_squire', 'Squire', 'dawn', 1, 1, 1, 'token', 'Paladin', { text: '', flavor: 'Someday, a knight.' }),
  tk_defender:   C('tk_defender', 'Squire Defender', 'dawn', 2, 2, 3, 'token', 'Paladin', { kw: ['guard'], text: 'Guard.', flavor: 'Today, a wall.' }),
  tk_celestial:  C('tk_celestial', 'Celestial Guardian', 'dawn', 4, 3, 4, 'token', 'Celestial', { kw: ['guard', 'lifesteal'], text: 'Guard, Lifesteal.', flavor: 'Heaven holds the line.' }),
  tk_sellsword:  C('tk_sellsword', 'Sellsword', 'neutral', 2, 2, 2, 'token', 'Mercenary', { text: '', flavor: 'Gold now, glory maybe.' }),
  tk_skeleton:   C('tk_skeleton', 'Risen Skeleton', 'grave', 1, 1, 1, 'token', 'Undead', { text: '', flavor: 'Clatters with purpose.' }),
  tk_morthul:    C('tk_morthul', 'Morthul, the Deathless One', 'grave', 4, 4, 4, 'token', 'Undead', { text: 'The king, diminished. The grudge, intact.', flavor: 'Death was a demotion.' }),
  tk_ember:      S('tk_ember', 'Arcane Ember', 'neutral', 0, 'token', {
    fx: [{ op: 'temp-mana', amount: 1 }],
    text: 'Gain 1 mana crystal this turn only.',
    flavor: 'A spark borrowed from tomorrow.',
  }),
};

export const CARDS = {};
for (const c of [...EMBER, ...TIDE, ...GROVE, ...DAWN, ...GRAVE, ...NEUTRAL]) CARDS[c.id] = c;
for (const [k, v] of Object.entries(TOKENS)) CARDS[k] = v;

export const COLLECTIBLE = Object.values(CARDS).filter((c) => c.rarity !== 'token');

export function cardById(id) {
  const c = CARDS[id];
  if (!c) throw new Error('unknown card id: ' + id);
  return c;
}

// sanity numbers (asserted in selftest)
export const SET_STATS = (() => {
  const s = { total: COLLECTIBLE.length, byRarity: {}, byRealm: {}, byType: {} };
  for (const c of COLLECTIBLE) {
    s.byRarity[c.rarity] = (s.byRarity[c.rarity] || 0) + 1;
    s.byRealm[c.realm] = (s.byRealm[c.realm] || 0) + 1;
    s.byType[c.type] = (s.byType[c.type] || 0) + 1;
  }
  return s;
})();
