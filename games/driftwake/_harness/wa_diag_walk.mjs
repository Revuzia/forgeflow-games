// wa_diag_walk.mjs -- diagnostic (lane W): how far do one trial's walks get?
//   node --import ./_harness/node_three_register.mjs ./_harness/wa_diag_walk.mjs [realm] [k]
// Same world as the probe (shrine anchors laid out on Cold, then the realm
// swap). For every candidate start the build tries, runs the shipped greedy
// walk (target 12) and a bounded depth-first search over the same 7 headings,
// and tallies gates reached + why each heading was refused. Asserts nothing.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REALM = process.argv[2] || "sand";
const K = +(process.argv[3] || 0);
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
const { STORY } = await import("../src/quests/storyText.js");
const { SpawnShrine } = await import("../src/world/shrine.js");
const { Landmarks } = await import("../src/world/landmarks.js");
const C = await import("../src/world/caches.js");
const T = await import("../src/world/trials.js");

const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(META.cold.originX, META.cold.originZ);
hf.size = META.cold.size; hf.cpuRes = META.cold.res; hf.cpuTexel = META.cold.texel;
hf.heightCPU = HS.cold;
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

const def = STORY.trials[REALM][K];
const inst = landmarks.instances.filter((s) => s.realm === REALM);
const cands = inst.filter((s) => s.type === def.landmark);
const obs = trials._obstacles(REALM, inst);
const built = [];
const ri = ["cold", "sand", "ash"].indexOf(REALM);
const TURNS = [0, 12, -12, 24, -24, 36, -36].map((d) => d * Math.PI / 180);
const SP = +(process.argv[4] || 40);

function runGen(g) { let r; do { r = g.next(); } while (!r.done); return r.value; }

const why = { grade: 0, clear: 0, own: 0, ring: 0 };
function reason(px, pz, qx, qz, hh, own) {
    const len = Math.hypot(qx - px, qz - pz), ux = (qx - px) / len, uz = (qz - pz) / len;
    const steps = Math.ceil(len);
    for (let s = 1; s <= steps; s++) {
        const x = px + (qx - px) * s / steps, z = pz + (qz - pz) * s / steps;
        const g = (terrain.heightAt(x, z) - terrain.heightAt(x - ux * 4, z - uz * 4)) / 4;
        if (g > 0.30 || g < -0.85) return "grade";
        if (!trials._pointOK(x, z, obs, built)) return "clear";
    }
    if (!trials._segmentOK(px, pz, qx, qz, obs, built, own)) return "own";
    if (!trials._ringOK(qx, qz, hh)) return "ring";
    return null;
}
let budget = 0;
function dfs(gx, gz, h, need) {
    if (gx.length >= need) return { gx: gx.slice(), gz: gz.slice() };
    if (++budget > 20000) return null;
    const px = gx[gx.length - 1], pz = gz[gz.length - 1];
    const opts = [];
    for (const tn of TURNS) {
        const hh = h + tn;
        const qx = px + Math.sin(hh) * SP, qz = pz - Math.cos(hh) * SP;
        const r = reason(px, pz, qx, qz, hh, { gx, gz });
        if (r) { why[r]++; continue; }
        opts.push({ qx, qz, hh, sc: terrain.heightAt(px, pz) - terrain.heightAt(qx, qz) - Math.abs(tn) * 3 });
    }
    opts.sort((a, b) => b.sc - a.sc);
    for (const o of opts) {
        gx.push(o.qx); gz.push(o.qz);
        const r = dfs(gx, gz, o.hh, need);
        gx.pop(); gz.pop();
        if (r) return r;
    }
    return null;
}

const greedy = {}, dfsHits = [];
let starts = 0, blocked = 0;
for (const li of cands) {
    for (let b = 0; b < 12; b++) {
        const a = (b / 12) * Math.PI * 2 + C.hash3(K, ri, 77) * 0.5;
        for (const out of [70]) {
            const sx = li.x + Math.sin(a) * out, sz = li.z - Math.cos(a) * out;
            const toA = Math.atan2(li.x - sx, -(li.z - sz));
            for (let side = -1; side <= 1; side += 2) {
                starts++;
                const h0 = toA + side * 0.42;
                if (!trials._pointOK(sx, sz, obs, built) || !trials._ringOK(sx, sz, h0)) { blocked++; continue; }
                const L = runGen(trials._walkGen(sx, sz, h0, 12, obs, built));
                const n = L ? L.n : "<8";
                greedy[n] = (greedy[n] || 0) + 1;
                budget = 0;
                const d = dfs([sx], [sz], h0, 8);
                if (d) {
                    dfsHits.push({ lm: [Math.round(li.x), Math.round(li.z)], b, side,
                        pass: +T.passOf(d.gx, d.gz, cands).d.toFixed(1) });
                }
            }
        }
    }
}
console.log(REALM, def.id, def.landmark, "spacing", SP, "instances", JSON.stringify(cands.map((c) => [Math.round(c.x), Math.round(c.z), Math.round(Math.hypot(c.x, c.z))])));
console.log("starts", starts, "blocked", blocked, "greedy gates reached", JSON.stringify(greedy));
console.log("dfs 8-gate lines found from", dfsHits.length, "starts; refusals", JSON.stringify(why));
console.log(JSON.stringify(dfsHits.slice(0, 20)));
