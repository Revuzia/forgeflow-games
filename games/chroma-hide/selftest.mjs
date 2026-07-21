/**
 * CHROMA HIDE — static selftest (no browser / no WebGL).
 * Grows one milestone at a time. Gates: files exist, JS parses (node --check),
 * index boots the module + declares fs_hotkey:false, meta slug, and the PURE
 * sim modules (util + match_core) behave correctly.
 *
 * Run: node games/chroma-hide/selftest.mjs   (exit 0 = pass)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (m) => console.log("OK  ", m);
const fail = (m) => { console.error("FAIL", m); fails++; };
function assert(cond, m) { cond ? ok(m) : fail(m); }

// ── files exist ────────────────────────────────────────────────────────────
const files = [
  "index.html",
  "game_meta.json",
  "content.json",
  "game_controls.js",
  "runtime/main.js",
  "runtime/engine.js",
  "runtime/paint.js",
  "runtime/paint_ui.js",
  "runtime/game.js",
  "runtime/ui.js",
  "runtime/maps.js",
  "runtime/audio.js",
  "runtime/net/ffg_netplay.js",
  "runtime/net/chromanet.js",
  "runtime/net/loopback.js",
  "runtime/sim/util.js",
  "runtime/sim/match_core.js",
  "runtime/sim/paint_buffer.js",
  "runtime/sim/match_sim.js",
  "runtime/sim/net_protocol.js",
  "runtime/sim/nav.js",
];
for (const f of files) {
  assert(fs.existsSync(path.join(__dirname, f)), `exists ${f}`);
}

// ── syntax check every JS file (parses, imports not resolved) ───────────────
for (const f of ["game_controls.js", "runtime/main.js", "runtime/engine.js", "runtime/paint.js", "runtime/paint_ui.js", "runtime/game.js", "runtime/ui.js", "runtime/maps.js", "runtime/audio.js", "runtime/net/ffg_netplay.js", "runtime/net/chromanet.js", "runtime/net/loopback.js", "runtime/sim/util.js", "runtime/sim/match_core.js", "runtime/sim/paint_buffer.js", "runtime/sim/match_sim.js", "runtime/sim/net_protocol.js", "runtime/sim/nav.js"]) {
  const r = spawnSync(process.execPath, ["--check", path.join(__dirname, f)], { encoding: "utf8" });
  assert(r.status === 0, `node --check ${f}` + (r.status === 0 ? "" : `: ${(r.stderr || r.stdout || "").trim()}`));
}

// ── index.html boots correctly ──────────────────────────────────────────────
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
assert(html.includes("runtime/main.js") && html.includes("importmap"), "index module boot");
assert(html.includes("fs_hotkey:false"), "index frees F for paint mode (fs_hotkey:false)");
assert(/main\.js\?v=\d+/.test(html), "index cache-busts main.js with ?v=");

// ── game_meta ────────────────────────────────────────────────────────────────
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "game_meta.json"), "utf8"));
assert(meta.slug === "chroma-hide" && meta.title === "CHROMA HIDE", "game_meta slug/title");
assert(Array.isArray(meta.tags) && meta.tags.includes("hide-and-seek"), "game_meta tags");

// ── PURE sim: util.js ────────────────────────────────────────────────────────
const util = await import(pathToFileURL(path.join(__dirname, "runtime/sim/util.js")).href);
assert(util.clamp(5, 0, 3) === 3 && util.clamp(-1, 0, 3) === 0, "util.clamp");
assert(util.formatTime(65) === "1:05" && util.formatTime(9) === "0:09", "util.formatTime");
{
  const rng = util.makeRng(42), rng2 = util.makeRng(42);
  const a = rng(), b = rng2();
  assert(a === b && a >= 0 && a < 1, "util.makeRng deterministic");
}
{
  const c = util.hexToRgb("#3f7d6e");
  const back = util.rgbToHex(c.r, c.g, c.b);
  assert(back === "#3f7d6e", "util hex<->rgb round-trip");
  const hsv = util.rgbToHsv(255, 0, 0);
  assert(Math.round(hsv.h) === 0 && hsv.s === 1 && hsv.v === 1, "util rgbToHsv red");
  const rgb = util.hsvToRgb(120, 1, 1);
  assert(Math.round(rgb.g) === 255 && Math.round(rgb.r) === 0, "util hsvToRgb green");
}

// ── PURE sim: match_core.js ──────────────────────────────────────────────────
const mc = await import(pathToFileURL(path.join(__dirname, "runtime/sim/match_core.js")).href);
assert(mc.computeSeekerCount(4) === 1 && mc.computeSeekerCount(10) === 3 && mc.computeSeekerCount(8) === 2, "seeker count 1-per-4");
{
  const s = mc.sanitizeSettings({ prepSeconds: 200, huntSeconds: 40, startAmmo: 9999, tauntIntervalSeconds: 5 });
  assert(s.prepSeconds === 180 && s.huntSeconds === 90 && s.startAmmo === 999, "sanitizeSettings clamps");
  assert(s.tauntIntervalSeconds === 15, "sanitizeSettings taunt floor");
}
{
  const rng = util.makeRng(7);
  const { seekers, hiders } = mc.assignRoles(["a", "b", "c", "d"], 1, [], rng);
  assert(seekers.size === 1 && hiders.size === 3, "assignRoles 1 seeker / 3 hiders");
  // anti-repeat: last seeker should not seek again when a fresh option exists
  const prev = [...seekers][0];
  const r2 = mc.assignRoles(["a", "b", "c", "d"], 1, [prev], util.makeRng(7));
  assert(![...r2.seekers].includes(prev), "assignRoles anti-repeat");
}
{
  const o = mc.DEFAULTS;
  assert(mc.applyShot(5, { hit: false, fleeing: false, ammoLimit: true, startAmmo: 8 }) === 4, "ammo: miss -1");
  assert(mc.applyShot(5, { hit: true, fleeing: false, ammoLimit: true, startAmmo: 8 }) === 6, "ammo: hit +1");
  assert(mc.applyShot(5, { hit: false, fleeing: true, ammoLimit: true, startAmmo: 8 }) === 5, "ammo: fleeing free");
  assert(mc.applyShot(0, { hit: false, fleeing: false, ammoLimit: true, startAmmo: 8 }) === 0, "ammo floor 0");
  assert(mc.losPoints(0, 1, o) > mc.losPoints(20, 1, o) && mc.losPoints(30, 1, o) === 0, "LOS closer scores more, out-of-range 0");
}
{
  // win checks
  assert(mc.checkWin({ hiders: [{ id: 1, alive: false }], seekers: [{ ammo: 3 }], timeLeft: 50, ammoLimit: true }).winner === "seekers", "win: all found");
  assert(mc.checkWin({ hiders: [{ id: 1, alive: true }], seekers: [{ ammo: 0 }], timeLeft: 50, ammoLimit: true }).winner === "hiders", "win: seekers out of ammo");
  assert(mc.checkWin({ hiders: [{ id: 1, alive: true }], seekers: [{ ammo: 3 }], timeLeft: 0, ammoLimit: true }).winner === "hiders", "win: time survived");
  assert(mc.checkWin({ hiders: [{ id: 1, alive: true }], seekers: [{ ammo: 3 }], timeLeft: 50, ammoLimit: true }) === null, "win: ongoing => null");
}
assert(Object.keys(mc.MODE_INFO).length === 4, "four modes defined");

// ── PURE paint pipeline: paint_buffer.js (the M1 determinism gate) ───────────
const pb = await import(pathToFileURL(path.join(__dirname, "runtime/sim/paint_buffer.js")).href);
const { PaintBuffer, replayStrokes, PAINT_FILLS } = pb;
{
  const a1 = new PaintBuffer(64, PAINT_FILLS.albedo);
  const a2 = new PaintBuffer(64, PAINT_FILLS.albedo);
  assert(a1.hash() === a2.hash(), "paint: blank buffers hash equal");
  const before = a1.hash();
  const dr = a1.stamp(0.5, 0.5, 10, { r: 0, g: 0, b: 0 });
  assert(a1.hash() !== before, "paint: a stamp changes the hash");
  assert(dr.w > 0 && dr.h > 0 && dr.x >= 0 && dr.y >= 0, "paint: stamp returns a dirty rect");
  // out-of-body stamp near an edge stays clamped in-bounds
  const dr2 = a1.stamp(0.99, 0.99, 20, { r: 1, g: 2, b: 3 });
  assert(dr2.x + dr2.w <= 64 && dr2.y + dr2.h <= 64, "paint: dirty rect clamps to buffer");
}
{
  const strokes = [
    { u: 0.30, v: 0.40, size: 8, r: 200, g: 20, b: 20, metal: 0.5, rough: 0.3 },
    { u: 0.60, v: 0.55, size: 12, r: 10, g: 180, b: 90, metal: 0.0, rough: 0.9 },
  ];
  const mk = () => ({ albedo: new PaintBuffer(64, PAINT_FILLS.albedo), metal: new PaintBuffer(64, PAINT_FILLS.metal), rough: new PaintBuffer(64, PAINT_FILLS.rough) });
  const A = mk(), B = mk();
  const hA = replayStrokes(strokes, A.albedo, A.metal, A.rough);
  const hB = replayStrokes(strokes, B.albedo, B.metal, B.rough);
  assert(hA.albedo === hB.albedo && hA.metal === hB.metal && hA.rough === hB.rough, "paint: replaying a stroke list is deterministic (same hashes)");
  const C = mk();
  const hC = replayStrokes([{ u: 0.1, v: 0.1, size: 8, r: 0, g: 0, b: 255, metal: 0, rough: 0.5 }], C.albedo, C.metal, C.rough);
  assert(hC.albedo !== hA.albedo, "paint: different strokes produce different hashes");
  // stroke ORDER matters for OVERLAPPING paint (alpha compositing is order-dependent)
  const ov = [
    { u: 0.5, v: 0.5, size: 16, r: 255, g: 0, b: 0, metal: 0, rough: 0.5 },
    { u: 0.5, v: 0.5, size: 16, r: 0, g: 0, b: 255, metal: 0, rough: 0.5 },
  ];
  const E = mk(), F = mk();
  const hE = replayStrokes(ov, E.albedo, E.metal, E.rough);
  const hF = replayStrokes(ov.slice().reverse(), F.albedo, F.metal, F.rough);
  assert(hE.albedo !== hF.albedo, "paint: overlapping stroke order affects result");
}

// ── maps.js (pure map data) ──────────────────────────────────────────────────
const maps = await import(pathToFileURL(path.join(__dirname, "runtime/maps.js")).href);
const manor = maps.getMap("manor");
assert(manor.id === "manor" && manor.props.length >= 6, "map: manor loaded with cover");
{
  const sm = maps.toSimMap(manor);
  assert(sm.obstacles.length === manor.props.length, "map: toSimMap obstacle per prop");
  assert(sm.spawn.seeker && sm.spawn.hider && sm.spots.length >= 6, "map: toSimMap spawn + spots");
  assert(maps.mapList().length === 3, "map: 3 full-scale campus stages shipped");
  assert(maps.mapList().every((m) => (maps.getMap(m.id).rooms || []).length >= 3), "map: every shipped stage is multi-room (>=3 rooms)");
}
{
  // The Residence: second multi-room map (garage/kitchen/living), GLB-furnished
  const res = maps.getMap("residence");
  assert(res.rooms.length === 3 && res.walls.length === 4 && res.props.filter((p) => p.model).length >= 12, "residence: 3 rooms, walls, GLB furniture");
  const sm = maps.toSimMap(res);
  assert(sm.obstacles.length === res.props.length + res.walls.length && sm.spots.length >= 10, "residence: toSimMap walls+props+spots");
}
for (const id of ["understage", "hollow"]) {
  const m = maps.getMap(id);
  assert(m.id === id && m.props.length >= 5 && m.spots.length >= 6, `map: ${id} authored with cover + spots`);
  const sm = maps.toSimMap(m);
  assert(sm.bounds && sm.obstacles.length === m.props.length && sm.spawn.seeker && sm.spawn.hider, `map: ${id} toSimMap valid`);
  // spawns must be inside bounds
  assert(m.spawn.seeker.x > m.bounds.minX && m.spawn.seeker.x < m.bounds.maxX && m.spawn.hider.z > m.bounds.minZ && m.spawn.hider.z < m.bounds.maxZ, `map: ${id} spawns in bounds`);
}

// ── match_sim.js (full match brain — the M2 gate) ────────────────────────────
const ms = await import(pathToFileURL(path.join(__dirname, "runtime/sim/match_sim.js")).href);
const simMap = () => maps.toSimMap(manor);
function mkMatch(skill, huntSeconds, seed, extra) {
  const players = [{ id: "S", isBot: true, role: "seeker" }, { id: "H1", isBot: true, role: "hider" }, { id: "H2", isBot: true, role: "hider" }];
  return ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode: "normal", prepSeconds: 1, huntSeconds, tauntIntervalSeconds: 0, ...(extra || {}) }, map: simMap(), seed, seekerCount: 1, skill });
}
{
  const players = Array.from({ length: 8 }, (_, i) => ({ id: "p" + i, isBot: true }));
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS }, map: simMap(), seed: 3 });
  assert(ms.seekers(s).length === 2 && ms.hiders(s).length === 6, "sim: 8 players -> 2 seekers / 6 hiders");
}
{
  // Strong seeker (wide FOV, long range, fast identify) catches everyone -> Seeker-win
  const r = ms.runToEnd(mkMatch({ identifyTime: 0.3, detectRange: 80, fovHalf: 4, seekerSpeed: 5 }, 300, 5), 1 / 20);
  assert(r && r.winner === "seekers", "sim: strong seeker -> Seeker-win (" + (r && r.reason) + ")");
}
{
  // Near-blind seeker (tiny range/FOV) can't find anyone before the timer -> Hider-win
  const r = ms.runToEnd(mkMatch({ identifyTime: 5, detectRange: 3, fovHalf: 0.3, seekerSpeed: 3 }, 18, 5), 1 / 20);
  assert(r && r.winner === "hiders" && r.reason === "time_survived", "sim: blind seeker -> Hider-win by survival");
}
{
  // Determinism: same config + seed -> same winner
  const a = ms.runToEnd(mkMatch({ identifyTime: 0.6, detectRange: 55, fovHalf: 3, seekerSpeed: 4 }, 120, 9), 1 / 20);
  const b = ms.runToEnd(mkMatch({ identifyTime: 0.6, detectRange: 55, fovHalf: 3, seekerSpeed: 4 }, 120, 9), 1 / 20);
  assert(a && b && a.winner === b.winner, "sim: deterministic winner for a fixed seed");
}
{
  // Local input drives an actor's position
  const s = mkMatch({ identifyTime: 9, detectRange: 1, fovHalf: 0.1, seekerSpeed: 3 }, 40, 1);
  for (let i = 0; i < 40; i++) ms.stepMatch(s, 1 / 20);   // past 1s prep -> HUNT
  const h = ms.hiders(s)[0]; h.isBot = false; h.isLocal = true; h.x = 0; h.z = 0;  // humans (!isBot) are input-driven
  ms.setLocalInput(s, h.id, { mx: 1, mz: 0 });
  for (let i = 0; i < 20; i++) ms.stepMatch(s, 1 / 20);   // 1s of movement
  assert(h.x > 2 && h.alive, "sim: local input moves the actor");
}

// ── nav.js grid pathfinding (multi-room doorway navigation) ──────────────────
const nav = await import(pathToFileURL(path.join(__dirname, "runtime/sim/nav.js")).href);
{
  // full-height wall, no doorway -> the two sides are disconnected (fallback path)
  const gBlocked = nav.buildNavGrid({ minX: 0, maxX: 10, minZ: 0, maxZ: 6 }, [{ x: 5, z: 3, hw: 0.3, hd: 3.5 }], 1.0, 0.4);
  assert(nav.findPath(gBlocked, 1, 3, 9, 3).length === 1, "nav: fully-walled -> no through-path (fallback)");
  // wall with a doorway gap at the bottom -> a path is found that routes through it
  const gDoor = nav.buildNavGrid({ minX: 0, maxX: 10, minZ: 0, maxZ: 6 }, [{ x: 5, z: 3.5, hw: 0.3, hd: 2.5 }], 1.0, 0.4);
  const p = nav.findPath(gDoor, 1, 3, 9, 3);
  assert(p.length >= 2, "nav: doorway -> path found");
  assert(Math.min(...p.map((w) => w.z)) < 2.2, "nav: path routes through the low doorway");
  assert(Math.hypot(p[p.length - 1].x - 9, p[p.length - 1].z - 3) < 1.6, "nav: path reaches the target");
}
{
  // The Depot: multi-room map, bots must navigate rooms via doorways to a verdict
  const depot = maps.getMap("depot");
  assert(depot.rooms.length === 3 && depot.walls.length === 4 && depot.props.length >= 20, "depot: 3 rooms, interior walls, dense props");
  const sm = maps.toSimMap(depot);
  assert(sm.obstacles.length === depot.props.length + depot.walls.length, "depot: interior walls added to obstacles");
  const players = [{ id: "S", isBot: true, role: "seeker" }, { id: "H1", isBot: true, role: "hider" }, { id: "H2", isBot: true, role: "hider" }, { id: "H3", isBot: true, role: "hider" }];
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode: "normal", prepSeconds: 1, huntSeconds: 150, tauntIntervalSeconds: 0 }, map: sm, seed: 4, seekerCount: 1, skill: { identifyTime: 0.4, detectRange: 70, fovHalf: 3.2, seekerSpeed: 4.5 } });
  assert(s.nav && s.nav.grid.length > 0, "depot: nav grid built at match start");
  // let hiders reach their (dispersed) spots
  for (let i = 0; i < 100; i++) ms.stepMatch(s, 1 / 20);
  const hx = ms.hiders(s).map((h) => h.x);
  assert(Math.max(...hx) - Math.min(...hx) > 6, "depot: hiders disperse across rooms (x-spread " + (Math.max(...hx) - Math.min(...hx)).toFixed(1) + ")");
  const r = ms.runToEnd(s, 1 / 20);
  assert(r && (r.winner === "hiders" || r.winner === "seekers"), "depot: multi-room bot match resolves (" + (r && r.winner) + ")");
}

// ── the ammo economy binds for a HUMAN seeker too ───────────────────────────
// It used to bind only for bots: the human branch of stepSeeker fired with no ammo
// check, so "run the seeker dry and the hiders win" could never trigger against a
// real player — the entire risk half of the seeker loop was inert.
{
  const players = [{ id: "S", isBot: false, role: "seeker" }, { id: "H1", isBot: true, role: "hider" }, { id: "H2", isBot: true, role: "hider" }];
  // shotCooldownMs 1, not 0 — seekerShoot reads `|| 1500`, so a 0 here silently
  // restores the full cooldown and the magazine never empties.
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode: "normal", prepSeconds: 0.2, huntSeconds: 600, tauntIntervalSeconds: 0, ammoLimit: true, startAmmo: 4, shotCooldownMs: 1 }, map: simMap(), seed: 11, seekerCount: 1 });
  for (let i = 0; i < 12; i++) ms.stepMatch(s, 1 / 20);       // clear PREP
  const me = ms.seekers(s)[0];
  for (let i = 0; i < 6; i++) { ms.setLocalInput(s, me.id, { shoot: true }); ms.stepMatch(s, 1 / 20); }
  assert(me.ammo === 0, "human seeker: firing past the magazine empties it (ammo " + me.ammo + ", want 0)");
  assert(s.result && s.result.winner === "hiders",
    "human seeker: running the last seeker dry ends the match for the hiders (" + (s.result && s.result.winner) + ")");

  // Dry-fire itself only observable while the match continues — i.e. with a second
  // seeker still holding ammo. One dry seeker must click, not shoot.
  const p2 = [{ id: "S", isBot: false, role: "seeker" }, { id: "S2", isBot: true, role: "seeker" }, { id: "H1", isBot: true, role: "hider" }, { id: "H2", isBot: true, role: "hider" }];
  const s2 = ms.createMatch({ players: p2, settings: { ...mc.DEFAULTS, mode: "normal", prepSeconds: 0.2, huntSeconds: 600, tauntIntervalSeconds: 0, ammoLimit: true, startAmmo: 3, shotCooldownMs: 1 }, map: simMap(), seed: 12, seekerCount: 2 });
  for (let i = 0; i < 12; i++) ms.stepMatch(s2, 1 / 20);
  const human = ms.seekers(s2).find((a) => !a.isBot);
  for (let i = 0; i < 5; i++) { ms.setLocalInput(s2, human.id, { shoot: true }); ms.stepMatch(s2, 1 / 20); }
  assert(human.ammo === 0, "dry-fire: the human seeker is empty (ammo " + human.ammo + ")");
  s2.events.length = 0;
  ms.setLocalInput(s2, human.id, { shoot: true }); ms.stepMatch(s2, 1 / 20);
  const ev = s2.events.filter((e) => e.by === human.id).map((e) => e.t);
  assert(ev.includes("dryfire") && !ev.includes("miss"),
    "dry-fire: a shot at 0 ammo clicks instead of firing (events " + JSON.stringify(ev) + ")");
}

// ── all four modes reach a valid verdict (M4 gate) ──────────────────────────
for (const mode of ["normal", "infection", "double", "reverse"]) {
  const players = [{ id: "S", isBot: true, role: "seeker" }, { id: "H1", isBot: true, role: "hider" }, { id: "H2", isBot: true, role: "hider" }, { id: "H3", isBot: true, role: "hider" }];
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode, prepSeconds: 1, huntSeconds: 60, tauntIntervalSeconds: 0 }, map: simMap(), seed: 5, seekerCount: 1, skill: { identifyTime: 0.4, detectRange: 70, fovHalf: 3.5, seekerSpeed: 5 } });
  const r = ms.runToEnd(s, 1 / 20);
  assert(r && (r.winner === "hiders" || r.winner === "seekers"), `mode ${mode} reaches a valid verdict (${r && r.winner})`);
}
{
  // Reverse Chicken Race is distinct: everyone hides, then a mark is revealed
  const players = [{ id: "A", isBot: true }, { id: "B", isBot: true }, { id: "C", isBot: true }, { id: "D", isBot: true }];
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode: "reverse", prepSeconds: 1, huntSeconds: 60, tauntIntervalSeconds: 0 }, map: simMap(), seed: 3, seekerCount: 1, skill: { identifyTime: 0.4, detectRange: 70, fovHalf: 3.5, seekerSpeed: 5 } });
  assert(s.actors.every((a) => a.role === "hider"), "reverse: everyone hides during prep");
  for (let i = 0; i < 30; i++) ms.stepMatch(s, 1 / 20);          // 1.5s > 1s prep -> HUNT
  assert(s.reverseMark && s.actors.filter((a) => a.role === "seeker").length === 3, "reverse: one mark revealed, the rest become seekers");
  const r = ms.runToEnd(s, 1 / 20);
  assert(r && (r.winner === "hiders" || r.winner === "seekers"), `reverse resolves (${r && r.winner})`);
}
{
  // Double is distinct: everyone hides in prep, ~half activate as seekers at hunt
  const players = Array.from({ length: 6 }, (_, i) => ({ id: "d" + i, isBot: true }));
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode: "double", prepSeconds: 1, huntSeconds: 60, tauntIntervalSeconds: 0 }, map: simMap(), seed: 8, seekerCount: 2, skill: { identifyTime: 0.4, detectRange: 70, fovHalf: 3.5, seekerSpeed: 5 } });
  assert(s.actors.every((a) => a.role === "hider"), "double: everyone hides during prep");
  for (let i = 0; i < 30; i++) ms.stepMatch(s, 1 / 20);          // 1.5s > 1s prep -> HUNT
  assert(s.actors.filter((a) => a.role === "seeker").length === 3, "double: ~half activated as seekers at hunt");
  const r = ms.runToEnd(s, 1 / 20);
  assert(r && (r.winner === "hiders" || r.winner === "seekers"), `double resolves (${r && r.winner})`);
}

// ── net_protocol.js (wire serialization — the M3 headless surface) ───────────
const np = await import(pathToFileURL(path.join(__dirname, "runtime/sim/net_protocol.js")).href);
{
  const b = np.yawToByte(1.2); assert(Math.abs(np.byteToYaw(b) - 1.2) < 0.05, "net: yaw byte round-trip");
  const a = { x: 3.21, z: -4.56, yaw: 1.0, pose: "crouch", alive: true, caught: false, fleeing: true, hidden: true, role: "seeker", ammo: 5, score: 37 };
  const u = np.unpackActor(np.packActor(a, 2));
  assert(u.idx === 2 && Math.abs(u.x - 3.21) < 0.02 && Math.abs(u.z + 4.56) < 0.02, "net: actor position round-trip");
  assert(u.role === "seeker" && u.alive && u.fleeing && u.hidden && u.ammo === 5 && u.score === 37 && u.pose === "crouch", "net: actor flags round-trip");
}
{
  const state = { phase: "hunt", timeLeft: 42.7, actors: [{ x: 1, z: 2, yaw: 0, pose: "stand", alive: true, caught: false, fleeing: false, hidden: false, role: "hider", ammo: 8, score: 0 }] };
  const u = np.unpackSnapshot(np.packSnapshot(state));
  assert(u.phase === "hunt" && Math.abs(u.timeLeft - 42.7) < 0.11 && u.actors.length === 1 && u.actors[0].role === "hider", "net: snapshot round-trip");
  const st = { u: 0.3, v: 0.7, size: 40, r: 200, g: 30, b: 150, metal: 0.5, rough: 0.8 };
  const su = np.unpackStroke(np.packStroke(st));
  assert(Math.abs(su.u - 0.3) < 0.001 && Math.abs(su.v - 0.7) < 0.001 && su.size === 40 && su.r === 200 && Math.abs(su.metal - 0.5) < 0.01, "net: paint stroke round-trip");
}
{
  const r = np.buildRoster(["peerA", "peerB"], 6, 2, 12345, "peerA");
  assert(r.players.length === 6, "net: roster fills to lobby size");
  assert(r.players.filter((p) => !p.isBot).length === 2 && r.players.filter((p) => p.isBot).length === 4, "net: roster 2 humans + 4 bots");
  assert(r.players.filter((p) => p.role === "seeker").length === 2, "net: roster seekerCount honored");
  assert(r.players.find((p) => p.id === "peerA").isLocal === true, "net: roster marks local player");
}


// ── every referenced model must exist on disk ────────────────────────────────
// A missing GLB used to fail silently: game.js console.warns and leaves the grey
// placeholder box in place, so a car or a tree renders as a flat slab and nothing
// in CI notices. 12 placements across 4 maps shipped that way.
{
  const fs = await import("node:fs");
  // Resolve through import.meta.url — a hand-built Windows path from URL.pathname
  // silently yields empty reads, which would make this guard pass vacuously.
  const rel = (f) => new URL(f, import.meta.url);
  const src = ["runtime/maps.js", "runtime/maps_campus.js", "runtime/mapgen.js"]
    .map((f) => { try { return fs.readFileSync(rel(f), "utf8"); } catch { return ""; } })
    .join(" ");
  const refs = [...new Set([...src.matchAll(/model: *"([^"]+)"/g)].map((m) => m[1]))];
  const missing = refs.filter((r) => !fs.existsSync(rel("assets/models/" + r)));
  assert(refs.length > 0, "model guard: found model references to check (" + refs.length + ")");
  assert(missing.length === 0, "every referenced model exists on disk" +
    (missing.length ? " — MISSING: " + missing.join(", ") : " (" + refs.length + " checked)"));

  // ...and the reverse: shipped bytes must be reachable bytes. 97 models (1.66 MB, 43%
  // of the payload) were once downloaded by every player and placed by no map.
  const walk = (dir, pre) => fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(dir + e.name + "/", pre + e.name + "/") : (e.name.endsWith(".glb") ? [pre + e.name] : []));
  const shipped = walk("assets/models/", "");
  const orphan = shipped.filter((f) => !refs.includes(f));
  assert(orphan.length === 0, "no shipped model is unreachable" +
    (orphan.length ? " — " + orphan.length + " orphaned: " + orphan.slice(0, 6).join(", ") : " (" + shipped.length + " shipped)"));
}


// ── camouflage model ─────────────────────────────────────────────────────────
// Locks in three defects that shipped live: the blend was scored against the nearest
// obstacle CENTRE (a 12m wall you were touching lost to a distant crate), every interior
// wall reported the PERIMETER colour, and coverage was ignored -- one 2-pixel dab of the
// right colour camouflaged an otherwise white body perfectly.
{
  const { MAPS, toSimMap } = await import("./runtime/maps.js");
  const { blendScore, coverRGB } = await import("./runtime/sim/match_sim.js");
  const m = MAPS.office, sim = toSimMap(m);

  const perim = m.perimeter.color;
  const own = m.walls.filter((w) => w.color != null && w.color !== perim);
  assert(own.length > 0, "walls carry their own colour into the sim (" + own.length + " differ from perimeter)");
  const W = own[0];
  const got = coverRGB(sim, W.x, W.z + 0.7);
  const asHex = (got.r << 16) | (got.g << 8) | got.b;
  assert(asHex === W.color, "blending against a wall samples THAT wall (0x" + asHex.toString(16) + " vs 0x" + W.color.toString(16) + ")");

  const at = (rgb, extra = {}) => blendScore(sim, { x: W.x, z: W.z + 0.7, paintRGB: rgb, ...extra });
  const exact = { r: (W.color >> 16) & 255, g: (W.color >> 8) & 255, b: W.color & 255 };
  assert(at(exact) > 0.9, "an exactly matched body blends (" + at(exact).toFixed(2) + ")");
  assert(at({ r: 255, g: 255, b: 255 }) < 0.4, "a white body does not blend against a coloured wall");
  assert(at({ r: 255, g: 42, b: 212 }) === 0, "a magenta body does not blend");
  assert(at(exact, { _moving: true }) < at(exact), "movement breaks camouflage");

  const roughWall = sim.obstacles.find((o) => o.color != null && o.rough != null);
  if (roughWall) {
    const pr = { r: (roughWall.color >> 16) & 255, g: (roughWall.color >> 8) & 255, b: roughWall.color & 255 };
    const spot = { x: roughWall.x, z: roughWall.z + roughWall.hd + 0.5, paintRGB: pr };
    const near = blendScore(sim, { ...spot, paintRough: roughWall.rough, paintMetal: 0 });
    const far = blendScore(sim, { ...spot, paintRough: Math.abs(1 - roughWall.rough), paintMetal: 1 });
    assert(near > far, "matching a surface's finish beats mismatching it (" + near.toFixed(2) + " > " + far.toFixed(2) + ")");
  }
}

// ── the pose set is ONE set everywhere ───────────────────────────────────────
// Bots drew from a literal containing "lie" -- a pose in neither the height table nor
// the renderer -- and the wire codec knew only 4 of the 8 poses, so a flattened,
// clinging player looked upright to every remote client.
{
  const { POSE_IDS, POSE_HEIGHT } = await import("./runtime/sim/match_core.js");
  const { packActor, unpackActor } = await import("./runtime/sim/net_protocol.js");
  const game = fs.readFileSync(new URL("runtime/game.js", import.meta.url), "utf8");
  const rendered = [...game.matchAll(/^  (\w+):\s*\{ label:/gm)].map((x) => x[1]);
  assert(POSE_IDS.every((p) => POSE_HEIGHT[p] != null), "every pose has a silhouette height");
  assert(POSE_IDS.every((p) => rendered.includes(p)),
    "every pose has a render entry — missing: " + POSE_IDS.filter((p) => !rendered.includes(p)).join(", "));
  let allRound = true;
  for (const p of POSE_IDS) {
    if (unpackActor(packActor({ x: 1, z: 2, yaw: 0, pose: p, ammo: 3, score: 0 }, 0)).pose !== p) allRound = false;
  }
  assert(allRound, "all " + POSE_IDS.length + " poses survive the wire round trip");
  const elev = unpackActor(packActor({ x: 0, z: 0, yaw: 0, pose: "flat", ammo: 0, score: 0, _elev: 1.75 }, 0))._elev;
  assert(Math.abs(elev - 1.75) < 0.02, "cling elevation replicates over the wire (" + elev + ")");
}

console.log(fails === 0 ? "\nSELFTEST PASS" : `\nSELFTEST FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
