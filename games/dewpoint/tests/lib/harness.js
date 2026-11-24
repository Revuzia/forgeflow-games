// Tiny dependency-free test harness for `node tests/run.js`.
//   import { test, assert, eq, near, throws } from './lib/harness.js';
//   test('name', () => { ... });            // sync or async
// A test fails by throwing. `near` compares numbers with a tolerance.

export const registry = [];
let currentFile = '';
export function setFile(f) { currentFile = f; }

export function test(name, fn) { registry.push({ file: currentFile, name, fn }); }

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg);
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}

export function near(actual, expected, tol = 1e-6, msg = '') {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${expected} +/- ${tol}, got ${actual}`);
  }
}

export function between(actual, lo, hi, msg = '') {
  if (!(actual >= lo && actual <= hi)) throw new Error(`${msg ? msg + ': ' : ''}expected ${lo}..${hi}, got ${actual}`);
}

export function throws(fn, pattern, msg = '') {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) throw new Error(`${msg ? msg + ': ' : ''}expected a throw, nothing was thrown`);
  if (pattern && !pattern.test(String(err.message))) {
    throw new Error(`${msg ? msg + ': ' : ''}threw "${err.message}", expected it to match ${pattern}`);
  }
  return err;
}
