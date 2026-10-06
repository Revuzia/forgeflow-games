// Shared Playwright + Vite helpers for the WOBBLEHOARD browser probes (plain Node ESM, no dependencies of its own).
// Playwright is NOT a package dependency (it would drag a browser download into every install); it is resolved from
// node_modules if present, else from the global install, and Chromium comes from PLAYWRIGHT_BROWSERS_PATH.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const tries = [
    () => req('playwright'),
    () => req(resolve(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')),
  ];
  for (const t of tries) { try { return t(); } catch { /* next */ } }
  throw new Error('playwright not found (install it globally: npm i -g playwright)');
}

/** Software WebGL2 (SwiftShader) + autoplay-friendly audio, so the same flags work on a GPU-less CI box. */
export const GL_ARGS = [
  '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
];

export async function launch({ headless = true, args = [] } = {}) {
  const { chromium } = loadPlaywright();
  return chromium.launch({ headless, args: [...GL_ARGS, ...args] });
}

async function up(url) {
  try { const r = await fetch(url); return r.ok; } catch { return false; }
}

const IS_WIN = process.platform === 'win32';
const VITE_BIN = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/** Kill a child started by startVite: the whole process group on POSIX, the process tree on Windows (no process groups there). */
function killTree(child) {
  try {
    if (IS_WIN) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-child.pid);
  } catch { /* gone */ }
}

/** Start `vite` on `port` (or reuse one already answering there). Returns { url, stop }. */
export async function startVite(port = 5360, { preview = false } = {}) {
  const url = `http://localhost:${port}/`;
  if (await up(url)) return { url, stop: () => {} };
  const viteArgs = [...(preview ? ['preview'] : []), '--port', String(port), '--strictPort'];
  // Run vite's own entry with this node: `spawn('npx')` fails on Windows (npx is npx.cmd there).
  const child = existsSync(VITE_BIN)
    ? spawn(process.execPath, [VITE_BIN, ...viteArgs], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true })
    : spawn('npx', ['vite', ...viteArgs], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, windowsHide: true });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const t0 = Date.now();
  while (!(await up(url))) {
    if (Date.now() - t0 > 60000) { killTree(child); throw new Error('vite did not start:\n' + log); }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { url, stop: () => killTree(child) };
}
