// three_hooks.mjs - Node module-customization hooks for the Last Circle placement gate (lane 5D).
//
// Registered with  node --import <register shim> ...  (placement_census.mjs registers it itself through
// `module.register`). The browser resolves "three" and "three/addons/" through the importmap in index.html; Node has no
// importmap, so this resolve hook does the same job and lets the UNMODIFIED runtime/3d/royale/maps.js (and loot.js) be
// imported in Node with no build step and no copy of the file:
//
//   "three"           -> a generated shim module (lc-shim:three) = the vendored three r172 build, unchanged, plus one
//                        subclass of BoxGeometry that appends every box maps.js creates (with its creating call stack)
//                        to globalThis.__LC_BOXES, so the census can read each structure box's FINAL world position
//                        after maps.js rotates / translates it (the pieces are merged into a few meshes afterwards).
//   "three/addons/X"  -> <vendor>/examples/jsm/X
//   any file: .js     -> loaded as an ES module (the game tree has no package.json "type": "module"), except the
//                        UMD sim file (sim/royale.js), which stays CommonJS and is loaded with createRequire.
//
// Env: LC_THREE_VENDOR = <game>/assets/vendor/three  (the vendored copy the game itself serves).
// Nothing here edits a file; a planted fault (placement_census.mjs --plant) mutates the BUILT map in memory.
import { pathToFileURL } from "node:url";

const V = process.env.LC_THREE_VENDOR;
const REAL = V ? pathToFileURL(V.replace(/\\/g, "/") + "/build/three.module.js").href : null;

const SHIM_SRC = `
import * as REAL from "lc-real-three";
export * from "lc-real-three";
export class BoxGeometry extends REAL.BoxGeometry {
  constructor(w, h, d, a, b, c) {
    super(w, h, d, a, b, c);
    const rec = globalThis.__LC_BOXES;
    if (rec) rec.push({ geo: this, w, h, d, stack: new Error().stack });
  }
}
`;

export async function resolve(spec, ctx, next) {
  if (!V) throw new Error("three_hooks: LC_THREE_VENDOR is not set");
  if (spec === "three") return { url: "lc-shim:three", shortCircuit: true, format: "module" };
  if (spec === "lc-real-three") return { url: REAL, shortCircuit: true, format: "module" };
  if (spec.startsWith("three/addons/")) {
    return { url: pathToFileURL(V.replace(/\\/g, "/") + "/examples/jsm/" + spec.slice("three/addons/".length)).href, shortCircuit: true, format: "module" };
  }
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url === "lc-shim:three") return { format: "module", source: SHIM_SRC, shortCircuit: true };
  if (url.startsWith("file:") && url.endsWith(".js") && !/\/sim\/royale\.js$/.test(url)) {
    return next(url, { ...ctx, format: "module" });
  }
  return next(url, ctx);
}
