#!/usr/bin/env node
// Builds art_manifest.json — one prompt per card/token/UI asset, derived from
// the live card database so art always matches the set. Consumed by
// asset_gen/arcane_realms_gen.py.
import { COLLECTIBLE, TOKENS, REALMS } from '../runtime/sim/cards.js?v=2';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const STYLE =
  'Premium collectible card game illustration, painterly high-fantasy digital art, ' +
  'dramatic cinematic lighting, rich saturated colors, crisp detail, centered subject, ' +
  'no text, no letters, no borders, no frames, no watermark. ';

const REALM_MOOD = {
  ember: 'Palette: molten oranges, deep reds, volcanic forge glow, drifting embers.',
  tide: 'Palette: deep ocean blues and teals, bioluminescent glow, sea mist and currents.',
  grove: 'Palette: lush emerald greens, amber sunlight shafts, ancient forest depths.',
  dawn: 'Palette: radiant gold and warm ivory light, holy glow, marble and sunbeams.',
  grave: 'Palette: violet necrotic glow, sickly green accents, gothic gloom and mist.',
  neutral: 'Palette: weathered stone and steel greys warmed by torchlight.',
};

// Hand-tuned subjects where the generic template would under-deliver.
const OVERRIDES = {
  ef15: 'A blazing phoenix wreathed in gold-orange flame rising from a pile of glowing embers, wings fully spread',
  ef17: 'A cataclysmic volcanic eruption engulfing a battlefield, rains of lava bombs, silhouetted warriors fleeing',
  ef19: 'A colossal ancient fire dragon with magma-cracked obsidian scales unfurling vast wings over a burning horizon',
  ef20: 'A hulking demon berserker with hammer-scarred iron skin swinging burning chain weapons mid-charge',
  ef18: 'A rune-carved threshold erupting in a wall of defensive flame as a raider recoils',
  tc07: 'A glowing azure rune-sigil circle shattering an incoming fireball into harmless sparks of light',
  tc16: 'An immense storm serpent coiling through hurricane clouds above a raging ocean, lightning wreathing its body',
  tc17: 'A glowing whirlpool trap beneath the waves yanking an armored warrior down into the deep',
  tc18: 'A majestic empress of the deep — regal woman with leviathan features on a coral throne, crown of ice, frozen waves around her',
  tc19: 'A crystalline archon made of floating mirror shards hovering in a fractured reflective dimension',
  wg14: 'Massive thorned roots erupting from forest soil to entangle a charging knight',
  wg17: 'A mountain-sized moss-covered stone colossus rising out of an ancient forest, whole trees on its shoulders',
  wg18: 'An ancient world-tree treant goddess with a luminous emerald heart glowing inside her trunk, blossoming branches spread wide',
  wg19: 'A great horned jungle panther mid-pounce onto an armored foe, claws out, motion blur',
  dw13: 'A six-winged golden seraph descending inside a column of holy light, arms open in benediction',
  dw14: 'A shimmering dome of golden light snapping into being around a startled knight, spectral shield glyphs',
  dw16: 'An armored paladin high-justicar with golden wings aloft, greatsword of pure light raised, war banners behind',
  dw18: 'A blazing golden sigil of justice igniting above a fallen soldier, spectral scales of judgment descending on the killer',
  dw19: 'A phalanx of glowing celestial guardians in golden plate descending from parted clouds in tight shield-wall formation',
  gm13: 'A screaming soul being pulled as glowing violet vapor from a collapsing knight into a necromancer’s outstretched hand',
  gm14: 'A rotting lich in tattered ceremonial robes unleashing a swirling green plague-cloud over a battlefield',
  gm15: 'A ghostly violet hand rising from a fresh grave, dragging a corpse down while its enslaved spirit rises',
  gm16: 'A hexed warrior mid-swing as sickly green curse-runes crawl up his weapon arm, strength visibly draining',
  gm18: 'A towering undead king upon an obsidian throne, crowned skull wreathed in violet soulfire, cape of shadow',
  gm19: 'Hooded necromancers ringing a glowing purple summoning circle as skeletal warriors claw up from the earth',
  nt19: 'A collapsing dungeon floor revealing a pit of iron spikes as an armored raider tumbles in',
  nt20: 'A flamboyant planar merchant in a patchwork coat from many realms, opening a case lined with glowing portal-trinkets, sly grin',
  nt21: 'An ageless wizard suspended among floating clock faces and streams of frozen sand, time visibly bending around him',
  tk_ember: 'A single brilliant arcane ember-spark held between two fingertips, tiny glowing runes orbiting it',
  tk_morthul: 'A diminished undead king reforming from swirling violet soulfire, cracked crown reigniting',
};

function subjectFor(c) {
  if (OVERRIDES[c.id]) return OVERRIDES[c.id];
  const realmName = REALMS[c.realm].name;
  if (c.type === 'creature') {
    const tribe = c.tribe ? `${c.tribe.toLowerCase()} ` : '';
    return `Full-body fantasy ${tribe}creature portrait: ${c.name} of ${realmName}. ${c.flavor || c.text || ''}`;
  }
  if (c.type === 'spell') {
    return `Dynamic magical spell illustration: "${c.name}" — ${c.text} ${c.flavor || ''}`;
  }
  return `Ominous magical trap illustration: "${c.name}" — ${c.text}`;
}

const entries = [];
for (const c of [...COLLECTIBLE, ...Object.values(TOKENS)]) {
  const premium = c.rarity === 'epic' || c.rarity === 'legendary';
  entries.push({
    key: c.id,
    file: `assets/art/${c.id}.jpg`,
    model: premium ? 'quality' : 'standard',
    resize: 512,
    prompt: STYLE + subjectFor(c) + ' ' + REALM_MOOD[c.realm],
  });
}

// UI set
entries.push(
  {
    key: 'board', file: 'assets/ui/board.jpg', model: 'quality', resize: 1600,
    prompt:
      'Top-down view of an ornate fantasy card-game battlefield table: dark carved wood and stone ' +
      'with subtle arcane rune inlays, a faint glowing sigil at center, atmospheric torch-lit edges, ' +
      'symmetrical composition, muted tones so game pieces stand out. No text, no cards, no UI, no watermark.',
  },
  {
    key: 'menu_bg', file: 'assets/ui/menu_bg.jpg', model: 'quality', resize: 1600,
    prompt:
      'Epic fantasy key art: five elemental realms converging toward a glowing arcane nexus in a stormy sky — ' +
      'a volcanic forge, a deep ocean wave, an ancient forest, a radiant golden citadel, and a haunted violet mire — ' +
      'cinematic composition, dramatic light, painterly detail. No text, no logos, no watermark.',
  },
  {
    key: 'cardback', file: 'assets/ui/cardback.jpg', model: 'quality', resize: 1024,
    prompt:
      'Ornate trading-card back design: symmetrical arcane mandala with a five-pointed crystal star at center, ' +
      'each point glowing a different color (red, blue, green, gold, violet), deep midnight-blue field, ' +
      'gold filigree corners, elegant and balanced. Perfectly symmetrical, no text, no letters, no watermark.',
  },
);

// hero portraits
const HEROES = {
  ember: 'A fierce dragonkin warlord champion, molten-veined black armor, flaming crest, confident battle grin',
  tide: 'A regal water archmage, robes of flowing seawater and ice, glowing tide-staff, calm piercing eyes',
  grove: 'A wild elven arch-druid crowned with antlers and leaves, living wood staff, calm feral strength',
  dawn: 'A radiant paladin high-priestess in gold-and-ivory plate, halo of dawn light, serene resolve',
  grave: 'An elegant lich sovereign with a crown of obsidian shards, violet soulfire eyes, regal tattered robes',
  neutral: 'A grizzled mercenary captain with a scarred face, patchwork plate armor, torchlit smirk',
};
for (const [realm, desc] of Object.entries(HEROES)) {
  entries.push({
    key: `hero_${realm}`, file: `assets/ui/hero_${realm}.jpg`, model: 'quality', resize: 512,
    prompt: STYLE + `Bust portrait for a game avatar: ${desc}. ${REALM_MOOD[realm]} Looking at viewer.`,
  });
}

const out = join(HERE, '..', 'art_manifest.json');
writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), count: entries.length, entries }, null, 2));
console.log(`wrote ${entries.length} prompts -> ${out}`);
