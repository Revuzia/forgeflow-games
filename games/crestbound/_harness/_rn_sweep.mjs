#!/usr/bin/env node
/**
 * RENDER LANE — sweep every course for a floor-like solid whose TOP sits on the
 * terrain (coplanar -> z-fight) or UNDER it (the terrain pokes through -> a
 * jagged intersection line). Pure data: the authored object list against the
 * terrain sampler terrain.js ships (`sampleHeights`), which is the array the
 * mesh and the collider are baked from.
 *
 *   node _harness/_rn_sweep.mjs            # table per course
 *   node _harness/_rn_sweep.mjs --json     # machine-readable
 *
 * Floor-like = the same rule course.js `_groundFootprints` uses for the grass
 * occupancy mask: area >= 6 m2, >= 2 m on each side, <= 3.5 m tall, not
 * terrain/water/light/text/deco; plus every `building`.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const COURSE_DIR = join(ROOT, 'runtime', 'data', 'courses');
const JSON_OUT = process.argv.includes('--json');

/* minimal DOM shim so terrain.js (-> builders.js -> materials.js) links under Node */
(function shimDom() {
  if (globalThis.window) return;
  const noop = () => {};
  const ctx2d = () => new Proxy({
    canvas: { width: 256, height: 256 },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    measureText: () => ({ width: 10 }),
  }, { get: (t, k) => (k in t ? t[k] : noop) });
  const el = (tag = 'div') => ({
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild: noop, remove: noop, setAttribute: noop, getAttribute: () => null,
    addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }),
    getContext: () => ctx2d(), toDataURL: () => 'data:,', width: 256, height: 256,
  });
  const doc = {
    documentElement: el('html'), head: el('head'), body: el('body'),
    createElement: (t) => el(t), createElementNS: (_n, t) => el(t),
    getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
  };
  const storage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  };
  globalThis.window = {
    document: doc, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: (fn) => setTimeout(() => fn(0), 16), cancelAnimationFrame: noop,
    localStorage: storage(), sessionStorage: storage(),
    location: { href: 'http://localhost/', search: '' }, navigator: { userAgent: 'node', hardwareConcurrency: 8 },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    performance: globalThis.performance,
  };
  globalThis.document = doc;
  try { if (!globalThis.navigator) globalThis.navigator = globalThis.window.navigator; } catch (e) { /* getter-only on this Node */ }
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.self = globalThis.window;
})();

const T = await import(pathToFileURL(join(ROOT, 'runtime', 'world', 'terrain.js')).href);
if (typeof T.sampleHeights !== 'function') { console.error('terrain.js has no sampleHeights'); process.exit(2); }

const files = readdirSync(COURSE_DIR).filter((f) => f.endsWith('.js')).sort();
const defs = [];
for (const f of files) {
  const m = await import(pathToFileURL(join(COURSE_DIR, f)).href);
  defs.push(m.default);
}
const keep = await import(pathToFileURL(join(ROOT, 'runtime', 'data', 'keep.js')).href);
defs.push(keep.default);

function floorLike(o) {
  if (!o || !o.p || !o.s) return false;
  if (o.kind === 'building') return true;
  const area = o.s[0] * o.s[2];
  return area >= 6 && o.s[0] >= 2 && o.s[2] >= 2 && o.s[1] <= 3.5 &&
    o.kind !== 'terrain' && o.kind !== 'water' && o.kind !== 'light' &&
    o.kind !== 'text' && o.kind !== 'deco';
}

const report = [];
for (const def of defs) {
  const terrains = [];
  if (def.terrain) terrains.push(def.terrain);
  for (const o of def.objects || []) if (o && o.kind === 'terrain') terrains.push(o);
  if (!terrains.length) continue;
  const samplers = terrains.map((t) => ({ t, f: T.sampleHeights(t) }));
  const hAt = (x, z) => {
    for (const s of samplers) {
      const o = s.t.origin || [0, 0], sz = s.t.size || [96, 96];
      if (x >= o[0] && x <= o[0] + sz[0] && z >= o[1] && z <= o[1] + sz[1]) return s.f(x, z);
    }
    return NaN;
  };
  const rows = [];
  for (let i = 0; i < (def.objects || []).length; i++) {
    const o = def.objects[i];
    if (!floorLike(o)) continue;
    if (o.motion || o.kind === 'mover' || o.kind === 'sinker' || o.kind === 'vanish' || o.kind === 'seesaw') continue;
    const top = o.p[1] + o.s[1] * 0.5;
    const x0 = o.p[0] - o.s[0] * 0.5, x1 = o.p[0] + o.s[0] * 0.5;
    const z0 = o.p[2] - o.s[2] * 0.5, z1 = o.p[2] + o.s[2] * 0.5;
    let dmin = Infinity, dmax = -Infinity, n = 0, nCop = 0, nAbove = 0, at = null;
    const step = 0.5;
    for (let x = x0 + 0.05; x <= x1 - 0.05; x += step) {
      for (let z = z0 + 0.05; z <= z1 - 0.05; z += step) {
        const h = hAt(x, z);
        if (h !== h) continue;
        const d = top - h;          // + : slab above the ground; - : ground pokes through
        n++;
        if (d < dmin) { dmin = d; at = [+x.toFixed(1), +z.toFixed(1)]; }
        if (d > dmax) dmax = d;
        if (Math.abs(d) < 0.008) nCop++;
        if (d < -0.008) nAbove++;
      }
    }
    if (!n) continue;
    // a slab a long way above the ground is a deck, not a seam candidate
    if (dmin > 0.35) continue;
    const cls = nAbove > 0 ? 'POKES' : (nCop > 0 ? 'COPLANAR' : 'clear');
    rows.push({ i, kind: o.kind, mat: o.mat, p: o.p.map((v) => +v.toFixed(2)), s: o.s.map((v) => +v.toFixed(2)),
                top: +top.toFixed(3), dmin: +dmin.toFixed(3), dmax: +dmax.toFixed(3),
                pctCoplanar: +(100 * nCop / n).toFixed(0), pctPokes: +(100 * nAbove / n).toFixed(0), at, cls });
  }
  report.push({ course: def.id, rows });
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1));
} else {
  let tot = { COPLANAR: 0, POKES: 0, clear: 0 };
  for (const r of report) {
    const bad = r.rows.filter((x) => x.cls !== 'clear');
    console.log(`\n== ${r.course}: ${r.rows.length} floor-like solids on terrain, ${bad.length} seam candidates`);
    for (const x of r.rows) {
      tot[x.cls]++;
      if (x.cls === 'clear') continue;
      console.log(`  ${x.cls.padEnd(8)} objects[${x.i}] ${x.kind}/${x.mat} p=${JSON.stringify(x.p)} s=${JSON.stringify(x.s)} top=${x.top}  top-ground min ${x.dmin} @${JSON.stringify(x.at)} max ${x.dmax}  coplanar ${x.pctCoplanar}%  pokes ${x.pctPokes}%`);
    }
  }
  console.log(`\nTOTAL floor-like on terrain: coplanar ${tot.COPLANAR}, terrain-pokes-through ${tot.POKES}, clear ${tot.clear}`);
}
