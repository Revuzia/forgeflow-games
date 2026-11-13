/**
 * civ_core.js — Civilization-style 4X (Civilization, Old World, Endless Legend).
 * Hex grid + turn-based + tech tree + production + diplomacy.
 *
 * API:
 *   const civ = new Civilization({mapRadius, players, techTree});
 *   civ.endTurn();  // advance to next player, resolve actions
 *   civ.foundCity(playerId, hex);
 *   civ.research(playerId, techId);
 */
class Civilization {
  constructor(cfg) {
    this.mapRadius = cfg.mapRadius ?? 12;
    this.players = (cfg.players || []).map(p => this._initPlayer(p));
    this.currentPlayer = 0;
    this.turn = 1;
    this.techTree = cfg.techTree || DEFAULT_TECH_TREE;
    this.hexes = new Map();  // "q,r" -> {terrain, resource, owner}
    this._generateMap();
  }
  _initPlayer(p) {
    return {
      id: p.id, name: p.name, color: p.color,
      cities: [], units: [],
      resources: { gold: 50, science: 0, production: 0, food: 0, culture: 0 },
      researched: new Set(), researching: null, researchProgress: 0,
      relations: {},
    };
  }
  _generateMap() {
    const r = this.mapRadius;
    for (let q = -r; q <= r; q++) {
      for (let rr = Math.max(-r, -q-r); rr <= Math.min(r, -q+r); rr++) {
        const terrains = ["plains", "grassland", "forest", "hills", "mountain", "water", "desert"];
        const terrain = terrains[Math.floor(Math.random() * terrains.length)];
        this.hexes.set(`${q},${rr}`, { q, r: rr, terrain, resource: Math.random() < 0.1 ? "gold" : null, owner: null });
      }
    }
  }
  foundCity(playerId, hex) {
    const p = this.players.find(pp => pp.id === playerId);
    if (!p) return false;
    const h = this.hexes.get(`${hex.q},${hex.r}`);
    if (!h || h.owner) return false;
    h.owner = playerId;
    p.cities.push({ id: `c_${Date.now()}_${Math.random()}`, hex, population: 1, producing: null, production: 0 });
    return true;
  }
  research(playerId, techId) {
    const p = this.players.find(pp => pp.id === playerId);
    if (!p) return false;
    const tech = this.techTree[techId];
    if (!tech) return false;
    // Prerequisites
    for (const pre of tech.requires || []) if (!p.researched.has(pre)) return false;
    p.researching = techId; p.researchProgress = 0;
    return true;
  }
  endTurn() {
    const p = this.players[this.currentPlayer];
    // Income from cities
    for (const city of p.cities) {
      p.resources.gold       += 2 + city.population;
      p.resources.science    += 1 + Math.floor(city.population / 2);
      p.resources.production += 1 + city.population;
      p.resources.food       += 2 + city.population;
      if (city.producing && city.production < this.techTree[city.producing]?.cost || city.production < 30) {
        city.production += 1 + city.population;
        if (city.producing && city.production >= 30) {
          // Spawn unit next to city
          p.units.push({ id: `u_${Date.now()}_${Math.random()}`, type: city.producing, hex: city.hex, hp: 10, moves: 2 });
          city.producing = null; city.production = 0;
        }
      }
      if (city.population < 10 && p.resources.food >= city.population * 5) { city.population++; p.resources.food -= city.population * 5; }
    }
    // Research progress
    if (p.researching) {
      p.researchProgress += p.resources.science;
      const t = this.techTree[p.researching];
      if (p.researchProgress >= t.cost) { p.researched.add(p.researching); p.researching = null; p.researchProgress = 0; }
    }
    // Reset unit moves
    for (const u of p.units) u.moves = 2;
    // Next player
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    if (this.currentPlayer === 0) this.turn++;
  }
  moveUnit(unitId, targetHex) {
    const p = this.players[this.currentPlayer];
    const u = p.units.find(uu => uu.id === unitId);
    if (!u || u.moves <= 0) return false;
    u.hex = targetHex; u.moves--;
    return true;
  }
  declareWar(fromId, toId) {
    const a = this.players.find(p => p.id === fromId);
    const b = this.players.find(p => p.id === toId);
    if (!a || !b) return false;
    a.relations[toId] = "war"; b.relations[fromId] = "war";
    return true;
  }
  isVictoryAchieved(playerId) {
    const p = this.players.find(pp => pp.id === playerId);
    if (!p) return null;
    // Science victory
    if (p.researched.has("space_flight")) return "science";
    // Domination victory
    if (this.players.every(pl => pl.id === playerId || pl.cities.length === 0)) return "domination";
    // Culture victory
    if (p.cities.length >= 5 && p.resources.culture >= 500) return "culture";
    return null;
  }
}
const DEFAULT_TECH_TREE = {
  agriculture:   { cost: 20,  requires: [] },
  bronze_working:{ cost: 30,  requires: ["agriculture"] },
  pottery:       { cost: 30,  requires: ["agriculture"] },
  writing:       { cost: 50,  requires: ["pottery"] },
  iron_working:  { cost: 80,  requires: ["bronze_working"] },
  currency:      { cost: 80,  requires: ["bronze_working"] },
  mathematics:   { cost: 120, requires: ["writing"] },
  philosophy:    { cost: 150, requires: ["writing"] },
  gunpowder:     { cost: 400, requires: ["iron_working","mathematics"] },
  industrialization:{cost: 1000, requires: ["gunpowder"] },
  electricity:   { cost: 2000, requires: ["industrialization"] },
  computers:     { cost: 4000, requires: ["electricity","mathematics"] },
  space_flight:  { cost: 8000, requires: ["computers"] },
};
if (typeof window !== "undefined") { window.Civilization = Civilization; window.DEFAULT_TECH_TREE = DEFAULT_TECH_TREE; }
