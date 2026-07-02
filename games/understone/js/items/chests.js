// Chest storage + worldgen loot seeding.
// Loot pools follow research/terraria/02 chest tables in spirit, restricted to items
// that exist in the v1 database (accessories deferred — Magic Mirror IS included).

import { rng } from '../world/worldgen.js';
import { LAYERS, WORLD_H } from '../config.js';

export const CHEST_SLOTS = 20;

export class Chests {
  constructor(world) {
    this.world = world;
    this.map = new Map();     // "tx,ty" → [{id,count}|null × CHEST_SLOTS]
  }

  key(tx, ty) { return `${tx},${ty}`; }
  get(tx, ty) { return this.map.get(this.key(tx, ty)) ?? null; }

  ensure(tx, ty) {
    const k = this.key(tx, ty);
    if (!this.map.has(k)) this.map.set(k, new Array(CHEST_SLOTS).fill(null));
    return this.map.get(k);
  }

  isEmpty(tx, ty) {
    const c = this.get(tx, ty);
    return !c || c.every(s => !s);
  }

  remove(tx, ty) { this.map.delete(this.key(tx, ty)); }

  // seed loot for all worldgen cabin chests (world.genChests = [[tx,ty],...])
  seedWorldLoot() {
    const rand = rng(this.world.seed ^ 0x5eed);
    for (const [tx, ty] of this.world.genChests ?? []) {
      const slots = this.ensure(tx, ty);
      const depthFrac = ty / WORLD_H;
      const deep = depthFrac > LAYERS.cavern;
      let i = 0;
      const put = (id, count) => { if (i < CHEST_SLOTS) slots[i++] = { id, count }; };

      // primary item
      const roll = rand();
      if (roll < 0.14) put('magicMirror', 1);
      else if (roll < 0.30) put('lifeCrystal', 1);
      else if (roll < 0.5) put(deep ? 'goldBow' : 'ironBow', 1);
      else if (roll < 0.7) put(deep ? 'silverSword' : 'ironSword', 1);
      else put(deep ? 'goldPickaxe' : 'ironPickaxe', 1);

      // fillers
      if (rand() < 0.9) put('torch', 5 + (rand() * 10 | 0));
      if (rand() < 0.8) put('woodenArrow', 15 + (rand() * 20 | 0));
      if (rand() < 0.6) put(deep ? 'goldBar' : 'silverBar', 2 + (rand() * 4 | 0));
      if (rand() < 0.5) put('gel', 3 + (rand() * 6 | 0));
      if (rand() < 0.35) put('bomb', 2 + (rand() * 4 | 0));
      if (rand() < 0.4) put('wood', 10 + (rand() * 15 | 0));
      if (deep && rand() < 0.3) put('flamingArrow', 10 + (rand() * 15 | 0));
      if (deep && rand() < 0.2) put('demonite', 3 + (rand() * 6 | 0));
    }
  }
}
