/**
 * god_sim_core.js — Black & White / Populous / From Dust god-sim.
 * Terrain shaping + miracles + creature training + worshipers.
 *
 * API:
 *   const god = new GodSim({map, creature});
 *   god.raiseLand(x, y, amount);
 *   god.castMiracle(type, x, y);
 *   god.trainCreature(action, reward);
 */
class GodSim {
  constructor(cfg) {
    this.map = cfg.map || { width: 64, height: 64, heights: null };
    if (!this.map.heights) this._initMap();
    this.villagers = cfg.villagers || this._spawnVillagers(20);
    this.creature = cfg.creature ? this._initCreature(cfg.creature) : null;
    this.belief = cfg.belief ?? 100;      // currency of god powers
    this.alignment = cfg.alignment ?? 0;  // -100 evil, +100 good
    this.miracles = cfg.miracles || DEFAULT_MIRACLES;
    this.buildings = [];
  }
  _initMap() {
    const w = this.map.width, h = this.map.height;
    const heights = new Float32Array(w * h);
    for (let i = 0; i < heights.length; i++) heights[i] = 4 + Math.sin(i * 0.1) * 2 + Math.cos(i * 0.07) * 1.5;
    this.map.heights = heights;
  }
  _spawnVillagers(n) {
    const villagers = [];
    for (let i = 0; i < n; i++) {
      villagers.push({
        id: `v_${i}`, x: Math.random() * this.map.width, y: Math.random() * this.map.height,
        happiness: 50, hunger: 50, faith: 50, alive: true, job: "idle",
      });
    }
    return villagers;
  }
  _initCreature(c) {
    return {
      name: c.name || "Titan", x: c.x ?? 32, y: c.y ?? 32,
      hp: c.hp ?? 100, hunger: 50, happiness: 50,
      behaviors: { eat_fish: 0, fight_villager: 0, help_villager: 0, dance: 0, sleep: 0 },
      currentAction: null, actionTimer: 0,
    };
  }
  raiseLand(x, y, radius = 5, amount = 1) {
    const cost = Math.abs(amount) * 2;
    if (this.belief < cost) return false;
    this.belief -= cost;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const d = Math.hypot(dx, dy); if (d > radius) continue;
        const px = Math.floor(x + dx), py = Math.floor(y + dy);
        if (px < 0 || py < 0 || px >= this.map.width || py >= this.map.height) continue;
        const falloff = 1 - d / radius;
        this.map.heights[py * this.map.width + px] += amount * falloff;
      }
    }
    return true;
  }
  castMiracle(type, x, y) {
    const m = this.miracles[type]; if (!m) return false;
    if (this.belief < m.cost) return false;
    this.belief -= m.cost;
    this.alignment += m.alignment_delta || 0;
    // Effect on villagers
    for (const v of this.villagers) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d > (m.radius || 10)) continue;
      if (m.effect === "heal")   { v.hunger = Math.min(100, v.hunger + 50); v.happiness += 20; }
      if (m.effect === "food")   { v.hunger = Math.min(100, v.hunger + 80); }
      if (m.effect === "smite")  { v.alive = false; }
      if (m.effect === "bless")  { v.happiness = Math.min(100, v.happiness + 40); v.faith += 20; }
    }
    return true;
  }
  trainCreature(action, reward) {
    if (!this.creature) return;
    // Positive reinforcement: +reinforce; negative: -punish
    if (reward > 0) this.creature.behaviors[action] = (this.creature.behaviors[action] || 0) + reward;
    else            this.creature.behaviors[action] = (this.creature.behaviors[action] || 0) + reward;
  }
  _pickCreatureAction() {
    if (!this.creature) return;
    // Softmax-weighted pick based on learned behaviors
    const entries = Object.entries(this.creature.behaviors);
    const bias = entries.map(([k, w]) => Math.exp(w / 10));
    const total = bias.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < entries.length; i++) {
      r -= bias[i]; if (r <= 0) { this.creature.currentAction = entries[i][0]; this.creature.actionTimer = 3; return; }
    }
  }
  tick(dt) {
    // Belief generation from faith of living villagers
    const living = this.villagers.filter(v => v.alive);
    this.belief += living.reduce((t, v) => t + v.faith / 500, 0) * dt;
    // Villager stats
    for (const v of living) {
      v.hunger -= dt * 0.5;
      if (v.hunger <= 0) v.alive = false;
      v.happiness = Math.max(0, v.happiness - dt * 0.1);
    }
    // Creature AI
    if (this.creature) {
      if (!this.creature.currentAction) this._pickCreatureAction();
      this.creature.actionTimer -= dt;
      if (this.creature.actionTimer <= 0) { this.creature.currentAction = null; }
    }
  }
}
const DEFAULT_MIRACLES = {
  heal:  { cost: 20, effect: "heal",  radius: 15, alignment_delta: 1 },
  food:  { cost: 30, effect: "food",  radius: 20, alignment_delta: 2 },
  smite: { cost: 60, effect: "smite", radius: 5,  alignment_delta: -5 },
  bless: { cost: 40, effect: "bless", radius: 25, alignment_delta: 3 },
  fireball:{ cost: 80, effect: "smite", radius: 10, alignment_delta: -8 },
  rain:  { cost: 50, effect: "food",  radius: 30, alignment_delta: 0 },
};
if (typeof window !== "undefined") { window.GodSim = GodSim; window.DEFAULT_MIRACLES = DEFAULT_MIRACLES; }
