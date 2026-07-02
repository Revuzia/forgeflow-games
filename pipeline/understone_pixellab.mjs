#!/usr/bin/env node
// understone_pixellab.mjs — bulk pixel-art assets from the PixelLab API (v2).
// Reference: research/terraria/06-pixellab-api.md (live-verified endpoints & costs).
// Subscription: 2000 generations/month. Icons = 1 gen; character = 1; template anim = 1/direction.
//
// Usage (from forgeflow-games/):
//   node pipeline/understone_pixellab.mjs icons [--only id1,id2] [--force] [--limit N]
//   node pipeline/understone_pixellab.mjs characters [--only name1] [--force]
//   node pipeline/understone_pixellab.mjs balance
//
// Icons: auto-derived from the game's items.js registry → assets/items/<id>.png (32x32 RGBA).
// Characters: manifest below → assets/entities/<name>/<anim>/frame_XXX.png + meta.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FFG = resolve(__dirname, '..');
const GAME = resolve(FFG, 'games', 'understone');
const BASE = 'https://api.pixellab.ai/v2';

const KEY = JSON.parse(readFileSync(
  resolve(process.env.APPDATA ?? 'C:/Users/TestRun/AppData/Roaming', 'Nomi', 'api_config.json'), 'utf-8',
)).pixellab.api_key;

const args = process.argv.slice(2);
const cmd = args[0];
const FORCE = args.includes('--force');
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? +args[i + 1] : Infinity; })();

let spent = 0;
async function api(path, body, method = 'POST') {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const wait = 2 ** attempt * 1500;
      console.log(`  [${path}] HTTP ${res.status} — backoff ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (res.status === 423) return { __still_generating: true };
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    if (data.usage?.generations) spent += data.usage.generations;
    return data;
  }
  throw new Error(`${path}: retries exhausted`);
}

function saveB64(b64, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

// ---------------------------------------------------------------------------
// ICONS — one 32x32 transparent icon per item, prompts derived from the registry
// ---------------------------------------------------------------------------
const TYPE_HINTS = {
  tool: 'held tool, diagonal composition',
  weapon: 'weapon, diagonal composition',
  armor: 'armor piece',
  block: 'cube-ish block of material',
  wall: 'flat wall panel of material',
  material: 'crafting material',
  consumable: 'magical consumable',
  ammo: 'single arrow',
  summon: 'ominous ritual item',
};
// per-item prompt overrides where the registry name alone under-describes
const ICON_OVERRIDES = {
  gel: 'wobbly blue slime gel blob, translucent',
  lens: 'single monster eye lens, red iris',
  fallenStar: 'glowing golden five pointed star',
  shadowScale: 'dark purple monster scale',
  rottenChunk: 'rotten flesh chunk, sickly green',
  chain: 'short iron chain links',
  goldCrown: 'small golden royal crown with red gem',
  lifeCrystal: 'heart shaped red crystal in stone base',
  manaCrystal: 'star shaped light blue crystal cluster',
  magicMirror: 'ornate hand mirror with glowing cyan glass',
  suspiciousEye: 'large veined eyeball with red iris, creepy',
  slimeCrown: 'golden crown covered in blue slime',
  wormFood: 'pulsating ball of rotten meat and worms',
  acorn: 'brown acorn seed',
  torch: 'wooden torch with orange flame',
  platform: 'wooden plank platform section',
  woodWall: 'wooden plank wall panel',
  dirtWall: 'packed dirt wall panel',
  stoneWall: 'gray stone brick wall panel',
  bottlePlaced: 'small empty glass bottle',
  hellforgeItem: 'demonic forge furnace with lava glow',
  frostbrand: 'sword with pale blue ice blade, frost mist',
  stormblade: 'sword with crackling lightning blade',
  tideEdge: 'sword with flowing blue water blade',
  glacierBow: 'bow carved from blue ice',
  tempestBow: 'golden bow crackling with lightning',
  moltenFury: 'bow of molten rock with lava veins',
  demonBow: 'dark purple demonic bow with spikes',
  volcano: 'greatsword with molten lava blade',
  lightsBane: 'jagged dark purple demon sword',
  bladeOfGrass: 'sword with jagged green leaf blade dripping sap',
  sunfury: 'spiked flaming morningstar ball on chain handle',
  darkLance: 'ornate dark purple lance spear with cruel point',
  waterBolt: 'blue spellbook with water swirl on cover',
  demonScythe: 'purple demonic scythe spell tome with skull',
  vilethorn: 'twisted purple thorn wand',
  rubyStaff: 'gold staff topped with glowing red ruby gem',
  diamondStaff: 'gold staff topped with brilliant diamond crystal',
  enchantedBoomerang: 'glowing blue enchanted wooden boomerang',
  lesserManaPotion: 'small potion bottle of glowing blue liquid',
  lesserHealingPotion: 'small potion bottle of glowing red liquid',
  vine: 'coiled green jungle vine with leaves',
  silk: 'folded bolt of white silk fabric',
  campfire: 'small campfire with logs and orange flames',
  lantern: 'hanging brass lantern with warm glow',
  candle: 'lit wax candle on holder',
  sawmill: 'wooden sawmill machine with circular saw blade',
  loom: 'wooden weaving loom with thread',
  bed: 'wooden bed with red blanket and pillow',
  table: 'simple wooden table',
  chair: 'simple wooden chair',
  bedroll: 'rolled up camping bedroll',
  grapplingHook: 'iron grappling hook with chain',
  hook: 'curved iron hook',
  stinger: 'sharp green venomous stinger',
  spear: 'simple iron-tipped wooden spear',
  trident: 'gleaming silver three-pronged trident',
  ballOHurt: 'spiked purple ball on chain',
};

async function runIcons() {
  const { ITEMS } = await import(pathToFileURL(resolve(GAME, 'js', 'items', 'items.js')));
  const outDir = resolve(GAME, 'assets', 'items');
  const ids = Object.keys(ITEMS).filter(id => !only || only.has(id));
  let made = 0, skipped = 0, failed = 0;
  console.log(`[icons] ${ids.length} items (limit ${LIMIT})`);
  const queue = [...ids];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length && made < LIMIT) {
      const id = queue.shift();
      const out = resolve(outDir, `${id}.png`);
      if (!FORCE && existsSync(out)) { skipped++; continue; }
      const def = ITEMS[id];
      const desc = ICON_OVERRIDES[id] ?? `${def.name.toLowerCase()}, ${TYPE_HINTS[def.type] ?? 'game item'}`;
      try {
        const r = await api('/create-image-pixen', {
          description: `${desc}, game item icon, retro 16-bit pixel art`,
          image_size: { width: 32, height: 32 },
          no_background: true,
          outline: 'single color black outline',
          detail: 'medium detail',
          seed: 1000 + Math.abs([...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 100000,
        });
        saveB64(r.image.base64, out);
        made++;
        console.log(`  [ok] ${id} (${made} done, ${spent.toFixed(1)} gens)`);
      } catch (e) {
        failed++;
        console.log(`  [FAIL] ${id}: ${e.message.slice(0, 160)}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`[icons] done: ${made} generated, ${skipped} existing, ${failed} failed, ~${spent.toFixed(1)} generations spent`);
}

// ---------------------------------------------------------------------------
// CHARACTERS — animated via template mode, EAST direction only (mirror locally)
// ---------------------------------------------------------------------------
const CHARACTERS = {
  hero: {
    description: 'brave adventurer hero, brown messy hair, blue tunic shirt, dark green trousers, leather boots, empty hands',
    size: 64, proportions: 'heroic',
    animations: ['walk', 'breathing-idle', 'attack', 'jump', 'dying'],
  },
  zombie: {
    description: 'shambling zombie, rotten gray-green skin, torn brown rags, arms reaching forward',
    size: 64, animations: ['walk', 'attack', 'dying'],
  },
  skeleton: {
    description: 'walking skeleton warrior, bone white, cracked skull, tattered belt',
    size: 64, animations: ['walk', 'attack', 'dying'],
  },
  mummy: {
    description: 'desert mummy wrapped in dusty bandages, glowing yellow eyes',
    size: 64, animations: ['walk', 'attack', 'dying'],
  },
  ghost: {
    description: 'translucent ghost specter, pale blue white, wispy lower body trailing into mist, hollow dark eyes',
    size: 64, animations: ['breathing-idle', 'attack', 'dying'],
  },
  undeadMiner: {
    description: 'undead miner zombie with mining helmet and glowing lamp, gray skin, overalls',
    size: 64, animations: ['walk', 'attack', 'dying'],
  },
  goblin: {
    description: 'small green goblin warrior with crude wooden club and leather scraps',
    size: 48, animations: ['walk', 'attack', 'dying'],
  },
  demon: {
    description: 'winged red demon, bat wings, horns, clawed hands, muscular, hellish',
    size: 64, animations: ['breathing-idle', 'attack', 'dying'],
  },
  iceWolf: {
    description: 'snarling white ice wolf with frost blue fur and icy spikes on back',
    size: 64, template: 'dog', animations: ['walk', 'attack', 'dying'],
  },
  vulture: {
    description: 'desert vulture bird, dark feathers, bald pink head, hunched',
    size: 48, template: 'cat', animations: ['breathing-idle', 'attack', 'dying'],
  },
  // ---- v3: armored hero variants (equipped armor VISIBLE on the player) --------
  heroCopper: {
    description: 'brave adventurer hero, brown messy hair, wearing full polished copper-orange plate armor with helmet',
    size: 64, proportions: 'heroic', animations: ['walk', 'breathing-idle', 'cross-punch', 'jump'],
  },
  heroIron: {
    description: 'brave adventurer hero wearing full dull-gray iron plate armor with visored helmet',
    size: 64, proportions: 'heroic', animations: ['walk', 'breathing-idle', 'cross-punch', 'jump'],
  },
  heroSilver: {
    description: 'brave adventurer hero wearing gleaming silver plate armor with plumed helmet',
    size: 64, proportions: 'heroic', animations: ['walk', 'breathing-idle', 'cross-punch', 'jump'],
  },
  heroGold: {
    description: 'brave adventurer hero wearing ornate shining golden plate armor with crowned helmet',
    size: 64, proportions: 'heroic', animations: ['walk', 'breathing-idle', 'cross-punch', 'jump'],
  },
  heroShadow: {
    description: 'brave adventurer hero wearing dark purple demonic scale armor with horned helmet, glowing purple accents',
    size: 64, proportions: 'heroic', animations: ['walk', 'breathing-idle', 'cross-punch', 'jump'],
  },
  heroMolten: {
    description: 'brave adventurer hero wearing volcanic molten rock armor with glowing orange lava cracks and fiery helmet',
    size: 64, proportions: 'heroic', animations: ['walk', 'breathing-idle', 'cross-punch', 'jump'],
  },
  // ---- v3: new enemy characters --------------------------------------------------
  skeletonArcher: {
    description: 'skeleton archer warrior holding a wooden bow, bone white with quiver of arrows',
    size: 64, animations: ['walk', 'breathing-idle', 'cross-punch'],
  },
  spider: {
    description: 'large hairy brown cave spider with eight legs and glowing eyes, side view',
    size: 48, template: 'cat', animations: ['fast-walk', 'idle', 'angry'],
  },
  graniteElemental: {
    description: 'living granite stone golem with glowing blue energy veins between dark rock plates',
    size: 64, animations: ['walk', 'breathing-idle', 'cross-punch'],
  },
  snatcher: {
    description: 'carnivorous green plant monster head on a stem, open toothy maw like a venus flytrap',
    size: 48, template: 'cat', animations: ['idle', 'angry'],
  },
};

const poll = async (jobId, label) => {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const j = await api(`/background-jobs/${jobId}`, null, 'GET');
    if (j.status === 'completed') return j;
    if (j.status === 'failed') throw new Error(`${label}: job failed`);
    if (i % 5 === 4) console.log(`  [poll] ${label} still ${j.status}…`);
  }
  throw new Error(`${label}: poll timeout`);
};

async function runCharacters() {
  const stateFile = resolve(__dirname, 'understone_pixellab_state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf-8')) : { characters: {} };
  const names = Object.keys(CHARACTERS).filter(n => !only || only.has(n));

  for (const name of names) {
    const spec = CHARACTERS[name];
    const outDir = resolve(GAME, 'assets', 'entities', name);
    try {
      let rec = state.characters[name];
      // 1. create character (1 gen)
      if (!rec?.id) {
        console.log(`[char] creating ${name}…`);
        const r = await api('/create-character-with-8-directions', {
          description: `${spec.description}, retro 16-bit pixel art game character`,
          image_size: { width: spec.size, height: spec.size },
          mode: 'standard', view: 'side',
          outline: 'single color black outline', shading: 'basic shading', detail: 'medium detail',
          ...(spec.template ? { template_id: spec.template } : {}),
          ...(spec.proportions ? { proportions: { type: 'preset', name: spec.proportions } } : {}),
          seed: 42,
        });
        rec = state.characters[name] = { id: r.character_id, anims: {} };
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
        await poll(r.background_job_id, `${name} base`);
      }
      // 2. template animations, east only (1 gen each)
      for (const anim of spec.animations) {
        if (rec.anims[anim] && !FORCE) continue;
        console.log(`[char] ${name} → ${anim}…`);
        try {
          const a = await api('/characters/animations', {
            character_id: rec.id,
            template_animation_id: anim,
            directions: ['east'],
            seed: 42,
          });
          await poll(a.background_job_ids[0], `${name}/${anim}`);
          rec.anims[anim] = true;
          writeFileSync(stateFile, JSON.stringify(state, null, 2));
        } catch (e) {
          console.log(`  [warn] ${name}/${anim}: ${e.message.slice(0, 140)}`);
        }
      }
      // 3. download frames from character record (free)
      console.log(`[char] fetching ${name} frames…`);
      const c = await api(`/characters/${rec.id}`, null, 'GET');
      mkdirSync(outDir, { recursive: true });
      // base rotation (east)
      const eastUrl = c.rotation_urls?.east ?? c.rotation_urls?.[0];
      if (eastUrl) {
        const img = Buffer.from(await (await fetch(eastUrl)).arrayBuffer());
        writeFileSync(resolve(outDir, 'base.png'), img);
      }
      const meta = { size: spec.size, animations: {} };
      for (const anim of c.animations ?? []) {
        const dir = (anim.directions ?? []).find(d => d.direction === 'east') ?? anim.directions?.[0];
        if (!dir?.frames?.length) continue;
        const aDir = resolve(outDir, anim.animation_type ?? anim.name ?? 'anim');
        mkdirSync(aDir, { recursive: true });
        for (let f = 0; f < dir.frames.length; f++) {
          const img = Buffer.from(await (await fetch(dir.frames[f])).arrayBuffer());
          writeFileSync(resolve(aDir, `frame_${String(f).padStart(3, '0')}.png`), img);
        }
        meta.animations[anim.animation_type ?? anim.name] = { frames: dir.frames.length };
      }
      writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
      console.log(`  [ok] ${name}: ${Object.keys(meta.animations).join(', ')} (${spent.toFixed(1)} gens so far)`);
    } catch (e) {
      console.log(`  [FAIL] ${name}: ${e.message.slice(0, 200)}`);
    }
  }
  console.log(`[characters] done — ~${spent.toFixed(1)} generations spent this run`);
}

// ---------------------------------------------------------------------------
if (cmd === 'balance') {
  const b = await api('/balance', null, 'GET');
  console.log(JSON.stringify(b, null, 2));
} else if (cmd === 'icons') {
  await runIcons();
} else if (cmd === 'characters') {
  await runCharacters();
} else {
  console.log('usage: node pipeline/understone_pixellab.mjs balance|icons|characters [--only a,b] [--force] [--limit N]');
  process.exit(1);
}
