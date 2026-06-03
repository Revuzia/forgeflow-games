/**
 * FFG runtime — sim/tactical_grid.js
 * Pure simulation core for grid tactics (XCOM / Fire Emblem / Into the Breach).
 * NO rendering here — rendering + input + feel live in ffg_tactics.js.
 *
 * Deterministic when given a seeded rng (config.rng), so the signature gate can
 * drive it headlessly in Node and assert the defining mechanics actually work.
 *
 * Grid tile codes: 0=floor, 1=wall(blocks move+LOS), 2=half_cover(passable),
 *                  3=full_cover(blocks move, grants cover), 4=hazard(passable, dmg),
 *                  5=building wall(blocks move+LOS, = full cover), 6=rooftop deck
 *                  (elevation 1), 7=ramp (climb connector ground<->deck).
 * Multi-floor (2-layer): an optional `config.upper` grid (same WxH) is FLOOR 1 —
 *                  the second storey you fight inside/on. Upper-floor codes:
 *                  9=interior floor (walkable), 8=STAIRS (present on BOTH floors at
 *                  the same cell, the only vertical connector), plus 1/2/3/5 walls &
 *                  cover. Upper-floor 0 = open air (NOT walkable — no floor there).
 *                  No `upper` grid => single-floor, behaves exactly as before.
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
      // FLOOR 1 (optional second storey). Same dims as the ground grid. Cells:
      // 9 = interior floor (walkable), 8 = stairs (shared with ground), 1/2/3/5 =
      // walls & cover, 0 = open air (not walkable). Null => single-floor map.
      this.upper = config.upper || null;
      this.floors = this.upper ? 2 : 1;
      this.rng = config.rng || (typeof config.seed === "number" ? mulberry32(config.seed) : Math.random);
      this.player_units = (config.player_units || []).map((u) => this._initUnit(u, "player"));
      this.enemy_units = (config.enemy_units || []).map((u) => this._initUnit(u, "enemy"));
      this.currentPhase = "player";
      this.turnNumber = 1;
      this.selectedUnit = null;
      this.onEnd = config.onEnd || function () {};
      this.onEvent = config.onEvent || function () {}; // (type, payload) for the renderer
      this.ended = false;
      this.victory = false;
      this.log = [];
      // Objective (XCOM mission variety). Default: eliminate all. Others: "evac"
      // (get every soldier onto an evac tile) and "hack" (a soldier reaches the
      // terminal, then evac if one is set). Optional turnLimit fails on overrun.
      const gg = config.goal || {};
      this.goal = {
        type: gg.type || "eliminate",
        turnLimit: gg.turnLimit != null ? gg.turnLimit : null,
        evac: gg.evac || [],
        target: gg.target || null,
        hacked: false,
      };
      // Concealment + pods (XCOM): the squad starts hidden; enemies are grouped
      // into pods that stay dormant until SPOTTED, then scamper to cover.
      this.concealed = config.concealment !== false;
      this.sightRange = config.sightRange != null ? config.sightRange : 9;
      // LOOT (XCOM 2 model): only SOME kills drop a timed loot marker you must
      // reach with a soldier before it expires (explosive kills DESTROY the loot).
      // lootTable = [{id,name}] of droppable field gear; lootChance = per-kill odds.
      this.lootTable = config.lootTable || [];
      this.lootChance = config.lootChance != null ? config.lootChance : 0.35;
      this.lootTurns = config.lootTurns != null ? config.lootTurns : 3; // turns before it's lost
      this.loot = [];      // active markers: {x,y,floor,turnsLeft,item}
      this.salvage = [];   // items the squad has GRABBED this mission: {item}
      this._assignPods();
    }

    // Cluster enemies into pods by proximity (greedy). Each pod reveals/acts as a
    // unit. Honors an explicit `pod` field on a unit if present.
    _assignPods() {
      this.pods = {}; let auto = 0;
      const placed = [];
      for (const e of this.enemy_units) {
        if (e.pod != null) { (this.pods[e.pod] = this.pods[e.pod] || { id: e.pod, revealed: false }); placed.push(e); continue; }
        let best = null, bestD = 1e9;
        for (const p of placed) {
          const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
          if (d < bestD) { bestD = d; best = p; }
        }
        e.pod = (best && bestD <= 6) ? best.pod : ("pod" + (auto++));
        this.pods[e.pod] = this.pods[e.pod] || { id: e.pod, revealed: false };
        placed.push(e);
      }
      // a single-pod fallback so "concealment off" content still works
      if (!this.enemy_units.length) this.concealed = false;
    }

    podRevealed(id) { return !this.pods[id] || this.pods[id].revealed; }

    // Reveal a pod: mark it + break squad concealment. On reveal during the enemy
    // turn the pod "scampers" (repositions toward nearby cover) instead of firing.
    revealPod(id, opts) {
      const pod = this.pods[id];
      if (!pod || pod.revealed) return false;
      pod.revealed = true; this.concealed = false;
      const members = this.enemy_units.filter((e) => e.pod === id && e.hp > 0);
      members.forEach((m) => { m.revealed = true; });
      this.onEvent("reveal", { pod: id, units: members.map((m) => m.id) });
      this.log.push("pod " + id + " revealed");
      if (opts && opts.scamper) members.forEach((m) => this._scamper(m));
      return true;
    }

    // Move a freshly-revealed enemy one step toward the nearest cover-adjacent tile.
    _scamper(e) {
      if (e.actionPoints < 1) return;
      let best = null, bestScore = -1;
      for (const r of this.reachableTiles(e)) {
        // prefer tiles that have adjacent cover (defensive) and are closer to a foe
        const hasCover = this.hasAnyCover({ x: r.x, y: r.y, floor: r.floor });
        const nearestFoe = this.aliveAllies().reduce((m, a) => Math.min(m, Math.abs(a.x - r.x) + Math.abs(a.y - r.y)), 1e9);
        const score = (hasCover ? 10 : 0) - r.cost * 0.5 - nearestFoe * 0.1;
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (best && (best.x !== e.x || best.y !== e.y || (best.floor || 0) !== (e.floor || 0))) { this.moveUnit(e.id, best.x, best.y, best.floor); e.actionPoints = 0; }
      else e.actionPoints = 0; // brace in place
    }

    // Any unrevealed pod with a member that can see a player (LOS within sight)?
    _spotCheck(opts) {
      for (const e of this.aliveEnemies()) {
        if (this.podRevealed(e.pod)) continue;
        for (const a of this.aliveAllies()) {
          const d = Math.abs(e.x - a.x) + Math.abs(e.y - a.y);
          if (d <= this.sightRange && this.hasLineOfSight(e.x, e.y, a.x, a.y, e.floor || 0, a.floor || 0)) { this.revealPod(e.pod, opts); break; }
        }
      }
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
        floor: u.floor != null ? u.floor : 0, // 0 = ground, 1 = second storey
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
        pod: u.pod != null ? u.pod : null, // enemy pod id (assigned in _assignPods)
        revealed: side === "player",  // players always "revealed"; enemies start hidden
      };
    }

    // ── Queries ────────────────────────────────────────────────────────────
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.gridW && y < this.gridH; }

    // The grid for a given floor (0 = ground, 1 = upper). Helpers below default to
    // floor 0 so every legacy single-floor call site keeps working unchanged.
    gridForFloor(floor) { return floor === 1 ? this.upper : this.grid; }
    tileAt(x, y, floor) {
      if (!this.inBounds(x, y)) return undefined;
      const g = this.gridForFloor(floor || 0);
      return g ? g[y][x] : undefined;
    }

    isWalkable(x, y, floor) {
      if (!this.inBounds(x, y)) return false;
      floor = floor || 0;
      if (floor === 1) {
        if (!this.upper) return false;
        const t = this.upper[y][x];
        return t === 9 || t === 8; // interior floor or stairs (air/walls/cover not walkable)
      }
      const t = this.grid[y][x];
      // Floor 0 walkable: open floor / hazard / ROOFTOP deck (6) / RAMP (7) /
      // STAIRS (8). Cover tiles are solid (units path around them).
      return t === 0 || t === 4 || t === 6 || t === 7 || t === 8;
    }
    // Height for the high-ground bonus & cross-floor LOS. Upper storey (floor 1)
    // = 2, a ground rooftop deck (6) = 1, plain ground = 0.
    elevationAt(x, y, floor) {
      if ((floor || 0) === 1) return 2;
      return (this.inBounds(x, y) && this.grid[y][x] === 6) ? 1 : 0;
    }
    // Can a unit step a->b? LATERAL (same floor, adjacent): walkable + same deck
    // elevation, unless a ramp(7) bridges it. VERTICAL (same cell, |Δfloor|=1):
    // only through a STAIRS cell (8) present on both floors.
    canStep(ax, ay, af, bx, by, bf) {
      af = af || 0; bf = bf || 0;
      if (af === bf) {
        if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false; // must be orthogonally adjacent
        if (!this.isWalkable(bx, by, bf)) return false;
        if (bf === 1) return true; // upper storey is a single flat interior level
        const ta = this.grid[ay][ax], tb = this.grid[by][bx];
        if (ta === 7 || tb === 7) return true; // ramp connects deck<->ground
        return this.elevationAt(ax, ay, 0) === this.elevationAt(bx, by, 0);
      }
      // vertical move: same column, one floor apart, both ends are stairs
      if (ax !== bx || ay !== by || Math.abs(af - bf) !== 1) return false;
      return this.tileAt(ax, ay, af) === 8 && this.tileAt(bx, by, bf) === 8;
    }

    unitAt(x, y, floor) {
      floor = floor || 0;
      return this.allUnits().find((u) => u.x === x && u.y === y && (u.floor || 0) === floor && u.hp > 0) || null;
    }

    getUnit(id) { return this.allUnits().find((u) => u.id === id) || null; }
    allUnits() { return this.player_units.concat(this.enemy_units); }
    aliveAllies() { return this.player_units.filter((u) => u.hp > 0); }
    aliveEnemies() { return this.enemy_units.filter((u) => u.hp > 0); }

    // ── LOOT (XCOM 2 timed battlefield drops) ─────────────────────────────────
    // Some enemy kills drop a marker you must REACH with a soldier before it
    // expires; explosive kills destroy the loot (never call this on a frag kill).
    _maybeDropLoot(victim, byExplosive) {
      if (!victim || victim.side !== "enemy" || byExplosive) return;
      if (!this.lootTable.length || this.rng() > this.lootChance) return;
      const item = this.lootTable[(this.rng() * this.lootTable.length) | 0];
      const marker = { x: victim.x, y: victim.y, floor: victim.floor || 0, turnsLeft: this.lootTurns, item: item };
      this.loot.push(marker);
      this.onEvent("loot_drop", { loot: marker });
      return marker;
    }
    // A player who ends a move on/adjacent to a marker recovers it (LOS implied by
    // having pathed there). Recovered gear lands in this.salvage for the debrief.
    _grabLootAt(u) {
      if (!u || u.side !== "player") return;
      for (let i = this.loot.length - 1; i >= 0; i--) {
        const L = this.loot[i];
        if ((L.floor || 0) !== (u.floor || 0)) continue;
        if (Math.abs(L.x - u.x) + Math.abs(L.y - u.y) <= 1) {
          this.salvage.push({ item: L.item, by: u.id });
          this.loot.splice(i, 1);
          this.log.push(u.id + " recovered " + (L.item.name || L.item.id));
          this.onEvent("loot_grab", { loot: L, unit: u.id });
        }
      }
    }
    // Each fresh player turn, every marker loses a turn; at zero it's lost forever.
    _tickLoot() {
      for (let i = this.loot.length - 1; i >= 0; i--) {
        if (--this.loot[i].turnsLeft <= 0) {
          const L = this.loot.splice(i, 1)[0];
          this.onEvent("loot_expire", { loot: L });
          this.log.push("loot lost: " + (L.item.name || L.item.id));
        }
      }
    }
    hasSalvage(id) { return this.salvage.some((s) => s.item && s.item.id === id); }

    /**
     * Tiles a unit can reach this action, respecting movement budget, walls, and
     * other units. Returns [{x,y,cost}]. Used for the move-range highlight AND
     * as the signature-mechanic assertion (movement is genuinely path-constrained).
     */
    reachableTiles(unit) {
      const out = [];
      const seen = {};
      const sf = unit.floor || 0;
      seen[unit.x + "," + unit.y + "," + sf] = 0;
      let frontier = [{ x: unit.x, y: unit.y, f: sf, cost: 0 }];
      while (frontier.length) {
        const next = [];
        for (const node of frontier) {
          // 4 lateral neighbours on this floor + 1 vertical (stairs) neighbour
          const cands = [
            { x: node.x + 1, y: node.y, f: node.f }, { x: node.x - 1, y: node.y, f: node.f },
            { x: node.x, y: node.y + 1, f: node.f }, { x: node.x, y: node.y - 1, f: node.f },
            { x: node.x, y: node.y, f: node.f === 0 ? 1 : 0 },
          ];
          for (const c of cands) {
            const cost = node.cost + 1;
            if (cost > unit.movement) continue;
            if (!this.canStep(node.x, node.y, node.f, c.x, c.y, c.f)) continue; // floor- & elevation-aware
            if (this.unitAt(c.x, c.y, c.f)) continue;
            const k = c.x + "," + c.y + "," + c.f;
            if (seen[k] != null && seen[k] <= cost) continue;
            seen[k] = cost;
            out.push({ x: c.x, y: c.y, floor: c.f, cost: cost });
            next.push({ x: c.x, y: c.y, f: c.f, cost: cost });
          }
        }
        frontier = next;
      }
      return out;
    }

    // A* (orthogonal + stairs, unit-blocking). Returns path excluding the start
    // tile; each step is {x,y,floor}. sf/ef = start/end floor (default ground).
    findPath(sx, sy, ex, ey, sf, ef) {
      sf = sf || 0; ef = ef || 0;
      const key = (x, y, fl) => x + "," + y + "," + fl;
      const h = (x, y, fl) => Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ef - fl);
      const start = key(sx, sy, sf);
      const open = new Set([start]);
      const cameFrom = {};
      const g = { [start]: 0 };
      const f = { [start]: h(sx, sy, sf) };
      while (open.size) {
        let cur = null, best = Infinity;
        for (const k of open) { const v = f[k] != null ? f[k] : Infinity; if (v < best) { best = v; cur = k; } }
        if (!cur) break;
        const parts = cur.split(",");
        const cx = +parts[0], cy = +parts[1], cf = +parts[2];
        if (cx === ex && cy === ey && cf === ef) {
          const path = [{ x: cx, y: cy, floor: cf }];
          let c = cur;
          while (cameFrom[c]) { c = cameFrom[c]; const p = c.split(","); path.unshift({ x: +p[0], y: +p[1], floor: +p[2] }); }
          return path.slice(1);
        }
        open.delete(cur);
        const cands = [
          { x: cx + 1, y: cy, f: cf }, { x: cx - 1, y: cy, f: cf },
          { x: cx, y: cy + 1, f: cf }, { x: cx, y: cy - 1, f: cf },
          { x: cx, y: cy, f: cf === 0 ? 1 : 0 }, // stairs
        ];
        for (const c of cands) {
          if (!this.canStep(cx, cy, cf, c.x, c.y, c.f)) continue; // floor- & elevation-aware
          if (this.unitAt(c.x, c.y, c.f) && !(c.x === ex && c.y === ey && c.f === ef)) continue;
          const nk = key(c.x, c.y, c.f);
          const tg = (g[cur] != null ? g[cur] : Infinity) + 1;
          if (tg < (g[nk] != null ? g[nk] : Infinity)) {
            cameFrom[nk] = cur; g[nk] = tg;
            f[nk] = tg + h(c.x, c.y, c.f);
            open.add(nk);
          }
        }
      }
      return null;
    }

    // Bresenham LOS; walls (1) and full cover (3/5) block sight. Floor-aware:
    // same-floor sight traces THAT floor's grid; cross-floor sight (a soldier on
    // the upper storey shooting down, or vice-versa) traces the ground grid but
    // only SOLID BUILDINGS (1) block — you see over cover/walls from height.
    hasLineOfSight(fromX, fromY, toX, toY, fromFloor, toFloor) {
      fromFloor = fromFloor || 0; toFloor = toFloor || 0;
      const cross = fromFloor !== toFloor;
      const grid = cross ? this.grid : this.gridForFloor(fromFloor);
      if (!grid) return false;
      const blocks = cross
        ? (t) => t === 1
        : (t) => t === 1 || t === 3 || t === 5;
      const dx = Math.abs(toX - fromX), dy = Math.abs(toY - fromY);
      const sx = fromX < toX ? 1 : -1, sy = fromY < toY ? 1 : -1;
      let err = dx - dy, x = fromX, y = fromY;
      while (x !== toX || y !== toY) {
        const isEndpoint = (x === fromX && y === fromY) || (x === toX && y === toY);
        if (!isEndpoint) {
          const t = grid[y] && grid[y][x];
          if (blocks(t)) return false;
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
      const g = this.gridForFloor(unit.floor || 0); if (!g) return 0;
      let best = 0;
      for (const d of dirs) {
        const dx = d[0], dy = d[1];
        const nx = unit.x + dx, ny = unit.y + dy;
        const t = g[ny] && g[ny][nx];
        const cv = (t === 3 || t === 5) ? 2 : t === 2 ? 1 : 0; // a building wall (5) = full cover
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
      const g = this.gridForFloor(target.floor || 0); if (!g) return false;
      for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const t = g[target.y + d[1]] && g[target.y + d[1]][target.x + d[0]];
        if (t === 2 || t === 3 || t === 5) return true;
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
      const rawCover = this.coverAt(target, attacker.x, attacker.y);
      const highGround = this.elevationAt(attacker.x, attacker.y, attacker.floor || 0) > this.elevationAt(target.x, target.y, target.floor || 0);
      const cover = (highGround && rawCover === 1) ? 0 : rawCover; // high ground negates HALF cover
      const coverPenalty = cover === 2 ? 0.4 : cover === 1 ? 0.2 : 0;
      const flanked = this.isFlanked(attacker, target);
      const flankBonus = flanked ? 0.25 : (cover === 0 ? 0.1 : 0);
      const suppress = attacker.suppressAimPenalty || 0; // pinned shooters fire wild
      const ambush = !!this.concealed && attacker.side === "player"; // firing from concealment = the drop
      const ambushBonus = ambush ? 0.15 : 0;
      const heightBonus = highGround ? 0.2 : 0; // XCOM high-ground aim bonus
      const chance = inRange ? Math.max(0.05, Math.min(0.99, attacker.aim - distancePenalty - coverPenalty + flankBonus + ambushBonus + heightBonus - suppress)) : 0;
      const critChance = (flanked || ambush) ? 0.5 : 0.1;
      return { chance, critChance, cover, coverPenalty, distancePenalty, flankBonus, ambush, ambushBonus, suppress, flanked, highGround, heightBonus, dist, inRange };
    }

    calculateHitChance(attacker, target) { return this.hitBreakdown(attacker, target).chance; }

    // ── Actions ──────────────────────────────────────────────────────────────
    moveUnit(unitId, toX, toY, toFloor) {
      const u = this.getUnit(unitId);
      if (!u || u.hp <= 0 || u.actionPoints < 1) return null;
      const sf = u.floor || 0;
      toFloor = toFloor != null ? toFloor : sf; // default: stay on the same storey
      const path = this.findPath(u.x, u.y, toX, toY, sf, toFloor);
      if (!path || path.length === 0 || path.length > u.movement) return null;
      if (this.unitAt(toX, toY, toFloor)) return null;
      u.x = toX; u.y = toY; u.floor = toFloor;
      u.actionPoints--;
      // Hazard tile damage (ground floor only)
      if (toFloor === 0 && this.grid[toY][toX] === 4) { u.hp = Math.max(0, u.hp - 2); this.log.push(u.id + " took 2 hazard dmg"); }
      this.onEvent("move", { unit: u, path: path });
      if (u.side === "player") this._grabLootAt(u); // recover any field loot reached this move
      // Objective progress: a soldier reaching the terminal hacks it.
      if (u.side === "player" && this.goal.type === "hack" && !this.goal.hacked && this.goal.target && this.goal.target.x === toX && this.goal.target.y === toY) {
        this.goal.hacked = true; this.log.push(u.id + " hacked the terminal"); this.onEvent("objective", { kind: "hacked", unit: u.id });
      }
      // A player walking into an enemy's sight trips the pod — it reveals + scampers.
      if (u.side === "player") this._spotCheck({ scamper: true });
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
      if (!this.hasLineOfSight(a.x, a.y, t.x, t.y, a.floor || 0, t.floor || 0)) return { success: false, reason: "no LOS" };
      const bd = this.hitBreakdown(a, t);
      if (bd.chance <= 0) return { success: false, reason: "out of range" };
      const chance = reaction ? bd.chance * 0.7 : bd.chance; // reaction fire is less accurate
      // Shooting ENDS the turn (XCOM 2 action economy); reaction shots are free.
      if (!reaction) a.actionPoints = 0;
      const roll = this.rng();
      let res;
      if (roll <= chance) {
        const crit = !reaction && (bd.flanked || bd.ambush) && this.rng() < bd.critChance;
        let dmg = Math.max(1, a.atk - t.def);
        if (crit) dmg = Math.round(dmg * 1.5);
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) { a._kills = (a._kills || 0) + 1; this._maybeDropLoot(t, false); }
        this.log.push(a.id + (reaction ? " overwatch-hit " : crit ? " CRIT " : bd.ambush ? " ambush-hit " : " hit ") + t.id + " for " + dmg);
        this.onEvent("attack", { attacker: a, target: t, hit: true, damage: dmg, chance: chance, killed: t.hp <= 0, crit: crit, flanked: bd.flanked, ambush: bd.ambush, reaction: reaction });
        res = { success: true, hit: true, damage: dmg, killed: t.hp <= 0, chance: chance, crit: crit, flanked: bd.flanked };
      } else {
        this.log.push(a.id + (reaction ? " overwatch-missed " : " missed ") + t.id);
        this.onEvent("attack", { attacker: a, target: t, hit: false, chance: chance, reaction: reaction });
        res = { success: true, hit: false, chance: chance };
      }
      // Firing breaks the squad's concealment + reveals the target's pod.
      if (a.side === "player" && !reaction) { this.revealPod(t.pod); this.concealed = false; }
      this._checkEnd();
      return res;
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
        // Offensive abilities break concealment + reveal the affected pod(s).
        if (u.side === "player" && def.target !== "ally") {
          this.concealed = false;
          const tgt = opts.targetId ? this.getUnit(opts.targetId) : null;
          if (tgt && tgt.pod != null) this.revealPod(tgt.pod);
          // a tile blast reveals any pod with a member caught in/near the radius
          if (def.target === "tile") this.enemy_units.forEach((e) => { if (e.hp > 0 && Math.max(Math.abs(e.x - opts.tileX), Math.abs(e.y - opts.tileY)) <= (def.radius || 1) + 1) this.revealPod(e.pod); });
        }
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
      if (t.hp <= 0) { u._kills = (u._kills || 0) + 1; this._maybeDropLoot(t, false); }
      this.log.push(u.id + " slashed " + t.id + " for " + dmg + (crit ? " CRIT" : ""));
      this.onEvent("ability", { ability: "slash", attacker: u, target: t, hit: true, damage: dmg, crit, killed: t.hp <= 0 });
      return { success: true, hit: true, damage: dmg, crit, killed: t.hp <= 0 };
    }

    _abHeadshot(u, def, opts) {
      const t = this.getUnit(opts.targetId);
      if (!t || t.side === u.side || t.hp <= 0) return { success: false, reason: "need enemy" };
      const range = def.range != null ? def.range : u.range;
      if (Math.abs(u.x - t.x) + Math.abs(u.y - t.y) > range) return { success: false, reason: "out of range" };
      if (!this.hasLineOfSight(u.x, u.y, t.x, t.y, u.floor || 0, t.floor || 0)) return { success: false, reason: "no LOS" };
      const bd = this.hitBreakdown(u, t);
      const chance = Math.min(0.99, bd.chance + 0.15); // steadied
      if (this.rng() <= chance) {
        const crit = this.rng() < def.crit;
        let dmg = Math.max(1, Math.round(u.atk * def.dmgMult) - t.def);
        if (crit) dmg = Math.round(dmg * 1.5);
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) { u._kills = (u._kills || 0) + 1; this._maybeDropLoot(t, false); }
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
            // Blow a HOLE in a building wall (1 -> rubble/floor 0): opens LOS +
            // a new path, true XCOM destructible cover. Cover degrades 3->2->0.
            if (c === 1 || c === 5) { this.grid[yy][xx] = 0; shredded.push({ x: xx, y: yy, from: c, to: 0 }); }
            else if (c === 2 || c === 3) { const to = c === 3 ? 2 : 0; this.grid[yy][xx] = to; shredded.push({ x: xx, y: yy, from: c, to: to }); }
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
      if (!this.hasLineOfSight(u.x, u.y, t.x, t.y, u.floor || 0, t.floor || 0)) return { success: false, reason: "no LOS" };
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
        if (dist > w.range || !this.hasLineOfSight(w.x, w.y, mover.x, mover.y, w.floor || 0, mover.floor || 0)) continue;
        w.overwatch = false;
        this.attackUnit(w.id, mover.id, { reaction: true });
      }
    }

    endTurn() {
      if (this.ended) return;
      if (this.currentPhase === "player") {
        this.currentPhase = "enemy";
        // FRESH ENEMY TURN: refill enemy AP + clear their watch. (Bug fix: the old code
        // reset the *player's* AP here because currentPhase is always "player" on entry,
        // so enemies kept 0 AP from turn 2 on and FROZE — the "enemies don't move" report.)
        for (const e of this.enemy_units) { e.actionPoints = e.maxAP; e.overwatch = false; }
        this.onEvent("phase", { phase: "enemy", turn: this.turnNumber });
        this._runEnemyTurn();
        if (!this.ended) {
          this.currentPhase = "player";
          this.turnNumber++;
          for (const u of this.player_units) { u.actionPoints = u.maxAP; u.overwatch = false; }
          this._tickLoot(); // field loot decays each fresh player turn (grab it fast)
          this._tickCooldowns(this.player_units);           // ability cooldowns recover
          for (const e of this.enemy_units) { e.suppressedBy = null; e.suppressAimPenalty = 0; } // pins expire at our next turn
          // Mission timer: overrunning the limit fails the op.
          if (this.goal.turnLimit != null && this.turnNumber > this.goal.turnLimit) { this._finish(false, "timeout"); return; }
          this.onEvent("phase", { phase: "player", turn: this.turnNumber });
        }
      }
    }

    // BOSS turn: a phase-change ENRAGE at <=50% HP (once), then an AoE PSI SLAM on
    // cooldown that hits every soldier near the boss. Returns true if the boss spent
    // its turn on a special; false to fall back to normal aggressive AI.
    _bossAct(e) {
      if (!e.enraged && e.hp <= e.maxHp * 0.5) {
        e.enraged = true; e.atk = Math.round(e.atk * 1.3); e.movement = (e.movement || 4) + 1; e._bossCd = 0;
        this.log.push(e.id + " ENRAGED");
        this.onEvent("boss_phase", { unit: e, phase: "enrage" });
      }
      if ((e._bossCd || 0) > 0) { e._bossCd--; return false; }
      const R = 3, hits = [];
      for (const a of this.aliveAllies()) {
        if (Math.max(Math.abs(a.x - e.x), Math.abs(a.y - e.y)) <= R) {
          const dmg = Math.max(2, Math.round(e.atk * (e.enraged ? 0.7 : 0.5)));
          a.hp = Math.max(0, a.hp - dmg); hits.push({ id: a.id, damage: dmg, killed: a.hp <= 0 });
        }
      }
      if (!hits.length) return false; // no soldier in slam range → behave normally
      e._bossCd = e.enraged ? 2 : 3; e.actionPoints = 0;
      this.log.push(e.id + " PSI SLAM hit " + hits.length);
      this.onEvent("boss_ability", { kind: "slam", unit: e, x: e.x, y: e.y, radius: R, hits: hits });
      this._checkEnd();
      return true;
    }

    _nearestAlly(e) {
      let best = null, bd = Infinity;
      for (const a of this.aliveAllies()) { const d = Math.abs(a.x - e.x) + Math.abs(a.y - e.y); if (d < bd) { bd = d; best = a; } }
      return best;
    }
    _distToNearestAlly(e) { const a = this._nearestAlly(e); return a ? Math.abs(a.x - e.x) + Math.abs(a.y - e.y) : 9999; }

    // Best shot `e` could take standing at (x,y,f): {target, score, chance, flanked} or null.
    // Temporarily relocates e to score cover/flank/LOS from that tile, then restores it
    // (fully synchronous — no state leaks). Score rewards FLANKS and FINISHING low-HP
    // soldiers (focus fire), so the AI plays like XCOM instead of charging in a line.
    _bestShotFrom(e, x, y, f) {
      const ox = e.x, oy = e.y, of = e.floor; e.x = x; e.y = y; e.floor = f;
      let best = null;
      for (const a of this.aliveAllies()) {
        const dist = Math.abs(a.x - x) + Math.abs(a.y - y);
        if (dist > e.range) continue;
        if (!this.hasLineOfSight(x, y, a.x, a.y, f, a.floor || 0)) continue;
        const bd = this.hitBreakdown(e, a);
        if (bd.chance <= 0) continue;
        const expDmg = bd.chance * (e.atk || 4);
        const score = bd.chance + (bd.flanked ? 0.35 : 0) + (a.hp <= expDmg ? 0.6 : 0) + (a.hp <= (e.atk || 4) ? 0.25 : 0);
        if (!best || score > best.score) best = { target: a, score: score, chance: bd.chance, flanked: bd.flanked };
      }
      e.x = ox; e.y = oy; e.floor = of;
      return best;
    }

    // Would standing at `tile` give cover against `foe`?
    _coverVs(tile, foe) { return this.coverAt({ x: tile.x, y: tile.y, floor: tile.floor }, foe.x, foe.y) > 0; }

    // Archetype temperament when SCORING a firing tile. `here` = scoring the unit's
    // current tile (adds a "hold position" bias so ranged types don't pointlessly move).
    _aiTileBias(ai, tile, shot, here) {
      const standoff = this._distToNearestAlly(tile); // distance from this tile to nearest soldier
      if (ai === "sniper") {
        // snipers want RANGE + high-ground (baked into shot.score) + holding still; hate being close
        return standoff * 0.03 + (here ? 0.18 : 0) - (standoff < 3 ? 0.6 : 0);
      }
      if (ai === "defensive") {
        // defenders only reposition INTO cover and love staying put behind it
        return (this._coverVs(tile, shot.target) ? 0.45 : -0.25) + (here ? 0.22 : 0);
      }
      // aggressive (drone/stalker): reward FLANKS + closing the distance + a little cover
      return (shot.flanked ? 0.3 : 0) + (this._coverVs(tile, shot.target) ? 0.1 : 0) - standoff * 0.015;
    }

    // Archetype movement when there is NO shot available this turn.
    _aiAdvance(e, ai) {
      const tgt = this._nearestAlly(e); if (!tgt) return;
      const cands = this.reachableTiles(e).filter((c) => !this.unitAt(c.x, c.y, c.floor));
      if (!cands.length) return;
      const d = (c) => Math.abs(c.x - tgt.x) + Math.abs(c.y - tgt.y);
      let dest;
      if (ai === "sniper") {
        // KITE: a sniper never melee-rushes. If a soldier is close, fall back to MAXIMIZE
        // distance; otherwise edge toward its ideal standoff band (~range-1) to open a lane.
        if (this._distToNearestAlly(e) < 5) cands.sort((p, q) => d(q) - d(p));
        else cands.sort((p, q) => Math.abs(d(p) - (e.range - 1)) - Math.abs(d(q) - (e.range - 1)));
        dest = cands[0];
      } else if (ai === "defensive") {
        // hold the line: advance slowly toward the squad but only ENDING in cover
        cands.sort((p, q) => (d(p) - (this._coverVs(p, tgt) ? 2.5 : 0)) - (d(q) - (this._coverVs(q, tgt) ? 2.5 : 0)));
        dest = cands[0];
      } else {
        // aggressive: CLOSE the distance, cover only a tiebreak among the closest tiles
        let minD = Infinity; for (const c of cands) { const dd = d(c); if (dd < minD) minD = dd; }
        const lead = cands.filter((c) => d(c) <= minD + 1);
        lead.sort((p, q) => (d(p) - (this._coverVs(p, tgt) ? 0.6 : 0) + p.cost * 0.02) - (d(q) - (this._coverVs(q, tgt) ? 0.6 : 0) + q.cost * 0.02));
        dest = lead[0];
      }
      if (dest && (dest.x !== e.x || dest.y !== e.y)) this.moveUnit(e.id, dest.x, dest.y, dest.floor);
    }

    _runEnemyTurn() {
      this._spotCheck(); // pods that can see a soldier at turn start activate + engage
      // front-liners (nearest a soldier) act first, so the squad focus-fires as a unit
      const order = this.aliveEnemies().slice().sort((p, q) => this._distToNearestAlly(p) - this._distToNearestAlly(q));
      for (const e of order) {
        if (this.ended) return;
        if (e.hp <= 0 || !this.podRevealed(e.pod)) continue; // dormant pod stays put until spotted
        if (!this.aliveAllies().length) break;
        if (e.boss && this._bossAct(e)) continue; // boss spent its turn on a phase/slam special
        const ai = e.ai || "aggressive"; // drone/stalker=aggressive, sniper=kiter, defender=holds cover

        // 1) shot from where it stands now (+ archetype hold-position bias)
        const here = this._bestShotFrom(e, e.x, e.y, e.floor || 0);
        const hereScore = here ? here.score + this._aiTileBias(ai, e, here, true) : -Infinity;
        // 2) best FIRING POSITION it can move to, scored by archetype temperament
        let moveTile = null, moveShot = null, moveScore = -Infinity;
        if (e.actionPoints >= 2) {
          for (const c of this.reachableTiles(e)) {
            if (this.unitAt(c.x, c.y, c.floor)) continue;
            const s = this._bestShotFrom(e, c.x, c.y, c.floor);
            if (!s) continue;
            const sc = s.score + this._aiTileBias(ai, c, s, false) - c.cost * 0.02;
            if (sc > moveScore) { moveScore = sc; moveTile = c; moveShot = s; }
          }
        }

        // DECIDE: fire in place if it's ~as good as repositioning (snipers/defenders favor
        // this); else move to the archetype-preferred firing tile and fire.
        if (here && (moveShot == null || hereScore >= moveScore - 0.12)) {
          this.attackUnit(e.id, here.target.id); // shooting ends the turn
        } else if (moveTile && moveShot) {
          this.moveUnit(e.id, moveTile.x, moveTile.y, moveTile.floor);
          if (e.hp > 0 && e.actionPoints > 0) this.attackUnit(e.id, moveShot.target.id);
        } else {
          // 3) no shot reachable: move per archetype (kite / hold-cover / close), then a
          // lane may have opened — take it; otherwise hold OVERWATCH to guard the approach.
          this._aiAdvance(e, ai);
          const now = this._bestShotFrom(e, e.x, e.y, e.floor || 0);
          if (now && e.hp > 0 && e.actionPoints > 0) this.attackUnit(e.id, now.target.id);
          else if (e.hp > 0 && e.actionPoints > 0) this.overwatchUnit(e.id);
        }
      }
    }

    _finish(victory, reason) {
      if (this.ended) return;
      // XCOM rule: any non-expired loot still on the field is AUTO-RECOVERED on a win.
      if (victory && this.loot && this.loot.length) {
        for (const L of this.loot) this.salvage.push({ item: L.item, by: null, auto: true });
        this.loot = [];
      }
      this.ended = true; this.victory = victory;
      this.onEvent("end", { victory: victory, reason: reason || null });
      this.onEnd({ victory: victory, reason: reason || null, log: this.log, turns: this.turnNumber });
    }

    // Is a soldier standing on an objective tile (evac zone / terminal)?
    _allyOn(tiles) {
      if (!tiles || !tiles.length) return false;
      return this.aliveAllies().some((a) => tiles.some((t) => t.x === a.x && t.y === a.y));
    }
    _allAlliesOn(tiles) {
      const al = this.aliveAllies();
      return al.length > 0 && !!tiles && al.every((a) => tiles.some((t) => t.x === a.x && t.y === a.y));
    }

    _checkEnd() {
      if (this.ended) return;
      const allies = this.aliveAllies().length;
      const enemies = this.aliveEnemies().length;
      if (allies === 0) return this._finish(false, "wiped"); // squad lost = always a loss
      const g = this.goal;
      if (g.type === "hack") {
        if (g.hacked && (!g.evac || g.evac.length === 0 || this._allyOn(g.evac))) return this._finish(true, "hacked");
      } else if (g.type === "evac") {
        if (this._allAlliesOn(g.evac)) return this._finish(true, "evac");
      } else { // eliminate (default)
        if (enemies === 0) return this._finish(true, "cleared");
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
