/**
 * Per-circuit AAA scenery dispatcher. Each theme module owns its complete
 * environment (buildings/water/sky/industrial + its own ground) and adds meshes
 * to ctx.group. Returns true if a theme handled the circuit.
 *
 * ctx = { group, samples, def, rnd, HALF, totalLength }
 */
import { buildScene as prism_boulevard } from './prism_boulevard.js';
import { buildScene as volt_canyon } from './volt_canyon.js';
import { buildScene as glass_harbor } from './glass_harbor.js';
import { buildScene as null_spire } from './null_spire.js';
import { buildScene as echo_yards } from './echo_yards.js';

const THEMES = { prism_boulevard, volt_canyon, glass_harbor, null_spire, echo_yards };

export function buildTheme(ctx) {
  const fn = THEMES[ctx.def?.id];
  if (!fn) return false;
  try {
    fn(ctx);
    return true;
  } catch (e) {
    console.error('[scenery] theme build failed for', ctx.def.id, e);
    return false;
  }
}
