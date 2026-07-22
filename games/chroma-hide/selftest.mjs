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
// Seekers scale 1-per-4 ABOVE A FLOOR OF TWO. The floor is not cosmetic: with a single
// seeker on a 4-5 player lobby, that seeker acquired a target ZERO times across a
// 157-second hunt on a map built for six to nine — the round was empty, not close.
assert(mc.computeSeekerCount(4) === 2 && mc.computeSeekerCount(5) === 2, "seeker count: never fewer than two");
assert(mc.computeSeekerCount(8) === 2 && mc.computeSeekerCount(10) === 3, "seeker count: 1-per-4 above the floor");
{
  const s = mc.sanitizeSettings({ prepSeconds: 200, huntSeconds: 40, startAmmo: 9999, tauntIntervalSeconds: 5 });
  // The hunt floor is 120, not 90. Measured 15 matches per setting: at a 90s hunt seekers
  // win 0% — they need roughly 150s to work through six hiders and find 3.9 of them in
  // ninety. A host could pick a length one side could not win at.
  assert(s.prepSeconds === 180 && s.huntSeconds === 120 && s.startAmmo === 999, "sanitizeSettings clamps");
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

{
  // Cling height is WORLD space: scaling it by build size sank a small body BELOW the
  // shelf it was standing on (1.95m shelf -> rendered at 1.72).
  const BY = 0.89;
  const small = util.restingBodyY(1.95, BY, 0.37, 1.0 / 1.4);
  const std = util.restingBodyY(1.95, BY, 0.37, 1.0);
  assert(small > 1.95 && std > 1.95, `body sits ON the surface for every build (small ${small.toFixed(2)}, std ${std.toFixed(2)})`);
  assert(Math.abs((small - 1.95) - (std - 1.95) * (1.0 / 1.4)) < 1e-9, "only the body offset scales with build, never the elevation");
  assert(util.restingBodyY(0, BY, 1, 1) === BY, "on the floor, resting height is just the body centre");
}

// ── maps.js (pure map data) ──────────────────────────────────────────────────
const maps = await import(pathToFileURL(path.join(__dirname, "runtime/maps.js")).href);
const manor = maps.getMap("manor");
// Five of the eight stages used to be 22x18m PROTOTYPES with 8 hand-placed props, and
// the assertions here described that shape (3 rooms, 4 walls, obstacles == props). They
// passed while the maps themselves were unplayable: measured at every lobby size from 4
// to 10 players, seekers won 100% of 30 matches on each — 252-560 m2 with eight props
// leaves nowhere to hide. All eight are campus-scale now, so assert that uniformly:
// a per-map assertion could only ever cover the map someone remembered to name.
assert(maps.mapList().length === 8, "map: 8 full-scale stages shipped");
for (const entry of maps.mapList()) {
  const m = maps.getMap(entry.id);
  const sm = maps.toSimMap(m);
  const area = (m.bounds.maxX - m.bounds.minX) * (m.bounds.maxZ - m.bounds.minZ);
  assert(area >= 4000, `map: ${m.id} is campus-scale (${Math.round(area)} m2, want >=4000)`);
  assert((m.rooms || []).length >= 7, `map: ${m.id} is multi-room (${(m.rooms || []).length}, want >=7)`);
  assert(m.walls.length >= 10, `map: ${m.id} has interior structure (${m.walls.length} walls)`);
  assert(m.props.filter((p) => p.model).length >= 100, `map: ${m.id} is GLB-furnished`);
  // every wall AND every prop must become a sim obstacle: a wall the sim cannot see is a
  // wall bots walk through, and a prop it cannot see gives no cover and no camouflage.
  // dressing props are noCollide (rendered + paintable, never nav/LOS blockers)
  const solid = m.props.filter((p) => !p.noCollide).length;
  assert(sm.obstacles.length === solid + m.walls.length, `map: ${m.id} toSimMap = solid props + walls`);
  assert(sm.spots.length === 56 && sm.spawn.seeker && sm.spawn.hider, `map: ${m.id} spawns + 56 spots`);
  assert(m.spawn.seeker.x > m.bounds.minX && m.spawn.seeker.x < m.bounds.maxX && m.spawn.hider.z > m.bounds.minZ && m.spawn.hider.z < m.bounds.maxZ, `map: ${m.id} spawns in bounds`);
}

{
  // Every surface a map asks for must have a builder. textures.js used to return null for
  // an unknown kind, and walls are built as color:0xffffff with the colour baked into the
  // MAP — so a missing builder rendered the wall pure WHITE while the sim went on scoring
  // camouflage against its declared colour. Nineteen walls shipped like that asking for
  // "timber", which never existed. The renderer needs a browser, but the KIND NAMES are
  // just data on both sides, so the cross-reference is checkable here.
  const texSrc = fs.readFileSync(path.join(__dirname, "runtime/textures.js"), "utf8");
  const built = new Set([...texSrc.slice(texSrc.indexOf("const BUILD = {")).matchAll(/^  ([a-zA-Z]+)\(base, size\)/gm)].map((m) => m[1]));
  assert(built.size >= 8, `textures: builder list parsed (${built.size} kinds)`);
  const asked = new Set();
  for (const entry of maps.mapList()) {
    const m = maps.getMap(entry.id);
    for (const w of m.walls || []) if (w.tex) asked.add(w.tex);
    for (const r of m.rooms || []) if (r.tex) asked.add(r.tex);
    if (m.ground && m.ground.tex) asked.add(m.ground.tex);
    if (m.perimeter && m.perimeter.tex) asked.add(m.perimeter.tex);
  }
  const missing = [...asked].filter((k) => !built.has(k));
  assert(missing.length === 0, `textures: every surface a map asks for has a builder${missing.length ? " — MISSING " + missing.join(", ") : ""}`);
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
  assert(depot.rooms.length >= 7 && depot.walls.length >= 10 && depot.props.length >= 200, "depot: multi-room, interior walls, dense props");
  const sm = maps.toSimMap(depot);
  assert(sm.obstacles.length === depot.props.filter((p) => !p.noCollide).length + depot.walls.length, "depot: interior walls added to obstacles");
  const players = [{ id: "S", isBot: true, role: "seeker" }, { id: "H1", isBot: true, role: "hider" }, { id: "H2", isBot: true, role: "hider" }, { id: "H3", isBot: true, role: "hider" }];
  const s = ms.createMatch({ players, settings: { ...mc.DEFAULTS, mode: "normal", prepSeconds: 25, huntSeconds: 150, tauntIntervalSeconds: 0 }, map: sm, seed: 4, seekerCount: 1, skill: { identifyTime: 0.4, detectRange: 70, fovHalf: 3.2, seekerSpeed: 4.5 } });
  assert(s.nav && s.nav.grid.length > 0, "depot: nav grid built at match start");
  // let hiders reach their (dispersed) spots
  // Hiders walk to their spots during PREP only — they hold still once the hunt starts,
  // because stillness IS camouflage. The old 1-second prep let them disperse across a
  // 22x18m prototype; on a 76x64m campus it pinned all three within 3.8m of spawn and
  // the assertion read that as the sim failing to disperse them.
  for (let i = 0; i < 700; i++) ms.stepMatch(s, 1 / 20);
  const hx = ms.hiders(s).map((h) => h.x);
  assert(Math.max(...hx) - Math.min(...hx) > 12, "depot: hiders disperse across rooms (x-spread " + (Math.max(...hx) - Math.min(...hx)).toFixed(1) + ")");
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
  // NOTE: this only proves the wire CARRIES cling height. It passed for months while the
  // guest threw the value away — _applySnapshot never copied _elev onto the actor and
  // _syncActors only ever lifted the LOCAL mesh, so every other player and every mounted
  // bot was drawn standing on the floor inside the prop. Testing a value survives packing
  // says nothing about anyone reading it; restingBodyY below covers the consuming maths.
  const elev = unpackActor(packActor({ x: 0, z: 0, yaw: 0, pose: "flat", ammo: 0, score: 0, _elev: 1.75 }, 0))._elev;
  assert(Math.abs(elev - 1.75) < 0.02, "cling elevation replicates over the wire (" + elev + ")");
}


// ── bots actually hunt, and finds are actually scored ────────────────────────
// Patrol waypoints were any random point in bounds. On a dense map most land inside
// geometry, and "am I there yet" was the only thing that ever cleared one -- so a
// seeker could walk into a wall for the whole match and hunts stalemated to the timer.
// Separately, only the Reverse mark scored, so Double ("Most finds wins") counted nothing.
{
  const { createMatch, stepMatch, seekers } = await import("./runtime/sim/match_sim.js");
  const { DEFAULTS, PHASE, ROLE } = await import("./runtime/sim/match_core.js");
  const { MAPS, toSimMap } = await import("./runtime/maps.js");

  const play = (mode, seed) => {
    const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < 2 ? ROLE.SEEKER : ROLE.HIDER }));
    const s = createMatch({ players, settings: { ...DEFAULTS, mode }, map: toSimMap(MAPS.office), seed, seekerCount: 2 });
    const dt = 1 / 30, travel = {}, last = {};
    let t = 0;
    while (s.phase !== PHASE.RESULTS && t < 400) {
      stepMatch(s, dt); t += dt;
      if (s.phase === PHASE.HUNT) for (const k of seekers(s)) {
        if (last[k.id]) travel[k.id] = (travel[k.id] || 0) + Math.hypot(k.x - last[k.id].x, k.z - last[k.id].z);
        last[k.id] = { x: k.x, z: k.z };
      }
    }
    return { s, travel: Object.values(travel), finds: seekers(s).reduce((a, k) => a + (k.finds || 0), 0) };
  };

  const runs = [1, 2, 3, 4].map((sd) => play("normal", sd));
  assert(runs.every((r) => r.s.result != null), "every match reaches a result");
  const moved = runs.flatMap((r) => r.travel);
  const wedged = moved.filter((d) => d < 20).length;
  assert(wedged === 0, "no seeker wedges on an unreachable patrol target (" + wedged + "/" + moved.length +
    " moved <20m; median " + moved.sort((a, b) => a - b)[(moved.length / 2) | 0].toFixed(0) + "m)");
  assert(runs.reduce((a, r) => a + r.finds, 0) > 0, "bot seekers actually catch hiders");

  const dbl = [1, 2, 3].map((sd) => play("double", sd));
  const scored = dbl.some((r) => seekers(r.s).some((k) => k.score > 0));
  assert(scored, "Double scores finds — its stated win condition is 'Most finds wins'");

  const inf = play("infection", 2);
  assert(inf.s.result != null, "Infection reaches a result rather than idling out the timer");
}


// ── netcode authority ────────────────────────────────────────────────────────
// Every peer's EVENT and SNAP messages used to be applied unquestioned, so any client
// could broadcast a forged win/caught/phase or overwrite the authoritative simulation.
{
  const P = await import("./runtime/sim/net_protocol.js");
  const HOST = "h1", GUEST = "g2", ATTACKER = "x9";
  const asGuest = { isHost: false, hostId: HOST }, asHost = { isHost: true, hostId: HOST };
  assert(P.authorizeMsg(P.MSG.EVENT, HOST, asGuest) === true, "net: a guest accepts EVENT from the host");
  assert(P.authorizeMsg(P.MSG.EVENT, ATTACKER, asGuest) === false, "net: a forged EVENT from a peer is rejected");
  assert(P.authorizeMsg(P.MSG.SNAP, ATTACKER, asGuest) === false, "net: a snapshot from a non-host is rejected");
  assert(P.authorizeMsg(P.MSG.SNAP, HOST, asGuest) === true, "net: the host's snapshot is accepted");
  assert(P.authorizeMsg(P.MSG.INPUT, GUEST, asHost) === true, "net: the host consumes guest input");
  assert(P.authorizeMsg(P.MSG.INPUT, GUEST, asGuest) === false, "net: a guest ignores another guest's input");
  assert(P.authorizeMsg(P.MSG.SHOT, GUEST, asHost) === true, "net: the host adjudicates guest shots");
  assert(P.authorizeMsg(P.MSG.SHOT, ATTACKER, asGuest) === false, "net: a guest never adjudicates a shot");
  assert(P.authorizeMsg(P.MSG.EVENT, ATTACKER, { isHost: false, hostId: null }) === false,
    "net: before a host is known, no EVENT is trusted");
}


// ── decoy clones ─────────────────────────────────────────────────────────────
// The store copy promised "drop decoy clones" and maxClones/cloneCooldownSeconds were
// validated settings, but nothing implemented them.
{
  const { createMatch, stepMatch, setLocalInput, hiders, seekers, dropDecoy } = await import("./runtime/sim/match_sim.js");
  const { DEFAULTS, PHASE, ROLE } = await import("./runtime/sim/match_core.js");
  const { MAPS, toSimMap } = await import("./runtime/maps.js");
  const players = [{ id: "me", isBot: false, role: ROLE.HIDER, isLocal: true },
    ...[...Array(5)].map((_, i) => ({ id: "b" + i, isBot: true, role: i < 2 ? ROLE.SEEKER : ROLE.HIDER }))];
  const s = createMatch({ players, settings: { ...DEFAULTS }, map: toSimMap(MAPS.office), seed: 11, seekerCount: 2 });
  let t = 0; while (s.phase !== PHASE.HUNT && t < 400) { stepMatch(s, 1 / 30); t += 1 / 30; }
  const me = s.actors.find((a) => a.id === "me");

  const d1 = dropDecoy(s, "me");
  assert(!!(d1 && d1.id), "decoy: dropping one works");
  assert(dropDecoy(s, "me").error === "cooling_down", "decoy: the cooldown is enforced");
  me._cloneCd = 0; dropDecoy(s, "me"); me._cloneCd = 0;
  assert(dropDecoy(s, "me").error === "no_clones_left", "decoy: maxClones is enforced");
  assert(hiders(s).every((h) => !h.isDecoy), "decoy: a clone never counts as a hider (or seekers could never win)");

  me.x = d1.x + 14; me.z = d1.z + 14;                       // walk away, the point of a decoy
  for (const h of hiders(s)) if (h.id !== "me") { h.x = d1.x + 22; h.z = d1.z + 22; }
  const k = seekers(s)[0];
  k.isBot = false; k.ammo = 8; k.cooldown = 0; k.x = d1.x; k.z = d1.z - 1.2;
  const n0 = s.actors.length;
  setLocalInput(s, k.id, { mx: 0, mz: 0, yaw: Math.atan2(d1.x - k.x, d1.z - k.z), shoot: true });
  stepMatch(s, 1 / 30);
  assert(s.events.some((e) => e.t === "decoy_hit"), "decoy: shooting one is reported as a decoy hit");
  assert(s.actors.length === n0 - 1, "decoy: it is destroyed by the shot");
  assert(k.ammo === 7, "decoy: being fooled costs the seeker a shot (" + k.ammo + ")");
  assert(me.alive, "decoy: the owner is untouched");
}


// ── body size, per-target dwell, stroke hardness, aim pitch ──────────────────
{
  const M = await import("./runtime/sim/match_sim.js");
  const { DEFAULTS, PHASE, ROLE, BODY_SIZES } = await import("./runtime/sim/match_core.js");
  const { MAPS, toSimMap } = await import("./runtime/maps.js");
  const P = await import("./runtime/sim/net_protocol.js");

  // body size: the tips promised a choice that did not exist
  assert(M.hiderHeight({ pose: "stand" }) === 1.55, "size: a body with no size set is the standard build");
  const small = M.hiderHeight({ pose: "stand", bodySize: 1.0 });
  const large = M.hiderHeight({ pose: "stand", bodySize: 1.7 });
  assert(small < 1.55 && large > 1.55, `size: build changes the silhouette (${small.toFixed(2)} < 1.55 < ${large.toFixed(2)})`);
  assert(M.hiderHeight({ pose: "flat", bodySize: 1.0 }) < M.hiderHeight({ pose: "stand", bodySize: 1.0 }),
    "size: pose still composes on top of build");

  const players = [{ id: "me", isBot: false, isLocal: true, role: ROLE.HIDER, bodySize: 1.0 },
    ...[...Array(5)].map((_, i) => ({ id: "b" + i, isBot: true, role: i < 2 ? ROLE.SEEKER : ROLE.HIDER }))];
  const s = M.createMatch({ players, settings: { ...DEFAULTS }, map: toSimMap(MAPS.office), seed: 4, seekerCount: 2 });
  assert(s.actors.find((a) => a.id === "me").bodySize === 1.0, "size: the player's choice reaches the sim");
  assert(new Set(s.actors.filter((a) => a.isBot).map((a) => a.bodySize)).size > 1, "size: bots get a spread of builds");
  const dec = M.dropDecoy(s, "me");
  assert(dec.bodySize === 1.0, "size: a decoy inherits the owner's build (or it is not a clone)");

  // stroke hardness is what separates a spray from a marker
  const rt = P.unpackStroke(P.packStroke({ u: .5, v: .5, size: 20, r: 1, g: 2, b: 3, metal: 0, rough: .8, hard: 0.06 }));
  assert(Math.abs(rt.hard - 0.06) < 0.01, "paint: stroke hardness survives the wire (" + rt.hard.toFixed(2) + ")");
  assert(P.unpackStroke([1, 2, 3, 4, 5, 6, 7, 8]).hard === 0.6, "paint: a stroke without hardness defaults sanely");

  // identify dwell must belong to the target, not the seeker
  // maxClones 0: this checks TARGETING, and bots now drop a decoy when a seeker closes
  // inside flee range — which is exactly the 3m this test uses — so the seeker would be
  // re-targeting a clone rather than demonstrating dwell reset.
  const s2 = M.createMatch({ players: [...Array(6)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < 1 ? ROLE.SEEKER : ROLE.HIDER })),
    settings: { ...DEFAULTS, maxClones: 0 }, map: toSimMap(MAPS.office), seed: 5, seekerCount: 1 });
  let t = 0; while (s2.phase !== PHASE.HUNT && t < 400) { M.stepMatch(s2, 1 / 30); t += 1 / 30; }
  const k = M.seekers(s2)[0], hs = M.hiders(s2).filter((h) => h.alive);
  const A = hs[0], B = hs[1];
  A.x = k.x + 3; A.z = k.z + 0.2; B.x = k.x + 400; B.z = k.z + 400;
  k.yaw = Math.atan2(A.x - k.x, A.z - k.z);
  for (let n = 0; n < 12; n++) M.stepMatch(s2, 1 / 30);
  const built = k.dwell;
  A.x = k.x + 400; A.z = k.z + 400; B.x = k.x + 3; B.z = k.z + 0.2;
  M.stepMatch(s2, 1 / 30);
  assert(built > 0.2, "ai: dwell accumulates on a watched target");
  assert(k.dwell < built, "ai: switching target resets dwell (no tab-targeting past the camouflage stretch)");
}


// ── quality vocabulary is ONE vocabulary ─────────────────────────────────────
// The point-light cap keyed on "medium" while the engine's quality value is "med", so
// LIGHT_CAP[q] was undefined and fell through to the uncapped default — the optimisation
// did nothing at the setting most players are on. A silent lookup miss, invisible to
// review and to node --check.
{
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const keys = (text, name) => {
    const m = text.match(new RegExp(name + " = \{([^}]*)\}"));
    return m ? m[1].split(",").map((x) => x.split(":")[0].trim()).filter(Boolean) : null;
  };
  const cap = keys(src("runtime/game.js"), "LIGHT_CAP");
  const qdpr = keys(src("runtime/engine.js"), "QDPR");
  assert(cap && qdpr, "quality: found both LIGHT_CAP and QDPR tables");
  assert(JSON.stringify(cap) === JSON.stringify(qdpr),
    `quality: the light cap and the renderer share one vocabulary (${cap} vs ${qdpr})`);
  assert(src("runtime/engine.js").includes("shadowMap.autoUpdate = false"),
    "quality: static shadow map is set at construction, not only in applyQuality");
}


// ── the HUD readout and the sim must agree ───────────────────────────────────
// Found by actually playing: the colour-match meter reported "100% EXCELLENT" while
// blendScore returned 0, because the meter sampled the nearest surface at ANY distance
// and the sim only counts one within BLEND_RANGE2. Telling a player they are perfectly
// hidden while scoring them as exposed is worse than showing nothing.
{
  const { MAPS, toSimMap } = await import("./runtime/maps.js");
  const { blendScore, coverInfo, BLEND_RANGE2 } = await import("./runtime/sim/match_sim.js");
  const m = MAPS.office, sim = toSimMap(m);
  const W = m.walls.filter((w) => w.color != null)[0];
  const exact = { r: (W.color >> 16) & 255, g: (W.color >> 8) & 255, b: W.color & 255 };

  const near = { x: W.x, z: W.z + 0.7 };
  // These maps are dense, so "6m from THAT wall" is usually 0.5m from something else.
  // Search the bounds for a genuinely open spot instead of assuming one.
  let far = null;
  for (let x = sim.bounds.minX + 2; x < sim.bounds.maxX - 2 && !far; x += 1.5) {
    for (let z = sim.bounds.minZ + 2; z < sim.bounds.maxZ - 2; z += 1.5) {
      if (!coverInfo(sim, x, z).inRange) { far = { x, z }; break; }
    }
  }
  assert(far != null, "hud: the map has at least one spot away from every surface");
  const nearInfo = coverInfo(sim, near.x, near.z);
  const farInfo = coverInfo(sim, far.x, far.z);
  assert(nearInfo.inRange, "hud: pressed against a wall counts as in range");
  assert(!farInfo.inRange, "hud: an open spot is reported out of range (" + farInfo.dist.toFixed(1) + "m)");

  const nearScore = blendScore(sim, { ...near, paintRGB: exact });
  const farScore = blendScore(sim, { ...far, paintRGB: exact });
  assert(nearScore > 0.9, "hud: the sim scores a matched body that IS against the wall");
  assert(farScore === 0, "hud: the sim scores 0 when out of range");
  assert(nearInfo.inRange === (nearScore > 0) && farInfo.inRange === (farScore > 0),
    "hud: the readout's in-range verdict matches whether the sim actually scores you");
  assert(typeof BLEND_RANGE2 === "number", "hud: the range threshold is shared, not duplicated");
}


// ── the match is actually competitive ────────────────────────────────────────
// Bot seekers used to pick waypoints at random, so two of them re-swept the same aisle
// while a third of the map went unvisited: they found 4.6 of 6 hiders, ran out of TIME
// rather than leads, and hiders won 79% of matches. A shared coarse search grid fixed the
// coverage problem. This guards the BAND, not an exact number — balance should be free to
// drift, but not back to one-sided.
{
  const { createMatch, stepMatch, seekers, hiders, coverInfo } = await import("./runtime/sim/match_sim.js");
  const { DEFAULTS, PHASE, ROLE } = await import("./runtime/sim/match_core.js");
  const { MAPS, toSimMap } = await import("./runtime/maps.js");
  const play = (map, seed, lobby = 8) => {
    const sk = mc.computeSeekerCount(lobby);
    const players = [...Array(lobby)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < sk ? ROLE.SEEKER : ROLE.HIDER }));
    const s = createMatch({ players, settings: { ...DEFAULTS }, map: toSimMap(MAPS[map]), seed, seekerCount: sk });
    let t = 0; const dt = 1 / 30;
    while (s.phase !== PHASE.RESULTS && t < 420) { stepMatch(s, dt); t += dt; }
    return { winner: s.result && s.result.winner, finds: seekers(s).reduce((a, k) => a + (k.finds || 0), 0), hiders: lobby - sk };
  };
  // This measured ONE lobby size (8 players = 2 seekers vs 6 hiders, the hardest ratio in
  // the game) over 18 matches, and asserted 25-80%. Both were wrong. Measured over 90
  // matches the true rate for that config is 21% — the gate had been passing on a
  // favourable draw, and any change that merely shifts the RNG stream (bots now consume a
  // random number deciding whether to climb) reshuffled which seeds won and swung it from
  // 28% to 11% with no real balance change behind it. Sweep the lobby sizes instead, which
  // is what "balance" means here, with enough matches that the draw stops deciding:
  // measured 4p 67%, 6p 33%, 8p 25%, 10p 25% across the eight stages.
  let seekWins = 0, total = 0, finds = 0;
  for (const map of ["office", "street", "supermarket"]) {
    for (const lobby of [4, 6, 8, 10]) {
      for (let seed = 1; seed <= 4; seed++) {
        const r = play(map, seed, lobby);
        total++; finds += r.finds / r.hiders;
        if (r.winner === "seekers") seekWins++;
      }
    }
  }
  const rate = seekWins / total;
  const avgFinds = finds / total;
  assert(rate >= 0.20 && rate <= 0.75,
    `balance: neither side dominates — seekers win ${(rate * 100).toFixed(0)}% of ${total} matches (want 20-75%)`);

  // Infection compresses the round — measured, seekers go 2 -> 7 by t=45s. Asking hiders to
  // survive the same 150s budget as Normal made it 94% seeker-favoured, so the mode scales
  // its own hunt. Guard the pacing, not the exact number.
  let infSeek = 0, infTotal = 0;
  for (const map of ["office", "street", "supermarket"]) {
    for (let seed = 1; seed <= 4; seed++) {
      const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < 2 ? ROLE.SEEKER : ROLE.HIDER }));
      const s2 = createMatch({ players, settings: { ...DEFAULTS, mode: "infection" }, map: toSimMap(MAPS[map]), seed, seekerCount: 2 });
      let t2 = 0; const dt2 = 1 / 30;
      while (s2.phase !== PHASE.RESULTS && t2 < 420) { stepMatch(s2, dt2); t2 += dt2; }
      infTotal++;
      if (s2.result && s2.result.winner === "seekers") infSeek++;
    }
  }
  // Contact rate: how often a seeker actually acquires someone. Win rate alone hid an empty
  // game — a 4-player lobby measured a perfectly respectable 33% seeker win while the seeker
  // never once saw a hider in 157 seconds. A close match nobody participates in is not a
  // match, so guard the thing that makes a round feel played.
  {
    let contacts = 0, hunts = 0;
    for (const map of ["office", "street", "supermarket"]) {
      for (let seed = 1; seed <= 3; seed++) {
        const players = [...Array(6)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < 2 ? ROLE.SEEKER : ROLE.HIDER }));
        const s3 = createMatch({ players, settings: { ...DEFAULTS }, map: toSimMap(MAPS[map]), seed, seekerCount: 2 });
        let t3 = 0, hunt = 0, c = 0, lastC = -99; const dt3 = 1 / 30;
        while (s3.phase !== PHASE.RESULTS && t3 < 420) {
          stepMatch(s3, dt3); t3 += dt3;
          if (s3.phase === PHASE.HUNT) { hunt += dt3; if (seekers(s3).some((k) => k.target) && hunt - lastC > 3) { c++; lastC = hunt; } }
        }
        contacts += c; hunts++;
      }
    }
    const rate2 = contacts / hunts;
    assert(rate2 >= 2.5,
      `balance: the smallest lobby still plays like a game — ${rate2.toFixed(1)} seeker contacts per hunt (want >=2.5)`);
  }

  // Nobody dies to a seeker who never saw them. A hider losing to something off-screen and
  // unannounced is the single most unfair thing this genre can do, and it is the kind of
  // regression a range or aim change could introduce silently. Measured across 3 maps:
  // every caught hider had been acquired as a target first.
  {
    let caught = 0, caughtUnseen = 0;
    for (const map of ["office", "street", "supermarket"]) {
      for (let seed = 1; seed <= 3; seed++) {
        const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < 2 ? ROLE.SEEKER : ROLE.HIDER }));
        const s4 = createMatch({ players, settings: { ...DEFAULTS }, map: toSimMap(MAPS[map]), seed, seekerCount: 2 });
        const seen = {}; let t4 = 0; const dt4 = 1 / 30;
        while (s4.phase !== PHASE.RESULTS && t4 < 420) {
          stepMatch(s4, dt4); t4 += dt4;
          for (const k of seekers(s4)) if (k.target) seen[k.target.id] = true;
        }
        for (const h of hiders(s4)) if (!h.alive) { caught++; if (!seen[h.id]) caughtUnseen++; }
      }
    }
    assert(caught > 0, "fairness: the sample actually caught someone (" + caught + ")");
    assert(caughtUnseen === 0,
      `fairness: no hider is killed without being seen first — ${caughtUnseen} of ${caught} died unseen`);
  }

  // THE central mechanic: a good paint job must buy time before the shot. Measured
  // acquisition-to-shot tracks identifyTime * (1 + 3*blend) exactly — 1.07s at blend 0,
  // 4.40s at blend 1, a 4x payoff. Everything else in this game exists to make that
  // trade interesting, so it must never silently degrade.
  {
    const at = (blend) => {
      const players = [{ id: "k", isBot: true, role: ROLE.SEEKER }, { id: "h", isBot: true, role: ROLE.HIDER }];
      const s5 = createMatch({ players, settings: { ...DEFAULTS }, map: toSimMap(MAPS.office), seed: 3, seekerCount: 1 });
      while (s5.phase !== PHASE.HUNT) stepMatch(s5, 1 / 30);
      const k = s5.actors.find((a) => a.id === "k"), h = s5.actors.find((a) => a.id === "h");
      const W = MAPS.office.walls.find((w) => w.color != null && Math.max(w.w, w.d) > 8);
      const horiz = W.w >= W.d;
      h.x = horiz ? W.x : W.x + 0.8; h.z = horiz ? W.z + 0.8 : W.z;
      k.x = horiz ? h.x : h.x + 6;   k.z = horiz ? h.z + 6 : h.z;
      const kx = k.x, kz = k.z, hx = h.x, hz = h.z;
      const info = coverInfo(s5, hx, hz);
      if (!info.inRange) return null;
      h.pose = "stand"; h.hidden = true; h._moving = false;
      const off = Math.round((1 - blend) * 90 / Math.sqrt(3));
      h.paintRGB = { r: Math.min(255, info.rgb.r + off), g: Math.min(255, info.rgb.g + off), b: Math.min(255, info.rgb.b + off) };
      let t = 0, acq = null;
      while (h.alive && t < 60) {
        k.x = kx; k.z = kz; k.yaw = Math.atan2(hx - kx, hz - kz); h.x = hx; h.z = hz;
        stepMatch(s5, 1 / 30); t += 1 / 30;
        if (acq === null && k.target && k.target.id === "h") acq = t;
      }
      return h.alive ? null : t - (acq ?? t);
    };
    const bare = at(0), full = at(1);
    assert(bare != null && full != null, "camouflage: both trials resolved");
    assert(full > bare * 2.5,
      `camouflage: a matched body survives far longer than a white one — ${full.toFixed(2)}s vs ${bare.toFixed(2)}s (want >2.5x)`);
  }

  // THE bug this guard exists for: every authored hiding spot was outside camouflage range.
  // autoSpots kept 1.3m clearance from all solids INCLUDING the anchor, and blending needed
  // <=1.26m, so 0 of 97 designated hiding places let you hide. The game's own hiding spots
  // were the one place hiding did not work, and nothing detected it because both rules were
  // individually reasonable.
  {
    let total = 0, blendable = 0;
    for (const map of ["office", "street", "supermarket"]) {
      const m = MAPS[map], sim = toSimMap(m);
      for (const sp of (m.spots || [])) { total++; if (coverInfo(sim, sp.x, sp.z).inRange) blendable++; }
    }
    assert(total > 0, "spots: the shipped maps have authored hiding spots (" + total + ")");
    assert(blendable / total >= 0.85,
      `spots: a designated hiding spot lets you hide — ${blendable}/${total} are within camouflage range (want >=85%)`);

    // And it has to be somewhere a body can actually STAND. These two pull opposite ways —
    // camouflage wants the spot close to the surface, the nav grid inflates obstacles by
    // 0.55m and snaps to 1.0m cells so too close is unreachable. Guarding either alone just
    // moves the dead zone: at +0.70m offset 95% could blend but only 73% were walkable; at
    // +1.05m, 98% walkable but only 79% could blend. Assert the INTERSECTION.
    const nav = await import("./runtime/sim/nav.js");
    let both = 0;
    for (const map of ["office", "street", "supermarket"]) {
      const m = MAPS[map], sim = toSimMap(m);
      const grid = nav.buildNavGrid(sim.bounds, sim.obstacles, 1.0, 0.55);
      for (const sp of (m.spots || [])) {
        const [i, j] = nav.cellOf(grid, sp.x, sp.z);
        const walkable = i >= 0 && j >= 0 && i < grid.w && j < grid.h && grid.grid[j * grid.w + i] === 1;
        if (walkable && coverInfo(sim, sp.x, sp.z).inRange) both++;
      }
    }
    assert(both / total >= 0.75,
      `spots: usable — ${both}/${total} can both blend AND be stood on (want >=75%)`);
  }

  const infRate = infSeek / infTotal;
  assert(infRate <= 0.85,
    `balance: Infection is a snowball, not a formality — seekers win ${(infRate * 100).toFixed(0)}% (want <=85%)`);
  // A FRACTION, not a count: the sweep now spans 4-to-10-player lobbies, so "4 of 6" was
  // unmeetable in a 4-player match that only has two hiders to find. Measured 0.79.
  assert(avgFinds >= 0.6,
    `balance: seekers find most of the lobby — ${(avgFinds * 100).toFixed(0)}% of hiders (want >=60%)`);

  // Reverse is a RACE for one marked hider, so the sim has to remember WHO caught them.
  // Without it the end screen fell back to the normal-mode line — "Seekers win / Every
  // hider was found" — in a mode where seven of eight players are seekers and that
  // sentence names nobody and says nothing.
  {
    let caughtRuns = 0, namedRuns = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sm = maps.toSimMap(maps.getMap("supermarket"));
      const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: "hider" }));
      const st = ms.createMatch({ players, settings: mc.sanitizeSettings({ ...mc.DEFAULTS, mode: "reverse" }), map: sm, seed, seekerCount: 0 });
      let t = 0;
      while (st.phase !== mc.PHASE.RESULTS && t < 700) { ms.stepMatch(st, 1 / 30); t += 1 / 30; }
      const mark = st.actors.find((a) => a.id === st.reverseMark);
      if (mark && !mark.alive) { caughtRuns++; if (st.reverseCatcher) namedRuns++; }
    }
    assert(caughtRuns > 0 && namedRuns === caughtRuns,
      `reverse: the racer who caught the mark is named (${namedRuns}/${caughtRuns} runs)`);
  }

  // Bots must actually USE the hider verbs. Decoys and mounting were reachable only from
  // a human keypress, so across 72 bot hider-lives ZERO decoys were dropped and not one
  // bot ever left the floor — meaning single-player, which is bot-filled, could never show
  // a player either mechanic, and every balance figure described a game without them.
  {
    let decoys = 0, mounts = 0;
    for (const id of ["office", "manor", "depot"]) {
      const sm = maps.toSimMap(maps.getMap(id));
      for (let seed = 1; seed <= 4; seed++) {
        const sk = mc.computeSeekerCount(8);
        const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < sk ? "seeker" : "hider" }));
        const st = ms.createMatch({ players, settings: mc.sanitizeSettings({ ...mc.DEFAULTS }), map: sm, seed, seekerCount: sk });
        let t = 0;
        while (st.phase !== mc.PHASE.RESULTS && t < 700) {
          ms.stepMatch(st, 1 / 30); t += 1 / 30;
          for (const e of st.events) if (e.t === "decoy") decoys++;
          st.events.length = 0;
          for (const h of ms.hiders(st)) if ((h._elev || 0) > 0.05) mounts++;
        }
      }
    }
    assert(decoys > 0, `bots: decoys are used in solo play (${decoys} across 12 matches)`);
    assert(mounts > 0, `bots: hiders climb onto props in solo play (${mounts} mounted frames)`);
  }

  // A human seeker must be able to shoot the poses this game encourages. The vertical-aim
  // check was a flat |pitch| <= 0.45, which auto-missed AND charged a round for a
  // point-blank shot at a hider lying flat (needs -0.59), curled (-0.54) or clinging to a
  // 2.2m shelf (+0.49) — while a STANDING hider at the same 2m was caught. Bots pass
  // pitch:null so no bot measurement could ever see it.
  {
    const fire = (pose, elev, dist, aimOff) => {
      const sm = maps.toSimMap(maps.getMap("office"));
      const players = [{ id: "S", isBot: false, role: "seeker" }, { id: "H", isBot: true, role: "hider" }];
      const st = ms.createMatch({ players, settings: mc.sanitizeSettings({ ...mc.DEFAULTS, prepSeconds: 1, maxClones: 0 }), map: sm, seed: 3, seekerCount: 1 });
      while (st.phase !== mc.PHASE.HUNT) ms.stepMatch(st, 1 / 30);
      const S = st.actors.find((a) => a.id === "S"), H = st.actors.find((a) => a.id === "H");
      // H is flagged non-bot so it holds still: a BOT hider with a seeker 2m away flees,
      // and fleeing drops you off the crate (_elev = 0), which would undo the mounted
      // cases this is here to check. The seeker's aim maths does not care either way.
      H.isBot = false; H._in = { mx: 0, mz: 0, yaw: null, shoot: false };
      S.x = 0; S.z = 0; S.yaw = 0; H.x = 0; H.z = dist; H.alive = true; H.pose = pose; H._elev = elev; H.fleeing = false;
      const poseH = mc.POSE_HEIGHT[pose] != null ? mc.POSE_HEIGHT[pose] : 1.55;
      const need = Math.atan((elev + poseH / 2 - 1.55) / dist);
      S.ammo = 8; S.cooldown = 0; S._in = { pitch: need + aimOff, yaw: 0, shoot: true };
      ms.stepMatch(st, 1 / 30);
      return { ammo: S.ammo, caught: !H.alive };
    };
    const honest = [["flat", 0, 2], ["ball", 0, 2], ["curl", 2.2, 2], ["stand", 0, 2], ["crouch", 1.9, 3]];
    const missed = honest.filter(([p, e, d]) => !fire(p, e, d, 0).caught).map(([p]) => p);
    assert(missed.length === 0, `shot: point-blank aim connects on every pose${missed.length ? " — failed " + missed.join(",") : ""}`);
    // A guest's pitch travels in its input message. When it was missing the vertical check
    // was skipped outright, so a remote seeker could fire with the crosshair anywhere
    // vertically and still connect while the host had to aim. The host now defaults absent
    // pitch to 0 (level), which must actually REFUSE a shot at a hider up on a shelf.
    const levelAtMounted = fire("curl", 2.2, 3, -Math.atan((2.2 + 0.81 / 2 - 1.55) / 3));
    assert(!levelAtMounted.caught && levelAtMounted.ammo === 7,
      "shot: aiming level at a hider on a 2.2m shelf misses and costs a round");
    const ceiling = fire("stand", 0, 10, 1.0);
    assert(!ceiling.caught && ceiling.ammo === 7, "shot: staring at the ceiling still misses and costs a round");
  }

  // A match must not write back onto the map it was handed. Hiders claim a spot by
  // setting _claimed on the spot object, and createMatch used to shallow-copy the array,
  // so the flags leaked to the caller: reusing one simMap across 12 matches on The Depot
  // took seekers from 5/12 to 11/12 as spots silently ran out. It never hit the game
  // (toSimMap clones per match) but it made this file report a false failure.
  {
    const sm = maps.toSimMap(maps.getMap("depot"));
    const before = JSON.stringify(sm.spots);
    const sk = mc.computeSeekerCount(8);
    const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < sk ? "seeker" : "hider" }));
    const st = ms.createMatch({ players, settings: mc.sanitizeSettings({ ...mc.DEFAULTS }), map: sm, seed: 1, seekerCount: sk });
    let t = 0;
    while (st.phase !== mc.PHASE.RESULTS && t < 700) { ms.stepMatch(st, 1 / 30); t += 1 / 30; }
    assert(JSON.stringify(sm.spots) === before, "sim: a match leaves the input map untouched");
  }

  // EVERY shipped stage must be survivable. Five stages shipped for months at a flat 100%
  // seeker win — 30 matches each, every hider found every time, at every lobby size from
  // 4 to 10 — and nothing in this file noticed, because balance was only ever asserted
  // against one map. A clean sweep in EVERY sampled match is the signature of a stage with
  // nowhere to hide (the prototypes swept 6.0/6 every single run); a healthy stage leaks a
  // survivor sometimes. Cheap enough to run per-map: 4 seeds x 8 stages.
  {
    const bad = [];
    for (const entry of maps.mapList()) {
      const sm = maps.toSimMap(maps.getMap(entry.id));
      let sweeps = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const sk = mc.computeSeekerCount(8);
        const players = [...Array(8)].map((_, i) => ({ id: "p" + i, isBot: true, role: i < sk ? "seeker" : "hider" }));
        const st = ms.createMatch({ players, settings: mc.sanitizeSettings({ ...mc.DEFAULTS }), map: sm, seed, seekerCount: sk });
        let t = 0;
        while (st.phase !== mc.PHASE.RESULTS && t < 700) { ms.stepMatch(st, 1 / 30); t += 1 / 30; }
        const finds = ms.seekers(st).reduce((a, x) => a + (x.finds || 0), 0);
        if (finds >= 6) sweeps++;
      }
      if (sweeps === 4) bad.push(entry.id);
    }
    assert(bad.length === 0,
      `balance: no stage is a clean sweep every match${bad.length ? " — " + bad.join(", ") : ""}`);
  }
}

console.log(fails === 0 ? "\nSELFTEST PASS" : `\nSELFTEST FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
