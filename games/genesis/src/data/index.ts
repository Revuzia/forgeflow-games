// GENESIS — the base content pack (CONTRACT.md §9): every src/data/*.json bundled into one ContentPack.
//
// The sim (worker and Node tests) and the renderer both import this, so species / weather / biome indices agree on
// both sides of the worker boundary. Mods (mods/*.json) are separate packs merged on top by src/sim/content.ts.

import plants from './plants.json' with { type: 'json' };
import weather from './weather.json' with { type: 'json' };
import biomes from './biomes.json' with { type: 'json' };
import stars from './stars.json' with { type: 'json' };
import planetkinds from './planetkinds.json' with { type: 'json' };
import ores from './ores.json' with { type: 'json' };
import scenarios from './scenarios.json' with { type: 'json' };
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
};

export default BASE_PACK;
