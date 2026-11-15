/**
 * clicker_core.js — Idle/incremental games (Cookie Clicker, Bee Sim, Adopt Me).
 * Generators + upgrades + prestige. All data-driven.
 *
 * API:
 *   const game = new ClickerGame({generators, upgrades, clickValue});
 *   game.click();
 *   game.buyGenerator(id);
 *   game.tick(dt);
 */
class ClickerGame {
  constructor(cfg = {}) {
    this.currency = cfg.startingCurrency ?? 0;
    this.clickValue = cfg.clickValue ?? 1;
    this.generators = (cfg.generators || []).map(g => ({ ...g, count: 0 }));
    this.upgrades = cfg.upgrades || [];
    this.multipliers = { global: 1, click: 1 };
    this.ownedUpgrades = new Set();
    this.prestige = 0;
    this.allTimeEarned = 0;
  }
  click() { const g = this.clickValue * this.multipliers.click * this.multipliers.global; this.currency += g; this.allTimeEarned += g; return g; }
  cps() {
    return this.generators.reduce((t, g) => t + g.baseProduction * g.count, 0) * this.multipliers.global;
  }
  tick(dt) { const earned = this.cps() * dt; this.currency += earned; this.allTimeEarned += earned; }
  buyGenerator(idx) {
    const g = this.generators[idx]; if (!g) return false;
    const cost = Math.floor(g.baseCost * Math.pow(g.costMultiplier || 1.15, g.count));
    if (this.currency < cost) return false;
    this.currency -= cost; g.count++; return true;
  }
  getGeneratorCost(idx) {
    const g = this.generators[idx]; return g ? Math.floor(g.baseCost * Math.pow(g.costMultiplier || 1.15, g.count)) : 0;
  }
  buyUpgrade(id) {
    if (this.ownedUpgrades.has(id)) return false;
    const u = this.upgrades.find(x => x.id === id); if (!u) return false;
    if (this.currency < u.cost) return false;
    if (u.require_generator && (this.generators.find(g => g.id === u.require_generator)?.count || 0) < (u.require_count || 0)) return false;
    this.currency -= u.cost; this.ownedUpgrades.add(id);
    if (u.effect_type === "click_multi") this.multipliers.click *= (u.effect_value || 2);
    if (u.effect_type === "global_multi") this.multipliers.global *= (u.effect_value || 1.5);
    if (u.effect_type === "gen_multi") {
      const g = this.generators.find(x => x.id === u.target);
      if (g) g.baseProduction *= (u.effect_value || 2);
    }
    return true;
  }
  canPrestige(threshold = 1e9) { return this.allTimeEarned >= threshold; }
  doPrestige() {
    if (!this.canPrestige()) return 0;
    const tokens = Math.floor(Math.pow(this.allTimeEarned / 1e9, 0.5));
    this.prestige += tokens; this.multipliers.global *= (1 + tokens * 0.1);
    this.currency = 0; this.allTimeEarned = 0;
    for (const g of this.generators) g.count = 0;
    this.ownedUpgrades.clear(); this.multipliers.click = 1;
    return tokens;
  }
}
if (typeof window !== "undefined") window.ClickerGame = ClickerGame;
