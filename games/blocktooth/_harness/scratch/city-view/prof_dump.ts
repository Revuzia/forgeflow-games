// scratch: dump the impostor profiles the city view derives from the kit
import { BIOMES } from '../../../src/data/biomes.ts';
import { buildCityKit } from '../../../src/city/meshkit.ts';
import { CityView } from '../../../src/city/cityview.ts';
const mod = await import('../../../src/city/cityview.ts') as unknown as Record<string, unknown>;
void CityView; void mod;
for (const id of ['grideast', 'whitestacks', 'lockwater'] as const) {
  const b = BIOMES[id]; const kit = buildCityKit(b);
  for (const a of b.archetypes) {
    const am = kit.arch[a.id];
    for (const piece of ['base', 'floor', 'roof'] as const) {
      const g = am[piece];
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      console.log(id, a.id, a.shape, piece, 'bbox x', bb.min.x.toFixed(2), bb.max.x.toFixed(2), 'z', bb.min.z.toFixed(2), bb.max.z.toFixed(2), 'y', bb.min.y.toFixed(2), bb.max.y.toFixed(2), 'tris', g.getAttribute('position').count / 3);
    }
  }
}
