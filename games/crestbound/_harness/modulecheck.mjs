/**
 * CRESTBOUND module check — the REAL syntax + link gate.
 *
 * `node --check foo.js` is worthless here: on Node 22 it silently passes any file
 * containing an ESM `import`, so it will happily green-light `const b = ;`. This
 * script actually `import()`s every runtime module, which gives you:
 *   - a true ESM parse (syntax errors surface)
 *   - link-time validation (importing a symbol the target does not export throws)
 *   - module-scope crashes (side effects at import time surface immediately)
 *
 * `three` and `three/addons/*` resolve from forgeflow-games/node_modules, so the
 * real Three.js is used, not a stub. A minimal DOM shim is installed first so
 * browser-facing modules import cleanly under Node.
 *
 *   node _harness/modulecheck.mjs
 *   node _harness/modulecheck.mjs runtime/world/stage.js runtime/game.js
 *
 * Exit 0 = every module parses, links and imports.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ── minimal DOM/browser shim ─────────────────────────────────────────────────
// Enough for a module to touch the DOM at import time without exploding. Modules
// that need a REAL canvas still work: three only allocates one lazily.
function shimDom() {
  const store = new Map();
  const el = (tag = 'div') => {
    const e = {
      tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { this.children.push(c); return c; },
      removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
      removeAttribute() {}, addEventListener() {}, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }),
      focus() {}, blur() {}, click() {}, insertAdjacentHTML() {},
      getContext: () => ctx2d(), toDataURL: () => 'data:,', width: 256, height: 256,
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
      set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
    };
    return e;
  };
  const ctx2d = () => new Proxy({
    canvas: { width: 256, height: 256 },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData() {}, measureText: () => ({ width: 10 }),
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });

  const doc = {
    documentElement: el('html'), head: el('head'), body: el('body'),
    createElement: (t) => el(t),
    createElementNS: (_ns, t) => el(t),
    getElementById: (id) => (store.get(id) || (store.set(id, el()), store.get(id))),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createTextNode: (t) => ({ textContent: t }),
    hidden: false, visibilityState: 'visible', pointerLockElement: null,
    exitPointerLock() {}, fullscreenElement: null, exitFullscreen() {},
  };
  const storage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
             removeItem: (k) => m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
  };
  const win = {
    document: doc, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    localStorage: storage(), sessionStorage: storage(),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: { userAgent: 'node', hardwareConcurrency: 8, maxTouchPoints: 0, getGamepads: () => [], platform: 'node' },
    performance,
    AudioContext: class { constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.sampleRate = 48000; }
      createGain() { return audioNode(); } createOscillator() { return audioNode(); } createBiquadFilter() { return audioNode(); }
      createBuffer() { return { getChannelData: () => new Float32Array(1) }; } createBufferSource() { return audioNode(); }
      createDelay() { return audioNode(); } createDynamicsCompressor() { return audioNode(); }
      createStereoPanner() { return audioNode(); } createWaveShaper() { return audioNode(); }
      createConvolver() { return audioNode(); } createAnalyser() { return audioNode(); }
      resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); } },
  };
  const audioNode = () => new Proxy({
    connect: () => audioNode(), disconnect() {}, start() {}, stop() {},
    gain: audioParam(), frequency: audioParam(), Q: audioParam(), detune: audioParam(),
    delayTime: audioParam(), pan: audioParam(), threshold: audioParam(), knee: audioParam(),
    ratio: audioParam(), attack: audioParam(), release: audioParam(),
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const audioParam = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });

  win.webkitAudioContext = win.AudioContext;
  globalThis.window = win;
  globalThis.document = doc;
  // Node 22 exposes `navigator` as a getter-only global; patch the missing
  // fields onto the real one instead of replacing it.
  try {
    if (globalThis.navigator) {
      for (const [k, v] of Object.entries(win.navigator)) {
        if (globalThis.navigator[k] === undefined) {
          try { Object.defineProperty(globalThis.navigator, k, { value: v, configurable: true }); } catch {}
        }
      }
      win.navigator = globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
    }
  } catch {}
  globalThis.localStorage = win.localStorage;
  globalThis.sessionStorage = win.sessionStorage;
  globalThis.devicePixelRatio = 1;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.matchMedia = win.matchMedia;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.AudioContext = win.AudioContext;
  globalThis.webkitAudioContext = win.AudioContext;
  globalThis.HTMLCanvasElement = class {};
  globalThis.HTMLElement = class {};
  globalThis.Image = class { set src(_) { setTimeout(() => this.onload && this.onload(), 0); } };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.KeyboardEvent = class { constructor(t, o = {}) { Object.assign(this, { type: t }, o); } };
  globalThis.PointerEvent = globalThis.MouseEvent = class { constructor(t, o = {}) { Object.assign(this, { type: t }, o); } };
  globalThis.CustomEvent = class { constructor(t, o = {}) { Object.assign(this, { type: t }, o); } };
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d(); } };
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  globalThis.fetch = async () => { throw new Error('fetch is not available under modulecheck'); };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

shimDom();

const argv = process.argv.slice(2);
let files = argv.length
  ? argv.map((a) => join(ROOT, a.replace(/\//g, sep)))
  : walk(join(ROOT, 'runtime')).sort();

let bad = 0;
const failures = [];
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  try {
    await import(pathToFileURL(f).href);
    console.log(`  ok    ${rel}`);
  } catch (e) {
    bad++;
    const first = String(e.stack || e.message).split('\n').slice(0, 4).join('\n         ');
    failures.push({ rel, err: first });
    console.log(`  FAIL  ${rel}\n         ${first}`);
  }
}

console.log('\n' + '-'.repeat(70));
console.log(`${files.length} modules, ${bad} failing`);
if (bad) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  ${f.rel}\n    ${f.err}\n`);
}
process.exit(bad ? 1 : 0);
