// Crafting availability — Terraria recipe-list model (research 04 §2):
// a recipe is craftable iff the player holds all ingredients AND stands near
// every required station. Stations within a small radius stack (union).

import { TILE } from '../config.js';
import { TILES, T } from '../world/world.js';
import { RECIPES } from './recipes.js';
import { ITEMS } from './items.js';

const STATION_RADIUS = 6; // tiles — exact Terraria value unpublished (research 04), tunable

export function nearbyStations(world, player) {
  const set = new Set();
  const ptx = Math.floor(player.x / TILE), pty = Math.floor(player.y / TILE);
  for (let ty = pty - STATION_RADIUS; ty <= pty + STATION_RADIUS; ty++) {
    for (let tx = ptx - STATION_RADIUS; tx <= ptx + STATION_RADIUS; tx++) {
      const id = world.tileAt(tx, ty);
      if (id === T.air) {
        // water as environmental station
        if (world.inBounds(tx, ty) && world.liquid[ty * world.w + tx] >= 128 && world.liquidType[ty * world.w + tx] === 0) {
          set.add('water');
        }
        continue;
      }
      const st = TILES[id].station;
      if (st) set.add(st);
    }
  }
  // hellforge counts as furnace too (research 04 §3)
  if (set.has('hellforge')) set.add('furnace');
  return set;
}

// returns [{recipe, canCraft}] — all recipes whose station is present, sorted craftable-first
export function availableRecipes(inventory, stations) {
  const out = [];
  for (const r of RECIPES) {
    if (r.station && !stations.has(r.station)) continue;
    let can = true;
    for (const [id, n] of Object.entries(r.ing)) {
      if (inventory.count(id) < n) { can = false; break; }
    }
    out.push({ recipe: r, canCraft: can });
  }
  out.sort((a, b) => (b.canCraft ? 1 : 0) - (a.canCraft ? 1 : 0));
  return out;
}

export function craft(inventory, recipe) {
  for (const [id, n] of Object.entries(recipe.ing)) {
    if (inventory.count(id) < n) return false;
  }
  for (const [id, n] of Object.entries(recipe.ing)) inventory.remove(id, n);
  const leftover = inventory.add(recipe.out, recipe.n);
  if (leftover > 0) return { leftover };   // caller drops leftover at player feet
  return true;
}

export { RECIPES, ITEMS };
