// wa_diag_sand1.mjs -- diagnostic: why can a realm's trial fail to build?
//   node --import ./_harness/node_three_register.mjs ./_harness/wa_diag_sand1.mjs [realm] [k]
// Re-runs one trial's candidate walks on the REAL ground and tallies how far
// each walk got, why it stopped, and whether it passed the landmark / par tests.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REALM = process.argv[2] || "sand";
const K = +(process.argv[3] || 0);
const HERE = dirname(fileURLToPath(import.meta.url));
const HDIR = join(HERE, "_wa_heights");
const b = readFileSync(join(HDIR, REALM + ".f32"));
const H = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
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
hf.origin = new THREE.Vector2(-1024, -1024); hf.size = 2048; hf.cpuRes = 2048; hf.cpuTexel = 1;
hf.heightCPU = H;
const terrain = { heightAt: (x, z) => hf.heightAt(x, z), normalAt: (x, z, o) => hf.normalAt(x, z, o),
    edge01: (x, z) => hf.edge01(x, z) };
const box = (v) => ({ value: v });
const uniforms = { sssStrength: box(1), sssRadius: box(1), glintIntensity: box(0.55), glintGrazing: box(1),
    uCameraPos: box(new THREE.Vector3()), uViewProj: box(new THREE.Matrix4()), uTime: box(0) };
const crystals = { scene: { add() {}, remove() {} }, shadows: { registerCaster() {}, makeCasterMaterial() { return { dispose() {} }; } },
    material: { uniforms } };
const shrine = new SpawnShrine(terrain, crystals, 5.0, 5.5);
const landmarks = new Landmarks(terrain, crystals, shrine);
if (REALM !== "cold") { shrine.setRealm(REALM); landmarks.setRealm(REALM); }
for (let i = 0; i < 20; i++) { shrine.update(1 / 60); landmarks.update(1 / 60); }
const character = { position: new THREE.Vector3(), surf: 0, health: 100 };
const ctx = { terrain, landmarks, shrine, crystals, character, bus, input, getRealm: () => landmarks.realm };
const caches = new C.RelicCaches(ctx); ctx.caches = caches;
for (let i = 0; i < 20; i++) caches.update(1 / 60);
const trials = new T.WakeTrials(ctx);
trials.setRealm(REALM);
trials._buildWait = 0;
const g = trials._buildSteps(false);
while (!g.next().done) { /* full build */ }
console.log("built:", trials.trials.map((t) => [t.id, t.n, +t.passD.toFixed(1)]), "failed:", trials.stats.failed);

// Re-walk trial K's candidates with instrumentation.
const def = STORY.trials[REALM][K];
const inst = landmarks.instances.filter((s) => s.realm === REALM);
const cands = inst.filter((s) => s.type === def.landmark);
const obs = trials._obstacles(REALM, inst);
const built = trials.trials.filter((t) => t.id !== def.id);
const tally = { startBlocked: 0, short: {}, passFail: 0, ok: 0 };
const why = { grade: 0, clear: 0, own: 0, ring: 0 };
const origSeg = trials._segmentOK.bind(trials);
for (const li of cands) {
    for (let bb = 0; bb < 12; bb++) {
        const a = (bb / 12) * Math.PI * 2;
        const sx = li.x + Math.sin(a) * 70, sz = li.z - Math.cos(a) * 70;
        const toA = Math.atan2(li.x - sx, -(li.z - sz));
        for (let side = -1; side <= 1; side += 2) {
            const h0 = toA + side * 0.42;
            if (!trials._pointOK(sx, sz, obs, built) || !trials._ringOK(sx, sz, h0)) { tally.startBlocked++; continue; }
            // manual walk mirroring _walkGen, recording the reason the walk stopped
            let px = sx, pz = sz, h = h0, n = 1;
            const gx = [sx], gz = [sz];
            for (let i = 1; i < 12; i++) {
                let bq = null;
                const reasons = [];
                for (const tn of [0, 12, -12, 24, -24, 36, -36]) {
                    const hh = h + tn * Math.PI / 180;
                    const qx = px + Math.sin(hh) * 40, qz = pz - Math.cos(hh) * 40;
                    // classify
                    const len = 40, ux = (qx - px) / len, uz = (qz - pz) / len;
                    let r = null;
                    for (let s = 1; s <= 20 && !r; s++) {
                        const x = px + (qx - px) * s / 20, z = pz + (qz - pz) * s / 20;
                        const gg = (terrain.heightAt(x, z) - terrain.heightAt(x - ux * 4, z - uz * 4)) / 4;
                        if (gg > 0.30 || gg < -0.85) r = "grade";
                        else if (!trials._pointOK(x, z, obs, built)) r = "clear";
                    }
                    if (!r && !origSeg(px, pz, qx, qz, obs, built, { gx, gz })) r = "own";
                    if (!r && !trials._ringOK(qx, qz, hh)) r = "ring";
                    if (r) { reasons.push(r); continue; }
                    const sc = terrain.heightAt(px, pz) - terrain.heightAt(qx, qz) - Math.abs(tn * Math.PI / 180) * 3;
                    if (!bq || sc > bq.sc) bq = { qx, qz, hh, sc };
                }
                if (!bq) { for (const r of reasons) why[r]++; break; }
                gx.push(bq.qx); gz.push(bq.qz); px = bq.qx; pz = bq.qz; h = bq.hh; n++;
            }
            tally.short[n] = (tally.short[n] || 0) + 1;
            if (n >= 8) {
                const p = T.passOf(gx, gz, cands);
                if (p.d > 60) tally.passFail++; else tally.ok++;
            }
        }
    }
}
console.log(REALM, def.id, def.landmark, "instances:", cands.map((c) => [Math.round(c.x), Math.round(c.z), Math.round(Math.hypot(c.x, c.z))]));
console.log("walks by gates reached:", JSON.stringify(tally), "stop reasons (all 7 headings):", JSON.stringify(why));
