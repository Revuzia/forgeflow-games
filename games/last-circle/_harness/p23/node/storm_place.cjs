// storm_place.cjs - the Node half of p23/stormplace.py (parity P2-F, LC-13 / OD-1). NO browser, NO file edited.
//
//   node storm_place.cjs --root <game dir> --base-root <frozen game dir> [--n 2000] [--maps isla_viva,ashgrid,deepwood]
//                        [--plant land-ignored] [--inject stub.cjs] --out res.json
//
// The Storm under test is <root>/runtime/sim/royale.js, constructed the way the game constructs it (storm.js createStorm) PLUS the landAt
// predicate of OD-1 (P2-D, lane sim): new SIM.Storm({ seed, mode, half, landAt, heightAt, waterY }), landAt(x, z) = the map's ground
// above waterY + 0.5 m. The ground is the map's OWN analytic height function, read out of <root>/runtime/3d/royale/maps.js at run time
// (mkHeightFn and its noise, extracted by brace matching and evaluated in a vm context: never a stale copy), so 2000 seeds x 3 maps
// need no map build. waterY: 0 on a map whose MAPS entry has water, else -999 (maps.js buildMap). half = map half 784 (maps.js
// HALF * 0.98, the W.map.half storm.js passes).
//
// Rows it measures (stormplace.py judges): final-centre distance from the map centre (p50 / p90 / max), final centres in water, phase
// centres in water, total storm time per seed, nesting, per-phase edge speed as a share of sprint, Quick Match circles + timeline
// byte-identical to the frozen base (OD-1: STANDARD only), same seed twice identical, and how often landAt was called (a Storm that
// never asks the predicate cannot be honouring it).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root);
const BASE = args["base-root"] ? path.resolve(args["base-root"]) : null;
const N = +(args.n || 2000);
const MAPS = (args.maps || "isla_viva,ashgrid,deepwood").split(",").filter(Boolean);
const PLANT = args.plant || null;
const HALF_STORM = 784;

function loadSim(root, inject) {
  const f = path.join(root, "runtime", "sim", "royale.js");
  delete require.cache[require.resolve(f)];
  const saved = globalThis.FFG;
  globalThis.FFG = undefined;
  let m = require(f);
  const SIM = m && m.Storm ? m : globalThis.FFG.sim.Royale;
  globalThis.FFG = saved;
  if (inject) {
    const st = require(path.resolve(inject));
    if (typeof st.patch === "function") st.patch(SIM);
  }
  return SIM;
}

// extract `function <name>(` ... matching close brace from source text
function extractFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("maps.js: function " + name + " not found");
  let j = src.indexOf("{", i), depth = 0;
  for (let k = j; k < src.length; k++) {
    const ch = src[k];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error("maps.js: unbalanced " + name);
}
function heightKit(root) {
  const src = fs.readFileSync(path.join(root, "runtime", "3d", "royale", "maps.js"), "utf8");
  const size = /const SIZE = (\d+)/.exec(src);
  const code = ["const SIZE = " + (size ? size[1] : 1600) + ";", "const HALF = SIZE / 2;",
    extractFn(src, "hash2"), extractFn(src, "smooth"), extractFn(src, "vnoise"), extractFn(src, "fbm"), extractFn(src, "mkHeightFn"),
    "this.mkHeightFn = mkHeightFn;"].join("\n");
  const ctx = { Math };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  // water flag per map: the MAPS table literal `<id>: { ... water: true|false`
  const water = {};
  const mapsAt = src.indexOf("export const MAPS = {");
  for (const id of MAPS) {
    const re = new RegExp("\\n  " + id + ":\\s*\\{([^\\n]*)");
    const m0 = mapsAt >= 0 ? re.exec(src.slice(mapsAt, mapsAt + 20000)) : null;
    const m = m0 ? /\bwater:\s*(true|false)/.exec(m0[1]) : null;
    if (!m) throw new Error("maps.js: MAPS." + id + ".water not found");
    water[id] = m[1] === "true";
  }
  return { mk: ctx.mkHeightFn, water };
}

const seedOf = (s) => (Math.imul(s + 1, 2654435761) >>> 0);   // spread like a real 32-bit match seed (P1-G storm_study)
const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : null; };
const r1 = (v) => Math.round(v * 10) / 10;

const SIM = loadSim(ROOT, args.inject);
const SIMB = BASE ? loadSim(BASE, null) : null;
const HK = heightKit(ROOT);
const out = { root: ROOT, base: BASE, n: N, plant: PLANT, inject: args.inject || null, maps: {}, version: { n: N } };

function mkStorm(S, seed, mode, land, H, waterY, counter) {
  const landAt = (x, z) => { counter.n++; return land(x, z); };
  return new S.Storm({ seed, mode, half: HALF_STORM, landAt, heightAt: H, waterY });
}

for (const mapId of MAPS) {
  const waterY = HK.water[mapId] ? 0 : -999;
  const res = { waterY, finals: [], wetFinal: 0, wetCentres: 0, centres: 0, totalS: {}, nestBad: 0, edge: [], quickDiff: 0, quickChecked: 0,
                detDiff: 0, landCalls: 0, sample: [] };
  const edgeMax = [];
  for (let s = 0; s < N; s++) {
    const seed = seedOf(s);
    const H = HK.mk(mapId, seed);
    const truth = (x, z) => H(x, z) > waterY + 0.5;
    const land = PLANT === "land-ignored" ? () => true : truth;
    const cnt = { n: 0 };
    const st = mkStorm(SIM, seed, "standard", land, H, waterY, cnt);
    res.landCalls += cnt.n;
    const C = st.circles, last = C[C.length - 1];
    res.finals.push(Math.hypot(last.x, last.z));
    if (!truth(last.x, last.z)) res.wetFinal++;
    for (let i = 1; i < C.length; i++) { res.centres++; if (!truth(C[i].x, C[i].z)) res.wetCentres++; }
    const tk = String(Math.round(st.totalS));
    res.totalS[tk] = (res.totalS[tk] || 0) + 1;
    for (let i = 0; i + 1 < C.length; i++) {
      const a = C[i], b = C[i + 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) + b.r > a.r + 1e-6) res.nestBad++;
      const tl = st.timeline[i];
      const travel = (a.r - b.r) + Math.hypot(b.x - a.x, b.z - a.z);
      const sp = travel / Math.max(1e-9, tl.end - tl.shrinkStart) / SIM.MOVE.sprint;
      edgeMax[i] = Math.max(edgeMax[i] || 0, sp);
    }
    if (s < 40) res.sample.push({ seed, x: r1(last.x), z: r1(last.z), r: r1(last.r), land: truth(last.x, last.z) });
    // determinism: the same seed twice
    if (s < 200) {
      const st2 = mkStorm(SIM, seed, "standard", land, H, waterY, { n: 0 });
      if (JSON.stringify(st2.circles) !== JSON.stringify(C) || st2.totalS !== st.totalS) res.detDiff++;
    }
    // OD-1: Quick Match keeps today's rule - byte-identical to the frozen base Storm (built the way the base game builds it: no landAt)
    if (SIMB && s < 2000) {
      res.quickChecked++;
      const qa = mkStorm(SIM, seed, "quick", land, H, waterY, { n: 0 });
      const qb = new SIMB.Storm({ seed, mode: "quick", half: HALF_STORM });
      if (JSON.stringify(qa.circles) !== JSON.stringify(qb.circles) || JSON.stringify(qa.timeline) !== JSON.stringify(qb.timeline)) res.quickDiff++;
    }
  }
  res.edge = edgeMax.map((v) => +v.toFixed(3));
  res.p50 = r1(q(res.finals, 0.5)); res.p90 = r1(q(res.finals, 0.9)); res.max = r1(Math.max(...res.finals));
  res.over150 = res.finals.filter((d) => d >= 150).length;
  delete res.finals;
  out.maps[mapId] = res;
  console.error(mapId, "p50", res.p50, "wetFinal", res.wetFinal, "total", JSON.stringify(res.totalS), "quickDiff", res.quickDiff, "landCalls", res.landCalls);
}
fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log("WROTE", args.out);
