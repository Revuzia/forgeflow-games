#!/usr/bin/env node
/**
 * Generate the full 7-mission Void Skirmish CAMPAIGN as XCOM-2-style PLOTS:
 * a deterministic ROAD NETWORK (the plot skeleton) divides each map into LOTS,
 * and every lot streams in a themed PARCEL — enterable multi-room buildings,
 * walled compounds, open plazas, pocket parks — knit together by streets packed
 * with dense, clustered cover. This is the structure (not raw tile count) that
 * makes an XCOM map read as a city block instead of a room.
 *   Source: Brian Hess "Plot and Parcel" (GDC 2018); shipped parcel tile sizes
 *   16×16 / 16×32 / 32×32; derived playable plot ≈ 64×64, up to ~80 with border.
 *
 * Tiles: 0 floor, 1 building/wall, 2 half-cover, 3 full-cover, 4 hazard.
 * Same fixed 5-class squad every mission (persistent roster + abilities carry
 * through). Each mission is seeded, then connectivity-verified before writing
 * into games/void-skirmish-3d/content.json (missions[]).
 */
const fs = require("fs");
const path = require("path");

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Fixed squad — same five classes every mission so the roster + abilities persist.
const SQUAD = [
  { id: "p_vanguard", name: "Vanguard", cls: "vanguard", hp: 120, atk: 30, def: 15, movement: 4, range: 2, aim: 0.80, tint: "#00aaff", sprite: "vanguard" },
  { id: "p_sentinel", name: "Sentinel", cls: "sharpshooter", hp: 80, atk: 45, def: 8, movement: 3, range: 9, aim: 0.78, tint: "#ff8800", sprite: "sentinel" },
  { id: "p_medic", name: "Medic", cls: "specialist", hp: 70, atk: 20, def: 10, movement: 3, range: 4, aim: 0.72, tint: "#00ff88", sprite: "medic" },
  { id: "p_ranger", name: "Ranger", cls: "ranger", hp: 95, atk: 38, def: 10, movement: 5, range: 3, aim: 0.80, tint: "#22d3ee", sprite: "vanguard" },
  { id: "p_gren", name: "Grenadier", cls: "grenadier", hp: 110, atk: 34, def: 12, movement: 3, range: 6, aim: 0.74, tint: "#a3e635", sprite: "vanguard" },
];

// Enemy archetypes (escalating threat — later missions weight toward the tough ones).
const ARCH = {
  drone:    { name: "Assault Drone", hp: 60, atk: 25, def: 5, movement: 4, range: 3, aim: 0.66, ai: "aggressive", tint: "#ff3333", sprite: "drone" },
  stalker:  { name: "Stalker Beast", hp: 70, atk: 32, def: 6, movement: 6, range: 2, aim: 0.70, ai: "aggressive", tint: "#b86bff", sprite: "stalker" },
  sniper:   { name: "Sniper Unit", hp: 50, atk: 40, def: 3, movement: 2, range: 10, aim: 0.70, ai: "sniper", tint: "#cc0000", sprite: "sniper" },
  defender: { name: "Defender Bot", hp: 95, atk: 22, def: 12, movement: 2, range: 2, aim: 0.62, ai: "defensive", tint: "#ff7a3c", sprite: "defender" },
};

// XCOM plot footprints: escalating 60×50 → 80×68, bracketing the real ~64×64
// playable / ~80 with border. The cinematic camera sits close + fog hides the
// far edges, so the plot reveals lot-by-lot over many turns (never seen at once).
const MISSIONS = [
  { name: "Downtown Insertion", objective: "Eliminate all hostile contacts across the downtown sector.", w: 60, h: 50, enemies: 11, mix: ["drone", "drone", "stalker", "sniper", "defender"], seed: 0xA1 },
  { name: "Market Sweep", objective: "Clear the open market plaza of the alien advance party.", w: 64, h: 52, enemies: 12, mix: ["drone", "stalker", "stalker", "sniper", "defender"], seed: 0xB7 },
  { name: "Rail Yard", objective: "Secure the rail yard and destroy the hostile garrison.", w: 68, h: 56, enemies: 14, mix: ["drone", "stalker", "sniper", "sniper", "defender"], seed: 0xC3 },
  { name: "Power Substation", objective: "Reach and hack the substation relay before the grid locks down.", w: 70, h: 58, enemies: 15, mix: ["stalker", "sniper", "defender", "defender", "drone"], seed: 0xD9, goal: { type: "hack", turnLimit: 16 } },
  { name: "Old Town Siege", objective: "Push through Old Town against entrenched resistance.", w: 74, h: 62, enemies: 17, mix: ["stalker", "stalker", "sniper", "defender", "defender"], seed: 0xE5 },
  { name: "Spire Approach", objective: "Fight to the extraction zone and evac the whole squad.", w: 78, h: 64, enemies: 18, mix: ["sniper", "sniper", "defender", "defender", "stalker"], seed: 0xF2, goal: { type: "evac", turnLimit: 18 } },
  { name: "Avatar Spire", objective: "Assault the spire and shatter the Avatar Project.", w: 80, h: 68, enemies: 20, mix: ["defender", "defender", "sniper", "sniper", "stalker", "stalker"], seed: 0x5C },
];

function buildMission(spec) {
  const GW = spec.w, GH = spec.h, rng = mulberry32(spec.seed >>> 0);
  const ri = (n) => (rng() * n) | 0;
  const grid = Array.from({ length: GH }, () => Array(GW).fill(0));
  // FLOOR-1 (second storey) grid — all 0 (open air) until a building grows upward.
  // 9 = interior floor, 8 = stairs (mirrored on the ground grid), 5 = wall, 2/3 = cover.
  const upper = Array.from({ length: GH }, () => Array(GW).fill(0));
  let hasUpper = false;
  const inB = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;
  const set = (x, y, v) => { if (inB(x, y)) grid[y][x] = v; };
  const setU = (x, y, v) => { if (inB(x, y)) { upper[y][x] = v; if (v) hasUpper = true; } };
  const isFloor = (x, y) => inB(x, y) && grid[y][x] === 0;
  // A half/full cover tile; clustered, never blocking a road.
  const cover = (x, y, fullBias) => { if (isFloor(x, y)) grid[y][x] = rng() < fullBias ? 3 : 2; };
  const coverCluster = (cx, cy, n, fullBias) => {
    let put = 0;
    for (let t = 0; t < n * 4 && put < n; t++) {
      const x = cx + ri(3) - 1, y = cy + ri(3) - 1;
      if (isFloor(x, y)) { cover(x, y, fullBias); put++; }
    }
  };

  // ---- 1. PLOT SKELETON: a road network of avenues (rows) + streets (cols).
  // Roads stay open (0) and guarantee connectivity; lots fill the gaps between.
  const ROAD = 3, MARGIN = 3;
  const lotW = 9 + ri(2), lotH = 8 + ri(2);         // compact XCOM skirmish parcels (were 15x13 -> maps got huge + units tiny)
  const colStarts = [], rowStarts = [];
  for (let x = MARGIN; x < GW - 8; x += lotW + ROAD) colStarts.push(x);
  for (let y = MARGIN; y < GH - 8; y += lotH + ROAD) rowStarts.push(y);

  // ---- 2. PARCELS: each lot streams in a themed chunk.
  function stampBuilding(lx, ly, lw, lh) {
    // Inset 1-tile sidewalk so walls don't fuse with the road.
    let bx = lx + 1, by = ly + 1, bw = lw - 2, bh = lh - 2;
    if (bw < 4 || bh < 4) return stampPlaza(lx, ly, lw, lh);
    // Big lot → split into two buildings with an alley between (more zones, LOS lanes).
    if (bw >= 13 && rng() < 0.6) {
      const split = (bw >> 1);
      stampOneBuilding(bx, by, split - 1, bh);
      stampOneBuilding(bx + split + 1, by, bw - split - 1, bh);
      return;
    }
    if (bh >= 12 && rng() < 0.5) {
      const split = (bh >> 1);
      stampOneBuilding(bx, by, bw, split - 1);
      stampOneBuilding(bx, by + split + 1, bw, bh - split - 1);
      return;
    }
    stampOneBuilding(bx, by, bw, bh);
  }
  function stampOneBuilding(bx, by, bw, bh) {
    if (bw < 3 || bh < 3) return;
    // Most buildings are ENTERABLE: a low perimeter WALL (type 5 — you see over/
    // into it from the iso camera) around an open, FURNISHED interior with a door
    // gap. The rest are solid towers (type 1) for the skyline + hard cover.
    const enterable = bw >= 4 && bh >= 4 && rng() < 0.74;
    if (enterable) {
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
        const edge = (x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1);
        set(x, y, edge ? 5 : 0); // 5 = enterable wall, 0 = room floor
      }
      // Interior cross-wall → 2 rooms (with a 1-tile internal doorway).
      if (bw >= 6 && rng() < 0.55) {
        const wx = bx + 2 + ri(Math.max(1, bw - 4));
        for (let y = by + 1; y < by + bh - 1; y++) set(wx, y, 5);
        set(wx, by + 1 + ri(Math.max(1, bh - 2)), 0);
      } else if (bh >= 6 && rng() < 0.55) {
        const wy = by + 2 + ri(Math.max(1, bh - 4));
        for (let x = bx + 1; x < bx + bw - 1; x++) set(x, wy, 5);
        set(bx + 1 + ri(Math.max(1, bw - 2)), wy, 0);
      }
      // 1–2 exterior doors (gaps in the perimeter wall).
      const doors = 1 + (rng() < 0.6 ? 1 : 0);
      for (let d = 0; d < doors; d++) {
        const side = ri(4);
        if (side === 0) set(bx + 1 + ri(Math.max(1, bw - 2)), by, 0);
        else if (side === 1) set(bx + 1 + ri(Math.max(1, bw - 2)), by + bh - 1, 0);
        else if (side === 2) set(bx, by + 1 + ri(Math.max(1, bh - 2)), 0);
        else set(bx + bw - 1, by + 1 + ri(Math.max(1, bh - 2)), 0);
      }
      // Interior FURNITURE (desks/crates as cover) — the "stuff in the building".
      const fc = 1 + ri(2);
      for (let c = 0; c < fc; c++) coverCluster(bx + 1 + ri(Math.max(1, bw - 2)), by + 1 + ri(Math.max(1, bh - 2)), 1 + ri(2), 0.3);
      // SECOND STOREY (true multi-floor): the interior grows a full upper level on
      // FLOOR 1 — interior floor (9) ringed by (half-height) walls (5), reached by
      // an interior STAIRCASE (8, mirrored onto the ground grid). A little balcony
      // cover for firefights up top. This is the XCOM "rooms above rooms": fight
      // downstairs, climb and flank from the landing above with the high-ground bonus.
      if (bw >= 5 && bh >= 6 && rng() < 0.5) {
        for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
          const edge = (x === bx || x === bx + bw - 1 || y === by || y === by + bh - 1);
          setU(x, y, edge ? 5 : 9); // upper perimeter wall / interior floor
        }
        // staircase: an interior cell beside the perimeter — type 8 on BOTH grids.
        const sx = bx + 1, sy = by + 1 + ri(Math.max(1, bh - 2));
        set(sx, sy, 8); setU(sx, sy, 8);
        // 1–2 cover pieces on the upper floor (crates / railing on the balcony)
        for (let c = 0, uc = 1 + ri(2); c < uc; c++) {
          const ux = bx + 1 + ri(Math.max(1, bw - 2)), uy = by + 1 + ri(Math.max(1, bh - 2));
          if (upper[uy] && upper[uy][ux] === 9) setU(ux, uy, rng() < 0.4 ? 3 : 2);
        }
      } else if (bw >= 5 && bh >= 7 && rng() < 0.3) {
        // (fallback) older single-floor MEZZANINE deck — outdoor-style high ground indoors.
        const mz = by + 2;
        for (let y = by + 1; y <= mz; y++) for (let x = bx + 1; x < bx + bw - 1; x++) set(x, y, 6);
        const cx = bx + (bw >> 1);
        set(cx, mz + 1, 7); set(cx, mz + 2, 0);
      }
    } else {
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, 1); // solid tower
    }
    // Street cover hugging the building footprint (cars / barriers along the curb).
    const curb = 2 + ri(3);
    for (let c = 0; c < curb; c++) {
      const onTopBot = rng() < 0.5;
      const x = onTopBot ? bx + ri(bw) : (rng() < 0.5 ? bx - 1 : bx + bw);
      const y = onTopBot ? (rng() < 0.5 ? by - 1 : by + bh) : by + ri(bh);
      cover(x, y, 0.5);
    }
  }
  function stampCompound(lx, ly, lw, lh) {
    // Defensible position: partial perimeter fence/wall + dense interior cover.
    const bx = lx + 1, by = ly + 1, bw = lw - 2, bh = lh - 2;
    if (bw < 4 || bh < 4) return stampPlaza(lx, ly, lw, lh);
    const sides = [rng() < 0.7, rng() < 0.7, rng() < 0.7, rng() < 0.7]; // T,B,L,R
    for (let x = bx; x < bx + bw; x++) { if (sides[0]) cover(x, by, 0.25); if (sides[1]) cover(x, by + bh - 1, 0.25); }
    for (let y = by; y < by + bh; y++) { if (sides[2]) cover(bx, y, 0.25); if (sides[3]) cover(bx + bw - 1, y, 0.25); }
    // gaps in the fence (enter points)
    set(bx + ri(bw), by, 0); set(bx + ri(bw), by + bh - 1, 0);
    const clusters = 2 + ri(3);
    for (let c = 0; c < clusters; c++) coverCluster(bx + 1 + ri(Math.max(1, bw - 2)), by + 1 + ri(Math.max(1, bh - 2)), 2 + ri(3), 0.55);
    if (rng() < 0.4) set(bx + 1 + ri(Math.max(1, bw - 2)), by + 1 + ri(Math.max(1, bh - 2)), 4);
  }
  function stampPlaza(lx, ly, lw, lh) {
    // Open square: a few cover clusters with sightlines between (market stalls/planters).
    const clusters = 2 + ri(3);
    for (let c = 0; c < clusters; c++) coverCluster(lx + 2 + ri(Math.max(1, lw - 4)), ly + 2 + ri(Math.max(1, lh - 4)), 2 + ri(2), 0.4);
    // occasional kiosk (tiny solid block) for LOS-breaking.
    if (lw >= 8 && lh >= 7 && rng() < 0.5) {
      const kx = lx + 2 + ri(lw - 5), ky = ly + 2 + ri(lh - 4);
      for (let y = ky; y < ky + 2; y++) for (let x = kx; x < kx + 2; x++) set(x, y, 1);
    }
  }
  function stampPark(lx, ly, lw, lh) {
    // Pocket park: foliage hazard + scattered low cover (trees/rocks/benches).
    for (let i = 0; i < 1 + ri(2); i++) set(lx + 2 + ri(Math.max(1, lw - 4)), ly + 2 + ri(Math.max(1, lh - 4)), 4);
    const n = 3 + ri(4);
    for (let i = 0; i < n; i++) coverCluster(lx + 2 + ri(Math.max(1, lw - 4)), ly + 2 + ri(Math.max(1, lh - 4)), 1 + ri(2), 0.5);
  }

  // Raised ROOFTOP DECK (type 6) + RAMP (7) to the ground — optional high-ground
  // (units climb for +aim and line-of-sight over low cover). Verticality.
  function stampPlatform(lx, ly, lw, lh) {
    const bw = Math.min(lw - 2, 5), bh = Math.min(lh - 2, 5);
    if (bw < 3 || bh < 3) return stampPlaza(lx, ly, lw, lh);
    const bx = lx + 1, by = ly + 1;
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, 6); // deck
    const rx = bx + (bw >> 1);
    set(rx, by + bh - 1, 7);                       // bottom-centre deck tile -> ramp
    if (inB(rx, by + bh)) set(rx, by + bh, 0);     // ground at the ramp foot
  }

  for (let ri_ = 0; ri_ < rowStarts.length; ri_++) {
    for (let ci = 0; ci < colStarts.length; ci++) {
      const lx = colStarts[ci], ly = rowStarts[ri_];
      const lw = Math.min(lotW, GW - MARGIN - lx), lh = Math.min(lotH, GH - MARGIN - ly);
      if (lw < 5 || lh < 5) continue;
      // Keep the player deploy strip (bottom-centre) and a far-edge zone clear-ish.
      const deployLot = ri_ === rowStarts.length - 1 && Math.abs((lx + lw / 2) - GW / 2) < lotW;
      const r = rng();
      if (deployLot) stampPlaza(lx, ly, lw, lh);
      else if (r < 0.42) stampBuilding(lx, ly, lw, lh);
      else if (r < 0.60) stampCompound(lx, ly, lw, lh);
      else if (r < 0.78) stampPlaza(lx, ly, lw, lh);
      else if (r < 0.90) stampPark(lx, ly, lw, lh);
      else stampPlatform(lx, ly, lw, lh);
    }
  }

  // ---- 3. STREET FURNITURE: dribble cover into the open roads so avenues are
  // tactical lanes, not empty corridors (cars, barricades, checkpoints).
  const streetProps = Math.round(GW * GH * 0.012);
  for (let i = 0, t = 0; i < streetProps && t < streetProps * 12; t++) {
    const x = 2 + ri(GW - 4), y = 4 + ri(GH - 8);
    if (!isFloor(x, y)) continue;
    // only on open road (a floor tile with floor on opposite sides = a lane)
    const openH = isFloor(x - 1, y) && isFloor(x + 1, y);
    const openV = isFloor(x, y - 1) && isFloor(x, y + 1);
    if (!openH && !openV) continue;
    cover(x, y, 0.45);
    if (rng() < 0.4) cover(x + (openH ? 0 : 1), y + (openH ? 1 : 0), 0.4); // a paired car/barrier
    i++;
  }

  const walkable = (x, y) => inB(x, y) && (grid[y][x] === 0 || grid[y][x] === 4 || grid[y][x] === 8);
  const taken = new Set();
  function snap(x, y) {
    for (let r = 0; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (walkable(nx, ny) && !taken.has(nx + "," + ny)) { taken.add(nx + "," + ny); return { x: nx, y: ny }; }
    }
    return { x, y };
  }

  // Player deploy: bottom-centre street, spread across the open lane.
  // Uses spec.squad when provided (regen of an existing game's roster), else
  // the fixed 5-class SQUAD (fresh campaign generation).
  const squad = (spec.squad && spec.squad.length) ? spec.squad : SQUAD;
  const players = squad.map((s, i) => {
    const p = snap(Math.floor(GW / 2) - 4 + i * 2, GH - 3);
    return Object.assign({}, s, { x: p.x, y: p.y });
  });

  // Enemy pods: distributed across the plot (top, flanks, mid-lots) — never one line.
  const zones = [
    [Math.floor(GW * 0.16), 4], [Math.floor(GW * 0.82), 4], [Math.floor(GW * 0.5), Math.floor(GH * 0.22)],
    [4, Math.floor(GH * 0.38)], [GW - 5, Math.floor(GH * 0.38)], [Math.floor(GW * 0.3), Math.floor(GH * 0.16)],
    [Math.floor(GW * 0.7), Math.floor(GH * 0.18)], [Math.floor(GW * 0.5), Math.floor(GH * 0.46)],
    [Math.floor(GW * 0.2), Math.floor(GH * 0.55)], [Math.floor(GW * 0.8), Math.floor(GH * 0.55)],
  ];
  // Enemy roster: reposition spec.enemyTemplates when regenerating an existing
  // game (preserves each enemy's stats), else build fresh from spec.mix + ARCH.
  let roster;
  if (spec.enemyTemplates && spec.enemyTemplates.length) {
    roster = spec.enemyTemplates.map((e) => Object.assign({}, e));
  } else {
    roster = [];
    for (let i = 0; i < spec.enemies; i++) {
      const kind = spec.mix[i % spec.mix.length];
      roster.push(Object.assign({ id: "e_" + kind + "_" + i }, ARCH[kind]));
    }
  }
  const enemies = roster.map((e, i) => {
    const z = zones[i % zones.length];
    const jitter = (n) => n + (ri(6) - 3);
    const p = snap(jitter(z[0]), Math.max(1, jitter(z[1])));
    return Object.assign(e, { x: p.x, y: p.y });
  });

  // Connectivity: BFS from a player tile; snap any unreachable unit onto reachable floor.
  function reachable(sx, sy) {
    const seen = new Set([sx + "," + sy]), q = [[sx, sy]];
    while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + "," + ny; if (walkable(nx, ny) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); } } }
    return seen;
  }
  let reach = reachable(players[0].x, players[0].y);
  for (const u of [...players, ...enemies]) {
    if (reach.has(u.x + "," + u.y)) continue;
    for (let r = 1; r < 50 && !reach.has(u.x + "," + u.y); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = u.x + dx, ny = u.y + dy, k = nx + "," + ny;
      if (reach.has(k) && !taken.has(k)) { taken.delete(u.x + "," + u.y); u.x = nx; u.y = ny; taken.add(k); break; }
    }
  }
  reach = reachable(players[0].x, players[0].y);
  const allReach = [...players, ...enemies].every((u) => reach.has(u.x + "," + u.y));

  // Objective tiles (reachable floor): central terminal for "hack", a 3-pad evac near far edge.
  let goal = null;
  const reachList = [...reach].map((k) => k.split(",").map(Number));
  const nearestReach = (tx, ty) => reachList.reduce((best, [x, y]) => {
    const d = Math.abs(x - tx) + Math.abs(y - ty); return d < best.d ? { x, y, d } : best;
  }, { x: players[0].x, y: players[0].y, d: 1e9 });
  if (spec.goal && spec.goal.type === "hack") {
    const c = nearestReach(Math.floor(GW / 2), Math.floor(GH / 2));
    goal = { type: "hack", turnLimit: spec.goal.turnLimit, target: { x: c.x, y: c.y } };
  } else if (spec.goal && spec.goal.type === "evac") {
    const cx = Math.floor(GW / 2), pads = [];
    for (let off = 0; off < 9 && pads.length < 3; off++) {
      const c = nearestReach(cx + (off % 2 ? off : -off), 2 + (off % 3));
      if (!pads.some((p) => p.x === c.x && p.y === c.y)) pads.push({ x: c.x, y: c.y });
    }
    goal = { type: "evac", turnLimit: spec.goal.turnLimit, evac: pads };
  }

  const m = { name: spec.name, objective: spec.objective, grid, player_units: players, enemy_units: enemies };
  if (hasUpper) m.upper = upper; // FLOOR-1 second-storey grid (omitted on single-floor maps)
  if (goal) m.goal = goal;
  return { mission: m, allReach, goal, GW, GH };
}

// ── --regen <content.json>: restructure an EXISTING tactics game's maps onto
// the parcel/plot model in place (preserving each mission's name/objective/goal,
// squad, and enemy stats — only the GRID + positions are regenerated). This is
// what the build pipeline calls so tactics games ship XCOM-structured without a
// human (or an LLM) hand-drawing tile grids. Connectivity-verified before write.
if (process.argv.includes("--regen")) {
  const cp = process.argv[process.argv.indexOf("--regen") + 1];
  if (!cp) { console.error("usage: gen_campaign.cjs --regen <content.json>"); process.exit(2); }
  const content = JSON.parse(fs.readFileSync(cp, "utf8"));
  const single = !content.missions;
  const ms = content.missions || [content];
  const slug = content.slug || "tactics";
  let ok = true;
  const regen = ms.map((m, i) => {
    if (!m.grid || !m.grid.length) return m; // not a tactics mission — leave it
    const GW0 = m.grid[0].length, GH0 = m.grid.length;
    // XCOM-scale plot. Research (state/research_xcom_design.json -> map_size) says a
    // 24-40 tile grid is the faithful analog of one EU abduction map; the owner wants
    // LARGE maps that "take a while to cross", so we lean to the top of that range and
    // grow per mission — WITHOUT returning to the old 58x48 that made units tiny dots.
    const GW = Math.min(Math.max(GW0, 36), 42 + i), GH = Math.min(Math.max(GH0, 30), 34 + i);
    let seed = 0x9e3779b9; const key = slug + ":" + i; for (let k = 0; k < key.length; k++) seed = (Math.imul(seed, 131) + key.charCodeAt(k)) >>> 0;
    const r = buildMission({
      name: m.name, objective: m.objective, w: GW, h: GH, seed,
      squad: m.player_units, enemyTemplates: m.enemy_units, goal: m.goal,
    });
    if (!r.allReach) ok = false;
    const nm = { name: m.name, objective: m.objective, grid: r.mission.grid, player_units: r.mission.player_units, enemy_units: r.mission.enemy_units };
    if (r.mission.upper) nm.upper = r.mission.upper; // carry the FLOOR-1 second storey
    if (m.goal) nm.goal = r.mission.goal || m.goal;
    const cov = r.mission.grid.flat().filter((t) => t === 2 || t === 3).length;
    const up = r.mission.upper ? r.mission.upper.flat().filter((t) => t === 9 || t === 8).length : 0;
    const stairs = r.mission.upper ? r.mission.upper.flat().filter((t) => t === 8).length : 0;
    console.log(`  ${String(m.name || ("mission " + i)).padEnd(22)} ${GW}x${GH}  cover ${((cov / (GW * GH)) * 100).toFixed(1)}%  2F:${up}(${stairs} stairs)  reach:${r.allReach}`);
    return nm;
  });
  if (!ok) { console.error("ABORT --regen: a mission failed connectivity — original left untouched."); process.exit(1); }
  if (single) { Object.assign(content, regen[0]); } else { content.missions = regen; }
  fs.writeFileSync(cp, JSON.stringify(content, null, 2));
  console.log(`regenerated ${regen.length} tactics mission(s) onto the parcel/plot model -> ${cp}`);
  process.exit(0);
}

const out = [];
let okAll = true;
for (const spec of MISSIONS) {
  const r = buildMission(spec);
  out.push(r.mission);
  if (!r.allReach) okAll = false;
  const flat = r.mission.grid.flat();
  const floor = flat.filter((t) => t === 0 || t === 4).length;
  const cov = flat.filter((t) => t === 2 || t === 3).length;
  const wall = flat.filter((t) => t === 1).length;
  const pct = (n) => ((n / flat.length) * 100).toFixed(1);
  const gtxt = r.goal ? `  goal:${r.goal.type}${r.goal.turnLimit ? "(≤" + r.goal.turnLimit + "t)" : ""}${r.goal.target ? " term@" + r.goal.target.x + "," + r.goal.target.y : ""}${r.goal.evac ? " evac×" + r.goal.evac.length : ""}` : "";
  console.log(`${spec.name.padEnd(20)} ${r.GW}x${r.GH}=${String(flat.length).padStart(4)}  enemies ${r.mission.enemy_units.length}  wall ${pct(wall)}%  cover ${pct(cov)}%  floor ${pct(floor)}%  reach:${r.allReach}${gtxt}`);
}
console.log("\nall missions connected:", okAll);

if (process.argv.includes("--write")) {
  if (!okAll) { console.error("ABORT: a mission failed connectivity — not writing."); process.exit(1); }
  const p = path.resolve(__dirname, "../../../games/void-skirmish-3d/content.json");
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.missions = out;
  fs.writeFileSync(p, JSON.stringify(c, null, 2));
  console.log("wrote", out.length, "missions ->", p);
} else if (process.argv.includes("--print")) {
  const g = out[Number(process.argv[process.argv.indexOf("--print") + 1]) || 0].grid;
  const ch = { 0: "·", 1: "█", 2: "▒", 3: "▓", 4: "☣" };
  console.log("\n" + g.map((r) => r.map((t) => ch[t]).join("")).join("\n"));
}
