// GENESIS — Vite dev/build config.
//
//   * dev server http://localhost:5190 (strictPort: the harness hard-codes it), no-store headers.
//   * base './' so the built dist/ can be hosted from any sub-path (portal / CDN folder).
//   * POST /__shot/<name> (PNG data URL or image bytes) -> _shots/<name>.png, used by the Playwright harness
//     and window.__GENESIS__.shot().
//   * the sim runs in a module Web Worker (src/sim/worker.ts) bundled by Vite (worker.format = 'es').
//   * css.postcss is inline + empty on purpose: isolates the game from the portal's Tailwind PostCSS config.

import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = resolve(ROOT, '_shots');

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function shotEndpoint(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: (e?: unknown) => void): void => {
    const url = req.url ?? '';
    if (!url.startsWith('/__shot/')) { next(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
    readBody(req).then((body) => {
      const name = decodeURIComponent(url.slice('/__shot/'.length).split('?')[0]).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/\.png$/i, '') || 'shot';
      const ct = String(req.headers['content-type'] ?? '');
      let bytes: Buffer;
      if (ct.startsWith('image/')) bytes = body;
      else {
        const text = body.toString('utf8');
        bytes = Buffer.from(text.slice(text.indexOf(',') + 1), 'base64');
      }
      mkdirSync(SHOTS_DIR, { recursive: true });
      const file = resolve(SHOTS_DIR, name + '.png');
      writeFileSync(file, bytes);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, path: file, bytes: bytes.length }));
    }).catch((e: unknown) => { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: String(e) })); });
  };
  return {
    name: 'genesis-shot-endpoint',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig({
  root: ROOT,
  base: './',
  clearScreen: false,
  plugins: [shotEndpoint()],
  css: { postcss: { plugins: [] } },
  server: {
    port: 5190,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' },
    // GENESIS_FROZEN=1: no HMR and no file watching (a shot run never sees a half-written edit);
    // GENESIS_NOHMR=1: files are still watched (a fresh page load gets the latest code) but open pages never reload
    ...(process.env.GENESIS_FROZEN === '1' ? { hmr: false, watch: null } : process.env.GENESIS_NOHMR === '1' ? { hmr: false } : {}),
  },
  preview: { port: 5191, strictPort: true, headers: { 'Cache-Control': 'no-store' } },
  worker: { format: 'es' },
  optimizeDeps: { include: ['three'] },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 4096,
  },
});
