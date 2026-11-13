// wa_diag_slices.mjs -- diagnostic: where does a long trial-build slice go?
//   node --import ./_harness/node_three_register.mjs ./_harness/wa_diag_slices.mjs
// Times every generator .next() of WakeTrials' time-sliced build on the REAL
// ground (_wa_heights) and, for any slice over 20 ms, prints the time spent in
// each helper during it. Diagnostic only; asserts nothing.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HDIR = join(HERE, "_wa_heights");
const META = JSON.parse(readFileSync(join(HDIR, "meta.json"), "utf8"));
const HEIGHTS = {};
for (const r of ["cold", "sand", "ash"]) {
    const b = readFileSync(join(HDIR, r + ".f32"));
    HEIGHTS[r] = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
globalThis.document = { getElementById: () => null };
const { Heightfield } = await import("../src/terrain/heightfield.js");
delete globalThis.document;
const { registerShaders } = await import("../src/shaders/registry.js");
registerShaders();
const { bus } = await import("../src/quests/events.js");
const { input } = await import("../src/core/input.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks } = await import("../src/world/landmarks.js");
const C = await import("../src/world/caches.js");
const T = await import("../src/world/trials.js");

const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(-1024, -1024); hf.size = 2048; hf.cpuRes = 2048; hf.cpuTexel = 1;
hf.heightCPU = HEIGHTS.cold;
const terrain = {
    heightAt: (x, z) => hf.heightAt(x, z), normalAt: (x, z, o) => hf.normalAt(x, z, o),
    edge01: (x, z) => hf.edge01(x, z),
};
const box = (v) => ({ value: v });
const uniforms = { sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0) };
const crystals = { scene: { add() {}, remove() {} }, shadows: { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; } },
    material: { uniforms } };

// ---- instrumentation
const acc = {};
let cur = null;
function wrapFn(name) {
    const orig = T.WakeTrials.prototype[name];
    T.WakeTrials.prototype[name] = function (...a) {
        const t0 = performance.now();
        const r = orig.apply(this, a);
        acc[name] = (acc[name] || 0) + performance.now() - t0;
        return r;
    };
}
for (const n of ["_segmentOK", "_pointOK", "_ringOK", "_obstacles", "_finalize"]) wrapFn(n);
function wrapGen(name) {
    const orig = T.WakeTrials.prototype[name];
    T.WakeTrials.prototype[name] = function* (...a) {
        const g = orig.apply(this, a);
        let t0 = performance.now();
        let r = g.next();
        acc[name] = (acc[name] || 0) + performance.now() - t0;
        while (!r.done) {
            yield r.value;
            t0 = performance.now();
            r = g.next();
            acc[name] = (acc[name] || 0) + performance.now() - t0;
        }
        return r.value;
    };
}
wrapGen("_walkGen"); wrapGen("_replayGen");

const character = { position: new THREE.Vector3(), surf: 0, health: 100 };
for (const realm of ["cold", "sand", "ash"]) {
    hf.heightCPU = HEIGHTS[realm];
    const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);
    const landmarks = new Landmarks(terrain, crystals, shrine);
    if (realm !== "cold") { shrine.setRealm(realm); landmarks.setRealm(realm); }
    for (let i = 0; i < 20; i++) { shrine.update(1 / 60); landmarks.update(1 / 60); }
    const ctx = { terrain, landmarks, shrine, crystals, character, bus, input, rig: null,
        getRealm: () => landmarks.realm };
    const caches = new C.RelicCaches(ctx); ctx.caches = caches;
    for (let i = 0; i < 20; i++) caches.update(1 / 60);
    const trials = new T.WakeTrials(ctx);
    trials.setRealm(realm);
    trials._buildWait = 0;
    trials._gen = trials._buildSteps(false);
    let n = 0, total = 0, slow = [], maxCpu = 0;
    let r;
    do {
        for (const k in acc) acc[k] = 0;
        const t0 = performance.now();
        const c0 = process.cpuUsage();
        r = trials._gen.next();
        const ms = performance.now() - t0;
        const cu = process.cpuUsage(c0);
        const cpuMs = (cu.user + cu.system) / 1000;
        total += ms; n++;
        if (cpuMs > maxCpu) maxCpu = cpuMs;
        if (ms > 20) slow.push({ call: n, ms: +ms.toFixed(1), cpuMs: +cpuMs.toFixed(1), parts: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +v.toFixed(1)])) });
    } while (!r.done);
    console.log(realm, JSON.stringify({ nextCalls: n, totalMs: +total.toFixed(0), slowCalls: slow.length, maxCpuMsOneCall: +maxCpu.toFixed(1) }));
    for (const s of slow.slice(0, 8)) console.log("   ", JSON.stringify(s));
    caches.dispose(); trials.dispose();
}
