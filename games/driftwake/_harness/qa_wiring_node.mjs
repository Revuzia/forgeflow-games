// qa_wiring_node.mjs -- the INTEGRATOR's Node-side wiring check (lane INT).
//
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_wiring_node.mjs
//
// main.js cannot be imported in Node (its boot() needs a WebGL2 context), so
// this probe TRANSPLANTS main.js's own meaning-layer source, verbatim, into a
// Node world of real game modules and runs it:
//   - the `[MEANING LAYER] imports` block is parsed and every import is
//     resolved with a real dynamic import() (path exists, name exported);
//   - the `[MEANING LAYER] construction` block is executed as written, with
//     main.js's own identifiers bound to real systems (CharacterController,
//     DamageableRegistry, Enemies, Progression, SpawnShrine, Landmarks, Hud,
//     Minimap, the game's own Heightfield on lane W's exported real heights);
//   - the frame is COMPOSED from main.js's `ending.drive()` line, its
//     `mods.update(dt)` line and its `frame: logic` / `frame: the UI` blocks,
//     in main.js's order (the order itself is asserted on the source);
//   - enterRealm is composed from main.js's three `[MEANING LAYER]` snippets
//     inside enterRealm (shop re-tint, lane W follow, realm:entered + R/U);
//   - the warm-up seed block and the finishWarmUp lines run as written.
// Static checks: every imported system is constructed AND updated AND
// exported on SNOWFLOW; frame order; warm-up list; pointer-lock guard; no
// Math.random in main.js; main.js's emits are in the bus catalogue.
// STUBBED (the same stand-ins as _harness/qa_ui_node.mjs, lane U): the DOM
// (node_dom_shim.mjs), GPU objects, the camera rig, the boss director (a
// gate-recording stub), the FFG shell. Exit 0 only if every check passes.
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { installDom, Element } from "./node_dom_shim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const HDIR = join(HERE, "_wa_heights");
if (!existsSync(join(HDIR, "meta.json"))) {
    console.log("FAIL real heightfields missing — run: python _harness/qa_wa_hbake.py");
    process.exit(2);
}
const MAIN = readFileSync(join(SRC, "main.js"), "utf8");
// The DOM shim BEFORE any game module is imported (core/loading.js reads
// document ids at import time).
const dom = installDom();
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;

const RESULTS = [];
function check(name, ok, detail) {
    RESULTS.push([name, !!ok]);
    console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail === undefined ? "" : detail));
}
const r1 = (v) => Math.round(v * 10) / 10;

// ================================================================ source regions
/** Text between the first line containing `startMark` (exclusive) and the
 *  next line containing `endMark` after it (exclusive). */
function region(startMark, endMark, from) {
    const a = MAIN.indexOf(startMark, from || 0);
    if (a < 0) return null;
    const a2 = MAIN.indexOf("\n", a) + 1;
    const b = MAIN.indexOf(endMark, a2);
    if (b < 0) return null;
    const b2 = MAIN.lastIndexOf("\n", b) + 1;
    return { text: MAIN.slice(a2, b2), start: a, end: b };
}
const R = {
    imports: region("[MEANING LAYER] imports BEGIN", "[MEANING LAYER] imports END"),
    construction: region("[MEANING LAYER] construction", "[MEANING LAYER] END"),
    worldRealm: region("[MEANING LAYER] lane W: world activities", "[MEANING LAYER] END"),
    realmPost: region("[MEANING LAYER] the realm is now in force", "[MEANING LAYER] END"),
    logic: region("[MEANING LAYER] frame: logic", "[MEANING LAYER] END"),
    ui: region("[MEANING LAYER] frame: the UI", "[MEANING LAYER] END"),
};
const SHOP_LINE = "if (mctx.shop) mctx.shop.setRealm(token);";
const missingRegions = Object.keys(R).filter((k) => !R[k]);
check("R0 main.js carries every [MEANING LAYER] region this probe transplants",
    missingRegions.length === 0 && MAIN.indexOf(SHOP_LINE) > 0,
    { missing: missingRegions, shopLine: MAIN.indexOf(SHOP_LINE) > 0 });
if (missingRegions.length) process.exit(1);

// ------------------------------------------------------------- imports, real
const IMPORTS = [];   // {local, exported, path}
for (const m of R.imports.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    for (const part of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const mm = part.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
        IMPORTS.push({ exported: mm[1], local: mm[2] || mm[1], path: m[2] });
    }
}
const BIND = {};
const importErr = [];
for (const im of IMPORTS) {
    try {
        const mod = await import(pathToFileURL(join(SRC, im.path)).href);
        if (!(im.exported in mod)) importErr.push(im.path + " has no export " + im.exported);
        else BIND[im.local] = mod[im.exported];
    } catch (e) {
        importErr.push(im.path + ": " + String(e && e.message || e).slice(0, 160));
    }
}
check("I1 every [MEANING LAYER] import resolves to a real export (dynamic import of the real module)",
    importErr.length === 0 && IMPORTS.length >= 20,
    { imports: IMPORTS.length, errors: importErr });

// ============================================================ static wiring
// The classes the block imports, and the variable each is constructed into.
const CLASSES = IMPORTS.filter((i) => /^[A-Z]/.test(i.local)).map((i) => i.local);
const ctorVar = {};
for (const m of R.construction.text.matchAll(/const\s+(\w+)\s*=\s*new\s+(\w+)\s*\(\s*mctx\s*\)/g)) ctorVar[m[2]] = m[1];
const notBuilt = CLASSES.filter((c) => !ctorVar[c]);
const doubleBuilt = CLASSES.filter((c) => (R.construction.text.match(new RegExp("new\\s+" + c + "\\s*\\(", "g")) || []).length !== 1);
check("S1 every imported meaning-layer class is constructed exactly once, with the shared ctx (mctx)",
    notBuilt.length === 0 && doubleBuilt.length === 0,
    { built: ctorVar, notBuilt, builtTwiceOrNever: doubleBuilt });

const frameBody = (() => {
    const a = MAIN.indexOf("function frame() {");
    const b = MAIN.indexOf("function startShell()");
    return a > 0 && b > a ? MAIN.slice(a, b) : "";
})();
const vars = Object.values(ctorVar);
const notUpdated = vars.filter((v) => (frameBody.match(new RegExp("\\b" + v + "\\.update\\(dt\\);", "g")) || []).length !== 1);
check("S2 every constructed system is updated exactly once per frame (update(dt), game clock) inside frame()",
    notUpdated.length === 0, { systems: vars.length, notUpdatedOnce: notUpdated });

const sf = (() => {
    const a = MAIN.indexOf("globalThis.SNOWFLOW = {");
    const b = MAIN.indexOf("globalThis.DRIFTWAKE = globalThis.SNOWFLOW;");
    return a > 0 && b > a ? MAIN.slice(a, b) : "";
})();
const sfMeaning = sf.slice(sf.indexOf("[MEANING LAYER]"));
const notExported = vars.filter((v) => !new RegExp("\\b" + v + "\\b").test(sfMeaning));
check("S3 every constructed system is exported on SNOWFLOW (quests / world / rewards / ui), plus bus and the shared ctx",
    notExported.length === 0 && /\bbus:\s*questBus\b/.test(sfMeaning) && /\bmeaning:\s*mctx\b/.test(sfMeaning),
    { notExported });

// Frame order on the source.
const pos = (s, from) => frameBody.indexOf(s, from || 0);
const ord = {
    rigUpdate: pos("rig.update(dt,"), endingDrive: pos("ending.drive();"), postUpdate: pos("post.update(dt,"),
    spellHits: pos("spellHits.update(dt);"), mods: pos("mods.update(dt);"), shrineUpd: pos("shrine.update(dt);"),
    progression: pos("progression.update(dt);"), logic: pos("[MEANING LAYER] frame: logic"),
    autosave: pos("autosaveT += dt;"), spellbar: pos("spellbar.update();"), ui: pos("[MEANING LAYER] frame: the UI"),
    hud: pos("hud.update();"), regEnd: pos("registry.endFrame();"), endFrame: pos("        endFrame();"),
};
const orderOK = ord.rigUpdate > 0 && ord.rigUpdate < ord.endingDrive && ord.endingDrive < ord.postUpdate
    && ord.spellHits < ord.mods && ord.mods < ord.shrineUpd
    && ord.progression < ord.logic && ord.logic < ord.autosave
    && ord.spellbar < ord.ui && ord.ui < ord.hud && ord.hud < ord.regEnd && ord.regEnd < ord.endFrame;
check("S4 frame order: rig.update < ending.drive < post.update; spellHits < mods < shrine; progression < logic block; UI block < hud.update < registry.endFrame < endFrame()",
    orderOK, ord);

// enterRealm order on the source.
const er = (() => {
    const a = MAIN.indexOf("async function enterRealm(name) {");
    const b = MAIN.indexOf("const encounters = new Encounters(");
    return a > 0 && b > a ? MAIN.slice(a, b) : "";
})();
const eo = {
    wakeApply: er.indexOf("wake.applyRealm("), shop: er.indexOf(SHOP_LINE), landmarks: er.indexOf("landmarks.setRealm(token);"),
    world: er.indexOf("mctx.caches.setRealm(token);"), sky: er.indexOf("await sky.solve();"),
    token: er.indexOf("realmToken = token;"), emit: er.indexOf('questBus.emit("realm:entered", { realm: token });'),
    ret: er.indexOf("return token;"),
};
check("S5 enterRealm: shop re-tint after wake.applyRealm; lane W follow after landmarks.setRealm; 'realm:entered' AFTER realmToken = token",
    eo.wakeApply > 0 && eo.wakeApply < eo.shop && eo.landmarks < eo.world && eo.world < eo.sky
    && eo.sky < eo.token && eo.token < eo.emit && eo.emit < eo.ret, eo);

// Warm-up.
const wu = MAIN.slice(MAIN.indexOf("await warmUp(renderer, scene, rig.camera, ["), MAIN.indexOf("await shadows.warmUp();"));
const wuSeed = MAIN.indexOf("caches.warmUpSeed(wx, wz);") > 0 && MAIN.indexOf("trials.warmUpSeed(") > 0 && MAIN.indexOf("beacon.warmUpSeed(") > 0;
const fin = MAIN.slice(MAIN.indexOf("spells.finishWarmUp();"), MAIN.indexOf("post.resetHistory();"));
check("S6 warm-up: lane W seeds before warmUp(), its three mesh lists in the warmUp list, finishWarmUp() after the warm frames",
    wuSeed && /\.\.\.caches\.warmUpMeshes/.test(wu) && /\.\.\.trials\.warmUpMeshes/.test(wu) && /\.\.\.beacon\.warmUpMeshes/.test(wu)
    && /caches\.finishWarmUp\(\)/.test(fin) && /trials\.finishWarmUp\(\)/.test(fin) && /beacon\.finishWarmUp\(\)/.test(fin),
    { seeds: wuSeed, list: (wu.match(/\.\.\.\w+\.warmUpMeshes/g) || []), finish: (fin.match(/\w+\.finishWarmUp\(\)/g) || []) });

check("S7 pointer-lock pause guard: unlock pauses only when no reward modal and no cursor panel holds the screen",
    /pointerLockElement !== canvas && shell\.phase === "playing" &&\s*!anyModalOpen\(\) && !input\.panel/.test(MAIN), "");

const catalogue = readFileSync(join(SRC, "quests/events.js"), "utf8").split("*/")[0];
const mainEmits = [...MAIN.matchAll(/questBus\.emit\(\s*"([^"]+)"/g)].map((m) => m[1]);
check("S8 main.js: no Math.random; every event it emits is in the bus catalogue",
    !/Math\.random/.test(MAIN) && mainEmits.length > 0 && mainEmits.every((t) => catalogue.indexOf("'" + t + "'") >= 0),
    { emits: mainEmits });

const hintLine = readFileSync(join(HERE, "..", "index.html"), "utf8").split("\n").find((l) => l.indexOf('id="hint"') >= 0) || "";
check("S9 index.html hint line names the new keys (e interact, j journal, m map) before f1 settings",
    /e interact.*j journal.*m map.*f1 settings/.test(hintLine), hintLine.trim().slice(0, 60) + " ...");

// ================================================================ the Node world
{   // descendant selectors, as qa_ui_node.mjs adds them
    const qsa = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function (sel) {
        const groups = sel.split(",").map((s) => s.trim());
        const out = [];
        for (const g of groups) {
            const parts = g.split(/\s+/);
            let set = qsa.call(this, parts[0]);
            for (let i = 1; i < parts.length; i++) {
                const next = [];
                for (const el of set) for (const c of qsa.call(el, parts[i])) if (next.indexOf(c) < 0) next.push(c);
                set = next;
            }
            for (const el of set) if (out.indexOf(el) < 0) out.push(el);
        }
        return out;
    };
    Element.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
}
const make2d = () => ({
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    clearRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {},
    fill() {}, stroke() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillText() {}, putImageData() {},
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
});
Element.prototype.getContext = function () { return this._g2d || (this._g2d = make2d()); };

const META = JSON.parse(readFileSync(join(HDIR, "meta.json"), "utf8"));
const HEIGHTS = {};
for (const r of ["cold", "sand", "ash"]) {
    const b = readFileSync(join(HDIR, r + ".f32"));
    HEIGHTS[r] = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const { Heightfield } = await import("../src/terrain/heightfield.js");
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { STORY } = await import("../src/quests/storyText.js");
const IN = await import("../src/core/input.js");
const { input, initInput, endFrame, pollInput } = IN;
const { S, set } = await import("../src/core/settings.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const { Progression } = await import("../src/progression/progression.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks } = await import("../src/world/landmarks.js");
const realms = await import("../src/world/realms.js");
const { Hud } = await import("../src/ui/hud.js");
const { Minimap } = await import("../src/ui/minimap.js");

const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(META.cold.originX, META.cold.originZ);
hf.size = META.cold.size;
hf.cpuRes = META.cold.res;
hf.cpuTexel = META.cold.texel;
hf.heightCPU = HEIGHTS.cold;
const terrain = {
    realm: "cold", bakes: 1, playRadius: 620,
    get rebakeCount() { return this.bakes; },
    use(t) { this.realm = t; hf.heightCPU = HEIGHTS[t]; this.bakes++; },
    heightAt: (x, z) => hf.heightAt(x, z),
    normalAt: (x, z, out) => hf.normalAt(x, z, out),
    edge01: (x, z) => hf.edge01(x, z),
    clampToPlayArea: (v) => hf.clampToPlayArea(v),
    edgePush: (x, z) => hf.edgePush(x, z),
};
const scene = { add() {}, remove() {} };
const box = (v) => ({ value: v });
const uniforms = {
    sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0),
    uSunDir: box(new THREE.Vector3(0, 1, 0)), uSunColor: box(new THREE.Vector3(1, 1, 1)),
    uResolution: box(new THREE.Vector2(1, 1)),
};
const shadows = { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; }, receiverUniforms() { return {}; } };
const crystals = { scene, shadows, material: { uniforms } };
const camera = new THREE.PerspectiveCamera(58.4, 16 / 9, 0.1, 3000);
const rig = {
    yaw: 0, roll: 0, _first: false, pivotVel: new THREE.Vector3(), camera,
    getFlatForward(out) { return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); },
    getFlatRight(out) { return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)); },
    addTrauma() {},
};
function placeCamera(c) {
    const fx = Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
    camera.position.set(c.position.x - fx * 6, c.position.y + 2.4, c.position.z - fz * 6);
    camera.lookAt(c.position.x + fx * 10, c.position.y + 1.2, c.position.z + fz * 10);
    camera.updateMatrixWorld(true);
}
const vis = {
    _slotInst: [],
    spawnUnit(i) { this._slotInst[i] = { tint: new Float32Array([1, 1, 1, 0]), state: new Float32Array(4) }; },
    spawn(i) { this.spawnUnit(i); }, free(i) { this._slotInst[i] = null; },
    drive() {}, driveBolt() {}, driveClip() {}, update() {},
};
const wake = { wakeUniforms: { uWakeAlbedo: { value: new Float32Array([0.895, 0.920, 0.965]) } }, applyRealm() {} };

// main.js's own objects, built the way main.js builds them (constructor args
// copied from main.js) -- the stand-ins are named in the header.
// The page control bar (game_controls.js) binds M = mute on a window keydown
// listener registered BEFORE initInput — modelled exactly so (bubble phase).
let barMutes = 0;
window.addEventListener("keydown", (e) => { if (e.code === "KeyM") barMutes++; });
initInput(dom.canvas, { onToggleOverlay: () => {} });
const SHELL = { phase: "menu" };
globalThis.FFG = { shell: SHELL };
const registry = new DamageableRegistry();
const character = new CharacterController(terrain);
character.position.set(0, terrain.heightAt(0, 0), 0);
const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);
const landmarks = new Landmarks(terrain, crystals, shrine);
const enemies = new Enemies(scene, terrain, registry, character, combatData, null);
enemies.attachVis(vis);
const overlay = { visible: false };
const hud = new Hud(character);
hud.attach({ overlay });
const minimap = new Minimap(character, terrain);
minimap.attach({ overlay });
const progression = new Progression(character, registry, null);
shrine.register(progression);
enemies.progression = progression;
progression.graceUntil = 1e9;
const spells = { crystals };           // stand-in: no GPU spell system in Node
const spellHits = null;                 // stand-in (Modifiers falls back)
const encounters = null, portal = null, sky = null, motes = null;
const gateCalls = [];
const bossEncounters = {
    state: "idle", questGate: null,
    armedArena: () => false, meetsFloor: () => true, levelFloor: (k) => (k === "realm" ? 8 : 6),
};

// ---- the transplant: main.js's construction block + composed frame + enterRealm
const DRIVE_LINE = "ending.drive();";
const MODS_LINE = "mods.update(dt);";
const PARAMS = ["scene", "terrain", "character", "rig", "spells", "spellHits", "registry", "enemies", "encounters",
    "bossEncounters", "portal", "shrine", "landmarks", "progression", "realms", "input", "S", "set", "questBus",
    "sky", "shadows", "overlay", "hud", "minimap", "motes", "wake", "pollInput", "endFrame", "__placeCamera",
    ...CLASSES];
const BODY = `"use strict";
let realmToken = "cold";
const mctx = {};
const __realmEmits = [];
async function enterRealm(name) {
    const token = name;
    terrain.use(token);                       // Node stand-in for terrain/sky/weather application
    ${SHOP_LINE}
    landmarks.setRealm(token);
${R.worldRealm.text}
    await Promise.resolve();                  // stand-in for "await sky.solve();"
    realmToken = token;
${R.realmPost.text}
    return token;
}
${R.construction.text}
function frame(dt) {
    pollInput();
    character.update(dt, rig);
    __placeCamera(character);
    ${DRIVE_LINE}
    registry.update(dt);
    ${MODS_LINE}
    shrine.update(dt);
    landmarks.update(dt);
    enemies.update(dt);
    progression.update(dt);
${R.logic.text}
${R.ui.text}
    hud.update();
    minimap.update();
    registry.endFrame();
    endFrame();
}
function warm() {
    const wx = character.position.x + 6, wz = character.position.z + 6;
    caches.warmUpSeed(wx, wz);
    trials.warmUpSeed(wx + 4, wz);
    beacon.warmUpSeed(wx, wz);
    const seeded = [caches.mesh.visible, caches.glintMesh.visible, trials.mesh.visible, beacon.mesh.visible];
    caches.finishWarmUp();
    trials.finishWarmUp();
    beacon.finishWarmUp();
    const after = [caches.mesh.visible, caches.glintMesh.visible, trials.mesh.visible, beacon.mesh.visible];
    return { seeded, after };
}
return { mctx, frame, enterRealm, warm, getToken: () => realmToken,
    sys: { ${vars.join(", ")} } };`;

let W = null, buildErr = null;
try {
    const { bus } = await import("../src/quests/events.js");
    const args = [scene, terrain, character, rig, spells, spellHits, registry, enemies, encounters, bossEncounters, portal,
        shrine, landmarks, progression, realms, input, S, set, bus, sky, shadows, overlay, hud, minimap, motes, wake,
        pollInput, endFrame, placeCamera, ...CLASSES.map((c) => BIND[c])];
    // eslint-disable-next-line no-new-func
    W = new Function(...PARAMS, BODY)(...args);
} catch (e) {
    buildErr = String(e && e.stack || e).split("\n").slice(0, 4).join(" | ");
}
const m = W ? W.mctx : {};
const SELF = ["quests", "caches", "trials", "bounties", "beacon", "mods", "relics", "boons", "shop", "boonPick",
    "driftToast", "shrineMenu", "questTracker", "compass", "dialogue", "toasts", "interact", "journal", "worldMap",
    "introCard", "ending"];
const onCtx = SELF.filter((k) => !m[k]);
check("C1 main.js's construction block RUNS in a world of real modules; the shared ctx carries all 21 systems",
    !buildErr && onCtx.length === 0, { error: buildErr, missingOnCtx: onCtx });
if (buildErr) {
    const fails = RESULTS.filter((r) => !r[1]);
    console.log("\n=== " + (RESULTS.length - fails.length) + " / " + RESULTS.length + " wiring checks PASS ===");
    process.exit(1);
}
const { bus } = await import("../src/quests/events.js");
const LOG = [];
for (const t of ["quest:step", "quest:complete", "quest:waypoint", "dialogue", "realm:entered", "shrine:activated",
    "cache:opened", "reward", "glass:changed", "ui:open", "ui:close"]) {
    bus.on(t, (p) => LOG.push({ t, p: p == null ? null : JSON.parse(JSON.stringify(p)), tok: W.getToken() }));
}
const since = (i0, t) => LOG.slice(i0).filter((e) => !t || e.t === t);
const sys = W.sys;
check("C2 consumers wired by construction: character/spells carry Modifiers, the boss QUEST GATE installed, caches' own E read OFF (Interact owns E), beacon on the quest waypoint",
    character.mods === sys.mods && spells.mods === sys.mods && typeof bossEncounters.questGate === "function"
    && sys.caches.readsInput === false && sys.beacon.target.on === true
    && Math.abs(sys.beacon.target.x - shrine.positions[0].x) < 1e-3,
    { charMods: character.mods === sys.mods, gate: typeof bossEncounters.questGate,
        cachesReadE: sys.caches.readsInput, beacon: { on: sys.beacon.target.on, x: r1(sys.beacon.target.x), z: r1(sys.beacon.target.z) },
        spawnShrine: { x: r1(shrine.positions[0].x), z: r1(shrine.positions[0].z) } });

const sections = progression._sections ? progression._sections.map((s) => s.name) : [];
check("C3 save v4 sections registered through progression (quest, relics, boons, shop/wallet, driftmarkPicks, intro)",
    ["quest", "quest.introSeen", "driftmarkPicks"].every((n) => sections.indexOf(n) >= 0) && sections.length >= 6,
    { sections });

const wr = W.warm();
check("C4 main.js's warm-up seed stands the 4 lane-W meshes up; finishWarmUp takes them all down",
    wr.seeded.every(Boolean) && !wr.after.some(Boolean), wr);

const DT = 1 / 60;
const frames = (n) => { for (let i = 0; i < n; i++) W.frame(S.freezeTime ? 0 : DT); };
const until = (pred, maxS) => { const n = Math.ceil(maxS / DT); for (let i = 0; i < n; i++) { W.frame(S.freezeTime ? 0 : DT); if (pred()) return true; } return false; };
const tp = (x, z, facing) => {
    character.position.set(x, terrain.heightAt(x, z), z);
    character.velocity.set(0, 0, 0);
    if (facing !== undefined) { character.facing = facing; rig.yaw = facing; }
};
const press = (code) => dom.key(code);
const txt = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
const hasCls = (sel, c) => { const e = document.querySelector(sel); return !!(e && e.classList.contains(c)); };

dom.lock();
const readyCold = until(() => sys.caches.readyRealm === "cold" && sys.trials.readyRealm === "cold" && sys.bounties.readyRealm === "cold", 90);
check("F1 through main.js's frame blocks, lane W builds the Cold realm (15 caches, 3 trials, 3 bounties)",
    readyCold && sys.caches.list("cold").length === 15 && sys.trials.trials.length === 3,
    { ready: readyCold, caches: sys.caches.list("cold").length, trials: sys.trials.trials.length });

// PLAY (the shell's onPlay core): newGame, shell in play -> intro card.
SHELL.phase = "playing";
S.freezeTime = false;
progression.newGame();
frames(1);
const introOpen = sys.introCard.isOpen && S.freezeTime === true && input.panel === "intro";
press("Space");
frames(3);
check("F2 PLAY on a fresh run: main.js's frame opens the intro card (time frozen); one key closes it and play runs",
    introOpen && !sys.introCard.isOpen && S.freezeTime === false && input.panel === null,
    { introOpenAtPlay: introOpen, openAfterKey: sys.introCard.isOpen, freeze: S.freezeTime, panel: input.panel });

frames(2);
check("F3 tracker shows cold.1 'The Last Wakecaster' (DOM) with the spawn shrine as waypoint",
    txt("#dw-tracker .qt-title") === "The Last Wakecaster" && sys.quests.tracked && sys.quests.tracked.stepId === "cold.1"
    && hasCls("#dw-tracker", "show"),
    { title: txt("#dw-tracker .qt-title"), text: txt("#dw-tracker .qt-text"), step: sys.quests.tracked && sys.quests.tracked.stepId,
        label: txt("#dw-tracker .qt-label"), dist: txt("#dw-tracker .qt-dist") });

let i0 = LOG.length;
{
    const sp = shrine.positions[0];
    tp(sp.sx, sp.sz, rig.yaw);
    const ok = until(() => sys.quests.main.cold >= 1, 5);
    frames(2);
    const comp = since(i0, "quest:complete").map((e) => e.p.stepId);
    const dl = since(i0, "dialogue").map((e) => e.p.id);
    check("F4 touching the spawn shrine completes cold.1 (banner) and the Echo speaks (dialogue box, 'The Echo')",
        ok && comp[0] === "cold.1" && hasCls("#dw-banner", "show") && dl.indexOf("echo.cold.1") >= 0
        && txt("#dw-dialogue .dl-who") === "The Echo",
        { completed: comp, dialogues: dl, banner: txt("#dw-banner .tb-title"), who: txt("#dw-dialogue .dl-who") });
}

// E at the lit spawn shrine: Interact -> shrine menu (a modal: time frozen).
{
    frames(2);
    press("KeyE");
    frames(1);
    const r = sys.interact.stats.last;
    const open = sys.shrineMenu.isOpen && S.freezeTime === true;
    press("Escape");
    frames(2);
    check("F5 E at the activated shrine routes through Interact to the SHRINE MENU (time frozen); Esc leaves (time runs)",
        (r === "shrine" || r === "typing" || r === "dialogue") && open && !sys.shrineMenu.isOpen && S.freezeTime === false,
        { firstPress: r, openedFrozen: open, closed: !sys.shrineMenu.isOpen, freeze: S.freezeTime });
}

// E at a cache: Interact -> caches.tryInteract -> glass.
{
    const L = sys.caches.list("cold");
    const site = L.find((c) => c.kind === "lore" && !c.opened);
    const g0 = sys.shop.glass;
    i0 = LOG.length;
    tp(sys.caches.x[site.site] + 1.2, sys.caches.z[site.site], rig.yaw);
    until(() => sys.caches.interactTarget === site.site, 3);
    press("KeyE");
    frames(3);
    const opened = since(i0, "cache:opened").map((e) => e.p.kind);
    check("F6 E at a lore cache: Interact opens it (one press, one action) -> lore shard + Wake Glass credited once by the shop",
        opened.length === 1 && opened[0] === "lore" && sys.shop.glass > g0 && sys.interact.stats.last === "cache",
        { opened, glass: [g0, sys.shop.glass], last: sys.interact.stats.last, lore: since(i0, "reward").map((e) => e.p.kind) });
}

// enterRealm composed from main.js's snippets.
{
    i0 = LOG.length;
    await W.enterRealm("sand");
    const em = since(i0, "realm:entered");
    frames(2);
    const ready = until(() => sys.caches.readyRealm === "sand" && sys.trials.readyRealm === "sand" && sys.bounties.readyRealm === "sand", 90);
    check("F7 enterRealm('sand'): exactly one 'realm:entered' AFTER the token flipped (listeners read getRealm() === 'sand'); quest, progression, tracker, shop and lane W all follow",
        em.length === 1 && em[0].p.realm === "sand" && em[0].tok === "sand" && sys.quests.realm === "sand"
        && progression.realm === "sand" && sys.questTracker.realm === "sand" && sys.shop._realm === "sand" && ready,
        { emits: em.map((e) => ({ realm: e.p.realm, tokenSeenByListener: e.tok })), quest: sys.quests.realm,
            progression: progression.realm, tracker: sys.questTracker.realm, shop: sys.shop._realm, wReady: ready });
    await W.enterRealm("cold");
    const back = until(() => sys.caches.readyRealm === "cold", 90);
    check("F8 back to Cold: lane W rebuilds Cold and the opened cache stays opened (persisted per realm)",
        back && sys.caches.list("cold").filter((c) => c.opened).length === 1,
        { ready: back, opened: sys.caches.list("cold").filter((c) => c.opened).map((c) => c.site) });
}

// J and M through main.js's UI block.
{
    press("KeyJ"); frames(1);
    const j = sys.journal.isOpen && input.panel === "journal";
    press("Escape"); frames(1);
    press("KeyM"); frames(1);
    const mp = sys.worldMap.isOpen && input.panel === "map";
    press("Escape"); frames(1);
    check("F9 J opens the journal and M the world map through the frame's UI block; Esc closes each before any pause",
        j && mp && !sys.journal.isOpen && !sys.worldMap.isOpen && input.panel === null,
        { journal: j, map: mp, panelAfter: input.panel });
}

// M vs the page bar's M-mute.
{
    const m0 = barMutes;
    press("KeyM"); frames(1);
    const opened = sys.worldMap.isOpen;
    press("KeyM"); frames(1);
    const closed = !sys.worldMap.isOpen;
    const inPlay = barMutes - m0;
    SHELL.phase = "menu";
    press("KeyM");
    const onMenu = barMutes - m0 - inPlay;
    SHELL.phase = "playing";
    frames(1);
    check("F11 M in play opens / closes the world map and never reaches the page bar's M = mute; on a menu it still mutes",
        opened && closed && inPlay === 0 && onMenu === 1, { opened, closed, barMutesInPlay: inPlay, barMutesOnMenu: onMenu });
}

// SAVE -> reload: a fresh transplant over the saved blob, CONTINUE.
{
    progression.save();
    const blob = JSON.parse(localStorage.getItem("driftwake_save") || "{}");
    check("F10 the save blob is v4-shaped: quest.main, quest.caches, wakeGlass, relics, boons sections present",
        blob.quest && blob.quest.main && blob.quest.main.cold >= 1 && blob.quest.caches && typeof blob.wakeGlass === "number",
        { keys: Object.keys(blob).sort(), questKeys: blob.quest ? Object.keys(blob.quest).sort() : null,
            main: blob.quest && blob.quest.main, glass: blob.wakeGlass });
}

const fails = RESULTS.filter((r) => !r[1]);
console.log("\n=== " + (RESULTS.length - fails.length) + " / " + RESULTS.length + " wiring checks PASS ===");
if (fails.length) console.log("FAILED: " + fails.map((f) => f[0].split(" ")[0]).join(", "));
process.exit(fails.length ? 1 : 0);
