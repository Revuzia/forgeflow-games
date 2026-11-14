// wa_diag_alloc.mjs -- diagnostic (lane W): WHO allocates on a steady frame?
//   node --expose-gc --import ./_harness/node_three_register.mjs ./_harness/wa_diag_alloc.mjs [realm]
// Builds the probe's world (Cold boot, real ground, real layers), settles the
// realm, stands the rider beside an unopened cache with a live waypoint (the
// allocation check's scene), then runs the four lane-W systems' update() under
// V8's sampling heap profiler and prints the allocation sites by bytes.
// Asserts nothing.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Session } from "node:inspector/promises";

const REALM = process.argv[2] || "cold";
const HERE = dirname(fileURLToPath(import.meta.url));
const HDIR = join(HERE, "_wa_heights");
const META = JSON.parse(readFileSync(join(HDIR, "meta.json"), "utf8"));
const HS = {};
for (const r of ["cold", "sand", "ash"]) {
    const b = readFileSync(join(HDIR, r + ".f32"));
    HS[r] = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
globalThis.document = { getElementById: () => null };
const { Heightfield } = await import("../src/terrain/heightfield.js");
delete globalThis.document;
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { input } = await import("../src/core/input.js");
const { CharacterController } = await import("../src/character/controller.js");
const { DamageableRegistry } = await import("../src/combat/damageable.js");
const combatData = await import("../src/combat/combatData.js");
const { Enemies } = await import("../src/combat/enemies.js");
const { Progression } = await import("../src/progression/progression.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks } = await import("../src/world/landmarks.js");
const C = await import("../src/world/caches.js");
const T = await import("../src/world/trials.js");
const B = await import("../src/world/bounties.js");
const W = await import("../src/world/beacon.js");

const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(META.cold.originX, META.cold.originZ);
hf.size = META.cold.size; hf.cpuRes = META.cold.res; hf.cpuTexel = META.cold.texel;
hf.heightCPU = HS.cold;
const terrain = { heightAt: (x, z) => hf.heightAt(x, z), normalAt: (x, z, o) => hf.normalAt(x, z, o),
    edge01: (x, z) => hf.edge01(x, z), clampToPlayArea: (v) => hf.clampToPlayArea(v),
    edgePush: (x, z) => hf.edgePush(x, z) };
const scene = { add() {}, remove() {} };
const box = (v) => ({ value: v });
const uniforms = { sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0),
    uSunDir: box(new THREE.Vector3(0, 1, 0)), uSunColor: box(new THREE.Vector3(1, 1, 1)),
    uResolution: box(new THREE.Vector2(1, 1)) };
const crystals = { scene, shadows: { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; } },
    material: { uniforms } };
const rig = { yaw: 0, camera: { matrixWorld: new THREE.Matrix4() },
    getFlatForward(o) { return o.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); },
    getFlatRight(o) { return o.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)); }, addTrauma() {} };
const vis = { _slotInst: [], spawnUnit(i) { this._slotInst[i] = { tint: new Float32Array(4), state: new Float32Array(4) }; },
    spawn(i) { this.spawnUnit(i); }, free(i) { this._slotInst[i] = null; }, drive() {}, driveBolt() {}, update() {} };

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
const ctx = { scene, terrain, character, rig, registry, enemies, shrine, landmarks, progression, crystals,
    bus, input, S: { sssStrength: 1, sssRadius: 1, glintIntensity: 0.55, glintGrazing: 1 },
    getRealm: () => landmarks.realm };
const caches = new C.RelicCaches(ctx); ctx.caches = caches;
const trials = new T.WakeTrials(ctx); ctx.trials = trials;
const bounties = new B.Bounties(ctx);
const beacon = new W.WaypointBeacon(ctx);
if (REALM !== "cold") {
    hf.heightCPU = HS[REALM];
    shrine.setRealm(REALM); landmarks.setRealm(REALM);
    caches.setRealm(REALM); trials.setRealm(REALM); bounties.setRealm(REALM); beacon.setRealm(REALM);
}
const sys = [caches, trials, bounties, beacon];
for (let i = 0; i < 4000 && !(caches.readyRealm === REALM && trials.readyRealm === REALM
    && bounties.readyRealm === REALM); i++) {
    shrine.update(1 / 60); landmarks.update(1 / 60);
    for (const s of sys) s.update(1 / 60);
}
const c = caches.list().find((e) => !e.opened);
character.position.set(c.x + 6, terrain.heightAt(c.x + 6, c.z), c.z);
bus.emit("quest:waypoint", { x: c.x + 40, z: c.z, realm: REALM });
for (let i = 0; i < 3000; i++) for (const s of sys) s.update(1 / 60);

const per = {};
for (const s of sys) {
    const name = s.constructor.name;
    globalThis.gc(); globalThis.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) s.update(1 / 60);
    per[name] = +((process.memoryUsage().heapUsed - h0) / 20000).toFixed(2);
}
console.log("bytes/frame per system (heap delta, no GC between):", JSON.stringify(per));

const session = new Session();
session.connect();
await session.post("HeapProfiler.enable");
await session.post("HeapProfiler.startSampling", { samplingInterval: 64 });
for (let i = 0; i < 20000; i++) for (const s of sys) s.update(1 / 60);
const { profile } = await session.post("HeapProfiler.stopSampling");
const sites = [];
(function walk(n, stack) {
    const f = n.callFrame;
    const here = f.functionName + " " + (f.url || "").split("/").slice(-2).join("/") + ":" + (f.lineNumber + 1);
    const st = stack.concat(here);
    if (n.selfSize > 0) sites.push([n.selfSize, st.slice(-4).join(" <- ")]);
    for (const ch of n.children) walk(ch, st);
})(profile.head, []);
sites.sort((a, b) => b[0] - a[0]);
for (const [bytes, st] of sites.slice(0, 15)) console.log(bytes, st);
