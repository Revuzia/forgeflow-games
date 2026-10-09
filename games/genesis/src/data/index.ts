// GENESIS — the base content pack (CONTRACT.md §9): every src/data/*.json bundled into one ContentPack.
//
// The sim (worker and Node tests) and the renderer both import this, so species / weather / biome / building / item
// indices agree on both sides of the worker boundary. Mods (mods/*.json) are separate packs merged on top by
// src/sim/content.ts. Species files are listed in a fixed order: that order is the species index everywhere.

import plants from './plants.json' with { type: 'json' };
import weather from './weather.json' with { type: 'json' };
import biomes from './biomes.json' with { type: 'json' };
import stars from './stars.json' with { type: 'json' };
import planetkinds from './planetkinds.json' with { type: 'json' };
import ores from './ores.json' with { type: 'json' };
import scenarios from './scenarios.json' with { type: 'json' };
import items from './items.json' with { type: 'json' };
import recipes from './recipes.json' with { type: 'json' };
import buildings from './buildings.json' with { type: 'json' };
import materials from './materials.json' with { type: 'json' };
import animals from './animals.json' with { type: 'json' };
import diseases from './diseases.json' with { type: 'json' };
import names from './names.json' with { type: 'json' };
import events from './events.json' with { type: 'json' };
import powers from './powers.json' with { type: 'json' };
import disasters from './disasters.json' with { type: 'json' };
import creatures from './creatures.json' with { type: 'json' };
import lexicon from './lexicon.json' with { type: 'json' };
import ships from './ships.json' with { type: 'json' };
import plainsFolk from './species/plains-folk.json' with { type: 'json' };
import coastalFolk from './species/coastal-folk.json' with { type: 'json' };
import hive from './species/hive.json' with { type: 'json' };
import coldFolk from './species/cold-folk.json' with { type: 'json' };
import methaneDrifters from './species/methane-drifters.json' with { type: 'json' };
import type { ContentPack } from '../sim/content.ts';

export const BASE_PACK: ContentPack = {
  id: 'base',
  name: 'GENESIS base',
  version: '1.0.0',
  plants: plants.plants as unknown as ContentPack['plants'],
  weather: weather.weather as unknown as ContentPack['weather'],
  biomes: biomes.biomes as unknown as ContentPack['biomes'],
  biomeRules: biomes.rules as unknown as ContentPack['biomeRules'],
  stars: stars.stars as unknown as ContentPack['stars'],
  planetkinds: planetkinds.kinds as unknown as ContentPack['planetkinds'],
  ores: ores.ores as unknown as ContentPack['ores'],
  scenarios: scenarios.scenarios as unknown as ContentPack['scenarios'],
  species: [plainsFolk, coastalFolk, hive, coldFolk, methaneDrifters] as unknown as ContentPack['species'],
  items: items.items as unknown as ContentPack['items'],
  recipes: recipes.recipes as unknown as ContentPack['recipes'],
  buildings: buildings.buildings as unknown as ContentPack['buildings'],
  materials: materials.materials as unknown as ContentPack['materials'],
  animals: animals.animals as unknown as ContentPack['animals'],
  diseases: diseases.diseases as unknown as ContentPack['diseases'],
  phonologies: names.phonologies as unknown as ContentPack['phonologies'],
  events: events.templates as unknown as ContentPack['events'],
  // the god layer (phase 3)
  powers: powers.powers as unknown as ContentPack['powers'],
  disasters: disasters.disasters as unknown as ContentPack['disasters'],
  creatures: creatures.creatures as unknown as ContentPack['creatures'],
  lexicon: lexicon as unknown as ContentPack['lexicon'],
  // worlds and space (phase 4)
  ships: ships.ships as unknown as ContentPack['ships'],
};

/** name titles (leader / priest / master), shared by the sim's naming and the inspector */
export const NAME_TITLES = names.titles as Record<string, string[]>;

export default BASE_PACK;
