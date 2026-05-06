/**
 * survival_core.js — RUST / ARK / Don't Starve survival loop.
 * Hunger/thirst/fatigue/health + crafting + inventory + base decay.
 *
 * API:
 *   const s = new SurvivalStats({maxHunger, decay_rates});
 *   s.tick(dt);                       // per-frame
 *   s.consume("food");                // eat
 *   s.craft("axe", inventory);        // craft item if recipes allow
 */
class SurvivalStats {
  constructor(cfg = {}) {
    this.health = cfg.maxHealth ?? 100; this.maxHealth = cfg.maxHealth ?? 100;
    this.hunger = cfg.maxHunger ?? 100; this.maxHunger = cfg.maxHunger ?? 100;
    this.thirst = cfg.maxThirst ?? 100; this.maxThirst = cfg.maxThirst ?? 100;
    this.fatigue = cfg.maxFatigue ?? 100; this.maxFatigue = cfg.maxFatigue ?? 100;
    this.temp = cfg.temp ?? 37;
    this.decay = cfg.decay_rates || { hunger: 0.4, thirst: 0.7, fatigue: 0.2 };
    this.recipes = cfg.recipes || DEFAULT_RECIPES;
    this.inventory = cfg.inventory || {};
  }
  tick(dt) {
    this.hunger  = Math.max(0, this.hunger  - this.decay.hunger  * dt);
    this.thirst  = Math.max(0, this.thirst  - this.decay.thirst  * dt);
    this.fatigue = Math.max(0, this.fatigue - this.decay.fatigue * dt);
    if (this.hunger <= 0 || this.thirst <= 0) this.health = Math.max(0, this.health - 2 * dt);
  }
  add(item, count = 1) { this.inventory[item] = (this.inventory[item] || 0) + count; }
  remove(item, count = 1) {
    if ((this.inventory[item] || 0) < count) return false;
    this.inventory[item] -= count;
    if (this.inventory[item] <= 0) delete this.inventory[item];
    return true;
  }
  consume(item) {
    const effects = { food: {hunger: 40}, water: {thirst: 50}, bed: {fatigue: 80}, medkit: {health: 50} };
    const e = effects[item]; if (!e) return false;
    if (!this.remove(item, 1)) return false;
    for (const [k, v] of Object.entries(e)) this[k] = Math.min(this["max" + k.charAt(0).toUpperCase() + k.slice(1)] || 100, (this[k] || 0) + v);
    return true;
  }
  craft(recipeName) {
    const r = this.recipes[recipeName]; if (!r) return false;
    for (const [mat, qty] of Object.entries(r.inputs)) if ((this.inventory[mat] || 0) < qty) return false;
    for (const [mat, qty] of Object.entries(r.inputs)) this.remove(mat, qty);
    for (const [out, qty] of Object.entries(r.outputs)) this.add(out, qty);
    return true;
  }
}
const DEFAULT_RECIPES = {
  axe:    {inputs: {wood: 3, stone: 2}, outputs: {axe: 1}},
  pickaxe:{inputs: {wood: 2, stone: 4}, outputs: {pickaxe: 1}},
  torch:  {inputs: {wood: 1, coal: 1},  outputs: {torch: 1}},
  bed:    {inputs: {wood: 4, cloth: 3}, outputs: {bed: 1}},
  wall:   {inputs: {wood: 6},           outputs: {wall: 1}},
  door:   {inputs: {wood: 6},           outputs: {door: 1}},
  campfire:{inputs:{wood: 8, stone: 4}, outputs: {campfire: 1}},
  cooked_meat:{inputs:{raw_meat:1,campfire:0}, outputs:{cooked_meat:1}},
};
if (typeof window !== "undefined") { window.SurvivalStats = SurvivalStats; window.SURVIVAL_RECIPES = DEFAULT_RECIPES; }
