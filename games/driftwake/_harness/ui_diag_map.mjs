// ui_diag_map.mjs -- lane U diagnosis (asserts nothing): bake the world map's
// relief for each realm from the REAL heightfield mirror (_harness/_wa_heights)
// with ui/worldMap.js's own _shade(), and write raw RGBA files for a look.
//
//   node --import ./_harness/node_three_register.mjs ./_harness/ui_diag_map.mjs <outDir>
//   python -c "from PIL import Image; ..."   (the driver converts them)
import * as THREE from "three";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installDom, Element } from "./node_dom_shim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HDIR = join(HERE, "_wa_heights");
const out = process.argv[2] || HERE;
installDom();
Element.prototype.getContext = function () {
    return { createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        clearRect() {}, putImageData() {} };
};
const META = JSON.parse(readFileSync(join(HDIR, "meta.json"), "utf8"));
const { Heightfield } = await import("../src/terrain/heightfield.js");
const { WorldMap, MAP_GRID } = await import("../src/ui/worldMap.js");
const { bus } = await import("../src/quests/events.js");
const hf = Object.create(Heightfield.prototype);
hf.origin = new THREE.Vector2(META.cold.originX, META.cold.originZ);
hf.size = META.cold.size; hf.cpuRes = META.cold.res; hf.cpuTexel = META.cold.texel;
const terrain = { playRadius: 620, heightAt: (x, z) => hf.heightAt(x, z) };
const map = new WorldMap({ bus, terrain, getRealm: () => "cold" });
for (const r of ["cold", "sand", "ash"]) {
    const b = readFileSync(join(HDIR, r + ".f32"));
    hf.heightCPU = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const rel = map._shade(r, 1);
    writeFileSync(join(out, "map_" + r + ".rgba"), Buffer.from(rel.img.data.buffer));
    console.log(r, "lo", rel.lo.toFixed(1), "hi", rel.hi.toFixed(1), "grid", MAP_GRID);
}
