// height_agree.mjs - p23/stormplace.py's grounding row: the analytic ground storm_place.cjs evaluates (mkHeightFn, read out of maps.js)
// against the BUILT map's M.heightAt (pads, corridors and the baked lattice included) - the ground the game's own landAt reads.
//   node height_agree.mjs --root <game dir> --maps isla_viva,deepwood --seeds 7,1234 --out res.json
// Per (map, seed): a 161 x 161 grid over the storm area; land = height > waterY + 0.5 by each; the share that agree, and the final centre of
// the Storm built with landAt from the BUILT ground vs from the analytic one (metres apart).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { makeEnv } from "../../world_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root);
const MAPS = (args.maps || "isla_viva,deepwood").split(",").filter(Boolean);
const SEEDS = (args.seeds || "7,1234").split(",").map(Number);
const req = createRequire(import.meta.url);

function extractFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  let j = src.indexOf("{", i), depth = 0;
  for (let k = j; k < src.length; k++) { const ch = src[k]; if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) return src.slice(i, k + 1); } }
  throw new Error("unbalanced " + name);
}
const src = fs.readFileSync(path.join(ROOT, "runtime", "3d", "royale", "maps.js"), "utf8");
const ctx = { Math }; vm.createContext(ctx);
vm.runInContext(["const SIZE = 1600; const HALF = SIZE / 2;", ...["hash2", "smooth", "vnoise", "fbm", "mkHeightFn"].map((n) => extractFn(src, n)), "this.mk = mkHeightFn;"].join("\n"), ctx);

const E = await makeEnv({ root: ROOT });
const { buildMap } = await E.importMaps();
const out = { rows: [] };
const quiet = async (fn) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; } };
for (const mapId of MAPS) for (const seed of SEEDS) {
  const t0 = Date.now();
  const M = await quiet(() => buildMap(E.makeW(seed), mapId));
  const H = ctx.mk(mapId, seed), wy = M.waterY;
  let agree = 0, n = 0;
  for (let i = 0; i <= 160; i++) for (let j = 0; j <= 160; j++) {
    const x = -784 + i * 9.8, z = -784 + j * 9.8;
    const a = H(x, z) > wy + 0.5, b = M.heightAt(x, z) > wy + 0.5;
    n++; if (a === b) agree++;
  }
  const mk = (land) => new E.SIM.Storm({ seed, mode: "standard", half: M.half, landAt: land, heightAt: (x, z) => M.heightAt(x, z), waterY: wy });
  const sA = mk((x, z) => H(x, z) > wy + 0.5), sB = mk((x, z) => M.heightAt(x, z) > wy + 0.5);
  const fa = sA.circles[sA.circles.length - 1], fb = sB.circles[sB.circles.length - 1];
  out.rows.push({ map: mapId, seed, half: M.half, waterY: wy, agree, n, share: +(agree / n).toFixed(5), finalApartM: +Math.hypot(fa.x - fb.x, fa.z - fb.z).toFixed(2),
                  finalBuiltLand: M.heightAt(fb.x, fb.z) > wy + 0.5, buildS: (Date.now() - t0) / 1000 });
  console.error(mapId, seed, out.rows[out.rows.length - 1]);
}
fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log("WROTE", args.out);
