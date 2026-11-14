// qa_worldact_node.mjs -- lane W (world activities) LOGIC proof on the REAL ground.
//
//   python _harness/qa_wa_hbake.py      (once: bakes + exports the real heightfields)
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_worldact_node.mjs
//
// WHAT IS REAL. The heightfield: _harness/_wa_heights/<realm>.f32 is the GPU
// bake's CPU mirror, exported by qa_wa_hbake.py from the game's own Heightfield
// class with each realm's own landform + wind (2048^2 floats at 1 m), and every
// height here is sampled by Heightfield.prototype.heightAt/normalAt/edge01 —
// the game's code, on the game's numbers (asserted bit-identical to the
// browser's own heightAt below). Also real: CharacterController (surf physics),
// DamageableRegistry, Enemies (spawn/AI), Progression (v4 save sections, kill
// drain, XP), SpawnShrine, Landmarks (the real per-realm layout + re-layout),
// the STORY data, the event bus, and the four lane-W systems under test.
// STUBBED: GPU objects (scene.add, shadow registration), the mesh-enemy renderer
// (a stand-in holding the documented tint box), the camera rig (yaw + basis).
// Nothing is rendered: draw calls are counted as visible single-material meshes.
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const HDIR = join(HERE, "_wa_heights");
if (!existsSync(join(HDIR, "meta.json"))) {
    console.log("FAIL real heightfields missing — run: python _harness/qa_wa_hbake.py");
    process.exit(2);
}
const META = JSON.parse(readFileSync(join(HDIR, "meta.json"), "utf8"));
const HEIGHTS = {};
for (const r of ["cold", "sand", "ash"]) {
    const b = readFileSync(join(HDIR, r + ".f32"));
    HEIGHTS[r] = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

// heightfield.js -> core/loading.js reads four DOM ids at import time.
globalThis.document = { getElementById: () => null };
const { Heightfield } = await import("../src/terrain/heightfield.js");
delete globalThis.document;

const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { STORY } = await import("../src/quests/storyText.js");
const { input } = await import("../src/core/input.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const { Progression } = await import("../src/progression/progression.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks, LANDMARK_TYPES } = await import("../src/world/landmarks.js");
const C = await import("../src/world/caches.js");
const T = await import("../src/world/trials.js");
const B = await import("../src/world/bounties.js");
const W = await import("../src/world/beacon.js");
const G = await import("../src/shaders/worldact.glsl.js");

const RESULTS = [];
function check(name, ok, detail) {
    RESULTS.push([name, !!ok]);
    console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail));
}
const r2 = (v) => (v === null || v === undefined ? v : Math.round(v * 100) / 100);
const r1 = (v) => Math.round(v * 10) / 10;

// ================================================================ static
{
    const OWN = ["world/caches.js", "world/trials.js", "world/bounties.js", "world/beacon.js",
        "shaders/worldact.glsl.js"];
    const header = readFileSync(join(SRC, "quests/events.js"), "utf8").split("*/")[0];
    const rnd = [], emitted = new Set(), missing = [];
    for (const f of OWN) {
        const s = readFileSync(join(SRC, f), "utf8");
        if (/Math\.random/.test(s)) rnd.push(f);
        for (const m of s.matchAll(/\.emit\(\s*"([^"]+)"/g)) emitted.add(m[1]);
    }
    for (const t of emitted) if (header.indexOf("'" + t + "'") < 0) missing.push(t);
    check("static: no Math.random in lane W files; every emitted event is in the bus header",
        rnd.length === 0 && missing.length === 0,
        { mathRandomIn: rnd, emitted: [...emitted].sort(), notInCatalogue: missing });
}

// ============================================================== terrain
const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(META.cold.originX, META.cold.originZ);
hf.size = META.cold.size;
hf.cpuRes = META.cold.res;
hf.cpuTexel = META.cold.texel;
hf.heightCPU = HEIGHTS.cold;
const terrain = {
    realm: "cold",
    // terrain.js `get rebakeCount()`: bakes since boot (1 = the boot bake).
    bakes: 1,
    get rebakeCount() { return this.bakes; },
    use(t) { this.realm = t; hf.heightCPU = HEIGHTS[t]; this.bakes++; },
    heightAt: (x, z) => hf.heightAt(x, z),
    normalAt: (x, z, out) => hf.normalAt(x, z, out),
    edge01: (x, z) => hf.edge01(x, z),
    clampToPlayArea: (v) => hf.clampToPlayArea(v),
    edgePush: (x, z) => hf.edgePush(x, z),
};
{
    const rows = {};
    let ok = true;
    for (const r of ["cold", "sand", "ash"]) {
        terrain.use(r);
        const a = terrain.heightAt(0, 0), b = terrain.heightAt(100, -50);
        rows[r] = { node: [a, b], browser: [META[r].h00, META[r].h_100_50],
            relief: [r2(META[r].min), r2(META[r].max)], windDirection: META[r].windDirection,
            landformHeightScale: META[r].landformHeightScale };
        ok = ok && a === META[r].h00 && b === META[r].h_100_50;
    }
    terrain.use("cold");
    check("terrain: Node heightAt on the exported mirror is bit-identical to the browser's", ok, rows);
}

// ------------------------------------------------------------ GPU stubs
const scene = { add() {}, remove() {} };
const box = (v) => ({ value: v });
const uniforms = {
    sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0),
    uSunDir: box(new THREE.Vector3(0, 1, 0)), uSunColor: box(new THREE.Vector3(1, 1, 1)),
    uResolution: box(new THREE.Vector2(1, 1)),
};
const shadows = { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; } };
const crystals = { scene, shadows, material: { uniforms } };
const rig = {
    yaw: 0,
    getFlatForward(out) { return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); },
    getFlatRight(out) { return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)); },
    addTrauma() {},
    camera: { matrixWorld: new THREE.Matrix4() },
};
const vis = {
    _slotInst: [],
    spawnUnit(i) { this._slotInst[i] = { tint: new Float32Array([1, 1, 1, 0]), state: new Float32Array(4) }; },
    spawn(i) { this.spawnUnit(i); },
    free(i) { this._slotInst[i] = null; },
    drive() {}, driveBolt() {}, update() {},
};

// ---------------------------------------------------------------- world
const LOGGED = ["cache:discovered", "cache:opened", "reward", "trial:started", "trial:gate",
    "trial:finished", "trial:failed", "bounty:revealed", "bounty:killed", "enemy:killed"];
function buildWorld() {
    terrain.use("cold");
    const registry = new DamageableRegistry();
    const character = new CharacterController(terrain);
    character.position.set(0, terrain.heightAt(0, 0), 0);
    const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);
    const landmarks = new Landmarks(terrain, crystals, shrine);
    const enemies = new Enemies(scene, terrain, registry, character, combatData, null);
    enemies.attachVis(vis);
    const progression = new Progression(character, registry, null);
    progression.attach({ enemies });
    shrine.register(progression);
    enemies.progression = progression;
    progression.graceUntil = 1e9;       // the rider takes no damage in this probe
    const ctx = {
        scene, terrain, character, rig, registry, enemies, shrine, landmarks, progression,
        crystals, bus, input, S: { sssStrength: 1, sssRadius: 1, glintIntensity: 0.55, glintGrazing: 1 },
        getRealm: () => landmarks.realm,
    };
    const log = [];
    const offs = LOGGED.map((t) => bus.on(t, (p) => log.push({ t, p: JSON.parse(JSON.stringify(p)) })));
    const caches = new C.RelicCaches(ctx); ctx.caches = caches;
    const trials = new T.WakeTrials(ctx); ctx.trials = trials;
    const bounties = new B.Bounties(ctx);
    const beacon = new W.WaypointBeacon(ctx);
    return { registry, character, shrine, landmarks, enemies, progression, ctx, log, caches,
        trials, bounties, beacon, offs, t: 0, realm: "cold" };
}
function dispose(w) {
    for (const o of w.offs) o();
    w.caches.dispose(); w.trials.dispose(); w.bounties.dispose(); w.beacon.dispose();
}
const DT = 1 / 60;
function step(w, n, each) {
    for (let i = 0; i < n; i++) {
        w.registry.update(DT);
        w.character.update(DT, rig);
        w.enemies.update(DT);
        w.progression.update(DT);
        w.shrine.update(DT);
        w.landmarks.update(DT);
        w.caches.update(DT);
        w.trials.update(DT);
        w.bounties.update(DT);
        w.beacon.update(DT);
        if (each) each();
        w.registry.endFrame();
        w.t += DT;
    }
}
function until(w, pred, maxS, each) {
    const n = Math.ceil(maxS / DT);
    for (let i = 0; i < n; i++) { step(w, 1, each); if (pred()) return true; }
    return false;
}
function tp(w, x, z, facing) {
    const c = w.character;
    c.position.set(x, terrain.heightAt(x, z), z);
    c.velocity.set(0, 0, 0);
    if (facing !== undefined) { c.facing = facing; rig.yaw = facing; }
}
/** main.js enterRealm order: sweep, ground (re-bake), shrine, landmarks, then
 *  the lane-W setRealm hooks the integrator adds. */
function enterRealm(w, t) {
    w.enemies.clear();
    terrain.use(t);
    w.shrine.setRealm(t);
    w.landmarks.setRealm(t);
    w.caches.setRealm(t); w.trials.setRealm(t); w.bounties.setRealm(t); w.beacon.setRealm(t);
    w.realm = t;
}
const ready = (w, t) => w.caches.readyRealm === t && w.trials.readyRealm === t
    && w.bounties.readyRealm === t;
const since = (w, i0, t) => w.log.slice(i0).filter((e) => !t || e.t === t);
function pinSurf(on) {
    if (on) Object.defineProperty(input, "surf", { get: () => true, configurable: true });
    else Object.defineProperty(input, "surf", { value: false, writable: true, configurable: true, enumerable: true });
}
function snapshot(w, realm) {
    return JSON.stringify({
        landmarks: w.landmarks.instances.filter((s) => s.realm === realm).map((s) => [s.type, s.x, s.z]),
        caches: w.caches.list(realm).map((c) => [c.site, c.kind, c.x, c.z]),
        trials: w.trials.trials.map((t) => [t.id, t.n, Array.from(t.gx), Array.from(t.gz)]),
        bounties: w.bounties.list(realm).map((b) => [b.id, b.x, b.z, b.place]),
    });
}

// ================================================================ pure math
{
    const par = 30;
    const cases = [[30, 3], [30.001, 2], [34.5, 2], [34.51, 1], [40.5, 1], [40.51, 0], [12, 3]];
    const got = cases.map(([t]) => T.medalFor(t, par));
    const trails = {};
    for (const r of ["cold", "sand", "ash"]) trails[r] = [0, 1, 2].map((k) => T.trailFor(r, k));
    const fades = {
        // the shader's read range: GLINT_FAR + the camera arm (camera distance)
        glint: { far: C.GLINT_FAR + C.GLINT_CAM_ARM, 60: G.glintFade(60, C.GLINT_FAR + C.GLINT_CAM_ARM),
            90: G.glintFade(90, C.GLINT_FAR + C.GLINT_CAM_ARM), 105: G.glintFade(105, C.GLINT_FAR + C.GLINT_CAM_ARM),
            115: r2(G.glintFade(115, C.GLINT_FAR + C.GLINT_CAM_ARM)), 126: G.glintFade(126, C.GLINT_FAR + C.GLINT_CAM_ARM) },
        beacon: { 4: G.beaconFade(4, 400, 15), 10: r2(G.beaconFade(10, 400, 15)), 15: G.beaconFade(15, 400, 15),
            200: G.beaconFade(200, 400, 15), 400: G.beaconFade(400, 400, 15), 420: r2(G.beaconFade(420, 400, 15)),
            440: G.beaconFade(440, 400, 15) },
    };
    const allTrails = [...trails.cold, ...trails.sand, ...trails.ash].filter(Boolean);
    check("math: medals at <= 1.35x / 1.15x / 1.0x par; trail pairs; glint (rider 90 m + 15 m camera arm) + beacon fades",
        JSON.stringify(got) === JSON.stringify(cases.map((c) => c[1]))
        && new Set(allTrails).size === 6 && allTrails.every((id) => STORY.trails[id])
        && trails.cold[2] === null && fades.glint[90] === 1 && fades.glint[105] === 1 && fades.glint[126] === 0
        && fades.beacon[200] === 1 && fades.beacon[400] === 1 && fades.beacon[15] === 1
        && fades.beacon[4] === 0 && fades.beacon[440] === 0,
        { par, cases: cases.map((c, i) => ({ time: c[0], want: c[1], got: got[i] })), trails, fades });
}

// ================================================================ battery
localStorage.clear();
let w = buildWorld();
const SNAP = {};
const PAIRS = {};
const BUILD = {};

for (const realm of ["cold", "sand", "ash"]) {
    if (realm !== "cold") enterRealm(w, realm);
    const t0 = w.t;
    const ok = until(w, () => ready(w, realm), 60);
    BUILD[realm] = { frames: Math.round((w.t - t0) / DT), buildCpuMs: w.trials.stats.buildCpuMs,
        buildFrames: w.trials.stats.buildFrames, buildMaxSliceMs: w.trials.stats.buildMaxSliceMs };
    check(realm + ": caches, trials and bounties ready on the real ground", ok,
        Object.assign({ landmarks: w.landmarks.instances.filter((s) => s.realm === realm).length }, BUILD[realm]));
    SNAP[realm] = snapshot(w, realm);
    const inst = w.landmarks.instances.filter((s) => s.realm === realm);
    const shr = w.shrine.positions;

    // ---------------------------------------------------------- caches
    const L = w.caches.list();
    const kinds = { relic: 0, lore: 0, grand: 0 };
    for (const c of L) kinds[c.kind]++;
    let minPrism = 1e9, minShrine = 1e9, maxGrade = 0, maxEdge = 0;
    const perSite = [];
    for (const c of L) {
        const li = inst[c.site];
        const cl = C.landmarkClearance(w.landmarks, li, terrain, c.x, c.z);
        let ds = 1e9;
        for (const s of shr) ds = Math.min(ds, Math.hypot(c.x - s.x, c.z - s.z));
        const e = 1, hx = (terrain.heightAt(c.x + e, c.z) - terrain.heightAt(c.x - e, c.z)) / 2,
            hz = (terrain.heightAt(c.x, c.z + e) - terrain.heightAt(c.x, c.z - e)) / 2;
        const gr = Math.hypot(hx, hz);
        minPrism = Math.min(minPrism, cl); minShrine = Math.min(minShrine, ds);
        maxGrade = Math.max(maxGrade, gr); maxEdge = Math.max(maxEdge, terrain.edge01(c.x, c.z));
        perSite.push([c.site, c.kind[0], li.label, r1(Math.hypot(c.x - li.x, c.z - li.z))]);
    }
    const kindBySite = L.map((c) => c.kind[0]).join("");
    const relicSites = L.filter((c) => c.kind === "relic").map((c) => c.site);
    check(realm + ": 15 caches at the 15 real landmark sites, 2 relic / 12 lore / 1 grand, clear + walkable",
        L.length === 15 && inst.length === 15 && kinds.relic === 2 && kinds.lore === 12 && kinds.grand === 1
        && w.caches.stats.placeFallbacks === 0 && minPrism >= 2.0 && maxGrade <= 0.5 && maxEdge === 0
        && L.every((c) => c.x === w.caches.x[c.site] && !c.approx),
        { kinds, kindBySite, relicSites, placeFallbacks: w.caches.stats.placeFallbacks,
            minPrismClearM: r2(minPrism), maxGrade: r2(maxGrade), minShrineDistM: r1(minShrine),
            siteKindLandmarkOffsetM: perSite });

    // ---------------------------------------------------------- trials
    const tl = w.trials.trials;
    const defs = STORY.trials[realm];
    const tsum = tl.map((t) => ({ id: t.id, name: t.name, gates: t.n, lenM: r1(t.len), par: r2(t.par),
        idealReplay: r2(t.ideal), wants: LANDMARK_TYPES[defs[t.k].landmark].label,
        passes: t.passLabel, passDistM: r1(t.passD) }));
    check(realm + ": 3 trials, 8-12 gates, gold-able, each passes its STORY landmark type (<= 60 m)",
        tl.length === 3 && w.trials.stats.failed === 0
        && tl.every((t) => t.n >= 8 && t.n <= 12 && t.ideal <= t.par * 0.97
            && t.passD <= T.PASS_MAX_M && t.passLabel === LANDMARK_TYPES[defs[t.k].landmark].label
            && t.id === defs[t.k].id && Math.abs(t.par - t.len / 11) < 1e-9),
        { trials: tsum, failed: w.trials.stats.failed, rejectedForPassage: w.trials.stats.rejectedPass });

    // Independent re-validation of EVERY gate pair: 4 m sliding-window grade
    // at 1 m steps (the build's own grid, SAMPLE_M = 1), shaft clearance of every landmark,
    // shrine / cache / other-trial distances, storm band, ring cross-slope.
    const rows = [];
    let worst = { up: -1, down: -1, prism: 1e9, shrine: 1e9, cache: 1e9, other: 1e9, maxR: 0, edge: 0, ring05: -9,
        ring08: -9, turn: 0 };
    for (const tr of tl) {
        for (let i = 0; i + 1 < tr.n; i++) {
            const ax = tr.gx[i], az = tr.gz[i], bx = tr.gx[i + 1], bz = tr.gz[i + 1];
            const len = Math.hypot(bx - ax, bz - az);
            const ux = (bx - ax) / len, uz = (bz - az) / len;
            let up = -9, down = -9, prism = 1e9, sh = 1e9, ca = 1e9, ot = 1e9, mr = 0, ed = 0;
            const steps = Math.ceil(len);
            for (let s = 0; s <= steps; s++) {
                const f = s / steps, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
                if (s > 0) {
                    const g = (terrain.heightAt(x, z) - terrain.heightAt(x - ux * 4, z - uz * 4)) / 4;
                    up = Math.max(up, g); down = Math.max(down, -g);
                }
                for (const li of inst) prism = Math.min(prism, C.landmarkClearance(w.landmarks, li, terrain, x, z));
                for (const p of shr) sh = Math.min(sh, Math.hypot(x - p.x, z - p.z));
                for (let c = 0; c < 15; c++) ca = Math.min(ca, Math.hypot(x - w.caches.x[c], z - w.caches.z[c]));
                for (const o of tl) if (o !== tr) for (let g = 0; g < o.n; g++) ot = Math.min(ot, Math.hypot(x - o.gx[g], z - o.gz[g]));
                mr = Math.max(mr, Math.hypot(x, z)); ed = Math.max(ed, terrain.edge01(x, z));
            }
            // ring cross-slope rise under the ring at 0.5R and 0.8R across, on
            // the heading the ring is DRAWN with (gate i+1; gate 0 with pair 1)
            const ringAt = (gi, u) => {
                const h = tr.heading[gi], txx = Math.cos(h), tzz = Math.sin(h);
                const x0 = tr.gx[gi], z0 = tr.gz[gi], g0 = terrain.heightAt(x0, z0);
                return Math.max(terrain.heightAt(x0 + txx * u, z0 + tzz * u) - g0,
                    terrain.heightAt(x0 - txx * u, z0 - tzz * u) - g0);
            };
            let ring05 = ringAt(i + 1, 0.5 * T.GATE_R), ring08 = ringAt(i + 1, 0.8 * T.GATE_R);
            if (i === 0) {
                ring05 = Math.max(ring05, ringAt(0, 0.5 * T.GATE_R));
                ring08 = Math.max(ring08, ringAt(0, 0.8 * T.GATE_R));
            }
            const ring = Math.max(ring05, ring08);
            let turn = 0;
            if (i > 0) {
                const a1 = Math.atan2(ax - tr.gx[i - 1], az - tr.gz[i - 1]), a2 = Math.atan2(bx - ax, bz - az);
                turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
                turn *= 180 / Math.PI;
            }
            const drop = terrain.heightAt(ax, az) - terrain.heightAt(bx, bz);
            rows.push({ id: tr.id, pair: i + 1 + "-" + (i + 2), lenM: r1(len), dropM: r2(drop), maxUp: r2(up),
                maxDown: r2(down), prismClearM: r1(prism), shrineM: r1(sh), cacheM: r1(ca), otherTrialM: r1(ot),
                maxR: r1(mr), ringRiseM: r2(ring), turnDeg: r1(turn) });
            worst = { up: Math.max(worst.up, up), down: Math.max(worst.down, down), prism: Math.min(worst.prism, prism),
                shrine: Math.min(worst.shrine, sh), cache: Math.min(worst.cache, ca), other: Math.min(worst.other, ot),
                maxR: Math.max(worst.maxR, mr), edge: Math.max(worst.edge, ed),
                ring05: Math.max(worst.ring05, ring05), ring08: Math.max(worst.ring08, ring08),
                turn: Math.max(worst.turn, turn) };
        }
    }
    PAIRS[realm] = rows;
    for (const row of rows) console.log("  PAIR " + realm + " " + JSON.stringify(row));
    const wv = {};
    for (const k in worst) wv[k] = r2(worst[k]);
    check(realm + ": every gate pair of all 3 trials re-validated (grade / clearance / band / ring)",
        rows.length === tl.reduce((a, t) => a + t.n - 1, 0)
        && worst.up <= 0.30 * 1.02 && worst.down <= 0.85 && worst.prism >= 5.0 && worst.shrine >= 25
        && worst.cache >= 10 && worst.other >= 30 && worst.maxR <= 520 && worst.edge === 0
        && worst.ring05 <= 0.8 && worst.ring08 <= 1.6 && worst.turn <= 36.5,
        { pairs: rows.length, worst: wv, limits: { up: 0.30, down: 0.85, prismClear: ">= 5 here (6 + radius at build, 1 m samples)",
            shrine: 25, cache: 10, otherTrial: 30, maxR: 520, ringRise: "0.8 @0.5R / 1.6 @0.8R", turn: 36 } });

    // --------------------------------------------------------- bounties
    const bl = w.bounties.list();
    const units = bl.map((b) => ({ id: b.id, unit: b.unit, inRoster: w.enemies.unitIndex(b.unit) >= 0,
        rosterRealm: (combatData.ENEMIES.find((e) => e.key === b.unit) || {}).realm || null, place: b.place,
        lastSeen: b.lastSeen, relic: b.relic }));
    check(realm + ": 3 bounties from STORY, real roster units of this realm, sited at named landmarks",
        bl.length === 3 && bl.every((b, k) => b.id === STORY.bounties[realm][k].id && b.x !== null && b.place)
        && units.every((u) => u.inRoster && u.rosterRealm === realm) && new Set(bl.map((b) => b.place)).size === 3
        && bl[2].relic === C.relicFor(realm, "bounty").id,
        units);

    // ---------------------------------------------------------- open one of each kind (E edge)
    for (const kind of ["relic", "lore", "grand"]) {
        const c = w.caches.list().find((e) => e.kind === kind && !e.opened);
        const i0 = w.log.length;
        tp(w, c.x + 2.2, c.z);
        step(w, 2);
        const target = w.caches.interactTarget;
        input.interactPressed = true; step(w, 1); input.interactPressed = false;
        step(w, 40);
        const evs = since(w, i0).filter((e) => e.t === "cache:opened" || e.t === "reward");
        const rw = evs.filter((e) => e.t === "reward").map((e) => e.p);
        const op = evs.filter((e) => e.t === "cache:opened").map((e) => e.p);
        let good = target === c.site && w.caches.isOpened(realm, c.site) && op.length === 1
            && op[0].kind === kind && op[0].site === c.site && op[0].realm === realm;
        if (kind === "relic") {
            const want = C.relicFor(realm, relicSites.indexOf(c.site) === 0 ? "cache0" : "cache1").id;
            good = good && rw.length === 1 && rw[0].kind === "relic" && rw[0].id === want && rw[0].realm === realm;
        }
        if (kind === "lore") {
            good = good && rw.length === 2 && rw.some((r) => r.kind === "lore" && r.id === STORY.lore[realm][0].id)
                && rw.some((r) => r.kind === "glass" && r.amount >= 8 && r.amount <= 15);
        }
        if (kind === "grand") good = good && rw.length === 1 && rw[0].kind === "glass" && rw[0].amount === 60;
        const i1 = w.log.length;
        input.interactPressed = true; step(w, 1); input.interactPressed = false;
        good = good && since(w, i1, "cache:opened").length === 0 && since(w, i1, "reward").length === 0;
        check(realm + ": E within 3 m opens a " + kind + " cache -> cache:opened + reward(s), exactly once", good,
            { site: c.site, landmark: c.landmark, interactTarget: target,
                events: evs.map((e) => e.t === "reward" ? { reward: e.p.kind, id: e.p.id, amount: e.p.amount, source: e.p.source }
                    : { opened: e.p.kind, site: e.p.site, loot: e.p.loot }) });
    }
    // A second and third lore cache pay shards 2 and 3 (escalation order);
    // the router path (tryInteract) opens with readsInput off.
    {
        const lore = w.caches.list().filter((e) => e.kind === "lore" && !e.opened);
        const got = [];
        w.caches.readsInput = false;
        for (let j = 0; j < 2; j++) {
            const c = lore[j];
            const i0 = w.log.length;
            tp(w, c.x + 2.2, c.z);
            step(w, 2);
            input.interactPressed = true; step(w, 1); input.interactPressed = false;
            const ignored = !w.caches.isOpened(realm, c.site);
            const loot = w.caches.tryInteract();
            step(w, 2);
            got.push({ site: c.site, edgeIgnored: ignored, lore: loot && loot.lore,
                rewards: since(w, i0, "reward").map((e) => e.p.id) });
        }
        w.caches.readsInput = true;
        const miss = (tp(w, 0, 0), step(w, 2), w.caches.tryInteract());
        check(realm + ": lore escalates in STORY order; tryInteract() router path; nothing in reach -> null",
            got[0].edgeIgnored && got[1].edgeIgnored && got[0].lore === STORY.lore[realm][1].id
            && got[1].lore === STORY.lore[realm][2].id && miss === null
            && JSON.stringify(w.caches.loreCollected(realm)) === JSON.stringify(STORY.lore[realm].slice(0, 3).map((s) => s.id)),
            { opened: got, loreCollected: w.caches.loreCollected(realm) });
    }
    // Discovery: 'cache:discovered' once per site, inside 90 m.
    {
        const c = w.caches.list().find((e) => !e.discovered);
        if (c) {
            let dir = Math.hypot(c.x, c.z) > 1 ? -1 : 1;
            const ux = c.x / (Math.hypot(c.x, c.z) || 1), uz = c.z / (Math.hypot(c.x, c.z) || 1);
            const i0 = w.log.length;
            let at = null;
            for (let d = 110; d >= 70 && at === null; d -= 2) {
                tp(w, c.x + dir * ux * d, c.z + dir * uz * d);
                step(w, 1);
                if (since(w, i0, "cache:discovered").some((e) => e.p.site === c.site)) at = d;
            }
            step(w, 5);
            const n = since(w, i0, "cache:discovered").filter((e) => e.p.site === c.site).length;
            check(realm + ": 'cache:discovered' fires once, on entering the 90 m glint range",
                at !== null && at <= 90 && at > 86 && n === 1 && w.caches.list().find((e) => e.site === c.site).discovered,
                { site: c.site, discoveredAtM: at, events: n });
        } else {
            check(realm + ": 'cache:discovered' fires once, on entering the 90 m glint range", false, "all discovered already");
        }
    }

    // ---------------------------------------------------------- trial runs (real controller)
    const runs = [];
    for (let k = 0; k < tl.length; k++) {
        const tr = tl[k];
        const i0 = w.log.length;
        tp(w, tr.gx[0] - tr.nx[0] * 45, tr.gz[0] - tr.nz[0] * 45, Math.atan2(tr.nx[0], -tr.nz[0]));
        step(w, 2);
        pinSurf(true);
        let sum = 0, n = 0;
        const done = until(w, () => since(w, i0).some((e) => (e.t === "trial:finished"
            || e.t === "trial:failed") && e.p.id === tr.id), 150, () => {
            const i = w.trials.activeIdx === k ? w.trials.next : 0;
            const p = w.character.position;
            rig.yaw = Math.atan2(tr.gx[i] - p.x, -(tr.gz[i] - p.z));
            if (w.trials.activeIdx === k) { sum += w.character.speed; n++; }
        });
        pinSurf(false);
        step(w, 30);
        const evs = since(w, i0);
        const fin = evs.find((e) => e.t === "trial:finished");
        const fail = evs.find((e) => e.t === "trial:failed");
        const gates = evs.filter((e) => e.t === "trial:gate").map((e) => r2(e.p.time));
        runs.push({ id: tr.id, done, gates: tr.n, gateEvents: gates.length, par: r2(tr.par),
            time: fin ? r2(fin.p.time) : null, medal: fin ? fin.p.medal : null, firstMedal: fin ? fin.p.firstMedal : null,
            failed: fail ? fail.p.reason : null, meanSpeed: n ? r2(sum / n) : null,
            rewards: evs.filter((e) => e.t === "reward").map((e) => [e.p.kind, e.p.id, e.p.amount]),
            record: w.trials.record(tr.id) });
    }
    for (const r of runs) console.log("  RUN " + realm + " " + JSON.stringify(r));
    const medals = runs.filter((r) => r.medal >= 1);
    // Rewards must match the tiers reached (first time): bronze 20, silver 40 + trail, gold 60 (+ relic on trial 3).
    const rewardOK = runs.every((r) => {
        if (!(r.medal >= 1)) return r.rewards.length === 0;
        const k = tl.findIndex((t) => t.id === r.id);
        const glass = [0, 20, 60, 120][r.medal];
        const g = r.rewards.filter((x) => x[0] === "glass").reduce((a, x) => a + x[2], 0);
        const tr = r.rewards.filter((x) => x[0] === "trail");
        const rel = r.rewards.filter((x) => x[0] === "relic");
        return g === glass && tr.length === (r.medal >= 2 ? 1 : 0)
            && (tr.length === 0 || tr[0][1] === T.trailFor(realm, tl[k].k))
            && rel.length === (r.medal === 3 && tl[k].k === 2 ? 1 : 0)
            && (rel.length === 0 || rel[0][1] === C.relicFor(realm, "trial").id);
    });
    check(realm + ": trials surfed with pinned surf input (real controller, real ground) -> medals + tier rewards",
        medals.length >= 1 && rewardOK && runs.every((r) => r.done && (r.failed || r.gateEvents === r.gates)),
        { medals: medals.length + "/" + runs.length, rewardsMatchTiers: rewardOK,
            summary: runs.map((r) => [r.id, r.time, r.medal, r.failed]) });

    if (realm === "cold") {
        // A repeat that does not beat the record pays nothing; the record holds the best.
        const tr = tl.find((t) => w.trials.record(t.id).medal >= 1);
        if (tr) {
            const before = Object.assign({}, w.trials.record(tr.id));
            const i0 = w.log.length;
            w.trials.activeIdx = w.trials.trials.indexOf(tr);
            w.trials._finish(before.best + 5);
            const evs = since(w, i0);
            const fin = evs.find((e) => e.t === "trial:finished").p;
            check("cold: a slower repeat keeps the best time + medal and pays nothing",
                w.trials.record(tr.id).best === before.best && w.trials.record(tr.id).medal === before.medal
                && fin.newBest === false && fin.firstMedal === false && evs.filter((e) => e.t === "reward").length === 0,
                { before, after: w.trials.record(tr.id), finished: fin });
        }
        // Missing a gate by > 4 m fails the run (and it restarts at gate 1).
        {
            const tr = tl[0];
            const k = 0;
            const i0 = w.log.length;
            tp(w, tr.gx[0] - tr.nx[0] * 45, tr.gz[0] - tr.nz[0] * 45, Math.atan2(tr.nx[0], -tr.nz[0]));
            step(w, 2);
            pinSurf(true);
            let lat = null;
            until(w, () => since(w, i0).some((e) => e.t === "trial:failed" || e.t === "trial:finished"), 60, () => {
                const i = w.trials.activeIdx === k ? w.trials.next : 0;
                const p = w.character.position;
                // aim 13 m to the side of gate 3 (index 2); true line otherwise
                let ax = tr.gx[i], az = tr.gz[i];
                if (i === 2) { ax += tr.nz[i] * 13; az -= tr.nx[i] * 13; }
                rig.yaw = Math.atan2(ax - p.x, -(az - p.z));
                if (w.trials.activeIdx === k && i === 2) lat = w.trials._lateral(tr, 2, p);
            });
            pinSurf(false);
            step(w, 10);
            const fail = since(w, i0, "trial:failed").map((e) => e.p);
            const gates = since(w, i0, "trial:gate").map((e) => e.p.gate);
            check("cold: crossing a gate > 4 m outside its ring fails the run ('missed'), back to gate 1",
                fail.length === 1 && fail[0].reason === "missed" && gates.join() === "1,2"
                && w.trials.activeIdx === -1 && lat !== null && lat > T.GATE_R + T.MISS_M,
                { failed: fail, gatesPassed: gates, lateralAtCrossM: lat === null ? null : r1(lat) });
        }
        // Crossing gate 1 on foot does not start a trial.
        {
            const tr = tl[1];
            const i0 = w.log.length;
            pinSurf(false);
            tp(w, tr.gx[0] - tr.nx[0] * 20, tr.gz[0] - tr.nz[0] * 20); step(w, 20);
            tp(w, tr.gx[0] - tr.nx[0] * 1, tr.gz[0] - tr.nz[0] * 1); step(w, 2);
            tp(w, tr.gx[0] + tr.nx[0] * 1, tr.gz[0] + tr.nz[0] * 1); step(w, 2);
            check("cold: walking through gate 1 does not start a trial (surf to begin)",
                since(w, i0, "trial:started").length === 0 && w.trials.activeIdx === -1
                && w.trials._msg === "Surf through the gate to begin",
                { started: since(w, i0, "trial:started").length, msg: w.trials._msg });
        }
    }

    // ---------------------------------------------------------- bounties: all three
    for (let k = 0; k < 3; k++) {
        const def = STORY.bounties[realm][k];
        const sx = w.bounties.sx[k], sz = w.bounties.sz[k];
        const rr = Math.hypot(sx, sz) || 1;
        const ux = sx / rr, uz = sz / rr;
        tp(w, sx - ux * 110, sz - uz * 110);
        const i0 = w.log.length;
        step(w, 10);
        const early = w.bounties.liveId[k];
        let revealAt = null;
        for (let d = 110; d >= 60 && revealAt === null; d -= 1) {
            tp(w, sx - ux * d, sz - uz * d);
            step(w, 1);
            if (w.bounties.liveId[k] >= 0) revealAt = d;
        }
        const id = w.bounties.liveId[k];
        const s = w.registry.slot(id);
        const level = s >= 0 ? w.registry.level[s] : null;
        // The same unit at the same level, spawned plainly — the 1x reference.
        const refId = w.enemies.spawn(def.unit, sx + 30, sz, level);
        const rs = w.registry.slot(refId);
        const refHp = rs >= 0 ? w.registry.hpMax[rs] : null;
        if (refId >= 0) w.enemies.despawn(refId);
        const expectLevel = Math.min(30, combatData.enemyLevelFor(realm, w.progression.level, 0.5) + 3);
        let slotI = -1;
        for (let i = 0; i < w.enemies.id.length; i++) if (w.enemies.alive[i] && w.enemies.id[i] === id) slotI = i;
        step(w, 2);
        const inst = vis._slotInst[slotI];
        const rev = since(w, i0, "bounty:revealed").map((e) => e.p);
        const rv = { id: def.id, unit: def.unit, revealedAtM: revealAt, notLiveAt110m: early === -1,
            name: s >= 0 ? w.registry.name[s] : null, level, expectLevel, playerLevel: w.progression.level,
            hpMax: s >= 0 ? r1(w.registry.hpMax[s]) : null, plainUnitHpMax: refHp === null ? null : r1(refHp),
            hpRatio: s >= 0 && refHp ? Math.round(w.registry.hpMax[s] / refHp * 1000) / 1000 : null,
            tier: s >= 0 ? w.registry.tier[s] : null,
            tint: inst ? { rgb: Array.from(inst.tint).slice(0, 3).map(r2), mix: r2(inst.state[3]) } : null,
            revealed: rev.map((p) => [p.id, p.name, p.level]) };
        check(realm + ": bounty " + (k + 1) + " spawns inside 80 m: 2.5x HP, +3 levels, STORY name, unique tint",
            revealAt !== null && revealAt <= 80 && revealAt > 77 && early === -1 && rv.hpRatio === 2.5
            && rv.name === def.name && level === expectLevel && rv.tint && rv.tint.mix > 0.5
            && rv.tint.rgb.some((v) => Math.abs(v - 1) > 0.2) && rev.length === 1 && rev[0].registryId === id, rv);

        const P = w.progression;
        const before = { level: P.level, xp: P.xp, xpNeed: P.xpNeed };
        const i1 = w.log.length;
        w.registry.damage(id, w.registry.hp[s] + 100, { tag: "probe" });
        step(w, 10);
        const evs = since(w, i1).filter((e) => e.t === "bounty:killed" || e.t === "reward" || e.t === "enemy:killed");
        const rewards = evs.filter((e) => e.t === "reward").map((e) => e.p);
        const ek = evs.filter((e) => e.t === "enemy:killed").map((e) => e.p);
        const xpR = rewards.find((r) => r.kind === "xp");
        const relic = rewards.filter((r) => r.kind === "relic");
        check(realm + ": bounty " + (k + 1) + " killed -> bounty:killed, 40 glass, 15% XP once, enemy:killed.bounty"
            + (k === 2 ? ", the realm's 4th relic" : ""),
            w.bounties.isKilled(def.id) && evs.filter((e) => e.t === "bounty:killed").length === 1
            && rewards.some((r) => r.kind === "glass" && r.amount === 40)
            // 15% of XP_to_next of the level in force when it paid (the kill's own
            // XP lands first, so a ding in between makes it the new level's).
            && xpR && xpR.granted === true && (xpR.amount === Math.round(0.15 * before.xpNeed)
                || xpR.amount === Math.round(0.15 * combatData.xpToNext(P.level)))
            && ek.some((e) => e.bounty === def.id)
            && relic.length === (k === 2 ? 1 : 0) && (k !== 2 || relic[0].id === C.relicFor(realm, "bounty").id),
            { before, after: { level: P.level, xp: P.xp }, events: evs.map((e) => e.t === "reward"
                ? [e.t, e.p.kind, e.p.id, e.p.amount, e.p.granted || false] : [e.t, e.p.id, e.p.bounty || e.p.name]) });
        // Stays dead while the player stands on its site.
        const i2 = w.log.length;
        tp(w, sx + 8, sz);
        step(w, 120);
        if (k === 2) {
            check(realm + ": killed bounties stay dead (player on each site, 2 s)",
                [0, 1, 2].every((j) => w.bounties.isKilled(STORY.bounties[realm][j].id) && w.bounties.liveId[j] === -1)
                && since(w, i2, "bounty:revealed").length === 0, { liveIds: Array.from(w.bounties.liveId) });
        }
    }
}

// ------------------------------------------------ determinism: realm cycle back
{
    enterRealm(w, "cold");
    until(w, () => ready(w, "cold"), 60);
    const again = snapshot(w, "cold");
    check("determinism: cold -> sand -> ash -> cold re-places caches, trials, bounties bit-identically",
        again === SNAP.cold, { bytes: again.length, identical: again === SNAP.cold });
}

// ------------------------------------------------ beacon
{
    tp(w, -100, 0, Math.PI / 2);
    const i0 = w.log.length;
    bus.emit("quest:waypoint", { x: 100, z: 0, realm: "cold", label: "probe" });
    step(w, 2);
    const a = w.beacon._a.value;            // Float32Array (x, ground y, z, on)
    const onCold = w.beacon.visible;
    const foot = [a[0], r2(a[1]), a[2], a[3]];
    const footOK = a[0] === 100 && a[2] === 0 && a[3] === 1
        && Math.abs(a[1] - (terrain.heightAt(100, 0) - 0.2)) < 1e-4;   // float32 storage
    bus.emit("quest:waypoint", { x: 100, z: 0, realm: "sand", label: "elsewhere" });
    step(w, 2);
    const offOtherRealm = !w.beacon.visible;
    bus.emit("quest:waypoint", null);
    step(w, 2);
    void i0;
    // A re-bake under a STANDING waypoint re-grounds the foot (terrain.js
    // rebakeCount moves); a steady frame does not re-sample. Beacon-only
    // frames, so no other system sees the swapped ground.
    bus.emit("quest:waypoint", { x: 100, z: 0, realm: "cold", label: "probe" });
    w.beacon.update(DT);
    const yCold = a[1];
    terrain.use("sand");
    w.beacon.update(DT);
    const yRebaked = a[1];
    const sandGround = terrain.heightAt(100, 0) - 0.2;
    terrain.use("cold");
    w.beacon.update(DT);
    const yBack = a[1];
    const rebakeOK = Math.abs(yRebaked - sandGround) < 1e-4 && Math.abs(yBack - yCold) < 1e-6
        && Math.abs(yRebaked - yCold) > 0.05;
    bus.emit("quest:waypoint", null);
    w.beacon.update(DT);
    check("beacon: follows 'quest:waypoint' (grounded on the real ground, realm-gated, null clears, re-grounds on a re-bake), 1 draw",
        onCold && footOK && offOtherRealm && !w.beacon.visible && w.beacon.draws === 0 && rebakeOK,
        { onCold, foot, groundAtTarget: r2(terrain.heightAt(100, 0)), offOtherRealm,
            clearedVisible: w.beacon.visible,
            rebake: { footCold: r2(yCold), footAfterSandBake: r2(yRebaked), sandGround: r2(sandGround),
                footAfterColdBake: r2(yBack) } });
}

// ------------------------------------------------ draw budget (busy: gates + glints + beacon + bounty)
{
    const tr = w.trials.trials[0];
    tp(w, tr.gx[0] - tr.nx[0] * 20, tr.gz[0] - tr.nz[0] * 20);
    bus.emit("quest:waypoint", { x: tr.gx[tr.n - 1], z: tr.gz[tr.n - 1], realm: "cold" });
    step(w, 3);
    const d = { caches: w.caches.draws, trials: w.trials.draws, bounties: w.bounties.draws, beacon: w.beacon.draws };
    const total = d.caches + d.trials + d.bounties + d.beacon;
    const meshes = [w.caches.mesh, w.caches.glintMesh, w.trials.mesh, w.beacon.mesh];
    const single = meshes.every((m) => !Array.isArray(m.material) && m.geometry.groups.length === 0);
    check("draws: all four systems up = " + total + " draw calls (budget 5); one material, no groups, per mesh",
        total <= 5 && total >= 3 && single, { perSystem: d, total, singleMaterialNoGroups: single });
    bus.emit("quest:waypoint", null);
    step(w, 2);
}

// ------------------------------------------------ steady-frame allocation
if (typeof globalThis.gc === "function") {
    const c = w.caches.list().find((e) => !e.opened);
    tp(w, c.x + 6, c.z);
    bus.emit("quest:waypoint", { x: c.x + 40, z: c.z, realm: "cold" });
    step(w, 30);
    const sys = [w.caches, w.trials, w.bounties, w.beacon];
    // Indexed loops: a for...of over this megamorphic call site allocates
    // its own iterator objects — the HARNESS's bytes, not the systems'.
    const frame = () => { for (let j = 0; j < 4; j++) sys[j].update(DT); };
    for (let i = 0; i < 6000; i++) frame();   // warm the JIT (a short warm-up can catch a re-optimisation in the window)
    globalThis.gc(); globalThis.gc();
    const h0 = process.memoryUsage().heapUsed;
    const N = 20000;
    for (let i = 0; i < N; i++) frame();
    const h1 = process.memoryUsage().heapUsed;
    globalThis.gc(); globalThis.gc();
    const h2 = process.memoryUsage().heapUsed;
    const perFrame = (h1 - h0) / N;
    // Attribution: the same frames, one system at a time.
    const perSystem = {};
    for (let j = 0; j < 4; j++) {
        const s = sys[j];
        globalThis.gc(); globalThis.gc();
        const a0 = process.memoryUsage().heapUsed;
        for (let i = 0; i < N; i++) s.update(DT);
        perSystem[s.constructor.name] = r2((process.memoryUsage().heapUsed - a0) / N);
    }
    check("allocation: 20000 steady frames of the four systems allocate ~nothing (heap delta before GC)",
        perFrame < 8, { heapDeltaBytes: h1 - h0, bytesPerFrame: r2(perFrame), retainedAfterGC: h2 - h0,
            bytesPerFramePerSystem: perSystem });
    bus.emit("quest:waypoint", null);
} else {
    check("allocation: steady frames (run node with --expose-gc)", false, "gc not exposed");
}

// ------------------------------------------------ persistence: save -> fresh world ("reload")
w.progression.save();
const blob = JSON.parse(localStorage.getItem("driftwake_save"));
const saved = {
    opened: {}, seen: {}, records: JSON.parse(JSON.stringify(w.trials.records)),
    killed: Object.keys(w.bounties.killed).sort(), lore: ["cold", "sand", "ash"].flatMap((r) => w.caches.loreCollected(r)),
};
for (const r of ["cold", "sand", "ash"]) {
    saved.opened[r] = w.caches.list(r).filter((e) => e.opened).map((e) => e.site);
    saved.seen[r] = w.caches.list(r).filter((e) => e.discovered).map((e) => e.site);
}
check("save: the v4 blob carries quest.caches / cachesSeen / trials / bounties / lore",
    blob.quest && JSON.stringify(blob.quest.caches) === JSON.stringify(saved.opened)
    && JSON.stringify(blob.quest.cachesSeen) === JSON.stringify(saved.seen)
    && JSON.stringify(blob.quest.trials) === JSON.stringify(saved.records)
    && JSON.stringify(Object.keys(blob.quest.bounties).sort()) === JSON.stringify(saved.killed)
    && JSON.stringify(blob.quest.lore) === JSON.stringify(saved.lore) && saved.lore.length === 9,
    { caches: blob.quest.caches, trials: blob.quest.trials, bounties: blob.quest.bounties, lore: blob.quest.lore });

dispose(w);
w = buildWorld();
until(w, () => ready(w, "cold"), 60);
{
    const opened = {}, seen = {};
    for (const r of ["cold", "sand", "ash"]) {
        opened[r] = w.caches.list(r).filter((e) => e.opened).map((e) => e.site);
        seen[r] = w.caches.list(r).filter((e) => e.discovered).map((e) => e.site);
    }
    check("reload: opened + discovered caches, trial bests/medals, killed bounties, lore all restored",
        JSON.stringify(opened) === JSON.stringify(saved.opened) && JSON.stringify(seen) === JSON.stringify(saved.seen)
        && JSON.stringify(w.trials.records) === JSON.stringify(saved.records)
        && JSON.stringify(Object.keys(w.bounties.killed).sort()) === JSON.stringify(saved.killed)
        && JSON.stringify(["cold", "sand", "ash"].flatMap((r) => w.caches.loreCollected(r))) === JSON.stringify(saved.lore),
        { opened, records: w.trials.records, killed: Object.keys(w.bounties.killed).length });
    step(w, 120);   // past the 1.2 s rise
    const s0 = opened.cold[0];
    const s1 = w.caches.list("cold").find((e) => !e.opened).site;
    const PR = 15 * 8 * 4;
    const row2 = (s) => ({ coreGrow: r2(w.caches._texData[2 * PR + (s * 8) * 4]),
        coreGlow: r2(w.caches._texData[2 * PR + (s * 8) * 4 + 2]), glint: r2(w.caches._glB[s * 4 + 3]) });
    const o = row2(s0), u = row2(s1);
    check("reload: an opened cache is DRAWN opened (core shattered to 0.28, dark, no glint) vs unopened",
        o.coreGrow === 0.28 && o.coreGlow === 0 && o.glint === 0 && u.coreGrow === 1 && u.coreGlow >= 1 && u.glint > 1,
        { opened: Object.assign({ site: s0 }, o), unopened: Object.assign({ site: s1 }, u) });
    const i0 = w.log.length;
    for (let k = 0; k < 3; k++) { tp(w, w.bounties.sx[k] + 8, w.bounties.sz[k]); step(w, 90); }
    check("reload: killed bounties stay dead (player on each cold site, 1.5 s each)",
        since(w, i0, "bounty:revealed").length === 0 && Array.from(w.bounties.liveId).every((v) => v === -1),
        { revealed: since(w, i0, "bounty:revealed").length });
    w.progression.newGame();
    check("new run: caches / trials / bounties / lore reset",
        w.caches.counts("cold").found === 0 && Object.keys(w.trials.records).length === 0
        && Object.keys(w.bounties.killed).length === 0 && w.caches.loreCollected("cold").length === 0,
        { found: w.caches.counts("cold").found, trials: w.trials.records, killed: w.bounties.killed });
}

// ------------------------------------------------ determinism: a second, fresh world
{
    const w2 = w;
    const snaps = { cold: snapshot(w2, "cold") };
    for (const realm of ["sand", "ash"]) {
        enterRealm(w2, realm);
        until(w2, () => ready(w2, realm), 60);
        snaps[realm] = snapshot(w2, realm);
    }
    const same = ["cold", "sand", "ash"].map((r) => snaps[r] === SNAP[r]);
    check("determinism: a fresh world places every cache, trial gate and bounty site bit-identically",
        same.every(Boolean), { cold: same[0], sand: same[1], ash: same[2] });
}

// ------------------------------------------------ steady-frame allocation: the BUSY states
// (ash, after the new run: bounties alive again). A LIVE bounty (its tint
// re-asserted every frame) and a RUNNING trial (clock, plane tests, gate
// uniforms) are steady states too. Measured AFTER a 6000-frame warm-up (a
// short warm-up measures the interpreter, where every double boxes — not a
// steady frame). The parked rider would hit the trial's 24 s gate-to-gate
// timeout, so the segment clock is zeroed every 1000 frames (one SMI store).
if (typeof globalThis.gc === "function") {
    const sys = [w.caches, w.trials, w.bounties, w.beacon];
    const frame = () => { for (let j = 0; j < 4; j++) sys[j].update(DT); };
    const chunk = (n) => {
        for (let c = 0; c < n; c += 1000) {
            w.trials._segT = 0;
            const m = Math.min(1000, n - c);
            for (let i = 0; i < m; i++) frame();
        }
    };
    const measure = (n) => {
        chunk(6000);
        globalThis.gc(); globalThis.gc();
        const h0 = process.memoryUsage().heapUsed;
        chunk(n);
        return (process.memoryUsage().heapUsed - h0) / n;
    };
    // A: a live bounty, rider 30 m off its site, waypoint on it.
    const k = 0;
    tp(w, w.bounties.sx[k] + 30, w.bounties.sz[k]);
    step(w, 5);
    const live = w.bounties.liveId[k] >= 0;
    bus.emit("quest:waypoint", { x: w.bounties.sx[k], z: w.bounties.sz[k], realm: w.realm });
    const bLive = r2(measure(10000));
    const stillLive = w.bounties.liveId[k] >= 0;
    // B: a running trial, rider parked 10 m before gate 2 (on the line).
    const tr = w.trials.trials[0];
    tp(w, tr.gx[1] - tr.nx[1] * 10, tr.gz[1] - tr.nz[1] * 10);
    w.trials._start(0, 0);
    const bRun = r2(measure(10000));
    const stillRunning = w.trials.activeIdx === 0;
    w.trials._fail("realm");
    bus.emit("quest:waypoint", null);
    check("allocation: busy steady frames (live bounty; running trial) allocate ~nothing",
        live && stillLive && stillRunning && bLive < 8 && bRun < 8,
        { realm: w.realm, liveBounty: { live, stillLive, bytesPerFrame: bLive },
            runningTrial: { id: tr.id, stillRunning, bytesPerFrame: bRun } });
}

// ------------------------------------------------ info: time-sliced trial build cost
console.log("INFO trial build per realm (first build, 60 fps frames): " + JSON.stringify(BUILD));

// ------------------------------------------------ info: controller slope sign (out of lane)
{
    terrain.use("cold");
    // steepest 1 m gradient on a coarse grid near the centre
    let best = { g: 0, x: 0, z: 0, hx: 0, hz: 0 };
    for (let x = -300; x <= 300; x += 10) for (let z = -300; z <= 300; z += 10) {
        const hx = (terrain.heightAt(x + 1, z) - terrain.heightAt(x - 1, z)) / 2;
        const hz = (terrain.heightAt(x, z + 1) - terrain.heightAt(x, z - 1)) / 2;
        const g = Math.hypot(hx, hz);
        if (g > best.g && g < 0.5) best = { g, x, z, hx, hz };
    }
    const down = Math.atan2(-best.hx, best.hz);   // port frame: forward = (sin f, 0, -cos f) along -grad
    const out = {};
    for (const [name, f] of [["downhill", down], ["uphill", down + Math.PI]]) {
        const w3 = { character: new CharacterController(terrain) };
        const c = w3.character;
        c.position.set(best.x, terrain.heightAt(best.x, best.z), best.z);
        c.facing = f; rig.yaw = f;
        pinSurf(true);
        const fx = Math.sin(f), fz = -Math.cos(f);
        const hAhead = terrain.heightAt(best.x + fx * 2, best.z + fz * 2) - terrain.heightAt(best.x, best.z);
        for (let i = 0; i < 30; i++) { rig.yaw = f; c.update(DT, rig); }
        pinSurf(false);
        out[name] = { heightChange2mAhead: r2(hAhead), speedAfter0_5s: r2(c.speed) };
    }
    console.log("INFO controller slope term (controller.js is not lane W's): grade " + r2(best.g)
        + " at (" + best.x + "," + best.z + "): " + JSON.stringify(out));
}

const fails = RESULTS.filter((r) => !r[1]).length;
console.log("\nSUMMARY " + RESULTS.length + " checks, " + fails + " failed");
for (const [n, ok] of RESULTS) console.log((ok ? "  PASS " : "  FAIL ") + n);
process.exit(fails ? 1 : 0);
