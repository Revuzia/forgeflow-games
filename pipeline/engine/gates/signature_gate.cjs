/**
 * signature_gate.cjs — Layer-4 signature-mechanic gate (headless, Node).
 *
 * Asserts that the genre's DEFINING mechanic actually does something — the gate
 * that would have caught echoes-of-the-rift shipping a screen-tint instead of a
 * real dual-realm mechanic, and barrel/shroud shipping hollow systems.
 *
 * It loads the fixed sim core (side-effect registers globalThis.FFG.sim) and the
 * game's content.json, builds the real first mission, and runs scripted probes.
 *
 * Usage:
 *   node signature_gate.cjs <content.json> [genre]
 * Exit 0 = signature mechanic verified, 1 = failed.
 *
 * (.cjs so Node treats it as CommonJS even though the package is type:module.)
 */
const fs = require("fs");
const path = require("path");

const RUNTIME = path.resolve(__dirname, "..", "runtime");

function loadSim(file) {
  // The sim files set globalThis.FFG.* as a side effect (universal pattern).
  require(path.join(RUNTIME, file));
  return globalThis.FFG.sim;
}

function approxEqual(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

// ── tactics signature probes ────────────────────────────────────────────────
function testTactics(content) {
  const sim = loadSim("sim/tactical_grid.js");
  const TB = sim.TacticalBattle;
  const m = (content.missions && content.missions[0]) || content;
  const fails = [];
  const checks = [];
  function check(name, cond, detail) { checks.push({ name, pass: !!cond, detail: detail || "" }); if (!cond) fails.push(name + (detail ? " — " + detail : "")); }

  // Build from the ACTUAL game content (forced-hit rng so damage is deterministic).
  function build(rng) {
    return new TB({ grid: m.grid, player_units: m.player_units, enemy_units: m.enemy_units, rng: rng || (() => 0.0) });
  }

  // 1) Grid movement is genuinely path-constrained.
  let b = build();
  const u = b.player_units[0];
  const reach = b.reachableTiles(u);
  check("movement.reachable_nonempty", reach.length > 0, "unit can reach " + reach.length + " tiles");
  check("movement.respects_budget", reach.every(r => r.cost <= u.movement), "max cost " + Math.max.apply(null, reach.map(r => r.cost)));
  check("movement.no_walls", reach.every(r => b.grid[r.y][r.x] !== 1 && b.grid[r.y][r.x] !== 3), "no tile is a wall/full-cover");
  // cannot move to an unreachable far tile
  const farMove = b.moveUnit(u.id, b.gridW - 1, u.y);
  check("movement.rejects_unreachable", farMove === null, "move to far edge rejected");
  // can move to a reachable tile, costs an action point
  const apBefore = u.actionPoints;
  const okMove = b.moveUnit(u.id, reach[0].x, reach[0].y);
  check("movement.valid_move_works", okMove !== null && u.actionPoints === apBefore - 1, "AP " + apBefore + "->" + u.actionPoints);

  // 2) Cover reduces hit chance (the tactical core of the genre).
  b = build();
  // find a full-cover tile and an adjacent floor tile to stand a dummy target on
  let coverProbe = null;
  for (let y = 1; y < b.gridH - 1 && !coverProbe; y++) {
    for (let x = 1; x < b.gridW - 1; x++) {
      if (b.grid[y][x] === 3) {
        const adj = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].find(p => b.grid[p[1]] && b.grid[p[1]][p[0]] === 0);
        if (adj) { coverProbe = { cover: [x, y], stand: adj }; break; }
      }
    }
  }
  if (coverProbe) {
    const covered = { x: coverProbe.stand[0], y: coverProbe.stand[1] };
    // Place the attacker BEYOND the cover, in the cover's direction, so the
    // cover sits between attacker and target.
    const cdx = coverProbe.cover[0] - covered.x, cdy = coverProbe.cover[1] - covered.y;
    const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
    const attacker = {
      x: clamp(covered.x + cdx * 3, b.gridW - 1),
      y: clamp(covered.y + cdy * 3, b.gridH - 1),
      range: 30, aim: 0.85,
    };
    const coveredChance = b.calculateHitChance(attacker, covered);
    // same-distance attacker vs an open target (no adjacent cover)
    const openSpot = findOpenTile(b);
    const openAtk = { x: clamp(openSpot.x - 3, b.gridW - 1), y: openSpot.y, range: 30, aim: 0.85 };
    const openChance = b.calculateHitChance(openAtk, openSpot);
    check("cover.reduces_hitchance", coveredChance < openChance, "covered " + coveredChance.toFixed(2) + " < open " + openChance.toFixed(2));
  } else {
    check("cover.present_in_map", false, "no full-cover tile with an adjacent floor — map has no usable cover");
  }

  // 3) Attacks deal damage (forced hit) and respect def.
  b = build(() => 0.0); // always-hit roll
  const atk = b.player_units[0];
  const tgt = b.enemy_units[0];
  // place attacker adjacent + clear LOS by teleport for the probe
  atk.x = tgt.x; atk.y = tgt.y - 1 >= 0 ? tgt.y - 1 : tgt.y + 1;
  atk.range = 30; atk.actionPoints = 2;
  const hpBefore = tgt.hp;
  const res = b.attackUnit(atk.id, tgt.id);
  check("combat.attack_hits", res.success && res.hit === true, JSON.stringify(res));
  check("combat.deals_damage", tgt.hp < hpBefore, hpBefore + "->" + tgt.hp);
  check("combat.damage_formula", res.hit ? res.damage === Math.max(1, atk.atk - tgt.def) : true, "dmg " + res.damage);

  // 4) Win condition fires when all enemies are eliminated.
  b = build(() => 0.0);
  let ended = null;
  b.onEnd = (r) => { ended = r; };
  // brute-force: keep attacking the nearest enemy with an overpowered probe unit
  const hero = b.player_units[0];
  hero.atk = 999; hero.range = 99; hero.movement = 99;
  let guard = 0;
  while (!b.ended && guard++ < 200) {
    const e = b.aliveEnemies()[0];
    if (!e) break;
    hero.actionPoints = 2;
    // ensure LOS by lining up (teleport probe — we're testing the END rule, not pathing)
    if (!b.hasLineOfSight(hero.x, hero.y, e.x, e.y)) { hero.x = e.x; hero.y = Math.max(0, e.y - 1); }
    const r = b.attackUnit(hero.id, e.id);
    if (!r.success) { hero.x = e.x; hero.y = (e.y + 1 < b.gridH) ? e.y + 1 : e.y - 1; }
    if (b.ended) break;
    if (hero.actionPoints <= 0) b.currentPhase === "player" && (hero.actionPoints = 2);
  }
  check("win.victory_on_elimination", b.ended && ended && ended.victory === true, "ended=" + b.ended + " victory=" + (ended && ended.victory));

  // 5) Turn phases refill AP and alternate.
  b = build();
  b.player_units.forEach(p => p.actionPoints = 0);
  b.endTurn(); // player->enemy->(resolves)->player
  check("turns.ap_refilled", b.player_units.every(p => p.actionPoints === p.maxAP), "ap after round restored");

  return { fails, checks };
}

function findOpenTile(b) {
  for (let y = 1; y < b.gridH - 1; y++) {
    for (let x = 3; x < b.gridW - 1; x++) {
      if (b.grid[y][x] !== 0) continue;
      const neigh = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      if (neigh.every(p => { const t = b.grid[p[1]] && b.grid[p[1]][p[0]]; return t !== 2 && t !== 3; })) return { x, y, range: 30, aim: 0.85 };
    }
  }
  return { x: 5, y: 1, range: 30, aim: 0.85 };
}

// ── battleship signature probes ──────────────────────────────────────────────
function testBattleship(content) {
  const sim = loadSim("sim/battleship.js");
  const B = sim.Battleship;
  const setup = content.setup || content;
  const N = setup.board_size;
  const fails = [];
  const checks = [];
  function check(name, cond, detail) { checks.push({ name, pass: !!cond, detail: detail || "" }); if (!cond) fails.push(name + (detail ? " — " + detail : "")); }
  function build() { return new B({ size: N, fleet: setup.fleet, seed: content.seed != null ? content.seed : 4242, player_placements: setup.player_placements, enemy_placements: setup.enemy_placements }); }
  function boardCells(board) {
    let n = 0; const seen = new Set();
    for (const s of board.ships) for (const c of s.cells) {
      if (c.x < 0 || c.y < 0 || c.x >= N || c.y >= N) return -1;
      const k = c.x + "," + c.y; if (seen.has(k)) return -2; seen.add(k); n++;
    }
    return n;
  }
  function countShots(b) { let n = 0; for (const row of b.shots) for (const v of row) if (v !== 0) n++; return n; }

  const totalCells = setup.fleet.reduce((a, f) => a + f.len, 0);
  let g = build();

  // 1) legal placement on both boards
  check("placement.player_legal", boardCells(g.player) === totalCells, "cells=" + boardCells(g.player) + " expect " + totalCells);
  check("placement.enemy_legal", boardCells(g.enemy) === totalCells, "cells=" + boardCells(g.enemy));
  check("placement.fleet_count", g.player.ships.length === setup.fleet.length && g.enemy.ships.length === setup.fleet.length, "");

  // 2) fire resolves hit / repeat-invalid / miss
  const c0 = g.enemy.ships[0].cells[0];
  const r1 = g.fire("player", c0.x, c0.y);
  check("fire.hit_on_ship", r1.result === "hit" || r1.result === "sink", r1.result);
  const r2 = g.fire("player", c0.x, c0.y);
  check("fire.repeat_invalid", r2.result === "invalid", r2.result);
  let empty = null;
  for (let y = 0; y < N && !empty; y++) for (let x = 0; x < N; x++) if (g.enemy.grid[y][x] === -1 && g.enemy.shots[y][x] === 0) { empty = { x, y }; break; }
  check("fire.miss_on_empty", empty && g.fire("player", empty.x, empty.y).result === "miss", "");

  // 3) sinking a full ship reports 'sink'
  g = build();
  let last = null;
  for (const c of g.enemy.ships[0].cells) last = g.fire("player", c.x, c.y);
  check("fire.sink_full_ship", last && last.result === "sink", last && last.result);

  // 4) the AI's hunt/target genuinely beats random
  g = build();
  let guard = 0;
  while (g.alive("player") > 0 && !g.ended && guard++ < N * N + 5) g._aiTurn();
  const aiShots = countShots(g.player);
  const cap = Math.floor(N * N * 0.7);
  const randomExp = Math.round(N * N * 0.94);
  check("ai.hunt_target_beats_random", g.alive("player") === 0 && aiShots <= cap,
    "AI cleared player fleet in " + aiShots + " shots (cap " + cap + ", random~" + randomExp + ")");

  // 5) win detection
  g = build();
  for (const ship of g.enemy.ships) for (const c of ship.cells) if (!g.ended) g.fire("player", c.x, c.y);
  check("win.player_wins_on_clear", g.ended && g.winner === "player", "ended=" + g.ended + " winner=" + g.winner);

  return { fails, checks };
}

const TESTS = { tactics: testTactics, battleship: testBattleship };

function main() {
  const contentArg = process.argv[2];
  if (!contentArg) { console.log("usage: node signature_gate.cjs <content.json> [genre]"); process.exit(2); }
  let content;
  try { content = JSON.parse(fs.readFileSync(contentArg, "utf8")); }
  catch (e) { console.log("[signature_gate] FAIL — cannot read content:", e.message); process.exit(1); }
  const genre = process.argv[3] || content.genre;
  const test = TESTS[genre];
  if (!test) { console.log("[signature_gate] SKIP — no signature test for genre '" + genre + "' yet"); process.exit(0); }

  const { fails, checks } = test(content);
  console.log("[signature_gate] genre=" + genre + "  " + (fails.length ? "FAIL" : "PASS"));
  checks.forEach(c => console.log("  " + (c.pass ? "PASS" : "FAIL") + "  " + c.name + (c.detail ? "  (" + c.detail + ")" : "")));
  if (fails.length) { process.exit(1); }
  process.exit(0);
}

main();
