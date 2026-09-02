/**
 * Temporary functional smoke test for the world slice (builders / terrain /
 * water / props). Not a gate — modulecheck is the gate — this just proves the
 * new builders actually RUN and produce geometry, colliders and volumes rather
 * than merely parsing.
 */
function shimDom() {
  const ctx2d = () => new Proxy({
    canvas: { width: 512, height: 512 },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData() {}, measureText: () => ({ width: 10 }),
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const el = (tag = 'div') => ({
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    getContext: () => ctx2d(), toDataURL: () => 'data:,', width: 512, height: 512,
  });
  const doc = { createElement: (t) => el(t), createElementNS: (n, t) => el(t), body: el('body'), head: el('head'), addEventListener() {}, removeEventListener() {} };
  globalThis.document = doc;
  globalThis.window = { document: doc, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { href: 'http://localhost/', search: '' } };
  if (!globalThis.navigator) { try { globalThis.navigator = { userAgent: 'node' }; } catch (e) { /* node 22 defines it read-only */ } }
  globalThis.self = globalThis.window;
  globalThis.HTMLCanvasElement = function () {};
  globalThis.ImageData = function () {};
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
shimDom();

const THREE = await import('three');
const B = await import('../runtime/world/builders.js');
const T = await import('../runtime/world/terrain.js');
const W = await import('../runtime/world/water.js');
const P = await import('../runtime/world/props.js');

const theme = {
  id: 'verdant',
  palette: { safe: 0x9fb2c9, safeEdge: 0x9fffbf, kill: 0xff3a1f, killGlow: 0xffb03a,
             checkpoint: 0x2f6fa8, checkpointOn: 0x59ffc4, crest: 0xffd76a, sigil: 0xd8b4ff,
             coin: 0xffd76a, accent: 0x8fe06a, deco: 0x6f8a6a, water: 0x2f7f96, foliage: 0x4f9d43 },
  fog: { color: 0x9fc9e8, near: 20, far: 260 },
  bg: 0x9fc9e8,
  lights: { key: { color: 0xfff2d2, intensity: 2.4, dir: [-0.45, 0.78, -0.44] } },
};

let fails = 0;
function check(name, fn) {
  try {
    const r = fn();
    const tris = r && r.mesh ? B.triangleCount(r.mesh) : 0;
    const cols = r && r.colliders ? r.colliders.length : 0;
    const vols = r && r.volumes ? r.volumes.length : 0;
    if (r && r.mesh && tris <= 0) throw new Error('produced 0 triangles');
    console.log('  ok   ' + name.padEnd(22) + ' tris ' + String(tris).padStart(7) + '  colliders ' + String(cols).padStart(3) + '  volumes ' + vols);
  } catch (e) {
    fails++;
    console.log('  FAIL ' + name + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

console.log('builders ---------------------------------------------------------');
check('stairs', () => B.buildStairs({ p: [0, 0, 0], w: 3.2, rise: 0.32, run: 0.42, n: 8, rail: true }, theme));
check('ramp', () => B.buildRamp({ p: [0, 1, 0], s: [4, 0.5, 7], rot: [-0.3, 0, 0] }, theme));
check('tree', () => B.buildTree({ p: [0, 0, 0], h: 7, r: 0.4, seed: 3, climbable: true }, theme));
check('pole', () => B.buildPole({ p: [2, 0, 0], h: 6, r: 0.13 }, theme));
check('net', () => B.buildNet({ p: [0, 0, 4], s: [4, 5, 0.14], rot: 0.6 }, theme));
check('bridge', () => B.buildBridge({ a: [0, 4, 0], b: [14, 5, 6], w: 2.0, sag: 0.9 }, theme));
check('painting', () => B.buildPainting({ p: [0, 2.4, 0], yaw: Math.PI, course: 'verdant-1', w: 3, h: 3.6 }, theme));
check('painting(locked)', () => B.buildPainting({ p: [0, 2.4, 0], yaw: 0, course: 'rime-2', w: 3, h: 3.6, locked: true, requires: { crests: 12 } }, theme));
check('gatedoor', () => B.buildGateDoor({ p: [0, 0, 0], yaw: 0, w: 3.4, h: 4.6, requires: { crests: 30 }, course: 'azure-3' }, theme));
check('pedestal', () => B.buildPedestal({ p: [0, 0, 0] }, theme));
check('fence', () => B.buildFence({ a: [0, 0, 0], b: [11, 1.4, 4] }, theme));
check('rock', () => B.buildRock({ p: [0, 0, 0], r: 1.4, seed: 12, stripe: true, moss: true }, theme));
check('cannon', () => B.buildCannon({ p: [0, 0, 0], yaw: 0.8, pitch: 0.6, power: 28 }, theme));
for (const style of ['fort', 'cottage', 'tower', 'temple', 'foundry']) {
  check('building:' + style, () => B.buildBuilding({ p: [0, 0, 0], s: [12, 5, 9], style }, theme));
}
check('ring (ported)', () => B.buildRing({ p: [0, 3, 0], r: 2.2 }, theme));
check('build() dispatch', () => B.build({ kind: 'stairs', p: [0, 0, 0], n: 4 }, theme));

console.log('geometry emitters ------------------------------------------------');
for (const [n, fn] of [
  ['capsuleGeometry', () => B.capsuleGeometry(0.3, 1.4, 12)],
  ['latheProfile', () => B.latheProfileGeometry([[0, 0], [0.5, 0], [0.4, 0.6], [0, 0.9]], 16)],
  ['bevelBox', () => B.bevelBoxGeometry(1, 1, 1, 0.05, 1)],
  ['tube', () => B.tubeGeometry(0.2, 0.3, 1, 10, 1)],
]) {
  try {
    const g = fn();
    const c = g.attributes.position.count;
    if (!c || c % 3) throw new Error('bad vertex count ' + c);
    if (!g.attributes.normal || !g.attributes.uv) throw new Error('missing attribute');
    let bad = 0;
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++;
    if (bad) throw new Error(bad + ' non-finite positions');
    console.log('  ok   ' + n.padEnd(22) + ' verts ' + c);
  } catch (e) { fails++; console.log('  FAIL ' + n + ' :: ' + e.message); }
}

console.log('terrain ----------------------------------------------------------');
const tdef = {
  kind: 'terrain', origin: [-60, -60], size: [120, 120], res: 1.5, surface: 'grass',
  heights: { seed: 7, base: 0, hills: [{ p: [10, -20], r: 34, h: 9 }, { p: [-30, 25], r: 22, h: 5 }],
             flats: [{ p: [0, 0], r: 16, h: 0.5 }], ridges: [{ a: [-55, 40], b: [40, 55], w: 14, h: 6 }],
             noise: { amp: 0.9, freq: 0.045 } },
  paths: [{ pts: [[0, 0], [20, 20], [40, 22]], w: 3.5 }],
  grass: { density: 1.4, count: 9000 },
};
try {
  const s = T.sampleHeights(tdef);
  const y0 = s(0, 0), y1 = s(10, -20), y2 = s(999, 999);
  if (![y0, y1, y2].every(Number.isFinite)) throw new Error('sampler produced non-finite');
  const t = T.buildTerrain(tdef, theme, null, { grass: 9000 });
  const hf = t.heightfield;
  const err = Math.abs(hf.heightAt(3, -7) - s(3, -7));
  if (!(err < 1e-3)) throw new Error('heightfield disagrees with sampler by ' + err);
  console.log('  ok   sampleHeights          flat ' + y0.toFixed(3) + '  hill ' + y1.toFixed(3) + '  outside ' + y2.toFixed(3));
  console.log('  ok   buildTerrain           tris ' + B.triangleCount(t.mesh) + '  grass ' + (t.grass ? t.grass.count : 0)
    + '  hf ' + hf.nx + 'x' + hf.nz + '  |hf-sampler| ' + err.toExponential(1));
  t.update(1.25);
  const pf = T.samplePaths(tdef);
  console.log('  ok   samplePaths            on-path ' + pf(10, 10).toFixed(2) + '  off-path ' + pf(-40, -40).toFixed(2));
  t.dispose();
} catch (e) { fails++; console.log('  FAIL terrain :: ' + (e.stack || e)); }

console.log('water ------------------------------------------------------------');
const { Mats } = await import('../runtime/world/materials.js');
for (const [label, service] of [['fallback', null], ['Mats', Mats]]) {
  try {
    const t2 = T.buildTerrain(tdef, theme, service, { grass: 0 });
    const w = W.buildWater({ p: [0, 1, 0], s: [50, 6, 50], kind2: 'lake', flow: [1.2, 0], heightfield: t2.heightfield }, theme, service);
    const sh = w.mesh.geometry.attributes.aShore;
    if (!sh) throw new Error('no aShore attribute (materials.js reads it by that name)');
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < sh.count; i++) { const v = sh.getX(i); if (v < mn) mn = v; if (v > mx) mx = v; }
    const def = w.material.defines || {};
    console.log('  ok   buildWater[' + label + ']'.padEnd(11) + ' surfaceY ' + w.surfaceY + '  verts ' + sh.count
      + '  aShore[' + mn.toFixed(2) + '..' + mx.toFixed(2) + ']  vols ' + w.volumes.length
      + '  current ' + (w.current ? w.current.kind : 'none')
      + '  CB_WATER_SHORE ' + ('CB_WATER_SHORE' in def));
    if (label === 'Mats' && !('CB_WATER_SHORE' in def)) throw new Error('shore define not set on the Mats instance');
    w.update(2.5);
    if (w.volume.kind !== 'water') throw new Error('volume kind ' + w.volume.kind);
    if (Math.abs(w.volume.surfaceY - w.surfaceY) > 1e-6) throw new Error('volume surfaceY mismatch');
    if (service) {
      const su = Mats.uniforms('sand');
      if (!su || !su.uCbCausticParams || Math.abs(su.uCbCausticParams.value.x - w.surfaceY) > 1e-6) {
        throw new Error('caustic surfaceY not written to the sand material');
      }
      if (!(su.uCbCaustic.value > 0)) throw new Error('caustic strength still 0 (effect off)');
      console.log('  ok   caustics linked       sand strength ' + su.uCbCaustic.value
        + '  params(y,scale,speed) ' + su.uCbCausticParams.value.x + ', '
        + su.uCbCausticParams.value.y + ', ' + su.uCbCausticParams.value.z);
    }
    w.dispose(); t2.dispose();
  } catch (e) { fails++; console.log('  FAIL water[' + label + '] :: ' + (e.stack || e)); }
}

console.log('props ------------------------------------------------------------');
for (const th of ['keep', 'verdant', 'ember', 'rime', 'azure']) {
  try {
    const lib = P.proceduralLibrary(th);
    let tot = 0, worst = null;
    for (const id of lib.ids) {
      const e = lib.get(id);
      if (!e || !e.parts.length) throw new Error(id + ' produced no parts');
      for (const pt of e.parts) {
        const a = pt.geometry.attributes.position.array;
        for (let i = 0; i < a.length; i++) {
          if (!Number.isFinite(a[i])) throw new Error(id + ' has non-finite vertices');
        }
        tot += a.length / 9;
      }
      if (!worst || e.radius > worst.r) worst = { id, r: e.radius };
    }
    const g = lib.make('torch') || lib.make(lib.ids[0]);
    if (!g) throw new Error('make() returned null');
    console.log('  ok   ' + th.padEnd(9) + ' props ' + String(lib.ids.length).padStart(3)
      + '  tris ' + String(Math.round(tot)).padStart(6) + '  largest ' + worst.id + ' r=' + worst.r.toFixed(2));
  } catch (e) { fails++; console.log('  FAIL props:' + th + ' :: ' + (e.stack || e)); }
}
// props must resolve through the real Mats bank once it is initialised
try {
  const lib2 = P.proceduralLibrary('verdant', Mats);
  const names = new Set();
  for (const id of lib2.ids) for (const pt of lib2.get(id).parts) names.add(pt.material.name || '?');
  const viaMats = Array.from(names).filter((n) => n.indexOf('cb.') === 0).length;
  if (!viaMats) throw new Error('no prop material came from Mats (all fallback bank)');
  console.log('  ok   Mats-backed props     ' + viaMats + ' of ' + names.size + ' distinct materials are cb.* bakes');
} catch (e) { fails++; console.log('  FAIL props-via-Mats :: ' + (e.stack || e)); }

const NEW_KINDS = ['mushroom', 'flowerbed', 'bush', 'stump', 'crystal', 'lavaRock', 'icicle',
  'snowdrift', 'cactus', 'sandstone', 'gear', 'pipe', 'lantern', 'flagpole'];
const have = new Set(P.PROC_PROPS);
const miss = NEW_KINDS.filter((k) => !have.has(k));
if (miss.length) { fails++; console.log('  FAIL missing deco kinds: ' + miss.join(', ')); }
else console.log('  ok   all 14 contract deco kinds present');

console.log('\n' + (fails ? fails + ' FAILURES' : 'all world-slice smoke checks passed'));
process.exit(fails ? 1 : 0);
