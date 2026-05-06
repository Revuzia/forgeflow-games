/**
 * life_sim.js — Sims / Animal Crossing: needs meters, relationships, jobs, home-building.
 * Data-driven — all households, NPCs, home layouts passed in.
 *
 * API:
 *   const sim = new LifeSim({household: [{name, traits, stats}], town: [npcs]});
 *   sim.tick(dt);
 *   sim.interact(fromId, toId, action);
 *   sim.buildFurniture(x, y, type);
 *   sim.goToWork(id);
 */
class LifeSim {
  constructor(cfg) {
    this.people = (cfg.household || []).concat(cfg.town || []).map(p => this._init(p));
    this.peopleById = Object.fromEntries(this.people.map(p => [p.id, p]));
    this.time = 8 * 60;       // in minutes, 0 = midnight
    this.dayOfWeek = 0;
    this.home = cfg.home || { tiles: [], furniture: [] };
    this.money = cfg.startingMoney ?? 1000;
    this.log = [];
  }
  _init(p) {
    return {
      id: p.id || p.name,
      name: p.name,
      traits: p.traits || [],
      age: p.age || 25,
      // Needs 0-100; Sims-class decay
      needs: { hunger: 80, bladder: 80, energy: 80, hygiene: 80, social: 70, fun: 70, comfort: 80 },
      relationships: {}, // { otherId: {friendship, romance, rivalry} }
      job: p.job || null, money: p.money || 500,
      skills: p.skills || {},
      mood: 50,
      x: p.x || 0, y: p.y || 0,
      currentAction: null, actionTimer: 0,
    };
  }
  tick(dt) {
    // dt in seconds; 1 real sec = ~1 game minute
    this.time = (this.time + dt) % (24 * 60);
    if (this.time < dt) this.dayOfWeek = (this.dayOfWeek + 1) % 7;
    for (const p of this.people) this._tickPerson(p, dt);
  }
  _tickPerson(p, dt) {
    p.needs.hunger  = Math.max(0, p.needs.hunger  - dt * 0.1);
    p.needs.bladder = Math.max(0, p.needs.bladder - dt * 0.12);
    p.needs.energy  = Math.max(0, p.needs.energy  - dt * 0.06);
    p.needs.hygiene = Math.max(0, p.needs.hygiene - dt * 0.08);
    p.needs.social  = Math.max(0, p.needs.social  - dt * 0.05);
    p.needs.fun     = Math.max(0, p.needs.fun     - dt * 0.05);
    // Mood averages needs
    p.mood = Object.values(p.needs).reduce((a,b)=>a+b,0) / 7;
    if (p.currentAction) {
      p.actionTimer -= dt;
      if (p.actionTimer <= 0) { this._completeAction(p); }
    }
  }
  _completeAction(p) {
    const a = p.currentAction;
    if (!a) return;
    const effects = {
      eat:     {hunger: 40, hygiene: -5},
      sleep:   {energy: 80},
      shower:  {hygiene: 70, comfort: 10},
      toilet:  {bladder: 80},
      work:    {energy: -30, money: 50, skill: 0.1},
      play:    {fun: 40, energy: -10},
      socialize:{social: 30, fun: 10},
      study:   {fun: -5, skill: 0.2},
    };
    const eff = effects[a.type] || {};
    for (const [k, v] of Object.entries(eff)) {
      if (k === "money") p.money += v;
      else if (k === "skill") { const s = a.skill || "generic"; p.skills[s] = (p.skills[s] || 0) + v; }
      else p.needs[k] = Math.max(0, Math.min(100, (p.needs[k] || 0) + v));
    }
    this.log.push(`${p.name} finished ${a.type}`);
    p.currentAction = null;
  }
  queueAction(id, type, duration = 30, extras = {}) {
    const p = this.peopleById[id]; if (!p) return;
    p.currentAction = { type, ...extras }; p.actionTimer = duration;
  }
  interact(fromId, toId, action) {
    const a = this.peopleById[fromId], b = this.peopleById[toId];
    if (!a || !b) return false;
    if (!a.relationships[toId]) a.relationships[toId] = { friendship: 0, romance: 0, rivalry: 0 };
    if (!b.relationships[fromId]) b.relationships[fromId] = { friendship: 0, romance: 0, rivalry: 0 };
    const deltas = {
      chat:     { friendship: 3, romance: 1 },
      flirt:    { friendship: 1, romance: 5 },
      kiss:     { romance: 12 },
      argue:    { friendship: -6, rivalry: 4 },
      insult:   { friendship: -10, rivalry: 8 },
      gift:     { friendship: 8, romance: 3 },
    };
    const d = deltas[action] || {};
    for (const [k, v] of Object.entries(d)) {
      a.relationships[toId][k] = (a.relationships[toId][k] || 0) + v;
      b.relationships[fromId][k] = (b.relationships[fromId][k] || 0) + v;
    }
    return true;
  }
  buildFurniture(x, y, type) {
    const costs = { bed: 200, chair: 50, table: 80, toilet: 150, shower: 250, fridge: 300, tv: 400, stove: 200 };
    const cost = costs[type];
    if (cost && this.money < cost) return false;
    if (cost) this.money -= cost;
    this.home.furniture.push({ x, y, type });
    return true;
  }
  goToWork(id) {
    const p = this.peopleById[id]; if (!p || !p.job) return false;
    this.queueAction(id, "work", p.job.duration || 480, {});
    return true;
  }
}
if (typeof window !== "undefined") window.LifeSim = LifeSim;
