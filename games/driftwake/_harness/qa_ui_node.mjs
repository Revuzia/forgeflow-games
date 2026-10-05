// qa_ui_node.mjs -- lane U (the player-facing UI) LOGIC proof, headless.
//
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/qa_ui_node.mjs
//
// REAL: every lane-U module (ui/questTracker, compass, dialogue, toasts,
// interact, journal, worldMap, introCard, ending; core/input.js with its real
// window listeners; ui/hud.js Wake Glass pill; ui/minimap.js quest pips), and
// the systems they display: quests/questSystem.js (lane Q), world/{caches,
// trials,bounties,beacon}.js (lane W), progression/{modifiers,boons,relics,
// shop,progression}.js + ui/{boonPick,shrineMenu}.js (lane R), the REAL
// heightfield mirror lane W exported (_harness/_wa_heights, the game's own
// Heightfield.heightAt), CharacterController, Enemies, DamageableRegistry,
// SpawnShrine, Landmarks, STORY, the event bus.
// STUBBED: the DOM (_harness/node_dom_shim.mjs, lane R; this probe adds
// descendant selectors and a 2D canvas context that only counts calls), GPU
// objects, the camera rig (a real THREE.PerspectiveCamera placed behind the
// rider each frame), the FFG shell (phase + its window-BUBBLE Escape listener,
// exactly runtime/ffg_shell.js:61-63) and main.js's pause-on-unlock handler
// AS THE INTEGRATOR WILL GUARD IT (`!anyModalOpen() && !input.panel`).
// Exit code 0 only if every check passes.
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDom, Element } from "./node_dom_shim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const HDIR = join(HERE, "_wa_heights");
if (!existsSync(join(HDIR, "meta.json"))) {
    console.log("FAIL real heightfields missing — run: python _harness/qa_wa_hbake.py");
    process.exit(2);
}

// ------------------------------------------------------------- DOM + shims
const dom = installDom();
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
// Descendant combinators ("a b") for ui/hud.js's selectors.
{
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
// A 2D context that counts calls (no allocation on the draw path).
const CTX2D = { calls: 0, fillText: 0, arcs: 0 };
function make2d() {
    const g = {
        fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
        clearRect() { CTX2D.calls++; }, beginPath() { CTX2D.calls++; }, closePath() { CTX2D.calls++; },
        moveTo() { CTX2D.calls++; }, lineTo() { CTX2D.calls++; }, arc() { CTX2D.arcs++; },
        ellipse() { CTX2D.arcs++; }, fill() { CTX2D.calls++; }, stroke() { CTX2D.calls++; },
        save() {}, restore() {}, translate() {}, rotate() {}, fillText() { CTX2D.fillText++; },
        putImageData() { CTX2D.calls++; },
        createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    };
    return g;
}
Element.prototype.getContext = function () { return this._g2d || (this._g2d = make2d()); };

// heightfield.js -> core/loading.js reads DOM ids at import time (the shim answers null).
const META = JSON.parse(readFileSync(join(HDIR, "meta.json"), "utf8"));
const HEIGHTS = {};
for (const r of ["cold", "sand", "ash"]) {
    const b = readFileSync(join(HDIR, r + ".f32"));
    HEIGHTS[r] = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const { Heightfield } = await import("../src/terrain/heightfield.js");
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { STORY } = await import("../src/quests/storyText.js");
const IN = await import("../src/core/input.js");
const { input, initInput, endFrame, pollInput, openPanel, closePanel, isDown } = IN;
const { S, set: setS } = await import("../src/core/settings.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const { Progression } = await import("../src/progression/progression.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks } = await import("../src/world/landmarks.js");
const realms = await import("../src/world/realms.js");
const { RelicCaches } = await import("../src/world/caches.js");
const { WakeTrials } = await import("../src/world/trials.js");
const { Bounties } = await import("../src/world/bounties.js");
const { WaypointBeacon } = await import("../src/world/beacon.js");
const { QuestSystem } = await import("../src/quests/questSystem.js");
const { Modifiers } = await import("../src/progression/modifiers.js");
const { Boons } = await import("../src/progression/boons.js");
const { Relics } = await import("../src/progression/relics.js");
const { Shop } = await import("../src/progression/shop.js");
const { BoonPick, DriftmarkToast, anyModalOpen } = await import("../src/ui/boonPick.js");
const { ShrineMenu } = await import("../src/ui/shrineMenu.js");
const { Hud } = await import("../src/ui/hud.js");
const { Minimap } = await import("../src/ui/minimap.js");
const U = {
    tracker: await import("../src/ui/questTracker.js"),
    compass: await import("../src/ui/compass.js"),
    dialogue: await import("../src/ui/dialogue.js"),
    toasts: await import("../src/ui/toasts.js"),
    interact: await import("../src/ui/interact.js"),
    journal: await import("../src/ui/journal.js"),
    map: await import("../src/ui/worldMap.js"),
    intro: await import("../src/ui/introCard.js"),
    ending: await import("../src/ui/ending.js"),
};

const RESULTS = [];
function check(name, ok, detail) {
    RESULTS.push([name, !!ok]);
    console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(detail === undefined ? "" : detail));
}
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const txt = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
const hasCls = (sel, c) => { const e = document.querySelector(sel); return !!(e && e.classList.contains(c)); };

// ================================================================ static
{
    const OWN = ["ui/questTracker.js", "ui/compass.js", "ui/dialogue.js", "ui/toasts.js", "ui/interact.js",
        "ui/journal.js", "ui/worldMap.js", "ui/introCard.js", "ui/ending.js", "core/input.js", "ui/hud.js",
        "ui/minimap.js"];
    const header = readFileSync(join(SRC, "quests/events.js"), "utf8").split("*/")[0];
    const rnd = [], emitted = new Set(), missing = [];
    for (const f of OWN) {
        const s = readFileSync(join(SRC, f), "utf8");
        if (/Math\.random/.test(s)) rnd.push(f);
        for (const m of s.matchAll(/\.emit\(\s*"([^"]+)"/g)) emitted.add(m[1]);
    }
    for (const t of emitted) if (header.indexOf("'" + t + "'") < 0) missing.push(t);
    check("S1 static: no Math.random in lane U files; every event they emit is in the bus header",
        rnd.length === 0 && missing.length === 0,
        { mathRandomIn: rnd, emitted: [...emitted].sort(), notInCatalogue: missing });
}

// ------------------------------------------------------------- the shell
let overlayToggles = 0;
initInput(dom.canvas, { onToggleOverlay: () => { overlayToggles++; } });
const SHELL = { phase: "playing", escToggles: 0, unlockPauses: 0 };
globalThis.FFG = { shell: SHELL };
// runtime/ffg_shell.js:61-63 — a window BUBBLE keydown listener.
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        SHELL.escToggles++;
        if (SHELL.phase === "playing") SHELL.phase = "paused";
        else if (SHELL.phase === "paused") SHELL.phase = "playing";
    }
});
// main.js:1430 AS THE INTEGRATOR GUARDS IT (lane R + lane U hooks).
document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== dom.canvas && SHELL.phase === "playing" &&
        !anyModalOpen() && !input.panel) {
        SHELL.phase = "paused";
        SHELL.unlockPauses++;
    }
});
const keydown = (code, extra) => {
    const e = new dom.Event("keydown", Object.assign({ code, key: code === "Escape" ? "Escape" : code,
        repeat: false, bubbles: true }, extra || {}));
    document.body.dispatchEvent(e);
    return e;
};
const keyup = (code) => document.body.dispatchEvent(new dom.Event("keyup", { code, key: code, bubbles: true }));
const press = (code) => { keydown(code); keyup(code); };

// ================================================================ input
{
    dom.lock();
    keydown("KeyE"); keydown("KeyJ"); keydown("KeyM");
    const set1 = [input.interactPressed, input.journalPressed, input.mapPressed];
    endFrame();
    const cleared = [input.interactPressed, input.journalPressed, input.mapPressed];
    keydown("KeyE", { repeat: true });
    const rep = input.interactPressed;
    keyup("KeyE"); keyup("KeyJ"); keyup("KeyM");
    check("I1 input: E / J / M set one-frame edges on the keydown, endFrame clears them, auto-repeat does not re-fire",
        set1.every(Boolean) && !cleared.some(Boolean) && rep === false, { set: set1, afterEndFrame: cleared, repeat: rep });
}
{
    const got = [];
    const exits0 = dom.stats.lockExits;
    keydown("KeyW");
    const heldBefore = isDown("KeyW");
    openPanel("probe", (e) => got.push(e.code), { cursor: true });
    const lockGone = document.pointerLockElement === null && dom.stats.lockExits === exits0 + 1;
    const pausedByUnlock = SHELL.unlockPauses;
    for (const c of ["Digit1", "KeyW", "Space", "KeyE", "KeyJ", "Digit3"]) keydown(c);
    const leaked = { spellPressed: input.spellPressed, jumpPressed: input.jumpPressed, interact: input.interactPressed,
        journal: input.journalPressed, w: isDown("KeyW"), moveZ: (pollInput(), input.moveZ) };
    const t0 = overlayToggles;
    keydown("F1");
    const f1 = overlayToggles === t0 + 1 && got.indexOf("F1") < 0;
    const panel = input.panel;
    closePanel("probe");
    endFrame();
    for (const c of ["Digit1", "KeyW", "Space", "KeyE", "KeyJ", "Digit3"]) keyup(c);
    check("I2 panel stack: a cursor panel releases the lock (the guarded main.js handler does not pause), gets every key, nothing reaches the game; F1 passes through",
        heldBefore && lockGone && pausedByUnlock === 0 && panel === "probe" && input.panel === null
        && got.join() === "Digit1,KeyW,Space,KeyE,KeyJ,Digit3" && leaked.spellPressed === 0 && !leaked.jumpPressed
        && !leaked.interact && !leaked.journal && !leaked.w && leaked.moveZ === 0 && f1,
        { got, leaked, heldDroppedOnOpen: heldBefore && !leaked.w, f1PassThrough: f1, unlockPauses: pausedByUnlock });
}
{
    const got = [];
    openPanel("probe2", (e) => { got.push(e.code); if (e.code === "Escape") closePanel("probe2"); }, { cursor: true });
    keydown("Escape");
    const phaseAfterPanelEsc = SHELL.phase;
    const panelAfter = input.panel;
    keydown("Escape");
    const phaseAfterSecondEsc = SHELL.phase;
    SHELL.phase = "playing";
    check("I3 Esc closes the panel FIRST (the shell's bubble Escape never sees it); the next Esc pauses",
        got.join() === "Escape" && phaseAfterPanelEsc === "playing" && panelAfter === null && phaseAfterSecondEsc === "paused",
        { panelGot: got, phaseAfterPanelEsc, phaseAfterSecondEsc, shellEscapes: SHELL.escToggles });
}
{
    openPanel("probe3", () => {}, { cursor: true });
    dom.lock();                          // a closing modal's late re-lock request lands
    const relocked = document.pointerLockElement;
    closePanel("probe3");
    dom.lock();
    check("I4 a pointer re-lock that lands while a cursor panel is up is handed straight back",
        relocked === null && document.pointerLockElement === dom.canvas, { underPanel: relocked === null, afterClose: !!document.pointerLockElement });
}

// ================================================================ pure UI math
{
    const cam = new THREE.PerspectiveCamera(58.4, 16 / 9, 0.1, 2000);
    cam.position.set(0, 2, 0);
    cam.lookAt(0, 2, -10);
    cam.updateMatrixWorld(true);
    const e = cam.matrixWorld.elements;
    const halfH = Math.atan(Math.tan((58.4 * Math.PI / 180) / 2) * (16 / 9));
    const o = { rel: 0, onScreen: false };
    const ahead = { ...U.compass.bearingOf(e, 0, -50, halfH, o) };
    const right = { ...U.compass.bearingOf(e, 50, 0, halfH, o) };
    const behindL = { ...U.compass.bearingOf(e, -10, 50, halfH, o) };
    const px = [U.compass.railX(ahead.rel, 300), U.compass.railX(right.rel, 300), U.compass.railX(behindL.rel, 300),
        U.compass.railX(Math.PI / 4, 300)];
    const rt = [U.dialogue.readTime(10), U.dialogue.readTime(80), U.dialogue.readTime(400)];
    const ft = [U.toasts.fmtTime(29.8), U.toasts.fmtTime(64.25), U.journal.fmtPlay(3725)];
    check("P1 pure: compass bearing (ahead 0 on screen, right +90 off, behind-left pinned left), rail px, dialogue reading time, time formats",
        Math.abs(ahead.rel) < 1e-6 && ahead.onScreen && Math.abs(right.rel - Math.PI / 2) < 1e-6 && !right.onScreen
        && behindL.rel < -Math.PI / 2 && !behindL.onScreen && px[0] === 0 && px[1] === 300 && px[2] === -300 && px[3] === 150
        && rt[0] === U.dialogue.READ_MIN && Math.abs(rt[1] - (1.3 + 0.042 * 80)) < 1e-9 && rt[2] === U.dialogue.READ_MAX
        && ft[0] === "29.8 s" && ft[1] === "1:04.3" && ft[2] === "1h 2m 5s",
        { ahead, right, behindL, px, readTime: rt.map(r2), formats: ft });
}

// ================================================================ the world
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
/** The rig's arm, minus the springs: behind the rider along rig.yaw. */
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
const wakeStub = { wakeUniforms: { uWakeAlbedo: { value: new Float32Array([0.895, 0.920, 0.965]) } } };

const LOGGED = ["quest:step", "quest:complete", "quest:waypoint", "waypoint:pin", "dialogue", "hint", "hint:clear",
    "ui:open", "ui:close", "cache:opened", "reward", "glass:changed", "ending:begin", "ending:done", "shrine:activated"];

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
    progression.graceUntil = 1e9;
    const w = { registry, character, shrine, landmarks, enemies, progression, realm: "cold", t: 0, log: [] };
    const ctx = {
        scene, terrain, character, rig, registry, enemies, shrine, landmarks, progression, crystals,
        bus, input, S, set: setS, realms, wake: wakeStub, overlay: { visible: false },
        bosses: { state: "idle", armedArena: () => false, meetsFloor: () => true, levelFloor: () => 6 },
        getRealm: () => w.realm,
        enterRealm: async (t) => { w.realm = t; bus.emit("realm:entered", { realm: t }); return t; },
    };
    w.ctx = ctx;
    for (const t of LOGGED) bus.on(t, (p) => w.log.push({ t, p: p == null ? null : JSON.parse(JSON.stringify(p)) }));
    w.quests = new QuestSystem(ctx);
    w.caches = new RelicCaches(ctx); ctx.caches = w.caches;
    w.trials = new WakeTrials(ctx); ctx.trials = w.trials;
    w.bounties = new Bounties(ctx); ctx.bounties = w.bounties;
    w.beacon = new WaypointBeacon(ctx); ctx.beacon = w.beacon;
    if (w.quests.waypoint) w.beacon.set(w.quests.waypoint);
    w.mods = new Modifiers(ctx);
    w.relics = new Relics(ctx); ctx.relics = w.relics;
    w.boons = new Boons(ctx); ctx.boons = w.boons;
    w.shop = new Shop(ctx); ctx.shop = w.shop;
    w.pick = new BoonPick(ctx);
    w.dtoast = new DriftmarkToast(ctx);
    w.menu = new ShrineMenu(ctx);
    w.hud = new Hud(character);
    w.hud.attach({ overlay: ctx.overlay, shop: w.shop, bus });
    w.minimap = new Minimap(character, terrain);
    w.minimap.attach({ overlay: ctx.overlay });
    // ---- lane U, in the recommended order
    w.tracker = new U.tracker.QuestTracker(ctx);
    w.compass = new U.compass.Compass(ctx);
    w.dialogue = new U.dialogue.Dialogue(ctx); ctx.dialogue = w.dialogue;
    w.toasts = new U.toasts.Toasts(ctx);
    w.interact = new U.interact.Interact(ctx);
    w.journal = new U.journal.Journal(ctx);
    w.map = new U.map.WorldMap(ctx);
    w.intro = new U.intro.IntroCard(ctx);
    w.ending = new U.ending.Ending(ctx);
    w.minimap.attachQuest(ctx);
    return w;
}

const DT = 1 / 60;
/** One frame in main.js order (+ the meaning layer where the hooks put it). */
function frame(w) {
    const dt = S.freezeTime ? 0 : DT;
    pollInput();
    w.character.update(dt, rig);
    placeCamera(w.character);
    w.ending.drive();
    w.registry.update(dt);
    w.shrine.update(dt);
    w.landmarks.update(dt);
    w.enemies.update(dt);
    w.mods.update(dt);
    w.progression.update(dt);
    w.quests.update(dt);
    w.caches.update(dt); w.trials.update(dt); w.bounties.update(dt); w.beacon.update(dt);
    w.pick.update(dt); w.dtoast.update(dt); w.menu.update(dt);
    w.interact.update(dt);
    w.tracker.update(dt); w.compass.update(dt); w.dialogue.update(dt); w.toasts.update(dt);
    w.journal.update(dt); w.map.update(dt); w.intro.update(dt); w.ending.update(dt);
    w.hud.update(); w.minimap.update();
    w.registry.endFrame();
    endFrame();
    w.t += dt;
}
function frames(w, n) { for (let i = 0; i < n; i++) frame(w); }
function until(w, pred, maxS) {
    const n = Math.ceil(maxS / DT);
    for (let i = 0; i < n; i++) { frame(w); if (pred()) return true; }
    return false;
}
function tp(w, x, z, facing) {
    const c = w.character;
    c.position.set(x, terrain.heightAt(x, z), z);
    c.velocity.set(0, 0, 0);
    if (facing !== undefined) { c.facing = facing; rig.yaw = facing; }
}
const since = (w, i0, t) => w.log.slice(i0).filter((e) => !t || e.t === t);
function pin(name, val) { Object.defineProperty(input, name, { get: () => val, configurable: true }); }
function unpin(name, val) { Object.defineProperty(input, name, { value: val, writable: true, configurable: true, enumerable: true }); }

localStorage.clear();
const w = buildWorld();
const Q = w.quests;
dom.lock();
until(w, () => w.caches.readyRealm === "cold" && w.trials.readyRealm === "cold" && w.bounties.readyRealm === "cold", 60);
w.progression.newGame();
// PLAY -> the intro card opens on the first in-play frame (N1 tests it in
// detail); a key dismisses it, exactly as a player does.
frame(w);
const introAtPlay = w.intro.isOpen && S.freezeTime === true;
press("Space");
frames(w, 3);
check("T0 PLAY: the intro card opens (time frozen) and one key drops the rider into the world (no jump fired)",
    introAtPlay && !w.intro.isOpen && S.freezeTime === false && !w.character.airborne,
    { introAtPlay, open: w.intro.isOpen, freeze: S.freezeTime });

// ================================================================ tracker
{
    const sp = w.shrine.positions[0];
    const name0 = STORY.shrines.cold.cold_spawn.name;
    const d = Math.round(Math.hypot(sp.x - w.character.position.x, sp.z - w.character.position.z));
    check("T1 tracker after NEW RUN: cold.1 title + tracker + kicker, waypoint = the spawn shrine with its live distance, shown under lock",
        txt("#dw-tracker .qt-title") === "The Last Wakecaster" && txt("#dw-tracker .qt-text") === "Touch the shrine."
        && txt("#dw-tracker .qt-kicker") === "The Rime Shelf  ·  1 / 8"
        && txt("#dw-tracker .qt-label") === name0 && txt("#dw-tracker .qt-dist") === d + " m"
        && hasCls("#dw-tracker", "show"),
        { title: txt("#dw-tracker .qt-title"), text: txt("#dw-tracker .qt-text"), kicker: txt("#dw-tracker .qt-kicker"),
            label: txt("#dw-tracker .qt-label"), dist: txt("#dw-tracker .qt-dist"), wantDist: d });
    // Compass: face away from the shrine, then toward it.
    const c = w.character;
    const toward = Math.atan2(sp.x - c.position.x, -(sp.z - c.position.z));
    rig.yaw = toward + Math.PI; c.facing = rig.yaw;
    frames(w, 2);
    const away = { shown: hasCls("#dw-compass", "show"), px: w.compass.stats.px, rel: r2(w.compass.stats.rel),
        side: hasCls("#dw-compass", "left") ? "left" : hasCls("#dw-compass", "right") ? "right" : "none",
        dist: txt("#dw-compass .cp-dist") };
    rig.yaw = toward; c.facing = rig.yaw;
    frames(w, 2);
    const at = { shown: hasCls("#dw-compass", "show"), rel: r2(w.compass.stats.rel) };
    rig.yaw = toward - Math.PI / 2; c.facing = rig.yaw;      // shrine on the RIGHT
    frames(w, 2);
    const onRight = { shown: hasCls("#dw-compass", "show"), px: w.compass.stats.px };
    check("T2 compass tick: shown at the rail end (chevron turned) when the waypoint is behind, hidden when it is in view, right half when it is to the right",
        away.shown && Math.abs(away.px) >= 80 && away.side !== "none" && away.dist === d + " m"
        && !at.shown && Math.abs(at.rel) < 0.05 && onRight.shown && onRight.px > 0,
        { away, facingIt: at, onRight });
    check("T3 minimap quest pips: 7 shrines (0 lit) and the waypoint pip; the overlay draw ran",
        w.minimap.questStats.shrines === 7 && w.minimap.questStats.shrinesLit === 0 && w.minimap.questStats.wp === true
        && CTX2D.calls > 0, Object.assign({ ctx2dCalls: CTX2D.calls }, w.minimap.questStats));
}

// ================================================================ cold.1
let i0 = w.log.length;
{
    const sp = w.shrine.positions[0];
    tp(w, sp.sx, sp.sz, rig.yaw);
    until(w, () => Q.main.cold >= 1, 5);
    frames(w, 2);
    const comp = since(w, i0, "quest:complete")[0];
    const dl = since(w, i0, "dialogue").map((e) => e.p.id);
    check("Q1 touch the spawn shrine -> Quest Complete banner (title + XP reward) and the 'Shrine Awakened' toast with its name",
        comp && hasCls("#dw-banner", "show") && txt("#dw-banner .tb-title") === "The Last Wakecaster"
        && txt("#dw-banner .tb-rew") === "+" + comp.p.xp + " XP" && comp.p.xp > 0
        && w.toasts.stats.byKind.shrine === 1 && /Shrine Awakened \| /.test(w.toasts.stats.lastToast)
        && w.toasts.stats.lastToast.indexOf(STORY.shrines.cold.cold_spawn.name) > 0,
        { banner: [txt("#dw-banner .tb-kick"), txt("#dw-banner .tb-title"), txt("#dw-banner .tb-rew")],
            lastToast: w.toasts.stats.lastToast, xp: comp && comp.p.xp });
    const cur = w.dialogue.current;
    check("Q2 the Echo speaks: the shrine's line first, then echo.cold.1 queued; speaker 'The Echo', typewriter mid-line",
        dl.join() === "shrine.cold.cold_spawn,echo.cold.1" && cur && cur.id === "shrine.cold.cold_spawn"
        && txt("#dw-dialogue .dl-who") === "The Echo" && w.dialogue.queue.length === 1 && w.dialogue.typing
        && hasCls("#dw-dialogue", "show"),
        { dialogues: dl, current: cur && cur.id, queued: w.dialogue.queue.map((q) => q.id), revealed: w.dialogue._revealed,
            len: w.dialogue._len });
    // E at the shrine opens the SHRINE MENU even while the Echo types; the
    // line waits under the modal (game time frozen) and resumes after it.
    press("KeyE"); frame(w);
    const r1st = w.interact.stats.last;
    const menuOpen = w.menu.isOpen && anyModalOpen() && S.freezeTime === true;
    // (the press frame's own dt was already live; freezing starts next frame)
    const rev0 = w.dialogue._revealed;
    frames(w, 5);
    const revFrozen = w.dialogue._revealed;
    const hiddenUnder = !hasCls("#dw-dialogue", "show");
    keydown("Escape"); keyup("Escape");
    dom.lock();
    frames(w, 4);
    const revAfter = w.dialogue._revealed;
    check("Q3 E at the shrine opens the SHRINE MENU (modal, frozen) even mid-line; the line waits hidden under it and resumes after Esc; the shell never paused",
        r1st === "shrine" && menuOpen && revFrozen === rev0 && hiddenUnder && !w.menu.isOpen && !S.freezeTime
        && revAfter > revFrozen && SHELL.phase === "playing" && hasCls("#dw-dialogue", "show"),
        { first: r1st, menuOpened: menuOpen, revealed: [rev0, revFrozen, revAfter], hiddenUnderModal: hiddenUnder,
            shell: SHELL.phase });
    // Away from the shrine, E is the skip key: finish the line, then move on.
    tp(w, sp.x + 30, sp.z, rig.yaw);
    frames(w, 2);
    const before = { id: w.dialogue.current && w.dialogue.current.id, line: w.dialogue.line, typing: w.dialogue.typing };
    press("KeyE"); frame(w);
    const p1 = w.interact.stats.last;
    const allOn = w.dialogue._spans.every((sx) => sx.classList.contains("on"));
    press("KeyE"); frame(w);
    const after = { id: w.dialogue.current && w.dialogue.current.id, line: w.dialogue.line, last: w.interact.stats.last };
    check("Q4 with nothing in reach E skips: the 1st press finishes the typing line, the 2nd moves to the next line / dialogue",
        before.typing && p1 === "typing" && allOn && after.last === "dialogue"
        && (after.id !== before.id || after.line !== before.line), { before, firstPress: p1, allRevealed: allOn, after });
    // Auto-advance on game time: let everything play out.
    const tq = w.t;
    const doneTalking = until(w, () => !w.dialogue.active, 30);
    check("Q5 the dialogue auto-advances on its reading time and clears (no input)", doneTalking && !hasCls("#dw-dialogue", "show"),
        { gameS: r1(w.t - tq), played: w.dialogue.stats.played, lines: w.dialogue.stats.lines });
}

// ================================================================ cold.2 surf
{
    const hintShown = since(w, i0, "hint").some((e) => e.p.id === "hint.surf");
    const hintDom = (txt("#dw-hints") || "").indexOf("Hold RMB to surf") >= 0;
    i0 = w.log.length;
    const c = w.character;
    rig.yaw = Math.PI * 0.5; c.facing = rig.yaw;
    pin("surf", true); keydown("KeyW");
    let progSeen = null, hintGoneAt = null;
    const ok = until(w, () => {
        if (progSeen === null && hasCls("#dw-tracker", "prog") && /^\d+ \/ 150$/.test(txt("#dw-tracker .qt-count") || "")
            && txt("#dw-tracker .qt-count") !== "0 / 150") progSeen = txt("#dw-tracker .qt-count");
        if (hintGoneAt === null && (txt("#dw-hints") || "").indexOf("Hold RMB") < 0) hintGoneAt = r1(Q.surfM);
        return Q.main.cold >= 2;
    }, 90);
    unpin("surf", false); keyup("KeyW");
    frames(w, 2);
    check("Q6 cold.2: the 'Hold RMB to surf' hint shows, the tracker bar + 'n / 150' count follow the surf, the hint leaves at >= 20 m",
        hintShown && hintDom && ok && progSeen !== null && hintGoneAt !== null && hintGoneAt >= 20 && hintGoneAt < 30,
        { hintShown, hintDom, progressSample: progSeen, hintGoneAtSurfM: hintGoneAt, surfM: r1(Q.surfM) });
    // cold.3 hints (LMB / 1), then the kills (lane Q's own logic; shortcut as its probe does).
    const hints = (w.toasts.hints || []).map((h) => h.el.textContent);
    Q.killsForOnboarding = 5; Q._dirty = true;
    frames(w, 3);
    check("Q7 cold.3 hints 'LMB — Bolt' and '1 — Frost Arc' on screen; after the kills the tracker reads cold.4 with its 0 / 3 bar",
        hints.indexOf("LMB — Bolt") >= 0 && hints.indexOf("1 — Frost Arc") >= 0 && Q.main.cold === 3
        && txt("#dw-tracker .qt-title") === "Kindle the Ring" && txt("#dw-tracker .qt-count") === "0 / 3",
        { hints, title: txt("#dw-tracker .qt-title"), count: txt("#dw-tracker .qt-count") });
    // Waypoint -> nearest dormant ring shrine; the beacon carries it.
    frames(w, 20);
    const wp = Q.waypoint;
    check("Q8 cold.4 waypoint: tracker label = the nearest dormant ring shrine; the beacon holds the same target",
        wp && wp.kind === "shrine" && txt("#dw-tracker .qt-label") === wp.label && w.beacon.target.on
        && w.beacon.target.x === wp.x && w.beacon.target.z === wp.z,
        { wp, label: txt("#dw-tracker .qt-label"), beacon: { x: w.beacon.target.x, z: w.beacon.target.z } });
}

// ================================================================ journal
{
    const exits0 = dom.stats.lockExits;
    press("KeyJ"); frame(w);
    const open = w.journal.isOpen && hasCls("#dw-journal", "open") && input.panel === "journal";
    const lockReleased = document.pointerLockElement === null && dom.stats.lockExits === exits0 + 1;
    const rows = document.querySelectorAll("#dw-journal .dwu-row");
    const done = rows.filter((r) => r.classList.contains("done")).map((r) => r.textContent.slice(1));
    const cur = rows.filter((r) => r.classList.contains("cur")).map((r) => r.textContent);
    const qmarks = rows.filter((r) => r.textContent.indexOf("???") >= 0).length;
    check("J1 J opens the journal (cursor panel: lock released, NO pause); Main: cold.1-3 done, cold.4 current with its live count, Sand+Ash steps '???'",
        open && lockReleased && SHELL.phase === "playing" && SHELL.unlockPauses === 0
        && done.join("|") === "The Last Wakecaster|Carve Your Wake|Answer the Drift"
        && cur.length === 1 && cur[0].indexOf("Kindle the Ring") >= 0 && cur[0].indexOf("(0 / 3)") >= 0 && qmarks === 12,
        { open, lockReleased, done, current: cur, unknownRows: qmarks, shell: SHELL.phase });
    keydown("Digit1"); keyup("Digit1");
    const spell = input.spellPressed;
    keydown("Digit2"); keyup("Digit2");
    const side = txt("#dw-journal .dwu-body");
    const sideOk = side.indexOf("Relic caches found 0/15") >= 0
        && STORY.trials.cold.every((t) => side.indexOf(t.name) >= 0)
        && STORY.bounties.cold.every((b) => side.indexOf(b.name) >= 0) && side.indexOf("At large") >= 0
        && side.indexOf("Carries a relic") >= 0 && side.indexOf("Relic on gold") >= 0;
    keydown("Digit3"); keyup("Digit3");
    const lore = txt("#dw-journal .dwu-body");
    const loreLocked = document.querySelectorAll("#dw-journal .dwu-lore").filter((e) => e.classList.contains("lock")).length;
    keydown("Digit4"); keyup("Digit4");
    const stats = txt("#dw-journal .dwu-body");
    const comp = U.journal.completion(w.ctx);
    check("J2 tabs by key (1-4; a digit is a tab, never a spell): Side lists caches 0/15, the 3 trials and the 3 bounties (spawn shrine lit); Lore 12 '???'; Stats level/deaths/time/completion",
        spell === 0 && sideOk && loreLocked === 12 && lore.indexOf("0 / 12") >= 0
        && stats.indexOf("Level") >= 0 && stats.indexOf("Deaths") >= 0 && stats.indexOf("Play time") >= 0
        && stats.indexOf(comp.pct.toFixed(1) + "%") >= 0 && comp.done === 4 && comp.total === 104,
        { spellPressed: spell, sideOk, loreLocked, completion: comp });
    // M switches to the map, J back, Esc closes before the pause.
    keydown("KeyM"); keyup("KeyM");
    const mapOpen = w.map.isOpen && !w.journal.isOpen && input.panel === "map";
    keydown("KeyJ"); keyup("KeyJ");
    const backToJournal = w.journal.isOpen && !w.map.isOpen && input.panel === "journal";
    keydown("Escape"); keyup("Escape");
    const afterEsc = { journal: w.journal.isOpen, panel: input.panel, shell: SHELL.phase };
    keydown("Escape"); keyup("Escape");
    const second = SHELL.phase;
    SHELL.phase = "playing";
    dom.lock();
    frames(w, 2);
    check("J3 M from the journal opens the map, J goes back; Esc closes the journal FIRST (shell still playing), the next Esc pauses",
        mapOpen && backToJournal && !afterEsc.journal && afterEsc.panel === null && afterEsc.shell === "playing"
        && second === "paused", { mapOpen, backToJournal, afterEsc, secondEsc: second });
    // J toggles closed with a re-lock request.
    const req0 = dom.stats.lockRequests;
    press("KeyJ"); frame(w);
    const o1 = w.journal.isOpen;
    press("KeyJ"); frame(w);
    check("J4 J toggles: open, then J closes it and asks for the pointer lock back",
        o1 && !w.journal.isOpen && w.journal.stats.closedBy === "key" && dom.stats.lockRequests > req0,
        { opened: o1, closedBy: w.journal.stats.closedBy, lockRequests: dom.stats.lockRequests - req0 });
    dom.lock();
}

// ================================================================ caches + toasts + glass
{
    const list = w.caches.list("cold");
    const lore = list.find((c) => c.kind === "lore" && !c.opened);
    const relic = list.find((c) => c.kind === "relic" && !c.opened);
    const grand = list.find((c) => c.kind === "grand" && !c.opened);
    const g0 = w.shop.glass;
    tp(w, w.caches.x[lore.site] + 1.2, w.caches.z[lore.site], rig.yaw);
    frames(w, 2);
    const target = w.caches.interactTarget;
    i0 = w.log.length;
    press("KeyE"); frame(w);
    const opened = since(w, i0, "cache:opened")[0];
    const shard = opened && opened.p.loot.lore ? STORY.lore.cold.find((s) => s.id === opened.p.loot.lore) : null;
    const loreToast = w.live = w.toasts.live.map((t) => t.kick.textContent + " | " + t.main.textContent);
    check("C1 E at a lore cache opens it through the router: 'Lore Shard Found' (shard title) + a '+N Wake Glass' toast; the HUD pill shows the wallet",
        target === lore.site && w.interact.stats.last === "cache" && opened && shard
        && loreToast.some((s) => s.indexOf("Lore Shard Found | " + shard.title) === 0)
        && loreToast.some((s) => s.indexOf("+" + opened.p.loot.glass + " Wake Glass") === 0)
        && txt("#hud .hud-glass-n") === String(w.shop.glass) && w.shop.glass === g0 + opened.p.loot.glass
        && hasCls("#hud", "glass"),
        { site: lore.site, route: w.interact.stats.last, loot: opened && opened.p.loot, toasts: loreToast,
            hudGlass: txt("#hud .hud-glass-n"), wallet: w.shop.glass });
    // The grand cache within 2.5 s: its 60 glass joins the SAME glass toast.
    tp(w, w.caches.x[grand.site] + 1.2, w.caches.z[grand.site], rig.yaw);
    frames(w, 2);
    press("KeyE"); frame(w);
    const glassToasts = w.toasts.live.filter((t) => t.kind === "glass");
    const sum = opened.p.loot.glass + 60;
    check("C2 Wake Glass gains inside 2.5 s coalesce into ONE rolling toast (+lore glass +60 grand)",
        glassToasts.length === 1 && glassToasts[0].glass === sum && glassToasts[0].kick.textContent === "+" + sum + " Wake Glass",
        { glassToasts: glassToasts.map((t) => t.kick.textContent), want: sum });
    tp(w, w.caches.x[relic.site] + 1.2, w.caches.z[relic.site], rig.yaw);
    frames(w, 2);
    i0 = w.log.length;
    press("KeyE"); frame(w);
    const rel = since(w, i0, "cache:opened")[0];
    const info = rel && STORY.relics[rel.p.loot.relic];
    const relToast = w.toasts.live.filter((t) => t.kind === "relic").map((t) =>
        t.kick.textContent + " | " + t.main.textContent + " | " + t.el.querySelector(".tt-sub").textContent);
    check("C3 a relic cache: 'Relic Found' card with the relic's name and effect",
        info && relToast.length === 1 && relToast[0] === "Relic Found | " + info.name + " | " + info.effect,
        { relic: rel && rel.p.loot.relic, toast: relToast });
    // The toast stack never exceeds 4 and empties on game time.
    const maxLive = w.toasts.live.length;
    until(w, () => w.toasts.live.length === 0 && !hasCls("#dw-banner", "show"), 12);
    check("C4 toast stack capped at 4, everything expires on game time (banner 3 s, toasts 4.5 s)",
        maxLive <= 4 && w.toasts.live.length === 0 && !hasCls("#dw-banner", "show"),
        { maxLive, left: w.toasts.live.length, banners: w.toasts.stats.banners, toasts: w.toasts.stats.toasts });
    // Journal reflects it: Side 3/15, Lore shows the shard.
    w.journal.open("side");
    const side = txt("#dw-journal .dwu-body");
    w.journal.setTab("lore");
    const loreTxt = txt("#dw-journal .dwu-body");
    w.journal.close("api");
    check("C5 the journal reflects it: Side 'Relic caches found 3/15', Lore shows the collected shard's title and lines",
        side.indexOf("Relic caches found 3/15") >= 0 && loreTxt.indexOf(shard.title) >= 0 && loreTxt.indexOf(shard.lines[0]) >= 0
        && loreTxt.indexOf("1 / 12") >= 0, { cachesLine: side.indexOf("Relic caches found 3/15") >= 0, shard: shard.id });
}

// ======================================== journal + map reflect trials/bounties
{
    // The two side systems' OWN persisted state (what their events write):
    // a gold run on trial.cold.1 and Frostfang claimed.
    w.trials.records["trial.cold.1"] = { best: 29.81, medal: 3 };
    w.bounties.killed["bounty.cold.1"] = true;
    bus.emit("trial:finished", { id: "trial.cold.1", name: STORY.trials.cold[0].name, time: 29.81, medal: 3,
        best: 29.81, firstMedal: true, newBest: true, par: 36.36, prevMedal: 0 });
    frames(w, 2);
    const medalToast = w.toasts.live.filter((t) => /trial/.test(t.kind)).map((t) => t.el.textContent);
    w.journal.open("side");
    const rows = document.querySelectorAll("#dw-journal .dwu-row");
    const trialRow = rows.find((r) => r.getAttribute("data-trial") === "trial.cold.1");
    const bountyRow = rows.find((r) => r.getAttribute("data-bounty") === "bounty.cold.1");
    const comp = U.journal.completion(w.ctx);
    w.journal.close("api");
    w.map.open();
    const mk = w.map.markers;
    const tr = mk.trials.find((t) => t.id === "trial.cold.1");
    const bo = mk.bounties.find((b) => b.id === "bounty.cold.1");
    w.map.close("api");
    check("C6 a gold trial + a claimed bounty: medal toast; journal Side shows 'Gold' + best 29.8 s and 'Claimed'; the map rings the trial gold and greys the bounty; completion counts both",
        medalToast.some((s) => s.indexOf("Gold Medal — " + STORY.trials.cold[0].name) === 0 && s.indexOf("29.8 s") > 0)
        && trialRow && /Gold/.test(trialRow.textContent) && /best 29\.8 s/.test(trialRow.textContent)
        && bountyRow && /Claimed/.test(bountyRow.textContent) && tr && tr.s === 3 && bo && bo.s === 0
        && comp.parts.trials[0] === 1 && comp.parts.bounties[0] === 1,
        { medalToast, trialRow: trialRow && trialRow.textContent.slice(0, 120), bountyRow: bountyRow && bountyRow.textContent.slice(0, 80),
            mapTrial: tr && tr.s, mapBounty: bo && bo.s, completion: comp.parts });
    delete w.trials.records["trial.cold.1"];
    delete w.bounties.killed["bounty.cold.1"];
}

// ================================================================ map + pin
{
    dom.lock();
    press("KeyM"); frame(w);
    const m = w.map.markers;
    const c = m && m.counts;
    const legend = txt("#dw-map .dwm-legend");
    check("M1 M opens the map: 7 shrines (1 awakened), the 3 opened caches among those seen, 3 trial starts, 3 bounties, the terrain relief baked once",
        w.map.isOpen && input.panel === "map" && c.shrines === 7 && c.lit === 1 && c.cachesOpened === 3
        && c.cachesSeen >= 3 && c.trials === 3 && c.bounties === 3 && w.map.stats.bakes === 1
        && legend.indexOf("1 / 7") >= 0 && txt("#dw-map .dwu-title") === "The Rime Shelf",
        { counts: c, bakes: w.map.stats.bakes, title: txt("#dw-map .dwu-title") });
    // Click a dormant shrine on the stage.
    const dormant = m.shrines.find((s) => s.s === 0);
    const R = 620, size = w.map._size;
    const px = ((dormant.x / R) * 0.5 + 0.5) * size, py = ((dormant.z / R) * 0.5 + 0.5) * size;
    i0 = w.log.length;
    const ev = new dom.Event("click", { bubbles: true, clientX: px + 3, clientY: py - 2 });
    document.querySelector("#dw-map .dwm-m").dispatchEvent(ev);
    frame(w);
    const pinEv = since(w, i0, "waypoint:pin")[0];
    const t = w.tracker.target;
    check("M2 clicking a dormant shrine MARKS it: 'waypoint:pin', the tracker reads 'Marked <name>', the beacon and the minimap pip follow the mark",
        pinEv && pinEv.p.id === dormant.id && t.pinned && t.x === dormant.x && w.beacon.target.x === dormant.x
        && w.beacon.target.z === dormant.z && txt("#dw-tracker .qt-label") === "Marked" + dormant.label
        && hasCls("#dw-map .dwm-mark", "on") && w.minimap.questStats.wp === true,
        { pin: pinEv && pinEv.p, label: txt("#dw-tracker .qt-label"), beacon: [w.beacon.target.x, w.beacon.target.z] });
    keydown("Escape"); keyup("Escape");
    dom.lock();
    frames(w, 2);
    // Ride to within 12 m (outside the 6 m touch): the mark clears, the beacon returns to the quest.
    const sp = w.shrine.positions.find((p) => p.id === dormant.id);
    tp(w, sp.x + 12, sp.z, rig.yaw);
    frames(w, 3);
    const q = Q.waypoint;
    check("M3 arriving within 15 m clears the mark; the beacon is handed back to the quest's own waypoint",
        !w.tracker.pin.on && !w.tracker.target.pinned && w.tracker.stats.pinReached === 1
        && q && w.beacon.target.x === q.x && w.beacon.target.z === q.z,
        { pinOn: w.tracker.pin.on, beacon: [w.beacon.target.x, w.beacon.target.z], quest: q && [q.x, q.z] });
}

// ================================================================ allocation
if (typeof globalThis.gc === "function") {
    const v8 = await import("node:v8");
    const newSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === "new_space").space_used_size;
    dom.lock();
    const sp = w.shrine.positions[0];
    tp(w, sp.x + 60, sp.z + 40, 0.3);
    placeCamera(w.character);
    frames(w, 30);
    const c = w.character;
    const mm = w.minimap;
    const g2 = mm._octx;
    // The hud.js Wake Glass poll exactly as hud.update() runs it.
    const glassPoll = () => { if (w.hud.shop !== null && (w.hud.shop.glass | 0) !== w.hud._glass) w.hud._writeGlass(false); };
    const tick = () => {
        w.interact.update(DT);
        w.tracker.update(DT);
        w.compass.update(DT);
        w.dialogue.update(DT);
        w.toasts.update(DT);
        w.journal.update(DT);
        w.map.update(DT);
        w.intro.update(DT);
        w.ending.update(DT);
        w.ending.drive();
        glassPoll();
        mm._qv[0] = c.position.x; mm._qv[1] = c.position.z;
        mm._drawQuest(g2);
    };
    const FRAMES = 50000, SLICE = FRAMES / 10;
    let scavenged = 0;
    const win = (fn) => {
        globalThis.gc();
        const h0 = newSpace();
        let prev = h0;
        for (let s = 0; s < 10; s++) {
            for (let k = 0; k < SLICE; k++) fn(k);
            const h = newSpace();
            if (h < prev) { scavenged++; return Infinity; }
            prev = h;
        }
        return prev - h0;
    };
    const nop = () => {};
    win(nop); win(nop);
    const floor = Math.max(win(nop), win(nop));
    const EPS = 4096;
    const warm = [];
    let reached = -1;
    for (let rep = 0; rep < 20 && reached < 0; rep++) {
        const b = win(tick);
        warm.push(b);
        if (b <= floor + EPS) reached = rep;
    }
    win(tick);
    // Lane Q's rule: after tier-up, THREE CONSECUTIVE windows at the floor
    // (a lone spike = a V8 re-optimisation landing inside a window; it is
    // recorded, and the run must still settle back to the floor).
    const steadyAll = [];
    let run = 0;
    for (let rep = 0; rep < 12 && run < 3; rep++) {
        const b = win(tick);
        steadyAll.push(b);
        run = b <= floor + EPS ? run + 1 : 0;
    }
    const steady = steadyAll.slice(-3);
    const ring = new Array(64);
    const control = win((k) => { ring[k & 63] = { a: k, b: k + 1 }; });
    const vis = { tracker: w.tracker._show, compass: w.compass._show, hud: hasCls("#hud", "show"), pips: w.minimap.questStats };
    check("A1 ALLOCATION: steady lane-U frames (tracker with a live waypoint + distance, compass tick off-screen, dialogue/toasts idle, E router, closed panels, ending.drive idle, the hud.js Wake Glass poll, the minimap quest pips) allocate nothing (3 x 50k-frame windows within 4 KB of the empty-loop floor)",
        Number.isFinite(floor) && reached >= 0 && steady.every((b) => b <= floor + EPS) && control > 400 * 1024
        && vis.tracker && vis.compass,
        { instrumentFloor: floor, preTierUpWindows: warm, steadyWindowsAll: steadyAll, control, scavengedWindows: scavenged, visible: vis });
    // Attribution, each piece alone.
    const parts = {
        tracker: () => w.tracker.update(DT), compass: () => w.compass.update(DT), dialogue: () => w.dialogue.update(DT),
        toasts: () => w.toasts.update(DT), interact: () => w.interact.update(DT), glassPoll,
        minimapQuestPips: () => { mm._qv[0] = c.position.x; mm._qv[1] = c.position.z; mm._drawQuest(g2); },
        // PRE-EXISTING paths (not lane U): reported for the record.
        hudUpdateWhole: () => w.hud.update(), minimapOverlayWhole: () => mm._drawOverlay(c),
        minimapUpdateWhole: () => mm.update(),
    };
    const attr = {};
    for (const name in parts) {
        let best = Infinity;
        for (let rep = 0; rep < 12; rep++) { const b = win(parts[name]); if (b < best) best = b; if (b <= floor + EPS) break; }
        attr[name] = best === Infinity ? "scavenged" : best <= floor + EPS ? "floor" : Math.round((best - floor) / FRAMES * 10) / 10 + " B/call";
    }
    console.log("ALLOC attribution (best window vs the empty-loop floor): " + JSON.stringify(attr));
    if (process.env.UI_DIAG) {
        // V8's sampling heap profiler over the named pieces (diagnosis only).
        const { Session } = await import("node:inspector/promises");
        const session = new Session();
        session.connect();
        for (const name of String(process.env.UI_DIAG).split(",")) {
            const fn = parts[name];
            if (!fn) continue;
            for (let i = 0; i < 200000; i++) fn(i);
            await session.post("HeapProfiler.enable");
            await session.post("HeapProfiler.startSampling", { samplingInterval: 32 });
            for (let i = 0; i < 100000; i++) fn(i);
            const { profile } = await session.post("HeapProfiler.stopSampling");
            const sites = [];
            (function walk(n, stack) {
                const f = n.callFrame;
                const here = f.functionName + " " + (f.url || "").split("/").slice(-2).join("/") + ":" + (f.lineNumber + 1) + ":" + (f.columnNumber + 1);
                const st = stack.concat(here);
                if (n.selfSize > 0) sites.push([n.selfSize, st.slice(-3).join(" <- ")]);
                for (const ch of n.children) walk(ch, st);
            })(profile.head, []);
            sites.sort((a, b) => b[0] - a[0]);
            console.log("DIAG " + name + ":");
            for (const [bytes, st] of sites.slice(0, 8)) console.log("   ", bytes, st);
        }
    }
} else {
    console.log("NOT RUN A1 allocation (start node with --expose-gc)");
}

// ================================================================ ending
{
    const before = { exposure: S.exposure, bloom: S.bloomStrength, warm: S.sunTempWarm, el: S.sunElevation, freeze: S.freezeTime };
    let clock = 1e6;
    w.ending.now = () => clock;
    dom.lock();
    const exits0 = dom.stats.lockExits;
    i0 = w.log.length;
    bus.emit("ending:begin", { echoId: "echo.ash.6", lines: STORY.ending.echo });
    const e0 = { phase: w.ending.phase, line: txt("#dw-ending .en-line"), freeze: S.freezeTime, panel: input.panel,
        cinematic: document.body.classList.contains("dw-cinematic"),
        lockReleased: dom.stats.lockExits === exits0 + 1, letter: hasCls("#dw-ending", "letter") };
    clock += U.ending.ECHO_LINE_S * 1000 + 10; w.ending.tick();
    const l2 = txt("#dw-ending .en-line");
    keydown("Space"); keyup("Space");
    const l3 = txt("#dw-ending .en-line");
    keydown("KeyA"); keyup("KeyA");
    const ph = w.ending.phase;
    const anchor = { ...w.ending._anchor };
    frame(w);
    const p0 = camera.position.clone();
    clock += (U.ending.FLY_S * 1000) / 2; frame(w);
    const p1 = camera.position.clone();
    const mid = { exposure: S.exposure, warm: S.sunTempWarm, el: S.sunElevation };
    clock += (U.ending.FLY_S * 1000) / 2 + 10; w.ending.tick();
    const toCard = w.ending.phase;
    keydown("Enter"); keyup("Enter");
    const toCredits = w.ending.phase;
    const credits = txt("#dw-ending .en-roll");
    keydown("Enter"); keyup("Enter");
    const done = since(w, i0, "ending:done")[0];
    const after = { exposure: S.exposure, bloom: S.bloomStrength, warm: S.sunTempWarm, el: S.sunElevation, freeze: S.freezeTime };
    const d0 = Math.hypot(p0.x - anchor.x, p0.z - anchor.z), d1 = Math.hypot(p1.x - anchor.x, p1.z - anchor.z);
    check("E1 ending: the Echo's 3 lines (time + any key), the flyover RISES and WIDENS from the spawn shrine with the light warming, the card, the credits (all 11 sections), then control and every setting restored + 'ending:done'",
        e0.phase === "echo" && e0.line === STORY.ending.echo[0] && e0.freeze === true && e0.panel === "ending"
        && e0.lockReleased && e0.letter && l2 === STORY.ending.echo[1] && l3 === STORY.ending.echo[2] && ph === "flyover"
        && p0.y > anchor.y + 3 && p1.y > p0.y + 50 && d1 > d0 + 60 && mid.exposure > before.exposure
        && mid.warm >= 1 && mid.el < before.el && toCard === "card" && toCredits === "credits"
        && STORY.ending.credits.every((cr) => credits.indexOf(cr.heading) >= 0)
        && done && done.p.skipped === true && w.ending.phase === "idle"
        && after.exposure === before.exposure && after.bloom === before.bloom && after.warm === before.warm
        && after.el === before.el && after.freeze === before.freeze && input.panel === null && rig._first === true
        && e0.cinematic && !document.body.classList.contains("dw-cinematic"),
        { start: e0, lines: [l2, l3], flyover: { y0: r1(p0.y), y1: r1(p1.y), r0: r1(d0), r1: r1(d1), anchorY: r1(anchor.y) },
            midLight: mid, before, after, phases: w.ending.stats.phases, drives: w.ending.stats.drives });
    // Esc during the Echo skips everything.
    i0 = w.log.length;
    bus.emit("ending:begin", { echoId: "echo.ash.6", lines: STORY.ending.echo });
    keydown("Escape"); keyup("Escape");
    check("E2 Esc during the ending skips the whole sequence (no pause menu opened under it)",
        w.ending.phase === "idle" && since(w, i0, "ending:done").length === 1 && SHELL.phase === "playing"
        && S.freezeTime === false, { phase: w.ending.phase, shell: SHELL.phase });
}

// ================================================================ intro
{
    let clock = 5e6;
    w.intro.now = () => clock;
    const skipped0 = w.intro.stats.skipped;
    dom.lock();
    w.progression.newGame();
    const pending = w.intro.pending;
    frame(w);
    const opened = { open: w.intro.isOpen && hasCls("#dw-intro", "open"), freeze: S.freezeTime, panel: input.panel,
        lock: !!document.pointerLockElement };
    const lit = [];
    for (const t of [0.5, 0.7, 3.0, 5.3]) { clock = 5e6 + t * 1000; w.intro.tick(); lit.push(w.intro.stats.linesShown); }
    const lines = document.querySelectorAll("#dw-intro .in-line").map((l) => l.textContent);
    press("KeyW");
    frame(w);
    const closed = { open: w.intro.isOpen, freeze: S.freezeTime, panel: input.panel, skipped: w.intro.stats.skipped - skipped0,
        moveZ: input.moveZ };
    const saved = JSON.parse(localStorage.getItem("driftwake_save") || "{}");
    w.progression.continueRun();
    const cont = { seen: w.intro.seen, pending: w.intro.pending };
    frames(w, 2);
    check("N1 intro: a NEW RUN arms it, it opens in play (time frozen, keys taken, lock kept), the 3 premise lines fade in by the clock, any key closes it; persisted as seen, CONTINUE never replays",
        pending && opened.open && opened.freeze && opened.panel === "intro" && opened.lock
        && JSON.stringify(lit) === "[0,1,2,3]" && lines.join("|") === STORY.intro.lines.join("|")
        && !closed.open && closed.freeze === false && closed.panel === null && closed.skipped === 1
        && saved.quest && saved.quest.introSeen === true && cont.seen === true && cont.pending === false && !w.intro.isOpen,
        { pending, opened, linesShownAt: lit, closed, savedIntroSeen: saved.quest && saved.quest.introSeen, cont });
    // Automation: no shell -> it never opens by itself.
    const shell = globalThis.FFG.shell;
    globalThis.FFG.shell = null;
    w.progression.newGame();
    frames(w, 3);
    const auto = { pending: w.intro.pending, open: w.intro.isOpen };
    globalThis.FFG.shell = shell;
    w.intro.pending = false;
    check("N2 harness-neutral: with no FFG shell (automation) a NEW RUN never opens the intro by itself",
        auto.pending === true && auto.open === false, auto);
}

const fails = RESULTS.filter((r) => !r[1]);
console.log("\n=== " + (RESULTS.length - fails.length) + " / " + RESULTS.length + " lane-U node checks PASS ===");
if (fails.length) console.log("FAILED: " + fails.map((f) => f[0].split(" ")[0]).join(", "));
process.exit(fails.length ? 1 : 0);
