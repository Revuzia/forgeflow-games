/**
 * city_builder.js — SimCity / Cities Skylines / Anno zone-based city sim.
 * Zoning + services + road network + resource balance.
 *
 * API:
 *   const city = new CityBuilder({map, startMoney});
 *   city.zoneTile(x, y, type);   // residential | commercial | industrial
 *   city.buildService(x, y, type); // road | power | water | police | fire | hospital
 *   city.tick(dt);
 */
class CityBuilder {
  constructor(cfg) {
    this.map = cfg.map || { width: 40, height: 40 };
    this.tiles = new Array(this.map.width * this.map.height).fill(null);
    this.money = cfg.startMoney ?? 10000;
    this.population = 0; this.happiness = 50;
    this.taxRate = 0.1;
    this.day = 0;
    this.services = [];
    this.roads = new Set();
    this.powered = new Set();
    this.watered = new Set();
    this.zoneCosts = { residential: 50, commercial: 80, industrial: 100, park: 30 };
    this.serviceCosts = { road: 10, power_plant: 500, water_tower: 400, police: 300, fire: 300, hospital: 800 };
    this.incomeMultipliers = { residential: 1.0, commercial: 1.5, industrial: 1.8 };
  }
  _key(x, y) { return `${x},${y}`; }
  zoneTile(x, y, type) {
    const cost = this.zoneCosts[type]; if (!cost || this.money < cost) return false;
    const idx = y * this.map.width + x;
    if (this.tiles[idx]) return false;
    this.money -= cost;
    this.tiles[idx] = { type, level: 1, population: 0, happiness: 50, demand: 0 };
    return true;
  }
  buildService(x, y, type) {
    const cost = this.serviceCosts[type]; if (!cost || this.money < cost) return false;
    this.money -= cost;
    if (type === "road")        this.roads.add(this._key(x, y));
    else if (type === "power_plant") this._floodFill(x, y, this.powered, 8);
    else if (type === "water_tower") this._floodFill(x, y, this.watered, 8);
    else this.services.push({ x, y, type });
    return true;
  }
  _floodFill(cx, cy, set, radius) {
    for (let dx = -radius; dx <= radius; dx++)
      for (let dy = -radius; dy <= radius; dy++)
        if (Math.hypot(dx, dy) <= radius) set.add(this._key(cx + dx, cy + dy));
  }
  _tileHasRoadAccess(x, y) {
    for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) if (this.roads.has(this._key(x+dx, y+dy))) return true;
    return false;
  }
  _serviceCoverage(x, y, type) {
    for (const s of this.services) if (s.type === type && Math.hypot(s.x - x, s.y - y) < 8) return true;
    return false;
  }
  tick(dt) {
    this.day += dt;
    let totalPop = 0, totalHappiness = 0, popCount = 0, totalIncome = 0;
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const t = this.tiles[y * this.map.width + x]; if (!t) continue;
        const hasRoad  = this._tileHasRoadAccess(x, y);
        const hasPower = this.powered.has(this._key(x, y));
        const hasWater = this.watered.has(this._key(x, y));
        const hasPolice= this._serviceCoverage(x, y, "police");
        const hasFire  = this._serviceCoverage(x, y, "fire");
        const hasHosp  = this._serviceCoverage(x, y, "hospital");
        let growthRate = 0;
        if (hasRoad && hasPower && hasWater) growthRate = 0.02;
        if (hasPolice && hasFire) growthRate += 0.01;
        if (hasHosp) growthRate += 0.01;
        t.population = Math.min(50, t.population + growthRate * dt * 5);
        t.happiness = 40 + (hasPolice?15:0) + (hasFire?10:0) + (hasHosp?20:0) + (hasPower?5:0) + (hasWater?5:0) - this.taxRate * 100;
        totalPop += t.population; totalHappiness += t.happiness; popCount++;
        totalIncome += t.population * this.taxRate * this.incomeMultipliers[t.type] || 1;
      }
    }
    this.population = Math.floor(totalPop);
    this.happiness = popCount > 0 ? totalHappiness / popCount : 50;
    this.money += totalIncome * dt;
  }
  getStatus() {
    return { population: this.population, happiness: Math.round(this.happiness), money: Math.floor(this.money), day: Math.floor(this.day) };
  }
}
if (typeof window !== "undefined") window.CityBuilder = CityBuilder;
