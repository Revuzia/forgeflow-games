// world_env.mjs - the Node environment the Last Circle WORLD gates share (lane F1, 2026-10-13; the same infrastructure as the head of
// placement_census.mjs, factored so world_node.mjs and scratch probes do not copy it a third time).
//
//   const E = await makeEnv({ root, vendor });
//   const { buildMap } = await E.importMaps();             // the UNMODIFIED <root>/runtime/3d/royale/maps.js (a fresh module instance on `fresh`)
//   const M = await buildMap(E.makeW(seed), "ashgrid");
//
// It installs a fake DOM (a canvas stub: procedural textures, clouds, minimap), a root-relative fetch for assets the map reads (the baked prop
// collider table), a GLB reader (positions + indices: enough for bounding boxes and vertex clouds) behind W.kernel.loadGLTF, and
// the "three" resolve hook (three_hooks.mjs). Fault injection for the fail-path rows:
//   E.fail.glb   = /regex/ : a GLB url matching it rejects (what a squad client with a dead CDN request sees)
//   E.fail.fetch = /regex/ : a non-GLB root-relative fetch matching it answers 404
// Nothing here edits a file.
import fs from "node:fs";
import path from "node:path";
import { createRequire, register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function ctx2d(cv) {
  const noop = () => {};
  const base = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop: noop }), createLinearGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 10 }), canvas: cv,
  };
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}

function readAccessor(j, bin, ai) {
  const a = j.accessors[ai], bv = j.bufferViews[a.bufferView];
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const csize = { 5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 }[a.componentType];
  const stride = bv.byteStride || ncomp * csize;
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = a.componentType === 5126 ? new Float32Array(a.count * ncomp) : new Uint32Array(a.count * ncomp);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < ncomp; c++) {
    const p = off + i * stride + c * csize;
    let v;
    switch (a.componentType) {
      case 5126: v = dv.getFloat32(p, true); break;
      case 5125: v = dv.getUint32(p, true); break;
      case 5123: v = dv.getUint16(p, true); break;
      case 5121: v = dv.getUint8(p); break;
      case 5122: v = dv.getInt16(p, true); break;
      default: v = dv.getInt8(p);
    }
    if (a.normalized && a.componentType !== 5126) v = a.componentType === 5123 ? v / 65535 : a.componentType === 5121 ? v / 255 : a.componentType === 5122 ? Math.max(v / 32767, -1) : Math.max(v / 127, -1);
    out[i * ncomp + c] = v;
  }
  return out;
}

export async function makeEnv({ root, vendor }) {
  const ROOT = path.resolve(root);
  const VENDOR = path.resolve(vendor || path.join(ROOT, "assets", "vendor", "three"));
  const MAPS_JS = path.join(ROOT, "runtime", "3d", "royale", "maps.js");
  const SIM_JS = path.join(ROOT, "runtime", "sim", "royale.js");
  for (const f of [MAPS_JS, SIM_JS]) if (!fs.existsSync(f)) throw new Error("world_env: missing " + f);
  process.env.LC_THREE_VENDOR = VENDOR;
  register("./three_hooks.mjs", pathToFileURL(path.join(HERE, "x")).href);
  const THREE = await import("three");
  const fail = { glb: null, fetch: null };
  const fetchLog = [];

  globalThis.window = globalThis;
  globalThis.document = {
    createElement: () => { const cv = { width: 0, height: 0, style: {} }; cv.getContext = () => ctx2d(cv); cv.addEventListener = () => {}; return cv; },
    createElementNS: (ns, tag) => globalThis.document.createElement(tag),
  };
  const _realFetch = globalThis.__lcRealFetch || (globalThis.__lcRealFetch = globalThis.fetch);
  globalThis.fetch = async (url, opt) => {
    const u = String(url);
    if (!/^[a-z]+:/i.test(u)) {
      fetchLog.push(u);
      if (fail.fetch && fail.fetch.test(u)) return { ok: false, status: 404, url: u, json: async () => { throw new Error("404 " + u); }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
      const f = path.join(ROOT, u.split("?")[0].replace(/^\.?\//, ""));
      if (fs.existsSync(f)) {
        const buf = fs.readFileSync(f);
        return { ok: true, status: 200, url: u, json: async () => JSON.parse(buf.toString("utf8")), text: async () => buf.toString("utf8"),
                 arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      }
      return { ok: false, status: 404, url: u, json: async () => { throw new Error("404 " + u); }, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return _realFetch(url, opt);
  };

  const geomLocal = new Map();            // geometry -> { kind, meshLocal }
  const _parsed = {};
  function parseGLB(file, kind) {
    const b = fs.readFileSync(file);
    if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB: " + file);
    const jl = b.readUInt32LE(12);
    const j = JSON.parse(b.subarray(20, 20 + jl).toString("utf8"));
    if ((j.extensionsRequired || []).length) throw new Error("GLB needs extensions " + j.extensionsRequired.join(",") + ": " + file);
    const bin = b.subarray(20 + jl + 8);
    const meshGeos = j.meshes.map((m) => m.primitives.map((p) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(readAccessor(j, bin, p.attributes.POSITION), 3));
      if (p.indices != null) g.setIndex(Array.from(readAccessor(j, bin, p.indices)));
      g.userData.kind = kind;
      return g;
    }));
    const mkNode = (ni) => {
      const n = j.nodes[ni];
      const o = new THREE.Group(); o.name = n.name || "";
      if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
      else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
      if (n.mesh != null) for (const g of meshGeos[n.mesh]) o.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
      for (const c of n.children || []) o.add(mkNode(c));
      return o;
    };
    const rootG = new THREE.Group();
    for (const ni of j.scenes[j.scene || 0].nodes) rootG.add(mkNode(ni));
    rootG.updateMatrixWorld(true);
    rootG.traverse((o) => { if (o.isMesh) geomLocal.set(o.geometry, { kind, meshLocal: o.matrixWorld.clone() }); });
    return rootG;
  }
  async function loadGLTF(url) {
    if (fail.glb && fail.glb.test(String(url))) throw new Error("planted GLB failure " + url);
    const rel = String(url).replace(/^.*?assets\//, "assets/").split("?")[0];
    const file = path.join(ROOT, rel);
    const kind = path.basename(rel).replace(/\.glb$/, "");
    if (!fs.existsSync(file)) throw new Error("no such GLB " + rel);
    if (!_parsed[rel]) _parsed[rel] = parseGLB(file, kind === "deco_crystal" ? "crystal" : kind);
    return _parsed[rel].clone(true);
  }

  // the UMD sim is CommonJS in a scratch/rev copy and a "type": "module" file in the repo (it then publishes on globalThis.FFG)
  const _simMod = createRequire(import.meta.url)(SIM_JS);
  const SIM = _simMod && _simMod.Storm ? _simMod : (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.Royale);
  if (!SIM || typeof SIM.mulberry32 !== "function") throw new Error("world_env: could not load the Royale sim from " + SIM_JS);

  function makeW(seed) {
    const groups = {};
    const ev = {};
    return {
      seed, SIM, assetBase: "", mode: "standard", t: 0, phase: "match", settings: { graphics: "high" }, _groups: groups,
      group(name) { if (!groups[name]) { groups[name] = new THREE.Group(); groups[name].name = name; } return groups[name]; },
      scene: { background: null, fog: null, traverse() {}, environment: null, add() {}, remove() {} },
      kernel: { renderer: null, _updaters: [], onUpdate(fn) { this._updaters.push(fn); }, loadGLTF },
      events: { on(n, f) { (ev[n] = ev[n] || []).push(f); }, emit(n, ...a) { for (const f of ev[n] || []) f(...a); } },
      camera: null, player: null, _camFocus: null,
    };
  }
  /** import maps.js; `fresh` busts the module cache (the baked table is cached per module instance) */
  async function importMaps(fresh) {
    const href = pathToFileURL(MAPS_JS).href + (fresh ? "?fresh=" + Math.random().toString(36).slice(2) : "");
    return import(href);
  }
  return { THREE, ROOT, SIM, makeW, importMaps, fail, fetchLog, geomLocal, loadGLTF };
}
