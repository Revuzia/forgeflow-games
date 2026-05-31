#!/usr/bin/env node
/**
 * Generate the full 7-mission Void Skirmish CAMPAIGN as large, OPEN, escalating
 * urban maps — every mission deploys the SAME fixed 5-class squad (so the
 * persistent roster + class abilities carry through the whole campaign) and
 * faces a progressively larger, tougher enemy force.
 *
 * Tiles: 0 floor, 1 building/wall, 2 half-cover, 3 full-cover, 4 hazard.
 * Each mission is seeded for layout variety, then connectivity-verified before
 * writing into games/void-skirmish-3d/content.json (missions[]).
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

// XCOM-scale plots (toward ~64×64). The cinematic camera sits close, so the
// player scrolls/WASD-glides across the sector over several turns — the map is
// not meant to be seen all at once.
const MISSIONS = [
  { name: "Downtown Insertion", objective: "Eliminate all hostile contacts across the downtown sector.", w: 48, h: 38, enemies: 10, mix: ["drone", "drone", "stalker", "sniper", "defender"], seed: 0xA1 },
  { name: "Market Sweep", objective: "Clear the open market plaza of the alien advance party.", w: 50, h: 40, enemies: 11, mix: ["drone", "stalker", "stalker", "sniper", "defender"], seed: 0xB7 },
  { name: "Rail Yard", objective: "Secure the rail yard and destroy the hostile garrison.", w: 54, h: 42, enemies: 12, mix: ["drone", "stalker", "sniper", "sniper", "defender"], seed: 0xC3 },
  { name: "Power Substation", objective: "Hold the substation approaches and wipe the defenders.", w: 56, h: 44, enemies: 13, mix: ["stalker", "sniper", "defender", "defender", "drone"], seed: 0xD9 },
  { name: "Old Town Siege", objective: "Push through Old Town against entrenched resistance.", w: 58, h: 48, enemies: 14, mix: ["stalker", "stalker", "sniper", "defender", "defender"], seed: 0xE5 },
  { name: "Spire Approach", objective: "Break the cordon guarding the spire approach.", w: 60, h: 52, enemies: 15, mix: ["sniper", "sniper", "defender", "defender", "stalker"], seed: 0xF2 },
  { name: "Avatar Spire", objective: "Assault the spire and shatter the Avatar Project.", w: 64, h: 56, enemies: 17, mix: ["defender", "defender", "sniper", "sniper", "stalker", "stalker"], seed: 0x5C },
];

function buildMission(spec) {
  const GW = spec.w, GH = spec.h, rng = mulberry32(spec.seed >>> 0);
  const ri = (n) => (rng() * n) | 0;
  const grid = Array.from({ length: GH }, () => Array(GW).fill(0));
  const inB = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;

  // Building clusters: lay rectangles on a loose block grid, leaving open streets
  // (margin) between them; ~40% are hollow + enterable (door gap on a random side).
  const blockW = 9, blockH = 8;
  for (let by = 3; by < GH - 8; by += blockH) {
    for (let bx = 3; bx < GW - 4; bx += blockW) {
      if (rng() < 0.18) continue; // some blocks are open plaza
      const w = 4 + ri(3), h = 3 + ri(3);
      const x0 = bx + ri(2), y0 = by + ri(2);
      const hollow = rng() < 0.45 && w >= 4 && h >= 4;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inB(x, y)) grid[y][x] = 1;
      if (hollow) {
        for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) if (inB(x, y)) grid[y][x] = 0;
        const side = ri(4), cx = x0 + (w >> 1), cy = y0 + (h >> 1);
        if (side === 0 && inB(cx, y0)) grid[y0][cx] = 0;
        else if (side === 1 && inB(cx, y0 + h - 1)) grid[y0 + h - 1][cx] = 0;
        else if (side === 2 && inB(x0, cy)) grid[cy][x0] = 0;
        else if (inB(x0 + w - 1, cy)) grid[cy][x0 + w - 1] = 0;
      }
    }
  }

  // Cover clusters scattered on open floor (pairs/triples with sightlines between).
  const coverCount = Math.round(GW * GH * 0.018);
  let placed = 0, tries = 0;
  while (placed < coverCount && tries++ < coverCount * 20) {
    const x = 2 + ri(GW - 4), y = 4 + ri(GH - 10);
    if (grid[y][x] !== 0) continue;
    // bias toward standing next to a building (street cover)
    const nearWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some((d) => inB(x + d[0], y + d[1]) && grid[y + d[1]][x + d[0]] === 1);
    if (!nearWall && rng() < 0.4) continue;
    grid[y][x] = rng() < 0.45 ? 3 : 2; placed++;
    if (rng() < 0.5) { const dx = ri(3) - 1, dy = ri(3) - 1; if (inB(x + dx, y + dy) && grid[y + dy][x + dx] === 0) grid[y + dy][x + dx] = rng() < 0.4 ? 3 : 2; }
  }

  // Hazard tiles (sparse, mid-map).
  for (let i = 0; i < 2 + ri(3); i++) { const x = 4 + ri(GW - 8), y = 6 + ri(GH - 12); if (grid[y][x] === 0) grid[y][x] = 4; }

  const walkable = (x, y) => inB(x, y) && (grid[y][x] === 0 || grid[y][x] === 4);
  const taken = new Set();
  function snap(x, y) {
    for (let r = 0; r < 16; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (walkable(nx, ny) && !taken.has(nx + "," + ny)) { taken.add(nx + "," + ny); return { x: nx, y: ny }; }
    }
    return { x, y };
  }

  // Player deploy: bottom-centre, spread across the open street.
  const players = SQUAD.map((s, i) => {
    const p = snap(Math.floor(GW / 2) - 4 + i * 2, GH - 3);
    return Object.assign({}, s, { x: p.x, y: p.y });
  });

  // Enemy pods: spread across the top + flanks + mid (not one firing line).
  const zones = [
    [Math.floor(GW * 0.18), 3], [Math.floor(GW * 0.78), 3], [Math.floor(GW * 0.5), Math.floor(GH * 0.28)],
    [3, Math.floor(GH * 0.42)], [GW - 4, Math.floor(GH * 0.42)], [Math.floor(GW * 0.32), Math.floor(GH * 0.2)],
    [Math.floor(GW * 0.66), Math.floor(GH * 0.22)],
  ];
  const enemies = [];
  for (let i = 0; i < spec.enemies; i++) {
    const kind = spec.mix[i % spec.mix.length];
    const z = zones[i % zones.length];
    const jitter = (n) => n + (ri(5) - 2);
    const p = snap(jitter(z[0]), Math.max(1, jitter(z[1])));
    enemies.push(Object.assign({ id: "e_" + kind + "_" + i }, ARCH[kind], { x: p.x, y: p.y }));
  }

  // Connectivity: BFS from a player tile, snap any unreachable unit onto a
  // reachable floor tile so every fight is winnable.
  function reachable(sx, sy) {
    const seen = new Set([sx + "," + sy]), q = [[sx, sy]];
    while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + "," + ny; if (walkable(nx, ny) && !seen.has(k)) { seen.add(k); q.push([nx, ny]); } } }
    return seen;
  }
  let reach = reachable(players[0].x, players[0].y);
  for (const u of [...players, ...enemies]) {
    if (reach.has(u.x + "," + u.y)) continue;
    for (let r = 1; r < 40 && !reach.has(u.x + "," + u.y); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = u.x + dx, ny = u.y + dy, k = nx + "," + ny;
      if (reach.has(k) && !taken.has(k)) { taken.delete(u.x + "," + u.y); u.x = nx; u.y = ny; taken.add(k); break; }
    }
  }
  reach = reachable(players[0].x, players[0].y);
  const allReach = [...players, ...enemies].every((u) => reach.has(u.x + "," + u.y));

  return { mission: { name: spec.name, objective: spec.objective, grid, player_units: players, enemy_units: enemies }, allReach, GW, GH };
}

const out = [];
let okAll = true;
for (const spec of MISSIONS) {
  const r = buildMission(spec);
  out.push(r.mission);
  if (!r.allReach) okAll = false;
  const floor = r.mission.grid.flat().filter((t) => t === 0 || t === 4).length;
  console.log(`${spec.name.padEnd(20)} ${r.GW}x${r.GH}  enemies ${r.mission.enemy_units.length}  floor ${floor}  reachable:${r.allReach}`);
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
  console.log("\n" + out[0].grid.map((r) => r.join("")).join("\n"));
}
