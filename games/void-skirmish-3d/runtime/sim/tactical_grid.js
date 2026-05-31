/**
 * FFG runtime — sim/tactical_grid.js
 * Pure simulation core for grid tactics (XCOM / Fire Emblem / Into the Breach).
 * NO rendering here — rendering + input + feel live in ffg_tactics.js.
 *
 * Deterministic when given a seeded rng (config.rng), so the signature gate can
 * drive it headlessly in Node and assert the defining mechanics actually work.
 *
 * Grid tile codes: 0=floor, 1=wall(blocks move+LOS), 2=half_cover(passable),
 *                  3=full_cover(blocks move, grants cover), 4=hazard(passable, dmg).
 *
 * Dual export: Node `require()` (gates) and browser `window.FFG.sim.TacticalBattle`.
 */
(function (root) {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Soldier-class abilities (XCOM 2-style) ───────────────────────────────────
  // Each player class unlocks one signature ability. target: enemy|ally|tile.
  const CLASS_ABILITIES = {
    ranger:       ["slash"],
    sharpshooter: ["headshot"],
    specialist:   ["heal"],
    grenadier:    ["frag"],
    vanguard:     ["suppress"],
  };
  const ABILITY_DEFS = {
    slash:    { name: "Slash",        key: "1", target: "enemy", range: 1,    dmgMult: 1.6, crit: 0.5, cooldown: 1,            desc: "Melee strike — ignores cover, high crit." },
    headshot: { name: "Headshot",     key: "2", target: "enemy", range: null, dmgMult: 2.0, crit: 0.5, charges: 2,             desc: "Charged precision shot — heavy damage + crit." },
    heal:     { name: "Field Medic",  key: "3", target: "ally",  range: 6,    heal: 45,                charges: 3, selfOk: true, desc: "Restore HP to an ally (or self)." },
    frag:     { name: "Frag Grenade", key: "4", target: "tile",  range: 6,    radius: 1, dmgMult: 0.9, charges: 2, destroysCover: true, desc: "AoE blast — damages all in radius, shreds cover." },
    suppress: { name: "Suppression",  key: "5", target: "enemy", range: 8,    aimPenalty: 0.35,        cooldown: 2,            desc: "Pin a target: −aim and reaction fire if it moves." },
  };

  class TacticalBattle {
    constructor(config) {
      this.grid = config.grid;
      this.gridW = (this.grid[0] && this.grid[0].length) || 0;
      this.gridH = this.grid.length;
      this.rng = config.rng || (typeof config.seed === "number" ? mulberry32(config.seed) : Math.random);
      this.player_units = (config.player_units || []).map((u) => this._initUnit(u, "player"));
      this.enemy_units = (config.enemy_units || []).map((u) => this._initUnit(u, "enemy"));
      this.currentPhase = "player";
      this.turnNumber = 1;
      this.selectedUnit = null;
      this.onEnd = config.onEnd || function () {};
      this.onEvent = config.onEvent || function () {}; // (type, payload) for the renderer
      this.ended = false;
      this.log = [];
    }

    _initUnit(u, side) {
      const cls = (u.cls || u.class || "").toLowerCase() || null;
      const abilityIds = side === "player" ? (CLASS_ABILITIES[cls] || []).slice() : [];
      const charges = {}, cooldowns = {};
      for (const id of abilityIds) {
        const d = ABILITY_DEFS[id];
        if (d && d.charges != null) charges[id] = d.charges;
        cooldowns[id] = 0;
      }
      return {
        id: u.id,
        name: u.name || u.id,
        side: side,
        x: u.x, y: u.y,
        hp: u.hp != null ? u.hp : 10,
        maxHp: u.hp != null ? u.hp : 10,
        atk: u.atk != null ? u.atk : 5,
        def: u.def != null ? u.def : 0,
        movement: u.movement != null ? u.movement : 4,
        range: u.range != null ? u.range : 8,
        aim: u.aim != null ? u.aim : 0.75,
        actionPoints: 2,
        maxAP: 2,
        ai: u.ai || "aggressive",
        sprite: u.sprite || null,
        tint: u.tint != null ? u.tint : null,
        cls: cls,                     // soldier class (Phase 3)
        abilities: abilityIds,        // ability ids this unit can use
        charges: charges,             // {abilityId: remaining}
        cooldowns: cooldowns,         // {abilityId: turns until ready}
        suppressedBy: null,           // id of unit suppressing this one
        suppressAimPenalty: 0,        // aim debuff while suppressed
        overwatch: false,             // holding a reaction shot
      };
    }

    // ── Queries ────────────────────────────────────────────────────────────
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.gridW && y < this.gridH; }

    isWalkable(x, y) {
      if (!this.inBounds(x, y)) return false;
      const t = this.grid[y][x];
      // Cover tiles are SOLID objects (crates/barricades) — units path AROUND
      // them and take cover beside them, never walk through. Only open floor and
      // hazard lanes are walkable. (Was: half-cover walkable, so units stood on
      // crates / appeared to walk through obstacles.)
      return t === 0 || t === 4; // floor / hazard
    }

    unitAt(x, y) {
      return this.allUnits().find((u) => u.x === x && u.y === y && u.hp > 0) || null;
    }

    getUnit(id) { return this.allUnits().find((u) => u.id === id) || null; }
    allUnits() { return this.player_units.concat(this.enemy_units); }
    aliveAllies() { return this.player_units.filter((u) => u.hp > 0); }
    aliveEnemies() { return this.enemy_units.filter((u) => u.hp > 0); }

    /**
     * Tiles a unit can reach this action, respecting movement budget, walls, and
     * other units. Returns [{x,y,cost}]. Used for the move-range highlight AND
     * as the signature-mechanic assertion (movement is genuinely path-constrained).
     */
    reachableTiles(unit) {
      const out = [];
      const seen = {};
      const start = unit.x + "," + unit.y;
      seen[start] = 0;
      let frontier = [{ x: unit.x, y: unit.y, cost: 0 }];
      while (frontier.length) {
        const next = [];
        for (const node of frontier) {
          for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = node.x + d[0], ny = node.y + d[1];
            const cost = node.cost + 1;
            if (cost > unit.movement) continue;
            if (!this.isWalkable(nx, ny)) continue;
            if (this.unitAt(nx, ny)) continue;
            const k = nx + "," + ny;
            if (seen[k] != null && seen[k] <= cost) continue;
            seen[k] = cost;
            out.push({ x: nx, y: ny, cost: cost });
            next.push({ x: nx, y: ny, cost: cost });
          }
        }
        frontier = next;
      }
      return out;
    }

    // A* (orthogonal, unit-blocking). Returns path excluding the start tile.
    findPath(sx, sy, ex, ey) {
      const key = (x, y) => x + "," + y;
      const open = new Set([key(sx, sy)]);
      const cameFrom = {};
      const g = { [key(sx, sy)]: 0 };
      const f = { [key(sx, sy)]: Math.abs(ex - sx) + Math.abs(ey - sy) };
      while (open.size) {
        let cur = null, best = Infinity;
        for (const k of open) { const v = f[k] != null ? f[k] : Infinity; if (v < best) { best = v; cur = k; } }
        if (!cur) break;
        const parts = cur.split(",");
        const cx = +parts[0], cy = +parts[1];
        if (cx === ex && cy === ey) {
          const path = [{ x: cx, y: cy }];
          let c = cur;
          while (cameFrom[c]) { c = cameFrom[c]; const p = c.split(","); path.unshift({ x: +p[0], y: +p[1] }); }
          return path.slice(1);
        }
        open.delete(cur);
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + d[0], ny = cy + d[1];
          if (!this.isWalkable(nx, ny)) continue;
          if (this.unitAt(nx, ny) && !(nx === ex && ny === ey)) continue;
          const nk = key(nx, ny);
          const tg = (g[cur] != null ? g[cur] : Infinity) + 1;
          if (tg < (g[nk] != null ? g[nk] : Infinity)) {
            cameFrom[nk] = cur; g[nk] = tg;
            f[nk] = tg + Math.abs(ex - nx) + Math.abs(ey - ny);
            open.add(nk);
          }
        }
      }
      return null;
    }

    // Bresenham LOS; walls (1) and full cover (3) block sight.
    hasLineOfSight(fromX, fromY, toX, toY) {
      const dx = Math.abs(toX - fromX), dy = Math.abs(toY - fromY);
      const sx = fromX < toX ? 1 : -1, sy = fromY < toY ? 1 : -1;
      let err = dx - dy, x = fromX, y = fromY;
      while (x !== toX || y !== toY) {
        const isEndpoint = (x === fromX && y === fromY) || (x === toX && y === toY);
        if (!isEndpoint) {
          const t = this.grid[y] && this.grid[y][x];
          if (t === 1 || t === 3) return false;
        }
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      return true;
    }

    // Best cover value protecting `unit` (0 none, 1 half, 2 full). A cover tile
    // adjacent to the unit only protects against an attacker approaching FROM
    // that side: cover to my east shields me from attackers to my east.
    coverAt(unit, fromX, fromY) {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      let best = 0;
      for (const d of dirs) {
        const dx = d[0], dy = d[1];
        const nx = unit.x + dx, ny = unit.y + dy;
        const t = this.grid[ny] && this.grid[ny][nx];
        const cv = t === 3 ? 2 : t === 2 ? 1 : 0;
        if (cv === 0) continue;
        if (fromX != null) {
          const ax = Math.sign(fromX - unit.x), ay = Math.sign(fromY - unit.y);
          const shields = (dx !== 0 && dx === ax) || (dy !== 0 && dy === ay);
          if (!shields) continue;
        }
        best = Math.max(best, cv);
      }
      return best;
    }

    // Does `target` have any adjacent cover at all (regardless of angle)?
    hasAnyCover(target) {
      for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const t = this.grid[target.y + d[1]] && this.grid[target.y + d[1]][target.x + d[0]];
        if (t === 2 || t === 3) return true;
      }
      return false;
    }
    // FLANKED: the target relies on cover, but this attacker's angle bypasses it
    // (XCOM: ignores cover defense AND grants a big crit chance).
    isFlanked(attacker, target) {
      return this.hasAnyCover(target) && this.coverAt(target, attacker.x, attacker.y) === 0;
    }

    // Full hit breakdown so the UI can show WHY a shot is what it is.
    hitBreakdown(attacker, target) {
      const dist = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
      const inRange = dist <= attacker.range;
      const distancePenalty = Math.max(0, (dist - 3) * 0.05);
      const cover = this.coverAt(target, attacker.x, attacker.y);
      const coverPenalty = cover === 2 ? 0.4 : cover === 1 ? 0.2 : 0;
      const flanked = this.isFlanked(attacker, target);
      const flankBonus = flanked ? 0.25 : (cover === 0 ? 0.1 : 0);
      const suppress = attacker.suppressAimPenalty || 0; // pinned shooters fire wild
      const chance = inRange ? Math.max(0.05, Math.min(0.99, attacker.aim - distancePenalty - coverPenalty + flankBonus - suppress)) : 0;
      const critChance = flanked ? 0.5 : 0.1;
      return { chance, critChance, cover, coverPenalty, distancePenalty, flankBonus, suppress, flanked, dist, inRange };
    }

    calculateHitChance(attacker, target) { return this.hitBreakdown(attacker, target).chance; }

    // ── Actions ──────────────────────────────────────────────────────────────
    moveUnit(unitId, toX, toY) {
      const u = this.getUnit(unitId);
      if (!u || u.hp <= 0 || u.actionPoints < 1) return null;
      const path = this.findPath(u.x, u.y, toX, toY);
      if (!path || path.length === 0 || path.length > u.movement) return null;
      if (this.unitAt(toX, toY)) return null;
      u.x = toX; u.y = toY;
      u.actionPoints--;
      // Hazard tile damage
      if (this.grid[toY][toX] === 4) { u.hp = Math.max(0, u.hp - 2); this.log.push(u.id + " took 2 hazard dmg"); }
      this.onEvent("move", { unit: u, path: path });
      this._triggerOverwatch(u); // opposing overwatchers fire on the mover
      this._checkEnd();
      return path;
    }

    attackUnit(attackerId, targetId, opts) {
      opts = opts || {};
      const reaction = !!opts.reaction; // overwatch reaction shot (penalised, no crit, no AP/turn cost)
      const a = this.getUnit(attackerId), t = this.getUnit(targetId);
      if (!a || !t || a.hp <= 0 || t.hp <= 0) return { success: false, reason: "invalid" };
      if (!reaction && a.actionPoints < 1) return { success: false, reason: "no AP" };
      if (!this.hasLineOfSight(a.x, a.y, t.x, t.y)) return { success: false, reason: "no LOS" };
      const bd = this.hitBreakdown(a, t);
      if (bd.chance <= 0) return { success: false, reason: "out of range" };
      const chance = reaction ? bd.chance * 0.7 : bd.chance; // reaction fire is less accurate
      // Shooting ENDS the turn (XCOM 2 action economy); reaction shots are free.
      if (!reaction) a.actionPoints = 0;
      const roll = this.rng();
      if (roll <= chance) {
        const crit = !reaction && bd.flanked && this.rng() < bd.critChance;
        let dmg = Math.max(1, a.atk - t.def);
        if (crit) dmg = Math.round(dmg * 1.5);
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) a._kills = (a._kills || 0) + 1;
        this.log.push(a.id + (reaction ? " overwatch-hit " : crit ? " CRIT " : " hit ") + t.id + " for " + dmg);
        this.onEvent("attack", { attacker: a, target: t, hit: true, damage: dmg, chance: chance, killed: t.hp <= 0, crit: crit, flanked: bd.flanked, reaction: reaction });
        this._checkEnd();
        return { success: true, hit: true, damage: dmg, killed: t.hp <= 0, chance: chance, crit: crit, flanked: bd.flanked };
      }
      this.log.push(a.id + (reaction ? " overwatch-missed " : " missed ") + t.id);
      this.onEvent("attack", { attacker: a, target: t, hit: false, chance: chance, reaction: reaction });
      this._checkEnd();
      return { success: true, hit: false, chance: chance };
    }

    // ── Class abilities (Phase 3) ──────────────────────────────────────────────
    // Metadata for the renderer's ability bar: name/key/target + live readiness.
    abilitiesFor(unitId) {
      const u = this.getUnit(unitId);
      if (!u || !u.abilities) return [];
      return u.abilities.map((id) => {
        const d = ABILITY_DEFS[id];
        const charges = d.charges != null ? (u.charges[id] || 0) : null;
        const cd = u.cooldowns[id] || 0;
        return {
          id, name: d.name, key: d.key, target: d.target, desc: d.desc,
          range: d.range, radius: d.radius || 0, charges, cooldown: cd,
          ready: u.hp > 0 && u.actionPoints >= 1 && cd === 0 && (d.charges == null || charges > 0),
        };
      });
    }

    useAbility(unitId, abilityId, opts) {
      opts = opts || {};
      const u = this.getUnit(unitId), def = ABILITY_DEFS[abilityId];
      if (!u || u.hp <= 0 || !def) return { success: false, reason: "invalid" };
      if (!u.abilities || u.abilities.indexOf(abilityId) < 0) return { success: false, reason: "not available" };
      if (u.actionPoints < 1) return { success: false, reason: "no AP" };
      if ((u.cooldowns[abilityId] || 0) > 0) return { success: false, reason: "cooldown" };
      if (def.charges != null && (u.charges[abilityId] || 0) <= 0) return { success: false, reason: "no charges" };
      let res;
      switch (abilityId) {
        case "slash": res = this._abSlash(u, def, opts); break;
        case "headshot": res = this._abHeadshot(u, def, opts); break;
        case "heal": res = this._abHeal(u, def, opts); break;
        case "frag": res = this._abFrag(u, def, opts); break;
        case "suppress": res = this._abSuppress(u, def, opts); break;
        default: res = { success: false, reason: "unimplemented" };
      }
      if (res && res.success) {
        u.actionPoints = 0; // abilities end the unit's turn
        if (def.charges != null) u.charges[abilityId] = Math.max(0, (u.charges[abilityId] || 0) - 1);
        if (def.cooldown) u.cooldowns[abilityId] = def.cooldown;
        this._checkEnd();
      }
      return res;
    }

    _abSlash(u, def, opts) {
      const t = this.getUnit(opts.targetId);
      if (!t || t.side === u.side || t.hp <= 0) return { success: false, reason: "need enemy" };
      if (Math.abs(u.x - t.x) + Math.abs(u.y - t.y) > def.range) return { success: false, reason: "not adjacent" };
      let dmg = Math.max(1, Math.round(u.atk * def.dmgMult)); // ignores cover/armor
      const crit = this.rng() < def.crit; if (crit) dmg = Math.round(dmg * 1.5);
      t.hp = Math.max(0, t.hp - dmg);
      if (t.hp <= 0) u._kills = (u._kills || 0) + 1;
      this.log.push(u.id + " slashed " + t.id + " for " + dmg + (crit ? " CRIT" : ""));
      this.onEvent("ability", { ability: "slash", attacker: u, target: t, hit: true, damage: dmg, crit, killed: t.hp <= 0 });
      return { success: true, hit: true, damage: dmg, crit, killed: t.hp <= 0 };
    }

    _abHeadshot(u, def, opts) {
      const t = this.getUnit(opts.targetId);
      if (!t || t.side === u.side || t.hp <= 0) return { success: false, reason: "need enemy" };
      const range = def.range != null ? def.range : u.range;
      if (Math.abs(u.x - t.x) + Math.abs(u.y - t.y) > range) return { success: false, reason: "out of range" };
      if (!this.hasLineOfSight(u.x, u.y, t.x, t.y)) return { success: false, reason: "no LOS" };
      const bd = this.hitBreakdown(u, t);
      const chance = Math.min(0.99, bd.chance + 0.15); // steadied
      if (this.rng() <= chance) {
        const crit = this.rng() < def.crit;
        let dmg = Math.max(1, Math.round(u.atk * def.dmgMult) - t.def);
        if (crit) dmg = Math.round(dmg * 1.5);
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) u._kills = (u._kills || 0) + 1;
        this.log.push(u.id + " headshot " + t.id + " for " + dmg + (crit ? " CRIT" : ""));
        this.onEvent("ability", { ability: "headshot", attacker: u, target: t, hit: true, damage: dmg, crit, chance, killed: t.hp <= 0 });
        return { success: true, hit: true, damage: dmg, crit, killed: t.hp <= 0 };
      }
      this.log.push(u.id + " headshot MISS " + t.id);
      this.onEvent("ability", { ability: "headshot", attacker: u, target: t, hit: false, chance });
      return { success: true, hit: false, chance };
    }

    _abHeal(u, def, opts) {
      const t = opts.targetId ? this.getUnit(opts.targetId) : (def.selfOk ? u : null);
      if (!t || t.side !== u.side || t.hp <= 0) return { success: false, reason: "need ally" };
      if (t.id !== u.id && Math.abs(u.x - t.x) + Math.abs(u.y - t.y) > def.range) return { success: false, reason: "out of range" };
      const before = t.hp; t.hp = Math.min(t.maxHp, t.hp + def.heal);
      const healed = t.hp - before;
      this.log.push(u.id + " healed " + t.id + " for " + healed);
      this.onEvent("ability", { ability: "heal", attacker: u, target: t, heal: healed });
      return { success: true, heal: healed };
    }

    _abFrag(u, def, opts) {
      const tx = opts.tileX, ty = opts.tileY;
      if (tx == null || ty == null || !this.inBounds(tx, ty)) return { success: false, reason: "need tile" };
      if (Math.abs(u.x - tx) + Math.abs(u.y - ty) > def.range) return { success: false, reason: "out of range" };
      const hits = [];
      for (const v of this.allUnits()) {
        if (v.hp <= 0) continue;
        if (Math.max(Math.abs(v.x - tx), Math.abs(v.y - ty)) > def.radius) continue;
        const dmg = Math.max(1, Math.round(u.atk * def.dmgMult) - Math.floor(v.def / 2));
        v.hp = Math.max(0, v.hp - dmg);
        if (v.hp <= 0 && v.side !== u.side) u._kills = (u._kills || 0) + 1;
        hits.push({ id: v.id, side: v.side, damage: dmg, killed: v.hp <= 0 });
      }
      const shredded = [];
      if (def.destroysCover) {
        for (let yy = ty - def.radius; yy <= ty + def.radius; yy++)
          for (let xx = tx - def.radius; xx <= tx + def.radius; xx++) {
            if (!this.inBounds(xx, yy)) continue;
            const c = this.grid[yy][xx];
            if (c === 2 || c === 3) { this.grid[yy][xx] = c === 3 ? 2 : 0; shredded.push({ x: xx, y: yy, to: c === 3 ? 2 : 0 }); }
          }
      }
      this.log.push(u.id + " fragged (" + tx + "," + ty + ") hit " + hits.length);
      this.onEvent("ability", { ability: "frag", attacker: u, tileX: tx, tileY: ty, radius: def.radius, hits, shredded });
      return { success: true, hits, shredded };
    }

    _abSuppress(u, def, opts) {
      const t = this.getUnit(opts.targetId);
      if (!t || t.side === u.side || t.hp <= 0) return { success: false, reason: "need enemy" };
      if (Math.abs(u.x - t.x) + Math.abs(u.y - t.y) > def.range) return { success: false, reason: "out of range" };
      if (!this.hasLineOfSight(u.x, u.y, t.x, t.y)) return { success: false, reason: "no LOS" };
      t.suppressedBy = u.id; t.suppressAimPenalty = def.aimPenalty;
      u.overwatch = true; // reaction-fire if the pinned target moves
      this.log.push(u.id + " suppressing " + t.id);
      this.onEvent("ability", { ability: "suppress", attacker: u, target: t });
      return { success: true };
    }

    _tickCooldowns(units) {
      for (const u of units) for (const id in u.cooldowns) if (u.cooldowns[id] > 0) u.cooldowns[id]--;
    }

    // Hold a reaction shot: ends the unit's turn, fires on the first enemy that
    // moves into LOS+range during the opponent's turn (XCOM overwatch).
    overwatchUnit(unitId) {
      const u = this.getUnit(unitId);
      if (!u || u.hp <= 0 || u.actionPoints < 1) return false;
      u.overwatch = true; u.actionPoints = 0;
      this.onEvent("overwatch", { unit: u });
      return true;
    }

    // Any opposing overwatcher with LOS + range fires one reaction shot at `mover`.
    _triggerOverwatch(mover) {
      const foes = mover.side === "player" ? this.aliveEnemies() : this.aliveAllies();
      for (const w of foes) {
        if (this.ended || mover.hp <= 0) break;
        if (!w.overwatch || w.hp <= 0) continue;
        const dist = Math.abs(w.x - mover.x) + Math.abs(w.y - mover.y);
        if (dist > w.range || !this.hasLineOfSight(w.x, w.y, mover.x, mover.y)) continue;
        w.overwatch = false;
        this.attackUnit(w.id, mover.id, { reaction: true });
      }
    }

    endTurn() {
      if (this.ended) return;
      const side = this.currentPhase === "player" ? this.player_units : this.enemy_units;
      for (const u of side) u.actionPoints = u.maxAP;
      if (this.currentPhase === "player") {
        this.currentPhase = "enemy";
        for (const e of this.enemy_units) e.overwatch = false; // their turn — clear their watch
        this.onEvent("phase", { phase: "enemy", turn: this.turnNumber });
        this._runEnemyTurn();
        if (!this.ended) {
          this.currentPhase = "player";
          this.turnNumber++;
          for (const u of this.player_units) { u.actionPoints = u.maxAP; u.overwatch = false; }
          this._tickCooldowns(this.player_units);           // ability cooldowns recover
          for (const e of this.enemy_units) { e.suppressedBy = null; e.suppressAimPenalty = 0; } // pins expire at our next turn
          this.onEvent("phase", { phase: "player", turn: this.turnNumber });
        }
      }
    }

    _runEnemyTurn() {
      for (const e of this.aliveEnemies()) {
        if (this.ended) return;
        let targets = this.aliveAllies();
        if (!targets.length) break;
        targets = targets.slice().sort((p, q) =>
          (Math.abs(p.x - e.x) + Math.abs(p.y - e.y)) - (Math.abs(q.x - e.x) + Math.abs(q.y - e.y)));
        // Try to shoot (ends turn); otherwise advance; if it still can't fire,
        // hold overwatch rather than waste the turn.
        let guard = 0, shot = false;
        while (e.actionPoints > 0 && guard++ < 6) {
          const tgt = targets[0];
          const dist = Math.abs(tgt.x - e.x) + Math.abs(tgt.y - e.y);
          if (dist <= e.range && this.hasLineOfSight(e.x, e.y, tgt.x, tgt.y)) {
            this.attackUnit(e.id, tgt.id); shot = true; break; // shooting ends the turn
          } else {
            const path = this.findPath(e.x, e.y, tgt.x, tgt.y);
            if (!path || !path.length) break;
            const steps = Math.min(path.length, e.movement);
            const dest = path[steps - 1];
            // don't step onto the target's tile
            if (dest.x === tgt.x && dest.y === tgt.y && steps > 1) { const d2 = path[steps - 2]; this.moveUnit(e.id, d2.x, d2.y); }
            else if (!(dest.x === tgt.x && dest.y === tgt.y)) this.moveUnit(e.id, dest.x, dest.y);
            else break;
          }
        }
        if (!shot && e.hp > 0 && e.actionPoints > 0) this.overwatchUnit(e.id); // guard the approach
      }
    }

    _checkEnd() {
      if (this.ended) return;
      const allies = this.aliveAllies().length;
      const enemies = this.aliveEnemies().length;
      if (allies === 0 || enemies === 0) {
        this.ended = true;
        const victory = allies > 0;
        this.onEvent("end", { victory: victory });
        this.onEnd({ victory: victory, log: this.log, turns: this.turnNumber });
      }
    }
  }

  const api = { TacticalBattle: TacticalBattle, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.TacticalBattle = TacticalBattle;
  root.FFG.sim.mulberry32 = mulberry32;
})(typeof window !== "undefined" ? window : globalThis);
