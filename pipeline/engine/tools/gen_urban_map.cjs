#!/usr/bin/env node
/**
 * Generate a large, OPEN XCOM-scale urban map for the void-skirmish tactics game.
 * Tiles: 0 floor, 1 building/wall, 2 half-cover, 3 full-cover, 4 hazard.
 * Design goals (from XCOM map research + user "FULL screen, not one room"):
 *  - NO solid border ring — open street edges so the map reads as a city block.
 *  - Open streets + plazas connecting discrete building clusters (path AROUND).
 *  - Some buildings hollow + enterable (door gap); others solid.
 *  - Clustered cover along streets with sightlines between cover islands.
 *  - Player deploy zone bottom-centre; enemy pods of 2-3 spread across the map.
 * Output verified for connectivity (BFS over walkable) before writing.
 */
const fs = require("fs");
const path = require("path");

const GW = 40, GH = 28; // wide + tall: ~2.9× the old 23×17 area
const grid = Array.from({ length: GH }, () => Array(GW).fill(0));
const inB = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;

// ── Buildings ────────────────────────────────────────────────────────────────
// [x, y, w, h, hollow, doorSide]  doorSide: "N"|"S"|"E"|"W" (gap in that wall)
const BUILDINGS = [
  // top band
  [4, 4, 7, 5, true, "S"],
  [15, 3, 6, 5, false, null],
  [25, 4, 8, 5, true, "S"],
  [35, 5, 3, 4, false, null],
  // mid band
  [3, 12, 6, 6, true, "E"],
  [13, 12, 5, 4, false, null],
  [22, 12, 7, 6, true, "W"],
  [33, 13, 4, 4, false, null],
  // lower band
  [7, 20, 7, 4, true, "N"],
  [18, 21, 5, 4, false, null],
  [28, 20, 8, 5, true, "N"],
];

function stampBuilding(x0, y0, w, h, hollow, door) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inB(x, y)) grid[y][x] = 1;
  if (!hollow) return;
  for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) if (inB(x, y)) grid[y][x] = 0;
  const cx = x0 + (w >> 1), cy = y0 + (h >> 1);
  if (door === "N" && inB(cx, y0)) grid[y0][cx] = 0;
  if (door === "S" && inB(cx, y0 + h - 1)) grid[y0 + h - 1][cx] = 0;
  if (door === "W" && inB(x0, cy)) grid[cy][x0] = 0;
  if (door === "E" && inB(x0 + w - 1, cy)) grid[cy][x0 + w - 1] = 0;
}
BUILDINGS.forEach((b) => stampBuilding(...b));

// ── Cover clusters (along streets / in plazas, between buildings) ─────────────
// [x, y, type]
const COVER = [
  // central plaza cover island
  [19, 10, 3], [20, 10, 2], [19, 11, 2],
  // street cover, top
  [12, 6, 2], [13, 6, 3], [23, 7, 2], [24, 8, 3], [33, 4, 2],
  // mid street
  [10, 13, 3], [11, 13, 2], [19, 14, 2], [30, 11, 2], [31, 11, 3], [38, 13, 2],
  // lower approaches
  [5, 19, 2], [15, 19, 3], [16, 19, 2], [25, 22, 2], [26, 22, 3], [36, 19, 2],
  // near player deploy (defensive)
  [16, 24, 2], [23, 24, 2], [13, 25, 3], [27, 25, 3],
];
for (const [x, y, t] of COVER) if (inB(x, y) && grid[y][x] === 0) grid[y][x] = t;

// ── Hazard tiles (sparse, mid-map) ────────────────────────────────────────────
for (const [x, y] of [[20, 16], [21, 16], [9, 9], [30, 17]]) if (inB(x, y) && grid[y][x] === 0) grid[y][x] = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────
const walkable = (x, y) => inB(x, y) && (grid[y][x] === 0 || grid[y][x] === 4);
function nearestWalkable(x, y, taken) {
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (walkable(nx, ny) && !taken.has(nx + "," + ny)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}
function reachableFrom(sx, sy) {
  const seen = new Set([sx + "," + sy]); const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + "," + ny;
      if (walkable(nx, ny) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}

// ── Units ───────────────────────────────────────────────────────────────────
// Player squad deploys bottom-centre, on the open street.
const PLAYERS = [
  { id: "p_vanguard", name: "Vanguard", x: 17, y: 26, hp: 120, atk: 30, def: 15, movement: 4, range: 2, aim: 0.80, tint: "#00aaff", sprite: "vanguard", cls: "vanguard" },
  { id: "p_sentinel", name: "Sentinel", x: 19, y: 26, hp: 80, atk: 45, def: 8, movement: 3, range: 9, aim: 0.78, tint: "#ff8800", sprite: "sentinel", cls: "sharpshooter" },
  { id: "p_medic", name: "Medic", x: 21, y: 26, hp: 70, atk: 20, def: 10, movement: 3, range: 4, aim: 0.72, tint: "#00ff88", sprite: "medic", cls: "specialist" },
  { id: "p_ranger", name: "Ranger", x: 15, y: 26, hp: 95, atk: 38, def: 10, movement: 5, range: 3, aim: 0.80, tint: "#22d3ee", sprite: "vanguard", cls: "ranger" },
  { id: "p_gren", name: "Grenadier", x: 23, y: 26, hp: 110, atk: 34, def: 12, movement: 3, range: 6, aim: 0.74, tint: "#a3e635", sprite: "vanguard", cls: "grenadier" },
];
// Enemy pods spread across the map (top + flanks + mid), not one firing line.
const ENEMIES = [
  // top-left pod
  { id: "e_drone_0", name: "Assault Drone", x: 6, y: 3, hp: 60, atk: 25, def: 5, movement: 4, range: 3, aim: 0.66, ai: "aggressive", tint: "#ff3333", sprite: "drone" },
  { id: "e_stalker_1", name: "Stalker Beast", x: 8, y: 2, hp: 70, atk: 32, def: 6, movement: 6, range: 2, aim: 0.70, ai: "aggressive", tint: "#b86bff", sprite: "stalker" },
  // top-right pod
  { id: "e_sniper_2", name: "Sniper Unit", x: 30, y: 2, hp: 50, atk: 40, def: 3, movement: 2, range: 10, aim: 0.70, ai: "sniper", tint: "#cc0000", sprite: "sniper" },
  { id: "e_defender_3", name: "Defender Bot", x: 32, y: 3, hp: 95, atk: 22, def: 12, movement: 2, range: 2, aim: 0.62, ai: "defensive", tint: "#ff7a3c", sprite: "defender" },
  // far-right flank pod
  { id: "e_drone_4", name: "Assault Drone", x: 37, y: 11, hp: 60, atk: 25, def: 5, movement: 4, range: 3, aim: 0.66, ai: "aggressive", tint: "#ff3333", sprite: "drone" },
  { id: "e_sniper_5", name: "Sniper Unit", x: 38, y: 16, hp: 50, atk: 40, def: 3, movement: 2, range: 10, aim: 0.70, ai: "sniper", tint: "#cc0000", sprite: "sniper" },
  // mid plaza pod (guarding the centre)
  { id: "e_defender_6", name: "Defender Bot", x: 19, y: 9, hp: 95, atk: 22, def: 12, movement: 2, range: 2, aim: 0.62, ai: "defensive", tint: "#ff7a3c", sprite: "defender" },
  { id: "e_stalker_7", name: "Stalker Beast", x: 21, y: 9, hp: 70, atk: 32, def: 6, movement: 6, range: 2, aim: 0.70, ai: "aggressive", tint: "#b86bff", sprite: "stalker" },
  // left flank pod
  { id: "e_drone_8", name: "Assault Drone", x: 2, y: 14, hp: 60, atk: 25, def: 5, movement: 4, range: 3, aim: 0.66, ai: "aggressive", tint: "#ff3333", sprite: "drone" },
];

// snap every unit onto a free walkable tile
const taken = new Set();
function place(u) {
  const p = nearestWalkable(u.x, u.y, taken);
  u.x = p.x; u.y = p.y; taken.add(p.x + "," + p.y);
}
PLAYERS.forEach(place);
ENEMIES.forEach(place);

// ── Connectivity check + repair ───────────────────────────────────────────────
const reach = reachableFrom(PLAYERS[0].x, PLAYERS[0].y);
let repaired = 0;
for (const u of [...PLAYERS, ...ENEMIES]) {
  if (!reach.has(u.x + "," + u.y)) {
    // snap to the nearest tile that IS reachable
    for (let r = 1; r < 30 && !reach.has(u.x + "," + u.y); r++) {
      for (let dy = -r; dy <= r && !reach.has(u.x + "," + u.y); dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = u.x + dx, ny = u.y + dy, k = nx + "," + ny;
        if (reach.has(k) && !taken.has(k)) { taken.delete(u.x + "," + u.y); u.x = nx; u.y = ny; taken.add(k); repaired++; break; }
      }
    }
  }
}
const reach2 = reachableFrom(PLAYERS[0].x, PLAYERS[0].y);
const allReachable = [...PLAYERS, ...ENEMIES].every((u) => reach2.has(u.x + "," + u.y));
const floorCount = grid.flat().filter((t) => t === 0 || t === 4).length;
const reachPct = (reach2.size / floorCount * 100).toFixed(1);

// ── Print + write ──────────────────────────────────────────────────────────────
console.log(grid.map((r) => r.join("")).join("\n"));
console.log(`\nsize ${GW}x${GH}  floor ${floorCount}  reachable ${reach2.size} (${reachPct}%)  repaired ${repaired}`);
console.log("all units reachable:", allReachable);

const mission = {
  name: "Downtown Insertion",
  objective: "Eliminate all hostile contacts across the downtown sector.",
  grid,
  player_units: PLAYERS,
  enemy_units: ENEMIES,
};

if (process.argv.includes("--write")) {
  for (const rel of ["../../../games/void-skirmish-3d/content.json"]) {
    const p = path.resolve(__dirname, rel);
    const c = JSON.parse(fs.readFileSync(p, "utf8"));
    c.missions[0] = mission;
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
    console.log("wrote", p);
  }
}
