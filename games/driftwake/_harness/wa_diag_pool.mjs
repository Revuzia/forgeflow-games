// wa_diag_pool.mjs -- diagnostic (lane W): what the REAL trial build sees.
//   node --import ./_harness/node_three_register.mjs ./_harness/wa_diag_pool.mjs [realm]
// Runs WakeTrials' own time-sliced build on the real ground (_wa_heights) with
// the real shrine / landmark / cache layout, then prints trials.stats.lastBuild
// (per trial: candidate starts, walks, pool size, pass rejections, replays,
// best ideal/par ratio). Asserts nothing.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REALM = process.argv[2] || "sand";
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
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks } = await import("../src/world/landmarks.js");
const C = await import("../src/world/caches.js");
const T = await import("../src/world/trials.js");

const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(META[REALM].originX, META[REALM].originZ);
hf.size = META[REALM].size; hf.cpuRes = META[REALM].res; hf.cpuTexel = META[REALM].texel;
hf.heightCPU = HS.cold;   // the game boots on Cold: shrine anchors are laid out there
const terrain = { heightAt: (x, z) => hf.heightAt(x, z), normalAt: (x, z, o) => hf.normalAt(x, z, o),
    edge01: (x, z) => hf.edge01(x, z) };
const box = (v) => ({ value: v });
const uniforms = { sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0) };
const crystals = { scene: { add() {}, remove() {} },
    shadows: { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; } }, material: { uniforms } };
const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);
const landmarks = new Landmarks(terrain, crystals, shrine);
if (REALM !== "cold") { hf.heightCPU = HS[REALM]; shrine.setRealm(REALM); landmarks.setRealm(REALM); }
for (let i = 0; i < 20; i++) { shrine.update(1 / 60); landmarks.update(1 / 60); }
const character = { position: new THREE.Vector3(), surf: 0, health: 100 };
const ctx = { terrain, landmarks, shrine, crystals, character, bus, input, getRealm: () => landmarks.realm };
const caches = new C.RelicCaches(ctx); ctx.caches = caches;
for (let i = 0; i < 20; i++) caches.update(1 / 60);
const trials = new T.WakeTrials(ctx);
trials.setRealm(REALM);
trials._buildWait = 0;
// Counted work, immune to a loaded machine: heightAt samples per step.
let hcount = 0;
const hOrig = terrain.heightAt;
terrain.heightAt = (x, z) => { hcount++; return hOrig(x, z); };
const t0 = performance.now();
const c0 = process.cpuUsage();
const g = trials._buildSteps(false);
let steps = 0, maxStep = 0, last = 0;
for (;;) {
    const r = g.next();
    steps++;
    if (hcount - last > maxStep) maxStep = hcount - last;
    last = hcount;
    if (r.done) break;
}
const cpu = process.cpuUsage(c0);
console.log("build wall ms", (performance.now() - t0).toFixed(1), "cpu ms", ((cpu.user + cpu.system) / 1000).toFixed(1),
    "steps", steps, "heightAt total", hcount, "max heightAt in one step", maxStep);
console.log("built:", JSON.stringify(trials.trials.map((t) => [t.id, t.n, +t.passD.toFixed(1), +(t.ideal / t.par).toFixed(3)])));
console.log("stats:", JSON.stringify(trials.stats));
