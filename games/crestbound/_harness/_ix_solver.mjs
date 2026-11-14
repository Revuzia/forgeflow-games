/**
 * Interactions lane — does the cannon solver land where it says?
 *
 * Integrates the CONTROLLER's flight (player/controller.js: half-step asymmetric gravity
 * via tuning.applyGravity, horizontal `v *= 1 - TUNE.airDrag*dt` per 1/120 s substep, no
 * stick) from every authored cannon's breech at the speed hazards/launch.js solves, and
 * reports the miss at the target's height. Node-only; imports the real modules.
 *
 *   node _harness/_ix_solver.mjs
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// the same minimal DOM shim modulecheck.mjs installs, so launch.js links under Node
const el = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild(c) { return c; }, removeChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  getContext: () => null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, right: 1280, bottom: 720 }) });
if (!globalThis.window) {
  globalThis.window = globalThis;
  globalThis.document = { createElement: el, createElementNS: el, body: el(), head: el(), documentElement: el(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', hardwareConcurrency: 8, deviceMemory: 8, getGamepads: () => [] }, configurable: true }); } catch (e) { /* node 21+ ships one */ }
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.performance = globalThis.performance || { now: () => Date.now() };
}

const tuning = await import(pathToFileURL(join(ROOT, 'runtime/core/tuning.js')).href);
const launch = await import(pathToFileURL(join(ROOT, 'runtime/hazards/launch.js')).href);
const { TUNE, applyGravity } = tuning;
const { solveSpeedForTarget, ballisticX, ballisticY, flightTimeForRange } = launch;

/** The controller's air step, transliterated: gravity half, move, gravity half, drag. */
function fly(vx0, vy0, dyTarget) {
  const dt = 1 / 120;
  let x = 0, y = 0, vx = vx0, vy = vy0, t = 0;
  let peak = 0;
  for (let i = 0; i < 120 * 12; i++) {
    vy = applyGravity(vy, dt * 0.5, vy > 0);
    x += vx * dt; y += vy * dt;
    vy = applyGravity(vy, dt * 0.5, vy > 0);
    vx *= (1 - TUNE.airDrag * dt);
    t += dt;
    if (y > peak) peak = y;
    if (vy < 0 && y <= dyTarget) return { x, y, t, peak };
  }
  return { x, y, t, peak, timeout: true };
}

const cases = [
  // [label, range m, dy m, pitch rad]  — the authored cannons
  ['ember-4 pylon',  Math.hypot(5.5 - 0, -9.5 - 6.4), 12.6 - 5.03, Math.PI * 0.25],
  ['ember-3 shaft',  Math.hypot(13.5 - 30, -20 - 6),  15.6 - 5.6,  Math.PI * 0.25],
  ['azure-3 1-2',    Math.hypot(46 - 30, -16 + 3),    5.6,         Math.PI * 0.25],
  ['azure-3 2-3',    Math.hypot(30 - 46, -38 + 19),   7.6,         Math.PI * 0.25],
  ['verdant-3 chaff',Math.hypot(47 - 14, -48 + 40),   8.0,         46 * Math.PI / 180],
  ['flat 20 m',      20, 0, Math.PI * 0.25],
  ['drop 30 m/-10',  30, -10, Math.PI * 0.25],
];
let worst = 0, bad = 0;
for (const [label, range, dy, pitch] of cases) {
  const v = solveSpeedForTarget(range, dy, pitch);
  if (!Number.isFinite(v)) { console.log(`  ${label.padEnd(16)} UNREACHABLE (range ${range.toFixed(1)} dy ${dy.toFixed(1)})`); bad++; continue; }
  const r = fly(v * Math.cos(pitch), v * Math.sin(pitch), dy);
  const miss = r.x - range;
  const tf = flightTimeForRange(v * Math.cos(pitch), range);
  worst = Math.max(worst, Math.abs(miss));
  const ok = Math.abs(miss) <= 0.35 && !r.timeout;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${label.padEnd(16)} range ${range.toFixed(2).padStart(6)} dy ${dy.toFixed(2).padStart(6)}  v ${v.toFixed(2)} m/s  flew ${r.x.toFixed(2)} m in ${r.t.toFixed(2)} s (solver ${tf.toFixed(2)} s)  miss ${miss >= 0 ? '+' : ''}${miss.toFixed(2)} m  apex +${r.peak.toFixed(1)}`);
}
console.log(`\nworst miss ${worst.toFixed(2)} m, ${bad} of ${cases.length} cases off by more than 0.35 m`);
process.exit(bad ? 1 : 0);
