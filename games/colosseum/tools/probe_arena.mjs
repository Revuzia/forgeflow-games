// Headless construction probe for the Colosseum geometry.
// Builds the whole building in node (three's geometry layer needs no WebGL) and
// reports mesh count, triangle count and per-part cost. This is the fast inner
// loop for arena work — the browser check is still the real gate, but this
// catches bad math in ~1s instead of a page load.
//
// run: node games/colosseum/tools/probe_arena.mjs [quality]

import * as THREE from "three";
import { Colosseum } from "../runtime/view/colosseum.js";
import { Crowd } from "../runtime/view/crowd.js";
import { Gates } from "../runtime/view/gates.js";
import { Hypogeum } from "../runtime/view/hypogeum.js";
import { ARENA, caveaLayout, TOTAL_ROWS } from "../runtime/data/arena_spec.js";

const quality = process.argv[2] || "high";
const scene = new THREE.Scene();

const t0 = Date.now();
const col = new Colosseum({ scene, quality, seed: 20260724 }).build();
const gates = new Gates(col.group, { materials: col.mat, colosseum: col });
const hypogeum = new Hypogeum(col.group, { quality, seed: 20260724, materials: col.mat });
const crowd = new Crowd(col.group, { quality, seed: 20260724 });
const buildMs = Date.now() - t0;

// Only count what would actually be SUBMITTED: an invisible subtree costs
// nothing, and the hypogeum is hidden whenever its traps are shut (which is
// the overwhelmingly common case).
function visible(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  return true;
}

let meshes = 0, tris = 0, instanced = 0, instances = 0;
const rows = [];
col.group.traverse((o) => {
  if (!o.isMesh || !visible(o)) return;
  meshes++;
  const g = o.geometry;
  const triCount = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  const n = o.isInstancedMesh ? o.count : 1;
  if (o.isInstancedMesh) { instanced++; instances += o.count; }
  tris += triCount * n;
  rows.push({
    name: o.name || "(unnamed)",
    kind: o.isInstancedMesh ? `instanced x${o.count}` : "mesh",
    triPerInstance: Math.round(triCount),
    totalTris: Math.round(triCount * n),
  });
});

const bbox = new THREE.Box3().setFromObject(col.group);
const size = bbox.getSize(new THREE.Vector3());

console.log(`\n=== COLOSSEUM PROBE (quality=${quality}) ===`);
console.log(`build time         : ${buildMs} ms`);
console.log(`draw calls (meshes): ${meshes}   [${instanced} instanced covering ${instances} objects]`);
console.log(`triangles          : ${tris.toLocaleString()}`);
console.log(`bbox               : ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} m`);
console.log(`\n-- per part --`);
rows.sort((a, b) => b.totalTris - a.totalTris);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(20)} ${r.kind.padEnd(18)} ${String(r.triPerInstance).padStart(7)} tri/inst  ${String(r.totalTris).padStart(9)} total`);
}

// --- dimensional sanity against the historical record ----------------------
const layout = caveaLayout();
const top = layout[layout.length - 1];
console.log(`\n-- dimensions --`);
console.log(`  arena floor      : ${(ARENA.floor.a * 2).toFixed(0)} x ${(ARENA.floor.b * 2).toFixed(0)} m   (real: 87 x 55)`);
console.log(`  cavea rows       : ${TOTAL_ROWS} across ${ARENA.tiers.length} tiers`);
console.log(`  cavea top        : a=${top.endA.toFixed(1)} b=${top.endB.toFixed(1)} y=${top.endY.toFixed(1)} m`);
console.log(`  outer ellipse    : ${(col.outer.a * 2).toFixed(0)} x ${(col.outer.b * 2).toFixed(0)} m   (real: 189 x 156)`);
// bbox.min.y is negative because the hypogeum genuinely extends below the sand,
// so the above-ground figure is the one to compare against the real building.
console.log(`  above ground     : ${bbox.max.y.toFixed(1)} m   (real: 48 to the attic cornice)`);
console.log(`  below sand       : ${(-bbox.min.y).toFixed(1)} m   (hypogeum)`);

// --- peak cost: a gate open AND a beast lift running -----------------------
gates.open("triumphalis");
hypogeum.open(0);
for (let i = 0; i < 300; i++) { gates.update(1 / 60); hypogeum.update(1 / 60); }
let peak = 0;
col.group.traverse((o) => { if (o.isMesh && visible(o)) peak++; });
console.log(`\n-- peak (Porta Triumphalis open + one beast lift raised) --`);
console.log(`  draw calls: ${peak}   (+${peak - meshes} over idle)`);
console.log(`  gates: ${JSON.stringify(gates.stats().triumphalis)}  lift0: ${hypogeum.stats().states[0]}  released: ${hypogeum.isReleased(0)}`);

const problems = [];
if (meshes > 34) problems.push(`idle draw calls ${meshes} > 34 budget for the building`);
if (peak > 45) problems.push(`peak draw calls ${peak} > 45 — a single entrance must not cost this much`);
if (!hypogeum.isReleased(0)) problems.push("lift 0 never reached the released state after 5 s");
if (gates.stats().triumphalis.state !== "open") problems.push("triumphalis never finished opening");
if (tris > 3_000_000) problems.push(`triangles ${tris} > 3M — too heavy for mid-range`);
if (Math.abs(col.outer.a * 2 - 189) > 30) problems.push(`outer major axis ${(col.outer.a * 2).toFixed(0)}m is far from the real 189m`);
if (Math.abs(col.outer.b * 2 - 156) > 30) problems.push(`outer minor axis ${(col.outer.b * 2).toFixed(0)}m is far from the real 156m`);
if (Math.abs(bbox.max.y - 48) > 12) problems.push(`above-ground height ${bbox.max.y.toFixed(1)}m is far from the real 48m`);

console.log(`\n-- verdict --`);
if (problems.length === 0) console.log("  PASS — within budget and dimensionally faithful");
else problems.forEach((p) => console.log("  PROBLEM:", p));
process.exit(problems.length ? 1 : 0);
